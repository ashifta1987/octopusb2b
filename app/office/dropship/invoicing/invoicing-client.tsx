'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsSelect, DsTableCard } from '@/components/dropship-ui';
import { fmtDay, usd } from '@/lib/dropship-ds14-shared';
import type { InvoicesPage } from '@/lib/dropship-ds14';

const TYPE: Record<string, string> = { commercial_invoice: 'Invoice', credit_note: 'Credit note', statement: 'Statement' };

export function InvoicingClient({ data, filters }: { data: InvoicesPage; filters: { type: string; q: string; from: string; to: string; status: string } }) {
  const router = useRouter();
  const [f, setF] = useState(filters);
  const qs = (x: typeof f) => new URLSearchParams(Object.entries(x).filter(([, v]) => v)).toString();
  const total = data.rows.reduce((s, r) => s + (r.type === 'credit_note' ? -1 : r.type === 'statement' ? 0 : 1) * Number(r.amount_cents ?? 0), 0);
  return (
    <div className="flex flex-col gap-5" data-testid="staff-invoicing-page">
      <DsPageHeader title="Invoicing" subtitle="Octopus Dropship invoices, credit notes and weekly statements." icon="file" actions={<DsLinkButton href={`/office/dropship/invoicing/csv?${qs(filters)}`} variant="secondary" icon="download" testId="invoicing-csv">Download CSV</DsLinkButton>} />
      <DsCard title="Invoicing entity" subtitle="Issues invoices to merchants" icon="shield" testId="invoicing-entity">
        {data.entity ? (
          <dl className="grid sm:grid-cols-4 gap-3 m-0 text-[14px]">
            <div><dt className="text-[12px] text-[#5B6478]">Legal entity</dt><dd className="m-0 font-semibold">{data.entity.legal_name}</dd></div>
            <div><dt className="text-[12px] text-[#5B6478]">Tax ID</dt><dd className="m-0">{data.entity.tax_id || 'Not set'}</dd></div>
            <div><dt className="text-[12px] text-[#5B6478]">Registered in</dt><dd className="m-0">{data.entity.registered_in || 'Not set'}</dd></div>
            <div><dt className="text-[12px] text-[#5B6478]">Currency</dt><dd className="m-0">{data.entity.currency}</dd></div>
          </dl>
        ) : <p className="m-0 text-[14px]">No default legal entity is set. Admins set it in Finance.</p>}
        <p className="text-[12px] text-[#5B6478] mt-3 mb-0">Read only. Number prefixes are OCT-DS (invoices), CN-DS (credit notes) and STMT-DS (statements). Tax by merchant country and the wallet top-up treatment are for your accountant to confirm; they are not configured here.</p>
      </DsCard>
      <form className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end ds-card" role="search" aria-label="Filter invoices" onSubmit={(e) => { e.preventDefault(); router.push(`/office/dropship/invoicing?${qs(f)}`); }}>
        <DsSelect label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All</option><option value="invoice">Invoices</option><option value="credit_note">Credit notes</option><option value="statement">Statements</option></DsSelect>
        <DsInput label="Number or merchant" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <DsInput label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <DsInput label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <DsInput label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} hint="For example paid" />
        <div className="flex gap-2"><DsButton type="submit" icon="search">Filter</DsButton><DsButton variant="secondary" onClick={() => { setF({ type: '', q: '', from: '', to: '', status: '' }); router.push('/office/dropship/invoicing'); }}>Clear</DsButton></div>
      </form>
      {data.rows.length === 0 ? (
        <DsEmptyState title="No documents match" description="Invoices, credit notes and statements appear here once merchants are charged. Plan fees are off today, so most lists start empty." icon="file" />
      ) : (
        <DsTableCard title={`${data.rows.length} document${data.rows.length === 1 ? '' : 's'}`} subtitle={data.rows.length >= data.limit ? `Showing the newest ${data.limit}. Narrow the filters or download the CSV.` : `Invoices less credit notes: ${usd(total)}`} headers={['Number', 'Type', 'Date', 'Merchant', 'Amount', 'Status']} minWidth={720} testId="invoicing-table">
          {data.rows.map((r) => (
            <tr key={r.id} data-testid="invoicing-row">
              <td className="font-semibold">{r.number}</td><td>{TYPE[r.type]}{r.kind === 'plan_fee' ? ' · plan fee' : ''}</td><td>{fmtDay(r.created_at)}</td><td>{r.merchant ?? '—'}</td>
              <td>{r.type === 'credit_note' ? '−' : ''}{usd(r.amount_cents)} {r.currency}</td><td>{r.status ? <DsBadge tone={r.status === 'paid' ? 'ok' : 'neutral'}>{r.status}</DsBadge> : '—'}</td>
            </tr>
          ))}
        </DsTableCard>
      )}
      <DsNotice tone="info" title="Statements">The weekly STMT-DS statement lists every OCT-DS invoice and CN-DS credit note of the week. Plan-fee invoices appear on it automatically.</DsNotice>
    </div>
  );
}
