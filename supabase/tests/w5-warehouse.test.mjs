// Warehouse OS · W5 DB checks — portal inventory (numbers vs seeded stock / notices / lots / shipments; days of cover empty without
// history), product photos, returns (register → photos → inspect with charge → client decision → complete: restock lot + ledger,
// discard (nothing posted), send back (order straight to packing, net 0 on hand)), the default after the decision date, warehouse
// support requests on the existing tickets, client isolation, staff permissions, audit, ledger balance, demo wipe.
// STAGING ONLY, rolled-back transactions.
//  0. Down → up → down → up: the W5 down removes every W5 object and changes nothing else (no function is replaced); up again gives
//     identical functions, grants, policies, columns, constraints, indexes and triggers; second down = first down. Security shape:
//     RLS on every W5 table, SELECT-only grants, nothing for anon, definer functions with search_path=public, internals closed.
//  1. Setup: staff at FS-01 (warehouse admin, supervisor, receiver, packer), a company admin (support desk), client A (custom plan
//     with a returns rate) and client B (volume plan without one), SKUs, stock through the real ledger function, an order that
//     reserves, an open stock notice, a blocked lot, shipped orders (inside and outside the 30-day window).
//  2. Inventory numbers; days of cover; client isolation; staff read.
//  3. Product photo: storage policy + wh_set_sku_image (file must exist, path under the product, own company only).
//  4. Returns: register (role, client's own SKUs / order), photo upload policy, inspect (photo + grading required; charge copied).
//  5. Decisions and completion: restock (adjust_in + released unplaced lot; damaged units not restocked), send back (order picked,
//     adjust_in + reserve + pick, net 0), discard (nothing posted); client can change the decision until done; isolation.
//  6. Default after the decision date (supervisor only, not before the date); empty charge when the plan has no returns rate.
//  7. Support requests: type + own reference + attachments in the company folder; staff / client context; isolation; RLS.
//  8. Ledger balanced for every test item; audit rows; staging demo wipe removes the demo client's W5 rows (cascade).
// Run: node --env-file=.env.staging supabase/tests/w5-warehouse.test.mjs
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
const anon = () => as(null, 'aal1', 'anon');
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w5_portal_inventory_returns_support(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));
const W5_TABLES = ['wh_returns', 'wh_return_lines', 'wh_return_photos', 'wh_support_links'];
const W5_FNS = ['wh_return_photo_can_upload', 'wh_return_photo_can_read', 'wh_product_photo_can_upload', 'wh_product_photo_can_read', 'wh_return_rate',
  'wh_return_json', 'wh_return_register', 'wh_return_add_photo', 'wh_return_inspect', 'wh_return_decide', 'wh_return_apply_default', 'wh_return_complete',
  'wh_returns_board', 'wh_portal_returns', 'wh_portal_inventory', 'wh_set_sku_image', 'wh_create_support_request', 'wh_portal_support', 'wh_ticket_context'];
const INTERNAL = ['wh_return_rate', 'wh_return_json'];

try {
  // ── 0. down → up → down → up ──
  await db.query('begin');
  const snap = async () => ({
    fn: await all(`select p.oid::regprocedure::text f, p.proname n, p.proacl::text a, md5(p.prosrc) s, pg_get_function_arguments(p.oid) args, p.prosecdef d, p.proconfig::text c
                     from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like 'wh\\_%' or p.proname in ('record_warehouse_stock_movement', 'wipe_demo_data', 'write_audit', 'create_ticket', 'reply_ticket',
                           'set_ticket_division', 'guard_ticket_update', 'tag_seed_rows')) order by 1`),
    pol: await all(`select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
                     where (schemaname = 'public' and (tablename like 'wh\\_%' or tablename in ('tickets', 'ticket_messages', 'wh_client_skus'))) or (schemaname = 'storage' and policyname like 'wh %') order by 1, 2, 3`),
    tg: await all(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger
                    where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and (relname like 'wh\\_%' or relname in ('tickets', 'ticket_messages'))) order by 1, 2`),
    tp: await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
                    where table_schema = 'public' and (table_name like 'wh\\_%' or table_name in ('tickets', 'ticket_messages')) and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and (table_name like 'wh\\_%' or table_name = 'tickets') and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    col: await all(`select table_name, column_name, column_default, is_nullable, data_type from information_schema.columns
                     where table_schema = 'public' and (table_name like 'wh\\_%' or table_name in ('tickets', 'ticket_messages')) order by 1, 2`),
    con: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
                     where connamespace = 'public'::regnamespace and (conrelid::regclass::text like 'wh\\_%' or conrelid::regclass::text in ('tickets', 'ticket_messages')) order by 1, 2`),
    idx: await all(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and (tablename like 'wh\\_%' or tablename in ('tickets', 'ticket_messages')) order by 1, 2`),
    seq: await all(`select sequencename from pg_sequences where schemaname = 'public' and sequencename like 'seq\\_wh\\_%' order by 1`),
    rls: await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'wh\\_%' order by 1`),
  });
  const S = (x) => JSON.stringify(x);
  const diff = (a, b) => { for (const k of Object.keys(a)) if (S(a[k]) !== S(b[k])) console.log('  diff in', k); };
  const upFile = mig('supabase/migrations');
  const downFile = mig('supabase/migrations/down');
  ok(Boolean(upFile && downFile), `W5 migration files found (${upFile} / ${downFile})`);
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, upFile);
  await unwind(db, later);
  const withW5 = await snap();
  const capsBefore = Number((await one(`select count(*) n from wh_role_capabilities where action = 'returns'`)).n);
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without = await snap();
  const leftT = without.rls.filter((r) => W5_TABLES.includes(r.relname));
  const leftF = without.fn.filter((r) => W5_FNS.includes(r.n));
  const capsAfter = Number((await one(`select count(*) n from wh_role_capabilities where action = 'returns'`)).n);
  const keptFns = withW5.fn.filter((r) => !W5_FNS.includes(r.n));
  ok(leftT.length === 0 && leftF.length === 0 && !without.seq.some((s) => s.sequencename === 'seq_wh_return')
     && !without.pol.some((p) => /wh (returns|products)/.test(p.policyname)) && capsBefore === 3 && capsAfter === 0,
    'down: every W5 table, function, storage policy, the sequence and the returns capability rows are gone');
  ok(S(keptFns) === S(without.fn), `down: every other warehouse / ticket function is byte-identical (nothing replaced — ${keptFns.length} functions)`);
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  const again = await snap();
  if (S(again) !== S(withW5)) diff(withW5, again);
  ok(S(again) === S(withW5), 'up again: identical functions, grants, policies, columns, constraints, indexes, triggers, RLS');
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without2 = await snap();
  if (S(without2) !== S(without)) diff(without, without2);
  ok(S(without2) === S(without), 'down again: the same schema as the first down (up → down leaves no difference)');
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  await reapply(db, later);
  const rlsAll = withW5.rls.filter((r) => W5_TABLES.includes(r.relname));
  const writeGrants = withW5.tp.filter((g) => W5_TABLES.includes(g.table_name) && ['anon', 'authenticated'].includes(g.grantee) && g.privilege_type !== 'SELECT');
  const anonAny = withW5.tp.filter((g) => W5_TABLES.includes(g.table_name) && g.grantee === 'anon');
  const pubFns = withW5.fn.filter((f) => W5_FNS.includes(f.n) && (/(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? '')));
  const notDefiner = withW5.fn.filter((f) => W5_FNS.includes(f.n) && (!f.d || !/search_path=public/.test(f.c ?? '')));
  const internalOpen = withW5.fn.filter((f) => INTERNAL.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  ok(rlsAll.length === W5_TABLES.length && rlsAll.every((r) => r.relrowsecurity) && writeGrants.length === 0 && anonAny.length === 0,
    'RLS on every W5 table; authenticated may only SELECT; anon has nothing');
  ok(pubFns.length === 0 && notDefiner.length === 0 && internalOpen.length === 0,
    `W5 functions: security definer + search_path=public, not executable by public/anon; internal helpers not by authenticated${notDefiner.length ? ' — ' + notDefiner.map((f) => f.n).join(',') : ''}${pubFns.length ? ' — open: ' + pubFns.map((f) => f.n).join(',') : ''}`);
  await db.query('rollback');

  await db.query('begin');
  // ── 1. setup ──
  const tag = String(Math.floor(Math.random() * 9000) + 1000);
  const mkUser = async (t, role = null) => {
    const e = `w5-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`, [id, `W5 ${t}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const whAdmin = await mkUser('whadmin', 'warehouse');
  const sup = await mkUser('sup', 'warehouse');
  const recv = await mkUser('recv', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  const admin = await mkUser('admin', 'admin');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin'), ($2, 'FS-01', 'supervisor'), ($3, 'FS-01', 'receiver'), ($4, 'FS-01', 'packer')`,
    [whAdmin, sup, recv, packer]);
  const orgA = (await one(`insert into organizations(name, country, is_seed) values ('W5 Client Lamps', 'AE', true) returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country, is_seed) values ('W5 Client Other', 'DE', true) returning id`)).id;
  const custA = await mkUser('custa');
  const custB = await mkUser('custb');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, custA, orgB, custB]);
  await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'custom', 'FS-01'), ($2, 'volume', 'FS-01')`, [orgA, orgB]);
  // rate versions for this transaction: custom @FS-01 has a returns rate (150 cents), volume @FS-01 has none (empty = not set)
  for (const [plan, rate] of [['custom', 150], ['volume', null]]) {
    await db.query(`update wh_rate_versions set status = 'superseded' where plan_code = $1 and warehouse_code = 'FS-01' and status = 'active'`, [plan]);
    const v = Number((await one(`select coalesce(max(version), 0) + 1 v from wh_rate_versions where plan_code = $1 and warehouse_code = 'FS-01'`, [plan])).v);
    await db.query(`insert into wh_rate_versions (plan_code, warehouse_code, version, returns_per_item_cents, status, proposed_by, approved_by, effective_from)
                    values ($1, 'FS-01', $2, $3, 'active', $4, $5, now())`, [plan, v, rate, whAdmin, sup]);
  }
  await as(custA, 'aal1');
  const sLamp = (await one(`select wh_save_client_sku($1, null, $2, 'Desk lamp', 'W5L4711', 450, false, false) id`, [orgA, `W5-LAMP-${tag}`])).id;
  const sHub = (await one(`select wh_save_client_sku($1, null, $2, 'USB-C hub', null, 120, false, false) id`, [orgA, `W5-HUB-${tag}`])).id;
  await as(custB, 'aal1');
  const sOther = (await one(`select wh_save_client_sku($1, null, $2, 'Other product', null, 100, false, false) id`, [orgB, `W5-OTH-${tag}`])).id;
  await owner();
  const item = async (s) => (await one(`select item_id from wh_client_skus where id = $1`, [s])).item_id;
  const LAMP = { item: await item(sLamp), sku: `W5-LAMP-${tag}` };
  const HUB = { item: await item(sHub), sku: `W5-HUB-${tag}` };
  const OTH = { item: await item(sOther), sku: `W5-OTH-${tag}` };
  // stock through the only write path (service role): 10 lamps at FS-01, 4 of client B's product
  await db.query(`select record_warehouse_stock_movement($1, 'inbound', 10, 'W5 test stock', 'FS-01', null)`, [LAMP.item]);
  await db.query(`select record_warehouse_stock_movement($1, 'inbound', 4, 'W5 test stock', 'FS-01', null)`, [OTH.item]);
  // an order that reserves 3 lamps; an open stock notice (7 lamps, 5 hubs); a blocked lot of 2 hubs
  await as(custA, 'aal1');
  const resOrder = (await one(`select wh_create_client_order($1, $2::jsonb, 'client_portal') r`, [orgA, JSON.stringify({
    external_ref: `W5-RES-${tag}`, ship: { name: 'Erika Muster', line1: 'Hauptstrasse 5', city: 'Berlin', postcode: '10115', country: 'DE' }, lines: [{ sku_id: sLamp, qty: '3' }],
  })])).r;
  const asn = (await one(`select wh_create_asn($1, 'FS-01', (now() + interval '3 days')::date, 2, null, $2::jsonb, null, 'client') r`,
    [orgA, JSON.stringify([{ sku_id: sLamp, qty: '7' }, { sku_id: sHub, qty: '5' }])])).r;
  await owner();
  await db.query(`insert into wh_lots (warehouse_code, item_id, org_id, qty, status) values ('FS-01', $1, $2, 2, 'blocked')`, [HUB.item, orgA]);
  // shipped orders written straight at their step (no ledger): 6 lamps 2 days ago (inside 30 days), 4 hubs 40 days ago (outside)
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'W5 carton', 100) returning id`, [`W5B${tag}`])).id;
  const mkShipped = async (it, qty, w, daysAgo, org = orgA) => {
    const exp = qty * w + 100;
    const o = await one(`insert into wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_address, ship_country, status, picked_at, box_id, expected_weight_g, tolerance_g, measured_weight_g)
      values ('FS-01', 'client_portal', $1, $2, 'Erika Muster', '{"line1": "Hauptstrasse 5", "city": "Berlin"}'::jsonb, 'DE', 'packing', now(), $3, $4, 50, $4) returning id, code`,
      [org, `W5-SH-${tag}-${crypto.randomUUID().slice(0, 6)}`, box, exp]);
    await db.query(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, packed_qty, unit_weight_g) values ($1, $2, $3, 'x', $4, $4, $4, $5)`, [o.id, it.item, it.sku, qty, w]);
    await db.query(`update wh_orders set status = 'packed', packed_at = now(), packed_by = $2 where id = $1`, [o.id, packer]);
    await db.query(`update wh_orders set status = 'shipped', shipped_at = now() - make_interval(days => $2), tracking_token = md5(random()::text) where id = $1`, [o.id, daysAgo]);
    return o;
  };
  const shipA = await mkShipped(LAMP, 6, 450, 2);
  await mkShipped(HUB, 4, 120, 40);
  const shipB = await mkShipped(OTH, 1, 100, 1, orgB);
  ok(resOrder.status === 'allocated' && /^ASN-\d+/.test(asn.code),
    'setup: staff per role at FS-01, two clients (rate with / without a returns price), stock via the ledger, a reserving order, an open notice, a blocked lot, shipped orders');

  // ── 2. inventory ──
  await as(custA, 'aal1');
  const inv = (await one(`select wh_portal_inventory($1) i`, [orgA])).i;
  const L = inv.skus.find((s) => s.sku === LAMP.sku);
  const H = inv.skus.find((s) => s.sku === HUB.sku);
  ok(L && L.on_hand === 10 && L.reserved === 3 && L.available === 7 && L.incoming === 7 && L.checking === 0 && L.shipped_30d === 6
     && L.by_warehouse.length === 1 && L.by_warehouse[0].warehouse_code === 'FS-01' && L.by_warehouse[0].available === 7,
    `inventory: lamp on hand 10 / reserved 3 / available 7 / incoming 7 / shipped in 30 days 6, per warehouse FS-01 (${JSON.stringify(L && { ...L, by_warehouse: undefined })})`);
  ok(L.days_cover === 35, `inventory: days of cover = floor(7 available × 30 ÷ 6 shipped) = 35 (${L.days_cover})`);
  ok(H && H.on_hand === 0 && H.incoming === 5 && H.checking === 2 && H.shipped_30d === 0 && H.days_cover === null && H.by_warehouse.length === 0,
    `inventory: hub has no stock, 5 incoming, 2 being checked; shipments older than 30 days don't count → days of cover EMPTY, not 0 (${H && H.days_cover})`);
  ok(inv.totals.on_hand === 10 && inv.totals.available === 7 && inv.totals.incoming === 12 && inv.totals.checking === 2 && !inv.skus.some((s) => s.sku === OTH.sku),
    'inventory: totals match and the other company\'s product is not listed');
  await as(custB, 'aal1');
  const invB = await tryq(`select wh_portal_inventory($1)`, [orgA]);
  await as(packer);
  const invStaff = await tryq(`select wh_portal_inventory($1) i`, [orgA]);
  await anon();
  const invAnon = await tryq(`select wh_portal_inventory($1)`, [orgA]);
  ok(/FORBIDDEN/.test(invB.err ?? '') && !invStaff.err && invStaff.rows[0].i.skus.length === 2 && /permission denied|FORBIDDEN/.test(invAnon.err ?? ''),
    'inventory: another company is refused, warehouse staff can read it (support), anon cannot run it');

  // ── 3. product photo ──
  const photo = `${orgA}/${sLamp}/${crypto.randomUUID()}.png`;
  const otherPath = `${orgA}/${sHub}/${crypto.randomUUID()}.png`;
  await as(custA, 'aal1');
  const canUpA = (await one(`select wh_product_photo_can_upload($1) c`, [photo])).c;
  const missing = await tryq(`select wh_set_sku_image($1, $2)`, [sLamp, photo]);
  await as(custB, 'aal1');
  const canUpB = (await one(`select wh_product_photo_can_upload($1) c`, [photo])).c;
  await owner();
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-products', $1, $2), ('wh-products', $3, $2)`, [photo, custA, otherPath]);
  await as(custA, 'aal1');
  const wrongSku = await tryq(`select wh_set_sku_image($1, $2)`, [sLamp, otherPath]);
  const setOk = await tryq(`select wh_set_sku_image($1, $2)`, [sLamp, photo]);
  const readA = (await one(`select wh_product_photo_can_read($1) c`, [photo])).c;
  const imgA = (await one(`select image_path from wh_client_skus where id = $1`, [sLamp])).image_path;
  await as(custB, 'aal1');
  const setB = await tryq(`select wh_set_sku_image($1, $2)`, [sLamp, photo]);
  const readB = (await one(`select wh_product_photo_can_read($1) c`, [photo])).c;
  await as(packer);
  const readStaff = (await one(`select wh_product_photo_can_read($1) c`, [photo])).c;
  ok(canUpA === true && canUpB === false && /PHOTO_MISSING/.test(missing.err ?? '') && /INVALID_PATH/.test(wrongSku.err ?? '') && !setOk.err && imgA === photo
     && /FORBIDDEN/.test(setB.err ?? '') && readA === true && readB === false && readStaff === true,
    'product photo: only the company uploads under its own product; the file must exist; image_path set; staff and the company read it, others don\'t');

  // ── 4. returns: register, photos, inspect ──
  await as(packer);
  const packerReg = await tryq(`select wh_return_register($1, 'FS-01', null, null, null, $2::jsonb)`, [orgA, JSON.stringify([{ sku_id: sLamp, qty: '1' }])]);
  await as(custA, 'aal1');
  const custReg = await tryq(`select wh_return_register($1, 'FS-01', null, null, null, $2::jsonb)`, [orgA, JSON.stringify([{ sku_id: sLamp, qty: '1' }])]);
  await as(recv);
  const foreignSku = await tryq(`select wh_return_register($1, 'FS-01', null, null, null, $2::jsonb)`, [orgA, JSON.stringify([{ sku_id: sOther, qty: '1' }])]);
  const foreignOrder = await tryq(`select wh_return_register($1, 'FS-01', $2, null, null, $3::jsonb)`, [orgA, shipB.code, JSON.stringify([{ sku_id: sLamp, qty: '1' }])]);
  const R1 = (await one(`select wh_return_register($1, 'FS-01', $2, 'RET123456', 'Customer changed mind', $3::jsonb) r`,
    [orgA, shipA.code, JSON.stringify([{ sku_id: sLamp, qty: '3' }, { sku_id: sHub, qty: '2' }])])).r;
  const r1Lines = await all(`select id, sku, qty, condition from wh_return_lines where return_id = $1 order by sku`, [R1.id]);
  const lampLine = r1Lines.find((l) => l.sku === LAMP.sku);
  const hubLine = r1Lines.find((l) => l.sku === HUB.sku);
  const noPhoto = await tryq(`select wh_return_inspect($1, $2::jsonb, null)`, [R1.id, JSON.stringify([{ line_id: lampLine.id, condition: 'good' }, { line_id: hubLine.id, condition: 'damaged' }])]);
  const rp = `FS-01/${R1.code}/${crypto.randomUUID()}.jpg`;
  const canUpRecv = (await one(`select wh_return_photo_can_upload($1) c`, [rp])).c;
  const photoMissing = await tryq(`select wh_return_add_photo($1, $2)`, [R1.id, rp]);
  await as(packer);
  const canUpPacker = (await one(`select wh_return_photo_can_upload($1) c`, [rp])).c;
  await owner();
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-returns', $1, $2)`, [rp, recv]);
  await as(recv);
  const badPath = await tryq(`select wh_return_add_photo($1, $2)`, [R1.id, `FS-01/RT-9999/${crypto.randomUUID()}.jpg`]);
  await db.query(`select wh_return_add_photo($1, $2)`, [R1.id, rp]);
  const ungraded = await tryq(`select wh_return_inspect($1, $2::jsonb, null)`, [R1.id, JSON.stringify([{ line_id: lampLine.id, condition: 'good' }])]);
  const insp = (await one(`select wh_return_inspect($1, $2::jsonb, 'Outer carton dented; lamps unused') r`,
    [R1.id, JSON.stringify([{ line_id: lampLine.id, condition: 'good' }, { line_id: hubLine.id, condition: 'damaged' }])])).r;
  await owner();
  const r1 = await one(`select * from wh_returns where id = $1`, [R1.id]);
  ok(/FORBIDDEN/.test(packerReg.err ?? '') && /FORBIDDEN/.test(custReg.err ?? '') && /UNKNOWN_SKU/.test(foreignSku.err ?? '') && /ORDER_NOT_FOUND/.test(foreignOrder.err ?? '')
     && /^RT-\d{4,}$/.test(R1.code) && r1Lines.length === 2,
    'register: receivers only (not packers, not clients); only the client\'s own products and orders');
  ok(/PHOTO_REQUIRED/.test(noPhoto.err ?? '') && canUpRecv === true && canUpPacker === false && /PHOTO_MISSING/.test(photoMissing.err ?? '') && /INVALID_PATH/.test(badPath.err ?? '')
     && /NOT_GRADED/.test(ungraded.err ?? ''),
    'inspect: a photo (uploaded under <WH>/<RT-code>/, by a role with returns) and a grade for every product are required');
  ok(r1.status === 'inspected' && r1.charge_units === 5 && Number(r1.charge_per_item_cents) === 150 && Number(r1.charge_cents) === 750 && insp.code === R1.code
     && Math.abs(new Date(r1.decide_by) - new Date(r1.inspected_at) - 14 * 864e5) < 5000,
    'inspect: status inspected, decide-by = inspection + 14 days, charge 5 × 150 = 750 cents copied from the client\'s rate plan');

  // ── 5. decisions and completion ──
  await as(custB, 'aal1');
  const decB = await tryq(`select wh_return_decide($1, 'restock', null)`, [R1.id]);
  const portB = await tryq(`select wh_portal_returns($1)`, [orgA]);
  const rowsB = Number((await one(`select count(*) n from wh_returns`)).n);
  await as(custA, 'aal1');
  const rowsA = Number((await one(`select count(*) n from wh_returns`)).n);
  const portA = (await one(`select wh_portal_returns($1) r`, [orgA])).r;
  await db.query(`select wh_return_decide($1, 'discard', null)`, [R1.id]);
  await db.query(`select wh_return_decide($1, 'restock', null)`, [R1.id]);
  const pr1 = portA.find((x) => x.code === R1.code);
  ok(/FORBIDDEN/.test(decB.err ?? '') && /FORBIDDEN/.test(portB.err ?? '') && rowsB === 0 && rowsA === 0
     && pr1 && pr1.photos.length === 1 && pr1.lines.length === 2 && !('received_by_name' in pr1) && pr1.condition_note === 'Outer carton dented; lamps unused',
    'isolation: another company can\'t decide or list; tables are staff-only (clients read through wh_portal_returns, no staff names)');
  await as(packer);
  const packerDone = await tryq(`select wh_return_complete($1, null)`, [R1.id]);
  await as(recv);
  const done1 = (await one(`select wh_return_complete($1, 'shelf A') r`, [R1.id])).r;
  await owner();
  const lot1 = await one(`select t.* from wh_return_lines l join wh_lots t on t.id = l.lot_id where l.id = $1`, [lampLine.id]);
  const hubAfter = await one(`select lot_id, movement_id from wh_return_lines where id = $1`, [hubLine.id]);
  const mov1 = await one(`select * from warehouse_stock_movements where id = (select movement_id from wh_return_lines where id = $1)`, [lampLine.id]);
  const lampStock = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'FS-01' and item_id = $1`, [LAMP.item]);
  const free1 = (await one(`select wh_lot_free($1) f`, [lot1.id])).f;
  const inBins = Number((await one(`select count(*) n from wh_bin_stock where lot_id = $1`, [lot1.id])).n);
  ok(/FORBIDDEN/.test(packerDone.err ?? '') && done1.decision === 'restock' && done1.units === 3 && done1.lots.length === 1,
    'restock: completed by a receiver (packers can\'t), 3 good units');
  ok(lot1 && lot1.status === 'released' && lot1.qty === 3 && lot1.org_id === orgA && lot1.asn_line_id === null && free1 === 3 && inBins === 0
     && mov1 && mov1.kind === 'adjust_in' && mov1.qty === 3 && mov1.on_hand_delta === 3 && mov1.actor_id === recv && mov1.wh_order_id === null
     && lampStock.on_hand_qty === 13 && lampStock.reserved_qty === 3 && !hubAfter.lot_id && !hubAfter.movement_id,
    'restock: ledger adjust_in 3 by the receiver, a released lot of 3 not in a bin (putaway places it), lamp on hand 13; the damaged hubs are not restocked');

  await as(recv);
  const R2 = (await one(`select wh_return_register($1, 'FS-01', null, null, null, $2::jsonb) r`, [orgA, JSON.stringify([{ sku_id: sHub, qty: '1' }])])).r;
  const rp2 = `FS-01/${R2.code}/${crypto.randomUUID()}.webp`;
  await owner();
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-returns', $1, $2)`, [rp2, recv]);
  await as(recv);
  await db.query(`select wh_return_add_photo($1, $2)`, [R2.id, rp2]);
  const r2line = (await one(`select id from wh_return_lines where return_id = $1`, [R2.id])).id;
  await db.query(`select wh_return_inspect($1, $2::jsonb, 'Hub cracked')`, [R2.id, JSON.stringify([{ line_id: r2line, condition: 'damaged' }])]);
  await as(custA, 'aal1');
  const restockBad = await tryq(`select wh_return_decide($1, 'restock', null)`, [R2.id]);
  const noAddr = await tryq(`select wh_return_decide($1, 'send_back', '{}'::jsonb)`, [R2.id]);
  await db.query(`select wh_return_decide($1, 'send_back', $2::jsonb)`, [R2.id, JSON.stringify({ name: 'Lamps HQ', line1: '1 Sheikh Zayed Rd', city: 'Dubai', country: 'ae' })]);
  await owner();
  const hubBefore = await one(`select coalesce(on_hand_qty, 0) oh, coalesce(reserved_qty, 0) rs from (select 1) x left join warehouse_stock s on s.warehouse_id = 'FS-01' and s.item_id = $1`, [HUB.item]);
  await as(recv);
  const done2 = (await one(`select wh_return_complete($1, null) r`, [R2.id])).r;
  await owner();
  const sbo = await one(`select * from wh_orders where code = $1`, [done2.order_code]);
  const sbl = await one(`select qty, picked_qty, packed_qty from wh_order_lines where order_id = $1`, [sbo?.id]);
  const sbMoves = await all(`select kind, qty, wh_order_id from warehouse_stock_movements where item_id = $1 and (wh_order_id = $2 or reason like $3) order by created_at, kind`,
    [HUB.item, sbo?.id, `%${R2.code}%`]);
  const hubAfter2 = await one(`select coalesce(on_hand_qty, 0) oh, coalesce(reserved_qty, 0) rs from (select 1) x left join warehouse_stock s on s.warehouse_id = 'FS-01' and s.item_id = $1`, [HUB.item]);
  const r2 = await one(`select * from wh_returns where id = $1`, [R2.id]);
  ok(/NOTHING_TO_RESTOCK/.test(restockBad.err ?? '') && /INVALID_NAME/.test(noAddr.err ?? ''),
    'send back: restock refused when no unit is good; the address is checked like a portal order');
  ok(sbo && sbo.status === 'picked' && sbo.external_ref === R2.code && sbo.org_id === orgA && sbo.ship_country === 'AE' && sbo.warehouse_code === 'FS-01'
     && sbl && sbl.qty === 1 && sbl.picked_qty === 1 && sbl.packed_qty === 0 && r2.outbound_order_id === sbo.id && r2.status === 'done',
    `send back: order ${done2.order_code} to the client's address, picked at the returns desk (goes straight to packing), linked to the return`);
  ok(sbMoves.map((m) => m.kind).sort().join(',') === 'adjust_in,pick,reserve' && sbMoves.every((m) => m.qty === 1)
     && sbMoves.filter((m) => m.kind !== 'adjust_in').every((m) => m.wh_order_id === sbo.id)
     && hubAfter2.oh === hubBefore.oh && hubAfter2.rs === hubBefore.rs,
    'send back: ledger adjust_in + reserve + pick of the returned unit (order reference on reserve / pick); on hand and reserved unchanged (net 0)');

  await as(recv);
  const R3 = (await one(`select wh_return_register($1, 'FS-01', null, null, null, $2::jsonb) r`, [orgA, JSON.stringify([{ sku_id: sLamp, qty: '1' }])])).r;
  const rp3 = `FS-01/${R3.code}/${crypto.randomUUID()}.png`;
  await owner();
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-returns', $1, $2)`, [rp3, recv]);
  await as(recv);
  await db.query(`select wh_return_add_photo($1, $2)`, [R3.id, rp3]);
  const r3line = (await one(`select id from wh_return_lines where return_id = $1`, [R3.id])).id;
  await db.query(`select wh_return_inspect($1, $2::jsonb, null)`, [R3.id, JSON.stringify([{ line_id: r3line, condition: 'good' }])]);
  const early = await tryq(`select wh_return_complete($1, null)`, [R3.id]);
  await as(custA, 'aal1');
  await db.query(`select wh_return_decide($1, 'discard', null)`, [R3.id]);
  await owner();
  const lampBefore3 = await one(`select on_hand_qty from warehouse_stock where warehouse_id = 'FS-01' and item_id = $1`, [LAMP.item]);
  await as(recv);
  const done3 = (await one(`select wh_return_complete($1, null) r`, [R3.id])).r;
  await as(custA, 'aal1');
  const lateChange = await tryq(`select wh_return_decide($1, 'restock', null)`, [R3.id]);
  await owner();
  const lampAfter3 = await one(`select on_hand_qty from warehouse_stock where warehouse_id = 'FS-01' and item_id = $1`, [LAMP.item]);
  const r3moves = Number((await one(`select count(*) n from warehouse_stock_movements where reason like $1`, [`%${R3.code}%`])).n);
  ok(/INVALID_STEP/.test(early.err ?? '') && done3.decision === 'discard' && done3.units === 0 && r3moves === 0 && lampAfter3.on_hand_qty === lampBefore3.on_hand_qty
     && /INVALID_STEP/.test(lateChange.err ?? ''),
    'discard: nothing is posted and stock is unchanged; staff can\'t complete before the client decides; the client can\'t change a completed return');

  // ── 6. default after the decision date; empty charge ──
  await as(recv);
  const R4 = (await one(`select wh_return_register($1, 'FS-01', null, null, null, $2::jsonb) r`, [orgB, JSON.stringify([{ sku_id: sOther, qty: '2' }])])).r;
  const rp4 = `FS-01/${R4.code}/${crypto.randomUUID()}.png`;
  await owner();
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-returns', $1, $2)`, [rp4, recv]);
  await as(recv);
  await db.query(`select wh_return_add_photo($1, $2)`, [R4.id, rp4]);
  const r4line = (await one(`select id from wh_return_lines where return_id = $1`, [R4.id])).id;
  await db.query(`select wh_return_inspect($1, $2::jsonb, null)`, [R4.id, JSON.stringify([{ line_id: r4line, condition: 'good' }])]);
  await as(sup);
  const notDue = await tryq(`select wh_return_apply_default($1)`, [R4.id]);
  await owner();
  await db.query(`update wh_returns set decide_by = now() - interval '1 day' where id = $1`, [R4.id]);
  await as(recv);
  const recvDefault = await tryq(`select wh_return_apply_default($1)`, [R4.id]);
  await as(sup);
  const def = (await one(`select wh_return_apply_default($1) r`, [R4.id])).r;
  await owner();
  const r4 = await one(`select * from wh_returns where id = $1`, [R4.id]);
  ok(/NOT_DUE/.test(notDue.err ?? '') && /FORBIDDEN/.test(recvDefault.err ?? '') && def.decision === 'restock' && r4.decision_source === 'default' && r4.status === 'decided',
    'default: only a supervisor, only after the decide-by date; restock when a unit is good (source = default)');
  ok(r4.charge_units === 2 && r4.charge_per_item_cents === null && r4.charge_cents === null,
    'charge: the client\'s plan has no returns rate → charge stays empty (units recorded, never 0 cents)');

  // ── 7. support requests ──
  await as(custA, 'aal1');
  const badType = await tryq(`select wh_create_support_request($1, 'nope', 'Box damaged', 'The box arrived crushed.', null, '[]'::jsonb)`, [orgA]);
  const foreignRef = await tryq(`select wh_create_support_request($1, 'order_problem', 'Box damaged', 'The box arrived crushed.', $2, '[]'::jsonb)`, [orgA, shipB.code]);
  const badAtt = await tryq(`select wh_create_support_request($1, 'order_problem', 'Box damaged', 'The box arrived crushed.', $2, $3::jsonb)`,
    [orgA, shipA.code, JSON.stringify([{ path: `${orgB}/x.png`, name: 'x.png' }])]);
  const req = (await one(`select wh_create_support_request($1, 'order_problem', 'Box damaged', 'The box arrived crushed.', $2, $3::jsonb) r`,
    [orgA, shipA.code.toLowerCase(), JSON.stringify([{ path: `${orgA}/${crypto.randomUUID()}-carton.jpg`, name: 'carton.jpg' }])])).r;
  const mine = (await one(`select wh_portal_support($1) r`, [orgA])).r;
  const ctxA = (await one(`select wh_ticket_context($1) c`, [req.id])).c;
  const linksA = Number((await one(`select count(*) n from wh_support_links`)).n);
  const tkA = await one(`select category, status::text, subject from tickets where id = $1`, [req.id]);
  await as(custB, 'aal1');
  const ctxB = await tryq(`select wh_ticket_context($1)`, [req.id]);
  const reqB = await tryq(`select wh_create_support_request($1, 'other', 'Hello there', 'Just a question.', null, '[]'::jsonb)`, [orgA]);
  await as(admin);
  const ctxStaff = (await one(`select wh_ticket_context($1) c`, [req.id])).c;
  const linksStaff = Number((await one(`select count(*) n from wh_support_links where ticket_id = $1`, [req.id])).n);
  await owner();
  const tk = await one(`select t.category, t.division_id = division_id_of('3PL') div, (select count(*) from ticket_messages m where m.ticket_id = t.id)::int msgs,
                               (select jsonb_array_length(attachments) from ticket_messages m where m.ticket_id = t.id limit 1) atts from tickets t where t.id = $1`, [req.id]);
  ok(/INVALID_TYPE/.test(badType.err ?? '') && /INVALID_REFERENCE/.test(foreignRef.err ?? '') && /INVALID_ATTACHMENTS/.test(badAtt.err ?? '') && /^TKT-/.test(req.code),
    'support: type checked, the reference must be the company\'s own order, attachments must be in the company\'s folder');
  ok(tk.category === 'warehouse' && tk.div === true && tk.msgs === 1 && tk.atts === 1 && tkA && tkA.subject === 'Box damaged'
     && mine.length === 1 && mine[0].ref === shipA.code && mine[0].kind === 'order_problem',
    'support: an ordinary ticket (category warehouse, 3PL division) with the first message + attachment; the portal list shows type and reference');
  ok(ctxA && ctxA.order.code === shipA.code && ctxA.order.packed === true && !ctxA.owner && /NOT_FOUND/.test(ctxB.err ?? '') && /FORBIDDEN/.test(reqB.err ?? '')
     && ctxStaff && ctxStaff.owner === 'W5 Client Lamps' && ctxStaff.order.code === shipA.code && linksA === 0 && linksStaff === 1,
    'support: the client and the support desk see the linked order (packing record); another company sees nothing; links are readable by support staff only');

  // ── 8. ledger, audit, wipe ──
  const unbalanced = await all(`select s.item_id, s.on_hand_qty, s.reserved_qty, coalesce(sum(m.on_hand_delta), 0)::int oh, coalesce(sum(m.reserved_delta), 0)::int rs
                                  from warehouse_stock s left join warehouse_stock_movements m on m.warehouse_id = s.warehouse_id and m.item_id = s.item_id
                                 where s.warehouse_id = 'FS-01' and s.item_id = any($1::uuid[])
                                 group by s.item_id, s.on_hand_qty, s.reserved_qty
                                having s.on_hand_qty <> coalesce(sum(m.on_hand_delta), 0) or s.reserved_qty <> coalesce(sum(m.reserved_delta), 0)`, [[LAMP.item, HUB.item, OTH.item]]);
  ok(unbalanced.length === 0, `ledger: on hand and reserved equal the sum of movements for every test item${unbalanced.length ? ' — ' + JSON.stringify(unbalanced) : ''}`);
  const acts = (await all(`select distinct action from audit_log where created_at >= now() - interval '1 hour'
      and (entity_id in ($1, $2, $3, $4, $5, $6, $7) or (entity = 'wh_orders' and entity_id = $8))`,
    [R1.id, R2.id, R3.id, R4.id, req.id, sLamp, sHub, sbo?.id ?? R1.id])).map((r) => r.action);
  const need = ['wh_return.registered', 'wh_return.photo_added', 'wh_return.inspected', 'wh_return.decided', 'wh_return.done', 'wh_return.default_applied',
    'wh_support.created', 'wh_client_sku.photo_set', 'wh_order.created', 'wh_order.allocated', 'wh_order.picked'];
  const missingActs = need.filter((a) => !acts.includes(a));
  ok(missingActs.length === 0, `audit: every W5 step is in the audit log${missingActs.length ? ' — missing ' + missingActs.join(', ') : ''}`);
  await db.query('savepoint wipe');
  const wipe = await tryq(`select wipe_demo_data('DELETE DEMO DATA FOR ydbxqrizjxpduqbgnwxg', null) r`);
  if (wipe.err) {
    ok(false, `demo wipe ran (${wipe.err.slice(0, 160)})`);
  } else {
    const left = await one(`select (select count(*) from wh_returns where org_id in ($1, $2))::int rt, (select count(*) from wh_return_lines where return_id in ($3, $4))::int rl,
                                   (select count(*) from wh_return_photos where return_id = $3)::int ph, (select count(*) from wh_support_links where org_id = $1)::int sl`, [orgA, orgB, R1.id, R2.id]);
    ok(left.rt === 0 && left.rl === 0 && left.ph === 0 && left.sl === 0, 'demo wipe: the demo clients\' returns, lines, photos and support links go with them (cascade); wipe_demo_data not replaced');
  }
  await db.query('rollback to savepoint wipe');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  ok(!(await db.query(`select 1 from auth.users where email like 'w5-%@test.local'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nW5 warehouse: ${failed} check(s) failed` : '\nW5 warehouse: all passed');
process.exitCode = failed ? 1 : 0;
