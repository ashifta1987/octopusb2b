import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
import { TEMPLATE_COLUMNS } from '../../lib/dropship-ds14-shared';

/**
 * Release 6 · Step 14 E2E (STAGING ONLY) — Match: v3 design SupplierProducts, SupplierNewProduct, SupplierBulkUpload, SupplierOrders, AdminApprovals,
 * AdminSuppliers, AdminPartners, AdminInvoicing, AdminDocs, Integrations, ConnectChannel. Desktop 1280 px and phone 390 px, axe clean.
 * One browser context per person (supplier, staff admin, merchant). No store is connected and nothing is sent anywhere: the connect buttons
 * are checked disabled with their reason. Plan fees stay as they are on staging (commission shows "does not apply" while they are off).
 *  1. Supplier products: stock saved and still there after a reload (waiting for the NEW value), cost change sent for review.
 *  2. Add product: draft saved, incomplete submit names the problems.
 *  3. Bulk upload: CSV preview with a row problem, submit the good row.
 *  4. Orders to ship: buyer address only (no merchant), Octopus slip, mark shipped → shipment + merchant label + store task waiting_store.
 *  5. Staff Approvals (ask for changes → the supplier sees the note), Suppliers, Sales partners (invite, rule), Invoicing (filter, CSV), Docs (upload, verify, signed link).
 *  6. Merchant Integrations / Connect a channel: disabled connect with the reason, waiting list, settings saved and kept.
 */
test.describe.configure({ mode: 'serial' });

const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
const stamp = Date.now().toString(36);
const SHOTS = process.env.DS14_SHOTS;
let merchant: TempCustomer | null = null;
let supplier: TempCustomer | null = null;
let admin: TempStaff | null = null;
const ids = { supplier: '', sp: '', partnerOrder: '', so: '', product: '', variant: '', item: '', submission: '' };
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];
let defaultRule: Record<string, unknown> | null = null;
const docPaths: string[] = [];
const PRODUCT_TITLE = `DS14 e2e fountain ${stamp}`;
const ORDER_NO = `DS14-${stamp}`;
const MERCHANT_NAME = `E2E Buyer ds14m LLC`;

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
/** both widths on the page that is open: axe + no sideways overflow */
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
  merchant = await createTempCustomer('ds14m');
  // the supplier is a login that is not staff and not a merchant (no organisation)
  const email = `e2e.supplier.ds14+${Date.now()}@demo.octopusb2b.com`;
  const password = `E2e-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 1000}!`;
  const { data: u, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !u.user) throw new Error(`createUser: ${error?.message}`);
  await sb.from('profiles').upsert({ id: u.user.id, full_name: 'E2E Supplier ds14', email });
  await sb.from('user_roles').insert({ user_id: u.user.id, role_code: 'supplier' });
  supplier = { id: u.user.id, email, password, orgId: '' };
  admin = await createTempStaff('admin');
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'DS14 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  defaultRule = (await sql(`select kind, rate_bps, fixed_cents, months, payout from dropship_partner_rules where partner_id is null`))[0] ?? null;
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [merchant.orgId, merchant.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
  const s = (await sql<{ id: string; code: string }>(`insert into suppliers (legal_name, country, verified, user_id) values ($1, 'CN', true, $2) returning id, code`, [`DS14 E2E supplier ${stamp}`, u.user.id]))[0];
  ids.supplier = s.id;
  await sql(`insert into supplier_switches (supplier_id, portal_login) values ($1, true) on conflict (supplier_id) do update set portal_login = true`, [s.id]);
  const prod = (await sql<{ id: string }>(`select id from products order by created_at limit 1`))[0];
  if (!prod) throw new Error('need one sourcing product on staging');
  ids.sp = (await sql<{ id: string }>(`insert into supplier_products (supplier_id, product_id, supplier_model, stock_qty) values ($1, $2, $3, 5) returning id`, [s.id, prod.id, `E2E-${stamp}`]))[0].id;
  await sql(`insert into supplier_product_prices (supplier_id, product_id, incoterm, moq_tier_min, variant_label, price_minor, currency, valid_from) values ($1, $2, 'EXW', 1, '', 690, 'USD', current_date - 30)`, [s.id, prod.id]);
  // a partner product + a paid order assigned to this supplier (the assign RPC itself is covered by the DB test)
  const dp = (await sql<{ id: string }>(`insert into dropship_products (title, description, category, weight_g, dimensions_cm, source_type, origin_country, status, is_test)
    values ($1, 'E2E', 'Pets', 400, '{"l":20,"w":10,"h":8}'::jsonb, 'partner_supplier', 'CN', 'draft', true) returning id`, [PRODUCT_TITLE]))[0];
  ids.product = dp.id;
  const v = (await sql<{ id: string; item_id: string; model_no: string }>(`insert into dropship_variants (product_id, options, cost_cents, supplier_product_id) values ($1, '{"Colour":"Black"}'::jsonb, 0, $2) returning id, item_id, model_no`, [dp.id, ids.sp]))[0];
  ids.variant = v.id; ids.item = v.item_id;
  ids.so = (await sql<{ id: string }>(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, buyer_phone, shipping_address, destination_country, buyer_currency, shipping_method, incoterm,
      product_cents, processing_cents, shipping_cents, total_cents, payment_state, staff_stage, merchant_status)
    values ($1, 'shopify', $2, $3, 'Ben Meyer', '+33123456789', '{"line1":"5 Rue Test","city":"Paris","postcode":"75001","country":"FR"}'::jsonb, 'FR', 'USD', 'standard', 'DDP', 1000, 100, 200, 1300, 'paid', 'sourcing', 'processing') returning id`, [merchant.orgId, `X-${stamp}`, ORDER_NO]))[0].id;
  await sql(`insert into store_order_items (store_order_id, product_id, variant_id, item_id, model_no, title_snapshot, variant_label, fulfilment_type, qty, unit_product_cents, line_product_cents, buyer_unit_price_cents, declared_usd_cents)
    values ($1, $2, $3, $4, $5, 'Test product', 'Black', 'extended_catalog', 1, 1000, 1000, 2000, 2000)`, [ids.so, dp.id, v.id, v.item_id, v.model_no]);
  ids.partnerOrder = (await sql<{ id: string }>(`insert into dropship_partner_orders (store_order_id, supplier_id) values ($1, $2) returning id`, [ids.so, s.id]))[0].id;
  // one submission waiting for review (a complete new product)
  ids.submission = (await sql<{ id: string }>(`insert into dropship_supplier_submissions (supplier_id, kind, status, summary, payload) values ($1, 'new_product', 'submitted', $2, $3::jsonb) returning id`, [s.id, `E2E lamp · LMP-${stamp}`,
    JSON.stringify({ name: 'E2E lamp', category: 'Lighting', description: 'A desk lamp for the e2e review.', supplier_sku: `LMP-${stamp}`, variants: [{ option: 'Default', sku: `LMP-${stamp}-1`, cost_cents: 500, stock: 3, weight_g: 300 }],
      images: ['https://i.example.com/1.jpg', 'https://i.example.com/2.jpg', 'https://i.example.com/3.jpg'], package: { weight_g: 400, length_cm: 20, width_cm: 10, height_cm: 8 }, customs: { hs_code: '940540', origin: 'CN', description_en: 'Desk lamp', battery: false, liquid: false }, terms: { moq: 1, lead_days: 5 } })]))[0].id;
});

test.afterAll(async () => {
  const sb = adminClient();
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  if (docPaths.length) await sb.storage.from('dropship-documents').remove(docPaths);
  await sql(`delete from dropship_product_documents where title like $1 or product_id = $2`, [`DS14 e2e%${stamp}`, ids.product || null]).catch(() => {});
  await sql(`delete from dropship_partners where contact_email like $1`, [`ds14-%${stamp}@test.local`]).catch(() => {});
  // the default commission rule the test saved goes back to what it was (nothing, or the owner's rule)
  await sql(`delete from dropship_partner_rules where partner_id is null`).catch(() => {});
  if (defaultRule) await sql(`insert into dropship_partner_rules (partner_id, kind, rate_bps, fixed_cents, months, payout) values (null, $1, $2, $3, $4, $5)`, [defaultRule.kind, defaultRule.rate_bps, defaultRule.fixed_cents, defaultRule.months, defaultRule.payout]).catch(() => {});
  // the order and its rows go with the merchant organisation (purge), then the supplier's own rows
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
  if (ids.supplier) {
    await sql(`delete from dropship_variants where id = $1`, [ids.variant || null]).catch(() => {});
    await sql(`delete from item_master where id = $1`, [ids.item || null]).catch(() => {});
    await sql(`delete from dropship_products where id = $1`, [ids.product || null]).catch(() => {});
    await sql(`delete from supplier_product_prices where supplier_id = $1`, [ids.supplier]).catch(() => {});
    await sql(`delete from supplier_products where supplier_id = $1`, [ids.supplier]).catch(() => {});
    await sql(`delete from supplier_switches where supplier_id = $1`, [ids.supplier]).catch(() => {});
    await sql(`delete from suppliers where id = $1`, [ids.supplier]).catch((e) => console.warn('supplier cleanup', e.message));
  }
  if (supplier) {
    await sb.from('user_roles').delete().eq('user_id', supplier.id);
    await sb.auth.admin.deleteUser(supplier.id).catch(() => {});
  }
  await deleteTempStaff(admin);
});

test('Supplier products @1280 + 390: stock saved and kept, cost change goes to review', async ({ page }) => {
  await customerLogin(page, supplier!, '/supplier');
  await expect(page.getByRole('heading', { name: 'Your products' })).toBeVisible();
  const main = page.locator('main:visible');
  const title = (await sql<{ title: string }>(`select p.title from products p join supplier_products sp on sp.product_id = p.id where sp.id = $1`, [ids.sp]))[0].title;
  const row = main.getByTestId('supplier-product-row').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  const rowStock = row.getByLabel(`Stock for ${title}`, { exact: true });
  await expect(rowStock).toHaveValue('5');
  await rowStock.fill('12');
  await row.getByRole('button', { name: `Save changes for ${title}`, exact: true }).click();
  await expect(row.getByText('Stock saved')).toBeVisible();
  await page.reload();
  await expect(main.getByTestId('supplier-product-row').filter({ hasText: title }).getByLabel(`Stock for ${title}`, { exact: true })).toHaveValue('12');
  expect(Number((await sql<{ stock_qty: number }>(`select stock_qty from supplier_products where id = $1`, [ids.sp]))[0].stock_qty)).toBe(12);
  const cost = main.getByTestId('supplier-product-row').filter({ hasText: title }).getByLabel(`Your cost for ${title}`, { exact: true });
  await cost.fill('9.99');
  await main.getByRole('button', { name: `Save changes for ${title}`, exact: true }).click();
  await expect(main.getByText('Cost change sent for review')).toBeVisible();
  await page.reload();
  await expect(main.getByTestId('supplier-submissions')).toContainText('Price');
  await bothWidths(page, 'supplier-products');
});

test('Add product @1280 + 390: draft saved, incomplete submit names the problems', async ({ page }) => {
  await customerLogin(page, supplier!, '/supplier/products/new');
  const main = page.locator('main:visible');
  await expect(main.getByRole('heading', { name: 'Add product' }).first()).toBeVisible();
  await main.getByLabel('Product name', { exact: true }).fill(`Draft ${stamp}`);
  await main.getByLabel('Model number', { exact: true }).fill(`DRAFT-${stamp}`);
  await main.getByRole('button', { name: 'Save as draft' }).click();
  await expect(main.getByTestId('supplier-product-msg')).toHaveText('Draft saved.');
  await main.getByRole('button', { name: 'Submit for review' }).click();
  await expect(main.getByRole('alert').filter({ hasText: 'Variants' })).toBeVisible();
  await bothWidths(page, 'supplier-new-product');
});

test('Bulk upload @1280 + 390: preview with a row problem, submit the good row', async ({ page }) => {
  await customerLogin(page, supplier!, '/supplier/products/import');
  const main = page.locator('main:visible');
  const head = TEMPLATE_COLUMNS.map(([, h]) => h).join(',');
  const good = [`BLK-${stamp}`, 'Bulk lamp', 'Lighting', 'Acme', 'A good bulk description', 'Default', `BLK-${stamp}-1`, '6.90', '10', '300', '10', '8', '6', '940540', 'CN', 'no', 'no', 'https://i.example.com/a.jpg|https://i.example.com/b.jpg|https://i.example.com/c.jpg', '3'];
  const bad = good.map((c, i) => (i === 0 ? `BLK2-${stamp}` : i === 6 ? `BLK2-${stamp}-1` : i === 13 ? '' : c));
  await main.getByTestId('supplier-import-file').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(`${head}\n${good.join(',')}\n${bad.join(',')}\n`) });
  await expect(main.getByTestId('supplier-import-summary')).toContainText('2 rows checked');
  await expect(main.getByTestId('supplier-import-problems')).toContainText('HS code');
  await expect(main.getByTestId('supplier-import-problems')).toContainText('3');
  await main.getByTestId('supplier-import-submit').click();
  await expect(main.getByTestId('supplier-import-done')).toContainText('1 good row sent for review');
  await bothWidths(page, 'supplier-bulk-upload');
});

test('Orders to ship @1280 + 390: buyer address only, Octopus slip, mark shipped', async ({ page }) => {
  await customerLogin(page, supplier!, '/supplier/orders');
  const main = page.locator('main:visible');
  await expect(main.getByRole('heading', { name: 'Orders to ship' })).toBeVisible();
  const row = main.getByTestId('supplier-order-row').first();
  await expect(row).toContainText(PRODUCT_TITLE);
  await row.getByRole('button', { name: /^Open order/ }).click();
  const detail = main.getByTestId('supplier-order-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('supplier-ship-to')).toContainText('Ben Meyer');
  await expect(detail.getByTestId('supplier-ship-to')).toContainText('5 Rue Test');
  await expect(page.locator('body')).not.toContainText(MERCHANT_NAME);
  await expect(page.locator('body')).not.toContainText(ORDER_NO);
  const slip = await page.request.get(`/api/dropship-supplier/packing-slip/${ids.partnerOrder}`);
  expect(slip.status()).toBe(200);
  const html = await slip.text();
  // DS16 (owner 26 Nov): a Dropship parcel carries the merchant's brand only — never Octopus (this merchant has no approved brand, so no brand line)
  expect(html).not.toContain('Octopus');
  expect(html).toContain('Ben Meyer');
  expect(html).not.toContain(MERCHANT_NAME);
  expect(html).not.toMatch(/[$€£]\s?\d|\bUSD\b/i);
  await detail.getByLabel('Tracking number', { exact: true }).fill('YT1234567890');
  await bothWidths(page, 'supplier-orders');
  await detail.getByTestId('supplier-mark-shipped').click();
  await expect(main.getByTestId('supplier-order-msg')).toContainText('Marked as shipped');
  const after = (await sql<{ status: string; merchant_status: string; task: string | null; trk: string | null }>(`select po.status, so.merchant_status,
      (select t.status from dropship_channel_tasks t where t.store_order_id = so.id and t.action = 'update_tracking') task,
      (select s.tracking_no from shipments s where s.store_order_id = so.id limit 1) trk
    from dropship_partner_orders po join store_orders so on so.id = po.store_order_id where po.id = $1`, [ids.partnerOrder]))[0];
  expect(after).toEqual({ status: 'shipped', merchant_status: 'shipped', task: 'waiting_store', trk: 'YT1234567890' });
  await page.reload();
  await main.getByRole('button', { name: 'Shipped (1)' }).click();
  await expect(main.getByTestId('supplier-order-row')).toContainText('Shipped');
});

test('Staff Approvals @1280 + 390: ask for changes, the supplier sees the note', async ({ browser, page }) => {
  const { ctx, p } = await staffPage(browser, admin!, '/office/dropship/approvals');
  const main = p.locator('main:visible');
  await expect(main.getByRole('heading', { name: 'Supplier approvals' })).toBeVisible();
  const row = main.getByTestId('approval-row').filter({ hasText: `LMP-${stamp}` });
  await expect(row).toHaveCount(1);
  await row.getByRole('link', { name: /^Review/ }).click();
  await expect(main.getByTestId('approval-detail')).toContainText('E2E lamp');
  await expect(main.getByTestId('approval-detail').getByRole('checkbox')).toHaveCount(6);
  await bothWidths(p, 'staff-approvals');
  await main.getByLabel('Note to supplier', { exact: true }).fill('Add a clearer main image');
  await main.getByRole('button', { name: 'Ask for changes' }).click();
  await expect(main.getByTestId('approvals-msg')).toContainText('Sent back to the supplier');
  expect((await sql<{ status: string }>(`select status from dropship_supplier_submissions where id = $1`, [ids.submission]))[0].status).toBe('changes_asked');
  await ctx.close();
  await customerLogin(page, supplier!, '/supplier');
  await expect(page.getByTestId('supplier-attention')).toContainText('Add a clearer main image');
});

test('Staff Suppliers + Sales partners @1280 + 390', async ({ browser }) => {
  const { ctx, p } = await staffPage(browser, admin!, '/office/dropship/suppliers');
  let main = p.locator('main:visible');
  await expect(main.getByTestId('partner-suppliers')).toContainText(`DS14 E2E supplier ${stamp}`);
  await expect(main.getByText('DSers and Alibaba are not connected yet')).toBeVisible();
  await bothWidths(p, 'staff-suppliers');
  await p.goto('/office/dropship/partners');
  main = p.locator('main:visible');
  await expect(main.getByTestId('partners-fees-off')).toContainText('Commission does not apply yet');
  await main.getByLabel('Partner name', { exact: true }).fill(`DS14 Agency ${stamp}`);
  await main.getByLabel('Contact email', { exact: true }).fill(`ds14-agency-${stamp}@test.local`);
  await main.getByRole('button', { name: 'Invite partner' }).click();
  await expect(main.getByTestId('partners-msg')).toContainText('PTR-');
  const prow = main.getByTestId('partner-row').filter({ hasText: `DS14 Agency ${stamp}` });
  await expect(prow).toContainText('Invited');
  await expect(prow).toContainText('$0.00');
  await main.getByLabel('Rate (%)', { exact: true }).fill('12.5');
  await main.getByLabel('Paid for how many months', { exact: true }).fill('3');
  await main.getByRole('button', { name: 'Save rules' }).click();
  await expect(main.getByTestId('partners-msg')).toContainText('Rule saved.');
  await p.reload();
  await expect(p.locator('main:visible').getByTestId('partner-row').filter({ hasText: `DS14 Agency ${stamp}` })).toContainText('12.5% of the plan fee for 3 months');
  await bothWidths(p, 'staff-partners');
  await ctx.close();
});

test('Staff Invoicing @1280 + 390: entity, filter, CSV', async ({ browser }) => {
  const { ctx, p } = await staffPage(browser, admin!, '/office/dropship/invoicing');
  const main = p.locator('main:visible');
  await expect(main.getByTestId('invoicing-entity')).toBeVisible();
  await main.getByLabel('Type', { exact: true }).selectOption('credit_note');
  await main.getByRole('button', { name: 'Filter' }).click();
  await expect(p).toHaveURL(/type=credit_note/);
  const href = await main.getByTestId('invoicing-csv').getAttribute('href');
  expect(href).toContain('/office/dropship/invoicing/csv');
  const csv = await p.request.get(href!);
  expect(csv.status()).toBe(200);
  expect((await csv.text()).startsWith('Number,Type,Date,Merchant,Amount,Currency,Status,Kind')).toBe(true);
  await bothWidths(p, 'staff-invoicing');
  await ctx.close();
});

test('Staff Docs @1280 + 390: upload, verify, signed link', async ({ browser }) => {
  const { ctx, p } = await staffPage(browser, admin!, '/office/dropship/docs');
  const main = p.locator('main:visible');
  const title = `DS14 e2e certificate ${stamp}`;
  await main.getByLabel('Title', { exact: true }).fill(title);
  await main.getByLabel('Product', { exact: true }).first().selectOption({ index: 0 });
  await main.getByLabel('File', { exact: true }).setInputFiles({ name: 'cert.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });
  await main.getByRole('button', { name: 'Upload' }).click();
  await expect(main.getByTestId('docs-msg')).toContainText('Document added');
  const row = main.getByTestId('doc-row').filter({ hasText: title });
  await expect(row).toContainText('Waiting for review');
  const path = (await sql<{ storage_path: string }>(`select storage_path from dropship_product_documents where title = $1`, [title]))[0].storage_path;
  docPaths.push(path);
  await row.getByRole('button', { name: `Verify ${title}`, exact: true }).click();
  await expect(main.getByTestId('doc-row').filter({ hasText: title })).toContainText('Verified');
  const link = await row.getByRole('link', { name: `Open ${title}`, exact: true }).getAttribute('href');
  const res = await p.request.get(link!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  await bothWidths(p, 'staff-docs');
  await ctx.close();
});

test('Merchant Integrations + Connect a channel @1280 + 390: nothing connects, settings are saved', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await customerLogin(page, merchant!, '/account/dropship/integrations');
  const main = page.locator('main:visible');
  await expect(main.getByRole('heading', { name: 'Integrations' }).first()).toBeVisible();
  for (const k of ['shopify', 'woocommerce', 'tiktok_shop', 'wix', 'ebay', 'amazon']) await expect(main.getByTestId(`channel-${k}`)).toBeVisible();
  // CONN S2: WooCommerce connects once the owner switches it on (CONNECTOR_WOOCOMMERCE=on); Wix stays closed either way
  await expect(main.getByTestId('connect-wix')).toBeDisabled();
  await expect(main.getByTestId('channel-wix')).toContainText('Connections open in the store-connection release.');
  await expect(main.getByTestId('channel-woocommerce')).toContainText('Not connected yet');
  const wl = main.getByTestId('amazon-waitlist');
  await expect(wl).toHaveText('Join the waiting list');
  await wl.click();
  await expect(main.getByTestId('amazon-waitlist')).toHaveText('On the waiting list. Leave');
  await page.reload();
  await expect(page.locator('main:visible').getByTestId('amazon-waitlist')).toHaveText('On the waiting list. Leave');
  await page.locator('main:visible').getByTestId('amazon-waitlist').click();
  await expect(page.locator('main:visible').getByTestId('amazon-waitlist')).toHaveText('Join the waiting list');
  await bothWidths(page, 'merchant-integrations');
  await page.goto('/account/dropship/integrations/woocommerce');
  const m2 = page.locator('main:visible');
  await expect(m2.getByRole('heading', { name: 'Connect WooCommerce' })).toBeVisible();
  for (const id of ['channel-continue', 'channel-test', 'channel-reconnect', 'channel-disconnect']) await expect(m2.getByTestId(id)).toBeDisabled();
  const sw = m2.getByRole('switch', { name: 'Sync stock automatically' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await m2.getByTestId('channel-save').click();
  await expect(m2.getByTestId('channel-msg')).toHaveText('Channel settings saved.');
  await page.reload();
  await expect(page.locator('main:visible').getByRole('switch', { name: 'Sync stock automatically' })).toHaveAttribute('aria-checked', 'false');
  expect((await sql<{ sync_stock: boolean }>(`select sync_stock from dropship_channel_settings where org_id = $1 and channel = 'woocommerce'`, [merchant!.orgId]))[0].sync_stock).toBe(false);
  await bothWidths(page, 'merchant-connect-channel');
  await ctx.close();
});
