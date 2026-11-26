// Warehouse OS · W7 DB checks — legacy 3PL data retired (owner, 26 Nov 2026: "remove the old data, follow the new").
// STAGING ONLY, everything in one rolled-back transaction (sequences restored with lib-seq-guard).
//  1. After the up (installed): legacy SZ-01 closed and empty; every moved item has one adjust_out at SZ-01 and one adjust_in
//     at FS-01 of the same quantity (reason 'legacy SZ-01 retired → FS-01') and one released, unplaced, Octopus-owned lot at
//     FS-01; the stock ledger is balanced (sum of movement deltas = stock row) for every touched row; the old 3PL settings
//     are gone, shipping.carrier_* kept; the paid 3PL service requests are untouched; the two Dropship functions no longer
//     name SZ-01 (default warehouse instead); backup tables are staff-invisible (RLS, no grants for anon / authenticated).
//  2. Down: stock back at SZ-01 through opposite paired movements (none deleted), lots removed, SZ-01 'legacy' again, the
//     settings rows back exactly, functions back (SZ-01 default), backup tables gone; ledger still balanced.
//  3. Up again = the state of section 1 (functions identical, same quantities); down again = the state of section 2.
//  4. The down refuses (and changes nothing) once a moved lot was touched in Warehouse OS.
// Run: node --env-file=.env.staging supabase/tests/w7-retire.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
import { snapshotSequences, restoreSequences } from './lib-seq-guard.mjs';

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
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w7_retire_legacy_3pl(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));
const UP_FILE = mig('supabase/migrations');
const DOWN_FILE = mig('supabase/migrations/down');
const up = fs.readFileSync(`supabase/migrations/${UP_FILE}`, 'utf8');
const down = fs.readFileSync(`supabase/migrations/down/${DOWN_FILE}`, 'utf8');
const KEYS = ['3pl.cutoff', '3pl.rates_text', 'warehouses', 'warehouse_os_ui'];
const FNS = ['process_dropship_domain_events', 'get_dropship_variant_stock'];
const REASON = 'legacy SZ-01 retired → FS-01';
let seqs = null;

const fnState = async () => all(`select p.proname n, md5(pg_get_functiondef(p.oid)) d, pg_get_function_arguments(p.oid) a, p.proacl::text acl,
                                        pg_get_functiondef(p.oid) like '%''SZ-01''%' sz
                                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any ($1) order by 1`, [FNS]);
const stockOf = async (wh, items) => Object.fromEntries((await all(`select item_id, on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = $1 and item_id = any ($2::uuid[])`, [wh, items]))
  .map((r) => [r.item_id, Number(r.on_hand_qty)]));
const ledgerBroken = async (items) => all(`
  select s.warehouse_id, s.item_id from warehouse_stock s
    left join warehouse_stock_movements m on m.warehouse_id = s.warehouse_id and m.item_id = s.item_id
   where s.item_id = any ($1::uuid[]) and s.warehouse_id in ('SZ-01', 'FS-01')
   group by s.warehouse_id, s.item_id, s.on_hand_qty, s.reserved_qty
  having coalesce(sum(m.on_hand_delta), 0) <> s.on_hand_qty or coalesce(sum(m.reserved_delta), 0) <> s.reserved_qty`, [items]);
const tableExists = async (t) => Boolean((await one(`select to_regclass($1) r`, [`public.${t}`])).r);

try {
  ok(Boolean(UP_FILE && DOWN_FILE), `W7 migration files found (${UP_FILE ?? '—'} / ${DOWN_FILE ?? '—'})`);
  const applied = (await one(`select count(*)::int n from _migrations where name = $1`, [UP_FILE])).n === 1;
  ok(applied, 'W7 migration is applied on this database');
  seqs = await snapshotSequences(db);
  await db.query('begin');

  // ── 1. after the up ──
  const moves = await all(`select m.*, l.lot_code, l.warehouse_code lot_wh, l.qty lot_qty, l.status lot_status, l.org_id lot_org, l.asn_line_id
                             from w7_legacy_stock_moves m join wh_lots l on l.id = m.lot_id order by m.item_id`);
  const items = moves.map((m) => m.item_id);
  const sz = await one(`select status from warehouses where code = 'SZ-01'`);
  const szLeft = (await one(`select coalesce(sum(on_hand_qty), 0)::int oh, coalesce(sum(reserved_qty), 0)::int r from warehouse_stock where warehouse_id = 'SZ-01'`));
  ok(sz?.status === 'closed' && szLeft.oh === 0 && szLeft.r === 0, `SZ-01 is closed and holds no stock (on hand ${szLeft.oh}, reserved ${szLeft.r})`);
  const movRows = await all(`select id, warehouse_id, item_id, kind, qty, on_hand_delta, reserved_delta, reason from warehouse_stock_movements where id = any ($1::uuid[])`,
    [moves.flatMap((m) => [m.out_movement_id, m.in_movement_id])]);
  const byId = new Map(movRows.map((r) => [r.id, r]));
  const pairsOk = moves.every((m) => {
    const o = byId.get(m.out_movement_id); const i = byId.get(m.in_movement_id);
    return o && i && o.warehouse_id === 'SZ-01' && o.kind === 'adjust_out' && o.qty === m.qty && o.on_hand_delta === -m.qty && o.reason === REASON
      && i.warehouse_id === 'FS-01' && i.kind === 'adjust_in' && i.qty === m.qty && i.on_hand_delta === m.qty && i.reason.startsWith(REASON) && i.reason.includes(m.lot_code)
      && o.item_id === m.item_id && i.item_id === m.item_id;
  });
  ok(pairsOk, `${moves.length} item(s), ${moves.reduce((s, m) => s + m.qty, 0)} unit(s) moved: one adjust_out at SZ-01 + one adjust_in at FS-01 of the same quantity per item`);
  const placed = (await one(`select count(*)::int n from wh_bin_stock where lot_id = any ($1::uuid[])`, [moves.map((m) => m.lot_id)])).n;
  ok(moves.every((m) => m.lot_wh === 'FS-01' && m.lot_qty === m.qty && m.lot_status === 'released' && m.lot_org === null && m.asn_line_id === null) && placed === 0,
    'one released, unplaced, Octopus-owned lot per item at FS-01 (ready for Putaway)');
  ok((await ledgerBroken(items)).length === 0, 'stock ledger balanced for every touched row (sum of movement deltas = stock)');
  const keysLeft = (await all(`select key from site_settings where key = any ($1)`, [KEYS])).map((r) => r.key);
  const carrierKeys = (await one(`select count(*)::int n from site_settings where key in ('shipping.carrier_public_label', 'shipping.carrier_test_passed')`)).n;
  const backups = await all(`select ref, data from w7_retire_backup where kind = 'site_setting' order by ref`);
  ok(keysLeft.length === 0 && backups.every((b) => KEYS.includes(b.ref) && b.data.key === b.ref), `old 3PL settings removed (${backups.map((b) => b.ref).join(', ') || 'none were set'}), each kept in the backup`);
  ok(carrierKeys === (await one(`select count(*)::int n from site_settings where key like 'shipping.carrier\\_%'`)).n, 'shipping.carrier_* settings are kept');
  const srv = await all(`select code, status from service_requests where code in ('SRV-1007', 'SRV-1015') order by code`);
  ok(srv.every((r) => r.status === 'paid'), `paid 3PL service requests untouched (${srv.map((r) => `${r.code} ${r.status}`).join(', ') || 'not on this database'})`);
  const fnUp = await fnState();
  ok(fnUp.length === 2 && fnUp.every((f) => !f.sz) && /DEFAULT (public\.)?default_warehouse_code\(\)/.test(fnUp.find((f) => f.n === 'get_dropship_variant_stock')?.a ?? ''),
    'Dropship functions use the default warehouse (no hard-coded SZ-01; stock lookup defaults to default_warehouse_code())');
  const sec = await all(`select c.relname, c.relrowsecurity rls,
                                has_table_privilege('anon', c.oid, 'select') a, has_table_privilege('authenticated', c.oid, 'select') u
                           from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('w7_legacy_stock_moves', 'w7_retire_backup')`);
  ok(sec.length === 2 && sec.every((r) => r.rls && !r.a && !r.u), 'backup tables: RLS on, nothing granted to anon / authenticated');

  const fsUp = await stockOf('FS-01', items);
  const movCount = async () => (await one(`select count(*)::int n from warehouse_stock_movements where item_id = any ($1::uuid[])`, [items])).n;
  const movBefore = await movCount();

  // ── 4. refusal first (savepoint): a touched lot blocks the down ──
  if (moves.length) {
    await db.query('savepoint touched');
    await db.query(`update wh_lots set qty = qty - 1 where id = $1`, [moves[0].lot_id]);
    const refused = await tryq(down);
    const stillClosed = (await one(`select status from warehouses where code = 'SZ-01'`)).status === 'closed';
    ok(/W7_DOWN_LOT_IN_USE/.test(refused.err ?? '') && stillClosed && (await tableExists('w7_legacy_stock_moves')),
      'down refuses with W7_DOWN_LOT_IN_USE once a moved lot was changed, and changes nothing');
    await db.query('rollback to savepoint touched');
  } else {
    ok(true, 'down refusal: no moved lots on this database (skipped)');
  }

  // ── 2. down ──
  await db.query(down);
  const szDown = await stockOf('SZ-01', items);
  const fsDown = await stockOf('FS-01', items);
  const lotsLeft = (await one(`select count(*)::int n from wh_lots where id = any ($1::uuid[])`, [moves.map((m) => m.lot_id)])).n;
  ok(moves.every((m) => szDown[m.item_id] === m.qty && (fsDown[m.item_id] ?? 0) === (fsUp[m.item_id] ?? 0) - m.qty) && lotsLeft === 0,
    'down: every unit back at SZ-01, FS-01 reduced by the same quantity, the lots removed');
  ok((await movCount()) === movBefore + 2 * moves.length && (await ledgerBroken(items)).length === 0,
    'down: opposite paired movements added (none deleted), ledger still balanced');
  const settingsDown = await all(`select to_jsonb(s) j from site_settings s where key = any ($1) order by key`, [KEYS]);
  ok(JSON.stringify(settingsDown.map((r) => r.j)) === JSON.stringify(backups.map((b) => b.data)), 'down: the old settings rows are back exactly');
  const fnDown = await fnState();
  ok((await one(`select status from warehouses where code = 'SZ-01'`)).status === 'legacy' && !(await tableExists('w7_legacy_stock_moves')) && !(await tableExists('w7_retire_backup'))
     && fnDown.every((f) => f.sz) && fnDown.every((f, i) => f.acl === fnUp[i].acl),
    'down: SZ-01 legacy again, backup tables gone, functions back with SZ-01 (grants unchanged)');

  // ── 3. up again / down again ──
  await db.query(up);
  const fnUp2 = await fnState();
  const moves2 = await all(`select item_id, qty from w7_legacy_stock_moves order by item_id`);
  const fsUp2 = await stockOf('FS-01', items);
  ok(JSON.stringify(fnUp2) === JSON.stringify(fnUp) && JSON.stringify(moves2.map((m) => [m.item_id, m.qty])) === JSON.stringify(moves.map((m) => [m.item_id, m.qty]))
     && items.every((i) => fsUp2[i] === fsUp[i]) && (await one(`select status from warehouses where code = 'SZ-01'`)).status === 'closed'
     && (await one(`select count(*)::int n from site_settings where key = any ($1)`, [KEYS])).n === 0,
    'up again: same functions, same quantities moved, SZ-01 closed, settings gone');
  await db.query(down);
  ok(JSON.stringify(await fnState()) === JSON.stringify(fnDown) && (await one(`select status from warehouses where code = 'SZ-01'`)).status === 'legacy',
    'down again: same functions and SZ-01 status as the first down');
  const szDown2 = await stockOf('SZ-01', items);
  ok(moves.every((m) => szDown2[m.item_id] === m.qty) && (await ledgerBroken(items)).length === 0, 'down again: stock back at SZ-01, ledger balanced');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  if (seqs) await restoreSequences(seqs);
  const after = await one(`select status from warehouses where code = 'SZ-01'`);
  ok(after?.status === 'closed' || after == null, 'rolled back — SZ-01 still closed');
  await db.end();
}
console.log(failed ? `\nW7 retire: ${failed} check(s) failed` : '\nW7 retire: all passed');
process.exitCode = failed ? 1 : 0;
