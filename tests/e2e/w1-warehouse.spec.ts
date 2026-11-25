import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W1 E2E (STAGING ONLY) — boards 25, 27, 26, 28 (matched to the written design).
 *  1. Public intro page sections and links; Apply: send disabled until required fields, SDS note, APP reference.
 *  2. Staff review: approve disabled until all checks + plan are saved; approval opens the applicant's portal.
 *  3. Rates: an admin proposes; the proposer can't approve; a second admin approves; the quote calculator uses it.
 *  4. axe clean at 1280 px and 390 px.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let admin2: TempStaff | null = null;
let client: TempCustomer | null = null;
let appCode = '';

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  admin = await createTempStaff('admin');
  admin2 = await createTempStaff('admin');
  client = await createTempCustomer('w1e2e');
});
test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    if (client) {
      await db.query(`delete from wh_clients where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_applications where lower(email) = lower($1)`, [client.email]);
    }
    await db.query(`delete from wh_rate_versions where note = 'W1 E2E'`);
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  await deleteTempStaff(admin2);
  await deleteTempStaff(admin);
});

test('W1 public intro and Apply', async ({ page }) => {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/3pl');
    await expect(page.getByTestId('wh-intro')).toBeVisible();
    for (const id of ['who', 'family', 'how', 'services', 'proof', 'connections', 'faq']) await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.getByTestId('wh-intro-footer')).toContainText('foshan@octopusb2b.com');
    await expect(page.locator('main')).not.toContainText(/\[[A-Z ]+\]/);
    await checkAxe(page, `intro @${w}`);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/request/3pl');
  await expect(page).toHaveURL(/\/3pl$/);
  await expect(page.getByTestId('wh-intro')).toBeVisible();
  await page.waitForLoadState('load');
  await page.goto('/3pl/apply');
  const send = page.getByTestId('wh-apply-send');
  await expect(send).toBeDisabled();
  await page.getByLabel('Company *').fill('W1 E2E Trading');
  await page.getByLabel('Your name *').fill('Wen Li');
  await page.getByLabel('Work email *').fill(client!.email);
  await page.getByLabel('What you sell *').fill('Desk lamps and organisers');
  await page.getByLabel('Orders a month *').selectOption('100_500');
  await page.getByLabel('How stock reaches us *').selectOption('own_supplier');
  await page.getByLabel('My products contain batteries').check();
  await expect(page.getByTestId('wh-apply-sds')).toBeVisible();
  await checkAxe(page, 'apply @1280');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByTestId('wh-apply-done')).toContainText('within one working day');
  appCode = (await page.getByTestId('wh-apply-code').innerText()).trim();
  expect(appCode).toMatch(/^APP-\d{4,}$/);
});

test('W1 staff review and approval opens the portal', async ({ page, browser }) => {
  await staffLogin(page, admin!, '/office/warehouse/clients');
  await page.goto('/office/warehouse/clients');
  await page.getByTestId(`wh-app-row-${appCode}`).click();
  const card = page.getByTestId('wh-app-checks');
  await expect(page.getByTestId('wh-app-approve')).toBeDisabled();
  await card.getByLabel('Company documents checked').check();
  await card.getByLabel(/Dangerous goods checked/).check();
  await card.getByLabel('Terms sent to the client').check();
  await card.getByLabel('Rate plan').selectOption('standard');
  await expect(page.getByTestId('wh-app-approve')).toBeDisabled();
  await page.getByTestId('wh-app-save').click();
  await expect(page.getByTestId('wh-app-msg')).toContainText('Checks saved');
  await page.reload();
  await page.getByTestId(`wh-app-row-${appCode}`).click();
  await page.getByTestId('wh-app-approve').click();
  await expect(page.getByTestId('wh-app-msg')).toContainText('portal is open');
  await checkAxe(page, 'clients @1280');
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await customerLogin(p2, client!, '/account/warehouse');
    await p2.goto('/account/warehouse');
    await expect(p2.getByTestId('wh-portal')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('W1 rates: two-person approval and the monthly quote', async ({ page, browser }) => {
  await staffLogin(page, admin!, '/office/warehouse/rates');
  await page.goto('/office/warehouse/rates');
  const f = page.getByTestId('wh-rates-propose');
  await f.getByLabel('Plan').selectOption('volume');
  await f.getByLabel('Receiving, per carton (US$)').fill('1.50');
  await f.getByLabel('Pick and pack, first item (US$)').fill('1.10');
  await f.getByLabel('Each extra item (US$)').fill('0.30');
  await f.getByLabel('Note').fill('W1 E2E');
  await page.getByTestId('wh-rates-propose-submit').click();
  await expect(page.getByTestId('wh-rates-msg')).toContainText('Proposed');
  await page.reload();
  const waiting = page.getByTestId('wh-rates-waiting');
  await expect(waiting.getByRole('button', { name: 'Approve' }).first()).toBeDisabled();
  await checkAxe(page, 'rates @1280');
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await staffLogin(p2, admin2!, '/office/warehouse/rates');
    await p2.goto('/office/warehouse/rates');
    await p2.getByTestId('wh-rates-waiting').getByRole('button', { name: 'Approve' }).first().click();
    await expect(p2.getByTestId('wh-rates-msg')).toContainText('Approved');
    const q = p2.getByTestId('wh-quote');
    await q.getByLabel('Plan').selectOption('volume');
    await q.getByLabel('Orders a month').fill('100');
    await q.getByLabel('Items per order').fill('2');
    await q.getByLabel('Cartons received').fill('10');
    // 10 × 1.50 + 100 × (1.10 + 0.30) = 15 + 140 = 155.00 (+ storage/returns not set)
    await expect(p2.getByTestId('wh-quote-result')).toContainText('US$ 155.00');
    await expect(p2.getByTestId('wh-quote-result')).toContainText('fees not set yet');
  } finally {
    await ctx.close();
  }
});
