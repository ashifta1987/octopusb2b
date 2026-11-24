import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Reports · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/reports');
  return (
    <DsPageHeader
      title="Reports"
      subtitle="Store sales, Octopus landed costs, profit before ads and weekly statements."
      icon="chart"
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
