'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { z } from 'zod';
import { requireCustomer } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  getDropshipOrderQuote,
  requireDropshipV2Merchant,
  type DropshipOrderQuoteResult,
  type ShipType,
} from '@/lib/dropship';

/**
 * Dropshipping catalogue v2 + Phase 2 Step 3 — merchant actions:
 *  · Import list & selling countries
 *  · Landed cost calculator server quote (single parcel vs separate orders)
 *  · Free Dropship product requests (real RFQ codes, EXIF-stripped reference images, accept/decline landed quote)
 *  · Sample orders (store_orders kind = 'sample', 1–3 qty, refuses DDP with missing duty, pure wallet cash debit)
 */

/** Parse a US$ string ("29.99", "$29.99", "29") into integer cents without floating-point arithmetic. */
function parseUsdToCents(raw: string | null | undefined): number | null {
  const s = (raw ?? '').replace(/^\s*(?:US\$|\$)\s*/i, '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const fracStr = (m[2] ?? '').padEnd(2, '0');
  const frac = Number(fracStr);
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

const AddSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().optional().nullable(),
  service: z.enum(['express', 'standard', 'economy']).optional().nullable(),
  price_cents: z.number().int().positive().max(100_000_000).optional().nullable(),
});

const RemoveSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().optional().nullable(),
});

const MarketsSchema = z.object({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1, 'Choose at least one selling country').max(40),
});

export async function addToImportList(formData: FormData) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const rawVariant = String(formData.get('variant_id') ?? '').trim();
  const rawService = String(formData.get('service') ?? '').trim();
  const rawPriceCents = String(formData.get('price_cents') ?? '').trim();
  const rawPriceUsd = String(formData.get('price') ?? '').trim();

  const parsedUsd = parseUsdToCents(rawPriceUsd);
  const priceCents =
    /^\d+$/.test(rawPriceCents) && Number(rawPriceCents) > 0
      ? Number(rawPriceCents)
      : parsedUsd && parsedUsd > 0
        ? parsedUsd
        : null;

  const parsed = AddSchema.safeParse({
    product_id: String(formData.get('product_id') ?? '').trim(),
    variant_id: rawVariant ? rawVariant : null,
    service: ['express', 'standard', 'economy'].includes(rawService) ? rawService : null,
    price_cents: priceCents,
  });
  if (!parsed.success) throw new Error('Invalid import list item');

  const sb = await createClient();
  await sb.from('dropship_import_list').delete().eq('org_id', s.org!.id).eq('product_id', parsed.data.product_id);
  const { error } = await sb.from('dropship_import_list').insert({
    org_id: s.org!.id,
    product_id: parsed.data.product_id,
    variant_id: parsed.data.variant_id ?? null,
    service: parsed.data.service ?? null,
    price_cents: parsed.data.price_cents ?? null,
    added_by: s.userId,
  });
  if (error) throw new Error(`Could not add to your import list: ${error.message}`);
  revalidatePath('/account/dropship/catalogue', 'layout');
  revalidatePath('/account/dropship/sample');
}

export async function removeFromImportList(formData: FormData) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const rawVariant = String(formData.get('variant_id') ?? '').trim();
  const parsed = RemoveSchema.safeParse({
    product_id: String(formData.get('product_id') ?? '').trim(),
    variant_id: rawVariant ? rawVariant : null,
  });
  if (!parsed.success) throw new Error('Invalid product');

  const sb = await createClient();
  let q = sb.from('dropship_import_list').delete().eq('org_id', s.org!.id).eq('product_id', parsed.data.product_id);
  if (parsed.data.variant_id) q = q.eq('variant_id', parsed.data.variant_id);
  const { error } = await q;
  if (error) throw new Error(`Could not remove it from your import list: ${error.message}`);
  revalidatePath('/account/dropship/catalogue', 'layout');
}

export async function saveMerchantMarkets(formData: FormData) {
  await requireCustomer('/account/dropship/catalogue');
  const countries = formData
    .getAll('countries')
    .map((c) => String(c).toUpperCase().trim())
    .filter(Boolean);
  const parsed = MarketsSchema.safeParse({ countries });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Choose at least one selling country');

  const sb = await createClient();
  const { error } = await sb.rpc('set_dropship_markets', {
    p_countries: parsed.data.countries,
    p_org_id: null,
    p_lock: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/account/dropship/catalogue', 'layout');
}

/* ───────── Step 3 · Landed Cost Calculator Server Quote ───────── */

export type LandedCostCalcResponse = {
  ok: boolean;
  error?: string;
  parcelQuote?: DropshipOrderQuoteResult;
  separateOrdersTotalCents?: number | null;
  savingsCents?: number | null;
};

export async function calculateMerchantLandedCostAction(input: {
  variantId: string;
  qty: number;
  country: string;
  method: ShipType;
  incoterm?: 'DDP' | 'DAP';
}): Promise<LandedCostCalcResponse> {
  await requireDropshipV2Merchant('/account/dropship/landed-cost');
  const qty = Math.min(100, Math.max(1, Math.round(Number(input.qty) || 1)));
  if (!/^[0-9a-f-]{36}$/i.test(input.variantId)) {
    return { ok: false, error: 'Select a valid product variant.' };
  }
  const country = String(input.country ?? '').toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(country)) {
    return { ok: false, error: 'Select a valid destination country.' };
  }
  const method: ShipType = ['express', 'standard', 'economy'].includes(input.method) ? input.method : 'standard';

  const [parcelQuote, singleUnitQuote] = await Promise.all([
    getDropshipOrderQuote({
      variantId: input.variantId,
      qty,
      country,
      method,
      incoterm: input.incoterm ?? 'DDP',
      quoteMode: 'catalogue',
    }),
    qty > 1
      ? getDropshipOrderQuote({
          variantId: input.variantId,
          qty: 1,
          country,
          method,
          incoterm: input.incoterm ?? 'DDP',
          quoteMode: 'catalogue',
        })
      : Promise.resolve(null),
  ]);

  if (!parcelQuote.ok) {
    return { ok: false, error: parcelQuote.message ?? 'No active shipping route for this country and method.' };
  }

  let separateOrdersTotalCents: number | null = null;
  let savingsCents: number | null = null;
  if (
    qty > 1 &&
    singleUnitQuote?.ok &&
    singleUnitQuote.total_cents != null &&
    parcelQuote.total_cents != null
  ) {
    separateOrdersTotalCents = singleUnitQuote.total_cents * qty;
    savingsCents = Math.max(0, separateOrdersTotalCents - parcelQuote.total_cents);
  }

  return {
    ok: true,
    parcelQuote,
    separateOrdersTotalCents,
    savingsCents,
  };
}

/* ───────── Step 3 · Product Requests (Real RFQ Codes, Free by Default) ───────── */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;

function detectImageMime(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
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

export async function uploadDropshipRequestImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireDropshipV2Merchant('/account/dropship/requests');
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Choose an image file.' };
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'Images must be 5 MB or smaller.' };
  }
  const raw = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(raw);
  if (!mime) {
    return { ok: false, error: 'Use a JPEG, PNG or WebP image.' };
  }

  let outBytes: Buffer;
  let ext: 'jpg' | 'png' | 'webp';
  let contentType: string;
  try {
    const pipeline = sharp(Buffer.from(raw), { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    if (mime === 'image/png') {
      outBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      ext = 'png';
      contentType = 'image/png';
    } else if (mime === 'image/webp') {
      outBytes = await pipeline.webp({ quality: 86 }).toBuffer();
      ext = 'webp';
      contentType = 'image/webp';
    } else {
      outBytes = await pipeline.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      ext = 'jpg';
      contentType = 'image/jpeg';
    }
  } catch {
    return { ok: false, error: 'Could not read that image. Try another file.' };
  }

  const key = `requests/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const up = await admin.storage.from('dropship-media').upload(key, outBytes, {
    contentType,
    upsert: false,
  });
  if (up.error) return { ok: false, error: up.error.message };
  const publicUrl = admin.storage.from('dropship-media').getPublicUrl(key).data.publicUrl;
  return { ok: true, url: publicUrl };
}

export async function submitDropshipProductRequestAction(input: {
  title: string;
  productLink?: string;
  category?: string;
  targetLandedUsd?: string;
  monthlyVolumeBand?: string;
  shipToCountries: string[];
  wantsBrand?: boolean;
  notes?: string;
  images?: string[];
  idempotencyKey?: string;
}): Promise<
  | { ok: true; rfqId: string; rfqCode: string; feeCents: number }
  | { ok: false; error: string }
> {
  await requireDropshipV2Merchant('/account/dropship/requests');
  const title = (input.title ?? '').trim();
  if (title.length < 2 || title.length > 160) {
    return { ok: false, error: 'Enter a product name between 2 and 160 characters.' };
  }
  const link = (input.productLink ?? '').trim();
  if (link && !/^https?:\/\/\S+/i.test(link)) {
    return { ok: false, error: 'Product link must start with https:// or http://' };
  }
  const countries = (input.shipToCountries ?? [])
    .map((c) => String(c).toUpperCase().trim())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  if (countries.length === 0) {
    return { ok: false, error: 'Choose at least one destination country.' };
  }

  let targetCents: number | null = null;
  if ((input.targetLandedUsd ?? '').trim() !== '') {
    targetCents = parseUsdToCents(input.targetLandedUsd);
    if (targetCents == null) {
      return { ok: false, error: 'Enter the target landed cost in USD (for example 6.00).' };
    }
  }

  const images = (input.images ?? [])
    .map((u) => String(u).trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 6);

  const sb = await createClient();
  const { data, error } = await sb.rpc('create_dropship_product_request', {
    p_title: title,
    p_product_link: link || null,
    p_category: (input.category ?? '').trim() || null,
    p_target_landed_cents: targetCents,
    p_monthly_volume_band: (input.monthlyVolumeBand ?? '').trim() || null,
    p_ship_to_countries: countries,
    p_wants_brand: Boolean(input.wantsBrand),
    p_notes: (input.notes ?? '').trim() || null,
    p_images: images,
    p_idem: (input.idempotencyKey ?? '').trim() || null,
  });

  if (error) {
    const clean = error.message.replace(/^[A-Z_]+:\s*/, '');
    return { ok: false, error: clean || 'Could not submit your product request.' };
  }

  revalidatePath('/account/dropship/requests');
  const res = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    rfqId: String(res.rfq_id ?? ''),
    rfqCode: String(res.rfq_code ?? ''),
    feeCents: Number(res.fee_cents ?? 0),
  };
}

export async function respondToDropshipRequestQuoteAction(input: {
  rfqId: string;
  action: 'accept' | 'decline';
}): Promise<
  | { ok: true; rfqCode: string; action: 'accepted' | 'declined'; dropshipModelNo?: string | null }
  | { ok: false; error: string }
> {
  await requireDropshipV2Merchant('/account/dropship/requests');
  if (!/^[0-9a-f-]{36}$/i.test(input.rfqId)) {
    return { ok: false, error: 'Invalid request.' };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc('respond_dropship_request_quote', {
    p_rfq_id: input.rfqId,
    p_action: input.action,
  });
  if (error) {
    const clean = error.message.replace(/^[A-Z_]+:\s*/, '');
    return { ok: false, error: clean || 'Could not update your request.' };
  }
  revalidatePath('/account/dropship/requests');
  revalidatePath('/account/dropship/catalogue');
  const res = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    rfqCode: String(res.rfq_code ?? ''),
    action: res.action === 'declined' ? 'declined' : 'accepted',
    dropshipModelNo: res.dropship_model_no ? String(res.dropship_model_no) : null,
  };
}

/* ───────── Step 3 · Sample Orders (store_orders kind = 'sample', Wallet Cash Only) ───────── */

export async function quoteDropshipSampleAction(input: {
  variantId: string;
  qty: number;
  country: string;
  method: ShipType;
  incoterm?: 'DDP' | 'DAP';
}): Promise<DropshipOrderQuoteResult> {
  await requireDropshipV2Merchant('/account/dropship/sample');
  const qty = Math.min(3, Math.max(1, Math.round(Number(input.qty) || 1)));
  return getDropshipOrderQuote({
    variantId: input.variantId,
    qty,
    country: input.country,
    method: input.method,
    incoterm: input.incoterm ?? 'DDP',
    quoteMode: 'order',
  });
}

export async function submitDropshipSampleOrderAction(input: {
  variantId: string;
  qty: number;
  destinationCountry: string;
  shippingMethod: ShipType;
  incoterm?: 'DDP' | 'DAP';
  buyerName: string;
  buyerPhone: string;
  addressLine1: string;
  city: string;
  postalCode?: string;
  idempotencyKey: string;
}): Promise<
  | {
      ok: true;
      storeOrderId: string;
      orderNumber: string;
      totalCents: number;
      merchantStatus: string;
    }
  | {
      ok: false;
      code?: string;
      error: string;
      walletBalanceCents?: number;
      shortfallCents?: number;
    }
> {
  await requireDropshipV2Merchant('/account/dropship/sample');
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 3) {
    return { ok: false, code: 'INVALID_SAMPLE_QTY', error: 'Sample quantity must be between 1 and 3 per product.' };
  }
  const buyerName = (input.buyerName ?? '').trim();
  const addressLine1 = (input.addressLine1 ?? '').trim();
  const city = (input.city ?? '').trim();
  if (!buyerName) return { ok: false, error: 'Enter the recipient full name.' };
  if (!addressLine1 || !city) return { ok: false, error: 'Enter the street address and city.' };

  const sb = await createClient();
  const { data, error } = await sb.rpc('create_dropship_sample_order', {
    p_variant_id: input.variantId,
    p_qty: qty,
    p_destination_country: String(input.destinationCountry ?? '').toUpperCase().trim(),
    p_shipping_method: input.shippingMethod,
    p_buyer_name: buyerName,
    p_buyer_phone: (input.buyerPhone ?? '').trim() || null,
    p_shipping_address: {
      line1: addressLine1,
      city,
      postal_code: (input.postalCode ?? '').trim() || undefined,
      country: String(input.destinationCountry ?? '').toUpperCase().trim(),
    },
    p_idempotency_key: input.idempotencyKey,
    p_incoterm: input.incoterm ?? null,
    p_is_test: false,
  });

  if (error) {
    const codeMatch = error.message.match(/^([A-Z0-9_]+):?/);
    return {
      ok: false,
      code: codeMatch ? codeMatch[1] : undefined,
      error: error.message.replace(/^[A-Z0-9_]+:\s*/, ''),
    };
  }

  const res = (data ?? {}) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      code: res.code ? String(res.code) : undefined,
      error: String(res.message ?? 'Could not place sample order.'),
      walletBalanceCents: res.wallet_balance_cents != null ? Number(res.wallet_balance_cents) : undefined,
      shortfallCents: res.shortfall_cents != null ? Number(res.shortfall_cents) : undefined,
    };
  }

  revalidatePath('/account/dropship/sample');
  revalidatePath('/account/dropship/wallet');
  revalidatePath('/account/dropship/orders');
  return {
    ok: true,
    storeOrderId: String(res.store_order_id ?? ''),
    orderNumber: String(res.order_number ?? ''),
    totalCents: Number(res.total_cents ?? 0),
    merchantStatus: String(res.merchant_status ?? 'processing'),
  };
}

// ───────── Step 4: Access request & Onboarding actions ─────────
export async function submitDropshipAccessRequestAction(formData: FormData): Promise<{
  ok: boolean;
  code?: string;
  error?: string;
}> {
  const s = await requireCustomer('/account/dropship');
  if (!s.org) return { ok: false, error: 'Complete your company profile first.' };

  const storePlatform = String(formData.get('store_platform') ?? 'shopify').trim().toLowerCase();
  const storeAddress = String(formData.get('store_address') ?? '').trim() || null;
  const expectedOrdersBand = String(formData.get('expected_orders_band') ?? 'Under 100').trim();
  const countries = formData
    .getAll('countries')
    .map((c) => String(c).toUpperCase().trim())
    .filter((c) => /^[A-Z]{2}$/.test(c));

  if (countries.length === 0) {
    return { ok: false, code: 'COUNTRY_REQUIRED', error: 'Choose at least one selling country.' };
  }

  const sb = await createClient();
  const { error } = await sb.rpc('request_dropship_access', {
    p_store_platform: storePlatform,
    p_store_address: storeAddress,
    p_expected_orders_band: expectedOrdersBand,
    p_countries: countries,
  });

  if (error) {
    const codeMatch = error.message.match(/^([A-Z0-9_]+):?/);
    return {
      ok: false,
      code: codeMatch ? codeMatch[1] : undefined,
      error: error.message.replace(/^[A-Z0-9_]+:\s*/, ''),
    };
  }

  revalidatePath('/account/dropship');
  return { ok: true };
}

export async function saveOnboardingMarketsAction(formData: FormData): Promise<{
  ok: boolean;
  code?: string;
  error?: string;
}> {
  await requireDropshipV2Merchant('/account/dropship/onboarding');
  const countries = formData
    .getAll('countries')
    .map((c) => String(c).toUpperCase().trim())
    .filter((c) => /^[A-Z]{2}$/.test(c));

  if (countries.length === 0) {
    return { ok: false, code: 'MARKETS_EMPTY', error: 'Choose at least one selling country.' };
  }

  const sb = await createClient();
  const { error } = await sb.rpc('set_dropship_markets', {
    p_countries: countries,
    p_org_id: null,
    p_lock: null,
  });

  if (error) {
    const codeMatch = error.message.match(/^([A-Z0-9_]+):?/);
    return {
      ok: false,
      code: codeMatch ? codeMatch[1] : undefined,
      error: error.message.replace(/^[A-Z0-9_]+:\s*/, ''),
    };
  }

  revalidatePath('/account/dropship/onboarding');
  revalidatePath('/account/dropship/catalogue');
  revalidatePath('/account/dropship');
  return { ok: true };
}

export async function saveDropshipSellerProfileAction(formData: FormData): Promise<{
  ok: boolean;
  code?: string;
  status?: string;
  error?: string;
}> {
  await requireDropshipV2Merchant('/account/dropship/onboarding');

  const brandName = String(formData.get('brand_name') ?? '').trim();
  const returnName = String(formData.get('return_name') ?? '').trim();
  const returnLine1 = String(formData.get('return_line1') ?? '').trim();
  const returnLine2 = String(formData.get('return_line2') ?? '').trim() || null;
  const returnCity = String(formData.get('return_city') ?? '').trim();
  const returnRegion = String(formData.get('return_region') ?? '').trim() || null;
  const returnPostalCode = String(formData.get('return_postal_code') ?? '').trim() || null;
  const returnCountry = String(formData.get('return_country') ?? '').trim();

  if (!brandName) return { ok: false, error: 'Enter your brand name.' };
  if (!returnName || !returnLine1 || !returnCity || !returnCountry) {
    return { ok: false, error: 'Fill in return contact name, street line 1, city and country.' };
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc('save_my_dropship_seller_profile', {
    p_brand_name: brandName,
    p_return_name: returnName,
    p_return_line1: returnLine1,
    p_return_line2: returnLine2,
    p_return_city: returnCity,
    p_return_region: returnRegion,
    p_return_postal_code: returnPostalCode,
    p_return_country: returnCountry,
  });

  if (error) {
    const codeMatch = error.message.match(/^([A-Z0-9_]+):?/);
    return {
      ok: false,
      code: codeMatch ? codeMatch[1] : undefined,
      error: error.message.replace(/^[A-Z0-9_]+:\s*/, ''),
    };
  }

  const res = (data ?? {}) as { status?: string };
  revalidatePath('/account/dropship/onboarding');
  revalidatePath('/account/dropship');
  return { ok: true, status: res.status ?? 'pending' };
}
