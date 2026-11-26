'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';
import { ORDER_CSV_MAX_BYTES, orderPayload, parseOrdersCsv } from '@/lib/warehouse-orders';

/** Warehouse OS client portal actions (W2a Send stock; W3a Orders). The company is always the signed-in person's own. */
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

// ───────── W3a: orders ─────────
export async function createOrderAction(f: {
  ref: string; name: string; phone: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string;
  lines: { skuId: string; qty: string }[];
}): Promise<PortalResult> {
  const s = await requireCustomer(PATH);
  const lines = f.lines.filter((l) => l.skuId).map((l) => ({ sku_id: l.skuId, qty: l.qty.trim() }));
  if (!lines.length) return { ok: false, error: 'Add at least one product.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_create_client_order', {
    p_org: s.org!.id,
    p_order: {
      external_ref: f.ref.trim() || null,
      ship: { name: f.name, phone: f.phone, line1: f.line1, line2: f.line2, city: f.city, region: f.region, postcode: f.postcode, country: f.country.trim().toUpperCase() },
      lines,
    },
    p_source: 'client_portal',
  });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  const d = data as { id: string; code: string; status: string };
  revalidatePath(PATH);
  return {
    ok: true, id: d.id, code: d.code,
    message: d.status === 'allocated' ? `Order ${d.code} received. Your stock is reserved and it goes to picking.` : `Order ${d.code} received. It waits until the stock arrives.`,
  };
}

export type CsvPreview = {
  orders: { index: number; external_ref: string | null; name: string; country: string; lines: { sku: string; qty: string }[]; ok: boolean; error?: string }[];
  errors: { row: number; message: string }[];
};

/** Parses the CSV on the server and asks the database to check every order (nothing is written). */
export async function previewCsvAction(text: string): Promise<{ ok: boolean; error?: string; preview?: CsvPreview }> {
  const s = await requireCustomer(PATH);
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' };
  if (text.length > ORDER_CSV_MAX_BYTES) return { ok: false, error: 'The file is larger than 1 MB. Split it into smaller files.' };
  const parsed = parseOrdersCsv(text);
  if (!parsed.orders.length) return { ok: true, preview: { orders: [], errors: parsed.errors } };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_validate_client_orders', { p_org: s.org!.id, p_orders: parsed.orders.slice(0, 200).map(orderPayload) });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  const checks = data as { index: number; ok: boolean; error?: string }[];
  return {
    ok: true,
    preview: {
      errors: parsed.errors,
      orders: parsed.orders.slice(0, 200).map((o, i) => {
        const c = checks.find((x) => x.index === i + 1);
        return { index: i + 1, external_ref: o.external_ref, name: o.ship.name, country: o.ship.country, lines: o.lines,
          ok: Boolean(c?.ok), error: c?.ok ? undefined : cleanDbError(c?.error ?? 'Not checked') };
      }),
    },
  };
}

/** Creates every order of the file, or none (the database refuses the whole file if one order fails). */
export async function createCsvOrdersAction(text: string): Promise<PortalResult> {
  const s = await requireCustomer(PATH);
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' };
  if (text.length > ORDER_CSV_MAX_BYTES) return { ok: false, error: 'The file is larger than 1 MB.' };
  const parsed = parseOrdersCsv(text);
  if (parsed.errors.length) return { ok: false, error: `Row ${parsed.errors[0].row}: ${parsed.errors[0].message}` };
  if (!parsed.orders.length) return { ok: false, error: 'The file has no orders.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_create_client_orders', { p_org: s.org!.id, p_orders: parsed.orders.map(orderPayload), p_source: 'client_csv' });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  const made = data as { code: string; status: string }[];
  const waiting = made.filter((m) => m.status !== 'allocated').length;
  revalidatePath(PATH);
  return { ok: true, message: `${made.length} order(s) received (${made[0]?.code}${made.length > 1 ? ` … ${made[made.length - 1].code}` : ''}).${waiting ? ` ${waiting} wait for stock.` : ''}` };
}

export async function cancelOrderAction(id: string): Promise<PortalResult> {
  await requireCustomer(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('wh_cancel_order', { p_order: id, p_reason: null });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  revalidatePath(PATH);
  return { ok: true, message: 'Order cancelled.' };
}
