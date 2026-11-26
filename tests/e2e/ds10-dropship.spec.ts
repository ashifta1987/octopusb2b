import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Release 4 · Step 10 (order problems and support) E2E (STAGING ONLY) — Match: screens/OrderDetail.html, screens/Support.html,
 * mobile/M_OrderDetail.html, mobile/M_Support.html, states/States-Orders.html (lost parcel claim, refund to wallet),
 * staff/StaffQueue.html (Exceptions → Order problems). Desktop 1280 px and phone 390 px, axe clean, separate browser contexts
 * per user. Orders arrive through the source-agnostic intake with an extended-catalogue product (no stock movements, so the
 * test organisation can be purged).
 *  1. Order detail @1280: items, progress, cost lines (Processing its own line), "Need to change this order?" with the
 *     cancel reason after handover, lost parcel claim → stepper.
 *  2. Staff (own context): Order problems → carrier claim → Reship now; damaged claim (photo) on the second order → refund ≤ US$1,000.
 *  3. Merchant @390: the claim shows Reshipped; a return to the warehouse; Support lists the tickets with their order links;
 *     new ticket by order number (wrong number → the field says why); the thread + reply.
 *  4. Support @1280 + Order detail of a not-found order.
 */
test.describe.configure({ mode: 'serial' });

const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let m1: TempCustomer | null = null;
let staff: TempStaff | null = null;
let variant: { id: string; model_no: string } | null = null;
let orderA: { id: string; order_number: string; name: string } | null = null;
let orderB: { id: string; order_number: string; name: string; total: number } | null = null;
let claimCode = '';
let damagedCode = '';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];
const stamp = Date.now().toString(36);
const SHOTS = process.env.DS10_SHOTS;
const usd = (c: number) => `US$${(c / 100).toFixed(2)}`;

async function checkAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}
async function noOverflow(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} must not overflow sideways`).toBe(true);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function sql<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    return (await db.query(q, p)).rows as T[];
  } finally {
    await db.end();
  }
}
async function intake(orgId: string, ext: string) {
  const order = {
    external_order_id: ext, external_order_name: `#${ext.slice(-4)}`, buyer_name: 'Huda Ahmed',
    address: { name: 'Huda Ahmed', line1: '12 Marina Walk', city: 'Dubai', country: 'AE' }, risk: 'low',
    lines: [{ variant_id: variant!.id, qty: 2, buyer_unit_price_cents: 3999 }], other_items: 1,
  };
  return (await sql<{ r: Record<string, unknown> }>(`select ds_order_intake($1, 'shopify', $2::jsonb) r`, [orgId, JSON.stringify(order)]))[0].r;
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  m1 = await createTempCustomer('ds10a');
  const sb = adminClient();
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'DS10 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [m1.orgId]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = coalesce(company_services.started_at, now())`, [m1.orgId]);
  for (const c of ['AE', 'US']) await sql(`insert into dropship_markets(org_id, country) values ($1, $2) on conflict do nothing`, [m1.orgId, c]);
  const v = (await sql<{ id: string; model_no: string }>(`select v.id, v.model_no from dropship_variants v join dropship_products p on p.id = v.product_id
     where p.status = 'active' and p.fulfilment_type = 'extended_catalog' and p.visible_to_org_id is null
       and (get_dropship_order_quote(jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 2)), 'AE', 'standard', 'DDP', 'USD', null, 'order') ->> 'total_cents') is not null
     order by v.model_no limit 1`))[0];
  if (!v) throw new Error('no extended-catalogue product with an AE quote on staging');
  variant = v;
  await sql(`select post_journal($1, jsonb_build_array(
      jsonb_build_object('account', cash_account('USD'), 'debit', 50000::bigint, 'credit', 0),
      jsonb_build_object('account', wallet_account($2, 'USD'), 'debit', 0, 'credit', 50000::bigint, 'org', $2)), $3, 'topup', 'organization', $2)`,
  ['DS10 E2E top-up', m1.orgId, `ds10_e2e_${m1.orgId}`]);
  const a = await intake(m1.orgId, `E2E-${stamp}-1045`);
  const b = await intake(m1.orgId, `E2E-${stamp}-1040`);
  if (a.payment_state !== 'paid' || b.payment_state !== 'paid') throw new Error(`orders not paid: ${JSON.stringify([a.code, b.code])}`);
  // A: handed over (lost parcel claim possible); B: delivered yesterday (claims + returns possible)
  await sql(`update store_orders set staff_stage = 'handed_over' where id = $1`, [a.store_order_id]);
  await sql(`update store_orders set staff_stage = 'delivered', delivered_at = now() - interval '1 day' where id = $1`, [b.store_order_id]);
  orderA = { id: String(a.store_order_id), order_number: String(a.order_number), name: '#1045' };
  orderB = { id: String(b.store_order_id), order_number: String(b.order_number), name: '#1040', total: Number(b.total_cents) };
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  const sb = adminClient();
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  const orgs = [m1?.orgId].filter(Boolean) as string[];
  if (m1 && orderB) {
    const { data: files } = await sb.storage.from('ds-claims').list(`${m1.orgId}/${orderB.id}`);
    if (files?.length) await sb.storage.from('ds-claims').remove(files.map((f) => `${m1!.orgId}/${orderB!.id}/${f.name}`));
  }
  if (orgs.length) {
    // reship warehouse orders (no stock was reserved: extended catalogue), tickets, then the usual purge
    await sql(`delete from wh_order_lines where order_id in (select w.id from wh_orders w join store_orders so on so.id = w.store_order_id where so.org_id = any($1::uuid[]))`, [orgs]);
    await sql(`delete from wh_orders where store_order_id in (select id from store_orders where org_id = any($1::uuid[]))`, [orgs]);
    await sql(`delete from tickets where org_id = any($1::uuid[])`, [orgs]);
    await sql(`delete from domain_event_consumptions where event_id in (select id from domain_events where aggregate_id in (select id from store_orders where org_id = any($1::uuid[])))`, [orgs]);
    await sql(`delete from domain_events where aggregate_id in (select id from store_orders where org_id = any($1::uuid[]))`, [orgs]);
    await sql(`update store_orders set escrow_hold_id = null, wallet_hold_id = null where org_id = any($1::uuid[])`, [orgs]);
  }
  await purgeTestOrgs(orgs, [m1?.id].filter(Boolean) as string[]);
  await deleteTempStaff(staff);
});

test('Order detail @1280: items, progress, cost lines, change card, lost parcel claim', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, `/account/dropship/orders/${orderA!.id}`);
  await page.goto('/account/dropship/orders');
  const main = page.locator('main:visible');
  await main.getByTestId(`order-link-${orderA!.order_number}`).click();
  await expect(page).toHaveURL(new RegExp(`/account/dropship/orders/${orderA!.id}$`));
  // Cache Components keeps the Orders page in the DOM hidden (React <Activity>, display: none) after a client navigation,
  // so ask for the visible / accessible level-1 heading — the hidden one is not in the accessibility tree
  await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(main.getByRole('heading', { level: 1 })).toContainText(`Order ${orderA!.name}`);
  await expect(main.getByTestId('order-status')).toBeVisible();
  await expect(main.getByTestId('detail-items')).toContainText('Shipped by Octopus');
  await expect(main.getByTestId('detail-other-items')).toContainText('You or another supplier ships this');
  await expect(main.getByTestId('detail-cost')).toContainText(/Processing, 2 items/);
  await expect(main.getByTestId('detail-cost')).toContainText(/US\$\d+\.\d{2}/);
  await expect(main.getByTestId('detail-progress')).toContainText('Paid from wallet');
  await expect(main.getByTestId('req-cancel')).toBeDisabled();
  await expect(main.getByTestId('req-reasons')).toContainText('Packing has started');
  await expect(main).not.toContainText(/supplier code|factory|margin|pay later/i);
  await checkAxe(page, 'order detail @1280');
  await shot(page, 'ds10-order-detail-1280');
  await main.getByTestId('req-claim').check();
  const form = main.getByTestId('claim-form');
  await form.getByLabel('Lost (never arrived)').check();
  await form.getByLabel('A reship').check();
  await form.getByLabel('Message', { exact: true }).fill('No tracking scan for 10 days and the buyer has nothing.');
  await form.getByTestId('claim-send').click();
  await expect(main.getByTestId('detail-notice')).toContainText(/Claim DSC-\d{5} sent/);
  claimCode = ((await main.getByTestId('detail-notice').innerText()).match(/DSC-\d{5}/) ?? [''])[0];
  await expect(main.getByTestId(`case-${claimCode}`)).toContainText('Claim opened with the carrier');
  await expect(main.getByTestId(`case-status-${claimCode}`)).toHaveText(/Claim reported/);
  await checkAxe(page, 'order detail with claim @1280');
  await shot(page, 'ds10-order-claim-1280');
  // order B was delivered: "lost" is not offered; a damaged parcel needs a photo (private bucket)
  await page.goto(`/account/dropship/orders/${orderB!.id}`);
  await main.getByTestId('req-claim').check();
  const fb = main.getByTestId('claim-form');
  await expect(fb.getByLabel('Lost (never arrived)')).toBeDisabled();
  await fb.getByLabel('A refund to your wallet').check();
  await fb.getByLabel('Message', { exact: true }).fill('The box arrived crushed and the item is broken.');
  await fb.getByTestId('claim-send').click();
  await expect(fb.getByTestId('claim-error')).toContainText('add at least one photo');
  await fb.getByTestId('claim-photos').setInputFiles({ name: 'damage.png', mimeType: 'image/png', buffer: PNG });
  await fb.getByTestId('claim-send').click();
  await expect(main.getByTestId('detail-notice')).toContainText(/Claim DSC-\d{5} sent/);
  damagedCode = ((await main.getByTestId('detail-notice').innerText()).match(/DSC-\d{5}/) ?? [''])[0];
});

test('Staff: Order problems → carrier claim → reship; refund on the second order', async ({ browser }) => {
  staff = await createTempStaff('support');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const sp = await ctx.newPage();
  try {
    await staffLogin(sp, staff, '/office/dropship/problems');
    await sp.goto(`/office/dropship/problems?c=${claimCode}`);
    const main = sp.locator('main:visible');
    await expect(main.getByTestId('problems-page')).toBeVisible();
    await expect(main.getByTestId(`problem-row-${claimCode}`)).toContainText('Lost parcel');
    const detail = main.getByTestId('problem-detail');
    await expect(detail).toContainText('Merchant asked for: Reship');
    await checkAxe(sp, 'order problems @1280');
    await shot(sp, 'ds10-staff-problems-1280');
    await detail.getByLabel('Carrier claim no.', { exact: true }).fill('YT-E2E-7781');
    await detail.getByTestId('carrier-claim').click();
    await expect(main.getByTestId('problems-result')).toContainText('Carrier claim recorded');
    await expect.poll(async () => (await sql<{ r: string | null }>(`select carrier_claim_ref r from dropship_cases where code = $1`, [claimCode]))[0]?.r).toBe('YT-E2E-7781');
    await expect(main.getByTestId('problem-detail')).toContainText('YT-E2E-7781', { timeout: 15_000 });
    await main.getByTestId('problem-detail').getByLabel('Message to the merchant', { exact: true }).fill('Sorry for the trouble.');
    await main.getByTestId('reship-now').click();
    await expect(main.getByTestId('problems-result')).toContainText(/Reship created: order DSO-/);
    // the damaged-parcel claim on order B: refund to the wallet (≤ US$1,000 → no second approver)
    await sp.goto(`/office/dropship/problems?c=${damagedCode}`);
    await expect(main.getByTestId('problem-detail')).toContainText('Merchant asked for: Refund to the wallet');
    await expect(main.getByTestId('problem-detail')).toContainText('Photo 1');
    await main.getByTestId('refund-wallet').click();
    await expect(main.getByTestId('problems-result')).toContainText(/refunded to your wallet/);
  } finally {
    await ctx.close();
  }
});

test('Merchant @390: reshipped claim, return to the warehouse, Support tickets + new ticket + thread', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await customerLogin(page, m1!, `/account/dropship/orders/${orderA!.id}`);
    await page.goto(`/account/dropship/orders/${orderA!.id}`);
    const main = page.locator('main:visible');
    await expect(main.getByTestId(`case-status-${claimCode}`)).toHaveText('Reshipped');
    await expect(main.getByTestId(`case-${claimCode}`)).toContainText(/Reship: DSO-/);
    await noOverflow(page, 'order detail @390');
    await checkAxe(page, 'order detail @390');
    await shot(page, 'ds10-order-detail-390');
    // return on the delivered order
    await page.goto(`/account/dropship/orders/${orderB!.id}`);
    await main.getByTestId('req-return').check();
    const rf = main.getByTestId('return-form');
    await expect(rf.getByTestId('return-rules')).toContainText('Processing, shipping and duties are not refunded');
    await rf.getByLabel('Message', { exact: true }).fill('Buyer changed their mind and sends it back.');
    await rf.getByTestId('return-send').click();
    await expect(main.getByTestId('detail-notice')).toContainText(/Return DSC-\d{5} recorded/);
    await expect(main.locator('[data-testid^="case-status-"]').first()).toHaveText('Waiting for the parcel');
    await expect(main.getByTestId(`case-status-${damagedCode}`)).toHaveText('Refunded');
    await expect(main.getByTestId(`case-${damagedCode}`)).toContainText('refunded to your wallet');
    // Support
    await page.goto('/account/dropship/support');
    await expect(main.getByTestId('dropship-support-page')).toBeVisible();
    await expect(main.getByTestId('support-tickets-table')).toContainText(`Order ${orderA!.name}`);
    await expect(main).not.toContainText(/SLA|hours left/i);
    await main.getByLabel('Subject', { exact: true }).fill('Where is my reship?');
    await main.getByLabel('Order number (optional)', { exact: true }).fill('#9999');
    await main.getByLabel('Message', { exact: true }).fill('Please tell me when the reship leaves the warehouse.');
    await main.getByTestId('support-send').click();
    await expect(main.getByText(/Order number: no order of yours has the number #9999/)).toBeVisible();
    await main.getByLabel('Order number (optional)', { exact: true }).fill(orderA!.name);
    await main.getByTestId('support-send').click();
    await expect(main.getByTestId('support-created')).toContainText(/Ticket TKT-\d+ sent/);
    await noOverflow(page, 'support @390');
    await checkAxe(page, 'support @390');
    await shot(page, 'ds10-support-390');
    await main.getByTestId('support-created').getByRole('link', { name: 'Open the conversation' }).click();
    await expect(main.getByTestId('support-thread')).toContainText('Where is my reship?');
    await expect(main.getByTestId('support-thread')).toContainText(`Order ${orderA!.name}`);
    await main.getByLabel('Your reply', { exact: true }).fill('Thanks, one more detail: the buyer is away until Monday.');
    await main.getByTestId('thread-send').click();
    await expect(main.getByTestId('thread-messages')).toContainText('the buyer is away until Monday');
    await checkAxe(page, 'support thread @390');
  } finally {
    await ctx.close();
  }
});

test('Support @1280 + a not-found order', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/support');
  await page.goto('/account/dropship/support');
  const main = page.locator('main:visible');
  await expect(main.locator('h1')).toContainText('Support');
  await expect(main.getByTestId('support-help')).toContainText('Orders and shipping');
  const rows = await main.getByTestId('support-tickets-table').locator('tbody tr').count();
  expect(rows).toBeGreaterThanOrEqual(3);
  await checkAxe(page, 'support @1280');
  await shot(page, 'ds10-support-1280');
  await page.goto('/account/dropship/orders/00000000-0000-4000-8000-000000000000');
  await expect(main.getByTestId('order-detail-missing')).toContainText('This order was not found');
  await expect(main.locator('h1')).toContainText('Order detail');
  await expect(page.getByText(usd(orderB!.total))).toHaveCount(0);
});
