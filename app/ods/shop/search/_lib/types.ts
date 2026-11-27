/** /shop/search shared types + pure helpers (client-safe). */
import type { ShopCardModel } from '../../_lib/cards';
import { SECTION_ORDER, type ShopSectionKey } from '../../_lib/sections';

export type SearchGroup = { key: ShopSectionKey; total: number; items: ShopCardModel[]; error: boolean; note?: string };
export type SearchResult = { q: string; groups: SearchGroup[]; canAct: boolean };

/** ?type= values (URL-friendly) ↔ section keys. */
export const SEARCH_TYPE_PARAM: Record<ShopSectionKey, string> = { sourcing: 'products', pools: 'pools', dropship: 'dropship', '3pl': 'warehouse', turnkey: 'turnkey', brand: 'brand' };

export function parseSearchType(v: string | null | undefined): ShopSectionKey | null {
  const s = (v ?? '').trim().toLowerCase();
  const hit = SECTION_ORDER.find((k) => SEARCH_TYPE_PARAM[k] === s || k === s);
  return hit ?? null;
}

export function searchHref(q: string, type: ShopSectionKey | null, base = '/shop/search'): string {
  const u = new URLSearchParams();
  if (q) u.set('q', q);
  if (type) u.set('type', SEARCH_TYPE_PARAM[type]);
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

export function tokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 8);
}

export function matches(haystack: string, toks: string[]): boolean {
  const h = haystack.toLowerCase();
  return toks.every((t) => h.includes(t));
}
