// Turnkey T2 DB checks — migration 20261101000227_t2_turnkey_projects_journey. STAGING ONLY,
// one rolled-back transaction, acting as customers / staff through JWT claims (what PostgREST does).
//  1. Phases (8, only the enquiry free) · tables have RLS and no write grants · functions set search_path.
//  2. D3: every frozen turnkey_leads row is a project at "Enquiry"; running the migration again adds nothing; a guest
//     lead joins the company of the account with the same verified email (tk_link_legacy_projects).
//  3. Client enquiry: signed-in customer, own company only; validation; 5 a day per person; staff and anon refused.
//  4. Customers see only their companies' projects, phases and history; staff facts are never readable by customers.
//  5. Staff: Turnkey viewers in the TK division see projects; only editors on 2FA move them one phase at a time
//     (back needs a reason), hold / cancel / complete rules, target dates, account manager; everything audited.
//  6. Down → up: the schema goes and comes back, leads are untouched and moved in again.
// Migrations applied after T2 (T3 adds payment gates on phase moves and more tk_ functions; W2a …) are unwound first,
// inside the rolled-back transaction, so these checks test T2 itself; they are re-applied at the end.
// Run: node supabase/tests/turnkey-t2.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_t2_turnkey_projects_journey.sql'));
if (!MIG) { console.error('✘ T2 migration file not found'); process.exit(1); }
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
const enquiry = (org, cat, title, plan, extra = {}) => tryq(
  `select tk_submit_enquiry($1, $2, $3, $4, $5, $6, $7, $8, $9) r`,
  [org, cat, title, extra.country ?? 'TR', extra.city ?? null, extra.open ?? null, extra.area ?? null, extra.budget ?? null, plan]);
const PLAN = 'A 150 m² gym in Izmir, opening next spring.';

try {
  await db.query('begin');
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const mkUser = async (tag, role = null, confirmed = true) => {
    const email = `tk2-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id, email_confirmed_at) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', ${confirmed ? 'now()' : 'null'}) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `TK2 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return { id, email };
  };
  const mkOrg = async (name, uid) => {
    const id = (await one(`insert into organizations(name, country) values ($1, 'TR') returning id`, [name])).id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [id, uid]);
    return id;
  };
  const admin = (await mkUser('admin', 'admin')).id;
  const support = (await mkUser('support', 'support')).id;
  const finance = (await mkUser('finance', 'finance')).id;
  const agent = (await mkUser('agent', 'sourcing_agent')).id;
  const am = (await mkUser('am', 'account_manager')).id;
  const cust = (await mkUser('cust')).id;
  const custB = (await mkUser('custb')).id;
  const orgA = await mkOrg('TK2 Client A', cust);
  const orgB = await mkOrg('TK2 Client B', custB);
  const cat = (await one(`select project_id from turnkey_projects where status <> 'archived' order by sort_rank limit 1`)).project_id;
  const archived = await one(`select project_id from turnkey_projects where status = 'archived' limit 1`);
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, MIG);
  await unwind(db, later);

  // ── 1. structure ──
  const phases = await all(`select code, seq, paid from tk_stages order by seq`);
  ok(phases.length === 8 && phases[0].code === 'enquiry' && !phases[0].paid && phases.filter((p) => p.paid).length === 7 && phases[7].code === 'handover',
    'T2: 8 phases from the design; only the enquiry is free');
  const TABLES = ['tk_stages', 'tk_client_projects', 'tk_client_project_stages', 'tk_client_project_events', 'tk_client_project_staff'];
  const rls = await all(`select relname, relrowsecurity from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace`, [TABLES]);
  ok(rls.length === 5 && rls.every((r) => r.relrowsecurity), 'T2: RLS on every new table');
  const writes = await all(`select t from unnest($1::text[]) t where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
    or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('anon', 'public.' || t, 'INSERT')`, [TABLES]);
  ok(writes.length === 0, `T2: no direct write grants (${writes.map((w) => w.t).join(',') || 'none'})`);
  const fns = await all(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'EXECUTE') anon
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tk\\_%' and p.proname <> 'tk_import_catalogue'`);
  ok(fns.length === 10 && fns.every((f) => f.prosecdef && /search_path=public/.test(f.cfg) && !f.anon), `T2: ${fns.length} functions, security definer, search_path=public, not for anon`);
  ok(!(await one(`select has_function_privilege('authenticated', 'public.tk_init_stages(uuid, timestamptz)', 'EXECUTE') x`)).x, 'T2: internal helper not callable by users');

  // ── 2. D3 leads ──
  const unmoved = Number((await one(`select count(*) n from turnkey_leads l where not exists (select 1 from tk_client_project_staff s where s.legacy_lead_id = l.lead_id)`)).n);
  const leads = Number((await one(`select count(*) n from turnkey_leads`)).n);
  const legacyAtEnquiry = await one(`select count(*) n, count(*) filter (where p.stage = 'enquiry') e from tk_client_projects p join tk_client_project_staff s on s.project_id = p.id where s.legacy_lead_id is not null`);
  ok(unmoved === 0 && Number(legacyAtEnquiry.n) === leads && legacyAtEnquiry.n === legacyAtEnquiry.e, `D3: all ${leads} old leads are projects at Enquiry`);
  const before = Number((await one(`select count(*) n from tk_client_projects`)).n);
  await db.query(UP);
  const afterRerun = Number((await one(`select count(*) n from tk_client_projects`)).n);
  ok(before === afterRerun, `D3: running the migration again moves nothing twice (${before} = ${afterRerun})`);

  // ── 3. enquiry ──
  await as(null, 'aal1', 'anon');
  ok(/permission denied/.test((await enquiry(orgA, cat, null, PLAN)).err ?? ''), 'enquiry: the public key cannot send one');
  await as(cust, 'aal1');
  ok(/PLAN_REQUIRED/.test((await enquiry(orgA, cat, null, 'too short')).err ?? ''), 'enquiry: the plan needs 20+ characters');
  ok(/TITLE_REQUIRED/.test((await enquiry(orgA, null, null, PLAN)).err ?? ''), 'enquiry: a new project needs a name');
  ok(/INVALID_DATE/.test((await enquiry(orgA, cat, null, PLAN, { open: '2020-01-01' })).err ?? ''), 'enquiry: opening date must be in the future');
  if (archived) ok(/UNKNOWN_PROJECT/.test((await enquiry(orgA, archived.project_id, null, PLAN)).err ?? ''), 'enquiry: archived catalogue projects are refused');
  ok(/FORBIDDEN/.test((await enquiry(orgB, cat, null, PLAN)).err ?? ''), 'enquiry: not for another company');
  const e1 = await enquiry(orgA, cat, null, PLAN, { country: 'tr', city: 'Izmir', open: '2031-03-01', area: 150, budget: 3500000 });
  const p1 = e1.rows[0]?.r;
  ok(!e1.err && /^TKP-\d{5,}$/.test(p1?.code ?? ''), `enquiry: created ${p1?.code ?? e1.err}`);
  await owner();
  const row = await one(`select p.stage, p.status, p.country, p.budget_cents::bigint b, p.org_id, s.created_by from tk_client_projects p join tk_client_project_staff s on s.project_id = p.id where p.id = $1`, [p1.id]);
  const stg = await all(`select stage, started_at from tk_client_project_stages where project_id = $1`, [p1.id]);
  ok(row.stage === 'enquiry' && row.status === 'open' && row.country === 'TR' && Number(row.b) === 3500000 && row.org_id === orgA && row.created_by === cust,
    'enquiry: at Enquiry, open, money in integer cents, company and sender recorded');
  ok(stg.length === 8 && stg.filter((s) => s.started_at).length === 1 && stg.find((s) => s.started_at)?.stage === 'enquiry', 'enquiry: 8 phase rows, only Enquiry started');
  await as(cust, 'aal1');
  for (let i = 0; i < 4; i++) await enquiry(orgA, null, `TK2 custom ${i}`, PLAN);
  ok(/TOO_MANY_ENQUIRIES/.test((await enquiry(orgA, null, 'TK2 custom 6', PLAN)).err ?? ''), 'enquiry: at most 5 a day per person');
  await as(admin);
  ok(/STAFF_NOT_CUSTOMER/.test((await enquiry(orgA, cat, null, PLAN)).err ?? ''), 'enquiry: staff accounts cannot send one');

  // ── 4. customer reads ──
  await as(custB, 'aal1');
  const bSees = await all(`select id from tk_client_projects where id = $1`, [p1.id]);
  const bStages = await all(`select 1 from tk_client_project_stages where project_id = $1`, [p1.id]);
  const bName = await one(`select tk_project_manager_name($1) n`, [p1.id]);
  ok(bSees.length === 0 && bStages.length === 0 && bName.n === null, 'customer B: sees nothing of company A\'s project');
  await as(cust, 'aal1');
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 1, 'customer A: sees own project');
  ok((await all(`select * from tk_client_project_staff`)).length === 0, 'customer: no staff rows (account manager, creator, old lead)');
  ok(!!(await tryq(`update tk_client_projects set stage = 'handover' where id = $1`, [p1.id])).err, 'customer: cannot change a project directly');
  ok(!!(await tryq(`insert into tk_client_project_events (project_id, kind) values ($1, 'created')`, [p1.id])).err, 'customer: cannot write history');
  ok(/FORBIDDEN/.test((await tryq(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])).err ?? ''), 'customer: cannot move phases');

  // ── 5. staff ──
  await as(support);
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 0, 'support (no Turnkey permission): no projects');
  await as(agent);
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 0, 'sourcing agent outside the TK division: no projects');
  ok(/FORBIDDEN/.test((await tryq(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])).err ?? ''), 'sourcing agent outside TK: cannot move');
  await owner();
  await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('TK'), 'staff')`, [agent]);
  await as(agent, 'aal1');
  ok(/FORBIDDEN/.test((await tryq(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])).err ?? ''), 'staff without 2FA (aal1): refused');
  await as(agent);
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 1 && (await all(`select 1 from tk_client_project_staff where project_id = $1`, [p1.id])).length === 1,
    'Turnkey editor in TK: sees the project and its staff facts');
  ok(/STAGE_SKIP/.test((await tryq(`select tk_move_project_stage($1, 'design', null)`, [p1.id])).err ?? ''), 'staff: one phase at a time');
  ok(!(await tryq(`select tk_move_project_stage($1, 'consultation', 'Consultation fee agreed')`, [p1.id])).err, 'staff: Enquiry → Consultation');
  ok(!(await tryq(`select tk_move_project_stage($1, 'design', null)`, [p1.id])).err, 'staff: Consultation → Design');
  ok(/REASON_REQUIRED/.test((await tryq(`select tk_move_project_stage($1, 'consultation', null)`, [p1.id])).err ?? ''), 'staff: moving back needs a reason');
  ok(!(await tryq(`select tk_move_project_stage($1, 'consultation', 'Client wants to change the brief')`, [p1.id])).err, 'staff: back to Consultation with a reason');
  await owner();
  const dates = Object.fromEntries((await all(`select stage, started_at is not null s, completed_at is not null c from tk_client_project_stages where project_id = $1`, [p1.id])).map((r) => [r.stage, r]));
  ok(dates.enquiry.c && dates.consultation.s && !dates.consultation.c && !dates.design.s, 'phase dates follow the moves');
  await as(agent);
  ok(/NOT_AT_HANDOVER/.test((await tryq(`select tk_set_project_status($1, 'completed', null)`, [p1.id])).err ?? ''), 'staff: complete only at Handover');
  ok(/REASON_REQUIRED/.test((await tryq(`select tk_set_project_status($1, 'cancelled', null)`, [p1.id])).err ?? ''), 'staff: cancelling needs a reason');
  ok(!(await tryq(`select tk_set_project_status($1, 'on_hold', 'Waiting for your floor plan')`, [p1.id])).err, 'staff: on hold with a reason');
  ok(/PROJECT_NOT_OPEN/.test((await tryq(`select tk_move_project_stage($1, 'design', null)`, [p1.id])).err ?? ''), 'staff: no moves while on hold');
  ok(!(await tryq(`select tk_set_project_status($1, 'open', null)`, [p1.id])).err, 'staff: reopen');
  ok(!(await tryq(`select tk_set_stage_due($1, 'design', '2031-01-15')`, [p1.id])).err, 'staff: target date per phase');
  ok(/INVALID_MANAGER/.test((await tryq(`select tk_set_project_manager($1, $2)`, [p1.id, cust])).err ?? ''), 'staff: a customer cannot be the account manager');
  ok(!(await tryq(`select tk_set_project_manager($1, $2)`, [p1.id, am])).err, 'staff: account manager set');
  const cands = await all(`select user_id from tk_manager_candidates()`);
  ok(cands.some((c) => c.user_id === am) && cands.some((c) => c.user_id === admin) && !cands.some((c) => c.user_id === support), 'staff: account manager choices = admins, account managers, Turnkey editors');
  await as(finance);
  ok((await all(`select id from tk_client_projects where id = $1`, [p1.id])).length === 1 && /FORBIDDEN/.test((await tryq(`select tk_set_stage_due($1, 'design', null)`, [p1.id])).err ?? ''),
    'finance (Turnkey view only): sees, cannot change');
  await as(cust, 'aal1');
  const name = (await one(`select tk_project_manager_name($1) n`, [p1.id])).n;
  const hist = (await all(`select kind from tk_client_project_events where project_id = $1 order by id`, [p1.id])).map((e) => e.kind).join(',');
  const cs = await one(`select stage, status from tk_client_projects where id = $1`, [p1.id]);
  ok(name === 'TK2 am', `customer: sees the account manager's name (${name})`);
  ok(hist === 'created,stage_forward,stage_forward,stage_back,status,status,due_date' && cs.stage === 'consultation' && cs.status === 'open', `customer: history ${hist}`);
  await owner();
  const audits = await all(`select action from audit_log where entity_id = $1 and action like 'turnkey.%'`, [String(p1.id)]);
  ok(audits.length >= 8, `every change is audit-logged (created, 3 phase moves, 2 status, due date, manager) (${audits.length})`);

  // ── 2b. a guest lead joins the company with the same verified email (needs a new lead: the freeze trigger is lifted in this rolled-back transaction only) ──
  const guest = await mkUser('guest');
  const orgG = await mkOrg('TK2 Guest Co', guest.id);
  await db.query(`set local lock_timeout = '5s'`);
  await db.query(`alter table turnkey_leads disable trigger trg_turnkey_leads_frozen`);
  const lead = await one(`insert into turnkey_leads (kind, project_id, company_name, contact_name, email, country, message, status) values ('quote', $1, 'TK2 Guest Co', 'Gul', upper($2), 'TR', 'Guest lead for T2 test', 'contacted') returning lead_id, reference`, [cat, guest.email]);
  await db.query(`alter table turnkey_leads enable trigger trg_turnkey_leads_frozen`);
  await db.query(UP);
  const gp = await one(`select p.id, p.org_id, p.stage, p.plan from tk_client_projects p join tk_client_project_staff s on s.project_id = p.id where s.legacy_lead_id = $1`, [lead.lead_id]);
  ok(gp && gp.org_id === null && gp.stage === 'enquiry' && /Guest lead/.test(gp.plan ?? ''), 'D3: a guest lead becomes a project without a company yet');
  await as(guest.id, 'aal1');
  ok((await all(`select 1 from tk_client_projects where id = $1`, [gp.id])).length === 0, 'D3: not visible before linking');
  const linked = (await one(`select tk_link_legacy_projects($1) n`, [orgG])).n;
  ok(linked === 1 && (await all(`select 1 from tk_client_projects where id = $1`, [gp.id])).length === 1, 'D3: linked on first visit by verified email; now visible');
  ok(/FORBIDDEN/.test((await tryq(`select tk_link_legacy_projects($1)`, [orgA])).err ?? ''), 'D3: cannot link into another company');
  await owner();

  // ── 6. down → up ──
  const leadsBefore = Number((await one(`select count(*) n from turnkey_leads`)).n);
  await db.query(DOWN);
  const gone = await one(`select to_regclass('public.tk_client_projects') a, to_regclass('public.tk_stages') b, to_regprocedure('public.tk_submit_enquiry(uuid,text,text,text,text,date,numeric,bigint,text)') c`);
  ok(!gone.a && !gone.b && !gone.c, 'down: tables and functions removed');
  ok(Number((await one(`select count(*) n from turnkey_leads`)).n) === leadsBefore, 'down: old leads untouched');
  await db.query(UP);
  await reapply(db, later);
  const back = await one(`select count(*) n from tk_client_projects`);
  ok(Number(back.n) === leadsBefore, `up again: the ${leadsBefore} old leads are projects again`);

  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nturnkey-t2: ${failed} check(s) failed` : '\nturnkey-t2: all passed');
process.exitCode = failed ? 1 : 0;
