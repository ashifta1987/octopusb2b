import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import type { AssistantMessage, ToolCallLog } from './types';

/**
 * Customer-safe reads of assistant_messages (migration 195): `confidence`, `tools_called`, `tokens`, `latency_ms` are
 * internal and not readable with the customer's session. The customer's client reads only these columns (RLS decides
 * which rows); the links / draft cards the conversation needs are taken from tools_called server-side (service role, for
 * the rows RLS already returned) and passed on without tool args, errors or timings. Confidence is never sent.
 */
export const CUSTOMER_MESSAGE_COLUMNS = 'id, session_id, author, author_user_id, content, created_at';

type Row = Omit<AssistantMessage, 'confidence' | 'tools_called'>;

/** Only what the customer UI renders from a tool call: the tool name, ok, its link and its draft card. */
export function customerToolView(t: ToolCallLog): ToolCallLog {
  return { tool: t.tool, args: {}, latency_ms: 0, ok: !!t.ok, link: t.ok ? (t.link ?? null) : null, draft: t.ok ? (t.draft ?? null) : null };
}

export async function toCustomerMessages(rows: Row[] | null | undefined): Promise<AssistantMessage[]> {
  const list = rows ?? [];
  const botIds = list.filter((m) => m.author === 'bot').map((m) => m.id);
  const tools = new Map<string, ToolCallLog[]>();
  if (botIds.length) {
    try {
      const { data } = await createAdminClient().from('assistant_messages').select('id, tools_called').in('id', botIds);
      (data ?? []).forEach((r) => tools.set(r.id as string, ((r.tools_called ?? []) as ToolCallLog[]).map(customerToolView)));
    } catch { /* no service key (local preview) → no tool links */ }
  }
  return list.map((m) => ({ ...m, confidence: null, tools_called: tools.get(m.id) ?? [] }));
}
