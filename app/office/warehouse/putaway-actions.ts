'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';

/** Warehouse OS · W2b staff actions (bins, pallets, putaway, moves, transfers, label log). The wh_* functions check roles and steps. */
export type PwResult = { ok: boolean; message?: string; error?: string; data?: unknown };
const fail = (m: string): PwResult => ({ ok: false, error: cleanDbError(m) });
const done = (paths: string[], message: string, data?: unknown): PwResult => {
  for (const p of paths) revalidatePath(p);
  return { ok: true, message, data };
};
const PUTAWAY = '/office/warehouse/putaway';
const BINS = '/office/warehouse/putaway/bins';
const TRANSFERS = '/office/warehouse/transfers';
const LABELS = '/office/warehouse/labels';
const whole = (n: number) => Number.isInteger(n) && n > 0;
const norm = (s: string) => s.trim().toUpperCase();

/** Resolves a scanned/typed bin code at a warehouse (RLS: only warehouses the person sees). */
async function binId(sb: Awaited<ReturnType<typeof createClient>>, warehouse: string, code: string) {
  const { data } = await sb.from('wh_bins').select('id, status').eq('warehouse_code', warehouse).eq('code', norm(code)).maybeSingle();
  return data as { id: string; status: string } | null;
}

export async function createBinRangeAction(f: {
  warehouse: string; rack: string; rowFrom: number; rowTo: number; binFrom: number; binTo: number; zone: string;
}): Promise<PwResult> {
  await requireWarehouseStaff(BINS);
  if (!f.warehouse) return { ok: false, error: 'Choose a warehouse.' };
  if (![f.rowFrom, f.rowTo, f.binFrom, f.binTo].every(whole)) return { ok: false, error: 'Rows and bins are whole numbers from 1 to 99.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_create_bin_range', {
    p_warehouse: f.warehouse, p_rack: norm(f.rack), p_row_from: f.rowFrom, p_row_to: f.rowTo, p_bin_from: f.binFrom, p_bin_to: f.binTo,
    p_zone: f.zone.trim() || null,
  });
  if (error) return fail(error.message);
  const d = data as { created: number; skipped: number; first: string; last: string };
  return done([BINS, PUTAWAY, LABELS], `${d.created} bin(s) created (${d.first} to ${d.last})${d.skipped ? `; ${d.skipped} already existed` : ''}.`, d);
}

export async function createBinAction(warehouse: string, code: string, zone: string): Promise<PwResult> {
  await requireWarehouseStaff(BINS);
  if (!warehouse || !code.trim()) return { ok: false, error: 'Choose a warehouse and enter a bin code.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_create_bin', { p_warehouse: warehouse, p_code: norm(code), p_zone: zone.trim() || null });
  if (error) return fail(error.message);
  return done([BINS, PUTAWAY, LABELS], `Bin ${norm(code)} created.`);
}

export async function setBinStatusAction(binIdValue: string, status: 'active' | 'blocked' | 'archived', reason: string): Promise<PwResult> {
  await requireWarehouseStaff(BINS);
  if (status === 'blocked' && !reason.trim()) return { ok: false, error: 'Enter why the bin is blocked.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_set_bin_status', { p_bin: binIdValue, p_status: status, p_reason: reason.trim() || null });
  if (error) return fail(error.message);
  return done([BINS, PUTAWAY, LABELS], status === 'blocked' ? 'Bin blocked.' : status === 'archived' ? 'Bin archived.' : 'Bin active again.');
}

export async function createPalletAction(warehouse: string, asnId: string, orgId: string, note: string): Promise<PwResult> {
  await requireWarehouseStaff(PUTAWAY);
  if (!warehouse) return { ok: false, error: 'Choose a warehouse.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_create_pallet', {
    p_warehouse: warehouse, p_asn: asnId || null, p_org: asnId ? null : orgId || null, p_note: note.trim() || null,
  });
  if (error) return fail(error.message);
  const d = data as { id: string; code: string };
  return done([PUTAWAY, LABELS], `Pallet ${d.code} created.`, d);
}

/** Scan-friendly putaway: lot code + bin code (+ optional pallet code) at the lot's warehouse. */
export async function putawayAction(f: { lotId: string; warehouse: string; bin: string; qty: number; pallet: string }): Promise<PwResult> {
  await requireWarehouseStaff(PUTAWAY);
  if (!f.lotId) return { ok: false, error: 'Choose or scan a lot.' };
  if (!f.bin.trim()) return { ok: false, error: 'Scan or type the bin, e.g. A-01-03.' };
  if (!whole(f.qty)) return { ok: false, error: 'Enter how many units go into the bin.' };
  const sb = await createClient();
  const bin = await binId(sb, f.warehouse, f.bin);
  if (!bin) return { ok: false, error: `There is no bin ${norm(f.bin)} at this warehouse.` };
  let palletId: string | null = null;
  if (f.pallet.trim()) {
    const { data } = await sb.from('wh_pallets').select('id').eq('code', norm(f.pallet)).maybeSingle();
    if (!data) return { ok: false, error: `There is no pallet ${norm(f.pallet)}.` };
    palletId = (data as { id: string }).id;
  }
  const { data, error } = await sb.rpc('wh_putaway', { p_lot: f.lotId, p_bin: bin.id, p_qty: f.qty, p_pallet: palletId });
  if (error) return fail(error.message);
  const d = data as { lot: string; bin: string; pallet: string | null; qty: number; left: number };
  return done([PUTAWAY, LABELS], `${d.qty} unit(s) of ${d.lot} put away in ${d.bin}${d.pallet ? ` on ${d.pallet}` : ''}.${d.left ? ` ${d.left} left to put away.` : ''}`, d);
}

export async function moveStockAction(f: { warehouse: string; fromBin: string; toBin: string; itemId: string; lotId: string; qty: number; reason: string }): Promise<PwResult> {
  await requireWarehouseStaff(PUTAWAY);
  if (!f.itemId) return { ok: false, error: 'Choose what to move.' };
  if (!whole(f.qty)) return { ok: false, error: 'Enter how many units to move.' };
  if (!f.reason.trim()) return { ok: false, error: 'Enter why the stock moves.' };
  const sb = await createClient();
  const to = await binId(sb, f.warehouse, f.toBin);
  if (!to) return { ok: false, error: `There is no bin ${norm(f.toBin)} at this warehouse.` };
  const { data, error } = await sb.rpc('wh_move_bin_stock', {
    p_from_bin: f.fromBin, p_to_bin: to.id, p_item: f.itemId, p_lot: f.lotId || null, p_qty: f.qty, p_reason: f.reason.trim(),
  });
  if (error) return fail(error.message);
  const d = data as { from: string; to: string; qty: number };
  return done([PUTAWAY], `${d.qty} unit(s) moved from ${d.from} to ${d.to}.`);
}

export async function movePalletAction(palletId: string, warehouse: string, toBin: string, reason: string): Promise<PwResult> {
  await requireWarehouseStaff(PUTAWAY);
  if (!reason.trim()) return { ok: false, error: 'Enter why the pallet moves.' };
  const sb = await createClient();
  const to = await binId(sb, warehouse, toBin);
  if (!to) return { ok: false, error: `There is no bin ${norm(toBin)} at this warehouse.` };
  const { data, error } = await sb.rpc('wh_move_pallet', { p_pallet: palletId, p_to_bin: to.id, p_reason: reason.trim() });
  if (error) return fail(error.message);
  const d = data as { pallet: string; from: string; to: string };
  return done([PUTAWAY, LABELS], `${d.pallet} moved from ${d.from} to ${d.to}.`);
}

export async function createTransferAction(f: { from: string; to: string; lines: { itemId: string; qty: number }[]; note: string }): Promise<PwResult> {
  await requireWarehouseStaff(TRANSFERS);
  if (!f.from || !f.to) return { ok: false, error: 'Choose where the stock goes from and to.' };
  if (f.from === f.to) return { ok: false, error: 'Choose two different warehouses.' };
  const lines = f.lines.filter((l) => l.itemId);
  if (!lines.length) return { ok: false, error: 'Add at least one product.' };
  if (!lines.every((l) => whole(l.qty))) return { ok: false, error: 'Every line needs a quantity above 0.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_create_transfer', {
    p_from: f.from, p_to: f.to, p_lines: lines.map((l) => ({ item_id: l.itemId, qty: l.qty })), p_note: f.note.trim() || null,
  });
  if (error) return fail(error.message);
  const d = data as { id: string; code: string };
  return done([TRANSFERS], `Transfer ${d.code} saved as a draft.`, d);
}

export async function transferStepAction(id: string, step: 'dispatch' | 'receive'): Promise<PwResult> {
  await requireWarehouseStaff(TRANSFERS);
  const sb = await createClient();
  if (step === 'dispatch') {
    const { data, error } = await sb.rpc('wh_dispatch_transfer', { p_id: id });
    if (error) return fail(error.message);
    const d = data as { code: string };
    return done([TRANSFERS, PUTAWAY, LABELS], `${d.code} dispatched. Its units left the origin’s bins and stock.`);
  }
  const { data, error } = await sb.rpc('wh_receive_transfer', { p_id: id });
  if (error) return fail(error.message);
  const d = data as { code: string; lots: string[] };
  return done([TRANSFERS, PUTAWAY], `${d.code} received. New lot(s) ${d.lots.join(', ')} are ready to put away.`);
}

export async function cancelTransferAction(id: string, reason: string): Promise<PwResult> {
  await requireWarehouseStaff(TRANSFERS);
  if (!reason.trim()) return { ok: false, error: 'Enter why the transfer is cancelled.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_cancel_transfer', { p_id: id, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done([TRANSFERS], 'Transfer cancelled.');
}

export async function logLabelPrintAction(warehouse: string, kind: 'carton' | 'pallet' | 'bin', refs: string[], copies: number): Promise<PwResult> {
  await requireWarehouseStaff(LABELS);
  if (!refs.length) return { ok: false, error: 'Choose at least one label.' };
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) return { ok: false, error: 'Print 1 to 100 copies.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_log_label_print', { p_warehouse: warehouse, p_kind: kind, p_refs: refs, p_copies: copies });
  if (error) return fail(error.message);
  return done([LABELS], `${Number(data)} label(s) logged × ${copies} cop${copies === 1 ? 'y' : 'ies'}.`);
}
