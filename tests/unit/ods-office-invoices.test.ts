import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ageingBucket,
  amountToMinor,
  applyConditions,
  daysOverdue,
  DEFAULT_QUERY,
  dueWithin,
  filterChips,
  INVOICE_TABS,
  invoiceFigures,
  invoiceQueryHref,
  invoiceStatus,
  isOpenStatus,
  matchesTab,
  parseInvoiceQuery,
  paymentTarget,
  queryFromView,
  receivableKpis,
  runTwoPersonPayment,
  safeSearch,
  secondApproverNote,
  tabFilter,
  validatePayment,
  viewFilters,
  type DocStatusInput,
  type GateResult,
  type TabFilterStep,
  type TwoPersonDeps,
} from '@/app/ods/office/accounts/invoices/_lib/invoice-core';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const NOW_ISO = new Date(NOW).toISOString();
const PAST = '2026-11-01T00:00:00Z';
const FUTURE = '2026-12-10T00:00:00Z';

describe('invoice status mapping (documents → Appendix C)', () => {
  const cases: [DocStatusInput, string][] = [
    [{ doc_type: 'credit_note', status: 'issued' }, 'Credit note'],
    [{ doc_type: 'credit_note', status: 'void' }, 'Credit note'],
    [{ doc_type: 'commercial_invoice', status: 'draft', due_at: PAST }, 'Draft'],
    [{ doc_type: 'commercial_invoice', status: 'paid', due_at: PAST }, 'Paid'],
    [{ doc_type: 'proforma_invoice', status: 'invoiced', paid_cents: 1000 }, 'Paid'],
    [{ doc_type: 'proforma_invoice', status: 'invoiced', paid_cents: 0, payment_option: 'pay_later' }, 'Cancelled'],
    [{ doc_type: 'proforma_invoice', status: 'invoiced', payment_option: 'payment_protection' }, 'Paid'],
    [{ doc_type: 'commercial_invoice', status: 'void' }, 'Cancelled'],
    [{ doc_type: 'commercial_invoice', status: 'cancelled' }, 'Cancelled'],
    [{ doc_type: 'proforma_invoice', status: 'superseded' }, 'Cancelled'],
    [{ doc_type: 'commercial_invoice', status: 'awaiting_payment', due_at: FUTURE }, 'Sent'],
    [{ doc_type: 'commercial_invoice', status: 'awaiting_payment', due_at: null }, 'Sent'],
    [{ doc_type: 'proforma_invoice', status: 'issued' }, 'Sent'],
    [{ doc_type: 'proforma_invoice', status: null }, 'Sent'],
    [{ doc_type: 'commercial_invoice', status: 'awaiting_payment', due_at: PAST }, 'Overdue'],
    [{ doc_type: 'proforma_invoice', status: 'part_paid', paid_cents: 500, due_at: FUTURE }, 'Partly paid'],
    [{ doc_type: 'commercial_invoice', status: 'awaiting_payment', paid_cents: 500, due_at: FUTURE }, 'Partly paid'],
    [{ doc_type: 'proforma_invoice', status: 'part_paid', paid_cents: 500, due_at: PAST }, 'Overdue'],
  ];
  it.each(cases)('%o → %s', (doc, name) => expect(invoiceStatus(doc, NOW)).toBe(name));

  it('open statuses are everything except the closed ones', () => {
    expect(isOpenStatus('awaiting_payment')).toBe(true);
    expect(isOpenStatus('part_paid')).toBe(true);
    expect(isOpenStatus(null)).toBe(true);
    for (const s of ['draft', 'paid', 'invoiced', 'void', 'cancelled', 'superseded']) expect(isOpenStatus(s)).toBe(false);
  });

  it('figures: paid shows the full amount once paid; closed rows have no balance; credit notes are negative', () => {
    expect(invoiceFigures(410000, 123000, 'Partly paid')).toEqual({ paid: 123000, balance: 287000 });
    expect(invoiceFigures(10000, 0, 'Paid')).toEqual({ paid: 10000, balance: 0 });
    expect(invoiceFigures(10000, 0, 'Cancelled')).toEqual({ paid: 0, balance: 0 });
    expect(invoiceFigures(42000, 0, 'Credit note')).toEqual({ paid: null, balance: -42000 });
    expect(invoiceFigures(1000, 1500, 'Sent').balance).toBe(0);
  });
});

/* A tiny evaluator of the PostgREST filter steps, with SQL null semantics (null never matches eq / neq / in / not in). */
type Doc = Record<string, string | number | null>;
function cmpTerm(doc: Doc, col: string, op: string, raw: string): boolean {
  const v = doc[col] ?? null;
  if (op === 'is') return raw === 'null' ? v === null : false;
  if (v === null) return false;
  const val: string | number = typeof v === 'number' ? Number(raw) : raw;
  switch (op) {
    case 'eq': return v === val;
    case 'neq': return v !== val;
    case 'gt': return v > val;
    case 'gte': return v >= val;
    case 'lt': return v < val;
    default: throw new Error(`op ${op}`);
  }
}
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function evalExpr(doc: Doc, term: string): boolean {
  const m = /^(and|or)\((.*)\)$/.exec(term);
  if (m) {
    const parts = splitTop(m[2]).map((t) => evalExpr(doc, t));
    return m[1] === 'and' ? parts.every(Boolean) : parts.some(Boolean);
  }
  const [col, op, ...rest] = term.split('.');
  return cmpTerm(doc, col, op, rest.join('.'));
}
function evalSteps(doc: Doc, steps: TabFilterStep[]): boolean {
  return steps.every((s) => {
    if (s.op === 'or') return splitTop(s.expr).some((t) => evalExpr(doc, t));
    const v = doc[s.col] ?? null;
    if (s.op === 'in') return v !== null && s.vals.includes(String(v));
    if (s.op === 'notIn') return v !== null && !s.vals.includes(String(v));
    return cmpTerm(doc, s.col, s.op, String(s.val));
  });
}

describe('tab filters (server-side) = the status mapping', () => {
  const statuses = ['draft', 'issued', 'awaiting_payment', 'sent', 'part_paid', 'paid', 'invoiced', 'void', 'cancelled', 'superseded'];
  const docs: Doc[] = [];
  for (const doc_type of ['proforma_invoice', 'commercial_invoice', 'credit_note'])
    for (const status of statuses)
      for (const paid_cents of [0, 500])
        for (const due_at of [null, PAST, FUTURE])
          for (const payment_option of [null, 'pay_later', 'pay_now']) docs.push({ doc_type, status, paid_cents, due_at, payment_option });

  it.each(INVOICE_TABS.map(([t]) => t))('tab %s selects exactly the rows whose status maps to it', (tab) => {
    for (const d of docs) {
      const name = invoiceStatus(d as unknown as DocStatusInput, NOW);
      expect(evalSteps(d, tabFilter(tab, NOW_ISO)), `${tab} ${JSON.stringify(d)} → ${name}`).toBe(matchesTab(name, tab));
    }
  });

  it('every listed document falls in exactly one status tab (besides All), except Cancelled which only All shows', () => {
    for (const d of docs) {
      const hits = INVOICE_TABS.filter(([t]) => t !== 'all' && evalSteps(d, tabFilter(t, NOW_ISO))).length;
      const name = invoiceStatus(d as unknown as DocStatusInput, NOW);
      expect(hits).toBe(name === 'Cancelled' ? 0 : 1);
    }
  });
});

describe('ageing / overdue', () => {
  it('days overdue are whole days after the due date, never negative', () => {
    expect(daysOverdue('2026-11-01T00:00:00Z', NOW)).toBe(26);
    expect(daysOverdue('2026-11-27T00:00:00Z', NOW)).toBe(0);
    expect(daysOverdue(FUTURE, NOW)).toBe(0);
    expect(daysOverdue(null, NOW)).toBe(0);
  });
  it('buckets match today’s receivables page (current, 1–30, 31–60, 61–90, 90+)', () => {
    const d = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
    expect(ageingBucket(FUTURE, NOW)).toBe('current');
    expect(ageingBucket(d(1), NOW)).toBe('1_30');
    expect(ageingBucket(d(30), NOW)).toBe('1_30');
    expect(ageingBucket(d(31), NOW)).toBe('31_60');
    expect(ageingBucket(d(61), NOW)).toBe('61_90');
    expect(ageingBucket(d(91), NOW)).toBe('90_plus');
  });
  it('due within 7 days', () => {
    expect(dueWithin('2026-11-30T00:00:00Z', NOW)).toBe(true);
    expect(dueWithin('2026-12-05T00:00:00Z', NOW)).toBe(false);
    expect(dueWithin(PAST, NOW)).toBe(false);
  });
  it('receivable KPIs: open balances, overdue with the oldest age, due in 7 days; other currencies noted, not mixed in', () => {
    const k = receivableKpis(
      [
        { amount_cents: 100000, paid_cents: 20000, due_at: PAST, currency: 'USD' },
        { amount_cents: 50000, paid_cents: 0, due_at: '2026-11-30T00:00:00Z', currency: 'USD' },
        { amount_cents: 30000, paid_cents: 30000, due_at: PAST, currency: 'USD' },
        { amount_cents: 99999, paid_cents: 0, due_at: PAST, currency: 'CNY' },
      ],
      NOW,
    );
    expect(k.receivables).toMatchObject({ minor: 130000, count: 2 });
    expect(k.overdue).toMatchObject({ minor: 80000, count: 1, oldestDays: 26 });
    expect(k.due7).toMatchObject({ minor: 50000, count: 1 });
    expect(k.receivables.note).toMatch(/1 in other currencies/);
  });
});

describe('record payment: which of today’s actions applies', () => {
  const base = { docType: 'commercial_invoice', number: 'OCT-SRC-2026-0001', status: 'Sent' as const, orderId: null, orderOutstandingMinor: null };
  it('order invoices → record_payment on the order; service proformas → pay_service_proforma; others → none, with a reason', () => {
    expect(paymentTarget({ ...base, orderId: 'o1', orderOutstandingMinor: 100 }).target).toBe('order');
    expect(paymentTarget({ ...base, orderId: 'o1', orderOutstandingMinor: 0 }).reason).toMatch(/fully paid/);
    expect(paymentTarget({ ...base, docType: 'proforma_invoice', number: 'PF-2026-000012' }).target).toBe('proforma');
    expect(paymentTarget({ ...base, docType: 'proforma_invoice', number: 'TEST-PI-1' }).target).toBeNull();
    expect(paymentTarget(base).target).toBeNull();
    expect(paymentTarget({ ...base, status: 'Paid' }).target).toBeNull();
    expect(paymentTarget({ ...base, status: 'Credit note', docType: 'credit_note' }).target).toBeNull();
    expect(paymentTarget({ ...base, status: 'Draft', orderId: 'o1', orderOutstandingMinor: 5 }).target).toBeNull();
  });
  it('form checks: amount above zero and within the balance, bank reference 3+ characters, method allowed', () => {
    expect(validatePayment({ amount: '10', reference: 'FT1', method: 'card' }, 1000, 'order')).toEqual({});
    expect(validatePayment({ amount: '0', reference: 'FT1', method: 'card' }, 1000, 'order').amount).toBeTruthy();
    expect(validatePayment({ amount: '10.01', reference: 'FT1', method: 'card' }, 1000, 'order').amount).toMatch(/more than/);
    expect(validatePayment({ amount: '1', reference: 'F', method: 'card' }, 1000, 'order').reference).toBeTruthy();
    expect(validatePayment({ amount: '1', reference: 'FT1', method: 'card' }, 1000, 'proforma').method).toBeTruthy();
    expect(amountToMinor('1,234.56')).toBe(123456);
  });
  it('second approver note from the limit in settings', () => {
    expect(secondApproverNote(250000)).toBe('Payments over US$ 2,500 need a second approver.');
    expect(secondApproverNote(100050)).toBe('Payments over US$ 1,000.50 need a second approver.');
    expect(secondApproverNote(0)).toMatch(/Every payment/);
    expect(secondApproverNote(null)).toBeNull();
  });
});

describe('two-person step order (T8-DATA: ready → request → today’s action → mark executed)', () => {
  const ok = <T,>(data: T): GateResult<T> => ({ ok: true, data });
  const off: GateResult<never> = { ok: false, error: 'This part of the Back Office is not switched on yet.', code: 'UNAVAILABLE', unavailable: true };
  function deps(o: Partial<{ ready: GateResult<string | null>; request: GateResult<{ required: boolean; id?: string; code?: string }>; exec: { ok: true; message?: string } | { ok: false; error: string; redirect?: string }; mark: GateResult<null> }>) {
    const steps: string[] = [];
    const marked: string[] = [];
    const d: TwoPersonDeps = {
      ready: async () => o.ready ?? ok(null),
      request: async () => o.request ?? ok({ required: false }),
      execute: async () => o.exec ?? { ok: true, message: 'Payment recorded' },
      markExecuted: async (id) => {
        marked.push(id);
        return o.mark ?? ok(null);
      },
      log: (s) => steps.push(s),
    };
    return { d, steps, marked };
  }

  it('at or under the limit: nothing recorded, today’s action runs, nothing to mark', async () => {
    const { d, steps, marked } = deps({});
    expect(await runTwoPersonPayment(d)).toMatchObject({ kind: 'saved', message: 'Payment recorded' });
    expect(steps).toEqual(['ready', 'request', 'execute']);
    expect(marked).toEqual([]);
  });

  it('over the limit, not approved yet: "Second approver needed (APR-n)" and STOP — today’s action is NOT called', async () => {
    const { d, steps } = deps({ request: ok({ required: true, id: 'a1', code: 'APR-00012' }) });
    const r = await runTwoPersonPayment(d);
    expect(r).toMatchObject({ kind: 'second-approver', code: 'APR-00012' });
    expect(r.kind === 'second-approver' && r.message).toMatch(/Second approver needed \(APR-00012\)/);
    expect(steps).toEqual(['ready', 'request']);
  });

  it('approved by another Finance user: ready → today’s action → mark executed (no new request)', async () => {
    const { d, steps, marked } = deps({ ready: ok('a1') });
    expect(await runTwoPersonPayment(d)).toMatchObject({ kind: 'saved' });
    expect(steps).toEqual(['ready', 'execute', 'mark']);
    expect(marked).toEqual(['a1']);
  });

  it('today’s action fails (or asks for the 2-step code): the approval is NOT marked used', async () => {
    const a = deps({ ready: ok('a1'), exec: { ok: false, error: 'INVALID_AMOUNT' } });
    expect(await runTwoPersonPayment(a.d)).toEqual({ kind: 'error', message: 'INVALID_AMOUNT' });
    expect(a.marked).toEqual([]);
    const b = deps({ ready: ok('a1'), exec: { ok: false, error: 'STEP_UP_REQUIRED', redirect: '/staff/verify?next=x' } });
    expect(await runTwoPersonPayment(b.d)).toMatchObject({ kind: 'step-up', redirect: '/staff/verify?next=x' });
    expect(b.steps).toEqual(['ready', 'execute']);
  });

  it('approvals not switched on yet (migration 255 missing): today’s flow exactly as today', async () => {
    const a = deps({ ready: off });
    expect(await runTwoPersonPayment(a.d)).toMatchObject({ kind: 'saved' });
    expect(a.steps).toEqual(['ready', 'execute']);
    const b = deps({ request: off });
    expect(await runTwoPersonPayment(b.d)).toMatchObject({ kind: 'saved' });
    expect(b.steps).toEqual(['ready', 'request', 'execute']);
  });

  it('a real gate error stops before any money step', async () => {
    const a = deps({ ready: { ok: false, error: 'You do not have permission to do this.', code: 'FORBIDDEN' } });
    expect(await runTwoPersonPayment(a.d)).toMatchObject({ kind: 'error' });
    expect(a.steps).toEqual(['ready']);
    const b = deps({ request: { ok: false, error: 'APR-00003 is already waiting for a decision', code: 'APPROVAL_PENDING' } });
    expect(await runTwoPersonPayment(b.d)).toMatchObject({ kind: 'error' });
    expect(b.steps).toEqual(['ready', 'request']);
  });

  it('mark-executed failure after a recorded payment is reported, never hidden', async () => {
    const { d } = deps({ ready: ok('a1'), mark: { ok: false, error: 'This was already decided.' } });
    const r = await runTwoPersonPayment(d);
    expect(r.kind).toBe('saved');
    expect(r.kind === 'saved' && r.warning).toMatch(/could not be marked/);
  });
});

describe('URL state, chips and saved views', () => {
  it('parses and writes ?status= / q / service / issued / sort / page / size / open', () => {
    const q = parseInvoiceQuery({ status: 'overdue', q: 'anna', service: 'src', issued: 'quarter', sort: '-due', page: '3', size: '50', open: 'abc-1' });
    expect(q).toMatchObject({ tab: 'overdue', q: 'anna', service: 'SRC', issued: 'quarter', sort: { id: 'due', desc: true }, page: 2, size: 50, open: 'abc-1' });
    expect(invoiceQueryHref('/office/accounts/invoices', q)).toBe('/office/accounts/invoices?status=overdue&q=anna&service=SRC&issued=quarter&sort=-due&page=3&size=50&open=abc-1');
    expect(invoiceQueryHref('/office/accounts/invoices', DEFAULT_QUERY)).toBe('/office/accounts/invoices');
    expect(parseInvoiceQuery({ status: 'nope', sort: 'customer', size: '7', service: 'XX' })).toMatchObject({ tab: 'all', sort: { id: 'issued', desc: true }, size: 25, service: null });
  });
  it('fixture params are kept', () => {
    expect(invoiceQueryHref('/dev/ui/screens/office-invoices', { ...DEFAULT_QUERY, tab: 'paid' }, { state: 'list' })).toBe('/dev/ui/screens/office-invoices?state=list&status=paid');
  });
  it('search text is safe inside PostgREST filters', () => {
    expect(safeSearch('a,b(c)*%"x\'.y:z')).toBe('a b c x y z');
  });
  it('chips + advanced filter conditions', () => {
    const q = applyConditions(DEFAULT_QUERY, [
      { field: 'service', operator: 'is', value: 'Turnkey' },
      { field: 'issued', operator: 'is', value: 'This month' },
      { field: 'customer', operator: 'contains', value: 'Gulf' },
      { field: 'service', operator: 'is not', value: 'Sourcing' },
    ]);
    expect(q).toMatchObject({ service: 'TK', issued: 'month', customer: 'Gulf', page: 0 });
    expect(filterChips(q).map((c) => c.label)).toEqual(['Service: Turnkey', 'Customer: Gulf', 'Issued: this month']);
  });
  it('saved view filters round-trip', () => {
    const q = { ...DEFAULT_QUERY, tab: 'partly' as const, service: 'TK', sort: { id: 'due', desc: false } };
    expect(queryFromView(viewFilters(q), 'v1')).toMatchObject({ tab: 'partly', service: 'TK', sort: { id: 'due', desc: false }, view: 'v1' });
  });
});

describe('static guards', () => {
  const root = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  it('the page is an ODS T9 screen behind today’s Finance guard', () => {
    const src = read('app/ods/office/accounts/invoices/page.tsx');
    expect(src.startsWith('// ODS T9')).toBe(true);
    expect(src).toContain("requireStaff('finance', 'view'");
  });
  it('Save payment calls today’s record-payment actions and adds no money RPC of its own', () => {
    const src = read('app/ods/office/accounts/invoices/actions.ts');
    expect(src).toContain("from '@/app/office/orders/[id]/payment-actions'");
    expect(src).toContain("from '@/app/admin/finance/transfers/proforma-actions'");
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
