'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';
import { CONDITIONS, type Condition, type Decision } from '@/lib/warehouse-w5';

/**
 * Warehouse OS · W5 staff actions (Returns screen). Every rule (role per warehouse, photo + grading before the client decides,
 * the client's decision, ledger postings through record_warehouse_stock_movement) is enforced by the wh_* database functions;
 * these only shape the input and the sentence shown.
 */
export type W5StaffResult = { ok: boolean; message?: string; error?: string; data?: unknown };
const RETURNS = '/office/warehouse/returns';
const fail = (m: string): W5StaffResult => ({ ok: false, error: cleanDbError(m) });
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const done = (message: string, data?: unknown, extra: string[] = []): W5StaffResult => {
  for (const p of [RETURNS, '/office/warehouse', ...extra]) revalidatePath(p);
  return { ok: true, message, data };
};

export async function registerReturnAction(f: {
  orgId: string; warehouse: string; orderCode: string; carrierRef: string; reason: string; lines: { skuId: string; qty: string }[];
}): Promise<W5StaffResult> {
  await requireWarehouseStaff(RETURNS);
  if (!uuid(f.orgId)) return { ok: false, error: 'Choose the client.' };
  const lines = f.lines.filter((l) => l.skuId).map((l) => ({ sku_id: l.skuId, qty: l.qty.trim() }));
  if (!lines.length) return { ok: false, error: 'Add at least one product.' };
  if (lines.some((l) => !/^\d{1,5}$/.test(l.qty) || Number(l.qty) < 1)) return { ok: false, error: 'Enter whole units for every product.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_return_register', {
    p_org: f.orgId, p_warehouse: f.warehouse, p_order_code: f.orderCode.trim() || null, p_carrier_ref: f.carrierRef.trim() || null,
    p_reason: f.reason.trim() || null, p_lines: lines,
  });
  if (error) return fail(error.message);
  const d = data as { id: string; code: string };
  return done(`Return ${d.code} registered. Add photos and grade every product to finish the inspection.`, d);
}

export async function addReturnPhotoAction(returnId: string, path: string): Promise<W5StaffResult> {
  await requireWarehouseStaff(RETURNS);
  if (!uuid(returnId) || typeof path !== 'string' || path.length > 200) return { ok: false, error: 'Choose the return again.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_return_add_photo', { p_return: returnId, p_path: path });
  if (error) return fail(error.message);
  return done('Photo saved.');
}

export async function inspectReturnAction(f: { returnId: string; lines: { lineId: string; condition: Condition | '' }[]; note: string }): Promise<W5StaffResult> {
  await requireWarehouseStaff(RETURNS);
  if (!uuid(f.returnId)) return { ok: false, error: 'Choose the return again.' };
  if (f.lines.some((l) => !uuid(l.lineId) || !CONDITIONS.includes(l.condition as Condition))) return { ok: false, error: 'Grade every product: good, damaged or unsellable.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_return_inspect', {
    p_return: f.returnId, p_lines: f.lines.map((l) => ({ line_id: l.lineId, condition: l.condition })), p_note: f.note.trim() || null,
  });
  if (error) return fail(error.message);
  const d = data as { code: string };
  return done(`${d.code} inspected. The client sees the photos and condition and decides.`, d);
}

export async function completeReturnAction(returnId: string, note: string): Promise<W5StaffResult> {
  await requireWarehouseStaff(RETURNS);
  if (!uuid(returnId)) return { ok: false, error: 'Choose the return again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_return_complete', { p_return: returnId, p_note: note.trim() || null });
  if (error) return fail(error.message);
  const d = data as { code: string; decision: Decision; units: number; lots: string[]; order_code: string | null };
  const msg = d.decision === 'restock'
    ? `${d.code} done: ${d.units} unit(s) back in stock as ${d.lots.join(', ')} — put ${d.lots.length === 1 ? 'it' : 'them'} away.`
    : d.decision === 'send_back'
      ? `${d.code} done: order ${d.order_code} created and picked; pack it at the packing station.`
      : `${d.code} done: the units are recorded as disposed of.`;
  return done(msg, d, ['/office/warehouse/putaway', '/office/warehouse/pack', '/office/warehouse/orders']);
}

export async function applyReturnDefaultAction(returnId: string): Promise<W5StaffResult> {
  await requireWarehouseStaff(RETURNS);
  if (!uuid(returnId)) return { ok: false, error: 'Choose the return again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_return_apply_default', { p_return: returnId });
  if (error) return fail(error.message);
  const d = data as { code: string; decision: Decision };
  return done(`${d.code}: the client did not decide in time; default applied (${d.decision === 'restock' ? 'restock' : 'discard'}).`, d);
}
