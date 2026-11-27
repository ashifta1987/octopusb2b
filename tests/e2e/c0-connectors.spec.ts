import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * C0 · Connector foundation + customs safety E2E (STAGING ONLY). Desktop 1280 px and phone 390 px, axe clean (serious / critical).
 *  1. Merchant › Integrations › "Connect your store": a marketplace link is found without any fetch (Connect stays disabled with the
 *     store-connection reason); a private / internal address is refused; a public page that is no shop platform → "not recognised"
 *     → choose "Other" + name → "Request this platform" (waiting-list counter, stored with the name).
 *  2. Merchant › File import: template link, upload an orders CSV → column matching, row errors with row numbers, preview → import →
 *     result + import history; product CSV download.
 *  3. Staff › System health › Store connectors: one row per platform, the requested-platforms list shows the request, the tracking
 *     company name for 4PX → Shopify is set by staff (put back afterwards).
 * Everything the test changes is put back in afterAll (flags, features, tracking name, test rows).
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const SHOTS = process.env.C0_SHOTS;
const OTHER_NAME = `E2E Platform ${stamp}`;
const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let staff: TempStaff | null = null;
let merchant: TempCustomer | null = null;
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];
let trackingNameBefore: { company_name: string | null; use_branded_link: boolean; url_template: string | null; note: string | null } | null = null;

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
async function bothWidths(page: Page, name: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect(page.locator('main:visible').first()).toBeVisible();
  await checkAxe(page, `${name} @1280`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, `${name} @390`);
  await checkAxe(page, `${name} @390`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
}
async function merchantPage(browser: Browser, path: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  await customerLogin(p, merchant!, path);
  await p.goto(path);
  return { ctx, p };
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const sb = adminClient();
  staff = await createTempStaff('admin');
  merchant = await createTempCustomer('c0m');
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'C0 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [merchant.orgId, merchant.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
  trackingNameBefore = (await sql<NonNullable<typeof trackingNameBefore>>(`select company_name, use_branded_link, url_template, note from carrier_tracking_names where carrier = '4px' and platform = 'shopify'`))[0] ?? null;
});

test.afterAll(async () => {
  const sb = adminClient();
  if (trackingNameBefore) {
    await sql(`update carrier_tracking_names set company_name = $1, use_branded_link = $2, url_template = $3, note = $4 where carrier = '4px' and platform = 'shopify'`,
      [trackingNameBefore.company_name, trackingNameBefore.use_branded_link, trackingNameBefore.url_template, trackingNameBefore.note]).catch(() => {});
  }
  await sql(`delete from dropship_csv_imports where org_id = $1`, [merchant?.orgId || null]).catch(() => {});
  await sql(`delete from dropship_channel_waitlist where org_id = $1`, [merchant?.orgId || null]).catch(() => {});
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
  await deleteTempStaff(staff);
});

test('Integrations › Connect your store @1280 + 390: found / refused / not recognised → request this platform', async ({ browser }) => {
  const { ctx, p } = await merchantPage(browser, '/account/dropship/integrations');
  const card = p.getByTestId('store-link-card');
  await expect(card).toBeVisible();
  await expect(p.getByTestId('file-connector-card')).toBeVisible();
  await bothWidths(p, 'c0-integrations');

  // a marketplace link: recognised by its address (no fetch); connecting stays disabled with the store-connection reason
  await p.getByTestId('store-link-input').fill('https://www.ebay.com/str/myshop');
  await p.getByTestId('store-link-check').click();
  await expect(p.getByTestId('store-link-found')).toContainText('eBay');
  await expect(p.getByTestId('store-link-connect')).toBeDisabled();
  await expect(p.getByText('Connections open in the store-connection release.').first()).toBeAttached();

  // an internal address is refused before anything is fetched
  await p.getByTestId('store-link-input').fill('http://intranet.corp/admin');
  await p.getByTestId('store-link-check').click();
  await expect(p.getByTestId('store-link-unreachable')).toContainText('Could not connect');
  await expect(p.getByTestId('store-link-unreachable')).toContainText('not a public store');

  // a public page that runs no shop platform → not recognised → choose "Other" → request it
  await p.getByTestId('store-link-input').fill('example.com');
  await p.getByTestId('store-link-check').click();
  await expect(p.getByTestId('store-link-unknown')).toBeVisible({ timeout: 20_000 });
  await bothWidths(p, 'c0-integrations-unknown');
  await p.getByTestId('store-link-platform').selectOption('other');
  await p.getByTestId('store-link-other').fill(OTHER_NAME);
  await p.getByTestId('store-link-request').click();
  await expect(p.getByTestId('store-link-msg')).toContainText(OTHER_NAME);
  const wl = await sql<{ channel: string; requested_name: string }>(`select channel, requested_name from dropship_channel_waitlist where org_id = $1`, [merchant!.orgId]);
  expect(wl).toEqual([{ channel: 'other', requested_name: OTHER_NAME }]);
  const audit = await sql<{ n: number }>(`select count(*)::int n from audit_log where action = 'ds_channel.store_link_checked' and details ->> 'org_id' = $1`, [merchant!.orgId]);
  expect(audit[0].n).toBeGreaterThanOrEqual(2);
  // no store connection row was created by a link
  expect((await sql<{ n: number }>(`select count(*)::int n from store_connections where org_id = $1`, [merchant!.orgId]))[0].n).toBe(0);
  await ctx.close();
});

test('File import @1280 + 390: column matching, row errors with row numbers, import result and history', async ({ browser }) => {
  const { ctx, p } = await merchantPage(browser, '/account/dropship/integrations/file');
  await expect(p.getByTestId('file-page')).toBeVisible();
  await expect(p.getByTestId('file-template')).toHaveAttribute('download', 'octopus-orders-template.csv');
  await bothWidths(p, 'c0-file');
  const csv = [
    'Name,Shipping Name,Shipping Street,Shipping City,Shipping Country,Currency,Lineitem sku,Lineitem quantity,Lineitem price',
    `E2E-${stamp}-1,Sara Test,1 Way,Dubai,AE,USD,MY-OWN-SKU-1,1,19.99`,
    `E2E-${stamp}-2,Omar Test,2 Way,Dubai,AE,USD,MY-OWN-SKU-2,zero,9.99`,
  ].join('\n');
  await p.getByTestId('file-input').setInputFiles({ name: `c0-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(p.getByTestId('file-preview')).toBeVisible();
  // columns guessed from a store export's headers
  await expect(p.getByTestId('map-sku')).toHaveValue('6');
  await expect(p.getByTestId('file-row-errors')).toContainText('Row 3');
  await expect(p.getByTestId(`preview-E2E-${stamp}-1`)).toBeVisible();
  await bothWidths(p, 'c0-file-preview');
  await p.getByTestId('file-import').click();
  await expect(p.getByTestId('file-import-result')).toContainText('0 imported');
  await expect(p.getByTestId('file-import-result')).toContainText('1 not imported');
  await expect(p.getByTestId('file-history-row').first()).toContainText(`c0-${stamp}.csv`);
  const imp = await sql<{ failed_count: number; errors: { rows: number[] }[] }>(`select failed_count, errors from dropship_csv_imports where org_id = $1`, [merchant!.orgId]);
  expect(imp).toHaveLength(1);
  expect(imp[0].errors.some((e) => e.rows.includes(3))).toBe(true);
  expect(imp[0].errors.some((e) => e.rows.includes(2))).toBe(true);
  const res = await p.request.get('/account/dropship/integrations/file/export?kind=products');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(await res.text()).toMatch(/^"Handle \(DS model no\.\)"/);
  await ctx.close();
});

test('Staff › System health › Store connectors @1280 + 390: platforms, requested platforms, tracking company name', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  await staffLogin(p, staff!, '/office/dropship/health');
  await p.goto('/office/dropship/health');
  const card = p.getByTestId('connector-health');
  await expect(card).toBeVisible();
  for (const k of ['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'ebay', 'amazon']) await expect(p.getByTestId(`connector-${k}`)).toBeVisible();
  await expect(p.getByTestId('connector-csv')).toContainText('Ready');
  await expect(p.getByTestId('requested-platforms')).toContainText(OTHER_NAME);
  await bothWidths(p, 'c0-staff-health');
  const row = p.getByTestId('tracking-name-4px-shopify');
  await row.getByRole('button', { name: /Edit/ }).click();
  await p.getByTestId('tracking-name-company').fill('4PX');
  await p.getByTestId('tracking-name-save').click();
  await expect(p.getByTestId('tracking-name-msg')).toContainText('Saved');
  await expect(p.getByTestId('tracking-name-4px-shopify')).toContainText('4PX');
  const n = await sql<{ company_name: string }>(`select company_name from carrier_tracking_names where carrier = '4px' and platform = 'shopify'`);
  expect(n[0].company_name).toBe('4PX');
  await ctx.close();
});
