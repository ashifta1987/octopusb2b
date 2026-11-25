import { Suspense } from 'react';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Pushed products · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/pushed');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Pushed products"
        subtitle="Products published to your connected stores and their live stock and price sync status."
        icon="refresh"
      />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        Nothing has been pushed yet: store connection arrives with the Octopus Dropship Shopify app (Step 5).
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
