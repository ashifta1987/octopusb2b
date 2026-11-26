import { Suspense } from 'react';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { fmtDate } from '@/lib/format';
import { inspectionLabel, inspectionStatusLabel } from '@/lib/turnkey/format';
import { getMyInspections } from '@/lib/turnkey/qc';

export const metadata = { title: 'My inspections' };

/**
 * Turnkey T5 — the inspector's phone home (design: InspectorMobile). Only the inspections assigned to the signed-in
 * inspector (turnkey_qc:edit, 2FA): open ones first, then the last 30 days of published ones. Built 390 px first.
 */
export default function MyInspectionsPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={1} table={false} />}>
      <MyInspections />
    </Suspense>
  );
}

async function MyInspections() {
  await requireStaff('turnkey_qc', 'edit', '/office/turnkey/inspect');
  const jobs = await getMyInspections();
  return (
    <div className="flex flex-col gap-4 max-w-[640px]">
      <PageHeader title="My inspections" subtitle="Factory audits and pre-shipment inspections assigned to you." />
      <Card>
        <div className="p-4" data-testid="tk-insp-list">
          {jobs.length === 0 ? <EmptyState title="Nothing assigned" body="Inspections the team schedules for you appear here." /> : (
            <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line">
              {jobs.map((j) => {
                const st = inspectionStatusLabel(j.status, 'staff');
                return (
                  <li key={j.id}>
                    <Link href={`/office/turnkey/inspect/${j.id}`} className="flex flex-col gap-1 py-3 min-h-11 hover:bg-tint rounded-[8px] px-2" data-testid={`tk-insp-job-${j.project_code}-${j.kind}-${j.round}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[16px]">{inspectionLabel(j.kind, j.round)}</span>
                        <StatusBadge status={j.status} label={st.label} tone={st.tone} />
                      </span>
                      <span className="text-[14px]">{j.factory_name}</span>
                      <span className="text-[13px] text-muted">{j.scheduled_on ? fmtDate(j.scheduled_on) : 'No date'} · <span className="mono">{j.project_code}</span> · {j.project_title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
