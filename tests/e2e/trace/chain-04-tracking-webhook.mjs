// Chain 4 — YunExpress tracking webhook → timeline (SPEC §21.1 #4), on chain 3's shipment.
// Carrier POSTs a signed `delivered` event → system_record_tracking (tracking_events + shipment status + order →
// delivered + outbox shipment.tracking) → Realtime push to the customer's order page → worker e-mail/notification.
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import { BASE, count, ensureBuyer, hops, http, loadState, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows, until, waitRefresh } from './lib.mjs';

const { r, check, note, save } = reporter(4, 'YunExpress tracking webhook → Timeline');
const trace = newTrace(4);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const secret = process.env.YUNEXPRESS_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET;
const sign = (body, key = secret, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;
const browser = await chromium.launch();
try {
  const st = loadState();
  if (!st.trackingA) throw new Error('run chain 3 first');
  const buyer = await ensureBuyer('a');
  const sb = await signIn(buyer.email, trace);
  const ctx = await browser.newContext();
  await ctx.addCookies(pwCookies(sb));
  const c = await ctx.newPage();
  await c.goto(`${BASE}/account/orders/${st.orderA}`);
  await c.waitForTimeout(2500);
  const live = waitRefresh(c);
  const evId = `yt_evt_${crypto.randomBytes(6).toString('hex')}`;
  const body = JSON.stringify({ events: [{ id: evId, tracking_no: st.trackingA, status: 'delivered', description: 'Delivered — signed by consignee (E2E trace)', location: 'Rotterdam, NL', time: new Date().toISOString() }] });
  const t0 = Date.now();
  const w = await http('/api/webhooks/yunexpress', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body) } });
  r.latency['webhook (HMAC → system_record_tracking)'] = w.ms;
  check(w.status === 200 && w.json?.recorded === 1, 'webhook recorded the delivered event', JSON.stringify(w.json));
  const got = await live;
  r.latency['webhook → Realtime refresh in customer DOM'] = got ? got - t0 : null;
  const shown = await until(async () => /delivered/i.test(await c.locator('main').innerText()) ? true : null, { timeout: 10000 });
  check(!!got && shown.value, 'customer timeline shows "Delivered" live (Realtime tracking_events)', got ? `${got - t0} ms` : 'no push');
  await c.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-04-delivered.png' });
  const wk = await runWorker(); // pg_cron + pg_net run this every 10 s in production
  const mail = await until(async () => (await sql(`select count(*)::int n from email_deliveries where trace_id=$1`, [trace]))[0].n > 0 ? true : null, { timeout: 15000 });
  r.e2e_ms = Date.now() - t0;
  r.latency['worker run'] = wk.ms;
  check(!!mail.value && r.e2e_ms < 15000, 'end-to-end (webhook → e-mail delivered) under 15 s', `${r.e2e_ms} ms (dispatcher cadence in production: 10 s)`);

  // replay the same carrier event
  const w2 = await http('/api/webhooks/yunexpress', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body) } });
  await runWorker();
  check(w2.status === 200 && w2.json?.duplicates === 1 && w2.json?.recorded === 0, 'replay → 200, duplicate, nothing recorded', JSON.stringify(w2.json));
  // negatives
  const bad = await http('/api/webhooks/yunexpress', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body, 'wrong') } });
  check(bad.status === 401, 'bad HMAC → 401', bad.json?.code);
  const unk = JSON.stringify({ events: [{ id: `yt_evt_unknown_${Date.now()}`, tracking_no: 'YT0000000000000', status: 'in_transit', description: 'x', time: new Date().toISOString() }] });
  const u = await http('/api/webhooks/yunexpress', { trace, method: 'POST', body: unk, headers: { 'content-type': 'application/json', 'octopus-signature': sign(unk) } });
  check(u.status === 200 && (u.json?.unknown ?? []).length === 1, 'unknown tracking number → acknowledged, listed as unknown, nothing written', JSON.stringify(u.json));

  const rows = await traceRows(trace);
  r.hops = hops(rows);
  check(count(rows, 'tracking_events') === 1, 'exactly 1 tracking_events row', count(rows, 'tracking_events'));
  const [ship] = await sql(`select status from shipments where id=$1`, [st.shipmentA]);
  const [ord] = await sql(`select status, claim_visible_until from orders where id=$1`, [st.orderA]);
  check(ship.status === 'delivered' && ord.status === 'delivered', 'shipment and order → delivered (claim window opened)', `${ship.status} / ${ord.status} / claim until ${ord.claim_visible_until}`);
  check(count(rows, 'outbox_events', (x) => x.event_type === 'shipment.tracking') === 1, 'exactly 1 shipment.tracking event', (rows.outbox_events ?? []).map((x) => x.event_type).join(', '));
  check(count(rows, 'outbox_events', (x) => x.event_type === 'order.delivered') === 1, 'exactly 1 order.delivered event');
  check(count(rows, 'email_deliveries') >= 1 && count(rows, 'email_deliveries', (e) => /order.delivered/.test(e.template)) === 1, 'customer e-mail (order delivered) once', (rows.email_deliveries ?? []).map((e) => e.template).join(', '));
  check(count(rows, 'notifications', (n) => /Shipment/.test(n.title)) === 1, 'shipment notification once', (rows.notifications ?? []).map((n) => n.title).join(', '));
  check(count(rows, 'webhook_deliveries', (x) => x.event_type === 'shipment.tracking') === 0, 'no shipment.tracking webhook (org endpoint subscribes to order.updated, quote.created only)', '');
  check(count(rows, 'idempotency_hits', (x) => x.scope === 'yunexpress_webhook' && x.key === evId) === 1, 'replay → 1 idempotency_hits row linked to the original trace', JSON.stringify(rows.idempotency_hits?.[0] ?? null));
  check(count(rows, 'integration_logs', (x) => x.integration_code === 'yunexpress' && x.direction === 'in') >= 3, 'inbound webhook calls logged with HMAC result + body SHA', count(rows, 'integration_logs'));
  note('Metric: there is no metrics backend (no Sentry/OTel); integration_logs + job_runs.duration_ms are the only counters/timers.');
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
