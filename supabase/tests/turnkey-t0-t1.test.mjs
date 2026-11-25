// Turnkey T0 + T1 DB checks — migrations 224, 225. STAGING ONLY, one rolled-back transaction.
//  T0: old leads kept and frozen (no new rows); legacy catalogue tables are staff-read-only; old lead/signal functions gone.
//  T1: services price list seeded in cents ("From $X"); public reads active services only; catalogue CSV import is for
//      Turnkey editors, previews new / update / invalid without writing, refuses errors and unticked changes, then imports.
// Run: node --env-file=.env.staging supabase/tests/turnkey-t0-t1.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
const as = async (uid, aal = 'aal2', role = 'authenticated') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal } : { role })]);
  await db.query(`set local role ${role}`);
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};

try {
  await db.query('begin');
  const mkUser = async (tag, role = null) => {
    const email = `tk-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `TK ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const admin = await mkUser('admin', 'admin');
  const support = await mkUser('support', 'support');
  const cust = await mkUser('cust');

  // ── T0 ──
  const leadsBefore = Number((await one(`select count(*) n from turnkey_leads`)).n);
  const anyProject = (await one(`select project_id from turnkey_projects limit 1`)).project_id;
  const newLead = await tryq(`insert into turnkey_leads (project_id, kind, company_name, contact_name, email, country) values ($1, 'quote', 'X', 'Y', 'x@test.local', 'TR')`, [anyProject]);
  const leadsAfter = Number((await one(`select count(*) n from turnkey_leads`)).n);
  const fnGone = await one(`select to_regprocedure('public.submit_turnkey_lead(jsonb)') a, to_regprocedure('public.log_turnkey_signal(text,text,text,text)') b, to_regprocedure('public.turnkey_pick_assignee(text)') c`);
  await as(null, 'aal1', 'anon');
  const anonHubs = await all(`select hub_id from turnkey_hubs limit 5`);
  const anonPkgs = await all(`select package_id from turnkey_packages limit 5`);
  const anonProjects = await all(`select project_id from turnkey_projects where status <> 'archived' limit 5`);
  await as(admin);
  const staffHubs = Number((await one(`select count(*) n from turnkey_hubs`)).n);
  await owner();
  const hubTotal = Number((await one(`select count(*) n from turnkey_hubs`)).n);
  ok(/TURNKEY_LEADS_FROZEN/.test(newLead.err ?? '') && leadsAfter === leadsBefore, `T0: old leads are kept (${leadsBefore}) and no new lead can be added`);
  ok(!fnGone.a && !fnGone.b && !fnGone.c, 'T0: the old lead, signal and routing functions are removed');
  ok(anonHubs.length === 0 && anonPkgs.length === 0 && anonProjects.length > 0 && staffHubs === hubTotal,
    'T0: legacy hubs/packages are hidden from the public but readable by Turnkey staff; projects stay public');

  // ── T1 services ──
  const svc = await all(`select code, from_cents::int c, unit, approx from tk_services order by sort`);
  const by = Object.fromEntries(svc.map((s) => [s.code, s]));
  await as(null, 'aal1', 'anon');
  const anonSvc = await all(`select code from tk_services`);
  const anonWrite = await tryq(`insert into tk_services (code, name, from_cents, unit, group_code) values ('x', 'X', 1, 'item', 'core')`);
  await owner();
  ok(svc.length === 11 && by.consultation?.c === 9900 && by.layout_drawing?.c === 29900 && by.sourcing_quotes?.c === 19900 &&
    by.factory_audit?.c === 25000 && by.factory_audit?.approx === true && by.pre_shipment_inspection?.c === 24900 &&
    by.visit_china?.c === 39900 && by.visit_china?.unit === 'day' && by.account_manager?.c === 29900 &&
    by.visa_letter?.c === 4900 && by.car_driver?.c === 10000 && by.airport_pickup?.c === 3900 && by.hotel_help?.c === 0,
    'T1: the 11 services and starting fees from the design are stored in integer cents');
  ok(anonSvc.length === 11 && anonWrite.err, 'T1: the public reads active services and cannot change them');

  // ── T1 catalogue import ──
  const rows = [
    { project_id: 'tk-test-laundry', title: 'TK Test Laundry', category: 'Laundry', summary: 'Self-service laundry', floor_area_m2: '80', from_usd: '35000' },
    { title: 'TK Test Gym', category: 'Fitness', image: 'turnkey/gym.webp' },
    { title: '', category: 'X' },
    { project_id: anyProject, title: 'Changed title for test', category: 'Leisure' },
    { title: 'TK Test Bad', category: 'Food', floor_area_m2: 'big' },
  ];
  await as(support);
  const supImport = await tryq(`select * from tk_import_catalogue($1::jsonb, false, '{}')`, [JSON.stringify(rows)]);
  await as(admin);
  const prev = await all(`select * from tk_import_catalogue($1::jsonb, false, '{}')`, [JSON.stringify(rows)]);
  const countPrev = Number((await one(`select count(*) n from turnkey_projects where project_id like 'tk-test-%'`)).n);
  const applyInvalid = await tryq(`select * from tk_import_catalogue($1::jsonb, true, '{}')`, [JSON.stringify(rows)]);
  const good = rows.filter((_, i) => i !== 2 && i !== 4);
  const applyUnticked = await tryq(`select * from tk_import_catalogue($1::jsonb, true, '{}')`, [JSON.stringify(good)]);
  const applied = await all(`select * from tk_import_catalogue($1::jsonb, true, array[$2])`, [JSON.stringify(good), anyProject]);
  await as(null, 'aal1', 'anon');
  const pub = await all(`select project_id, title, category, floor_area_m2 from turnkey_projects where project_id in ('tk-test-laundry', 'tk-test-gym', $1)`, [anyProject]);
  await owner();
  const actions = prev.map((p) => p.action).join(',');
  ok(/FORBIDDEN/.test(supImport.err ?? ''), 'T1: only Turnkey editors can import the catalogue');
  ok(actions === 'new,new,invalid,update,invalid' && countPrev === 0 && prev[3].changes?.title?.to === 'Changed title for test',
    `T1: preview classifies rows without writing (${actions}) and shows what changes`);
  ok(/IMPORT_INVALID/.test(applyInvalid.err ?? '') && /IMPORT_UNCONFIRMED_CHANGES/.test(applyUnticked.err ?? ''),
    'T1: rows with errors or an unticked change to an existing project refuse the whole import');
  const laundry = pub.find((p) => p.project_id === 'tk-test-laundry');
  ok(applied.length === 3 && laundry?.category === 'Laundry' && Number(laundry?.floor_area_m2) === 80 && pub.some((p) => p.project_id === 'tk-test-gym') &&
    pub.find((p) => p.project_id === anyProject)?.title === 'Changed title for test',
    'T1: a ticked import adds new projects (any category label, optional floor area) and updates the ticked one; the public sees them');

  const auditN = Number((await one(`select count(*) n from audit_log where action = 'turnkey.catalogue_imported'`)).n);
  ok(auditN >= 1, 'T1: the import is audit-logged');
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
  void cust;
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nturnkey-t0-t1: ${failed} check(s) failed` : '\nturnkey-t0-t1: all passed');
process.exitCode = failed ? 1 : 0;
