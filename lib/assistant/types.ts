/** Shared (client-safe) types for Octo, the AI account assistant (SPEC §20). */

export type AssistantAuthor = 'bot' | 'customer' | 'staff' | 'system';

export type RfqDraft = {
  kind: 'rfq';
  title: string;
  quantity: number;
  details: string;
  destination_country?: string | null;
  destination_city?: string | null;
  target_price?: number | null; // major units in the platform currency
  incoterm?: string | null;
  product_id?: string | null;
  fee_minor?: number | null;
  fee_currency?: string | null;
};

export type ServiceDraft = {
  kind: 'service';
  service_code: string;
  service_name?: string | null;
  details: Record<string, string>;
  product_id?: string | null;
  fee_minor?: number | null;
  fee_currency?: string | null;
};

export type AssistantDraft = RfqDraft | ServiceDraft;

/** One entry of assistant_messages.tools_called (args are redacted before storage). */
export type ToolCallLog = {
  tool: string;
  args: Record<string, unknown>;
  latency_ms: number;
  ok: boolean;
  error?: string;
  link?: { href: string; label: string } | null;
  draft?: AssistantDraft | null;
};

export type AssistantMessage = {
  id: string;
  session_id: string;
  author: AssistantAuthor;
  author_user_id: string | null;
  content: string;
  confidence: number | null;
  tools_called: ToolCallLog[];
  created_at: string;
};

export type AccountTeam = {
  staff_user_id: string;
  name: string;
  first_name: string;
  initials: string;
  title: string;
  team: string | null;
  office: string | null;
  out_of_office: boolean;
  email: string | null;
  phone: string | null;
  hours_label: string | null;
};

export type ContextCounts = { orders: number; openRfqs: number; pledges: number };

export type ReplyResponse = {
  session_id: string;
  messages: AssistantMessage[];
  escalated: boolean;
  draft?: AssistantDraft | null;
  error?: string;
};

export const MESSAGE_COLUMNS = 'id, session_id, author, author_user_id, content, confidence, tools_called, created_at';

export function initials(name: string | null | undefined, fallback = '?') {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function contextLabel(c: ContextCounts) {
  return `Context: ${plural(c.orders, 'order')}, ${plural(c.openRfqs, 'open RFQ')}, ${plural(c.pledges, 'pool pledge')}`;
}
