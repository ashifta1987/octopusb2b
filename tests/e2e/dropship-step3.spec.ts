import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  adminClient,
  createTempCustomer,
  customerLogin,
  pgClient,
  purgeTestOrgs,
  type TempCustomer,
} from './helpers/customer';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Step 3 E2E — Merchant catalogue, product detail, landed cost, free product requests, and sample orders (STAGING ONLY).
 * Verifies:
 *  1. All 5 Step 3 screens (/catalogue, /catalogue/[id], /landed-cost, /requests, /sample) pass axe (0 serious/critical),
 *     have 0 horizontal overflow at 1280px & 390px, and keep the 2nd mobile tab ("Find") active (aria-current="page").
 *  2. Catalogue & Product Detail: 4-part split, stock labels ONLY (never numbers), volume price tiers, battery flag note,
 *     "Only for you" private product with real RFQ code ("Sourced from your request RFQ-..."), zero "SR-" anywhere,
 *     and "Make it your brand" linking to /request/brand?model=DS-... prefilled with the DS model no.
 *  3. Landed Cost Calculator: server-computed multi-unit combined parcel quote + "Combined parcel saves $..." notice.
 *  4. Free Product Requests: charges $0 (even though Sourcing RFQ is $5), shows real RFQ-... code, quote -> Accept creates
 *     private DS-XXXXXX draft visible only to this merchant.
 *  5. Sample Orders: refuses DDP with missing duty ("Duties for this country aren't set yet, choose another country or method"),
 *     ignores credit limit when wallet cash is short ("Not enough in your wallet" + Add funds), and when wallet cash is funded
 *     creates store_orders (kind='sample') + store_order_items (declared_usd_cents = sample product price paid).
 */

const SHOTS = process.env.SHOTS_DIR;
let merchant: TempCustomer | null = null;
let privateProductId: string | null = null;
let privateItemId: string | null = null;
let privateRfqId: string | null = null;
let privateRfqCode: string | null = null;
let sampleProductId: string | null = null;
let sampleVariantId: string | null = null;
let sampleItemId: string | null = null;
let createdDeRateCardId: string | null = null;
const createdDraftProductIds: string[] = [];

test.describe.configure({ mode: 'serial' });

async function checkAxe(page: Page, label: string) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const bad = res.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    bad,
    `${label} had serious/critical axe violations: ${JSON.stringify(
      bad.map((b) => ({ id: b.id, impact: b.impact, nodes: b.nodes.length })),
    )}`,
  ).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  merchant = await createTempCustomer('step3');

  const db = pgClient();
  await db.connect();
  try {
    await assertStagingOrThrow(db);

    // Enable dropship='on' and selling countries AE, DE, SA for our temp merchant
    await db.query(
      `insert into company_services (org_id, service, status)
       values ($1, 'dropship', 'on')
       on conflict (org_id, service) do update set status = 'on'`,
      [merchant.orgId],
    );
    for (const c of ['AE', 'DE', 'SA']) {
      await db.query(
        `insert into dropship_markets (org_id, country, locked_by_staff)
         values ($1, $2, false)
         on conflict (org_id, country) do nothing`,
        [merchant.orgId, c],
      );
    }

    // Give merchant $4.30 (430¢) wallet cash + $500 wallet_credit_limits to verify credit limit is ignored on SampleOrder!
    await db.query(
      `select post_journal('Step 3 E2E initial $4.30 cash', jsonb_build_array(
         jsonb_build_object('account', ledger_account(acct_code('bank:clearing', 'USD'), 'Clearing', 'asset', null, 'USD'), 'debit', 430, 'credit', 0),
         jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 430, 'org', $1)
       ), $2, 'topup', 'organization', $1)`,
      [merchant.orgId, `s3_e2e_init_${merchant.orgId}`],
    );
    await db.query(
      `insert into wallet_credit_limits (org_id, limit_minor, currency, note)
       values ($1, 50000, 'USD', 'Step 3 E2E credit limit ignored for samples')
       on conflict (org_id) do update set limit_minor = 50000`,
      [merchant.orgId],
    );

    // Ensure DE has an active standard shipping rate card (while DE has NO duty_rate_entries, to test DDP duty unknown refusal!)
    const deRc = await db.query(
      `select id from shipping_rate_cards where country = 'DE' and method = 'standard' and active limit 1`,
    );
    if (deRc.rows.length === 0) {
      const insRc = await db.query(
        `insert into shipping_rate_cards (
           carrier_code, method, carrier_service_code, service_label, country,
           base_cents, per_100g_cents, step_g, max_weight_g, volumetric_divisor,
           days_min, days_max, allows_battery, active, division_id
         ) values (
           'yunexpress', 'standard', 'DE-S3-E2E', 'DE Standard E2E', 'DE',
           420, 80, 100, 30000, 5000, 6, 10, true, true, division_id_of('DS')
         ) returning id`,
      );
      createdDeRateCardId = insRc.rows[0].id as string;
    }

    // Create a dedicated Step 3 sample & tier & battery product (visible_to_org_id = merchant.orgId so other tests are untouched!)
    const opsStaff = (
      await db.query(`select user_id from user_roles where role_code = 'operations' limit 1`)
    ).rows[0].user_id as string;
    await db.query(
      `insert into division_members (user_id, division_id, role)
       values ($1, division_id_of('DS'), 'staff')
       on conflict (user_id, division_id) do nothing`,
      [opsStaff],
    );

    const validSp = (
      await db.query(
        `select sp.id from supplier_products sp join suppliers s on s.id = sp.supplier_id where s.verified and s.archived_at is null limit 1`,
      )
    ).rows[0].id as string;

    // Create real RFQ for "Sourced from your request RFQ-..."
    const rfqIns = (
      await db.query(
        `insert into rfqs (org_id, title, details, quantity, unit, destination_country, incoterm, status, fee_minor, currency, expires_at, created_by, division_id)
         values ($1, 'Foldable pet crate', '[Dropship product request]', 100, 'pcs', 'AE', 'DDP', 'accepted', 0, 'USD', now() + interval '14 days', $2, division_id_of('SRC'))
         returning id, code`,
        [merchant.orgId, merchant.id],
      )
    ).rows[0];
    privateRfqId = rfqIns.id as string;
    privateRfqCode = rfqIns.code as string;

    const prodIns = (
      await db.query(
        `insert into dropship_products (
           octopus_sku, title, description, category, images, source_type, fulfilment_type,
           visible_to_org_id, sourced_from_rfq_id, product_price_cents, status, created_by
         ) values (
           $1, 'Foldable pet crate', 'Heavy-duty foldable crate with travel handle.', 'Pets',
           array['https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=600&q=80'],
           'partner_supplier', 'extended_catalog', $2, $3, 1240, 'draft', $4
         ) returning id`,
        [`DS-S3-E2E-${Date.now()}`, merchant.orgId, privateRfqId, opsStaff],
      )
    ).rows[0];
    privateProductId = prodIns.id as string;
    sampleProductId = privateProductId;

    const varIns = (
      await db.query(
        `insert into dropship_variants (product_id, options, supplier_product_id, price_adjust_cents, sort)
         values ($1, '{"Colour":"White"}'::jsonb, $2, 0, 0)
         returning id, item_id`,
        [privateProductId, validSp],
      )
    ).rows[0];
    sampleVariantId = varIns.id as string;
    privateItemId = varIns.item_id as string;
    sampleItemId = privateItemId;

    // Set volume tiers on this product (1–9: $12.40, 10+: $11.40)
    await db.query(
      `insert into dropship_price_tiers (product_id, min_qty, unit_price_cents, currency)
       values ($1, 1, 1240, 'USD'), ($1, 10, 1140, 'USD')`,
      [privateProductId],
    );

    // Add AE routes (express & standard DDP) — publish first, then add DE DDP route (no duty in DE) to test sample DDP refusal!
    await db.query(
      `insert into dropship_routes (product_id, destination_country, shipping_method, incoterm, landed_price_cents, est_days_min, est_days_max, is_active)
       values ($1, 'AE', 'express', 'DDP', 1970, 3, 6, true),
              ($1, 'AE', 'standard', 'DDP', 1820, 5, 9, true)`,
      [privateProductId],
    );

    await db.query('begin');
    await db.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: opsStaff, role: 'authenticated', aal: 'aal2' })],
    );
    await db.query(
      `select update_dropship_item_master($1, '6912.00', 'CN', 520, 22, 18, 12, true, false, false, false, false)`,
      [privateItemId],
    );
    await db.query(`select verify_item_hs_code($1, '6912.00', 'Step 3 E2E verified')`, [privateItemId]);
    await db.query(`select publish_dropship_product($1)`, [privateProductId]);
    await db.query(`select set_config('request.jwt.claims', '', true)`);
    await db.query('commit');

    // Add DE standard DDP route (no DE tariff entry exists -> duties_status = 'not_known_yet')
    await db.query(
      `insert into dropship_routes (product_id, destination_country, shipping_method, incoterm, landed_price_cents, est_days_min, est_days_max, is_active)
       values ($1, 'DE', 'standard', 'DDP', 2100, 6, 10, true)`,
      [privateProductId],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingOrThrow(db);

    if (merchant) {
      // Find any sample store_orders created for merchant to clean domain events
      const sos = (
        await db.query(
          `select id from store_orders where org_id = $1`,
          [merchant.orgId],
        )
      ).rows;
      for (const so of sos) {
        await db.query(
          `delete from domain_events where aggregate_type = 'store_order' and aggregate_id = $1`,
          [so.id],
        );
      }

      // Collect any private dropship products created for merchant (including accepted request drafts)
      const privProds = (
        await db.query(
          `select id from dropship_products where visible_to_org_id = $1`,
          [merchant.orgId],
        )
      ).rows.map((r) => r.id as string);
      const allProdIds = Array.from(
        new Set([...privProds, ...createdDraftProductIds, ...(privateProductId ? [privateProductId] : [])]),
      );

      if (allProdIds.length > 0) {
        const varItems = (
          await db.query(
            `select item_id from dropship_variants where product_id = any($1) and item_id is not null`,
            [allProdIds],
          )
        ).rows.map((r) => r.item_id as string);

        // Delete statements & store_orders first so FKs are cleared
        await db.query(`delete from documents where org_id = $1`, [merchant.orgId]);
        await db.query(`delete from store_orders where org_id = $1`, [merchant.orgId]);
        await db.query(`delete from dropship_products where id = any($1)`, [allProdIds]);

        if (varItems.length > 0) {
          await db.query(`delete from warehouse_stock where item_id = any($1)`, [varItems]);
          await db.query(`delete from item_master where id = any($1)`, [varItems]);
        }
      }
    }

    if (createdDeRateCardId) {
      await db.query(`delete from shipping_rate_cards where id = $1 and used_count = 0`, [
        createdDeRateCardId,
      ]);
    }
  } finally {
    await db.end();
  }

  if (merchant) {
    await purgeTestOrgs([merchant.orgId], [merchant.id]);
  }
});

test('all 5 Step 3 screens: 1280px & 390px axe clean, 0 overflow, 2nd mobile tab "Find" active, stock labels only, zero SR-, Make it your brand link', async ({
  page,
}) => {
  await customerLogin(page, merchant!, '/account/dropship/catalogue?country=AE');

  const routesToCheck: [string, string][] = [
    ['/account/dropship/catalogue?country=AE', 'Find products'],
    [`/account/dropship/catalogue/${privateProductId}?country=AE`, 'Foldable pet crate'],
    [`/account/dropship/landed-cost?product=${privateProductId}&country=AE`, 'Landed cost calculator'],
    ['/account/dropship/requests', 'Request a product'],
    [`/account/dropship/sample?product=${privateProductId}&country=AE`, 'Order a sample'],
  ];

  for (const [route, heading] of routesToCheck) {
    // Desktop 1280px
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(route);
    await expect(page.getByTestId('dropship-merchant-shell')).toBeVisible();
    await expect(page.locator('h1')).toContainText(heading);
    await expect(
      page.getByTestId('dropship-sidebar').getByRole('link', { name: 'Find products' }),
    ).toHaveAttribute('aria-current', 'page');
    await checkAxe(page, `${heading}-1280`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${route} at 1280px must not overflow horizontally`,
    ).toBe(true);
    const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/step3-${slug}-1280.png`, fullPage: true });
    const html = await page.content();
    expect(html).not.toMatch(/\bSR-\d+/i);

    // Mobile 390px — 2nd mobile tab "Find" MUST be active on all 5 screens
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.locator('h1')).toContainText(heading);
    const findTab = page
      .getByTestId('dropship-phone-tabs')
      .getByRole('link', { name: 'Find' });
    await expect(findTab).toHaveAttribute('aria-current', 'page');
    await checkAxe(page, `${heading}-390`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${route} at 390px must not overflow horizontally`,
    ).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/step3-${slug}-390.png`, fullPage: true });
  }

  // Verify "Only for you" filter chip, real RFQ code ("Sourced from your request RFQ-..."), battery note, and stock label ONLY
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/account/dropship/catalogue?country=AE&only=1');
  const onlyCards = page.getByTestId('catalogue-card');
  await expect(onlyCards).toHaveCount(1);
  await expect(onlyCards.first().getByTestId('badge-only-for-you')).toHaveText('Only for you');
  await expect(onlyCards.first().getByTestId('sourced-from-rfq')).toContainText(
    `Sourced from your request ${privateRfqCode}`,
  );
  await expect(onlyCards.first().getByTestId('battery-service-note')).toContainText(
    'Contains a battery: only battery-approved services',
  );

  // Verify Product Detail volume tiers, stock label ONLY (never stock numbers like "15 in stock"), and Make it your brand link
  await page.goto(`/account/dropship/catalogue/${privateProductId}?country=AE`);
  await expect(page.getByTestId('product-stock-status')).toHaveText('Extended');
  await expect(page.getByTestId('hs-verified-badge')).toHaveText('HS code checked');
  await expect(page.getByTestId('volume-tiers-section')).toContainText('1–9');
  await expect(page.getByTestId('volume-tiers-section')).toContainText('US$ 12.40');
  await expect(page.getByTestId('volume-tiers-section')).toContainText('10 or more');
  await expect(page.getByTestId('volume-tiers-section')).toContainText('US$ 11.40');

  // Click "Make it your brand" -> opens /request/brand prefilled with DS-XXXXXX model no.
  await page.getByTestId('make-it-your-brand').getByRole('link').click();
  await expect(page).toHaveURL(/\/request\/brand\?model=DS-\d{6}/);
  await expect(page.getByTestId('brand-ds-model-banner')).toContainText(/DS-\d{6}/);
});

test('Landed cost calculator: 2-unit combined parcel processing & shipping savings vs 2 separate orders', async ({
  page,
}) => {
  await customerLogin(
    page,
    merchant!,
    `/account/dropship/landed-cost?product=${privateProductId}&country=AE&qty=2`,
  );
  await page.goto(
    `/account/dropship/landed-cost?product=${privateProductId}&country=AE&qty=2`,
  );

  await expect(page.getByTestId('lc-product-cents')).toHaveText('US$ 24.80');
  await expect(page.getByTestId('lc-processing-cents')).toHaveText('US$ 1.60');
  await expect(page.getByTestId('combined-parcel-savings')).toContainText(
    /Combined parcel saves US\$ \d+\.\d{2}/,
  );
  await expect(page.getByTestId('other-countries-table')).toContainText(
    'United Arab Emirates',
  );
});

test('Request a product: free request ($0 charged), real RFQ code, staff landed quote -> merchant Accept creates private DS-XXXXXX draft', async ({
  page,
}) => {
  await customerLogin(page, merchant!, '/account/dropship/requests');
  await page.goto('/account/dropship/requests');

  await expect(page.getByTestId('dropship-request-fee-badge')).toHaveText('Free request');

  await page.getByTestId('req-title-input').fill('Silicone baking mats E2E');
  await page.getByTestId('req-target-input').fill('6.00');
  await page.getByTestId('req-notes-input').fill('Set of 2 food-grade mats');
  await page.getByTestId('send-request-btn').click();

  await expect(page.getByTestId('request-success-notice')).toContainText(/RFQ-\d+/);
  await expect(page.getByTestId('request-success-notice')).not.toContainText('SR-');

  const row = page.getByTestId('request-row').filter({ hasText: 'Silicone baking mats E2E' });
  await expect(row).toBeVisible();
  const rfqCode = (await row.getByTestId('request-rfq-code').innerText()).trim();
  expect(rfqCode).toMatch(/^RFQ-/);

  // Quote the request via set_dropship_request_landed_quote (service role)
  const admin = adminClient();
  const { data: rfqRow } = await admin
    .from('rfqs')
    .select('id')
    .eq('code', rfqCode)
    .single();
  const { error: qErr } = await admin.rpc('set_dropship_request_landed_quote', {
    p_rfq_id: rfqRow!.id,
    p_landed_cents: 1650,
    p_country: 'AE',
  });
  expect(qErr).toBeNull();

  // Reload and click Accept -> creates private DS-XXXXXX draft
  await page.reload();
  const quotedRow = page
    .getByTestId('request-row')
    .filter({ hasText: 'Silicone baking mats E2E' });
  await expect(quotedRow).toContainText('Landed US$ 16.50 to United Arab Emirates');
  await quotedRow.getByTestId('accept-request-quote').click();

  await expect(quotedRow.getByTestId('request-draft-model')).toContainText(
    /DS-\d{6}.*only for you/,
  );
});

test('Sample order: wallet-short ($4.30 cash, $500 credit ignored) & DDP-duty-unknown refused; funded wallet pays sample (kind=sample)', async ({
  page,
}) => {
  await customerLogin(
    page,
    merchant!,
    `/account/dropship/sample?product=${sampleProductId}&variant=${sampleVariantId}&country=AE&method=express`,
  );
  await page.goto(
    `/account/dropship/sample?product=${sampleProductId}&variant=${sampleVariantId}&country=AE&method=express`,
  );

  // 1. Wallet cash is $4.30 (< total, even though org has $500 credit limit!) -> disabled + "Not enough in your wallet" + Add funds link
  await expect(page.getByTestId('sample-wallet-short-notice')).toContainText(
    'You have US$ 4.30.',
  );
  await expect(page.getByTestId('sample-add-funds-link')).toHaveAttribute(
    'href',
    '/account/dropship/wallet',
  );
  await expect(page.getByTestId('sample-pay-btn')).toBeDisabled();

  // 2. Switch country to Germany (DE, DDP with unknown duty) -> exact refusal message!
  await page.getByTestId('sample-country-select').selectOption('DE');
  await expect(page.getByTestId('sample-duties-missing-notice')).toContainText(
    "Duties for this country aren't set yet, choose another country or method",
  );
  await expect(page.getByTestId('sample-pay-btn')).toBeDisabled();

  // 3. Top up merchant wallet cash with $45.70 (bringing cash to $50.00), switch back to AE, fill address, and pay!
  const db = pgClient();
  await db.connect();
  try {
    await db.query(
      `select post_journal('Step 3 E2E topup $45.70', jsonb_build_array(
         jsonb_build_object('account', ledger_account(acct_code('bank:clearing', 'USD'), 'Clearing', 'asset', null, 'USD'), 'debit', 4570, 'credit', 0),
         jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 4570, 'org', $1)
       ), $2, 'topup', 'organization', $1)`,
      [merchant!.orgId, `s3_e2e_topup2_${merchant!.orgId}`],
    );
  } finally {
    await db.end();
  }

  await page.goto(
    `/account/dropship/sample?product=${sampleProductId}&variant=${sampleVariantId}&country=AE&method=standard`,
  );
  await page.getByTestId('sample-name-input').fill('Anna K.');
  await page.getByTestId('sample-phone-input').fill('+971501234567');
  await page.getByTestId('sample-address-input').fill('Marina Promenade 14');
  await page.getByTestId('sample-city-input').fill('Dubai');

  await expect(page.getByTestId('sample-pay-btn')).toBeEnabled();
  await page.getByTestId('sample-pay-btn').click();

  await expect(page.getByTestId('sample-order-paid-notice')).toContainText(/DSO-\d+/);
  await expect(page.getByTestId('recent-sample-row').first()).toContainText(/DSO-\d+/);

  // Verify DB row: store_orders.kind = 'sample', channel = 'manual', payment_state = 'paid', declared_usd_cents = product_cents
  const admin = adminClient();
  const { data: so } = await admin
    .from('store_orders')
    .select('id, kind, channel, payment_state, product_cents, processing_cents, escrow_hold_id, wallet_hold_id')
    .eq('org_id', merchant!.orgId)
    .single();
  expect(so?.kind).toBe('sample');
  expect(so?.channel).toBe('manual');
  expect(so?.payment_state).toBe('paid');
  expect(Number(so?.processing_cents)).toBeGreaterThan(0);
  expect(so?.escrow_hold_id).toBeNull();
  expect(so?.wallet_hold_id).toBeNull();

  const { data: soi } = await admin
    .from('store_order_items')
    .select('qty, line_product_cents, declared_usd_cents')
    .eq('store_order_id', so!.id)
    .single();
  expect(Number(soi?.declared_usd_cents)).toBe(Number(so?.product_cents));

  // 4. Follow-up 2: Generate weekly STMT-DS statement and verify sample charge appears on /account/invoices & /api/documents/[id]/pdf under SZ-OCTOPUS!
  const dbStmt = pgClient();
  await dbStmt.connect();
  let stmtId = '';
  let stmtNo = '';
  try {
    const r = (
      await dbStmt.query(
        `select public.generate_dropship_weekly_statement($1, now() - interval '1 hour', now() + interval '1 minute') as r`,
        [merchant!.orgId],
      )
    ).rows[0].r as { statement_id: string; number: string; sample_count: number };
    stmtId = r.statement_id;
    stmtNo = r.number;
    expect(r.sample_count).toBe(1);
  } finally {
    await dbStmt.end();
  }

  await page.goto('/account/invoices');
  await expect(page.locator('main:visible')).toContainText(stmtNo);
  await expect(page.locator('main:visible')).toContainText('Dropshipping');

  await page.goto(`/api/documents/${stmtId}/pdf`);
  await expect(page.locator('h1')).toContainText(stmtNo);
  await expect(page.getByTestId('division-line')).toHaveText('Octopus B2B · Dropshipping');
  await expect(page.locator('.seller')).toContainText('Shenzhen Octopus Trading Co., Ltd.');
  await expect(page.locator('.meta')).toContainText('SZ-OCTOPUS');
  await expect(page.getByTestId('statement-lines')).toContainText(/Sample order DSO-\d+/);
});
