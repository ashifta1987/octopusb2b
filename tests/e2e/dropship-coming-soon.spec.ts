import { test, expect, type Page } from '@playwright/test';
import { adminClient, pgClient, createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * 20 Nov 2026 — Dropshipping is "Coming soon": the home Dropshipping section and /request/dropship no longer promise
 * store connection or "Start dropshipping"; visitors leave an e-mail ("Notify me when it launches", migration 203),
 * which staff see on Admin › Services & charges. STAGING ONLY (writes a sign-up and a temporary staff user, both removed).
 * Screenshots (SHOTS_DIR): home + request page, desktop 1440 and phone 390.
 */
const SHOTS = process.env.SHOTS_DIR;
const email = `e2e-launch-${Date.now()}@example.com`;
let admin: TempStaff | null = null;
let buyer: TempCustomer | null = null;
test.describe.configure({ mode: 'serial' });

// the sign-up is rate-limited per network (5 an hour); clear only this test's bucket on staging so repeat runs don't trip it
const clearRateLimit = async () => {
  const db = pgClient(); await db.connect();
  try { await assertStagingOrThrow(db); await db.query(`delete from auth_rate_limits where bucket like 'launch-signup:%'`); } finally { await db.end(); }
};
// Batch 3 (F-15): with dropship_v2_ui ON (the staging default) /request/dropship and /go/dropship open the Dropship app,
// so this file checks the Live gate ("Coming soon") with the flag explicitly OFF, and puts the original value back.
let originalFlag: { value: unknown }[] | null = null;
test.beforeAll(async () => {
  await assertStagingOrThrow();
  await clearRateLimit();
  const { data } = await adminClient().from('site_settings').select('value').eq('key', 'dropship_v2_ui');
  originalFlag = (data ?? []) as { value: unknown }[];
  await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: false, description: 'Coming soon gate test' });
});
test.afterAll(async () => {
  if (originalFlag) {
    if (originalFlag.length === 0) await adminClient().from('site_settings').delete().eq('key', 'dropship_v2_ui');
    else await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  }
  const db = pgClient(); await db.connect();
  try { await assertStagingOrThrow(db); await db.query(`delete from launch_signups where email like 'e2e-launch-%@example.com'`); await db.query(`delete from auth_rate_limits where bucket like 'launch-signup:%'`); } finally { await db.end(); }
  await deleteTempStaff(admin);
  if (buyer) await purgeTestOrgs([buyer.orgId], [buyer.id]);
});

async function both(page: Page, name: string, path: string, focus: string) {
  for (const [w, h, tag] of [[1440, 1000, 'desktop'], [390, 844, 'phone']] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const el = page.getByTestId(focus).first();
    await el.scrollIntoViewIfNeeded();
    // keep the section heading in view under the sticky header; caret 'initial' = don't restyle inputs (no hydration noise)
    await page.evaluate((y) => window.scrollBy(0, y), path === '/' ? -260 : -420);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${tag}.png`, caret: 'initial' });
  }
}

// design handoff page 01 (Nov 2026): the homepage Dropshipping card is marked Coming soon and leads to the launch list
test('home: Dropshipping card says Coming soon, no store-connection promise, no "Start dropshipping"', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('home-service-dropship');
  await expect(card).toContainText('Coming soon');
  await expect(card).toContainText('Join the launch list.');
  await expect(card).toHaveAttribute('href', '/request/dropship');
  await expect(page.locator('main')).not.toContainText('Start dropshipping');
  await expect(page.locator('main')).not.toContainText('upload a sheet');
  await expect(page.locator('nav[aria-label="Services"]').getByRole('link', { name: 'Dropshipping' })).toHaveAttribute('href', '/request/dropship');
  await both(page, 'dropship-home', '/', 'home-service-dropship');
});

test('/request/dropship: Coming soon heading and sign-up instead of the setup form', async ({ page }) => {
  await page.goto('/request/dropship');
  await expect(page.locator('h1')).toHaveText('You sell. We ship to your customer.');
  await expect(page.getByTestId('dropship-coming-soon')).toContainText('Coming soon');
  await expect(page.locator('#notify').getByRole('heading', { name: 'Notify me when it launches' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Start dropshipping');
  await expect(page.locator('select[name="store_platform"]')).toHaveCount(0);
  // privacy line under the form, linking to the privacy policy (which exists)
  const privacy = page.getByTestId('dropship-coming-soon').getByTestId('launch-notify-privacy');
  await expect(privacy).toHaveText('We’ll only use your email to tell you when dropshipping launches. Privacy policy');
  await expect(privacy.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/legal/privacy');
  expect((await page.request.get('/legal/privacy')).status()).toBe(200);
  // the honeypot is in the form but not visible and not reachable by keyboard
  const trap = page.getByTestId('dropship-coming-soon').getByTestId('launch-notify-trap');
  await expect(trap).toHaveAttribute('tabindex', '-1');
  expect(await trap.evaluate((el) => { const r = el.getBoundingClientRect(); return r.right < 0 || r.width <= 1; })).toBe(true);
  await both(page, 'dropship-request', '/request/dropship', 'dropship-coming-soon');
});

test('the old /go/dropship link leads to the Coming soon sign-up', async ({ page }) => {
  await page.goto('/go/dropship');
  await expect(page).toHaveURL(/\/request\/dropship#notify$/);
  await expect(page.getByTestId('dropship-coming-soon')).toBeVisible();
});

test('honeypot: a bot that fills the hidden field gets "Thanks" but nothing is stored', async ({ page }) => {
  const bot = `e2e-launch-bot-${Date.now()}@example.com`;
  await page.goto('/request/dropship');
  const form = page.getByTestId('launch-notify-dropship');
  await form.getByLabel('Email address').fill(bot);
  await form.getByTestId('launch-notify-trap').fill('https://spam.example', { force: true });
  await form.getByRole('button', { name: 'Notify me when it launches' }).click();
  await expect(form.getByRole('status')).toHaveText('Thanks. We will email you once when it launches.');
  const db = pgClient(); await db.connect();
  try { expect((await db.query(`select count(*)::int n from launch_signups where lower(email) = $1`, [bot])).rows[0].n).toBe(0); } finally { await db.end(); }
});

test('a visitor signs up; the e-mail is stored once; staff see it on Admin › Services', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/request/dropship');
  const form = page.getByTestId('launch-notify-dropship');
  await form.getByLabel('Email address').fill(email);
  await form.getByRole('button', { name: 'Notify me when it launches' }).click();
  await expect(form.getByRole('status')).toHaveText('Thanks. We will email you once when it launches.');
  // the same address again: still a friendly success, still one row
  await form.getByLabel('Email address').fill(email.toUpperCase());
  await form.getByRole('button', { name: 'Notify me when it launches' }).click();
  await expect(form.getByRole('status')).toBeVisible();
  const db = pgClient(); await db.connect();
  try {
    const rows = (await db.query(`select feature, source from launch_signups where lower(email) = $1`, [email])).rows;
    expect(rows).toEqual([{ feature: 'dropship', source: 'request-page' }]);
  } finally { await db.end(); }

  admin = await createTempStaff('admin');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const sp = await ctx.newPage();
  await staffLogin(sp, admin, '/admin/services');
  await sp.goto('/admin/services');
  const card = sp.locator('section, div').filter({ has: sp.getByText(/^Launch sign-ups · Dropshipping/) }).last();
  await expect(sp.getByText(/^Launch sign-ups · Dropshipping \(\d+\+?\)/)).toBeVisible();
  await expect(sp.getByRole('cell', { name: email })).toBeVisible();
  if (SHOTS) await sp.getByText(/^Launch sign-ups · Dropshipping/).locator('xpath=ancestor::*[contains(@class,"card")][1]').screenshot({ path: `${SHOTS}/dropship-admin-signups.png` }).catch(() => card.screenshot({ path: `${SHOTS}/dropship-admin-signups.png` }));
  await ctx.close();
});

test('My account: the Dropshipping tile and tab say Coming soon with the sign-up (no "Start")', async ({ page }) => {
  buyer = await createTempCustomer('dropsoon');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await customerLogin(page, buyer, '/account');
  const tile = page.getByTestId('service-dropship');
  await expect(tile).toContainText('Coming soon');
  await expect(tile.getByRole('link', { name: /Start/ })).toHaveCount(0);
  await expect(tile.getByLabel('Email address')).toHaveValue(buyer.email);
  await expect(tile.getByTestId('launch-notify-privacy')).toContainText('Privacy policy');
  for (const [w, h, tag] of [[1440, 1000, 'desktop'], [390, 844, 'phone']] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/account');
    await page.getByTestId('service-dropship').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dropship-account-tile-${tag}.png`, caret: 'initial' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // dropship_v2_ui is OFF for this whole file (beforeAll)
  await page.goto('/account/dropship');
  await expect(page.getByTestId('dropship-coming-soon')).toContainText('Coming soon');
  await expect(page.getByRole('main')).not.toContainText('Start Dropshipping');
  await expect(page.getByRole('main')).not.toContainText('upload orders as a sheet');
  await expect(page.getByTestId('browse-catalogue')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dropship-account-tab-desktop.png`, caret: 'initial' });
  // a signed-in customer without Dropshipping switched on also lands on the sign-up from the old link
  await page.goto('/go/dropship');
  await expect(page).toHaveURL(/\/request\/dropship#notify$/);
});
