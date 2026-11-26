import { test, expect } from '@playwright/test';
import {
  adminClient,
  createTempCustomer,
  customerLogin,
  pgClient,
  purgeTestOrgs,
  type TempCustomer,
} from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Batch 3 E2E (STAGING ONLY):
 *  B3-3  Customer declines a Sourcing quote on /account/sourcing/[ref]; the pill shows the status_mappings label.
 *  B3-4  Unbuilt merchant pages say honestly what is coming ("Coming soon").
 *  B3-5  Dropship staff quote a merchant product request on /office/dropship/requests.
 *  B3-7  /request/factory-audit is its own request type; Admin › Services lists "Factory audit" with a price.
 *  B3-8  With dropship_v2_ui ON, /request/dropship and /go/dropship open the Dropship app.
 *  B3-11 /t/<unknown token> answers with a real HTTP 404.
 */
test.describe.configure({ mode: 'serial' });

let merchant: TempCustomer | null = null;
let dsStaff: TempStaff | null = null;
let admin: TempStaff | null = null;
let rfqId = '';
let rfqCode = '';
let quoteCode = '';
let dsReqId = '';
let dsReqCode = '';
let originalFlag: { value: unknown }[] = [];

test.beforeAll(async () => {
  await assertStagingOrThrow();
  merchant = await createTempCustomer('b3e2e');
  dsStaff = await createTempStaff('operations');
  admin = await createTempStaff('admin');
  const sb = adminClient();
  const { data: flag } = await sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui');
  originalFlag = (flag ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'Batch 3 e2e' });

  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on') on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
    await db.query(`insert into dropship_markets(org_id, country) values ($1, 'AE') on conflict do nothing`, [merchant.orgId]);
    await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('DS'), 'staff') on conflict (user_id, division_id) do update set role = 'staff'`, [dsStaff.id]);

    // Sourcing RFQ with one open quote (for the decline flow)
    const rfq = (await db.query(
      `insert into rfqs(org_id, title, quantity, unit, status, is_seed, created_by, division_id)
       values ($1, 'B3 E2E stainless bottles', 500, 'pcs', 'quoted', true, $2, division_id_of('SRC')) returning id, code`,
      [merchant.orgId, merchant.id],
    )).rows[0] as { id: string; code: string };
    rfqId = rfq.id;
    rfqCode = rfq.code;
    const supId = (await db.query(`select id from suppliers where archived_at is null and verified limit 1`)).rows[0].id as string;
    quoteCode = `QT-B3E2E-${Date.now()}`;
    await db.query(
      `insert into quotes(code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, status, valid_until, currency)
       values ($1, $2, $3, 450, 500, 'FOB', 25, 0, 'sent', now() + interval '10 days', 'USD')`,
      [quoteCode, rfqId, supId],
    );

    // Dropship product request created by the merchant (free, real RFQ code)
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: merchant.id, role: 'authenticated', aal: 'aal1' })]);
    await db.query('set local role authenticated');
    const req = (await db.query(
      `select public.create_dropship_product_request('B3 E2E Bamboo board', 'https://example.com/board', 'Kitchen', null, '50 to 200', array['AE'], false, null, '{}'::text[], $1) r`,
      [`b3e2e_${Date.now()}`],
    )).rows[0].r as { rfq_id: string; rfq_code: string };
    dsReqId = req.rfq_id;
    dsReqCode = req.rfq_code;
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', '', true)`);
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
  try {
    await assertStagingDatabase(db);
    if (merchant) {
      const rfqIds = [rfqId, dsReqId].filter(Boolean);
      await db.query(`delete from status_history where entity_id = any($1::uuid[]) or entity_id in (select id from quotes where rfq_id = any($1::uuid[]))`, [rfqIds]).catch(() => {});
      await db.query(`delete from quotes where rfq_id = any($1::uuid[])`, [rfqIds]);
      await db.query(`delete from dropship_products where sourced_from_rfq_id = any($1::uuid[])`, [rfqIds]);
      await db.query(`delete from dropship_product_requests where rfq_id = any($1::uuid[])`, [rfqIds]);
      await db.query(`delete from rfqs where id = any($1::uuid[])`, [rfqIds]);
      await db.query(`delete from dropship_markets where org_id = $1`, [merchant.orgId]);
    }
    if (dsStaff) await db.query(`delete from division_members where user_id = $1`, [dsStaff.id]);
  } finally {
    await db.end();
  }
  const sb = adminClient();
  if (originalFlag.length === 0) await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  else await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  if (merchant) await purgeTestOrgs([merchant.orgId], [merchant.id]);
  await deleteTempStaff(dsStaff);
  await deleteTempStaff(admin);
});

test('B3-3 customer declines a Sourcing quote; the status pill uses the status_mappings label', async ({ page }) => {
  await customerLogin(page, merchant!, `/account/sourcing/${rfqId}`);
  await page.goto(`/account/sourcing/${rfqId}`);
  await expect(page.getByTestId('request-status')).toHaveText('Quote ready');
  await page.getByTestId(`decline-quote-${quoteCode}`).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText(`Decline quote ${quoteCode}?`);
  await dlg.getByLabel('Reason (optional)').fill('Lead time too long');
  await dlg.getByRole('button', { name: 'Decline quote' }).click();
  await expect(page.getByTestId(`quote-state-${quoteCode}`)).toHaveText('Declined');
  const db = pgClient();
  await db.connect();
  try {
    const q = (await db.query(`select status::text s from quotes where code = $1`, [quoteCode])).rows[0];
    expect(q.s).toBe('rejected');
  } finally {
    await db.end();
  }
  await page.goto('/account/sourcing');
  await expect(page.getByText(rfqCode)).toBeVisible();
  await expect(page.locator('main')).not.toContainText('supplier code only');
});

test('B3-4 unbuilt merchant pages say what is coming', async ({ page }) => {
  // Release 2 · Step 6 built Pricing and sync; Release 5 built Plan and billing + Reports (tests/e2e/ds12-dropship.spec.ts).
  // Stores (Step 5, Shopify connection) is still a placeholder.
  await customerLogin(page, merchant!, '/account/dropship/stores');
  for (const path of ['/account/dropship/stores']) {
    await page.goto(path);
    await expect(page.getByTestId('planned-notice')).toContainText('Coming soon');
  }
});

test('B3-5 Dropship staff quote a merchant product request', async ({ page }) => {
  await staffLogin(page, dsStaff!, '/office/dropship/requests');
  await page.goto('/office/dropship/requests');
  // EA-1 (design v2 StaffRequests): the row opens a detail panel with the quote form
  await page.getByTestId('request-filter-new').click();
  const row = page.getByTestId(`staff-request-row-${dsReqCode}`);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Open ${dsReqCode}` }).click();
  const detail = page.getByTestId(`request-detail-${dsReqCode}`);
  await detail.getByLabel('Landed price per unit (US$)').fill('18.50');
  await detail.getByRole('button', { name: /Send quote/ }).click();
  await expect(detail).toContainText(`Quote sent on ${dsReqCode}`);
  const db = pgClient();
  await db.connect();
  try {
    const r = (await db.query(`select r.status::text s, d.quoted_landed_cents c from rfqs r join dropship_product_requests d on d.rfq_id = r.id where r.id = $1`, [dsReqId])).rows[0];
    expect(r.s).toBe('quoted');
    expect(Number(r.c)).toBe(1850);
  } finally {
    await db.end();
  }
});

test('B3-7 factory audit is its own request type and is listed in Admin › Services', async ({ page, browser }) => {
  await page.goto('/request/factory-audit');
  await expect(page.locator('h1')).toHaveText('Audit a factory before you order');
  await expect(page.getByLabel(/Audit type/)).toBeVisible();
  const ctx = await browser.newContext();
  const ap = await ctx.newPage();
  try {
    await staffLogin(ap, admin!, '/admin/services');
    await ap.goto('/admin/services');
    await expect(ap.locator('main')).toContainText('Factory audit');
  } finally {
    await ctx.close();
  }
});

test('B3-8 with Dropship open, /request/dropship and /go/dropship open the Dropship app', async ({ page }) => {
  await customerLogin(page, merchant!, '/account');
  await page.goto('/request/dropship');
  await expect(page).toHaveURL(/\/account\/dropship$/);
  await page.goto('/go/dropship');
  await expect(page).toHaveURL(/\/account\/dropship$/);
  await expect(page.getByTestId('dropship-active-start')).toBeVisible();
});

test('B3-11 an unknown public tracking link answers with a real 404', async ({ request }) => {
  const res = await request.get(`/t/unknown-${Date.now()}`);
  expect(res.status()).toBe(404);
});
