// ODS T9
/**
 * ODS T9 · Service requests (Part 7.6) — pure rules. Server + client safe.
 * Same transitions as today's /office/services (mirrors transition_service_request(); the DB function decides),
 * same filters (?f=open|done|rejected, ?type=, ?r= highlight). Actions call today's `transitionService` unchanged.
 */
export const SERVICE_NEXT: Record<string, string[]> = {
  requested: ['paid', 'rejected'],
  paid: ['accepted', 'rejected'],
  accepted: ['in_progress'],
  in_progress: ['report_ready', 'completed'],
  report_ready: ['completed'],
  rejected: ['refunded'],
};

export type ServiceTab = 'open' | 'done' | 'rejected';
export const SERVICE_FILTERS: Record<ServiceTab, string[]> = {
  open: ['requested', 'paid', 'accepted', 'in_progress', 'report_ready'],
  done: ['completed'],
  rejected: ['rejected', 'refunded'],
};
export const SERVICE_TABS: { id: ServiceTab; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'rejected', label: 'Rejected' },
];
export const serviceTab = (v: string | null | undefined): ServiceTab => (v === 'done' || v === 'rejected' ? v : 'open');

export const SERVICE_STAGE_LABEL: Record<string, string> = {
  requested: 'Requested', paid: 'Paid', accepted: 'Accepted', in_progress: 'In progress', report_ready: 'Report ready',
  completed: 'Completed', rejected: 'Rejected', refunded: 'Refunded',
};
export const serviceStageLabel = (s: string) => SERVICE_STAGE_LABEL[s] ?? s.replace(/_/g, ' ');

/**
 * Appendix C pill for staff (the raw stage is always shown beside it): requested → Waiting for payment, paid → Paid,
 * accepted / in progress / report ready → Accepted, completed → Closed, rejected → Rejected, refunded → Refunded.
 * (The customer's Requests page uses its own request names; staff see the payment step explicitly.)
 */
export function serviceStatusName(raw: string): 'Waiting for payment' | 'Paid' | 'Accepted' | 'Closed' | 'Rejected' | 'Refunded' {
  switch (raw) {
    case 'requested': return 'Waiting for payment';
    case 'paid': return 'Paid';
    case 'accepted':
    case 'in_progress':
    case 'report_ready': return 'Accepted';
    case 'rejected': return 'Rejected';
    case 'refunded': return 'Refunded';
    default: return 'Closed';
  }
}

/** Button names for the next stage (today's buttons said the target stage: "Paid", "Accepted", …). */
export const SERVICE_ACTION_LABEL: Record<string, string> = {
  paid: 'Mark paid', accepted: 'Accept', in_progress: 'Start work', report_ready: 'Report ready', completed: 'Complete', refunded: 'Mark refunded',
};

export type ServiceAction = { to: string; label: string; kind: 'reason' | 'run'; primary: boolean; confirm?: string; placeholder?: string };

/** The buttons today's row shows: requests:edit only; Reject asks for a reason; Paid / Refunded ask to confirm. */
export function serviceActions(r: { status: string; code: string; paidVia: string | null }, canEdit: boolean): ServiceAction[] {
  if (!canEdit) return [];
  return (SERVICE_NEXT[r.status] ?? []).map((to) =>
    to === 'rejected'
      ? { to, label: 'Reject', kind: 'reason', primary: false, placeholder: r.paidVia === 'wallet' ? 'Reason (fee is refunded to the wallet)' : 'Reason' }
      : {
        to,
        label: SERVICE_ACTION_LABEL[to] ?? serviceStageLabel(to),
        kind: 'run',
        primary: to === 'completed',
        confirm: to === 'paid' ? `Mark ${r.code} as paid (invoice settled)?` : to === 'refunded' ? `Mark ${r.code} as refunded?` : undefined,
      });
}

/** Reject needs a reason (same as transitionService). */
export const validateServiceReason = (to: string, reason: string) => (to === 'rejected' && !reason.trim() ? 'A reason is required to reject.' : null);

/** First four non-empty details, "Key: value" (today's summary). */
export function detailsSummary(details: Record<string, unknown> | null | undefined, max = 4): string {
  return Object.entries(details ?? {})
    .filter(([, v]) => v != null && v !== '')
    .slice(0, max)
    .map(([k, v]) => `${humanKey(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}
export function detailsList(details: Record<string, unknown> | null | undefined): [string, string][] {
  return Object.entries(details ?? {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [humanKey(k), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
}
const humanKey = (k: string) => {
  const s = k.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export type ServiceRow = {
  id: string;
  code: string;
  serviceCode: string;
  type: string;
  customer: string | null;
  place: string;
  product: string | null;
  summary: string;
  details: [string, string][];
  feeMinor: number;
  currency: string;
  paidVia: string | null;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  /** service_requests.assigned_to → name (hidden column, read with the service role after requireStaff, as today's pages do). */
  owner: string | null;
};
