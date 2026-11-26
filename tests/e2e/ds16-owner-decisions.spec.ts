import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * DS16 · Owner decisions (26 Nov 2026) E2E (STAGING ONLY). Desktop 1280 px and phone 390 px, axe clean (serious / critical).
 * One browser context per person. Everything the test changes is put back in afterAll (the markup through the same two-person flag
 * the migration uses, test rows deleted).
 *  1. Staff › Fees: the Shipping markup card — staff A proposes, cannot approve their own change; staff B approves; the value changes.
 *  2. Turnkey project: mark custom / branded → the next quote is sent with the 50 % deposit (frozen on the quote).
 *  3. Supplier packing slip of a Dropship order: the merchant's brand only (no Octopus, no merchant company, no prices).
 *  4. Supplier application: first approval by staff A, A cannot give the second, staff B approves → approved.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const SHOTS = process.env.DS16_SHOTS;
const BRAND = `E2E Brand ${stamp}`;
const ORDER_NO = `DS16-${stamp}`;
const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let staffA: TempStaff | null = null;
let staffB: TempStaff | null = null;
let merchant: TempCustomer | null = null;
let supplier: TempCustomer | null = null;
const ids = { supplier: '', so: '', partnerOrder: '', project: '', projectCode: '', quote: '', application: '' };
let markupBefore: unknown = undefined;
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];

async function sql<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    return (await db.query(q, p)).rows as T[];
  } finally {
    await db.end();
  }
}
/** writes a two-person setting the way the migration does (flag inside one transaction) — restore only */
async function restoreProtectedSetting(key: string, value: unknown) {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await db.query(`select set_config('octopus.ds16_setting_change', 'on', true)`);
    if (value === undefined) await db.query(`delete from site_settings where key = $1`, [key]);
    else await db.query(`update site_settings set value = $2::jsonb, updated_at = now() where key = $1`, [key, JSON.stringify(value)]);
    await db.query('commit');
  } finally {
    await db.end();
  }
}
async function checkAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}
async function noOverflow(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} must not overflow sideways`).toBe(true);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function bothWidths(page: Page, name: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect(page.locator('main:visible').first()).toBeVisible();
  await checkAxe(page, `${name} @1280`);
  await shot(page, `${name}-1280`);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, `${name} @390`);
  await checkAxe(page, `${name} @390`);
  await shot(page, `${name}-390`);
  await page.setViewportSize({ width: 1280, height: 1000 });
}
async function staffPage(browser: Browser, s: TempStaff, path: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  await staffLogin(p, s, path);
  await p.goto(path);
  return { ctx, p };
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const sb = adminClient();
  staffA = await createTempStaff('admin');
  staffB = await createTempStaff('admin');
  merchant = await createTempCustomer('ds16m');
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'DS16 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  markupBefore = (await sql<{ value: unknown }>(`select value from site_settings where key = 'dropship.shipping_markup_pct'`))[0]?.value;
  await sql(`update profiles set full_name = $2 where id = $1`, [staffA.id, `E2E DS16 Staff A ${stamp}`]);
  await sql(`update profiles set full_name = $2 where id = $1`, [staffB.id, `E2E DS16 Staff B ${stamp}`]);
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [merchant.orgId, merchant.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
  // the merchant's approved brand (DS12) — the slip shows it
  await sql(`insert into dropship_seller_profiles (org_id, brand_name, return_name, return_line1, return_city, return_country, status) values ($1, $2, 'E2E returns', '1 Test Road', 'Dubai', 'AE', 'approved')
    on conflict (org_id) do update set brand_name = excluded.brand_name, status = 'approved'`, [merchant.orgId, BRAND]);
  // supplier login (not staff, no organisation) + a partner order of this merchant
  const email = `e2e.supplier.ds16+${Date.now()}@demo.octopusb2b.com`;
  const password = `E2e-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 1000}!`;
  const { data: u, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !u.user) throw new Error(`createUser: ${error?.message}`);
  await sb.from('profiles').upsert({ id: u.user.id, full_name: 'E2E Supplier ds16', email });
  await sb.from('user_roles').insert({ user_id: u.user.id, role_code: 'supplier' });
  supplier = { id: u.user.id, email, password, orgId: '' };
  ids.supplier = (await sql<{ id: string }>(`insert into suppliers (legal_name, country, verified, user_id) values ($1, 'CN', true, $2) returning id`, [`DS16 E2E supplier ${stamp}`, u.user.id]))[0].id;
  await sql(`insert into supplier_switches (supplier_id, portal_login) values ($1, true) on conflict (supplier_id) do update set portal_login = true`, [ids.supplier]);
  ids.so = (await sql<{ id: string }>(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, buyer_phone, shipping_address, destination_country, buyer_currency, shipping_method, incoterm,
      product_cents, processing_cents, shipping_cents, total_cents, payment_state, staff_stage, merchant_status)
    values ($1, 'shopify', $2, $3, 'Ben Meyer', '+33123456789', '{"line1":"5 Rue Test","city":"Paris","postcode":"75001","country":"FR"}'::jsonb, 'FR', 'USD', 'standard', 'DDP', 1000, 120, 220, 1340, 'paid', 'sourcing', 'processing') returning id`,
    [merchant.orgId, `X-${stamp}`, ORDER_NO]))[0].id;
  ids.partnerOrder = (await sql<{ id: string }>(`insert into dropship_partner_orders (store_order_id, supplier_id) values ($1, $2) returning id`, [ids.so, ids.supplier]))[0].id;
  // a Turnkey project in Sourcing with a draft quote
  const p = (await sql<{ id: string; code: string }>(`insert into tk_client_projects (title, stage, status, org_id, country, city) values ($1, 'sourcing', 'open', $2, 'AE', 'Dubai') returning id, code`, [`DS16 E2E branded shop ${stamp}`, merchant.orgId]))[0];
  ids.project = p.id; ids.projectCode = p.code;
  ids.quote = (await sql<{ id: string }>(`insert into tk_client_quotes (project_id, version, status, total_cents, created_by) values ($1, 1, 'draft', 2000000, $2) returning id`, [p.id, staffA.id]))[0].id;
  await sql(`insert into tk_client_quote_lines (project_id, quote_id, line_no, description, qty, unit_price_cents, total_cents) values ($1, $2, 1, 'Branded shop fit-out', 1, 2000000, 2000000)`, [p.id, ids.quote]);
  // a supplier application waiting for review
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await db.query('set local role service_role');
    ids.application = (await db.query(`select submit_supplier_application($1::jsonb) v`, [JSON.stringify({ company_name: `DS16 E2E Factory ${stamp}`, city: 'Shenzhen', categories: ['Other'], contact_name: 'QA Li', contact_email: `ds16-${stamp}@example.com` })])).rows[0].v.id;
    await db.query('commit');
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const sb = adminClient();
  await restoreProtectedSetting('dropship.shipping_markup_pct', markupBefore);
  await sql(`delete from dropship_setting_changes where reason like $1`, [`%${stamp}%`]).catch(() => {});
  if (ids.application) await sql(`delete from supplier_applications where id = $1`, [ids.application]).catch(() => {});
  if (ids.project) await sql(`delete from tk_client_projects where id = $1`, [ids.project]).catch(() => {}); // quotes and lines cascade
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  await sql(`delete from dropship_seller_profiles where org_id = $1`, [merchant?.orgId || null]).catch(() => {});
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
  if (ids.supplier) {
    await sql(`delete from dropship_partner_orders where supplier_id = $1`, [ids.supplier]).catch(() => {});
    await sql(`delete from supplier_switches where supplier_id = $1`, [ids.supplier]).catch(() => {});
    await sql(`delete from suppliers where id = $1`, [ids.supplier]).catch((e) => console.warn('supplier cleanup', e.message));
  }
  if (supplier) {
    await sb.from('user_roles').delete().eq('user_id', supplier.id);
    await sb.auth.admin.deleteUser(supplier.id).catch(() => {});
  }
  await deleteTempStaff(staffA);
  await deleteTempStaff(staffB);
});

test('Staff Fees › Shipping markup @1280 + 390: proposed by one person, approved by another', async ({ browser }) => {
  const a = await staffPage(browser, staffA!, '/office/dropship/fees');
  const card = a.p.getByTestId('shipping-markup-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('markup-current')).toContainText(`${Number(markupBefore ?? 10)}%`);
  await bothWidths(a.p, 'ds16-markup-card');
  const next = Number(markupBefore ?? 10) === 11 ? 12 : 11;
  await card.getByLabel('New markup (%)').fill(String(next));
  await card.getByLabel('Reason').fill(`E2E carrier season ${stamp}`);
  await card.getByTestId('markup-propose').click();
  await expect(card.getByTestId('markup-msg')).toContainText('different Finance approver');
  await a.p.reload();
  await expect(card.getByTestId('markup-pending')).toContainText(`→ ${next}%`);
  await expect(card.getByTestId('markup-own-note')).toBeVisible();
  await expect(card.getByTestId('markup-approve')).toHaveCount(0); // the proposer gets no approve button (the database refuses too)
  await bothWidths(a.p, 'ds16-markup-pending');
  await a.ctx.close();

  const b = await staffPage(browser, staffB!, '/office/dropship/fees');
  const cardB = b.p.getByTestId('shipping-markup-card');
  await cardB.getByTestId('markup-approve').click();
  await expect(cardB.getByTestId('markup-msg')).toContainText('Approved');
  await b.p.reload();
  await expect(cardB.getByTestId('markup-current')).toContainText(`${next}%`);
  await expect(cardB.getByTestId('markup-history')).toContainText('Approved');
  const row = (await sql<{ status: string; proposed_by: string; decided_by: string }>(`select status, proposed_by, decided_by from dropship_setting_changes where reason like $1`, [`%${stamp}%`]))[0];
  expect(row).toEqual({ status: 'approved', proposed_by: staffA!.id, decided_by: staffB!.id });
  await b.ctx.close();
});

test('Turnkey project @1280 + 390: custom / branded order takes the 50 % deposit', async ({ browser }) => {
  const path = `/admin/turnkey/projects/${ids.projectCode}`;
  const a = await staffPage(browser, staffA!, path);
  const box = a.p.getByTestId('tk-custom-branded');
  await expect(box).toContainText('Order type: standard');
  await expect(box.getByTestId('tk-custom-deposit')).toContainText('30%');
  await box.getByTestId('tk-custom-reason').fill('Branded packaging and custom fixtures');
  await box.getByTestId('tk-custom-toggle').click();
  await expect(a.p.getByTestId('tk-custom-msg')).toContainText('Marked custom / branded');
  await expect(box).toContainText('Order type: custom / branded');
  await expect(box.getByTestId('tk-custom-deposit')).toContainText('50%');
  await bothWidths(a.p, 'ds16-turnkey-custom');
  await a.p.getByTestId('tk-quote-send').click();
  await expect(a.p.getByTestId('tk-quote-send-msg')).toContainText('Quote sent');
  await expect(a.p.getByTestId('tk-staff-quotes')).toContainText('50% · US$');
  const q = (await sql<{ deposit_pct: number; deposit_cents: string }>(`select deposit_pct, deposit_cents from tk_client_quotes where id = $1`, [ids.quote]))[0];
  expect(Number(q.deposit_pct)).toBe(50);
  expect(Number(q.deposit_cents)).toBe(1000000);
  await a.ctx.close();
});

test('Supplier packing slip @1280 + 390: the merchant\'s brand only', async ({ page }) => {
  await customerLogin(page, supplier!, '/supplier/orders');
  const main = page.locator('main:visible');
  await expect(main.getByRole('heading', { name: 'Orders to ship' })).toBeVisible();
  await bothWidths(page, 'ds16-supplier-orders');
  const slip = await page.request.get(`/api/dropship-supplier/packing-slip/${ids.partnerOrder}`);
  expect(slip.status()).toBe(200);
  const html = await slip.text();
  expect(html).toContain(BRAND);
  expect(html).toContain('Ben Meyer');
  expect(html).not.toContain('Octopus');
  expect(html).not.toContain('E2E Buyer ds16m');
  expect(html).not.toContain(ORDER_NO);
  expect(html).not.toMatch(/[$€£]\s?\d|\bUSD\b/i);
  // the slip itself is a page too: open it and check it at both widths
  await page.setContent(html);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, 'slip @390');
  await page.setViewportSize({ width: 1280, height: 1000 });
});

test('Supplier application @1280 + 390: two different people approve a new supplier', async ({ browser }) => {
  const path = `/office/kyc/supplier/${ids.application}`;
  const a = await staffPage(browser, staffA!, path);
  await a.p.getByRole('button', { name: 'Approve (first of two)' }).click();
  await a.p.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(a.p.getByTestId('supplier-first-approval')).toContainText('First approval by you');
  await expect(a.p.getByTestId('supplier-second-needed')).toBeVisible();
  await expect(a.p.getByRole('button', { name: /Give second approval/ })).toHaveCount(0);
  await bothWidths(a.p, 'ds16-supplier-first-approval');
  await a.ctx.close();
  expect((await sql<{ status: string }>(`select status from supplier_applications where id = $1`, [ids.application]))[0].status).toBe('in_review');

  const b = await staffPage(browser, staffB!, path);
  await expect(b.p.getByTestId('supplier-first-approval')).toContainText('Your approval is the second one');
  await b.p.getByRole('button', { name: 'Give second approval' }).click();
  await b.p.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(b.p.getByText('This application is approved')).toBeVisible();
  await bothWidths(b.p, 'ds16-supplier-approved');
  const row = (await sql<{ status: string; first_approved_by: string; reviewed_by: string }>(`select status, first_approved_by, reviewed_by from supplier_applications where id = $1`, [ids.application]))[0];
  expect(row).toEqual({ status: 'approved', first_approved_by: staffA!.id, reviewed_by: staffB!.id });
  await b.ctx.close();
});
