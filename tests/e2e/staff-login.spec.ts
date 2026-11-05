import { expect, test, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * SPEC §17 — staff & back-office login (skeleton; selectors use accessible labels/roles).
 *  1. Invite → set password → enrol 2FA (TOTP computed here) → backup codes → choose workspace.
 *  2. A customer cannot open /office or /admin.
 *  3. Wrong passwords show the remaining attempts (lockout itself is covered by supabase/tests/staff-auth.test.mjs).
 * Needs SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL (invite via the admin API) and DEMO_PASSWORD.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const BUYER = process.env.E2E_BUYER_EMAIL ?? 'buyer@demo.octopusb2b.com';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function typeCode(page: Page, code: string) {
  await page.getByLabel('Digit 1 of 6').click();
  await page.keyboard.type(code);
}

test.describe('Staff login — invite → set password → 2FA → workspace', () => {
  test.skip(!SERVICE || !URL_ || !PASSWORD, 'service role / DEMO_PASSWORD not set');
  let userId = '';

  test.afterAll(async () => {
    if (!userId) return;
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    await admin.auth.admin.deleteUser(userId);
  });

  test('an invited staff member reaches their workspace', async ({ page }) => {
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const email = `e2e.staff+${Date.now()}@demo.octopusb2b.com`;
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: `${BASE}/staff/set-password?type=invite` } });
    expect(error).toBeNull();
    userId = link!.user!.id;
    await admin.from('profiles').upsert({ id: userId, full_name: 'E2E Staff', email });
    await admin.from('user_roles').insert({ user_id: userId, role_code: 'operations' });

    // 1. invite link → set password
    await page.goto(link!.properties!.action_link);
    await page.waitForURL(/\/staff\/set-password/);
    await page.getByLabel('New password').fill(`${PASSWORD}x1`);
    await page.getByLabel('Repeat password').fill(`${PASSWORD}x1`);
    await page.getByRole('button', { name: /save password/i }).click();

    // 2. enrol 2FA: read the manual key, compute the code
    await page.waitForURL(/\/staff\/verify/);
    await page.getByRole('button', { name: /enter a key instead/i }).click();
    const secret = (await page.locator('.select-all').innerText()).trim();
    await typeCode(page, totp(secret));
    await page.getByRole('button', { name: /verify and continue/i }).click();
    await expect(page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem')).toHaveCount(10);
    await page.getByLabel(/saved these codes/i).check();
    await page.getByRole('button', { name: /continue/i }).click();

    // 3. workspace chooser (operations has several areas) → Back office
    await page.waitForURL(/\/staff\/workspace|\/office/);
    if (/workspace/.test(page.url())) {
      await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
      await page.getByRole('button', { name: /back office/i }).click();
    }
    await page.waitForURL(/\/office/);
    await expect(page.getByRole('button', { name: /account menu/i }).or(page.getByLabel('Account menu'))).toBeVisible();
  });
});

test.describe('Staff areas are closed to customers', () => {
  test.skip(!PASSWORD, 'DEMO_PASSWORD not set');

  test('signed-out visitors are sent to the staff login', async ({ page }) => {
    await page.goto('/office');
    await expect(page).toHaveURL(/\/staff\/login\?next=%2Foffice/);
    await expect(page.getByRole('heading', { name: /sign in to the back office/i })).toBeVisible();
  });

  test('a customer cannot open /office or /admin', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('tab', { name: /log in/i }).click();
    await page.getByLabel(/email/i).fill(BUYER);
    await page.getByLabel(/^password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^log in$/i }).click();
    await page.waitForURL(/\/account/);
    for (const path of ['/office', '/admin']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    }
  });

  test('the staff login refuses a customer account', async ({ page }) => {
    await page.goto('/staff/login');
    await page.getByLabel('Work email').fill(BUYER);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText(/staff portal/i);
  });

  test('a wrong password shows the remaining attempts', async ({ page }) => {
    await page.goto('/staff/login');
    await page.getByLabel('Work email').fill(`nobody+${Date.now()}@demo.octopusb2b.com`);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-1');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText(/attempts? left/i);
  });
});
