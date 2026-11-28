/**
 * ODS T9 · Back Office › Services › MOQ pools (today's Admin › Group buying) — pure logic (server + client + tests).
 *
 * - Filters (`?status=` / `?closing=1` / `?pool=`) are today's URL keys and lists, unchanged.
 * - Status names: Appendix C "Pools" through the Shop's shared rule (`poolStatusName`, so staff and buyers read the same
 *   words); today's raw step stays as a detail ("Waiting for balances", "Shipped" …).
 * - Action visibility = today's page exactly (who sees Extend / Force-settle / Cancel & refund / Confirm deposit / Mark
 *   defaulted). The RPCs re-check permissions; nothing here moves money.
 * - Supplier code: today's suppliers read, limited by RLS (suppliers_staff); "—" when it returns nothing (ODS_SUPPLIER_STRICT).
 */
import { poolStatusName } from '@/app/ods/shop/pools/_lib/pool-logic';

export const POOLS_PATH = '/admin/pools';

/**
 * Supplier visibility. false (default) = exactly today: the suppliers read runs with the staff session and RLS
 * (suppliers_staff: suppliers:view) decides; an empty result shows "—". true = also skip the read without suppliers:view.
 */
export const ODS_SUPPLIER_STRICT = false;

/** Today's status list (`?status=`, default open) */
export const POOL_STATUSES = ['open', 'locked', 'confirmed', 'shipped', 'completed', 'expired', 'cancelled'] as const;
export type PoolTab = (typeof POOL_STATUSES)[number] | 'all' | 'closing';

export const POOL_TABS: [PoolTab, string][] = [
  ['open', 'Open'],
  ['closing', 'Closing within 48 h'],
  ['locked', 'Waiting for balances'],
  ['confirmed', 'Confirmed'],
  ['shipped', 'Shipped'],
  ['completed', 'Completed'],
  ['expired', 'Expired'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
];

export type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export type PoolQuery = { tab: PoolTab; pool: string | null };

/** Same parsing as today: unknown status → open; `closing=1` wins (open + deadline within 48 h). */
export function parsePoolQuery(sp: SP): PoolQuery {
  const st = first(sp.status) ?? '';
  const closing = first(sp.closing) === '1';
  const pool = first(sp.pool) ?? null;
  const tab: PoolTab = closing ? 'closing' : (POOL_STATUSES as readonly string[]).includes(st) ? (st as PoolTab) : st === 'all' ? 'all' : 'open';
  return { tab, pool: pool && /^[0-9a-f-]{36}$/i.test(pool) ? pool : null };
}

/** Today's href rule: open has no param, closing = `?closing=1`. */
export function poolQueryHref(base: string, q: PoolQuery, extra?: Record<string, string>): string {
  const u = new URLSearchParams(extra);
  if (q.tab === 'closing') u.set('closing', '1');
  else if (q.tab !== 'open') u.set('status', q.tab);
  if (q.pool) u.set('pool', q.pool);
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

export const RAW_LABEL: Record<string, string> = {
  open: 'Open', locked: 'Waiting for balances', confirmed: 'Confirmed', shipped: 'Shipped', completed: 'Completed', expired: 'Expired', cancelled: 'Cancelled',
};

export function poolStatus(p: { status: string; filledQty: number; targetQty: number; deadlineAt: string }, nowMs: number): { name: string; detail: string | null } {
  const name = poolStatusName(p, nowMs);
  const raw = RAW_LABEL[p.status] ?? p.status;
  return { name, detail: raw === name ? null : raw };
}

export function fillPct(filled: number, target: number): number {
  return target > 0 ? Math.min(100, Math.round((filled / target) * 100)) : 0;
}

/** Today's: closing within 48 h = open and deadline less than 48 h away. */
export const closingSoon48 = (status: string, deadlineAt: string, nowMs: number) => status === 'open' && Date.parse(deadlineAt) - nowMs < 48 * 3600e3;

/* ───────── money sums (display only, today's sumByCurrency rules) ───────── */

export type Minor = { minor: number; currency: string };
export function sumByCurrency<T>(rows: readonly T[], amount: (r: T) => number, currency: (r: T) => string): Minor[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(currency(r), (m.get(currency(r)) ?? 0) + amount(r));
  return [...m].map(([c, v]) => ({ currency: c, minor: v }));
}

export type PledgeLike = { status: string; qty: number; deposit_minor: number; currency: string };
/** Active pledges (buyers count) = today's list. */
export const ACTIVE_PLEDGE = ['pending', 'paid', 'confirmed', 'shipped', 'delivered'];
/** Deposits held per pool = paid + confirmed pledges (today's per-row figure). */
export function poolDeposits(pledges: readonly PledgeLike[]): Minor[] {
  return sumByCurrency(pledges.filter((x) => x.status === 'paid' || x.status === 'confirmed'), (x) => x.deposit_minor, (x) => x.currency);
}
/** Quantity force-settle would keep (paid pledges) — today's confirm text. */
export const paidQty = (pledges: readonly PledgeLike[]) => pledges.filter((x) => x.status === 'paid').reduce((a, x) => a + x.qty, 0);

/* ───────── permissions = today's page ───────── */

export type PoolPerms = {
  isAdmin: boolean;
  /** orders:approve (or admin): Extend, Cancel & refund */
  approve: boolean;
  /** orders:edit: Mark defaulted */
  edit: boolean;
  /** wallet:approve: Confirm deposit */
  finance: boolean;
  /** whether to run the suppliers read: always (today, RLS limits it) unless ODS_SUPPLIER_STRICT and no suppliers:view */
  readSuppliers: boolean;
};

export function poolPerms(isAdmin: boolean, can: (area: string, action?: string) => boolean): PoolPerms {
  return { isAdmin, approve: isAdmin || can('orders', 'approve'), edit: can('orders', 'edit'), finance: can('wallet', 'approve'), readSuppliers: ODS_SUPPLIER_STRICT ? can('suppliers', 'view') : true };
}

export type PoolActionsAvail = { extend: boolean; forceSettle: boolean; cancel: boolean };
export function poolActions(status: string, p: PoolPerms): PoolActionsAvail {
  return {
    extend: p.approve && status === 'open',
    forceSettle: p.isAdmin && status === 'open',
    cancel: p.approve && ['open', 'locked', 'confirmed'].includes(status),
  };
}

export function pledgeActions(pledge: { status: string; order_id: string | null }, poolStatusRaw: string, p: PoolPerms): { confirmDeposit: boolean; markDefaulted: boolean } {
  return {
    confirmDeposit: p.finance && pledge.status === 'pending' && poolStatusRaw === 'open',
    markDefaulted: p.edit && pledge.status === 'paid' && !!pledge.order_id && poolStatusRaw === 'locked',
  };
}

export const payLabel = (src: string) => (src === 'wallet' ? 'Wallet' : 'Card / bank');

const PLEDGE_NAMES: Record<string, string> = { pending: 'Pending', paid: 'Paid', confirmed: 'Paid', shipped: 'Paid', delivered: 'Paid', withdrawn: 'Refunded', defaulted: 'Failed' };
/** pool_pledges.status (pledge_status enum) → Appendix C "Payments" words; the raw step stays visible as detail. */
export const pledgeStatusName = (raw: string) => PLEDGE_NAMES[raw] ?? 'Pending';
