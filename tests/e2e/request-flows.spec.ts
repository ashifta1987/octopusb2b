import { test, expect } from '@playwright/test';
import { createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';

/** ADDON-36 · 36-B: request flows keep the visitor's input and show the real fee (live site data, nothing submitted). */
let C: TempCustomer | null = null;
test.afterAll(async () => { if (C) await purgeTestOrgs([C.orgId], [C.id]); });

test('home hero quote → the sourcing form shows the typed title, quantity and country', async ({ page }) => {
  await page.goto('/');
  await page.locator('#hq-title').fill('E2E cable ties 300 mm');
  await page.locator('#hq-qty').fill('20000');
  await page.locator('#hq-country').selectOption('DE');
  await page.getByRole('button', { name: /Request quotes/ }).click();
  await page.waitForURL(/\/request\/sourcing\?/);
  await expect(page.locator('#rq-title')).toHaveValue('E2E cable ties 300 mm');
  await expect(page.locator('#rq-quantity')).toHaveValue('20000');
  await expect(page.locator('#rq-destination_country')).toHaveValue('DE');
});

test('product "Request quote" → quantity equals the MOQ', async ({ page }) => {
  await page.goto('/products');
  await page.locator('a[href^="/p/"]').first().click();
  await page.waitForURL(/\/p\//);
  // the buy-box "Request quote" carries the quantity in the box (= MOQ by default)
  const quote = page.getByRole('link', { name: 'Request quote', exact: true }).first();
  const moq = await page.getByTestId('qty-input').inputValue();
  expect(new URL(await quote.getAttribute('href') ?? '', 'http://x').searchParams.get('qty')).toBe(moq);
  await quote.click();
  await page.waitForURL(/\/request\/sourcing\?product=/);
  await expect(page.locator('#rq-quantity')).toHaveValue(moq);
});

test('a signed-out visitor fills the form, signs in and finds the values restored', async ({ page }) => {
  C = await createTempCustomer('draft');
  await page.goto('/request/sourcing');
  await expect(page.getByText(/Sign in to submit/).first()).toBeVisible();
  await page.locator('#rq-title').fill('E2E silicone phone case');
  await page.locator('#rq-details').fill('Matte black, iPhone 16, logo print');
  await page.locator('#rq-quantity').fill('1500');
  await page.locator('#rq-destination_country').selectOption('AE');
  await page.getByTestId('signin-to-submit').click();
  await page.waitForURL(/\/login\?next=/);
  await page.getByLabel(/email/i).first().fill(C.email);
  await page.getByLabel(/^password/i).first().fill(C.password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL(/\/request\/sourcing/, { timeout: 30_000 });
  await expect(page.locator('#rq-title')).toHaveValue('E2E silicone phone case');
  await expect(page.locator('#rq-details')).toHaveValue('Matte black, iPhone 16, logo print');
  await expect(page.locator('#rq-quantity')).toHaveValue('1500');
  await expect(page.locator('#rq-destination_country')).toHaveValue('AE');
});

test('fee text never shows "Free" together with a charge; each type has its own heading', async ({ page }) => {
  await page.goto('/request/sourcing');
  await expect(page.locator('h1')).toHaveText("Tell us the product. We'll find the factory.");
  const row = await page.getByTestId('fee-row').innerText();
  const text = await page.getByTestId('fee-text').innerText();
  if (/Free/.test(row)) expect(text).not.toMatch(/charged/i); else expect(text).toMatch(/RFQ fee .* charged/);
  await page.goto('/request/dropship');
  await expect(page.locator('h1')).toHaveText('Start dropshipping with Octopus B2B');
  await expect(page.getByText('How dropship setup works')).toBeVisible();
  await expect(page.getByTestId('fee-row')).toContainText('Free');
  await expect(page.getByTestId('fee-text')).not.toContainText(/charged from your wallet when you submit/i);
  const heads = new Set<string>();
  for (const t of ['sourcing', 'dropship', '3pl', 'sample', 'qc', 'certification']) { await page.goto(`/request/${t}`); heads.add(await page.locator('h1').innerText()); }
  expect(heads.size).toBe(6);
  await page.goto('/');
  const pill = await page.getByTestId('quote-fee').innerText();
  expect(pill === 'FREE' || pill === 'Free' || /^RFQ fee /.test(pill)).toBe(true);
});

test('login, sign-up and reset pages have their own headings', async ({ page }) => {
  await page.goto('/login'); await expect(page.locator('h1')).toHaveText('Log in to Octopus B2B');
  await page.goto('/signup'); await expect(page.locator('h1')).toHaveText('Create a free account');
  await page.goto('/forgot'); await expect(page.locator('h1')).toHaveText('Reset your password');
});
