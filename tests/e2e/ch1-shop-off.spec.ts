import { test, expect, type Page } from '@playwright/test';
import { createTempCustomer, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { getShopFlag, setShopFlag, type ShopFlag } from './helpers/shop-flag';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Shop switch OFF (owner 27 Nov 19:24: the Shop stays off on live until the Cart theme). STAGING ONLY: sets
 * site_settings.shop_enabled = false for these tests and puts the previous value back afterwards.
 *  · /shop and /shop/* → /account; signed-out → sign-in, then the account panel.
 *  · Customer sign-in without ?next= lands on /account (pre-CH-1); a safe ?next= is still followed, an unsafe one ignored.
 *  · Signed-in / shows the website again; /login shows the sign-in page (no Shop redirect).
 */
test.describe.configure({ mode: 'serial' });

let before: ShopFlag;
let buyer: TempCustomer;

test.beforeAll(async () => {
  await assertStagingOrThrow();
  before = await getShopFlag();
  await setShopFlag(false);
  buyer = await createTempCustomer('shopoff');
});

test.afterAll(async () => {
  await setShopFlag(before);
  if (buyer) await purgeTestOrgs([buyer.orgId], [buyer.id]);
});

async function login(page: Page, next?: string) {
  await page.goto(next === undefined ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).first().fill(buyer.email);
  await page.getByLabel(/^password/i).first().fill(buyer.password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('signed out: /shop goes to the account panel sign-in, never the Shop', async ({ page }) => {
  await page.goto('/shop/products');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
});

test('customer sign-in lands on /account; /shop → /account; / shows the website', async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/account$/);
  for (const p of ['/shop', '/shop/products', '/shop/quote-list']) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/account$/);
  }
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('shop-header')).toHaveCount(0);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
});

test('safe ?next= still followed, unsafe ignored (falls back to /account)', async ({ browser }) => {
  for (const [next, want] of [['/account/sourcing', /\/account\/sourcing$/], ['/\\evil.example', /\/account$/], ['//evil.example', /\/account$/]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, next);
    await expect(page, `next=${next}`).toHaveURL(want);
    expect(new URL(page.url()).host).not.toContain('evil');
    await ctx.close();
  }
});
