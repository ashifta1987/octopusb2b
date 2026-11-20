import { describe, expect, it } from 'vitest';
import { dropshipFromBox, packingSlipHtml, returnAddressLines, type SellerBrand } from '@/lib/dropship-print';

// Dropship parcels (owner's decision 19 Nov 2026): label + packing slip show ONLY the seller's brand and the approved
// return address — no Octopus, no supplier code (OCT-…), no factory label, no prices / costs.
const brand: SellerBrand = {
  brand_name: 'TEST · Lumen Home', return_name: 'Lumen Returns', return_line1: 'Unit 4, Example St', return_line2: null,
  return_city: 'Dubai', return_region: 'Dubai', return_postal_code: '00000', return_country: 'AE',
};
const FORBIDDEN = [/octopus/i, /\bOCT-\d+/, /factory/i, /supplier/i, /[$€£¥]\s?\d/, /\b(USD|CNY|AED|EUR)\s?\d/, /\d\s?(USD|CNY|AED|EUR)\b/, /price|cost|total/i];

describe('dropship print helpers', () => {
  it('return address lines drop empty parts and escape HTML', () => {
    expect(returnAddressLines(brand)).toEqual(['Lumen Returns', 'Unit 4, Example St', '00000 Dubai, Dubai', 'AE']);
    expect(returnAddressLines({ ...brand, return_line1: '<script>x</script>' })[1]).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('label From box: brand + return address only', () => {
    const html = dropshipFromBox(brand);
    expect(html).toContain('TEST · Lumen Home');
    expect(html).toContain('Unit 4, Example St');
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });

  it('packing slip: brand header, ship-to, order code, items + quantities, return address — nothing else', () => {
    const html = packingSlipHtml({
      brand, orderCode: 'TEST-ORD-DS', date: '2026-11-19', tracking: 'TESTDS0000000001',
      shipTo: { name: 'Jane Buyer', line1: '9 Customer Rd', city: 'Berlin', postal_code: '10115', country: 'DE' },
      items: [{ description: 'Ceramic table lamp', quantity: 2 }],
    });
    expect(html).toMatch(/data-testid="slip-brand">TEST · Lumen Home</);
    for (const s of ['Jane Buyer', '9 Customer Rd', '10115 Berlin', 'TEST-ORD-DS', 'Ceramic table lamp', '>2<', 'Unit 4, Example St', 'Packing slip']) expect(html).toContain(s);
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });
});
