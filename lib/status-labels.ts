import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * Batch 3 (F-09): every customer/merchant status pill reads its wording from status_mappings (via the customer-safe
 * get_status_labels() RPC — labels only, never internal staff stages). Falls back to a tidy version of the raw value.
 */
export type StatusDomain = 'store_order_stage' | 'sourcing_rfq';
export type StatusLabelRow = { source_status: string; merchant_status: string; merchant_label: string };

export const getStatusLabelRows = cache(async (domain: StatusDomain): Promise<StatusLabelRow[]> => {
  const sb = await createClient();
  const { data } = await sb.rpc('get_status_labels', { p_domain: domain });
  return (data ?? []) as StatusLabelRow[];
});

/** source_status → label (e.g. sourcing_rfq: 'quoted' → 'Quote ready'). */
export async function sourceStatusLabels(domain: StatusDomain): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of await getStatusLabelRows(domain)) out[r.source_status] = r.merchant_label;
  return out;
}

/**
 * merchant_status → label for store orders (e.g. 'on_hold' → 'On hold'). Several staff stages share one merchant
 * status; the canonical store_order_stage row whose source_status equals the merchant status (or the first by sort) wins.
 */
export async function merchantStatusLabels(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const rows = await getStatusLabelRows('store_order_stage');
  for (const r of rows) if (r.source_status === r.merchant_status) out[r.merchant_status] = r.merchant_label;
  for (const r of rows) if (!out[r.merchant_status]) out[r.merchant_status] = r.merchant_label;
  return out;
}

/** "on_hold" → "On hold" when no mapping exists (never shows underscores). */
export function tidyStatus(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '—';
}
