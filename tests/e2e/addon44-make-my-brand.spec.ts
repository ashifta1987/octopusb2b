import { test, expect } from '@playwright/test';

/** Visible copy of <main>, closed FAQ answers included, JSON-LD and styles left out. */
const mainText = (page: import('@playwright/test').Page) => page.locator('main').evaluate((el) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll('script,style').forEach((s) => s.remove()); return c.textContent ?? ''; });

/** ADDON-44-D — Make My Brand on the home page and /make-my-brand (design handoff pages 01 and 03, Nov 2026). */
test('home: Make My Brand in the service bar (2nd), its service card, the announcement and the footer', async ({ page }) => {
  await page.goto('/');
  const bar = page.locator('nav[aria-label="Services"] li a');
  await expect(bar.nth(1)).toHaveText('Make My Brand');
  await expect(bar.nth(1)).toHaveAttribute('href', '/make-my-brand');
  const card = page.getByTestId('home-service-brand');
  await expect(card.getByRole('heading', { name: 'Your brand on proven products.' })).toBeVisible();
  await expect(card).toHaveAttribute('href', '/make-my-brand');
  await expect(page.getByTestId('announcement').getByRole('link', { name: /See how it works/ })).toHaveAttribute('href', '/make-my-brand');
  await expect(page.locator('footer').getByRole('link', { name: 'Make My Brand' })).toHaveAttribute('href', '/make-my-brand');
  await expect(page.getByText(/YunExpress/)).toHaveCount(0);
});

test('/make-my-brand: design sections, log-in start link, SEO tags, no brackets', async ({ page }) => {
  await page.goto('/make-my-brand');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your brand on proven products.');
  await expect(page.getByTestId('rail-brand')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('mmb-start')).toHaveAttribute('href', '/login?next=%2Frequest%2Fbrand');
  for (const h of ['Who this is for', 'How it works', 'Why branding changes what customers see', 'What is included', 'Questions buyers ask']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await expect(page.locator('#how ol > li')).toHaveCount(4);
  await expect(page.locator('#faq details')).toHaveCount(7);
  await expect(page.getByTestId('mmb-methods').locator('dt')).toHaveCount(5);
  // the studio preview is labelled as illustrative before any artwork is approved
  await expect(page.getByText('Studio previews are illustrative until you approve the final artwork.')).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Make My Brand/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/images\/design\//);
  const text = await mainText(page);
  expect(text).not.toMatch(/\[[^\]]+\]|\{\{/);
  expect(text).not.toMatch(/yunexpress|by card/i);
});
