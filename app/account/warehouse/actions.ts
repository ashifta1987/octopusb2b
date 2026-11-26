'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';

/** Warehouse OS · W2a client portal actions (Send stock). The company is always the signed-in person's own. */
export type PortalResult = { ok: boolean; message?: string; error?: string; id?: string; code?: string };
const PATH = '/account/warehouse';

export async function saveSkuAction(f: { sku: string; name: string; barcode: string; weightG: string; battery: boolean; liquid: boolean }): Promise<PortalResult> {
  const s = await requireCustomer(PATH);
  const weight = f.weightG.trim() ? Number(f.weightG) : null;
  if (weight !== null && (!Number.isInteger(weight) || weight <= 0)) return { ok: false, error: 'Enter the weight in whole grams.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_save_client_sku', {
    p_org: s.org!.id, p_id: null, p_sku: f.sku.trim(), p_name: f.name.trim(), p_barcode: f.barcode.trim() || null,
    p_weight_g: weight, p_has_battery: f.battery, p_has_liquid: f.liquid,
  });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  revalidatePath(PATH);
  return { ok: true, message: 'Product added.', id: String(data) };
}

export async function createAsnAction(f: {
  warehouse: string; date: string; cartons: string; pallets: string; note: string; lines: { skuId: string; qty: string }[];
}): Promise<PortalResult> {
  const s = await requireCustomer(PATH);
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const cartons = num(f.cartons);
  const pallets = num(f.pallets);
  if ([cartons, pallets].some((n) => n !== null && (!Number.isInteger(n) || n < 0))) return { ok: false, error: 'Cartons and pallets are whole numbers.' };
  const lines = f.lines.filter((l) => l.skuId).map((l) => ({ sku_id: l.skuId, qty: l.qty.trim() }));
  if (!lines.length) return { ok: false, error: 'Add at least one product.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_create_asn', {
    p_org: s.org!.id, p_warehouse: f.warehouse || null, p_expected_date: f.date || null, p_cartons: cartons, p_pallets: pallets,
    p_lines: lines, p_note: f.note.trim() || null, p_source: 'client',
  });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  const d = data as { id: string; code: string };
  revalidatePath(PATH);
  return { ok: true, message: `Stock notice ${d.code} sent. We’ll book a dock slot and confirm the arrival time.`, id: d.id, code: d.code };
}

export async function cancelAsnAction(id: string): Promise<PortalResult> {
  await requireCustomer(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('wh_cancel_asn', { p_id: id, p_reason: null });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  revalidatePath(PATH);
  return { ok: true, message: 'Stock notice cancelled.' };
}
