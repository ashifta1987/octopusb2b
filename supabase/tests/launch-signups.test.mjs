// Migration 203 (20 Nov 2026): "Notify me when it launches" sign-ups (first feature: dropship).
//  · the public key and a signed-in customer cannot read or write the list
//  · staff with Services view can read it
//  · the service role (server action) inserts; one open sign-up per feature + e-mail; bad e-mail / unknown feature refused
//  · 203 down → up gives identical results
// One transaction, rolled back. STAGING ONLY. Run: node supabase/tests/launch-signups.test.mjs
import pg from 'pg'; import fs from 'node:fs';
import { loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
loadStagingEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const now = Math.floor(Date.now() / 1000);
const claims = (o) => db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(o)]);
const as = async (sub) => { await db.query('reset role'); await claims({ sub, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] }); await db.query('set local role authenticated'); };
const anon = async () => { await db.query('reset role'); await claims({ role: 'anon' }); await db.query('set local role anon'); };
const service = async () => { await db.query('reset role'); await claims({ role: 'service_role' }); await db.query('set local role service_role'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [] }; } };
const user = async (email) => (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
const has203 = !!(await one(`select to_regclass('public.launch_signups') t`)).t;
console.log(has203 ? '(migration 203 applied)' : '(migration 203 NOT applied: the checks are expected to fail)');

async function scenario(tag) {
  const r = {};
  const admin = await user(`t203-admin-${tag}@example.com`), cust = await user(`t203-cust-${tag}@example.com`);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'admin')`, [admin]);
  const org = (await one(`insert into organizations(name, country) values ('T203 ' || $1, 'AE') returning id`, [tag])).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  await service();
  r.insert = (await tryq(`insert into launch_signups(feature, email, source) values ('dropship', 'Buyer.' || $1 || '@example.com', 'home')`, [tag])).err;
  r.dupe = (await tryq(`insert into launch_signups(feature, email) values ('dropship', 'buyer.' || $1 || '@EXAMPLE.com')`, [tag])).err ?? '';
  r.badEmail = (await tryq(`insert into launch_signups(feature, email) values ('dropship', 'not-an-email')`)).err ?? '';
  r.badFeature = (await tryq(`insert into launch_signups(feature, email) values ('teleport', 'x@example.com')`)).err ?? '';
  await anon();
  r.anonRead = await tryq(`select email from launch_signups`);
  r.anonWrite = (await tryq(`insert into launch_signups(feature, email) values ('dropship', 'anon@example.com')`)).err ?? '';
  await as(cust);
  r.custRead = await tryq(`select email from launch_signups`);
  r.custWrite = (await tryq(`insert into launch_signups(feature, email) values ('dropship', 'cust@example.com')`)).err ?? '';
  await as(admin);
  r.staffRead = await tryq(`select feature, email, source from launch_signups where email ilike 'buyer.' || $1 || '@example.com'`, [tag]);
  await db.query('reset role');
  return r;
}

try {
  await db.query('begin');
  const a = await scenario('a');
  ok(a.insert === null, 'the server (service role) can store a sign-up');
  ok(/duplicate|unique/i.test(a.dupe), 'the same e-mail for the same feature is stored once (case-insensitive)');
  ok(/check/i.test(a.badEmail), 'an invalid e-mail is refused');
  ok(/check/i.test(a.badFeature), 'an unknown feature is refused');
  ok(/permission denied/.test(a.anonRead.err ?? '') || a.anonRead.rows.length === 0, 'public key: cannot read the list');
  ok(/permission denied|row-level security/.test(a.anonWrite), 'public key: cannot write directly (only through the rate-limited server action)');
  ok(!a.custRead.err && a.custRead.rows.length === 0, 'signed-in customer: sees no sign-ups');
  ok(/permission denied|row-level security/.test(a.custWrite), 'signed-in customer: cannot write directly');
  ok(!a.staffRead.err && a.staffRead.rows.length === 1 && a.staffRead.rows[0].source === 'home', 'staff (Services view): can read the sign-up');
  await db.query('rollback');

  if (has203) {
    await db.query('begin');
    await db.query(fs.readFileSync('supabase/migrations/down/20261101000203_launch_signups.down.sql', 'utf8'));
    ok(!(await one(`select to_regclass('public.launch_signups') t`)).t, 'down: table removed');
    await db.query(fs.readFileSync('supabase/migrations/20261101000203_launch_signups.sql', 'utf8'));
    const b = await scenario('b');
    const norm = (r) => JSON.stringify({ insert: r.insert, dupe: /unique/.test(r.dupe), badEmail: /check/.test(r.badEmail), badFeature: /check/.test(r.badFeature), anon: r.anonRead.rows.length, anonW: !!r.anonWrite, cust: r.custRead.rows.length, custW: !!r.custWrite, staff: r.staffRead.rows.length });
    ok(norm(a) === norm(b), 'up again: identical results');
    await db.query('rollback');
  } else ok(false, 'down → up (needs migration 203)');
} catch (e) {
  console.error(e); failed++;
  await db.query('rollback').catch(() => {});
} finally { await db.end(); }
console.log(failed ? `\nlaunch sign-ups: ${failed} check(s) failed` : '\nlaunch sign-ups: all passed');
process.exit(failed ? 1 : 0);
