// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { can, requireStaff } from '@/lib/auth';
import { setSetting } from '@/app/admin/actions';
import { MailDeliverabilityAlert } from '@/components/admin/mail-deliverability';
import { loadReports } from '@/app/ods/office/_lib/accounts-a-data';
import { reportMonths } from '@/app/ods/office/_lib/accounts-a-core';
import { settle } from '@/app/ods/office/_lib/dashboard-data';
import { ReportsView } from '@/app/ods/office/_components/accounts-a-reports';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';

/**
 * ODS T9 · /admin/reports — Platform overview. Guard as today: requireStaff('dashboard', 'view', '/admin/reports');
 * same reads (accounts-a-data loadReports: audit_log only with audit:view, staff list only with staff:view), export link
 * only with finance:export (unchanged route), master switches = today's setSetting (admin only; the action checks again).
 */
export const metadata: Metadata = { title: 'Reports' };

type SP = Promise<{ months?: string }>;

export default function OdsReportsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PanelSkeleton title="Platform overview" testId="reports-page" lines={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('dashboard', 'view', '/admin/reports');
  const { months } = await searchParams;
  const r = await settle(() => loadReports(s, reportMonths(months)));
  if (!r.ok) return <ErrorPage title="Platform overview" />;
  return (
    <ReportsView
      data={r.data}
      mailAlert={<MailDeliverabilityAlert />}
      setSetting={setSetting}
      perms={{
        isAdmin: s.isAdmin, canExport: can(s, 'finance', 'export'), canFinance: can(s, 'finance', 'view'), canSuppliers: can(s, 'suppliers', 'view'),
        canStaffCreate: can(s, 'staff', 'create'), canStaffView: can(s, 'staff', 'view'), canSupplierCreate: can(s, 'suppliers', 'create'),
      }}
    />
  );
}
