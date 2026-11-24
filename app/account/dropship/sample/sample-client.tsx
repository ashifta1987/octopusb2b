'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsIcon,
  DsLinkButton,
  DsNotice,
  DsTimeline,
} from '@/components/dropship-ui';
import type {
  CatalogueRoute,
  CatalogueVariant,
  DropshipOrderQuoteResult,
  DropshipSampleOrderRow,
  ShipType,
} from '@/lib/dropship';
import {
  addToImportList,
  quoteDropshipSampleAction,
  submitDropshipSampleOrderAction,
} from '../actions';

const usdShort = (c: number) =>
  `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SHIP_LABELS: Record<ShipType, string> = {
  express: 'Express',
  standard: 'Standard',
  economy: 'Economy',
};

export type SampleProductOption = {
  productId: string;
  modelNo: string;
  title: string;
  variants: CatalogueVariant[];
  allCountryRoutes: CatalogueRoute[];
};

export function SampleOrderClient({
  products,
  initialProductId,
  initialVariantId,
  initialCountry,
  initialMethod,
  initialQuote,
  walletCashCents,
  defaultFullName,
  defaultPhone,
  defaultAddress,
  defaultCity,
  countryOptions,
  recentSamples,
  inImportList,
}: {
  products: SampleProductOption[];
  initialProductId: string;
  initialVariantId: string;
  initialCountry: string;
  initialMethod: ShipType;
  initialQuote: DropshipOrderQuoteResult | null;
  walletCashCents: number;
  defaultFullName: string;
  defaultPhone: string;
  defaultAddress: string;
  defaultCity: string;
  countryOptions: [string, string][];
  recentSamples: DropshipSampleOrderRow[];
  inImportList: boolean;
}) {
  const router = useRouter();
  const [isQuoting, startQuote] = useTransition();
  const [isPaying, startPay] = useTransition();

  const [productId, setProductId] = useState(initialProductId);
  const currentProduct = products.find((p) => p.productId === productId) ?? products[0] ?? null;

  const [variantId, setVariantId] = useState(initialVariantId);
  const [qty, setQty] = useState<number>(1);
  const [country, setCountry] = useState(initialCountry);
  const [method, setMethod] = useState<ShipType>(initialMethod);

  const [fullName, setFullName] = useState(defaultFullName);
  const [phone, setPhone] = useState(defaultPhone);
  const [address, setAddress] = useState(defaultAddress);
  const [city, setCity] = useState(defaultCity);

  const [quote, setQuote] = useState<DropshipOrderQuoteResult | null>(initialQuote);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<{
    orderNumber: string;
    totalCents: number;
    merchantStatus: string;
  } | null>(null);

  const currentRoute =
    currentProduct?.allCountryRoutes.find(
      (r) => r.destination_country === country && r.shipping_method === method,
    ) ?? null;

  function refreshQuote(next: {
    prodId: string;
    varId: string;
    q: number;
    ctry: string;
    mth: ShipType;
  }) {
    setSubmitErr(null);
    const prod = products.find((p) => p.productId === next.prodId);
    const rt = prod?.allCountryRoutes.find(
      (r) => r.destination_country === next.ctry && r.shipping_method === next.mth,
    );
    const incoterm = rt?.incoterm ?? 'DDP';

    startQuote(async () => {
      const q = await quoteDropshipSampleAction({
        variantId: next.varId,
        qty: next.q,
        country: next.ctry,
        method: next.mth,
        incoterm,
      });
      setQuote(q);
    });
  }

  // Determine exact blocking states (Correction 4)
  const routeMissing = Boolean(quote && !quote.ok);
  const ddpDutyUnknown = Boolean(
    quote?.ok &&
      (quote.incoterm ?? 'DDP') === 'DDP' &&
      (quote.duties_status === 'not_known_yet' ||
        quote.duties_cents == null ||
        quote.total_cents == null),
  );
  const totalCents = !ddpDutyUnknown && quote?.ok ? (quote.total_cents ?? null) : null;
  const walletShort = totalCents != null && walletCashCents < totalCents;
  const shortfallCents = totalCents != null ? Math.max(0, totalCents - walletCashCents) : 0;

  const missingAddress = !fullName.trim() || !address.trim() || !city.trim();
  const canPay = Boolean(
    quote?.ok &&
      !ddpDutyUnknown &&
      totalCents != null &&
      !walletShort &&
      !missingAddress &&
      !isPaying &&
      !isQuoting,
  );

  const disabledReason = (() => {
    if (ddpDutyUnknown) {
      return "Duties for this country aren't set yet, choose another country or method";
    }
    if (routeMissing) {
      return quote?.message ?? 'No active shipping route for this country and method.';
    }
    if (walletShort) {
      return `You have ${usdShort(walletCashCents)}. Add at least ${usdShort(shortfallCents)} to order this sample.`;
    }
    if (missingAddress) {
      return 'Fill in recipient name, street address and city.';
    }
    return undefined;
  })();

  function handlePay() {
    if (!canPay || !variantId) return;
    setSubmitErr(null);
    const idem = `sample_${crypto.randomUUID()}`;
    const incoterm = currentRoute?.incoterm ?? quote?.incoterm ?? 'DDP';

    startPay(async () => {
      const res = await submitDropshipSampleOrderAction({
        variantId,
        qty,
        destinationCountry: country,
        shippingMethod: method,
        incoterm,
        buyerName: fullName,
        buyerPhone: phone,
        addressLine1: address,
        city,
        idempotencyKey: idem,
      });
      if (!res.ok) {
        setSubmitErr(res.error);
        return;
      }
      setPlacedOrder({
        orderNumber: res.orderNumber,
        totalCents: res.totalCents,
        merchantStatus: res.merchantStatus,
      });
      router.refresh();
    });
  }

  // Timeline state from placedOrder or latest sample order for this product
  const latestSampleForProd =
    recentSamples.find((s) => s.product_id === productId) ?? recentSamples[0] ?? null;
  const activeStage = placedOrder?.merchantStatus ?? latestSampleForProd?.merchant_status ?? null;

  const timelineEvents = (() => {
    if (!activeStage) {
      return [
        { title: 'Ordered', state: 'upcoming' as const },
        { title: 'Packed', state: 'upcoming' as const },
        { title: 'Shipped', detail: 'Tracking in Orders', state: 'upcoming' as const },
        { title: 'Delivered', state: 'upcoming' as const },
      ];
    }
    const isDelivered = activeStage === 'delivered';
    const isShipped = activeStage === 'shipped' || isDelivered;
    return [
      {
        title: 'Ordered',
        detail: placedOrder
          ? `Sample order ${placedOrder.orderNumber}`
          : latestSampleForProd
            ? `Sample order ${latestSampleForProd.order_number}`
            : undefined,
        state: 'done' as const,
      },
      {
        title: 'Packed',
        state: isShipped ? ('done' as const) : ('current' as const),
      },
      {
        title: 'Shipped',
        detail: latestSampleForProd?.tracking_no
          ? `Tracking ${latestSampleForProd.tracking_no}`
          : 'Tracking in Orders',
        state: isDelivered ? ('done' as const) : isShipped ? ('current' as const) : ('upcoming' as const),
      },
      {
        title: 'Delivered',
        state: isDelivered ? ('done' as const) : ('upcoming' as const),
      },
    ];
  })();

  const optionKeyName = (() => {
    const firstOpts = currentProduct?.variants[0]?.options;
    if (!firstOpts) return 'Variant';
    return Object.keys(firstOpts)[0] || 'Variant';
  })();

  return (
    <div className="flex flex-col gap-5">
      {placedOrder && (
        <DsNotice tone="ok" title="Sample order paid" testId="sample-order-paid-notice">
          Order <strong className="mono">{placedOrder.orderNumber}</strong> ({usdShort(placedOrder.totalCents)} paid from your wallet) is queued for packing.
        </DsNotice>
      )}
      {submitErr && (
        <DsNotice tone="bad" title="Could not place sample order" testId="sample-order-error">
          {submitErr}
        </DsNotice>
      )}

      <div className="flex gap-4 flex-wrap items-start">
        {/* Left: Sample Form */}
        <div className="flex-[2_1_520px] min-w-0">
          <DsCard
            title={
              currentProduct
                ? `${currentProduct.title} · ${currentProduct.modelNo}`
                : 'Choose a product'
            }
            testId="sample-form-card"
          >
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              {products.length > 1 && (
                <div className="sm:col-span-2">
                  <label className="ds-label" htmlFor="sample-product">
                    Product
                  </label>
                  <select
                    id="sample-product"
                    data-testid="sample-product-select"
                    className="ds-input w-full"
                    value={productId}
                    onChange={(e) => {
                      const nextProdId = e.target.value;
                      const nextProd = products.find((p) => p.productId === nextProdId);
                      const nextVar =
                        nextProd?.variants.find((v) => v.stock_status !== 'out') ??
                        nextProd?.variants[0];
                      const nextVarId = nextVar?.id ?? '';
                      const avail =
                        nextProd?.allCountryRoutes
                          .filter((r) => r.destination_country === country)
                          .map((r) => r.shipping_method) ?? [];
                      const nextMethod: ShipType = avail.includes(method)
                        ? method
                        : avail[0] ?? 'express';
                      setProductId(nextProdId);
                      setVariantId(nextVarId);
                      setMethod(nextMethod);
                      router.replace(
                        `/account/dropship/sample?product=${nextProdId}&country=${country}`,
                        { scroll: false },
                      );
                      if (nextVarId) {
                        refreshQuote({
                          prodId: nextProdId,
                          varId: nextVarId,
                          q: qty,
                          ctry: country,
                          mth: nextMethod,
                        });
                      }
                    }}
                  >
                    {products.map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.title} · {p.modelNo}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="ds-label" htmlFor="sample-variant">
                  {optionKeyName}
                </label>
                <select
                  id="sample-variant"
                  data-testid="sample-variant-select"
                  className="ds-input w-full"
                  value={variantId}
                  onChange={(e) => {
                    const nextVarId = e.target.value;
                    setVariantId(nextVarId);
                    refreshQuote({
                      prodId: productId,
                      varId: nextVarId,
                      q: qty,
                      ctry: country,
                      mth: method,
                    });
                  }}
                >
                  {(currentProduct?.variants ?? []).map((v) => {
                    const label = Object.values(v.options ?? {}).join(' / ') || v.model_no;
                    const out = v.stock_status === 'out';
                    return (
                      <option key={v.id} value={v.id} disabled={out}>
                        {label}
                        {out ? ' (out of stock)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="ds-label" htmlFor="sample-qty">
                  Quantity
                </label>
                <select
                  id="sample-qty"
                  data-testid="sample-qty-select"
                  className="ds-input w-full"
                  value={String(qty)}
                  onChange={(e) => {
                    const nextQty = Math.min(3, Math.max(1, Number(e.target.value) || 1));
                    setQty(nextQty);
                    if (variantId) {
                      refreshQuote({
                        prodId: productId,
                        varId: variantId,
                        q: nextQty,
                        ctry: country,
                        mth: method,
                      });
                    }
                  }}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
                <p className="ds-mut mt-1.5 mb-0 text-[12px]">Up to 3 per product</p>
              </div>
            </div>

            <h3 className="mt-5 mb-2.5 text-[15px] font-bold text-[#1A174A]">Ship to</h3>
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <div>
                <label className="ds-label" htmlFor="sample-name">
                  Full name
                </label>
                <input
                  id="sample-name"
                  data-testid="sample-name-input"
                  className="ds-input w-full"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Recipient full name"
                />
              </div>

              <div>
                <label className="ds-label" htmlFor="sample-phone">
                  Phone
                </label>
                <input
                  id="sample-phone"
                  data-testid="sample-phone-input"
                  className="ds-input w-full"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+971 …"
                />
              </div>

              <div>
                <label className="ds-label" htmlFor="sample-address">
                  Address
                </label>
                <input
                  id="sample-address"
                  data-testid="sample-address-input"
                  className="ds-input w-full"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address, building, unit"
                />
              </div>

              <div>
                <label className="ds-label" htmlFor="sample-city">
                  City
                </label>
                <input
                  id="sample-city"
                  data-testid="sample-city-input"
                  className="ds-input w-full"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Dubai"
                />
              </div>

              <div>
                <label className="ds-label" htmlFor="sample-country">
                  Country
                </label>
                <select
                  id="sample-country"
                  data-testid="sample-country-select"
                  className="ds-input w-full"
                  value={country}
                  onChange={(e) => {
                    const nextCountry = e.target.value;
                    const avail =
                      currentProduct?.allCountryRoutes
                        .filter((r) => r.destination_country === nextCountry)
                        .map((r) => r.shipping_method) ?? [];
                    const nextMethod: ShipType = avail.includes(method)
                      ? method
                      : avail[0] ?? method;
                    setCountry(nextCountry);
                    setMethod(nextMethod);
                    if (variantId) {
                      refreshQuote({
                        prodId: productId,
                        varId: variantId,
                        q: qty,
                        ctry: nextCountry,
                        mth: nextMethod,
                      });
                    }
                  }}
                >
                  {countryOptions.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ds-label" htmlFor="sample-method">
                  Shipping method
                </label>
                <select
                  id="sample-method"
                  data-testid="sample-method-select"
                  className="ds-input w-full"
                  value={method}
                  onChange={(e) => {
                    const nextMethod = e.target.value as ShipType;
                    setMethod(nextMethod);
                    if (variantId) {
                      refreshQuote({
                        prodId: productId,
                        varId: variantId,
                        q: qty,
                        ctry: country,
                        mth: nextMethod,
                      });
                    }
                  }}
                >
                  {(['express', 'standard', 'economy'] as ShipType[]).map((m) => (
                    <option key={m} value={m}>
                      {SHIP_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </DsCard>
        </div>

        {/* Right: Cost & Wallet Cash Card */}
        <div className="flex-[1_1_300px] min-w-0">
          <DsCard title="Cost" icon="chart" testId="sample-cost-card">
            {isQuoting ? (
              <p className="ds-mut m-0 text-[14px]" aria-live="polite">
                Updating sample cost…
              </p>
            ) : (
              <div className="flex flex-col gap-1 text-[14px]">
                <div className="ds-row">
                  <span className="ds-mut">Product</span>
                  <span className="mono" data-testid="sample-product-cents">
                    {quote?.ok && quote.product_cents != null ? usdShort(quote.product_cents) : '—'}
                  </span>
                </div>
                <div className="ds-row">
                  <span className="ds-mut">Processing</span>
                  <span className="mono" data-testid="sample-processing-cents">
                    {quote?.ok && quote.processing_cents != null
                      ? usdShort(quote.processing_cents)
                      : '—'}
                  </span>
                </div>
                <div className="ds-row">
                  <span className="ds-mut">Shipping, {SHIP_LABELS[method]}</span>
                  <span className="mono" data-testid="sample-shipping-cents">
                    {quote?.ok && quote.shipping_cents != null ? usdShort(quote.shipping_cents) : '—'}
                  </span>
                </div>
                <div className="ds-row">
                  <span className="ds-mut">Duties and tax</span>
                  <span className="mono" data-testid="sample-duties-cents">
                    {!quote?.ok
                      ? '—'
                      : quote.incoterm === 'DAP'
                        ? 'Paid by buyer'
                        : ddpDutyUnknown || quote.duties_cents == null
                          ? 'Not set'
                          : usdShort(quote.duties_cents)}
                  </span>
                </div>
                <div className="ds-row font-bold border-t border-[#EEF0F4] pt-2.5 mt-1 text-[#1A174A]">
                  <span className="ds-mut">Total</span>
                  <span className="mono" data-testid="sample-total-cents">
                    {totalCents != null ? usdShort(totalCents) : '—'}
                  </span>
                </div>

                {/* Correction 4: Refuse DDP when duty is unknown */}
                {ddpDutyUnknown && (
                  <div className="mt-3">
                    <DsNotice
                      tone="warn"
                      title="Duties not set yet"
                      testId="sample-duties-missing-notice"
                    >
                      Duties for this country aren&apos;t set yet, choose another country or method
                    </DsNotice>
                  </div>
                )}

                {routeMissing && (
                  <div className="mt-3">
                    <DsNotice tone="warn" title="Route unavailable" testId="sample-route-missing-notice">
                      {quote?.message ?? 'No active shipping route for this country and method.'}
                    </DsNotice>
                  </div>
                )}

                {/* Correction 4: Pure wallet cash balance ONLY (never credit / Pay later) */}
                {!ddpDutyUnknown && !routeMissing && walletShort && totalCents != null && (
                  <div className="mt-3">
                    <DsNotice
                      tone="warn"
                      title="Not enough in your wallet"
                      testId="sample-wallet-short-notice"
                      action={
                        <DsLinkButton
                          href="/account/dropship/wallet"
                          variant="primary"
                          icon="wallet"
                          testId="sample-add-funds-link"
                        >
                          Add funds
                        </DsLinkButton>
                      }
                    >
                      You have {usdShort(walletCashCents)}. Add at least {usdShort(shortfallCents)} to order this sample.
                    </DsNotice>
                  </div>
                )}

                <div className="mt-3">
                  <DsButton
                    variant="primary"
                    icon="dollar"
                    loading={isPaying}
                    disabled={!canPay}
                    disabledReason={!canPay ? disabledReason : undefined}
                    onClick={handlePay}
                    testId="sample-pay-btn"
                    className="w-full justify-center"
                  >
                    {totalCents != null
                      ? `Pay ${usdShort(totalCents)} from wallet`
                      : 'Pay from wallet'}
                  </DsButton>
                </div>

                <p className="ds-mut mt-2 mb-0 text-[12px]">
                  Samples debit available wallet cash only (available cash: {usdShort(walletCashCents)}).
                </p>
              </div>
            )}
          </DsCard>
        </div>
      </div>

      {/* Bottom: After it arrives — SampleOrder.html */}
      <DsCard title="After it arrives" icon="clock" testId="sample-after-arrives">
        <DsTimeline events={timelineEvents} />

        <div className="flex gap-2.5 flex-wrap mt-4">
          {currentProduct && (
            <form action={addToImportList}>
              <input type="hidden" name="product_id" value={currentProduct.productId} />
              {variantId && <input type="hidden" name="variant_id" value={variantId} />}
              <input type="hidden" name="service" value={method} />
              <button
                type="submit"
                disabled={inImportList}
                data-testid="sample-quality-good-btn"
                className="ds-btn ds-btn-secondary"
              >
                <DsIcon name="check" size={16} />
                <span>
                  {inImportList ? 'In your import list' : 'Quality is good: add to import list'}
                </span>
              </button>
            </form>
          )}

          <Link
            href="/account/dropship/support"
            className="ds-btn ds-btn-secondary no-underline"
          >
            <DsIcon name="flag" size={16} />
            <span>Report a problem</span>
          </Link>
        </div>

        {recentSamples.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[#EEF0F4]">
            <div className="text-[12.5px] font-semibold text-[#5B6478] mb-2">
              Your recent sample orders
            </div>
            <div className="flex flex-col gap-1.5 text-[13.5px]">
              {recentSamples.slice(0, 5).map((so) => (
                <div
                  key={so.store_order_id}
                  data-testid="recent-sample-row"
                  className="flex items-center justify-between gap-2 flex-wrap py-1"
                >
                  <span>
                    <strong className="mono">{so.order_number}</strong> · {so.qty} ×{' '}
                    <span className="mono">{so.model_no}</span> ({so.title_snapshot})
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="mono font-semibold">{usdShort(so.total_cents)}</span>
                    <DsBadge tone={so.merchant_status === 'delivered' ? 'ok' : 'info'}>
                      {so.merchant_status}
                    </DsBadge>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DsCard>
    </div>
  );
}
