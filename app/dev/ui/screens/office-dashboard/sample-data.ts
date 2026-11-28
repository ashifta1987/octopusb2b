/**
 * SAMPLE data for the staging-only Back Office screen fixtures (/dev/ui/screens/office-dashboard, office-my-work,
 * office-approvals). Labelled sample; never used by real pages. Names, numbers and records are invented for design
 * review (they follow the ERP_Dashboard / M_ERP_Approvals boards).
 */
import type { QueueItem } from '@/lib/core/work-queue';
import type { ApprovalItem } from '@/lib/office/workspace-core';
import type { ActivityItem, Fx, KpiFigure, PoolSoon } from '@/app/ods/office/_lib/dashboard-data';
import type { OfficePerms } from '@/app/ods/office/_lib/nav';
import { ageingBuckets, weekStartUtc, weeklyMoney, type AgeingResult, type MoneyWeek } from '@/app/ods/office/_lib/dashboard-core';
import { SAMPLE_OFFICE } from '../office-frame/sample-data';

/** Fixed "now" so screenshots don't move: Friday 27 Nov 2026, 18:45 UTC. */
export const SAMPLE_NOW = Date.UTC(2026, 10, 27, 18, 45);
const iso = (minutesAgo: number) => new Date(SAMPLE_NOW - minutesAgo * 60_000).toISOString();

export type SampleRole = 'finance' | 'sales' | 'admin';
export const SAMPLE_ROLES: [SampleRole, string][] = [
  ['finance', 'Finance'],
  ['sales', 'Sales'],
  ['admin', 'Owner (admin)'],
];

export const SAMPLE_PERMS: Record<SampleRole, OfficePerms> = {
  finance: SAMPLE_OFFICE.perms,
  sales: {
    ...SAMPLE_OFFICE.perms,
    roles: ['sales'],
    permissions: ['dashboard:view', 'customers:view', 'requests:view', 'requests:create', 'orders:view', 'support:view'],
    canSeeSaas: false,
  },
  admin: { ...SAMPLE_OFFICE.perms, isAdmin: true, roles: ['admin'] },
};
export const SAMPLE_USER: Record<SampleRole, { name: string; role: string }> = {
  finance: { name: 'Priya Shah', role: 'Finance' },
  sales: { name: 'Omar Khalid', role: 'Sales' },
  admin: { name: 'Ashif Abdul', role: 'Owner' },
};

export const SAMPLE_FX: Fx = { currency: 'USD', prefix: 'US$', rateText: '7.1 CNY/USD' };

export const SAMPLE_FINANCE_KPIS: KpiFigure[] = [
  { id: 'receivables', label: 'Receivables', minor: 4_827_040, hintMinor: 820_000, hint: 'overdue', href: '#receivables' },
  { id: 'payables', label: 'Payables', minor: 3_691_500, hint: '6 supplier payouts due', href: '#payables' },
  { id: 'wallets', label: 'Customer wallets', minor: 6_412_000, hint: 'customer money held', href: '#wallets' },
  { id: 'approvals', label: 'Waiting for approval', count: 5, hint: '2 you can decide', href: '#approvals' },
];

export const SAMPLE_SALES_KPIS: KpiFigure[] = [
  { id: 'rfqs-open', label: 'Sourcing requests to quote', count: 7, hint: 'new or assigned', href: '#rfqs' },
  { id: 'rfqs-quoted', label: 'Waiting for customer', count: 12, hint: 'quotes sent', href: '#rfqs' },
  { id: 'orders-open', label: 'Open orders', count: 18, hint: 'not closed or cancelled', href: '#orders' },
  { id: 'services', label: 'Service requests', count: 4, hint: 'requested or paid', href: '#services' },
];

export const SAMPLE_WORK: QueueItem[] = [
  { key: 'ap-1', customer: 'Anna Home Trading', service: 'sourcing', ref: 'RFQ-1042', item: 'Quote · US$ 2,870.00 · margin 14%', needed: 'Above the customer limit. Approve or decline.', due: null, dueLabel: 'Waiting', late: false, age: 'Waiting 2 h', href: '#ap-1', cta: 'Approve or decline', primary: true, owner: false },
  { key: 'ap-2', customer: 'Riyadh Living Co.', service: 'brand', ref: 'BRD-0031', item: 'Brand pack · US$ 9,420.00 · margin 6%', needed: 'Below the minimum margin. Needs the owner.', due: null, dueLabel: 'Waiting', late: false, age: 'Waiting 5 h', href: '#ap-2', cta: 'Open approval', primary: true, owner: true },
  { key: 'tt-1', customer: 'Gulf Home Supplies LLC', service: 'wallet', ref: 'FT2611270042', item: 'Bank transfer · US$ 5,000.00 claimed', needed: 'Check the bank statement, enter the amount received and confirm, or reject with a reason.', due: null, dueLabel: 'Today', late: true, age: 'Sent 2 d', href: '#tt-1', cta: 'Check transfer', primary: true, owner: false },
  { key: 'rq-1', customer: 'Nordic Living AB', service: 'sourcing', ref: 'RFQ-1051', item: 'Foldable pet crate · 1,200 pcs', needed: 'New sourcing request. Assign a sourcing office and start finding suppliers.', due: '2026-12-01T00:00:00Z', dueLabel: '1 Dec', late: false, age: 'New 3 h', href: '#rq-1', cta: 'Open request', primary: false, owner: false },
  { key: 'rq-2', customer: 'Casa Verde SA', service: 'sourcing', ref: 'RFQ-1047', item: 'Bamboo cutting boards · 3,000 pcs', needed: 'Find suppliers and add quotes.', due: '2026-11-27T00:00:00Z', dueLabel: '27 Nov', late: true, age: 'New 4 d', href: '#rq-2', cta: 'Open request', primary: false, owner: false },
  { key: 'rq-3', customer: 'Anna Home Trading', service: 'dropship', ref: 'RFQ-1049', item: 'Silicone kitchen set · 800 pcs', needed: 'Find suppliers and add quotes.', due: null, dueLabel: 'No deadline', late: false, age: 'New 1 d', href: '#rq-3', cta: 'Open request', primary: false, owner: false },
  { key: 'rq-4', customer: 'Desert Rose Retail', service: 'warehouse', ref: 'RFQ-1050', item: 'Storage boxes · 2,400 pcs', needed: 'Find suppliers and add quotes.', due: '2026-12-04T00:00:00Z', dueLabel: '4 Dec', late: false, age: 'New 20 h', href: '#rq-4', cta: 'Open request', primary: false, owner: false },
];
export const SAMPLE_WORK_STATS = { open: 12, needOwner: 1, waitingCustomer: 9, dueOrLate: 2 };

/** Sample bank-account movements → the same weekly helper as the real page. */
export const SAMPLE_WEEKS: MoneyWeek[] = weeklyMoney(
  [
    [3_200_000, 2_100_000], [4_100_000, 3_300_000], [4_800_000, 3_900_000], [4_300_000, 3_800_000],
    [5_500_000, 3_700_000], [4_900_000, 4_000_000], [5_700_000, 4_200_000], [5_100_000, 3_900_000],
  ].map(([i, o], k) => ({ at: new Date(weekStartUtc(SAMPLE_NOW) - (7 - k) * 7 * 86_400_000 + 2 * 86_400_000).toISOString(), inMinor: i!, outMinor: o! })),
  SAMPLE_NOW,
);

/** Sample open invoices → the same ageing helper (board figures: 31,400 / 8,670 / 5,400 / 2,800). */
export const SAMPLE_AGEING: AgeingResult = ageingBuckets(
  [
    { balanceMinor: 2_140_000, dueAt: '2026-12-10T00:00:00Z' },
    { balanceMinor: 1_000_000, dueAt: '2026-11-15T00:00:00Z' },
    { balanceMinor: 867_000, dueAt: '2026-10-20T00:00:00Z' },
    { balanceMinor: 540_000, dueAt: '2026-09-15T00:00:00Z' },
    { balanceMinor: 280_000, dueAt: '2026-07-01T00:00:00Z' },
  ],
  SAMPLE_NOW,
);

export const SAMPLE_POOLS: PoolSoon[] = [
  { id: 'p45', code: '#P-0045', title: 'Water bottle', filled: 910, target: 1000, pct: 91, deadline: '2026-11-29T12:00:00Z' },
  { id: 'p42', code: '#P-0042', title: 'Foldable pet crate', filled: 640, target: 1000, pct: 64, deadline: '2026-12-02T12:00:00Z' },
  { id: 'p47', code: '#P-0047', title: 'Yoga mat', filled: 310, target: 1000, pct: 31, deadline: '2026-12-09T12:00:00Z' },
];

export const SAMPLE_ACTIVITY: ActivityItem[] = [
  { key: 'a1', at: iso(3), who: 'System', what: 'Checkout CO-2026-0153 paid from wallet · Anna Home Trading' },
  { key: 'a2', at: iso(35), who: 'Anna K.', what: 'Rfq Submitted — RFQ-1051' },
  { key: 'a3', at: iso(50), who: 'Li W.', what: 'Order In production → Qc passed' },
  { key: 'a4', at: iso(135), who: 'Priya S.', what: 'Finance · payment recorded — OCT-SRC-2026-0207' },
  { key: 'a5', at: iso(223), who: 'Ravi M.', what: 'Credit note drafted — CN-2026-0007' },
];

/* ───────── approvals ───────── */

export const APPROVAL_FIXTURE_STATES = [
  ['waiting', 'Waiting'],
  ['decided', 'Decided'],
  ['self', 'I requested it'],
  ['no-second-approver', 'Second approver needed'],
  ['step-up', '2-step code again'],
  ['deep-link', 'Deep link ?item='],
  ['unavailable', 'Not switched on'],
  ['no-finance', 'Not Finance'],
  ['error', 'Failed'],
] as const;
export type ApprovalFixtureState = (typeof APPROVAL_FIXTURE_STATES)[number][0];

const base = { orgId: null, refType: null, refId: null, requestedBy: 'u-ravi', decidedBy: null, decidedByName: null, decidedAt: null } as const;

export const SAMPLE_APPROVALS: ApprovalItem[] = [
  { ...base, source: 'staff_approvals', id: 'apr-1', code: 'APR-00012', kind: 'payment', status: 'waiting', amountMinor: 287_000, currency: 'USD', reason: 'Balance payment OCT-SRC-2026-0207, bank ref FT2611270042', orgName: 'Anna Home Trading', requestedByName: 'Ravi M.', requestedAt: iso(14), canDecide: true, mine: false },
  { ...base, source: 'staff_approvals', id: 'apr-2', code: 'APR-00011', kind: 'credit_note', status: 'waiting', amountMinor: 42_000, currency: 'USD', reason: 'Credit note CN-2026-0007 for 3 damaged units', orgName: 'Riyadh Living Co.', requestedByName: 'Ravi M.', requestedAt: iso(223), canDecide: true, mine: false },
  { ...base, source: 'finance_approvals', id: 'fa-1', code: null, kind: 'payout', status: 'waiting', amountMinor: 115_000, currency: 'USD', reason: 'Deposit for RFQ-1042 production', orgName: null, refType: 'supplier', refId: 'b2a1c3d4-0000-4000-8000-000000000001', requestedBy: 'u-li', requestedByName: 'Li W.', requestedAt: iso(275), canDecide: true, mine: false },
];

/** "self": the signed-in sample person recorded the first item → no Approve / Reject for them. */
export const SAMPLE_APPROVALS_SELF: ApprovalItem[] = SAMPLE_APPROVALS.map((a, i) => (i === 0 ? { ...a, requestedBy: 'sample-staff', requestedByName: 'Priya Shah', canDecide: false, mine: true } : a));

export const SAMPLE_APPROVALS_DECIDED: ApprovalItem[] = [
  { ...base, source: 'staff_approvals', id: 'apr-9', code: 'APR-00009', kind: 'refund', status: 'approved', amountMinor: 310_000, currency: 'USD', reason: 'Refund for cancelled order OCT-SRC-2026-0188', orgName: 'Casa Verde SA', requestedByName: 'Ravi M.', requestedAt: iso(3000), decidedBy: 'sample-staff', decidedByName: 'Priya Shah', decidedAt: iso(2900), canDecide: false, mine: false },
  { ...base, source: 'escrow_hold_approvals', id: 'esc-3', code: null, kind: 'escrow_release', status: 'rejected', amountMinor: 640_000, currency: 'USD', reason: 'Release to supplier after QC', orgName: 'Nordic Living AB', refType: 'escrow_hold', refId: '9f8e7d6c-0000-4000-8000-000000000003', requestedByName: 'Li W.', requestedAt: iso(5000), decidedBy: 'u-ash', decidedByName: 'Ashif A.', decidedAt: iso(4800), canDecide: false, mine: false },
  { ...base, source: 'customer_credit_terms', id: 'cct-2', code: null, kind: 'pay_later', status: 'approved', amountMinor: 2_000_000, currency: 'USD', reason: 'Pay-later credit limit · 30 days', orgName: 'Gulf Home Supplies LLC', refType: 'organization', refId: 'org-gulf', requestedByName: 'Omar K.', requestedAt: iso(9000), decidedBy: 'sample-staff', decidedByName: 'Priya Shah', decidedAt: iso(8800), canDecide: false, mine: false },
];
