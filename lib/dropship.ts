import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { requireCustomer } from '@/lib/auth';
import { getAccountContext, isStaging, serviceOn } from '@/lib/core/account';

/**
 * Dropshipping catalogue v2 (migrations 204 & 205).
 * Merchants read ONLY through the SECURITY DEFINER RPCs get_dropship_catalogue, get_dropship_product and
 * get_dropship_countries, which verify auth.uid() is an eligible merchant with dropshipping switched on ('on'/'trial')
 * and return only allowlisted columns (no supplier name/code/ID/SKU, no source_type, no carrier, no cost or margin).
 */
export type ShipType = 'express' | 'standard' | 'economy';
export type StockStatus = 'in_stock' | 'low' | 'out';

export type CatalogueRoute = {
  destination_country: string;
  shipping_method: ShipType;
  landed_price_cents: number;
  est_days_min: number;
  est_days_max: number;
};

export type CatalogueVariant = {
  id: string;
  octopus_sku: string;
  options: Record<string, string>;
  price_adjust_cents: number;
  stock_status: StockStatus;
};

export type CatalogueRow = {
  product_id: string;
  octopus_sku: string;
  title: string;
  description: string | null;
  category: string | null;
  images: string[];
  specs: Record<string, string>;
  weight_g: number;
  dimensions_cm: { l?: number; w?: number; h?: number } | null;
  min_order_qty: number;
  stock_status: StockStatus;
  variants: CatalogueVariant[];
  routes: CatalogueRoute[];
  total_count: number;
};

export type Detail = Omit<CatalogueRow, 'total_count'>;

export type MerchantCountry = {
  country: string;
  locked_by_staff: boolean;
  has_active_routes: boolean;
};

export const SHIP_LABEL: Record<ShipType, string> = {
  express: 'Express',
  standard: 'Standard',
  economy: 'Economy',
};

export const STOCK_LABEL: Record<StockStatus, [string, string]> = {
  in_stock: ['In stock', 'bg-ok-bg text-ok'],
  low: ['Low stock', 'bg-warn-bg text-warn'],
  out: ['Out of stock', 'bg-bad-bg text-bad'],
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
    markup: Number.isFinite(markup) && markup > 1 ? markup : null,
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
  if (!markup) return null;
  return Math.max(99, Math.ceil((landedCents * markup) / 100) * 100 - 1);
}

export function profit(priceCents: number, landedCents: number) {
  const p = priceCents - landedCents;
  return { cents: p, pct: priceCents > 0 ? Math.round((p / priceCents) * 100) : 0 };
}

/** Pick the requested shipping method if available, otherwise the fastest (then lowest landed price) route. */
export function pickRoute(routes: CatalogueRoute[], want?: ShipType | null): CatalogueRoute | null {
  if (!routes?.length) return null;
  if (want) return routes.find((r) => r.shipping_method === want) ?? null;
  return [...routes].sort((a, b) => a.est_days_min - b.est_days_min || a.landed_price_cents - b.landed_price_cents)[0];
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
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_id: String(r.product_id),
    octopus_sku: String(r.octopus_sku),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    category: r.category ? String(r.category) : null,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    specs: (r.specs && typeof r.specs === 'object' ? r.specs : {}) as Record<string, string>,
    weight_g: Number(r.weight_g ?? 0),
    dimensions_cm: (r.dimensions_cm && typeof r.dimensions_cm === 'object' ? r.dimensions_cm : null) as CatalogueRow['dimensions_cm'],
    min_order_qty: Number(r.min_order_qty ?? 1),
    stock_status: (r.stock_status as StockStatus) ?? 'in_stock',
    variants: Array.isArray(r.variants)
      ? (r.variants as Record<string, unknown>[]).map((v) => ({
          id: String(v.id),
          octopus_sku: String(v.octopus_sku),
          options: (v.options && typeof v.options === 'object' ? v.options : {}) as Record<string, string>,
          price_adjust_cents: Number(v.price_adjust_cents ?? 0),
          stock_status: (v.stock_status as StockStatus) ?? 'in_stock',
        }))
      : [],
    routes: Array.isArray(r.routes)
      ? (r.routes as Record<string, unknown>[]).map((rt) => ({
          destination_country: String(rt.destination_country),
          shipping_method: rt.shipping_method as ShipType,
          landed_price_cents: Number(rt.landed_price_cents),
          est_days_min: Number(rt.est_days_min),
          est_days_max: Number(rt.est_days_max),
        }))
      : [],
    total_count: Number(r.total_count ?? 0),
  }));
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
  return {
    product_id: String(r.product_id),
    octopus_sku: String(r.octopus_sku),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    category: r.category ? String(r.category) : null,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    specs: (r.specs && typeof r.specs === 'object' ? r.specs : {}) as Record<string, string>,
    weight_g: Number(r.weight_g ?? 0),
    dimensions_cm: (r.dimensions_cm && typeof r.dimensions_cm === 'object' ? r.dimensions_cm : null) as Detail['dimensions_cm'],
    min_order_qty: Number(r.min_order_qty ?? 1),
    stock_status: (r.stock_status as StockStatus) ?? 'in_stock',
    variants: Array.isArray(r.variants)
      ? (r.variants as Record<string, unknown>[]).map((v) => ({
          id: String(v.id),
          octopus_sku: String(v.octopus_sku),
          options: (v.options && typeof v.options === 'object' ? v.options : {}) as Record<string, string>,
          price_adjust_cents: Number(v.price_adjust_cents ?? 0),
          stock_status: (v.stock_status as StockStatus) ?? 'in_stock',
        }))
      : [],
    routes: Array.isArray(r.routes)
      ? (r.routes as Record<string, unknown>[]).map((rt) => ({
          destination_country: String(rt.destination_country),
          shipping_method: rt.shipping_method as ShipType,
          landed_price_cents: Number(rt.landed_price_cents),
          est_days_min: Number(rt.est_days_min),
          est_days_max: Number(rt.est_days_max),
        }))
      : [],
  };
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
