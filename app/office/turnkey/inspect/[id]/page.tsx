import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { Card, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { fmtDate } from '@/lib/format';
import { inspectionLabel, inspectionStatusLabel } from '@/lib/turnkey/format';
import { getInspectorJob } from '@/lib/turnkey/qc';
import { InspectorForm } from '@/components/turnkey/inspector-form';

export const metadata = { title: 'Inspection' };

/**
 * Turnkey T5 — one inspection on the inspector's phone (design: InspectorMobile "checklist (Pass, Fail, N/A, photos)";
 * D6: online now, offline later). The factory, address and brief for the inspector; the checklist, photos to the
 * private bucket, AQL numbers, result and signature; one submit. Only the assigned inspector gets here (the database
 * answers NOT_FOUND for anyone else).
 */
export default function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton cards={1} table={false} />}>
      <Inspection params={params} />
    </Suspense>
  );
}

async function Inspection({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requireStaff('turnkey_qc', 'edit', `/office/turnkey/inspect/${id}`);
  const j = await getInspectorJob(id);
  if (!j) notFound();
  const st = inspectionStatusLabel(j.status, 'staff');
  return (
    <div className="flex flex-col gap-4 max-w-[640px]">
      <PageHeader eyebrow={<Link href="/office/turnkey/inspect" className="text-sm text-muted hover:text-ink inline-flex min-h-11 items-center">← My inspections</Link>}
        title={inspectionLabel(j.kind, j.round)} subtitle={`${j.project_code} · ${j.project_title}`}
        actions={<StatusBadge status={j.status} label={st.label} tone={st.tone} />} />
      {j.returned_reason && j.status === 'in_progress' && <Notice tone="amber"><span data-testid="tk-insp-returned">Returned by the team: {j.returned_reason}</span></Notice>}
      <Card>
        <dl className="m-0 p-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[15px]" data-testid="tk-insp-facts">
          <dt className="text-muted">Factory</dt><dd className="m-0 font-semibold">{j.factory_name}</dd>
          {j.factory_address && <><dt className="text-muted">Address</dt><dd className="m-0">{j.factory_address}</dd></>}
          <dt className="text-muted">Date</dt><dd className="m-0">{j.scheduled_on ? fmtDate(j.scheduled_on) : 'Not set'}</dd>
          {j.brief && <><dt className="text-muted">Brief</dt><dd className="m-0 whitespace-pre-line">{j.brief}</dd></>}
        </dl>
      </Card>
      <Card>
        <div className="p-4">
          <InspectorForm job={{ id: j.id, projectId: j.project_id, kind: j.kind, round: j.round, status: j.status, paid: j.paid, projectOpen: j.project_open,
            items: j.items, photos: j.photos, report: j.report }} />
        </div>
      </Card>
    </div>
  );
}
