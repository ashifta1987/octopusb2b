import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';

/**
 * Storefront data layer (SPEC P3). Every function is a `use cache` scope (Cache Components ISR equivalent,
 * revalidated every 5 minutes and tagged so CMS/catalog edits can call revalidateTag). Reads use the anon
 * client only: RLS exposes live products and the `public_suppliers` view (code + country + badge), never
 * supplier legal names, contacts or costs.
 */

export type PublicSupplier = { id: string; code: string; country: string | null; verified: boolean; supplier_type: string | null };
export type Tier = { min_qty: number; unit_price_cents: number };
export type TagRef = { name: string; slug: string; kind: string };
export type CardProduct = {
  id: string; slug: string; title: string; unit: string; moq: number; min_price_cents: number | null; image_url: string | null;
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
  'id, slug, title, unit, moq, min_price_cents, image_url, category_id, supplier_id, octopus_dropship, ready_to_ship, price_tiers(min_qty, unit_price_cents), product_tags(tags(name, slug, kind))';

type RawCard = Omit<CardProduct, 'tiers' | 'tags' | 'supplier'> & {
  price_tiers: Tier[] | null; product_tags: { tags: TagRef | TagRef[] | null }[] | null;
};

function shape(r: RawCard, sup: Map<string, PublicSupplier>): CardProduct {
  const { price_tiers, product_tags, ...rest } = r;
  return {
    ...rest,
    tiers: [...(price_tiers ?? [])].sort((a, b) => a.min_qty - b.min_qty),
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
  const sup = await supplierMap(rows.map((r) => r.supplier_id));
  return rows.map((r) => shape(r, sup));
}

/* ───────── Services & prices ───────── */
export type ServiceInfo = { code: string; name: string; description: string | null; unit: string; priceCents: number };
export async function getServices(): Promise<Record<string, ServiceInfo>> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('service-prices');
  const sb = createPublicClient();
  const [{ data: services }, { data: prices }] = await Promise.all([
    sb.from('services').select('code, name, description, unit').eq('active', true).order('sort'),
    sb.from('service_prices').select('service_code, amount_usd_cents, effective_from').lte('effective_from', new Date().toISOString()).order('effective_from', { ascending: false }),
  ]);
  const price: Record<string, number> = {};
  (prices ?? []).forEach((p) => { if (price[p.service_code] == null) price[p.service_code] = Number(p.amount_usd_cents); });
  const out: Record<string, ServiceInfo> = {};
  (services ?? []).forEach((s) => (out[s.code] = { ...s, priceCents: price[s.code] ?? 0 }));
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
  cacheTag('products');
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
  cacheTag('products');
  const sb = createPublicClient();
  let query = sb.from('products').select(CARD_COLS, { count: 'exact' }).eq('status', 'live').is('archived_at', null);

  if (f.categoryIds?.length) query = query.in('category_id', f.categoryIds);
  if (f.minCents != null) query = query.gte('min_price_cents', f.minCents);
  if (f.maxCents != null) query = query.lte('min_price_cents', f.maxCents);
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
    case 'price_asc': query = query.order('min_price_cents', { ascending: true, nullsFirst: false }); break;
    case 'price_desc': query = query.order('min_price_cents', { ascending: false, nullsFirst: false }); break;
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
  cacheTag('products', `product:${slug}`);
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
  cacheTag('products');
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
  const { data } = await createPublicClient().from('public_suppliers').select('id, code, country, verified, supplier_type').eq('verified', true).order('code').limit(limit);
  return (data ?? []) as PublicSupplier[];
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
    .eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle();
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
