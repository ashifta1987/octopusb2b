'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { mapDbError } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';

const Attachment = z.object({ path: z.string().min(1).max(500), name: z.string().min(1).max(300) });

const NewTicket = z.object({
  category: z.enum(['complaint', 'feedback', 'question']),
  subject: z.string().trim().min(3, 'Enter a short subject').max(200),
  body: z.string().trim().min(5, 'Please describe the problem or question').max(10000),
  orderId: z.string().uuid().nullable(),
  attachments: z.array(Attachment).max(10).default([]),
});
export type NewTicketInput = z.input<typeof NewTicket>;

export async function createTicket(input: NewTicketInput): Promise<ActionResult<{ id: string }>> {
  const p = NewTicket.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Please check the form' };
  const s = await getSession();
  if (!s?.org) return { ok: false, error: mapDbError({ message: 'NO_ORG' }) };
  const i = p.data;
  // Attachments must live in the caller's own org folder (storage RLS enforces the upload; this guards the reference).
  if (i.attachments.some((a) => !a.path.startsWith(`${s.org!.id}/`))) return { ok: false, error: 'Invalid attachment.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('create_ticket', {
    p_subject: i.subject,
    p_category: i.category,
    p_body: i.body,
    p_order: i.orderId,
    p_priority: 'normal',
    p_attachments: i.attachments,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/support');
  return { ok: true, data: { id: data as string } };
}

export async function replyTicket(ticketId: string, body: string): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(ticketId);
  const text = body.trim();
  if (!id.success) return { ok: false, error: 'Ticket not found.' };
  if (text.length < 1) return { ok: false, error: 'Write a message first.' };
  if (text.length > 10000) return { ok: false, error: 'Message is too long.' };
  const sb = await createClient();
  const { error } = await sb.rpc('reply_ticket', { p_ticket: id.data, p_body: text, p_internal: false, p_status: null });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(`/account/support/${id.data}`);
  revalidatePath('/account/support');
  return { ok: true };
}

export async function rateTicket(ticketId: string, rating: number): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(ticketId);
  const r = z.number().int().min(1).max(5).safeParse(rating);
  if (!id.success || !r.success) return { ok: false, error: 'Choose a rating from 1 to 5.' };
  const sb = await createClient();
  // Only resolved/closed tickets without a rating can be rated (RLS limits the row to the caller's org).
  const { data, error } = await sb
    .from('tickets')
    .update({ csat: r.data })
    .eq('id', id.data)
    .in('status', ['resolved', 'closed'])
    .is('csat', null)
    .select('id');
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data?.length) return { ok: false, error: 'This ticket can no longer be rated.' };
  revalidatePath(`/account/support/${id.data}`);
  return { ok: true };
}
