import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * ODS 1.0 · T4 (Shop), master prompt Part 5.1–5.7. STAGING / LOCAL ONLY.
 * The Shop needs a session, so the read-only part runs on the staging-only fixtures (/dev/ui/screens/shop-*: the real
 * presentational components with labelled sample props, every state). Tests tagged @writes sign in a temporary staging
 * customer (created and purged here) and check the REAL /shop pages on the new theme (preview cookie, per browser).
 */
const SHOTS = process.env.ODS_SHOTS;
const ORDER = ['sourcing', 'pools', 'dropship', '3pl', 'turnkey', 'brand'];

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
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function bothWidths(page: Page, path: string, name: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await open(page, path);
  await expect(page.locator('[data-theme="ods"]').first()).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await axe(page, `${path} @1280`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(await noOverflow(page), `${path} @390 must not overflow sideways`).toBe(true);
  await axe(page, `${path} @390`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
}

test.describe('ODS T4 · switch and routes', () => {
  test('signed out: /shop pages ask to sign in (both themes); /ods/shop is never served', async ({ request }) => {
    for (const cookie of ['ods_preview=on', 'ods_preview=off']) {
      for (const p of ['/shop', '/shop/products', '/shop/pools', '/shop/search?q=lamp']) {
        const r = await request.get(p, { maxRedirects: 0, headers: { cookie } });
        expect(r.status(), `${p} (${cookie})`).toBe(307);
        expect(r.headers().location).toMatch(/\/login\?next=/);
      }
    }
    expect((await request.get('/ods/shop', { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get('/api/shop/suggest?q=lamp', { maxRedirects: 0 })).status()).toBe(401);
  });
});

test.describe('ODS T4 · fixtures: every page and state, axe at 1280 and 390', () => {
  const FIXTURES: [string, string][] = [
    ['/dev/ui/screens/shop-main', 'shop-main'],
    ['/dev/ui/screens/shop-main?state=failed', 'shop-main-failed'],
    ['/dev/ui/screens/shop-main?state=unverified', 'shop-main-unverified'],
    ['/dev/ui/screens/shop-main?state=no-dropship', 'shop-main-no-dropship'],
    ['/dev/ui/screens/shop-products', 'shop-products'],
    ['/dev/ui/screens/shop-products?state=empty', 'shop-products-empty'],
    ['/dev/ui/screens/shop-product', 'shop-product'],
    ['/dev/ui/screens/shop-product?state=below-moq', 'shop-product-below-moq'],
    ['/dev/ui/screens/shop-search', 'shop-search'],
    ['/dev/ui/screens/shop-pools', 'shop-pools'],
    ['/dev/ui/screens/shop-pool', 'shop-pool'],
    ['/dev/ui/screens/shop-turnkey', 'shop-turnkey'],
    ['/dev/ui/screens/shop-services', 'shop-services'],
  ];
  for (const [path, name] of FIXTURES) {
    test(name, async ({ page }) => {
      test.setTimeout(120_000);
      await bothWidths(page, path, name);
    });
  }
});

test.describe('ODS T4 · Part 5.1–5.2 frame and main page (fixture)', () => {
  test('frame: header, search suggestions after 2 characters, My account in its tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/shop-main');
    await expect(page.getByTestId('shop-header')).toBeVisible();
    await expect(page.getByTestId('shop-account-link')).toHaveAttribute('target', 'octopus-account');
    const search = page.getByTestId('shop-search').getByRole('combobox');
    await search.fill('l');
    await expect(page.getByTestId('suggestions')).toBeHidden();
    await search.fill('la');
    await expect(page.getByTestId('suggestions')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('suggestions')).toBeHidden();
  });
  test('six sections in the fixed order; the setup choice moves one to the top', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-main');
    expect(await page.getByTestId('service-section').evaluateAll((els) => els.map((e) => e.getAttribute('data-service')))).toEqual(ORDER);
    await open(page, '/dev/ui/screens/shop-main?interest=turnkey');
    const order = await page.getByTestId('service-section').evaluateAll((els) => els.map((e) => e.getAttribute('data-service')));
    expect(order[0]).toBe('turnkey');
    expect(order).toHaveLength(6);
  });
  test('one category choice filters all six sections and stays in the URL', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-main');
    const chip = page.getByTestId('category-chips').locator('[data-testid^="chip-"]:not([data-testid="chip-all"])').first();
    const slug = (await chip.getAttribute('data-testid'))!.replace('chip-', '');
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`category=${slug}`));
    await expect.poll(async () => page.getByTestId('service-section').evaluateAll((els) => els.map((e) => e.getAttribute('data-category')))).toEqual(Array(6).fill(slug));
  });
  test('one failing section does not blank the page', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-main?state=failed');
    const sections = page.getByTestId('service-section');
    await expect(sections).toHaveCount(6);
    await expect(sections.filter({ hasText: /couldn.t load/i })).toHaveCount(1);
    await expect(sections.filter({ has: page.locator('[data-testid^="shop-card-"]') })).not.toHaveCount(0);
  });
  test('welcome tiles open My account in its tab (max 3); not verified banner; dropship without access shows no prices', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-main');
    const tiles = page.getByTestId('waiting-tile');
    expect(await tiles.count()).toBeLessThanOrEqual(3);
    for (const t of await tiles.all()) await expect(t).toHaveAttribute('target', 'octopus-account');
    await open(page, '/dev/ui/screens/shop-main?state=nothing-waiting');
    await expect(page.getByTestId('all-set')).toBeVisible();
    await open(page, '/dev/ui/screens/shop-main?state=unverified');
    await expect(page.getByTestId('unverified-banner')).toBeVisible();
    await open(page, '/dev/ui/screens/shop-main?state=no-dropship');
    const ds = page.locator('[data-testid="service-section"][data-service="dropship"]');
    await expect(ds.getByTestId('dropship-request-access')).toBeVisible();
    await expect(ds).not.toContainText(/US\$\s?\d/);
  });
});

test.describe('ODS T4 · Part 5.3–5.7 (fixtures)', () => {
  test('product page: calculator, below-MOQ reason, tabs in the URL', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-product');
    await expect(page.getByTestId('product-page')).toBeVisible();
    await expect(page.getByTestId('ships-from')).toContainText('China');
    await open(page, '/dev/ui/screens/shop-product?state=below-moq');
    await expect(page.getByTestId('calc-reason')).toContainText(/Minimum order/);
    await expect(page.getByTestId('request-quote')).toHaveAttribute('aria-disabled', 'true');
    const tab = page.getByTestId('product-tabs').getByRole('tab').nth(1);
    await tab.click();
    await expect(page).toHaveURL(/[?&]tab=/);
  });
  test('products list: result count is live; search groups by section', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-products');
    await expect(page.getByTestId('result-count')).toHaveAttribute('aria-live', /polite|assertive/);
    await expect(page.getByTestId('products-grid')).toBeVisible();
    await open(page, '/dev/ui/screens/shop-search');
    expect(await page.locator('[data-testid="search-results"] [data-group]').count()).toBeGreaterThan(0);
  });
  test('pool page: progress values, buyer count only, join form; full pool', async ({ page }) => {
    // the pool fixture shows every state on one page, each in its own region (data-testid="fixture-<state>")
    await open(page, '/dev/ui/screens/shop-pool');
    const openPool = page.getByTestId('fixture-open');
    const bar = openPool.getByTestId('pool-progress');
    await expect(bar).toHaveAttribute('role', 'progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(openPool.getByTestId('join-form')).toBeVisible();
    await expect(openPool.getByTestId('join-total')).toContainText('US$');
    await expect(page.getByTestId('fixture-full').getByTestId('pool-full')).toContainText('This pool is full');
  });
  test('dropship gate never shows prices; warehouse views; turnkey start', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-services');
    const gate = page.getByTestId('dropship-gate').first();
    await expect(gate).toBeVisible();
    await expect(page.getByTestId('warehouse-view').first()).toBeVisible();
    await expect(page.getByTestId('brand-grid').first()).toBeVisible();
    await open(page, '/dev/ui/screens/shop-turnkey');
    await expect(page.getByTestId('fixture-start').getByTestId('turnkey-start')).toContainText('Nothing is charged until you approve the proforma');
  });
});

test.describe('ODS T4 · real Shop on the new theme (@writes: temporary staging customer)', () => {
  test.describe.configure({ mode: 'serial' });
  let c: TempCustomer | null = null;
  test.beforeAll(async () => {
    c = await createTempCustomer(`ods-t4-${Date.now().toString(36)}`);
  });
  test.afterAll(async () => {
    if (c) await purgeTestOrgs([c.orgId], [c.id]);
  });
  test('main page, products, product page, pools, search, services render; no supplier data anywhere @writes', async ({ page, context }) => {
    test.setTimeout(240_000);
    await odsPreview(context, 'off');
    await customerLogin(page, c!, '/account');
    await odsPreview(context, 'on');
    await open(page, '/shop');
    await expect(page.getByTestId('shop-main')).toBeVisible();
    await expect(page.getByTestId('service-section')).toHaveCount(6);
    expect(await page.getByTestId('service-section').evaluateAll((els) => els.map((e) => e.getAttribute('data-service')))).toEqual(ORDER);
    await axe(page, '/shop');
    const html: string[] = [await page.content()];
    const productHref = await page.locator('a[href^="/shop/products/"]').first().getAttribute('href').catch(() => null);
    for (const p of ['/shop/products', '/shop/pools', '/shop/turnkey', '/shop/dropship', '/shop/warehouse', '/shop/brand', '/shop/search?q=a', ...(productHref ? [productHref] : [])]) {
      await open(page, p);
      await expect(page.locator('[data-theme="ods"]').first()).toBeVisible();
      await axe(page, p);
      html.push(await page.content());
    }
    const all = html.join('\n');
    const hit = all.match(/.{0,80}("supplier_id"|"cost_cents"|"margin_(?:cents|pct|bps|percent)"|"factory_model"|"purchase_price"|"model_no").{0,80}/);
    expect(hit?.[0] ?? null, 'supplier / cost field names in the pages or payloads').toBeNull();
    const db = pgClient();
    await db.connect();
    try {
      await assertStagingDatabase(db);
      const names = (await db.query(`select legal_name as name, code from suppliers limit 1000`)).rows as { name: string | null; code: string | null }[];
      for (const r of names) for (const s of [r.name, r.code]) if (s && s.length > 3) expect(all.includes(s), `supplier leak: ${s}`).toBe(false);
    } finally {
      await db.end();
    }
    // /shop/all → /shop; the CH-1 quote list stays on today's page until the T5 cart
    await page.goto('/shop/all');
    expect(new URL(page.url()).pathname).toBe('/shop');
    await open(page, '/shop/quote-list');
    expect(await page.locator('[data-theme="ods"]').count()).toBe(0);
  });
});
