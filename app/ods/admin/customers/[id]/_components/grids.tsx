'use client';
/**
 * ODS T9 · Customer record tab grids (OctopusDataGrid, compact). Rows are view models from the page loaders (or fixtures).
 * Row open = the record's own staff page (only when the staff member may open it; href null = plain row).
 * Phones: the grid's own read-only stacked list ("Open this on a computer to edit").
 */
import { useRouter } from 'next/navigation';
import { OctopusDataGrid, Money, StatusPill, formatDate, type GridColumn } from '@octopus/ui';
import { centsToAmount, currencyLabel, docTypeLabel, humanizeWord, orderStatusName, requestStatusName } from '../../_lib/customer-logic';
import type { DocumentRowVM, InvoiceRowVM, OrderRowVM, RfqRowVM } from '../../_lib/types';

function useOpen<T extends { href: string | null }>() {
  const router = useRouter();
  return (row: T, opts: { newTab: boolean }) => {
    if (!row.href) return;
    if (opts.newTab || row.href.startsWith('/api/')) window.open(row.href, '_blank');
    else router.push(row.href);
  };
}

const money = (cents: number, cur: string) => <Money amount={centsToAmount(cents)} currency={currencyLabel(cur)} />;
const date = (iso: string | null) => (iso ? formatDate(iso) : '—');
const link = (text: string, href: string | null) =>
  href ? (
    <a href={href} className="inline-flex min-h-6 items-center font-semibold text-ods-blue hover:underline" onClick={(e) => e.stopPropagation()} target={href.startsWith('/api/') ? '_blank' : undefined} rel={href.startsWith('/api/') ? 'noreferrer' : undefined}>
      {text}
    </a>
  ) : (
    <span className="font-semibold text-ods-navy">{text}</span>
  );

export function OrdersGrid({ rows, loading }: { rows: OrderRowVM[]; loading?: boolean }) {
  const open = useOpen<OrderRowVM>();
  const cols: GridColumn<OrderRowVM>[] = [
    { id: 'code', header: 'Order', accessor: (r) => r.code, cell: (r) => link(r.code, r.href), width: 170 },
    { id: 'date', header: 'Date', accessor: (r) => r.date, cell: (r) => date(r.date), width: 110 },
    { id: 'service', header: 'Service', accessor: (r) => r.service, width: 120 },
    { id: 'title', header: 'Products', accessor: (r) => r.title, minWidth: 180 },
    { id: 'total', header: 'Total (US$)', numeric: true, accessor: (r) => r.totalCents, cell: (r) => money(r.totalCents, r.currency), width: 130 },
    { id: 'paid', header: 'Paid (US$)', numeric: true, accessor: (r) => r.paidCents, cell: (r) => money(r.paidCents, r.currency), width: 130 },
    { id: 'status', header: 'Status', accessor: (r) => orderStatusName(r.status), cell: (r) => <StatusPill status={orderStatusName(r.status)} />, width: 160 },
  ];
  return (
    <OctopusDataGrid
      label="Orders"
      rows={rows}
      columns={cols}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.code}
      loading={loading}
      onOpenRow={open}
      defaultSort={{ id: 'date', desc: true }}
      emptyTitle="No orders yet"
      emptyDescription="Orders appear here after the customer accepts a quote or buys ready stock."
      headingLevel={3}
      hotkeys={false}
      pagination
      data-testid="customer-orders-grid"
    />
  );
}

export function InvoicesGrid({ rows, loading }: { rows: InvoiceRowVM[]; loading?: boolean }) {
  const open = useOpen<InvoiceRowVM>();
  const cols: GridColumn<InvoiceRowVM>[] = [
    { id: 'number', header: 'Invoice no.', accessor: (r) => r.number, cell: (r) => link(r.number, r.href), width: 160 },
    { id: 'type', header: 'Type', accessor: (r) => docTypeLabel(r.docType), width: 150 },
    { id: 'issued', header: 'Issued', accessor: (r) => r.issued, cell: (r) => date(r.issued), width: 110 },
    { id: 'due', header: 'Due', accessor: (r) => r.dueAt ?? '', cell: (r) => <span className={r.status === 'Overdue' ? 'font-semibold text-ods-danger' : undefined}>{date(r.dueAt)}</span>, width: 110 },
    { id: 'amount', header: 'Amount (US$)', numeric: true, accessor: (r) => r.amountCents, cell: (r) => money(r.amountCents, r.currency), width: 130 },
    { id: 'paid', header: 'Paid (US$)', numeric: true, accessor: (r) => r.paidCents, cell: (r) => money(r.paidCents, r.currency), width: 120 },
    { id: 'balance', header: 'Balance (US$)', numeric: true, accessor: (r) => r.balanceCents, cell: (r) => money(r.balanceCents, r.currency), width: 130 },
    { id: 'status', header: 'Status', accessor: (r) => r.status, cell: (r) => <StatusPill status={r.status} />, width: 130 },
  ];
  return (
    <OctopusDataGrid
      label="Invoices"
      rows={rows}
      columns={cols}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.number}
      loading={loading}
      onOpenRow={open}
      defaultSort={{ id: 'issued', desc: true }}
      emptyTitle="No invoices yet"
      headingLevel={3}
      hotkeys={false}
      pagination
      data-testid="customer-invoices-grid"
    />
  );
}

export function RfqsGrid({ rows, loading }: { rows: RfqRowVM[]; loading?: boolean }) {
  const open = useOpen<RfqRowVM>();
  const cols: GridColumn<RfqRowVM>[] = [
    { id: 'code', header: 'RFQ', accessor: (r) => r.code, cell: (r) => link(r.code, r.href), width: 130 },
    { id: 'title', header: 'Request', accessor: (r) => r.title, minWidth: 200 },
    { id: 'quantity', header: 'Quantity', accessor: (r) => r.quantity, width: 120 },
    { id: 'quotes', header: 'Quotes', numeric: true, accessor: (r) => r.quotes, width: 90 },
    { id: 'created', header: 'Sent', accessor: (r) => r.created, cell: (r) => date(r.created), width: 110 },
    { id: 'status', header: 'Status', accessor: (r) => requestStatusName(r.status), cell: (r) => <StatusPill status={requestStatusName(r.status)} />, width: 140 },
  ];
  return (
    <OctopusDataGrid
      label="RFQs"
      rows={rows}
      columns={cols}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.code}
      loading={loading}
      onOpenRow={open}
      defaultSort={{ id: 'created', desc: true }}
      emptyTitle="No requests yet"
      headingLevel={3}
      hotkeys={false}
      pagination
      data-testid="customer-rfqs-grid"
    />
  );
}

export function DocumentsGrid({ rows, loading }: { rows: DocumentRowVM[]; loading?: boolean }) {
  const open = useOpen<DocumentRowVM>();
  const cols: GridColumn<DocumentRowVM>[] = [
    { id: 'number', header: 'Document', accessor: (r) => r.number, cell: (r) => link(r.number, r.href), width: 170 },
    { id: 'type', header: 'Type', accessor: (r) => docTypeLabel(r.type), minWidth: 170 },
    { id: 'created', header: 'Date', accessor: (r) => r.created, cell: (r) => date(r.created), width: 110 },
    { id: 'amount', header: 'Amount (US$)', numeric: true, accessor: (r) => r.amountCents ?? 0, cell: (r) => (r.amountCents == null ? '—' : money(r.amountCents, r.currency)), width: 130 },
    { id: 'status', header: 'Status', accessor: (r) => r.status, cell: (r) => <span className="text-ods-table text-ods-text">{humanizeWord(r.status)}</span>, width: 120 },
  ];
  return (
    <OctopusDataGrid
      label="Documents"
      rows={rows}
      columns={cols}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.number}
      loading={loading}
      onOpenRow={open}
      defaultSort={{ id: 'created', desc: true }}
      emptyTitle="No documents yet"
      headingLevel={3}
      hotkeys={false}
      pagination
      data-testid="customer-documents-grid"
    />
  );
}
