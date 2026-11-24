import { Suspense } from 'react';
import { ServiceStart } from '@/components/account/service-start';
import { DsLinkButton, DsPageHeader } from '@/components/dropship-ui';
import { requireCustomer } from '@/lib/auth';
import { getAccountContext, serviceOn } from '@/lib/core/account';
import { isDropshipV2UiEnabled } from '@/lib/dropship';

export const metadata = { title: 'Dropshipping' };

async function DropshipHome() {
  const s = await requireCustomer('/account/dropship');
  const [ctx, v2On] = s.org
    ? await Promise.all([getAccountContext(s.org.id), isDropshipV2UiEnabled()])
    : [null, false];
  const useV2Shell = Boolean(v2On && ctx && serviceOn(ctx.services.dropship));

  if (!useV2Shell) {
    return <ServiceStart service="dropship" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Dashboard"
        subtitle="Your store, orders and sync at a glance. Last 30 days, all stores."
        icon="grid"
        actions={
          <>
            <DsLinkButton href="/account/dropship/catalogue" variant="secondary" icon="search">
              Find products
            </DsLinkButton>
            <DsLinkButton href="/account/dropship/wallet" variant="primary" icon="wallet">
              Add funds
            </DsLinkButton>
          </>
        }
      />
      <ServiceStart service="dropship" hideHeading />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="card p-6">Loading…</div>}>
      <DropshipHome />
    </Suspense>
  );
}
