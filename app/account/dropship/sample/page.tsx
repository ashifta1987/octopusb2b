import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Order a sample · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/sample');
  return (
    <DsPageHeader
      title="Order a sample"
      subtitle="Test product quality and packaging before publishing to your store."
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
