import { Suspense } from 'react';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Order detail · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/orders');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Order detail"
        subtitle="Items, landed cost breakdown, buyer shipping address and tracking timeline."
        icon="cart"
      />
      <DsNotice
        tone="info"
        title="Coming soon"
        testId="planned-notice"
        action={
          <DsLinkButton href="/account/dropship/orders" variant="secondary">
            Back to orders
          </DsLinkButton>
        }
      >
        The full order page (items, cost breakdown and tracking timeline) is coming soon. Status, total and destination
        of every order are on the Orders list.
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
