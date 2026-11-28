import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';

/**
 * ODS 1.0 · T7 (Dropshipping inside My account), master prompt Part 6.6. STAGING / LOCAL ONLY.
 * The Dropship pages themselves are TODAY's modules re-exported inside the ODS My account frame, so their content, rules and
 * test ids are unchanged; today's Dropship suite can run inside the frame with E2E_ODS_PREVIEW=on (see playwright.config.ts).
 * This spec checks the frame part: the Dropshipping sidebar group (fixture) and, @writes, the real pages behind the switch.
 */
async function axe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `${label} axe: ${JSON.stringify(bad.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))}`).toEqual([]);
}
async function open(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(200);
  await waitForHydration(page);
}
const SHOTS = process.env.ODS_SHOTS;
const NAV = ['Dashboard', 'Find products', 'Import list', 'Orders', 'Pricing and sync', 'Packing and shipping', 'Stores', 'Billing', 'Reports', 'Settings'];

test.describe('ODS T7 · Dropshipping group (fixture)', () => {
  for (const state of ['active', 'early', 'locked', 'import']) {
    test(`${state}: axe at 1280 and 390, no sideways scroll`, async ({ page }) => {
      test.setTimeout(120_000);
      const path = `/dev/ui/screens/account-dropship?state=${state}${state === 'import' ? '&list=1' : ''}`;
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(page, path);
      await expect(page.locator('h1')).toHaveCount(1);
      await axe(page, `${state} @1280`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/dropship-${state}-1280.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await axe(page, `${state} @390`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/dropship-${state}-390.png`, fullPage: true });
    });
  }
  test('the merchant sidebar is now the Dropshipping group (6.6 order), current item marked', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/account-dropship?state=active');
    const group = page.getByTestId('dropship-group');
    await expect(group).toBeVisible();
    const labels = (await group.getByTestId('dropship-nav-item').allInnerTexts()).map((t) => t.trim());
    let last = -1;
    for (const l of NAV) {
      const i = labels.findIndex((x) => x.startsWith(l));
      expect(i, `${l} in the group`).toBeGreaterThan(last);
      last = i;
    }
    await expect(group.locator('[aria-current="page"]')).toHaveCount(1);
  });
  test('never-activated company: items locked with the reason', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/account-dropship?state=locked');
    const locked = page.getByTestId('locked-nav-item');
    expect(await locked.count()).toBeGreaterThan(0);
    for (const l of await locked.all()) await expect(l).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Activate dropshipping to open these pages.')).toBeVisible();
  });
  test('phones: the group opens from More', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/dev/ui/screens/account-dropship?state=active&more=1');
    await expect(page.getByTestId('more-dropship')).toBeVisible();
  });
});

test.describe('ODS T7 · real Dropship pages in the frame (@writes: temporary staging customer)', () => {
  test.describe.configure({ mode: 'serial' });
  let c: TempCustomer | null = null;
  test.beforeAll(async () => {
    c = await createTempCustomer(`ods-t7-${Date.now().toString(36)}`);
  });
  test.afterAll(async () => {
    if (c) await purgeTestOrgs([c.orgId], [c.id]);
  });
  test('Dropship pages render today’s content inside the ODS frame; exports untouched @writes', async ({ page, context, request }) => {
    test.setTimeout(240_000);
    await odsPreview(context, 'off');
    await customerLogin(page, c!, '/account');
    await odsPreview(context, 'on');
    await open(page, '/account/dropship');
    await expect(page.getByTestId('account-sidebar')).toBeVisible();
    await expect(page.getByTestId('ods-dropship-area')).toBeVisible();
    await axe(page, '/account/dropship');
    // switch off: today's merchant shell / account shell, unchanged
    await odsPreview(context, 'off');
    await open(page, '/account/dropship');
    expect(await page.locator('[data-theme="ods"]').count()).toBe(0);
    // CSV route handlers are never rewritten
    const r = await request.get('/account/dropship/reports/csv', { maxRedirects: 0, headers: { cookie: 'ods_preview=on' } });
    expect(r.status()).not.toBe(404);
  });
});
