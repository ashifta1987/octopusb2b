// Shared helpers for the SPEC §21 end-to-end connection trace (docs/E2E_TRACE_REPORT.md).
// The live database is production: every row a chain writes carries a trace id starting with "e2e-" and every
// test org/user is tagged "qa-trace"; `cleanup()` removes them (audit_log rows are kept — append-only by design).
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { signStaffCookie } from '../../../lib/staff/session-cookie.ts';

config({ path: '.env.local', quiet: true });
export const BASE = process.env.BASE ?? 'http://localhost:3100';
export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const PW = process.env.DEMO_PASSWORD ?? 'Octo-f56e715f-Demo!';
const REF = new URL(SB_URL).hostname.split('.')[0];
export const OUT = 'docs/qa/2026-11-01-trace';
fs.mkdirSync(OUT, { recursive: true });
const STATE = path.join(OUT, 'state.json'); // ids created across chain scripts (for clean-up)

export const admin = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let connected = false;
export async function sql(q, params = []) {
  if (!connected) { await db.connect(); connected = true; }
  return (await db.query(q, params)).rows;
}

export function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { users: {}, orgs: [], traces: [], factors: [], extra: [] }; } }
export function saveState(s) { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); }
export function remember(fn) { const s = loadState(); fn(s); saveState(s); return s; }

export const newTrace = (chain) => `e2e-c${String(chain).padStart(2, '0')}-${crypto.randomBytes(6).toString('hex')}`;
export const sha = (s) => crypto.createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── results ───────── */
export function reporter(chain, title) {
  const r = { chain, title, started_at: new Date().toISOString(), checks: [], hops: [], latency: {}, notes: [], traces: [] };
  const check = (ok, name, detail = '') => { r.checks.push({ ok: !!ok, name, detail: String(detail).slice(0, 400) }); console.log(ok ? '✔' : '✘', name, detail ? `— ${String(detail).slice(0, 200)}` : ''); return !!ok; };
  const note = (s) => { r.notes.push(s); console.log('·', s); };
  const save = () => { r.finished_at = new Date().toISOString(); fs.writeFileSync(path.join(OUT, `chain-${String(chain).padStart(2, '0')}.json`), JSON.stringify(r, null, 2)); return r; };
  return { r, check, note, save };
}

/* ───────── identities ───────── */
function b32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totp(secret, at = Date.now()) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(at / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }

/** Supabase client whose every PostgREST call carries `x-trace-id` (same header the app's server clients send). */
export function traced(trace) {
  return createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { 'x-trace-id': trace } } });
}

/** Signs in; staff get a temporary TOTP factor (deleted by id in cleanup) so the session is aal2. */
export async function signIn(email, trace, { staff = false, password = PW } = {}) {
  const sb = traced(trace);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  let session = data.session;
  let factorId = null;
  if (staff) {
    // reuse this run's temporary factor (Supabase needs aal2 to enrol a second one); never touch other factors
    const known = loadState().secrets?.[email];
    let secretB32;
    if (known) { factorId = known.id; secretB32 = known.secret; }
    else {
      const en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'e2e-trace-' + Date.now() });
      if (en.error) throw en.error;
      factorId = en.data.id; secretB32 = en.data.totp.secret;
      remember((s) => { s.factors.push(factorId); s.secrets = { ...(s.secrets ?? {}), [email]: { id: factorId, secret: secretB32 } }; });
    }
    const v = await sb.auth.mfa.challengeAndVerify({ factorId, code: totp(secretB32) });
    if (v.error) throw v.error;
    session = (await sb.auth.getSession()).data.session;
    sb._totpSecret = secretB32;
  }
  sb._session = session; sb._user = data.user; sb._factorId = factorId;
  return sb;
}

/** Cookie header for the local app (Supabase SSR cookie chunks + staff session cookie for staff). */
export function cookieFor(sb, { staff = false } = {}) {
  const name = `sb-${REF}-auth-token`;
  const val = 'base64-' + Buffer.from(JSON.stringify(sb._session)).toString('base64url');
  const parts = [];
  if (staff) { const now = Date.now(); parts.push(`oct_staff=${signStaffCookie({ start: now, last: now, trusted: false, uid: sb._user.id }, process.env.STAFF_SESSION_SECRET)}`); }
  const CH = 3180;
  for (let i = 0; i * CH < val.length; i++) parts.push(`${name}.${i}=${val.slice(i * CH, (i + 1) * CH)}`);
  return parts.join('; ');
}

/** Playwright cookies for the same session. */
export function pwCookies(sb, { staff = false } = {}) {
  const u = new URL(BASE);
  return cookieFor(sb, { staff }).split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: u.hostname, path: '/', httpOnly: false, secure: false, sameSite: 'Lax' }; });
}

/** Creates (or reuses) a tagged test user with an org via complete_onboarding. */
export async function ensureBuyer(key, { country = 'NL', company } = {}) {
  const email = `qa-trace-${key}@demo.octopusb2b.com`;
  const st = loadState();
  let uid = st.users[email];
  if (!uid) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `QA Trace ${key}` } });
    if (error) throw error;
    uid = data.user.id;
    remember((s) => { s.users[email] = uid; });
  }
  return { email, uid, company: company ?? `QA-TRACE ${key.toUpperCase()} BV`, country };
}

/* ───────── HTTP ───────── */
export async function http(pathname, { trace, cookie, method = 'GET', body, headers = {}, redirect = 'manual' } = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + pathname, {
    method, redirect,
    headers: { ...(trace ? { 'x-trace-id': trace } : {}), ...(cookie ? { cookie } : {}), ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - t0);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ms, traceId: res.headers.get('x-trace-id'), headers: res.headers, text, json };
}

/** Runs the outbox worker on the local app (what pg_cron + pg_net do every 10 s in production). */
export async function runWorker(trace = undefined) {
  return http('/api/cron/outbox', { trace, headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
}

/** Polls `fn` until it returns truthy or the timeout passes. Returns { value, ms }. */
export async function until(fn, { timeout = 30000, every = 500 } = {}) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return { value: v, ms: Date.now() - t0 }; if (Date.now() - t0 > timeout) return { value: null, ms: Date.now() - t0 }; await sleep(every); }
}

/* ───────── trace collection ───────── */
export async function traceRows(trace) {
  const [{ trace_rows }] = await sql('select public.trace_rows($1) as trace_rows', [trace]);
  return trace_rows ?? {};
}
const TS = ['created_at', 'occurred_at', 'requested_at', 'assigned_at', 'started_at', 'last_message_at'];
const SUMMARY = {
  status_history: (r) => `${r.entity} ${r.from_status ?? '∅'}→${r.to_status}`,
  outbox_events: (r) => `${r.event_type} [${r.status}${r.attempts ? ` ×${r.attempts}` : ''}] agg=${r.aggregate_type}:${String(r.aggregate_id).slice(0, 8)} payload#${sha(r.payload).slice(0, 10)}`,
  journals: (r) => `${r.number ?? ''} ${r.stream ?? ''} ${r.memo ?? ''}`.trim(),
  ledger_entries: (r) => `acct=${String(r.account_id).slice(0, 8)} Dr ${r.debit_cents} Cr ${r.credit_cents} ${r.currency}`,
  job_runs: (r) => `${r.consumer} → ${r.outcome} (${r.duration_ms} ms) evt=${String(r.event_id).slice(0, 8)}`,
  notifications: (r) => `${r.title}${r.user_id ? ' (user)' : ''}`,
  email_deliveries: (r) => `${r.template} → ${r.provider} ${r.status} rcpt#${r.recipient_hash.slice(0, 10)} msg=${r.provider_message_id ?? '—'}`,
  integration_logs: (r) => `${r.integration_code} ${r.direction} ${r.status} ${r.endpoint ?? ''} req#${(r.request_sha ?? '').slice(0, 10)} res#${(r.response_sha ?? '').slice(0, 10)}`,
  webhook_deliveries: (r) => `${r.event_type} → HTTP ${r.response_status ?? '—'} ${r.delivered_at ? 'delivered' : 'failed'}`,
  audit_log: (r) => `${r.action} ${r.entity ?? ''} actor=${String(r.actor_id ?? 'system').slice(0, 8)}`,
  idempotency_hits: (r) => `${r.scope} key=${String(r.key).slice(0, 24)} orig=${r.original_trace_id ?? '—'}`,
};
/** Flattens trace rows into a time-ordered hop list. */
export function hops(rows) {
  const out = [];
  for (const [table, list] of Object.entries(rows)) for (const r of list) {
    const at = TS.map((k) => r[k]).find(Boolean);
    const fn = SUMMARY[table];
    const summary = fn ? fn(r) : (r.code ?? r.number ?? r.status ?? r.title ?? r.event_type ?? r.id ?? '');
    out.push({ at, table, txid: r.txid ?? null, id: r.id ?? r.event_id ?? null, summary: String(summary).slice(0, 160) });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
export const count = (rows, table, pred = () => true) => (rows[table] ?? []).filter(pred).length;
/** Journals of a trace balance per currency. */
export function balanced(rows) {
  const by = {};
  for (const e of rows.ledger_entries ?? []) { const k = `${e.journal_id}|${e.currency}`; by[k] = (by[k] ?? 0) + Number(e.debit_cents) - Number(e.credit_cents); }
  return Object.values(by).every((v) => v === 0);
}

/* ───────── clean-up ───────── */
/** Deletes every row of the e2e traces + test orgs/users. Loops until no table makes progress (FK order). */
export async function cleanup({ keepUsers = false } = {}) {
  const st = loadState();
  const emails = Object.keys(st.users);
  const uids = Object.values(st.users);
  const orgs = [...new Set((await sql(`select distinct org_id from org_members where user_id = any($1::uuid[]) union select id from organizations where name like 'QA-TRACE %'`, [uids])).map((r) => r.org_id).concat(st.orgs ?? []).filter(Boolean))];
  const tables = (await sql(`select c.table_name, array_agg(c.column_name::text) cols from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE' where c.table_schema='public' group by 1`));
  const userFks = await sql(`select conrelid::regclass::text t, a.attname col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey) where c.contype='f' and c.confrelid='auth.users'::regclass and c.connamespace='public'::regnamespace`);
  const deleted = {};
  for (let pass = 0; pass < 12; pass++) {
    let progress = 0;
    for (const { table_name: t, cols } of tables) {
      if (t === 'audit_log' || t === '_migrations') continue;
      const conds = [];
      if (cols.includes('trace_id')) conds.push(`trace_id like 'e2e-%'`);
      if (cols.includes('org_id') && orgs.length) conds.push(`org_id = any($1::uuid[])`);
      if (t === 'organizations' && orgs.length) conds.push(`id = any($1::uuid[])`);
      if (t === 'outbox_events' && orgs.length) conds.push(`payload->>'org_id' = any($1::uuid[]::text[])`);
      for (const fk of userFks.filter((f) => f.t === t)) conds.push(`${fk.col} = any($2::uuid[])`);
      if (!conds.length) continue;
      try {
        // both parameters are always referenced so the bind count matches
        const r = await db.query(`delete from public.${t} where (${conds.join(' or ')}) and cardinality($1::uuid[]) >= 0 and cardinality($2::uuid[]) >= 0`, [orgs, uids]);
        if (r.rowCount) { progress += r.rowCount; deleted[t] = (deleted[t] ?? 0) + r.rowCount; }
      } catch (e) {
        if (!/foreign key|violates/.test(e.message)) console.warn('cleanup', t, e.message);
      }
    }
    if (!progress) break;
  }
  if (st.factors?.length) {
    const r = await db.query(`delete from auth.mfa_factors where id = any($1::uuid[])`, [st.factors]);
    deleted['auth.mfa_factors'] = r.rowCount;
  }
  if (!keepUsers) for (const uid of uids) { const { error } = await admin.auth.admin.deleteUser(uid); if (!error) deleted['auth.users'] = (deleted['auth.users'] ?? 0) + 1; }
  saveState({ users: keepUsers ? st.users : {}, orgs: [], traces: st.traces, factors: [], secrets: {}, extra: [] });
  return { emails, orgs, deleted };
}

export function mermaid(participants, steps) {
  const lines = ['sequenceDiagram', ...participants.map(([id, label]) => `  participant ${id} as ${label}`)];
  for (const s of steps) lines.push(`  ${s}`);
  return lines.join('\n');
}

/** Resolves with the time of the next router.refresh() RSC request for the page's own path (not a link prefetch). */
export function waitRefresh(page, timeout = 20000) {
  const path = new URL(page.url()).pathname;
  return page.waitForRequest((q) => { const h = q.headers(); return h['rsc'] === '1' && !h['next-router-prefetch'] && new URL(q.url()).pathname === path; }, { timeout })
    .then(() => Date.now()).catch(() => null);
}
