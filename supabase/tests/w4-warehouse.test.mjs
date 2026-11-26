// Warehouse OS · W4 DB checks — carrier accounts / services, carrier rules (versions, two people, evaluation), parcel labels
// (sandbox, private bucket, label check refusing the wrong label + 'label' exception), void, dispatch batches with manifest,
// freight pallets, tracking events, the public tracking data (no internal fields; sandbox never served on live), Octopus Dropship
// sync through the existing shipments table, audit, demo wipe. STAGING ONLY, rolled-back transactions.
//  0. Down → up → down → up: the W4 down removes every W4 object and changes nothing else (no function is replaced); up again
//     gives identical functions, grants, policies, columns, constraints, indexes and triggers; second down = first down.
//  1. Setup: staff per role at FS-01 (two warehouse admins), a client with SKUs (plain, battery, liquid), orders written straight at
//     'packed' (single parcel via the W3b trigger; a two-parcel order). Existing FS-01 carrier config and materials are set aside.
//  2. Accounts and services: warehouse admins only; sandbox only on a staging database; live needs a credentials NAME.
//  3. Rules: proposed by a warehouse admin, approved by a DIFFERENT admin (function + CHECK constraint); supervisors can't;
//     one waiting proposal; reject needs a reason; approving supersedes.
//  4. Evaluation (wh_carrier_pick): country, dangerous goods, weight range, skipped services, fallback, no service.
//  5. Labels: plan → PDF in the private bucket → record; path / mode / upload checks; order → labelled; no-service → carrier exception.
//  6. Label check: unknown and other-order labels refused + logged + one 'label' exception; the right label confirms and resolves it.
//  7. Void (supervisor; order back to packed even though it has parcels), new label, old label → 'voided'.
//  8. Dispatch: only checked labels of the batch's account; hand-over needs who took it; manifest; orders shipped + token; locked after.
//  9. Freight pallet: client orders only (no Dropship, no labelled order), weight ≥ parcels, forwarder; shipped + token.
// 10. Tracking: staff events after hand-over only; sandbox steps; the public data has no carrier / supplier / buyer / staff / codes;
//     a sandbox shipment is not served when the database is not staging; customers read only their own token.
// 11. Dropship: hand-over creates the store order's shipments row (existing token, domain event for the store, merchant status),
//     get_public_dropship_tracking keeps working, events are mirrored; no stock movement.
// 12. Audit rows; the staging demo wipe removes the demo client's W4 rows (cascade) and keeps warehouse-level batches / pallets.
// Run: node --env-file=.env.staging supabase/tests/w4-warehouse.test.mjs
import { snapshotSequences, restoreSequences } from './lib-seq-guard.mjs';
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
const __seqs = await snapshotSequences(db); // wipe_demo_data() resets sequences; a rollback doesn't undo that

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
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w4_carriers_dispatch_tracking(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));
const W4_TABLES = ['wh_carrier_accounts', 'wh_carrier_services', 'wh_carrier_rule_versions', 'wh_carrier_rules', 'wh_dispatches', 'wh_freight_pallets',
  'wh_freight_parcels', 'wh_shipments', 'wh_label_scans', 'wh_tracking_events'];
const W4_FNS = ['wh_env_is_staging', 'wh_product_type_matches', 'wh_carrier_rule_text', 'wh_service_problem', 'wh_carrier_pick', 'wh_save_carrier_account',
  'wh_save_carrier_service', 'wh_propose_carrier_rules', 'wh_decide_carrier_rules', 'wh_carrier_version_json', 'wh_carriers_board', 'wh_label_parcel_check',
  'wh_label_plan', 'wh_order_label_state', 'wh_label_record', 'wh_label_confirm', 'wh_label_void', 'wh_label_printed', 'wh_legacy_status', 'wh_order_maybe_ship',
  'wh_tracking_apply', 'wh_dispatch_open', 'wh_dispatch_scan', 'wh_dispatch_remove', 'wh_dispatch_close', 'wh_dispatch_cancel', 'wh_freight_create',
  'wh_freight_add', 'wh_freight_remove', 'wh_freight_close', 'wh_freight_reopen', 'wh_freight_dispatch', 'wh_freight_label_printed', 'wh_tracking_add',
  'wh_tracking_sandbox_next', 'wh_tracking_poll_targets', 'wh_tracking_record_carrier', 'wh_public_tracking', 'wh_label_json', 'wh_dispatch_board',
  'wh_parcel_label_board', 'wh_labels_can_upload'];
const INTERNAL = ['wh_env_is_staging', 'wh_product_type_matches', 'wh_carrier_rule_text', 'wh_service_problem', 'wh_carrier_version_json', 'wh_label_parcel_check',
  'wh_order_label_state', 'wh_legacy_status', 'wh_order_maybe_ship', 'wh_tracking_apply', 'wh_tracking_poll_targets', 'wh_tracking_record_carrier', 'wh_label_json'];
const W4_COLS = [['wh_orders', 'tracking_token'], ['wh_orders', 'shipped_at']];

try {
  // ── 0. down → up → down → up ──
  await db.query('begin');
  const snap = async () => ({
    fn: await all(`select p.oid::regprocedure::text f, p.proname n, p.proacl::text a, md5(p.prosrc) s, pg_get_function_arguments(p.oid) args, p.prosecdef d, p.proconfig::text c
                     from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like 'wh\\_%' or p.proname in ('record_warehouse_stock_movement', 'wipe_demo_data', 'write_audit', 'get_public_dropship_tracking',
                           'create_store_order_shipment', 'system_record_tracking', 'shipments_emit_dropship_event', 'process_dropship_domain_events')) order by 1`),
    pol: await all(`select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
                     where (schemaname = 'public' and (tablename like 'wh\\_%' or tablename in ('shipments', 'tracking_events', 'carriers'))) or (schemaname = 'storage' and policyname like 'wh %') order by 1, 2, 3`),
    tg: await all(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger
                    where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and (relname like 'wh\\_%' or relname in ('shipments', 'tracking_events'))) order by 1, 2`),
    tp: await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
                    where table_schema = 'public' and (table_name like 'wh\\_%' or table_name in ('shipments', 'tracking_events', 'carriers')) and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and (table_name like 'wh\\_%' or table_name = 'shipments') and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    col: await all(`select table_name, column_name, column_default, is_nullable, data_type from information_schema.columns
                     where table_schema = 'public' and (table_name like 'wh\\_%' or table_name in ('shipments', 'tracking_events')) order by 1, 2`),
    con: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
                     where connamespace = 'public'::regnamespace and (conrelid::regclass::text like 'wh\\_%' or conrelid::regclass::text in ('shipments', 'tracking_events')) order by 1, 2`),
    idx: await all(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and (tablename like 'wh\\_%' or tablename in ('shipments', 'tracking_events')) order by 1, 2`),
    seq: await all(`select sequencename from pg_sequences where schemaname = 'public' and sequencename like 'seq\\_wh\\_%' order by 1`),
    rls: await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'wh\\_%' order by 1`),
  });
  const S = (x) => JSON.stringify(x);
  const diff = (a, b) => { for (const k of Object.keys(a)) if (S(a[k]) !== S(b[k])) console.log('  diff in', k); };
  const upFile = mig('supabase/migrations');
  const downFile = mig('supabase/migrations/down');
  ok(Boolean(upFile && downFile), `W4 migration files found (${upFile} / ${downFile})`);
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, upFile);
  await unwind(db, later);
  const withW4 = await snap();
  const capsBefore = Number((await one(`select count(*) n from wh_role_capabilities where action = 'dispatch'`)).n);
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without = await snap();
  const leftT = without.rls.filter((r) => W4_TABLES.includes(r.relname));
  const leftF = without.fn.filter((r) => W4_FNS.includes(r.n));
  const leftC = without.col.filter((c) => W4_COLS.some(([t, n]) => c.table_name === t && c.column_name === n));
  const capsAfter = Number((await one(`select count(*) n from wh_role_capabilities where action = 'dispatch'`)).n);
  const keptFns = withW4.fn.filter((r) => !W4_FNS.includes(r.n));
  ok(leftT.length === 0 && leftF.length === 0 && leftC.length === 0 && !without.seq.some((s) => /seq_wh_(shipment|dispatch|freight)/.test(s.sequencename))
     && !without.pol.some((p) => /wh labels/.test(p.policyname)) && capsBefore === 3 && capsAfter === 0,
    'down: every W4 table, function, policy, column, sequence and the dispatch capability rows are gone');
  ok(S(keptFns) === S(without.fn), `down: every other warehouse / Dropship tracking function is byte-identical (nothing replaced — ${keptFns.length} functions)`);
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  const again = await snap();
  if (S(again) !== S(withW4)) diff(withW4, again);
  ok(S(again) === S(withW4), 'up again: identical functions, grants, policies, columns, constraints, indexes, triggers, RLS');
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without2 = await snap();
  if (S(without2) !== S(without)) diff(without, without2);
  ok(S(without2) === S(without), 'down again: the same schema as the first down (up → down leaves no difference)');
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  await reapply(db, later);
  const rlsAll = withW4.rls.filter((r) => W4_TABLES.includes(r.relname));
  const writeGrants = withW4.tp.filter((g) => W4_TABLES.includes(g.table_name) && ['anon', 'authenticated'].includes(g.grantee) && g.privilege_type !== 'SELECT');
  const anonAny = withW4.tp.filter((g) => W4_TABLES.includes(g.table_name) && g.grantee === 'anon');
  const pubFns = withW4.fn.filter((f) => W4_FNS.includes(f.n) && f.n !== 'wh_public_tracking' && (/(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? '')));
  const notDefiner = withW4.fn.filter((f) => W4_FNS.includes(f.n) && !['wh_product_type_matches', 'wh_carrier_rule_text', 'wh_legacy_status'].includes(f.n)
    && (!f.d || !/search_path=public/.test(f.c ?? '')));
  const internalOpen = withW4.fn.filter((f) => INTERNAL.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  const publicTracking = withW4.fn.find((f) => f.n === 'wh_public_tracking');
  ok(rlsAll.length === W4_TABLES.length && rlsAll.every((r) => r.relrowsecurity) && writeGrants.length === 0 && anonAny.length === 0,
    'RLS on every W4 table; authenticated may only SELECT (wh_sees policies); anon has nothing');
  ok(pubFns.length === 0 && notDefiner.length === 0 && internalOpen.length === 0 && /anon=X/.test(publicTracking?.a ?? '') && !/(^\{|,)=X\//.test(publicTracking?.a ?? ''),
    `W4 functions: security definer + search_path=public, not executable by public/anon (only wh_public_tracking is open to anon); internal helpers not by authenticated${notDefiner.length ? ' — ' + notDefiner.map((f) => f.n).join(',') : ''}${pubFns.length ? ' — open: ' + pubFns.map((f) => f.n).join(',') : ''}`);
  const credCols = withW4.col.filter((c) => W4_TABLES.includes(c.table_name) && /secret|password|api_key|app_key|token_value/.test(c.column_name));
  ok(credCols.length === 0, 'no credential column in any W4 table (accounts store only the server setting NAME)');
  await db.query('rollback');

  await db.query('begin');
  // ── 1. setup ──
  const tag = String(Math.floor(Math.random() * 9000) + 1000);
  const mkUser = async (t, role = null) => {
    const e = `w4-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`, [id, `W4 ${t}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const whAdmin = await mkUser('whadmin', 'warehouse');
  const whAdmin2 = await mkUser('whadmin2', 'warehouse');
  const sup = await mkUser('sup', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  const recv = await mkUser('recv', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin'), ($2, 'FS-01', 'admin'), ($3, 'FS-01', 'supervisor'),
    ($4, 'FS-01', 'packer'), ($5, 'FS-01', 'receiver')`, [whAdmin, whAdmin2, sup, packer, recv]);
  const orgA = (await one(`insert into organizations(name, country, is_seed) values ('W4 Client Lamps', 'AE', true) returning id`)).id;
  const custA = await mkUser('custa');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [orgA, custA]);
  await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01')`, [orgA]);
  // whatever FS-01 already has is set aside inside this rolled-back transaction
  await db.query(`update wh_materials set active = false where warehouse_code = 'FS-01'`);
  await db.query(`update wh_carrier_rule_versions set status = 'superseded' where warehouse_code = 'FS-01' and status = 'active'`);
  await db.query(`update wh_carrier_rule_versions set status = 'rejected', reject_reason = 'set aside by the W4 test' where warehouse_code = 'FS-01' and status = 'pending_approval'`);
  await db.query(`update wh_carrier_accounts set active = false where warehouse_code = 'FS-01'`);
  const env = (await one(`select value #>> '{}' v from site_settings where key = 'app_environment'`)).v;
  await as(custA, 'aal1');
  const sLamp = (await one(`select wh_save_client_sku($1, null, 'W4-LAMP', 'Desk lamp', 'W44711', 450, false, false) id`, [orgA])).id;
  const sBank = (await one(`select wh_save_client_sku($1, null, 'W4-BANK', 'Power bank', null, 120, true, false) id`, [orgA])).id;
  const sPerf = (await one(`select wh_save_client_sku($1, null, 'W4-PERF', 'Room spray', null, 200, false, true) id`, [orgA])).id;
  await owner();
  const item = async (s) => (await one(`select item_id from wh_client_skus where id = $1`, [s])).item_id;
  const LAMP = { item: await item(sLamp), sku: 'W4-LAMP', name: 'Desk lamp', w: 450 };
  const BANK = { item: await item(sBank), sku: 'W4-BANK', name: 'Power bank', w: 120 };
  const PERF = { item: await item(sPerf), sku: 'W4-PERF', name: 'Room spray', w: 200 };
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'W4 carton', 100) returning id`, [`W4B${tag}`])).id;
  // an order written straight at 'packed': lines picked + packed, box, weight inside tolerance; the W3b trigger records parcel 1.
  // parcels: null = one parcel (W3b single close); otherwise [[line indexes]] → closed parcels written first (multi-parcel)
  const mkPacked = async (lines, country, { org = orgA, store = null, parcels = null } = {}) => {
    const exp = lines.reduce((n, l) => n + l.qty * l.w, 0) + 100;
    const o = await one(`insert into wh_orders (warehouse_code, source, org_id, store_order_id, external_ref, ship_name, ship_address, ship_country, status, picked_at, box_id,
        expected_weight_g, tolerance_g, measured_weight_g)
      values ('FS-01', $1, $2, $3, $4, 'Erika Muster', '{"line1": "Hauptstrasse 5", "city": "Berlin", "postcode": "10115"}'::jsonb, $5, 'packing', now(), $6, $7, 50, $7) returning id, code`,
      [store ? 'dropship' : 'client_portal', store ? null : org, store, store ? null : `W4-${tag}-${crypto.randomUUID().slice(0, 6)}`, country, box, exp]);
    const ids = [];
    for (const l of lines) {
      ids.push((await one(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, packed_qty, unit_weight_g) values ($1, $2, $3, $4, $5, $5, $5, $6) returning id`,
        [o.id, l.item, l.sku, l.name, l.qty, l.w])).id);
    }
    await db.query(`select wh_refresh_dg($1)`, [o.id]);
    if (parcels) {
      for (const [i, idx] of parcels.entries()) {
        const pw = idx.reduce((n, k) => n + lines[k].qty * lines[k].w, 0) + 100;
        const p = (await one(`insert into wh_parcels (order_id, warehouse_code, seq, status, source, box_id, expected_weight_g, tolerance_g, measured_weight_g, battery_mark, closed_at)
          values ($1, 'FS-01', $2, 'closed', 'multi', $3, $4, 50, $4, $5, now()) returning id`, [o.id, i + 1, box, pw, idx.some((k) => lines[k].sku === 'W4-BANK')])).id;
        for (const k of idx) await db.query(`insert into wh_parcel_items (parcel_id, order_id, line_id, qty) values ($1, $2, $3, $4)`, [p, o.id, ids[k], lines[k].qty]);
      }
      await db.query(`select set_config('octopus.wh_parcel_op', 'true', true)`);
    }
    await db.query(`update wh_orders set status = 'packed', packed_at = now(), packed_by = $2, battery_mark = has_dangerous_goods where id = $1`, [o.id, packer]);
    await db.query(`select set_config('octopus.wh_parcel_op', '', true)`);
    const ps = await all(`select id, seq, measured_weight_g from wh_parcels where order_id = $1 order by seq`, [o.id]);
    return { ...o, parcels: ps };
  };
  const ord = async (id) => one(`select * from wh_orders where id = $1`, [id]);
  const oA = await mkPacked([{ ...LAMP, qty: 1 }], 'DE');
  ok(oA.parcels.length === 1 && oA.parcels[0].measured_weight_g === 550 && env === 'staging',
    'setup: staff per role at FS-01 (two warehouse admins), a client with plain / battery / liquid SKUs, a packed order with parcel 1 (550 g)');

  // ── 2. accounts and services ──
  await as(packer);
  const packerAcc = await tryq(`select wh_save_carrier_account('FS-01', null, '4px', 'x', 'sandbox', null, true)`);
  await as(whAdmin);
  const A4 = (await one(`select wh_save_carrier_account('FS-01', null, '4px', $1, 'sandbox', null, true) id`, [`W4 4PX sandbox ${tag}`])).id;
  const AYT = (await one(`select wh_save_carrier_account('FS-01', null, 'yunexpress', $1, 'sandbox', null, true) id`, [`W4 YT sandbox ${tag}`])).id;
  const liveNoEnv = await tryq(`select wh_save_carrier_account('FS-01', null, '4px', $1, 'live', null, true)`, [`W4 live ${tag}`]);
  const badEnv = await tryq(`select wh_save_carrier_account('FS-01', null, '4px', $1, 'live', 'my key!', true)`, [`W4 live ${tag}`]);
  const live = (await one(`select wh_save_carrier_account('FS-01', null, '4px', $1, 'live', $2, false) id`, [`W4 live ${tag}`, `FOURPX_T${tag}`])).id;
  const PXSTD = (await one(`select wh_save_carrier_service($1, null, 'PX-STD', '4PX standard', 'standard', 2000, true, false, true) id`, [A4])).id;
  const PXEXP = (await one(`select wh_save_carrier_service($1, null, 'PX-EXP', '4PX express', 'express', 30000, false, false, true) id`, [A4])).id;
  const YTLIQ = (await one(`select wh_save_carrier_service($1, null, 'YT-LIQ', 'YunExpress liquids', 'standard', null, false, true, true) id`, [AYT])).id;
  const dupSvc = await tryq(`select wh_save_carrier_service($1, null, 'PX-STD', 'again', 'standard', null, false, false, true)`, [A4]);
  await owner();
  await db.query(`update site_settings set value = '"production"'::jsonb where key = 'app_environment'`);
  await as(whAdmin);
  const sandboxLive = await tryq(`select wh_save_carrier_account('FS-01', null, '4px', $1, 'sandbox', null, true)`, [`W4 sbx2 ${tag}`]);
  await owner();
  await db.query(`update site_settings set value = to_jsonb($1::text) where key = 'app_environment'`, [env]);
  const accRow = await one(`select * from wh_carrier_accounts where id = $1`, [live]);
  ok(/FORBIDDEN/.test(packerAcc.err ?? '') && /ENV_REQUIRED/.test(liveNoEnv.err ?? '') && /INVALID_ENV_NAME/.test(badEnv.err ?? '') && accRow.credential_env === `FOURPX_T${tag}`
     && /DUPLICATE_SERVICE/.test(dupSvc.err ?? '') && /SANDBOX_STAGING_ONLY/.test(sandboxLive.err ?? ''),
    'accounts: warehouse admins only; live needs the credentials setting NAME (stored, never a key); sandbox refused unless the database is staging; service codes unique per account');

  // ── 3. rules: two people ──
  const rules = [
    { countries: ['DE', 'FR'], product_type: 'battery', max_weight_g: 2000, service_id: PXSTD },
    { countries: ['de', 'FR'], product_type: 'general', min_weight_g: 0, max_weight_g: 30000, service_id: PXEXP },
    { countries: [], product_type: 'liquid', service_id: YTLIQ },
  ];
  await as(packer);
  const packerProp = await tryq(`select wh_propose_carrier_rules('FS-01', $1::jsonb, $2, null)`, [JSON.stringify(rules), PXEXP]);
  await as(whAdmin);
  const badCountry = await tryq(`select wh_propose_carrier_rules('FS-01', $1::jsonb, $2, null)`, [JSON.stringify([{ ...rules[0], countries: ['Germany'] }]), PXEXP]);
  const v1 = (await one(`select wh_propose_carrier_rules('FS-01', $1::jsonb, $2, 'W4 test rules') r`, [JSON.stringify(rules), PXEXP])).r;
  const twice = await tryq(`select wh_propose_carrier_rules('FS-01', $1::jsonb, $2, null)`, [JSON.stringify(rules), PXEXP]);
  const own = await tryq(`select wh_decide_carrier_rules($1, 'approve', null)`, [v1.id]);
  await as(sup);
  const supApprove = await tryq(`select wh_decide_carrier_rules($1, 'approve', null)`, [v1.id]);
  await owner();
  const sneak = await tryq(`update wh_carrier_rule_versions set status = 'active', approved_by = proposed_by, approved_at = now() where id = $1`, [v1.id]);
  const storedCountries = (await one(`select countries from wh_carrier_rules where version_id = $1 and seq = 2`, [v1.id])).countries;
  await as(whAdmin2);
  await db.query(`select wh_decide_carrier_rules($1, 'approve', null)`, [v1.id]);
  const v2 = (await one(`select wh_propose_carrier_rules('FS-01', $1::jsonb, $2, 'same rules, v2') r`, [JSON.stringify(rules), PXEXP])).r;
  await as(whAdmin);
  const noReason = await tryq(`select wh_decide_carrier_rules($1, 'reject', '  ')`, [v2.id]);
  await db.query(`select wh_decide_carrier_rules($1, 'approve', null)`, [v2.id]);
  await owner();
  const vers = await all(`select version, status, proposed_by, approved_by from wh_carrier_rule_versions where id in ($1, $2) order by version`, [v1.id, v2.id]);
  ok(/FORBIDDEN/.test(packerProp.err ?? '') && /INVALID_COUNTRY/.test(badCountry.err ?? '') && v1.rules === 3 && /PENDING_EXISTS/.test(twice.err ?? '')
     && /TWO_PERSON_REQUIRED/.test(own.err ?? '') && /FORBIDDEN/.test(supApprove.err ?? '') && /wh_carrier_rule_versions_two_person/.test(sneak.err ?? '')
     && storedCountries.join(',') === 'DE,FR',
    'rules: packers can\'t propose; country codes checked (stored upper-case); one waiting proposal; the proposer can\'t approve, a supervisor can\'t, and the table itself refuses approver = proposer');
  ok(vers.length === 2 && vers[0].status === 'superseded' && vers[0].approved_by === whAdmin2 && vers[1].status === 'active' && vers[1].approved_by === whAdmin
     && vers[1].proposed_by === whAdmin2 && /REASON_REQUIRED/.test(noReason.err ?? ''),
    'rules: a different warehouse admin approves (v1 by admin 2, v2 proposed by admin 2 and approved by admin 1); approving supersedes; rejecting needs a reason');

  // ── 4. evaluation ──
  await as(packer);
  const pick = async (c, dg, w) => (await one(`select wh_carrier_pick('FS-01', $1, $2::text[], $3) r`, [c, dg, w])).r;
  const e1 = await pick('de', ['battery'], 800);
  const e2 = await pick('FR', [], 1200);
  const e3 = await pick('US', ['liquid'], 300);
  const e4 = await pick('DE', ['magnet'], 500);
  const e5 = await pick('JP', [], 100);
  const e6 = await pick('DE', ['battery', 'liquid'], 500);
  const e7 = await pick('DE', [], null);
  const e8 = await pick('DE', ['battery'], 2500);
  await as(whAdmin);
  await db.query(`select wh_save_carrier_service($1, $2, 'PX-STD', '4PX standard', 'standard', 2000, true, false, false)`, [A4, PXSTD]);
  await as(packer);
  const e9 = await pick('DE', ['battery'], 800);
  await as(whAdmin);
  await db.query(`select wh_save_carrier_service($1, $2, 'PX-STD', '4PX standard', 'standard', 2000, true, false, true)`, [A4, PXSTD]);
  await as(custA, 'aal1');
  const custPick = await tryq(`select wh_carrier_pick('FS-01', 'DE', '{}'::text[], 100)`);
  await owner();
  ok(e1.ok && e1.service_id === PXSTD && e1.rule_seq === 1 && e1.reason === 'Rule 1 (DE, FR · battery · up to 2,000 g) → 4PX standard'
     && e2.service_id === PXEXP && e2.rule_seq === 2 && e3.service_id === YTLIQ && e3.rule_seq === 3,
    'evaluation: country (case-insensitive), product type from dangerous goods and weight pick the first matching rule, with the reason');
  ok(e4.fallback === true && e4.service_id === PXEXP && e5.fallback === true && /No rule matched → fallback 4PX express/.test(e5.reason)
     && e7.fallback === true && /rule 2: weight unknown/.test(e7.reason),
    'evaluation: nothing matches (other country, magnet only, unknown weight) → the fallback, saying why');
  ok(e6.ok === false && e6.service_id === null && /rule 1: 4PX standard does not take liquids/.test(e6.reason) && /fallback: 4PX express does not take batteries/.test(e6.reason)
     && e8.ok === false && e9.ok === false && /rule 1: 4PX standard is switched off/.test(e9.reason) && /FORBIDDEN/.test(custPick.err ?? ''),
    'evaluation: a matching rule whose service can\'t carry it (liquid, battery, switched off) is skipped; if the fallback can\'t either → no service; customers can\'t ask');

  // ── 5. labels ──
  const sbxNo = (carrier) => `SBX${carrier === '4px' ? 'PX' : 'YT'}${crypto.randomInt(100000, 999999)}${crypto.randomInt(100000, 999999)}`;
  const putPdf = async (path, who) => { await owner(); await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-labels', $1, $2)`, [path, who]); };
  const makeLabel = async (who, parcelId) => {
    await as(who);
    const plan = (await one(`select wh_label_plan($1) r`, [parcelId])).r;
    if (!plan.ok) { await owner(); return { plan }; }
    const no = sbxNo(plan.carrier);
    const path = `${plan.warehouse_code}/${plan.order_code}/P${plan.seq}-${no}.pdf`;
    await putPdf(path, who);
    await as(who);
    const rec = (await one(`select wh_label_record($1, $2, $3, $4, $5, $6) r`, [parcelId, plan.service_id, plan.rule_version_id, no, path, plan.reason])).r;
    await owner();
    return { plan, rec, no, path };
  };
  const pA = oA.parcels[0].id;
  await as(recv);
  const recvPlan = await tryq(`select wh_label_plan($1)`, [pA]);
  await as(packer);
  const planA = (await one(`select wh_label_plan($1) r`, [pA])).r;
  const noA = sbxNo('4px');
  const pathA = `FS-01/${oA.code}/P1-${noA}.pdf`;
  const notUploaded = await tryq(`select wh_label_record($1, $2, $3, $4, $5, $6)`, [pA, planA.service_id, planA.rule_version_id, noA, pathA, planA.reason]);
  const canUpPacker = (await one(`select wh_labels_can_upload($1) v`, [pathA])).v;
  await as(recv);
  const canUpRecv = (await one(`select wh_labels_can_upload($1) v`, [pathA])).v;
  await putPdf(pathA, packer);
  await as(packer);
  const badPath = await tryq(`select wh_label_record($1, $2, $3, $4, $5, $6)`, [pA, planA.service_id, planA.rule_version_id, noA, `FS-01/${oA.code}/P2-${noA}.pdf`, null]);
  const liveNo = await tryq(`select wh_label_record($1, $2, $3, 'PX12345678', $4, null)`, [pA, planA.service_id, planA.rule_version_id, `FS-01/${oA.code}/P1-PX12345678.pdf`]);
  const recA = (await one(`select wh_label_record($1, $2, $3, $4, $5, $6) r`, [pA, planA.service_id, planA.rule_version_id, noA, pathA, planA.reason])).r;
  const againA = await tryq(`select wh_label_plan($1)`, [pA]);
  await owner();
  const shA = await one(`select * from wh_shipments where parcel_id = $1 and status <> 'voided'`, [pA]);
  ok(/FORBIDDEN/.test(recvPlan.err ?? '') && planA.ok && planA.service_id === PXEXP && planA.mode === 'sandbox' && planA.carrier === '4px' && planA.credential_env === null
     && /^Rule 2 /.test(planA.reason) && planA.weight_g === 550 && planA.ship_to.country === 'DE',
    'label plan: receivers can\'t; packers get the rule-chosen service (4PX express, rule 2), the sandbox account and the parcel weight');
  ok(/LABEL_NOT_UPLOADED/.test(notUploaded.err ?? '') && canUpPacker === true && canUpRecv === false && /INVALID_LABEL_PATH/.test(badPath.err ?? '')
     && /TRACKING_MODE_MISMATCH/.test(liveNo.err ?? '') && recA.sandbox === true && recA.order_status === 'labelled' && /ALREADY_LABELLED/.test(againA.err ?? '')
     && shA.status === 'labelled' && shA.service_code === 'PX-EXP' && shA.label_path === pathA && shA.rule_version_id === v2.id,
    'label record: the PDF must be in the private bucket at <WH>/<WO>/P<seq>-<tracking>.pdf (upload policy: dispatch role only); sandbox numbers start with SBX; one label per parcel; order → labelled');
  // two parcels: lamp (rule 2) and power bank (battery → rule 1)
  const oM = await mkPacked([{ ...LAMP, qty: 1 }, { ...BANK, qty: 1 }], 'FR', { parcels: [[0], [1]] });
  const lM1 = await makeLabel(packer, oM.parcels[0].id);
  const midM = (await ord(oM.id)).status;
  const lM2 = await makeLabel(packer, oM.parcels[1].id);
  ok(lM1.plan.service_id === PXEXP && lM2.plan.service_id === PXSTD && lM2.plan.dg.join() === 'battery' && midM === 'packed' && (await ord(oM.id)).status === 'labelled',
    'multi-parcel: each parcel is decided on its own contents (battery parcel → 4PX standard); the order is labelled when every parcel has a label');
  const oN = await mkPacked([{ ...BANK, qty: 20 }], 'DE');
  const lN = await makeLabel(packer, oN.parcels[0].id);
  const excN = await one(`select kind, status, source, title from wh_exceptions where order_id = $1 and parcel_id = $2`, [oN.id, oN.parcels[0].id]);
  ok(lN.plan.ok === false && /No carrier service can take this parcel/.test(lN.plan.message) && excN?.kind === 'carrier' && excN.status === 'open' && excN.source === 'auto',
    'no usable service (2,500 g of batteries): no label, a carrier exception is raised on the queue');

  // ── 6. label check ──
  await as(packer);
  const cUnknown = (await one(`select wh_label_confirm($1, 'NOPE12345') r`, [oA.code])).r;
  const cOther = (await one(`select wh_label_confirm($1, $2) r`, [oA.code, lM1.no])).r;
  await owner();
  const excA = await all(`select code, kind, status from wh_exceptions where order_id = $1 and kind = 'label'`, [oA.id]);
  const scansA = await all(`select result, exception_id is not null x from wh_label_scans where order_id = $1 order by created_at`, [oA.id]);
  const shBefore = (await one(`select status from wh_shipments where id = $1`, [shA.id])).status;
  await as(packer);
  const cOk = (await one(`select wh_label_confirm($1, $2) r`, [oA.code.toLowerCase(), noA.toLowerCase()])).r;
  const cAgain = (await one(`select wh_label_confirm($1, $2) r`, [oA.code, noA])).r;
  const cWrongParcel = (await one(`select wh_label_confirm($1, $2, 2::smallint) r`, [oM.code, lM1.no])).r;
  await db.query(`select wh_label_confirm($1, $2)`, [oM.code, lM1.no]);
  await db.query(`select wh_label_confirm($1, $2)`, [oM.code, lM2.no]);
  await as(recv);
  const recvConfirm = await tryq(`select wh_label_confirm($1, $2)`, [oA.code, noA]);
  await owner();
  const excAafter = await one(`select status, resolution, resolution_action from wh_exceptions where order_id = $1 and kind = 'label'`, [oA.id]);
  ok(cUnknown.ok === false && cUnknown.result === 'unknown' && /not a label we printed/.test(cUnknown.message) && cOther.ok === false && cOther.result === 'wrong_order'
     && new RegExp(`label of ${oM.code} parcel 1`).test(cOther.message) && excA.length === 1 && excA[0].status === 'open' && cUnknown.exception === excA[0].code
     && cOther.exception === excA[0].code && scansA.map((s) => s.result).join() === 'unknown,wrong_order' && scansA.every((s) => s.x) && shBefore === 'labelled',
    'label check: an unknown label and another order\'s label are refused (returned, not raised), both scans logged, one open "label" exception on the queue; the label stays unchecked');
  ok(cOk.ok && cOk.result === 'ok' && cOk.all_confirmed === true && cAgain.result === 'already' && cWrongParcel.ok === false && cWrongParcel.result === 'wrong_parcel'
     && excAafter.status === 'resolved' && /right label was scanned for parcel 1/.test(excAafter.resolution) && excAafter.resolution_action === 'label_ok'
     && /FORBIDDEN/.test(recvConfirm.err ?? ''),
    'label check: the right label confirms the parcel and resolves the label exception; scanning again says so; a label on the wrong parcel of the same order is refused; receivers can\'t');

  // ── 7. void ──
  const shM2 = await one(`select id from wh_shipments where parcel_id = $1 and status <> 'voided'`, [oM.parcels[1].id]);
  await as(packer);
  const packerVoid = await tryq(`select wh_label_void($1, 'reprint')`, [shM2.id]);
  await as(sup);
  const voidNoReason = await tryq(`select wh_label_void($1, '')`, [shM2.id]);
  const voided = (await one(`select wh_label_void($1, 'Label smudged') r`, [shM2.id])).r;
  await owner();
  const afterVoid = (await ord(oM.id)).status;
  const lM2b = await makeLabel(packer, oM.parcels[1].id);
  await as(packer);
  const oldScan = (await one(`select wh_label_confirm($1, $2) r`, [oM.code, lM2.no])).r;
  await db.query(`select wh_label_confirm($1, $2)`, [oM.code, lM2b.no]);
  await owner();
  ok(/FORBIDDEN/.test(packerVoid.err ?? '') && /REASON_REQUIRED/.test(voidNoReason.err ?? '') && voided.order_status === 'packed' && afterVoid === 'packed'
     && lM2b.rec.order_status === 'labelled' && oldScan.result === 'voided' && oldScan.ok === false,
    'void: supervisors only, with a reason; the order goes back to packed (W3b guard passed), a new label relabels it; the old label scans as voided');

  // ── 8. dispatch ──
  const oB = await mkPacked([{ ...LAMP, qty: 2 }], 'DE');
  const lB = await makeLabel(packer, oB.parcels[0].id);
  const oL = await mkPacked([{ ...PERF, qty: 1 }], 'US');
  const lL = await makeLabel(packer, oL.parcels[0].id);
  await as(packer);
  await db.query(`select wh_label_confirm($1, $2)`, [oL.code, lL.no]);
  const d1 = (await one(`select wh_dispatch_open($1) r`, [A4])).r;
  const d1b = (await one(`select wh_dispatch_open($1) r`, [A4])).r;
  const sA = (await one(`select wh_dispatch_scan($1, $2) r`, [d1.id, noA])).r;
  const sM1 = (await one(`select wh_dispatch_scan($1, $2) r`, [d1.id, lM1.no])).r;
  const sM2 = (await one(`select wh_dispatch_scan($1, $2) r`, [d1.id, lM2b.no])).r;
  const sUnknown = (await one(`select wh_dispatch_scan($1, 'NOPE12345') r`, [d1.id])).r;
  const sUnchecked = (await one(`select wh_dispatch_scan($1, $2) r`, [d1.id, lB.no])).r;
  const sOtherAcc = (await one(`select wh_dispatch_scan($1, $2) r`, [d1.id, lL.no])).r;
  const noTo = await tryq(`select wh_dispatch_close($1, '  ', null)`, [d1.id]);
  const closed = (await one(`select wh_dispatch_close($1, 'Driver Wang (4PX pickup)', null) r`, [d1.id])).r;
  await as(sup);
  const voidAfter = await tryq(`select wh_label_void($1, 'too late')`, [shA.id]);
  await owner();
  const d1row = await one(`select * from wh_dispatches where id = $1`, [d1.id]);
  const oArow = await ord(oA.id);
  const oMrow = await ord(oM.id);
  const evA = await all(`select status, description, location, source from wh_tracking_events where shipment_id = $1`, [shA.id]);
  ok(d1b.existing === true && d1b.id === d1.id && sA.ok && sM1.ok && sM2.ok && sUnknown.ok === false && sUnchecked.ok === false && /Check the label/.test(sUnchecked.message)
     && sOtherAcc.ok === false && /another carrier account/.test(sOtherAcc.message) && sM2.count === 3,
    'dispatch: one open batch per account; only checked labels of that account go in (unknown, unchecked and other-account labels are refused with a sentence)');
  ok(/HANDED_TO_REQUIRED/.test(noTo.err ?? '') && closed.parcels === 3 && closed.orders_shipped === 2 && d1row.status === 'handed_over' && d1row.manifest_no === `MF-${d1row.code.slice(3)}`
     && d1row.handed_to === 'Driver Wang (4PX pickup)' && oArow.status === 'shipped' && oArow.shipped_at && /^[0-9a-f]{36}$/.test(oArow.tracking_token ?? '')
     && oMrow.status === 'shipped' && evA.length === 1 && evA[0].status === 'handed_over' && evA[0].location === 'Foshan, CN' && evA[0].source === 'system'
     && /LABEL_LOCKED/.test(voidAfter.err ?? ''),
    'hand-over: needs who took it; manifest number; every parcel handed over ("Handed to the carrier", Foshan, CN); both orders shipped with a tracking token; labels locked after');

  // ── 9. freight ──
  const oF = await mkPacked([{ ...LAMP, qty: 3 }], 'DE');
  const dsOrg = (await one(`insert into organizations(name, country) values ('W4 Merchant', 'US') returning id`)).id;
  const so = (await one(`insert into store_orders (org_id, channel, external_order_name, buyer_name, buyer_phone, shipping_address, destination_country, buyer_currency, shipping_method)
    values ($1, 'manual', $2, 'Bob Buyer', '+1 555 0100', '{"address1":"1 Main St","city":"Austin","state":"TX","zip":"73301"}'::jsonb, 'DE', 'USD', 'standard') returning id, order_number`,
    [dsOrg, `#W4-${tag}`]));
  const oD = await mkPacked([{ ...LAMP, qty: 1 }], 'DE', { store: so.id });
  await as(packer);
  const fp = (await one(`select wh_freight_create('FS-01', 'Amazon FBA LEJ1, Germany') r`)).r;
  const fAdd = (await one(`select wh_freight_add($1, $2) r`, [fp.id, oF.code])).r;
  const fShipped = await tryq(`select wh_freight_add($1, $2)`, [fp.id, oA.code]);
  const fDs = await tryq(`select wh_freight_add($1, $2)`, [fp.id, oD.code]);
  const fLabelled = await tryq(`select wh_freight_add($1, $2)`, [fp.id, oB.code]);
  const fPlan = await tryq(`select wh_label_plan($1)`, [oF.parcels[0].id]);
  const fLow = await tryq(`select wh_freight_close($1, 1000, 1200, 1000, 800)`, [fp.id]);
  await db.query(`select wh_freight_close($1, 25000, 1200, 1000, 800)`, [fp.id]);
  const fNoFw = await tryq(`select wh_freight_dispatch($1, '', null)`, [fp.id]);
  const fSent = (await one(`select wh_freight_dispatch($1, 'DB Schenker', 'BK-4711') r`, [fp.id])).r;
  await owner();
  const oFrow = await ord(oF.id);
  ok(fAdd.parcels === 1 && /ORDER_NOT_PACKED/.test(fShipped.err ?? '') && /FREIGHT_NOT_FOR_DROPSHIP/.test(fDs.err ?? '') && /ORDER_LABELLED/.test(fLabelled.err ?? '')
     && /ON_FREIGHT_PALLET/.test(fPlan.err ?? '') && /WEIGHT_TOO_LOW/.test(fLow.err ?? '') && /FORWARDER_REQUIRED/.test(fNoFw.err ?? '')
     && fSent.orders_shipped === 1 && oFrow.status === 'shipped' && /^[0-9a-f]{36}$/.test(oFrow.tracking_token ?? ''),
    'freight pallet: client orders only (not shipped, not Dropship, not labelled); a parcel on a pallet gets no carrier label; gross weight ≥ the parcels; forwarder required; dispatch ships the order');

  // ── 10. tracking + public data ──
  await as(packer);
  const notOut = await tryq(`select wh_tracking_add($1, null, 'in_transit', 'Moving', null, null)`, [lB.rec.id]);
  const badSt = await tryq(`select wh_tracking_add($1, null, 'teleported', 'Moving', null, null)`, [shA.id]);
  await db.query(`select wh_tracking_add($1, null, 'in_transit', 'Arrived at the Leipzig hub', 'Leipzig, DE', null)`, [shA.id]);
  const sb1 = (await one(`select wh_tracking_sandbox_next($1) r`, [shA.id])).r;
  const sb2 = (await one(`select wh_tracking_sandbox_next($1) r`, [shA.id])).r;
  const sb3 = await tryq(`select wh_tracking_sandbox_next($1)`, [shA.id]);
  await db.query(`select wh_tracking_add(null, $1, 'in_transit', 'Pallet left the port of Shenzhen', 'Shenzhen, CN', null)`, [fp.id]);
  await as(recv);
  const recvEv = await tryq(`select wh_tracking_add($1, null, 'info', 'x x x', null, null)`, [shA.id]);
  await owner();
  const shAend = await one(`select status, delivered_at from wh_shipments where id = $1`, [shA.id]);
  ok(/NOT_HANDED_OVER/.test(notOut.err ?? '') && /INVALID_STATUS/.test(badSt.err ?? '') && sb1.status === 'out_for_delivery' && sb2.status === 'delivered'
     && /NO_NEXT_STEP/.test(sb3.err ?? '') && /FORBIDDEN/.test(recvEv.err ?? '') && shAend.status === 'delivered' && shAend.delivered_at,
    'tracking: staff events only after hand-over and with a known status; sandbox steps (staging, sandbox labels) up to delivered; receivers can\'t add events');
  await anon();
  const pubA = (await one(`select wh_public_tracking($1) t`, [oArow.tracking_token])).t;
  const pubM = (await one(`select wh_public_tracking($1) t`, [oMrow.tracking_token])).t;
  const pubF = (await one(`select wh_public_tracking($1) t`, [oFrow.tracking_token])).t;
  const pubBad = (await one(`select wh_public_tracking('0123456789abcdef0123456789abcdef0123') t`)).t;
  const pubJunk = (await one(`select wh_public_tracking('not-a-token') t`)).t;
  const anonTable = await tryq(`select 1 from wh_shipments limit 1`);
  await owner();
  const KEYS = 'destination_country,events,freight,order_ref,parcels,sandbox,shipped_at,shipped_from_city,shipped_from_country,status,status_label';
  const pubText = JSON.stringify([pubA, pubM, pubF]);
  const banned = ['4PX', '4px', 'yunexpress', 'YunExpress', 'PX-EXP', 'PX-STD', '4PX express', 'standard', A4, AYT, 'Erika', 'Hauptstrasse', 'W4 Client Lamps', 'W4 ', 'FS-01',
    'label_path', '.pdf', 'Driver Wang', 'DB Schenker', 'BK-4711', 'supplier', 'whadmin', 'packer', 'Merchant'];
  const leaks = banned.filter((b) => pubText.includes(b));
  ok(Object.keys(pubA).sort().join(',') === KEYS && pubA.shipped_from_city === 'Foshan' && pubA.shipped_from_country === 'CN' && pubA.destination_country === 'DE'
     && pubA.status === 'delivered' && pubA.sandbox === true && pubA.order_ref.startsWith(`W4-${tag}`) && pubA.parcels[0].tracking_no === noA
     && pubA.events.map((e) => e.description).join('|') === 'Delivered (sandbox)|Out for delivery (sandbox)|Arrived at the Leipzig hub|Handed to the carrier',
    'public tracking: order reference, "shipped from Foshan, CN", destination, status, tracking number, events newest first; sandbox flagged');
  ok(leaks.length === 0 && pubM.parcels.length === 2 && pubM.parcels.every((p) => /^SBXPX/.test(p.tracking_no)) && pubF.freight === true && pubF.parcels[0].tracking_no === null
     && pubF.events.some((e) => e.description === 'Pallet left the port of Shenzhen') && pubF.events.some((e) => e.description === 'Handed to the freight forwarder')
     && pubBad === null && pubJunk === null && /permission denied/.test(anonTable.err ?? ''),
    `public tracking: no carrier, service, account, buyer, client, staff, warehouse code, file or forwarder in the data${leaks.length ? ' — LEAK: ' + leaks.join(', ') : ''}; both parcels; freight; unknown tokens → nothing; tables closed to anon`);
  await db.query(`update site_settings set value = '"production"'::jsonb where key = 'app_environment'`);
  await anon();
  const pubLive = (await one(`select wh_public_tracking($1) t`, [oArow.tracking_token])).t;
  const pubLiveF = (await one(`select wh_public_tracking($1) t`, [oFrow.tracking_token])).t;
  await owner();
  await db.query(`update site_settings set value = to_jsonb($1::text) where key = 'app_environment'`, [env]);
  await as(custA, 'aal1');
  const custOwn = await one(`select tracking_token, shipped_at from wh_orders where id = $1`, [oA.id]);
  const custShip = Number((await one(`select count(*) n from wh_shipments`)).n);
  const custEv = Number((await one(`select count(*) n from wh_tracking_events`)).n);
  await owner();
  ok(pubLive === null && pubLiveF !== null && custOwn.tracking_token === oArow.tracking_token && custOwn.shipped_at && custShip === 0 && custEv === 0,
    'a sandbox shipment is never served when the database is not staging (freight without sandbox labels still is); the client reads its own order\'s token, no W4 table rows');

  // ── 11. Dropship ──
  const movesBefore = Number((await one(`select count(*) n from warehouse_stock_movements where store_order_id = $1`, [so.id])).n);
  const lD = await makeLabel(packer, oD.parcels[0].id);
  await as(packer);
  await db.query(`select wh_label_confirm($1, $2)`, [oD.code, lD.no]);
  const d2 = (await one(`select wh_dispatch_open($1) r`, [A4])).r;
  await db.query(`select wh_dispatch_scan($1, $2)`, [d2.id, lD.no]);
  const closed2 = (await one(`select wh_dispatch_close($1, 'Driver Li', 'PX-MF-77') r`, [d2.id])).r;
  await owner();
  const oDrow = await ord(oD.id);
  const legacy = await one(`select * from shipments where store_order_id = $1`, [so.id]);
  const shD = await one(`select legacy_shipment_id from wh_shipments where parcel_id = $1 and status <> 'voided'`, [oD.parcels[0].id]);
  const ev = await one(`select event_type, external_status, payload from domain_events where aggregate_id = $1 and event_type = 'shipment.status_changed' order by created_at desc limit 1`, [legacy?.id]);
  const soRow = await one(`select merchant_status, staff_stage from store_orders where id = $1`, [so.id]);
  const map = (await one(`select resolve_dropship_status_mapping('3pl_shipment', 'picked_up') m`)).m;
  await anon();
  const dsPub = (await one(`select get_public_dropship_tracking($1) t`, [oDrow.tracking_token])).t;
  const whPubD = (await one(`select wh_public_tracking($1) t`, [oDrow.tracking_token])).t;
  await as(packer);
  const shDid = (await one(`select id from wh_shipments where parcel_id = $1 and status <> 'voided'`, [oD.parcels[0].id])).id;
  await db.query(`select wh_tracking_add($1, null, 'in_transit', 'Arrived in Germany', 'Frankfurt, DE', null)`, [shDid]);
  await owner();
  const mirrored = await all(`select status, description, provider_event_id from tracking_events where shipment_id = $1`, [legacy?.id]);
  const legacyAfter = await one(`select status from shipments where id = $1`, [legacy?.id]);
  const movesAfter = Number((await one(`select count(*) n from warehouse_stock_movements where store_order_id = $1`, [so.id])).n);
  ok(closed2.orders_shipped === 1 && oDrow.status === 'shipped' && legacy && legacy.tracking_no === lD.no && legacy.carrier_code === '4px' && legacy.status === 'picked_up'
     && legacy.order_id === null && legacy.org_id === dsOrg && legacy.tracking_token === oDrow.tracking_token && shD.legacy_shipment_id === legacy.id,
    'Dropship: hand-over writes the store order\'s row in the existing shipments table (tracking number, 4PX, picked up) and the order uses its tracking token');
  ok(ev && ev.external_status !== 'not_applicable' && ev.payload.tracking_no === lD.no && (!map || soRow.merchant_status === map.merchant_status)
     && dsPub && dsPub.tracking_no === lD.no && dsPub.order_ref === `#W4-${tag}` && whPubD && whPubD.order_ref === `#W4-${tag}` && whPubD.shipped_from_city === 'Foshan'
     && !JSON.stringify(whPubD).includes('W4 Merchant') && !JSON.stringify(whPubD).includes('Bob'),
    'Dropship: the existing domain event is marked for the store (external push) and the store order\'s status follows the mapping; /t/ works through both the Dropship and the warehouse data (no store / buyer name)');
  ok(mirrored.length === 1 && mirrored[0].status === 'in_transit' && /^wh:/.test(mirrored[0].provider_event_id) && legacyAfter.status === 'in_transit' && movesAfter === movesBefore,
    'Dropship: later events are mirrored into tracking_events and the shipment status (store sync); no stock movement was posted');

  // ── 12. audit + demo wipe ──
  const acts = (await all(`select distinct action from audit_log where action like any (array['wh_carrier%', 'wh_label.%', 'wh_dispatch.%', 'wh_freight.%', 'wh_tracking.%', 'wh_order.labelled', 'wh_order.shipped'])
    and created_at >= now() - interval '1 hour' and (entity_id in ($1, $2, $3, $4, $5, $6) or entity in ('wh_carrier_accounts', 'wh_carrier_rule_versions', 'wh_dispatches', 'wh_freight_pallets'))`,
    [oA.id, oM.id, oD.id, oF.id, oB.id, oL.id])).map((r) => r.action);
  const need = ['wh_carrier.account_created', 'wh_carrier.service_created', 'wh_carrier.service_updated', 'wh_carrier_rules.proposed', 'wh_carrier_rules.approved',
    'wh_label.created', 'wh_label.confirmed', 'wh_label.wrong_scan', 'wh_label.voided', 'wh_order.labelled', 'wh_dispatch.opened', 'wh_dispatch.added',
    'wh_dispatch.handed_over', 'wh_order.shipped', 'wh_freight.created', 'wh_freight.added', 'wh_freight.closed', 'wh_freight.dispatched', 'wh_tracking.event'];
  const missing = need.filter((a) => !acts.includes(a));
  ok(missing.length === 0, `audit: every W4 step is in the audit log${missing.length ? ' — missing ' + missing.join(', ') : ''}`);
  await db.query('savepoint wipe');
  const wipe = await tryq(`select wipe_demo_data('DELETE DEMO DATA FOR ydbxqrizjxpduqbgnwxg', null) r`);
  if (wipe.err) {
    ok(false, `demo wipe ran (${wipe.err.slice(0, 160)})`);
  } else {
    const leftShip = Number((await one(`select count(*) n from wh_shipments where order_id in ($1, $2, $3)`, [oA.id, oM.id, oF.id])).n);
    const leftScans = Number((await one(`select count(*) n from wh_label_scans where order_id = $1`, [oA.id])).n);
    const keptD = Number((await one(`select count(*) n from wh_dispatches where id = $1`, [d1.id])).n);
    const keptFp = await one(`select (select count(*) from wh_freight_parcels where pallet_id = $1)::int parcels, (select count(*) from wh_freight_pallets where id = $1)::int pallets`, [fp.id]);
    const keptDs = Number((await one(`select count(*) n from wh_shipments where order_id = $1`, [oD.id])).n);
    ok(leftShip === 0 && leftScans === 0 && keptD === 1 && keptFp.pallets === 1 && keptFp.parcels === 0 && keptDs === 1,
      'demo wipe: the demo client\'s labels, scans, events and pallet places go with its orders (cascade); hand-over batches and pallets (warehouse records) stay; other orders untouched');
  }
  await db.query('rollback to savepoint wipe');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await restoreSequences(__seqs).catch((e) => console.log('sequence restore failed:', e.message));
  ok(!(await db.query(`select 1 from auth.users where email like 'w4-%@test.local'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nW4 warehouse: ${failed} check(s) failed` : '\nW4 warehouse: all passed');
process.exitCode = failed ? 1 : 0;
