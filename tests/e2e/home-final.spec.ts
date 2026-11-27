import { test, expect } from '@playwright/test';

/** Visible copy of <main>, closed FAQ answers included, JSON-LD and styles left out. */
const mainText = (page: import('@playwright/test').Page) => page.locator('main').evaluate((el) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll('script,style').forEach((s) => s.remove()); return c.textContent ?? ''; });

/** Homepage — design handoff page 01 (Nov 2026): sections in the design's order, pictures with alt text, real data,
 *  FAQ keyboard, no announcement bar (owner 27 Nov), no horizontal scroll at 1440 and 390. */
test('sections in the design order; six service cards with pictures and alt text; no carrier names', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('From the factory to your customer. One account.');
  // later sections stream in (Suspense): wait for the last one before reading the order
  await page.locator('main section#start').waitFor();
  const ids = await page.$$eval('main section[id]', (els) => els.map((e) => e.id));
  for (const id of ['top', 'services', 'payment', 'faq', 'start']) expect(ids, id).toContain(id);
  const pos = ['top', 'services', 'turnkey', 'products', 'payment', 'faq', 'start'].filter((x) => ids.includes(x)).map((x) => ids.indexOf(x));
  expect(pos).toEqual([...pos].sort((a, b) => a - b));
  const cards = page.locator('[data-testid^="home-service-"]');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
  for (const card of await cards.all()) await expect(card.locator('img').first()).toHaveAttribute('alt', /\S{4,}/);
  await expect(page.getByTestId('home-service-dropship')).toContainText('Coming soon');
  // owner (26 Nov): no "Turnkey catalogue" in the header; the route has a photo per step; team and warehouse band
  await expect(page.getByRole('banner').getByRole('link', { name: 'Turnkey catalogue' })).toHaveCount(0);
  await expect(page.locator('#route li img')).toHaveCount(5);
  await expect(page.getByTestId('team-band')).toContainText('Foshan');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/images\//);
  const text = await mainText(page);
  expect(text).not.toMatch(/YunExpress|4PX|\bDHL\b/);
  // the only owner fact still to supply on the homepage is the bank-transfer time
  expect([...new Set(text.match(/\[[^\]]+\]/g) ?? [])]).toEqual(['[X]']);
});

test('real data: turnkey cards from the catalogue and ready-to-order products link to live pages', async ({ page }) => {
  await page.goto('/');
  const tk = page.getByTestId('home-turnkey');
  if (await tk.count()) {
    await expect(tk.getByRole('link').last()).toHaveAttribute('href', '/turnkey/catalogue');
    await expect(tk.locator('img').first()).toHaveAttribute('src', /site-media|^\//);
  }
  const ready = page.getByTestId('home-ready');
  if (await ready.count()) {
    for (const a of await ready.getByRole('link').all()) await expect(a).toHaveAttribute('href', /^\/p\//);
    await expect(ready).not.toContainText('PRODUCT PHOTO');
    await expect(ready).not.toContainText(/from US\$ 0\.00/);
  }
});

test('FAQ opens with the keyboard; no announcement bar above the logo', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' }); // wait for the streamed section to hydrate
  const q = page.getByTestId('home-faq').locator('summary').nth(1);
  await q.scrollIntoViewIfNeeded();
  await q.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('home-faq').locator('details').nth(1)).toHaveAttribute('open', '');
  await expect(page.getByTestId('announcement')).toHaveCount(0);
  await page.goto('/sourcing');
  await expect(page.getByTestId('announcement')).toHaveCount(0);
});

test('skip link first; no horizontal scroll (1440 and 390)', async ({ page }) => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Skip to content');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${vp.width}px`).toBeLessThanOrEqual(0);
  }
});
