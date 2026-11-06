import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parsePriceOptions, toPriceMinor } from '@/lib/import/parse-prices';
import { parseSpecs, splitSizeNotes } from '@/lib/import/parse-specs';
import { parseWorkbook } from '@/lib/import/parse-workbook';

const DIR = path.resolve(__dirname, '../../data/bulk/bowijie');

/** tiny CSV reader (quoted fields, embedded newlines) — enough for the kit's golden files */
function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(path.join(DIR, 'csv', file), 'utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

describe('parsePriceOptions — every quote shape in the Bowijie workbook', () => {
  const fob = { defaultIncoterm: 'FOB' as const };
  it('EXW, MOQ 3000 + Price USD column', () => {
    expect(parsePriceOptions('EXW, MOQ 3000', { priceColumn: 4.61, defaultIncoterm: 'EXW' }).rows).toEqual([{ incoterm: 'EXW', moq: 3000, variant: '', price: 4.61 }]);
  });
  it('Machine：1.3 | FOB, MOQ 3000 (full-width colon)', () => {
    expect(parsePriceOptions('Machine：1.3  |  FOB, MOQ 3000', fob).rows).toEqual([{ incoterm: 'FOB', moq: 3000, variant: 'Machine', price: 1.3 }]);
  });
  it('two variants, and a typo prefix "2Machine"', () => {
    expect(parsePriceOptions('Machine with Mijia：2.4 / Machine without Mijia：2.1  |  FOB, MOQ 3000', fob).rows.map((r) => [r.variant, r.price])).toEqual([['Machine with Mijia', 2.4], ['Machine without Mijia', 2.1]]);
    expect(parsePriceOptions('2Machine without Mijia: 2.46  |  FOB, MOQ 3000', fob).rows[0].variant).toBe('Machine without Mijia');
  });
  it('a blank variant price is skipped, never zero', () => {
    const r = parsePriceOptions('带米家： / 不带米家：12.208  |  FOB, MOQ 3000', fob);
    expect(r.rows).toEqual([{ incoterm: 'FOB', moq: 3000, variant: '不带米家', price: 12.208 }]);
    expect(r.warnings.join()).toMatch(/blank price/);
  });
  it('bare number', () => {
    expect(parsePriceOptions('10.54  |  FOB, MOQ 3000', fob).rows).toEqual([{ incoterm: 'FOB', moq: 3000, variant: '', price: 10.54 }]);
  });
  it('MOQ tiers × variants', () => {
    const r = parsePriceOptions('MOQ 3000 / Plug-in: 1.12 / Rechargeable: 1.5  |  MOQ 1000 / Plug-in: 1.34 / Rechargeable: 1.8  |  FOB', fob);
    expect(r.rows).toEqual([
      { incoterm: 'FOB', moq: 3000, variant: 'Plug-in', price: 1.12 }, { incoterm: 'FOB', moq: 3000, variant: 'Rechargeable', price: 1.5 },
      { incoterm: 'FOB', moq: 1000, variant: 'Plug-in', price: 1.34 }, { incoterm: 'FOB', moq: 1000, variant: 'Rechargeable', price: 1.8 }]);
  });
  it('No price quoted', () => {
    const r = parsePriceOptions('No price quoted', fob);
    expect(r.noPrice).toBe(true); expect(r.rows).toEqual([]);
  });
  it('4-dp precision', () => { expect(toPriceMinor(9.8062)).toBe(98062); expect(toPriceMinor(12.208)).toBe(122080); });
});

describe('parseSpecs / splitSizeNotes', () => {
  it('splits lines, pipes and double-space pairs', () => {
    const s = parseSpecs('Material: ABS\nFan Speed: 5000–8000 RPM | Fan Blades: 5 pcs\nTank: approx. 280ML    Mist: approx. 40-50ml/h\nno colon here');
    expect(s.map((x) => x.key)).toEqual(['Material', 'Fan Speed', 'Fan Blades', 'Tank', 'Mist']);
    expect(s[3].value).toBe('approx. 280ML');
  });
  it('moves parenthetical notes out of size fields', () => {
    expect(splitSizeNotes('70*80*175mm\n（含底座）')).toEqual({ value: '70*80*175mm', notes: '含底座' });
    expect(splitSizeNotes('')).toEqual({ value: null, notes: null });
  });
});

describe('parseWorkbook — Bowijie source.xlsx matches the kit golden CSVs', async () => {
  const zip = unzipSync(new Uint8Array(fs.readFileSync(path.join(DIR, 'images.zip'))));
  const batch = await parseWorkbook(fs.readFileSync(path.join(DIR, 'source.xlsx')), {
    validFrom: '2026-11-01', validDays: 30, outlierX: 3, imageFiles: Object.keys(zip),
  });

  it('69 products, 77 prices, 53 images, one supplier with 3 name variants', () => {
    expect(batch.products).toHaveLength(69);
    expect(batch.prices).toHaveLength(77);
    expect(batch.images).toHaveLength(53);
    expect(batch.supplier.external_id).toBe('CN-GD-BWJ-0010');
    expect(batch.supplier.name_variants).toHaveLength(3);
    expect(batch.supplier.status).toBe('needs_identity_review');
    expect(batch.unmatched_images).toEqual([]);
  });

  it('price rows equal supplier_product_prices.csv exactly', () => {
    const key = (p: { external_id?: string; product_id?: string; incoterm: string; moq_tier_min: number | string; variant_label: string }, price: number) =>
      `${p.external_id ?? p.product_id}|${p.incoterm}|${p.moq_tier_min}|${p.variant_label}|${price}`;
    const golden = readCsv('supplier_product_prices.csv').map((r) => key(r as never, toPriceMinor(Number(r.price_usd)))).sort();
    const ours = batch.prices.map((p) => key(p, p.price_minor)).sort();
    expect(ours).toEqual(golden);
    expect(new Set(batch.prices.map((p) => `${p.valid_from}..${p.valid_to}`))).toEqual(new Set(['2026-11-01..2026-11-30']));
  });

  it('products, images, supplier rows and name variants equal the golden CSVs', () => {
    const gp = readCsv('products.csv');
    expect(batch.products.map((p) => p.external_id).sort()).toEqual(gp.map((r) => r.product_id).sort());
    const gi = readCsv('product_images.csv');
    expect(batch.images.map((i) => `${i.external_id}|${i.file}`).sort()).toEqual(gi.map((r) => `${r.product_id}|${r.image_file}`).sort());
    const gsp = Object.fromEntries(readCsv('supplier_products.csv').map((r) => [r.product_id, r]));
    for (const p of batch.products) {
      expect(p.supplier_status, p.external_id).toBe(gsp[p.external_id].status);
      expect(p.exclusivity_flag ?? '', p.external_id).toBe(gsp[p.external_id].exclusivity_flag);
      expect(p.moq == null ? '' : String(p.moq), p.external_id).toBe(gsp[p.external_id].moq);
    }
    const gv = readCsv('supplier_name_variants.csv');
    expect(batch.supplier.name_variants.map((v) => `${v.variant_name}|${v.variant_address ?? ''}|${v.seen_in}`))
      .toEqual(gv.map((r) => `${r.variant_name}|${r.variant_address}|${r.seen_in}`));
    const gs = readCsv('suppliers.csv')[0];
    expect([batch.supplier.legal_name, batch.supplier.country, batch.supplier.province, batch.supplier.city, batch.supplier.handle, batch.supplier.manufacturer_code])
      .toEqual([gs.legal_name, gs.country, gs.province, gs.city, gs.handle, gs.manufacturer_code]);
    const gc = readCsv('supplier_contacts.csv')[0];
    expect(batch.supplier.contacts[0]).toMatchObject({ name: gc.name, role: gc.role, phone: gc.phone, email: gc.email, is_primary: true });
  });

  it('every product the kit flags for review has an open review item (the importer also keeps every other supplier note)', () => {
    const flagged = new Set(batch.review.map((r) => r.external_id));
    for (const r of readCsv('review_queue.csv')) expect(flagged.has(r.product_id), r.product_id).toBe(true);
    // the price-outlier rule finds S13 / S15 / S16 on its own
    expect(batch.review.filter((r) => r.kind === 'outlier').map((r) => r.external_id).sort()).toEqual(['CN-GD-BWJ-S13', 'CN-GD-BWJ-S15', 'CN-GD-BWJ-S16']);
    expect(batch.products.find((p) => p.external_id === 'CN-GD-BWJ-P10')?.listing_status).toBe('in_development');
  });
});

