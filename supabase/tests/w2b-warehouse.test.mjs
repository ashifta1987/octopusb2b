// Warehouse OS · W2b DB checks — bins, pallets, putaway (location sub-ledger), moves, inter-warehouse transfers, labels.
// STAGING ONLY, rolled-back transactions.
//  0. Down → up (migrations applied after W2b — e.g. W3a, which replaces wh_lot_free and references bins and lots — are unwound
//     first and re-applied last): the W2b down removes every W2b object (no function was replaced); up again gives identical
//     functions, grants, policies, columns and triggers.
//  1. Setup: a client receives stock through the real W2a path (notice → slot → check-in → count) so lots are released.
//  2. Bins: putaway role only (packer refused, receiver allowed); range generator (skips existing, ≤ 500); block needs a reason.
//  3. Putaway: on hand never changes; blocked bin refused; never more than the lot has left; pallets keep one owner and one bin;
//     bins never hold more than on hand (deferred constraint checked with SET CONSTRAINTS … IMMEDIATE).
//  4. Moves between bins (FIFO, reason required), pallet moves, units taken off a pallet; archive only when empty.
//  5. Transfers: draft (available checked), cancel only while draft (reason), dispatch = adjust_out at origin + FIFO pick out
//     of bins, receive (receiving staff at the destination) = adjust_in + released unplaced lot; totals balance.
//  6. Labels: anyone with a role at the warehouse logs prints; reprints are audited as reprints; customers refused.
//  7. Staff-only tables (customers see no rows), no direct writes, internal poster not callable. Audit + ledger.
// Run: node --env-file=.env.staging supabase/tests/w2b-warehouse.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
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
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w2b_putaway_labels_transfers(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));
const W2B_TABLES = ['wh_bins', 'wh_pallets', 'wh_bin_stock', 'wh_location_moves', 'wh_transfers', 'wh_transfer_lines', 'wh_transfer_picks', 'wh_label_prints'];

try {
  // ── 0. down → up ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a, md5(p.prosrc) s, pg_get_function_arguments(p.oid) args, p.prosecdef d, p.proconfig::text c
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'wh\\_%' or p.proname = 'record_warehouse_stock_movement') order by 1`),
    pol: await all(`select tablename, policyname, roles, cmd, qual from pg_policies where schemaname = 'public' and tablename like 'wh\\_%' order by 1, 2`),
    tg: await all(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger
                    where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and (relname like 'wh\\_%' or relname like 'warehouse\\_stock%')) order by 1, 2`),
    tp: await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
                    where table_schema = 'public' and table_name like 'wh\\_%' and grantee in ('anon', 'authenticated') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and table_name like 'wh\\_%' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    col: await all(`select table_name, column_name, column_default, is_nullable, data_type from information_schema.columns
                     where table_schema = 'public' and table_name like 'wh\\_%' order by 1, 2`),
    con: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
                     where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'wh\\_%' order by 1, 2`),
    idx: await all(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'wh\\_%' order by 1, 2`),
    seq: await all(`select sequencename from pg_sequences where schemaname = 'public' and sequencename like 'seq\\_wh\\_%' order by 1`),
  });
  const upFile = mig('supabase/migrations');
  const downFile = mig('supabase/migrations/down');
  ok(Boolean(upFile && downFile), `W2b migration files found (${upFile} / ${downFile})`);
  const after = await snap();
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, upFile);
  await unwind(db, later);
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const leftovers = await all(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [[...W2B_TABLES, 'seq_wh_pallet', 'seq_wh_transfer']]);
  const leftFns = await all(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`,
    [['wh_check_placement', 'wh_post_movement', 'wh_lot_free', 'wh_take_from_bin', 'wh_add_to_bin', 'wh_create_bin', 'wh_create_bin_range', 'wh_set_bin_status',
      'wh_create_pallet', 'wh_putaway', 'wh_move_bin_stock', 'wh_move_pallet', 'wh_create_transfer', 'wh_cancel_transfer', 'wh_dispatch_transfer',
      'wh_receive_transfer', 'wh_log_label_print', 'wh_putaway_board', 'wh_transfers_board', 'wh_label_board']]);
  const leftTg = await all(`select tgname from pg_trigger where tgname in ('wh_stock_covers_placement', 'wh_bin_stock_within_on_hand')`);
  ok(leftovers.length === 0 && leftFns.length === 0 && leftTg.length === 0, 'down: every W2b table, sequence, function and trigger is gone');
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  await reapply(db, later);
  const again = await snap();
  if (again !== after) { const a = JSON.parse(after), b = JSON.parse(again); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('  diff in', k); }
  ok(again === after, 'up again: identical functions, grants, policies, columns, constraints, indexes and triggers');
  await db.query('rollback');

  await db.query('begin');
  // ── 1. setup ──
  const mkUser = async (tag, role = null) => {
    const e = `w2b-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`, [id, `W2b ${tag}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  // a second active warehouse (rolled back) so transfers have somewhere to go
  let WH2 = '';
  for (let i = 0; i < 20 && !WH2; i++) {
    const c = `TQ-${String(Math.floor(Math.random() * 90) + 10)}`;
    if (!(await one(`select 1 x from warehouses where code = $1`, [c]))) WH2 = c;
  }
  await db.query(`insert into warehouses (code, name, city, status) values ($1, 'W2b test warehouse', 'Guangzhou', 'active')`, [WH2]);
  const sup = await mkUser('sup', 'warehouse');
  const recv = await mkUser('recv', 'warehouse');
  const recvB = await mkUser('recvb', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'supervisor'), ($2, 'FS-01', 'receiver'),
    ($3, $5, 'receiver'), ($4, 'FS-01', 'packer')`, [sup, recv, recvB, packer, WH2]);
  const org = (await one(`insert into organizations(name, country, is_seed) values ('W2b Client A', 'AE', true) returning id`)).id;
  const cust = await mkUser('cust');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01')`, [org]);
  const auditBefore = Number((await one(`select count(*) n from audit_log where action like 'wh\\_%'`)).n);
  const today = (await one(`select (now() at time zone 'Asia/Shanghai')::date::text d`)).d;

  await as(cust, 'aal1');
  const s1 = (await one(`select wh_save_client_sku($1, null, 'W2B-LAMP', 'Desk lamp', null, 450, false, false) id`, [org])).id;
  const s2 = (await one(`select wh_save_client_sku($1, null, 'W2B-HUB', 'USB-C hub', null, 120, false, false) id`, [org])).id;
  const asn = (await one(`select wh_create_asn($1, 'FS-01', $2::date, 2, null, $3::jsonb, null, 'client') r`,
    [org, today, JSON.stringify([{ sku_id: s1, qty: 10 }, { sku_id: s2, qty: 6 }])])).r;
  await owner();
  const item1 = (await one(`select item_id from wh_client_skus where id = $1`, [s1])).item_id;
  const item2 = (await one(`select item_id from wh_client_skus where id = $1`, [s2])).item_id;
  const tag = String(Math.floor(Math.random() * 90) + 10);
  await as(recv);
  const slot = (await one(`select wh_book_slot('FS-01', $1, $2::date, '08:00'::time, '09:00'::time, $3, null) id`, [`B${tag}X`, today, asn.id])).id;
  await db.query(`select wh_check_in($1)`, [slot]);
  for (const l of await all(`select id, expected_qty from wh_asn_lines where asn_id = $1`, [asn.id])) {
    await db.query(`select wh_count_line($1, $2, 0, null)`, [l.id, l.expected_qty]);
  }
  await owner();
  const L1 = await one(`select id, lot_code, qty, status, org_id from wh_lots where item_id = $1 and warehouse_code = 'FS-01'`, [item1]);
  const L2 = await one(`select id, lot_code, qty, status from wh_lots where item_id = $1 and warehouse_code = 'FS-01'`, [item2]);
  const onHand = async (wh, item) => (await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = $1 and item_id = $2`, [wh, item]))?.on_hand_qty ?? null;
  const placed = async (wh, item) => Number((await one(`select coalesce(sum(qty), 0) n from wh_bin_stock where warehouse_code = $1 and item_id = $2`, [wh, item])).n);
  const movCount = async () => Number((await one(`select count(*) n from warehouse_stock_movements where item_id = any($1)`, [[item1, item2]])).n);
  ok(L1?.status === 'released' && L1.qty === 10 && L2?.qty === 6 && (await onHand('FS-01', item1)) === 10 && L1.org_id === org,
    `setup: lots ${L1?.lot_code} (10) and ${L2?.lot_code} (6) released through the W2a receiving path; 10 on hand`);

  // ── 2. bins ──
  const rack = `Q${tag}`;
  await as(packer);
  const packerRange = await tryq(`select wh_create_bin_range('FS-01', $1, 1, 2, 1, 3, null)`, [rack]);
  await as(recv);
  const range1 = (await one(`select wh_create_bin_range('FS-01', $1, 1, 2, 1, 3, 'Test zone') r`, [rack.toLowerCase()])).r;
  const range2 = (await one(`select wh_create_bin_range('FS-01', $1, 1, 2, 1, 4, null) r`, [rack])).r;
  const tooMany = await tryq(`select wh_create_bin_range('FS-01', $1, 1, 99, 1, 99, null)`, [rack]);
  const badRange = await tryq(`select wh_create_bin_range('FS-01', $1, 3, 2, 1, 1, null)`, [rack]);
  const badRack = await tryq(`select wh_create_bin_range('FS-01', 'A-1', 1, 1, 1, 1, null)`);
  const dupBin = await tryq(`select wh_create_bin('FS-01', $1, null)`, [`${rack}-01-01`]);
  const badBin = await tryq(`select wh_create_bin('FS-01', 'A1-3', null)`);
  const single = (await one(`select wh_create_bin('FS-01', $1, null) id`, [`${rack}-09-09`])).id;
  const legacyBin = await tryq(`select wh_create_bin('SZ-01', 'A-01-01', null)`);
  await owner();
  const bin = async (code) => (await one(`select id from wh_bins where warehouse_code = 'FS-01' and code = $1`, [code])).id;
  const [B1, B2, B3, B4, B5, B6] = await Promise.all(['01-01', '01-02', '01-03', '02-01', '02-02', '02-03'].map((s) => bin(`${rack}-${s}`)));
  ok(/FORBIDDEN/.test(packerRange.err ?? '') && range1.created === 6 && range1.first === `${rack}-01-01` && range1.last === `${rack}-02-03` &&
    range2.created === 2 && range2.skipped === 6 && /TOO_MANY_BINS/.test(tooMany.err ?? '') && /INVALID_RANGE/.test(badRange.err ?? '') &&
    /INVALID_RACK/.test(badRack.err ?? '') && /DUPLICATE_BIN/.test(dupBin.err ?? '') && /INVALID_BIN/.test(badBin.err ?? '') && single &&
    /FORBIDDEN|WAREHOUSE_NOT_OPEN/.test(legacyBin.err ?? ''),
    'bins: receivers create single bins and rack-row-bin ranges (existing skipped, ≤ 500, valid codes); packers refused');
  await as(recv);
  const blockNoReason = await tryq(`select wh_set_bin_status($1, 'blocked', null)`, [B3]);
  await db.query(`select wh_set_bin_status($1, 'blocked', 'Damaged beam')`, [B3]);
  await owner();
  ok(/REASON_REQUIRED/.test(blockNoReason.err ?? '') && (await one(`select status, block_reason from wh_bins where id = $1`, [B3])).block_reason === 'Damaged beam',
    'a bin is blocked only with a reason');

  // ── 3. putaway ──
  const movBefore = await movCount();
  await as(packer);
  const packerPut = await tryq(`select wh_putaway($1, $2, 1, null)`, [L1.id, B1]);
  await as(recv);
  const put1 = (await one(`select wh_putaway($1, $2, 6, null) r`, [L1.id, B1])).r;
  const blockedPut = await tryq(`select wh_putaway($1, $2, 1, null)`, [L1.id, B3]);
  const tooMuch = await tryq(`select wh_putaway($1, $2, 5, null)`, [L1.id, B2]);
  const zero = await tryq(`select wh_putaway($1, $2, 0, null)`, [L1.id, B2]);
  const pal = (await one(`select wh_create_pallet('FS-01', $1, null, 'Top load') r`, [asn.id])).r;
  const octoPal = (await one(`select wh_create_pallet('FS-01', null, null, null) r`)).r;
  const put2 = (await one(`select wh_putaway($1, $2, 4, $3) r`, [L1.id, B2, pal.id])).r;
  const otherBin = await tryq(`select wh_putaway($1, $2, 1, $3)`, [L2.id, B1, pal.id]);
  const wrongOwner = await tryq(`select wh_putaway($1, $2, 1, $3)`, [L2.id, B1, octoPal.id]);
  await owner();
  const palRow = await one(`select status, bin_id, org_id from wh_pallets where id = $1`, [pal.id]);
  ok(/FORBIDDEN/.test(packerPut.err ?? '') && put1.left === 4 && put2.left === 0 && /BIN_BLOCKED/.test(blockedPut.err ?? '') &&
    /NOT_ENOUGH_UNPLACED/.test(tooMuch.err ?? '') && /INVALID_QTY/.test(zero.err ?? ''),
    'putaway: receivers only; a blocked bin refuses stock; never more than the lot has left');
  ok(/^PAL-\d{5,}$/.test(pal.code) && palRow.status === 'stored' && palRow.bin_id === B2 && palRow.org_id === org &&
    /PALLET_IN_OTHER_BIN/.test(otherBin.err ?? '') && /PALLET_OWNER_MISMATCH/.test(wrongOwner.err ?? ''),
    `pallets (${pal.code}) take the notice's owner, become stored in one bin, and never mix owners`);
  ok((await onHand('FS-01', item1)) === 10 && (await movCount()) === movBefore && (await placed('FS-01', item1)) === 10,
    'putaway changes placement only: on hand stays 10, no stock movement, 10 placed');
  await db.query(`set constraints all immediate`);
  await db.query(`set constraints all deferred`);
  const over = await tryq(`select record_warehouse_stock_movement('${item1}', 'adjust_out', 1, 'W2b test', 'FS-01', null); set constraints all immediate;`);
  await db.query(`set constraints all deferred`);
  ok(/PLACEMENT_EXCEEDS_ON_HAND/.test(over.err ?? '') && (await onHand('FS-01', item1)) === 10,
    'bins never hold more than on hand: taking stock out under placed units fails at commit (deferred constraint)');

  // ── 4. moves ──
  await as(recv);
  const mv1 = (await one(`select wh_move_bin_stock($1, $2, $3, null, 2, 'Fast mover') r`, [B1, B4, item1])).r;
  const mvBlocked = await tryq(`select wh_move_bin_stock($1, $2, $3, null, 1, 'x')`, [B1, B3, item1]);
  const mvNoReason = await tryq(`select wh_move_bin_stock($1, $2, $3, null, 1, ' ')`, [B1, B4, item1]);
  const mvTooMany = await tryq(`select wh_move_bin_stock($1, $2, $3, null, 9, 'x')`, [B1, B4, item1]);
  const mvSame = await tryq(`select wh_move_bin_stock($1, $1, $2, null, 1, 'x')`, [B1, item1]);
  const palMove = (await one(`select wh_move_pallet($1, $2, 'Rack swap') r`, [pal.id, B5])).r;
  const offPallet = (await one(`select wh_move_bin_stock($1, $2, $3, $4, 1, 'Pick face') r`, [B5, B4, item1, L1.id])).r;
  const palAfterOne = (await one(`select status from wh_pallets where id = $1`, [pal.id])).status;
  await db.query(`select wh_move_bin_stock($1, $2, $3, $4, 3, 'Break down')`, [B5, B4, item1, L1.id]);
  const archFull = await tryq(`select wh_set_bin_status($1, 'archived', null)`, [B4]);
  await db.query(`select wh_set_bin_status($1, 'archived', null)`, [B6]);
  await as(packer);
  const packerMove = await tryq(`select wh_move_bin_stock($1, $2, $3, null, 1, 'x')`, [B1, B4, item1]);
  await owner();
  const palEnd = await one(`select status, bin_id from wh_pallets where id = $1`, [pal.id]);
  const byBin = Object.fromEntries((await all(`select bin_id, sum(qty)::int n from wh_bin_stock where item_id = $1 group by 1`, [item1])).map((r) => [r.bin_id, r.n]));
  ok(mv1.qty === 2 && /BIN_BLOCKED/.test(mvBlocked.err ?? '') && /REASON_REQUIRED/.test(mvNoReason.err ?? '') && /NOT_ENOUGH_IN_BIN/.test(mvTooMany.err ?? '') &&
    /SAME_BIN/.test(mvSame.err ?? '') && /FORBIDDEN/.test(packerMove.err ?? ''),
    'moves: reason required, blocked bins refused, never more than the bin holds; packers refused');
  ok(palMove.to === `${rack}-02-02` && offPallet.qty === 1 && palAfterOne === 'stored' && palEnd.status === 'broken' && palEnd.bin_id === null &&
    byBin[B1] === 4 && byBin[B4] === 6 && !byBin[B2] && !byBin[B5] && (await placed('FS-01', item1)) === 10 && (await onHand('FS-01', item1)) === 10,
    'a pallet moves with everything on it; units taken off arrive loose; an emptied pallet is broken down; totals unchanged');
  ok(/BIN_NOT_EMPTY/.test(archFull.err ?? '') && (await one(`select status from wh_bins where id = $1`, [B6])).status === 'archived',
    'only an empty bin can be archived');
  const moves = Number((await one(`select count(*) n from wh_location_moves where lot_id = $1`, [L1.id])).n);
  ok(moves >= 6, `placement history kept (${moves} moves for ${L1.lot_code})`);

  // ── 5. transfers ──
  const lines = (arr) => JSON.stringify(arr.map(([item_id, qty]) => ({ item_id, qty })));
  await as(packer);
  const packerTrf = await tryq(`select wh_create_transfer('FS-01', $1, $2::jsonb, null)`, [WH2, lines([[item1, 1]])]);
  await as(recv);
  const sameWh = await tryq(`select wh_create_transfer('FS-01', 'FS-01', $1::jsonb, null)`, [lines([[item1, 1]])]);
  const legacyTo = await tryq(`select wh_create_transfer('FS-01', 'SZ-01', $1::jsonb, null)`, [lines([[item1, 1]])]);
  const tooBig = await tryq(`select wh_create_transfer('FS-01', $1, $2::jsonb, null)`, [WH2, lines([[item1, 11]])]);
  const dupLine = await tryq(`select wh_create_transfer('FS-01', $1, $2::jsonb, null)`, [WH2, lines([[item1, 1], [item1, 2]])]);
  const t1 = (await one(`select wh_create_transfer('FS-01', $1, $2::jsonb, 'Rebalance') r`, [WH2, lines([[item1, 5]])])).r;
  const t2 = (await one(`select wh_create_transfer('FS-01', $1, $2::jsonb, null) r`, [WH2, lines([[item1, 1]])])).r;
  const t3 = (await one(`select wh_create_transfer('FS-01', $1, $2::jsonb, null) r`, [WH2, lines([[item2, 3]])])).r;
  const cancelNoReason = await tryq(`select wh_cancel_transfer($1, null)`, [t2.id]);
  await db.query(`select wh_cancel_transfer($1, 'Wrong product')`, [t2.id]);
  const dispatchCancelled = await tryq(`select wh_dispatch_transfer($1)`, [t2.id]);
  const notPlaced = await tryq(`select wh_dispatch_transfer($1)`, [t3.id]);
  await owner();
  const movBeforeDispatch = await movCount(); // counted as the owner: receivers can't read the stock ledger
  await as(recvB);
  const otherDispatch = await tryq(`select wh_dispatch_transfer($1)`, [t1.id]);
  const earlyReceive = await tryq(`select wh_receive_transfer($1)`, [t1.id]);
  await as(recv);
  const disp = (await one(`select wh_dispatch_transfer($1) r`, [t1.id])).r;
  const originReceive = await tryq(`select wh_receive_transfer($1)`, [t1.id]);
  const cancelInTransit = await tryq(`select wh_cancel_transfer($1, 'late')`, [t1.id]);
  await owner();
  const t3s = (await one(`select status from wh_transfers where id = $1`, [t3.id])).status;
  const outMov = await all(`select kind, qty, reason, actor_id, warehouse_id from warehouse_stock_movements where item_id = $1 and reason like 'transfer %' order by created_at`, [item1]);
  const picks = await all(`select k.qty, k.bin_id, k.lot_id from wh_transfer_picks k join wh_transfer_lines l on l.id = k.line_id where l.transfer_id = $1 order by k.qty desc`, [t1.id]);
  ok(/^TRF-\d{4,}$/.test(t1.code) && /FORBIDDEN/.test(packerTrf.err ?? '') && /SAME_WAREHOUSE/.test(sameWh.err ?? '') && /WAREHOUSE_NOT_ACTIVE/.test(legacyTo.err ?? '') &&
    /INSUFFICIENT_AVAILABLE_STOCK/.test(tooBig.err ?? '') && /DUPLICATE_LINE/.test(dupLine.err ?? ''),
    `transfer drafts (${t1.code}): putaway staff at the origin, two different active warehouses, within available stock`);
  ok(/REASON_REQUIRED/.test(cancelNoReason.err ?? '') && (await one(`select status, cancel_reason from wh_transfers where id = $1`, [t2.id])).status === 'cancelled' &&
    /INVALID_STEP/.test(dispatchCancelled.err ?? '') && /TRANSFER_LOCKED/.test(cancelInTransit.err ?? ''),
    'a transfer is cancelled only while it is a draft, with a reason; a cancelled transfer can’t be dispatched');
  ok(/NOT_PLACED/.test(notPlaced.err ?? '') && t3s === 'draft' && /FORBIDDEN/.test(otherDispatch.err ?? '') && /INVALID_STEP/.test(earlyReceive.err ?? '') &&
    /FORBIDDEN/.test(originReceive.err ?? ''),
    'dispatch needs the units in bins (nothing posted when refused) and origin staff; only destination receivers receive');
  ok(disp.code === t1.code && outMov.length === 1 && outMov[0].kind === 'adjust_out' && outMov[0].qty === 5 && outMov[0].reason === `transfer ${t1.code} out` &&
    outMov[0].actor_id === recv && outMov[0].warehouse_id === 'FS-01' && (await movCount()) === movBeforeDispatch + 1 &&
    (await onHand('FS-01', item1)) === 5 && (await placed('FS-01', item1)) === 5 &&
    picks.reduce((s, p) => s + p.qty, 0) === 5 && picks[0].bin_id === B1 && picks[0].qty === 4 && picks.every((p) => p.lot_id === L1.id),
    'dispatch: one adjust_out at the origin (actor = dispatcher) and a FIFO pick out of the bins (loose, then by bin): on hand 5, placed 5');

  await as(recvB);
  const rec = (await one(`select wh_receive_transfer($1) r`, [t1.id])).r;
  const recvAgain = await tryq(`select wh_receive_transfer($1)`, [t1.id]);
  const boardB = (await one(`select wh_putaway_board($1) b`, [WH2])).b;
  await owner();
  const destLot = await one(`select t.lot_code, t.qty, t.status, t.org_id, t.warehouse_code, t.asn_line_id from wh_transfer_lines l join wh_lots t on t.id = l.dest_lot_id where l.transfer_id = $1`, [t1.id]);
  const inMov = await one(`select kind, qty, reason, actor_id from warehouse_stock_movements where item_id = $1 and warehouse_id = $2`, [item1, WH2]);
  const total = Number((await one(`select sum(on_hand_qty) n from warehouse_stock where item_id = $1`, [item1])).n);
  const net = Number((await one(`select sum(on_hand_delta) n from warehouse_stock_movements where item_id = $1`, [item1])).n);
  ok(rec.code === t1.code && destLot?.qty === 5 && destLot.status === 'released' && destLot.org_id === org && destLot.warehouse_code === WH2 && destLot.asn_line_id === null &&
    inMov?.kind === 'adjust_in' && inMov.qty === 5 && inMov.reason === `transfer ${t1.code} in · ${destLot.lot_code}` && inMov.actor_id === recvB &&
    (await onHand(WH2, item1)) === 5 && /INVALID_STEP/.test(recvAgain.err ?? ''),
    `receive: adjust_in at ${WH2} (actor = receiver) and a released lot ${destLot?.lot_code} with the same owner`);
  ok(boardB.unplaced.some((l) => l.lot_code === destLot?.lot_code && l.free === 5) && (await placed(WH2, item1)) === 0,
    'the received lot is unplaced at the destination, ready for putaway');
  ok(total === 10 && net === 10 && (await one(`select status, received_by, dispatched_by from wh_transfers where id = $1`, [t1.id])).received_by === recvB,
    'paired movements balance: 10 units in total across warehouses, ledger deltas = on hand');

  // ── 6. labels ──
  await as(packer);
  const n1 = (await one(`select wh_log_label_print('FS-01', 'bin', array[$1, $2], 2) n`, [`${rack}-01-01`, `${rack}-01-02`])).n;
  const n2 = (await one(`select wh_log_label_print('FS-01', 'bin', array[$1], 1) n`, [`${rack.toLowerCase()}-01-01`])).n;
  const badRef = await tryq(`select wh_log_label_print('FS-01', 'pallet', array['bad ref'], 1)`);
  const badCopies = await tryq(`select wh_log_label_print('FS-01', 'pallet', array[$1], 0)`, [pal.code]);
  const otherWh = await tryq(`select wh_log_label_print($1, 'bin', array['A-01-01'], 1)`, [WH2]);
  const lb = (await one(`select wh_label_board('FS-01') b`)).b;
  await as(cust, 'aal1');
  const custPrint = await tryq(`select wh_log_label_print('FS-01', 'bin', array['A-01-01'], 1)`);
  await owner();
  const reprinted = await one(`select count(*)::int n from audit_log where action = 'wh_label.reprinted' and details ->> 'warehouse' = 'FS-01' and created_at >= now() - interval '1 minute'`);
  ok(n1 === 2 && n2 === 1 && /INVALID_LABEL/.test(badRef.err ?? '') && /INVALID_COPIES/.test(badCopies.err ?? '') && /FORBIDDEN/.test(otherWh.err ?? '') &&
    /FORBIDDEN/.test(custPrint.err ?? '') && reprinted.n >= 1 && lb.bins.find((b) => b.code === `${rack}-01-01`)?.printed === 2 &&
    lb.asns.some((a) => a.code === asn.code && a.lines.length === 2),
    'labels: staff with a role there log prints and reprints (audited as reprints); the label board counts them; customers refused');

  // ── 7. security ──
  await as(cust, 'aal1');
  const custRows = {};
  for (const t of W2B_TABLES) custRows[t] = Number((await one(`select count(*) n from ${t}`)).n);
  const custBoard = await tryq(`select wh_putaway_board('FS-01')`);
  const custPut = await tryq(`select wh_putaway($1, $2, 1, null)`, [L2.id, B1]);
  const custOwnLots = Number((await one(`select count(*) n from wh_lots`)).n);
  await as(recv);
  const directBin = await tryq(`insert into wh_bins (warehouse_code, code) values ('FS-01', 'Z-01-01')`);
  const directStock = await tryq(`update wh_bin_stock set qty = qty + 100 where bin_id = $1`, [B1]);
  const poster = await tryq(`select wh_post_movement($1, 'adjust_in', 100, 'x', 'FS-01')`, [item1]);
  const lotFree = await tryq(`select wh_lot_free($1)`, [L1.id]);
  const recvBoard = (await one(`select wh_putaway_board('FS-01') b`)).b;
  await as(recvB);
  const otherWhCan = (await one(`select wh_putaway_board('FS-01') b`)).b.can_putaway;
  const otherWhPut = await tryq(`select wh_putaway($1, $2, 1, null)`, [L2.id, B1]);
  const seesTransfer = Number((await one(`select count(*) n from wh_transfers where id = $1`, [t1.id])).n);
  await owner();
  ok(Object.values(custRows).every((n) => n === 0) && /FORBIDDEN/.test(custBoard.err ?? '') && /FORBIDDEN/.test(custPut.err ?? '') && custOwnLots === 3,
    `customers see no rows in the W2b staff tables (${W2B_TABLES.length}) and can’t call boards or put away; they still see their own lots (3)`);
  ok(/permission denied/.test(directBin.err ?? '') && /permission denied/.test(directStock.err ?? '') && /permission denied/.test(poster.err ?? '') &&
    /permission denied/.test(lotFree.err ?? ''),
    'no direct writes; the internal poster and helpers are not callable by staff');
  ok(recvBoard.can_putaway.includes('FS-01') && recvBoard.unplaced.some((l) => l.lot_code === L2.lot_code && l.free === 6) &&
    recvBoard.bins.some((b) => b.id === B4 && b.units === 5) && recvBoard.bins.some((b) => b.id === B1 && b.units === null) && !recvBoard.bins.some((b) => b.id === B6) && otherWhCan.length === 0 && /FORBIDDEN/.test(otherWhPut.err ?? '') && seesTransfer === 1,
    'boards follow the warehouse (unplaced lots, occupancy); a receiver at another warehouse sees the transfer but can’t put away at FS-01');

  const audit = Number((await one(`select count(*) n from audit_log where action like 'wh\\_%'`)).n) - auditBefore;
  const auditKinds = (await all(`select distinct action from audit_log where action like 'wh\\_%' and created_at >= now() - interval '5 minutes'`)).map((r) => r.action);
  ok(audit >= 25 && ['wh_bin.range_created', 'wh_bin.blocked', 'wh_putaway.recorded', 'wh_pallet.created', 'wh_pallet.moved', 'wh_bin_stock.moved',
    'wh_transfer.created', 'wh_transfer.cancelled', 'wh_transfer.dispatched', 'wh_transfer.received', 'wh_label.printed'].every((a) => auditKinds.includes(a)),
    `every W2b change audit-logged (${audit} wh_ rows in this transaction)`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nw2b-warehouse: ${failed} check(s) failed` : '\nw2b-warehouse: all passed');
process.exitCode = failed ? 1 : 0;
