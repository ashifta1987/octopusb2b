'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { rateLimit } from '@/lib/api/rate-limit';
import { detectPlatform } from '@/lib/connectors/detect';
import { ORDERS_CSV_MAX_BYTES, parseOrdersCsv, type ColumnMap } from '@/lib/connectors/csv';
import { toIntakeOrder } from '@/lib/connectors/formats';
import { isRequestPlatform } from '@/lib/connectors/platforms';
import type { DetectResult } from '@/lib/connectors/types';
import type { ImportResult, StoreLinkState } from '@/lib/dropship-c0';

/**
 * C0 · merchant actions for Integrations: check a store link (server-side, SSRF-guarded), request a platform (the DS14 waiting list),
 * import an orders CSV (ds_order_intake, channel 'csv'). A link alone gives no access: nothing here connects a store, stores a token
 * or creates a store_connections row. Every Server Function checks the session again (they are reachable by direct POST).
 */
export type C0Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string };
const PATH = '/account/dropship/integrations';

export async function detectStoreLinkAction(url: string): Promise<C0Result<{ detect: DetectResult; state: StoreLinkState | null }>> {
  await requireDropshipV2Merchant(PATH);
  const s = await getSession();
  const p = z.string().trim().min(1).max(300).safeParse(url);
  if (!p.success) return { ok: false, message: 'Paste your store address, like mystore.com.' };
  // 10 checks a minute per person (each one makes an outbound request)
  const rl = rateLimit(`c0-detect:${s?.userId ?? 'anon'}`, 10, 60_000);
  if (!rl.ok) return { ok: false, message: `Too many checks. Try again in ${rl.retryAfterSec} seconds.` };
  const detect = await detectPlatform(p.data);
  let state: StoreLinkState | null = null;
  if (detect.host) {
    const sb = await createClient();
    const platform = detect.outcome === 'found' || detect.outcome === 'marketplace' ? detect.platform : 'unknown';
    const { data, error } = await sb.rpc('c0_store_link_result', { p_host: detect.host, p_platform: platform, p_outcome: detect.outcome });
    if (error) return { ok: false, message: rpcMessage(error) };
    state = data as StoreLinkState;
  }
  return { ok: true, data: { detect, state } };
}

export async function requestPlatformAction(platform: string, name: string): Promise<C0Result> {
  await requireDropshipV2Merchant(PATH);
  if (!isRequestPlatform(platform)) return { ok: false, message: 'Choose a platform from the list.' };
  const sb = await createClient();
  const { error } = await sb.rpc('c0_request_platform', { p_platform: platform, p_name: platform === 'other' ? name.trim().slice(0, 60) : null });
  if (error) return { ok: false, message: rpcMessage(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

const MapSchema = z.record(z.string(), z.number().int().min(0).max(200)).optional();

/** The file is read again on the server (never trust the browser's preview); orders go through ds_order_intake one by one. */
export async function importOrdersCsvAction(fileName: string, text: string, map?: ColumnMap): Promise<C0Result<ImportResult>> {
  await requireDropshipV2Merchant(`${PATH}/file`);
  if (typeof text !== 'string' || text.length === 0) return { ok: false, message: 'The file is empty.' };
  if (Buffer.byteLength(text, 'utf8') > ORDERS_CSV_MAX_BYTES) return { ok: false, message: 'The file is larger than 1 MB. Split it into smaller files.' };
  const m = MapSchema.safeParse(map);
  if (!m.success) return { ok: false, message: 'Check the column choices.' };
  const parsed = parseOrdersCsv(text, m.data as ColumnMap | undefined);
  if (!parsed.orders.length) return { ok: false, message: parsed.errors[0] ? `Row ${parsed.errors[0].row}: ${parsed.errors[0].message}` : 'No orders found in the file.' };
  const sha = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  const sb = await createClient();
  const { data, error } = await sb.rpc('c0_csv_orders_import', {
    p_file_name: String(fileName || 'orders.csv').slice(0, 120),
    p_file_sha: sha,
    p_total_rows: parsed.totalRows,
    p_orders: parsed.orders.map((o) => ({ rows: o.rows, order: toIntakeOrder(o.order) })),
    p_parse_errors: parsed.errors,
  });
  if (error) return { ok: false, message: rpcMessage(error) };
  revalidatePath(`${PATH}/file`);
  revalidatePath('/account/dropship/orders');
  return { ok: true, data: data as ImportResult };
}
