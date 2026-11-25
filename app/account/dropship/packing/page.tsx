import { Suspense } from 'react';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Packing and shipping · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/packing');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Packing and shipping"
        subtitle="Brand insert, shipping rate mapping and duties mode (DDP or DAP)."
        icon="package"
      />
      <DsNotice
        tone="info"
        title="Coming soon"
        testId="planned-notice"
        action={
          <DsLinkButton href="/account/dropship/catalogue" variant="secondary">
            Find products
          </DsLinkButton>
        }
      >
        Brand inserts, shipping-rate mapping and the DDP / DAP setting per store are coming soon. Today every order uses
        the landed cost shown in Find products.
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
