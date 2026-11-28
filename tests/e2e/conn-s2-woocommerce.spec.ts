import { test, expect } from './helpers/settled';
import type { Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { installHydrationWait } from './helpers/settled';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * CONN S2 · WooCommerce connection E2E (STAGING ONLY; no real store: the store's approval page is intercepted in the browser and
 * WooCommerce's key callback is played by the test with fake keys — the server's own calls to the made-up store fail, as they must).
 *  1. Key callback: unknown state / not JSON / read-only keys → 400 (or 503 while WooCommerce is switched off); nothing stored.
 *  2. Webhook address of a WooCommerce store: the unsigned creation ping → 200, nothing stored; a wrong signature → 401, kept
 *     without its payload.
 *  3. When the owner has switched WooCommerce on (CONNECTOR_WOOCOMMERCE=on): Integrations › WooCommerce › Connect → store address
 *     → the browser goes to <store>/wc-auth/v1/authorize (read_write, our callback, a 64-hex state) → the callback with that state
 *     creates the connection with three sealed keys → the state works once → back on Integrations the approval notice and the
 *     store show (1280 + 390, axe). Skipped (with the reason) while WooCommerce is off on the server under test.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const STORE = `e2e-woo-${stamp}.example.com`;
const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
  'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
let merchant: TempCustomer | null = null;
let seeded = '';
let originalFlag: { value: unknown }[] = [];
let originalFeatures: { value: unknown }[] = [];
const CK = `ck_${'e2e0'.repeat(10)}`;
const CS = `cs_${'e2e1'.repeat(10)}`;

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
  merchant = await createTempCustomer('s2m');
  const [{ data: flag }, { data: feats }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'dropship_v2_ui'),
    sb.from('site_settings').select('value').eq('key', 'dropship_features'),
  ]);
  originalFlag = (flag ?? []) as { value: unknown }[];
  originalFeatures = (feats ?? []) as { value: unknown }[];
  await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: true, description: 'CONN S2 e2e' });
  await sb.from('site_settings').upsert({ key: 'dropship_features', value: ALL_ON, is_public: true });
  await sql(`update organizations set kyc_status = 'verified' where id = $1`, [merchant.orgId]);
  await sql(`update org_members set member_role = 'owner' where org_id = $1 and user_id = $2`, [merchant.orgId, merchant.id]);
  await sql(`insert into company_services(org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on'`, [merchant.orgId]);
  const { data, error } = await sb.rpc('c1_connection_upsert', {
    p_org: merchant.orgId, p_platform: 'woocommerce', p_shop_domain: `seeded-${STORE}`, p_store_url: `https://seeded-${STORE}`, p_shop_name: null, p_currency: null, p_external_store_id: null, p_scopes: ['read_write'],
  });
  expect(error, error?.message).toBeNull();
  seeded = data as string;
});

test.afterAll(async () => {
  const sb = adminClient();
  const ids = (await sql<{ id: string }>(`select id from store_connections where org_id = $1`, [merchant?.orgId || null]).catch(() => [])).map((r) => r.id);
  if (ids.length) {
    await sql(`delete from webhook_inbox where store_connection_id = any($1::uuid[])`, [ids]).catch(() => {});
    await sql(`delete from integration_logs where endpoint = any($1::text[])`, [ids.map((i) => `connection:${i}`)]).catch(() => {});
    await sql(`delete from store_credentials where connection_id = any($1::uuid[])`, [ids]).catch(() => {});
    await sql(`delete from store_connections where id = any($1::uuid[])`, [ids]).catch(() => {});
  }
  await sql(`delete from store_oauth_states where org_id = $1`, [merchant?.orgId || null]).catch(() => {});
  if (originalFeatures.length) await sb.from('site_settings').upsert({ key: 'dropship_features', value: originalFeatures[0].value, is_public: true });
  if (originalFlag.length) await sb.from('site_settings').upsert({ key: 'dropship_v2_ui', value: originalFlag[0].value });
  else await sb.from('site_settings').delete().eq('key', 'dropship_v2_ui');
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
});

test('Key callback refuses unknown states, bad bodies and read-only keys; nothing is stored', async ({ request }) => {
  const cb = (data: unknown, type = 'application/json') => request.post('/api/webhooks/connect/woocommerce', { data: typeof data === 'string' ? data : JSON.stringify(data), headers: { 'content-type': type } });
  const before = Number((await sql<{ n: number }>(`select count(*)::int n from store_connections where org_id = $1`, [merchant!.orgId]))[0].n);
  for (const body of [
    { key_id: 1, user_id: 'f'.repeat(64), consumer_key: CK, consumer_secret: CS, key_permissions: 'read_write' },
    { key_id: 1, user_id: 'f'.repeat(64), consumer_key: CK, consumer_secret: CS, key_permissions: 'read' },
    'not json',
  ]) {
    const r = await cb(body);
    expect([400, 503]).toContain(r.status());
    const text = await r.text();
    expect(text).not.toContain(CS);
  }
  expect(Number((await sql<{ n: number }>(`select count(*)::int n from store_connections where org_id = $1`, [merchant!.orgId]))[0].n)).toBe(before);
});

test('WooCommerce webhook address: creation ping → 200 (nothing stored); a wrong signature → 401, kept without payload', async ({ request }) => {
  const path = `/api/webhooks/connectors/woocommerce/${seeded}`;
  const ping = await request.post(path, { data: 'webhook_id=42', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  expect(ping.status()).toBe(200);
  expect(Number((await sql<{ n: number }>(`select count(*)::int n from webhook_inbox where store_connection_id = $1`, [seeded]))[0].n)).toBe(0);
  const bad = await request.post(path, {
    data: JSON.stringify({ id: 1001, status: 'processing', billing: { email: 'buyer@example.com' } }),
    headers: { 'content-type': 'application/json', 'x-wc-webhook-signature': 'AAAA', 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-delivery-id': `d-${stamp}` },
  });
  expect(bad.status()).toBe(401);
  const rows = await sql<{ signature_ok: boolean; payload: unknown; topic: string }>(`select signature_ok, payload, topic from webhook_inbox where store_connection_id = $1`, [seeded]);
  expect(rows).toEqual([{ signature_ok: false, payload: null, topic: 'order.created' }]);
});

test('Integrations › Connect WooCommerce @1280 + 390: approval page on the store, key callback, back with the store listed', async ({ browser, request }) => {
  const { ctx, p } = await merchantPage(browser, '/account/dropship/integrations');
  const btn = p.getByTestId('connect-woocommerce');
  await expect(btn).toBeVisible();
  test.skip(await btn.isDisabled(), 'WooCommerce is switched off on this server (CONNECTOR_WOOCOMMERCE / CONNECTOR_TOKEN_KEY)');
  let authorize: URL | null = null;
  await p.route(`https://${STORE}/**`, async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Approve</title><main><h1>WooCommerce approval (test)</h1></main></html>' });
  });
  await btn.click();
  await p.getByTestId('woo-connect-url').fill(`${STORE}/`);
  await p.getByTestId('woo-connect-go').click();
  await expect.poll(() => authorize?.pathname ?? null, { timeout: 15_000 }).toBe('/wc-auth/v1/authorize');
  const q = Object.fromEntries(authorize!.searchParams);
  expect(q.scope).toBe('read_write');
  expect(q.user_id).toMatch(/^[0-9a-f]{64}$/);
  expect(q.callback_url).toMatch(/\/api\/webhooks\/connect\/woocommerce$/);
  expect(q.return_url).toMatch(/\/account\/dropship\/integrations\?connect=woocommerce$/);
  const [st] = await sql<{ store_url: string; used_at: string | null }>(`select store_url, used_at from store_oauth_states where org_id = $1 order by created_at desc limit 1`, [merchant!.orgId]);
  expect(st).toEqual({ store_url: `https://${STORE}`, used_at: null });

  // WooCommerce's server posts the approved keys to our callback
  const cbBody = { key_id: 77, user_id: q.user_id, consumer_key: CK, consumer_secret: CS, key_permissions: 'read_write' };
  const cb = await request.post('/api/webhooks/connect/woocommerce', { data: JSON.stringify(cbBody), headers: { 'content-type': 'application/json' } });
  expect(cb.status()).toBe(200);
  const [c] = await sql<{ id: string; status: string; store_url: string; external_store_id: string }>(`select id, status, store_url, external_store_id from store_connections where org_id = $1 and shop_domain = $2`, [merchant!.orgId, STORE]);
  expect(c).toMatchObject({ store_url: `https://${STORE}`, external_store_id: 'key:77' });
  expect(['connecting', 'needs_reconnect', 'active']).toContain(c.status);
  const creds = await sql<{ kind: string; ciphertext: string }>(`select kind, ciphertext from store_credentials where connection_id = $1 order by kind`, [c.id]);
  expect(creds.map((x) => x.kind)).toEqual(['consumer_key', 'consumer_secret', 'webhook_secret']);
  expect(creds.every((x) => /^v\d+\./.test(x.ciphertext) && !x.ciphertext.includes(CS) && !x.ciphertext.includes(CK))).toBe(true);
  const again = await request.post('/api/webhooks/connect/woocommerce', { data: JSON.stringify(cbBody), headers: { 'content-type': 'application/json' } });
  expect(again.status()).toBe(400);

  // back from the store: the approval notice + the store in "Your stores" (the made-up store can't be tested → its reason shows)
  await p.unroute(`https://${STORE}/**`);
  await p.goto('/account/dropship/integrations?connect=woocommerce&success=1');
  await expect(p.getByTestId('connect-return')).toContainText('WooCommerce approved the connection');
  await expect(p.getByTestId(`store-row-${c.id}`)).toContainText(STORE);
  await expect(p.getByTestId('your-stores')).not.toContainText(/ck_|cs_/);
  for (const w of [1280, 390]) {
    await p.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
    if (w === 390) expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), `axe @${w}`).toEqual([]);
  }
  await p.goto('/account/dropship/integrations?connect=woocommerce&success=0');
  await expect(p.getByTestId('connect-return')).toContainText('nothing was connected');
  await ctx.close();
});
