import { Suspense } from 'react';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { COUNTRY_NAMES } from '@/lib/format';
import { getAccountContext, serviceOn } from '@/lib/core/account';
import {
  getDropshipCatalogue,
  getDropshipCountries,
  dropshipSettings,
  importList,
  pickRoute,
  profit,
  suggested,
  days,
  STOCK_LABEL,
  type ShipType,
} from '@/lib/dropship';
import { VerifiedBadge, ShippingTypePill, ExamplePill, Icon, Notice } from '@/components/ds';
import { CountrySelect, FilterToggle, ImportButton } from '@/components/account/dropship/client';
import { LaunchNotifyForm } from '@/components/store/launch-notify-form';
import { addToImportList, removeFromImportList, saveMerchantMarkets } from '../actions';

export const metadata = { title: 'Dropshipping catalogue' };

type SP = {
  q?: string;
  country?: string;
  cat?: string;
  ship?: string;
  sort?: string;
  list?: string;
  markets?: string;
  page?: string;
};

const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SORTS: [string, string][] = [
  ['fastest', 'Fastest delivery'],
  ['profit', 'Best profit'],
  ['cost', 'Lowest cost'],
  ['newest', 'Newest'],
];
const SHIPS: [string, string][] = [
  ['', 'All'],
  ['economy', 'Economy'],
  ['standard', 'Standard'],
  ['express', 'Express'],
];

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<CatalogueSkeleton />}>
      <Catalogue searchParams={searchParams} />
    </Suspense>
  );
}

function CatalogueSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the catalogue">
      <div className="h-8 w-48 bg-line rounded" />
      <div className="card h-[150px] mt-6" />
      <div className="mt-6 grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="card h-[420px] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

async function Catalogue({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const sp = await searchParams;
  const ctx = await getAccountContext(s.org!.id);
  const on = serviceOn(ctx.services.dropship);

  // Dropshipping not switched on → keep the "not switched on" message, and the function returns zero rows
  if (!on) {
    return (
      <div className="max-w-[860px]" data-testid="dropship-not-switched-on">
        <div className="mono text-[11.5px] font-semibold uppercase tracking-[.1em] text-coral-text">
          Not switched on yet
        </div>
        <h1 className="text-[30px] font-extrabold leading-[1.15]">Dropshipping catalogue</h1>
        <section className="card p-6 mt-5" data-testid="dropship-coming-soon">
          <span className="pill bg-warn-bg text-warn">Coming soon</span>
          <p className="mt-2 text-[15px]">
            Dropshipping is not switched on for {s.org!.name} yet. Leave your email and we will tell you once it opens, or ask your account manager.
          </p>
          <div className="mt-3 max-w-[560px]">
            <LaunchNotifyForm
              feature="dropship"
              source="catalogue-off"
              defaultEmail={s.email ?? ''}
            />
          </div>
        </section>
      </div>
    );
  }

  const [cfg, merchantCountries, list] = await Promise.all([
    dropshipSettings(),
    getDropshipCountries(),
    importList(s.org!.id),
  ]);

  const countries = merchantCountries.map((m) => m.country);
  const lockedByStaff = merchantCountries.some((m) => m.locked_by_staff);
  const countryOpts = countries
    .map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const fallback =
    cfg.defaultCountry && countries.includes(cfg.defaultCountry)
      ? cfg.defaultCountry
      : s.org?.country && countries.includes(s.org.country)
        ? s.org.country
        : countries[0];
  const country =
    sp.country && countries.includes(sp.country.toUpperCase())
      ? sp.country.toUpperCase()
      : fallback;
  const countryName = country ? (COUNTRY_NAMES[country] ?? country) : '';
  const ship = (
    ['express', 'standard', 'economy'].includes(sp.ship ?? '') ? sp.ship : null
  ) as ShipType | null;
  const pageNum = Math.max(1, Number(sp.page ?? '1') || 1);

  const { rows, totalCount } = country
    ? await getDropshipCatalogue({
        country,
        search: sp.q ?? null,
        category: sp.cat ?? null,
        page: pageNum,
      })
    : { rows: [], totalCount: 0 };

  // Also fetch distinct categories across the country's active products (page 1 without category filter if filtered)
  const allForCats =
    country && sp.cat
      ? (await getDropshipCatalogue({ country, page: 1 })).rows
      : rows;
  const cats = [
    ...new Set(
      allForCats
        .map((r) => (r.category ?? '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const filtered = rows
    .filter((r) => sp.list !== '1' || list.has(r.product_id))
    .map((r) => {
      const route = pickRoute(r.routes, ship);
      const sugg = route ? suggested(route.landed_price_cents, cfg.markup) : null;
      return {
        r,
        route,
        sugg,
        pr: route && sugg ? profit(sugg, route.landed_price_cents) : null,
      };
    })
    .filter((x) => !ship || x.route !== null);

  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : 'fastest';
  filtered.sort((a, b) => {
    if (!a.route || !b.route) return 0;
    if (sort === 'profit') return (b.pr?.cents ?? 0) - (a.pr?.cents ?? 0);
    if (sort === 'cost') return a.route.landed_price_cents - b.route.landed_price_cents;
    if (sort === 'newest') return 0;
    return (
      a.route.est_days_min - b.route.est_days_min ||
      a.route.landed_price_cents - b.route.landed_price_cents
    );
  });

  const hasFilters = !!(sp.q || sp.cat || ship || sp.list === '1');
  const totalPages = Math.max(1, Math.ceil(totalCount / 48));

  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams(
      Object.entries({ ...sp, country, ...patch }).filter(([, v]) => v) as [string, string][],
    );
    return `/account/dropship/catalogue?${p.toString()}`;
  };

  const supportedOpts = cfg.supportedCountries
    .map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const marketsCard = (
    <details
      className="card p-4 sm:p-5 mt-4"
      open={countries.length === 0 || sp.markets === '1'}
      data-testid="selling-countries-panel"
    >
      <summary className="cursor-pointer font-semibold text-[14.5px] flex flex-wrap items-center justify-between gap-2">
        <span>
          Selling countries ({countries.length ? countries.map((c) => COUNTRY_NAMES[c] ?? c).join(', ') : 'none selected'})
          {lockedByStaff && (
            <span className="ml-2 pill bg-pearl text-muted border border-line">
              Locked by account manager
            </span>
          )}
        </span>
        <span className="text-[13px] text-coral-text font-semibold">
          {lockedByStaff ? 'View' : 'Change selling countries'}
        </span>
      </summary>
      {lockedByStaff ? (
        <p className="mt-3 text-[13.5px] text-muted" data-testid="markets-locked-msg">
          Your account manager has locked your selling countries. Contact your account manager to add or remove a market.
        </p>
      ) : (
        <form action={saveMerchantMarkets} className="mt-3 space-y-3" data-testid="markets-form">
          <p className="text-[13.5px] text-muted">
            Pick the countries your store ships to. The catalogue only shows products with active routes and duties-paid prices to these countries.
          </p>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
            {supportedOpts.map(([code, name]) => (
              <label
                key={code}
                className="inline-flex items-center gap-2 text-[13.5px] px-2.5 py-1.5 rounded border border-line bg-white cursor-pointer"
              >
                <input
                  type="checkbox"
                  name="countries"
                  value={code}
                  defaultChecked={countries.includes(code)}
                  className="accent-ink"
                />
                <span>
                  {name} <span className="mono text-[11px] text-muted">({code})</span>
                </span>
              </label>
            ))}
          </div>
          <button type="submit" className="btn btn-dark min-h-10">
            Save selling countries
          </button>
        </form>
      )}
    </details>
  );

  const filters = (
    <form
      action="/account/dropship/catalogue"
      className="card p-4 sm:p-5"
      data-testid="catalogue-filters"
    >
      <input type="hidden" name="country" value={country ?? ''} />
      {ship && <input type="hidden" name="ship" value={ship} />}
      <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div>
          <label htmlFor="q" className="k block mb-1.5">
            Search the catalogue
          </label>
          <input
            id="q"
            name="q"
            defaultValue={sp.q ?? ''}
            className="input"
            placeholder="Product name, SKU or category"
          />
        </div>
        <div>
          <label htmlFor="country" className="k block mb-1.5">
            Customers in
          </label>
          <CountrySelect value={country ?? ''} options={countryOpts} />
        </div>
        <div>
          <label htmlFor="cat" className="k block mb-1.5">
            Category
          </label>
          <select id="cat" name="cat" defaultValue={sp.cat ?? ''} className="input">
            <option value="">All categories</option>
            {cats.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="k block mb-1.5">
            Sort by
          </label>
          <select id="sort" name="sort" defaultValue={sort} className="input">
            {SORTS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Shipping method"
        >
          <span className="k mr-1">Shipping method:</span>
          {SHIPS.map(([k, l]) => {
            const onChip = (ship ?? '') === k;
            return (
              <Link
                key={k || 'all'}
                href={href({ ship: k || undefined, page: undefined })}
                aria-current={onChip ? 'true' : undefined}
                className={`inline-flex items-center min-h-9 px-3.5 rounded-full border text-[13.5px] font-medium ${
                  onChip
                    ? 'bg-ink text-white border-ink'
                    : 'border-line-strong bg-white hover:border-ink'
                }`}
              >
                {l}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <Link
              href={href({
                q: undefined,
                cat: undefined,
                ship: undefined,
                list: undefined,
                sort: undefined,
                page: undefined,
              })}
              className="btn btn-ghost min-h-10"
            >
              Clear
            </Link>
          )}
          <button type="submit" className="btn btn-dark min-h-10">
            Apply
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div data-testid="dropship-catalogue">
      <div className="k !text-coral-text">Dropshipping</div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[860px]">
          <h1 className="text-[30px] font-extrabold leading-[1.15]">
            {sp.list === '1' ? 'Import list' : 'Catalogue'}
          </h1>
          <p className="mt-1 text-[14.5px] text-black">
            Only products available for dropshipping to your markets are shown · Verified suppliers only · Prices include shipping and duties to the country you choose
          </p>
        </div>
        <Link
          href={href({ list: sp.list === '1' ? undefined : '1', page: undefined })}
          className="btn btn-ghost"
          data-testid="import-list-link"
        >
          <Icon name="doc" size={18} />
          {sp.list === '1' ? 'Show all products' : `Import list (${list.size})`}
        </Link>
      </div>

      {marketsCard}

      {!country ? (
        <div className="mt-6" data-testid="no-markets-empty">
          <Notice tone="warn">
            Choose the countries you sell to above to browse products with routes to your markets.
          </Notice>
        </div>
      ) : (
        <>
          <FilterToggle on={hasFilters}>{filters}</FilterToggle>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[14.5px]" data-testid="result-count">
              <b>
                {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
              </b>{' '}
              for customers in {countryName}
            </p>
            {cfg.demo && <ExamplePill />}
          </div>

          {filtered.length === 0 ? (
            <div className="card p-8 mt-4 text-center" data-testid="catalogue-empty">
              <p className="text-[16px] font-semibold">
                {hasFilters
                  ? `No products ship to ${countryName} with these filters`
                  : `No active shipping routes to ${countryName} yet`}
              </p>
              <p className="mt-1 text-[13.5px] text-muted">
                {hasFilters
                  ? 'Try clearing your search or shipping method filter.'
                  : 'Switch to another selling country or ask your account manager when routes to this market open.'}
              </p>
              {hasFilters && (
                <Link
                  href={href({
                    q: undefined,
                    cat: undefined,
                    ship: undefined,
                    list: undefined,
                    sort: undefined,
                    page: undefined,
                  })}
                  className="btn btn-ghost mt-4"
                >
                  Clear filters
                </Link>
              )}
            </div>
          ) : (
            <>
              <ul className="mt-4 grid gap-4 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
                {filtered.map(({ r, route, sugg, pr }) => {
                  if (!route) return null;
                  const added = list.has(r.product_id);
                  const savedItem = list.get(r.product_id);
                  const detail = `/account/dropship/catalogue/${r.product_id}?country=${country}`;
                  const img = r.images[0] ?? null;
                  const [stockText, stockTone] = STOCK_LABEL[r.stock_status];
                  return (
                    <li
                      key={r.product_id}
                      className="card overflow-hidden flex flex-col"
                      data-testid="catalogue-card"
                    >
                      <div className="relative aspect-square bg-pearl">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt={r.title}
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted text-[13px] gap-1.5">
                            <Icon name="box" size={28} />
                            Photo coming
                          </div>
                        )}
                        <span className="absolute top-2.5 left-2.5">
                          <VerifiedBadge />
                        </span>
                        <span className={`absolute top-2.5 right-2.5 pill ${stockTone}`}>
                          {stockText}
                        </span>
                      </div>
                      <div className="p-4 flex flex-col flex-1">
                        <div className="flex flex-wrap gap-1.5">
                          <ShippingTypePill type={route.shipping_method} />
                          <span className="pill bg-pearl text-muted border border-line">
                            {days(route)}
                          </span>
                        </div>
                        <h2 className="mt-2.5 text-[15.5px] font-bold leading-snug line-clamp-2">
                          <Link href={detail} className="text-ink hover:text-coral-text">
                            {r.title}
                          </Link>
                        </h2>
                        <p className="mt-1 text-[12.5px] text-muted">
                          Model <span className="mono">{r.model_no}</span> · MOQ {r.min_order_qty}
                          {r.variants.length > 1 ? ` · ${r.variants.length} variants` : ''}
                        </p>
                        <dl className="mt-3 pt-3 border-t border-line space-y-1 text-[13.5px] flex-1">
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted">Your cost (incl. shipping)</dt>
                            <dd className="font-semibold tabular-nums whitespace-nowrap">
                              {usd(route.landed_price_cents)}
                            </dd>
                          </div>
                          <div className="text-[12px] text-muted">
                            Includes shipping and duties to {countryName}
                          </div>
                          {sugg && (
                            <div className="flex justify-between gap-2 pt-0.5">
                              <dt className="text-muted">Suggested price</dt>
                              <dd className="font-bold tabular-nums whitespace-nowrap">
                                {usd(sugg)}
                              </dd>
                            </div>
                          )}
                          {pr && (
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted">Profit</dt>
                              <dd className="font-bold text-ok tabular-nums whitespace-nowrap">
                                {usd(pr.cents)} ({pr.pct}%)
                              </dd>
                            </div>
                          )}
                          {savedItem?.price_cents && sp.list === '1' && (
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted">Saved selling price</dt>
                              <dd className="font-bold tabular-nums whitespace-nowrap">
                                {usd(savedItem.price_cents)}
                              </dd>
                            </div>
                          )}
                        </dl>
                        <form
                          action={added ? removeFromImportList : addToImportList}
                          className="mt-3"
                        >
                          <input type="hidden" name="product_id" value={r.product_id} />
                          <input type="hidden" name="service" value={route.shipping_method} />
                          {sugg && <input type="hidden" name="price_cents" value={String(sugg)} />}
                          <ImportButton added={added} />
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {totalPages > 1 && (
                <nav
                  aria-label="Catalogue pages"
                  className="mt-6 flex items-center justify-between gap-3"
                  data-testid="catalogue-pagination"
                >
                  <span className="text-[13.5px] text-muted">
                    Page {pageNum} of {totalPages} ({totalCount} products)
                  </span>
                  <div className="flex gap-2">
                    {pageNum > 1 && (
                      <Link
                        href={href({ page: String(pageNum - 1) })}
                        className="btn btn-ghost min-h-10"
                      >
                        ← Previous
                      </Link>
                    )}
                    {pageNum < totalPages && (
                      <Link
                        href={href({ page: String(pageNum + 1) })}
                        className="btn btn-ghost min-h-10"
                      >
                        Next →
                      </Link>
                    )}
                  </div>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
