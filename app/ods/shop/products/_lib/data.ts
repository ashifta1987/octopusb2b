import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { isOptimizableImage } from '@octopus/ui/image-url';
import { createPublicClient } from '@/lib/supabase/server';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { asCurrency } from '@/lib/format';
import { categoryPath, descendantIds, type Category } from '@/lib/content';
import { toCents } from '@/lib/format';
import { stockTotals } from '@/lib/category-stock';
import { getStoreContent } from '@/components/store/currency';
import { listProducts, listOpenPools, getCategoryCounts, getServices, getRecommendations, PAGE_SIZE, type ListFilters } from '@/components/store/data';
import { parts } from '@/components/store/seo';
import { getShopViewer } from '@/lib/shop/data';
import { shopCan, ROLE_REASON } from '@/lib/shop/shared';
import { toSourcingCard } from '../../_lib/cards';
import { nowIso } from '@/lib/core/account';
import type { PriceTier } from './price';
import { PRODUCT_COLS, PRODUCT_FACTORY_COLS } from './columns';
import type { ProductFilterState } from './filters';
import { safeSpecs, SHIPS_FROM } from './white-label';
import type { CategoryOption, CustomiseOption, ProductListVM, ProductPageVM, ProductQuestion, ShopActor } from './types';

/**
 * ODS Shop catalogue loaders (T4). Page-local until the FRAME builder's app/ods/shop/_lib mappers exist.
 * Data sources (all customer-safe; nothing returned here carries a supplier id/name/code, model number, cost or margin):
 *  - list:    components/store/data listProducts() → FRAME builder's toSourcingCard (app/ods/shop/_lib/cards) — products CARD_COLS (id, slug, title, unit, moq, min_price_cents,
 *             currency, image_url, category_id, octopus_dropship, ready_to_ship, lead_time_days, created_at,
 *             price_tiers(min_qty, unit_price_cents, currency), product_tags(tags(name, slug, kind))) + product_factory
 *             (verified, country, province — only `verified` is mapped out).
 *  - product: loadProductRow() below — ./columns PRODUCT_COLS exactly + product_factory.verified.
 *  - fees:    getServices() (services + service_price_info) → sample fee; content blocks product.shipping,
 *             shop.product.questions; open pool via listOpenPools({ productId }).
 */

export function currencyLabel(code: string): string {
  return code === 'USD' ? 'US$' : code;
}

export function unitNames(unit: string): { one: string; many: string } {
  const u = (unit || 'unit').trim().toLowerCase();
  if (u === 'pcs' || u === 'pc' || u === 'piece' || u === 'pieces') return { one: 'piece', many: 'pieces' };
  if (u.length > 2 && u.endsWith('s')) return { one: u.slice(0, -1), many: u };
  return { one: u, many: `${u}s` };
}

export const leadText = (days: number | null | undefined) => (days != null && days > 0 ? `${days} days` : 'On request');

/** Viewer → what they may do (owner/buyer act, viewer browses) + defaults. */
export async function getShopActor(): Promise<ShopActor> {
  const v = await getShopViewer();
  const canAct = shopCan(v.role);
  return { canAct, reason: canAct ? null : ROLE_REASON, country: v.org.country ?? null, cartCount: v.quoteCount };
}

export async function loadCategories(): Promise<{ all: Category[]; options: CategoryOption[]; chips: CategoryOption[] }> {
  const [{ categories }, counts] = await Promise.all([getStoreContent(), getCategoryCounts()]);
  const totals = stockTotals(categories, counts);
  const opt = (c: Category): CategoryOption => ({ slug: c.slug, name: c.name, level: c.level, count: totals.get(c.id) ?? 0 });
  const level1 = categories.filter((c) => c.level === 1 && (totals.get(c.id) ?? 0) > 0).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const options: CategoryOption[] = [];
  for (const top of level1) {
    options.push(opt(top));
    categories
      .filter((c) => c.parent_id === top.id && (totals.get(c.id) ?? 0) > 0)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .forEach((c) => options.push(opt(c)));
  }
  const chips = level1.map(opt).sort((a, b) => b.count - a.count).slice(0, 10);
  return { all: categories, options, chips };
}

export async function loadProductList(s: ProductFilterState, categories: Category[]): Promise<ProductListVM> {
  const cat = s.category ? categories.find((c) => c.slug === s.category) ?? null : null;
  const tagSlugs = [s.custom ? 'customisable' : '', s.samples ? 'samples' : ''].filter(Boolean);
  const f: ListFilters = {
    q: s.q || undefined,
    categoryIds: cat ? descendantIds(categories, cat.id) : undefined,
    minCents: s.min != null ? toCents(s.min) : undefined,
    maxCents: s.max != null ? toCents(s.max) : undefined,
    moqMax: s.moq ?? undefined,
    leadMax: s.lead ?? undefined,
    verified: s.verified,
    inPool: s.pool,
    tagSlugs: tagSlugs.length ? tagSlugs : undefined,
    sort: s.sort,
    page: s.page,
  };
  const [{ items, total }, ctx] = await Promise.all([listProducts(f), getCurrencyContext()]);
  const now = Date.parse(nowIso());
  return { items: items.map((p) => toSourcingCard(p, { now })), total, page: s.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), currency: currencyLabel(ctx.currency) };
}

/* ───────── Product page ───────── */

type RawProduct = {
  id: string; slug: string; title: string; unit: string; moq: number; min_price_cents: number | null; currency: string | null;
  image_url: string | null; category_id: string | null; lead_time_days: number | null; description: string | null; incoterm: string | null;
  hs_code: string | null; qty_per_carton: string | null;
  price_tiers: { min_qty: number; unit_price_cents: number; currency: string | null }[] | null;
  product_tags: { tags: { slug: string } | { slug: string }[] | null }[] | null;
  product_specs: { name: string; value: string; sort: number }[] | null;
  product_media: { url: string; alt: string | null; sort: number; kind: string }[] | null;
};

/** Live product by slug with prices converted to the platform currency. Cached 5 min (tags products, product:<slug>, currency). */
export async function loadProductRow(slug: string) {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products', `product:${slug}`, 'currency');
  if (!/^[a-z0-9-]{1,200}$/i.test(slug)) return null;
  const sb = createPublicClient();
  const { data } = await sb.from('products').select(PRODUCT_COLS).eq('slug', slug).eq('status', 'live').is('archived_at', null).maybeSingle();
  if (!data) return null;
  const raw = data as unknown as RawProduct;
  const [ctx, fac] = await Promise.all([
    getCurrencyContext(),
    sb.from('product_factory').select(PRODUCT_FACTORY_COLS).eq('product_id', raw.id).maybeSingle(),
  ]);
  const source = asCurrency(raw.currency);
  const tiers: PriceTier[] = (raw.price_tiers ?? [])
    .map((t) => ({ minQty: t.min_qty, unitCents: toPlatform(ctx, t.unit_price_cents, t.currency ?? source) ?? 0 }))
    .sort((a, b) => a.minQty - b.minQty);
  const tags = (raw.product_tags ?? []).flatMap((t) => (Array.isArray(t.tags) ? t.tags : t.tags ? [t.tags] : [])).map((t) => t.slug);
  const media = [...(raw.product_media ?? [])].filter((m) => m.kind === 'image' && m.url).sort((a, b) => a.sort - b.sort);
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    unit: raw.unit,
    moq: raw.moq,
    minPriceCents: toPlatform(ctx, raw.min_price_cents, source),
    currency: currencyLabel(ctx.currency),
    categoryId: raw.category_id,
    leadDays: raw.lead_time_days,
    description: raw.description,
    incoterm: raw.incoterm,
    hsCode: raw.hs_code,
    packing: raw.qty_per_carton,
    tiers,
    tags,
    verified: !!fac.data?.verified,
    specs: safeSpecs([...(raw.product_specs ?? [])].sort((a, b) => a.sort - b.sort).map(({ name, value }) => ({ name: String(name ?? ''), value: String(value ?? '') }))),
    images: (media.length ? media.map((m) => ({ url: m.url, alt: m.alt })) : raw.image_url ? [{ url: raw.image_url, alt: null }] : []).slice(0, 8),
  };
}

const CUSTOMISE: Omit<CustomiseOption, 'minimum'>[] = [
  { value: 'Logo print', label: 'Logo print', description: 'Your logo printed on the product.' },
  { value: 'Custom colour', label: 'Custom colour', description: 'A colour matched to your sample or colour code.' },
  { value: 'Branded colour box', label: 'Branded colour box', description: 'A retail box printed with your artwork.' },
];

/** "Question | Answer" per line (content block shop.product.questions). Empty by default: no invented questions. */
export function parseQuestions(text: string | undefined): ProductQuestion[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.split('|').map((x) => x.trim()))
    .filter(([q, a]) => q && a)
    .map(([q, a]) => ({ q, a }));
}

export function summaryOf(description: string | null): string | null {
  const first = (description ?? '').trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim();
  if (!first) return null;
  return first.length > 220 ? `${first.slice(0, 217).trimEnd()}…` : first;
}

export async function loadProductPage(slug: string): Promise<ProductPageVM | null> {
  const row = await loadProductRow(slug);
  if (!row) return null;
  const [{ categories, blocks, settings }, services, pools] = await Promise.all([
    getStoreContent(),
    getServices(),
    loadOpenPoolCode(row.id),
  ]);
  const u = unitNames(row.unit);
  const sample = services.sample;
  const [, shipA, shipB] = parts(blocks, 'product.shipping', 'Shipping and customs|Quotes include Incoterm, port and lead time.|');
  const customisable = row.tags.includes('customisable');
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: summaryOf(row.description),
    description: row.description,
    images: row.images.map((m, i) => ({ src: m.url, alt: m.alt?.trim() || `${row.title}, photo ${i + 1}`, unoptimized: !isOptimizableImage(m.url) })),
    verified: row.verified,
    customisable,
    samplesAvailable: row.tags.includes('samples') && !!sample,
    unit: u.one,
    unitPlural: u.many,
    moq: row.moq,
    leadDays: row.leadDays,
    tiers: row.tiers.filter((t) => t.unitCents > 0),
    currency: row.currency,
    sampleCents: sample ? sample.priceCents : null,
    shipsFrom: SHIPS_FROM,
    shippingEstimate: null, // no sea/air rate cards for sourcing products today (shipping_rate_cards = 3PL parcel, staff-only)
    shippingNotes: [shipA, shipB].filter(Boolean),
    incoterm: row.incoterm,
    hsCode: row.hsCode,
    hsIndicative: true,
    packing: row.packing,
    specs: row.specs,
    breadcrumbs: [
      { label: 'Shop', href: '/shop' },
      { label: 'Products', href: '/shop/products' },
      ...categoryPath(categories, row.categoryId).map((c) => ({ label: c.name, href: `/shop/products?category=${encodeURIComponent(c.slug)}` })),
      { label: row.title },
    ],
    categoryId: row.categoryId,
    pool: settings.pool_enabled === false ? null : pools,
    customise: customisable ? CUSTOMISE.map((c) => ({ ...c, minimum: 'Minimum confirmed in your quote' })) : [],
    questions: parseQuestions(blocks['shop.product.questions']),
  };
}

async function loadOpenPoolCode(productId: string): Promise<{ code: string } | null> {
  const { items } = await listOpenPools({ productId, limit: 1 }).catch(() => ({ items: [] as { code: string }[] }));
  return items[0] ? { code: items[0].code } : null;
}

export async function loadSimilarCards(productId: string, categoryId: string | null) {
  const recs = await getRecommendations(productId, categoryId, 8);
  const now = Date.parse(nowIso());
  return { items: recs.filter((p) => p.id !== productId).slice(0, 6).map((p) => toSourcingCard(p, { now })) };
}
