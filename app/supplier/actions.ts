'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rpcMessage } from '@/lib/dropship-ds6';
import { MAX_BULK_ROWS } from '@/lib/dropship-ds14-shared';
import type { BulkResult, SupOrder } from '@/lib/dropship-ds14';

/**
 * Supplier portal server actions. Each one checks the signed-in user has the supplier role, then calls ONE definer RPC that
 * checks the supplier again (own rows only, switches on). Nothing here reads a table.
 */
export type SupResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; message: string };

async function client() {
  const s = await getSession();
  if (!s || !s.roles.includes('supplier')) return null;
  return createClient();
}
async function run<T>(fn: string, args: Record<string, unknown>, paths: string[] = []): Promise<SupResult<T>> {
  const sb = await client();
  if (!sb) return { ok: false, message: 'Sign in with your supplier account.' };
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: rpcMessage(error) };
  for (const p of paths) revalidatePath(p);
  return { ok: true, data: data as T };
}

const Uuid = z.string().uuid();

export async function stockAction(id: string, qty: number): Promise<SupResult<{ stock_qty: number }>> {
  const p = z.object({ id: Uuid, qty: z.number().int().min(0).max(10_000_000) }).safeParse({ id, qty });
  if (!p.success) return { ok: false, message: 'Stock: enter a whole number from 0 to 10,000,000.' };
  return run('ds_sup_stock_update', { p_supplier_product_id: p.data.id, p_qty: p.data.qty }, ['/supplier']);
}

export async function priceAction(priceId: string, newCost: string): Promise<SupResult<{ status: string; pct: number }>> {
  const p = z.object({ id: Uuid, cost: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/) }).safeParse({ id: priceId, cost: newCost.trim() });
  if (!p.success) return { ok: false, message: 'Cost: enter an amount like 6.90.' };
  const minor = Math.round(Number(p.data.cost) * 100);
  return run('ds_sup_price_change', { p_price_id: p.data.id, p_new_minor: minor }, ['/supplier']);
}

const Variant = z.object({
  option: z.string().trim().max(60), sku: z.string().trim().max(60), barcode: z.string().trim().max(40).optional(),
  cost_cents: z.number().int().min(0).max(1_000_000_000), stock: z.number().int().min(0).max(10_000_000), weight_g: z.number().int().min(0).max(1_000_000),
});
const Product = z.object({
  name: z.string().trim().max(200), category: z.string().trim().max(60).optional(), brand: z.string().trim().max(80).optional(),
  description: z.string().trim().max(4000).optional(), supplier_sku: z.string().trim().max(60), barcode: z.string().trim().max(40).optional(),
  condition: z.enum(['new', 'refurbished']).optional(), features: z.array(z.string().trim().max(200)).max(12).optional(),
  variants: z.array(Variant).max(50).optional(), images: z.array(z.string().trim().max(500)).max(9).optional(), video: z.string().trim().max(500).optional(),
  handling_days: z.number().int().min(0).max(60).optional(), ships_from: z.string().trim().max(40).optional(),
  package: z.object({ weight_g: z.number().min(0).max(1_000_000).optional(), length_cm: z.number().min(0).max(1000).optional(), width_cm: z.number().min(0).max(1000).optional(), height_cm: z.number().min(0).max(1000).optional() }).optional(),
  customs: z.object({ hs_code: z.string().trim().max(20).optional(), origin: z.string().trim().max(2).optional(), material: z.string().trim().max(80).optional(), description_en: z.string().trim().max(300).optional(),
    battery: z.boolean().optional(), liquid: z.boolean().optional(), magnetic: z.boolean().optional(), branded: z.boolean().optional() }).optional(),
  terms: z.object({ moq: z.number().int().min(0).max(1_000_000).optional(), lead_days: z.number().int().min(0).max(365).optional(), price_valid_days: z.number().int().min(0).max(365).optional(), packaging: z.enum(['plain', 'own_box']).optional() }).optional(),
});

export async function saveProductAction(id: string | null, payload: unknown, submit: boolean): Promise<SupResult<{ id: string; status: string }>> {
  const p = Product.safeParse(payload);
  if (!p.success) return { ok: false, message: `${p.error.issues[0]?.path.join(' › ') || 'Form'}: ${p.error.issues[0]?.message ?? 'check this field'}` };
  if (id && !Uuid.safeParse(id).success) return { ok: false, message: 'This product was not found.' };
  return run('ds_sup_save_product', { p_id: id, p: p.data, p_submit: submit }, ['/supplier']);
}

export async function bulkAction(rows: Record<string, string>[], fileName: string, submit: boolean): Promise<SupResult<BulkResult>> {
  const p = z.object({ rows: z.array(z.record(z.string(), z.string().max(2000))).min(1).max(MAX_BULK_ROWS), name: z.string().max(120) }).safeParse({ rows, name: fileName });
  if (!p.success) return { ok: false, message: `Upload up to ${MAX_BULK_ROWS} rows at a time.` };
  return run('ds_sup_bulk', { p_rows: p.data.rows, p_file_name: p.data.name, p_submit: submit }, submit ? ['/supplier'] : []);
}

export async function shipAction(id: string, carrier: string, carrierName: string, tracking: string): Promise<SupResult<{ status: string; all_shipped: boolean }>> {
  const p = z.object({ id: Uuid, carrier: z.enum(['yunexpress', '4px', 'other']), name: z.string().trim().max(40), trk: z.string().trim().max(60) }).safeParse({ id, carrier, name: carrierName, trk: tracking });
  if (!p.success) return { ok: false, message: 'Choose the carrier and enter the tracking number.' };
  return run('ds_sup_order_ship', { p_id: p.data.id, p_carrier: p.data.carrier, p_carrier_name: p.data.name || null, p_tracking: p.data.trk }, ['/supplier/orders', '/supplier']);
}

export async function problemAction(id: string, note: string): Promise<SupResult<{ status: string }>> {
  const p = z.object({ id: Uuid, note: z.string().trim().min(3).max(500) }).safeParse({ id, note });
  if (!p.success) return { ok: false, message: 'Tell staff what is wrong (3 to 500 characters).' };
  return run('ds_sup_order_problem', { p_id: p.data.id, p_note: p.data.note }, ['/supplier/orders', '/supplier']);
}

export async function orderDetailAction(id: string): Promise<SupResult<SupOrder>> {
  if (!Uuid.safeParse(id).success) return { ok: false, message: 'This order was not found.' };
  return run<SupOrder>('ds_sup_order', { p_id: id });
}
