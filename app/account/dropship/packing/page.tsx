import { Suspense } from 'react';
import { DsNotice, DsSkeleton, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { getPackingPage, rpcMessage, type PackingData } from '@/lib/dropship-ds6';
import { COUNTRY_NAMES } from '@/lib/format';
import { PackingClient } from './packing-client';

export const metadata = { title: 'Packing and shipping · Octopus Dropship' };

/**
 * Release 2 · Step 6b (merchant half) — Packing and shipping (screens/PackingShipping.html, mobile/M_PackingShipping.html).
 * Data: ds_packing_get(). Duties (DDP / DAP) are set ONLY here, per selling country (US defaults to DDP). Fees come from
 * the active fee version; a fee that is not set is shown as "not set" and can't be chosen. Store rate mapping needs a
 * connected store (read_shipping, Step 5); the default and fallback method are saved now.
 */
async function Packing() {
  await requireDropshipV2Merchant('/account/dropship/packing');
  let data: PackingData | null = null;
  let error: string | null = null;
  try {
    data = await getPackingPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds6-packing">
        <h1 className="m-0 text-[26px] font-bold text-ink">Packing and shipping</h1>
        <DsNotice tone="bad" title="Packing and shipping could not be loaded" testId="packing-error"
          action={<DsLinkButton href="/account/dropship/packing" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  const names = Object.fromEntries(data.markets.map((m) => [m.country, COUNTRY_NAMES[m.country] ?? m.country]));
  return <PackingClient data={data} countryNames={names} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Packing />
    </Suspense>
  );
}
