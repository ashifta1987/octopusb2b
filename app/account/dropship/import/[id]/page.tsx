import { Suspense } from 'react';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Product editor · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Product editor"
        subtitle="Edit store title, description, images and variant retail prices before pushing."
        icon="pencil"
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
        Editing a product’s store title, description, images and retail prices before pushing arrives with the Octopus
        Dropship Shopify app (Step 5).
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
