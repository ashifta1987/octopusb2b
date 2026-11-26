// Turnkey T3 DB checks — migration 20261101000231_t3_turnkey_fees_managers. STAGING ONLY,
// one rolled-back transaction, acting as customers / staff through JWT claims (what PostgREST does).
//  1. Structure: RLS, no write grants, definer functions with search_path=public, internal helpers not callable,
//     customer-readable fee columns don't look internal (customer-columns INTERNAL_NAME), account_manager turnkey:view.
//  2. SetFee: only Turnkey editors on 2FA set fees; integer cents, never 0 / unknown; enquiry is free. The design's 2x
//     rule (D5): up to 2× the service's starting fee the fee is active at once; above 2×, or without a starting fee, it
//     waits for one admin.
//  3. Approval: never the proposer (TWO_PERSON_REQUIRED + constraint); non-admins and aal1 refused; DB constraints keep
//     the rule (no skipping approval above 2×, no approver on auto fees); history never deleted or rewritten; rejection
//     needs a reason.
//  4. Payment: activation issues a turnkey service proforma (TK division, revenue stream 'turnkey') for the client;
//     the paid-phase gate refuses until the fee is active AND fully paid (part payment is not enough); paying through
//     pay_service_proforma (Finance bank transfer) opens the gate; a new version voids the unpaid proforma.
//  5. Customers see only approved fees of their companies, never the proposer / approvers / notes.
//  6. Account managers: primary sees own projects only; cover only during the cover period; client sees the active one.
//  7. Audit on every change; ledger balanced; down → up.
// Run: node supabase/tests/turnkey-t3.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_t3_turnkey_fees_managers.sql'));
if (!MIG) { console.error('✘ T3 migration file not found'); process.exit(1); }
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

try {
  await db.query('begin');
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const mkUser = async (tag, role = null) => {
    const email = `tk3-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id, email_confirmed_at) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now()) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `TK3 ${tag}`, email]);
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
  const admin3 = await mkUser('admin3', 'admin');
  const agent = await mkUser('agent', 'sourcing_agent');
  const am = await mkUser('am', 'account_manager');
  const am2 = await mkUser('am2', 'account_manager');
  const cust = await mkUser('cust');
  const custB = await mkUser('custb');
  const orgA = await mkOrg('TK3 Client A', cust);
  const orgB = await mkOrg('TK3 Client B', custB);
  await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('TK'), 'staff')`, [agent]);
  await as(cust, 'aal1');
  const p1 = (await one(`select tk_submit_enquiry($1, null, 'TK3 gym', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  const p2 = (await one(`select tk_submit_enquiry($1, null, 'TK3 laundry', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  await owner();

  // ── 1. structure ──
  await db.query(UP); // re-runnable
  const TABLES = ['tk_project_fees', 'tk_stage_fee_rules'];
  const rls = await all(`select relname, relrowsecurity from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace`, [TABLES]);
  ok(rls.length === 2 && rls.every((r) => r.relrowsecurity), 'T3: RLS on the new tables (up is re-runnable)');
  const writes = await all(`select t from unnest($1::text[]) t where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
    or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('anon', 'public.' || t, 'SELECT')`, [TABLES]);
  ok(writes.length === 0, `T3: no write grants, nothing for anon (${writes.map((w) => w.t).join(',') || 'none'})`);
  const fns = await all(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'EXECUTE') anon
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tk\\_%' and p.proname <> 'tk_import_catalogue'`);
  ok(fns.every((f) => f.prosecdef && /search_path=public/.test(f.cfg) && !f.anon), `T3: all ${fns.length} tk_ functions are security definer, search_path=public, not for anon`);
  const internal = await all(`select x, has_function_privilege('authenticated', x, 'EXECUTE') e from unnest(array['public.tk_active_manager(uuid)', 'public.tk_void_fee_document(uuid)', 'public.tk_project_fees_guard()', 'public.tk_issue_fee_proforma(uuid,text,text,bigint)', 'public.tk_supersede_fee(uuid,text,text)', 'public.tk_fee_activated(uuid,uuid)']) x`);
  ok(internal.every((r) => !r.e), 'T3: internal helpers not callable by users');
  const cols = (await all(`select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'tk_project_fees' and grantee = 'authenticated' and privilege_type = 'SELECT'`)).map((r) => r.column_name);
  ok(cols.length === 11 && !cols.some((c) => INTERNAL_NAME.test(c) || /proposed|approved|rejected|reason/.test(c)), `T3: customer-readable fee columns are customer-safe (${cols.join(',')})`);
  ok((await one(`select count(*)::int n from role_permissions where role_code = 'account_manager' and area = 'turnkey' and action = 'view'`)).n === 1, 'T3: account_manager has turnkey:view');
  const gated = (await all(`select stage from tk_stage_fee_rules where gated order by stage`)).map((r) => r.stage).join(',');
  ok(gated === 'consultation,design,production_qc,sourcing', `T3: gated phases (${gated})`);

  // ── 2. SetFee + the 2x rule ──
  await as(cust, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_propose_fee($1, 'consultation', 'consultation', 15000, null)`, [p1.id])), 'set fee: customer refused');
  await as(agent, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_propose_fee($1, 'consultation', 'consultation', 15000, null)`, [p1.id])), 'set fee: staff without 2FA refused');
  await as(am);
  ok(/FORBIDDEN/.test(await err(`select tk_propose_fee($1, 'consultation', 'consultation', 15000, null)`, [p1.id])), 'set fee: account manager (view only) refused');
  await as(agent);
  ok(/FREE_PHASE/.test(await err(`select tk_propose_fee($1, 'enquiry', null, 15000, null)`, [p1.id])), 'set fee: the enquiry is free');
  ok(/INVALID_AMOUNT/.test(await err(`select tk_propose_fee($1, 'consultation', 'consultation', 0, null)`, [p1.id])), 'set fee: 0 refused');
  ok(/INVALID_AMOUNT/.test(await err(`select tk_propose_fee($1, 'consultation', 'consultation', null, null)`, [p1.id])), 'set fee: unknown amount refused (never 0)');
  ok(/INVALID_SERVICE/.test(await err(`select tk_propose_fee($1, 'consultation', 'nope', 15000, null)`, [p1.id])), 'set fee: unknown service refused');
  ok(/FEE_NOT_APPROVED/.test(await err(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])), 'gate: no fee → Consultation refused');
  const start = Number((await one(`select from_cents from tk_services where code = 'consultation'`)).from_cents);
  const a1 = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', $2, 'exactly 2x') r`, [p1.id, 2 * start])).r;
  ok(a1.status === 'active' && a1.needs_approval === false && !!a1.document_id, `2x rule: a fee of exactly 2× the starting fee (${2 * start} cents) is active at once, set by a Turnkey editor`);
  const dStart = Number((await one(`select from_cents from tk_services where code = 'layout_drawing'`)).from_cents);
  const d1 = (await one(`select tk_propose_fee($1, 'design', 'layout_drawing', $2, 'big layout') r`, [p1.id, 2 * dStart + 1])).r;
  ok(d1.status === 'pending_approval' && d1.needs_approval === true, '2x rule: one cent above 2× waits for an admin');
  const o1 = (await one(`select tk_propose_fee($1, 'sourcing', null, 10000, null) r`, [p1.id])).r;
  ok(o1.status === 'pending_approval', '2x rule: a fee without a starting fee (Other) waits for an admin');
  await owner();
  const af = await one(`select starting_cents::bigint s, needs_approval n, approved_by, amount_cents::bigint a from tk_project_fees where id = $1`, [a1.id]);
  ok(Number(af.s) === start && af.n === false && af.approved_by === null && Number(af.a) === 2 * start, 'fee: starting fee and rule outcome frozen on the row, no approver for auto fees, integer cents');
  const doc = await one(`select d.org_id, d.amount_cents::bigint a, d.status, d.data ->> 'service' svc, d.data ->> 'ref' ref, d.division_id = division_id_of('TK') tk,
    (select string_agg(distinct service, ',') from invoice_lines where document_id = d.id) lines,
    (select bool_and(j.division_id = division_id_of('TK')) from journals j where j.ref_type = 'document' and j.ref_id = d.id) jtk
    from documents d where d.id = $1`, [a1.document_id]);
  ok(doc.org_id === orgA && Number(doc.a) === 2 * start && doc.status === 'awaiting_payment' && doc.svc === 'turnkey' && doc.lines === 'turnkey' && doc.ref === p1.code && doc.tk && doc.jtk,
    'proforma: client company, cents, turnkey service, TK division (document and journal), awaiting payment');

  // ── 5a. customers see active fees only, never staff columns ──
  await as(cust, 'aal1');
  ok((await all(`select id from tk_project_fees where project_id = $1`, [p1.id])).map((r) => r.id).join() === a1.id, 'customer: sees the active fee only (not the waiting ones)');
  ok(/permission denied/.test(await err(`select proposed_by from tk_project_fees`)), 'customer: proposer column not readable');
  ok(/permission denied/.test(await err(`select note, reject_reason, approved_by, starting_cents, needs_approval from tk_project_fees`)), 'customer: note / reason / approver / rule not readable');
  ok(/FORBIDDEN/.test(await err(`select * from tk_list_project_fees($1)`, [p1.id])), 'customer: staff fee list refused');
  ok(/FORBIDDEN/.test(await err(`select * from tk_list_fee_approvals(10)`)), 'customer: approval queue refused');

  // ── 3. one admin, never the proposer ──
  await as(agent);
  ok(/FORBIDDEN/.test(await err(`select tk_decide_fee($1, 'approve', null)`, [d1.id])), 'approve: Turnkey editor (not admin) refused');
  await as(admin1, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_decide_fee($1, 'approve', null)`, [d1.id])), 'approve: admin without 2FA refused');
  await as(admin1);
  ok(/FEE_NOT_PENDING/.test(await err(`select tk_decide_fee($1, 'approve', null)`, [a1.id])), 'approve: an auto-active fee has nothing to approve');
  const qStart = Number((await one(`select from_cents from tk_services where code = 'factory_audit'`)).from_cents);
  const big = (await one(`select tk_propose_fee($1, 'production_qc', 'factory_audit', $2, null) r`, [p1.id, 3 * qStart])).r;
  ok(big.status === 'pending_approval' && /TWO_PERSON_REQUIRED/.test(await err(`select tk_decide_fee($1, 'approve', null)`, [big.id])), 'approve: the proposer (an admin) cannot approve own fee');
  await owner();
  ok(/tk_project_fees_two_person/.test(await err(`insert into tk_project_fees (project_id, stage, version, amount_cents, needs_approval, status, proposed_by, approved_by, approved_at, document_id, effective_from)
    values ($1, 'shipment', 1, 100, true, 'active', $2, $2, now(), $3, now())`, [p1.id, admin1, a1.document_id])), 'DB: approver ≠ proposer (constraint)');
  ok(/tk_project_fees_rule/.test(await err(`insert into tk_project_fees (project_id, stage, service_code, version, amount_cents, starting_cents, needs_approval, status, proposed_by, document_id, effective_from)
    values ($1, 'shipment', 'consultation', 1, 30000, 9900, false, 'active', $2, $3, now())`, [p1.id, agent, a1.document_id])), 'DB: a fee above 2× cannot skip approval (constraint)');
  ok(/tk_project_fees_active_ok/.test(await err(`insert into tk_project_fees (project_id, stage, version, amount_cents, needs_approval, status, proposed_by, document_id, effective_from)
    values ($1, 'shipment', 1, 100, true, 'active', $2, $3, now())`, [p1.id, agent, a1.document_id])), 'DB: an active fee above 2× needs an approver (constraint)');
  ok(/tk_project_fees_auto_no_approver/.test(await err(`insert into tk_project_fees (project_id, stage, service_code, version, amount_cents, starting_cents, needs_approval, status, proposed_by, approved_by, approved_at, document_id, effective_from)
    values ($1, 'shipment', 'consultation', 1, 9900, 9900, false, 'active', $2, $3, now(), $4, now())`, [p1.id, agent, admin1, a1.document_id])), 'DB: auto fees carry no approver (constraint)');
  ok(/FEE_HISTORY_KEPT/.test(await err(`delete from tk_project_fees where id = $1`, [a1.id])), 'DB: fees are never deleted');
  ok(/FEE_HISTORY_KEPT/.test(await err(`update tk_project_fees set amount_cents = 1 where id = $1`, [a1.id])), 'DB: an active fee cannot be rewritten');
  await as(admin2);
  const r2 = (await one(`select tk_decide_fee($1, 'approve', null) r`, [d1.id])).r;
  ok(r2.status === 'active' && !!r2.document_id, 'approve: another admin approves the fee above 2× — active, proforma issued');
  await owner();
  ok((await one(`select approved_by from tk_project_fees where id = $1`, [d1.id])).approved_by === admin2, 'approve: approver recorded');

  // rejection
  await as(admin2);
  ok(/REASON_REQUIRED/.test(await err(`select tk_decide_fee($1, 'reject', '   ')`, [o1.id])), 'reject: a reason is required');
  ok(!(await tryq(`select tk_decide_fee($1, 'reject', 'Use the sourcing service price')`, [o1.id])).err, 'reject: with a reason');
  ok(/FEE_NOT_PENDING/.test(await err(`select tk_decide_fee($1, 'approve', null)`, [o1.id])), 'reject: a rejected fee cannot be approved later');

  // ── 4. gate + payment ──
  await as(agent);
  ok(/FEE_NOT_PAID/.test(await err(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])), 'gate: active but unpaid → refused');
  await as(custB, 'aal1');
  ok((await all(`select id from tk_project_fees where project_id = $1`, [p1.id])).length === 0 && (await all(`select id from documents where id = $1`, [a1.document_id])).length === 0, 'other customer: no fee, no proforma');
  await as(cust, 'aal1');
  ok((await all(`select id from documents where id = $1`, [a1.document_id])).length === 1, 'customer: sees the proforma (own company)');
  await owner();
  ok(!(await tryq(`select pay_service_proforma($1, 5000, 'bank_transfer', $2, null)`, [a1.document_id, `TK3-PART-${stamp}`])).err, 'payment: Finance records a part payment (bank transfer)');
  await as(agent);
  ok(/FEE_NOT_PAID/.test(await err(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])), 'gate: part paid → refused');
  ok(/FEE_PAID_LOCKED/.test(await err(`select tk_propose_fee($1, 'consultation', 'consultation', 12000, null)`, [p1.id])), 'a fee with a payment cannot be changed');
  await owner();
  const pay2 = (await one(`select pay_service_proforma($1, $2, 'bank_transfer', $3, null) r`, [a1.document_id, 2 * start - 5000, `TK3-REST-${stamp}`])).r;
  ok(pay2.fully_paid === true, 'payment: the rest; proforma fully paid (tax invoice issued by the existing rule)');
  await as(agent);
  ok(!(await tryq(`select tk_move_project_stage($1, 'consultation', 'Fee paid, thank you')`, [p1.id])).err, 'gate: active + paid → moves into Consultation');
  ok(/FEE_NOT_PAID/.test(await err(`select tk_move_project_stage($1, 'design', null)`, [p1.id])), 'gate: Design approved but unpaid → refused');
  ok(!(await tryq(`select tk_move_project_stage($1, 'enquiry', 'Brief changed')`, [p1.id])).err && !(await tryq(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])).err,
    'gate: back and forward again — the paid fee still opens the phase');

  // versions: changes within 2× supersede at once (old proforma voided); a newer waiting proposal withdraws the older one
  const g1 = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', $2, null) r`, [p2.id, start])).r;
  const g2 = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', $2, 'scope grew') r`, [p2.id, start + 3000])).r;
  const g3 = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', $2, 'scope grew more') r`, [p2.id, 3 * start])).r;
  const g4 = (await one(`select tk_propose_fee($1, 'consultation', 'consultation', $2, 'final') r`, [p2.id, 3 * start + 1000])).r;
  ok(g1.status === 'active' && g2.status === 'active' && g3.status === 'pending_approval' && g4.status === 'pending_approval', 'versions: auto, auto, waiting, waiting');
  await as(admin3); const g4r = (await one(`select tk_decide_fee($1, 'approve', null) r`, [g4.id])).r;
  await owner();
  const vers = (await all(`select version, status from tk_project_fees where project_id = $1 order by version`, [p2.id])).map((v) => `${v.version}:${v.status}`).join(',');
  ok(vers === '1:superseded,2:superseded,3:withdrawn,4:active', `versions: full history kept (${vers})`);
  const st = await all(`select id, status from documents where id = any($1)`, [[g1.document_id, g2.document_id, g4r.document_id]]);
  ok(st.find((d) => d.id === g1.document_id)?.status === 'void' && st.find((d) => d.id === g2.document_id)?.status === 'void' && st.find((d) => d.id === g4r.document_id)?.status === 'awaiting_payment',
    'versions: replaced proformas voided, the current one open');
  const ar = await one(`select coalesce(sum(e.debit_cents - e.credit_cents), 0)::bigint b from ledger_entries e join journals j on j.id = e.journal_id
    where j.ref_type = 'document' and j.ref_id = any($1) and e.account_id = receivable_account($2, 'USD')`, [[a1.document_id, g1.document_id, g2.document_id, g4r.document_id], orgA]);
  ok(Number(ar.b) === 3 * start + 1000, `ledger: of these, the client owes only the open proforma (${ar.b} cents)`);
  const f1 = d1.id;

  // ── 6. account managers + cover ──
  await as(agent);
  ok(!(await tryq(`select tk_set_project_manager($1, $2)`, [p1.id, am])).err, 'manager: primary set');
  ok(/COVER_IS_MANAGER/.test(await err(`select tk_set_project_cover($1, $2, current_date, current_date + 3)`, [p1.id, am])), 'cover: must be someone else');
  ok(/INVALID_MANAGER/.test(await err(`select tk_set_project_cover($1, $2, current_date, current_date + 3)`, [p1.id, cust])), 'cover: a customer cannot cover');
  ok(/INVALID_DATES/.test(await err(`select tk_set_project_cover($1, $2, current_date + 3, current_date)`, [p1.id, am2])), 'cover: end before start refused');
  ok(/COVER_IN_PAST/.test(await err(`select tk_set_project_cover($1, $2, current_date - 10, current_date - 1)`, [p1.id, am2])), 'cover: a period in the past refused');
  ok(!(await tryq(`select tk_set_project_cover($1, $2, current_date + 2, current_date + 9)`, [p1.id, am2])).err, 'cover: future period set');
  await as(am);
  const amSees = (await all(`select id from tk_client_projects where id = any($1)`, [[p1.id, p2.id]])).map((r) => r.id);
  ok(amSees.length === 1 && amSees[0] === p1.id, 'account manager: sees own project, not the other one');
  ok((await all(`select 1 from tk_client_project_stages where project_id = $1`, [p1.id])).length === 8 && (await all(`select 1 from tk_client_project_staff where project_id = $1`, [p1.id])).length === 1,
    'account manager: phases and staff facts of own project');
  ok((await all(`select * from tk_list_project_fees($1)`, [p1.id])).length >= 2 && /FORBIDDEN/.test(await err(`select * from tk_list_project_fees($1)`, [p2.id])), 'account manager: fee history of own project only');
  ok(/FORBIDDEN/.test(await err(`select tk_move_project_stage($1, 'design', null)`, [p1.id])), 'account manager: view only');
  await as(am, 'aal1');
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 0, 'account manager without 2FA: nothing');
  await as(am2);
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 0, 'cover: nothing before the period');
  await as(cust, 'aal1');
  ok((await one(`select tk_project_manager_name($1) n`, [p1.id])).n === 'TK3 am', 'client: sees the primary before the cover period');
  await owner();
  await db.query(`update tk_client_project_staff set cover_from = current_date - 1, cover_to = current_date + 5 where project_id = $1`, [p1.id]);
  await as(am2);
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 1, 'cover: sees the project during the period');
  ok((await all(`select x from tk_my_managed_projects() x`)).some((r) => r.x === p1.id), 'My projects: the cover during the period');
  await as(cust, 'aal1');
  const ct = (await one(`select tk_project_contact($1) c`, [p1.id])).c;
  ok((await one(`select tk_project_manager_name($1) n`, [p1.id])).n === 'TK3 am2' && ct.on_cover === true && ct.usual_name === 'TK3 am', 'client: sees the cover during the period (and whom they cover)');
  await as(custB, 'aal1');
  ok((await one(`select tk_project_contact($1) c`, [p1.id])).c === null, 'other customer: no contact');
  await owner();
  await db.query(`update tk_client_project_staff set cover_from = current_date - 9, cover_to = current_date - 1 where project_id = $1`, [p1.id]);
  await as(am2);
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 0, 'cover: nothing after the period');
  await as(cust, 'aal1');
  ok((await one(`select tk_project_manager_name($1) n`, [p1.id])).n === 'TK3 am', 'client: the primary again after the period');

  // ── admin queue: only fees above 2× (or without a starting fee) ──
  await as(agent);
  ok(/FORBIDDEN/.test(await err(`select * from tk_list_fee_approvals(10)`)), 'queue: admins only');
  const auto = (await one(`select tk_propose_fee($1, 'sourcing', 'sourcing_quotes', (select from_cents from tk_services where code = 'sourcing_quotes'), null) r`, [p1.id])).r;
  await as(admin2);
  const queue = await all(`select id, status, proposed_by_name, starting_cents from tk_list_fee_approvals(200)`);
  const qi = queue.find((x) => x.id === big.id);
  ok(qi && qi.status === 'pending_approval' && qi.proposed_by_name === 'TK3 admin1' && Number(qi.starting_cents) === qStart, 'queue: waiting fee above 2× with proposer and starting fee');
  ok(auto.status === 'active' && !queue.some((x) => x.id === auto.id || x.id === a1.id) && queue.some((x) => x.id === o1.id && x.status === 'rejected'), 'queue: fees within 2× never listed; decisions listed');

  // ── 7. audit + ledger ──
  await owner();
  const audits = (await all(`select distinct action from audit_log where action like 'turnkey.fee%' or (action = 'turnkey.project_cover' and entity_id = $1)`, [String(p1.id)])).map((a) => a.action);
  for (const a of ['turnkey.fee_proposed', 'turnkey.fee_approved', 'turnkey.fee_activated', 'turnkey.fee_rejected', 'turnkey.fee_withdrawn', 'turnkey.fee_proforma_void', 'turnkey.project_cover'])
    ok(audits.includes(a), `audit: ${a}`);
  const fa = await one(`select count(*)::int n from audit_log where entity = 'tk_project_fees' and entity_id = $1`, [String(f1)]);
  ok(fa.n === 3, `audit: proposal, approval and activation of a fee above 2× (${fa.n})`);
  const fa2 = await one(`select count(*)::int n from audit_log where entity = 'tk_project_fees' and entity_id = $1`, [String(a1.id)]);
  ok(fa2.n === 2, `audit: proposal and activation of a fee within 2× (${fa2.n})`);
  const ev = await all(`select kind, message from tk_client_project_events where project_id = $1 and kind in ('fee', 'manager')`, [p1.id]);
  ok(ev.some((e) => e.kind === 'fee' && /US\$ [\d,]+\.\d{2}\. Pay it to start this phase/.test(e.message)) && ev.some((e) => e.kind === 'manager'), 'client history: fee set and cover entries');
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);

  // ── down → up (data: turnkey invoices exist, so the invoice_lines check comes back NOT VALID; schema diff is checked by check-migration-roundtrip) ──
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, MIG);
  await unwind(db, later);
  await db.query(DOWN);
  const gone = await one(`select to_regclass('public.tk_project_fees') a, to_regprocedure('public.tk_propose_fee(uuid,text,text,bigint,text)') b,
    (select count(*)::int from information_schema.columns where table_name = 'tk_client_project_staff' and column_name like 'cover%') c,
    (select count(*)::int from role_permissions where role_code = 'account_manager' and area = 'turnkey') r,
    (select prosrc from pg_proc where oid = 'public.tk_move_project_stage(uuid,text,text)'::regprocedure) m`);
  ok(!gone.a && !gone.b && gone.c === 0 && gone.r === 0 && !/FEE_NOT_PAID/.test(gone.m), 'down: fee tables, cover columns, permission and the gate removed; T2 function back');
  const docsKept = await one(`select count(*)::int n from documents where id = any($1)`, [[a1.document_id, r2.document_id, g1.document_id, g4r.document_id]]);
  const l2 = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(docsKept.n === 4 && l2.d === l2.c, 'down: issued proformas and the ledger are kept, still balanced');
  await db.query(UP);
  await reapply(db, later);
  ok(!!(await one(`select to_regclass('public.tk_project_fees') a`)).a, 'up again after down');
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nturnkey-t3: ${failed} check(s) failed` : '\nturnkey-t3: all passed');
process.exitCode = failed ? 1 : 0;
