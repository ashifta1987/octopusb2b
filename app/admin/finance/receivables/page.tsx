import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import {
  ReceivablesClient,
  type ReceivableInvoiceRow,
  type ReconciliationAlertRow,
} from './receivables-client';

export const metadata = { title: 'Receivables & ageing' };

async function ReceivablesPageContent() {
  await requireStaff('finance', 'view', '/admin/finance/receivables');
  const sb = await createClient();

  const [{ data: docs }, { data: alerts }] = await Promise.all([
    sb
      .from('documents')
      .select(
        'id, number, org_id, division_id, amount_cents, paid_cents, currency, status, due_at, payment_option, last_reminder_stage, created_at, organizations(name), divisions(code)',
      )
      .eq('doc_type', 'commercial_invoice')
      .not('status', 'in', '("paid","void","cancelled")')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(200),
    sb
      .from('payment_reconciliation_alerts')
      .select('id, provider, provider_payment_id, kind, expected_cents, actual_cents, currency, detail, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const currentMs = getNowMs();
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };

  const invoices: ReceivableInvoiceRow[] = (docs ?? [])
    .map((d) => {
      const amount = Number(d.amount_cents ?? 0);
      const paid = Number(d.paid_cents ?? 0);
      const bal = Math.max(0, amount - paid);
      const dueMs = d.due_at ? new Date(d.due_at as string).getTime() : currentMs;
      const daysOverdue = Math.floor((currentMs - dueMs) / 86400_000);
      let bucket: ReceivableInvoiceRow['bucket'] = 'current';
      if (daysOverdue > 90) {
        bucket = '90_plus';
        buckets.d90_plus += bal;
      } else if (daysOverdue > 60) {
        bucket = '61_90';
        buckets.d61_90 += bal;
      } else if (daysOverdue > 30) {
        bucket = '31_60';
        buckets.d31_60 += bal;
      } else if (daysOverdue > 0) {
        bucket = '1_30';
        buckets.d1_30 += bal;
      } else {
        buckets.current += bal;
      }

      return {
        id: d.id as string,
        number: d.number as string,
        org_name: ((d.organizations as { name?: string } | null)?.name ?? 'Customer') as string,
        division_code: ((d.divisions as { code?: string } | null)?.code ?? 'SRC') as string,
        amount_cents: amount,
        paid_cents: paid,
        balance_cents: bal,
        currency: (d.currency as string)?.trim() || 'USD',
        due_at: (d.due_at as string | null) ?? null,
        days_overdue: daysOverdue,
        bucket,
        payment_option: (d.payment_option as string | null) ?? null,
        last_reminder_stage: (d.last_reminder_stage as string | null) ?? null,
        created_at: d.created_at as string,
      };
    })
    .filter((i) => i.balance_cents > 0);

  return (
    <>
      <PageHeader
        title="Receivables, ageing & settlement reconciliation"
        subtitle="Track unpaid Pay-later tax invoices by ageing bucket (Current, 1–30, 31–60, 61–90, 90+ days), trigger automated due/overdue reminders, and reconcile provider settlements against the ledger."
      />
      <ReceivablesClient
        invoices={invoices}
        alerts={((alerts ?? []) as unknown) as ReconciliationAlertRow[]}
        buckets={buckets}
      />
    </>
  );
}

export default function FinanceReceivablesPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <ReceivablesPageContent />
    </Suspense>
  );
}
