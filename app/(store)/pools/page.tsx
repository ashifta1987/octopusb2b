import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { descendantIds, categoryPath } from '@/lib/content';
import { COUNTRY_NAMES } from '@/lib/format';
import { EmptyState, Notice } from '@/components/ui';
import { getStoreContent } from '@/components/store/currency';
import { listOpenPools, POOL_PAGE_SIZE, type PoolFilters } from '@/components/store/data';
import { FilterForm, SortSelect } from '@/components/store/filter-form';
import { JsonLd, SITE_URL } from '@/components/store/seo';
import { PoolGrid } from '@/components/store/pools/pool-card';
import { poolSettings } from '@/components/store/pools/shared';
import { PoolNotifyForm } from '@/components/store/pools/notify-form';
import { ServicePage } from '@/components/site/service-page';
import { h2Class } from '@/components/site/ui';
import { siteImage, shareImage } from '@/lib/site-images';

const TITLE = 'MOQ pools: factory minimum too big? Share it.';
const DESC = 'Join other buyers to fill one factory order. You pay for your share, your money stays in escrow, and you are refunded if the pool does not fill.';

export function generateMetadata(): Metadata {
  const og = shareImage('share-pools');
  return {
    title: TITLE,
    description: DESC,
    alternates: { canonical: '/pools' },
    openGraph: { title: TITLE, description: DESC, type: 'website', url: '/pools', images: [og] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: [og.url] },
  };
}

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
  return s ? `/pools?${s}#open-pools` : '/pools#open-pools';
}

/** MOQ pools — design page 04, with the live list of open pools (SPEC §18.4) after "How it works". */
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
      className={`inline-flex items-center min-h-11 px-4 rounded-full border-2 text-[14px] font-semibold ${on ? 'bg-ink text-white border-ink hover:text-white' : 'bg-white border-ink text-ink hover:bg-tint'}`}>
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
  const collectionLd = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'MOQ pools', url: `${SITE_URL}/pools`,
    description: DESC,
    mainEntity: {
      '@type': 'ItemList', numberOfItems: total,
      itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/pool/${p.code}`, name: `Group buy: ${p.product.title}` })),
    },
  };
  const active = !!(chosen.length || closes || fill || country || minp);

  const list = (
    <section id="open-pools" className="px-4 sm:px-6 py-[72px] scroll-mt-4" aria-labelledby="open-pools-h" data-testid="open-pools">
      <div className="max-w-[1200px] mx-auto">
        <h2 id="open-pools-h" className={h2Class}>Open pools</h2>
        {!rules.enabled && <div className="mt-4"><Notice tone="amber">Group buying is paused right now. Existing pools are shown for reference; new pledges are not accepted.</Notice></div>}
        {stats.open === 0 ? <NoPools /> : (
          <div className="grid gap-6 lg:grid-cols-[240px_1fr] mt-6 items-start">
            <aside className="space-y-4" aria-label="Filter pools">
              <FilterForm id="pool-filters" action="/pools" className="space-y-4">
                <input type="hidden" name="closes" value={closes} />
                <input type="hidden" name="fill" value={fill} />
                <input type="hidden" name="view" value={view === 'list' ? 'list' : ''} />
                <fieldset className="bg-white border border-line rounded-[18px] p-4">
                  <legend className="sr-only">Category</legend>
                  <div className="font-semibold text-[15px] text-ink mb-2" aria-hidden>Category</div>
                  <ul className="list-none m-0 p-0">
                    {top.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 text-[14px]">
                        <label className="inline-flex items-center gap-2 min-h-11 cursor-pointer">
                          <input type="checkbox" name="cat" value={c.slug} defaultChecked={catSlugs.includes(c.slug)} className="w-5 h-5 accent-coral" />
                          {c.name}
                        </label>
                        <span className="font-mono text-[12px] text-muted">{countOf(c.id)}</span>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <div className="bg-white border border-line rounded-[18px] p-4 space-y-4">
                  <div>
                    <div className="font-semibold text-[15px] text-ink mb-2" id="closes-h">Closes in</div>
                    <div className="flex flex-wrap gap-2" role="group" aria-labelledby="closes-h">
                      {[['', 'Any'], ['24h', '24 h'], ['3d', '3 d'], ['7d', '7 d']].map(([k, l]) => <Chip key={l} href={qs(sp, { closes: k || null, page: null })} on={closes === k}>{l}</Chip>)}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-[15px] text-ink mb-2" id="fill-h">Fill status</div>
                    <div className="flex flex-wrap gap-2" role="group" aria-labelledby="fill-h">
                      {[['', 'All'], ['almost', 'Almost full (>75%)'], ['boost', 'Needs boost (<30%)']].map(([k, l]) => <Chip key={l} href={qs(sp, { fill: k || null, page: null })} on={fill === k}>{l}</Chip>)}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="country" className="font-semibold text-[15px] text-ink block mb-2">Supplier country</label>
                    <select id="country" name="country" defaultValue={country} className="input min-h-12">
                      <option value="">Any country</option>
                      {facets.countries.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="minp" className="font-semibold text-[15px] text-ink block mb-2">Minimum pledge</label>
                    <select id="minp" name="minp" defaultValue={minp} className="input min-h-12">
                      <option value="">Any</option>
                      <option value="500">Under 500</option>
                      <option value="1000">Under 1,000</option>
                    </select>
                  </div>
                  <noscript><button type="submit" className="btn btn-dark btn-sm w-full">Apply filters</button></noscript>
                  {active && <Link href={view === 'list' ? '/pools?view=list#open-pools' : '/pools#open-pools'} className="inline-flex items-center min-h-11 text-[14px] font-semibold text-coral-text">Clear all filters</Link>}
                </div>
              </FilterForm>
              <div className="bg-tint rounded-[18px] p-4">
                <div className="font-semibold text-[15px] text-ink">Don&apos;t see your product?</div>
                <p className="text-[14px] text-muted mt-1 mb-0">Open a pool on any product and share the link with partners.</p>
                <Link href="/products?pool=1" className="btn btn-dark btn-sm w-full mt-3">Browse products</Link>
              </div>
            </aside>

            <div className="min-w-0">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h3 className="m-0 text-[18px] font-bold" aria-live="polite">{total} open {total === 1 ? 'pool' : 'pools'}{active && <span className="text-muted font-normal text-[14px]"> · filtered</span>}</h3>
                <div className="flex items-center gap-2">
                  <label htmlFor="sort" className="text-sm text-muted">Sort by</label>
                  <SortSelect key={sort} form="pool-filters" value={sort} options={SORTS} />
                  <div className="inline-flex rounded-[10px] border border-line-strong overflow-hidden" role="group" aria-label="Layout">
                    <Link href={qs(sp, { view: null })} scroll={false} aria-current={view === 'grid' ? 'true' : undefined} className={`inline-flex items-center min-h-11 px-3 text-[14px] font-semibold ${view === 'grid' ? 'bg-ink text-white hover:text-white' : 'bg-white text-ink'}`}>Grid</Link>
                    <Link href={qs(sp, { view: 'list' })} scroll={false} aria-current={view === 'list' ? 'true' : undefined} className={`inline-flex items-center min-h-11 px-3 text-[14px] font-semibold ${view === 'list' ? 'bg-ink text-white hover:text-white' : 'bg-white text-ink'}`}>List</Link>
                  </div>
                </div>
              </div>
              {items.length ? (
                <>
                  <PoolGrid pools={items} categoryNames={topName} view={view} />
                  {items.length < total && (
                    <div className="text-center mt-8">
                      <Link href={qs(sp, { page: String(page + 1) })} scroll={false} className="btn btn-ghost">Load more pools</Link>
                      <p className="text-[13px] text-muted mt-2">Showing {items.length} of {total} · {POOL_PAGE_SIZE} per page</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-white border border-line rounded-[18px]">
                  <EmptyState title={active ? 'No pools match these filters' : 'No open pools right now'}
                    body={active ? 'Try another category or clear the filters.' : 'Start the first pool on any product — other buyers can join from this page.'}
                    action={<Link href={active ? '/pools#open-pools' : '/products'} className="btn btn-primary btn-sm">{active ? 'Clear filters' : 'Browse products'}</Link>} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <>
      <JsonLd data={collectionLd} />
      <ServicePage testId="pools-page" afterHow={list} d={{
        key: 'pools', brand: 'pools',
        crumb: 'MOQ pools',
        title: 'Factory minimum too big? Share it.',
        lead: 'Join other buyers to fill one factory order. You pay for your share, your money stays in escrow, and you are refunded if the pool does not fill.',
        primary: { href: '#open-pools', label: 'See open pools' },
        note: 'Full refund if the pool does not fill.',
        hero: siteImage('pools-hero'),
        facts: [['Your risk', 'Refund if pool does not fill'], ['Payment', 'Held in escrow'], ['Quality', 'Same factory checks'], ['Best for', 'Orders below the factory minimum']],
        who: [
          ['Small buyers', 'The factory wants thousands of pieces and you only need a few hundred.'],
          ['Testing a product', 'You want to try a new item before committing to a large order.'],
          ['Several small shops', 'You and others want the same product and can split the cost.'],
        ],
        howSub: 'Pay for your share. Protected until the pool fills.',
        steps: [
          ['Find a pool', 'Browse open pools for products and see quantity, price and progress.'],
          ['Choose your quantity', 'Pick how many pieces you want. Your money is held in escrow.'],
          ['The pool fills', 'When the factory minimum is reached, production is confirmed.'],
          ['Production and shipping', 'The factory produces, we inspect and ship your share. If the pool never fills, you are refunded.'],
        ],
        learnTitle: 'Why factories have minimums, and how pools help',
        learnSub: 'Understanding the minimum helps you choose the right way to buy.',
        learn: [
          { src: '/images/design/19-moq-pools-education-image-1.webp', alt: 'A production line being set up with moulds and raw material.', caption: 'Setting up a production run costs about the same whether it makes 100 or 5,000 pieces.' },
          { ...siteImage('pools-pallet'), caption: 'In a pool, one production run is split between several buyers.' },
          { ...siteImage('pools-escrow'), caption: 'You can watch the pool fill before production starts.' },
        ],
        // live pool rules (site_settings pool_*), the same figures the pool pages use
        costs: {
          title: 'How the money works',
          sub: 'You only ever pay for your own share. Octopus holds the money in escrow until the order is placed.',
          rows: [
            ['Deposit when you join', `${rules.depositPct}% of your share`],
            ['Balance', `Due within ${rules.balanceHours} hours, only if the pool fills`],
            ['If the pool does not fill', 'Full refund'],
            ['Typical deadline', `${rules.defaultDays} days`],
            ['Buyers per pool', `Up to ${rules.maxBuyers}`],
            ['Card payments', 'Not accepted'],
          ],
          note: 'Paid from your US dollar wallet, topped up by bank transfer.',
          testId: 'pools-costs',
        },
        included: ['Escrow protection for your share', 'Full refund if the pool does not fill', 'Same factory quality checks', 'Shipping through our warehouse and logistics'],
        good: [
          ['What is escrow?', 'Octopus holds your money and releases it to the factory only after the production checks and shipping.'],
          // current site setting (pool_default_days, shown as "Typical deadline") fills [CONFIRM POOL TIME LIMIT]
          ['How long does a pool stay open?', `Typical deadline: ${rules.defaultDays} days.`],
          ['Can I mix products?', 'Each pool is for one product. Join several pools to buy several products.'],
        ],
        faq: [
          ['What if the pool does not fill?', 'Your funds are refunded in full.'],
          ['Is quality the same as a normal order?', 'Yes. The same factory checks and QC inspection apply.'],
          // current site copy fills [CONFIRM WHETHER BUYERS CAN START POOLS]
          ['Can I start a pool?', 'Yes. Open a pool on any product and share the link with partners.'],
          ['How much do I pay when I join?', `A ${rules.depositPct}% deposit now. You pay the rest only if the pool fills before the deadline. Octopus holds every deposit in escrow and ships each buyer separately.`],
        ],
        cta: 'Buy smaller. Pay less risk.',
      }} />
    </>
  );
}

/** ADDON-36 H3 — no pool is open at all: explain, offer to start one, capture an email. No filter chips. */
function NoPools() {
  return (
    <div className="bg-white border border-line rounded-[18px] p-6 sm:p-8 mt-6" data-testid="no-pools">
      <h3 id="no-pools-h" className="m-0 text-[22px] font-extrabold">No pools are open right now</h3>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/products?pool=1" className="btn btn-primary min-h-12">Start a pool on a product</Link>
      </div>
      <div className="mt-8 border-t border-line pt-6 max-w-[560px]">
        <h4 className="m-0 text-[16px] font-bold">Get notified when a pool opens</h4>
        <p className="text-[14px] text-muted mt-1 mb-3">One email when the next pool opens. No newsletter.</p>
        <PoolNotifyForm />
      </div>
    </div>
  );
}

function PoolsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pools" className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10">
      <div className="h-[420px] rounded-[18px] bg-tint" />
      <div className="mt-6 h-[120px] rounded-[18px] bg-white border border-line" />
    </div>
  );
}
