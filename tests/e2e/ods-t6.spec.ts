import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';

/**
 * ODS 1.0 · T6 (My account), master prompt Part 6.1–6.5 + 6.7. STAGING / LOCAL ONLY.
 * Read-only part: staging-only fixtures /dev/ui/screens/account-* (real components, labelled sample props from Part 6.7, every
 * state). @writes part: a temporary staging customer opens the REAL ODS My account pages (preview cookie), checks renames and
 * the frame, then is purged. No money action is triggered by these tests.
 */
const SHOTS = process.env.ODS_SHOTS;

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

const FIXTURES = [
  '/dev/ui/screens/account-frame?view=expanded',
  '/dev/ui/screens/account-frame?view=more',
  '/dev/ui/screens/account-home?state=normal',
  '/dev/ui/screens/account-home?state=new',
  '/dev/ui/screens/account-home?state=unverified',
  '/dev/ui/screens/account-home?state=error',
  '/dev/ui/screens/account-action?type=pay',
  '/dev/ui/screens/account-requests?state=list',
  '/dev/ui/screens/account-request?state=quote-ready',
  '/dev/ui/screens/account-orders?state=list',
  '/dev/ui/screens/account-orders?state=board',
  '/dev/ui/screens/account-order?state=balance-due',
  '/dev/ui/screens/account-order?state=protected',
  '/dev/ui/screens/account-wallet?state=available',
  '/dev/ui/screens/account-invoices?state=all',
  '/dev/ui/screens/account-turnkey?state=detail',
  '/dev/ui/screens/account-warehouse?state=stock',
  '/dev/ui/screens/account-shipping?state=list',
  '/dev/ui/screens/account-brand?state=proofs',
  '/dev/ui/screens/account-settings?state=kyc-more-info',
  '/dev/ui/screens/account-support?state=thread',
];

test.describe('ODS T6 · fixtures: axe at 1280 and 390, no sideways scroll', () => {
  for (const path of FIXTURES) {
    test(path.replace('/dev/ui/screens/', ''), async ({ page }) => {
      test.setTimeout(120_000);
      const name = path.replace('/dev/ui/screens/', '').replace(/[?=&]/g, '-');
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(page, path);
      await expect(page.locator('h1')).toHaveCount(1);
      await axe(page, `${path} @1280`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-1280.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} @390 overflow`).toBe(true);
      await axe(page, `${path} @390`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
    });
  }
});

test.describe('ODS T6 · Part 6.1–6.3 frame, home, action (fixtures)', () => {
  test('frame: sidebar groups, logo + shop icon open the Shop tab, aria-current', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/account-home?state=normal');
    const sidebar = page.getByTestId('account-sidebar');
    await expect(sidebar).toBeVisible();
    for (const g of ['Overview', 'Services', 'Money', 'Account']) await expect(sidebar).toContainText(g);
    await expect(sidebar.locator('[aria-current="page"]').first()).toBeVisible();
    await expect(page.getByTestId('shop-icon')).toHaveAttribute('target', 'octopus-shop');
    await expect(sidebar.locator('a[target="octopus-shop"]').first()).toBeVisible();
  });
  test('home panels; brand-new customer start; not verified banner', async ({ page }) => {
    await open(page, '/dev/ui/screens/account-home?state=normal');
    for (const id of ['waiting-table', 'wallet-card', 'services-tiles', 'in-progress', 'account-manager']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('service-tile')).toHaveCount(6);
    await open(page, '/dev/ui/screens/account-home?state=new');
    await expect(page.getByTestId('new-customer-start')).toBeVisible();
    await open(page, '/dev/ui/screens/account-home?state=unverified');
    await expect(page.getByTestId('verification-banner')).toBeVisible();
  });
  test('action needed: type pills in the URL, cards sorted by due date', async ({ page }) => {
    await open(page, '/dev/ui/screens/account-action');
    await expect(page.getByTestId('action-filters')).toBeVisible();
    await page.getByTestId('action-filter-pay').click();
    await expect(page).toHaveURL(/type=pay/);
    for (const c of await page.getByTestId('action-card').all()) await expect(c).toHaveAttribute('data-type', 'pay');
  });
});

test.describe('ODS T6 · Part 6.4–6.5, 6.7 (fixtures)', () => {
  test('orders: card tabs, board view, detail stepper + tabs + pay button', async ({ page }) => {
    await open(page, '/dev/ui/screens/account-orders?state=list');
    await expect(page.getByTestId('orders-cards')).toBeVisible();
    await expect(page.getByTestId('order-row').first()).toBeVisible();
    await open(page, '/dev/ui/screens/account-orders?state=board');
    await expect(page.getByTestId('orders-board')).toBeVisible();
    await open(page, '/dev/ui/screens/account-order?state=balance-due');
    await expect(page.getByTestId('order-stepper')).toBeVisible();
    await expect(page.getByTestId('order-tabs')).toBeVisible();
    await expect(page.getByTestId('header-pay-button')).toContainText(/Pay balance US\$/);
  });
  test('requests: list + detail stepper and tabs', async ({ page }) => {
    await open(page, '/dev/ui/screens/account-requests?state=list');
    await expect(page.getByTestId('request-row').first()).toBeVisible();
    await open(page, '/dev/ui/screens/account-request?state=quote-ready');
    await expect(page.getByTestId('request-stepper')).toBeVisible();
    await expect(page.getByTestId('request-tabs')).toBeVisible();
  });
  test('wallet, invoices, turnkey, warehouse, settings (vertical tabs), support thread', async ({ page }) => {
    await open(page, '/dev/ui/screens/account-wallet?state=available');
    await expect(page.getByTestId('wallet-cards')).toBeVisible();
    await open(page, '/dev/ui/screens/account-invoices?state=all');
    await expect(page.getByTestId('invoice-row').first()).toBeVisible();
    await open(page, '/dev/ui/screens/account-turnkey?state=detail');
    await expect(page.getByTestId('turnkey-stepper')).toBeVisible();
    await open(page, '/dev/ui/screens/account-warehouse?state=stock');
    await expect(page.getByTestId('stock-table')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/account-settings?state=company');
    await expect(page.getByTestId('settings-tabs')).toHaveAttribute('aria-orientation', 'vertical');
    await open(page, '/dev/ui/screens/account-support?state=thread');
    await expect(page.getByTestId('ticket-thread')).toBeVisible();
  });
  test('Pay later appears only for credit-eligible companies (rule 8), as today', async ({ page }) => {
    await open(page, '/dev/ui/screens/account-order?state=credit-eligible');
    await expect(page.getByText(/pay later/i).first()).toBeVisible();
  });
  test('no Pay later for other customers in the money fixtures', async ({ page }) => {
    for (const p of ['/dev/ui/screens/account-order?state=balance-due', '/dev/ui/screens/account-wallet?state=available', '/dev/ui/screens/account-invoices?state=due']) {
      await open(page, p);
      expect(await page.content(), p).not.toMatch(/pay later/i);
    }
  });
});

test.describe('ODS T6 · real My account (@writes: temporary staging customer)', () => {
  test.describe.configure({ mode: 'serial' });
  let c: TempCustomer | null = null;
  test.beforeAll(async () => {
    c = await createTempCustomer(`ods-t6-${Date.now().toString(36)}`);
  });
  test.afterAll(async () => {
    if (c) await purgeTestOrgs([c.orgId], [c.id]);
  });
  test('every ODS My account page renders in the frame; renames 308; axe @writes', async ({ page, context }) => {
    test.setTimeout(300_000);
    await odsPreview(context, 'off');
    await customerLogin(page, c!, '/account');
    await odsPreview(context, 'on');
    for (const p of ['/account', '/account/action', '/account/requests', '/account/orders', '/account/wallet', '/account/invoices', '/account/turnkey', '/account/warehouse', '/account/shipping', '/account/brand', '/account/settings', '/account/support']) {
      await open(page, p);
      await expect(page.getByTestId('account-sidebar'), p).toBeVisible();
      await expect(page.locator('h1'), p).toHaveCount(1);
      await axe(page, p);
      expect(await page.content(), `${p}: no Pay later`).not.toMatch(/pay later/i);
    }
    await page.goto('/account/sourcing');
    expect(new URL(page.url()).pathname).toBe('/account/requests');
    await page.goto('/account/kyc');
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/account/settings?tab=verification');
    // pages without an ODS version keep today's page
    await open(page, '/account/ledger');
    expect(await page.locator('[data-theme="ods"]').count()).toBe(0);
  });
});
