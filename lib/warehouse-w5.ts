/**
 * Warehouse OS · W5 (client portal Inventory, Returns, Integrations, Support; staff Returns screen) — labels, shapes and pure
 * helpers shared by the portal and the staff screens. Client-safe (no server imports). The database (wh_* functions + RLS)
 * decides what is allowed; nothing here grants anything.
 */
import type { Tone } from '@/lib/warehouse-inbound';
import { addressText } from '@/lib/warehouse-orders';

// ───────── inventory (board 18) ─────────
export type InventoryWarehouse = { warehouse_code: string; warehouse: string; on_hand: number; reserved: number; available: number };
export type InventorySku = {
  id: string; sku: string; name: string; barcode: string | null; image_path: string | null; status: string;
  weight_g: number | null; has_battery: boolean; has_liquid: boolean;
  on_hand: number; reserved: number; available: number; incoming: number; checking: number;
  shipped_30d: number;
  /** EMPTY (null) when nothing shipped in the last 30 days — unknown, never 0 */
  days_cover: number | null;
  by_warehouse: InventoryWarehouse[];
  /** signed URL (10 min), added by the page */
  image_url?: string | null;
};
export type Inventory = { skus: InventorySku[]; totals: { on_hand: number; reserved: number; available: number; incoming: number; checking: number } };

/** "12 days" / "Not enough history" (never "0 days" for an unknown rate). */
export function coverText(days: number | null): string {
  if (days == null) return 'Not enough history';
  return `${days.toLocaleString('en-US')} day${days === 1 ? '' : 's'}`;
}
/** Average units shipped a day over 30 days, one decimal ("0.4 a day"); empty without shipments. */
export function dailyText(shipped30: number): string {
  if (!shipped30) return 'No shipments in the last 30 days';
  const d = Math.round((shipped30 / 30) * 10) / 10;
  return `${shipped30.toLocaleString('en-US')} shipped in 30 days (${d.toLocaleString('en-US')} a day)`;
}

// ───────── returns (board 21) ─────────
export const RETURN_STATUSES = ['received', 'inspected', 'decided', 'done'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const DECISIONS = ['restock', 'discard', 'send_back'] as const;
export type Decision = (typeof DECISIONS)[number];
export const CONDITIONS = ['good', 'damaged', 'unsellable'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** What the client reads. */
export const RETURN_STATUS_CLIENT: Record<string, [string, Tone]> = {
  received: ['Received · being inspected', 'info'],
  inspected: ['Waiting for your decision', 'warn'],
  decided: ['Decided · the warehouse is on it', 'info'],
  done: ['Done', 'ok'],
};
/** What staff read. */
export const RETURN_STATUS_STAFF: Record<string, [string, Tone]> = {
  received: ['Received · inspect it', 'warn'],
  inspected: ['Waiting for the client', 'info'],
  decided: ['Decided · carry it out', 'warn'],
  done: ['Done', 'ok'],
};
export const DECISION_LABEL: Record<Decision, string> = { restock: 'Restock', discard: 'Discard', send_back: 'Send back to me' };
export const DECISION_STAFF: Record<Decision, string> = { restock: 'Restock', discard: 'Discard', send_back: 'Send back' };
export const DECISION_HINT: Record<Decision, string> = {
  restock: 'Units graded good go back into your stock; damaged or unsellable units are disposed of.',
  discard: 'Every unit is disposed of. Nothing goes back into your stock.',
  send_back: 'We pack the returned units and ship them to the address you give, with packing proof and tracking.',
};
export const CONDITION_LABEL: Record<string, string> = { unchecked: 'Not inspected yet', good: 'Good', damaged: 'Damaged', unsellable: 'Unsellable' };
/** Days the client has to decide after the inspection (same as the database: inspection + 14 days). */
export const DECIDE_DAYS = 14;

export type ReturnLine = { id: string; sku: string; name: string; qty: number; condition: string; lot_code?: string | null };
export type ReturnRow = {
  id: string; code: string; org_id: string; warehouse_code: string; warehouse: string | null;
  order_code: string | null; order_ref: string | null; carrier_ref: string | null; reason: string | null;
  status: ReturnStatus; condition_note: string | null; decide_by: string | null; overdue: boolean;
  decision: Decision | null; decision_source: 'client' | 'default' | null; decided_at: string | null;
  send_back_to: { ship_name: string; ship_phone: string | null; ship_country: string; ship_address: Record<string, string> } | null;
  outbound_order: { code: string; status: string; tracking_token: string | null } | null;
  charge_units: number | null; charge_per_item_cents: number | null; charge_cents: number | null;
  created_at: string; inspected_at: string | null; done_at: string | null;
  units: number; good_units: number;
  lines: ReturnLine[];
  photos: { path: string; at: string; url?: string | null }[];
  // staff only
  owner?: string; done_note?: string | null; received_by_name?: string | null; inspected_by_name?: string | null; done_by_name?: string | null;
};
export type ReturnsBoard = {
  returns: ReturnRow[];
  counts: { received: number; inspected: number; decided: number; overdue: number };
  clients: { org_id: string; name: string }[];
  skus: { id: string; org_id: string; sku: string; name: string; status: string }[];
  can_returns: string[]; can_default: string[];
  warehouses: { code: string; name: string }[];
};

/** What the decision did, in one sentence (both sides). */
export function decisionOutcome(r: Pick<ReturnRow, 'decision' | 'units' | 'good_units' | 'status' | 'outbound_order'>): string {
  if (!r.decision) return '';
  const bad = r.units - r.good_units;
  if (r.decision === 'restock') {
    const s = `${r.good_units} good unit${r.good_units === 1 ? '' : 's'} ${r.status === 'done' ? 'went' : 'go'} back into stock`;
    return bad > 0 ? `${s}; ${bad} damaged or unsellable unit${bad === 1 ? '' : 's'} ${r.status === 'done' ? 'were' : 'are'} disposed of.` : `${s}.`;
  }
  if (r.decision === 'discard') return `${r.units} unit${r.units === 1 ? '' : 's'} ${r.status === 'done' ? 'were' : 'are'} disposed of.`;
  return r.outbound_order ? `Sent back on order ${r.outbound_order.code}.` : `${r.units} unit${r.units === 1 ? '' : 's'} will be sent back.`;
}

/** One-line send-back destination ("Erika Muster · Hauptstraße 5, Berlin, 10115, DE"). */
export function sendBackText(r: Pick<ReturnRow, 'send_back_to'>): string {
  const s = r.send_back_to;
  return s ? `${s.ship_name} · ${addressText(s.ship_address, s.ship_country)}` : '';
}

/** Return photo path: <WH>/<RT-code>/<uuid>.<ext> (checked again by the storage policy and wh_return_add_photo). */
export function returnPhotoPath(warehouse: string, code: string, uuid: string, mime: string): string | null {
  const ext = imageExt(mime);
  if (!ext || !/^[A-Z]{2,4}-\d{2}$/.test(warehouse) || !/^RT-\d{4,}$/.test(code) || !/^[0-9a-f-]{36}$/.test(uuid)) return null;
  return `${warehouse}/${code}/${uuid}.${ext}`;
}
/** Product photo path: <org id>/<client SKU id>/<uuid>.<ext> (checked again by the storage policy and wh_set_sku_image). */
export function productPhotoPath(orgId: string, skuId: string, uuid: string, mime: string): string | null {
  const ext = imageExt(mime);
  const id = /^[0-9a-f-]{36}$/;
  if (!ext || !id.test(orgId) || !id.test(skuId) || !id.test(uuid)) return null;
  return `${orgId}/${skuId}/${uuid}.${ext}`;
}
export function imageExt(mime: string): 'jpg' | 'png' | 'webp' | null {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : null;
}
export const RETURN_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

// ───────── support (board 24) ─────────
export const SUPPORT_KINDS = ['order_problem', 'inbound', 'return', 'billing', 'other'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];
export const SUPPORT_KIND_LABEL: Record<SupportKind, string> = {
  order_problem: 'Order problem', inbound: 'Stock notice / inbound', return: 'Return', billing: 'Billing', other: 'Something else',
};
export type SupportRow = {
  id: string; code: string; subject: string; status: string; kind: SupportKind; ref: string | null; created_at: string; updated_at: string; messages: number;
};
export type TicketContext = {
  kind: SupportKind; owner?: string | null;
  order: { code: string; status: string; external_ref: string | null; warehouse_code: string; packed: boolean; photos: number; tracking_token: string | null } | null;
  asn: { code: string; status: string; warehouse_code: string } | null;
  return: { code: string; status: string; decision: Decision | null; warehouse_code: string } | null;
} | null;

/** The warehouse reference typed or chosen in the form: WO-… / ASN-… / RT-… (or nothing). */
export function refKind(ref: string): 'order' | 'asn' | 'return' | null {
  const r = ref.trim().toUpperCase();
  return /^WO-\d{6,}$/.test(r) ? 'order' : /^ASN-\d{4,}$/.test(r) ? 'asn' : /^RT-\d{4,}$/.test(r) ? 'return' : null;
}

// ───────── integrations (board 23) ─────────
export type IntegrationState = 'available' | 'link' | 'not_yet';
export const INTEGRATION_STATE: Record<IntegrationState, [string, Tone]> = {
  available: ['Available now', 'ok'],
  link: ['Octopus service', 'info'],
  not_yet: ['Not available yet', 'neutral'],
};
/**
 * Every platform on board 23 with its honest status. Store connectors are not built: no connect button, no fake state.
 * (Public pages must not claim them at all; inside the signed-in portal they are listed as "Not available yet".)
 */
export const STORE_PLATFORMS = ['Shopify', 'WooCommerce', 'Wix', 'TikTok Shop', 'eBay'] as const;
