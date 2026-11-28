/**
 * ODS T9 · Back Office › Accounts › Invoices — pure logic (no server-only, no Supabase; unit tested in
 * tests/unit/ods-office-invoices.test.ts). Used by the server loader, the server action, the client screen and the
 * staging fixture, so the status words, tab filters and the two-person order are the same everywhere.
 *
 * WHAT AN "INVOICE" IS TODAY: a `documents` row with doc_type proforma_invoice (PF-/PI-), commercial_invoice (OCT- tax
 * invoice) or credit_note (CN-). Receipts, statements, POs, remittances and QC reports are not listed here.
 *
 * STATUS MAPPING (documents.status + doc_type + paid_cents + due_at → Appendix C invoice names):
 *   credit_note (any status)                         → Credit note
 *   draft                                            → Draft
 *   paid                                             → Paid
 *   invoiced  (proforma replaced by its tax invoice) → Paid, except payment_option = pay_later → Cancelled (the debt moved
 *                                                      to the Pay-later tax invoice, migration 208/209)
 *   void · cancelled · superseded                    → Cancelled
 *   any other status (issued · awaiting_payment · sent · part_paid …) = OPEN:
 *       due_at before now                            → Overdue
 *       part_paid or paid_cents > 0                  → Partly paid
 *       otherwise                                    → Sent
 * The tab filters below (`tabFilter`) express exactly these rules as PostgREST filters for server-side filtering.
 */

// ───────────────────────── statuses ─────────────────────────

export type InvoiceStatusName = 'Draft' | 'Sent' | 'Partly paid' | 'Overdue' | 'Paid' | 'Cancelled' | 'Credit note';

export const INVOICE_DOC_TYPES = ['proforma_invoice', 'commercial_invoice', 'credit_note'] as const;
export type InvoiceDocType = (typeof INVOICE_DOC_TYPES)[number];

/** Statuses that are NOT open (everything else that isn't a credit note is open: waiting for money). */
export const CLOSED_STATUSES = ['draft', 'paid', 'invoiced', 'void', 'cancelled', 'superseded'] as const;

export type DocStatusInput = {
  doc_type: string;
  status: string | null | undefined;
  paid_cents?: number | null;
  due_at?: string | null;
  payment_option?: string | null;
};

export function isOpenStatus(status: string | null | undefined): boolean {
  return !(CLOSED_STATUSES as readonly string[]).includes(status ?? 'issued');
}

export function invoiceStatus(d: DocStatusInput, nowMs: number): InvoiceStatusName {
  if (d.doc_type === 'credit_note') return 'Credit note';
  const s = d.status ?? 'issued';
  if (s === 'draft') return 'Draft';
  if (s === 'paid') return 'Paid';
  if (s === 'invoiced') return d.payment_option === 'pay_later' ? 'Cancelled' : 'Paid';
  if (s === 'void' || s === 'cancelled' || s === 'superseded') return 'Cancelled';
  if (d.due_at && Date.parse(d.due_at) < nowMs) return 'Overdue';
  if (s === 'part_paid' || Number(d.paid_cents ?? 0) > 0) return 'Partly paid';
  return 'Sent';
}

/** Days past the due date (0 when not due yet or no due date). Whole days, like today's receivables page. */
export function daysOverdue(dueAt: string | null | undefined, nowMs: number): number {
  if (!dueAt) return 0;
  const d = Math.floor((nowMs - Date.parse(dueAt)) / 86_400_000);
  return d > 0 ? d : 0;
}

/** Today's ageing buckets (Admin › Finance › Receivables): current, 1–30, 31–60, 61–90, 90+. */
export type AgeingBucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
export function ageingBucket(dueAt: string | null | undefined, nowMs: number): AgeingBucket {
  const d = daysOverdue(dueAt, nowMs);
  if (d > 90) return '90_plus';
  if (d > 60) return '61_90';
  if (d > 30) return '31_60';
  if (d > 0) return '1_30';
  return 'current';
}

/** Due within the next `days` days (not overdue yet). */
export function dueWithin(dueAt: string | null | undefined, nowMs: number, days = 7): boolean {
  if (!dueAt) return false;
  const t = Date.parse(dueAt);
  return t >= nowMs && t <= nowMs + days * 86_400_000;
}

/** Figures shown in the grid: Paid shows the full amount once paid (order documents are marked paid without paid_cents). */
export function invoiceFigures(amountMinor: number, paidMinor: number, status: InvoiceStatusName): { paid: number | null; balance: number } {
  if (status === 'Credit note') return { paid: null, balance: -Math.abs(amountMinor) };
  if (status === 'Paid') return { paid: Math.max(paidMinor, amountMinor), balance: 0 };
  if (status === 'Cancelled') return { paid: paidMinor, balance: 0 };
  return { paid: paidMinor, balance: Math.max(0, amountMinor - paidMinor) };
}

// ───────────────────────── tabs ─────────────────────────

export type InvoiceTab = 'all' | 'draft' | 'sent' | 'partly' | 'overdue' | 'paid' | 'credit';
export const INVOICE_TABS: readonly [InvoiceTab, string][] = [
  ['all', 'All'],
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['partly', 'Partly paid'],
  ['overdue', 'Overdue'],
  ['paid', 'Paid'],
  ['credit', 'Credit notes'],
];

const TAB_STATUS: Record<Exclude<InvoiceTab, 'all'>, InvoiceStatusName> = {
  draft: 'Draft',
  sent: 'Sent',
  partly: 'Partly paid',
  overdue: 'Overdue',
  paid: 'Paid',
  credit: 'Credit note',
};

export function matchesTab(status: InvoiceStatusName, tab: InvoiceTab): boolean {
  return tab === 'all' || TAB_STATUS[tab] === status;
}

/** One PostgREST filter step (applied in order by the server loader). */
export type TabFilterStep =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt'; col: string; val: string | number }
  | { op: 'notIn'; col: string; vals: readonly string[] }
  | { op: 'in'; col: string; vals: readonly string[] }
  | { op: 'or'; expr: string };

/** Server-side filter for a tab — the SAME rules as `invoiceStatus` (asserted by the unit tests). */
export function tabFilter(tab: InvoiceTab, nowIso: string): TabFilterStep[] {
  const notCredit: TabFilterStep = { op: 'neq', col: 'doc_type', val: 'credit_note' };
  const open: TabFilterStep = { op: 'notIn', col: 'status', vals: CLOSED_STATUSES };
  const notDue: TabFilterStep = { op: 'or', expr: `due_at.is.null,due_at.gte.${nowIso}` };
  switch (tab) {
    case 'draft':
      return [notCredit, { op: 'eq', col: 'status', val: 'draft' }];
    case 'sent':
      return [notCredit, open, notDue, { op: 'neq', col: 'status', val: 'part_paid' }, { op: 'eq', col: 'paid_cents', val: 0 }];
    case 'partly':
      return [notCredit, open, notDue, { op: 'or', expr: 'status.eq.part_paid,paid_cents.gt.0' }];
    case 'overdue':
      return [notCredit, open, { op: 'lt', col: 'due_at', val: nowIso }];
    case 'paid':
      return [notCredit, { op: 'or', expr: 'status.eq.paid,and(status.eq.invoiced,or(payment_option.is.null,payment_option.neq.pay_later))' }];
    case 'credit':
      return [{ op: 'eq', col: 'doc_type', val: 'credit_note' }];
    default:
      return [];
  }
}

// ───────────────────────── services ─────────────────────────

/** Division code → the service word used across the app (Part 1 names). */
export const SERVICE_BY_DIVISION: Record<string, string> = {
  SRC: 'Sourcing',
  DS: 'Dropshipping',
  MMB: 'Make My Brand',
  POOL: 'MOQ pool',
  TK: 'Turnkey',
  '3PL': 'Warehouse (3PL)',
};
const SERVICE_BY_DATA: Record<string, string> = {
  sourcing: 'Sourcing', dropship: 'Dropshipping', warehouse: 'Warehouse (3PL)', brand: 'Make My Brand', turnkey: 'Turnkey', pools: 'MOQ pool', saas: 'SaaS plan', advertising: 'Advertising',
};
export function serviceLabel(divisionCode: string | null | undefined, dataService?: string | null, docType?: string): string {
  if (docType === 'credit_note') return 'Credit note';
  if (divisionCode && SERVICE_BY_DIVISION[divisionCode]) return SERVICE_BY_DIVISION[divisionCode];
  if (dataService) return SERVICE_BY_DATA[dataService] ?? dataService;
  return '—';
}

// ───────────────────────── URL state ─────────────────────────

export type IssuedRange = 'month' | 'quarter' | 'year';
export const ISSUED_RANGES: readonly [IssuedRange, string][] = [['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year']];
export const SORTABLE: Record<string, string> = { number: 'number', issued: 'created_at', due: 'due_at', amount: 'amount_cents', paid: 'paid_cents', status: 'status' };
export const PAGE_SIZES = [25, 50, 100] as const;

export type InvoiceQuery = {
  tab: InvoiceTab;
  q: string;
  service: string | null;
  customer: string;
  issued: IssuedRange | null;
  sort: { id: string; desc: boolean };
  /** 0-based */
  page: number;
  size: (typeof PAGE_SIZES)[number];
  view: string | null;
  open: string | null;
};

export const DEFAULT_SORT = { id: 'issued', desc: true } as const;
export const DEFAULT_QUERY: InvoiceQuery = { tab: 'all', q: '', service: null, customer: '', issued: null, sort: { ...DEFAULT_SORT }, page: 0, size: 25, view: null, open: null };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function parseInvoiceQuery(sp: SP): InvoiceQuery {
  const tab = one(sp.status) as InvoiceTab;
  const sortRaw = one(sp.sort);
  const sortId = sortRaw.replace(/^-/, '');
  const size = Number(one(sp.size));
  const page = Number(one(sp.page));
  const issued = one(sp.issued) as IssuedRange;
  const service = one(sp.service).toUpperCase();
  return {
    tab: INVOICE_TABS.some(([t]) => t === tab) ? tab : 'all',
    q: one(sp.q).slice(0, 80),
    service: SERVICE_BY_DIVISION[service] ? service : null,
    customer: one(sp.customer).slice(0, 80),
    issued: ISSUED_RANGES.some(([r]) => r === issued) ? issued : null,
    sort: SORTABLE[sortId] ? { id: sortId, desc: sortRaw.startsWith('-') } : { ...DEFAULT_SORT },
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? (size as InvoiceQuery['size']) : 25,
    view: one(sp.view) || null,
    open: /^[0-9a-zA-Z_-]{1,64}$/.test(one(sp.open)) ? one(sp.open) : null,
  };
}

/** Query → search params (defaults left out). `extra` keeps fixture params such as ?state=. */
export function invoiceQueryParams(q: InvoiceQuery, extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams(extra);
  if (q.tab !== 'all') p.set('status', q.tab);
  if (q.q) p.set('q', q.q);
  if (q.service) p.set('service', q.service);
  if (q.customer) p.set('customer', q.customer);
  if (q.issued) p.set('issued', q.issued);
  if (q.sort.id !== DEFAULT_SORT.id || q.sort.desc !== DEFAULT_SORT.desc) p.set('sort', `${q.sort.desc ? '-' : ''}${q.sort.id}`);
  if (q.page > 0) p.set('page', String(q.page + 1));
  if (q.size !== 25) p.set('size', String(q.size));
  if (q.view) p.set('view', q.view);
  if (q.open) p.set('open', q.open);
  return p;
}
export function invoiceQueryHref(base: string, q: InvoiceQuery, extra: Record<string, string> = {}): string {
  const s = invoiceQueryParams(q, extra).toString();
  return s ? `${base}?${s}` : base;
}

/** Search text safe inside a PostgREST or() / ilike pattern (no commas, brackets, wildcards or quotes). */
export function safeSearch(q: string): string {
  return q.replace(/[,()*%\\"'.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Start of the issued range (UTC). */
export function issuedFrom(r: IssuedRange, nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = r === 'year' ? Date.UTC(y, 0, 1) : r === 'quarter' ? Date.UTC(y, m - (m % 3), 1) : Date.UTC(y, m, 1);
  return new Date(start).toISOString();
}

/** Active filter chips (Part 7.2) for the query. */
export function filterChips(q: InvoiceQuery): { id: 'q' | 'service' | 'customer' | 'issued'; label: string }[] {
  const chips: { id: 'q' | 'service' | 'customer' | 'issued'; label: string }[] = [];
  if (q.service) chips.push({ id: 'service', label: `Service: ${SERVICE_BY_DIVISION[q.service]}` });
  if (q.customer) chips.push({ id: 'customer', label: `Customer: ${q.customer}` });
  if (q.issued) chips.push({ id: 'issued', label: `Issued: ${ISSUED_RANGES.find(([r]) => r === q.issued)?.[1].toLowerCase()}` });
  return chips;
}

/** Advanced filter panel conditions → query. Supported: Service is …, Issued is …, Customer is / contains …. */
export function applyConditions(q: InvoiceQuery, conditions: { field: string; operator: string; value: string }[]): InvoiceQuery {
  const next: InvoiceQuery = { ...q, page: 0, view: null };
  for (const c of conditions) {
    const v = c.value.trim();
    if (!v || c.operator === 'is not') continue;
    if (c.field === 'service') {
      const code = Object.entries(SERVICE_BY_DIVISION).find(([, label]) => label === v)?.[0];
      if (code) next.service = code;
    } else if (c.field === 'issued') {
      const r = ISSUED_RANGES.find(([, label]) => label === v)?.[0];
      if (r) next.issued = r;
    } else if (c.field === 'customer') {
      next.customer = v.slice(0, 80);
    }
  }
  return next;
}

/** Saved view filters (saved_views.filters JSON) ↔ query. */
export function viewFilters(q: InvoiceQuery): Record<string, unknown> {
  return { status: q.tab, q: q.q, service: q.service, customer: q.customer, issued: q.issued, sort: `${q.sort.desc ? '-' : ''}${q.sort.id}` };
}
export function queryFromView(filters: unknown, viewId: string): InvoiceQuery {
  const f = (filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : undefined);
  return { ...parseInvoiceQuery({ status: s('status'), q: s('q'), service: s('service'), customer: s('customer'), issued: s('issued'), sort: s('sort') }), view: viewId };
}

/** Built-in views (always there, also when saved views are not switched on). */
export const BUILTIN_VIEWS: { id: string; label: string; filters: Record<string, unknown> }[] = [
  { id: 'builtin:all', label: 'All invoices', filters: {} },
  { id: 'builtin:to-chase', label: 'Finance · to chase', filters: { status: 'overdue', sort: 'due' } },
];
/** Saved views page key (lib/office/views viewPageKey requires a path; 'office.invoices' would fall back to '/office'). */
export const VIEWS_PAGE = '/office/accounts/invoices';

// ───────────────────────── rows ─────────────────────────

export type PayTarget = 'order' | 'proforma';

export type InvoiceRow = {
  id: string;
  number: string;
  docType: string;
  customer: string;
  orgId: string | null;
  service: string;
  issuedAt: string;
  dueAt: string | null;
  amountMinor: number;
  paidMinor: number | null;
  balanceMinor: number;
  currency: string;
  status: InvoiceStatusName;
  daysOverdue: number;
  owner: { initials: string; name: string } | null;
  orderId: string | null;
  orderCode: string | null;
  /** order total − paid (record_payment works on the order) */
  orderOutstandingMinor: number | null;
  payTarget: PayTarget | null;
  /** why Record payment is not offered for this row */
  payBlockedReason: string | null;
  paymentOption: string | null;
  lastReminder: string | null;
  emailedAt: string | null;
};

export const PAY_REASON_NOT_STAFF =
  'There is no staff record-payment step for this invoice today: the customer pays it from the wallet, card or Pay later.';

/**
 * Which of TODAY's record-payment actions applies (never a new money path):
 *  - linked to an order → record_payment on the order (Back Office › Orders › Record bank payment, recordPaymentStepUp);
 *  - service proforma (PF-/PI-, no order) → pay_service_proforma by bank transfer (Admin › Finance › Transfers,
 *    recordProformaTransfer);
 *  - anything else → not offered (reason shown).
 */
export function paymentTarget(d: {
  docType: string;
  number: string;
  status: InvoiceStatusName;
  orderId: string | null;
  orderOutstandingMinor: number | null;
}): { target: PayTarget | null; reason: string | null } {
  if (d.status === 'Credit note') return { target: null, reason: 'Credit notes are not paid here.' };
  if (d.status === 'Paid') return { target: null, reason: 'This invoice is paid.' };
  if (d.status === 'Cancelled') return { target: null, reason: 'This invoice is cancelled or replaced.' };
  if (d.status === 'Draft') return { target: null, reason: 'Draft invoices are not sent yet.' };
  if (d.orderId) {
    if ((d.orderOutstandingMinor ?? 0) <= 0) return { target: null, reason: 'The order is fully paid.' };
    return { target: 'order', reason: null };
  }
  if (d.docType === 'proforma_invoice' && /^(PF|PI)-[\w-]+$/i.test(d.number)) return { target: 'proforma', reason: null };
  return { target: null, reason: PAY_REASON_NOT_STAFF };
}

/** What can be recorded at most (minor units): the order's outstanding amount, or what is left on the proforma. */
export function payableMinor(r: Pick<InvoiceRow, 'payTarget' | 'orderOutstandingMinor' | 'balanceMinor'>): number {
  if (r.payTarget === 'order') return Math.max(0, r.orderOutstandingMinor ?? 0);
  if (r.payTarget === 'proforma') return Math.max(0, r.balanceMinor);
  return 0;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Client / fixture filtering with the same rules the server applies (status tab, search, service, customer, issued, sort, page). */
export function queryRows(rows: readonly InvoiceRow[], q: InvoiceQuery, nowMs: number, serviceOf: (r: InvoiceRow) => string | null = () => null): { rows: InvoiceRow[]; total: number } {
  const text = q.q.trim().toLowerCase();
  const cust = q.customer.trim().toLowerCase();
  const from = q.issued ? Date.parse(issuedFrom(q.issued, nowMs)) : null;
  let r = rows.filter(
    (x) =>
      matchesTab(x.status, q.tab) &&
      (!text || x.number.toLowerCase().includes(text) || x.customer.toLowerCase().includes(text)) &&
      (!cust || x.customer.toLowerCase().includes(cust)) &&
      (!q.service || serviceOf(x) === q.service) &&
      (from === null || Date.parse(x.issuedAt) >= from),
  );
  const key: Record<string, (x: InvoiceRow) => string | number | null> = {
    number: (x) => x.number,
    issued: (x) => x.issuedAt,
    due: (x) => x.dueAt,
    amount: (x) => x.amountMinor,
    paid: (x) => x.paidMinor,
    status: (x) => x.status,
  };
  const get = key[q.sort.id] ?? key.issued;
  r = [...r].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'en', { numeric: true });
    return q.sort.desc ? -c : c;
  });
  return { rows: r.slice(q.page * q.size, q.page * q.size + q.size), total: r.length };
}

export function tabCounts(rows: readonly InvoiceRow[]): Record<InvoiceTab, number> {
  return Object.fromEntries(INVOICE_TABS.map(([t]) => [t, rows.filter((r) => matchesTab(r.status, t)).length])) as Record<InvoiceTab, number>;
}

// ───────────────────────── KPIs ─────────────────────────

export type KpiFigure = { minor: number; count: number; note?: string } | { error: string };
export type InvoiceKpis = { receivables: KpiFigure; overdue: KpiFigure & { oldestDays?: number }; due7: KpiFigure; paidMonth: KpiFigure; held: KpiFigure };

/** Receivables / Overdue / Due in 7 days from today's receivables rows (commercial invoices not paid / void / cancelled). */
export function receivableKpis(docs: { amount_cents: number | null; paid_cents: number | null; due_at: string | null; currency: string | null }[], nowMs: number) {
  const usd = docs.filter((d) => (d.currency ?? 'USD').trim() === 'USD');
  const other = docs.length - usd.length;
  const open = usd.map((d) => ({ bal: Math.max(0, Number(d.amount_cents ?? 0) - Number(d.paid_cents ?? 0)), due: d.due_at })).filter((d) => d.bal > 0);
  const over = open.filter((d) => daysOverdue(d.due, nowMs) > 0);
  const soon = open.filter((d) => dueWithin(d.due, nowMs, 7));
  const sum = (a: { bal: number }[]) => a.reduce((s, d) => s + d.bal, 0);
  const note = other ? `${other} in other currencies not included` : undefined;
  return {
    receivables: { minor: sum(open), count: open.length, note },
    overdue: { minor: sum(over), count: over.length, oldestDays: over.reduce((m, d) => Math.max(m, daysOverdue(d.due, nowMs)), 0), note },
    due7: { minor: sum(soon), count: soon.length, note },
  };
}

export type InvoiceListData = {
  rows: InvoiceRow[];
  total: number;
  counts: Partial<Record<InvoiceTab, number>>;
  kpis: InvoiceKpis;
  allUsd: boolean;
  updatedAt: string;
};
export type InvoiceListResult = { ok: true; data: InvoiceListData } | { ok: false; error: string; kpis: InvoiceKpis | null };

// ───────────────────────── record payment: two-person order (Part 7.7, T8-DATA) ─────────────────────────

/** Minimal OfficeResult shape (lib/office/workspace-core) so this file stays dependency-free. */
export type GateResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; redirect?: string; unavailable?: true };
export type ExecResult = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

export type PaymentOutcome =
  | { kind: 'saved'; message: string; approvalCode?: string | null; warning?: string }
  | { kind: 'second-approver'; code: string; message: string }
  | { kind: 'step-up'; redirect: string; message: string }
  | { kind: 'error'; message: string };

export type TwoPersonDeps = {
  /** staffApprovalReady: an approved, unused approval covering this payment? */
  ready: () => Promise<GateResult<string | null>>;
  /** requestStaffApproval: above the limit → a waiting approval (required) */
  request: () => Promise<GateResult<{ required: boolean; id?: string; code?: string }>>;
  /** TODAY's record-payment action, unchanged */
  execute: () => Promise<ExecResult>;
  /** markStaffApprovalExecuted */
  markExecuted: (id: string) => Promise<GateResult<null>>;
  /** journal of the steps taken (tests) */
  log?: (step: 'ready' | 'request' | 'execute' | 'mark') => void;
};

const gateFail = (r: { error: string; redirect?: string }): PaymentOutcome =>
  r.redirect ? { kind: 'step-up', redirect: r.redirect, message: r.error } : { kind: 'error', message: r.error };

/**
 * The T8-DATA order for a staff money action:
 *   1. staffApprovalReady — an approval a DIFFERENT Finance user already approved for this payment → use it;
 *   2. otherwise requestStaffApproval — at / under the limit nothing is recorded (go on); above it a waiting approval is
 *      created (or the same one returned) → "Second approver needed (APR-n)" and STOP (today's action is NOT called);
 *   3. TODAY's record-payment action, unchanged (its own permission check + 2FA step-up);
 *   4. markStaffApprovalExecuted — only after the money action succeeded, only when an approval was used.
 * When the approvals tables are not switched on yet (migration 255 not applied → `unavailable`), steps 1, 2 and 4 are
 * skipped and today's flow runs exactly as on today's screens. Step 1 runs first because asking again after an approval
 * would open a NEW waiting request (staff_approval_request only reuses WAITING rows).
 */
export async function runTwoPersonPayment(deps: TwoPersonDeps): Promise<PaymentOutcome> {
  const log = deps.log ?? (() => {});
  let approvalId: string | null = null;
  let approvalCode: string | null = null;
  let gatesOn = true;

  log('ready');
  const ready = await deps.ready();
  if (!ready.ok) {
    if (ready.unavailable) gatesOn = false;
    else return gateFail(ready);
  } else if (ready.data) {
    approvalId = ready.data;
  }

  if (gatesOn && !approvalId) {
    log('request');
    const req = await deps.request();
    if (!req.ok) {
      if (req.unavailable) gatesOn = false;
      else return gateFail(req);
    } else if (req.data.required) {
      approvalCode = req.data.code ?? 'APR';
      return {
        kind: 'second-approver',
        code: approvalCode,
        message: `Second approver needed (${approvalCode}). A different Finance user must approve it in Approvals; then save this payment again.`,
      };
    }
  }

  log('execute');
  const res = await deps.execute();
  if (!res.ok) return res.redirect ? { kind: 'step-up', redirect: res.redirect, message: res.error } : { kind: 'error', message: res.error };

  if (approvalId) {
    log('mark');
    const m = await deps.markExecuted(approvalId);
    if (!m.ok) {
      return { kind: 'saved', message: res.message ?? 'Payment recorded', warning: `The payment is recorded, but its approval could not be marked as used: ${m.error}` };
    }
  }
  return { kind: 'saved', message: res.message ?? 'Payment recorded', approvalCode };
}

/** Amount text → minor units the way the target action parses it (record_payment: toCents; proforma: ×100 without commas). */
export function amountToMinor(raw: string): number {
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Form checks before anything is recorded (the RPCs check again). */
export function validatePayment(input: { amount: string; reference: string; method: string }, maxMinor: number, target: PayTarget): { amount?: string; reference?: string; method?: string } {
  const e: { amount?: string; reference?: string; method?: string } = {};
  const m = amountToMinor(input.amount);
  if (!input.amount.trim() || !Number.isFinite(m) || m <= 0) e.amount = 'Enter the amount received.';
  else if (m > maxMinor) e.amount = 'This is more than the balance due.';
  const ref = input.reference.trim();
  if (ref.length < 3) e.reference = 'Enter the bank reference (3 characters or more).';
  else if (ref.length > 80) e.reference = 'Use 80 characters or fewer.';
  const methods = target === 'proforma' ? ['bank_transfer'] : ['bank_transfer', 'card', 'other'];
  if (!methods.includes(input.method)) e.method = 'Choose a method.';
  return e;
}

/** "Payments over US$ 2,500 need a second approver" text for a limit in USD cents (null = not switched on). */
export function secondApproverNote(limitMinor: number | null): string | null {
  if (limitMinor === null) return null;
  if (limitMinor <= 0) return 'Every payment needs a second approver.';
  const v = new Intl.NumberFormat('en-US', { minimumFractionDigits: limitMinor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(limitMinor / 100);
  return `Payments over US$ ${v} need a second approver.`;
}
