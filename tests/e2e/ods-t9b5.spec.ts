import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * ODS 1.0 · T9 batch 5 (Back Office › Catalogue, Website, Admin): products moderation, suppliers, import, HS codes,
 * catalogue; site content, ads, notifications, currency; staff, divisions, company, payment / dropship settings, backups.
 * STAGING / LOCAL ONLY. Read-only part: fixtures in the real OfficeFrame. @writes part: a temporary admin opens the REAL
 * screens; nothing is saved.
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
  '/dev/ui/screens/office-products',
  '/dev/ui/screens/office-suppliers',
  '/dev/ui/screens/office-import',
  '/dev/ui/screens/office-import-job',
  '/dev/ui/screens/office-hs-codes',
  '/dev/ui/screens/office-catalog',
  '/dev/ui/screens/office-content',
  '/dev/ui/screens/office-content?state=read-only',
  '/dev/ui/screens/office-ads',
  '/dev/ui/screens/office-notifications',
  '/dev/ui/screens/office-currency',
  '/dev/ui/screens/office-currency?state=pending',
  '/dev/ui/screens/office-staff?state=default',
  '/dev/ui/screens/office-staff?state=drawer',
  '/dev/ui/screens/office-divisions?state=default',
  '/dev/ui/screens/office-company?state=default',
  '/dev/ui/screens/office-settings-payment?state=default',
  '/dev/ui/screens/office-backups?state=default',
  '/dev/ui/screens/office-backups?state=requester',
];

test.describe('ODS T9b5 · fixtures: axe at 1280 and 390, no sideways scroll', () => {
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

test.describe('ODS T9b5 · behaviour (fixtures)', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 1000 }); });

  test('catalogue: moderation grid, suppliers grid, import runs, HS codes, category record', async ({ page }) => {
    for (const [p, id] of [['office-products', 'products-grid'], ['office-suppliers', 'suppliers-grid'], ['office-import', 'import-runs-grid'], ['office-hs-codes', 'hs-grid'], ['office-catalog', 'category-record']] as const) {
      await open(page, `/dev/ui/screens/${p}`);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
    }
  });

  test('website and admin pages render their screens', async ({ page }) => {
    for (const [p, id] of [['office-content', 'content-page'], ['office-ads', 'ads-page'], ['office-notifications', 'notifications-page'], ['office-currency', 'currency-page'],
      ['office-staff?state=default', 'staff-page'], ['office-divisions?state=default', 'divisions-page'], ['office-company?state=default', 'company-page'],
      ['office-settings-payment?state=default', 'settings-payment-page'], ['office-backups?state=default', 'backups-page']] as const) {
      await open(page, `/dev/ui/screens/${p}`);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
    }
  });
});

test.describe('ODS T9b5 · real screens (@writes: temporary staff member)', () => {
  test.describe.configure({ mode: 'serial' });
  let s: TempStaff | null = null;
  test.afterAll(async () => {
    await deleteTempStaff(s);
  });
  test('Catalogue, Website and Admin screens render on the ODS theme @writes', async ({ page, context }) => {
    test.setTimeout(500_000);
    s = await createTempStaff('admin');
    await staffLogin(page, s, '/admin');
    await odsPreview(context, 'on');
    const pages = [
      ['/office/products', 'moderation-page'], ['/admin/suppliers', 'suppliers-page'], ['/admin/import', 'import-page'],
      ['/admin/import/review', 'import-review-page'], ['/admin/hs-codes', 'hs-codes-page'], ['/admin/catalog', 'catalog-page'],
      ['/admin/content', 'content-page'], ['/admin/ads', 'ads-page'], ['/admin/notifications', 'notifications-page'], ['/admin/currency', 'currency-page'],
      ['/admin/staff', 'staff-page'], ['/admin/divisions', 'divisions-page'], ['/admin/company', 'company-page'],
      ['/admin/settings/payment', 'settings-payment-page'], ['/admin/settings/dropship', 'settings-dropship-page'],
      ['/admin/backups', 'backups-page'],
    ] as const;
    for (const [p, id] of pages) {
      await open(page, p);
      await expect(page.getByTestId(id).first(), p).toBeVisible();
      await axe(page, p);
    }
    // switch off: today's pages answer, without the ODS screens (today's /admin/staff and payment matrix keep passing axe)
    await odsPreview(context, 'off');
    for (const [p, id] of pages.slice(0, 6)) {
      await open(page, p);
      await expect(page.getByTestId(id), `${p} switch off`).toHaveCount(0);
    }
    for (const p of ['/admin/staff', '/admin/settings/payment']) {
      await open(page, p);
      await axe(page, `${p} switch off`);
    }
  });
});
