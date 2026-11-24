import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = { title: 'System health · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/health');
  return (
    <DsPageHeader
      title="System health"
      subtitle="/office/dropship/health · store webhook queues, hourly order reconciliation and carrier tracking status."
      icon="activity"
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
