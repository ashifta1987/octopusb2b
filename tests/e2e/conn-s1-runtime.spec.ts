import crypto from 'node:crypto';
import { test, expect } from './helpers/settled';
import type { Browser, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { installHydrationWait } from './helpers/settled';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * CONN S1 · Connector runtime E2E (STAGING ONLY; no platform is called — no connector with webhooks or pulls exists in S1).
 *  1. Merchant › Integrations › "Your stores": a seeded WooCommerce connection (service role, as a verified connect would create it)
 *     shows with its status, last order check and last problem; Disconnect asks first, "Keep connected" changes nothing, "Disconnect"
 *     closes it — the result stays visible after the store leaves the list; the sealed key row is gone. 1280 + 390, axe clean.
 *  2. Webhook address: unknown platform / bad id / unknown connection / a platform without webhooks yet → 404 (nothing echoed);
 *     Shopify is not served here.
 *  3. /api/cron/connector-sync refuses a call without the cron secret.
 * Everything the test changes is put back in afterAll.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const SHOP = `e2e-s1-${stamp}.example.com`;
const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let merchant: TempCustomer | null = null;
let connId = '';
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
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}
async function bothWidths(page: Page, name: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await checkAxe(page, `${name} @1280`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} @390 must not overflow sideways`).toBe(true);
  await checkAxe(page, `${name} @390`);
  await page.setViewportSize({ width: 1280, height: 1000 });
}
async function merchantPage(browser: Browser, path: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  installHydrationWait(p);
  await customerLogin(p, merchant!, path);
  await p.goto(path);
  return { ctx, p };
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const sb = adminClient();
  merchant = await createTempCustomer('s1m');
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'CONN S1 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [merchant.orgId, merchant.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
  // what a verified connect creates (the service role; S2 does this after WooCommerce returns the keys)
  const { data: id, error } = await sb.rpc('c1_connection_upsert', {
    p_org: merchant.orgId, p_platform: 'woocommerce', p_shop_domain: SHOP, p_store_url: `https://${SHOP}`, p_shop_name: 'E2E shop', p_currency: 'USD', p_external_store_id: null, p_scopes: ['read_write'],
  });
  expect(error, error?.message).toBeNull();
  connId = id as string;
  await sb.rpc('c1_connection_set_status', { p_id: connId, p_status: 'active', p_reason: null });
  await sb.rpc('c1_connection_record_sync', { p_id: connId, p_kind: 'orders', p_ok: false, p_summary: 'The store did not answer (timeout).' });
  await sql(`insert into store_credentials (connection_id, kind, ciphertext, key_version) values ($1, 'consumer_secret', $2, 1)`,
    [connId, `v1.${crypto.randomBytes(12).toString('base64url')}.${crypto.randomBytes(16).toString('base64url')}.${crypto.randomBytes(24).toString('base64url')}`]);
});

test.afterAll(async () => {
  const sb = adminClient();
  if (connId) {
    await sql(`delete from webhook_inbox where store_connection_id = $1`, [connId]).catch(() => {});
    await sql(`delete from integration_logs where endpoint = $1`, [`connection:${connId}`]).catch(() => {});
    await sql(`delete from store_credentials where connection_id = $1`, [connId]).catch(() => {});
    await sql(`delete from store_connections where id = $1`, [connId]).catch(() => {});
  }
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
});

test('Integrations › Your stores @1280 + 390: status, last problem, disconnect with confirm', async ({ browser }) => {
  const { ctx, p } = await merchantPage(browser, '/account/dropship/integrations');
  const row = p.getByTestId(`store-row-${connId}`);
  await expect(p.getByTestId('your-stores')).toBeVisible();
  await expect(row).toContainText(SHOP);
  await expect(row).toContainText('WooCommerce');
  await expect(row).toContainText('Connected');
  await expect(row).toContainText('Not yet');
  await expect(p.getByTestId(`store-error-${connId}`)).toContainText('The store did not answer (timeout).');
  await expect(p.getByTestId('your-stores')).not.toContainText(/consumer|ck_|cs_|v1\./);
  await bothWidths(p, 's1-your-stores');

  await p.getByTestId(`store-disconnect-${connId}`).click();
  const dialog = p.getByTestId('store-disconnect-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Disconnect ${SHOP}?`);
  await checkAxe(p, 's1-disconnect-dialog');
  await dialog.getByRole('button', { name: 'Keep connected' }).click();
  await expect(dialog).toBeHidden();
  expect((await sql<{ status: string }>(`select status from store_connections where id = $1`, [connId]))[0].status).toBe('active');

  await p.getByTestId(`store-disconnect-${connId}`).click();
  await p.getByTestId('store-disconnect-dialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(p.getByTestId('stores-msg')).toContainText('Store disconnected');
  await expect(row).toHaveCount(0);
  // the message is held above the refreshed list: still there after the refresh render
  await p.waitForTimeout(1500);
  await expect(p.getByTestId('stores-msg')).toContainText('Store disconnected');
  const [c] = await sql<{ status: string; creds: number }>(`select status, (select count(*)::int from store_credentials k where k.connection_id = c.id) creds from store_connections c where id = $1`, [connId]);
  expect(c).toEqual({ status: 'disconnected', creds: 0 });
  await p.reload();
  await expect(p.getByTestId(`store-row-${connId}`)).toHaveCount(0);
  await ctx.close();
});

test('Connector webhook address answers 404 without echoing anything; cron needs its secret', async ({ request }) => {
  const post = (path: string) => request.post(path, { data: { id: 1 }, headers: { 'content-type': 'application/json' } });
  for (const path of [
    `/api/webhooks/connectors/myspace/${connId}`,
    '/api/webhooks/connectors/woocommerce/not-a-uuid',
    '/api/webhooks/connectors/woocommerce/00000000-0000-4000-8000-000000000000',
    `/api/webhooks/connectors/shopify/${connId}`,
    // a platform without webhook handling yet → 404 (never stored unverified)
    `/api/webhooks/connectors/magento/${connId}`,
  ]) {
    const r = await post(path);
    expect(r.status(), path).toBe(404);
    expect(await r.text()).not.toContain(SHOP);
  }
  // CONN S2: WooCommerce has webhooks now; this store was disconnected above → 410 (WooCommerce stops sending), nothing stored
  const gone = await post(`/api/webhooks/connectors/woocommerce/${connId}`);
  expect(gone.status()).toBe(410);
  expect(Number((await sql<{ n: number }>(`select count(*)::int n from webhook_inbox where store_connection_id = $1`, [connId]))[0].n)).toBe(0);
  const cron = await request.get('/api/cron/connector-sync');
  expect([401, 503]).toContain(cron.status());
});
