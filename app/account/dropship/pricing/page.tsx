import { Suspense } from 'react';
import { DsNotice, DsSkeleton, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { getPricingPage, rpcMessage, type PricingData } from '@/lib/dropship-ds6';
import { COUNTRY_NAMES } from '@/lib/format';
import { PricingClient } from './pricing-client';

export const metadata = { title: 'Pricing and sync · Octopus Dropship' };

/**
 * Release 2 · Step 6 — Pricing and sync (screens/Pricing.html, mobile/M_Pricing.html). Data: ds_pricing_get().
 * Saves the rule (cost bands, rounding, compare-at, minimum margin, store currency + named FX source + reprice threshold,
 * "when things change"). First-push pricing uses it; the sync engine that acts on changes is Step 11.
 */
async function Pricing() {
  await requireDropshipV2Merchant('/account/dropship/pricing');
  let data: PricingData | null = null;
  let error: string | null = null;
  try {
    data = await getPricingPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds6-pricing">
        <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">Pricing and sync</h1>
        <DsNotice tone="bad" title="Pricing could not be loaded" testId="pricing-error"
          action={<DsLinkButton href="/account/dropship/pricing" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  const names = Object.fromEntries(data.markets.map((c) => [c, COUNTRY_NAMES[c] ?? c]));
  return <PricingClient data={data} countryNames={names} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Pricing />
    </Suspense>
  );
}
