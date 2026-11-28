import { test, expect } from './helpers/settled';
import type { Browser, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { installHydrationWait } from './helpers/settled';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * CONN S3 · Magento 2 + PrestaShop key-paste connectors, OpenCart CSV pointer, ODS Integrations parity,
 * and System health tiles (tile-order-check, tile-sync from S6). STAGING ONLY.
 *
 *  1. Merchant › Integrations: Magento 2, PrestaShop and OpenCart cards render; OpenCart points to File import (CSV);
 *     when Magento / PrestaShop are switched on (CONNECTOR_MAGENTO=on / CONNECTOR_PRESTASHOP=on), the Magento form
 *     explains the 2.4.4+ "Allow OAuth Access Tokens to be used as standalone Bearer tokens" setting and refuses bad/private
 *     addresses without storing anything.
 *  2. ODS theme parity (@1280 + 390, axe): with ods_preview=on, Integrations renders cleanly inside the ODS shell.
 *  3. Your stores & webhooks: seeded Magento + PrestaShop connections display without secrets, Disconnect works, and
 *     /api/webhooks/connectors/(magento|prestashop)/* return 404 (no webhooks).
 *  4. Staff › System health (@1280 + 390, axe): verifies tile-order-check ("Hourly order check" → Running when an active
 *     store exists) and tile-sync ("Stock and price sync" → reflects engine + FX feed logs from S6).
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const MG_SHOP = `e2e-s3-mg-${stamp}.example.com`;
const PS_SHOP = `e2e-s3-ps-${stamp}.example.com`;
const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));

let merchant: TempCustomer | null = null;
let staff: TempStaff | null = null;
let mgConnId = '';
let psConnId = '';
const logIds: string[] = [];
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

async function checkAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious, `${label} axe`).toEqual([]);
}

async function bothWidths(page: Page, label: string) {
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
    if (w === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} @390 overflow`).toBe(true);
    await checkAxe(page, `${label} @${w}`);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
}

async function merchantPage(browser: Browser, path: string, ods = false) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  installHydrationWait(p);
  await customerLogin(p, merchant!, path);
  // sign in on today's page first, then turn the ODS preview on (the ODS sign-in page has its own spec)
  if (ods) await ctx.addCookies([{ name: 'ods_preview', value: 'on', url: process.env.E2E_BASE_URL ?? 'http://localhost:3000', sameSite: 'Lax' }]);
  await p.goto(path);
  return { ctx, p };
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const sb = adminClient();
  merchant = await createTempCustomer('s3m');
  staff = await createTempStaff('admin');
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'CONN S3 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [merchant.orgId, merchant.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);

  const mg = await sb.rpc('c1_connection_upsert', {
    p_org: merchant.orgId, p_platform: 'magento', p_shop_domain: MG_SHOP, p_store_url: `https://${MG_SHOP}`, p_shop_name: null, p_currency: 'EUR', p_external_store_id: null, p_scopes: ['Magento_Sales::sales'],
  });
  expect(mg.error, mg.error?.message).toBeNull();
  mgConnId = mg.data as string;
  await sb.rpc('c1_connection_set_status', { p_id: mgConnId, p_status: 'active', p_reason: null });

  const ps = await sb.rpc('c1_connection_upsert', {
    p_org: merchant.orgId, p_platform: 'prestashop', p_shop_domain: PS_SHOP, p_store_url: `https://${PS_SHOP}`, p_shop_name: null, p_currency: 'GBP', p_external_store_id: null, p_scopes: ['orders:read'],
  });
  expect(ps.error, ps.error?.message).toBeNull();
  psConnId = ps.data as string;
  await sb.rpc('c1_connection_set_status', { p_id: psConnId, p_status: 'active', p_reason: null });

  // S6 health tiles fixture: latest engine + FX feed logs (cleaned in afterAll)
  const eng = await sql<{ id: string }>(`insert into integration_logs (integration_code, direction, status, summary) values ('dropship-sync-engine', 'out', 200, $1) returning id`,
    [`sync engine: 1 merchant(s) checked; 0 repriced, 0 to approve, 0 alerts, 0 hidden, 0 shown again [${stamp}]`]);
  const fx = await sql<{ id: string }>(`insert into integration_logs (integration_code, direction, status, summary) values ('fx-ecb', 'in', 200, $1) returning id`,
    [`fx-ecb 2026-11-28: 1 new rate(s), 0 unchanged, 0 not used [${stamp}]`]);
  logIds.push(eng[0].id, fx[0].id);
});

test.afterAll(async () => {
  const sb = adminClient();
  if (logIds.length) await sql(`delete from integration_logs where id = any($1::uuid[])`, [logIds]).catch(() => {});
  const ids = [mgConnId, psConnId].filter(Boolean);
  if (ids.length) {
    await sql(`delete from integration_logs where endpoint = any($1::text[])`, [ids.map((i) => `connection:${i}`)]).catch(() => {});
    await sql(`delete from store_credentials where connection_id = any($1::uuid[])`, [ids]).catch(() => {});
    await sql(`delete from store_connections where id = any($1::uuid[])`, [ids]).catch(() => {});
  }
  await sql(`delete from store_oauth_states where org_id = $1`, [merchant?.orgId || null]).catch(() => {});
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
  await deleteTempStaff(staff);
});

test('Integrations › OpenCart → CSV, Magento 2 & PrestaShop cards, Your stores, ODS parity @1280 + 390', async ({ browser, request }) => {
  const { ctx, p } = await merchantPage(browser, '/account/dropship/integrations', true);
  await expect(p.getByTestId('ods-dropship-area')).toBeVisible();
  const main = p.locator('main:visible');

  // OpenCart card points to the CSV file connector
  const oc = main.getByTestId('channel-opencart');
  await expect(oc).toBeVisible();
  await expect(oc).toContainText('CSV file');
  const ocLink = oc.getByTestId('opencart-file');
  await expect(ocLink).toHaveAttribute('href', '/account/dropship/integrations/file');

  // Magento 2 & PrestaShop cards + seeded connections in Your stores
  await expect(main.getByTestId('channel-magento')).toBeVisible();
  await expect(main.getByTestId('channel-prestashop')).toBeVisible();
  await expect(main.getByTestId(`store-row-${mgConnId}`)).toContainText(MG_SHOP);
  await expect(main.getByTestId(`store-row-${psConnId}`)).toContainText(PS_SHOP);
  await expect(main.getByTestId('your-stores')).not.toContainText(/access_token|api_key|v1\./);
  await bothWidths(p, 's3-integrations-ods');

  // When Magento / PrestaShop are switched on, check the key-paste forms & 2.4.4+ explanation
  const mgBtn = main.getByTestId('connect-magento');
  if (!(await mgBtn.isDisabled())) {
    await mgBtn.click();
    const form = main.getByTestId('magento-connect');
    await expect(form.getByTestId('magento-connect-oauth-note')).toContainText('Allow OAuth Access Tokens to be used as standalone Bearer tokens');
    await form.getByTestId('magento-connect-url').fill('http://127.0.0.1');
    await form.getByTestId('magento-connect-key').fill('bad-token-12345678');
    await form.getByTestId('magento-connect-go').click();
    await expect(form.getByTestId('magento-connect-error')).toBeVisible();
    await expect(form.getByTestId('magento-connect-error')).not.toContainText('bad-token-12345678');
  }

  // Click OpenCart → lands on File import (CSV)
  await ocLink.click();
  await expect(p.getByTestId('file-page')).toBeVisible();

  // Webhook URLs for Magento & PrestaShop answer 404 (polling connectors, no webhooks)
  for (const path of [`/api/webhooks/connectors/magento/${mgConnId}`, `/api/webhooks/connectors/prestashop/${psConnId}`]) {
    const r = await request.post(path, { data: { id: 1 }, headers: { 'content-type': 'application/json' } });
    expect(r.status(), path).toBe(404);
  }
  await ctx.close();
});

test('Staff › System health tiles tile-order-check and tile-sync (S6) @1280 + 390', async ({ page }) => {
  await staffLogin(page, staff!, '/office/dropship/health');
  await page.goto('/office/dropship/health');
  const main = page.locator('main:visible');
  await expect(main.getByTestId('health-tiles')).toBeVisible();

  // tile-order-check: active Magento/PrestaShop stores make Hourly order check "Running"
  const orderTile = main.getByTestId('tile-order-check');
  await expect(orderTile).toContainText('Hourly order check');
  await expect(orderTile).toContainText('Running');
  await expect(orderTile).toContainText('Connected stores are read every hour for orders a webhook missed.');

  // tile-sync: Stock and price sync reflects the S6 auto-sync engine + ECB FX feed
  const syncTile = main.getByTestId('tile-sync');
  await expect(syncTile).toContainText('Stock and price sync');
  await expect(syncTile).toContainText(/Running|failed|error\(s\) today/);
  await expect(syncTile).toContainText(`sync engine: 1 merchant(s) checked`);
  await expect(syncTile).toContainText(`FX: fx-ecb 2026-11-28`);

  await bothWidths(page, 's3-health-tiles');
});
