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
  importList,
  listMyDropshipSampleOrders,
  requireDropshipV2Merchant,
  type ShipType,
} from '@/lib/dropship';
import { SampleOrderClient, type SampleProductOption } from './sample-client';

export const metadata = { title: 'Order a sample · Octopus Dropship' };

type SP = {
  product?: string;
  variant?: string;
  country?: string;
  method?: string;
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
      <SamplePage searchParams={searchParams} />
    </Suspense>
  );
}

async function SamplePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { session: s, ctx } = await requireDropshipV2Merchant('/account/dropship/sample');
  const sp = await searchParams;

  const [cfg, merchantCountries, impList, recentSamples] = await Promise.all([
    dropshipSettings(),
    getDropshipCountries(),
    importList(s.org!.id),
    listMyDropshipSampleOrders(null),
  ]);

  const merchantCodes = merchantCountries.map((m) => m.country);
  const countryWithRoutes =
    merchantCountries.find((m) => m.has_active_routes)?.country ?? merchantCodes[0] ?? 'AE';

  const allCodes = Array.from(
    new Set([...merchantCodes, ...cfg.supportedCountries]),
  );
  const countryOptions: [string, string][] = allCodes
    .map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const selectedCountry =
    sp.country && allCodes.includes(sp.country.toUpperCase())
      ? sp.country.toUpperCase()
      : cfg.defaultCountry && merchantCodes.includes(cfg.defaultCountry)
        ? cfg.defaultCountry
        : s.org?.country && merchantCodes.includes(s.org.country)
          ? s.org.country
          : countryWithRoutes;

  const { rows } = await getDropshipCatalogue({
    country: countryWithRoutes,
    page: 1,
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-5" data-testid="dropship-sample-page">
        <DsPageHeader
          title="Order a sample"
          subtitle="Check quality yourself before you sell it. Samples ship like any order."
          icon="package"
        />
        <DsCard>
          <DsEmptyState
            title="No active products yet"
            description="Once products ship to your markets, you can order up to 3 samples per product here."
            icon="package"
            actionLabel="Find products"
            actionHref="/account/dropship/catalogue"
            actionIcon="search"
          />
        </DsCard>
      </div>
    );
  }

  const details = await Promise.all(
    rows.slice(0, 24).map((r) => getDropshipProduct(r.product_id, countryWithRoutes)),
  );

  const productOptions: SampleProductOption[] = rows.slice(0, 24).map((r, i) => {
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
    (sp.product && productOptions.find((p) => p.productId === sp.product)) ||
    productOptions[0];

  const activeVar =
    (sp.variant && activeProd.variants.find((v) => v.id === sp.variant && v.stock_status !== 'out')) ||
    activeProd.variants.find((v) => v.stock_status !== 'out') ||
    activeProd.variants[0];

  const countryRoutes = activeProd.allCountryRoutes.filter(
    (r) => r.destination_country === selectedCountry,
  );
  const initialMethod: ShipType =
    sp.method && ['express', 'standard', 'economy'].includes(sp.method)
      ? (sp.method as ShipType)
      : countryRoutes[0]?.shipping_method ?? 'express';

  const initialRoute =
    countryRoutes.find((r) => r.shipping_method === initialMethod) ?? null;

  const initialQuote = activeVar
    ? await getDropshipOrderQuote({
        variantId: activeVar.id,
        qty: 1,
        country: selectedCountry,
        method: initialMethod,
        incoterm: initialRoute?.incoterm ?? 'DDP',
        quoteMode: 'order',
      })
    : null;

  // Correction 4: Pure wallet cash balance ONLY (ctx.wallet.available_cents = wallet_balance(org, 'USD'), excludes credit_limit)
  const walletCashCents = Math.max(0, Number(ctx.wallet?.available_cents ?? 0));

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-sample-page">
      <DsPageHeader
        title="Order a sample"
        subtitle="Check quality yourself before you sell it. Samples ship like any order."
        icon="package"
      />

      <SampleOrderClient
        products={productOptions}
        initialProductId={activeProd.productId}
        initialVariantId={activeVar?.id ?? ''}
        initialCountry={selectedCountry}
        initialMethod={initialMethod}
        initialQuote={initialQuote}
        walletCashCents={walletCashCents}
        defaultFullName={s.profile?.full_name ?? ''}
        defaultPhone={s.profile?.phone ?? ''}
        defaultAddress=""
        defaultCity={s.org?.city ?? ''}
        countryOptions={countryOptions}
        recentSamples={recentSamples}
        inImportList={impList.has(activeProd.productId)}
      />
    </div>
  );
}
