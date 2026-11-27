/**
 * ODS T4 · Shop sections (pure; server, client and unit tests). Shared by the FRAME builder (/shop main page, JumpBar,
 * SectionBar) and the other Shop builders.
 *
 * API (stable):
 *  - `ShopSectionKey`                 = the six service keys, same as `OdsServiceKey`: sourcing | pools | dropship | 3pl | turnkey | brand
 *  - `SECTION_ORDER`                  fixed order of Part 5.2: Sourcing → MOQ pools → Dropshipping → Warehouse (3PL) → Turnkey → Make My Brand
 *  - `SHOP_SECTIONS[key]`             { key, anchor, title, explainer, seeAllPath, seeAllLabel, byCategory, countLabel(n) }
 *  - `seeAllHref(key, categorySlug?)` public URL of the section's list page (+ `?category=` for sections that filter by category)
 *  - `normaliseInterest(value)`       setup interest / alias → ShopSectionKey | null ('warehouse' → '3pl', 'mmb' → 'brand' …)
 *  - `orderSections(interests)`       fixed order, with the FIRST valid interest moved to the top (Part 5.2 §4)
 *  - `greetingFor(hour)`              'Good morning' (05–11) | 'Good afternoon' (12–17) | 'Good evening' (18–04)
 *  - `SHOP_PATHS`                     public URLs used by the frame (cart = quote list until T5, request a product, …)
 */
import type { OdsServiceKey } from '@octopus/ui/tokens';

export type ShopSectionKey = OdsServiceKey;

export const SECTION_ORDER: readonly ShopSectionKey[] = ['sourcing', 'pools', 'dropship', '3pl', 'turnkey', 'brand'];

export type ShopSectionMeta = {
  key: ShopSectionKey;
  /** id of the <section> on /shop (JumpBar target); the heading is `${anchor}-heading`. */
  anchor: string;
  title: string;
  explainer: string;
  seeAllPath: string;
  seeAllLabel: string;
  /** The section's items belong to product categories, so the category chips filter it. */
  byCategory: boolean;
  countLabel: (n: number) => string;
};

const plain = (n: number) => n.toLocaleString('en-US');

export const SHOP_SECTIONS: Record<ShopSectionKey, ShopSectionMeta> = {
  sourcing: {
    key: 'sourcing',
    anchor: 'section-sourcing',
    title: 'Sourcing products',
    explainer: 'Buy from verified factories. Ask for a quote; prices drop at higher quantities.',
    seeAllPath: '/shop/products',
    seeAllLabel: 'See all sourcing products',
    byCategory: true,
    countLabel: plain,
  },
  pools: {
    key: 'pools',
    anchor: 'section-pools',
    title: 'MOQ pools',
    explainer: 'Buy together with other buyers to reach the factory minimum and pay the bulk price.',
    seeAllPath: '/shop/pools',
    seeAllLabel: 'See all pools',
    byCategory: true,
    countLabel: plain,
  },
  dropship: {
    key: 'dropship',
    anchor: 'section-dropship',
    title: 'Dropshipping',
    explainer: 'Sell in your online store without stock. We pack and ship each order under your brand.',
    seeAllPath: '/shop/dropship',
    seeAllLabel: 'See all dropshipping products',
    byCategory: true,
    countLabel: plain,
  },
  '3pl': {
    key: '3pl',
    anchor: 'section-warehouse',
    title: 'Warehouse (3PL)',
    explainer: 'Store your goods in our China warehouse. We receive, check, pick and ship for you.',
    seeAllPath: '/shop/warehouse',
    seeAllLabel: 'See all warehouse services',
    byCategory: false,
    countLabel: (n) => `${plain(n)} ${n === 1 ? 'service' : 'services'}`,
  },
  turnkey: {
    key: 'turnkey',
    anchor: 'section-turnkey',
    title: 'Turnkey projects',
    explainer: 'A whole product line done for you: design, samples, QC, packaging and shipping.',
    seeAllPath: '/shop/turnkey',
    seeAllLabel: 'See all projects',
    byCategory: false,
    countLabel: plain,
  },
  brand: {
    key: 'brand',
    anchor: 'section-brand',
    title: 'Make My Brand',
    explainer: 'Put your logo, colour box, labels and inserts on the products you buy.',
    seeAllPath: '/shop/brand',
    seeAllLabel: 'See all branding options',
    byCategory: false,
    countLabel: plain,
  },
};

export function seeAllHref(key: ShopSectionKey, categorySlug?: string | null): string {
  const m = SHOP_SECTIONS[key];
  return m.byCategory && categorySlug ? `${m.seeAllPath}?category=${encodeURIComponent(categorySlug)}` : m.seeAllPath;
}

const ALIASES: Record<string, ShopSectionKey> = {
  sourcing: 'sourcing',
  products: 'sourcing',
  pools: 'pools',
  pool: 'pools',
  moq: 'pools',
  dropship: 'dropship',
  dropshipping: 'dropship',
  '3pl': '3pl',
  warehouse: '3pl',
  turnkey: 'turnkey',
  brand: 'brand',
  mmb: 'brand',
  'make-my-brand': 'brand',
};

export function normaliseInterest(value: unknown): ShopSectionKey | null {
  if (typeof value !== 'string') return null;
  return ALIASES[value.trim().toLowerCase()] ?? null;
}

/**
 * Part 5.2 §4: the six sections in the fixed order; the service the customer picked FIRST during setup moves to the top,
 * the rest keep the fixed order. Unknown values are skipped; no (valid) interest = the fixed order.
 */
export function orderSections(interests?: readonly unknown[] | null): ShopSectionKey[] {
  const first = (interests ?? []).map(normaliseInterest).find((k): k is ShopSectionKey => k !== null);
  if (!first) return [...SECTION_ORDER];
  return [first, ...SECTION_ORDER.filter((k) => k !== first)];
}

/** Greeting by the visitor's LOCAL hour (0–23). Call it in the browser (the server does not know the visitor's time zone). */
export function greetingFor(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Public URLs used by the Shop frame (never /ods/...). */
export const SHOP_PATHS = {
  home: '/shop',
  search: '/shop/search',
  /** T5 replaces this with /shop/cart + the mini-cart; until then "Cart (n)" = the quote list. */
  cart: '/shop/quote-list',
  requestProduct: '/request/sourcing',
  account: '/account',
  notifications: '/account/notifications',
  wallet: '/account/wallet',
  verify: '/account/kyc',
  help: '/help',
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  suggest: '/api/shop/suggest',
} as const;

/** Product list URL for a category chip / mega-menu link. */
export const categoryProductsHref = (slug: string) => `/shop/products?category=${encodeURIComponent(slug)}`;

/** SectionBar item ids (in display order). */
export type SectionBarId = 'products' | 'pools' | 'turnkey' | 'dropship' | 'warehouse' | 'brand' | 'samples' | 'new';

export function sectionBarItems(flags: { poolsOn: boolean; turnkeyOn: boolean }): { id: SectionBarId; label: string; href: string }[] {
  const all: { id: SectionBarId; label: string; href: string; on?: boolean }[] = [
    { id: 'products', label: 'Sourcing products', href: '/shop/products' },
    { id: 'pools', label: 'MOQ pools', href: '/shop/pools', on: flags.poolsOn },
    { id: 'turnkey', label: 'Turnkey projects', href: '/shop/turnkey', on: flags.turnkeyOn },
    { id: 'dropship', label: 'Dropshipping', href: '/shop/dropship' },
    { id: 'warehouse', label: 'Warehouse (3PL)', href: '/shop/warehouse' },
    { id: 'brand', label: 'Make My Brand', href: '/shop/brand' },
    { id: 'samples', label: 'Samples', href: '/shop/products?samples=1' },
    { id: 'new', label: 'New arrivals', href: '/shop/products?sort=newest' },
  ];
  return all.filter((i) => i.on !== false).map(({ id, label, href }) => ({ id, label, href }));
}

/** Selected SectionBar item for a PUBLIC path (/shop/pools/POOL-12 → 'pools'); undefined on /shop and other pages. */
export function sectionForPath(path: string | null | undefined): SectionBarId | undefined {
  const p = (path ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  const map: [string, SectionBarId][] = [
    ['/shop/products', 'products'],
    ['/shop/pools', 'pools'],
    ['/shop/turnkey', 'turnkey'],
    ['/shop/dropship', 'dropship'],
    ['/shop/warehouse', 'warehouse'],
    ['/shop/brand', 'brand'],
  ];
  return map.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`))?.[1];
}

/** Selected BottomNav item (phones) for a PUBLIC path. */
export function bottomNavForPath(path: string | null | undefined): 'shop' | 'pools' | 'cart' | undefined {
  const p = (path ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  if (p === '/shop') return 'shop';
  if (p === '/shop/pools' || p.startsWith('/shop/pools/')) return 'pools';
  if (p === '/shop/quote-list' || p === '/shop/cart' || p.startsWith('/shop/cart/')) return 'cart';
  return undefined;
}
