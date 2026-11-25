'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapDbError } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';

const ApproveQuote = z.object({ quoteId: z.string().uuid() });

/** Approve one quote → approve_quote RPC creates order + PI + ledger entry in one transaction (SPEC §9). */
export async function approveQuote(input: { quoteId: string }): Promise<ActionResult<{ order_id: string; order_code: string; pi_number: string }>> {
  const parsed = ApproveQuote.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid quote.' };
  const sb = await createClient();
  // Always use the latest published Terms version server-side (never trust a client-sent id)
  const { data: terms } = await sb.from('terms_versions').select('id').eq('status', 'published').eq('kind', 'general').order('published_at', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await sb.rpc('approve_quote', { p_quote: parsed.data.quoteId, p_terms_version: terms?.id ?? null });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account');
  revalidatePath('/account/sourcing');
  revalidatePath('/account/orders');
  return { ok: true, data: data as { order_id: string; order_code: string; pi_number: string } };
}

const RejectQuote = z.object({ quoteId: z.string().uuid(), reason: z.string().trim().max(500).optional() });

/** Batch 3 (F-11): decline one Sourcing quote → reject_quote RPC (quote status only; no money moves). */
export async function rejectQuote(input: { quoteId: string; reason?: string }): Promise<ActionResult<{ quote_id: string }>> {
  const parsed = RejectQuote.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Keep the reason under 500 characters.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('reject_quote', { p_quote: parsed.data.quoteId, p_reason: parsed.data.reason || null });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/sourcing');
  revalidatePath('/account/sourcing/[ref]', 'page');
  return { ok: true, data: { quote_id: (data as { quote_id: string }).quote_id } };
}
