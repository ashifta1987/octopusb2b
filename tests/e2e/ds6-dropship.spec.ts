import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Release 2 · Step 6 + 6b merchant E2E (STAGING ONLY) — Match: screens/ImportList, ProductEditor, PushStore, Pushed, Pricing,
 * PackingShipping, states/States-Import and the mobile/M_ versions. Desktop 1280 px and phone 390 px, axe clean.
 *  1. Import list (?list=1): the product row, chips, rule bar, "Save your pricing rule" until a rule is saved; bulk add
 *     by CSV says why lines were skipped.
 *  2. Pricing and sync: save the rule; approvals + sync log show honest empty states; Sync now is disabled with a reason.
 *  3. Packing and shipping: US defaults to DDP, duties saved per country, unknown fees can't be chosen, "Connect a store
 *     to map rates".
 *  4. Product editor: the white-label check names the FIELD ("Octopus" in the title is refused), the copy saves, Push is
 *     disabled with "Connect a store first."
 *  5. Push to Shopify and Pushed products: the honest "Connect a store first" states — nothing is queued.
 *  6. Phone 390 px: every screen, phone tabs, no sideways overflow, axe.
 * The spec turns every Dropship feature on (staging) and dropship_v2_ui on, and puts the original values back.
 */
test.describe.configure({ mode: 'serial' });

const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let merchant: TempCustomer | null = null;
let product: { id: string; model_no: string } | null = null;
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];
const SHOTS = process.env.DS6_SHOTS;

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}
async function noOverflow(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} must not overflow sideways`).toBe(true);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  merchant = await createTempCustomer('ds6');
  const sb = adminClient();
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'DS6 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
    await db.query(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = coalesce(company_services.started_at, now())`, [merchant.orgId]);
    for (const c of ['AE', 'US']) await db.query(`insert into dropship_markets(org_id, country) values ($1, $2) on conflict do nothing`, [merchant.orgId, c]);
    await db.query(`insert into dropship_seller_profiles (org_id, brand_name, return_name, return_line1, return_city, return_country) values ($1, 'E2E Home', 'E2E', '1 Road', 'Dubai', 'AE') on conflict (org_id) do nothing`, [merchant.orgId]);
    // a product this merchant can see (asked as the merchant, like the catalogue does)
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: merchant.id, role: 'authenticated', aal: 'aal1' })]);
    await db.query('set local role authenticated');
    const row = (await db.query(`select product_id, model_no from public.get_dropship_catalogue('AE', null, null, 1) limit 1`)).rows[0];
    await db.query('rollback');
    if (!row) throw new Error('no catalogue product visible to the test merchant on staging');
    product = { id: row.product_id, model_no: row.model_no };
    await db.query(`insert into dropship_import_list (org_id, product_id, added_by) values ($1, $2, $3) on conflict do nothing`, [merchant.orgId, product.id, merchant.id]);
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const sb = adminClient();
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  if (merchant) await purgeTestOrgs([merchant.orgId], [merchant.id]);
});

test('Import list @1280: product row, chips, rule bar, bulk add says why lines were skipped', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, merchant!, '/account/dropship/catalogue?list=1');
  await page.goto('/account/dropship/catalogue?list=1');
  const root = page.getByTestId('ds6-import-list');
  await expect(root).toBeVisible();
  await expect(root.locator('h1')).toContainText('Import list');
  await expect(page.getByTestId('ds6-chips')).toContainText('Import list (1)');
  await expect(page.getByTestId(`import-row-${product!.model_no}`)).toBeVisible();
  await expect(page.getByTestId('import-rule-summary')).toContainText('Not saved yet');
  await expect(page.getByTestId(`status-${product!.model_no}`)).toBeVisible();
  await expect(page.getByTestId('push-selected')).toContainText('Push selected (1)');
  await expect(root).not.toContainText(/supplier|factory model|unit cost/i);
  await page.getByTestId('bulk-file').setInputFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from('model_no,variant\nDS-999999,\n') });
  await expect(page.getByTestId('import-notice')).toContainText('1 of 1 lines were skipped');
  await expect(page.getByTestId('bulk-skipped')).toContainText("DS-999999 doesn't exist or isn't available to you.");
  await checkAxe(page, 'import list @1280');
  await shot(page, 'ds6-import-list-1280');
});

test('Pricing and sync @1280: save the rule; honest empty approvals + sync log; Sync now disabled with a reason', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, merchant!, '/account/dropship/pricing');
  await page.goto('/account/dropship/pricing');
  await expect(page.getByTestId('ds6-pricing')).toBeVisible();
  await expect(page.getByTestId('rules-not-saved')).toBeVisible();
  await expect(page.getByTestId('sync-now')).toBeDisabled();
  await expect(page.getByTestId('ds6-pricing').getByTestId('disabled-reason').first()).toBeVisible();
  await expect(page.getByTestId('approvals')).toContainText('Nothing waiting');
  await expect(page.getByTestId('sync-log')).toContainText('No sync activity yet');
  await page.getByLabel('Minimum margin (%)').fill('30');
  await page.getByTestId('save-rules').click();
  await expect(page.getByTestId('pricing-notice')).toContainText('Rules saved');
  await page.reload();
  await expect(page.getByTestId('rules-not-saved')).toHaveCount(0);
  await expect(page.getByLabel('Minimum margin (%)')).toHaveValue('30');
  await checkAxe(page, 'pricing @1280');
  await shot(page, 'ds6-pricing-1280');
});

test('Packing and shipping @1280: US is DDP by default, duties saved, unknown fees not choosable, connect a store to map rates', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, merchant!, '/account/dropship/packing');
  await page.goto('/account/dropship/packing');
  await expect(page.getByTestId('ds6-packing')).toBeVisible();
  await expect(page.getByLabel('Duties for United States')).toHaveValue('DDP');
  await expect(page.getByTestId('rates-connect-store')).toContainText('Connect a store to map rates');
  await expect(page.getByRole('radio', { name: /Protective/ })).toBeDisabled();
  await expect(page.getByTestId('default-packaging')).toContainText('Not set yet');
  await page.getByLabel('Duties for United Arab Emirates').selectOption('DAP');
  await page.getByTestId('save-packing').click();
  await expect(page.getByTestId('packing-notice')).toContainText('Changes saved');
  await page.reload();
  await expect(page.getByLabel('Duties for United Arab Emirates')).toHaveValue('DAP');
  await expect(page.getByLabel('Duties for United States')).toHaveValue('DDP');
  await checkAxe(page, 'packing @1280');
  await shot(page, 'ds6-packing-1280');
});

test('Product editor @1280: white-label check names the field, the copy saves, Push says connect a store', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, merchant!, '/account/dropship/catalogue?list=1');
  await page.goto('/account/dropship/catalogue?list=1');
  await page.getByTestId(`edit-${product!.model_no}`).click();
  await expect(page).toHaveURL(new RegExp(`/account/dropship/import/${product!.id}`));
  const editor = page.getByTestId('ds6-editor');
  await expect(editor.locator('h1')).toContainText('Edit before pushing');
  await expect(page.getByTestId('editor-variants')).toContainText(/DS-\d{6}-\d{2}/);
  const title = page.getByLabel('Title', { exact: true });
  const original = await title.inputValue();
  await title.fill(`${original} by Octopus`);
  await expect(page.getByTestId('text-check')).toContainText('Check: Title', { timeout: 10_000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-result')).toContainText('mentions a supplier name');
  await title.fill(`E2E ${original}`.slice(0, 200));
  await expect(page.getByTestId('text-check')).toContainText('No supplier or factory names found', { timeout: 10_000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-result')).toContainText('Saved');
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(`E2E ${original}`.slice(0, 200));
  await expect(page.getByTestId('editor-push')).toBeDisabled();
  await expect(page.getByTestId('editor-ready')).toContainText('connect a store first');
  await checkAxe(page, 'editor @1280');
  await shot(page, 'ds6-editor-1280');
});

test('Push to Shopify + Pushed products @1280: "Connect a store first", nothing queued', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, merchant!, `/account/dropship/push?ids=${product!.id}`);
  await page.goto(`/account/dropship/push?ids=${product!.id}`);
  await expect(page.getByTestId('ds6-push').locator('h1')).toContainText('Push to Shopify');
  await expect(page.getByTestId('push-connect-store')).toContainText('Connect a store first');
  await expect(page.getByTestId('push-start')).toBeDisabled();
  await expect(page.getByTestId('push-settings').getByTestId('disabled-reason')).toContainText('Connect a store first.');
  await expect(page.getByTestId('push-progress')).toContainText('No push yet');
  await checkAxe(page, 'push @1280');
  await shot(page, 'ds6-push-1280');

  await page.goto('/account/dropship/pushed');
  await expect(page.getByTestId('ds6-pushed').locator('h1')).toContainText('Pushed products');
  await expect(page.getByTestId('pushed-connect-store')).toContainText('Connect a store first');
  await expect(page.getByTestId('pushed-empty')).toContainText('Nothing pushed yet');
  await expect(page.getByTestId('sync-all')).toBeDisabled();
  await expect(page.getByTestId('pushed-failed')).toContainText('No failed pushes.');
  await checkAxe(page, 'pushed @1280');
  await shot(page, 'ds6-pushed-1280');

  const db = pgClient();
  await db.connect();
  try {
    const n = Number((await db.query(`select (select count(*) from dropship_push_batches where org_id = $1) + (select count(*) from dropship_push_jobs where org_id = $1) n`, [merchant!.orgId])).rows[0].n);
    expect(n, 'no push batch or job exists without a store').toBe(0);
  } finally {
    await db.end();
  }
});

test('Phone 390 px: every Step 6 screen, phone tabs, no sideways overflow, axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await customerLogin(page, merchant!, '/account/dropship/catalogue?list=1');
  const screens: [string, string, string][] = [
    ['/account/dropship/catalogue?list=1', 'ds6-import-list', 'm-import-list'],
    [`/account/dropship/import/${product!.id}`, 'ds6-editor', 'm-editor'],
    [`/account/dropship/push?ids=${product!.id}`, 'ds6-push', 'm-push'],
    ['/account/dropship/pushed', 'ds6-pushed', 'm-pushed'],
    ['/account/dropship/pricing', 'ds6-pricing', 'm-pricing'],
    ['/account/dropship/packing', 'ds6-packing', 'm-packing'],
  ];
  for (const [path, testId, name] of screens) {
    await page.goto(path);
    await expect(page.getByTestId(testId)).toBeVisible();
    await expect(page.getByTestId('dropship-phone-tabs')).toBeVisible();
    await noOverflow(page, `${name} @390`);
    await checkAxe(page, `${name} @390`);
    await shot(page, `ds6-${name}-390`);
  }
});

test('Import list: remove selected → honest empty state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, merchant!, '/account/dropship/catalogue?list=1');
  await page.goto('/account/dropship/catalogue?list=1');
  await page.getByTestId('remove-selected').click();
  await expect(page.getByTestId('import-list-empty')).toContainText('Your import list is empty');
  await expect(page.getByTestId('import-list-empty').getByRole('link', { name: 'Find products' })).toBeVisible();
  await checkAxe(page, 'empty import list @1280');
});
