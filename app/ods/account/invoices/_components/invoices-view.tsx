import Link from 'next/link';
import {Card, EmptyState, Money, Skeleton, StatusPill } from '@octopus/ui';
import { OdsButton } from '../../orders/_components/ods-button';
import { curLabel, dateText, docPdfHref, moneyText, units } from '../../orders/_lib/commerce-format';
import { PageHead, PanelError } from '../../orders/_components/commerce-ui';
import { UrlFilterPills } from '../../orders/_components/url-controls';
import { INVOICE_FILTERS, invoiceCounts, invoicesHref, matchesInvoiceFilter, type InvoiceFilter } from '../_lib/invoice-logic';
import type { InvoiceRowWithKey } from '../_lib/loaders';
import { PayProformaButton, type PayProformaAction } from './pay-proforma';
import { SaasPlansCard, type SaasVM, type SubscribeSaasAction } from './saas-plans';
import { saasPanelVisible } from '../_lib/invoice-logic';

export type InvoicesViewProps = {
  filter: InvoiceFilter;
  status: 'ready' | 'loading' | 'error';
  rows?: InvoiceRowWithKey[] | null;
  payProforma?: PayProformaAction;
  base?: string;
  /** SaaS plans panel: undefined = not loaded here, null = failed on its own */
  saas?: SaasVM | null;
  subscribeSaas?: SubscribeSaasAction;
};

/** ODS /account/invoices (6.7, Match: C_Invoices + M_). Presentational. PDFs via today's /api/documents/[id]/pdf. */
export function InvoicesView({ filter, status, rows, payProforma, base = '/account/invoices', saas, subscribeSaas }: InvoicesViewProps) {
  const head = (
    <PageHead
      title="Invoices and documents"
      subtitle="Invoices, proformas, receipts, credit notes and statements."
      actions={
        <OdsButton href="/account/ledger/statement" variant="secondary" icon="download" data-testid="statement-download">
          Download statement (CSV)
        </OdsButton>
      }
    />
  );
  if (status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="invoices-page">
        {head}
        <Card title="Documents" headingLevel={2} loading>
          {null}
        </Card>
        <Skeleton className="sr-only" label="Loading documents" />
      </div>
    );
  }
  if (status === 'error' || !rows) {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="invoices-page">
        {head}
        <Card>
          <PanelError what="your documents" href={invoicesHref(filter, base)} headingLevel={2} />
        </Card>
      </div>
    );
  }
  const counts = invoiceCounts(rows);
  const shown = rows.filter((r) => matchesInvoiceFilter(r, filter));
  const pills = INVOICE_FILTERS.map(([id, label]) => ({ id, label, count: id === 'all' ? undefined : counts[id], testId: `invoices-filter-${id}` }));
  const hrefs = Object.fromEntries(INVOICE_FILTERS.map(([id]) => [id, invoicesHref(id, base)]));

  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="invoices-page">
      {head}
      <UrlFilterPills items={pills} value={filter} hrefs={hrefs} label="Filter documents" resultText={`${shown.length} of ${rows.length} documents`} testId="invoices-filters" />
      {filter === 'statements' ? (
        <Card className="mt-4" title="Account statement" headingLevel={2} data-testid="statement-card">
          <p className="m-0 text-ods-body text-ods-slate">Your statement lists every order, wallet and on-hold entry with opening and closing balances.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <OdsButton href="/account/ledger/statement" variant="secondary" icon="download">
              Download CSV (last 90 days)
            </OdsButton>
            <OdsButton href="/account/ledger/statement/print" variant="secondary" icon="file" target="_blank">
              Printable statement
            </OdsButton>
            <OdsButton href="/account/ledger" variant="ghost">
              Open the ledger
            </OdsButton>
          </div>
        </Card>
      ) : null}
      <section aria-labelledby="docs-h" className="mt-4 rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card" data-testid="invoices-list">
        <div className="px-4 py-4">
          <h2 id="docs-h" className="m-0 text-ods-h2 font-bold text-ods-navy">
            Documents
          </h2>
          <p className="m-0 mt-1 text-ods-small text-ods-slate">Issued by Shenzhen Octopus Trading Co., Ltd.</p>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No documents yet" description="Invoices and receipts appear here as soon as they are issued." />
        ) : shown.length === 0 ? (
          <EmptyState title="Nothing here" description="No documents match this filter." action={<OdsButton href={base} variant="secondary">Show all</OdsButton>} />
        ) : (
          <>
            <div className="hidden overflow-x-auto ods-tablet:block">
              <table className="w-full border-collapse text-ods-table">
                <caption className="sr-only">Documents</caption>
                <thead>
                  <tr className="h-ods-head border-y border-ods-line bg-ods-canvas text-ods-label text-ods-slate">
                    <th scope="col" className="px-4 text-start font-semibold">Number</th>
                    <th scope="col" className="px-3 text-start font-semibold">Type</th>
                    <th scope="col" className="px-3 text-start font-semibold">Service</th>
                    <th scope="col" className="px-3 text-start font-semibold">Date</th>
                    <th scope="col" className="px-3 text-end font-semibold">Amount</th>
                    <th scope="col" className="px-3 text-start font-semibold">Status</th>
                    <th scope="col" className="px-4 text-end font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="h-ods-row border-b border-ods-line last:border-b-0" data-testid="invoice-row" data-status={r.statusName} data-type={r.type}>
                      <th scope="row" className="px-4 text-start font-mono font-normal whitespace-nowrap text-ods-navy">{r.number}</th>
                      <td className="px-3">{r.typeLabel}</td>
                      <td className="px-3">
                        {r.service}
                        {r.forRef ? <span className="block whitespace-nowrap font-mono text-ods-small text-ods-slate">{r.forRef}</span> : null}
                      </td>
                      <td className="px-3 whitespace-nowrap">{dateText(r.createdAt)}</td>
                      <td className="px-3 text-end">{r.amountCents != null ? <Money amount={units(r.type === 'credit_note' ? -Math.abs(r.amountCents) : r.amountCents)} currency={curLabel(r.currency)} /> : '—'}</td>
                      <td className="px-3">
                        <StatusPill status={r.statusName} />
                      </td>
                      <td className="px-4 text-end">
                        <RowActions r={r} payProforma={payProforma} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul role="list" aria-label="Documents" className="m-0 flex list-none flex-col gap-3 p-3 ods-tablet:hidden">
              {shown.map((r) => (
                <li key={r.id} className="rounded-ods-card border border-ods-line p-4" data-testid="invoice-row" data-status={r.statusName} data-type={r.type}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="font-mono font-bold text-ods-navy">{r.number}</span>
                    <StatusPill status={r.statusName} />
                  </div>
                  <p className="m-0 mt-1 text-ods-small text-ods-slate">
                    {r.typeLabel} · {r.service} · {dateText(r.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    {r.amountCents != null ? <Money amount={units(r.type === 'credit_note' ? -Math.abs(r.amountCents) : r.amountCents)} currency={curLabel(r.currency)} className="font-bold" /> : <span />}
                    <RowActions r={r} payProforma={payProforma} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {saas === null ? (
        <Card className="mt-4">
          <PanelError what="the SaaS plans" href={invoicesHref(filter, base)} />
        </Card>
      ) : saas && subscribeSaas && saasPanelVisible(saas.plans.length, saas.subscriptions.length) ? (
        <SaasPlansCard saas={saas} subscribe={subscribeSaas} />
      ) : null}
      <p className="m-0 mt-3 text-ods-small text-ods-slate">
        Need an older statement? Use the{' '}
        <Link href="/account/ledger" className="font-semibold text-ods-blue underline">
          ledger
        </Link>{' '}
        with any date range.
      </p>
    </div>
  );
}

function RowActions({ r, payProforma }: { r: InvoiceRowWithKey; payProforma?: PayProformaAction }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {r.payableCents > 0 && r.idempotencyKey && payProforma ? (
        <PayProformaButton documentId={r.id} number={r.number} amountCents={r.payableCents} amountText={moneyText(r.payableCents, r.currency)} idempotencyKey={r.idempotencyKey} payProforma={payProforma} />
      ) : null}
      <OdsButton href={docPdfHref(r.id)} target="_blank" variant="secondary" size="sm" icon="download">
        PDF<span className="sr-only"> · {r.number}</span>
      </OdsButton>
    </span>
  );
}

