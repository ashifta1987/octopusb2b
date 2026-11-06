import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTemplate, suggestProductId, TEMPLATE_COLUMNS, type TemplateRow } from '@/lib/import/template';
import { quoteText } from '@/lib/import/export';
import { parsePriceOptions } from '@/lib/import/parse-prices';
import { parseWorkbook } from '@/lib/import/parse-workbook';

const SUP = { external_id: 'CN-ZZ-QAT-0001', manufacturer_code: 'QAT', contact: 'Test Person, Sales', phone: '+86 100', email: 'qa@example.com', handle: '@qa', variants: [] };
const opts = (imageFiles: string[] | null = null) => ({ validFrom: '2026-11-01', validDays: 30, outlierX: 3, imageFiles });
const row = (r: Partial<TemplateRow>): TemplateRow => ({ sheet: 'Gadgets', Category: 'Electronics', 'Factory model': 'M1', ...r });

describe('bulk-update template (ADDON-29)', () => {
  it('README first, Supplier second, every category sheet has exactly the 20 columns in order', async () => {
    const buf = await buildTemplate({ supplier: SUP, rows: [row({ 'Product Id': 'CN-ZZ-QAT-A1' }), row({ sheet: 'Not Quoted', 'Product Id': 'CN-ZZ-QAT-B1' })] });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['README', 'Supplier', 'Gadgets', 'Not Quoted']);
    for (const ws of wb.worksheets.slice(2)) {
      const head = (ws.getRow(1).values as unknown[]).slice(1);
      expect(head).toEqual([...TEMPLATE_COLUMNS]);
      expect(head[0]).toBe('Product Id'); expect(head[8]).toBe('Image file');
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.getRow(1).font?.bold).toBe(true);
      expect((ws.getCell('A1').fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFFFF2B3');   // required → yellow
      expect(ws.getCell('A1').note).toBeTruthy();
    }
    expect(wb.getWorksheet('Supplier')!.getCell('A2').value).toBe('Supplier ID');
  });

  it('a blank template parses with no products and no errors; a filled one round-trips', async () => {
    const blank = await parseWorkbook(await buildTemplate(), opts());
    expect(blank.products).toHaveLength(0);
    const filled = await parseWorkbook(await buildTemplate({ supplier: SUP, rows: [
      row({ 'Product Id': 'cn-zz-qat-a1', 'Price USD': 2.5, 'Price options as quoted': 'FOB, MOQ 500', 'Image file': 'a1.jpg' }),
      row({ 'Product Id': 'CN-ZZ-QAT-A2', 'Factory model': 'M2' }),
    ] }), opts(['a1.jpg']));
    expect(filled.errors).toEqual([]);
    expect(filled.products.map((p) => p.external_id)).toEqual(['CN-ZZ-QAT-A1', 'CN-ZZ-QAT-A2']);   // upper-cased
    expect(filled.prices).toEqual([expect.objectContaining({ external_id: 'CN-ZZ-QAT-A1', incoterm: 'FOB', moq_tier_min: 500, price_minor: 25000 })]);
    expect(filled.images).toEqual([expect.objectContaining({ external_id: 'CN-ZZ-QAT-A1', file: 'a1.jpg' })]);
    expect(filled.products[1].listing_status).toBe('needs_quote');
  });

  it('rejects a row with a blank Product Id (and a badly formatted one)', async () => {
    const b = await parseWorkbook(await buildTemplate({ supplier: SUP, rows: [row({ 'Product Id': null }), row({ 'Product Id': 'F8' })] }), opts());
    expect(b.errors.map((e) => e.message).join('\n')).toMatch(/row 2: Product Id is blank/);
    expect(b.errors.map((e) => e.message).join('\n')).toMatch(/row 3: Product Id "F8" is not in the format/);
  });

  it('rejects an Image file that is not in the ZIP, reports a case mismatch, and refuses paths', async () => {
    const b = await parseWorkbook(await buildTemplate({ supplier: SUP, rows: [
      row({ 'Product Id': 'CN-ZZ-QAT-A1', 'Image file': 'missing.jpg' }),
      row({ 'Product Id': 'CN-ZZ-QAT-A2', 'Image file': 'F8.jpg' }),
      row({ 'Product Id': 'CN-ZZ-QAT-A3', 'Image file': 'images/x.jpg' }),
      row({ 'Product Id': 'CN-ZZ-QAT-A4', 'Image file': 'doc.pdf' }),
    ] }), opts(['f8.jpg', 'other.jpg']));
    const msg = b.errors.map((e) => e.message).join('\n');
    expect(msg).toMatch(/row 2 \(CN-ZZ-QAT-A1\): Image file "missing.jpg" is not in the ZIP/);
    expect(msg).toMatch(/row 3 \(CN-ZZ-QAT-A2\): Image file "F8.jpg" does not match "f8.jpg"/);
    expect(msg).toMatch(/must be a file name, not a path/);
    expect(msg).toMatch(/must be \.jpg, \.jpeg, \.png, \.webp or \.avif/);
    expect(b.images).toHaveLength(0);
  });

  it('the same photo on two rows is linked to both, with a warning', async () => {
    const b = await parseWorkbook(await buildTemplate({ supplier: SUP, rows: [
      row({ 'Product Id': 'CN-ZZ-QAT-A1', 'Image file': 'same.jpg' }), row({ 'Product Id': 'CN-ZZ-QAT-A2', 'Image file': 'same.jpg' }),
    ] }), opts(['same.jpg']));
    expect(b.errors).toEqual([]);
    expect(b.images.map((i) => i.external_id)).toEqual(['CN-ZZ-QAT-A1', 'CN-ZZ-QAT-A2']);
    expect(b.warnings.join()).toMatch(/same.jpg is used by 2 products/);
  });

  it('quoteText() writes prices back in a form the parser reads to the same rows', () => {
    const shapes = [
      [{ incoterm: 'EXW', moq_tier_min: 3000, variant_label: '', price_minor: 46100 }],
      [{ incoterm: 'FOB', moq_tier_min: 3000, variant_label: '不带米家', price_minor: 122080 }],
      [{ incoterm: 'FOB', moq_tier_min: 3000, variant_label: 'Plug-in', price_minor: 11200 }, { incoterm: 'FOB', moq_tier_min: 3000, variant_label: 'Rechargeable', price_minor: 15000 },
       { incoterm: 'FOB', moq_tier_min: 1000, variant_label: 'Plug-in', price_minor: 13400 }, { incoterm: 'FOB', moq_tier_min: 1000, variant_label: 'Rechargeable', price_minor: 18000 }],
    ];
    for (const rows of shapes) {
      const q = quoteText(rows.map((r) => ({ ...r, product_id: 'x' })));
      const back = parsePriceOptions(q.quote, { priceColumn: q.price, defaultIncoterm: 'FOB' }).rows.map((r) => `${r.incoterm}|${r.moq}|${r.variant}|${Math.round(r.price * 10000)}`).sort();
      expect(back).toEqual(rows.map((r) => `${r.incoterm}|${r.moq_tier_min}|${r.variant_label}|${r.price_minor}`).sort());
    }
  });

  it('suggests Product Ids from the supplier id + factory model', () => {
    expect(suggestProductId('CN-GD-BWJ-0010', 'F8制冷手持风扇')).toBe('CN-GD-BWJ-F8');
    expect(suggestProductId('CN-GD-BWJ-0010', 'P10 Humidifier (In Development)')).toBe('CN-GD-BWJ-P10');
    expect(suggestProductId(null, 'F8')).toBe('');
  });
});

