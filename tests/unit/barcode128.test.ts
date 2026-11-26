import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, START_B, STOP, canEncode128, code128Bars, code128Values, code128Widths } from '@/lib/barcode128';

/** Decode widths back to values with the same table (round trip) and check the symbol structure. */
function decode(widths: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < widths.length) {
    const len = widths.length - i === 7 ? 7 : 6;
    const key = widths.slice(i, i + len).join('');
    const v = CODE128_PATTERNS.indexOf(key);
    if (v < 0) throw new Error(`unknown pattern ${key}`);
    out.push(v);
    i += len;
  }
  return out;
}

describe('Code 128 set B', () => {
  it('has 107 unique patterns of 11 modules (stop 13) with an even number of bar modules', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const w = [...p].map(Number);
      expect(w.reduce((a, b) => a + b, 0)).toBe(i === STOP ? 13 : 11);
      if (i !== STOP) expect((w[0] + w[2] + w[4]) % 2).toBe(0);
    });
  });

  it('computes the mod-103 checksum (PJJ123C → 55, the textbook example)', () => {
    const v = code128Values('PJJ123C');
    expect(v[0]).toBe(START_B);
    expect(v.at(-1)).toBe(STOP);
    expect(v.at(-2)).toBe(55);
    expect(v.slice(1, -2)).toEqual([48, 42, 42, 17, 18, 19, 35]);
  });

  it('round-trips warehouse codes and verifies the checksum', () => {
    for (const text of ['PAL-00001', 'A-01-03', 'LOT-00012', 'ASN-0091-01', 'TRF-0001', 'Abc 123~']) {
      const values = decode(code128Widths(text));
      const data = values.slice(1, -2);
      expect(String.fromCharCode(...data.map((d) => d + 32))).toBe(text);
      expect(data.reduce((s, d, i) => s + d * (i + 1), START_B) % 103).toBe(values.at(-2));
      // 11 modules per symbol + 13 for stop
      expect(code128Widths(text).reduce((a, b) => a + b, 0)).toBe((text.length + 2) * 11 + 13);
    }
  });

  it('lays bars out with quiet zones; refuses text set B cannot encode', () => {
    const { bars, width } = code128Bars('A-01-03');
    expect(bars[0].x).toBe(10);
    expect(width).toBe(10 + (7 + 2) * 11 + 13 + 10);
    expect(canEncode128('PAL-00001')).toBe(true);
    expect(canEncode128('')).toBe(false);
    expect(canEncode128('仓库')).toBe(false);
    expect(() => code128Values('é')).toThrow();
  });
});
