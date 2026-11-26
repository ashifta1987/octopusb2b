// Turnkey T5 DB checks — migration *_t5_turnkey_qc_inspections. STAGING ONLY, one rolled-back transaction, acting as
// customers / staff through JWT claims (what PostgREST does).
//  1. Structure: RLS, no write grants, definer functions with search_path=public, internal helpers not callable,
//     customer-readable columns don't look internal (customer-columns INTERNAL_NAME), private bucket + storage policies,
//     inspector permission (qc_coordinator → turnkey_qc:edit).
//  2. Fee gate per inspection: 2x rule (admin who is not the proposer), schedule refused until the fee is FULLY paid,
//     a factory audit may use the paid Production and QC phase fee once.
//  3. Inspector-only: photos (path, storage, idempotent client ids) and submit (whole numbers, every checklist line,
//     idempotent submission id); other staff and customers refused.
//  4. Client sees published reports only (result, summary, AQL numbers, answers, visible photos), never the factory,
//     remarks, signature or override; another company sees nothing.
//  5. Phase completion: no PSI / unpublished / failed PSI blocks Shipment; override by an admin who is not the
//     inspector (two-person); a passed re-inspection opens it.
//  6. Audit on every change; client history never names the factory; ledger balanced; down → up.
// Set-up note: the project is put into Production and QC directly (rolled back) — the earlier gates are covered by the
// T3 / T4 tests.
// Run: node supabase/tests/turnkey-t5.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_t5_turnkey_qc_inspections.sql'));
if (!MIG) { console.error('✘ T5 migration file not found'); process.exit(1); }
const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');

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
const err = async (q, p) => (await tryq(q, p)).err ?? '';
const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;
const PLAN = 'A 150 m² gym in Izmir, opening next spring.';
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const FACTORY = `Ningbo Steelfit T5 ${stamp}`;

try {
  await db.query('begin');
  let refN = 0;
  const mkUser = async (tag, role = null) => {
    const email = `tk5-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id, email_confirmed_at) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now()) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `TK5 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkOrg = async (name, uid) => {
    const id = (await one(`insert into organizations(name, country) values ($1, 'TR') returning id`, [name])).id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [id, uid]);
    return id;
  };
  const admin1 = await mkUser('admin1', 'admin');
  const admin2 = await mkUser('admin2', 'admin');
  const agent = await mkUser('agent', 'sourcing_agent');
  const agent2 = await mkUser('agent2', 'sourcing_agent');
  const qc = await mkUser('qc', 'qc_coordinator');
  const support = await mkUser('support', 'support');
  const cust = await mkUser('cust');
  const custB = await mkUser('custb');
  const orgA = await mkOrg('TK5 Client A', cust);
  await mkOrg('TK5 Client B', custB);
  for (const u of [agent, agent2]) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('TK'), 'staff')`, [u]);
  await as(cust, 'aal1');
  const p1 = (await one(`select tk_submit_enquiry($1, null, 'TK5 gym', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  const p2 = (await one(`select tk_submit_enquiry($1, null, 'TK5 laundry', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  await owner();
  await db.query(`update tk_client_projects set stage = 'production_qc' where id = $1`, [p1.id]);   // set-up only (rolled back)
  await db.query(`update tk_client_project_stages set started_at = now() where project_id = $1 and stage = 'production_qc'`, [p1.id]);

  const pay = async (doc, cents) => { await owner(); return (await one(`select pay_service_proforma($1, $2, 'bank_transfer', $3, null) r`, [doc, cents, `TK5-${stamp}-${++refN}`])).r; };
  const putObj = async (name, mime = 'image/jpeg', size = 50000) => {
    await owner();
    await db.query(`insert into storage.objects (bucket_id, name, metadata) select 'turnkey-inspections', $1, $2::jsonb where not exists (select 1 from storage.objects where bucket_id = 'turnkey-inspections' and name = $1)`, [name, JSON.stringify({ mimetype: mime, size })]);
  };
  const uuid = async () => (await one(`select gen_random_uuid() u`)).u;
  const idsOf = {};
  const loadIds = async (iid) => { await owner(); idsOf[iid] = (await all(`select id from tk_inspection_items where inspection_id = $1 order by position`, [iid])).map((r) => r.id); };
  const answers = (iid, vals) => idsOf[iid].map((id, n) => ({ item_id: id, answer: vals[n] ?? 'pass' }));
  const rep = (ans, extra = {}) => JSON.stringify({ lot_size: 500, sample_size: 50, critical_defects: 1, major_defects: 3, minor_defects: 7, result: 'fail', remarks: 'Two motors overheated.', signed_name: 'TK5 Admin One', answers: ans, ...extra });

  // ── 1. structure ──
  await db.query(UP); // re-runnable
  const T = ['tk_inspections', 'tk_inspection_fees', 'tk_inspection_items', 'tk_inspection_reports', 'tk_inspection_photos'];
  ok((await all(`select relname from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace and relrowsecurity`, [T])).length === T.length, `T5: RLS on all ${T.length} new tables (up is re-runnable)`);
  const writes = await all(`select t from unnest($1::text[]) t where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
    or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('anon', 'public.' || t, 'SELECT')`, [T]);
  ok(writes.length === 0, `T5: no write grants, nothing for anon (${writes.map((w) => w.t).join(',') || 'none'})`);
  const fns = await all(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'EXECUTE') anon
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tk\\\\_%' and p.proname <> 'tk_import_catalogue'`);
  ok(fns.every((f) => f.prosecdef && /search_path=public/.test(f.cfg) && !f.anon), `T5: all ${fns.length} tk_ functions are security definer, search_path=public, not for anon`);
  const internal = await all(`select x, has_function_privilege('authenticated', x, 'EXECUTE') e from unnest(array['public.tk_is_inspector(uuid)', 'public.tk_inspection_paid(uuid)',
    'public.tk_json_int(jsonb,text)', 'public.tk_inspection_label(text,integer)', 'public.tk_supersede_inspection_fee(uuid)', 'public.tk_inspection_fee_activated(uuid,uuid)',
    'public.tk_names_supplier(uuid,text)', 'public.tk_t5_history_guard()']) x`);
  ok(internal.every((r) => !r.e), 'T5: internal helpers not callable by users');
  const ccols = await all(`select table_name t, column_name c from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated' and privilege_type = 'SELECT'`, [T]);
  const badCols = ccols.filter((r) => INTERNAL_NAME.test(r.c) || /factory_name|factory_address|inspector|brief|remark|signed|submitted_by|uploaded_by|proposed|approved|reason|override|published_by|client_visible/.test(r.c));
  ok(badCols.length === 0, `T5: customer-readable columns are customer-safe (${ccols.length}${badCols.length ? '; BAD ' + badCols.map((b) => `${b.t}.${b.c}`).join(',') : ''})`);
  const bucket = await one(`select public, file_size_limit::bigint l from storage.buckets where id = 'turnkey-inspections'`);
  ok(bucket && bucket.public === false && Number(bucket.l) === 10485760, 'T5: private bucket turnkey-inspections (10 MB)');
  const spol = (await all(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'turnkey inspections%' order by 1`)).map((r) => r.policyname).join('|');
  ok(spol === 'turnkey inspections inspector upload|turnkey inspections read|turnkey inspections remove unregistered', `T5: storage policies (${spol})`);
  ok((await all(`select 1 from role_permissions where role_code = 'qc_coordinator' and area = 'turnkey_qc' and action = 'edit'`)).length === 1, 'T5: qc_coordinator gets turnkey_qc:edit (inspector)');

  // ── 2. create, fees, gate before any PSI ──
  await as(agent);
  ok(/PSI_REQUIRED/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: no pre-shipment inspection → Shipment refused');
  const items = JSON.stringify(['Carton marks and labels', 'Function test: belt and motor', 'Surface finish and welds']);
  await as(cust, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb)`, [p1.id, FACTORY, items])), 'create: customer refused');
  await as(agent, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb)`, [p1.id, FACTORY, items])), 'create: staff without 2FA refused');
  await as(qc);
  ok(/FORBIDDEN/.test(await err(`select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb)`, [p1.id, FACTORY, items])), 'create: an inspector is not a Turnkey editor');
  await as(agent);
  ok(/NOT_IN_PRODUCTION_QC/.test(await err(`select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb)`, [p2.id, FACTORY, items])), 'create: only in Production and QC');
  ok(/INVALID_KIND/.test(await err(`select tk_create_inspection($1, 'loading_check', $2, null, null, $3::jsonb)`, [p1.id, FACTORY, items])), 'create: only the two kinds the design names');
  ok(/SUPPLIER_NAME_SHOWN/.test(await err(`select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb)`, [p1.id, FACTORY, JSON.stringify([`Check the ${FACTORY} logo`])])), 'create: a checklist line naming the factory is refused');
  const psi1 = (await one(`select tk_create_inspection($1, 'pre_shipment', $2, 'No. 8 Industrial Rd, Ningbo', 'AQL II, 2.5 / 4.0', $3::jsonb) r`, [p1.id, FACTORY, items])).r;
  await loadIds(psi1.id);
  await as(agent);
  ok(psi1.round === 1 && /INSPECTION_OPEN/.test(await err(`select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb)`, [p1.id, FACTORY, items])), 'create: round 1; one open inspection per kind');

  const pf = (await one(`select tk_propose_fee($1, 'production_qc', 'factory_audit', 25000, null) r`, [p1.id])).r;
  await pay(pf.document_id, 25000);
  await as(agent);
  const fa1 = (await one(`select tk_create_inspection($1, 'factory_audit', $2, null, null, '["Licences", "Production capacity"]'::jsonb, true) r`, [p1.id, FACTORY])).r;
  ok(fa1.covered_by_phase_fee === true && /COVERED_BY_PHASE_FEE/.test(await err(`select tk_propose_inspection_fee($1, 25000, null)`, [fa1.id])), 'factory audit: covered by the paid Production and QC fee, no second fee');

  ok(/FEE_NOT_SET/.test(await err(`select tk_schedule_inspection($1, $2, current_date + 3)`, [psi1.id, qc])), 'fee gate: schedule refused before the fee is set');
  const big = (await one(`select tk_propose_inspection_fee($1, 50000, 'two lines') r`, [psi1.id])).r;
  ok(big.status === 'pending_approval', 'fee: above 2x the starting fee (US$ 249) waits for an admin');
  await as(admin1);
  const own = await err(`select tk_decide_inspection_fee($1, 'approve', null)`, [big.id]);
  ok(!own, 'fee: an admin who did not propose it approves');
  const mine = (await one(`select tk_propose_inspection_fee($1, 60000, null) r`, [psi1.id])).r;
  ok(/TWO_PERSON_REQUIRED/.test(await err(`select tk_decide_inspection_fee($1, 'approve', null)`, [mine.id])), 'fee: the proposer cannot approve (two-person)');
  await as(agent);
  await db.query(`select tk_withdraw_inspection_fee($1)`, [mine.id]);
  const fee = (await one(`select tk_propose_inspection_fee($1, 24900, null) r`, [psi1.id])).r;
  ok(fee.status === 'active', 'fee: within 2x → active at once (replaces the unpaid approved version, whose proforma is voided)');
  ok(/FEE_NOT_PAID/.test(await err(`select tk_schedule_inspection($1, $2, current_date + 3)`, [psi1.id, qc])), 'fee gate: schedule refused until paid');
  await pay(fee.document_id, 10000);
  await as(agent);
  ok(/FEE_NOT_PAID/.test(await err(`select tk_schedule_inspection($1, $2, current_date + 3)`, [psi1.id, qc])), 'fee gate: part payment is not enough');
  await pay(fee.document_id, 14900);
  await as(agent);
  ok(/NOT_AN_INSPECTOR/.test(await err(`select tk_schedule_inspection($1, $2, current_date + 3)`, [psi1.id, support])), 'schedule: only an inspector (turnkey_qc:edit) or an admin');
  await db.query(`select tk_schedule_inspection($1, $2, current_date + 3)`, [psi1.id, admin1]);
  await db.query(`select tk_schedule_inspection($1, $2, current_date + 1)`, [fa1.id, qc]);
  ok(true, 'fee gate: paid → scheduled');

  // ── 3. inspector only ──
  const ph1 = await uuid(); const ph2 = await uuid();
  const path1 = `${p1.id}/${psi1.id}/${ph1}.jpg`; const path2 = `${p1.id}/${psi1.id}/${ph2}.png`;
  for (const [u, l] of [[agent, 'Turnkey editor'], [cust, 'customer'], [qc, 'another inspector']]) {
    await as(u, u === cust ? 'aal1' : 'aal2');
    ok((await one(`select tk_inspection_can_upload($1, $2) r`, [p1.id, psi1.id])).r === false, `storage: ${l} cannot upload into the inspection folder`);
  }
  await as(admin1);
  ok((await one(`select tk_inspection_can_upload($1, $2) r`, [p1.id, psi1.id])).r === true, 'storage: the assigned inspector may upload');
  await putObj(path1); await putObj(path2, 'image/png');
  await as(agent);
  ok(/NOT_FOUND/.test(await err(`select tk_add_inspection_photo($1, $2, $3, null)`, [ph1, psi1.id, path1])), 'photo: only the assigned inspector registers');
  await as(admin1);
  const r1 = (await one(`select tk_add_inspection_photo($1, $2, $3, $4) r`, [ph1, psi1.id, path1, idsOf[psi1.id][0]])).r;
  const r1b = (await one(`select tk_add_inspection_photo($1, $2, $3, $4) r`, [ph1, psi1.id, path1, idsOf[psi1.id][0]])).r;
  ok(!r1.duplicate && r1b.duplicate, 'photo: same client id twice = one photo (offline-ready)');
  await db.query(`select tk_add_inspection_photo($1, $2, $3, null)`, [ph2, psi1.id, path2]);
  await as(cust, 'aal1');
  ok((await all(`select name from storage.objects where bucket_id = 'turnkey-inspections' and name like $1`, [`${p1.id}/%`])).length === 0, 'storage: customer cannot read unpublished photos');
  const sub1 = await uuid();
  await as(qc);
  ok(/FORBIDDEN/.test(await err(`select tk_submit_inspection($1, $2, $3::jsonb)`, [psi1.id, sub1, rep(answers(psi1.id, []))])), 'submit: only the assigned inspector');
  await as(admin1);
  ok(/CHECKLIST_INCOMPLETE/.test(await err(`select tk_submit_inspection($1, $2, $3::jsonb)`, [psi1.id, sub1, rep(answers(psi1.id, []).slice(0, 2))])), 'submit: every line needs Pass / Fail / N/A');
  ok(/INVALID_LOT_SIZE/.test(await err(`select tk_submit_inspection($1, $2, $3::jsonb)`, [psi1.id, sub1, rep(answers(psi1.id, []), { lot_size: 2.5 })])), 'submit: whole numbers only');
  ok(/INVALID_SAMPLE_SIZE/.test(await err(`select tk_submit_inspection($1, $2, $3::jsonb)`, [psi1.id, sub1, rep(answers(psi1.id, []), { sample_size: 501 })])), 'submit: sample ≤ lot');
  ok(/REMARKS_REQUIRED/.test(await err(`select tk_submit_inspection($1, $2, $3::jsonb)`, [psi1.id, sub1, rep(answers(psi1.id, []), { remarks: '' })])), 'submit: a failure needs remarks');
  const s1 = (await one(`select tk_submit_inspection($1, $2, $3::jsonb) r`, [psi1.id, sub1, rep(answers(psi1.id, ['pass', 'fail', 'na']))])).r;
  const s1b = (await one(`select tk_submit_inspection($1, $2, $3::jsonb) r`, [psi1.id, sub1, rep(answers(psi1.id, ['pass', 'fail', 'na']))])).r;
  ok(!s1.duplicate && s1b.duplicate, 'submit: idempotent by submission id');
  ok(/ALREADY_SUBMITTED/.test(await err(`select tk_submit_inspection($1, gen_random_uuid(), $2::jsonb)`, [psi1.id, rep(answers(psi1.id, []))])), 'submit: a second, different submission is refused');

  // ── 4. publish; client sees published only, never the factory ──
  await as(cust, 'aal1');
  ok((await all(`select 1 from tk_inspection_reports where project_id = $1`, [p1.id])).length === 0 && (await all(`select 1 from tk_inspection_items where inspection_id = $1`, [psi1.id])).length === 0,
    'customer: no report or checklist before publication');
  await as(admin1);
  ok(/REVIEW_BY_ANOTHER/.test(await err(`select tk_publish_inspection($1, 'x', '{}')`, [psi1.id])), 'publish: never by the inspector');
  await as(agent);
  ok(/SUPPLIER_NAME_SHOWN/.test(await err(`select tk_publish_inspection($1, $2, '{}')`, [psi1.id, `Goods at ${FACTORY} failed.`])), 'publish: a summary naming the factory is refused');
  await db.query(`select tk_publish_inspection($1, 'The lot failed: 1 critical and 3 major defects. A re-inspection is needed.', $2::uuid[])`, [psi1.id, `{${ph2}}`]);
  await as(cust, 'aal1');
  const crep = await all(`select result, critical_defects, client_summary from tk_inspection_reports where inspection_id = $1`, [psi1.id]);
  ok(crep.length === 1 && crep[0].result === 'fail' && crep[0].critical_defects === 1, 'customer: sees the published report');
  ok(/permission denied/.test(await err(`select remarks from tk_inspection_reports`)) && /permission denied/.test(await err(`select signed_name from tk_inspection_reports`))
    && /permission denied/.test(await err(`select factory_name from tk_inspections`)) && /permission denied/.test(await err(`select override_reason from tk_inspections`)), 'customer: remarks, signature, factory and override refused');
  const cph = await all(`select id from tk_inspection_photos where inspection_id = $1`, [psi1.id]);
  ok(cph.length === 1 && cph[0].id === ph1, 'customer: only the photo staff left visible');
  const cobj = await all(`select name from storage.objects where bucket_id = 'turnkey-inspections' and name like $1`, [`${p1.id}/%`]);
  ok(cobj.length === 1 && cobj[0].name === path1, 'storage: customer reads only the visible published photo (signed URL)');
  const seen = JSON.stringify([await all(`select inspection_id, lot_size, sample_size, critical_defects, major_defects, minor_defects, result, client_summary, published_at from tk_inspection_reports`),
    await all(`select id, kind, round, status, scheduled_on, phase_fee_id, published_at from tk_inspections`), await all(`select label, answer from tk_inspection_items`),
    await all(`select message from tk_client_project_events where project_id = $1`, [p1.id])]).toLowerCase();
  ok(!seen.includes(FACTORY.toLowerCase()) && !seen.includes('steelfit') && !seen.includes('ningbo'), 'customer: the factory never appears in anything the client can read');
  await as(custB, 'aal1');
  ok((await all(`select 1 from tk_inspections where project_id = $1`, [p1.id])).length === 0 && (await all(`select 1 from tk_inspection_reports where project_id = $1`, [p1.id])).length === 0, 'other customer: nothing');

  // ── 5. failed PSI blocks Shipment; override two-person; re-inspection ──
  await as(agent);
  ok(/PSI_FAILED/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: failed PSI → Shipment refused');
  ok(/FORBIDDEN/.test(await err(`select tk_override_psi($1, 'ok')`, [psi1.id])), 'override: only admins');
  await as(admin1);
  ok(/TWO_PERSON_REQUIRED/.test(await err(`select tk_override_psi($1, 'client accepts')`, [psi1.id])), 'override: not by the inspector (two-person)');
  await as(admin2);
  ok(/REASON_REQUIRED/.test(await err(`select tk_override_psi($1, ' ')`, [psi1.id])), 'override: reason required');
  await db.query(`select tk_override_psi($1, 'Client accepted the minor issues in writing.')`, [psi1.id]);
  await as(agent);
  ok(!(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: admin override → Shipment allowed');
  await db.query(`select tk_move_project_stage($1, 'production_qc', 'Second inspection requested.')`, [p1.id]);
  const psi2 = (await one(`select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb) r`, [p1.id, FACTORY, items])).r;
  await loadIds(psi2.id);
  await as(agent);
  ok(psi2.round === 2 && /PSI_NOT_PUBLISHED/.test(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: the newest PSI decides (round 2 not published)');
  const f2 = (await one(`select tk_propose_inspection_fee($1, 24900, null) r`, [psi2.id])).r;
  await pay(f2.document_id, 24900);
  await as(agent);
  await db.query(`select tk_schedule_inspection($1, $2, current_date)`, [psi2.id, qc]);
  await as(qc);
  ok((await one(`select tk_start_inspection($1) r`, [psi2.id])).r.status === 'in_progress', 'inspector: start');
  await db.query(`select tk_submit_inspection($1, gen_random_uuid(), $2::jsonb)`, [psi2.id, rep(answers(psi2.id, ['pass', 'pass', 'na']), { result: 'pass', remarks: null, critical_defects: 0, major_defects: 0, minor_defects: 2, signed_name: 'TK5 QC' })]);
  await as(agent);
  await db.query(`select tk_publish_inspection($1, 'Passed: no critical or major defects.', '{}')`, [psi2.id]);
  ok(!(await err(`select tk_move_project_stage($1, 'shipment', null)`, [p1.id])), 'gate: re-inspection passed and published → Shipment (phase complete)');

  // ── 6. audit, history, ledger, guards ──
  await owner();
  ok(/TK_HISTORY_KEPT/.test(await err(`update tk_inspections set factory_name = 'x' where id = $1`, [psi1.id])), 'guard: a published inspection cannot be rewritten');
  ok(/TK_HISTORY_KEPT/.test(await err(`delete from tk_inspection_fees where id = $1`, [f2.id])), 'guard: fees are never deleted');
  const acts = (await all(`select distinct action from audit_log where action like 'turnkey.%' and created_at >= now() - interval '1 hour'`)).map((a) => a.action);
  for (const a of ['turnkey.inspection_created', 'turnkey.inspection_fee_proposed', 'turnkey.inspection_fee_approved', 'turnkey.inspection_fee_activated', 'turnkey.inspection_fee_withdrawn',
    'turnkey.inspection_scheduled', 'turnkey.inspection_started', 'turnkey.inspection_photo_added', 'turnkey.inspection_submitted', 'turnkey.inspection_published', 'turnkey.psi_override'])
    ok(acts.includes(a), `audit: ${a}`);
  const ev = await one(`select string_agg(message, ' ') m, count(*) filter (where kind = 'inspection')::int n from tk_client_project_events where project_id = $1`, [p1.id]);
  ok(ev.n >= 6 && !ev.m.toLowerCase().includes('steelfit'), `client history: ${ev.n} quality-control entries, never the factory`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
  ok(!(await tryq(`delete from tk_client_projects where id = $1`, [p2.id])).err, 'owner clean-up: deleting a project cascades');

  // ── down → up (data kept as documented; the schema diff is checked by check-migration-roundtrip) ──
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, MIG);
  await unwind(db, later);
  const docs = (await one(`select count(*)::int n from documents`)).n;
  await db.query(DOWN);
  const gone = await one(`select to_regclass('public.tk_inspections') a, to_regprocedure('public.tk_submit_inspection(uuid,uuid,jsonb)') b,
    (select prosrc from pg_proc where oid = 'public.tk_move_project_stage(uuid,text,text)'::regprocedure) m,
    (select count(*)::int from pg_policies where schemaname = 'storage' and policyname like 'turnkey inspections%') sp,
    (select count(*)::int from permission_areas where code = 'turnkey_qc') pa`);
  ok(!gone.a && !gone.b && !/PSI_REQUIRED/.test(gone.m) && /DEPOSIT_NOT_PAID/.test(gone.m) && gone.sp === 0 && gone.pa === 0, 'down: T5 tables, functions, storage policies, permission removed; T4 gate back');
  const l2 = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok((await one(`select count(*)::int n from documents`)).n === docs && l2.d === l2.c, 'down: issued proformas and the ledger are kept, still balanced');
  await db.query(UP);
  await reapply(db, later);
  ok(!!(await one(`select to_regclass('public.tk_inspections') a`)).a, 'up again after down');
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nturnkey-t5: ${failed} check(s) failed` : '\nturnkey-t5: all passed');
process.exitCode = failed ? 1 : 0;
