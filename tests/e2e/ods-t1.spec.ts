import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * ODS 1.0 · T1 (tokens + logo). STAGING / LOCAL ONLY: /dev/ui is 404 on live (APP_ENVIRONMENT).
 *  1. /dev/ui renders inside one [data-theme="ods"] root, with every token section, the logos, icons and favicons.
 *  2. axe (WCAG 2.2 A/AA): 0 serious or critical at 1280 and 390 px; no sideways scroll at 390.
 *  3. Keyboard focus shows the 3 px #F59E0B ring.
 *  4. Density: buttons and inputs are 44 px (comfortable) and 32 px (compact); table rows 52 / 36.
 *  5. Flag off: the current site has no ODS root and keeps its own font.
 * Read-only: no database writes, no accounts. Screenshots when ODS_SHOTS=<dir>.
 */
const SHOTS = process.env.ODS_SHOTS;
const AMBER = 'rgb(245, 158, 11)';

async function checkAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))}`).toEqual([]);
}

/** next/image lazy-loads below the fold: make every image eager and wait until all have loaded (and really decoded). */
async function loadAllImages(page: Page) {
  const broken = await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    imgs.forEach((i) => (i.loading = 'eager'));
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    return imgs.filter((i) => !i.naturalWidth).map((i) => i.currentSrc || i.src);
  });
  expect(broken, 'every logo and favicon image loads').toEqual([]);
}

async function openDevUi(page: Page) {
  const res = await page.goto('/dev/ui');
  expect(res?.status(), '/dev/ui must render on staging / local').toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'ODS 1.0 tokens' })).toBeVisible();
}

test.describe('ODS T1 · /dev/ui tokens', () => {
  test('renders every token section inside one ODS root', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openDevUi(page);
    const root = page.locator('[data-theme="ods"]');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveAttribute('data-density', 'comfortable');
    await expect(page.locator('h1')).toHaveCount(1);
    for (const id of ['colours', 'services', 'type', 'spacing', 'radius', 'shadows', 'z', 'focus', 'densities', 'logos', 'icons', 'favicons'])
      await expect(page.getByTestId(`ods-${id}`), id).toBeVisible();
    // colour names + hex
    for (const hex of ['#1A174A', '#2A6FD1', '#5FD3C9', '#F4F6F9', '#F59E0B', '#0B7A75', '#B54708', '#B42318'])
      await expect(page.getByTestId('ods-colours'), hex).toContainText(hex);
    for (const svc of ['Sourcing', 'MOQ pools', 'Dropshipping', 'Warehouse (3PL)', 'Turnkey projects', 'Make My Brand'])
      await expect(page.getByTestId('ods-services'), svc).toContainText(svc);
    // tokens resolve inside the root (the CSS pipeline may lower-case hex values)
    const vars = await root.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { navy: cs.getPropertyValue('--ods-navy').trim().toUpperCase(), blue: cs.getPropertyValue('--ods-blue').trim().toUpperCase(), canvas: cs.backgroundColor, font: cs.fontFamily };
    });
    expect(vars).toMatchObject({ navy: '#1A174A', blue: '#2A6FD1', canvas: 'rgb(244, 246, 249)' });
    expect(vars.font).toMatch(/Inter/i);
    // logos: four variants, all links with alt "Octopus B2B"; My account opens the named Shop tab
    const logos = page.getByTestId('ods-logos').locator('a[data-ods-logo]');
    await expect(logos).toHaveCount(4);
    await expect(page.getByTestId('ods-logos').locator('img[alt="Octopus B2B"]')).toHaveCount(4);
    await expect(page.locator('a[data-ods-logo="white-tagline"]')).toHaveAttribute('target', 'octopus-shop');
    await expect(page.locator('a[data-ods-logo="white-tagline"]')).toHaveAttribute('href', '/shop');
    await expect(page.locator('a[data-ods-logo="mark-white"]')).toHaveAttribute('href', '/shop');
    // icons: sizes 14 / 16 / 18 / 20 / 22, aria-hidden, stroke 1.9
    for (const [k, px] of [['xs', 14], ['sm', 16], ['md', 18], ['lg', 20], ['xl', 22]] as const) {
      const svg = page.getByTestId(`ods-icon-${k}`).locator('svg');
      await expect(svg).toHaveAttribute('aria-hidden', 'true');
      await expect(svg).toHaveAttribute('stroke-width', '1.9');
      const box = await svg.boundingBox();
      expect(Math.round(box!.width), `${k} icon`).toBe(px);
    }
    await loadAllImages(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-ui-1280.png`, fullPage: true });
  });

  test('axe clean at 1280 and 390, no sideways scroll on phones', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openDevUi(page);
    await checkAxe(page, '/dev/ui @1280');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '/dev/ui @390 must not overflow sideways').toBe(true);
    await checkAxe(page, '/dev/ui @390');
    await loadAllImages(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-ui-390.png`, fullPage: true });
  });

  test('keyboard focus shows the 3 px amber ring', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openDevUi(page);
    // first Tab = the skip link; it must carry the ring too
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { text: el.textContent?.trim(), color: cs.outlineColor, width: cs.outlineWidth, style: cs.outlineStyle };
    });
    expect(first).toEqual({ text: 'Skip to content', color: AMBER, width: '3px', style: 'solid' });
    // the demo button, reached by keyboard
    const demo = page.getByTestId('ods-focus-demo');
    await demo.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(demo).toBeFocused();
    const ring = await demo.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.outlineColor, width: cs.outlineWidth, offset: cs.outlineOffset };
    });
    expect(ring).toEqual({ color: AMBER, width: '3px', offset: '2px' });
  });

  test('density panels: controls 44 / 32 px, rows 52 / 36 px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openDevUi(page);
    for (const [density, control, row] of [['comfortable', 44, 52], ['compact', 32, 36]] as const) {
      const panel = page.getByTestId(`ods-density-${density}`);
      await expect(panel).toHaveAttribute('data-density', density);
      for (const id of ['ods-control', 'ods-input']) {
        const box = await panel.getByTestId(id).boundingBox();
        expect(Math.round(box!.height), `${density} ${id}`).toBe(control);
      }
      const rowBox = await panel.getByTestId('ods-row').boundingBox();
      expect(Math.round(rowBox!.height), `${density} table row`).toBe(row);
    }
  });

  test('flag off: the current site has no ODS root and keeps its font', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const res = await page.goto('/contact');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator('[data-theme="ods"]')).toHaveCount(0);
    const body = await page.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, odsNavy: getComputedStyle(document.body).getPropertyValue('--ods-navy') }));
    expect(body.font).not.toMatch(/Inter/i);
    expect(body.odsNavy.trim()).toBe('');
  });
});
