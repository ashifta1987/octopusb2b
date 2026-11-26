// Turnkey T7 DB checks — migration *_t7_turnkey_reports_alerts_settings. STAGING ONLY, one rolled-back transaction,
// acting as customers / staff through JWT claims (what PostgREST does).
//  1. Structure: no new table; every new tk_ function is a security definer with search_path=public and not for anon;
//     internal helpers and trigger functions are not callable by signed-in users; the alert triggers exist; up re-runs.
//  2. Alerts through the existing notifications table, created by triggers: new enquiry → Turnkey staff (admins when the
//     division has no editor); fee waiting for approval → admins except the proposer; proforma issued / fully paid →
//     client company + account manager (not on a part payment); inspection report published → client; shipment event →
//     client (not for a cancelled shipment); handover ready → client once. Who sees them (my_notifications), no factory
//     names, and an alert that fails never blocks the business write.
//  3. Reports: numbers equal the seeded rows (fees by service and month: issued / paid / outstanding / void, integer
//     cents; funnel; unpaid ageing buckets by days since issue; inspector workload). Customers, account managers outside
//     the TK division, staff without Turnkey view and staff without 2FA are refused.
//  4. Dashboard: KPIs for Turnkey viewers; "my projects" only for an account manager.
//  5. Settings: admins on 2FA only; extra traveller price (tk_services + public rule text), passport retention days,
//     account manager waiver threshold (unset → set → cleared); setting rows not public; every change audited.
//  6. Division report: open work counts open / on-hold client projects, no longer the frozen turnkey_leads.
//  7. down → up.
// Set-up note: the period window of the report checks is [transaction start, +1 s): every row this test creates has
// created_at = now() (the transaction's time), so the window holds exactly the seeded rows.
// Run: node supabase/tests/turnkey-t7.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PLAN = 'A 150 m² gym in Izmir, opening next spring.';

/**
 * The checks, on an open pg-like client (query(sql, params) → { rows }). ctx: { UP, DOWN, MIG, unwindLater(db), reapplyLater(db) }.
 * Runs inside the caller's transaction; returns the number of failed checks.
 */
export async function runT7Checks(db, ctx) {
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
  const err = async (q, p) => (await tryq(q, p)).err ?? '';
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const SUPPLIER = `Foshan Gymworks T7 ${stamp}`;
  let refN = 0;
  const mkUser = async (tag, role = null) => {
    const email = `tk7-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id, email_confirmed_at) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now()) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `TK7 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkOrg = async (name, uid) => {
    const id = (await one(`insert into organizations(name, country) values ($1, 'TR') returning id`, [name])).id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [id, uid]);
    return id;
  };
  const pay = async (doc, cents) => { await owner(); return (await one(`select pay_service_proforma($1, $2, 'bank_transfer', $3, null) r`, [doc, cents, `TK7-${stamp}-${++refN}`])).r; };
  const notes = async (where, p) => { await owner(); return all(`select user_id, org_id, title, body, link, service, division_id, dedupe_key from notifications where ${where}`, p); };
  const enquiry = async (uid, org, title) => { await as(uid, 'aal1'); return (await one(`select tk_submit_enquiry($1, null, $2, 'TR', null, null, null, null, $3) r`, [org, title, PLAN])).r; };

  const admin1 = await mkUser('admin1', 'admin');
  const admin2 = await mkUser('admin2', 'admin');
  const agent = await mkUser('agent', 'sourcing_agent');
  const fin = await mkUser('finance', 'finance');
  const am = await mkUser('am', 'account_manager');
  const inspector = await mkUser('inspector', 'qc_coordinator');
  const wh = await mkUser('warehouse', 'warehouse');
  const cust = await mkUser('cust');
  const custB = await mkUser('custb');
  const orgA = await mkOrg('TK7 Client A', cust);
  await mkOrg('TK7 Client B', custB);

  // ── 1. structure ──
  await owner();
  const tablesBefore = (await one(`select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).n;
  await db.query(ctx.UP); // re-runnable
  ok((await one(`select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).n === tablesBefore, 'T7: no new table (up is re-runnable)');
  const NEW_FNS = ['tk_t7_notify', 'tk_t7_staff_recipients', 'tk_t7_proforma_label', 'tk_t7_alert_enquiry', 'tk_t7_alert_fee_pending', 'tk_t7_alert_proforma',
    'tk_t7_alert_inspection', 'tk_t7_alert_shipment_event', 'tk_t7_alert_handover_ready', 'tk_report_ok', 'tk_t7_proformas', 'tk_report_fees_by_service',
    'tk_report_funnel', 'tk_report_unpaid_ageing', 'tk_report_unpaid_list', 'tk_report_inspector_load', 'tk_dashboard', 'tk_passport_retention_days',
    'tk_am_waiver_threshold_cents', 'tk_settings', 'tk_set_extra_traveller_price', 'tk_set_passport_retention_days', 'tk_set_am_waiver_threshold',
    'tk_purge_trip_passports_by_setting'];
  const fns = await all(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') auth from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [NEW_FNS]);
  ok(fns.length === NEW_FNS.length && fns.every((f) => f.prosecdef && /search_path=public/.test(f.cfg) && !f.anon),
    `T7: all ${NEW_FNS.length} new functions are security definer, search_path=public, not for anon (${fns.length} found)`);
  const INTERNAL = ['tk_t7_notify', 'tk_t7_staff_recipients', 'tk_t7_proforma_label', 'tk_t7_alert_enquiry', 'tk_t7_alert_fee_pending', 'tk_t7_alert_proforma',
    'tk_t7_alert_inspection', 'tk_t7_alert_shipment_event', 'tk_t7_alert_handover_ready', 'tk_t7_proformas', 'tk_purge_trip_passports_by_setting'];
  ok(fns.filter((f) => INTERNAL.includes(f.proname)).every((f) => !f.auth), 'T7: internal helpers, trigger functions and the purge wrapper are not callable by signed-in users');
  const trg = await all(`select tgrelid::regclass::text t, tgname from pg_trigger where tgname like 'trg_tk_t7_%' and not tgisinternal order by 1, 2`);
  ok(trg.length === 9, `T7: 9 alert triggers (${trg.map((x) => `${x.t}.${x.tgname}`).join(', ')})`);

  // ── 2. alerts ──
  // new enquiry: with no Turnkey editor in the division, the admins hear about it
  await owner();
  await db.query(`delete from division_members where division_id = division_id_of('TK')`); // rolled back
  const p0 = await enquiry(cust, orgA, 'TK7 cafe');
  const e0 = await notes(`dedupe_key like $1`, [`tk:enquiry:${p0.id}:%`]);
  ok(e0.some((n) => n.user_id === admin1) && e0.some((n) => n.user_id === admin2) && e0.every((n) => n.org_id === null && n.link === `/admin/turnkey/projects/${p0.code}` && n.service === 'turnkey'),
    `enquiry alert: no Turnkey editor in the division → every admin (${e0.length} alerts, staff-addressed, linked to the project)`);
  await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('TK'), 'staff')`, [agent]);
  const p1 = await enquiry(cust, orgA, 'TK7 gym');
  const p2 = await enquiry(cust, orgA, 'TK7 laundry');
  const e1 = await notes(`dedupe_key like $1`, [`tk:enquiry:${p1.id}:%`]);
  ok(e1.length === 1 && e1[0].user_id === agent && /TK7 gym/.test(e1[0].body) && /TK7 Client A/.test(e1[0].body), 'enquiry alert: the division\'s Turnkey editor (only), with the project and the client');
  await as(cust, 'aal1');
  ok(Number((await one(`select count(*) n from my_notifications() where link like '/admin/%'`)).n) === 0, 'enquiry alert: the client never sees staff alerts');
  await as(agent);
  ok(Number((await one(`select count(*) n from my_notifications() where link = $1`, [`/admin/turnkey/projects/${p1.code}`])).n) === 1, 'enquiry alert: in the editor\'s inbox (my_notifications)');
  await owner();
  await db.query(`insert into tk_factory_quotes (project_id, supplier_name, total_cost_cents, created_by) values ($1, $2, 100000, $3)`, [p1.id, SUPPLIER, agent]); // a factory of p1

  // account manager on p1 (so proforma alerts reach them)
  await as(agent);
  await db.query(`select tk_set_project_manager($1, $2)`, [p1.id, am]);

  // fee waiting for approval → admins except the proposer
  await as(agent);
  const fHigh = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', 30000, null) r`, [p1.id])).r;
  const a1 = await notes(`dedupe_key like $1`, [`tk:fee-approval:${fHigh.id}:%`]);
  ok(fHigh.status === 'pending_approval' && a1.length >= 2 && a1.some((n) => n.user_id === admin1) && a1.some((n) => n.user_id === admin2) && a1.every((n) => n.link === '/admin/turnkey/approvals')
     && /US\$ 300\.00/.test(a1[0].body), `fee alert: a fee above 2× → every admin (${a1.length}), linked to the approvals page`);
  await as(admin1);
  const fHigh2 = (await one(`select tk_propose_fee($1, 'design', 'layout_drawing', 90000, null) r`, [p2.id])).r;
  const a2 = await notes(`dedupe_key like $1`, [`tk:fee-approval:${fHigh2.id}:%`]);
  ok(a2.some((n) => n.user_id === admin2) && !a2.some((n) => n.user_id === admin1), 'fee alert: not to the admin who proposed it');

  // proforma issued → client + account manager
  await as(admin2);
  const dec = (await one(`select tk_decide_fee($1, 'approve', null) r`, [fHigh.id])).r;
  const pi = await notes(`dedupe_key like $1`, [`tk:pf-issued:${dec.document_id}:%`]);
  const piClient = pi.find((n) => n.org_id === orgA && n.user_id === null);
  const piAm = pi.find((n) => n.user_id === am);
  ok(!!piClient && piClient.link === `/account/turnkey/${p1.code}` && /Consultation: US\$ 300\.00/.test(piClient.body) && !!piAm && piAm.link === `/admin/turnkey/projects/${p1.code}`,
    'proforma alert: issued → the client company (linked to its project) and the account manager');
  await as(cust, 'aal1');
  ok(Number((await one(`select count(*) n from my_notifications() where link = $1 and title like 'Proforma ready to pay%'`, [`/account/turnkey/${p1.code}`])).n) === 1, 'proforma alert: in the client\'s bell (my_notifications)');
  await as(custB, 'aal1');
  ok(Number((await one(`select count(*) n from my_notifications() where link like $1`, [`/account/turnkey/${p1.code}%`])).n) === 0, 'proforma alert: another company sees nothing');
  // part payment → no "paid" alert; the rest → one for each
  await pay(dec.document_id, 10000);
  ok((await notes(`dedupe_key like $1`, [`tk:pf-paid:${dec.document_id}:%`])).length === 0, 'payment alert: none on a part payment');
  await pay(dec.document_id, 20000);
  const pp = await notes(`dedupe_key like $1`, [`tk:pf-paid:${dec.document_id}:%`]);
  ok(pp.length === 2 && pp.some((n) => n.org_id === orgA && /is paid/.test(n.body)) && pp.some((n) => n.user_id === am), 'payment alert: fully paid → the client and the account manager, once');

  // an alert that fails never blocks the business write
  await owner();
  await db.query('savepoint broken');
  await db.query(`alter table notifications add constraint tk7_test_block check (service is distinct from 'turnkey') not valid`);
  await as(agent);
  const blocked = await tryq(`select tk_propose_fee($1, 'consultation', 'consultation', 9900, null) r`, [p2.id]);
  await owner();
  const blockedDoc = blocked.rows[0]?.r?.document_id;
  ok(!blocked.err && !!blockedDoc && (await notes(`dedupe_key like $1`, [`tk:pf-issued:${blockedDoc}:%`])).length === 0, 'alerts never block: with notifications refusing, the fee and its proforma still go through');
  await db.query('rollback to savepoint broken');

  // more fees for the report: p2 consultation 9900 (active at once), then 15000 (within 2×: replaces it, voids the first proforma)
  await as(agent);
  const c1 = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', 9900, null) r`, [p2.id])).r;
  const c2 = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', 15000, null) r`, [p2.id])).r;
  await owner();
  ok((await one(`select status from documents where id = $1`, [c1.document_id])).status === 'void' && !!c2.document_id, 'set-up: a replaced fee voided its proforma');

  // inspection report published → client (set-up: a submitted pre-shipment inspection; publishing goes through T5)
  await owner();
  const ins = (await one(`insert into tk_inspections (project_id, kind, round, status, scheduled_on, inspector_id, factory_name, created_by, scheduled_at, started_at, submitted_at)
      values ($1, 'pre_shipment', 1, 'submitted', current_date, $2, $3, $4, now(), now(), now()) returning id`, [p1.id, inspector, SUPPLIER, agent])).id;
  await db.query(`insert into tk_inspection_reports (inspection_id, project_id, submission_id, lot_size, sample_size, critical_defects, major_defects, minor_defects, result, signed_name, submitted_by)
      values ($1, $2, gen_random_uuid(), 100, 13, 0, 0, 0, 'pass', 'TK7 QC', $3)`, [ins, p1.id, inspector]);
  await as(agent);
  await db.query(`select tk_publish_inspection($1, 'Passed: no defects found.', '{}')`, [ins]);
  const ip = await notes(`dedupe_key = $1`, [`tk:inspection-published:${ins}`]);
  ok(ip.length === 1 && ip[0].org_id === orgA && ip[0].user_id === null && /Pre-shipment inspection report/.test(ip[0].body), 'inspection alert: published → the client company');
  // a second, overdue job for the workload report
  await owner();
  await db.query(`insert into tk_inspections (project_id, kind, round, status, scheduled_on, inspector_id, factory_name, created_by, scheduled_at)
      values ($1, 'factory_audit', 1, 'scheduled', current_date - 2, $2, $3, $4, now())`, [p2.id, inspector, SUPPLIER, agent]);

  // shipment tracking event → client; nothing for a cancelled shipment
  await owner();
  const sh = (await one(`insert into tk_shipments (project_id, seq, mode, carrier, status, created_by) values ($1, 1, 'sea', 'COSCO Shipping', 'booked', $2) returning id`, [p1.id, agent])).id;
  const ev = (await one(`insert into tk_shipment_events (shipment_id, project_id, happened_at, status_to, location, description, created_by)
      values ($1, $2, now(), 'in_transit', 'Yantian port', 'Loaded on the vessel', $3) returning id`, [sh, p1.id, agent])).id;
  const se = await notes(`dedupe_key = $1`, [`tk:shipment-event:${ev}`]);
  ok(se.length === 1 && se[0].org_id === orgA && /COSCO Shipping\): In transit\. Loaded on the vessel \(Yantian port\)/.test(se[0].body), 'shipment alert: a tracking event → the client company');
  const shc = (await one(`insert into tk_shipments (project_id, seq, mode, carrier, status, cancelled_at, cancel_reason, created_by) values ($1, 2, 'air', 'Air carrier', 'cancelled', now(), 'Booked twice', $2) returning id`, [p1.id, agent])).id;
  const evc = (await one(`insert into tk_shipment_events (shipment_id, project_id, happened_at, description, created_by) values ($1, $2, now(), 'Ignored', $3) returning id`, [shc, p1.id, agent])).id;
  ok((await notes(`dedupe_key = $1`, [`tk:shipment-event:${evc}`])).length === 0, 'shipment alert: none for a cancelled shipment (staff-only)');

  // handover ready → client, once, when the last open line is ticked
  await owner();
  const h1 = (await one(`insert into tk_handover_items (project_id, position, label, created_by) values ($1, 1, 'Warranty certificates', $2) returning id`, [p1.id, agent])).id;
  const h2 = (await one(`insert into tk_handover_items (project_id, position, label, created_by) values ($1, 2, 'Operating manual', $2) returning id`, [p1.id, agent])).id;
  await db.query(`update tk_handover_items set done_at = now(), done_by = $2 where id = $1`, [h1, agent]);
  ok((await notes(`dedupe_key = $1`, [`tk:handover-ready:${p1.id}`])).length === 0, 'handover alert: not while a line is open');
  await db.query(`update tk_handover_items set done_at = now(), done_by = $2 where id = $1`, [h2, agent]);
  await db.query(`update tk_handover_items set done_at = null, done_by = null where id = $1`, [h2]);
  await db.query(`update tk_handover_items set done_at = now(), done_by = $2 where id = $1`, [h2, agent]);
  const hr = await notes(`dedupe_key = $1`, [`tk:handover-ready:${p1.id}`]);
  ok(hr.length === 1 && hr[0].org_id === orgA && /ready/.test(hr[0].title), 'handover alert: the last line ticked → the client company, once (ticking again adds nothing)');

  const allTk = await notes(`service = 'turnkey' and created_at = now()`, []);
  ok(allTk.length > 0 && allTk.every((n) => !`${n.title} ${n.body}`.toLowerCase().includes(SUPPLIER.toLowerCase()) && !`${n.title} ${n.body}`.toLowerCase().includes('gymworks')),
    `alerts never name a factory (${allTk.length} turnkey alerts checked)`);
  ok(allTk.every((n) => n.division_id === allTk[0].division_id && n.division_id), 'alerts carry the TK division (header switcher / staff inbox filter)');

  // ── 3. reports ──
  const W = [`now()`, `now() + interval '1 second'`];
  const feeRows = async () => all(`select * from tk_report_fees_by_service(${W[0]}, ${W[1]}, true) order by service_key`);
  await as(cust, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select * from tk_report_fees_by_service(null, null, false)`)), 'reports: customer refused');
  await as(am);
  ok(/FORBIDDEN/.test(await err(`select * from tk_report_funnel(null, null, false)`)), 'reports: an account manager outside the TK division refused');
  await as(wh);
  ok(/FORBIDDEN/.test(await err(`select * from tk_report_unpaid_ageing(false)`)), 'reports: staff without Turnkey view refused');
  await as(agent, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select * from tk_report_inspector_load(null, null, false)`)), 'reports: Turnkey editor without 2FA refused');
  await as(fin);
  ok(!(await tryq(`select * from tk_report_fees_by_service(null, null, false)`)).err, 'reports: Finance (company-wide, Turnkey view) allowed');

  await as(agent);
  const fr = await feeRows();
  const byKey = Object.fromEntries(fr.map((r) => [r.service_key, r]));
  const cons = byKey.consultation;
  // consultation: p1 30000 (paid in full) + p2 15000 (unpaid); p2's 9900 was voided
  ok(!!cons && cons.issued_count === 2 && Number(cons.issued_cents) === 45000 && Number(cons.paid_cents) === 30000 && Number(cons.outstanding_cents) === 15000 && cons.void_count === 1
     && cons.service_name === 'Consultation' && fr.every((r) => r.period === fr[0].period),
    `fees by service: consultation issued 2 = 45,000 cents, paid 30,000, outstanding 15,000, 1 void (${JSON.stringify(cons ?? null)})`);
  ok(!byKey.layout_drawing, 'fees by service: a fee still waiting for approval issues nothing');
  ok(fr.every((r) => Number.isInteger(Number(r.issued_cents)) && Number(r.issued_cents) === Number(r.paid_cents) + Number(r.outstanding_cents)), 'fees by service: integer cents, issued = paid + outstanding');

  const fun = await all(`select * from tk_report_funnel(${W[0]}, ${W[1]}, true) order by seq`);
  ok(fun.length === 8 && fun[0].reached === 3 && fun[1].reached === 0 && fun[0].open_now === 3, `funnel: 3 projects reached Enquiry, none further (${fun.map((f) => f.reached).join('/')})`);
  await owner();
  await db.query(`update tk_client_projects set stage = 'design' where id = $1`, [p1.id]);   // set-up only (rolled back)
  await db.query(`update tk_client_projects set status = 'on_hold', status_reason = 'Waiting for the client' where id = $1`, [p2.id]);
  await as(agent);
  const fun2 = await all(`select * from tk_report_funnel(${W[0]}, ${W[1]}, true) order by seq`);
  ok(fun2[0].reached === 3 && fun2[1].reached === 1 && fun2[2].reached === 1 && fun2[3].reached === 0 && fun2[2].open_now === 1 && fun2[0].on_hold_now === 1 && fun2[0].open_now === 1,
    `funnel: reached counts follow the current phase; open / on hold per phase (${fun2.map((f) => `${f.reached}:${f.open_now}:${f.on_hold_now}`).join(' ')})`);

  // ageing: deltas against the buckets before the old proformas are added
  const age = async () => Object.fromEntries((await all(`select * from tk_report_unpaid_ageing(true)`)).map((b) => [b.bucket, { n: b.open_count, c: Number(b.outstanding_cents) }]));
  const ag0 = await age();
  await owner();
  const oldDoc = async (days, cents) => (await one(`insert into documents (org_id, doc_type, number, amount_cents, currency, status, data, created_at)
      values ($1, 'proforma_invoice', $2, $3, 'USD', 'awaiting_payment', $4::jsonb, now() - make_interval(days => $5)) returning id`,
    [orgA, `TK7-OLD-${days}-${stamp}`, cents, JSON.stringify({ service: 'turnkey', ref_type: 'tk_trip', ref: p1.code, title: `Turnkey ${p1.code} · Visit China with us` }), days])).id;
  await oldDoc(45, 40000);
  await oldDoc(100, 70000);
  await as(agent);
  const ag1 = await age();
  ok(Object.keys(ag1).join(',') === '0–30,31–60,61–90,90+', `ageing: four buckets 0–30 / 31–60 / 61–90 / 90+ (${Object.keys(ag1).join(', ')})`);
  ok(ag1['31–60'].n - ag0['31–60'].n === 1 && ag1['31–60'].c - ag0['31–60'].c === 40000 && ag1['90+'].n - ag0['90+'].n === 1 && ag1['90+'].c - ag0['90+'].c === 70000
     && ag1['61–90'].n === ag0['61–90'].n && ag1['0–30'].n === ag0['0–30'].n,
    'ageing: a 45-day-old unpaid proforma lands in 31–60 and a 100-day-old one in 90+ (cents exact)');
  const list = await all(`select * from tk_report_unpaid_list(true) where project_code = any($1)`, [[p1.code, p2.code]]);
  ok(list.length === 3 && list.some((l) => l.age_days === 100 && Number(l.outstanding_cents) === 70000) && list.some((l) => l.age_days === 0 && Number(l.outstanding_cents) === 15000),
    `unpaid list: the 3 unpaid proformas of the seeded projects with age and outstanding cents (${list.map((l) => `${l.age_days}d ${l.outstanding_cents}`).join(', ')})`);
  ok(!list.some((l) => l.document_id === c1.document_id) && !list.some((l) => l.document_id === dec.document_id), 'unpaid list: voided and fully paid proformas are not unpaid');

  const load = await all(`select * from tk_report_inspector_load(${W[0]}, ${W[1]}, true) where inspector_id = $1`, [inspector]);
  ok(load.length === 1 && load[0].open_jobs === 1 && load[0].overdue === 1 && load[0].published_in_period === 1 && load[0].awaiting_review === 0 && load[0].inspector_name === 'TK7 inspector',
    `inspector load: 1 open (overdue), 1 published in the period (${JSON.stringify(load[0] ?? null)})`);
  ok((await all(`select * from tk_report_inspector_load(${W[0]}, ${W[1]}, true) where inspector_id = $1`, [agent])).length === 0, 'inspector load: no row for someone without a job');

  // ── 4. dashboard ──
  await as(agent);
  const dash = (await one(`select tk_dashboard() d`)).d;
  ok(dash.can_see_all && dash.kpi && dash.kpi.waiting_approvals >= 1 && dash.kpi.open_by_stage.design >= 1 && dash.kpi.on_hold >= 1 && dash.kpi.unpaid_count >= 3 && dash.kpi.inspections_overdue >= 1,
    `dashboard: Turnkey editor gets KPIs (waiting ${dash.kpi?.waiting_approvals}, unpaid ${dash.kpi?.unpaid_count}, overdue inspections ${dash.kpi?.inspections_overdue})`);
  await as(am);
  const dAm = (await one(`select tk_dashboard() d`)).d;
  ok(!dAm.can_see_all && dAm.kpi === null && dAm.my_projects.some((x) => x.code === p1.code) && !dAm.my_projects.some((x) => x.code === p2.code),
    'dashboard: an account manager outside the division gets only "my projects" (no company KPIs)');
  await as(cust, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_dashboard()`)), 'dashboard: customer refused');

  // ── 5. settings ──
  await owner();
  await db.query(`delete from site_settings where key in ('turnkey.passport_retention_days', 'turnkey.am_waiver_threshold_cents')`); // rolled back
  await as(agent);
  const s0 = (await one(`select tk_settings() s`)).s;
  ok(s0.passport_retention_days === 30 && s0.passport_retention_set === false && s0.am_waiver_threshold_cents === null && s0.can_edit === false,
    'settings: retention 30 days (T6 default) until set; the account manager threshold is not set; non-admins cannot edit');
  ok(/FORBIDDEN/.test(await err(`select tk_set_passport_retention_days(45)`)) && /FORBIDDEN/.test(await err(`select tk_set_extra_traveller_price(12000)`))
     && /FORBIDDEN/.test(await err(`select tk_set_am_waiver_threshold(5000000)`)) && /FORBIDDEN/.test(await err(`select tk_set_deposit_pct(30)`)), 'settings: a Turnkey editor (not admin) is refused');
  await as(admin1, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_set_passport_retention_days(45)`)), 'settings: an admin without 2FA is refused');
  await as(cust, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_settings()`)), 'settings: customer cannot read them');
  await as(admin1);
  ok(/INVALID_DAYS/.test(await err(`select tk_set_passport_retention_days(0)`)) && /INVALID_PRICE/.test(await err(`select tk_set_extra_traveller_price(-1)`))
     && /INVALID_THRESHOLD/.test(await err(`select tk_set_am_waiver_threshold(0)`)) && /NOT_SET/.test(await err(`select tk_set_am_waiver_threshold(null)`)), 'settings: invalid values refused');
  await db.query(`select tk_set_passport_retention_days(45)`);
  await db.query(`select tk_set_extra_traveller_price(12000)`);
  await db.query(`select tk_set_am_waiver_threshold(5000000)`);
  const s1 = (await one(`select tk_settings() s`)).s;
  ok(s1.passport_retention_days === 45 && Number(s1.extra_traveller_day_cents) === 12000 && Number(s1.am_waiver_threshold_cents) === 5000000 && s1.can_edit === true,
    'settings: an admin on 2FA sets retention 45 days, extra traveller US$ 120 per day and the threshold');
  await owner();
  const svc = await one(`select extra_traveller_day_cents, rule_text from tk_services where code = 'visit_china'`);
  ok(Number(svc.extra_traveller_day_cents) === 12000 && /extra traveller \$120 per day/.test(svc.rule_text ?? ''), `settings: the price and the public rule text follow ("${svc.rule_text}")`);
  const rows = await all(`select key, is_public from site_settings where key in ('turnkey.passport_retention_days', 'turnkey.am_waiver_threshold_cents')`);
  ok(rows.length === 2 && rows.every((r) => r.is_public === false), 'settings: the setting rows are not public');
  await as(null, null, 'anon');
  ok((await all(`select key from site_settings where key in ('turnkey.passport_retention_days', 'turnkey.am_waiver_threshold_cents')`)).length === 0, 'settings: the public key cannot read them');
  await as(admin1);
  await db.query(`select tk_set_am_waiver_threshold(null)`);
  ok((await one(`select tk_am_waiver_threshold_cents() v`)).v === null, 'settings: the threshold can be cleared again');
  await owner();
  const aud = await all(`select details from audit_log where action = 'turnkey.setting' and actor_id = $1 order by id`, [admin1]);
  ok(aud.length === 4 && aud.some((a) => a.details.setting === 'passport_retention_days' && a.details.old === 30 && a.details.new === 45)
     && aud.some((a) => a.details.setting === 'extra_traveller_day_cents' && Number(a.details.new) === 12000)
     && aud.filter((a) => a.details.setting === 'am_waiver_threshold_cents').length === 2, `settings: every change audited with old and new (${aud.length})`);
  ok(!(await tryq(`select tk_purge_trip_passports_by_setting()`)).err, 'settings: the purge wrapper runs for the service role / owner');

  // ── 6. division report ──
  await as(admin1);
  const dr = await all(`select division_code, open_detail from division_report(null, null, true) where line = 'division'`);
  await owner();
  const exp = Number((await one(`select count(*) n from tk_client_projects where division_id = division_id_of('TK') and status in ('open', 'on_hold')`)).n);
  const tk = dr.find((r) => r.division_code === 'TK');
  ok(!!tk && Number(tk.open_detail?.turnkey_projects ?? 0) === exp && exp >= 3 && !('turnkey_leads' in (tk.open_detail ?? {})),
    `division report: open work counts open / on-hold client projects (${exp}), not the frozen leads`);

  // ── 7. down → up ──
  await owner();
  await ctx.unwindLater(db);
  const notesBefore = Number((await one(`select count(*) n from notifications where service = 'turnkey'`)).n);
  await db.query(ctx.DOWN);
  const gone = await one(`select to_regprocedure('public.tk_dashboard()') a, to_regprocedure('public.tk_t7_notify(uuid,uuid,uuid,text,text,text,text)') b,
    (select count(*)::int from pg_trigger where tgname like 'trg_tk_t7_%') t,
    (select prosrc from pg_proc where oid = 'public.division_report(timestamptz,timestamptz,boolean)'::regprocedure) r,
    (select count(*)::int from site_settings where key in ('turnkey.passport_retention_days', 'turnkey.am_waiver_threshold_cents')) s`);
  ok(!gone.a && !gone.b && gone.t === 0 && /turnkey_leads/.test(gone.r) && !/turnkey_projects/.test(gone.r) && gone.s === 0,
    'down: T7 functions, triggers and settings removed; the division report counts leads again (restored exactly)');
  ok(Number((await one(`select count(*) n from notifications where service = 'turnkey'`)).n) === notesBefore, 'down: notifications already sent are kept');
  await db.query(ctx.UP);
  await ctx.reapplyLater(db);
  ok(!!(await one(`select to_regprocedure('public.tk_dashboard()') a`)).a && (await one(`select count(*)::int n from pg_trigger where tgname like 'trg_tk_t7_%'`)).n === 9, 'up again after down');
  return failed;
}

// ───────── staging runner ─────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
  if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
    console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
    process.exit(1);
  }
  const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_t7_turnkey_reports_alerts_settings.sql'));
  if (!MIG) { console.error('✘ T7 migration file not found'); process.exit(1); }
  const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
  const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await assertStagingDatabase(db);
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  let later = [];
  let failed = 0;
  try {
    await db.query('begin');
    failed = await runT7Checks(db, {
      UP, DOWN, MIG,
      unwindLater: async (c) => { later = await appliedAfter(c, MIG); await unwind(c, later); },
      reapplyLater: async (c) => { await reapply(c, later); },
    });
  } catch (e) {
    console.log('✘ unexpected error: ' + e.message);
    failed++;
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
  console.log(failed ? `\nturnkey-t7: ${failed} check(s) failed` : '\nturnkey-t7: all passed');
  process.exitCode = failed ? 1 : 0;
}
