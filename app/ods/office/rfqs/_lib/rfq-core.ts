/**
 * ODS T9 · Back Office › Sales › Sourcing requests (RFQs) and quotes — pure logic (server + client + unit tests).
 *
 * - Status names: rfqs.status → Appendix C request names through the shared map (`requestStatusName`, same as My account),
 *   so staff and customers read the same words. assigned → "Sent" (our team picked it up, no quote work yet).
 * - Tabs (`?f=`): today's filter keys keep working (`open` default, `to_quote` = the sidebar "Quotes" item, `accepted`,
 *   `closed`) plus one tab per Appendix C name and `all`. Each tab = a list of raw rfqs.status values (same lists as today).
 * - Line summary (audit C4): ALL rfq_lines (count + first title); when rfq_lines can't be read (migration 251 not applied)
 *   line 1 = the RFQ itself (rfqs.title / quantity), exactly what today's page shows.
 * - Quote summary per RFQ from quotes.status (no supplier, no cost).
 * - Permission visibility: supplier names follow `suppliers:view` (the suppliers_staff RLS policy today's page relies on);
 *   there is no cost / margin on these pages today (quotes.unit_price_cents is the buyer price), so none is shown.
 */
import { requestStatusName } from '@/app/ods/account/_lib/status';
import { requestSteps, type RequestStatusName } from '@/app/ods/account/requests/_lib/request-logic';
import type { StepStatus } from '@octopus/ui';

export const RFQS_PATH = '/office/rfqs';
/** saved-views page key (lib/office/views: a path) */
export const RFQ_VIEWS_PAGE = '/office/rfqs';

/* ───────── tabs / filters ───────── */

export type RfqTab = 'open' | 'to_quote' | 'sent' | 'quoting' | 'quote_ready' | 'accepted' | 'closed' | 'all';

/** Raw rfqs.status per tab. open / to_quote / accepted / closed = today's FILTERS (app/office/rfqs/page.tsx), unchanged. */
export const TAB_STATUSES: Record<RfqTab, readonly string[]> = {
  open: ['submitted', 'assigned', 'quoting', 'quoted'],
  to_quote: ['submitted', 'assigned', 'quoting'],
  sent: ['submitted', 'assigned'],
  quoting: ['quoting'],
  quote_ready: ['quoted'],
  accepted: ['accepted'],
  closed: ['expired', 'cancelled'],
  all: ['submitted', 'assigned', 'quoting', 'quoted', 'accepted', 'expired', 'cancelled'],
};

export const RFQ_TABS: [RfqTab, string][] = [
  ['open', 'Open'],
  ['to_quote', 'To quote'],
  ['sent', 'Sent'],
  ['quoting', 'Quoting'],
  ['quote_ready', 'Quote ready'],
  ['accepted', 'Accepted'],
  ['closed', 'Closed'],
  ['all', 'All'],
];

export const isRfqTab = (v: unknown): v is RfqTab => typeof v === 'string' && v in TAB_STATUSES;

/** Today's order: open lists oldest first (so the oldest request gets quoted first); accepted / closed newest first. */
export const tabAscending = (t: RfqTab) => t !== 'closed' && t !== 'accepted' && t !== 'all';

/** Raw status counts → tab counts (KPI strip + tab badges). Missing statuses count 0. */
export function tabCounts(byStatus: Record<string, number>): Record<RfqTab, number> {
  const out = {} as Record<RfqTab, number>;
  for (const [t, list] of Object.entries(TAB_STATUSES) as [RfqTab, readonly string[]][]) out[t] = list.reduce((n, s) => n + (byStatus[s] ?? 0), 0);
  return out;
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export type RfqQuery = { f: RfqTab; q: string; view: string | null };
export const DEFAULT_RFQ_QUERY: RfqQuery = { f: 'open', q: '', view: null };

/** `?f=` unknown → open (today's default). */
export function parseRfqQuery(sp: SearchParamsRecord): RfqQuery {
  const f = first(sp.f);
  const q = (first(sp.q) ?? '').slice(0, 80);
  const view = first(sp.view) ?? null;
  return { f: isRfqTab(f) ? f : 'open', q, view: view && view.length <= 80 ? view : null };
}

export function rfqQueryHref(base: string, q: RfqQuery, extra?: Record<string, string>): string {
  const u = new URLSearchParams(extra);
  if (q.f !== 'open') u.set('f', q.f);
  if (q.q) u.set('q', q.q);
  if (q.view) u.set('view', q.view);
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

export const BUILTIN_VIEWS: { id: string; label: string; filters: { f: RfqTab } }[] = [
  { id: 'builtin:open', label: 'Open requests', filters: { f: 'open' } },
  { id: 'builtin:to_quote', label: 'Sales · to quote', filters: { f: 'to_quote' } },
];

/** saved view filters → query (unknown keys ignored) */
export function queryFromView(filters: Record<string, unknown>, id: string | null): RfqQuery {
  return { f: isRfqTab(filters.f) ? filters.f : 'open', q: typeof filters.q === 'string' ? filters.q.slice(0, 80) : '', view: id };
}

/* ───────── status names ───────── */

export function rfqStatusName(raw: string): RequestStatusName {
  return requestStatusName(raw) as RequestStatusName;
}

/** Stepper Sent → Quoting → Quote ready → Accepted → Ordered (the same steps the customer sees). Expired / cancelled:
 *  steps reached stay done, nothing current, plus a closed note. */
export function rfqSteps(raw: string, o: { hasOrder: boolean; quotes: number }): { label: string; status: StepStatus }[] {
  return requestSteps('rfq', rfqStatusName(raw), o);
}

export function closedNote(raw: string): string | null {
  if (raw === 'expired') return 'This request expired without an accepted quote.';
  if (raw === 'cancelled') return 'This request was cancelled.';
  return null;
}

/** Today's page: quotes can be added only while the RFQ is open. */
export const acceptsQuotes = (raw: string) => (TAB_STATUSES.open as readonly string[]).includes(raw);

/* ───────── lines (audit C4) ───────── */

export type RfqLineLike = { line_no: number; title: string; quantity: number; unit: string | null };
export type LineSummary = { count: number; firstTitle: string; more: number; text: string; fromLines: boolean };

/** All lines → "3 products · Ceramic mug 350 ml +2 more". No readable lines → line 1 = the RFQ itself (today's view). */
export function lineSummary(lines: readonly RfqLineLike[] | null | undefined, fallback: { title: string }): LineSummary {
  const sorted = [...(lines ?? [])].sort((a, b) => a.line_no - b.line_no);
  if (!sorted.length) return { count: 1, firstTitle: fallback.title, more: 0, text: fallback.title, fromLines: false };
  const count = sorted.length;
  const firstTitle = sorted[0].title;
  return { count, firstTitle, more: count - 1, text: count === 1 ? firstTitle : `${firstTitle} +${count - 1} more`, fromLines: true };
}

export type RfqLineVM = {
  lineNo: number;
  title: string;
  quantity: number;
  unit: string;
  targetMinor: number | null;
  customisation: string[];
  notes: string | null;
  productId: string | null;
};

/** Lines tab rows; `null` lines (table unreadable) → line 1 from the RFQ. */
export function linesForRecord(
  lines: readonly Record<string, unknown>[] | null,
  rfq: { title: string; quantity: number; unit: string | null; target_price_cents: number | null; product_id?: string | null },
): { rows: RfqLineVM[]; fromLines: boolean } {
  if (lines && lines.length) {
    return {
      fromLines: true,
      rows: [...lines]
        .map((l) => ({
          lineNo: Number(l.line_no),
          title: String(l.title ?? ''),
          quantity: Number(l.quantity ?? 0),
          unit: (l.unit as string | null) ?? 'pcs',
          targetMinor: l.target_price_minor == null ? null : Number(l.target_price_minor),
          customisation: Array.isArray(l.customisation) ? (l.customisation as unknown[]).map(String).filter(Boolean) : [],
          notes: (l.notes as string | null) ?? null,
          productId: (l.product_id as string | null) ?? null,
        }))
        .sort((a, b) => a.lineNo - b.lineNo),
    };
  }
  return {
    fromLines: false,
    rows: [{ lineNo: 1, title: rfq.title, quantity: rfq.quantity, unit: rfq.unit ?? 'pcs', targetMinor: rfq.target_price_cents, customisation: [], notes: null, productId: rfq.product_id ?? null }],
  };
}

export const customisationLabel = (c: string) => c.replace(/[_-]+/g, ' ').replace(/^\w/, (x) => x.toUpperCase());

/* ───────── quotes ───────── */

const QUOTE_NAMES: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Sent',
  approved: 'Accepted',
  rejected: 'Rejected',
  expired: 'Closed',
  superseded: 'Closed',
};
/** quotes.status → Appendix C words (Requests list + Approvals "Rejected"). viewed = still "Sent" (+ "viewed" detail). */
export const quoteStatusName = (raw: string) => QUOTE_NAMES[raw] ?? 'Sent';

/** One cell for the list: "No quotes" · "Accepted" · "2 sent" · "1 sent · viewed" · "Expired". */
export function quoteSummary(statuses: readonly string[]): { text: string; status: string | null } {
  if (!statuses.length) return { text: 'No quotes', status: null };
  if (statuses.includes('approved')) return { text: 'Accepted', status: 'Accepted' };
  const live = statuses.filter((s) => s === 'sent' || s === 'viewed');
  if (live.length) return { text: `${live.length} sent${statuses.includes('viewed') ? ' · viewed' : ''}`, status: 'Sent' };
  if (statuses.every((s) => s === 'rejected')) return { text: 'Rejected', status: 'Rejected' };
  if (statuses.every((s) => s === 'draft')) return { text: `${statuses.length} draft`, status: 'Draft' };
  return { text: 'Expired', status: 'Closed' };
}

/** Today's red age rule: older than 48 h, no quote yet, not accepted. */
export function ageInfo(createdAt: string, nowMs: number, quotes: number, raw: string): { text: string; late: boolean } {
  const h = Math.max(0, Math.round((nowMs - Date.parse(createdAt)) / 36e5));
  return { text: h < 48 ? `${h} h` : `${Math.round(h / 24)} d`, late: h > 48 && quotes === 0 && raw !== 'accepted' };
}

/* ───────── permissions ───────── */

export type RfqPerms = {
  /** requests:create — today's guard on sendQuote (actionSession('requests','create')) */
  canQuote: boolean;
  /** requests:edit — today's reply rule on the thread */
  canReply: boolean;
  /** suppliers:view — supplier names (RLS suppliers_staff) */
  canSeeSuppliers: boolean;
  /** customers:view — customer record link */
  canOpenCustomer: boolean;
};

type CanFn = (area: string, action?: string) => boolean;
export function rfqPerms(can: CanFn): RfqPerms {
  return {
    canQuote: can('requests', 'create'),
    canReply: can('requests', 'edit'),
    canSeeSuppliers: can('suppliers', 'view'),
    canOpenCustomer: can('customers', 'view'),
  };
}

/** What a quote row may show. Without suppliers:view nothing about the supplier is selected or sent to the browser. */
export function supplierCell(perms: Pick<RfqPerms, 'canSeeSuppliers'>, s: { code: string; legal_name: string; country: string } | null): { hidden: true } | { hidden: false; code: string; name: string; country: string } {
  if (!perms.canSeeSuppliers) return { hidden: true };
  return { hidden: false, code: s?.code ?? '—', name: s?.legal_name ?? '', country: s?.country ?? '' };
}

/** Quote drawer state: closed RFQ / no permission / no supplier options → a reason instead of the form (today's texts). */
export function quoteFormGate(raw: string, perms: Pick<RfqPerms, 'canQuote'>): { ok: true } | { ok: false; reason: string } {
  if (!acceptsQuotes(raw)) return { ok: false, reason: `This RFQ is ${raw.replace('_', ' ')} and no longer accepts quotes.` };
  if (!perms.canQuote) return { ok: false, reason: 'You don’t have permission to send quotes.' };
  return { ok: true };
}

export const RECORD_TABS = ['overview', 'lines', 'quotes', 'messages', 'files', 'timeline'] as const;
export type RecordTab = (typeof RECORD_TABS)[number];
export const isRecordTab = (v: unknown): v is RecordTab => typeof v === 'string' && (RECORD_TABS as readonly string[]).includes(v);

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '—';
}

export const currencyLabel = (code: string | null | undefined) => {
  const c = (code ?? 'USD').trim().toUpperCase() || 'USD';
  return c === 'USD' ? 'US$' : c;
};
