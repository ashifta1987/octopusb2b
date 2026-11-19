// Divisions step 4 (migration 197). STAGING ONLY, one rolled-back transaction, acting as each user via JWT claims.
//  · Company legal details: Admin only (a content editor can still edit the public site fields); changes are audited
//  · Divisions: Admin edits name / order / logo / active; at least one stays active; non-admins cannot edit
//  · Division members: a staff person can be added to several divisions; customers never; needs staff:edit + fresh 2FA
//  · 197 down → up identical
// Run: node supabase/tests/division-admin.test.mjs
import pg from 'pg'; import fs from 'node:fs';
import { loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
loadStagingEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
// amr with a fresh totp entry = mfa_fresh()
const as = async (uid) => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]); await db.query('set local role authenticated'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, n: r.rowCount, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, n: 0, rows: [] }; } };
const user = async (email, role) => {
  const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `T ${email}`, email]);
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  return id;
};
try {
  await db.query('begin');
  const adm = await user('da-admin@example.com', 'admin');
  const editor = await user('da-editor@example.com', 'content_editor');
  const ops = await user('da-ops@example.com', 'operations');
  const qc = await user('da-qc@example.com', 'qc_coordinator');
  const cust = await user('da-cust@example.com');
  const org = (await one(`insert into organizations(name, country) values ('DA test buyer', 'AE') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  const before = await one(`select legal_name, registration_no, tagline from company_profile where id = 1`);

  // ── company ──
  await as(editor);
  const e1 = await tryq(`update company_profile set legal_name = 'Hacked Ltd' where id = 1`);
  ok(/COMPANY_LEGAL_ADMIN_ONLY/.test(e1.err ?? ''), 'content editor: cannot change the legal name');
  const e2 = await tryq(`update company_profile set tagline = tagline where id = 1`);
  ok(!e2.err && e2.n === 1, 'content editor: can still save the public site fields');
  await as(adm);
  const a1 = await tryq(`update company_profile set registration_no = 'TEST-REG-123' where id = 1`);
  ok(!a1.err && a1.n === 1, 'admin: can set the registration number');
  await db.query('reset role');
  ok(Number((await one(`select count(*) n from audit_log where entity = 'company_profile' and actor_id = $1 and details->'new'->>'registration_no' = 'TEST-REG-123'`, [adm])).n) === 1, 'the change is in the audit log (who, before, after)');

  // ── divisions ──
  await as(ops);
  ok((await tryq(`update divisions set name = 'X' where code = 'DS'`)).n === 0, 'operations: cannot rename a division');
  await as(adm);
  ok((await tryq(`update divisions set name = 'Dropshipping (test)', sort_order = 7, logo_key = 'octopus-b2b' where code = 'DS'`)).n === 1, 'admin: renames / reorders / changes the logo');
  ok(/check constraint|logo_key/.test((await tryq(`update divisions set logo_key = 'made-up' where code = 'DS'`)).err ?? ''), 'admin: only the approved logos (no redraw / recolour)');
  await db.query('savepoint allinactive');
  await db.query(`update divisions set status = 'inactive'`);
  const last = await tryq(`set constraints all immediate`);
  ok(/DIVISION_LAST_ACTIVE/.test(last.err ?? ''), 'at least one division must stay active');
  await db.query('rollback to savepoint allinactive');

  // ── division members ──
  await as(adm);
  for (const [code, role] of [['SRC', 'manager'], ['MMB', 'staff'], ['TK', 'staff']]) {
    const r = await tryq(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [qc, code, role]);
    ok(!r.err, `admin: QC coordinator added to ${code} as ${role}${r.err ? ' — ' + r.err : ''}`);
  }
  ok(Number((await one(`select count(*) n from division_members where user_id = $1`, [qc])).n) === 3, 'one person in three divisions');
  ok((await one(`select created_by from division_members where user_id = $1 limit 1`, [qc])).created_by === adm, 'who added them is recorded');
  ok(/DIVISION_MEMBER_NOT_STAFF/.test((await tryq(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('DS'), 'staff')`, [cust])).err ?? ''), 'a customer account can never be added to a division');
  ok((await tryq(`update division_members set role = 'staff' where user_id = $1 and division_id = division_id_of('SRC')`, [qc])).n === 1, 'admin: changes the role in one division');
  ok((await tryq(`delete from division_members where user_id = $1 and division_id = division_id_of('TK')`, [qc])).n === 1, 'admin: removes one division, the others stay');
  await as(ops);
  ok(/row-level security|permission/.test((await tryq(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('DS'), 'staff')`, [ops])).err ?? 'no error'), 'operations: cannot add anyone (or themselves) to a division');
  // stale 2FA: the write policy needs a fresh code
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adm, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 7200 }] })]);
  await db.query('set local role authenticated');
  const stale = await tryq(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('DS'), 'staff')`, [qc]);
  ok(!!stale.err || stale.n === 0, 'admin with a 2-hour-old 2FA code: refused (fresh code needed)');
  await db.query('reset role');
  await db.query('rollback');
  const after = await one(`select legal_name, registration_no, tagline from company_profile where id = 1`);
  ok(JSON.stringify(after) === JSON.stringify(before), 'company record unchanged after the rollback (registration no. still empty)');

  // ── down → up identical ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    tg: await all(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger where not tgisinternal and tgrelid in ('company_profile'::regclass, 'divisions'::regclass, 'division_members'::regclass) order by 1, 2`),
    fn: await all(`select p.oid::regprocedure::text f, md5(p.prosrc) s, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  });
  const up = await snap();
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000197_division_admin.down.sql', 'utf8'));
  ok(!(await snap()).includes('company_legal_guard'), 'down: guards removed');
  await db.query(fs.readFileSync('supabase/migrations/20261101000197_division_admin.sql', 'utf8'));
  ok((await snap()) === up, 'up again: identical');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'da-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\ndivision admin: ${failed} check(s) failed` : '\ndivision admin: all passed');
process.exitCode = failed ? 1 : 0;
