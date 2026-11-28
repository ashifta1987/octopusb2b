/**
 * CONN S2b · the push queue and stock loops for non-Shopify stores (run by /api/cron/connector-sync and right after a merchant
 * pushes / unlinks). Deps injected; the server wiring is in runtime-server.ts.
 *   runPushJobs   c2b_push_claim → the platform's runner (WooCommerce: runWooPushJob) → ds_push_complete / ds_push_fail;
 *                 an auth refusal also marks the store "needs reconnect" once.
 *   runStockSync  c2b_stock_targets → setStockStatus per store → c2b_stock_done (remembered label, sync log, out of stock / failed).
 */
import { redact, type Rpc } from './runtime';
import { runWooPushJob, type ClaimedPushJob, type PushOutcome, type WooCaller } from './woocommerce-push';
import type { StockItem } from './woocommerce';
import type { ConnectionRef } from './types';

export type PushRuntimeDeps = {
  rpc: Rpc;
  loadConnection: (id: string) => Promise<ConnectionRef | null>;
  /** a REST caller bound to one WooCommerce connection */
  wooCaller: (conn: ConnectionRef) => WooCaller;
  setStockStatus: (conn: ConnectionRef, items: StockItem[]) => Promise<{ item: StockItem; ok: boolean; error?: string }[]>;
  media: (url: string) => string | null;
  worker?: string;
};

type Claimed = ClaimedPushJob & { store_connection_id: string; platform: string; org_id: string; product_id: string };
export type LoopSummary = { picked: number; ok: number; failed: number; errors: string[] };

export async function runPushJobs(deps: PushRuntimeDeps, limit = 5): Promise<LoopSummary> {
  const res: LoopSummary = { picked: 0, ok: 0, failed: 0, errors: [] };
  const jobs = ((await deps.rpc('c2b_push_claim', { p_platforms: ['woocommerce'], p_worker: deps.worker ?? 'connector-sync', p_limit: limit })) ?? []) as Claimed[];
  res.picked = jobs.length;
  const conns = new Map<string, ConnectionRef | null>();
  const refused = new Set<string>();
  for (const job of jobs) {
    let out: PushOutcome;
    if (!conns.has(job.store_connection_id)) conns.set(job.store_connection_id, await deps.loadConnection(job.store_connection_id));
    const conn = conns.get(job.store_connection_id);
    if (!conn) out = { ok: false, code: 'STORE_NOT_CONNECTED', message: 'The store is no longer connected. Connect it, then retry.', retryAfterS: null, permanent: true };
    else if (refused.has(conn.id)) out = { ok: false, code: 'STORE_ACCESS_EXPIRED', message: 'The store refused our keys. Reconnect WooCommerce, then retry.', retryAfterS: null, permanent: true };
    else if (job.platform !== 'woocommerce') out = { ok: false, code: 'NOT_SUPPORTED', message: 'Pushing to this platform is not available yet.', retryAfterS: null, permanent: true };
    else out = await runWooPushJob(job, { call: deps.wooCaller(conn), media: deps.media });
    try {
      if (out.ok) {
        await deps.rpc('ds_push_complete', { p_job_id: job.id, p_result: out.result });
        res.ok++;
      } else {
        await deps.rpc('ds_push_fail', { p_job_id: job.id, p_code: out.code, p_message: out.message, p_retry_after_s: out.retryAfterS, p_permanent: out.permanent });
        res.failed++;
        res.errors.push(`${out.code}: ${out.message}`);
        if (out.code === 'STORE_ACCESS_EXPIRED' && conn && !refused.has(conn.id)) {
          refused.add(conn.id);
          await deps.rpc('c1_connection_set_status', { p_id: conn.id, p_status: 'needs_reconnect', p_reason: 'The store refused our keys. Reconnect WooCommerce.' }).catch(() => undefined);
        }
      }
    } catch (e) {
      // the job stays "running" and is picked up again after 10 minutes
      res.failed++;
      res.errors.push(redact(e));
    }
  }
  return res;
}

type Target = { product_link_id: string; variant_id: string; org_id: string; store_connection_id: string; platform: string; product_id: string; product_gid: string; variant_gid: string; label: 'in_stock' | 'low' | 'out' | 'extended' };

export async function runStockSync(deps: PushRuntimeDeps, limit = 200): Promise<LoopSummary> {
  const res: LoopSummary = { picked: 0, ok: 0, failed: 0, errors: [] };
  const rows = ((await deps.rpc('c2b_stock_targets', { p_platforms: ['woocommerce'], p_limit: limit })) ?? []) as Target[];
  res.picked = rows.length;
  const byConn = new Map<string, Target[]>();
  for (const r of rows) byConn.set(r.store_connection_id, [...(byConn.get(r.store_connection_id) ?? []), r]);
  for (const [connId, list] of byConn) {
    const conn = await deps.loadConnection(connId);
    let items: { product_link_id: string; variant_id: string; label: string; ok: boolean; error?: string }[];
    if (!conn) {
      items = list.map((t) => ({ product_link_id: t.product_link_id, variant_id: t.variant_id, label: t.label, ok: false, error: 'The store is no longer connected.' }));
    } else {
      try {
        const asked = list.map((t) => ({ t, item: { productGid: t.product_gid, variantGid: t.variant_gid, status: t.label === 'out' ? 'outofstock' : 'instock' } as StockItem }));
        const answers = await deps.setStockStatus(conn, asked.map((a) => a.item));
        items = asked.map(({ t, item }) => {
          const a = answers.find((x) => x.item === item);
          return { product_link_id: t.product_link_id, variant_id: t.variant_id, label: t.label, ok: Boolean(a?.ok), error: a?.ok ? undefined : (a?.error ?? 'No answer from the store.') };
        });
      } catch (e) {
        const msg = redact(e);
        items = list.map((t) => ({ product_link_id: t.product_link_id, variant_id: t.variant_id, label: t.label, ok: false, error: msg }));
        if (/refused our keys|AUTH/i.test(msg)) await deps.rpc('c1_connection_set_status', { p_id: connId, p_status: 'needs_reconnect', p_reason: msg }).catch(() => undefined);
      }
    }
    await deps.rpc('c2b_stock_done', { p_items: items });
    res.ok += items.filter((i) => i.ok).length;
    res.failed += items.filter((i) => !i.ok).length;
    for (const i of items) if (!i.ok && i.error) res.errors.push(i.error);
  }
  return res;
}
