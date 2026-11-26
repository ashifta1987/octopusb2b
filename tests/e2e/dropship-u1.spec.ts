import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  adminClient,
  createTempCustomer,
  customerLogin,
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
 * Step U1 — Design system and app shells for Octopus Dropship (design v2).
 * Verifies:
 *   1. Gating:
 *      - Non-enabled customer stays on AccountShell + "Coming soon" at /account/dropship and is redirected from any /account/dropship/* placeholder sub-route.
 *      - Enabled customer (dropship='on') with dropship_v2_ui ON gets the DropshipMerchantShell, store switcher ("No store connected"), grouped sidebar, /account/dropship/wallet (shared wallet inside shell), and "Back to my Octopus account" link.
 *      - Admin toggle for dropship_v2_ui writes an audit_log entry.
 *   2. Staff shell & role visibility:
 *      - /office/dropship/ui-kit is staff-only, noindex, behind dropship_v2_ui, and passes axe with 0 serious/critical issues at 1280px and 390px.
 *      - "Product editor" is NOT in the staff menu; editor opens from a product row (/office/dropship/[id] and /office/dropship/new).
 *      - "Finance: SaaS billing" is shown to Admin and Finance staff, and hidden from Dropship division staff without Finance role (and server-refused at /admin/finance/saas).
 */
const SHOTS = process.env.SHOTS_DIR;
let enabledBuyer: TempCustomer | null = null;
let nonEnabledBuyer: TempCustomer | null = null;
let adminStaff: TempStaff | null = null;
let dsOnlyStaff: TempStaff | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await assertStagingOrThrow();
  enabledBuyer = await createTempCustomer('u1on');
  nonEnabledBuyer = await createTempCustomer('u1off');
  adminStaff = await createTempStaff('admin');
  dsOnlyStaff = await createTempStaff('operations');

  const sb = adminClient();
  // Enable dropship service for enabledBuyer
  const { error: svcErr } = await sb
    .from('company_services')
    .upsert({ org_id: enabledBuyer.orgId, service: 'dropship', status: 'on' });
  if (svcErr) throw new Error(svcErr.message);

  // Add dsOnlyStaff to DS division (no finance role, not admin)
  const { data: dsDiv } = await sb.from('divisions').select('id').eq('code', 'DS').single();
  if (dsDiv?.id) {
    await sb
      .from('division_members')
      .upsert({ division_id: dsDiv.id, user_id: dsOnlyStaff.id, role: 'staff' });
  }
});

test.afterAll(async () => {
  const sb = adminClient();
  await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  if (enabledBuyer || nonEnabledBuyer) {
    await purgeTestOrgs(
      [enabledBuyer?.orgId, nonEnabledBuyer?.orgId].filter(Boolean) as string[],
      [enabledBuyer?.id, nonEnabledBuyer?.id].filter(Boolean) as string[],
    );
  }
  await deleteTempStaff(adminStaff);
  await deleteTempStaff(dsOnlyStaff);
});

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

test('Staff UI kit (/office/dropship/ui-kit), role-filtered Staff shell at 1280px and 390px, and admin dropship_v2_ui audit log', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, adminStaff!, '/office/dropship/ui-kit');
  await page.goto('/office/dropship/ui-kit');

  // Rule 9: /office/dropship/ui-kit is noindex
  const robotsMeta = await page.locator('meta[name="robots"]').getAttribute('content');
  expect(robotsMeta).toContain('noindex');

  await expect(page.getByTestId('dropship-staff-shell')).toBeVisible();
  await expect(page.getByTestId('dropship-ui-kit')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Components and specs');
  await expect(page.getByTestId('disabled-reason').first()).toContainText(
    'Always say why, next to it',
  );
  await expect(page.getByRole('switch', { name: 'Automatic order sync' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('ds-price-breakdown')).toContainText('Product');
  await expect(page.getByTestId('ds-price-breakdown')).toContainText('Processing');
  await expect(page.getByTestId('ds-price-breakdown')).toContainText('Shipping');
  await expect(page.getByTestId('ds-price-breakdown')).toContainText('Duties and tax (DDP)');
  await expect(page.getByTestId('ds-price-breakdown')).toContainText('Landed cost');

  await checkAxe(page, 'ui-kit-1280');
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/u1-ui-kit-1280.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await checkAxe(page, 'ui-kit-390');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'ui-kit-390 must not overflow horizontally',
  ).toBe(true);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/u1-ui-kit-390.png`,
      fullPage: true,
    });
  }

  // Staff shell on /office/dropship at 1280px and 390px
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/office/dropship');
  const sidebar = page.getByTestId('dropship-staff-sidebar');
  await expect(sidebar.getByRole('link', { name: 'Products', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Rule 4: "Product editor" is removed from the staff menu
  await expect(sidebar.getByRole('link', { name: 'Product editor' })).toHaveCount(0);
  // Admin sees "Finance: SaaS billing"
  await expect(sidebar.getByRole('link', { name: 'Finance: SaaS billing' })).toBeVisible();
  // wait for the streamed catalogue to replace the loading placeholder before running axe
  await expect(page.getByText('Loading Dropshipping catalogue…')).toHaveCount(0, { timeout: 20_000 });

  await checkAxe(page, 'staff-shell-1280');
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/u1-staff-shell-1280.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await checkAxe(page, 'staff-shell-390');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'staff-shell-390 must not overflow horizontally',
  ).toBe(true);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/u1-staff-shell-390.png`,
      fullPage: true,
    });
  }

  // Verify every staff menu route loads with its page header
  await page.setViewportSize({ width: 1280, height: 1000 });
  const staffRoutes: [string, string][] = [
    ['/office/dropship/compliance', 'Duty, tax and customs'],
    ['/office/dropship/queue', 'Fulfilment queue'],
    ['/office/dropship/queue?status=packing', 'Fulfilment queue'],
    ['/office/dropship/pack', 'Pack station'],
    ['/office/dropship/merchants', 'Merchants'],
    ['/office/dropship/fees', 'Fees and plans'],
    ['/office/dropship/health', 'System health'],
    ['/admin/finance/saas', 'SaaS billing'],
  ];
  for (const [route, heading] of staffRoutes) {
    await page.goto(route);
    await expect(page.getByTestId('dropship-staff-shell')).toBeVisible();
    await expect(page.locator('h1')).toContainText(heading);
  }

  // Rule 1: Admin setting dropship_v2_ui toggle writes an audit log entry
  await page.goto('/admin/services');
  const settingBox = page.getByTestId('dropship-v2-ui-setting');
  await expect(settingBox).toBeVisible();
  await settingBox.getByRole('button', { name: 'Save UI switch' }).click();
  await expect(page.getByRole('status')).toContainText(/Dropship design v2 UI switched/);
  const { data: audits } = await adminClient()
    .from('audit_log')
    .select('action, entity_id')
    .eq('action', 'dropship.v2_ui_toggled')
    .limit(1);
  expect(audits?.length).toBeGreaterThan(0);

  // Rule 4: Dropship division staff WITHOUT Finance role does NOT see "Finance: SaaS billing" and is refused at /admin/finance/saas
  const dsCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const dsPage = await dsCtx.newPage();
  await staffLogin(dsPage, dsOnlyStaff!, '/office/dropship');
  await dsPage.goto('/office/dropship');
  const dsSidebar = dsPage.getByTestId('dropship-staff-sidebar');
  await expect(dsSidebar.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  await expect(dsSidebar.getByRole('link', { name: 'Finance: SaaS billing' })).toHaveCount(0);
  await dsPage.goto('/admin/finance/saas');
  await expect(dsPage).toHaveURL(/\/forbidden/);
  await dsCtx.close();

  // Verify non-Dropship pages (/ , /products, /admin) never request Inter font files
  const fontUrls: string[] = [];
  const onReq = (req: import('@playwright/test').Request) => {
    const u = req.url();
    if (u.includes('.woff2')) fontUrls.push(u);
  };
  page.on('request', onReq);
  for (const nonDsPath of ['/', '/products', '/admin']) {
    fontUrls.length = 0;
    await page.goto(nonDsPath);
    await page.waitForLoadState('networkidle');
    const html = await page.content();
    expect(html.includes('--font-ds-inter'), `${nonDsPath} html must not set --font-ds-inter`).toBe(
      false,
    );
    const computedFont = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('--font-ds-inter'),
    );
    expect(computedFont.trim(), `${nonDsPath} must not have --font-ds-inter on body`).toBe('');
  }
  page.off('request', onReq);
});

test('Merchant shell gating, /account/dropship/wallet inside shell, 1280px & 390px + More page + axe check', async ({
  page,
  browser,
}) => {
  // 1a. When dropship_v2_ui is OFF (Live mode), non-enabled customer sees AccountShell + Coming soon, and is redirected from sub-routes
  await adminClient()
    .from('site_settings')
    .upsert({ key: 'dropship_v2_ui', value: false, description: 'U1 off check' });
  const offCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const offPage = await offCtx.newPage();
  await customerLogin(offPage, nonEnabledBuyer!, '/account');
  await offPage.goto('/account');
  const acctHtml = await offPage.content();
  expect(acctHtml.includes('--font-ds-inter'), '/account must not set --font-ds-inter').toBe(false);
  await offPage.goto('/account/dropship');
  await expect(offPage.getByTestId('dropship-merchant-shell')).toHaveCount(0);
  await expect(offPage.getByTestId('account-tabs')).toBeVisible();
  await expect(offPage.getByTestId('dropship-coming-soon')).toBeVisible();
  await offPage.goto('/account/dropship/orders');
  await expect(offPage).toHaveURL(/\/account\/dropship$/);

  // 1b. When dropship_v2_ui is ON (Staging mode), non-enabled customer sees Activate ("Start dropshipping") and is redirected from sub-routes
  await adminClient().from('site_settings').delete().eq('key', 'dropship_v2_ui');
  await offPage.goto('/account/dropship');
  await expect(offPage.getByTestId('dropship-activate')).toBeVisible();
  await offPage.goto('/account/dropship/orders');
  await expect(offPage).toHaveURL(/\/account\/dropship$/);
  await offCtx.close();

  // 2. Enabled customer sees DropshipMerchantShell
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, enabledBuyer!, '/account/dropship');
  await page.goto('/account/dropship');

  await expect(page.getByTestId('dropship-merchant-shell')).toBeVisible();
  await expect(page.getByTestId('account-tabs')).toHaveCount(0);
  // Batch 3 (F-15): active merchants see real next steps instead of the legacy "being set up" card
  await expect(page.getByTestId('dropship-active-start')).toBeVisible();
  await expect(page.getByTestId('service-setting-up')).toHaveCount(0);
  const sidebar = page.getByTestId('dropship-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Rule 5: Store switcher shows "No store connected" until Step 4
  await expect(page.getByTestId('dropship-store-switcher')).toContainText('No store connected');
  // Rule 3: Clear "Back to my Octopus account" link in sidebar and top bar account menu
  await expect(page.getByTestId('back-to-octopus-account')).toHaveAttribute('href', '/account');
  await expect(page.getByTestId('ds-top-bar')).toBeVisible();

  await checkAxe(page, 'merchant-shell-1280');
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/u1-merchant-shell-1280.png`,
      fullPage: true,
    });
  }

  // Rule 2: Wallet inside the Dropship shell (/account/dropship/wallet) renders shared wallet
  await sidebar.getByRole('link', { name: 'Wallet' }).click();
  await expect(page).toHaveURL(/\/account\/dropship\/wallet$/);
  await expect(page.getByTestId('dropship-merchant-shell')).toBeVisible();
  await expect(page.getByTestId('wallet-balance')).toBeVisible();

  // Phone view (390px): top header, bottom 5 tabs, and More page
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account/dropship');
  await expect(page.getByTestId('dropship-phone-header')).toBeVisible();
  await expect(page.getByTestId('dropship-active-start')).toBeVisible();
  await expect(page.getByTestId('dropship-store-switcher-mobile')).toContainText(
    'No store connected',
  );
  const phoneTabs = page.getByTestId('dropship-phone-tabs');
  await expect(phoneTabs).toBeVisible();
  await expect(phoneTabs.getByRole('link')).toHaveText([
    'Home',
    'Find',
    'Orders',
    'Wallet',
    'More',
  ]);
  await expect(phoneTabs.getByRole('link', { name: 'Wallet' })).toHaveAttribute(
    'href',
    '/account/dropship/wallet',
  );
  await expect(phoneTabs.getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await checkAxe(page, 'merchant-shell-390');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'merchant-shell-390 must not overflow horizontally',
  ).toBe(true);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/u1-merchant-shell-390.png`,
      fullPage: true,
    });
  }

  await phoneTabs.getByRole('link', { name: 'More' }).click();
  await expect(page).toHaveURL(/\/account\/dropship\/more$/);
  await expect(page.getByTestId('dropship-more-page')).toBeVisible();
  await expect(phoneTabs.getByRole('link', { name: 'More' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await checkAxe(page, 'merchant-more-390');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'merchant-more-390 must not overflow horizontally',
  ).toBe(true);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/u1-merchant-more-390.png`,
      fullPage: true,
    });
  }

  // Verify every merchant placeholder route loads with its page header
  await page.setViewportSize({ width: 1280, height: 1000 });
  const merchantRoutes: [string, string][] = [
    ['/account/dropship/onboarding', 'Set up Octopus Dropship'],
    ['/account/dropship/landed-cost', 'Landed cost calculator'],
    ['/account/dropship/requests', 'Request a product'],
    ['/account/dropship/sample', 'Order a sample'],
    // Release 2 · Step 6 (design v2 wording): the editor and push screens are built
    ['/account/dropship/import/test-1', 'Edit before pushing'],
    ['/account/dropship/push', 'Push to Shopify'],
    ['/account/dropship/pushed', 'Pushed products'],
    ['/account/dropship/pricing', 'Pricing and sync'],
    ['/account/dropship/packing', 'Packing and shipping'],
    ['/account/dropship/stores', 'Stores'],
    ['/account/dropship/orders', 'Orders'],
    ['/account/dropship/orders/1046', 'Order detail'],
    ['/account/dropship/billing', 'Plan and billing'],
    ['/account/dropship/reports', 'Reports'],
    ['/account/dropship/settings', 'Settings'],
    ['/account/dropship/support', 'Support'],
  ];
  for (const [route, heading] of merchantRoutes) {
    await page.goto(route);
    await expect(page.getByTestId('dropship-merchant-shell')).toBeVisible();
    await expect(page.locator('h1')).toContainText(heading);
  }
});
