import { test, expect } from '@playwright/test';
import { pgClient } from './helpers/customer';

/**
 * Owner 27 Nov: real listed products as examples on /sourcing ("Products we already source") and on the homepage
 * ("Ready to order"). Read-only: cards link to /p/<slug>, photos load (they are below the fold and lazy, so the page is
 * scrolled first), prices are never US$ 0, and no supplier name or code reaches the HTML (white-label).
 */
async function scrollThrough(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
  });
}

test('/sourcing shows listed products with photos, prices and links; white-label', async ({ page }) => {
  const res = await page.goto('/sourcing');
  const grid = page.getByTestId('sourcing-products');
  await expect(grid).toBeVisible();
  const cards = grid.getByTestId('showcase-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(1);
  expect(await cards.count()).toBeLessThanOrEqual(8);
  for (const a of await cards.all()) await expect(a).toHaveAttribute('href', /^\/p\/[a-z0-9-]+/);
  await expect(grid).not.toContainText(/US\$\s?0(\.0+)?(?![\d.])/);
  await expect(page.getByTestId('browse-catalogue')).toHaveAttribute('href', '/products');
  await expect(page.getByRole('link', { name: 'Send a sourcing request' })).toHaveAttribute('href', '/request/sourcing');
  // every photo that is shown actually loads (no broken image); cards without one show the placeholder tile
  await scrollThrough(page);
  const broken = await grid.evaluate((el) => [...el.querySelectorAll('img')].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  expect(broken).toEqual([]);
  // white-label: no supplier legal name or supplier code anywhere in the page HTML
  const html = (await res?.text()) ?? '';
  const db = pgClient(); await db.connect();
  try {
    const { rows } = await db.query(`select code, legal_name from public.suppliers where legal_name is not null limit 500`);
    for (const r of rows as { code: string | null; legal_name: string }[]) {
      if (r.legal_name.trim().length >= 4) expect(html, 'supplier name in /sourcing').not.toContain(r.legal_name.trim());
      if (r.code && r.code.length >= 4) expect(html, 'supplier code in /sourcing').not.toContain(r.code);
    }
  } finally { await db.end(); }
});

test('homepage "Ready to order" cards show real photos once scrolled into view', async ({ page }) => {
  await page.goto('/');
  const grid = page.getByTestId('home-ready');
  if (!(await grid.count())) test.skip(true, 'no live products');
  await expect(page.getByTestId('ready-caption').getByRole('link', { name: 'Octopus Sourcing' })).toHaveAttribute('href', '/products');
  await grid.scrollIntoViewIfNeeded();
  await scrollThrough(page);
  const imgs = grid.locator('img');
  if (await imgs.count()) {
    await expect.poll(async () => imgs.evaluateAll((els) => els.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  }
  await expect(grid).not.toContainText(/US\$\s?0(\.0+)?(?![\d.])/);
});

// owner 27 Nov: the catalogue belongs to Octopus Sourcing; product pages offer every way to use the product
test('/products: Octopus Sourcing mark, breadcrumb and current service', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByTestId('brand-mark-sourcing')).toBeVisible();
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumb.getByRole('link', { name: 'Product sourcing' })).toHaveAttribute('href', '/sourcing');
  await expect(crumb).toContainText('Products');
  await expect(page.getByTestId('rail-sourcing')).toHaveAttribute('aria-current', 'page');
});

test('/p/[slug]: "What would you like to do" actions with product links; white-label', async ({ page }) => {
  await page.goto('/products');
  const href = await page.locator('main a[href^="/p/"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.goto(href!);
  const ways = page.getByTestId('product-ways');
  await expect(ways.getByRole('heading', { name: 'What would you like to do with this product?' })).toBeVisible();
  await expect(ways.getByTestId('way-bulk').getByRole('link')).toHaveAttribute('href', /\/request\/sourcing\?product=/);
  await expect(ways.getByTestId('way-dropship')).toBeVisible();
  if (await ways.getByTestId('way-pool').count()) await expect(ways.getByTestId('way-pool').getByRole('link')).toHaveAttribute('href', /\/pools\/start\?product=/);
  if (await ways.getByTestId('way-brand').count()) await expect(ways.getByTestId('way-brand').getByRole('link')).toHaveAttribute('href', /\/request\/brand\?product=/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Product sourcing' })).toHaveAttribute('href', '/sourcing');
  await expect(page.getByTestId('rail-sourcing')).toHaveAttribute('aria-current', 'page');
  const html = (await res?.text()) ?? '';
  const db = pgClient(); await db.connect();
  try {
    const { rows } = await db.query(`select code, legal_name from public.suppliers where legal_name is not null limit 500`);
    for (const r of rows as { code: string | null; legal_name: string }[]) {
      if (r.legal_name.trim().length >= 4) expect(html, 'supplier name on the product page').not.toContain(r.legal_name.trim());
      if (r.code && r.code.length >= 4) expect(html, 'supplier code on the product page').not.toContain(r.code);
    }
  } finally { await db.end(); }
});
