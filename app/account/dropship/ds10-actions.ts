'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';

/**
 * Octopus Dropship · Release 4 · Step 10 — merchant server actions (order detail + Support). Each action checks the merchant
 * and that the owning feature is on (requireDropshipV2Merchant(featurePath) redirects otherwise), validates the input with
 * zod and calls ONE SECURITY DEFINER RPC, which checks again (own org, stage rules, windows). Answers { ok, message } so the
 * page shows the reason next to the control; raw database errors are never shown.
 */

export type ActionResult<T = Record<string, unknown>> = { ok: true; data: T; message?: string } | { ok: false; message: string; code?: string };

const Uuid = z.string().uuid();

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: rpcMessage(error), code: error.message.split(':')[0].trim() };
  return { ok: true, data: data as T };
}

function revalidateOrder(id: string) {
  revalidatePath(`/account/dropship/orders/${id}`);
  revalidatePath('/account/dropship/orders');
  revalidatePath('/account/dropship/support');
  revalidatePath('/account/dropship/wallet');
}

const Photo = z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/);

export async function openClaimAction(input: { orderId: string; kind: 'lost' | 'damaged'; choice: 'reship' | 'refund'; message: string; photos: string[] }):
  Promise<ActionResult<{ code: string; message: string; ticket_id: string }>> {
  await requireDropshipV2Merchant('/account/dropship/orders');
  const p = z.object({
    orderId: Uuid, kind: z.enum(['lost', 'damaged']), choice: z.enum(['reship', 'refund']),
    message: z.string().trim().min(10, 'What happened: write at least 10 characters.').max(2000), photos: z.array(Photo).max(6),
  }).safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Check the form.' };
  const r = await rpc<{ code: string; message: string; ticket_id: string }>('ds10_claim_open', {
    p_so: p.data.orderId, p_kind: p.data.kind, p_choice: p.data.choice, p_message: p.data.message, p_photos: p.data.photos,
  });
  revalidateOrder(p.data.orderId);
  return r;
}

export async function openReturnAction(input: { orderId: string; to: 'merchant' | 'warehouse'; reason: string; message: string; lines: { item_id: string; qty: number }[] }):
  Promise<ActionResult<{ code: string; message: string; status: string }>> {
  await requireDropshipV2Merchant('/account/dropship/orders');
  const p = z.object({
    orderId: Uuid, to: z.enum(['merchant', 'warehouse']), reason: z.enum(['changed_mind', 'faulty', 'wrong_item', 'other']),
    message: z.string().trim().min(5, 'Tell us about the return (at least 5 characters).').max(2000),
    lines: z.array(z.object({ item_id: Uuid, qty: z.number().int().min(1).max(9999) })).max(100),
  }).safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Check the form.' };
  const r = await rpc<{ code: string; message: string; status: string }>('ds10_return_open', {
    p_so: p.data.orderId, p_to: p.data.to, p_reason: p.data.reason, p_message: p.data.message, p_lines: p.data.lines.length ? p.data.lines : null,
  });
  revalidateOrder(p.data.orderId);
  return r;
}

export async function disputeReweighAction(orderId: string, reweighId: string, reason: string): Promise<ActionResult<{ message: string }>> {
  await requireDropshipV2Merchant('/account/dropship/orders');
  const p = z.object({ orderId: Uuid, reweighId: Uuid, reason: z.string().trim().min(5, 'Reason: write at least 5 characters.').max(600) })
    .safeParse({ orderId, reweighId, reason });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Check the form.' };
  const r = await rpc<{ message: string }>('ds10_reweigh_dispute', { p_reweigh: p.data.reweighId, p_reason: p.data.reason });
  revalidateOrder(p.data.orderId);
  return r;
}

const Address = z.object({
  name: z.string().trim().min(1, 'Buyer name: enter the buyer\u2019s name.').max(120),
  phone: z.string().trim().max(40).optional().default(''),
  line1: z.string().trim().min(3, 'Street address: enter the street and number.').max(200),
  line2: z.string().trim().max(200).optional().default(''),
  city: z.string().trim().min(2, 'City: enter the city.').max(120),
  region: z.string().trim().max(120).optional().default(''),
  postcode: z.string().trim().max(20).optional().default(''),
  country: z.string().trim().regex(/^[A-Z]{2}$/),
});

export async function updateAddressFromDetailAction(orderId: string, address: z.input<typeof Address>):
  Promise<ActionResult<{ applied: boolean; problem?: boolean; message?: string; ticket_id?: string }>> {
  await requireDropshipV2Merchant('/account/dropship/orders');
  const id = Uuid.safeParse(orderId);
  const a = Address.safeParse(address);
  if (!id.success) return { ok: false, message: 'This order was not found.' };
  if (!a.success) return { ok: false, message: a.error.issues[0]?.message ?? 'Check the address.' };
  const r = await rpc<{ applied: boolean; problem?: boolean; message?: string; ticket_id?: string }>('ds10_order_address', { p_so: id.data, p_address: a.data });
  revalidateOrder(id.data);
  return r;
}

const Attachment = z.object({ path: z.string().min(1).max(500), name: z.string().min(1).max(300) });

export async function createSupportTicketAction(input: { subject: string; category: string; orderRef: string; body: string; attachments: { path: string; name: string }[] }):
  Promise<ActionResult<{ id: string; code: string }>> {
  await requireDropshipV2Merchant('/account/dropship/support');
  const p = z.object({
    subject: z.string().trim().min(3, 'Subject: write at least 3 characters.').max(200),
    category: z.enum(['order_problem', 'product_request', 'billing', 'store_connection', 'other']),
    orderRef: z.string().trim().max(64),
    body: z.string().trim().min(5, 'Message: describe the problem or question (at least 5 characters).').max(10000),
    attachments: z.array(Attachment).max(10),
  }).safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Check the form.' };
  const r = await rpc<{ id: string; code: string }>('ds10_ticket_create', {
    p_subject: p.data.subject, p_category: p.data.category, p_order_ref: p.data.orderRef || null, p_body: p.data.body, p_attachments: p.data.attachments,
  });
  revalidatePath('/account/dropship/support');
  return r;
}

/** Reply in a ticket thread (the shared desk's reply_ticket: own company's ticket only). */
export async function replySupportTicketAction(ticketId: string, body: string): Promise<ActionResult<null>> {
  await requireDropshipV2Merchant('/account/dropship/support');
  const id = Uuid.safeParse(ticketId);
  const text = String(body ?? '').trim();
  if (!id.success) return { ok: false, message: 'Ticket not found.' };
  if (text.length < 1) return { ok: false, message: 'Message: write something first.' };
  if (text.length > 10000) return { ok: false, message: 'Message: up to 10,000 characters.' };
  const r = await rpc<null>('reply_ticket', { p_ticket: id.data, p_body: text, p_internal: false, p_status: null });
  revalidatePath(`/account/dropship/support/${id.data}`);
  revalidatePath('/account/dropship/support');
  return r;
}
