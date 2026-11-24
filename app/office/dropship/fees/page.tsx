import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = { title: 'Fees and plans · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/fees');
  return (
    <DsPageHeader
      title="Fees and plans"
      subtitle="/office/dropship/fees · processing fee, internal 3PL pick-and-pack charge, weight tolerance and plan limits."
      icon="percent"
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
