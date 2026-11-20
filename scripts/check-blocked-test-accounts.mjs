// Proves the 8 blocked e2e finance accounts from 7 Nov 2026 are dead on STAGING (owner, 20 Nov 2026):
//  · still blocked (banned), no staff role, no division membership, no session or refresh token, profile inactive
//  · cannot sign in: a sign-in link generated with the admin API (no e-mail is sent) is refused by Supabase Auth
//  · cannot call any staff API: acting as each account (as if it held a valid 2FA token), every staff check is false
//    and staff RPCs / staff-only tables refuse or return nothing
// Read-only (the staff calls run in a transaction that is rolled back). STAGING ONLY.
// Run: node scripts/with-staging-env.mjs node scripts/check-blocked-test-accounts.mjs
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { loadStagingEnvOrExit, assertStagingDatabase } from './lib-staging-guard.mjs';

loadStagingEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [] }; } };

const users = (await db.query(`select u.id, u.email, u.banned_until > now() banned,
    (select count(*) from user_roles r where r.user_id = u.id)::int roles,
    (select count(*) from division_members d where d.user_id = u.id)::int divs,
    (select count(*) from auth.sessions s where s.user_id = u.id)::int sessions,
    (select count(*) from auth.refresh_tokens t where t.user_id::uuid = u.id and not t.revoked)::int tokens,
    (select active from profiles p where p.id = u.id) active
  from auth.users u where u.email like 'e2e.finance+%' and u.created_at < '2026-11-08' order by u.created_at`)).rows;
ok(users.length === 8, `8 accounts found (${users.length})`);

const now = Math.floor(Date.now() / 1000);
for (const u of users) {
  const tag = u.email.replace(/@.*/, '');
  ok(u.banned && u.roles === 0 && u.divs === 0 && u.sessions === 0 && u.tokens === 0 && u.active === false,
    `${tag}: blocked, 0 staff roles, 0 divisions, 0 sessions, 0 refresh tokens, profile inactive`);
  // sign-in: Supabase Auth refuses a valid one-time sign-in link for a blocked user (no e-mail is sent)
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.email });
  const v = le ? { error: le } : await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  ok(!!v.error && !v.data?.session, `${tag}: sign-in refused (${(v.error?.message ?? 'SIGNED IN').slice(0, 40)})`);
  // staff API, acting as the account with a fresh 2FA claim (stronger than anything it could obtain)
  await db.query('begin');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] })]);
  await db.query('set local role authenticated');
  const checks = (await tryq(`select is_staff() s, can('wallet','approve') w, can('finance','view') f, can('orders','view') o, can('requests','create') r`)).rows[0] ?? {};
  const rpc = await tryq(`select confirm_bank_transfer(gen_random_uuid(), 100, 'X', null, null, null)`);
  const tables = {};
  for (const t of ['wallet_topups', 'documents', 'orders', 'audit_log', 'suppliers', 'user_roles']) tables[t] = (await tryq(`select count(*)::int n from ${t}`)).rows[0]?.n ?? 'denied';
  await db.query('rollback');
  ok(Object.values(checks).every((x) => x === false), `${tag}: is_staff / can(...) all false`);
  ok(/FORBIDDEN/.test(rpc.err ?? ''), `${tag}: staff RPC refused (${(rpc.err ?? 'ALLOWED').slice(0, 30)})`);
  ok(Object.values(tables).every((n) => n === 0 || n === 'denied'), `${tag}: staff tables return nothing ${JSON.stringify(tables)}`);
}
await db.end();
console.log(failed ? `\nblocked accounts: ${failed} check(s) failed` : '\nblocked accounts: all checks passed');
process.exit(failed ? 1 : 0);
