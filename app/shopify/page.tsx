import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = {
  title: 'Octopus Dropship · Shopify App',
  robots: { index: false, follow: false },
};

async function Guarded() {
  if (!(await isDropshipV2UiEnabled())) {
    redirect('/request/dropship#notify');
  }
  return (
    <div className="ds-v2 min-h-screen p-6">
      <div className="max-w-[1240px] mx-auto">
        <DsPageHeader
          title="Octopus Dropship for Shopify"
          subtitle="Embedded Shopify app view for connecting and syncing your store."
          icon="store"
        />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-v2 min-h-screen p-6">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
