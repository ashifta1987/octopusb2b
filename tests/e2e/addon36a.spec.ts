import { test, expect } from '@playwright/test';
import { pgClient } from './helpers/customer';
// the pool-alert test briefly sets the seed test pool aside and writes/deletes a sign-up: staging only
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/** ADDON-36 · 36-A: links and empty states on the live catalogue (read-only, nothing submitted). */

// design handoff (Nov 2026): the header carries the six services (no category rail); every service-bar and footer
// link must open a real page, and any category link that remains must not lead to an empty category
test('no service-bar or footer link leads to a missing page or an empty category', async ({ page }) => {
  await page.goto('/');
  const hrefs = new Set<string>();
  for (const sel of ['nav[aria-label="Services"] a[href^="/"]', 'footer a[href^="/"]']) {
    for (const a of await page.locator(sel).all()) hrefs.add((await a.getAttribute('href'))!);
  }
  expect(hrefs.size).toBeGreaterThan(8);
  for (const h of hrefs) {
    const res = await page.goto(h);
    expect(res?.status() ?? 0, h).toBeLessThan(400);
    await expect(page.locator('h1:visible').first(), h).toBeVisible();
    if (h.startsWith('/c/')) await expect(page.getByTestId('empty-category'), `${h} should have products`).toHaveCount(0);
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
  expect(empty, 'the test needs one active sub-category without live products').toBeTruthy();
  const { data: parent } = await sb.from('categories').select('slug').eq('id', empty!.parent_id).single();
  await page.goto(`/c/${parent!.slug}/${empty!.slug}`);
  await expect(page.getByTestId('empty-category')).toContainText(`We don't list ${empty!.name} yet`);
  await expect(page.getByTestId('empty-category').getByRole('link')).toHaveAttribute('href', `/request/sourcing?category=${empty!.slug}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('footer "Supplier sign-up" lands on /suppliers; staff sign-in goes to /staff/login', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'Staff login' })).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'Staff sign-in' })).toHaveAttribute('href', '/staff/login');
  await footer.getByRole('link', { name: 'Supplier sign-up' }).click();
  await page.waitForURL(/\/suppliers$/);
  await expect(page.locator('h1:visible')).toHaveText('Sell on Octopus B2B');
  await expect(page.getByTestId('supplier-apply-form')).toBeVisible();
});

test('the supplier form explains what is missing instead of failing silently', async ({ page }) => {
  await page.goto('/suppliers');
  await page.getByRole('button', { name: /Apply to sell/ }).click();
  await expect(page.getByText('Please complete the highlighted fields, then try again.')).toBeVisible();
  await expect(page.locator('#sa-company_name')).toHaveAttribute('aria-invalid', 'true');
});

test('pools: empty state with start link and notify form, or the list when pools are open', async ({ page }) => {
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

test.describe('no pool open', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  // Staging always has the seed test pool POOL-9900001 open, so the empty state (with the alert form) would never
  // show. For these two tests every open SEED pool is set aside (status 'expired', which the pool job ignores) and put
  // back afterwards. A non-seed open pool makes the test fail instead of touching it.
  let parked: string[] = [];
  test.beforeAll(async () => {
    await assertStagingOrThrow();
    const db = pgClient(); await db.connect();
    try {
      await assertStagingOrThrow(db);
      const open = (await db.query(`select id, is_seed from pools where status = 'open' and deadline_at > now()`)).rows;
      if (open.some((r) => !r.is_seed)) throw new Error('a non-test pool is open on staging: not touching it');
      parked = open.map((r) => r.id as string);
      if (parked.length) await db.query(`update pools set status = 'expired' where id = any($1) and is_seed`, [parked]);
    } finally { await db.end(); }
  });
  test.afterAll(async ({ browser }) => {
    if (!parked.length) return;
    const db = pgClient(); await db.connect();
    try { await db.query(`update pools set status = 'open' where id = any($1) and is_seed and status = 'expired'`, [parked]); } finally { await db.end(); }
    // /pools is cached (60 s): give it a moment to list the test pool again. The database is already restored, and
    // later tests accept either state, so a slow cache refresh is not a failure.
    const page = await browser.newPage();
    await poolsPageShows(page, false, 90_000).catch(() => console.warn('addon36a: /pools still cached as empty; it refreshes on its own'));
    await page.close();
  });
  /** /pools is a `use cache` scope (60 s): reload until it shows (or no longer shows) the empty state. */
  async function poolsPageShows(page: import('@playwright/test').Page, empty: boolean, timeout = 180_000) {
    await expect.poll(async () => {
      await page.goto('/pools');
      return (await page.getByTestId('no-pools').count()) > 0;
    }, { timeout, intervals: [3_000, 5_000, 10_000] }).toBe(empty);
  }

  test('pools: empty state with steps, start link and notify form', async ({ page }) => {
    test.setTimeout(240_000);
    await poolsPageShows(page, true);
    const empty = page.getByTestId('no-pools');
    await expect(empty).toContainText('No pools are open right now');
    await expect(empty.getByRole('link', { name: 'Start a pool on a product' })).toHaveAttribute('href', '/products?pool=1');
    await expect(page.locator('#closes-h')).toHaveCount(0); // filter chips hidden
  });

  test('pool alert sign-up saves the email (removed again afterwards)', async ({ page }) => {
    await poolsPageShows(page, true);
    await expect(page.getByTestId('pool-notify')).toBeVisible();
    const email = `e2e-pool-${Date.now()}@example.com`;
    const db = pgClient(); await db.connect();
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
});
