/**
 * Shared status names (NEW-THEME-MASTER-PROMPT Appendix C) and their pill tones. Pure (server + client).
 * Use exactly these names everywhere: pages, emails, exports.
 *
 * Tones listed in Appendix C:
 *   success = Paid, Approved, Verified, Delivered, Released
 *   info    = Sent, Open, In production, Quoting
 *   warning = Partly paid, Waiting, Deposit due, Balance due, Closing soon
 *   danger  = Overdue, Failed, Rejected
 *   neutral = Draft, Cancelled, Closed
 *   indigo  = Held (the 3PL colour)
 * Names Appendix C lists without a colour got the closest meaning (green done · amber needs attention · red blocked ·
 * blue in progress · grey neutral): Quote ready/Shipped/Quality check/Verification pending = info; Accepted/Filled = success;
 * Waiting for payment/Almost full/Pending/Not verified = warning; Closed (not filled)/Credit note/Refunded/Paused = neutral.
 */
export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo';

/** Every Appendix C status, by area (order as in the spec). */
export const STATUS_NAMES = {
  requests: ['Draft', 'Sent', 'Quoting', 'Quote ready', 'Accepted', 'Closed'],
  orders: ['Waiting for payment', 'Deposit due', 'In production', 'Quality check', 'Balance due', 'Shipped', 'Delivered', 'Cancelled'],
  invoices: ['Draft', 'Sent', 'Partly paid', 'Overdue', 'Paid', 'Cancelled', 'Credit note'],
  pools: ['Open', 'Closing soon', 'Almost full', 'Filled', 'Closed (not filled)'],
  payments: ['Pending', 'Paid', 'Held', 'Released', 'Refunded', 'Failed'],
  approvals: ['Waiting', 'Approved', 'Rejected'],
  company: ['Not verified', 'Verification pending', 'Verified', 'Paused'],
} as const;

export type StatusArea = keyof typeof STATUS_NAMES;
export type StatusName = (typeof STATUS_NAMES)[StatusArea][number];

export const STATUS_TONES: Readonly<Record<StatusName, StatusTone>> = {
  // success
  Paid: 'success',
  Approved: 'success',
  Verified: 'success',
  Delivered: 'success',
  Released: 'success',
  Accepted: 'success',
  Filled: 'success',
  // info
  Sent: 'info',
  Open: 'info',
  'In production': 'info',
  Quoting: 'info',
  'Quote ready': 'info',
  'Quality check': 'info',
  Shipped: 'info',
  'Verification pending': 'info',
  // warning
  'Partly paid': 'warning',
  Waiting: 'warning',
  'Deposit due': 'warning',
  'Balance due': 'warning',
  'Closing soon': 'warning',
  'Waiting for payment': 'warning',
  'Almost full': 'warning',
  Pending: 'warning',
  'Not verified': 'warning',
  // danger
  Overdue: 'danger',
  Failed: 'danger',
  Rejected: 'danger',
  // neutral
  Draft: 'neutral',
  Cancelled: 'neutral',
  Closed: 'neutral',
  'Closed (not filled)': 'neutral',
  'Credit note': 'neutral',
  Refunded: 'neutral',
  Paused: 'neutral',
  // 3PL indigo
  Held: 'indigo',
};

const LOOKUP = new Map<string, StatusTone>(Object.entries(STATUS_TONES).map(([k, v]) => [k.toLowerCase(), v]));

/** True when `name` is one of the Appendix C names (case and surrounding spaces ignored). */
export function isStatusName(name: string): boolean {
  return LOOKUP.has(name.trim().toLowerCase());
}

/** Pill tone for an Appendix C status name; unknown names are `neutral` (never guessed). */
export function statusTone(name: string | null | undefined): StatusTone {
  if (!name) return 'neutral';
  return LOOKUP.get(name.trim().toLowerCase()) ?? 'neutral';
}
