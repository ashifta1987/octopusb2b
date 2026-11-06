import { describe, expect, it } from 'vitest';
import { SKU_ERRORS, categoryCode, duplicateSkus, nextSkus, normalizeSku, skuDbError, skuProblem } from '@/lib/sku';
import { pricesEqualSupplierCost, diffProduct, exportImageName, exportPrice, inFileDuplicateErrors, matchImage, unreferenced, zipImageEntries } from '@/lib/product-import';
import { productSchema } from '@/components/backoffice/product-schema';
import { toCents } from '@/lib/format';

describe('SKU rules (ADDON-33)', () => {
  it('normalises and validates', () => {
    expect(normalizeSku('  fst-blt-m10x40-a2 ')).toBe('FST-BLT-M10X40-A2');
    expect(skuProblem('FST-BLT-M10X40-A2')).toBeNull();
    expect(skuProblem('a.b_c')).toBeNull();
    expect(skuProblem('')).toBe(SKU_ERRORS.blank);
    expect(skuProblem('AB')).toBe(SKU_ERRORS.format);
    expect(skuProblem('FST BLT')).toBe(SKU_ERRORS.format);
    expect(skuProblem('-FST')).toBe(SKU_ERRORS.format);
    expect(skuProblem('X'.repeat(41))).toBe(SKU_ERRORS.format);
  });
  it('maps database errors to one wording on every route', () => {
    expect(skuDbError('SKU_TAKEN: SKU already used by another supplier.')).toBe(SKU_ERRORS.otherSupplier);
    expect(skuDbError('duplicate key value violates unique constraint "products_sku_norm_key"')).toBe(SKU_ERRORS.otherSupplier);
    expect(skuDbError('SKU_RETIRED: …')).toBe(SKU_ERRORS.retired);
    expect(skuDbError('SKU_IMMUTABLE: …')).toBe(SKU_ERRORS.immutable);
    expect(skuDbError('something else')).toBeNull();
  });
  it('category codes and running numbers never propose a taken SKU', () => {
    expect(categoryCode('Fasteners')).toBe('FST');
    expect(categoryCode('Power tools')).toBe('PWR');
    expect(categoryCode('Safety & PPE')).toBe('SFT');
    expect(categoryCode('')).toBe('GEN');
    expect(nextSkus('FST', ['FST-000007', 'fst-000009', 'FST-BLT-1'], 3)).toEqual(['FST-000010', 'FST-000011', 'FST-000012']);
  });
  it('finds duplicates inside a file with every row number', () => {
    const rows = [{ row: 2, sku: 'A-001' }, { row: 3, sku: 'a-001 ' }, { row: 4, sku: 'B-001' }, { row: 7, sku: 'A-001' }];
    expect(duplicateSkus(rows).get('A-001')).toEqual([2, 3, 7]);
    const errs = inFileDuplicateErrors(rows, SKU_ERRORS.duplicateInFile);
    expect(errs.get(3)).toBe('SKU appears more than once in this file (rows 2, 3, 7).');
    expect(errs.has(4)).toBe(false);
  });
  it('single-product form: SKU optional, uppercase, same format', () => {
    const base = { title: 'Bolt M10', supplier_id: '00000000-0000-4000-8000-000000000000', category_id: null, tag_ids: [], unit: 'pcs', moq: 1, lead_time_days: null, incoterm: 'FOB',
      origin_country: null, hs_code: null, currency: 'USD', tiers: [{ min_qty: 1, price: 1 }], specs: [], certificate_ids: [], octopus_dropship: false, ready_to_ship: false,
      images: [], description: null, seo_title: null, seo_description: null } as const;
    expect(productSchema.safeParse({ ...base, sku: '' }).success).toBe(true);
    expect(productSchema.parse({ ...base, sku: 'fst-1001' }).sku).toBe('FST-1001');
    expect(productSchema.safeParse({ ...base, sku: 'FST 1001' }).success).toBe(false);
  });
});

describe('bulk template v2 helpers', () => {
  const entries = zipImageEntries([
    { path: 'photos/M10x40-Bolt.JPG', size: 1000 }, { path: '__MACOSX/photos/._M10x40-Bolt.JPG', size: 10 }, { path: 'photos/', size: 0 },
    { path: 'extra.png', size: 5 }, { path: '.DS_Store', size: 1 },
  ]);
  it('lists zip images, skipping folders and hidden files', () => {
    expect(entries.map((e) => e.name)).toEqual(['M10x40-Bolt.JPG', 'extra.png']);
  });
  it('matches image names case-insensitively and reports the exact name', () => {
    expect(matchImage('M10x40-Bolt.JPG', entries)).toEqual({ entry: entries[0], caseMismatch: false });
    expect(matchImage('m10x40-bolt.jpg', entries)).toEqual({ entry: entries[0], caseMismatch: true });
    expect(matchImage('missing.jpg', entries).entry).toBeNull();
  });
  it('reports zip files no row uses', () => {
    expect(unreferenced(entries, ['m10x40-bolt.jpg', ''])).toEqual(['extra.png']);
  });
  it('diff: identical → empty; changed price and title listed', () => {
    const cur = { title: 'A', category_id: 'c', unit: 'pcs', moq: 10, lead_time_days: 5, incoterm: 'FOB', origin_country: 'CN', hs_code: null, currency: 'USD',
      octopus_dropship: false, ready_to_ship: true, description: 'x', tiers: [{ min_qty: 10, unit_price_cents: 19 }] };
    expect(diffProduct(cur, { ...cur })).toEqual([]);
    const d = diffProduct(cur, { ...cur, title: 'B', tiers: [{ min_qty: 10, unit_price_cents: 20 }] });
    expect(d.map((x) => x.field)).toEqual(['title', 'price tiers']);
  });
  it('export values round-trip through the parser', () => {
    for (const c of [19, 1600, 1, 99999, 12345]) expect(toCents(String(exportPrice(c)))).toBe(c);
    expect(exportImageName({ source_file_name: 'Bolt.jpg', url: 'https://x/y/abc.jpg' })).toBe('Bolt.jpg');
    expect(exportImageName({ source_file_name: null, url: 'https://x/storage/v1/object/public/product-media/import/A%20B.jpg' })).toBe('A B.jpg');
  });
});

describe('price equals supplier cost guard (step C)', () => {
  const costs = [{ moq_tier_min: 3000, price_minor: 46100 }, { moq_tier_min: 1000, price_minor: 13400 }, { moq_tier_min: 1000, price_minor: 15000 }];
  it('flags a row whose every tier is the supplier cost (within 1 cent)', () => {
    expect(pricesEqualSupplierCost([{ min_qty: 3000, unit_price_cents: 461 }], costs)).toBe(true);           // F8 case
    expect(pricesEqualSupplierCost([{ min_qty: 1000, unit_price_cents: 134 }, { min_qty: 3000, unit_price_cents: 462 }], costs)).toBe(true);
    expect(pricesEqualSupplierCost([{ min_qty: 3000, unit_price_cents: 1221 }], [{ moq_tier_min: 3000, price_minor: 122080 }])).toBe(true); // 12.208 → 12.21
  });
  it('does not flag buyer prices (cost × 1.25) or partial matches', () => {
    expect(pricesEqualSupplierCost([{ min_qty: 3000, unit_price_cents: 577 }], costs)).toBe(false);
    expect(pricesEqualSupplierCost([{ min_qty: 1000, unit_price_cents: 134 }, { min_qty: 3000, unit_price_cents: 577 }], costs)).toBe(false);
    expect(pricesEqualSupplierCost([{ min_qty: 500, unit_price_cents: 134 }], costs)).toBe(false);   // no cost at that MOQ
    expect(pricesEqualSupplierCost([{ min_qty: 3000, unit_price_cents: 461 }], [])).toBe(false);
  });
});

