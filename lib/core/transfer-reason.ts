/** Short bank transfers (migration 202): the reason the CUSTOMER sees. Same words as transfer_reason_label() in SQL. */
export const TRANSFER_REASONS = [
  { value: 'bank_charges', label: 'Bank charges' },
  { value: 'exchange_rate', label: 'Exchange rate difference' },
  { value: 'partial_payment', label: 'Partial payment' },
  { value: 'other', label: 'Other' },
] as const;

export type TransferReason = (typeof TRANSFER_REASONS)[number]['value'];
export const OTHER_TEXT_MAX = 80;

export function isTransferReason(v: unknown): v is TransferReason {
  return TRANSFER_REASONS.some((r) => r.value === v);
}

/** "Bank charges" · "Exchange rate difference" · "Partial payment" · Other → its short text · nothing → null. */
export function transferReasonLabel(reason: string | null | undefined, text?: string | null): string | null {
  if (reason === 'other') return text?.trim() || null;
  return TRANSFER_REASONS.find((r) => r.value === reason)?.label ?? null;
}
