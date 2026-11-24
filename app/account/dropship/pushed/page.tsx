import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Pushed products · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/pushed');
  return (
    <DsPageHeader
      title="Pushed products"
      subtitle="Products published to your connected stores and their live stock and price sync status."
      icon="refresh"
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
