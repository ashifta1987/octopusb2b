/**
 * CONN S1 · connector runtime: the three loops behind /api/cron/connector-sync (and the webhook route's after()).
 *   processInbox    verified webhooks (webhook_inbox) → connector.webhookEvent → ds_order_intake / ds_order_channel_cancel / disconnect
 *   runOrderCatchup the hourly pull for webhooks a store never sent → connector.pullOrders → ds_order_intake
 *   runTasks        store tasks (dropship_channel_tasks) → connector.sendTracking / orderAction → c1_task_done (back-off in SQL)
 * Every dependency is injected (tests use fakes; lib/connectors/runtime-server.ts wires the service-role client), so this file has no
 * server-only import and never sees a token: connectors read their own credentials. Errors written back are short, single-line and
 * never contain a secret (redact()). A store that refuses our access (AUTH_FAILED) is marked "needs reconnect", never retried blindly.
 */
import { toIntakeOrder } from './formats';
import { isStorePlatform, type StorePlatform } from './platforms';
import { ConnectorError, type Connector, type ConnectionRef, type InternalShipment, type StoreTask } from './types';

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

export type RuntimeDeps = {
  /** service-role RPC; throws Error(message) on a database error */
  rpc: Rpc;
  getConnector: (id: StorePlatform) => Connector;
  /** the store connection as the connector needs it (null when gone) */
  loadConnection: (id: string) => Promise<ConnectionRef | null>;
  /** the store tracking company for this carrier on this platform (carrier_tracking_names; "Other" when not set) */
  trackingCompany: (carrier: string | null, platform: string) => Promise<string>;
  /** CONN S2: the current USD rate for a store currency (Octopus FX table, ds_fx_for), as "1 unit = x USD"; null when not set */
  fxToUsd?: (currency: string) => Promise<number | null>;
  /** CONN S2b: our variant ids for the store's own product / variant ids of products we pushed (dropship_variant_links) */
  resolveStoreVariants?: (connectionId: string, refs: string[]) => Promise<Record<string, string>>;
  /** absolute origin for the merchant-branded /t/<token> link; null → no link is sent */
  origin: string | null;
  now?: () => Date;
};

export type LoopResult = { picked: number; ok: number; failed: number; errors: string[] };
const empty = (): LoopResult => ({ picked: 0, ok: 0, failed: 0, errors: [] });

/** Short, single-line, secret-free error text for the database (last_error / integration_logs). */
export function redact(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? 'Unknown error');
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [hidden]')
    .replace(/\b(ck|cs)_[A-Za-z0-9]{8,}\b/g, '[hidden]')
    .replace(/([?&](?:consumer_key|consumer_secret|access_token|token|key|secret|signature)=)[^&\s]+/gi, '$1[hidden]')
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[hidden]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 300) || 'Unknown error';
}

const isAuthFailure = (e: unknown) => e instanceof ConnectorError && e.code === 'AUTH_FAILED';

async function markNeedsReconnect(deps: RuntimeDeps, connectionId: string, e: unknown) {
  try {
    await deps.rpc('c1_connection_set_status', { p_id: connectionId, p_status: 'needs_reconnect', p_reason: redact(e) });
  } catch { /* already disconnected: nothing to mark */ }
}

/**
 * Intake one order; "already received" (dedupe) is a success, never a duplicate order. A store sends no FX rate: a non-USD order gets
 * the current Octopus rate (locked on the order by intake); without a rate the order waits with a clear error (never a guessed rate).
 */
async function intake(deps: RuntimeDeps, conn: { orgId: string; platform: string; connectionId?: string }, order: Parameters<typeof toIntakeOrder>[0]) {
  let o = order;
  // CONN S2b: lines without our model number as SKU are matched by the store's id of a product we pushed
  const refs = [...new Set(o.lines.filter((l) => !l.modelNo && !l.variantId && l.storeVariantRef).map((l) => l.storeVariantRef as string))];
  if (refs.length && conn.connectionId && deps.resolveStoreVariants) {
    const map = await deps.resolveStoreVariants(conn.connectionId, refs);
    o = { ...o, lines: o.lines.map((l) => (!l.modelNo && !l.variantId && l.storeVariantRef && map[l.storeVariantRef] ? { ...l, variantId: map[l.storeVariantRef] } : l)) };
  }
  const cur = o.currency.toUpperCase();
  if (cur !== 'USD' && !(o.fxRateToUsd && o.fxRateToUsd > 0)) {
    const fx = deps.fxToUsd ? await deps.fxToUsd(cur) : null;
    if (!fx || !(fx > 0)) throw new ConnectorError('INVALID_INPUT', `FX_RATE_MISSING: Octopus has no exchange rate for ${cur} yet, so this order can't be priced. It is taken as soon as the rate is set.`);
    o = { ...o, fxRateToUsd: Number(fx.toPrecision(10)) };
  }
  const r = (await deps.rpc('ds_order_intake', { p_org: conn.orgId, p_channel: conn.platform, p_order: toIntakeOrder(o) })) as { ok?: boolean; code?: string; message?: string } | null;
  // intake answers ok:false for orders it refuses on purpose (feature off, paused, quote failed): kept as the event's error, retried
  if (r && r.ok === false) throw new ConnectorError('PLATFORM_REFUSED', `${r.code ?? 'REFUSED'}: ${r.message ?? 'The order was not taken.'}`);
  return r;
}

type InboxRow = { id: string; source: string; topic: string | null; payload: unknown; store_connection_id: string; org_id: string; attempts: number };

export async function processInbox(deps: RuntimeDeps, limit = 50): Promise<LoopResult> {
  const res = empty();
  const rows = ((await deps.rpc('c1_webhook_claim', { p_limit: limit })) ?? []) as InboxRow[];
  res.picked = rows.length;
  const touched = new Map<string, { ok: number; failed: number }>();
  for (const w of rows) {
    const tally = touched.get(w.store_connection_id) ?? { ok: 0, failed: 0 };
    touched.set(w.store_connection_id, tally);
    let error: string | null = null;
    try {
      if (!isStorePlatform(w.source)) throw new ConnectorError('INVALID_INPUT', 'Unknown platform.');
      const connector = deps.getConnector(w.source);
      if (!connector.webhookEvent) throw new ConnectorError('NOT_SUPPORTED', `${connector.name} webhooks are not handled yet.`);
      const ev = connector.webhookEvent({ topic: w.topic, payload: w.payload });
      if (ev.kind === 'order') {
        await intake(deps, { orgId: w.org_id, platform: w.source, connectionId: w.store_connection_id }, ev.order);
      } else if (ev.kind === 'order_cancelled') {
        // DS10: cancels only while the order has not left (and only when the merchant's channel setting allows it); otherwise a problem
        await deps.rpc('ds_order_channel_cancel', { p_org: w.org_id, p_channel: w.source, p_external_order_id: ev.externalOrderId, p_reason: 'Cancelled in the store' });
      } else if (ev.kind === 'uninstalled') {
        await deps.rpc('c1_connection_disconnect', { p_id: w.store_connection_id, p_reason: 'The store removed our access.' });
      }
      tally.ok++;
      res.ok++;
    } catch (e) {
      error = redact(e);
      tally.failed++;
      res.failed++;
      res.errors.push(error);
    }
    await deps.rpc('c1_webhook_done', { p_id: w.id, p_error: error });
  }
  for (const [id, t] of touched) {
    await deps.rpc('c1_connection_record_sync', {
      p_id: id, p_kind: 'webhooks', p_ok: t.failed === 0, p_summary: `${t.ok} event(s) handled${t.failed ? `, ${t.failed} failed` : ''}`,
    }).catch(() => undefined);
  }
  return res;
}

type PullTarget = { id: string; org_id: string; platform: string; shop_domain: string; store_url: string | null; last_sync_at: string | null };

/** Platforms whose connector can pull orders (a real, configured connector; never the "not configured" placeholder). */
export function pullPlatforms(deps: Pick<RuntimeDeps, 'getConnector'>, platforms: StorePlatform[]): StorePlatform[] {
  return platforms.filter((p) => p !== 'shopify' && deps.getConnector(p).status() === 'ready');
}

/** Overlap the previous pull by 2 h: intake dedupes on org + channel + external order id, so a re-read order is never doubled. */
export const pullSince = (last: string | null, now: Date) => {
  if (!last) return new Date(now.getTime() - 3 * 86400_000).toISOString();
  return new Date(new Date(last).getTime() - 2 * 3600_000).toISOString();
};

export async function runOrderCatchup(deps: RuntimeDeps, platforms: StorePlatform[], limit = 20): Promise<LoopResult> {
  const res = empty();
  const use = pullPlatforms(deps, platforms);
  if (!use.length) return res;
  const targets = ((await deps.rpc('c1_pull_targets', { p_platforms: use, p_limit: limit })) ?? []) as PullTarget[];
  res.picked = targets.length;
  const now = (deps.now ?? (() => new Date()))();
  for (const t of targets) {
    const conn: ConnectionRef = { id: t.id, orgId: t.org_id, platform: t.platform as StorePlatform, shopDomain: t.shop_domain, storeUrl: t.store_url };
    try {
      const pulled = await deps.getConnector(conn.platform).pullOrders(conn, pullSince(t.last_sync_at, now));
      let taken = 0;
      const errs: string[] = pulled.errors.map((x) => `${x.ref}: ${x.message}`);
      for (const o of pulled.orders) {
        try { await intake(deps, { orgId: conn.orgId, platform: conn.platform, connectionId: conn.id }, o); taken++; } catch (e) { errs.push(`${o.externalOrderName ?? o.externalOrderId}: ${redact(e)}`); }
      }
      // a pull that read the store is a sync even when single orders were refused (they show as order problems / in the summary)
      await deps.rpc('c1_connection_record_sync', {
        p_id: conn.id, p_kind: 'orders', p_ok: true,
        p_summary: `${pulled.orders.length} order(s) read, ${taken} taken in${errs.length ? `; ${errs.length} refused: ${errs[0]}` : ''}`,
      });
      res.ok++;
    } catch (e) {
      res.failed++;
      res.errors.push(redact(e));
      if (isAuthFailure(e)) await markNeedsReconnect(deps, conn.id, e);
      await deps.rpc('c1_connection_record_sync', { p_id: conn.id, p_kind: 'orders', p_ok: false, p_summary: redact(e) }).catch(() => undefined);
    }
  }
  return res;
}

type TaskRow = {
  id: string; action: StoreTask['action']; detail: Record<string, unknown> | null; attempts: number; store_order_id: string; org_id: string;
  channel: string; store_connection_id: string; external_order_id: string | null; external_order_name: string | null; order_number: string;
};

export const toStoreTask = (r: TaskRow): StoreTask => ({
  id: r.id, action: r.action, detail: r.detail ?? {}, attempts: r.attempts, storeOrderId: r.store_order_id, orgId: r.org_id, channel: r.channel,
  connectionId: r.store_connection_id, externalOrderId: r.external_order_id, externalOrderName: r.external_order_name, orderNumber: r.order_number,
});

/** The shipment a store receives: tracking numbers, the mapped tracking company (never a supplier name) and our branded /t/ link. */
export function shipmentFromTask(t: StoreTask, trackingCompany: string, origin: string | null): InternalShipment {
  const d = t.detail;
  const nums = Array.isArray(d.tracking_numbers) ? d.tracking_numbers.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
  const token = typeof d.tracking_token === 'string' && d.tracking_token ? d.tracking_token : null;
  return {
    storeOrderNumber: t.orderNumber,
    externalOrderId: t.externalOrderId,
    externalOrderName: t.externalOrderName,
    trackingNumbers: nums,
    trackingCompany: trackingCompany || 'Other',
    trackingUrl: token && origin ? new URL(`/t/${encodeURIComponent(token)}`, origin).toString() : null,
    shippedAt: typeof d.shipped_at === 'string' ? d.shipped_at : null,
  };
}

export async function runTasks(deps: RuntimeDeps, limit = 50): Promise<LoopResult> {
  const res = empty();
  const rows = ((await deps.rpc('c1_task_claim', { p_limit: limit })) ?? []) as TaskRow[];
  res.picked = rows.length;
  const conns = new Map<string, ConnectionRef | null>();
  const refused = new Set<string>();
  for (const row of rows) {
    const t = toStoreTask(row);
    let ok = false;
    let error: string | null = null;
    try {
      if (refused.has(t.connectionId)) throw new ConnectorError('AUTH_FAILED', 'The store refused our access. Reconnect it.');
      if (!conns.has(t.connectionId)) conns.set(t.connectionId, await deps.loadConnection(t.connectionId));
      const conn = conns.get(t.connectionId);
      if (!conn) throw new ConnectorError('INVALID_INPUT', 'Store connection not found.');
      const connector = deps.getConnector(conn.platform);
      if (t.action === 'send_tracking' || t.action === 'update_tracking') {
        const company = await deps.trackingCompany(typeof t.detail.carrier === 'string' ? t.detail.carrier : null, conn.platform);
        const shipment = shipmentFromTask(t, company, deps.origin);
        if (!shipment.trackingNumbers.length && !shipment.trackingUrl) throw new ConnectorError('INVALID_INPUT', 'No tracking number yet.');
        const r = await connector.sendTracking(conn, shipment);
        ok = r.ok;
        if (!r.ok) error = redact(r.message ?? 'The store did not accept the tracking.');
      } else if (connector.orderAction) {
        const r = await connector.orderAction(conn, { action: t.action, externalOrderId: t.externalOrderId, detail: t.detail });
        ok = r.ok;
        if (!r.ok) error = redact(r.message ?? 'The store did not accept the update.');
      } else {
        ok = true; // this platform has no such step (e.g. fulfilment holds are Shopify-only): nothing to send
      }
    } catch (e) {
      error = redact(e);
      if (isAuthFailure(e) && !refused.has(t.connectionId)) {
        refused.add(t.connectionId);
        await markNeedsReconnect(deps, t.connectionId, e);
      }
    }
    await deps.rpc('c1_task_done', { p_id: t.id, p_ok: ok, p_error: ok ? null : error });
    if (ok) res.ok++;
    else { res.failed++; if (error) res.errors.push(error); }
  }
  return res;
}

/** One cron run: webhooks first (fresh orders), then store tasks, then the catch-up pull. One loop failing does not stop the others. */
export async function runConnectorSync(deps: RuntimeDeps, platforms: StorePlatform[]) {
  const safe = async (f: () => Promise<LoopResult>): Promise<LoopResult> => {
    try { return await f(); } catch (e) { return { ...empty(), errors: [redact(e)] }; }
  };
  const inbox = await safe(() => processInbox(deps));
  const tasks = await safe(() => runTasks(deps));
  const orders = await safe(() => runOrderCatchup(deps, platforms));
  return { inbox, tasks, orders };
}
