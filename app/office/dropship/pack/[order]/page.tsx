import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = { title: 'Pack station · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/pack');
  return (
    <DsPageHeader
      title="Pack station"
      subtitle="/office/dropship/pack/[order] · pick items, add brand insert, weigh parcel and print white-label carrier label."
      icon="scale"
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
