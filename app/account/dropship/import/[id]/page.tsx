import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Product editor · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship');
  return (
    <DsPageHeader
      title="Product editor"
      subtitle="Edit store title, description, images and variant retail prices before pushing."
      icon="pencil"
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
