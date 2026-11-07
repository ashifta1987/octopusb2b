import { test, expect } from '@playwright/test';
import { createTempCustomer, customerLogin, purgeTestOrgs, pgClient, type TempCustomer } from './helpers/customer';

/**
 * Account › Product sourcing (7 Nov 2026), live database with temporary data removed afterwards.
 * Customer A submits a sourcing request → sees it in /account/sourcing; staff adds a quote → badge; A accepts → order;
 * customer B cannot open A's request; the menu shows Product sourcing first (desktop sidebar + mobile bottom bar).
 */
let A: TempCustomer | null = null; let B: TempCustomer | null = null;
let ref = ''; let rfqId = '';
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeAll(async () => {
  A = await createTempCustomer('a'); B = await createTempCustomer('b');
  // the sourcing request fee is charged from the wallet: give A a temporary credit limit (removed with the org)
  const db = pgClient(); await db.connect();
  await db.query(`insert into wallet_credit_limits(org_id, limit_minor, currency, note) values ($1, 100000, current_platform_currency(), 'e2e')`, [A.orgId]);
  await db.end();
});
test.afterAll(async () => { await purgeTestOrgs([A?.orgId, B?.orgId].filter(Boolean) as string[], [A?.id, B?.id].filter(Boolean) as string[]); });

test('a customer submits a sourcing request and sees it in Product sourcing', async ({ page }) => {
  await customerLogin(page, A!, '/account/sourcing');
  await page.goto('/account/sourcing');
  await expect(page.getByText('No sourcing requests yet')).toBeVisible();
  await page.getByTestId('new-request').click();
  await page.waitForURL(/\/request\/sourcing/);
  await page.goto('/request/sourcing?title=E2E%20handheld%20fan&qty=3000&country=AE');
  await expect(page.getByLabel(/Product name/)).toHaveValue('E2E handheld fan');
  await page.getByLabel(/Description, specs or a link/).fill('4000mAh, 5 speeds, white, retail box');
  await page.getByRole('button', { name: /submit|send|request/i }).last().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /^Confirm/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForURL(/\/account\/sourcing\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  rfqId = page.url().split('/').pop()!;
  await expect(page.getByTestId('request-status')).toHaveText(/Submitted/);
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.goto('/account/sourcing');
  const row = page.getByTestId('sourcing-list').locator('a').first();
  await expect(row).toContainText('E2E handheld fan');
  ref = (await row.getAttribute('data-ref'))!;
  expect(ref).toMatch(/^RFQ-/);
  await expect(row).toContainText('Submitted');
});

test('a quote added by staff appears with a badge, and accepting it creates the order', async ({ page }) => {
  // staff sends a quote (as the admin, through the same RPC the back-office form uses)
  const db = pgClient(); await db.connect();
  const admin = (await db.query(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).rows[0].id;
  const sup = (await db.query(`select id from suppliers where archived_at is null and identity_status = 'ok' order by code limit 1`)).rows[0].id;
  await db.query('begin');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: admin, role: 'authenticated', aal: 'aal2' })]);
  await db.query('set local role authenticated');
  await db.query(`select send_quote($1, $2, 577, 3000, 'FOB', 25, 0, 'E2E quote', 3000, 2500)`, [rfqId, sup]);
  await db.query('commit');
  await db.end();

  await customerLogin(page, A!, '/account/sourcing');
  await page.goto('/account/sourcing');
  const nav = page.getByRole('navigation', { name: 'Portal' });
  await expect(nav.getByRole('link', { name: /Product sourcing/ }).getByTestId('nav-badge')).toHaveText('1');
  await expect(page.getByTestId('row-new-quotes')).toHaveText('1 new');
  await page.goto(`/account/sourcing/${ref}`);
  const quotes = page.getByTestId('quotes');
  await expect(quotes).toContainText('3,000');           // MOQ
  await expect(quotes).toContainText('25 days');
  await expect(quotes).toContainText('FOB');
  await expect(quotes).not.toContainText(/Co\., Ltd/);   // supplier code only
  await page.getByRole('button', { name: 'Accept quote' }).click();
  const dlg = page.getByRole('dialog');
  const agree = dlg.getByRole('checkbox');
  if (await agree.count()) await agree.check();
  await dlg.getByRole('button', { name: /approve|accept|confirm/i }).last().click();
  await page.waitForURL(/\/account\/orders\//, { timeout: 60_000 });
  await page.goto(`/account/sourcing/${ref}`);
  await expect(page.getByTestId('go-to-order')).toBeVisible();
  await expect(page.getByTestId('request-status')).toHaveText(/Accepted/);
  await page.goto('/account/sourcing');
  await expect(nav.getByTestId('nav-badge')).toHaveCount(0);   // badge cleared once the quote was opened
});

test('another customer cannot open the request URL', async ({ page }) => {
  await customerLogin(page, B!, '/account/sourcing');
  await page.goto(`/account/sourcing/${ref}`);
  await expect(page.getByRole('heading', { name: /couldn.t find|not found/i })).toBeVisible();
  await expect(page.getByTestId('quotes')).toHaveCount(0);
  await page.goto(`/account/sourcing/${rfqId}`);
  await expect(page.getByRole('heading', { name: /couldn.t find|not found/i })).toBeVisible();
});

test('the menu shows Product sourcing first — desktop sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await customerLogin(page, A!, '/account');
  await page.goto('/account');
  const items = (await page.getByRole('navigation', { name: 'Portal' }).locator('a').allInnerTexts()).map((t) => t.replace(/\d+$/, '').trim());
  expect(items.slice(0, 11)).toEqual(['Dashboard', 'Product sourcing', 'Dropshipping', 'MOQ pools', '3PL', 'Turnkey projects', 'Orders', 'Wallet', 'Assistant', 'API', 'Settings']);
  await expect(page.getByTestId('dashboard-sourcing')).toBeVisible();
  await expect(page.getByTestId('account-bottom-bar')).toBeHidden();
});

test('the menu shows Product sourcing first — mobile bottom bar and More sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await customerLogin(page, A!, '/account');
  await page.goto('/account');
  const bar = page.getByTestId('account-bottom-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Portal' })).toBeHidden();
  const links = bar.getByRole('link');
  await expect(links.nth(0)).toHaveText(/Dashboard/);
  await expect(links.nth(1)).toHaveAttribute('aria-label', 'Product sourcing');
  for (let i = 0; i < 4; i++) expect((await links.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await bar.getByRole('button', { name: 'More' }).click();
  const sheet = page.getByTestId('more-sheet');
  await expect(sheet).toBeVisible();
  for (const l of ['Dropshipping', 'MOQ pools', '3PL', 'Turnkey projects', 'Assistant', 'API', 'Settings', 'Log out']) await expect(sheet.getByText(l, { exact: true })).toBeVisible();
  await sheet.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/account\/kyc/);
  await expect(sheet).toBeHidden();
});

