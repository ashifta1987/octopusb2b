'use client';

import { ExternalLink } from 'lucide-react';
import { Drawer, IconButton, Money, StatusPill, formatDate, type GridColumn } from '@octopus/ui';
import { AccountsListScreen, DetailRow, TabLink, type ListCtx, type ViewActions } from '../../_shared/accounts-list-screen';
import { JournalPanel, type JournalLoader } from '../../_shared/journal-panel';
import { journalViewAction } from '../../_shared/actions';
import { PAYMENTS_SPEC, PURPOSE_LABEL, applyListConditions, commonChips, currencyPrefix, type ListQuery, type ListResult, type PaymentRow } from '../../_shared/accounts-core';

export const PAYMENTS_PATH = '/office/accounts/payments';
const TABS = [
  ['payments', 'Orders, wallet & services'],
  ['proformas', 'Service proformas'],
] as const;
const STATUS_LABEL: Record<string, string> = { pending: 'Pending', paid: 'Paid', failed: 'Failed', refunded: 'Refunded' };

export type PaymentsScreenProps = {
  basePath?: string;
  extraParams?: Record<string, string>;
  query: ListQuery;
  result: ListResult<PaymentRow>;
  /** today's finance:export → /admin/finance/export?type=payments */
  exportMonth: string | null;
  openRow?: PaymentRow | null;
  viewActions?: ViewActions;
  loadJournal?: JournalLoader;
};

const invoiceLink = (r: PaymentRow, ctx: ListCtx<PaymentRow>) =>
  r.documentId ? (
    <TabLink href={`/office/accounts/invoices?open=${r.documentId}`} title={r.documentNumber ?? 'Invoice'} onOpen={ctx.openTab}>
      {r.documentNumber ?? 'Open invoice'}
    </TabLink>
  ) : (
    <span className="text-ods-slate">—</span>
  );

/** ODS T9 · Accounts › Payments (read-only): recorded payments with links to the invoice / order. */
export function PaymentsScreen({ basePath = PAYMENTS_PATH, extraParams, query, result, exportMonth, openRow, viewActions, loadJournal = journalViewAction }: PaymentsScreenProps) {
  const proformas = query.tab === 'proformas';
  const columns = (ctx: ListCtx<PaymentRow>): GridColumn<PaymentRow>[] => [
    {
      id: 'reference',
      header: 'Reference',
      width: 180,
      sortable: false,
      accessor: (r) => r.reference ?? r.id.slice(0, 8),
      cell: (r) => (
        <button type="button" onClick={() => ctx.open(r.id)} className="max-w-full truncate rounded-[4px] font-mono font-semibold text-ods-navy hover:underline">
          {r.reference ?? `PAY-${r.id.slice(0, 8).toUpperCase()}`}
        </button>
      ),
    },
    { id: 'date', header: 'Date', width: 110, accessor: (r) => r.at, cell: (r) => formatDate(r.at, { short: true }) },
    { id: 'customer', header: 'Customer', width: 190, sortable: false, accessor: (r) => r.customer },
    { id: 'purpose', header: 'For', width: 140, sortable: false, accessor: (r) => r.purpose },
    { id: 'method', header: 'Method', width: 130, sortable: false, accessor: (r) => r.method },
    { id: 'invoice', header: proformas ? 'Proforma' : 'Invoice', width: 170, sortable: false, accessor: (r) => r.documentNumber, cell: (r) => invoiceLink(r, ctx) },
    proformas
      ? {
          id: 'taxinvoice',
          header: 'Tax invoice',
          width: 170,
          sortable: false,
          accessor: (r) => r.invoiceNumber,
          cell: (r) => (r.invoiceId ? <TabLink href={`/office/accounts/invoices?open=${r.invoiceId}`} title={r.invoiceNumber ?? 'Invoice'} onOpen={ctx.openTab}>{r.invoiceNumber ?? 'Open'}</TabLink> : <span className="text-ods-slate">—</span>),
        }
      : {
          id: 'order',
          header: 'Order',
          width: 120,
          sortable: false,
          accessor: (r) => r.orderCode,
          cell: (r) => (r.orderId ? <TabLink href={`/office/orders/${r.orderId}`} title={r.orderCode ?? 'Order'} onOpen={ctx.openTab}>{r.orderCode ?? 'Order'}</TabLink> : <span className="text-ods-slate">—</span>),
        },
    { id: 'amount', header: 'Amount', numeric: true, width: 140, accessor: (r) => r.amountMinor, cell: (r) => <Money amount={r.amountMinor / 100} currency={currencyPrefix(r.currency)} /> },
    { id: 'status', header: 'Status', width: 110, sortable: false, accessor: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
  ];
  return (
    <AccountsListScreen<PaymentRow>
      testId="payments-page"
      title="Payments"
      subtitle="Recorded payments, all services"
      pagePath={PAYMENTS_PATH}
      basePath={basePath}
      extraParams={extraParams}
      spec={PAYMENTS_SPEC}
      query={query}
      result={result}
      tabs={TABS}
      tabsLabel="Payment source"
      noun="payments"
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.reference ?? r.id}
      rowActions={(r, ctx) => [
        ...(r.documentId ? [{ id: 'inv', label: `Open ${r.documentNumber ?? 'invoice'}`, icon: ExternalLink, onSelect: () => ctx.openTab(`/office/accounts/invoices?open=${r.documentId}`, r.documentNumber ?? 'Invoice') }] : []),
        ...(r.orderId ? [{ id: 'order', label: `Open order ${r.orderCode ?? ''}`.trim(), icon: ExternalLink, onSelect: () => ctx.openTab(`/office/orders/${r.orderId}`, r.orderCode ?? 'Order') }] : []),
      ]}
      chips={commonChips(query, { status: (v) => `Status: ${STATUS_LABEL[v] ?? v}`, purpose: (v) => `For: ${PURPOSE_LABEL[v] ?? v}` })}
      filterFields={[
        { id: 'status', label: 'Status', options: Object.values(STATUS_LABEL) },
        { id: 'purpose', label: 'For', options: Object.values(PURPOSE_LABEL) },
        { id: 'customer', label: 'Customer' },
        { id: 'date', label: 'Date (YYYY-MM-DD)' },
      ]}
      applyConditions={(q, c) =>
        applyListConditions(q, PAYMENTS_SPEC, c, {
          status: Object.fromEntries(Object.entries(STATUS_LABEL).map(([k, v]) => [v, k])),
          purpose: Object.fromEntries(Object.entries(PURPOSE_LABEL).map(([k, v]) => [v, k])),
        })
      }
      exportItems={exportMonth ? [{ id: 'payments', label: `Payments ${exportMonth} (CSV)`, href: `/admin/finance/export?type=payments&month=${exportMonth}`, description: 'Today’s finance export (orders, wallet & services)' }] : undefined}
      openRow={openRow}
      builtinViews={[
        { id: 'builtin:all', label: 'All payments', filters: {} },
        { id: 'builtin:pending', label: 'Finance · pending', filters: { status: 'pending' } },
      ]}
      viewActions={viewActions}
      emptyTitle={proformas ? 'No proforma payments yet' : 'No payments yet'}
      emptyDescription="Payments appear when Finance records them or customers pay by card, wallet or bank transfer."
      searchPlaceholder="Search reference or customer"
      renderDrawer={(row, ctx) =>
        row ? (
          <Drawer
            open
            onClose={ctx.close}
            width={460}
            data-testid="record-drawer"
            title={row.reference ?? `PAY-${row.id.slice(0, 8).toUpperCase()}`}
            description={
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>Payment · {row.purpose}</span>
                <StatusPill status={row.status} />
              </span>
            }
            actions={<IconButton icon={ExternalLink} label="Open in a tab" tooltipSide="bottom" onClick={() => ctx.openTab(`${PAYMENTS_PATH}?open=${row.id}`, row.reference ?? 'Payment')} />}
          >
            <dl className="m-0 mb-4">
              <DetailRow k="Customer">{row.customer}</DetailRow>
              <DetailRow k="Amount">
                <Money amount={row.amountMinor / 100} currency={currencyPrefix(row.currency)} />
              </DetailRow>
              <DetailRow k="Date">{formatDate(row.at)}</DetailRow>
              <DetailRow k="Method">{row.method}</DetailRow>
              <DetailRow k="Reference">{row.reference ?? '—'}</DetailRow>
              <DetailRow k={row.source === 'document_payment' ? 'Proforma' : 'Invoice'}>{invoiceLink(row, ctx)}</DetailRow>
              {row.invoiceId ? (
                <DetailRow k="Tax invoice">
                  <TabLink href={`/office/accounts/invoices?open=${row.invoiceId}`} title={row.invoiceNumber ?? 'Invoice'} onOpen={ctx.openTab}>
                    {row.invoiceNumber ?? 'Open'}
                  </TabLink>
                </DetailRow>
              ) : null}
              <DetailRow k="Order">{row.orderId ? <TabLink href={`/office/orders/${row.orderId}`} title={row.orderCode ?? 'Order'} onOpen={ctx.openTab}>{row.orderCode ?? 'Open order'}</TabLink> : '—'}</DetailRow>
            </dl>
            <h3 className="mb-2 text-ods-body font-bold text-ods-navy">Ledger</h3>
            <JournalPanel by={row.journalId ? { journalId: row.journalId } : { refType: 'payment', refId: row.id }} load={loadJournal} onOpen={ctx.openTab} />
          </Drawer>
        ) : null
      }
    />
  );
}
