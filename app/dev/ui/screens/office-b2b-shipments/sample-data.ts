/** SAMPLE data for the B2B shipments + geography fixtures (ODS T9 batch 4). Invented for design review only. */
import type { ReadyRow, ShipmentRow } from '@/app/ods/office/warehouse/b2b-shipments/_lib/shipping-core';
import type { GeoCountryRow } from '@/app/ods/admin/geography/_lib/geography-core';

export const B2B_FIXTURE_STATES = [
  ['shipments', 'Shipments'],
  ['drawer', 'Shipment drawer'],
  ['exceptions', 'Exceptions'],
  ['ready', 'Ready to ship'],
  ['create', 'Create shipment'],
  ['create-view-only', 'Create · view only'],
  ['support', 'Support only (no carrier / rate / label)'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Error'],
] as const;
export type B2bFixtureState = (typeof B2B_FIXTURE_STATES)[number][0];

const ev = (status: string, description: string, at: string) => ({ status, description, occurred_at: at });
export const SAMPLE_SHIPMENTS: ShipmentRow[] = [
  { id: 's1', code: 'SHP-0231', trackingNo: 'YT2611270001234', status: 'in_transit', serviceCode: 'YunExpress Global Direct', carrierName: 'YunExpress', labelUrl: 'https://sample.example/label/SHP-0231.pdf', rateCents: 18450, rateCurrency: 'USD', at: '2026-11-26T09:00:00Z', order: { id: 'o1', code: 'ORD-2291' }, dropshipOrder: null, isDropship: false,
    events: [ev('in_transit', 'Departed Shenzhen hub', '2026-11-26T09:00:00Z'), ev('picked_up', 'Picked up from supplier', '2026-11-25T06:00:00Z'), ev('created', 'Shipment created. Label ready.', '2026-11-24T10:00:00Z')] },
  { id: 's2', code: 'SHP-0229', trackingNo: 'YT2611250009876', status: 'exception', serviceCode: 'YunExpress Priority', carrierName: 'YunExpress', labelUrl: 'https://sample.example/label/SHP-0229.pdf', rateCents: 26200, rateCurrency: 'USD', at: '2026-11-26T14:00:00Z', order: { id: 'o2', code: 'ORD-2284' }, dropshipOrder: null, isDropship: false,
    events: [ev('exception', 'Customs hold: commercial invoice requested', '2026-11-26T14:00:00Z'), ev('in_transit', 'Arrived Dubai', '2026-11-25T20:00:00Z')] },
  { id: 's3', code: 'SHP-0224', trackingNo: 'YT2611200004321', status: 'delivered', serviceCode: 'YunExpress Global Direct', carrierName: 'YunExpress', labelUrl: null, rateCents: 9800, rateCurrency: 'USD', at: '2026-11-23T11:00:00Z', order: { id: 'o3', code: 'ORD-2270' }, dropshipOrder: null, isDropship: false,
    events: [ev('delivered', 'Delivered, signed by A. Petrova', '2026-11-23T11:00:00Z')] },
  { id: 's4', code: 'SHP-0219', trackingNo: 'YT2611150001111', status: 'label_ready', serviceCode: 'YunExpress Economy', carrierName: 'YunExpress', labelUrl: 'https://sample.example/label/SHP-0219.pdf', rateCents: null, rateCurrency: 'USD', at: '2026-11-15T08:00:00Z', order: null, dropshipOrder: 'DS-10442', isDropship: true,
    events: [ev('created', 'Shipment created. Label ready.', '2026-11-15T08:00:00Z')] },
];

export const SAMPLE_READY: ReadyRow[] = [
  { id: '30000000-0000-4000-8000-000000000001', code: 'ORD-2302', title: 'Bamboo cutting board set ×1,200', buyer: 'Anna Home Trading', buyerCountry: 'AE', supplierCode: 'SUP-NB-014', totalCents: 1_842_000, currency: 'USD', incoterm: 'DAP', readySince: '2026-11-25T10:00:00Z' },
  { id: '30000000-0000-4000-8000-000000000002', code: 'ORD-2298', title: 'Linen cushion covers ×600', buyer: 'Nordic Living AB', buyerCountry: 'SE', supplierCode: 'SUP-SZ-031', totalCents: 720_000, currency: 'USD', incoterm: 'FOB', readySince: '2026-11-26T15:00:00Z' },
];

export const GEO_FIXTURE_STATES = [
  ['default', 'All regions'],
  ['region', 'Region: Middle East'],
  ['drawer', 'Country drawer'],
  ['loading', 'Loading'],
  ['empty', 'No customers match'],
  ['error', 'Error'],
] as const;
export type GeoFixtureState = (typeof GEO_FIXTURE_STATES)[number][0];

const g = (country: string, name: string, region: string, customers: number, verified: number, pending: number, orders: number, gmv: number, cities: [string, number][], cny = 0): GeoCountryRow => ({
  country, name, region, customers, verified, pending, rejected: 0, notStarted: customers - verified - pending, orders, gmv,
  gmvBy: cny ? { USD: gmv - cny, CNY: cny * 7 } : { USD: gmv }, cities: cities.map(([city, n]) => ({ city, n })),
});
export const SAMPLE_GEO: GeoCountryRow[] = [
  g('AE', 'United Arab Emirates', 'Middle East', 42, 35, 5, 118, 248_500_00, [['Dubai', 30], ['Sharjah', 8], ['Abu Dhabi', 4]], 12_000_00),
  g('SA', 'Saudi Arabia', 'Middle East', 21, 15, 4, 51, 121_200_00, [['Riyadh', 14], ['Jeddah', 7]]),
  g('DE', 'Germany', 'Europe', 18, 16, 1, 40, 96_400_00, [['Hamburg', 6], ['Berlin', 5]]),
  g('SE', 'Sweden', 'Europe', 9, 8, 1, 22, 44_100_00, [['Stockholm', 7]]),
  g('AU', 'Australia', 'Asia-Pacific', 11, 7, 3, 19, 39_800_00, [['Sydney', 6], ['Melbourne', 5]]),
  g('US', 'United States', 'North America', 7, 5, 2, 12, 31_000_00, [['Miami', 3]]),
];
