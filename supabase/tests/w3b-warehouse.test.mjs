// Warehouse OS · W3b DB checks — scale benches (calibration, lock / unlock), packaging materials (stock, ledger, charged by use),
// multi-parcel packing, exceptions queue (auto-raised, assign, resolve + release, permissions), audit, ledgers, demo wipe.
// STAGING ONLY, rolled-back transactions.
//  0. Down → up → down → up: the W3b down removes every W3b object and changes nothing else (no W0–W3a function, wipe_demo_data
//     included, is replaced); up again gives identical functions, grants, policies, columns, constraints, indexes and triggers;
//     the second down gives the same schema as the first (empty up → down diff).
//  1. Setup: two client SKUs (one with a battery), a notice received through the real W2a path, staff per role at FS-01. Benches
//     and materials that already exist at FS-01 are set aside inside the rolled-back transaction.
//  2. Scale benches: supervisors manage; a new bench is locked; pass → ok; fail → locked; after a fail only a supervisor's passing
//     check unlocks (CHECK constraint: no other way); settings change relocks; a due check blocks weighing; receivers can't check.
//  3. W3a single parcel still works, now with a bench (BENCH_REQUIRED / BENCH_LOCKED) and materials: the box and the battery mark
//     are taken from stock at close, tape used by hand (void → back to stock); parcel 1 recorded; usage carries the client and
//     the unit charge (NULL when no price is set); prices only by a warehouse admin; receiving materials needs the receive role.
//  4. Multi-parcel: converting a started order, W3a functions refused on it, scans per parcel, per-parcel weight + bench, photos,
//     two-person PIN override with 3-strike lock (→ weight exception, admin unlocks from the queue), battery mark per parcel,
//     reopen (box back to stock), remove empty parcel, order close needs every unit in a closed parcel; order totals.
//  5. Exceptions: short pick raised automatically, assign, resolution required, release returns the order to the right step;
//     release from the order page resolves too; blocked lot → receiving exception → approve from the queue; manual exceptions;
//     order-level override lock → weight exception → admin unlock on the order page resolves it; customers see nothing.
//  6. Audit rows, material ledger balanced (on hand = sum of moves, balance chain), stock ledger balanced; the staging demo wipe
//     removes the demo company's W3b rows (cascade) and keeps every material move.
// Run: node --env-file=.env.staging supabase/tests/w3b-warehouse.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import crypto from 'node:crypto';
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
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w3b_scale_materials_parcels_exceptions(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));
const W3B_TABLES = ['wh_scale_benches', 'wh_scale_checks', 'wh_materials', 'wh_material_moves', 'wh_parcels', 'wh_parcel_items', 'wh_material_usage', 'wh_exceptions'];
const W3B_FNS = ['wh_bench_assert', 'wh_material_post', 'wh_material_use', 'wh_material_void_internal', 'wh_use_pack_materials', 'wh_parcel_recalc',
  'wh_orders_w3b_guard', 'wh_order_lines_w3b_guard', 'wh_pack_evidence_w3b_guard', 'wh_orders_w3b_single_parcel', 'wh_exceptions_resolve_where',
  'wh_exception_open', 'wh_orders_w3b_exceptions', 'wh_parcels_w3b_exceptions', 'wh_lots_w3b_exceptions', 'wh_save_bench', 'wh_scale_check',
  'wh_pack_weigh_on', 'wh_scale_board', 'wh_save_material', 'wh_set_material_charge', 'wh_material_receive', 'wh_material_count', 'wh_pack_use_material',
  'wh_pack_void_material', 'wh_materials_board', 'wh_pack_extras', 'wh_parcel_order_check', 'wh_parcel_add', 'wh_parcel_open_check', 'wh_parcel_scan',
  'wh_parcel_unscan', 'wh_parcel_set_box', 'wh_parcel_weigh', 'wh_parcel_override', 'wh_parcel_unlock_override', 'wh_parcel_add_evidence',
  'wh_parcel_close', 'wh_parcel_reopen', 'wh_parcel_remove', 'wh_parcels_close_order', 'wh_multi_parcel', 'wh_multi_parcel_queue', 'wh_exception_held',
  'wh_exception_actions', 'wh_exception_raise', 'wh_exception_assign', 'wh_exception_resolve', 'wh_exceptions_board'];
const W3B_COLS = [['wh_orders', 'weighed_bench_id'], ['wh_pack_evidence', 'parcel_id'], ['wh_scan_log', 'parcel_id'], ['wh_override_attempts', 'parcel_id']];

try {
  // ── 0. down → up → down → up ──
  await db.query('begin');
  const snap = async () => ({
    fn: await all(`select p.oid::regprocedure::text f, p.proname n, p.proacl::text a, md5(p.prosrc) s, pg_get_function_arguments(p.oid) args, p.prosecdef d, p.proconfig::text c
                     from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like 'wh\\_%' or p.proname in ('record_warehouse_stock_movement', 'wipe_demo_data', 'write_audit')) order by 1`),
    pol: await all(`select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
                     where (schemaname = 'public' and tablename like 'wh\\_%') or (schemaname = 'storage' and policyname like 'wh %') order by 1, 2, 3`),
    tg: await all(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger
                    where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and (relname like 'wh\\_%' or relname like 'warehouse\\_stock%')) order by 1, 2`),
    tp: await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
                    where table_schema = 'public' and (table_name like 'wh\\_%' or table_name like 'warehouse\\_stock%') and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and table_name like 'wh\\_%' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    col: await all(`select table_name, column_name, column_default, is_nullable, data_type from information_schema.columns
                     where table_schema = 'public' and (table_name like 'wh\\_%' or table_name like 'warehouse\\_stock%') order by 1, 2`),
    con: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
                     where connamespace = 'public'::regnamespace and (conrelid::regclass::text like 'wh\\_%' or conrelid::regclass::text like 'warehouse\\_stock%') order by 1, 2`),
    idx: await all(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and (tablename like 'wh\\_%' or tablename like 'warehouse\\_stock%') order by 1, 2`),
    seq: await all(`select sequencename from pg_sequences where schemaname = 'public' and sequencename like 'seq\\_wh\\_%' order by 1`),
    rls: await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'wh\\_%' order by 1`),
  });
  const S = (x) => JSON.stringify(x);
  const diff = (a, b) => { for (const k of Object.keys(a)) if (S(a[k]) !== S(b[k])) console.log('  diff in', k); };
  const upFile = mig('supabase/migrations');
  const downFile = mig('supabase/migrations/down');
  ok(Boolean(upFile && downFile), `W3b migration files found (${upFile} / ${downFile})`);
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, upFile);
  await unwind(db, later);
  const withW3b = await snap();
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without = await snap();
  const leftT = without.rls.filter((r) => W3B_TABLES.includes(r.relname));
  const leftF = without.fn.filter((r) => W3B_FNS.includes(r.n));
  const leftC = without.col.filter((c) => W3B_COLS.some(([t, n]) => c.table_name === t && c.column_name === n));
  const leftTg = without.tg.filter((t) => /w3b/.test(t.tgname));
  const keptFns = withW3b.fn.filter((r) => !W3B_FNS.includes(r.n));
  ok(leftT.length === 0 && leftF.length === 0 && leftC.length === 0 && leftTg.length === 0 && !without.seq.some((s) => s.sequencename === 'seq_wh_exception'),
    'down: every W3b table, function, trigger, column and the EX sequence are gone');
  ok(S(keptFns) === S(without.fn), `down: every other warehouse function is byte-identical (wipe_demo_data, record_warehouse_stock_movement and all W0–W3a wh_* functions — ${keptFns.length})`);
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  const again = await snap();
  if (S(again) !== S(withW3b)) diff(withW3b, again);
  ok(S(again) === S(withW3b), 'up again: identical functions, grants, policies, columns, constraints, indexes, triggers, RLS');
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without2 = await snap();
  if (S(without2) !== S(without)) diff(without, without2);
  ok(S(without2) === S(without), 'down again: the same schema as the first down (up → down leaves no difference)');
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  await reapply(db, later);
  const rlsAll = withW3b.rls.filter((r) => W3B_TABLES.includes(r.relname));
  const writeGrants = withW3b.tp.filter((g) => W3B_TABLES.includes(g.table_name) && ['anon', 'authenticated'].includes(g.grantee) && g.privilege_type !== 'SELECT');
  const anonAny = withW3b.tp.filter((g) => W3B_TABLES.includes(g.table_name) && g.grantee === 'anon');
  const pubFns = withW3b.fn.filter((f) => W3B_FNS.includes(f.n) && (/(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? '')));
  const notDefiner = withW3b.fn.filter((f) => W3B_FNS.includes(f.n) && (!f.d || !/search_path=public/.test(f.c ?? '')));
  const internal = ['wh_bench_assert', 'wh_material_post', 'wh_material_use', 'wh_material_void_internal', 'wh_use_pack_materials', 'wh_parcel_recalc',
    'wh_exceptions_resolve_where', 'wh_exception_open', 'wh_parcel_order_check', 'wh_parcel_open_check', 'wh_exception_held', 'wh_exception_actions'];
  const internalOpen = withW3b.fn.filter((f) => internal.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  ok(rlsAll.length === W3B_TABLES.length && rlsAll.every((r) => r.relrowsecurity) && writeGrants.length === 0 && anonAny.length === 0,
    'RLS on every W3b table; authenticated may only SELECT (through wh_sees policies); anon has nothing');
  ok(pubFns.length === 0 && notDefiner.length === 0 && internalOpen.length === 0,
    `every W3b function is security definer with search_path=public, not executable by public/anon; internal helpers not even by authenticated${notDefiner.length ? ' — ' + notDefiner.map((f) => f.n).join(',') : ''}`);
  await db.query('rollback');

  await db.query('begin');
  // ── 1. setup ──
  const mkUser = async (tag, role = null) => {
    const e = `w3b-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`, [id, `W3b ${tag}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const whAdmin = await mkUser('whadmin', 'warehouse');
  const sup = await mkUser('sup', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  const recv = await mkUser('recv', 'warehouse');
  const recv2 = await mkUser('recv2', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin'), ($2, 'FS-01', 'supervisor'), ($3, 'FS-01', 'packer'),
    ($4, 'FS-01', 'receiver'), ($5, 'FS-01', 'receiver')`, [whAdmin, sup, packer, recv, recv2]);
  const orgA = (await one(`insert into organizations(name, country, is_seed) values ('W3b Client A', 'AE', true) returning id`)).id;
  const custA = await mkUser('custa');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [orgA, custA]);
  await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01')`, [orgA]);
  // whatever FS-01 already has is set aside inside this rolled-back transaction, so the checks start clean
  await db.query(`update wh_scale_benches set active = false where warehouse_code = 'FS-01'`);
  await db.query(`update wh_materials set active = false where warehouse_code = 'FS-01'`);
  const st = await one(`select tolerance_g g, tolerance_pct p from wh_settings_for('FS-01')`);
  const tol = (e) => Math.max(st.g, Math.ceil((e * Number(st.p)) / 100));
  const tag = String(Math.floor(Math.random() * 900) + 100);
  await as(custA, 'aal1');
  const sLamp = (await one(`select wh_save_client_sku($1, null, 'W3B-LAMP', 'Desk lamp', 'W3B4711', 450, false, false) id`, [orgA])).id;
  const sHub = (await one(`select wh_save_client_sku($1, null, 'W3B-HUB', 'Power bank', null, 120, true, false) id`, [orgA])).id;
  await owner();
  const item = async (s) => (await one(`select item_id from wh_client_skus where id = $1`, [s])).item_id;
  const [iLamp, iHub] = [await item(sLamp), await item(sHub)];
  const LAMP = { item: iLamp, sku: 'W3B-LAMP', barcode: 'W3B4711', name: 'Desk lamp', w: 450 };
  const HUB = { item: iHub, sku: 'W3B-HUB', barcode: null, name: 'Power bank', w: 120 };
  // orders straight at the step under test (packing needs no stock movement; nothing is reserved or picked here)
  const mkOrder = async (status, lines) => {
    const o = await one(`insert into wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_address, ship_country, status, picked_at)
      values ('FS-01', 'client_portal', $1, $2, 'W3b Test', '{"line1": "Main 1", "city": "Berlin"}'::jsonb, 'DE', $3, $4) returning id, code`,
    [orgA, `W3B-${tag}-${crypto.randomUUID().slice(0, 6)}`, status, status === 'picked' ? new Date() : null]);
    for (const l of lines) {
      await db.query(`insert into wh_order_lines (order_id, item_id, sku, barcode, name, qty, picked_qty, unit_weight_g) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [o.id, l.item, l.sku, l.barcode, l.name, l.qty, l.picked, l.w]);
    }
    await db.query(`select wh_refresh_dg($1)`, [o.id]);
    return o;
  };
  const ord = async (id) => one(`select * from wh_orders where id = $1`, [id]);
  const mat = async (id) => one(`select * from wh_materials where id = $1`, [id]);
  const path = (o, k) => `FS-01/${o.code}/${k}-${crypto.randomUUID()}.jpg`;
  const upload = async (o) => {
    const ps = { contents: path(o, 'contents'), sealed: path(o, 'sealed'), scale: path(o, 'scale') };
    await owner();
    for (const p of Object.values(ps)) await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-evidence', $1, $2)`, [p, packer]);
    return ps;
  };
  ok(Boolean(iLamp && iHub), 'setup: client SKUs (lamp 450 g; power bank 120 g with a battery) and staff per role at FS-01');

  // ── 2. scale benches ──
  await as(packer);
  const packerBench = await tryq(`select wh_save_bench('FS-01', null, $1, 'Packing bench', 30000, 2, null, true)`, [`BN${tag}`]);
  await as(sup);
  const B1 = (await one(`select wh_save_bench('FS-01', null, $1, 'Packing bench 1', 30000, 2, null, true) id`, [`BN${tag}`])).id;
  const B2 = (await one(`select wh_save_bench('FS-01', null, $1, 'Packing bench 2', 30000, 2, null, true) id`, [`BM${tag}`])).id;
  const dupBench = await tryq(`select wh_save_bench('FS-01', null, $1, 'x', null, 2, null, true)`, [`BN${tag}`]);
  await owner();
  const b1new = await one(`select * from wh_scale_benches where id = $1`, [B1]);
  ok(/FORBIDDEN/.test(packerBench.err ?? '') && /DUPLICATE_BENCH/.test(dupBench.err ?? '') && b1new.status === 'locked' && /Not checked yet/.test(b1new.locked_reason),
    'benches: only supervisors / admins manage them; codes are unique per warehouse; a new bench starts locked ("Not checked yet")');
  await as(packer);
  const c1 = (await one(`select wh_scale_check($1, 1000, 1001, null) r`, [B1])).r;
  const c2 = (await one(`select wh_scale_check($1, 1000, 1010, 'reads heavy') r`, [B1])).r;
  const failedRow = await one(`select status, locked_reason, last_check_ok from wh_scale_benches where id = $1`, [B1]);
  const packerUnlock = await tryq(`select wh_scale_check($1, 1000, 1000, null)`, [B1]);
  await as(recv);
  const recvCheck = await tryq(`select wh_scale_check($1, 1000, 1000, null)`, [B1]);
  await owner();
  const sneak = await tryq(`update wh_scale_benches set status = 'ok', locked_reason = null where id = $1`, [B1]);
  await as(sup);
  const c3 = (await one(`select wh_scale_check($1, 1000, 999, 'cleaned the plate') r`, [B1])).r;
  await owner();
  ok(c1.passed === true && c1.status === 'ok' && c2.passed === false && c2.status === 'locked' && failedRow.status === 'locked' && /Failed check: read 1010 g on a 1000 g reference/.test(failedRow.locked_reason)
    && failedRow.last_check_ok === false && /SUPERVISOR_CHECK_REQUIRED/.test(packerUnlock.err ?? '') && /FORBIDDEN/.test(recvCheck.err ?? '')
    && /wh_scale_benches_ok_after_pass/.test(sneak.err ?? '') && c3.passed === true && c3.status === 'ok',
    'calibration: pass → ok; fail → locked with the reading; after a fail a packer\'s pass is refused, only a supervisor\'s passing check unlocks; receivers can\'t check; the table itself refuses "ok" without a pass');
  await as(sup);
  await db.query(`select wh_save_bench('FS-01', $1, $2, 'Packing bench 1', 30000, 3, 1, true)`, [B1, `BN${tag}`]);
  const relocked = await one(`select status, locked_reason from wh_scale_benches where id = $1`, [B1]);
  await as(packer);
  await db.query(`select wh_scale_check($1, 2000, 2002, null)`, [B1]);
  await owner();
  const checks = Number((await one(`select count(*) n from wh_scale_checks where bench_id = $1`, [B1])).n);
  ok(relocked.status === 'locked' && /settings changed/.test(relocked.locked_reason) && (await one(`select status from wh_scale_benches where id = $1`, [B1])).status === 'ok' && checks === 4,
    'changing the check tolerance / interval relocks the bench until it passes again (after a pass, a packer may run it); every read is kept');

  // ── 3. W3a single parcel with bench + materials ──
  await as(sup);
  const box = (await one(`select wh_save_box('FS-01', null, $1, 'W3b carton', 300, 200, 100, 100, true) id`, [`BX${tag}`])).id;
  const mBox = (await one(`select wh_save_material('FS-01', null, $1, 'W3b carton (stock)', 'box', 'each', $2, 3, false, true) id`, [`MB${tag}`, box])).id;
  const mTape = (await one(`select wh_save_material('FS-01', null, $1, 'Tape 48 mm', 'tape', 'roll', null, null, false, true) id`, [`MT${tag}`])).id;
  const mMark = (await one(`select wh_save_material('FS-01', null, $1, 'Lithium battery mark', 'mark', 'each', null, null, true, true) id`, [`MK${tag}`])).id;
  const twoMarks = await tryq(`select wh_save_material('FS-01', null, $1, 'Second mark', 'mark', 'each', null, null, true, true)`, [`MX${tag}`]);
  const boxTwice = await tryq(`select wh_save_material('FS-01', null, $1, 'Again', 'box', 'each', $2, null, false, true)`, [`MY${tag}`, box]);
  const supPrice = await tryq(`select wh_set_material_charge($1, 35)`, [mBox]);
  const supReceive = (await one(`select wh_material_receive($1, 5, 'Delivery 1') r`, [mBox])).r;
  await as(packer);
  const packerMat = await tryq(`select wh_save_material('FS-01', null, 'MZ1', 'x', 'other', 'each', null, null, false, true)`);
  const packerReceive = await tryq(`select wh_material_receive($1, 5, null)`, [mBox]);
  await as(recv);
  await db.query(`select wh_material_receive($1, 2, null)`, [mMark]);
  await as(whAdmin);
  await db.query(`select wh_set_material_charge($1, 35)`, [mBox]);
  const badPrice = await tryq(`select wh_set_material_charge($1, -1)`, [mBox]);
  await owner();
  ok(/DG_MARK_EXISTS/.test(twoMarks.err ?? '') && /BOX_ALREADY_STOCKED/.test(boxTwice.err ?? '') && /FORBIDDEN/.test(supPrice.err ?? '') && /FORBIDDEN/.test(packerMat.err ?? '')
    && /FORBIDDEN/.test(packerReceive.err ?? '') && supReceive.on_hand === 5 && (await mat(mMark)).on_hand === 2 && (await mat(mBox)).charge_per_unit_cents === '35'
    && (await mat(mTape)).charge_per_unit_cents === null && /INVALID_PRICE/.test(badPrice.err ?? ''),
    'materials: supervisors set them up (one stocked material per box, one automatic battery mark); receivers / supervisors receive, packers can\'t; only a warehouse admin sets a price; no price = NULL (never 0)');

  const oS = await mkOrder('picked', [{ ...LAMP, qty: 1, picked: 1 }, { ...HUB, qty: 1, picked: 1 }]);
  await as(packer);
  for (const c of ['W3B4711', 'W3B-HUB']) await db.query(`select wh_pack_scan($1, $2)`, [oS.id, c]);
  const bxS = (await one(`select wh_pack_set_box($1, $2) r`, [oS.id, box])).r;
  const noBench = await tryq(`select wh_pack_weigh($1, 670)`, [oS.id]);
  const lockedBench = await tryq(`select wh_pack_weigh_on($1, $2, 670)`, [oS.id, B2]);
  await owner();
  // the check every hour is overdue (both timestamps moved back together — the table only allows "ok" right after a pass)
  await db.query(`update wh_scale_benches set last_check_at = now() - interval '2 hours', last_pass_at = now() - interval '2 hours' where id = $1`, [B1]);
  await as(packer);
  const dueBench = await tryq(`select wh_pack_weigh_on($1, $2, 670)`, [oS.id, B1]);
  await db.query(`select wh_scale_check($1, 1000, 1000, 'hourly check')`, [B1]);
  const wS = (await one(`select wh_pack_weigh_on($1, $2, 670) r`, [oS.id, B1])).r;
  const tapeShort = await tryq(`select wh_pack_use_material($1, null, $2, 2)`, [oS.id, mTape]);
  await as(recv);
  await db.query(`select wh_material_receive($1, 10, null)`, [mTape]);
  await as(packer);
  const use1 = (await one(`select wh_pack_use_material($1, null, $2, 2) r`, [oS.id, mTape])).r;
  const voidNoReason = await tryq(`select wh_pack_void_material($1, '')`, [use1.usage_id]);
  await db.query(`select wh_pack_void_material($1, 'Used less tape')`, [use1.usage_id]);
  await db.query(`select wh_pack_use_material($1, null, $2, 1)`, [oS.id, mTape]);
  const phS = await upload(oS);
  await as(packer);
  for (const k of ['contents', 'sealed', 'scale']) await db.query(`select wh_add_evidence($1, $2, $3)`, [oS.id, k, phS[k]]);
  const closedS = (await one(`select wh_pack_close($1, true) r`, [oS.id])).r;
  await owner();
  const oSrow = await ord(oS.id);
  const p1S = await one(`select * from wh_parcels where order_id = $1`, [oS.id]);
  const p1Items = await all(`select l.sku, i.qty from wh_parcel_items i join wh_order_lines l on l.id = i.line_id where i.parcel_id = $1 order by l.sku`, [p1S?.id]);
  const evLinked = Number((await one(`select count(*) n from wh_pack_evidence where order_id = $1 and parcel_id = $2`, [oS.id, p1S?.id])).n);
  const usageS = await all(`select m.code, u.qty, u.source, u.org_id, u.unit_charge_cents::int c, u.charge_cents::int t, u.voided_at is not null v
                              from wh_material_usage u join wh_materials m on m.id = u.material_id where u.order_id = $1 order by u.created_at`, [oS.id]);
  ok(bxS.expected_g === 670 && /BENCH_REQUIRED/.test(noBench.err ?? '') && /BENCH_LOCKED/.test(lockedBench.err ?? '') && /BENCH_CHECK_DUE/.test(dueBench.err ?? '') && wS.within === true && wS.bench === `BN${tag}`,
    'W3a station: once FS-01 has a bench, a reading without one is refused (wh_pack_weigh untouched — trigger), a locked bench and an overdue check are refused, a checked bench works');
  ok(closedS.status === 'packed' && oSrow.weighed_bench_id === B1 && p1S?.source === 'single' && p1S?.status === 'closed' && p1S?.bench_id === B1 && p1S?.measured_weight_g === 670
    && p1Items.map((x) => `${x.sku}:${x.qty}`).join(',') === 'W3B-HUB:1,W3B-LAMP:1' && evLinked === 3,
    'W3a single-parcel close still works and is recorded as parcel 1 (items, bench, weight, its 3 photos)');
  ok(/MATERIAL_SHORT/.test(tapeShort.err ?? '') && /REASON_REQUIRED/.test(voidNoReason.err ?? '') && (await mat(mBox)).on_hand === 4 && (await mat(mMark)).on_hand === 1 && (await mat(mTape)).on_hand === 9
    && usageS.length === 4 && usageS.some((u) => u.source === 'box' && u.c === 35 && u.t === 35 && u.org_id === orgA)
    && usageS.some((u) => u.source === 'dg_mark' && u.c === null && u.t === null) && usageS.filter((u) => u.source === 'manual' && u.v).length === 1,
    'charged by use: closing took the box (35 ¢, client A) and the battery mark (no price → NULL) from stock; tape short → refused; a voided use goes back to stock and stays on record');

  // ── 4. multi-parcel ──
  const oM = await mkOrder('picked', [{ ...LAMP, qty: 3, picked: 3 }, { ...HUB, qty: 1, picked: 1 }]);
  await as(packer);
  await db.query(`select wh_pack_scan($1, 'W3B-LAMP')`, [oM.id]);
  await db.query(`select wh_pack_set_box($1, $2)`, [oM.id, box]);
  const add1 = (await one(`select wh_parcel_add($1) r`, [oM.id])).r;
  await owner();
  const P1 = (await one(`select id from wh_parcels where order_id = $1 and seq = 1`, [oM.id])).id;
  const P2 = add1.parcel_id;
  const oMconv = await ord(oM.id);
  const p1conv = await all(`select l.sku, i.qty from wh_parcel_items i join wh_order_lines l on l.id = i.line_id where i.parcel_id = $1`, [P1]);
  const phM = await upload(oM);
  await as(packer);
  const oldScan = await tryq(`select wh_pack_scan($1, 'W3B-LAMP')`, [oM.id]);
  const oldBox = await tryq(`select wh_pack_set_box($1, $2)`, [oM.id, box]);
  const oldPhoto = await tryq(`select wh_add_evidence($1, 'contents', $2)`, [oM.id, phM.contents]);
  ok(add1.converted === true && add1.seq === 2 && oMconv.box_id === null && oMconv.status === 'packing' && p1conv.length === 1 && p1conv[0].qty === 1
    && /MULTI_PARCEL/.test(oldScan.err ?? '') && /MULTI_PARCEL/.test(oldBox.err ?? '') && /MULTI_PARCEL/.test(oldPhoto.err ?? ''),
    'multi-parcel: the started order becomes parcel 1 (1 lamp, its box) + an empty parcel 2; the W3a scan / box / photo steps are refused on it');
  const s1 = (await one(`select wh_parcel_scan($1, 'W3B-LAMP') r`, [P1])).r;
  const s2 = (await one(`select wh_parcel_scan($1, 'W3B4711') r`, [P2])).r;
  await db.query(`select wh_parcel_scan($1, 'W3B-HUB')`, [P2]);
  const sTooMany = (await one(`select wh_parcel_scan($1, 'W3B-LAMP') r`, [P2])).r;
  const sWrong = (await one(`select wh_parcel_scan($1, 'NOPE-1') r`, [P2])).r;
  const hubLine = (await one(`select id from wh_order_lines where order_id = $1 and sku = 'W3B-HUB'`, [oM.id])).id;
  await db.query(`select wh_parcel_unscan($1, $2)`, [P2, hubLine]);
  const hubAfterUnscan = (await one(`select packed_qty from wh_order_lines where id = $1`, [hubLine])).packed_qty;
  const s3 = (await one(`select wh_parcel_scan($1, 'W3B-HUB') r`, [P2])).r;
  const earlyClose = await tryq(`select wh_parcels_close_order($1)`, [oM.id]);
  ok(s1.ok && s1.in_parcel === 2 && s2.ok && sTooMany.result === 'too_many' && sWrong.result === 'wrong_item' && hubAfterUnscan === 0 && s3.all_in_parcels === true
    && /PARCEL_OPEN: close parcel\(s\) 1, 2/.test(earlyClose.err ?? ''),
    'scans per parcel (SKU or barcode); refused scans are logged and returned; a unit can be taken back out; the order can\'t close while parcels are open');
  const w1NoBench = await tryq(`select wh_parcel_weigh($1, null, 1000)`, [P1]);
  const w1 = (await one(`select wh_parcel_weigh($1, $2, 1000) r`, [P1, B1])).r;
  await owner();
  const phP1 = await upload(oM);
  await as(packer);
  for (const k of ['contents', 'sealed', 'scale']) await db.query(`select wh_parcel_add_evidence($1, $2, $3)`, [P1, k, phP1[k]]);
  const cP1 = (await one(`select wh_parcel_close($1, false) r`, [P1])).r;
  const boxAfterP1 = (await mat(mBox)).on_hand;
  const packerReopen = await tryq(`select wh_parcel_reopen($1, 'x')`, [P1]);
  await as(sup);
  await db.query(`select wh_parcel_reopen($1, 'Wrong label side')`, [P1]);
  const boxAfterReopen = (await mat(mBox)).on_hand;
  await as(packer);
  await db.query(`select wh_parcel_close($1, false)`, [P1]);
  ok(/BENCH_REQUIRED/.test(w1NoBench.err ?? '') && w1.expected_g === 1000 && w1.tolerance_g === tol(1000) && w1.within === true && cP1.status === 'closed'
    && boxAfterP1 === 3 && /FORBIDDEN/.test(packerReopen.err ?? '') && boxAfterReopen === 4 && (await mat(mBox)).on_hand === 3,
    `parcel 1: expected 2 × 450 + 100 = 1,000 g ± ${tol(1000)} g on bench BN${tag}; closed (box taken from stock); a supervisor (not a packer) reopens it — the box goes back to stock — and it closes again`);
  await db.query(`select wh_parcel_set_box($1, $2)`, [P2, box]);
  const w2 = (await one(`select wh_parcel_weigh($1, $2, 900) r`, [P2, B1])).r;
  const noPhotos2 = await tryq(`select wh_parcel_close($1, true)`, [P2]);
  await owner();
  const phP2 = await upload(oM);
  await as(packer);
  for (const k of ['contents', 'sealed', 'scale']) await db.query(`select wh_parcel_add_evidence($1, $2, $3)`, [P2, k, phP2[k]]);
  const outTol = await tryq(`select wh_parcel_close($1, true)`, [P2]);
  const packerAsSup = await tryq(`select wh_parcel_override($1, $2, '4826', 'heavier padding')`, [P2, packer]);
  await as(sup);
  await db.query(`select wh_set_my_pin('4826')`);
  await as(packer);
  const wrong = [];
  for (let i = 0; i < 3; i++) wrong.push((await one(`select wh_parcel_override($1, $2, '9999', 'heavier padding') r`, [P2, sup])).r);
  const afterLock = await tryq(`select wh_parcel_override($1, $2, '4826', 'heavier padding')`, [P2, sup]);
  await owner();
  const exW = await one(`select * from wh_exceptions where parcel_id = $1 and kind = 'weight'`, [P2]);
  await as(sup);
  const boardW = (await one(`select wh_exceptions_board('FS-01', 'open', 'weight') r`)).r;
  const rowW = boardW.exceptions.find((e) => e.id === exW?.id);
  const supUnlock = await tryq(`select wh_exception_resolve($1, 'unlock_override', 'Checked with the packer')`, [exW?.id]);
  const supCloseHeld = await tryq(`select wh_exception_resolve($1, 'close', 'Checked with the packer')`, [exW?.id]);
  await as(whAdmin);
  const resW = (await one(`select wh_exception_resolve($1, 'unlock_override', 'Supervisor mistyped; checked in person') r`, [exW?.id])).r;
  await owner();
  const exWdone = await one(`select * from wh_exceptions where id = $1`, [exW?.id]);
  const p2unlocked = await one(`select override_attempts, override_locked_at from wh_parcels where id = $1`, [P2]);
  ok(w2.expected_g === 670 && w2.within === false && /EVIDENCE_REQUIRED/.test(noPhotos2.err ?? '') && /WEIGHT_OUT_OF_TOLERANCE/.test(outTol.err ?? '')
    && /SUPERVISOR_REQUIRED/.test(packerAsSup.err ?? '') && wrong[0].attempts_left === 2 && wrong[2].locked === true && /OVERRIDE_LOCKED/.test(afterLock.err ?? ''),
    'parcel 2: 900 g vs 670 g is out of tolerance; packers can\'t approve; three wrong supervisor PINs lock the parcel\'s override');
  ok(Boolean(exW) && exW.status === 'open' && exW.source === 'auto' && exW.order_id === oM.id && exW.org_id === orgA && /parcel 2 after three wrong supervisor PINs/.test(exW.title)
    && rowW?.held === true && JSON.stringify(rowW?.actions) === '["unlock_override"]' && /FORBIDDEN: a warehouse admin unlocks/.test(supUnlock.err ?? '')
    && /INVALID_ACTION/.test(supCloseHeld.err ?? '') && resW.status === 'resolved' && exWdone.status === 'resolved'
    && exWdone.resolution === 'Supervisor mistyped; checked in person' && exWdone.resolved_by === whAdmin && p2unlocked.override_locked_at === null && p2unlocked.override_attempts === 0,
    'the lock raised a weight exception (EX-…, client A, parcel 2) that holds the parcel: a supervisor can neither unlock nor just close it; a warehouse admin releases it from the queue with the resolution');
  await as(packer);
  const good = (await one(`select wh_parcel_override($1, $2, '4826', 'Protective padding for the power bank') r`, [P2, sup])).r;
  await as(sup);
  const supClose = await tryq(`select wh_parcel_close($1, true)`, [P2]);
  await as(packer);
  const noMark = await tryq(`select wh_parcel_close($1, false)`, [P2]);
  const cP2 = (await one(`select wh_parcel_close($1, true) r`, [P2])).r;
  const add3 = (await one(`select wh_parcel_add($1) r`, [oM.id])).r;
  const rmP1 = await tryq(`select wh_parcel_remove($1)`, [P1]);
  await db.query(`select wh_parcel_remove($1)`, [add3.parcel_id]);
  const mp = (await one(`select wh_multi_parcel($1) r`, [oM.code])).r;
  const closedM = (await one(`select wh_parcels_close_order($1) r`, [oM.id])).r;
  await as(sup);
  const reopenPacked = await tryq(`select wh_parcel_reopen($1, 'late')`, [P1]);
  await owner();
  const oMrow = await ord(oM.id);
  const lines = await all(`select sku, picked_qty, packed_qty from wh_order_lines where order_id = $1 order by sku`, [oM.id]);
  ok(good.ok === true && /TWO_PERSON_REQUIRED/.test(supClose.err ?? '') && /BATTERY_MARK_REQUIRED: parcel 2/.test(noMark.err ?? '') && cP2.status === 'closed' && cP2.open_parcels === 0
    && add3.seq === 3 && /PARCEL_CLOSED/.test(rmP1.err ?? '') && mp.parcels.length === 2 && mp.parcels.every((p) => p.status === 'closed') && mp.parcels[1].dg.includes('battery'),
    'the right PIN approves parcel 2 with a reason; the approver can\'t close it; the battery mark is required for the parcel with the power bank; only an open, empty last parcel can be removed');
  ok(closedM.status === 'packed' && closedM.parcels === 2 && oMrow.status === 'packed' && oMrow.measured_weight_g === 1900 && oMrow.expected_weight_g === 1670
    && oMrow.override_at !== null && /P2: Protective padding/.test(oMrow.override_reason) && oMrow.battery_mark === true && oMrow.box_id === box && oMrow.packed_by === packer
    && lines.every((l) => l.packed_qty === l.picked_qty) && /ORDER_PACKED/.test(reopenPacked.err ?? '')
    && (await mat(mBox)).on_hand === 2 && (await mat(mMark)).on_hand === 0,
    'order closes when every unit is in a closed parcel: totals 1,900 g measured / 1,670 g expected, the parcel approval shown on the order, battery mark, packed proof constraint holds; closed parcels stay closed');

  // ── 5. exceptions ──
  const oX = await mkOrder('picking', [{ ...LAMP, qty: 2, picked: 0 }]);
  const lineX = (await one(`select id from wh_order_lines where order_id = $1`, [oX.id])).id;
  await as(packer);
  await db.query(`select wh_report_short($1, $2, 'Bin empty')`, [oX.id, lineX]);
  await owner();
  const exX = await one(`select * from wh_exceptions where order_id = $1 and kind = 'short_pick'`, [oX.id]);
  await as(packer);
  const packerResolve = await tryq(`select wh_exception_resolve($1, 'retry', 'found it')`, [exX?.id]);
  const packerAssign = await tryq(`select wh_exception_assign($1, null)`, [exX?.id]);
  await as(sup);
  const boardX = (await one(`select wh_exceptions_board('FS-01', 'open', null) r`)).r;
  const rowX = boardX.exceptions.find((e) => e.id === exX?.id);
  const noRes = await tryq(`select wh_exception_resolve($1, 'retry', ' ')`, [exX?.id]);
  const badOwner = await tryq(`select wh_exception_assign($1, $2)`, [exX?.id, custA]);
  await db.query(`select wh_exception_assign($1, $2)`, [exX?.id, packer]);
  const assigned = await one(`select status, owner_id from wh_exceptions where id = $1`, [exX?.id]);
  const shipShort = await tryq(`select wh_exception_resolve($1, 'ship_short', 'ship what we have')`, [exX?.id]);
  const resX = (await one(`select wh_exception_resolve($1, 'retry', 'Found the units in the returns area') r`, [exX?.id])).r;
  await owner();
  const exXdone = await one(`select * from wh_exceptions where id = $1`, [exX?.id]);
  const auditX = Number((await one(`select count(*) n from audit_log where entity = 'wh_exceptions' and entity_id = $1 and action = 'wh_exception.resolved'`, [exX?.id])).n);
  ok(Boolean(exX) && exX.status === 'open' && exX.org_id === orgA && /^EX-\d{6,}$/.test(exX.code) && /Short pick: W3B-LAMP/.test(exX.title)
    && JSON.stringify(rowX?.actions) === '["retry","cancel"]' && rowX?.order?.code === oX.code,
    `short pick → ${exX?.code} raised automatically (kind short pick, client A); the queue offers pick again / cancel (nothing picked)`);
  ok(/FORBIDDEN/.test(packerResolve.err ?? '') && /FORBIDDEN/.test(packerAssign.err ?? '') && /RESOLUTION_REQUIRED/.test(noRes.err ?? '') && /INVALID_OWNER/.test(badOwner.err ?? '')
    && assigned.status === 'assigned' && assigned.owner_id === packer && /INVALID_ACTION/.test(shipShort.err ?? '') && resX.order_status === 'allocated'
    && exXdone.status === 'resolved' && exXdone.resolution === 'Found the units in the returns area' && exXdone.resolution_action === 'retry' && exXdone.resolved_by === sup && auditX === 1,
    'only supervisors / admins assign and resolve; the owner works at the warehouse; a resolution is required; "pick again" returns the order to Ready to pick; one audit row');
  await as(packer);
  await db.query(`select wh_start_pick($1)`, [oX.id]);
  await db.query(`select wh_report_short($1, $2, 'Still missing')`, [oX.id, lineX]);
  await as(sup);
  await db.query(`select wh_resolve_exception($1, 'cancel', 'Client cancelled the order')`, [oX.id]);
  await owner();
  const exX2 = await one(`select * from wh_exceptions where order_id = $1 and kind = 'short_pick' and id <> $2`, [oX.id, exX?.id]);
  ok(exX2?.status === 'resolved' && /Released on the order page: .* is now cancelled/.test(exX2?.resolution ?? '') && exX2?.resolved_by === sup && (await ord(oX.id)).status === 'cancelled',
    'a second short pick raises a new exception; releasing it on the order page (W3a) resolves it automatically');

  // receiving: two different counts → blocked lot → receiving exception → a supervisor approves from the queue
  const today = (await one(`select (now() at time zone 'Asia/Shanghai')::date::text d`)).d;
  await as(custA, 'aal1');
  const asn = (await one(`select wh_create_asn($1, 'FS-01', $2::date, 1, null, $3::jsonb, null, 'client') r`, [orgA, today, JSON.stringify([{ sku_id: sLamp, qty: 5 }])])).r;
  await as(recv);
  const slot = (await one(`select wh_book_slot('FS-01', $1, $2::date, '07:00'::time, '07:30'::time, $3, null) id`, [`W${tag}`, today, asn.id])).id;
  await db.query(`select wh_check_in($1)`, [slot]);
  const asnLine = (await one(`select id from wh_asn_lines where asn_id = $1`, [asn.id])).id;
  await db.query(`select wh_count_line($1, 4, 0, null)`, [asnLine]);
  await as(recv2);
  await db.query(`select wh_count_line($1, 4, 0, null)`, [asnLine]);
  await owner();
  const lotB = await one(`select id, lot_code, status from wh_lots where asn_line_id = $1`, [asnLine]);
  const exR = await one(`select * from wh_exceptions where lot_id = $1 and kind = 'receiving'`, [lotB?.id]);
  await as(sup);
  const rowR = (await one(`select wh_exceptions_board('FS-01', 'open', 'receiving') r`)).r.exceptions.find((e) => e.id === exR?.id);
  const resR = (await one(`select wh_exception_resolve($1, 'approve_lot', 'Recounted together: 4 good units', 4) r`, [exR?.id])).r;
  await owner();
  const exRdone = await one(`select * from wh_exceptions where id = $1`, [exR?.id]);
  ok(lotB?.status === 'blocked' && Boolean(exR) && exR.asn_id === asn.id && exR.org_id === orgA && /blocked: the counts on .* differ \(4 good counted, 5 expected\)/.test(exR.title)
    && JSON.stringify(rowR?.actions) === '["approve_lot"]' && rowR?.lot?.max === 5 && resR.status === 'resolved'
    && (await one(`select status, qty from wh_lots where id = $1`, [lotB?.id])).status === 'released' && exRdone.resolution === 'Recounted together: 4 good units'
    && exRdone.resolution_action === 'approve_lot',
    'a blocked lot (W2a) raises a receiving exception; approving it from the queue releases the lot (W2a rules) and keeps the resolution');

  // manual exceptions
  await as(packer);
  const man = (await one(`select wh_exception_raise('FS-01', 'label', 'Label printer jammed; label smudged', $1, null) r`, [oS.code])).r;
  const manDup = await tryq(`select wh_exception_raise('FS-01', 'label', 'again', $1, null)`, [oS.code]);
  const manShort = await tryq(`select wh_exception_raise('FS-01', 'short_pick', 'x y z', null, null)`);
  const manBadOrder = await tryq(`select wh_exception_raise('FS-01', 'stock', 'missing box', 'WO-999999999', null)`);
  await as(custA, 'aal1');
  const custRaise = await tryq(`select wh_exception_raise('FS-01', 'other', 'hello there', null, null)`);
  await as(sup);
  const manRow = (await one(`select wh_exceptions_board('FS-01', 'open', 'label') r`)).r.exceptions.find((e) => e.id === man.id);
  const manClose = (await one(`select wh_exception_resolve($1, 'close', 'Reprinted the label') r`, [man.id])).r;
  await owner();
  ok(/^EX-/.test(man.code) && /ALREADY_OPEN/.test(manDup.err ?? '') && /INVALID_KIND/.test(manShort.err ?? '') && /ORDER_NOT_FOUND/.test(manBadOrder.err ?? '')
    && /FORBIDDEN/.test(custRaise.err ?? '') && JSON.stringify(manRow?.actions) === '["close"]' && manClose.status === 'resolved',
    'staff report label / stock / carrier / other problems by hand (one open per order and kind); short picks come from picking; customers can\'t; closed with a resolution');

  // order-level (W3a) override lock → weight exception; the admin unlocks on the order page → resolved
  const oW = await mkOrder('picked', [{ ...LAMP, qty: 1, picked: 1 }]);
  await as(packer);
  await db.query(`select wh_pack_scan($1, 'W3B-LAMP')`, [oW.id]);
  await db.query(`select wh_pack_set_box($1, $2)`, [oW.id, box]);
  await db.query(`select wh_pack_weigh_on($1, $2, 900)`, [oW.id, B1]);
  for (let i = 0; i < 3; i++) await db.query(`select wh_weight_override($1, $2, '1111', 'padding')`, [oW.id, sup]);
  await owner();
  const exOW = await one(`select * from wh_exceptions where order_id = $1 and kind = 'weight' and parcel_id is null`, [oW.id]);
  await as(whAdmin);
  await db.query(`select wh_unlock_override($1, 'Checked in person')`, [oW.id]);
  await owner();
  const exOWdone = await one(`select status, resolution, resolution_action from wh_exceptions where id = $1`, [exOW?.id]);
  ok(exOW?.status === 'open' && /Weight override locked on .* \(900 g measured, 550 g expected\)/.test(exOW?.title ?? '') && exOWdone.status === 'resolved'
    && /Override unlocked by a warehouse admin/.test(exOWdone.resolution) && exOWdone.resolution_action === 'unlock_override',
    'three wrong PINs at the W3a station raise a weight exception; the admin unlock on the order page resolves it');

  // customers see nothing of W3b; the boards are staff-only
  await as(custA, 'aal1');
  const custRows = [];
  for (const t of W3B_TABLES) { const r = await tryq(`select count(*)::int n from ${t}`); if (r.err || r.rows[0].n > 0) custRows.push(`${t}${r.err ? ' (error)' : ''}`); }
  const custBoards = [];
  for (const f of ['wh_exceptions_board()', 'wh_materials_board()', 'wh_scale_board()', `wh_multi_parcel('${oM.code}')`]) custBoards.push(await tryq(`select ${f}`));
  const custWrite = await tryq(`insert into wh_exceptions (warehouse_code, kind, title) values ('FS-01', 'other', 'x')`);
  await as(packer);
  const packerWrite = await tryq(`update wh_materials set on_hand = 999 where id = $1`, [mBox]);
  const packerInternal = await tryq(`select wh_material_post($1, 'receive', 5, 'x', null, null, null)`, [mBox]);
  await owner();
  ok(custRows.length === 0 && custBoards.every((b) => /FORBIDDEN/.test(b.err ?? '')) && /permission denied/.test(custWrite.err ?? '') && /permission denied/.test(packerWrite.err ?? '')
    && /permission denied/.test(packerInternal.err ?? ''),
    `customers see no W3b rows and no W3b board${custRows.length ? ' — ' + custRows.join(', ') : ''}; nobody writes the tables directly; internal posters are not callable`);

  // ── 6. audit, ledgers, demo wipe ──
  const actions = new Set((await all(`select distinct action from audit_log where (entity = 'wh_orders' and entity_id = any($1)) or (entity in ('wh_scale_benches', 'wh_materials', 'wh_exceptions') and created_at > now() - interval '1 hour' and actor_id = any($2))`,
    [[oS.id, oM.id, oX.id, oW.id], [sup, packer, whAdmin, recv, recv2]])).map((r) => r.action));
  const need = ['wh_scale.bench_created', 'wh_scale.bench_updated', 'wh_scale.check_passed', 'wh_scale.check_failed', 'wh_material.created', 'wh_material.received',
    'wh_material.charge_set', 'wh_material.used', 'wh_material.voided', 'wh_parcel.added', 'wh_parcel.box_chosen', 'wh_parcel.weighed', 'wh_parcel.evidence_added',
    'wh_parcel.closed', 'wh_parcel.reopened', 'wh_parcel.removed', 'wh_parcel.item_removed', 'wh_parcel.pin_wrong', 'wh_parcel.override_locked', 'wh_parcel.override_unlocked',
    'wh_parcel.override_approved', 'wh_order.packed', 'wh_exception.raised', 'wh_exception.assigned', 'wh_exception.resolved'];
  const missing = need.filter((a) => !actions.has(a));
  ok(missing.length === 0, `every W3b step is audit-logged${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
  const mats = [mBox, mTape, mMark];
  const matLedger = await all(`select m.code, m.on_hand, coalesce(sum(v.delta), 0)::int s, coalesce(bool_and(v.balance_after >= 0), true) nonneg,
      bool_or(v.balance_after = m.on_hand) reached
      from wh_materials m left join wh_material_moves v on v.material_id = m.id where m.id = any($1) group by m.id, m.code, m.on_hand`, [mats]);
  const usageVsMoves = await one(`select (select coalesce(sum(qty), 0) from wh_material_usage where material_id = any($1)) u,
      (select coalesce(sum(qty), 0) from wh_material_moves where material_id = any($1) and kind = 'consume') c,
      (select coalesce(sum(qty), 0) from wh_material_usage where material_id = any($1) and voided_at is not null) vu,
      (select coalesce(sum(qty), 0) from wh_material_moves where material_id = any($1) and kind = 'return') r`, [mats]);
  const stockMismatch = await all(`
    select ws.warehouse_id, ws.item_id from warehouse_stock ws left join warehouse_stock_movements m on m.warehouse_id = ws.warehouse_id and m.item_id = ws.item_id
     where ws.item_id = any($1) group by ws.warehouse_id, ws.item_id, ws.on_hand_qty, ws.reserved_qty
    having ws.on_hand_qty <> coalesce(sum(m.on_hand_delta), 0) or ws.reserved_qty <> coalesce(sum(m.reserved_delta), 0)`, [[iLamp, iHub]]);
  ok(matLedger.length === 3 && matLedger.every((m) => m.on_hand === m.s && m.nonneg && m.reached) && Number(usageVsMoves.u) === Number(usageVsMoves.c)
    && Number(usageVsMoves.vu) === Number(usageVsMoves.r) && stockMismatch.length === 0,
    `material ledger balanced (${matLedger.map((m) => `${m.code} ${m.on_hand}`).join(', ')}: on hand = sum of moves, never below 0; uses = consume moves; voids = returns); stock ledger balanced`);

  const movesBefore = Number((await one(`select count(*) n from wh_material_moves where material_id = any($1)`, [mats])).n);
  const w3bBefore = Number((await one(`select (select count(*) from wh_parcels where order_id = any($1)) + (select count(*) from wh_material_usage where org_id = $2) + (select count(*) from wh_exceptions where org_id = $2) n`,
    [[oS.id, oM.id, oX.id, oW.id], orgA])).n);
  await db.query('savepoint wipe');
  const wiped = await tryq(`select wipe_demo_data('DELETE DEMO DATA FOR ydbxqrizjxpduqbgnwxg', null) c`);
  const w3bAfter = Number((await one(`select (select count(*) from wh_parcels where order_id = any($1)) + (select count(*) from wh_material_usage where org_id = $2) + (select count(*) from wh_exceptions where org_id = $2) n`,
    [[oS.id, oM.id, oX.id, oW.id], orgA])).n);
  const movesAfter = Number((await one(`select count(*) n from wh_material_moves where material_id = any($1)`, [mats])).n);
  const orgLeft = Number((await one(`select count(*) n from organizations where id = $1`, [orgA])).n);
  await db.query('rollback to savepoint wipe');
  ok(!wiped.err && w3bBefore > 0 && w3bAfter === 0 && orgLeft === 0 && movesAfter === movesBefore,
    `demo wipe (unchanged 233 function) removes the demo company's parcels, material uses and exceptions (${w3bBefore} rows, by cascade) and keeps every material move${wiped.err ? ' — ' + wiped.err : ''}`);
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  ok(!(await db.query(`select 1 from auth.users where email like 'w3b-%@test.local'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nW3b warehouse: ${failed} check(s) failed` : '\nW3b warehouse: all passed');
process.exitCode = failed ? 1 : 0;
