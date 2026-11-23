'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { z } from 'zod';
import { requireDropshipStaff, sanitiseCsvCell } from '@/lib/dropship-staff';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_IMAGES_PER_PRODUCT = 10;
const MAX_INPUT_PIXELS = 40_000_000;     // 40 MP decompression-bomb limit

/** Inspect magic bytes (not file extension) for JPEG, PNG or WebP. */
export async function detectImageMime(buf: Uint8Array): Promise<'image/jpeg' | 'image/png' | 'image/webp' | null> {
  if (buf.byteLength < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Re-encode an image with sharp (strips EXIF/GPS metadata, auto-orients, blocks decompression bombs). */
async function reencodeStripExif(
  buf: Uint8Array,
  mime: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<{ bytes: Buffer; ext: 'jpg' | 'png' | 'webp'; contentType: string }> {
  const img = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('Invalid image file');
  if (mime === 'image/png') {
    return {
      bytes: await img.png({ compressionLevel: 9 }).toBuffer(),
      ext: 'png',
      contentType: 'image/png',
    };
  }
  if (mime === 'image/webp') {
    return {
      bytes: await img.webp({ quality: 86 }).toBuffer(),
      ext: 'webp',
      contentType: 'image/webp',
    };
  }
  return {
    bytes: await img.jpeg({ quality: 86, mozjpeg: true }).toBuffer(),
    ext: 'jpg',
    contentType: 'image/jpeg',
  };
}

/** Check candidate texts against the suppliers table and name variants (white-label guard). */
export async function checkWhiteLabelStrings(texts: string[]): Promise<string[]> {
  const clean = texts.map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!clean.length) return [];
  const sb = await createClient();
  const { data, error } = await sb.rpc('dropship_whitelabel_hits', { p_texts: clean });
  if (error) throw new Error(`White-label check failed: ${error.message}`);
  return ((data ?? []) as { matched_term: string; source_kind: string }[]).map(
    (r) => `${r.matched_term} (${r.source_kind.replace(/_/g, ' ')})`,
  );
}

const VariantInputSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  octopus_sku: z.string().trim().min(2).max(80),
  options: z.record(z.string(), z.string()),
  cost_cents: z.number().int().min(0).max(100_000_000),
  price_adjust_cents: z.number().int().min(-100_000_000).max(100_000_000),
  stock_status: z.enum(['in_stock', 'low', 'out']),
  stock_qty: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

const RouteInputSchema = z.object({
  destination_country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  shipping_method: z.enum(['express', 'standard', 'economy']),
  landed_price_cents: z.number().int().positive().max(100_000_000),
  est_shipping_cents: z.number().int().min(0).max(100_000_000),
  est_duties_cents: z.number().int().min(0).max(100_000_000),
  est_days_min: z.number().int().min(1).max(120),
  est_days_max: z.number().int().min(1).max(180),
  carrier: z.string().trim().max(120).nullable().optional(),
  is_active: z.boolean(),
});

const ProductInputSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  octopus_sku: z.string().trim().min(2, 'Octopus SKU is required').max(80),
  title: z.string().trim().min(3, 'Title is required').max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  images: z.array(z.string().trim().min(1)).max(MAX_IMAGES_PER_PRODUCT),
  specs: z.record(z.string(), z.string()),
  weight_g: z.number().int().min(1, 'Weight (g) must be > 0').max(200_000),
  dimensions_cm: z
    .object({
      l: z.number().min(0).max(500).optional(),
      w: z.number().min(0).max(500).optional(),
      h: z.number().min(0).max(500).optional(),
    })
    .nullable()
    .optional(),
  unit_cost_cents: z.number().int().min(0).max(100_000_000),
  min_order_qty: z.number().int().min(1).max(100_000),
  stock_status: z.enum(['in_stock', 'low', 'out']),
  stock_qty: z.number().int().min(0).max(10_000_000).nullable().optional(),
  source_type: z.enum(['own_warehouse', 'partner_supplier']),
  supplier_id: z.string().uuid().nullable().optional(),
  supplier_sku: z.string().trim().max(120).nullable().optional(),
  origin_country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  status: z.enum(['draft', 'active', 'archived']),
  variants: z.array(VariantInputSchema).max(50),
  routes: z.array(RouteInputSchema).max(100),
});

export type ProductInput = z.infer<typeof ProductInputSchema>;

async function writeAudit(params: {
  actorId: string;
  action: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  await admin.from('audit_log').insert({
    actor_id: params.actorId,
    actor_kind: 'staff',
    action: params.action,
    entity: 'dropship_product',
    entity_id: params.entityId,
    service: 'dropship',
    before: params.before ?? null,
    after: params.after ?? null,
    details: params.details ?? null,
  });
}

/** Save (create or update) a dropship product, its variants and routes, with white-label and publish guards. */
export async function saveDropshipProduct(
  raw: ProductInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const staff = await requireDropshipStaff(true);
  const parsed = ProductInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join(' · '),
    };
  }
  const p = parsed.data;

  for (const rt of p.routes) {
    if (rt.est_days_max < rt.est_days_min) {
      return {
        ok: false,
        error: `Route ${rt.destination_country} (${rt.shipping_method}): max days must be ≥ min days.`,
      };
    }
  }

  // White-label guard: title, description, specs, variant options, octopus_sku and generated alt text
  const candidateTexts: string[] = [
    p.octopus_sku,
    p.title,
    p.description ?? '',
    ...Object.entries(p.specs).flatMap(([k, v]) => [k, v]),
    ...p.variants.flatMap((v) => [
      v.octopus_sku,
      ...Object.entries(v.options).flatMap(([k, val]) => [k, val]),
    ]),
  ];
  // Also ensure octopus_sku never matches supplier_sku
  if (
    p.supplier_sku &&
    p.supplier_sku.trim().length >= 3 &&
    p.octopus_sku.toLowerCase().includes(p.supplier_sku.trim().toLowerCase())
  ) {
    return {
      ok: false,
      error: 'White-label guard: Octopus SKU must not contain the supplier SKU.',
    };
  }
  const wlHits = await checkWhiteLabelStrings(candidateTexts);
  if (wlHits.length > 0) {
    return {
      ok: false,
      error: `White-label guard rejected save — supplier identifier found: ${wlHits.join(', ')}`,
    };
  }

  // Publish guard (draft → active): title, at least 1 image, a cost > 0, and at least 1 active route
  if (p.status === 'active') {
    if (!p.title.trim()) {
      return { ok: false, error: 'Cannot publish: product must have a title.' };
    }
    if (p.images.length < 1) {
      return { ok: false, error: 'Cannot publish: add at least 1 product image before publishing.' };
    }
    if (p.unit_cost_cents <= 0) {
      return { ok: false, error: 'Cannot publish: unit cost must be greater than US$ 0.00.' };
    }
    if (!p.routes.some((r) => r.is_active)) {
      return { ok: false, error: 'Cannot publish: add at least 1 active shipping route before publishing.' };
    }
    if (p.supplier_id) {
      const sb = await createClient();
      const { data: sup } = await sb
        .from('suppliers')
        .select('verified, archived_at')
        .eq('id', p.supplier_id)
        .maybeSingle();
      if (!sup || !sup.verified || sup.archived_at) {
        return { ok: false, error: 'Cannot publish: selected supplier is not verified or is archived.' };
      }
    } else if (p.source_type === 'partner_supplier') {
      return { ok: false, error: 'Cannot publish: select a verified supplier for partner-supplier products.' };
    }
  }

  const sb = await createClient();
  const isNew = !p.id;
  let beforeSnap: unknown = null;
  if (p.id) {
    const { data } = await sb.from('dropship_products').select('*').eq('id', p.id).maybeSingle();
    beforeSnap = data;
  }

  const payload = {
    octopus_sku: p.octopus_sku.trim().toUpperCase(),
    title: p.title.trim(),
    description: p.description?.trim() || null,
    category: p.category?.trim() || null,
    images: p.images,
    specs: p.specs,
    weight_g: p.weight_g,
    dimensions_cm: p.dimensions_cm ?? null,
    unit_cost_cents: p.unit_cost_cents,
    min_order_qty: p.min_order_qty,
    stock_status: p.stock_status,
    stock_qty: p.stock_qty ?? null,
    source_type: p.source_type,
    supplier_id: p.supplier_id || null,
    supplier_sku: p.supplier_sku?.trim() || null,
    origin_country: p.origin_country.toUpperCase(),
    status: p.status,
    ...(isNew ? { created_by: staff.session.userId } : {}),
  };

  let prodId = p.id ?? '';
  if (isNew) {
    const { data, error } = await sb.from('dropship_products').insert(payload).select('id').single();
    if (error) return { ok: false, error: error.message };
    prodId = data.id as string;
  } else {
    const { error } = await sb.from('dropship_products').update(payload).eq('id', prodId);
    if (error) return { ok: false, error: error.message };
  }

  // Replace variants and routes for this product
  await sb.from('dropship_variants').delete().eq('product_id', prodId);
  if (p.variants.length > 0) {
    const { error: vErr } = await sb.from('dropship_variants').insert(
      p.variants.map((v, idx) => ({
        product_id: prodId,
        octopus_sku: v.octopus_sku.trim().toUpperCase(),
        options: v.options,
        cost_cents: v.cost_cents,
        price_adjust_cents: v.price_adjust_cents,
        stock_status: v.stock_status,
        stock_qty: v.stock_qty ?? null,
        sort: idx,
      })),
    );
    if (vErr) return { ok: false, error: `Variants: ${vErr.message}` };
  }

  await sb.from('dropship_routes').delete().eq('product_id', prodId);
  if (p.routes.length > 0) {
    const { error: rErr } = await sb.from('dropship_routes').insert(
      p.routes.map((r) => ({
        product_id: prodId,
        destination_country: r.destination_country.toUpperCase(),
        shipping_method: r.shipping_method,
        landed_price_cents: r.landed_price_cents,
        est_shipping_cents: r.est_shipping_cents,
        est_duties_cents: r.est_duties_cents,
        est_days_min: r.est_days_min,
        est_days_max: r.est_days_max,
        carrier: r.carrier?.trim() || null,
        is_active: r.is_active,
      })),
    );
    if (rErr) return { ok: false, error: `Routes: ${rErr.message}` };
  }

  const prevStatus = (beforeSnap as { status?: string } | null)?.status;
  const action = isNew
    ? 'dropship.product_created'
    : p.status === 'active' && prevStatus !== 'active'
      ? 'dropship.product_published'
      : p.status === 'archived' && prevStatus !== 'archived'
        ? 'dropship.product_archived'
        : 'dropship.product_updated';

  await writeAudit({
    actorId: staff.session.userId,
    action,
    entityId: prodId,
    before: beforeSnap,
    after: { ...payload, variants_count: p.variants.length, routes_count: p.routes.length },
    details: { octopus_sku: payload.octopus_sku, status: payload.status },
  });

  revalidatePath('/office/dropship');
  revalidatePath(`/office/dropship/${prodId}`);
  revalidatePath('/account/dropship/catalogue');
  return { ok: true, id: prodId };
}

/** Upload an image to dropship-media: verify magic bytes, strip EXIF with sharp, rename to random UUID. */
export async function uploadDropshipImage(
  formData: FormData,
): Promise<{ ok: true; url: string; alt: string } | { ok: false; error: string }> {
  const staff = await requireDropshipStaff(true);
  const file = formData.get('file');
  const title = String(formData.get('title') ?? '').trim();
  const productId = String(formData.get('product_id') ?? 'draft').trim();
  if (!(file instanceof File)) return { ok: false, error: 'Choose an image file.' };
  if (file.size <= 0) return { ok: false, error: 'Image file is empty.' };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'Image exceeds 5 MB limit.' };
  }

  const rawBuf = new Uint8Array(await file.arrayBuffer());
  const mime = await detectImageMime(rawBuf);
  if (!mime) {
    return {
      ok: false,
      error: 'Unsupported image format. Only real JPG, PNG and WebP files are accepted.',
    };
  }

  // White-label check on generated alt text (derived from product title)
  const alt = title || 'Product image';
  const wlHits = await checkWhiteLabelStrings([alt]);
  if (wlHits.length > 0) {
    return {
      ok: false,
      error: `White-label guard rejected image alt text: ${wlHits.join(', ')}`,
    };
  }

  let reencoded: { bytes: Buffer; ext: 'jpg' | 'png' | 'webp'; contentType: string };
  try {
    reencoded = await reencodeStripExif(rawBuf, mime);
  } catch (e) {
    return { ok: false, error: `Could not process image: ${(e as Error).message}` };
  }

  const folder = /^[0-9a-f-]{36}$/i.test(productId) ? productId : 'uploads';
  const key = `${folder}/${randomUUID()}.${reencoded.ext}`;
  const admin = createAdminClient();
  const up = await admin.storage.from('dropship-media').upload(key, reencoded.bytes, {
    contentType: reencoded.contentType,
    upsert: false,
  });
  if (up.error) return { ok: false, error: up.error.message };

  const publicUrl = admin.storage.from('dropship-media').getPublicUrl(key).data.publicUrl;
  await writeAudit({
    actorId: staff.session.userId,
    action: 'dropship.image_uploaded',
    entityId: folder,
    details: { key, bytes: reencoded.bytes.byteLength, content_type: reencoded.contentType },
  });

  return { ok: true, url: publicUrl, alt };
}

/** Bulk archive selected products. */
export async function bulkArchiveDropshipProducts(formData: FormData) {
  const staff = await requireDropshipStaff(true);
  const ids = formData
    .getAll('ids')
    .map((x) => String(x).trim())
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return;

  const sb = await createClient();
  await sb.from('dropship_products').update({ status: 'archived' }).in('id', ids);
  for (const id of ids) {
    await writeAudit({
      actorId: staff.session.userId,
      action: 'dropship.product_archived',
      entityId: id,
      details: { bulk: true },
    });
  }
  revalidatePath('/office/dropship');
  revalidatePath('/account/dropship/catalogue');
}

/** Rate-card estimate helper for the staff Add/Edit product routes table. */
export async function estimateRouteFromRateCard(params: {
  weight_g: number;
  unit_cost_cents: number;
  country: string;
  method: 'express' | 'standard' | 'economy';
}) {
  await requireDropshipStaff(false);
  const sb = await createClient();
  const { data, error } = await sb.rpc('dropship_rate_estimate', {
    p_weight_g: Math.max(1, Math.round(params.weight_g || 250)),
    p_unit_cost_cents: Math.max(0, Math.round(params.unit_cost_cents || 0)),
    p_country: params.country,
    p_method: params.method,
  });
  if (error || !data) return null;
  return data as {
    country: string;
    shipping_method: string;
    est_shipping_cents: number;
    est_duties_cents: number;
    fee_cents: number;
    est_days_min: number;
    est_days_max: number;
  };
}

// ───────── CSV Bulk Import (preview & commit, upsert on octopus_sku, max 2,000 rows, no image URLs, stays Draft) ─────────
export type CsvRowPreview = {
  rowNumber: number;
  octopus_sku: string;
  title: string;
  description: string;
  category: string;
  weight_g: number;
  unit_cost_cents: number;
  min_order_qty: number;
  stock_status: 'in_stock' | 'low' | 'out';
  stock_qty: number | null;
  source_type: 'own_warehouse' | 'partner_supplier';
  supplier_code: string;
  supplier_id: string | null;
  supplier_sku: string;
  origin_country: string;
  specs: Record<string, string>;
  errors: string[];
};

export type CsvPreviewResult = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: CsvRowPreview[];
  globalError?: string;
};

/** Parse RFC-4180 CSV into rows of string cells. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

export async function previewDropshipCsv(csvText: string): Promise<CsvPreviewResult> {
  await requireDropshipStaff(true);
  const matrix = parseCsvText(csvText);
  if (matrix.length < 2) {
    return {
      totalRows: 0,
      validRows: 0,
      errorRows: 0,
      rows: [],
      globalError: 'CSV file is empty or missing data rows.',
    };
  }
  const headers = matrix[0].map((h) => sanitiseCsvCell(h).toLowerCase());
  const dataRows = matrix.slice(1);
  if (dataRows.length > 2000) {
    return {
      totalRows: dataRows.length,
      validRows: 0,
      errorRows: dataRows.length,
      rows: [],
      globalError: `File has ${dataRows.length} rows; maximum is 2,000 rows per file.`,
    };
  }

  // Reject any image URL column in the CSV (we never fetch files from outside sites)
  if (headers.some((h) => /image|photo|img_url|picture/i.test(h))) {
    return {
      totalRows: dataRows.length,
      validRows: 0,
      errorRows: dataRows.length,
      rows: [],
      globalError:
        'Image columns/URLs are not allowed in the CSV import. Remove the image column and upload product photos in the form after importing.',
    };
  }

  const sb = await createClient();
  const { data: sups } = await sb
    .from('suppliers')
    .select('id, code, legal_name, verified, archived_at');
  const supByCode = new Map(
    (sups ?? []).map((s) => [String(s.code).toUpperCase().trim(), s]),
  );

  const idx = (name: string) => headers.indexOf(name);
  const cell = (r: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? sanitiseCsvCell(r[i] ?? '') : '';
  };

  const previews: CsvRowPreview[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNumber = i + 2;
    const errors: string[] = [];

    const octopus_sku = cell(r, 'octopus_sku').toUpperCase();
    const title = cell(r, 'title');
    const description = cell(r, 'description');
    const category = cell(r, 'category');
    const weightRaw = cell(r, 'weight_g');
    const costRaw = cell(r, 'unit_cost_cents');
    const moqRaw = cell(r, 'min_order_qty') || '1';
    const stockStatusRaw = (cell(r, 'stock_status') || 'in_stock').toLowerCase();
    const stockQtyRaw = cell(r, 'stock_qty');
    const sourceTypeRaw = (cell(r, 'source_type') || 'partner_supplier').toLowerCase();
    const supplierCode = cell(r, 'supplier_code').toUpperCase();
    const supplierSku = cell(r, 'supplier_sku');
    const originCountry = (cell(r, 'origin_country') || 'CN').toUpperCase();
    const specsRaw = cell(r, 'specs_json');

    if (!octopus_sku || octopus_sku.length < 2) errors.push('octopus_sku is required');
    if (!title || title.length < 3) errors.push('title is required (min 3 chars)');

    // Reject external URLs in any cell
    if (r.some((c) => /https?:\/\/\S+\.(jpg|jpeg|png|webp|gif)/i.test(c))) {
      errors.push('External image URLs are not allowed in CSV cells');
    }

    const weight_g = /^\d+$/.test(weightRaw) ? Number(weightRaw) : 0;
    if (weight_g <= 0) errors.push('weight_g must be a positive integer');

    const unit_cost_cents = /^\d+$/.test(costRaw) ? Number(costRaw) : -1;
    if (unit_cost_cents < 0) errors.push('unit_cost_cents must be a non-negative integer (US$ cents)');

    const min_order_qty = /^\d+$/.test(moqRaw) && Number(moqRaw) >= 1 ? Number(moqRaw) : 0;
    if (min_order_qty < 1) errors.push('min_order_qty must be ≥ 1');

    if (!['in_stock', 'low', 'out'].includes(stockStatusRaw)) {
      errors.push('stock_status must be in_stock, low or out');
    }
    const stock_qty =
      stockQtyRaw === '' ? null : /^\d+$/.test(stockQtyRaw) ? Number(stockQtyRaw) : -1;
    if (stock_qty === -1) errors.push('stock_qty must be an integer or blank');

    if (!['own_warehouse', 'partner_supplier'].includes(sourceTypeRaw)) {
      errors.push('source_type must be own_warehouse or partner_supplier');
    }

    let supplier_id: string | null = null;
    if (supplierCode) {
      const s = supByCode.get(supplierCode);
      if (!s) errors.push(`supplier_code ${supplierCode} not found`);
      else if (!s.verified || s.archived_at) errors.push(`supplier ${supplierCode} is not verified or is archived`);
      else supplier_id = s.id as string;
    } else if (sourceTypeRaw === 'partner_supplier') {
      errors.push('supplier_code is required for partner_supplier products');
    }

    if (!/^[A-Z]{2}$/.test(originCountry)) {
      errors.push('origin_country must be a 2-letter ISO code (e.g. CN)');
    }

    let specs: Record<string, string> = {};
    if (specsRaw) {
      try {
        const parsedSpecs = JSON.parse(specsRaw);
        if (!parsedSpecs || typeof parsedSpecs !== 'object' || Array.isArray(parsedSpecs)) {
          errors.push('specs_json must be a JSON object');
        } else {
          specs = Object.fromEntries(
            Object.entries(parsedSpecs).map(([k, v]) => [
              sanitiseCsvCell(k),
              sanitiseCsvCell(String(v ?? '')),
            ]),
          );
        }
      } catch {
        errors.push('specs_json is not valid JSON');
      }
    }

    if (
      supplierSku &&
      supplierSku.length >= 3 &&
      octopus_sku.toLowerCase().includes(supplierSku.toLowerCase())
    ) {
      errors.push('White-label guard: octopus_sku must not contain supplier_sku');
    }

    const wlHits = await checkWhiteLabelStrings([
      octopus_sku,
      title,
      description,
      ...Object.entries(specs).flatMap(([k, v]) => [k, v]),
    ]);
    if (wlHits.length > 0) {
      errors.push(`White-label guard: contains ${wlHits.join(', ')}`);
    }

    previews.push({
      rowNumber,
      octopus_sku,
      title,
      description,
      category,
      weight_g: Math.max(1, weight_g),
      unit_cost_cents: Math.max(0, unit_cost_cents),
      min_order_qty: Math.max(1, min_order_qty),
      stock_status: (['in_stock', 'low', 'out'].includes(stockStatusRaw)
        ? stockStatusRaw
        : 'in_stock') as 'in_stock' | 'low' | 'out',
      stock_qty: stock_qty !== null && stock_qty >= 0 ? stock_qty : null,
      source_type: (['own_warehouse', 'partner_supplier'].includes(sourceTypeRaw)
        ? sourceTypeRaw
        : 'partner_supplier') as 'own_warehouse' | 'partner_supplier',
      supplier_code: supplierCode,
      supplier_id,
      supplier_sku: supplierSku,
      origin_country: /^[A-Z]{2}$/.test(originCountry) ? originCountry : 'CN',
      specs,
      errors,
    });
  }

  const errorRows = previews.filter((p) => p.errors.length > 0).length;
  return {
    totalRows: previews.length,
    validRows: previews.length - errorRows,
    errorRows,
    rows: previews,
  };
}

/** Commit a validated CSV bulk import: idempotent upsert on octopus_sku; imported products stay Draft until images are added. */
export async function commitDropshipCsv(
  csvText: string,
): Promise<
  | { ok: true; created: number; updated: number; unchanged: number }
  | { ok: false; error: string }
> {
  const staff = await requireDropshipStaff(true);
  const preview = await previewDropshipCsv(csvText);
  if (preview.globalError) return { ok: false, error: preview.globalError };
  if (preview.totalRows === 0) return { ok: false, error: 'No rows to import.' };
  if (preview.errorRows > 0) {
    return {
      ok: false,
      error: `Fix the ${preview.errorRows} row error(s) shown in the preview before importing.`,
    };
  }

  const sb = await createClient();
  const skus = preview.rows.map((r) => r.octopus_sku);
  const { data: existingRows } = await sb
    .from('dropship_products')
    .select(
      'id, octopus_sku, title, description, category, specs, weight_g, unit_cost_cents, min_order_qty, stock_status, stock_qty, source_type, supplier_id, supplier_sku, origin_country, status',
    )
    .in('octopus_sku', skus);

  const bySku = new Map(
    (existingRows ?? []).map((r) => [String(r.octopus_sku).toUpperCase(), r]),
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of preview.rows) {
    const cur = bySku.get(row.octopus_sku);
    const next = {
      octopus_sku: row.octopus_sku,
      title: row.title,
      description: row.description || null,
      category: row.category || null,
      specs: row.specs,
      weight_g: row.weight_g,
      unit_cost_cents: row.unit_cost_cents,
      min_order_qty: row.min_order_qty,
      stock_status: row.stock_status,
      stock_qty: row.stock_qty,
      source_type: row.source_type,
      supplier_id: row.supplier_id,
      supplier_sku: row.supplier_sku || null,
      origin_country: row.origin_country,
    };

    if (!cur) {
      const { data: ins, error } = await sb
        .from('dropship_products')
        .insert({
          ...next,
          images: [],
          status: 'draft', // Imported products stay Draft until images are added in the form
          created_by: staff.session.userId,
        })
        .select('id')
        .single();
      if (error) return { ok: false, error: `Row ${row.rowNumber} (${row.octopus_sku}): ${error.message}` };
      created++;
      await writeAudit({
        actorId: staff.session.userId,
        action: 'dropship.csv_imported',
        entityId: ins.id as string,
        after: { ...next, status: 'draft' },
        details: { octopus_sku: row.octopus_sku, op: 'create' },
      });
    } else {
      const same =
        cur.title === next.title &&
        (cur.description ?? null) === next.description &&
        (cur.category ?? null) === next.category &&
        JSON.stringify(cur.specs ?? {}) === JSON.stringify(next.specs) &&
        Number(cur.weight_g) === next.weight_g &&
        Number(cur.unit_cost_cents) === next.unit_cost_cents &&
        Number(cur.min_order_qty) === next.min_order_qty &&
        cur.stock_status === next.stock_status &&
        (cur.stock_qty ?? null) === next.stock_qty &&
        cur.source_type === next.source_type &&
        (cur.supplier_id ?? null) === next.supplier_id &&
        (cur.supplier_sku ?? null) === next.supplier_sku &&
        String(cur.origin_country).trim() === next.origin_country;

      if (same) {
        unchanged++;
        continue;
      }

      const { error } = await sb
        .from('dropship_products')
        .update(next)
        .eq('id', cur.id as string);
      if (error) return { ok: false, error: `Row ${row.rowNumber} (${row.octopus_sku}): ${error.message}` };
      updated++;
      await writeAudit({
        actorId: staff.session.userId,
        action: 'dropship.csv_imported',
        entityId: cur.id as string,
        before: cur,
        after: next,
        details: { octopus_sku: row.octopus_sku, op: 'update' },
      });
    }
  }

  revalidatePath('/office/dropship');
  revalidatePath('/account/dropship/catalogue');
  return { ok: true, created, updated, unchanged };
}
