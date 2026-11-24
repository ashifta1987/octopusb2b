import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = { title: 'Duty, tax and customs · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/compliance');
  return (
    <DsPageHeader
      title="Duty, tax and customs"
      subtitle="/office/dropship/compliance · versioned duty and tax rate table, country thresholds and tracking carrier labels."
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
