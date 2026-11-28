/**
 * SAMPLE data for the staging-only Accounts batch A fixtures (/dev/ui/screens/office-finance, office-receivables,
 * office-reports). Labelled sample; never used by real pages. Built through the same pure helpers as the real loaders.
 */
import type { DivisionReportData, FinanceOverviewData, ReconciliationAlert, ReportsData } from '@/app/ods/office/_lib/accounts-a-data';
import { divisionTotals, receivableRows, totalsOf, type DivisionRow, type Totals } from '@/app/ods/office/_lib/accounts-a-core';
import type { ActionResult } from '@/app/ods/office/_components/accounts-a-actions';
import { SAMPLE_NOW } from '../office-dashboard/sample-data';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (daysAgo: number) => new Date(SAMPLE_NOW - daysAgo * 86_400_000).toISOString();
const RATE = 7.1;
const toPlat = (m: number, c: string) => (c === 'CNY' ? Math.round(m / RATE) : m);
const T = (parts: [string, number][]): Totals => totalsOf(parts, (p) => p[1], (p) => p[0], toPlat, 'USD');
const EMPTY: Totals = { parts: [], convMinor: 0, mixed: false };

export function sampleFinance(opts: { mixed?: boolean; empty?: boolean } = {}): FinanceOverviewData {
  const m = opts.mixed;
  const e = opts.empty;
  return {
    month: '2026-11', monthLabel: 'Nov 2026', months: [{ value: '2026-11', label: 'Nov 2026' }, { value: '2026-10', label: 'Oct 2026' }, { value: '2026-09', label: 'Sep 2026' }],
    currency: 'USD', rateText: '7.1 CNY/USD',
    kpis: e
      ? { gross: EMPTY, refunds: EMPTY, net: EMPTY, paymentsIn: EMPTY, payoutsDue: EMPTY, wallets: EMPTY, refundShare: '—', payoutsAwaiting: 0 }
      : {
          gross: T(m ? [['USD', 8_240_000], ['CNY', 1_420_000]] : [['USD', 8_240_000]]),
          refunds: T([['USD', -312_000]]),
          net: T(m ? [['USD', 7_928_000], ['CNY', 1_420_000]] : [['USD', 7_928_000]]),
          paymentsIn: T([['USD', 6_115_000]]),
          payoutsDue: T(m ? [['USD', 2_400_000], ['CNY', 8_520_000]] : [['USD', 3_691_500]]),
          wallets: T([['USD', 6_412_000]]),
          refundShare: '3.8% of revenue', payoutsAwaiting: 2,
        },
    streams: e ? [] : [
      { stream: 'orders', label: 'Orders', convMinor: 6_100_000, parts: [{ currency: 'USD', minor: 6_100_000 }] },
      { stream: 'services', label: 'Services', convMinor: 1_240_000, parts: m ? [{ currency: 'USD', minor: 1_040_000 }, { currency: 'CNY', minor: 1_420_000 }] : [{ currency: 'USD', minor: 1_240_000 }] },
      { stream: 'fees', label: 'Fees', convMinor: 588_000, parts: [{ currency: 'USD', minor: 588_000 }] },
    ],
    revNet: e ? EMPTY : T(m ? [['USD', 7_728_000], ['CNY', 1_420_000]] : [['USD', 7_928_000]]),
    limitUsdMinor: 250_000, limitPlatMinor: null,
    ledger: { error: false, rows: e ? [] : [
      { currency: 'USD', debit: 41_250_000, credit: 41_250_000, journals: 412, unbalanced: 0, balanced: true },
      ...(m ? [{ currency: 'CNY', debit: 9_100_000, credit: 9_100_000, journals: 38, unbalanced: 0, balanced: true }] : []),
    ] },
    pending: e ? [] : [
      { id: id(1), kind: 'refund', label: 'Refund', ref: 'A1B2C3D4', forName: 'Anna Home Trading', amountMinor: 42_000, currency: 'USD', reason: 'Refund for 3 damaged units on OCT-SRC-2026-0207', preparedBy: 'Ravi M.', mine: false, stage: 'Needs Finance' },
      { id: id(2), kind: 'payout', label: 'Payout', ref: 'E5F6A7B8', forName: 'Sample Supplier Co. · SUP-0012', amountMinor: 1_150_000, currency: 'USD', reason: 'Deposit for RFQ-1042 production', preparedBy: 'Priya Shah', mine: true, stage: 'Needs Admin' },
    ],
    decided: e ? [] : [{ id: id(3), label: 'Credit note', amountMinor: 18_000, currency: 'USD', status: 'approved', requestedBy: 'Ravi M.', approvedBy: 'Priya Shah', decidedAt: iso(2) }],
    orgs: [{ id: id(10), label: 'Anna Home Trading · AE' }, { id: id(11), label: 'Riyadh Living Co. · SA' }],
    suppliers: [{ id: id(20), label: 'SUP-0012 · Sample Supplier Co.' }],
    openOrders: [{ id: id(30), label: 'OCT-SRC-2026-0207 · Anna Home Trading · USD' }],
    unpaid: [{ id: id(30), label: 'OCT-SRC-2026-0207 · Anna Home Trading · due US$ 2,870.00 (Balance pending)' }],
    topups: e ? [] : [{ id: id(40), createdAt: iso(1), org: 'Gulf Home Supplies LLC', reference: 'FT2611270042', method: 'Bank transfer', amountMinor: 500_000, currency: 'USD' }],
    payments: e ? [] : [
      { id: id(50), createdAt: iso(0), org: 'Anna Home Trading', reference: 'FT2611270011', purpose: 'Balance', method: 'Bank transfer', amountMinor: 287_000, currency: 'USD', status: 'confirmed' },
      { id: id(51), createdAt: iso(1), org: 'Nordic Living AB', reference: 'ch_3Q…', purpose: 'Deposit', method: 'Card', amountMinor: 149_150, currency: 'USD', status: 'pending' },
    ],
    payouts: e ? [] : [{ id: id(60), supplier: 'Sample Supplier Co. · SUP-0012', amountMinor: 1_150_000, currency: 'USD', status: 'scheduled', createdAt: iso(3) }],
    journals: e ? [] : [
      { id: id(70), createdAt: iso(0), who: 'Priya Shah', memo: 'Payment received OCT-SRC-2026-0207', number: 'J-2026-0412', stream: 'orders', totals: [{ currency: 'USD', minor: 287_000 }] },
      { id: id(71), createdAt: iso(1), who: 'System', memo: 'Wallet spend · service fee', number: 'J-2026-0411', stream: 'services', totals: [{ currency: 'USD', minor: 12_000 }] },
    ],
    signedInAs: 'Priya Shah',
  };
}

const ok = (message: string) => async (): Promise<ActionResult> => {
  await new Promise((r) => setTimeout(r, 200));
  return { ok: true, message };
};
export const SAMPLE_FINANCE_ACTIONS = {
  decide: async (_id: string, approve: boolean) => ok(approve ? 'Approved' : 'Rejected')(),
  confirmTopup: async () => ok('Top-up credited')(),
  recordPayment: async () => ok('Payment recorded and posted to the ledger')(),
  requestApproval: async () => ok('Request sent for approval (a different person must approve it)')(),
};

/* ───────── receivables ───────── */

const doc = (n: number, num: string, org: string, orgId: number, div: string, amount: number, paid: number, dueDaysAgo: number | null, reminder: string | null, currency = 'USD') => ({
  id: id(100 + n), number: num, org_id: id(orgId), amount_cents: amount, paid_cents: paid, currency, due_at: dueDaysAgo == null ? null : iso(dueDaysAgo),
  payment_option: 'pay_later', last_reminder_stage: reminder, created_at: iso((dueDaysAgo ?? 0) + 30), organizations: { name: org }, divisions: { code: div },
});
export const SAMPLE_RECEIVABLES = receivableRows(
  [
    doc(1, 'INV-2026-0141', 'Anna Home Trading', 10, 'SRC', 2_140_000, 0, -13, null),
    doc(2, 'INV-2026-0133', 'Anna Home Trading', 10, 'SRC', 1_400_000, 400_000, 12, '+7d'),
    doc(3, 'INV-2026-0120', 'Riyadh Living Co.', 11, 'BRD', 867_000, 0, 38, '+14d'),
    doc(4, 'INV-2026-0098', 'Nordic Living AB', 12, '3PL', 540_000, 0, 73, '+14d'),
    doc(5, 'INV-2026-0071', 'Casa Verde SA', 13, 'SRC', 280_000, 0, 149, '+14d'),
    doc(6, 'INV-2026-0144', 'Gulf Home Supplies LLC', 14, 'DS', 710_000, 0, 2, '0d', 'CNY'),
  ],
  SAMPLE_NOW,
);
export const SAMPLE_ALERTS: ReconciliationAlert[] = [
  { id: 'al1', provider: 'stripe', providerPaymentId: 'pi_3Q…', kind: 'amount_mismatch', expectedMinor: 149_150, actualMinor: 148_000, currency: 'USD', detail: 'Settlement US$ 1,480.00 vs ledger US$ 1,491.50', status: 'open', createdAt: iso(1) },
];
export const SAMPLE_RECEIVABLES_ACTIONS = {
  overdueCheck: async () => ({ ok: true, remindersSent: 4, orgsBlocked: 1, saasSuspended: 0, expiredPledges: 2 }),
  reconcile: async () => ({ ok: true, checked: 38, alertsRaised: 1 }),
};

/* ───────── reports ───────── */

export function sampleReports(opts: { empty?: boolean } = {}): ReportsData {
  const e = opts.empty;
  return {
    months: 6, currency: 'USD', rateText: '7.1 CNY/USD', mixed: false, firstSupplier: e ? { at: iso(3), by: 'Ashif A.' } : null,
    kpis: {
      gmv: e ? EMPTY : T([['USD', 48_240_000]]), orders: e ? 0 : 142, nonOrder: e ? EMPTY : T([['USD', 3_120_000]]),
      customers: e ? 0 : 318, kycPct: e ? 0 : 64, verified: e ? 0 : 204, liveProducts: e ? 0 : 1_284, openRfqs: e ? 0 : 23, openTickets: e ? 0 : 9,
    },
    gmvMonths: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].map((label, i) => ({ month: `2026-${String(6 + i).padStart(2, '0')}`, label, minor: e ? 0 : [5_200_000, 6_900_000, 7_400_000, 8_100_000, 9_800_000, 10_840_000][i]! })),
    streams: e ? [] : [
      { stream: 'orders', label: 'Orders', convMinor: 45_120_000, text: 'US$ 451,200.00' },
      { stream: 'services', label: 'Services', convMinor: 2_210_000, text: 'US$ 22,100.00' },
      { stream: 'ads', label: 'Ads', convMinor: 910_000, text: 'US$ 9,100.00' },
    ],
    switches: [
      { key: 'wallet_enabled', label: 'Wallet', hint: 'Customers top up and pay services from the wallet', on: true },
      { key: 'supplier_portal_enabled', label: 'Supplier portal', hint: 'Suppliers log in and manage their own products', on: false },
      { key: 'ads_enabled', label: 'Advertising', hint: 'Pay-per-click ads on the storefront', on: true },
      { key: 'supplier_sees_contacts_after_paid', label: 'Supplier sees buyer contacts after payment', hint: 'Contacts visibility rule', on: false },
    ],
    serviceTypes: e ? [] : [{ code: 'sample', label: 'Sample', count: 41 }, { code: 'qc', label: 'Qc', count: 18 }, { code: 'factory_audit', label: 'Factory audit', count: 6 }],
    topCountries: e ? [] : ['United Arab Emirates', 'Saudi Arabia', 'Sweden', 'Spain', 'Kenya'],
    topSuppliers: e ? [] : [
      { id: 's1', name: 'Sample Supplier Co.', code: 'SUP-0012', country: 'CN', gmvMinor: 12_400_000, orders: 31 },
      { id: 's2', name: 'Example Factory Ltd.', code: 'SUP-0031', country: 'CN', gmvMinor: 8_900_000, orders: 19 },
    ],
    staff: e ? [] : [{ id: 'u1', name: 'Priya Shah', roles: ['finance'] }, { id: 'u2', name: 'Ravi M.', roles: ['finance', 'operations'] }, { id: 'u3', name: 'Omar Khalid', roles: ['account_manager'] }],
    activity: e ? [] : [
      { key: 'a1', at: iso(0), who: 'Priya Shah', what: 'Finance · payment recorded — OCT-SRC-2026-0207' },
      { key: 'h1', at: iso(0.2), who: 'Li W.', what: 'Order In production → Qc passed' },
    ],
    auditShown: true,
  };
}
export const sampleSetSetting = async (key: string, value: boolean): Promise<ActionResult> => ({ ok: true, message: `${key} ${value ? 'on' : 'off'}` });

const drow = (code: string | null, name: string, line: DivisionRow['line'], rev: number, orders: number, val: number, work: number, detail: Record<string, number>, pipe = 0, pipeN = 0, dep = 0): DivisionRow => ({
  line, division_code: code, division_name: name, sort_order: 0, revenue_by_currency: { USD: rev }, revenue_converted_minor: rev, orders_count: orders,
  orders_by_currency: { USD: val }, orders_converted_minor: val, open_work: work, open_detail: detail, pipeline_count: pipeN, pipeline_by_currency: { USD: pipe },
  pipeline_converted_minor: pipe, deposits_by_currency: { USD: dep }, deposits_converted_minor: dep,
});
export function sampleDivisions(opts: { scoped?: boolean } = {}): DivisionReportData {
  const divisions = [
    drow('SRC', 'Sourcing', 'division', 31_200_000, 88, 39_400_000, 27, { rfqs: 14, orders: 9, service_requests: 4 }, 4_100_000, 6, 1_200_000),
    drow('DS', 'Dropship', 'division', 6_400_000, 41, 7_100_000, 12, { orders: 12 }, 0, 0, 0),
    drow('3PL', '3PL & Shipping', 'division', 3_900_000, 13, 4_200_000, 8, { shipments: 8 }, 800_000, 2, 300_000),
  ];
  const extra = [drow(null, 'Advertising', 'advertising', 910_000, 0, 0, 0, {}), drow(null, 'Company-wide', 'company', 450_000, 0, 0, 0, {}, 200_000, 1, 0)];
  const held = { SRC: { count: 3, cents: 2_400_000 }, DS: { count: 1, cents: 180_000 }, '3PL': { count: 0, cents: 0 } };
  const rows = opts.scoped ? divisions.slice(0, 1) : [...divisions, ...extra];
  return {
    months: 6, includeTest: false, staging: true, currency: 'USD', mixed: false,
    scopeAll: !opts.scoped, scopeName: opts.scoped ? 'Sourcing' : null,
    divisions: opts.scoped ? divisions.slice(0, 1) : divisions, extra: opts.scoped ? [] : extra,
    held, totalHeld: (opts.scoped ? divisions.slice(0, 1) : divisions).reduce((a, r) => a + (held[r.division_code as keyof typeof held]?.cents ?? 0), 0),
    total: divisionTotals(rows),
  };
}
