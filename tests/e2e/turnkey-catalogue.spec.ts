import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pgClient } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Turnkey T0 + T1 E2E (STAGING ONLY) — design docs/design/turnkey-v2 (Catalogue + Services, matched to the text).
 *  1. /turnkey: hero with "Book a consultation (from $99)", Visit China banner, photo cards, search, category chips,
 *     detail pop-up (Escape closes it), 8 phases.
 *  2. /turnkey/services: every fee shown as a starting price.
 *  3. Old ADDON-31 URLs redirect to the catalogue.
 *  4. Admin import: preview, tick, import; the new project shows on the public page.
 *  5. axe clean at 1280 px and 390 px.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
const TEST_ID = 'tk-e2e-laundry';

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  admin = await createTempStaff('admin');
});
test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`delete from turnkey_projects where project_id = $1`, [TEST_ID]);
  } finally {
    await db.end();
  }
  await deleteTempStaff(admin);
});

test('T1 catalogue: hero, cards, search, chips, dialog, phases; axe', async ({ page }) => {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/turnkey');
    await expect(page.getByTestId('tk-catalogue')).toBeVisible();
    await expect(page.getByTestId('tk-book-consultation')).toContainText('from $99');
    await expect(page.getByTestId('tk-visit-banner')).toContainText('From $399 per day');
    await expect(page.getByTestId('tk-phases').locator('li')).toHaveCount(8);
    const total = await page.getByTestId('tk-cards').locator('li').count();
    expect(total).toBeGreaterThan(0);
    await checkAxe(page, `catalogue @${w}`);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/turnkey');
  await page.getByTestId('tk-search').fill('zzzz-no-such-project');
  await expect(page.getByTestId('tk-empty')).toBeVisible();
  await page.getByTestId('tk-search').fill('');
  const chip = page.locator('[data-testid^="tk-chip-"]').nth(1);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tk-count')).toContainText('project');
  await page.getByTestId('tk-cards').locator('button').first().click();
  const dlg = page.getByTestId('tk-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('link', { name: 'Book a consultation' })).toBeVisible();
  await checkAxe(page, 'catalogue dialog');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator('main')).not.toContainText(/Top 5|Meet the team|What our clients say|one container/i);
});

test('T1 services: every fee is a starting price; axe', async ({ page }) => {
  await page.goto('/turnkey/services');
  await expect(page.getByTestId('tk-service-consultation')).toContainText('From $99');
  await expect(page.getByTestId('tk-service-layout_drawing')).toContainText('3 versions free');
  await expect(page.getByTestId('tk-service-factory_audit')).toContainText('About $250');
  await expect(page.getByTestId('tk-service-visit_china')).toContainText('From $399 per day');
  await expect(page.getByTestId('tk-service-hotel_help')).toContainText('Free');
  await checkAxe(page, 'services @1280');
});

test('T0 old Turnkey URLs go to the catalogue', async ({ page }) => {
  for (const old of ['/turnkey/atlas', '/turnkey/gym-fit-out', '/turnkey/gym-fit-out/request', '/turnkey/gym-fit-out/interest']) {
    await page.goto(old);
    await expect(page, old).toHaveURL(/\/turnkey$/);
  }
  await page.goto('/turnkey/services');
  await expect(page).toHaveURL(/\/turnkey\/services$/);
});

test('T1 admin import: preview, import, public card', async ({ page }) => {
  await staffLogin(page, admin!, '/admin/turnkey?tab=catalogue');
  await page.goto('/admin/turnkey?tab=catalogue'); // T7: the dashboard is the Turnkey staff home; the catalogue is a tab
  await expect(page.getByTestId('tk-import')).toBeVisible();
  await page.getByTestId('tk-import-text').fill(`project_id,title,category,summary,floor_area_m2\n${TEST_ID},E2E Laundry,Laundry,Self-service laundry for e2e,90\n,,Broken,,`);
  await page.getByTestId('tk-import-preview').click();
  await expect(page.getByTestId('tk-import-preview-table')).toContainText('Error');
  await expect(page.getByTestId('tk-import-apply')).toBeDisabled();
  await page.getByTestId('tk-import-text').fill(`project_id,title,category,summary,floor_area_m2\n${TEST_ID},E2E Laundry,Laundry,Self-service laundry for e2e,90`);
  await page.getByTestId('tk-import-preview').click();
  await expect(page.getByTestId('tk-import-preview-table')).toContainText('New');
  await page.getByTestId('tk-import-apply').click();
  await expect(page.getByTestId('tk-import-msg')).toContainText('Imported: 1 new');
  await page.goto('/turnkey');
  await page.getByTestId('tk-search').fill('E2E Laundry');
  await expect(page.getByTestId(`tk-card-${TEST_ID}`)).toBeVisible();
});
