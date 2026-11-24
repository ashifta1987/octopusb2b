import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Landed cost calculator · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/landed-cost');
  return (
    <DsPageHeader
      title="Landed cost calculator"
      subtitle="Compare product, processing, shipping and duties across destination countries."
      icon="globe"
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
