import { test, expect } from '@playwright/test';
import { createTempStaff, deleteTempStaff, totp, type TempStaff } from './helpers/staff';

/**
 * /staff/verify (20 Nov 2026): the "Back" link used to be a <form> inside the code <form> (invalid HTML, React
 * hydration warning). Staff 2FA sign-in must still work, "Back" must still sign out, and the page must load without the
 * nested-form warning. Temporary staff user with its own authenticator, deleted afterwards. STAGING (or local) only.
 */
let staff: TempStaff | null = null;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { staff = await createTempStaff('operations'); });
test.afterAll(async () => { await deleteTempStaff(staff); });

const toVerify = async (page: import('@playwright/test').Page, warnings: string[]) => {
  page.on('console', (m) => { if (/cannot be a descendant of <form>|hydration/i.test(m.text())) warnings.push(m.text()); });
  await page.goto('/staff/login?next=/office');
  await page.getByLabel('Work email').fill(staff!.email);
  await page.getByLabel('Password', { exact: true }).fill(staff!.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/staff\/verify/);
  await expect(page.getByLabel('Digit 1 of 6')).toBeVisible();
};

test('staff 2FA sign-in still works, without the nested-form warning', async ({ page }) => {
  const warnings: string[] = [];
  await toVerify(page, warnings);
  await expect(page.locator('form form')).toHaveCount(0);                       // no form inside a form
  if (Date.now() / 1000 % 30 > 26) await page.waitForTimeout(4500);
  await page.getByLabel('Digit 1 of 6').click();
  await page.keyboard.type(totp(staff!.secret));
  const btn = page.getByRole('button', { name: /verify/i }).first();
  if (await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
  await page.waitForURL((u) => !/\/staff\/(login|verify)/.test(u.pathname), { timeout: 20_000 });
  if (/\/staff\/workspace/.test(page.url())) await page.goto('/office');
  await expect(page).toHaveURL(/\/office/);
  expect(warnings, warnings.join('\n')).toEqual([]);
});

test('"Back" on the code screen signs out and returns to sign-in', async ({ page }) => {
  const warnings: string[] = [];
  await toVerify(page, warnings);
  await page.getByTestId('staff-verify-back').click();
  await page.waitForURL(/\/staff\/login/, { timeout: 20_000 });
  await page.goto('/office');
  await expect(page).toHaveURL(/\/staff\/login/);                               // really signed out
  expect(warnings, warnings.join('\n')).toEqual([]);
});
