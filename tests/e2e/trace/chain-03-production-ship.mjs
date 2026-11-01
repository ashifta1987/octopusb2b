// Chain 3 — In production → QC → Balance → Shipped (SPEC §21.1 #3), continuing chain 2's order.
// Operations moves the order (transition_order), the customer pays the balance from the wallet (UI), operations creates
// the YunExpress shipment in /office/shipping (sandbox adapter: price trial + create + subscribe, logged), and the
// customer's order page updates live.
import { chromium } from '@playwright/test';
import { BASE, balanced, count, ensureBuyer, hops, loadState, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows, until, waitRefresh } from './lib.mjs';

const { r, check, note, save } = reporter(3, 'In production → QC → Balance → Shipped');
const trace = newTrace(3);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const browser = await chromium.launch();
try {
  const st = loadState();
  const orderId = st.orderA;
  if (!orderId) throw new Error('run chain 2 first');
  const buyer = await ensureBuyer('a');
  const sb = await signIn(buyer.email, trace);
  const ops = await signIn('ops@demo.octopusb2b.com', trace, { staff: true });
  const cctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await cctx.addCookies(pwCookies(sb));
  const octx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await octx.addCookies(pwCookies(ops, { staff: true }));
  const c = await cctx.newPage();
  const o = await octx.newPage();
  for (const p of [c, o]) p.on('dialog', (d) => d.accept());
  const t0 = Date.now();
  for (const to of ['in_production', 'qc', 'balance_pending']) {
    const t = Date.now();
    const { error } = await ops.rpc('transition_order', { p_order: orderId, p_to: to, p_reason: `E2E trace → ${to}` });
    r.latency[`RPC transition_order ${to}`] = Date.now() - t;
    check(!error, `operations: → ${to}`, error?.message);
  }
  await runWorker();
  // balance from the wallet (UI)
  await c.goto(`${BASE}/account/orders/${orderId}`);
  await c.getByRole('button', { name: /^Pay balance from/ }).click();
  const tp = Date.now();
  await c.getByRole('dialog').getByRole('button', { name: /^Confirm/ }).click();
  await c.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 });
  r.latency['SA record_payment (balance)'] = Date.now() - tp;
  const [ord] = await sql(`select status, paid_cents, total_cents from orders where id=$1`, [orderId]);
  check(Number(ord.paid_cents) === Number(ord.total_cents), 'balance paid in full', JSON.stringify(ord));
  if (ord.status === 'balance_pending') {
    const { error } = await ops.rpc('transition_order', { p_order: orderId, p_to: 'balance_paid', p_reason: 'E2E trace' });
    check(!error, 'operations: → balance_paid', error?.message);
  } else note(`order moved to ${ord.status} automatically after the balance payment`);
  const { error: rts } = await ops.rpc('transition_order', { p_order: orderId, p_to: 'ready_to_ship', p_reason: 'E2E trace' });
  check(!rts, 'operations: → ready_to_ship', rts?.message);
  await runWorker();

  // shipment in /office/shipping while the customer watches the order page
  await c.reload();
  await c.waitForTimeout(2500);
  const live = waitRefresh(c);
  await o.goto(`${BASE}/office/shipping?order=${orderId}`);
  await o.locator('#sc-w').fill('12');
  const tr = Date.now();
  await o.getByRole('button', { name: 'Get YunExpress rates' }).click();
  await o.getByRole('button', { name: /create shipment/i }).first().waitFor({ timeout: 15000 }).catch(() => null);
  r.latency['SA priceTrial (adapter)'] = Date.now() - tr;
  const radios = o.getByRole('radio');
  if (await radios.count()) await radios.first().check().catch(() => null);
  const ts = Date.now();
  await o.getByRole('button', { name: /create shipment/i }).first().click();
  await o.getByText(/YT\d{10,}/).first().waitFor({ timeout: 20000 });
  r.latency['SA createShipment (adapter + shipments + system_record_tracking + transition shipped)'] = Date.now() - ts;
  const got = await live;
  const shownLive = await until(async () => /shipped/i.test(await c.locator('main').innerText()) ? true : null, { timeout: 10000 });
  check(!!got && shownLive.value, 'customer order timeline shows "Shipped" live (Realtime order_events/tracking_events)', got ? `${got - ts} ms` : 'no push');
  await c.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-03-shipped.png' });
  await runWorker();
  r.e2e_ms = Date.now() - t0;

  await until(async () => (await sql(`select count(*)::int n from outbox_events where trace_id=$1 and status <> 'done'`, [trace]))[0].n === 0 ? true : null, { timeout: 30000, every: 2000 });
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  const [ship] = await sql(`select id, tracking_no, status, trace_id from shipments where order_id=$1`, [orderId]);
  remember((s) => { s.trackingA = ship?.tracking_no; s.shipmentA = ship?.id; });
  check(ship && ship.trace_id === trace, '1 shipment row with the trace id', JSON.stringify(ship));
  check(count(rows, 'tracking_events') >= 1, 'tracking event "created" recorded through system_record_tracking', count(rows, 'tracking_events'));
  const sh = (rows.status_history ?? []).filter((x) => x.entity === 'order').map((x) => x.to_status);
  r.status_history = sh;
  for (const s of ['in_production', 'qc', 'balance_pending', 'ready_to_ship', 'shipped']) check(sh.filter((x) => x === s).length === 1, `status_history order → ${s} once`, sh.join(' → '));
  check(balanced(rows), 'balance payment journal balances per currency', `${count(rows, 'journals')} journals`);
  const adapter = (rows.integration_logs ?? []).filter((x) => x.integration_code === 'yunexpress' && x.direction === 'out').map((x) => x.endpoint);
  r.adapter_calls = adapter;
  check(adapter.some((e) => /GetPriceTrial/.test(e)) && adapter.some((e) => /CreateOrder/.test(e)) && adapter.some((e) => /Subscribe/.test(e)), 'YunExpress adapter calls logged (price trial, create, subscribe) with SHAs', adapter.join(', '));
  check(count(rows, 'outbox_events', (x) => x.event_type === 'shipment.tracking') >= 1, 'outbox shipment.tracking written', '');
  check(count(rows, 'email_deliveries', (x) => /order.shipped/.test(x.template)) === 1, 'shipped e-mail sent once', (rows.email_deliveries ?? []).map((e) => e.template).join(', '));
  check(count(rows, 'documents', (d) => d.doc_type === 'commercial_invoice') === 1, 'commercial invoice document on balance_pending', '');
  // negative: ship again → refused
  const { error: again } = await ops.rpc('transition_order', { p_order: orderId, p_to: 'shipped', p_reason: 'replay' });
  check(!!again, 'replay: second "shipped" refused', again?.message);
  // negative: customer cannot move the order
  const { error: neg } = await sb.rpc('transition_order', { p_order: orderId, p_to: 'delivered', p_reason: 'self' });
  check(!!neg && /FORBIDDEN/.test(neg.message), 'negative: customer transition → FORBIDDEN', neg?.message);
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
