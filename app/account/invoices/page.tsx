import { Suspense } from 'react';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, EmptyState, StatusBadge } from '@/components/ui';
import { DocumentButton } from '@/components/client';
import { fmtDate, money } from '@/lib/format';
import { DOC_LABEL } from '@/components/account/data';

export const metadata = { title: 'Invoices and receipts' };

/** ADDON-41 — every invoice, receipt and credit note from the Hong Kong company, from any service. */
async function InvoicesPageContent() {
  const s = await requireCustomer('/account/invoices');
  const sb = await createClient();
  const { data } = await sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, created_at, orders(code)')
    .eq('org_id', s.org!.id).in('doc_type', ['proforma_invoice', 'commercial_invoice', 'receipt', 'credit_note', 'statement']).order('created_at', { ascending: false }).limit(200);
  return (
    <div className="max-w-[1160px]">
      <PageHeader title="Invoices and receipts" subtitle="Invoices, receipts and credit notes for every service. Open one to download or email it." />
      <Card>
        <Table head={['Date', 'Document', 'Number', 'For', 'Amount', 'Status', '']} empty={<EmptyState title="No documents yet" body="Invoices and receipts appear here as soon as they are issued." />}>
          {(data ?? []).map((d) => (
            <tr key={d.id}>
              <td className="td text-sm">{fmtDate(d.created_at as string)}</td>
              <td className="td">{DOC_LABEL[d.doc_type as string] ?? d.doc_type}</td>
              <td className="td mono text-sm">{d.number}</td>
              <td className="td mono text-sm">{(d.orders as unknown as { code: string } | null)?.code ?? (d.doc_type === 'receipt' ? 'Wallet top-up' : '—')}</td>
              <td className="td mono">{d.amount_cents != null ? money(Number(d.amount_cents), (d.currency as string) ?? 'USD') : '—'}</td>
              <td className="td"><StatusBadge status={d.status as string} /></td>
              <td className="td text-right"><DocumentButton docId={d.id as string} compact /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

/** Request-time content streams inside Suspense (cacheComponents: instant navigation). */
export default function InvoicesPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}>
      <InvoicesPageContent />
    </Suspense>
  );
}
