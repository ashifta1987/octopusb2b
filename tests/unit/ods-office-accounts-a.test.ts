import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  approvalStage, byCurrencyText, customerReceivables, divisionMonths, divisionTotals, gmvByMonth, ledgerBalanced, monthOptions, partsText, receivableAge,
  receivableRows, refundShare, reportMonths, sinceOf, totalsOf, validMonth, type DivisionRow,
} from '../../app/ods/office/_lib/accounts-a-core';
import { buildOfficeNav, currentNavId, type OfficePerms } from '../../app/ods/office/_lib/nav';

const NOW = Date.UTC(2026, 10, 27, 18, 45);
const day = 86_400_000;
const toPlat = (m: number, c: string) => (c === 'CNY' ? Math.round(m / 7.1) : m);

describe('ODS T9 accounts A · totals per currency (today’s sumByCurrency + convertedTotal)', () => {
  it('keeps currencies apart, converts the total, flags mixed', () => {
    const t = totalsOf([{ a: 100, c: 'USD' }, { a: 710, c: 'CNY' }, { a: 50, c: 'USD' }, { a: 5, c: null }], (r) => r.a, (r) => r.c, toPlat, 'USD');
    expect(t.parts).toEqual([{ currency: 'USD', minor: 155 }, { currency: 'CNY', minor: 710 }]);
    expect(t.convMinor).toBe(255);
    expect(t.mixed).toBe(true);
    expect(partsText(t)).toBe('US$ 1.55 · CN¥ 7.10');
    expect(partsText({ parts: [] })).toBe('US$ 0.00');
    expect(totalsOf([{ a: 1 }], (r) => r.a, () => 'USD', toPlat, 'USD').mixed).toBe(false);
  });
  it('finance helpers: month, stage, refund share, ledger', () => {
    expect(validMonth('2026-10', '2026-11-27T00:00:00Z')).toBe('2026-10');
    expect(validMonth('bad', '2026-11-27T00:00:00Z')).toBe('2026-11');
    expect(monthOptions('2026-11-27T00:00:00Z', '2026-09', ['2026-10-01', '2026-11-01', 'x'])).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(approvalStage(250_001, 'USD', 7.1, 250_000)).toBe('Needs Admin');
    expect(approvalStage(250_000, 'USD', 7.1, 250_000)).toBe('Needs Finance');
    expect(approvalStage(1_775_000, 'CNY', 7.1, 250_000)).toBe('Needs Finance'); // 250,000 USD minor
    expect(approvalStage(1_775_100, 'CNY', 7.1, 250_000)).toBe('Needs Admin');
    expect(refundShare(312, 8240)).toBe('3.8% of revenue');
    expect(refundShare(5, 0)).toBe('—');
    expect(ledgerBalanced({ total_debit: 10, total_credit: 10, unbalanced_journals: 0 })).toBe(true);
    expect(ledgerBalanced({ total_debit: 10, total_credit: 9, unbalanced_journals: 0 })).toBe(false);
    expect(ledgerBalanced({ total_debit: 10, total_credit: 10, unbalanced_journals: 1 })).toBe(false);
  });
});

describe('ODS T9 accounts A · receivables (same mapping as today’s page)', () => {
  const doc = (n: string, org: string, amount: number, paid: number, due: number | null, currency = 'USD') => ({
    id: n, number: n, org_id: `org-${org}`, amount_cents: amount, paid_cents: paid, currency, due_at: due == null ? null : new Date(NOW - due * day).toISOString(),
    payment_option: null, last_reminder_stage: null, created_at: '2026-01-01T00:00:00Z', organizations: { name: org }, divisions: [{ code: 'DS' }],
  });
  const { rows, buckets } = receivableRows([
    doc('A', 'Anna', 1000, 0, -5), doc('B', 'Anna', 1000, 400, 1), doc('C', 'Riyadh', 500, 0, 31), doc('D', 'Nordic', 300, 0, 61),
    doc('E', 'Casa', 200, 0, 91), doc('F', 'Paid', 100, 100, 10), doc('G', 'Anna', 710, 0, null, 'CNY'),
  ], NOW);
  it('buckets current / 1–30 / 31–60 / 61–90 / 90+ and drops paid rows', () => {
    expect(rows.map((r) => r.number)).toEqual(['A', 'B', 'C', 'D', 'E', 'G']);
    expect(buckets).toEqual({ current: 1710, '1_30': 600, '31_60': 500, '61_90': 300, '90_plus': 200 });
    expect(rows.find((r) => r.number === 'B')).toMatchObject({ balanceMinor: 600, daysOverdue: 1, bucket: '1_30', divisionCode: 'DS', orgName: 'Anna' });
    expect(rows.find((r) => r.number === 'G')).toMatchObject({ daysOverdue: 0, bucket: 'current', currency: 'CNY' });
  });
  it('age words and tone', () => {
    expect(receivableAge(0)).toEqual({ label: 'Current', tone: 'success' });
    expect(receivableAge(12)).toEqual({ label: '12d overdue', tone: 'warning' });
    expect(receivableAge(31).tone).toBe('danger');
  });
  it('customer drill-down: oldest first, balance and overdue per currency, by bucket', () => {
    const c = customerReceivables(rows, { orgId: 'org-Anna', orgName: 'Anna' }, toPlat, 'USD');
    expect(c.invoices.map((r) => r.number)).toEqual(['B', 'G', 'A']);
    expect(c.balance.parts).toEqual([{ currency: 'USD', minor: 1600 }, { currency: 'CNY', minor: 710 }]);
    expect(c.balance.convMinor).toBe(1700);
    expect(c.overdue.parts).toEqual([{ currency: 'USD', minor: 600 }]);
    expect(c.oldestDays).toBe(1);
    expect(c.byBucket['1_30'].parts).toEqual([{ currency: 'USD', minor: 600 }]);
    expect(c.byBucket.current.parts).toEqual([{ currency: 'USD', minor: 1000 }, { currency: 'CNY', minor: 710 }]);
    expect(customerReceivables(rows, { orgId: null, orgName: 'Casa' }).invoices).toHaveLength(1);
  });
});

describe('ODS T9 accounts A · reports', () => {
  it('period params as today', () => {
    expect([reportMonths('3'), reportMonths('12'), reportMonths(undefined), reportMonths('x')]).toEqual([3, 12, 6, 6]);
    expect([divisionMonths('all'), divisionMonths('3'), divisionMonths(undefined)]).toEqual([0, 3, 6]);
    expect(sinceOf(NOW, 6).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(sinceOf(NOW, 1).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
  it('GMV by month: every month of the window, converted, outside ignored', () => {
    const g = gmvByMonth(
      [{ created_at: '2026-11-03T00:00:00Z', total_cents: 100, currency: 'USD' }, { created_at: '2026-09-10T00:00:00Z', total_cents: 710, currency: 'CNY' }, { created_at: '2026-01-01T00:00:00Z', total_cents: 9, currency: 'USD' }],
      sinceOf(NOW, 3), 3, (m, c) => toPlat(m, c ?? 'USD'),
    );
    expect(g).toEqual([{ month: '2026-09', label: 'Sep', minor: 100 }, { month: '2026-10', label: 'Oct', minor: 0 }, { month: '2026-11', label: 'Nov', minor: 100 }]);
  });
  it('division totals add every line (today’s reduce); by-currency text skips zeros', () => {
    const r = (rev: number, ord: number, extra: Partial<DivisionRow> = {}) => ({
      line: 'division', division_code: 'X', division_name: 'X', sort_order: 0, revenue_by_currency: {}, revenue_converted_minor: rev, orders_count: ord,
      orders_by_currency: {}, orders_converted_minor: ord * 10, open_work: 1, open_detail: {}, pipeline_count: 1, pipeline_by_currency: {}, pipeline_converted_minor: 5,
      deposits_by_currency: {}, deposits_converted_minor: 2, ...extra,
    }) as DivisionRow;
    expect(divisionTotals([r(100, 2), r(50, 1, { line: 'advertising' })])).toEqual({ rev: 150, ord: 3, val: 30, work: 2, pipe: 10, pipeN: 2, dep: 4 });
    expect(byCurrencyText({ USD: 120000, CNY: 0, EUR: 5 })).toBe('US$ 1,200.00 + EUR 0.05');
  });
});

describe('ODS T9 accounts A · nav + static', () => {
  const perms = (p: Partial<OfficePerms>): OfficePerms => ({
    isAdmin: false, roles: [], permissions: [], canOpenDropship: false, canSeeRates: false, canSeeFeesDuty: false, canEditDropship: false,
    canSeeSaas: false, warehouseMember: false, dropshipV2Ui: false, ...p,
  });
  it('Accounts: Invoices, Payments, Credit notes, Ledger first — finance:view only', () => {
    const acc = buildOfficeNav(perms({ permissions: ['finance:view'] })).groups.find((g) => g.id === 'accounts')!;
    expect(acc.items.slice(0, 4).map((i) => [i.id, i.href, i.hidden])).toEqual([
      ['invoices', '/office/accounts/invoices', false], ['payments', '/office/accounts/payments', false],
      ['credit-notes', '/office/accounts/credit-notes', false], ['ledger', '/office/accounts/ledger', false],
    ]);
    const sales = buildOfficeNav(perms({ permissions: ['requests:view'] })).groups.find((g) => g.id === 'accounts')!;
    expect(sales.items.filter((i) => ['payments', 'credit-notes', 'ledger'].includes(i.id)).every((i) => i.hidden)).toBe(true);
    expect(currentNavId('/office/accounts/ledger')).toBe('ledger');
    expect(currentNavId('/admin/finance')).toBe('finance');
    expect(currentNavId('/admin/reports/divisions')).toBe('division-reports');
  });
  it('the four ODS pages are marked ODS T9, keep today’s guards and call today’s actions', () => {
    const root = join(__dirname, '../..');
    const src = (p: string) => readFileSync(join(root, p), 'utf8');
    const fin = src('app/ods/admin/finance/page.tsx');
    expect(fin.startsWith('// ODS T9')).toBe(true);
    expect(fin).toContain("requireStaff('finance', 'view', '/admin/finance')");
    expect(fin).toContain("from '@/app/admin/finance/actions'");
    const rec = src('app/ods/admin/finance/receivables/page.tsx');
    expect(rec.startsWith('// ODS T9')).toBe(true);
    expect(rec).toContain("requireStaff('finance', 'view', '/admin/finance/receivables')");
    expect(rec).toContain("from '@/app/admin/finance/receivables/actions'");
    const rep = src('app/ods/admin/reports/page.tsx');
    expect(rep.startsWith('// ODS T9')).toBe(true);
    expect(rep).toContain("requireStaff('dashboard', 'view', '/admin/reports')");
    expect(rep).toContain("from '@/app/admin/actions'");
    const div = src('app/ods/admin/reports/divisions/page.tsx');
    expect(div.startsWith('// ODS T9')).toBe(true);
    expect(div).toContain("requireStaff('dashboard', 'view', '/admin/reports/divisions')");
    for (const f of ['office-finance', 'office-receivables', 'office-reports']) expect(existsSync(join(root, 'app/dev/ui/screens', f, 'page.tsx')), f).toBe(true);
  });
});
