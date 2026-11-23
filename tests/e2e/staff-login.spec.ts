import { expect, test, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * SPEC §17 — staff & back-office login (skeleton; selectors use accessible labels/roles).
 *  1. Invite → set password → enrol 2FA (TOTP computed here) → backup codes → choose workspace.
 *  2. A customer cannot open /office or /admin.
 *  3. Wrong passwords show the remaining attempts (lockout itself is covered by supabase/tests/staff-auth.test.mjs).
 * Self-contained (20 Nov 2026): it creates its own temporary staff member and customer (random passwords) and deletes
 * them afterwards, so it never skips. It used to skip every case because it needed a shared DEMO_PASSWORD and the
 * staging demo buyer, whose sign-in is blocked. STAGING ONLY (it creates and deletes users): refuses otherwise.
 * Run: E2E_BASE_URL=http://localhost:3100 node scripts/with-staging-env.mjs npx playwright test tests/e2e/staff-login.spec.ts
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BASE = process.env.E2E_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const PASSWORD = `Staff-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 1000}`;   // this run only
let buyer: TempCustomer | null = null;

test.beforeAll(async () => {
  await assertStagingOrThrow();                       // Supabase URL + DB connection string are the staging project
  if (!URL_ || !SERVICE) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — run through scripts/with-staging-env.mjs');
});

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

    // 1. invite link → set password (use token_hash on local BASE when Supabase Auth strips localhost redirectTo)
    const targetUrl =
      link!.properties?.hashed_token && /^https?:\/\/localhost[:/]/.test(BASE)
        ? `/staff/set-password?token_hash=${encodeURIComponent(link!.properties.hashed_token)}&type=invite`
        : link!.properties!.action_link;
    await page.goto(targetUrl);
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
    // the staff header's account menu (a <details> summary with the sr-only label "Account menu:")
    await expect(page.locator('summary', { hasText: /account menu/i })).toBeVisible();
  });
});

test.describe('Staff areas are closed to customers', () => {
  test.beforeAll(async () => { buyer = await createTempCustomer('stafflogin'); });
  test.afterAll(async () => { if (buyer) await purgeTestOrgs([buyer.orgId], [buyer.id]); });

  test('signed-out visitors are sent to the staff login', async ({ page }) => {
    await page.goto('/office');
    await expect(page).toHaveURL(/\/staff\/login\?next=%2Foffice/);
    await expect(page.getByRole('heading', { name: /sign in to the back office/i })).toBeVisible();
  });

  test('a customer cannot open /office or /admin', async ({ page }) => {
    await customerLogin(page, buyer!);
    for (const path of ['/office', '/admin']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    }
  });

  test('the staff login refuses a customer account', async ({ page }) => {
    await page.goto('/staff/login');
    await page.getByLabel('Work email').fill(buyer!.email);
    await page.getByLabel('Password', { exact: true }).fill(buyer!.password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('form [role=alert]')).toContainText(/staff portal/i);
  });

  test('a wrong password shows the remaining attempts', async ({ page }) => {
    await page.goto('/staff/login');
    await page.getByLabel('Work email').fill(`nobody+${Date.now()}@demo.octopusb2b.com`);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-1');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('form [role=alert]')).toContainText(/attempts? left/i);
  });
});
