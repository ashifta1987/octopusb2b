'use server';
import { revalidatePath } from 'next/cache';
import { fail, failAt, guard, ok, type Result } from '@/components/admin/server';
import { getQuoteFacts, getShipmentFacts, getWalletFacts, type Fact } from '@/components/backoffice/assistant/facts';

const PATH = '/office/assistant';
const here = (session: string) => `${PATH}?session=${session}`;

/** Audit every open of a conversation (log_assistant_open → audit_log 'assistant.opened'). */
export async function logAssistantOpen(session: string): Promise<Result> {
  const g = await guard('assistant', 'view');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('log_assistant_open', { p_session: session });
  return error ? failAt(error, here(session)) : ok();
}

/** Inline reply (visible to the customer) or internal note (hidden_from_customer). */
export async function staffAssistantReply(session: string, content: string, internal: boolean): Promise<Result & { id?: string }> {
  const g = await guard('assistant', 'reply');
  if ('error' in g) return g.error;
  const text = content.trim();
  if (!text) return fail('Write a message first.');
  if (text.length > 4000) return fail('Message is too long (4,000 characters max).');
  const { data, error } = await g.sb.rpc('staff_assistant_reply', { p_session: session, p_content: text, p_internal: internal });
  if (error) return failAt(error, here(session));
  revalidatePath(PATH);
  return { ok: true, message: internal ? 'Internal note saved.' : 'Reply sent.', id: data as string };
}

export async function takeOverSession(session: string): Promise<Result> {
  const g = await guard('assistant', 'take_over');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('take_over_session', { p_session: session });
  if (error) return failAt(error, here(session));
  revalidatePath(PATH);
  return ok('You now own this conversation. Octo is paused.');
}

/** Resolve the escalation; either close the conversation or hand it back to Octo. */
export async function resolveEscalation(session: string, outcome: string, close: boolean): Promise<Result> {
  const g = await guard('assistant', 'close');
  if ('error' in g) return g.error;
  if (!outcome.trim()) return fail('REASON_REQUIRED');
  const { error } = await g.sb.rpc('resolve_escalation', { p_session: session, p_outcome: outcome.trim().slice(0, 500), p_close_session: close });
  if (error) return failAt(error, here(session));
  revalidatePath(PATH);
  return ok(close ? 'Conversation closed.' : 'Handed back to Octo.');
}

/** Side-rail lookup by tracking number or order code (RLS applies through the user client). */
export async function lookupShipmentFact(ref: string): Promise<{ ok: true; fact: Fact | null } | { ok: false; error: string }> {
  const g = await guard('assistant', 'view');
  if ('error' in g) return { ok: false, error: g.error.ok ? 'Failed' : g.error.error };
  const r = ref.trim().slice(0, 60);
  if (!r) return { ok: false, error: 'Enter a tracking number or order code.' };
  try {
    return { ok: true, fact: await getShipmentFacts(g.sb, r) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lookup failed' };
  }
}

/** Refresh the quote / wallet facts for one RFQ or org on demand. */
export async function refreshFact(kind: 'quotes' | 'wallet', ref: string): Promise<{ ok: true; fact: Fact | null } | { ok: false; error: string }> {
  const g = await guard('assistant', 'view');
  if ('error' in g) return { ok: false, error: g.error.ok ? 'Failed' : g.error.error };
  try {
    return { ok: true, fact: kind === 'quotes' ? await getQuoteFacts(g.sb, ref) : await getWalletFacts(g.sb, ref) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lookup failed' };
  }
}

/** Out-of-office from the queue header (same RPC as /staff/account). */
export async function setOutOfOffice(value: boolean): Promise<Result> {
  const g = await guard('assistant', 'view');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('set_out_of_office', { p_value: value });
  if (error) return failAt(error, PATH);
  revalidatePath(PATH);
  return ok(value ? 'Out of office — new handoffs go to your team queue.' : 'Welcome back — handoffs come to you again.');
}
