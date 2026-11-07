import { test, expect } from '@playwright/test';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * Admin › Site content › Company › Bank accounts (7 Nov 2026). A temporary admin (own TOTP, deleted afterwards) adds an
 * account in the ISO test currency XTS — no buyer ever pays in XTS, so nothing shows on live pages — and deletes it.
 */
let t: TempStaff | null = null;
test.afterAll(async () => {
  if (t) await t.admin.from('company_bank_accounts').delete().eq('currency', 'XTS');
  await deleteTempStaff(t);
});

test('an admin adds and deletes a company bank account (audited)', async ({ page }) => {
  t = await createTempStaff('admin');
  await staffLogin(page, t, '/admin/content?tab=company');
  await page.goto('/admin/content?tab=company');
  const box = page.getByTestId('bank-accounts');
  await expect(box).toBeVisible();
  page.on('dialog', (d) => d.accept());
  await box.locator('#new-bank-cur').fill('XTS');
  await box.locator('#new-bank-bank').fill('E2E Test Bank');
  await box.locator('#new-bank-acc').fill('E2E 0000 1111');
  await box.locator('#new-bank-swift').fill('TESTHKHH');
  await box.getByRole('button', { name: 'Add bank account' }).click();
  await expect(box.getByText('XTS', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { data: row } = await t.admin.from('company_bank_accounts').select('id, account_holder, account_number, swift, active').eq('currency', 'XTS').single();
  expect(row).toMatchObject({ account_number: 'E2E 0000 1111', swift: 'TESTHKHH', active: true });
  expect(row!.account_holder.length).toBeGreaterThan(2);   // defaults to the company's legal name
  const { data: audit } = await t.admin.from('audit_log').select('action').eq('entity_id', row!.id);
  expect(audit?.map((a) => a.action)).toContain('company_bank_account.created');
  // the delete button removes it again
  await box.locator('div.rounded-\\[12px\\]', { hasText: 'E2E Test Bank' }).getByRole('button', { name: 'Delete' }).click();
  await expect(box.getByText('E2E Test Bank')).toHaveCount(0, { timeout: 20_000 });
  await t.admin.from('audit_log').delete().eq('entity_id', row!.id);   // test record only
});
