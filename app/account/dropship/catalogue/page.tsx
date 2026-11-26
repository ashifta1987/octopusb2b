import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { COUNTRY_NAMES, money } from '@/lib/format';
import { getAccountContext, serviceOn } from '@/lib/core/account';
import {
  getDropshipCatalogue,
  getDropshipCountries,
  dropshipSettings,
  isDropshipV2UiEnabled,
  importList,
  pickRoute,
  profit,
  suggested,
  days,
  type ShipType,
} from '@/lib/dropship';
import {
  DsBadge,
  DsCard,
  DsEmptyState,
  DsIcon,
  DsLinkButton,
  DsPageHeader,
  DsSkeleton,
} from '@/components/dropship-ui';
import { LaunchNotifyForm } from '@/components/store/launch-notify-form';
import { addToImportList, removeFromImportList, saveMerchantMarkets } from '../actions';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { DsImportSubmitButton, DsQuerySelect } from './catalogue-v2-client';
import { ImportListPage } from './import-list';

export const metadata = { title: 'Find products · Octopus Dropship' };

type SP = {
  q?: string;
  country?: string;
  cat?: string;
  ship?: string;
  stock?: string;
  only?: string;
  sort?: string;
  list?: string;
  markets?: string;
  page?: string;
};

// Batch 3 (F-16): same US$ format as the rest of the platform (money() → \"US$ 18.00\")
const usdShort = (c: number) => money(c, 'USD');

const SHIPS: [string, string][] = [
  ['', 'All methods'],
  ['economy', 'Economy'],
  ['standard', 'Standard'],
  ['express', 'Express'],
];

const STOCK_TYPES: [string, string][] = [
  ['', 'All'],
  ['fast_ship', 'Fast-ship stock'],
  ['extended_catalog', 'Extended catalog'],
];

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense
      fallback={
        <div className="ds-card">
          <DsSkeleton immediate />
        </div>
      }
    >
      <Catalogue searchParams={searchParams} />
    </Suspense>
  );
}

async function Catalogue({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireCustomer('/account/dropship/catalogue');
  if (!s.org) redirect('/account/dropship');
  const sp = await searchParams;
  const [ctx, v2On] = await Promise.all([
    getAccountContext(s.org.id),
    isDropshipV2UiEnabled(),
  ]);
  const on = serviceOn(ctx.services.dropship);

  // States-Catalog.html: Account without dropshipping sees "Dropshipping is not switched on" & 0 cards
  if (!on) {
    return (
      <div className="max-w-[780px]" data-testid="dropship-not-switched-on">
        <h1 className="text-[28px] font-bold text-ink m-0">Dropshipping is not switched on</h1>
        <section className="card p-6 mt-4" data-testid="dropship-coming-soon">
          <p className="m-0 text-[15px] text-muted">
            Dropshipping is not switched on for {s.org.name} yet. Ask your account manager to switch it on, or leave your email to be notified. No products are shown until then.
          </p>
          <div className="mt-4 max-w-[540px]">
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

  if (!v2On) {
    redirect('/account/dropship');
  }
  // EA-2: the import list is its own feature; while it is off the catalogue has no list and no import buttons
  const features = await getDropshipFeatures();
  if (!features.find) redirect('/account/dropship');
  if (sp.list === '1' && !features.import_list) redirect('/account/dropship/catalogue');
  // Release 2 · Step 6: ?list=1 is the Import list screen (screens/ImportList.html) — priced with the merchant's rule
  if (sp.list === '1') return <ImportListPage />;

  const [cfg, merchantCountries, list] = await Promise.all([
    dropshipSettings(),
    getDropshipCountries(),
    importList(s.org.id),
  ]);

  const countries = merchantCountries.map((m) => m.country);
  const lockedByStaff = merchantCountries.some((m) => m.locked_by_staff);
  const countryOpts = countries
    .map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const fallback =
    cfg.defaultCountry && countries.includes(cfg.defaultCountry)
      ? cfg.defaultCountry
      : s.org.country && countries.includes(s.org.country)
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
  const stockFilter =
    sp.stock === 'fast_ship' || sp.stock === 'extended_catalog' ? sp.stock : '';
  const onlyForYou = sp.only === '1';
  const isListOnly = sp.list === '1';
  const pageNum = Math.max(1, Number(sp.page ?? '1') || 1);

  const { rows, totalCount } = country
    ? await getDropshipCatalogue({
        country,
        search: sp.q ?? null,
        category: sp.cat ?? null,
        page: pageNum,
      })
    : { rows: [], totalCount: 0 };

  const allForCats =
    country && (sp.cat || sp.q)
      ? (await getDropshipCatalogue({ country, page: 1 })).rows
      : rows;
  const cats = [
    ...new Set(
      allForCats
        .map((r) => (r.category ?? '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const categoryOpts: [string, string][] = [
    ['', 'All categories'],
    ...cats.map((c) => [c, c] as [string, string]),
  ];

  const onlyForYouCount = rows[0]?.only_for_you_count ?? allForCats[0]?.only_for_you_count ?? 0;

  // Determine country duties mode from active routes (defaults to DDP)
  const sampleRouteForCountry = rows[0]?.routes?.[0] ?? allForCats[0]?.routes?.[0] ?? null;
  const countryIncoterm = sampleRouteForCountry?.incoterm ?? 'DDP';

  const mapped = rows
    .filter((r) => !isListOnly || list.has(r.product_id))
    .filter((r) => !onlyForYou || r.only_for_you)
    .filter((r) => !stockFilter || r.fulfilment_type === stockFilter)
    .map((r) => {
      const route = pickRoute(r.routes, ship);
      const sugg = route ? suggested(route.landed_price_cents, cfg.markup) : null;
      const pr = route && sugg ? profit(sugg, route.landed_price_cents) : null;
      const minBp =
        (r.category && cfg.categoryMinMarginBp[r.category] != null
          ? cfg.categoryMinMarginBp[r.category]
          : cfg.minMarginBp) ?? 1500;
      const lowMargin = Boolean(pr && pr.bp < minBp);
      return { r, route, sugg, pr, lowMargin };
    })
    .filter((x) => x.route !== null);

  // Default sort in Catalog.html: highest margin after duties (with 'only_for_you' pinned first unless explicit sort)
  const sort = sp.sort ?? 'margin';
  mapped.sort((a, b) => {
    if (!a.route || !b.route) return 0;
    if (a.r.only_for_you !== b.r.only_for_you && !sp.sort) {
      return a.r.only_for_you ? -1 : 1;
    }
    if (sort === 'fastest') {
      return (
        a.route.est_days_min - b.route.est_days_min ||
        a.route.landed_price_cents - b.route.landed_price_cents
      );
    }
    if (sort === 'cost') {
      return a.route.landed_price_cents - b.route.landed_price_cents;
    }
    return (b.pr?.bp ?? 0) - (a.pr?.bp ?? 0) || a.route.landed_price_cents - b.route.landed_price_cents;
  });

  const hasFilters = Boolean(sp.q || sp.cat || ship || stockFilter || onlyForYou || isListOnly);
  const totalPages = Math.max(1, Math.ceil(totalCount / 48));

  const buildHref = (patch: Partial<SP>) => {
    const merged: Record<string, string | undefined> = {
      ...sp,
      country: country ?? undefined,
      ...patch,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    const qs = p.toString();
    return qs ? `/account/dropship/catalogue?${qs}` : '/account/dropship/catalogue';
  };

  const supportedOpts = cfg.supportedCountries
    .map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-catalogue-v2">
      <DsPageHeader
        title={isListOnly ? 'Import list' : 'Find products'}
        subtitle="Prices include shipping and duties to the country you pick. Margins are after duties."
        icon="search"
        actions={
          <>
            {features.requests && (
              <DsLinkButton
                href="/account/dropship/requests"
                variant="secondary"
                icon="send"
                testId="request-product-btn"
              >
                Request a product
              </DsLinkButton>
            )}
            {features.import_list && (
            <DsLinkButton
              href={
                isListOnly
                  ? buildHref({ list: undefined, page: undefined })
                  : buildHref({ list: '1', page: undefined })
              }
              variant="primary"
              icon="arrow"
              testId="import-list-link"
            >
              {isListOnly ? 'Browse all products' : `Go to import list (${list.size})`}
            </DsLinkButton>
            )}
          </>
        }
      />

      {/* Filter Bar — matches screens/Catalog.html */}
      <DsCard testId="catalogue-filters">
        <form
          action="/account/dropship/catalogue"
          className="flex gap-3.5 flex-wrap items-end"
        >
          {country && <input type="hidden" name="country" value={country} />}
          {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
          {stockFilter && <input type="hidden" name="stock" value={stockFilter} />}
          {ship && <input type="hidden" name="ship" value={ship} />}
          {onlyForYou && <input type="hidden" name="only" value="1" />}
          {isListOnly && <input type="hidden" name="list" value="1" />}

          <div className="flex-[2_1_220px] min-w-0">
            <label className="ds-label" htmlFor="q">
              Search
            </label>
            <div className="flex gap-2">
              <input
                id="q"
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Search products or DS model no."
                className="ds-input w-full"
              />
              {sp.q && (
                <Link
                  href={buildHref({ q: undefined, page: undefined })}
                  className="ds-btn ds-btn-secondary shrink-0 no-underline"
                >
                  Clear
                </Link>
              )}
            </div>
          </div>

          <div className="flex-[1_1_160px] min-w-0">
            <DsQuerySelect
              id="cat"
              name="cat"
              label="Category"
              value={sp.cat ?? ''}
              options={categoryOpts}
              testId="category-select"
            />
          </div>

          <div className="flex-[1_1_170px] min-w-0">
            <DsQuerySelect
              id="country"
              name="country"
              label="Ships to"
              value={country ?? ''}
              options={countryOpts}
              testId="country-select"
            />
          </div>

          <div className="flex-[1_1_220px] min-w-0">
            <span className="ds-label">Duties</span>
            <p className="m-0 min-h-[44px] flex items-center flex-wrap gap-1 text-[14px] text-ink">
              <span>
                {countryIncoterm === 'DAP' ? 'Paid by buyer (DAP)' : 'Included (DDP)'}
                {countryName ? ` for ${country}` : ''}
              </span>
              <span aria-hidden="true">·</span>
              <Link
                href="/account/dropship/packing"
                className="text-coral-text hover:underline font-medium"
              >
                change in Packing and shipping
              </Link>
            </p>
          </div>

          <div className="flex-[1_1_160px] min-w-0">
            <DsQuerySelect
              id="stock"
              name="stock"
              label="Stock type"
              value={stockFilter}
              options={STOCK_TYPES}
              testId="stock-type-select"
            />
          </div>
        </form>

        {/* Shipping method filter & selling countries toggle */}
        <div className="mt-3.5 pt-3 border-t border-divider flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Shipping method">
            <span className="text-[12.5px] font-semibold text-muted">Shipping method:</span>
            {SHIPS.map(([val, label]) => {
              const active = (ship ?? '') === val;
              return (
                <Link
                  key={val || '__all_ship'}
                  href={buildHref({ ship: val || undefined, page: undefined })}
                  aria-current={active ? 'true' : undefined}
                  className={`ds-chip no-underline ${
                    active ? '!bg-coral !text-white !border-coral' : ''
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>

          <Link
            href="/account/dropship/landed-cost"
            className="text-[13px] font-semibold text-coral-text hover:underline inline-flex items-center gap-1 min-h-[36px]"
          >
            <DsIcon name="globe" size={15} />
            <span>Landed cost calculator</span>
          </Link>
        </div>
      </DsCard>

      {/* Selling countries details (when no countries or merchant opens ?markets=1) */}
      {(countries.length === 0 || sp.markets === '1') && (
        <DsCard title="Selling countries" icon="globe" testId="selling-countries-panel">
          {lockedByStaff ? (
            <p className="m-0 text-[13.5px] text-muted" data-testid="markets-locked-msg">
              Your account manager has locked your selling countries. Contact support to add or remove a market.
            </p>
          ) : (
            <form action={saveMerchantMarkets} className="space-y-3" data-testid="markets-form">
              <p className="m-0 text-[13.5px] text-muted">
                Pick the countries your store ships to. Only products with active routes to these countries are shown.
              </p>
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
                {supportedOpts.map(([code, name]) => (
                  <label
                    key={code}
                    className="inline-flex items-center gap-2 min-h-[44px] text-[13.5px] px-3 py-1.5 rounded-[8px] border border-line bg-white cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name="countries"
                      value={code}
                      defaultChecked={countries.includes(code)}
                      className="accent-ink w-4 h-4"
                    />
                    <span>
                      {name} <span className="mono text-[11px] text-muted">({code})</span>
                    </span>
                  </label>
                ))}
              </div>
              <button type="submit" className="ds-btn ds-btn-primary">
                Save selling countries
              </button>
            </form>
          )}
        </DsCard>
      )}

      {/* Filter Chips Row — All products / Only for you */}
      <div className="flex gap-2 flex-wrap items-center">
        <Link
          href={buildHref({ only: undefined, list: undefined, page: undefined })}
          aria-current={!onlyForYou && !isListOnly ? 'true' : undefined}
          className={`ds-chip no-underline ${
            !onlyForYou && !isListOnly ? '!bg-coral !text-white !border-coral' : ''
          }`}
        >
          All products
        </Link>
        <Link
          href={buildHref({ only: onlyForYou ? undefined : '1', list: undefined, page: undefined })}
          aria-current={onlyForYou ? 'true' : undefined}
          data-testid="filter-only-for-you"
          className={`ds-chip no-underline ${
            onlyForYou ? '!bg-coral !text-white !border-coral' : ''
          }`}
        >
          Only for you ({onlyForYouCount})
        </Link>
        <span className="ds-mut text-[13px] ml-auto">
          Showing {mapped.length} of {totalCount} · sorted by highest margin after duties
        </span>
      </div>

      {/* Catalogue Grid or Empty States (States-Catalog.html) */}
      {mapped.length === 0 ? (
        <DsCard testId="catalogue-empty">
          {sp.q ? (
            <DsEmptyState
              title={`No results for "${sp.q}"`}
              description="Check the spelling, or ask Octopus to source it for you."
              icon="search"
              actionLabel="Request a product"
              actionHref="/account/dropship/requests"
              actionIcon="send"
            />
          ) : hasFilters ? (
            <DsEmptyState
              title="No matching products"
              description="Clear a filter, choose another destination country, or request a product."
              icon="search"
              actionLabel="Clear filters"
              actionHref={buildHref({
                q: undefined,
                cat: undefined,
                ship: undefined,
                stock: undefined,
                only: undefined,
                list: undefined,
                page: undefined,
              })}
              actionIcon="refresh"
            />
          ) : (
            <DsEmptyState
              title={`No products ship to ${countryName || 'this country'} yet`}
              description={`Try another country, or ask us to source for ${countryName || 'this market'}.`}
              icon="globe"
              actionLabel="Request a product"
              actionHref="/account/dropship/requests"
              actionIcon="send"
            />
          )}
        </DsCard>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {mapped.map(({ r, route, sugg, pr, lowMargin }) => {
            if (!route) return null;
            const added = list.has(r.product_id);
            const detailHref = `/account/dropship/catalogue/${r.product_id}?country=${country}`;
            const primaryVar = r.variants[0] ?? null;
            const productCents = route.product_cents ?? 0;
            const processingCents = route.processing_cents ?? 0;
            const shippingCents = route.shipping_cents ?? 0;
            const dutiesText =
              route.incoterm === 'DAP'
                ? 'Paid by buyer'
                : !route.duties_known || route.duties_cents == null
                  ? 'Not set'
                  : usdShort(route.duties_cents);

            return (
              <article
                key={r.product_id}
                data-testid="catalogue-card"
                className={`ds-card !p-0 flex flex-col overflow-hidden ${
                  r.only_for_you ? '!border-2 !border-ok' : ''
                }`}
              >
                <Link
                  href={detailHref}
                  tabIndex={-1}
                  aria-hidden="true"
                  className={`h-[156px] flex items-center justify-center overflow-hidden relative ${
                    r.only_for_you ? 'bg-ok-bg text-ok' : 'bg-fill text-muted'
                  }`}
                >
                  {r.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.images[0]}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[13px]">Product image</span>
                  )}
                </Link>

                <div className="p-4 flex flex-col gap-2 flex-1">
                  {/* Top Badges — Stock label ONLY (never a number) */}
                  <div className="flex gap-1.5 flex-wrap">
                    {r.only_for_you ? (
                      <DsBadge tone="ok" testId="badge-only-for-you">
                        Only for you
                      </DsBadge>
                    ) : r.fulfilment_type === 'extended_catalog' ? (
                      <DsBadge tone="info">Extended catalog</DsBadge>
                    ) : (
                      <DsBadge tone="ok">Fast-ship stock</DsBadge>
                    )}

                    {r.stock_status === 'out' && <DsBadge tone="bad">Out of stock</DsBadge>}
                    {r.stock_status === 'low' && <DsBadge tone="warn">Low stock</DsBadge>}

                    <DsBadge tone="neutral" testId={`ship-${route.shipping_method}`}>
                      {days(route)} to {country}
                    </DsBadge>

                    {lowMargin && <DsBadge tone="warn">Low margin</DsBadge>}
                  </div>

                  <h2 className="m-0 text-[16px] font-bold leading-snug">
                    <Link
                      href={detailHref}
                      className="text-ink hover:text-coral-text no-underline"
                    >
                      {r.title}
                    </Link>
                  </h2>

                  <p className="ds-mut m-0 text-[12px] mono">{r.model_no}</p>

                  {/* Correction 1: REAL RFQ code ONLY (rfqs.code, RFQ-<seq> e.g. RFQ-1358) */}
                  {r.sourced_rfq_code && (
                    <p className="ds-mut m-0 text-[12px]" data-testid="sourced-from-rfq">
                      Sourced from your request <span className="mono">{r.sourced_rfq_code}</span>
                    </p>
                  )}

                  {/* 4-Part Landed Cost Breakdown (Product, Processing, Shipping, Duties, Landed) */}
                  <div className="border-t border-divider pt-1.5 text-[13.5px]">
                    <div className="ds-row">
                      <span className="ds-mut">Product</span>
                      <span className="mono">{usdShort(productCents)}</span>
                    </div>
                    <div className="ds-row">
                      <span className="ds-mut">Processing</span>
                      <span className="mono">{usdShort(processingCents)}</span>
                    </div>
                    <div className="ds-row">
                      <span className="ds-mut">Shipping</span>
                      <span className="mono">{usdShort(shippingCents)}</span>
                    </div>
                    <div className="ds-row">
                      <span className="ds-mut">
                        {route.incoterm === 'DAP' ? 'Duties (DAP)' : 'Duties and tax (est.)'}
                      </span>
                      <span className="mono">{dutiesText}</span>
                    </div>
                    <div className="ds-row font-bold text-ink">
                      <span>Landed cost</span>
                      <span className="mono">{usdShort(route.landed_price_cents)}</span>
                    </div>
                  </div>

                  {sugg != null && (
                    <div className="ds-row text-[13.5px]">
                      <span className="ds-mut">Suggested price</span>
                      <span className="mono">{usdShort(sugg)}</span>
                    </div>
                  )}

                  {pr != null && (
                    <div className="ds-row text-[13.5px]">
                      <span className="ds-mut">Margin after duties</span>
                      <DsBadge tone={lowMargin ? 'warn' : 'ok'}>{pr.pct}%</DsBadge>
                    </div>
                  )}

                  {r.has_battery && (
                    <p className="ds-mut m-0 text-[12px]" data-testid="battery-service-note">
                      Contains a battery: only battery-approved services
                    </p>
                  )}

                  {features.import_list && (
                    <form
                      action={added ? removeFromImportList : addToImportList}
                      className="mt-auto pt-1"
                    >
                      <input type="hidden" name="product_id" value={r.product_id} />
                      {primaryVar && <input type="hidden" name="variant_id" value={primaryVar.id} />}
                      <input type="hidden" name="service" value={route.shipping_method} />
                      {sugg != null && <input type="hidden" name="price_cents" value={sugg} />}
                      <DsImportSubmitButton added={added} />
                    </form>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Catalogue pages">
          <span className="text-[13px] text-muted">
            Page {pageNum} of {totalPages}
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <DsLinkButton
                href={buildHref({ page: String(pageNum - 1) })}
                variant="secondary"
              >
                Previous
              </DsLinkButton>
            )}
            {pageNum < totalPages && (
              <DsLinkButton
                href={buildHref({ page: String(pageNum + 1) })}
                variant="secondary"
              >
                Next
              </DsLinkButton>
            )}
          </div>
        </nav>
      )}

      <p className="ds-mut m-0 text-[12px]">
        Duties come from the Octopus tariff rate table; they are estimates and follow each country&apos;s import rules.
      </p>
    </div>
  );
}
