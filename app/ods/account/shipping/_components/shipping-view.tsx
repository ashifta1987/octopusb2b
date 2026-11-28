'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorState, FilterPills, Skeleton, StatusPill, formatDate, type DataTableColumn } from '@octopus/ui';
import { SHIPPING_FILTERS, type ShippingFilter } from '../../_services/logic';

/** One shipment line: a B2B order shipment (shipments) or a shipped warehouse order (wh_orders). Customer-safe fields only. */
export type ShipmentRow = {
  id: string; kind: 'order' | 'warehouse'; code: string; title: string; ref: { label: string; href: string } | null;
  carrier: string | null; service: string | null; trackingNo: string | null; trackingHref: string | null;
  group: Exclude<ShippingFilter, 'all'>; status: { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo' };
  lastEvent: { text: string; at: string } | null; eta: string | null; updatedAt: string;
};
export type ShippingState = { kind: 'ready'; rows: ShipmentRow[] } | { kind: 'loading' } | { kind: 'error' };

const LABEL: Record<ShippingFilter, string> = { all: 'All', preparing: 'Preparing', in_transit: 'In transit', delivered: 'Delivered', problem: 'Problems' };

const columns: DataTableColumn<ShipmentRow>[] = [
  {
    id: 'shipment', header: 'Shipment', primary: true,
    cell: (r) => (
      <span className="flex flex-col">
        <span className="font-semibold">{r.title}</span>
        <span className="text-ods-small text-ods-slate tabular-nums">{r.code}{r.ref ? <> · <Link href={r.ref.href} className="text-ods-blue underline">{r.ref.label}</Link></> : null}</span>
      </span>
    ),
  },
  { id: 'service', header: 'Carrier and service', cell: (r) => [r.carrier, r.service].filter(Boolean).join(' · ') || '—', hideOnPhone: true },
  {
    id: 'tracking', header: 'Tracking',
    cell: (r) => r.trackingHref ? <Link href={r.trackingHref} target="_blank" className="font-semibold text-ods-blue underline">{r.trackingNo ?? 'Tracking page'}<span className="sr-only"> (opens in a new tab)</span></Link> : r.trackingNo ? <span className="tabular-nums">{r.trackingNo}</span> : <span className="text-ods-slate">Not yet</span>,
  },
  { id: 'status', header: 'Status', cell: (r) => <span className="flex flex-col items-start gap-1"><StatusPill tone={r.status.tone}>{r.status.label}</StatusPill>{r.lastEvent ? <span className="text-ods-small text-ods-slate">{r.lastEvent.text}</span> : null}{r.eta && r.group !== 'delivered' ? <span className="text-ods-small text-ods-slate">Arrives about {formatDate(r.eta)}</span> : null}</span> },
  { id: 'updated', header: 'Updated', sortable: true, sortValue: (r) => r.updatedAt, cell: (r) => formatDate(r.updatedAt) },
];

/** /account/shipping (Part 6.7, C_Shipping): shipments with tracking, FilterPills `?status=`. */
export function ShippingView({ state, status, syncUrl = true }: { state: ShippingState; status: ShippingFilter; syncUrl?: boolean }) {
  const [filter, setFilter] = useState<ShippingFilter>(status);
  useEffect(() => {
    if (!syncUrl) return;
    const u = new URL(window.location.href);
    if (filter === 'all') u.searchParams.delete('status'); else u.searchParams.set('status', filter);
    window.history.replaceState(null, '', u.toString());
  }, [filter, syncUrl]);
  if (state.kind === 'loading') return <div data-testid="shipping-list"><Skeleton lines={5} label="Loading your shipments" /></div>;
  if (state.kind === 'error') return <div data-testid="shipping-list"><ErrorState headingLevel={2} title="Your shipments could not be loaded" description="Reload the page. If it keeps happening, contact support." action={<Button variant="secondary" href="/account/shipping">Reload</Button>} /></div>;
  const rows = state.rows;
  const count = (f: ShippingFilter) => (f === 'all' ? rows.length : rows.filter((r) => r.group === f).length);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.group === filter);
  if (!rows.length) {
    return <div data-testid="shipping-list"><EmptyState icon={Truck} headingLevel={2} title="No shipments yet" description="Shipments of your orders and of your warehouse orders appear here with live tracking." action={<Button href="/shop" variant="secondary">Browse products</Button>} /></div>;
  }
  return (
    <section aria-labelledby="shipping-h" className="flex flex-col gap-4" data-testid="shipping-list">
      <h2 id="shipping-h" className="m-0 text-ods-h2 text-ods-navy">Shipments</h2>
      <FilterPills label="Filter shipments" mode="single" value={[filter]} onChange={(ids) => setFilter((ids[0] as ShippingFilter) ?? 'all')}
        items={SHIPPING_FILTERS.map((f) => ({ id: f, label: LABEL[f], count: count(f), testId: `shipping-filter-${f}` }))}
        resultText={`${shown.length} ${shown.length === 1 ? 'shipment' : 'shipments'}`} />
      {shown.length === 0
        ? <EmptyState headingLevel={3} title={`No ${LABEL[filter].toLowerCase()} shipments`} description="Choose another filter to see the rest." />
        : <DataTable columns={columns} rows={shown} getRowId={(r) => r.id} caption="Shipments" captionHidden getRowProps={(r) => ({ 'data-testid': `shipment-row-${r.code}` })} />}
    </section>
  );
}
