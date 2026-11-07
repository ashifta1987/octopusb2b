import { test, expect } from '@playwright/test';

/** ADDON-36 · 36-A: links and empty states on the live catalogue (read-only, nothing submitted). */

test('no category link in the rail or footer leads to an empty category', async ({ page }) => {
  await page.goto('/');
  const hrefs = new Set<string>();
  for (const sel of ['nav[aria-label="Shop by category"] a[href^="/c/"]', 'footer a[href^="/c/"]']) {
    for (const a of await page.locator(sel).all()) hrefs.add((await a.getAttribute('href'))!);
  }
  expect(hrefs.size).toBeGreaterThan(0);
  for (const h of hrefs) {
    await page.goto(h);
    await expect(page.locator('h1:visible').first()).toBeVisible();
    await expect(page.getByTestId('empty-category'), `${h} should have products`).toHaveCount(0);
  }
});

test('the /products sidebar lists only stocked categories, each with a count above 0', async ({ page }) => {
  await page.goto('/products');
  const counts = await page.locator('aside[aria-label="Filters"] fieldset').first().locator('a span.text-xs').allTextContents();
  expect(counts.length).toBeGreaterThan(0);
  for (const c of counts) expect(Number(c)).toBeGreaterThan(0);
});

test('an empty category says we will source it and is not indexed', async ({ page }) => {
  // pick a sub-category that currently has no live products (the catalogue changes, so it is looked up)
  const { adminClient } = await import('./helpers/customer');
  const sb = adminClient();
  const { data: cats } = await sb.from('categories').select('id, name, slug, parent_id, level').eq('active', true).eq('level', 2);
  const { data: live } = await sb.from('products').select('category_id').eq('status', 'live');
  const used = new Set((live ?? []).map((p) => p.category_id));
  const empty = (cats ?? []).find((c) => !used.has(c.id));
  test.skip(!empty, 'every sub-category has products');
  const { data: parent } = await sb.from('categories').select('slug').eq('id', empty!.parent_id).single();
  await page.goto(`/c/${parent!.slug}/${empty!.slug}`);
  await expect(page.getByTestId('empty-category')).toContainText(`We don't list ${empty!.name} yet`);
  await expect(page.getByTestId('empty-category').getByRole('link')).toHaveAttribute('href', `/request/sourcing?category=${empty!.slug}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('"Sell on Octopus B2B" and "Become a supplier" land on /suppliers; footer has no staff login', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'Staff login' })).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'Supplier and staff sign-in' })).toHaveAttribute('href', '/staff/login');
  await footer.getByRole('link', { name: 'Sell on Octopus B2B' }).click();
  await page.waitForURL(/\/suppliers$/);
  await expect(page.locator('h1:visible')).toHaveText('Sell on Octopus B2B');
  await expect(page.getByTestId('supplier-apply-form')).toBeVisible();
  await page.goto('/');
  await expect(page.locator('a:visible', { hasText: 'Become a supplier' }).first()).toHaveAttribute('href', /^\/suppliers/);
});

test('the supplier form explains what is missing instead of failing silently', async ({ page }) => {
  await page.goto('/suppliers');
  await page.getByRole('button', { name: /Apply to sell/ }).click();
  await expect(page.getByText('Please complete the highlighted fields, then try again.')).toBeVisible();
  await expect(page.locator('#sa-company_name')).toHaveAttribute('aria-invalid', 'true');
});

test('pools: empty state with steps, start link and notify form, or the list when pools are open', async ({ page }) => {
  await page.goto('/pools');
  const empty = page.getByTestId('no-pools');
  if (await empty.count()) {
    await expect(empty).toContainText('No pools are open right now');
    await expect(empty.getByRole('link', { name: 'Start a pool on a product' })).toHaveAttribute('href', '/products?pool=1');
    await expect(page.getByTestId('pool-notify')).toBeVisible();
    await expect(page.locator('#closes-h')).toHaveCount(0); // filter chips hidden
  } else {
    await expect(page.locator('#closes-h')).toBeVisible();
  }
});

test('/products?pool=1 shows a Start pool button on each card', async ({ page }) => {
  await page.goto('/products?pool=1');
  await expect(page.getByTestId('pool-mode')).toBeVisible();
  const first = page.getByRole('link', { name: /^Start pool/ }).first();
  await expect(first).toHaveAttribute('href', /^\/pools\/start\?product=/);
});

test('home "Also on Octopus" cards open public explainers with a sign-in button', async ({ page }) => {
  for (const [path, next] of [['/wallet', '/account/wallet'], ['/assistant', '/account/assistant'], ['/developers', '/account/developer']]) {
    await page.goto('/');
    await page.locator(`a[href="${path}"]:visible`).first().click();
    await page.waitForURL(new RegExp(`${path}$`));
    await expect(page.getByTestId('explainer-signin')).toHaveAttribute('href', `/login?next=${encodeURIComponent(next)}`);
  }
});

test('pool alert sign-up saves the email (removed again afterwards)', async ({ page }) => {
  await page.goto('/pools');
  test.skip(!(await page.getByTestId('pool-notify').count()), 'pools are open, so the sign-up is not shown');
  const email = `e2e-pool-${Date.now()}@example.com`;
  const pg = (await import('pg')).default;
  (await import('dotenv')).config({ path: '.env.local', quiet: true });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await page.locator('#pool-notify-email').fill(email);
    await page.getByRole('button', { name: 'Notify me' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'We will email you' })).toBeVisible();
    expect((await db.query('select 1 from pool_alert_signups where email = $1', [email])).rowCount).toBe(1);
  } finally {
    await db.query("delete from pool_alert_signups where email like 'e2e-pool-%@example.com'");
    await db.end();
  }
});
