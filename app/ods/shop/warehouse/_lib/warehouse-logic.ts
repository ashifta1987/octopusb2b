/**
 * ODS T4 · Warehouse (3PL) (Part 5.7) — pure helpers: the Storage | Fulfilment views (?view=) and the quote drawer
 * URL (?quote=<service key>). The four services and their rates come from the shared mapper
 * (app/ods/shop/_lib/cards.ts warehouseServicesFrom → wh_rate_versions, the live standard plan).
 */
export const WAREHOUSE_VIEWS = [
  { value: 'storage', label: 'Storage', services: ['storage', 'receiving'] },
  { value: 'fulfilment', label: 'Fulfilment', services: ['fulfilment', 'returns'] },
] as const;
export type WarehouseView = (typeof WAREHOUSE_VIEWS)[number]['value'];

export const parseWarehouseView = (v: unknown): WarehouseView => (v === 'fulfilment' ? 'fulfilment' : 'storage');

export const servicesForView = (view: WarehouseView): readonly string[] => WAREHOUSE_VIEWS.find((w) => w.value === view)!.services;

const KEYS = ['storage', 'receiving', 'fulfilment', 'returns'];
export const parseQuoteKey = (v: unknown): string | null => (typeof v === 'string' && KEYS.includes(v) ? v : null);

export function warehouseHref(o: { view: WarehouseView; quote?: string | null }): string {
  const q = new URLSearchParams();
  if (o.view !== 'storage') q.set('view', o.view);
  if (o.quote) q.set('quote', o.quote);
  const s = q.toString();
  return s ? `/shop/warehouse?${s}` : '/shop/warehouse';
}

/** Same option lists as today's 3PL application form (app/(store)/3pl/apply/apply-client.tsx). */
export const WH_CHANNELS = ['Shopify', 'WooCommerce', 'Wix', 'TikTok Shop', 'eBay', 'Amazon', 'Octopus Dropship', 'Wholesale', 'Other'];
export const WH_BANDS: [string, string][] = [['under_100', 'Under 100'], ['100_500', '100–500'], ['500_2000', '500–2,000'], ['over_2000', 'Over 2,000']];
export const WH_ROUTES: [string, string][] = [['octopus_b2b', 'Sourced through Octopus B2B'], ['make_my_brand', 'Made with Make My Brand'], ['own_supplier', 'From my own supplier'], ['mixed', 'A mix of these']];

export type QuoteDefaults = { company: string; contactName: string; email: string; phone: string; country: string };
