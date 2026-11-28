'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { Drawer, IconButton, Money, StatusPill, formatDate, type GridColumn } from '@octopus/ui';
import { AccountsListScreen, DetailRow, TabLink, type ListCtx, type ViewActions } from '../../_shared/accounts-list-screen';
import { CREDIT_SPEC, applyListConditions, commonChips, currencyPrefix, type CreditRow, type ListQuery, type ListResult } from '../../_shared/accounts-core';

export const CREDIT_NOTES_PATH = '/office/accounts/credit-notes';
const TABS = [
  ['issued', 'Issued'],
  ['waiting', 'Waiting for approval'],
  ['approved', 'Approved requests'],
  ['rejected', 'Rejected'],
] as const;

export type CreditNotesScreenProps = {
  basePath?: string;
  extraParams?: Record<string, string>;
  query: ListQuery;
  result: ListResult<CreditRow>;
  openRow?: CreditRow | null;
  viewActions?: ViewActions;
};

const amount = (r: CreditRow) => <Money amount={r.amountMinor / 100} currency={currencyPrefix(r.currency)} />;

/** ODS T9 · Accounts › Credit notes (read-only). */
export function CreditNotesScreen({ basePath = CREDIT_NOTES_PATH, extraParams, query, result, openRow, viewActions }: CreditNotesScreenProps) {
  const issued = query.tab === 'issued';
  const columns = (ctx: ListCtx<CreditRow>): GridColumn<CreditRow>[] => [
    {
      id: 'number',
      header: issued ? 'Credit note no.' : 'Request',
      width: 170,
      accessor: (r) => r.number,
      sortable: issued,
      cell: (r) => (
        <button type="button" onClick={() => ctx.open(r.id)} className="max-w-full truncate rounded-[4px] font-mono font-semibold text-ods-navy hover:underline">
          {r.number}
        </button>
      ),
    },
    { id: 'customer', header: 'Customer', width: 200, accessor: (r) => r.customer, sortable: false },
    issued
      ? {
          id: 'original',
          header: 'Original invoice',
          width: 170,
          sortable: false,
          accessor: (r) => (r.kind === 'document' ? r.originalNumber : null),
          cell: (r) =>
            r.kind === 'document' && r.originalId ? (
              <TabLink href={`/office/accounts/invoices?open=${r.originalId}`} title={r.originalNumber ?? 'Invoice'} onOpen={ctx.openTab}>
                {r.originalNumber ?? 'Open invoice'}
              </TabLink>
            ) : (
              <span className="text-ods-slate">—</span>
            ),
        }
      : { id: 'reason', header: 'Reason', width: 240, sortable: false, accessor: (r) => (r.kind === 'request' ? r.reason : r.reason) },
    {
      id: 'order',
      header: 'Order',
      width: 120,
      sortable: false,
      accessor: (r) => r.orderCode,
      cell: (r) => (r.orderId ? <TabLink href={`/office/orders/${r.orderId}`} title={r.orderCode ?? 'Order'} onOpen={ctx.openTab}>{r.orderCode ?? 'Order'}</TabLink> : <span className="text-ods-slate">—</span>),
    },
    { id: 'date', header: issued ? 'Issued' : 'Requested', width: 110, accessor: (r) => (r.kind === 'document' ? r.issuedAt : r.requestedAt), cell: (r) => formatDate(r.kind === 'document' ? r.issuedAt : r.requestedAt, { short: true }) },
    { id: 'amount', header: 'Amount', numeric: true, width: 140, accessor: (r) => r.amountMinor, cell: amount },
    { id: 'status', header: 'Status', width: 130, sortable: false, accessor: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    ...(issued
      ? [{ id: 'reason', header: 'Reason', width: 240, sortable: false, accessor: (r: CreditRow) => (r.kind === 'document' ? r.reason : null) }]
      : [{ id: 'requestedBy', header: 'Requested by', width: 150, sortable: false, accessor: (r: CreditRow) => (r.kind === 'request' ? r.requestedBy : null) }]),
  ];

  return (
    <AccountsListScreen<CreditRow>
      testId="credit-notes-page"
      title="Credit notes"
      subtitle="Issued credit notes and credit note requests"
      pagePath={CREDIT_NOTES_PATH}
      basePath={basePath}
      extraParams={extraParams}
      spec={CREDIT_SPEC}
      query={query}
      result={result}
      tabs={TABS}
      tabsLabel="Credit note status"
      noun="credit notes"
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.number}
      rowActions={(r, ctx) => [
        ...(r.kind === 'document' ? [{ id: 'pdf', label: 'View document', icon: FileText, onSelect: () => window.open(`/api/documents/${r.id}/pdf`, '_blank', 'noopener') }] : []),
        ...(r.orderId ? [{ id: 'order', label: `Open order ${r.orderCode ?? ''}`.trim(), icon: ExternalLink, onSelect: () => ctx.openTab(`/office/orders/${r.orderId}`, r.orderCode ?? 'Order') }] : []),
      ]}
      chips={commonChips(query)}
      filterFields={[{ id: 'customer', label: 'Customer' }, { id: 'date', label: 'Date (YYYY-MM-DD)' }]}
      applyConditions={(q, c) => applyListConditions(q, CREDIT_SPEC, c)}
      openRow={openRow}
      builtinViews={[
        { id: 'builtin:issued', label: 'Issued credit notes', filters: {} },
        { id: 'builtin:waiting', label: 'Finance · waiting for approval', filters: { tab: 'waiting' } },
      ]}
      viewActions={viewActions}
      emptyTitle={issued ? 'No credit notes yet' : 'No credit note requests here'}
      emptyDescription="Credit notes are requested and approved on Admin › Finance; issued ones appear here."
      searchPlaceholder={issued ? 'Search credit note no. or customer' : 'Search reason or customer'}
      renderDrawer={(row, ctx) =>
        row ? (
          <Drawer
            open
            onClose={ctx.close}
            width={460}
            data-testid="record-drawer"
            title={row.number}
            description={
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>{row.kind === 'document' ? 'Credit note' : 'Credit note request'}</span>
                <StatusPill status={row.status} />
              </span>
            }
            actions={<IconButton icon={ExternalLink} label="Open in a tab" tooltipSide="bottom" onClick={() => ctx.openTab(`${CREDIT_NOTES_PATH}?open=${row.id}`, row.number)} />}
          >
            <dl className="m-0">
              <DetailRow k="Customer">{row.customer}</DetailRow>
              <DetailRow k="Amount">{amount(row)}</DetailRow>
              <DetailRow k="Currency">{row.currency}</DetailRow>
              <DetailRow k="Order">{row.orderId ? <TabLink href={`/office/orders/${row.orderId}`} title={row.orderCode ?? 'Order'} onOpen={ctx.openTab}>{row.orderCode ?? 'Open order'}</TabLink> : '—'}</DetailRow>
              {row.kind === 'document' ? (
                <>
                  <DetailRow k="Issued">{formatDate(row.issuedAt)}</DetailRow>
                  <DetailRow k="Original invoice">
                    {row.originalId ? <TabLink href={`/office/accounts/invoices?open=${row.originalId}`} title={row.originalNumber ?? 'Invoice'} onOpen={ctx.openTab}>{row.originalNumber ?? 'Open invoice'}</TabLink> : '—'}
                  </DetailRow>
                  <DetailRow k="Reason">{row.reason ?? '—'}</DetailRow>
                </>
              ) : (
                <>
                  <DetailRow k="Requested">{formatDate(row.requestedAt)}{row.requestedBy ? ` · ${row.requestedBy}` : ''}</DetailRow>
                  <DetailRow k="Decided">{row.decidedAt ? `${formatDate(row.decidedAt)}${row.approvedBy ? ` · ${row.approvedBy}` : ''}` : '—'}</DetailRow>
                  <DetailRow k="Reason">{row.reason || '—'}</DetailRow>
                  <DetailRow k="Ledger">{row.journalId ? <TabLink href={`/office/accounts/ledger?open=j-${row.journalId}`} title="Journal" onOpen={ctx.openTab}>Open journal</TabLink> : '—'}</DetailRow>
                </>
              )}
            </dl>
            {row.kind === 'document' ? (
              <a href={`/api/documents/${row.id}/pdf`} target="_blank" rel="noopener" className="mt-3 inline-flex items-center gap-1 text-ods-small font-semibold text-ods-info underline">
                <FileText aria-hidden className="size-4" /> View document<span className="sr-only"> {row.number} (opens in a new tab)</span>
              </a>
            ) : row.status === 'Waiting' ? (
              <p className="mt-3 text-ods-small text-ods-slate">
                A different Finance user decides this on{' '}
                <TabLink href="/admin/finance" title="Finance" onOpen={ctx.openTab}>
                  Admin › Finance
                </TabLink>{' '}
                (today’s approval step; approving issues the credit note).
              </p>
            ) : null}
          </Drawer>
        ) : null
      }
    />
  );
}
