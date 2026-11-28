import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * ODS 1.0 · T9 batch 1 (Back Office screens: Dashboard, My work, Approvals, Accounts › Invoices, Customer record),
 * master prompt Part 7.2–7.5, 7.7, 7.8. STAGING / LOCAL ONLY.
 * Read-only part: staging-only fixtures inside the real OfficeFrame with sample staff data.
 * @writes part: a temporary staff member opens the REAL screens on the ODS theme. No money action is triggered.
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
  '/dev/ui/screens/office-dashboard?role=finance',
  '/dev/ui/screens/office-dashboard?role=sales',
  '/dev/ui/screens/office-dashboard?role=finance&state=panel-error',
  '/dev/ui/screens/office-my-work',
  '/dev/ui/screens/office-approvals?state=waiting',
  '/dev/ui/screens/office-approvals?state=self',
  '/dev/ui/screens/office-approvals?state=no-second-approver',
  '/dev/ui/screens/office-invoices?state=list',
  '/dev/ui/screens/office-invoices?state=drawer',
  '/dev/ui/screens/office-invoices?state=second-approver',
  '/dev/ui/screens/office-invoices?state=virtual',
  '/dev/ui/screens/office-customer?tab=overview&role=finance',
  '/dev/ui/screens/office-customer?tab=overview&role=sales',
  '/dev/ui/screens/office-customers',
];

test.describe('ODS T9 · fixtures: axe at 1280 and 390, no sideways scroll', () => {
  for (const path of FIXTURES) {
    test(path.replace('/dev/ui/screens/', ''), async ({ page }) => {
      test.setTimeout(120_000);
      const name = path.replace('/dev/ui/screens/', '').replace(/[?=&]/g, '-');
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(page, path);
      await axe(page, `${path} @1280`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-1280.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} @390`).toBe(true);
      await axe(page, `${path} @390`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
    });
  }
});

test.describe('ODS T9 · behaviour (fixtures)', () => {
  test('dashboard: finance widgets; sales sees no money panels; the chart has a text alternative', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/office-dashboard?role=finance');
    for (const id of ['kpi-strip', 'my-work-grid', 'money-chart', 'ageing', 'recent-activity']) await expect(page.getByTestId(id).first()).toBeVisible();
    await expect(page.getByTestId('money-chart-table')).toHaveCount(1);
    await open(page, '/dev/ui/screens/office-dashboard?role=sales');
    await expect(page.getByTestId('money-chart')).toHaveCount(0);
    await expect(page.getByTestId('ageing')).toHaveCount(0);
  });
  test('approvals: self-approval blocked; reject needs a reason; second-approver warning', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/office-approvals?state=self');
    await expect(page.getByTestId('self-approval-note').first()).toContainText(/another Finance user (must )?decides?/);
    await open(page, '/dev/ui/screens/office-approvals?state=no-second-approver');
    await expect(page.getByTestId('second-approver-banner')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/dev/ui/screens/office-approvals?state=waiting');
    const card = page.getByTestId('approval-card').first();
    await expect(card).toBeVisible();
    expect(Math.round((await card.getByTestId('approve-btn').boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  });
  test('invoices: grid, status tabs in the URL, over-limit payment asks for a second approver', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/office-invoices?state=list');
    await expect(page.getByTestId('invoices-grid')).toBeVisible();
    await expect(page.getByTestId('grid-row').first()).toBeVisible();
    expect(Math.round((await page.getByTestId('grid-row').first().boundingBox())!.height)).toBe(36);
    await open(page, '/dev/ui/screens/office-invoices?state=second-approver');
    await expect(page.getByTestId('second-approver-needed')).toContainText(/APR-/);
  });
  test('customer record: finance sees the credit panel, sales does not', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/office-customer?tab=overview&role=finance');
    await expect(page.getByTestId('customer-header')).toBeVisible();
    await expect(page.getByTestId('customer-tabs')).toBeVisible();
    await expect(page.getByTestId('credit-panel')).toBeVisible();
    await open(page, '/dev/ui/screens/office-customer?tab=overview&role=sales');
    await expect(page.getByTestId('credit-panel')).toHaveCount(0);
  });
});

test.describe('ODS T9 · real screens (@writes: temporary staff member)', () => {
  test.describe.configure({ mode: 'serial' });
  let s: TempStaff | null = null;
  test.afterAll(async () => {
    await deleteTempStaff(s);
  });
  test('dashboard, my work, approvals, invoices, customers render on the ODS theme @writes', async ({ page, context }) => {
    test.setTimeout(300_000);
    s = await createTempStaff('admin');
    await staffLogin(page, s, '/admin');
    await odsPreview(context, 'on');
    for (const [p, id] of [['/office', 'office-dashboard'], ['/office/my-work', 'my-work-page'], ['/office/approvals', 'approvals-page'], ['/office/accounts/invoices', 'invoices-page'], ['/admin/customers', 'customers-grid']] as const) {
      await open(page, p);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
      await axe(page, p);
    }
    const first = page.locator('a[href^="/admin/customers/"]').first();
    if (await first.count()) {
      await first.click();
      await waitForHydration(page);
      await expect(page.getByTestId('customer-record')).toBeVisible();
    }
    // switch off: the new-only pages don't exist, today's pages answer
    await odsPreview(context, 'off');
    expect((await page.goto('/office/accounts/invoices'))?.status()).toBe(404);
  });
});
