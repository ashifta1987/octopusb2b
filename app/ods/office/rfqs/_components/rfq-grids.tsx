'use client';
/**
 * ODS T9 · RFQ record client parts: Lines grid (audit C4: ALL rfq_lines, read-only) and Quotes (grid + quote drawer).
 * The drawer hosts TODAY's QuoteForm unchanged, posting to TODAY's sendQuote (requests:create → RPC send_quote), bound to
 * this RFQ by the server page. Supplier column / options only with suppliers:view (`supplier-hidden` note otherwise).
 */
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FilePlus2 } from 'lucide-react';
import { Button, Card, Drawer, EmptyState, Money, OctopusDataGrid, StatusPill, formatDate, formatNumber, type GridColumn } from '@octopus/ui';
import { QuoteForm } from '@/components/backoffice/quote-form';
import type { ActionResult } from '@/components/backoffice/action-form';
import { currencyLabel, customisationLabel, quoteStatusName, type RfqLineVM } from '../_lib/rfq-core';
import type { QuoteRowVM, SupplierOption } from '../_lib/rfq-data';

const money = (minor: number | null, cur: string) => (minor == null ? <span className="text-ods-slate">—</span> : <Money amount={minor / 100} currency={currencyLabel(cur)} />);

export function LinesGrid({ rows, fromLines, currency, loading }: { rows: RfqLineVM[]; fromLines: boolean; currency: string; loading?: boolean }) {
  const cols: GridColumn<RfqLineVM>[] = [
    { id: 'line', header: 'Line', width: 64, numeric: true, accessor: (r) => r.lineNo },
    { id: 'title', header: 'Product', width: 260, accessor: (r) => r.title, cell: (r) => <span className="truncate font-semibold text-ods-navy" title={r.title}>{r.title}</span> },
    { id: 'qty', header: 'Quantity', width: 120, numeric: true, accessor: (r) => r.quantity, cell: (r) => `${formatNumber(r.quantity)} ${r.unit}` },
    { id: 'target', header: 'Target / unit', width: 130, numeric: true, accessor: (r) => r.targetMinor ?? -1, cell: (r) => money(r.targetMinor, currency) },
    {
      id: 'custom',
      header: 'Customisation',
      width: 200,
      sortable: false,
      accessor: (r) => r.customisation.join(', '),
      cell: (r) => (r.customisation.length ? r.customisation.map(customisationLabel).join(', ') : <span className="text-ods-slate">None</span>),
    },
    { id: 'notes', header: 'Notes', width: 240, sortable: false, accessor: (r) => r.notes ?? '', cell: (r) => (r.notes ? <span className="truncate" title={r.notes}>{r.notes}</span> : <span className="text-ods-slate">—</span>) },
  ];
  return (
    <div className="grid gap-2" data-testid="rfq-lines">
      <OctopusDataGrid<RfqLineVM>
        label={`Requested products · ${rows.length}`}
        rows={rows}
        columns={cols}
        getRowId={(r) => String(r.lineNo)}
        loading={loading}
        headingLevel={2}
        emptyTitle="No lines"
        defaultSort={{ id: 'line', desc: false }}
      />
      {!fromLines && !loading ? (
        <p className="m-0 text-ods-small text-ods-slate" data-testid="rfq-lines-fallback">
          This request has one product (the request itself). Requests sent from a quote list show every product here.
        </p>
      ) : null}
    </div>
  );
}

export type QuoteDrawerProps = {
  rfq: { code: string; title: string; quantity: number; unit: string; incoterm: string | null; statusRaw: string };
  gate: { ok: true } | { ok: false; reason: string };
  canSeeSuppliers: boolean;
  suppliers: SupplierOption[];
  currency: string;
  /** TODAY's sendQuote bound to this RFQ (server page) — fixtures pass `sample` instead */
  action?: (fd: FormData) => Promise<ActionResult>;
  sample?: boolean;
};

const sampleAction = async (): Promise<ActionResult> => ({ ok: true, message: 'Quote sent to the buyer (sample — nothing was saved).' });

export function QuotesPanel({ quotes, drawer, initialOpen }: { quotes: QuoteRowVM[]; drawer: QuoteDrawerProps; initialOpen?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(!!initialOpen);
  const close = () => {
    setOpen(false);
    if (sp.get('quote')) {
      const u = new URLSearchParams(sp.toString());
      u.delete('quote');
      router.replace(`${pathname}${u.size ? `?${u.toString()}` : ''}`, { scroll: false });
    }
  };
  const show = drawer.canSeeSuppliers;
  const cols: GridColumn<QuoteRowVM>[] = [
    { id: 'code', header: 'Quote', width: 120, accessor: (r) => r.code, cell: (r) => <span className="font-mono font-semibold text-ods-navy">{r.code}</span> },
    ...(show
      ? [{
          id: 'supplier',
          header: 'Supplier',
          width: 210,
          accessor: (r: QuoteRowVM) => (r.supplier.hidden ? '' : `${r.supplier.code} ${r.supplier.name}`),
          cell: (r: QuoteRowVM) =>
            r.supplier.hidden ? null : (
              <span className="flex min-w-0 flex-col leading-tight" data-testid="quote-supplier">
                <span className="font-mono">{r.supplier.code} · {r.supplier.country}</span>
                <span className="truncate text-ods-small text-ods-slate">{r.supplier.name}</span>
              </span>
            ),
        } satisfies GridColumn<QuoteRowVM>]
      : []),
    { id: 'unit', header: 'Unit price', width: 112, numeric: true, accessor: (r) => r.unitMinor, cell: (r) => money(r.unitMinor, r.currency) },
    { id: 'qty', header: 'Qty', width: 90, numeric: true, accessor: (r) => r.quantity, cell: (r) => formatNumber(r.quantity) },
    { id: 'ship', header: 'Shipping', width: 104, numeric: true, accessor: (r) => r.shippingMinor, cell: (r) => money(r.shippingMinor, r.currency) },
    { id: 'total', header: 'Total', width: 120, numeric: true, accessor: (r) => r.totalMinor, cell: (r) => <b className="font-semibold">{money(r.totalMinor, r.currency)}</b> },
    { id: 'lead', header: 'Lead', width: 100, accessor: (r) => r.leadDays ?? -1, cell: (r) => `${r.leadDays ?? '—'} d · ${r.incoterm ?? '—'}` },
    { id: 'valid', header: 'Valid until', width: 108, accessor: (r) => r.validUntil ?? '', cell: (r) => (r.validUntil ? formatDate(r.validUntil, { short: true }) : '—') },
    { id: 'status', header: 'Status', width: 110, accessor: (r) => r.statusRaw, cell: (r) => <StatusPill status={quoteStatusName(r.statusRaw)}>{r.statusRaw === 'viewed' ? 'Sent · viewed' : quoteStatusName(r.statusRaw)}</StatusPill> },
  ];
  return (
    <div className="grid gap-2" data-testid="rfq-quotes">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-ods-small text-ods-slate">Buyers see only “Verified factory · China (region)”. Quote validity comes from the quote_validity_days setting.</p>
        {drawer.gate.ok ? (
          <Button variant="primary" size="sm" iconStart={FilePlus2} onClick={() => setOpen(true)}>
            Add a quote
          </Button>
        ) : (
          <Button variant="secondary" size="sm" iconStart={FilePlus2} disabled disabledReason={drawer.gate.reason}>
            Add a quote
          </Button>
        )}
      </div>
      {!show ? (
        <p className="m-0 rounded-ods-control border border-ods-line bg-ods-surface px-3 py-2 text-ods-small text-ods-slate" data-testid="supplier-hidden">
          Supplier names are hidden. They need the Suppliers view permission.
        </p>
      ) : null}
      <OctopusDataGrid<QuoteRowVM>
        label={`Quotes · ${quotes.length}`}
        data-testid="rfq-quotes-grid"
        rows={quotes}
        columns={cols}
        getRowId={(r) => r.id}
        rowNumber={(r) => r.code}
        headingLevel={2}
        emptyTitle="No quotes yet"
        emptyDescription={drawer.gate.ok ? 'Add the first quote with “Add a quote”.' : drawer.gate.reason}
      />
      <QuoteDrawer open={open} onClose={close} {...drawer} />
    </div>
  );
}

function QuoteDrawer({ open, onClose, rfq, gate, canSeeSuppliers, suppliers, currency, action, sample }: QuoteDrawerProps & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const submit = sample ? sampleAction : action;
  return (
    <Drawer open onClose={onClose} width={460} data-testid="quote-drawer" title="Add a quote" description={`${rfq.code} · ${rfq.title}`}>
      <div className="grid gap-3">
        <dl className="m-0 grid grid-cols-2 gap-2 rounded-ods-control bg-ods-canvas p-3 text-ods-small">
          <div>
            <dt className="text-ods-slate">Quantity</dt>
            <dd className="m-0 font-semibold text-ods-navy">{formatNumber(rfq.quantity)} {rfq.unit}</dd>
          </div>
          <div>
            <dt className="text-ods-slate">Incoterm asked</dt>
            <dd className="m-0 font-semibold text-ods-navy">{rfq.incoterm ?? '—'}</dd>
          </div>
        </dl>
        {!gate.ok ? (
          <EmptyState headingLevel={3} title="Quotes can’t be added" description={gate.reason} />
        ) : !canSeeSuppliers ? (
          <EmptyState headingLevel={3} title="Choosing a supplier needs the Suppliers view permission" description="Ask an admin, or ask a colleague with that permission to add the quote." />
        ) : !submit ? null : (
          <QuoteForm idPrefix="oq" action={submit} suppliers={suppliers} defaultQty={rfq.quantity} defaultIncoterm={rfq.incoterm} unit={rfq.unit} currency={currency} />
        )}
        <p className="m-0 text-ods-small text-ods-slate">Buyers see only ‘Verified factory · China (region)’. Quote validity comes from the quote_validity_days setting.</p>
      </div>
    </Drawer>
  );
}

export function QuotesLoading() {
  return <Card as="section" title="Quotes" headingLevel={2} loading />;
}
