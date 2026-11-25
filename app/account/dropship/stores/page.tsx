import { Suspense } from 'react';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Stores · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/stores');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader title="Stores" subtitle="Connect and manage your Shopify or WooCommerce stores." icon="store" />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        Connecting a Shopify store arrives with the Octopus Dropship Shopify app (Step 5). No store is connected yet and
        nothing syncs. You can already find products, order samples and request products.
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
