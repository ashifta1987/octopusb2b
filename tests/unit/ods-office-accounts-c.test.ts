import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APPROVAL_DB,
  CREDIT_SPEC,
  LEDGER_SPEC,
  PAYMENTS_SPEC,
  PAYMENT_DB,
  accountLabel,
  applyListConditions,
  approvalName,
  commonChips,
  creditNoteName,
  dateBounds,
  debitNormal,
  exportMonth,
  journalTotals,
  lineMovement,
  listQueryFromView,
  listQueryHref,
  listViewFilters,
  parseListQuery,
  paymentName,
  refHref,
  requestNumber,
  runningBalances,
  safeSearch,
} from '@/app/ods/office/accounts/_shared/accounts-core';

describe('status names (Appendix C)', () => {
  it('finance_approvals.status → Waiting / Approved / Rejected, and the tab filters cover every value once', () => {
    expect(approvalName('requested')).toBe('Waiting');
    expect(approvalName('approved')).toBe('Approved');
    expect(approvalName('executed')).toBe('Approved');
    expect(approvalName('rejected')).toBe('Rejected');
    const all = Object.values(APPROVAL_DB).flat().sort();
    expect(all).toEqual(['approved', 'executed', 'rejected', 'requested']);
    for (const [tab, vals] of Object.entries(APPROVAL_DB)) for (const v of vals) expect(approvalName(v).toLowerCase()).toBe(tab);
  });
  it('payments.status → Pending / Paid / Failed / Refunded, and the status filter covers every enum value once', () => {
    const all = Object.values(PAYMENT_DB).flat().sort();
    expect(all).toEqual(['confirmed', 'failed', 'initiated', 'matched', 'pending', 'refunded']);
    for (const [key, vals] of Object.entries(PAYMENT_DB)) for (const v of vals) expect(paymentName(v).toLowerCase()).toBe(key);
  });
  it('credit note documents', () => {
    expect(creditNoteName('issued')).toBe('Credit note');
    expect(creditNoteName('void')).toBe('Cancelled');
    expect(creditNoteName('cancelled')).toBe('Cancelled');
    expect(requestNumber('1a2b3c4d-0000-4000-8000-000000000000')).toBe('FA-1A2B3C4D');
  });
});

describe('ledger maths', () => {
  it('normal side: assets / expenses debit, the rest credit', () => {
    expect(debitNormal('asset')).toBe(true);
    expect(debitNormal('expense')).toBe(true);
    for (const k of ['liability', 'revenue', 'equity']) expect(debitNormal(k)).toBe(false);
    expect(lineMovement('asset', 100, 0)).toBe(100);
    expect(lineMovement('liability', 100, 0)).toBe(-100);
  });
  it('running balance per account follows the ledger order', () => {
    const m = runningBalances('asset', [
      { id: 1, debit: 1000, credit: 0 },
      { id: 2, debit: 0, credit: 300 },
      { id: 3, debit: 50, credit: 0 },
    ]);
    expect([...m.values()]).toEqual([1000, 700, 750]);
    const w = runningBalances('liability', [
      { id: 'a', debit: 0, credit: 500 },
      { id: 'b', debit: 200, credit: 0 },
    ]);
    expect(w.get('b')).toBe(300);
  });
  it('journal totals per currency and the balanced check', () => {
    expect(journalTotals([{ debit: 100, credit: 0, currency: 'USD' }, { debit: 0, credit: 100, currency: 'USD' }, { debit: 5, credit: 0, currency: 'CNY' }])).toEqual([
      { currency: 'USD', debit: 100, credit: 100, balanced: true },
      { currency: 'CNY', debit: 5, credit: 0, balanced: false },
    ]);
  });
  it('account labels name the customer for customer accounts', () => {
    expect(accountLabel('wallet:abc', 'Wallet abc', 'Petsy Store')).toBe('Wallet · Petsy Store');
    expect(accountLabel('ar:abc:CNY', null, 'Petsy Store')).toBe('Receivable · Petsy Store (CNY)');
    expect(accountLabel('cash:bank', 'Bank')).toBe('cash:bank · Bank');
    expect(accountLabel('rev:orders', 'rev:orders')).toBe('rev:orders');
  });
  it('journal references open today’s pages', () => {
    expect(refHref('order', 'o1')).toBe('/office/orders/o1');
    expect(refHref('document', 'd1')).toBe('/office/accounts/invoices?open=d1');
    expect(refHref('payment', 'p1')).toBe('/office/accounts/payments?open=p1');
    expect(refHref('wallet_hold', 'x')).toBeNull();
    expect(refHref(null, 'x')).toBeNull();
  });
});

describe('URL state, filters, views', () => {
  it('parses and writes tab / q / filters / sort / page / size / open per screen', () => {
    const q = parseListQuery({ tab: 'revenue', q: 'JRN', account: '00000000-0000-4000-9000-000000000201', from: '2026-11-01', to: 'bad', sort: '-debit', page: '2', size: '100', open: 'j-00000000-0000-4000-9000-000000000312' }, LEDGER_SPEC);
    expect(q).toMatchObject({ tab: 'revenue', q: 'JRN', f: { account: '00000000-0000-4000-9000-000000000201', from: '2026-11-01' }, sort: { id: 'debit', desc: true }, page: 1, size: 100, open: 'j-00000000-0000-4000-9000-000000000312' });
    expect(listQueryHref('/office/accounts/ledger', q, LEDGER_SPEC)).toBe('/office/accounts/ledger?tab=revenue&q=JRN&account=00000000-0000-4000-9000-000000000201&from=2026-11-01&sort=-debit&page=2&size=100&open=j-00000000-0000-4000-9000-000000000312');
    expect(listQueryHref('/x', parseListQuery({}, PAYMENTS_SPEC), PAYMENTS_SPEC, { state: 'list' })).toBe('/x?state=list');
    expect(parseListQuery({ tab: 'nope', status: 'weird', sort: 'customer' }, PAYMENTS_SPEC)).toMatchObject({ tab: 'payments', f: {}, sort: { id: 'date', desc: true } });
    expect(parseListQuery({ status: 'pending', purpose: 'topup' }, PAYMENTS_SPEC).f).toEqual({ status: 'pending', purpose: 'topup' });
    expect(parseListQuery({ tab: 'waiting' }, CREDIT_SPEC).tab).toBe('waiting');
  });
  it('dates: inclusive To, export month', () => {
    expect(dateBounds('2026-11-01', '2026-11-30')).toEqual({ gte: '2026-11-01T00:00:00.000Z', lt: '2026-12-01T00:00:00.000Z' });
    expect(dateBounds('x', undefined)).toEqual({ gte: null, lt: null });
    expect(exportMonth('2026-10-05', Date.parse('2026-11-27T00:00:00Z'))).toBe('2026-10');
    expect(exportMonth(undefined, Date.parse('2026-11-27T00:00:00Z'))).toBe('2026-11');
  });
  it('advanced filter conditions and chips', () => {
    const q = applyListConditions(parseListQuery({}, PAYMENTS_SPEC), PAYMENTS_SPEC, [
      { field: 'status', operator: 'is', value: 'Pending' },
      { field: 'date', operator: 'is after', value: '2026-11-01' },
      { field: 'customer', operator: 'contains', value: 'Anna' },
      { field: 'purpose', operator: 'is not', value: 'Deposit' },
    ], { status: { Pending: 'pending' } });
    expect(q.f).toEqual({ status: 'pending', from: '2026-11-01', customer: 'Anna' });
    expect(commonChips(q, { status: (v) => `Status: ${v}` }).map((c) => c.label)).toEqual(['Status: pending', 'From 2026-11-01', 'Customer: Anna']);
  });
  it('saved view filters round-trip', () => {
    const q = parseListQuery({ tab: 'proformas', from: '2026-11-01', sort: 'amount' }, PAYMENTS_SPEC);
    expect(listQueryFromView(listViewFilters(q), PAYMENTS_SPEC, 'v1')).toMatchObject({ tab: 'proformas', f: { from: '2026-11-01' }, sort: { id: 'amount', desc: false }, view: 'v1' });
  });
  it('search text is safe inside PostgREST filters', () => {
    expect(safeSearch('a,b(c)*%')).toBe('a b c');
  });
});

describe('static guards', () => {
  const root = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  const pages = ['credit-notes', 'ledger', 'payments'];
  it.each(pages)('%s: ODS T9 page behind today’s Finance guard', (p) => {
    const src = read(`app/ods/office/accounts/${p}/page.tsx`);
    expect(src.startsWith('// ODS T9')).toBe(true);
    expect(src).toContain("requireStaff('finance', 'view'");
  });
  it('read-only: no writes or RPCs in the loaders and actions', () => {
    for (const f of ['credit-notes/_lib/data.ts', 'ledger/_lib/data.ts', 'payments/_lib/data.ts', '_shared/accounts-server.ts', '_shared/actions.ts']) {
      const src = read(`app/ods/office/accounts/${f}`);
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    }
  });
  it('export only through today’s finance export route, behind finance:export', () => {
    for (const p of ['ledger', 'payments']) expect(read(`app/ods/office/accounts/${p}/page.tsx`)).toContain("can(s, 'finance', 'export')");
    expect(read('app/ods/office/accounts/credit-notes/_components/credit-notes-screen.tsx')).not.toContain('exportItems');
  });
  it('switch off → 404: today has no /office/accounts pages', () => {
    expect(existsSync(join(root, 'app/office/accounts'))).toBe(false);
  });
});
