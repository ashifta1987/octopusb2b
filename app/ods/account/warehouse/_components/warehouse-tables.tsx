'use client';

import Link from 'next/link';
import { DataTable, StatusPill, formatDate, formatNumber, type DataTableColumn } from '@octopus/ui';
import { coverText } from '@/lib/warehouse-w5';
import { stockLevel } from '../../_services/logic';

export type StockRow = { id: string; sku: string; name: string; on_hand: number; reserved: number; available: number; incoming: number; checking: number; days_cover: number | null; status: string };
export type InboundRow = { id: string; code: string; warehouse: string; expected_date: string; cartons: number | null; units: number; received: number | null; status: { key?: string; label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo' }; checking: number };
export type OutboundRow = { id: string; code: string; external_ref: string | null; ship_to: string; status: { key?: string; label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo' }; created_at: string; shipped_at: string | null; tracking_token: string | null; units: number };

const n = (v: number) => formatNumber(v);

const stockCols = (coverDays: number): DataTableColumn<StockRow>[] => [
  { id: 'product', header: 'Product', primary: true, cell: (r) => <span className="flex flex-col"><span className="font-semibold">{r.name}</span>{r.status !== 'active' ? <span className="text-ods-small text-ods-slate">Archived product (still holds stock)</span> : null}</span> },
  { id: 'sku', header: 'Your SKU', cell: (r) => <span className="tabular-nums">{r.sku}</span> },
  { id: 'on_hand', header: 'On hand', numeric: true, sortable: true, sortValue: (r) => r.on_hand, cell: (r) => n(r.on_hand) },
  { id: 'reserved', header: 'Reserved', numeric: true, cell: (r) => n(r.reserved), hideOnPhone: true },
  { id: 'available', header: 'Available', numeric: true, sortable: true, sortValue: (r) => r.available, cell: (r) => n(r.available) },
  { id: 'cover', header: 'Days of cover', cell: (r) => coverText(r.days_cover), hideOnPhone: true },
  {
    id: 'status', header: 'Status', cell: (r) => {
      const s = stockLevel(r, coverDays);
      return <span data-testid={s.id === 'low' ? 'low-stock' : s.id === 'out' ? 'out-of-stock' : undefined}><StatusPill tone={s.tone}>{s.label}</StatusPill></span>;
    },
  },
];

export function StockTable({ rows, coverDays }: { rows: StockRow[]; coverDays: number }) {
  return <div data-testid="stock-table"><DataTable columns={stockCols(coverDays)} rows={rows} getRowId={(r) => r.id} caption="Stock by product" captionHidden /></div>;
}

const inboundCols: DataTableColumn<InboundRow>[] = [
  { id: 'code', header: 'Stock notice', primary: true, cell: (r) => <span className="font-semibold tabular-nums">{r.code}</span> },
  { id: 'warehouse', header: 'Warehouse', cell: (r) => r.warehouse, hideOnPhone: true },
  { id: 'cartons', header: 'Cartons', numeric: true, cell: (r) => (r.cartons == null ? '—' : n(r.cartons)) },
  { id: 'units', header: 'Units', numeric: true, cell: (r) => n(r.units) },
  { id: 'arrives', header: 'Arrives', cell: (r) => formatDate(r.expected_date) },
  { id: 'status', header: 'Status', cell: (r) => <span className="flex flex-col items-start gap-1"><StatusPill tone={r.status.tone}>{r.status.label}</StatusPill>{r.checking > 0 ? <span className="text-ods-small text-ods-slate">{n(r.checking)} being checked</span> : null}{r.received != null ? <span className="text-ods-small text-ods-slate">{n(r.received)} received</span> : null}</span> },
];

export function InboundTable({ rows }: { rows: InboundRow[] }) {
  return <div data-testid="inbound-table"><DataTable columns={inboundCols} rows={rows} getRowId={(r) => r.id} caption="Inbound shipments" captionHidden /></div>;
}

const outboundCols: DataTableColumn<OutboundRow>[] = [
  { id: 'code', header: 'Order', primary: true, cell: (r) => <span className="flex flex-col"><span className="font-semibold tabular-nums">{r.code}</span>{r.external_ref ? <span className="text-ods-small text-ods-slate">Your ref {r.external_ref}</span> : null}</span> },
  { id: 'to', header: 'Ship to', cell: (r) => r.ship_to },
  { id: 'units', header: 'Units', numeric: true, cell: (r) => n(r.units), hideOnPhone: true },
  { id: 'created', header: 'Received', cell: (r) => formatDate(r.created_at), hideOnPhone: true },
  { id: 'status', header: 'Status', cell: (r) => <span className="flex flex-col items-start gap-1"><StatusPill tone={r.status.tone}>{r.status.label}</StatusPill>{r.shipped_at ? <span className="text-ods-small text-ods-slate">Shipped {formatDate(r.shipped_at)}</span> : null}</span> },
  {
    id: 'links', header: 'Links', cell: (r) => (
      <span className="flex flex-wrap gap-3">
        <Link href={`/account/warehouse?tab=orders&order=${r.code}`} className="font-semibold text-ods-blue underline">Packing record<span className="sr-only"> of {r.code}</span></Link>
        {r.tracking_token ? <Link href={`/t/${r.tracking_token}`} target="_blank" className="font-semibold text-ods-blue underline">Tracking<span className="sr-only"> for {r.code} (opens the page your customer sees)</span></Link> : null}
      </span>
    ),
  },
];

export function OutboundTable({ rows }: { rows: OutboundRow[] }) {
  return <div data-testid="outbound-table"><DataTable columns={outboundCols} rows={rows} getRowId={(r) => r.id} caption="Outbound orders" captionHidden /></div>;
}
