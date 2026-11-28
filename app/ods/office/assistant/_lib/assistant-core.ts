// ODS T9
/**
 * ODS T9 · Assistant queue (SPEC §20.5, Part 7.6) — pure rules. Server + client safe.
 * Same three lists as today's /office/assistant (open escalations by SLA, my assigned customers, Octo low-confidence
 * threads), same `?session=` deep link. Every action calls today's server actions in app/office/assistant/actions.ts.
 */
import { slaInfo, REASON_LABEL, authorLabel, initials, type QueueAuthor } from '@/components/backoffice/assistant/sla';

export { slaInfo, REASON_LABEL, authorLabel, initials, type QueueAuthor };

export type AssistantTab = 'escalations' | 'mine' | 'low';
export const ASSISTANT_TABS: { id: AssistantTab; label: string }[] = [
  { id: 'escalations', label: 'Waiting for a human' },
  { id: 'mine', label: 'My customers' },
  { id: 'low', label: 'Octo unsure' },
];
export const assistantTab = (v: string | null | undefined): AssistantTab => (v === 'mine' || v === 'low' ? v : 'escalations');

export const SESSION_STATUS_LABEL: Record<string, string> = { bot: 'Octo', escalated: 'Waiting for human', human: 'Human', closed: 'Closed' };
/** Pill tone per session status (escalated = needs attention). */
export const SESSION_STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral'> = { bot: 'info', escalated: 'warning', human: 'success', closed: 'neutral' };
export const REASON_PILL_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  sensitive_topic: 'danger', negative_sentiment: 'danger', needs_approval: 'warning', low_confidence: 'warning', timeout: 'warning',
  vip: 'info', customer_request: 'info', after_hours: 'neutral', staff_take_over: 'neutral',
};
export const reasonLabel = (r: string | null | undefined) => (r ? (REASON_LABEL[r] ?? r.replace(/_/g, ' ')) : '—');

export type AssistantRow = {
  /** session id (row id); `null` for a customer of mine with no conversation yet */
  sessionId: string | null;
  key: string;
  orgName: string;
  buyerCode: string | null;
  country: string | null;
  title: string;
  status: string | null;
  reason: string | null;
  slaDueAt: string | null;
  lastMessageAt: string | null;
  lowTurns: number;
  /** 'me' · 'colleague' · 'team' (escalations), null elsewhere */
  assignment: 'me' | 'colleague' | 'team' | null;
  taken: boolean;
  kycStatus?: string | null;
};

export function assignmentOf(assignedTo: string | null, userId: string): 'me' | 'colleague' | 'team' {
  return assignedTo ? (assignedTo === userId ? 'me' : 'colleague') : 'team';
}
export const ASSIGNMENT_LABEL = { me: 'Assigned to me', colleague: 'Assigned to colleague', team: 'Team queue' } as const;

/** "5 min ago" · "3 h ago" · "2 d ago" (today's ago()). */
export function ago(d: string | null | undefined, now: number): string {
  if (!d) return '—';
  const m = Math.max(0, Math.round((now - new Date(d).getTime()) / 60_000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export const overdueCount = (rows: AssistantRow[], now: number) => rows.filter((r) => r.slaDueAt && new Date(r.slaDueAt).getTime() < now).length;

/** Which conversation buttons show (same rules as today's ConversationWorkspace). */
export function conversationActions(input: { status: string; hasOpenEscalation: boolean; canReply: boolean; canTakeOver: boolean; canClose: boolean }) {
  const closed = input.status === 'closed';
  return {
    closed,
    reply: input.canReply && !closed,
    takeOver: input.canTakeOver && !closed && input.status !== 'human',
    resolve: input.canClose && !closed && (input.hasOpenEscalation || input.status !== 'bot'),
  };
}

export const conversationStatusText = (status: string) =>
  status === 'bot' ? 'Octo answering' : status === 'human' ? 'Human (you or team)' : status === 'escalated' ? 'Waiting for a human' : 'Closed';

/** Reply checks (same as staffAssistantReply): not empty, 4,000 characters max. */
export function validateReply(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Write a message first.';
  if (t.length > 4000) return 'Message is too long (4,000 characters max).';
  return null;
}

export type ConversationMessage = {
  id: string;
  author: QueueAuthor;
  authorName: string | null;
  content: string;
  internal: boolean;
  confidence: number | null;
  tools: number;
  createdAt: string;
};

export type ConversationFact = { key: string; title: string; text: string; kind?: 'quotes' | 'wallet' | 'shipment'; ref?: string };

/** Action result shape of today's assistant actions (components/admin/server Result). */
export type AssistantResult = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
