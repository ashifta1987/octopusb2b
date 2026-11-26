import 'server-only';
import { randomBytes } from 'node:crypto';
import { currencyExponent } from '@/lib/dropship-pricing';

/**
 * Octopus Dropship · Step 6 — builds Shopify productSet / inventory inputs from a push job payload.
 * The payload (dropship_push_jobs.payload, written by ds_push_enqueue) holds only merchant-safe data: the merchant's
 * copy, DS model numbers / the merchant's SKUs, prices in store-currency minor units, stock as a LABEL. Nothing here adds
 * supplier, cost or Octopus data: no cost on the inventory item, image files get random names, inventory only at the
 * "Octopus Dropship" fulfilment location.
 */

export type PushPayloadVariant = {
  variant_id: string;
  model_no: string;
  sku: string;
  options: Record<string, string>;
  price_minor: number;
  compare_at_minor: number | null;
  stock_status: 'in_stock' | 'low' | 'out' | 'extended';
  variant_gid?: string | null;
  inventory_item_gid?: string | null;
};

export type PushPayload = {
  listing_ref: string;
  product_gid: string | null;
  title: string;
  description_html: string;
  vendor: string | null;
  product_type: string | null;
  tags: string[];
  collection: string | null;
  handle: string | null;
  seo: { title: string | null; description: string | null } | null;
  status: 'DRAFT' | 'ACTIVE';
  images: string[] | string | null;
  currency: string;
  currency_exponent?: number;
  location_gid: string | null;
  sync: { stock: boolean; price: boolean };
  variants: PushPayloadVariant[];
};

/** App-owned metafield used as the upsert key (definition created on connect, Step 5). Not shown to buyers. */
export const LISTING_REF_METAFIELD = { namespace: '$app:ds', key: 'listing_ref' } as const;

/** Stock label → quantity at our location. The owner sets the numbers (stock is a label for merchants); missing → null. */
export type StockQuantityPolicy = { in_stock: number; low: number; extended: number };
export function quantityFor(label: PushPayloadVariant['stock_status'], policy: StockQuantityPolicy): number {
  if (label === 'out') return 0;
  const q = policy[label];
  return Number.isInteger(q) && q >= 0 ? q : 0;
}

/** minor units → Shopify decimal string ("159.99", "4.990") */
export function shopifyAmount(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

/** random file name with the source extension — never the original (supplier / sha) name */
export function randomImageName(url: string, rand: () => string = () => randomBytes(8).toString('hex')): string {
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  return `img-${rand()}.${ext}`;
}

export const PRODUCT_SET_MUTATION = /* GraphQL */ `
mutation DsProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $synchronous: Boolean!) {
  productSet(input: $input, identifier: $identifier, synchronous: $synchronous) {
    product {
      id
      status
      variants(first: 100) { nodes { id sku inventoryItem { id } selectedOptions { name value } } }
    }
    userErrors { field message code }
  }
}`;

export const INVENTORY_ZERO_MUTATION = /* GraphQL */ `
mutation DsInventoryZero($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { createdAt }
    userErrors { field message code }
  }
}`;

export const INVENTORY_DEACTIVATE_MUTATION = /* GraphQL */ `
mutation DsLeaveLocation($inventoryItemId: ID!, $updates: [InventoryBulkToggleActivationInput!]!) {
  inventoryBulkToggleActivation(inventoryItemId: $inventoryItemId, inventoryItemUpdates: $updates) {
    userErrors { field message code }
  }
}`;

export const COLLECTION_BY_TITLE_QUERY = /* GraphQL */ `
query DsCollection($q: String!) { collections(first: 1, query: $q) { nodes { id title } } }`;

type OptionValue = { optionName: string; name: string };

/** productSet variables. `collectionGid` is resolved by the runner (never created by us). */
export function buildProductSetVariables(p: PushPayload, opts: { locationGid: string; policy: StockQuantityPolicy; collectionGid?: string | null; rand?: () => string }) {
  const optionNames: string[] = [];
  for (const v of p.variants) for (const k of Object.keys(v.options ?? {})) if (!optionNames.includes(k)) optionNames.push(k);
  const useDefault = optionNames.length === 0;
  const productOptions = useDefault
    ? [{ name: 'Title', values: [{ name: 'Default Title' }] }]
    : optionNames.map((name) => ({ name, values: [...new Set(p.variants.map((v) => v.options?.[name]).filter((x): x is string => Boolean(x)))].map((n) => ({ name: n })) }));
  const images = Array.isArray(p.images) ? p.images : p.images ? [p.images] : [];
  const variants = p.variants.map((v) => {
    const optionValues: OptionValue[] = useDefault ? [{ optionName: 'Title', name: 'Default Title' }] : optionNames.map((n) => ({ optionName: n, name: v.options?.[n] ?? '-' }));
    return {
      ...(v.variant_gid ? { id: v.variant_gid } : {}),
      optionValues,
      price: shopifyAmount(v.price_minor, p.currency),
      compareAtPrice: v.compare_at_minor != null ? shopifyAmount(v.compare_at_minor, p.currency) : null,
      inventoryPolicy: 'DENY',
      inventoryItem: { sku: v.sku, tracked: true },
      // only at the Octopus Dropship location, never the merchant's own locations
      inventoryQuantities: [{ locationId: opts.locationGid, name: 'available', quantity: quantityFor(v.stock_status, opts.policy) }],
    };
  });
  const input: Record<string, unknown> = {
    title: p.title,
    descriptionHtml: p.description_html,
    vendor: p.vendor ?? undefined,
    productType: p.product_type ?? undefined,
    tags: p.tags ?? [],
    handle: p.handle ?? undefined,
    status: p.status,
    productOptions,
    variants,
    files: images.map((url) => ({ originalSource: url, contentType: 'IMAGE', alt: p.title, filename: randomImageName(url, opts.rand) })),
    metafields: [{ ...LISTING_REF_METAFIELD, type: 'single_line_text_field', value: p.listing_ref }],
    ...(p.seo ? { seo: { title: p.seo.title ?? undefined, description: p.seo.description ?? undefined } } : {}),
    ...(opts.collectionGid ? { collections: [opts.collectionGid] } : {}),
  };
  const identifier = p.product_gid ? { id: p.product_gid } : { customId: { ...LISTING_REF_METAFIELD, value: p.listing_ref } };
  return { input, identifier, synchronous: true };
}

/** inventorySetQuantities input: every item to 0 at our location (no compare-and-swap: changeFromQuantity null) */
export function buildInventoryZeroVariables(inventoryItemGids: string[], locationGid: string, jobId: string) {
  return {
    key: `ds-unlink-${jobId}`,
    input: {
      name: 'available',
      reason: 'correction',
      referenceDocumentUri: `gid://dropship-app/Unlink/${jobId}`,
      quantities: inventoryItemGids.map((id) => ({ inventoryItemId: id, locationId: locationGid, quantity: 0, changeFromQuantity: null })),
    },
  };
}
