import { Suspense } from 'react';
import { DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Stores · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/stores');
  return (
    <DsPageHeader
      title="Stores"
      subtitle="Connect and manage your Shopify or WooCommerce stores."
      icon="store"
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
