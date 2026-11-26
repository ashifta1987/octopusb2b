import { describe, it, expect } from 'vitest';
import {
  bandsProblem, computePrice, currencyExponent, minorToInput, parseFx, parseMoneyToMinor, parseMultiplier, profitBp, roundPrice, ruleSummary, storeMoney,
  type PriceBand,
} from '@/lib/dropship-pricing';
// the same case table the DB test runs against ds_price_compute() — browser preview and server price agree to the cent
import { PRICE_BANDS, PRICE_CASES } from '../../supabase/tests/ds6-dropship.test.mjs';

const BANDS = PRICE_BANDS as PriceBand[];

describe('Dropship Step 6 · pricing engine (mirror of ds_price_compute)', () => {
  for (const k of PRICE_CASES) {
    it(k.name, () => {
      const r = computePrice(k.landed, { bands: BANDS, rounding: k.rounding as 'end_99', compare_at_bp: k.cmp as 2500 | null, min_profit_bp: k.min }, k.fx, k.cur);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.price_minor).toBe(k.price);
      expect(r.compare_at_minor).toBe(k.compare);
      expect(r.landed_minor).toBe(k.landedMinor);
      expect(r.profit_bp).toBe(k.profit);
      expect(r.below_min).toBe(k.below);
      expect(r.band).toBe(k.band);
    });
  }

  it('rounding never goes below the raw price', () => {
    for (const raw of [1, 99, 100, 101, 15916, 15999, 16000, 19998]) {
      for (const mode of ['end_99', 'end_95', 'whole', 'none'] as const) {
        expect(roundPrice(BigInt(raw), BigInt(1), mode, 2)).toBeGreaterThanOrEqual(raw);
      }
    }
    expect(roundPrice(BigInt(16000), BigInt(1), 'end_99', 2)).toBe(16099);
    expect(roundPrice(BigInt(15999), BigInt(1), 'end_99', 2)).toBe(15999);
    expect(roundPrice(BigInt(12300), BigInt(1), 'end_99', 3)).toBe(12990); // KWD 12.990
    expect(roundPrice(BigInt(1234), BigInt(1), 'end_99', 0)).toBe(1234); // no decimals: whole
  });

  it('unknown landed cost or missing FX is never priced (never 0)', () => {
    const rule = { bands: BANDS, rounding: 'end_99' as const, compare_at_bp: null, min_profit_bp: 5000 };
    expect(computePrice(null, rule, '1', 'USD')).toMatchObject({ ok: false, code: 'NO_LANDED' });
    expect(computePrice(0, rule, '1', 'USD')).toMatchObject({ ok: false, code: 'NO_LANDED' });
    expect(computePrice(1970, rule, null, 'AED')).toMatchObject({ ok: false, code: 'NEEDS_FX' });
    expect(computePrice(1970, rule, '-1', 'AED')).toMatchObject({ ok: false, code: 'NEEDS_FX' });
    expect(computePrice(1970, rule, null, 'USD').ok).toBe(true); // USD needs no rate
  });

  it('band checks match ds_bands_problem sentences', () => {
    expect(bandsProblem([])).toBe('Add at least one cost band.');
    expect(bandsProblem([{ from_cents: 100, to_cents: null, multiplier_milli: 2000, fixed_cents: 0 }])).toBe('Band 1 must start at $0.00.');
    expect(bandsProblem([{ from_cents: 0, to_cents: 1000, multiplier_milli: 2000, fixed_cents: 0 }, { from_cents: 1200, to_cents: null, multiplier_milli: 2000, fixed_cents: 0 }]))
      .toBe('Band 2 must start where band 1 ends.');
    expect(bandsProblem([{ from_cents: 0, to_cents: 1000, multiplier_milli: 2000, fixed_cents: 0 }])).toBe('Band 1 (the last band) must go "and up".');
    expect(bandsProblem([{ from_cents: 0, to_cents: null, multiplier_milli: 900, fixed_cents: 0 }])).toBe('Band 1: the multiplier must be between 1.0 and 20.0.');
    expect(bandsProblem([{ from_cents: 0, to_cents: null, multiplier_milli: Number.NaN, fixed_cents: 0 }])).toBe('Band 1: enter amounts as numbers.');
    expect(bandsProblem(BANDS)).toBeNull();
  });

  it('manual price profit = ds_profit_bp', () => {
    expect(profitBp(15999, 1970, '3.6725', 'AED')).toBe(5477);
    expect(profitBp(2000, 2100, '1', 'USD')).toBe(-500);
    expect(profitBp(null, 2100, '1', 'USD')).toBeNull();
  });

  it('money helpers: exponents, parsing and the merchant format', () => {
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('aed')).toBe(2);
    expect(parseFx('3.6725')).toEqual({ num: BigInt(367250000), den: BigInt(100000000) });
    expect(parseFx('abc')).toBeNull();
    expect(parseMoneyToMinor('159.99', 'AED')).toBe(15999);
    expect(parseMoneyToMinor('AED 1,159.9', 'AED')).toBe(115990);
    expect(parseMoneyToMinor('4.99', 'KWD')).toBe(4990);
    expect(parseMoneyToMinor('4.9999', 'KWD')).toBeNull();
    expect(parseMoneyToMinor('', 'USD')).toBeNull();
    expect(minorToInput(4990, 'KWD')).toBe('4.990');
    expect(storeMoney(15999, 'AED')).toBe('AED 159.99');
    expect(storeMoney(1299, 'USD')).toBe('US$ 12.99');
    expect(storeMoney(null, 'USD')).toBe('—');
    expect(parseMultiplier('2.2')).toBe(2200);
    expect(parseMultiplier('2.2345')).toBeNull();
    expect(ruleSummary({ bands: BANDS, rounding: 'end_99' })).toBe('3 bands · × 2.6 / 2.2 / 1.9 · .99');
  });
});
