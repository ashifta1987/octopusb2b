// Warehouse OS · W2a DB checks — inbound (stock notices, dock, receiving, counts, lots, serials, client SKUs).
// STAGING ONLY, rolled-back transactions.
//  0. Down → up (migrations applied after W2a — W2b, W3a, … — are unwound first and re-applied last): the W2a down restores record_warehouse_stock_movement() exactly (same source and 'SZ-01' default) and
//     removes every W2a object; up again gives identical functions, grants, policies and columns.
//  1. Legacy defaults: stock movements and handoffs default to the default warehouse (FS-01), not SZ-01.
//  2. Client SKUs: approved client members (and receiving staff) only; one SKU per company; own rows only.
//  3. Stock notices: own company + own SKUs; dates; ASN-#### codes; note / created_by hidden from customers.
//  4. Dock: receive role only; double booking refused; no ASN, no check-in; Booked → Arrived → Unloading → Done.
//  5. Counts: pass 1 equal → accepted + lot + inbound movement (actor = the counter); pass 1 different → pass 2 by a
//     different person; still different → blocked lot, no stock; approval by a supervisor who did not count pass 2.
//  6. Serials unique per item (DUPLICATE_SERIAL lists them); packers can't count, approve or scan.
//  7. Direct writes refused; the internal GUC doesn't open the stock function to non-staff. Audit + ledger.
// Run: node --env-file=.env.staging supabase/tests/w2a-warehouse.test.mjs
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
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w2a_warehouse_inbound(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));

try {
  // ── 0. down → up ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a, md5(p.prosrc) s, pg_get_function_arguments(p.oid) args
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'wh\\_%' or p.proname = 'record_warehouse_stock_movement') order by 1`),
    pol: await all(`select tablename, policyname, roles, cmd, qual from pg_policies where schemaname = 'public' and tablename like 'wh\\_%' order by 1, 2`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and table_name like 'wh\\_%' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    col: await all(`select table_name, column_name, column_default from information_schema.columns
                     where table_schema = 'public' and (table_name like 'wh\\_%' or (table_name = 'dropship_handoffs' and column_name = 'warehouse_id')) order by 1, 2`),
  });
  const upFile = mig('supabase/migrations');
  const downFile = mig('supabase/migrations/down');
  ok(Boolean(upFile && downFile), `W2a migration files found (${upFile} / ${downFile})`);
  const after = await snap();
  // later steps that build on W2a (W2b: bins, pallets, transfers reference wh_lots / wh_asns and use wh_sees(); W3a: orders,
  // and it replaces record_warehouse_stock_movement again) go down first, newest first, and come back afterwards
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, upFile);
  await unwind(db, later);
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const rw = await one(`select md5(prosrc) m, pg_get_function_arguments(oid) a from pg_proc where oid = 'public.record_warehouse_stock_movement(uuid,text,integer,text,text,uuid)'::regprocedure`);
  const hoDefault = (await one(`select column_default d from information_schema.columns where table_name = 'dropship_handoffs' and column_name = 'warehouse_id'`)).d;
  const leftovers = await all(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('wh_asns', 'wh_asn_lines', 'wh_client_skus', 'wh_dock_slots', 'wh_counts', 'wh_lots', 'wh_serials', 'seq_wh_asn', 'seq_wh_lot')`);
  ok(rw.m === '9b6d51ca62b9247aaca14d0dfebeed3a' && /'SZ-01'::text/.test(rw.a) && hoDefault === `'SZ-01'::text` && leftovers.length === 0,
    'down: record_warehouse_stock_movement restored exactly (source + SZ-01 default), handoff default restored, W2a tables gone');
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  await reapply(db, later);
  const again = await snap();
  if (again !== after) { const a = JSON.parse(after), b = JSON.parse(again); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('  diff in', k); }
  ok(again === after, 'up again: identical functions, grants, policies and columns');
  await db.query('rollback');

  await db.query('begin');
  // ── 1. defaults ──
  const args = (await one(`select pg_get_function_arguments('public.record_warehouse_stock_movement(uuid,text,integer,text,text,uuid)'::regprocedure) a`)).a;
  const ho = (await one(`select column_default d from information_schema.columns where table_name = 'dropship_handoffs' and column_name = 'warehouse_id'`)).d;
  ok(/default_warehouse_code\(\)/.test(args) && !/SZ-01/.test(args) && /default_warehouse_code\(\)/.test(ho ?? ''),
    'stock movements and handoffs default to the default warehouse (not SZ-01)');

  const mkUser = async (tag, role = null) => {
    const e = `w2a-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`, [id, `W2a ${tag}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const admin = await mkUser('admin', 'admin');
  const sup = await mkUser('sup', 'warehouse');
  const sup2 = await mkUser('sup2', 'warehouse');
  const recv = await mkUser('recv', 'warehouse');
  const recv2 = await mkUser('recv2', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'supervisor'), ($2, 'FS-01', 'supervisor'),
    ($3, 'FS-01', 'receiver'), ($4, 'FS-01', 'receiver'), ($5, 'FS-01', 'packer')`, [sup, sup2, recv, recv2, packer]);
  const mkOrg = async (name, client) => {
    const org = (await one(`insert into organizations(name, country, is_seed) values ($1, 'AE', true) returning id`, [name])).id;
    const u = await mkUser(name.replace(/\W/g, '').toLowerCase());
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, u]);
    if (client) await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01')`, [org]);
    return { org, u };
  };
  const A = await mkOrg('W2a Client A', true);
  const B = await mkOrg('W2a Client B', true);
  const N = await mkOrg('W2a Not a client', false);
  const auditBefore = Number((await one(`select count(*) n from audit_log where action like 'wh\\_%'`)).n);
  const today = (await one(`select (now() at time zone 'Asia/Shanghai')::date::text d`)).d;

  // ── 2. client SKUs ──
  const sku = (org, code, name) => `select wh_save_client_sku('${org}', null, '${code}', '${name}', null, 450, false, false) id`;
  await as(A.u, 'aal1');
  const s1 = (await one(sku(A.org, 'lamp-01', 'Desk lamp'))).id;
  const s2 = (await one(sku(A.org, 'HUB-02', 'USB-C hub'))).id;
  const dupSku = await tryq(sku(A.org, 'LAMP-01', 'Another'));
  const otherOrgSku = await tryq(sku(B.org, 'X-1', 'Not mine'));
  const ownSkus = await all(`select sku, item_id from wh_client_skus order by sku`);
  const skuCreatedBy = await tryq(`select created_by from wh_client_skus limit 1`);
  await as(N.u, 'aal1');
  const notClient = await tryq(sku(N.org, 'N-1', 'No'));
  await as(B.u, 'aal1');
  const bSees = await all(`select id from wh_client_skus`);
  const bS1 = (await one(sku(B.org, 'B-1', 'Organiser'))).id;
  await as(packer);
  const packerSku = await tryq(sku(A.org, 'P-1', 'Packer'));
  await owner();
  const item1 = (await one(`select item_id from wh_client_skus where id = $1`, [s1])).item_id;
  const item2 = (await one(`select item_id from wh_client_skus where id = $1`, [s2])).item_id;
  const im = await one(`select weight_g from item_master where id = $1`, [item1]);
  ok(ownSkus.length === 2 && ownSkus[1].sku === 'LAMP-01' && im?.weight_g === 450 && /DUPLICATE_SKU/.test(dupSku.err ?? '') &&
    /FORBIDDEN/.test(otherOrgSku.err ?? '') && /FORBIDDEN/.test(notClient.err ?? '') && /FORBIDDEN/.test(packerSku.err ?? '') &&
    bSees.length === 0 && /permission denied/.test(skuCreatedBy.err ?? ''),
    'client SKUs: approved client members only (one SKU per company, item_master row each); others, non-clients and packers refused; own rows only');

  // ── 3. stock notices ──
  const lines = (arr) => JSON.stringify(arr.map(([id, qty]) => ({ sku_id: id, qty })));
  await as(A.u, 'aal1');
  const asn1 = (await one(`select wh_create_asn($1, 'FS-01', $2::date, 2, null, $3::jsonb, 'Fragile lamps — top load', 'client') r`, [A.org, today, lines([[s1, 10], [s2, 5]])])).r;
  const asn2 = (await one(`select wh_create_asn($1, null, $2::date + 3, 1, null, $3::jsonb, null) r`, [A.org, today, lines([[s1, 4]])])).r;
  const asn3 = (await one(`select wh_create_asn($1, null, $2::date + 5, null, 1, $3::jsonb, null) r`, [A.org, today, lines([[s2, 6]])])).r;
  const foreignSku = await tryq(`select wh_create_asn($1, null, $2::date, 1, null, $3::jsonb, null)`, [A.org, today, lines([[bS1, 1]])]);
  const pastDate = await tryq(`select wh_create_asn($1, null, $2::date - 1, 1, null, $3::jsonb, null)`, [A.org, today, lines([[s1, 1]])]);
  const noLines = await tryq(`select wh_create_asn($1, null, $2::date, 1, null, '[]'::jsonb, null)`, [A.org, today]);
  const noLoad = await tryq(`select wh_create_asn($1, null, $2::date, null, null, $3::jsonb, null)`, [A.org, today, lines([[s1, 1]])]);
  const badQty = await tryq(`select wh_create_asn($1, null, $2::date, 1, null, $3::jsonb, null)`, [A.org, today, lines([[s1, 'x']])]);
  const dupLine = await tryq(`select wh_create_asn($1, null, $2::date, 1, null, $3::jsonb, null)`, [A.org, today, lines([[s1, 1], [s1, 2]])]);
  const octoAsClient = await tryq(`select wh_create_asn(null, 'FS-01', $1::date, 1, null, '[]'::jsonb, null, 'sourcing')`, [today]);
  const ownAsns = await all(`select code, status from wh_asns order by code`);
  const ownLines = await all(`select expected_qty from wh_asn_lines`);
  const noteHidden = await tryq(`select client_note from wh_asns limit 1`);
  const createdByHidden = await tryq(`select created_by from wh_asns limit 1`);
  const insertDirect = await tryq(`insert into wh_asns (org_id, warehouse_code, source, expected_date, cartons) values ($1, 'FS-01', 'client', current_date, 1)`, [A.org]);
  await as(B.u, 'aal1');
  const bAsns = await all(`select id from wh_asns`);
  const bLines = await all(`select id from wh_asn_lines`);
  await as(packer);
  const packerList = await one(`select wh_list_asns('FS-01') l`);
  const staffNote = packerList.l.find((x) => x.code === asn1.code)?.client_note;
  await owner();
  ok(/^ASN-\d{4,}$/.test(asn1.code) && asn1.warehouse === 'FS-01' && ownAsns.length === 3 && ownLines.length === 4 && ownAsns.every((a) => a.status === 'submitted'),
    `clients send stock notices (${asn1.code}) with their own SKUs; lines and the preferred warehouse are used`);
  ok(/UNKNOWN_SKU/.test(foreignSku.err ?? '') && /INVALID_DATE/.test(pastDate.err ?? '') && /NO_LINES/.test(noLines.err ?? '') &&
    /INVALID_LOAD/.test(noLoad.err ?? '') && /INVALID_QTY/.test(badQty.err ?? '') && /DUPLICATE_LINE/.test(dupLine.err ?? '') && /FORBIDDEN/.test(octoAsClient.err ?? ''),
    'refused: another company’s SKU, a past date, no lines, no cartons/pallets, a bad quantity, a repeated product, Octopus stock from a client');
  ok(/permission denied/.test(noteHidden.err ?? '') && /permission denied/.test(createdByHidden.err ?? '') && /permission denied/.test(insertDirect.err ?? '') &&
    bAsns.length === 0 && bLines.length === 0 && staffNote === 'Fragile lamps — top load',
    'customers can’t read the note or who created it, can’t write directly and see only their own notices; staff read the note through wh_list_asns()');

  // ── 4. dock ──
  // dock names unique to this run, so existing staging slots never clash
  const tag = String(Math.floor(Math.random() * 9000) + 1000);
  const [D1, D2, D3] = [`T${tag}A`, `T${tag}B`, `T${tag}C`];
  const book = (dock, from, to, asn) => `select wh_book_slot('FS-01', '${dock}', '${today}'::date, '${from}'::time, '${to}'::time, ${asn ? `'${asn}'` : 'null'}, null) id`;
  await as(packer);
  const packerBook = await tryq(book(D1, '10:00', '11:00', asn1.id));
  await as(recv);
  const slot1 = (await one(book(D1.toLowerCase(), '10:00', '11:00', asn1.id))).id;
  const clash = await tryq(book(D1, '10:30', '11:30', null));
  const slotNoAsn = (await one(book(D1, '11:00', '12:00', null))).id;
  const otherDock = (await one(book(D2, '10:30', '11:30', asn2.id))).id;
  const rebook = await tryq(book(D3, '13:00', '14:00', asn1.id));
  const noAsnCheckIn = await tryq(`select wh_check_in($1)`, [slotNoAsn]);
  const doneEarly = await tryq(`select wh_slot_advance($1, 'done')`, [slot1]);
  const countBefore = await tryq(`select wh_count_line(id, 1, 0, null) from wh_asn_lines where asn_id = $1 limit 1`, [asn1.id]);
  await db.query(`select wh_check_in($1)`, [slot1]);
  await db.query(`select wh_slot_advance($1, 'unloading')`, [slot1]);
  const unloadDone = await tryq(`select wh_slot_advance($1, 'done')`, [slot1]);
  const board = (await one(`select wh_dock_board('FS-01', $1::date) b`, [today])).b;
  await as(A.u, 'aal1');
  const custSlots = await all(`select id from wh_dock_slots`);
  const custAsn1 = await one(`select status, booked_slot_at from wh_asns where id = $1`, [asn1.id]);
  await owner();
  ok(/FORBIDDEN/.test(packerBook.err ?? '') && (clash.err ?? '').includes(`DOUBLE_BOOKED: dock ${D1} is already booked from 10:00 to 11:00`) && slotNoAsn && otherDock &&
    /ASN_NOT_OPEN/.test(rebook.err ?? ''), 'a double-booked dock is refused (back-to-back and other docks are fine); one slot per notice; packers can’t book');
  ok(/NO_ASN/.test(noAsnCheckIn.err ?? '') && /INVALID_STEP/.test(doneEarly.err ?? '') && /NOT_ARRIVED/.test(countBefore.err ?? '') &&
    /NOT_RECEIVED/.test(unloadDone.err ?? '') && custAsn1.status === 'arrived' && custAsn1.booked_slot_at && custSlots.length === 0 &&
    board.slots.filter((s) => [slot1, slotNoAsn, otherDock].includes(s.id)).length === 3 && board.slots.find((s) => s.id === slotNoAsn)?.asn_code === null,
    'no ASN, no check-in; Booked → Arrived → Unloading; Done waits until received; counting waits for check-in; clients see their notice status, not the dock');

  // ── 5. counts ──
  const line1 = (await one(`select id from wh_asn_lines where asn_id = $1 and item_id = $2`, [asn1.id, item1])).id;
  const line2 = (await one(`select id from wh_asn_lines where asn_id = $1 and item_id = $2`, [asn1.id, item2])).id;
  const stockBefore = Number((await one(`select coalesce(sum(on_hand_qty), 0) n from warehouse_stock where item_id = $1`, [item1])).n);
  await as(packer);
  const packerCount = await tryq(`select wh_count_line($1, 10, 0, null)`, [line1]);
  await as(recv);
  const directStock = await tryq(`select record_warehouse_stock_movement($1, 'inbound', 1, 'x', 'FS-01', null)`, [item1]);
  const c1 = (await one(`select wh_count_line($1, 10, 0, 'all good') r`, [line1])).r;
  const c2 = (await one(`select wh_count_line($1, 4, 0, 'one carton short?') r`, [line2])).r;
  const samePerson = await tryq(`select wh_count_line($1, 4, 1, null)`, [line2]);
  const again1 = await tryq(`select wh_count_line($1, 10, 0, null)`, [line1]);
  await as(sup);
  const c3 = (await one(`select wh_count_line($1, 4, 1, 'one damaged') r`, [line2])).r;
  await owner();
  const mov1 = await all(`select qty, actor_id, warehouse_id, kind from warehouse_stock_movements where item_id = $1 order by created_at`, [item1]);
  const mov2 = await all(`select id from warehouse_stock_movements where item_id = $1`, [item2]);
  const stockAfter = Number((await one(`select coalesce(sum(on_hand_qty), 0) n from warehouse_stock where item_id = $1`, [item1])).n);
  const lot2 = await one(`select id, qty, status from wh_lots where asn_line_id = $1`, [line2]);
  const asnMid = (await one(`select status from wh_asns where id = $1`, [asn1.id])).status;
  ok(/FORBIDDEN/.test(packerCount.err ?? '') && /FORBIDDEN/.test(directStock.err ?? '') && c1.result === 'accepted' && /^LOT-\d{5,}$/.test(c1.lot) &&
    mov1.length === 1 && mov1[0].qty === 10 && mov1[0].actor_id === recv && mov1[0].warehouse_id === 'FS-01' && stockAfter - stockBefore === 10,
    `pass 1 equal → accepted, ${c1.lot} released and an inbound movement posted by the counter (receivers still can’t post stock directly; packers can’t count)`);
  ok(c2.result === 'recount' && /SECOND_COUNTER_REQUIRED/.test(samePerson.err ?? '') && /ALREADY_COUNTED/.test(again1.err ?? '') &&
    c3.result === 'blocked' && lot2?.status === 'blocked' && lot2.qty === 4 && mov2.length === 0 && asnMid === 'receiving',
    'pass 1 different → a different person recounts; still different → lot blocked, nothing on hand');

  // ── approve ──
  await as(A.u, 'aal1');
  const custLots = await all(`select lot_code, status from wh_lots order by lot_code`);
  const custCounts = await all(`select id from wh_counts`);
  const custApprovedBy = await tryq(`select approved_by from wh_lots limit 1`);
  await as(recv2);
  const recvApprove = await tryq(`select wh_approve_lot($1, 4, 'ok')`, [lot2.id]);
  await as(packer);
  const packerApprove = await tryq(`select wh_approve_lot($1, 4, 'ok')`, [lot2.id]);
  await as(sup);
  const ownApprove = await tryq(`select wh_approve_lot($1, 4, 'ok')`, [lot2.id]);
  await as(sup2);
  const noReason = await tryq(`select wh_approve_lot($1, 4, ' ')`, [lot2.id]);
  const tooMany = await tryq(`select wh_approve_lot($1, 6, 'more')`, [lot2.id]);
  const approved = (await one(`select wh_approve_lot($1, 4, 'Supplier short-shipped one unit') r`, [lot2.id])).r;
  const twice = await tryq(`select wh_approve_lot($1, 4, 'again')`, [lot2.id]);
  await owner();
  const mov2b = await all(`select qty, actor_id from warehouse_stock_movements where item_id = $1`, [item2]);
  const l2 = await one(`select status, received_good, received_damaged from wh_asn_lines where id = $1`, [line2]);
  const asnDone = await one(`select status, received_at from wh_asns where id = $1`, [asn1.id]);
  ok(custLots.length === 2 && custLots.some((l) => l.status === 'blocked') && custCounts.length === 0 && /permission denied/.test(custApprovedBy.err ?? ''),
    'the client sees the blocked lot (shown as “being checked”) but not the counts or who approved');
  ok(/FORBIDDEN/.test(recvApprove.err ?? '') && /FORBIDDEN/.test(packerApprove.err ?? '') && /TWO_PERSON_REQUIRED/.test(ownApprove.err ?? '') &&
    /REASON_REQUIRED/.test(noReason.err ?? '') && /INVALID_QTY/.test(tooMany.err ?? '') && approved.qty === 4 && /NOT_BLOCKED/.test(twice.err ?? '') &&
    mov2b.length === 1 && mov2b[0].qty === 4 && mov2b[0].actor_id === sup2 && l2.status === 'accepted' && l2.received_good === 4 && l2.received_damaged === 1 &&
    asnDone.status === 'received' && asnDone.received_at,
    'only a supervisor who didn’t recount approves (with a reason, within the counted range); stock posts then; the notice is received');
  await as(recv);
  await db.query(`select wh_slot_advance($1, 'done')`, [slot1]);
  await owner();
  ok((await one(`select status from wh_dock_slots where id = $1`, [slot1])).status === 'done', 'the dock slot finishes once the notice is received');

  // ── 6. serials ──
  const lot1 = (await one(`select id from wh_lots where asn_line_id = $1`, [line1])).id;
  await as(recv);
  const n1 = (await one(`select wh_add_serials($1, array['sn-001', 'SN-002']) n`, [lot1])).n;
  const dupExisting = await tryq(`select wh_add_serials($1, array['SN-002', 'SN-003'])`, [lot1]);
  const dupInput = await tryq(`select wh_add_serials($1, array['SN-004', ' sn-004 '])`, [lot1]);
  const tooManySerials = await tryq(`select wh_add_serials($1, array['A-001', 'A-002', 'A-003', 'A-004', 'A-005'])`, [lot2.id]);
  await as(packer);
  const packerSerial = await tryq(`select wh_add_serials($1, array['SN-009'])`, [lot1]);
  await as(A.u, 'aal1');
  const custSerials = await all(`select id from wh_serials`);
  await owner();
  ok(n1 === 2 && /DUPLICATE_SERIAL: SN-002 already recorded/.test(dupExisting.err ?? '') && /DUPLICATE_SERIAL: SN-004/.test(dupInput.err ?? '') &&
    /TOO_MANY_SERIALS/.test(tooManySerials.err ?? '') && /FORBIDDEN/.test(packerSerial.err ?? '') && custSerials.length === 0,
    'serials: recorded once per product, duplicates refused and listed, never more than the lot; packers can’t scan; clients don’t see them');

  // ── 7. cancel, internal GUC, direct writes ──
  await as(A.u, 'aal1');
  await db.query(`select wh_cancel_asn($1, null)`, [asn2.id]);
  await db.query(`select wh_cancel_asn($1, 'Changed supplier')`, [asn3.id]);
  const cancelReceived = await tryq(`select wh_cancel_asn($1, null)`, [asn1.id]);
  await db.query(`select set_config('octopus.wh_internal', 'true', true)`);
  const custGuc = await tryq(`select record_warehouse_stock_movement($1, 'inbound', 1, 'x', 'FS-01', null)`, [item1]);
  const custPost = await tryq(`select wh_post_inbound($1, 1, 'x', 'FS-01')`, [item1]);
  await db.query(`select set_config('octopus.wh_internal', '', true)`);
  await as(recv);
  const staffUpdate = await tryq(`update wh_lots set status = 'released' where id = $1`, [lot2.id]);
  const staffSlotInsert = await tryq(`insert into wh_dock_slots (warehouse_code, dock, starts_at, ends_at) values ('FS-01', 'D9', now(), now() + interval '1 hour')`);
  await owner();
  const slot2 = await one(`select status from wh_dock_slots where id = $1`, [otherDock]);
  const asn2s = (await one(`select status from wh_asns where id = $1`, [asn2.id])).status;
  ok(asn2s === 'cancelled' && slot2.status === 'cancelled' && /ASN_LOCKED/.test(cancelReceived.err ?? ''),
    'clients cancel a notice before it arrives (its booked slot is cancelled too); received notices are locked');
  ok(/FORBIDDEN/.test(custGuc.err ?? '') && /permission denied/.test(custPost.err ?? '') && /permission denied/.test(staffUpdate.err ?? '') &&
    /permission denied/.test(staffSlotInsert.err ?? ''),
    'setting the internal flag by hand doesn’t let a customer post stock; the internal poster and tables are not writable directly');

  const audit = Number((await one(`select count(*) n from audit_log where action like 'wh\\_%'`)).n) - auditBefore;
  ok(audit >= 15, `every state change audit-logged (${audit} W2a rows in this transaction)`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nw2a-warehouse: ${failed} check(s) failed` : '\nw2a-warehouse: all passed');
process.exitCode = failed ? 1 : 0;
