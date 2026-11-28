/**
 * Staging fixture sample data (ODS T9 Invoices). SAMPLE DATA ONLY — never used by the live page. Rows are built with the
 * SAME pure functions as the live loader (invoiceStatus, invoiceFigures, paymentTarget), so the fixture shows the real
 * status mapping.
 */
import {
  invoiceFigures,
  invoiceStatus,
  paymentTarget,
  daysOverdue,
  initials,
  serviceLabel,
  type InvoiceKpis,
  type InvoiceRow,
  type PaymentOutcome,
} from '@/app/ods/office/accounts/invoices/_lib/invoice-core';

/** Fixed "now" so the fixture always looks the same (27 Nov 2026, noon UTC). */
export const SAMPLE_NOW = Date.parse('2026-11-27T12:00:00Z');

type Raw = {
  number: string;
  type: 'proforma_invoice' | 'commercial_invoice' | 'credit_note';
  customer: string;
  div: string;
  issued: string;
  due: string | null;
  amount: number;
  paid: number;
  status: string;
  option?: string;
  order?: [code: string, outstanding: number];
  owner?: string;
};

const RAW: Raw[] = [
  { number: 'OCT-SRC-2026-0207', type: 'commercial_invoice', customer: 'Anna Home Trading', div: 'SRC', issued: '2026-10-18', due: '2026-12-01', amount: 410000, paid: 123000, status: 'part_paid', order: ['ORD-1042', 287000], owner: 'Priya Shah' },
  { number: 'PF-2026-0118', type: 'proforma_invoice', customer: 'Anna Home Trading', div: 'TK', issued: '2026-11-16', due: '2026-11-30', amount: 620000, paid: 0, status: 'awaiting_payment', owner: 'Priya Shah' },
  { number: 'OCT-SRC-2026-0198', type: 'commercial_invoice', customer: 'Gulf Home Supplies LLC', div: 'SRC', issued: '2026-10-02', due: '2026-11-01', amount: 234000, paid: 100000, status: 'part_paid', order: ['ORD-0988', 134000], owner: 'Rami Mansour' },
  { number: 'OCT-TK-2026-0027', type: 'commercial_invoice', customer: 'Riyadh Living Co.', div: 'TK', issued: '2026-09-21', due: '2026-10-21', amount: 980000, paid: 294000, status: 'part_paid', option: 'pay_later', owner: 'Rami Mansour' },
  { number: 'OCT-DS-2026-0311', type: 'commercial_invoice', customer: 'Petsy Store', div: 'DS', issued: '2026-11-25', due: '2026-11-25', amount: 31240, paid: 31240, status: 'paid', owner: 'Jia Li' },
  { number: 'OCT-MMB-2026-0012', type: 'commercial_invoice', customer: 'Anna Home Trading', div: 'MMB', issued: '2026-11-27', due: '2026-11-27', amount: 12000, paid: 12000, status: 'paid', owner: 'Priya Shah' },
  { number: 'OCT-SRC-2026-0213', type: 'commercial_invoice', customer: 'London Kitchen Co Ltd', div: 'SRC', issued: '2026-11-12', due: '2026-12-12', amount: 156000, paid: 46800, status: 'part_paid', order: ['ORD-1051', 109200], owner: 'Jia Li' },
  { number: 'OCT-SRC-2026-0221', type: 'commercial_invoice', customer: 'Gulf Home Supplies LLC', div: 'SRC', issued: '2026-11-26', due: '2026-12-26', amount: 348000, paid: 0, status: 'draft', owner: 'Rami Mansour' },
  { number: 'CN-2026-0007', type: 'credit_note', customer: 'Riyadh Living Co.', div: 'TK', issued: '2026-11-24', due: null, amount: 42000, paid: 0, status: 'issued', owner: 'Priya Shah' },
  { number: 'OCT-TK-2026-0031', type: 'commercial_invoice', customer: 'Anna Home Trading', div: 'TK', issued: '2026-11-16', due: '2026-11-30', amount: 620000, paid: 0, status: 'awaiting_payment', option: 'pay_later', owner: 'Priya Shah' },
  { number: 'PF-2026-0121', type: 'proforma_invoice', customer: 'Nordic Living AB', div: 'MMB', issued: '2026-11-20', due: '2026-12-04', amount: 320000, paid: 0, status: 'awaiting_payment', owner: 'Jia Li' },
  { number: 'OCT-PL-2026-0012', type: 'commercial_invoice', customer: 'Anna Home Trading', div: 'POOL', issued: '2026-11-27', due: '2026-12-02', amount: 33600, paid: 33600, status: 'paid', owner: 'Priya Shah' },
  { number: 'PF-2026-0109', type: 'proforma_invoice', customer: 'Casa Verde SA', div: 'MMB', issued: '2026-11-03', due: '2026-11-17', amount: 180000, paid: 180000, status: 'invoiced', owner: 'Jia Li' },
  { number: 'PF-2026-0104', type: 'proforma_invoice', customer: 'Gulf Home Trading LLC', div: 'TK', issued: '2026-10-28', due: '2026-11-11', amount: 500000, paid: 0, status: 'invoiced', option: 'pay_later', owner: 'Rami Mansour' },
  { number: 'OCT-SRC-2026-0201', type: 'commercial_invoice', customer: 'Casa Verde SA', div: 'SRC', issued: '2026-10-20', due: '2026-11-19', amount: 215000, paid: 0, status: 'awaiting_payment', order: ['ORD-1019', 215000], owner: 'Jia Li' },
];

const SERVICE_CODE = new Map<string, string>();

function build(r: Raw, i: number, suffix = ''): InvoiceRow {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const dueAt = r.due ? `${r.due}T00:00:00Z` : null;
  const status = invoiceStatus({ doc_type: r.type, status: r.status, paid_cents: r.paid, due_at: dueAt, payment_option: r.option ?? null }, SAMPLE_NOW);
  const f = invoiceFigures(r.amount, r.paid, status);
  const orderOutstanding = r.order ? r.order[1] : null;
  const pay = paymentTarget({ docType: r.type, number: r.number, status, orderId: r.order ? `ord-${i}` : null, orderOutstandingMinor: orderOutstanding });
  SERVICE_CODE.set(id, r.div);
  return {
    id,
    number: r.number + suffix,
    docType: r.type,
    customer: r.customer,
    orgId: `org-${r.customer}`,
    service: serviceLabel(r.div, null, r.type),
    issuedAt: `${r.issued}T09:00:00Z`,
    dueAt,
    amountMinor: r.type === 'credit_note' ? -r.amount : r.amount,
    paidMinor: f.paid,
    balanceMinor: f.balance,
    currency: 'USD',
    status,
    daysOverdue: status === 'Overdue' ? daysOverdue(dueAt, SAMPLE_NOW) : 0,
    owner: r.owner ? { initials: initials(r.owner), name: r.owner } : null,
    orderId: r.order ? `ord-${i}` : null,
    orderCode: r.order?.[0] ?? null,
    orderOutstandingMinor: orderOutstanding,
    payTarget: pay.target,
    payBlockedReason: pay.reason,
    paymentOption: r.option ?? null,
    lastReminder: status === 'Overdue' ? 'overdue_7' : null,
    emailedAt: status === 'Draft' ? null : `${r.issued}T09:05:00Z`,
  };
}

export const SAMPLE_ROWS: InvoiceRow[] = RAW.map((r, i) => build(r, i + 1));

/** 1,000 rows for the virtualised state (the grid virtualises above 200). */
export const SAMPLE_MANY: InvoiceRow[] = Array.from({ length: 1000 }, (_, i) => {
  const r = RAW[i % RAW.length];
  const n = String(1000 + i);
  return build({ ...r, number: r.number.replace(/\d{4}$/, n.slice(-4)) }, 100 + i);
});

export const sampleServiceOf = (r: InvoiceRow) => SERVICE_CODE.get(r.id) ?? null;

export const SAMPLE_KPIS: InvoiceKpis = {
  receivables: { minor: 4827040, count: 62 },
  overdue: { minor: 820000, count: 2, oldestDays: 37 },
  due7: { minor: 1093000, count: 5 },
  paidMonth: { minor: 3188020, count: 118 },
  held: { minor: 405000, count: 7 },
};

/** office.second_approver_over_cents in the designs (US$ 2,500). */
export const SAMPLE_LIMIT = 250000;

export const SAMPLE_SECOND_APPROVER: PaymentOutcome = {
  kind: 'second-approver',
  code: 'APR-00012',
  message: 'Second approver needed (APR-00012). A different Finance user must approve it in Approvals; then save this payment again.',
};

export const INVOICE_FIXTURE_STATES = [
  ['list', 'List'],
  ['overdue', 'Overdue tab'],
  ['empty', 'No results'],
  ['error', 'Error'],
  ['loading', 'Loading'],
  ['bulk', 'Bulk selection'],
  ['drawer', 'Record payment drawer'],
  ['second-approver', 'Second approver needed'],
  ['virtual', '1,000 rows (virtualised)'],
  ['no-permission', 'No permission'],
] as const;
export type InvoiceFixtureState = (typeof INVOICE_FIXTURE_STATES)[number][0];
