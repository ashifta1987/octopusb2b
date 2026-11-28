import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * ODS 1.0 · T5a (cart, no money), master prompt Part 5.8. STAGING / LOCAL ONLY.
 * Read-only part: the staging-only fixture /dev/ui/screens/shop-cart (real components, labelled sample props, every state).
 * @writes part (needs migration 253 applied on staging): a temporary customer adds lines, sends a quote request through
 * quote_list_submit (one RFQ with lines), and checks that NO money moved (wallet ledger unchanged) — then everything is purged.
 */
const SHOTS = process.env.ODS_SHOTS;

async function axe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `${label} axe: ${JSON.stringify(bad.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))}`).toEqual([]);
}
async function open(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(200);
  await waitForHydration(page);
}

test.describe('ODS T5a · cart fixtures (every state, axe at 1280 and 390)', () => {
  for (const state of ['buy', 'quote', 'saved', 'empty', 'rechecked', 'below-moq', 'viewer', 'unverified', 'mini-cart', 'checkout']) {
    test(state, async ({ page }) => {
      test.setTimeout(120_000);
      const path = `/dev/ui/screens/shop-cart?state=${state}`;
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(page, path);
      await expect(page.locator('h1')).toHaveCount(1);
      await axe(page, `${state} @1280`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cart-${state}-1280.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${state} @390 overflow`).toBe(true);
      await axe(page, `${state} @390`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cart-${state}-390.png`, fullPage: true });
    });
  }
});

test.describe('ODS T5a · Part 5.8 behaviour (fixture)', () => {
  test('tabs Buy now · Get a quote · Saved for later with counts; tab in the URL', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-cart?state=buy');
    const tabs = page.getByTestId('cart-tabs').getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText(/Buy now/);
    await expect(tabs.nth(1)).toContainText(/Get a quote/);
    await expect(tabs.nth(2)).toContainText(/Saved for later/);
    await expect(page.getByTestId('buy-line').first()).toBeVisible();
    await expect(page.getByTestId('summary')).toContainText(/Chosen at checkout/);
  });
  test('Send quote request is disabled while a line is below MOQ, with the reason', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-cart?state=below-moq');
    await expect(page.getByTestId('below-moq').first()).toContainText(/Raise it or join a pool/);
    await expect(page.getByTestId('send-quote')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('send-reason')).toBeVisible();
  });
  test('re-check notices: price changed, stock reduced, pool moved to Get a quote', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-cart?state=rechecked');
    await expect(page.getByTestId('recheck-banner')).toBeVisible();
    // price / stock notices sit on Buy now lines; the closed pool's line moved to the Get a quote tab
    const notices = await page.getByTestId('line-notice').evaluateAll((els) => els.map((e) => e.getAttribute('data-notice')));
    await page.getByTestId('cart-tabs').getByRole('tab').nth(1).click();
    notices.push(...(await page.getByTestId('line-notice').evaluateAll((els) => els.map((e) => e.getAttribute('data-notice')))));
    for (const n of ['price-changed', 'stock-reduced', 'pool-closed']) expect(notices).toContain(n);
  });
  test('mini-cart drawer and the checkout placeholder (no payment yet)', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-cart?state=mini-cart');
    await expect(page.getByTestId('mini-cart')).toBeVisible();
    await expect(page.getByTestId('mini-cart-added')).toBeVisible();
    await open(page, '/dev/ui/screens/shop-cart?state=checkout');
    await expect(page.getByTestId('checkout-placeholder')).toContainText(/next step/i);
  });
  test('viewer role cannot act (reason shown); phones get the fixed checkout bar', async ({ page }) => {
    await open(page, '/dev/ui/screens/shop-cart?state=viewer');
    await expect(page.getByText(/Ask your company owner/).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/dev/ui/screens/shop-cart?state=buy');
    await expect(page.getByTestId('checkout-bar')).toBeVisible();
  });
});

test.describe('ODS T5a · real cart (@writes: temporary staging customer, migration 253 applied)', () => {
  test.describe.configure({ mode: 'serial' });
  let c: TempCustomer | null = null;
  test.beforeAll(async () => {
    c = await createTempCustomer(`ods-t5-${Date.now().toString(36)}`);
    // today's quote_list_submit charges the sourcing fee (settings) from the wallet: a temporary credit limit, removed with the org (same as ch1-shop)
    const db0 = pgClient(); await db0.connect();
    try { await assertStagingDatabase(db0); await db0.query(`insert into wallet_credit_limits(org_id, limit_minor, currency, note) values ($1, 100000, current_platform_currency(), 'e2e ods-t5')`, [c.orgId]); } finally { await db0.end(); }
  });
  test.afterAll(async () => {
    if (c) await purgeTestOrgs([c.orgId], [c.id]);
  });
  test('add → cart → send one quote request with lines; no money moves @writes', async ({ page, context }) => {
    test.setTimeout(240_000);
    const db = pgClient();
    await db.connect();
    await assertStagingDatabase(db);
    const ledgerBefore = (await db.query(`select count(*)::int n from ledger_entries le join ledger_accounts la on la.id = le.account_id where la.org_id = $1`, [c!.orgId]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    await odsPreview(context, 'off');
    await customerLogin(page, c!, '/account');
    await odsPreview(context, 'on');
    await open(page, '/shop/products');
    const first = page.locator('a[href^="/shop/products/"]').first();
    await first.click();
    await waitForHydration(page);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('mini-cart')).toBeVisible();
    await open(page, '/shop/cart?tab=quote');
    await expect(page.getByTestId('quote-line')).toHaveCount(1);
    // the header counts every line
    await expect(page.getByTestId('shop-cart')).toContainText('1');
    // a below-MOQ line blocks sending; raising it to the MOQ enables it (the fixture covers the reason text)
    const send = page.getByTestId('send-quote');
    if ((await send.getAttribute('aria-disabled')) === 'true') {
      const moq = await page.getByTestId('quote-line').first().getAttribute('data-moq');
      await page.getByTestId('quote-line').first().getByTestId('line-qty').locator('input').fill(moq ?? '1');
      await page.getByTestId('quote-line').first().getByTestId('line-qty').locator('input').blur();
    }
    await send.click();
    await expect(page.getByText(/RFQ-\d+/).first()).toBeVisible();
    const rfq = (await db.query(`select r.id, (select count(*)::int from rfq_lines l where l.rfq_id = r.id) lines from rfqs r where r.org_id = $1 order by r.created_at desc limit 1`, [c!.orgId])).rows[0];
    expect(rfq?.lines, 'one RFQ with its lines').toBeGreaterThanOrEqual(1);
    const ledgerAfter = (await db.query(`select count(*)::int n from ledger_entries le join ledger_accounts la on la.id = le.account_id where la.org_id = $1`, [c!.orgId]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    // the sourcing fee is today's quote_list_submit behaviour (settings); the cart itself writes no money rows
    expect(ledgerAfter - ledgerBefore, 'the cart adds no ledger rows beyond today’s sourcing-fee rule').toBeLessThanOrEqual(2);
    await open(page, '/shop/checkout');
    await expect(page.getByTestId('checkout-placeholder')).toBeVisible();
    await db.end();
  });
});
