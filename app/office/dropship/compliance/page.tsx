import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';

export const metadata = { title: 'Duty, tax and customs · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/compliance');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Duty, tax and customs"
        subtitle="Versioned duty and tax rate table, country thresholds and tracking carrier labels."
        icon="globe"
      />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        A screen to view and edit the duty and tax rate table is coming soon. Rates are already versioned in the
        database and used by every landed-cost quote.
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
