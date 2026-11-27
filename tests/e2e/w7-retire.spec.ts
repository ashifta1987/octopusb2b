import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS W7 (owner, 26 Nov 2026: "remove the old, follow the new") — the legacy shipping / pack screens are gone:
 *   /office/shipping[?order=] → /office/warehouse/b2b-shipments[?order=] (permanent redirect; Support: tracking only, no
 *   carrier / rate / label; editors: carrier, rate, Label; never "Simulate event"); back-office menu item "B2B shipments";
 *   /office/dropship/queue → Warehouse OS Dropship orders, ?status=packing and /office/dropship/pack → packing station,
 *   /office/dropship/pack/WO-… → that warehouse order; staff without a warehouse role get a "moved" notice instead.
 * Data: one temp company, one Sourcing order and one in-transit shipment with a tracking event (written directly, SRC
 * division); purged afterwards.
 */
test.describe.configure({ mode: 'serial' });

let support: TempStaff | null = null;
let ops: TempStaff | null = null;
let admin: TempStaff | null = null;
let dsOnly: TempStaff | null = null;
let customer: TempCustomer | null = null;
let orderId: string | null = null;
let tracking: string | null = null;

test.beforeAll(async () => {
  await assertStagingOrThrow();
  support = await createTempStaff('support');
  ops = await createTempStaff('operations');
  admin = await createTempStaff('admin');
  dsOnly = await createTempStaff('operations');
  customer = await createTempCustomer('w7cust');
  const db = pgClient();
  await db.connect();
  try {
    await db.query(`insert into public.division_members(user_id, division_id, role) values ($1, division_id_of('SRC'), 'staff') on conflict do nothing`, [ops.id]);
    await db.query(`insert into public.division_members(user_id, division_id, role) values ($1, division_id_of('DS'), 'staff') on conflict do nothing`, [dsOnly.id]);
    const sup = (await db.query(`select id from public.suppliers where code is not null order by created_at limit 1`)).rows[0] as { id: string } | undefined;
    const stamp = Date.now();
    const o = (await db.query(
      `insert into public.orders (org_id, supplier_id, division_id, code, title, quantity, unit_price_cents, total_cents, deposit_cents, currency)
       values ($1, $2, division_id_of('SRC'), $3, 'E2E W7 order', 10, 500, 5000, 1500, 'USD') returning id`,
      [customer.orgId, sup?.id ?? null, `E2E-W7-${stamp}`],
    )).rows[0] as { id: string };
    orderId = o.id;
    tracking = `YT-E2E-W7-${stamp}`;
    const sh = (await db.query(
      `insert into public.shipments (code, order_id, org_id, carrier_code, service_code, tracking_no, label_url, status, rate_cents, currency, division_id)
       values ($1, $2, $3, 'yunexpress', 'E2E-SVC', $4, $5, 'in_transit', 4321, 'USD', division_id_of('SRC')) returning id`,
      [`E2E-SHP-W7-${stamp}`, o.id, customer.orgId, tracking, `/api/labels/${tracking}`],
    )).rows[0] as { id: string };
    await db.query(
      `insert into public.tracking_events (shipment_id, org_id, status, description, location, occurred_at)
       values ($1, $2, 'in_transit', 'Departed Shenzhen hub — W7 test', 'Shenzhen', now())`,
      [sh.id, customer.orgId],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  const db = pgClient();
  await db.connect();
  try {
    for (const t of [ops, dsOnly]) if (t) await db.query(`delete from public.division_members where user_id = $1`, [t.id]);
  } finally {
    await db.end();
  }
  await purgeTestOrgs(customer?.orgId ? [customer.orgId] : [], customer?.id ? [customer.id] : []);
  for (const t of [support, ops, admin, dsOnly]) {
    if (!t) continue;
    try {
      await deleteTempStaff(t);
    } catch {
      await t.admin.auth.admin.updateUserById(t.id, { ban_duration: '876000h' });
    }
  }
});

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.length}`), `${label} axe serious/critical`).toEqual([]);
}

test('/office/shipping redirects to Warehouse OS B2B shipments; Support reads tracking without carrier, rate or label', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await staffLogin(page, support!, '/office/support');
  await page.goto('/office/shipping');
  await expect(page).toHaveURL(/\/office\/warehouse\/b2b-shipments$/);
  await expect(page.getByTestId('warehouse-staff-shell')).toBeVisible();
  await expect(page.locator('h1')).toContainText('B2B shipments');
  const row = page.getByTestId('b2b-shipments').locator('tr', { hasText: tracking! });
  await expect(row).toBeVisible();
  await expect(row.getByText('In transit', { exact: true })).toBeVisible();
  await row.locator('summary', { hasText: /All events/ }).click();
  await expect(row.getByText(/Departed Shenzhen hub — W7 test/).first()).toBeVisible();
  const main = await page.locator('main').innerText();
  expect(main).not.toContain('YunExpress');
  expect(main).not.toContain('E2E-SVC');
  expect(main).not.toContain('43.21');
  expect(main).not.toContain('Ready to ship');
  await expect(page.locator('a[href^="/api/labels/"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Simulate event/i })).toHaveCount(0);
  // no warehouse role: the Warehouse OS menu only offers B2B shipments
  const nav = page.getByTestId('warehouse-sidebar');
  await expect(nav.getByRole('link', { name: 'B2B shipments' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Packing station' })).toHaveCount(0);
  // ?order= survives the redirect (it opens the shipment creator for orders editors)
  await page.goto(`/office/shipping?order=${orderId}`);
  await expect(page).toHaveURL(new RegExp(`/office/warehouse/b2b-shipments\\?order=${orderId}$`));
  await ctx.close();
});

test('Sourcing operations see carrier, rate and Label, the back-office menu says B2B shipments, and nothing simulates tracking', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await staffLogin(page, ops!, '/office/orders');
  await page.goto('/office/orders');
  await expect(page.getByRole('link', { name: 'B2B shipments' }).first()).toBeVisible();
  await expect(page.locator('a[href="/office/shipping"]')).toHaveCount(0);
  await page.goto('/office/warehouse/b2b-shipments');
  const row = page.getByTestId('b2b-shipments').locator('tr', { hasText: tracking! });
  await expect(row).toBeVisible();
  await expect(row.getByText('YunExpress')).toBeVisible();
  await expect(row.getByText('E2E-SVC')).toBeVisible();
  await expect(row.getByText(/43\.21/)).toBeVisible();
  await expect(row.getByRole('link', { name: /^Label$/ })).toBeVisible();
  await expect(page.getByTestId('b2b-ready')).toBeVisible();
  await expect(page.getByRole('button', { name: /Simulate event/i })).toHaveCount(0);
  await axe(page, 'b2b-shipments-1280');
  await page.setViewportSize({ width: 390, height: 844 });
  await axe(page, 'b2b-shipments-390');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'b2b-shipments-390 must not overflow').toBe(true);
  await ctx.close();
});

test('retired Dropship fulfilment URLs hand over to Warehouse OS (or say where the work moved)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await staffLogin(page, admin!, '/office/dropship');
  await page.goto('/office/dropship/queue');
  test.skip(/\/office\/dropship$/.test(new URL(page.url()).pathname), 'dropship_v2_ui is off on this database');
  await expect(page).toHaveURL(/\/office\/warehouse\/orders\?source=dropship$/);
  await page.goto('/office/dropship/queue?status=packing');
  await expect(page).toHaveURL(/\/office\/warehouse\/pack$/);
  await page.goto('/office/dropship/pack');
  await expect(page).toHaveURL(/\/office\/warehouse\/pack$/);
  await page.goto('/office/dropship/pack/wo-999999');
  await expect(page).toHaveURL(/\/office\/warehouse\/orders\/WO-999999$/);
  await page.goto('/office/dropship/pack/DSO-NOPE-W7');
  await expect(page).toHaveURL(/\/office\/warehouse\/orders\?source=dropship&q=DSO-NOPE-W7$/);
  await ctx.close();

  // Dropship division staff without a warehouse role: no dead end at /forbidden, a notice instead; menu items hidden
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const ds = await ctx2.newPage();
  await staffLogin(ds, dsOnly!, '/office/dropship');
  await ds.goto('/office/dropship/pack');
  await expect(ds.getByTestId('moved-to-warehouse-os')).toBeVisible();
  await expect(ds.getByTestId('planned-notice')).toHaveCount(0);
  const side = ds.getByTestId('dropship-staff-sidebar');
  await expect(side.getByRole('link', { name: 'Fulfilment queue' })).toHaveCount(0);
  await expect(side.getByRole('link', { name: 'Pack station' })).toHaveCount(0);
  await ctx2.close();
});
