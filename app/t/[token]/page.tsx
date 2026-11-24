import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = {
  title: 'Track your parcel',
  robots: { index: false, follow: false },
};

async function Guarded() {
  if (!(await isDropshipV2UiEnabled())) {
    notFound();
  }
  return (
    <div className="ds-v2 min-h-screen p-6">
      <div className="max-w-[760px] mx-auto">
        <DsPageHeader
          title="Track your parcel"
          subtitle="Live delivery updates for your order."
          icon="truck"
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
