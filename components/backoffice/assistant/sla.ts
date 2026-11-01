/** Pure helpers for the back-office assistant queue (SPEC §20.5). Safe on server and client. */

export type SlaInfo = { text: string; overdue: boolean; soon: boolean; minutes: number | null };

/** SLA counter to `sla_due_at`: "34 min left", "2 h 5 min left", "Overdue 12 min" (overdue → red text + label). */
export function slaInfo(due: string | null | undefined, now: number, resolvedAt?: string | null): SlaInfo {
  if (resolvedAt) return { text: 'Resolved', overdue: false, soon: false, minutes: null };
  if (!due) return { text: 'No SLA', overdue: false, soon: false, minutes: null };
  const mins = Math.round((new Date(due).getTime() - now) / 60_000);
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  if (mins < 0) return { text: `Overdue ${fmt(-mins)}`, overdue: true, soon: false, minutes: mins };
  return { text: `${fmt(mins)} left`, overdue: false, soon: mins <= 15, minutes: mins };
}

export const REASON_LABEL: Record<string, string> = {
  customer_request: 'Customer asked',
  sensitive_topic: 'Sensitive topic',
  low_confidence: 'Low confidence',
  negative_sentiment: 'Negative sentiment',
  needs_approval: 'Needs approval',
  vip: 'VIP',
  after_hours: 'After hours',
  timeout: 'Model timeout',
  staff_take_over: 'Staff take-over',
};

export const REASON_TONE: Record<string, 'red' | 'amber' | 'blue' | 'gray'> = {
  sensitive_topic: 'red',
  negative_sentiment: 'red',
  needs_approval: 'amber',
  low_confidence: 'amber',
  timeout: 'amber',
  vip: 'blue',
  customer_request: 'blue',
  after_hours: 'gray',
  staff_take_over: 'gray',
};

export type QueueAuthor = 'bot' | 'customer' | 'staff' | 'system';

/** Label shown above a message bubble in the staff view (internal notes are flagged explicitly). */
export function authorLabel(author: QueueAuthor, hidden: boolean, staffName?: string | null): string {
  if (author === 'bot') return 'Octo';
  if (author === 'customer') return 'Customer';
  if (author === 'system') return 'System';
  return `${hidden ? 'Internal · ' : ''}${staffName || 'Staff'}`;
}

/** Initials for the staff avatar ("Priya Shah" → "PS"). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
