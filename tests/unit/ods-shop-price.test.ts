import { describe, expect, it } from 'vitest';
import { priceForQuantity, normaliseTiers, fromPriceCents, tierRange } from '@/app/ods/shop/products/_lib/price';
import { parseProductParams, productsHref, activeFilterCount } from '@/app/ods/shop/products/_lib/filters';
import { safeSpecs } from '@/app/ods/shop/products/_lib/white-label';
import { samplesAvailableFor } from '@/app/ods/shop/products/_lib/samples';
import { PRODUCT_COLS, PRODUCT_FACTORY_COLS, FORBIDDEN_COLUMN } from '@/app/ods/shop/products/_lib/columns';

const TIERS = [
  { minQty: 500, unitCents: 185 },
  { minQty: 1000, unitCents: 162 },
  { minQty: 5000, unitCents: 145 },
];

describe('priceForQuantity (ODS product page calculator)', () => {
  it('rejects empty, fractional, zero and negative quantities', () => {
    expect(priceForQuantity(TIERS, null, 500).status).toBe('invalid');
    expect(priceForQuantity(TIERS, Number.NaN, 500).status).toBe('invalid');
    expect(priceForQuantity(TIERS, 2.5, 500).status).toBe('invalid');
    expect(priceForQuantity(TIERS, 0, 500).status).toBe('invalid');
    expect(priceForQuantity(TIERS, -5, 500).status).toBe('invalid');
  });

  it('is below MOQ under the minimum order, with how many units are missing', () => {
    expect(priceForQuantity(TIERS, 300, 500)).toEqual({ status: 'below-moq', minimum: 500, shortBy: 200 });
    // no moq given → the first tier is the minimum
    expect(priceForQuantity(TIERS, 499)).toEqual({ status: 'below-moq', minimum: 500, shortBy: 1 });
  });

  it('picks the tier, unit price, exact total and next tier', () => {
    const r = priceForQuantity(TIERS, 2000, 500);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.tierIndex).toBe(1);
    expect(r.unitCents).toBe(162);
    expect(r.totalCents).toBe(324000); // US$ 3,240.00
    expect(r.range).toEqual({ from: 1000, to: 4999 });
    expect(r.next).toEqual({ tier: { minQty: 5000, unitCents: 145 }, range: { from: 5000, to: null }, unitsToGo: 3000 });
  });

  it('uses tier boundaries inclusively and has no next tier on the best price', () => {
    const at = priceForQuantity(TIERS, 1000, 500);
    expect(at.status === 'ok' && at.unitCents).toBe(162);
    const best = priceForQuantity(TIERS, 5000, 500);
    expect(best.status === 'ok' && best.next).toBeNull();
    expect(best.status === 'ok' && best.range).toEqual({ from: 5000, to: null });
  });

  it('uses the first tier between the MOQ and the first tier minimum', () => {
    const r = priceForQuantity([{ minQty: 1000, unitCents: 200 }], 600, 500);
    expect(r.status === 'ok' && r.unitCents).toBe(200);
    expect(r.status === 'ok' && r.totalCents).toBe(120000);
  });

  it('says price on request when there are no tiers, but still checks the MOQ', () => {
    expect(priceForQuantity([], 800, 500)).toEqual({ status: 'no-tiers', quantity: 800 });
    expect(priceForQuantity([], 100, 500).status).toBe('below-moq');
    expect(priceForQuantity([{ minQty: 1, unitCents: 0 }], 10).status).toBe('no-tiers');
  });

  it('sorts, drops zero prices and de-duplicates tiers', () => {
    expect(normaliseTiers([{ minQty: 1000, unitCents: 150 }, { minQty: 100, unitCents: 0 }, { minQty: 1000, unitCents: 140 }, { minQty: 50, unitCents: 300 }]))
      .toEqual([{ minQty: 50, unitCents: 300 }, { minQty: 1000, unitCents: 140 }]);
    expect(tierRange(TIERS, 0)).toEqual({ from: 500, to: 999 });
  });

  it('from price is the lowest tier, else the fallback, never 0', () => {
    expect(fromPriceCents(TIERS)).toBe(145);
    expect(fromPriceCents([], 99)).toBe(99);
    expect(fromPriceCents([], 0)).toBeNull();
    expect(fromPriceCents([])).toBeNull();
  });
});

describe('product list URL state', () => {
  it('parses known keys, ignores junk and keeps legacy ?c=', () => {
    const s = parseProductParams({ category: 'bakeware', min: '1.5', max: 'abc', moq: '500', verified: '1', samples: '0', sort: 'evil', page: '3' });
    expect(s).toMatchObject({ category: 'bakeware', min: 1.5, max: null, moq: 500, verified: true, samples: false, sort: 'best', page: 3 });
    expect(parseProductParams({ c: 'pets' }).category).toBe('pets');
  });

  it('builds hrefs, resets the page on filter changes and counts active filters', () => {
    const s = parseProductParams({ q: 'mat', category: 'bakeware', page: '2', custom: '1' });
    expect(productsHref(s, { verified: true })).toBe('/shop/products?q=mat&category=bakeware&verified=1&custom=1');
    expect(productsHref(s, { page: 3 })).toBe('/shop/products?q=mat&category=bakeware&custom=1&page=3');
    expect(productsHref(s, { category: null, custom: false })).toBe('/shop/products?q=mat');
    expect(activeFilterCount(s)).toBe(2);
  });
});

describe('white-label spec filter', () => {
  it('drops supplier, factory, model number, cost and margin rows', () => {
    const rows = [
      { name: 'Material', value: 'Silicone' },
      { name: 'Supplier', value: 'Acme Factory' },
      { name: 'Factory code', value: 'F-102' },
      { name: 'Model No.', value: 'SM-01' },
      { name: 'Item number', value: '123' },
      { name: 'Cost price', value: '1.00' },
      { name: 'Margin', value: '20%' },
      { name: 'Packing', value: 'Polybag' },
    ];
    expect(safeSpecs(rows).map((r) => r.name)).toEqual(['Material', 'Packing']);
  });
});

describe('product page columns (white-label)', () => {
  it('selects only customer-safe columns', () => {
    const cols = PRODUCT_COLS.replace(/[()]/g, ',').split(',').map((c) => c.trim()).filter(Boolean);
    expect(cols.filter((c) => FORBIDDEN_COLUMN.test(c))).toEqual([]);
    expect(PRODUCT_FACTORY_COLS).toBe('verified');
    expect(PRODUCT_COLS).not.toMatch(/supplier|province|city/);
  });
});

describe('samples (owner decision 4, T5a): every product unless tagged no-samples', () => {
  it('is available for untagged products when the sample service is on', () => {
    expect(samplesAvailableFor([], true)).toBe(true);
    expect(samplesAvailableFor(['customisable'], true)).toBe(true);
    expect(samplesAvailableFor(['samples'], true)).toBe(true);
  });
  it('is off for products tagged no-samples, or when the sample service is off', () => {
    expect(samplesAvailableFor(['no-samples'], true)).toBe(false);
    expect(samplesAvailableFor(['customisable', 'no-samples'], true)).toBe(false);
    expect(samplesAvailableFor([], false)).toBe(false);
    expect(samplesAvailableFor(['samples'], false)).toBe(false);
  });
  it('the old "samples" filter no longer counts as an active filter', () => {
    expect(activeFilterCount(parseProductParams({ samples: '1' }))).toBe(0);
  });
});
