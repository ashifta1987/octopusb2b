// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { can, requireStaff, type Session } from '@/lib/auth';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { confirmTopup, decideApproval, recordPayment, requestApproval } from '@/app/admin/finance/actions';
import { loadFinanceOverview } from '@/app/ods/office/_lib/accounts-a-data';
import { loadAgeing, loadMoneyWeeks, settle } from '@/app/ods/office/_lib/dashboard-data';
import { FinanceOverview } from '@/app/ods/office/_components/accounts-a-finance';
import { AgeingPanel, MoneyChart, PanelError, PanelSkeleton } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';

/**
 * ODS T9 · /admin/finance — Finance overview. Guard as today: requireStaff('finance', 'view', '/admin/finance'); the
 * same reads as today's page (accounts-a-data loadFinanceOverview) and TODAY's server actions unchanged
 * (decideApproval, requestApproval, recordPayment, confirmTopup — each runs its own guard + RPC). Controls follow
 * today's permission checks: finance:approve (approve / record payment), finance:create (new request),
 * finance:export (CSV links, the route handler checks again), wallet:approve (confirm top-up), admin (edit limit).
 * Ageing + money in and out = the T9 dashboard widgets (each loads and fails on its own).
 */
export const metadata: Metadata = { title: 'Finance & revenue' };

type SP = Promise<{ month?: string }>;

export default function OdsFinancePage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PanelSkeleton title="Finance & revenue" testId="finance-overview" lines={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('finance', 'view', '/admin/finance');
  const { month } = await searchParams;
  const r = await settle(() => loadFinanceOverview(s, month));
  if (!r.ok) return <ErrorPage title="Finance & revenue" />;
  const nowMs = getNowMs();
  return (
    <FinanceOverview
      data={r.data}
      perms={perms(s)}
      actions={{ decide: decideApproval, confirmTopup, recordPayment, requestApproval }}
      chart={<Suspense fallback={<PanelSkeleton title="Money in and out · last 8 weeks" testId="money-chart" lines={6} />}><Chart nowMs={nowMs} /></Suspense>}
      ageing={<Suspense fallback={<PanelSkeleton title="Receivables ageing" testId="ageing" />}><Ageing nowMs={nowMs} /></Suspense>}
    />
  );
}

const perms = (s: Session) => ({
  canApprove: can(s, 'finance', 'approve'),
  canCreate: can(s, 'finance', 'create'),
  canExport: can(s, 'finance', 'export'),
  canWalletApprove: can(s, 'wallet', 'approve'),
  isAdmin: s.isAdmin,
});

async function Chart({ nowMs }: { nowMs: number }) {
  const r = await settle(() => loadMoneyWeeks(nowMs));
  return r.ok ? <MoneyChart weeks={r.data.weeks} fx={r.data.fx} /> : <PanelError title="Money in and out" testId="money-chart" />;
}

async function Ageing({ nowMs }: { nowMs: number }) {
  const r = await settle(() => loadAgeing(nowMs));
  return r.ok ? <AgeingPanel ageing={r.data.ageing} fx={r.data.fx} /> : <PanelError title="Receivables ageing" testId="ageing" />;
}
