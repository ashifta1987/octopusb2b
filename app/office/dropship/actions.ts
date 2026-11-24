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
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
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

export type SourcingSupplierProductOption = {
  supplier_product_id: string;
  sourcing_product_id: string;
  sourcing_sku: string | null;
  sourcing_title: string;
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  supplier_model: string | null;
  unit_cost_cents: number;
};

const VariantInputSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  options: z.record(z.string(), z.string()),
  supplier_product_id: z.string().uuid().optional().nullable(),
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
  min_order_qty: z.number().int().min(1).max(100_000),
  stock_status: z.enum(['in_stock', 'low', 'out']),
  stock_qty: z.number().int().min(0).max(10_000_000).nullable().optional(),
  source_type: z.enum(['own_warehouse', 'partner_supplier']),
  default_supplier_product_id: z.string().uuid().nullable().optional(),
  origin_country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'Origin country must be blank or a 2-letter ISO code')
    .nullable()
    .optional(),
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

/** Save (create or update) a dropship product, its variants (in place so DS-XXXXXX-NN model_no is never reused), item_master, and routes. */
export async function saveDropshipProduct(
  raw: ProductInput,
): Promise<{ ok: true; id: string; model_no: string } | { ok: false; error: string }> {
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

  // White-label guard: title, description, specs, variant options, and generated alt text
  const candidateTexts: string[] = [
    p.title,
    p.description ?? '',
    ...Object.entries(p.specs).flatMap(([k, v]) => [k, v]),
    ...p.variants.flatMap((v) => Object.entries(v.options).flatMap(([k, val]) => [k, val])),
  ];
  const wlHits = await checkWhiteLabelStrings(candidateTexts);
  if (wlHits.length > 0) {
    return {
      ok: false,
      error: `White-label guard rejected save — supplier identifier found: ${wlHits.join(', ')}`,
    };
  }

  // Ensure every product has at least 1 variant row (Item 4)
  const effectiveVariants =
    p.variants.length > 0
      ? p.variants.map((v) => ({
          ...v,
          supplier_product_id: v.supplier_product_id || p.default_supplier_product_id || null,
        }))
      : [
          {
            id: null,
            options: {} as Record<string, string>,
            supplier_product_id: p.default_supplier_product_id || null,
            price_adjust_cents: 0,
            stock_status: p.stock_status,
            stock_qty: p.stock_qty ?? null,
          },
        ];

  const sb = await createClient();

  // Validate linked Sourcing supplier_products when publishing
  if (p.status === 'active') {
    if (!p.title.trim()) {
      return { ok: false, error: 'Cannot publish: product must have a title.' };
    }
    if (p.images.length < 1) {
      return { ok: false, error: 'Cannot publish: add at least 1 product image before publishing.' };
    }
    if (!p.routes.some((r) => r.is_active)) {
      return { ok: false, error: 'Cannot publish: add at least 1 active shipping route before publishing.' };
    }

    const spIds = [...new Set(effectiveVariants.map((v) => v.supplier_product_id).filter((x): x is string => !!x))];
    if (p.source_type === 'partner_supplier' && spIds.length === 0) {
      return {
        ok: false,
        error: 'Cannot publish: link at least one variant to a verified Sourcing supplier product.',
      };
    }
    if (spIds.length > 0) {
      const { data: sps } = await sb.rpc('list_sourcing_supplier_products', { p_limit: 1000 });
      const byId = new Map(
        ((sps ?? []) as SourcingSupplierProductOption[]).map((x) => [x.supplier_product_id, x]),
      );
      for (const spId of spIds) {
        const hit = byId.get(spId);
        if (!hit) {
          return {
            ok: false,
            error: 'Cannot publish: linked Sourcing supplier product is not from a verified active supplier.',
          };
        }
        if (Number(hit.unit_cost_cents ?? 0) <= 0) {
          return {
            ok: false,
            error: 'Cannot publish: linked Sourcing supplier product has no cost > US$ 0.00.',
          };
        }
      }
    }
  }

  const isNew = !p.id;
  let beforeSnap: Record<string, unknown> | null = null;
  if (p.id) {
    const { data } = await sb
      .from('dropship_products')
      .select('id, model_no, title, description, category, images, specs, weight_g, dimensions_cm, min_order_qty, stock_status, stock_qty, source_type, origin_country, status')
      .eq('id', p.id)
      .maybeSingle();
    beforeSnap = (data as Record<string, unknown> | null) ?? null;
  }

  const cleanOrigin =
    p.origin_country && /^[A-Z]{2}$/.test(p.origin_country.trim().toUpperCase())
      ? p.origin_country.trim().toUpperCase()
      : null;

  // Never write octopus_sku or frozen supplier_id / supplier_sku / unit_cost_cents
  const payload = {
    title: p.title.trim(),
    description: p.description?.trim() || null,
    category: p.category?.trim() || null,
    images: p.images,
    specs: p.specs,
    weight_g: p.weight_g,
    dimensions_cm: p.dimensions_cm ?? null,
    min_order_qty: p.min_order_qty,
    stock_status: p.stock_status,
    stock_qty: p.stock_qty ?? null,
    source_type: p.source_type,
    origin_country: cleanOrigin,
    status: p.status,
    ...(isNew ? { created_by: staff.session.userId } : {}),
  };

  let prodId = p.id ?? '';
  let modelNo = String(beforeSnap?.model_no ?? '');
  if (isNew) {
    const { data, error } = await sb
      .from('dropship_products')
      .insert(payload)
      .select('id, model_no')
      .single();
    if (error) return { ok: false, error: error.message };
    prodId = data.id as string;
    modelNo = data.model_no as string;
  } else {
    const { error } = await sb.from('dropship_products').update(payload).eq('id', prodId);
    if (error) return { ok: false, error: error.message };
  }

  // Update variants IN PLACE so existing variant model_no (DS-XXXXXX-NN) and item_id are preserved,
  // and deleted variant numbers are never reused.
  const { data: existingVars } = await sb
    .from('dropship_variants')
    .select('id, item_id, model_no')
    .eq('product_id', prodId);
  const existingById = new Map((existingVars ?? []).map((v) => [String(v.id), v]));
  const keptIds = new Set(
    effectiveVariants.map((v) => v.id).filter((x): x is string => !!x && existingById.has(x)),
  );
  const removedIds = [...existingById.keys()].filter((id) => !keptIds.has(id));
  if (removedIds.length > 0) {
    const { error: delErr } = await sb.from('dropship_variants').delete().in('id', removedIds);
    if (delErr) return { ok: false, error: `Variants delete: ${delErr.message}` };
  }

  for (let idx = 0; idx < effectiveVariants.length; idx++) {
    const v = effectiveVariants[idx];
    if (v.id && existingById.has(v.id)) {
      const { error: uErr } = await sb
        .from('dropship_variants')
        .update({
          options: v.options,
          supplier_product_id: v.supplier_product_id ?? null,
          price_adjust_cents: v.price_adjust_cents,
          stock_status: v.stock_status,
          stock_qty: v.stock_qty ?? null,
          sort: idx,
        })
        .eq('id', v.id);
      if (uErr) return { ok: false, error: `Variants update: ${uErr.message}` };
    } else {
      const { error: iErr } = await sb.from('dropship_variants').insert({
        product_id: prodId,
        options: v.options,
        supplier_product_id: v.supplier_product_id ?? null,
        price_adjust_cents: v.price_adjust_cents,
        stock_status: v.stock_status,
        stock_qty: v.stock_qty ?? null,
        sort: idx,
      });
      if (iErr) return { ok: false, error: `Variants insert: ${iErr.message}` };
    }
  }

  // Sync authoritative physical fields onto each variant's item_master row (Item 6)
  const { data: currentVars } = await sb
    .from('dropship_variants')
    .select('item_id')
    .eq('product_id', prodId);
  const itemIds = (currentVars ?? []).map((v) => String(v.item_id)).filter(Boolean);
  if (itemIds.length > 0) {
    const dims = p.dimensions_cm ?? null;
    await sb
      .from('item_master')
      .update({
        origin_country: cleanOrigin,
        weight_g: p.weight_g,
        box_l_cm: dims?.l && dims.l > 0 ? dims.l : null,
        box_w_cm: dims?.w && dims.w > 0 ? dims.w : null,
        box_h_cm: dims?.h && dims.h > 0 ? dims.h : null,
      })
      .in('id', itemIds);
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
    after: { ...payload, model_no: modelNo, variants_count: effectiveVariants.length, routes_count: p.routes.length },
    details: { model_no: modelNo, status: payload.status },
  });

  revalidatePath('/office/dropship');
  revalidatePath(`/office/dropship/${prodId}`);
  revalidatePath('/account/dropship/catalogue');
  return { ok: true, id: prodId, model_no: modelNo };
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

// ───────── CSV Bulk Import (preview & commit, idempotent on import_ref / legacy_sku, auto-assigns DS-XXXXXX model_no) ─────────
export type CsvRowPreview = {
  rowNumber: number;
  import_ref: string;
  title: string;
  description: string;
  category: string;
  weight_g: number;
  min_order_qty: number;
  stock_status: 'in_stock' | 'low' | 'out';
  stock_qty: number | null;
  source_type: 'own_warehouse' | 'partner_supplier';
  sourcing_sku: string;
  supplier_product_id: string | null;
  supplier_code: string;
  unit_cost_cents: number;
  origin_country: string | null;
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
  const { data: sps } = await sb.rpc('list_sourcing_supplier_products', { p_limit: 1000 });
  const spList = (sps ?? []) as SourcingSupplierProductOption[];
  const spBySku = new Map<string, SourcingSupplierProductOption>();
  for (const sp of spList) {
    if (sp.sourcing_sku) spBySku.set(sp.sourcing_sku.toUpperCase().trim(), sp);
  }

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

    const import_ref = cell(r, 'import_ref').toUpperCase();
    const title = cell(r, 'title');
    const description = cell(r, 'description');
    const category = cell(r, 'category');
    const weightRaw = cell(r, 'weight_g');
    const moqRaw = cell(r, 'min_order_qty') || '1';
    const stockStatusRaw = (cell(r, 'stock_status') || 'in_stock').toLowerCase();
    const stockQtyRaw = cell(r, 'stock_qty');
    const sourceTypeRaw = (cell(r, 'source_type') || 'partner_supplier').toLowerCase();
    const sourcingSku = cell(r, 'sourcing_sku').toUpperCase();
    const originCountryRaw = cell(r, 'origin_country').toUpperCase();
    const specsRaw = cell(r, 'specs_json');

    if (!import_ref || import_ref.length < 2) errors.push('import_ref is required');
    if (!title || title.length < 3) errors.push('title is required (min 3 chars)');

    if (r.some((c) => /https?:\/\/\S+\.(jpg|jpeg|png|webp|gif)/i.test(c))) {
      errors.push('External image URLs are not allowed in CSV cells');
    }

    const weight_g = /^\d+$/.test(weightRaw) ? Number(weightRaw) : 0;
    if (weight_g <= 0) errors.push('weight_g must be a positive integer');

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

    let supplier_product_id: string | null = null;
    let supplier_code = '';
    let unit_cost_cents = 0;
    if (sourcingSku) {
      const sp = spBySku.get(sourcingSku);
      if (!sp) {
        errors.push(`sourcing_sku ${sourcingSku} not found on a verified active supplier`);
      } else {
        supplier_product_id = sp.supplier_product_id;
        supplier_code = sp.supplier_code;
        unit_cost_cents = Number(sp.unit_cost_cents ?? 0);
      }
    } else if (sourceTypeRaw === 'partner_supplier') {
      errors.push('sourcing_sku is required for partner_supplier products');
    }

    // Item 1: origin_country is nullable with NO 'CN' default; blank = null
    let origin_country: string | null = null;
    if (originCountryRaw !== '') {
      if (!/^[A-Z]{2}$/.test(originCountryRaw)) {
        errors.push('origin_country must be blank or a 2-letter ISO code');
      } else {
        origin_country = originCountryRaw;
      }
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

    const wlHits = await checkWhiteLabelStrings([
      title,
      description,
      ...Object.entries(specs).flatMap(([k, v]) => [k, v]),
    ]);
    if (wlHits.length > 0) {
      errors.push(`White-label guard: contains ${wlHits.join(', ')}`);
    }

    previews.push({
      rowNumber,
      import_ref,
      title,
      description,
      category,
      weight_g: Math.max(1, weight_g),
      min_order_qty: Math.max(1, min_order_qty),
      stock_status: (['in_stock', 'low', 'out'].includes(stockStatusRaw)
        ? stockStatusRaw
        : 'in_stock') as 'in_stock' | 'low' | 'out',
      stock_qty: stock_qty !== null && stock_qty >= 0 ? stock_qty : null,
      source_type: (['own_warehouse', 'partner_supplier'].includes(sourceTypeRaw)
        ? sourceTypeRaw
        : 'partner_supplier') as 'own_warehouse' | 'partner_supplier',
      sourcing_sku: sourcingSku,
      supplier_product_id,
      supplier_code,
      unit_cost_cents,
      origin_country,
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

/** Commit a validated CSV bulk import: idempotent upsert on legacy_sku (import_ref); auto-assigns DS-XXXXXX model_no. */
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
  const refs = preview.rows.map((r) => r.import_ref);
  const { data: existingRows } = await sb
    .from('dropship_products')
    .select(
      'id, model_no, legacy_sku, title, description, category, specs, weight_g, min_order_qty, stock_status, stock_qty, source_type, origin_country, status',
    )
    .in('legacy_sku', refs);

  const existingIds = (existingRows ?? []).map((r) => String(r.id));
  const { data: existingVars } = existingIds.length
    ? await sb
        .from('dropship_variants')
        .select('id, product_id, item_id, supplier_product_id, sort')
        .in('product_id', existingIds)
        .order('sort', { ascending: true })
    : { data: [] };

  const firstVarByProd = new Map<string, { id: string; item_id: string; supplier_product_id: string | null }>();
  for (const v of existingVars ?? []) {
    const pid = String(v.product_id);
    if (!firstVarByProd.has(pid)) {
      firstVarByProd.set(pid, {
        id: String(v.id),
        item_id: String(v.item_id),
        supplier_product_id: (v.supplier_product_id as string | null) ?? null,
      });
    }
  }

  const byRef = new Map(
    (existingRows ?? []).map((r) => [String(r.legacy_sku).toUpperCase(), r]),
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of preview.rows) {
    const cur = byRef.get(row.import_ref);
    const next = {
      legacy_sku: row.import_ref,
      title: row.title,
      description: row.description || null,
      category: row.category || null,
      specs: row.specs,
      weight_g: row.weight_g,
      min_order_qty: row.min_order_qty,
      stock_status: row.stock_status,
      stock_qty: row.stock_qty,
      source_type: row.source_type,
      origin_country: row.origin_country,
    };

    if (!cur) {
      const { data: ins, error } = await sb
        .from('dropship_products')
        .insert({
          ...next,
          images: [],
          status: 'draft',
          created_by: staff.session.userId,
        })
        .select('id, model_no')
        .single();
      if (error) return { ok: false, error: `Row ${row.rowNumber} (${row.import_ref}): ${error.message}` };

      const { error: vErr } = await sb.from('dropship_variants').insert({
        product_id: ins.id as string,
        options: {},
        supplier_product_id: row.supplier_product_id,
        price_adjust_cents: 0,
        stock_status: row.stock_status,
        stock_qty: row.stock_qty,
        sort: 0,
      });
      if (vErr) return { ok: false, error: `Row ${row.rowNumber} (${row.import_ref}) variant: ${vErr.message}` };

      created++;
      await writeAudit({
        actorId: staff.session.userId,
        action: 'dropship.csv_imported',
        entityId: ins.id as string,
        after: { ...next, model_no: ins.model_no, supplier_product_id: row.supplier_product_id, status: 'draft' },
        details: { model_no: ins.model_no, import_ref: row.import_ref, op: 'create' },
      });
    } else {
      const curId = String(cur.id);
      const firstVar = firstVarByProd.get(curId);
      const curOrigin = cur.origin_country ? String(cur.origin_country).trim() : null;
      const same =
        cur.title === next.title &&
        (cur.description ?? null) === next.description &&
        (cur.category ?? null) === next.category &&
        JSON.stringify(cur.specs ?? {}) === JSON.stringify(next.specs) &&
        Number(cur.weight_g) === next.weight_g &&
        Number(cur.min_order_qty) === next.min_order_qty &&
        cur.stock_status === next.stock_status &&
        (cur.stock_qty ?? null) === next.stock_qty &&
        cur.source_type === next.source_type &&
        curOrigin === next.origin_country &&
        (firstVar?.supplier_product_id ?? null) === (row.supplier_product_id ?? null);

      if (same) {
        unchanged++;
        continue;
      }

      const { error } = await sb
        .from('dropship_products')
        .update(next)
        .eq('id', curId);
      if (error) return { ok: false, error: `Row ${row.rowNumber} (${row.import_ref}): ${error.message}` };

      if (firstVar) {
        await sb
          .from('dropship_variants')
          .update({
            supplier_product_id: row.supplier_product_id,
            stock_status: row.stock_status,
            stock_qty: row.stock_qty,
          })
          .eq('id', firstVar.id);
        await sb
          .from('item_master')
          .update({
            origin_country: row.origin_country,
            weight_g: row.weight_g,
          })
          .eq('id', firstVar.item_id);
      }

      updated++;
      await writeAudit({
        actorId: staff.session.userId,
        action: 'dropship.csv_imported',
        entityId: curId,
        before: cur,
        after: { ...next, supplier_product_id: row.supplier_product_id },
        details: { model_no: cur.model_no, import_ref: row.import_ref, op: 'update' },
      });
    }
  }

  revalidatePath('/office/dropship');
  revalidatePath('/account/dropship/catalogue');
  return { ok: true, created, updated, unchanged };
}
