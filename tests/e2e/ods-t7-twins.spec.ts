import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * ODS T7 · twins of the Dropship assertions that check TODAY's merchant-shell chrome (DropshipMerchantShell: white
 * sidebar, store switcher, top bar, phone header, phone tabs, "Back to my Octopus account"). With the ODS theme on, Part 6.6
 * replaces that chrome with the My account frame (Dropshipping = a sidebar group, phones: BottomNav + More sheet), so the
 * coordinator's decision (option a) is: those assertions are superseded in ODS mode and each gets a twin here with the
 * same intent, checked against the ODS frame. The original specs are untouched (they keep running as today with the switch off).
 *
 * Runs ONLY with E2E_ODS_PREVIEW=on|all (playwright.config.ts then puts the staging `ods_preview` cookie on every context):
 *   E2E_ODS_PREVIEW=on pnpm exec playwright test tests/e2e/ods-t7-twins.spec.ts
 * Same data patterns as the originals: temporary customers (createTempCustomer → purgeTestOrgs), company_services
 * dropship 'on', dropship_markets, KYC status, and site_settings dropship_v2_ui / dropship_features set for the run and
 * put back afterwards (exactly like ds6 / ds12 / dropship-early-access). Staging only (assertStagingOrThrow).
 *
 * ODS frame test ids used: account-sidebar, account-topbar, account-company, account-bottom-nav, more-sheet,
 * more-dropship, ods-dropship-area (the .ds-v2 wrapper around the Dropship pages), dropship-group (the Dropshipping
 * item), dropship-sidebar (its sub-list), dropship-nav-item / locked-nav-item + data-item="ds-<key>".
 */

test.skip(!process.env.E2E_ODS_PREVIEW, 'ODS twins run only with E2E_ODS_PREVIEW=on|all (the old-shell originals cover the switch-off mode)');
test.describe.configure({ mode: 'serial' });

const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
const EA = {
  dashboard: true, find: true, product_detail: true, landed_cost: true, requests: true, wallet: true, settings: true, support: true,
  stores: false, import_list: false, pushed: false, pricing: false, packing: false, orders: false, reports: false, billing: false, samples: false,
};

let merchant: TempCustomer | null = null; // dropship 'on', verified, market AE (u1 enabledBuyer / step3 / ds* merchants)
let notEnabled: TempCustomer | null = null; // never enabled, KYC not started (u1 nonEnabledBuyer / step4 unverifiedBuyer)
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}
async function noOverflow(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} must not overflow horizontally`).toBe(true);
}
const setFeatures = (value: Record<string, boolean>) => adminClient().from('site_settings').upsert({ key: 'dropship_features', value, is_public: true });

/** Desktop: the Dropship area inside the ODS frame (twin of `dropship-merchant-shell` visible). */
async function expectOdsDropship(page: Page) {
  await expect(page.locator('[data-testid="ods-dropship-area"]:visible')).toHaveCount(1);
  await expect(page.getByTestId('account-sidebar')).toBeVisible();
  await expect(page.getByTestId('dropship-group')).toBeVisible();
}
/** Phones: open the More sheet from the account BottomNav and return the Dropshipping sub-list inside it. */
async function openMoreDropship(page: Page): Promise<Locator> {
  const nav = page.getByTestId('account-bottom-nav');
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: /^More/ }).click();
  const sheet = page.getByTestId('more-sheet');
  await expect(sheet).toBeVisible();
  const list = sheet.getByTestId('more-dropship');
  await expect(list).toBeVisible();
  return list;
}
const subItem = (scope: Locator, key: string) => scope.locator(`[data-item="ds-${key}"]`);

test.beforeAll(async () => {
  await assertStagingOrThrow();
  merchant = await createTempCustomer('t7on');
  notEnabled = await createTempCustomer('t7off');
  const sb = adminClient();
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'ODS T7 twins e2e' });
  await setFeatures(ALL_ON);
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on') on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
    await db.query(`insert into dropship_markets(org_id, country) values ($1, 'AE') on conflict do nothing`, [merchant.orgId]);
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const sb = adminClient();
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  else await sb.from('site_settings').delete().eq('key', 'dropship_features');
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  const orgIds = [merchant?.orgId, notEnabled?.orgId].filter(Boolean) as string[];
  if (orgIds.length) {
    const db = pgClient();
    await db.connect();
    try {
      await db.query(`delete from dropship_markets where org_id = any($1)`, [orgIds]);
    } finally {
      await db.end();
    }
    await purgeTestOrgs(orgIds, [merchant?.id, notEnabled?.id].filter(Boolean) as string[]);
  }
});

test.describe('replaces dropship-u1.spec.ts:258 (flag off → no merchant shell; account shell + Coming soon)', () => {
  test('dropship_v2_ui OFF: Dropshipping has no sub-items in the ODS sidebar, Coming soon page', async ({ page }) => {
    await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: false, description: 'ODS T7 twins off check' });
    try {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await customerLogin(page, notEnabled!, '/account/dropship');
      await page.goto('/account/dropship');
      await expect(page.getByTestId('account-sidebar')).toBeVisible();
      // The `ods-dropship-area` wrapper is only the restyle root and is always present; "no merchant app" in ODS = no
      // Dropshipping sub-items (today's rule: the merchant menu only with dropship_v2_ui ON).
      await expect(page.getByTestId('dropship-sidebar')).toHaveCount(0);
      await expect(page.getByTestId('dropship-nav-item')).toHaveCount(0);
      await expect(page.getByTestId('locked-nav-item')).toHaveCount(0);
      await expect(page.getByTestId('dropship-coming-soon')).toBeVisible();
    } finally {
      await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'ODS T7 twins e2e' });
    }
  });
});

test.describe('replaces dropship-u1.spec.ts:277 / :289 / :291 / :292 (merchant shell, store switcher, back link, top bar @1280)', () => {
  test('enabled merchant @1280: Dropship area + group, Stores item and company, Home link, ODS topbar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await customerLogin(page, merchant!, '/account/dropship');
    await page.goto('/account/dropship');
    // :277 dropship-merchant-shell visible
    await expectOdsDropship(page);
    await expect(page.getByTestId('dropship-active-start')).toBeVisible();
    // :289 store switcher "No store connected" → 6.6 gives the Stores sub-item (→ the Stores page) + the company box
    const group = page.getByTestId('dropship-sidebar');
    await expect(subItem(group, 'stores')).toHaveAttribute('href', '/account/dropship/stores');
    await expect(page.getByTestId('account-company')).toBeVisible();
    // :291 back-to-octopus-account → the frame's Overview › Home link
    await expect(page.getByTestId('account-sidebar').getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/account');
    // :292 ds-top-bar → the ODS AccountTopbar
    await expect(page.getByTestId('account-topbar')).toBeVisible();
    await checkAxe(page, 'ods merchant @1280');
  });
});

test.describe('replaces dropship-u1.spec.ts:305 (wallet inside the merchant shell)', () => {
  test('group "Wallet" opens the Dropship wallet inside the ODS frame', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await customerLogin(page, merchant!, '/account/dropship');
    await page.goto('/account/dropship');
    await page.getByTestId('dropship-sidebar').getByRole('link', { name: 'Dropshipping wallet' }).click();
    await expect(page).toHaveURL(/\/account\/dropship\/wallet$/);
    await expectOdsDropship(page);
    await expect(subItem(page.getByTestId('dropship-sidebar'), 'wallet')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main:visible').getByTestId('wallet-balance')).toBeVisible();
  });
});

test.describe('replaces dropship-u1.spec.ts:311 / :313 / :316–:330 / :346–:350 (phone header, store switcher, 5 tabs, More @390)', () => {
  test('enabled merchant @390: navy header, BottomNav, More sheet with the Dropshipping items', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await customerLogin(page, merchant!, '/account/dropship');
    await page.goto('/account/dropship');
    // :311 dropship-phone-header → the ODS phone header (AccountTopbar)
    await expect(page.getByTestId('account-topbar')).toBeVisible();
    await expect(page.getByTestId('dropship-active-start')).toBeVisible();
    // :316–:330 phone tabs Home·Find·Orders·Wallet·More, Home current → account BottomNav (Home·Requests·Orders·Wallet·More);
    // a Dropship page belongs to More (current), and the group opens from More with Dashboard current
    const nav = page.getByTestId('account-bottom-nav');
    await expect(nav).toBeVisible();
    for (const name of ['Home', 'Requests', 'Orders', 'Wallet']) await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(nav.getByRole('button', { name: /^More/ })).toHaveAttribute('aria-current', 'page');
    await noOverflow(page, 'ods merchant @390');
    await checkAxe(page, 'ods merchant @390');
    // :346–:350 More → today's /more page; ODS: the More sheet
    const list = await openMoreDropship(page);
    await expect(subItem(list, 'dashboard')).toHaveAttribute('aria-current', 'page');
    await expect(subItem(list, 'find')).toBeVisible();
    await expect(subItem(list, 'orders')).toBeVisible();
    await expect(subItem(list, 'wallet')).toHaveAttribute('href', '/account/dropship/wallet');
    // :313 dropship-store-switcher-mobile → the Stores item in the More sheet
    await expect(subItem(list, 'stores')).toHaveAttribute('href', '/account/dropship/stores');
    await checkAxe(page, 'ods more sheet @390');
  });
});

test.describe('replaces dropship-u1.spec.ts:388 (every merchant route renders inside the merchant shell)', () => {
  test('every Dropship route renders inside the ODS frame with its heading', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await customerLogin(page, merchant!, '/account/dropship');
    const routes: [string, string][] = [
      ['/account/dropship/onboarding', 'Set up Octopus Dropship'],
      ['/account/dropship/landed-cost', 'Landed cost calculator'],
      ['/account/dropship/requests', 'Request a product'],
      ['/account/dropship/sample', 'Order a sample'],
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
    for (const [route, heading] of routes) {
      await page.goto(route);
      await expectOdsDropship(page);
      await expect(page.locator('main:visible h1')).toContainText(heading);
    }
  });
});

test.describe('replaces dropship-step3.spec.ts:296 / :316 (Find screens inside the shell; phone tab "Find" current)', () => {
  test('Find products is the current Dropshipping item @1280 and in the More sheet @390', async ({ page }) => {
    await customerLogin(page, merchant!, '/account/dropship/catalogue?country=AE');
    // the product detail and sample screens need step3's seeded products; these two need none
    for (const [route, heading] of [['/account/dropship/catalogue?country=AE', 'Find products'], ['/account/dropship/landed-cost', 'Landed cost calculator']] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(route);
      await expectOdsDropship(page);
      await expect(page.locator('main:visible h1')).toContainText(heading);
      await expect(subItem(page.getByTestId('dropship-sidebar'), 'find')).toHaveAttribute('aria-current', 'page');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      const list = await openMoreDropship(page);
      await expect(subItem(list, 'find')).toHaveAttribute('aria-current', 'page');
      await checkAxe(page, `${heading} more @390`);
    }
  });
});

test.describe('replaces dropship-step4.spec.ts:127 / :135 / :144 / :148 (locked store switcher, back link, phone Home tab, 4 locked phone tabs)', () => {
  test('company not activated: locked Stores item, Home link, More current, 12 locked items in More', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await customerLogin(page, notEnabled!, '/account/dropship');
    await page.goto('/account/dropship');
    await expect(page.getByTestId('dropship-activate')).toBeVisible();
    // :127 dropship-store-switcher aria-disabled → the Stores sub-item is locked
    const stores = subItem(page.getByTestId('dropship-sidebar'), 'stores');
    await expect(stores).toHaveAttribute('aria-disabled', 'true');
    await expect(stores).toHaveAttribute('data-testid', 'locked-nav-item');
    // :135 back-to-octopus-account → Overview › Home
    await expect(page.getByTestId('account-sidebar').getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/account');
    // :144 phone "Home" tab current → More current, "Start dropshipping" current in the More sheet
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('account-bottom-nav').getByRole('button', { name: /^More/ })).toHaveAttribute('aria-current', 'page');
    const list = await openMoreDropship(page);
    await expect(list.getByRole('link', { name: 'Start dropshipping' })).toHaveAttribute('aria-current', 'page');
    // :148 4 locked phone tabs → the locked Dropshipping items in the More sheet (same 12 as the sidebar)
    const locked = list.getByTestId('locked-nav-item');
    await expect(locked).toHaveCount(12);
    await expect(locked.first()).toHaveAttribute('aria-disabled', 'true');
    await expect(locked.first()).toHaveAttribute('title', 'Activate dropshipping');
    await expect(list).toContainText('Activate dropshipping to open these pages.');
    await checkAxe(page, 'ods activate more @390');
  });
});

test.describe('replaces dropship-step4.spec.ts:231 (onboarding @390: phone "Home" tab current)', () => {
  test('onboarding @390: More current, Dashboard current in the More sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await customerLogin(page, merchant!, '/account/dropship/onboarding');
    await page.goto('/account/dropship/onboarding');
    await expect(page.getByTestId('dropship-onboarding')).toBeVisible();
    await expect(page.getByTestId('account-bottom-nav').getByRole('button', { name: /^More/ })).toHaveAttribute('aria-current', 'page');
    const list = await openMoreDropship(page);
    await expect(subItem(list, 'dashboard')).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('replaces dropship-early-access.spec.ts:84 / :97 / :100 (no "coming soon" / hidden features inside the shell main) and :114–:118 (EA phone tabs)', () => {
  test.beforeAll(async () => {
    await setFeatures(EA);
  });
  test.afterAll(async () => {
    await setFeatures(ALL_ON);
  });

  test('early access @1280: page main never mentions coming soon or switched-off features', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await customerLogin(page, merchant!, '/account/dropship');
    await page.goto('/account/dropship');
    await expectOdsDropship(page);
    await expect(page.getByTestId('ea-dashboard')).toBeVisible();
    const main = page.locator('main:visible');
    await expect(main).not.toContainText(/coming soon/i);
    await page.goto('/account/dropship/catalogue');
    await expect(page.getByTestId('dropship-catalogue-v2')).toBeVisible();
    await expect(main).not.toContainText(/coming soon|add to import list/i);
    await page.goto('/account/dropship/more');
    await expect(page.getByTestId('dropship-more-page')).toBeVisible();
    await expect(main).not.toContainText(/coming soon|Import list|Order a sample|Pricing and sync/i);
    // the group itself lists only the early-access items (switched-off ones are hidden, not "coming soon")
    const group = page.getByTestId('dropship-sidebar');
    for (const hidden of ['import_list', 'pushed', 'orders', 'pricing', 'packing', 'stores', 'billing', 'reports']) await expect(subItem(group, hidden)).toHaveCount(0);
    await expect(subItem(group, 'requests')).toBeVisible();
  });

  test('early access @390: BottomNav + More sheet with Product requests; it becomes current', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await customerLogin(page, merchant!, '/account/dropship');
    await page.goto('/account/dropship');
    let list = await openMoreDropship(page);
    for (const key of ['dashboard', 'find', 'requests', 'wallet', 'settings', 'support']) await expect(subItem(list, key)).toBeVisible();
    for (const key of ['import_list', 'orders', 'stores', 'billing', 'reports']) await expect(subItem(list, key)).toHaveCount(0);
    await subItem(list, 'requests').click();
    await expect(page).toHaveURL(/\/account\/dropship\/requests/);
    list = await openMoreDropship(page);
    await expect(subItem(list, 'requests')).toHaveAttribute('aria-current', 'page');
    await page.goto('/account/dropship');
    await checkAxe(page, 'ods EA dashboard @390');
  });
});

test.describe('replaces ds6-dropship.spec.ts:215, ds8-dropship.spec.ts:263 and ds12-dropship.spec.ts:237 (phone tabs visible on every screen @390)', () => {
  // ds6's editor and push screens need its seeded product; the frame is the same for them (u1 twin covers their headings)
  const screens: [string, string, string][] = [
    ['ds6', '/account/dropship/catalogue?list=1', 'import_list'],
    ['ds6', '/account/dropship/pushed', 'pushed'],
    ['ds6', '/account/dropship/pricing', 'pricing'],
    ['ds6', '/account/dropship/packing', 'packing'],
    ['ds8', '/account/dropship/orders', 'orders'],
    ['ds8', '/account/dropship/wallet', 'wallet'],
    ['ds12', '/account/dropship', 'dashboard'],
    ['ds12', '/account/dropship/billing', 'billing'],
    ['ds12', '/account/dropship/reports', 'reports'],
    ['ds12', '/account/dropship/settings', 'settings'],
    ['ds12', '/account/dropship/more', ''],
  ];
  test('every screen @390: BottomNav visible, the More sheet lists Dropshipping with the right item current', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await customerLogin(page, merchant!, '/account/dropship');
    for (const [origin, path, key] of screens) {
      await page.goto(path);
      await expect(page.locator('[data-testid="ods-dropship-area"]:visible')).toHaveCount(1);
      await expect(page.getByTestId('account-bottom-nav')).toBeVisible();
      await noOverflow(page, `${origin} ${path} @390`);
      const list = await openMoreDropship(page);
      if (key) await expect(subItem(list, key), `${origin} ${path}`).toHaveAttribute('aria-current', 'page');
      await checkAxe(page, `${origin} ${path} more @390`);
    }
  });
});
