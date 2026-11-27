'use client';

import { Search, Send } from 'lucide-react';
import { Breadcrumbs, Button, Card, EmptyState, Icon, ProductCardSkeleton, ServiceSection, Skeleton } from '@octopus/ui';
import { ShopCard } from '../../_components/shop-card';
import { SHOP_SECTIONS, type ShopSectionKey } from '../../_lib/sections';
import type { SearchResult } from '../_lib/types';
import { SearchTypePills } from './type-pills';

export type SearchViewProps = {
  q: string;
  type: ShopSectionKey | null;
  status: 'ready' | 'loading';
  result?: SearchResult | null;
  /** Fixtures: cards don't call the server. */
  demo?: boolean;
  basePath?: string;
};

const SEE_ALL_Q: Record<ShopSectionKey, boolean> = { sourcing: true, pools: true, dropship: true, '3pl': false, turnkey: true, brand: false };
const seeAll = (k: ShopSectionKey, q: string) => {
  const path = k === 'sourcing' ? '/shop/products' : SHOP_SECTIONS[k].seeAllPath;
  return SEE_ALL_Q[k] && q ? `${path}?q=${encodeURIComponent(q)}` : path;
};

/**
 * /shop/search?q=&type= (Part 5.7): results grouped into the six Shop sections (fixed order), pill type filters with
 * counts (?type=), each group with "See all …". Sections load and fail on their own. Empty: States-Shop "No results".
 */
export function SearchView({ q, type, status, result, demo, basePath = '/shop/search' }: SearchViewProps) {
  const groups = result?.groups ?? [];
  const counts = Object.fromEntries(groups.map((g) => [g.key, g.total])) as Partial<Record<ShopSectionKey, number>>;
  const total = groups.reduce((s, g) => s + g.total, 0);
  const visible = type ? groups.filter((g) => g.key === type) : groups.filter((g) => g.total > 0 || g.error);
  const none = type ? [] : groups.filter((g) => g.total === 0 && !g.error);
  const nothing = status === 'ready' && !!q && groups.length > 0 && total === 0 && groups.every((g) => !g.error);

  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-5 px-ods-pad-page py-6" data-testid="search-page">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Search' }]} />
      <h1 className="m-0 text-ods-h1 text-ods-navy">{q ? `Results for “${q}”` : 'Search the shop'}</h1>

      <form method="get" action={basePath} role="search" aria-label="Search the shop" className="flex flex-wrap gap-2">
        <label htmlFor="shop-search-q" className="sr-only">
          Search products, MOQ pools, projects and services
        </label>
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ods-slate">
            <Icon icon={Search} />
          </span>
          <input
            id="shop-search-q"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
            placeholder="Search products, MOQ pools, projects and services"
            className="h-ods-control w-full rounded-ods-control border border-ods-line-strong bg-ods-surface ps-10 pe-3 text-ods-body text-ods-text placeholder:text-ods-slate hover:border-ods-navy"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {status === 'loading' ? (
        <div className="flex flex-col gap-5" aria-busy="true" data-testid="search-results">
          <Skeleton label="Searching" className="h-ods-control w-full max-w-xl rounded-ods-pill" />
          {[0, 1].map((i) => (
            <div key={i} className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-4">
              {[0, 1, 2, 3].map((j) => (
                <ProductCardSkeleton key={j} silent />
              ))}
            </div>
          ))}
        </div>
      ) : !q ? (
        <Card>
          <EmptyState icon={Search} title="What are you looking for?" description="Type at least 2 letters: a product, a material, a pool or a service." headingLevel={2} />
        </Card>
      ) : nothing ? (
        <Card data-testid="search-results">
          <EmptyState
            icon={Search}
            title={`Nothing matches “${q}”`}
            description="Try fewer words, or let our sourcing team find it for you."
            headingLevel={2}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button href="/request/sourcing" iconStart={Send}>
                  Request this product
                </Button>
                <Button variant="secondary" href={basePath}>
                  Clear search
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <SearchTypePills q={q} type={type} counts={counts} total={total} basePath={basePath} />
          <div className="flex flex-col gap-6" data-testid="search-results">
            {visible.map((g) => {
              const meta = SHOP_SECTIONS[g.key];
              return (
                <div key={g.key} data-group={g.key} data-testid={`search-group-${g.key}`}>
                  <ServiceSection
                    service={g.key}
                    id={`search-${g.key}`}
                    title={meta.title}
                    count={g.total}
                    countLabel={meta.countLabel(g.total)}
                    explainer={meta.explainer}
                    seeAllHref={seeAll(g.key, q)}
                    seeAllLabel={meta.seeAllLabel}
                    note={g.note}
                    headingLevel={2}
                    error={g.error ? `We couldn’t search ${meta.title}.` : undefined}
                    empty={!g.error && g.items.length === 0}
                    emptyTitle={`No ${meta.title} match “${q}”`}
                    emptyDescription="Try another word, or see everything in this section."
                  >
                    {g.items.map((m) => (
                      <ShopCard key={m.id} model={m} canAct={result?.canAct ?? true} demo={demo} />
                    ))}
                  </ServiceSection>
                </div>
              );
            })}
            {none.length ? (
              <p className="m-0 text-ods-small text-ods-slate" data-testid="search-no-match">
                No matches in {none.map((g) => SHOP_SECTIONS[g.key].title).join(', ')}.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
