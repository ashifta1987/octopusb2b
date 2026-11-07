import { test, expect, type Page } from '@playwright/test';
import { adminClient } from './helpers/customer';

/**
 * ADDON-44-E (staging, needs `pnpm demo:seed`): dropship catalogue + product page as a temporary buyer of W-10015.
 * The buyer and its import-list rows are removed afterwards.
 */
let user: { id: string; email: string; password: string; org: string } | null = null;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: env } = await admin.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  const { data: org } = await admin.from('organizations').select('id').eq('wallet_reference', 'W-10015').single();
  const email = `e2e.dropship+${Date.now()}@demo.octopusb2b.com`, password = `E2e-${Date.now()}-Ds!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin.from('profiles').upsert({ id: data.user!.id, full_name: 'E2E Dropship', email });
  await admin.from('org_members').insert({ org_id: org!.id, user_id: data.user!.id, member_role: 'buyer' });
  user = { id: data.user!.id, email, password, org: org!.id };
});
test.afterAll(async () => {
  if (!user) return;
  const admin = adminClient();
  await admin.from('dropship_import_list').delete().eq('added_by', user.id);
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
const usd = (s: string) => Number(s.replace(/[^\d.-]/g, ''));

test('catalogue: verified cards with cost / suggested / profit; blocked products greyed with a reason; no supplier codes', async ({ page }) => {
  await login(page, '/account/dropship/catalogue?country=SA');
  await page.goto('/account/dropship/catalogue?country=SA');
  const cards = page.getByTestId('catalogue-card');
  await expect(cards.first()).toBeVisible();
  for (const c of (await cards.all()).slice(0, 4)) {
    await expect(c.getByTestId('verified-badge')).toBeVisible();
    await expect(c.getByText('Your cost (incl. shipping)')).toBeVisible();
  }
  const blocked = page.getByTestId('catalogue-blocked');
  await expect(blocked.first()).toBeVisible();
  await expect(blocked.first().getByTestId('blocked-reason')).toContainText('Not available to Saudi Arabia');
  await expect(blocked.first().getByTestId('import-add')).toHaveCount(0);
  const body = await page.locator('main').innerText();
  expect(body).not.toMatch(/OCT-\d{4}|yunexpress/i);
  await expect(page.getByText('Prototype · example data')).toHaveCount(0);
});

test('shipping-type chip filters; add to import list toggles to Added and back', async ({ page }) => {
  await login(page, '/account/dropship/catalogue?country=AE&ship=economy');
  await page.goto('/account/dropship/catalogue?country=AE&ship=economy');
  const cards = page.getByTestId('catalogue-card');
  await expect(cards.first()).toBeVisible();
  for (const c of (await cards.all()).slice(0, 6)) await expect(c.getByTestId('ship-economy')).toBeVisible();
  const first = cards.first();
  await first.getByTestId('import-add').click();
  await expect(first.getByTestId('import-added')).toBeVisible();
  await expect(page.getByTestId('import-list-link')).toContainText('Import list (1)');
  await first.getByTestId('import-added').click();
  await expect(first.getByTestId('import-add')).toBeVisible();
});

test('product page: cost table per shipping type, profit recalculates, push = coming soon, brand link', async ({ page }) => {
  await login(page, '/account/dropship/catalogue?country=AE');
  await page.goto('/account/dropship/catalogue?country=AE');
  await page.getByTestId('catalogue-card').first().getByRole('link').first().click();
  await expect(page.getByTestId('dropship-product')).toBeVisible();
  const rows = page.getByTestId('cost-table').locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
  // total column = product + shipping and duties + fee
  for (const r of await rows.all()) {
    const t = await r.locator('td').allInnerTexts();
    expect(usd(t[5])).toBeCloseTo(usd(t[2]) + usd(t[3]) + usd(t[4]), 2);
  }
  const total = usd((await rows.first().locator('td').nth(5).innerText()));
  await page.getByTestId('sell-price').fill((total + 10).toFixed(2));
  await expect(page.getByTestId('profit')).toHaveText('US$ 10.00');
  await page.getByRole('button', { name: 'Push to my store' }).click();
  await expect(page.getByTestId('push-soon')).toContainText('coming soon');
  await expect(page.getByTestId('make-it-your-brand').getByRole('link')).toHaveAttribute('href', /product=/);
  expect(await page.locator('main').innerText()).not.toMatch(/OCT-\d{4}|yunexpress/i);
});

