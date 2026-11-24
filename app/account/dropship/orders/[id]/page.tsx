import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Order detail · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/orders');
  return (
    <DsPageHeader
      title="Order detail"
      subtitle="Items, landed cost breakdown, buyer shipping address and tracking timeline."
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
