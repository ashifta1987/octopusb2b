import { test, expect, type Page } from '@playwright/test';
import { adminClient, customerLogin, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * Divisions step 5 (19 Nov 2026) — STAGING ONLY, uses the staging test data (scripts/seed-division-test-data.mjs).
 * Invoices as the CUSTOMER sees them (temporary member of "TEST DATA · Divisions", deleted afterwards):
 *  · Dropshipping tax invoice OCT-DS-…: Dropship logo, "Octopus B2B · Dropshipping" under Shenzhen Octopus Trading Co., Ltd.
 *  · Make My Brand tax invoice OCT-MMB-…: Octopus B2B logo, "Octopus B2B · Make My Brand"
 *  · Proforma PF-…: "PROFORMA – not a tax invoice"
 * Reports by division (temporary Admin): six divisions, Advertising on its own line, company total. Desktop + phone.
 */
const SHOTS = process.env.SHOTS_DIR;
let admin: TempStaff | null = null;
let cust: TempCustomer | null = null;
const docs: Record<string, string> = {};
test.describe.configure({ mode: 'serial' });
const shot = async (page: Page, name: string, fullPage = false) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage }); };

test.beforeAll(async () => {
  const a = adminClient();
  const { data: env } = await a.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  const org = (await a.from('organizations').select('id').eq('name', 'TEST DATA · Divisions').single()).data!.id as string;
  for (const [k, re] of [['ds', 'OCT-DS-%'], ['mmb', 'OCT-MMB-%'], ['pf', 'PF-%']] as const) {
    const { data } = await a.from('documents').select('id').eq('org_id', org).like('number', re).order('created_at').limit(1).single();
    docs[k] = data!.id as string;
  }
  const email = `e2e.invoice+${Date.now()}@demo.octopusb2b.com`, password = `E2e-${Math.random().toString(36).slice(2, 10)}-9!`;
  const { data: u } = await a.auth.admin.createUser({ email, password, email_confirm: true });
  await a.from('profiles').upsert({ id: u.user!.id, full_name: 'E2E invoice viewer', email });
  await a.from('org_members').insert({ org_id: org, user_id: u.user!.id, member_role: 'owner' });
  cust = { id: u.user!.id, email, password, orgId: org };
  admin = await createTempStaff('admin');
});
test.afterAll(async () => {
  const a = adminClient();
  if (cust) { await a.from('org_members').delete().eq('user_id', cust.id); await a.auth.admin.deleteUser(cust.id); }
  await deleteTempStaff(admin);
});

test('customer copies: division logo and name under the legal company; proforma notice', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1400 });
  await customerLogin(page, cust!, '/account');
  const open = async (id: string) => { await page.goto(`/api/documents/${id}/pdf`); await expect(page.locator('h1')).toBeVisible(); };

  await open(docs.ds);
  await expect(page.locator('.seller b')).toHaveText('Shenzhen Octopus Trading Co., Ltd.');
  await expect(page.getByTestId('division-line')).toHaveText('Octopus B2B · Dropshipping');
  await expect(page.locator('img.logo')).toHaveAttribute('data-logo', 'octopus-dropship');
  await expect(page.locator('h1 .num')).toHaveText(/^OCT-DS-\d{4}-\d{6}$/);
  await expect(page.locator('body')).not.toContainText(/OCT-\d{4}\b/);   // no supplier code on the customer copy
  await shot(page, 'invoice-dropship');

  await open(docs.mmb);
  await expect(page.getByTestId('division-line')).toHaveText('Octopus B2B · Make My Brand');
  await expect(page.locator('img.logo')).toHaveAttribute('data-logo', 'octopus-b2b');
  await expect(page.locator('h1 .num')).toHaveText(/^OCT-MMB-\d{4}-\d{6}$/);
  await shot(page, 'invoice-make-my-brand');

  await open(docs.pf);
  await expect(page.getByTestId('proforma-notice')).toHaveText('PROFORMA – not a tax invoice');
  await expect(page.locator('h1 .num')).toHaveText(/^PF-\d{4}-\d{6}$/);
  await shot(page, 'invoice-proforma');
});

test('Reports by division: six divisions, advertising on its own line, company total', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffLogin(page, admin!, '/admin/reports/divisions?months=all&test=1');
  await page.goto('/admin/reports/divisions?months=all&test=1');
  for (const c of ['DS', 'MMB', 'SRC', 'POOL', 'TK', '3PL']) await expect(page.getByTestId(`report-row-${c}`)).toBeVisible();
  await expect(page.getByTestId('report-row-advertising')).toContainText('Advertising');
  await expect(page.getByTestId('report-row-total')).toContainText('Company total');
  await shot(page, 'reports-divisions-desktop', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/reports/divisions?months=all&test=1');
  await expect(page.getByTestId('report-row-total')).toBeAttached();
  await shot(page, 'reports-divisions-phone');
});
