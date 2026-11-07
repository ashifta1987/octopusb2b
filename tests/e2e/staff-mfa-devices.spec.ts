import { test, expect } from '@playwright/test';
import { createTempStaff, deleteTempStaff, staffLogin, totp, type TempStaff } from './helpers/staff';

/**
 * Staff 2FA: link a second phone (8 Nov 2026). A temporary staff member (own TOTP) adds "Phone 2", signs in again with a
 * code from Phone 2 only, removes Phone 1, and cannot remove the last phone. Deleted afterwards.
 */
let t: TempStaff | null = null;
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
test.afterAll(async () => { await deleteTempStaff(t); });

test('add a second authenticator, sign in with it, remove the first, keep at least one', async ({ page, context }) => {
  t = await createTempStaff('support');
  await staffLogin(page, t, '/office');
  await page.goto('/staff/account#2fa');
  const box = page.getByTestId('mfa-devices');
  await expect(box.locator('li')).toHaveCount(1);
  await expect(box.getByRole('button', { name: 'Remove' })).toHaveCount(0);   // the only phone cannot be removed

  await page.getByTestId('add-authenticator').click();
  await page.locator('#mfa-name').fill('Phone 2');
  await page.getByRole('button', { name: 'Show QR code' }).click();
  await expect(page.getByTestId('mfa-enroll').locator('img')).toBeVisible();
  await page.getByText("Can't scan? Enter the key instead").click();
  const secret2 = (await page.getByTestId('mfa-secret').innerText()).trim();
  if (Date.now() / 1000 % 30 > 26) await page.waitForTimeout(4500);
  await page.locator('#mfa-code').fill(totp(secret2));
  await page.getByRole('button', { name: 'Confirm and add' }).click();
  await expect(page.getByText('Phone 2 added.')).toBeVisible();
  await expect(box.locator('li')).toHaveCount(2);

  // sign in again using ONLY the new phone's code
  await context.clearCookies();
  await staffLogin(page, { ...t, secret: secret2 }, '/office');
  await page.goto('/staff/account#2fa');

  // remove the first phone (the session was just verified, so no extra code is asked)
  page.once('dialog', (d) => d.accept());
  await box.locator('li').filter({ hasNotText: 'Phone 2' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(/removed\./)).toBeVisible();
  await expect(box.locator('li')).toHaveCount(1);
  await expect(box.locator('li')).toContainText('Phone 2');
  await expect(box.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});
