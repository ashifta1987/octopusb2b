/**
 * ODS T9 · Accounts part C (Credit notes · Ledger · Payments) — pure logic shared by the three read-only grids, their
 * server loaders, fixtures and unit tests (tests/unit/ods-office-accounts-c.test.ts). No server-only, no Supabase.
 */

// ───────────────────────── URL state (one shape for the three grids) ─────────────────────────

export type ListSort = { id: string; desc: boolean };
export type ListQuery = {
  tab: string;
  q: string;
  sort: ListSort;
  /** 0-based */
  page: number;
  size: 25 | 50 | 100;
  view: string | null;
  /** record shown in the drawer (?open=) */
  open: string | null;
  /** screen filters (?account= ?org= ?from= ?to= ?status= …), validated by the spec */
  f: Record<string, string>;
};

export type ListSpec = {
  tabs: readonly string[];
  /** url sort id → database column */
  sortable: Readonly<Record<string, string>>;
  defaultSort: ListSort;
  /** filter key → allowed value pattern */
  filters: Readonly<Record<string, RegExp>>;
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
export const ID_RE = /^[0-9a-zA-Z_-]{1,64}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseListQuery(sp: SP, spec: ListSpec): ListQuery {
  const tab = one(sp.tab);
  const sortRaw = one(sp.sort);
  const sortId = sortRaw.replace(/^-/, '');
  const size = Number(one(sp.size));
  const page = Number(one(sp.page));
  const f: Record<string, string> = {};
  for (const [k, re] of Object.entries(spec.filters)) {
    const v = one(sp[k]).trim();
    if (v && v.length <= 80 && re.test(v)) f[k] = v;
  }
  return {
    tab: spec.tabs.includes(tab) ? tab : spec.tabs[0],
    q: one(sp.q).slice(0, 80),
    sort: spec.sortable[sortId] ? { id: sortId, desc: sortRaw.startsWith('-') } : { ...spec.defaultSort },
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
    size: size === 50 || size === 100 ? size : 25,
    view: ID_RE.test(one(sp.view)) || one(sp.view).startsWith('builtin:') ? one(sp.view) || null : null,
    open: ID_RE.test(one(sp.open)) ? one(sp.open) : null,
    f,
  };
}

export function listQueryHref(base: string, q: ListQuery, spec: ListSpec, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (q.tab !== spec.tabs[0]) p.set('tab', q.tab);
  if (q.q) p.set('q', q.q);
  for (const k of Object.keys(spec.filters)) if (q.f[k]) p.set(k, q.f[k]);
  if (q.sort.id !== spec.defaultSort.id || q.sort.desc !== spec.defaultSort.desc) p.set('sort', `${q.sort.desc ? '-' : ''}${q.sort.id}`);
  if (q.page > 0) p.set('page', String(q.page + 1));
  if (q.size !== 25) p.set('size', String(q.size));
  if (q.view) p.set('view', q.view);
  if (q.open) p.set('open', q.open);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Saved view JSON (saved_views.filters) ↔ query. */
export function listViewFilters(q: ListQuery): Record<string, unknown> {
  return { tab: q.tab, q: q.q, sort: `${q.sort.desc ? '-' : ''}${q.sort.id}`, ...q.f };
}
export function listQueryFromView(filters: unknown, spec: ListSpec, viewId: string | null): ListQuery {
  const o = (filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {}) as Record<string, unknown>;
  const sp: SP = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string') sp[k] = v;
  return { ...parseListQuery(sp, spec), view: viewId };
}

/** Text safe inside a PostgREST or() / ilike pattern. */
export function safeSearch(q: string): string {
  return q.replace(/[,()*%\\"'.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** [from, to) ISO bounds for ?from=YYYY-MM-DD&to=YYYY-MM-DD (to is inclusive for the user → next day exclusive). */
export function dateBounds(from?: string, to?: string): { gte: string | null; lt: string | null } {
  const ok = (d?: string) => !!d && DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  const lt = ok(to) ? new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString() : null;
  return { gte: ok(from) ? new Date(`${from}T00:00:00Z`).toISOString() : null, lt };
}

/** Month (YYYY-MM) for today's finance export route: the From month when set, else the current month. */
export function exportMonth(from: string | undefined, nowMs: number): string {
  return from && DATE_RE.test(from) ? from.slice(0, 7) : new Date(nowMs).toISOString().slice(0, 7);
}

export const currencyPrefix = (c: string | null | undefined) => ({ USD: 'US$', CNY: 'CN¥', HKD: 'HK$' } as Record<string, string>)[(c ?? 'USD').trim()] ?? (c ?? 'USD').trim();

// ───────────────────────── statuses (Appendix C) ─────────────────────────

export type ApprovalName = 'Waiting' | 'Approved' | 'Rejected';
/** finance_approvals.status (approval_status: requested · approved · rejected · executed) → Appendix C approvals. */
export function approvalName(status: string | null | undefined): ApprovalName {
  if (status === 'rejected') return 'Rejected';
  if (status === 'approved' || status === 'executed') return 'Approved';
  return 'Waiting';
}
export const APPROVAL_DB: Record<'waiting' | 'rejected' | 'approved', string[]> = { waiting: ['requested'], approved: ['approved', 'executed'], rejected: ['rejected'] };

export type PaymentName = 'Pending' | 'Paid' | 'Held' | 'Released' | 'Refunded' | 'Failed';
/** payments.status (payment_status: initiated · pending · matched · confirmed · failed · refunded) → Appendix C payments. */
export function paymentName(status: string | null | undefined): PaymentName {
  if (status === 'confirmed') return 'Paid';
  if (status === 'failed') return 'Failed';
  if (status === 'refunded') return 'Refunded';
  return 'Pending';
}
export const PAYMENT_DB: Record<'pending' | 'paid' | 'failed' | 'refunded', string[]> = { pending: ['initiated', 'pending', 'matched'], paid: ['confirmed'], failed: ['failed'], refunded: ['refunded'] };

/** Credit note documents: void / cancelled → Cancelled, anything else → Credit note. */
export const creditNoteName = (status: string | null | undefined): 'Credit note' | 'Cancelled' => (status === 'void' || status === 'cancelled' ? 'Cancelled' : 'Credit note');

export const PURPOSE_LABEL: Record<string, string> = { deposit: 'Deposit', balance: 'Balance', topup: 'Wallet top-up', service: 'Service', other: 'Other' };
export const methodLabel = (m: string | null | undefined) => (m ? ({ bank_transfer: 'Bank transfer', card: 'Card', paypal: 'PayPal', wallet: 'Wallet', other: 'Other' } as Record<string, string>)[m] ?? m.replace(/_/g, ' ') : '—');

// ───────────────────────── ledger ─────────────────────────

export type AccountKind = 'asset' | 'liability' | 'revenue' | 'expense' | 'equity';
export const ACCOUNT_KINDS: readonly [string, string][] = [['all', 'All'], ['asset', 'Assets'], ['liability', 'Liabilities'], ['revenue', 'Revenue'], ['expense', 'Expenses'], ['equity', 'Equity']];

/** Normal side: assets / expenses grow with debits; liabilities / revenue / equity with credits. */
export const debitNormal = (kind: string | null | undefined) => kind === 'asset' || kind === 'expense';

/** Signed movement of one line for the account's balance (in its normal side). */
export const lineMovement = (kind: string | null | undefined, debit: number, credit: number) => (debitNormal(kind) ? debit - credit : credit - debit);

/**
 * Running balance per line for ONE account: lines in ledger order (created_at, id ascending), from the first entry
 * of the account. Returns id → balance after that line.
 */
export function runningBalances(kind: string | null | undefined, lines: readonly { id: string | number; debit: number; credit: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  let bal = 0;
  for (const l of lines) {
    bal += lineMovement(kind, l.debit, l.credit);
    out.set(String(l.id), bal);
  }
  return out;
}

/** Debits = credits per currency (every journal posted by post_journal balances). */
export function journalTotals(lines: readonly { debit: number; credit: number; currency: string }[]): { currency: string; debit: number; credit: number; balanced: boolean }[] {
  const by = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const t = by.get(l.currency) ?? { debit: 0, credit: 0 };
    t.debit += l.debit;
    t.credit += l.credit;
    by.set(l.currency, t);
  }
  return [...by].map(([currency, t]) => ({ currency, ...t, balanced: t.debit === t.credit }));
}

/** Readable account label: org-specific accounts (ar:<org>, wallet:<org>, hold:<org>) get the customer's name. */
export function accountLabel(code: string, name: string | null | undefined, orgName?: string | null): string {
  const base = code.split(':')[0];
  const known: Record<string, string> = { ar: 'Receivable', wallet: 'Wallet', hold: 'Held' };
  if (orgName && known[base]) return `${known[base]} · ${orgName}${/:[A-Z]{3}$/.test(code) ? ` (${code.slice(-3)})` : ''}`;
  return name && name !== code ? `${code} · ${name}` : code;
}

/** Where a journal's reference opens (today's pages). */
export function refHref(refType: string | null | undefined, refId: string | null | undefined): string | null {
  if (!refType || !refId) return null;
  if (refType === 'order') return `/office/orders/${refId}`;
  if (refType === 'document') return `/office/accounts/invoices?open=${refId}`;
  if (refType === 'payment') return `/office/accounts/payments?open=${refId}`;
  return null;
}

// ───────────────────────── rows ─────────────────────────

export type CreditNoteRow = {
  kind: 'document';
  id: string;
  number: string;
  customer: string;
  originalId: string | null;
  originalNumber: string | null;
  orderId: string | null;
  orderCode: string | null;
  issuedAt: string;
  amountMinor: number;
  currency: string;
  status: 'Credit note' | 'Cancelled';
  reason: string | null;
};
export type CreditRequestRow = {
  kind: 'request';
  id: string;
  number: string;
  customer: string;
  orderId: string | null;
  orderCode: string | null;
  requestedAt: string;
  decidedAt: string | null;
  amountMinor: number;
  currency: string;
  status: ApprovalName;
  reason: string;
  requestedBy: string | null;
  approvedBy: string | null;
  journalId: string | null;
};
export type CreditRow = CreditNoteRow | CreditRequestRow;

/** Request "number" for people: FA- + first 8 of the id (credit notes from it are CN- + the same 8, decide_finance_approval). */
export const requestNumber = (id: string) => `FA-${id.slice(0, 8).toUpperCase()}`;

export type LedgerRow = {
  id: string;
  at: string;
  journalId: string;
  journalNumber: string;
  accountId: string;
  accountCode: string;
  accountLabel: string;
  accountKind: string;
  customer: string | null;
  memo: string;
  debitMinor: number;
  creditMinor: number;
  currency: string;
  /** account balance after this line (only when one account is chosen) */
  balanceMinor: number | null;
  refType: string | null;
  refId: string | null;
};

export type PaymentRow = {
  source: 'payment' | 'document_payment';
  id: string;
  at: string;
  customer: string;
  purpose: string;
  method: string;
  reference: string | null;
  orderId: string | null;
  orderCode: string | null;
  /** invoice / proforma the payment belongs to (opens the Invoices drawer) */
  documentId: string | null;
  documentNumber: string | null;
  /** tax invoice issued from a proforma payment */
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentName;
  journalId: string | null;
};

export type JournalLine = { id: string; account: string; customer: string | null; debitMinor: number; creditMinor: number; currency: string; memo: string | null };
export type JournalView = { id: string; number: string; at: string; memo: string; stream: string | null; refType: string | null; refId: string | null; lines: JournalLine[] };

export type ListResult<T> =
  | { kind: 'ok'; rows: T[]; total: number; counts: Partial<Record<string, number>>; updatedAt: string; note?: string }
  | { kind: 'error'; error: string }
  | { kind: 'loading' }
  | { kind: 'forbidden' };

/** Specs (URL state) for the three grids. */
export const CREDIT_SPEC: ListSpec = {
  tabs: ['issued', 'waiting', 'approved', 'rejected'],
  sortable: { date: 'created_at', amount: 'amount_cents', number: 'number' },
  defaultSort: { id: 'date', desc: true },
  filters: { from: DATE_RE, to: DATE_RE, customer: /^[^<>]{1,80}$/ },
};
export const LEDGER_SPEC: ListSpec = {
  tabs: ACCOUNT_KINDS.map(([k]) => k),
  sortable: { date: 'created_at', debit: 'debit_cents', credit: 'credit_cents' },
  defaultSort: { id: 'date', desc: true },
  filters: { account: /^[0-9a-f-]{36}$/i, from: DATE_RE, to: DATE_RE, customer: /^[^<>]{1,80}$/ },
};
export const PAYMENTS_SPEC: ListSpec = {
  tabs: ['payments', 'proformas'],
  sortable: { date: 'created_at', amount: 'amount_cents' },
  defaultSort: { id: 'date', desc: true },
  filters: { status: /^(pending|paid|failed|refunded)$/, purpose: /^(deposit|balance|topup|service|other)$/, from: DATE_RE, to: DATE_RE, customer: /^[^<>]{1,80}$/ },
};

/** Chips for the common filters (Part 7.2). */
export function commonChips(q: ListQuery, labels: Record<string, (v: string) => string> = {}): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const [k, v] of Object.entries(q.f)) {
    const fn = labels[k];
    if (fn) out.push({ id: k, label: fn(v) });
    else if (k === 'from') out.push({ id: k, label: `From ${v}` });
    else if (k === 'to') out.push({ id: k, label: `To ${v}` });
    else if (k === 'customer') out.push({ id: k, label: `Customer: ${v}` });
  }
  return out;
}

/** Advanced filter conditions → filters (supported: field is / contains value; dates as YYYY-MM-DD with is after / is before). */
export function applyListConditions(q: ListQuery, spec: ListSpec, conditions: { field: string; operator: string; value: string }[], valueMap: Record<string, Record<string, string>> = {}): ListQuery {
  const f = { ...q.f };
  for (const c of conditions) {
    const raw = c.value.trim();
    if (!raw || c.operator === 'is not') continue;
    if (c.field === 'date') {
      if (!DATE_RE.test(raw)) continue;
      if (c.operator === 'is before') f.to = raw;
      else if (c.operator === 'is after') f.from = raw;
      else {
        f.from = raw;
        f.to = raw;
      }
      continue;
    }
    const v = valueMap[c.field]?.[raw] ?? raw;
    const re = spec.filters[c.field];
    if (re && re.test(v)) f[c.field] = v;
  }
  return { ...q, f, page: 0, view: null };
}
