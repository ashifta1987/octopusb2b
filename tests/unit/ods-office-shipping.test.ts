import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_NAMES } from '@octopus/ui/status';
import {
  applyShippingAccess, b2bShippingAccess, b2bView, billedTo, carrierStatusText, orderLink, shipmentColumnIds, shipmentStatusName, validateParcel, type ShipmentRow,
} from '@/app/ods/office/warehouse/b2b-shipments/_lib/shipping-core';
import { exportHref, geoHref, isMixed, pct, periodDays, share, topCities, topRegion, type GeoCountryRow } from '@/app/ods/admin/geography/_lib/geography-core';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const acc = (perms: string[], isAdmin = false) => b2bShippingAccess({ isAdmin, can: (a, x) => perms.includes(`${a}:${x}`) });
const ROW: ShipmentRow = {
  id: 's', code: 'SHP-1', trackingNo: 'YT1', status: 'in_transit', serviceCode: 'Global Direct', carrierName: 'YunExpress', labelUrl: 'https://l', rateCents: 100, rateCurrency: 'USD',
  at: '2026-11-27T00:00:00Z', order: { id: 'o', code: 'ORD-1' }, dropshipOrder: null, isDropship: false,
  events: [{ status: 'created', description: null, occurred_at: '2026-11-20T00:00:00Z' }, { status: 'in_transit', description: 'x', occurred_at: '2026-11-26T00:00:00Z' }],
};

describe('ODS T9 B2B shipments · who sees what (today\'s b2bShippingAccess, F-05)', () => {
  it('Support only (orders:view): no carrier, service, rate or label; no ready-to-ship', () => {
    const a = acc(['orders:view']);
    const r = applyShippingAccess(ROW, a);
    expect([r.carrierName, r.serviceCode, r.rateCents, r.labelUrl]).toEqual([null, null, null, null]);
    expect(shipmentColumnIds(a)).toEqual(['code', 'order', 'waybill', 'last', 'status']);
    expect(a.canSeeReadyToShip).toBe(false);
    expect(b2bView('ready', a)).toBe('shipments');
  });
  it('orders:edit sees everything and can create', () => {
    const a = acc(['orders:view', 'orders:edit']);
    expect(shipmentColumnIds(a)).toEqual(['code', 'order', 'carrier', 'service', 'waybill', 'rate', 'last', 'status', 'label']);
    expect(applyShippingAccess(ROW, a).labelUrl).toBe('https://l');
    expect(a.canEdit).toBe(true);
    expect(b2bView('ready', a)).toBe('ready');
  });
  it('warehouse:view: carrier + label, no rate; finance: carrier + rate, no label', () => {
    expect(shipmentColumnIds(acc(['warehouse:view']))).toEqual(['code', 'order', 'carrier', 'service', 'waybill', 'last', 'status', 'label']);
    expect(shipmentColumnIds(acc(['finance:view']))).toEqual(['code', 'order', 'carrier', 'service', 'waybill', 'rate', 'last', 'status']);
    expect(acc(['finance:view']).canSeeSuppliers).toBe(true);
  });
  it('events newest first', () => {
    expect(applyShippingAccess(ROW, acc([], true)).events[0].status).toBe('in_transit');
  });
});

describe('ODS T9 B2B shipments · statuses and helpers', () => {
  it('Appendix C names with today\'s tones', () => {
    expect(shipmentStatusName('delivered')).toBe('Delivered');
    expect(shipmentStatusName('exception')).toBe('Failed');
    expect(shipmentStatusName('returned')).toBe('Failed');
    for (const s of ['picked_up', 'in_transit', 'out_for_delivery']) expect(shipmentStatusName(s)).toBe('Shipped');
    expect(shipmentStatusName('label_ready')).toBe('Pending');
    const all = new Set<string>(Object.values(STATUS_NAMES).flat());
    for (const s of ['delivered', 'exception', 'in_transit', 'created']) expect(all.has(shipmentStatusName(s))).toBe(true);
  });
  it('billed to, parcel check, carrier badge, order link (F-06)', () => {
    expect(billedTo('DDP')).toBe('Seller (DDP)');
    expect(billedTo(null)).toBe('Buyer (FOB)');
    expect(validateParcel(0, 1)).toBe('Enter the weight and number of pieces.');
    expect(validateParcel(2.5, 1)).toBeNull();
    expect(carrierStatusText('live', false)).toBe('Production');
    expect(carrierStatusText('sandbox', true)).toBe('Sandbox mode');
    expect(carrierStatusText('sandbox', false)).toBe('Carrier not connected');
    const pf = (q: string | null) => `/wh?q=${q}`;
    expect(orderLink(ROW, false, pf)).toEqual({ label: 'ORD-1', href: '/office/orders/o' });
    expect(orderLink({ order: null, dropshipOrder: 'DS-1', isDropship: true }, false, pf)).toEqual({ label: 'DS-1', href: null });
    expect(orderLink({ order: null, dropshipOrder: 'DS-1', isDropship: true }, true, pf).href).toBe('/wh?q=DS-1');
    expect(orderLink({ order: null, dropshipOrder: null, isDropship: false }, true, pf)).toEqual({ label: '—', href: null });
  });
  it('the page keeps today\'s guard, RPCs and actions', () => {
    const page = src('app/ods/office/warehouse/b2b-shipments/page.tsx');
    expect(page).toMatch(/^\/\/ ODS T9/);
    expect(page).toContain("requireStaff('orders', 'view', B2B_SHIPMENTS_PATH)");
    expect(page).toContain("rpc('get_shipment_rates'");
    expect(page).toContain("rpc('get_shipment_carriers'");
    expect(page).toContain('a.canSeeCarrier && shipIds.length');
    expect(page).toContain('priceTrial={priceTrial}');
    expect(page).toContain('createShipment={createShipment}');
    expect(page).toContain('getDivisionScope(s)');
  });
});

describe('ODS T9 Customer geography', () => {
  it('period, links and export keep today\'s query', () => {
    expect(periodDays('30')).toBe(30);
    expect(periodDays('7')).toBe(0);
    expect(geoHref('/admin/geography', { kyc: 'verified' }, { region: 'Europe' })).toBe('/admin/geography?kyc=verified&region=Europe');
    expect(geoHref('/admin/geography', { kyc: 'verified' }, { kyc: undefined })).toBe('/admin/geography');
    expect(geoHref('/dev?state=x', { period: '90' })).toBe('/dev?state=x&period=90');
    expect(exportHref({ kyc: 'pending', type: '' })).toBe('/admin/geography/export?kyc=pending');
    expect(exportHref({})).toBe('/admin/geography/export');
  });
  it('percentages, top region, mixed currency, top cities', () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(1, 0)).toBe(0);
    expect(share(1, 8)).toBe('12.5');
    expect(topRegion([{ region: 'A', customers: 1, gmv: 0 }])).toBeNull();
    expect(topRegion([{ region: 'A', customers: 1, gmv: 5 }, { region: 'B', customers: 1, gmv: 9 }])?.region).toBe('B');
    expect(isMixed({ gmvBy: { USD: 1, CNY: 2 } }, 'USD')).toBe(true);
    expect(isMixed({ gmvBy: { USD: 1 } }, 'USD')).toBe(false);
    const r = (country: string, cities: [string, number][]) => ({ country, cities: cities.map(([city, n]) => ({ city, n })) }) as GeoCountryRow;
    expect(topCities([r('AE', [['Dubai', 5]]), r('SA', [['Riyadh', 9], ['Jeddah', 1]])], 2).map((c) => c.city)).toEqual(['Riyadh', 'Dubai']);
  });
  it('the page keeps customers:view and today\'s loader', () => {
    const page = src('app/ods/admin/geography/page.tsx');
    expect(page).toMatch(/^\/\/ ODS T9/);
    expect(page).toContain("requireStaff('customers', 'view', '/admin/geography')");
    expect(page).toContain("from '@/app/admin/geography/data'");
  });
});
