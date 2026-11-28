import { test, expect } from './helpers/settled';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * CONN S2b · Product push to WooCommerce E2E (STAGING ONLY; no real store — the queue's store calls are covered by unit tests with a
 * mocked store).
 *  1. Push to store names the connected platform: with a WooCommerce store connected (seeded through the service role, as the key
 *     callback creates it) the page says "Push to WooCommerce", the store select shows "WooCommerce · <shop>", the WooCommerce note
 *     (in / out of stock, category) shows. 1280 + 390, axe clean.
 *  2. Image links for stores: a token we did not sign → 404; a wrong file name → 404 (never our storage path).
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const SHOP = `e2e-s2b-${stamp}.example.com`;
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

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const sb = adminClient();
  merchant = await createTempCustomer('s2bm');
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'CONN S2b e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [merchant.orgId, merchant.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
  const { data, error } = await sb.rpc('c1_connection_upsert', {
    p_org: merchant.orgId, p_platform: 'woocommerce', p_shop_domain: SHOP, p_store_url: `https://${SHOP}`, p_shop_name: null, p_currency: 'USD', p_external_store_id: null, p_scopes: ['read_write'],
  });
  expect(error, error?.message).toBeNull();
  connId = data as string;
  await sb.rpc('c1_connection_set_status', { p_id: connId, p_status: 'active', p_reason: null });
});

test.afterAll(async () => {
  const sb = adminClient();
  if (connId) {
    await sql(`delete from integration_logs where endpoint = $1`, [`connection:${connId}`]).catch(() => {});
    await sql(`delete from store_connections where id = $1`, [connId]).catch(() => {});
  }
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
});

test('Push to store names WooCommerce when a WooCommerce store is connected @1280 + 390', async ({ page }) => {
  await customerLogin(page, merchant!, '/account/dropship/push');
  await page.goto('/account/dropship/push');
  const root = page.getByTestId('ds6-push');
  await expect(root.locator('h1')).toContainText('Push to WooCommerce');
  await expect(page.getByTestId('push-settings')).toContainText(`WooCommerce · ${SHOP}`);
  await expect(page.getByTestId('push-settings')).toContainText('Review in WooCommerce first');
  await expect(page.getByTestId('push-settings')).toContainText('in stock / out of stock');
  await expect(page.getByTestId('push-connect-store')).toHaveCount(0);
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
    if (w === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), `axe @${w}`).toEqual([]);
  }
});

test('Store image links: unsigned tokens and odd file names → 404', async ({ request }) => {
  const fake = `${Buffer.from('products/sha/abc.jpg').toString('base64url')}.${'0'.repeat(16)}`;
  for (const path of [`/api/webhooks/media/${fake}/img-00000000.jpg`, `/api/webhooks/media/${fake}/abc.jpg`, '/api/webhooks/media/x/img-00000000.jpg']) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(404);
    expect(await r.text()).not.toContain('product-media');
  }
});
