'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';
import { EVIDENCE_KINDS, type EvidenceKind } from '@/lib/warehouse-orders';
import { MANUAL_KINDS, MATERIAL_KINDS, MATERIAL_UNITS, type ExceptionAction, type ExceptionKind, type MaterialKind, type MaterialUnit } from '@/lib/warehouse-w3b';

/**
 * Warehouse OS · W3b staff actions (scale benches, packaging materials, multi-parcel packing, exceptions queue, bench reading at
 * the W3a station). Every rule (roles per warehouse, bench lock, stock never below 0, two people, resolution required) is enforced
 * by the wh_* database functions; these only shape the input and the sentence shown.
 */
export type W3bResult = { ok: boolean; message?: string; error?: string; data?: unknown };
const fail = (m: string): W3bResult => ({ ok: false, error: cleanDbError(m) });
const SCALE = '/office/warehouse/scale';
const MATERIALS = '/office/warehouse/materials';
const MULTI = '/office/warehouse/multi-parcel';
const EXCEPTIONS = '/office/warehouse/exceptions';
const PACK = '/office/warehouse/pack';
const ORDERS = '/office/warehouse/orders';
const done = (message: string, paths: string[], data?: unknown, code?: string): W3bResult => {
  for (const p of [...paths, '/office/warehouse']) revalidatePath(p);
  if (code) { revalidatePath(`${ORDERS}/${code}`); revalidatePath(`/office/warehouse/evidence/${code}`); }
  return { ok: true, message, data };
};
const uuid = (s: string | null | undefined) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
const g = (n: number) => `${n.toLocaleString('en-US')} g`;
type Scan = { ok: boolean; result: string; message: string; all_in_parcels?: boolean };

// ───────── scale benches ─────────
export async function saveBenchAction(f: {
  warehouse: string; id: string | null; code: string; name: string; maxG: string; toleranceG: string; everyHours: string; active: boolean;
}): Promise<W3bResult> {
  await requireWarehouseStaff(SCALE);
  const n = (v: string) => (v.trim() ? Number(v) : null);
  const tol = Number(f.toleranceG);
  if (!f.toleranceG.trim() || !whole(tol, 0, 1000)) return { ok: false, error: 'Enter the check tolerance in whole grams (0 to 1,000).' };
  const max = n(f.maxG);
  const every = n(f.everyHours);
  if (max !== null && !whole(max, 100, 1000000)) return { ok: false, error: 'Capacity is 100 g to 1,000,000 g, or leave it empty.' };
  if (every !== null && !whole(every, 1, 720)) return { ok: false, error: 'Check every 1 to 720 hours, or leave it empty.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_save_bench', {
    p_warehouse: f.warehouse, p_id: f.id, p_code: f.code.trim(), p_name: f.name.trim(), p_max_g: max, p_check_tolerance_g: tol,
    p_check_every_hours: every, p_active: f.active,
  });
  if (error) return fail(error.message);
  return done(f.id ? 'Bench saved. If its check settings changed it is locked until it passes a check.' : 'Bench added. It stays locked until it passes its first calibration check.', [SCALE, PACK, MULTI]);
}

export async function scaleCheckAction(f: { benchId: string; referenceG: string; readingG: string; note: string }): Promise<W3bResult> {
  await requireWarehouseStaff(SCALE);
  if (!uuid(f.benchId)) return { ok: false, error: 'Choose the bench.' };
  const ref = Number(f.referenceG);
  const read = Number(f.readingG);
  if (!f.referenceG.trim() || !whole(ref, 1, 1000000)) return { ok: false, error: 'Enter the reference weight in whole grams.' };
  if (!f.readingG.trim() || !whole(read, 0, 1000000)) return { ok: false, error: 'Enter what the scale shows in whole grams.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_scale_check', { p_bench: f.benchId, p_reference_g: ref, p_reading_g: read, p_note: f.note.trim() || null });
  if (error) return fail(error.message);
  const d = data as { bench: string; passed: boolean; difference_g: number; tolerance_g: number };
  const diff = `${d.difference_g > 0 ? '+' : ''}${d.difference_g} g`;
  if (!d.passed) {
    for (const p of [SCALE, PACK, MULTI]) revalidatePath(p);
    return { ok: false, error: `Failed: ${diff} (± ${d.tolerance_g} g allowed). ${d.bench} is locked until it passes a check.`, data: d };
  }
  return done(`Passed: ${diff} (± ${d.tolerance_g} g allowed). ${d.bench} can be used.`, [SCALE, PACK, MULTI], d);
}

/** W3a packing station reading on the chosen bench (bench is required once the warehouse has benches). */
export async function weighOnBenchAction(orderId: string, code: string, benchId: string | null, grams: number): Promise<W3bResult> {
  await requireWarehouseStaff(PACK);
  if (!whole(grams, 1, 1000000)) return { ok: false, error: 'Enter the scale reading in whole grams.' };
  if (benchId !== null && !uuid(benchId)) return { ok: false, error: 'Choose the scale bench.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pack_weigh_on', { p_order: orderId, p_bench: benchId, p_grams: grams });
  if (error) return fail(error.message);
  const d = data as { within: boolean | null; difference_g: number | null; tolerance_g: number | null; bench: string | null };
  const diff = d.difference_g ?? 0;
  const on = d.bench ? ` on ${d.bench}` : '';
  return done(d.within ? `${g(grams)}${on} — inside tolerance.`
    : d.within === null ? `${g(grams)}${on} saved. The expected weight is unknown, so a supervisor approves it with a PIN.`
      : `${g(grams)}${on} is ${Math.abs(diff)} g ${diff > 0 ? 'over' : 'under'} (± ${d.tolerance_g} g allowed). Check the box, or ask a supervisor to approve with a PIN.`,
  [PACK], d, code);
}

// ───────── packaging materials ─────────
export async function saveMaterialAction(f: {
  warehouse: string; id: string | null; code: string; name: string; kind: MaterialKind; unit: MaterialUnit; boxId: string | null;
  lowStockAt: string; autoDgMark: boolean; active: boolean;
}): Promise<W3bResult> {
  await requireWarehouseStaff(MATERIALS);
  if (!MATERIAL_KINDS.includes(f.kind)) return { ok: false, error: 'Choose what kind of material it is.' };
  if (!MATERIAL_UNITS.includes(f.unit)) return { ok: false, error: 'Choose the unit.' };
  const low = f.lowStockAt.trim() ? Number(f.lowStockAt) : null;
  if (low !== null && !whole(low, 0, 1000000)) return { ok: false, error: 'Low stock is a whole number, or leave it empty.' };
  if (f.boxId && !uuid(f.boxId)) return { ok: false, error: 'Choose the box.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_save_material', {
    p_warehouse: f.warehouse, p_id: f.id, p_code: f.code.trim(), p_name: f.name.trim(), p_kind: f.kind, p_unit: f.unit, p_box: f.boxId || null,
    p_low_stock_at: low, p_auto_dg_mark: f.autoDgMark, p_active: f.active,
  });
  if (error) return fail(error.message);
  return done(f.id ? 'Material saved.' : 'Material added with 0 on hand. Receive it to start counting stock.', [MATERIALS, PACK, MULTI]);
}

export async function receiveMaterialAction(materialId: string, qty: number, note: string): Promise<W3bResult> {
  await requireWarehouseStaff(MATERIALS);
  if (!uuid(materialId)) return { ok: false, error: 'Choose the material.' };
  if (!whole(qty, 1, 1000000)) return { ok: false, error: 'Receive a whole number (1 or more).' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_material_receive', { p_material: materialId, p_qty: qty, p_note: note.trim() || null });
  if (error) return fail(error.message);
  const d = data as { code: string; on_hand: number };
  return done(`${qty.toLocaleString('en-US')} × ${d.code} received. ${d.on_hand.toLocaleString('en-US')} on hand.`, [MATERIALS, PACK, MULTI], d);
}

export async function countMaterialAction(materialId: string, counted: number, reason: string): Promise<W3bResult> {
  await requireWarehouseStaff(MATERIALS);
  if (!uuid(materialId)) return { ok: false, error: 'Choose the material.' };
  if (!whole(counted, 0, 1000000)) return { ok: false, error: 'Enter the counted quantity (0 or more).' };
  if (!reason.trim()) return { ok: false, error: 'Say why the count changes (stock take, damaged …).' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_material_count', { p_material: materialId, p_counted: counted, p_reason: reason.trim() });
  if (error) return fail(error.message);
  const d = data as { code: string; on_hand: number; difference: number };
  return done(d.difference === 0 ? `${d.code}: the count matches (${d.on_hand}).` : `${d.code} counted: ${d.on_hand} on hand (${d.difference > 0 ? '+' : ''}${d.difference}).`, [MATERIALS], d);
}

/** Price per unit charged to the client; empty = not set. Entered in US$ (two decimals). */
export async function setMaterialChargeAction(materialId: string, price: string): Promise<W3bResult> {
  await requireWarehouseStaff(MATERIALS);
  if (!uuid(materialId)) return { ok: false, error: 'Choose the material.' };
  const t = price.trim();
  let cents: number | null = null;
  if (t) {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return { ok: false, error: 'Enter the price like 0.35, or leave it empty (not set).' };
    cents = Math.round(Number(t) * 100);
  }
  const sb = await createClient();
  const { error } = await sb.rpc('wh_set_material_charge', { p_material: materialId, p_cents: cents });
  if (error) return fail(error.message);
  return done(cents === null ? 'Price cleared — shown as “Not set”; uses are recorded without a charge.' : 'Price saved. New uses are charged at this price.', [MATERIALS]);
}

export async function recordMaterialAction(f: { orderId: string; code: string; parcelId: string | null; materialId: string; qty: number }): Promise<W3bResult> {
  await requireWarehouseStaff(PACK);
  if (!uuid(f.materialId)) return { ok: false, error: 'Choose the material.' };
  if (f.parcelId && !uuid(f.parcelId)) return { ok: false, error: 'Choose the parcel.' };
  if (!whole(f.qty, 1, 1000)) return { ok: false, error: 'Use 1 to 1,000 at a time.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pack_use_material', { p_order: f.orderId, p_parcel: f.parcelId, p_material: f.materialId, p_qty: f.qty });
  if (error) return fail(error.message);
  const d = data as { material: string; on_hand: number };
  return done(`${f.qty} × ${d.material} recorded for ${f.code}. ${d.on_hand} left.`, [PACK, MULTI, MATERIALS], d, f.code);
}

export async function voidMaterialAction(usageId: string, code: string, reason: string): Promise<W3bResult> {
  await requireWarehouseStaff(PACK);
  if (!uuid(usageId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!reason.trim()) return { ok: false, error: 'Say why it was not used.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_pack_void_material', { p_usage: usageId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done('Taken back into stock.', [PACK, MULTI, MATERIALS], null, code);
}

// ───────── multi-parcel ─────────
export async function addParcelAction(orderId: string, code: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcel_add', { p_order: orderId });
  if (error) return fail(error.message);
  const d = data as { seq: number; converted: boolean };
  return done(d.converted ? `What was already scanned is now parcel 1; parcel ${d.seq} is ready.` : `Parcel ${d.seq} added.`, [MULTI, PACK], d, code);
}

export async function parcelScanAction(parcelId: string, code: string, item: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!item.trim()) return { ok: false, error: 'Scan or type the product.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcel_scan', { p_parcel: parcelId, p_code: item.trim() });
  if (error) return fail(error.message);
  const d = data as Scan;
  if (!d.ok) { revalidatePath(MULTI); return { ok: false, error: d.message, data: d }; }
  return done(d.all_in_parcels ? `${d.message}. Every picked item is in a parcel.` : `${d.message}.`, [MULTI], d, code);
}

export async function parcelUnscanAction(parcelId: string, code: string, lineId: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!uuid(lineId)) return { ok: false, error: 'Choose the product.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcel_unscan', { p_parcel: parcelId, p_line: lineId });
  if (error) return fail(error.message);
  return done((data as { message: string }).message + '.', [MULTI], data, code);
}

export async function parcelBoxAction(parcelId: string, code: string, boxId: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!uuid(boxId)) return { ok: false, error: 'Choose a box.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcel_set_box', { p_parcel: parcelId, p_box: boxId });
  if (error) return fail(error.message);
  const d = data as { seq: number; box: string; expected_g: number | null; tolerance_g: number | null };
  return done(d.expected_g == null ? `Parcel ${d.seq}: ${d.box}. Expected weight unknown — a supervisor approves the weight.`
    : `Parcel ${d.seq}: ${d.box}. Expected ${g(d.expected_g)} ± ${d.tolerance_g} g.`, [MULTI], d, code);
}

export async function parcelWeighAction(parcelId: string, code: string, benchId: string | null, grams: number): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!whole(grams, 1, 1000000)) return { ok: false, error: 'Enter the scale reading in whole grams.' };
  if (benchId !== null && !uuid(benchId)) return { ok: false, error: 'Choose the scale bench.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcel_weigh', { p_parcel: parcelId, p_bench: benchId, p_grams: grams });
  if (error) return fail(error.message);
  const d = data as { seq: number; within: boolean | null; difference_g: number | null; tolerance_g: number | null };
  const diff = d.difference_g ?? 0;
  return done(d.within ? `Parcel ${d.seq}: ${g(grams)} — inside tolerance.`
    : d.within === null ? `Parcel ${d.seq}: ${g(grams)} saved. The expected weight is unknown, so a supervisor approves it with a PIN.`
      : `Parcel ${d.seq}: ${g(grams)} is ${Math.abs(diff)} g ${diff > 0 ? 'over' : 'under'} (± ${d.tolerance_g} g allowed).`, [MULTI], d, code);
}

export async function parcelOverrideAction(f: { parcelId: string; code: string; supervisorId: string; pin: string; reason: string }): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!uuid(f.supervisorId)) return { ok: false, error: 'Choose the supervisor.' };
  if (!/^\d{4,8}$/.test(f.pin)) return { ok: false, error: 'The PIN has 4 to 8 digits.' };
  if (f.reason.trim().length < 3) return { ok: false, error: 'Enter why this weight is accepted.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcel_override', { p_parcel: f.parcelId, p_supervisor: f.supervisorId, p_pin: f.pin, p_reason: f.reason.trim() });
  if (error) return fail(error.message);
  const d = data as { ok: boolean; message: string };
  if (!d.ok) { for (const p of [MULTI, EXCEPTIONS]) revalidatePath(p); return { ok: false, error: d.message, data: d }; }
  return done(d.message, [MULTI], d, f.code);
}

export async function parcelEvidenceAction(parcelId: string, code: string, kind: EvidenceKind, path: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!EVIDENCE_KINDS.includes(kind)) return { ok: false, error: 'Choose what the photo shows.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_parcel_add_evidence', { p_parcel: parcelId, p_kind: kind, p_path: path });
  if (error) return fail(error.message);
  return done('Photo saved.', [MULTI], null, code);
}

export async function parcelCloseAction(parcelId: string, code: string, batteryMark: boolean): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcel_close', { p_parcel: parcelId, p_battery_mark: batteryMark });
  if (error) return fail(error.message);
  const d = data as { seq: number; open_parcels: number; all_in_parcels: boolean };
  return done(d.open_parcels === 0 && d.all_in_parcels ? `Parcel ${d.seq} closed. Every parcel is closed — close the order.` : `Parcel ${d.seq} closed.`, [MULTI, MATERIALS], d, code);
}

export async function parcelReopenAction(parcelId: string, code: string, reason: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!reason.trim()) return { ok: false, error: 'Say why the parcel is reopened.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_parcel_reopen', { p_parcel: parcelId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done('Parcel reopened; its box and battery mark went back to stock.', [MULTI, MATERIALS], null, code);
}

export async function parcelRemoveAction(parcelId: string, code: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  const sb = await createClient();
  const { error } = await sb.rpc('wh_parcel_remove', { p_parcel: parcelId });
  if (error) return fail(error.message);
  return done('Empty parcel removed.', [MULTI], null, code);
}

export async function parcelUnlockAction(parcelId: string, code: string, reason: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  if (!reason.trim()) return { ok: false, error: 'Enter why the override is unlocked.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_parcel_unlock_override', { p_parcel: parcelId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done('Override unlocked. A supervisor can enter their PIN again.', [MULTI, EXCEPTIONS], null, code);
}

export async function closeOrderParcelsAction(orderId: string, code: string): Promise<W3bResult> {
  await requireWarehouseStaff(MULTI);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_parcels_close_order', { p_order: orderId });
  if (error) return fail(error.message);
  const d = data as { parcels: number; measured_g: number };
  return done(`${code} is packed in ${d.parcels} parcels (${g(d.measured_g)} in total). Its proof is on the Evidence screen.`, [MULTI, PACK, ORDERS, '/office/warehouse/evidence'], d, code);
}

// ───────── exceptions ─────────
export async function raiseExceptionAction(f: { warehouse: string; kind: ExceptionKind; title: string; orderCode: string; asnCode: string }): Promise<W3bResult> {
  await requireWarehouseStaff(EXCEPTIONS);
  if (!MANUAL_KINDS.includes(f.kind)) return { ok: false, error: 'Choose the kind of problem.' };
  if (f.title.trim().length < 3) return { ok: false, error: 'Describe the problem.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_exception_raise', {
    p_warehouse: f.warehouse, p_kind: f.kind, p_title: f.title.trim(), p_order_code: f.orderCode.trim() || null, p_asn_code: f.asnCode.trim() || null,
  });
  if (error) return fail(error.message);
  const d = data as { code: string };
  return done(`${d.code} raised. A supervisor assigns it and records the resolution.`, [EXCEPTIONS], d);
}

export async function assignExceptionAction(exceptionId: string, ownerId: string | null): Promise<W3bResult> {
  await requireWarehouseStaff(EXCEPTIONS);
  if (!uuid(exceptionId) || (ownerId !== null && !uuid(ownerId))) return { ok: false, error: 'Choose who owns it.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_exception_assign', { p_exception: exceptionId, p_owner: ownerId });
  if (error) return fail(error.message);
  const d = data as { code: string; owner_name: string | null };
  return done(`${d.code} assigned to ${d.owner_name ?? 'the chosen person'}.`, [EXCEPTIONS], d);
}

export async function resolveExceptionItemAction(f: { exceptionId: string; action: ExceptionAction; resolution: string; qty: string }): Promise<W3bResult> {
  await requireWarehouseStaff(EXCEPTIONS);
  if (!uuid(f.exceptionId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (f.resolution.trim().length < 3) return { ok: false, error: 'Write what was found and done (the resolution).' };
  let qty: number | null = null;
  if (f.action === 'approve_lot') {
    qty = Number(f.qty);
    if (!f.qty.trim() || !whole(qty, 0, 1000000)) return { ok: false, error: 'Enter the approved quantity.' };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_exception_resolve', { p_exception: f.exceptionId, p_action: f.action, p_resolution: f.resolution.trim(), p_qty: qty });
  if (error) return fail(error.message);
  const d = data as { code: string; order_status: string | null };
  const next: Partial<Record<ExceptionAction, string>> = {
    retry: 'The order is back in picking.', ship_short: 'The order goes to packing with what was picked.', cancel: 'The order is cancelled.',
    unlock_override: 'The override is unlocked.', approve_lot: 'The lot is released for putaway.',
  };
  return done(`${d.code} resolved. ${next[f.action] ?? ''}`.trim(), [EXCEPTIONS, ORDERS, '/office/warehouse/pick', PACK, MULTI, '/office/warehouse/counts'], d);
}
