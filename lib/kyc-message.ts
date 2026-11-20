/**
 * Customer-facing KYC review text (migration 195). Customers only ever see `customer_message`; the staff
 * `internal_note` is hidden and must never be passed here. Old review notes became internal notes, so a
 * rejected / more-info submission without a customer message falls back to a generic line.
 */
export const KYC_CONTACT_FALLBACK = 'Please contact your account manager.';

export function customerMessageFor(sub: { status: string; customer_message?: string | null }): string | null {
  const msg = (sub.customer_message ?? '').trim();
  if (msg) return msg;
  return sub.status === 'rejected' || sub.status === 'more_info' ? KYC_CONTACT_FALLBACK : null;
}

/**
 * Decisions that must carry a message to the customer (migration 196): rejecting, and asking for more information —
 * in both cases the customer needs to know what to do next. Same rule as review_kyc() in the database
 * (error KYC_MESSAGE_REQUIRED); the office UI and the server action check it first.
 */
export const KYC_MESSAGE_REQUIRED_FOR = ['rejected', 'more_info'] as const;
export function kycMessageRequired(to: string): boolean {
  return (KYC_MESSAGE_REQUIRED_FOR as readonly string[]).includes(to);
}
/** Error shown when the message is missing. */
export function kycMessageRequiredText(to: string): string {
  return to === 'more_info'
    ? 'Write a message to the customer saying what information or documents they need to provide.'
    : 'Write a message to the customer explaining why the verification was rejected and what they can do next.';
}
