/**
 * Shared display helpers for the ODS My account commerce pages (requests, orders, wallet, invoices). Pure (server +
 * client). Display only: amounts arrive in minor units from TODAY's tables / RPCs and are only divided by 100 here for
 * the `Money` component — no money is calculated.
 */
import { formatDate, formatMoney } from '@octopus/ui/format';

/** ISO currency code → the customer label used by Money (`US$ 1,234.56`, Part 2.7). */
export function curLabel(code: string | null | undefined): string {
  const c = (code ?? 'USD').trim().toUpperCase();
  return c === 'USD' ? 'US$' : c === 'HKD' ? 'HK$' : c === 'CNY' ? 'CN¥' : c === 'AED' ? 'AED' : c || 'US$';
}

/** Minor units → major units for `Money amount=…`. */
export const units = (cents: number | null | undefined) => Number(cents ?? 0) / 100;

/** "US$ 2,870.00" from minor units + ISO code. */
export const moneyText = (cents: number | null | undefined, code?: string | null) => formatMoney(units(cents), { currency: curLabel(code) });

/** "27 Nov 2026" (or "" for no date). */
export const dateText = (iso: string | null | undefined) => (iso ? formatDate(iso) : '');

/** First value of a search param. */
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Builds `path?a=b` from a record, dropping empty values (URL state, Part 2.8). */
export function hrefWith(path: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Customer-safe document types (supplier documents — purchase_order, remittance — are never listed). */
export const CUSTOMER_DOC_TYPES = ['proforma_invoice', 'commercial_invoice', 'receipt', 'confirmation', 'statement', 'credit_note', 'qc_report'] as const;
export type CustomerDocType = (typeof CUSTOMER_DOC_TYPES)[number];
export const isCustomerDocType = (t: string): t is CustomerDocType => (CUSTOMER_DOC_TYPES as readonly string[]).includes(t);

/** Labels for the document types (same words as today's DOC_LABEL, plus the QC report). */
export const DOC_TYPE_LABEL: Record<CustomerDocType, string> = {
  proforma_invoice: 'Proforma invoice',
  commercial_invoice: 'Invoice',
  receipt: 'Receipt',
  confirmation: 'Order confirmation',
  statement: 'Statement',
  credit_note: 'Credit note',
  qc_report: 'QC report',
};

/** Today's PDF route for a document (app/api/documents/[id]/pdf). */
export const docPdfHref = (id: string) => `/api/documents/${id}/pdf`;
