import { Users } from 'lucide-react';
import { Breadcrumbs, Button, EmptyState, ErrorState, formatNumber } from '@octopus/ui';
import type { PoolCardModel } from '../../_lib/cards';
import { ShopCard } from '../../_components/shop-card';
import { POOL_FILTERS, type PoolFilter, type PoolSort } from '../_lib/pool-logic';
import { PoolSortSelect, PoolStatusPills } from './pool-filters';

export type PoolsListViewProps = {
  /** 1 on the real page (default); 2 inside a fixtures page. */
  titleLevel?: 1 | 2;
  status: PoolFilter;
  sort: PoolSort;
  category?: string | null;
  /** Count per pill; null = that list couldn't be loaded. */
  counts: Record<PoolFilter, number | null>;
  /** Cards for the chosen pill (already sorted). */
  items: PoolCardModel[];
  /** The chosen list failed to load: only the grid shows the error, the pills and header stay. */
  error?: boolean;
  /** Retry link (the same URL). */
  retryHref?: string;
};

const SECTION_TITLE: Record<PoolFilter, string> = {
  open: 'Open pools',
  'closing-soon': 'Closing soon',
  'almost-full': 'Almost full',
  filled: 'Filled pools',
  mine: 'My pools',
};

const EMPTY: Record<PoolFilter, { title: string; description: string }> = {
  open: { title: 'No open pools right now', description: 'Start one from any product page: other buyers join and you pay only for your share.' },
  'closing-soon': { title: 'No pools close in the next 3 days', description: 'See every open pool instead.' },
  'almost-full': { title: 'No pools are almost full', description: 'Pools at 75% of their target or more show here.' },
  filled: { title: 'No filled pools yet', description: 'Pools that reach their target show here.' },
  mine: { title: 'You haven’t joined a pool yet', description: 'Join an open pool to buy at the bulk price with other buyers.' },
};

/** Heading levels: 1 on the real page; 2 inside a fixtures page (whose own H1 names the fixture). */
function levels(titleLevel: 1 | 2 = 1) {
  return { T: (titleLevel === 2 ? 'h2' : 'h1') as 'h1' | 'h2', S: (titleLevel === 2 ? 'h3' : 'h2') as 'h2' | 'h3', card: (titleLevel === 2 ? 4 : 3) as 3 | 4 };
}

/**
 * ODS T4 · /shop/pools (Part 5.5, Shop_Pools): FilterPills Open · Closing soon · Almost full · Filled · My pools (?status=),
 * sort (?sort=), PoolCards. Presentational: props only. The grid alone shows loading / empty / error.
 */
export function PoolsListView({ status, sort, category, counts, items, error, retryHref, titleLevel }: PoolsListViewProps) {
  const { T, S, card } = levels(titleLevel);
  const label = POOL_FILTERS.find((f) => f.id === status)?.label ?? 'Open';
  const resultText = error ? 'This list couldn’t be loaded.' : `${formatNumber(items.length)} ${items.length === 1 ? 'pool' : 'pools'} · ${label}`;
  const empty = EMPTY[status];
  return (
    <div className="flex flex-col gap-6" data-testid="pools-list">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'MOQ pools' }]} />
      <header className="flex flex-col gap-2">
        <T className="m-0 text-ods-h1 text-ods-navy">MOQ pools: buy together</T>
        <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">
          Join other buyers to reach the factory minimum and pay the bulk price. If a pool doesn&apos;t fill, your deposit goes back to your wallet.
        </p>
      </header>
      <PoolStatusPills status={status} sort={sort} category={category} counts={counts} resultText={resultText} />
      <section aria-labelledby="pools-section" className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
        <div className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-end ods-tablet:justify-between">
          <S id="pools-section" className="m-0 text-ods-h2 text-ods-navy">
            {SECTION_TITLE[status]}
          </S>
          {status !== 'filled' && status !== 'mine' ? <PoolSortSelect status={status} sort={sort} category={category} /> : null}
        </div>
        {error ? (
          <ErrorState title={`We couldn’t load ${SECTION_TITLE[status].toLowerCase()}.`} action={retryHref ? <Button variant="secondary" href={retryHref}>Try again</Button> : undefined} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={empty.title}
            description={empty.description}
            action={
              status === 'open' || status === 'mine' ? (
                <Button variant="secondary" href={status === 'open' ? '/shop/products' : '/shop/pools'}>
                  {status === 'open' ? 'Browse products' : 'See open pools'}
                </Button>
              ) : (
                <Button variant="secondary" href="/shop/pools">
                  See open pools
                </Button>
              )
            }
          />
        ) : (
          <ul role="list" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3" data-testid="pools-grid">
            {items.map((m) => (
              <li key={m.id} className="min-w-0">
                <ShopCard model={m} showService={false} headingLevel={card} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Loading shape of the list (Suspense fallback). */
export function PoolsListSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-8 w-72 max-w-full animate-pulse rounded-ods-control bg-ods-line" />
      <div className="h-10 w-full max-w-[560px] animate-pulse rounded-ods-pill bg-ods-line" />
      <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[360px] animate-pulse rounded-ods-card bg-ods-line" />
        ))}
      </div>
      <p className="sr-only" role="status">
        Loading pools
      </p>
    </div>
  );
}
