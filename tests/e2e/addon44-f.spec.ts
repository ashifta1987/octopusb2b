import { test, expect, type Page } from '@playwright/test';
import { adminClient } from './helpers/customer';

/** ADDON-44-F (staging): boards 24 (public product page), 25 (3PL request) and 26 (Make My Brand request). */
let user: { id: string; email: string; password: string; org: string } | null = null;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: env } = await admin.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  const { data: org } = await admin.from('organizations').select('id').eq('wallet_reference', 'W-10015').single();
  const email = `e2e.brand+${Date.now()}@demo.octopusb2b.com`, password = `E2e-${Date.now()}-Mb!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin.from('profiles').upsert({ id: data.user!.id, full_name: 'E2E Brand', email });
  await admin.from('org_members').insert({ org_id: org!.id, user_id: data.user!.id, member_role: 'buyer' });
  user = { id: data.user!.id, email, password, org: org!.id };
});
test.afterAll(async () => {
  if (!user) return;
  const admin = adminClient();
  const { data: rows } = await admin.from('brand_projects').select('id, logo_paths').eq('created_by', user.id);
  const paths = (rows ?? []).flatMap((r) => r.logo_paths as string[]);
  if (paths.length) await admin.storage.from('brand-logos').remove(paths);
  await admin.from('brand_projects').delete().eq('created_by', user.id);
  await admin.from('org_members').delete().eq('user_id', user.id);
  await admin.auth.admin.deleteUser(user.id);
});
async function login(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).first().fill(user!.email);
  await page.getByLabel(/^password/i).first().fill(user!.password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('24 · product page: verified factory line without supplier code, four ways, wallet-only payment', async ({ page }) => {
  const admin = adminClient();
  const { data: sups } = await admin.from('suppliers').select('id').eq('verified', true).is('archived_at', null);
  const { data: p } = await admin.from('products').select('slug').eq('status', 'live').in('supplier_id', (sups ?? []).map((s) => s.id)).limit(1).single();
  await page.goto(`/p/${p!.slug}`);
  const line = page.getByTestId('factory-line');
  await expect(line.getByTestId('verified-badge')).toBeVisible();
  await expect(line).toContainText('Octopus verified factory');
  await expect(line).toContainText('Octopus checked this factory');
  const ways = page.getByTestId('product-ways');
  for (const t of ['way-bulk', 'way-brand', 'way-dropship', 'way-3pl']) await expect(ways.getByTestId(t)).toBeVisible();
  await expect(ways.getByTestId('way-brand').getByRole('link')).toHaveAttribute('href', /\/request\/brand\?product=/);
  await expect(page.getByTestId('how-you-pay')).toContainText('no card payments');
  expect(await page.locator('main').innerText()).not.toMatch(/Supplier OCT-\d{4}|by card/i);
});

test('25 · 3PL request: warehouse cards from settings, "Not listed? Ask us" reveals the country, checklist', async ({ page }) => {
  await page.goto('/request/3pl');
  await expect(page.getByTestId('request-tab-brand')).toContainText('Make My Brand');
  const cards = page.getByTestId('warehouse-cards');
  await expect(cards.getByText('Not listed? Ask us')).toBeVisible();
  await expect(page.getByLabel('Which country do you need?')).toHaveCount(0);
  await cards.getByText('Not listed? Ask us').click();
  await expect(page.getByLabel('Which country do you need?')).toBeVisible();
  await expect(page.getByTestId('before-you-ship')).toContainText('inbound notice');
  await expect(page.getByTestId('3pl-rates')).toBeVisible();
  // no country list of 64 options any more as the warehouse choice
  await expect(page.locator('select[name="warehouse_country"] option')).not.toHaveCount(0);
});

test('26 · Make My Brand request: 3 steps, private logo upload, MB reference, project with a signed logo link', async ({ page }) => {
  await login(page, '/request/brand');
  await page.goto('/request/brand');
  const w = page.getByTestId('brand-wizard');
  await expect(w.getByTestId('brand-next')).toBeDisabled();
  await expect(w.getByTestId('next-reason')).toContainText('Choose a product');
  await w.getByTestId('brand-products').locator('label').first().click();
  await w.getByRole('button', { name: 'UAE', exact: true }).click();
  await w.getByLabel('Quantity (units)').fill('500');
  await w.getByTestId('brand-next').click();
  await w.locator('input[name="method"][value="laser"]').check();
  await w.locator('input[name="packaging"][value="colour_box"]').check();
  await page.locator('#mb-logo').setInputFiles({ name: 'nova-logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>') });
  await expect(w.getByText('nova-logo.svg')).toBeVisible();
  await w.getByTestId('brand-next').click();
  await w.locator('input[name="dest"][value="warehouse"]').check();
  await w.getByRole('button', { name: 'Shopify', exact: true }).click();
  await expect(w.getByTestId('brand-summary')).toContainText('Laser engraving');
  await w.getByTestId('brand-send').click();
  await expect(page.getByTestId('brand-success')).toBeVisible({ timeout: 30_000 });
  const ref = await page.getByTestId('brand-ref').innerText();
  expect(ref).toMatch(/^MB-\d{4,}$/);
  await page.getByRole('link', { name: 'Open my brand project' }).click();
  const card = page.locator(`[id="${ref}"]`);
  await expect(card).toBeVisible();
  const href = await card.getByTestId('logo-link').getAttribute('href');
  expect(href).toMatch(/\/storage\/v1\/object\/sign\/brand-logos\/.+token=/);
  // the 10-minute signed link works
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
});
