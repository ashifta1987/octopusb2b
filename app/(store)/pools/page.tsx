import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { descendantIds, categoryPath } from '@/lib/content';
import { COUNTRY_NAMES } from '@/lib/format';
import { EmptyState, Notice } from '@/components/ui';
import { getStoreContent } from '@/components/store/currency';
import { listOpenPools, POOL_PAGE_SIZE, type PoolFilters } from '@/components/store/data';
import { FilterForm, SortSelect } from '@/components/store/filter-form';
import { JsonLd, Breadcrumbs, breadcrumbLd, SITE_URL } from '@/components/store/seo';
import { PoolGrid, HowPoolsWork } from '@/components/store/pools/pool-card';
import { poolSettings } from '@/components/store/pools/shared';
import { PoolNotifyForm } from '@/components/store/pools/notify-form';

export const metadata: Metadata = {
  title: 'Group buying pools — share the MOQ',
  description: 'Join an open group-buying pool on Octopus B2B: pledge fewer pieces at the factory tier price, pay a small deposit held in escrow, and pay the rest only if the pool fills.',
  alternates: { canonical: '/pools' },
  openGraph: { title: 'Group buying pools — share the MOQ', type: 'website', url: '/pools' },
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const KEYS = ['cat', 'closes', 'fill', 'country', 'minp', 'sort', 'view'];
const SORTS: [string, string][] = [['closing', 'Closing soonest'], ['saving', 'Highest saving'], ['filled', 'Most filled'], ['newest', 'Newest'], ['buyers', 'Buyers joined']];

function qs(sp: SP, patch: Record<string, string | null>) {
  const u = new URLSearchParams();
  for (const k of KEYS) many(sp[k]).forEach((v) => v && u.append(k, v));
  for (const [k, v] of Object.entries(patch)) { u.delete(k); if (v) u.set(k, v); }
  const s = u.toString();
  return s ? `/pools?${s}` : '/pools';
}

/** Pools.png — all open group-buying pools (SPEC §18.4). */
export default function PoolsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<PoolsSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-current={on ? 'true' : undefined}
      className={`inline-flex items-center px-3 py-1.5 rounded-full border text-[13px] font-medium ${on ? 'bg-navy text-white border-navy' : 'bg-white border-line-2 text-[#3B4556] hover:border-navy'}`}>
      {children}
    </Link>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { categories, settings } = await getStoreContent();
  const rules = poolSettings(settings);
  const top = categories.filter((c) => c.level === 1);
  const catSlugs = many(sp.cat);
  const chosen = top.filter((c) => catSlugs.includes(c.slug));
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  const sort = SORTS.some(([k]) => k === one(sp.sort)) ? one(sp.sort) : 'closing';
  const view = one(sp.view) === 'list' ? 'list' : 'grid';
  const closes = ['24h', '3d', '7d'].includes(one(sp.closes)) ? one(sp.closes) : '';
  const fill = ['almost', 'boost'].includes(one(sp.fill)) ? one(sp.fill) : '';
  const country = /^[A-Z]{2}$/.test(one(sp.country)) ? one(sp.country) : '';
  const minp = ['500', '1000'].includes(one(sp.minp)) ? one(sp.minp) : '';
  const filters: PoolFilters = {
    categoryIds: chosen.length ? chosen.flatMap((c) => descendantIds(categories, c.id)) : undefined,
    closes: closes || undefined, fill: fill || undefined, country: country || undefined, minPledge: minp ? Number(minp) : undefined, sort, page,
  };
  const { items, total, facets, stats } = await listOpenPools(filters);
  const topName = Object.fromEntries(categories.map((c) => [c.id, categoryPath(categories, c.id)[0]?.name ?? c.name]));
  const countOf = (id: string) => descendantIds(categories, id).reduce((s, x) => s + (facets.categoryCounts[x] ?? 0), 0);
  const crumbs = [{ name: 'Home', href: '/' }, { name: 'Group buying pools', href: '/pools' }];
  const collectionLd = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Group buying pools', url: `${SITE_URL}/pools`,
    description: metadata.description,
    mainEntity: {
      '@type': 'ItemList', numberOfItems: total,
      itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/pool/${p.code}`, name: `Group buy: ${p.product.title}` })),
    },
  };
  const active = !!(chosen.length || closes || fill || country || minp);

  return (
    <>
      <JsonLd data={collectionLd} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      {/* Hero */}
      <section className="bg-[linear-gradient(135deg,#11133C_0%,#262A6B_100%)] text-white">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 sm:py-16 flex flex-wrap gap-10 items-center justify-between">
          <div className="flex-[1_1_520px] min-w-0 max-w-[680px]">
            <span className="inline-flex rounded-full bg-blue-fill text-white text-[11px] font-semibold px-2.5 py-1 uppercase tracking-wide">Group buying · {stats.open} open {stats.open === 1 ? 'pool' : 'pools'}</span>
            <h1 className="!text-white text-[34px] sm:text-[46px] font-extrabold leading-[1.1] mt-4">Share the MOQ. Pay only when the pool fills.</h1>
            <p className="text-[16px] text-[#C9D0DC] leading-relaxed mt-4">
              Buy fewer pieces at the factory tier price by pooling with other buyers. Pay a {rules.depositPct}% deposit now, pay the rest only if the pool fills
              before the deadline. Octopus holds every deposit in escrow and ships each buyer separately.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link href="/products?pool=1" className="btn btn-primary">Start a pool on any product</Link>
              <a href="#how" className="btn bg-transparent border border-white/40 !text-white hover:border-white">How it works</a>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 flex-[0_1_480px]">
            {([[`${rules.depositPct}%`, 'Deposit now'], [String(rules.maxBuyers), 'Buyers max per pool'], [`${rules.defaultDays}d`, 'Typical deadline'], [stats.maxSaving ? `up to ${stats.maxSaving}%` : '—', 'Saving if filled']] as const).map(([v, l]) => (
              <div key={l} className="rounded-[12px] bg-white/10 border border-white/10 px-4 py-4 flex flex-col-reverse gap-1">
                <dt className="text-[12px] text-[#C9D0DC]">{l}</dt>
                <dd className="font-display font-bold text-[22px] sm:text-[26px] leading-none">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8">
        <Breadcrumbs items={crumbs} />
        {!rules.enabled && <div className="mt-4"><Notice tone="amber">Group buying is paused right now. Existing pools are shown for reference; new pledges are not accepted.</Notice></div>}
        {stats.open === 0 ? <NoPools /> : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr] mt-5 items-start">
          {/* Filters */}
          <aside className="space-y-4" aria-label="Filter pools">
            <FilterForm id="pool-filters" action="/pools" className="space-y-4">
              <input type="hidden" name="closes" value={closes} />
              <input type="hidden" name="fill" value={fill} />
              <input type="hidden" name="view" value={view === 'list' ? 'list' : ''} />
              <fieldset className="card p-4">
                <legend className="sr-only">Category</legend>
                <div className="font-semibold text-[14px] mb-3" aria-hidden>Category</div>
                <ul className="space-y-2">
                  {top.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" name="cat" value={c.slug} defaultChecked={catSlugs.includes(c.slug)} className="w-4 h-4 accent-[#2A6FD6]" />
                        {c.name}
                      </label>
                      <span className="mono text-[11px] text-muted">{countOf(c.id)}</span>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <div className="card p-4 space-y-4">
                <div>
                  <div className="font-semibold text-[14px] mb-2" id="closes-h">Closes in</div>
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby="closes-h">
                    {[['', 'Any'], ['24h', '24 h'], ['3d', '3 d'], ['7d', '7 d']].map(([k, l]) => <Chip key={l} href={qs(sp, { closes: k || null, page: null })} on={closes === k}>{l}</Chip>)}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-[14px] mb-2" id="fill-h">Fill status</div>
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby="fill-h">
                    {[['', 'All'], ['almost', 'Almost full (>75%)'], ['boost', 'Needs boost (<30%)']].map(([k, l]) => <Chip key={l} href={qs(sp, { fill: k || null, page: null })} on={fill === k}>{l}</Chip>)}
                  </div>
                </div>
                <div>
                  <label htmlFor="country" className="font-semibold text-[14px] block mb-2">Supplier country</label>
                  <select id="country" name="country" defaultValue={country} className="input">
                    <option value="">Any country</option>
                    {facets.countries.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="minp" className="font-semibold text-[14px] block mb-2">Minimum pledge</label>
                  <select id="minp" name="minp" defaultValue={minp} className="input">
                    <option value="">Any</option>
                    <option value="500">Under 500</option>
                    <option value="1000">Under 1,000</option>
                  </select>
                </div>
                <noscript><button type="submit" className="btn btn-dark btn-sm w-full">Apply filters</button></noscript>
                {active && <Link href={view === 'list' ? '/pools?view=list' : '/pools'} className="text-[13px] font-semibold text-blue">Clear all filters</Link>}
              </div>
            </FilterForm>
            <div className="card p-4 bg-blue-soft/40 border-blue/30">
              <div className="font-semibold text-[14px]">Don&apos;t see your product?</div>
              <p className="text-[13px] text-muted mt-1">Open a pool on any product and share the link with partners.</p>
              <Link href="/products?pool=1" className="btn btn-dark btn-sm w-full mt-3">Browse products</Link>
            </div>
          </aside>

          {/* Results */}
          <div className="min-w-0">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <h2 className="text-[18px] font-bold" aria-live="polite">{total} open {total === 1 ? 'pool' : 'pools'}{active && <span className="text-muted font-normal text-[14px]"> · filtered</span>}</h2>
              <div className="flex items-center gap-2">
                <label htmlFor="sort" className="text-sm text-muted">Sort by</label>
                <SortSelect key={sort} form="pool-filters" value={sort} options={SORTS} />
                <div className="inline-flex rounded-[8px] border border-line-2 overflow-hidden" role="group" aria-label="Layout">
                  <Link href={qs(sp, { view: null })} scroll={false} aria-current={view === 'grid' ? 'true' : undefined} className={`px-3 py-2 text-[13px] font-semibold ${view === 'grid' ? 'bg-navy text-white' : 'bg-white'}`}>Grid</Link>
                  <Link href={qs(sp, { view: 'list' })} scroll={false} aria-current={view === 'list' ? 'true' : undefined} className={`px-3 py-2 text-[13px] font-semibold ${view === 'list' ? 'bg-navy text-white' : 'bg-white'}`}>List</Link>
                </div>
              </div>
            </div>
            {items.length ? (
              <>
                <PoolGrid pools={items} categoryNames={topName} view={view} />
                {items.length < total && (
                  <div className="text-center mt-8">
                    <Link href={qs(sp, { page: String(page + 1) })} scroll={false} className="btn btn-ghost">Load more pools</Link>
                    <p className="text-[12px] text-muted mt-2">Showing {items.length} of {total} · {POOL_PAGE_SIZE} per page</p>
                  </div>
                )}
              </>
            ) : (
              <div className="card">
                <EmptyState title={active ? 'No pools match these filters' : 'No open pools right now'}
                  body={active ? 'Try another category or clear the filters.' : 'Start the first pool on any product — other buyers can join from this page.'}
                  action={<Link href={active ? '/pools' : '/products'} className="btn btn-primary btn-sm">{active ? 'Clear filters' : 'Browse products'}</Link>} />
              </div>
            )}
          </div>
        </div>
        )}
        <div className="mt-12">
          <HowPoolsWork depositPct={rules.depositPct} minPledge={rules.minPledgeDefault} balanceHours={rules.balanceHours} />
        </div>
      </div>
    </>
  );
}

/** ADDON-36 H3 — no pool is open at all: explain, offer to start one, capture an email. No filter chips. */
function NoPools() {
  const steps: [string, string][] = [
    ['Pick a product', 'Choose any listed product and set how many pieces you want.'],
    ['Others join', 'Share the link. Buyers pledge pieces until the pool reaches the factory MOQ.'],
    ['Pool fills, we ship', 'Pay the balance only when the pool fills. Each buyer gets their own shipment.'],
  ];
  return (
    <section className="card p-6 sm:p-8 mt-5" data-testid="no-pools" aria-labelledby="no-pools-h">
      <h2 id="no-pools-h" className="text-[22px] font-extrabold">No pools are open right now</h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-3">
        {steps.map(([t, b], i) => (
          <li key={t} className="flex gap-3">
            <span className="mono shrink-0 w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center text-[13px] font-bold">{i + 1}</span>
            <div><div className="font-bold">{t}</div><p className="text-[14px] text-muted">{b}</p></div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/products?pool=1" className="btn btn-primary min-h-11">Start a pool on a product</Link>
      </div>
      <div className="mt-8 border-t border-line pt-6 max-w-[560px]">
        <h3 className="text-[16px] font-bold">Get notified when a pool opens</h3>
        <p className="text-[14px] text-muted mt-1 mb-3">One email when the next pool opens. No newsletter.</p>
        <PoolNotifyForm />
      </div>
    </section>
  );
}

function PoolsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pools">
      <div className="h-[340px] bg-navy" />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8 grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="card h-[420px]" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-[330px]" />)}</div>
      </div>
    </div>
  );
}
