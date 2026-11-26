import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pgClient } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
import { code128Bars } from '../../lib/barcode128';

/**
 * Warehouse OS · W2b E2E (STAGING ONLY) — boards 10 (putaway, pallets, bins) and 11 (label centre) + transfers.
 *  1. Bins: a receiver creates a rack-row-bin range (preview → 6 bins) and blocks one with a reason; a packer can't.
 *  2. Putaway: occupancy shows the blocked bin; a pallet (PAL-#####) is built; scan-friendly form (or its honest empty state).
 *  3. Transfers: a seeded draft can't be dispatched to a non-active warehouse (stays Draft, message shown), then is cancelled
 *     with a reason. (Dispatch / receive post stock movements, which are append-only on staging, so those paths — paired
 *     movements, FIFO picks, ledger totals — are covered by the rolled-back DB test.)
 *  4. Labels: bin and pallet labels render Code 128 barcodes (bars match the encoder), printing is logged and shown as
 *     printed; parcel labels are a W3 placeholder.
 *  5. axe clean at 1280 px and 390 px on every screen.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let receiver: TempStaff | null = null;
let packer: TempStaff | null = null;
const stamp = Date.now() % 100;
const RACK = `EZ${String(stamp).padStart(2, '0')}`;
const BINS = ['01-01', '01-02', '01-03', '02-01', '02-02', '02-03'].map((s) => `${RACK}-${s}`);
let palletCode = '';
let transfer: { id: string; code: string } | null = null;

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
  packer = await createTempStaff('warehouse');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'receiver'), ($2, 'FS-01', 'packer') on conflict do nothing`, [receiver.id, packer.id]);
    // a draft transfer to the legacy SZ-01 location (not active): no stock moves, dispatch is refused
    const item = (await db.query(`select id from item_master order by id limit 1`)).rows[0]?.id as string | undefined;
    if (item) {
      const t = (await db.query(`insert into wh_transfers (from_wh, to_wh, note, created_by) values ('FS-01', 'SZ-01', 'W2b E2E', $1) returning id, code`, [admin.id])).rows[0];
      await db.query(`insert into wh_transfer_lines (transfer_id, item_id, qty) values ($1, $2, 1)`, [t.id, item]);
      transfer = { id: t.id, code: t.code };
    }
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`delete from wh_label_prints where warehouse_code = 'FS-01' and (ref like $1 or ref = $2)`, [`${RACK}-%`, palletCode || '-']);
    if (palletCode) await db.query(`delete from wh_pallets where code = $1 and not exists (select 1 from wh_bin_stock b where b.pallet_id = wh_pallets.id)`, [palletCode]);
    await db.query(`delete from wh_bins where warehouse_code = 'FS-01' and code like $1 and not exists (select 1 from wh_bin_stock b where b.bin_id = wh_bins.id)`, [`${RACK}-%`]);
    if (transfer) await db.query(`delete from wh_transfers where id = $1 and status in ('draft', 'cancelled')`, [transfer.id]);
    for (const s of [receiver, packer]) if (s) await db.query(`delete from warehouse_staff where user_id = $1`, [s.id]);
  } finally {
    await db.end();
  }
  await deleteTempStaff(packer);
  await deleteTempStaff(receiver);
  await deleteTempStaff(admin);
});

test('W2b bins: range generator and block with a reason', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, receiver!, '/office/warehouse/putaway/bins');
  await page.goto('/office/warehouse/putaway/bins');
  await expect(page.getByTestId('wh-bins-page')).toBeVisible();
  const nav = page.getByTestId('warehouse-sidebar');
  await expect(nav.getByRole('link', { name: 'Putaway and pallets' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Label centre' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Transfers' })).toBeVisible();

  const form = page.getByTestId('wh-bin-range-form');
  await form.getByLabel('Rack').fill(RACK.toLowerCase());
  await form.getByLabel('Rows from').fill('1');
  await form.getByLabel('Rows to').fill('2');
  await form.getByLabel('Bins from').fill('1');
  await form.getByLabel('Bins to').fill('3');
  await expect(page.getByTestId('wh-bin-range-preview')).toContainText(`6 bin(s): ${BINS[0]} … ${BINS[5]}`);
  await form.getByLabel('Rows to').fill('99');
  await form.getByLabel('Bins to').fill('99');
  await expect(page.getByTestId('wh-bin-range-submit')).toBeDisabled();
  await expect(form).toContainText('Up to 500 bins at a time');
  await form.getByLabel('Rows to').fill('2');
  await form.getByLabel('Bins to').fill('3');
  await page.getByTestId('wh-bin-range-submit').click();
  await expect(page.getByTestId('wh-bin-range-msg')).toContainText(`6 bin(s) created (${BINS[0]} to ${BINS[5]})`);
  await page.getByTestId('wh-bin-range-submit').click();
  await expect(page.getByTestId('wh-bin-range-msg')).toContainText('6 already existed');

  const b3 = page.getByTestId(`wh-bin-${BINS[2]}`);
  await expect(b3).toContainText('Active');
  await b3.getByTestId('wh-bin-block-toggle').click();
  await expect(b3.getByTestId('wh-bin-block')).toBeDisabled();
  await b3.getByLabel('Why is it blocked?').fill('Damaged beam');
  await b3.getByTestId('wh-bin-block').click();
  await expect(b3).toContainText('Blocked: Damaged beam');
  await axeBoth(page, 'bins');
});

test('W2b putaway: occupancy, pallet, scan form; packers read only', async ({ page, browser }) => {
  await staffLogin(page, receiver!, '/office/warehouse/putaway');
  await page.goto('/office/warehouse/putaway');
  await expect(page.getByTestId('wh-putaway-page')).toBeVisible();
  await expect(page.getByTestId(`wh-bin-row-${BINS[2]}`)).toContainText('Blocked');
  await expect(page.getByTestId(`wh-bin-row-${BINS[0]}`)).toContainText('Empty');

  const pf = page.getByTestId('wh-pallet-form');
  await pf.getByLabel('Source').selectOption('');
  await pf.getByLabel('Owner').selectOption('');
  await pf.getByLabel('Note (optional)').fill('W2b E2E');
  await page.getByTestId('wh-pallet-create').click();
  await expect(page.getByTestId('wh-pallet-msg')).toContainText(/Pallet PAL-\d{5,} created/);
  palletCode = ((await page.getByTestId('wh-pallet-msg').innerText()).match(/PAL-\d{5,}/) ?? [''])[0];
  await expect(page.getByTestId(`wh-pallet-${palletCode}`)).toContainText('Octopus stock');
  await expect(page.getByTestId(`wh-pallet-${palletCode}`)).toContainText('Open · not in a bin');

  // the scan form when released lots wait at FS-01, otherwise its empty state (this run posts no stock)
  const form = page.getByTestId('wh-putaway-form');
  if (await form.isVisible()) {
    await form.getByLabel('Scan lot').fill('lot-99999999');
    await expect(form).toContainText('No lot with this code is waiting for putaway here.');
    await expect(page.getByTestId('wh-putaway-submit')).toBeDisabled();
  } else {
    await expect(page.getByTestId('wh-putaway-empty')).toContainText('Nothing to put away');
  }
  await axeBoth(page, 'putaway');

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await staffLogin(p2, packer!, '/office/warehouse/putaway');
    await p2.goto('/office/warehouse/putaway');
    await expect(p2.getByTestId('wh-pallets')).toContainText('Only receivers, supervisors and admins build pallets.');
    await p2.goto('/office/warehouse/putaway/bins');
    await expect(p2.getByTestId('wh-bins-readonly')).toBeVisible();
    await expect(p2.getByTestId(`wh-bin-${BINS[0]}`).getByTestId('wh-bin-block-toggle')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('W2b transfers: a draft that can’t be dispatched is cancelled with a reason', async ({ page }) => {
  test.skip(!transfer, 'no item_master row on staging to seed a draft');
  await staffLogin(page, admin!, '/office/warehouse/transfers');
  await page.goto('/office/warehouse/transfers');
  await expect(page.getByTestId('wh-transfers-page')).toBeVisible();
  await expect(page.getByTestId('wh-transfer-new')).toContainText(/Transfers need a second active warehouse|Save draft|no available stock/);
  const row = page.getByTestId(`wh-transfer-${transfer!.code}`);
  await expect(row.getByTestId('wh-transfer-status')).toContainText('Draft');
  await expect(row).toContainText('W2b E2E');
  await axeBoth(page, 'transfers');
  await row.getByTestId('wh-transfer-dispatch').click();
  await expect(row.getByTestId('wh-transfer-row-msg')).toContainText('SZ-01 is not an active warehouse');
  await expect(row.getByTestId('wh-transfer-status')).toContainText('Draft');
  await row.getByTestId('wh-transfer-cancel-toggle').click();
  await expect(row.getByTestId('wh-transfer-cancel')).toBeDisabled();
  await row.getByLabel('Why is it cancelled?').fill('E2E: wrong destination');
  await row.getByTestId('wh-transfer-cancel').click();
  const closed = page.getByTestId('wh-transfers-closed').getByTestId(`wh-transfer-${transfer!.code}`);
  await expect(closed.getByTestId('wh-transfer-status')).toContainText('Cancelled');
  await expect(closed).toContainText('Cancelled: E2E: wrong destination');
  await expect(closed.getByTestId('wh-transfer-dispatch')).toHaveCount(0);
});

test('W2b labels: bin and pallet barcodes, print log, parcel placeholder', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __prints: number }).__prints = 0; window.print = () => { (window as unknown as { __prints: number }).__prints++; }; });
  await staffLogin(page, receiver!, '/office/warehouse/labels?kind=bin');
  await page.goto('/office/warehouse/labels?kind=bin');
  await expect(page.getByTestId('wh-label-kind-bin')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('wh-label-print')).toBeDisabled();
  for (const code of BINS.slice(0, 2)) await page.getByTestId(`wh-label-row-${code}`).getByRole('checkbox').check();
  await page.getByLabel('Copies of each').fill('2');
  const sheet = page.getByTestId('wh-label-sheet');
  await expect(sheet.locator(`[data-barcode="${BINS[0]}"]`)).toHaveCount(2);
  await expect(sheet.locator('svg[role="img"]')).toHaveCount(4);
  const bars = await sheet.locator(`[data-barcode="${BINS[0]}"]`).first().locator('rect').count();
  expect(bars).toBe(code128Bars(BINS[0]).bars.length);
  await expect(sheet.getByRole('img', { name: `Barcode ${BINS[1]}` }).first()).toBeVisible();
  await axeBoth(page, 'labels (bins)');
  await page.getByTestId('wh-label-print').click();
  await expect(page.getByTestId('wh-label-msg')).toContainText('2 label(s) logged × 2 copies');
  expect(await page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
  await expect(page.getByTestId(`wh-label-row-${BINS[0]}`)).toContainText('Printed 1×');
  await expect(page.getByTestId('wh-label-log')).toContainText(BINS[0]);
  await expect(page.getByTestId('wh-label-print')).toContainText('Reprint 2 labels');

  await page.getByTestId('wh-label-kind-pallet').click();
  if (palletCode) {
    await page.getByTestId(`wh-label-row-${palletCode}`).getByRole('checkbox').check();
    await expect(page.getByTestId('wh-label-sheet').locator(`[data-barcode="${palletCode}"]`)).toHaveCount(2); // "Copies of each" stays at 2 from the bin sheet
    await expect(page.getByTestId('wh-label-sheet')).toContainText('Octopus stock');
  }
  await page.getByTestId('wh-label-kind-carton').click();
  await expect(page.getByTestId('wh-label-picker')).toContainText('One label per stock notice line');
  await page.getByTestId('wh-label-kind-parcel').click();
  await expect(page.getByTestId('wh-label-parcel')).toContainText('Parcel labels come with packing');
  await axeBoth(page, 'labels (parcel)');
});
