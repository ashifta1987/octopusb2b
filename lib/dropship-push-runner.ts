import 'server-only';
import {
  ShopifyAuthError,
  ShopifyGraphQLError,
  ShopifyHttpError,
  ShopifyThrottledError,
  type ShopifyAdminClient,
  type UserError,
} from '@/lib/shopify/admin-graphql';
import {
  COLLECTION_BY_TITLE_QUERY,
  INVENTORY_DEACTIVATE_MUTATION,
  INVENTORY_ZERO_MUTATION,
  PRODUCT_SET_MUTATION,
  buildInventoryZeroVariables,
  buildProductSetVariables,
  type PushPayload,
  type StockQuantityPolicy,
} from '@/lib/shopify/product-set';

/**
 * Octopus Dropship · Step 6 — runs ONE claimed push job against Shopify and says what to record.
 * The executor (Step 5 adds it: decrypts the store token, calls ds_push_claim as the service role, then this, then
 * ds_push_complete / ds_push_fail) is not wired yet — there is no store connection. Pure orchestration over an injected
 * client, unit-tested with a mocked fetch (tests/unit/dropship-push-runner.test.ts).
 * Messages are plain words for the merchant (they end up on Pushed products), never raw Shopify payloads or tokens.
 */

export type ClaimedJob = { id: string; kind: 'push' | 'unlink'; attempts: number; max_attempts: number; payload: Record<string, unknown> };

export type RunOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: string; message: string; retryAfterS: number | null; permanent: boolean };

export type RunnerDeps = {
  client: ShopifyAdminClient;
  locationGid: string;
  /** owner-set stock numbers per label; null = not set → the job waits (STOCK_POLICY_NOT_SET) */
  policy: StockQuantityPolicy | null;
  rand?: () => string;
};

type ProductSetData = {
  productSet: {
    product: { id: string; status: string; variants: { nodes: { id: string; sku: string | null; inventoryItem: { id: string } | null; selectedOptions: { name: string; value: string }[] }[] } } | null;
    userErrors: UserError[];
  };
};

function userErrorOutcome(errs: UserError[]): RunOutcome {
  const handle = errs.find((e) => (e.field ?? []).includes('handle') || /handle/i.test(e.message));
  if (handle) return { ok: false, code: 'HANDLE_TAKEN', message: 'Shopify said the handle is already used by another product in your store.', retryAfterS: null, permanent: true };
  const first = errs[0];
  const where = first?.field?.length ? ` (${first.field.filter((f) => !/^\d+$/.test(f)).join(' › ')})` : '';
  return { ok: false, code: first?.code ?? 'SHOPIFY_REFUSED', message: `Shopify refused the product${where}: ${first?.message ?? 'no reason given'}`.slice(0, 480), retryAfterS: null, permanent: true };
}

function errorOutcome(e: unknown): RunOutcome {
  if (e instanceof ShopifyAuthError) return { ok: false, code: 'STORE_ACCESS_EXPIRED', message: 'Store access expired during the push. Reconnect, then retry.', retryAfterS: null, permanent: true };
  if (e instanceof ShopifyThrottledError) return { ok: false, code: 'THROTTLED', message: `Shopify is busy · retrying in ${e.retryAfterS} s`, retryAfterS: e.retryAfterS, permanent: false };
  if (e instanceof ShopifyHttpError) return { ok: false, code: 'SHOPIFY_UNAVAILABLE', message: 'Shopify could not be reached. We will try again.', retryAfterS: null, permanent: false };
  if (e instanceof ShopifyGraphQLError) return { ok: false, code: 'SHOPIFY_ERROR', message: 'Shopify returned an error for this product.', retryAfterS: null, permanent: true };
  return { ok: false, code: 'UNEXPECTED', message: 'Something went wrong while pushing. We will try again.', retryAfterS: null, permanent: false };
}

export async function runPushJob(job: ClaimedJob, deps: RunnerDeps): Promise<RunOutcome> {
  if (!deps.locationGid) return { ok: false, code: 'NO_LOCATION', message: 'The Octopus Dropship location is missing in your store. Reconnect the store.', retryAfterS: null, permanent: true };
  try {
    if (job.kind === 'unlink') return await runUnlink(job, deps);
    if (!deps.policy) return { ok: false, code: 'STOCK_POLICY_NOT_SET', message: 'Waiting for Octopus to finish the stock settings.', retryAfterS: 3600, permanent: false };
    const p = job.payload as unknown as PushPayload;
    let collectionGid: string | null = null;
    if (p.collection) {
      // match the merchant's existing collection by title; we never create collections
      const q = await deps.client.request<{ collections: { nodes: { id: string; title: string }[] } }>(COLLECTION_BY_TITLE_QUERY, { q: `title:'${p.collection.replace(/'/g, "\\'")}'` }, { estimatedCost: 2 });
      collectionGid = q.data.collections.nodes.find((c) => c.title.toLowerCase() === p.collection!.toLowerCase())?.id ?? null;
    }
    const vars = buildProductSetVariables(p, { locationGid: deps.locationGid, policy: deps.policy, collectionGid, rand: deps.rand });
    const r = await deps.client.request<ProductSetData>(PRODUCT_SET_MUTATION, vars, { estimatedCost: 20 + p.variants.length * 2 });
    const ps = r.data.productSet;
    if (ps.userErrors?.length) return userErrorOutcome(ps.userErrors);
    if (!ps.product) return { ok: false, code: 'NO_PRODUCT', message: 'Shopify did not return the product. We will try again.', retryAfterS: null, permanent: false };
    // match returned variants to ours by option values (unique per product), never by SKU
    const variants = p.variants.map((v) => {
      const want = Object.entries(v.options ?? {});
      const node = ps.product!.variants.nodes.find((n) =>
        want.length === 0 ? ps.product!.variants.nodes.length === 1 : want.every(([k, val]) => n.selectedOptions.some((o) => o.name === k && o.value === val)));
      return { variant_id: v.variant_id, variant_gid: node?.id ?? null, inventory_item_gid: node?.inventoryItem?.id ?? null, sku: v.sku, price_minor: v.price_minor, compare_at_minor: v.compare_at_minor };
    });
    if (variants.some((v) => !v.variant_gid)) return { ok: false, code: 'VARIANT_MISMATCH', message: 'Shopify returned different variants than we sent. We will try again.', retryAfterS: null, permanent: false };
    return { ok: true, result: { product_gid: ps.product.id, store_status: ps.product.status, variants, collection_matched: p.collection ? Boolean(collectionGid) : null } };
  } catch (e) {
    return errorOutcome(e);
  }
}

/** stock to 0 at our location FIRST, then leave the location (Shopify keeps the product; sync stops) */
async function runUnlink(job: ClaimedJob, deps: RunnerDeps): Promise<RunOutcome> {
  const items = ((job.payload.inventory_item_gids as string[] | undefined) ?? []).filter(Boolean);
  if (items.length) {
    const z = await deps.client.request<{ inventorySetQuantities: { userErrors: UserError[] } }>(INVENTORY_ZERO_MUTATION, buildInventoryZeroVariables(items, deps.locationGid, job.id), { estimatedCost: 10 });
    if (z.data.inventorySetQuantities.userErrors?.length) {
      return { ok: false, code: 'STOCK_ZERO_FAILED', message: 'Could not set stock to 0 in your store yet. We will try again.', retryAfterS: 60, permanent: false };
    }
  }
  let kept = 0;
  for (const id of items) {
    const d = await deps.client.request<{ inventoryBulkToggleActivation: { userErrors: UserError[] } }>(INVENTORY_DEACTIVATE_MUTATION, { inventoryItemId: id, updates: [{ locationId: deps.locationGid, activate: false }] }, { estimatedCost: 10 });
    // Shopify refuses to deactivate an item's only location: it stays at 0 there, which already stops sales
    if (d.data.inventoryBulkToggleActivation.userErrors?.length) kept++;
  }
  return { ok: true, result: { zeroed: items.length, left_location: items.length - kept, kept_at_zero: kept } };
}
