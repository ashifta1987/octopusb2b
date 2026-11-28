'use client';

import Link from 'next/link';
import { Check, PackageSearch, Send, X } from 'lucide-react';
import { Breadcrumbs, Button, Card, EmptyState, ErrorState, Icon, ProductCardSkeleton, cx } from '@octopus/ui';
import { activeFilterCount, productsHref, PRODUCT_SORTS, type ProductFilterState } from '../_lib/filters';
import { ShopCard } from '../../_components/shop-card';
import type { CategoryOption, ProductListVM, ShopActor } from '../_lib/types';
import { FiltersForm } from './filters-form';
import { FiltersSheetButton, SortSelect } from './list-controls';

export type ProductsViewProps = {
  state: ProductFilterState;
  /** Category select options (level 1 + 2, with counts). */
  categories: CategoryOption[];
  /** Top-level category pills. */
  chips: CategoryOption[];
  status: 'ready' | 'loading' | 'error';
  list?: ProductListVM | null;
  currency: string;
  actor: ShopActor;
  /** Fixtures: cards don't call the server (ShopCard demo). */
  demo?: boolean;
  /** Where filter links point (fixtures pass their own path). */
  basePath?: string;
};

const REQUEST_HREF = '/request/sourcing';

/**
 * /shop/products (Part 5.3, Match Shop_Products / M_Shop_Products). Presentational: everything comes from props.
 * Desktop (≥ 1200): 256 px filters column + 3 cards per row. Tablet: 2 per row. Phones: 1 per row, "Filters (n)" opens
 * a full-screen Sheet. Result count is a polite live region. All filters, sort and page are in the URL.
 */
export function ProductsView({ state, categories, chips, status, list, currency, actor, demo, basePath = '/shop/products' }: ProductsViewProps) {
  const all = [...categories, ...chips];
  const cat = state.category ? all.find((c) => c.slug === state.category) ?? null : null;
  const catName = cat?.name ?? (state.category ? 'this category' : null);
  const active = activeFilterCount(state);
  const sortLabel = PRODUCT_SORTS.find(([k]) => k === state.sort)?.[1] ?? 'Best match';
  const href = (patch: Partial<ProductFilterState>) => productsHref(state, patch, basePath);
  const clearAll = href({ category: null, min: null, max: null, moq: null, lead: null, verified: false, samples: false, custom: false, pool: false });
  const title = state.q ? `Results for “${state.q}”` : (cat?.name ?? 'Find products');

  const chipsActive: { label: string; patch: Partial<ProductFilterState> }[] = [
    ...(state.category ? [{ label: catName ?? 'Category', patch: { category: null } }] : []),
    ...(state.min != null ? [{ label: `From ${currency} ${state.min}`, patch: { min: null } }] : []),
    ...(state.max != null ? [{ label: `Up to ${currency} ${state.max}`, patch: { max: null } }] : []),
    ...(state.moq != null ? [{ label: `Minimum order up to ${state.moq.toLocaleString('en-US')}`, patch: { moq: null } }] : []),
    ...(state.lead != null ? [{ label: `Delivery within ${state.lead} days`, patch: { lead: null } }] : []),
    ...(state.verified ? [{ label: 'Verified supplier', patch: { verified: false } }] : []),
    ...(state.custom ? [{ label: 'Customisable', patch: { custom: false } }] : []),
    ...(state.pool ? [{ label: 'Also in an MOQ pool', patch: { pool: false } }] : []),
  ];

  let countText = 'Loading products…';
  if (status === 'error') countText = 'Products couldn’t be loaded.';
  if (status === 'ready' && list) {
    countText = `${list.total.toLocaleString('en-US')} ${list.total === 1 ? 'product' : 'products'}${catName ? ` in ${catName}` : ''} · Sorted by ${sortLabel.toLowerCase()}`;
  }

  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-5 px-ods-pad-page py-6" data-testid="products-page">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Products', href: basePath }, ...(cat ? [{ label: cat.name }] : [])].map((b, i, arr) => (i === arr.length - 1 ? { label: b.label } : b))} />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-ods-h1 text-ods-navy">{title}</h1>
          <p className="m-0 mt-1 max-w-[70ch] text-ods-body text-ods-slate">
            Browse products from verified suppliers, compare prices by quantity and request a quote. Can’t find it? Ask us to source it.
          </p>
        </div>
        <Button href={REQUEST_HREF} iconStart={Send}>
          Request a product we don’t list
        </Button>
      </header>

      <form method="get" action={basePath} role="search" className="relative" aria-label="Search products">
        {state.category ? <input type="hidden" name="category" value={state.category} /> : null}
        <label htmlFor="products-q" className="sr-only">
          Search products
        </label>
        <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ods-slate">
          <Icon icon={PackageSearch} />
        </span>
        <input
          id="products-q"
          name="q"
          type="search"
          defaultValue={state.q}
          maxLength={100}
          placeholder="Search products or materials"
          className="h-ods-control w-full rounded-ods-control border border-ods-line-strong bg-ods-surface ps-10 pe-3 text-ods-body text-ods-text placeholder:text-ods-slate hover:border-ods-navy"
        />
      </form>

      {chips.length ? (
        <nav aria-label="Categories" className="-mx-ods-pad-page overflow-x-auto px-ods-pad-page">
          <ul role="list" className="m-0 flex list-none gap-2 p-0 pb-1 whitespace-nowrap">
            {[{ slug: '', name: 'All' } as const, ...chips].map((c) => {
              const on = (c.slug || null) === (state.category ?? null);
              return (
                <li key={c.slug || 'all'}>
                  <Link
                    href={href({ category: c.slug || null })}
                    aria-current={on ? 'page' : undefined}
                    className={cx(
                      'inline-flex h-[calc(var(--ods-control-h)-4px)] items-center gap-1.5 rounded-ods-pill border px-4 text-ods-small font-semibold no-underline',
                      on ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy hover:border-ods-navy',
                    )}
                  >
                    {on ? <Icon icon={Check} size="xs" /> : null}
                    {c.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {!actor.canAct && actor.reason ? (
        <p className="m-0 rounded-ods-card border border-ods-info bg-ods-info-tint px-4 py-3 text-ods-body text-ods-text" data-testid="role-reason">
          {actor.reason}
        </p>
      ) : null}

      <div className="grid items-start gap-6 ods-desktop:grid-cols-[256px_minmax(0,1fr)]">
        <aside aria-labelledby="filters-h" className="hidden rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card ods-desktop:block">
          <h2 id="filters-h" className="m-0 mb-3 text-ods-h2 text-ods-navy">
            Filters
          </h2>
          <FiltersForm state={state} categories={categories} currency={currency} basePath={basePath} data-testid="filters" />
        </aside>

        <section aria-labelledby="results-h" className="flex min-w-0 flex-col gap-4">
          <h2 id="results-h" className="sr-only">
            Products
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-ods-body text-ods-text" role="status" aria-live="polite" data-testid="result-count">
              {countText}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="ods-desktop:hidden">
                <FiltersSheetButton state={state} categories={categories} currency={currency} activeCount={active} basePath={basePath} />
              </div>
              <SortSelect state={state} basePath={basePath} />
            </div>
          </div>

          {chipsActive.length ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="active-filters">
              <ul role="list" aria-label="Active filters" className="m-0 flex list-none flex-wrap gap-2 p-0">
                {chipsActive.map((c) => (
                  <li key={c.label}>
                    <Link
                      href={href(c.patch)}
                      className="inline-flex min-h-[calc(var(--ods-control-h)-8px)] items-center gap-1.5 rounded-ods-pill bg-ods-blue-tint px-3 text-ods-small font-semibold text-ods-navy no-underline hover:underline"
                    >
                      {c.label}
                      <Icon icon={X} size="xs" />
                      <span className="sr-only">: remove this filter</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={clearAll} className="inline-flex min-h-ods-control items-center px-1 text-ods-small font-semibold text-ods-blue underline underline-offset-4">
                Clear all
              </Link>
            </div>
          ) : null}

          {status === 'loading' ? (
            <ul role="list" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3" aria-busy="true" data-testid="products-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i}>
                  <ProductCardSkeleton silent={i > 0} />
                </li>
              ))}
            </ul>
          ) : status === 'error' ? (
            <Card>
              <ErrorState
                title="We couldn’t load products."
                description="Everything else is fine. Try again in a moment."
                action={
                  <Button variant="secondary" href={href({})}>
                    Try again
                  </Button>
                }
              />
            </Card>
          ) : !list || list.items.length === 0 ? (
            <Card data-testid="products-empty">
              <EmptyState
                icon={PackageSearch}
                title="No products match these filters"
                description="Remove a filter, or send us a request and we source it for you."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="secondary" href={clearAll}>
                      Clear filters
                    </Button>
                    <Button href={REQUEST_HREF} iconStart={Send}>
                      Request a product
                    </Button>
                  </div>
                }
              />
            </Card>
          ) : (
            <ul role="list" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3" data-testid="products-grid">
              {list.items.map((p) => (
                <li key={p.id} className="flex min-w-0">
                  <ShopCard model={p} canAct={actor.canAct} demo={demo} className="flex h-full w-full min-w-0 flex-col gap-1" />
                </li>
              ))}
            </ul>
          )}

          {status === 'ready' && list && list.pages > 1 ? (
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-3 pt-2" data-testid="pagination">
              {list.page > 1 ? (
                <Button variant="secondary" href={href({ page: list.page - 1 })} rel="prev">
                  Previous
                </Button>
              ) : null}
              <span className="text-ods-small text-ods-slate">
                Page {list.page} of {list.pages}
              </span>
              {list.page < list.pages ? (
                <Button variant="secondary" href={href({ page: list.page + 1 })} rel="next">
                  Next
                </Button>
              ) : null}
            </nav>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
            <div>
              <h2 className="m-0 text-ods-h2 text-ods-navy">Can’t find what you need?</h2>
              <p className="m-0 mt-1 text-ods-body text-ods-slate">Send us a photo, a link or a description. We search our verified suppliers and come back with quotes.</p>
            </div>
            <Button href={REQUEST_HREF} variant="secondary" iconStart={Send}>
              Request a product
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
