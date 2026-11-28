// ODS T9 · /office/turnkey/inspect (My inspections, inspectors on phones). Replaces the T8 re-export. Same guard
// (requireStaff('turnkey_qc','edit')), same data (getMyInspections: only the signed-in inspector's jobs). Comfortable density
// comes from the T8 inspect layout. Switch off → today's page.
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { getMyInspections } from '@/lib/turnkey/qc';
import { Skeleton } from '@octopus/ui';
import { InspectListView } from './_components/inspect-views';

export const metadata = { title: 'My inspections' };

export default function MyInspectionsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[640px]"><Skeleton lines={6} label="Loading your inspections" /></div>}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireStaff('turnkey_qc', 'edit', '/office/turnkey/inspect');
  return <InspectListView jobs={await getMyInspections()} />;
}
