import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';

export const metadata = { title: 'Fees and plans · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/fees');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Fees and plans"
        subtitle="Processing fee, internal 3PL pick-and-pack charge, weight tolerance and plan limits."
        icon="percent"
      />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        A screen for fees and plans is coming soon. Fee schedules already change only through two-person approval, and
        plan fees are off.
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
