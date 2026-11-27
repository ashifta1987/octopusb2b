import 'server-only';
import { listOpenPools, listProducts } from '@/components/store/data';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { getDropshipCatalogue, pickRoute } from '@/lib/dropship';
import { nowIso } from '@/lib/core/account';
import { toDropshipCard, toPoolCard, toSourcingCard, toTurnkeyCard } from '../../_lib/cards';
import { matches, tokens, type SearchGroup, type SearchResult } from './types';
import { getShopFrameData, loadSectionItems, countryName } from '../../_lib/loaders';
import { SECTION_ORDER, type ShopSectionKey } from '../../_lib/sections';

/**
 * /shop/search loaders (Part 5.7). One query per section, run side by side; a failing section becomes that section's
 * error state only (Promise.allSettled). Every row goes through the FRAME builder's white-label mappers (./_lib/cards).
 *  - sourcing  listProducts({ q })                                   (full text + title + HS code; no supplier codes)
 *  - pools     listOpenPools() filtered by product title             (public pools; buyer counts only)
 *  - dropship  with access: get_dropship_catalogue(search) RPC; without: listProducts({ q, dropship }) — no prices
 *  - 3pl       the four warehouse services (loadSectionItems('3pl')) matched on name/description/keywords
 *  - turnkey   getTurnkeyCatalogue() matched on title/category/reason
 *  - brand     Make My Brand methods (loadSectionItems('brand')) matched on name/description
 */

const WAREHOUSE_WORDS = 'warehouse 3pl storage store stock fulfilment fulfillment pick pack ship receiving returns pallet';

export async function loadSearch(q: string, limit = 4): Promise<SearchResult> {
  const { viewer, poolsOn, turnkeyOn } = await getShopFrameData();
  const toks = tokens(q);
  const now = Date.parse(nowIso());

  const run: Record<ShopSectionKey, () => Promise<Omit<SearchGroup, 'key' | 'error'>>> = {
    sourcing: async () => {
      const { items, total } = await listProducts({ q });
      return { total, items: items.slice(0, limit).map((p) => toSourcingCard(p, { now })) };
    },
    pools: async () => {
      if (!poolsOn) return { total: 0, items: [] };
      const { items } = await listOpenPools({ limit: 100 });
      const cards = items
        .filter((p) => matches(p.product.title, toks))
        .map((p) => toPoolCard(p, { now }))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      return { total: cards.length, items: cards.slice(0, limit) };
    },
    dropship: async () => {
      if (viewer.dropshipAccess) {
        const { rows, totalCount } = await getDropshipCatalogue({ country: viewer.country, search: q });
        const access = { hasAccess: true, requestHref: viewer.dropshipRequestHref, country: countryName(viewer.country) };
        // only id, title, first image, stock and the best route — never model_no, specs or variants
        const items = rows.slice(0, limit).map((r) => toDropshipCard({ id: r.product_id, title: r.title, image: r.images[0] ?? null, stock_status: r.stock_status, route: pickRoute(r.routes) }, access));
        return { total: totalCount, items };
      }
      const { items, total } = await listProducts({ q, dropship: true });
      const access = { hasAccess: false, requestHref: viewer.dropshipRequestHref };
      return {
        total,
        items: items.slice(0, limit).map((p) => toDropshipCard({ id: p.id, title: p.title, image: p.image_url }, access)),
        note: 'Prices and landed cost show after Dropship access is approved.',
      };
    },
    '3pl': async () => {
      const { items } = await loadSectionItems('3pl', { limit: 20 });
      const hits = items.filter((m) => matches(`${m.title} ${m.kind === '3pl' ? m.description : ''} ${WAREHOUSE_WORDS}`, toks));
      return { total: hits.length, items: hits.slice(0, limit), note: 'Rates are confirmed in your quote.' };
    },
    turnkey: async () => {
      if (!turnkeyOn) return { total: 0, items: [] };
      const { projects } = await getTurnkeyCatalogue();
      const hits = projects.filter((p) => matches(`${p.title} ${p.category ?? ''} ${p.short_reason ?? ''}`, toks));
      const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
      return { total: hits.length, items: hits.slice(0, limit).map((p) => toTurnkeyCard(p, { supabaseUrl: sb })) };
    },
    brand: async () => {
      const { items } = await loadSectionItems('brand', { limit: 50 });
      const hits = items.filter((m) => matches(`${m.title} ${m.kind === 'brand' ? m.description : ''} brand logo label packaging`, toks));
      return { total: hits.length, items: hits.slice(0, limit) };
    },
  };

  const settled = await Promise.allSettled(SECTION_ORDER.map((k) => run[k]()));
  const groups: SearchGroup[] = SECTION_ORDER.map((key, i) => {
    const r = settled[i];
    return r.status === 'fulfilled' ? { key, error: false, ...r.value } : { key, total: 0, items: [], error: true };
  });
  return { q, groups, canAct: viewer.canAct };
}
