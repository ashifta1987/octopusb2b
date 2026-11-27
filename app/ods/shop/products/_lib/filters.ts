/**
 * /shop/products URL state (Part 2.8): every filter, the sort and the page live in the query string, so Back/Forward
 * work and links can be shared. Pure + client-safe. Keys:
 *   q, category (legacy ?c= is read too), min, max (unit price, platform currency), moq (max minimum order),
 *   lead (max delivery days), verified=1, samples=1, custom=1, pool=1, sort, page.
 * Ships to is NOT a key: products carry no destination data (see the disabled filter and its reason).
 */
export const PRODUCT_SORTS = [
  ['best', 'Best match'],
  ['price_asc', 'Lowest price'],
  ['moq_asc', 'Lowest minimum order'],
  ['lead_asc', 'Fastest delivery'],
  ['newest', 'Newest'],
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number][0];

export const MOQ_OPTIONS = [50, 100, 300, 500, 1000, 5000] as const;
export const LEAD_OPTIONS = [7, 15, 20, 30, 45] as const;

export type ProductFilterState = {
  q: string;
  category: string | null;
  min: number | null;
  max: number | null;
  moq: number | null;
  lead: number | null;
  verified: boolean;
  samples: boolean;
  custom: boolean;
  pool: boolean;
  sort: ProductSort;
  page: number;
};

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').trim();
const num = (v: string) => {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function parseProductParams(sp: SearchParamsRecord): ProductFilterState {
  const sort = one(sp.sort);
  const cat = one(sp.category) || one(sp.c);
  const page = num(one(sp.page));
  return {
    q: one(sp.q).slice(0, 100),
    category: /^[a-z0-9-]{1,80}$/i.test(cat) ? cat : null,
    min: num(one(sp.min)),
    max: num(one(sp.max)),
    moq: num(one(sp.moq)),
    lead: num(one(sp.lead)),
    verified: one(sp.verified) === '1',
    samples: one(sp.samples) === '1',
    custom: one(sp.custom) === '1',
    pool: one(sp.pool) === '1',
    sort: (PRODUCT_SORTS.some(([k]) => k === sort) ? sort : 'best') as ProductSort,
    page: page != null && page >= 1 ? Math.min(500, Math.floor(page)) : 1,
  };
}

/** Number of filters in use (search and sort are not filters). */
export function activeFilterCount(s: ProductFilterState): number {
  return [s.category, s.min, s.max, s.moq, s.lead].filter((x) => x != null).length + [s.verified, s.samples, s.custom, s.pool].filter(Boolean).length;
}

/** Query string for a state + patch. Any change other than `page` goes back to page 1. */
export function productsQuery(s: ProductFilterState, patch: Partial<ProductFilterState> = {}): string {
  const keys = Object.keys(patch);
  const next: ProductFilterState = { ...s, ...patch, page: keys.length && !keys.includes('page') ? 1 : (patch.page ?? s.page) };
  const u = new URLSearchParams();
  if (next.q) u.set('q', next.q);
  if (next.category) u.set('category', next.category);
  if (next.min != null) u.set('min', String(next.min));
  if (next.max != null) u.set('max', String(next.max));
  if (next.moq != null) u.set('moq', String(next.moq));
  if (next.lead != null) u.set('lead', String(next.lead));
  if (next.verified) u.set('verified', '1');
  if (next.samples) u.set('samples', '1');
  if (next.custom) u.set('custom', '1');
  if (next.pool) u.set('pool', '1');
  if (next.sort !== 'best') u.set('sort', next.sort);
  if (next.page > 1) u.set('page', String(next.page));
  return u.toString();
}

export function productsHref(s: ProductFilterState, patch: Partial<ProductFilterState> = {}, base = '/shop/products'): string {
  const q = productsQuery(s, patch);
  return q ? `${base}?${q}` : base;
}

export const EMPTY_FILTERS: ProductFilterState = parseProductParams({});
