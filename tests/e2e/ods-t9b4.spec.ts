import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * ODS 1.0 · T9 batch 4 (Back Office › Services): Turnkey (overview, projects, project record, approvals, reports, settings,
 * QC inspector screens), MOQ pools, Make My Brand projects, B2B shipments, Customer geography. STAGING / LOCAL ONLY.
 * Read-only part: fixtures in the real OfficeFrame. @writes part: a temporary admin opens the REAL screens; nothing is changed.
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
  '/dev/ui/screens/office-turnkey-overview',
  '/dev/ui/screens/office-turnkey-projects',
  '/dev/ui/screens/office-turnkey-project',
  '/dev/ui/screens/office-turnkey-project?role=viewer',
  '/dev/ui/screens/office-turnkey-approvals',
  '/dev/ui/screens/office-turnkey-reports',
  '/dev/ui/screens/office-turnkey-settings',
  '/dev/ui/screens/office-turnkey-inspect',
  '/dev/ui/screens/office-pools?state=list',
  '/dev/ui/screens/office-pools?state=drawer',
  '/dev/ui/screens/office-brand-projects?state=list',
  '/dev/ui/screens/office-brand-project?state=default',
  '/dev/ui/screens/office-brand-project?state=status',
  '/dev/ui/screens/office-b2b-shipments',
  '/dev/ui/screens/office-geography',
];

test.describe('ODS T9b4 · fixtures: axe at 1280 and 390, no sideways scroll', () => {
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

test.describe('ODS T9b4 · behaviour (fixtures)', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 1000 }); });

  test('Turnkey: grid, project record with stepper and tabs; inspector screen works on a phone', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-turnkey-projects');
    await expect(page.getByTestId('tk-projects-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-turnkey-project');
    for (const id of ['tk-record', 'tk-record-header', 'tk-record-stepper', 'tk-record-tabs']) await expect(page.getByTestId(id).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/dev/ui/screens/office-turnkey-inspect');
    await expect(page.getByTestId('tk-insp-list').or(page.getByTestId('tk-inspect-job')).first()).toBeVisible();
  });

  test('Pools and Make My Brand: grids, pool drawer, project record', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-pools?state=list');
    await expect(page.getByTestId('pools-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-brand-projects?state=list');
    await expect(page.getByTestId('brand-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-brand-project?state=default');
    await expect(page.getByTestId('brand-record')).toBeVisible();
  });

  test('B2B shipments and geography: grids', async ({ page }) => {
    await open(page, '/dev/ui/screens/office-b2b-shipments');
    await expect(page.getByTestId('b2b-shipments-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/office-geography');
    await expect(page.getByTestId('geo-grid')).toBeVisible();
  });
});

test.describe('ODS T9b4 · real screens (@writes: temporary staff member)', () => {
  test.describe.configure({ mode: 'serial' });
  let s: TempStaff | null = null;
  test.afterAll(async () => {
    await deleteTempStaff(s);
  });
  test('Services screens render on the ODS theme @writes', async ({ page, context }) => {
    test.setTimeout(400_000);
    s = await createTempStaff('admin');
    await staffLogin(page, s, '/admin');
    await odsPreview(context, 'on');
    const pages = [
      ['/admin/turnkey', 'tk-overview'], ['/admin/turnkey/projects', 'tk-projects'], ['/admin/turnkey/approvals', 'tk-approvals'],
      ['/admin/turnkey/reports', 'tk-reports'], ['/admin/turnkey/settings', 'tk-settings'],
      ['/admin/pools', 'pools-page'], ['/admin/brand-projects', 'brand-page'],
      ['/office/warehouse/b2b-shipments', 'b2b-shipments-page'], ['/admin/geography', 'geo-grid'],
    ] as const;
    for (const [p, id] of pages) {
      await open(page, p);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
      await axe(page, p);
    }
    for (const [list, prefix, record] of [['/admin/turnkey/projects', '/admin/turnkey/projects/', 'tk-record'], ['/admin/brand-projects', '/admin/brand-projects/', 'brand-record']] as const) {
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
    for (const [p, id] of [['/admin/pools', 'pools-page'], ['/admin/brand-projects', 'brand-page']] as const) {
      await open(page, p);
      await expect(page.getByTestId(id), `${p} switch off`).toHaveCount(0);
    }
  });
});
