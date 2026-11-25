import { Suspense } from 'react';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Push to store · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/push');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Push to store"
        subtitle="Review pricing, collections and publishing status before pushing to your store."
        icon="upload"
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
        Pushing products to your store arrives with the Octopus Dropship Shopify app (Step 5). Add products to your
        Import list now so they are ready to push.
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
