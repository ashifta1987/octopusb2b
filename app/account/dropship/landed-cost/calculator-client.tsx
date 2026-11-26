'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  DsBadge,
  DsCard,
  DsNotice,
  DsTableCard,
} from '@/components/dropship-ui';
import type {
  CatalogueRoute,
  CatalogueVariant,
  DropshipOrderQuoteResult,
  ShipType,
} from '@/lib/dropship';
import { calculateMerchantLandedCostAction } from '../actions';
import { money } from '@/lib/format';

// Batch 3 (F-16): same US$ format as the rest of the platform (money() → \"US$ 18.00\")
const usdShort = (c: number) => money(c, 'USD');

const SHIP_LABELS: Record<ShipType, string> = {
  express: 'Express',
  standard: 'Standard',
  economy: 'Economy',
};

function parseUsdInputCents(raw: string): number {
  const clean = raw.replace(/^\s*(?:US\$|\$)\s*/i, '').trim();
  const m = clean.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export type CalculatorProductOption = {
  productId: string;
  modelNo: string;
  title: string;
  variants: CatalogueVariant[];
  allCountryRoutes: CatalogueRoute[];
};

export function LandedCostCalculatorClient({
  products,
  initialProductId,
  initialCountry,
  initialMethod,
  initialQty,
  initialSellUsd,
  initialQuote,
  initialSeparateTotalCents,
  initialSavingsCents,
  countryNames,
  merchantCountries,
}: {
  products: CalculatorProductOption[];
  initialProductId: string;
  initialCountry: string;
  initialMethod: ShipType;
  initialQty: number;
  initialSellUsd: string;
  initialQuote: DropshipOrderQuoteResult | null;
  initialSeparateTotalCents: number | null;
  initialSavingsCents: number | null;
  countryNames: Record<string, string>;
  merchantCountries: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [productId, setProductId] = useState(initialProductId);
  const currentProduct = products.find((p) => p.productId === productId) ?? products[0] ?? null;

  const [variantId, setVariantId] = useState<string>(
    currentProduct?.variants[0]?.id ?? '',
  );
  const [country, setCountry] = useState(initialCountry);
  const [method, setMethod] = useState<ShipType>(initialMethod);
  const [qty, setQty] = useState<number>(initialQty);
  const [sellInput, setSellInput] = useState<string>(initialSellUsd);

  const [quote, setQuote] = useState<DropshipOrderQuoteResult | null>(initialQuote);
  const [separateTotalCents, setSeparateTotalCents] = useState<number | null>(
    initialSeparateTotalCents,
  );
  const [savingsCents, setSavingsCents] = useState<number | null>(initialSavingsCents);
  const [calcError, setCalcError] = useState<string | null>(
    initialQuote && !initialQuote.ok ? initialQuote.message ?? null : null,
  );

  const routesForSelectedCountry =
    currentProduct?.allCountryRoutes.filter((r) => r.destination_country === country) ?? [];

  function triggerQuote(next: {
    prodId: string;
    varId: string;
    ctry: string;
    mth: ShipType;
    q: number;
  }) {
    const prod = products.find((p) => p.productId === next.prodId);
    const matchingRoute = prod?.allCountryRoutes.find(
      (r) => r.destination_country === next.ctry && r.shipping_method === next.mth,
    );
    const incoterm = matchingRoute?.incoterm ?? 'DDP';

    startTransition(async () => {
      const res = await calculateMerchantLandedCostAction({
        variantId: next.varId,
        qty: next.q,
        country: next.ctry,
        method: next.mth,
        incoterm,
      });
      if (!res.ok || !res.parcelQuote) {
        setQuote(null);
        setSeparateTotalCents(null);
        setSavingsCents(null);
        setCalcError(res.error ?? 'No active shipping route for this country and method.');
      } else {
        setQuote(res.parcelQuote);
        setSeparateTotalCents(res.separateOrdersTotalCents ?? null);
        setSavingsCents(res.savingsCents ?? null);
        setCalcError(null);
      }
    });
  }

  const sellEachCents = parseUsdInputCents(sellInput);
  const totalSalesCents = sellEachCents * qty;
  const landedCents = quote?.total_cents ?? null;
  const profitCents = landedCents != null && sellEachCents > 0 ? totalSalesCents - landedCents : null;
  const marginPct =
    profitCents != null && totalSalesCents > 0
      ? Math.round((profitCents / totalSalesCents) * 100)
      : null;

  const unitProdCents =
    quote?.product_cents != null && qty > 0 ? Math.round(quote.product_cents / qty) : 0;
  const billedKg =
    quote?.billed_weight_g != null ? (quote.billed_weight_g / 1000).toFixed(1) : '0.0';

  // Comparison rows across merchant countries (1 unit)
  const comparisonRows = merchantCountries.map((c) => {
    const cRoutes =
      currentProduct?.allCountryRoutes.filter((r) => r.destination_country === c) ?? [];
    const chosen =
      cRoutes.find((r) => r.shipping_method === method) ??
      cRoutes.find((r) => r.shipping_method === 'standard') ??
      cRoutes[0] ??
      null;
    const known = Boolean(chosen && (chosen.incoterm === 'DAP' || chosen.duties_known));
    const landed1 = chosen && known ? chosen.landed_price_cents : null;
    const margin1 =
      landed1 != null && sellEachCents > 0
        ? Math.round(((sellEachCents - landed1) / sellEachCents) * 100)
        : null;
    return {
      countryCode: c,
      countryName: countryNames[c] ?? c,
      route: chosen,
      known,
      landed1,
      margin1,
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-4 flex-wrap items-start">
        {/* Left: Calculate Form */}
        <div className="flex-1 basis-[420px] min-w-0">
          <DsCard title="Calculate" icon="tag" testId="landed-cost-form">
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <div className="sm:col-span-2">
                <label className="ds-label" htmlFor="lc-product">
                  Product
                </label>
                <select
                  id="lc-product"
                  data-testid="lc-product-select"
                  className="ds-input w-full"
                  value={productId}
                  onChange={(e) => {
                    const nextProdId = e.target.value;
                    const nextProd = products.find((p) => p.productId === nextProdId);
                    const nextVarId = nextProd?.variants[0]?.id ?? '';
                    const availMethods =
                      nextProd?.allCountryRoutes
                        .filter((r) => r.destination_country === country)
                        .map((r) => r.shipping_method) ?? [];
                    const nextMethod: ShipType = availMethods.includes(method)
                      ? method
                      : availMethods[0] ?? 'standard';
                    setProductId(nextProdId);
                    setVariantId(nextVarId);
                    setMethod(nextMethod);
                    router.replace(
                      `/account/dropship/landed-cost?product=${nextProdId}&country=${country}`,
                      { scroll: false },
                    );
                    if (nextVarId) {
                      triggerQuote({
                        prodId: nextProdId,
                        varId: nextVarId,
                        ctry: country,
                        mth: nextMethod,
                        q: qty,
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

              {currentProduct && currentProduct.variants.length > 1 && (
                <div>
                  <label className="ds-label" htmlFor="lc-variant">
                    Variant
                  </label>
                  <select
                    id="lc-variant"
                    className="ds-input w-full"
                    value={variantId}
                    onChange={(e) => {
                      const nextVarId = e.target.value;
                      setVariantId(nextVarId);
                      triggerQuote({
                        prodId: productId,
                        varId: nextVarId,
                        ctry: country,
                        mth: method,
                        q: qty,
                      });
                    }}
                  >
                    {currentProduct.variants.map((v) => {
                      const label = Object.values(v.options ?? {}).join(' / ') || v.model_no;
                      return (
                        <option key={v.id} value={v.id}>
                          {label} · {v.model_no}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div>
                <label className="ds-label" htmlFor="lc-country">
                  Ship to
                </label>
                <select
                  id="lc-country"
                  data-testid="lc-country-select"
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
                      : avail[0] ?? 'standard';
                    setCountry(nextCountry);
                    setMethod(nextMethod);
                    if (variantId) {
                      triggerQuote({
                        prodId: productId,
                        varId: variantId,
                        ctry: nextCountry,
                        mth: nextMethod,
                        q: qty,
                      });
                    }
                  }}
                >
                  {merchantCountries.map((c) => (
                    <option key={c} value={c}>
                      {countryNames[c] ?? c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ds-label" htmlFor="lc-method">
                  Method
                </label>
                <select
                  id="lc-method"
                  data-testid="lc-method-select"
                  className="ds-input w-full"
                  value={method}
                  onChange={(e) => {
                    const nextMethod = e.target.value as ShipType;
                    setMethod(nextMethod);
                    if (variantId) {
                      triggerQuote({
                        prodId: productId,
                        varId: variantId,
                        ctry: country,
                        mth: nextMethod,
                        q: qty,
                      });
                    }
                  }}
                >
                  {(['express', 'standard', 'economy'] as ShipType[]).map((m) => {
                    const rt = routesForSelectedCountry.find((r) => r.shipping_method === m);
                    const label = rt
                      ? `${SHIP_LABELS[m]} · ${rt.est_days_min}–${rt.est_days_max} days`
                      : SHIP_LABELS[m];
                    return (
                      <option key={m} value={m}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="ds-label" htmlFor="lc-qty">
                  Quantity in one order
                </label>
                <select
                  id="lc-qty"
                  data-testid="lc-qty-select"
                  className="ds-input w-full"
                  value={String(qty)}
                  onChange={(e) => {
                    const nextQty = Number(e.target.value) || 1;
                    setQty(nextQty);
                    if (variantId) {
                      triggerQuote({
                        prodId: productId,
                        varId: variantId,
                        ctry: country,
                        mth: method,
                        q: nextQty,
                      });
                    }
                  }}
                >
                  {[1, 2, 3, 5, 10, 25].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ds-label" htmlFor="lc-sell">
                  Your selling price each (USD)
                </label>
                <input
                  id="lc-sell"
                  data-testid="lc-sell-input"
                  className="ds-input w-full mono"
                  value={sellInput}
                  onChange={(e) => setSellInput(e.target.value)}
                  placeholder="34.99"
                />
              </div>
            </div>
          </DsCard>
        </div>

        {/* Right: Result Card */}
        <div className="flex-1 basis-[420px] min-w-0">
          <DsCard
            title={`Result for ${qty} unit${qty === 1 ? '' : 's'}, one parcel`}
            icon="package"
            testId="landed-cost-result"
          >
            {isPending ? (
              <p className="ds-mut m-0 text-[14px]" aria-live="polite">
                Calculating landed cost…
              </p>
            ) : calcError || !quote ? (
              <DsNotice tone="warn" title="No rate for this selection" testId="lc-no-rate">
                {calcError ?? 'Choose another destination country or shipping method.'}
              </DsNotice>
            ) : (
              <div className="flex flex-col gap-1 text-[14px]">
                <div className="ds-row">
                  <span className="ds-mut">
                    Product {qty} × {usdShort(unitProdCents)}
                  </span>
                  <span className="mono" data-testid="lc-product-cents">
                    {usdShort(quote.product_cents ?? 0)}
                  </span>
                </div>
                <div className="ds-row">
                  <span className="ds-mut">
                    Processing: {qty === 1 ? 'first item' : `first + ${qty - 1} extra`}
                  </span>
                  <span className="mono" data-testid="lc-processing-cents">
                    {usdShort(quote.processing_cents ?? 0)}
                  </span>
                </div>
                <div className="ds-row">
                  <span className="ds-mut">Shipping, one parcel ({billedKg} kg billed)</span>
                  <span className="mono" data-testid="lc-shipping-cents">
                    {usdShort(quote.shipping_cents ?? 0)}
                  </span>
                </div>
                <div className="ds-row">
                  <span className="ds-mut">
                    Duties and tax ({quote.incoterm ?? 'DDP'}
                    {quote.incoterm === 'DAP' ? '' : ', est.'})
                  </span>
                  <span className="mono" data-testid="lc-duties-cents">
                    {quote.incoterm === 'DAP'
                      ? 'Paid by buyer'
                      : quote.duties_status === 'not_known_yet' || quote.duties_cents == null
                        ? 'Not set'
                        : usdShort(quote.duties_cents)}
                  </span>
                </div>
                <div className="ds-row font-bold border-t border-divider pt-2.5 mt-1 text-ink">
                  <span>Landed cost</span>
                  <span className="mono" data-testid="lc-total-cents">
                    {landedCents != null ? usdShort(landedCents) : 'Not set'}
                  </span>
                </div>

                {sellEachCents > 0 && (
                  <>
                    <div className="h-2" />
                    <div className="ds-row">
                      <span className="ds-mut">
                        Your sales: {qty} × {usdShort(sellEachCents)}
                      </span>
                      <span className="mono">{usdShort(totalSalesCents)}</span>
                    </div>
                    <div className="ds-row">
                      <span className="ds-mut">Margin after all costs</span>
                      <span>
                        {marginPct != null ? (
                          <DsBadge tone={marginPct >= 15 ? 'ok' : 'warn'} testId="lc-margin-badge">
                            {marginPct}%
                          </DsBadge>
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>
                  </>
                )}

                {qty > 1 &&
                  savingsCents != null &&
                  savingsCents > 0 &&
                  separateTotalCents != null &&
                  landedCents != null && (
                    <div className="mt-3">
                      <DsNotice
                        tone="ok"
                        title={`Combined parcel saves ${usdShort(savingsCents)}`}
                        testId="combined-parcel-savings"
                      >
                        {qty} separate orders would cost {usdShort(separateTotalCents)}. One order
                        with {qty} units costs {usdShort(landedCents)}.
                      </DsNotice>
                    </div>
                  )}
              </div>
            )}
          </DsCard>
        </div>
      </div>

      {/* Same product, other countries (1 unit) */}
      <DsTableCard
        title={`Same product, other countries (1 unit, ${SHIP_LABELS[method]})`}
        icon="globe"
        minWidth={560}
        testId="other-countries-table"
        headers={['Country', 'Landed cost', 'Duties', 'Margin at your price']}
        footer="Countries without an active rate card or tariff schedule stay blank until staff add real rate data."
      >
        {comparisonRows.map((row) => (
          <tr key={row.countryCode}>
            <td>{row.countryName}</td>
            <td className="mono">
              {row.landed1 != null ? usdShort(row.landed1) : '—'}
            </td>
            <td>
              {!row.route ? (
                <DsBadge tone="neutral">No route</DsBadge>
              ) : row.route.incoterm === 'DAP' ? (
                <DsBadge tone="info">Paid by buyer (DAP)</DsBadge>
              ) : row.known ? (
                <DsBadge tone="ok">Included (DDP)</DsBadge>
              ) : (
                <DsBadge tone="warn">Not set</DsBadge>
              )}
            </td>
            <td className="mono">{row.margin1 != null ? `${row.margin1}%` : '—'}</td>
          </tr>
        ))}
      </DsTableCard>
    </div>
  );
}
