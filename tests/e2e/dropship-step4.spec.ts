import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  adminClient,
  createTempCustomer,
  customerLogin,
  pgClient,
  purgeTestOrgs,
  type TempCustomer,
} from './helpers/customer';
import {
  createTempStaff,
  deleteTempStaff,
  staffLogin,
  type TempStaff,
} from './helpers/staff';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Step 4 E2E — Access request (Activate), StaffMerchants approval/pause/close,
 * Onboarding wizard (4 steps incl. Step 5 store placeholder & Free while plan fees are off),
 * seller return-profile review, KYC auto-pause, and paused/closed ongoing access.
 */
const SHOTS = process.env.SHOTS_DIR;

let unverifiedBuyer: TempCustomer | null = null;
let verifiedMerchant: TempCustomer | null = null;
let dsStaff: TempStaff | null = null;

test.describe.configure({ mode: 'serial' });

async function checkAxe(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious,
    `${label} axe serious/critical violations: ${JSON.stringify(
      serious.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => n.html),
      })),
    )}`,
  ).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  unverifiedBuyer = await createTempCustomer('s4unv');
  verifiedMerchant = await createTempCustomer('s4ver');
  dsStaff = await createTempStaff('admin');

  const sb = adminClient();
  // Ensure dropship_v2_ui uses staging default (ON)
  await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');

  // Set verifiedMerchant's org to kyc_status = 'verified' (unverifiedBuyer stays 'not_started')
  await sb
    .from('organizations')
    .update({ kyc_status: 'verified' })
    .eq('id', verifiedMerchant.orgId);

  const { data: dsDiv } = await sb.from('divisions').select('id').eq('code', 'DS').single();
  if (dsDiv?.id) {
    await sb
      .from('division_members')
      .upsert({ division_id: dsDiv.id, user_id: dsStaff.id, role: 'manager' });
  }
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingOrThrow(db);
    const orgIds = [unverifiedBuyer?.orgId, verifiedMerchant?.orgId].filter(
      Boolean,
    ) as string[];
    if (orgIds.length > 0) {
      await db.query(`delete from store_orders where org_id = any($1)`, [orgIds]);
      await db.query(`delete from dropship_access_requests where org_id = any($1)`, [orgIds]);
      await db.query(`delete from dropship_seller_profiles where org_id = any($1)`, [orgIds]);
      await db.query(`delete from dropship_markets where org_id = any($1)`, [orgIds]);
    }
  } finally {
    await db.end();
  }

  await purgeTestOrgs(
    [unverifiedBuyer?.orgId, verifiedMerchant?.orgId].filter(Boolean) as string[],
    [unverifiedBuyer?.id, verifiedMerchant?.id].filter(Boolean) as string[],
  );
  await deleteTempStaff(dsStaff);
});

test('Unverified org sees "Verify your company first" + /account/kyc link on Activate (1280px & 390px axe clean)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await customerLogin(page, unverifiedBuyer!, '/account/dropship');
  await page.goto('/account/dropship');

  await expect(page.getByTestId('dropship-activate')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Start dropshipping');
  await expect(page.getByTestId('activate-kyc-gate')).toContainText(
    'Verify your company first',
  );
  await expect(
    page.getByTestId('activate-kyc-gate').getByRole('link', { name: 'Verify your company first' }),
  ).toHaveAttribute('href', '/account/kyc');
  await expect(page.getByTestId('send-access-request-btn')).toBeDisabled();
  await expect(page.getByTestId('activate-plan-fee-note')).toContainText(
    'Free while plan fees are off',
  );

  // Locked sidebar nav & store switcher when dropship is not enabled yet
  const lockedNavItems = page.getByTestId('locked-nav-item');
  // 12 since DS14 (Release 6) added "Integrations" to the merchant menu
  await expect(lockedNavItems).toHaveCount(12);
  await expect(lockedNavItems.first()).toHaveAttribute('aria-disabled', 'true');
  await expect(lockedNavItems.first()).toHaveAttribute('title', 'Activate dropshipping');
  await expect(page.getByTestId('dropship-store-switcher')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByTestId('dropship-sidebar').getByRole('link', { name: 'Start dropshipping' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('back-to-octopus-account')).toHaveAttribute('href', '/account');

  await checkAxe(page, 'activate-unverified-1280');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/step4-activate-1280.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('dropship-phone-tabs').getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const lockedPhoneTabs = page.getByTestId('locked-phone-tab');
  await expect(lockedPhoneTabs).toHaveCount(4);
  await expect(lockedPhoneTabs.first()).toHaveAttribute('aria-disabled', 'true');
  await expect(lockedPhoneTabs.first()).toHaveAttribute('title', 'Activate dropshipping');
  await checkAxe(page, 'activate-unverified-390');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/step4-activate-390.png`, fullPage: true });
});

test('Verified org requests access -> Staff approves in StaffMerchants -> Onboarding 4 steps -> KYC auto-pause & close keep orders/wallet/support accessible', async ({
  page,
  browser,
}) => {
  // 1. Verified merchant submits access request on /account/dropship
  await page.setViewportSize({ width: 1280, height: 900 });
  await customerLogin(page, verifiedMerchant!, '/account/dropship');
  await page.goto('/account/dropship');

  await expect(page.getByTestId('dropship-activate')).toBeVisible();
  await expect(page.getByTestId('activate-kyc-gate')).toHaveCount(0);
  await page.getByLabel('Store address').fill('step4-home.myshopify.com');
  await page.getByLabel('Orders you expect per month').selectOption('100 to 500');
  await expect(page.getByTestId('send-access-request-btn')).toBeEnabled();
  await page.getByTestId('send-access-request-btn').click();

  await expect(page.getByTestId('activate-pending-banner')).toBeVisible();

  // Verify NOT auto-approved: /account/dropship/onboarding still redirects to /account/dropship
  await page.goto('/account/dropship/onboarding');
  await expect(page).toHaveURL(/\/account\/dropship$/);

  // 2. Staff opens /office/dropship/merchants (1280px & 390px axe clean) and approves with reason
  const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const staffPage = await staffCtx.newPage();
  await staffLogin(staffPage, dsStaff!, '/office/dropship/merchants');
  await staffPage.goto('/office/dropship/merchants');

  await expect(staffPage.getByTestId('staff-merchants-page')).toBeVisible();
  await expect(
    staffPage.getByTestId(`access-request-row-${verifiedMerchant!.orgId}`),
  ).toBeVisible();

  await checkAxe(staffPage, 'staff-merchants-1280');
  expect(
    await staffPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (SHOTS) {
    await staffPage.screenshot({ path: `${SHOTS}/step4-staff-merchants-1280.png`, fullPage: true });
  }

  await staffPage.setViewportSize({ width: 390, height: 844 });
  await checkAxe(staffPage, 'staff-merchants-390');
  expect(
    await staffPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await staffPage.setViewportSize({ width: 1280, height: 1000 });
  await staffPage
    .getByTestId(`request-reason-${verifiedMerchant!.orgId}`)
    .fill('Verified UAE trade licence & Shopify domain');
  await staffPage.getByTestId(`approve-request-${verifiedMerchant!.orgId}`).click();
  await expect(staffPage.getByTestId('staff-merchants-notice')).toContainText('approved');
  await expect(
    staffPage.getByTestId(`merchant-row-${verifiedMerchant!.orgId}`),
  ).toContainText('Free while plan fees are off');

  // 3. Merchant completes Onboarding (/account/dropship/onboarding at 1280px & 390px)
  await page.goto('/account/dropship/onboarding');
  await expect(page.getByTestId('dropship-onboarding')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Set up Octopus Dropship');
  await expect(page.getByTestId('onboarding-duty-note')).toContainText('DDP');
  await expect(page.getByTestId('onboarding-duty-note')).toContainText('DAP');

  await checkAxe(page, 'onboarding-1280');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/step4-onboarding-1280.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByTestId('dropship-phone-tabs').getByRole('link', { name: 'Home' }),
  ).toHaveAttribute('aria-current', 'page');
  await checkAxe(page, 'onboarding-390');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/step4-onboarding-390.png`, fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId('onboarding-save-markets-btn').click();

  // Step 2: Return & brand profile
  await expect(page.getByTestId('onboarding-profile-status')).toContainText(
    'Staff approval required before any shipping label is printed',
  );
  await page.getByLabel('Return street address (line 1)').fill('Warehouse 12, Al Quoz');
  await page.getByLabel('City').fill('Dubai');
  await page.getByTestId('onboarding-save-profile-btn').click();

  // Step 3: Plan & wallet ("Free while plan fees are off")
  await expect(page.getByTestId('onboarding-plan-card')).toContainText(
    'Free while plan fees are off',
  );
  await expect(page.getByTestId('onboarding-topup-link')).toHaveAttribute(
    'href',
    '/account/dropship/wallet',
  );
  await page.getByTestId('onboarding-to-step4-btn').click();

  // Step 4: Connect store placeholder
  await expect(page.getByTestId('onboarding-connect-store-placeholder')).toContainText(
    'Coming in Step 5',
  );

  // Staff approves seller profile in StaffMerchants
  await staffPage.reload();
  const selectBtn = staffPage.getByTestId(`select-merchant-${verifiedMerchant!.orgId}`);
  if ((await selectBtn.innerText()).trim() !== 'Selected') {
    await selectBtn.click();
  }
  await staffPage.getByTestId('profile-review-reason').fill('Return address verified');
  await staffPage.getByTestId('approve-seller-profile-btn').click();
  await expect(staffPage.getByTestId('staff-merchants-notice')).toContainText(
    'Brand & return address approved',
  );

  // Create an in-progress paid store_order for verifiedMerchant so we can verify pause/close order visibility
  const db = pgClient();
  await db.connect();
  let orderNumber = '';
  try {
    const ins = (
      await db.query(
        `insert into store_orders (
           org_id, kind, channel, external_order_id, buyer_name, shipping_address,
           destination_country, buyer_currency, shipping_method, incoterm,
           product_cents, processing_cents, shipping_cents, duties_cents, total_cents,
           payment_state, merchant_status, staff_stage, is_test
         ) values (
           $1, 'store', 'manual', 'S4-E2E-INPROG', 'E2E Buyer', '{"line1":"1 Marina","city":"Dubai"}'::jsonb,
           'AE', 'USD', 'standard', 'DDP', 1200, 120, 420, 60, 1800,
           'paid', 'processing', 'packing', true
         ) returning order_number`,
        [verifiedMerchant!.orgId],
      )
    ).rows[0];
    orderNumber = ins.order_number as string;
  } finally {
    await db.end();
  }

  // 4. Correction 4: KYC leaves 'verified' -> auto-pauses dropship ('KYC no longer verified')
  await adminClient()
    .from('organizations')
    .update({ kyc_status: 'more_info' })
    .eq('id', verifiedMerchant!.orgId);

  await page.goto('/account/dropship');
  await expect(page.getByTestId('dropship-paused-banner')).toContainText(
    'KYC no longer verified',
  );

  // Paused merchant still sees Orders in progress, Wallet, Settings (Data export), and Support
  await page.goto('/account/dropship/orders');
  await expect(page.getByTestId('orders-paused-fulfilment-note')).toBeVisible();
  await expect(page.getByTestId(`merchant-order-row-${orderNumber}`)).toBeVisible();

  await page.goto('/account/dropship/wallet');
  await expect(page.getByTestId('wallet-balance')).toBeVisible();

  await page.goto('/account/dropship/settings');
  await expect(page.getByTestId('dropship-data-export-link')).toHaveAttribute(
    'href',
    '/account/dropship/export',
  );
  const pausedExportRes = await page.request.get('/account/dropship/export');
  expect(pausedExportRes.status()).toBe(200);
  const pausedExportJson = await pausedExportRes.json();
  expect(pausedExportJson?.service?.status).toBe('paused');

  // Re-verify KYC, staff closes ('off') merchant in StaffMerchants -> closed merchant STILL sees orders in progress!
  await adminClient()
    .from('organizations')
    .update({ kyc_status: 'verified' })
    .eq('id', verifiedMerchant!.orgId);
  await staffPage.reload();
  const selectBtn2 = staffPage.getByTestId(`select-merchant-${verifiedMerchant!.orgId}`);
  if ((await selectBtn2.innerText()).trim() !== 'Selected') {
    await selectBtn2.click();
  }
  await staffPage.getByTestId('merchant-status-reason').fill('Account closed per test');
  await staffPage.getByTestId('close-merchant-btn').click();
  await expect(staffPage.getByTestId('staff-merchants-notice')).toContainText('"off"');

  await page.goto('/account/dropship/orders');
  await expect(page.getByTestId(`merchant-order-row-${orderNumber}`)).toBeVisible();

  await staffCtx.close();
});
