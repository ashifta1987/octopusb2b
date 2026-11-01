// Chain 14 — Public API POST /v1/rfqs (SPEC §21.1 #14).
// Postman-style calls with a tagged API client for org A: an oct_test_ key (simulated write — AP-02) and an oct_live_
// key (real row) → rfq.submitted outbox → worker → signed `rfq.created` webhook delivered.
import crypto from 'node:crypto';
import { count, hops, http, loadState, newTrace, remember, reporter, runWorker, sql, traceRows, until } from './lib.mjs';

const { r, check, save } = reporter(14, 'Public API POST /v1/rfqs');
const trace = newTrace(14);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const HOOK = 'https://httpbin.org/anything/octopus-trace';
try {
  const orgId = loadState().orgA;
  const keys = {};
  const [client] = await sql(`insert into api_clients(org_id, name, client_id, scopes) values ($1, 'QA-TRACE Postman', $2, $3) returning id`, [orgId, 'cli_trace_' + crypto.randomBytes(6).toString('hex'), ['quotes:write', 'orders:read', 'webhooks:manage']]);
  for (const mode of ['test', 'live']) {
    const key = `oct_${mode}_${crypto.randomBytes(24).toString('hex')}`;
    keys[mode] = key;
    await sql(`insert into api_keys(client_id, org_id, mode, prefix, key_hash) values ($1,$2,$3,$4,$5)`, [client.id, orgId, mode, key.slice(0, 12), crypto.createHash('sha256').update(key).digest('hex')]);
  }
  await sql(`delete from webhook_endpoints where org_id=$1`, [orgId]);
  await sql(`insert into webhook_endpoints(org_id, url, events, secret, active) values ($1,$2,$3,$4,true)`, [orgId, HOOK, ['rfq.created', 'order.updated'], 'whsec_trace_' + crypto.randomBytes(12).toString('hex')]);
  const body = { title: 'QA-TRACE API RFQ (e2e)', quantity: 1200, details: 'E2E trace via public API — please ignore', destinationCountry: 'NL', incoterm: 'FOB' };
  const post = (key, idem, b = body) => http('/api/v1/rfqs', { trace, method: 'POST', body: b, headers: { authorization: `Bearer ${key}`, ...(idem ? { 'idempotency-key': idem } : {}) } });

  // 1 · oct_test_ key: simulated, nothing written
  const before = (await sql(`select count(*)::int n from rfqs where org_id=$1`, [orgId]))[0].n;
  const t1 = await post(keys.test, crypto.randomUUID());
  const mid = (await sql(`select count(*)::int n from rfqs where org_id=$1`, [orgId]))[0].n;
  check(t1.status === 201 && t1.json?.simulated === true && before === mid, 'oct_test_ key → 201 simulated, no DB row (AP-02: test keys never write)', `${t1.status} ${t1.json?.data?.code}`);
  check(t1.traceId === trace, 'API response echoes x-trace-id', t1.traceId);

  // 2 · oct_live_ key: real RFQ
  const idem = crypto.randomUUID();
  const t0 = Date.now();
  const l1 = await post(keys.live, idem);
  r.latency['POST /v1/rfqs (auth → scope → idempotency → api_submit_rfq)'] = l1.ms;
  check(l1.status === 201 && /^RFQ-/.test(l1.json?.data?.code ?? ''), 'oct_live_ key → 201 with the new RFQ id/code', `${l1.json?.data?.id} ${l1.json?.data?.code}`);
  const wk = await runWorker();
  r.latency['worker (rfq.submitted → notify + webhooks_out)'] = wk.ms;
  const wh = await until(async () => (await sql(`select response_status, delivered_at, payload from webhook_deliveries where trace_id=$1 and event_type='rfq.created'`, [trace]))[0], { timeout: 20000 });
  r.e2e_ms = Date.now() - t0;
  check(wh.value && wh.value.response_status === 200 && wh.value.delivered_at, 'signed rfq.created webhook delivered (HTTP 200)', wh.value ? JSON.stringify(wh.value.payload).slice(0, 160) : 'none');
  check(wh.value?.payload?.data?.rfq?.code === l1.json?.data?.code, 'webhook payload carries the same RFQ code', wh.value?.payload?.data?.rfq?.code);

  // 3 · replay with the same Idempotency-Key
  const l2 = await post(keys.live, idem);
  const after = (await sql(`select count(*)::int n from rfqs where org_id=$1 and title=$2`, [orgId, body.title]))[0].n;
  check(l2.status === 201 && l2.headers.get('idempotent-replayed') === 'true' && after === 1, 'replay → same response, Idempotent-Replayed: true, still 1 row', `${l2.status} rows=${after}`);
  const reused = await post(keys.live, idem, { ...body, quantity: 9 });
  check(reused.status === 422 && reused.json?.code === 'IDEMPOTENCY_KEY_REUSED', 'same key, different body → 422 IDEMPOTENCY_KEY_REUSED', reused.json?.code);

  // 4 · negatives
  const noIdem = await post(keys.live, null);
  check(noIdem.status === 400 && noIdem.json?.code === 'IDEMPOTENCY_KEY_REQUIRED', 'missing Idempotency-Key → 400', noIdem.json?.code);
  const badKey = await post('oct_live_' + 'f'.repeat(48), crypto.randomUUID());
  check(badKey.status === 401, 'unknown key → 401 problem+json', badKey.headers.get('content-type'));
  const invalid = await post(keys.live, crypto.randomUUID(), { title: '' });
  check(invalid.status === 422, 'invalid body → 422 VALIDATION_FAILED', invalid.json?.code);

  await until(async () => (await sql(`select count(*)::int n from outbox_events where trace_id=$1 and status <> 'done'`, [trace]))[0].n === 0 ? true : null, { timeout: 20000, every: 2000 });
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  check(count(rows, 'rfqs') === 1, 'exactly 1 rfq row in the trace');
  check(count(rows, 'outbox_events', (x) => x.event_type === 'rfq.submitted') === 1, 'exactly 1 rfq.submitted event');
  check(count(rows, 'webhook_deliveries', (x) => x.event_type === 'rfq.created') === 1, 'exactly 1 rfq.created delivery');
  check(count(rows, 'idempotency_hits', (x) => x.scope === 'api') === 1, 'API replay → idempotency_hits row', count(rows, 'idempotency_hits'));
  check(count(rows, 'journals') === 1, 'RFQ fee journal (wallet) once', count(rows, 'journals'));
  remember((s) => { s.apiClient = client.id; });
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  save();
  process.exit(0);
}
