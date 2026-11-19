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
