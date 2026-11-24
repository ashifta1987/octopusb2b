import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Push to store · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/push');
  return (
    <DsPageHeader
      title="Push to store"
      subtitle="Review pricing, collections and publishing status before pushing to your store."
      icon="upload"
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
