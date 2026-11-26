'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';

/**
 * Octopus Dropship · Release 3 · Step 8 — server actions (Orders + Wallet). Every action checks the merchant (and that the
 * Orders feature is switched on: requireDropshipV2Merchant(featurePath) redirects otherwise), then calls ONE SECURITY
 * DEFINER RPC, which checks again (own org via auth.uid(), paused / closed merchants refused for new charges, feature list).
 * Actions answer { ok, message } so the page shows the reason next to the control; raw DB errors are never shown.
 */

export type ChargeResult = {
  store_order_id: string; order_number: string; ok: boolean; code?: string; message?: string; option?: string; invoice_number?: string | null;
};
export type ActionResult<T = Record<string, unknown>> = { ok: true; data: T; message?: string } | { ok: false; message: string; code?: string };

const Uuid = z.string().uuid();

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: rpcMessage(error), code: error.message.split(':')[0].trim() };
  return { ok: true, data: data as T };
}

function revalidateOrders() {
  revalidatePath('/account/dropship/orders');
  revalidatePath('/account/dropship/wallet');
  revalidatePath('/account/wallet');
}

/** "Charge and ship" — one order or many (the server charges oldest first; each order succeeds or fails on its own). */
export async function chargeOrdersAction(ids: string[], option?: 'wallet' | 'protection' | 'pay_later' | null): Promise<ActionResult<{ charged: number; failed: number; results: ChargeResult[] }>> {
  await requireDropshipV2Merchant('/account/dropship/orders');
  const p = z.array(Uuid).min(1).max(200).safeParse(ids);
  if (!p.success) return { ok: false, message: 'Choose at least one order.' };
  const o = z.enum(['wallet', 'protection', 'pay_later']).nullable().optional().safeParse(option ?? null);
  if (!o.success) return { ok: false, message: 'Choose how to pay.' };
  const r = await rpc<{ charged: number; failed: number; results: ChargeResult[] }>('ds_order_charge', { p_ids: p.data, p_option: o.data ?? null });
  revalidateOrders();
  return r;
}

export async function cancelOrderAction(id: string, reason?: string): Promise<ActionResult<{ accepted: boolean; message: string; refund_cents?: number }>> {
  await requireDropshipV2Merchant('/account/dropship/orders');
  const p = Uuid.safeParse(id);
  if (!p.success) return { ok: false, message: 'This order was not found.' };
  const why = z.string().max(300).optional().safeParse(reason);
  const r = await rpc<{ accepted: boolean; message: string; refund_cents?: number }>('ds_order_cancel', { p_id: p.data, p_reason: why.success ? why.data ?? null : null });
  revalidateOrders();
  return r;
}

const Address = z.object({
  name: z.string().trim().min(2, 'Enter the buyer\u2019s name.').max(120),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  line1: z.string().trim().min(3, 'Enter the street and number.').max(200),
  line2: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().min(2, 'Enter the city.').max(120),
  region: z.string().trim().max(120).optional().or(z.literal('')),
  postcode: z.string().trim().max(20).optional().or(z.literal('')),
  country: z.string().trim().regex(/^[A-Z]{2}$/),
});

export async function updateAddressAction(id: string, address: z.input<typeof Address>): Promise<ActionResult<{ applied: boolean; problem?: boolean; message?: string }>> {
  await requireDropshipV2Merchant('/account/dropship/orders');
  const p = Uuid.safeParse(id);
  if (!p.success) return { ok: false, message: 'This order was not found.' };
  const a = Address.safeParse(address);
  if (!a.success) return { ok: false, message: a.error.issues[0]?.message ?? 'Check the address.' };
  const r = await rpc<{ applied: boolean; problem?: boolean; message?: string }>('ds_order_update_address', { p_id: p.data, p_address: a.data });
  revalidateOrders();
  return r;
}

/** Wallet › How new orders are paid. Pay later can only be saved by a credit_eligible organisation (the RPC refuses otherwise). */
export async function saveOrderSettingsAction(mode: 'wallet' | 'protection' | 'pay_later', autoPay: boolean): Promise<ActionResult<{ payment_mode: string; auto_pay: boolean }>> {
  await requireDropshipV2Merchant('/account/dropship/wallet');
  const m = z.enum(['wallet', 'protection', 'pay_later']).safeParse(mode);
  if (!m.success || typeof autoPay !== 'boolean') return { ok: false, message: 'Choose how new orders are paid.' };
  const r = await rpc<{ payment_mode: string; auto_pay: boolean }>('ds_order_settings_save', { p_payment_mode: m.data, p_auto_pay: autoPay });
  revalidateOrders();
  return r;
}
