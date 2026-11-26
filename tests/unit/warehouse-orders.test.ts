import { describe, expect, it } from 'vitest';
import { addressText, clientSteps, evidencePath, orderPayload, parseOrdersCsv, splitCsv, weightTolerance } from '@/lib/warehouse-orders';

describe('Warehouse OS W3a helpers', () => {
  it('uses the larger of the fixed grams and the percentage, like wh_weight_tolerance()', () => {
    expect(weightTolerance(266, 20, 5)).toBe(20);          // 5 % of 266 g = 13.3 g → 20 g wins
    expect(weightTolerance(1000, 20, 5)).toBe(50);
    expect(weightTolerance(401, 20, 5)).toBe(21);          // 20.05 rounds up
    expect(weightTolerance(null, 20, 5)).toBeNull();       // unknown expected weight stays unknown
    expect(weightTolerance(500, 0, 0)).toBe(0);
  });

  it('splits CSV with quotes, doubled quotes, commas and line breaks inside quotes', () => {
    expect(splitCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(splitCsv('\uFEFFa\n\n"multi\nline",2')).toEqual([['a'], ['multi\nline', '2']]);
  });

  it('groups rows into orders and checks the shape', () => {
    const csv = [
      'order_number,name,phone,address1,address2,city,region,postcode,country,sku,qty',
      '1001,Ana Silva,+351 900,Rua 1,,Lisbon,,1000-001,pt,lamp-1,2',
      '1001,,,,,,,,,HUB-2,1',
      '1002,Ben,,"Main St 5, Apt 2",,Berlin,,10115,DE,LAMP-1,x',
      '1003,Cy,,Road 9,,Paris,,,FR,LAMP-1,1',
      '1003,Cy,,Other road,,Paris,,,FR,HUB-2,1',
      '1004,,,,,,,,,LAMP-1,1',
    ].join('\n');
    const r = parseOrdersCsv(csv);
    expect(r.orders.map((o) => o.external_ref)).toEqual(['1001', '1003']);
    expect(r.orders[0].lines).toEqual([{ sku: 'LAMP-1', qty: '2' }, { sku: 'HUB-2', qty: '1' }]);
    expect(r.orders[0].ship.country).toBe('PT');
    expect(r.orders[0].rows).toEqual([2, 3]);
    expect(r.errors.map((e) => e.row)).toEqual([4, 6, 7]);
    expect(r.errors[0].message).toMatch(/not a whole number/);
    expect(r.errors[1].message).toMatch(/different address/);
    expect(r.errors[2].message).toMatch(/required on its first row/);
    expect(orderPayload(r.orders[0])).toEqual({ external_ref: '1001', ship: r.orders[0].ship, lines: [{ sku: 'LAMP-1', qty: '2' }, { sku: 'HUB-2', qty: '1' }] });
  });

  it('refuses a file without the required columns or with too many orders', () => {
    expect(parseOrdersCsv('order_number,sku\n1,A').errors[0].message).toMatch(/Missing column/);
    expect(parseOrdersCsv('').errors[0].message).toMatch(/empty/);
    const many = ['order_number,name,address1,city,country,sku,qty', ...Array.from({ length: 3 }, (_, i) => `${i},N,A,C,US,S,1`)].join('\n');
    expect(parseOrdersCsv(many, 2).errors.at(-1)?.message).toMatch(/Up to 2 orders/);
  });

  it('builds evidence paths the storage policy accepts', () => {
    const u = '0b9f6c1e-1d2a-4f5b-9c3d-123456789abc';
    expect(evidencePath('FS-01', 'WO-000123', 'scale', u, 'image/jpeg')).toBe(`FS-01/WO-000123/scale-${u}.jpg`);
    expect(evidencePath('FS-01', 'WO-000123', 'sealed', u, 'image/gif')).toBeNull();
    expect(evidencePath('fs-01', 'WO-000123', 'sealed', u, 'image/png')).toBeNull();
  });

  it('formats addresses and client steps', () => {
    expect(addressText({ line1: 'Rua 1', city: 'Lisbon', postcode: '1000-001' }, 'PT')).toBe('Rua 1, Lisbon, 1000-001, PT');
    expect(addressText({ address1: '5 Main St', state: 'NY', zip: '10001' }, 'US')).toBe('5 Main St, NY, 10001, US');
    expect(clientSteps('picking').map((s) => s.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(clientSteps('packed').map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(clientSteps('shipped').every((s) => s.state === 'done')).toBe(true);
  });
});
