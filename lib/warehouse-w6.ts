/**
 * Warehouse OS · W6 — shared shapes and helpers for the monthly 3PL invoice (staff run + portal board 22), the warehouse
 * reports (board 30) and the retention summary. Money is integer US cents from the database; nothing here invents a number.
 */

export type ChargeKind = 'receiving' | 'storage' | 'pick_first' | 'pick_extra' | 'materials' | 'returns' | 'minimum';
export type LineStatus = 'billable' | 'not_set' | 'not_measured';

export type ChargeRef =
  | { type: 'asn'; id: string; code: string; at: string; qty: number | null }
  | { type: 'order'; id: string; code: string; ref: string | null; at: string; qty: number; units: number }
  | { type: 'material'; id: string; name: string; order_id: string | null; order_code: string | null; at: string; qty: number }
  | { type: 'return'; id: string; code: string; at: string; qty: number }
  | { type: 'pallet'; id: string; code: string; from: string; to: string; days: number };

export type PreviewLine = {
  kind: ChargeKind;
  warehouse_code: string | null;
  label_key: string | null;
  unit_label: string | null;
  qty: number | null;
  unit_cents: number | null;
  amount_cents: number | null;
  rate_version_id: string | null;
  rate_version: number | null;
  status: LineStatus;
  description: string;
  refs: ChargeRef[];
};

export type IssuedLine = {
  id: string; seq: number; kind: ChargeKind; warehouse_code: string | null; description: string; unit_label: string | null;
  qty: number; unit_cents: number; amount_cents: number; rate_version: number | null; refs: ChargeRef[];
};

export type IssuedInvoice = {
  id: string; org_id: string; period: string; document_id: string; number: string; status: string | null;
  amount_cents: number; paid_cents: number; currency: string; issued_at: string;
  subtotal_cents: number; minimum_cents: number | null; topup_cents: number; total_cents: number;
  tax_invoice: { id: string; number: string } | null; issued_by?: string | null; lines: IssuedLine[];
};

export type InvoicePreview = {
  org_id: string; period: string; plan: string; client_status: string; client: string | null; month_closed: boolean;
  lines: PreviewLine[]; subtotal_cents: number; topup_cents: number; total_cents: number; unbilled_count: number;
  minimum: { cents: number | null; rate_version: number | null; applies: boolean; status: 'set' | 'not_set' };
  can_issue: boolean; invoice: IssuedInvoice | null;
};

export type BoardClient = {
  org_id: string; name: string; plan: string; status: string; subtotal_cents: number; topup_cents: number; total_cents: number;
  billable_count: number; unbilled_count: number;
  invoice: { id: string; number: string; status: string | null; amount_cents: number; paid_cents: number } | null;
};
export type InvoiceBoard = { period: string; month_closed: boolean; can_issue: boolean; clients: BoardClient[] };

export const KIND_LABEL: Record<ChargeKind, string> = {
  receiving: 'Receiving', storage: 'Storage', pick_first: 'Pick and pack', pick_extra: 'Pick and pack',
  materials: 'Packaging', returns: 'Returns', minimum: 'Monthly minimum',
};

export const PLAN_LABEL: Record<string, string> = { standard: 'Standard', volume: 'Volume', custom: 'Custom' };

/** The sentence staff see instead of an amount when a line is not billed. */
export function unbilledText(s: LineStatus): string | null {
  return s === 'not_set' ? 'Not set — not charged' : s === 'not_measured' ? 'Not measured — not charged' : null;
}

/** "2026-10-01" → "October 2026" (calendar month, no time zone shift). */
export function monthLabel(period: string): string {
  const [y, m] = period.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** First day of a month as YYYY-MM-01 from "YYYY-MM" (or YYYY-MM-DD); null when malformed. */
export function parseMonth(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec((v ?? '').trim());
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** The current month in China time and the 12 before it (newest first), as YYYY-MM-01. */
export function monthOptions(nowMs: number, count = 13): string[] {
  const china = new Date(nowMs + 8 * 3600_000);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}

/** The last finished month in China time (the one to invoice), YYYY-MM-01. */
export function lastClosedMonth(nowMs: number): string {
  return monthOptions(nowMs, 2)[1];
}

/** Quantities: whole numbers plainly, pallet-months with up to 4 decimals. */
export function fmtQty(q: number | string | null | undefined): string {
  if (q == null || q === '') return '—';
  const n = Number(q);
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function unitWord(unit: string | null | undefined, qty: number | null | undefined): string {
  const u = unit || 'unit';
  return Number(qty) === 1 ? u : u === 'pallet-month' ? 'pallet-months' : u.endsWith('s') ? u : `${u}s`;
}

/** What a reference is, in words, and where the client can open it in the portal (null = nothing to open). */
export function refText(r: ChargeRef): { label: string; detail: string; href: string | null } {
  switch (r.type) {
    case 'asn': return { label: `Stock notice ${r.code}`, detail: r.qty == null ? 'cartons not recorded' : `${r.qty} carton${r.qty === 1 ? '' : 's'}`, href: '/account/warehouse?tab=send' };
    case 'order': return { label: `Order ${r.code}${r.ref ? ` · ${r.ref}` : ''}`, detail: `${r.units} item${r.units === 1 ? '' : 's'} packed`, href: `/account/warehouse?tab=orders&order=${encodeURIComponent(r.code)}` };
    case 'material': return { label: `${r.name}${r.order_code ? ` · order ${r.order_code}` : ''}`, detail: `${r.qty} used`, href: r.order_code ? `/account/warehouse?tab=orders&order=${encodeURIComponent(r.order_code)}` : null };
    case 'return': return { label: `Return ${r.code}`, detail: `${r.qty} item${r.qty === 1 ? '' : 's'}`, href: '/account/warehouse?tab=returns' };
    case 'pallet': return { label: `Pallet ${r.code}`, detail: `${Number(r.days).toLocaleString('en-US', { maximumFractionDigits: 2 })} day${Number(r.days) === 1 ? '' : 's'} stored`, href: null };
  }
}

/** Staff-side link for a reference (warehouse screens). */
export function staffRefHref(r: ChargeRef): string | null {
  switch (r.type) {
    case 'asn': return `/office/warehouse/receive/${encodeURIComponent(r.code)}`;
    case 'order': return `/office/warehouse/orders/${encodeURIComponent(r.code)}`;
    case 'material': return r.order_code ? `/office/warehouse/orders/${encodeURIComponent(r.order_code)}` : null;
    case 'return': return `/office/warehouse/returns?status=all&r=${encodeURIComponent(r.code)}`;
    case 'pallet': return null;
  }
}

export const DOC_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'warn' },
  part_paid: { label: 'Part paid', tone: 'info' },
  invoiced: { label: 'Paid', tone: 'ok' },
  paid: { label: 'Paid', tone: 'ok' },
  void: { label: 'Void', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const docStatus = (s: string | null | undefined) => DOC_STATUS[s ?? ''] ?? { label: s ?? '—', tone: 'neutral' as const };
/** What is still to pay on a proforma (0 when paid, void or cancelled). */
export function amountDue(i: { status: string | null; amount_cents: number; paid_cents: number }): number {
  return ['awaiting_payment', 'part_paid'].includes(i.status ?? '') ? Math.max(0, Number(i.amount_cents) - Number(i.paid_cents)) : 0;
}

// ───────── Reports (board 30) ─────────
export type TimeStat = { n: number; avg_h: number | null; median_h: number | null; target_h?: number | null; measured: number; within: number; open?: number };
export type ReportRow = {
  org_id: string | null; client: string; warehouse_code: string; warehouse: string | null;
  orders_shipped: number; units_shipped: number; handoff: TimeStat; dock_to_shelf: TimeStat;
  exceptions: { total: number; by_kind: Record<string, number> };
};
export type Report = {
  from: string; to: string; warehouse: string | null; org_id: string | null; rows: ReportRow[];
  totals: { orders_shipped: number; units_shipped: number; handoff: TimeStat; dock_to_shelf: TimeStat; exceptions: { total: number; by_kind: Record<string, number> } };
  targets: { warehouse_code: string; warehouse: string; dock_to_shelf_hours: number | null; handoff_hours: number | null }[];
  clients: { org_id: string; name: string }[];
};
export type RetentionRow = {
  warehouse_code: string; warehouse: string; evidence_retention_days: number; return_photo_retention_days: number | null;
  dock_to_shelf_target_hours: number | null; handoff_target_hours: number | null; can_edit: boolean;
  evidence_due: number; evidence_purged: number; return_photos_due: number; return_photos_purged: number;
};

export const EXCEPTION_KIND_LABEL: Record<string, string> = {
  weight: 'Weight', receiving: 'Receiving', label: 'Label', stock: 'Stock', carrier: 'Carrier', short_pick: 'Short pick', other: 'Other',
};

/** Share of measured items inside the target, 0–100 (null = no target / nothing measured — no bar). */
export function withinShare(s: TimeStat | null | undefined): number | null {
  if (!s || !s.measured) return null;
  return Math.round((Number(s.within) / Number(s.measured)) * 100);
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null) return '—';
  const n = Number(h);
  return n >= 48 ? `${(n / 24).toLocaleString('en-US', { maximumFractionDigits: 1 })} d` : `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
}

/** Date input values (YYYY-MM-DD) for a preset period, in China time. */
export function periodPreset(key: string, nowMs: number): { from: string; to: string } {
  const china = new Date(nowMs + 8 * 3600_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const y = china.getUTCFullYear(), m = china.getUTCMonth();
  if (key === 'last_month') return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
  if (key === 'last_30') return { from: ymd(new Date(china.getTime() - 29 * 86_400_000)), to: ymd(china) };
  return { from: ymd(new Date(Date.UTC(y, m, 1))), to: ymd(china) };
}

export function validYmd(v: string | null | undefined): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? (v as string) : null;
}

/** CSV rows for the report (one per client and warehouse, then the total). Hours as numbers; shares only with a target. */
export function reportCsvRows(r: Report): { head: string[]; rows: (string | number | null)[][] } {
  const kinds = Object.keys(EXCEPTION_KIND_LABEL);
  const head = ['Client', 'Warehouse', 'Orders shipped', 'Units shipped',
    'Order-to-handoff orders', 'Order-to-handoff average hours', 'Order-to-handoff median hours', 'Order-to-handoff within target %',
    'Dock-to-shelf notices', 'Dock-to-shelf average hours', 'Dock-to-shelf median hours', 'Dock-to-shelf within target %', 'Notices still being put away',
    'Exceptions', ...kinds.map((k) => `Exceptions: ${EXCEPTION_KIND_LABEL[k]}`)];
  const line = (client: string, wh: string, x: Pick<ReportRow, 'orders_shipped' | 'units_shipped' | 'handoff' | 'dock_to_shelf' | 'exceptions'>) => [
    client, wh, x.orders_shipped, x.units_shipped,
    x.handoff.n, x.handoff.avg_h, x.handoff.median_h, withinShare(x.handoff),
    x.dock_to_shelf.n, x.dock_to_shelf.avg_h, x.dock_to_shelf.median_h, withinShare(x.dock_to_shelf), x.dock_to_shelf.open ?? 0,
    x.exceptions.total, ...kinds.map((k) => x.exceptions.by_kind[k] ?? 0),
  ];
  return {
    head,
    rows: [...r.rows.map((x) => line(x.client, x.warehouse_code, x)), line('All clients', r.warehouse ?? 'All warehouses', r.totals)],
  };
}
