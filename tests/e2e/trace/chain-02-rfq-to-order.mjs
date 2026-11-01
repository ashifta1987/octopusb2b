// Chain 2 — RFQ → Quote → PI → Deposit → Confirmed order (SPEC §21.1 #2), one trace id across both browsers
// (customer + operations), as the frontend would forward it on follow-up fetches.
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import { BASE, balanced, count, ensureBuyer, hops, loadState, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows, until, waitRefresh } from './lib.mjs';

const { r, check, save } = reporter(2, 'RFQ → Quote → PI → Deposit → Confirmed order');
const trace = newTrace(2);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const SLUG = 'stainless-steel-hex-bolts-m10-40-mm-a2-70';
const HOOK = 'https://httpbin.org/anything/octopus-trace';
const browser = await chromium.launch();
const t = {};
const mark = (k) => { t[k] = Date.now(); };
try {
  const buyer = await ensureBuyer('a');
  const orgId = loadState().orgA;
  // outbound webhook endpoint for the org (what the Developer page creates)
  const secret = 'whsec_trace_' + crypto.randomBytes(12).toString('hex');
  await sql(`delete from webhook_endpoints where org_id=$1`, [orgId]);
  await sql(`insert into webhook_endpoints(org_id, url, events, secret, active) values ($1,$2,$3,$4,true)`, [orgId, HOOK, ['order.updated', 'quote.created'], secret]);

  const sb = await signIn(buyer.email, trace);
  const ops = await signIn('ops@demo.octopusb2b.com', trace, { staff: true });
  const cctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await cctx.addCookies(pwCookies(sb));
  const octx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await octx.addCookies(pwCookies(ops, { staff: true }));
  const c = await cctx.newPage();
  const o = await octx.newPage();
  for (const p of [c, o]) p.on('dialog', (d) => d.accept());

  // 1 · Request quote on the product page
  mark('start');
  const pr = await c.goto(`${BASE}/p/${SLUG}`);
  check(pr.headers()['x-trace-id'] === trace, 'product page carries the trace id');
  await c.getByRole('link', { name: 'Request quote' }).first().click();
  await c.waitForURL(/\/request\/sourcing/);
  await c.locator('#rq-title').fill('QA-TRACE hex bolts M10 (e2e)');
  await c.locator('#rq-details').fill('E2E trace test — A2-70, DIN 933. Please ignore.');
  await c.locator('#rq-quantity').fill('5000');
  const dest = c.locator('#rq-destination_country');
  await dest.selectOption('NL').catch(async () => dest.selectOption({ index: 1 }));
  await c.getByRole('button', { name: /submit|send|request/i }).last().click();
  mark('rfq_click');
  await c.getByRole('dialog').getByRole('button', { name: /^Confirm/ }).click();
  await c.waitForURL(/\/account\/rfqs\/[0-9a-f-]{36}/, { timeout: 20000 });
  mark('rfq_done');
  const rfqId = c.url().match(/rfqs\/([0-9a-f-]{36})/)[1];
  check(true, 'RFQ submitted through the Request form (submit_rfq + fee from wallet)', rfqId);
  r.latency['SA submit_rfq (click → redirect)'] = t.rfq_done - t.rfq_click;
  await runWorker();

  // 2 · Operations sends a quote; the customer's RFQ page updates live (Realtime quotes INSERT)
  await c.waitForTimeout(2000);
  const rscQuote = waitRefresh(c);
  await o.goto(`${BASE}/office/rfqs/${rfqId}`);
  await o.locator('#oq-sup').selectOption({ index: 1 });
  await o.locator('#oq-price').fill('0.12');
  await o.locator('#oq-qty').fill('5000');
  await o.locator('#oq-ship').fill('45');
  mark('quote_click');
  await o.getByRole('button', { name: 'Send quote' }).click();
  await o.getByText('Quote sent to the buyer').waitFor({ timeout: 20000 });
  mark('quote_done');
  r.latency['SA send_quote'] = t.quote_done - t.quote_click;
  const gotQ = await rscQuote;
  check(!!gotQ, 'customer RFQ page received the new quote via Realtime (router refresh)', gotQ ? `${gotQ - t.quote_done} ms after send` : 'no refresh');
  await c.getByRole('button', { name: 'Approve quote' }).first().waitFor({ timeout: 15000 });
  check(true, 'quote visible in the customer DOM without reload');
  await runWorker();

  // 3 · Customer approves → PI + order
  await c.getByRole('button', { name: 'Approve quote' }).first().click();
  await c.getByRole('dialog').getByRole('checkbox').check();
  mark('approve_click');
  await c.getByRole('button', { name: 'Approve & create proforma' }).click();
  await c.waitForURL(/\/account\/orders\/[0-9a-f-]{36}/, { timeout: 20000 });
  mark('approve_done');
  r.latency['SA approve_quote (PI + order + ledger)'] = t.approve_done - t.approve_click;
  const orderId = c.url().match(/orders\/([0-9a-f-]{36})/)[1];
  remember((s) => { s.orderA = orderId; s.rfqA = rfqId; });
  await runWorker();

  // 4 · Deposit from the wallet
  await c.getByRole('button', { name: /^Pay deposit from/ }).click();
  mark('pay_click');
  await c.getByRole('dialog').getByRole('button', { name: /^Confirm/ }).click();
  await c.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 });
  mark('pay_done');
  r.latency['SA record_payment (deposit)'] = t.pay_done - t.pay_click;
  await runWorker();

  // 5 · Operations confirms the order; the customer's order page shows it live
  await c.reload();
  await c.waitForTimeout(2500);
  const rscOrder = waitRefresh(c);
  mark('confirm_click');
  const { error: ce } = await ops.rpc('transition_order', { p_order: orderId, p_to: 'confirmed', p_reason: 'E2E trace: written confirmation' });
  mark('confirm_done');
  check(!ce, 'operations: transition_order → confirmed', ce?.message);
  r.latency['RPC transition_order confirmed'] = t.confirm_done - t.confirm_click;
  const gotO = await rscOrder;
  const live = await until(async () => /confirmed/i.test(await c.locator('main').innerText()) ? true : null, { timeout: 10000 });
  check(!!gotO && live.value, 'customer order page shows "Confirmed" live (Realtime order_events)', gotO ? `${gotO - t.confirm_done} ms` : 'no push');
  await c.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-02-order-confirmed.png' });
  await runWorker();
  mark('end');
  r.e2e_ms = t.end - t.start;
  check(r.e2e_ms < 90000, 'end-to-end under 90 s (mocked payment)', `${r.e2e_ms} ms`);

  // 6 · Trace
  await until(async () => (await sql(`select count(*)::int n from outbox_events where trace_id=$1 and status <> 'done'`, [trace]))[0].n === 0 ? true : null, { timeout: 30000, every: 2000 });
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  r.ids = { rfqId, orderId };
  check(count(rows, 'rfqs') === 1, '1 rfq row', count(rows, 'rfqs'));
  check(count(rows, 'quotes') === 1, '1 quote row', count(rows, 'quotes'));
  check(count(rows, 'proforma_invoices') === 1, '1 proforma invoice', count(rows, 'proforma_invoices'));
  check(count(rows, 'orders') === 1, '1 order', count(rows, 'orders'));
  const sh = (rows.status_history ?? []).map((x) => `${x.entity}:${x.to_status}`);
  r.status_history = sh;
  check(sh.some((x) => /quote:approved/.test(x)) && sh.some((x) => /order:deposit_paid/.test(x)), 'status_history has quote.approved and order.deposit_paid', sh.join(', '));
  check(sh.some((x) => /order:confirmed/.test(x)), 'status_history has order.confirmed', '');
  const docs = (rows.documents ?? []).map((d) => `${d.doc_type}:${d.number}:${d.pdf_path ?? 'no pdf_path'}`);
  r.documents = docs;
  check(count(rows, 'documents', (d) => /proforma|pi/i.test(d.doc_type)) === 1, '1 PI document row', docs.join(', '));
  check(count(rows, 'documents', (d) => d.pdf_path) >= 1, 'PI PDF stored in the private documents bucket', docs.join(', '));
  check(balanced(rows), 'every journal in the trace balances per currency', `${count(rows, 'journals')} journals / ${count(rows, 'ledger_entries')} entries`);
  const ev = (rows.outbox_events ?? []).map((x) => x.event_type);
  r.outbox = ev;
  for (const e of ['rfq.submitted', 'quote.sent', 'quote.approved', 'payment.confirmed', 'order.confirmed']) check(ev.filter((x) => x === e).length === 1, `outbox ${e} exactly once`, ev.join(', '));
  check((rows.outbox_events ?? []).every((x) => x.status === 'done'), 'all outbox events done');
  const runs = (rows.job_runs ?? []).map((x) => `${x.consumer}`);
  const dupRuns = runs.length !== new Set((rows.job_runs ?? []).map((x) => `${x.event_id}|${x.consumer}`)).size;
  check(!dupRuns, 'no consumer ran twice for one event (job_runs unique)');
  const emails = rows.email_deliveries ?? [];
  r.emails = emails.map((e) => e.template);
  check(emails.filter((e) => /quote.approved/.test(e.template)).length === 1 && emails.filter((e) => /payment.confirmed/.test(e.template)).length === 1, 'PI e-mail + deposit receipt e-mail (1 each)', r.emails.join(', '));
  const wh = rows.webhook_deliveries ?? [];
  r.webhooks = wh.map((w) => `${w.event_type}:${w.response_status}`);
  check(wh.filter((w) => w.event_type === 'order.updated' && w.response_status === 200).length >= 1, 'signed order.updated webhook delivered (HTTP 200)', r.webhooks.join(', '));
  check(count(rows, 'integration_logs', (x) => x.integration_code === 'email') === emails.length, 'every e-mail has an integration_logs row with body SHAs');
  check(count(rows, 'audit_log') >= 1, 'audit entries in the trace', (rows.audit_log ?? []).map((a) => a.action).join(', '));
  r.timings = t;

  // 7 · Idempotency: re-dispatch every event of the trace → consumers skip, no new e-mail/webhook/notification
  const before = { e: emails.length, w: wh.length, n: count(rows, 'notifications') };
  await sql(`update outbox_events set status='pending', available_at=now() where trace_id=$1`, [trace]);
  await runWorker();
  const rows2 = await traceRows(trace);
  const after = { e: count(rows2, 'email_deliveries'), w: count(rows2, 'webhook_deliveries'), n: count(rows2, 'notifications') };
  check(JSON.stringify(before) === JSON.stringify(after), 'dispatcher replay of all events → no second e-mail, webhook or notification', `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check(count(rows2, 'idempotency_hits', (x) => x.scope.startsWith('outbox:')) >= ev.length, 'replay logged as idempotency_hits (outbox:<consumer>)', count(rows2, 'idempotency_hits'));
  // approve again → refused
  const { error: again } = await sb.rpc('approve_quote', { p_quote: rows.quotes[0].id, p_terms_version: null });
  check(!!again, 'second approve_quote refused', again?.message);
  // negative: pay more than the wallet holds is refused by the RPC
  const { error: over } = await sb.rpc('record_payment', { p_order: orderId, p_amount: 999999999, p_method: 'wallet', p_reference: 'E2E-OVER', p_provider_event: null });
  check(!!over, 'negative: overpayment / insufficient wallet refused', over?.message);
} catch (e) {
  check(false, 'unexpected error', e.stack);
  try { await (await browser.contexts()[0]?.pages())?.[0]?.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-02-error.png' }); } catch { /* ignore */ }
} finally {
  await browser.close();
  save();
  process.exit(0);
}
