// Chain 6 — Group-buy pool: open → join → fill → settle (SPEC §21.1 #6). Three tagged buyers (NL, DE, US), one trace.
// settle runs through job_pools() exactly as pg_cron does; then each buyer pays the balance and operations ships
// three parcels. Negative: an under-filled pool expires and refunds its deposit.
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import { BASE, balanced, count, ensureBuyer, hops, http, loadState, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows, until } from './lib.mjs';

const { r, check, note, save } = reporter(6, 'Group-buy pool: open → join → fill → settle');
const trace = newTrace(6);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const secret = process.env.PAYMENT_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET;
const sign = (body) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`; };
const browser = await chromium.launch();
const SLUG = 'stainless-steel-hex-bolts-m10-40-mm-a2-70';
async function fund(sb, amount) {
  const ref = 'pi_test_' + crypto.randomBytes(6).toString('hex');
  const { error } = await sb.rpc('request_topup', { p_amount: amount, p_method: 'card', p_reference: ref });
  if (error) throw new Error('request_topup ' + error.message);
  const body = JSON.stringify({ id: 'evt_trace_' + crypto.randomBytes(6).toString('hex'), type: 'topup.succeeded', data: { reference: ref, amount } });
  const w = await http('/api/webhooks/payment', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body) } });
  if (w.json?.results?.[0]?.outcome !== 'credited') throw new Error('funding failed ' + w.text);
}
try {
  const st = loadState();
  const A = { ...(await ensureBuyer('a')), org: st.orgA };
  const B = await ensureBuyer('b', { country: 'DE' });
  const C = await ensureBuyer('c', { country: 'US' });
  for (const [x, country, city] of [[B, 'DE', 'Hamburg'], [C, 'US', 'Chicago']]) {
    const sb = await signIn(x.email, trace);
    const [has] = await sql(`select org_id from org_members where user_id=$1`, [x.uid]);
    if (!has) {
      const { error } = await sb.rpc('complete_onboarding', { p_full_name: `QA Trace ${country}`, p_company: x.company, p_country: country, p_phone: '+1 000 000', p_business_type: 'Importer / wholesaler', p_city: city });
      if (error) throw new Error('onboarding ' + error.message);
    }
    x.org = (await sql(`select org_id from org_members where user_id=$1`, [x.uid]))[0].org_id;
    x.sb = await signIn(x.email, trace);
    await fund(x.sb, 500000);
  }
  A.sb = await signIn(A.email, trace);
  remember((s) => { s.orgB = B.org; s.orgC = C.org; });
  const [prod] = await sql(`select id, moq from products where slug=$1`, [SLUG]);
  const tiers = await sql(`select min_qty, unit_price_cents from price_tiers where product_id=$1 order by min_qty`, [prod.id]);
  const target = tiers[1].min_qty;
  note(`product MOQ ${prod.moq}; pool target = tier 2 (${target} pcs @ ${tiers[1].unit_price_cents} vs ${tiers[0].unit_price_cents})`);

  // 1 · A starts the pool, B and C join (three browsers' sessions, same trace)
  const t0 = Date.now();
  const qA = Math.round(target * 0.4), qB = Math.round(target * 0.4), qC = target - qA - qB;
  const { data: poolId, error: oe } = await A.sb.rpc('open_pool', { p_product: prod.id, p_target_qty: target, p_deadline: new Date(Date.now() + 7 * 864e5).toISOString(), p_min_pledge: Math.min(qC, qA), p_address: null, p_qty: qA, p_pay_source: 'wallet' });
  check(!oe && poolId, 'A opened the pool and pledged (deposit from wallet)', oe?.message ?? poolId);
  remember((s) => { s.poolId = poolId; });
  const [pool] = await sql(`select code from pools where id=$1`, [poolId]);
  const { error: be } = await B.sb.rpc('join_pool', { p_pool: poolId, p_qty: qB, p_address: null, p_pay_source: 'wallet', p_terms: null });
  check(!be, 'B (DE) joined', be?.message);
  // public pool page before it fills: participants are code + country only
  const page = await (await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } })).newPage();
  await page.goto(`${BASE}/pool/${pool.code}`);
  await page.waitForLoadState('networkidle');
  await page.getByText(/participant|buyers|joined/i).first().waitFor({ timeout: 15000 }).catch(() => null);
  const pubText = await page.locator('main').innerText();
  r.pool_page_excerpt = pubText.slice(0, 600);
  const leaks = [A.company, B.company, C.company, 'QA Trace', '@demo.octopusb2b.com'].filter((s) => pubText.includes(s));
  check(leaks.length === 0 && /Germany|\bDE\b|Netherlands|\bNL\b|🇩🇪|🇳🇱/.test(pubText), '/pool/[code] shows buyer code + country only (no names/e-mails)', leaks.join(', ') || 'no identities');
  await page.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-06-pool-page.png' });
  const { error: ce } = await C.sb.rpc('join_pool', { p_pool: poolId, p_qty: qC, p_address: null, p_pay_source: 'wallet', p_terms: null });
  check(!ce, 'C (US) joined → pool filled', ce?.message);
  const pubView = await sql(`select * from pool_public_view where pool_id=$1`, [poolId]);
  r.public_view_columns = Object.keys(pubView[0] ?? {});
  check(pubView.length >= 1 && !JSON.stringify(pubView).match(/QA-TRACE|QA Trace|@/), 'pool_public_view exposes no buyer identity', r.public_view_columns.join(', '));

  // 2 · settle exactly as pg_cron does (job_pools, no request headers)
  const tS = Date.now();
  const [{ job_pools: jp }] = await sql(`select job_pools()`);
  r.latency['job_pools → settle_pool'] = Date.now() - tS;
  const [{ settle_pool: again }] = await sql(`select settle_pool($1)`, [poolId]);
  check(jp.settled >= 1 && again.idempotent === true, 'settle_pool ran once from the cron job; a second call is an idempotent no-op', `${JSON.stringify(jp)} / ${JSON.stringify(again)}`);
  await runWorker();

  // 3 · each buyer pays the balance; operations ships three parcels
  const orders = await sql(`select o.id, o.org_id, o.total_cents, o.paid_cents, o.status from orders o where o.pool_id=$1 order by o.created_at`, [poolId]);
  for (const b of [A, B, C]) {
    const o = orders.find((x) => x.org_id === b.org);
    const { error } = await b.sb.rpc('record_payment', { p_order: o.id, p_amount: Number(o.total_cents) - Number(o.paid_cents), p_method: 'wallet', p_reference: `E2E-POOL-${o.id.slice(0, 8)}`, p_provider_event: null });
    check(!error, `${b.country} paid the balance from the wallet`, error?.message);
  }
  const ops = await signIn('ops@demo.octopusb2b.com', trace, { staff: true });
  const octx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await octx.addCookies(pwCookies(ops, { staff: true }));
  const o = await octx.newPage();
  for (const ord of orders) {
    const [cur] = await sql(`select status from orders where id=$1`, [ord.id]);
    if (cur.status === 'balance_pending') await ops.rpc('transition_order', { p_order: ord.id, p_to: 'balance_paid', p_reason: 'E2E trace' });
    const { error } = await ops.rpc('transition_order', { p_order: ord.id, p_to: 'ready_to_ship', p_reason: 'E2E trace pool' });
    if (error) note(`ready_to_ship ${ord.id}: ${error.message}`);
    await o.goto(`${BASE}/office/shipping?order=${ord.id}`);
    await o.locator('#sc-w').fill('8');
    await o.getByRole('button', { name: 'Get YunExpress rates' }).click();
    await o.getByRole('button', { name: /create shipment/i }).first().waitFor({ timeout: 15000 });
    await o.getByRole('button', { name: /create shipment/i }).first().click();
    await o.getByText(/YT\d{10,}/).first().waitFor({ timeout: 20000 });
  }
  await runWorker();
  r.e2e_ms = Date.now() - t0;

  // 4 · negative: an under-filled pool expires and refunds
  const { data: pool2, error: p2e } = await B.sb.rpc('open_pool', { p_product: prod.id, p_target_qty: target, p_deadline: new Date(Date.now() + 4 * 864e5).toISOString(), p_min_pledge: null, p_address: null, p_qty: Math.round(target * 0.2), p_pay_source: 'wallet' });
  check(!p2e, 'B opened a second pool that will under-fill', p2e?.message);
  await sql(`update pools set deadline_at = now() - interval '1 minute' where id=$1`, [pool2]);
  const [{ job_pools: jp2 }] = await sql(`select job_pools()`);
  const [p2] = await sql(`select status from pools where id=$1`, [pool2]);
  const [pl2] = await sql(`select status from pool_pledges where pool_id=$1`, [pool2]);
  check(jp2.expired >= 1 && p2.status === 'expired' && /refund/.test(pl2.status), 'negative: under-filled pool expired by the cron job and the deposit refunded', `${p2.status} / pledge ${pl2.status}`);
  await runWorker();

  await until(async () => (await sql(`select count(*)::int n from outbox_events where trace_id=$1 and status <> 'done'`, [trace]))[0].n === 0 ? true : null, { timeout: 30000, every: 2000 });
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  const po = (rows.documents ?? []).filter((d) => d.doc_type === 'purchase_order' || (d.org_id === null && d.supplier_id));
  check(po.length === 1 && po[0].org_id === null && !JSON.stringify(po[0].data).match(/QA-TRACE|QA Trace|@/), '1 aggregate supplier PO, no buyer identities', po.map((d) => `${d.doc_type} ${d.number} qty ${d.data?.aggregate_qty}`).join(', '));
  check(count(rows, 'proforma_invoices', (x) => x.pool_id === poolId) === 3, '3 PIs (one per buyer)', count(rows, 'proforma_invoices'));
  check(count(rows, 'orders', (x) => x.pool_id === poolId) === 3, '3 orders', count(rows, 'orders'));
  check(count(rows, 'email_deliveries', (e) => /pi.created/.test(e.template)) === 3, '3 PI e-mails (pi.created)', (rows.email_deliveries ?? []).map((e) => e.template).join(', '));
  check(count(rows, 'shipments') === 3, '3 shipments', count(rows, 'shipments'));
  check(count(rows, 'audit_log', (a) => /pool/.test(a.action) && /settle|locked/.test(JSON.stringify(a.details ?? {}) + a.action)) >= 1, 'pool settle audited', (rows.audit_log ?? []).filter((a) => /pool/.test(a.action)).map((a) => a.action).join(', '));
  check(count(rows, 'outbox_events', (x) => x.event_type === 'pool.filled') === 1 && count(rows, 'outbox_events', (x) => x.event_type === 'po.created') === 1, 'pool.filled + po.created once each');
  check(balanced(rows), 'every journal (deposits, balances, refunds, top-ups) balances per currency', `${count(rows, 'journals')} journals`);
  const supplierRows = await sql(`select count(*)::int n from documents where id = any($1::uuid[]) and org_id is null`, [po.map((d) => d.id)]);
  note(`supplier-side view: the supplier portal is not built (QA FN-05); the supplier-facing artefact is the PO document (org_id null, ${supplierRows[0].n} row) — checked for identities above.`);
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
