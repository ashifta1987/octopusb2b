import { Suspense } from 'react';
import { PageSkeleton } from '@/components/shell/skeletons';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, EmptyState, StatusBadge } from '@/components/ui';
import { DocumentButton } from '@/components/client';
import { fmtDate, money } from '@/lib/format';
import { DOC_LABEL } from '@/components/account/data';
import { getAmountsDue } from '@/lib/core/amounts-due';

const SVC: Record<string, string> = { sourcing: 'Sourcing', dropship: 'Dropshipping', warehouse: '3PL warehouse', brand: 'Make My Brand', wallet: 'Wallet top-up' };

export const metadata = { title: 'Invoices and receipts' };

function forLabel(d: { doc_type: unknown; data: unknown; orders: unknown }) {
  const x = (d.data ?? {}) as { service?: string; ref?: string; kind?: string; title?: string };
  const order = (d.orders as { code: string } | null)?.code;
  if (order) return <>Sourcing · order <span className="mono">{order}</span></>;
  if (x.service) return <>{SVC[x.service] ?? x.service}{x.ref ? <> · <span className="mono">{x.ref}</span></> : null}</>;
  return d.doc_type === 'receipt' ? 'Wallet top-up' : '—';
}

/** ADDON-41 — every invoice, receipt and credit note from the Hong Kong company, from any service. */
async function InvoicesPageContent() {
  const s = await requireCustomer('/account/invoices');
  const sb = await createClient();
  const due = await getAmountsDue(s.org!.id);
  const { data } = await sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, data, created_at, orders(code)')
    .eq('org_id', s.org!.id).in('doc_type', ['proforma_invoice', 'commercial_invoice', 'receipt', 'credit_note', 'statement']).order('created_at', { ascending: false }).limit(200);
  return (
    <div className="max-w-[1160px]">
      <PageHeader title="Invoices and receipts" subtitle="Invoices, receipts and credit notes for every service. Open one to download or email it." />
      <div className="card p-5 mb-5 flex flex-wrap gap-x-10 gap-y-2 items-baseline" data-testid="awaiting-total">
        <div className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-muted">Awaiting payment</div>
        {Object.keys(due.byCurrency).length === 0 ? <div className="text-[22px] font-extrabold">{money(0, 'USD')}</div>
          : Object.entries(due.byCurrency).map(([c, v]) => <div key={c} className="text-[22px] font-extrabold" data-currency={c}>{money(v!, c)}</div>)}
        <div className="text-[13px] text-muted">Same as “Due now” in Ledger and statements: deposits and balances due on orders, plus proformas awaiting payment.</div>
      </div>
      <Card>
        <Table head={['Date', 'Document', 'Number', 'For', 'Amount', 'Status', '']} empty={<EmptyState title="No documents yet" body="Invoices and receipts appear here as soon as they are issued." />}>
          {(data ?? []).map((d) => (
            <tr key={d.id}>
              <td className="td text-sm whitespace-nowrap">{fmtDate(d.created_at as string)}</td>
              <td className="td">{DOC_LABEL[d.doc_type as string] ?? d.doc_type}</td>
              <td className="td mono text-sm whitespace-nowrap">{d.number}</td>
              <td className="td text-sm">{forLabel(d)}</td>
              <td className="td mono whitespace-nowrap">{d.amount_cents != null ? money(Number(d.amount_cents), (d.currency as string) ?? 'USD') : '—'}</td>
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
    <Suspense fallback={<PageSkeleton />}>
      <InvoicesPageContent />
    </Suspense>
  );
}
