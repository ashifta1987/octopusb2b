import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W2a E2E (STAGING ONLY) — boards 20 (portal Send stock), 15 (dock), 5 (receiving), 16 (counts).
 *  1. Client: add a product inline, send a stock notice (ASN-####); Overview shows the units on their way in.
 *  2. Dock: book the notice; a double booking is refused (form keeps its input); a slot with no ASN can't be checked in;
 *     check in → unloading; Done waits for the count.
 *  3. Receiving: a count that differs needs a recount by a different person; still different → blocked lot; the
 *     receiver can't approve; serial scan refuses duplicates. (Approval itself is covered by the DB test, so this run
 *     posts no stock movement — staging movements are append-only.)
 *  4. axe clean at 1280 px and 390 px.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let receiver: TempStaff | null = null;
let client: TempCustomer | null = null;
const stamp = Date.now() % 1_000_000;
const SKU = `E2E-${stamp}`;
const DOCK = `E${stamp % 100000}`;
let asnCode = '';
// tomorrow at the warehouse (China time)
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + 86_400_000));

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
  receiver = await createTempStaff('warehouse');
  client = await createTempCustomer('w2ae2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'receiver') on conflict do nothing`, [receiver.id]);
    await db.query(`insert into wh_clients(org_id, plan_code, preferred_warehouse) values ($1, 'standard', 'FS-01') on conflict do nothing`, [client.orgId]);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'warehouse', 'on') on conflict (org_id, service) do update set status = 'on'`, [client.orgId]);
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
      const items = (await db.query(`select item_id from wh_client_skus where org_id = $1`, [client.orgId])).rows.map((r) => r.item_id as string);
      await db.query(`delete from wh_dock_slots where asn_id in (select id from wh_asns where org_id = $1) or (warehouse_code = 'FS-01' and dock = $2)`, [client.orgId, DOCK]);
      await db.query(`delete from wh_lots where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_asns where org_id = $1`, [client.orgId]);
      await db.query(`delete from wh_client_skus where org_id = $1`, [client.orgId]);
      // no stock was posted for these items (see the header), so their item_master rows can go too
      await db.query(`delete from item_master i where i.id = any($1::uuid[]) and not exists (select 1 from warehouse_stock s where s.item_id = i.id)`, [items]);
      await db.query(`delete from wh_clients where org_id = $1`, [client.orgId]);
    }
    if (receiver) await db.query(`delete from warehouse_staff where user_id = $1`, [receiver.id]);
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  await deleteTempStaff(receiver);
  await deleteTempStaff(admin);
});

test('W2a portal: add a product and send a stock notice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await customerLogin(page, client!, '/account/warehouse?tab=send');
  await page.goto('/account/warehouse?tab=send');
  await expect(page.getByTestId('wh-send')).toBeVisible();
  await expect(page.getByTestId('wh-tab-send')).toHaveAttribute('aria-current', 'page');
  const send = page.getByTestId('wh-send-submit');
  await expect(send).toBeDisabled();
  await page.getByTestId('wh-add-sku-toggle').click();
  const add = page.getByTestId('wh-add-sku');
  await add.getByLabel('SKU *').fill(SKU);
  await add.getByLabel('Product name *').fill('Desk lamp E2E');
  await add.getByLabel('Weight (g)').fill('450');
  await add.getByTestId('wh-add-sku-save').click();
  await expect(page.getByTestId('wh-add-sku-msg')).toContainText('Product added');
  await page.getByLabel('Product 1', { exact: true }).selectOption({ label: `${SKU} · Desk lamp E2E` });
  await page.getByLabel('Units of product 1').fill('12');
  await page.getByLabel('Arrival date *').fill(tomorrow);
  await page.getByLabel('Cartons').fill('2');
  await page.getByLabel('Note for the warehouse').fill('W2a E2E');
  await expect(send).toBeEnabled();
  await axeBoth(page, 'send stock');
  await send.click();
  await expect(page.getByTestId('wh-send-msg')).toContainText(/Stock notice ASN-\d{4,} sent/);
  asnCode = ((await page.getByTestId('wh-send-msg').innerText()).match(/ASN-\d{4,}/) ?? [''])[0];
  expect(asnCode).toMatch(/^ASN-\d{4,}$/);
  await expect(page.getByTestId(`wh-asn-${asnCode}`)).toContainText('Submitted');
  await page.goto('/account/warehouse');
  await expect(page.getByTestId('wh-portal-stock-on-its-way-in')).toContainText('12');
  await expect(page.getByTestId('wh-portal-stock-on-its-way-in')).toContainText('1 open stock notice');
  await axeBoth(page, 'portal overview');
});

test('W2a dock: double booking refused, no ASN no check-in', async ({ page }) => {
  await staffLogin(page, admin!, '/office/warehouse/dock');
  await page.goto(`/office/warehouse/dock?day=${tomorrow}`);
  const form = page.getByTestId('wh-dock-book');
  const whSelect = form.getByLabel('Warehouse');
  if (await whSelect.count()) await whSelect.selectOption('FS-01');
  await form.getByLabel('Dock', { exact: true }).fill(DOCK);
  await form.getByLabel('From', { exact: true }).fill('10:00');
  await form.getByLabel('To', { exact: true }).fill('11:00');
  const asnSelect = form.getByLabel('Stock notice');
  const value = await asnSelect.locator('option', { hasText: asnCode }).getAttribute('value');
  await asnSelect.selectOption(value!);
  await page.getByTestId('wh-dock-book-submit').click();
  await expect(page.getByTestId('wh-dock-book-msg')).toContainText('Slot booked');

  await form.getByLabel('From', { exact: true }).fill('10:30');
  await form.getByLabel('To', { exact: true }).fill('11:30');
  await page.getByTestId('wh-dock-book-submit').click();
  await expect(page.getByTestId('wh-dock-book-msg')).toContainText(`Dock ${DOCK} is already booked from 10:00 to 11:00`);
  await expect(form.getByLabel('Dock', { exact: true })).toHaveValue(DOCK);
  await expect(form.getByLabel('From', { exact: true })).toHaveValue('10:30');

  await form.getByLabel('From', { exact: true }).fill('12:00');
  await form.getByLabel('To', { exact: true }).fill('13:00');
  await page.getByTestId('wh-dock-book-submit').click();
  await expect(page.getByTestId('wh-dock-book-msg')).toContainText('Slot booked');
  const noAsn = page.getByTestId(`wh-slot-${DOCK}-12:00`);
  await expect(noAsn).toContainText('No ASN');
  await expect(noAsn.getByTestId('wh-slot-checkin')).toBeDisabled();
  await expect(noAsn).toContainText('No ASN — link a stock notice before check-in');

  const slot = page.getByTestId(`wh-slot-${DOCK}-10:00`);
  await expect(slot).toContainText(asnCode);
  await slot.getByTestId('wh-slot-checkin').click();
  await expect(slot).toContainText('Arrived');
  await slot.getByTestId('wh-slot-unload').click();
  await expect(slot).toContainText('Unloading');
  await expect(slot.getByTestId('wh-slot-done')).toBeDisabled();
  await expect(slot).toContainText('Count and accept every line first');
  await axeBoth(page, 'dock');
});

test('W2a receiving: recount by another person, blocked lot, serials', async ({ page, browser }) => {
  await staffLogin(page, admin!, `/office/warehouse/receive/${asnCode}`);
  await page.goto(`/office/warehouse/receive/${asnCode}`);
  await expect(page.getByTestId('wh-asn-status')).toContainText('Arrived');
  const line = page.getByTestId(`wh-line-${SKU}`);
  await expect(line.getByTestId('wh-line-expected')).toHaveText('12');
  await line.getByLabel('Good units', { exact: true }).fill('11');
  await line.getByLabel('Damaged units').fill('0');
  await line.getByTestId('wh-count-submit-1').click();
  await expect(line.getByTestId('wh-count-msg')).toContainText('A different person must recount');
  await expect(line).toContainText('Recount needed');
  await expect(line.getByTestId('wh-count-submit-2')).toBeDisabled();
  await expect(line).toContainText('You did the first count; a different person must recount');
  await axeBoth(page, 'receive');

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await staffLogin(p2, receiver!, `/office/warehouse/receive/${asnCode}`);
    await p2.goto(`/office/warehouse/receive/${asnCode}`);
    const l2 = p2.getByTestId(`wh-line-${SKU}`);
    await l2.getByLabel('Good units (recount)').fill('11');
    await l2.getByTestId('wh-count-submit-2').click();
    await expect(l2.getByTestId('wh-count-msg')).toContainText('blocked until a supervisor approves');
    await expect(l2).toContainText('Blocked');

    await p2.goto('/office/warehouse/counts');
    const blocked = p2.getByTestId('wh-blocked-list').locator('li', { hasText: SKU });
    await expect(blocked).toContainText('Only a supervisor or admin approves counts.');
    const serials = p2.getByTestId('wh-serial-form');
    const lotValue = await serials.getByLabel('Lot').locator('option', { hasText: SKU }).getAttribute('value');
    await serials.getByLabel('Lot').selectOption(lotValue!);
    await serials.getByLabel('Serials (scan one per line)').fill(`SN-${stamp}-1\nSN-${stamp}-2`);
    await p2.getByTestId('wh-serial-submit').click();
    await expect(p2.getByTestId('wh-serial-msg')).toContainText('2 serial(s) recorded');
    await serials.getByLabel('Serials (scan one per line)').fill(`SN-${stamp}-2\nSN-${stamp}-3`);
    await p2.getByTestId('wh-serial-submit').click();
    await expect(p2.getByTestId('wh-serial-msg')).toContainText(`SN-${stamp}-2 already recorded`);
    await expect(serials.getByLabel('Serials (scan one per line)')).toHaveValue(`SN-${stamp}-2\nSN-${stamp}-3`);
  } finally {
    await ctx.close();
  }

  await page.goto('/office/warehouse/counts');
  const lot = page.getByTestId('wh-blocked-list').locator('li', { hasText: SKU });
  const approve = lot.getByTestId('wh-approve-lot');
  await expect(approve).toBeDisabled();
  await lot.getByLabel('Reason').fill('Checked the cartons');
  await expect(approve).toBeEnabled();
  await axeBoth(page, 'counts');

  const ctx2 = await browser.newContext();
  const p3 = await ctx2.newPage();
  try {
    await customerLogin(p3, client!, '/account/warehouse?tab=send');
    await p3.goto('/account/warehouse?tab=send');
    await expect(p3.getByTestId(`wh-asn-${asnCode}`)).toContainText('Receiving');
    await expect(p3.getByTestId(`wh-asn-${asnCode}`).getByTestId('wh-asn-checking')).toContainText('11 unit(s) being checked');
  } finally {
    await ctx2.close();
  }
});
