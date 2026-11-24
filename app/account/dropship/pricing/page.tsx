import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Pricing and sync · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/pricing');
  return (
    <DsPageHeader
      title="Pricing and sync"
      subtitle="Markup rules, rounding, minimum margin alerts and automatic stock and price updates."
      icon="tag"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
