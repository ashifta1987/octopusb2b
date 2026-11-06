import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient, createAdminClient } from '@/lib/supabase/server';
import { getCurrencyContext, toPlatform, type CurrencyContext } from '@/lib/currency';
import { asCurrency, convertMinor, type Currency } from '@/lib/format';
import { priceAt, type PoolTier } from '@/components/store/pools/shared';

/**
 * Storefront data layer (SPEC P3). Every function is a `use cache` scope (Cache Components ISR equivalent,
 * revalidated every 5 minutes and tagged so CMS/catalog edits can call revalidateTag). Reads use the anon
 * client only: RLS exposes live products and the `public_suppliers` view (code + country + badge), never
 * supplier legal names, contacts or costs.
 *
 * Currency (SPEC §15.1): price tiers / products keep the currency they were entered in. Every catalogue function
 * converts prices to the PLATFORM currency (getCurrencyContext + toPlatform) before returning, so `CardProduct.tiers`,
 * `min_price_cents` and `ServiceInfo.priceCents` are always in `currency` (= platform currency). All price-bearing
 * caches are tagged 'currency' so a switch (revalidateTag('currency','max')) refreshes them.
 * Price filters/sorting use the `products.min_price_platform` computed column (migration 065), which converts in SQL
 * with the same approved rate + rounding, so the bounds a buyer types in the platform currency match the cards.
 */

export type PublicSupplier = { id: string; code: string; country: string | null; verified: boolean; supplier_type: string | null };
/** A price tier converted to the platform currency (`source_currency` = the currency the supplier entered). */
export type Tier = { min_qty: number; unit_price_cents: number; source_currency?: Currency };
export type TagRef = { name: string; slug: string; kind: string };
export type CardProduct = {
  id: string; slug: string; title: string; unit: string; moq: number; min_price_cents: number | null; image_url: string | null;
  /** Platform currency every price on this card is expressed in. `source_currency` = currency the listing was entered in. */
  currency: Currency; source_currency: Currency;
  category_id: string | null; supplier_id: string; octopus_dropship: boolean; ready_to_ship: boolean;
  tiers: Tier[]; tags: TagRef[]; supplier: PublicSupplier | null;
};
export type ProductDetail = CardProduct & {
  description: string | null; lead_time_days: number | null; incoterm: string | null; origin_country: string | null; hs_code: string | null;
  seo_title: string | null; seo_description: string | null; updated_at: string;
  specs: { name: string; value: string }[]; media: { url: string; alt: string | null }[];
  certificates: { id: string; name: string; issuer: string | null; status: string; expires_at: string | null }[];
};

const CARD_COLS =
  'id, slug, title, unit, moq, min_price_cents, currency, image_url, category_id, supplier_id, octopus_dropship, ready_to_ship, price_tiers(min_qty, unit_price_cents, currency), product_tags(tags(name, slug, kind))';

type RawTier = { min_qty: number; unit_price_cents: number; currency: string | null };
type RawCard = Omit<CardProduct, 'tiers' | 'tags' | 'supplier' | 'currency' | 'source_currency'> & {
  currency: string | null; price_tiers: RawTier[] | null; product_tags: { tags: TagRef | TagRef[] | null }[] | null;
};

function shape(r: RawCard, sup: Map<string, PublicSupplier>, ctx: CurrencyContext): CardProduct {
  const { price_tiers, product_tags, currency, ...rest } = r;
  const source = asCurrency(currency);
  return {
    ...rest,
    currency: ctx.currency,
    source_currency: source,
    min_price_cents: toPlatform(ctx, rest.min_price_cents, source),
    tiers: [...(price_tiers ?? [])]
      .map((t) => ({ min_qty: t.min_qty, unit_price_cents: toPlatform(ctx, t.unit_price_cents, t.currency ?? source) ?? 0, source_currency: asCurrency(t.currency ?? source) }))
      .sort((a, b) => a.min_qty - b.min_qty),
    tags: (product_tags ?? []).flatMap((t) => (Array.isArray(t.tags) ? t.tags : t.tags ? [t.tags] : [])),
    supplier: sup.get(r.supplier_id) ?? null,
  };
}

/** Suppliers are always joined through the public view with a separate query (never embed `suppliers`). */
async function supplierMap(ids: string[]) {
  const map = new Map<string, PublicSupplier>();
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return map;
  const { data } = await createPublicClient().from('public_suppliers').select('id, code, country, verified, supplier_type').in('id', uniq);
  (data ?? []).forEach((s) => map.set(s.id as string, s as PublicSupplier));
  return map;
}

async function toCards(rows: RawCard[]) {
  const [sup, ctx] = await Promise.all([supplierMap(rows.map((r) => r.supplier_id)), getCurrencyContext()]);
  return rows.map((r) => shape(r, sup, ctx));
}

/* ───────── Services & prices ───────── */
/** `priceCents` is in `currency` (platform currency) via service_price_info(); `converted` = no native price, converted from USD. */
export type ServiceInfo = { code: string; name: string; description: string | null; unit: string; priceCents: number; currency: Currency; converted: boolean };
export async function getServices(): Promise<Record<string, ServiceInfo>> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('service-prices', 'currency');
  const sb = createPublicClient();
  const ctx = await getCurrencyContext();
  const { data: services } = await sb.from('services').select('code, name, description, unit').eq('active', true).order('sort');
  const prices = await Promise.all((services ?? []).map((s) =>
    sb.rpc('service_price_info', { p_code: s.code, p_currency: ctx.currency }).maybeSingle<{ amount_minor: number | null; currency: string; converted: boolean }>()));
  const out: Record<string, ServiceInfo> = {};
  (services ?? []).forEach((s, i) => {
    const p = prices[i].data;
    out[s.code] = { ...s, priceCents: Number(p?.amount_minor ?? 0), currency: asCurrency(p?.currency ?? ctx.currency), converted: !!p?.converted };
  });
  return out;
}

/* ───────── Catalog ───────── */
export async function getCategoryCounts(): Promise<Record<string, number>> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products');
  const { data } = await createPublicClient().from('products').select('category_id').eq('status', 'live').is('archived_at', null);
  const out: Record<string, number> = {};
  (data ?? []).forEach((r) => { if (r.category_id) out[r.category_id] = (out[r.category_id] ?? 0) + 1; });
  return out;
}

export async function getTags(): Promise<(TagRef & { id: string })[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products');
  const { data } = await createPublicClient().from('tags').select('id, name, slug, kind').order('name');
  return (data ?? []) as (TagRef & { id: string })[];
}

export async function getFeatured(limit = 8): Promise<CardProduct[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products', 'currency');
  const { data } = await createPublicClient().from('products').select(CARD_COLS)
    .eq('status', 'live').is('archived_at', null).eq('featured', true).order('created_at').limit(limit);
  return toCards((data ?? []) as unknown as RawCard[]);
}

export type ListFilters = {
  q?: string; categoryIds?: string[]; minCents?: number; maxCents?: number; moqMax?: number; tagSlugs?: string[];
  dropship?: boolean; ready?: boolean; verified?: boolean; sort?: string; page?: number;
};
export const PAGE_SIZE = 24;

/** Server-paginated product search (Products.png). Full-text `search` column + ilike on title / HS / supplier code. */
export async function listProducts(f: ListFilters): Promise<{ items: CardProduct[]; total: number }> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products', 'currency');
  const sb = createPublicClient();
  let query = sb.from('products').select(CARD_COLS, { count: 'exact' }).eq('status', 'live').is('archived_at', null);

  if (f.categoryIds?.length) query = query.in('category_id', f.categoryIds);
  // Bounds are in the platform currency → compare against the SQL-converted computed column (migration 065).
  if (f.minCents != null) query = query.gte('min_price_platform', f.minCents);
  if (f.maxCents != null) query = query.lte('min_price_platform', f.maxCents);
  if (f.moqMax != null) query = query.lte('moq', f.moqMax);
  if (f.dropship) query = query.eq('octopus_dropship', true);
  if (f.ready) query = query.eq('ready_to_ship', true);

  if (f.tagSlugs?.length) {
    const { data: tags } = await sb.from('tags').select('id').in('slug', f.tagSlugs);
    const tagIds = (tags ?? []).map((t) => t.id as string);
    const { data: pt } = tagIds.length ? await sb.from('product_tags').select('product_id').in('tag_id', tagIds) : { data: [] };
    const ids = [...new Set((pt ?? []).map((r) => r.product_id as string))];
    if (!ids.length) return { items: [], total: 0 };
    query = query.in('id', ids);
  }
  if (f.verified) {
    const { data: vs } = await sb.from('public_suppliers').select('id').eq('verified', true);
    const ids = (vs ?? []).map((s) => s.id as string);
    if (!ids.length) return { items: [], total: 0 };
    query = query.in('supplier_id', ids);
  }
  const q = (f.q ?? '').replace(/[,()"\\:%*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (q) {
    const ors = [`search.wfts(english)."${q}"`, `title.ilike."%${q}%"`, `hs_code.ilike."${q}%"`];
    const { data: sups } = await sb.from('public_suppliers').select('id').ilike('code', `%${q}%`).limit(50);
    if (sups?.length) ors.push(`supplier_id.in.(${sups.map((s) => s.id).join(',')})`);
    query = query.or(ors.join(','));
  }

  switch (f.sort) {
    case 'price_asc': query = query.order('min_price_platform', { ascending: true, nullsFirst: false }); break;
    case 'price_desc': query = query.order('min_price_platform', { ascending: false, nullsFirst: false }); break;
    case 'moq_asc': query = query.order('moq', { ascending: true }); break;
    case 'newest': query = query.order('created_at', { ascending: false }); break;
    default: query = query.order('featured', { ascending: false }).order('created_at', { ascending: true });
  }
  const page = Math.max(1, f.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.order('id').range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { items: await toCards((data ?? []) as unknown as RawCard[]), total: count ?? 0 };
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products', `product:${slug}`, 'currency');
  const sb = createPublicClient();
  const { data } = await sb.from('products')
    .select(`${CARD_COLS}, description, lead_time_days, incoterm, origin_country, hs_code, seo_title, seo_description, updated_at,
      product_specs(name, value, sort), product_media(url, alt, sort, kind),
      product_certificates(certificates(id, name, issuer, status, expires_at))`)
    .eq('slug', slug).eq('status', 'live').is('archived_at', null).maybeSingle();
  if (!data) return null;
  type Raw = RawCard & Omit<ProductDetail, keyof CardProduct | 'specs' | 'media' | 'certificates'> & {
    product_specs: { name: string; value: string; sort: number }[] | null;
    product_media: { url: string; alt: string | null; sort: number; kind: string }[] | null;
    product_certificates: { certificates: ProductDetail['certificates'][number] | null }[] | null;
  };
  const raw = data as unknown as Raw;
  const { product_specs, product_media, product_certificates, ...cardRaw } = raw;
  const [card] = await toCards([cardRaw as RawCard]);
  let certificates = (product_certificates ?? []).map((c) => c.certificates).filter((c): c is NonNullable<typeof c> => !!c);
  if (!certificates.length) {
    // Fallback: the supplier's verified certificates (RLS exposes only verified/expiring ones publicly).
    const { data: certs } = await sb.from('certificates').select('id, name, issuer, status, expires_at').eq('supplier_id', raw.supplier_id).limit(6);
    certificates = (certs ?? []) as ProductDetail['certificates'];
  }
  return {
    ...card,
    description: raw.description, lead_time_days: raw.lead_time_days, incoterm: raw.incoterm, origin_country: raw.origin_country,
    hs_code: raw.hs_code, seo_title: raw.seo_title, seo_description: raw.seo_description, updated_at: raw.updated_at,
    specs: [...(product_specs ?? [])].sort((a, b) => a.sort - b.sort).map(({ name, value }) => ({ name, value })),
    media: [...(product_media ?? [])].filter((m) => m.kind === 'image').sort((a, b) => a.sort - b.sort).map(({ url, alt }) => ({ url, alt })),
    certificates,
  };
}

export async function getProductById(id: string): Promise<{ id: string; slug: string; title: string; unit: string; moq: number } | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createPublicClient().from('products').select('id, slug, title, unit, moq').eq('id', id).eq('status', 'live').maybeSingle();
  return data;
}

/** 12 recommended products: recommendations table first, then same category, then anything live. */
export async function getRecommendations(productId: string, categoryId: string | null, limit = 12): Promise<CardProduct[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products', 'currency');
  const sb = createPublicClient();
  const { data: recs } = await sb.from('recommendations').select('recommended_id, score').eq('product_id', productId).order('score', { ascending: false }).limit(48);
  const ids = (recs ?? []).map((r) => r.recommended_id as string);
  const picked: RawCard[] = [];
  if (ids.length) {
    const { data } = await sb.from('products').select(CARD_COLS).in('id', ids).eq('status', 'live').is('archived_at', null);
    const byId = new Map(((data ?? []) as unknown as RawCard[]).map((p) => [p.id, p]));
    ids.forEach((id) => { const p = byId.get(id); if (p && picked.length < limit) picked.push(p); });
  }
  const base = () => sb.from('products').select(CARD_COLS).eq('status', 'live').is('archived_at', null);
  const fill = async (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    if (picked.length >= limit) return;
    const exclude = [productId, ...picked.map((p) => p.id)];
    const { data } = await build(base()).not('id', 'in', `(${exclude.join(',')})`).limit(limit - picked.length);
    picked.push(...((data ?? []) as unknown as RawCard[]));
  };
  if (categoryId) await fill((q) => q.eq('category_id', categoryId));
  await fill((q) => q.order('featured', { ascending: false }));
  return toCards(picked);
}

export async function getVerifiedSuppliers(limit = 4): Promise<PublicSupplier[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('suppliers');
  const { data } = await createPublicClient().from('public_suppliers').select('id, code, country, verified, supplier_type').eq('verified', true).order('code').limit(limit + 10);
  // ADDON-32: a supplier whose legal identity is still under review (e.g. several name variants) is never shown as "verified"
  let blocked = new Set<string>();
  try {
    const { data: rev } = await createAdminClient().from('suppliers').select('id').neq('identity_status', 'ok');
    blocked = new Set((rev ?? []).map((r) => r.id as string));
  } catch { /* no service key (local preview) → public view only */ }
  return ((data ?? []) as PublicSupplier[]).filter((x) => !blocked.has(x.id)).slice(0, limit);
}

export async function getSitemapProducts(): Promise<{ slug: string; updated_at: string }[]> {
  'use cache';
  cacheLife({ revalidate: 3600 });
  cacheTag('products');
  const { data } = await createPublicClient().from('products').select('slug, updated_at').eq('status', 'live').is('archived_at', null).limit(50000);
  return data ?? [];
}

/* ───────── Ads ───────── */
export type AdCampaign = { id: string; headline: string; body: string | null; link: string | null; image_url: string | null; placement: string };
export async function getActiveAds(placement: string): Promise<AdCampaign[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  cacheTag('ads');
  const { data } = await createPublicClient().from('ad_campaigns').select('id, headline, body, link, image_url, placement, max_cpc_cents')
    .eq('placement', placement).eq('status', 'active').order('max_cpc_cents', { ascending: false }).limit(5);
  return (data ?? []).map(({ max_cpc_cents: _bid, ...a }) => { void _bid; return a as AdCampaign; });
}

/* ───────── CMS pages ───────── */
export type TermsSection = { no: number; title: string; body: string };
export async function getPublishedTerms(): Promise<{ version: string; published_at: string | null; sections: TermsSection[] } | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('site-content');
  const { data } = await createPublicClient().from('terms_versions').select('version, published_at, sections')
    .eq('status', 'published').eq('kind', 'general').order('published_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const sections = (Array.isArray(data.sections) ? data.sections : []) as TermsSection[];
  return { version: data.version, published_at: data.published_at, sections: [...sections].sort((a, b) => a.no - b.no) };
}

export async function getPage(slug: string, legalOnly = false): Promise<{ slug: string; title: string; body: string; published_at: string | null; updated_at: string } | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('site-content');
  let q = createPublicClient().from('pages').select('slug, title, body, published_at, updated_at').eq('slug', slug).eq('status', 'published');
  if (legalOnly) q = q.eq('is_legal', true);
  const { data } = await q.maybeSingle();
  return data;
}

export async function getLegalSlugs(): Promise<string[]> {
  'use cache';
  cacheLife({ revalidate: 3600 });
  cacheTag('site-content');
  const { data } = await createPublicClient().from('pages').select('slug').eq('status', 'published').eq('is_legal', true);
  return (data ?? []).map((p) => p.slug as string);
}

/* ───────── Group buying / MOQ pools (SPEC §18) ─────────
 * Pools are public listings (RLS: open/locked/… pools readable by anon). Every amount is in the POOL's locked currency:
 * price tiers are converted with the pool's own fx_rate_id (mirror of SQL pool_unit_price / convert_amount).
 * Participants come only from `pool_public_view` (buyer code + country), suppliers only from `public_suppliers`.
 * Cached + tagged 'pools' — server actions that change a pool call revalidateTag('pools', 'max'). */

export type PoolProduct = { id: string; slug: string; title: string; unit: string; moq: number; image_url: string | null; category_id: string | null; hs_code: string | null };
export type PoolParticipant = { buyer_code: string; country: string | null; qty: number; status: string; joined_at: string; deposit_minor: number; currency: Currency; is_starter: boolean };
export type PoolCard = {
  id: string; code: string; status: string; currency: Currency;
  product: PoolProduct; supplier: PublicSupplier | null;
  target_qty: number; filled_qty: number; min_pledge: number; max_buyers: number; deposit_pct: number;
  deadline_at: string; created_at: string;
  /** unit prices in the pool currency: now (at filled qty), if the pool fills (at target), and the base tier */
  pool_price_minor: number | null; target_price_minor: number | null; base_price_minor: number | null;
  saving_pct: number; buyers: number; tiers: PoolTier[];
};
export type PoolEvent = { kind: string; title: string; body: string | null; qty: number | null; created_at: string };
export type PoolDetail = PoolCard & {
  fx_rate_id: string | null; terms_version_id: string | null; final_price_minor: number | null; balance_due_at: string | null; filled_at: string | null;
  participants: PoolParticipant[]; events: PoolEvent[]; week_qty: number; starter: PoolParticipant | null;
};

const POOL_COLS = 'id, code, status, currency, product_id, supplier_id, target_qty, filled_qty, min_pledge, max_buyers, deposit_pct, deadline_at, created_at, pool_price_minor, final_price_minor, fx_rate_id, terms_version_id, balance_due_at, filled_at';
type RawPool = {
  id: string; code: string; status: string; currency: string; product_id: string; supplier_id: string; target_qty: number; filled_qty: number; min_pledge: number;
  max_buyers: number; deposit_pct: number; deadline_at: string; created_at: string; pool_price_minor: number | null; final_price_minor: number | null;
  fx_rate_id: string | null; terms_version_id: string | null; balance_due_at: string | null; filled_at: string | null;
};

async function shapePools(rows: RawPool[]): Promise<{ cards: PoolCard[]; participants: Map<string, PoolParticipant[]> }> {
  const participants = new Map<string, PoolParticipant[]>();
  if (!rows.length) return { cards: [], participants };
  const sb = createPublicClient();
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const fxIds = [...new Set(rows.map((r) => r.fx_rate_id).filter(Boolean) as string[])];
  const [prods, parts, fx, sup, ctx] = await Promise.all([
    sb.from('products').select('id, slug, title, unit, moq, image_url, category_id, hs_code, currency, price_tiers(min_qty, unit_price_cents, currency)').in('id', productIds),
    sb.from('pool_public_view').select('pool_id, buyer_code, country, qty, status, joined_at, deposit_minor, currency, is_starter').in('pool_id', rows.map((r) => r.id)).order('joined_at'),
    fxIds.length ? sb.from('fx_rates').select('id, rate').in('id', fxIds) : Promise.resolve({ data: [] as { id: string; rate: number }[] }),
    supplierMap(rows.map((r) => r.supplier_id)),
    getCurrencyContext(),
  ]);
  type RawProd = PoolProduct & { currency: string | null; price_tiers: RawTier[] | null };
  const prodMap = new Map(((prods.data ?? []) as unknown as RawProd[]).map((p) => [p.id, p]));
  const rate = new Map((fx.data ?? []).map((f) => [f.id as string, Number(f.rate)]));
  ((parts.data ?? []) as (PoolParticipant & { pool_id: string })[]).forEach(({ pool_id, ...p }) => {
    const list = participants.get(pool_id) ?? [];
    list.push({ ...p, qty: Number(p.qty), deposit_minor: Number(p.deposit_minor), currency: asCurrency(p.currency) });
    participants.set(pool_id, list);
  });
  const cards: PoolCard[] = [];
  for (const r of rows) {
    const p = prodMap.get(r.product_id);
    if (!p) continue; // product no longer live
    const cur = asCurrency(r.currency);
    const fxRate = (r.fx_rate_id && rate.get(r.fx_rate_id)) || ctx.rate;
    const step = ctx.rounding[cur]?.step_minor ?? 1;
    const tiers: PoolTier[] = (p.price_tiers ?? [])
      .map((t) => ({ min_qty: t.min_qty, unit_price_minor: convertMinor(Number(t.unit_price_cents), t.currency ?? p.currency ?? 'USD', cur, fxRate, step) }))
      .sort((a, b) => a.min_qty - b.min_qty);
    const base = tiers[0]?.unit_price_minor ?? null;
    const target = priceAt(tiers, r.target_qty);
    const now = r.final_price_minor ?? r.pool_price_minor ?? priceAt(tiers, r.filled_qty);
    const { price_tiers: _t, currency: _c, ...product } = p;
    void _t; void _c;
    cards.push({
      id: r.id, code: r.code, status: r.status, currency: cur, product, supplier: sup.get(r.supplier_id) ?? null,
      target_qty: r.target_qty, filled_qty: r.filled_qty, min_pledge: r.min_pledge, max_buyers: r.max_buyers, deposit_pct: r.deposit_pct,
      deadline_at: r.deadline_at, created_at: r.created_at,
      pool_price_minor: now != null ? Number(now) : null, target_price_minor: target, base_price_minor: base,
      saving_pct: base && target != null && base > target ? Math.round(((base - target) / base) * 100) : 0,
      buyers: (participants.get(r.id) ?? []).length, tiers,
    });
  }
  return { cards, participants };
}

export type PoolFilters = {
  categoryIds?: string[]; closes?: string; fill?: string; country?: string; minPledge?: number; sort?: string;
  page?: number; productId?: string; limit?: number;
};
export const POOL_PAGE_SIZE = 12;
export type PoolList = {
  items: PoolCard[]; total: number;
  facets: { categoryCounts: Record<string, number>; countries: string[] };
  stats: { open: number; maxSaving: number };
};

/** Open pools for /pools, the home section and the product card. Filters + sort in one cached scope (the deadline clock is captured with it). */
export async function listOpenPools(f: PoolFilters = {}): Promise<PoolList> {
  'use cache';
  cacheLife({ revalidate: 60 });
  cacheTag('pools', 'currency', 'products');
  const now = Date.now();
  let q = createPublicClient().from('pools').select(POOL_COLS).eq('status', 'open').gt('deadline_at', new Date(now).toISOString());
  if (f.productId) q = q.eq('product_id', f.productId);
  const { data } = await q.order('deadline_at').limit(1000);
  const { cards: all } = await shapePools((data ?? []) as RawPool[]);
  const categoryCounts: Record<string, number> = {};
  all.forEach((c) => { if (c.product.category_id) categoryCounts[c.product.category_id] = (categoryCounts[c.product.category_id] ?? 0) + 1; });
  const countries = [...new Set(all.map((c) => c.supplier?.country).filter(Boolean) as string[])].sort();
  const hours: Record<string, number> = { '24h': 24, '3d': 72, '7d': 168 };
  let items = all.filter((c) => {
    if (f.categoryIds?.length && !(c.product.category_id && f.categoryIds.includes(c.product.category_id))) return false;
    if (f.closes && hours[f.closes] && new Date(c.deadline_at).getTime() - now > hours[f.closes] * 3600e3) return false;
    const fill = c.target_qty ? c.filled_qty / c.target_qty : 0;
    if (f.fill === 'almost' && fill <= 0.75) return false;
    if (f.fill === 'boost' && fill >= 0.3) return false;
    if (f.country && c.supplier?.country !== f.country) return false;
    if (f.minPledge && c.min_pledge >= f.minPledge) return false;
    return true;
  });
  const fillOf = (c: PoolCard) => (c.target_qty ? c.filled_qty / c.target_qty : 0);
  const sorters: Record<string, (a: PoolCard, b: PoolCard) => number> = {
    closing: (a, b) => a.deadline_at.localeCompare(b.deadline_at),
    saving: (a, b) => b.saving_pct - a.saving_pct,
    filled: (a, b) => fillOf(b) - fillOf(a),
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    buyers: (a, b) => b.buyers - a.buyers,
  };
  items = [...items].sort((a, b) => (sorters[f.sort ?? 'closing'] ?? sorters.closing)(a, b) || a.code.localeCompare(b.code));
  const limit = f.limit ?? Math.max(1, f.page ?? 1) * POOL_PAGE_SIZE;
  return {
    items: items.slice(0, limit), total: items.length,
    facets: { categoryCounts, countries },
    stats: { open: all.length, maxSaving: Math.max(0, ...all.map((c) => c.saving_pct)) },
  };
}

/** Pool detail (/pool/[code]) with participants (codes + countries only) and the public timeline. */
export async function getPool(code: string): Promise<PoolDetail | null> {
  'use cache';
  cacheLife({ revalidate: 60 });
  cacheTag('pools', `pool:${code}`, 'currency');
  if (!/^POOL-\d{1,10}$/i.test(code)) return null;
  const sb = createPublicClient();
  const { data } = await sb.from('pools').select(POOL_COLS).eq('code', code.toUpperCase()).maybeSingle();
  if (!data) return null;
  const raw = data as RawPool;
  const [{ cards, participants }, ev] = await Promise.all([
    shapePools([raw]),
    sb.from('pool_events').select('kind, title, body, qty, created_at').eq('pool_id', raw.id).order('created_at', { ascending: false }).limit(100),
  ]);
  const card = cards[0];
  if (!card) return null;
  const events = (ev.data ?? []) as PoolEvent[];
  const weekAgo = Date.now() - 7 * 864e5;
  const week_qty = events.filter((e) => new Date(e.created_at).getTime() >= weekAgo && ['joined', 'withdrawn', 'lapsed'].includes(e.kind))
    .reduce((s, e) => s + Number(e.qty ?? 0), 0);
  const list = participants.get(raw.id) ?? [];
  return {
    ...card, fx_rate_id: raw.fx_rate_id, terms_version_id: raw.terms_version_id, final_price_minor: raw.final_price_minor,
    balance_due_at: raw.balance_due_at, filled_at: raw.filled_at, participants: list, events, week_qty, starter: list.find((p) => p.is_starter) ?? null,
  };
}

/** Published Group Buy Terms (terms_versions.kind = 'group_buy'), acceptance recorded on every pledge. */
export async function getGroupBuyTerms(): Promise<{ id: string; version: string; published_at: string | null; sections: TermsSection[] } | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('site-content', 'pools');
  const { data } = await createPublicClient().from('terms_versions').select('id, version, published_at, sections')
    .eq('kind', 'group_buy').eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const sections = (Array.isArray(data.sections) ? data.sections : []) as TermsSection[];
  return { id: data.id as string, version: data.version as string, published_at: data.published_at as string | null, sections: [...sections].sort((a, b) => a.no - b.no) };
}

/** Product facts + price tiers for the start-a-pool form (tiers converted to the platform currency = the new pool's currency). */
export async function getPoolStartProduct(id: string): Promise<(PoolProduct & { currency: Currency; tiers: PoolTier[]; pool_minimum_pledge: number | null; supplier: PublicSupplier | null }) | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products', 'currency');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createPublicClient().from('products')
    .select('id, slug, title, unit, moq, image_url, category_id, hs_code, supplier_id, currency, pool_minimum_pledge, price_tiers(min_qty, unit_price_cents, currency)')
    .eq('id', id).eq('status', 'live').is('archived_at', null).maybeSingle();
  if (!data) return null;
  const [ctx, sup] = await Promise.all([getCurrencyContext(), supplierMap([data.supplier_id as string])]);
  const tiers = ((data.price_tiers ?? []) as RawTier[])
    .map((t) => ({ min_qty: t.min_qty, unit_price_minor: toPlatform(ctx, Number(t.unit_price_cents), t.currency ?? data.currency) ?? 0 }))
    .sort((a, b) => a.min_qty - b.min_qty);
  return {
    id: data.id, slug: data.slug, title: data.title, unit: data.unit, moq: data.moq, image_url: data.image_url, category_id: data.category_id, hs_code: data.hs_code,
    currency: ctx.currency, tiers, pool_minimum_pledge: data.pool_minimum_pledge as number | null, supplier: sup.get(data.supplier_id as string) ?? null,
  };
}

/* ───────── Home (Main.png redesign) ───────── */
/** Category names each supplier actually lists live products in (for the "Verified suppliers" cards).
 *  Reads live products through the anon client (supplier_id + category only — never supplier legal data). */
export async function getSupplierCategories(supplierIds: string[], max = 3): Promise<Record<string, string[]>> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products', 'site-content');
  const ids = [...new Set(supplierIds)].filter(Boolean);
  if (!ids.length) return {};
  const sb = createPublicClient();
  const [{ data: rows }, { data: cats }] = await Promise.all([
    sb.from('products').select('supplier_id, category_id').eq('status', 'live').is('archived_at', null).in('supplier_id', ids).limit(2000),
    sb.from('categories').select('id, name').eq('active', true),
  ]);
  const names = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  const tally = new Map<string, Map<string, number>>();
  (rows ?? []).forEach((r) => {
    const name = r.category_id ? names.get(r.category_id as string) : undefined;
    if (!name) return;
    const m = tally.get(r.supplier_id as string) ?? new Map<string, number>();
    m.set(name, (m.get(name) ?? 0) + 1);
    tally.set(r.supplier_id as string, m);
  });
  const out: Record<string, string[]> = {};
  tally.forEach((m, id) => { out[id] = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n); });
  return out;
}
