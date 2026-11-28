/**
 * Staging fixture SAMPLE DATA for ODS T9 Accounts part C (Credit notes · Ledger · Payments). Never used by the live pages.
 */
import { accountLabel, approvalName, paymentName, requestNumber, runningBalances, type CreditRow, type JournalView, type LedgerRow, type ListQuery, type ListResult, type PaymentRow } from '@/app/ods/office/accounts/_shared/accounts-core';

export const ACCOUNTS_C_STATES = [
  ['list', 'List'],
  ['drawer', 'Record drawer'],
  ['empty', 'No results'],
  ['error', 'Error'],
  ['loading', 'Loading'],
  ['no-permission', 'No permission'],
] as const;
export type AccountsCState = (typeof ACCOUNTS_C_STATES)[number][0];

const uid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

export const SAMPLE_CREDIT: CreditRow[] = [
  { kind: 'document', id: uid(1), number: 'CN-2026-0007', customer: 'Riyadh Living Co.', originalId: uid(91), originalNumber: 'OCT-TK-2026-0027', orderId: null, orderCode: null, issuedAt: '2026-11-24T10:00:00Z', amountMinor: -42000, currency: 'USD', status: 'Credit note', reason: 'Two lamp shades arrived broken (QC photos on file).' },
  { kind: 'document', id: uid(2), number: 'CN-2026-0006', customer: 'Anna Home Trading', originalId: uid(92), originalNumber: 'OCT-SRC-2026-0207', orderId: uid(81), orderCode: 'ORD-1042', issuedAt: '2026-11-12T10:00:00Z', amountMinor: -18500, currency: 'USD', status: 'Credit note', reason: 'Freight overcharge refunded as credit.' },
  { kind: 'document', id: uid(3), number: 'CN-2026-0004', customer: 'Gulf Home Supplies LLC', originalId: uid(93), originalNumber: 'OCT-SRC-2026-0198', orderId: uid(82), orderCode: 'ORD-0988', issuedAt: '2026-10-30T10:00:00Z', amountMinor: -96000, currency: 'USD', status: 'Cancelled', reason: 'Issued in error; replaced by CN-2026-0005.' },
  { kind: 'request', id: uid(4), number: requestNumber(uid(4)), customer: 'London Kitchen Co Ltd', orderId: uid(83), orderCode: 'ORD-1051', requestedAt: '2026-11-26T09:00:00Z', decidedAt: null, amountMinor: -32000, currency: 'USD', status: approvalName('requested'), reason: 'Short shipment: 40 units missing from carton 12.', requestedBy: 'Omar Khalid', approvedBy: null, journalId: null },
  { kind: 'request', id: uid(5), number: requestNumber(uid(5)), customer: 'Casa Verde SA', orderId: null, orderCode: null, requestedAt: '2026-11-20T09:00:00Z', decidedAt: '2026-11-21T11:00:00Z', amountMinor: -15000, currency: 'USD', status: approvalName('rejected'), reason: 'Goodwill credit for late delivery.', requestedBy: 'Omar Khalid', approvedBy: 'Priya Shah', journalId: null },
];

type RawLine = [n: number, at: string, journal: string, code: string, name: string, kind: string, org: string | null, memo: string, debit: number, credit: number];
const RAW: RawLine[] = [
  [1, '2026-11-20T10:00:00Z', 'JRN-000101', 'cash:bank', 'Bank', 'asset', null, 'Payment FT2611200917 · ORD-1042 deposit', 123000, 0],
  [2, '2026-11-20T10:00:00Z', 'JRN-000101', 'ar', 'Receivable', 'asset', 'Anna Home Trading', 'Payment FT2611200917 · ORD-1042 deposit', 0, 123000],
  [3, '2026-11-22T12:00:00Z', 'JRN-000104', 'cash:bank', 'Bank', 'asset', null, 'Top-up TOP-2211 · Petsy Store', 50000, 0],
  [4, '2026-11-22T12:00:00Z', 'JRN-000104', 'wallet', 'Wallet', 'liability', 'Petsy Store', 'Top-up TOP-2211 · Petsy Store', 0, 50000],
  [5, '2026-11-25T08:30:00Z', 'JRN-000109', 'wallet', 'Wallet', 'liability', 'Petsy Store', 'Dropship order OCT-DS-2026-0311', 31240, 0],
  [6, '2026-11-25T08:30:00Z', 'JRN-000109', 'rev:dropship', 'Dropship revenue', 'revenue', null, 'Dropship order OCT-DS-2026-0311', 0, 31240],
  [7, '2026-11-26T15:00:00Z', 'JRN-000112', 'cash:bank', 'Bank', 'asset', null, 'Payment FT2611261402 · PF-2026-0109', 180000, 0],
  [8, '2026-11-26T15:00:00Z', 'JRN-000112', 'rev:brand', 'Make My Brand revenue', 'revenue', null, 'Payment FT2611261402 · PF-2026-0109', 0, 180000],
];
const bankBalances = runningBalances('asset', RAW.filter((r) => r[3] === 'cash:bank').map((r) => ({ id: r[0], debit: r[8], credit: r[9] })));
export const SAMPLE_ACCOUNTS = [
  { id: uid(201), label: 'cash:bank · Bank', kind: 'asset' },
  { id: uid(202), label: 'rev:brand · Make My Brand revenue', kind: 'revenue' },
  { id: uid(203), label: 'rev:dropship · Dropship revenue', kind: 'revenue' },
  { id: uid(204), label: 'Wallet · Petsy Store', kind: 'liability' },
  { id: uid(205), label: 'Receivable · Anna Home Trading', kind: 'asset' },
];
export function sampleLedger(withBalance: boolean): LedgerRow[] {
  return RAW.map(([n, at, journal, code, name, kind, org, memo, debit, credit]) => ({
    id: String(n),
    at,
    journalId: uid(300 + Number(journal.slice(-3))),
    journalNumber: journal,
    accountId: code === 'cash:bank' ? uid(201) : uid(299),
    accountCode: code,
    accountLabel: accountLabel(org ? `${code}:x` : code, name, org),
    accountKind: kind,
    customer: org,
    memo,
    debitMinor: debit,
    creditMinor: credit,
    currency: 'USD',
    balanceMinor: withBalance ? (bankBalances.get(String(n)) ?? null) : null,
    refType: 'payment',
    refId: uid(400 + n),
  })).reverse();
}

export const SAMPLE_PAYMENTS: PaymentRow[] = [
  { source: 'payment', id: uid(501), at: '2026-11-26T15:00:00Z', customer: 'Anna Home Trading', purpose: 'Deposit', method: 'Bank transfer', reference: 'FT2611200917', orderId: uid(81), orderCode: 'ORD-1042', documentId: uid(92), documentNumber: 'OCT-SRC-2026-0207', invoiceId: null, invoiceNumber: null, amountMinor: 123000, currency: 'USD', status: paymentName('confirmed'), journalId: null },
  { source: 'payment', id: uid(502), at: '2026-11-22T12:00:00Z', customer: 'Petsy Store', purpose: 'Wallet top-up', method: 'Card', reference: 'TOP-2211', orderId: null, orderCode: null, documentId: null, documentNumber: null, invoiceId: null, invoiceNumber: null, amountMinor: 50000, currency: 'USD', status: paymentName('confirmed'), journalId: null },
  { source: 'payment', id: uid(503), at: '2026-11-27T08:00:00Z', customer: 'Casa Verde SA', purpose: 'Balance', method: 'Bank transfer', reference: 'FT2611270042', orderId: uid(84), orderCode: 'ORD-1019', documentId: uid(94), documentNumber: 'OCT-SRC-2026-0201', invoiceId: null, invoiceNumber: null, amountMinor: 215000, currency: 'USD', status: paymentName('pending'), journalId: null },
  { source: 'payment', id: uid(504), at: '2026-11-18T08:00:00Z', customer: 'Nordic Living AB', purpose: 'Service', method: 'Card', reference: 'CHK-88213', orderId: null, orderCode: null, documentId: null, documentNumber: null, invoiceId: null, invoiceNumber: null, amountMinor: 4900, currency: 'USD', status: paymentName('failed'), journalId: null },
  { source: 'document_payment', id: uid(505), at: '2026-11-26T15:00:00Z', customer: 'Casa Verde SA', purpose: 'Service proforma', method: 'Bank transfer', reference: 'FT2611261402', orderId: null, orderCode: null, documentId: uid(95), documentNumber: 'PF-2026-0109', invoiceId: uid(96), invoiceNumber: 'OCT-MMB-2026-0013', amountMinor: 180000, currency: 'USD', status: 'Paid', journalId: uid(412) },
];

export const SAMPLE_JOURNAL: JournalView = {
  id: uid(312),
  number: 'JRN-000112',
  at: '2026-11-26T15:00:00Z',
  memo: 'Payment FT2611261402 · PF-2026-0109',
  stream: 'brand',
  refType: 'document',
  refId: uid(95),
  lines: [
    { id: '7', account: 'cash:bank · Bank', customer: null, debitMinor: 180000, creditMinor: 0, currency: 'USD', memo: null },
    { id: '8', account: 'Receivable · Casa Verde SA', customer: 'Casa Verde SA', debitMinor: 0, creditMinor: 180000, currency: 'USD', memo: null },
  ],
};

/** Fixture result for a state (tab filtering on the sample rows). */
export function sampleResult<T>(state: AccountsCState, rows: T[], q: ListQuery, inTab: (r: T, tab: string) => boolean, tabs: readonly string[], nowMs: number): ListResult<T> {
  if (state === 'loading') return { kind: 'loading' };
  if (state === 'error') return { kind: 'error', error: 'We couldn’t load these rows.' };
  if (state === 'no-permission') return { kind: 'forbidden' };
  const shown = state === 'empty' ? [] : rows.filter((r) => inTab(r, q.tab));
  return { kind: 'ok', rows: shown, total: shown.length, counts: Object.fromEntries(tabs.map((t) => [t, state === 'empty' ? 0 : rows.filter((r) => inTab(r, t)).length])), updatedAt: new Date(nowMs - 120_000).toISOString() };
}
