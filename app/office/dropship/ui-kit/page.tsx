import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { UiKitClient } from './ui-kit-client';

export const metadata: Metadata = {
  title: 'Components and specs · Octopus Dropship design v2',
  robots: { index: false, follow: false },
};

async function GuardedUiKit() {
  await requireDropshipV2Staff(false, '/office/dropship/ui-kit');
  return <UiKitClient />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading UI kit…</div>}>
      <GuardedUiKit />
    </Suspense>
  );
}
