import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';

/**
 * ODS 1.0 · T2 (components). STAGING / LOCAL ONLY: the /dev/ui pages are 404 on live (APP_ENVIRONMENT).
 *  1. Every /dev/ui page renders (one H1), axe (WCAG 2.2 A/AA) 0 serious/critical at 1280 and 390, no sideways scroll at 390.
 *  2. Keyboard: Tabs arrows + Home/End (automatic activation, disabled tab skipped); FilterPills aria-pressed + live count;
 *     Drawer Esc closes and returns focus; Modal traps focus; Ctrl K opens the command palette with the input focused.
 *  3. Density: the same components measure 44 / 32 (controls), 48 / 36 (tabs), 40 / 28 (pills), 52 / 36 (table and grid rows).
 * Read-only: no database writes, no accounts. Screenshots when ODS_SHOTS=<dir>.
 */
const SHOTS = process.env.ODS_SHOTS;
const PAGES = [
  ['tokens', '/dev/ui'],
  ['index', '/dev/ui/components'],
  ['navigation', '/dev/ui/components/navigation'],
  ['selection', '/dev/ui/components/selection'],
  ['content', '/dev/ui/components/content'],
  ['forms', '/dev/ui/components/forms'],
  ['data', '/dev/ui/components/data'],
] as const;

async function checkAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))}`).toEqual([]);
}

async function open(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), `${path} must render on staging / local`).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  await waitForHydration(page);
}

const height = async (l: Locator) => Math.round((await l.boundingBox())!.height);
/** Is keyboard focus inside the element with this data-testid? */
const focusInside = (page: Page, testId: string) =>
  page.evaluate((id) => !!document.querySelector(`[data-testid="${id}"]`)?.contains(document.activeElement), testId);

test.describe('ODS T2 · pages, axe and phone width', () => {
  for (const [name, path] of PAGES) {
    test(`${name}: renders, axe clean at 1280 and 390, no sideways scroll`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(page, path);
      await expect(page.locator('[data-theme="ods"]').first()).toBeVisible();
      await checkAxe(page, `${path} @1280`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-1280.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} @390 must not overflow sideways`).toBe(true);
      await checkAxe(page, `${path} @390`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
    });
  }
});

test.describe('ODS T2 · keyboard', () => {
  test('Tabs: arrows, Home / End, automatic activation, disabled tab skipped', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/components/selection');
    const tabs = page.getByTestId('tabs-demo').getByRole('tab');
    expect(await tabs.count()).toBeGreaterThanOrEqual(4);
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
    // the 3rd tab is disabled: ArrowRight goes to the 4th
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(3)).toBeFocused();
    await expect(tabs.nth(2)).not.toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toBeFocused();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    const last = tabs.nth((await tabs.count()) - 1);
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    // the selected tab controls a visible tabpanel
    const panelId = await last.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'tabpanel');
  });

  test('FilterPills: aria-pressed toggles by click and Space; the result count is live', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/components/selection');
    const group = page.getByTestId('filterpills-demo');
    const count = page.getByTestId('filterpills-count');
    await expect(count).toHaveAttribute('aria-live', /polite|assertive/);
    const pills = group.locator('button[aria-pressed]');
    expect(await pills.count()).toBeGreaterThanOrEqual(2);
    const pill = pills.nth(1);
    const before = await pill.getAttribute('aria-pressed');
    const countBefore = (await count.textContent())?.trim();
    await pill.click();
    await expect(pill).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    await expect.poll(async () => (await count.textContent())?.trim()).not.toBe(countBefore);
    await pill.focus();
    await page.keyboard.press('Space');
    await expect(pill).toHaveAttribute('aria-pressed', before ?? 'false');
  });

  test('Drawer: opens as a dialog, Esc closes it and focus returns to the trigger', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/components/forms');
    const trigger = page.getByTestId('drawer-open');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByTestId('drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('role', /dialog/);
    await expect.poll(() => focusInside(page, 'drawer')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Modal: focus is trapped (Tab and Shift+Tab), Esc closes and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/components/forms');
    const trigger = page.getByTestId('modal-open');
    await trigger.click();
    const modal = page.getByTestId('modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect.poll(() => focusInside(page, 'modal')).toBe(true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page, 'modal'), `Tab ${i + 1} stays in the modal`).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusInside(page, 'modal'), `Shift+Tab ${i + 1} stays in the modal`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Ctrl K opens the command palette with the search focused; Esc closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/components/data');
    await page.locator('h1').click();
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    expect(await focusInside(page, 'command-palette')).toBe(true);
    await page.keyboard.type('inv');
    await expect(palette.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    // the visible button opens it too
    await page.getByTestId('palette-open').click();
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(page.getByTestId('palette-open')).toBeFocused();
  });
});

test.describe('ODS T2 · density heights', () => {
  const pair = (page: Page, density: 'comfortable' | 'compact', testId: string) =>
    page.locator(`[data-testid="density-${density}"] [data-testid="${testId}"]`).first();

  for (const [path, testId, comfortable, compact] of [
    ['/dev/ui/components/content', 'button-primary', 44, 32],
    ['/dev/ui/components/content', 'datatable-row', 52, 36],
    ['/dev/ui/components/forms', 'input-default', 44, 32],
    ['/dev/ui/components/selection', 'tab-height', 48, 36],
    ['/dev/ui/components/selection', 'pill-height', 40, 28],
    ['/dev/ui/components/data', 'grid-row', 52, 36],
  ] as const) {
    test(`${testId}: ${comfortable} px comfortable, ${compact} px compact`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(page, path);
      expect(await height(pair(page, 'comfortable', testId)), `${testId} comfortable`).toBe(comfortable);
      expect(await height(pair(page, 'compact', testId)), `${testId} compact`).toBe(compact);
    });
  }

  test('focus ring is 3 px amber on components (keyboard)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/components/content');
    const btn = pair(page, 'comfortable', 'button-primary');
    await btn.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(btn).toBeFocused();
    const ring = await btn.evaluate((el) => ({ c: getComputedStyle(el).outlineColor, w: getComputedStyle(el).outlineWidth }));
    expect(ring).toEqual({ c: 'rgb(245, 158, 11)', w: '3px' });
  });
});
