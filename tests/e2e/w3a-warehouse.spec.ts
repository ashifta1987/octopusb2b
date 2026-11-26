import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W3a E2E (STAGING ONLY) — portal Orders (board 19), handheld picking (board 6), packing station (board 2),
 * order detail (board 3), evidence (board 4).
 *  1. Client: manual order → "stock reserved"; CSV upload → preview → create.
 *  2. Packer at 390 px: pick the manual order by scanning bin + product.
 *  3. Packing station: scan, box, three photos (private bucket), weight inside tolerance → packed; evidence list.
 *  4. Out of tolerance: three wrong supervisor PINs lock the override; a warehouse admin unlocks; two people: once the
 *     supervisor re-weighs the parcel themselves nobody is offered to approve it; after the packer re-weighs, the supervisor's
 *     PIN (set through wh_set_my_pin) approves with a reason; packed.
 *  5. Client sees the packing proof (signed photos, weight check). axe clean at 1280 px and 390 px.
 * Stock: this flow must post real movements (receive → reserve → pick are append-only on staging), so it uses ONE dedicated
 * temporary client product per run: 3 units in, 3 reserved and picked out — its stock ends at 0 on hand / 0 reserved. The
 * item_master row and its movements stay (append-only ledger); orders, lots, bins, box, photos and people are removed.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let packer: TempStaff | null = null;
let sup: TempStaff | null = null;
let client: TempCustomer | null = null;
const stamp = Date.now() % 100;
const n2 = String(stamp).padStart(2, '0');
const SKU = `E2E-W3A-${Date.now() % 1_000_000}`;
const BIN = `EW${n2}-01-01`;
const BOX = `EWBOX${n2}`;
const REF_A = `E2E-A-${Date.now() % 1_000_000}`;
const REF_B = `E2E-B-${Date.now() % 1_000_000}`;
const PIN = '4826';
let itemId = '';
let lotId = '';
let codeA = '';
let codeB = '';
// a 1×1 PNG
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
  client = await createTempCustomer('w3ae2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'packer'), ($2, 'FS-01', 'supervisor') on conflict do nothing`, [packer.id, sup.id]);
    await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01') on conflict do nothing`, [client.orgId]);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'warehouse', 'on') on conflict (org_id, service) do update set status = 'on'`, [client.orgId]);
    // one dedicated temporary product of the test client, 3 units received into a bin at FS-01
    itemId = (await db.query(`insert into item_master (weight_g, has_battery, has_liquid) values (450, false, false) returning id`)).rows[0].id;
    await db.query(`insert into wh_client_skus (org_id, sku, name, item_id, weight_g) values ($1, $2, 'E2E desk lamp', $3, 450)`, [client.orgId, SKU, itemId]);
    await db.query('begin');
    await db.query(`select record_warehouse_stock_movement($1, 'inbound', 3, 'W3a E2E temporary stock', 'FS-01', null)`, [itemId]);
    lotId = (await db.query(`insert into wh_lots (warehouse_code, item_id, org_id, qty, status) values ('FS-01', $1, $2, 3, 'released') returning id`, [itemId, client.orgId])).rows[0].id;
    const bin = (await db.query(`insert into wh_bins (warehouse_code, code) values ('FS-01', $1) on conflict (warehouse_code, code) do update set status = 'active' returning id`, [BIN])).rows[0].id;
    await db.query(`insert into wh_bin_stock (warehouse_code, bin_id, item_id, lot_id, qty) values ('FS-01', $1, $2, $3, 3)`, [bin, itemId, lotId]);
    await db.query(`insert into wh_boxes (warehouse_code, code, name, length_mm, width_mm, height_mm, tare_g) values ('FS-01', $1, 'E2E carton', 300, 200, 100, 100)`, [BOX]);
    await db.query('commit');
    // the supervisor sets their own override PIN through the real function (as themselves)
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: sup.id, role: 'authenticated', aal: 'aal2' })]);
    await db.query('set local role authenticated');
    await db.query(`select wh_set_my_pin($1)`, [PIN]);
    await db.query('commit');
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
      await db.query(`delete from wh_orders where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_bin_stock where lot_id = $1`, [lotId || null]);
      await db.query(`delete from wh_lots where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_client_skus where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_clients where org_id = $1`, [client.orgId]);
    }
    await db.query(`delete from wh_bins where warehouse_code = 'FS-01' and code = $1 and not exists (select 1 from wh_bin_stock b where b.bin_id = wh_bins.id)`, [BIN]);
    await db.query(`delete from wh_boxes where warehouse_code = 'FS-01' and code = $1`, [BOX]);
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

test('W3a portal: manual order and CSV upload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, '/account/warehouse?tab=orders');
  await page.goto('/account/warehouse?tab=orders');
  await expect(page.getByTestId('wh-tab-orders')).toHaveAttribute('aria-current', 'page');
  const form = page.getByTestId('wh-order-form');
  await form.getByLabel('Your order number').fill(REF_A);
  await form.getByLabel('Customer name *').fill('Erika Muster');
  await form.getByLabel('Country code *').fill('DE');
  await form.getByLabel('Address *').fill('Hauptstraße 5');
  await form.getByLabel('City *').fill('Berlin');
  await form.getByLabel('Postcode').fill('10115');
  await expect(page.getByTestId('wh-order-submit')).toBeDisabled();
  await form.getByLabel('Product 1', { exact: true }).selectOption({ label: `${SKU} · E2E desk lamp` });
  await form.getByLabel('Units of product 1', { exact: true }).fill('2');
  await page.getByTestId('wh-order-submit').click();
  await expect(page.getByTestId('wh-order-msg')).toContainText(/Order WO-\d{6,} received\. Your stock is reserved/);
  codeA = ((await page.getByTestId('wh-order-msg').innerText()).match(/WO-\d{6,}/) ?? [''])[0];
  const rowA = page.getByTestId(`wh-portal-order-${codeA}`);
  await expect(rowA).toContainText(REF_A);
  await expect(rowA).toContainText('Received');
  await expect(rowA.getByRole('list', { name: 'Order steps' })).toBeVisible();

  // CSV: one bad row is shown with its row number and blocks creation; a good file previews and creates
  const csv = (rows: string[]) => ['order_number,name,phone,address1,address2,city,region,postcode,country,sku,qty', ...rows].join('\n');
  await page.getByTestId('wh-csv-file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([`${REF_B},Jan,,Main 1,,Paris,,75001,FR,NOT-A-SKU,1`])) });
  await expect(page.getByTestId(`wh-csv-order-${REF_B}`)).toContainText('is not one of your active products');
  await expect(page.getByTestId('wh-csv-create')).toBeDisabled();
  await page.getByTestId('wh-csv-file').setInputFiles({ name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([`${REF_B},Jan Novak,,Main 1,,Paris,,75001,fr,${SKU.toLowerCase()},1`])) });
  await expect(page.getByTestId(`wh-csv-order-${REF_B}`)).toContainText('Ready');
  await axeBoth(page, 'portal orders');
  await page.getByTestId('wh-csv-create').click();
  await expect(page.getByTestId('wh-csv-msg')).toContainText(/1 order\(s\) received \(WO-\d{6,}\)/);
  codeB = ((await page.getByTestId('wh-csv-msg').innerText()).match(/WO-\d{6,}/) ?? [''])[0];
  await expect(page.getByTestId(`wh-portal-order-${codeB}`)).toContainText(REF_B);
});

test('W3a handheld picking at 390 px', async ({ page }) => {
  test.skip(!codeA, 'no order from the portal step');
  await page.setViewportSize({ width: 390, height: 844 });
  await staffLogin(page, packer!, `/office/warehouse/pick`);
  await page.goto('/office/warehouse/pick');
  await page.getByTestId(`wh-pick-open-${codeA}`).click();
  await expect(page.getByTestId('wh-pick-order')).toBeVisible();
  await expect(page.getByTestId(`wh-pick-line-${SKU}`)).toContainText(`Go to ${BIN}`);
  await page.getByTestId('wh-pick-start').click();
  await expect(page.getByTestId('wh-pick-status')).toContainText('Picking');
  const scan = page.getByTestId('wh-pick-scan');
  await scan.getByLabel('Bin').fill('ZZ-99-99');
  await scan.getByLabel('Product (SKU or barcode)').fill(SKU);
  await page.getByTestId('wh-pick-submit').click();
  await expect(page.getByTestId('wh-pick-msg')).toContainText('There is no bin ZZ-99-99');
  await scan.getByLabel('Bin').fill(BIN);
  await scan.getByLabel('Product (SKU or barcode)').fill(SKU);
  await scan.getByLabel('Units').fill('2');
  await axeBoth(page, 'picking');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('wh-pick-submit').click();
  await expect(page.getByTestId('wh-pick-msg')).toContainText(`fully picked`);
  await expect(page.getByTestId('wh-pick-status')).toContainText('Ready to pack');
});

test('W3a packing station: scan, box, photos, weight inside tolerance → packed', async ({ page }) => {
  test.skip(!codeA, 'no order from the portal step');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, packer!, `/office/warehouse/pack?order=${codeA}`);
  await page.goto(`/office/warehouse/pack?order=${codeA}`);
  await expect(page.getByTestId('wh-pack-order')).toBeVisible();
  const nav = page.getByTestId('warehouse-sidebar');
  await expect(nav.getByRole('link', { name: 'Packing station' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Evidence' })).toBeVisible();
  await expect(page.getByTestId('wh-pack-close-submit')).toBeDisabled();
  const scanIn = page.getByLabel('Scan product (SKU or barcode)');
  await scanIn.fill('NOT-IN-ORDER');
  await page.getByTestId('wh-pack-scan-submit').click();
  await expect(page.getByTestId('wh-pack-scan-msg')).toContainText('keep it out of the box');
  for (let i = 0; i < 2; i++) {
    await scanIn.fill(SKU);
    await page.getByTestId('wh-pack-scan-submit').click();
    await expect(page.getByTestId(`wh-pack-line-${SKU}`)).toContainText(`${i + 1} of 2`);
  }
  await page.getByLabel('Box or mailer').selectOption({ label: `E2E carton (${BOX}) · empty 100 g · 300×200×100 mm` });
  await page.getByTestId('wh-pack-box-submit').click();
  await expect(page.getByTestId('wh-pack-expected')).toContainText('Expected 1,000 g ± 50 g');
  for (const k of ['contents', 'sealed', 'scale']) {
    await page.getByTestId(`wh-photo-file-${k}`).setInputFiles({ name: `${k}.png`, mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId(`wh-photo-step-${k}`)).toContainText('Saved');
  }
  await page.getByLabel('Scale reading (grams)').fill('1020');
  await page.getByTestId('wh-pack-weigh-submit').click();
  await expect(page.getByTestId('wh-pack-weight-result')).toContainText('Inside tolerance');
  await axeBoth(page, 'packing station');
  await page.getByTestId('wh-pack-close-submit').click();
  await expect(page.getByTestId('wh-pack-close-msg')).toContainText(`${codeA} is packed`);

  await page.goto('/office/warehouse/evidence');
  const row = page.getByTestId(`wh-evidence-row-${codeA}`);
  await expect(row).toContainText('Complete');
  await expect(row).toContainText('1,020 g');
  await axeBoth(page, 'evidence list');
  await row.getByRole('link', { name: codeA }).click();
  await expect(page.getByTestId('wh-evidence-photos').locator('img')).toHaveCount(3);
  await expect(page.getByTestId('wh-evidence-kept')).toContainText('90 days');
  await axeBoth(page, 'evidence detail');
});

test('W3a out of tolerance: three wrong PINs lock, admin unlocks, supervisor PIN approves', async ({ page, browser }) => {
  test.skip(!codeB, 'no CSV order');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, packer!, `/office/warehouse/pick?order=${codeB}`);
  await page.goto(`/office/warehouse/pick?order=${codeB}`);
  await page.getByTestId('wh-pick-start').click();
  await page.getByTestId('wh-pick-scan').getByLabel('Bin').fill(BIN);
  await page.getByTestId('wh-pick-scan').getByLabel('Product (SKU or barcode)').fill(SKU);
  await page.getByTestId('wh-pick-submit').click();
  await expect(page.getByTestId('wh-pick-status')).toContainText('Ready to pack');

  await page.goto(`/office/warehouse/pack?order=${codeB}`);
  await page.getByLabel('Scan product (SKU or barcode)').fill(SKU);
  await page.getByTestId('wh-pack-scan-submit').click();
  await expect(page.getByTestId(`wh-pack-line-${SKU}`)).toContainText('1 of 1');
  await page.getByLabel('Box or mailer').selectOption({ label: `E2E carton (${BOX}) · empty 100 g · 300×200×100 mm` });
  await page.getByTestId('wh-pack-box-submit').click();
  await expect(page.getByTestId('wh-pack-expected')).toContainText('Expected 550 g ± 28 g');
  for (const k of ['contents', 'sealed', 'scale']) {
    await page.getByTestId(`wh-photo-file-${k}`).setInputFiles({ name: `${k}.png`, mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId(`wh-photo-step-${k}`)).toContainText('Saved');
  }
  await page.getByLabel('Scale reading (grams)').fill('900');
  await page.getByTestId('wh-pack-weigh-submit').click();
  await expect(page.getByTestId('wh-pack-weight-result')).toContainText('outside ± 28 g');
  await expect(page.getByTestId('wh-pack-close-submit')).toBeDisabled();
  const ovr = page.getByTestId('wh-override');
  await ovr.getByLabel('Supervisor', { exact: true }).selectOption({ index: 1 });
  await ovr.getByLabel('Reason').fill('Extra padding for glass');
  for (const left of ['2 attempt(s) left', '1 attempt(s) left']) {
    await ovr.getByLabel('Supervisor PIN').fill('9999');
    await page.getByTestId('wh-override-submit').click();
    await expect(page.getByTestId('wh-override-msg')).toContainText(`Wrong PIN. ${left}`);
  }
  await ovr.getByLabel('Supervisor PIN').fill('9999');
  await page.getByTestId('wh-override-submit').click();
  await expect(page.getByTestId('wh-override-msg')).toContainText('The override is locked');
  await page.reload();
  await expect(page.getByTestId('wh-override-locked')).toContainText('Override locked');
  await expect(page.getByTestId('wh-override-submit')).toHaveCount(0);
  await axeBoth(page, 'override locked');

  // a warehouse admin unlocks on the order page (board 3)
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await p2.setViewportSize({ width: 1280, height: 1000 });
    await staffLogin(p2, admin!, `/office/warehouse/orders/${codeB}`);
    await p2.goto(`/office/warehouse/orders/${codeB}`);
    await expect(p2.getByTestId('wh-override-attempts')).toContainText('wrong PIN');
    await p2.getByLabel('Why unlock?').fill('Supervisor mistyped; checked in person');
    await p2.getByTestId('wh-unlock-submit').click();
    await expect(p2.getByTestId('wh-order-msg')).toContainText('Override unlocked');
    await axeBoth(p2, 'order detail');
  } finally {
    await ctx.close();
  }

  // two people: the supervisor re-weighs it at their own station → they are no longer offered as the approver
  const ctx2 = await browser.newContext();
  const p3 = await ctx2.newPage();
  try {
    await p3.setViewportSize({ width: 1280, height: 1000 });
    await staffLogin(p3, sup!, `/office/warehouse/pack?order=${codeB}`);
    await p3.goto(`/office/warehouse/pack?order=${codeB}`);
    await p3.getByLabel('Scale reading (grams)').fill('900');
    await p3.getByTestId('wh-pack-weigh-submit').click();
    await expect(p3.getByTestId('wh-pack-weigh-msg')).toContainText('900 g is 350 g over');
    await expect(p3.getByTestId('wh-override-no-supervisor')).toContainText('must not be the person who packed or weighed');
    await expect(p3.getByTestId('wh-override-submit')).toHaveCount(0);
  } finally {
    await ctx2.close();
  }

  await page.reload();
  await page.getByLabel('Scale reading (grams)').fill('900');
  await page.getByTestId('wh-pack-weigh-submit').click();
  await expect(page.getByTestId('wh-pack-weigh-msg')).toContainText('900 g is 350 g over');
  const ovr2 = page.getByTestId('wh-override');
  await ovr2.getByLabel('Supervisor', { exact: true }).selectOption({ index: 1 });
  await ovr2.getByLabel('Supervisor PIN').fill(PIN);
  await ovr2.getByLabel('Reason').fill('Extra padding for glass');
  await page.getByTestId('wh-override-submit').click();
  await expect(page.getByTestId('wh-override-msg')).toContainText('Override approved');
  await expect(page.getByTestId('wh-pack-weight-result')).toContainText('Approved by');
  await page.getByTestId('wh-pack-close-submit').click();
  await expect(page.getByTestId('wh-pack-close-msg')).toContainText(`${codeB} is packed`);
});

test('W3a portal: the client sees the packing proof of its own order', async ({ page }) => {
  test.skip(!codeA, 'no order from the portal step');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, `/account/warehouse?tab=orders&order=${codeA}`);
  await page.goto(`/account/warehouse?tab=orders&order=${codeA}`);
  const proof = page.getByTestId('wh-proof');
  await expect(proof).toContainText(`Packing proof · ${codeA}`);
  await expect(page.getByTestId('wh-proof-weight')).toContainText('1,020 g measured · 1,000 g expected · inside tolerance');
  await expect(page.getByTestId('wh-proof-photos').locator('img')).toHaveCount(3);
  await expect(proof).not.toContainText('E2E warehouse'); // no staff names
  await expect(page.getByTestId(`wh-portal-order-${codeA}`)).toContainText('Packed');
  await axeBoth(page, 'portal proof');
  await page.goto('/account/warehouse?tab=orders&order=WO-999999');
  await expect(page.getByTestId('wh-proof-missing')).toContainText('couldn’t find order WO-999999');
});
