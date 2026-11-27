/**
 * ODS T4 · search suggestions (pure; used by app/api/shop/suggest/route.ts, the fixture route and unit tests).
 * `buildSuggestGroups(q, sources, limit)` → SuggestGroup[] in the order Products · MOQ pools · Turnkey projects ·
 * Categories. WHITE-LABEL: each item copies only a label, a public Shop href and an optional short meta line — never a
 * supplier/factory field, model number, price or cost. Empty groups are left out.
 */
import type { SuggestGroup } from '@octopus/ui/suggest';
import { categoryProductsHref } from './sections';
import { poolHref, productHref, turnkeyHref } from './cards';

export type SuggestSources = {
  products: { slug: string; title: string }[];
  pools: { code: string; product: { title: string } }[];
  projects: { project_id: string; title: string }[];
  categories: { slug: string; name: string }[];
};

/** Trim, collapse spaces, drop characters PostgREST filters treat specially; max 100 chars. */
export function cleanQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[,()"\\:%*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export const clampLimit = (raw: string | number | null | undefined, def = 5) => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : def;
};

const has = (text: string, q: string) => text.toLowerCase().includes(q.toLowerCase());

export function buildSuggestGroups(q: string, src: SuggestSources, limit = 5): SuggestGroup[] {
  const term = cleanQuery(q);
  if (term.length < 2) return [];
  const groups: SuggestGroup[] = [
    { id: 'products', label: 'Products', items: src.products.slice(0, limit).map((p) => ({ id: p.slug, label: p.title, href: productHref(p.slug) })) },
    {
      id: 'pools',
      label: 'MOQ pools',
      items: src.pools.filter((p) => has(p.product.title, term)).slice(0, limit).map((p) => ({ id: p.code, label: p.product.title, href: poolHref(p.code), meta: 'MOQ pool' })),
    },
    {
      id: 'projects',
      label: 'Turnkey projects',
      items: src.projects.filter((p) => has(p.title, term)).slice(0, limit).map((p) => ({ id: p.project_id, label: p.title, href: turnkeyHref(p.project_id), meta: 'Turnkey project' })),
    },
    {
      id: 'categories',
      label: 'Categories',
      items: src.categories.filter((c) => has(c.name, term)).slice(0, limit).map((c) => ({ id: c.slug, label: c.name, href: categoryProductsHref(c.slug), meta: 'Category' })),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}
