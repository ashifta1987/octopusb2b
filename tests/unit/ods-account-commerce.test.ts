import { describe, expect, it } from 'vitest';
import {
  buildOrdersList,
  currentStepIndex,
  isOptionEnabled,
  nextAction,
  orderStatusName,
  ordersHref,
  parseOrdersParams,
  paymentChoices,
  payLaterChoice,
  paymentStatusName,
  serviceFromDivision,
  stepsForService,
  toOrderRow,
  walletCovers,
  type OrderSource,
} from '@/app/ods/account/orders/_lib/order-logic';
import { isCustomerDocType, moneyText } from '@/app/ods/account/orders/_lib/commerce-format';
import { buildRequestsList, matchesRequestCard, parseRequestsParams, requestSteps, rfqStatusName, serviceRequestStatusName, toRequestRow } from '@/app/ods/account/requests/_lib/request-logic';
import { docStatusName, invoiceCounts, invoiceService, matchesInvoiceFilter, parseInvoiceFilter, saasPanelVisible, saasPayLater, type InvoiceRowVM } from '@/app/ods/account/invoices/_lib/invoice-logic';
import { parseWalletParams, periodRange, statementHref, transferStatusName, walletHoldStatusName, walletHref } from '@/app/ods/account/wallet/_lib/wallet-logic';
import { STATUS_NAMES } from '@octopus/ui/status';

const order = (p: Partial<OrderSource> = {}): OrderSource => ({
  id: 'o1',
  code: 'OCT-SRC-2026-0207',
  title: 'Baking mats',
  quantity: 2000,
  status: 'balance_pending',
  total_cents: 410000,
  deposit_cents: 123000,
  paid_cents: 123000,
  currency: 'USD',
  created_at: '2026-10-18T00:00:00Z',
  updated_at: '2026-11-26T00:00:00Z',
  delivered_at: null,
  service: 'sourcing',
  pool: false,
  hasShipment: false,
  ...p,
});

describe('orders · Appendix C status names', () => {
  const raws = ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped', 'delivered', 'closed', 'cancelled', 'disputed'];
  it('every raw status maps to an Appendix C order name', () => {
    for (const r of raws) expect(STATUS_NAMES.orders as readonly string[]).toContain(orderStatusName(r));
  });
  it('maps the key states', () => {
    expect(orderStatusName('deposit_pending')).toBe('Deposit due');
    expect(orderStatusName('qc')).toBe('Quality check');
    expect(orderStatusName('balance_pending')).toBe('Balance due');
    expect(orderStatusName('shipped')).toBe('Shipped');
    expect(orderStatusName('closed')).toBe('Delivered');
    expect(orderStatusName('cancelled')).toBe('Cancelled');
    expect(orderStatusName('disputed', { delivered_at: '2026-11-01' })).toBe('Delivered');
    expect(orderStatusName('disputed')).toBe('In production');
  });
  it('division code → service is the same mapping as today', () => {
    expect(serviceFromDivision('DS')).toBe('dropship');
    expect(serviceFromDivision('MMB')).toBe('brand');
    expect(serviceFromDivision('POOL')).toBe('pools');
    expect(serviceFromDivision('TK')).toBe('turnkey');
    expect(serviceFromDivision('3PL')).toBe('warehouse');
    expect(serviceFromDivision(null)).toBe('sourcing');
  });
});

describe('orders · next-step action', () => {
  it('pay balance / pay deposit follow today’s dueNow', () => {
    expect(nextAction(order()).kind).toBe('pay_balance');
    expect(nextAction(order()).href).toBe('/account/orders/OCT-SRC-2026-0207#payment');
    expect(nextAction(order({ status: 'deposit_pending', paid_cents: 0 })).label).toBe('Pay deposit');
    expect(nextAction(order({ status: 'pi_issued', paid_cents: 0 })).kind).toBe('pay_deposit');
  });
  it('track / view pool / view; never reorder', () => {
    expect(nextAction(order({ status: 'shipped', paid_cents: 410000, hasShipment: true })).kind).toBe('track');
    expect(nextAction(order({ status: 'shipped', paid_cents: 410000 })).kind).toBe('view');
    expect(nextAction(order({ status: 'in_production', service: 'pools', pool: true })).kind).toBe('view_pool');
    expect(nextAction(order({ status: 'delivered', paid_cents: 410000 })).kind).toBe('view');
  });
});

describe('orders · stepper per service', () => {
  it('goods orders use seven steps; pools start with the pool; dropship and 3PL are shorter', () => {
    expect(stepsForService('sourcing').map((s) => s.label)).toEqual(['Quote', 'Deposit', 'Production', 'Quality check', 'Balance', 'Shipping', 'Delivered']);
    expect(stepsForService('pools')[0].label).toBe('Pool');
    expect(stepsForService('dropship').map((s) => s.label)).toEqual(['Payment', 'Packing', 'Shipping', 'Delivered']);
    expect(stepsForService('warehouse')).toHaveLength(4);
  });
  it('current step from the raw status', () => {
    const s = stepsForService('sourcing');
    expect(currentStepIndex(s, 'deposit_pending')).toBe(1);
    expect(currentStepIndex(s, 'in_production')).toBe(2);
    expect(currentStepIndex(s, 'qc')).toBe(3);
    expect(currentStepIndex(s, 'balance_pending')).toBe(4);
    expect(currentStepIndex(s, 'ready_to_ship')).toBe(5);
    expect(currentStepIndex(s, 'delivered')).toBe(7);
    expect(currentStepIndex(s, 'cancelled')).toBe(-1);
    const d = stepsForService('dropship');
    expect(currentStepIndex(d, 'balance_pending')).toBe(2); // next dropship step at/after balance = Shipping
    expect(currentStepIndex(d, 'delivered')).toBe(4);
  });
});

describe('orders · list filters', () => {
  const rows = [order(), order({ id: 'o2', code: 'OCT-2', status: 'in_production', paid_cents: 123000 }), order({ id: 'o3', code: 'OCT-3', status: 'shipped', paid_cents: 410000, service: 'turnkey' }), order({ id: 'o4', code: 'OCT-4', status: 'qc' })].map(toOrderRow);
  it('card counts and AND-combined service filter', () => {
    const l = buildOrdersList(rows, parseOrdersParams({}));
    expect(l.cardCounts).toEqual({ all: 4, waiting: 1, production: 2, shipped: 1 });
    const t = buildOrdersList(rows, parseOrdersParams({ service: 'turnkey' }));
    expect(t.rows.map((r) => r.ref)).toEqual(['OCT-3']);
    expect(buildOrdersList(rows, parseOrdersParams({ status: 'production' })).filteredTotal).toBe(2);
  });
  it('board groups by status; URL state round-trips', () => {
    const l = buildOrdersList(rows, parseOrdersParams({ view: 'board' }));
    expect(l.board.map((c) => c.status)).toEqual(['In production', 'Quality check', 'Balance due', 'Shipped']);
    const s = parseOrdersParams({ status: 'waiting', service: 'sourcing', sort: 'total-desc', page: '2', view: 'board' });
    expect(ordersHref(s, { page: 2 })).toBe('/account/orders?status=waiting&service=sourcing&view=board&sort=total-desc&page=2');
    expect(ordersHref(s, { service: 'all' })).toBe('/account/orders?status=waiting&view=board&sort=total-desc');
    expect(parseOrdersParams({ status: 'bogus', page: '-3' })).toMatchObject({ status: 'all', page: 1 });
  });
});

describe('orders · payment choices (today’s gating, never Pay later)', () => {
  const opts = [
    { option: 'pay_now', enabled: true, min_amount_cents: 0, max_amount_cents: null },
    { option: 'payment_protection', enabled: true, min_amount_cents: 100000, max_amount_cents: 500000 },
    { option: 'pay_later', enabled: true, min_amount_cents: 0, max_amount_cents: null },
  ];
  const base = { dueAmount: 287000, amountCents: 287000, walletEnabled: true, hasHold: false, hasReservation: false, options: opts, hasProvider: true, cancelled: false };
  it('matches isOptionEnabled min / max', () => {
    expect(isOptionEnabled(opts[1], 99999)).toBe(false);
    expect(isOptionEnabled(opts[1], 500001)).toBe(false);
    expect(isOptionEnabled(opts[1], 200000)).toBe(true);
    expect(isOptionEnabled(undefined, 1)).toBe(false);
  });
  it('wallet, online and protection; nothing with a hold, a reservation or when cancelled', () => {
    expect(paymentChoices(base)).toEqual({ wallet: true, online: true, protection: true, protectionWallet: true, protectionOnline: true });
    expect(paymentChoices({ ...base, hasProvider: false })).toMatchObject({ online: false, protectionOnline: false, protection: true });
    expect(paymentChoices({ ...base, walletEnabled: false, hasProvider: false })).toMatchObject({ wallet: false, protection: false });
    expect(paymentChoices({ ...base, hasHold: true }).wallet).toBe(false);
    expect(paymentChoices({ ...base, hasReservation: true }).protection).toBe(false);
    expect(paymentChoices({ ...base, cancelled: true }).online).toBe(false);
    expect(Object.keys(paymentChoices(base))).not.toContain('payLater');
  });
  it('Pay later: only credit-eligible companies, with today’s conditions', () => {
    const credit = { eligible: true, available_cents: 300000, credit_limit_cents: 500000, unpaid_invoices_cents: 100000, reserved_cents: 100000, net_days: 30 };
    const pl = { amountCents: 287000, options: opts, credit, hasHold: false, reservationReserved: false, cancelled: false };
    expect(payLaterChoice(pl)).toEqual({ show: true, allowed: true });
    expect(payLaterChoice({ ...pl, credit: { ...credit, eligible: false } })).toEqual({ show: false, allowed: false });
    expect(payLaterChoice({ ...pl, credit: null })).toEqual({ show: false, allowed: false });
    expect(payLaterChoice({ ...pl, credit: { ...credit, available_cents: 100000 } })).toEqual({ show: true, allowed: false });
    expect(payLaterChoice({ ...pl, options: opts.filter((o) => o.option !== 'pay_later') }).show).toBe(false);
    expect(payLaterChoice({ ...pl, options: opts.map((o) => (o.option === 'pay_later' ? { ...o, max_amount_cents: 1000 } : o)) }).show).toBe(false);
    expect(payLaterChoice({ ...pl, hasHold: true }).show).toBe(false);
    expect(payLaterChoice({ ...pl, reservationReserved: true }).show).toBe(false);
    expect(payLaterChoice({ ...pl, cancelled: true }).show).toBe(false);
  });
  it('wallet cover = balance + credit, like today’s confirm dialog', () => {
    expect(walletCovers(287000, 200000, 87000)).toBe(true);
    expect(walletCovers(287000, 200000, 0)).toBe(false);
  });
  it('payment names', () => {
    expect(paymentStatusName('confirmed')).toBe('Paid');
    expect(paymentStatusName('pending')).toBe('Pending');
    expect(paymentStatusName('failed')).toBe('Failed');
  });
});

describe('requests · Appendix C names, cards and stepper', () => {
  it('rfq + order status', () => {
    expect(rfqStatusName('submitted')).toBe('Sent');
    expect(rfqStatusName('quoting')).toBe('Quoting');
    expect(rfqStatusName('quoted')).toBe('Quote ready');
    expect(rfqStatusName('expired')).toBe('Closed');
    expect(rfqStatusName('accepted', 'balance_pending')).toBe('Accepted');
    expect(rfqStatusName('accepted', 'cancelled')).toBe('Closed');
    for (const r of ['draft', 'submitted', 'assigned', 'quoting', 'quoted', 'accepted', 'expired', 'cancelled']) expect(STATUS_NAMES.requests as readonly string[]).toContain(rfqStatusName(r));
  });
  it('service requests', () => {
    expect(serviceRequestStatusName('requested')).toBe('Sent');
    expect(serviceRequestStatusName('paid')).toBe('Quoting');
    expect(serviceRequestStatusName('report_ready')).toBe('Accepted');
    expect(serviceRequestStatusName('refunded')).toBe('Closed');
  });
  it('cards: Quoting holds Sent + Quoting', () => {
    expect(matchesRequestCard('Sent', 'quoting')).toBe(true);
    expect(matchesRequestCard('Draft', 'quoting')).toBe(false);
    expect(matchesRequestCard('Draft', 'all')).toBe(true);
  });
  it('stepper Sent → Quoting → Quote ready → Accepted → Ordered', () => {
    const st = (s: Parameters<typeof requestSteps>[1], o = { hasOrder: false, quotes: 0 }) => requestSteps('rfq', s, o).map((x) => x.status);
    expect(st('Quoting')).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(st('Quote ready', { hasOrder: false, quotes: 3 })).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(st('Accepted', { hasOrder: true, quotes: 2 })).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(st('Closed', { hasOrder: false, quotes: 1 })).toEqual(['done', 'done', 'done', 'upcoming', 'upcoming']);
    expect(requestSteps('rfq', 'Quoting', { hasOrder: false, quotes: 0 }).map((x) => x.label)).toEqual(['Sent', 'Quoting', 'Quote ready', 'Accepted', 'Ordered']);
  });
  it('rows, actions and list filters', () => {
    const rows = [
      toRequestRow({ kind: 'rfq', id: '1', ref: 'RFQ-1042', title: 'Pet crate', quantity: 500, unit: 'units', type: 'sourcing', raw: 'quoted', quotes: 3, newQuotes: 2, created_at: '2026-11-18', order: null }),
      toRequestRow({ kind: 'rfq', id: '2', ref: 'RFQ-1033', title: 'Mats', quantity: 2000, unit: 'sets', type: 'sourcing', raw: 'accepted', quotes: 2, newQuotes: 0, created_at: '2026-10-10', order: { id: 'o', code: 'OCT-1', status: 'shipped' } }),
      toRequestRow({ kind: 'service', id: '3', ref: 'SRV-0088', title: 'Sample', quantity: 1, unit: null, type: 'sample', raw: 'requested', quotes: 0, newQuotes: 0, created_at: '2026-11-20', order: null }),
    ];
    expect(rows[0].action).toEqual({ label: 'Compare quotes', href: '/account/requests/RFQ-1042?tab=quotes' });
    expect(rows[1].action.href).toBe('/account/orders/OCT-1');
    const l = buildRequestsList(rows, parseRequestsParams({}));
    expect(l.cardCounts).toEqual({ all: 3, quoting: 1, ready: 1, accepted: 1, closed: 0 });
    expect(l.newQuotes).toBe(2);
    expect(buildRequestsList(rows, parseRequestsParams({ service: 'sample' })).rows.map((r) => r.ref)).toEqual(['SRV-0088']);
    expect(buildRequestsList(rows, parseRequestsParams({ q: 'crate' })).rows.map((r) => r.ref)).toEqual(['RFQ-1042']);
  });
});

describe('invoices · names and filters', () => {
  const NOW = Date.parse('2026-11-27T12:00:00Z');
  it('document status → Appendix C invoice names', () => {
    expect(docStatusName('credit_note', 'issued', null, NOW)).toBe('Credit note');
    expect(docStatusName('proforma_invoice', 'awaiting_payment', '2026-11-30', NOW)).toBe('Sent');
    expect(docStatusName('proforma_invoice', 'awaiting_payment', '2026-11-01', NOW)).toBe('Overdue');
    expect(docStatusName('commercial_invoice', 'part_paid', null, NOW)).toBe('Partly paid');
    expect(docStatusName('commercial_invoice', 'paid', null, NOW)).toBe('Paid');
    expect(docStatusName('receipt', 'issued', null, NOW)).toBe('Paid');
    expect(docStatusName('proforma_invoice', 'void', null, NOW)).toBe('Cancelled');
    for (const s of ['draft', 'issued', 'awaiting_payment', 'part_paid', 'paid', 'void']) expect(STATUS_NAMES.invoices as readonly string[]).toContain(docStatusName('commercial_invoice', s, null, NOW));
  });
  it('pill filters', () => {
    const r = (type: string, statusName: InvoiceRowVM['statusName']): InvoiceRowVM => ({ id: type + statusName, type, typeLabel: type, number: 'X', service: 'Sourcing', forRef: null, createdAt: '', dueAt: null, amountCents: 1, currency: 'USD', statusName, payableCents: 0 });
    const rows = [r('proforma_invoice', 'Sent'), r('commercial_invoice', 'Paid'), r('credit_note', 'Credit note'), r('statement', 'Sent'), r('receipt', 'Paid')];
    expect(invoiceCounts(rows)).toEqual({ all: 5, due: 1, paid: 2, credit: 1, statements: 1 });
    expect(matchesInvoiceFilter(rows[3], 'due')).toBe(false);
    expect(parseInvoiceFilter({ filter: 'credit' })).toBe('credit');
    expect(parseInvoiceFilter({ filter: 'x' })).toBe('all');
  });
  it('service label like today’s page', () => {
    expect(invoiceService({ doc_type: 'commercial_invoice', data: null, orderCode: 'OCT-1' })).toEqual({ service: 'Sourcing', ref: 'OCT-1' });
    expect(invoiceService({ doc_type: 'proforma_invoice', data: { service: 'brand', ref: 'MMB-1' }, orderCode: null })).toEqual({ service: 'Make My Brand', ref: 'MMB-1' });
    expect(invoiceService({ doc_type: 'receipt', data: null, orderCode: null }).service).toBe('Wallet top-up');
  });
  it('SaaS plans panel: shown like today; Pay later only for credit-eligible companies', () => {
    expect(saasPanelVisible(0, 0)).toBe(false);
    expect(saasPanelVisible(2, 0)).toBe(true);
    expect(saasPanelVisible(0, 1)).toBe(true);
    expect(saasPayLater(false, 999999, 4900)).toEqual({ show: false, allowed: false });
    expect(saasPayLater(true, 20000, 4900)).toEqual({ show: true, allowed: true });
    expect(saasPayLater(true, 20000, 49000)).toEqual({ show: true, allowed: false });
  });
  it('supplier documents are never customer document types', () => {
    expect(isCustomerDocType('purchase_order')).toBe(false);
    expect(isCustomerDocType('remittance')).toBe(false);
    expect(isCustomerDocType('qc_report')).toBe(true);
  });
});

describe('wallet · URL state and names', () => {
  it('parses view / period and builds hrefs', () => {
    expect(parseWalletParams({})).toEqual({ view: 'available', period: 'month' });
    expect(parseWalletParams({ view: 'held', period: 'year' })).toEqual({ view: 'held', period: 'year' });
    expect(walletHref({ view: 'due', period: 'quarter' })).toBe('/account/wallet?view=due&period=quarter');
  });
  it('period range and statement link', () => {
    const NOW = Date.parse('2026-11-27T12:00:00Z');
    expect(periodRange('month', NOW)).toEqual({ from: '2026-10-27', to: '2026-11-27' });
    expect(periodRange('quarter', NOW).from).toBe('2026-08-27');
    expect(periodRange('year', NOW).from).toBe('2025-11-27');
    expect(statementHref({ from: '2026-10-27', to: '2026-11-27' })).toBe('/account/ledger/statement?account=wallet&from=2026-10-27&to=2026-11-27');
  });
  it('transfer and hold names', () => {
    expect(transferStatusName('credited')).toBe('Paid');
    expect(transferStatusName('initiated')).toBe('Pending');
    expect(walletHoldStatusName('open')).toBe('Held');
    expect(walletHoldStatusName('expired')).toBe('Released');
  });
  it('money text', () => {
    expect(moneyText(287000, 'USD')).toBe('US$ 2,870.00');
    expect(moneyText(-42000, 'USD')).toBe('\u2212US$ 420.00');
  });
});
