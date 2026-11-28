/**
 * ODS T9 · Customer record + Customers list — pure mapping (server + client + unit tests). No I/O.
 *
 * API (stable):
 *  - `companyStatusName({ kycStatus, archivedAt })` → Appendix C "Company": Not verified · Verification pending · Verified · Paused
 *  - `customerPerms(session, managerId)`             → every permission check today's customer pages make, as booleans
 *  - `panelVisibility(perms)`                         → which panels / tabs / actions this staff member sees
 *  - `invoiceStatusName(row, nowIso)`                 → Appendix C "Invoices" name for a documents row
 *  - `moneySummary(input, nowIso)`                    → the Money panel figures (wallet, held, due, paid 12 months, last payment)
 *  - `orderStatusName` / `requestStatusName`          → re-used from the ODS account mapping (Appendix C)
 *  - `orderServiceLabel(code, poolId)`                → service name from today's order code prefix
 *  - `openItems(input, perms)`                        → the Open items pills (status + ref + link)
 *  - `initials(name)`, `currencyLabel(code)`, `centsToAmount(cents)`, `memberRoleLabel(role)`, `isSupplierDocType(t)`
 */
import { orderStatusName, requestStatusName, OPEN_REQUEST_STATUSES } from '@/app/ods/account/_lib/status';
import { formatDate, formatMoney } from '@octopus/ui/format';

export { orderStatusName, requestStatusName, OPEN_REQUEST_STATUSES };

/* ───────── Company status (Appendix C) ───────── */

export type CompanyStatusName = 'Not verified' | 'Verification pending' | 'Verified' | 'Paused';

/**
 * organizations.kyc_status (+ archived_at) → Appendix C company status.
 * verified → Verified; submitted / in_review / more_info → Verification pending; not_started / rejected → Not verified.
 * An archived organisation (archived_at set; today's list hides it) shows Paused.
 */
export function companyStatusName(input: { kycStatus: string | null | undefined; archivedAt?: string | null }): CompanyStatusName {
  if (input.archivedAt) return 'Paused';
  const k = input.kycStatus ?? '';
  if (k === 'verified') return 'Verified';
  if (k === 'submitted' || k === 'in_review' || k === 'more_info') return 'Verification pending';
  return 'Not verified';
}

/** Today's KYC filter values on /admin/customers (unchanged) with their labels. */
export const KYC_FILTERS = [
  ['all', 'All'],
  ['verified', 'Verified'],
  ['in_review', 'In review'],
  ['submitted', 'Submitted'],
  ['more_info', 'More info'],
  ['rejected', 'Rejected'],
  ['not_started', 'Not started'],
] as const;
export type KycFilter = (typeof KYC_FILTERS)[number][0];
export const isKycFilter = (v: string | undefined | null): v is KycFilter => KYC_FILTERS.some(([k]) => k === v);

/* ───────── Permissions (same checks as today's pages) ───────── */

export type SessionLike = { userId: string; isAdmin: boolean; roles: readonly string[]; permissions: ReadonlySet<string> | readonly string[] };

/** Same rule as lib/auth.ts can(): admin, or the "area:action" permission. */
export function canIn(s: SessionLike, area: string, action = 'view'): boolean {
  if (s.isAdmin) return true;
  const key = `${area}:${action}`;
  return Array.isArray(s.permissions) ? s.permissions.includes(key) : (s.permissions as ReadonlySet<string>).has(key);
}

export type CustomerPerms = {
  isAdmin: boolean;
  /** customers:view (account managers get in without it; RLS shows only their own customers). */
  customersView: boolean;
  /** The signed-in staff member is this customer's account manager. */
  isMine: boolean;
  isAccountManager: boolean;
  orders: boolean;
  requests: boolean;
  support: boolean;
  assistant: boolean;
  finance: boolean;
  wallet: boolean;
  audit: boolean;
  /** Supplier names / supplier documents: admin, suppliers:view or finance:view (today's /office/orders/[id] rule). */
  suppliers: boolean;
  /** Account manager (re)assignment: admin or assistant:reassign (today's reassignAccountManager). */
  reassign: boolean;
  /** Services + selling countries: customers:edit or the customer's own account manager (today's CustomerOneApp). */
  services: boolean;
  /** Customer limits: admin or the customer's own account manager (today's CustomerOneApp). */
  limits: boolean;
  /** VIP flag and Pay-later eligibility: company-wide Admin only (today's setVip / setOrgCreditEligibleAction). */
  adminOnly: boolean;
};

export function customerPerms(s: SessionLike, managerId: string | null | undefined): CustomerPerms {
  const isMine = !!managerId && managerId === s.userId;
  return {
    isAdmin: s.isAdmin,
    customersView: canIn(s, 'customers', 'view'),
    isMine,
    isAccountManager: s.roles.includes('account_manager'),
    orders: canIn(s, 'orders', 'view'),
    requests: canIn(s, 'requests', 'view'),
    support: canIn(s, 'support', 'view'),
    assistant: canIn(s, 'assistant', 'view'),
    finance: canIn(s, 'finance', 'view'),
    wallet: canIn(s, 'wallet', 'view'),
    audit: canIn(s, 'audit', 'view'),
    suppliers: s.isAdmin || canIn(s, 'suppliers', 'view') || canIn(s, 'finance', 'view'),
    reassign: s.isAdmin || canIn(s, 'assistant', 'reassign'),
    services: canIn(s, 'customers', 'edit') || isMine,
    limits: s.isAdmin || isMine,
    adminOnly: s.isAdmin,
  };
}

export type PanelVisibility = {
  /** Credit terms + Pay-later state: Finance only. */
  credit: boolean;
  /** Wallet available balance + bank top-ups: wallet:view or finance:view. */
  walletBalance: boolean;
  /** Invoices, invoices due, payments (paid 12 months, last payment), statement: finance:view or orders:view. */
  invoices: boolean;
  /** Orders links open /office/orders/[id] (orders:view). Rows themselves come through RLS as today. */
  orderLinks: boolean;
  /** RFQ links open /office/rfqs/[id] (requests:view). */
  requestLinks: boolean;
  /** Supplier documents (purchase orders, remittances). */
  supplierDocuments: boolean;
  /** KYC review link (customers:view, as today). */
  kycLink: boolean;
  /** Assistant conversation links (assistant:view). */
  assistantLinks: boolean;
  /** Support tickets (Message + open items). */
  tickets: boolean;
  actions: { reassign: boolean; vip: boolean; payLater: boolean; services: boolean; limits: boolean; creditTerms: boolean };
};

export function panelVisibility(p: CustomerPerms): PanelVisibility {
  return {
    credit: p.finance,
    walletBalance: p.wallet || p.finance,
    invoices: p.finance || p.orders,
    orderLinks: p.orders,
    requestLinks: p.requests,
    supplierDocuments: p.suppliers,
    kycLink: p.customersView,
    assistantLinks: p.assistant,
    tickets: p.support,
    actions: {
      reassign: p.reassign,
      vip: p.adminOnly,
      payLater: p.adminOnly,
      services: p.services,
      limits: p.limits,
      creditTerms: p.finance,
    },
  };
}

/* ───────── Money ───────── */

/** "US$ 1,234.56" from integer cents (Money component format, for plain-text details). */
export const formatCents = (cents: number, currencyPrefix = 'US$') => formatMoney(Number(cents) / 100, { currency: currencyPrefix });
/** "27 Nov 2026" (full date: no request clock needed, so prerender-safe). */
export const shortDate = (iso: string) => formatDate(iso);

export const centsToAmount = (cents: number | string | null | undefined) => Number(cents ?? 0) / 100;

/** ISO code → the prefix Money/formatMoney prints (US$ 1,234.56). Other currencies print their code. */
export function currencyLabel(code: string | null | undefined): string {
  const c = (code ?? 'USD').trim().toUpperCase() || 'USD';
  return c === 'USD' ? 'US$' : c;
}

export type InvoiceRowInput = {
  docType: string;
  status: string | null;
  amountCents: number;
  paidCents: number;
  dueAt: string | null;
};

export type InvoiceStatusName = 'Draft' | 'Sent' | 'Partly paid' | 'Overdue' | 'Paid' | 'Cancelled' | 'Credit note';

/** documents row → Appendix C invoice status. Cancelled/void and credit notes first; then paid; overdue beats partly paid. */
export function invoiceStatusName(r: InvoiceRowInput, nowIso: string): InvoiceStatusName {
  const st = (r.status ?? 'issued').toLowerCase();
  if (r.docType === 'credit_note') return 'Credit note';
  if (st === 'void' || st === 'cancelled') return 'Cancelled';
  if (st === 'draft') return 'Draft';
  const balance = Math.max(0, r.amountCents - r.paidCents);
  if (st === 'paid' || (r.amountCents > 0 && balance === 0)) return 'Paid';
  if (r.dueAt && Date.parse(r.dueAt) < Date.parse(nowIso)) return 'Overdue';
  if (r.paidCents > 0) return 'Partly paid';
  return 'Sent';
}

export const invoiceBalanceCents = (r: Pick<InvoiceRowInput, 'amountCents' | 'paidCents'>) => Math.max(0, r.amountCents - r.paidCents);

/** Invoice-like documents counted as "invoices due" (today's receivables: commercial invoices; proformas carry deposits). */
export const DUE_DOC_TYPES = ['commercial_invoice', 'proforma_invoice'] as const;

export type Restricted = 'restricted';
export type Field<T> = T | Restricted | null; // null = failed to load

export type MoneyInput = {
  currency: string;
  /** `wallets` view rows (RLS) — or restricted. null = failed. */
  wallets: Field<{ currency: string; balanceMinor: number }[]>;
  /** open wallet_holds (today's CustomerOneApp "on hold"). null = failed. */
  holds: { amountCents: number }[] | null;
  invoices: Field<(InvoiceRowInput & { currency: string })[]>;
  payments: Field<{ amountCents: number; status: string; method: string; at: string }[]>;
};

export type MoneySummary = {
  currency: string;
  walletAvailableCents: Field<number>;
  heldCents: number | null;
  invoicesDueCents: Field<number>;
  invoicesDueCount: number;
  overdueCount: number;
  paid12mCents: Field<number>;
  lastPayment: Field<{ at: string; cents: number; method: string } | 'none'>;
};

const PAID_PAYMENT = new Set(['confirmed', 'matched']);

/** Money panel figures from today's rows. Only the record's currency is summed (other currencies are never mixed). */
export function moneySummary(m: MoneyInput, nowIso: string): MoneySummary {
  const cur = m.currency;
  const field = <A, B>(v: Field<A>, fn: (a: A) => B): Field<B> => (v === null ? null : v === 'restricted' ? 'restricted' : fn(v));
  const yearAgo = Date.parse(nowIso) - 365 * 864e5;
  const due = m.invoices === null || m.invoices === 'restricted' ? [] : m.invoices.filter((r) => r.currency === cur && (DUE_DOC_TYPES as readonly string[]).includes(r.docType) && invoiceBalanceCents(r) > 0 && !['Paid', 'Cancelled', 'Credit note', 'Draft'].includes(invoiceStatusName(r, nowIso)));
  return {
    currency: cur,
    walletAvailableCents: field(m.wallets, (ws) => ws.filter((w) => w.currency === cur).reduce((a, w) => a + Number(w.balanceMinor), 0)),
    heldCents: m.holds === null ? null : m.holds.reduce((a, h) => a + Number(h.amountCents), 0),
    invoicesDueCents: field(m.invoices, () => due.reduce((a, r) => a + invoiceBalanceCents(r), 0)),
    invoicesDueCount: due.length,
    overdueCount: due.filter((r) => invoiceStatusName(r, nowIso) === 'Overdue').length,
    paid12mCents: field(m.payments, (ps) => ps.filter((p) => PAID_PAYMENT.has(p.status) && Date.parse(p.at) >= yearAgo).reduce((a, p) => a + Number(p.amountCents), 0)),
    lastPayment: field(m.payments, (ps) => {
      const last = ps.filter((p) => PAID_PAYMENT.has(p.status)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      return last ? { at: last.at, cents: last.amountCents, method: last.method } : ('none' as const);
    }),
  };
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = { bank_transfer: 'Bank transfer', wallet: 'Wallet', card: 'Card', stripe: 'Card' };
export const paymentMethodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? humanizeWord(m);

/* ───────── Orders / requests / documents ───────── */

const SERVICE_BY_PREFIX: Record<string, string> = { SRC: 'Sourcing', STK: 'Ready stock', TK: 'Turnkey', TKP: 'Turnkey', POOL: 'MOQ pools', PL: 'MOQ pools', SHP: 'Shipping', BR: 'Make My Brand', MMB: 'Make My Brand', WH: 'Warehouse (3PL)', DS: 'Dropshipping' };

/** Service name from today's order code (OCT-SRC-2026-0207 → Sourcing); a pool order is MOQ pools; unknown → "—". */
export function orderServiceLabel(code: string | null | undefined, poolId?: string | null): string {
  if (poolId) return 'MOQ pools';
  const parts = (code ?? '').toUpperCase().split('-');
  for (const p of parts) if (SERVICE_BY_PREFIX[p]) return SERVICE_BY_PREFIX[p];
  return '—';
}

/** Supplier-side document types (never shown without the supplier permission). */
export const SUPPLIER_DOC_TYPES = ['purchase_order', 'remittance'] as const;
export const isSupplierDocType = (t: string) => (SUPPLIER_DOC_TYPES as readonly string[]).includes(t);

export const DOC_TYPE_LABEL: Record<string, string> = {
  proforma_invoice: 'Proforma invoice',
  commercial_invoice: 'Invoice',
  receipt: 'Receipt',
  confirmation: 'Order confirmation',
  statement: 'Statement',
  credit_note: 'Credit note',
  purchase_order: 'Purchase order (supplier)',
  remittance: 'Remittance (supplier)',
  qc_report: 'Quality check report',
};
export const docTypeLabel = (t: string) => DOC_TYPE_LABEL[t] ?? humanizeWord(t);

export const SERVICE_LABEL: Record<string, string> = { sourcing: 'Sourcing', dropship: 'Dropshipping', warehouse: '3PL warehouse', brand: 'Make My Brand' };
/** company_services rows switched on (on / trial) → names, in today's order. */
export function activeServices(rows: { service: string; status: string }[]): string[] {
  const on = new Set(rows.filter((r) => r.status === 'on' || r.status === 'trial').map((r) => r.service));
  return Object.keys(SERVICE_LABEL).filter((k) => on.has(k)).map((k) => SERVICE_LABEL[k]);
}

export const memberRoleLabel = (r: string) => humanizeWord(r);

/* ───────── Open items ───────── */

export type OpenItem = { id: string; status: string; ref: string; detail: string; href: string | null };

export type OpenItemsInput = {
  rfqs: { id: string; code: string; status: string; title: string; quotes: number }[];
  orders: { id: string; code: string; status: string; totalCents: number; paidCents: number; currency: string }[];
  invoices: { id: string; number: string; status: InvoiceStatusName; balanceCents: number; currency: string; dueAt: string | null }[] | null;
  tickets: { id: string; code: string; subject: string; status: string }[] | null;
  kyc: { id: string; status: string } | null;
};

const ORDER_OPEN = new Set(['pi_issued', 'deposit_pending', 'balance_pending', 'in_production', 'qc', 'deposit_paid', 'confirmed', 'balance_paid', 'ready_to_ship']);

/** Pills + links for the Open items panel; links only where the staff member may open the page. */
export function openItems(i: OpenItemsInput, v: Pick<PanelVisibility, 'orderLinks' | 'requestLinks' | 'tickets' | 'kycLink'>, fmt: (cents: number, currency: string) => string, fmtDate: (iso: string) => string): OpenItem[] {
  const out: OpenItem[] = [];
  if (i.kyc && ['submitted', 'in_review', 'more_info'].includes(i.kyc.status)) {
    out.push({ id: `kyc-${i.kyc.id}`, status: 'Verification pending', ref: 'KYC', detail: i.kyc.status === 'more_info' ? 'Waiting for more information' : 'Waiting for review', href: v.kycLink ? `/office/kyc/${i.kyc.id}` : null });
  }
  for (const r of i.rfqs) {
    if (!(OPEN_REQUEST_STATUSES as readonly string[]).includes(r.status)) continue;
    out.push({ id: `rfq-${r.id}`, status: requestStatusName(r.status), ref: r.code, detail: `${r.title}${r.quotes ? ` · ${r.quotes} ${r.quotes === 1 ? 'quote' : 'quotes'}` : ''}`, href: v.requestLinks ? `/office/rfqs/${r.id}` : null });
  }
  for (const o of i.orders) {
    if (!ORDER_OPEN.has(o.status)) continue;
    const bal = Math.max(0, o.totalCents - o.paidCents);
    const name = orderStatusName(o.status);
    const detail = name === 'Deposit due' || name === 'Balance due' || name === 'Waiting for payment' ? `${fmt(bal, o.currency)} to pay` : 'In progress';
    out.push({ id: `ord-${o.id}`, status: name, ref: o.code, detail, href: v.orderLinks ? `/office/orders/${o.id}` : null });
  }
  for (const d of i.invoices ?? []) {
    if (d.status !== 'Sent' && d.status !== 'Partly paid' && d.status !== 'Overdue') continue;
    out.push({ id: `inv-${d.id}`, status: d.status, ref: d.number, detail: `Balance ${fmt(d.balanceCents, d.currency)}${d.dueAt ? ` due ${fmtDate(d.dueAt)}` : ''}`, href: `/api/documents/${d.id}/pdf` });
  }
  if (v.tickets) for (const t of i.tickets ?? []) {
    out.push({ id: `tk-${t.id}`, status: 'Open', ref: t.code, detail: t.subject, href: `/office/support?t=${t.id}` });
  }
  return out;
}

/* ───────── Small helpers ───────── */

export function initials(name: string | null | undefined): string {
  const w = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : `${w[0][0]}${w[1][0]}`).toUpperCase();
}

export function humanizeWord(s: string | null | undefined): string {
  const t = (s ?? '').replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Record tabs in the Part 7.5 order. */
export const CUSTOMER_TABS = ['overview', 'orders', 'invoices', 'wallet', 'rfqs', 'documents', 'team', 'activity', 'notes'] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];
export const isCustomerTab = (v: string | undefined | null): v is CustomerTab => (CUSTOMER_TABS as readonly string[]).includes(v ?? '');

/* ───────── Credit (Finance only) ───────── */

/** customer_credit_terms.status → Appendix C approvals names (active = Approved, pending_approval = Waiting). */
export function creditTermStatusName(status: string): 'Approved' | 'Waiting' | 'Rejected' | 'Closed' {
  if (status === 'active' || status === 'approved') return 'Approved';
  if (status === 'pending_approval' || status === 'pending' || status === 'proposed') return 'Waiting';
  if (status === 'rejected') return 'Rejected';
  return 'Closed';
}

/** One line for the Money panel: "Not eligible" · "Eligible · no terms yet" · "US$ 10,000.00 · Net 30" (+ "· second approver needed"). */
export function creditSummary(c: { eligible: boolean; terms: { limitCents: number; currency: string; netDays: number; status: string }[] }): string {
  const active = c.terms.find((t) => creditTermStatusName(t.status) === 'Approved');
  const waiting = c.terms.some((t) => creditTermStatusName(t.status) === 'Waiting');
  if (!c.eligible && !active) return waiting ? 'Not eligible · proposal waiting' : 'Not eligible';
  const base = active ? `${formatCents(active.limitCents, currencyLabel(active.currency))} · Net ${active.netDays}` : 'Eligible · no terms yet';
  return waiting ? `${base} · second approver needed` : base;
}

/** "Mar 2026" for "customer since". */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
