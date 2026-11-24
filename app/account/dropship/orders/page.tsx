import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Orders · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/orders');
  return (
    <DsPageHeader
      title="Orders"
      subtitle="Track store orders, fulfilment status, holds and tracking numbers."
      icon="cart"
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
