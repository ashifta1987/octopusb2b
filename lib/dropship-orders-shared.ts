/**
 * Octopus Dropship · Step 8 — pure labels for the Orders page (shared by the server page, the client table and the unit
 * tests). Wording follows screens/Orders.html and states/States-Orders.html. Money is integer US cents; an unknown cost
 * (duties not known yet) is shown as unknown, never as US$0.00.
 */
import type { OrderRow } from './dropship-orders';

export type Chip = 'to_pay' | 'all' | 'processing' | 'shipped' | 'delivered' | 'issues';
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
export type RowAction = 'pay' | 'review' | 'fix_address' | 'track' | 'none';

export const usd = (c: number | null | undefined) =>
  c == null ? 'Not known yet' : `US$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isOpenUnpaid = (r: OrderRow) => r.payment_state === 'unpaid' && !r.cancelled_at && !r.expired_at;

export function isToPay(r: OrderRow) {
  return isOpenUnpaid(r) && !r.hold_code && r.kind !== 'sample';
}

/** Issues = everything that needs the merchant: holds, low wallet (awaiting payment), address problems after packing. */
export function isIssue(r: OrderRow) {
  if (r.cancelled_at || r.expired_at) return false;
  if (r.hold_code) return true;
  if (r.problem_code) return true;
  return isOpenUnpaid(r) && r.last_charge_error === 'WALLET_INSUFFICIENT';
}

export function inChip(r: OrderRow, chip: Chip) {
  switch (chip) {
    case 'all': return true;
    case 'to_pay': return isToPay(r);
    case 'processing': return r.merchant_status === 'processing' && !r.cancelled_at;
    case 'shipped': return r.merchant_status === 'shipped';
    case 'delivered': return r.merchant_status === 'delivered';
    case 'issues': return isIssue(r);
  }
}

export function chipCounts(rows: OrderRow[]): Record<Chip, number> {
  const c = { to_pay: 0, all: rows.length, processing: 0, shipped: 0, delivered: 0, issues: 0 } as Record<Chip, number>;
  for (const r of rows) for (const k of ['to_pay', 'processing', 'shipped', 'delivered', 'issues'] as const) if (inChip(r, k)) c[k] += 1;
  return c;
}

const HOLD_LABEL: Record<string, string> = {
  high_risk: 'On hold: high risk',
  address: 'On hold: address',
  stock_shortage: 'On hold: stock',
  duty_unknown: 'On hold: duties not known',
};

export function statusLabel(r: OrderRow): { label: string; tone: Tone } {
  if (r.expired_at) return { label: 'Back to your store', tone: 'neutral' };
  if (r.cancelled_at || r.merchant_status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  if (r.merchant_status === 'refunded') return { label: 'Refunded', tone: 'neutral' };
  if (r.hold_code) return { label: HOLD_LABEL[r.hold_code] ?? 'On hold', tone: r.hold_code === 'high_risk' || r.hold_code === 'address' ? 'bad' : 'warn' };
  if (r.problem_code === 'address_after_packing') return { label: 'Address problem', tone: 'warn' };
  switch (r.merchant_status) {
    case 'awaiting_payment': return { label: 'To pay', tone: 'warn' };
    case 'processing': return { label: 'Processing', tone: 'info' };
    case 'shipped': return { label: 'Shipped', tone: 'ok' };
    case 'delivered': return { label: 'Delivered', tone: 'ok' };
    case 'on_hold': return { label: 'On hold', tone: 'warn' };
    default: return { label: 'Processing', tone: 'info' };
  }
}

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

export function paymentLabel(r: OrderRow): { label: string; tone: Tone } {
  if (r.kind === 'sample') return { label: 'Wallet · paid', tone: 'ok' };
  if (r.payment_state === 'refunded') return { label: r.payment_option === 'pay_later' ? 'Invoice credited' : 'Refunded to wallet', tone: 'neutral' };
  if (r.payment_state === 'held' || (r.payment_option === 'protection' && r.payment_state !== 'unpaid')) {
    if (r.protection_status === 'disputed') return { label: 'Protected · dispute open', tone: 'warn' };
    if (r.protection_status === 'released' || r.payment_state === 'paid') return { label: 'Protected · released', tone: 'ok' };
    if (r.protection_release_at) return { label: `Protected · releases ${fmtDay(r.protection_release_at)}`, tone: 'info' };
    return { label: 'Protected · held until delivery', tone: 'info' };
  }
  if (r.payment_state === 'paid') {
    if (r.payment_option === 'pay_later') return { label: r.invoice_due_at ? `Pay later · due ${fmtDay(r.invoice_due_at)}` : 'Pay later', tone: 'info' };
    return { label: 'Wallet · paid', tone: 'ok' };
  }
  // unpaid
  if (r.expired_at) return { label: 'Not charged · window ended', tone: 'neutral' };
  if (r.cancelled_at) return { label: 'Not charged', tone: 'neutral' };
  if (r.hold_code) return { label: 'Not charged yet', tone: 'neutral' };
  const days = r.days_left ?? 0;
  return { label: `Awaiting payment · ${days} day${days === 1 ? '' : 's'} left`, tone: 'warn' };
}

export function rowAction(r: OrderRow): RowAction {
  if (r.cancelled_at || r.expired_at || r.kind === 'sample') return r.track_token ? 'track' : 'none';
  if (r.hold_code === 'address') return 'fix_address';
  if (r.hold_code === 'high_risk') return 'review';
  if (isToPay(r) && r.total_cents != null) return 'pay';
  if (r.track_token && (r.merchant_status === 'shipped' || r.merchant_status === 'delivered')) return 'track';
  return 'none';
}

export function itemsSummary(r: OrderRow) {
  const first = r.items[0];
  const main = first ? `${first.title}${first.qty > 1 ? ` ×${first.qty}` : ''}` : '—';
  const more = r.items.length > 1 ? ` + ${r.items.length - 1} more` : '';
  return main + more;
}

export const otherItemsText = (n: number) => (n > 0 ? `+${n} item${n === 1 ? '' : 's'} not from Octopus` : null);

export function channelLabel(r: OrderRow) {
  if (r.kind === 'sample') return 'Sample';
  if (r.test_order) return 'Test order';
  return ({ shopify: 'Shopify', woocommerce: 'WooCommerce', csv: 'CSV', manual: 'Manual', api: 'API' } as Record<string, string>)[r.channel] ?? r.channel;
}

/** Bulk "Charge and ship": orders the wallet can cover, oldest first (the server charges in the same order). */
export function bulkPlan(rows: OrderRow[], availableCents: number) {
  const due = rows.filter((r) => rowAction(r) === 'pay').sort((a, b) => a.created_at.localeCompare(b.created_at));
  let left = availableCents;
  const fits: OrderRow[] = [];
  for (const r of due) {
    if ((r.total_cents ?? 0) <= left) { fits.push(r); left -= r.total_cents ?? 0; }
  }
  return { due, fits, totalDue: due.reduce((s, r) => s + (r.total_cents ?? 0), 0) };
}
