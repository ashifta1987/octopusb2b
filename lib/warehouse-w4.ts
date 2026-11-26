/**
 * Warehouse OS · W4 (carriers and rules, parcel labels, label check, dispatch and freight, customer tracking) — labels, shapes and
 * pure helpers shared by the staff screens and the public tracking page. Client-safe (no server imports). The database (wh_*
 * functions + RLS) decides what is allowed.
 */
import type { Tone } from '@/lib/warehouse-inbound';
import type { ProductType } from '@/lib/carriers/rules';

export const CARRIERS = ['4px', 'yunexpress'] as const;
export type Carrier = (typeof CARRIERS)[number];
export const CARRIER_LABEL: Record<Carrier, string> = { '4px': '4PX', yunexpress: 'YunExpress' };
export const LEVELS = ['economy', 'standard', 'express'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = { economy: 'Economy', standard: 'Standard', express: 'Express' };

// ───────── carriers and rules (board 9) ─────────
export type CarrierService = {
  id: string; code: string; name: string; level: Level; max_weight_g: number | null; accepts_battery: boolean; accepts_liquid: boolean; active: boolean;
};
export type CarrierAccount = {
  id: string; carrier: Carrier; name: string; mode: 'sandbox' | 'live'; credential_env: string | null; active: boolean; updated_at: string;
  services: CarrierService[];
};
export type RuleRow = {
  seq: number; countries: string[]; product_type: ProductType; min_weight_g: number | null; max_weight_g: number | null;
  service_id: string; service_name: string; carrier: Carrier; text: string;
};
export type RuleVersion = {
  id: string; warehouse_code: string; version: number; status: 'pending_approval' | 'active' | 'superseded' | 'rejected'; note: string | null;
  fallback: { id: string; code: string; name: string; carrier: Carrier; account: string } | null;
  proposed_by: string | null; proposed_by_name: string | null; proposed_at: string; approved_by_name: string | null; approved_at: string | null;
  rejected_by_name: string | null; reject_reason: string | null; decided_at: string | null; rules: RuleRow[];
};
export type CarrierStation = {
  warehouse_code: string; name: string; city: string; can_manage: boolean; accounts: CarrierAccount[];
  active: RuleVersion | null; pending: RuleVersion | null; history: RuleVersion[];
};
export type CarriersBoard = { me: string; staging: boolean; stations: CarrierStation[] };

export const VERSION_STATUS: Record<RuleVersion['status'], [string, Tone]> = {
  pending_approval: ['Waiting for a second admin', 'warn'], active: ['Active', 'ok'], superseded: ['Replaced', 'neutral'], rejected: ['Rejected', 'bad'],
};

// ───────── labels, dispatch, freight, tracking (boards 11, 13) ─────────
export type ParcelLabel = {
  id: string; code: string; tracking_no: string; status: ShipmentStatus; carrier: Carrier; service_code: string; service_name: string; account_id: string;
  sandbox: boolean; label_path: string; weight_g: number | null; rule_reason: string | null; confirmed_at: string | null; handed_over_at: string | null;
  delivered_at: string | null; dispatch_code: string | null; created_at: string; created_by_name: string | null; printed: number;
};
export type ShipmentStatus = 'labelled' | 'confirmed' | 'handed_over' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned' | 'voided';
export const SHIPMENT_STATUS: Record<ShipmentStatus, [string, Tone]> = {
  labelled: ['Labelled · check the label', 'info'], confirmed: ['Label checked', 'ok'], handed_over: ['Handed over', 'ok'], in_transit: ['In transit', 'info'],
  out_for_delivery: ['Out for delivery', 'info'], delivered: ['Delivered', 'ok'], exception: ['Delivery problem', 'bad'], returned: ['Returned', 'warn'],
  voided: ['Voided', 'neutral'],
};
export type DispatchParcel = { id: string; seq: number; weight_g: number | null; box: string | null; pallet: string | null; label: ParcelLabel | null };
export type DispatchOrder = {
  id: string; code: string; warehouse_code: string; status: string; source: string; ship_country: string; owner: string; dg_kinds: string[];
  packed_at: string | null; parcels: DispatchParcel[];
};
export type ReadyLabel = ParcelLabel & { order_code: string; parcel_seq: number; ship_country: string; warehouse_code: string };
export type DispatchAccount = { id: string; warehouse_code: string; carrier: Carrier; name: string; mode: 'sandbox' | 'live' };
export type ManifestLine = { id: string; tracking_no: string; order_code: string; parcel_seq: number; weight_g: number | null; ship_country: string; service_name: string; status: ShipmentStatus; sandbox: boolean };
export type Dispatch = {
  id: string; code: string; warehouse_code: string; status: 'open' | 'handed_over' | 'cancelled'; manifest_no: string | null; handed_to: string | null;
  created_at: string; closed_at: string | null; closed_by_name: string | null; account: DispatchAccount | null; lines: ManifestLine[];
};
export type FreightPallet = {
  id: string; code: string; warehouse_code: string; status: 'open' | 'closed' | 'dispatched'; destination: string; gross_weight_g: number | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null; forwarder: string | null; reference: string | null; created_at: string;
  closed_at: string | null; dispatched_at: string | null; printed: number;
  orders: { order_id: string; order_code: string; ship_country: string; owner: string | null; parcels: number; weight_g: number | null }[];
};
export type OnTheWay = ReadyLabel & { tracking_token: string | null; last_event: { status: string; description: string; at: string } | null };
export type LabelScan = { code: string; result: string; order_code: string; at: string; by_name: string | null; exception: string | null };
export type DispatchBoard = {
  staging: boolean; can_dispatch: string[]; can_void: string[]; orders: DispatchOrder[]; accounts: DispatchAccount[]; ready: ReadyLabel[];
  dispatches: Dispatch[]; pallets: FreightPallet[]; on_the_way: OnTheWay[]; scans: LabelScan[];
};
export const SCAN_RESULT_LABEL: Record<string, string> = {
  ok: 'Matches', already: 'Already checked', wrong_parcel: 'Wrong parcel', wrong_order: 'Label of another order', voided: 'Voided label', unknown: 'Not our label',
};
export const PALLET_STATUS: Record<FreightPallet['status'], [string, Tone]> = { open: ['Building', 'info'], closed: ['Closed · ready', 'ok'], dispatched: ['Dispatched', 'neutral'] };
export const TRACKING_STATUSES = ['in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'info'] as const;
export const TRACKING_STATUS_LABEL: Record<string, string> = {
  handed_over: 'Handed over', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered', exception: 'Delivery problem',
  returned: 'Returned to sender', info: 'Update (no status change)',
};

// ───────── public tracking page (board 7) ─────────
export type PublicTracking = {
  order_ref: string; shipped_from_city: string; shipped_from_country: string; destination_country: string; status: string; status_label: string;
  shipped_at: string | null; sandbox: boolean; freight: boolean;
  parcels: { seq: number; tracking_no: string | null; status: string | null }[];
  events: { status: string; description: string; location: string | null; occurred_at: string; parcel: number | null }[];
};

/** "/t/<token>" for a shipped order (public, no sign-in). */
export const trackingPath = (token: string) => `/t/${token}`;

/** Label PDF path in the private bucket: <WH>/<WO-code>/P<seq>-<tracking>.pdf (same as the database check). */
export function labelPath(warehouse: string, orderCode: string, seq: number, trackingNo: string) {
  return `${warehouse}/${orderCode}/P${seq}-${trackingNo}.pdf`;
}

export const grams = (g: number | null | undefined) => (g == null ? '—' : `${g.toLocaleString('en-US')} g`);
export const kg = (g: number | null | undefined) => (g == null ? '—' : `${(g / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} kg`);
