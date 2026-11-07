import { test, expect, type Page } from '@playwright/test';
import { createTempCustomer, customerLogin, purgeTestOrgs, adminClient, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * ADDON-41 · 41-B shared parts — STAGING ONLY (refuses to run against production).
 * Run: set -a; . ./.env.staging; set +a; E2E_BASE_URL=http://localhost:3100 pnpm playwright test tests/e2e/one-app-shared.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR;
let A: TempCustomer | null = null;
let B: TempCustomer | null = null;
let fin: TempStaff | null = null;
let mgr: TempStaff | null = null;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const { data } = await adminClient().from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (data?.value !== 'staging') throw new Error('one-app-shared.spec runs on the staging database only');
  A = await createTempCustomer('41a');
  B = await createTempCustomer('41b');
});
test.afterAll(async () => {
  await deleteTempStaff(fin); await deleteTempStaff(mgr);
  await purgeTestOrgs([A?.orgId, B?.orgId].filter(Boolean) as string[], [A?.id, B?.id].filter(Boolean) as string[]);
});

const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('My account home: service tabs, waiting for you, account manager, wallet with W- reference, services', async ({ page }) => {
  await customerLogin(page, A!, '/account');
  await expect(page.locator('h1:visible')).toHaveText(/E2E Buyer 41a LLC/);
  await expect(page.getByTestId('account-tabs').getByRole('link')).toHaveText(['Home', 'Sourcing', 'Dropshipping', '3PL warehouse', 'Make My Brand', 'Wallet and invoices']);
  await expect(page.getByTestId('staging-badge')).toHaveText(/Prototype · example data/i);
  await expect(page.getByTestId('waiting')).toContainText('Nothing needs you right now');
  await expect(page.getByTestId('wallet-card')).toContainText(/W-\d{5}/);
  await expect(page.getByTestId('service-sourcing')).toContainText('On');
  await expect(page.getByTestId('service-dropship')).toContainText('Start');
  await shot(page, '01-account-home-desktop');
  await page.getByTestId('service-dropship').getByRole('link', { name: /Start/ }).click();
  await expect(page.getByTestId('service-start')).toBeVisible();
});

test('My account on a phone: tabs scroll, bottom bar shown', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await customerLogin(page, A!, '/account');
  await expect(page.getByTestId('account-bottom-bar')).toBeVisible();
  await expect(page.getByTestId('account-tabs')).toBeVisible();
  await shot(page, '10-account-home-phone');
  await ctx.close();
});

test('bank transfer: customer uploads a slip, finance credits the amount received, receipt issued', async ({ page, browser }) => {
  await customerLogin(page, A!, '/account/wallet');
  await expect(page.getByTestId('bank-details')).toContainText('STAGING TEST BANK');
  await page.locator('#tf-amount').fill('250.00');
  await page.locator('#tf-ref').fill('E2E-TT-1');
  await page.locator('#tf-slip').setInputFiles({ name: 'slip.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% e2e slip\n') });
  await page.getByRole('button', { name: 'Send to finance' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent. Finance checks' })).toBeVisible();
  await expect(page.getByText('Being checked').first()).toBeVisible();

  fin = await createTempStaff('finance');
  const ctx = await browser.newContext();
  const fp = await ctx.newPage();
  await staffLogin(fp, fin, '/admin/finance/transfers');
  const row = fp.getByTestId('transfer-row').filter({ hasText: 'E2E Buyer 41a LLC' });
  await expect(row).toContainText('US$ 250.00');
  await row.locator('input[name="received"]').fill('245.00');               // bank fee deducted
  await row.locator('input[name="bank_ref"]').fill('SCB-E2E-1');
  fp.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Confirm and credit' }).click();
  await expect(fp.getByText('Confirmed. The wallet is credited')).toBeVisible();
  await ctx.close();

  await page.goto('/account/wallet');
  await expect(page.getByTestId('wallet-balance')).toContainText('US$ 245.00');
  await page.goto('/account/invoices');
  await expect(page.getByText(/RCT-W-/)).toBeVisible();
});

test('staff cannot use My account', async ({ page }) => {
  await staffLogin(page, fin!, '/admin');
  await page.goto('/account');
  await expect(page).toHaveURL(/\/admin\?notice=staff-not-customer/);
});

test('an account manager sees only their own customer; work queue and limits render', async ({ page }) => {
  mgr = await createTempStaff('account_manager');
  const admin = adminClient();
  const { error } = await admin.from('account_managers').insert({ org_id: A!.orgId, staff_user_id: mgr.id, is_primary: true });
  if (error) throw new Error(error.message);
  await staffLogin(page, mgr, '/admin');
  await expect(page.getByTestId('staff-only')).toBeVisible();
  await expect(page.getByTestId('work-queue')).toBeVisible();
  await expect(page.getByText('The owner has not set your limits yet')).toBeVisible();
  await shot(page, '06-admin-work-queue-desktop');
  await page.goto('/admin/customers');
  await expect(page.getByText('E2E Buyer 41a LLC')).toBeVisible();
  await expect(page.getByText('E2E Buyer 41b LLC')).toHaveCount(0);
  await page.goto(`/admin/customers/${B!.orgId}`);
  await expect(page.locator('body')).not.toContainText('E2E Buyer 41b LLC');
});

test('customer pages never show staff-only data (supplier names, carriers)', async ({ page }) => {
  const admin = adminClient();
  const [{ data: sups }, { data: carriers }] = await Promise.all([
    admin.from('suppliers').select('legal_name').not('legal_name', 'is', null),
    admin.from('carriers').select('name'),
  ]);
  const secrets = [...(sups ?? []).map((s) => s.legal_name as string), ...(carriers ?? []).map((c) => c.name as string)].filter((x) => x && x.length > 3);
  await customerLogin(page, A!, '/account');
  for (const path of ['/account', '/account/wallet', '/account/invoices', '/account/notifications', '/account/sourcing', '/account/orders', '/account/dropship', '/account/warehouse', '/account/brand']) {
    await page.goto(path);
    const html = await page.content();
    for (const sec of secrets) expect(html.includes(sec), `${path} must not contain "${sec}"`).toBe(false);
    for (const field of ['supplier_cost', 'carrier_code', 'min_margin_pct', 'max_amount_cents']) expect(html.includes(field), `${path} must not contain ${field}`).toBe(false);
  }
});

