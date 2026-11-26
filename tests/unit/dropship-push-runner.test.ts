import { describe, it, expect, vi } from 'vitest';
import { createShopifyAdminClient } from '@/lib/shopify/admin-graphql';
import { runPushJob, type ClaimedJob } from '@/lib/dropship-push-runner';

const ok = (data: unknown) => new Response(JSON.stringify({ data, extensions: { cost: { requestedQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 900, restoreRate: 50 } } } }), { status: 200 });

function deps(responses: Response[]) {
  const bodies: { query: string; variables: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    return r;
  }) as unknown as typeof fetch;
  const client = createShopifyAdminClient({ shopDomain: 'anna-home.myshopify.com', accessToken: 't', fetchImpl, sleep: async () => {}, random: () => 0.5 });
  return { bodies, d: { client, locationGid: 'gid://shopify/Location/1', policy: { in_stock: 50, low: 5, extended: 20 }, rand: () => 'r' } };
}

const pushJob = (over: Record<string, unknown> = {}): ClaimedJob => ({
  id: 'job-1', kind: 'push', attempts: 1, max_attempts: 6,
  payload: {
    listing_ref: 'ref-1', product_gid: null, title: 'Lamp', description_html: '<p>x</p>', vendor: 'Anna Home', product_type: null, tags: [], collection: null,
    handle: null, seo: null, status: 'DRAFT', images: ['https://x/a.jpg'], currency: 'USD', location_gid: 'gid://shopify/Location/1', sync: { stock: true, price: true },
    variants: [
      { variant_id: 'v1', model_no: 'DS-000001-01', sku: 'DS-000001-01', options: { Colour: 'Black' }, price_minor: 2599, compare_at_minor: null, stock_status: 'in_stock' },
      { variant_id: 'v2', model_no: 'DS-000001-02', sku: 'DS-000001-02', options: { Colour: 'Silver' }, price_minor: 2599, compare_at_minor: 3299, stock_status: 'low' },
    ],
    ...over,
  },
});

const product = {
  productSet: {
    product: {
      id: 'gid://shopify/Product/101', status: 'DRAFT',
      variants: { nodes: [
        { id: 'gid://shopify/ProductVariant/2', sku: 'DS-000001-02', inventoryItem: { id: 'gid://shopify/InventoryItem/32' }, selectedOptions: [{ name: 'Colour', value: 'Silver' }] },
        { id: 'gid://shopify/ProductVariant/1', sku: 'changed-in-shopify', inventoryItem: { id: 'gid://shopify/InventoryItem/31' }, selectedOptions: [{ name: 'Colour', value: 'Black' }] },
      ] },
    },
    userErrors: [],
  },
};

describe('push runner (one claimed job → what to record)', () => {
  it('push: matches returned variants by option values (never SKU) and returns IDs for ds_push_complete', async () => {
    const { d } = deps([ok(product)]);
    const r = await runPushJob(pushJob(), d);
    expect(r).toEqual({ ok: true, result: {
      product_gid: 'gid://shopify/Product/101', store_status: 'DRAFT', collection_matched: null,
      variants: [
        { variant_id: 'v1', variant_gid: 'gid://shopify/ProductVariant/1', inventory_item_gid: 'gid://shopify/InventoryItem/31', sku: 'DS-000001-01', price_minor: 2599, compare_at_minor: null },
        { variant_id: 'v2', variant_gid: 'gid://shopify/ProductVariant/2', inventory_item_gid: 'gid://shopify/InventoryItem/32', sku: 'DS-000001-02', price_minor: 2599, compare_at_minor: 3299 },
      ] } });
  });

  it('a handle already used in the store is a permanent failure with a plain reason', async () => {
    const { d } = deps([ok({ productSet: { product: null, userErrors: [{ field: ['input', 'handle'], message: 'Handle has already been taken', code: 'TAKEN' }] } })]);
    expect(await runPushJob(pushJob(), d)).toEqual({ ok: false, code: 'HANDLE_TAKEN', message: 'Shopify said the handle is already used by another product in your store.', retryAfterS: null, permanent: true });
  });

  it('expired store access → "Reconnect, then retry" (permanent); rate limit → retry later', async () => {
    const a = deps([new Response('', { status: 401 })]);
    expect(await runPushJob(pushJob(), a.d)).toMatchObject({ ok: false, code: 'STORE_ACCESS_EXPIRED', permanent: true });
    const r429 = () => new Response('', { status: 429, headers: { 'Retry-After': '20' } });
    const b = deps([r429(), r429(), r429(), r429(), r429(), r429()]);
    expect(await runPushJob(pushJob(), b.d)).toMatchObject({ ok: false, code: 'THROTTLED', retryAfterS: 20, permanent: false });
  });

  it('without the owner\u2019s stock numbers the push waits instead of guessing quantities', async () => {
    const { d, bodies } = deps([]);
    expect(await runPushJob(pushJob(), { ...d, policy: null })).toMatchObject({ ok: false, code: 'STOCK_POLICY_NOT_SET', permanent: false });
    expect(bodies).toHaveLength(0);
  });

  it('collection: matched by title in the store, never created', async () => {
    const { d, bodies } = deps([ok({ collections: { nodes: [{ id: 'gid://shopify/Collection/5', title: 'Home' }] } }), ok(product)]);
    const r = await runPushJob(pushJob({ collection: 'home' }), d);
    expect(r.ok && r.result.collection_matched).toBe(true);
    expect(bodies[1].variables.input).toMatchObject({ collections: ['gid://shopify/Collection/5'] });
    expect(bodies.some((b) => /collectionCreate/.test(b.query))).toBe(false);
  });

  it('unlink: stock to 0 at our location FIRST, then leave the location', async () => {
    const { d, bodies } = deps([
      ok({ inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: 'x' }, userErrors: [] } }),
      ok({ inventoryBulkToggleActivation: { userErrors: [] } }),
      ok({ inventoryBulkToggleActivation: { userErrors: [{ message: 'only location' }] } }),
    ]);
    const r = await runPushJob({ id: 'job-9', kind: 'unlink', attempts: 1, max_attempts: 6, payload: { product_gid: 'gid://shopify/Product/101', inventory_item_gids: ['gid://shopify/InventoryItem/31', 'gid://shopify/InventoryItem/32'], stock_to_zero_first: true } }, d);
    expect(bodies[0].query).toMatch(/inventorySetQuantities/);
    expect(bodies[1].query).toMatch(/inventoryBulkToggleActivation/);
    expect(r).toEqual({ ok: true, result: { zeroed: 2, left_location: 1, kept_at_zero: 1 } });
  });
});
