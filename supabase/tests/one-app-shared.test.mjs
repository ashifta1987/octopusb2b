// ADDON-41 · 41-B shared parts — runs on the STAGING database, one transaction, rolled back.
//  · tenant isolation: a customer sees only their own company's services, holds, approvals; never staff-only tables
//  · account managers see only the companies they manage
//  · audit_log is append-only (update, delete and truncate rejected for every role)
//  · customers cannot read the carrier behind a shipment
//  · wallet holds: hold / capture / release / refund move the ledger correctly, idempotent, INSUFFICIENT_FUNDS
//  · approvals: no ceiling → owner; inside the customer's limits → auto; between → manager; who may decide
//  · bank transfers: customer submits with a slip; finance credits the amount actually received; reject needs a reason
//  · a staff account cannot be a member of a customer company
import { config } from 'dotenv'; import pg from 'pg';
const env = config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, processEnv: {} }).parsed;
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const now = Math.floor(Date.now() / 1000);
const as = async (sub) => {
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] })]);
  await db.query('set local role authenticated');
};
const service = async () => { await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`); await db.query('set local role service_role'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { const r = await db.query(sql, p); await db.query('release savepoint t'); return r; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
// (hold descriptions use plain names: "Hold · Dropshipping order …")
const user = async (email) => (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
const env41 = (await one(`select value #>> '{}' v from site_settings where key = 'app_environment'`))?.v;
if (env41 === 'production' && !process.env.ALLOW_PRODUCTION) { console.error('Refusing to run on production'); process.exit(1); }

try {
  await db.query('begin');
  // people and companies
  const [ownerU, mgrU, mgr2U, finU, custA, custB] = [await user('t41-owner@example.com'), await user('t41-mgr@example.com'), await user('t41-mgr2@example.com'),
    await user('t41-fin@example.com'), await user('t41-a@example.com'), await user('t41-b@example.com')];
  await db.query(`insert into user_roles(user_id, role_code) values ($1,'admin'), ($2,'account_manager'), ($3,'account_manager'), ($4,'finance')`, [ownerU, mgrU, mgr2U, finU]);
  const orgA = (await one(`insert into organizations(name, country) values ('T41 Company A', 'AE') returning id, wallet_reference`));
  const orgB = (await one(`insert into organizations(name, country) values ('T41 Company B', 'NG') returning id, wallet_reference`));
  ok(/^W-\d{5,}$/.test(orgA.wallet_reference) && orgA.wallet_reference !== orgB.wallet_reference, `each company gets its own wallet reference (${orgA.wallet_reference})`);
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1,$2,'owner'), ($3,$4,'owner')`, [orgA.id, custA, orgB.id, custB]);
  await db.query(`insert into account_managers(org_id, staff_user_id, is_primary) values ($1, $2, true)`, [orgA.id, mgrU]);
  await db.query(`insert into company_services(org_id, service, status) values ($1,'dropship','on'), ($2,'warehouse','on')`, [orgA.id, orgB.id]);

  ok(/STAFF_CANNOT_BE_CUSTOMER/.test(String(await tryQ(`insert into org_members(org_id, user_id) values ($1, $2)`, [orgB.id, mgrU]))), 'a staff account cannot join a customer company');
  ok(/CUSTOMER_CANNOT_BE_STAFF/.test(String(await tryQ(`insert into user_roles(user_id, role_code) values ($1, 'support')`, [custA]))), 'a customer account cannot be given a staff role');

  // tenant isolation
  await as(custA);
  ok((await db.query(`select org_id from company_services`)).rows.every((r) => r.org_id === orgA.id), 'customer A sees only company A services');
  for (const t of ['manager_limits', 'customer_limits', 'approvals', 'webhook_inbox']) {
    ok((await db.query(`select 1 from ${t}`)).rowCount === 0, `customer cannot read ${t}`);
  }
  ok(/permission denied/.test(String(await tryQ(`select carrier_code from shipments`))), 'customer cannot read shipments.carrier_code');
  ok(!/permission denied/.test(String(await tryQ(`select code, service_code, tracking_no from shipments`))), 'customer can still read their shipment service name and tracking');
  ok(/permission denied/.test(String(await tryQ(`update audit_log set action = 'x'`))), 'customer cannot write the audit log');
  await owner();

  // account manager scope
  await as(mgrU);
  const seen = (await db.query(`select id from organizations where id in ($1, $2)`, [orgA.id, orgB.id])).rows.map((r) => r.id);
  ok(seen.includes(orgA.id) && !seen.includes(orgB.id), 'an account manager sees their own customer and not others');
  ok((await db.query(`select 1 from company_services where org_id = $1`, [orgB.id])).rowCount === 0, 'manager cannot read services of a company they do not manage');
  ok(/MANAGER_LIMITS_NOT_SET/.test(String(await tryQ(`select set_customer_limits($1, 100000, 500000, 10)`, [orgA.id]))), 'a manager without a ceiling cannot set customer limits');
  ok(/FORBIDDEN/.test(String(await tryQ(`select set_customer_limits($1, 1, 1, 1)`, [orgB.id]))), 'a manager cannot set limits for a company they do not manage');
  await owner();

  // approvals routing
  await service();
  const r1 = (await one(`select request_approval($1, 'brand', 'quote', 'T41-Q1', 2000000, 25) v`, [orgA.id])).v;
  await owner();
  ok(r1.approver === 'owner' && r1.status === 'pending', 'no manager ceiling yet → the owner approves');
  await as(ownerU);
  ok(/FORBIDDEN|NOT_A_MANAGER/.test(String(await tryQ(`select set_manager_limits($1, 1000000, 15)`, [custA]))), 'limits only for account managers');
  await db.query(`select set_manager_limits($1, 1500000, 15)`, [mgrU]);              // US$ 15,000, 15 %
  await owner();
  await as(mgrU);
  ok(/ABOVE_MANAGER_LIMIT/.test(String(await tryQ(`select set_customer_limits($1, 2000000, 5000000, 20)`, [orgA.id]))), 'customer limit cannot exceed the manager ceiling');
  ok(/BELOW_MANAGER_MARGIN/.test(String(await tryQ(`select set_customer_limits($1, 500000, 2000000, 10)`, [orgA.id]))), 'customer minimum margin cannot be below the manager minimum');
  await db.query(`select set_customer_limits($1, 500000, 2000000, 20)`, [orgA.id]);  // US$ 5,000 per order, 20 %
  await owner();
  await service();
  const auto = (await one(`select request_approval($1, 'brand', 'quote', 'T41-Q2', 400000, 25) v`, [orgA.id])).v;
  const toMgr = (await one(`select request_approval($1, 'brand', 'quote', 'T41-Q3', 900000, 25) v`, [orgA.id])).v;
  const toOwner = (await one(`select request_approval($1, 'brand', 'quote', 'T41-Q4', 900000, 12) v`, [orgA.id])).v;
  const again = (await one(`select request_approval($1, 'brand', 'quote', 'T41-Q3', 900000, 25) v`, [orgA.id])).v;
  await owner();
  ok(auto.approver === 'auto' && auto.status === 'approved', 'inside the customer limits → approved automatically');
  ok(toMgr.approver === 'manager' && toMgr.status === 'pending', 'above the customer limit, inside the ceiling → manager');
  ok(toOwner.approver === 'owner', 'below the manager minimum margin → owner');
  ok(again.id === toMgr.id, 'asking again for the same item returns the open approval');
  await as(mgr2U);
  ok(/FORBIDDEN/.test(String(await tryQ(`select decide_approval($1, 'approved')`, [toMgr.id]))), 'another manager cannot decide it');
  await owner(); await as(mgrU);
  ok(/FORBIDDEN/.test(String(await tryQ(`select decide_approval($1, 'approved')`, [toOwner.id]))), 'a manager cannot decide an owner approval');
  ok(/NOTE_REQUIRED/.test(String(await tryQ(`select decide_approval($1, 'declined', '')`, [toMgr.id]))), 'declining needs a note');
  await db.query(`select decide_approval($1, 'approved', 'ok')`, [toMgr.id]);
  await owner(); await as(ownerU);
  await db.query(`select decide_approval($1, 'declined', 'margin too thin')`, [toOwner.id]);
  await owner();
  ok((await one(`select status from approvals where id = $1`, [toMgr.id])).status === 'approved' && (await one(`select status from approvals where id = $1`, [toOwner.id])).status === 'declined', 'decisions are saved');

  // bank transfer top-up
  await as(custA);
  ok(/SLIP_REQUIRED/.test(String(await tryQ(`select submit_bank_transfer(100000, $1)`, [`${orgB.id}/slip.pdf`]))), 'a slip from another company folder is refused');
  const tp = (await one(`select submit_bank_transfer(100000, $1, 'TT-123') v`, [`${orgA.id}/slip.pdf`])).v;
  ok(/FORBIDDEN/.test(String(await tryQ(`select confirm_bank_transfer($1, 100000, 'X')`, [tp]))), 'a customer cannot confirm their own transfer');
  await owner(); await as(finU);
  ok(/DIFFERENCE_REASON_REQUIRED/.test(String(await tryQ(`select confirm_bank_transfer($1, 99000, 'SCB-REF-1')`, [tp]))), 'a received amount that differs needs a reason');
  await db.query(`select confirm_bank_transfer($1, 99000, 'SCB-REF-1', 'bank charges')`, [tp]);     // US$ 990 actually arrived (bank fee)
  const tp2 = await (async () => { await owner(); await as(custA); const v = (await one(`select submit_bank_transfer(5000, $1) v`, [`${orgA.id}/s2.png`])).v; await owner(); await as(finU); return v; })();
  ok(/REASON_REQUIRED/.test(String(await tryQ(`select reject_bank_transfer($1, ' ')`, [tp2]))), 'rejecting needs a reason');
  await db.query(`select reject_bank_transfer($1, 'Not on the statement')`, [tp2]);
  await owner();
  const bal = Number((await one(`select wallet_balance($1, 'USD') b`, [orgA.id])).b);
  ok(bal === 99000, `wallet is credited with the amount received, not claimed (${bal})`);
  const t1 = await one(`select status, amount_received_cents, receipt_id from wallet_topups where id = $1`, [tp]);
  ok(t1.status === 'credited' && Number(t1.amount_received_cents) === 99000 && t1.receipt_id, 'transfer confirmed with a receipt');
  ok((await one(`select received_note from wallet_topups where id = $1`, [tp])).received_note === 'bank charges', 'the reason for the difference is saved');
  // a service proforma posts a receivable (Orders) debit
  await service();
  const pi = (await one(`select issue_service_proforma($1, 'brand', 'project', 'MB-T41', 'Test', '[{"description":"Deposit","amount_cents":120000}]'::jsonb) v`, [orgA.id])).v;
  await owner();
  const ar = Number((await one(`select coalesce(sum(debit_cents - credit_cents), 0) n from ledger_entries le join ledger_accounts la on la.id = le.account_id where la.code like 'ar:%' and le.org_id = $1`, [orgA.id])).n);
  ok(ar === 120000, `issuing a service proforma posts a receivable debit (${ar})`);
  ok((await one(`select count(*) n from invoice_lines where document_id = $1`, [pi])).n === '1', 'proforma lines saved');
  ok((await one(`select status, reject_reason from wallet_topups where id = $1`, [tp2])).reject_reason === 'Not on the statement', 'rejected transfer keeps the reason');

  // holds
  await as(custA);
  ok(/permission denied/.test(String(await tryQ(`select place_hold($1, 100, 'dropship', 'order', 'X')`, [orgA.id]))), 'customers cannot place holds directly');
  const sum = (await one(`select my_wallet_summary() v`)).v;
  ok(sum.reference === orgA.wallet_reference && Number(sum.available_cents) === 99000, 'customer wallet summary shows reference and balance');
  await owner();
  await service();
  ok(/INSUFFICIENT_FUNDS/.test(String(await tryQ(`select place_hold($1, 200000, 'dropship', 'store_order', 'T41-1')`, [orgA.id]))), 'hold larger than the balance → INSUFFICIENT_FUNDS');
  const h1 = (await one(`select place_hold($1, 30000, 'dropship', 'store_order', 'T41-1') v`, [orgA.id])).v;
  const h1b = (await one(`select place_hold($1, 30000, 'dropship', 'store_order', 'T41-1') v`, [orgA.id])).v;
  const h2 = (await one(`select place_hold($1, 20000, 'warehouse', 'charge', 'T41-2') v`, [orgA.id])).v;
  await owner();
  ok(h1 === h1b, 'placing the same hold twice is idempotent');
  ok((await one(`select memo from journals where ref_id = $1 and ref_type = 'wallet_hold'`, [h1])).memo === 'Hold · Dropshipping order T41-1', 'hold description uses plain names');
  ok(Number((await one(`select wallet_balance($1, 'USD') b`, [orgA.id])).b) === 49000, 'holds reduce the available balance at once');
  await service();
  await db.query(`select capture_hold($1, 'dropship', 25000)`, [h1]);                 // partial capture: 5,000 goes back
  await db.query(`select capture_hold($1)`, [h1]);                                     // idempotent
  await db.query(`select release_hold($1, 'cancelled in store')`, [h2]);
  await db.query(`select refund_capture($1, 5000, 'damaged item', 'T41-R1')`, [h1]);
  await db.query(`select refund_capture($1, 5000, 'damaged item', 'T41-R1')`, [h1]);  // idempotent
  ok(/INVALID_AMOUNT/.test(String(await tryQ(`select refund_capture($1, 999999, 'x', 'T41-R2')`, [h1]))), 'cannot refund more than was captured');
  await owner();
  const b2 = Number((await one(`select wallet_balance($1, 'USD') b`, [orgA.id])).b);
  ok(b2 === 99000 - 25000 + 5000, `balance after capture 250, release 200 and refund 50 is right (${b2})`);
  const unbalanced = Number((await one(`select count(*) n from (select journal_id from ledger_entries le join journals j on j.id = le.journal_id where j.ref_type in ('wallet_hold','wallet_topup') group by journal_id having sum(debit_cents) <> sum(credit_cents)) x`)).n);
  ok(unbalanced === 0, 'every hold and top-up journal balances');

  // audit log
  const acts = (await db.query(`select action, actor_kind from audit_log where org_id = $1 order by id`, [orgA.id])).rows;
  ok(['wallet.transfer_submitted', 'wallet.transfer_confirmed', 'wallet.hold', 'wallet.capture', 'wallet.release', 'wallet.refund', 'approval.request', 'approval.decide', 'customer_limits.set']
    .every((a) => acts.some((x) => x.action === a)), 'every wallet move, limit change and approval is audited');
  ok(acts.find((x) => x.action === 'wallet.transfer_confirmed')?.actor_kind === 'staff' && acts.find((x) => x.action === 'wallet.transfer_submitted')?.actor_kind === 'customer', 'audit rows record who acted (customer / staff)');
  ok(/AUDIT_APPEND_ONLY/.test(String(await tryQ(`update audit_log set action = 'x' where org_id = $1`, [orgA.id]))), 'audit_log update rejected even for the database owner');
  ok(/AUDIT_APPEND_ONLY/.test(String(await tryQ(`delete from audit_log where org_id = $1`, [orgA.id]))), 'audit_log delete rejected even for the database owner');
} catch (e) {
  console.error(e); failed++;
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
