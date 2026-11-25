import { test, expect } from '@playwright/test';
import {
  adminClient,
  createTempCustomer,
  customerLogin,
  pgClient,
  type TempCustomer,
} from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Batch 2 E2E (F-03) — Dropship store_order checkout via Pay now and Payment protection (STAGING ONLY).
 * Uses partner_supplier / extended_catalog (zero append-only 3PL warehouse_stock writes, 100% clean teardown).
 * Verifies:
 *  1. Pay now on a dropship store_order through /pay/mock/[id] UI:
 *     - redirects to /account/dropship/orders and displays the order in Processing
 *     - sets payment_checkouts.store_order_id = so.id (order_id = null, status = 'paid')
 *     - marks store_orders.payment_state = 'paid', escrow_hold_id = null, staff_stage = 'sourcing',
 *       creates sourcing_procurement handoff (status = 'ordered_from_supplier'), posts balanced DS revenue journal
 *  2. Payment protection on a dropship store_order through /pay/mock/[id] UI:
 *     - redirects to /account/dropship/orders and displays the order in Processing
 *     - creates escrow_holds with store_order_id = so.id, order_id = null, status = 'held', release_rule = 'delivery_plus_days'
 *     - links store_orders.payment_state = 'held' and store_orders.escrow_hold_id = hold.id
 *     - Finance staff (aal2) opening /admin/finance/holds sees the DSO-... order number without PGRST201 errors
 */

test.describe.configure({ mode: 'serial' });

let merchant: TempCustomer | null = null;
let finStaff: TempStaff | null = null;

let prodId: string | null = null;
let varId: string | null = null;
let itemId: string | null = null;

let soPayNowId = '';
let soPayNowNumber = '';
let chkPayNowId = '';

let soProtId = '';
let soProtNumber = '';
let chkProtId = '';

test.beforeAll(async () => {
  await assertStagingOrThrow();
  merchant = await createTempCustomer('b2e2e');
  finStaff = await createTempStaff('finance');

  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');

    await db.query(
      `insert into company_services (org_id, service, status)
       values ($1, 'dropship', 'on')
       on conflict (org_id, service) do update set status = 'on'`,
      [merchant.orgId],
    );
    await db.query(
      `insert into dropship_markets (org_id, country, locked_by_staff)
       values ($1, 'AE', false)
       on conflict (org_id, country) do nothing`,
      [merchant.orgId],
    );
    await db.query(
      `insert into dropship_seller_profiles (org_id, brand_name, return_name, return_line1, return_city, return_country, status)
       values ($1, 'B2 E2E Studio', 'Returns Desk', '100 Al Wasl Rd', 'Dubai', 'AE', 'approved')`,
      [merchant.orgId],
    );

    const validSp = (
      await db.query(
        `select sp.id from supplier_products sp join suppliers s on s.id = sp.supplier_id where s.verified and s.archived_at is null limit 1`,
      )
    ).rows[0].id as string;

    const prod = (
      await db.query(
        `insert into dropship_products (title, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, visible_to_org_id, product_price_cents, origin_country, status)
         values ('B2 E2E Extended Kettle', 500, '{"l":20,"w":15,"h":10}'::jsonb, 1, 'partner_supplier', 'extended_catalog', $1, 1200, 'CN', 'active')
         returning id`,
        [merchant.orgId],
      )
    ).rows[0] as { id: string };
    prodId = prod.id;

    const variant = (
      await db.query(
        `insert into dropship_variants (product_id, supplier_product_id, options, price_adjust_cents, sort)
         values ($1, $2, '{"Colour":"Ink Black"}'::jsonb, 0, 0)
         returning id, item_id`,
        [prodId, validSp],
      )
    ).rows[0] as { id: string; item_id: string };
    varId = variant.id;
    itemId = variant.item_id;

    await db.query(`update item_master set hs_code = '851679', hs_code_source = 'manual' where id = $1`, [itemId]);
    await db.query(
      `insert into dropship_routes (product_id, destination_country, shipping_method, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, is_active)
       values ($1, 'AE', 'express', 2400, 600, 120, 4, 7, true)`,
      [prodId],
    );

    // Switch session to the temp merchant to create 2 unpaid store orders + 2 Mock checkouts
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: merchant.id, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.query('set local role authenticated');

    const linesJson = JSON.stringify([{ variant_id: varId, qty: 2, buyer_unit_price_cents: 1500 }]);
    const createOrder = async (extId: string) => {
      const r = (
        await db.query(
          `select create_dropship_store_order(
             $1, 'shopify', $2, '#' || $2, 'E2E Buyer', '+971500000100',
             '{"line1":"100 Al Wasl Rd","city":"Dubai","postal_code":"00000","country":"AE"}'::jsonb,
             'AE', 'USD', null, 'express', 'DDP', $3::jsonb, true
           ) r`,
          [merchant!.orgId, extId, linesJson],
        )
      ).rows[0].r as { store_order_id: string; quote: { total_cents: number } };
      return r;
    };

    const so1 = await createOrder(`B2-E2E-PN-${Date.now()}`);
    const so2 = await createOrder(`B2-E2E-PROT-${Date.now()}`);
    soPayNowId = so1.store_order_id;
    soProtId = so2.store_order_id;

    const chk1 = (
      await db.query(
        `select create_payment_checkout($1, 'dropship', 'pay_now', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, $4) r`,
        [merchant.orgId, soPayNowId, so1.quote.total_cents, `b2_e2e_pn_${soPayNowId}`],
      )
    ).rows[0].r as { checkout_id: string };
    chkPayNowId = chk1.checkout_id;

    const chk2 = (
      await db.query(
        `select create_payment_checkout($1, 'dropship', 'payment_protection', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, $4) r`,
        [merchant.orgId, soProtId, so2.quote.total_cents, `b2_e2e_prot_${soProtId}`],
      )
    ).rows[0].r as { checkout_id: string };
    chkProtId = chk2.checkout_id;

    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', '', true)`);

    const rows = (
      await db.query(`select id, order_number from store_orders where id = any($1)`, [[soPayNowId, soProtId]])
    ).rows as Array<{ id: string; order_number: string }>;
    soPayNowNumber = rows.find((r) => r.id === soPayNowId)!.order_number;
    soProtNumber = rows.find((r) => r.id === soProtId)!.order_number;

    await db.query('commit');
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');

    if (merchant) {
      const org = merchant.orgId;
      const soIds = [soPayNowId, soProtId].filter(Boolean);

      const js = (
        await db.query(
          `select distinct j.id
             from journals j
             left join ledger_entries le on le.journal_id = j.id
             left join ledger_accounts la on la.id = le.account_id
            where la.org_id = $1
               or j.idempotency_key like '%' || $1::text || '%'
               or (j.ref_type = 'store_order' and j.ref_id = any($2::uuid[]))
               or (j.ref_type = 'wallet_hold' and j.ref_id in (select id from escrow_holds where org_id = $1))
               or (j.ref_type = 'payment' and j.ref_id in (select id from payment_checkouts where org_id = $1))
               or (j.ref_type = 'document' and j.ref_id in (select id from documents where org_id = $1))`,
          [org, soIds],
        )
      ).rows.map((r) => r.id as string);

      await db.query(`delete from payment_reconciliation_alerts where checkout_id in (select id from payment_checkouts where org_id = $1)`, [org]);
      await db.query(`delete from payment_settlements where checkout_id in (select id from payment_checkouts where org_id = $1)`, [org]);
      await db.query(`delete from payment_webhook_events where checkout_id in (select id from payment_checkouts where org_id = $1)`, [org]);
      await db.query(`delete from escrow_hold_approvals where hold_id in (select id from escrow_holds where org_id = $1)`, [org]);
      await db.query(`delete from escrow_hold_events where org_id = $1`, [org]);

      if (soIds.length > 0) {
        await db.query(`update store_orders set escrow_hold_id = null, wallet_hold_id = null where id = any($1::uuid[])`, [soIds]);
        await db.query(`delete from dropship_handoffs where store_order_id = any($1::uuid[])`, [soIds]);
        await db.query(`delete from domain_event_consumptions where event_id in (select id from domain_events where aggregate_id = any($1::uuid[]))`, [soIds]);
        await db.query(`delete from domain_events where aggregate_id = any($1::uuid[])`, [soIds]);
        await db.query(`delete from store_order_items where store_order_id = any($1::uuid[])`, [soIds]);
      }

      await db.query(`delete from payment_checkouts where org_id = $1`, [org]);
      await db.query(`delete from escrow_holds where org_id = $1`, [org]);
      await db.query(`delete from store_orders where org_id = $1`, [org]);
      await db.query(`delete from notifications where org_id = $1`, [org]);
      if (js.length > 0) {
        await db.query(`delete from ledger_entries where journal_id = any($1::uuid[])`, [js]);
        await db.query(`delete from journals where id = any($1::uuid[])`, [js]);
      }
      await db.query(`delete from dropship_seller_profiles where org_id = $1`, [org]);
      await db.query(`delete from dropship_markets where org_id = $1`, [org]);
      await db.query(`delete from company_services where org_id = $1`, [org]);
      await db.query(`delete from ledger_accounts where org_id = $1`, [org]);
      await db.query(`delete from org_members where org_id = $1`, [org]);
      await db.query(`delete from organizations where id = $1`, [org]);
    }

    if (prodId) {
      await db.query(`delete from dropship_routes where product_id = $1`, [prodId]);
      await db.query(`delete from dropship_variants where product_id = $1`, [prodId]);
      await db.query(`delete from dropship_products where id = $1`, [prodId]);
    }
    if (itemId) {
      await db.query(`delete from item_master where id = $1`, [itemId]);
    }

    await db.query('commit');
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }

  if (merchant) {
    await adminClient().auth.admin.deleteUser(merchant.id);
  }
  await deleteTempStaff(finStaff);
});

test('1. Dropship store_order · Pay now via Mock aggregator UI sets paid + sourcing handoff', async ({ page }) => {
  await customerLogin(page, merchant!, `/pay/mock/${chkPayNowId}`);
  await expect(page.getByTestId('mock-checkout-page')).toBeVisible();
  await expect(page.getByTestId('mock-checkout-option')).toContainText(/pay now/i);

  await page.getByTestId('mock-pay-confirm-btn').click();
  await page.waitForURL('**/account/dropship/orders', { timeout: 20_000 });
  await expect(page.getByTestId('dropship-orders-page')).toBeVisible();

  const row = page.getByTestId(`merchant-order-row-${soPayNowNumber}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(/processing/i);

  const db = pgClient();
  await db.connect();
  try {
    const chk = (
      await db.query(`select status, order_id, store_order_id, hold_id from payment_checkouts where id = $1`, [chkPayNowId])
    ).rows[0];
    const so = (
      await db.query(`select payment_state, escrow_hold_id, staff_stage, merchant_status from store_orders where id = $1`, [soPayNowId])
    ).rows[0];
    const ho = (await db.query(`select handoff_type, status from dropship_handoffs where store_order_id = $1`, [soPayNowId])).rows[0];
    const jRows = (await db.query(`select id, stream from journals where ref_type = 'store_order' and ref_id = $1`, [soPayNowId])).rows;

    expect(chk.status).toBe('paid');
    expect(chk.order_id).toBeNull();
    expect(chk.store_order_id).toBe(soPayNowId);
    expect(chk.hold_id).toBeNull();
    expect(so.payment_state).toBe('paid');
    expect(so.escrow_hold_id).toBeNull();
    expect(so.staff_stage).toBe('sourcing');
    expect(so.merchant_status).toBe('processing');
    expect(ho?.handoff_type).toBe('sourcing_procurement');
    expect(ho?.status).toBe('ordered_from_supplier');
    expect(jRows).toHaveLength(1);
    expect(jRows[0].stream).toBe('dropship');
  } finally {
    await db.end();
  }
});

test('2. Dropship store_order · Payment protection via Mock UI + Finance holds visibility', async ({ page, browser }) => {
  await customerLogin(page, merchant!, `/pay/mock/${chkProtId}`);
  await expect(page.getByTestId('mock-checkout-page')).toBeVisible();
  await expect(page.getByTestId('mock-checkout-option')).toContainText(/payment protection/i);

  await page.getByTestId('mock-pay-confirm-btn').click();
  await page.waitForURL('**/account/dropship/orders', { timeout: 20_000 });
  await expect(page.getByTestId('dropship-orders-page')).toBeVisible();

  const row = page.getByTestId(`merchant-order-row-${soProtNumber}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(/processing/i);

  const db = pgClient();
  await db.connect();
  try {
    const chk = (
      await db.query(`select status, order_id, store_order_id, hold_id from payment_checkouts where id = $1`, [chkProtId])
    ).rows[0];
    const eh = (
      await db.query(`select id, order_id, store_order_id, status, release_rule, auto_release_days, funding_method from escrow_holds where id = $1`, [
        chk.hold_id,
      ])
    ).rows[0];
    const so = (
      await db.query(`select payment_state, escrow_hold_id, staff_stage, merchant_status from store_orders where id = $1`, [soProtId])
    ).rows[0];
    const ho = (await db.query(`select handoff_type, status from dropship_handoffs where store_order_id = $1`, [soProtId])).rows[0];

    expect(chk.status).toBe('paid');
    expect(chk.order_id).toBeNull();
    expect(chk.store_order_id).toBe(soProtId);
    expect(chk.hold_id).toBeTruthy();
    expect(eh.store_order_id).toBe(soProtId);
    expect(eh.order_id).toBeNull();
    expect(eh.status).toBe('held');
    expect(eh.release_rule).toBe('delivery_plus_days');
    expect(eh.auto_release_days).toBe(7);
    expect(eh.funding_method).toBe('aggregator');
    expect(so.payment_state).toBe('held');
    expect(so.escrow_hold_id).toBe(eh.id);
    expect(so.staff_stage).toBe('sourcing');
    expect(so.merchant_status).toBe('processing');
    expect(ho?.handoff_type).toBe('sourcing_procurement');
    expect(ho?.status).toBe('ordered_from_supplier');
  } finally {
    await db.end();
  }

  // Finance staff (aal2) opens /admin/finance/holds and sees the DSO-... order number without PGRST201 errors
  const finCtx = await browser.newContext();
  const finPage = await finCtx.newPage();
  const consoleErrors: string[] = [];
  finPage.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  try {
    await staffLogin(finPage, finStaff!, '/admin/finance/holds');
    await expect(finPage.getByTestId('finance-holds-page')).toBeVisible();
    await expect(finPage.getByTestId('finance-holds-page')).toContainText(soProtNumber);
    expect(consoleErrors).toEqual([]);
  } finally {
    await finCtx.close();
  }
});
