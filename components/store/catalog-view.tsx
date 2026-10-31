import Link from 'next/link';
import { descendantIds, categoryPath, type Category } from '@/lib/content';
import { getStoreContent } from './currency';
import { toCents } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import { listProducts, getTags, getCategoryCounts, PAGE_SIZE, type ListFilters } from './data';
import { ProductGrid } from './product-card';
import { FilterForm, SortSelect } from './filter-form';
import { AdSlot, type AdPlacement } from './ad-slot';
import { Breadcrumbs, JsonLd, breadcrumbLd, parts } from './seo';

export type SP = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const num = (v: string) => { const n = Number(v); return v !== '' && Number.isFinite(n) && n >= 0 ? n : undefined; };

const SORTS: [string, string][] = [['best', 'Best match'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['moq_asc', 'Lowest MOQ'], ['newest', 'Newest']];
const MOQS = [10, 50, 100, 500, 1000, 5000];
const FILTER_KEYS = ['q', 'c', 'min', 'max', 'moq', 'cert', 'ds', 'rts', 'verified', 'sort'];

function qs(sp: SP, patch: Record<string, string | null>) {
  const u = new URLSearchParams();
  for (const k of FILTER_KEYS) many(sp[k]).forEach((v) => v && u.append(k, v));
  for (const [k, v] of Object.entries(patch)) { u.delete(k); if (v) u.set(k, v); }
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Products.png — shared by /products, /c/[...slug] and /search. Server-paginated (24/page). */
export async function CatalogView({ basePath, category, sp, placement, title }: {
  basePath: string; category: Category | null; sp: SP; placement: AdPlacement; title?: string;
}) {
  const { categories, blocks, ctx } = await getStoreContent();
  const [tags, counts] = await Promise.all([getTags(), getCategoryCounts()]);
  const q = one(sp.q).trim();
  const page = Math.max(1, Math.floor(num(one(sp.page)) ?? 1));
  const min = num(one(sp.min)), max = num(one(sp.max)), moq = num(one(sp.moq));
  const certs = many(sp.cert);
  const sort = one(sp.sort) || 'best';
  const filters: ListFilters = {
    q: q || undefined,
    categoryIds: category ? descendantIds(categories, category.id) : undefined,
    minCents: min != null ? toCents(min) : undefined,
    maxCents: max != null ? toCents(max) : undefined,
    moqMax: moq,
    tagSlugs: certs.length ? certs : undefined,
    dropship: one(sp.ds) === '1', ready: one(sp.rts) === '1', verified: one(sp.verified) === '1',
    sort, page,
  };
  const { items, total } = await listProducts(filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const countOf = (id: string) => descendantIds(categories, id).reduce((s, x) => s + (counts[x] ?? 0), 0);

  const path = category ? categoryPath(categories, category.id) : [];
  const catHref = (c: Category) => `/c/${categoryPath(categories, c.id).map((x) => x.slug).join('/')}`;
  const crumbs: { name: string; href?: string }[] = [{ name: 'Home', href: '/' }, { name: 'All categories', href: '/products' }, ...path.map((c) => ({ name: c.name, href: catHref(c) }))];
  if (basePath === '/search') crumbs.push({ name: q ? `Search: “${q}”` : 'Search' });
  const heading = title ?? category?.name ?? (q ? `Results for “${q}”` : 'All categories');
  const chips = category ? categories.filter((c) => c.parent_id === category.id) : categories.filter((c) => c.level === 1);
  const certTags = tags.filter((t) => t.kind === 'certification');
  const keep = (k: string) => (basePath === '/search' ? one(sp[k]) : '');
  const [ctaTitle, ctaBody, ctaBtn] = parts(blocks, 'products.cta', "Didn't find the right product?|Send one request and get quotes from several verified suppliers.|Request a product");
  const active = !!(q || min != null || max != null || moq != null || certs.length || filters.dropship || filters.ready || filters.verified);

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6">
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs items={crumbs} />
      <div className="flex flex-wrap justify-between items-end gap-4 mt-3">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-extrabold leading-tight">{heading}</h1>
          <p className="text-sm text-muted mt-1" aria-live="polite">{total.toLocaleString('en-US')} {total === 1 ? 'product' : 'products'} · Prices in {ctx.currency} per unit</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-sm text-muted">Sort by</label>
          <SortSelect key={sort} form="filters" value={sort} options={SORTS} />
        </div>
      </div>

      {chips.length > 0 && (
        <nav aria-label="Categories" className="mt-5 flex flex-wrap gap-2">
          {category ? (
            <Link href={path.length > 1 ? catHref(path[path.length - 2]) : '/products'} className="rounded-full border border-line-2 bg-white px-3.5 py-1.5 text-[13px] font-semibold">← {path.length > 1 ? path[path.length - 2].name : 'All categories'}</Link>
          ) : (
            <span className="rounded-full bg-navy text-white px-3.5 py-1.5 text-[13px] font-semibold" aria-current="page">All categories <span className="opacity-70">{total}</span></span>
          )}
          {chips.map((c) => (
            <Link key={c.id} href={`${catHref(c)}${qs(sp, { q: null, c: null, page: null })}`} className="rounded-full border border-line-2 bg-white px-3.5 py-1.5 text-[13px] font-semibold hover:border-navy">
              {c.name} <span className="text-muted font-normal">{countOf(c.id)}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr] items-start">
        {/* Filters */}
        <aside aria-label="Filters" className="card p-5 lg:sticky lg:top-6">
          <FilterForm key={basePath + qs(sp, {})} id="filters" action={basePath} className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-bold">Filters</h2>
              {active && <Link href={basePath === '/search' ? `/search${qs({}, { q: keep('q') || null, c: keep('c') || null })}` : basePath} className="text-[13px] font-semibold text-blue">Clear all</Link>}
            </div>
            {basePath === '/search' && (
              <>
                <input type="hidden" name="q" value={q} />
                {one(sp.c) && <input type="hidden" name="c" value={one(sp.c)} />}
              </>
            )}
            <fieldset>
              <legend className="text-sm font-semibold mb-2">Category</legend>
              <CategoryTree categories={categories} activePath={path.map((c) => c.id)} hrefFor={(c) => `${catHref(c)}${qs(sp, { q: null, c: null, page: null })}`} countOf={countOf} />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold mb-2">Supplier</legend>
              <Check name="verified" label="Verified suppliers only" checked={filters.verified!} />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold mb-2">Services</legend>
              <Check name="rts" label="Ready to ship" checked={filters.ready!} />
              <Check name="ds" label="Available on Octopus Dropship" checked={filters.dropship!} />
            </fieldset>
            {certTags.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold mb-2">Certifications</legend>
                {certTags.map((t) => <Check key={t.slug} name="cert" value={t.slug} label={t.name} checked={certs.includes(t.slug)} />)}
              </fieldset>
            )}
            <fieldset>
              <legend className="text-sm font-semibold mb-2">Price ({ctx.currency} per unit)</legend>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="f-min">Minimum price</label>
                <input id="f-min" name="min" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Min" defaultValue={min ?? ''} className="input !min-h-10 text-sm" />
                <span aria-hidden>–</span>
                <label className="sr-only" htmlFor="f-max">Maximum price</label>
                <input id="f-max" name="max" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Max" defaultValue={max ?? ''} className="input !min-h-10 text-sm" />
              </div>
            </fieldset>
            <div>
              <label htmlFor="f-moq" className="text-sm font-semibold mb-2 block">Max MOQ</label>
              <select id="f-moq" name="moq" defaultValue={moq ?? ''} className="input !min-h-10 text-sm">
                <option value="">Any</option>
                {MOQS.map((m) => <option key={m} value={m}>{m.toLocaleString('en-US')} or less</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-dark btn-sm w-full">Apply filters</button>
          </FilterForm>
        </aside>

        <div className="min-w-0 space-y-5">
          <AdSlot placement={placement} />
          {items.length ? (
            <ProductGrid products={items} categoryNames={catName} />
          ) : (
            <div className="card">
              <EmptyState
                title={active ? 'No products match these filters' : 'No products here yet'}
                body={active ? 'Try removing a filter or widening the price range. Or tell us what you need and we will source it.' : 'Tell us what you need and our team will find suppliers who can quote.'}
                action={<div className="flex gap-3 justify-center flex-wrap">{active && <Link href={basePath} className="btn btn-ghost btn-sm">Clear filters</Link>}<Link href="/request/sourcing" className="btn btn-primary btn-sm">Request a product</Link></div>}
              />
            </div>
          )}
          {pages > 1 && <Pagination page={page} pages={pages} href={(p) => `${basePath}${qs(sp, { page: p > 1 ? String(p) : null })}`} />}
          <div className="rounded-[14px] bg-navy text-white px-6 sm:px-8 py-7 flex flex-wrap justify-between items-center gap-4">
            <div>
              <h2 className="!text-white text-xl font-bold">{ctaTitle}</h2>
              <p className="text-[#C9CFDB] text-sm mt-1">{ctaBody}</p>
            </div>
            <Link href="/request/sourcing" className="btn btn-primary">{ctaBtn}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Check({ name, label, checked, value = '1' }: { name: string; label: string; checked: boolean; value?: string }) {
  const id = `f-${name}-${value}`;
  return (
    <div className="flex items-center gap-2.5">
      <input id={id} type="checkbox" name={name} value={value} defaultChecked={checked} className="w-4 h-4 accent-[#2A6FD6]" />
      <label htmlFor={id} className="text-sm">{label}</label>
    </div>
  );
}

function CategoryTree({ categories, activePath, hrefFor, countOf }: {
  categories: Category[]; activePath: string[]; hrefFor: (c: Category) => string; countOf: (id: string) => number;
}) {
  const render = (parent: string | null, depth: number): React.ReactNode => {
    const kids = categories.filter((c) => c.parent_id === parent);
    if (!kids.length) return null;
    return (
      <ul className={depth ? 'ml-3 mt-1 border-l border-line pl-2 space-y-1' : 'space-y-1'}>
        {kids.map((c) => {
          const on = activePath.includes(c.id);
          const current = activePath[activePath.length - 1] === c.id;
          return (
            <li key={c.id}>
              <Link href={hrefFor(c)} aria-current={current ? 'page' : undefined} className={`flex justify-between gap-2 text-sm py-0.5 hover:text-blue ${current ? 'font-bold text-blue' : on ? 'font-semibold' : ''}`}>
                <span>{c.name}</span><span className="text-muted text-xs">{countOf(c.id)}</span>
              </Link>
              {on && render(c.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };
  return <>{render(null, 0)}</>;
}

function Pagination({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  const nums = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const list = [...nums].sort((a, b) => a - b);
  return (
    <nav aria-label="Pagination" className="flex justify-center items-center gap-2 flex-wrap">
      {page > 1 ? <Link href={href(page - 1)} className="btn btn-ghost btn-sm">Previous</Link> : <span className="btn btn-ghost btn-sm opacity-50" aria-disabled="true">Previous</span>}
      {list.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && p - list[i - 1] > 1 && <span aria-hidden>…</span>}
          {p === page
            ? <span className="btn btn-dark btn-sm" aria-current="page">{p}</span>
            : <Link href={href(p)} className="btn btn-ghost btn-sm" aria-label={`Page ${p}`}>{p}</Link>}
        </span>
      ))}
      {page < pages ? <Link href={href(page + 1)} className="btn btn-ghost btn-sm">Next</Link> : <span className="btn btn-ghost btn-sm opacity-50" aria-disabled="true">Next</span>}
    </nav>
  );
}

export function CatalogSkeleton() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6" aria-busy="true" aria-label="Loading products">
      <div className="h-4 w-48 bg-line rounded" />
      <div className="h-9 w-72 bg-line rounded mt-4" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="card h-[520px]" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card overflow-hidden"><div className="ph aspect-[4/3]" /><div className="h-28" /></div>)}
        </div>
      </div>
    </div>
  );
}
