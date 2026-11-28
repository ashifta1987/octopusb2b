import type { WaitingActionType, WaitingService } from '@/lib/core/waiting-items';

/**
 * ODS T6 · My account status names and small formatting helpers (pure; server + client + tests).
 * Names are exactly Appendix C (packages/ui/src/status.ts gives the pill tone).
 *
 * API (stable):
 *  - `orderStatusName(raw)`    orders.status → Appendix C order name
 *  - `orderNextStep(raw)`      → short "Next step" text for the In progress table
 *  - `requestStatusName(raw)`  rfqs.status → Appendix C request name
 *  - `requestNextStep(raw)`
 *  - `OPEN_REQUEST_STATUSES`   rfqs.status values that count as open (same list as today's /account)
 *  - `ACTIVE_ORDER_STATUSES`   orders.status values that are in progress (today's ACTIVE_ORDER, components/account/order-utils)
 *  - `kycState(raw)`           organizations.kyc_status → 'verified' | 'pending' | 'more_info' | 'not_verified'
 *  - `companyStatusName(state)`→ Verified · Verification pending · Not verified (Appendix C "Company")
 *  - `dueText(dueAt, nowIso)`  → { text, urgent }   "Expires in 2 days" / "Expires today" / "Due now" / "No due date"
 *  - `greetingFor(hour)`       → Good morning / Good afternoon / Good evening
 *  - `centsToAmount(cents)`    integer cents → major units for <Money amount>
 *  - `WAITING_TYPE_LABEL`, `WAITING_SERVICE_LABEL`
 */

export const ACTIVE_ORDER_STATUSES = ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped'] as const;
export const OPEN_REQUEST_STATUSES = ['submitted', 'assigned', 'quoting', 'quoted'] as const;

const ORDER_NAMES: Record<string, string> = {
  pi_issued: 'Waiting for payment',
  deposit_pending: 'Deposit due',
  deposit_paid: 'In production',
  confirmed: 'In production',
  in_production: 'In production',
  qc: 'Quality check',
  balance_pending: 'Balance due',
  // balance paid, packing for shipment: still "In production" in the Appendix C list (no separate name)
  balance_paid: 'In production',
  ready_to_ship: 'In production',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Delivered',
  closed: 'Delivered', // closed after delivery (coordinator, T6)
  cancelled: 'Cancelled',
};
const ORDER_NEXT: Record<string, string> = {
  pi_issued: 'Pay the proforma to start',
  deposit_pending: 'Pay the deposit',
  deposit_paid: 'Production starts',
  confirmed: 'Production starts',
  in_production: 'Quality check',
  qc: 'Quality check report',
  balance_pending: 'Pay the balance',
  balance_paid: 'Shipping',
  ready_to_ship: 'Shipping',
  shipped: 'Delivery',
  delivered: '—',
  completed: '—',
  closed: '—',
  cancelled: '—',
};
export const orderStatusName = (raw: string) => ORDER_NAMES[raw] ?? 'In production';
export const orderNextStep = (raw: string) => ORDER_NEXT[raw] ?? '—';

const REQUEST_NAMES: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Sent',
  assigned: 'Sent',
  quoting: 'Quoting',
  quoted: 'Quote ready',
  accepted: 'Accepted',
  ordered: 'Accepted',
  closed: 'Closed',
  cancelled: 'Closed',
  expired: 'Closed',
};
const REQUEST_NEXT: Record<string, string> = {
  draft: 'Send the request',
  submitted: 'Our team checks it',
  assigned: 'Factories quote',
  quoting: 'Quotes on the way',
  quoted: 'Review the quotes',
  accepted: 'Proforma and deposit',
};
export const requestStatusName = (raw: string) => REQUEST_NAMES[raw] ?? 'Sent';
export const requestNextStep = (raw: string) => REQUEST_NEXT[raw] ?? '—';

export type KycState = 'verified' | 'pending' | 'more_info' | 'not_verified';
export function kycState(raw: string | null | undefined): KycState {
  if (raw === 'verified') return 'verified';
  if (raw === 'submitted' || raw === 'in_review') return 'pending';
  if (raw === 'more_info') return 'more_info';
  return 'not_verified';
}
export const companyStatusName = (s: KycState) => (s === 'verified' ? 'Verified' : s === 'pending' ? 'Verification pending' : 'Not verified');

/** Deadline text for a waiting item. Only `dueAt` from the data is shown; null = "Due now" for payments, else "No due date". */
export function dueText(dueAt: string | null, nowIso: string, type?: WaitingActionType): { text: string; urgent: boolean } {
  if (!dueAt) return { text: type === 'pay' ? 'Due now' : 'No due date', urgent: type === 'pay' };
  const ms = Date.parse(dueAt) - Date.parse(nowIso);
  if (!Number.isFinite(ms)) return { text: 'No due date', urgent: false };
  if (ms <= 0) return { text: 'Expired', urgent: true };
  const days = Math.floor(ms / 864e5);
  if (days === 0) {
    const hours = Math.max(1, Math.floor(ms / 36e5));
    return { text: `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`, urgent: true };
  }
  return { text: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`, urgent: days <= 2 };
}

export function greetingFor(hour: number | null): string {
  if (hour === null) return 'Hello';
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export const centsToAmount = (cents: number | string | null | undefined) => Number(cents ?? 0) / 100;

export const WAITING_TYPE_LABEL: Record<WaitingActionType, string> = { pay: 'Pay', approve: 'Approve', review: 'Review', reply: 'Reply' };
export const WAITING_TYPE_ORDER: readonly WaitingActionType[] = ['pay', 'approve', 'review', 'reply'];
export const WAITING_SERVICE_LABEL: Record<WaitingService, string> = { sourcing: 'Sourcing', wallet: 'Wallet', account: 'Account' };

export const firstName = (full: string | null | undefined) => (full ?? '').trim().split(/\s+/)[0] || '';
