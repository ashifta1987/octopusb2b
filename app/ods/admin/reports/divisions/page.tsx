// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireStaff } from '@/lib/auth';
import { loadDivisionReport } from '@/app/ods/office/_lib/accounts-a-data';
import { divisionMonths } from '@/app/ods/office/_lib/accounts-a-core';
import { settle } from '@/app/ods/office/_lib/dashboard-data';
import { DivisionReportView } from '@/app/ods/office/_components/accounts-a-reports';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';

/**
 * ODS T9 · /admin/reports/divisions — Reports by division. Guard as today: requireStaff('dashboard', 'view',
 * '/admin/reports/divisions'); same division_report + held_payment_protection_by_division RPCs, header division scope,
 * staging-only "include test data".
 */
export const metadata: Metadata = { title: 'Reports by division' };

type SP = Promise<{ months?: string; test?: string }>;

export default function OdsDivisionReportPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PanelSkeleton title="Reports by division" testId="division-report-page" lines={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('dashboard', 'view', '/admin/reports/divisions');
  const sp = await searchParams;
  const r = await settle(() => loadDivisionReport(s, divisionMonths(sp.months), sp.test));
  if (!r.ok) return <ErrorPage title="Reports by division" />;
  return <DivisionReportView data={r.data} />;
}
