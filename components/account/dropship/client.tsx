'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ShippingTypePill, ExamplePill, Icon, STORE_SOON } from '@/components/ds';
import type {
  CatalogueRoute,
  CatalogueVariant,
  ShipType,
  StockStatus,
} from '@/lib/dropship';

const SHIP_LABEL: Record<ShipType, string> = {
  express: 'Express',
  standard: 'Standard',
  economy: 'Economy',
};

const STOCK_LABEL: Record<StockStatus, [string, string]> = {
  in_stock: ['In stock', 'bg-ok-bg text-ok'],
  low: ['Low stock', 'bg-warn-bg text-warn'],
  out: ['Out of stock', 'bg-bad-bg text-bad'],
  extended: ['Extended', 'bg-tint text-ink'],
};

const days = (r: Pick<CatalogueRoute, 'est_days_min' | 'est_days_max'>) =>
  `${r.est_days_min}–${r.est_days_max} days`;

const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Strict string-to-integer-cents parser (no floating point Number(...) * 100). */
function parsePriceCents(raw: string): number {
  const s = raw.trim();
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function formatCentsInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = Math.abs(cents % 100);
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

/** Submit button with a pending state (import list add / remove). */
export function ImportButton({ added, className = '' }: { added: boolean; className?: string }) {
  const { pending } = useFormStatus();
  return added ? (
    <button
      type="submit"
      disabled={pending}
      className={`btn btn-ghost w-full ${className}`}
      data-testid="import-added"
      aria-label="Added to import list. Select to remove."
    >
      {pending ? (
        'Removing…'
      ) : (
        <>
          Added <Icon name="check" size={16} />
        </>
      )}
    </button>
  ) : (
    <button
      type="submit"
      disabled={pending}
      className={`btn btn-primary w-full ${className}`}
      data-testid="import-add"
    >
      {pending ? 'Adding…' : 'Add to import list'}
    </button>
  );
}

/** "Customers in" select that reloads the page with ?country=. */
export function CountrySelect({
  value,
  options,
  id = 'country',
}: {
  value: string;
  options: [string, string][];
  id?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <select
      id={id}
      name="country"
      className="input"
      value={value}
      data-testid="country-select"
      onChange={(e) => {
        const p = new URLSearchParams(sp?.toString());
        p.set('country', e.target.value);
        p.delete('page');
        router.push(`${path}?${p.toString()}`);
      }}
    >
      {options.map(([code, name]) => (
        <option key={code} value={code}>
          {name}
        </option>
      ))}
    </select>
  );
}

function variantLabel(v: CatalogueVariant) {
  const entries = Object.entries(v.options ?? {});
  return entries.length ? entries.map(([, val]) => val).join(' / ') : v.model_no;
}

/** Product detail buy box: variant selector + stock status, route selector (method only, never carrier), and live "Your price" box. */
export function DropshipBuyBox({
  gallery,
  info,
  productId,
  routes,
  variants,
  productStockStatus,
  markup,
  demo,
  countryName,
  added,
  addAction,
  removeAction,
}: {
  gallery: React.ReactNode;
  info: React.ReactNode;
  productId: string;
  routes: CatalogueRoute[];
  variants: CatalogueVariant[];
  productStockStatus: StockStatus;
  markup: number | null;
  demo: boolean;
  countryName: string;
  added: boolean;
  addAction: (fd: FormData) => Promise<void>;
  removeAction: (fd: FormData) => Promise<void>;
}) {
  const [variantId, setVariant] = useState(variants[0]?.id ?? '');
  const variant = variants.find((v) => v.id === variantId) ?? null;
  const stockStatus: StockStatus = variant ? variant.stock_status : productStockStatus;
  const priceAdjust = variant ? variant.price_adjust_cents : 0;

  const [ship, setShip] = useState<ShipType>(routes[0]?.shipping_method ?? 'express');
  const route = routes.find((r) => r.shipping_method === ship) ?? routes[0] ?? null;
  const landedCents = route ? route.landed_price_cents + priceAdjust : 0;

  const sugg =
    route && markup
      ? Math.max(99, Math.ceil((landedCents * markup) / 100) * 100 - 1)
      : null;

  const [price, setPrice] = useState(sugg ? formatCentsInput(sugg) : '');
  const priceCents = parsePriceCents(price);
  const pr = useMemo(
    () =>
      route && priceCents > 0
        ? {
            c: priceCents - landedCents,
            pct: Math.round(((priceCents - landedCents) / priceCents) * 100),
          }
        : null,
    [route, priceCents, landedCents],
  );
  const [edited, setEdited] = useState(false);

  const chooseRoute = (t: ShipType) => {
    setShip(t);
    const rt = routes.find((x) => x.shipping_method === t);
    if (!edited && rt && markup) {
      const lc = rt.landed_price_cents + priceAdjust;
      setPrice(formatCentsInput(Math.max(99, Math.ceil((lc * markup) / 100) * 100 - 1)));
    }
  };

  const chooseVariant = (vid: string) => {
    setVariant(vid);
    const v = variants.find((x) => x.id === vid);
    const adj = v ? v.price_adjust_cents : 0;
    if (!edited && route && markup) {
      const lc = route.landed_price_cents + adj;
      setPrice(formatCentsInput(Math.max(99, Math.ceil((lc * markup) / 100) * 100 - 1)));
    }
  };

  const [push, setPush] = useState(false);
  const outOfStock = stockStatus === 'out';
  const [stockText, stockTone] = STOCK_LABEL[stockStatus];

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2 items-start">
        {gallery}
        <div className="space-y-4">
          {info}
          {variants.length > 0 && (
            <div className="card p-4 sm:p-5" data-testid="variants">
              <div className="flex items-center justify-between gap-2">
                <div className="k">Variant</div>
                <span className={`pill ${stockTone}`} data-testid="variant-stock-status">
                  {stockText}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Variant">
                {variants.map((v) => {
                  const on = v.id === variantId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => chooseVariant(v.id)}
                      className={`inline-flex items-center gap-2 min-h-11 px-3.5 rounded-full border text-[14px] font-medium ${
                        on
                          ? 'bg-ink text-white border-ink'
                          : 'border-line-strong bg-white hover:border-ink'
                      }`}
                    >
                      {variantLabel(v)}
                      {v.price_adjust_cents !== 0 && (
                        <span className="mono text-[11.5px] opacity-80">
                          {v.price_adjust_cents > 0 ? `+${usd(v.price_adjust_cents)}` : usd(v.price_adjust_cents)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {variant && (
                <p className="mt-2.5 text-[13px] text-muted">
                  Model <span className="mono">{variant.model_no}</span> · {stockText}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px] items-start">
        <section className="card overflow-hidden" aria-labelledby="cost-h" data-testid="cost-table">
          <div className="px-5 pt-4 pb-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="cost-h" className="text-[17px] font-bold">
                Shipping and landed price to {countryName}
              </h2>
              <p className="text-[13px] text-muted">
                Includes shipping and duties to {countryName}
              </p>
            </div>
            {demo && <ExamplePill />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="th !py-2.5">Method</th>
                  <th className="th !py-2.5">Includes</th>
                  <th className="th !py-2.5 text-right">Landed price</th>
                  <th className="th !py-2.5">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((rt) => {
                  const on = rt.shipping_method === route?.shipping_method;
                  const lc = rt.landed_price_cents + priceAdjust;
                  return (
                    <tr
                      key={rt.shipping_method}
                      onClick={() => chooseRoute(rt.shipping_method)}
                      className={`border-b border-line cursor-pointer ${
                        on ? 'bg-tint' : 'hover:bg-pearl'
                      }`}
                    >
                      <td className="td !py-3">
                        <label className="inline-flex items-center gap-2.5 cursor-pointer font-semibold">
                          <input
                            type="radio"
                            name="ship"
                            checked={on}
                            onChange={() => chooseRoute(rt.shipping_method)}
                            className="accent-ink w-4 h-4"
                          />
                          <ShippingTypePill type={rt.shipping_method} />
                        </label>
                      </td>
                      <td className="td !py-3 text-muted">
                        Includes shipping and duties to {countryName}
                        {outOfStock && (
                          <span className="block text-bad text-[12.5px]">
                            Out of stock
                          </span>
                        )}
                      </td>
                      <td className="td !py-3 text-right tabular-nums whitespace-nowrap font-bold">
                        {usd(lc)}
                      </td>
                      <td className="td !py-3 whitespace-nowrap">{days(rt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3.5 text-[13px] text-muted">
            Parcels are packed in plain unbranded packaging with your seller return address. Charged from your US dollar wallet when each order comes in.
          </p>
        </section>

        <section
          className="rounded-[14px] bg-white border-2 border-ink p-5"
          aria-labelledby="price-h"
          data-testid="price-box"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="price-h" className="text-[17px] font-bold">
              Your price
            </h2>
            {demo && <ExamplePill />}
          </div>
          {route && (
            <dl className="mt-3 space-y-1.5 text-[14px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">
                  Your cost · {SHIP_LABEL[route.shipping_method]}
                </dt>
                <dd className="font-semibold tabular-nums" data-testid="landed-cost">
                  {usd(landedCents)}
                </dd>
              </div>
              <div className="text-[12.5px] text-muted">
                Includes shipping and duties to {countryName}
              </div>
              <div className="flex justify-between gap-2 pt-1">
                <dt className="text-muted">Suggested retail</dt>
                <dd className="font-semibold tabular-nums">
                  {sugg ? usd(sugg) : 'No pricing rule yet'}
                </dd>
              </div>
            </dl>
          )}
          {markup && (
            <p className="mt-1.5 text-[12.5px] text-muted">
              Your pricing rule: cost × {markup}, rounded up to end in .99.
            </p>
          )}
          <label htmlFor="sell" className="k block mt-4">
            Your selling price (US$)
          </label>
          <input
            id="sell"
            inputMode="decimal"
            className="input mt-1.5 !text-[17px] font-semibold tabular-nums"
            value={price}
            onChange={(e) => {
              setEdited(true);
              setPrice(e.target.value.replace(/[^0-9.]/g, ''));
            }}
            data-testid="sell-price"
          />
          <div
            className="mt-3 rounded-[10px] bg-pearl border border-line p-3.5 grid grid-cols-2 gap-3"
            aria-live="polite"
          >
            <div>
              <div className="k">Profit per order</div>
              <div
                className={`mt-1 text-[22px] font-extrabold tabular-nums ${
                  pr && pr.c < 0 ? 'text-bad' : 'text-ok'
                }`}
                data-testid="profit"
              >
                {pr ? usd(pr.c) : '—'}
              </div>
            </div>
            <div>
              <div className="k">Margin</div>
              <div
                className={`mt-1 text-[22px] font-extrabold tabular-nums ${
                  pr && pr.c < 0 ? 'text-bad' : 'text-ok'
                }`}
                data-testid="margin"
              >
                {pr ? `${pr.pct}%` : '—'}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            Before your store&apos;s channel and payment fees.
          </p>
          <div className="mt-4 space-y-2.5">
            <form action={added ? removeAction : addAction}>
              <input type="hidden" name="product_id" value={productId} />
              <input type="hidden" name="variant_id" value={variantId} />
              <input type="hidden" name="service" value={ship} />
              <input type="hidden" name="price_cents" value={priceCents > 0 ? String(priceCents) : ''} />
              <input type="hidden" name="price" value={price} />
              {outOfStock && !added ? (
                <button type="button" disabled className="btn btn-primary w-full">
                  Out of stock
                </button>
              ) : (
                <ImportButton added={added} />
              )}
            </form>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                className="btn btn-dark"
                onClick={() => setPush((x) => !x)}
                aria-expanded={push}
              >
                Push to my store
              </button>
              <Link href={`/request/sample?product=${productId}`} className="btn btn-ghost">
                Order a sample
              </Link>
            </div>
            {push && (
              <p
                className="text-[13px] rounded-[10px] bg-warn-bg text-warn px-3 py-2.5"
                data-testid="push-soon"
              >
                {STORE_SOON} No store is connected to your account yet.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

/** Phone: filters collapse behind a [Filters] button; desktop: always shown. */
export function FilterToggle({ on, children }: { on: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button
        type="button"
        className="btn btn-ghost w-full md:hidden"
        aria-expanded={open}
        aria-controls="catalogue-filter-panel"
        onClick={() => setOpen((x) => !x)}
      >
        <Icon name="search" size={18} />
        Filters{on ? ' (on)' : ''}
      </button>
      <div
        id="catalogue-filter-panel"
        className={`${open ? 'block mt-3' : 'hidden'} md:block md:mt-0`}
      >
        {children}
      </div>
    </div>
  );
}
