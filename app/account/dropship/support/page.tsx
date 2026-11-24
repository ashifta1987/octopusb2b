import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Support · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/support');
  return (
    <DsPageHeader
      title="Support"
      subtitle="Get help with store orders, damaged parcels, address holds or product questions."
      icon="help"
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
