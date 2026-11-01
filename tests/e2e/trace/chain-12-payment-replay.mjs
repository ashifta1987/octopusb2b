// Chain 12 — Payment webhook replay (SPEC §21.1 #12) — also funds org A's wallet for chains 2/5/13.
// Card top-up through the UI (payment adapter createIntent, test mode) → signed `topup.succeeded` webhook → ledger
// credit → outbox wallet.updated → worker. Then the same provider event is POSTed again: it must be a 200 no-op with an
// idempotency_hits row. Negative: bad HMAC, stale timestamp, amount mismatch.
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import { BASE, balanced, count, ensureBuyer, hops, http, loadState, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows } from './lib.mjs';

const { r, check, note, save } = reporter(12, 'Payment webhook replay');
const trace = newTrace(12);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const secret = process.env.PAYMENT_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET;
const sign = (body, t = Math.floor(Date.now() / 1000), key = secret) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;
const AMOUNT = 500000; // 5,000.00 in the platform currency
const browser = await chromium.launch();
try {
  const buyer = await ensureBuyer('a');
  const orgId = loadState().orgA;
  const sb = await signIn(buyer.email, trace);
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await ctx.addCookies(pwCookies(sb));
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(`${BASE}/account/wallet`);
  await page.fill('#topup-custom', String(AMOUNT / 100));
  await page.getByRole('tab', { name: 'Card' }).click();
  await page.getByRole('button', { name: 'Continue to card payment' }).click();
  const tSA = Date.now();
  await Promise.all([page.waitForURL(/test_checkout=/, { timeout: 20000 }), page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()]);
  r.latency['startCardTopup SA (createIntent + request_topup)'] = Date.now() - tSA;
  const intent = new URL(page.url()).searchParams.get('test_checkout');
  check(/^pi_test_/.test(intent ?? ''), 'payment adapter created a test intent', intent);
  const [topup] = await sql(`select id, status, amount_cents, currency, trace_id from wallet_topups where reference=$1`, [intent]);
  check(topup && topup.status === 'pending' && topup.trace_id === trace, 'wallet_topups row pending with the trace id', JSON.stringify(topup));

  // 1 · provider webhook (signed)
  const evId = `evt_trace_${crypto.randomBytes(6).toString('hex')}`;
  const body = JSON.stringify({ id: evId, type: 'topup.succeeded', data: { reference: intent, amount: AMOUNT } });
  const w1 = await http('/api/webhooks/payment', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body) } });
  r.latency['payment webhook (HMAC → confirm_topup → ledger)'] = w1.ms;
  check(w1.status === 200 && w1.json?.results?.[0]?.outcome === 'credited', 'webhook credited the top-up', JSON.stringify(w1.json));
  const wk = await runWorker();
  r.latency['outbox worker'] = wk.ms;

  // 2 · replay (same provider event id, fresh signature)
  const before = (await sql(`select (select count(*) from journals where idempotency_key=$1)::int j, (select count(*) from notifications where org_id=$2)::int n`, [`topup-evt:${evId}`, orgId]))[0];
  const w2 = await http('/api/webhooks/payment', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body) } });
  await runWorker();
  const after = (await sql(`select (select count(*) from journals where idempotency_key=$1)::int j, (select count(*) from notifications where org_id=$2)::int n`, [`topup-evt:${evId}`, orgId]))[0];
  check(w2.status === 200 && w2.json?.results?.[0]?.outcome === 'duplicate', 'replay → 200 duplicate', JSON.stringify(w2.json));
  check(before.j === 1 && after.j === 1 && after.n === before.n, 'replay wrote no journal and no notification', `journals ${before.j}→${after.j}, notifications ${before.n}→${after.n}`);
  r.e2e_ms = Date.now() - t0;

  // 3 · negative paths
  const bad = await http('/api/webhooks/payment', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body, undefined, 'wrong-secret') } });
  check(bad.status === 401, 'bad HMAC → 401 BAD_SIGNATURE', bad.json?.code);
  const stale = await http('/api/webhooks/payment', { trace, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sign(body, Math.floor(Date.now() / 1000) - 900) } });
  check(stale.status === 401, 'signature older than 5 min → 401', stale.json?.code);
  const mm = JSON.stringify({ id: `evt_trace_mm_${crypto.randomBytes(4).toString('hex')}`, type: 'topup.succeeded', data: { reference: 'pi_test_doesnotexist', amount: 1 } });
  const um = await http('/api/webhooks/payment', { trace, method: 'POST', body: mm, headers: { 'content-type': 'application/json', 'octopus-signature': sign(mm) } });
  check(um.status === 200 && um.json?.results?.[0]?.outcome === 'unmatched', 'unknown reference → acknowledged as unmatched, nothing posted', JSON.stringify(um.json));

  // 4 · trace
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  check(count(rows, 'wallet_topups') === 1, '1 wallet_topups row');
  check(count(rows, 'journals') === 1, 'exactly 1 journal for the credit', count(rows, 'journals'));
  check(count(rows, 'ledger_entries') === 2 && balanced(rows), '2 ledger entries that balance per currency', JSON.stringify((rows.ledger_entries ?? []).map((e) => [e.debit_cents, e.credit_cents, e.currency])));
  check(count(rows, 'outbox_events', (x) => x.event_type === 'wallet.updated') === 1, 'exactly 1 wallet.updated outbox event');
  check(count(rows, 'notifications', (x) => /Wallet credited/.test(x.title)) === 1, 'exactly 1 "Wallet credited" notification');
  check(count(rows, 'idempotency_hits', (x) => x.scope === 'payment_webhook' && x.key === evId) === 1, 'replay wrote 1 idempotency_hits row (same trace family)', JSON.stringify(rows.idempotency_hits?.[0] ?? null));
  check(count(rows, 'integration_logs', (x) => x.integration_code === 'payment' && x.direction === 'in' && x.status === 401) >= 2, 'rejected webhooks logged (401) with request SHA');
  check(count(rows, 'integration_logs', (x) => x.integration_code === 'payment' && x.direction === 'out' && /createIntent/.test(x.endpoint ?? '')) === 1, 'adapter createIntent logged once (request/response SHA)');
  const email = count(rows, 'email_deliveries');
  note(`email_deliveries for the top-up: ${email} (wallet.updated has no e-mail consumer by design — §10.1 lists notify + webhooks only)`);
  r.event_id = evId;
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
