import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W4 E2E (STAGING ONLY) — carriers and rules (board 9), labels + label check + hand-over with manifest
 * (board 13), label centre parcel tab (board 11), public tracking page (board 7), client portal tracking link. axe clean at
 * 1280 px and 390 px.
 *  1. A warehouse admin adds a SANDBOX 4PX account + service and proposes rules (DE → that service, same fallback); they can't
 *     approve their own proposal; a different admin (company admin) approves it.
 *  2. A packer makes the label of a packed order with the sandbox adapter (SBX… tracking number, PDF in the private bucket),
 *     scans a wrong label (refused, logged as an exception), then the right one (confirmed); the label is in the label centre.
 *  3. The packer starts a batch for the account, scans the label in and hands it over → manifest; the order is shipped.
 *  4. The public tracking page says "Packed and shipped from Foshan, China", shows the sandbox note and the hand-over event, and
 *     names no carrier / client / buyer; the client's portal Orders tab links to it.
 * Data: one packed order written straight at 'packed' (no stock movement). FS-01's active carrier-rule version (if any) is
 * superseded while the test runs and restored in afterAll (a waiting proposal is set aside and restored the same way). afterAll
 * removes the order (labels, scans, events cascade), the label PDFs (Storage API), the batch, our rule versions, service, account,
 * box, item, people and the client.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let whAdmin: TempStaff | null = null;
let packer: TempStaff | null = null;
let client: TempCustomer | null = null;
const n = `${Date.now() % 100000}`;
const ACC = `E2E 4PX sandbox ${n}`;
const SVC = `E2E-PX-${n}`;
const SVC_NAME = `E2E 4PX standard ${n}`;
const BOX = `EW4B${n.slice(-3)}`;
let itemId = '';
let orderCode = '';
let orderId = '';
let tracking = '';
let prevActive: string | null = null;
let prevPending: string | null = null;

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
  whAdmin = await createTempStaff('warehouse');
  packer = await createTempStaff('warehouse');
  client = await createTempCustomer('w4e2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'admin'), ($2, 'FS-01', 'packer') on conflict do nothing`, [whAdmin.id, packer.id]);
    await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01') on conflict do nothing`, [client.orgId]);
    prevActive = (await db.query(`select id from wh_carrier_rule_versions where warehouse_code = 'FS-01' and status = 'active'`)).rows[0]?.id ?? null;
    prevPending = (await db.query(`select id from wh_carrier_rule_versions where warehouse_code = 'FS-01' and status = 'pending_approval'`)).rows[0]?.id ?? null;
    if (prevPending) await db.query(`update wh_carrier_rule_versions set status = 'rejected', reject_reason = 'E2E W4: set aside while the test runs' where id = $1`, [prevPending]);
    itemId = (await db.query(`insert into item_master (weight_g, has_battery, has_liquid) values (450, false, false) returning id`)).rows[0].id;
    const box = (await db.query(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'E2E W4 carton', 100) returning id`, [BOX])).rows[0].id;
    // a packed order written straight at its step (nothing reserved or picked in the stock ledger); the W3b trigger makes parcel 1
    const o = (await db.query(`insert into wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_address, ship_country, status, picked_at, box_id,
        expected_weight_g, tolerance_g, measured_weight_g)
      values ('FS-01', 'client_portal', $1, $2, 'Erika Muster', '{"line1": "Hauptstraße 5", "city": "Berlin", "postcode": "10115"}'::jsonb, 'DE', 'packing', now(), $3, 550, 50, 550)
      returning id, code`, [client.orgId, `E2E-W4-${n}`, box])).rows[0];
    await db.query(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, packed_qty, unit_weight_g) values ($1, $2, $3, 'E2E desk lamp', 1, 1, 1, 450)`,
      [o.id, itemId, `E2E-W4-${n}`]);
    await db.query(`update wh_orders set status = 'packed', packed_at = now(), packed_by = $2 where id = $1`, [o.id, packer.id]);
    orderCode = o.code;
    orderId = o.id;
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
    if (orderId) {
      paths.push(...(await db.query(`select label_path p from wh_shipments where order_id = $1`, [orderId])).rows.map((r) => r.p as string));
      await db.query(`delete from wh_orders where id = $1`, [orderId]); // parcels, labels, scans, events, exceptions cascade
    }
    const acc = (await db.query(`select id from wh_carrier_accounts where warehouse_code = 'FS-01' and name = $1`, [ACC])).rows[0]?.id as string | undefined;
    const ours = [admin, whAdmin, packer].filter(Boolean).map((s) => s!.id);
    await db.query(`delete from wh_carrier_rule_versions where warehouse_code = 'FS-01' and (proposed_by = any($1::uuid[]) or approved_by = any($1::uuid[]))`, [ours]);
    if (acc) {
      await db.query(`delete from wh_dispatches where account_id = $1`, [acc]);
      await db.query(`delete from wh_carrier_rule_versions where fallback_service_id in (select id from wh_carrier_services where account_id = $1)
                        or id in (select version_id from wh_carrier_rules where service_id in (select id from wh_carrier_services where account_id = $1))`, [acc]);
      await db.query(`delete from wh_carrier_services where account_id = $1`, [acc]);
      await db.query(`delete from wh_carrier_accounts where id = $1`, [acc]);
    }
    if (prevActive && !(await db.query(`select 1 from wh_carrier_rule_versions where warehouse_code = 'FS-01' and status = 'active'`)).rowCount) {
      await db.query(`update wh_carrier_rule_versions set status = 'active' where id = $1`, [prevActive]);
    }
    if (prevPending) await db.query(`update wh_carrier_rule_versions set status = 'pending_approval', reject_reason = null where id = $1`, [prevPending]);
    await db.query(`delete from wh_boxes where warehouse_code = 'FS-01' and code = $1`, [BOX]);
    if (itemId) await db.query(`delete from item_master where id = $1`, [itemId]);
    if (client) await db.query(`delete from wh_clients where org_id = $1`, [client.orgId]);
    for (const s of [whAdmin, packer]) if (s) await db.query(`delete from warehouse_staff where user_id = $1`, [s.id]);
  } finally {
    await db.end();
  }
  if (paths.length) await adminClient().storage.from('wh-labels').remove(paths);
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  await deleteTempStaff(packer);
  await deleteTempStaff(whAdmin);
  await deleteTempStaff(admin);
});

test('W4 carriers: sandbox account + service, rules proposed by one admin and approved by another', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, whAdmin!, '/office/warehouse/carriers');
  await page.goto('/office/warehouse/carriers');
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Carriers and rules' })).toHaveAttribute('aria-current', 'page');
  const form = page.getByTestId('wh-account-form-FS-01');
  await form.getByLabel('Carrier').selectOption('4px');
  await form.getByLabel('Account name').fill(ACC);
  await form.getByLabel('Mode').selectOption('sandbox');
  await page.getByTestId('wh-account-submit-FS-01').click();
  await expect(page.getByTestId('wh-account-msg-FS-01')).toContainText('Account added');
  const row = page.getByTestId(/^wh-account-[0-9a-f-]{36}$/).filter({ hasText: ACC });
  await expect(row).toContainText('Sandbox · test labels only');
  await row.getByText(`Add a service to ${ACC}`).click();
  await row.getByLabel('Product code').fill(SVC);
  await row.getByLabel('Service name').fill(SVC_NAME);
  await row.getByLabel('Maximum weight (g)').fill('30000');
  await row.getByRole('button', { name: 'Add service' }).click();
  await expect(row.getByTestId(`wh-service-${SVC}`)).toContainText(SVC_NAME);

  const editor = page.getByTestId('wh-rules-editor-FS-01');
  while (await editor.getByRole('button', { name: /^Remove/ }).count()) await editor.getByRole('button', { name: /^Remove/ }).first().click();
  await page.getByTestId('wh-rule-add-FS-01').click();
  const r1 = page.getByTestId('wh-rule-row-FS-01-1');
  await r1.getByLabel('Rule 1 countries').fill('DE');
  await r1.getByLabel('Rule 1 service').selectOption({ label: `${SVC_NAME} (4PX)` });
  await editor.getByLabel('Fallback service').selectOption({ label: `${SVC_NAME} (4PX)` });
  await editor.getByLabel('Note for the approver').fill('E2E: DE parcels go with the sandbox 4PX service');
  const preview = page.getByTestId('wh-rules-preview-FS-01');
  await preview.getByLabel('Country').fill('DE');
  await expect(page.getByTestId('wh-rules-preview-FS-01-result')).toContainText(`Rule 1 (DE · any product · any weight) → ${SVC_NAME} (4PX)`);
  await page.getByTestId('wh-rules-propose-FS-01').click();
  await expect(page.getByTestId('wh-rules-msg-FS-01')).toContainText('A different admin approves it');
  await page.reload();
  const pending = page.getByTestId('wh-rules-pending-FS-01');
  await expect(pending).toContainText(SVC_NAME);
  await expect(page.getByTestId('wh-rules-approve-FS-01')).toBeDisabled();
  await expect(pending).toContainText('You proposed these rules; a different admin approves them.');
  await axeBoth(page, 'carriers (waiting for approval)');

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await p2.setViewportSize({ width: 1280, height: 1000 });
    await staffLogin(p2, admin!, '/office/warehouse/carriers');
    await p2.goto('/office/warehouse/carriers');
    await p2.getByTestId('wh-rules-approve-FS-01').click();
    await expect(p2.getByTestId('wh-rules-decide-msg-FS-01')).toContainText('approved');
    await p2.reload();
    const active = p2.getByTestId('wh-rules-active-FS-01');
    await expect(active).toContainText(SVC_NAME);
    await active.getByLabel('Country').fill('DE');
    await expect(p2.getByTestId('wh-rules-try-FS-01-result')).toContainText(`→ ${SVC_NAME} (4PX)`);
    await axeBoth(p2, 'carriers (rules in use)');
  } finally {
    await ctx.close();
  }
});

test('W4 label with the sandbox adapter, label check refuses a wrong label then confirms the right one', async ({ page }) => {
  test.skip(!orderCode, 'no order');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, packer!, '/office/warehouse/dispatch');
  await page.goto('/office/warehouse/dispatch');
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Dispatch and freight' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId(`wh-dispatch-order-${orderCode}`)).toBeVisible();
  await page.getByTestId(`wh-label-make-${orderCode}-1`).click();
  await expect(page.getByTestId('wh-label-msg')).toContainText(`SANDBOX label SBXPX`);
  await expect(page.getByTestId('wh-label-msg')).toContainText(SVC_NAME);
  await page.reload();
  tracking = ((await page.getByTestId(`wh-label-info-${orderCode}-1`).textContent()) ?? '').trim();
  expect(tracking).toMatch(/^SBXPX\d{12}$/);
  await expect(page.getByTestId(`wh-label-print-${orderCode}-1`)).toHaveAttribute('href', /wh-labels/);

  const check = page.getByTestId('wh-label-check');
  await check.getByLabel('Order number').fill(orderCode);
  await check.getByLabel('Scan the label').fill('WRONG00001');
  await page.getByTestId('wh-label-check-submit').click();
  await expect(page.getByTestId('wh-label-check-msg')).toContainText('is not a label we printed');
  await expect(page.getByTestId('wh-label-check-msg')).toContainText('Logged as EX-');
  await check.getByLabel('Scan the label').fill(tracking);
  await page.getByTestId('wh-label-check-submit').click();
  await expect(page.getByTestId('wh-label-check-msg')).toContainText(`Label matches ${orderCode} parcel 1`);
  await page.reload();
  await expect(page.getByTestId(`wh-parcel-row-${orderCode}-1`)).toContainText('Label checked');
  await axeBoth(page, 'dispatch (label checked)');

  await page.goto('/office/warehouse/labels?kind=parcel');
  await expect(page.getByTestId(`wh-parcel-label-${tracking}`)).toContainText(orderCode);
  await expect(page.getByTestId(`wh-parcel-label-${tracking}`)).toContainText('Sandbox');
  await axeBoth(page, 'label centre (parcel labels)');
});

test('W4 hand-over batch with manifest ships the order', async ({ page }) => {
  test.skip(!tracking, 'no label');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, packer!, '/office/warehouse/dispatch');
  await page.goto('/office/warehouse/dispatch');
  // the option shows " · {warehouse}" when the person works in more than one warehouse
  const accSel = page.getByTestId('wh-handover').getByLabel('Carrier account');
  const accVal = await accSel.locator('option', { hasText: `4PX · ${ACC} (sandbox)` }).first().getAttribute('value');
  await accSel.selectOption(accVal!);
  await page.getByTestId('wh-dispatch-open').click();
  await expect(page.getByTestId('wh-dispatch-open-msg')).toContainText('started');
  const batch = page.getByTestId(/^wh-dispatch-DP-\d+$/).filter({ hasText: ACC });
  await expect(batch).toBeVisible();
  const code = ((await batch.getAttribute('data-testid')) ?? '').replace('wh-dispatch-', '');
  await batch.getByLabel(/Scan a label into/).fill(tracking);
  await page.getByTestId(`wh-dispatch-scan-${code}`).click();
  await expect(page.getByTestId(`wh-dispatch-msg-${code}`)).toContainText(`${orderCode} parcel 1 added to ${code}`);
  await expect(page.getByTestId(`wh-dispatch-line-${tracking}`)).toBeVisible();
  await axeBoth(page, 'dispatch (open batch)');
  await batch.getByLabel('Handed to (driver or pickup reference)').fill('E2E driver');
  await page.getByTestId(`wh-dispatch-close-${code}`).click();
  // the open batch closes and its manifest appears (the page refreshes after the hand-over)
  await expect(page.getByTestId(`wh-manifest-${code}`)).toBeVisible();
  await page.reload();
  const manifest = page.getByTestId(`wh-manifest-${code}`);
  await expect(manifest).toContainText(tracking);
  await expect(manifest).toContainText('E2E driver');
  await expect(manifest).toContainText(`MF-${code.slice(3)}`);
  await expect(page.getByTestId(`wh-track-${tracking}`)).toContainText('Handed over');
  await axeBoth(page, 'dispatch (manifest)');
});

test('W4 public tracking page: packed and shipped from Foshan, white-label; the client portal links to it', async ({ page }) => {
  test.skip(!tracking, 'no label');
  const db = pgClient();
  await db.connect();
  let token = '';
  try {
    await assertStagingDatabase(db);
    token = (await db.query(`select tracking_token from wh_orders where id = $1 and status = 'shipped'`, [orderId])).rows[0]?.tracking_token ?? '';
  } finally {
    await db.end();
  }
  expect(token).toMatch(/^[0-9a-f]{36}$/);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/t/${token}`);
  const view = page.getByTestId('public-warehouse-tracking');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('tracking-shipped-from')).toContainText('Packed and shipped from Foshan, China');
  await expect(page.getByTestId('tracking-sandbox')).toContainText('SANDBOX');
  await expect(page.getByTestId('tracking-number-1')).toHaveText(tracking);
  await expect(page.getByTestId('tracking-events-list')).toContainText('Handed to the carrier');
  await expect(view).toContainText(`Order E2E-W4-${n}`);
  for (const hidden of [ACC, SVC, SVC_NAME, '4PX', 'YunExpress', 'Erika', 'Hauptstraße', 'E2E driver', 'FS-01']) await expect(view).not.toContainText(hidden);
  await axeBoth(page, 'public tracking');

  await customerLogin(page, client!, '/account/warehouse?tab=orders');
  await page.goto('/account/warehouse?tab=orders');
  await expect(page.getByTestId(`wh-portal-order-${orderCode}`)).toContainText('Shipped');
  await expect(page.getByTestId(`wh-tracking-link-${orderCode}`)).toHaveAttribute('href', `/t/${token}`);
});
