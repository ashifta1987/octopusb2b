import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, pgClient } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Release 1 · EA-1 E2E (STAGING ONLY) — design v2 StaffRateCards / StaffDutyEntries / StaffCompliance / StaffFees:
 *  1. 3PL staff import a carrier price list (paste → map → check → send for approval); the proposer can't approve;
 *     a Dropship editor approves and the cards go live; test quote shows billed weight; deactivate needs a reason.
 *  2. Duty: a Dropship editor drafts an entry (Verify); they can't confirm their own entry; Finance confirms; the draft
 *     is sent for approval; the preparer can't publish; Finance sends it back with a reason (nothing is published, so
 *     the staging duty table is untouched). The draft is deleted afterwards.
 *  3. Support: no Shipping rates in the menu, /office/dropship/rates is forbidden, fees and duty are read-only.
 *  4. axe (serious/critical) clean on rates, duty and fees at 1280 px and 390 px.
 * Everything created here is removed in afterAll (cards of carrier "ea1e2e", their imports, the duty draft).
 */
test.describe.configure({ mode: 'serial' });

const CARRIER = 'ea1e2e';
let wh: TempStaff | null = null;
let ds: TempStaff | null = null;
let fin: TempStaff | null = null;
let sup: TempStaff | null = null;
let originalFlag: { value: unknown }[] = [];
let draftVersionId = '';

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}

async function cleanup() {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`delete from shipping_rate_cards where carrier_code = $1`, [CARRIER]);
    const ids = [wh?.id, ds?.id].filter(Boolean);
    if (ids.length) await db.query(`delete from rate_card_imports where proposed_by = any($1::uuid[])`, [ids]);
    // drafts made by this spec's people (also when the test stopped before renaming the note)
    const people = [ds?.id, fin?.id].filter(Boolean);
    await db.query(`delete from duty_rate_entries where version_id in (select id from duty_rate_versions where status = 'draft' and (note like 'EA1 E2E%' or created_by = any($1::uuid[])))`, [people]);
    await db.query(`delete from duty_rate_versions where status = 'draft' and (note like 'EA1 E2E%' or created_by = any($1::uuid[]))`, [people]);
  } finally {
    await db.end();
  }
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  wh = await createTempStaff('warehouse');
  ds = await createTempStaff('operations');
  fin = await createTempStaff('finance');
  sup = await createTempStaff('support');
  const sb = adminClient();
  const { data: flag } = await sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui');
  originalFlag = (flag ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'EA-1 e2e' });
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('3PL'), 'manager') on conflict (user_id, division_id) do update set role = 'manager'`, [wh.id]);
    await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('DS'), 'staff') on conflict (user_id, division_id) do update set role = 'staff'`, [ds.id]);
    await db.query(`insert into carriers(code, name, active) values ($1, 'EA1 E2E Carrier', true) on conflict (code) do nothing`, [CARRIER]);
    const open = (await db.query(`select count(*)::int n from duty_rate_versions where status = 'draft'`)).rows[0].n as number;
    if (open > 0) throw new Error('A duty draft already exists on staging; finish or delete it before running this spec.');
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  await cleanup();
  const sb = adminClient();
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  const db = pgClient();
  await db.connect();
  try {
    await db.query(`delete from carriers where code = $1 and not exists (select 1 from shipping_rate_cards where carrier_code = $1)`, [CARRIER]);
  } finally {
    await db.end();
  }
  for (const t of [wh, ds, fin, sup]) await deleteTempStaff(t);
});

test('EA-1 rate cards: price list → second person approves → live; test quote; deactivate needs a reason', async ({ page, browser }) => {
  await staffLogin(page, wh!, '/office/dropship/rates');
  await page.goto('/office/dropship/rates');
  await expect(page.locator('h1')).toContainText('Shipping rates');
  await expect(page.getByTestId('dropship-staff-sidebar').getByRole('link', { name: 'Shipping rates' })).toHaveAttribute('aria-current', 'page');

  const csv = [
    'carrier_code,method,carrier_service_code,service_label,country,base_usd,per_100g_usd,step_g,max_weight_g,volumetric_divisor,days_min,days_max,battery,liquid,magnet,powder,fuel_pct,remote_area_fee_usd',
    `${CARRIER},economy,EA1-EC,EA1 Economy,AE,4.00,0.50,100,2000,5000,6,10,yes,no,no,no,10,`,
    `${CARRIER},express,EA1-EX,EA1 Express,KW,9.00,1.00,100,30000,5000,3,5,no,no,no,no,0,15.00`,
    `${CARRIER},express,EA1-BAD,Bad row,Kuwait,9.00,1.00,100,30000,5000,3,5,no,no,no,no,0,`,
  ].join('\n');
  await page.getByTestId('rate-csv-text').fill(csv);
  await page.getByTestId('rate-next-map').click();
  await expect(page.getByTestId('map-carrier_code')).toBeVisible();
  await page.getByTestId('rate-next-check').click();
  const check = page.getByTestId('rate-check');
  await expect(check).toBeVisible();
  await expect(page.getByTestId('check-rows-in-file')).toHaveText('3');
  await expect(page.getByTestId('check-new')).toHaveText('2');
  await expect(page.getByTestId('check-errors')).toHaveText('1');
  await expect(page.getByTestId('rate-download-errors')).toBeVisible();
  await page.getByTestId('rate-send-approval').click();
  await expect(page.getByTestId('rates-msg')).toContainText('Sent for approval');

  // the proposer can't approve their own change
  const waiting = page.getByTestId('rate-waiting');
  await expect(waiting).toContainText('2 new, 0 changed');
  await expect(waiting.getByRole('button', { name: 'Approve' }).first()).toBeDisabled();
  await expect(waiting).toContainText('You can’t approve a change you proposed.');
  const db = pgClient();
  await db.connect();
  try {
    expect(Number((await db.query(`select count(*) n from shipping_rate_cards where carrier_code = $1`, [CARRIER])).rows[0].n)).toBe(0);
  } finally {
    await db.end();
  }

  // a Dropship editor approves → both cards live
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await staffLogin(p2, ds!, '/office/dropship/rates');
    await p2.goto('/office/dropship/rates');
    const w2 = p2.getByTestId('rate-waiting');
    await w2.getByRole('button', { name: 'Approve' }).first().click();
    await expect(p2.getByTestId('rates-msg')).toContainText('Approved and published: 2 new');
    await expect(p2.getByTestId(`rate-card-${CARRIER}-economy-AE`)).toContainText('Active');
    await expect(p2.getByTestId(`rate-card-${CARRIER}-express-KW`)).toContainText('remote area US$ 15.00 may apply');

    // test quote: 22×16×11 ÷ 5000 = 0.78 kg → billed 0.8 kg; KW express 900 + 8×100 = US$17.00
    const tq = p2.getByTestId('test-quote');
    await tq.getByLabel('Country').selectOption('KW');
    await tq.getByLabel('Method').selectOption('express');
    await tq.getByLabel('Actual weight (g)').fill('500');
    await tq.getByLabel('Box L (cm)').fill('22');
    await tq.getByLabel('W (cm)').fill('16');
    await tq.getByLabel('H (cm)').fill('11');
    await tq.getByTestId('test-quote-run').click();
    const res = tq.getByTestId('test-quote-result').filter({ hasText: 'EA1-EX' });
    await expect(res).toContainText('0.8 kg (higher of the two, rounded up to 100 g)');
    await expect(res).toContainText('US$ 17.00');

    // deactivate needs a reason
    const row = p2.getByTestId(`rate-card-${CARRIER}-express-KW`);
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect(row.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
    await row.getByLabel('Reason').fill('EA1 E2E lane closed');
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect(p2.getByTestId('rates-msg')).toContainText('Deactivated');
    await p2.getByTestId('rate-filter-deactivated').click();
    await expect(p2.getByTestId(`rate-card-${CARRIER}-express-KW`)).toContainText('Deactivated');
  } finally {
    await ctx.close();
  }
});

test('EA-1 duty: own entry can’t be confirmed; Finance confirms; preparer can’t publish; sent back with a reason', async ({ page, browser }) => {
  await staffLogin(page, ds!, '/office/dropship/compliance');
  await page.goto('/office/dropship/compliance');
  await expect(page.locator('h1')).toContainText('Duty, tax and customs');
  await page.getByTestId('duty-new-version').click();
  await expect(page.getByTestId('duty-draft')).toBeVisible({ timeout: 15_000 });
  const db = pgClient();
  await db.connect();
  try {
    draftVersionId = (await db.query(`select id from duty_rate_versions where status = 'draft' order by version desc limit 1`)).rows[0].id;
    await db.query(`update duty_rate_versions set note = 'EA1 E2E ' || coalesce(note, '') where id = $1`, [draftVersionId]);
    // keep only our own test entry in the draft (copied entries are not part of this check)
    await db.query(`delete from duty_rate_entries where version_id = $1`, [draftVersionId]);
  } finally {
    await db.end();
  }
  await page.reload();
  await page.getByTestId('duty-add-entry').click();
  const form = page.getByTestId('duty-entry-form');
  await form.getByLabel('Country (2-letter code)').fill('QA');
  await form.getByLabel('Duty %').fill('5');
  await form.getByLabel('Import tax %').fill('0');
  await form.getByLabel('Source link').fill('https://example.com/qa-tariff');
  await form.getByLabel('Status').selectOption('confirmed');
  await page.getByTestId('duty-entry-save').click();
  await expect(page.getByTestId('compliance-msg')).toContainText('second person who checked the source');
  await form.getByLabel('Status').selectOption('verify');
  await page.getByTestId('duty-entry-save').click();
  await expect(page.getByTestId('compliance-msg')).toContainText('Entry saved');
  const confirmOwn = page.getByTestId('duty-confirm-QA-default');
  await expect(confirmOwn).toBeDisabled();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await staffLogin(p2, fin!, '/office/dropship/compliance');
    await p2.goto('/office/dropship/compliance');
    await p2.getByTestId('duty-confirm-QA-default').click();
    await expect(p2.getByTestId('duty-entry-QA-default')).toContainText('Confirmed');

    await page.reload();
    await page.getByTestId('duty-submit').click();
    await expect(page.getByTestId('duty-publish')).toBeVisible();
    await expect(page.getByTestId('duty-publish-approve')).toBeDisabled();

    await p2.reload();
    await p2.getByTestId('duty-publish-reject').click();
    await p2.getByLabel('Why is it sent back?').fill('EA1 E2E check the source date');
    await p2.getByRole('button', { name: 'Reject' }).click();
    await expect(p2.getByTestId('compliance-msg')).toContainText('Sent back to draft');
    await expect(p2.getByTestId('duty-publish')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
  const db2 = pgClient();
  await db2.connect();
  try {
    const v = (await db2.query(`select status, submitted_at, note from duty_rate_versions where id = $1`, [draftVersionId])).rows[0];
    expect(v.status).toBe('draft');
    expect(v.submitted_at).toBeNull();
    expect(v.note).toContain('Sent back: EA1 E2E check the source date');
  } finally {
    await db2.end();
  }
});

test('EA-1 Support: no rate cards; fees and duty read-only', async ({ page }) => {
  await staffLogin(page, sup!, '/office/dropship/fees');
  await page.goto('/office/dropship/fees');
  await expect(page.locator('h1')).toContainText('Fees and plans');
  await expect(page.getByText('Read only')).toBeVisible();
  await expect(page.getByTestId('propose-fee')).toHaveCount(0);
  await expect(page.getByTestId('dropship-staff-sidebar').getByRole('link', { name: 'Shipping rates' })).toHaveCount(0);
  await page.goto('/office/dropship/compliance');
  await expect(page.getByText('Read only')).toBeVisible();
  await expect(page.getByTestId('duty-new-version')).toHaveCount(0);
  await page.goto('/office/dropship/rates');
  await expect(page).toHaveURL(/\/forbidden/);
});

test('EA-1 axe: rates, duty and fees at 1280 px and 390 px', async ({ page }) => {
  await staffLogin(page, ds!, '/office/dropship/rates');
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ['/office/dropship/rates', '/office/dropship/compliance', '/office/dropship/fees', '/office/dropship/requests']) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      await checkAxe(page, `${route} @${w}`);
    }
  }
});
