import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ageingBucketFor, ageingBuckets, approvalCardState, approvalHref, approvalKindLabel, chartScale, chartValueText, dashboardWidgets, daysOverdue,
  firstNameOf, greetingFor, hiddenWidgetsFrom, kpiKindFor, niceMax, rejectReasonError, secondApproverText, weekStartUtc, weeklyMoney,
  wholePercents, workStatus, SELF_APPROVAL_NOTE,
} from '../../app/ods/office/_lib/dashboard-core';
import { buildOfficeNav, currentNavId, currentSidebarId, gotoItems, phoneNavCurrent, PHONE_APPROVALS_HREF, type OfficePerms } from '../../app/ods/office/_lib/nav';

const NOW = Date.UTC(2026, 10, 27, 18, 45); // Fri 27 Nov 2026
const day = 86_400_000;
const perms = (p: Partial<OfficePerms>): OfficePerms => ({
  isAdmin: false, roles: [], permissions: [], canOpenDropship: false, canSeeRates: false, canSeeFeesDuty: false, canEditDropship: false,
  canSeeSaas: false, warehouseMember: false, dropshipV2Ui: false, ...p,
});

describe('ODS T9 dashboard · receivables ageing (same thresholds as today’s Receivables page)', () => {
  it('days overdue = floor((now − due) / 1 day); no due date = not due', () => {
    expect(daysOverdue(new Date(NOW - 10 * day).toISOString(), NOW)).toBe(10);
    expect(daysOverdue(new Date(NOW + 3 * day).toISOString(), NOW)).toBeLessThan(0);
    expect(daysOverdue(null, NOW)).toBe(0);
  });
  it('buckets at > 30 / > 60 / > 90; 0–30 holds current + 1–30', () => {
    expect([-5, 0, 1, 30].map(ageingBucketFor)).toEqual(['0_30', '0_30', '0_30', '0_30']);
    expect([31, 60].map(ageingBucketFor)).toEqual(['31_60', '31_60']);
    expect([61, 90].map(ageingBucketFor)).toEqual(['61_90', '61_90']);
    expect(ageingBucketFor(91)).toBe('90_plus');
  });
  it('sums balances, skips paid rows, converts, and percentages add up to 100', () => {
    const r = ageingBuckets(
      [
        { balanceMinor: 2_140_000, dueAt: new Date(NOW + 13 * day).toISOString() },
        { balanceMinor: 1_000_000, dueAt: new Date(NOW - 12 * day).toISOString() },
        { balanceMinor: 867_000, dueAt: new Date(NOW - 38 * day).toISOString() },
        { balanceMinor: 540_000, dueAt: new Date(NOW - 73 * day).toISOString() },
        { balanceMinor: 280_000, dueAt: new Date(NOW - 149 * day).toISOString() },
        { balanceMinor: 0, dueAt: new Date(NOW - 200 * day).toISOString() },
      ],
      NOW,
    );
    expect(r.buckets.map((b) => b.amountMinor)).toEqual([3_140_000, 867_000, 540_000, 280_000]);
    expect(r.buckets.map((b) => b.pct)).toEqual([65, 18, 11, 6]);
    expect(r.buckets.reduce((a, b) => a + b.pct, 0)).toBe(100);
    expect(r.totalMinor).toBe(4_827_000);
    expect(r.notDueMinor).toBe(2_140_000);
    expect(r.overdueMinor).toBe(4_827_000 - 2_140_000);
    expect(r.count).toBe(5);
    const cny = ageingBuckets([{ balanceMinor: 710, dueAt: null, currency: 'CNY' }], NOW, (m, c) => (c === 'CNY' ? Math.round(m / 7.1) : m));
    expect(cny.totalMinor).toBe(100);
  });
  it('whole percents: zeros when empty; largest remainder otherwise', () => {
    expect(wholePercents([0, 0])).toEqual([0, 0]);
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
  });
});

describe('ODS T9 dashboard · money in and out (8 weeks)', () => {
  it('weeks start on Monday (UTC); labels follow the board', () => {
    expect(new Date(weekStartUtc(NOW)).toISOString().slice(0, 10)).toBe('2026-11-23');
    const w = weeklyMoney([], NOW);
    expect(w).toHaveLength(8);
    expect(w.map((x) => x.label)).toEqual(['5 Oct', '12', '19', '26', '2 Nov', '9', '16', '23']);
  });
  it('sums debits (in) and credits (out) into their week; outside the window is ignored', () => {
    const w = weeklyMoney(
      [
        { at: '2026-11-24T10:00:00Z', inMinor: 500, outMinor: 100 },
        { at: '2026-11-26T10:00:00Z', inMinor: 250, outMinor: 0 },
        { at: '2026-10-05T00:00:00Z', inMinor: 1, outMinor: 2 },
        { at: '2026-10-04T23:59:59Z', inMinor: 999, outMinor: 999 },
        { at: '2026-12-01T00:00:00Z', inMinor: 999, outMinor: 999 },
        { at: '2026-11-25T00:00:00Z', inMinor: 710, outMinor: 0, currency: 'CNY' },
      ],
      NOW,
      8,
      (m, c) => (c === 'CNY' ? Math.round(m / 7.1) : m),
    );
    expect(w[7]).toMatchObject({ inMinor: 850, outMinor: 100 });
    expect(w[0]).toMatchObject({ inMinor: 1, outMinor: 2 });
    expect(w.slice(1, 7).every((x) => x.inMinor === 0 && x.outMinor === 0)).toBe(true);
  });
  it('nice axis + bar heights; unit text', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(57_000)).toBe(100_000);
    expect(niceMax(42_000)).toBe(50_000);
    expect(niceMax(2_300)).toBe(2_500);
    const s = chartScale([{ start: '2026-11-23', label: '23', inMinor: 5_000_000, outMinor: 2_500_000 }]);
    expect(s.maxMajor).toBe(50_000);
    expect(s.bars[0]).toEqual({ inPct: 100, outPct: 50 });
    expect(s.ticks).toEqual([0, 12_500, 25_000, 37_500, 50_000]);
    expect(chartValueText(12_400, 'thousands')).toBe('US$ 12.4k');
    expect(chartValueText(12_400, 'units')).toBe('US$ 12,400');
  });
});

describe('ODS T9 dashboard · widgets, greeting, my work', () => {
  it('widgets by permission (finance / sales / account manager)', () => {
    const finance = perms({ permissions: ['dashboard:view', 'finance:view', 'orders:view'] });
    const sales = perms({ permissions: ['dashboard:view', 'requests:view', 'orders:view'] });
    const bare = perms({ permissions: ['dashboard:view'] });
    expect(dashboardWidgets(finance)).toEqual(['kpis', 'my-work', 'money', 'ageing', 'pools', 'activity']);
    expect(dashboardWidgets(sales)).toEqual(['kpis', 'my-work', 'pools', 'activity']);
    expect(dashboardWidgets(bare)).toEqual(['my-work', 'activity']);
    expect(dashboardWidgets(perms({ isAdmin: true }))).toEqual(['kpis', 'my-work', 'money', 'ageing', 'pools', 'activity']);
    expect(kpiKindFor(finance)).toBe('finance');
    expect(kpiKindFor(sales)).toBe('sales');
    expect(kpiKindFor(bare)).toBeNull();
  });
  it('Customise: only known widget ids survive', () => {
    expect(hiddenWidgetsFrom({ dashboardHidden: ['money', 'nope', 'money', 3] })).toEqual(['money']);
    expect(hiddenWidgetsFrom({})).toEqual([]);
    expect(hiddenWidgetsFrom(null)).toEqual([]);
  });
  it('greeting by local hour; first name', () => {
    expect(greetingFor(null)).toBe('Hello');
    expect(greetingFor(8)).toBe('Good morning');
    expect(greetingFor(14)).toBe('Good afternoon');
    expect(greetingFor(19)).toBe('Good evening');
    expect(greetingFor(2)).toBe('Good evening');
    expect(firstNameOf('Priya Shah')).toBe('Priya');
    expect(firstNameOf('priya@example.com')).toBe('priya');
    expect(firstNameOf(null)).toBe('');
  });
  it('work status words (never colour alone)', () => {
    expect(workStatus({ key: 'rq-1', late: true, owner: false, dueLabel: '1 Dec' })).toEqual({ label: 'Overdue', tone: 'danger' });
    expect(workStatus({ key: 'ap-1', late: false, owner: true, dueLabel: 'Waiting' }).label).toBe('Needs owner');
    expect(workStatus({ key: 'ap-1', late: false, owner: false, dueLabel: 'Waiting' }).label).toBe('Waiting');
    expect(workStatus({ key: 'tt-1', late: false, owner: false, dueLabel: 'Today' }).label).toBe('To check');
    expect(workStatus({ key: 'rq-1', late: false, owner: false, dueLabel: 'No deadline' }).label).toBe('Open');
  });
});

describe('ODS T9 approvals · card state (Part 7.7 two-person)', () => {
  it('only a waiting item the database lets me decide can be acted on', () => {
    expect(approvalCardState({ status: 'waiting', canDecide: true, mine: false })).toEqual({ canAct: true, note: null, statusLabel: 'Waiting', tone: 'warning' });
    expect(approvalCardState({ status: 'waiting', canDecide: false, mine: true })).toMatchObject({ canAct: false, note: 'self' });
    // even if a stale row said canDecide, my own request is never decidable here
    expect(approvalCardState({ status: 'waiting', canDecide: true, mine: true })).toMatchObject({ canAct: false, note: 'self' });
    expect(approvalCardState({ status: 'waiting', canDecide: false, mine: false })).toMatchObject({ canAct: false, note: 'not-approver' });
    expect(approvalCardState({ status: 'approved', canDecide: true, mine: false })).toEqual({ canAct: false, note: null, statusLabel: 'Approved', tone: 'success' });
    expect(approvalCardState({ status: 'rejected', canDecide: false, mine: false })).toMatchObject({ statusLabel: 'Rejected', tone: 'danger' });
    expect(SELF_APPROVAL_NOTE).toBe('You requested this — another Finance user must decide.');
  });
  it('reject needs a reason (≥ 3 characters, like decideApproval)', () => {
    expect(rejectReasonError('')).not.toBeNull();
    expect(rejectReasonError('  no ')).not.toBeNull();
    expect(rejectReasonError('Wrong amount')).toBeNull();
  });
  it('kind labels per source', () => {
    expect(approvalKindLabel({ source: 'staff_approvals', kind: 'credit_note' })).toBe('Credit note');
    expect(approvalKindLabel({ source: 'finance_approvals', kind: 'payout' })).toBe('Supplier payment');
    expect(approvalKindLabel({ source: 'escrow_hold_approvals', kind: 'escrow_release' })).toBe('Release held payment');
    expect(approvalKindLabel({ source: 'escrow_hold_approvals', kind: 'escrow_refund' })).toBe('Refund held payment');
    expect(approvalKindLabel({ source: 'customer_credit_terms', kind: 'pay_later' })).toBe('Credit terms');
    expect(approvalKindLabel({ source: 'finance_approvals', kind: 'write_off_bad_debt' })).toBe('Write off bad debt');
  });
  it('second-approver banner text + deep link', () => {
    expect(secondApproverText(1)).toMatch(/Only 1 person .* owner must add a second Finance user/);
    expect(secondApproverText(0)).toMatch(/^Nobody/);
    expect(approvalHref('a b')).toBe('/office/approvals?item=a%20b');
  });
});

describe('ODS T9 nav (Dashboard · My work · Approvals · Accounts › Invoices)', () => {
  const finance = perms({ permissions: ['dashboard:view', 'finance:view', 'finance:approve'] });
  const manager = perms({ roles: ['account_manager'], permissions: ['customers:view'] });
  const support = perms({ permissions: ['dashboard:view', 'support:view'] });
  it('My work → /office/my-work; /admin (today’s Work queue) still marks it current', () => {
    const n = buildOfficeNav(finance);
    expect(n.top.find((i) => i.id === 'my-work')?.href).toBe('/office/my-work');
    expect(currentNavId('/office/my-work')).toBe('my-work');
    expect(currentNavId('/admin')).toBe('my-work');
    expect(currentNavId('/office')).toBe('dashboard');
    // people without dashboard:view: Dashboard IS /admin (unchanged rule) and My work is hidden
    expect(buildOfficeNav(manager).top.find((i) => i.id === 'my-work')?.hidden).toBe(true);
    expect(currentSidebarId('/admin', manager)).toBe('dashboard');
  });
  it('Approvals → /office/approvals for Finance or today’s approvals rule; /admin/approvals stays current', () => {
    expect(buildOfficeNav(finance).top.find((i) => i.id === 'approvals')).toMatchObject({ href: '/office/approvals', hidden: false });
    expect(buildOfficeNav(manager).top.find((i) => i.id === 'approvals')?.hidden).toBe(false);
    expect(buildOfficeNav(perms({ permissions: ['approvals:view'] })).top.find((i) => i.id === 'approvals')?.hidden).toBe(false);
    expect(buildOfficeNav(support).top.find((i) => i.id === 'approvals')?.hidden).toBe(true);
    expect(currentNavId('/office/approvals')).toBe('approvals');
    expect(currentNavId('/admin/approvals')).toBe('approvals');
    expect(PHONE_APPROVALS_HREF).toBe('/office/approvals');
    expect(phoneNavCurrent('/office/approvals')).toBe('approvals');
  });
  it('Accounts › Invoices first, Finance viewers only, offered in the palette', () => {
    const accounts = buildOfficeNav(finance).groups.find((g) => g.id === 'accounts')!;
    expect(accounts.items[0]).toMatchObject({ id: 'invoices', href: '/office/accounts/invoices', hidden: false });
    expect(buildOfficeNav(support).groups.find((g) => g.id === 'accounts')!.items.find((i) => i.id === 'invoices')?.hidden).toBe(true);
    expect(gotoItems(finance).some((i) => i.id === 'invoices')).toBe(true);
    expect(currentNavId('/office/accounts/invoices')).toBe('invoices');
  });
});

describe('ODS T9 screens · static checks', () => {
  const root = join(__dirname, '../..');
  const src = (p: string) => readFileSync(join(root, p), 'utf8');
  it('the ODS pages are marked ODS T9 and keep today’s guards', () => {
    const dash = src('app/ods/office/page.tsx');
    expect(dash.startsWith('// ODS T9')).toBe(true);
    expect(dash).toContain("requireStaff('dashboard', 'view', '/office')");
    const work = src('app/ods/office/my-work/page.tsx');
    expect(work.startsWith('// ODS T9')).toBe(true);
    expect(work).toContain("requireStaffOrManager('/office/my-work', ['dashboard', 'view'], ['approvals', 'view'], ['wallet', 'approve'])");
    const appr = src('app/ods/office/approvals/page.tsx');
    expect(appr.startsWith('// ODS T9')).toBe(true);
    expect(appr).toContain("requireStaffOrManager('/office/approvals', ['finance', 'view'], ['approvals', 'view'])");
    expect(appr).toContain('decide={decideApprovalAction}');
  });
  it('/admin keeps today’s Work queue re-export', () => {
    const admin = join(root, 'app/ods/admin/page.tsx');
    if (existsSync(admin)) expect(readFileSync(admin, 'utf8')).toContain("from '@/app/admin/page'");
  });
  it('fixtures exist for every screen', () => {
    for (const f of ['office-dashboard', 'office-my-work', 'office-approvals']) expect(existsSync(join(root, 'app/dev/ui/screens', f, 'page.tsx')), f).toBe(true);
  });
});
