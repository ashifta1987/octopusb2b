import { test, expect } from '@playwright/test';
import { adminClient, customerLogin, pgClient, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Prompt 2 · Payments (3 Options for Every Service) + Multi-Company + Stripe/Airwallex/Mock (STAGING ONLY).
 * Browser end-to-end tests:
 *  1. Sourcing Order — Option 1 (Pay now via Mock online aggregator webhook):
 *     Customer chooses "1. Pay now" → "Pay online" → redirected to /pay/mock/[checkoutId] → clicks Authorize →
 *     signed webhook settles order to deposit_paid.
 *  2. Dropshipping Order — Option 2 (Payment protection):
 *     Customer chooses "2. Payment protection" → funds from wallet → sees 4-step status bar ("Paid → Held → ...") →
 *     opens a dispute ("Open a dispute") which freezes the hold → Finance resolves & releases → ONE OCT-DS- tax invoice.
 *  3. Sourcing Order — Option 3 (Pay later · Net 30) & SaaS Subscription:
 *     Two-person approved credit limit → customer confirms order with "3. Pay later (Net 30)" → credit reserved at
 *     confirmation (no OCT- invoice before shipment) → order ships → OCT-SRC- tax invoice issued with due_at.
 *     Plus SaaS plan subscription on /account/invoices.
 *  4. Finance Staff Screens:
 *     /admin/settings/payment (8×3 matrix, Stripe/Airwallex/Mock cards, surcharge compliance warning, legal entities),
 *     /admin/finance/holds, /admin/finance/credit, /admin/finance/receivables, and /admin/reports/divisions
 *     ("Held (payment protection)" column next to "Customer deposits").
 */

let cust: TempCustomer | null = null;
let finMaker: TempStaff | null = null;
let finApprover: TempStaff | null = null;
let orderPayNowId = '';
let orderProtId = '';
let orderPayLaterId = '';
let octBefore = 0;
const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const a = adminClient();
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingOrThrow(db);
    octBefore = Number(
      (
        await db.query(
          `select coalesce((select last_value from document_counters where entity_id = '00000000-0000-0000-0000-000000000001' and series = 'OCT' and year = $1), 0) v`,
          [year],
        )
      ).rows[0].v,
    );

    finMaker = await createTempStaff('finance');
    finApprover = await createTempStaff('finance');

    const org = (
      await db.query(
        `insert into organizations(name, country, kyc_status, is_seed) values ('TEST · e2e payments 3 options', 'GB', 'verified', true) returning id`,
      )
    ).rows[0].id as string;

    const email = `e2e.pay3+${Date.now()}@demo.octopusb2b.com`;
    const password = `E2e-${Math.random().toString(36).slice(2, 10)}-9!`;
    const { data: u } = await a.auth.admin.createUser({ email, password, email_confirm: true });
    await db.query(
      `insert into profiles(id, full_name, email) values ($1, 'E2E 3-Option Buyer', $2) on conflict (id) do nothing`,
      [u.user!.id, email],
    );
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, u.user!.id]);

    // Fund customer wallet with US$ 2,000.00 (200000 cents) and approve a Net 30 credit limit of US$ 3,000.00 (300000 cents) via two finance users
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await db.query(`select set_config('octopus.allow_credit_eligible_write', 'true', true)`);
    await db.query(`update organizations set credit_eligible = true where id = $1`, [org]);
    await db.query(
      `select post_journal('TEST wallet funding (e2e pay3)', jsonb_build_array(
         jsonb_build_object('account', cash_account('USD'), 'debit', 200000, 'credit', 0),
         jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 200000, 'org', $1::text)
       ), 'test-e2e-pay3-fund-' || $1::text, 'topup', 'adjustment', null)`,
      [org],
    );

    // Two-person approved credit limit (finMaker proposes, finApprover approves)
    await db.query(
      `insert into customer_credit_terms (org_id, division_id, credit_limit_cents, currency, net_days, status, proposed_by, approved_by, approved_at, note)
       values ($1, null, 300000, 'USD', 30, 'active', $2, $3, now(), 'E2E two-person approved Net 30 line')`,
      [org, finMaker.id, finApprover.id],
    );

    const divSRC = (await db.query(`select id from divisions where code = 'SRC'`)).rows[0].id as string;
    const divDS = (await db.query(`select id from divisions where code = 'DS'`)).rows[0].id as string;

    orderPayNowId = (
      await db.query(
        `insert into orders (org_id, division_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, is_seed)
         values ($1, $2, 'deposit_pending', 'TEST · Sourcing Order (Pay Now Online)', 100, 400, 0, 40000, 100, 40000, 0, 'USD', true)
         returning id`,
        [org, divSRC],
      )
    ).rows[0].id as string;

    orderProtId = (
      await db.query(
        `insert into orders (org_id, division_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, is_seed)
         values ($1, $2, 'deposit_pending', 'TEST · Dropship Order (Payment Protection)', 50, 1000, 0, 50000, 100, 50000, 0, 'USD', true)
         returning id`,
        [org, divDS],
      )
    ).rows[0].id as string;

    orderPayLaterId = (
      await db.query(
        `insert into orders (org_id, division_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, is_seed)
         values ($1, $2, 'deposit_pending', 'TEST · Sourcing Order (Pay Later Net 30)', 100, 800, 0, 80000, 100, 80000, 0, 'USD', true)
         returning id`,
        [org, divSRC],
      )
    ).rows[0].id as string;

    await db.query('commit');
    cust = { id: u.user!.id, email, password, orgId: org };
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  await assertStagingOrThrow();
  if (cust) {
    const db = pgClient();
    await db.connect();
    try {
      await assertStagingOrThrow(db);
      await db.query('begin');
      const org = cust.orgId;
      const js = (
        await db.query(
          `select distinct j.id
             from journals j
             left join ledger_entries le on le.journal_id = j.id
             left join ledger_accounts la on la.id = le.account_id
            where la.org_id = $1
               or j.idempotency_key like '%' || $1::text || '%'
               or (j.ref_type = 'order' and j.ref_id in (select id from orders where org_id = $1))
               or (j.ref_type = 'payment' and j.ref_id in (select id from payments where org_id = $1))
               or (j.ref_type = 'payment' and j.ref_id in (select id from payment_checkouts where org_id = $1))
               or (j.ref_type = 'wallet_hold' and j.ref_id in (select id from escrow_holds where org_id = $1))
               or (j.ref_type = 'document' and j.ref_id in (select id from documents where org_id = $1))`,
          [org],
        )
      ).rows.map((r) => r.id as string);

      await db.query(`delete from payment_reconciliation_alerts where checkout_id in (select id from payment_checkouts where org_id = $1)`, [org]);
      await db.query(`delete from payment_settlements where checkout_id in (select id from payment_checkouts where org_id = $1)`, [org]);
      await db.query(`delete from payment_webhook_events where checkout_id in (select id from payment_checkouts where org_id = $1)`, [org]);
      await db.query(`delete from escrow_hold_approvals where hold_id in (select id from escrow_holds where org_id = $1)`, [org]);
      await db.query(`delete from escrow_hold_events where org_id = $1`, [org]);
      await db.query(`delete from escrow_holds where org_id = $1`, [org]);
      await db.query(`delete from payment_checkouts where org_id = $1`, [org]);
      await db.query(`delete from credit_reservations where org_id = $1`, [org]);
      await db.query(`delete from saas_subscriptions where org_id = $1`, [org]);
      await db.query(`delete from customer_payment_methods where org_id = $1`, [org]);
      await db.query(`delete from customer_credit_terms where org_id = $1`, [org]);
      await db.query(`delete from payments where org_id = $1`, [org]);
      await db.query(`delete from document_payments where org_id = $1`, [org]);
      await db.query(`delete from order_events where org_id = $1`, [org]);
      await db.query(`delete from notifications where org_id = $1`, [org]);
      if (js.length > 0) {
        await db.query(`delete from ledger_entries where journal_id = any($1)`, [js]);
        await db.query(`delete from journals where id = any($1)`, [js]);
      }
      await db.query(`delete from invoice_lines where document_id in (select id from documents where org_id = $1)`, [org]);
      await db.query(`update documents set from_proforma_id = null, original_document_id = null where org_id = $1`, [org]);
      await db.query(`delete from documents where org_id = $1`, [org]);
      await db.query(`delete from orders where org_id = $1`, [org]);
      await db.query(`delete from ledger_accounts where org_id = $1`, [org]);
      await db.query(`delete from org_members where org_id = $1`, [org]);
      await db.query(`delete from organizations where id = $1`, [org]);
      await db.query(
        `update document_counters set last_value = $2 where entity_id = '00000000-0000-0000-0000-000000000001' and series = 'OCT' and year = $1`,
        [year, octBefore],
      );
      await db.query('commit');
    } finally {
      await db.end();
    }
    await adminClient().auth.admin.deleteUser(cust.id);
  }
  await deleteTempStaff(finMaker);
  await deleteTempStaff(finApprover);
});

test('1. Sourcing order · Option 1 (Pay now via Mock online aggregator webhook)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await customerLogin(page, cust!, `/account/orders/${orderPayNowId}`);
  await page.goto(`/account/orders/${orderPayNowId}`);

  await expect(page.getByTestId('choose-how-to-pay')).toBeVisible();
  await expect(page.getByTestId('option-card-pay_now')).toBeVisible();
  await expect(page.getByTestId('option-card-payment_protection')).toBeVisible();
  await expect(page.getByTestId('option-card-pay_later')).toBeVisible();

  await page.getByTestId('pay-now-online-btn').click();
  await page.waitForURL(/\/pay\/mock\//, { timeout: 20_000 });
  await expect(page.getByTestId('mock-checkout-page')).toBeVisible();
  await expect(page.getByTestId('mock-checkout-total')).toContainText('US$ 400.00');

  await page.getByTestId('mock-pay-confirm-btn').click();
  await page.waitForURL(`/account/orders/${orderPayNowId}`, { timeout: 20_000 });

  const a = adminClient();
  const { data: ord } = await a.from('orders').select('status, paid_cents, payment_option').eq('id', orderPayNowId).single();
  expect(ord?.status).toBe('deposit_paid');
  expect(Number(ord?.paid_cents)).toBe(40000);
  expect(ord?.payment_option).toBe('pay_now');
});

test('2. Dropship order · Option 2 (Payment protection → Dispute freeze → Finance release → 1 OCT-DS invoice)', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await customerLogin(page, cust!, `/account/orders/${orderProtId}`);
  await page.goto(`/account/orders/${orderProtId}`);

  await page.getByTestId('option-card-payment_protection').click();
  await expect(page.getByTestId('panel-payment_protection')).toContainText('Payment protection — we hold your payment until');
  // Customer never sees the word "escrow"
  expect(await page.getByTestId('panel-payment_protection').innerText()).not.toMatch(/escrow/i);

  await page.getByTestId('protection-wallet-btn').click();
  await expect(page.getByTestId('payment-protection-active-card')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('protection-remaining-held')).toContainText('US$ 500.00');

  // Customer opens a dispute before release → freezes held payment
  await page.getByTestId('open-dispute-btn').click();
  await page.getByTestId('dispute-reason-input').fill('Outer carton dented on 1 unit');
  await page.getByTestId('submit-dispute-btn').click();
  await expect(page.getByTestId('protection-disputed-banner')).toContainText('Outer carton dented on 1 unit', { timeout: 15_000 });

  // Finance opens /admin/finance/holds and releases the US$ 500 hold (<= US$ 1,000 threshold → immediate release + OCT-DS invoice)
  const finCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fp = await finCtx.newPage();
  await staffLogin(fp, finMaker!, '/admin/finance/holds');
  await fp.goto('/admin/finance/holds');
  await expect(fp.getByTestId('finance-holds-page')).toBeVisible();

  const a = adminClient();
  const { data: holdRow } = await a.from('escrow_holds').select('id').eq('order_id', orderProtId).single();
  await fp.getByTestId(`hold-execute-btn-${holdRow!.id}`).click();
  await expect(fp.getByTestId('holds-notice')).toContainText('Held payment action executed', { timeout: 15_000 });
  await finCtx.close();

  const { data: invs } = await a
    .from('documents')
    .select('number, amount_cents, status')
    .eq('order_id', orderProtId)
    .eq('doc_type', 'commercial_invoice');
  expect(invs?.length).toBe(1);
  expect(invs![0].number).toMatch(new RegExp(`^OCT-DS-${year}-\\d{6}$`));
});

test('3. Sourcing order · Option 3 (Pay later Net 30 reserves credit at confirmation and issues OCT-SRC invoice at shipment) + SaaS subscription', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await customerLogin(page, cust!, `/account/orders/${orderPayLaterId}`);
  await page.goto(`/account/orders/${orderPayLaterId}`);

  await page.getByTestId('option-card-pay_later').click();
  await expect(page.getByTestId('panel-pay_later')).toContainText('Net 30');
  await page.getByTestId('confirm-pay-later-btn').click();

  await expect(page.getByTestId('pay-later-reserved-banner')).toContainText('Confirmed on Pay later (Net 30 days)', {
    timeout: 20_000,
  });

  // Before shipment: no commercial_invoice exists yet
  const a = adminClient();
  const { data: invBefore } = await a
    .from('documents')
    .select('id')
    .eq('order_id', orderPayLaterId)
    .eq('doc_type', 'commercial_invoice');
  expect(invBefore?.length ?? 0).toBe(0);

  // When order transitions to 'shipped', trigger issues the OCT-SRC- tax invoice with due_at
  await a.from('orders').update({ status: 'shipped' }).eq('id', orderPayLaterId);
  const { data: invAfter } = await a
    .from('documents')
    .select('number, due_at, credit_terms_days')
    .eq('order_id', orderPayLaterId)
    .eq('doc_type', 'commercial_invoice');
  expect(invAfter?.length).toBe(1);
  expect(invAfter![0].number).toMatch(new RegExp(`^OCT-SRC-${year}-\\d{6}$`));
  expect(invAfter![0].due_at).toBeTruthy();
  expect(Number(invAfter![0].credit_terms_days)).toBe(30);

  // SaaS subscription on /account/invoices (activate one test plan for the duration of this test)
  await a.from('saas_plans').update({ active: true }).eq('code', 'dropship_growth_monthly');
  try {
    await page.goto('/account/invoices');
    await expect(page.getByTestId('saas-plans-panel')).toBeVisible();
    await page.getByTestId('saas-pay-wallet-dropship_growth_monthly').click();
    await expect(page.getByTestId('saas-sub-notice')).toContainText('Subscription active', { timeout: 20_000 });
  } finally {
    await a.from('saas_plans').update({ active: false }).eq('code', 'dropship_growth_monthly');
  }
});

test('4. Finance screens: Payment settings matrix, Credit terms, Receivables & ageing, and Reports by division Held sub-line', async ({ browser }) => {
  const finCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fp = await finCtx.newPage();
  await staffLogin(fp, finMaker!, '/admin/settings/payment');

  await fp.goto('/admin/settings/payment');
  await expect(fp.getByTestId('service-payment-option-matrix')).toBeVisible();
  await expect(fp.getByTestId('surcharge-compliance-warning')).toContainText(
    'Card surcharges are restricted in some countries and by card network rules. Check with the provider before switching on.',
  );
  await expect(fp.getByTestId('legal-entity-SZ-OCTOPUS')).toContainText('Shenzhen Octopus Trading Co., Ltd.');

  await fp.goto('/admin/finance/credit');
  await expect(fp.getByTestId('finance-credit-page')).toBeVisible();
  await expect(fp.getByTestId('credit-terms-list')).toContainText('TEST · e2e payments 3 options');

  await fp.goto('/admin/finance/receivables');
  await expect(fp.getByTestId('finance-receivables-page')).toBeVisible();
  await expect(fp.getByTestId('receivables-ageing-buckets')).toBeVisible();

  await fp.goto('/admin/reports/divisions?test=1');
  await expect(fp.getByTestId('division-report')).toContainText('Held (payment protection)');
  await expect(fp.getByTestId('held-protection-total')).toBeVisible();

  await finCtx.close();
});

test('5. S0-fix · Non-eligible customer never sees Pay later card or "Ask your account manager" copy; Admin can toggle credit_eligible with reason', async ({ page, browser }) => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingOrThrow(db);
    await db.query('begin');
    await db.query(`select set_config('octopus.allow_credit_eligible_write', 'true', true)`);
    await db.query(`update organizations set credit_eligible = false where id = $1`, [cust!.orgId]);
    await db.query('commit');
  } finally {
    await db.end();
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  // Create a fresh deposit_pending order to inspect ChooseHowToPay when credit_eligible = false
  const a = adminClient();
  const { data: divSRC } = await a.from('divisions').select('id').eq('code', 'SRC').single();
  const { data: ordRow } = await a
    .from('orders')
    .insert({
      org_id: cust!.orgId,
      division_id: divSRC!.id,
      status: 'deposit_pending',
      title: 'TEST · Non-eligible Pay Later Check',
      quantity: 10,
      unit_price_cents: 500,
      shipping_cents: 0,
      total_cents: 5000,
      deposit_pct: 100,
      deposit_cents: 5000,
      paid_cents: 0,
      currency: 'USD',
      is_seed: true,
    })
    .select('id')
    .single();

  await customerLogin(page, cust!, `/account/orders/${ordRow!.id}`);
  await page.goto(`/account/orders/${ordRow!.id}`);

  await expect(page.getByTestId('choose-how-to-pay')).toBeVisible();
  await expect(page.getByTestId('option-card-pay_now')).toBeVisible();
  await expect(page.getByTestId('option-card-payment_protection')).toBeVisible();
  await expect(page.getByTestId('option-card-pay_later')).toHaveCount(0);
  expect(await page.getByTestId('choose-how-to-pay').innerText()).not.toMatch(/Ask your account manager to set up credit/i);

  // Admin toggles credit_eligible back ON from /admin/customers/[id] with a required reason
  const adminStaff = await createTempStaff('admin');
  const admCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const ap = await admCtx.newPage();
    await staffLogin(ap, adminStaff, `/admin/customers/${cust!.orgId}`);
    await ap.goto(`/admin/customers/${cust!.orgId}`);
    await expect(ap.getByTestId('org-credit-eligible-card')).toBeVisible();
    await ap.getByTestId('credit-eligible-reason-input').fill('Approved for Net 30 testing');
    await ap.getByTestId('credit-eligible-toggle-btn').click();
    await expect(ap.getByTestId('credit-eligible-notice')).toContainText('Pay later credit eligibility enabled', { timeout: 15_000 });
  } finally {
    await admCtx.close();
    await deleteTempStaff(adminStaff);
  }
});
