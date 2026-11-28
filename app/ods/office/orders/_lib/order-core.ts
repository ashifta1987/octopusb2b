/**
 * ODS T9 · Back Office › Orders — pure logic (server + client + unit tests). No I/O.
 *
 *  - Appendix C names for orders.status (`staffOrderStatus`) + the exact step today's state machine is at
 *  - status tabs (`ORDER_TABS`, `TAB_STATUSES`) = server-side `.in('status', …)` filters; today's quick filters (Active,
 *    Awaiting payment, Ready to ship, Problems) are the built-in saved views with the SAME status lists as today
 *  - URL state (`parseOrderQuery` / `orderQueryHref`), filter chips, advanced filters, saved-view filters
 *  - record: stepper (`orderStepper`), moves (`orderMoves` = today's NEXT table, mirrors order_transition_allowed()),
 *    primary action (`primaryAction`), permissions (`orderPerms` = today's checks), documents (`visibleDocuments`)
 *  - `queryOrderRows` applies the same rules to sample rows (fixtures + tests)
 */
import { orderStatusName } from '@/app/ods/account/_lib/status';
import { orderServiceLabel, isSupplierDocType, SUPPLIER_DOC_TYPES, DOC_TYPE_LABEL } from '@/app/ods/admin/customers/_lib/customer-logic';
import { b2bShippingAccess } from '@/lib/warehouse-retire';

export { orderServiceLabel, isSupplierDocType, SUPPLIER_DOC_TYPES };

export const ORDERS_PATH = '/office/orders';
/** saved_views page key (viewPageKey needs a path). */
export const VIEWS_PAGE = '/office/orders';

/* ───────── statuses ───────── */

/** Today's "Active" quick filter (app/office/orders/page.tsx FILTERS.active) — also today's default. */
export const ACTIVE_STATUSES = ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped'] as const;
/** Every orders.status value today's code uses. */
export const ALL_ORDER_STATUSES = [...ACTIVE_STATUSES, 'delivered', 'closed', 'disputed', 'cancelled'] as const;

const STEP_LABEL: Record<string, string> = {
  pi_issued: 'Proforma issued',
  deposit_pending: 'Deposit pending',
  deposit_paid: 'Deposit paid',
  confirmed: 'Confirmed',
  in_production: 'In production',
  qc: 'Quality check',
  balance_pending: 'Balance pending',
  balance_paid: 'Balance paid',
  ready_to_ship: 'Ready to ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  closed: 'Closed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};
export const stepLabel = (raw: string) => STEP_LABEL[raw] ?? raw.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * orders.status → { name: Appendix C order status, step: today's exact step (staff see both), attention }.
 * Same names as the customer pages (T6 orderStatusName); `disputed` (only reachable from delivered) shows Delivered + a
 * red "Disputed" step, because Appendix C has no dispute name.
 */
export function staffOrderStatus(raw: string): { name: string; step: string; attention: boolean } {
  const name = raw === 'disputed' ? 'Delivered' : orderStatusName(raw);
  return { name, step: stepLabel(raw), attention: raw === 'disputed' };
}

/** Statuses whose Appendix C name hides the exact step (several steps share one name): staff see the step next to the pill. */
const STEP_ADDS_INFO = ['deposit_paid', 'confirmed', 'balance_paid', 'ready_to_ship', 'disputed', 'closed', 'completed'];
export const stepAddsInfo = (raw: string) => STEP_ADDS_INFO.includes(raw);

export type OrderTab = 'active' | 'waiting' | 'deposit' | 'production' | 'qc' | 'balance' | 'shipped' | 'delivered' | 'cancelled' | 'all';
export const ORDER_TABS: readonly [OrderTab, string][] = [
  ['active', 'Active'],
  ['waiting', 'Waiting for payment'],
  ['deposit', 'Deposit due'],
  ['production', 'In production'],
  ['qc', 'Quality check'],
  ['balance', 'Balance due'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
];
/** Tab → orders.status values (null = no status filter). Appendix C tabs hold exactly the statuses staffOrderStatus maps to that name. */
export const TAB_STATUSES: Record<OrderTab, readonly string[] | null> = {
  active: ACTIVE_STATUSES,
  waiting: ['pi_issued'],
  deposit: ['deposit_pending'],
  production: ['deposit_paid', 'confirmed', 'in_production', 'balance_paid', 'ready_to_ship'],
  qc: ['qc'],
  balance: ['balance_pending'],
  shipped: ['shipped'],
  delivered: ['delivered', 'completed', 'closed', 'disputed'],
  cancelled: ['cancelled'],
  all: null,
};
export const isOrderTab = (t: unknown): t is OrderTab => typeof t === 'string' && ORDER_TABS.some(([x]) => x === t);
export function matchesOrderTab(raw: string, tab: OrderTab): boolean {
  const st = TAB_STATUSES[tab];
  return st === null || st.includes(raw);
}

/** Status list the server filters on: the tab, narrowed by the `steps` filter (built-in views / Step filter). Empty = no rows. */
export function statusFilter(tab: OrderTab, steps: readonly string[] | null): string[] | null {
  const t = TAB_STATUSES[tab];
  if (!steps || !steps.length) return t ? [...t] : null;
  return t ? steps.filter((s) => t.includes(s)) : [...steps];
}

/* ───────── URL state ───────── */

export const SORTABLE: Record<string, string> = { number: 'code', total: 'total_cents', paid: 'paid_cents', updated: 'updated_at', status: 'status' };
export const PAGE_SIZES = [25, 50, 100] as const;
export type OrderQuery = {
  tab: OrderTab;
  q: string;
  /** orders.status subset (Step filter, built-in views) */
  steps: string[] | null;
  customer: string;
  sort: { id: string; desc: boolean };
  page: number;
  size: (typeof PAGE_SIZES)[number];
  view: string | null;
};
export const DEFAULT_SORT = { id: 'updated', desc: true } as const;
export const DEFAULT_QUERY: OrderQuery = { tab: 'active', q: '', steps: null, customer: '', sort: { ...DEFAULT_SORT }, page: 0, size: 25, view: null };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function parseSteps(raw: string): string[] | null {
  const list = raw.split(',').map((s) => s.trim()).filter((s) => (ALL_ORDER_STATUSES as readonly string[]).includes(s));
  return list.length ? [...new Set(list)] : null;
}

export function parseOrderQuery(sp: SP): OrderQuery {
  const tabRaw = first(sp.status) || first(sp.tab);
  // today's ?f= quick filters keep working (old links / bookmarks)
  const f = first(sp.f);
  const legacy = LEGACY_F[f];
  const tab: OrderTab = isOrderTab(tabRaw) ? tabRaw : legacy ? legacy.tab : 'active';
  const sortRaw = first(sp.sort);
  const desc = sortRaw.startsWith('-');
  const sortId = sortRaw.replace(/^-/, '');
  const size = Number(first(sp.size));
  const page = Math.max(0, Math.floor(Number(first(sp.page)) || 0));
  return {
    tab,
    q: safeSearch(first(sp.q)),
    steps: parseSteps(first(sp.steps)) ?? (legacy && !isOrderTab(tabRaw) ? legacy.steps : null),
    customer: first(sp.customer).trim().slice(0, 80),
    sort: SORTABLE[sortId] ? { id: sortId, desc } : { ...DEFAULT_SORT },
    page,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? (size as OrderQuery['size']) : 25,
    view: first(sp.view) || null,
  };
}

/** Today's ?f= values → tab + steps (same status lists as today's FILTERS). */
const LEGACY_F: Record<string, { tab: OrderTab; steps: string[] | null }> = {
  active: { tab: 'active', steps: null },
  awaiting_payment: { tab: 'all', steps: ['deposit_pending', 'balance_pending'] },
  ready_to_ship: { tab: 'all', steps: ['ready_to_ship'] },
  delivered: { tab: 'all', steps: ['delivered', 'closed'] },
  problems: { tab: 'all', steps: ['disputed', 'cancelled'] },
  all: { tab: 'all', steps: null },
};

export function orderQueryParams(q: OrderQuery, extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams(extra);
  if (q.tab !== DEFAULT_QUERY.tab) p.set('status', q.tab);
  if (q.q) p.set('q', q.q);
  if (q.steps?.length) p.set('steps', q.steps.join(','));
  if (q.customer) p.set('customer', q.customer);
  if (q.sort.id !== DEFAULT_SORT.id || q.sort.desc !== DEFAULT_SORT.desc) p.set('sort', `${q.sort.desc ? '-' : ''}${q.sort.id}`);
  if (q.page) p.set('page', String(q.page));
  if (q.size !== 25) p.set('size', String(q.size));
  if (q.view) p.set('view', q.view);
  return p;
}
export function orderQueryHref(base: string, q: OrderQuery, extra: Record<string, string> = {}): string {
  const s = orderQueryParams(q, extra).toString();
  return s ? `${base}?${s}` : base;
}

/** Same sanitising as today's search (commas and brackets break the PostgREST or()), trimmed, ≤ 80 chars. */
export function safeSearch(q: string): string {
  return String(q ?? '').replace(/[,()%*\\]/g, '').trim().slice(0, 80);
}

export function filterChips(q: OrderQuery): { id: 'steps' | 'customer'; label: string }[] {
  const out: { id: 'steps' | 'customer'; label: string }[] = [];
  if (q.steps?.length) out.push({ id: 'steps', label: `Step: ${q.steps.map(stepLabel).join(', ')}` });
  if (q.customer) out.push({ id: 'customer', label: `Customer: ${q.customer}` });
  return out;
}

export const STEP_OPTIONS = ALL_ORDER_STATUSES.map((s) => stepLabel(s));

/** Advanced filter panel (field / operator / value) → query. Unknown values are ignored. */
export function applyConditions(q: OrderQuery, conditions: { field: string; operator: string; value: string }[]): OrderQuery {
  const next: OrderQuery = { ...q, page: 0, view: null };
  for (const c of conditions) {
    const v = String(c.value ?? '').trim();
    if (c.field === 'steps') {
      const raw = ALL_ORDER_STATUSES.find((s) => stepLabel(s).toLowerCase() === v.toLowerCase() || s === v);
      if (raw) next.steps = [...new Set([...(next.steps ?? []), raw])];
    } else if (c.field === 'customer') {
      next.customer = v.slice(0, 80);
    }
  }
  return next;
}

export function viewFilters(q: OrderQuery): Record<string, unknown> {
  return { tab: q.tab, q: q.q, steps: q.steps, customer: q.customer };
}
export function queryFromView(filters: unknown, viewId: string): OrderQuery {
  const f = (filters ?? {}) as { tab?: unknown; q?: unknown; steps?: unknown; customer?: unknown };
  return {
    ...DEFAULT_QUERY,
    tab: isOrderTab(f.tab) ? f.tab : 'active',
    q: safeSearch(typeof f.q === 'string' ? f.q : ''),
    steps: Array.isArray(f.steps) ? parseSteps(f.steps.map(String).join(',')) : null,
    customer: typeof f.customer === 'string' ? f.customer.slice(0, 80) : '',
    view: viewId || null,
  };
}
/** Today's quick filters, as built-in views (they always work, also before saved views are switched on). */
export const BUILTIN_VIEWS: { id: string; label: string; filters: Record<string, unknown> }[] = [
  { id: 'builtin:active', label: 'Active orders', filters: { tab: 'active' } },
  { id: 'builtin:awaiting', label: 'Awaiting payment', filters: { tab: 'all', steps: ['deposit_pending', 'balance_pending'] } },
  { id: 'builtin:ready', label: 'Ready to ship', filters: { tab: 'all', steps: ['ready_to_ship'] } },
  { id: 'builtin:problems', label: 'Problems (disputed, cancelled)', filters: { tab: 'all', steps: ['disputed', 'cancelled'] } },
];

/* ───────── rows + figures ───────── */

export type OrderRow = {
  id: string;
  code: string;
  title: string;
  quantity: number | null;
  status: string;
  statusName: string;
  step: string;
  attention: boolean;
  service: string;
  customer: string;
  customerId: string | null;
  country: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  depositDueMinor: number;
  owner: { initials: string; name: string } | null;
  /** only with the supplier permission (else undefined: the column is not even built) */
  supplierCode?: string | null;
  updatedAt: string;
  createdAt: string;
};

/** Balance = total − paid; deposit due = deposit − paid (both ≥ 0): the same sums today's order page shows. */
export function orderFigures(o: { total_cents: number | null; paid_cents: number | null; deposit_cents?: number | null }) {
  const total = Number(o.total_cents ?? 0);
  const paid = Number(o.paid_cents ?? 0);
  return { totalMinor: total, paidMinor: paid, balanceMinor: Math.max(0, total - paid), depositDueMinor: Math.max(0, Number(o.deposit_cents ?? 0) - paid) };
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Fixtures / tests: the same tab, steps, search, customer, sort and page rules the server applies. */
export function queryOrderRows(rows: readonly OrderRow[], q: OrderQuery): { rows: OrderRow[]; total: number } {
  const st = statusFilter(q.tab, q.steps);
  const text = q.q.toLowerCase();
  const cust = q.customer.toLowerCase();
  let list = rows.filter((r) => (st === null || st.includes(r.status)) && (!text || r.code.toLowerCase().includes(text) || r.title.toLowerCase().includes(text)) && (!cust || r.customer.toLowerCase().includes(cust)));
  const key = q.sort.id;
  const val = (r: OrderRow): string | number => (key === 'number' ? r.code : key === 'total' ? r.totalMinor : key === 'paid' ? r.paidMinor : key === 'status' ? r.status : r.updatedAt);
  list = [...list].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return q.sort.desc ? -c : c;
  });
  const total = list.length;
  return { rows: list.slice(q.page * q.size, q.page * q.size + q.size), total };
}

export function tabCounts(rows: readonly OrderRow[]): Record<OrderTab, number> {
  const out = {} as Record<OrderTab, number>;
  for (const [t] of ORDER_TABS) out[t] = rows.filter((r) => matchesOrderTab(r.status, t)).length;
  return out;
}

/* ───────── record ───────── */

export const ORDER_STEPS = ['Quote', 'Deposit', 'Production', 'QC', 'Balance', 'Shipping', 'Delivered'] as const;
const STEP_INDEX: Record<string, number> = {
  pi_issued: 0,
  deposit_pending: 1,
  deposit_paid: 2,
  confirmed: 2,
  in_production: 2,
  qc: 3,
  balance_pending: 4,
  balance_paid: 5,
  ready_to_ship: 5,
  shipped: 5,
  delivered: 7,
  completed: 7,
  closed: 7,
  disputed: 6,
  cancelled: 1,
};
export type StepState = 'done' | 'current' | 'upcoming' | 'error';
/**
 * Stepper Quote → Deposit → Production → QC → Balance → Shipping → Delivered. Every service runs the same order state
 * machine today (order_transition_allowed), so the steps are the same; QC can be skipped (in_production → balance_pending).
 * delivered / closed = all done; disputed = error on Delivered; cancelled (only allowed before production) = error on Deposit.
 */
export function orderStepper(raw: string): { current: number; states: StepState[]; errorText: string | null } {
  const idx = STEP_INDEX[raw] ?? 2;
  const errorAt = raw === 'disputed' ? 6 : raw === 'cancelled' ? 1 : -1;
  const states = ORDER_STEPS.map((_, i): StepState => (i === errorAt ? 'error' : i < idx ? 'done' : i === idx ? 'current' : 'upcoming'));
  return { current: Math.min(idx, ORDER_STEPS.length - 1), states, errorText: raw === 'disputed' ? 'Disputed' : raw === 'cancelled' ? 'Cancelled' : null };
}

/** Today's NEXT table (app/office/orders/[id]/page.tsx — mirrors order_transition_allowed()). */
export const NEXT: Record<string, string[]> = {
  pi_issued: ['deposit_pending', 'cancelled'],
  deposit_pending: ['deposit_paid', 'cancelled'],
  deposit_paid: ['confirmed'],
  confirmed: ['in_production'],
  in_production: ['qc', 'balance_pending'],
  qc: ['balance_pending'],
  balance_pending: ['balance_paid'],
  balance_paid: ['ready_to_ship'],
  ready_to_ship: ['shipped'],
  shipped: ['delivered'],
  delivered: ['closed', 'disputed'],
  disputed: ['closed'],
};
/** Moves offered on the record: today's list without `shipped` (shipping goes through Warehouse OS › B2B shipments). */
export const orderMoves = (raw: string) => (NEXT[raw] ?? []).filter((t) => t !== 'shipped');
export const reasonRequired = (to: string) => to === 'cancelled' || to === 'disputed';
export const isDestructiveMove = reasonRequired;
export const moveLabel = (to: string) => (reasonRequired(to) ? (to === 'cancelled' ? 'Cancel order' : 'Open dispute') : `Move to ${stepLabel(to)}`);
export const SHIPMENT_HREF = (orderId: string) => `/office/warehouse/b2b-shipments?order=${orderId}`;

export type OrderPerms = { canEdit: boolean; canPay: boolean; canSeeSuppliers: boolean; canSeeCarrier: boolean; canDownloadLabels: boolean; canSeeTickets: boolean };
/** Today's checks on the order page, unchanged (orders:edit moves, finance:approve records payments, supplier = admin / suppliers:view / finance:view …). */
export function orderPerms(s: { isAdmin: boolean; can: (area: string, action: string) => boolean }): OrderPerms {
  const canEdit = s.can('orders', 'edit');
  return {
    canEdit,
    canPay: s.can('finance', 'approve'),
    canSeeSuppliers: s.isAdmin || s.can('suppliers', 'view') || s.can('finance', 'view'),
    canSeeCarrier: b2bShippingAccess(s).canSeeCarrier,
    canDownloadLabels: s.isAdmin || canEdit || s.can('warehouse', 'view'),
    canSeeTickets: s.isAdmin || s.can('support', 'view'),
  };
}

/** Why Record payment is not offered (null = offered). Same two rules as today's "Record bank payment" card. */
export function paymentBlock(balanceMinor: number, canPay: boolean): string | null {
  if (!canPay) return 'Only Finance can record payments.';
  if (balanceMinor <= 0) return 'This order is fully paid.';
  return null;
}
/** Today's default amount: the deposit still due, else the balance. */
export const defaultPaymentMinor = (f: { depositDueMinor: number; balanceMinor: number }) => f.depositDueMinor || f.balanceMinor;

export type PrimaryAction = { kind: 'pay'; label: string } | { kind: 'ship'; label: string; href: string } | { kind: 'move'; to: string; label: string } | null;
/** The header's main button for the current step. */
export function primaryAction(o: { id: string; status: string; balanceMinor: number }, perms: Pick<OrderPerms, 'canEdit' | 'canPay'>): PrimaryAction {
  if ((o.status === 'deposit_pending' || o.status === 'balance_pending') && !paymentBlock(o.balanceMinor, perms.canPay)) {
    return { kind: 'pay', label: o.status === 'deposit_pending' ? 'Record deposit' : 'Record balance' };
  }
  if (!perms.canEdit) return null;
  if (o.status === 'ready_to_ship') return { kind: 'ship', label: 'Create shipment', href: SHIPMENT_HREF(o.id) };
  const next = orderMoves(o.status).find((t) => !reasonRequired(t));
  return next ? { kind: 'move', to: next, label: moveLabel(next) } : null;
}

export const ORDER_RECORD_TABS = ['overview', 'items', 'documents', 'payments', 'shipping', 'messages', 'timeline'] as const;
export type OrderRecordTab = (typeof ORDER_RECORD_TABS)[number];
export const isOrderRecordTab = (t: unknown): t is OrderRecordTab => typeof t === 'string' && (ORDER_RECORD_TABS as readonly string[]).includes(t);

export const docTypeLabel = (t: string) => DOC_TYPE_LABEL[t] ?? (t === 'purchase_order' ? 'Purchase order' : t === 'remittance' ? 'Remittance' : stepLabel(t));
/**
 * Supplier visibility — coordinator decision (27 Nov 2026): permissions stay EXACTLY as today.
 *  - Orders list + Support ticket: supplier codes come from today's withSuppliers for every viewer, limited only by
 *    suppliers RLS (nothing returned → "—").
 *  - Order record: the supplier line keeps today's admin / suppliers:view / finance:view check; the Documents tab lists
 *    every document the user can read (RLS), purchase orders and remittances included, as today.
 * ODS_SUPPLIER_STRICT = true would apply the stricter Part 7.7 rule (supplier codes and supplier documents only with
 * admin / suppliers:view / finance:view) to all three places. Owner decision before switching it on.
 */
export const ODS_SUPPLIER_STRICT: boolean = false;
export const showSupplierCodes = (canSeeSuppliers: boolean, strict: boolean = ODS_SUPPLIER_STRICT) => !strict || canSeeSuppliers;
export const showSupplierDocs = (canSeeSuppliers: boolean, strict: boolean = ODS_SUPPLIER_STRICT) => !strict || canSeeSuppliers;
export function visibleDocuments<T extends { type: string }>(docs: readonly T[], canSeeSuppliers: boolean, strict: boolean = ODS_SUPPLIER_STRICT): T[] {
  return docs.filter((d) => showSupplierDocs(canSeeSuppliers, strict) || !isSupplierDocType(d.type));
}

/** Today's order payment check (app/office/actions.ts Payment schema): amount > 0, method bank_transfer | card | other,
 *  reference trimmed 3–120 chars; plus amount ≤ balance (the RPC checks again). */
export const ORDER_REFERENCE_MAX = 120;
export function validateOrderPayment(input: { amount: string; reference: string; method: string }, maxMinor: number): { amount?: string; reference?: string; method?: string } {
  const e: { amount?: string; reference?: string; method?: string } = {};
  const n = Number(String(input.amount).replace(/,/g, '').trim());
  const m = Number.isFinite(n) ? Math.round(n * 100) : NaN;
  if (!String(input.amount).trim() || !Number.isFinite(m) || m <= 0) e.amount = 'Enter the amount received.';
  else if (m > maxMinor) e.amount = 'This is more than the balance due.';
  const ref = String(input.reference).trim();
  if (ref.length < 3) e.reference = 'Bank reference required (3 characters or more).';
  else if (ref.length > ORDER_REFERENCE_MAX) e.reference = `Use ${ORDER_REFERENCE_MAX} characters or fewer.`;
  if (!['bank_transfer', 'card', 'other'].includes(input.method)) e.method = 'Choose a method.';
  return e;
}
