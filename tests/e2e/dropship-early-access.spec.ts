import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Release 1 · EA-2 E2E (STAGING ONLY) — screens/EA_Dashboard, mobile/M_EA_Dashboard, screens/EA_PublicDropship.
 * The spec switches site_settings.dropship_features to the early-access set (what live will use) and restores the
 * staging value afterwards.
 *  1. Menu: Sell (Dashboard, Find products, Product requests), Money (Wallet), Account (Settings, Support). Nothing else.
 *  2. Every OFF route redirects to the dashboard; no "coming soon" text in the merchant app.
 *  3. Dashboard: "Store connection is the next release." + real Getting started; onboarding has 3 steps.
 *  4. Phone tabs: Home · Find · Requests · Wallet · More.
 *  5. Public /request/dropship for signed-out visitors (Create account / Log in with next=/account/dropship).
 *  6. axe clean at 1280 px and 390 px.
 */
test.describe.configure({ mode: 'serial' });

const EA = {
  dashboard: true, find: true, product_detail: true, landed_cost: true, requests: true, wallet: true, settings: true, support: true,
  stores: false, import_list: false, pushed: false, pricing: false, packing: false, orders: false, reports: false, billing: false, samples: false,
};
let merchant: TempCustomer | null = null;
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  merchant = await createTempCustomer('ea2e2e');
  const sb = adminClient();
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'EA-2 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: EA, is_public: true });
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
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  if (merchant) {
    const db = pgClient();
    await db.connect();
    try { await db.query(`delete from dropship_markets where org_id = $1`, [merchant.orgId]); } finally { await db.end(); }
    await purgeTestOrgs([merchant.orgId], [merchant.id]);
  }
});

test('EA-2 menu, hidden routes, dashboard line and 3-step onboarding', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, merchant!, '/account/dropship');
  await page.goto('/account/dropship');
  const side = page.getByTestId('dropship-sidebar');
  await expect(side).toBeVisible();
  const labels = (await side.getByRole('link').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  for (const want of ['Dashboard', 'Find products', 'Product requests', 'Wallet', 'Settings', 'Support']) expect(labels).toContain(want);
  for (const hidden of ['Import list', 'Orders', 'Pricing and sync', 'Packing and shipping', 'Stores', 'Plan and billing', 'Reports']) expect(labels).not.toContain(hidden);
  await expect(page.getByTestId('dropship-store-switcher')).toHaveCount(0);
  await expect(page.getByTestId('ea-dashboard')).toBeVisible();
  await expect(page.getByTestId('ea-next-release')).toContainText('Store connection is the next release.');
  await expect(page.getByTestId('ea-step-store')).toContainText('Next release');
  await expect(page.getByTestId('ea-step-kyc')).toContainText('Done');
  await expect(page.getByTestId('dropship-merchant-shell').locator('main')).not.toContainText(/coming soon/i);

  for (const path of [
    '/account/dropship/stores', '/account/dropship/catalogue?list=1', '/account/dropship/push', '/account/dropship/pushed',
    '/account/dropship/pricing', '/account/dropship/packing', '/account/dropship/orders', '/account/dropship/reports',
    '/account/dropship/billing', '/account/dropship/sample',
  ]) {
    await page.goto(path);
    await expect(page, `${path} should go back to the dashboard (or the catalogue for the list)`).toHaveURL(path.includes('list=1') ? /\/account\/dropship\/catalogue$/ : /\/account\/dropship$/);
  }
  await page.goto('/account/dropship/catalogue');
  await expect(page.getByTestId('dropship-catalogue-v2')).toBeVisible();
  await expect(page.getByTestId('import-list-link')).toHaveCount(0);
  await expect(page.getByTestId('dropship-merchant-shell').locator('main')).not.toContainText(/coming soon|add to import list/i);
  await page.goto('/account/dropship/more');
  await expect(page.getByTestId('dropship-more-page')).toBeVisible();
  await expect(page.getByTestId('dropship-merchant-shell').locator('main')).not.toContainText(/coming soon|Import list|Order a sample|Pricing and sync/i);
  await page.goto('/account/dropship/onboarding');
  await expect(page.getByTestId('onboarding-step-btn-3')).toBeVisible();
  await expect(page.getByTestId('onboarding-step-btn-4')).toHaveCount(0);
  await expect(page.getByTestId('dropship-onboarding')).toContainText('3 short steps');
  await checkAxe(page, 'onboarding @1280');
  await page.goto('/account/dropship');
  await checkAxe(page, 'EA dashboard @1280');
});

test('EA-2 phone tabs: Home · Find · Requests · Wallet · More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await customerLogin(page, merchant!, '/account/dropship');
  await page.goto('/account/dropship');
  const tabs = page.getByTestId('dropship-phone-tabs');
  await expect(tabs).toBeVisible();
  expect((await tabs.getByRole('link').allInnerTexts()).map((t) => t.trim())).toEqual(['Home', 'Find', 'Requests', 'Wallet', 'More']);
  await tabs.getByRole('link', { name: 'Requests' }).click();
  await expect(page).toHaveURL(/\/account\/dropship\/requests/);
  await expect(tabs.getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/account/dropship');
  await checkAxe(page, 'EA dashboard @390');
});

test('EA-2 public /request/dropship for signed-out visitors; signed-in customers go to the app', async ({ page, browser }) => {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/request/dropship');
    await expect(page.getByTestId('public-dropship')).toBeVisible();
    await expect(page.locator('h1')).toContainText('We pack and ship every order under your brand.');
    await expect(page.getByTestId('public-dropship-signup')).toHaveAttribute('href', '/signup?next=%2Faccount%2Fdropship');
    await expect(page.getByTestId('public-dropship-login')).toHaveAttribute('href', '/login?next=%2Faccount%2Fdropship');
    await expect(page.getByTestId('public-dropship-faq')).toContainText('In the next release.');
    await expect(page.locator('main')).not.toContainText(/\[|coming soon/i);
    await checkAxe(page, `public dropship @${w}`);
  }
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await customerLogin(p2, merchant!, '/account');
    await p2.goto('/request/dropship');
    await expect(p2).toHaveURL(/\/account\/dropship$/);
  } finally {
    await ctx.close();
  }
});
