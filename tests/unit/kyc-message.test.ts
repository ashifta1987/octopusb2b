import { describe, expect, it } from 'vitest';
import { customerMessageFor, KYC_CONTACT_FALLBACK } from '@/lib/kyc-message';

describe('customerMessageFor (KYC, migration 195)', () => {
  it('shows the customer message when present', () => {
    expect(customerMessageFor({ status: 'rejected', customer_message: '  Licence expired  ' })).toBe('Licence expired');
  });
  it('falls back for rejected / more_info without a message', () => {
    expect(customerMessageFor({ status: 'rejected', customer_message: null })).toBe(KYC_CONTACT_FALLBACK);
    expect(customerMessageFor({ status: 'more_info', customer_message: '   ' })).toBe(KYC_CONTACT_FALLBACK);
    expect(KYC_CONTACT_FALLBACK).toBe('Please contact your account manager.');
  });
  it('shows nothing for other statuses without a message', () => {
    expect(customerMessageFor({ status: 'verified' })).toBeNull();
    expect(customerMessageFor({ status: 'in_review', customer_message: null })).toBeNull();
  });
  it('never reads internal_note even if a row happens to carry it', () => {
    const row = { status: 'rejected', customer_message: null, internal_note: 'staff only' } as { status: string; customer_message: null };
    expect(customerMessageFor(row)).toBe(KYC_CONTACT_FALLBACK);
  });
});
