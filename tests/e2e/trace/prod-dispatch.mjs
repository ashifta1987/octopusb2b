// Production dispatcher check (QA FN-02, SPEC §10.3): pg_cron `octopus-outbox-dispatch` → job_dispatch_outbox() →
// pg_net GET https://octopus-b2b.vercel.app/api/cron/outbox. Writes one tagged event for test org A and measures how
// long the DEPLOYED worker takes to pick it up. Leaves the cron job enabled.
import fs from 'node:fs';
import { loadState, newTrace, remember, sleep, sql } from './lib.mjs';

const trace = newTrace(0);
remember((s) => s.traces.push(trace));
const st = loadState();
const [job] = await sql(`select jobid, schedule, active from cron.job where jobname='octopus-outbox-dispatch'`);
await sql(`select cron.alter_job($1, active := true)`, [job.jobid]);
const [{ max: lastResp }] = await sql(`select coalesce(max(id),0) max from net._http_response`);
await sql('begin');
await sql(`select set_config('app.trace_id', $1, true)`, [trace]);
await sql(`select emit_event('order.in_production', 'order', $1, jsonb_build_object('org_id', $2::text, 'note', 'E2E trace production dispatcher check'))`, [st.orderA, st.orgA]);
await sql('commit');
const [ev] = await sql(`select id, created_at from outbox_events where trace_id=$1`, [trace]);
const t0 = Date.now();
let done = null;
for (let i = 0; i < 45; i++) {
  const [e] = await sql(`select status, attempts from outbox_events where id=$1`, [ev.id]);
  if (e.status === 'done' || e.status === 'dead') { done = e; break; }
  await sleep(2000);
}
const runs = await sql(`select consumer, outcome, duration_ms, created_at, trace_id from job_runs where event_id=$1 order by created_at`, [ev.id]);
const resp = await sql(`select id, status_code, left(content::text, 200) content, created from net._http_response where id > $1 order by id`, [lastResp]);
const cronRuns = await sql(`select status, return_message, start_time from cron.job_run_details where jobid=$1 and start_time > $2 order by start_time`, [job.jobid, ev.created_at]);
const firstRun = runs[0] ? Date.parse(runs[0].created_at) - Date.parse(ev.created_at) : null;
const out = {
  trace, job, event: ev.id, final: done, pickup_ms: firstRun, waited_ms: Date.now() - t0,
  job_runs: runs.map((r) => `${r.consumer} ${r.outcome} ${r.duration_ms} ms trace=${r.trace_id}`),
  http: resp.map((r) => `${r.status_code} ${r.content}`), cron_runs: cronRuns.length,
};
fs.writeFileSync('docs/qa/2026-11-01-trace/prod-dispatch.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
