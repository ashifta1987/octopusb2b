// Warehouse OS · W6 DB checks — monthly 3PL client invoice (charges per fee type from real events at the rate version in effect at
// the event time, unset fees never billed, minimum top-up, one idempotent invoice per client and month through the existing
// proforma path, balanced ledger, payment → tax invoice), client isolation and drill-down references, reports (orders shipped,
// order-to-handoff, dock-to-shelf, exceptions, targets), pallet storage periods, retention purge markers, demo wipe.
// STAGING ONLY, rolled-back transactions.
//  0. Down → up → down → up: the W6 down removes every W6 object and changes nothing else (no function is replaced); up again gives
//     identical functions, grants, policies, columns, constraints, indexes and triggers; second down = first down. Security shape:
//     RLS on every W6 table, SELECT-only grants, nothing for anon, definer functions with search_path=public, internals closed.
//  1. Setup (March 2025, China time): client A (custom plan) with three rate versions over the month (plan-wide v1 from Jan, plan-wide
//     v2 from 16 Mar without an extra-item fee, FS-01-specific from 25 Mar), notices, shipped orders, a stored pallet, packaging
//     uses (priced, voided, unpriced), returns (priced, unpriced); client B (volume plan, no rates).
//  2. Charges: every fee type at the version in effect when it happened; storage split at each rate change; unset fees and
//     unmeasured quantities are lines "not set / not measured" with no amount; minimum top-up; client B has nothing to bill.
//  3. Permissions: who previews / issues; the month must be over.
//  4. Issue: proforma (3PL division, service warehouse) + invoice_lines + wh_invoice_lines with references; balanced journal;
//     idempotent; packaging uses / returns on it get invoiced_at; invoices are never changed; payment by bank transfer → tax invoice.
//  5. Client isolation, customer-safe columns, portal statements with drill-down.
//  6. Pallet storage periods (trigger), reports (orders shipped, handoff / dock-to-shelf hours, targets → within share, exceptions),
//     settings permissions.
//  7. Retention: due list (evidence past retention; return photos only with a setting), mark purged, service role only.
//  8. Audit rows. (Section 4 also runs the installed demo wipe in a savepoint: the demo client's invoices and pallet periods go
//     with it by cascade — sequences restored afterwards with lib-seq-guard.)
// Run: node --env-file=.env.staging supabase/tests/w6-warehouse.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import crypto from 'node:crypto';
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
const mig = (dir) => fs.readdirSync(dir).find((f) => /_w6_invoicing_reports_retention(\.down)?\.sql$/.test(f) && (dir.endsWith('down') ? f.includes('.down.') : !f.includes('.down.')));
const W6_TABLES = ['wh_pallet_stays', 'wh_service_settings', 'wh_invoices', 'wh_invoice_lines'];
const W6_FNS = ['wh_pallet_stay_track', 'wh_invoice_can_preview', 'wh_invoice_can_issue', 'wh_invoice_access', 'wh_invoice_guard', 'wh_rate_at', 'wh_month_start',
  'wh_invoice_compute', 'wh_invoice_json', 'wh_invoice_board', 'wh_invoice_preview', 'wh_invoice_issue', 'wh_portal_invoices', 'wh_save_service_settings',
  'wh_report', 'wh_retention_summary', 'wh_retention_due', 'wh_retention_mark'];
const INTERNAL = ['wh_pallet_stay_track', 'wh_invoice_guard', 'wh_rate_at', 'wh_invoice_compute', 'wh_invoice_json', 'wh_retention_due', 'wh_retention_mark'];
const CN = (s) => `${s}+08`; // China time literal
let seqs = null;

try {
  // ── 0. down → up → down → up ──
  await db.query('begin');
  const snap = async () => ({
    fn: await all(`select p.oid::regprocedure::text f, p.proname n, p.proacl::text a, md5(p.prosrc) s, pg_get_function_arguments(p.oid) args, p.prosecdef d, p.proconfig::text c
                     from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like 'wh\\_%' or p.proname in ('wipe_demo_data', 'write_audit', 'issue_service_proforma', 'pay_service_proforma', 'post_document_receivable',
                           'next_document_number', 'issue_proforma_tax_invoice', 'tag_seed_rows')) order by 1`),
    pol: await all(`select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
                     where (schemaname = 'public' and (tablename like 'wh\\_%' or tablename in ('documents', 'invoice_lines'))) or (schemaname = 'storage' and policyname like 'wh %') order by 1, 2, 3`),
    tg: await all(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) d from pg_trigger
                    where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and (relname like 'wh\\_%' or relname in ('documents', 'invoice_lines'))) order by 1, 2`),
    tp: await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
                    where table_schema = 'public' and table_name like 'wh\\_%' and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and table_name like 'wh\\_%' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    col: await all(`select table_name, column_name, column_default, is_nullable, data_type from information_schema.columns
                     where table_schema = 'public' and (table_name like 'wh\\_%' or table_name in ('documents', 'invoice_lines')) order by 1, 2`),
    con: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
                     where connamespace = 'public'::regnamespace and (conrelid::regclass::text like 'wh\\_%' or conrelid::regclass::text in ('documents', 'invoice_lines')) order by 1, 2`),
    idx: await all(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and (tablename like 'wh\\_%' or tablename in ('documents', 'invoice_lines')) order by 1, 2`),
    rls: await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'wh\\_%' order by 1`),
  });
  const S = (x) => JSON.stringify(x);
  const diff = (a, b) => { for (const k of Object.keys(a)) if (S(a[k]) !== S(b[k])) console.log('  diff in', k); };
  const upFile = mig('supabase/migrations');
  const downFile = mig('supabase/migrations/down');
  ok(Boolean(upFile && downFile), `W6 migration files found (${upFile} / ${downFile})`);
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, upFile);
  await unwind(db, later);
  const withW6 = await snap();
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without = await snap();
  const leftT = without.rls.filter((r) => W6_TABLES.includes(r.relname));
  const leftF = without.fn.filter((r) => W6_FNS.includes(r.n));
  const leftCols = without.col.filter((c) => c.column_name === 'purged_at' && ['wh_pack_evidence', 'wh_return_photos'].includes(c.table_name));
  const leftTg = without.tg.filter((t) => /wh_pallet_stay_track|wh_invoices?_(lines_)?guard/.test(t.tgname));
  const keptFns = withW6.fn.filter((r) => !W6_FNS.includes(r.n));
  ok(leftT.length === 0 && leftF.length === 0 && leftCols.length === 0 && leftTg.length === 0,
    'down: every W6 table, function, trigger and the purged_at columns are gone');
  ok(S(keptFns) === S(without.fn), `down: every other warehouse / finance function is byte-identical (nothing replaced — ${keptFns.length} functions)`);
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  const again = await snap();
  if (S(again) !== S(withW6)) diff(withW6, again);
  ok(S(again) === S(withW6), 'up again: identical functions, grants, policies, columns, constraints, indexes, triggers, RLS');
  await db.query(fs.readFileSync(`supabase/migrations/down/${downFile}`, 'utf8'));
  const without2 = await snap();
  if (S(without2) !== S(without)) diff(without, without2);
  ok(S(without2) === S(without), 'down again: the same schema as the first down (up → down leaves no difference)');
  await db.query(fs.readFileSync(`supabase/migrations/${upFile}`, 'utf8'));
  await reapply(db, later);
  const rlsAll = withW6.rls.filter((r) => W6_TABLES.includes(r.relname));
  const writeGrants = withW6.tp.filter((g) => W6_TABLES.includes(g.table_name) && ['anon', 'authenticated'].includes(g.grantee) && g.privilege_type !== 'SELECT');
  const anonAny = withW6.tp.filter((g) => W6_TABLES.includes(g.table_name) && g.grantee === 'anon');
  const anonCols = withW6.cg.filter((g) => W6_TABLES.includes(g.table_name) && g.grantee === 'anon');
  const pubFns = withW6.fn.filter((f) => W6_FNS.includes(f.n) && (/(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? '')));
  const notDefiner = withW6.fn.filter((f) => W6_FNS.includes(f.n) && (!f.d || !/search_path=public/.test(f.c ?? '')));
  const internalOpen = withW6.fn.filter((f) => INTERNAL.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  const invCols = withW6.cg.filter((g) => g.table_name === 'wh_invoices' && g.grantee === 'authenticated').map((g) => g.column_name);
  ok(rlsAll.length === W6_TABLES.length && rlsAll.every((r) => r.relrowsecurity) && writeGrants.length === 0 && anonAny.length === 0 && anonCols.length === 0,
    'RLS on every W6 table; authenticated may only SELECT; anon has nothing');
  ok(pubFns.length === 0 && notDefiner.length === 0 && internalOpen.length === 0,
    `W6 functions: security definer + search_path=public, not executable by public/anon; internal helpers not by authenticated${notDefiner.length ? ' — ' + notDefiner.map((f) => f.n).join(',') : ''}${pubFns.length ? ' — open: ' + pubFns.map((f) => f.n).join(',') : ''}`);
  ok(invCols.length > 0 && !invCols.includes('issued_by'), 'wh_invoices: customers get customer-safe columns only (who issued it stays staff-only)');
  await db.query('rollback');

  await db.query('begin');
  // ── 1. setup ──
  const tag = String(Math.floor(Math.random() * 9000) + 1000);
  const mkUser = async (t, role = null) => {
    const e = `w6-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`, [id, `W6 ${t}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const whAdmin = await mkUser('whadmin', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  const finance = await mkUser('finance', 'finance');
  const proposer = await mkUser('proposer', 'admin');
  const approver = await mkUser('approver', 'admin');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin'), ($2, 'FS-01', 'packer')`, [whAdmin, packer]);
  const orgA = (await one(`insert into organizations(name, country, is_seed) values ('W6 Client Lamps', 'AE', true) returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country, is_seed) values ('W6 Client Other', 'DE', true) returning id`)).id;
  const custA = await mkUser('custa');
  const custB = await mkUser('custb');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, custA, orgB, custB]);
  await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse, created_at) values ($1, 'custom', 'FS-01', '2025-01-01'), ($2, 'volume', 'FS-01', '2025-01-01')`, [orgA, orgB]);
  // rate versions over the test month — version numbers are per scope (plan-wide vs FS-01), so lines are matched by rate_version_id (recorded as superseded so they never clash with a real active version; both count as "in effect")
  const nextVer = async (wh) => Number((await one(`select coalesce(max(version), 0) + 1 v from wh_rate_versions where plan_code = 'custom' and coalesce(warehouse_code, '*') = $1`, [wh ?? '*'])).v);
  const addVer = async (wh, from, f) => (await one(`insert into wh_rate_versions (plan_code, warehouse_code, version, receiving_per_carton_cents, storage_per_pallet_month_cents, storage_per_cbm_month_cents,
      pick_pack_first_cents, pick_pack_extra_cents, returns_per_item_cents, min_monthly_cents, status, proposed_by, approved_by, effective_from)
      values ('custom', $1, $2, $3, $4, null, $5, $6, $7, $8, 'superseded', $9, $10, $11) returning id, version`,
    [wh, await nextVer(wh), f.rec, f.pal, f.first, f.extra, f.ret, f.min, proposer, approver, CN(from)]));
  const V1 = await addVer(null, '2025-01-01 00:00', { rec: 100, pal: 3000, first: 150, extra: 50, ret: 80, min: 100000 });
  const V2 = await addVer(null, '2025-03-16 00:00', { rec: 120, pal: 3000, first: 150, extra: null, ret: 80, min: 100000 });
  const VW = await addVer('FS-01', '2025-03-25 00:00', { rec: 90, pal: 6000, first: 200, extra: 60, ret: 80, min: 100000 });
  // notices received in March (cartons declared; one pallet-only) and one in April
  const asn = async (org, at, cartons, pallets = null) => (await one(`insert into wh_asns (org_id, warehouse_code, source, expected_date, cartons, pallets, status, received_at, created_at)
      values ($1, 'FS-01', 'client', ($2::timestamptz)::date, $3, $4, 'received', $2, ($2::timestamptz) - interval '3 days') returning id, code`, [org, CN(at), cartons, pallets]));
  const A1 = await asn(orgA, '2025-03-05 10:00', 10);
  const A2 = await asn(orgA, '2025-03-20 10:00', 4);
  const A3 = await asn(orgA, '2025-03-26 10:00', null, 2);
  const A4 = await asn(orgA, '2025-04-02 10:00', 7);
  const AB = await asn(orgB, '2025-03-07 10:00', 3);
  // shipped orders written straight at their step (no stock movement); created 24 h before shipping
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'W6 carton', 100) returning id`, [`W6B${tag}`])).id;
  const item = (await one(`insert into item_master (weight_g, has_battery, has_liquid) values (200, false, false) returning id`)).id;
  const mkShipped = async (org, units, shippedAt, store = null) => {
    const exp = units * 200 + 100;
    const o = await one(`insert into wh_orders (warehouse_code, source, org_id, store_order_id, external_ref, ship_name, ship_address, ship_country, status, picked_at, box_id, expected_weight_g, tolerance_g, measured_weight_g, created_at)
      values ('FS-01', $1, $2, $3, $4, 'Erika Muster', '{"line1": "Hauptstrasse 5", "city": "Berlin"}'::jsonb, 'DE', 'packing', now(), $5, $6, 50, $6, ($7::timestamptz) - interval '24 hours') returning id, code`,
      [store ? 'dropship' : 'client_portal', org, store, store ? null : `W6-${tag}-${Math.random().toString(36).slice(2, 7)}`, box, exp, CN(shippedAt)]);
    await db.query(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, packed_qty, unit_weight_g) values ($1, $2, 'W6-SKU', 'x', $3, $3, $3, 200)`, [o.id, item, units]);
    await db.query(`update wh_orders set status = 'packed', packed_at = $2, packed_by = $3 where id = $1`, [o.id, CN(shippedAt), packer]);
    await db.query(`update wh_orders set status = 'shipped', shipped_at = $2, tracking_token = md5(random()::text) where id = $1`, [o.id, CN(shippedAt)]);
    return o;
  };
  const O1 = await mkShipped(orgA, 3, '2025-03-10 12:00');
  const O2 = await mkShipped(orgA, 2, '2025-03-18 12:00');
  const O3 = await mkShipped(orgA, 1, '2025-03-28 12:00');
  const OB = await mkShipped(orgB, 2, '2025-03-11 12:00');
  // a pallet stored since February, still stored (storage-period row written directly; the trigger is checked in section 6)
  const P1 = (await one(`insert into wh_pallets (warehouse_code, org_id, status, created_at) values ('FS-01', $1, 'open', $2) returning id, code`, [orgA, CN('2025-02-20 09:00')]));
  await db.query(`insert into wh_pallet_stays (pallet_id, org_id, warehouse_code, started_at) values ($1, $2, 'FS-01', $3)`, [P1.id, orgA, CN('2025-02-20 09:00')]);
  // packaging: priced use (2 × 25), a voided use, an unpriced use
  const mat = (await one(`insert into wh_materials (warehouse_code, code, name, kind, unit, on_hand, charge_per_unit_cents) values ('FS-01', $1, 'W6 mailer', 'mailer', 'each', 100, 25) returning id`, [`W6M${tag}`])).id;
  const mat2 = (await one(`insert into wh_materials (warehouse_code, code, name, kind, unit, on_hand) values ('FS-01', $1, 'W6 filler', 'filler', 'each', 100) returning id`, [`W6F${tag}`])).id;
  const addUse = async (m, qty, unit, at, voided = false) => (await one(`insert into wh_material_usage (material_id, warehouse_code, order_id, org_id, qty, unit_charge_cents, charge_cents, source, move_id, created_at, voided_at, voided_by, void_reason, void_move_id)
      values ($1, 'FS-01', $2, $3, $4::integer, $5::bigint, $5::bigint * $4::integer, 'manual', gen_random_uuid(), $6, $7, null, $8, $9) returning id`,
    [m, O1.id, orgA, qty, unit, CN(at), voided ? CN(at) : null, voided ? 'W6 test void' : null, voided ? '00000000-0000-0000-0000-0000000000aa' : null])).id;
  const U1 = await addUse(mat, 2, 25, '2025-03-11 08:00');
  const U2 = await addUse(mat, 5, 25, '2025-03-11 09:00', true);
  const U3 = await addUse(mat2, 1, null, '2025-03-11 10:00');
  // returns inspected in March: priced (3 × 80) and unpriced
  const ret = async (at, units, per) => (await one(`insert into wh_returns (org_id, warehouse_code, status, inspected_at, decide_by, charge_units, charge_per_item_cents, charge_cents)
      values ($1, 'FS-01', 'inspected', $2, ($2::timestamptz) + interval '14 days', $3::integer, $4::bigint, $4::bigint * $3::integer) returning id, code`, [orgA, CN(at), units, per])).id;
  const R1 = await ret('2025-03-12 10:00', 3, 80);
  const R2 = await ret('2025-03-13 10:00', 2, null);
  const month = '2025-03-01';
  await db.query(`delete from wh_service_settings where warehouse_code = 'FS-01'`); // this transaction starts without targets

  // ── 2. charges ──
  await as(whAdmin);
  const pv = (await one(`select wh_invoice_preview($1, $2) p`, [orgA, month])).p;
  const L = pv.lines;
  const find = (kind, rv, status = null) => L.filter((l) => l.kind === kind && (rv === undefined || l.rate_version_id === rv) && (!status || l.status === status));
  const rec1 = find('receiving', V1.id)[0], rec2 = find('receiving', V2.id)[0], recU = L.find((l) => l.kind === 'receiving' && l.status === 'not_measured');
  ok(rec1 && rec1.qty === 10 && rec1.unit_cents === 100 && rec1.amount_cents === 1000 && rec2 && rec2.qty === 4 && rec2.amount_cents === 480
     && recU && recU.amount_cents === null && recU.refs[0].code === A3.code && !L.some((l) => l.refs.some((r) => r.code === A4.code)),
    `receiving: 10 cartons at v${V1.version} (US$1.00) + 4 at v${V2.version} (US$1.20); a pallet-only notice is "not measured" with no amount; April is not in March`);
  const pf = find('pick_first');
  const px = find('pick_extra');
  ok(pf.length === 3 && pf.find((l) => l.rate_version_id === V1.id)?.amount_cents === 150 && pf.find((l) => l.rate_version_id === V2.id)?.amount_cents === 150
     && pf.find((l) => l.rate_version_id === VW.id)?.amount_cents === 200 && pf.find((l) => l.rate_version_id === VW.id)?.refs[0].code === O3.code,
    'pick and pack first item: one line per rate version in effect at shipping (warehouse-specific version wins from 25 Mar)');
  const pxV1 = px.find((l) => l.rate_version_id === V1.id), pxV2 = px.find((l) => l.rate_version_id === V2.id);
  ok(pxV1 && pxV1.qty === 2 && pxV1.amount_cents === 100 && pxV2 && pxV2.status === 'not_set' && pxV2.amount_cents === null && pxV2.qty === 1 && !px.some((l) => l.rate_version_id === VW.id),
    'pick and pack extra items: 2 × US$0.50 at v1; v2 has no extra-item fee → "not set", never billed as 0; a 1-item order has no extra line');
  const st = find('storage');
  const sV1 = st.find((l) => l.rate_version_id === V1.id), sV2 = st.find((l) => l.rate_version_id === V2.id), sVW = st.find((l) => l.rate_version_id === VW.id);
  ok(sV1 && Number(sV1.qty) === 0.4839 && sV1.amount_cents === 1452 && sV2 && Number(sV2.qty) === 0.2903 && sV2.amount_cents === 871 && sVW && Number(sVW.qty) === 0.2258 && sVW.amount_cents === 1355
     && sV1.refs[0].code === P1.code,
    `storage: one stored pallet split at each rate change — 15/31 × US$30 = ${sV1?.amount_cents}, 9/31 × US$30 = ${sV2?.amount_cents}, 7/31 × US$60 = ${sVW?.amount_cents} cents`);
  const mats = find('materials');
  ok(mats.length === 2 && mats.find((l) => l.status === 'billable')?.amount_cents === 50 && mats.find((l) => l.status === 'billable')?.refs.length === 1
     && mats.find((l) => l.status === 'not_set')?.amount_cents === null && !mats.some((l) => l.refs.some((r) => r.id === U2)),
    'packaging: priced use 2 × US$0.25 billed; the voided use is out; the unpriced material is "not set"');
  const rets = find('returns');
  ok(rets.length === 2 && rets.find((l) => l.status === 'billable')?.amount_cents === 240 && rets.find((l) => l.status === 'not_set')?.qty === 2,
    'returns: 3 items × US$0.80 billed at the price copied at inspection; a return without a price is "not set"');
  const subtotal = 1000 + 480 + 150 + 150 + 200 + 100 + 1452 + 871 + 1355 + 50 + 240;
  const top = L.find((l) => l.kind === 'minimum');
  ok(pv.subtotal_cents === subtotal && pv.topup_cents === 100000 - subtotal && pv.total_cents === 100000 && top && top.amount_cents === 100000 - subtotal
     && pv.minimum.applies === true && pv.month_closed === true && pv.unbilled_count === 4,
    `minimum: charges ${subtotal} cents are below the US$1,000 minimum → top-up line ${100000 - subtotal}; total US$1,000.00; 4 lines not charged`);
  const pvB = (await one(`select wh_invoice_preview($1, $2) p`, [orgB, month])).p;
  ok(pvB.lines.length === 3 && pvB.lines.every((l) => l.status === 'not_set' && l.amount_cents === null) && pvB.total_cents === 0 && pvB.minimum.status === 'not_set',
    'client B (no rates in effect): receiving, first-item and extra-item lines all "not set", nothing billed, no minimum');
  const board = (await one(`select wh_invoice_board($1) b`, [month])).b;
  const bA = board.clients.find((c) => c.org_id === orgA);
  ok(bA && bA.total_cents === 100000 && bA.invoice === null && board.month_closed === true && board.can_issue === false,
    'board: client A previewed at US$1,000, not issued; the warehouse admin cannot issue');

  // ── 3. permissions ──
  const adminIssue = await tryq(`select wh_invoice_issue($1, $2)`, [orgA, month]);
  await as(packer);
  const packerPv = await tryq(`select wh_invoice_preview($1, $2)`, [orgA, month]);
  await as(custA, 'aal1');
  const custPv = await tryq(`select wh_invoice_preview($1, $2)`, [orgA, month]);
  const custIssue = await tryq(`select wh_invoice_issue($1, $2)`, [orgA, month]);
  const custCompute = await tryq(`select wh_invoice_compute($1, $2)`, [orgA, month]);
  await as(finance, 'aal1');
  const finAal1 = await tryq(`select wh_invoice_issue($1, $2)`, [orgA, month]);
  await as(finance);
  const finNow = await tryq(`select wh_invoice_issue($1, (now() at time zone 'Asia/Shanghai')::date)`, [orgA]);
  const finB = await tryq(`select wh_invoice_issue($1, $2)`, [orgB, month]);
  await anon();
  const anonPv = await tryq(`select wh_invoice_preview($1, $2)`, [orgA, month]);
  ok(/FORBIDDEN/.test(adminIssue.err ?? '') && /FORBIDDEN/.test(packerPv.err ?? '') && /FORBIDDEN/.test(custPv.err ?? '') && /FORBIDDEN/.test(custIssue.err ?? '')
     && /permission denied/.test(custCompute.err ?? '') && /FORBIDDEN/.test(finAal1.err ?? '') && /MONTH_NOT_OVER/.test(finNow.err ?? '')
     && /NOTHING_TO_BILL/.test(finB.err ?? '') && /permission denied|FORBIDDEN/.test(anonPv.err ?? ''),
    'permissions: warehouse admin previews but cannot issue; packer / client / anon cannot preview; Finance needs 2FA, a finished month and something to bill');

  // ── 4. issue ──
  await as(finance);
  const iss = (await one(`select wh_invoice_issue($1, $2) r`, [orgA, month])).r;
  const again2 = (await one(`select wh_invoice_issue($1, $2) r`, [orgA, month])).r;
  await owner();
  const doc = await one(`select d.*, (select code from divisions where id = d.division_id) div from documents d where d.id = $1`, [iss.document_id]);
  const dl = await all(`select * from invoice_lines where document_id = $1 order by created_at`, [iss.document_id]);
  const inv = await one(`select * from wh_invoices where id = $1`, [iss.id]);
  const wl = await all(`select * from wh_invoice_lines where invoice_id = $1 order by seq`, [iss.id]);
  const billable = L.filter((l) => l.status === 'billable').length;
  ok(iss.repeated === false && /^PF-\d{4}-\d{6}$/.test(iss.number) && doc.doc_type === 'proforma_invoice' && doc.data.service === 'warehouse' && doc.div === '3PL'
     && Number(doc.amount_cents) === 100000 && doc.status === 'awaiting_payment' && doc.org_id === orgA && doc.data.ref === '2025-03',
    `issue: proforma ${iss.number} for US$1,000 to client A, service warehouse, 3PL division, awaiting payment`);
  ok(dl.length === billable && wl.length === billable && dl.reduce((n, l) => n + Number(l.amount_cents), 0) === 100000
     && wl.every((l, i) => l.seq === i + 1 && l.document_line_id === dl.find((d) => d.ref_id === l.id)?.id) && dl.every((l) => l.service === 'warehouse' && l.ref_type === 'wh_invoice_line')
     && Number(inv.subtotal_cents) === subtotal && Number(inv.topup_cents) === 100000 - subtotal && inv.issued_by === finance,
    `issue: ${billable} billable lines (not-set / not-measured lines are not on the invoice) in invoice_lines and wh_invoice_lines, summing to the total`);
  const jr2 = await one(`select count(distinct j.id)::int n, coalesce(sum(e.debit_cents), 0)::bigint dr, coalesce(sum(e.credit_cents), 0)::bigint cr
                           from journals j join ledger_entries e on e.journal_id = j.id where j.idempotency_key = $1 and j.ref_id = $2`, [`doc-ar:${iss.document_id}`, iss.document_id]);
  ok(jr2 && jr2.n >= 1 && Number(jr2.dr) === Number(jr2.cr) && Number(jr2.dr) === 100000, `ledger: the receivable journal is balanced (${jr2?.dr} = ${jr2?.cr})`);
  ok(again2.repeated === true && again2.document_id === iss.document_id && Number((await one(`select count(*) n from wh_invoices where org_id = $1`, [orgA])).n) === 1,
    'idempotent: issuing the same client and month again returns the first invoice; one invoice per client and month');
  const inv1 = await one(`select (select invoiced_at from wh_material_usage where id = $1) u1, (select invoiced_at from wh_material_usage where id = $2) u3,
                                 (select invoiced_at from wh_returns where id = $3) r1, (select invoiced_at from wh_returns where id = $4) r2`, [U1, U3, R1, R2]);
  ok(inv1.u1 && !inv1.u3 && inv1.r1 && !inv1.r2, 'invoiced_at: set on the packaging use and return that are on the invoice, not on the unpriced ones');
  const refsStorage = wl.find((l) => l.kind === 'storage')?.refs ?? [];
  const refsPick = wl.find((l) => l.kind === 'pick_first' && l.rate_version_id === V1.id)?.refs ?? [];
  const refsRec = wl.filter((l) => l.kind === 'receiving').flatMap((l) => l.refs);
  ok(refsStorage[0]?.code === P1.code && refsPick[0]?.code === O1.code && refsPick[0]?.units === 3 && refsRec.map((r) => r.code).sort().join() === [A1.code, A2.code].sort().join()
     && wl.find((l) => l.kind === 'materials')?.refs[0]?.id === U1 && wl.find((l) => l.kind === 'returns')?.refs[0]?.id === R1,
    'drill-down: each stored line keeps the pallets, orders, notices, packaging uses and returns behind it');
  const upd = await tryq(`update wh_invoices set total_cents = 1 where id = $1`, [iss.id]);
  const del = await tryq(`delete from wh_invoice_lines where invoice_id = $1`, [iss.id]);
  ok(/INVOICE_KEPT/.test(upd.err ?? '') && /INVOICE_KEPT/.test(del.err ?? ''), 'issued invoices and their lines are never changed or deleted directly');
  // demo wipe (before the payment: wipe_demo_data does not remove proforma payments — an existing limit, not W6's)
  seqs = await snapshotSequences(db);
  await db.query('savepoint wipe');
  const wipe = await tryq(`select wipe_demo_data('DELETE DEMO DATA FOR ydbxqrizjxpduqbgnwxg', null) r`);
  if (wipe.err) {
    ok(false, `demo wipe ran (${wipe.err.slice(0, 160)})`);
  } else {
    const left = await one(`select (select count(*) from wh_invoices where org_id in ($1, $2))::int inv, (select count(*) from wh_invoice_lines where invoice_id = $3)::int lines,
                                   (select count(*) from wh_pallet_stays where org_id = $1)::int stays`, [orgA, orgB, iss.id]);
    ok(left.inv === 0 && left.lines === 0 && left.stays === 0, 'demo wipe: the demo client\'s invoices, their lines and pallet periods go with it (cascade); wipe_demo_data not replaced');
  }
  await db.query('rollback to savepoint wipe');
  // the client pays by bank transfer (Finance records it: the existing pay_service_proforma path, service role)
  const pay = (await one(`select pay_service_proforma($1, 100000, 'bank_transfer', $2, null) r`, [iss.document_id, `W6-BANK-${tag}`])).r;
  const paid = await one(`select status, paid_cents from documents where id = $1`, [iss.document_id]);
  const tax = await one(`select number, (select count(*) from invoice_lines where document_id = d.id)::int lines from documents d where from_proforma_id = $1 and doc_type = 'commercial_invoice'`, [iss.document_id]);
  ok(pay.fully_paid === true && paid.status === 'invoiced' && Number(paid.paid_cents) === 100000 && tax && /^OCT-3PL-/.test(tax.number) && tax.lines === billable,
    `payment: recorded bank transfer → fully paid; tax invoice ${tax?.number} with the same lines`);

  // ── 5. isolation and portal ──
  await as(custA, 'aal1');
  const ownInv = await all(`select id, total_cents from wh_invoices`);
  const ownLines = Number((await one(`select count(*) n from wh_invoice_lines`)).n);
  const issuedBy = await tryq(`select issued_by from wh_invoices`);
  const portal = (await one(`select wh_portal_invoices($1) r`, [orgA])).r;
  await as(custB, 'aal1');
  const otherInv = Number((await one(`select count(*) n from wh_invoices where org_id = $1`, [orgA])).n);
  const otherLines = Number((await one(`select count(*) n from wh_invoice_lines where invoice_id = $1`, [iss.id])).n);
  const otherPortal = await tryq(`select wh_portal_invoices($1)`, [orgA]);
  const stays = Number((await one(`select count(*) n from wh_pallet_stays`)).n);
  ok(ownInv.length === 1 && ownLines === billable && /permission denied/.test(issuedBy.err ?? '') && otherInv === 0 && otherLines === 0 && /FORBIDDEN/.test(otherPortal.err ?? '') && stays === 0,
    'isolation: client A reads its own invoice and lines (not who issued it); client B sees none and cannot open A\'s statements; pallet periods are staff-only');
  const stmt = portal[0];
  ok(portal.length === 1 && stmt.number === iss.number && stmt.status === 'invoiced' && stmt.tax_invoice?.number === tax.number && stmt.issued_by == null
     && stmt.lines.length === billable && stmt.lines.find((l) => l.kind === 'pick_first')?.refs.length === 1,
    'portal: the March statement with its lines, drill-down references and the tax invoice; no staff names');

  // ── 6. pallet periods, reports, settings ──
  await owner();
  const bin = (await one(`insert into wh_bins (warehouse_code, code) values ('FS-01', $1) returning id`, [`W${tag.slice(0, 2)}-01-01`])).id;
  const P2 = (await one(`insert into wh_pallets (warehouse_code, org_id) values ('FS-01', $1) returning id`, [orgA])).id;
  await db.query(`update wh_pallets set status = 'stored', bin_id = $2 where id = $1`, [P2, bin]);
  const s1 = await all(`select started_at, ended_at from wh_pallet_stays where pallet_id = $1`, [P2]);
  await db.query(`update wh_pallets set bin_id = $2 where id = $1`, [P2, bin]);
  await db.query(`update wh_pallets set status = 'broken', bin_id = null where id = $1`, [P2]);
  const s2 = await all(`select started_at, ended_at from wh_pallet_stays where pallet_id = $1`, [P2]);
  ok(s1.length === 1 && s1[0].ended_at === null && s2.length === 1 && s2[0].ended_at !== null, 'pallet periods: stored → a period starts; a move keeps it; emptied (broken) → it ends');
  // dock-to-shelf for notice A1: checked in at the dock 10 h before the last putaway of its released lot
  const line = (await one(`insert into wh_asn_lines (asn_id, item_id, expected_qty, received_good, status) values ($1, $2, 5, 5, 'accepted') returning id`, [A1.id, item])).id;
  const lot = (await one(`insert into wh_lots (warehouse_code, item_id, org_id, asn_line_id, qty, status) values ('FS-01', $1, $2, $3, 5, 'released') returning id`, [item, orgA, line])).id;
  await db.query(`insert into wh_dock_slots (warehouse_code, dock, starts_at, ends_at, asn_id, status, arrived_at) values ('FS-01', $1, $2, ($2::timestamptz) + interval '2 hours', $3, 'done', $2)`,
    [`W6${tag}`, CN('2025-03-05 06:00'), A1.id]);
  await db.query(`insert into wh_location_moves (warehouse_code, kind, item_id, lot_id, to_bin, qty, created_at) values ('FS-01', 'putaway', $1, $2, $3, 3, $4), ('FS-01', 'putaway', $1, $2, $3, 2, $5)`,
    [item, lot, bin, CN('2025-03-05 12:00'), CN('2025-03-05 16:00')]);
  await db.query(`insert into wh_exceptions (warehouse_code, kind, title, org_id, order_id, created_at) values ('FS-01', 'weight', 'W6 test weight', $1, $2, $3)`, [orgA, O1.id, CN('2025-03-10 09:00')]);
  await as(packer);
  const packerSet = await tryq(`select wh_save_service_settings('FS-01', 12, 12, null)`);
  const rep0 = (await one(`select wh_report('2025-03-01', '2025-03-31', 'FS-01', $1) r`, [orgA])).r;
  await as(whAdmin);
  const badSet = await tryq(`select wh_save_service_settings('FS-01', 0, null, null)`);
  await db.query(`select wh_save_service_settings('FS-01', 12, 30, 30)`);
  const rep1 = (await one(`select wh_report('2025-03-01', '2025-03-31', 'FS-01', $1) r`, [orgA])).r;
  await db.query(`select wh_save_service_settings('FS-01', 8, 12, 30)`);
  const rep2 = (await one(`select wh_report('2025-03-01', '2025-03-31', null, $1) r`, [orgA])).r;
  await as(custA, 'aal1');
  const custRep = await tryq(`select wh_report('2025-03-01', '2025-03-31', null, null)`);
  const r0 = rep0.rows.find((x) => x.org_id === orgA);
  const r1 = rep1.rows.find((x) => x.org_id === orgA);
  const r2 = rep2.rows.find((x) => x.org_id === orgA);
  ok(/FORBIDDEN/.test(packerSet.err ?? '') && /INVALID_TARGET/.test(badSet.err ?? '') && /FORBIDDEN/.test(custRep.err ?? ''),
    'settings: only a warehouse admin sets targets (validated); clients cannot read reports');
  ok(r0 && r0.orders_shipped === 3 && r0.units_shipped === 6 && r0.handoff.n === 3 && Number(r0.handoff.median_h) === 24 && r0.handoff.measured === 0
     && r0.dock_to_shelf.n === 1 && Number(r0.dock_to_shelf.median_h) === 10 && r0.exceptions.total === 1 && r0.exceptions.by_kind.weight === 1 && rep0.rows.length === 1,
    `report: 3 orders / 6 units shipped, order-to-handoff median 24 h, dock-to-shelf 10 h (check-in → last putaway), 1 weight exception; no target → nothing measured`);
  ok(r1.handoff.measured === 3 && r1.handoff.within === 3 && r1.dock_to_shelf.within === 1 && r2.handoff.within === 0 && r2.dock_to_shelf.within === 0
     && rep2.targets.some((t) => t.warehouse_code === 'FS-01' && t.handoff_hours === 12),
    'report: targets 30 h / 12 h → all inside; targets 12 h / 8 h → none inside (service-quality share counts only against a set target)');

  // ── 7. retention ──
  await owner();
  const parcel = (await one(`select id from wh_parcels where order_id = $1 order by seq limit 1`, [O1.id]))?.id ?? null;
  const ev = (await one(`insert into wh_pack_evidence (order_id, parcel_id, warehouse_code, kind, storage_path, retention_until) values ($1, $2, 'FS-01', 'contents', $3, now() - interval '1 day') returning id`,
    [O1.id, parcel, `FS-01/${O1.code}/contents-${crypto.randomUUID()}.jpg`])).id;
  const evKeep = (await one(`insert into wh_pack_evidence (order_id, parcel_id, warehouse_code, kind, storage_path, retention_until) values ($1, $2, 'FS-01', 'sealed', $3, now() + interval '30 days') returning id`,
    [O1.id, parcel, `FS-01/${O1.code}/sealed-${crypto.randomUUID()}.jpg`])).id;
  await db.query(`update wh_returns set status = 'done', decision = 'discard', decision_source = 'client', decided_at = now() - interval '41 days', done_at = now() - interval '40 days' where id = $1`, [R1]);
  const rcode = (await one(`select code from wh_returns where id = $1`, [R1])).code;
  const rp = (await one(`insert into wh_return_photos (return_id, warehouse_code, storage_path) values ($1, 'FS-01', $2) returning id`, [R1, `FS-01/${rcode}/${crypto.randomUUID()}.jpg`])).id;
  const due1 = await all(`select * from wh_retention_due(5000)`);
  await as(whAdmin);
  await db.query(`select wh_save_service_settings('FS-01', 8, 12, null)`);
  await owner();
  const due2 = await all(`select * from wh_retention_due(5000)`);
  await as(whAdmin);
  await db.query(`select wh_save_service_settings('FS-01', 8, 12, 30)`);
  const summ = (await one(`select wh_retention_summary('FS-01') r`)).r[0];
  const authDue = await tryq(`select * from wh_retention_due(5)`);
  const authMark = await tryq(`select wh_retention_mark($1::jsonb)`, [JSON.stringify([{ kind: 'evidence', id: ev }])]);
  await owner();
  const marked = (await one(`select wh_retention_mark($1::jsonb) r`, [JSON.stringify([{ kind: 'evidence', id: ev }, { kind: 'evidence', id: evKeep }, { kind: 'return_photo', id: rp }])])).r;
  const due3 = await all(`select * from wh_retention_due(5000)`);
  const rows = await one(`select (select purged_at from wh_pack_evidence where id = $1) e1, (select purged_at from wh_pack_evidence where id = $2) e2, (select purged_at from wh_return_photos where id = $3) p1,
                                 (select count(*) from wh_pack_evidence where id in ($1, $2))::int n`, [ev, evKeep, rp]);
  ok(due1.some((d) => d.kind === 'evidence' && d.id === ev && d.bucket === 'wh-evidence') && !due1.some((d) => d.id === evKeep) && due1.some((d) => d.kind === 'return_photo' && d.id === rp)
     && !due2.some((d) => d.id === rp) && summ.evidence_due >= 1 && summ.return_photos_due >= 1,
    'retention: expired packing photos are due, current ones are not; return photos are due only with a retention setting');
  ok(/permission denied/.test(authDue.err ?? '') && /permission denied/.test(authMark.err ?? '') && marked.evidence === 1 && marked.return_photos === 1
     && rows.e1 && !rows.e2 && rows.p1 && rows.n === 2 && !due3.some((d) => d.id === ev || d.id === rp),
    'retention: only the service role lists and marks; rows are marked purged (never deleted), unexpired rows are not marked, purged rows are no longer due');

  // ── 8. audit ──
  const acts = (await all(`select distinct action from audit_log where created_at >= now() - interval '1 hour' and (entity_id in ($1, $2) or entity in ('wh_service_settings', 'storage'))`,
    [iss.id, iss.document_id])).map((r) => r.action);
  const need = ['wh_invoice.issued', 'invoice.issue', 'wh_service_settings.saved', 'wh_retention.purged'];
  const missingActs = need.filter((a) => !acts.includes(a));
  ok(missingActs.length === 0, `audit: issue, settings and purge are in the audit log${missingActs.length ? ' — missing ' + missingActs.join(', ') : ''}`);
  void VW; void OB; void AB; void U3; void O2;
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  if (seqs) await restoreSequences(seqs);
  ok(!(await db.query(`select 1 from auth.users where email like 'w6-%@test.local'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nW6 warehouse: ${failed} check(s) failed` : '\nW6 warehouse: all passed');
process.exitCode = failed ? 1 : 0;
