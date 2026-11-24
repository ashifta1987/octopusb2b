import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Settings · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/settings');
  return (
    <DsPageHeader
      title="Settings"
      subtitle="Selling countries, low-wallet notifications and order payment preferences."
      icon="gear"
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
