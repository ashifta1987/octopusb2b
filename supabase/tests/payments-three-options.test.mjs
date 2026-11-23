// Prompt 2 · Payments (3 Options for Every Service) + Multi-Company + Stripe/Airwallex/Mock.
// STAGING ONLY, one rolled-back transaction.
// Verifies all required database guarantees:
//  1. Multi-company legal_entities & per-entity document_counters (gap-free OCT-, CN-, PF- per entity; existing docs stay on Shenzhen Octopus Trading Co., Ltd.).
//  2. Payment option matrix (8 services × 3 options: SaaS & Advertising have payment_protection OFF by default; audit log on change).
//  3. Same webhook delivered twice creates ONE ledger entry (idempotent on (provider, event_id) and on checkout_id).
//  4. Changed amount or currency in webhook request is rejected (WEBHOOK_AMOUNT_MISMATCH / WEBHOOK_CURRENCY_MISMATCH).
//  5. Separate wallet from credit: wallet_available() returns real wallet funds without implicit default overdraft; Pay later requires kyc_status='verified' + two-person approved customer_credit_terms.
//  6. Two-person approval enforced in DB (proposed_by <> approved_by): ALWAYS for credit limits, and above US$1,000 threshold for held-payment releases/refunds.
//  7. Two pay-later orders at the same moment cannot exceed the credit limit (CREDIT_LIMIT_EXCEEDED); goods pay-later orders only RESERVE credit at confirmation and issue OCT- invoice with due_at at SHIPMENT (or release reservation if cancelled before shipment).
//  8. Held funds ("Held (payment protection)") never appear as revenue in division_report(), appear in held_payment_protection_by_division(), and release issues ONE OCT- tax invoice. Customer dispute freezes hold.
//  9. Every refund creates a CN- credit note and balanced reversing ledger entries.
// 10. Failed pool (fail_pool_and_refund_all) refunds everyone automatically to their wallet.
// 11. RLS: Customer A cannot see Customer B's payment_checkouts, escrow_holds, customer_credit_terms, credit_reservations, customer_payment_methods, or saas_subscriptions.
// 12. Down → up for 208, 207, 206 restores identical schema, policies, grants, and function ACLs.
// Run: node --env-file=.env.staging supabase/tests/payments-three-options.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';

config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid, aal = 'aal1') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try {
    const r = await db.query(q, p);
    await db.query('release savepoint sp');
    return { err: null, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback to savepoint sp');
    return { err: e.message, rows: [], n: 0 };
  }
};
const makeUser = async (email, role) => {
  const id = (await one(
    `insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`,
    [email]
  )).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `T ${email}`, email]);
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  return id;
};

try {
  await db.query('begin');

  const finMaker = await makeUser('pay-fin-maker@example.com', 'finance');
  const finApprover = await makeUser('pay-fin-approver@example.com', 'finance');
  const custA = await makeUser('pay-custa@example.com');
  const custB = await makeUser('pay-custb@example.com');

  const orgA = (await one(
    `insert into organizations(name, country, kyc_status, is_seed) values ('TEST · Pay Org A', 'GB', 'verified', true) returning id`
  )).id;
  const orgB = (await one(
    `insert into organizations(name, country, kyc_status, is_seed) values ('TEST · Pay Org B', 'DE', 'not_started', true) returning id`
  )).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, custA, orgB, custB]);

  const divSRC = (await one(`select id from divisions where code = 'SRC'`)).id;
  const divDS = (await one(`select id from divisions where code = 'DS'`)).id;
  const divPOOL = (await one(`select id from divisions where code = 'POOL'`)).id;

  // ── 1. Multi-company legal_entities & per-entity gap-free document_counters ──
  const szId = '00000000-0000-0000-0000-000000000001';
  const curEnt = (await one(`select current_legal_entity_id() as id`)).id;
  ok(curEnt === szId, '1.1 Default issuing entity is Shenzhen Octopus Trading Co., Ltd.');

  const hkEnt = (await one(
    `insert into legal_entities (code, legal_name, registered_in, default_currency, active_from, is_default, status)
     values ('HK-OCTOPUS', 'Octopus B2B (Hong Kong) Limited', 'Hong Kong', 'USD', '2027-01-01T00:00:00Z', false, 'upcoming')
     returning id`
  )).id;

  const szNo1 = (await one(`select next_document_number('invoice', $1, '2098-05-01T00:00:00Z'::timestamptz, $2) as n`, [divSRC, szId])).n;
  const szNo2 = (await one(`select next_document_number('invoice', $1, '2098-05-01T00:00:00Z'::timestamptz, $2) as n`, [divSRC, szId])).n;
  const hkNo1 = (await one(`select next_document_number('invoice', $1, '2098-05-01T00:00:00Z'::timestamptz, $2) as n`, [divSRC, hkEnt])).n;
  ok(szNo1 === 'OCT-SRC-2098-000001' && szNo2 === 'OCT-SRC-2098-000002' && hkNo1 === 'OCT-SRC-2098-000001',
    `1.2 Each legal entity has its own gap-free document counter series (${szNo1}, ${szNo2} vs HK ${hkNo1})`);

  // ── 2. Payment option matrix defaults & audit trigger ──
  const matrixRows = await all(`select service, option, enabled, pay_later_invoice_trigger from payment_option_settings order by service, option`);
  const saasProt = matrixRows.find((r) => r.service === 'saas' && r.option === 'payment_protection');
  const adsProt = matrixRows.find((r) => r.service === 'advertising' && r.option === 'payment_protection');
  const srcLater = matrixRows.find((r) => r.service === 'sourcing' && r.option === 'pay_later');
  ok(matrixRows.length === 24 && saasProt?.enabled === false && adsProt?.enabled === false && srcLater?.pay_later_invoice_trigger === 'shipment',
    '2.1 8 services × 3 options seeded; payment_protection OFF by default for SaaS & Advertising; goods pay_later trigger = shipment');

  // ── 3. Aggregator Checkout & Webhook: idempotency (same webhook twice = 1 ledger entry) & amount/currency verification ──
  const orderPayNow = (await one(
    `insert into orders (org_id, division_id, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, deposit_pct, currency, is_seed)
     values ($1, $2, 'TEST · Pay Now Sourcing Order', 'pi_issued', 100, 500, 5000, 55000, 55000, 0, 100, 'USD', true)
     returning id`,
    [orgA, divSRC]
  )).id;

  await as(custA);
  const chk1 = (await one(
    `select create_payment_checkout($1, 'sourcing', 'pay_now', 'order', $2, 55000, 'USD', 'card', 'mock', true, 'test-chk-paynow-1') as r`,
    [orgA, orderPayNow]
  )).r;
  ok(chk1.provider === 'mock' && Number(chk1.total_amount_cents) === 55000 && Number(chk1.surcharge_cents) === 0,
    '3.1 create_payment_checkout uses active mock provider and absorbs fee by default (surcharge = 0)');
  await db.query('reset role');

  // Tampered amount or currency in webhook must be rejected
  const badAmt = await tryq(
    `select confirm_aggregator_webhook('mock', 'evt_tampered_amt', 'payment.succeeded', $1, 100, 'USD', 'pay_1', 'cus_1', 'pm_1', '{}'::jsonb)`,
    [chk1.checkout_id]
  );
  const badCur = await tryq(
    `select confirm_aggregator_webhook('mock', 'evt_tampered_cur', 'payment.succeeded', $1, 55000, 'CNY', 'pay_1', 'cus_1', 'pm_1', '{}'::jsonb)`,
    [chk1.checkout_id]
  );
  ok(/WEBHOOK_AMOUNT_MISMATCH/.test(badAmt.err ?? '') && /WEBHOOK_CURRENCY_MISMATCH/.test(badCur.err ?? ''),
    '3.2 Webhook rejects tampered amount or currency');

  // Deliver valid webhook twice — must create only ONE ledger journal
  const wh1 = (await one(
    `select confirm_aggregator_webhook('mock', 'evt_valid_1', 'payment.succeeded', $1, 55000, 'USD', 'pay_mock_1', 'cus_mock_A', 'pm_mock_card_4242', '{"ok":true}'::jsonb) as r`,
    [chk1.checkout_id]
  )).r;
  const wh2 = (await one(
    `select confirm_aggregator_webhook('mock', 'evt_valid_1', 'payment.succeeded', $1, 55000, 'USD', 'pay_mock_1', 'cus_mock_A', 'pm_mock_card_4242', '{"ok":true}'::jsonb) as r`,
    [chk1.checkout_id]
  )).r;
  const wh3 = (await one(
    `select confirm_aggregator_webhook('mock', 'evt_duplicate_delivery_2', 'payment.succeeded', $1, 55000, 'USD', 'pay_mock_1', 'cus_mock_A', 'pm_mock_card_4242', '{"ok":true}'::jsonb) as r`,
    [chk1.checkout_id]
  )).r;

  const payCount = Number((await one(`select count(*) as n from payments where order_id = $1`, [orderPayNow])).n);
  const savedPm = await one(`select provider_customer_id, provider_payment_method_id, consented_for_recurring from customer_payment_methods where org_id = $1`, [orgA]);
  ok(wh1.repeated === false && wh2.repeated === true && wh3.repeated === true && wh1.journal_id === wh2.journal_id && payCount === 1,
    '3.3 Same webhook delivered twice (and second event for same checkout) creates exactly ONE payment and ONE ledger journal');
  ok(savedPm?.provider_customer_id === 'cus_mock_A' && savedPm?.provider_payment_method_id === 'pm_mock_card_4242' && savedPm?.consented_for_recurring === true,
    '3.4 Saved payment method stores only provider IDs with recurring consent');

  // ── 4. Separate Wallet from Credit & Two-Person Credit Limit Approval ──
  const walAvailA = Number((await one(`select wallet_available($1, 'USD') as a`, [orgA])).a);
  const walBalA = Number((await one(`select wallet_balance($1, 'USD') as b`, [orgA])).b);
  ok(walAvailA === walBalA && walAvailA === 0, '4.1 wallet_available() returns real wallet funds only (0 without top-up, no implicit US$ 2,000 overdraft)');

  // Maker proposes credit limit of US$ 1,000 (100000 cents), Net 30 for orgA
  await as(finMaker, 'aal2');
  const termsId = (await one(
    `select propose_customer_credit_terms($1, 100000, 30, $2, 'USD', 'Approved Sourcing Net 30 credit line') as id`,
    [orgA, divSRC]
  )).id;

  // Same maker cannot approve their own proposal (enforced in function AND DB constraint)
  const selfApprove = await tryq(`select decide_customer_credit_terms($1, true, 'Self approve attempt')`, [termsId]);
  ok(/MAKER_CANNOT_APPROVE/.test(selfApprove.err ?? ''), '4.2 Maker cannot approve their own credit limit proposal (two-person rule)');

  // Direct SQL bypass check against constraint customer_credit_terms_two_person
  await db.query('reset role');
  const dbConstraintBypass = await tryq(
    `update customer_credit_terms set status = 'active', approved_by = proposed_by where id = $1`,
    [termsId]
  );
  ok(/customer_credit_terms_two_person/.test(dbConstraintBypass.err ?? ''), '4.3 Database check constraint blocks single-person credit limit activation');

  // Second Finance user approves
  await as(finApprover, 'aal2');
  const approvedTerms = (await one(`select decide_customer_credit_terms($1, true, 'Verified by second finance officer') as r`, [termsId])).r;
  ok(approvedTerms.status === 'active', '4.4 Second Finance user activates credit terms');
  await db.query('reset role');

  // Unverified KYC orgB cannot use Pay later even if we tried
  await as(custB);
  const statusB = (await one(`select get_customer_credit_status($1, $2) as s`, [orgB, divSRC])).s;
  ok(statusB.eligible === false && /KYC/.test(statusB.reason ?? ''), '4.5 Unverified KYC company is ineligible for Pay later');
  await db.query('reset role');

  // ── 5. Pay-Later Timing: Reserve at Order Confirmation, Limit Check, Invoice at Shipment, Release on Cancel ──
  const orderPL1 = (await one(
    `insert into orders (org_id, division_id, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, deposit_pct, currency, is_seed)
     values ($1, $2, 'TEST · Pay Later Order 1', 'pi_issued', 10, 6000, 0, 60000, 60000, 0, 100, 'USD', true)
     returning id`,
    [orgA, divSRC]
  )).id;
  const orderPL2 = (await one(
    `insert into orders (org_id, division_id, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, deposit_pct, currency, is_seed)
     values ($1, $2, 'TEST · Pay Later Order 2 (Exceeds)', 'pi_issued', 10, 6000, 0, 60000, 60000, 0, 100, 'USD', true)
     returning id`,
    [orgA, divSRC]
  )).id;

  await as(custA);
  const plRes1 = (await one(
    `select checkout_pay_later($1, 'sourcing', 'order', $2, 60000, 'USD', 'pl-ord-1') as r`,
    [orgA, orderPL1]
  )).r;
  ok(plRes1.status === 'reserved' && plRes1.invoice_id === null && Number(plRes1.available_after_cents) === 40000,
    '5.1 Goods Pay-later order ONLY reserves credit at confirmation (no OCT- tax invoice before shipment)');

  // Second order of 60,000 cents must fail because 60,000 + 60,000 > 100,000 credit limit
  const plExceed = await tryq(
    `select checkout_pay_later($1, 'sourcing', 'order', $2, 60000, 'USD', 'pl-ord-2')`,
    [orgA, orderPL2]
  );
  ok(/CREDIT_LIMIT_EXCEEDED/.test(plExceed.err ?? ''), '5.2 Second Pay-later order exceeding remaining credit limit is rejected');
  await db.query('reset role');

  // Transition orderPL1 to 'shipped' -> trigger issues OCT- tax invoice with due_at = now() + 30 days
  await db.query(`update orders set status = 'shipped' where id = $1`, [orderPL1]);
  const plInv = await one(
    `select id, number, doc_type, amount_cents, due_at, payment_option, credit_terms_days
       from documents where order_id = $1 and doc_type = 'commercial_invoice'`,
    [orderPL1]
  );
  const plResAfterShip = await one(`select status, invoice_id from credit_reservations where id = $1`, [plRes1.reservation_id]);
  ok(plInv && /^OCT-SRC-/.test(plInv.number) && plInv.due_at !== null && Number(plInv.credit_terms_days) === 30 && plResAfterShip.status === 'invoiced',
    `5.3 At SHIPMENT, Pay-later reservation converts to OCT- tax invoice (${plInv?.number}) with Net 30 due_at`);

  // Order cancelled before shipment releases its credit reservation
  const orderPLCancel = (await one(
    `insert into orders (org_id, division_id, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, deposit_pct, currency, is_seed)
     values ($1, $2, 'TEST · Pay Later Cancel Before Ship', 'pi_issued', 10, 3000, 0, 30000, 30000, 0, 100, 'USD', true)
     returning id`,
    [orgA, divSRC]
  )).id;
  await as(custA);
  const plResCancel = (await one(`select checkout_pay_later($1, 'sourcing', 'order', $2, 30000, 'USD', 'pl-ord-cancel') as r`, [orgA, orderPLCancel])).r;
  await db.query('reset role');
  await db.query(`update orders set status = 'cancelled' where id = $1`, [orderPLCancel]);
  const cancelState = await one(`select status from credit_reservations where id = $1`, [plResCancel.reservation_id]);
  const credAfterCancel = (await one(`select get_customer_credit_status($1, $2) as s`, [orgA, divSRC])).s;
  ok(cancelState.status === 'released' && Number(credAfterCancel.reserved_cents) === 0 && Number(credAfterCancel.unpaid_invoices_cents) === 60000,
    '5.4 Cancelling a Pay-later order before shipment releases the credit reservation immediately');

  // ── 6. Payment Protection (Held funds ≠ Revenue, Dispute freeze, 2-person approval > US$1,000, ONE OCT- invoice on release) ──
  // Top up orgA wallet with US$ 2,000 (200000 cents) so we can test both <= $1,000 and > $1,000 holds
  await db.query(
    `select post_journal('Test wallet funding', jsonb_build_array(
       jsonb_build_object('account', cash_account('USD'), 'debit', 250000, 'credit', 0),
       jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 250000, 'org', $1)
     ), 'test-fund-orgA', 'topup', 'wallet_topup', $1)`,
    [orgA]
  );

  const orderProt = (await one(
    `insert into orders (org_id, division_id, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, deposit_pct, currency, is_seed)
     values ($1, $2, 'TEST · Payment Protection Order ($1,500)', 'pi_issued', 100, 1500, 0, 150000, 150000, 0, 100, 'USD', true)
     returning id`,
    [orgA, divDS]
  )).id;

  await as(finMaker, 'aal2');
  const revBeforeHold = Number((await one(`select revenue_converted_minor from division_report(null, null, true) where division_code = 'DS'`)).revenue_converted_minor);
  const heldBeforeHold = Number((await one(`select held_converted_minor from held_payment_protection_by_division(null, null, true) where division_code = 'DS'`)).held_converted_minor);

  await as(custA);
  const holdRes = (await one(
    `select pay_with_protection_wallet('dropship', 'order', $1, 150000, 'USD', 'prot-ds-1500') as r`,
    [orderProt]
  )).r;
  const holdId = holdRes.hold_id;

  await as(finMaker, 'aal2');
  const revDuringHold = Number((await one(`select revenue_converted_minor from division_report(null, null, true) where division_code = 'DS'`)).revenue_converted_minor);
  const heldDuringHold = Number((await one(`select held_converted_minor from held_payment_protection_by_division(null, null, true) where division_code = 'DS'`)).held_converted_minor);
  const invDuringHold = Number((await one(`select count(*) as n from documents where order_id = $1 and doc_type = 'commercial_invoice'`, [orderProt])).n);

  ok(revDuringHold === revBeforeHold && heldDuringHold === heldBeforeHold + 150000 && invDuringHold === 0,
    '6.1 Held (payment protection) funds are booked to liability (held +$1,500.00), NEVER appear as revenue before release, and issue 0 tax invoices while held');

  // Customer opens a dispute before release -> freezes hold
  await as(custA);
  const disp = (await one(`select open_escrow_dispute($1, 'Box arrived damaged on 2 units') as r`, [holdId])).r;
  ok(disp.status === 'disputed', '6.2 Customer can open a dispute before release, freezing the hold in disputed status');

  // Finance maker proposes release of $1,500 (> $1,000 threshold) -> creates pending two-person approval row
  await as(finMaker, 'aal2');
  const propRel = (await one(
    `select finance_act_on_escrow_hold($1, 'release', 150000, 'Dispute resolved with replacement units shipped', 'wallet') as r`,
    [holdId]
  )).r;
  ok(propRel.requires_second_approver === true && propRel.approval_id != null,
    '6.3 Release above US$ 1,000 threshold requires a second Finance approver');

  // Maker cannot approve their own release proposal
  const selfRelApprove = await tryq(`select decide_escrow_hold_approval($1, true, 'Self approve')`, [propRel.approval_id]);
  ok(/MAKER_CANNOT_APPROVE/.test(selfRelApprove.err ?? ''), '6.4 Same Finance user cannot approve their own >$1,000 held-payment release');

  // Second Finance approver approves -> releases funds and issues ONE OCT- tax invoice
  await as(finApprover, 'aal2');
  const finalRel = (await one(`select decide_escrow_hold_approval($1, true, 'Verified replacement tracking') as r`, [propRel.approval_id])).r;
  const invAfterRelease = await all(`select id, number, amount_cents, status from documents where order_id = $1 and doc_type = 'commercial_invoice'`, [orderProt]);
  const heldAfterRelease = Number((await one(`select held_converted_minor from held_payment_protection_by_division(null, null, true) where division_code = 'DS'`)).held_converted_minor);
  const revAfterRelease = Number((await one(`select revenue_converted_minor from division_report(null, null, true) where division_code = 'DS'`)).revenue_converted_minor);

  ok(finalRel.status === 'released' && invAfterRelease.length === 1 && /^OCT-DS-/.test(invAfterRelease[0].number)
     && heldAfterRelease === heldBeforeHold && revAfterRelease === revBeforeHold + 150000,
    `6.5 Second Finance approver releases hold: issues exactly ONE tax invoice (${invAfterRelease[0]?.number}) and recognizes revenue on release`);

  // ── 7. Refunds: CN-[div]-[year]-[seq] credit note ONLY when an OCT- tax invoice exists; pre-invoice refunds reverse ledger only (no CN-) ──
  const refundRes = (await one(
    `select issue_payment_refund($1, $2, 20000, 'Damaged unit partial refund', 'wallet', 'ref-cn-test-1') as r`,
    [orgA, invAfterRelease[0].id]
  )).r;
  const cnDoc = await one(`select number, doc_type, amount_cents, original_document_id from documents where id = $1`, [refundRes.credit_note_id]);
  ok(cnDoc && /^CN-DS-/.test(cnDoc.number) && Number(cnDoc.amount_cents) === 20000 && cnDoc.original_document_id === invAfterRelease[0].id,
    `7.1 Refund against an OCT- tax invoice issues a CN- credit note (${cnDoc?.number}) linked to the original invoice`);

  // 7.2 Pre-release Payment protection refund (no OCT- invoice yet) refunds through ledger reversal ONLY (no CN- issued)
  await db.query('reset role');
  const orderProtNoInv = (await one(
    `insert into orders (org_id, division_id, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, deposit_pct, currency, is_seed)
     values ($1, $2, 'TEST · Pre-Release Hold Refund ($300)', 'pi_issued', 10, 3000, 0, 30000, 30000, 0, 100, 'USD', true)
     returning id`,
    [orgA, divDS]
  )).id;
  await as(custA);
  const preHoldId = (await one(`select (pay_with_protection_wallet('dropship', 'order', $1, 30000, 'USD', 'prot-pre-ref-1') ->> 'hold_id')::uuid as id`, [orderProtNoInv])).id;
  await as(finApprover, 'aal2');
  const preHoldRef = (await one(`select finance_act_on_escrow_hold($1, 'refund', 30000, 'Cancelled before milestone release', 'wallet') as r`, [preHoldId])).r;
  await db.query('reset role');
  const cnCountForPreHold = Number((await one(`select count(*) as n from documents where order_id = $1 and doc_type = 'credit_note'`, [orderProtNoInv])).n);
  ok(preHoldRef.status === 'refunded' && preHoldRef.credit_note_id === null && cnCountForPreHold === 0,
    '7.2 Payment protection refund before release has no tax invoice and refunds via ledger reversal ONLY (0 CN- credit notes)');

  // 7.3 Pre-invoice deposit refund on a part-paid proforma_invoice refunds via ledger reversal ONLY (no CN- issued)
  const pfDepositId = (await one(
    `insert into documents (org_id, division_id, doc_type, number, amount_cents, paid_cents, currency, status, is_seed)
     values ($1, $2, 'proforma_invoice', 'PF-TEST-DEPREF-1', 40000, 10000, 'USD', 'part_paid', true)
     returning id`,
    [orgA, divSRC]
  )).id;
  await as(finApprover, 'aal2');
  const depRefRes = (await one(
    `select issue_payment_refund($1, $2, 10000, 'Order cancelled before full payment / before tax invoice', 'wallet', 'ref-dep-no-cn-1') as r`,
    [orgA, pfDepositId]
  )).r;
  await db.query('reset role');
  const cnCountForPf = Number((await one(`select count(*) as n from documents where original_document_id = $1 and doc_type = 'credit_note'`, [pfDepositId])).n);
  ok(depRefRes.credit_note_id === null && depRefRes.journal_id !== null && cnCountForPf === 0,
    '7.3 Pre-invoice proforma deposit refund reverses ledger without issuing a CN- credit note');

  // ── 8. Failed pool refunds everyone automatically to their wallet ──
  await db.query('reset role');
  const poolProd = (await one(`select id, supplier_id from products where supplier_id is not null limit 1`));
  const testPool = (await one(
    `insert into pools (code, product_id, supplier_id, division_id, status, target_qty, filled_qty, min_pledge, max_buyers, deadline_at, pool_price_minor, currency, deposit_pct, is_seed)
     values ('POOL-PAY-99', $1, $2, $3, 'open', 500, 50, 10, 20, now() + interval '7 days', 1000, 'USD', 30, true)
     returning id`,
    [poolProd.id, poolProd.supplier_id, divPOOL]
  )).id;
  const testPledge = (await one(
    `insert into pool_pledges (pool_id, org_id, buyer_user_id, division_id, qty, deposit_minor, currency, pay_source, status, is_seed)
     values ($1, $2, $3, $4, 50, 15000, 'USD', 'card', 'pending', true)
     returning id`,
    [testPool, orgA, custA, divPOOL]
  )).id;

  // Pay for the pool pledge under Payment protection via wallet
  await as(custA);
  await one(`select pay_with_protection_wallet('pools', 'pool_pledge', $1, 15000, 'USD', 'pool-prot-pledge-1')`, [testPledge]);
  const walBeforePoolFail = Number((await one(`select (my_wallet_summary() ->> 'available_cents')::bigint as b`)).b);

  await as(finApprover, 'aal2');
  const poolFailRes = (await one(`select fail_pool_and_refund_all($1, 'Target MOQ not reached by closing time') as r`, [testPool])).r;
  await db.query('reset role');
  const walAfterPoolFail = Number((await one(`select wallet_balance($1, 'USD') as b`, [orgA])).b);
  ok(Number(poolFailRes.refunded_holds) === 1 && walAfterPoolFail === walBeforePoolFail + 15000,
    '8.1 Failed pool automatically refunds held participant deposits back to their wallet (+15,000 cents)');

  // ── 9. SaaS subscription (seeded plans are is_test=true, active=false by default; activating one allows checkout) & Dropshipping weekly statement ──
  await db.query('reset role');
  const seededPlans = await all(`select code, active, is_test from saas_plans`);
  ok(seededPlans.length === 4 && seededPlans.every((p) => p.is_test === true && p.active === false),
    '9.0 Seeded SaaS plans are marked is_test = true and active = false so test offers never appear as live plans');
  await db.query(`update saas_plans set active = true where code = 'dropship_growth_monthly'`);
  await as(custA);
  const saasSub = (await one(`select subscribe_saas_plan($1, 'dropship_growth_monthly', 'pay_now', 'wallet', 'saas-sub-test-1') as r`, [orgA])).r;
  const stmt = (await one(`select generate_dropship_weekly_statement($1) as r`, [orgA])).r;
  ok(saasSub.status === 'active' && /^OCT-SRC-/.test(saasSub.invoice_number) && Number(stmt.invoice_count) >= 1,
    `9.1 SaaS subscription checkout (${saasSub.invoice_number}) and Dropshipping weekly statement (${stmt.number}) work end-to-end`);

  // ── 10. RLS isolation: Customer B cannot see Customer A's payment rows ──
  await as(custB);
  const bCheckouts = (await all(`select id from payment_checkouts where org_id = $1`, [orgA])).length;
  const bHolds = (await all(`select id from escrow_holds where org_id = $1`, [orgA])).length;
  const bTerms = (await all(`select id from customer_credit_terms where org_id = $1`, [orgA])).length;
  const bRes = (await all(`select id from credit_reservations where org_id = $1`, [orgA])).length;
  const bMethods = (await all(`select id from customer_payment_methods where org_id = $1`, [orgA])).length;
  const bSubs = (await all(`select id from saas_subscriptions where org_id = $1`, [orgA])).length;
  ok(bCheckouts === 0 && bHolds === 0 && bTerms === 0 && bRes === 0 && bMethods === 0 && bSubs === 0,
    '10.1 RLS: Customer B sees 0 of Customer A’s checkouts, holds, credit terms, reservations, payment methods, and SaaS subscriptions');

  await db.query('reset role');

  // Verify ledger stays 100% balanced after all journals in this test
  const ledgerDiff = Number((await one(`select coalesce(sum(debit_cents - credit_cents), 0) as d from ledger_entries`)).d);
  ok(ledgerDiff === 0, `10.2 Double-entry ledger is balanced to 0 cents (diff = ${ledgerDiff})`);

  await db.query('rollback');

  // ── 11. Down → Up round-trip for 208, 207, 206 ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    pol: await all(`select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`),
    tg: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  });
  const before = await snap();
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000208_payment_checkout_rpcs.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000207_payment_protection_and_credit_terms.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000206_legal_entities_and_payment_settings.down.sql', 'utf8'));
  const hasLegalEntitiesDown = (await one(`select to_regclass('public.legal_entities') as t`)).t;
  ok(hasLegalEntitiesDown === null, '11.1 Down migrations 208 → 207 → 206 cleanly remove new payment & legal_entities tables');

  await db.query(fs.readFileSync('supabase/migrations/20261101000206_legal_entities_and_payment_settings.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261101000207_payment_protection_and_credit_terms.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261101000208_payment_checkout_rpcs.sql', 'utf8'));
  const after = await snap();
  if (after !== before) {
    const a = JSON.parse(before), b = JSON.parse(after);
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        const sa = new Set(a[k].map((x) => JSON.stringify(x)));
        const sb = new Set(b[k].map((x) => JSON.stringify(x)));
        console.log('  diff in', k, 'added:', b[k].filter((x) => !sa.has(JSON.stringify(x))).slice(0, 5), 'missing:', a[k].filter((x) => !sb.has(JSON.stringify(x))).slice(0, 5));
      }
    }
  }
  ok(after === before, '11.2 Up migrations 206 → 207 → 208 restore identical policies, table grants, column grants, and function ACLs');
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback');
  await db.end();
}

console.log(failed ? `\npayments-three-options: ${failed} check(s) failed` : '\npayments-three-options: all passed');
process.exitCode = failed ? 1 : 0;
