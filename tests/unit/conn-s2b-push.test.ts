import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runWooPushJob, wooProductBody, wooVariationBody, type WooCaller, type WooPushPayload } from '@/lib/connectors/woocommerce-push';
import { mediaPath, openMediaToken, storeMediaUrl } from '@/lib/connectors/media';
import { runPushJobs, runStockSync, type PushRuntimeDeps } from '@/lib/connectors/push-runtime';
import { processInbox, type RuntimeDeps } from '@/lib/connectors/runtime';
import { WooApiError, WooCommerceConnector, type StockItem } from '@/lib/connectors/woocommerce';
import { wooOrderToInternal } from '@/lib/connectors/woocommerce-map';
import { ConnectorError, type ConnectionRef } from '@/lib/connectors/types';
import type { storeRequest, StoreRequest } from '@/lib/connectors/http';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const conn: ConnectionRef = { id: CONN, orgId: ORG, platform: 'woocommerce', shopDomain: 'shop.example.com', storeUrl: 'https://shop.example.com' };
const SUPA = 'https://abc.supabase.co';
const IMG = `${SUPA}/storage/v1/object/public/product-media/products/sha/${'c'.repeat(64)}.jpg`;
const media = (u: string) => storeMediaUrl(u, { site: 'https://app.example.com', supabaseUrl: SUPA, key: 'k' });

const simple: WooPushPayload = {
  listing_ref: 'L1', product_gid: null, title: 'Desk lamp', description_html: '<p>Bright</p>', vendor: 'My brand', product_type: 'Lighting', tags: ['a'],
  collection: 'Lamps', handle: 'desk-lamp', status: 'DRAFT', images: [IMG, 'https://elsewhere.example/x.jpg'], currency: 'AED', sync: { stock: true, price: true },
  variants: [{ variant_id: 'v1', model_no: 'DS-000001-01', sku: 'LAMP-1', options: {}, price_minor: 15999, compare_at_minor: 19999, stock_status: 'low' }],
};
const variable: WooPushPayload = {
  ...simple, status: 'ACTIVE', collection: null,
  variants: [
    { variant_id: 'v1', model_no: 'DS-000001-01', sku: 'LAMP-R', options: { Color: 'Red' }, price_minor: 15999, compare_at_minor: null, stock_status: 'in_stock' },
    { variant_id: 'v2', model_no: 'DS-000001-02', sku: 'LAMP-B', options: { Color: 'Blue' }, price_minor: 15999, compare_at_minor: 15000, stock_status: 'out' },
  ],
};

function store(routes: (m: string, path: string, body: unknown) => unknown) {
  const calls: { m: string; path: string; body: unknown }[] = [];
  const call = (async (m: string, path: string, body?: unknown) => { calls.push({ m, path, body }); const r = routes(m, path, body); if (r instanceof Error) throw r; return r; }) as WooCaller;
  return { call, calls };
}
const job = (payload: unknown, kind: 'push' | 'unlink' = 'push') => ({ id: 'j1', kind, attempts: 1, max_attempts: 5, payload: payload as Record<string, unknown> });

describe('CONN S2b · media URLs (white-label image names)', () => {
  it('hands out a neutral, signed URL for our product images only', () => {
    const u = media(IMG)!;
    expect(u).toMatch(/^https:\/\/app\.example\.com\/api\/webhooks\/media\/[A-Za-z0-9_-]+\.[0-9a-f]{16}\/img-[0-9a-f]{8}\.jpg$/);
    expect(u).not.toContain('c'.repeat(64));
    expect(media('https://elsewhere.example/x.jpg')).toBeNull();
    expect(mediaPath(`${SUPA}/storage/v1/object/public/other-bucket/a.jpg`, SUPA)).toBeNull();
    const token = u.split('/')[6];
    expect(openMediaToken(token, 'k')).toBe(`products/sha/${'c'.repeat(64)}.jpg`);
    expect(openMediaToken(token, 'other-key')).toBeNull();
    expect(openMediaToken(token.replace(/.$/, (c) => (c === '0' ? '1' : '0')), 'k')).toBeNull();
    expect(openMediaToken(`${Buffer.from('../secret').toString('base64url')}.${'0'.repeat(16)}`, 'k')).toBeNull();
  });
});

describe('CONN S2b · WooCommerce product bodies', () => {
  it('simple product: SKU, sale logic (compare-at above price → sale), stock as in/out only, draft, our images only', () => {
    const b = wooProductBody(simple, { categoryId: 7, media }) as Record<string, unknown>;
    expect(b).toMatchObject({ name: 'Desk lamp', type: 'simple', status: 'draft', description: '<p>Bright</p>', slug: 'desk-lamp', sku: 'LAMP-1',
      regular_price: '199.99', sale_price: '159.99', manage_stock: false, stock_status: 'instock', categories: [{ id: 7 }] });
    expect((b.images as { src: string }[]).length).toBe(1);
    expect(JSON.stringify(b)).not.toMatch(/supplier|cost|DS-000001/i);
  });
  it('variable product: attributes from options, parent retry SKU, variations with their own prices / stock', () => {
    const b = wooProductBody(variable, { categoryId: null, media });
    expect(b).toMatchObject({ type: 'variable', status: 'publish', sku: 'LAMP-R-ALL', attributes: [{ name: 'Color', variation: true, options: ['Red', 'Blue'] }] });
    expect(b).not.toHaveProperty('categories');
    expect(wooVariationBody(variable.variants[1], ['Color'], 'AED')).toEqual({ sku: 'LAMP-B', regular_price: '159.99', sale_price: '', manage_stock: false, stock_status: 'outofstock', attributes: [{ name: 'Color', option: 'Blue' }] });
  });
});

describe('CONN S2b · push runner (mocked store)', () => {
  it('creates a simple product, matching the existing category by name (never creating one)', async () => {
    const s = store((m, path) => {
      if (path.startsWith('/products/categories')) return [{ id: 7, name: 'Lamps' }, { id: 8, name: 'Lamps &amp; more' }];
      if (m === 'GET' && path.startsWith('/products?sku=')) return [];
      if (m === 'POST' && path === '/products') return { id: 501, status: 'draft' };
      throw new Error(`unexpected ${m} ${path}`);
    });
    const r = await runWooPushJob(job(simple), { call: s.call, media });
    expect(r).toEqual({ ok: true, result: { product_gid: 'woocommerce:product:501', store_status: 'draft', collection_matched: true,
      variants: [{ variant_id: 'v1', variant_gid: 'woocommerce:product:501', inventory_item_gid: null, sku: 'LAMP-1', price_minor: 15999, compare_at_minor: 19999, stock_status: 'low' }] } });
    expect(s.calls.find((c) => c.m === 'POST')!.body).toMatchObject({ categories: [{ id: 7 }] });
    expect(s.calls.some((c) => c.m === 'POST' && c.path.includes('categories'))).toBe(false);
  });

  it('a retry after a crash finds the product by SKU instead of creating a second one', async () => {
    const s = store((m, path) => {
      if (path.startsWith('/products/categories')) return [];
      if (m === 'GET' && path.startsWith('/products?sku=LAMP-1')) return [{ id: 501 }];
      if (m === 'PUT' && path === '/products/501') return { id: 501, status: 'draft' };
      throw new Error(`unexpected ${m} ${path}`);
    });
    const r = await runWooPushJob(job(simple), { call: s.call, media });
    expect(r).toMatchObject({ ok: true, result: { product_gid: 'woocommerce:product:501', collection_matched: false } });
    expect(s.calls.some((c) => c.m === 'POST' && c.path === '/products')).toBe(false);
  });

  it('re-push updates the linked product; a product the merchant deleted is created again', async () => {
    const linked = { ...simple, collection: null, product_gid: 'woocommerce:product:501' };
    const a = store((m, path) => (m === 'GET' && path === '/products/501' ? { id: 501, status: 'publish' } : m === 'PUT' ? { id: 501, status: 'publish' } : new Error(`${m} ${path}`)));
    expect(await runWooPushJob(job(linked), { call: a.call, media })).toMatchObject({ ok: true, result: { store_status: 'active' } });
    const b = store((m, path) => (m === 'GET' && path === '/products/501' ? new WooApiError(404, 'Not found in the store.') : m === 'GET' ? [] : m === 'POST' ? { id: 777, status: 'draft' } : new Error(`${m} ${path}`)));
    expect(await runWooPushJob(job(linked), { call: b.call, media })).toMatchObject({ ok: true, result: { product_gid: 'woocommerce:product:777' } });
  });

  it('variable product: creates new variations, updates linked ones, records each variation id', async () => {
    const p = { ...variable, product_gid: 'woocommerce:product:9', variants: [{ ...variable.variants[0], variant_gid: 'woocommerce:variation:31' }, variable.variants[1]] };
    let batch: { create: unknown[]; update: { id: number }[] } | null = null;
    const s = store((m, path, body) => {
      if (m === 'GET' && path === '/products/9') return { id: 9, status: 'publish' };
      if (m === 'PUT' && path === '/products/9') return { id: 9, status: 'publish' };
      if (m === 'GET' && path.startsWith('/products/9/variations')) return [{ id: 31, sku: 'LAMP-R' }];
      if (m === 'POST' && path === '/products/9/variations/batch') { batch = body as typeof batch; return { create: [{ id: 32 }], update: [{ id: 31 }] }; }
      return new Error(`unexpected ${m} ${path}`);
    });
    const r = await runWooPushJob(job(p), { call: s.call, media });
    expect(batch!.update.map((u) => u.id)).toEqual([31]);
    expect(batch!.create).toHaveLength(1);
    expect(r).toMatchObject({ ok: true, result: { variants: [{ variant_id: 'v1', variant_gid: 'woocommerce:variation:31' }, { variant_id: 'v2', variant_gid: 'woocommerce:variation:32', stock_status: 'out' }] } });
  });

  it('says why: refused product (permanent, store words), store down (retry), keys refused (permanent, reconnect), refused variant', async () => {
    const run = (err: Error) => runWooPushJob(job({ ...simple, collection: null }), { call: store(() => err).call, media });
    expect(await run(new WooApiError(400, 'The store refused the request (HTTP 400, product_invalid_sku): Invalid or duplicated SKU.'))).toMatchObject({ ok: false, code: 'STORE_REFUSED', permanent: true, message: expect.stringMatching(/duplicated SKU/) });
    expect(await run(new WooApiError(503, 'The store had an error (HTTP 503). We will try again.'))).toMatchObject({ ok: false, code: 'STORE_UNAVAILABLE', permanent: false });
    expect(await run(new WooApiError(429, 'busy'))).toMatchObject({ ok: false, retryAfterS: 120, permanent: false });
    expect(await run(new ConnectorError('UNREACHABLE', 'x'))).toMatchObject({ ok: false, code: 'STORE_UNAVAILABLE', permanent: false });
    expect(await run(new ConnectorError('AUTH_FAILED', 'x'))).toMatchObject({ ok: false, code: 'STORE_ACCESS_EXPIRED', permanent: true });
    const v = store((m, path) => (path.includes('variations/batch') ? { create: [{ error: { message: '<b>Invalid</b> SKU' } }, { id: 2 }] } : path.includes('/variations') ? [] : m === 'GET' ? [] : { id: 9, status: 'draft' }));
    expect(await runWooPushJob(job(variable), { call: v.call, media })).toMatchObject({ ok: false, code: 'VARIANT_REFUSED', permanent: true, message: 'WooCommerce refused a variant: Invalid SKU' });
  });

  it('unlink sets every variation (or the product) out of stock; a product already gone is fine', async () => {
    const a = store((m) => (m === 'GET' ? { id: 9, type: 'variable', variations: [31, 32] } : { update: [] }));
    expect(await runWooPushJob(job({ product_gid: 'woocommerce:product:9' }, 'unlink'), { call: a.call, media })).toEqual({ ok: true, result: { out_of_stock: 2 } });
    expect(a.calls[1]).toEqual({ m: 'POST', path: '/products/9/variations/batch', body: { update: [{ id: 31, manage_stock: false, stock_status: 'outofstock' }, { id: 32, manage_stock: false, stock_status: 'outofstock' }] } });
    const b = store((m) => (m === 'GET' ? { id: 9, type: 'simple' } : { id: 9 }));
    expect(await runWooPushJob(job({ product_gid: 'woocommerce:product:9' }, 'unlink'), { call: b.call, media })).toEqual({ ok: true, result: { out_of_stock: 1 } });
    const c = store(() => new WooApiError(404, 'gone'));
    expect(await runWooPushJob(job({ product_gid: 'woocommerce:product:9' }, 'unlink'), { call: c.call, media })).toMatchObject({ ok: true });
  });
});

function pushDeps(over: Partial<PushRuntimeDeps> = {}, data: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const deps: PushRuntimeDeps = {
    rpc: async (fn, args = {}) => { calls.push({ fn, args }); return data[fn] ?? null; },
    loadConnection: async (id) => (id === CONN ? conn : null),
    wooCaller: () => store((m) => (m === 'GET' ? [] : { id: 501, status: 'draft' })).call,
    setStockStatus: async (_c, items) => items.map((item) => ({ item, ok: true })),
    media,
    ...over,
  };
  return { deps, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}
const claimed = (over: Record<string, unknown> = {}) => ({ id: 'j1', kind: 'push', attempts: 1, max_attempts: 5, payload: { ...simple, collection: null }, store_connection_id: CONN, platform: 'woocommerce', org_id: ORG, product_id: 'p1', ...over });

describe('CONN S2b · push + stock loops', () => {
  it('claims WooCommerce jobs only and completes them with the result', async () => {
    const h = pushDeps({}, { c2b_push_claim: [claimed()] });
    expect(await runPushJobs(h.deps)).toMatchObject({ picked: 1, ok: 1 });
    expect(h.of('c2b_push_claim')[0].args).toMatchObject({ p_platforms: ['woocommerce'] });
    expect(h.of('ds_push_complete')[0].args).toMatchObject({ p_job_id: 'j1', p_result: { product_gid: 'woocommerce:product:501' } });
  });

  it('fails with the reason; refused keys mark the store "needs reconnect" once; a disconnected store fails for good', async () => {
    const h = pushDeps({ wooCaller: () => store(() => new ConnectorError('AUTH_FAILED', 'x')).call }, { c2b_push_claim: [claimed(), claimed({ id: 'j2' }), claimed({ id: 'j3', store_connection_id: '33333333-3333-4333-8333-333333333333' })] });
    expect(await runPushJobs(h.deps)).toMatchObject({ picked: 3, failed: 3 });
    expect(h.of('ds_push_fail').map((c) => [c.args.p_job_id, c.args.p_code, c.args.p_permanent])).toEqual([['j1', 'STORE_ACCESS_EXPIRED', true], ['j2', 'STORE_ACCESS_EXPIRED', true], ['j3', 'STORE_NOT_CONNECTED', true]]);
    expect(h.of('c1_connection_set_status')).toHaveLength(1);
  });

  it('stock: one call per store with in / out of stock, results recorded per variant', async () => {
    let asked: StockItem[] = [];
    const t = (v: string, label: string) => ({ product_link_id: 'l1', variant_id: v, org_id: ORG, store_connection_id: CONN, platform: 'woocommerce', product_id: 'p1', product_gid: 'woocommerce:product:9', variant_gid: `woocommerce:variation:${v === 'v1' ? 31 : 32}`, label });
    const h = pushDeps({ setStockStatus: async (_c, items) => { asked = items; return items.map((item, i) => ({ item, ok: i === 0, error: i ? 'Invalid ID.' : undefined })); } }, { c2b_stock_targets: [t('v1', 'out'), t('v2', 'low')] });
    expect(await runStockSync(h.deps)).toMatchObject({ picked: 2, ok: 1, failed: 1 });
    expect(asked.map((x) => x.status)).toEqual(['outofstock', 'instock']);
    expect(h.of('c2b_stock_done')[0].args.p_items).toEqual([
      { product_link_id: 'l1', variant_id: 'v1', label: 'out', ok: true, error: undefined },
      { product_link_id: 'l1', variant_id: 'v2', label: 'low', ok: false, error: 'Invalid ID.' },
    ]);
  });
});

describe('CONN S2b · WooCommerce stock call + order matching by store id', () => {
  it('updates simple products on the product and variations in one batch', async () => {
    const calls: StoreRequest[] = [];
    const request = (async (r: StoreRequest) => { calls.push(r); return { status: 200, headers: {}, body: r.url.includes('batch') ? JSON.stringify({ update: [{ id: 31 }, { id: 32, error: { message: 'Invalid ID.' } }] }) : '{"id":5}' }; }) as unknown as typeof storeRequest;
    const c = new WooCommerceConnector({ keys: async () => ({ consumerKey: `ck_${'1'.repeat(40)}`, consumerSecret: `cs_${'2'.repeat(40)}` }), request, env: { CONNECTOR_TOKEN_KEY: crypto.randomBytes(32).toString('base64'), CONNECTOR_WOOCOMMERCE: 'on' } as unknown as NodeJS.ProcessEnv });
    const items: StockItem[] = [
      { productGid: 'woocommerce:product:5', variantGid: 'woocommerce:product:5', status: 'outofstock' },
      { productGid: 'woocommerce:product:9', variantGid: 'woocommerce:variation:31', status: 'instock' },
      { productGid: 'woocommerce:product:9', variantGid: 'woocommerce:variation:32', status: 'outofstock' },
      { productGid: 'gid://shopify/Product/1', variantGid: 'x', status: 'instock' },
    ];
    const r = await c.setStockStatus(conn, items);
    expect(r.map((x) => [x.item.variantGid, x.ok])).toEqual([['x', false], ['woocommerce:product:5', true], ['woocommerce:variation:31', true], ['woocommerce:variation:32', false]]);
    expect(calls.map((x) => `${x.method} ${new URL(x.url).pathname}`)).toEqual(['PUT /wp-json/wc/v3/products/5', 'POST /wp-json/wc/v3/products/9/variations/batch']);
  });

  it('an order line with a changed SKU is matched to the pushed variant by its WooCommerce id', async () => {
    const o = { id: 1001, status: 'processing', currency: 'USD', shipping: { first_name: 'A', address_1: 'x', city: 'Dubai', country: 'AE' },
      line_items: [{ id: 1, sku: 'MY-OWN-SKU', product_id: 9, variation_id: 32, quantity: 1, subtotal: '20.00', total: '20.00' }, { id: 2, sku: '', product_id: 0, quantity: 2, total: '5.00' }] };
    const mapped = wooOrderToInternal(o);
    expect(mapped).toMatchObject({ otherItems: 2, lines: [{ modelNo: null, storeVariantRef: 'woocommerce:variation:32', buyerPaidMinor: 2000 }] });
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const deps: RuntimeDeps = {
      rpc: async (fn, args = {}) => { calls.push({ fn, args }); return fn === 'c1_webhook_claim' ? [{ id: 'w1', source: 'woocommerce', topic: 'order.created', payload: o, store_connection_id: CONN, org_id: ORG, attempts: 1 }] : { ok: true }; },
      getConnector: () => new WooCommerceConnector({ keys: async () => null, env: {} as NodeJS.ProcessEnv }),
      loadConnection: async () => conn, trackingCompany: async () => 'Other', origin: null,
      resolveStoreVariants: async (id, refs) => { expect(id).toBe(CONN); expect(refs).toEqual(['woocommerce:variation:32']); return { 'woocommerce:variation:32': '44444444-4444-4444-8444-444444444444' }; },
    };
    await processInbox(deps);
    const order = calls.find((c) => c.fn === 'ds_order_intake')!.args.p_order as { lines: { variant_id?: string; model_no?: string }[]; other_items?: number };
    expect(order.lines[0]).toMatchObject({ variant_id: '44444444-4444-4444-8444-444444444444' });
    expect(order.other_items).toBe(2);
  });
});
