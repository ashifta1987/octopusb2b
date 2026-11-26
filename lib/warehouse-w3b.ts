/**
 * Warehouse OS · W3b (scale benches, packaging materials, multi-parcel packing, exceptions queue) — labels, shapes and pure
 * helpers shared by the staff screens. Client-safe (no server imports). The database (wh_* functions + RLS) decides what is allowed.
 */
import { money } from '@/lib/format';
import type { Tone } from '@/lib/warehouse-inbound';
import type { Box, EvidenceKind } from '@/lib/warehouse-orders';

// ───────── scale benches (board 17) ─────────
export type ScaleCheck = { reference_g: number; reading_g: number; tolerance_g: number; passed: boolean; note: string | null; by_name: string | null; at: string };
export type Bench = {
  id: string; code: string; name: string; max_g: number | null; check_tolerance_g: number; check_every_hours: number | null;
  status: 'ok' | 'locked'; locked_reason: string | null; locked_at: string | null; last_check_at: string | null; last_check_ok: boolean | null;
  last_pass_at: string | null; active: boolean; due: boolean; checks: ScaleCheck[];
};
export type ScaleStation = { warehouse_code: string; name: string; can_manage: boolean; can_check: boolean; can_unlock_failed: boolean; benches: Bench[] };
export type ScaleBoard = { stations: ScaleStation[] };
/** A bench as offered at a packing station. */
export type BenchOption = { id: string; code: string; name: string; status: 'ok' | 'locked'; locked_reason: string | null; max_g: number | null; due: boolean };

export const benchUsable = (b: Pick<BenchOption, 'status' | 'due'>) => b.status === 'ok' && !b.due;

export function benchState(b: Pick<Bench, 'status' | 'due' | 'active'>): [string, Tone] {
  if (!b.active) return ['Not in use', 'neutral'];
  if (b.status === 'locked') return ['Locked', 'bad'];
  if (b.due) return ['Check due', 'warn'];
  return ['Checked · OK', 'ok'];
}

/** Text of a bench in a station list: "BENCH-1 · Packing bench 1 (locked)". */
export function benchOptionText(b: BenchOption) {
  const state = b.status === 'locked' ? ' (locked — run the scale check)' : b.due ? ' (check due)' : '';
  return `${b.code} · ${b.name}${state}`;
}

/** The first bench a station may weigh on (null when none is usable). */
export const firstUsableBench = (benches: BenchOption[]) => benches.find(benchUsable)?.id ?? null;

/** Same rule as wh_scale_check(): pass when |reading − reference| ≤ tolerance. */
export function checkPasses(referenceG: number, readingG: number, toleranceG: number) {
  return Math.abs(readingG - referenceG) <= toleranceG;
}

// ───────── packaging materials (board 12) ─────────
export const MATERIAL_KINDS = ['box', 'mailer', 'tape', 'mark', 'filler', 'other'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  box: 'Box', mailer: 'Mailer', tape: 'Tape', mark: 'Mark or label', filler: 'Filler', other: 'Other',
};
export const MATERIAL_UNITS = ['each', 'roll', 'm', 'kg'] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];
export const UNIT_LABEL: Record<MaterialUnit, string> = { each: 'each', roll: 'rolls', m: 'metres', kg: 'kg' };
export const MOVE_LABEL: Record<string, string> = {
  receive: 'Received', adjust_in: 'Count +', adjust_out: 'Count −', consume: 'Used', return: 'Taken back',
};
export const USE_SOURCE_LABEL: Record<string, string> = { box: 'Box (automatic)', dg_mark: 'Battery mark (automatic)', manual: 'Added at the station' };

export type Material = {
  id: string; code: string; name: string; kind: MaterialKind; unit: MaterialUnit; box_id: string | null; box_code: string | null;
  on_hand: number; low_stock_at: number | null; low: boolean; charge_per_unit_cents: number | string | null; charge_set_at: string | null;
  auto_dg_mark: boolean; active: boolean; used_30d: number;
};
export type MaterialMove = {
  at: string; material: string; unit: MaterialUnit; kind: string; qty: number; delta: number; balance_after: number; reason: string | null;
  order_code: string | null; by_name: string | null;
};
export type MaterialStation = {
  warehouse_code: string; name: string; can_manage: boolean; can_receive: boolean; can_count: boolean; can_price: boolean;
  materials: Material[]; boxes_without_material: { id: string; code: string; name: string }[]; moves: MaterialMove[];
};
export type MaterialsBoard = { stations: MaterialStation[] };
export type MaterialOption = { id: string; code: string; name: string; kind: MaterialKind; unit: MaterialUnit; on_hand: number; box_id?: string | null };
export type MaterialUse = {
  id: string; material: string; name: string; unit: MaterialUnit; qty: number; source: string; parcel_seq?: number | null; voided: boolean;
  at?: string; by_name?: string | null;
};

/** Price per unit; an unset price stays "Not set" (never 0). */
export const chargeText = (cents: number | string | null | undefined) => (cents == null ? 'Not set' : money(Number(cents), 'USD'));

/** "12 rolls"; units follow the material. */
export const qtyText = (n: number, unit: MaterialUnit) => `${n.toLocaleString('en-US')} ${unit === 'each' ? '' : UNIT_LABEL[unit]}`.trim();

// ───────── station extras (W3a packing station) ─────────
export type PackExtras = {
  parcels: number; bench_required: boolean; weighed_bench: string | null; benches: BenchOption[]; materials: MaterialOption[]; usage: MaterialUse[];
};

// ───────── multi-parcel (board 14) ─────────
export type ParcelEvidence = { id: string; kind: EvidenceKind; path: string; at: string; retention_until: string; by_name: string | null; url?: string | null };
export type Parcel = {
  id: string; seq: number; status: 'open' | 'closed'; source: 'multi' | 'single'; box: Pick<Box, 'id' | 'code' | 'name' | 'tare_g'> | null;
  expected_weight_g: number | null; tolerance_g: number | null; measured_weight_g: number | null; weighed_by_name: string | null; bench: string | null;
  battery_mark: boolean; override_attempts: number; override_locked_at: string | null; override_by_id: string | null; override_by_name: string | null;
  override_reason: string | null; override_weight_g: number | null; override_at: string | null; closed_at: string | null; closed_by_name: string | null;
  items: { line_id: string; sku: string; name: string; qty: number }[]; dg: string[]; evidence: ParcelEvidence[];
  materials: { id: string; material: string; name: string; unit: MaterialUnit; qty: number; source: string; voided: boolean }[];
  supervisors: { id: string; name: string }[];
};
export type MultiLine = { id: string; sku: string; barcode: string | null; name: string; picked: number; packed: number; unit_weight_g: number | null; dg: string[] };
export type MultiParcel = {
  order: {
    id: string; code: string; warehouse_code: string; status: string; owner: string; ship_name: string; ship_country: string; store_order: string | null;
    store_order_cancelled: boolean | null; has_dangerous_goods: boolean; dg_kinds: string[]; measured_weight_g: number | null; expected_weight_g: number | null;
    override_locked_at: string | null; packed_at: string | null; packed_by_name: string | null; picked: number;
  };
  me: string; can_pack: boolean; can_reopen: boolean; can_unlock: boolean; bench_required: boolean;
  lines: MultiLine[]; parcels: Parcel[];
  boxes: (Box & { stock: number | null })[]; benches: BenchOption[]; materials: MaterialOption[];
};
export type MultiQueueRow = {
  id: string; code: string; owner: string; picked: number; packed: number; has_dangerous_goods: boolean; status: string; parcels: number;
};

/** Parcel weight state, same rule as wh_parcel_close(). */
export function parcelWeight(p: Pick<Parcel, 'expected_weight_g' | 'tolerance_g' | 'measured_weight_g' | 'override_at' | 'override_weight_g'>) {
  const diff = p.expected_weight_g != null && p.measured_weight_g != null ? p.measured_weight_g - p.expected_weight_g : null;
  const within = diff != null && p.tolerance_g != null ? Math.abs(diff) <= p.tolerance_g : null;
  const approved = p.override_at != null && p.override_weight_g === p.measured_weight_g;
  return { diff, within, approved, ok: p.measured_weight_g != null && (within === true || approved), needsApproval: p.measured_weight_g != null && within !== true && !approved };
}

/** Why a parcel can't close yet (undefined = it can). Mirrors wh_parcel_close() for the disabled-button reason. */
export function parcelCloseBlocker(p: Parcel, mark: boolean, me: string): string | undefined {
  if (p.status !== 'open') return 'This parcel is closed';
  if (!p.items.length) return 'Scan items into this parcel';
  if (!p.box) return 'Choose the box';
  const kinds = ['contents', 'sealed', 'scale'];
  if (!kinds.every((k) => p.evidence.some((e) => e.kind === k))) return 'Add the contents, sealed and scale photos';
  if (p.measured_weight_g == null) return 'Weigh the parcel';
  const w = parcelWeight(p);
  if (!w.ok) return p.expected_weight_g == null ? 'Expected weight unknown: a supervisor approves with a PIN' : 'Weight outside tolerance: a supervisor approves with a PIN';
  if (p.dg.length && !mark) return 'Apply the battery mark and tick it';
  if (w.approved && w.within !== true && p.override_by_id === me) return 'You approved this weight; another person closes the parcel';
  return undefined;
}

/** Why the order can't close yet (undefined = it can). Mirrors wh_parcels_close_order(). */
export function orderCloseBlocker(d: Pick<MultiParcel, 'lines' | 'parcels'>): string | undefined {
  if (!d.parcels.length) return 'Add a parcel first';
  const open = d.parcels.filter((p) => p.status === 'open').map((p) => p.seq);
  if (open.length) return `Close parcel${open.length > 1 ? 's' : ''} ${open.join(', ')} first`;
  const left = d.lines.reduce((n, l) => n + Math.max(0, l.picked - l.packed), 0);
  if (left > 0) return `${left} unit(s) are not in a parcel yet`;
  if (d.parcels.some((p) => !p.items.length)) return 'Remove the empty parcel';
  return undefined;
}

// ───────── exceptions (board 29) ─────────
export const EXCEPTION_KINDS = ['weight', 'receiving', 'label', 'stock', 'carrier', 'short_pick', 'other'] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
export const EXCEPTION_KIND_LABEL: Record<ExceptionKind, string> = {
  weight: 'Weight', receiving: 'Receiving', label: 'Label', stock: 'Stock', carrier: 'Carrier', short_pick: 'Short pick', other: 'Other',
};
/** Kinds staff can report by hand (short picks come from the picking screen). */
export const MANUAL_KINDS: ExceptionKind[] = ['weight', 'receiving', 'label', 'stock', 'carrier', 'other'];
export const EXCEPTION_STATUS: Record<string, [string, Tone]> = { open: ['Open', 'bad'], assigned: ['Assigned', 'warn'], resolved: ['Resolved', 'ok'] };
export type ExceptionAction = 'retry' | 'ship_short' | 'cancel' | 'unlock_override' | 'approve_lot' | 'close';
export const ACTION_LABEL: Record<ExceptionAction, string> = {
  retry: 'Pick again', ship_short: 'Ship what was picked', cancel: 'Cancel the order', unlock_override: 'Unlock the weight override',
  approve_lot: 'Approve the lot', close: 'Close (nothing to release)',
};
/** What releasing does, shown under the choice. */
export const ACTION_HINT: Record<ExceptionAction, string> = {
  retry: 'The order goes back to picking.',
  ship_short: 'The missing units are released; the order goes to packing with what was picked.',
  cancel: 'The order is cancelled and its stock reservation released.',
  unlock_override: 'A warehouse admin unlocks it; a supervisor can enter their PIN again at the station.',
  approve_lot: 'The lot is released for the approved quantity (a supervisor who did not count it).',
  close: 'Nothing is held by this exception; it is closed with your resolution.',
};
export type ExceptionRow = {
  id: string; code: string; warehouse_code: string; kind: ExceptionKind; status: 'open' | 'assigned' | 'resolved'; source: 'auto' | 'manual'; title: string;
  order: { id: string; code: string; status: string; owner: string } | null; parcel_seq: number | null; asn: string | null;
  lot: { code: string; qty: number; status: string; max: number | null } | null; client: string | null;
  owner_id: string | null; owner_name: string | null; raised_by_name: string | null; resolution: string | null; resolution_action: string | null;
  resolved_by_name: string | null; resolved_at: string | null; assigned_at: string | null; created_at: string;
  held: boolean; actions: ExceptionAction[]; can_resolve: boolean; can_unlock: boolean;
};
export type ExceptionsBoard = {
  exceptions: ExceptionRow[]; counts: Partial<Record<ExceptionKind, number>>; can_raise: string[];
  people: { id: string; name: string; warehouse_code: string }[];
};

/** "3 h", "2 d" — how long an exception has been open. */
export function ageText(fromIso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}
