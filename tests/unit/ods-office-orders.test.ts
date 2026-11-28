import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATUS_NAMES } from '@octopus/ui/status';
import {
  ACTIVE_STATUSES,
  ALL_ORDER_STATUSES,
  BUILTIN_VIEWS,
  DEFAULT_QUERY,
  NEXT,
  ORDER_RECORD_TABS,
  ORDER_STEPS,
  ORDER_TABS,
  TAB_STATUSES,
  applyConditions,
  defaultPaymentMinor,
  filterChips,
  isOrderRecordTab,
  moveLabel,
  orderFigures,
  orderMoves,
  orderPerms,
  orderQueryHref,
  orderStepper,
  parseOrderQuery,
  paymentBlock,
  primaryAction,
  queryFromView,
  queryOrderRows,
  reasonRequired,
  safeSearch,
  staffOrderStatus,
  statusFilter,
  tabCounts,
  viewFilters,
  visibleDocuments,
  ODS_SUPPLIER_STRICT,
  ORDER_REFERENCE_MAX,
  showSupplierCodes,
  showSupplierDocs,
  validateOrderPayment,
  type OrderRow,
} from '@/app/ods/office/orders/_lib/order-core';
import {
  FILTER_LABEL,
  TICKET_FILTERS,
  TICKET_STATUSES,
  claimWindowOpen,
  parseSupportQuery,
  slaLabel,
  sortTickets,
  supportHref,
  supportPerms,
} from '@/app/ods/office/support/_lib/support-core';
import { runTwoPersonPayment, type TwoPersonDeps } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const perm = (list: string[], isAdmin = false) => ({ isAdmin, can: (a: string, x: string) => isAdmin || list.includes(`${a}:${x}`) });

describe('ODS T9 orders · Appendix C status names', () => {
  it('every orders.status maps to an Appendix C order name', () => {
    for (const s of [...ALL_ORDER_STATUSES, 'completed']) expect(STATUS_NAMES.orders as readonly string[]).toContain(staffOrderStatus(s).name);
  });
  it('disputed shows Delivered with a red Disputed step', () => {
    expect(staffOrderStatus('disputed')).toEqual({ name: 'Delivered', step: 'Disputed', attention: true });
    expect(staffOrderStatus('ready_to_ship')).toMatchObject({ name: 'In production', step: 'Ready to ship', attention: false });
    expect(staffOrderStatus('pi_issued').name).toBe('Waiting for payment');
    expect(staffOrderStatus('deposit_pending').name).toBe('Deposit due');
    expect(staffOrderStatus('balance_pending').name).toBe('Balance due');
    expect(staffOrderStatus('qc').name).toBe('Quality check');
  });
  it('each Appendix C tab holds exactly the statuses that map to its name', () => {
    for (const [tab, label] of ORDER_TABS) {
      if (tab === 'active' || tab === 'all') continue;
      const inTab = TAB_STATUSES[tab]!;
      for (const s of [...ALL_ORDER_STATUSES, 'completed']) expect(inTab.includes(s)).toBe(staffOrderStatus(s).name === label);
    }
  });
  it('Appendix C tabs cover all 8 order names; Active = today’s default filter', () => {
    const labels = ORDER_TABS.map(([, l]) => l);
    for (const n of STATUS_NAMES.orders) expect(labels).toContain(n);
    expect(TAB_STATUSES.active).toEqual(['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped']);
    expect(TAB_STATUSES.all).toBeNull();
    expect(DEFAULT_QUERY.tab).toBe('active');
  });
});

describe('ODS T9 orders · URL state, filters and views', () => {
  it('round-trips through the URL', () => {
    const q = { ...DEFAULT_QUERY, tab: 'balance' as const, q: 'OCT-SRC', steps: ['balance_pending'], customer: 'Anna', sort: { id: 'total', desc: false }, page: 2, size: 50 as const, view: 'sv-1' };
    const href = orderQueryHref('/office/orders', q);
    const back = parseOrderQuery(Object.fromEntries(new URL(href, 'http://x').searchParams));
    expect(back).toEqual(q);
    expect(orderQueryHref('/office/orders', DEFAULT_QUERY)).toBe('/office/orders');
  });
  it('rejects unknown tabs, sorts, sizes and steps', () => {
    const q = parseOrderQuery({ status: 'nope', sort: 'supplier', size: '7', steps: 'hacked,qc', page: '-3' });
    expect(q.tab).toBe('active');
    expect(q.sort).toEqual({ id: 'updated', desc: true });
    expect(q.size).toBe(25);
    expect(q.steps).toEqual(['qc']);
    expect(q.page).toBe(0);
  });
  it('today’s ?f= quick filters keep working with the same status lists', () => {
    expect(parseOrderQuery({ f: 'awaiting_payment' })).toMatchObject({ tab: 'all', steps: ['deposit_pending', 'balance_pending'] });
    expect(parseOrderQuery({ f: 'ready_to_ship' })).toMatchObject({ tab: 'all', steps: ['ready_to_ship'] });
    expect(parseOrderQuery({ f: 'problems' })).toMatchObject({ tab: 'all', steps: ['disputed', 'cancelled'] });
    expect(parseOrderQuery({ f: 'all' })).toMatchObject({ tab: 'all', steps: null });
    expect(parseOrderQuery({ f: 'delivered' }).steps).toEqual(['delivered', 'closed']);
  });
  it('search is sanitised like today (no commas or brackets in the PostgREST or())', () => {
    expect(safeSearch(' ORD-1,(x)% ')).toBe('ORD-1x');
    expect(safeSearch('a'.repeat(200))).toHaveLength(80);
  });
  it('steps narrow the tab; a step outside the tab matches nothing', () => {
    expect(statusFilter('all', null)).toBeNull();
    expect(statusFilter('production', ['ready_to_ship'])).toEqual(['ready_to_ship']);
    expect(statusFilter('production', ['qc'])).toEqual([]);
    expect(statusFilter('all', ['qc'])).toEqual(['qc']);
  });
  it('filter chips + advanced filters', () => {
    const q = applyConditions(DEFAULT_QUERY, [{ field: 'steps', operator: 'is', value: 'Ready to ship' }, { field: 'customer', operator: 'contains', value: 'Anna' }, { field: 'cost', operator: 'is', value: '1' }]);
    expect(q.steps).toEqual(['ready_to_ship']);
    expect(q.customer).toBe('Anna');
    expect(filterChips(q).map((c) => c.id)).toEqual(['steps', 'customer']);
  });
  it('saved-view filters round-trip; built-in views are today’s quick filters', () => {
    const q = { ...DEFAULT_QUERY, tab: 'all' as const, q: 'lamp', steps: ['disputed'], customer: 'Mobile' };
    expect(queryFromView(viewFilters(q), 'sv-9')).toEqual({ ...q, view: 'sv-9' });
    expect(BUILTIN_VIEWS.map((v) => v.id)).toEqual(['builtin:active', 'builtin:awaiting', 'builtin:ready', 'builtin:problems']);
    expect(queryFromView(BUILTIN_VIEWS[3].filters, 'builtin:problems').steps).toEqual(['disputed', 'cancelled']);
  });
});

const row = (code: string, status: string, total: number, paid: number, updated: string): OrderRow => ({
  id: code, code, title: `${code} goods`, quantity: 10, status, ...staffOrderStatus(status), statusName: staffOrderStatus(status).name, service: 'Sourcing', customer: code === 'B' ? 'Anna Home' : 'Gulf', customerId: null, country: null, currency: 'USD',
  ...orderFigures({ total_cents: total, paid_cents: paid, deposit_cents: 0 }), owner: null, updatedAt: updated, createdAt: updated,
});

describe('ODS T9 orders · sample rows follow the server rules', () => {
  const rows = [row('A', 'qc', 500, 0, '2026-11-01'), row('B', 'deposit_pending', 900, 0, '2026-11-03'), row('C', 'cancelled', 100, 0, '2026-11-02'), row('D', 'disputed', 300, 300, '2026-11-04')];
  it('tab, steps, search, customer, sort, page', () => {
    expect(queryOrderRows(rows, DEFAULT_QUERY).rows.map((r) => r.code)).toEqual(['B', 'A']);
    expect(queryOrderRows(rows, { ...DEFAULT_QUERY, tab: 'all', sort: { id: 'total', desc: false } }).rows.map((r) => r.code)).toEqual(['C', 'D', 'A', 'B']);
    expect(queryOrderRows(rows, { ...DEFAULT_QUERY, tab: 'all', steps: ['disputed', 'cancelled'] }).total).toBe(2);
    expect(queryOrderRows(rows, { ...DEFAULT_QUERY, tab: 'all', customer: 'anna' }).rows.map((r) => r.code)).toEqual(['B']);
    expect(queryOrderRows(rows, { ...DEFAULT_QUERY, tab: 'all', q: 'c goods' }).rows.map((r) => r.code)).toEqual(['C']);
    expect(tabCounts(rows)).toMatchObject({ all: 4, active: 2, qc: 1, deposit: 1, cancelled: 1, delivered: 1 });
  });
  it('figures = total − paid and deposit − paid, never negative', () => {
    expect(orderFigures({ total_cents: 1000, paid_cents: 300, deposit_cents: 400 })).toEqual({ totalMinor: 1000, paidMinor: 300, balanceMinor: 700, depositDueMinor: 100 });
    expect(orderFigures({ total_cents: 1000, paid_cents: 1200, deposit_cents: 400 })).toMatchObject({ balanceMinor: 0, depositDueMinor: 0 });
    expect(defaultPaymentMinor({ depositDueMinor: 0, balanceMinor: 700 })).toBe(700);
    expect(defaultPaymentMinor({ depositDueMinor: 100, balanceMinor: 700 })).toBe(100);
  });
});

describe('ODS T9 order record · stepper, moves, primary action', () => {
  it('stepper Quote → Deposit → Production → QC → Balance → Shipping → Delivered', () => {
    expect(ORDER_STEPS).toEqual(['Quote', 'Deposit', 'Production', 'QC', 'Balance', 'Shipping', 'Delivered']);
    expect(orderStepper('pi_issued').states).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(orderStepper('in_production')).toMatchObject({ current: 2 });
    expect(orderStepper('ready_to_ship').states.slice(4, 6)).toEqual(['done', 'current']);
    expect(orderStepper('delivered').states.every((s) => s === 'done')).toBe(true);
    expect(orderStepper('closed').states.every((s) => s === 'done')).toBe(true);
    expect(orderStepper('disputed')).toMatchObject({ errorText: 'Disputed' });
    expect(orderStepper('disputed').states[6]).toBe('error');
    expect(orderStepper('cancelled').states.slice(0, 3)).toEqual(['done', 'error', 'upcoming']);
  });
  it('moves = today’s NEXT table without shipped (mirrors order_transition_allowed)', () => {
    const today = read('app/office/orders/[id]/page.tsx');
    for (const [from, tos] of Object.entries(NEXT)) for (const to of tos) expect(today).toMatch(new RegExp(`${from}: \\[[^\\]]*'${to}'`));
    expect(orderMoves('ready_to_ship')).toEqual([]);
    expect(orderMoves('delivered')).toEqual(['closed', 'disputed']);
    expect(reasonRequired('cancelled') && reasonRequired('disputed') && !reasonRequired('closed')).toBe(true);
    expect(moveLabel('qc')).toBe('Move to Quality check');
  });
  it('primary action for the current step', () => {
    const fin = { canEdit: false, canPay: true };
    const ops = { canEdit: true, canPay: false };
    expect(primaryAction({ id: 'o', status: 'deposit_pending', balanceMinor: 10 }, fin)).toEqual({ kind: 'pay', label: 'Record deposit' });
    expect(primaryAction({ id: 'o', status: 'balance_pending', balanceMinor: 10 }, fin)).toEqual({ kind: 'pay', label: 'Record balance' });
    expect(primaryAction({ id: 'o', status: 'deposit_pending', balanceMinor: 10 }, ops)).toEqual({ kind: 'move', to: 'deposit_paid', label: 'Move to Deposit paid' });
    expect(primaryAction({ id: 'o', status: 'ready_to_ship', balanceMinor: 0 }, ops)).toMatchObject({ kind: 'ship', href: '/office/warehouse/b2b-shipments?order=o' });
    expect(primaryAction({ id: 'o', status: 'pi_issued', balanceMinor: 10 }, ops)).toMatchObject({ kind: 'move', to: 'deposit_pending' });
    expect(primaryAction({ id: 'o', status: 'in_production', balanceMinor: 10 }, { canEdit: false, canPay: false })).toBeNull();
    expect(primaryAction({ id: 'o', status: 'cancelled', balanceMinor: 10 }, ops)).toBeNull();
  });
  it('record payment: today’s two rules', () => {
    expect(paymentBlock(100, false)).toBe('Only Finance can record payments.');
    expect(paymentBlock(0, true)).toBe('This order is fully paid.');
    expect(paymentBlock(100, true)).toBeNull();
  });
  it('record tabs', () => {
    expect(ORDER_RECORD_TABS).toEqual(['overview', 'items', 'documents', 'payments', 'shipping', 'messages', 'timeline']);
    expect(isOrderRecordTab('payments') && !isOrderRecordTab('cost')).toBe(true);
  });
});

describe('ODS T9 orders · permissions (today’s checks)', () => {
  it('supplier, carrier, labels, payments, moves', () => {
    expect(orderPerms(perm(['orders:view']))).toEqual({ canEdit: false, canPay: false, canSeeSuppliers: false, canSeeCarrier: false, canDownloadLabels: false, canSeeTickets: false });
    expect(orderPerms(perm(['orders:view', 'finance:view', 'finance:approve']))).toMatchObject({ canPay: true, canSeeSuppliers: true, canSeeCarrier: true, canDownloadLabels: false });
    expect(orderPerms(perm(['orders:view', 'suppliers:view']))).toMatchObject({ canSeeSuppliers: true, canPay: false });
    expect(orderPerms(perm(['orders:view', 'orders:edit']))).toMatchObject({ canEdit: true, canDownloadLabels: true, canSeeCarrier: true });
    expect(orderPerms(perm(['orders:view', 'warehouse:view']))).toMatchObject({ canDownloadLabels: true, canSeeCarrier: true });
    expect(orderPerms(perm(['orders:view', 'support:view'])).canSeeTickets).toBe(true);
    expect(orderPerms(perm([], true))).toMatchObject({ canSeeSuppliers: true, canEdit: true, canPay: true });
  });
  it('supplier visibility = today (ODS_SUPPLIER_STRICT off): codes via RLS for every viewer, every readable document', () => {
    expect(ODS_SUPPLIER_STRICT).toBe(false);
    const docs = [{ type: 'proforma_invoice' }, { type: 'purchase_order' }, { type: 'remittance' }, { type: 'confirmation' }];
    expect(visibleDocuments(docs, false)).toHaveLength(4);
    expect(showSupplierCodes(false) && showSupplierDocs(false)).toBe(true);
  });
  it('the strict rule (owner switch) hides supplier codes and documents without the permission', () => {
    const docs = [{ type: 'proforma_invoice' }, { type: 'purchase_order' }, { type: 'remittance' }, { type: 'confirmation' }];
    expect(visibleDocuments(docs, false, true).map((d) => d.type)).toEqual(['proforma_invoice', 'confirmation']);
    expect(visibleDocuments(docs, true, true)).toHaveLength(4);
    expect(showSupplierCodes(false, true)).toBe(false);
    expect(showSupplierCodes(true, true)).toBe(true);
  });
  it('loaders: list + ticket use today\'s withSuppliers for everyone; the record supplier line keeps today\'s check', () => {
    const data = read('app/ods/office/orders/_lib/order-data.ts');
    expect(data).toMatch(/const withSup = showSupplierCodes\(perms\.canSeeSuppliers\) \?/);
    expect(data).toMatch(/const supDocs = showSupplierDocs\(perms\.canSeeSuppliers\)/);
    expect(data).toMatch(/const o: Record<string, unknown> = perms\.canSeeSuppliers\s*\?\s*\(await withSuppliers/);
    expect(read('app/ods/office/support/_lib/support-data.ts')).toMatch(/const supCodes = showSupplierCodes\(perms\.canSeeSuppliers\)/);
  });
});

describe('ODS T9 orders · payment form = today\'s order payment schema', () => {
  it('reference 3–120 trimmed, methods, amount > 0 and ≤ balance', () => {
    expect(ORDER_REFERENCE_MAX).toBe(120);
    expect(validateOrderPayment({ amount: '10', reference: 'x'.repeat(120), method: 'card' }, 5000)).toEqual({});
    expect(validateOrderPayment({ amount: '10', reference: 'x'.repeat(121), method: 'card' }, 5000).reference).toBeDefined();
    expect(validateOrderPayment({ amount: '10', reference: ' ab ', method: 'bank_transfer' }, 5000).reference).toBeDefined();
    expect(validateOrderPayment({ amount: '0', reference: 'FT123', method: 'bank_transfer' }, 5000).amount).toBeDefined();
    expect(validateOrderPayment({ amount: '60', reference: 'FT123', method: 'bank_transfer' }, 5000).amount).toBe('This is more than the balance due.');
    expect(validateOrderPayment({ amount: '1', reference: 'FT123', method: 'wire' }, 5000).method).toBeDefined();
    const today = read('app/office/actions.ts');
    expect(today).toMatch(/reference: z\.string\(\)\.trim\(\)\.min\(3, 'Bank reference required'\)\.max\(120\)/);
    expect(today).toMatch(/method: z\.enum\(\['bank_transfer', 'card', 'other'\]\)/);
  });
});

describe('ODS T9 orders · money flow = today’s actions behind the T8 two-person order', () => {
  const action = read('app/ods/office/orders/actions.ts');
  it('no money code of its own: no rpc / insert / update', () => {
    expect(action).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(action).toMatch(/recordPaymentStepUp\(id, null, fd\)/);
    expect(action).toMatch(/transitionOrder\(orderId/);
    expect(action).toMatch(/can\(s, 'finance', 'approve'\)/);
    expect(action).toMatch(/refType: 'order', refId: id/);
    expect(action).toMatch(/validateOrderPayment\(\{ amount, reference, method \}, max\)/);
  });
  it('two-person order: ready → request → stop with Second approver needed', async () => {
    const log: string[] = [];
    const deps: TwoPersonDeps = {
      ready: async () => ({ ok: true, data: null }),
      request: async () => ({ ok: true, data: { required: true, id: 'a1', code: 'APR-00031' } }),
      execute: async () => ({ ok: true }),
      markExecuted: async () => ({ ok: true, data: null }),
      log: (s) => log.push(s),
    };
    expect(await runTwoPersonPayment(deps)).toMatchObject({ kind: 'second-approver', code: 'APR-00031' });
    expect(log).toEqual(['ready', 'request']);
  });
  it('fallback before migration 255: today’s flow runs exactly as today', async () => {
    const log: string[] = [];
    const r = await runTwoPersonPayment({
      ready: async () => ({ ok: false, error: 'off', unavailable: true }),
      request: async () => ({ ok: false, error: 'off', unavailable: true }),
      execute: async () => ({ ok: true, message: 'Payment recorded' }),
      markExecuted: async () => ({ ok: true, data: null }),
      log: (s) => log.push(s),
    });
    expect(r).toMatchObject({ kind: 'saved', message: 'Payment recorded' });
    expect(log).toEqual(['ready', 'execute']);
  });
});

describe('ODS T9 orders + support · pages replace the T8 re-exports with today’s guards', () => {
  it('marked ODS T9, same requireStaff as today', () => {
    const list = read('app/ods/office/orders/page.tsx');
    const rec = read('app/ods/office/orders/[id]/page.tsx');
    const sup = read('app/ods/office/support/page.tsx');
    for (const f of [list, rec, sup]) expect(f.startsWith('// ODS T9')).toBe(true);
    expect(list).toMatch(/requireStaff\('orders', 'view'/);
    expect(list).toMatch(/getDivisionScope\(s\)/);
    expect(rec).toMatch(/requireStaff\('orders', 'view', `\/office\/orders\/\$\{id\}`\)/);
    expect(sup).toMatch(/requireStaff\('support', 'view'/);
    expect(sup).toMatch(/replyTicket, ticketStatusForm, ticketPriorityForm, saveMacro, escalateToFinance/);
  });
  it('support actions file only wraps today’s updateTicket', () => {
    const a = read('app/ods/office/support/actions.ts');
    expect(a).not.toMatch(/\.rpc\(|\.from\(/);
    expect(a).toMatch(/updateTicket\(String\(ticketId \?\? ''\), \{ assign_to_me: true \}\)/);
  });
});

describe('ODS T9 support desk · today’s filters, order and SLA', () => {
  it('filters = today’s list, as tabs', () => {
    expect(TICKET_FILTERS).toEqual(['all', 'complaint', 'question', 'feedback', 'overdue', 'mine', 'resolved']);
    expect(Object.keys(FILTER_LABEL)).toHaveLength(7);
    expect(TICKET_STATUSES).toEqual(['new', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed', 'reopened']);
  });
  it('query parsing and links', () => {
    expect(parseSupportQuery({ f: 'mine', p: 'urgent', t: '7c000000-0000-4000-8000-000000000001', q: 'crush,()' })).toEqual({ f: 'mine', p: 'urgent', t: '7c000000-0000-4000-8000-000000000001', q: 'crush' });
    expect(parseSupportQuery({ f: 'x', p: 'meh', t: 'not-a-uuid' })).toEqual({ f: 'all', p: null, t: null, q: '' });
    expect(supportHref('/office/support', { f: 'all', p: null, t: null, q: '' })).toBe('/office/support');
    expect(supportHref('/office/support', { f: 'overdue', p: 'high', t: null, q: '' })).toBe('/office/support?f=overdue&p=high');
  });
  it('SLA text as today', () => {
    const now = Date.parse('2026-11-27T10:00:00Z');
    expect(slaLabel('2026-11-27T08:00:00Z', 'open', now)).toEqual({ text: 'Overdue 2 h', bad: true });
    expect(slaLabel('2026-11-27T12:00:00Z', 'open', now)).toEqual({ text: '2 h left', bad: true });
    expect(slaLabel('2026-11-27T20:00:00Z', 'open', now)).toEqual({ text: '10 h left', bad: false });
    expect(slaLabel('2026-11-30T10:00:00Z', 'open', now)).toEqual({ text: '3 days left', bad: false });
    expect(slaLabel('2026-11-27T08:00:00Z', 'resolved', now)).toEqual({ text: 'Resolved', bad: false });
    expect(claimWindowOpen('2027-01-01T00:00:00Z', now) && !claimWindowOpen(null, now)).toBe(true);
  });
  it('queue order: priority, then the nearest reply target', () => {
    const list = [
      { id: 'a', priority: 'normal', slaDueAt: '2026-11-27T01:00:00Z' },
      { id: 'b', priority: 'urgent', slaDueAt: '2026-11-29T01:00:00Z' },
      { id: 'c', priority: 'urgent', slaDueAt: '2026-11-28T01:00:00Z' },
      { id: 'd', priority: 'low', slaDueAt: null },
    ];
    expect(sortTickets(list).map((t) => t.id)).toEqual(['c', 'b', 'a', 'd']);
  });
  it('permissions: support:edit writes; support:create or finance:create escalates; supplier code with the supplier permission', () => {
    expect(supportPerms(perm(['support:view']))).toEqual({ canEdit: false, canEscalate: false, canSeeSuppliers: false });
    expect(supportPerms(perm(['support:view', 'support:edit', 'support:create']))).toMatchObject({ canEdit: true, canEscalate: true });
    expect(supportPerms(perm(['support:view', 'finance:create', 'finance:view']))).toMatchObject({ canEscalate: true, canSeeSuppliers: true });
  });
  it('the active list matches today’s Active filter', () => {
    expect([...ACTIVE_STATUSES]).toEqual(TAB_STATUSES.active);
  });
});

describe('ODS T9 orders · step text next to the pill', () => {
  it('only where the Appendix C name hides the step', async () => {
    const { stepAddsInfo } = await import('@/app/ods/office/orders/_lib/order-core');
    expect(['ready_to_ship', 'balance_paid', 'disputed', 'closed'].every(stepAddsInfo)).toBe(true);
    expect(['deposit_pending', 'qc', 'shipped', 'cancelled', 'in_production'].some(stepAddsInfo)).toBe(false);
  });
});
