import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';

export const metadata = { title: 'System health · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/health');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="System health"
        subtitle="Store webhook queues, hourly order reconciliation and carrier tracking status."
        icon="activity"
      />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        The system health dashboard (store webhooks, order reconciliation, tracking) is coming soon. No store webhooks
        are connected yet.
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
