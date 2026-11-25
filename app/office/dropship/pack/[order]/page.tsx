import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';

export const metadata = { title: 'Pack station · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/pack');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Pack station"
        subtitle="Pick items, add brand insert, weigh parcel and print white-label carrier label."
        icon="scale"
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
        The pack station screen is coming soon. Until then warehouse staff pack and label parcels from Shipping.
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
