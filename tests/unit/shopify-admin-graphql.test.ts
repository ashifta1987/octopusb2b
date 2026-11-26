import { describe, it, expect, vi } from 'vitest';
import {
  createShopifyAdminClient, ShopifyAuthError, ShopifyHttpError, ShopifyThrottledError, SHOPIFY_API_VERSION,
} from '@/lib/shopify/admin-graphql';
import { buildInventoryZeroVariables, buildProductSetVariables, quantityFor, randomImageName, shopifyAmount, type PushPayload } from '@/lib/shopify/product-set';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const ok = (data: unknown, available = 990) => json({ data, extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: available, restoreRate: 50 } } } });

function client(responses: (Response | Error)[], extra: Partial<Parameters<typeof createShopifyAdminClient>[0]> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const c = createShopifyAdminClient({ shopDomain: 'anna-home.myshopify.com', accessToken: 'shpat_test_token', fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, now: () => 1_000_000, ...extra });
  return { c, calls, sleeps };
}

describe('Shopify Admin GraphQL client (mocked fetch)', () => {
  it('posts to the versioned Admin API with the token header, never in the URL', async () => {
    const { c, calls } = client([ok({ shop: { name: 'x' } })]);
    const r = await c.request('{ shop { name } }', { a: 1 });
    expect(r.data).toEqual({ shop: { name: 'x' } });
    expect(calls[0].url).toBe(`https://anna-home.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
    expect(SHOPIFY_API_VERSION).toBe('2026-10');
    expect((calls[0].init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('shpat_test_token');
    expect(calls[0].url).not.toContain('shpat');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ query: '{ shop { name } }', variables: { a: 1 } });
  });

  it('refuses a shop domain that is not *.myshopify.com', () => {
    expect(() => createShopifyAdminClient({ shopDomain: 'evil.com', accessToken: 't' })).toThrow(/Invalid shop domain/);
    expect(() => createShopifyAdminClient({ shopDomain: 'a.myshopify.com.evil.com', accessToken: 't' })).toThrow(/Invalid shop domain/);
  });

  it('THROTTLED: waits ceil((requested − available) / restoreRate) seconds, then retries', async () => {
    const throttled = json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 300, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 50 } } } });
    const { c, sleeps, calls } = client([throttled, ok({ x: 1 })]);
    await expect(c.request('mutation { x }')).resolves.toMatchObject({ data: { x: 1 } });
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(5000); // (300 − 50) / 50 = 5 s
  });

  it('HTTP 429 waits Retry-After; gives up after maxRetries with a throttled error', async () => {
    const r429 = () => new Response('', { status: 429, headers: { 'Retry-After': '3' } });
    const a = client([r429(), ok({ y: 2 })]);
    await expect(a.c.request('{ y }')).resolves.toMatchObject({ data: { y: 2 } });
    expect(a.sleeps).toEqual([3000]);
    const b = client([r429(), r429(), r429()], { maxRetries: 2 });
    await expect(b.c.request('{ y }')).rejects.toBeInstanceOf(ShopifyThrottledError);
  });

  it('5xx and network errors back off exponentially with jitter, then fail', async () => {
    const a = client([new Response('', { status: 502 }), new Error('ECONNRESET'), ok({ z: 3 })]);
    await expect(a.c.request('{ z }')).resolves.toMatchObject({ data: { z: 3 } });
    expect(a.sleeps).toEqual([375, 750]); // 500·2^n halved + jitter(0.5)
    const b = client([new Response('', { status: 500 }), new Response('', { status: 500 })], { maxRetries: 1 });
    await expect(b.c.request('{ z }')).rejects.toBeInstanceOf(ShopifyHttpError);
  });

  it('401 / 403 → reconnect needed, no retry, token not in the message', async () => {
    const { c, calls } = client([new Response('', { status: 401 })]);
    const e = await c.request('{ shop { name } }').catch((x) => x);
    expect(e).toBeInstanceOf(ShopifyAuthError);
    expect(String(e.message)).not.toContain('shpat');
    expect(calls).toHaveLength(1);
  });

  it('cost throttling: waits before a call when the bucket is too low for the estimated cost', async () => {
    const { c, sleeps } = client([ok({ a: 1 }, 10), ok({ b: 2 })]);
    await c.request('{ a }');
    expect(c.throttle()).toEqual({ maximumAvailable: 1000, currentlyAvailable: 10, restoreRate: 50 });
    await c.request('{ b }', {}, { estimatedCost: 120 });
    expect(sleeps).toEqual([3000]); // (120 − 10) / 50 → 3 s
  });
});

const payload = (over: Partial<PushPayload> = {}): PushPayload => ({
  listing_ref: '7f6c2c1e-0000-4000-8000-000000000001',
  product_gid: null,
  title: 'Quiet desk lamp',
  description_html: '<p>Bright</p>',
  vendor: 'Anna Home',
  product_type: 'Lighting',
  tags: ['lamp'],
  collection: null,
  handle: 'quiet-desk-lamp',
  seo: { title: 'Quiet desk lamp', description: 'A lamp' },
  status: 'DRAFT',
  images: ['https://x.supabase.co/storage/v1/object/public/product-media/products/sha/c0728a357ec7.jpg', 'https://x.supabase.co/a/factory-photo.PNG?token=1'],
  currency: 'KWD',
  location_gid: 'gid://shopify/Location/1',
  sync: { stock: true, price: true },
  variants: [
    { variant_id: 'v1', model_no: 'DS-000001-01', sku: 'DS-000001-01', options: { Colour: 'Black' }, price_minor: 12990, compare_at_minor: 15990, stock_status: 'in_stock' },
    { variant_id: 'v2', model_no: 'DS-000001-02', sku: 'ANNA-LAMP-S', options: { Colour: 'Silver' }, price_minor: 12990, compare_at_minor: null, stock_status: 'out' },
  ],
  ...over,
});

describe('productSet payload builder', () => {
  const policy = { in_stock: 50, low: 5, extended: 20 };
  it('inventory only at the Octopus Dropship location; out of stock = 0; SKU and prices (3-decimal currency)', () => {
    const v = buildProductSetVariables(payload(), { locationGid: 'gid://shopify/Location/1', policy, rand: () => 'abc123' });
    const vars = v.input.variants as { inventoryQuantities: { locationId: string; quantity: number }[]; price: string; compareAtPrice: string | null; inventoryItem: Record<string, unknown> }[];
    expect(vars.map((x) => x.inventoryQuantities)).toEqual([[{ locationId: 'gid://shopify/Location/1', name: 'available', quantity: 50 }], [{ locationId: 'gid://shopify/Location/1', name: 'available', quantity: 0 }]]);
    expect(vars.map((x) => x.price)).toEqual(['12.990', '12.990']);
    expect(vars[0].compareAtPrice).toBe('15.990');
    expect(vars[1].inventoryItem).toEqual({ sku: 'ANNA-LAMP-S', tracked: true });
    expect(JSON.stringify(v)).not.toMatch(/cost|supplier|octopus/i);
    expect(v.synchronous).toBe(true);
  });

  it('images get random file names (never the original name); alt from the title', () => {
    const v = buildProductSetVariables(payload(), { locationGid: 'gid://shopify/Location/1', policy, rand: () => 'r4nd0m' });
    const files = v.input.files as { filename: string; alt: string; originalSource: string }[];
    expect(files.map((f) => f.filename)).toEqual(['img-r4nd0m.jpg', 'img-r4nd0m.png']);
    expect(files.every((f) => f.alt === 'Quiet desk lamp')).toBe(true);
    expect(randomImageName('https://a/b/factory.jpeg')).toMatch(/^img-[0-9a-f]{16}\.jpg$/);
  });

  it('first push upserts by the app listing_ref metafield; re-push by the saved product ID', () => {
    const first = buildProductSetVariables(payload(), { locationGid: 'L', policy });
    expect(first.identifier).toEqual({ customId: { namespace: '$app:ds', key: 'listing_ref', value: '7f6c2c1e-0000-4000-8000-000000000001' } });
    const again = buildProductSetVariables(payload({ product_gid: 'gid://shopify/Product/9', variants: [{ ...payload().variants[0], variant_gid: 'gid://shopify/ProductVariant/7' }] }), { locationGid: 'L', policy });
    expect(again.identifier).toEqual({ id: 'gid://shopify/Product/9' });
    expect((again.input.variants as { id?: string }[])[0].id).toBe('gid://shopify/ProductVariant/7');
  });

  it('a product without options gets Shopify\u2019s default Title option', () => {
    const v = buildProductSetVariables(payload({ variants: [{ ...payload().variants[0], options: {} }] }), { locationGid: 'L', policy });
    expect(v.input.productOptions).toEqual([{ name: 'Title', values: [{ name: 'Default Title' }] }]);
  });

  it('unlink: all items to 0 at our location, idempotency key per job, no compare-and-swap', () => {
    const z = buildInventoryZeroVariables(['gid://shopify/InventoryItem/1'], 'gid://shopify/Location/1', 'job-1');
    expect(z.key).toBe('ds-unlink-job-1');
    expect(z.input.quantities).toEqual([{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1', quantity: 0, changeFromQuantity: null }]);
    expect(quantityFor('out', policy)).toBe(0);
    expect(shopifyAmount(15999, 'AED')).toBe('159.99');
  });
});
