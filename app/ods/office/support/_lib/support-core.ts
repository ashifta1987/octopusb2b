/**
 * ODS T9 · Back Office › Support desk — pure logic (server + client + tests). Same filters, ordering and SLA text as
 * today's app/office/support/page.tsx; today's reply / status / priority / assign / macro / escalate actions are reused.
 */
export const SUPPORT_PATH = '/office/support';

/** Today's filters, as tabs (same keys, so today's ?f= links keep working). */
export const TICKET_FILTERS = ['all', 'complaint', 'question', 'feedback', 'overdue', 'mine', 'resolved'] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];
export const FILTER_LABEL: Record<TicketFilter, string> = { all: 'All open', complaint: 'Complaints', question: 'Questions', feedback: 'Feedback', overdue: 'Overdue', mine: 'Assigned to me', resolved: 'Resolved' };
export const isTicketFilter = (f: unknown): f is TicketFilter => typeof f === 'string' && (TICKET_FILTERS as readonly string[]).includes(f);

export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
/** Today's status list (setTicketStatus / reply_ticket accept these). */
export const TICKET_STATUSES = ['new', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed', 'reopened'] as const;
/** Today's composer "Then set status" choices ('' = automatic). */
export const REPLY_STATUSES = ['', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed'] as const;

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo';
export const ticketStatusTone = (s: string): Tone =>
  (({ new: 'info', open: 'info', reopened: 'warning', waiting_customer: 'warning', waiting_internal: 'warning', resolved: 'success', closed: 'neutral' }) as Record<string, Tone>)[s] ?? 'neutral';
export const priorityTone = (p: string): Tone => (p === 'urgent' || p === 'high' ? 'danger' : 'neutral');
export const categoryTone = (c: string): Tone => (c === 'complaint' ? 'danger' : c === 'feedback' ? 'warning' : 'info');

/** Today's slaLabel, with the clock passed in. */
export function slaLabel(due: string | null, status: string, nowMs: number): { text: string; bad: boolean } {
  if (!due || ['resolved', 'closed'].includes(status)) return { text: human(status), bad: false };
  const h = Math.round((new Date(due).getTime() - nowMs) / 36e5);
  return h < 0 ? { text: `Overdue ${-h} h`, bad: true } : { text: h < 24 ? `${h} h left` : `${Math.round(h / 24)} days left`, bad: h < 4 };
}

/** Today's queue order: priority, then the nearest reply target. */
export function sortTickets<T extends { priority: string; sla_due_at?: string | null; slaDueAt?: string | null }>(list: readonly T[]): T[] {
  const due = (t: T) => t.sla_due_at ?? t.slaDueAt ?? '9';
  return [...list].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || due(a).localeCompare(due(b)));
}

export type SupportQuery = { f: TicketFilter; p: string | null; t: string | null; q: string };
type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
export function parseSupportQuery(sp: SP): SupportQuery {
  const f = first(sp.f);
  const p = first(sp.p);
  const t = first(sp.t);
  return {
    f: isTicketFilter(f) ? f : 'all',
    p: (PRIORITIES as readonly string[]).includes(p) ? p : null,
    t: /^[0-9a-f-]{36}$/i.test(t) ? t : null,
    q: first(sp.q).replace(/[,()%*\\]/g, '').trim().slice(0, 80),
  };
}
export function supportHref(base: string, q: SupportQuery, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (q.f !== 'all') p.set('f', q.f);
  if (q.p) p.set('p', q.p);
  if (q.q) p.set('q', q.q);
  if (q.t) p.set('t', q.t);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/* ───────── view models ───────── */

export type TicketRow = {
  id: string;
  code: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  slaDueAt: string | null;
  customer: string;
  assignee: string | null;
  assignedToMe: boolean;
  orderId: string | null;
  orderCode: string | null;
  updatedAt: string;
};

export type TicketMessage = { id: string; author: string; isStaff: boolean; internal: boolean; body: string; attachments: number; createdAt: string };

export type TicketDetail = {
  id: string;
  code: string;
  orgId: string;
  orderId: string | null;
  subject: string;
  category: string;
  priority: string;
  status: string;
  slaDueAt: string | null;
  csat: number | null;
  createdAt: string;
  customer: { name: string; country: string | null; kycStatus: string | null } | null;
  order: { id: string; code: string; status: string; supplierCode?: string | null; deliveredAt: string | null; claimVisibleUntil: string | null; claimHiddenUntil: string | null } | null;
  assignee: string | null;
  assignedToMe: boolean;
  /** null = failed to load */
  messages: TicketMessage[] | null;
  warehouse: {
    kindLabel: string;
    order: { code: string; status: string; externalRef: string | null; warehouseCode: string; packed: boolean; photos: number; trackingToken: string | null } | null;
    asn: { code: string; status: string; warehouseCode: string } | null;
    ret: { code: string; status: string; decision: string | null } | null;
  } | null;
  dropship: { orderNumber: string; externalName: string | null; merchantStatus: string; paymentState: string; total: string; cases: { code: string; kind: string; status: string }[] } | null;
  /** escalation currency (order currency, else the platform currency — as today) */
  escCurrency: string;
};

export type SupportKpis = { open: number | null; overdue: number | null; mine: number; csat: { avg: string | null; n: number } | null; macros: number | null };
export type Macro = { id: string; title: string; body: string };

export type SupportPerms = { canEdit: boolean; canEscalate: boolean; canSeeSuppliers: boolean };
/** Today's checks: support:edit (reply, status, priority, assign, macros); support:create or finance:create (escalate). */
export function supportPerms(s: { isAdmin: boolean; can: (area: string, action: string) => boolean }): SupportPerms {
  return {
    canEdit: s.can('support', 'edit'),
    canEscalate: s.can('support', 'create') || s.can('finance', 'create'),
    canSeeSuppliers: s.isAdmin || s.can('suppliers', 'view') || s.can('finance', 'view'),
  };
}

/** Claim window banner (Terms) for a delivered order: open while hidden-defect claims are still possible. */
export function claimWindowOpen(claimHiddenUntil: string | null, nowMs: number): boolean {
  return !!claimHiddenUntil && new Date(claimHiddenUntil).getTime() > nowMs;
}
