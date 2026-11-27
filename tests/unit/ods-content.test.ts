import { describe, expect, it } from 'vitest';
import { STATUS_NAMES, STATUS_TONES, isStatusName, statusTone, type StatusTone } from '@octopus/ui/status';
import { MINUS, formatDate, formatMoney } from '@octopus/ui/format';

const APPENDIX_C: Record<StatusTone, string[]> = {
  success: ['Paid', 'Approved', 'Verified', 'Delivered', 'Released'],
  info: ['Sent', 'Open', 'In production', 'Quoting'],
  warning: ['Partly paid', 'Waiting', 'Deposit due', 'Balance due', 'Closing soon'],
  danger: ['Overdue', 'Failed', 'Rejected'],
  neutral: ['Draft', 'Cancelled', 'Closed'],
  indigo: ['Held'],
};

describe('statusTone (Appendix C)', () => {
  it('maps every colour Appendix C lists', () => {
    for (const [tone, names] of Object.entries(APPENDIX_C)) for (const n of names) expect(statusTone(n), n).toBe(tone);
  });
  it('"Held" is the 3PL indigo', () => {
    expect(statusTone('Held')).toBe('indigo');
  });
  it('every Appendix C name in every area has a tone and is recognised', () => {
    const all = Object.values(STATUS_NAMES).flat();
    expect(all).toHaveLength(39);
    for (const n of all) {
      expect(isStatusName(n), n).toBe(true);
      expect(STATUS_TONES[n], n).toBeDefined();
      expect(['success', 'info', 'warning', 'danger', 'neutral', 'indigo']).toContain(statusTone(n));
    }
  });
  it('names without a listed colour get the closest meaning', () => {
    expect(statusTone('Quote ready')).toBe('info');
    expect(statusTone('Accepted')).toBe('success');
    expect(statusTone('Waiting for payment')).toBe('warning');
    expect(statusTone('Quality check')).toBe('info');
    expect(statusTone('Shipped')).toBe('info');
    expect(statusTone('Credit note')).toBe('neutral');
    expect(statusTone('Almost full')).toBe('warning');
    expect(statusTone('Filled')).toBe('success');
    expect(statusTone('Closed (not filled)')).toBe('neutral');
    expect(statusTone('Pending')).toBe('warning');
    expect(statusTone('Refunded')).toBe('neutral');
    expect(statusTone('Not verified')).toBe('warning');
    expect(statusTone('Verification pending')).toBe('info');
    expect(statusTone('Paused')).toBe('neutral');
  });
  it('ignores case and spaces; unknown or empty → neutral', () => {
    expect(statusTone('  deposit DUE ')).toBe('warning');
    expect(statusTone('Shipped to the moon')).toBe('neutral');
    expect(statusTone('')).toBe('neutral');
    expect(statusTone(undefined)).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
    expect(isStatusName('Awaiting payment')).toBe(false);
  });
});

describe('formatMoney (Part 2.7)', () => {
  it('US$ with a space, thousands and 2 decimals', () => {
    expect(formatMoney(1234.56)).toBe('US$ 1,234.56');
    expect(formatMoney(0)).toBe('US$ 0.00');
    expect(formatMoney(4250)).toBe('US$ 4,250.00');
    expect(formatMoney(1234567.891)).toBe('US$ 1,234,567.89');
  });
  it('negatives use U+2212 before the currency', () => {
    expect(formatMoney(-420)).toBe(`${MINUS}US$ 420.00`);
    expect(formatMoney(-420)).toBe('\u2212US$ 420.00');
    expect(formatMoney(-420)).not.toContain('-');
    expect(MINUS).toBe('\u2212');
  });
  it('options: currency, decimals, signDisplay', () => {
    expect(formatMoney(12, { currency: 'AED' })).toBe('AED 12.00');
    expect(formatMoney(25000, { decimals: 0 })).toBe('US$ 25,000');
    expect(formatMoney(12.5, { signDisplay: 'always' })).toBe('+US$ 12.50');
    expect(formatMoney(-12.5, { signDisplay: 'always' })).toBe('\u2212US$ 12.50');
    expect(formatMoney(0, { signDisplay: 'always' })).toBe('US$ 0.00');
  });
});

describe('formatDate (Part 2.7)', () => {
  it('"27 Nov 2026"', () => {
    expect(formatDate('2026-11-27')).toBe('27 Nov 2026');
    expect(formatDate(new Date(Date.UTC(2026, 0, 3)))).toBe('3 Jan 2026');
    expect(formatDate('2026-11-27T15:24:18Z')).toBe('27 Nov 2026');
  });
  it('short drops the year only inside the current year', () => {
    const now = new Date(Date.UTC(2026, 5, 1));
    expect(formatDate('2026-11-27', { short: true, now })).toBe('27 Nov');
    expect(formatDate('2025-11-27', { short: true, now })).toBe('27 Nov 2025');
  });
  it('invalid dates → empty string', () => {
    expect(formatDate('not a date')).toBe('');
  });
});
