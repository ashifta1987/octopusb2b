import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Request a product · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/requests');
  return (
    <DsPageHeader
      title="Request a product"
      subtitle="Ask Octopus to source and price a product for your dropshipping catalogue."
      icon="send"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
