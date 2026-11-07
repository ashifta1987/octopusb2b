import { describe, it, expect } from 'vitest';
import { stockTotals, stockedCategories, isStocked } from '@/lib/category-stock';
import { supplierApplySchema } from '@/lib/supplier-apply/schema';
import type { Category } from '@/lib/content';

const cat = (id: string, parent: string | null, sort = 0, level = parent ? 2 : 1): Category =>
  ({ id, name: id, slug: id, level, parent_id: parent, hs_code: null, sort });

describe('ADDON-36 C4 category stock', () => {
  const cats = [cat('electrical', null, 1), cat('cables', 'electrical'), cat('chargers', 'electrical'), cat('lighting', 'electrical'),
    cat('electronics', null, 2), cat('projectors', 'electronics'), cat('fasteners', null, 3), cat('bolts', 'fasteners')];
  const counts = { cables: 29, chargers: 8, electronics: 18, projectors: 8 };

  it('counts products in sub-categories', () => {
    const t = stockTotals(cats, counts);
    expect(t.get('electrical')).toBe(37);
    expect(t.get('electronics')).toBe(26);
    expect(t.get('fasteners')).toBe(0);
  });
  it('drops empty categories and orders by count', () => {
    const s = stockedCategories(cats, counts);
    expect(s.map((c) => c.id)).not.toContain('fasteners');
    expect(s.map((c) => c.id)).not.toContain('lighting');
    expect(s.filter((c) => c.level === 1).map((c) => c.id)).toEqual(['electrical', 'electronics']);
    expect(s.filter((c) => c.parent_id === 'electrical').map((c) => c.id)).toEqual(['cables', 'chargers']);
  });
  it('isStocked', () => {
    expect(isStocked(cats, counts, 'bolts')).toBe(false);
    expect(isStocked(cats, counts, 'projectors')).toBe(true);
  });
  it('survives a parent loop', () => {
    const loop = [cat('a', 'b'), cat('b', 'a')];
    expect(() => stockTotals(loop, { a: 1 })).not.toThrow();
  });
});

describe('ADDON-36 C5 supplier application schema', () => {
  const ok = { company_name: 'Shenzhen Test Co., Ltd.', city: 'Shenzhen', categories: ['Electrical'], contact_name: 'Li Wei', contact_email: 'li@example.com' };
  it('accepts a minimal application', () => expect(supplierApplySchema.safeParse(ok).success).toBe(true));
  it('needs a category', () => expect(supplierApplySchema.safeParse({ ...ok, categories: [] }).success).toBe(false));
  it('checks the USCC format', () => {
    expect(supplierApplySchema.safeParse({ ...ok, uscc: '91440300MA5XXXXX1X' }).success).toBe(true);
    expect(supplierApplySchema.safeParse({ ...ok, uscc: '123' }).success).toBe(false);
  });
  it('accepts store URLs without scheme', () => expect(supplierApplySchema.safeParse({ ...ok, store_url: 'shop123.1688.com' }).success).toBe(true));
});
