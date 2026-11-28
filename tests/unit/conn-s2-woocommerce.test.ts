import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isWooPing, parseWooCallback, verifyWooSignature, wooAuthorizeUrl, wooErrorMessage, wooOrderToInternal, wooTrackingNote, wooWebhookEvent, wooWebhookMeta, type WooOrder,
} from '@/lib/connectors/woocommerce-map';
import { WooCommerceConnector } from '@/lib/connectors/woocommerce';
import { acceptWooKeys, finishWooConnect, type WooConnectDeps } from '@/lib/connectors/woocommerce-connect';
import { storeRequest, type StoreRequest } from '@/lib/connectors/http';
import { processInbox, type RuntimeDeps } from '@/lib/connectors/runtime';
import { handleConnectorWebhook } from '@/lib/connectors/webhook';
import { ConnectorError, type ConnectionRef } from '@/lib/connectors/types';

const KEY = crypto.randomBytes(32).toString('base64');
const ENV = { CONNECTOR_TOKEN_KEY: KEY, CONNECTOR_WOOCOMMERCE: 'on' } as unknown as NodeJS.ProcessEnv;
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const STATE = 'a'.repeat(64);
const CK = `ck_${'1'.repeat(40)}`;
const CS = `cs_${'2'.repeat(40)}`;
const conn: ConnectionRef = { id: CONN, orgId: ORG, platform: 'woocommerce', shopDomain: 'shop.example.com', storeUrl: 'https://shop.example.com/store' };

const paid: WooOrder = {
  id: 1001, number: '1001', status: 'processing', currency: 'aed',
  billing: { first_name: 'Ann', last_name: 'Buyer', phone: '+971500000000', address_1: 'Billing 1', city: 'Dubai', country: 'AE' },
  shipping: { first_name: 'Ann', last_name: 'Buyer', address_1: 'Villa 7', address_2: 'Street 3', city: 'Dubai', state: 'DU', postcode: '00000', country: 'ae' },
  line_items: [
    { id: 5, name: 'Lamp', sku: 'ds-000123-02', quantity: 2, subtotal: '200.00', total: '180.00', meta_data: [{ key: 'pa_color', display_key: 'Color', display_value: 'Red' }, { key: '_hidden', display_key: 'x', display_value: 'y' }] },
    { id: 6, name: 'Own product', sku: 'MY-SKU', quantity: 3, subtotal: '30.00', total: '30.00' },
  ],
};

describe('CONN S2 · WooCommerce formats', () => {
  it('builds the approval address on the merchant store (sub-folder kept, read_write, our state as user_id)', () => {
    const u = new URL(wooAuthorizeUrl({ storeUrl: 'https://shop.example.com/store/', appName: 'Octopus Dropship', state: STATE, returnUrl: 'https://app.example.com/account/dropship/integrations?connect=woocommerce', callbackUrl: 'https://app.example.com/api/webhooks/connect/woocommerce' }));
    expect(u.origin + u.pathname).toBe('https://shop.example.com/store/wc-auth/v1/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ app_name: 'Octopus Dropship', scope: 'read_write', user_id: STATE, return_url: 'https://app.example.com/account/dropship/integrations?connect=woocommerce', callback_url: 'https://app.example.com/api/webhooks/connect/woocommerce' });
  });

  it('accepts only a read_write key pair with our state (JSON or form)', () => {
    const body = { key_id: 9, user_id: STATE, consumer_key: CK, consumer_secret: CS, key_permissions: 'read_write' };
    expect(parseWooCallback(JSON.stringify(body), 'application/json')).toEqual({ keyId: '9', state: STATE, consumerKey: CK, consumerSecret: CS, permissions: 'read_write' });
    expect(parseWooCallback(new URLSearchParams(body as unknown as Record<string, string>).toString(), 'application/x-www-form-urlencoded')).toMatchObject({ state: STATE });
    expect(parseWooCallback(JSON.stringify({ ...body, key_permissions: 'read' }), 'application/json')).toEqual({ error: 'Octopus needs read and write access.' });
    expect(parseWooCallback(JSON.stringify({ ...body, user_id: 'nope' }), null)).toEqual({ error: 'Unknown connection request.' });
    expect(parseWooCallback(JSON.stringify({ ...body, consumer_key: 'x' }), null)).toMatchObject({ error: expect.stringMatching(/not WooCommerce REST keys/) });
    expect(parseWooCallback('not json', 'application/json')).toEqual({ error: 'The body is not JSON.' });
  });

  it('checks X-WC-Webhook-Signature (base64 HMAC-SHA256 of the raw body) and spots the unsigned creation ping', () => {
    const raw = JSON.stringify({ id: 1 });
    const sig = crypto.createHmac('sha256', 'sekret').update(raw).digest('base64');
    expect(verifyWooSignature(raw, sig, 'sekret')).toBe(true);
    expect(verifyWooSignature(raw + ' ', sig, 'sekret')).toBe(false);
    expect(verifyWooSignature(raw, sig, 'other')).toBe(false);
    expect(verifyWooSignature(raw, undefined, 'sekret')).toBe(false);
    expect(verifyWooSignature(raw, 'short', 'sekret')).toBe(false);
    expect(isWooPing('webhook_id=12', {})).toBe(true);
    expect(isWooPing('webhook_id=12', { 'x-wc-webhook-signature': sig })).toBe(false);
    expect(isWooPing('{"webhook_id":12}', {})).toBe(false);
    expect(wooWebhookMeta({ 'x-wc-webhook-id': '7', 'x-wc-webhook-delivery-id': 'abc', 'x-wc-webhook-topic': 'order.created' }, raw)).toEqual({ eventId: '7:abc', topic: 'order.created' });
    expect(wooWebhookMeta({}, raw).eventId).toMatch(/^:[0-9a-f]{40}$/);
  });

  it('maps a paid order: only Octopus lines (by model number SKU), customs value = line total paid, other lines counted', () => {
    const o = wooOrderToInternal(paid);
    expect(o).toMatchObject({
      externalOrderId: '1001', externalOrderName: '#1001', currency: 'AED', fxRateToUsd: null, buyerName: 'Ann Buyer', buyerPhone: '+971500000000', otherItems: 3, risk: 'unknown',
      address: { name: 'Ann Buyer', line1: 'Villa 7', line2: 'Street 3', city: 'Dubai', region: 'DU', postcode: '00000', country: 'AE' },
      lines: [{ modelNo: 'DS-000123-02', qty: 2, buyerPaidMinor: 18000, buyerUnitPriceMinor: 10000, variantLabel: 'Color: Red', title: 'Lamp', externalLineId: '5' }],
    });
    expect(wooOrderToInternal({ ...paid, shipping: { first_name: '' } })).toMatchObject({ address: { line1: 'Billing 1', name: 'Ann Buyer' } });
    for (const st of ['pending', 'on-hold', 'failed', 'checkout-draft']) expect(wooOrderToInternal({ ...paid, status: st })).toMatchObject({ skip: expect.stringContaining(st) });
  });

  it('turns webhooks into intake / cancellation / ignore', () => {
    expect(wooWebhookEvent('order.created', paid)).toMatchObject({ kind: 'order', order: { externalOrderId: '1001' } });
    expect(wooWebhookEvent('order.updated', { ...paid, status: 'cancelled' })).toEqual({ kind: 'order_cancelled', externalOrderId: '1001' });
    expect(wooWebhookEvent('order.updated', { ...paid, status: 'refunded' })).toEqual({ kind: 'order_cancelled', externalOrderId: '1001' });
    expect(wooWebhookEvent('order.deleted', { id: 1001 })).toEqual({ kind: 'order_cancelled', externalOrderId: '1001' });
    expect(wooWebhookEvent('order.created', { ...paid, status: 'pending' })).toMatchObject({ kind: 'ignored' });
    expect(wooWebhookEvent('order.created', { ...paid, line_items: [paid.line_items![1]] })).toEqual({ kind: 'ignored', reason: 'no Octopus products in this order' });
    expect(wooWebhookEvent('product.updated', {})).toMatchObject({ kind: 'ignored' });
  });

  it('writes the customer note with numbers, the mapped company (never "Other") and the branded link', () => {
    expect(wooTrackingNote({ storeOrderNumber: 'SO-1', externalOrderId: '1', externalOrderName: '#1', trackingNumbers: ['YT1', 'YT2'], trackingCompany: 'Other', trackingUrl: 'https://t.example/t/abc', shippedAt: null }))
      .toBe('Your order is on its way. Tracking numbers: YT1, YT2. Track it here: https://t.example/t/abc');
    expect(wooTrackingNote({ storeOrderNumber: 'SO-1', externalOrderId: '1', externalOrderName: '#1', trackingNumbers: ['YT1'], trackingCompany: 'Aramex', trackingUrl: null, shippedAt: null }))
      .toBe('Your order is on its way. Tracking number: YT1 (Aramex).');
  });

  it('explains store errors in plain words', () => {
    expect(wooErrorMessage(401, '{}')).toMatch(/refused our keys/);
    expect(wooErrorMessage(404, '{"code":"rest_no_route"}')).toMatch(/permalinks/);
    expect(wooErrorMessage(503, 'x')).toMatch(/HTTP 503/);
  });
});

type Call = StoreRequest;
function fakeStore(routes: (r: StoreRequest) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const request = (async (r: StoreRequest) => { calls.push(r); const x = routes(r); return { status: x.status, headers: x.headers ?? {}, body: typeof x.body === 'string' ? x.body : JSON.stringify(x.body ?? {}) }; }) as unknown as typeof storeRequest;
  return { calls, request };
}
const woo = (routes: Parameters<typeof fakeStore>[0], keys: { consumerKey: string; consumerSecret: string } | null = { consumerKey: CK, consumerSecret: CS }) => {
  const f = fakeStore(routes);
  return { ...f, c: new WooCommerceConnector({ keys: async () => keys, request: f.request, env: ENV }) };
};

describe('CONN S2 · WooCommerce connector (mocked store)', () => {
  it('is ready only with the token key and the owner switch', () => {
    expect(new WooCommerceConnector({ keys: async () => null, env: ENV }).status()).toBe('ready');
    expect(new WooCommerceConnector({ keys: async () => null, env: { CONNECTOR_TOKEN_KEY: KEY } as unknown as NodeJS.ProcessEnv }).missingEnv()).toEqual(['CONNECTOR_WOOCOMMERCE']);
    expect(new WooCommerceConnector({ keys: async () => null, env: {} as NodeJS.ProcessEnv }).status()).toBe('not_configured');
  });

  it('tests the keys with Basic auth on the store sub-folder and reads the currency', async () => {
    const { c, calls } = woo(() => ({ status: 200, body: { id: 'woocommerce_currency', value: 'AED' } }));
    expect(await c.testConnection(conn)).toMatchObject({ ok: true, currency: 'AED' });
    expect(calls[0].url).toBe('https://shop.example.com/store/wp-json/wc/v3/settings/general/woocommerce_currency');
    expect(calls[0].headers?.authorization).toBe(`Basic ${Buffer.from(`${CK}:${CS}`).toString('base64')}`);
  });

  it('retries once with query keys when the host strips Authorization, then reports AUTH_FAILED', async () => {
    const { c, calls } = woo(() => ({ status: 401, body: { code: 'woocommerce_rest_cannot_view' } }));
    await expect(c.testConnection(conn)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('consumer_key=');
    expect(calls[1].headers?.authorization).toBeUndefined();
    await expect(woo(() => ({ status: 200 }), null).c.testConnection(conn)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('pulls paid orders since the last read, page by page, keeping only orders with Octopus lines', async () => {
    const { c, calls } = woo((r) => {
      const page = Number(new URL(r.url).searchParams.get('page'));
      const list = page === 1 ? Array.from({ length: 50 }, (_, i) => ({ ...paid, id: 2000 + i, line_items: i % 2 ? paid.line_items : [paid.line_items![1]] })) : [paid];
      return { status: 200, body: list, headers: { 'x-wp-totalpages': '2' } };
    });
    const r = await c.pullOrders(conn, '2026-11-28T06:00:00.000Z');
    expect(r.orders).toHaveLength(26);
    expect(calls).toHaveLength(2);
    const q = new URL(calls[0].url).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ status: 'processing', modified_after: '2026-11-28T06:00:00.000Z', dates_are_gmt: 'true', per_page: '50' });
  });

  it('sends tracking as a customer note, then completes the order (best effort)', async () => {
    const { c, calls } = woo((r) => ({ status: r.method === 'PUT' ? 500 : 201, body: { id: 1 } }));
    const s = { storeOrderNumber: 'SO-1', externalOrderId: '1001', externalOrderName: '#1001', trackingNumbers: ['YT1'], trackingCompany: 'Other', trackingUrl: null, shippedAt: null };
    expect(await c.sendTracking(conn, s)).toMatchObject({ ok: true, message: expect.stringMatching(/could not be marked completed/) });
    expect(calls.map((x) => `${x.method} ${new URL(x.url).pathname}`)).toEqual(['POST /store/wp-json/wc/v3/orders/1001/notes', 'PUT /store/wp-json/wc/v3/orders/1001']);
    expect(JSON.parse(calls[0].body!)).toEqual({ note: 'Your order is on its way. Tracking number: YT1.', customer_note: true });
    expect(await c.sendTracking(conn, { ...s, externalOrderId: 'abc' })).toMatchObject({ ok: false });
  });

  it('registers order webhooks with our secret and deletes them by id', async () => {
    let n = 0;
    const { c, calls } = woo((r) => ({ status: r.method === 'DELETE' ? 200 : 201, body: { id: ++n } }));
    expect(await c.registerWebhooks(conn, 'https://app.example.com/api/webhooks/connectors/woocommerce/x', 'sek')).toEqual(['1', '2', '3']);
    expect(calls.map((x) => JSON.parse(x.body!).topic)).toEqual(['order.created', 'order.updated', 'order.deleted']);
    expect(JSON.parse(calls[0].body!)).toMatchObject({ delivery_url: 'https://app.example.com/api/webhooks/connectors/woocommerce/x', secret: 'sek', status: 'active' });
    expect(await c.deleteWebhooks(conn, ['1', 'x', '2'])).toBe(2);
  });

  it('never pushes a product outside the push queue (no fake success)', async () => {
    await expect(woo(() => ({ status: 200 })).c.pushProduct()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });
});

describe('CONN S2 · SSRF-guarded store client', () => {
  const pub = async () => [{ address: '93.184.216.34', family: 4 }];
  const ok = (async () => ({ status: 200, headers: {}, body: '{}' })) as never;
  it('refuses http, odd ports, private addresses and redirects', async () => {
    await expect(storeRequest({ method: 'GET', url: 'http://shop.example.com/x' }, { resolve: pub, request: ok })).rejects.toThrow(/https only/);
    await expect(storeRequest({ method: 'GET', url: 'https://shop.example.com:8443/x' }, { resolve: pub, request: ok })).rejects.toThrow(/normal https port/);
    await expect(storeRequest({ method: 'GET', url: 'https://shop.example.com/x' }, { resolve: async () => [{ address: '10.0.0.5', family: 4 }], request: ok })).rejects.toThrow(/private or internal/);
    await expect(storeRequest({ method: 'GET', url: 'https://shop.example.com/x' }, { resolve: pub, request: (async () => ({ status: 301, headers: { location: 'https://evil.example.com' }, body: '' })) as never })).rejects.toThrow(/redirected/);
    expect((await storeRequest({ method: 'GET', url: 'https://shop.example.com/x' }, { resolve: pub, request: ok })).status).toBe(200);
  });
});

function connectDeps(over: Partial<WooConnectDeps> = {}, rpcData: Record<string, unknown> = {}, rpcFail: Record<string, string> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const saved: string[] = [];
  const deps: WooConnectDeps = {
    rpc: async (fn, args = {}) => { calls.push({ fn, args }); if (rpcFail[fn]) throw new Error(rpcFail[fn]); return rpcData[fn] ?? null; },
    saveCredential: async (_id, kind) => { saved.push(kind); },
    readWebhookSecret: async () => 'whsec',
    randomSecret: () => 'random',
    connector: { testConnection: async () => ({ ok: true, message: 'Connected. Store currency AED.' }), registerWebhooks: async () => ['11', '12', '13'], deleteWebhooks: async () => 0 },
    loadConnection: async () => ({ ...conn, remoteWebhookIds: [] }),
    site: 'https://app.example.com',
    ...over,
  };
  return { deps, calls, saved, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}
const cb = JSON.stringify({ key_id: 9, user_id: STATE, consumer_key: CK, consumer_secret: CS, key_permissions: 'read_write' });

describe('CONN S2 · key callback + first test', () => {
  it('claims the state once, creates the connection and seals both keys and a webhook secret', async () => {
    const h = connectDeps({}, { c2_connect_claim: { org_id: ORG, shop_domain: 'shop.example.com', store_url: 'https://shop.example.com/store' }, c1_connection_upsert: CONN });
    expect(await acceptWooKeys(h.deps, cb, 'application/json')).toEqual({ status: 200, message: 'ok', connectionId: CONN });
    expect(h.of('c2_connect_claim')[0].args).toEqual({ p_platform: 'woocommerce', p_state: STATE });
    expect(h.of('c1_connection_upsert')[0].args).toMatchObject({ p_org: ORG, p_platform: 'woocommerce', p_shop_domain: 'shop.example.com', p_store_url: 'https://shop.example.com/store', p_external_store_id: 'key:9' });
    expect(h.saved).toEqual(['consumer_key', 'consumer_secret', 'webhook_secret']);
    expect(JSON.stringify(h.calls)).not.toContain(CS);
  });

  it('400 for a bad body, an unknown / used state or another account\'s store; 503 when keys can\'t be stored', async () => {
    expect((await acceptWooKeys(connectDeps().deps, '{}', null)).status).toBe(400);
    expect(await acceptWooKeys(connectDeps({}, {}, { c2_connect_claim: 'INVALID_STATE: unknown' }).deps, cb, null)).toMatchObject({ status: 400, message: expect.stringMatching(/unknown or expired/) });
    expect(await acceptWooKeys(connectDeps({}, { c2_connect_claim: { org_id: ORG, shop_domain: 'a.com', store_url: null } }, { c1_connection_upsert: 'ALREADY_LINKED: x' }).deps, cb, null)).toMatchObject({ status: 400, message: expect.stringMatching(/another Octopus account/) });
    const h = connectDeps({ saveCredential: async () => { throw new Error('no key'); } }, { c2_connect_claim: { org_id: ORG, shop_domain: 'a.com', store_url: null }, c1_connection_upsert: CONN });
    expect((await acceptWooKeys(h.deps, cb, null)).status).toBe(503);
    expect(h.of('c1_connection_record_sync')[0].args).toMatchObject({ p_ok: false });
  });

  it('after the answer: test → active → replace our webhooks → log', async () => {
    let deleted: string[] = [];
    const h = connectDeps({ loadConnection: async () => ({ ...conn, remoteWebhookIds: ['1', '2'] }), connector: { testConnection: async () => ({ ok: true, message: 'Connected.' }), registerWebhooks: async (_c, url, secret) => { expect(url).toBe(`https://app.example.com/api/webhooks/connectors/woocommerce/${CONN}`); expect(secret).toBe('whsec'); return ['11', '12', '13']; }, deleteWebhooks: async (_c, ids) => { deleted = ids; return ids.length; } } });
    expect(await finishWooConnect(h.deps, CONN)).toMatchObject({ ok: true, webhooks: 3 });
    expect(deleted).toEqual(['1', '2']);
    expect(h.of('c1_connection_set_status')[0].args).toMatchObject({ p_status: 'active' });
    expect(h.of('c2_connection_set_webhooks')[0].args).toEqual({ p_id: CONN, p_ids: ['11', '12', '13'] });
    expect(h.of('c1_connection_record_sync')[0].args).toMatchObject({ p_kind: 'test', p_ok: true, p_summary: 'Connected. 3 order update(s) set up.' });
  });

  it('refused keys → needs reconnect; webhooks refused → still connected with the reason; no https site → hourly pull only', async () => {
    const a = connectDeps({ connector: { testConnection: async () => { throw new ConnectorError('AUTH_FAILED', 'The store refused our keys. Reconnect WooCommerce.'); }, registerWebhooks: async () => [], deleteWebhooks: async () => 0 } });
    expect(await finishWooConnect(a.deps, CONN)).toMatchObject({ ok: false });
    expect(a.of('c1_connection_set_status')[0].args).toMatchObject({ p_status: 'needs_reconnect' });
    const b = connectDeps({ connector: { testConnection: async () => ({ ok: true, message: 'Connected.' }), registerWebhooks: async () => { throw new ConnectorError('PLATFORM_REFUSED', 'HTTP 500'); }, deleteWebhooks: async () => 0 } });
    expect(await finishWooConnect(b.deps, CONN)).toMatchObject({ ok: true, webhooks: 0 });
    expect(b.of('c1_connection_set_status')[0].args).toMatchObject({ p_status: 'active' });
    expect(String(b.of('c1_connection_record_sync')[0].args.p_summary)).toMatch(/checked every hour/);
    const c = connectDeps({ site: null });
    expect(await finishWooConnect(c.deps, CONN)).toMatchObject({ ok: true, webhooks: 0 });
    expect(c.of('c2_connection_set_webhooks')).toHaveLength(0);
    const d = connectDeps({}, {}, { c1_connection_set_status: 'PLAN_LIMIT: Your plan allows 1 connected store(s).' });
    expect(await finishWooConnect(d.deps, CONN)).toMatchObject({ ok: false, message: 'Your plan allows 1 connected store(s).' });
  });
});

describe('CONN S2 · runtime FX + webhook ping', () => {
  const order = wooOrderToInternal(paid) as Exclude<ReturnType<typeof wooOrderToInternal>, { skip: string }>;
  const mk = (fx: number | null) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const deps: RuntimeDeps = {
      rpc: async (fn, args = {}) => { calls.push({ fn, args }); return fn === 'c1_webhook_claim' ? [{ id: 'w1', source: 'woocommerce', topic: 'order.created', payload: paid, store_connection_id: CONN, org_id: ORG, attempts: 1 }] : { ok: true }; },
      getConnector: () => new WooCommerceConnector({ keys: async () => null, env: ENV }),
      loadConnection: async () => conn, trackingCompany: async () => 'Other', origin: null, fxToUsd: async () => fx,
    };
    return { deps, calls };
  };
  it('fills the Octopus rate for a non-USD order; without a rate the event waits with a clear reason', async () => {
    expect(order.currency).toBe('AED');
    const a = mk(0.2723);
    await processInbox(a.deps);
    expect((a.calls.find((c) => c.fn === 'ds_order_intake')!.args.p_order as Record<string, unknown>).fx_rate_to_usd).toBe(0.2723);
    const b = mk(null);
    await processInbox(b.deps);
    expect(b.calls.some((c) => c.fn === 'ds_order_intake')).toBe(false);
    expect(String(b.calls.find((c) => c.fn === 'c1_webhook_done')!.args.p_error)).toMatch(/FX_RATE_MISSING: Octopus has no exchange rate for AED/);
  });

  it('answers the WooCommerce creation ping with 200 and stores nothing', async () => {
    let stored = 0;
    const r = await handleConnectorWebhook({
      getConnector: () => new WooCommerceConnector({ keys: async () => null, env: ENV }),
      findConnection: async () => ({ id: CONN, platform: 'woocommerce', status: 'active' }), readSecret: async () => 's',
      receive: async () => { stored++; return { id: 'x', duplicate: false }; },
    }, { platform: 'woocommerce', connection: CONN, headers: { 'content-type': 'application/x-www-form-urlencoded' }, rawBody: 'webhook_id=44' });
    expect(r).toEqual({ status: 200, body: { received: true, duplicate: false }, process: false });
    expect(stored).toBe(0);
  });
});
