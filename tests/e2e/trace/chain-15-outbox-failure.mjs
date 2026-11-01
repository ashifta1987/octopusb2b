// Chain 15 — Outbox event with worker failure (SPEC §21.1 #15).
// A second local app instance (port 3101) uses the live e-mail adapter against a mock that answers 503. The worker
// retries with the §10.2 backoff (1 m, 5 m, 30 m, 2 h, 6 h — fast-forwarded by moving available_at), dead-letters
// after the 5th retry, alerts admins, and the event appears in Admin → Integrations → Failed jobs, whose Retry button
// (qa-trace-admin) re-queues it; the healthy worker (3100) then delivers it once.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { BASE, count, ensureTraceAdmin, hops, loadState, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows } from './lib.mjs';

const { r, check, note, save } = reporter(15, 'Outbox event with worker failure');
const trace = newTrace(15);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const FAILING = 'http://localhost:3101';
const browser = await chromium.launch();
try {
  const st = loadState();
  const others = await sql(`select count(*)::int n from outbox_events where status in ('pending','dispatched') and (trace_id is null or trace_id not like 'e2e-%')`);
  note(`other due events when starting: ${others[0].n}`);
  await sql('begin');
  await sql(`select set_config('app.trace_id', $1, true)`, [trace]);
  await sql(`select emit_event('order.in_production', 'order', $1, jsonb_build_object('org_id', $2::text, 'note', 'E2E trace worker-failure drill'))`, [st.orderA, st.orgA]);
  await sql('commit');
  const [ev] = await sql(`select id from outbox_events where trace_id=$1`, [trace]);
  const plan = [];
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${FAILING}/api/cron/outbox`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    void res;
    const [e] = await sql(`select status, attempts, extract(epoch from (available_at - now()))::int delay_s, last_error from outbox_events where id=$1`, [ev.id]);
    plan.push({ run: i + 1, status: e.status, attempts: e.attempts, next_in_s: e.status === 'pending' ? e.delay_s : null });
    if (e.status === 'dead') break;
    await sql(`update outbox_events set available_at = now() where id=$1`, [ev.id]); // fast-forward the backoff
  }
  r.retry_plan = plan;
  console.table(plan);
  const delays = plan.filter((p) => p.status === 'pending').map((p) => p.next_in_s);
  const want = [60, 300, 1800, 7200, 21600];
  check(delays.length === 5 && delays.every((d, i) => Math.abs(d - want[i]) <= 5), 'backoff schedule honoured: 1 m, 5 m, 30 m, 2 h, 6 h', delays.join(', '));
  check(plan.at(-1)?.status === 'dead' && plan.length === 6, '5 retries, then dead-letter on the 6th failure', JSON.stringify(plan.at(-1)));
  let rows = await traceRows(trace);
  check(count(rows, 'email_deliveries', (x) => x.status === 'failed') === 6, '6 failed e-mail attempts logged (email_deliveries)', count(rows, 'email_deliveries'));
  check(count(rows, 'integration_logs', (x) => x.integration_code === 'email' && x.status === 502) === 6, 'each failure in integration_logs (502) with request SHA', '');
  check(count(rows, 'notifications', (x) => x.org_id) === 1, 'customer notification sent once despite 6 runs (notify consumer idempotent)', count(rows, 'notifications', (x) => x.org_id));
  check(count(rows, 'notifications', (x) => x.user_id && /Outbox job failed/.test(x.title)) >= 1, 'alert: every admin notified of the dead letter', count(rows, 'notifications', (x) => x.user_id));
  check(count(rows, 'integration_logs', (x) => x.integration_code === 'outbox' && x.status === 500) === 1, 'alert: integration_logs outbox dead-letter row', '');
  const mock = fs.readFileSync('/tmp/trace15/mock.log', 'utf8');
  check(mock.includes(`x-octopus-trace=${trace}`), 'outbound e-mail call carried x-octopus-trace', (mock.match(/x-octopus-trace=\S+/g) ?? []).slice(-1)[0]);
  check(false, 'Sentry breadcrumb with the trace id', 'SENTRY_DSN not configured (IN-02) — structured JSON log line "outbox_dead_letter" carries trace_id instead');

  // Admin → Integrations → Failed jobs → Retry
  const adm = await ensureTraceAdmin();
  const sb = await signIn(adm.email, trace, { staff: true });
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await ctx.addCookies(pwCookies(sb, { staff: true }));
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/admin/integrations`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('tr', { hasText: 'order.in_production' }).filter({ hasText: /dead/i }).first();
  await row.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-15-failed-jobs.png' });
  await row.getByRole('button', { name: 'Retry' }).click();
  let re = null;
  for (let i = 0; i < 30; i++) { [re] = await sql(`select status, attempts from outbox_events where id=$1`, [ev.id]); if (re.status === 'pending') break; await page.waitForTimeout(500); }
  check(re.status === 'pending' && re.attempts === 0, 'admin Retry button re-queued the event (attempts reset)', JSON.stringify(re));
  await runWorker(); // healthy worker (log adapter)
  rows = await traceRows(trace);
  const [fin] = await sql(`select status from outbox_events where id=$1`, [ev.id]);
  check(fin.status === 'done', 'after retry the event is delivered (done)', fin.status);
  check(count(rows, 'email_deliveries', (x) => x.status !== 'failed') === 1, 'exactly one successful e-mail after the retry', count(rows, 'email_deliveries', (x) => x.status !== 'failed'));
  check(count(rows, 'notifications', (x) => x.org_id) === 1, 'still one customer notification (no duplicate on retry)', '');
  check(count(rows, 'webhook_deliveries') === 1, 'webhook delivered once across all runs', count(rows, 'webhook_deliveries'));
  check(count(rows, 'audit_log', (x) => x.action === 'outbox.retry') === 1, 'audit: outbox.retry', '');
  check(count(rows, 'idempotency_hits', (x) => x.scope.startsWith('outbox:')) >= 1, 'retries skipped finished consumers (idempotency_hits)', count(rows, 'idempotency_hits'));
  r.hops = hops(rows);
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
