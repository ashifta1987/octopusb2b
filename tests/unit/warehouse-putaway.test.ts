import { describe, expect, it } from 'vitest';
import { BIN_CODE, binRange, cartonRef } from '@/lib/warehouse-putaway';

describe('Warehouse OS W2b helpers', () => {
  it('builds rack-row-bin ranges like the database does', () => {
    expect(binRange('a', 1, 2, 1, 3)).toEqual(['A-01-01', 'A-01-02', 'A-01-03', 'A-02-01', 'A-02-02', 'A-02-03']);
    expect(binRange('AB2', 5, 5, 10, 10)).toEqual(['AB2-05-10']);
    expect(binRange('A', 1, 5, 1, 10)).toHaveLength(50);
    expect(binRange('A-1', 1, 1, 1, 1)).toEqual([]);
    expect(binRange('A', 2, 1, 1, 1)).toEqual([]);
    expect(binRange('A', 0, 1, 1, 1)).toEqual([]);
    expect(binRange('A', 1, 100, 1, 1)).toEqual([]);
    expect(binRange('A', 1, 1.5, 1, 1)).toEqual([]);
    for (const c of binRange('Q47', 1, 3, 1, 3)) expect(BIN_CODE.test(c)).toBe(true);
  });

  it('formats carton label references', () => {
    expect(cartonRef('ASN-0091', 1)).toBe('ASN-0091-01');
    expect(cartonRef('ASN-12345', 12)).toBe('ASN-12345-12');
  });
});
