import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * ODS 1.0 · T9 batch 3 (Back Office › Accounts): Finance overview, Receivables, Reports, Held payments, Credit terms,
 * Bank transfers, SaaS billing, Wallets, and the new Credit notes / Ledger / Payments grids. Master prompt Part 7.4, 7.7.
 * STAGING / LOCAL ONLY. Read-only part: fixtures in the real OfficeFrame. @writes part: a temporary admin opens the REAL
 * screens on the ODS theme; no money action is triggered.
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
  '/dev/ui/screens/office-finance?state=default',
  '/dev/ui/screens/office-finance?state=view-only',
  '/dev/ui/screens/office-receivables?state=default',
  '/dev/ui/screens/office-receivables?state=drawer',
  '/dev/ui/screens/office-reports?view=overview&state=default',
  '/dev/ui/screens/office-reports?view=divisions&state=default',
  '/dev/ui/screens/office-holds?state=list&role=finance',
  '/dev/ui/screens/office-holds?state=second-approver&role=finance',
  '/dev/ui/screens/office-credit?state=list&role=finance',
  '/dev/ui/screens/office-credit?state=propose&role=finance',
  '/dev/ui/screens/office-transfers?state=list&role=finance',
  '/dev/ui/screens/office-transfers?state=proforma&role=finance',
  '/dev/ui/screens/office-saas?state=list&role=finance',
  '/dev/ui/screens/office-wallets?state=list&role=admin',
  '/dev/ui/screens/office-wallets?state=drawer&role=admin',
  '/dev/ui/screens/office-credit-notes?state=list',
  '/dev/ui/screens/office-credit-notes?state=drawer',
  '/dev/ui/screens/office-ledger?state=list',
  '/dev/ui/screens/office-ledger?state=account',
  '/dev/ui/screens/office-ledger?state=drawer',
  '/dev/ui/screens/office-payments?state=list',
  '/dev/ui/screens/office-payments?state=drawer',
];

test.describe('ODS T9b3 · fixtures: axe at 1280 and 390, no sideways scroll', () => {
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

test.describe('ODS T9b3 · behaviour (fixtures)', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 1000 }); });

  test('finance overview: KPIs, chart with a table alternative, ageing', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-finance?state=default');
    for (const id of ['finance-overview', 'kpi-strip', 'money-chart', 'ageing']) await expect(page.getByTestId(id).first()).toBeVisible();
    await expect(page.getByTestId('money-chart-table')).toHaveCount(1);
  });

  test('receivables: grid and drill-down drawer; reports: GMV table alternative', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-receivables?state=drawer');
    await expect(page.getByTestId('receivables-grid')).toBeVisible();
    await expect(page.getByTestId('receivables-drawer')).toBeVisible();
    await open(page, '/dev/ui/screens/office-reports?view=overview&state=default');
    await expect(page.getByTestId('reports-page')).toBeVisible();
    await expect(page.getByTestId('gmv-table')).toHaveCount(1);
  });

  test('money screens: grids, drawers, second approver shown', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-holds?state=second-approver&role=finance');
    await expect(page.getByTestId('holds-grid').or(page.getByTestId('hold-approvals-queue')).first()).toBeVisible();
    await expect(page.getByText(/second approver/i).first()).toBeVisible();
    await open(page, '/dev/ui/screens/office-credit?state=propose&role=finance');
    await expect(page.getByTestId('propose-drawer')).toBeVisible();
    await open(page, '/dev/ui/screens/office-transfers?state=list&role=finance');
    await expect(page.getByTestId('transfers-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-wallets?state=list&role=admin');
    await expect(page.getByTestId('wallet-page')).toBeVisible();
  });

  test('credit notes, ledger (running balance), payments: grids and record drawers', async ({ page }) => {
    for (const [p, id] of [['office-credit-notes', 'credit-notes-page'], ['office-ledger', 'ledger-page'], ['office-payments', 'payments-page']] as const) {
      await open(page, `/dev/ui/screens/${p}?state=list`);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
      await open(page, `/dev/ui/screens/${p}?state=drawer`);
      await expect(page.getByTestId('record-drawer').first(), `${p} drawer`).toBeVisible();
    }
    await open(page, '/dev/ui/screens/office-ledger?state=drawer');
    await expect(page.getByTestId('journal-panel').first()).toBeVisible();
  });
});

test.describe('ODS T9b3 · real screens (@writes: temporary staff member)', () => {
  test.describe.configure({ mode: 'serial' });
  let s: TempStaff | null = null;
  test.afterAll(async () => {
    await deleteTempStaff(s);
  });
  test('Accounts screens render on the ODS theme; new grids 404 with the switch off @writes', async ({ page, context }) => {
    test.setTimeout(400_000);
    s = await createTempStaff('admin');
    await staffLogin(page, s, '/admin');
    await odsPreview(context, 'on');
    const pages = [
      ['/admin/finance', 'finance-overview'], ['/admin/finance/receivables', 'finance-receivables-page'],
      ['/admin/reports', 'reports-page'], ['/admin/reports/divisions', 'division-report-page'],
      ['/admin/finance/holds', 'holds-page'], ['/admin/finance/credit', 'credit-page'],
      ['/admin/finance/transfers', 'transfers-page'], ['/admin/finance/saas', 'saas-page'], ['/admin/wallet', 'wallet-page'],
      ['/office/accounts/credit-notes', 'credit-notes-page'], ['/office/accounts/ledger', 'ledger-page'], ['/office/accounts/payments', 'payments-page'],
    ] as const;
    for (const [p, id] of pages) {
      await open(page, p);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
      await axe(page, p);
    }
    await odsPreview(context, 'off');
    for (const p of ['/office/accounts/credit-notes', '/office/accounts/ledger', '/office/accounts/payments']) {
      expect((await page.goto(p))?.status(), `${p} switch off`).toBe(404);
    }
  });
});
