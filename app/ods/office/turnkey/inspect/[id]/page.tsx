// ODS T9 · /office/turnkey/inspect/[id] (one inspection on the inspector's phone). Replaces the T8 re-export. Same uuid check,
// guard (requireStaff('turnkey_qc','edit')), data (getInspectorJob: the database answers NOT_FOUND for anyone but the assigned
// inspector) and form (today's InspectorForm + actions). Comfortable density from the T8 inspect layout.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { getInspectorJob } from '@/lib/turnkey/qc';
import { Skeleton } from '@octopus/ui';
import { InspectJobView } from '../_components/inspect-views';

export const metadata = { title: 'Inspection' };

export default function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[640px]"><Skeleton lines={8} label="Loading the inspection" /></div>}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requireStaff('turnkey_qc', 'edit', `/office/turnkey/inspect/${id}`);
  const j = await getInspectorJob(id);
  if (!j) notFound();
  return <InspectJobView j={j} />;
}
