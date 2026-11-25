// Warehouse OS · W1 DB checks — migration 226. STAGING ONLY, one rolled-back transaction.
//  Apply: signed-out visitors can apply (APP-####); personal email refused; repeats limited; batteries/liquids flag SDS.
//  Review: only warehouse admins; approve refused until every check + plan; decline needs a reason; approval links the
//  applicant's company (3PL service on + wh_clients) when an account with that email exists, else on first sign-in.
//  Rates: two-person (proposer can't approve; admin approves); one active version per plan + warehouse; unknown stays
//  empty; active rates are public, proposals staff-only. Audit + ledger.
// Run: node --env-file=.env.staging supabase/tests/w1-warehouse.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
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
const apply = (email, bat = false) => `select wh_submit_application('W1 Test Co', 'Wen Li', '${email}', null, 'AE', 'Desk lamps', '100_500', array['Shopify'], 'own_supplier', ${bat}, false, null) r`;

try {
  await db.query('begin');
  const mkUser = async (tag, role = null, email = null) => {
    const e = email ?? `w1-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set email = excluded.email`, [id, `W1 ${tag}`, e]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return { id, email: e };
  };
  const admin = await mkUser('admin', 'admin');
  const admin2 = await mkUser('admin2', 'admin');
  const whAdmin = await mkUser('whadmin', 'warehouse');
  const packer = await mkUser('packer', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin'), ($2, 'FS-01', 'packer')`, [whAdmin.id, packer.id]);
  const stamp = Date.now();
  const linkedEmail = `buyer-${stamp}@w1company.test`;
  const cust = await mkUser('cust', null, linkedEmail);
  const org = (await one(`insert into organizations(name, country, is_seed) values ('W1 Test Customer', 'AE', true) returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust.id]);

  // ── Apply ──
  await as(null, 'aal1', 'anon');
  const a1 = (await one(apply(linkedEmail, true))).r;
  const personal = await tryq(apply('someone@gmail.com'));
  const later = (await one(apply(`later-${stamp}@w1other.test`))).r;
  const anonRead = await tryq(`select count(*)::int n from wh_applications`);
  await owner();
  const repeat1 = await tryq(apply(linkedEmail)); const repeat2 = await tryq(apply(linkedEmail)); const repeat3 = await tryq(apply(linkedEmail));
  ok(/^APP-\d{4,}$/.test(a1.code) && a1.safety_data_sheet === true && /WORK_EMAIL_REQUIRED/.test(personal.err ?? '') &&
    (anonRead.err || anonRead.rows[0].n === 0) && /TOO_MANY_APPLICATIONS/.test(repeat3.err ?? '') && !repeat1.err && !repeat2.err,
    `signed-out visitors apply (${a1.code}); batteries ask for an SDS; personal email refused; repeats limited; applications are not public`);
  const id1 = (await one(`select id from wh_applications where code = $1`, [a1.code])).id;
  const id2 = (await one(`select id from wh_applications where code = $1`, [later.code])).id;

  // ── Review ──
  await as(packer.id);
  const packerReview = await tryq(`select wh_review_application($1, true, true, true, 'standard')`, [id1]);
  await as(whAdmin.id);
  const earlyApprove = await tryq(`select wh_decide_application($1, 'approve')`, [id1]);
  await db.query(`select wh_review_application($1, true, true, false, 'standard')`, [id1]);
  const partialApprove = await tryq(`select wh_decide_application($1, 'approve')`, [id1]);
  await db.query(`select wh_review_application($1, true, true, true, 'volume')`, [id1]);
  const approved = (await one(`select wh_decide_application($1, 'approve') r`, [id1])).r;
  const declineNoReason = await tryq(`select wh_decide_application($1, 'decline', ' ')`, [id2]);
  await db.query(`select wh_review_application($1, true, true, true, 'standard')`, [id2]);
  const approved2 = (await one(`select wh_decide_application($1, 'approve') r`, [id2])).r;
  const again = await tryq(`select wh_decide_application($1, 'decline', 'x')`, [id1]);
  await owner();
  const client = await one(`select plan_code, preferred_warehouse from wh_clients where org_id = $1`, [org]);
  const svc = await one(`select status from company_services where org_id = $1 and service = 'warehouse'`, [org]);
  ok(/FORBIDDEN/.test(packerReview.err ?? '') && /CHECKS_NOT_DONE/.test(earlyApprove.err ?? '') && /CHECKS_NOT_DONE/.test(partialApprove.err ?? '') &&
    /REASON_REQUIRED/.test(declineNoReason.err ?? '') && /APPLICATION_DECIDED/.test(again.err ?? ''),
    'only warehouse admins review; approve is refused until every check and a plan; decline needs a reason; decided applications are final');
  ok(approved.linked === true && client?.plan_code === 'volume' && client?.preferred_warehouse === 'FS-01' && svc?.status === 'on' && approved2.linked === false,
    'approval opens the portal for the company of an existing account with that email (plan + warehouse); otherwise it waits');

  // first sign-in after approval links automatically
  const late = await mkUser('late', null, `later-${stamp}@w1other.test`);
  const org2 = (await one(`insert into organizations(name, country, is_seed) values ('W1 Late Co', 'AE', true) returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org2, late.id]);
  await as(late.id, 'aal1');
  const claimed = (await one(`select wh_claim_my_application() o`)).o;
  const ownClient = await all(`select org_id from wh_clients`);
  await owner();
  ok(claimed === org2 && ownClient.length === 1 && ownClient[0].org_id === org2, 'the applicant’s first sign-in links the approved application; they see only their own client row');

  // ── Rates ──
  await as(packer.id);
  const packerPropose = await tryq(`select wh_propose_rates('standard', null, 150, 1800, null, 120, 40, 200, null, 'x')`);
  await as(whAdmin.id);
  const neg = await tryq(`select wh_propose_rates('standard', null, -1, null, null, null, null, null, null, null)`);
  const r1 = (await one(`select wh_propose_rates('standard', null, 150, 1800, null, 120, 40, null, null, 'First card') id`)).id;
  const whAdminApprove = await tryq(`select wh_decide_rates($1, 'approve')`, [r1]);
  await as(null, 'aal1', 'anon');
  const anonPending = await all(`select id from wh_rate_versions where id = $1`, [r1]);
  await as(admin.id);
  const r2 = (await one(`select wh_propose_rates('standard', 'FS-01', 140, null, null, 110, 35, null, null, 'Foshan') id`)).id;
  const selfApprove = await tryq(`select wh_decide_rates($1, 'approve')`, [r2]);
  await db.query(`select wh_decide_rates($1, 'approve')`, [r1]);
  await as(admin2.id);
  await db.query(`select wh_decide_rates($1, 'approve')`, [r2]);
  const r3 = (await one(`select wh_propose_rates('standard', null, 160, 1800, null, 120, 40, null, null, 'Raise') id`)).id;
  await as(admin.id);
  await db.query(`select wh_decide_rates($1, 'approve')`, [r3]);
  await as(null, 'aal1', 'anon');
  const anonActive = await all(`select id, warehouse_code, receiving_per_carton_cents::int rc, returns_per_item_cents from wh_rate_versions where plan_code = 'standard' and status = 'active' order by warehouse_code nulls first`);
  const anonNote = await tryq(`select note, proposed_by from wh_rate_versions limit 1`);
  const anonList = await tryq(`select * from wh_list_rate_versions()`);
  await as(admin.id);
  const staffList = await all(`select id, note, proposed_by from wh_list_rate_versions() where id = $1`, [r1]);
  await owner();
  ok(/permission denied/.test(anonNote.err ?? '') && /permission denied|FORBIDDEN/.test(anonList.err ?? '') && staffList[0]?.note === 'First card' && staffList[0]?.proposed_by,
    'internal note and who proposed are hidden from the public; staff read them through wh_list_rate_versions()');
  const r1Status = (await one(`select status from wh_rate_versions where id = $1`, [r1])).status;
  ok(/FORBIDDEN/.test(packerPropose.err ?? '') && /INVALID_RATES/.test(neg.err ?? '') && /FORBIDDEN/.test(whAdminApprove.err ?? '') &&
    /TWO_PERSON_REQUIRED/.test(selfApprove.err ?? '') && anonPending.length === 0,
    'rates: packers can’t propose; fees can’t be negative; only admins approve and never their own proposal; proposals are not public');
  ok(anonActive.length === 2 && anonActive[0].rc === 160 && anonActive[0].returns_per_item_cents === null && anonActive[1].warehouse_code === 'FS-01' && r1Status === 'superseded',
    'one active version per plan and warehouse (new one replaces the old); a warehouse can have its own prices; unset fees stay empty');

  const audit = Number((await one(`select count(*) n from audit_log where action like 'wh_%'`)).n);
  ok(audit >= 10, `audit-logged (${audit} rows in this transaction and before)`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nw1-warehouse: ${failed} check(s) failed` : '\nw1-warehouse: all passed');
process.exitCode = failed ? 1 : 0;
