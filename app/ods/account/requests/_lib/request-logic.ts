/**
 * ODS /account/requests — pure request logic (unit tested). Today's raw statuses (rfqs.status + the order it led to,
 * service_requests.status) → Appendix C request names; CardTabs groups; the 5-step stepper
 * (Sent → Quoting → Quote ready → Accepted → Ordered); URL state.
 */
import { TYPE_LABEL, isSourcingType, type SourcingType } from '@/lib/sourcing';
import type { StepStatus } from '@octopus/ui';
import { requestStatusName } from '../../_lib/status';
import { hrefWith, one, type SearchParamsRecord } from '../../orders/_lib/commerce-format';

export const REQUEST_STATUS_NAMES = ['Draft', 'Sent', 'Quoting', 'Quote ready', 'Accepted', 'Closed'] as const;
export type RequestStatusName = (typeof REQUEST_STATUS_NAMES)[number];

/** rfqs.status → Appendix C via the FRAME builder's shared map (_lib/status.ts); once a quote led to an order, the
 *  order decides: closed / cancelled → Closed, otherwise Accepted. */
export function rfqStatusName(raw: string, orderStatus?: string | null): RequestStatusName {
  if (orderStatus === 'closed' || orderStatus === 'cancelled') return 'Closed';
  if (orderStatus) return 'Accepted';
  const n = requestStatusName(raw);
  return (REQUEST_STATUS_NAMES as readonly string[]).includes(n) ? (n as RequestStatusName) : 'Closed';
}

/** service_requests.status → Appendix C (no quotes: paid = our team is on it). */
export function serviceRequestStatusName(raw: string): RequestStatusName {
  switch (raw) {
    case 'requested':
      return 'Sent';
    case 'paid':
      return 'Quoting';
    case 'accepted':
    case 'in_progress':
    case 'report_ready':
      return 'Accepted';
    default:
      return 'Closed'; // completed, rejected, refunded
  }
}

export type RequestCard = 'all' | 'quoting' | 'ready' | 'accepted' | 'closed';
export const REQUEST_CARDS: [RequestCard, string, string][] = [
  ['all', 'All', 'Every request'],
  ['quoting', 'Quoting', 'We are getting quotes'],
  ['ready', 'Quote ready', 'Compare and choose'],
  ['accepted', 'Accepted', 'Order created'],
  ['closed', 'Closed', 'Expired or finished'],
];

/** Card groups: Quoting holds Sent + Quoting (both wait on our team); Draft only shows under All. */
export function matchesRequestCard(s: RequestStatusName, c: RequestCard): boolean {
  switch (c) {
    case 'quoting':
      return s === 'Sent' || s === 'Quoting';
    case 'ready':
      return s === 'Quote ready';
    case 'accepted':
      return s === 'Accepted';
    case 'closed':
      return s === 'Closed';
    default:
      return true;
  }
}

export type RequestsState = { status: RequestCard; service: SourcingType | 'all'; q: string };
export function parseRequestsParams(sp: SearchParamsRecord): RequestsState {
  const st = one(sp.status) as RequestCard;
  const svc = one(sp.service);
  return { status: REQUEST_CARDS.some(([k]) => k === st) ? st : 'all', service: isSourcingType(svc) ? svc : 'all', q: one(sp.q).trim().slice(0, 80) };
}
export function requestsHref(s: RequestsState, patch: Partial<RequestsState> = {}, base = '/account/requests'): string {
  const n = { ...s, ...patch };
  return hrefWith(base, { status: n.status === 'all' ? null : n.status, service: n.service === 'all' ? null : n.service, q: n.q || null });
}

export type RequestRowVM = {
  id: string;
  ref: string;
  kind: 'rfq' | 'service';
  title: string;
  type: SourcingType;
  typeLabel: string;
  quantity: number | null;
  unit: string | null;
  statusName: RequestStatusName;
  quotes: number;
  newQuotes: number;
  orderRef: string | null;
  createdAt: string;
  action: { label: string; href: string };
};

/** Shape of today's listSourcing() rows (components/account/sourcing-data.ts) that we use. */
export type SourcingRowLike = {
  kind: 'rfq' | 'service';
  id: string;
  ref: string;
  title: string;
  quantity: number | null;
  unit: string | null;
  type: SourcingType;
  raw: string;
  quotes: number;
  newQuotes: number;
  created_at: string;
  order: { id: string; code: string; status: string } | null;
};

export function toRequestRow(r: SourcingRowLike): RequestRowVM {
  const statusName = r.kind === 'rfq' ? rfqStatusName(r.raw, r.order?.status) : serviceRequestStatusName(r.raw);
  const detail = `/account/requests/${encodeURIComponent(r.ref)}`;
  const action =
    r.newQuotes > 0 || statusName === 'Quote ready'
      ? { label: 'Compare quotes', href: `${detail}?tab=quotes` }
      : r.order
        ? { label: 'Go to order', href: `/account/orders/${encodeURIComponent(r.order.code)}` }
        : { label: 'Open', href: detail };
  return {
    id: r.id,
    ref: r.ref,
    kind: r.kind,
    title: r.title,
    type: r.type,
    typeLabel: TYPE_LABEL[r.type],
    quantity: r.quantity,
    unit: r.unit,
    statusName,
    quotes: r.quotes,
    newQuotes: r.newQuotes,
    orderRef: r.order?.code ?? null,
    createdAt: r.created_at,
    action,
  };
}

export type RequestsListVM = {
  rows: RequestRowVM[];
  total: number;
  cardCounts: Record<RequestCard, number>;
  serviceCounts: Partial<Record<SourcingType, number>>;
  newQuotes: number;
};

export function buildRequestsList(all: RequestRowVM[], s: RequestsState): RequestsListVM {
  const q = s.q.toLowerCase();
  const searched = q ? all.filter((r) => r.ref.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)) : all;
  const bySvc = s.service === 'all' ? searched : searched.filter((r) => r.type === s.service);
  const cardCounts = Object.fromEntries(REQUEST_CARDS.map(([c]) => [c, bySvc.filter((r) => matchesRequestCard(r.statusName, c)).length])) as Record<RequestCard, number>;
  const byCard = searched.filter((r) => matchesRequestCard(r.statusName, s.status));
  const serviceCounts: Partial<Record<SourcingType, number>> = {};
  for (const r of byCard) serviceCounts[r.type] = (serviceCounts[r.type] ?? 0) + 1;
  const rows = s.service === 'all' ? byCard : byCard.filter((r) => r.type === s.service);
  return { rows, total: all.length, cardCounts, serviceCounts, newQuotes: all.reduce((n, r) => n + r.newQuotes, 0) };
}

/* ───────── stepper ───────── */

export const RFQ_STEPS = ['Sent', 'Quoting', 'Quote ready', 'Accepted', 'Ordered'] as const;
export const SERVICE_STEPS = ['Sent', 'In review', 'Accepted', 'Done'] as const;

/**
 * Stepper steps with an explicit status each. Sourcing (RFQ): Sent → Quoting → Quote ready → Accepted → Ordered (accepting
 * a quote creates the order in the same step today, so Accepted and Ordered complete together). Closed requests keep the
 * steps they reached as done and show nothing as current.
 */
export function requestSteps(kind: 'rfq' | 'service', s: RequestStatusName, o: { hasOrder: boolean; quotes: number; rawService?: string }): { label: string; status: StepStatus }[] {
  const labels: readonly string[] = kind === 'rfq' ? RFQ_STEPS : SERVICE_STEPS;
  let current: number;
  let closed = false;
  if (kind === 'rfq') {
    current = s === 'Draft' ? 0 : s === 'Sent' || s === 'Quoting' ? 1 : s === 'Quote ready' ? 2 : s === 'Accepted' ? (o.hasOrder ? 5 : 4) : -1;
    if (current < 0) {
      closed = true;
      current = o.hasOrder ? 5 : o.quotes > 0 ? 3 : 1;
    }
  } else {
    const done = o.rawService === 'completed';
    current = s === 'Sent' ? 1 : s === 'Quoting' ? 1 : s === 'Accepted' ? 3 : done ? 4 : -1;
    if (current < 0) {
      closed = true;
      current = 1;
    }
  }
  return labels.map((label, i) => ({ label, status: i < current ? 'done' : i === current && !closed ? 'current' : 'upcoming' }));
}

export const REQUEST_TABS = ['overview', 'quotes', 'messages', 'files', 'timeline'] as const;
export type RequestTab = (typeof REQUEST_TABS)[number];
export const parseRequestTab = (t: string | undefined): RequestTab => ((REQUEST_TABS as readonly string[]).includes(t ?? '') ? (t as RequestTab) : 'overview');

/** "Option A", "Option B" … for quotes shown side by side (factory never named). */
export const optionLabel = (i: number) => `Option ${String.fromCharCode(65 + (i % 26))}`;
