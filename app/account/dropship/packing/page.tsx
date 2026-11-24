import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Packing and shipping · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/packing');
  return (
    <DsPageHeader
      title="Packing and shipping"
      subtitle="Brand insert, shipping rate mapping and duties mode (DDP or DAP)."
      icon="package"
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
