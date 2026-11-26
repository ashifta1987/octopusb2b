import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Release 3 · Step 8 (paying for orders) + Step 7 intake E2E (STAGING ONLY) — Match: screens/Orders.html, screens/Wallet.html,
 * states/States-Orders.html, states/States-Money.html, mobile/M_Orders.html, mobile/M_Wallet.html. Desktop 1280 px and phone
 * 390 px, axe clean.
 * Orders arrive through the source-agnostic intake (ds_order_intake, what the store webhook will call) — no Shopify needed.
 * An extended-catalogue product is used so paid orders create no stock movements (the stock ledger is append-only) and the
 * test organisations can be purged afterwards.
 *  1. Orders @1280: wallet bar (Available + Low, Held, Add funds), chips To pay (1) / Issues (3), Payment column, "+1 item not
 *     from Octopus", "Awaiting payment · N days left", waiting-for-payment state.
 *  2. High risk: Review → panel → Cancel order (dialog) → "Nothing was charged".
 *  3. Address problem: Fix address → Save and resubmit → back to To pay.
 *  4. Funds arrive → Pay one order, then bulk Charge and ship.
 *  5. Wallet @1280: Available, Held for protected orders, How new orders are paid (save Payment protection), no Pay later.
 *  6. Phone 390 px: Orders + Wallet, phone tabs, no sideways overflow, axe.
 *  7. Empty state; paused merchant (note + charges disabled); Orders switched off → redirect to the dashboard.
 *  8. Staff test order (staging only) in a separate browser context → the merchant sees it.
 */
test.describe.configure({ mode: 'serial' });

const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let m1: TempCustomer | null = null;
let m2: TempCustomer | null = null;
let staff: TempStaff | null = null;
let variant: { id: string; model_no: string } | null = null;
let total = 0;
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];
const stamp = Date.now().toString(36);
const SHOTS = process.env.DS8_SHOTS;
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
async function fund(orgId: string, cents: number, tag: string) {
  await sql(`select post_journal($1, jsonb_build_array(
      jsonb_build_object('account', cash_account('USD'), 'debit', $2::bigint, 'credit', 0),
      jsonb_build_object('account', wallet_account($3, 'USD'), 'debit', 0, 'credit', $2::bigint, 'org', $3)), $4, 'topup', 'organization', $3)`,
  [`DS8 E2E top-up ${tag}`, cents, orgId, `ds8_e2e_${tag}_${orgId}`]);
}
/** what the store webhook will call (service role; the owner connection has no JWT claims = system) */
async function intake(orgId: string, ext: string, over: Record<string, unknown> = {}) {
  const order = {
    external_order_id: ext, external_order_name: `#${ext.slice(-4)}`, buyer_name: 'Omar Saleh',
    address: { name: 'Omar Saleh', line1: '12 Marina Walk', city: 'Dubai', country: 'AE' }, risk: 'low',
    lines: [{ variant_id: variant!.id, qty: 1, buyer_unit_price_cents: 3999 }], ...over,
  };
  return (await sql<{ r: Record<string, unknown> }>(`select ds_order_intake($1, 'shopify', $2::jsonb) r`, [orgId, JSON.stringify(order)]))[0].r;
}
async function setupMerchant(m: TempCustomer) {
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [m.orgId]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = coalesce(company_services.started_at, now())`, [m.orgId]);
  for (const c of ['AE', 'US']) await sql(`insert into dropship_markets(org_id, country) values ($1, $2) on conflict do nothing`, [m.orgId, c]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  m1 = await createTempCustomer('ds8a');
  m2 = await createTempCustomer('ds8b');
  const sb = adminClient();
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'DS8 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await setupMerchant(m1);
  await setupMerchant(m2);
  const v = (await sql<{ id: string; model_no: string }>(`select v.id, v.model_no from dropship_variants v join dropship_products p on p.id = v.product_id
     where p.status = 'active' and p.fulfilment_type = 'extended_catalog' and p.visible_to_org_id is null
       and (get_dropship_order_quote(jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1)), 'AE', 'standard', 'DDP', 'USD', null, 'order') ->> 'total_cents') is not null
     order by v.model_no limit 1`))[0];
  if (!v) throw new Error('no extended-catalogue product with an AE quote on staging');
  variant = v;
  // the same line intake sends (buyer paid US$39.99): with DDP, duties are on the buyer's paid price (customs value policy),
  // so the locked order total is NOT the catalogue quote without a buyer price
  total = Number((await sql<{ t: string }>(`select get_dropship_order_quote(jsonb_build_array(jsonb_build_object('variant_id', $1::uuid, 'qty', 1, 'buyer_unit_price_cents', 3999)), 'AE', 'standard', 'DDP', 'USD', null, 'order') ->> 'total_cents' t`, [v.id]))[0].t);
  // wallet covers exactly one order; then: one paid (+1 item not from Octopus), one high risk, one address problem, one waiting
  await fund(m1.orgId, total + 509, 'start');
  const paid = await intake(m1.orgId, `E2E-${stamp}-1046`, { other_items: 1 });
  if (paid.payment_state !== 'paid') throw new Error(`first order not paid: ${JSON.stringify(paid)}`);
  if (Number(paid.total_cents) !== total) throw new Error(`locked order total ${paid.total_cents} ≠ expected ${total}`);
  await intake(m1.orgId, `E2E-${stamp}-1042`, { risk: 'high' });
  await intake(m1.orgId, `E2E-${stamp}-1041`, { address: { name: 'Lina H', city: 'Dubai', country: 'AE' } });
  await intake(m1.orgId, `E2E-${stamp}-1043`);
});

test.afterAll(async () => {
  const sb = adminClient();
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  const orgs = [m1?.orgId, m2?.orgId].filter(Boolean) as string[];
  if (orgs.length) {
    // handoffs / events of these orders first (handoffs cascade; domain events have no FK)
    await sql(`delete from domain_event_consumptions where event_id in (select id from domain_events where aggregate_id in (select id from store_orders where org_id = any($1::uuid[])))`, [orgs]);
    await sql(`delete from domain_events where aggregate_id in (select id from store_orders where org_id = any($1::uuid[]))`, [orgs]);
    await sql(`update store_orders set escrow_hold_id = null, wallet_hold_id = null where org_id = any($1::uuid[])`, [orgs]);
    // protected orders: the hold points at its journal (purgeTestOrgs deletes journals before holds)
    await sql(`update escrow_holds set hold_journal_id = null where org_id = any($1::uuid[])`, [orgs]);
  }
  await purgeTestOrgs(orgs, [m1?.id, m2?.id].filter(Boolean) as string[]);
  await deleteTempStaff(staff);
});

test('Orders @1280: wallet bar, chips, payment column, mixed cart, awaiting payment', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/orders');
  await page.goto('/account/dropship/orders');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('dropship-orders-page')).toBeVisible();
  await expect(main.locator('h1')).toContainText('Orders');
  await expect(main.getByTestId('wallet-available')).toHaveText(usd(509));
  await expect(main.getByTestId('wallet-low')).toHaveText(/Low/);
  await expect(main.getByTestId('wallet-held')).toHaveText(usd(0));
  await expect(main.getByTestId('orders-add-funds')).toHaveAttribute('href', '/account/dropship/wallet#add-funds');
  await expect(main.getByTestId('chip-to_pay')).toHaveText('To pay (1)');
  await expect(main.getByTestId('chip-issues')).toHaveText('Issues (3)');
  await expect(main.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'true');
  const paidRow = main.locator('tr', { hasText: '#1046' });
  await expect(paidRow).toContainText('+1 item not from Octopus');
  await expect(paidRow).toContainText('Wallet · paid');
  await expect(paidRow).toContainText('Processing');
  await expect(paidRow).toContainText('Omar S. · AE');
  await expect(main.locator('tr', { hasText: '#1042' })).toContainText('On hold: high risk');
  await expect(main.locator('tr', { hasText: '#1042' })).toContainText('Not charged yet');
  await expect(main.locator('tr', { hasText: '#1041' })).toContainText('On hold: address');
  const waiting = main.locator('tr', { hasText: '#1043' });
  await expect(waiting).toContainText(/Awaiting payment · [0-9]+ days? left/);
  await expect(waiting.getByRole('button', { name: `Pay ${usd(total)}` })).toBeVisible();
  await expect(main.getByTestId('state-waiting')).toContainText(`Order #1043 needs ${usd(total)}`);
  await expect(main).not.toContainText(/supplier|factory|pay later/i);
  await checkAxe(page, 'orders @1280');
  await shot(page, 'ds8-orders-1280');
});

test('High risk: Review → Cancel order → nothing was charged', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/orders');
  await page.goto('/account/dropship/orders');
  const main = page.locator('main:visible');
  await main.getByTestId('chip-issues').click();
  await main.locator('tr', { hasText: '#1042' }).getByRole('button', { name: 'Review' }).click();
  const panel = main.getByTestId('review-panel');
  await expect(panel).toContainText('Order #1042 is on hold: high risk');
  await expect(panel.getByRole('button', { name: `Charge ${usd(total)} and ship` })).toBeVisible();
  await checkAxe(page, 'high-risk review @1280');
  await panel.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByTestId('cancel-dialog');
  await expect(dialog).toContainText('Nothing was charged');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(main.getByTestId('orders-notice')).toContainText('Nothing was charged');
  await main.getByTestId('chip-all').click();
  await expect(main.locator('tr', { hasText: '#1042' })).toContainText('Cancelled');
});

test('Address problem: Fix address → Save and resubmit → back to To pay', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/orders');
  await page.goto('/account/dropship/orders');
  const main = page.locator('main:visible');
  await main.getByTestId('chip-issues').click();
  await main.locator('tr', { hasText: '#1041' }).getByRole('button', { name: 'Fix address' }).click();
  const dlg = page.getByTestId('fix-address-dialog');
  await expect(dlg).toContainText('Street address is missing');
  await dlg.getByLabel('Street address', { exact: true }).fill('5 Palm Street');
  await checkAxe(page, 'fix address dialog @1280');
  await dlg.getByRole('button', { name: 'Save and resubmit' }).click();
  await expect(main.getByTestId('orders-notice')).toContainText('Address saved and resubmitted');
  await expect(main.getByTestId('chip-to_pay')).toHaveText('To pay (2)');
});

test('Funds arrive → Pay one order, then bulk Charge and ship', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await fund(m1!.orgId, total * 2, 'more');
  await customerLogin(page, m1!, '/account/dropship/orders');
  await page.goto('/account/dropship/orders');
  const main = page.locator('main:visible');
  await main.getByTestId('chip-to_pay').click();
  await main.locator('tr', { hasText: '#1043' }).getByRole('button', { name: `Pay ${usd(total)}` }).click();
  const notice = main.getByTestId('orders-notice');
  await expect(notice).toContainText('paid and sent to the warehouse');
  const first = await notice.innerText();
  await expect(main.getByTestId('chip-to_pay')).toHaveText('To pay (1)');
  await main.getByRole('checkbox', { name: 'Select order #1041' }).check();
  await main.getByTestId('bulk-charge').click();
  await expect(notice).not.toHaveText(first);
  await expect(notice).toContainText('paid and sent to the warehouse');
  await main.getByTestId('chip-all').click();
  await expect(main.locator('tr', { hasText: '#1043' })).toContainText('Wallet · paid');
  await expect(main.locator('tr', { hasText: '#1041' })).toContainText('Wallet · paid');
  const inv = await sql<{ n: string }>(`select count(*) n from documents where org_id = $1 and doc_type = 'commercial_invoice' and number like 'OCT-DS-%'`, [m1!.orgId]);
  expect(Number(inv[0].n)).toBe(3);
  await shot(page, 'ds8-orders-paid-1280');
});

test('Wallet @1280: balances, how new orders are paid (save protection), no pay later', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/wallet');
  await page.goto('/account/dropship/wallet');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('wallet-balance')).toBeVisible();
  await expect(main.getByTestId('ds-available')).toContainText('Available');
  await expect(main.getByTestId('ds-held')).toContainText('Held for protected orders');
  const pm = main.getByTestId('ds-payment-mode');
  await expect(pm).toContainText('How new orders are paid');
  await expect(pm.getByRole('radio', { name: /Wallet, automatically/ })).toBeChecked();
  await expect(main).not.toContainText(/pay later/i);
  await expect(main.getByTestId('ds-online-soon')).toContainText('Online payment: available soon');
  await expect(main.getByTestId('ds-save-payment')).toBeDisabled();
  await pm.getByRole('radio', { name: /Payment protection/ }).check();
  await main.getByTestId('ds-save-payment').click();
  await expect(main.getByTestId('ds-payment-notice')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('main:visible').getByTestId('ds-payment-mode').getByRole('radio', { name: /Payment protection/ })).toBeChecked();
  await checkAxe(page, 'wallet @1280');
  await shot(page, 'ds8-wallet-1280');
  // a protected order now: Held shows it
  await fund(m1!.orgId, total, 'prot');
  const prot = await intake(m1!.orgId, `E2E-${stamp}-1044`);
  expect(prot.payment_state).toBe('held');
  await page.reload();
  await expect(page.locator('main:visible').getByTestId('ds-held')).toContainText(usd(total));
  await expect(page.locator('main:visible').getByTestId('ds-held')).toContainText('released 7 days after delivery');
});

test('Phone 390 px: Orders + Wallet, phone tabs, no sideways overflow, axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await customerLogin(page, m1!, '/account/dropship/orders');
  for (const [path, testId, name] of [['/account/dropship/orders', 'dropship-orders-page', 'm-orders'], ['/account/dropship/wallet', 'ds-wallet-page', 'm-wallet']] as const) {
    await page.goto(path);
    const main = page.locator('main:visible');
    await expect(main.getByTestId(testId)).toBeVisible();
    await expect(page.getByTestId('dropship-phone-tabs')).toBeVisible();
    await noOverflow(page, `${name} @390`);
    await checkAxe(page, `${name} @390`);
    await shot(page, `ds8-${name}-390`);
  }
  await expect(page.locator('main:visible')).not.toContainText(/pay later/i);
});

test('Empty state; paused merchant; Orders switched off', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m2!, '/account/dropship/orders');
  await page.goto('/account/dropship/orders');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('orders-empty')).toContainText('No orders yet');
  await expect(main.getByTestId('orders-empty').getByRole('link', { name: 'Connect a store' })).toBeVisible();
  await checkAxe(page, 'orders empty @1280');
  await shot(page, 'ds8-orders-empty-1280');
  // paused: history stays, new charges can't start
  await intake(m2!.orgId, `E2E-${stamp}-2001`);
  await sql(`update company_services set status = 'paused', status_reason = 'E2E pause' where org_id = $1 and service = 'dropship'`, [m2!.orgId]);
  await page.goto('/account/dropship/orders');
  await expect(page.locator('main:visible').getByTestId('orders-paused-fulfilment-note')).toBeVisible();
  await expect(page.locator('main:visible').locator('tr', { hasText: '#2001' }).getByRole('button', { name: /^Pay / })).toBeDisabled();
  await sql(`update company_services set status = 'on', status_reason = null where org_id = $1 and service = 'dropship'`, [m2!.orgId]);
  // Orders off (live early access): the route goes back to the dashboard
  await adminClient().from('site_settings').upsert({ key: 'dropship_features', value: { ...ALL_ON, orders: false }, is_public: true });
  await page.goto('/account/dropship/orders');
  await expect(page).toHaveURL(/\/account\/dropship$/);
  await adminClient().from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
});

test('Staff test order (staging only) → the merchant sees it', async ({ browser }) => {
  staff = await createTempStaff('admin');
  const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const sp = await staffCtx.newPage();
  try {
    await staffLogin(sp, staff, '/office/dropship/test-order');
    await sp.goto('/office/dropship/test-order');
    const main = sp.locator('main:visible');
    await expect(main.getByTestId('ds-test-order')).toBeVisible();
    await main.getByLabel('Merchant', { exact: true }).selectOption(m2!.orgId);
    await main.getByLabel('Store order number (optional)', { exact: true }).fill(`E2E-${stamp}-2002`);
    await main.getByLabel('DS variant model no.', { exact: true }).fill(variant!.model_no);
    await main.getByLabel('Items not from Octopus', { exact: true }).fill('2');
    await main.getByTestId('test-order-submit').click();
    await expect(main.getByTestId('test-order-result')).toContainText('Created');
    const first = await main.getByTestId('test-order-result').innerText();
    await main.getByTestId('test-order-submit').click();
    await expect(main.getByTestId('test-order-result')).not.toHaveText(first);
    await expect(main.getByTestId('test-order-result')).toContainText('duplicate ignored');
    await checkAxe(sp, 'staff test order @1280');
  } finally {
    await staffCtx.close();
  }
  const merchantCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const mp = await merchantCtx.newPage();
  try {
    await customerLogin(mp, m2!, '/account/dropship/orders');
    await mp.goto('/account/dropship/orders');
    const main = mp.locator('main:visible');
    await main.getByTestId('chip-all').click();
    // the staff form sends the store order number as the external id (no display name), so find the row by our order number
    const no = (await sql<{ order_number: string }>(`select order_number from store_orders where org_id = $1 and external_order_id = $2`, [m2!.orgId, `E2E-${stamp}-2002`]))[0]?.order_number;
    expect(no, 'the staff test order exists').toBeTruthy();
    const row = main.getByTestId(`merchant-order-row-${no}`);
    await expect(row).toContainText('Test order');
    await expect(row).toContainText('+2 items not from Octopus');
  } finally {
    await merchantCtx.close();
  }
});
