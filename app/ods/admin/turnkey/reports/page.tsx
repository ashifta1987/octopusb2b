// ODS T9 · /admin/turnkey/reports. Replaces the T8 re-export. Same guard (requireStaff('turnkey','view')), same period parsing
// (reportPeriod + nowMs), same five tk_report_* RPCs (the functions check access again: FORBIDDEN → the team-only note).
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, money } from '@/lib/format';
import { nowMs } from '@/components/admin/server';
import { reportPeriod, type TkAgeingRow, type TkFeeRow, type TkFunnelRow, type TkInspectorRow, type TkUnpaidRow } from '@/lib/turnkey/reports';
import { Skeleton } from '@octopus/ui';
import { ReportsView } from '../_components/reports-view';

export const metadata = { title: 'Turnkey reports' };

type SP = Promise<{ months?: string }>;

export default function TurnkeyReportsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<Skeleton lines={10} label="Loading reports" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/reports');
  const period = reportPeriod((await searchParams).months, new Date(nowMs()));
  const sb = await createClient();
  const from = period.from;
  const [fees, funnel, ageing, unpaid, inspectors] = await Promise.all([
    sb.rpc('tk_report_fees_by_service', { p_from: from, p_to: null, p_include_test: false }),
    sb.rpc('tk_report_funnel', { p_from: from, p_to: null, p_include_test: false }),
    sb.rpc('tk_report_unpaid_ageing', { p_include_test: false }),
    sb.rpc('tk_report_unpaid_list', { p_include_test: false }),
    sb.rpc('tk_report_inspector_load', { p_from: from, p_to: null, p_include_test: false }),
  ]);
  const all = [fees, funnel, ageing, unpaid, inspectors];
  return (
    <ReportsView
      isAdmin={s.isAdmin}
      months={period.months ? String(period.months) : 'all'}
      periodText={`${period.label}${period.from ? ` (from ${fmtDate(period.from)}, by the date each proforma or project was created)` : ''}`}
      forbidden={all.some((r) => r.error && /FORBIDDEN/.test(r.error.message))}
      failed={all.some((r) => r.error && !/FORBIDDEN/.test(r.error.message))}
      fees={(fees.data ?? []) as TkFeeRow[]}
      funnel={(funnel.data ?? []) as TkFunnelRow[]}
      ageing={(ageing.data ?? []) as TkAgeingRow[]}
      unpaid={(unpaid.data ?? []) as TkUnpaidRow[]}
      inspectors={(inspectors.data ?? []) as TkInspectorRow[]}
      money={(c) => money(c)}
    />
  );
}
