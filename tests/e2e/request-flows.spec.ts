import { test, expect } from '@playwright/test';
import { createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';

/** ADDON-36 · 36-B: request flows keep the visitor's input and show the real fee (live site data, nothing submitted). */
let C: TempCustomer | null = null;
test.afterAll(async () => { if (C) await purgeTestOrgs([C.orgId], [C.id]); });

// the brand-kit home (step 5) replaced the hero quote box with the service picker's "Source a product" tab
test('home picker "Source a product" → the sourcing form shows the typed title, quantity and country', async ({ page }) => {
  await page.goto('/?do=source');
  await page.locator('#pk-title').fill('E2E cable ties 300 mm');
  await page.locator('#pk-qty').fill('20000');
  await page.locator('#pk-country').selectOption('DE');
  await page.locator('button[form="picker-source"]').click();
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
  await expect(page.locator('h1')).toHaveText('Dropshipping is coming soon');   // 20 Nov 2026: honest Coming soon
  await expect(page.getByText('How dropshipping will work')).toBeVisible();
  await expect(page.getByTestId('fee-row')).toHaveCount(0);                        // no setup form, so no fee row
  const heads = new Set<string>();
  for (const t of ['sourcing', 'dropship', '3pl', 'sample', 'qc', 'certification']) { await page.goto(`/request/${t}`); heads.add(await page.locator('h1').innerText()); }
  expect(heads.size).toBe(6);
  // home picker, Source tab: the fact line shows the RFQ fee or no fee, never "Free" with a charge
  await page.goto('/?do=source');
  const fact = await page.locator('#picker-source').locator('xpath=..').innerText();
  expect(/RFQ fee US\$ [\d.,]+ · quotes in 24 h|Quotes in 24 h/.test(fact)).toBe(true);
  expect(fact).not.toMatch(/Free/);
});

test('login, sign-up and reset pages have their own headings', async ({ page }) => {
  await page.goto('/login'); await expect(page.locator('h1')).toHaveText('Log in to Octopus B2B');
  await page.goto('/signup'); await expect(page.locator('h1')).toHaveText('Create a free account');
  await page.goto('/forgot'); await expect(page.locator('h1')).toHaveText('Reset your password');
});
