import { test, expect } from '@playwright/test';

/** ADDON-44-D — boards 20 (home additions) and 21 (/make-my-brand). */
test('home: Make My Brand in the menu (2nd, NEW), section 2, first "Also on" card, footer', async ({ page }) => {
  await page.goto('/');
  const rail = page.locator('nav[aria-label="Shop by category"] li a');
  await expect(rail.nth(1)).toContainText('Make My Brand');
  await expect(rail.nth(1)).toContainText(/new/i);
  const sec = page.getByTestId('home-mmb');
  await expect(sec.getByRole('heading', { name: 'Your brand on proven products.' })).toBeVisible();
  await expect(sec.getByTestId('step-card')).toHaveCount(6);
  await expect(sec.getByTestId('studio-preview')).toHaveCount(2);
  await expect(sec.getByText('Illustrative preview. Not approved artwork.').first()).toBeVisible();
  await expect(page.getByTestId('also-mmb')).toBeVisible();
  await expect(page.locator('footer').getByRole('link', { name: 'Make My Brand' })).toHaveAttribute('href', '/make-my-brand');
  await expect(page.getByText('Global shipping · YunExpress')).toHaveCount(0);
});

test('/make-my-brand: sections, labelled examples, SEO tags, no brackets', async ({ page }) => {
  await page.goto('/make-my-brand');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Put your brand on products made by');
  await expect(page.getByTestId('rail-brand')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('mmb-methods').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('mmb-example')).toHaveCount(3);
  for (const card of await page.getByTestId('mmb-example').all()) await expect(card.getByTestId('example-pill')).toBeVisible();
  const quote = page.getByTestId('mmb-example-quote');
  await expect(quote.getByTestId('example-pill')).toBeVisible();
  await expect(quote).toContainText('US$ 19,135.00');
  await expect(page.getByTestId('faq').locator('details')).toHaveCount(5);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Make My Brand/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/mmb\//);
  const text = await page.locator('main, body').first().innerText();
  expect(text).not.toMatch(/\[[^\]]+\]|\{\{/);
  expect(text).not.toMatch(/yunexpress|by card/i);
});
