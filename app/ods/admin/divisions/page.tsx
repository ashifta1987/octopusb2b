// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { DIVISION_LOGOS } from '@/lib/divisions/shared';
import { saveDivision } from '@/app/admin/divisions/actions';
import { loadDivisions } from '@/app/ods/office/_lib/admin-c-data';
import { settle } from '@/app/ods/office/_lib/dashboard-data';
import { DivisionsAdmin } from '@/app/ods/office/_components/admin-c-company';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';

/** ODS T9 · /admin/divisions. Guard as today: requireStaff('staff','view') + company-wide Admin only; saveDivision unchanged. */
export const metadata: Metadata = { title: 'Divisions' };

export default function OdsDivisionsPage() {
  return (
    <Suspense fallback={<PanelSkeleton title="Divisions" testId="divisions-page" lines={6} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const s = await requireStaff('staff', 'view', '/admin/divisions');
  if (!s.isAdmin) redirect('/forbidden');
  const r = await settle(() => loadDivisions());
  if (!r.ok) return <ErrorPage title="Divisions" />;
  return <DivisionsAdmin divisions={r.data} logos={{ ...DIVISION_LOGOS }} save={saveDivision} />;
}
