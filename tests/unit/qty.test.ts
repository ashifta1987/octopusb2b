import { describe, expect, it } from 'vitest';
import { cartonQty } from '@/lib/qty';

describe('cartonQty (order multiple from the carton column)', () => {
  it('reads the leading pieces-per-carton number', () => {
    expect(cartonQty('75pcs/CTN')).toBe(75);
    expect(cartonQty('186个/箱')).toBe(186);
    expect(cartonQty(' 40 ')).toBe(40);
  });
  it('ignores sizes, blanks and 1', () => {
    expect(cartonQty('505x490x455mm')).toBeNull();
    expect(cartonQty(null)).toBeNull();
    expect(cartonQty('')).toBeNull();
    expect(cartonQty('1')).toBeNull();
    expect(cartonQty('pcs')).toBeNull();
  });
});

