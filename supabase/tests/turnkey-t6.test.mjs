// Turnkey T6 DB checks — migration *_t6_turnkey_shipment_handover_trips. STAGING ONLY, one rolled-back transaction,
// acting as customers / staff through JWT claims (what PostgREST does).
//  1. Structure: RLS, no write grants, definer functions with search_path=public, internal helpers not callable,
//     customer-readable columns don't look internal (customer-columns INTERNAL_NAME), private buckets + storage policies,
//     Visit China prices as data on tk_services.
//  2. Balance gate: the balance (quote total − deposit) is issued after the deposit is paid; Shipment is refused until it is
//     FULLY paid (part payment is not enough); the T5 / T4 gates still come first.
//  3. Shipment: booking and tracking by Turnkey editors only (forward-only status, white-label text); clients read
//     tracking but never the staff note or authors; cancelled shipments are staff-only; Handover waits for delivery.
//  4. Documents: drafts and withdrawn documents are staff-only; clients (and storage reads) see released ones only.
//  5. Trips: price from tk_services (per day up to 2 people, extra traveller per day, extras); the 2x rule on the fee
//     (admin who is not the proposer above 2x); confirmation only after full payment; staff-only guide / notes.
//  6. Passport copies: uploaded by the client; readable only by the client company's (non-staff) members and Turnkey
//     staff with a need (editors on 2FA, the account manager on 2FA) — not finance, not another company; delete on request.
//  7. Handover: checklist, sign-off by the client completes the project; after it nothing changes except documents by
//     admins; tk_set_project_status no longer completes or reopens.
//  8. Guards, audit, client history without supplier names, ledger balanced, demo-wipe order, down → up.
// Set-up note: phases are set directly where earlier tests cover them (rolled back): the project is put into Quote and
// deposit / Production and QC, and a passed, published pre-shipment inspection is inserted (T5 covers that flow).
// Run: node supabase/tests/turnkey-t6.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;
const PLAN = 'A 150 m² gym in Izmir, opening next spring.';

/**
 * The checks, on an open pg-like client (query(sql, params) → { rows }). ctx: { UP, DOWN, MIG, unwindLater(db), reapplyLater(db) }.
 * Runs inside the caller's transaction; returns the number of failed checks.
 */
export async function runT6Checks(db, ctx) {
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
  const SUPPLIER = `Foshan Gymworks T6 ${stamp}`;
  let refN = 0;
  const mkUser = async (tag, role = null) => {
    const email = `tk6-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id, email_confirmed_at) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now()) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `TK6 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkOrg = async (name, uid) => {
    const id = (await one(`insert into organizations(name, country) values ($1, 'TR') returning id`, [name])).id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [id, uid]);
    return id;
  };
  const pay = async (doc, cents) => { await owner(); return (await one(`select pay_service_proforma($1, $2, 'bank_transfer', $3, null) r`, [doc, cents, `TK6-${stamp}-${++refN}`])).r; };
  const putObj = async (bucket, name, mime = 'application/pdf', size = 50000) => {
    await owner();
    await db.query(`insert into storage.objects (bucket_id, name, metadata) select $1, $2, $3::jsonb where not exists (select 1 from storage.objects where bucket_id = $1 and name = $2)`,
      [bucket, name, JSON.stringify({ mimetype: mime, size })]);
  };
  const uuid = async () => (await one(`select gen_random_uuid() u`)).u;
  const setStage = async (pid, stage) => {   // set-up only (rolled back)
    await owner();
    await db.query(`update tk_client_projects set stage = $2 where id = $1`, [pid, stage]);
    await db.query(`update tk_client_project_stages set started_at = now() where project_id = $1 and stage = $2`, [pid, stage]);
  };
  const passedPsi = async (pid, inspector, reviewer) => {   // set-up only: a passed, published pre-shipment inspection (T5 covers the flow)
    await owner();
    const i = (await one(`insert into tk_inspections (project_id, kind, round, status, scheduled_on, inspector_id, factory_name, created_by, scheduled_at, published_at, published_by)
      values ($1, 'pre_shipment', 1, 'published', current_date, $2, $3, $4, now(), now(), $4) returning id`, [pid, inspector, SUPPLIER, reviewer])).id;
    await db.query(`insert into tk_inspection_reports (inspection_id, project_id, submission_id, lot_size, sample_size, critical_defects, major_defects, minor_defects, result, signed_name, submitted_by, client_summary, published_at)
      values ($1, $2, gen_random_uuid(), 100, 10, 0, 0, 0, 'pass', 'TK6 QC', $3, 'Passed.', now())`, [i, pid, inspector]);
    return i;
  };

  const admin1 = await mkUser('admin1', 'admin');
  const admin2 = await mkUser('admin2', 'admin');
  const agent = await mkUser('agent', 'sourcing_agent');
  const fin = await mkUser('finance', 'finance');
  const am = await mkUser('am', 'account_manager');
  const cust = await mkUser('cust');
  const custB = await mkUser('custb');
  const orgA = await mkOrg('TK6 Client A', cust);
  await mkOrg('TK6 Client B', custB);
  await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('TK'), 'staff')`, [agent]);
  await as(cust, 'aal1');
  const p1 = (await one(`select tk_submit_enquiry($1, null, 'TK6 gym', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  const p2 = (await one(`select tk_submit_enquiry($1, null, 'TK6 laundry', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  await owner();
  await db.query(`delete from site_settings where key = 'turnkey.deposit_pct'`); // rolled back
  await db.query(`insert into tk_factory_quotes (project_id, supplier_name, total_cost_cents, created_by) values ($1, $2, 100000, $3)`, [p1.id, SUPPLIER, agent]); // set-up: a factory of p1 (white-label checks)

  // ── 1. structure ──
  await db.query(ctx.UP); // re-runnable
  const T = ['tk_quote_balances', 'tk_shipments', 'tk_shipment_events', 'tk_project_documents', 'tk_handover_items', 'tk_handover_signoffs', 'tk_trips', 'tk_trip_fees', 'tk_trip_travellers'];
  ok((await all(`select relname from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace and relrowsecurity`, [T])).length === T.length, `T6: RLS on all ${T.length} new tables (up is re-runnable)`);
  const writes = await all(`select t from unnest($1::text[]) t where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
    or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('anon', 'public.' || t, 'SELECT')`, [T]);
  ok(writes.length === 0, `T6: no write grants, nothing for anon (${writes.map((w) => w.t).join(',') || 'none'})`);
  const fns = await all(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'EXECUTE') anon
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tk\\_%' and p.proname <> 'tk_import_catalogue'`);
  ok(fns.every((f) => f.prosecdef && /search_path=public/.test(f.cfg) && !f.anon), `T6: all ${fns.length} tk_ functions are security definer, search_path=public, not for anon`);
  const internal = await all(`select x, has_function_privilege('authenticated', x, 'EXECUTE') e from unnest(array['public.tk_balance_state(uuid)', 'public.tk_usd(bigint)',
    'public.tk_shipment_status_label(text)', 'public.tk_document_kind_label(text)', 'public.tk_trip_label(uuid)', 'public.tk_supersede_trip_fee(uuid)',
    'public.tk_trip_fee_activated(uuid,uuid)', 'public.tk_doc_editor_check(uuid,text,uuid)', 'public.tk_purge_trip_passports(integer)', 'public.tk_t6_history_guard()']) x`);
  ok(internal.every((r) => !r.e), 'T6: internal helpers (and the passport purge) not callable by users');
  const ccols = await all(`select table_name t, column_name c from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated' and privilege_type = 'SELECT'`, [T]);
  const badCols = ccols.filter((r) => INTERNAL_NAME.test(r.c) || /staff_note|guide|issued_by|uploaded_by|done_by|signed_by|requested_by|confirmed_by|proposed|approved|rejected|withdraw_reason/.test(r.c));
  ok(ccols.length > 0 && badCols.length === 0, `T6: customer-readable columns are customer-safe (${ccols.length}${badCols.length ? '; BAD ' + badCols.map((b) => `${b.t}.${b.c}`).join(',') : ''})`);
  const buckets = await all(`select id, public, file_size_limit::bigint l from storage.buckets where id in ('turnkey-documents', 'turnkey-passports') order by id`);
  ok(buckets.length === 2 && buckets.every((b) => b.public === false) && Number(buckets[0].l) === 20971520 && Number(buckets[1].l) === 10485760, 'T6: private buckets turnkey-documents (20 MB) and turnkey-passports (10 MB)');
  const spol = (await all(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and (policyname like 'turnkey documents%' or policyname like 'turnkey passports%') order by 1`)).map((r) => r.policyname).join('|');
  ok(spol === 'turnkey documents read|turnkey documents remove unregistered|turnkey documents staff upload|turnkey passports client upload|turnkey passports read|turnkey passports remove unregistered', `T6: storage policies (${spol})`);
  const visit = await one(`select from_cents::int f, included_travellers i, extra_traveller_day_cents::int x from tk_services where code = 'visit_china'`);
  ok(visit.f === 39900 && visit.i === 2 && visit.x === 9900, 'T6: Visit China from US$ 399 per day for up to 2 people, extra traveller US$ 99 per day (tk_services)');

  // ── 2. balance gate ──
  await setStage(p1.id, 'quote_deposit');
  await as(agent);
  ok(/QUOTE_NOT_ACCEPTED/.test(await err(`select tk_issue_balance_invoice($1)`, [p1.id])), 'balance: refused before the client accepts a quote');
  await as(admin1);
  await db.query(`select tk_set_deposit_pct(30)`);
  await as(agent);
  const draft = (await one(`select tk_save_client_quote($1, null, null, $2::jsonb) r`, [p1.id, JSON.stringify([{ description: 'Commercial treadmill', qty: 2, unit_price_cents: 150000 }])])).r;
  await db.query(`select tk_send_client_quote($1)`, [draft.id]);
  await as(cust, 'aal1');
  const acc = (await one(`select tk_decide_client_quote($1, 'accept', null) r`, [draft.id])).r;
  await as(agent);
  ok(/DEPOSIT_NOT_PAID/.test(await err(`select tk_issue_balance_invoice($1)`, [p1.id])), 'balance: refused until the deposit is paid');
  await pay(acc.document_id, Number(acc.deposit_cents));
  await as(cust, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_issue_balance_invoice($1)`, [p1.id])), 'balance: the client cannot issue it');
  await as(agent, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_issue_balance_invoice($1)`, [p1.id])), 'balance: staff without 2FA refused');
  await setStage(p1.id, 'production_qc');
  await as(agent);
  ok(/PSI_REQUIRED/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: the T5 inspection gate still comes first');
  await passedPsi(p1.id, admin2, admin1);
  await as(agent);
  ok(/BALANCE_NOT_INVOICED/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: Shipment refused before the balance invoice');
  const bal = (await one(`select tk_issue_balance_invoice($1) r`, [p1.id])).r;
  await owner();
  const balDoc = await one(`select amount_cents::bigint a, data ->> 'ref_type' rt, data ->> 'service' s from documents where id = $1`, [bal.document_id]);
  ok(Number(bal.amount_cents) === 300000 - 90000 && Number(balDoc.a) === 210000 && balDoc.rt === 'tk_quote_balance' && balDoc.s === 'turnkey', 'balance: quote total − deposit (US$ 3,000 − 900 = 2,100), turnkey proforma');
  await as(agent);
  ok(/BALANCE_ALREADY_ISSUED/.test(await err(`select tk_issue_balance_invoice($1)`, [p1.id])), 'balance: issued once');
  ok(/BALANCE_NOT_PAID/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: Shipment refused while the balance is unpaid');
  await pay(bal.document_id, 100000);
  await as(agent);
  ok(/BALANCE_NOT_PAID/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: part payment of the balance is not enough');
  await as(cust, 'aal1');
  const cbal = await all(`select amount_cents::bigint a, document_id from tk_quote_balances where project_id = $1`, [p1.id]);
  ok(cbal.length === 1 && Number(cbal[0].a) === 210000 && /permission denied/.test(await err(`select issued_by from tk_quote_balances`)), 'customer: sees the balance (amount, proforma), never who issued it');
  await as(custB, 'aal1');
  ok((await all(`select 1 from tk_quote_balances where project_id = $1`, [p1.id])).length === 0, 'other customer: no balance rows');
  await pay(bal.document_id, 110000);
  await as(agent);
  ok(!(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: balance fully paid → Shipment');
  await setStage(p2.id, 'production_qc');
  await passedPsi(p2.id, admin2, admin1);
  await as(agent);
  ok(/QUOTE_NOT_ACCEPTED/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p2.id])), 'gate: no accepted quote → no Shipment');

  // ── 3. shipments and tracking ──
  await as(agent);
  ok(/NOT_IN_SHIPMENT/.test(await err(`select tk_create_shipment($1, 'sea', 'COSCO', null, null, null, null, null, null, null)`, [p2.id])), 'shipment: booked in the Shipment phase only');
  ok(/INVALID_MODE/.test(await err(`select tk_create_shipment($1, 'rail', 'X', null, null, null, null, null, null, null)`, [p1.id])), 'shipment: sea, air or express');
  ok(/SUPPLIER_NAME_SHOWN/.test(await err(`select tk_create_shipment($1, 'sea', 'COSCO', null, null, null, $2, null, null, null)`, [p1.id, `${SUPPLIER} warehouse`])), 'shipment: details naming a factory are refused (white-label)');
  ok(/INVALID_DATES/.test(await err(`select tk_create_shipment($1, 'sea', 'COSCO', null, null, null, null, null, current_date + 5, current_date + 1)`, [p1.id])), 'shipment: arrival not before departure');
  await as(cust, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_create_shipment($1, 'sea', 'COSCO', null, null, null, null, null, null, null)`, [p1.id])), 'shipment: the client cannot book');
  await as(fin);
  ok(/FORBIDDEN/.test(await err(`select tk_create_shipment($1, 'sea', 'COSCO', null, null, null, null, null, null, null)`, [p1.id])), 'shipment: view-only staff (finance) cannot book');
  await as(agent);
  const sh1 = (await one(`select tk_create_shipment($1, 'sea', 'COSCO Shipping', 'BK-7781', 'mscu1234567', null, 'Shenzhen (Yantian)', 'Izmir (Alsancak)', current_date, current_date + 30, 'Forwarder rate US$ 2,350 (staff only)') r`, [p1.id])).r;
  const sh2 = (await one(`select tk_create_shipment($1, 'air', 'Turkish Cargo', null, null, 'TK-555', 'Guangzhou', 'Izmir', null, null, null) r`, [p1.id])).r;
  ok(sh1.seq === 1 && sh2.seq === 2, 'shipment: numbered per project');
  ok((await one(`select container_no from tk_shipments where id = $1`, [sh1.id])).container_no === 'MSCU1234567', 'shipment: container number stored in capitals');
  ok(/INVALID_DATE/.test(await err(`select tk_add_shipment_event($1, now() + interval '3 days', 'in_transit', null, 'Loaded')`, [sh1.id])), 'event: not in the future');
  ok(/SUPPLIER_NAME_SHOWN/.test(await err(`select tk_add_shipment_event($1, now(), null, null, $2)`, [sh1.id, `Picked up at ${SUPPLIER}`])), 'event: text naming a factory is refused');
  await db.query(`select tk_add_shipment_event($1, now() - interval '1 hour', 'in_transit', 'Yantian port', 'Loaded on the vessel')`, [sh1.id]);
  ok(/STATUS_BACKWARDS/.test(await err(`select tk_add_shipment_event($1, now(), 'in_transit', null, 'Again')`, [sh1.id])), 'event: status moves forward only');
  await db.query(`select tk_add_shipment_event($1, now(), null, 'Singapore', 'Transhipment on schedule')`, [sh1.id]);
  ok(/SHIPMENT_MOVING/.test(await err(`select tk_cancel_shipment($1, 'x')`, [sh1.id])), 'cancel: only a booked shipment');
  ok(/REASON_REQUIRED/.test(await err(`select tk_cancel_shipment($1, ' ')`, [sh2.id])), 'cancel: reason required');
  await db.query(`select tk_cancel_shipment($1, 'Booked twice by mistake')`, [sh2.id]);
  await as(cust, 'aal1');
  const csh = await all(`select id, status, carrier, container_no from tk_shipments where project_id = $1`, [p1.id]);
  ok(csh.length === 1 && csh[0].id === sh1.id && csh[0].status === 'in_transit' && csh[0].carrier === 'COSCO Shipping', 'customer: sees the live shipment (carrier and status), not the cancelled one');
  const cev = await all(`select description, location from tk_shipment_events where shipment_id = $1 order by happened_at`, [sh1.id]);
  ok(cev.length === 2 && cev[0].description === 'Loaded on the vessel', 'customer: sees the tracking events');
  ok(/permission denied/.test(await err(`select staff_note from tk_shipments`)) && /permission denied/.test(await err(`select created_by from tk_shipment_events`))
    && /permission denied/.test(await err(`select cancel_reason from tk_shipments`)), 'customer: staff note, cancel reason and authors refused');
  await as(custB, 'aal1');
  ok((await all(`select 1 from tk_shipments where project_id = $1`, [p1.id])).length === 0 && (await all(`select 1 from tk_shipment_events where project_id = $1`, [p1.id])).length === 0, 'other customer: no shipments, no events');
  await as(fin);
  ok((await all(`select 1 from tk_shipments where project_id = $1`, [p1.id])).length === 2, 'staff (view): sees both shipments, cancelled included');
  await as(agent);
  ok(/SHIPMENT_NOT_DELIVERED/.test(await err(`select tk_move_project_stage($1, 'handover', null)`, [p1.id])), 'gate: Handover waits until every shipment is delivered');

  // ── 4. documents (draft → released → withdrawn) ──
  const bl = `${p1.id}/${await uuid()}-bill-of-lading.pdf`;
  const pl = `${p1.id}/${await uuid()}-packing-list.pdf`;
  const cx = `${p1.id}/${await uuid()}-cancelled.pdf`;
  await as(agent);
  ok((await one(`select tk_doc_can_upload($1) r`, [p1.id])).r === true && (await one(`select tk_doc_can_upload($1) r`, [p2.id])).r === false, 'storage: an editor uploads in Shipment / Handover only');
  await as(cust, 'aal1');
  ok((await one(`select tk_doc_can_upload($1) r`, [p1.id])).r === false, 'storage: the client cannot upload documents');
  await putObj('turnkey-documents', bl); await putObj('turnkey-documents', pl); await putObj('turnkey-documents', cx);
  await as(agent);
  ok(/SHIPMENT_REQUIRED/.test(await err(`select tk_add_project_document($1, 'shipment', 'bill_of_lading', null, $2, 'bl.pdf', null)`, [p1.id, bl])), 'document: a shipping document belongs to a shipment');
  ok(/SHIPMENT_CLOSED/.test(await err(`select tk_add_project_document($1, 'shipment', 'other', null, $2, 'x.pdf', $3)`, [p1.id, cx, sh2.id])), 'document: not for a cancelled shipment');
  ok(/NOT_AT_HANDOVER/.test(await err(`select tk_add_project_document($1, 'handover', 'warranty', null, $2, 'w.pdf', null)`, [p1.id, cx])), 'document: final documents in Handover');
  ok(/FILE_NOT_UPLOADED/.test(await err(`select tk_add_project_document($1, 'shipment', 'bill_of_lading', null, $2, 'bl.pdf', $3)`, [p1.id, `${p1.id}/missing.pdf`, sh1.id])), 'document: the file must be in the private bucket');
  const dBl = (await one(`select tk_add_project_document($1, 'shipment', 'bill_of_lading', 'Original B/L', $2, 'bl.pdf', $3) r`, [p1.id, bl, sh1.id])).r;
  const dPl = (await one(`select tk_add_project_document($1, 'shipment', 'packing_list', null, $2, 'pl.pdf', $3) r`, [p1.id, pl, sh1.id])).r;
  await as(cust, 'aal1');
  ok((await all(`select 1 from tk_project_documents where project_id = $1`, [p1.id])).length === 0 && (await all(`select name from storage.objects where bucket_id = 'turnkey-documents' and name like $1`, [`${p1.id}/%`])).length === 0,
    'customer: drafts are invisible (rows and files)');
  await as(agent);
  await db.query(`select tk_release_project_document($1)`, [dBl.id]);
  ok(/DOCUMENT_SHARED/.test(await err(`select tk_release_project_document($1)`, [dBl.id])), 'document: released once');
  await as(cust, 'aal1');
  const cdocs = await all(`select id, title, file_path from tk_project_documents where project_id = $1`, [p1.id]);
  const cobjs = await all(`select name from storage.objects where bucket_id = 'turnkey-documents' and name like $1`, [`${p1.id}/%`]);
  ok(cdocs.length === 1 && cdocs[0].id === dBl.id && cobjs.length === 1 && cobjs[0].name === bl, 'customer: only the released document (row and file for the signed URL)');
  ok(/permission denied/.test(await err(`select uploaded_by from tk_project_documents`)) && /permission denied/.test(await err(`select withdraw_reason from tk_project_documents`)), 'customer: uploader and withdraw reason refused');
  await as(custB, 'aal1');
  ok((await all(`select 1 from tk_project_documents where project_id = $1`, [p1.id])).length === 0 && (await all(`select name from storage.objects where bucket_id = 'turnkey-documents' and name like $1`, [`${p1.id}/%`])).length === 0,
    'other customer: no documents, no files');
  await as(agent);
  ok(/DOCUMENT_SHARED/.test(await err(`select tk_remove_project_document($1)`, [dBl.id])), 'document: a released document is withdrawn, not removed');
  const removed = (await one(`select tk_remove_project_document($1) r`, [dPl.id])).r;
  ok(removed === pl && (await one(`select tk_doc_orphan_removable($1) r`, [pl])).r === true, 'document: a draft is removed and its file may be deleted (unregistered)');
  ok(/REASON_REQUIRED/.test(await err(`select tk_withdraw_project_document($1, '')`, [dBl.id])), 'withdraw: reason required');
  await db.query(`select tk_withdraw_project_document($1, 'Wrong consignee')`, [dBl.id]);
  await as(cust, 'aal1');
  ok((await all(`select 1 from tk_project_documents where project_id = $1`, [p1.id])).length === 0, 'customer: a withdrawn document disappears');
  const bl2 = `${p1.id}/${await uuid()}-bill-of-lading-2.pdf`;
  await putObj('turnkey-documents', bl2);
  await as(agent);
  const dBl2 = (await one(`select tk_add_project_document($1, 'shipment', 'bill_of_lading', null, $2, 'bl2.pdf', $3) r`, [p1.id, bl2, sh1.id])).r;
  await db.query(`select tk_release_project_document($1)`, [dBl2.id]);

  // ── 5. trips: price from tk_services, the fee's 2x rule, paid before confirmation ──
  await as(cust, 'aal1');
  const est = (await one(`select tk_trip_estimate(current_date + 40, current_date + 42, 3, 3, 2, 1, true) r`)).r;
  ok(est.days === 3 && Number(est.list_cents) === 3 * 39900 + 3 * 1 * 9900 + 3 * 4900 + 2 * 10000 + 3900 && est.lines.some((l) => l.code === 'extra_traveller' && l.qty === 3),
    `trip price: 3 days × US$ 399 + 1 extra traveller × 3 days × US$ 99 + 3 visa letters + 2 car days + 1 pick-up + hotel help (free) = ${est.list_cents}`);
  const est2 = (await one(`select tk_trip_estimate(current_date + 40, current_date + 40, 2, 0, 0, 0, false) r`)).r;
  ok(Number(est2.list_cents) === 39900 && !est2.lines.some((l) => l.code === 'extra_traveller'), 'trip price: 1 day for 2 people = US$ 399 (no extra traveller)');
  ok(/INVALID_EXTRAS/.test(await err(`select tk_trip_estimate(current_date + 40, current_date + 41, 2, 3, 0, 0, false)`)), 'trip: at most one visa letter per traveller');
  ok(/INVALID_EXTRAS/.test(await err(`select tk_trip_estimate(current_date + 40, current_date + 41, 2, 0, 3, 0, false)`)), 'trip: car days within the visit');
  ok(/TRIP_TOO_LONG/.test(await err(`select tk_trip_estimate(current_date + 40, current_date + 70, 2, 0, 0, 0, false)`)), 'trip: at most 30 days');
  await as(agent);
  ok(/FORBIDDEN/.test(await err(`select tk_request_trip($1, current_date + 40, current_date + 42, 3, 3, 2, 1, true, null)`, [p2.id])), 'trip: staff do not request trips for the client');
  await as(cust, 'aal1');
  ok(/INVALID_DATES/.test(await err(`select tk_request_trip($1, current_date, current_date + 1, 2, 0, 0, 0, false, null)`, [p2.id])), 'trip: starts tomorrow or later');
  const trip = (await one(`select tk_request_trip($1, current_date + 40, current_date + 42, 3, 3, 2, 1, true, 'Two factory visits and a showroom') r`, [p2.id])).r;
  ok(Number(trip.list_cents) === Number(est.list_cents), 'trip: requested; the list price is frozen on the trip');
  ok(/TRIP_OPEN/.test(await err(`select tk_request_trip($1, current_date + 50, current_date + 51, 2, 0, 0, 0, false, null)`, [p2.id])), 'trip: one open trip per project');
  await owner();
  ok(/check constraint|tk_trips_price/.test(await err(`insert into tk_trips (project_id, seq, start_on, end_on, days, travellers, day_cents, included_travellers, extra_traveller_day_cents, visa_letter_cents, car_day_cents, airport_pickup_cents, hotel_help_cents, list_cents)
    values ($1, 9, current_date + 60, current_date + 60, 1, 1, 39900, 2, 9900, 4900, 10000, 3900, 0, 100)`, [p2.id])), 'trip: the list price must match its lines (constraint)');
  const list = Number(trip.list_cents);
  await as(agent);
  const big = (await one(`select tk_propose_trip_fee($1, $2, 'premium hotel') r`, [trip.id, 2 * list + 1])).r;
  ok(big.status === 'pending_approval', 'trip fee: above 2x the list price waits for an admin');
  await as(admin1);
  ok(!(await err(`select tk_decide_trip_fee($1, 'approve', null)`, [big.id])), 'trip fee: an admin who did not propose it approves');
  const mine = (await one(`select tk_propose_trip_fee($1, $2, null) r`, [trip.id, 2 * list + 500])).r;
  ok(/TWO_PERSON_REQUIRED/.test(await err(`select tk_decide_trip_fee($1, 'approve', null)`, [mine.id])), 'trip fee: the proposer cannot approve (two-person)');
  await as(admin2);
  ok(/REASON_REQUIRED/.test(await err(`select tk_decide_trip_fee($1, 'reject', ' ')`, [mine.id])), 'trip fee: rejection needs a reason');
  await db.query(`select tk_decide_trip_fee($1, 'reject', 'Too high for a 3-day visit')`, [mine.id]);
  await as(agent);
  const fee = (await one(`select tk_propose_trip_fee($1, $2, null) r`, [trip.id, 2 * list])).r;
  ok(fee.status === 'active', 'trip fee: exactly 2x the list price is active at once (replaces the unpaid approved version)');
  await owner();
  ok((await one(`select status from documents where id = (select document_id from tk_trip_fees where id = $1)`, [big.id])).status === 'void', 'trip fee: the replaced unpaid proforma is voided');
  await as(agent);
  ok(/TRIP_NOT_PAID/.test(await err(`select tk_confirm_trip($1, 'Day 1: showroom', null, null)`, [trip.id])), 'trip: confirmed only after the fee is paid');
  await pay(fee.document_id, list);
  await as(agent);
  ok(/TRIP_NOT_PAID/.test(await err(`select tk_confirm_trip($1, 'Day 1: showroom', null, null)`, [trip.id])), 'trip: part payment is not enough');
  await pay(fee.document_id, list);
  await as(agent);
  ok(/FEE_PAID_LOCKED/.test(await err(`select tk_propose_trip_fee($1, $2, null)`, [trip.id, list])), 'trip fee: a paid fee cannot be changed');
  ok(/ITINERARY_REQUIRED/.test(await err(`select tk_confirm_trip($1, ' ', null, null)`, [trip.id])), 'trip: the itinerary is required');
  await db.query(`select tk_confirm_trip($1, 'Day 1: Guangzhou showroom. Day 2: two factory visits in Foshan. Day 3: QC office.', 'Lily Chen', 'Hotel booked at the Garden, cost US$ 120/night')`, [trip.id]);
  await as(cust, 'aal1');
  const ctrip = await one(`select status, itinerary, list_cents::bigint l from tk_trips where id = $1`, [trip.id]);
  const cfee = await all(`select amount_cents::bigint a from tk_trip_fees where trip_id = $1`, [trip.id]);
  ok(ctrip.status === 'confirmed' && /Day 1/.test(ctrip.itinerary) && cfee.length === 1 && Number(cfee[0].a) === 2 * list, 'customer: sees the confirmed itinerary and the active fee only');
  ok(/permission denied/.test(await err(`select guide_name from tk_trips`)) && /permission denied/.test(await err(`select staff_notes from tk_trips`)) && /permission denied/.test(await err(`select note from tk_trip_fees`)),
    'customer: guide, staff notes and fee notes refused');
  await as(cust, 'aal1');
  ok(/FEE_PAID_LOCKED/.test(await err(`select tk_cancel_trip($1, 'Plans changed')`, [trip.id])), 'trip: a paid trip is not cancelled here (refunds are handled separately)');

  // ── 6. passport copies: client upload; client company + staff with a need only ──
  const tr1 = await uuid();
  const pp1 = `${p2.id}/${trip.id}/${tr1}.jpg`;
  await as(cust, 'aal1');
  ok((await one(`select tk_passport_can_upload($1, $2) r`, [p2.id, trip.id])).r === true, 'storage: the client may upload passport copies for the trip');
  for (const [u, l, aal] of [[agent, 'a Turnkey editor', 'aal2'], [custB, 'another company', 'aal1'], [fin, 'finance', 'aal2']]) {
    await as(u, aal);
    ok((await one(`select tk_passport_can_upload($1, $2) r`, [p2.id, trip.id])).r === false, `storage: ${l} cannot upload passport copies`);
  }
  await putObj('turnkey-passports', pp1, 'image/jpeg', 300000);
  await as(cust, 'aal1');
  ok(/INVALID_FILE/.test(await err(`select tk_add_trip_passport($1, $2, 1, 'Ayse Yilmaz', $3)`, [tr1, trip.id, `${p2.id}/${trip.id}/other.jpg`])), 'passport: the file name is the traveller id');
  ok(/INVALID_TRAVELLER/.test(await err(`select tk_add_trip_passport($1, $2, 4, 'Ayse Yilmaz', $3)`, [tr1, trip.id, pp1])), 'passport: traveller 1 to 3');
  const r1 = (await one(`select tk_add_trip_passport($1, $2, 1, 'Ayse  Yilmaz', $3) r`, [tr1, trip.id, pp1])).r;
  const r1b = (await one(`select tk_add_trip_passport($1, $2, 1, 'Ayse Yilmaz', $3) r`, [tr1, trip.id, pp1])).r;
  ok(!r1.duplicate && r1b.duplicate, 'passport: registered once (retry-safe)');
  ok(/TRAVELLER_DONE/.test(await err(`select tk_add_trip_passport(gen_random_uuid(), $1, 1, 'Other', $2)`, [trip.id, pp1])), 'passport: one copy per traveller');
  await as(agent);
  ok(/FORBIDDEN/.test(await err(`select tk_add_trip_passport(gen_random_uuid(), $1, 2, 'Staff', $2)`, [trip.id, pp1])), 'passport: staff do not register copies');
  const seesPassport = async (u, aal) => {
    await as(u, aal);
    return [(await all(`select full_name from tk_trip_travellers where trip_id = $1`, [trip.id])).length, (await all(`select name from storage.objects where bucket_id = 'turnkey-passports' and name = $1`, [pp1])).length];
  };
  const vCust = await seesPassport(cust, 'aal1');
  ok(vCust[0] === 1 && vCust[1] === 1, 'passport: the client company sees its copy (row and file)');
  const vB = await seesPassport(custB, 'aal1');
  ok(vB[0] === 0 && vB[1] === 0, 'passport: another company sees nothing');
  const vAgent = await seesPassport(agent, 'aal2');
  ok(vAgent[0] === 1 && vAgent[1] === 1, 'passport: a Turnkey editor (TK division, 2FA) sees it');
  const vAgent1 = await seesPassport(agent, 'aal1');
  ok(vAgent1[0] === 0 && vAgent1[1] === 0, 'passport: the same editor without 2FA sees nothing');
  const vFin = await seesPassport(fin, 'aal2');
  ok(vFin[0] === 0 && vFin[1] === 0, 'passport: view-only staff (finance) see nothing');
  const vAm0 = await seesPassport(am, 'aal2');
  await as(agent);
  await db.query(`select tk_set_project_manager($1, $2)`, [p2.id, am]);
  const vAm = await seesPassport(am, 'aal2');
  ok(vAm0[0] === 0 && vAm[0] === 1 && vAm[1] === 1, 'passport: the project\'s account manager sees it (other account managers do not)');
  await as(agent);
  const st = (await one(`select tk_staff_trips($1) r`, [p2.id])).r;
  await as(fin);
  const stFin = (await one(`select tk_staff_trips($1) r`, [p2.id])).r;
  ok(st.passport_access === true && st.trips[0].passports.length === 1 && stFin.passport_access === false && stFin.trips[0].passports === null && stFin.trips[0].passports_count === 1,
    'staff read: names and files only for staff with a need (others see the count)');
  await as(custB, 'aal1');
  ok(/NOT_FOUND/.test(await err(`select tk_delete_trip_passport($1)`, [tr1])), 'passport delete: another company cannot');
  await as(cust, 'aal1');
  const delPath = (await one(`select tk_delete_trip_passport($1) r`, [tr1])).r;
  ok(delPath === pp1 && (await all(`select 1 from tk_trip_travellers where id = $1`, [tr1])).length === 0 && (await one(`select tk_passport_orphan_removable($1) r`, [pp1])).r === true,
    'passport delete on request: the row goes and the client may remove the file');
  await as(custB, 'aal1');
  ok((await one(`select tk_passport_orphan_removable($1) r`, [pp1])).r === false, 'passport file: another company cannot remove it');
  await owner();
  const purged = await all(`select tk_purge_trip_passports(30) p`);
  ok(Array.isArray(purged), 'retention: tk_purge_trip_passports runs for the service role (open trips untouched)');

  // ── 7. handover: checklist, sign-off completes the project ──
  await as(agent);
  await db.query(`select tk_add_shipment_event($1, now(), 'arrived', 'Izmir (Alsancak)', 'Arrived at the port')`, [sh1.id]);
  await db.query(`select tk_add_shipment_event($1, now(), 'delivered', 'Izmir', 'Delivered to the site and signed for')`, [sh1.id]);
  ok(/SHIPMENT_CLOSED/.test(await err(`select tk_add_shipment_event($1, now(), null, null, 'late note')`, [sh1.id])), 'event: none after delivery');
  ok(!(await err(`select tk_move_project_stage($1, 'handover', null)`, [p1.id])), 'gate: every shipment delivered → Handover');
  ok(/SIGN_OFF_REQUIRED/.test(await err(`select tk_set_project_status($1, 'completed', null)`, [p1.id])), 'status: staff cannot complete; the client signs the handover');
  await as(cust, 'aal1');
  ok(/CHECKLIST_EMPTY/.test(await err(`select tk_sign_handover($1, 'Ayse Yilmaz', null)`, [p1.id])), 'sign-off: refused while the checklist is empty');
  await as(agent);
  ok(/SUPPLIER_NAME_SHOWN/.test(await err(`select tk_add_handover_item($1, $2)`, [p1.id, `${SUPPLIER} warranty`])), 'checklist: lines naming a factory are refused');
  const it1 = (await one(`select tk_add_handover_item($1, 'Warranty certificates') r`, [p1.id])).r;
  const it2 = (await one(`select tk_add_handover_item($1, 'Operation manuals') r`, [p1.id])).r;
  const it3 = (await one(`select tk_add_handover_item($1, 'Spare') r`, [p1.id])).r;
  await db.query(`select tk_remove_handover_item($1)`, [it3]);
  const wd = `${p1.id}/${await uuid()}-warranty.pdf`;
  await putObj('turnkey-documents', wd);
  await as(agent);
  const dW = (await one(`select tk_add_project_document($1, 'handover', 'warranty', null, $2, 'warranty.pdf', null) r`, [p1.id, wd])).r;
  ok(/INVALID_DOCUMENT/.test(await err(`select tk_set_handover_item_done($1, true, $2)`, [it1, dW.id])), 'checklist: only a shared final document can be attached');
  await db.query(`select tk_release_project_document($1)`, [dW.id]);
  await db.query(`select tk_set_handover_item_done($1, true, $2)`, [it1, dW.id]);
  await as(cust, 'aal1');
  ok(/CHECKLIST_OPEN/.test(await err(`select tk_sign_handover($1, 'Ayse Yilmaz', null)`, [p1.id])), 'sign-off: refused while a line is open');
  const tOpen = (await one(`select tk_request_trip($1, current_date + 20, current_date + 20, 1, 0, 0, 0, false, null) r`, [p1.id])).r;
  await as(agent);
  await db.query(`select tk_set_handover_item_done($1, true, null)`, [it2]);
  await as(cust, 'aal1');
  ok(/TRIP_OPEN/.test(await err(`select tk_sign_handover($1, 'Ayse Yilmaz', null)`, [p1.id])), 'sign-off: refused while a China visit is open');
  await db.query(`select tk_cancel_trip($1, 'Not needed after all')`, [tOpen.id]);
  ok(/NAME_REQUIRED/.test(await err(`select tk_sign_handover($1, ' ', null)`, [p1.id])), 'sign-off: the typed full name is required');
  await as(agent);
  ok(/FORBIDDEN/.test(await err(`select tk_sign_handover($1, 'Agent', null)`, [p1.id])), 'sign-off: staff cannot sign for the client');
  await as(custB, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_sign_handover($1, 'Other', null)`, [p1.id])), 'sign-off: another company cannot sign');
  await as(cust, 'aal1');
  const so = (await one(`select tk_sign_handover($1, 'Ayse Yilmaz', 'All received in good order.') r`, [p1.id])).r;
  const pc = await one(`select status, stage from tk_client_projects where id = $1`, [p1.id]);
  const hs = await one(`select completed_at is not null c from tk_client_project_stages where project_id = $1 and stage = 'handover'`, [p1.id]);
  ok(so.status === 'completed' && pc.status === 'completed' && pc.stage === 'handover' && hs.c, 'sign-off: the project is completed at Handover');
  const cso = await all(`select signed_name, signed_at from tk_handover_signoffs where project_id = $1`, [p1.id]);
  ok(cso.length === 1 && cso[0].signed_name === 'Ayse Yilmaz' && cso[0].signed_at && /permission denied/.test(await err(`select signed_by from tk_handover_signoffs`)), 'customer: sees the typed name and time; the signing account is staff-only');
  ok(/ALREADY_SIGNED/.test(await err(`select tk_sign_handover($1, 'Ayse Yilmaz', null)`, [p1.id])), 'sign-off: once');
  await as(agent);
  ok(/PROJECT_COMPLETED/.test(await err(`select tk_set_project_status($1, 'open', null)`, [p1.id])), 'after sign-off: the project cannot be reopened');
  ok(/PROJECT_NOT_OPEN/.test(await err(`select tk_add_handover_item($1, 'Late line')`, [p1.id])) && /PROJECT_NOT_OPEN/.test(await err(`select tk_create_shipment($1, 'sea', 'X', null, null, null, null, null, null, null)`, [p1.id]))
    && /PROJECT_NOT_OPEN/.test(await err(`select tk_set_handover_item_done($1, false, null)`, [it1])), 'after sign-off: checklist and shipments are frozen');
  const late = `${p1.id}/${await uuid()}-late.pdf`;
  await putObj('turnkey-documents', late);
  await as(agent);
  ok((await one(`select tk_doc_can_upload($1) r`, [p1.id])).r === false && /PROJECT_COMPLETED/.test(await err(`select tk_add_project_document($1, 'handover', 'manual', null, $2, 'late.pdf', null)`, [p1.id, late])),
    'after sign-off: an editor who is not an admin cannot add documents');
  await as(admin1);
  const dLate = (await one(`select tk_add_project_document($1, 'handover', 'manual', 'Updated manual', $2, 'late.pdf', null) r`, [p1.id, late])).r;
  ok((await one(`select tk_doc_can_upload($1) r`, [p1.id])).r === true && !(await err(`select tk_release_project_document($1)`, [dLate.id])), 'after sign-off: an admin can still add and release documents');

  // ── 8. guards, audit, history, ledger, wipe order ──
  await owner();
  ok(/TK_HISTORY_KEPT/.test(await err(`update tk_shipment_events set description = 'x' where shipment_id = $1`, [sh1.id])), 'guard: tracking events are never rewritten');
  ok(/TK_HISTORY_KEPT/.test(await err(`update tk_trips set start_on = start_on + 1 where id = $1`, [trip.id])), 'guard: a trip request is never rewritten');
  ok(/TK_HISTORY_KEPT/.test(await err(`delete from tk_project_documents where id = $1`, [dBl2.id])), 'guard: shared documents are never deleted');
  ok(/TK_HISTORY_KEPT/.test(await err(`update tk_handover_signoffs set signed_name = 'x' where project_id = $1`, [p1.id])), 'guard: the sign-off is never rewritten');
  ok(/TK_HISTORY_KEPT/.test(await err(`update tk_quote_balances set amount_cents = 1 where project_id = $1`, [p1.id])), 'guard: the balance is never rewritten');
  ok(/TK_HISTORY_KEPT/.test(await err(`update tk_shipments set carrier = 'x' where id = $1`, [sh1.id])), 'guard: a delivered shipment is never rewritten');
  const acts = (await all(`select distinct action from audit_log where action like 'turnkey.%' and created_at >= now() - interval '1 hour'`)).map((a) => a.action);
  for (const a of ['turnkey.balance_issued', 'turnkey.shipment_created', 'turnkey.shipment_event', 'turnkey.shipment_cancelled', 'turnkey.document_added', 'turnkey.document_released',
    'turnkey.document_withdrawn', 'turnkey.document_removed', 'turnkey.trip_requested', 'turnkey.trip_fee_proposed', 'turnkey.trip_fee_approved', 'turnkey.trip_fee_rejected',
    'turnkey.trip_fee_activated', 'turnkey.trip_confirmed', 'turnkey.trip_cancelled', 'turnkey.passport_added', 'turnkey.passport_deleted', 'turnkey.handover_item_added',
    'turnkey.handover_item_done', 'turnkey.handover_item_removed', 'turnkey.handover_signed', 'turnkey.project_status'])
    ok(acts.includes(a), `audit: ${a}`);
  const audPass = await one(`select count(*)::int n from audit_log where action = 'turnkey.passport_added' and details::text ilike '%yilmaz%'`);
  ok(audPass.n === 0, 'audit: the passport holder\'s name is not written to the audit log');
  await as(cust, 'aal1');
  const hist = (await all(`select kind, message from tk_client_project_events where project_id = any($1)`, [[p1.id, p2.id]]));
  const histText = hist.map((h) => h.message ?? '').join(' ').toLowerCase();
  ok(['balance', 'shipment', 'trip', 'handover'].every((k) => hist.some((h) => h.kind === k)) && !histText.includes(SUPPLIER.toLowerCase()) && !histText.includes('gymworks'),
    'client history: balance, shipment, trip and handover entries; never a factory name');
  ok(!histText.includes('forwarder rate') && !histText.includes('lily chen') && !histText.includes('booked twice'), 'client history: no staff notes, guide or staff-only reasons');
  await owner();
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
  const wipe = await one(`select position('delete from tk_client_projects' in prosrc) a, position('delete from documents where is_seed' in prosrc) b from pg_proc where oid = 'public.wipe_demo_data(text,uuid)'::regprocedure`);
  ok(wipe.a > 0 && wipe.b > 0 && wipe.a < wipe.b, 'demo wipe: demo / test Turnkey projects are deleted before their documents (no FK restrict block)');
  ok(!(await tryq(`delete from tk_client_projects where id = $1`, [p2.id])).err, 'owner clean-up: deleting a project cascades (trips, fees, passports)');

  // ── down → up (data kept as documented; the schema diff is checked by check-migration-roundtrip) ──
  await ctx.unwindLater(db);
  const docs = (await one(`select count(*)::int n from documents`)).n;
  await db.query(ctx.DOWN);
  const gone = await one(`select to_regclass('public.tk_shipments') a, to_regprocedure('public.tk_sign_handover(uuid,text,text)') b,
    (select prosrc from pg_proc where oid = 'public.tk_move_project_stage(uuid,text,text)'::regprocedure) m,
    (select prosrc from pg_proc where oid = 'public.tk_set_project_status(uuid,text,text)'::regprocedure) s,
    (select count(*)::int from pg_policies where schemaname = 'storage' and (policyname like 'turnkey documents%' or policyname like 'turnkey passports%')) sp,
    (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'tk_services' and column_name in ('included_travellers', 'extra_traveller_day_cents')) sc`);
  ok(!gone.a && !gone.b && !/BALANCE_NOT_PAID/.test(gone.m) && /PSI_REQUIRED/.test(gone.m) && !/SIGN_OFF_REQUIRED/.test(gone.s) && gone.sp === 0 && gone.sc === 0,
    'down: T6 tables, functions, storage policies and service columns removed; T5 gate and T2 status rules back');
  const l2 = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok((await one(`select count(*)::int n from documents`)).n === docs && l2.d === l2.c, 'down: issued proformas and the ledger are kept, still balanced');
  await db.query(ctx.UP);
  await ctx.reapplyLater(db);
  ok(!!(await one(`select to_regclass('public.tk_shipments') a`)).a, 'up again after down');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_t6_turnkey_shipment_handover_trips.sql'));
  if (!MIG) { console.error('✘ T6 migration file not found'); process.exit(1); }
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
    failed = await runT6Checks(db, {
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
  console.log(failed ? `\nturnkey-t6: ${failed} check(s) failed` : '\nturnkey-t6: all passed');
  process.exitCode = failed ? 1 : 0;
}
