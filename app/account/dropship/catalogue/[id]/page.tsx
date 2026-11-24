import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { COUNTRY_NAMES } from '@/lib/format';
import {
  getDropshipCountries,
  getDropshipProduct,
  dropshipSettings,
  importList,
  pickRoute,
  days,
  STOCK_LABEL,
} from '@/lib/dropship';
import { VerifiedBadge, Pill, Icon } from '@/components/ds';
import { CountrySelect, DropshipBuyBox } from '@/components/account/dropship/client';
import { BRAND_START_HREF } from '@/components/store/make-my-brand/content';
import { addToImportList, removeFromImportList } from '../../actions';

export const metadata = { title: 'Dropshipping product' };
const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const UUID = /^[0-9a-f-]{36}$/i;

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
        <div aria-busy="true" aria-label="Loading" className="grid gap-5 lg:grid-cols-2">
          <div className="card aspect-square" />
          <div className="card h-[320px]" />
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
  const s = await requireCustomer('/account/dropship/catalogue');
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

  const countryName = COUNTRY_NAMES[country] ?? country;
  const countryOpts = countries
    .map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));
  const fastest = pickRoute(p.routes);
  const cheapest = [...p.routes].sort((a, b) => a.landed_price_cents - b.landed_price_cents)[0];
  const images = p.images;
  const [stockText, stockTone] = STOCK_LABEL[p.stock_status];
  const specEntries = Object.entries(p.specs ?? {});
  const dims = p.dimensions_cm;

  return (
    <div data-testid="dropship-product">
      <nav aria-label="Breadcrumb" className="text-[13.5px]">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/account/dropship" className="text-coral-text font-medium">
              Dropshipping
            </Link>
          </li>
          <li aria-hidden className="text-muted">
            ›
          </li>
          <li>
            <Link
              href={`/account/dropship/catalogue?country=${country}`}
              className="text-coral-text font-medium"
            >
              Catalogue
            </Link>
          </li>
          <li aria-hidden className="text-muted">
            ›
          </li>
          <li aria-current="page" className="text-black line-clamp-1">
            {p.title}
          </li>
        </ol>
      </nav>

      <div className="mt-4">
        {(() => {
          const gallery = (
            <section className="card p-3 sm:p-4" aria-label="Photos">
              <div className="relative aspect-square rounded-[10px] overflow-hidden bg-pearl">
                {images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={images[0]}
                    alt={p.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted gap-2">
                    <Icon name="box" size={32} />
                    Photo coming
                  </div>
                )}
              </div>
              {images.length > 1 && (
                <ul className="mt-3 grid grid-cols-3 gap-3">
                  {images.slice(1, 4).map((src, i) => (
                    <li
                      key={src}
                      className="relative aspect-square rounded-[8px] overflow-hidden bg-pearl border border-line"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={`${p.title} — photo ${i + 2}`}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2.5 text-[12.5px] text-muted">
                {images.length
                  ? `Photo 1 of ${images.length} · all photos go to your store`
                  : 'Photos are added before the product goes to your store'}
              </p>
            </section>
          );

          const info = (
            <>
              <div>
                {p.category && <div className="k !text-coral-text">{p.category}</div>}
                <h1 className="mt-1 text-[24px] sm:text-[30px] font-extrabold leading-[1.15]">
                  {p.title}
                </h1>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <VerifiedBadge />
                  <span className={`pill ${stockTone}`} data-testid="product-stock-status">
                    {stockText}
                  </span>
                  <Pill tone="neutral">Model {p.model_no}</Pill>
                  <Pill tone="neutral">MOQ {p.min_order_qty}</Pill>
                </div>
              </div>

              <div className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="detail-country" className="k">
                    Delivering to a customer in
                  </label>
                  <div className="w-56">
                    <CountrySelect
                      id="detail-country"
                      value={country}
                      options={countryOpts}
                    />
                  </div>
                </div>
                {fastest && cheapest && (
                  <p className="mt-3 text-[14.5px]">
                    Landed price from <b>{usd(cheapest.landed_price_cents)}</b> (includes shipping and duties to {countryName}) · Fastest delivery <b>{days(fastest)}</b>
                  </p>
                )}
              </div>
            </>
          );

          return (
            <DropshipBuyBox
              gallery={gallery}
              info={info}
              productId={p.product_id}
              routes={p.routes}
              variants={p.variants}
              productStockStatus={p.stock_status}
              markup={cfg.markup}
              demo={cfg.demo}
              countryName={countryName}
              added={list.has(p.product_id)}
              addAction={addToImportList}
              removeAction={removeFromImportList}
            />
          );
        })()}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section className="card p-5" aria-labelledby="copy-h">
          <h2 id="copy-h" className="text-[17px] font-bold">
            Product description &amp; specs
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            White-label copy ready for your store.
          </p>
          <div className="mt-3 space-y-3 text-[14px]">
            <div>
              <div className="k">Title</div>
              <div className="mt-0.5 font-semibold">{p.title}</div>
            </div>
            {p.description && (
              <div>
                <div className="k">Description</div>
                <p className="mt-0.5 text-muted whitespace-pre-line">{p.description}</p>
              </div>
            )}
            {specEntries.length > 0 && (
              <div>
                <div className="k">Specifications</div>
                <dl className="mt-1 space-y-1 text-[13.5px]">
                  {specEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-muted">{k}</dt>
                      <dd className="font-medium text-right">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </section>

        <section className="card p-5" aria-labelledby="pack-h">
          <h2 id="pack-h" className="text-[17px] font-bold">
            Weight, dimensions &amp; packing
          </h2>
          <dl className="mt-3 space-y-2 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Shipping weight</dt>
              <dd className="font-medium tabular-nums">{p.weight_g} g</dd>
            </div>
            {dims && (dims.l || dims.w || dims.h) && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Dimensions</dt>
                <dd className="font-medium tabular-nums">
                  {[dims.l, dims.w, dims.h].filter(Boolean).join(' × ')} cm
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Minimum order</dt>
              <dd className="font-medium tabular-nums">
                {p.min_order_qty} {p.min_order_qty === 1 ? 'unit' : 'units'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Packaging</dt>
              <dd className="font-medium text-right">
                Plain outer box with your packing slip
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Supplier branding</dt>
              <dd className="font-medium text-right">
                None — supplier and Octopus never appear
              </dd>
            </div>
          </dl>
        </section>

        <section
          className="card p-5 flex flex-col"
          aria-labelledby="brand-h"
          data-testid="make-it-your-brand"
        >
          <div className="k !text-coral-text">Make My Brand</div>
          <h2 id="brand-h" className="mt-1 text-[17px] font-bold">
            Selling well? Put your own brand on it
          </h2>
          <p className="mt-2 text-[14px] text-muted flex-1">
            Once a product sells steadily in your store, order a run with your logo, retail box and insert card. We store the branded stock and keep fulfilling each order from it.
          </p>
          <Link
            href={`${BRAND_START_HREF}&product=${p.product_id}`}
            className="btn btn-ghost mt-4 self-start"
          >
            Start Make My Brand with this product →
          </Link>
        </section>
      </div>
    </div>
  );
}
