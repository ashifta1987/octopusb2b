import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { PriceBand, Rounding } from '@/lib/dropship-pricing';

/**
 * Octopus Dropship · Step 6 + 6b merchant — data loaders. Merchants read ONLY through the SECURITY DEFINER RPCs of
 * migration *_ds6_import_editor_pricing_packing (ds_import_list, ds_listing_get, ds_push_page, ds_pushed_list,
 * ds_pricing_get, ds_packing_get). They return merchant-safe fields only: the merchant's own copy, DS model numbers,
 * landed cost (product + processing + shipping + duties), prices, stock LABELS — never supplier, Sourcing or Octopus cost data.
 */

export type StockLabel = 'in_stock' | 'low' | 'out' | 'extended';
export type Problem = { code: string; message: string; blocking: boolean; fields?: { field: string; kind: string }[] };

export type Rules = {
  saved: boolean;
  bands: PriceBand[];
  rounding: Rounding;
  compare_at_bp: 2500 | 5000 | null;
  min_profit_bp: number;
  store_currency: string;
  fx_threshold_bp: number | null;
  main_market: string | null;
  when_landed_up: 'reprice' | 'ask' | 'alert';
  when_landed_down: 'keep' | 'reprice';
  when_out_of_stock: 'draft' | 'sold_out' | 'nothing';
  check_every_hours: 1 | 3 | 6 | 24;
  alert_low_stock: boolean;
  email_alerts: boolean;
  saved_at: string | null;
};

export type Fx = { currency: string; rate: number | string; source_name: string | null; effective_from: string | null } | null;

export type Landed =
  | { ok: true; landed_usd_cents: number; product_cents: number; processing_cents: number; shipping_cents: number; duties_cents: number; packaging_cents: number; incoterm: 'DDP' | 'DAP'; country: string; method: string; billed_weight_g: number }
  | { ok: false; code: string; message: string };

export type ListingVariant = {
  variant_id: string;
  model_no: string;
  options: Record<string, string>;
  stock_status: StockLabel;
  include: boolean;
  store_sku: string;
  landed: Landed | null;
  landed_usd_cents: number | null;
  rule_price_minor: number | null;
  rule_compare_at_minor: number | null;
  rule_band: number | null;
  manual: boolean;
  manual_price_minor: number | null;
  manual_compare_at_minor: number | null;
  price_minor: number | null;
  compare_at_minor: number | null;
  profit_bp: number | null;
  below_min: boolean;
};

export type ListingState = {
  product_id: string;
  model_no: string;
  octopus_title: string;
  octopus_description: string;
  category: string | null;
  octopus_images: string[];
  only_for_you: boolean;
  in_import_list: boolean;
  listing_saved: boolean;
  saved_at: string | null;
  title: string;
  description: string;
  image_urls: string[];
  vendor: string | null;
  product_type: string | null;
  collection: string | null;
  tags: string[];
  handle: string | null;
  seo_title: string | null;
  seo_description: string | null;
  publish_as: 'draft' | 'active';
  sync_stock: boolean;
  sync_price: boolean;
  price_mode: 'rule' | 'manual';
  variants: ListingVariant[];
  variants_total: number;
  variants_included: number;
  currency: string;
  currency_exponent: number;
  fx: Fx;
  market: string | null;
  method: string;
  duty_mode: 'DDP' | 'DAP';
  packaging_extra_cents: number;
  rules: Rules;
  min_profit_bp: number;
  lowest_profit_bp: number | null;
  store: { id: string; shop_domain: string; currency: string | null } | null;
  link: { id: string; store_status: string; sync_state: string; last_pushed_at: string | null } | null;
  problems: Problem[];
  ready: boolean;
};

export type ImportRow = {
  product_id: string;
  model_no: string;
  title: string;
  image: string | null;
  only_for_you: boolean;
  variants_total: number;
  variants_included: number;
  landed_min: number | null;
  price_min: number | null;
  price_max: number | null;
  lowest_profit_bp: number | null;
  problems: Problem[];
  ready: boolean;
  listing_saved: boolean;
  price_mode: 'rule' | 'manual';
  linked: boolean;
  example: ListingVariant | null;
  added_at: string;
};

export type ImportListData = {
  rows: ImportRow[];
  counts: { import: number; pushed: number; failed: number };
  rules: Rules;
  market: string | null;
  store: { id: string; shop_domain: string; shop_currency: string | null } | null;
};

export type JobView = {
  id: string;
  batch_id: string;
  product_id: string;
  kind: 'push' | 'unlink';
  status: 'queued' | 'running' | 'retry_wait' | 'done' | 'failed' | 'blocked' | 'cancelled';
  attempts: number;
  next_attempt_at: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
  title: string;
  model_no: string;
  publish_as: string | null;
  below_min_confirmed: boolean;
};

export type PushPageData = {
  dropship_status: 'on' | 'paused' | 'off';
  store: { id: string; shop_domain: string; currency: string | null } | null;
  store_needs_reconnect: boolean;
  items: {
    product_id: string;
    model_no: string;
    title: string;
    variants_included: number;
    ready: boolean;
    problems: Problem[];
    collection: string | null;
    publish_as: 'draft' | 'active';
    currency: string;
    below: { variant_id: string; options: Record<string, string>; price_minor: number; profit_bp: number }[];
    min_profit_bp: number;
  }[];
  batches: { id: string; kind: 'push' | 'unlink'; created_at: string; options: Record<string, unknown>; jobs: JobView[] }[];
};

export type PushedData = {
  store: { shop_domain: string; currency: string | null } | null;
  store_needs_reconnect: boolean;
  import_count: number;
  rows: {
    product_id: string;
    model_no: string;
    title: string;
    store_status: 'draft' | 'active' | 'archived';
    sync_state: 'in_sync' | 'needs_you' | 'out_of_stock' | 'price_updated' | 'failed';
    sync_message: string | null;
    last_synced_at: string | null;
    stock_status: StockLabel;
    price_min: number | null;
    price_max: number | null;
    currency: string | null;
    open_job: JobView | null;
  }[];
  failed: JobView[];
};

export type PricingData = {
  rules: Rules;
  currency: string;
  currency_exponent: number;
  currency_from_store: boolean;
  supported_currencies: string[];
  fx: Fx;
  fx_rates: Record<string, Fx>;
  market: string | null;
  markets: string[];
  duty_mode: 'DDP' | 'DAP';
  method: string;
  sample: { title: string; options: Record<string, string>; landed: Landed | null } | null;
  store: { shop_domain: string; currency: string | null } | null;
  approvals: {
    id: string; product_id: string; title: string; model_no: string; reason_code: string;
    old_landed_usd_cents: number | null; new_landed_usd_cents: number | null; old_price_minor: number | null; new_price_minor: number | null;
    currency: string | null; old_profit_bp: number | null; new_profit_bp: number | null; created_at: string;
  }[];
  sync_log: { created_at: string; product: string; kind: string; change: string; result: string }[];
};

export type PackingData = {
  saved: boolean;
  settings: {
    default_packaging: 'standard' | 'protective' | 'branded';
    branded_sku_id: string | null;
    insert_card: boolean;
    insert_card_sku_id: string | null;
    sticker: boolean;
    sticker_sku_id: string | null;
    gift_message: boolean;
    packing_slip: 'brand_no_prices' | 'none';
    insurance: boolean;
    signature: boolean;
    default_method: 'economy' | 'standard' | 'express';
    fallback_method: 'cheapest_on_time' | 'economy' | 'standard' | 'express';
  };
  fees: {
    version: number;
    processing_first_cents: number;
    processing_extra_cents: number;
    standard_packaging_included: boolean;
    branded_cents: number | null;
    protective_cents: number | null;
    insert_cents: number | null;
    sticker_cents: number | null;
    signature_cents: number | null;
    insurance_bp: number | null;
    weigh_tolerance_g: number | null;
    weigh_tolerance_pct: number | null;
    dispute_window_days: number | null;
  } | null;
  own_stock: { id: string; sku: string; name: string; available: number }[];
  markets: { country: string; mode: 'DDP' | 'DAP'; saved: boolean }[];
  methods: { method: 'economy' | 'standard' | 'express'; days_min: number | null; days_max: number | null }[];
  store: { shop_domain: string } | null;
  rate_mappings: { id: string; rate_name: string; countries: string[]; method: string | null }[];
  market: string | null;
  example: (Record<string, unknown> & { ok?: boolean; title?: string }) | null;
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export const getImportList = () => call<ImportListData>('ds_import_list');
export const getListing = (productId: string) => call<ListingState | null>('ds_listing_get', { p_product_id: productId });
export const getPushPage = (productIds: string[]) => call<PushPageData>('ds_push_page', { p_product_ids: productIds });
export const getPushedList = () => call<PushedData>('ds_pushed_list');
export const getPricingPage = () => call<PricingData>('ds_pricing_get');
export const getPackingPage = () => call<PackingData>('ds_packing_get');

/** "STORE_NOT_CONNECTED: Connect a store first." → "Connect a store first." (the sentence after the code is plain words) */
export function rpcMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  const code = m.split(':')[0].trim();
  const MAP: Record<string, string> = {
    DROPSHIP_PAUSED: 'Dropshipping is paused for your company, so nothing new can be started. Orders in progress, your wallet and support keep working.',
    DROPSHIP_NOT_ENABLED: 'Dropshipping is not switched on for your company.',
    FEATURE_OFF: 'This part of Octopus Dropship is not switched on yet.',
    FORBIDDEN: 'You do not have permission to do this.',
    NOT_FOUND: 'This item was not found.',
    INVALID_INPUT: 'Please check the form and try again.',
  };
  if (/^[A-Z_]+$/.test(code) && m.includes(':')) {
    const rest = m.slice(m.indexOf(':') + 1).trim();
    if (rest) return rest;
  }
  return MAP[code] ?? (m || 'Something went wrong. Please try again.');
}

