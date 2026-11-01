// Chains 9 + 10 — AI assistant message → tool call → reply, then escalation → Support ticket → staff reply
// (SPEC §21.1 #9, #10). Customer uses /account/assistant in a browser; the account manager (support@, aal2) watches
// /office/assistant and replies; the customer's thread shows the reply live.
import { chromium } from '@playwright/test';
import { BASE, count, ensureBuyer, hops, http, cookieFor, loadState, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows, until, waitRefresh } from './lib.mjs';

const r9 = reporter(9, 'AI assistant message → tool-call → reply');
const r10 = reporter(10, 'Escalation → Support ticket → staff reply');
const trace9 = newTrace(9);
const trace10 = newTrace(10);
r9.r.traces.push(trace9); r10.r.traces.push(trace10);
remember((s) => s.traces.push(trace9, trace10));
const browser = await chromium.launch();
let sessionId = null;
try {
  const st = loadState();
  const buyer = await ensureBuyer('a');
  const [ord] = await sql(`select code from orders where id=$1`, [st.orderA]);
  // ── chain 9 ──
  const sb = await signIn(buyer.email, trace9);
  const cookie = cookieFor(sb);
  const t0 = Date.now();
  const a = await http('/api/assistant/reply', { trace: trace9, cookie, method: 'POST', body: { message: `Where is my order ${ord.code} and when will it arrive?`, page: '/account/orders' } });
  r9.r.latency['POST /api/assistant/reply (RLS context + tools + LLM + record_bot_reply)'] = a.ms;
  sessionId = a.json?.session_id;
  remember((s) => { s.assistantSession = sessionId; });
  const bot = (a.json?.messages ?? []).filter((m) => m.author === 'bot');
  r9.check(a.status === 200 && bot.length === 1, 'assistant answered', `${a.status} ${bot[0]?.content?.slice(0, 160)}`);
  r9.check(new RegExp(st.trackingA).test(bot[0]?.content ?? ''), 'reply quotes the real tracking number from get_shipment', st.trackingA);
  const [msg] = await sql(`select confidence, tools_called, latency_ms, tokens, trace_id from assistant_messages where session_id=$1 and author='bot' order by created_at desc limit 1`, [sessionId]);
  r9.r.bot = msg;
  r9.check(Array.isArray(msg.tools_called) && msg.tools_called.some((x) => (x.tool ?? x.name) === 'get_shipment'), 'tools_called logs get_shipment', JSON.stringify(msg.tools_called).slice(0, 200));
  r9.check(msg.confidence !== null && msg.trace_id === trace9, 'reply row carries the confidence score and the trace id', `confidence ${msg.confidence}, latency ${msg.latency_ms} ms, tokens ${msg.tokens}`);
  r9.r.e2e_ms = Date.now() - t0;
  const rows9 = await traceRows(trace9);
  r9.r.hops = hops(rows9);
  const llm = (rows9.integration_logs ?? []).filter((x) => /openai|ai-mock/.test(x.integration_code));
  r9.check(llm.length >= 1 && llm.every((x) => x.request_sha && x.response_sha), 'LLM calls logged to integration_logs with request/response SHA', llm.map((x) => `${x.integration_code} ${x.status} ${x.duration_ms} ms`).join(', '));
  r9.check(count(rows9, 'integration_logs', (x) => x.integration_code === 'yunexpress') >= 1, 'YunExpress response SHA in integration_logs for the same trace', 'get_shipment reads the webhook-fed tracking_events table — no live carrier call');
  r9.check(count(rows9, 'assistant_messages') === 2, 'customer + bot message rows in the trace', count(rows9, 'assistant_messages'));
  // negative: other org's order is invisible under RLS
  const other = await http('/api/assistant/reply', { trace: trace9, cookie, method: 'POST', body: { message: 'Where is order ORD-2202?', session_id: sessionId, page: '/account/orders' } });
  const otherBot = (other.json?.messages ?? []).filter((m) => m.author === 'bot').map((m) => m.content).join(' ');
  r9.check(!/YT2530412345678/.test(otherBot), 'negative: another org\'s shipment (ORD-2202) is not revealed (RLS)', otherBot.slice(0, 160));
  r9.r.notes.push('LLM schema-error path is covered by unit tests (parseModelReply → low confidence + escalation); not forced live.');

  // ── chain 10 ── customer page + staff queue open, sensitive topic escalates
  const sb10 = await signIn(buyer.email, trace10);
  const staff = await signIn('support@demo.octopusb2b.com', trace10, { staff: true });
  const cctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace10 } });
  await cctx.addCookies(pwCookies(sb10));
  const sctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace10 } });
  await sctx.addCookies(pwCookies(staff, { staff: true }));
  const c = await cctx.newPage();
  const s = await sctx.newPage();
  await s.goto(`${BASE}/office/assistant`);
  await c.goto(`${BASE}/account/assistant?session=${sessionId}`);
  await c.waitForTimeout(2500);
  await s.waitForTimeout(1000);
  const nudge = waitRefresh(s);
  const t10 = Date.now();
  await c.locator('textarea').fill('The last batch failed RoHS testing. I want a refund on the shipping.');
  await c.getByRole('button', { name: 'Send' }).click();
  const esc = await until(async () => (await sql(`select e.id, e.reason, e.ticket_id, e.assigned_to, e.trace_id, t.code from escalations e left join tickets t on t.id=e.ticket_id where e.session_id=$1`, [sessionId]))[0], { timeout: 20000 });
  r10.r.latency['customer message → escalation row'] = Date.now() - t10;
  r10.check(esc.value && esc.value.ticket_id, 'escalation row + Support ticket with transcript', esc.value ? `${esc.value.reason} → ${esc.value.code}` : 'none');
  const gotNudge = await nudge;
  r10.check(!!gotNudge, '/office/assistant queue refreshed live on the new escalation (Realtime)', gotNudge ? `${gotNudge - t10} ms` : 'no push');
  await s.goto(`${BASE}/office/assistant?session=${sessionId}`);
  await c.waitForTimeout(1500);
  const tr = Date.now();
  const { error: re } = await staff.rpc('staff_assistant_reply', { p_session: sessionId, p_content: 'Hi, QA trace here — I am reviewing the RoHS report and the shipping refund now.', p_internal: false });
  r10.check(!re, 'account manager replied from the back office', re?.message);
  const seen = await until(async () => (await c.getByText('reviewing the RoHS report').count()) > 0 ? true : null, { timeout: 15000 });
  r10.r.latency['staff reply → visible in customer thread'] = seen.value ? seen.ms : null;
  r10.check(!!seen.value, 'staff reply visible to the customer in-thread without reload (Realtime)', seen.value ? `${Date.now() - tr} ms` : 'not seen');
  await c.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-10-customer-thread.png' });
  await runWorker();
  r10.r.e2e_ms = Date.now() - t10;
  const rows10 = await traceRows(trace10);
  r10.r.hops = hops(rows10);
  r10.check(count(rows10, 'escalations') === 1, 'exactly 1 escalation in the trace', count(rows10, 'escalations'));
  r10.check(count(rows10, 'tickets') === 1 && count(rows10, 'ticket_messages') >= 1, 'ticket + transcript message in the trace', `${count(rows10, 'tickets')} / ${count(rows10, 'ticket_messages')}`);
  r10.check(count(rows10, 'outbox_events', (x) => x.event_type === 'assistant.escalated') === 1, 'outbox assistant.escalated once', (rows10.outbox_events ?? []).map((x) => x.event_type).join(', '));
  r10.check(count(rows10, 'notifications') >= 1, 'staff notification for the handoff', count(rows10, 'notifications'));
  r10.check(count(rows10, 'audit_log') >= 1, 'audit entries (log_assistant_open / escalation)', (rows10.audit_log ?? []).map((x) => x.action).join(', '));
  // idempotency: escalate again while open → same escalation
  const { error: e2 } = await sb10.rpc('escalate_session', { p_session: sessionId, p_reason: 'customer_request', p_excerpt: 'again', p_confidence: null });
  const n = (await sql(`select count(*)::int n from escalations where session_id=$1`, [sessionId]))[0].n;
  r10.check(!e2 && n === 1, 'replay: escalating an open session again is a no-op (1 escalation)', e2?.message ?? `count ${n}`);
  // negative: a customer cannot post a staff reply
  const { error: neg } = await sb10.rpc('staff_assistant_reply', { p_session: sessionId, p_content: 'x', p_internal: false });
  r10.check(!!neg, 'negative: customer calling staff_assistant_reply refused', neg?.message);
} catch (e) {
  r9.check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  r9.save(); r10.save();
  process.exit(0);
}
