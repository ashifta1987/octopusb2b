import { Suspense } from 'react';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Pricing and sync · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/pricing');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Pricing and sync"
        subtitle="Markup rules, rounding, minimum margin alerts and automatic stock and price updates."
        icon="tag"
      />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        Markup rules and automatic price and stock sync arrive once a store can be connected (Step 5). Nothing is synced
        to a store today.
      </DsNotice>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
