import { test, expect } from '@playwright/test';

/** ADDON-44-C — audit quick fixes (03, 05, 06, 09, 11, 13, 16) on public pages. */
const PUBLIC = ['/', '/about', '/turnkey', '/developers', '/pools', '/request/dropship', '/request/3pl', '/request/sourcing'];

test('no carrier name, card payment, separate dropship app or unsupported platforms on public pages', async ({ request }) => {
  for (const path of PUBLIC) {
    const html = await (await request.get(path)).text();
    for (const bad of [/yunexpress/i, /dropship app/i, /by card/i, /card \/ bank transfer/i, /\bWix\b/, /send orders here automatically/i]) {
      expect(html, `${path} contains ${bad}`).not.toMatch(bad);
    }
  }
});

test('3PL form has its own steps and follow-up section', async ({ page }) => {
  await page.goto('/request/3pl');
  for (const s of ['Rates sent', 'Send your first inbound notice', 'Goods received and counted']) await expect(page.getByText(s, { exact: true })).toBeVisible();
  await expect(page.getByText(/follow the request in My account › 3PL warehouse/)).toBeVisible();
  await expect(page.getByText(/Matched suppliers send/)).toHaveCount(0);
});

test('dropship form: one platform list and its own follow-up section', async ({ page }) => {
  await page.goto('/request/dropship');
  await expect(page.getByText(/follow the request in My account › Dropshipping/)).toBeVisible();
  const opts = await page.locator('select[name="store_platform"] option').allTextContents();
  expect(opts.filter((o) => !/select/i.test(o))).toEqual(['Shopify', 'WooCommerce', 'Upload a sheet']);
});

