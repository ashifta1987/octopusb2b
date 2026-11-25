// Warehouse OS · W0 DB checks — migration 223. STAGING ONLY, one rolled-back transaction.
//  Locations: Foshan default, SZ-01 legacy, stock references a real warehouse; admin-only add/edit/pause/close; the default
//  can't be paused; a warehouse with stock can't close. Staff: one role per person per warehouse; duplicates refused;
//  only warehouse admins manage people; packers can't approve overrides or counts; suspend needs a reason and removes
//  access; restore. Customers see active locations only and nothing else. Dashboard numbers for staff. Audit + ledger.
// Run: node --env-file=.env.staging supabase/tests/w0-warehouse.test.mjs
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
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};

try {
  await db.query('begin');
  const mkUser = async (tag, role = null) => {
    const email = `w0-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email`, [id, `W0 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return { id, email };
  };
  const admin = await mkUser('admin', 'admin');
  const whAdmin = await mkUser('whadmin', 'warehouse');
  const sup = await mkUser('sup', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  const notStaff = await mkUser('cust');
  const auditBefore = Number((await one(`select count(*) n from audit_log where action like 'warehouse%'`)).n);

  // ── Locations ──
  const fs = await one(`select * from warehouses where code = 'FS-01'`);
  const sz = await one(`select * from warehouses where code = 'SZ-01'`);
  const def = (await one(`select default_warehouse_code() c`)).c;
  const item = (await one(`select id from item_master limit 1`)).id;
  const badStock = await tryq(`select record_warehouse_stock_movement($1, 'inbound', 1, 'W0 test', 'XX-99', null)`, [item]);
  const colDefault = (await one(`select column_default d from information_schema.columns where table_name = 'warehouse_stock' and column_name = 'warehouse_id'`)).d;
  ok(fs?.is_default && fs.status === 'active' && fs.email === 'foshan@octopusb2b.com' && sz?.status === 'legacy' && def === 'FS-01' &&
    /foreign key|WAREHOUSE/i.test(badStock.err ?? '') && /default_warehouse_code/.test(colDefault ?? ''),
    'Foshan FS-01 is the active default; SZ-01 is legacy; stock must point to a real warehouse; new stock defaults to the default warehouse');

  await as(whAdmin.id);
  const nonAdminSave = await tryq(`select wh_save_location('GZ-01', 'Guangzhou', 'Guangdong', 'Guangzhou', null, null, null, null)`);
  await as(admin.id);
  const badCode = await tryq(`select wh_save_location('guangzhou', 'Guangzhou', null, 'Guangzhou', null, null, null, null)`);
  const saved = (await one(`select wh_save_location('GZ-01', 'Guangzhou', 'Guangdong', 'Guangzhou', 'Baiyun district', 'gz@octopusb2b.com', null, '08:00–18:00') c`)).c;
  const pauseDefault = await tryq(`select wh_set_location_status('FS-01', 'paused', 'test')`);
  const pauseNoReason = await tryq(`select wh_set_location_status('GZ-01', 'paused', '')`);
  await owner();
  await db.query(`select record_warehouse_stock_movement($1, 'inbound', 3, 'W0 test stock', 'GZ-01', null)`, [item]);
  await as(admin.id);
  const closeWithStock = await tryq(`select wh_set_location_status('GZ-01', 'closed', 'moving')`);
  await db.query(`select wh_set_location_status('GZ-01', 'paused', 'Peak season over')`);
  const pausedDefault = await tryq(`select wh_set_default('GZ-01')`);
  await db.query(`select wh_set_location_status('GZ-01', 'active', null)`);
  await db.query(`select wh_set_default('GZ-01')`);
  const defNow = (await one(`select default_warehouse_code() c`)).c;
  await db.query(`select wh_set_default('FS-01')`);
  await owner();
  ok(/FORBIDDEN/.test(nonAdminSave.err ?? '') && /INVALID_CODE/.test(badCode.err ?? '') && saved === 'GZ-01' &&
    /DEFAULT_WAREHOUSE/.test(pauseDefault.err ?? '') && /REASON_REQUIRED/.test(pauseNoReason.err ?? '') &&
    /WAREHOUSE_HAS_STOCK/.test(closeWithStock.err ?? '') && /WAREHOUSE_NOT_ACTIVE/.test(pausedDefault.err ?? '') && defNow === 'GZ-01',
    'only admins manage locations; the code format is checked; the default can’t pause; pausing needs a reason; a warehouse with stock can’t close; only an active warehouse can be the default');

  // ── Staff per warehouse ──
  await as(admin.id);
  await db.query(`select wh_add_staff($1, 'FS-01', 'admin')`, [whAdmin.email]);
  await as(whAdmin.id);
  const whAdminMakesAdmin = await tryq(`select wh_add_staff($1, 'FS-01', 'admin')`, [sup.email]);
  await db.query(`select wh_add_staff($1, 'FS-01', 'supervisor')`, [sup.email]);
  await db.query(`select wh_add_staff($1, 'FS-01', 'packer')`, [packer.email]);
  const dup = await tryq(`select wh_add_staff($1, 'FS-01', 'receiver')`, [packer.email]);
  const notStaffAdd = await tryq(`select wh_add_staff($1, 'FS-01', 'packer')`, [notStaff.email]);
  const otherWh = await tryq(`select wh_add_staff($1, 'GZ-01', 'packer')`, [packer.email]);
  await as(admin.id);
  await db.query(`select wh_add_staff($1, 'GZ-01', 'supervisor')`, [packer.email]);
  await as(sup.id);
  const supAdds = await tryq(`select wh_add_staff($1, 'FS-01', 'packer')`, [admin.email]);
  await as(packer.id);
  const pk = await one(`select wh_can('pack', 'FS-01') pack, wh_can('approve_override', 'FS-01') ovr, wh_can('approve_count', 'FS-01') cnt, wh_can('approve_override', 'GZ-01') gz_ovr`);
  const myWh = await all(`select code, role from wh_my_warehouses()`);
  await owner();
  ok(/FORBIDDEN/.test(whAdminMakesAdmin.err ?? '') && /ALREADY_ADDED/.test(dup.err ?? '') && /NOT_STAFF/.test(notStaffAdd.err ?? '') &&
    /FORBIDDEN/.test(otherWh.err ?? '') && /FORBIDDEN/.test(supAdds.err ?? ''),
    'a person is added once per warehouse; only staff accounts; a warehouse admin manages only their warehouse and can’t create admins; supervisors can’t add people');
  ok(pk.pack === true && pk.ovr === false && pk.cnt === false && pk.gz_ovr === true &&
    myWh.find((w) => w.code === 'FS-01')?.role === 'packer' && myWh.find((w) => w.code === 'GZ-01')?.role === 'supervisor',
    'roles are per warehouse: packer at Foshan (can pack, can’t approve overrides or counts), supervisor at Guangzhou (can approve)');

  await as(whAdmin.id);
  const selfSuspend = await tryq(`select wh_suspend_staff($1, 'FS-01', 'x')`, [whAdmin.id]);
  const noReason = await tryq(`select wh_suspend_staff($1, 'FS-01', ' ')`, [packer.id]);
  await db.query(`select wh_suspend_staff($1, 'FS-01', 'On leave')`, [packer.id]);
  await as(packer.id);
  const suspendedCan = (await one(`select wh_can('pack', 'FS-01') v, wh_can('approve_override', 'GZ-01') g`));
  await as(whAdmin.id);
  await db.query(`select wh_restore_staff($1, 'FS-01')`, [packer.id]);
  await db.query(`select wh_set_staff_role($1, 'FS-01', 'receiver')`, [packer.id]);
  await as(packer.id);
  const afterRestore = (await one(`select wh_can('receive', 'FS-01') r, wh_can('pack', 'FS-01') p`));
  await owner();
  ok(/cannot suspend yourself/.test(selfSuspend.err ?? '') && /REASON_REQUIRED/.test(noReason.err ?? '') &&
    suspendedCan.v === false && suspendedCan.g === true && afterRestore.r === true && afterRestore.p === false,
    'suspending needs a reason (not yourself) and removes access at that warehouse only; restore and role change work');

  // ── Customers / dashboard ──
  await as(notStaff.id, 'aal1');
  const custWh = await all(`select code, status from warehouses`);
  const custStaff = await all(`select user_id from warehouse_staff`);
  const custDash = await tryq(`select wh_dashboard(null) d`);
  await as(sup.id);
  const dash = (await one(`select wh_dashboard('FS-01') d`)).d;
  await owner();
  const svcInactive = await tryq(`select receive_sourcing_handoff_at_3pl(gen_random_uuid(), 'SZ-01')`);
  ok(custWh.every((w) => w.status === 'active') && !custWh.some((w) => w.code === 'SZ-01') && custStaff.length === 0 && /FORBIDDEN/.test(custDash.err ?? ''),
    'customers see active warehouses only, no staff rows, no dashboard');
  ok(dash && typeof dash.units_on_hand === 'number' && typeof dash.outbox?.dead === 'number' && /WAREHOUSE_NOT_ACTIVE/.test(svcInactive.err ?? ''),
    'staff dashboard returns real counts; handoffs can’t be received at a legacy warehouse');

  const auditAfter = Number((await one(`select count(*) n from audit_log where action like 'warehouse%'`)).n);
  ok(auditAfter - auditBefore >= 12, `every change is audit-logged (+${auditAfter - auditBefore})`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nw0-warehouse: ${failed} check(s) failed` : '\nw0-warehouse: all passed');
process.exitCode = failed ? 1 : 0;
