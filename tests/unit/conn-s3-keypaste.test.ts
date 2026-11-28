import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { storeAmountToMinor, utcSqlTime } from '@/lib/connectors/key-common';
import {
  MagentoConnector, magentoErrorMessage, magentoOrderToInternal, magentoOrdersQuery, magentoTime, type MgOrder,
} from '@/lib/connectors/magento';
import {
  PrestaShopConnector, orderCarrierXml, prestashopErrorMessage, prestashopOrderToInternal, type PsAddress, type PsOrder,
} from '@/lib/connectors/prestashop';
import { connectKeyStore, retestKeyConnection, type KeyConnectDeps } from '@/lib/connectors/key-connect';
import { runOrderCatchup, runTasks, type RuntimeDeps } from '@/lib/connectors/runtime';
import type { StoreRequest } from '@/lib/connectors/http';
import type { ConnectionRef } from '@/lib/connectors/types';

const KEY = crypto.randomBytes(32).toString('base64');
const MG_ENV = { CONNECTOR_TOKEN_KEY: KEY, CONNECTOR_MAGENTO: 'on' } as unknown as NodeJS.ProcessEnv;
const PS_ENV = { CONNECTOR_TOKEN_KEY: KEY, CONNECTOR_PRESTASHOP: 'on' } as unknown as NodeJS.ProcessEnv;
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN_MG = '22222222-2222-4222-8222-222222222222';
const CONN_PS = '33333333-3333-4333-8333-333333333333';
const mgConn: ConnectionRef = { id: CONN_MG, orgId: ORG, platform: 'magento', shopDomain: 'mg.example.com', storeUrl: 'https://mg.example.com' };
const psConn: ConnectionRef = { id: CONN_PS, orgId: ORG, platform: 'prestashop', shopDomain: 'ps.example.com', storeUrl: 'https://ps.example.com/shop' };

function fakeStore(routes: (r: StoreRequest) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: StoreRequest[] = [];
  const request = (async (r: StoreRequest) => {
    calls.push(r);
    const x = routes(r);
    return { status: x.status, headers: x.headers ?? {}, body: typeof x.body === 'string' ? x.body : JSON.stringify(x.body ?? {}) };
  }) as unknown as typeof import('@/lib/connectors/http').storeRequest;
  return { calls, request };
}

const mgOrder: MgOrder = {
  entity_id: 501,
  increment_id: '000000501',
  status: 'processing',
  order_currency_code: 'eur',
  billing_address: { firstname: 'Ann', lastname: 'Bill', street: ['Billing 1'], city: 'Paris', postcode: '75001', country_id: 'FR', telephone: '+331' },
  extension_attributes: {
    shipping_assignments: [{
      shipping: { address: { firstname: 'Ann', lastname: 'Ship', street: ['10 Rue Test', 'Apt 2'], city: 'Lyon', region: 'ARA', postcode: '69001', country_id: 'fr', telephone: '+336' } },
    }],
  },
  items: [
    // configurable parent carries chosen child SKU & paid row total; child row has parent_item_id and is skipped
    { item_id: 11, sku: 'ds-000101-01', name: 'Desk Lamp', qty_ordered: 2, row_total: 100.0000, discount_amount: 10.0000, price: 50.0000, product_type: 'configurable', parent_item_id: null },
    { item_id: 12, sku: 'ds-000101-01', name: 'Desk Lamp', qty_ordered: 2, row_total: 0, discount_amount: 0, price: 0, product_type: 'simple', parent_item_id: 11 },
    { item_id: 13, sku: 'OWN-SKU', name: 'Store Merch', qty_ordered: 3, row_total: 30, discount_amount: 0, price: 10, parent_item_id: null },
  ],
};

describe('CONN S3 · shared store amount & time helpers', () => {
  it('rounds 4- and 6-decimal store prices half-up to currency minor units without floating point drift', () => {
    expect(storeAmountToMinor('19.9900', 'USD')).toBe(1999);
    expect(storeAmountToMinor('16.666667', 'EUR')).toBe(1667);
    expect(storeAmountToMinor('10.004', 'USD')).toBe(1000);
    expect(storeAmountToMinor('10.005', 'USD')).toBe(1001);
    expect(storeAmountToMinor('1500.4', 'JPY')).toBe(1500);
    expect(storeAmountToMinor('-1', 'USD')).toBeNull();
    expect(utcSqlTime('2026-11-28T12:00:00+02:00')).toBe('2026-11-28 10:00:00');
  });
});

describe('CONN S3 · Magento 2 connector (mocked store)', () => {
  it('is ready only with CONNECTOR_TOKEN_KEY and CONNECTOR_MAGENTO=on', () => {
    expect(new MagentoConnector({ key: async () => null, env: MG_ENV }).status()).toBe('ready');
    expect(new MagentoConnector({ key: async () => null, env: { CONNECTOR_TOKEN_KEY: KEY } as unknown as NodeJS.ProcessEnv }).missingEnv()).toEqual(['CONNECTOR_MAGENTO']);
    expect(new MagentoConnector({ key: async () => null, env: {} as NodeJS.ProcessEnv }).status()).toBe('not_configured');
  });

  it('maps a processing order: skips configurable child rows, calculates row_total - discount_amount, falls back empty shipping to billing', () => {
    const r = magentoOrderToInternal(mgOrder);
    expect(r).toMatchObject({
      externalOrderId: '501',
      externalOrderName: '#000000501',
      currency: 'EUR',
      otherItems: 3,
      risk: 'unknown',
      buyerName: 'Ann Ship',
      address: { line1: '10 Rue Test', line2: 'Apt 2', city: 'Lyon', region: 'ARA', postcode: '69001', country: 'FR' },
      lines: [{ modelNo: 'DS-000101-01', qty: 2, buyerPaidMinor: 9000, buyerUnitPriceMinor: 5000, title: 'Desk Lamp', externalLineId: '11' }],
    });
    expect(magentoOrderToInternal({ ...mgOrder, extension_attributes: { shipping_assignments: [{ shipping: { address: {} } }] } })).toMatchObject({
      address: { line1: 'Billing 1', city: 'Paris', country: 'FR' },
    });
    expect(magentoOrderToInternal({ ...mgOrder, status: 'pending' })).toMatchObject({ skip: expect.stringContaining('pending') });
  });

  it('builds UTC searchCriteria query for status=processing and updated_at >= since', () => {
    expect(magentoTime('2026-11-28T10:30:00Z')).toBe('2026-11-28 10:30:00');
    const q = Object.fromEntries(new URLSearchParams(magentoOrdersQuery('2026-11-28T10:30:00Z', 2, 25)));
    expect(q).toMatchObject({
      'searchCriteria[filter_groups][0][filters][0][field]': 'status',
      'searchCriteria[filter_groups][0][filters][0][value]': 'processing',
      'searchCriteria[filter_groups][1][filters][0][field]': 'updated_at',
      'searchCriteria[filter_groups][1][filters][0][value]': '2026-11-28 10:30:00',
      'searchCriteria[filter_groups][1][filters][0][condition_type]': 'gteq',
      'searchCriteria[pageSize]': '25',
      'searchCriteria[currentPage]': '2',
    });
  });

  it('detects Magento 2.4.4+ standalone Bearer token refusal and explains the exact setting', () => {
    const msg = magentoErrorMessage(401, JSON.stringify({ message: "The consumer isn't authorized to access %resources." }));
    expect(msg).toContain('2.4.4');
    expect(msg).toContain('Allow OAuth Access Tokens to be used as standalone Bearer tokens');
    expect(magentoErrorMessage(404, '{}')).toContain('/rest/V1'.slice(0, 0) || 'Magento REST API');
  });

  it('tests the key via GET /rest/V1/store/storeConfigs and /orders, pulls orders across pages, and sends tracking via POST /rest/V1/order/{id}/ship', async () => {
    const f = fakeStore((r) => {
      if (r.url.includes('/store/storeConfigs')) return { status: 200, body: [{ base_currency_code: 'USD', default_display_currency_code: 'EUR' }] };
      if (r.url.includes('/orders?')) {
        const page = Number(new URL(r.url).searchParams.get('searchCriteria[currentPage]'));
        const items = page === 1 ? Array.from({ length: 50 }, (_, i) => ({ ...mgOrder, entity_id: 600 + i })) : [mgOrder];
        return { status: 200, body: { items, total_count: 51 } };
      }
      if (r.url.endsWith('/order/501/ship')) return { status: 200, body: 99 };
      return { status: 404, body: {} };
    });
    const c = new MagentoConnector({ key: async () => 'mg-secret-token-123456', request: f.request, env: MG_ENV });
    expect(await c.testKey('https://mg.example.com', 'mg-secret-token-123456')).toEqual({ ok: true, message: 'Connected. Store currency EUR.', currency: 'EUR' });
    expect(f.calls[0].headers?.authorization).toBe('Bearer mg-secret-token-123456');
    expect(f.calls[0].url).toBe('https://mg.example.com/rest/V1/store/storeConfigs');

    f.calls.length = 0;
    const pulled = await c.pullOrders(mgConn, '2026-11-28T08:00:00Z');
    expect(pulled.orders).toHaveLength(51);
    expect(f.calls).toHaveLength(2);

    f.calls.length = 0;
    expect(await c.sendTracking(mgConn, {
      storeOrderNumber: 'SO-1', externalOrderId: '501', externalOrderName: '#501',
      trackingNumbers: ['YT1', 'YT2'], trackingCompany: 'Other', trackingUrl: 'https://t.example/t/abc', shippedAt: null,
    })).toEqual({ ok: true });
    expect(f.calls[0].method).toBe('POST');
    expect(f.calls[0].url).toBe('https://mg.example.com/rest/V1/order/501/ship');
    expect(JSON.parse(f.calls[0].body!)).toEqual({
      items: [], notify: true, appendComment: true,
      comment: { comment: 'Track your order: https://t.example/t/abc', is_visible_on_front: 1 },
      tracks: [{ track_number: 'YT1', title: 'Tracking', carrier_code: 'custom' }, { track_number: 'YT2', title: 'Tracking', carrier_code: 'custom' }],
    });
    await expect(c.pushProduct()).rejects.toMatchObject({ code: 'NOT_BUILT' });
  });

  it('throws AUTH_FAILED with the 2.4.4+ setting hint when Magento refuses standalone Bearer tokens', async () => {
    const f = fakeStore(() => ({ status: 401, body: { message: "The consumer isn't authorized to access %resources." } }));
    const c = new MagentoConnector({ key: async () => 'tok', request: f.request, env: MG_ENV });
    await expect(c.testKey('https://mg.example.com', 'tok')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      message: expect.stringContaining('Allow OAuth Access Tokens to be used as standalone Bearer tokens'),
    });
  });
});

describe('CONN S3 · PrestaShop connector (mocked store)', () => {
  const psAddr: PsAddress = { firstname: 'Lina', lastname: 'Shop', address1: '5 High St', postcode: 'SW1A', city: 'London', id_country: '17', phone_mobile: '+447700' };
  const psOrder: PsOrder = {
    id: 77, reference: 'XKBFR', valid: '1', id_address_delivery: '12', id_currency: '2',
    associations: { order_rows: [{ id: '4', product_reference: 'ds-000202-01', product_quantity: '2', unit_price_tax_excl: '16.666667', product_name: 'Mug' }, { id: '5', product_reference: 'OTHER', product_quantity: '1', unit_price_tax_excl: '5.00' }] },
  };

  it('is ready only with CONNECTOR_TOKEN_KEY and CONNECTOR_PRESTASHOP=on', () => {
    expect(new PrestaShopConnector({ key: async () => null, env: PS_ENV }).status()).toBe('ready');
    expect(new PrestaShopConnector({ key: async () => null, env: { CONNECTOR_TOKEN_KEY: KEY } as unknown as NodeJS.ProcessEnv }).missingEnv()).toEqual(['CONNECTOR_PRESTASHOP']);
  });

  it('maps valid=1 orders with 6-decimal price rounding and escapes CDATA safely in order_carrier XML', () => {
    const o = prestashopOrderToInternal(psOrder, psAddr, 'gb', 'gbp');
    expect(o).toMatchObject({
      externalOrderId: '77',
      externalOrderName: 'XKBFR',
      currency: 'GBP',
      otherItems: 1,
      address: { name: 'Lina Shop', line1: '5 High St', city: 'London', postcode: 'SW1A', country: 'GB' },
      lines: [{ modelNo: 'DS-000202-01', qty: 2, buyerUnitPriceMinor: 1667, buyerPaidMinor: 3334, externalLineId: '4' }],
    });
    expect(prestashopOrderToInternal({ ...psOrder, valid: '0' }, psAddr, 'GB', 'GBP')).toMatchObject({ skip: expect.stringMatching(/not valid/) });
    const xml = orderCarrierXml({ id: '9', id_order: '77', id_carrier: '3', weight: '0.5' }, 'TRK&1]]>2');
    expect(xml).toContain('<tracking_number><![CDATA[TRK&1]]]]><![CDATA[>2]]></tracking_number>');
    expect(xml).toContain('<id_order><![CDATA[77]]></id_order>');
    expect(prestashopErrorMessage(403)).toContain('order_carriers');
  });

  it('uses Basic auth + output_format=JSON for tests & order lookups (caching lookups), and PUT XML on order_carriers for tracking', async () => {
    const f = fakeStore((r) => {
      if (r.url.includes('/configurations')) return { status: 200, body: { configurations: [{ value: '2' }] } };
      if (r.url.includes('/currencies/2')) return { status: 200, body: { currency: { iso_code: 'GBP' } } };
      if (r.url.includes('/orders?display=[id]')) return { status: 200, body: [] }; // empty shop array shape
      if (r.url.includes('/order_carriers?display=[id]')) return { status: 200, body: [] };
      if (r.url.includes('/orders?display=full')) return { status: 200, body: { orders: [psOrder, { ...psOrder, id: 78, reference: 'SECOND' }] } };
      if (r.url.includes('/addresses/12')) return { status: 200, body: { address: psAddr } };
      if (r.url.includes('/countries/17')) return { status: 200, body: { country: { iso_code: 'GB' } } };
      if (r.url.includes('/order_carriers?filter%5Bid_order%5D') || r.url.includes('/order_carriers?filter[id_order]=[77]')) {
        return { status: 200, body: { order_carriers: [{ id: 9, id_order: 77, id_carrier: 3, shipping_cost_tax_excl: '4.50' }] } };
      }
      if (r.method === 'PUT' && r.url.includes('/api/order_carriers/9')) return { status: 200, body: '<prestashop/>' };
      return { status: 404, body: {} };
    });
    const c = new PrestaShopConnector({ key: async () => 'PSKEY123456', request: f.request, env: PS_ENV });
    expect(await c.testKey('https://ps.example.com/shop', 'PSKEY123456')).toEqual({ ok: true, message: 'Connected. Shop currency GBP.', currency: 'GBP' });
    expect(f.calls[0].headers?.authorization).toBe(`Basic ${Buffer.from('PSKEY123456:').toString('base64')}`);
    expect(f.calls[0].url).toContain('output_format=JSON');

    f.calls.length = 0;
    const pulled = await c.pullOrders(psConn, '2026-11-28T06:00:00Z');
    expect(pulled.orders).toHaveLength(2);
    // address 12, country 17, currency 2 fetched once each (cached across both orders)
    expect(f.calls.filter((x) => x.url.includes('/addresses/12'))).toHaveLength(1);
    expect(f.calls.filter((x) => x.url.includes('/countries/17'))).toHaveLength(1);

    f.calls.length = 0;
    const tr = await c.sendTracking(psConn, {
      storeOrderNumber: 'SO-2', externalOrderId: '77', externalOrderName: 'XKBFR',
      trackingNumbers: ['PX111', 'PX222'], trackingCompany: 'Other', trackingUrl: 'https://t.example/t/ps', shippedAt: null,
    });
    expect(tr).toEqual({ ok: true, message: 'PrestaShop keeps one tracking number per order; the first was sent.' });
    const put = f.calls.find((x) => x.method === 'PUT')!;
    expect(put.url).toBe('https://ps.example.com/shop/api/order_carriers/9');
    expect(put.headers?.['content-type']).toBe('application/xml');
    expect(put.body).toContain('<tracking_number><![CDATA[PX111]]></tracking_number>');
    await expect(c.pushProduct()).rejects.toMatchObject({ code: 'NOT_BUILT' });
  });
});

describe('CONN S3 · server-side key test before sealing + S1 runtime integration', () => {
  function keyConnectHarness(over: Partial<KeyConnectDeps> = {}, rpcFail: Record<string, string> = {}) {
    const userCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const adminCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const saved: { id: string; kind: string; val: string }[] = [];
    const deps: KeyConnectDeps = {
      userRpc: async (fn, args = {}) => {
        userCalls.push({ fn, args });
        if (rpcFail[fn]) throw new Error(rpcFail[fn]);
        return { state: 'a'.repeat(64) };
      },
      adminRpc: async (fn, args = {}) => {
        adminCalls.push({ fn, args });
        if (rpcFail[fn]) throw new Error(rpcFail[fn]);
        if (fn === 'c2_connect_claim') return { org_id: ORG, shop_domain: 'mg.example.com', store_url: 'https://mg.example.com' };
        if (fn === 'c1_connection_upsert') return CONN_MG;
        return null;
      },
      saveCredential: async (id, kind, val) => { saved.push({ id, kind, val }); },
      connector: () => ({
        status: () => 'ready',
        testKey: async () => ({ ok: true, message: 'Connected. Store currency EUR.', currency: 'EUR' }),
        testConnection: async () => ({ ok: true, message: 'Connected. Store currency EUR.' }),
      }),
      loadConnection: async () => mgConn,
      ...over,
    };
    return { deps, userCalls, adminCalls, saved };
  }

  it('tests the key BEFORE claiming, upserting or sealing; failed store test stores nothing and leaks no key', async () => {
    const secret = 'super-secret-magento-token-9999';
    const fail = keyConnectHarness({
      connector: () => ({
        status: () => 'ready',
        testKey: async () => { throw new Error(`401 Bearer ${secret}`); },
        testConnection: async () => ({ ok: false, message: 'no' }),
      }),
    });
    const res = await connectKeyStore(fail.deps, { platform: 'magento', storeUrl: 'https://mg.example.com', secretKey: secret });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).not.toContain(secret);
    expect(fail.userCalls).toHaveLength(1);
    expect(fail.adminCalls).toHaveLength(0);
    expect(fail.saved).toHaveLength(0);
  });

  it('refuses ALREADY_LINKED / PLAN_LIMIT before calling the store, and seals access_token / api_key on success', async () => {
    let tested = 0;
    const preFail = keyConnectHarness({
      connector: () => ({ status: () => 'ready', testKey: async () => { tested++; return { ok: true, message: 'ok', currency: 'USD' }; }, testConnection: async () => ({ ok: true, message: 'ok' }) }),
    }, { c2_connect_start: 'ALREADY_LINKED: This store is already linked to another Octopus account.' });
    expect(await connectKeyStore(preFail.deps, { platform: 'magento', storeUrl: 'mg.example.com', secretKey: 'valid-token-1234' })).toEqual({
      ok: false,
      message: 'This store is already linked to another Octopus account.',
    });
    expect(tested).toBe(0);

    const okMg = keyConnectHarness();
    expect(await connectKeyStore(okMg.deps, { platform: 'magento', storeUrl: 'mg.example.com', secretKey: 'tok-12345678' })).toEqual({
      ok: true, connectionId: CONN_MG, platform: 'magento', message: 'Connected. Store currency EUR.',
    });
    expect(okMg.saved).toEqual([{ id: CONN_MG, kind: 'access_token', val: 'tok-12345678' }]);
    expect(okMg.adminCalls.map((c) => c.fn)).toEqual(['c2_connect_claim', 'c1_connection_upsert', 'c1_connection_set_status', 'c1_connection_record_sync']);

    const okPs = keyConnectHarness({
      adminRpc: async (fn) => {
        if (fn === 'c2_connect_claim') return { org_id: ORG, shop_domain: 'ps.example.com', store_url: 'https://ps.example.com/shop' };
        if (fn === 'c1_connection_upsert') return CONN_PS;
        return null;
      },
    });
    expect(await connectKeyStore(okPs.deps, { platform: 'prestashop', storeUrl: 'ps.example.com/shop', secretKey: 'PSKEY123456' })).toMatchObject({
      ok: true, connectionId: CONN_PS, platform: 'prestashop',
    });
    expect(okPs.saved).toEqual([{ id: CONN_PS, kind: 'api_key', val: 'PSKEY123456' }]);
  });

  it('retestKeyConnection updates status on success and marks needs_reconnect on AUTH_FAILED', async () => {
    const h1 = keyConnectHarness();
    expect(await retestKeyConnection(h1.deps, CONN_MG)).toEqual({ ok: true, message: 'Connected. Store currency EUR.' });
    expect(h1.adminCalls.find((c) => c.fn === 'c1_connection_set_status')?.args).toMatchObject({ p_status: 'active', p_reason: null });

    const { ConnectorError } = await import('@/lib/connectors/types');
    const h2 = keyConnectHarness({
      connector: () => ({ status: () => 'ready', testKey: async () => ({ ok: true, message: 'ok', currency: null }), testConnection: async () => { throw new ConnectorError('AUTH_FAILED', 'Token revoked'); } }),
    });
    expect(await retestKeyConnection(h2.deps, CONN_MG)).toEqual({ ok: false, message: 'Token revoked' });
    expect(h2.adminCalls.find((c) => c.fn === 'c1_connection_set_status')?.args).toMatchObject({ p_status: 'needs_reconnect', p_reason: 'Token revoked' });
  });

  it('integrates Magento and PrestaShop with the S1 runtime (order catch-up + send_tracking)', async () => {
    const mg = new MagentoConnector({
      key: async () => 'mg-tok',
      request: fakeStore((r) => (r.url.includes('/orders?') ? { status: 200, body: { items: [mgOrder], total_count: 1 } } : { status: 200, body: 1 })).request,
      env: MG_ENV,
    });
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const deps: RuntimeDeps = {
      rpc: async (fn, args = {}) => {
        calls.push({ fn, args });
        if (fn === 'c1_pull_targets') return [{ id: CONN_MG, org_id: ORG, platform: 'magento', shop_domain: 'mg.example.com', store_url: 'https://mg.example.com', last_sync_at: null }];
        if (fn === 'c1_task_claim') return [{ id: 't-mg', action: 'send_tracking', attempts: 1, store_order_id: 'so1', org_id: ORG, channel: 'magento', store_connection_id: CONN_MG, external_order_id: '501', external_order_name: '#501', order_number: 'SO-501', detail: { tracking_numbers: ['YT777'], tracking_token: 'ab'.repeat(16), carrier: 'yunexpress' } }];
        return { ok: true };
      },
      getConnector: () => mg,
      loadConnection: async () => mgConn,
      trackingCompany: async () => 'Other',
      fxToUsd: async () => 1.08,
      origin: 'https://track.example.com',
      now: () => new Date('2026-11-28T10:00:00Z'),
    };
    expect(await runOrderCatchup(deps, ['magento', 'prestashop'])).toMatchObject({ picked: 1, ok: 1 });
    expect(calls.find((c) => c.fn === 'ds_order_intake')?.args).toMatchObject({
      p_org: ORG,
      p_channel: 'magento',
      p_order: { external_order_id: '501', currency: 'EUR', fx_rate_to_usd: 1.08 },
    });
    expect(await runTasks(deps)).toMatchObject({ picked: 1, ok: 1 });
    expect(calls.find((c) => c.fn === 'c1_task_done')?.args).toEqual({ p_id: 't-mg', p_ok: true, p_error: null });
  });
});
