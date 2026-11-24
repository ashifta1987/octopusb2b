import { Suspense } from 'react';
import { COUNTRY_NAMES } from '@/lib/format';
import {
  DsCard,
  DsEmptyState,
  DsPageHeader,
  DsSkeleton,
} from '@/components/dropship-ui';
import {
  dropshipSettings,
  getDropshipCatalogue,
  getDropshipCountries,
  getDropshipOrderQuote,
  getDropshipProduct,
  requireDropshipV2Merchant,
  suggested,
  type ShipType,
} from '@/lib/dropship';
import {
  LandedCostCalculatorClient,
  type CalculatorProductOption,
} from './calculator-client';

export const metadata = { title: 'Landed cost calculator · Octopus Dropship' };

type SP = {
  product?: string;
  country?: string;
  method?: string;
  qty?: string;
};

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense
      fallback={
        <div className="ds-card">
          <DsSkeleton immediate />
        </div>
      }
    >
      <LandedCostPage searchParams={searchParams} />
    </Suspense>
  );
}

async function LandedCostPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { session: s } = await requireDropshipV2Merchant('/account/dropship/landed-cost');
  const sp = await searchParams;

  const [cfg, merchantCountries] = await Promise.all([
    dropshipSettings(),
    getDropshipCountries(),
  ]);

  const countries = merchantCountries.map((m) => m.country);
  const countryWithRoutes =
    merchantCountries.find((m) => m.has_active_routes)?.country ?? countries[0] ?? 'AE';
  const selectedCountry =
    sp.country && countries.includes(sp.country.toUpperCase())
      ? sp.country.toUpperCase()
      : cfg.defaultCountry && countries.includes(cfg.defaultCountry)
        ? cfg.defaultCountry
        : s.org?.country && countries.includes(s.org.country)
          ? s.org.country
          : countryWithRoutes;

  // Fetch products across the primary route country so the product picker always has active products
  const { rows } = await getDropshipCatalogue({
    country: countryWithRoutes,
    page: 1,
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <DsPageHeader
          title="Landed cost calculator"
          subtitle="See your real cost and margin before you import, for any country and quantity."
          icon="globe"
        />
        <DsCard>
          <DsEmptyState
            title="No active products yet"
            description="Once products ship to your selling countries, you can compare combined-parcel landed costs here."
            icon="globe"
            actionLabel="Find products"
            actionHref="/account/dropship/catalogue"
            actionIcon="search"
          />
        </DsCard>
      </div>
    );
  }

  const wantedProdId =
    sp.product && rows.some((r) => r.product_id === sp.product)
      ? sp.product
      : rows[0].product_id;

  // Hydrate all_country_routes for every product option in parallel (typically <= 48)
  const details = await Promise.all(
    rows.slice(0, 24).map((r) => getDropshipProduct(r.product_id, countryWithRoutes)),
  );

  const productOptions: CalculatorProductOption[] = rows.slice(0, 24).map((r, i) => {
    const det = details[i];
    return {
      productId: r.product_id,
      modelNo: r.model_no,
      title: r.title,
      variants: det?.variants ?? r.variants,
      allCountryRoutes: det?.all_country_routes ?? r.routes,
    };
  });

  const activeProd =
    productOptions.find((p) => p.productId === wantedProdId) ?? productOptions[0];
  const activeVar = activeProd.variants[0];
  const countryRoutes = activeProd.allCountryRoutes.filter(
    (r) => r.destination_country === selectedCountry,
  );
  const initialMethod: ShipType =
    sp.method && ['express', 'standard', 'economy'].includes(sp.method)
      ? (sp.method as ShipType)
      : countryRoutes.find((r) => r.shipping_method === 'standard')?.shipping_method ??
        countryRoutes[0]?.shipping_method ??
        'express';

  const initialQty = Math.min(25, Math.max(1, Number(sp.qty ?? '2') || 2));
  const initialRoute =
    countryRoutes.find((r) => r.shipping_method === initialMethod) ??
    activeProd.allCountryRoutes[0] ??
    null;

  const [initialQuote, singleUnitQuote] = activeVar
    ? await Promise.all([
        getDropshipOrderQuote({
          variantId: activeVar.id,
          qty: initialQty,
          country: selectedCountry,
          method: initialMethod,
          incoterm: initialRoute?.incoterm ?? 'DDP',
          quoteMode: 'catalogue',
        }),
        initialQty > 1
          ? getDropshipOrderQuote({
              variantId: activeVar.id,
              qty: 1,
              country: selectedCountry,
              method: initialMethod,
              incoterm: initialRoute?.incoterm ?? 'DDP',
              quoteMode: 'catalogue',
            })
          : Promise.resolve(null),
      ])
    : [null, null];

  const separateOrdersTotalCents =
    initialQty > 1 &&
    singleUnitQuote?.ok &&
    singleUnitQuote.total_cents != null &&
    initialQuote?.ok &&
    initialQuote.total_cents != null
      ? singleUnitQuote.total_cents * initialQty
      : null;

  const savingsCents =
    separateOrdersTotalCents != null && initialQuote?.total_cents != null
      ? Math.max(0, separateOrdersTotalCents - initialQuote.total_cents)
      : null;

  const defaultSugg = initialRoute ? suggested(initialRoute.landed_price_cents, cfg.markup) : 3499;
  const initialSellUsd = ((defaultSugg ?? 3499) / 100).toFixed(2);

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-landed-cost-page">
      <DsPageHeader
        title="Landed cost calculator"
        subtitle="See your real cost and margin before you import, for any country and quantity."
        icon="globe"
      />

      <LandedCostCalculatorClient
        products={productOptions}
        initialProductId={activeProd.productId}
        initialCountry={selectedCountry}
        initialMethod={initialMethod}
        initialQty={initialQty}
        initialSellUsd={initialSellUsd}
        initialQuote={initialQuote}
        initialSeparateTotalCents={separateOrdersTotalCents}
        initialSavingsCents={savingsCents}
        countryNames={COUNTRY_NAMES}
        merchantCountries={countries.length > 0 ? countries : ['AE', 'GB', 'US']}
      />
    </div>
  );
}
