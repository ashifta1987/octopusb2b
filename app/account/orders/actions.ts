'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapDbError } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';
import { dueNow } from '@/components/account/order-utils';

const Id = z.string().uuid();

export async function payFromWallet(orderId: string): Promise<ActionResult> {
  if (!Id.safeParse(orderId).success) return { ok: false, error: 'Invalid order.' };
  const sb = await createClient();
  const { data: o } = await sb.from('orders').select('id, code, status, total_cents, deposit_cents, paid_cents').eq('id', orderId).maybeSingle();
  if (!o) return { ok: false, error: 'Order not found.' };
  const due = dueNow({ status: o.status, total_cents: Number(o.total_cents), deposit_cents: Number(o.deposit_cents), paid_cents: Number(o.paid_cents) });
  if (!due) return { ok: false, error: 'Nothing is due on this order right now.' };
  const { error } = await sb.rpc('record_payment', { p_order: orderId, p_amount: due.amount, p_method: 'wallet', p_reference: `WALLET-${o.code}-${due.purpose}`, p_provider_event: null });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(`/account/orders/${orderId}`);
  revalidatePath('/account/orders');
  revalidatePath('/account/wallet');
  revalidatePath('/account/ledger');
  return { ok: true };
}

export async function cancelOrder(orderId: string, reason?: string): Promise<ActionResult> {
  if (!Id.safeParse(orderId).success) return { ok: false, error: 'Invalid order.' };
  const sb = await createClient();
  const { error } = await sb.rpc('transition_order', { p_order: orderId, p_to: 'cancelled', p_reason: reason?.slice(0, 300) || 'Cancelled by customer' });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(`/account/orders/${orderId}`);
  revalidatePath('/account/orders');
  return { ok: true };
}
