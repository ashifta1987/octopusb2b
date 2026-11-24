import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { requireCustomer } from '@/lib/auth';
import { getAccountContext, isStaging, serviceOn } from '@/lib/core/account';

/**
 * Dropshipping catalogue v2 + Phase 2 Step 3 (migrations 204, 205, 211–214).
 * Merchants read ONLY through the SECURITY DEFINER RPCs:
 *   · get_dropship_catalogue
 *   · get_dropship_product
 *   · get_dropship_countries
 *   · get_dropship_order_quote
 *   · list_my_dropship_requests
 *   · list_my_dropship_sample_orders
 * Every RPC verifies auth.uid() is an eligible merchant with dropshipping switched on ('on'/'trial')
 * and returns ONLY allowlisted columns (no supplier name/code/ID/SKU, no Sourcing model no., no carrier, no our cost/margin, no stock numbers).
 */
export type ShipType = 'express' | 'standard' | 'economy';
export type StockStatus = 'in_stock' | 'low' | 'out' | 'extended';
export type FulfilmentType = 'fast_ship' | 'extended_catalog';
export type DutiesStatus = 'estimate' | 'paid_by_buyer' | 'not_known_yet';

export type CatalogueRoute = {
  destination_country: string;
  shipping_method: ShipType;
  incoterm: 'DDP' | 'DAP';
  product_cents: number | null;
  processing_cents: number | null;
  shipping_cents: number | null;
  duties_cents: number | null;
  duties_status: DutiesStatus;
  duties_label: string | null;
  duties_known: boolean;
  landed_price_cents: number;
  billed_weight_g: number | null;
  est_days_min: number;
  est_days_max: number;
};

export type CatalogueVariant = {
  id: string;
  model_no: string;
  options: Record<string, string>;
  price_adjust_cents: number;
  stock_status: StockStatus;
};

export type RestrictedFlags = {
  battery: boolean;
  liquid: boolean;
  magnet: boolean;
  powder: boolean;
  fragile: boolean;
};

export type CatalogueRow = {
  product_id: string;
  model_no: string;
  title: string;
  description: string | null;
  category: string | null;
  images: string[];
  specs: Record<string, string>;
  weight_g: number;
  dimensions_cm: { l?: number; w?: number; h?: number } | null;
  min_order_qty: number;
  fulfilment_type: FulfilmentType;
  only_for_you: boolean;
  only_for_you_count: number;
  sourced_rfq_code: string | null;
  has_battery: boolean;
  restricted_flags: RestrictedFlags;
  stock_status: StockStatus;
  variants: CatalogueVariant[];
  routes: CatalogueRoute[];
  total_count: number;
};

export type ShippingCustomsInfo = {
  weight_g: number | null;
  box_l_cm: number | null;
  box_w_cm: number | null;
  box_h_cm: number | null;
  billed_weight_g: number | null;
  hs_code: string | null;
  hs_verified: boolean;
  origin_country: string | null;
  has_battery: boolean;
  has_liquid: boolean;
  has_magnet: boolean;
  has_powder: boolean;
  is_fragile: boolean;
};

export type PriceTier = {
  min_qty: number;
  unit_price_cents: number;
};

export type Detail = Omit<CatalogueRow, 'total_count' | 'only_for_you_count'> & {
  shipping_customs: ShippingCustomsInfo;
  price_tiers: PriceTier[];
  all_country_routes: CatalogueRoute[];
};

export type MerchantCountry = {
  country: string;
  locked_by_staff: boolean;
  has_active_routes: boolean;
};

export type DropshipRequestRow = {
  rfq_id: string;
  rfq_code: string;
  title: string;
  category_label: string | null;
  monthly_volume_band: string | null;
  ship_to_countries: string[];
  target_landed_cents: number | null;
  wants_brand: boolean;
  fee_cents: number;
  merchant_status: string;
  merchant_label: string;
  quoted_landed_cents: number | null;
  quoted_country: string | null;
  dropship_product_id: string | null;
  dropship_model_no: string | null;
  dropship_product_status: string | null;
  created_at: string;
};

export type DropshipSampleOrderRow = {
  store_order_id: string;
  order_number: string;
  product_id: string;
  variant_id: string;
  model_no: string;
  title_snapshot: string;
  variant_label: string | null;
  qty: number;
  destination_country: string;
  shipping_method: ShipType;
  incoterm: 'DDP' | 'DAP';
  product_cents: number;
  processing_cents: number;
  shipping_cents: number;
  duties_cents: number | null;
  total_cents: number;
  merchant_status: string;
  tracking_no: string | null;
  created_at: string;
  delivered_at: string | null;
};

export type DropshipOrderQuoteResult = {
  ok: boolean;
  code?: string;
  message?: string;
  country?: string;
  shipping_method?: ShipType;
  incoterm?: 'DDP' | 'DAP';
  total_qty?: number;
  actual_weight_g?: number;
  volumetric_weight_g?: number;
  billed_weight_g?: number;
  days_min?: number;
  days_max?: number;
  product_cents?: number;
  processing_cents?: number;
  shipping_cents?: number;
  declared_value_usd_cents?: number;
  duties_cents?: number | null;
  duties_status?: DutiesStatus;
  duties_label?: string | null;
  total_known_cents?: number;
  total_cents?: number | null;
};

export const SHIP_LABEL: Record<ShipType, string> = {
  express: 'Express',
  standard: 'Standard',
  economy: 'Economy',
};

/** Correction 5: Stock = label ONLY (In stock / Low stock / Out of stock / Extended), NEVER a number. */
export const STOCK_LABEL: Record<StockStatus, [string, string]> = {
  in_stock: ['In stock', 'bg-ok-bg text-ok'],
  low: ['Low stock', 'bg-warn-bg text-warn'],
  out: ['Out of stock', 'bg-bad-bg text-bad'],
  extended: ['Extended', 'bg-tint text-ink'],
};

export const days = (r: Pick<CatalogueRoute, 'est_days_min' | 'est_days_max'>) =>
  `${r.est_days_min}–${r.est_days_max} days`;

export async function dropshipSettings() {
  const { settings } = await getSiteContent();
  const markup = Number(settings['dropship.markup']);
  const handling = Number(settings['dropship.handling_days']);
  const minMarginBp = Number(settings['dropship.min_margin_bp']);
  const catMarginRaw = settings['dropship.category_min_margin_bp'];
  const catMargin: Record<string, number> =
    catMarginRaw && typeof catMarginRaw === 'object' && !Array.isArray(catMarginRaw)
      ? Object.fromEntries(
          Object.entries(catMarginRaw as Record<string, unknown>)
            .map(([k, v]) => [k, Math.round(Number(v))])
            .filter(([, v]) => Number.isFinite(v) && (v as number) >= 0),
        )
      : {};
  const supRaw = settings['dropship.supported_countries'];
  const supportedCountries: string[] = Array.isArray(supRaw)
    ? supRaw.map((x) => String(x).toUpperCase().trim()).filter((x) => /^[A-Z]{2}$/.test(x))
    : ['AE', 'SA', 'GB', 'US', 'DE', 'FR', 'NL', 'AU', 'CA', 'SG', 'KW', 'QA', 'BH', 'OM'];

  return {
    markup: Number.isFinite(markup) && markup > 1 ? markup : 1.8,
    handlingDays: Number.isFinite(handling) && handling > 0 ? handling : null,
    returns:
      typeof settings['dropship.returns'] === 'string' && (settings['dropship.returns'] as string).trim()
        ? (settings['dropship.returns'] as string)
        : null,
    defaultCountry:
      typeof settings['dropship.default_country'] === 'string'
        ? (settings['dropship.default_country'] as string)
        : null,
    minMarginBp: Number.isFinite(minMarginBp) && minMarginBp >= 0 ? Math.round(minMarginBp) : 1500,
    categoryMinMarginBp: catMargin,
    supportedCountries,
    v2Ui:
      typeof settings['dropship_v2_ui'] === 'boolean'
        ? (settings['dropship_v2_ui'] as boolean)
        : isStaging(),
    demo: settings['demo.addon44'] === true,
  };
}

/**
 * Step U1 Rule 1: Is the Dropship design v2 UI switched on?
 * Default: OFF on live, ON on staging (unless explicitly set in site_settings.dropship_v2_ui).
 */
export async function isDropshipV2UiEnabled(): Promise<boolean> {
  const { settings } = await getSiteContent();
  if (typeof settings['dropship_v2_ui'] === 'boolean') {
    return settings['dropship_v2_ui'] as boolean;
  }
  return isStaging();
}

/**
 * Server-side guard for /account/dropship/* placeholder/v2 sub-routes:
 * Any customer whose organization does not have dropship switched on ('on'/'trial')
 * OR when dropship_v2_ui is OFF is redirected to /account/dropship ("Coming soon").
 */
export async function requireDropshipV2Merchant(next = '/account/dropship') {
  const s = await requireCustomer(next);
  if (!s.org) redirect('/account/dropship');
  const [ctx, v2On] = await Promise.all([
    getAccountContext(s.org.id),
    isDropshipV2UiEnabled(),
  ]);
  if (!v2On || !serviceOn(ctx.services.dropship)) {
    redirect('/account/dropship');
  }
  return { session: s, ctx };
}

/** Suggested retail = landed_price_cents × markup, rounded up to end in .99 (integer cents; null without a pricing rule). */
export function suggested(landedCents: number, markup: number | null) {
  if (!markup || landedCents <= 0) return null;
  return Math.max(99, Math.ceil((landedCents * markup) / 100) * 100 - 1);
}

export function profit(priceCents: number, landedCents: number) {
  const p = priceCents - landedCents;
  return {
    cents: p,
    pct: priceCents > 0 ? Math.round((p / priceCents) * 100) : 0,
    bp: priceCents > 0 ? Math.round((p * 10000) / priceCents) : 0,
  };
}

/** Pick the requested shipping method if available, otherwise the fastest (then lowest landed price) route. */
export function pickRoute(routes: CatalogueRoute[], want?: ShipType | null): CatalogueRoute | null {
  if (!routes?.length) return null;
  if (want) return routes.find((r) => r.shipping_method === want) ?? null;
  return [...routes].sort((a, b) => a.est_days_min - b.est_days_min || a.landed_price_cents - b.landed_price_cents)[0];
}

function mapRoute(rt: Record<string, unknown>): CatalogueRoute {
  const dutiesStatus = (rt.duties_status as DutiesStatus) ?? 'estimate';
  const incoterm = String(rt.incoterm ?? 'DDP').toUpperCase() === 'DAP' ? 'DAP' : 'DDP';
  const dutiesKnown = incoterm === 'DAP' || (dutiesStatus !== 'not_known_yet' && rt.duties_cents != null);
  const prod = rt.product_cents != null ? Number(rt.product_cents) : null;
  const proc = rt.processing_cents != null ? Number(rt.processing_cents) : null;
  const ship = rt.shipping_cents != null ? Number(rt.shipping_cents) : null;
  const dut = rt.duties_cents != null ? Number(rt.duties_cents) : null;
  const fallbackSum = (prod ?? 0) + (proc ?? 0) + (ship ?? 0) + (dut ?? 0);
  const landed = rt.landed_price_cents != null ? Number(rt.landed_price_cents) : fallbackSum;
  return {
    destination_country: String(rt.destination_country),
    shipping_method: rt.shipping_method as ShipType,
    incoterm,
    product_cents: prod,
    processing_cents: proc,
    shipping_cents: ship,
    duties_cents: dut,
    duties_status: dutiesStatus,
    duties_label: rt.duties_label ? String(rt.duties_label) : null,
    duties_known: dutiesKnown,
    landed_price_cents: landed,
    billed_weight_g: rt.billed_weight_g != null ? Number(rt.billed_weight_g) : null,
    est_days_min: Number(rt.est_days_min ?? 5),
    est_days_max: Number(rt.est_days_max ?? 10),
  };
}

function mapVariants(raw: unknown): CatalogueVariant[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((v) => ({
    id: String(v.id),
    model_no: String(v.model_no),
    options: (v.options && typeof v.options === 'object' ? v.options : {}) as Record<string, string>,
    price_adjust_cents: Number(v.price_adjust_cents ?? 0),
    stock_status: (v.stock_status as StockStatus) ?? 'in_stock',
  }));
}

export async function getDropshipCountries(): Promise<MerchantCountry[]> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('get_dropship_countries');
  if (error) throw new Error(`Could not load dropship countries: ${error.message}`);
  return ((data ?? []) as MerchantCountry[]).map((r) => ({
    country: String(r.country).toUpperCase().trim(),
    locked_by_staff: Boolean(r.locked_by_staff),
    has_active_routes: Boolean(r.has_active_routes),
  }));
}

export async function getDropshipCatalogue(params: {
  country: string;
  search?: string | null;
  category?: string | null;
  page?: number;
}): Promise<{ rows: CatalogueRow[]; totalCount: number }> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('get_dropship_catalogue', {
    p_country: params.country,
    p_search: params.search ?? null,
    p_category: params.category ?? null,
    p_page: Math.max(1, params.page ?? 1),
  });
  if (error) throw new Error(`Could not load the catalogue: ${error.message}`);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const flagsRaw = (r.restricted_flags && typeof r.restricted_flags === 'object' ? r.restricted_flags : {}) as Record<string, unknown>;
    return {
      product_id: String(r.product_id),
      model_no: String(r.model_no),
      title: String(r.title),
      description: r.description ? String(r.description) : null,
      category: r.category ? String(r.category) : null,
      images: Array.isArray(r.images) ? (r.images as string[]) : [],
      specs: (r.specs && typeof r.specs === 'object' ? r.specs : {}) as Record<string, string>,
      weight_g: Number(r.weight_g ?? 0),
      dimensions_cm: (r.dimensions_cm && typeof r.dimensions_cm === 'object' ? r.dimensions_cm : null) as CatalogueRow['dimensions_cm'],
      min_order_qty: Number(r.min_order_qty ?? 1),
      fulfilment_type: (r.fulfilment_type === 'extended_catalog' ? 'extended_catalog' : 'fast_ship') as FulfilmentType,
      only_for_you: Boolean(r.only_for_you),
      only_for_you_count: Number(r.only_for_you_count ?? 0),
      sourced_rfq_code: r.sourced_rfq_code ? String(r.sourced_rfq_code) : null,
      has_battery: Boolean(r.has_battery),
      restricted_flags: {
        battery: Boolean(flagsRaw.battery),
        liquid: Boolean(flagsRaw.liquid),
        magnet: Boolean(flagsRaw.magnet),
        powder: Boolean(flagsRaw.powder),
        fragile: Boolean(flagsRaw.fragile),
      },
      stock_status: (r.stock_status as StockStatus) ?? 'in_stock',
      variants: mapVariants(r.variants),
      routes: Array.isArray(r.routes) ? (r.routes as Record<string, unknown>[]).map(mapRoute) : [],
      total_count: Number(r.total_count ?? 0),
    };
  });
  return { rows, totalCount: rows[0]?.total_count ?? 0 };
}

export async function getDropshipProduct(id: string, country: string): Promise<Detail | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('get_dropship_product', {
    p_product_id: id,
    p_country: country,
  });
  if (error) throw new Error(`Could not load product: ${error.message}`);
  if (!data || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  const scRaw = (r.shipping_customs && typeof r.shipping_customs === 'object' ? r.shipping_customs : {}) as Record<string, unknown>;
  const sc: ShippingCustomsInfo = {
    weight_g: scRaw.weight_g != null ? Number(scRaw.weight_g) : null,
    box_l_cm: scRaw.box_l_cm != null ? Number(scRaw.box_l_cm) : null,
    box_w_cm: scRaw.box_w_cm != null ? Number(scRaw.box_w_cm) : null,
    box_h_cm: scRaw.box_h_cm != null ? Number(scRaw.box_h_cm) : null,
    billed_weight_g: scRaw.billed_weight_g != null ? Number(scRaw.billed_weight_g) : null,
    hs_code: scRaw.hs_code ? String(scRaw.hs_code) : null,
    hs_verified: Boolean(scRaw.hs_verified),
    origin_country: scRaw.origin_country ? String(scRaw.origin_country) : null,
    has_battery: Boolean(scRaw.has_battery),
    has_liquid: Boolean(scRaw.has_liquid),
    has_magnet: Boolean(scRaw.has_magnet),
    has_powder: Boolean(scRaw.has_powder),
    is_fragile: Boolean(scRaw.is_fragile),
  };

  return {
    product_id: String(r.product_id),
    model_no: String(r.model_no),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    category: r.category ? String(r.category) : null,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    specs: (r.specs && typeof r.specs === 'object' ? r.specs : {}) as Record<string, string>,
    weight_g: Number(r.weight_g ?? 0),
    dimensions_cm: (r.dimensions_cm && typeof r.dimensions_cm === 'object' ? r.dimensions_cm : null) as Detail['dimensions_cm'],
    min_order_qty: Number(r.min_order_qty ?? 1),
    fulfilment_type: (r.fulfilment_type === 'extended_catalog' ? 'extended_catalog' : 'fast_ship') as FulfilmentType,
    only_for_you: Boolean(r.only_for_you),
    sourced_rfq_code: r.sourced_rfq_code ? String(r.sourced_rfq_code) : null,
    has_battery: sc.has_battery,
    restricted_flags: {
      battery: sc.has_battery,
      liquid: sc.has_liquid,
      magnet: sc.has_magnet,
      powder: sc.has_powder,
      fragile: sc.is_fragile,
    },
    stock_status: (r.stock_status as StockStatus) ?? 'in_stock',
    shipping_customs: sc,
    variants: mapVariants(r.variants),
    price_tiers: Array.isArray(r.price_tiers)
      ? (r.price_tiers as Record<string, unknown>[]).map((t) => ({
          min_qty: Number(t.min_qty),
          unit_price_cents: Number(t.unit_price_cents),
        }))
      : [],
    routes: Array.isArray(r.routes) ? (r.routes as Record<string, unknown>[]).map(mapRoute) : [],
    all_country_routes: Array.isArray(r.all_country_routes)
      ? (r.all_country_routes as Record<string, unknown>[]).map(mapRoute)
      : [],
  };
}

export async function getDropshipOrderQuote(params: {
  variantId: string;
  qty: number;
  country: string;
  method: ShipType;
  incoterm?: 'DDP' | 'DAP';
  quoteMode?: 'catalogue' | 'order';
}): Promise<DropshipOrderQuoteResult> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('get_dropship_order_quote', {
    p_lines: [{ variant_id: params.variantId, qty: Math.max(1, Math.round(params.qty)) }],
    p_country: params.country,
    p_method: params.method,
    p_incoterm: params.incoterm ?? 'DDP',
    p_buyer_currency: 'USD',
    p_fx_rate_to_usd: null,
    p_quote_mode: params.quoteMode ?? 'catalogue',
  });
  if (error) return { ok: false, message: error.message };
  if (!data || typeof data !== 'object') return { ok: false, message: 'No quote returned.' };
  const q = data as Record<string, unknown>;
  return {
    ok: Boolean(q.ok),
    code: q.code ? String(q.code) : undefined,
    message: q.message ? String(q.message) : undefined,
    country: q.country ? String(q.country) : undefined,
    shipping_method: q.shipping_method as ShipType | undefined,
    incoterm: q.incoterm === 'DAP' ? 'DAP' : 'DDP',
    total_qty: q.total_qty != null ? Number(q.total_qty) : undefined,
    actual_weight_g: q.actual_weight_g != null ? Number(q.actual_weight_g) : undefined,
    volumetric_weight_g: q.volumetric_weight_g != null ? Number(q.volumetric_weight_g) : undefined,
    billed_weight_g: q.billed_weight_g != null ? Number(q.billed_weight_g) : undefined,
    days_min: q.days_min != null ? Number(q.days_min) : undefined,
    days_max: q.days_max != null ? Number(q.days_max) : undefined,
    product_cents: q.product_cents != null ? Number(q.product_cents) : undefined,
    processing_cents: q.processing_cents != null ? Number(q.processing_cents) : undefined,
    shipping_cents: q.shipping_cents != null ? Number(q.shipping_cents) : undefined,
    declared_value_usd_cents: q.declared_value_usd_cents != null ? Number(q.declared_value_usd_cents) : undefined,
    duties_cents: q.duties_cents != null ? Number(q.duties_cents) : null,
    duties_status: (q.duties_status as DutiesStatus) ?? undefined,
    duties_label: q.duties_label ? String(q.duties_label) : null,
    total_known_cents: q.total_known_cents != null ? Number(q.total_known_cents) : undefined,
    total_cents: q.total_cents != null ? Number(q.total_cents) : null,
  };
}

export async function listMyDropshipRequests(): Promise<DropshipRequestRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('list_my_dropship_requests');
  if (error) throw new Error(`Could not load your product requests: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    rfq_id: String(r.rfq_id),
    rfq_code: String(r.rfq_code),
    title: String(r.title),
    category_label: r.category_label ? String(r.category_label) : null,
    monthly_volume_band: r.monthly_volume_band ? String(r.monthly_volume_band) : null,
    ship_to_countries: Array.isArray(r.ship_to_countries) ? (r.ship_to_countries as string[]) : [],
    target_landed_cents: r.target_landed_cents != null ? Number(r.target_landed_cents) : null,
    wants_brand: Boolean(r.wants_brand),
    fee_cents: Number(r.fee_cents ?? 0),
    merchant_status: String(r.merchant_status ?? 'submitted'),
    merchant_label: String(r.merchant_label ?? 'Submitted'),
    quoted_landed_cents: r.quoted_landed_cents != null ? Number(r.quoted_landed_cents) : null,
    quoted_country: r.quoted_country ? String(r.quoted_country) : null,
    dropship_product_id: r.dropship_product_id ? String(r.dropship_product_id) : null,
    dropship_model_no: r.dropship_model_no ? String(r.dropship_model_no) : null,
    dropship_product_status: r.dropship_product_status ? String(r.dropship_product_status) : null,
    created_at: String(r.created_at),
  }));
}

export async function listMyDropshipSampleOrders(productId?: string | null): Promise<DropshipSampleOrderRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('list_my_dropship_sample_orders', {
    p_product_id: productId ?? null,
  });
  if (error) throw new Error(`Could not load sample orders: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    store_order_id: String(r.store_order_id),
    order_number: String(r.order_number),
    product_id: String(r.product_id),
    variant_id: String(r.variant_id),
    model_no: String(r.model_no),
    title_snapshot: String(r.title_snapshot),
    variant_label: r.variant_label ? String(r.variant_label) : null,
    qty: Number(r.qty ?? 1),
    destination_country: String(r.destination_country),
    shipping_method: r.shipping_method as ShipType,
    incoterm: r.incoterm === 'DAP' ? 'DAP' : 'DDP',
    product_cents: Number(r.product_cents ?? 0),
    processing_cents: Number(r.processing_cents ?? 0),
    shipping_cents: Number(r.shipping_cents ?? 0),
    duties_cents: r.duties_cents != null ? Number(r.duties_cents) : null,
    total_cents: Number(r.total_cents ?? 0),
    merchant_status: String(r.merchant_status ?? 'processing'),
    tracking_no: r.tracking_no ? String(r.tracking_no) : null,
    created_at: String(r.created_at),
    delivered_at: r.delivered_at ? String(r.delivered_at) : null,
  }));
}

export type ImportItem = {
  id: string;
  product_id: string;
  variant_id: string | null;
  service: ShipType | null;
  price_cents: number | null;
  created_at: string;
};

export async function importList(orgId: string): Promise<Map<string, ImportItem>> {
  const sb = await createClient();
  const { data } = await sb
    .from('dropship_import_list')
    .select('id, product_id, variant_id, service, price_cents, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  return new Map(
    (data ?? []).map((r) => [
      r.product_id as string,
      {
        id: r.id as string,
        product_id: r.product_id as string,
        variant_id: (r.variant_id as string) ?? null,
        service: (r.service as ShipType) ?? null,
        price_cents: r.price_cents != null ? Number(r.price_cents) : null,
        created_at: r.created_at as string,
      },
    ]),
  );
}
