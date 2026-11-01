// Chain 5 — Service request (QC day) paid from the wallet (SPEC §21.1 #5).
// "Book QC inspection" form → ConfirmCharge → request_service (wallet debit journal, service_request.paid) →
// operations accepts → in progress → report ready → completed; customer e-mails on receipt/report; notifications.
import { chromium } from '@playwright/test';
import { BASE, balanced, count, ensureBuyer, hops, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows, until } from './lib.mjs';

const { r, check, save } = reporter(5, 'Service request (QC day) with wallet pay');
const trace = newTrace(5);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const browser = await chromium.launch();
try {
  const buyer = await ensureBuyer('a');
  const sb = await signIn(buyer.email, trace);
  const ops = await signIn('ops@demo.octopusb2b.com', trace, { staff: true });
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await ctx.addCookies(pwCookies(sb));
  const c = await ctx.newPage();
  const t0 = Date.now();
  await c.goto(`${BASE}/request/qc`);
  await c.locator('#rq-product').fill('QA-TRACE hex bolts M10 (e2e)');
  await c.locator('#rq-inspection_type').selectOption({ index: 1 });
  await c.locator('#rq-quantity').fill('5000');
  await c.locator('#rq-factory_location').fill('Ningbo, CN');
  await c.getByRole('button', { name: /book|request|submit/i }).last().click();
  const ts = Date.now();
  await c.getByRole('dialog').getByRole('button', { name: /^Confirm/ }).click();
  await c.waitForURL(/\/account\/services/, { timeout: 20000 });
  r.latency['SA request_service (wallet debit)'] = Date.now() - ts;
  const [svc] = await sql(`select id, code, status, fee_minor, currency, paid_via from service_requests where trace_id=$1`, [trace]);
  check(svc && svc.status === 'paid' && svc.paid_via === 'wallet', 'QC request paid from the wallet', JSON.stringify(svc));
  await runWorker();
  for (const to of ['accepted', 'in_progress', 'report_ready', 'completed']) {
    const t = Date.now();
    const { error } = await ops.rpc('transition_service_request', { p_id: svc.id, p_to: to, p_reason: `E2E trace → ${to}` });
    r.latency[`RPC transition_service_request ${to}`] = Date.now() - t;
    check(!error, `operations: → ${to}`, error?.message);
  }
  await runWorker();
  r.e2e_ms = Date.now() - t0;
  await until(async () => (await sql(`select count(*)::int n from outbox_events where trace_id=$1 and status <> 'done'`, [trace]))[0].n === 0 ? true : null, { timeout: 30000, every: 2000 });
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  check(count(rows, 'journals') === 1 && count(rows, 'ledger_entries') === 2 && balanced(rows), 'one wallet-debit journal, 2 balanced entries', JSON.stringify((rows.ledger_entries ?? []).map((e) => [e.debit_cents, e.credit_cents, e.currency])));
  const ev = (rows.outbox_events ?? []).map((e) => `${e.event_type}${e.payload?.to ? ':' + e.payload.to : ''}`);
  r.outbox = ev;
  check(ev.filter((e) => e === 'service_request.paid').length === 1, 'service_request.paid once', ev.join(', '));
  check(ev.filter((e) => e.startsWith('service_request.updated')).length === 4, '4 service_request.updated events (one per step)', '');
  const mails = (rows.email_deliveries ?? []).map((e) => e.template);
  r.emails = mails;
  check(mails.length === 3, 'customer e-mails: receipt (paid), report ready, completed', mails.join(', '));
  check(count(rows, 'notifications') >= 3, 'customer notifications per step', count(rows, 'notifications'));
  const sh = (rows.status_history ?? []).map((x) => x.to_status);
  check(['paid', 'accepted', 'in_progress', 'report_ready', 'completed'].every((s) => sh.filter((x) => x === s).length === 1), 'status_history: paid → accepted → in_progress → report_ready → completed', sh.join(' → '));
  check(count(rows, 'audit_log', (a) => a.action === 'status.service_request') === 5, 'audit entry per transition (status.service_request)', count(rows, 'audit_log'));
  const [after] = await sql(`select assigned_to, report_path from service_requests where id=$1`, [svc.id]);
  check(!!after.assigned_to, 'QC coordinator assigned on the request', JSON.stringify(after));
  check(!!after.report_path, 'QC report PDF stored (report_path)', JSON.stringify(after));
  // idempotency: same Idempotency key twice → one request
  const idem = 'e2e-trace-' + Date.now();
  const a1 = await sb.rpc('request_service', { p_service: 'qc', p_details: { product: 'idem probe', inspection_type: 'Factory audit' }, p_product: null, p_idem: `svc:${idem}` });
  const a2 = await sb.rpc('request_service', { p_service: 'qc', p_details: { product: 'idem probe', inspection_type: 'Factory audit' }, p_product: null, p_idem: `svc:${idem}` });
  const n = (await sql(`select count(*)::int n from service_requests where trace_id=$1 and details->>'product'='idem probe'`, [trace]))[0].n;
  check(!a1.error && !a2.error && a1.data === a2.data && n === 1, 'same idempotency key twice → one request, one debit', `${a1.data} / ${a2.data} / rows ${n}`);
  // negative: rejection after payment refunds automatically
  const { error: rj } = await ops.rpc('transition_service_request', { p_id: a1.data, p_to: 'rejected', p_reason: 'E2E trace refund path' });
  const [rf] = await sql(`select status from service_requests where id=$1`, [a1.data]);
  check(!rj && rf.status === 'refunded', 'negative: rejected paid request → refunded automatically (refund journal)', rf.status);
  // negative: invalid transition refused
  const { error: bad } = await ops.rpc('transition_service_request', { p_id: svc.id, p_to: 'paid', p_reason: 'back' });
  check(!!bad, 'negative: completed → paid refused', bad?.message);
  await runWorker();
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
