/**
 * Warehouse OS · W3a (orders, picking, packing with proof) — labels, shapes and pure helpers shared by the staff screens and the
 * client portal. Client-safe (no server imports). The database (wh_* functions + RLS) decides what is allowed.
 */
import type { Tone } from '@/lib/warehouse-inbound';

export const ORDER_STATUS: Record<string, [string, Tone]> = {
  new: ['Waiting for stock', 'warn'],
  allocated: ['Ready to pick', 'info'],
  picking: ['Picking', 'info'],
  picked: ['Ready to pack', 'info'],
  packing: ['Packing', 'info'],
  packed: ['Packed', 'ok'],
  labelled: ['Labelled', 'ok'],
  shipped: ['Shipped', 'ok'],
  exception: ['Exception', 'bad'],
  cancelled: ['Cancelled', 'neutral'],
};

/** What the client sees (portal step tracker): Received → Picking → Packed → Shipped. */
export const CLIENT_STATUS: Record<string, [string, Tone]> = {
  new: ['Received · waiting for stock', 'warn'],
  allocated: ['Received', 'info'],
  picking: ['Picking', 'info'],
  picked: ['Packing', 'info'],
  packing: ['Packing', 'info'],
  packed: ['Packed', 'ok'],
  labelled: ['Packed', 'ok'],
  shipped: ['Shipped', 'ok'],
  exception: ['On hold · we are checking it', 'warn'],
  cancelled: ['Cancelled', 'neutral'],
};

export const SOURCE_TEXT: Record<string, string> = {
  dropship: 'Octopus Dropship', client_portal: 'Portal form', client_csv: 'CSV upload', client_api: 'API',
};

export const SCAN_RESULT: Record<string, string> = {
  ok: 'Accepted', wrong_item: 'Not in this order', too_many: 'Too many', unknown_bin: 'Unknown bin', not_in_bin: 'Not in that bin', not_fifo: 'Older lot elsewhere',
};

export const EVIDENCE_KINDS = ['contents', 'sealed', 'scale'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const EVIDENCE_LABEL: Record<EvidenceKind, string> = { contents: 'Contents', sealed: 'Sealed box', scale: 'On the scale' };

export const DG_LABEL: Record<string, string> = { battery: 'Battery', liquid: 'Liquid', magnet: 'Magnet', powder: 'Powder' };

export const HISTORY_TEXT: Record<string, string> = {
  'wh_order.created': 'Order received',
  'wh_order.allocated': 'Stock reserved',
  'wh_order.allocation_waiting': 'Still waiting for stock',
  'wh_order.picking': 'Picking started',
  'wh_order.pick_recorded': 'Picked',
  'wh_order.picked': 'All items picked',
  'wh_order.short_pick': 'Short pick reported',
  'wh_order.exception_resolved': 'Exception resolved',
  'wh_order.cancelled': 'Cancelled',
  'wh_order.packing': 'Packing started',
  'wh_order.box_chosen': 'Box chosen',
  'wh_order.weighed': 'Weighed',
  'wh_order.evidence_added': 'Photo added',
  'wh_override.pin_wrong': 'Wrong supervisor PIN',
  'wh_override.locked': 'Override locked',
  'wh_override.unlocked': 'Override unlocked',
  'wh_override.approved': 'Weight approved by a supervisor',
  'wh_order.packed': 'Order packed',
  // W3b: parcels and packaging materials
  'wh_parcel.added': 'Parcel added',
  'wh_parcel.box_chosen': 'Parcel box chosen',
  'wh_parcel.weighed': 'Parcel weighed',
  'wh_parcel.evidence_added': 'Parcel photo added',
  'wh_parcel.item_removed': 'Item taken out of a parcel',
  'wh_parcel.pin_wrong': 'Wrong supervisor PIN (parcel)',
  'wh_parcel.override_locked': 'Parcel override locked',
  'wh_parcel.override_unlocked': 'Parcel override unlocked',
  'wh_parcel.override_approved': 'Parcel weight approved by a supervisor',
  'wh_parcel.closed': 'Parcel closed',
  'wh_parcel.reopened': 'Parcel reopened',
  'wh_parcel.removed': 'Empty parcel removed',
  'wh_material.used': 'Packaging used',
  'wh_material.voided': 'Packaging taken back',
  // W4: labels, label check, hand-over, freight, tracking
  'wh_label.created': 'Carrier label made',
  'wh_label.printed': 'Label printed',
  'wh_label.confirmed': 'Label checked against the order',
  'wh_label.wrong_scan': 'Wrong label scanned (refused)',
  'wh_label.voided': 'Label voided',
  'wh_order.labelled': 'All parcels labelled',
  'wh_dispatch.added': 'Added to a hand-over batch',
  'wh_dispatch.removed': 'Taken out of a hand-over batch',
  'wh_freight.added': 'Put on a freight pallet',
  'wh_freight.removed': 'Taken off a freight pallet',
  'wh_order.shipped': 'Shipped',
  'wh_tracking.event': 'Tracking update',
};

/** Client order steps for the portal tracker. */
export function clientSteps(status: string): { label: string; state: 'done' | 'current' | 'upcoming' }[] {
  const order = ['Received', 'Picking', 'Packed', 'Shipped'];
  const at = status === 'shipped' ? 3 : ['packed', 'labelled'].includes(status) ? 2 : ['picking', 'picked', 'packing'].includes(status) ? 1 : 0;
  return order.map((label, i) => ({ label, state: i < at || status === 'shipped' ? 'done' : i === at ? 'current' : 'upcoming' }));
}

/** Allowed difference in grams — same rule as wh_weight_tolerance(): max(fixed g, % of expected rounded up). */
export function weightTolerance(expected: number | null, tolG: number, tolPct: number): number | null {
  if (expected == null) return null;
  return Math.max(tolG, Math.ceil((expected * tolPct) / 100));
}

/** '1,250 g'; empty value stays a dash (never 0). */
export const grams = (g: number | null | undefined) => (g == null ? '—' : `${g.toLocaleString('en-US')} g`);

/** One-line address from a ship_address object (portal: line1/line2/city/region/postcode; Dropship: common key variants). */
export function addressText(a: Record<string, unknown> | null | undefined, country?: string | null): string {
  if (!a) return country ?? '';
  const pick = (...keys: string[]) => keys.map((k) => a[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  return [
    pick('line1', 'address1', 'address_line1', 'street'), pick('line2', 'address2', 'address_line2'),
    pick('city'), pick('region', 'state', 'province'), pick('postcode', 'postal_code', 'zip'), country ?? pick('country', 'country_code'),
  ].filter(Boolean).join(', ');
}

// ───────── shapes returned by the wh_* read functions ─────────
export type OrderRow = {
  id: string; code: string; warehouse_code: string; source: string; status: string; org_id: string | null; owner: string;
  store_order: string | null; store_order_cancelled: boolean | null; external_ref: string | null; ship_name: string; ship_country: string;
  has_dangerous_goods: boolean; dg_kinds: string[]; exception_reason: string | null; lines: number; units: number; picked: number; packed: number;
  override_locked: boolean; created_at: string; allocated_at: string | null; picked_at: string | null; packed_at: string | null;
};
export type OrdersBoard = {
  orders: OrderRow[]; counts: Record<string, number>; can_import: boolean;
  dropship_ready: { id: string; order_number: string; created_at: string; items: number; units: number }[];
};
export type DetailLine = {
  id: string; item_id: string; sku: string; barcode: string | null; name: string; qty: number; picked: number; short: number; packed: number;
  unit_weight_g: number | null; dg: string[]; suggest: { bin: string; lot: string; qty: number }[];
};
export type Box = { id: string; code: string; name: string; tare_g: number; length_mm: number | null; width_mm: number | null; height_mm: number | null; active?: boolean };
export type OrderDetail = {
  order: OrderRow & {
    ship_phone: string | null; ship_address: Record<string, unknown>; cancel_reason: string | null; cancelled_at: string | null;
    box: Box | null; expected_weight_g: number | null; tolerance_g: number | null; measured_weight_g: number | null; battery_mark: boolean;
    override_attempts: number; override_locked_at: string | null; override_by_id: string | null; override_by_name: string | null; override_reason: string | null;
    weighed_by_name: string | null;
    override_weight_g: number | null; override_at: string | null; created_by_name: string | null; packed_by_name: string | null;
  };
  me: string;
  settings: { tolerance_g: number; tolerance_pct: number; retention_days: number };
  can_pick: boolean; can_pack: boolean; can_resolve: boolean; can_unlock: boolean;
  lines: DetailLine[];
  picks: { sku: string; bin: string; lot: string; pallet: string | null; qty: number; by_name: string | null; at: string }[];
  scans: { station: 'pick' | 'pack'; code: string; result: string; qty: number; by_name: string | null; at: string }[];
  evidence: { id: string; kind: EvidenceKind; path: string; at: string; retention_until: string; by_name: string | null; url?: string | null }[];
  attempts: { ok: boolean; reason: string | null; supervisor_name: string | null; by_name: string | null; expected_g: number | null; measured_g: number | null; at: string }[];
  history: { action: string; at: string; by_name: string | null; details: Record<string, unknown> | null }[];
  boxes: Box[];
  supervisors: { id: string; name: string }[];
};
export type PickBoard = { can_pick: string[]; orders: OrderRow[] };
export type Station = {
  warehouse_code: string; name: string; tolerance_g: number; tolerance_pct: number; retention_days: number;
  can_settings: boolean; can_boxes: boolean; boxes: (Box & { active: boolean })[];
};
export type PackBoard = { can_pack: string[]; queue: OrderRow[]; can_set_pin: boolean; my_pin_set: boolean; my_pin_locked: boolean; stations: Station[] };
export type EvidenceRow = OrderRow & {
  expected_weight_g: number | null; measured_weight_g: number | null; tolerance_g: number | null; override: boolean;
  photos: number; kinds: string[]; retention_until: string | null;
};
export type EvidenceBoard = { orders: EvidenceRow[]; retention: { warehouse_code: string; name: string; days: number }[] };
export type PortalProof = {
  code: string; external_ref: string | null; status: string; packed_at: string | null; warehouse: string | null; packed: boolean; box: string | null;
  expected_weight_g: number | null; measured_weight_g: number | null; weight_check: 'within' | 'supervisor_approved' | null;
  battery_mark: boolean; has_dangerous_goods: boolean;
  evidence: { kind: EvidenceKind; path: string; at: string; retention_until: string; url?: string | null }[];
  scans: { sku: string; name: string; at: string }[]; retention_until: string | null;
};

// ───────── CSV upload (portal) ─────────
/** Column headers of the order CSV, in the template's order. One row per product; rows with the same order number form one order. */
export const ORDER_CSV_HEADERS = ['order_number', 'name', 'phone', 'address1', 'address2', 'city', 'region', 'postcode', 'country', 'sku', 'qty'] as const;
export const ORDER_CSV_TEMPLATE = `${ORDER_CSV_HEADERS.join(',')}\n`;
export const ORDER_CSV_MAX_BYTES = 1_000_000;

export type ParsedOrder = {
  external_ref: string | null;
  ship: { name: string; phone: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string };
  lines: { sku: string; qty: string }[];
  rows: number[];
};
export type CsvParse = { orders: ParsedOrder[]; errors: { row: number; message: string }[] };

/** RFC 4180-style CSV split (quotes, doubled quotes, commas and line breaks inside quotes). */
export function splitCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => x.trim() !== ''));
}

/**
 * Parses an order CSV into orders. Checks the shape only (headers, required cells, whole quantities, consistent address per
 * order); products, duplicates and addresses are checked again by the database (wh_validate_client_orders) for the preview.
 */
export function parseOrdersCsv(text: string, maxOrders = 200): CsvParse {
  const rows = splitCsv(text);
  const errors: CsvParse['errors'] = [];
  if (!rows.length) return { orders: [], errors: [{ row: 1, message: 'The file is empty.' }] };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = ORDER_CSV_HEADERS.filter((h) => !['phone', 'address2', 'region', 'postcode'].includes(h) && !head.includes(h));
  if (missing.length) return { orders: [], errors: [{ row: 1, message: `Missing column(s): ${missing.join(', ')}. Use the template.` }] };
  const col = (r: string[], h: string) => (head.indexOf(h) >= 0 ? (r[head.indexOf(h)] ?? '').trim() : '');
  const byRef = new Map<string, ParsedOrder>();
  const orders: ParsedOrder[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const ref = col(r, 'order_number');
    const ship = {
      name: col(r, 'name'), phone: col(r, 'phone'), line1: col(r, 'address1'), line2: col(r, 'address2'), city: col(r, 'city'),
      region: col(r, 'region'), postcode: col(r, 'postcode'), country: col(r, 'country').toUpperCase(),
    };
    const sku = col(r, 'sku').toUpperCase();
    const qty = col(r, 'qty');
    if (!ref) { errors.push({ row: rowNo, message: 'Order number is empty.' }); return; }
    if (!sku) { errors.push({ row: rowNo, message: 'SKU is empty.' }); return; }
    if (!/^\d{1,5}$/.test(qty) || Number(qty) < 1) { errors.push({ row: rowNo, message: `Quantity “${qty}” is not a whole number above 0.` }); return; }
    const known = byRef.get(ref);
    if (known) {
      const differs = (Object.keys(ship) as (keyof typeof ship)[]).some((k) => ship[k] && ship[k] !== known.ship[k]);
      if (differs) { errors.push({ row: rowNo, message: `Order ${ref} has a different address on this row.` }); return; }
      known.lines.push({ sku, qty });
      known.rows.push(rowNo);
      return;
    }
    if (!ship.name || !ship.line1 || !ship.city || !ship.country) {
      errors.push({ row: rowNo, message: `Order ${ref}: name, address1, city and country are required on its first row.` });
      return;
    }
    const o: ParsedOrder = { external_ref: ref, ship, lines: [{ sku, qty }], rows: [rowNo] };
    byRef.set(ref, o);
    orders.push(o);
  });
  if (orders.length > maxOrders) errors.push({ row: 1, message: `Up to ${maxOrders} orders per file (this file has ${orders.length}).` });
  return { orders, errors };
}

/** The JSON a parsed order is sent as (wh_create_client_orders / wh_validate_client_orders). */
export function orderPayload(o: ParsedOrder) {
  return { external_ref: o.external_ref, ship: o.ship, lines: o.lines.map((l) => ({ sku: l.sku, qty: l.qty })) };
}

/** Evidence object path: <warehouse>/<order code>/<kind>-<uuid>.<ext> (checked again by the storage policy and wh_add_evidence). */
export function evidencePath(warehouse: string, code: string, kind: EvidenceKind, uuid: string, mime: string): string | null {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : null;
  if (!ext || !/^[A-Z]{2,4}-\d{2}$/.test(warehouse) || !/^WO-\d{6,}$/.test(code)) return null;
  return `${warehouse}/${code}/${kind}-${uuid}.${ext}`;
}
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
