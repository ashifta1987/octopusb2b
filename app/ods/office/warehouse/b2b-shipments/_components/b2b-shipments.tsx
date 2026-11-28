'use client';
// ODS T9
/**
 * ODS T9 · B2B shipments list (Part 7.6: KPI strip + status tabs + grid; shipment details in a 460 px drawer).
 * Views: Shipments · Exceptions · Ready to ship (only with today's canSeeReadyToShip). Columns follow today's
 * b2bShippingAccess exactly (carrier / service / label / rate hidden from Support-only staff, F-05). Rows open the drawer
 * (events, waybill, label); "Create shipment" opens today's ?order= URL (orders:edit only).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ActivityFeed, Button, Drawer, FilterPills, KpiStrip, OctopusDataGrid, StatusPill, formatDate, type GridColumn } from '@octopus/ui';
import { money } from '@/lib/format';
import { packFallback } from '@/lib/warehouse-retire';
import { humanStatus, orderLink, shipmentColumnIds, shipmentStatusName, type B2bAccess, type B2bView, type ReadyRow, type ShipmentRow } from '../_lib/shipping-core';
import { InlineNotice, KeyValueList } from '../../../_components/sales-bits';

export type B2bShipmentsProps = {
  access: B2bAccess;
  view: B2bView;
  shipments: ShipmentRow[];
  ready: ReadyRow[];
  whMember: boolean;
  base: string;
  loading?: boolean;
  error?: boolean;
  sample?: boolean;
  /** Fixtures: open this shipment's drawer on load. */
  initialOpenId?: string | null;
};

export function B2bShipments({ access: a, view, shipments, ready, whMember, base, loading, error, sample, initialOpenId = null }: B2bShipmentsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const go = (h: string) => { if (!sample) start(() => router.replace(h)); };
  const exceptions = shipments.filter((x) => x.status === 'exception');
  const rows = view === 'exceptions' ? exceptions : shipments;
  const open = shipments.find((x) => x.id === openId) ?? null;
  const allowed = new Set(shipmentColumnIds(a));
  const at = (h: string) => `${base}${base.includes('?') ? '&' : '?'}${h}`;
  const createHref = (id: string) => (sample ? at(`order=${id}`) : `${base}?order=${id}`);

  const all: GridColumn<ShipmentRow>[] = [
    { id: 'code', header: 'Shipment', accessor: (r) => r.code, width: 130, cell: (r) => <span className="font-mono font-semibold text-ods-navy">{r.code}</span> },
    {
      id: 'order', header: 'Order', accessor: (r) => r.order?.code ?? r.dropshipOrder ?? '', width: 150,
      cell: (r) => {
        const l = orderLink(r, whMember, packFallback);
        return <span className="inline-flex items-center gap-1">{r.isDropship && !r.order ? <span className="text-ods-small text-ods-slate">Dropship</span> : null}{l.href ? <a href={l.href} onClick={(e) => e.stopPropagation()} className="font-mono text-ods-blue hover:underline">{l.label}</a> : <span className="font-mono">{l.label}</span>}</span>;
      },
    },
    { id: 'carrier', header: 'Carrier', accessor: (r) => r.carrierName ?? '', width: 130, cell: (r) => r.carrierName ?? '—' },
    { id: 'service', header: 'Service', accessor: (r) => r.serviceCode ?? '', width: 130, cell: (r) => <span className="truncate">{r.serviceCode ?? '—'}</span> },
    { id: 'waybill', header: 'Waybill', accessor: (r) => r.trackingNo ?? '', width: 160, cell: (r) => <span className="font-mono">{r.trackingNo ?? '—'}</span> },
    { id: 'rate', header: 'Rate', accessor: (r) => r.rateCents ?? 0, numeric: true, width: 110, cell: (r) => (r.rateCents == null ? '—' : money(r.rateCents, r.rateCurrency)) },
    { id: 'last', header: 'Last event', accessor: (r) => r.at, width: 230, cell: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{r.events[0]?.description ?? '—'}</span><span className="text-ods-small text-ods-slate">{formatDate(r.at)}</span></span> },
    { id: 'status', header: 'Status', accessor: (r) => shipmentStatusName(r.status), width: 210, cell: (r) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><StatusPill status={shipmentStatusName(r.status)} /><span className="text-ods-small text-ods-slate">{humanStatus(r.status)}</span></span> },
    { id: 'label', header: 'Label', accessor: (r) => (r.labelUrl ? 1 : 0), width: 90, cell: (r) => (r.labelUrl ? <a href={r.labelUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-ods-blue underline">Label</a> : '—') },
  ];
  const cols = all.filter((c) => allowed.has(c.id));

  const readyCols: GridColumn<ReadyRow>[] = [
    { id: 'code', header: 'Order', accessor: (r) => r.code, width: 220, cell: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="font-mono font-semibold">{r.code}</span><span className="truncate text-ods-small text-ods-slate">{r.title}</span></span> },
    { id: 'buyer', header: 'Buyer', accessor: (r) => r.buyer ?? '', width: 200, cell: (r) => <span className="truncate">{r.buyer ?? '—'} <span className="text-ods-slate">{r.buyerCountry ?? ''}</span></span> },
    ...(a.canSeeSuppliers ? [{ id: 'supplier', header: 'Supplier', accessor: (r: ReadyRow) => r.supplierCode ?? '', width: 120, cell: (r: ReadyRow) => <span className="font-mono">{r.supplierCode ?? '—'}</span> }] : []),
    { id: 'value', header: 'Value', accessor: (r) => r.totalCents, numeric: true, width: 130, cell: (r) => money(r.totalCents, r.currency) },
    { id: 'incoterm', header: 'Incoterm', accessor: (r) => r.incoterm ?? '', width: 100, cell: (r) => r.incoterm ?? '—' },
    { id: 'since', header: 'Ready since', accessor: (r) => r.readySince, width: 130, cell: (r) => formatDate(r.readySince) },
    ...(a.canEdit ? [{ id: 'create', header: 'Action', accessor: () => '', width: 160, sortable: false, cell: (r: ReadyRow) => <Button size="sm" href={createHref(r.id)}>Create shipment</Button> }] : []),
  ];

  const tabs = [
    { id: 'shipments', label: 'Shipments', count: shipments.length },
    { id: 'exceptions', label: 'Exceptions', count: exceptions.length },
    ...(a.canSeeReadyToShip ? [{ id: 'ready', label: 'Ready to ship', count: ready.length }] : []),
  ];

  return (
    <div className="grid min-w-0 gap-3">
      <KpiStrip
        variant="strip"
        label="B2B shipping"
        loading={loading}
        items={[
          ...(a.canSeeReadyToShip ? [{ label: 'Ready to ship', value: ready.length }] : []),
          { label: 'In transit', value: shipments.filter((x) => shipmentStatusName(x.status) === 'Shipped').length },
          { label: 'Exceptions', value: exceptions.length },
          { label: 'Delivered', value: shipments.filter((x) => x.status === 'delivered').length, hint: 'of the latest 50' },
        ]}
        data-testid="b2b-kpis"
      />
      {exceptions.length > 0 && view !== 'exceptions' ? (
        <InlineNotice tone="danger" role="status" testId="b2b-exceptions">
          <b>{exceptions.length} exception{exceptions.length === 1 ? '' : 's'}:</b> {exceptions.map((x) => `${x.trackingNo ?? x.code}${x.order?.code ? ` (${x.order.code})` : x.dropshipOrder ? ` (${x.dropshipOrder})` : ''}: ${x.events[0]?.description ?? 'exception'}`).join(' · ')}
        </InlineNotice>
      ) : null}
      <FilterPills label="View" mode="single" allowEmpty={false} value={[view]} onChange={(ids) => go(ids[0] === 'shipments' ? base : at(`view=${ids[0]}`))} items={tabs} data-testid="b2b-tabs" />
      {view === 'ready' ? (
        <OctopusDataGrid
          label="Ready to ship"
          rows={ready}
          columns={readyCols}
          getRowId={(r) => r.id}
          rowNumber={(r) => r.code}
          loading={loading || pending}
          error={error ? 'We couldn’t load the orders ready to ship.' : undefined}
          onRetry={sample ? undefined : () => router.refresh()}
          emptyTitle="No orders ready to ship"
          emptyDescription="Orders appear here once the balance is paid and they are moved to “ready to ship”."
          onOpenRow={a.canEdit ? (r) => (sample ? undefined : router.push(createHref(r.id))) : undefined}
          defaultSort={{ id: 'since', desc: false }}
          pagination
          headingLevel={2}
          data-testid="b2b-ready-grid"
        />
      ) : (
        <OctopusDataGrid
          label={view === 'exceptions' ? 'Exceptions' : 'Shipments'}
          rows={rows}
          columns={cols}
          getRowId={(r) => r.id}
          rowNumber={(r) => r.code}
          loading={loading || pending}
          error={error ? 'We couldn’t load the shipments.' : undefined}
          onRetry={sample ? undefined : () => router.refresh()}
          emptyTitle={view === 'exceptions' ? 'No exceptions' : 'No shipments yet'}
          emptyDescription="Tracking events come from the carrier (webhook, with an hourly check)."
          onOpenRow={(r) => setOpenId(r.id)}
          onOpenInDrawer={(r) => setOpenId(r.id)}
          defaultSort={{ id: 'last', desc: true }}
          pagination
          headingLevel={2}
          data-testid="b2b-shipments-grid"
        />
      )}
      <p className="m-0 text-ods-small text-ods-slate">Tracking events come from the carrier (webhook, with an hourly check). Older shipments of Dropship orders are listed for reference; new warehouse parcels are tracked in Dispatch and freight.</p>
      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        width={460}
        title={open ? `Shipment ${open.code}` : ''}
        description={open ? `Waybill ${open.trackingNo ?? '—'}` : undefined}
        data-testid="b2b-shipment-drawer"
        footer={open?.labelUrl ? <div className="flex justify-end"><Button size="sm" href={open.labelUrl} target="_blank">Print label (10 × 15 cm)</Button></div> : undefined}
      >
        {open ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2"><StatusPill status={shipmentStatusName(open.status)} /><span className="text-ods-small text-ods-slate">{humanStatus(open.status)}</span></div>
            <KeyValueList columns={1} rows={[
              ['Order', (() => { const l = orderLink(open, whMember, packFallback); return l.href ? <a href={l.href} className="font-mono text-ods-blue underline">{l.label}</a> : l.label; })()],
              ...(a.canSeeCarrier ? [['Carrier', open.carrierName], ['Service', open.serviceCode]] as [string, string | null][] : []),
              ...(a.canSeeRates ? [['Rate', open.rateCents == null ? null : money(open.rateCents, open.rateCurrency)]] as [string, string | null][] : []),
              ['Last update', formatDate(open.at)],
            ]} />
            <section aria-labelledby="b2b-ev">
              <h3 id="b2b-ev" className="m-0 mb-1 text-ods-body font-semibold text-ods-navy">Tracking events ({open.events.length})</h3>
              <ActivityFeed label="Tracking events" showTime emptyTitle="No tracking events yet"
                items={open.events.map((e, i) => ({ id: `e${i}`, title: `${humanStatus(e.status)}${e.description ? ` · ${e.description}` : ''}`, date: e.occurred_at, tone: e.status === 'delivered' ? 'success' : e.status === 'exception' || e.status === 'returned' ? 'danger' : 'info' }))} />
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
