/**
 * CONN S2b · runs ONE claimed push / unlink job against WooCommerce and says what to record (ds_push_complete / ds_push_fail).
 * Pure orchestration over an injected REST caller (unit-tested with a mocked store). The payload is the DS6 merchant-safe payload
 * (listing copy, model numbers / store SKUs, prices in minor units, stock labels; never supplier, cost or sourcing fields).
 *   - one product per listing: simple when no variant has options, else variable (attributes + variations batch);
 *   - prices: regular = compare-at when it is above the price (sale = price), else regular = price;
 *   - stock: "in stock" / "out of stock" only (we never manage quantities in the merchant's store);
 *   - images through our neutral media URLs (media.ts), never the storage path; the merchant's existing category is matched by
 *     name (never created); a retry never creates a second product (existing link id, then SKU lookup);
 *   - unlink: every variant "out of stock" first, the product stays in the store and stops syncing.
 * Messages are plain words for the merchant (they show on Pushed products), never raw store answers or keys.
 */
import { minorToDecimal } from './formats';
import { ConnectorError } from './types';

export type WooPushVariant = {
  variant_id: string; model_no: string; sku: string; options: Record<string, string> | null; price_minor: number; compare_at_minor: number | null;
  stock_status: 'in_stock' | 'low' | 'out' | 'extended'; variant_gid?: string | null;
};
export type WooPushPayload = {
  listing_ref: string; product_gid: string | null; title: string; description_html: string; vendor: string | null; product_type: string | null;
  tags: string[] | null; collection: string | null; handle: string | null; status: 'DRAFT' | 'ACTIVE'; images: string[] | string | null; currency: string;
  sync: { stock: boolean; price: boolean }; variants: WooPushVariant[];
};
export type ClaimedPushJob = { id: string; kind: 'push' | 'unlink'; attempts: number; max_attempts: number; payload: Record<string, unknown> };
export type PushOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: string; message: string; retryAfterS: number | null; permanent: boolean };

export type WooCaller = <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<T>;
export type WooPushDeps = { call: WooCaller; media: (url: string) => string | null };

const P = /^woocommerce:product:(\d{1,20})$/;
const V = /^woocommerce:variation:(\d{1,20})$/;
const stock = (s: WooPushVariant['stock_status']) => (s === 'out' ? 'outofstock' : 'instock');
function prices(v: WooPushVariant, currency: string) {
  const price = minorToDecimal(v.price_minor, currency);
  if (v.compare_at_minor != null && v.compare_at_minor > v.price_minor) return { regular_price: minorToDecimal(v.compare_at_minor, currency), sale_price: price };
  return { regular_price: price, sale_price: '' };
}

export function optionNames(p: WooPushPayload): string[] {
  const names: string[] = [];
  for (const v of p.variants) for (const k of Object.keys(v.options ?? {})) if (!names.includes(k)) names.push(k);
  return names;
}

/** the product body (without variations) */
export function wooProductBody(p: WooPushPayload, opts: { categoryId: number | null; media: (url: string) => string | null }) {
  const names = optionNames(p);
  const variable = names.length > 0;
  const urls = (Array.isArray(p.images) ? p.images : p.images ? [p.images] : []).slice(0, 10);
  const images = urls.map((u) => opts.media(u)).filter((u): u is string => Boolean(u)).map((src) => ({ src }));
  const base: Record<string, unknown> = {
    name: p.title.slice(0, 200),
    type: variable ? 'variable' : 'simple',
    status: p.status === 'ACTIVE' ? 'publish' : 'draft',
    description: p.description_html,
    ...(p.handle ? { slug: p.handle } : {}),
    ...(images.length ? { images } : {}),
    ...(opts.categoryId ? { categories: [{ id: opts.categoryId }] } : {}),
  };
  if (!variable) {
    const v = p.variants[0];
    return { ...base, sku: v.sku, ...prices(v, p.currency), manage_stock: false, stock_status: stock(v.stock_status) };
  }
  return {
    ...base,
    // the parent's own SKU is the retry guard for variable products (never shown to buyers on variable products in default themes)
    sku: `${p.variants[0].sku}-ALL`,
    attributes: names.map((name, i) => ({ name, position: i, visible: true, variation: true, options: [...new Set(p.variants.map((v) => v.options?.[name]).filter((x): x is string => Boolean(x)))] })),
  };
}

export const wooVariationBody = (v: WooPushVariant, names: string[], currency: string) => ({
  sku: v.sku, ...prices(v, currency), manage_stock: false, stock_status: stock(v.stock_status),
  attributes: names.map((name) => ({ name, option: v.options?.[name] ?? '-' })),
});

function outcome(e: unknown): PushOutcome {
  if (e instanceof ConnectorError) {
    if (e.code === 'AUTH_FAILED') return { ok: false, code: 'STORE_ACCESS_EXPIRED', message: 'The store refused our keys. Reconnect WooCommerce, then retry.', retryAfterS: null, permanent: true };
    if (e.code === 'UNREACHABLE') return { ok: false, code: 'STORE_UNAVAILABLE', message: 'The store could not be reached. We will try again.', retryAfterS: null, permanent: false };
    const status = (e as ConnectorError & { status?: number }).status ?? 0;
    if (status === 429 || status >= 500) return { ok: false, code: 'STORE_UNAVAILABLE', message: e.message.slice(0, 480), retryAfterS: status === 429 ? 120 : null, permanent: false };
    return { ok: false, code: 'STORE_REFUSED', message: `WooCommerce refused the product: ${e.message}`.slice(0, 480), retryAfterS: null, permanent: true };
  }
  return { ok: false, code: 'UNEXPECTED', message: 'Something went wrong while pushing. We will try again.', retryAfterS: null, permanent: false };
}

async function findCategory(call: WooCaller, name: string | null): Promise<number | null> {
  if (!name) return null;
  const list = await call<{ id: number; name: string }[]>('GET', `/products/categories?per_page=50&search=${encodeURIComponent(name)}`);
  const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
  return (Array.isArray(list) ? list : []).find((c) => decode(c.name).toLowerCase() === name.toLowerCase())?.id ?? null;
}

async function existingId(call: WooCaller, p: WooPushPayload, sku: string): Promise<string | null> {
  const linked = P.exec(p.product_gid ?? '')?.[1];
  if (linked) {
    try { const got = await call<{ id?: number; status?: string }>('GET', `/products/${linked}`); if (got?.id && got.status !== 'trash') return String(got.id); }
    catch (e) { if (!(e instanceof ConnectorError && e.code === 'INVALID_INPUT')) throw e; } // 404: the merchant deleted it → create again
  }
  const found = await call<{ id: number }[]>('GET', `/products?sku=${encodeURIComponent(sku)}&per_page=1`);
  return Array.isArray(found) && found[0]?.id ? String(found[0].id) : null;
}

export async function runWooPushJob(job: ClaimedPushJob, deps: WooPushDeps): Promise<PushOutcome> {
  try {
    if (job.kind === 'unlink') return await runWooUnlink(job, deps);
    const p = job.payload as unknown as WooPushPayload;
    if (!p?.variants?.length) return { ok: false, code: 'NO_VARIANTS', message: 'No variant of this product can be pushed.', retryAfterS: null, permanent: true };
    const categoryId = await findCategory(deps.call, p.collection);
    const body = wooProductBody(p, { categoryId, media: deps.media });
    const id = await existingId(deps.call, p, String(body.sku));
    const product = id
      ? await deps.call<{ id: number; status: string }>('PUT', `/products/${id}`, body)
      : await deps.call<{ id: number; status: string }>('POST', '/products', body);
    if (!product?.id) return { ok: false, code: 'NO_PRODUCT', message: 'WooCommerce did not return the product. We will try again.', retryAfterS: null, permanent: false };
    const names = optionNames(p);
    let variants: { variant_id: string; variant_gid: string | null }[];
    if (!names.length) {
      variants = [{ variant_id: p.variants[0].variant_id, variant_gid: `woocommerce:product:${product.id}` }];
    } else {
      // match to existing variations by our link id, else by SKU (a retry after a crash), else create
      const existing = await deps.call<{ id: number; sku: string }[]>('GET', `/products/${product.id}/variations?per_page=100`);
      const bySku = new Map((Array.isArray(existing) ? existing : []).filter((x) => x.sku).map((x) => [x.sku, x.id]));
      const ids = new Set((Array.isArray(existing) ? existing : []).map((x) => x.id));
      const plan = p.variants.map((v) => {
        const linked = Number(V.exec(v.variant_gid ?? '')?.[1] ?? 0);
        const vid = linked && ids.has(linked) ? linked : bySku.get(v.sku) ?? null;
        return { v, vid };
      });
      const update = plan.filter((x) => x.vid).map((x) => ({ id: x.vid, ...wooVariationBody(x.v, names, p.currency) }));
      const create = plan.filter((x) => !x.vid).map((x) => wooVariationBody(x.v, names, p.currency));
      const r = await deps.call<{ create?: { id?: number; error?: { message?: string } }[]; update?: { id?: number; error?: { message?: string } }[] }>(
        'POST', `/products/${product.id}/variations/batch`, { create, update });
      const failed = [...(r.create ?? []), ...(r.update ?? [])].find((x) => x.error || !x.id);
      if (failed) return { ok: false, code: 'VARIANT_REFUSED', message: `WooCommerce refused a variant: ${(failed.error?.message ?? 'no reason given').replace(/<[^>]*>/g, '')}`.slice(0, 480), retryAfterS: null, permanent: true };
      let c = 0;
      variants = plan.map((x) => ({ variant_id: x.v.variant_id, variant_gid: `woocommerce:variation:${x.vid ?? r.create?.[c++]?.id}` }));
    }
    const byId = new Map(p.variants.map((v) => [v.variant_id, v]));
    return {
      ok: true,
      result: {
        product_gid: `woocommerce:product:${product.id}`,
        store_status: product.status === 'publish' ? 'active' : 'draft',
        collection_matched: p.collection ? Boolean(categoryId) : null,
        variants: variants.map((x) => {
          const v = byId.get(x.variant_id)!;
          return { variant_id: x.variant_id, variant_gid: x.variant_gid, inventory_item_gid: null, sku: v.sku, price_minor: v.price_minor, compare_at_minor: v.compare_at_minor, stock_status: v.stock_status };
        }),
      },
    };
  } catch (e) {
    return outcome(e);
  }
}

async function runWooUnlink(job: ClaimedPushJob, deps: WooPushDeps): Promise<PushOutcome> {
  const id = P.exec(String(job.payload.product_gid ?? ''))?.[1];
  if (!id) return { ok: true, result: { out_of_stock: 0, note: 'no store product' } };
  let product: { id: number; type?: string; variations?: number[] };
  try { product = await deps.call('GET', `/products/${id}`); }
  catch (e) { if (e instanceof ConnectorError && e.code === 'INVALID_INPUT') return { ok: true, result: { out_of_stock: 0, note: 'already gone from the store' } }; throw e; }
  if (product.type === 'variable' && product.variations?.length) {
    await deps.call('POST', `/products/${id}/variations/batch`, { update: product.variations.slice(0, 100).map((v) => ({ id: v, manage_stock: false, stock_status: 'outofstock' })) });
    return { ok: true, result: { out_of_stock: Math.min(100, product.variations.length) } };
  }
  await deps.call('PUT', `/products/${id}`, { manage_stock: false, stock_status: 'outofstock' });
  return { ok: true, result: { out_of_stock: 1 } };
}
