/**
 * ODS /account/orders — pure order logic (unit tested in tests/unit/ods-account-commerce.test.ts).
 * Status words come from Appendix C; the money figures are TODAY's (`dueNow` from components/account/order-utils, the
 * same rule today's pay action uses) — nothing is recalculated here.
 */
import { dueNow, type OrderMoney } from '@/components/account/order-utils';
import type { PaymentServiceCode } from '@/lib/payments';
import { orderStatusName as frameOrderStatusName } from '../../_lib/status';
import { hrefWith, one, type SearchParamsRecord } from './commerce-format';

/* ───────── services ───────── */

export type OrderService = 'sourcing' | 'pools' | 'turnkey' | 'warehouse' | 'brand' | 'dropship';
export const ORDER_SERVICES: OrderService[] = ['sourcing', 'pools', 'turnkey', 'warehouse', 'brand', 'dropship'];
export const SERVICE_LABEL: Record<OrderService, string> = {
  sourcing: 'Sourcing',
  pools: 'MOQ pool',
  turnkey: 'Turnkey',
  warehouse: 'Warehouse (3PL)',
  brand: 'Make My Brand',
  dropship: 'Dropshipping',
};
export const isOrderService = (s: string): s is OrderService => (ORDER_SERVICES as string[]).includes(s);

/** Division code → service. The SAME mapping today's order page uses to pick the payment service (app/account/orders/[id]). */
export function serviceFromDivision(code: string | null | undefined): OrderService & PaymentServiceCode {
  return code === 'DS' ? 'dropship' : code === 'MMB' ? 'brand' : code === 'POOL' ? 'pools' : code === 'TK' ? 'turnkey' : code === '3PL' ? 'warehouse' : 'sourcing';
}

/* ───────── status (Appendix C) ───────── */

export const ORDER_STATUS_NAMES = ['Waiting for payment', 'Deposit due', 'In production', 'Quality check', 'Balance due', 'Shipped', 'Delivered', 'Cancelled'] as const;
export type OrderStatusName = (typeof ORDER_STATUS_NAMES)[number];

/**
 * Raw order_status → Appendix C name: the FRAME builder's shared map (app/ods/account/_lib/status.ts, also used by
 * Home › In progress) plus two raw values that map lacks: `closed` → Delivered, and `disputed` (no Appendix C name) →
 * Delivered when delivered, else In production, with a separate "Dispute open" flag (see `isDisputed`).
 */
export function orderStatusName(raw: string, o: { delivered_at?: string | null } = {}): OrderStatusName {
  if (raw === 'closed') return 'Delivered';
  if (raw === 'disputed') return o.delivered_at ? 'Delivered' : 'In production';
  const n = frameOrderStatusName(raw);
  return (ORDER_STATUS_NAMES as readonly string[]).includes(n) ? (n as OrderStatusName) : 'In production';
}
export const isDisputed = (raw: string) => raw === 'disputed';

/* ───────── list filters (CardTabs + pills + view + sort + page, all in the URL) ───────── */

export type OrderCard = 'all' | 'waiting' | 'production' | 'shipped';
export const ORDER_CARDS: OrderCard[] = ['all', 'waiting', 'production', 'shipped'];
export type OrderSort = 'newest' | 'oldest' | 'total-desc' | 'total-asc';
export const ORDER_SORTS: [OrderSort, string][] = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['total-desc', 'Total: high to low'],
  ['total-asc', 'Total: low to high'],
];
export type OrderView = 'list' | 'board';
export const ORDERS_PAGE_SIZE = 20;

export type OrdersState = { status: OrderCard; service: OrderService | 'all'; view: OrderView; sort: OrderSort; page: number; q: string };

export function parseOrdersParams(sp: SearchParamsRecord): OrdersState {
  const status = one(sp.status) as OrderCard;
  const service = one(sp.service);
  const sort = one(sp.sort) as OrderSort;
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  return {
    status: ORDER_CARDS.includes(status) ? status : 'all',
    service: isOrderService(service) ? service : 'all',
    view: one(sp.view) === 'board' ? 'board' : 'list',
    sort: ORDER_SORTS.some(([k]) => k === sort) ? sort : 'newest',
    page,
    q: one(sp.q).trim().slice(0, 80),
  };
}

export function ordersHref(s: OrdersState, patch: Partial<OrdersState> = {}, base = '/account/orders'): string {
  const n = { ...s, ...patch };
  // any filter change goes back to page 1 unless the page itself is patched
  if (!('page' in patch)) n.page = 1;
  return hrefWith(base, {
    status: n.status === 'all' ? null : n.status,
    service: n.service === 'all' ? null : n.service,
    view: n.view === 'list' ? null : n.view,
    sort: n.sort === 'newest' ? null : n.sort,
    page: n.page > 1 ? n.page : null,
    q: n.q || null,
  });
}

/** Source row as loaded (customer-safe columns only). */
export type OrderSource = OrderMoney & {
  id: string;
  code: string;
  title: string;
  quantity: number;
  currency: string;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  service: OrderService;
  pool: boolean;
  hasShipment: boolean;
};

export type NextActionKind = 'pay_deposit' | 'pay_balance' | 'track' | 'view_pool' | 'view';
export type NextAction = { kind: NextActionKind; label: string; href: string; primary: boolean };

/** The action button that matches the next step. Reorder is not offered: today's app has no reorder for orders. */
export function nextAction(o: OrderSource): NextAction {
  const detail = `/account/orders/${encodeURIComponent(o.code)}`;
  const due = dueNow(o);
  if (due) return { kind: due.purpose === 'deposit' ? 'pay_deposit' : 'pay_balance', label: due.purpose === 'deposit' ? 'Pay deposit' : 'Pay balance', href: `${detail}#payment`, primary: true };
  if (o.status === 'shipped' && o.hasShipment) return { kind: 'track', label: 'Track', href: `${detail}?tab=shipping`, primary: false };
  if (o.pool && !['delivered', 'closed', 'cancelled'].includes(o.status)) return { kind: 'view_pool', label: 'View pool', href: '/account/pools', primary: false };
  return { kind: 'view', label: 'View', href: detail, primary: false };
}

export type OrderRowVM = {
  id: string;
  ref: string;
  title: string;
  quantity: number;
  service: OrderService;
  statusName: OrderStatusName;
  rawStatus: string;
  dispute: boolean;
  totalCents: number;
  currency: string;
  updatedAt: string;
  createdAt: string;
  next: NextAction;
  waiting: boolean;
};

export function toOrderRow(o: OrderSource): OrderRowVM {
  return {
    id: o.id,
    ref: o.code,
    title: o.title,
    quantity: Number(o.quantity),
    service: o.service,
    statusName: orderStatusName(o.status, o),
    rawStatus: o.status,
    dispute: isDisputed(o.status),
    totalCents: Number(o.total_cents),
    currency: o.currency,
    updatedAt: o.updated_at,
    createdAt: o.created_at,
    next: nextAction(o),
    waiting: dueNow(o) !== null,
  };
}

export function matchesCard(r: OrderRowVM, card: OrderCard): boolean {
  if (card === 'waiting') return r.waiting;
  if (card === 'production') return r.statusName === 'In production' || r.statusName === 'Quality check';
  if (card === 'shipped') return r.statusName === 'Shipped';
  return true;
}

export type OrdersListVM = {
  rows: OrderRowVM[];
  total: number;
  filteredTotal: number;
  cardCounts: Record<OrderCard, number>;
  serviceCounts: Partial<Record<OrderService, number>>;
  pages: number;
  page: number;
  board: { status: OrderStatusName; rows: OrderRowVM[] }[];
};

/** Filters (card AND service AND search), counts, sort, pagination and board columns — in memory over ≤ 500 orders. */
export function buildOrdersList(all: OrderRowVM[], s: OrdersState): OrdersListVM {
  const q = s.q.toLowerCase();
  const searched = q ? all.filter((r) => r.ref.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)) : all;
  const byService = s.service === 'all' ? searched : searched.filter((r) => r.service === s.service);
  const cardCounts = Object.fromEntries(ORDER_CARDS.map((c) => [c, byService.filter((r) => matchesCard(r, c)).length])) as Record<OrderCard, number>;
  const byCard = searched.filter((r) => matchesCard(r, s.status));
  const serviceCounts: Partial<Record<OrderService, number>> = {};
  for (const r of byCard) serviceCounts[r.service] = (serviceCounts[r.service] ?? 0) + 1;
  const filtered = s.service === 'all' ? byCard : byCard.filter((r) => r.service === s.service);
  const sorted = [...filtered].sort((a, b) => {
    switch (s.sort) {
      case 'oldest':
        return a.updatedAt.localeCompare(b.updatedAt);
      case 'total-desc':
        return b.totalCents - a.totalCents;
      case 'total-asc':
        return a.totalCents - b.totalCents;
      default:
        return b.updatedAt.localeCompare(a.updatedAt);
    }
  });
  const pages = Math.max(1, Math.ceil(sorted.length / ORDERS_PAGE_SIZE));
  const page = Math.min(s.page, pages);
  const rows = s.view === 'board' ? sorted : sorted.slice((page - 1) * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE);
  const board = ORDER_STATUS_NAMES.map((status) => ({ status, rows: sorted.filter((r) => r.statusName === status) })).filter((c) => c.rows.length > 0);
  return { rows, total: all.length, filteredTotal: sorted.length, cardCounts, serviceCounts, pages, page, board };
}

/* ───────── detail: stepper per service ───────── */

/** Canonical positions: quote 0, deposit 1, production 2, qc 3, balance 4, shipping 5, delivered 6. */
export type StepKey = 'quote' | 'pool' | 'deposit' | 'payment' | 'production' | 'packing' | 'qc' | 'balance' | 'shipping' | 'delivered';
export type OrderStepDef = { key: StepKey; label: string; canon: number };

const STD: OrderStepDef[] = [
  { key: 'quote', label: 'Quote', canon: 0 },
  { key: 'deposit', label: 'Deposit', canon: 1 },
  { key: 'production', label: 'Production', canon: 2 },
  { key: 'qc', label: 'Quality check', canon: 3 },
  { key: 'balance', label: 'Balance', canon: 4 },
  { key: 'shipping', label: 'Shipping', canon: 5 },
  { key: 'delivered', label: 'Delivered', canon: 6 },
];

/** Steps depend on the service (6.5): goods orders use all seven; pools start with the pool; dropship and 3PL are shorter. */
export function stepsForService(svc: OrderService): OrderStepDef[] {
  switch (svc) {
    case 'pools':
      return [{ key: 'pool', label: 'Pool', canon: 0 }, ...STD.slice(1)];
    case 'dropship':
      return [
        { key: 'payment', label: 'Payment', canon: 1 },
        { key: 'packing', label: 'Packing', canon: 2 },
        { key: 'shipping', label: 'Shipping', canon: 5 },
        { key: 'delivered', label: 'Delivered', canon: 6 },
      ];
    case 'warehouse':
      return [
        { key: 'quote', label: 'Quote', canon: 0 },
        { key: 'payment', label: 'Payment', canon: 1 },
        { key: 'shipping', label: 'Shipping', canon: 5 },
        { key: 'delivered', label: 'Delivered', canon: 6 },
      ];
    default:
      return STD;
  }
}

/** Raw status → canonical position of the CURRENT step (7 = everything done; -1 = no stepper: cancelled). */
export function statusPosition(raw: string, deliveredAt?: string | null): number {
  switch (raw) {
    case 'pi_issued':
    case 'deposit_pending':
      return 1;
    case 'deposit_paid':
    case 'confirmed':
    case 'in_production':
      return 2;
    case 'qc':
      return 3;
    case 'balance_pending':
      return 4;
    case 'balance_paid':
    case 'ready_to_ship':
    case 'shipped':
      return 5;
    case 'delivered':
    case 'closed':
      return 7;
    case 'disputed':
      return deliveredAt ? 7 : 2;
    case 'cancelled':
      return -1;
    default:
      return 0;
  }
}

/** Index of the current step in `steps` (steps.length = all done; -1 = cancelled). */
export function currentStepIndex(steps: OrderStepDef[], raw: string, deliveredAt?: string | null): number {
  const pos = statusPosition(raw, deliveredAt);
  if (pos < 0) return -1;
  const i = steps.findIndex((s) => s.canon >= pos);
  return i < 0 ? steps.length : i;
}

/** "What happens next" from the current step (plain words; no invented dates). */
export function nextSteps(steps: OrderStepDef[], current: number): { key: StepKey; title: string; state: 'current' | 'next' }[] {
  if (current < 0 || current >= steps.length) return [];
  const T: Record<StepKey, string> = {
    quote: 'Accept the quote',
    pool: 'The pool fills',
    deposit: 'Pay the deposit',
    payment: 'Pay for the order',
    production: 'The factory makes your goods',
    packing: 'We pack your order',
    qc: 'Quality check before shipping',
    balance: 'Pay the balance',
    shipping: 'We book and ship your goods',
    delivered: 'Delivery to your address',
  };
  return steps.slice(current, current + 4).map((s, i) => ({ key: s.key, title: T[s.key], state: i === 0 ? 'current' : 'next' }));
}

/* ───────── detail: payment choices (same gating as today's ChooseHowToPay + quick wallet checkout) ───────── */

export type OptionRow = { option: string; enabled: boolean; min_amount_cents: number | null; max_amount_cents: number | null };

/** Identical to `isOptionEnabled` in components/account/choose-how-to-pay.tsx. */
export function isOptionEnabled(cfg: OptionRow | undefined, amountCents: number): boolean {
  if (!cfg || !cfg.enabled) return false;
  if (amountCents < Number(cfg.min_amount_cents ?? 0)) return false;
  if (cfg.max_amount_cents != null && amountCents > Number(cfg.max_amount_cents)) return false;
  return true;
}

export type PaymentChoices = {
  /** quick wallet checkout → TODAY's payFromWallet (record_payment) */
  wallet: boolean;
  /** pay now online → TODAY's startOnlineCheckoutAction('pay_now') */
  online: boolean;
  /** Payment protection → TODAY's payWithProtectionFromWalletAction / startOnlineCheckoutAction('payment_protection') */
  protection: boolean;
  protectionWallet: boolean;
  protectionOnline: boolean;
};

/**
 * Which pay buttons show. Mirrors today's order page: quick wallet = due && wallet on && no protection hold && no credit
 * reservation; the option matrix gates pay now / Payment protection; online needs an active provider. Pay later has its
 * own gate (`payLaterChoice`, credit-eligible companies only).
 */
export function paymentChoices(p: {
  dueAmount: number | null;
  amountCents: number;
  walletEnabled: boolean;
  hasHold: boolean;
  hasReservation: boolean;
  options: OptionRow[];
  hasProvider: boolean;
  cancelled: boolean;
}): PaymentChoices {
  const none = { wallet: false, online: false, protection: false, protectionWallet: false, protectionOnline: false };
  if (p.cancelled || p.hasHold || p.hasReservation || p.amountCents <= 0) return none;
  const by = Object.fromEntries(p.options.map((r) => [r.option, r])) as Record<string, OptionRow | undefined>;
  const payNow = isOptionEnabled(by.pay_now, p.amountCents);
  const prot = isOptionEnabled(by.payment_protection, p.amountCents);
  const wallet = p.dueAmount !== null && p.walletEnabled;
  const protectionWallet = prot && p.walletEnabled;
  const protectionOnline = prot && p.hasProvider;
  return { wallet, online: payNow && p.hasProvider, protection: protectionWallet || protectionOnline, protectionWallet, protectionOnline };
}

/** get_customer_credit_status RPC result (today's CustomerCreditStatus fields we use). */
export type CreditStatusLike = { eligible: boolean; available_cents: number; credit_limit_cents: number; unpaid_invoices_cents: number; reserved_cents: number; net_days: number };

/**
 * Pay later — today's ChooseHowToPay rule, unchanged (Part 1 rule 8: internal only):
 *   show    = pay_later option enabled for the service and the amount (isOptionEnabled) AND creditStatus.eligible,
 *             and the options panel is showing (no Payment protection hold, no reserved credit reservation, not cancelled);
 *   allowed = show AND available credit ≥ amount (otherwise today shows "Pay later unavailable: Insufficient available
 *             credit (… available)").
 * Not eligible → { show: false }: nothing about Pay later is rendered, not even disabled.
 */
export function payLaterChoice(p: { amountCents: number; options: OptionRow[]; credit: CreditStatusLike | null; hasHold: boolean; reservationReserved: boolean; cancelled: boolean }): { show: boolean; allowed: boolean } {
  const cfg = p.options.find((r) => r.option === 'pay_later');
  const show = !p.cancelled && !p.hasHold && !p.reservationReserved && p.amountCents > 0 && isOptionEnabled(cfg, p.amountCents) && Boolean(p.credit?.eligible);
  return { show, allowed: show && Number(p.credit?.available_cents ?? 0) >= p.amountCents };
}

/** Same rule as today's ConfirmChargeCurrency: the wallet may go down to −credit; below that the payment is blocked. */
export const walletCovers = (amountCents: number, balanceCents: number, creditCents: number) => balanceCents + creditCents >= amountCents;

/* ───────── payments (Appendix C payment names) ───────── */

export function paymentStatusName(raw: string): 'Pending' | 'Paid' | 'Held' | 'Released' | 'Refunded' | 'Failed' {
  switch (raw) {
    case 'confirmed':
    case 'paid':
    case 'succeeded':
      return 'Paid';
    case 'failed':
    case 'rejected':
      return 'Failed';
    case 'refunded':
      return 'Refunded';
    case 'held':
      return 'Held';
    case 'released':
      return 'Released';
    default:
      return 'Pending';
  }
}

export function paymentMethodLabel(m: string | null | undefined): string {
  switch (m) {
    case 'wallet':
      return 'Wallet';
    case 'bank':
    case 'bank_transfer':
    case 'wire':
      return 'Bank transfer';
    case 'card':
      return 'Card';
    default:
      return m ? m.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—';
  }
}

export function paymentPurposeLabel(p: string | null | undefined): string {
  return p === 'deposit' ? 'Deposit' : p === 'balance' ? 'Balance' : p ? p.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Payment';
}

/** Escrow hold state words (display only; the held figure = amount − released − refunded, as today). */
export function holdStatusName(s: string): 'Held' | 'Released' | 'Refunded' {
  return s === 'released' ? 'Released' : s === 'refunded' ? 'Refunded' : 'Held';
}
