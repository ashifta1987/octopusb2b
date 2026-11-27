import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * C0 · loaders (one SECURITY DEFINER RPC per screen; merchant RPCs check the organisation + feature + team role, staff RPCs the
 * staff permission). No secret ever passes through here: store_credentials is service-role only and not read by any loader.
 */
export type CsvImport = {
  id: string; file_name: string; created_at: string; total_rows: number; orders: number; created: number; duplicates: number; failed: number;
  errors: { rows: number[]; message: string }[];
};
export type FilePage = { orders_on: boolean; can_import: boolean; imports: CsvImport[] };
export type ImportResult = {
  id: string; orders: number; created: number; duplicates: number; failed: number;
  results: { rows: number[]; external_order_id?: string; ok: boolean; duplicate: boolean; code?: string; message?: string; order_number?: string; hold_code?: string }[];
  errors: { rows: number[]; message: string }[];
};
export type StoreLinkState = {
  host: string; platform: string; outcome: string; requested: boolean; linked_elsewhere: boolean;
  connection: { id: string; platform: string; status: string; last_error: string | null; last_sync_at: string | null; connected_at: string | null } | null;
};
export type FeedRow = {
  model_no: string; variant_model_no: string; sku: string; title: string; description: string; option_text: string | null;
  price_minor: number | null; compare_at_minor: number | null; currency: string | null; weight_g: number | null; product_type: string | null; vendor: string | null; tags: string | null;
};
export type TrackingRow = {
  order_number: string; external_order_id: string | null; external_order_name: string | null; channel: string; shipped_at: string | null;
  tracking_token: string | null; tracking_numbers: string | null; tracking_company: string | null;
};
export type ConnectorHealth = {
  can_edit: boolean; checked_at: string;
  platforms: { platform: string; connected: number; connecting: number; needs_reconnect: number; failures_24h: number; last_error: string | null; last_error_at: string | null; requested: number }[];
  csv: { imports_24h: number; failed_rows_24h: number; orders_24h: number; merchants_30d: number; last_error: string | null };
  requested: { platform: string; merchants: number; last_at: string; names: string[] | null }[];
  tracking_names: { carrier: 'yunexpress' | '4px'; platform: string; company_name: string | null; use_branded_link: boolean; url_template: string | null; note: string | null; updated_at: string }[];
  poll: { targets: number; last_run: { at: string; status: number; summary: string } | null };
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export const getFilePage = () => call<FilePage>('c0_file_page');
export const getProductFeed = () => call<FeedRow[]>('c0_product_feed');
export const getTrackingExport = (from: string | null, to: string | null) => call<TrackingRow[]>('c0_tracking_export', { p_from: from, p_to: to });
export const getConnectorHealth = () => call<ConnectorHealth>('c0_connector_health');
