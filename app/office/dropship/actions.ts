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

export type SourcingCandidateOption = {
  supplier_product_id: string;
  sourcing_product_id: string;
  sourcing_item_id: string;
  sourcing_sku: string | null;
  sourcing_title: string;
  supplier_id: string;
  supplier_code: string | null;
  supplier_name: string;
  supplier_verified: boolean;
  unit_cost_cents: number;
  rfq_id: string | null;
  rfq_code: string | null;
  for_org_id: string | null;
  for_org_name: string | null;
  existing_dropship_product_id: string | null;
  existing_dropship_model_no: string | null;
};

export type PublishChecklistResult = {
  ok: boolean;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  checks: { key: string; ok: boolean; label: string }[];
};

const VariantInputSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  options: z.record(z.string(), z.string()),
  supplier_product_id: z.string().uuid().optional().nullable(),
  price_adjust_cents: z.number().int().min(-100_000_000).max(100_000_000),
});

const RouteInputSchema = z.object({
  destination_country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  shipping_method: z.enum(['express', 'standard', 'economy']),
  incoterm: z.enum(['DDP', 'DAP']).default('DDP'),
  landed_price_cents: z.number().int().positive().max(100_000_000),
  est_shipping_cents: z.number().int().min(0).max(100_000_000),
  est_duties_cents: z.number().int().min(0).max(100_000_000),
  est_days_min: z.number().int().min(1).max(120),
  est_days_max: z.number().int().min(1).max(180),
  carrier: z.string().trim().max(120).nullable().optional(),
  is_active: z.boolean(),
});

const PriceTierInputSchema = z.object({
  min_qty: z.number().int().min(1).max(1_000_000),
  unit_price_cents: z.number().int().min(0).max(100_000_000),
});

const ProductInputSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(3, 'Title is required').max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  images: z.array(z.string().trim().min(1)).max(MAX_IMAGES_PER_PRODUCT),
  flagged_images: z.array(z.string().trim().min(1)).max(MAX_IMAGES_PER_PRODUCT).optional(),
  specs: z.record(z.string(), z.string()),
  weight_g: z.number().int().min(0).max(200_000),
  dimensions_cm: z
    .object({
      l: z.number().min(0).max(500).optional(),
      w: z.number().min(0).max(500).optional(),
      h: z.number().min(0).max(500).optional(),
    })
    .nullable()
    .optional(),
  min_order_qty: z.number().int().min(1).max(100_000),
  product_price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  source_type: z.enum(['own_warehouse', 'partner_supplier']),
  fulfilment_type: z.enum(['fast_ship', 'extended_catalog']).optional(),
  default_supplier_product_id: z.string().uuid().nullable().optional(),
  visible_to_org_id: z.string().uuid().nullable().optional(),
  origin_country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'Origin country must be blank or a 2-letter ISO code')
    .nullable()
    .optional(),
  hs_code: z.string().trim().max(24).nullable().optional(),
  hs_verified: z.boolean().optional(),
  has_battery: z.boolean().optional(),
  has_liquid: z.boolean().optional(),
  has_magnet: z.boolean().optional(),
  has_powder: z.boolean().optional(),
  is_fragile: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'archived']),
  variants: z.array(VariantInputSchema).max(50),
  routes: z.array(RouteInputSchema).max(100),
  price_tiers: z.array(PriceTierInputSchema).max(20).optional(),
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

function cleanPublishError(msg: string): string {
  return msg.replace(/^.*PUBLISH_BLOCKED:\s*/i, '').trim();
}

/** Save (create or update) a dropship product, its variants, shared item_master, routes, price tiers, and publish gate. */
export async function saveDropshipProduct(
  raw: ProductInput,
): Promise<
  | { ok: true; id: string; model_no: string; checklist?: PublishChecklistResult }
  | { ok: false; error: string; checklist?: PublishChecklistResult }
> {
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

  // White-label guard: title, description, specs, variant options
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
          },
        ];

  const sb = await createClient();
  const isNew = !p.id;
  let beforeSnap: Record<string, unknown> | null = null;
  if (p.id) {
    const { data } = await sb
      .from('dropship_products')
      .select(
        'id, model_no, title, description, category, images, flagged_images, specs, weight_g, dimensions_cm, min_order_qty, product_price_cents, source_type, fulfilment_type, visible_to_org_id, origin_country, status, needs_review',
      )
      .eq('id', p.id)
      .maybeSingle();
    beforeSnap = (data as Record<string, unknown> | null) ?? null;
  }

  const cleanOrigin =
    p.origin_country && /^[A-Z]{2}$/.test(p.origin_country.trim().toUpperCase())
      ? p.origin_country.trim().toUpperCase()
      : null;

  const fulfilmentType =
    p.fulfilment_type ?? (p.source_type === 'own_warehouse' ? 'fast_ship' : 'extended_catalog');

  const prevStatus = (beforeSnap as { status?: string } | null)?.status ?? 'draft';
  // Save as draft/archived first (or keep active if already active) so variants, item_master, routes, and tiers
  // are written BEFORE publish_dropship_product evaluates the authoritative DB checklist.
  const intermediateStatus: 'draft' | 'active' | 'archived' =
    p.status === 'archived'
      ? 'archived'
      : p.status === 'active' && prevStatus === 'active'
        ? 'active'
        : 'draft';

  const cleanFlagged = (p.flagged_images ?? []).filter((u) => p.images.includes(u));
  const safeWeightCol = p.weight_g && p.weight_g > 0 ? p.weight_g : 250;

  const payload = {
    title: p.title.trim(),
    description: p.description?.trim() || null,
    category: p.category?.trim() || null,
    images: p.images,
    flagged_images: cleanFlagged,
    specs: p.specs,
    weight_g: safeWeightCol,
    dimensions_cm: p.dimensions_cm ?? null,
    min_order_qty: p.min_order_qty,
    product_price_cents: p.product_price_cents ?? null,
    source_type: p.source_type,
    fulfilment_type: fulfilmentType,
    visible_to_org_id: p.visible_to_org_id || null,
    origin_country: cleanOrigin,
    has_battery: Boolean(p.has_battery),
    has_liquid: Boolean(p.has_liquid),
    status: intermediateStatus,
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

  // Update variants IN PLACE so existing DS-XXXXXX-NN model_no and item_id are preserved.
  // Correction 4: When inserting a single base variant (options = {}) linked to a Sourcing supplier_product_id,
  // reuse the Sourcing product's item_id if it is not already claimed by another dropship_variants row.
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

  const admin = createAdminClient();
  for (let idx = 0; idx < effectiveVariants.length; idx++) {
    const v = effectiveVariants[idx];
    if (v.id && existingById.has(v.id)) {
      const { error: uErr } = await sb
        .from('dropship_variants')
        .update({
          options: v.options,
          supplier_product_id: v.supplier_product_id ?? null,
          price_adjust_cents: v.price_adjust_cents,
          sort: idx,
        })
        .eq('id', v.id);
      if (uErr) return { ok: false, error: `Variants update: ${uErr.message}` };
    } else {
      let reuseItemId: string | null = null;
      if (
        effectiveVariants.length === 1 &&
        Object.keys(v.options).length === 0 &&
        v.supplier_product_id
      ) {
        const { data: spRow } = await admin
          .from('supplier_products')
          .select('product_id')
          .eq('id', v.supplier_product_id)
          .maybeSingle();
        if (spRow?.product_id) {
          const { data: srcProd } = await admin
            .from('products')
            .select('item_id')
            .eq('id', spRow.product_id)
            .maybeSingle();
          if (srcProd?.item_id) {
            const { data: claimed } = await admin
              .from('dropship_variants')
              .select('id')
              .eq('item_id', srcProd.item_id)
              .limit(1);
            if (!claimed || claimed.length === 0) {
              reuseItemId = String(srcProd.item_id);
            }
          }
        }
      }

      const { error: iErr } = await sb.from('dropship_variants').insert({
        product_id: prodId,
        options: v.options,
        supplier_product_id: v.supplier_product_id ?? null,
        ...(reuseItemId ? { item_id: reuseItemId } : {}),
        price_adjust_cents: v.price_adjust_cents,
        sort: idx,
      });
      if (iErr) return { ok: false, error: `Variants insert: ${iErr.message}` };
    }
  }

  // Sync structured physical & customs fields onto each variant's shared item_master row
  const { data: currentVars } = await sb
    .from('dropship_variants')
    .select('item_id')
    .eq('product_id', prodId);
  const itemIds = [...new Set((currentVars ?? []).map((v) => String(v.item_id)).filter(Boolean))];
  const dims = p.dimensions_cm ?? null;
  const cleanHs = p.hs_code?.trim() || null;

  for (const itemId of itemIds) {
    const { error: imErr } = await sb.rpc('update_dropship_item_master', {
      p_item_id: itemId,
      p_hs_code: cleanHs,
      p_origin_country: cleanOrigin,
      p_weight_g: p.weight_g && p.weight_g > 0 ? p.weight_g : null,
      p_box_l_cm: dims?.l && dims.l > 0 ? dims.l : null,
      p_box_w_cm: dims?.w && dims.w > 0 ? dims.w : null,
      p_box_h_cm: dims?.h && dims.h > 0 ? dims.h : null,
      p_has_battery: Boolean(p.has_battery),
      p_has_liquid: Boolean(p.has_liquid),
      p_has_magnet: Boolean(p.has_magnet),
      p_has_powder: Boolean(p.has_powder),
      p_is_fragile: Boolean(p.is_fragile),
    });
    if (imErr) return { ok: false, error: `Item master: ${imErr.message}` };

    if (p.hs_verified !== undefined) {
      if (p.hs_verified && cleanHs) {
        const { error: vErr } = await sb.rpc('verify_item_hs_code', {
          p_item_id: itemId,
          p_hs_code: cleanHs,
          p_note: 'Checked against tariff in Dropship product editor',
        });
        if (vErr) return { ok: false, error: `HS verification: ${vErr.message}` };
      } else if (!p.hs_verified) {
        await sb.rpc('unverify_item_hs_code', {
          p_item_id: itemId,
          p_reason: 'Unchecked in Dropship product editor',
        });
      }
    }
  }

  // Replace routes (including DDP vs DAP incoterm — Correction 7)
  await sb.from('dropship_routes').delete().eq('product_id', prodId);
  if (p.routes.length > 0) {
    const { error: rErr } = await sb.from('dropship_routes').insert(
      p.routes.map((r) => ({
        product_id: prodId,
        destination_country: r.destination_country.toUpperCase(),
        shipping_method: r.shipping_method,
        incoterm: r.incoterm ?? 'DDP',
        landed_price_cents: r.landed_price_cents,
        est_shipping_cents: r.est_shipping_cents,
        est_duties_cents: r.incoterm === 'DAP' ? 0 : r.est_duties_cents,
        est_days_min: r.est_days_min,
        est_days_max: r.est_days_max,
        carrier: r.carrier?.trim() || null,
        is_active: r.is_active,
      })),
    );
    if (rErr) return { ok: false, error: `Routes: ${rErr.message}` };
  }

  // Replace volume price tiers on public.dropship_price_tiers (Correction 2)
  if (p.price_tiers !== undefined) {
    await sb.from('dropship_price_tiers').delete().eq('product_id', prodId);
    const dedupTiers = new Map<number, number>();
    for (const t of p.price_tiers) {
      if (t.min_qty >= 1 && t.unit_price_cents >= 0) {
        dedupTiers.set(t.min_qty, t.unit_price_cents);
      }
    }
    if (dedupTiers.size > 0) {
      const tierRows = [...dedupTiers.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([min_qty, unit_price_cents]) => ({
          product_id: prodId,
          min_qty,
          unit_price_cents,
        }));
      const { error: tErr } = await sb.from('dropship_price_tiers').insert(tierRows);
      if (tErr) return { ok: false, error: `Price tiers: ${tErr.message}` };
    }
  }

  // Fetch updated checklist
  const { data: chkData } = await sb.rpc('get_dropship_publish_checklist', {
    p_product_id: prodId,
  });
  const checklist = (chkData as PublishChecklistResult | null) ?? undefined;

  // Authoritative publish gate when target status is 'active'
  if (p.status === 'active') {
    const { error: pubErr } = await sb.rpc('publish_dropship_product', {
      p_product_id: prodId,
    });
    if (pubErr) {
      // If product was already active and a newly introduced blocker prevents re-confirming, pause back to draft
      if (prevStatus === 'active') {
        await sb.from('dropship_products').update({ status: 'draft' }).eq('id', prodId);
      }
      return {
        ok: false,
        error: `Cannot publish: ${cleanPublishError(pubErr.message)}`,
        checklist,
      };
    }
  } else {
    const action = isNew
      ? 'dropship.product_created'
      : p.status === 'archived' && prevStatus !== 'archived'
        ? 'dropship.product_archived'
        : 'dropship.product_updated';

    await writeAudit({
      actorId: staff.session.userId,
      action,
      entityId: prodId,
      before: beforeSnap,
      after: {
        ...payload,
        status: p.status,
        model_no: modelNo,
        variants_count: effectiveVariants.length,
        routes_count: p.routes.length,
      },
      details: { model_no: modelNo, status: p.status },
    });
  }

  revalidatePath('/office/dropship');
  revalidatePath(`/office/dropship/${prodId}`);
  revalidatePath('/account/dropship/catalogue');
  return { ok: true, id: prodId, model_no: modelNo, checklist };
}

/** Quick review save/publish action from the /office/dropship HS & Missing-Data review drawer. */
export async function quickSaveDropshipReview(params: {
  productId: string;
  hsCode: string;
  originCountry: string;
  hsVerified: boolean;
  hasBattery: boolean;
  hasLiquid: boolean;
  hasMagnet: boolean;
  hasPowder: boolean;
  visibleToOrgId: string | null;
  publish?: boolean;
}): Promise<
  | { ok: true; checklist: PublishChecklistResult; published: boolean }
  | { ok: false; error: string; checklist?: PublishChecklistResult }
> {
  const staff = await requireDropshipStaff(true);
  if (!/^[0-9a-f-]{36}$/i.test(params.productId)) {
    return { ok: false, error: 'Invalid product ID.' };
  }

  const sb = await createClient();
  const cleanOrigin =
    params.originCountry && /^[A-Z]{2}$/.test(params.originCountry.trim().toUpperCase())
      ? params.originCountry.trim().toUpperCase()
      : null;
  const cleanHs = params.hsCode.trim() || null;

  const { error: pErr } = await sb
    .from('dropship_products')
    .update({
      origin_country: cleanOrigin,
      has_battery: params.hasBattery,
      has_liquid: params.hasLiquid,
      visible_to_org_id: params.visibleToOrgId || null,
    })
    .eq('id', params.productId);
  if (pErr) return { ok: false, error: pErr.message };

  const { data: vars } = await sb
    .from('dropship_variants')
    .select('item_id')
    .eq('product_id', params.productId);
  const itemIds = [...new Set((vars ?? []).map((v) => String(v.item_id)).filter(Boolean))];

  for (const itemId of itemIds) {
    const { data: curIm } = await sb
      .from('item_master')
      .select('weight_g, box_l_cm, box_w_cm, box_h_cm, is_fragile')
      .eq('id', itemId)
      .maybeSingle();

    const { error: imErr } = await sb.rpc('update_dropship_item_master', {
      p_item_id: itemId,
      p_hs_code: cleanHs,
      p_origin_country: cleanOrigin,
      p_weight_g: curIm?.weight_g ?? null,
      p_box_l_cm: curIm?.box_l_cm ?? null,
      p_box_w_cm: curIm?.box_w_cm ?? null,
      p_box_h_cm: curIm?.box_h_cm ?? null,
      p_has_battery: params.hasBattery,
      p_has_liquid: params.hasLiquid,
      p_has_magnet: params.hasMagnet,
      p_has_powder: params.hasPowder,
      p_is_fragile: Boolean(curIm?.is_fragile),
    });
    if (imErr) return { ok: false, error: imErr.message };

    if (params.hsVerified && cleanHs) {
      const { error: vErr } = await sb.rpc('verify_item_hs_code', {
        p_item_id: itemId,
        p_hs_code: cleanHs,
        p_note: 'Checked against tariff in HS review queue',
      });
      if (vErr) return { ok: false, error: vErr.message };
    } else if (!params.hsVerified) {
      await sb.rpc('unverify_item_hs_code', {
        p_item_id: itemId,
        p_reason: 'Unchecked in HS review queue',
      });
    }
  }

  const { data: chkData } = await sb.rpc('get_dropship_publish_checklist', {
    p_product_id: params.productId,
  });
  const checklist = (chkData as PublishChecklistResult | null) ?? {
    ok: false,
    ready: false,
    blockers: ['Unable to evaluate checklist'],
    warnings: [],
    checks: [],
  };

  if (checklist.ready && !params.publish) {
    await sb
      .from('dropship_products')
      .update({ needs_review: false, needs_review_reason: null })
      .eq('id', params.productId);
  }

  if (params.publish) {
    const { error: pubErr } = await sb.rpc('publish_dropship_product', {
      p_product_id: params.productId,
    });
    if (pubErr) {
      return {
        ok: false,
        error: `Cannot publish: ${cleanPublishError(pubErr.message)}`,
        checklist,
      };
    }
  } else {
    await writeAudit({
      actorId: staff.session.userId,
      action: 'dropship.review_saved',
      entityId: params.productId,
      details: { hs_code: cleanHs, hs_verified: params.hsVerified, origin_country: cleanOrigin },
    });
  }

  revalidatePath('/office/dropship');
  revalidatePath(`/office/dropship/${params.productId}`);
  revalidatePath('/account/dropship/catalogue');
  return { ok: true, checklist, published: Boolean(params.publish) };
}

/** Create a draft Dropship product directly from a Sourcing supplier_products row (reuses Sourcing item_id). */
export async function createDropshipFromSourcingAction(params: {
  supplierProductId: string;
  rfqId?: string | null;
}): Promise<
  | {
      ok: true;
      product_id: string;
      model_no: string;
      reused_sourcing_item: boolean;
      already_existed: boolean;
      visible_to_org_id: string | null;
    }
  | { ok: false; error: string }
> {
  await requireDropshipStaff(true);
  if (!/^[0-9a-f-]{36}$/i.test(params.supplierProductId)) {
    return { ok: false, error: 'Invalid Sourcing supplier product ID.' };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc('import_dropship_from_sourcing', {
    p_supplier_product_id: params.supplierProductId,
    p_rfq_id: params.rfqId && /^[0-9a-f-]{36}$/i.test(params.rfqId) ? params.rfqId : null,
  });
  if (error) {
    return { ok: false, error: error.message.replace(/^.*SUPPLIER_NOT_VERIFIED:\s*/i, '') };
  }
  const res = data as {
    product_id: string;
    model_no: string;
    reused_sourcing_item: boolean;
    already_existed: boolean;
    visible_to_org_id: string | null;
  };
  revalidatePath('/office/dropship');
  revalidatePath('/office/dropship/import');
  return {
    ok: true,
    product_id: res.product_id,
    model_no: res.model_no,
    reused_sourcing_item: Boolean(res.reused_sourcing_item),
    already_existed: Boolean(res.already_existed),
    visible_to_org_id: res.visible_to_org_id ?? null,
  };
}

/**
 * Correction 6: Upload an image to dropship-media: verify magic bytes (JPG/PNG/WebP <= 5 MB),
 * strip EXIF/GPS metadata and re-encode via sharp, and store under a PURE random UUID filename
 * (NEVER the Sourcing model no., supplier name, product ID, or original file name).
 */
export async function uploadDropshipImage(
  formData: FormData,
): Promise<{ ok: true; url: string; alt: string; key: string } | { ok: false; error: string }> {
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

  // Correction 6: Pure random UUID object key — zero trace of original filename, Sourcing SKU, or supplier
  const key = `${randomUUID()}.${reencoded.ext}`;
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
    entityId: /^[0-9a-f-]{36}$/i.test(productId) ? productId : 'draft',
    details: { key, bytes: reencoded.bytes.byteLength, content_type: reencoded.contentType },
  });

  return { ok: true, url: publicUrl, alt, key };
}

/**
 * Step 4 of /office/dropship/import: Upload multiple image files named after the Sourcing model no. or import_ref
 * (e.g. SRC-101-1.jpg), match them to draft/imported products in memory on the server, strip EXIF + re-encode via sharp,
 * and store each under a PURE random UUID filename (never storing the Sourcing model no. or original filename).
 */
export async function uploadDropshipBatchImages(formData: FormData): Promise<
  | {
      ok: true;
      matchedFiles: number;
      unmatchedFiles: number;
      rejectedFiles: string[];
      updatedProductCount: number;
    }
  | { ok: false; error: string }
> {
  const staff = await requireDropshipStaff(true);
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: 'Choose at least one image file.' };
  if (files.length > 100) return { ok: false, error: 'Upload up to 100 image files per batch.' };

  const sb = await createClient();
  const admin = createAdminClient();
  const [{ data: prods }, { data: links }] = await Promise.all([
    admin.from('dropship_products').select('id, model_no, legacy_sku, images'),
    sb.rpc('dropship_sourcing_links'),
  ]);

  const prodByKey = new Map<string, { id: string; images: string[] }>();
  const prodById = new Map<string, { id: string; images: string[] }>();
  for (const p of prods ?? []) {
    const entry = {
      id: String(p.id),
      images: Array.isArray(p.images) ? (p.images as string[]) : [],
    };
    prodById.set(entry.id, entry);
    if (p.model_no) prodByKey.set(String(p.model_no).toUpperCase(), entry);
    if (p.legacy_sku) prodByKey.set(String(p.legacy_sku).toUpperCase(), entry);
  }
  for (const l of (links ?? []) as { product_id: string; sourcing_sku: string | null }[]) {
    const entry = prodById.get(String(l.product_id));
    if (entry && l.sourcing_sku) {
      prodByKey.set(l.sourcing_sku.trim().toUpperCase(), entry);
    }
  }

  const touchedIds = new Set<string>();
  let matchedFiles = 0;
  let unmatchedFiles = 0;
  const rejectedFiles: string[] = [];

  // Sort keys longest-first so "SRC-101-A" matches before "SRC-101"
  const candidateKeys = [...prodByKey.keys()].sort((a, b) => b.length - a.length);

  for (const file of files) {
    const baseName = file.name.replace(/\.[^.]+$/, '').trim().toUpperCase();
    const matchedKey = candidateKeys.find(
      (k) => baseName === k || baseName.startsWith(`${k}-`) || baseName.startsWith(`${k}_`),
    );
    if (!matchedKey) {
      unmatchedFiles++;
      continue;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      rejectedFiles.push(`${file.name}: exceeds 5 MB`);
      continue;
    }
    const rawBuf = new Uint8Array(await file.arrayBuffer());
    const mime = await detectImageMime(rawBuf);
    if (!mime) {
      rejectedFiles.push(`${file.name}: not a real JPG, PNG or WebP image`);
      continue;
    }

    let reencoded: { bytes: Buffer; ext: 'jpg' | 'png' | 'webp'; contentType: string };
    try {
      reencoded = await reencodeStripExif(rawBuf, mime);
    } catch {
      rejectedFiles.push(`${file.name}: invalid or corrupt image data`);
      continue;
    }

    const target = prodByKey.get(matchedKey)!;
    if (target.images.length >= MAX_IMAGES_PER_PRODUCT) {
      rejectedFiles.push(`${file.name}: product already has ${MAX_IMAGES_PER_PRODUCT} images`);
      continue;
    }

    // Correction 6: Pure random UUID filename — never original name or Sourcing SKU
    const key = `${randomUUID()}.${reencoded.ext}`;
    const up = await admin.storage.from('dropship-media').upload(key, reencoded.bytes, {
      contentType: reencoded.contentType,
      upsert: false,
    });
    if (up.error) {
      rejectedFiles.push(`${file.name}: ${up.error.message}`);
      continue;
    }
    const publicUrl = admin.storage.from('dropship-media').getPublicUrl(key).data.publicUrl;
    target.images = [...target.images, publicUrl];
    touchedIds.add(target.id);
    matchedFiles++;
  }

  for (const pid of touchedIds) {
    const entry = prodById.get(pid)!;
    await sb.from('dropship_products').update({ images: entry.images }).eq('id', pid);
    await writeAudit({
      actorId: staff.session.userId,
      action: 'dropship.batch_images_uploaded',
      entityId: pid,
      details: { total_images: entry.images.length },
    });
  }

  revalidatePath('/office/dropship');
  revalidatePath('/office/dropship/import');
  return {
    ok: true,
    matchedFiles,
    unmatchedFiles,
    rejectedFiles,
    updatedProductCount: touchedIds.size,
  };
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

// ───────── CSV Bulk Import (5-step wizard: Source -> Map columns -> Check -> Images -> Result; drafts only) ─────────
export type CsvColumnMappingEntry = {
  fileColumn: string;
  octopusField: string;
  rule: string;
  status: 'matched' | 'ignored' | 'warning';
};

export type CsvRowPreview = {
  rowNumber: number;
  import_ref: string;
  title: string;
  description: string;
  category: string;
  weight_g: number;
  box_l_cm: number | null;
  box_w_cm: number | null;
  box_h_cm: number | null;
  hs_code: string | null;
  has_battery: boolean;
  has_liquid: boolean;
  has_magnet: boolean;
  has_powder: boolean;
  min_order_qty: number;
  source_type: 'own_warehouse' | 'partner_supplier';
  fulfilment_type: 'fast_ship' | 'extended_catalog';
  sourcing_sku: string;
  supplier_product_id: string | null;
  sourcing_item_id: string | null;
  supplier_code: string;
  unit_cost_cents: number;
  origin_country: string | null;
  variant_options: Record<string, string>;
  specs: Record<string, string>;
  existing_model_no: string | null;
  warnings: string[];
  errors: string[];
};

export type CsvPreviewResult = {
  totalRows: number;
  validRows: number;
  newReadyRows: number;
  updateRows: number;
  unchangedRows: number;
  errorRows: number;
  warningRows: number;
  headers: string[];
  columnMappings: CsvColumnMappingEntry[];
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

function parseBoolCell(raw: string): boolean {
  return ['1', 'true', 'yes', 'y'].includes(raw.trim().toLowerCase());
}

export async function previewDropshipCsv(
  csvText: string,
  customMap?: Record<string, string>,
): Promise<CsvPreviewResult> {
  const staff = await requireDropshipStaff(true);
  const matrix = parseCsvText(csvText);
  if (matrix.length < 2) {
    return {
      totalRows: 0,
      validRows: 0,
      newReadyRows: 0,
      updateRows: 0,
      unchangedRows: 0,
      errorRows: 0,
      warningRows: 0,
      headers: [],
      columnMappings: [],
      rows: [],
      globalError: 'CSV file is empty or missing data rows.',
    };
  }
  const rawHeaders = matrix[0].map((h) => sanitiseCsvCell(h));
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const dataRows = matrix.slice(1);
  if (dataRows.length > 2000) {
    return {
      totalRows: dataRows.length,
      validRows: 0,
      newReadyRows: 0,
      updateRows: 0,
      unchangedRows: 0,
      errorRows: dataRows.length,
      warningRows: 0,
      headers: rawHeaders,
      columnMappings: [],
      rows: [],
      globalError: `Use the CSV template. Files can have up to 2,000 rows; this one has ${dataRows.length.toLocaleString('en-US')}.`,
    };
  }

  if (headers.some((h) => /image|photo|img_url|picture/i.test(h))) {
    return {
      totalRows: dataRows.length,
      validRows: 0,
      newReadyRows: 0,
      updateRows: 0,
      unchangedRows: 0,
      errorRows: dataRows.length,
      warningRows: 0,
      headers: rawHeaders,
      columnMappings: [],
      rows: [],
      globalError:
        'Image columns/URLs are not allowed in the CSV import. Remove the image column and upload product photos in Step 4 or the editor.',
    };
  }

  const findHeader = (aliases: string[], targetKey: string): number => {
    if (customMap && customMap[targetKey]) {
      const mappedIdx = headers.indexOf(customMap[targetKey].toLowerCase());
      if (mappedIdx >= 0) return mappedIdx;
    }
    for (const a of aliases) {
      const i = headers.indexOf(a);
      if (i >= 0) return i;
    }
    return -1;
  };

  const colIdx = {
    import_ref: findHeader(['import_ref'], 'import_ref'),
    sourcing_sku: findHeader(['src_model_no', 'sourcing_sku', 'sourcing_model_no'], 'sourcing_sku'),
    title: findHeader(['product_title', 'title', 'name'], 'title'),
    description: findHeader(['description', 'desc'], 'description'),
    category: findHeader(['category'], 'category'),
    weight_g: findHeader(['weight_g', 'weight'], 'weight_g'),
    l_cm: findHeader(['l_cm', 'box_l_cm', 'length_cm'], 'l_cm'),
    w_cm: findHeader(['w_cm', 'box_w_cm', 'width_cm'], 'w_cm'),
    h_cm: findHeader(['h_cm', 'box_h_cm', 'height_cm'], 'h_cm'),
    hs_code: findHeader(['hs', 'hs_code'], 'hs_code'),
    origin_country: findHeader(['origin', 'origin_country', 'country_of_origin'], 'origin_country'),
    min_order_qty: findHeader(['min_order_qty', 'moq'], 'min_order_qty'),
    source_type: findHeader(['source_type'], 'source_type'),
    battery: findHeader(['battery', 'has_battery'], 'battery'),
    liquid: findHeader(['liquid', 'has_liquid'], 'liquid'),
    magnet: findHeader(['magnet', 'has_magnet'], 'magnet'),
    powder: findHeader(['powder', 'has_powder'], 'powder'),
    color: findHeader(['color', 'colour'], 'color'),
    size: findHeader(['size'], 'size'),
    specs_json: findHeader(['specs_json', 'specs'], 'specs_json'),
  };

  const columnMappings: CsvColumnMappingEntry[] = rawHeaders.map((rawH) => {
    const h = rawH.toLowerCase();
    if (/cost|price|supplier_name|supplier_id|status/i.test(h)) {
      return {
        fileColumn: rawH,
        octopusField: '—',
        rule: /status/i.test(h) ? 'Ignored · CSV always creates drafts' : 'From Sourcing, not the file',
        status: 'ignored',
      };
    }
    if (['src_model_no', 'sourcing_sku', 'sourcing_model_no'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Sourcing model no.', rule: 'Match key & Sourcing link', status: 'matched' };
    }
    if (h === 'import_ref') {
      return { fileColumn: rawH, octopusField: 'Import reference', rule: 'Idempotency match key', status: 'matched' };
    }
    if (['product_title', 'title', 'name'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Title', rule: 'Required', status: 'matched' };
    }
    if (['description', 'desc'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Description', rule: '', status: 'matched' };
    }
    if (h === 'category') {
      return { fileColumn: rawH, octopusField: 'Category', rule: '', status: 'matched' };
    }
    if (['weight_g', 'weight'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Weight (g)', rule: 'Required', status: 'matched' };
    }
    if (['l_cm', 'w_cm', 'h_cm', 'box_l_cm', 'box_w_cm', 'box_h_cm'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Box size (cm)', rule: 'Above 0 when provided', status: 'matched' };
    }
    if (['hs', 'hs_code'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'HS code', rule: 'Checked later by staff', status: 'matched' };
    }
    if (['origin', 'origin_country', 'country_of_origin'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Country of origin', rule: 'ISO-2 code', status: 'matched' };
    }
    if (['battery', 'liquid', 'magnet', 'powder', 'has_battery', 'has_liquid', 'has_magnet', 'has_powder'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Restricted flags', rule: '', status: 'matched' };
    }
    if (['color', 'colour', 'size'].includes(h)) {
      return { fileColumn: rawH, octopusField: 'Variant options', rule: '', status: 'matched' };
    }
    if (['min_order_qty', 'moq', 'source_type', 'specs_json', 'specs'].includes(h)) {
      return { fileColumn: rawH, octopusField: rawH, rule: '', status: 'matched' };
    }
    return { fileColumn: rawH, octopusField: '—', rule: 'Unmapped column (ignored)', status: 'ignored' };
  });

  const missingMagnetOrPowder = colIdx.magnet < 0 || colIdx.powder < 0;
  if (missingMagnetOrPowder && (colIdx.battery >= 0 || colIdx.liquid >= 0)) {
    columnMappings.push({
      fileColumn: 'magnet / powder',
      octopusField: '—',
      rule: 'Missing column: set to No',
      status: 'warning',
    });
  }

  const sb = await createClient();
  const admin = createAdminClient();
  const [{ data: candidates }, { data: existingProds }] = await Promise.all([
    sb.rpc('list_sourcing_candidates_for_dropship', { p_limit: 500 }),
    admin.from('dropship_products').select('id, model_no, legacy_sku, title, description, category, weight_g, min_order_qty, source_type, fulfilment_type, origin_country'),
  ]);

  const candList = (candidates ?? []) as SourcingCandidateOption[];
  const candBySku = new Map<string, SourcingCandidateOption>();
  for (const c of candList) {
    if (c.sourcing_sku) {
      const key = c.sourcing_sku.toUpperCase().trim();
      // Prefer verified supplier row when multiple exist
      const prev = candBySku.get(key);
      if (!prev || (!prev.supplier_verified && c.supplier_verified)) {
        candBySku.set(key, c);
      }
    }
  }

  const existingByRef = new Map<string, Record<string, unknown>>();
  for (const ex of existingProds ?? []) {
    if (ex.legacy_sku) {
      existingByRef.set(String(ex.legacy_sku).toUpperCase().trim(), ex as Record<string, unknown>);
    }
  }

  const rawAt = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '') : '');
  const cellAt = (r: string[], i: number) => (i >= 0 ? sanitiseCsvCell(r[i] ?? '') : '');

  const previews: CsvRowPreview[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNumber = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const rawTitle = rawAt(r, colIdx.title).trim();
    if (/^[=+\-@]/.test(rawTitle)) {
      warnings.push(`Title started with "${rawTitle[0]}" (removed to protect spreadsheets)`);
    }

    const sourcingSku = cellAt(r, colIdx.sourcing_sku).toUpperCase();
    const explicitRef = cellAt(r, colIdx.import_ref).toUpperCase();
    const import_ref = explicitRef || sourcingSku;
    let title = cellAt(r, colIdx.title);
    let description = cellAt(r, colIdx.description);
    const category = cellAt(r, colIdx.category);
    const weightRaw = cellAt(r, colIdx.weight_g);
    const lRaw = cellAt(r, colIdx.l_cm);
    const wRaw = cellAt(r, colIdx.w_cm);
    const hRaw = cellAt(r, colIdx.h_cm);
    const hsRaw = cellAt(r, colIdx.hs_code);
    const moqRaw = cellAt(r, colIdx.min_order_qty) || '1';
    const sourceTypeRaw = (
      cellAt(r, colIdx.source_type) || (sourcingSku ? 'partner_supplier' : 'own_warehouse')
    ).toLowerCase();
    const originCountryRaw = cellAt(r, colIdx.origin_country).toUpperCase();
    const specsRaw = cellAt(r, colIdx.specs_json);

    if (!import_ref || import_ref.length < 2) {
      errors.push('Sourcing model no. (or import_ref) is required');
    }
    if (!title || title.length < 3) {
      errors.push('title is required (min 3 chars)');
    }

    if (r.some((c) => /https?:\/\/\S+\.(jpg|jpeg|png|webp|gif)/i.test(c))) {
      errors.push('External image URLs are not allowed in CSV cells');
    }

    const weight_g = /^\d+$/.test(weightRaw) ? Number(weightRaw) : 0;
    if (weight_g <= 0) errors.push('weight_g is empty or must be a positive integer');

    let box_l_cm: number | null = null;
    let box_w_cm: number | null = null;
    let box_h_cm: number | null = null;
    if (colIdx.l_cm >= 0 || colIdx.w_cm >= 0 || colIdx.h_cm >= 0) {
      if (lRaw !== '' || wRaw !== '' || hRaw !== '') {
        const l = Number(lRaw);
        const w = Number(wRaw);
        const h = Number(hRaw);
        if (!Number.isFinite(l) || !Number.isFinite(w) || !Number.isFinite(h) || l <= 0 || w <= 0 || h <= 0) {
          errors.push(`Box size ${lRaw || '0'} × ${wRaw || '0'} × ${hRaw || '0'} cm — every side must be above 0`);
        } else {
          box_l_cm = Math.round(l * 100) / 100;
          box_w_cm = Math.round(w * 100) / 100;
          box_h_cm = Math.round(h * 100) / 100;
        }
      }
    }

    const min_order_qty = /^\d+$/.test(moqRaw) && Number(moqRaw) >= 1 ? Number(moqRaw) : 0;
    if (min_order_qty < 1) errors.push('min_order_qty must be ≥ 1');

    if (!['own_warehouse', 'partner_supplier'].includes(sourceTypeRaw)) {
      errors.push('source_type must be own_warehouse or partner_supplier');
    }

    let supplier_product_id: string | null = null;
    let sourcing_item_id: string | null = null;
    let supplier_code = '';
    let unit_cost_cents = 0;
    if (sourcingSku) {
      const cand = candBySku.get(sourcingSku);
      if (!cand) {
        errors.push(`Sourcing model no. ${sourcingSku} not found in Sourcing`);
      } else if (!cand.supplier_verified) {
        errors.push(`Supplier for ${sourcingSku} is not verified in Sourcing`);
      } else {
        supplier_product_id = cand.supplier_product_id;
        sourcing_item_id = cand.sourcing_item_id;
        supplier_code = staff.canSeeCosts ? cand.supplier_code ?? '' : '';
        unit_cost_cents = staff.canSeeCosts ? Number(cand.unit_cost_cents ?? 0) : 0;
      }
    } else if (sourceTypeRaw === 'partner_supplier') {
      errors.push('sourcing_sku / src_model_no is required for partner_supplier products');
    }

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

    const variant_options: Record<string, string> = {};
    const colorVal = cellAt(r, colIdx.color);
    const sizeVal = cellAt(r, colIdx.size);
    if (colorVal) variant_options.Colour = colorVal;
    if (sizeVal) variant_options.Size = sizeVal;

    // Scrub supplier names in title & description (warning instead of leaking supplier name)
    if (title) {
      const { data: scrTitle } = await sb.rpc('scrub_dropship_whitelabel_text', { p_text: title });
      if (scrTitle && (scrTitle as { scrubbed?: boolean }).scrubbed) {
        title = String((scrTitle as { clean_text?: string }).clean_text ?? '').trim();
        warnings.push('Title mentions a supplier name (name removed; review the text)');
        if (title.length < 3) errors.push('Title became empty after removing supplier name');
      }
    }
    if (description) {
      const { data: scrDesc } = await sb.rpc('scrub_dropship_whitelabel_text', {
        p_text: description,
      });
      if (scrDesc && (scrDesc as { scrubbed?: boolean }).scrubbed) {
        description = String((scrDesc as { clean_text?: string }).clean_text ?? '').trim();
        warnings.push('Description mentions a supplier name (name removed; review the text)');
      }
    }

    const specHits = await checkWhiteLabelStrings(
      [...Object.entries(specs), ...Object.entries(variant_options)].flatMap(([k, v]) => [k, v]),
    );
    if (specHits.length > 0) {
      errors.push('Specs or variant options contain a supplier identifier');
    }

    const srcType = (['own_warehouse', 'partner_supplier'].includes(sourceTypeRaw)
      ? sourceTypeRaw
      : 'partner_supplier') as 'own_warehouse' | 'partner_supplier';

    const ex = existingByRef.get(import_ref);

    previews.push({
      rowNumber,
      import_ref: staff.canSeeCosts ? import_ref : '',
      title,
      description,
      category,
      weight_g: Math.max(1, weight_g),
      box_l_cm,
      box_w_cm,
      box_h_cm,
      hs_code: hsRaw || null,
      has_battery: parseBoolCell(cellAt(r, colIdx.battery)),
      has_liquid: parseBoolCell(cellAt(r, colIdx.liquid)),
      has_magnet: parseBoolCell(cellAt(r, colIdx.magnet)),
      has_powder: parseBoolCell(cellAt(r, colIdx.powder)),
      min_order_qty: Math.max(1, min_order_qty),
      source_type: srcType,
      fulfilment_type: srcType === 'own_warehouse' ? 'fast_ship' : 'extended_catalog',
      sourcing_sku: staff.canSeeCosts ? sourcingSku : '',
      supplier_product_id,
      sourcing_item_id,
      supplier_code: staff.canSeeCosts ? supplier_code : '',
      unit_cost_cents: staff.canSeeCosts ? unit_cost_cents : 0,
      origin_country,
      variant_options,
      specs,
      existing_model_no: ex ? String(ex.model_no) : null,
      warnings,
      errors,
    });
  }

  const validList = previews.filter((p) => p.errors.length === 0);
  const errorRows = previews.length - validList.length;
  const newReadyRows = validList.filter((p) => !p.existing_model_no).length;
  const updateRows = validList.filter((p) => !!p.existing_model_no).length;
  const warningRows = validList.filter((p) => p.warnings.length > 0).length;

  return {
    totalRows: previews.length,
    validRows: validList.length,
    newReadyRows,
    updateRows,
    unchangedRows: 0,
    errorRows,
    warningRows,
    headers: rawHeaders,
    columnMappings,
    rows: previews,
  };
}

/**
 * Commit a CSV bulk import:
 *  · Correction 7: Creates drafts ONLY (never publishes).
 *  · Correction 4: Reuses Sourcing product's item_id when single base unit (options = {}) and item_id is free.
 *  · Skips error rows when allowSkipErrors = true (or requires 0 errors by default).
 *  · Records a dropship_import_jobs row (IMP-XXXX) and is strictly idempotent on re-run.
 */
export async function commitDropshipCsv(
  csvText: string,
  options?: {
    fileName?: string;
    allowSkipErrors?: boolean;
    customMap?: Record<string, string>;
  },
): Promise<
  | {
      ok: true;
      job_code: string;
      created: number;
      updated: number;
      unchanged: number;
      skippedErrors: number;
      createdModelNos: string[];
    }
  | { ok: false; error: string }
> {
  const staff = await requireDropshipStaff(true);
  const preview = await previewDropshipCsv(csvText, options?.customMap);
  if (preview.globalError) return { ok: false, error: preview.globalError };
  if (preview.totalRows === 0) return { ok: false, error: 'No rows to import.' };
  if (preview.errorRows > 0 && !options?.allowSkipErrors) {
    return {
      ok: false,
      error: `Fix the ${preview.errorRows} row error(s) shown in the preview before importing, or choose to skip error rows.`,
    };
  }

  const goodRows = preview.rows.filter((r) => r.errors.length === 0);
  if (goodRows.length === 0) {
    return { ok: false, error: 'No valid rows to import.' };
  }

  const sb = await createClient();
  const admin = createAdminClient();
  const refs = goodRows.map((r) => r.import_ref);

  const { data: jobRow, error: jobErr } = await sb
    .from('dropship_import_jobs')
    .insert({
      source_type: 'csv',
      file_name: options?.fileName || 'csv-import.csv',
      status: 'running',
      total_rows: preview.totalRows,
      error_count: preview.errorRows,
      warning_count: preview.warningRows,
      created_by: staff.session.userId,
    })
    .select('id, job_code')
    .single();
  if (jobErr) return { ok: false, error: jobErr.message };

  const { data: existingRows } = await admin
    .from('dropship_products')
    .select(
      'id, model_no, legacy_sku, title, description, category, specs, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, origin_country, has_battery, has_liquid, status',
    )
    .in('legacy_sku', refs);

  const existingIds = (existingRows ?? []).map((r) => String(r.id));
  const { data: existingVars } = existingIds.length
    ? await admin
        .from('dropship_variants')
        .select('id, product_id, item_id, supplier_product_id, options, sort')
        .in('product_id', existingIds)
        .order('sort', { ascending: true })
    : { data: [] };

  const firstVarByProd = new Map<
    string,
    { id: string; item_id: string; supplier_product_id: string | null; options: Record<string, string> }
  >();
  for (const v of existingVars ?? []) {
    const pid = String(v.product_id);
    if (!firstVarByProd.has(pid)) {
      firstVarByProd.set(pid, {
        id: String(v.id),
        item_id: String(v.item_id),
        supplier_product_id: (v.supplier_product_id as string | null) ?? null,
        options: (v.options as Record<string, string>) ?? {},
      });
    }
  }

  const itemIdsToRead = [...new Set([...firstVarByProd.values()].map((v) => v.item_id))];
  const { data: existingItems } = itemIdsToRead.length
    ? await sb
        .from('item_master')
        .select('id, hs_code, origin_country, weight_g, box_l_cm, box_w_cm, box_h_cm, has_battery, has_liquid, has_magnet, has_powder')
        .in('id', itemIdsToRead)
    : { data: [] };
  const imById = new Map((existingItems ?? []).map((im) => [String(im.id), im]));

  const byRef = new Map(
    (existingRows ?? []).map((r) => [String(r.legacy_sku).toUpperCase(), r]),
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const createdIds: string[] = [];
  const createdModelNos: string[] = [];

  for (const row of goodRows) {
    const cur = byRef.get(row.import_ref);
    const dims =
      row.box_l_cm && row.box_w_cm && row.box_h_cm
        ? { l: row.box_l_cm, w: row.box_w_cm, h: row.box_h_cm }
        : null;

    const next = {
      legacy_sku: row.import_ref,
      title: row.title,
      description: row.description || null,
      category: row.category || null,
      specs: row.specs,
      weight_g: row.weight_g,
      dimensions_cm: dims,
      min_order_qty: row.min_order_qty,
      source_type: row.source_type,
      fulfilment_type: row.fulfilment_type,
      origin_country: row.origin_country,
      has_battery: row.has_battery,
      has_liquid: row.has_liquid,
    };

    if (!cur) {
      // Correction 7: CSV import creates drafts ONLY (status = 'draft'), never publishes!
      const { data: ins, error } = await sb
        .from('dropship_products')
        .insert({
          ...next,
          images: [],
          status: 'draft',
          import_job_id: jobRow.id as string,
          created_by: staff.session.userId,
        })
        .select('id, model_no')
        .single();
      if (error) return { ok: false, error: `Row ${row.rowNumber} (${row.import_ref}): ${error.message}` };

      // Correction 4: Reuse Sourcing product's item_id when single base unit (options = {}) and not yet claimed
      let reuseItemId: string | null = null;
      if (row.sourcing_item_id && Object.keys(row.variant_options).length === 0) {
        const { data: claimed } = await admin
          .from('dropship_variants')
          .select('id')
          .eq('item_id', row.sourcing_item_id)
          .limit(1);
        if (!claimed || claimed.length === 0) {
          reuseItemId = row.sourcing_item_id;
        }
      }

      const { data: vIns, error: vErr } = await sb
        .from('dropship_variants')
        .insert({
          product_id: ins.id as string,
          options: row.variant_options,
          supplier_product_id: row.supplier_product_id,
          ...(reuseItemId ? { item_id: reuseItemId } : {}),
          price_adjust_cents: 0,
          sort: 0,
        })
        .select('item_id')
        .single();
      if (vErr) return { ok: false, error: `Row ${row.rowNumber} (${row.import_ref}) variant: ${vErr.message}` };

      if (vIns?.item_id) {
        await sb
          .from('item_master')
          .update({
            origin_country: row.origin_country,
            weight_g: row.weight_g,
            ...(row.box_l_cm ? { box_l_cm: row.box_l_cm } : {}),
            ...(row.box_w_cm ? { box_w_cm: row.box_w_cm } : {}),
            ...(row.box_h_cm ? { box_h_cm: row.box_h_cm } : {}),
            ...(row.hs_code ? { hs_code: row.hs_code, hs_code_source: 'sheet' } : {}),
            has_battery: row.has_battery,
            has_liquid: row.has_liquid,
            has_magnet: row.has_magnet,
            has_powder: row.has_powder,
          })
          .eq('id', vIns.item_id);
      }

      created++;
      createdIds.push(String(ins.id));
      createdModelNos.push(String(ins.model_no));
      await writeAudit({
        actorId: staff.session.userId,
        action: 'dropship.csv_imported',
        entityId: ins.id as string,
        after: { ...next, model_no: ins.model_no, supplier_product_id: row.supplier_product_id, status: 'draft' },
        details: { model_no: ins.model_no, job_code: jobRow.job_code, import_ref: row.import_ref, op: 'create' },
      });
    } else {
      const curId = String(cur.id);
      const firstVar = firstVarByProd.get(curId);
      const curIm = firstVar ? imById.get(firstVar.item_id) : undefined;
      const curOrigin = cur.origin_country ? String(cur.origin_country).trim() : null;
      const curDims = (cur.dimensions_cm ?? null) as { l?: number; w?: number; h?: number } | null;

      const dimsSame = dims
        ? Number(curDims?.l ?? 0) === dims.l &&
          Number(curDims?.w ?? 0) === dims.w &&
          Number(curDims?.h ?? 0) === dims.h
        : curDims == null;

      const hsSame = !row.hs_code || String(curIm?.hs_code ?? '') === row.hs_code;
      const flagsSame =
        Boolean(cur.has_battery) === row.has_battery &&
        Boolean(cur.has_liquid) === row.has_liquid &&
        (!curIm ||
          (Boolean(curIm.has_magnet) === row.has_magnet &&
            Boolean(curIm.has_powder) === row.has_powder));

      const same =
        cur.title === next.title &&
        (cur.description ?? null) === next.description &&
        (cur.category ?? null) === next.category &&
        JSON.stringify(cur.specs ?? {}) === JSON.stringify(next.specs) &&
        Number(cur.weight_g) === next.weight_g &&
        dimsSame &&
        hsSame &&
        flagsSame &&
        Number(cur.min_order_qty) === next.min_order_qty &&
        cur.source_type === next.source_type &&
        cur.fulfilment_type === next.fulfilment_type &&
        curOrigin === next.origin_country &&
        JSON.stringify(firstVar?.options ?? {}) === JSON.stringify(row.variant_options) &&
        (firstVar?.supplier_product_id ?? null) === (row.supplier_product_id ?? null);

      if (same) {
        unchanged++;
        continue;
      }

      // Never transition status to 'active' in CSV import
      const { error } = await sb
        .from('dropship_products')
        .update(next)
        .eq('id', curId);
      if (error) return { ok: false, error: `Row ${row.rowNumber} (${row.import_ref}): ${error.message}` };

      if (firstVar) {
        await sb
          .from('dropship_variants')
          .update({
            options: row.variant_options,
            supplier_product_id: row.supplier_product_id,
          })
          .eq('id', firstVar.id);
        await sb
          .from('item_master')
          .update({
            origin_country: row.origin_country,
            weight_g: row.weight_g,
            ...(row.box_l_cm ? { box_l_cm: row.box_l_cm } : {}),
            ...(row.box_w_cm ? { box_w_cm: row.box_w_cm } : {}),
            ...(row.box_h_cm ? { box_h_cm: row.box_h_cm } : {}),
            ...(row.hs_code ? { hs_code: row.hs_code } : {}),
            has_battery: row.has_battery,
            has_liquid: row.has_liquid,
            has_magnet: row.has_magnet,
            has_powder: row.has_powder,
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
        details: { model_no: cur.model_no, job_code: jobRow.job_code, import_ref: row.import_ref, op: 'update' },
      });
    }
  }

  await sb
    .from('dropship_import_jobs')
    .update({
      status: 'completed',
      saved_rows: created + updated + unchanged,
      created_count: created,
      updated_count: updated,
      unchanged_count: unchanged,
      created_product_ids: createdIds,
      completed_at: new Date().toISOString(),
      report: {
        created_model_nos: createdModelNos,
        skipped_errors: preview.errorRows,
      },
    })
    .eq('id', jobRow.id as string);

  revalidatePath('/office/dropship');
  revalidatePath('/office/dropship/import');
  revalidatePath('/account/dropship/catalogue');
  return {
    ok: true,
    job_code: String(jobRow.job_code),
    created,
    updated,
    unchanged,
    skippedErrors: preview.errorRows,
    createdModelNos,
  };
}
