import { describe, expect, it } from 'vitest';
import { TRANSFER_REASONS, isTransferReason, transferReasonLabel } from '@/lib/core/transfer-reason';

describe('transfer difference reason (migration 202)', () => {
  it('has the four reasons the owner chose, in order', () => {
    expect(TRANSFER_REASONS.map((r) => r.label)).toEqual(['Bank charges', 'Exchange rate difference', 'Partial payment', 'Other']);
  });
  it('labels match transfer_reason_label() in SQL', () => {
    expect(transferReasonLabel('bank_charges')).toBe('Bank charges');
    expect(transferReasonLabel('exchange_rate')).toBe('Exchange rate difference');
    expect(transferReasonLabel('partial_payment')).toBe('Partial payment');
    expect(transferReasonLabel('other', '  Sender paid in two parts ')).toBe('Sender paid in two parts');
    expect(transferReasonLabel('other', ' ')).toBeNull();
    expect(transferReasonLabel(null)).toBeNull();
  });
  it('accepts only known reasons', () => {
    expect(isTransferReason('bank_charges')).toBe(true);
    expect(isTransferReason('bank charges')).toBe(false);
    expect(isTransferReason('')).toBe(false);
  });
});
