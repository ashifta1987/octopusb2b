import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';

export const metadata = { title: 'Fulfilment queue · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/queue');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Fulfilment queue"
        subtitle="Paid store orders ready to pick, pack, label and hand over, plus exceptions."
        icon="list"
      />
      <DsNotice
        tone="info"
        title="Coming soon"
        testId="planned-notice"
        action={
          <DsLinkButton href="/office/shipping" variant="secondary">
            Open Shipping
          </DsLinkButton>
        }
      >
        The fulfilment queue screen is coming soon. Paid store orders are already reserved and handed to the 3PL
        warehouse automatically, and shipments are handled in Shipping.
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
