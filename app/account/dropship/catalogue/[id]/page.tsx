import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { COUNTRY_NAMES, money } from '@/lib/format';
import {
  getDropshipCountries,
  getDropshipProduct,
  dropshipSettings,
  importList,
  pickRoute,
  suggested,
  days,
  SHIP_LABEL,
  requireDropshipV2Merchant,
} from '@/lib/dropship';
import {
  DsBadge,
  DsCard,
  DsSkeleton,
  DsTableCard,
} from '@/components/dropship-ui';
import { addToImportList, removeFromImportList } from '../../actions';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { ProductDetailHeroClient } from '../catalogue-v2-client';

export const metadata = { title: 'Product detail · Octopus Dropship' };

const UUID = /^[0-9a-f-]{36}$/i;
// Batch 3 (F-16): same US$ format as the rest of the platform (money() → \"US$ 18.00\")
const usdShort = (c: number) => money(c, 'USD');

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="ds-card">
          <DsSkeleton immediate />
        </div>
      }
    >
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}) {
  const { session: s } = await requireDropshipV2Merchant('/account/dropship/catalogue');
  const features = await getDropshipFeatures();
  if (!features.product_detail) redirect('/account/dropship/catalogue');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const [cfg, merchantCountries] = await Promise.all([
    dropshipSettings(),
    getDropshipCountries(),
  ]);
  const countries = merchantCountries.map((m) => m.country);
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
  if (!country) notFound();

  const [p, list] = await Promise.all([
    getDropshipProduct(id, country),
    importList(s.org!.id),
  ]);
  if (!p) notFound();

  const primaryRoute = pickRoute(p.routes);
  const sugg = primaryRoute ? suggested(primaryRoute.landed_price_cents, cfg.markup) : null;
  const tableRoutes = p.all_country_routes.length > 0 ? p.all_country_routes : p.routes;
  const sc = p.shipping_customs;
  const anyRestricted = Boolean(sc.has_battery || sc.has_liquid || sc.has_magnet || sc.has_powder);
  const originName = sc.origin_country
    ? COUNTRY_NAMES[sc.origin_country.toUpperCase()] ?? sc.origin_country
    : '—';

  const billedDisplay = (() => {
    if (!sc.billed_weight_g) return '—';
    const kg = (sc.billed_weight_g / 1000).toFixed(2).replace(/\.?0+$/, '');
    const isBox = sc.weight_g != null && sc.billed_weight_g > sc.weight_g;
    return `about ${kg} kg (${isBox ? 'box size' : 'actual weight'})`;
  })();

  const packageSizeDisplay =
    sc.box_l_cm != null && sc.box_w_cm != null && sc.box_h_cm != null
      ? `${Number(sc.box_l_cm)} × ${Number(sc.box_w_cm)} × ${Number(sc.box_h_cm)} cm`
      : p.dimensions_cm?.l && p.dimensions_cm?.w && p.dimensions_cm?.h
        ? `${p.dimensions_cm.l} × ${p.dimensions_cm.w} × ${p.dimensions_cm.h} cm`
        : '—';

  const specEntries = Object.entries(p.specs ?? {});

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-product">
      {/* Breadcrumb — ProductDetail.html */}
      <nav aria-label="Breadcrumb" className="ds-mut text-[13px]">
        <Link
          href={`/account/dropship/catalogue?country=${country}`}
          className="text-[#2A6FD1] hover:underline font-medium"
        >
          Find products
        </Link>
        {p.category && (
          <>
            {' / '}
            <span>{p.category}</span>
          </>
        )}
        {' / '}
        <span aria-current="page" className="text-[#1A174A]">
          {p.title}
        </span>
      </nav>

      {/* Gallery + Summary Card */}
      <ProductDetailHeroClient
        productId={p.product_id}
        modelNo={p.model_no}
        title={p.title}
        images={p.images}
        fulfilmentType={p.fulfilment_type}
        onlyForYou={p.only_for_you}
        sourcedRfqCode={p.sourced_rfq_code}
        hsVerified={sc.hs_verified}
        productStockStatus={p.stock_status}
        variants={p.variants}
        priceTiers={p.price_tiers}
        baseProductCents={primaryRoute?.product_cents ?? null}
        defaultService={primaryRoute?.shipping_method ?? null}
        suggestedPriceCents={sugg}
        country={country}
        added={list.has(p.product_id)}
        addAction={addToImportList}
        removeAction={removeFromImportList}
        showImport={features.import_list}
        showSample={features.samples}
      />

      {/* Landed cost by country — 9 columns matching ProductDetail.html */}
      <DsTableCard
        title="Landed cost by country"
        subtitle="One unit"
        icon="globe"
        minWidth={860}
        testId="cost-table"
        headers={[
          'Ship to',
          'Method',
          'Delivery',
          'Product',
          'Processing',
          'Shipping',
          'Duties and tax',
          'Landed cost',
          'Duties',
        ]}
        footer={
          <span>
            Processing covers pick, pack and standard packaging. Change DDP or DAP per country in{' '}
            <Link href="/account/dropship/packing" className="text-[#2A6FD1] hover:underline">
              Packing and shipping
            </Link>
            . Try other quantities in the{' '}
            <Link
              href={`/account/dropship/landed-cost?product=${p.product_id}&country=${country}`}
              className="text-[#2A6FD1] hover:underline"
            >
              landed cost calculator
            </Link>
            .
          </span>
        }
      >
        {tableRoutes.map((rt) => {
          const destName = COUNTRY_NAMES[rt.destination_country] ?? rt.destination_country;
          const dutiesCell =
            rt.incoterm === 'DAP'
              ? 'Paid by buyer'
              : !rt.duties_known || rt.duties_cents == null
                ? 'Not set'
                : `${usdShort(rt.duties_cents)} est.`;
          const landedCell =
            rt.incoterm === 'DAP' || rt.duties_known
              ? usdShort(rt.landed_price_cents)
              : '—';

          return (
            <tr key={`${rt.destination_country}-${rt.shipping_method}`}>
              <td>{destName}</td>
              <td>{SHIP_LABEL[rt.shipping_method] ?? rt.shipping_method}</td>
              <td>{days(rt)}</td>
              <td className="mono">{rt.product_cents != null ? usdShort(rt.product_cents) : '—'}</td>
              <td className="mono">{rt.processing_cents != null ? usdShort(rt.processing_cents) : '—'}</td>
              <td className="mono">{rt.shipping_cents != null ? usdShort(rt.shipping_cents) : '—'}</td>
              <td className="mono">{dutiesCell}</td>
              <td className="mono">
                <strong>{landedCell}</strong>
              </td>
              <td>
                {rt.incoterm === 'DAP' ? (
                  <DsBadge tone="info">Paid by buyer (DAP)</DsBadge>
                ) : rt.duties_known ? (
                  <DsBadge tone="ok">Included (DDP)</DsBadge>
                ) : (
                  <DsBadge tone="warn">Not set</DsBadge>
                )}
              </td>
            </tr>
          );
        })}
      </DsTableCard>

      {/* Shipping and customs data — ProductDetail.html */}
      <DsCard title="Shipping and customs data" icon="globe" testId="shipping-customs-card">
        <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] text-[14px]">
          <div>
            <span className="ds-label">Weight</span>
            <div>{sc.weight_g ? `${sc.weight_g} g` : p.weight_g ? `${p.weight_g} g` : '—'}</div>
          </div>
          <div>
            <span className="ds-label">Package size</span>
            <div>{packageSizeDisplay}</div>
          </div>
          <div>
            <span className="ds-label">Billed shipping weight</span>
            <div>{billedDisplay}</div>
          </div>
          <div>
            <span className="ds-label">Customs code (HS)</span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="mono">{sc.hs_code ?? '—'}</span>
              {sc.hs_verified && <DsBadge tone="ok">Checked</DsBadge>}
            </div>
          </div>
          <div>
            <span className="ds-label">Country of origin</span>
            <div>{originName}</div>
          </div>
          <div>
            <span className="ds-label">Battery</span>
            <div>{sc.has_battery ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <span className="ds-label">Liquid</span>
            <div>{sc.has_liquid ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <span className="ds-label">Magnet</span>
            <div>{sc.has_magnet ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <span className="ds-label">Powder</span>
            <div>{sc.has_powder ? 'Yes' : 'No'}</div>
          </div>
        </div>

        <p className="mt-3.5 mb-0 text-[13px] flex items-center gap-2 flex-wrap">
          {anyRestricted ? (
            <>
              <DsBadge tone="warn">Restricted-goods routing</DsBadge>
              <span className="ds-mut">
                Only shipping services approved for this item&apos;s flags are shown.
              </span>
            </>
          ) : (
            <>
              <DsBadge tone="ok">All shipping services available</DsBadge>
              <span className="ds-mut">
                Products with a battery, liquid, magnet or powder show only the services that can carry them.
              </span>
            </>
          )}
        </p>
      </DsCard>

      {/* Description & Specifications (if present) */}
      {(p.description || specEntries.length > 0) && (
        <DsCard title="Product description and specifications" icon="file">
          {p.description && (
            <p className="m-0 text-[14px] leading-relaxed text-[#1A174A] whitespace-pre-line">
              {p.description}
            </p>
          )}
          {specEntries.length > 0 && (
            <dl className="mt-3 mb-0 grid gap-2 sm:grid-cols-2 text-[13.5px]">
              {specEntries.map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-2 py-1.5 border-b border-[#EEF0F4]"
                >
                  <dt className="ds-mut">{k}</dt>
                  <dd className="m-0 font-medium text-[#1A174A] text-right">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </DsCard>
      )}
    </div>
  );
}
