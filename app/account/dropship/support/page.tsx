import { Suspense } from 'react';
import { DsCard, DsLinkButton, DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Support · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/support');
  return (
    <div className="flex flex-col gap-5" data-testid="dropship-support-page">
      <DsPageHeader
        title="Support"
        subtitle="Get help with store orders, damaged parcels, address holds or product questions."
        icon="help"
        actions={
          <DsLinkButton href="/account/support?topic=dropship" variant="primary" icon="send">
            Open support ticket
          </DsLinkButton>
        }
      />
      <DsCard title="Support tickets & account manager" icon="help">
        <p className="ds-mut text-[14px] m-0 mb-3">
          Open or follow up on support tickets with your account manager and the Octopus Dropship
          operations team — even while Dropshipping is paused or closed.
        </p>
        <DsLinkButton href="/account/support?topic=dropship" variant="secondary" icon="help">
          Go to My account › Support
        </DsLinkButton>
      </DsCard>
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
