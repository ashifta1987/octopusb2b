'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';

/** Warehouse OS · W2a staff actions (dock, receiving, counts, serials). The wh_* functions check roles and steps. */
export type InResult = { ok: boolean; message?: string; error?: string; data?: unknown };
const fail = (m: string): InResult => ({ ok: false, error: cleanDbError(m) });
const done = (paths: string[], message: string, data?: unknown): InResult => {
  for (const p of paths) revalidatePath(p);
  return { ok: true, message, data };
};
const DOCK = '/office/warehouse/dock';
const COUNTS = '/office/warehouse/counts';
const INBOUND = '/office/warehouse/inbound';

export async function bookSlotAction(f: {
  warehouse: string; dock: string; date: string; start: string; end: string; asnId: string | null; note: string;
}): Promise<InResult> {
  await requireWarehouseStaff(DOCK);
  if (!f.warehouse || !f.dock.trim() || !f.date || !f.start || !f.end) return { ok: false, error: 'Fill in the warehouse, dock, date and times.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_book_slot', {
    p_warehouse: f.warehouse, p_dock: f.dock.trim(), p_date: f.date, p_start: f.start, p_end: f.end, p_asn: f.asnId || null, p_note: f.note.trim() || null,
  });
  if (error) return fail(error.message);
  return done([DOCK, INBOUND], 'Slot booked.');
}

export async function slotStepAction(slotId: string, to: 'arrived' | 'unloading' | 'done'): Promise<InResult> {
  await requireWarehouseStaff(DOCK);
  const sb = await createClient();
  const { error } = to === 'arrived' ? await sb.rpc('wh_check_in', { p_slot: slotId }) : await sb.rpc('wh_slot_advance', { p_slot: slotId, p_to: to });
  if (error) return fail(error.message);
  return done([DOCK, INBOUND], to === 'arrived' ? 'Checked in.' : to === 'unloading' ? 'Unloading started.' : 'Slot finished.');
}

export async function slotLinkAsnAction(slotId: string, asnId: string): Promise<InResult> {
  await requireWarehouseStaff(DOCK);
  if (!asnId) return { ok: false, error: 'Choose a stock notice.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_slot_set_asn', { p_slot: slotId, p_asn: asnId });
  if (error) return fail(error.message);
  return done([DOCK, INBOUND], 'Stock notice linked.');
}

export async function cancelSlotAction(slotId: string, reason: string): Promise<InResult> {
  await requireWarehouseStaff(DOCK);
  if (!reason.trim()) return { ok: false, error: 'Enter why the slot is cancelled.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_cancel_slot', { p_slot: slotId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done([DOCK, INBOUND], 'Slot cancelled.');
}

export async function countLineAction(asnCode: string, lineId: string, good: number, damaged: number, note: string): Promise<InResult> {
  await requireWarehouseStaff(`/office/warehouse/receive/${asnCode}`);
  if (!Number.isInteger(good) || !Number.isInteger(damaged) || good < 0 || damaged < 0) return { ok: false, error: 'Enter whole numbers, 0 or more.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_count_line', { p_line: lineId, p_good: good, p_damaged: damaged, p_note: note.trim() || null });
  if (error) return fail(error.message);
  const d = data as { result: 'accepted' | 'recount' | 'blocked'; lot: string | null };
  const message = d.result === 'accepted' ? `Accepted. Lot ${d.lot} is on hand.`
    : d.result === 'recount' ? 'The count differs from the notice. A different person must recount this line.'
    : `Still different after the recount. Lot ${d.lot} is blocked until a supervisor approves.`;
  return done([`/office/warehouse/receive/${asnCode}`, COUNTS, INBOUND, DOCK], message, d);
}

export async function approveLotAction(lotId: string, qty: number, reason: string): Promise<InResult> {
  await requireWarehouseStaff(COUNTS);
  if (!Number.isInteger(qty) || qty < 0) return { ok: false, error: 'Enter the approved quantity (0 or more).' };
  if (!reason.trim()) return { ok: false, error: 'Enter why this quantity is approved.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_approve_lot', { p_lot: lotId, p_qty: qty, p_reason: reason.trim() });
  if (error) return fail(error.message);
  const d = data as { lot: string; qty: number };
  return done([COUNTS, INBOUND, DOCK], `Lot ${d.lot} released with ${d.qty} unit(s).`);
}

export async function addSerialsAction(lotId: string, raw: string): Promise<InResult> {
  await requireWarehouseStaff(COUNTS);
  const serials = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!serials.length) return { ok: false, error: 'Scan or type at least one serial.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_add_serials', { p_lot: lotId, p_serials: serials });
  if (error) return fail(error.message);
  return done([COUNTS], `${Number(data)} serial(s) recorded.`);
}

export async function cancelAsnStaffAction(asnId: string, reason: string): Promise<InResult> {
  await requireWarehouseStaff(INBOUND);
  if (!reason.trim()) return { ok: false, error: 'Enter why the notice is cancelled.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_cancel_asn', { p_id: asnId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done([INBOUND, DOCK], 'Stock notice cancelled.');
}
