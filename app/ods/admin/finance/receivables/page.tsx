// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { can, requireStaff } from '@/lib/auth';
import { runCreditAndSaasOverdueCheckAction, runPaymentReconciliationAction } from '@/app/admin/finance/receivables/actions';
import { loadReceivables } from '@/app/ods/office/_lib/accounts-a-data';
import { settle } from '@/app/ods/office/_lib/dashboard-data';
import { ReceivablesView } from '@/app/ods/office/_components/accounts-a-receivables';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';

/**
 * ODS T9 · /admin/finance/receivables — grid + customer drill-down drawer. Guard as today:
 * requireStaff('finance', 'view', '/admin/finance/receivables'); same documents + payment_reconciliation_alerts reads;
 * the two jobs are today's actions unchanged. The "Customer record" link shows only with customers:view.
 */
export const metadata: Metadata = { title: 'Receivables & ageing' };

export default function OdsReceivablesPage() {
  return (
    <Suspense fallback={<PanelSkeleton title="Receivables & ageing" testId="finance-receivables-page" lines={8} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const s = await requireStaff('finance', 'view', '/admin/finance/receivables');
  const r = await settle(() => loadReceivables());
  if (!r.ok) return <ErrorPage title="Receivables & ageing" />;
  return (
    <ReceivablesView
      rows={r.data.rows}
      buckets={r.data.buckets}
      alerts={r.data.alerts}
      actions={{ overdueCheck: runCreditAndSaasOverdueCheckAction, reconcile: runPaymentReconciliationAction }}
      canSeeCustomers={can(s, 'customers') || s.roles.includes('account_manager')}
    />
  );
}
