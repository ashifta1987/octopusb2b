import 'server-only';
import { permanentRedirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { classifyPackRef, packFallback, packTargetFromMatches, whOrderPath } from '@/lib/warehouse-retire';

/**
 * Warehouse OS · W7 — server side of the retired Dropship fulfilment URLs (owner, 26 Nov 2026: "remove the old, follow the new").
 * People who work in a warehouse (wh_my_warehouses: admin, warehouse:view or a warehouse role) are sent to the Warehouse OS
 * screen for good; everyone else gets 'no_access' so the page can say where the work moved (instead of /forbidden).
 */
export async function isWarehouseMember(): Promise<boolean> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_my_warehouses');
  return !error && Array.isArray(data) && data.length > 0;
}

export async function handOffToWarehouseOs(target: string | (() => Promise<string>)): Promise<'no_access'> {
  if (!(await isWarehouseMember())) return 'no_access';
  const path = typeof target === 'string' ? target : await target();
  permanentRedirect(path);
}

/**
 * /office/dropship/pack/[order] → the Warehouse OS order when it maps to exactly one (WO code, store order id or DSO number),
 * else the Dropship orders list (searched by the number when there is one). The search is the existing staff RPC
 * wh_orders_board (any status, Dropship source, only warehouses the person sees) — wh_orders.store_order_id is not readable
 * directly by staff, and store_orders.order_number is read with the caller's own rights (RLS).
 */
export async function resolveDropshipPackTarget(raw: string): Promise<string> {
  const ref = classifyPackRef(raw);
  if (ref.kind === 'wo') return whOrderPath(ref.code);
  if (ref.kind === 'none') return packFallback(null);
  const sb = await createClient();
  let q: string | null = ref.kind === 'number' ? ref.q : null;
  if (ref.kind === 'store_order_id') {
    const { data } = await sb.from('store_orders').select('order_number').eq('id', ref.id).maybeSingle();
    q = (data?.order_number as string | null | undefined) ?? null;
  }
  if (!q) return packFallback(null);
  const { data, error } = await sb.rpc('wh_orders_board', { p_warehouse: null, p_status: null, p_source: 'dropship', p_q: q });
  if (error) return packFallback(q);
  const codes = (((data as { orders?: { code?: string }[] } | null)?.orders) ?? []).map((o) => String(o.code ?? ''));
  return packTargetFromMatches(q, codes);
}
