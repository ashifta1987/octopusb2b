'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';
import { EVIDENCE_KINDS, type EvidenceKind } from '@/lib/warehouse-orders';

/**
 * Warehouse OS · W3a staff actions (orders, handheld picking, packing station, evidence, override PIN, packing settings).
 * Every rule (roles per warehouse, steps, tolerance, PIN lock, dangerous goods, photos) is enforced by the wh_* functions.
 */
export type OrdResult = { ok: boolean; message?: string; error?: string; data?: unknown };
const fail = (m: string): OrdResult => ({ ok: false, error: cleanDbError(m) });
const ORDERS = '/office/warehouse/orders';
const PICK = '/office/warehouse/pick';
const PACK = '/office/warehouse/pack';
const EVIDENCE = '/office/warehouse/evidence';
const done = (message: string, data?: unknown, code?: string): OrdResult => {
  for (const p of [ORDERS, PICK, PACK, EVIDENCE, '/office/warehouse']) revalidatePath(p);
  if (code) { revalidatePath(`${ORDERS}/${code}`); revalidatePath(`${EVIDENCE}/${code}`); }
  return { ok: true, message, data };
};
const uuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
type Scan = { ok: boolean; result: string; message: string; status?: string };

export async function importDropshipAction(storeOrderId: string): Promise<OrdResult> {
  await requireWarehouseStaff(ORDERS);
  if (!uuid(storeOrderId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_import_dropship_order', { p_store_order: storeOrderId });
  if (error) return fail(error.message);
  const d = data as { code: string; status: string; existing: boolean; store_order?: string };
  if (d.existing) return done(`${d.code} already exists for this Dropship order.`, d, d.code);
  return done(d.status === 'allocated' ? `${d.code} created from ${d.store_order} and its stock is reserved.` : `${d.code} created from ${d.store_order}; it waits for stock at an active warehouse.`, d, d.code);
}

export async function retryAllocationAction(orderId: string, code: string): Promise<OrdResult> {
  await requireWarehouseStaff(ORDERS);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_retry_allocation', { p_order: orderId });
  if (error) return fail(error.message);
  const d = data as { allocated: boolean; warehouse: string | null };
  return d.allocated ? done(`Stock reserved at ${d.warehouse}.`, d, code) : { ok: false, error: 'Still not enough available stock at any active warehouse.' };
}

export async function startPickAction(orderId: string, code: string): Promise<OrdResult> {
  await requireWarehouseStaff(PICK);
  const sb = await createClient();
  const { error } = await sb.rpc('wh_start_pick', { p_order: orderId });
  if (error) return fail(error.message);
  return done(`Picking ${code}.`, null, code);
}

export async function pickScanAction(f: { orderId: string; code: string; bin: string; item: string; qty: number }): Promise<OrdResult> {
  await requireWarehouseStaff(PICK);
  if (!f.bin.trim()) return { ok: false, error: 'Scan or type the bin.' };
  if (!f.item.trim()) return { ok: false, error: 'Scan or type the product.' };
  if (!Number.isInteger(f.qty) || f.qty < 1) return { ok: false, error: 'Pick a whole number of units (1 or more).' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pick_scan', { p_order: f.orderId, p_bin: f.bin.trim(), p_code: f.item.trim(), p_qty: f.qty });
  if (error) return fail(error.message);
  const d = data as Scan;
  if (!d.ok) { revalidatePath(`${ORDERS}/${f.code}`); return { ok: false, error: d.message, data: d }; }
  return done(d.status === 'picked' ? `${d.message}. ${f.code} is fully picked — take it to packing.` : `${d.message}.`, d, f.code);
}

export async function reportShortAction(orderId: string, code: string, lineId: string, reason: string): Promise<OrdResult> {
  await requireWarehouseStaff(PICK);
  if (!reason.trim()) return { ok: false, error: 'Say what you found (empty bin, damaged …).' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_report_short', { p_order: orderId, p_line: lineId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done(`${code} is stopped as an exception; a supervisor decides what happens next.`, null, code);
}

export async function resolveExceptionAction(orderId: string, code: string, action: 'retry' | 'ship_short' | 'cancel', reason: string): Promise<OrdResult> {
  await requireWarehouseStaff(ORDERS);
  if (!reason.trim()) return { ok: false, error: 'Enter the resolution.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_resolve_exception', { p_order: orderId, p_action: action, p_reason: reason.trim() });
  if (error) return fail(error.message);
  const d = data as { status: string };
  return done(action === 'retry' ? `${code} goes back to picking.` : action === 'ship_short' ? `${code} ships short; the missing units are released.` : `${code} cancelled; its stock is released.`, d, code);
}

export async function cancelOrderStaffAction(orderId: string, code: string, reason: string): Promise<OrdResult> {
  await requireWarehouseStaff(ORDERS);
  if (!reason.trim()) return { ok: false, error: 'Enter why the order is cancelled.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_cancel_order', { p_order: orderId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done(`${code} cancelled; its stock is released.`, null, code);
}

export async function packScanAction(orderId: string, code: string, item: string): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  if (!item.trim()) return { ok: false, error: 'Scan or type the product.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pack_scan', { p_order: orderId, p_code: item.trim() });
  if (error) return fail(error.message);
  const d = data as Scan & { all_scanned?: boolean };
  if (!d.ok) { revalidatePath(PACK); return { ok: false, error: d.message, data: d }; }
  return done(d.all_scanned ? `${d.message}. Every item is in the box.` : `${d.message}.`, d, code);
}

export async function setBoxAction(orderId: string, code: string, boxId: string): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  if (!uuid(boxId)) return { ok: false, error: 'Choose a box.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pack_set_box', { p_order: orderId, p_box: boxId });
  if (error) return fail(error.message);
  const d = data as { box: string; expected_g: number | null; tolerance_g: number | null };
  return done(d.expected_g == null
    ? `${d.box} chosen. Expected weight unknown (a product has no weight) — a supervisor approves the weight.`
    : `${d.box} chosen. Expected ${d.expected_g.toLocaleString('en-US')} g ± ${d.tolerance_g} g.`, d, code);
}

export async function weighAction(orderId: string, code: string, grams: number): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  if (!Number.isInteger(grams) || grams < 1) return { ok: false, error: 'Enter the scale reading in whole grams.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pack_weigh', { p_order: orderId, p_grams: grams });
  if (error) return fail(error.message);
  const d = data as { within: boolean | null; difference_g: number | null; tolerance_g: number | null };
  const g = grams.toLocaleString('en-US');
  const diff = d.difference_g ?? 0;
  return done(d.within ? `${g} g — inside tolerance.`
    : d.within === null ? `${g} g saved. The expected weight is unknown, so a supervisor approves it with a PIN.`
      : `${g} g is ${Math.abs(diff)} g ${diff > 0 ? 'over' : 'under'} (± ${d.tolerance_g} g allowed). Check the box, or ask a supervisor to approve with a PIN.`, d, code);
}

export async function overrideAction(f: { orderId: string; code: string; supervisorId: string; pin: string; reason: string }): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  if (!uuid(f.supervisorId)) return { ok: false, error: 'Choose the supervisor.' };
  if (!/^\d{4,8}$/.test(f.pin)) return { ok: false, error: 'The PIN has 4 to 8 digits.' };
  if (f.reason.trim().length < 3) return { ok: false, error: 'Enter why this weight is accepted.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_weight_override', { p_order: f.orderId, p_supervisor: f.supervisorId, p_pin: f.pin, p_reason: f.reason.trim() });
  if (error) return fail(error.message);
  const d = data as { ok: boolean; message: string; attempts_left?: number; locked?: boolean };
  if (!d.ok) { for (const p of [PACK, `${ORDERS}/${f.code}`]) revalidatePath(p); return { ok: false, error: d.message, data: d }; }
  return done(d.message, d, f.code);
}

export async function unlockOverrideAction(orderId: string, code: string, reason: string): Promise<OrdResult> {
  await requireWarehouseStaff(ORDERS);
  if (!reason.trim()) return { ok: false, error: 'Enter why the override is unlocked.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_unlock_override', { p_order: orderId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done(`Override unlocked for ${code}. A supervisor can enter their PIN again.`, null, code);
}

export async function addEvidenceAction(orderId: string, code: string, kind: EvidenceKind, path: string): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  if (!EVIDENCE_KINDS.includes(kind)) return { ok: false, error: 'Choose what the photo shows.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_add_evidence', { p_order: orderId, p_kind: kind, p_path: path });
  if (error) return fail(error.message);
  return done('Photo saved.', null, code);
}

export async function closeParcelAction(orderId: string, code: string, batteryMark: boolean): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  const sb = await createClient();
  const { error } = await sb.rpc('wh_pack_close', { p_order: orderId, p_battery_mark: batteryMark });
  if (error) return fail(error.message);
  return done(`${code} is packed. Its proof is on the Evidence screen.`, null, code);
}

export async function setMyPinAction(pin: string, confirm: string): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: 'Use 4 to 8 digits.' };
  if (pin !== confirm) return { ok: false, error: 'The two PINs are different.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_set_my_pin', { p_pin: pin });
  if (error) return fail(error.message);
  revalidatePath(PACK);
  return { ok: true, message: 'Your override PIN is set. Never share it; enter it yourself at the station.' };
}

export async function saveSettingsAction(f: { warehouse: string; toleranceG: number; tolerancePct: number; retentionDays: number }): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  if (![f.toleranceG, f.retentionDays].every(Number.isInteger) || !Number.isFinite(f.tolerancePct)) return { ok: false, error: 'Enter whole grams, a percentage and whole days.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_save_settings', { p_warehouse: f.warehouse, p_tolerance_g: f.toleranceG, p_tolerance_pct: f.tolerancePct, p_retention_days: f.retentionDays });
  if (error) return fail(error.message);
  return done('Packing settings saved. New boxes and photos use them.');
}

export async function saveBoxAction(f: {
  warehouse: string; id: string | null; code: string; name: string; lengthMm: string; widthMm: string; heightMm: string; tareG: string; active: boolean;
}): Promise<OrdResult> {
  await requireWarehouseStaff(PACK);
  const n = (v: string) => (v.trim() ? Number(v) : null);
  const dims = [n(f.lengthMm), n(f.widthMm), n(f.heightMm)];
  const tare = Number(f.tareG);
  if (!f.tareG.trim() || !Number.isInteger(tare) || tare < 0) return { ok: false, error: 'Enter the empty box weight in whole grams.' };
  if (dims.some((d) => d !== null && (!Number.isInteger(d) || d <= 0))) return { ok: false, error: 'Sides are whole millimetres.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_save_box', {
    p_warehouse: f.warehouse, p_id: f.id, p_code: f.code.trim(), p_name: f.name.trim(), p_length_mm: dims[0], p_width_mm: dims[1], p_height_mm: dims[2],
    p_tare_g: tare, p_active: f.active,
  });
  if (error) return fail(error.message);
  return done(f.id ? 'Box updated.' : 'Box added.');
}
