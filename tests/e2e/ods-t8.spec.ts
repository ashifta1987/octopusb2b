import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * ODS 1.0 · T8 (Back Office shell), master prompt Part 7.1 / 7.8. STAGING / LOCAL ONLY.
 * Read-only part: the staging-only fixture /dev/ui/screens/office-frame (the real frame with sample staff data).
 * @writes part: a temporary staff member (2FA) opens today's Back Office pages inside the ODS frame (preview cookie).
 * It also holds the ODS twins of the two StaffShell chrome assertions that Part 7.1 supersedes in ODS mode
 * (one-app-shared.spec.ts:113 "staff-only" badge, brand-admin.spec.ts:86 "staff-bell"); like the T7 twins they only run with
 * E2E_ODS_PREVIEW set. The default suite is unchanged.
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

test.describe('ODS T8 · office frame fixture (compact), axe at 1280 and 390', () => {
  for (const state of ['default', 'collapsed', 'palette', 'many-tabs', 'unsaved', 'shortcuts', 'alerts', 'phone']) {
    test(state, async ({ page }) => {
      test.setTimeout(120_000);
      const path = `/dev/ui/screens/office-frame?state=${state}`;
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(page, path);
      await axe(page, `${state} @1280`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/office-${state}-1280.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await axe(page, `${state} @390`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/office-${state}-390.png`, fullPage: true });
    });
  }
});

test.describe('ODS T8 · Part 7.1 frame behaviour (fixture)', () => {
  test('topbar, sidebar groups, compact controls, Dashboard pinned', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/office-frame?state=default');
    await expect(page.getByTestId('office-topbar')).toBeVisible();
    for (const g of ['sales', 'services', 'accounts', 'catalogue', 'website', 'admin'])
      await expect(page.locator(`[data-testid="sidebar-group"][data-group="${g}"]`), g).toHaveCount(1);
    await expect(page.locator('[data-density="compact"]').first()).toBeVisible();
    const btn = page.locator('.ods-office .btn').first();
    if (await btn.count()) expect(Math.round((await btn.boundingBox())!.height)).toBe(32);
    await expect(page.getByTestId('workspace-tab').first()).toBeVisible();
  });
  test('Ctrl K opens the command palette; collapsed sidebar is 56 px; shortcuts dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/office-frame?state=default');
    await page.locator('body').click({ position: { x: 600, y: 600 } });
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    // collapsed sidebar = 56 px icons (the fixture pins the state; Ctrl B toggles it in the real frame — @writes test)
    expect(Math.round((await page.getByTestId('office-sidebar').boundingBox())!.width)).toBe(232);
    await open(page, '/dev/ui/screens/office-frame?state=collapsed');
    expect(Math.round((await page.getByTestId('office-sidebar').boundingBox())!.width)).toBe(56);
    await open(page, '/dev/ui/screens/office-frame?state=shortcuts');
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  });
  test('phones: bottom nav Home · Approvals · Search · Alerts', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/dev/ui/screens/office-frame?state=phone');
    const nav = page.getByTestId('office-bottom-nav');
    await expect(nav).toBeVisible();
    for (const l of ['Home', 'Approvals', 'Search', 'Alerts']) await expect(nav).toContainText(l);
  });
  test('staff sign-in pages render in the ODS scope (preview on)', async ({ page, context }) => {
    await odsPreview(context, 'on');
    for (const p of ['/staff/login', '/staff/forgot']) {
      await open(page, p);
      await expect(page.locator('[data-theme="ods"]').first(), p).toBeVisible();
      await axe(page, p);
    }
    await odsPreview(context, 'off');
    await open(page, '/staff/login');
    expect(await page.locator('[data-theme="ods"]').count()).toBe(0);
  });
});

test.describe('ODS T8 · real Back Office in the frame (@writes: temporary staff member)', () => {
  test.describe.configure({ mode: 'serial' });
  let s: TempStaff | null = null;
  test.afterAll(async () => {
    await deleteTempStaff(s);
  });
  test('today’s pages render inside the ODS frame; switch off = today’s shell @writes', async ({ page, context }) => {
    test.setTimeout(300_000);
    s = await createTempStaff('admin');
    await staffLogin(page, s, '/admin');
    await odsPreview(context, 'on');
    for (const p of ['/office', '/admin', '/admin/customers', '/office/rfqs', '/office/orders', '/admin/finance', '/office/warehouse', '/admin/staff']) {
      await open(page, p);
      await expect(page.getByTestId('office-topbar'), p).toBeVisible();
      await expect(page.getByTestId('office-sidebar'), p).toBeVisible();
      await axe(page, p);
    }
    // Ctrl B collapses the sidebar to 56 px icons
    const sidebar = page.getByTestId('office-sidebar');
    await page.locator('main').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+b');
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(56);
    await page.keyboard.press('Control+b');
    await odsPreview(context, 'off');
    await open(page, '/admin');
    expect(await page.locator('[data-theme="ods"]').count()).toBe(0);
  });
});

test.describe('ODS T8 · twins of superseded StaffShell chrome assertions (E2E_ODS_PREVIEW only, @writes)', () => {
  test.skip(!process.env.E2E_ODS_PREVIEW, 'ODS twins run only with E2E_ODS_PREVIEW=on|all');
  test.describe.configure({ mode: 'serial' });
  let s: TempStaff | null = null;
  test.afterAll(async () => {
    await deleteTempStaff(s);
  });
  test('replaces one-app-shared.spec.ts:113 (staff-only badge) and brand-admin.spec.ts:86 (staff-bell) @writes', async ({ page }) => {
    s = await createTempStaff('account_manager');
    await staffLogin(page, s, '/admin');
    // the ODS frame marks the staff area by its topbar + role chip (7.1) instead of the "Admin · staff only" badge
    await expect(page.getByTestId('office-topbar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('office-topbar')).toContainText(/account manager/i);
    // the bell: the OfficeTopbar notifications button carries the unread count in its name and opens the alerts panel
    const bell = page.getByTestId('office-topbar').getByRole('button', { name: /notifications/i });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.getByTestId('notifications-panel')).toBeVisible();
    await expect(page.getByTestId('notifications-panel').getByRole('link', { name: /staff inbox/i })).toHaveAttribute('href', '/admin/notifications');
  });
});
