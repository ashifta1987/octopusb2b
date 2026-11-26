import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W5 E2E (STAGING ONLY) — client portal Inventory (board 18), Returns (board 21), Integrations (board 23),
 * Support (board 24); staff Returns screen; support desk warehouse context. axe clean at 1280 px and 390 px.
 *  1. Client: Inventory shows on hand / available / incoming and "Not enough history" for days of cover; uploads a product
 *     photo (private bucket) → thumbnail and large photo.
 *  2. Receiver registers two returns, photographs and grades them (good / damaged) on /office/warehouse/returns.
 *  3. Client decides: restock (good units) and send back (damaged unit, to an address).
 *  4. Receiver carries them out: restock → a released lot (stock +2); send back → an order picked at the returns desk.
 *  5. Integrations: CSV available now; Shopify etc. "Not available yet"; no connect buttons.
 *  6. Support request about the packed order → listed with its reference; the thread links the packing record; the support desk
 *     (company admin, separate browser context) sees the order and the link to its packing evidence.
 * Data: one temporary client product with 5 units through the ledger (+2 restocked); afterAll books the remaining units out
 * (adjust_out, so it ends at 0 on hand / 0 reserved — the item_master row and its movements stay, append-only), removes the
 * returns (photos via the Storage API), orders, lots, notice, tickets, product photo, box, people and the client.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let recv: TempStaff | null = null;
let client: TempCustomer | null = null;
const n = `${Date.now() % 100000}`;
const SKU = `E2E-W5-${n}`;
const BOX = `EW5B${n.slice(-3)}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let itemId = '';
let orderCode = '';
let codeA = '';
let codeB = '';
let ticketId = '';

async function checkAxe(page: Page, label: string) {
  // let button colour transitions (hover / pending → idle) finish so axe reads the settled colours
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
  admin = await createTempStaff('admin');
  recv = await createTempStaff('warehouse');
  client = await createTempCustomer('w5e2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'receiver') on conflict do nothing`, [recv.id]);
    await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01') on conflict do nothing`, [client.orgId]);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'warehouse', 'on') on conflict (org_id, service) do update set status = 'on'`, [client.orgId]);
    await db.query('begin');
    itemId = (await db.query(`insert into item_master (weight_g, has_battery, has_liquid) values (450, false, false) returning id`)).rows[0].id;
    await db.query(`insert into wh_client_skus (org_id, sku, name, item_id, weight_g) values ($1, $2, 'E2E desk lamp', $3, 450)`, [client.orgId, SKU, itemId]);
    // 5 units in stock through the only write path (service role); an open stock notice for 4 more
    await db.query(`select record_warehouse_stock_movement($1, 'inbound', 5, 'W5 E2E temporary stock', 'FS-01', null)`, [itemId]);
    const asn = (await db.query(`insert into wh_asns (org_id, warehouse_code, source, expected_date, cartons, status) values ($1, 'FS-01', 'client', current_date + 5, 1, 'submitted') returning id`, [client.orgId])).rows[0].id;
    await db.query(`insert into wh_asn_lines (asn_id, item_id, expected_qty) values ($1, $2, 4)`, [asn, itemId]);
    // a packed order (written straight at its step, no stock movement) for the support request
    const box = (await db.query(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'E2E W5 carton', 100) returning id`, [BOX])).rows[0].id;
    const o = (await db.query(`insert into wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_address, ship_country, status, picked_at, box_id, expected_weight_g, tolerance_g, measured_weight_g)
      values ('FS-01', 'client_portal', $1, $2, 'Erika Muster', '{"line1": "Hauptstraße 5", "city": "Berlin", "postcode": "10115"}'::jsonb, 'DE', 'packing', now(), $3, 550, 50, 550) returning id, code`,
      [client.orgId, `E2E-W5-${n}`, box])).rows[0];
    await db.query(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, packed_qty, unit_weight_g) values ($1, $2, $3, 'E2E desk lamp', 1, 1, 1, 450)`, [o.id, itemId, SKU]);
    await db.query(`update wh_orders set status = 'packed', packed_at = now() where id = $1`, [o.id]);
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
  const returnPaths: string[] = [];
  const productPaths: string[] = [];
  try {
    await assertStagingDatabase(db);
    if (client) {
      returnPaths.push(...(await db.query(`select p.storage_path s from wh_return_photos p join wh_returns r on r.id = p.return_id where r.org_id = $1`, [client.orgId])).rows.map((r) => r.s as string));
      productPaths.push(...(await db.query(`select image_path s from wh_client_skus where org_id = $1 and image_path is not null`, [client.orgId])).rows.map((r) => r.s as string));
      await db.query(`delete from tickets where org_id = $1`, [client.orgId]); // messages and warehouse links cascade
      await db.query(`delete from wh_returns where org_id = $1`, [client.orgId]); // lines and photo rows cascade
      await db.query(`delete from wh_orders where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_lots where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_asns where org_id = $1`, [client.orgId]);
      if (itemId) {
        // book the remaining temporary units out so the product ends at 0 on hand / 0 reserved (the ledger stays, append-only)
        const st = (await db.query(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'FS-01' and item_id = $1`, [itemId])).rows[0];
        const free = st ? st.on_hand_qty - st.reserved_qty : 0;
        if (free > 0) await db.query(`select record_warehouse_stock_movement($1, 'adjust_out', $2, 'W5 E2E cleanup', 'FS-01', null)`, [itemId, free]);
      }
      await db.query(`delete from wh_client_skus where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_clients where org_id = $1`, [client.orgId]);
    }
    await db.query(`delete from wh_boxes where warehouse_code = 'FS-01' and code = $1`, [BOX]);
    if (recv) await db.query(`delete from warehouse_staff where user_id = $1`, [recv.id]);
  } finally {
    await db.end();
  }
  if (returnPaths.length) await adminClient().storage.from('wh-returns').remove(returnPaths);
  if (productPaths.length) await adminClient().storage.from('wh-products').remove(productPaths);
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  await deleteTempStaff(recv);
  await deleteTempStaff(admin);
});

test('W5 inventory: stock by product, days of cover unknown without history, product photo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, '/account/warehouse?tab=inventory');
  await page.goto('/account/warehouse?tab=inventory');
  await expect(page.getByTestId('wh-tab-inventory')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId(`wh-inv-onhand-${SKU}`)).toHaveText('5');
  await expect(page.getByTestId(`wh-inv-available-${SKU}`)).toHaveText('5');
  await expect(page.getByTestId(`wh-inv-incoming-${SKU}`)).toHaveText('4');
  await expect(page.getByTestId(`wh-inv-cover-${SKU}`)).toHaveText('Not enough history');
  await page.getByTestId(`wh-inv-select-${SKU}`).click();
  const detail = page.getByTestId('wh-inv-detail');
  await expect(detail).toContainText('E2E desk lamp');
  await expect(detail).toContainText('No photo yet');
  await expect(detail.getByTestId('wh-inv-wh-FS-01')).toContainText('5');
  await axeBoth(page, 'portal inventory');
  await page.getByTestId('wh-inv-photo-input').setInputFiles({ name: 'lamp.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('wh-inv-photo-msg')).toContainText('Photo saved.');
  await expect(detail.getByRole('img', { name: 'Photo of E2E desk lamp' })).toBeVisible();
  await expect(page.getByTestId(`wh-inv-row-${SKU}`).locator('img')).toHaveCount(1);
  await page.goto('/account/warehouse');
  await expect(page.getByTestId('wh-portal-units-in-stock')).toContainText('5');
});

test('W5 staff registers two returns, photographs and grades them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, recv!, '/office/warehouse/returns');
  await page.goto('/office/warehouse/returns');
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Returns' })).toHaveAttribute('aria-current', 'page');
  const reg = page.getByTestId('wh-rt-register');
  const register = async (qty: string) => {
    await reg.getByLabel('Client', { exact: true }).selectOption(client!.orgId);
    await reg.getByLabel('Product 1', { exact: true }).selectOption({ label: `${SKU} · E2E desk lamp` });
    await reg.getByLabel('Units of product 1', { exact: true }).fill(qty);
    await reg.getByLabel('Reason given (optional)').fill('Customer changed their mind');
    const msg = page.getByTestId('wh-rt-register-msg');
    const before = (await msg.count()) ? ((await msg.innerText()).match(/RT-\d{4,}/) ?? [''])[0] : '';
    await page.getByTestId('wh-rt-register-submit').click();
    // wait for a NEW code (the message from the previous registration is still on screen until the action returns)
    await expect.poll(async () => ((await msg.innerText().catch(() => '')).match(/RT-\d{4,}/) ?? [''])[0]).not.toBe(before);
    await expect(msg).toContainText(/Return RT-\d{4,} registered/);
    return ((await msg.innerText()).match(/RT-\d{4,}/) ?? [''])[0];
  };
  const inspect = async (code: string, qty: number, condition: string) => {
    const card = page.getByTestId(`wh-rt-${code}`);
    await expect(card).toBeVisible();
    await page.getByTestId(`wh-rt-photo-input-${code}`).setInputFiles({ name: 'return.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId(`wh-rt-photo-msg-${code}`)).toContainText('Photo saved.');
    await expect(page.getByTestId(`wh-rt-photos-${code}`).locator('img')).toHaveCount(1);
    const cond = card.getByLabel(new RegExp(`^Condition of ${SKU} \\(`));
    await expect(cond).toHaveCount(1);
    await expect(card).toContainText(`${qty} unit${qty === 1 ? '' : 's'}`);
    await cond.selectOption(condition);
    await card.getByLabel('Inspection notes (the client reads these)').fill(condition === 'good' ? 'Unused, original box' : 'Base cracked');
    await page.getByTestId(`wh-rt-inspect-${code}`).click();
    await expect(page.getByTestId(`wh-rt-inspect-msg-${code}`)).toContainText('inspected');
    await expect(page.getByTestId(`wh-rt-status-${code}`)).toContainText('Waiting for the client');
  };
  codeA = await register('2');
  await inspect(codeA, 2, 'good');
  codeB = await register('1');
  await inspect(codeB, 1, 'damaged');
  expect(codeA).not.toBe(codeB);
  await axeBoth(page, 'staff returns (waiting for the client)');
});

test('W5 client decides: restock one return, send back the other', async ({ page }) => {
  test.skip(!codeA || !codeB, 'no returns');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, '/account/warehouse?tab=returns');
  await page.goto('/account/warehouse?tab=returns');
  const a = page.getByTestId(`wh-return-${codeA}`);
  await expect(page.getByTestId(`wh-return-status-${codeA}`)).toContainText('Waiting for your decision');
  await expect(a).toContainText('Unused, original box');
  await expect(a.getByRole('img', { name: `Inspection photo 1 of ${codeA}` })).toBeVisible();
  await axeBoth(page, 'portal returns (waiting)');
  await a.getByRole('radio', { name: /^Restock/ }).check();
  await page.getByTestId(`wh-return-submit-${codeA}`).click();
  await expect(page.getByTestId(`wh-return-msg-${codeA}`)).toContainText('restock chosen');

  const b = page.getByTestId(`wh-return-decide-${codeB}`);
  await b.getByRole('radio', { name: /^Restock/ }).check();
  await expect(page.getByTestId(`wh-return-submit-${codeB}`)).toBeDisabled();
  await expect(b).toContainText('No unit passed inspection');
  await b.getByRole('radio', { name: /^Send back to me/ }).check();
  await b.getByLabel('Name *', { exact: true }).fill('E2E Lamps HQ');
  await b.getByLabel('Country code *', { exact: true }).fill('AE');
  await b.getByLabel('Address *', { exact: true }).fill('1 Sheikh Zayed Road');
  await b.getByLabel('City *', { exact: true }).fill('Dubai');
  await page.getByTestId(`wh-return-submit-${codeB}`).click();
  await expect(page.getByTestId(`wh-return-msg-${codeB}`)).toContainText('send back chosen');
  await page.reload();
  await expect(page.getByTestId(`wh-return-outcome-${codeA}`)).toContainText('2 good units go back into stock');
  await expect(page.getByTestId(`wh-return-outcome-${codeB}`)).toContainText('will be sent back');
  await axeBoth(page, 'portal returns (decided)');
});

test('W5 staff carries out the decisions: restock lot and send-back order', async ({ page, browser }) => {
  test.skip(!codeA || !codeB, 'no returns');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, recv!, '/office/warehouse/returns');
  await page.goto('/office/warehouse/returns');
  await expect(page.getByTestId(`wh-rt-decision-${codeA}`)).toContainText('Restock');
  await page.getByTestId(`wh-rt-complete-${codeA}`).click();
  await expect(page.getByTestId(`wh-rt-complete-msg-${codeA}`)).toContainText(/2 unit\(s\) back in stock as LOT-\d+/);
  await expect(page.getByTestId(`wh-rt-decision-${codeB}`)).toContainText('to E2E Lamps HQ');
  await page.getByTestId(`wh-rt-complete-${codeB}`).click();
  await expect(page.getByTestId(`wh-rt-complete-msg-${codeB}`)).toContainText(/order WO-\d{6,} created and picked/);
  await page.goto('/office/warehouse/returns?status=done');
  await expect(page.getByTestId(`wh-rt-status-${codeA}`)).toContainText('Done');
  await expect(page.getByTestId(`wh-rt-${codeB}`)).toContainText('Send-back order WO-');
  await axeBoth(page, 'staff returns (done)');

  // the client's stock went up by the 2 restocked units (separate browser context: a different person)
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await p2.setViewportSize({ width: 1280, height: 1000 });
    await customerLogin(p2, client!, '/account/warehouse?tab=inventory');
    await p2.goto('/account/warehouse?tab=inventory');
    await expect(p2.getByTestId(`wh-inv-onhand-${SKU}`)).toHaveText('7');
  } finally {
    await ctx.close();
  }
});

test('W5 integrations: honest status for every platform, no connect buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, '/account/warehouse?tab=integrations');
  await page.goto('/account/warehouse?tab=integrations');
  const box = page.getByTestId('wh-integrations');
  await expect(page.getByTestId('wh-int-state-csv-upload')).toContainText('Available now');
  for (const p of ['shopify', 'woocommerce', 'wix', 'tiktok-shop', 'ebay', 'api-and-webhooks']) await expect(page.getByTestId(`wh-int-state-${p}`)).toContainText('Not available yet');
  for (const p of ['octopus-dropship', 'octopus-b2b', 'make-my-brand']) await expect(page.getByTestId(`wh-int-state-${p}`)).toContainText('Octopus service');
  await expect(box.getByRole('button')).toHaveCount(0);
  await expect(box.getByRole('link', { name: /connect/i })).toHaveCount(0);
  await expect(page.getByTestId('wh-int-csv-link')).toHaveAttribute('href', '/account/warehouse?tab=orders');
  await axeBoth(page, 'portal integrations');
});

test('W5 support: request about an order, thread links the packing record, the support desk sees it', async ({ page, browser }) => {
  test.skip(!orderCode, 'no order');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, `/account/warehouse?tab=support&ref=${orderCode}`);
  await page.goto(`/account/warehouse?tab=support&ref=${orderCode}`);
  const form = page.getByTestId('wh-support-form');
  await expect(form.getByLabel('Type of request *', { exact: true })).toHaveValue('order_problem');
  await expect(form.getByLabel('About (order, stock notice or return)', { exact: true })).toHaveValue(orderCode);
  await form.getByLabel('Subject *', { exact: true }).fill('Carton arrived crushed');
  await form.getByLabel('What happened? *', { exact: true }).fill('The customer sent a photo of a crushed carton. Please check the packing record.');
  await axeBoth(page, 'portal support (form)');
  await page.getByTestId('wh-support-submit').click();
  await expect(page.getByTestId('wh-support-msg')).toContainText(/Request TKT-\d+ sent/);
  ticketId = ((await page.getByTestId('wh-support-msg').getByRole('link', { name: 'Open the conversation' }).getAttribute('href')) ?? '').split('/').pop() ?? '';
  expect(ticketId).toMatch(/^[0-9a-f-]{36}$/);
  const code = ((await page.getByTestId('wh-support-msg').innerText()).match(/TKT-\d+/) ?? [''])[0];
  await expect(page.getByTestId(`wh-support-row-${code}`)).toContainText(orderCode);
  await page.goto(`/account/support/${ticketId}`);
  await expect(page.getByTestId('ticket-warehouse')).toContainText(orderCode);
  await expect(page.getByTestId('ticket-warehouse-proof')).toHaveAttribute('href', `/account/warehouse?tab=orders&order=${orderCode}`);

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await p2.setViewportSize({ width: 1280, height: 1000 });
    await staffLogin(p2, admin!, `/office/support?t=${ticketId}`);
    await p2.goto(`/office/support?t=${ticketId}`);
    await expect(p2.getByTestId('sd-warehouse')).toContainText('Order problem');
    await expect(p2.getByTestId('sd-warehouse-order')).toContainText(orderCode);
    await expect(p2.getByTestId('sd-warehouse-evidence')).toHaveAttribute('href', `/office/warehouse/evidence/${orderCode}`);
  } finally {
    await ctx.close();
  }
});
