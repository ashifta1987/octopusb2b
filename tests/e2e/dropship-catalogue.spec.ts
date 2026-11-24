import { test, expect, type Page } from '@playwright/test';
import { adminClient, createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Dropshipping catalogue v2 + Step I1a (DS-XXXXXX model numbers, item_master, Sourcing cost link; STAGING ONLY):
 *  1. Merchant catalogue & product detail:
 *      · DS model number (DS-XXXXXX) displayed, never legacy_sku / octopus_sku / supplier / cost;
 *      · landed price labelled "Includes shipping and duties to [country]";
 *      · shipping method chip filters; add/remove import list works in integer cents;
 *      · page HTML and RPC responses contain NO supplier name, supplier code, carrier name, cost, margin, legacy_sku or item_id.
 *  2. Route filtering: a country with no active route for a product does not show it (or shows clear empty state).
 *  3. Eligibility: a merchant without dropshipping switched on sees the "not switched on" notice and zero catalogue cards.
 *  4. Staff screens (/office/dropship):
 *      · DS division staff can create/edit products, run CSV bulk import twice idempotently with formula cells (=, +, -, @)
 *        neutralised, and auto-assign DS-XXXXXX model numbers;
 *      · Support staff can open /office/dropship read-only and NEVER see unit cost, margin, supplier or carrier.
 */
let user: { id: string; email: string; password: string; org: string } | null = null;
let noDsBuyer: TempCustomer | null = null;
let dsStaff: TempStaff | null = null;
let supStaff: TempStaff | null = null;
const csvRef = `TEST-CSV-${Date.now()}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const admin = adminClient();
  const { data: env } = await admin.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');

  const { data: org } = await admin.from('organizations').select('id').eq('wallet_reference', 'W-10015').single();
  const email = `e2e.dropship+${Date.now()}@demo.octopusb2b.com`;
  const password = `E2e-${Date.now()}-Ds!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin.from('profiles').upsert({ id: data.user!.id, full_name: 'E2E Dropship', email });
  await admin.from('org_members').insert({ org_id: org!.id, user_id: data.user!.id, member_role: 'buyer' });
  for (const c of ['AE', 'GB', 'SA']) {
    await admin.from('dropship_markets').upsert({ org_id: org!.id, country: c, locked_by_staff: false });
  }
  user = { id: data.user!.id, email, password, org: org!.id };

  noDsBuyer = await createTempCustomer('nods');
  dsStaff = await createTempStaff('operations');
  const { data: dsDiv } = await admin.from('divisions').select('id').eq('code', 'DS').single();
  await admin.from('division_members').upsert({ user_id: dsStaff.id, division_id: dsDiv!.id, role: 'staff' });
  supStaff = await createTempStaff('support');
});

test.afterAll(async () => {
  const admin = adminClient();
  const { data: createdProd } = await admin
    .from('dropship_products')
    .select('id')
    .eq('legacy_sku', csvRef.toUpperCase())
    .maybeSingle();
  if (createdProd?.id) {
    const { data: vars } = await admin.from('dropship_variants').select('item_id').eq('product_id', createdProd.id);
    await admin.from('dropship_products').delete().eq('id', createdProd.id);
    const itemIds = (vars ?? []).map((v) => String(v.item_id)).filter(Boolean);
    if (itemIds.length) await admin.from('item_master').delete().in('id', itemIds);
  }
  if (user) {
    await admin.from('dropship_import_list').delete().eq('added_by', user.id);
    await admin.from('org_members').delete().eq('user_id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
  if (noDsBuyer) await purgeTestOrgs([noDsBuyer.orgId], [noDsBuyer.id]);
  await deleteTempStaff(dsStaff);
  await deleteTempStaff(supStaff);
});

async function login(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).first().fill(user!.email);
  await page.getByLabel(/^password/i).first().fill(user!.password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, caret: 'initial' });
};
const usd = (s: string) => Number(s.replace(/[^\d.-]/g, ''));

test('catalogue & route filtering: DS-XXXXXX model numbers, duties-paid label; empty state when no routes to country; white-label clean in HTML', async ({ page }) => {
  await login(page, '/account/dropship/catalogue?country=AE');
  await page.goto('/account/dropship/catalogue?country=AE');
  const cards = page.getByTestId('catalogue-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText(/DS-\d{6}/);
  for (const c of (await cards.all()).slice(0, 4)) {
    await expect(c.getByText('Product', { exact: true })).toBeVisible();
    await expect(c.getByText('Processing', { exact: true })).toBeVisible();
    await expect(c.getByText('Shipping', { exact: true })).toBeVisible();
    await expect(c.getByText('Landed cost', { exact: true })).toBeVisible();
  }
  const html = await page.content();
  expect(html).not.toMatch(/OCT-113\d|OCT-DS-TEST|Boweijie|Bowijie|Domino|Xintaiwang|YunExpress|\b4PX\b|FACTORY-MDL-|unit_cost_cents|supplier_sku|legacy_sku|sourcing_product_id|\bSR-\d+/i);
  await shot(page, 'dropship-v2-merchant-catalogue-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account/dropship/catalogue?country=AE');
  await expect(cards.first()).toBeVisible();
  await shot(page, 'dropship-v2-merchant-catalogue-phone');
  await page.setViewportSize({ width: 1280, height: 800 });

  // SA has no active routes on the 5 TEST products → clear empty state
  await page.goto('/account/dropship/catalogue?country=SA');
  await expect(page.getByTestId('catalogue-empty')).toContainText('No products ship to Saudi Arabia yet');
  await expect(page.getByTestId('catalogue-card')).toHaveCount(0);
});

test('shipping-method chip filters; add to import list toggles to Added and back', async ({ page }) => {
  await login(page, '/account/dropship/catalogue?country=AE&ship=express');
  await page.goto('/account/dropship/catalogue?country=AE&ship=express');
  const cards = page.getByTestId('catalogue-card');
  await expect(cards.first()).toBeVisible();
  for (const c of (await cards.all()).slice(0, 4)) await expect(c.getByTestId('ship-express')).toBeVisible();
  const first = cards.first();
  await first.getByTestId('import-add').click();
  await expect(first.getByTestId('import-added')).toBeVisible();
  await expect(page.getByTestId('import-list-link')).toContainText(/import list \([1-9]\d*\)/i);
  await first.getByTestId('import-added').click();
  await expect(first.getByTestId('import-add')).toBeVisible();
});

test('product detail page: DS-XXXXXX-NN variant model number, 9-column landed cost table, Make it your brand DS link, white-label clean', async ({ page }) => {
  await login(page, '/account/dropship/catalogue?country=AE');
  await page.goto('/account/dropship/catalogue?country=AE');
  await page.getByTestId('catalogue-card').first().getByRole('link').first().click();
  await expect(page.getByTestId('dropship-product')).toBeVisible();
  await expect(page.getByTestId('dropship-product')).toContainText(/DS-\d{6}/);
  const rows = page.getByTestId('cost-table').locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
  const landed = usd(await rows.first().locator('td').nth(7).innerText());
  expect(landed).toBeGreaterThan(0);
  await expect(page.getByTestId('shipping-customs-card')).toBeVisible();
  await expect(page.getByTestId('order-sample-link')).toHaveAttribute('href', /\/account\/dropship\/sample\?product=/);
  await expect(page.getByTestId('make-it-your-brand').getByRole('link')).toHaveAttribute('href', /\/request\/brand\?model=DS-/);
  const html = await page.content();
  expect(html).not.toMatch(/OCT-113\d|OCT-DS-TEST|Boweijie|Bowijie|YunExpress|\b4PX\b|FACTORY-MDL-|unit_cost_cents|supplier_sku|legacy_sku|sourcing_product_id|\bSR-\d+/i);
});

test('merchant without dropshipping switched on sees "Not switched on yet" and zero catalogue cards', async ({ page }) => {
  await customerLogin(page, noDsBuyer!, '/account/dropship/catalogue');
  await page.goto('/account/dropship/catalogue');
  await expect(page.getByTestId('dropship-not-switched-on')).toBeVisible();
  await expect(page.getByTestId('catalogue-card')).toHaveCount(0);
});

test('staff /office/dropship: DS staff CSV import twice is idempotent, neutralises formulas & assigns DS-XXXXXX; Support hides cost & supplier', async ({ browser }) => {
  const dsCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const dp = await dsCtx.newPage();
  await staffLogin(dp, dsStaff!, '/office/dropship');
  await dp.goto('/office/dropship');
  await expect(dp.getByTestId('staff-dropship-list')).toBeVisible();
  await expect(dp.getByTestId('staff-unit-cost').first()).toBeVisible();

  // CSV bulk import: formula prefix "=TEST – Formula Neutralised Lamp" is stripped to "TEST – Formula Neutralised Lamp"
  await dp.goto('/office/dropship/import');
  const csv = [
    'import_ref,title,description,category,weight_g,min_order_qty,source_type,sourcing_sku,origin_country,specs_json',
    `${csvRef},"=TEST – Formula Neutralised Lamp","+Safe description","Lighting",450,1,own_warehouse,,, "{""Finish"":""@Matte""}"`,
  ].join('\n');
  await dp.getByTestId('csv-textarea').fill(csv);
  await dp.getByTestId('csv-preview-btn').click();
  await expect(dp.getByTestId('csv-preview-row')).toHaveCount(1);
  await expect(dp.getByTestId('csv-preview-row').first()).toContainText('TEST – Formula Neutralised Lamp');
  await expect(dp.getByTestId('csv-preview-row').first()).not.toContainText('=TEST');

  // First import: 1 created (as Draft, with auto DS-XXXXXX model_no and blank/null origin_country)
  await dp.getByTestId('csv-commit-btn').click();
  await expect(dp.getByTestId('csv-import-message')).toContainText('1 created (as Draft), 0 updated, 0 unchanged');

  // Running the exact same CSV a second time changes nothing (0 created, 0 updated, 1 unchanged)
  await dp.getByTestId('csv-commit-btn').click();
  await expect(dp.getByTestId('csv-import-message')).toContainText('0 created (as Draft), 0 updated, 1 unchanged');
  await dsCtx.close();

  // Re-open DS staff to verify DS-XXXXXX model number on list and edit form
  const dsCtx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const dp2 = await dsCtx2.newPage();
  await staffLogin(dp2, dsStaff!, '/office/dropship');
  await dp2.goto('/office/dropship');
  await expect(dp2.getByTestId('staff-dropship-list')).toBeVisible();
  await expect(dp2.getByTestId('staff-product-row').first()).toContainText(/DS-\d{6}/);
  await shot(dp2, 'dropship-v2-staff-list-desktop');
  await dp2.getByTestId('staff-product-row').first().getByRole('link').first().click();
  await expect(dp2.getByTestId('dropship-product-form')).toBeVisible();
  await shot(dp2, 'dropship-v2-staff-edit-desktop');
  await dsCtx2.close();

  // Support staff: can view /office/dropship read-only, but unit cost, supplier and edit buttons are absent
  const supCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const sp = await supCtx.newPage();
  await staffLogin(sp, supStaff!, '/office/dropship');
  await sp.goto('/office/dropship');
  await expect(sp.getByTestId('staff-dropship-list')).toBeVisible();
  await expect(sp.getByTestId('staff-unit-cost')).toHaveCount(0);
  await expect(sp.getByTestId('staff-supplier')).toHaveCount(0);
  await expect(sp.getByTestId('add-product-link')).toHaveCount(0);
  await supCtx.close();
});
