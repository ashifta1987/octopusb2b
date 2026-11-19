import { test, expect, type Page } from '@playwright/test';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * Dropship label + packing slip (migration 196, owner's decision 19 Nov 2026) — STAGING ONLY, uses the staging test data
 * (scripts/seed-division-test-data.mjs: approved profile "TEST · Lumen Home", DS shipment TESTDS0000000001).
 * A Dropshipping staff member (temporary, own 2FA) prints both through the real routes:
 *  · brand + approved return address present
 *  · no "Octopus", no supplier code (OCT-…), no factory label, no currency amounts
 *  · profile not approved → both refused with the "blocked" message
 * A Make My Brand staff member gets 404 (another division). Screenshots when SHOTS_DIR is set.
 * Run: E2E_BASE_URL=http://localhost:3101 node scripts/with-staging-env.mjs npx playwright test tests/e2e/dropship-label.spec.ts
 */
const TRACKING = 'TESTDS0000000001';
let ds: TempStaff | null = null;
let mmb: TempStaff | null = null;
let org = '';
test.describe.configure({ mode: 'serial' });

const FORBIDDEN: [RegExp, string][] = [
  [/octopus/i, 'Octopus'], [/\bOCT-\d+/, 'supplier code'], [/factory/i, 'factory label'], [/supplier/i, 'supplier'],
  [/[$€£¥]\s?\d/, 'currency amount'], [/\b(USD|CNY|AED|EUR|GBP)\b/, 'currency code'], [/price|cost/i, 'price / cost'],
];
const visibleText = async (page: Page) => (await page.locator('body').innerText());

test.beforeAll(async () => {
  ds = await createTempStaff('operations');
  mmb = await createTempStaff('operations');
  const a = ds.admin;
  const { data: env } = await a.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  const div = async (code: string) => (await a.from('divisions').select('id').eq('code', code).single()).data!.id as string;
  await a.from('division_members').insert([{ user_id: ds.id, division_id: await div('DS'), role: 'staff' }, { user_id: mmb.id, division_id: await div('MMB'), role: 'staff' }]);
  org = (await a.from('organizations').select('id').eq('name', 'TEST DATA · Divisions').single()).data!.id;
  const p = (await a.from('dropship_seller_profiles').select('status').eq('org_id', org).single()).data;
  if (p?.status !== 'approved') throw new Error('run scripts/seed-division-test-data.mjs (approved test profile missing)');
});
test.afterAll(async () => {
  if (ds && org) await ds.admin.from('dropship_seller_profiles').update({ status: 'approved' }).eq('org_id', org);   // in case a test failed mid-way
  for (const t of [ds, mmb]) {
    if (!t) continue;
    await t.admin.from('division_members').delete().eq('user_id', t.id);
    try { await deleteTempStaff(t); } catch { /* audit rows keep the account: block it instead */ }
    const { data } = await t.admin.auth.admin.getUserById(t.id);
    if (data?.user) await t.admin.auth.admin.updateUserById(t.id, { ban_duration: '876000h' });
  }
});

test('Dropshipping staff: label shows only the seller brand + approved return address', async ({ page }) => {
  await staffLogin(page, ds!, '/office');
  const res = await page.goto(`/api/labels/${TRACKING}`);
  expect(res?.status()).toBe(200);
  const from = page.getByTestId('label-from');
  await expect(from).toContainText('TEST · Lumen Home');
  await expect(from).toContainText('TEST Unit 0, Example Returns Street');
  await expect(from).toContainText('Dubai');
  const text = await visibleText(page);
  const html = await res!.text();
  for (const [re, what] of FORBIDDEN) { expect(text, `label shows ${what}`).not.toMatch(re); expect(html, `label HTML has ${what}`).not.toMatch(re); }
  if (process.env.SHOTS_DIR) await page.locator('.label').screenshot({ path: `${process.env.SHOTS_DIR}/dropship-label.png` });
});

test('Dropshipping staff: packing slip — brand header, ship-to, order, items, return address; nothing else', async ({ page }) => {
  await staffLogin(page, ds!, '/office');
  const res = await page.goto(`/api/packing-slips/${TRACKING}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('slip-brand')).toHaveText('TEST · Lumen Home');
  await expect(page.getByTestId('slip-ship-to')).toContainText('TEST DATA · Divisions');
  await expect(page.locator('body')).toContainText('TEST-ORD-DS');
  await expect(page.getByTestId('slip-items')).toContainText('TEST order · dropship');
  await expect(page.getByTestId('slip-items')).toContainText('20');
  await expect(page.getByTestId('slip-return')).toContainText('TEST Unit 0, Example Returns Street');
  const text = await visibleText(page);
  const html = await res!.text();
  for (const [re, what] of FORBIDDEN) { expect(text, `slip shows ${what}`).not.toMatch(re); expect(html, `slip HTML has ${what}`).not.toMatch(re); }
  if (process.env.SHOTS_DIR) await page.locator('.slip').screenshot({ path: `${process.env.SHOTS_DIR}/dropship-packing-slip.png` });
});

test('not approved → label and packing slip refused with the blocked message', async ({ page }) => {
  await staffLogin(page, ds!, '/office');
  await ds!.admin.from('dropship_seller_profiles').update({ status: 'pending' }).eq('org_id', org);
  try {
    const l = await page.goto(`/api/labels/${TRACKING}`);
    expect(l?.status()).toBe(409);
    await expect(page.locator('h1')).toHaveText("Dropship label blocked: the seller's return address is not approved yet");
    expect(await visibleText(page)).not.toMatch(/TEST Unit 0|Octopus/i);
    const p = await page.goto(`/api/packing-slips/${TRACKING}`);
    expect(p?.status()).toBe(409);
    await expect(page.locator('h1')).toContainText('blocked');
  } finally {
    await ds!.admin.from('dropship_seller_profiles').update({ status: 'approved' }).eq('org_id', org);
  }
});

test('Make My Brand staff: the dropship label and slip are not found (another division)', async ({ page }) => {
  await staffLogin(page, mmb!, '/office');
  expect((await page.goto(`/api/labels/${TRACKING}`))?.status()).toBe(404);
  expect((await page.goto(`/api/packing-slips/${TRACKING}`))?.status()).toBe(404);
});
