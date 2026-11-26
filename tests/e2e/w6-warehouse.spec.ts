import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { recordBankTransfer } from './helpers/turnkey';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W6 E2E (STAGING ONLY) — monthly 3PL invoice run (staff), portal monthly statement (board 22), Reports (board 30).
 * axe clean at 1280 px and 390 px.
 *  1. Warehouse admin previews last month for a temporary client: receiving per carton, pick and pack first + extra item, total;
 *     every line opens to the notice / order behind it; "Issue invoice" is disabled (Finance issues).
 *  2. Finance (separate browser context) issues the invoice → PF-… awaiting payment.
 *  3. The client sees the statement in the portal Invoices tab, opens a line to the order behind it, sees the wallet Pay button;
 *     Finance's bank transfer is recorded (existing pay_service_proforma path, as the Turnkey T3 helper does) → Paid + tax invoice.
 *  4. Reports: last month shows the client's shipped order and its order-to-handoff time; the CSV has the same row.
 * Data: a temporary client (custom plan) with one received stock notice (4 cartons) and one shipped order (3 items) last month,
 * written straight at their step (no stock movement). Rates: a temporary FS-01-specific "custom" version (recorded as superseded,
 * effective since before last month) — only when no FS-01-specific custom version exists; otherwise the issue / pay steps are
 * skipped (real rates would decide the amounts). afterAll removes the order, notice, client, box, rate version, the invoice with
 * its documents / journals / payment (purgeTestOrgs) and the people.
 */
test.describe.configure({ mode: 'serial' });
let whAdmin: TempStaff | null = null;
let finance: TempStaff | null = null;
let client: TempCustomer | null = null;
const n = `${Date.now() % 100000}`;
const BOX = `EW6B${n.slice(-3)}`;
let rateId: string | null = null;
let skipIssue = false;
let orderCode = '';
let asnCode = '';
let documentId = '';

// last month in China time (YYYY-MM) and a moment in its middle
const china = new Date(Date.now() + 8 * 3600_000);
const lm = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth() - 1, 1));
const YM = `${lm.getUTCFullYear()}-${String(lm.getUTCMonth() + 1).padStart(2, '0')}`;
const MID = `${YM}-15 10:00+08`;

async function checkAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((x) => x.target) })))}`).toEqual([]);
}
async function axeBoth(page: Page, label: string) {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await checkAxe(page, `${label} @${w}`);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  whAdmin = await createTempStaff('warehouse');
  finance = await createTempStaff('finance');
  client = await createTempCustomer('w6e2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin') on conflict do nothing`, [whAdmin.id]);
    await db.query('begin');
    await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse, created_at) values ($1, 'custom', 'FS-01', now() - interval '90 days')`, [client.orgId]);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'warehouse', 'on') on conflict (org_id, service) do update set status = 'on'`, [client.orgId]);
    const existing = Number((await db.query(`select count(*) n from wh_rate_versions where plan_code = 'custom' and warehouse_code = 'FS-01' and status in ('active', 'superseded')`)).rows[0].n);
    if (existing > 0) {
      skipIssue = true;
    } else {
      const v = Number((await db.query(`select coalesce(max(version), 0) + 1 v from wh_rate_versions where plan_code = 'custom' and warehouse_code = 'FS-01'`)).rows[0].v);
      rateId = (await db.query(`insert into wh_rate_versions (plan_code, warehouse_code, version, receiving_per_carton_cents, pick_pack_first_cents, pick_pack_extra_cents, status, note, proposed_by, approved_by, effective_from)
        values ('custom', 'FS-01', $1, 150, 200, 75, 'superseded', 'W6 E2E temporary rates', $2, $3, ($4::timestamptz) - interval '20 days') returning id`, [v, whAdmin.id, finance.id, MID])).rows[0].id;
    }
    asnCode = (await db.query(`insert into wh_asns (org_id, warehouse_code, source, expected_date, cartons, status, received_at, created_at)
      values ($1, 'FS-01', 'client', ($2::timestamptz)::date, 4, 'received', $2, ($2::timestamptz) - interval '2 days') returning code`, [client.orgId, MID])).rows[0].code;
    const item = (await db.query(`insert into item_master (weight_g, has_battery, has_liquid) values (200, false, false) returning id`)).rows[0].id;
    const box = (await db.query(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'E2E W6 carton', 100) returning id`, [BOX])).rows[0].id;
    const o = (await db.query(`insert into wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_address, ship_country, status, picked_at, box_id, expected_weight_g, tolerance_g, measured_weight_g, created_at)
      values ('FS-01', 'client_portal', $1, $2, 'Erika Muster', '{"line1": "Hauptstraße 5", "city": "Berlin", "postcode": "10115"}'::jsonb, 'DE', 'packing', ($4::timestamptz) - interval '6 hours', $3, 700, 50, 700, ($4::timestamptz) - interval '6 hours') returning id, code`,
      [client.orgId, `E2E-W6-${n}`, box, MID])).rows[0];
    await db.query(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, packed_qty, unit_weight_g) values ($1, $2, $3, 'E2E desk lamp', 3, 3, 3, 200)`, [o.id, item, `E2E-W6-${n}`]);
    await db.query(`update wh_orders set status = 'packed', packed_at = ($2::timestamptz) - interval '1 hour' where id = $1`, [o.id, MID]);
    await db.query(`update wh_orders set status = 'shipped', shipped_at = $2, tracking_token = md5(random()::text) where id = $1`, [o.id, MID]);
    await db.query('commit');
    orderCode = o.code;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    if (client) {
      await db.query(`delete from wh_orders where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_asns where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_clients where org_id = $1`, [client.orgId]);
    }
    await db.query(`delete from wh_boxes where warehouse_code = 'FS-01' and code = $1`, [BOX]);
    if (whAdmin) await db.query(`delete from warehouse_staff where user_id = $1`, [whAdmin.id]);
  } finally {
    await db.end();
  }
  // documents (the proforma + tax invoice), journals, the payment and — by cascade — the 3PL invoice and its lines
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  if (rateId) {
    const db2 = pgClient();
    await db2.connect();
    try {
      await assertStagingDatabase(db2);
      await db2.query(`delete from wh_rate_versions where id = $1`, [rateId]);
    } finally {
      await db2.end();
    }
  }
  await deleteTempStaff(finance);
  await deleteTempStaff(whAdmin);
});

test('W6 preview: the warehouse admin sees last month\'s charges and what is behind them; only Finance issues', async ({ page }) => {
  test.skip(skipIssue, 'an FS-01-specific custom rate version exists on staging; amounts would follow real rates');
  await page.setViewportSize({ width: 1280, height: 1000 });
  const url = `/office/warehouse/invoices?month=${YM}&org=${client!.orgId}`;
  await staffLogin(page, whAdmin!, url);
  await page.goto(url);
  await expect(page.getByTestId('wh-invoices-page')).toBeVisible();
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Client invoices' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Reports' })).toBeVisible();
  const row = page.getByTestId(`wh-inv-row-${client!.orgId}`);
  await expect(row).toContainText('US$ 9.50');
  await expect(row).toContainText('Not issued');
  const pv = page.getByTestId('wh-inv-preview');
  await expect(pv.locator('tr[data-kind="receiving"]')).toContainText('US$ 6.00');
  await expect(pv.locator('tr[data-kind="pick_first"]')).toContainText('US$ 2.00');
  await expect(pv.locator('tr[data-kind="pick_extra"]')).toContainText('US$ 1.50');
  await expect(page.getByTestId('wh-inv-total')).toHaveText('US$ 9.50');
  await expect(page.getByTestId('wh-inv-minimum')).toHaveText('Not set');
  await pv.locator('tr[data-kind="pick_first"] summary').click();
  await expect(pv.locator('tr[data-kind="pick_first"]')).toContainText(orderCode);
  await pv.locator('tr[data-kind="receiving"] summary').click();
  await expect(pv.locator('tr[data-kind="receiving"]')).toContainText(asnCode);
  await expect(page.getByTestId('wh-inv-issue')).toBeDisabled();
  await expect(pv).toContainText('Only Finance can issue invoices.');
  await axeBoth(page, 'staff invoice preview');
});

test('W6 issue: Finance issues the month\'s invoice once', async ({ browser }) => {
  test.skip(skipIssue, 'an FS-01-specific custom rate version exists on staging');
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await p2.setViewportSize({ width: 1280, height: 1000 });
    const url = `/office/warehouse/invoices?month=${YM}&org=${client!.orgId}`;
    await staffLogin(p2, finance!, url);
    await p2.goto(url);
    await expect(p2.getByTestId('wh-inv-total')).toHaveText('US$ 9.50');
    p2.once('dialog', (d) => d.accept());
    await p2.getByTestId('wh-inv-issue').click();
    await expect(p2.getByTestId('wh-inv-msg')).toContainText(/Invoice PF-\d{4}-\d{6} issued/);
    await expect(p2.getByTestId('wh-inv-issued')).toContainText('Awaiting payment');
    await expect(p2.getByTestId(`wh-inv-row-${client!.orgId}`)).toContainText(/PF-\d{4}-\d{6}/);
    const db = pgClient();
    await db.connect();
    try {
      await assertStagingDatabase(db);
      const r = (await db.query(`select i.document_id, d.amount_cents, d.data->>'service' svc, (select count(*) from wh_invoices x where x.org_id = $1)::int n
                                   from wh_invoices i join documents d on d.id = i.document_id where i.org_id = $1`, [client!.orgId])).rows[0];
      expect(r.n).toBe(1);
      expect(Number(r.amount_cents)).toBe(950);
      expect(r.svc).toBe('warehouse');
      documentId = r.document_id;
    } finally {
      await db.end();
    }
    await checkAxe(p2, 'staff invoice issued @1280');
  } finally {
    await ctx.close();
  }
});

test('W6 portal: the client opens the statement, sees the order behind a line, and the recorded bank transfer pays it', async ({ page }) => {
  test.skip(skipIssue || !documentId, 'no invoice was issued');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, '/account/warehouse?tab=invoices');
  await page.goto('/account/warehouse?tab=invoices');
  await expect(page.getByTestId('wh-tab-invoices')).toHaveAttribute('aria-current', 'page');
  const stmt = page.getByTestId(`wh-stmt-${YM}`);
  await expect(stmt).toBeVisible();
  await expect(stmt.getByTestId('wh-stmt-total')).toHaveText('US$ 9.50');
  await expect(stmt.getByTestId('wh-stmt-status')).toHaveText('Awaiting payment');
  await expect(stmt.getByTestId(`pay-${documentId}`)).toBeVisible();
  const pick = stmt.locator('tr[data-kind="pick_first"]');
  await pick.locator('summary').click();
  await expect(pick.getByRole('link', { name: new RegExp(`Order ${orderCode}`) })).toBeVisible();
  await axeBoth(page, 'portal statement');
  await recordBankTransfer(documentId, 950, `E2E-W6-${n}`);
  await page.reload();
  const paid = page.getByTestId(`wh-stmt-${YM}`);
  await expect(paid.getByTestId('wh-stmt-status')).toHaveText('Paid');
  await expect(paid).toContainText(/Tax invoice OCT-3PL-\d{4}-\d{6}/);
  await expect(paid.getByTestId(`pay-${documentId}`)).toHaveCount(0);
});

test('W6 reports: last month shows the shipped order and its handoff time; CSV export', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, whAdmin!, '/office/warehouse/reports?preset=last_month');
  await page.goto(`/office/warehouse/reports?preset=last_month&org=${client!.orgId}`);
  await expect(page.getByTestId('wh-reports-page')).toBeVisible();
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue(`${YM}-01`);
  const row = page.getByTestId(`wh-rep-row-${client!.orgId}-FS-01`);
  await expect(row.getByTestId('wh-rep-shipped')).toHaveText('1');
  await expect(row.getByTestId('wh-rep-handoff')).toHaveText('6 h (1)');
  await expect(page.getByTestId('wh-rep-tile-orders')).toContainText('1');
  await expect(page.getByTestId('wh-rep-settings')).toBeVisible();
  const href = await page.getByTestId('wh-rep-csv').getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const body = await res.text();
  expect(body).toContain('Orders shipped');
  expect(body).toContain(`E2E Buyer w6e2e LLC,FS-01,1,3,1,6`);
  await axeBoth(page, 'reports');
});
