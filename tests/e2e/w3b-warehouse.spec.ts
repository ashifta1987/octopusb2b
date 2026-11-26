import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W3b E2E (STAGING ONLY) — scale check (board 17), packaging materials (board 12), multi-parcel packing (board 14),
 * exceptions queue (board 29). axe clean at 1280 px and 390 px.
 *  1. Supervisor adds a bench (locked until checked), a check fails (locked), a check passes (OK).
 *  2. Supervisor stocks the E2E box as a material and receives 10; the warehouse admin sets the price per unit.
 *  3. Packer at 390 px packs an order in two parcels (items, box, three photos, reading on the checked bench, close) and closes
 *     the order; each parcel took one box from materials stock (10 → 8).
 *  4. Supervisor assigns a short-pick exception to themselves and resolves it with "Pick again"; the order is back to Ready to pick.
 * Stock: NO stock movement is posted. The two orders are written straight at their step (picked / picking, nothing reserved); a
 * short pick and "pick again" move no stock. The only ledger rows are packaging material moves (our own table), removed in
 * afterAll with the bench (and its checks), material, box, orders (parcels, uses, exceptions cascade), the temporary
 * item_master row, photos (Storage API), people and the client.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let packer: TempStaff | null = null;
let sup: TempStaff | null = null;
let client: TempCustomer | null = null;
const n2 = String(Date.now() % 100).padStart(2, '0');
const SKU = `E2E-W3B-${Date.now() % 1_000_000}`;
const BOX = `EWBX${n2}`;
const BENCH = `EB-${n2}${Date.now() % 1000}`;
const MAT = `EMB${n2}${Date.now() % 1000}`;
let itemId = '';
let mpCode = '';
let exOrderCode = '';
let exCode = '';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
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
  admin = await createTempStaff('admin');
  packer = await createTempStaff('warehouse');
  sup = await createTempStaff('warehouse');
  client = await createTempCustomer('w3be2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'packer'), ($2, 'FS-01', 'supervisor') on conflict do nothing`, [packer.id, sup.id]);
    await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01') on conflict do nothing`, [client.orgId]);
    itemId = (await db.query(`insert into item_master (weight_g, has_battery, has_liquid) values (450, false, false) returning id`)).rows[0].id;
    await db.query(`insert into wh_boxes (warehouse_code, code, name, length_mm, width_mm, height_mm, tare_g) values ('FS-01', $1, 'E2E carton', 300, 200, 100, 100)`, [BOX]);
    // two orders written straight at their step: nothing is reserved or picked in the stock ledger
    const mk = async (status: string, qty: number, picked: number) => {
      const o = (await db.query(`insert into wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_address, ship_country, status, picked_at)
        values ('FS-01', 'client_portal', $1, $2, 'Erika Muster', '{"line1": "Hauptstraße 5", "city": "Berlin"}'::jsonb, 'DE', $3, $4) returning id, code`,
      [client!.orgId, `E2E-W3B-${status}-${Date.now() % 100000}`, status, status === 'picked' ? new Date() : null])).rows[0];
      await db.query(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, unit_weight_g) values ($1, $2, $3, 'E2E desk lamp', $4, $5, 450)`, [o.id, itemId, SKU, qty, picked]);
      return o as { id: string; code: string };
    };
    mpCode = (await mk('picked', 2, 2)).code;
    const ex = await mk('picking', 1, 0);
    exOrderCode = ex.code;
    // the packer reports the short pick through the real function (as themselves) → the exception is raised automatically
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: packer.id, role: 'authenticated', aal: 'aal2' })]);
    await db.query('set local role authenticated');
    const line = (await db.query(`select id from wh_order_lines where order_id = $1`, [ex.id])).rows[0].id;
    await db.query(`select wh_report_short($1, $2, 'E2E: bin empty')`, [ex.id, line]);
    await db.query('commit');
    exCode = (await db.query(`select code from wh_exceptions where order_id = $1 and kind = 'short_pick'`, [ex.id])).rows[0]?.code ?? '';
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
  const paths: string[] = [];
  try {
    await assertStagingDatabase(db);
    if (client) {
      paths.push(...(await db.query(`select e.storage_path p from wh_pack_evidence e join wh_orders o on o.id = e.order_id where o.org_id = $1`, [client.orgId])).rows.map((r) => r.p as string));
      await db.query(`delete from wh_orders where org_id = $1`, [client.orgId]); // parcels, items, material uses, exceptions cascade
      await db.query(`delete from wh_clients where org_id = $1`, [client.orgId]);
    }
    await db.query(`delete from wh_material_moves where material_id in (select id from wh_materials where warehouse_code = 'FS-01' and code = $1)`, [MAT]);
    await db.query(`delete from wh_materials where warehouse_code = 'FS-01' and code = $1`, [MAT]);
    await db.query(`delete from wh_scale_benches where warehouse_code = 'FS-01' and code = $1`, [BENCH]);
    await db.query(`delete from wh_boxes where warehouse_code = 'FS-01' and code = $1`, [BOX]);
    if (itemId) await db.query(`delete from item_master where id = $1`, [itemId]);
    for (const s of [packer, sup]) if (s) await db.query(`delete from warehouse_staff where user_id = $1`, [s.id]);
  } finally {
    await db.end();
  }
  if (paths.length) await adminClient().storage.from('wh-evidence').remove(paths);
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  await deleteTempStaff(sup);
  await deleteTempStaff(packer);
  await deleteTempStaff(admin);
});

test('W3b scale check: new bench locked → failed check locks → passing check unlocks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, sup!, '/office/warehouse/scale');
  await page.goto('/office/warehouse/scale');
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Scale check' })).toHaveAttribute('aria-current', 'page');
  const form = page.getByTestId('wh-bench-form');
  await form.getByLabel('Bench code').fill(BENCH);
  await form.getByLabel('Name').fill('E2E packing bench');
  await form.getByLabel('Check tolerance (g)').fill('2');
  await page.getByTestId('wh-bench-submit').click();
  await expect(page.getByTestId('wh-bench-msg')).toContainText('locked until it passes its first calibration check');
  const bench = page.getByTestId(`wh-bench-${BENCH}`);
  await expect(page.getByTestId(`wh-bench-state-${BENCH}`)).toContainText('Locked');
  const check = page.getByTestId(`wh-scale-check-${BENCH}`);
  await check.getByLabel('Reference weight (g)').fill('1000');
  await check.getByLabel('Scale shows (g)').fill('1010');
  await expect(check).toContainText('Outside ± 2 g');
  await page.getByTestId(`wh-scale-check-submit-${BENCH}`).click();
  await expect(page.getByTestId(`wh-scale-check-msg-${BENCH}`)).toContainText('Failed: +10 g');
  await page.reload();
  await expect(page.getByTestId(`wh-bench-locked-${BENCH}`)).toContainText('Failed check: read 1010 g on a 1000 g reference');
  await axeBoth(page, 'scale check (locked)');
  await check.getByLabel('Reference weight (g)').fill('1000');
  await check.getByLabel('Scale shows (g)').fill('1001');
  await page.getByTestId(`wh-scale-check-submit-${BENCH}`).click();
  await expect(page.getByTestId(`wh-scale-check-msg-${BENCH}`)).toContainText('Passed: +1 g');
  await page.reload();
  await expect(page.getByTestId(`wh-bench-state-${BENCH}`)).toContainText('Checked · OK');
  await expect(bench).toContainText('Failed');
  await expect(bench).toContainText('Passed');
});

test('W3b materials: stock the box, receive, admin sets the price', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, sup!, '/office/warehouse/materials');
  await page.goto('/office/warehouse/materials');
  const form = page.getByTestId('wh-material-form');
  await form.getByLabel('Material code').fill(MAT);
  await form.getByLabel('Name').fill('E2E carton stock');
  await form.getByLabel('Kind').selectOption('box');
  await form.getByLabel('Packing box it stands for').selectOption({ label: `E2E carton (${BOX})` });
  await form.getByLabel('Low-stock alert at').fill('9');
  await page.getByTestId('wh-material-submit').click();
  await expect(page.getByTestId('wh-material-msg')).toContainText('Material added with 0 on hand');
  const row = page.getByTestId(`wh-material-${MAT}`);
  await expect(page.getByTestId(`wh-material-onhand-${MAT}`)).toContainText('0');
  await expect(page.getByTestId(`wh-material-low-${MAT}`)).toBeVisible();
  await expect(page.getByTestId(`wh-material-price-${MAT}`)).toHaveText('Not set');
  await row.getByLabel(/Receive/).fill('10');
  await page.getByTestId(`wh-material-receive-submit-${MAT}`).click();
  await expect(page.getByTestId(`wh-material-receive-msg-${MAT}`)).toContainText('10 on hand');
  await page.reload();
  await expect(page.getByTestId(`wh-material-onhand-${MAT}`)).toHaveText('10');
  await expect(page.getByTestId(`wh-material-low-${MAT}`)).toHaveCount(0);
  await axeBoth(page, 'materials');

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await p2.setViewportSize({ width: 1280, height: 1000 });
    await staffLogin(p2, admin!, '/office/warehouse/materials');
    await p2.goto('/office/warehouse/materials');
    const r2 = p2.getByTestId(`wh-material-${MAT}`);
    await r2.getByText('Count, price and settings').click();
    await r2.getByLabel(/Price per unit charged to the client/).fill('0.35');
    await p2.getByTestId(`wh-material-price-submit-${MAT}`).click();
    await expect(p2.getByTestId(`wh-material-price-msg-${MAT}`)).toContainText('Price saved');
    await p2.reload();
    await expect(p2.getByTestId(`wh-material-price-${MAT}`)).toContainText('0.35');
  } finally {
    await ctx.close();
  }
});

test('W3b multi-parcel packing at 390 px: two parcels on the checked bench, then the order', async ({ page }) => {
  test.skip(!mpCode, 'no order');
  await page.setViewportSize({ width: 390, height: 844 });
  await staffLogin(page, packer!, `/office/warehouse/multi-parcel?order=${mpCode}`);
  await page.goto(`/office/warehouse/multi-parcel?order=${mpCode}`);
  await expect(page.getByTestId('wh-multi-order')).toBeVisible();
  await page.getByTestId('wh-multi-add').click();
  await expect(page.getByTestId('wh-parcel-1')).toBeVisible();
  await page.getByTestId('wh-multi-add').click();
  await expect(page.getByTestId('wh-parcel-2')).toBeVisible();
  await expect(page.getByTestId('wh-multi-close-submit')).toBeDisabled();
  for (const seq of [1, 2]) {
    const card = page.getByTestId(`wh-parcel-${seq}`);
    await card.getByLabel(`Scan product into parcel ${seq}`).fill(SKU);
    await page.getByTestId(`wh-p${seq}-scan-submit`).click();
    await expect(page.getByTestId(`wh-p${seq}-item-${SKU}`)).toContainText('× 1');
    await card.getByLabel('Box or mailer').selectOption({ label: `E2E carton (${BOX}) · empty 100 g · ${seq === 1 ? 10 : 9} in stock` });
    await page.getByTestId(`wh-p${seq}-box-submit`).click();
    await expect(page.getByTestId(`wh-p${seq}-expected`)).toContainText('expected 550 g ± ');
    for (const k of ['contents', 'sealed', 'scale']) {
      await page.getByTestId(`wh-p${seq}-photo-file-${k}`).setInputFiles({ name: `${k}.png`, mimeType: 'image/png', buffer: PNG });
      await expect(page.getByTestId(`wh-p${seq}-photo-step-${k}`)).toContainText(/saved/i);
    }
    await card.getByLabel('Scale bench').selectOption({ label: `${BENCH} · E2E packing bench` });
    await card.getByLabel('Scale reading (grams)').fill('560');
    await page.getByTestId(`wh-p${seq}-weigh-submit`).click();
    await expect(page.getByTestId(`wh-p${seq}-weight`)).toContainText(`Measured 560 g on ${BENCH}`);
    await expect(page.getByTestId(`wh-p${seq}-weight`)).toContainText('Inside tolerance');
    if (seq === 1) await axeBoth(page, 'multi-parcel (parcel 1 ready)');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId(`wh-p${seq}-close-submit`).click();
    await expect(page.getByTestId(`wh-parcel-${seq}-state`)).toContainText('Closed');
  }
  await page.getByTestId('wh-multi-close-submit').click();
  await expect(page.getByTestId('wh-multi-close-msg')).toContainText(`${mpCode} is packed in 2 parcels (1,120 g in total)`);
  await page.reload();
  await expect(page.getByTestId('wh-multi-packed')).toContainText('2 parcels');
  await axeBoth(page, 'multi-parcel (packed)');

  await page.goto('/office/warehouse/materials');
  await expect(page.getByTestId(`wh-material-onhand-${MAT}`)).toHaveText('8');
  await expect(page.getByTestId(`wh-material-low-${MAT}`)).toBeVisible();
  await expect(page.getByTestId(`wh-material-moves-FS-01`)).toContainText(mpCode);
});

test('W3b exceptions: the short pick is assigned and released with a resolution', async ({ page }) => {
  test.skip(!exCode, 'no exception raised');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, sup!, '/office/warehouse/exceptions');
  await page.goto('/office/warehouse/exceptions');
  const row = page.getByTestId(`wh-exc-${exCode}`);
  await expect(row).toContainText('Short pick');
  await expect(row).toContainText(exOrderCode);
  await expect(row).toContainText('Raised automatically');
  await axeBoth(page, 'exceptions');
  await page.getByTestId(`wh-exc-assign-${exCode}`).click();
  await expect(page.getByTestId(`wh-exc-assign-msg-${exCode}`)).toContainText(`${exCode} assigned`);
  await expect(page.getByTestId(`wh-exc-status-${exCode}`)).toContainText('Assigned');
  await expect(page.getByTestId(`wh-exc-resolve-${exCode}`)).toBeDisabled();
  await row.getByLabel('Release').selectOption({ label: 'Pick again' });
  await row.getByLabel('Resolution').fill('Found the lamp in the returns area');
  await page.getByTestId(`wh-exc-resolve-${exCode}`).click();
  await expect(page.getByTestId(`wh-exc-resolve-msg-${exCode}`)).toContainText(`${exCode} resolved. The order is back in picking.`);
  await page.goto('/office/warehouse/exceptions?status=resolved');
  await expect(page.getByTestId(`wh-exc-resolution-${exCode}`)).toContainText('Found the lamp in the returns area');
  await axeBoth(page, 'exceptions (resolved)');
  await page.goto(`/office/warehouse/orders/${exOrderCode}`);
  await expect(page.locator('main')).toContainText('Ready to pick');
});
