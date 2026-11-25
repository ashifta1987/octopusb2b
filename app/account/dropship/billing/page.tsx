import { Suspense } from 'react';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Plan and billing · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/billing');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Plan and billing"
        subtitle="Your dropshipping plan, live product and store limits, and billing status."
        icon="card"
      />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        Dropshipping is free while plan fees are off: no plan, trial or plan charge is running. This page will show your
        plan and limits when plans launch.
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
