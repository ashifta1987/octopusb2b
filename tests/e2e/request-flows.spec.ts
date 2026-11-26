import { test, expect } from '@playwright/test';
import { adminClient, createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';

/** ADDON-36 · 36-B: request flows keep the visitor's input and show the real fee (live site data, nothing submitted). */
let C: TempCustomer | null = null;
test.afterAll(async () => { if (C) await purgeTestOrgs([C.orgId], [C.id]); });

// design handoff (Nov 2026): the homepage hero is a search box ("Find factories"); the sourcing form still reads
// title / qty / country from the query string, and /sourcing sends visitors to log in, then to that form
test('hero search goes to /search; the sourcing form shows the title, quantity and country from the link', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search products or HS codes').fill('cable ties');
  await page.getByRole('button', { name: 'Find factories' }).click();
  await page.waitForURL(/\/search\?q=cable\+ties/);
  await page.goto('/sourcing');
  await expect(page.getByTestId('service-primary')).toHaveAttribute('href', '/login?next=%2Frequest%2Fsourcing');
  await page.goto(`/request/sourcing?title=${encodeURIComponent('E2E cable ties 300 mm')}&qty=20000&country=DE`);
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
  // the Live gate: with dropship_v2_ui OFF, /request/dropship is the honest Coming soon page (Batch 3: with it ON it opens
  // /account/dropship — covered in batch3.spec.ts)
  const { data: flag } = await adminClient().from('site_settings').select('value').eq('key', 'dropship_v2_ui');
  await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: false, description: 'Coming soon gate test' });
  const heads = new Set<string>();
  try {
    await page.goto('/request/dropship');
    await expect(page.locator('h1')).toHaveText('You sell. We ship to your customer.');   // design page 05: honest Coming soon
    await expect(page.getByTestId('dropship-coming-soon')).toContainText('Coming soon');
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByTestId('fee-row')).toHaveCount(0);                        // no setup form, so no fee row
    for (const t of ['sourcing', 'dropship', '3pl', 'sample', 'qc', 'certification', 'factory-audit']) { await page.goto(`/request/${t}`); heads.add(await page.locator('h1').innerText()); }
  } finally {
    if (!flag?.length) await adminClient().from('site_settings').delete().eq('key', 'dropship_v2_ui');
    else await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: flag[0].value });
  }
  expect(heads.size).toBe(7);
  // /sourcing (design page 02): the fee line shows the RFQ fee, never "Free" with a charge
  await page.goto('/sourcing');
  const fact = await page.locator('#top').innerText();
  expect(/Request fee: US\$ [\d.,]+ per request\. Quotes within 24 hours\./.test(fact)).toBe(true);
  expect(fact).not.toMatch(/Free/);
  // the cost table shows the real fee per service, or "On request" / "Free to submit" — never a zero price
  await expect(page.getByTestId('sourcing-costs').locator('dt')).toHaveCount(5);
  await expect(page.getByTestId('sourcing-costs')).not.toContainText(/US\$ 0\.00/);
});

test('login, sign-up and reset pages have their own headings', async ({ page }) => {
  await page.goto('/login'); await expect(page.locator('h1')).toHaveText('Customer log in');
  await page.goto('/signup'); await expect(page.locator('h1')).toHaveText('Create a free account');
  await page.goto('/forgot'); await expect(page.locator('h1')).toHaveText('Reset your password');
});
