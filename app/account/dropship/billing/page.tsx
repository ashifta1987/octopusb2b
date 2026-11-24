import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Plan and billing · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/billing');
  return (
    <DsPageHeader
      title="Plan and billing"
      subtitle="Your dropshipping plan, live product and store limits, and billing status."
      icon="card"
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
