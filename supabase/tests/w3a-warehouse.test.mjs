// Warehouse OS · W3a DB checks — warehouse orders, routing + allocation, handheld picking (FIFO, bin sub-ledger), packing station
// (weight tolerance, supervisor PIN override, 3-strike lock, dangerous goods mark, photos + retention), client isolation,
// Dropship import, audit and ledger. STAGING ONLY, rolled-back transactions.
//  0. Down → up: the W3a down restores record_warehouse_stock_movement() (W2a) and wh_lot_free() (W2b) and removes every W3a
//     object; up again gives identical functions, grants, policies, columns, constraints, indexes, triggers and storage policies.
//  1. Setup through the real W2a/W2b paths: client SKUs, two notices received at FS-01 (two LAMP lots), one at a second active
//     warehouse, bins + putaway.
//  2. Intake + routing: client orders reserve at the preferred warehouse, wait when stock is short, route to the warehouse
//     that has the stock; validation, duplicates, CSV preview / all-or-nothing; clients see only their own orders.
//  3. Picking: refused scans are logged (wrong item, unknown bin, not FIFO); a pick posts ledger 'pick' and takes the units out
//     of the bin in the same transaction; bins ≤ on hand; receivers and customers can't pick.
//  4. Packing: every item scanned, box → expected weight + tolerance, battery mark, photos (storage object must exist),
//     retention, close; the client's proof.
//  5. Override: packers can't set a PIN or approve; 3 wrong PINs lock; supervisor can't unlock, admin can; reason required;
//     re-weigh voids the approval; TWO PEOPLE: the approver never weighed, scanned or closes the parcel (function + CHECK).
//  6. Short pick → exception → supervisor ships short (remainder released); client cancel releases; waiting orders.
//  7. Dropship: a handed-over store order is imported, its reservation moves from the store order to the warehouse order
//     (existing consumers can't pick or release it again); legacy store-order semantics unchanged; merchants see nothing.
//  8. Settings (admin only), audit rows, ledger balanced; the staging demo wipe removes demo companies' W3a rows (and keeps
//     every stock movement); down restores the exact 230 wipe_demo_data().
// Run: node --env-file=.env.staging supabase/tests/w3a-warehouse.test.mjs
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
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w3a_orders_pick_pack(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));
const W3A_TABLES = ['wh_settings', 'wh_boxes', 'wh_orders', 'wh_order_lines', 'wh_pick_records', 'wh_scan_log', 'wh_pack_evidence', 'wh_supervisor_pins', 'wh_override_attempts'];
const W3A_FNS = ['wh_post_order_movement', 'wh_release_store_order_reserve', 'wh_settings_for', 'wh_weight_tolerance', 'wh_user_can', 'wh_dg_kinds', 'wh_refresh_dg',
  'wh_assert_store_order_open', 'wh_scan_reject', 'wh_allocate', 'wh_check_client_order', 'wh_insert_client_order', 'wh_create_client_order',
  'wh_validate_client_orders', 'wh_create_client_orders', 'wh_retry_allocation', 'wh_dropship_is_ready', 'wh_import_dropship_order', 'wh_start_pick',
  'wh_pick_scan', 'wh_report_short', 'wh_resolve_exception', 'wh_cancel_order', 'wh_pack_scan', 'wh_pack_set_box', 'wh_pack_weigh', 'wh_set_my_pin',
  'wh_weight_override', 'wh_unlock_override', 'wh_add_evidence', 'wh_pack_close', 'wh_save_settings', 'wh_save_box', 'wh_evidence_can_upload',
  'wh_evidence_can_read', 'wh_order_row', 'wh_orders_board', 'wh_order_detail', 'wh_pick_board', 'wh_pack_board', 'wh_evidence_board', 'wh_portal_proof'];

try {
  // ── 0. down → up ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a, md5(p.prosrc) s, pg_get_function_arguments(p.oid) args, p.prosecdef d, p.proconfig::text c
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'wh\\_%' or p.proname in ('record_warehouse_stock_movement', 'wipe_demo_data')) order by 1`),
    pol: await all(`select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
                     where (schemaname = 'public' and tablename like 'wh\\_%') or (schemaname = 'storage' and policyname like 'wh evidence%') order by 1, 2, 3`),
    tg: await all(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger
                    where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and (relname like 'wh\\_%' or relname like 'warehouse\\_stock%')) order by 1, 2`),
    tp: await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
                    where table_schema = 'public' and (table_name like 'wh\\_%' or table_name like 'warehouse\\_stock%') and grantee in ('anon', 'authenticated') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and table_name like 'wh\\_%' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    col: await all(`select table_name, column_name, column_default, is_nullable, data_type from information_schema.columns
                     where table_schema = 'public' and (table_name like 'wh\\_%' or table_name like 'warehouse\\_stock%') order by 1, 2`),
    con: await all(`select conrelid::regclass::text t, conname, replace(pg_get_constraintdef(oid), ' NOT VALID', '') d from pg_constraint
                     where connamespace = 'public'::regnamespace and (conrelid::regclass::text like 'wh\\_%' or conrelid::regclass::text like 'warehouse\\_stock%') order by 1, 2`),
    idx: await all(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and (tablename like 'wh\\_%' or tablename like 'warehouse\\_stock%') order by 1, 2`),
    seq: await all(`select sequencename from pg_sequences where schemaname = 'public' and sequencename like 'seq\\_wh\\_%' order by 1`),
  });
  const upFile = mig('supabase/migrations');
  const downFile = mig('supabase/migrations/down');
  ok(Boolean(upFile && downFile), `W3a migration files found (${upFile} / ${downFile})`);
  const after = await snap();
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, upFile);
  await unwind(db, later);
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const leftT = await all(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [[...W3A_TABLES, 'seq_wh_order']]);
  const leftF = await all(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [W3A_FNS]);
  const rw = (await one(`select prosrc s from pg_proc where oid = 'public.record_warehouse_stock_movement(uuid,text,integer,text,text,uuid)'::regprocedure`)).s;
  const lf = (await one(`select prosrc s from pg_proc where oid = 'public.wh_lot_free(uuid)'::regprocedure`)).s;
  const col = await one(`select 1 x from information_schema.columns where table_name = 'warehouse_stock_movements' and column_name = 'wh_order_id'`);
  const spol = await all(`select policyname from pg_policies where schemaname = 'storage' and policyname like 'wh evidence%'`);
  const src230 = fs.readFileSync('supabase/migrations/20261101000230_demo_wipe_turnkey_warehouse.sql', 'utf8');
  const i230 = src230.indexOf('CREATE OR REPLACE FUNCTION public.wipe_demo_data');
  const wipe230 = src230.slice(i230, src230.indexOf('end $function$;', i230) + 'end $function$'.length);
  const wipeNow = (await one(`select pg_get_functiondef('public.wipe_demo_data(text,uuid)'::regprocedure) d`)).d;
  ok(wipeNow.trim() === wipe230.trim(), 'down: wipe_demo_data is exactly the 230 definition again');
  ok(leftT.length === 0 && leftF.length === 0 && !/wh_order_id/.test(rw) && /octopus\.wh_internal/.test(rw) && !/wh_pick_records/.test(lf) && /wh_transfer_picks/.test(lf) && !col && spol.length === 0,
    'down: W3a tables, sequence, functions, storage policies and wh_order_id are gone; record_warehouse_stock_movement (W2a) and wh_lot_free (W2b) restored');
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  await reapply(db, later);
  const again = await snap();
  if (again !== after) { const a = JSON.parse(after), b = JSON.parse(again); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('  diff in', k); }
  ok(again === after, 'up again: identical functions, grants, policies, columns, constraints, indexes, triggers and storage policies');
  await db.query('rollback');

  await db.query('begin');
  // ── 1. setup ──
  const mkUser = async (tag, role = null) => {
    const e = `w3a-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`, [id, `W3a ${tag}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  let WH2 = '';
  for (let i = 0; i < 30 && !WH2; i++) {
    const c = `TW-${String(Math.floor(Math.random() * 90) + 10)}`;
    if (!(await one(`select 1 x from warehouses where code = $1`, [c]))) WH2 = c;
  }
  await db.query(`insert into warehouses (code, name, city, status) values ($1, 'W3a test warehouse', 'Guangzhou', 'active')`, [WH2]);
  const whAdmin = await mkUser('whadmin', 'warehouse');
  const sup = await mkUser('sup', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  const recv = await mkUser('recv', 'warehouse');
  const recvB = await mkUser('recvb', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin'), ($2, 'FS-01', 'supervisor'), ($3, 'FS-01', 'packer'),
    ($4, 'FS-01', 'receiver'), ($5, $6, 'receiver'), ($3, $6, 'packer')`, [whAdmin, sup, packer, recv, recvB, WH2]);
  // W3b: scale benches and packaging materials that FS-01 may already have are set aside inside this rolled-back transaction, so the
  // W3a weighing / closing path runs as written (no bench required, no box or battery mark taken from materials stock)
  if ((await one(`select to_regclass('public.wh_scale_benches') t`)).t) {
    await db.query(`update wh_scale_benches set active = false where warehouse_code = 'FS-01'`);
    await db.query(`update wh_materials set active = false where warehouse_code = 'FS-01'`);
  }
  const orgA = (await one(`insert into organizations(name, country, is_seed) values ('W3a Client A', 'AE', true) returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country, is_seed) values ('W3a Client B', 'DE', true) returning id`)).id;
  const custA = await mkUser('custa');
  const custB = await mkUser('custb');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, custA, orgB, custB]);
  await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01'), ($2, 'standard', 'FS-01')`, [orgA, orgB]);
  const auditBefore = Number((await one(`select count(*) n from audit_log where action like 'wh\\_order.%' or action like 'wh\\_override.%'`)).n);
  const today = (await one(`select (now() at time zone 'Asia/Shanghai')::date::text d`)).d;
  const tag = String(Math.floor(Math.random() * 90) + 10);

  await as(custA, 'aal1');
  const sLamp = (await one(`select wh_save_client_sku($1, null, 'W3A-LAMP', 'Desk lamp', 'LAMP4711', 450, false, false) id`, [orgA])).id;
  const sHub = (await one(`select wh_save_client_sku($1, null, 'W3A-HUB', 'USB-C hub with battery', null, 120, true, false) id`, [orgA])).id;
  const sNow = (await one(`select wh_save_client_sku($1, null, 'W3A-NOW', 'Organiser (no weight)', null, null, false, false) id`, [orgA])).id;
  const asn1 = (await one(`select wh_create_asn($1, 'FS-01', $2::date, 2, null, $3::jsonb, null, 'client') r`, [orgA, today, JSON.stringify([{ sku_id: sLamp, qty: 5 }, { sku_id: sHub, qty: 3 }])])).r;
  const asn2 = (await one(`select wh_create_asn($1, 'FS-01', $2::date, 1, null, $3::jsonb, null, 'client') r`, [orgA, today, JSON.stringify([{ sku_id: sLamp, qty: 5 }])])).r;
  const asn3 = (await one(`select wh_create_asn($1, $2, $3::date, 1, null, $4::jsonb, null, 'client') r`, [orgA, WH2, today, JSON.stringify([{ sku_id: sNow, qty: 4 }])])).r;
  await owner();
  const item = async (s) => (await one(`select item_id from wh_client_skus where id = $1`, [s])).item_id;
  const [iLamp, iHub, iNow] = [await item(sLamp), await item(sHub), await item(sNow)];
  const receive = async (who, wh, asn, start, end) => {
    await as(who);
    const slot = (await one(`select wh_book_slot($1, $2, $3::date, $4::time, $5::time, $6, null) id`, [wh, `W${tag}X`, today, start, end, asn.id])).id;
    await db.query(`select wh_check_in($1)`, [slot]);
    for (const l of await all(`select id, expected_qty from wh_asn_lines where asn_id = $1 order by id`, [asn.id])) await db.query(`select wh_count_line($1, $2, 0, null)`, [l.id, l.expected_qty]);
    await owner();
  };
  await receive(recv, 'FS-01', asn1, '08:00', '09:00');
  await receive(recv, 'FS-01', asn2, '09:00', '10:00');
  await receive(recvB, WH2, asn3, '08:00', '09:00');
  const lot = async (asnId, itemId) => one(`select t.id, t.lot_code from wh_lots t join wh_asn_lines l on l.id = t.asn_line_id where l.asn_id = $1 and t.item_id = $2`, [asnId, itemId]);
  const L1 = await lot(asn1.id, iLamp); const H1 = await lot(asn1.id, iHub); const L2 = await lot(asn2.id, iLamp); const N1 = await lot(asn3.id, iNow);
  const rack = `P${tag}`;
  await as(recv);
  await db.query(`select wh_create_bin_range('FS-01', $1, 1, 1, 1, 3, null)`, [rack]);
  await as(recvB);
  await db.query(`select wh_create_bin($1, $2, null)`, [WH2, `${rack}-01-01`]);
  await owner();
  const bin = async (wh, code) => (await one(`select id from wh_bins where warehouse_code = $1 and code = $2`, [wh, code])).id;
  const [B1, B2, B3] = [await bin('FS-01', `${rack}-01-01`), await bin('FS-01', `${rack}-01-02`), await bin('FS-01', `${rack}-01-03`)];
  const BN = await bin(WH2, `${rack}-01-01`);
  await as(recv);
  await db.query(`select wh_putaway($1, $2, 5, null)`, [L1.id, B2]);   // the OLDER LAMP lot sits in bin 02
  await db.query(`select wh_putaway($1, $2, 5, null)`, [L2.id, B1]);   // the newer LAMP lot in bin 01
  await db.query(`select wh_putaway($1, $2, 3, null)`, [H1.id, B3]);
  await as(recvB);
  await db.query(`select wh_putaway($1, $2, 4, null)`, [N1.id, BN]);
  await owner();
  const stock = async (wh, it) => (await one(`select on_hand_qty o, reserved_qty r from warehouse_stock where warehouse_id = $1 and item_id = $2`, [wh, it])) ?? { o: 0, r: 0 };
  const placed = async (wh, it) => Number((await one(`select coalesce(sum(qty), 0) n from wh_bin_stock where warehouse_code = $1 and item_id = $2`, [wh, it])).n);
  ok(L1.lot_code < L2.lot_code && (await stock('FS-01', iLamp)).o === 10 && (await placed('FS-01', iLamp)) === 10 && (await stock(WH2, iNow)).o === 4,
    `setup: LAMP lots ${L1.lot_code} (older, bin 02) and ${L2.lot_code} (bin 01) on hand at FS-01; NOW only at ${WH2}`);

  // ── 2. intake + routing ──
  const ship = { name: 'Ana Silva', phone: '+351 912 000 000', line1: 'Rua Augusta 1', city: 'Lisbon', postcode: '1100-048', country: 'pt' };
  const order = (ref, lines, extra = {}) => JSON.stringify({ external_ref: ref, ship, lines, ...extra });
  await as(custA, 'aal1');
  const o1 = (await one(`select wh_create_client_order($1, $2::jsonb) r`, [orgA, order('T1', [{ sku_id: sLamp, qty: 3 }, { sku: 'w3a-hub', qty: 1 }])])).r;
  const o2 = (await one(`select wh_create_client_order($1, $2::jsonb) r`, [orgA, order('T2', [{ sku_id: sLamp, qty: 100 }])])).r;
  const o3 = (await one(`select wh_create_client_order($1, $2::jsonb) r`, [orgA, order('T3', [{ sku_id: sNow, qty: 1 }])])).r;
  const o4 = (await one(`select wh_create_client_order($1, $2::jsonb) r`, [orgA, order('T4', [{ sku_id: sLamp, qty: 1 }])])).r;
  const o5 = (await one(`select wh_create_client_order($1, $2::jsonb) r`, [orgA, order('T5', [{ sku_id: sLamp, qty: 2 }])])).r;
  const o6 = (await one(`select wh_create_client_order($1, $2::jsonb) r`, [orgA, order('T6', [{ sku_id: sHub, qty: 1 }])])).r;
  const dupRef = await tryq(`select wh_create_client_order($1, $2::jsonb)`, [orgA, order('T1', [{ sku_id: sLamp, qty: 1 }])]);
  const badSku = await tryq(`select wh_create_client_order($1, $2::jsonb)`, [orgA, order('T9', [{ sku: 'NOT-MINE', qty: 1 }])]);
  const badCountry = await tryq(`select wh_create_client_order($1, $2::jsonb)`, [orgA, JSON.stringify({ ship: { ...ship, country: 'PRT' }, lines: [{ sku_id: sLamp, qty: 1 }] })]);
  const zeroQty = await tryq(`select wh_create_client_order($1, $2::jsonb)`, [orgA, order('T8', [{ sku_id: sLamp, qty: 0 }])]);
  const csvCheck = (await one(`select wh_validate_client_orders($1, $2::jsonb) r`, [orgA, JSON.stringify([
    { external_ref: 'C1', ship, lines: [{ sku: 'W3A-LAMP', qty: '1' }] }, { external_ref: 'C2', ship, lines: [{ sku: 'NOPE', qty: '1' }] }, { external_ref: 'C1', ship, lines: [{ sku: 'W3A-HUB', qty: '1' }] }])])).r;
  const before = Number((await one(`select count(*) n from wh_orders where org_id = $1`, [orgA])).n);
  const csvBad = await tryq(`select wh_create_client_orders($1, $2::jsonb, 'client_csv')`, [orgA, JSON.stringify([
    { external_ref: 'C1', ship, lines: [{ sku: 'W3A-LAMP', qty: '1' }] }, { external_ref: 'C2', ship, lines: [{ sku: 'NOPE', qty: '1' }] }])]);
  const afterBad = Number((await one(`select count(*) n from wh_orders where org_id = $1`, [orgA])).n);
  const mine = await all(`select code, status, warehouse_code from wh_orders order by code`);
  const hidden = await tryq(`select override_reason from wh_orders limit 1`);
  const hiddenPicks = (await all(`select 1 from wh_pick_records`)).length + (await all(`select 1 from wh_pack_evidence`)).length + (await all(`select 1 from wh_scan_log`)).length;
  await as(custB, 'aal1');
  const crossCreate = await tryq(`select wh_create_client_order($1, $2::jsonb)`, [orgA, order('X1', [{ sku_id: sLamp, qty: 1 }])]);
  const bSees = (await all(`select 1 from wh_orders where org_id = $1`, [orgA])).length + (await all(`select 1 from wh_order_lines`)).length;
  await owner();
  const ord = async (id) => one(`select * from wh_orders where id = $1`, [id]);
  const resv = async (oid) => Number((await one(`select coalesce(sum(case kind when 'reserve' then qty else -qty end), 0) n from warehouse_stock_movements where wh_order_id = $1`, [oid])).n);
  ok(o1.status === 'allocated' && o1.warehouse === 'FS-01' && /^WO-\d{6,}$/.test(o1.code) && o2.status === 'new' && o3.status === 'allocated' && o3.warehouse === WH2 &&
    (await stock('FS-01', iLamp)).r === 6 && (await stock(WH2, iNow)).r === 1 && (await resv(o1.id)) === 4,
    `routing: ${o1.code} reserved at the preferred FS-01; ${o2.code} waits (not enough stock); ${o3.code} routed to ${WH2} where the stock is`);
  const o1row = await ord(o1.id);
  ok(o1row.has_dangerous_goods === true && JSON.stringify(o1row.dg_kinds) === JSON.stringify(['battery']) && o1row.ship_country === 'PT' && o1row.source === 'client_portal',
    'dangerous goods come from the product flags (battery); ship-to normalised');
  ok(/DUPLICATE_ORDER/.test(dupRef.err ?? '') && /UNKNOWN_SKU/.test(badSku.err ?? '') && /INVALID_COUNTRY/.test(badCountry.err ?? '') && /INVALID_QTY/.test(zeroQty.err ?? ''),
    'intake validation: duplicate client reference, unknown SKU, bad country code and zero quantity refused');
  ok(csvCheck[0].ok === true && csvCheck[1].ok === false && /UNKNOWN_SKU/.test(csvCheck[1].error) && csvCheck[2].ok === false && /twice/.test(csvCheck[2].error) &&
    /ORDER_REFUSED: order 2/.test(csvBad.err ?? '') && afterBad === before,
    'CSV: the preview checks every order (unknown SKU, duplicate in file); creation is all-or-nothing');
  ok(mine.length === 6 && /permission denied/.test(hidden.err ?? '') && hiddenPicks === 0 && /FORBIDDEN/.test(crossCreate.err ?? '') && bSees === 0,
    'clients see only their own orders (customer-safe columns; no picks, scans or evidence rows); another client sees nothing and cannot order for them');

  // ── 3. picking ──
  await as(recv);
  const recvPick = await tryq(`select wh_start_pick($1)`, [o1.id]);
  await as(custA, 'aal1');
  const custPick = await tryq(`select wh_pick_scan($1, $2, 'W3A-LAMP', 1)`, [o1.id, `${rack}-01-02`]);
  await as(packer);
  await db.query(`select wh_start_pick($1)`, [o1.id]);
  const wrongItem = (await one(`select wh_pick_scan($1, $2, 'NOPE', 1) r`, [o1.id, `${rack}-01-02`])).r;
  const unknownBin = (await one(`select wh_pick_scan($1, 'ZZ-99-99', 'W3A-LAMP', 1) r`, [o1.id])).r;
  const notFifo = (await one(`select wh_pick_scan($1, $2, 'LAMP4711', 3) r`, [o1.id, `${rack}-01-01`])).r;
  const tooMany = (await one(`select wh_pick_scan($1, $2, 'W3A-LAMP', 4) r`, [o1.id, `${rack}-01-02`])).r;
  await owner(); // packers can't read the stock ledger: count as the owner
  const movBefore = Number((await one(`select count(*) n from warehouse_stock_movements where item_id = $1`, [iLamp])).n);
  await as(packer);
  const p1 = (await one(`select wh_pick_scan($1, $2, 'lamp4711', 3) r`, [o1.id, `${rack}-01-02`])).r;
  const p2 = (await one(`select wh_pick_scan($1, $2, 'W3A-HUB', 1) r`, [o1.id, `${rack}-01-03`])).r;
  await owner();
  const binQty = async (b, it) => Number((await one(`select coalesce(sum(qty), 0) n from wh_bin_stock where bin_id = $1 and item_id = $2`, [b, it])).n);
  const pickMov = await one(`select count(*) n, sum(qty) q, min(wh_order_id::text) w from warehouse_stock_movements where item_id = $1 and kind = 'pick' and wh_order_id = $2`, [iLamp, o1.id]);
  const scans = await all(`select result from wh_scan_log where order_id = $1 order by created_at, id`, [o1.id]);
  ok(/FORBIDDEN/.test(recvPick.err ?? '') && /FORBIDDEN/.test(custPick.err ?? ''), 'receivers and customers cannot pick');
  ok(wrongItem.ok === false && wrongItem.result === 'wrong_item' && unknownBin.result === 'unknown_bin' && notFifo.result === 'not_fifo' && /first/.test(notFifo.message) &&
    tooMany.result === 'too_many' && scans.filter((s) => s.result !== 'ok').length >= 4,
    `refused scans are logged and explained (wrong item, unknown bin, FIFO: "${notFifo.message}", too many)`);
  ok(p1.ok === true && p2.ok === true && p2.status === 'picked' && (await binQty(B2, iLamp)) === 2 && (await binQty(B1, iLamp)) === 5 &&
    (await stock('FS-01', iLamp)).o === 7 && (await stock('FS-01', iLamp)).r === 3 && Number(pickMov.n) === 1 && Number(pickMov.q) === 3 &&
    Number((await one(`select count(*) n from warehouse_stock_movements where item_id = $1`, [iLamp])).n) === movBefore + 1 &&
    Number((await one(`select coalesce(sum(qty), 0) n from wh_pick_records where order_id = $1 and lot_id = $2 and bin_id = $3`, [o1.id, L1.id, B2])).n) === 3,
    'a pick posts ledger pick (reserved → out) with the warehouse order and takes the units from the older lot\'s bin in the same transaction');
  await db.query(`set constraints all immediate`);
  await db.query(`set constraints all deferred`);
  ok((await placed('FS-01', iLamp)) <= (await stock('FS-01', iLamp)).o && (await one(`select wh_lot_free($1) f`, [L1.id])).f === 0,
    'bins never hold more than on hand after picking (deferred check passes); picked units are not counted as "waiting for putaway"');

  // ── 4. packing (dangerous goods, photos, tolerance) ──
  await as(sup);
  const box = await one(`select wh_save_box('FS-01', null, $1, 'Test carton', 300, 200, 100, 100, true) id`, [`BX${tag}`]);
  await as(packer);
  const packerBox = await tryq(`select wh_save_box('FS-01', null, 'BXP', 'x', null, null, null, 10, true)`);
  const early = await tryq(`select wh_pack_close($1, true)`, [o1.id]);
  const pWrong = (await one(`select wh_pack_scan($1, 'NOPE') r`, [o1.id])).r;
  for (const c of ['W3A-LAMP', 'LAMP4711', 'W3A-LAMP', 'W3A-HUB']) await db.query(`select wh_pack_scan($1, $2)`, [o1.id, c]);
  const pTooMany = (await one(`select wh_pack_scan($1, 'W3A-LAMP') r`, [o1.id])).r;
  const bx = (await one(`select wh_pack_set_box($1, $2) r`, [o1.id, box.id])).r;
  const w1 = (await one(`select wh_pack_weigh($1, 1600) r`, [o1.id])).r;
  const noMark = await tryq(`select wh_pack_close($1, false)`, [o1.id]);
  const noPhotos = await tryq(`select wh_pack_close($1, true)`, [o1.id]);
  const path = (o, k) => `FS-01/${o.code}/${k}-${crypto.randomUUID()}.jpg`;
  const p1c = path(o1, 'contents');
  const notUploaded = await tryq(`select wh_add_evidence($1, 'contents', $2)`, [o1.id, p1c]);
  const canUp = (await one(`select wh_evidence_can_upload($1) v`, [p1c])).v;
  await as(custA, 'aal1');
  const custUp = (await one(`select wh_evidence_can_upload($1) v`, [p1c])).v;
  await owner();
  const photos1 = [p1c, path(o1, 'sealed'), path(o1, 'scale')];
  for (const p of photos1) await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-evidence', $1, $2)`, [p, packer]);
  await as(packer);
  for (const [i, k] of ['contents', 'sealed', 'scale'].entries()) await db.query(`select wh_add_evidence($1, $2, $3)`, [o1.id, k, photos1[i]]);
  const wrongPath = await tryq(`select wh_add_evidence($1, 'sealed', $2)`, [o1.id, `FS-01/${o4.code}/sealed-${crypto.randomUUID()}.jpg`]);
  const closed1 = (await one(`select wh_pack_close($1, true) r`, [o1.id])).r;
  await owner();
  const ret = await one(`select min(retention_until - created_at) d, count(*) n from wh_pack_evidence where order_id = $1`, [o1.id]);
  ok(/FORBIDDEN/.test(packerBox.err ?? '') && box.id && bx.expected_g === 3 * 450 + 120 + 100 && bx.tolerance_g === 79 && w1.within === true && w1.difference_g === 30,
    `box → expected ${bx.expected_g} g (items + tare) ± ${bx.tolerance_g} g (max 20 g / 5 %); 1,600 g is inside; packers can't manage boxes`);
  ok(/NOT_ALL_SCANNED/.test(early.err ?? '') && pWrong.result === 'wrong_item' && pTooMany.result === 'too_many' && /BATTERY_MARK_REQUIRED/.test(noMark.err ?? '') &&
    /EVIDENCE_REQUIRED/.test(noPhotos.err ?? '') && /NOT_UPLOADED/.test(notUploaded.err ?? '') && canUp === true && custUp === false && /INVALID_PATH/.test(wrongPath.err ?? ''),
    'closing needs every item scanned, the battery mark for dangerous goods and the three photos (uploaded to the private bucket for this order)');
  ok(closed1.status === 'packed' && (await ord(o1.id)).battery_mark === true && Number(ret.n) === 3 && ret.d.days === 90,
    `${o1.code} packed; its photos are kept 90 days (default retention)`);
  await as(custA, 'aal1');
  const proof = (await one(`select wh_portal_proof($1) r`, [o1.code])).r;
  const readA = (await one(`select wh_evidence_can_read($1) v`, [photos1[0]])).v;
  await as(custB, 'aal1');
  const proofB = await tryq(`select wh_portal_proof($1)`, [o1.code]);
  const readB = (await one(`select wh_evidence_can_read($1) v`, [photos1[0]])).v;
  await owner();
  ok(proof.packed && proof.weight_check === 'within' && proof.evidence.length === 3 && proof.scans.length === 4 && !JSON.stringify(proof).match(/W3a (packer|sup)/) &&
    readA === true && /NOT_FOUND/.test(proofB.err ?? '') && readB === false,
    'the client sees its own proof (photos, weight check, scan log; no staff names); another client gets nothing and cannot read the photos');

  // ── 5. override: PIN, 3-strike lock, admin unlock ──
  await as(packer);
  await db.query(`select wh_start_pick($1)`, [o4.id]);
  await db.query(`select wh_pick_scan($1, $2, 'W3A-LAMP', 1)`, [o4.id, `${rack}-01-02`]);
  await db.query(`select wh_pack_scan($1, 'W3A-LAMP')`, [o4.id]);
  await db.query(`select wh_pack_set_box($1, $2)`, [o4.id, box.id]);
  const w4 = (await one(`select wh_pack_weigh($1, 600) r`, [o4.id])).r;
  await owner();
  const photos4 = [path(o4, 'contents'), path(o4, 'sealed'), path(o4, 'scale')];
  for (const p of photos4) await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-evidence', $1, $2)`, [p, packer]);
  await as(packer);
  for (const [i, k] of ['contents', 'sealed', 'scale'].entries()) await db.query(`select wh_add_evidence($1, $2, $3)`, [o4.id, k, photos4[i]]);
  const outClose = await tryq(`select wh_pack_close($1, false)`, [o4.id]);
  const packerPin = await tryq(`select wh_set_my_pin('4826')`);
  await as(sup);
  const weak1 = await tryq(`select wh_set_my_pin('1234')`);
  const weak2 = await tryq(`select wh_set_my_pin('1111')`);
  await db.query(`select wh_set_my_pin('4826')`);
  await owner();
  const hash = (await one(`select pin_hash from wh_supervisor_pins where user_id = $1`, [sup])).pin_hash;
  await as(packer);
  const pinRead = await tryq(`select pin_hash from wh_supervisor_pins`);
  const packerApproves = await tryq(`select wh_weight_override($1, $2, '4826', 'heavier box')`, [o4.id, packer]);
  const noReason = await tryq(`select wh_weight_override($1, $2, '4826', ' ')`, [o4.id, sup]);
  const bad1 = (await one(`select wh_weight_override($1, $2, '9999', 'heavier box') r`, [o4.id, sup])).r;
  const bad2 = (await one(`select wh_weight_override($1, $2, '9998', 'heavier box') r`, [o4.id, sup])).r;
  const bad3 = (await one(`select wh_weight_override($1, $2, '9997', 'heavier box') r`, [o4.id, sup])).r;
  const lockedRight = await tryq(`select wh_weight_override($1, $2, '4826', 'heavier box')`, [o4.id, sup]);
  await owner();
  const attempts = await all(`select ok from wh_override_attempts where order_id = $1`, [o4.id]);
  const o4locked = await ord(o4.id);
  ok(w4.within === false && w4.expected_g === 550 && w4.tolerance_g === 28 && /WEIGHT_OUT_OF_TOLERANCE/.test(outClose.err ?? ''),
    'a parcel outside tolerance (600 g vs 550 ± 28 g) cannot close');
  ok(/FORBIDDEN/.test(packerPin.err ?? '') && /WEAK_PIN/.test(weak1.err ?? '') && /WEAK_PIN/.test(weak2.err ?? '') && /^\$2[aby]\$/.test(hash) && !hash.includes('4826') &&
    /permission denied/.test(pinRead.err ?? '') && /SUPERVISOR_REQUIRED/.test(packerApproves.err ?? '') && /REASON_REQUIRED/.test(noReason.err ?? ''),
    'packers cannot set a PIN or approve; weak PINs refused; the PIN is stored as a bcrypt hash nobody can read; a reason is required');
  ok(bad1.ok === false && bad1.attempts_left === 2 && bad2.attempts_left === 1 && bad3.locked === true && /OVERRIDE_LOCKED/.test(lockedRight.err ?? '') &&
    attempts.length === 3 && attempts.every((a) => a.ok === false) && o4locked.override_locked_at !== null && o4locked.override_by === null,
    'three wrong PINs are recorded (not rolled back) and lock the override; even the right PIN is then refused');
  await as(sup);
  const supUnlock = await tryq(`select wh_unlock_override($1, 'try')`, [o4.id]);
  await as(whAdmin);
  const unlockNoReason = await tryq(`select wh_unlock_override($1, ' ')`, [o4.id]);
  await db.query(`select wh_unlock_override($1, 'Supervisor mistyped; verified in person')`, [o4.id]);
  // two people: a supervisor who weighed the parcel cannot approve it (refused before the PIN; no attempt counted)
  await as(sup);
  await db.query(`select wh_pack_weigh($1, 600)`, [o4.id]);
  const selfApprove = await tryq(`select wh_weight_override($1, $2, '4826', 'my own parcel')`, [o4.id, sup]);
  const supSeesSelf = (await one(`select wh_order_detail($1) d`, [o4.code])).d.supervisors.some((x) => x.id === sup);
  await as(packer);
  await db.query(`select wh_pack_weigh($1, 600)`, [o4.id]);
  const good = (await one(`select wh_weight_override($1, $2, '4826', 'Protective padding added') r`, [o4.id, sup])).r;
  await db.query(`select wh_pack_weigh($1, 610)`, [o4.id]);
  const voided = await tryq(`select wh_pack_close($1, false)`, [o4.id]);
  await db.query(`select wh_pack_weigh($1, 600)`, [o4.id]);
  const good2 = (await one(`select wh_weight_override($1, $2, '4826', 'Protective padding added') r`, [o4.id, sup])).r;
  await as(sup);
  const approverCloses = await tryq(`select wh_pack_close($1, false)`, [o4.id]);
  await owner();
  const checkSame = await tryq(`update wh_orders set weighed_by = override_by where id = $1`, [o4.id]);
  await as(packer);
  const closed4 = (await one(`select wh_pack_close($1, false) r`, [o4.id])).r;
  await owner();
  const o4done = await ord(o4.id);
  const attemptsAfter = Number((await one(`select count(*) n from wh_override_attempts where order_id = $1`, [o4.id])).n);
  ok(/TWO_PERSON_REQUIRED/.test(selfApprove.err ?? '') && supSeesSelf === false && /TWO_PERSON_REQUIRED/.test(approverCloses.err ?? '') &&
    /wh_orders_override_two_person/.test(checkSame.err ?? '') && attemptsAfter === 5 && o4done.weighed_by === packer && o4done.packed_by === packer,
    'two people: the supervisor who weighed cannot approve (not offered, refused, no attempt counted); the approver cannot close; the CHECK refuses approver = weigher');
  ok(/FORBIDDEN/.test(supUnlock.err ?? '') && /REASON_REQUIRED/.test(unlockNoReason.err ?? '') && good.ok === true && /WEIGHT_OUT_OF_TOLERANCE/.test(voided.err ?? '') &&
    good2.ok === true && closed4.status === 'packed' && o4done.override_by === sup && o4done.override_weight_g === 600 && o4done.override_reason === 'Protective padding added',
    'only a warehouse admin unlocks (with a reason); the supervisor PIN + reason approves; a new weight voids the approval; then it packs');

  // ── 6. short pick, exceptions, cancels, waiting orders ──
  await as(packer);
  await db.query(`select wh_start_pick($1)`, [o5.id]);
  const p5 = (await one(`select wh_pick_scan($1, $2, 'W3A-LAMP', 1) r`, [o5.id, `${rack}-01-02`])).r; // last unit of the older lot
  const line5 = (await one(`select id from wh_order_lines where order_id = $1`, [o5.id])).id;
  await db.query(`select wh_report_short($1, $2, 'Bin 01-02 empty')`, [o5.id, line5]);
  const packerResolve = await tryq(`select wh_resolve_exception($1, 'ship_short', 'x')`, [o5.id]);
  await as(sup);
  const resolved = (await one(`select wh_resolve_exception($1, 'ship_short', 'Client agreed to ship 1') r`, [o5.id])).r;
  await owner();
  const over = await tryq(`select wh_post_order_movement($1, $2, 'pick', 1, 'test', 'FS-01')`, [o5.id, iLamp]);
  ok(p5.ok === true && /FORBIDDEN/.test(packerResolve.err ?? '') && resolved.status === 'picked' && (await resv(o5.id)) === 0 && /RESERVATION_EXCEEDED/.test(over.err ?? ''),
    'short pick → exception; only a supervisor resolves; ship short releases the missing unit; never more than reserved is picked');
  await as(custA, 'aal1');
  await db.query(`select wh_cancel_order($1, null)`, [o6.id]);
  const retry = (await one(`select wh_retry_allocation($1) r`, [o2.id])).r;
  await db.query(`select wh_cancel_order($1, null)`, [o2.id]);
  const pickedCancel = await tryq(`select wh_cancel_order($1, null)`, [o1.id]);
  await owner();
  ok((await ord(o6.id)).status === 'cancelled' && (await resv(o6.id)) === 0 && (await stock('FS-01', iHub)).r === 0 && retry.allocated === false && (await ord(o2.id)).status === 'cancelled' &&
    /ORDER_LOCKED|UNITS_PICKED/.test(pickedCancel.err ?? ''),
    'clients cancel before picking (reservation released); a waiting order stays waiting; picked orders cannot be cancelled by the client');

  // ── 7. Dropship import ──
  const variant = await one(`select v.id, v.product_id, v.item_id, v.model_no from dropship_variants v where v.item_id is not null order by v.id limit 1`);
  if (!variant) {
    ok(true, 'Dropship import: skipped (no dropship variant with an item on staging)');
  } else {
    const merch = await mkUser('merchant');
    const morg = (await one(`insert into organizations(name, country, is_seed) values ('W3a Merchant', 'US', true) returning id`)).id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [morg, merch]);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on') on conflict (org_id, service) do update set status = 'on'`, [morg]);
    const so = (await one(`insert into store_orders (org_id, channel, buyer_name, buyer_phone, shipping_address, destination_country, buyer_currency, shipping_method)
      values ($1, 'manual', 'Bob Buyer', '+1 555 0100', '{"address1":"1 Main St","city":"Austin","state":"TX","zip":"73301"}'::jsonb, 'US', 'USD', 'standard') returning id, order_number`, [morg]));
    const soi = (await one(`insert into store_order_items (store_order_id, product_id, variant_id, item_id, model_no, title_snapshot, fulfilment_type, qty, unit_product_cents, line_product_cents, declared_usd_cents)
      values ($1, $2, $3, $4, coalesce($5, 'W3A-DS'), 'W3a dropship item', 'fast_ship', 2, 0, 0, 0) returning id`, [so.id, variant.product_id, variant.id, variant.item_id, variant.model_no])).id;
    await db.query(`select record_warehouse_stock_movement($1, 'adjust_in', 5, 'W3a test', 'SZ-01', null)`, [variant.item_id]);
    await db.query(`select record_warehouse_stock_movement($1, 'adjust_in', 5, 'W3a test', 'FS-01', null)`, [variant.item_id]);
    await db.query(`select record_warehouse_stock_movement($1, 'reserve', 2, 'W3a store order paid', 'SZ-01', $2)`, [variant.item_id, so.id]);
    await db.query(`insert into dropship_handoffs (store_order_id, store_order_item_id, handoff_type, to_division_id, warehouse_id, status)
      values ($1, $2, 'warehouse_pick_pack', division_id_of('3PL'), 'SZ-01', 'reserved')`, [so.id, soi]);
    const szBefore = await stock('SZ-01', variant.item_id);
    const fsBefore = await stock('FS-01', variant.item_id);
    await as(custA, 'aal1');
    const custImport = await tryq(`select wh_import_dropship_order($1)`, [so.id]);
    await as(packer);
    const board = (await one(`select wh_orders_board('FS-01', 'open', null, null) r`)).r;
    const imp = (await one(`select wh_import_dropship_order($1) r`, [so.id])).r;
    const again2 = (await one(`select wh_import_dropship_order($1) r`, [so.id])).r;
    await db.query(`select wh_start_pick($1)`, [imp.id]);
    const dsPick = (await one(`select wh_pick_scan($1, $2, $3, 1) r`, [imp.id, `${rack}-01-01`, variant.model_no ?? 'W3A-DS'])).r;
    await owner();
    const dso = await ord(imp.id);
    const openStoreReserve = Number((await one(`select count(*) n from warehouse_stock_movements m where m.store_order_id = $1 and m.kind = 'reserve'
      and not exists (select 1 from warehouse_stock_movements m2 where m2.store_order_id = m.store_order_id and m2.warehouse_id = m.warehouse_id and m2.item_id = m.item_id and m2.kind in ('release', 'pick'))`, [so.id])).n);
    await as(merch, 'aal1');
    const merchSees = (await all(`select 1 from wh_orders`)).length;
    await owner();
    ok(/FORBIDDEN/.test(custImport.err ?? '') && board.dropship_ready.some((d) => d.order_number === so.order_number) && imp.status === 'allocated' && imp.warehouse === 'FS-01' &&
      again2.existing === true && dso.source === 'dropship' && dso.org_id === null && dso.ship_name === 'Bob Buyer',
      `Dropship ${so.order_number} shows as handed over and becomes ${imp.code} (Octopus stock, no client owner), routed to the active FS-01; importing twice returns the same order`);
    ok((await stock('SZ-01', variant.item_id)).r === szBefore.r - 2 && (await stock('FS-01', variant.item_id)).r === fsBefore.r + 2 && openStoreReserve === 0 && (await resv(imp.id)) === 2,
      'the reservation moved from the store order (released at SZ-01) to the warehouse order (reserved at FS-01): the Dropship consumers find nothing left to pick or release');
    ok(dsPick.ok === false && dsPick.result === 'not_in_bin' && /put away/.test(dsPick.message) && merchSees === 0,
      'stock that is not in a bin cannot be picked (put away first); merchants keep using their Dropship screens and see no warehouse order');
    // legacy store-order semantics are unchanged (i2 / step6b assumptions)
    const so2 = (await one(`insert into store_orders (org_id, channel, buyer_name, shipping_address, destination_country, buyer_currency, shipping_method)
      values ($1, 'manual', 'C', '{}'::jsonb, 'US', 'USD', 'standard') returning id`, [morg])).id;
    await db.query(`select record_warehouse_stock_movement($1, 'reserve', 2, 'legacy', 'SZ-01', $2)`, [variant.item_id, so2]);
    const mismatch = await tryq(`select record_warehouse_stock_movement($1, 'pick', 1, 'legacy', 'SZ-01', $2)`, [variant.item_id, so2]);
    const legacyPick = (await one(`select record_warehouse_stock_movement($1, 'pick', 2, 'legacy', 'SZ-01', $2) r`, [variant.item_id, so2])).r;
    const legacyAgain = (await one(`select record_warehouse_stock_movement($1, 'pick', 2, 'legacy', 'SZ-01', $2) r`, [variant.item_id, so2])).r;
    await as(packer);
    const noOrder = await tryq(`select record_warehouse_stock_movement($1, 'reserve', 1, 'x', 'FS-01', null)`, [variant.item_id]);
    await owner();
    ok(/RESERVATION_QTY_MISMATCH/.test(mismatch.err ?? '') && legacyPick.idempotent === false && legacyAgain.idempotent === true && /STORE_ORDER_REQUIRED|FORBIDDEN/.test(noOrder.err ?? ''),
      'legacy store-order movements keep their rules (exact quantity, idempotent pick, order required)');
    await as(sup);
    const supCancel = await tryq(`select wh_cancel_order($1, 'W3a test cleanup')`, [imp.id]);
    await owner();
    ok(!supCancel.err && (await resv(imp.id)) === 0, 'a supervisor cancels a Dropship warehouse order before picking; its reservation is released');
  }

  // ── 8. settings, audit, ledger ──
  await as(sup);
  const supSettings = await tryq(`select wh_save_settings('FS-01', 10, 2, 30)`);
  await as(whAdmin);
  await db.query(`select wh_save_settings('FS-01', 10, 2, 30)`);
  const badSettings = await tryq(`select wh_save_settings('FS-01', 10, 2, 3)`);
  const pb = (await one(`select wh_pack_board('FS-01') r`)).r;
  await owner();
  const st = pb.stations.find((s) => s.warehouse_code === 'FS-01');
  ok(/FORBIDDEN/.test(supSettings.err ?? '') && /INVALID_RETENTION/.test(badSettings.err ?? '') && st?.tolerance_g === 10 && Number(st?.retention_days) === 30,
    'packing settings (tolerance, retention) are changed only by a warehouse admin, within limits');
  const actions = (await all(`select action, count(*)::int n from audit_log where entity = 'wh_orders' and entity_id = any($1) group by 1`, [[o1.id, o4.id, o5.id]]))
    .reduce((m, r) => ({ ...m, [r.action]: r.n }), {});
  ok(['wh_order.created', 'wh_order.allocated', 'wh_order.picking', 'wh_order.pick_recorded', 'wh_order.picked', 'wh_order.packing', 'wh_order.box_chosen',
    'wh_order.weighed', 'wh_order.evidence_added', 'wh_order.packed', 'wh_order.short_pick', 'wh_order.exception_resolved', 'wh_override.approved', 'wh_override.unlocked'].every((a) => actions[a] > 0) &&
    actions['wh_override.pin_wrong'] === 3 && actions['wh_override.locked'] === 1 &&
    Number((await one(`select count(*) n from audit_log where action like 'wh\\_order.%' or action like 'wh\\_override.%'`)).n) > auditBefore,
    'every step is audit-logged (3 wrong PINs, 1 lock, unlock, approval included)');
  const items = [iLamp, iHub, iNow, ...(variant ? [variant.item_id] : [])];
  const mismatches = await all(`
    select ws.warehouse_id, ws.item_id from warehouse_stock ws left join warehouse_stock_movements m on m.warehouse_id = ws.warehouse_id and m.item_id = ws.item_id
     where ws.item_id = any($1) group by ws.warehouse_id, ws.item_id, ws.on_hand_qty, ws.reserved_qty
    having ws.on_hand_qty <> coalesce(sum(m.on_hand_delta), 0) or ws.reserved_qty <> coalesce(sum(m.reserved_delta), 0)`, [items]);
  const overPlaced = await all(`select b.warehouse_code, b.item_id from wh_bin_stock b join warehouse_stock s on s.warehouse_id = b.warehouse_code and s.item_id = b.item_id
     where b.item_id = any($1) group by b.warehouse_code, b.item_id, s.on_hand_qty having sum(b.qty) > s.on_hand_qty`, [items]);
  const resvVsLedger = await one(`select (select reserved_qty from warehouse_stock where warehouse_id = 'FS-01' and item_id = $1) r,
    (select coalesce(sum(case kind when 'reserve' then qty else -qty end), 0) from warehouse_stock_movements where item_id = $1 and warehouse_id = 'FS-01' and wh_order_id is not null and kind in ('reserve','release','pick')) w`, [iLamp]);
  ok(mismatches.length === 0 && overPlaced.length === 0 && Number(resvVsLedger.r) === Number(resvVsLedger.w),
    'ledger balanced (movements = on hand and reserved for every item touched); bins ≤ on hand; reserved = open warehouse-order reservations');

  // the staging demo wipe (inside this rolled-back transaction) removes the demo companies' W3a rows and keeps the ledger
  const wipeSrc = (await one(`select prosrc s from pg_proc where oid = 'public.wipe_demo_data(text,uuid)'::regprocedure`)).s;
  if (variant) await db.query(`update organizations set is_seed = false where name = 'W3a Merchant' and is_seed`); // its store orders are not wiped (as before W3a)
  const movBeforeWipe = Number((await one(`select count(*) n from warehouse_stock_movements where item_id = any($1)`, [items])).n);
  await db.query('savepoint wipe');
  const wiped = await tryq(`select wipe_demo_data('DELETE DEMO DATA FOR ydbxqrizjxpduqbgnwxg', null) c`);
  const leftOrders = Number((await one(`select count(*) n from wh_orders where org_id = any($1)`, [[orgA, orgB]])).n);
  const leftOrgs = Number((await one(`select count(*) n from organizations where id = any($1)`, [[orgA, orgB]])).n);
  const movAfterWipe = Number((await one(`select count(*) n from warehouse_stock_movements where item_id = any($1)`, [items])).n);
  await db.query('rollback to savepoint wipe');
  ok(/delete from wh_orders/.test(wipeSrc) && !wiped.err && Number(wiped.rows[0]?.c?.wh_orders) >= 5 && leftOrders === 0 && leftOrgs === 0 && movAfterWipe === movBeforeWipe,
    `demo wipe removes demo companies' warehouse orders (${wiped.rows[0]?.c?.wh_orders ?? wiped.err}) before their lots and deletes the companies; stock movements stay`);
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  ok(!(await db.query(`select 1 from auth.users where email like 'w3a-%@test.local'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nW3a warehouse: ${failed} check(s) failed` : '\nW3a warehouse: all passed');
process.exitCode = failed ? 1 : 0;
