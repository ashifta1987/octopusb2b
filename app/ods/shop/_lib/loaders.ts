import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent, descendantIds, type Category } from '@/lib/content';
import { getCardsByIds, listOpenPools, listProducts } from '@/components/store/data';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { getDropshipCatalogue, pickRoute } from '@/lib/dropship';
import { brandMethods } from '@/components/store/make-my-brand/content';
import { dropshipOn, nowIso } from '@/lib/core/account';
import { listWaiting, type WaitingItem } from '@/lib/core/waiting';
import { getRecentlyViewedIds, getShopViewer } from '@/lib/shop/data';
import { shopCan } from '@/lib/shop/shared';
import {
  toBrandCard, toDropshipCard, toPoolCard, toServiceCard, toSourcingCard, toTurnkeyCard, warehouseServicesFrom,
  type ShopCardModel, type SourcingCardModel, type WarehouseRatePlan,
} from './cards';
import { SHOP_SECTIONS, type ShopSectionKey } from './sections';

/**
 * ODS T4 · Shop data loaders (server only; call them inside <Suspense> — they read the session or request data).
 * Reuse today's data layer: components/store/data (public cached product / pool queries — the anon client, no supplier
 * ids), lib/turnkey/catalogue, lib/dropship (SECURITY DEFINER RPC with allowlisted columns), lib/shop/data (viewer,
 * recently viewed), lib/core/waiting. Every result goes through the pure mappers in ./cards (white-label).
 *
 * API (stable):
 *  - `getShopFrameData()` → ShopFrameData      viewer + categories + flags for the header, section bar, bottom nav, footer
 *                                                (React cache: once per request; redirects like getShopViewer when signed out)
 *  - `getShopCategories()` → ShopCategory[]     level-1 categories (+ children) in sort order; `ids` = the category + descendants
 *  - `resolveCategory(slug)` → ShopCategory | null
 *  - `loadSectionItems(service, { category?, limit? })` → Promise<SectionResult>
 *        service: ShopSectionKey; category: a level-1 OR deeper category slug (unknown slug = all); limit default 4.
 *        Throws when the source fails (render the section's error state). React-cached per (service, category, limit).
 *        Sections that don't belong to product categories (3pl, turnkey, brand) ignore `category` (`filtered: false`).
 *  - `getRecentlyViewedCards(limit = 4)` → SourcingCardModel[]
 *  - `getWaitingTiles(limit = 3)` → WaitingItem[]   same list as My account › Action needed, most urgent first
 *  - `getCompanyInterests()` → string[]   company_interests (migration 252, a DRAFT): [] when the table isn't there
 */

export type ShopCategory = { id: string; slug: string; name: string; ids: string[]; children: { id: string; slug: string; name: string }[] };

export type ShopViewerLite = {
  firstName: string | null;
  orgName: string;
  /** organizations.kyc_status: 'verified' | 'pending' | 'not_started' | 'more_info' | 'rejected' … */
  kycStatus: string;
  verified: boolean;
  /** US$ available in the wallet; null = no wallet summary (shown as an honest line, never 0). */
  walletAvailable: number | null;
  /** Quote list count (= "Cart (n)" until T5). */
  cartCount: number;
  unread: number;
  /** owner / buyer may add to cart and send requests; viewer only browses. */
  canAct: boolean;
  dropshipAccess: boolean;
  dropshipRequestHref: string;
  /** ISO-2 country of the company, for dropship landed cost (default US). */
  country: string;
};

export type ShopFrameData = {
  viewer: ShopViewerLite;
  categories: ShopCategory[];
  poolsOn: boolean;
  turnkeyOn: boolean;
  legalName: string | null;
};

export type SectionResult = { service: ShopSectionKey; items: ShopCardModel[]; total: number; filtered: boolean };

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (iso: string) => {
  try {
    return regionNames.of(iso.toUpperCase()) ?? iso;
  } catch {
    return iso;
  }
};

function shapeCategories(all: Category[]): ShopCategory[] {
  const top = all.filter((c) => c.level === 1).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return top.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    ids: descendantIds(all, c.id),
    children: all.filter((k) => k.parent_id === c.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((k) => ({ id: k.id, slug: k.slug, name: k.name })),
  }));
}

export async function getShopCategories(): Promise<ShopCategory[]> {
  const { categories } = await getSiteContent();
  return shapeCategories(categories);
}

/** Any active category by slug (level 1 or deeper); the result's `ids` include its descendants. */
export async function resolveCategory(slug: string | null | undefined): Promise<ShopCategory | null> {
  if (!slug) return null;
  const { categories } = await getSiteContent();
  const c = categories.find((x) => x.slug === slug);
  if (!c) return null;
  return { id: c.id, slug: c.slug, name: c.name, ids: descendantIds(categories, c.id), children: [] };
}

export const getShopFrameData = cache(async (): Promise<ShopFrameData> => {
  const [v, { settings, company, categories }] = await Promise.all([getShopViewer(), getSiteContent()]);
  const access = v.dropshipV2 && dropshipOn(v.services.dropship);
  return {
    viewer: {
      firstName: v.firstName,
      orgName: v.org.name,
      kycStatus: v.org.kyc_status ?? 'not_started',
      verified: v.org.kyc_status === 'verified',
      walletAvailable: v.wallet ? Number(v.wallet.available_cents) / 100 : null,
      cartCount: v.quoteCount,
      unread: v.unread,
      canAct: shopCan(v.role),
      dropshipAccess: access,
      dropshipRequestHref: v.dropshipV2 ? '/account/dropship' : '/request/dropship',
      country: (v.org.country ?? 'US').toUpperCase(),
    },
    categories: shapeCategories(categories),
    poolsOn: settings.pool_enabled !== false,
    turnkeyOn: settings['turnkey.enabled'] !== false,
    legalName: company?.legal_name ?? null,
  };
});

async function warehousePlan(): Promise<WarehouseRatePlan> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('wh_rate_versions')
    .select('receiving_per_carton_cents, storage_per_pallet_month_cents, pick_pack_first_cents, pick_pack_extra_cents, returns_per_item_cents')
    .eq('status', 'active').eq('plan_code', 'standard').is('warehouse_code', null).maybeSingle();
  if (error) throw new Error('Could not load warehouse rates.');
  return (data ?? null) as WarehouseRatePlan;
}

async function load(service: ShopSectionKey, categorySlug: string | null, limit: number): Promise<SectionResult> {
  const cat = SHOP_SECTIONS[service].byCategory ? await resolveCategory(categorySlug) : null;
  const filtered = !!cat;
  const now = Date.parse(nowIso());
  switch (service) {
    case 'sourcing': {
      const { items, total } = await listProducts({ categoryIds: cat?.ids });
      return { service, items: items.slice(0, limit).map((p) => toSourcingCard(p, { now })), total, filtered };
    }
    case 'pools': {
      const { settings } = await getSiteContent();
      if (settings.pool_enabled === false) return { service, items: [], total: 0, filtered };
      const { items, total } = await listOpenPools({ categoryIds: cat?.ids, sort: 'closing', limit: limit + 4 });
      const cards = items.map((p) => toPoolCard(p, { now })).filter((c): c is NonNullable<typeof c> => c !== null);
      return { service, items: cards.slice(0, limit), total, filtered };
    }
    case 'dropship': {
      const { viewer } = await getShopFrameData();
      if (viewer.dropshipAccess) {
        const { rows, totalCount } = await getDropshipCatalogue({ country: viewer.country, category: cat?.name ?? null });
        const access = { hasAccess: true, requestHref: viewer.dropshipRequestHref, country: countryName(viewer.country) };
        // model_no / variants / specs are NOT passed on: only id, title, first image, stock and the best route
        const items = rows.slice(0, limit).map((r) => toDropshipCard({ id: r.product_id, title: r.title, image: r.images[0] ?? null, stock_status: r.stock_status, route: pickRoute(r.routes) }, access));
        return { service, items, total: totalCount, filtered };
      }
      const { items, total } = await listProducts({ dropship: true, sort: 'newest', categoryIds: cat?.ids });
      const access = { hasAccess: false, requestHref: viewer.dropshipRequestHref };
      return { service, items: items.slice(0, limit).map((p) => toDropshipCard({ id: p.id, title: p.title, image: p.image_url }, access)), total, filtered };
    }
    case '3pl': {
      const rows = warehouseServicesFrom(await warehousePlan());
      return { service, items: rows.slice(0, limit).map(toServiceCard), total: rows.length, filtered: false };
    }
    case 'turnkey': {
      const { settings } = await getSiteContent();
      if (settings['turnkey.enabled'] === false) return { service, items: [], total: 0, filtered: false };
      const { projects } = await getTurnkeyCatalogue();
      const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
      return { service, items: projects.slice(0, limit).map((p) => toTurnkeyCard(p, { supabaseUrl: sb })), total: projects.length, filtered: false };
    }
    case 'brand': {
      const { settings } = await getSiteContent();
      const methods = brandMethods(settings);
      return { service, items: methods.slice(0, limit).map(toBrandCard), total: methods.length, filtered: false };
    }
  }
}

const loadCached = cache((service: ShopSectionKey, categorySlug: string | null, limit: number) => load(service, categorySlug, limit));

export function loadSectionItems(service: ShopSectionKey, opts: { category?: string | null; limit?: number } = {}): Promise<SectionResult> {
  return loadCached(service, opts.category || null, opts.limit ?? 4);
}

export async function getRecentlyViewedCards(limit = 4): Promise<SourcingCardModel[]> {
  const now = Date.parse(nowIso());
  const cards = await getCardsByIds(await getRecentlyViewedIds(Math.max(limit, 8)));
  return cards.slice(0, limit).map((p) => toSourcingCard(p, { now }));
}

export async function getWaitingTiles(limit = 3): Promise<WaitingItem[]> {
  const v = await getShopViewer();
  return listWaiting(v.org.id, nowIso(), limit);
}

/** company_interests (draft migration 252): the services picked at setup, first pick first. [] if the table is missing. */
export async function getCompanyInterests(): Promise<string[]> {
  const v = await getShopViewer();
  const sb = await createClient();
  const { data, error } = await sb.from('company_interests').select('service, created_at').eq('org_id', v.org.id).order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map((r) => String(r.service));
}
