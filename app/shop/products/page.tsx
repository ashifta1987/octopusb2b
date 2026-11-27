import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { descendantIds } from '@/lib/content';
import { toCents } from '@/lib/format';
import { getStoreContent } from '@/components/store/currency';
import { listProducts, listOpenPools, getCategoryCounts, PAGE_SIZE, type ListFilters } from '@/components/store/data';
import { FilterForm, SortSelect } from '@/components/store/filter-form';
import { stockTotals } from '@/lib/category-stock';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { tkImageUrl } from '@/lib/turnkey/format';
import { getShopViewer } from '@/lib/shop/data';
import { shopCan } from '@/lib/shop/shared';
import { ShopCard, CardGrid } from '@/components/shop/shop-card';
import { RailSkeleton, TurnkeyCard } from '@/components/shop/rails';
import { EmptyState } from '@/components/ui';

export const metadata: Metadata = { title: 'Products', alternates: { canonical: '/products' } };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const num = (v: string) => { const n = Number(v); return v !== '' && Number.isFinite(n) && n >= 0 ? n : undefined; };
const SORTS: [string, string][] = [['best', 'Best match'], ['price_asc', 'Lowest price'], ['moq_asc', 'Lowest MOQ'], ['lead_asc', 'Fastest lead time'], ['newest', 'Newest']];
const KEYS = ['q', 'c', 'min', 'max', 'moq', 'lead', 'verified', 'custom', 'samples', 'pool', 'sort'];

/** CH-1 Shop products (Shop_Products.html / M_Shop_Products.html): filters price, MOQ, lead time, verified, customisable,
 *  samples, in MOQ pool; sort. Same public catalogue query as /products (listProducts), shown with shop cards. */
export default function ShopProducts({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<RailSkeleton title="products" n={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ categories }, counts, v] = await Promise.all([getStoreContent(), getCategoryCounts(), getShopViewer()]);
  const q = one(sp.q).trim().slice(0, 100);
  const cat = categories.find((c) => c.slug === one(sp.c)) ?? null;
  const min = num(one(sp.min)), max = num(one(sp.max)), moq = num(one(sp.moq)), lead = num(one(sp.lead));
  const sort = SORTS.some(([k]) => k === one(sp.sort)) ? one(sp.sort) : 'best';
  const page = Math.max(1, Math.floor(num(one(sp.page)) ?? 1));
  const tagSlugs = [one(sp.custom) === '1' ? 'customisable' : '', one(sp.samples) === '1' ? 'samples' : ''].filter(Boolean);
  const f: ListFilters = {
    q: q || undefined, categoryIds: cat ? descendantIds(categories, cat.id) : undefined,
    minCents: min != null ? toCents(min) : undefined, maxCents: max != null ? toCents(max) : undefined, moqMax: moq, leadMax: lead,
    verified: one(sp.verified) === '1', inPool: one(sp.pool) === '1', tagSlugs: tagSlugs.length ? tagSlugs : undefined, sort, page,
  };
  const [{ items, total }, pools, turnkey] = await Promise.all([
    listProducts(f),
    q ? listOpenPools({ limit: 50 }) : Promise.resolve(null),
    q ? getTurnkeyCatalogue() : Promise.resolve(null),
  ]);
  const ql = q.toLowerCase();
  const poolHits = (pools?.items ?? []).filter((p) => p.product.title.toLowerCase().includes(ql)).slice(0, 3);
  const tkHits = (turnkey?.projects ?? []).filter((p) => `${p.title} ${p.category ?? ''}`.toLowerCase().includes(ql)).slice(0, 3);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const totals = stockTotals(categories, counts);
  const chips = categories.filter((c) => c.level === 1 && (totals.get(c.id) ?? 0) > 0).sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0));
  const qs = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams();
    KEYS.forEach((k) => { const x = one(sp[k]); if (x) u.set(k, x); });
    Object.entries(patch).forEach(([k, x]) => { u.delete(k); if (x) u.set(k, x); });
    const s = u.toString();
    return `/shop/products${s ? `?${s}` : ''}`;
  };
  const active = !!(q || cat || min != null || max != null || moq != null || lead != null || f.verified || f.inPool || tagSlugs.length);
  const canAct = shopCan(v.role);
  const box = 'flex items-center gap-2 min-h-11 text-[15px]';
  const sortLabel = SORTS.find(([k]) => k === sort)?.[1] ?? 'Best match';

  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6">
      <nav aria-label="Breadcrumb" className="text-[14px] text-muted mb-2">
        <ol className="flex flex-wrap gap-x-1.5 list-none m-0 p-0">
          <li><Link href="/shop" className="underline text-ink">Shop</Link> <span aria-hidden>›</span></li>
          <li><Link href="/shop/products" className="underline text-ink">Products</Link>{cat && <> <span aria-hidden>›</span></>}</li>
          {cat && <li aria-current="page">{cat.name}</li>}
        </ol>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] sm:text-[34px] font-bold leading-tight">{q ? `Results for “${q}”` : cat?.name ?? 'Find products'}</h1>
          <p className="m-0 mt-1 text-[15px] text-black max-w-[680px]">Browse products from verified suppliers, compare prices by quantity and request a quote. Can&rsquo;t find it? Ask us to source it.</p>
        </div>
        <Link href="/request/sourcing" className="btn btn-ghost">Request a product we don&rsquo;t list</Link>
      </div>

      <div id="categories" className="mt-5 overflow-x-auto scroll-mt-28" tabIndex={0} role="region" aria-label="Categories (scrolls sideways)">
        <ul className="flex gap-2 list-none m-0 p-0 pb-1 whitespace-nowrap">
          <li><Link href={qs({ c: null, page: null })} aria-current={!cat ? 'page' : undefined} className={`inline-flex items-center min-h-11 px-4 rounded-full border font-semibold underline underline-offset-4 ${!cat ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line-strong'}`}>All</Link></li>
          {chips.map((c) => (
            <li key={c.id}><Link href={qs({ c: c.slug, page: null })} aria-current={cat?.id === c.id ? 'page' : undefined} className={`inline-flex items-center min-h-11 px-4 rounded-full border font-semibold underline underline-offset-4 ${cat?.id === c.id ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line-strong'}`}>{c.name}</Link></li>
          ))}
        </ul>
      </div>

      {(poolHits.length > 0 || tkHits.length > 0) && (
        <section className="mt-6" aria-labelledby="also-h" data-testid="search-also">
          <h2 id="also-h" className="text-[20px] font-bold m-0 mb-3">Also matching “{q}”</h2>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none m-0 p-0">
            {poolHits.map((p) => (
              <li key={p.id} className="card p-4">
                <span className="pill bg-tint text-ink">MOQ pool</span>
                <h3 className="m-0 mt-2 text-[15px] font-semibold"><Link href={`/pool/${p.code}`} className="text-ink underline underline-offset-4">{p.product.title}</Link></h3>
              </li>
            ))}
            {tkHits.map((p) => <li key={p.project_id}><TurnkeyCard p={p} image={tkImageUrl(p.hero_image_path, process.env.NEXT_PUBLIC_SUPABASE_URL)} /></li>)}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr] items-start">
        <details className="card p-4 lg:open:block group" open data-testid="shop-filters">
          <summary className="cursor-pointer list-none font-bold text-[16px] min-h-11 flex items-center justify-between [&::-webkit-details-marker]:hidden">Filters<span className="lg:hidden text-[13px] font-normal text-muted underline">Show or hide</span></summary>
          <FilterForm id="shop-filter" action="/shop/products" className="mt-2 flex flex-col gap-4">
            {q && <input type="hidden" name="q" value={q} />}
            {cat && <input type="hidden" name="c" value={cat.slug} />}
            <fieldset className="border-0 p-0 m-0">
              <legend className="label">Price per unit (USD)</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[13px] text-muted">From<input name="min" inputMode="decimal" defaultValue={one(sp.min)} className="input mt-1" /></label>
                <label className="text-[13px] text-muted">To<input name="max" inputMode="decimal" defaultValue={one(sp.max)} className="input mt-1" /></label>
              </div>
            </fieldset>
            <label className="block"><span className="label">MOQ up to</span>
              <select name="moq" defaultValue={one(sp.moq)} className="input">
                <option value="">Any MOQ</option>{[50, 100, 300, 500, 1000, 5000].map((n) => <option key={n} value={n}>{n.toLocaleString('en-US')}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Lead time up to</span>
              <select name="lead" defaultValue={one(sp.lead)} className="input">
                <option value="">Any lead time</option>{[7, 15, 20, 30, 45].map((n) => <option key={n} value={n}>{n} days</option>)}
              </select>
            </label>
            <fieldset className="border-0 p-0 m-0 flex flex-col">
              <legend className="label">Show only</legend>
              <label className={box}><input type="checkbox" name="verified" value="1" defaultChecked={f.verified} className="w-5 h-5" /> Verified supplier</label>
              <label className={box}><input type="checkbox" name="custom" value="1" defaultChecked={tagSlugs.includes('customisable')} className="w-5 h-5" /> Customisable</label>
              <label className={box}><input type="checkbox" name="samples" value="1" defaultChecked={tagSlugs.includes('samples')} className="w-5 h-5" /> Samples available</label>
              <label className={box}><input type="checkbox" name="pool" value="1" defaultChecked={f.inPool} className="w-5 h-5" /> In an MOQ pool</label>
            </fieldset>
            <button type="submit" className="btn btn-primary">Apply filters</button>
            {active && <Link href="/shop/products" className="text-center text-[14px] font-semibold text-coral-text underline min-h-11 inline-flex items-center justify-center">Clear all filters</Link>}
          </FilterForm>
        </details>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="m-0 text-[15px]" role="status" data-testid="result-count"><b>{total.toLocaleString('en-US')}</b> {total === 1 ? 'product' : 'products'}{cat ? ` in ${cat.name}` : ''} · Sorted by {sortLabel.toLowerCase()}</p>
            <label className="flex items-center gap-2 text-[14px]"><span>Sort by</span><SortSelect form="shop-filter" value={sort} options={SORTS} /></label>
          </div>
          {items.length === 0 ? (
            <div className="card"><EmptyState title="No products match these filters" body="Remove a filter, or send us a request and we source it for you."
              action={<><Link href="/shop/products" className="btn btn-ghost">Clear filters</Link><Link href="/request/sourcing" className="btn btn-primary">Request a product</Link></>} /></div>
          ) : (
            <CardGrid testId="products-grid">{items.map((p) => <li key={p.id} className="min-w-0 flex"><ShopCard p={p} canAct={canAct} tags /></li>)}</CardGrid>
          )}
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {page > 1 && <Link href={qs({ page: String(page - 1) })} className="btn btn-ghost btn-sm" rel="prev">Previous</Link>}
              <span className="text-[14px] text-muted px-2">Page {page} of {pages}</span>
              {page < pages && <Link href={qs({ page: String(page + 1) })} className="btn btn-ghost btn-sm" rel="next">Next</Link>}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
