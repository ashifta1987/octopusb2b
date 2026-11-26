import { test, expect, type Page, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Release 5 · Steps 12, 12b, 13 E2E (STAGING ONLY) — Match: screens/Billing.html, Dashboard.html, Reports.html, Settings.html,
 * staff/FinanceSaaS.html, staff/StaffHealth.html, mobile/M_Billing, M_Dashboard, M_Reports, M_Settings, M_More, states/States-Money
 * (plan states) and States-Staff (waiting for a second approver, event failed). Desktop 1280 px and phone 390 px, axe clean.
 * Plan fees stay OFF on staging (owner decision D1): the Finance test proposes, checks the two-person rule in two browser
 * contexts, and REJECTS / WITHDRAWS — it never switches fees on. Orders for Reports are seeded with SQL (charged, refunded,
 * unknown store price) on a temporary merchant that is purged afterwards.
 *  1. Plan and billing @1280: "Plans are free for now", no plans yet (prices unset), usage, invoices table / empty text.
 *  2. Dashboard @1280: real KPIs from the seeded orders, needs attention, recent orders, wallet, sync health, plan usage.
 *  3. Reports @1280: KPIs (sales at the locked FX, refund rate, delivery days), costs split, top products, CSV, country filter.
 *  4. Settings @1280: white-label check on buyer text, save, notifications, invite + cancel, data export links.
 *  5. Phone 390 px: Dashboard, Billing, Reports, Settings, More — no sideways overflow, axe.
 *  6. Close dropshipping (second merchant): typed confirmation → closed, history and export stay.
 *  7. Billing / Reports switched off (live early access) → redirect to the dashboard.
 *  8. Staff health @1280 + 390 (admin): tiles, failed event with a plain reason → Retry.
 *  9. Finance › SaaS billing @1280 + 390: Finance 1 proposes, Finance 2 (own context) sees Approve; Finance 1 can't approve;
 *     Finance 2 rejects with a note; Finance 1 proposes and withdraws; plan proposal rejected. Fees stay off.
 */
test.describe.configure({ mode: 'serial' });

const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let m1: TempCustomer | null = null;
let m2: TempCustomer | null = null;
let fin1: TempStaff | null = null;
let fin2: TempStaff | null = null;
let admin: TempStaff | null = null;
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];
let deadEvent: string | null = null;
const stamp = Date.now().toString(36);
const SHOTS = process.env.DS12_SHOTS;

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
async function setupMerchant(m: TempCustomer) {
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [m.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [m.orgId, m.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = coalesce(company_services.started_at, now())`, [m.orgId]);
  for (const c of ['AE', 'US']) await sql(`insert into dropship_markets(org_id, country) values ($1, $2) on conflict do nothing`, [m.orgId, c]);
}
/** a charged store order straight in the tables (what intake + charge leave behind), for report numbers */
async function seedOrder(orgId: string, o: { n: number; cur: string; fx: number | null; inc: 'DDP' | 'DAP'; prod: number; ship: number; duty: number | null; total: number;
  paid: boolean; qty: number; buyer: number | null; refunded?: number; delivered?: boolean; cancelled?: boolean }, v: { product_id: string; variant_id: string; item_id: string; model_no: string }) {
  const so = (await sql<{ id: string }>(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency,
      fx_rate_to_usd, shipping_method, incoterm, product_cents, processing_cents, shipping_cents, duties_cents, total_cents, payment_state, staff_stage, created_at, delivered_at, cancelled_at, is_test)
    values ($1, 'csv', $2, $3, 'Omar Saleh', '{"city":"Dubai","country":"AE"}'::jsonb, 'AE', $4, $5, 'standard', $6, $7, 120, $8, $9, $10, $11, $12, now() - interval '3 days',
      case when $13 then now() + interval '3 days' end, case when $14 then now() end, true) returning id`,
    [orgId, `E2E-${stamp}-${o.n}`, `#${o.n}`, o.cur, o.fx, o.inc, o.prod, o.ship, o.duty, o.total, o.paid ? 'paid' : 'unpaid', o.paid ? 'packing' : 'unpaid', Boolean(o.delivered), Boolean(o.cancelled)]))[0].id;
  await sql(`insert into store_order_items (store_order_id, product_id, variant_id, item_id, model_no, title_snapshot, fulfilment_type, qty, unit_product_cents, line_product_cents, buyer_unit_price_cents, declared_usd_cents)
    values ($1, $2, $3, $4, $5, 'E2E report product', 'fast_ship', $6, $7, $8, $9, 0)`, [so, v.product_id, v.variant_id, v.item_id, v.model_no, o.qty, o.prod / o.qty, o.prod, o.buyer]);
  await sql(`insert into dropship_order_intake (store_order_id, org_id, channel, charged_cents, charged_at, refunded_cents, payment_option)
    values ($1, $2, 'csv', $3, case when $3::bigint is null then null else now() - interval '3 days' end, $4, case when $3::bigint is null then null else 'wallet' end)`,
    [so, orgId, o.paid ? o.total : null, o.refunded ?? 0]);
}
async function staffPage(browser: Browser, s: TempStaff, path: string, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  const p = await ctx.newPage();
  await staffLogin(p, s, path);
  await p.goto(path);
  return { ctx, p };
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const settings = (await sql<{ enabled: boolean; pending_enabled: boolean | null }>(`select enabled, pending_enabled from saas_billing_settings where id = 1`))[0];
  if (settings.enabled || settings.pending_enabled !== null) throw new Error('DS12 e2e expects plan fees OFF with nothing pending on staging (owner decision D1)');
  m1 = await createTempCustomer('ds12a');
  m2 = await createTempCustomer('ds12b');
  const sb = adminClient();
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'DS12 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await setupMerchant(m1);
  await setupMerchant(m2);
  const vs = await sql<{ product_id: string; variant_id: string; item_id: string; model_no: string }>(`select p.id product_id, v.id variant_id, v.item_id, v.model_no
     from dropship_variants v join dropship_products p on p.id = v.product_id where p.status = 'active' order by v.model_no limit 2`);
  if (vs.length < 2) throw new Error('need two active Dropship variants on staging');
  await seedOrder(m1.orgId, { n: 1001, cur: 'USD', fx: null, inc: 'DDP', prod: 1000, ship: 500, duty: 200, total: 1820, paid: true, qty: 2, buyer: 3999, delivered: true }, vs[0]);
  await seedOrder(m1.orgId, { n: 1002, cur: 'AED', fx: 0.2723, inc: 'DAP', prod: 800, ship: 400, duty: null, total: 1320, paid: true, qty: 1, buyer: 10000, refunded: 1320, cancelled: true }, vs[1]);
  await seedOrder(m1.orgId, { n: 1003, cur: 'USD', fx: null, inc: 'DDP', prod: 500, ship: 300, duty: 100, total: 1020, paid: true, qty: 1, buyer: null }, vs[1]);
  await seedOrder(m1.orgId, { n: 1004, cur: 'USD', fx: null, inc: 'DDP', prod: 500, ship: 300, duty: 100, total: 1020, paid: false, qty: 1, buyer: 2500 }, vs[1]);
});

test.afterAll(async () => {
  const sb = adminClient();
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  if (deadEvent) {
    await sql(`delete from domain_event_consumptions where event_id = $1`, [deadEvent]);
    await sql(`delete from domain_events where id = $1`, [deadEvent]);
  }
  const orgs = [m1?.orgId, m2?.orgId].filter(Boolean) as string[];
  await purgeTestOrgs(orgs, [m1?.id, m2?.id].filter(Boolean) as string[]);
  await deleteTempStaff(fin1);
  await deleteTempStaff(fin2);
  await deleteTempStaff(admin);
});

test('Plan and billing @1280: plans free for now, no plans yet, usage, invoices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/billing');
  await page.goto('/account/dropship/billing');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('ds-billing-page')).toBeVisible();
  await expect(main.locator('h1')).toContainText('Plan and billing');
  await expect(main.getByTestId('billing-plan-notice')).toContainText('Plans are free for now');
  await expect(main.getByTestId('billing-plan-notice')).toContainText('30 days free');
  const plans = await sql<{ n: string }>(`select count(*) n from dropship_plans where active`);
  if (Number(plans[0].n) === 0) await expect(main.getByTestId('billing-no-plans')).toContainText('No plans to choose yet');
  else await expect(main.getByTestId('billing-plans').getByRole('button').first()).toBeDisabled();
  await expect(main.getByTestId('usage-products')).toContainText('0 of no limit');
  await expect(main.getByTestId('billing-documents')).toContainText('Octopus invoices and statements');
  await expect(main).not.toContainText(/\$49|\$149|\$299|\[N\]|\[LIMIT\]/);
  await checkAxe(page, 'billing @1280');
  await shot(page, 'ds12-billing-1280');
});

test('Dashboard @1280: real counts, needs attention, recent orders, wallet, sync, plan usage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship');
  await page.goto('/account/dropship');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('ds-dashboard')).toBeVisible();
  await expect(main.getByTestId('dropship-active-start')).toBeVisible();
  await expect(main.getByTestId('dash-orders-value')).toHaveText('3');
  await expect(main.getByTestId('dash-sales-value')).toHaveText('US$80');
  await expect(main.getByTestId('dash-costs-value')).toHaveText('US$28');
  await expect(main.getByTestId('dashboard-attention')).toBeVisible();
  await expect(main.getByTestId('dashboard-recent').locator('tbody tr')).toHaveCount(4);
  await expect(main.getByTestId('dashboard-sync')).toContainText('No store connected');
  await expect(main.getByTestId('dashboard-plan')).toContainText('Free while plan fees are off');
  await checkAxe(page, 'dashboard @1280');
  await shot(page, 'ds12-dashboard-1280');
});

test('Reports @1280: KPIs, costs, top products, CSV, country filter', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/reports');
  await page.goto('/account/dropship/reports');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('ds-reports-page')).toBeVisible();
  await expect(main.getByTestId('kpi-orders-value')).toHaveText('3');
  await expect(main.getByTestId('kpi-sales-value')).toHaveText('US$80');
  await expect(main.getByTestId('kpi-refunds-value')).toHaveText('33.3%');
  await expect(main.getByTestId('kpi-delivery-value')).toHaveText('6.0 days');
  await expect(main.getByTestId('reports-unknown-sales')).toContainText('1 order without a store price');
  await expect(main.getByTestId('cost-processing')).toHaveText('US$2.40');
  await expect(main.getByTestId('cost-total')).toHaveText('US$28.40');
  await expect(main.getByTestId('reports-top')).toContainText('E2E report product');
  await expect(main.getByTestId('reports-weeks')).toBeVisible();
  const href = await main.getByTestId('reports-csv').getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(4);
  expect(csv).toContain('"0.2723"');
  await checkAxe(page, 'reports @1280');
  await shot(page, 'ds12-reports-1280');
  await page.goto('/account/dropship/reports?period=30d&country=SA');
  await expect(page.locator('main:visible').getByTestId('reports-empty')).toContainText('No orders in this period');
});

test('Settings @1280: white-label check, save, notifications, invite, data export', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m1!, '/account/dropship/settings');
  await page.goto('/account/dropship/settings');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('dropship-settings-page')).toBeVisible();
  await expect(main.getByTestId('dropship-data-export-link')).toHaveAttribute('href', '/account/dropship/export');
  await main.getByLabel('Returns policy (tracking page and packing slip)', { exact: true }).fill('Shipped by Octopus');
  await main.getByTestId('settings-save').click();
  await expect(main.getByTestId('settings-notice-top')).toContainText('Octopus');
  await main.getByLabel('Returns policy (tracking page and packing slip)', { exact: true }).fill('Contact us within 14 days of delivery.');
  await main.getByLabel('Support email shown to buyers', { exact: true }).fill('help@e2e-store.example');
  await main.getByTestId('settings-save').click();
  await expect(main.getByTestId('settings-notice-top')).toContainText('Settings saved');
  const saved = await sql<{ returns_policy: string }>(`select returns_policy from dropship_merchant_settings where org_id = $1`, [m1!.orgId]);
  expect(saved[0]?.returns_policy).toBe('Contact us within 14 days of delivery.');
  await main.getByLabel('In the app: New order', { exact: true }).uncheck();
  await main.getByTestId('prefs-save').click();
  await expect(main.getByTestId('settings-notice-notifications')).toContainText('Notification choices saved');
  const email = `e2e.ds12.invite+${stamp}@demo.octopusb2b.com`;
  await main.getByLabel('Email', { exact: true }).fill(email);
  await main.getByTestId('invite-submit').click();
  await expect(main.getByTestId(`invite-${email}`)).toBeVisible();
  await main.getByTestId(`invite-${email}`).getByRole('button', { name: /Cancel/ }).click();
  await expect(main.getByTestId(`invite-${email}`)).toHaveCount(0);
  const exp = await page.request.get('/account/dropship/export/csv?kind=orders');
  expect(exp.status()).toBe(200);
  expect(await exp.text()).toContain('#1001');
  await checkAxe(page, 'settings @1280');
  await shot(page, 'ds12-settings-1280');
});

test('Phone 390 px: Dashboard, Billing, Reports, Settings, More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await customerLogin(page, m1!, '/account/dropship');
  for (const [path, testId, name] of [['/account/dropship', 'ds-dashboard', 'm-dashboard'], ['/account/dropship/billing', 'ds-billing-page', 'm-billing'],
    ['/account/dropship/reports', 'ds-reports-page', 'm-reports'], ['/account/dropship/settings', 'dropship-settings-page', 'm-settings'], ['/account/dropship/more', 'dropship-more-page', 'm-more']] as const) {
    await page.goto(path);
    const main = page.locator('main:visible');
    await expect(main.getByTestId(testId)).toBeVisible();
    await expect(page.getByTestId('dropship-phone-tabs')).toBeVisible();
    await noOverflow(page, `${name} @390`);
    await checkAxe(page, `${name} @390`);
    await shot(page, `ds12-${name}-390`);
  }
  const more = page.locator('main:visible').getByTestId('dropship-more-page');
  for (const label of ['Reports', 'Plan and billing', 'Settings']) await expect(more.getByRole('link', { name: label, exact: true })).toBeVisible();
});

test('Close dropshipping: typed confirmation, history and export stay', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, m2!, '/account/dropship/settings');
  await page.goto('/account/dropship/settings');
  const main = page.locator('main:visible');
  await main.getByTestId('close-open').click();
  await expect(main.getByTestId('close-confirm-submit')).toBeDisabled();
  await main.getByLabel('Type CLOSE to confirm', { exact: true }).fill('CLOSE');
  await main.getByTestId('close-confirm-submit').click();
  await expect(main.getByTestId('settings-notice-close')).toContainText('Dropshipping closed');
  const cs = await sql<{ status: string }>(`select status from company_services where org_id = $1 and service = 'dropship'`, [m2!.orgId]);
  expect(cs[0].status).toBe('off');
  await page.goto('/account/dropship');
  await expect(page.locator('main:visible').getByTestId('dropship-paused-banner')).toContainText('closed');
  const exp = await page.request.get('/account/dropship/export');
  expect(exp.status()).toBe(200);
  await page.goto('/account/dropship/settings');
  await expect(page.locator('main:visible').getByTestId('settings-closed')).toBeVisible();
  await checkAxe(page, 'settings closed @1280');
});

test('Billing and Reports switched off (live early access) → dashboard', async ({ page }) => {
  await adminClient().from('site_settings').upsert({ key: 'dropship_features', value: { ...ALL_ON, billing: false, reports: false }, is_public: true });
  try {
    await customerLogin(page, m1!, '/account/dropship');
    for (const path of ['/account/dropship/billing', '/account/dropship/reports']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/account\/dropship$/);
    }
  } finally {
    await adminClient().from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  }
});

test('Staff health @1280 + 390: tiles, failed event with a plain reason → Retry', async ({ browser }) => {
  admin = await createTempStaff('admin');
  deadEvent = (await sql<{ id: string }>(`insert into domain_events (event_type, aggregate_type, aggregate_id, idempotency_key, db_status, attempts, last_error)
     values ('e2e.ds12', 'store_order', gen_random_uuid(), $1, 'dead', 5, 'E2E: warehouse did not answer') returning id`, [`e2e-ds12-${stamp}`]))[0].id;
  const { ctx, p } = await staffPage(browser, admin, '/office/dropship/health');
  try {
    const main = p.locator('main:visible');
    await expect(main.getByTestId('ds-health-page')).toBeVisible();
    await expect(main.locator('h1')).toContainText('System health');
    await expect(main.getByTestId('tile-shopify')).toContainText('Not connected');
    await expect(main.getByTestId(`failed-${deadEvent}`)).toContainText('E2E: warehouse did not answer');
    await expect(main.getByTestId('health-jobs')).toContainText('dropship billing');
    await checkAxe(p, 'health @1280');
    await shot(p, 'ds12-health-1280');
    await main.getByTestId(`retry-${deadEvent}`).click();
    await expect(main.getByTestId('health-notice')).toContainText('Queued again');
    const ev = await sql<{ attempts: number; idempotency_key: string }>(`select attempts, idempotency_key from domain_events where id = $1`, [deadEvent]);
    expect(ev[0].idempotency_key).toBe(`e2e-ds12-${stamp}`); // same job, same idempotency key (the processor may already have picked it up)
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto('/office/dropship/health');
    await expect(p.locator('main:visible').getByTestId('ds-health-page')).toBeVisible();
    await checkAxe(p, 'health @390');
    await shot(p, 'ds12-health-390');
  } finally {
    await ctx.close();
  }
});

test('Finance › SaaS billing: two-person switch (reject / withdraw), plan proposal, fees stay off', async ({ browser }) => {
  fin1 = await createTempStaff('finance');
  fin2 = await createTempStaff('finance');
  const a = await staffPage(browser, fin1, '/admin/finance/saas');
  try {
    const main = a.p.locator('main:visible');
    await expect(main.locator('h1')).toContainText('SaaS billing');
    await expect(main.getByTestId('saas-state')).toHaveText('Off');
    await expect(main.getByTestId('saas-trial-days')).toHaveText('30 days');
    await checkAxe(a.p, 'finance saas @1280');
    await shot(a.p, 'ds12-finance-saas-1280');
    await main.getByLabel('Reason', { exact: true }).first().fill('E2E proposal, will be rejected');
    await main.getByTestId('saas-propose').click();
    await expect(main.getByTestId('saas-pending')).toContainText('Waiting for approval: switch on');
    await expect(main.getByTestId('saas-approve')).toBeDisabled();
  } finally {
    await a.ctx.close();
  }
  const b = await staffPage(browser, fin2, '/admin/finance/saas');
  try {
    const main = b.p.locator('main:visible');
    await expect(main.getByTestId('saas-pending')).toBeVisible();
    await expect(main.getByTestId('saas-approve')).toBeEnabled();
    await expect(main.getByTestId('saas-reject')).toBeDisabled();
    await main.getByLabel('Note (needed to reject)', { exact: true }).fill('E2E: not now');
    await main.getByTestId('saas-reject').click();
    await expect(main.getByTestId('saas-note-switch')).toContainText('Change rejected');
    await expect(main.getByTestId('saas-pending')).toHaveCount(0);
    await expect(main.getByTestId('saas-state')).toHaveText('Off');
  } finally {
    await b.ctx.close();
  }
  const c = await staffPage(browser, fin1, '/admin/finance/saas');
  try {
    const main = c.p.locator('main:visible');
    await main.getByLabel('Reason', { exact: true }).first().fill('E2E proposal, will be withdrawn');
    await main.getByTestId('saas-propose').click();
    await expect(main.getByTestId('saas-pending')).toBeVisible();
    await main.getByTestId('saas-withdraw').click();
    await expect(main.getByTestId('saas-note-switch')).toContainText('Proposal withdrawn');
    await expect(main.getByTestId('saas-pending')).toHaveCount(0);
    // plan proposal (no price, not offered) → the second person rejects it below
    await main.getByLabel('Plan code', { exact: true }).fill(`e2e_${stamp}`);
    await main.getByLabel('Plan name', { exact: true }).fill('E2E plan');
    await main.getByLabel('Reason', { exact: true }).last().fill('E2E plan proposal');
    await main.getByTestId('plan-propose').click();
    await expect(main.getByTestId(`plan-change-e2e_${stamp}`)).toBeVisible();
    await expect(main.getByTestId(`plan-approve-e2e_${stamp}`)).toBeDisabled();
    await c.p.setViewportSize({ width: 390, height: 844 });
    await c.p.goto('/admin/finance/saas');
    await expect(c.p.locator('main:visible').getByTestId('finance-saas-page')).toBeVisible();
    await checkAxe(c.p, 'finance saas @390');
    await shot(c.p, 'ds12-finance-saas-390');
  } finally {
    await c.ctx.close();
  }
  const d = await staffPage(browser, fin2, '/admin/finance/saas');
  try {
    const main = d.p.locator('main:visible');
    const card = main.getByTestId(`plan-change-e2e_${stamp}`);
    await card.getByLabel('Note (needed to reject)', { exact: true }).fill('E2E: no');
    await card.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(main.getByTestId('saas-note-plans')).toContainText('Plan change rejected');
  } finally {
    await d.ctx.close();
  }
  const s = await sql<{ enabled: boolean; pending_enabled: boolean | null }>(`select enabled, pending_enabled from saas_billing_settings where id = 1`);
  expect(s[0].enabled).toBe(false);
  expect(s[0].pending_enabled).toBeNull();
  expect((await sql(`select 1 from dropship_plans where code = $1`, [`e2e_${stamp}`])).length).toBe(0);
});
