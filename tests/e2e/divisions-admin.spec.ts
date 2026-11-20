import { test, expect, type Page } from '@playwright/test';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * Divisions step 4 (19 Nov 2026) — STAGING ONLY. A company-wide Admin (temporary, own 2FA):
 *  · sees Admin › Company (legal details, bank details, change history) and Admin › Divisions (name / order / logo / active)
 *  · adds one staff member to THREE divisions in Admin › Staff, then removes one
 *  · switches the header to one division: the banner shows, the work queue and notifications follow it, "All" again
 * A staff member who is only in Product Sourcing sees just that division in the switcher, and no Company page.
 * Desktop 1440 + phone 390 screenshots into SHOTS_DIR.
 */
const SHOTS = process.env.SHOTS_DIR;
let admin: TempStaff | null = null;
let person: TempStaff | null = null;
let src: TempStaff | null = null;
test.describe.configure({ mode: 'serial' });

const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };
const both = async (page: Page, name: string, url: string, ready: () => Promise<void>) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url); await ready(); await shot(page, `${name}-desktop`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url); await ready(); await shot(page, `${name}-phone`);
  await page.setViewportSize({ width: 1440, height: 1000 });
};

test.beforeAll(async () => {
  admin = await createTempStaff('admin');
  const { data: env } = await admin.admin.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  person = await createTempStaff('qc_coordinator');
  src = await createTempStaff('operations');
  const div = (await admin.admin.from('divisions').select('id').eq('code', 'SRC').single()).data!.id as string;
  const { error } = await admin.admin.from('division_members').insert({ user_id: src.id, division_id: div, role: 'staff' });
  if (error) throw new Error(`division_members: ${error.message}`);
});
test.afterAll(async () => {
  for (const t of [admin, person, src]) {
    if (!t) continue;
    await t.admin.from('division_members').delete().eq('user_id', t.id);
    await deleteTempStaff(t);
  }
});

test('Admin › Company and Admin › Divisions', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffLogin(page, admin!, '/admin/company');
  await both(page, 'step4-company', '/admin/company', async () => {
    await expect(page.getByLabel('Legal name', { exact: true })).toHaveValue('Shenzhen Octopus Trading Co., Ltd.');
    await expect(page.getByLabel('Registration no.')).toHaveValue('');   // not given yet — left empty
    await expect(page.getByLabel('Tax ID')).toHaveValue('');
  });
  await both(page, 'step4-divisions', '/admin/divisions', async () => {
    for (const n of ['Dropshipping', 'Make My Brand', 'Product Sourcing', 'MOQ Pools', 'Turnkey Projects', '3PL & Shipping']) await expect(page.getByLabel('Name').and(page.locator(`[value="${n}"]`))).toBeVisible();
  });
});

test('Admin › Staff: one person added to three divisions, then one removed', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffLogin(page, admin!, '/admin/staff');
  await page.goto(`/admin/staff?user=${person!.id}#add-division`);
  const form = page.locator('#add-division');
  await form.getByLabel('Person').selectOption(person!.id);
  for (const d of ['Make My Brand', 'Product Sourcing', 'Turnkey Projects']) await form.getByLabel(d).check();
  await form.getByLabel('Role in these divisions').selectOption('staff');
  await form.getByRole('button', { name: 'Add to divisions' }).click();
  await expect(form.getByText(/Added to .*Make My Brand.*Product Sourcing.*Turnkey Projects/)).toBeVisible({ timeout: 20_000 });
  await page.goto(`/admin/staff#divisions`);
  const row = page.getByTestId(`div-row-${person!.email}`);
  for (const d of ['Make My Brand', 'Product Sourcing', 'Turnkey Projects']) await expect(row.getByText(d, { exact: true })).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await page.locator('#divisions').scrollIntoViewIfNeeded();
  await shot(page, 'step4-staff-divisions-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/staff#divisions`); await page.locator('#divisions').scrollIntoViewIfNeeded();
  await shot(page, 'step4-staff-divisions-phone');
  await page.setViewportSize({ width: 1440, height: 1000 });
  // remove one; the other two stay
  await page.goto(`/admin/staff#divisions`);
  await page.getByTestId(`div-row-${person!.email}`).getByRole('button', { name: 'Remove from Turnkey Projects' }).click();
  await expect(page.getByTestId(`div-row-${person!.email}`).getByText('Turnkey Projects', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  const { data } = await admin!.admin.from('division_members').select('role, divisions(code)').eq('user_id', person!.id);
  expect((data ?? []).map((r) => (r.divisions as unknown as { code: string }).code).sort()).toEqual(['MMB', 'SRC']);
});

test('header division switcher: lists, counts and notifications follow it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffLogin(page, admin!, '/admin');
  const sw = page.getByTestId('division-switcher').getByLabel('Division');
  await expect(sw.locator('option')).toHaveCount(7);                         // All + 6 divisions (company-wide Admin)
  await sw.selectOption('MMB');
  await expect(page.getByTestId('division-banner')).toContainText('Make My Brand', { timeout: 20_000 });
  await shot(page, 'step4-switcher-mmb-desktop');
  await page.goto('/admin/notifications');
  await expect(page.getByTestId('division-banner')).toContainText('Make My Brand');
  await page.goto('/office/orders?f=all');
  await expect(page.getByTestId('division-banner')).toBeVisible();
  await expect(page.locator('tbody').getByText('TEST-ORD-SRC')).toHaveCount(0);   // a Sourcing order is not in the Make My Brand list
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin'); await shot(page, 'step4-switcher-mmb-phone');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId('division-banner').getByRole('button', { name: 'Show all divisions' }).click();
  await expect(page.getByTestId('division-banner')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('division-switcher').getByLabel('Division')).toHaveValue('all');
});

test('a Product Sourcing staff member sees only that division and no Company page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffLogin(page, src!, '/office');
  await expect(page.getByTestId('division-switcher')).toBeVisible({ timeout: 20_000 });
  const opts = await page.getByTestId('division-switcher').getByLabel('Division').locator('option').allTextContents();
  expect(opts).toEqual(['Product Sourcing']);
  await page.goto('/admin/company');
  await expect(page).toHaveURL(/forbidden/);
});
