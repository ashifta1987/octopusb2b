'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { mapDbError, toCents } from '@/lib/format';
import { toolSchemas } from './tool-schemas';
import type { ToolCallLog } from './types';

/** Customer server actions for Octo (SPEC §20). Every state change is an explicit click; RPCs run with the customer's session (RLS). */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();

/**
 * Confirm a draft Octo prepared. The draft is re-read from the stored bot message (never trusted from the browser),
 * re-validated, then submitted through the existing customer RPCs. Idempotent per message+tool index.
 */
export async function confirmAssistantDraft(messageId: string, toolIndex: number): Promise<Result<{ href: string; label: string }>> {
  const s = await getSession();
  if (!s?.org) return { ok: false, error: 'Please sign in to your company account.' };
  if (!uuid.safeParse(messageId).success || !Number.isInteger(toolIndex) || toolIndex < 0 || toolIndex > 20) return { ok: false, error: 'Invalid draft.' };
  const sb = await createClient();
  const { data: msg } = await sb.from('assistant_messages').select('id, session_id, author, tools_called').eq('id', messageId).maybeSingle();
  if (!msg || msg.author !== 'bot') return { ok: false, error: 'Draft not found.' };
  const entry = ((msg.tools_called ?? []) as ToolCallLog[])[toolIndex];
  const draft = entry?.ok ? entry.draft : null;
  if (!draft) return { ok: false, error: 'Draft not found.' };
  const idem = `octo:${messageId}:${toolIndex}`;

  let href = '/account/services';
  let label = 'View service requests →';
  let entityId: string | null = null;
  if (draft.kind === 'rfq') {
    const v = toolSchemas.draft_rfq.safeParse(draft);
    if (!v.success) return { ok: false, error: 'This draft is incomplete — ask Octo to update it, or use the RFQ form.' };
    const d = v.data;
    const { data, error } = await sb.rpc('submit_rfq', {
      p_title: d.title, p_quantity: d.quantity, p_details: d.details, p_product: d.product_id ?? null,
      p_destination_country: d.destination_country ?? null, p_destination_city: d.destination_city ?? null,
      p_target_price_cents: d.target_price ? toCents(d.target_price) : null, p_incoterm: d.incoterm ?? null, p_idem: idem,
    });
    if (error) return { ok: false, error: mapDbError(error) };
    entityId = data as string;
    href = `/account/rfqs/${entityId}`;
    label = 'Open your RFQ →';
  } else {
    const v = toolSchemas.draft_service_request.safeParse(draft);
    if (!v.success) return { ok: false, error: 'This draft is incomplete — ask Octo to update it, or use the request form.' };
    const d = v.data;
    const { data, error } = await sb.rpc('request_service', { p_service: d.service_code, p_details: { ...d.details, source: 'octo' }, p_product: d.product_id ?? null, p_idem: idem });
    if (error) return { ok: false, error: mapDbError(error) };
    entityId = data as string;
  }
  // audit trail of the bot-assisted action (customers cannot call write_audit; logged server-side)
  await createAdminClient().from('audit_log').insert({
    actor_id: s.userId, action: draft.kind === 'rfq' ? 'assistant.rfq_confirmed' : 'assistant.service_request_confirmed',
    entity: draft.kind === 'rfq' ? 'rfqs' : 'service_requests', entity_id: entityId,
    details: { session_id: msg.session_id, message_id: messageId, tool_index: toolIndex, org_id: s.org.id },
  });
  revalidatePath('/account');
  return { ok: true, href, label };
}

export async function setAssistantFeedback(messageId: string, thumbsUp: boolean): Promise<Result> {
  if (!uuid.safeParse(messageId).success) return { ok: false, error: 'Invalid message.' };
  const sb = await createClient();
  const { error } = await sb.rpc('assistant_feedback_set', { p_message: messageId, p_thumbs_up: !!thumbsUp, p_note: null });
  return error ? { ok: false, error: mapDbError(error) } : { ok: true };
}

/** Privacy: "Let Octo use my chat history to improve its answers" (checked = opted in). */
export async function setAssistantHistoryOptIn(optIn: boolean): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.rpc('set_assistant_opt_out', { p_opt_out: !optIn });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/assistant');
  return { ok: true };
}

/** "Talk to <manager> instead": opens a session if needed and escalates with reason customer_request. */
export async function talkToAccountManager(sessionId: string | null, channel: 'page' | 'drawer', page: string | null): Promise<Result<{ session_id: string }>> {
  const s = await getSession();
  if (!s?.org) return { ok: false, error: 'Please sign in to your company account.' };
  const sb = await createClient();
  let sid = sessionId && uuid.safeParse(sessionId).success ? sessionId : null;
  if (!sid) {
    const { data, error } = await sb.rpc('start_assistant_session', { p_channel: channel, p_page: page?.slice(0, 300) ?? null });
    if (error) return { ok: false, error: mapDbError(error) };
    sid = data as string;
  }
  const { error } = await sb.rpc('escalate_session', { p_session: sid, p_reason: 'customer_request', p_excerpt: 'Customer asked to talk to their account manager.', p_confidence: null });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/assistant');
  return { ok: true, session_id: sid };
}
