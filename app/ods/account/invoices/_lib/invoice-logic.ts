/**
 * ODS My account › Invoices — pure logic (unit tested). Document status → Appendix C invoice names, the pill filters
 * (All · Due · Paid · Credit notes · Statements) and the service a document belongs to (same words as today's page).
 */
import { hrefWith, isCustomerDocType, one, type SearchParamsRecord } from '../../orders/_lib/commerce-format';

export type InvoiceStatusName = 'Draft' | 'Sent' | 'Partly paid' | 'Overdue' | 'Paid' | 'Cancelled' | 'Credit note';

/**
 * documents.status (+ type, due date) → Appendix C. Receipts record a payment → Paid. Awaiting payment past its due
 * date → Overdue (otherwise Sent). Voided / superseded → Cancelled.
 */
export function docStatusName(type: string, status: string | null | undefined, dueAt: string | null | undefined, nowMs: number): InvoiceStatusName {
  if (type === 'credit_note') return 'Credit note';
  const s = status ?? 'issued';
  if (s === 'draft') return 'Draft';
  if (s === 'paid' || type === 'receipt') return 'Paid';
  if (['void', 'voided', 'cancelled', 'superseded'].includes(s)) return 'Cancelled';
  const overdue = s === 'overdue' || (!!dueAt && ['awaiting_payment', 'issued', 'sent', 'part_paid'].includes(s) && Date.parse(dueAt) < nowMs);
  if (s === 'part_paid') return overdue ? 'Overdue' : 'Partly paid';
  return overdue ? 'Overdue' : 'Sent';
}

export type InvoiceFilter = 'all' | 'due' | 'paid' | 'credit' | 'statements';
export const INVOICE_FILTERS: [InvoiceFilter, string][] = [
  ['all', 'All'],
  ['due', 'Due'],
  ['paid', 'Paid'],
  ['credit', 'Credit notes'],
  ['statements', 'Statements'],
];
export const parseInvoiceFilter = (sp: SearchParamsRecord): InvoiceFilter => {
  const f = one(sp.filter) as InvoiceFilter;
  return INVOICE_FILTERS.some(([k]) => k === f) ? f : 'all';
};
export const invoicesHref = (f: InvoiceFilter, base = '/account/invoices') => hrefWith(base, { filter: f === 'all' ? null : f });

export type InvoiceRowVM = {
  id: string;
  type: string;
  typeLabel: string;
  number: string;
  service: string;
  forRef: string | null;
  createdAt: string;
  dueAt: string | null;
  amountCents: number | null;
  currency: string;
  statusName: InvoiceStatusName;
  /** what can still be paid from the wallet (service proformas only — today's getAmountsDue docDue) */
  payableCents: number;
};

export function matchesInvoiceFilter(r: InvoiceRowVM, f: InvoiceFilter): boolean {
  switch (f) {
    case 'due':
      return r.type !== 'credit_note' && r.type !== 'statement' && r.type !== 'receipt' && ['Sent', 'Partly paid', 'Overdue'].includes(r.statusName);
    case 'paid':
      return r.statusName === 'Paid';
    case 'credit':
      return r.type === 'credit_note';
    case 'statements':
      return r.type === 'statement';
    default:
      return true;
  }
}

export function invoiceCounts(rows: InvoiceRowVM[]): Record<InvoiceFilter, number> {
  return Object.fromEntries(INVOICE_FILTERS.map(([k]) => [k, rows.filter((r) => matchesInvoiceFilter(r, k)).length])) as Record<InvoiceFilter, number>;
}

const SVC: Record<string, string> = { sourcing: 'Sourcing', dropship: 'Dropshipping', warehouse: 'Warehouse (3PL)', brand: 'Make My Brand', wallet: 'Wallet top-up', turnkey: 'Turnkey', pools: 'MOQ pool' };

/** Same logic as today's `forLabel` on /account/invoices: the order code wins, then data.service + data.ref. */
export function invoiceService(d: { doc_type: string; data: unknown; orderCode: string | null }): { service: string; ref: string | null } {
  const x = (d.data ?? {}) as { service?: string; ref?: string };
  if (d.orderCode) return { service: 'Sourcing', ref: d.orderCode };
  if (x.service) return { service: SVC[x.service] ?? x.service, ref: x.ref ?? null };
  return { service: d.doc_type === 'receipt' ? 'Wallet top-up' : '—', ref: null };
}

export const invoiceDocTypes = (types: string[]) => types.filter(isCustomerDocType);

/* ───────── SaaS plans panel (today's /account/invoices rules) ───────── */

/** Today's page shows the SaaS plans panel when there is at least one active plan or one subscription. */
export const saasPanelVisible = (plans: number, subscriptions: number) => plans > 0 || subscriptions > 0;

/**
 * Pay later for a SaaS plan — today's SaasPlansPanel rule: the button exists only for credit-eligible companies
 * (Part 1 rule 8); it is enabled when the available credit covers the plan price.
 */
export function saasPayLater(creditEligible: boolean, creditAvailableCents: number, priceCents: number): { show: boolean; allowed: boolean } {
  return { show: creditEligible, allowed: creditEligible && creditAvailableCents >= priceCents };
}
