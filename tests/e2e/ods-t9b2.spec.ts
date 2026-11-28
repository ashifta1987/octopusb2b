import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * ODS 1.0 · T9 batch 2 (Back Office › Sales: KYC, Sourcing requests + quotes, Orders, Service requests, Support, Assistant),
 * master prompt Part 7. STAGING / LOCAL ONLY.
 * Read-only part: staging-only fixtures inside the real OfficeFrame with sample staff data.
 * @writes part: a temporary staff member opens the REAL screens on the ODS theme. No decision, payment or reply is sent.
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
  '/dev/ui/screens/office-rfqs?state=list',
  '/dev/ui/screens/office-rfqs?state=empty',
  '/dev/ui/screens/office-rfq?tab=lines&role=sales',
  '/dev/ui/screens/office-rfq?tab=quotes&role=sales&quote=new',
  '/dev/ui/screens/office-rfq?tab=quotes&role=no-supplier-perm',
  '/dev/ui/screens/office-orders?state=list&role=finance',
  '/dev/ui/screens/office-orders?state=bulk&role=finance',
  '/dev/ui/screens/office-order?state=default&role=finance',
  '/dev/ui/screens/office-order?state=pay&role=finance',
  '/dev/ui/screens/office-order?state=second-approver&role=finance',
  '/dev/ui/screens/office-order?state=disputed&role=sales',
  '/dev/ui/screens/office-support?state=list',
  '/dev/ui/screens/office-support?state=ticket',
  '/dev/ui/screens/office-kyc?state=queue',
  '/dev/ui/screens/office-kyc?state=review',
  '/dev/ui/screens/office-kyc?state=locked',
  '/dev/ui/screens/office-kyc?state=supplier-second',
  '/dev/ui/screens/office-services?state=open',
  '/dev/ui/screens/office-services?state=drawer',
  '/dev/ui/screens/office-assistant?state=queue',
  '/dev/ui/screens/office-assistant?state=conversation',
];

test.describe('ODS T9b2 · fixtures: axe at 1280 and 390, no sideways scroll', () => {
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

test.describe('ODS T9b2 · behaviour (fixtures)', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 1000 }); });

  test('RFQs: grid → record with stepper, lines and quote drawer; supplier hidden without permission', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-rfqs?state=list');
    await expect(page.getByTestId('rfqs-grid')).toBeVisible();
    await expect(page.getByTestId('rfq-row').first()).toBeVisible();
    await open(page, '/dev/ui/screens/office-rfq?tab=lines&role=sales');
    for (const id of ['rfq-record', 'rfq-stepper', 'rfq-tabs', 'rfq-lines']) await expect(page.getByTestId(id).first()).toBeVisible();
    await open(page, '/dev/ui/screens/office-rfq?tab=quotes&role=sales&quote=new');
    await expect(page.getByTestId('quote-drawer')).toBeVisible();
    await open(page, '/dev/ui/screens/office-rfq?tab=quotes&role=no-supplier-perm');
    await expect(page.getByTestId('supplier-hidden').first()).toBeVisible();
  });

  test('Orders: grid, record stepper and tabs; payment drawer; second approver note', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-orders?state=list&role=finance');
    await expect(page.getByTestId('orders-grid')).toBeVisible();
    await expect(page.getByTestId('order-row').first()).toBeVisible();
    await open(page, '/dev/ui/screens/office-order?state=default&role=finance');
    for (const id of ['order-record', 'order-stepper', 'order-tabs']) await expect(page.getByTestId(id).first()).toBeVisible();
    await open(page, '/dev/ui/screens/office-order?state=pay&role=finance');
    await expect(page.getByTestId('office-record-payment')).toBeVisible();
    await open(page, '/dev/ui/screens/office-order?state=second-approver&role=finance');
    await expect(page.getByTestId('second-approver-needed').first()).toBeVisible();
  });

  test('Support: queue then ticket record', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-support?state=list');
    await expect(page.getByTestId('support-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-support?state=ticket');
    await expect(page.getByTestId('ticket-record')).toBeVisible();
  });

  test('KYC: queue, review with decision panel, locked documents, view-only shows the reason, no decision buttons', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-kyc?state=queue');
    await expect(page.getByTestId('kyc-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-kyc?state=review');
    await expect(page.getByTestId('kyc-review')).toBeVisible();
    await expect(page.getByTestId('kyc-decision')).toBeVisible();
    await open(page, '/dev/ui/screens/office-kyc?state=locked');
    await expect(page.getByTestId('kyc-docs-locked')).toBeVisible();
    await open(page, '/dev/ui/screens/office-kyc?state=view-only');
    await expect(page.getByTestId('kyc-decision-view-only')).toContainText(/not approve/);
    await expect(page.getByTestId('kyc-submit')).toHaveCount(0);
    await open(page, '/dev/ui/screens/office-kyc?state=supplier-second');
    await expect(page.getByTestId('supplier-second-needed')).toBeVisible();
  });

  test('Services and Assistant: grids, drawer, conversation', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-services?state=open');
    await expect(page.getByTestId('services-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-services?state=drawer');
    await expect(page.getByTestId('services-drawer')).toBeVisible();
    await open(page, '/dev/ui/screens/office-assistant?state=queue');
    await expect(page.getByTestId('assistant-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-assistant?state=conversation');
    await expect(page.getByTestId('assistant-conversation')).toBeVisible();
  });
});

test.describe('ODS T9b2 · real screens (@writes: temporary staff member)', () => {
  test.describe.configure({ mode: 'serial' });
  let s: TempStaff | null = null;
  test.afterAll(async () => {
    await deleteTempStaff(s);
  });
  test('KYC, RFQs, orders, services, support, assistant render on the ODS theme @writes', async ({ page, context }) => {
    test.setTimeout(300_000);
    s = await createTempStaff('admin');
    await staffLogin(page, s, '/admin');
    await odsPreview(context, 'on');
    const pages = [
      ['/office/kyc', 'kyc-grid'], ['/office/rfqs', 'rfqs-grid'], ['/office/orders', 'orders-grid'],
      ['/office/services', 'services-grid'], ['/office/support', 'support-grid'], ['/office/assistant', 'assistant-grid'],
    ] as const;
    for (const [p, id] of pages) {
      await open(page, p);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
      await axe(page, p);
    }
    for (const [list, prefix, record] of [['/office/rfqs', '/office/rfqs/', 'rfq-record'], ['/office/orders', '/office/orders/', 'order-record']] as const) {
      await open(page, list);
      const first = page.locator(`a[href^="${prefix}"]`).first();
      if (await first.count()) {
        await first.click();
        await waitForHydration(page);
        await expect(page.getByTestId(record), record).toBeVisible();
        await axe(page, record);
      }
    }
    // switch off: today's pages answer, without the ODS screens
    await odsPreview(context, 'off');
    for (const [p, id] of pages) {
      await open(page, p);
      await expect(page.getByTestId(id), `${p} switch off`).toHaveCount(0);
    }
  });
});
