// Migration 196. STAGING ONLY, one rolled-back transaction, acting as each user through JWT claims (what the REST API
// does with the public key or a signed-in session).
//  · KYC: asking for more information without a message to the customer is refused (KYC_MESSAGE_REQUIRED); with a
//    message it is stored in customer_message (rejecting still needs one too)
//  · dropship_seller_profiles: a customer reads / writes only its own row and only the brand + return fields; any change
//    puts the profile back to 'pending'; another customer sees nothing; the public key nothing; Dropshipping staff and
//    admins read every row and can approve (audit-logged); staff of another division (Make My Brand) cannot; the
//    customer cannot read review_note / reviewed_by
//  · 196 down → up gives identical policies, grants and functions
// Run: node supabase/tests/kyc-dropship-196.test.mjs
import { config } from 'dotenv'; import pg from 'pg'; import fs from 'node:fs';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const { loadStagingEnvOrExit, assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
loadStagingEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid, aal = 'aal2') => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]); await db.query('set local role authenticated'); };
const asAnon = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]); await db.query('set local role anon'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows, n: r.rowCount }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [], n: 0 }; } };
const user = async (email, role, divisions = []) => {
  const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `T ${email}`, email]);
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  for (const [code, r] of divisions) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
  return id;
};
const ADDR = { brand_name: 'T196 · Brand', return_name: 'T196 Returns', return_line1: '1 Test Street', return_city: 'Dubai', return_country: 'AE' };
const insertSql = `insert into dropship_seller_profiles(org_id, brand_name, return_name, return_line1, return_city, return_country) values ($1, $2, $3, $4, $5, $6)`;
const insertArgs = (org, a = ADDR) => [org, a.brand_name, a.return_name, a.return_line1, a.return_city, a.return_country];

try {
  await db.query('begin');
  const orgA = (await one(`insert into organizations(name, country) values ('T196 seller A', 'AE') returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country) values ('T196 seller B', 'DE') returning id`)).id;
  const custA = await user('t196-cust-a@example.com');
  const custB = await user('t196-cust-b@example.com');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, custA, orgB, custB]);
  const ds = await user('t196-ds@example.com', 'operations', [['DS', 'staff']]);
  const mmb = await user('t196-mmb@example.com', 'operations', [['MMB', 'staff']]);
  const adm = await user('t196-admin@example.com', 'admin');
  const kycAdmin = await user('t196-kyc@example.com', 'admin');

  // ── KYC: more_info needs a message to the customer ──
  const kyc = (await one(`insert into kyc_submissions(org_id, status, company_name) values ($1, 'submitted', 'T196') returning id`, [orgA])).id;
  await as(kycAdmin);
  const noMsg = await tryq(`select review_kyc($1, 'more_info', 'internal only', null)`, [kyc]);
  ok(/KYC_MESSAGE_REQUIRED/.test(noMsg.err ?? ''), `KYC: more_info without a message is refused (${(noMsg.err ?? 'ACCEPTED').slice(0, 70)})`);
  const blank = await tryq(`select review_kyc($1, 'more_info', null, '   ')`, [kyc]);
  ok(/KYC_MESSAGE_REQUIRED/.test(blank.err ?? ''), 'KYC: more_info with a blank message is refused');
  const withMsg = await tryq(`select review_kyc($1, 'more_info', 'staff: licence blurry', 'Please upload a clearer copy of your trade licence.')`, [kyc]);
  ok(!withMsg.err, `KYC: more_info with a message works (${(withMsg.err ?? 'ok').slice(0, 70)})`);
  await db.query('reset role');
  const k = await one(`select status, customer_message, internal_note from kyc_submissions where id = $1`, [kyc]);
  ok(k.status === 'more_info' && k.customer_message === 'Please upload a clearer copy of your trade licence.' && k.internal_note === 'staff: licence blurry', 'KYC: message stored in customer_message, note in internal_note');
  await as(kycAdmin);
  ok(/KYC_MESSAGE_REQUIRED/.test((await tryq(`select review_kyc($1, 'rejected', 'x', null)`, [kyc])).err ?? ''), 'KYC: rejecting without a message is still refused');
  ok(!(await tryq(`select review_kyc($1, 'in_review', null, null)`, [kyc])).err, 'KYC: in_review needs no message');

  await db.query('reset role');
  const exists = await one(`select to_regclass('public.dropship_seller_profiles') t`);
  if (!exists.t) throw new Error('table dropship_seller_profiles does not exist — apply migration 196 (pnpm db:migrate:staging)');

  // ── customer A creates its own profile ──
  await as(custA, 'aal1');
  const ins = await tryq(insertSql, insertArgs(orgA));
  ok(!ins.err, `customer: creates own profile (${(ins.err ?? 'ok').slice(0, 70)})`);
  const own = await tryq(`select org_id, brand_name, status, division_id = division_id_of('DS') ds from dropship_seller_profiles`);
  ok(own.rows.length === 1 && own.rows[0].org_id === orgA && own.rows[0].status === 'pending' && own.rows[0].ds, 'customer: reads own row only — pending, Dropshipping division');
  ok(/permission denied/.test((await tryq(`insert into dropship_seller_profiles(org_id, brand_name, return_name, return_line1, return_city, return_country, status) values ($1, 'x', 'x', 'x', 'x', 'AE', 'approved')`, [orgB])).err ?? ''), 'customer: cannot insert a status (column not granted)');
  ok(!!(await tryq(insertSql, insertArgs(orgB))).err, 'customer: cannot create a profile for another company');
  ok(/permission denied/.test((await tryq(`update dropship_seller_profiles set status = 'approved' where org_id = $1`, [orgA])).err ?? ''), 'customer: cannot approve itself (status not writable)');
  ok(/permission denied/.test((await tryq(`select review_note from dropship_seller_profiles`)).err ?? ''), 'customer: review_note refused');
  ok(/permission denied/.test((await tryq(`select reviewed_by from dropship_seller_profiles`)).err ?? ''), 'customer: reviewed_by refused');
  ok(/permission denied/.test((await tryq(`select * from dropship_seller_profiles`)).err ?? ''), 'customer: select * refused (hidden columns)');
  ok(/permission denied/.test((await tryq(`select review_dropship_profile($1, 'approved', null)`, [orgA])).err ?? '') || /FORBIDDEN/.test((await tryq(`select review_dropship_profile($1, 'approved', null)`, [orgA])).err ?? ''), 'customer: cannot call the review RPC');
  ok(/permission denied/.test((await tryq(`delete from dropship_seller_profiles where org_id = $1`, [orgA])).err ?? ''), 'customer: cannot delete');

  // ── another customer / the public key ──
  await as(custB, 'aal1');
  ok((await tryq(`select org_id from dropship_seller_profiles`)).rows.length === 0, 'another customer: sees nothing');
  const upB = await tryq(`update dropship_seller_profiles set brand_name = 'hijack' where org_id = $1`, [orgA]);
  ok(!upB.err && upB.n === 0, 'another customer: cannot change it (0 rows)');
  await asAnon();
  ok(/permission denied/.test((await tryq(`select org_id from dropship_seller_profiles`)).err ?? ''), 'public key: refused');

  // ── staff ──
  await as(mmb);
  ok((await tryq(`select org_id from dropship_seller_profiles where org_id = $1`, [orgA])).rows.length === 0, 'Make My Brand staff: no rows');
  const mmbRev = await tryq(`select review_dropship_profile($1, 'approved', 'x')`, [orgA]);
  ok(/FORBIDDEN/.test(mmbRev.err ?? ''), `Make My Brand staff: cannot approve (${(mmbRev.err ?? 'APPROVED').slice(0, 40)})`);
  await as(ds, 'aal1');
  ok(/FORBIDDEN/.test((await tryq(`select review_dropship_profile($1, 'approved', 'x')`, [orgA])).err ?? ''), 'Dropshipping staff without 2-step sign-in (aal1): cannot approve');
  await as(ds);
  ok((await tryq(`select org_id from dropship_seller_profiles where org_id = $1`, [orgA])).rows.length === 1, 'Dropshipping staff: reads the row');
  ok(/permission denied/.test((await tryq(`update dropship_seller_profiles set status = 'approved' where org_id = $1`, [orgA])).err ?? ''), 'Dropshipping staff: no direct status update (RPC only)');
  const bad = await tryq(`select review_dropship_profile($1, 'pending', null)`, [orgA]);
  ok(/INVALID_STATUS/.test(bad.err ?? ''), 'RPC: only approved / rejected');
  const appr = await tryq(`select review_dropship_profile($1, 'approved', 'staff only: checked the warehouse address')`, [orgA]);
  ok(!appr.err, `Dropshipping staff: approves (${(appr.err ?? 'ok').slice(0, 70)})`);
  await db.query('reset role');
  const p1 = await one(`select status, reviewed_by, reviewed_at, review_note from dropship_seller_profiles where org_id = $1`, [orgA]);
  ok(p1.status === 'approved' && p1.reviewed_by === ds && p1.reviewed_at && p1.review_note === 'staff only: checked the warehouse address', 'approved, reviewer + note stored');
  const audit = await one(`select count(*)::int n, bool_and(division_id = division_id_of('DS')) ds from audit_log where action = 'dropship_profile.review' and entity_id = $1`, [orgA]);
  ok(audit.n === 1 && audit.ds, 'approval written to the audit log (Dropshipping division)');

  // ── customer sees approved, then any change → pending ──
  await as(custA, 'aal1');
  ok((await one(`select status from dropship_seller_profiles where org_id = $1`, [orgA])).status === 'approved', 'customer: sees approved');
  const noop = await tryq(`update dropship_seller_profiles set brand_name = brand_name where org_id = $1`, [orgA]);
  ok(!noop.err && (await one(`select status from dropship_seller_profiles where org_id = $1`, [orgA])).status === 'approved', 'customer: saving without changes keeps the approval');
  for (const [col, val] of [['brand_name', 'T196 · New brand'], ['return_line1', '2 Other Street'], ['return_postal_code', '12345']]) {
    await db.query('reset role'); await db.query(`update dropship_seller_profiles set status = 'approved', reviewed_by = $2, reviewed_at = now() where org_id = $1`, [orgA, ds]);
    await as(custA, 'aal1');
    const u = await tryq(`update dropship_seller_profiles set ${col} = $2 where org_id = $1`, [orgA, val]);
    const s = await one(`select status, reviewed_at from dropship_seller_profiles where org_id = $1`, [orgA]);
    ok(!u.err && s.status === 'pending' && s.reviewed_at === null, `customer changes ${col} → back to pending`);
  }
  ok(/permission denied/.test((await tryq(`update dropship_seller_profiles set org_id = $2 where org_id = $1`, [orgA, orgB])).err ?? ''), 'customer: cannot move the profile to another company');

  // ── admin + reject ──
  await as(adm);
  ok((await tryq(`select org_id from dropship_seller_profiles where org_id = $1`, [orgA])).rows.length === 1, 'admin: reads the row');
  ok(!(await tryq(`select review_dropship_profile($1, 'rejected', 'address is a PO box')`, [orgA])).err, 'admin: can reject');
  await db.query('reset role');
  ok((await one(`select status from dropship_seller_profiles where org_id = $1`, [orgA])).status === 'rejected', 'rejected stored');
  await db.query('rollback');

  // ── 196 down → up identical ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    pol: await all(`select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`),
    tg: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a, md5(p.prosrc) s from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
    trg: await all(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text = 'dropship_seller_profiles' order by 1, 2`),
  });
  const after = await snap();
  const fn195 = await one(`select md5(prosrc) m from pg_proc where proname = 'review_kyc'`);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000196_kyc_more_info_dropship_branding.down.sql', 'utf8'));
  ok(!(await one(`select to_regclass('public.dropship_seller_profiles') t`)).t, 'down: table removed');
  const src = (await one(`select prosrc from pg_proc where proname = 'review_kyc'`)).prosrc;
  const m195 = fs.readFileSync('supabase/migrations/20261101000195_customer_safe_reads.sql', 'utf8').match(/create or replace function review_kyc[\s\S]*?as \$\$([\s\S]*?)\$\$;/)[1];
  ok(src === m195 && src !== undefined && fn195.m !== null, 'down: review_kyc is exactly the 195 version again');
  await db.query(fs.readFileSync('supabase/migrations/20261101000196_kyc_more_info_dropship_branding.sql', 'utf8'));
  const again = await snap();
  if (again !== after) { const a = JSON.parse(after), b = JSON.parse(again); for (const key of Object.keys(a)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) { const sa = new Set(a[key].map((x) => JSON.stringify(x))); console.log('  diff in', key, b[key].filter((x) => !sa.has(JSON.stringify(x))).slice(0, 5)); } }
  ok(again === after, 'up again: identical policies, grants, functions and triggers');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 't196-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nmigration 196: ${failed} check(s) failed` : '\nmigration 196: all passed');
process.exitCode = failed ? 1 : 0;
