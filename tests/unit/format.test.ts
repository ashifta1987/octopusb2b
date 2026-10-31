import { describe, expect, it } from 'vitest';
import { mapDbError, tierFor, toCents, usd } from '@/lib/format';

describe('tierFor (price tier selection)', () => {
  const tiers = [
    { min_qty: 1000, unit_price_cents: 60 },
    { min_qty: 100, unit_price_cents: 80 },
    { min_qty: 5000, unit_price_cents: 52 },
  ];
  it('picks the highest tier the quantity reaches, regardless of input order', () => {
    expect(tierFor(tiers, 100)?.unit_price_cents).toBe(80);
    expect(tierFor(tiers, 999)?.unit_price_cents).toBe(80);
    expect(tierFor(tiers, 1000)?.unit_price_cents).toBe(60);
    expect(tierFor(tiers, 1_000_000)?.unit_price_cents).toBe(52);
  });
  it('returns undefined below the MOQ tier or for no tiers', () => {
    expect(tierFor(tiers, 99)).toBeUndefined();
    expect(tierFor([], 10)).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const copy = JSON.stringify(tiers);
    tierFor(tiers, 2000);
    expect(JSON.stringify(tiers)).toBe(copy);
  });
});

describe('money helpers', () => {
  it('toCents parses numbers and strings without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('1,234.56')).toBe(123456);
    expect(toCents('$19.99')).toBe(1999);
    expect(toCents(14)).toBe(1400);
    expect(Number.isNaN(toCents('abc'))).toBe(true);
  });
  it('usd formats cents as USD', () => {
    expect(usd(123456)).toBe('$1,234.56');
    expect(usd(0)).toBe('$0.00');
    expect(usd(null)).toBe('—');
    expect(usd(undefined)).toBe('—');
    expect(usd(14)).toBe('$0.14');
  });
  it('usd compact for large amounts', () => {
    expect(usd(250_000_00, { compact: true })).toBe('$250K');
  });
});

describe('mapDbError', () => {
  it('maps RPC error codes to friendly messages', () => {
    expect(mapDbError({ message: 'WALLET_INSUFFICIENT: balance 10 needed 20' })).toMatch(/wallet balance is too low/i);
    expect(mapDbError({ message: 'MAKER_CANNOT_APPROVE' })).toMatch(/maker/i);
    expect(mapDbError({ message: 'INVALID_TRANSITION: shipped → confirmed' })).toMatch(/not allowed/i);
  });
  it('falls back to the raw message or a generic one', () => {
    expect(mapDbError({ message: 'something odd' })).toBe('something odd');
    expect(mapDbError(null)).toBe('Something went wrong');
  });
});
