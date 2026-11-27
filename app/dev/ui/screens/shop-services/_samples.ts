/**
 * SAMPLE data for the T4 Shop services fixtures (staging only). Every title says "(example)"; numbers are made up for
 * design review and never shown on real pages. Real pages read the database (see each page's loader).
 */
import { toBrandCard, toDropshipCard, toPoolCard, toServiceCard, toTurnkeyCard, warehouseServicesFrom, type BrandCardModel, type DropshipCardModel, type PoolCardModel, type ServiceCardModel, type TurnkeyCardModel } from '@/app/ods/shop/_lib/cards';
import { toPoolRow, type PoolView } from '@/app/ods/shop/pools/_lib/pool-logic';
import type { IncludedRow } from '@/app/ods/shop/turnkey/_lib/turnkey-logic';
import type { TurnkeyProjectViewProps } from '@/app/ods/shop/turnkey/_components/turnkey-project-view';

/** Fixed "now" so the fixtures and screenshots never change: 27 Nov 2026 12:00 UTC. */
export const FIXTURE_NOW = Date.parse('2026-11-27T12:00:00Z');

const TIERS = [
  { min_qty: 1, unit_price_minor: 1390 },
  { min_qty: 500, unit_price_minor: 1250 },
  { min_qty: 1000, unit_price_minor: 1120 },
];

const base: PoolView = {
  id: '00000000-0000-4000-8000-000000000042',
  code: 'POOL-0042',
  status: 'open',
  currency: 'USD',
  title: 'Foldable pet crate (example)',
  productSlug: 'foldable-pet-crate-example',
  unit: 'units',
  image: null,
  targetQty: 1000,
  filledQty: 640,
  minPledge: 50,
  depositPct: 10,
  maxBuyers: 25,
  deadlineAt: '2026-12-02T14:00:00Z',
  createdAt: '2026-11-18T09:00:00Z',
  filledAt: null,
  poolPriceMinor: 1250,
  targetPriceMinor: 1120,
  basePriceMinor: 1390,
  savingPct: 19,
  buyers: 14,
  tiers: TIERS,
  events: [],
};

export const SAMPLE_POOLS = {
  open: base,
  almostFull: { ...base, id: '00000000-0000-4000-8000-000000000043', code: 'POOL-0043', title: 'Insulated water bottle (example)', targetQty: 2000, filledQty: 1820, minPledge: 100, buyers: 21, deadlineAt: '2026-12-05T10:00:00Z', poolPriceMinor: 295, targetPriceMinor: 295, basePriceMinor: 360, savingPct: 18, tiers: [{ min_qty: 1, unit_price_minor: 360 }, { min_qty: 1500, unit_price_minor: 295 }] },
  closingSoon: { ...base, id: '00000000-0000-4000-8000-000000000044', code: 'POOL-0044', title: 'Yoga mat 6 mm (example)', filledQty: 310, buyers: 6, deadlineAt: '2026-11-28T20:00:00Z', poolPriceMinor: 490, targetPriceMinor: 410, basePriceMinor: 490, savingPct: 16, tiers: [{ min_qty: 1, unit_price_minor: 490 }, { min_qty: 1000, unit_price_minor: 410 }] },
  full: { ...base, id: '00000000-0000-4000-8000-000000000045', code: 'POOL-0045', title: 'Ceramic pet bowl (example)', status: 'locked', filledQty: 1000, buyers: 18, filledAt: '2026-11-25T08:30:00Z', poolPriceMinor: 1120 },
  closed: { ...base, id: '00000000-0000-4000-8000-000000000046', code: 'POOL-0046', title: 'Bamboo cutting board (example)', status: 'expired', filledQty: 420, buyers: 7, deadlineAt: '2026-11-20T14:00:00Z' },
} satisfies Record<string, PoolView>;

export const poolCards = (list: PoolView[]): PoolCardModel[] =>
  list.map((v) => toPoolCard(toPoolRow(v), { now: FIXTURE_NOW })).filter((c): c is PoolCardModel => c !== null);

export const SAMPLE_TURNKEY: TurnkeyCardModel[] = [
  toTurnkeyCard({ project_id: 'example-kitchen-storage', title: 'Private-label kitchen storage line (example)', starting_budget_usd: 8500, hero_image_path: null, hero_image_alt: null }),
  toTurnkeyCard({ project_id: 'example-pet-range', title: 'Pet accessories starter range (example)', starting_budget_usd: 6200, hero_image_path: null, hero_image_alt: null }),
  toTurnkeyCard({ project_id: 'example-robotic-cafe', title: 'Robotic coffee kiosk (example)', starting_budget_usd: null, hero_image_path: null, hero_image_alt: null }),
];

export const SAMPLE_PROJECT: TurnkeyProjectViewProps['project'] = {
  id: 'example-kitchen-storage',
  title: 'Private-label kitchen storage line (example)',
  category: 'Home and kitchen',
  summary: 'Design, three factory quotes, samples, quality check, branded packaging and shipping.',
  image: null,
  fromUsd: 8500,
  budgetUnit: null,
  floorAreaM2: null,
};

export const SAMPLE_INCLUDED: IncludedRow[] = [
  { id: 'consultation', item: 'Consultation (example)', detail: 'We agree the plan, budget and timeline with you.', fee: { cents: 9900, approx: false, unit: 'project' } },
  { id: 'design', item: 'Layout and product design (example)', detail: '3 versions free, then half the fee per extra version.', fee: { cents: 25000, approx: true, unit: 'project' } },
  { id: 'sourcing', item: 'Factory quotes (example)', detail: 'Quotes from verified suppliers. You deal only with us.', fee: { cents: 0, approx: false, unit: 'free' } },
  { id: 'qc', item: 'Quality check before shipping (example)', detail: 'Inspection with a photo report.', fee: { cents: 39900, approx: false, unit: 'day' } },
];

const dsRows = [
  { id: 'ds-example-1', title: 'Foldable pet crate (example)', stock_status: 'in_stock', route: { product_cents: 1800, landed_price_cents: 2830 } },
  { id: 'ds-example-2', title: 'Pet water fountain (example)', stock_status: 'in_stock', route: { product_cents: 1240, landed_price_cents: 1970 } },
  { id: 'ds-example-3', title: 'LED desk lamp (example)', stock_status: 'low', route: { product_cents: 780, landed_price_cents: 1420 } },
  { id: 'ds-example-4', title: 'Wireless earbuds (example)', stock_status: 'in_stock', route: { product_cents: 960, landed_price_cents: 1780 } },
];

export const SAMPLE_DROPSHIP_NO_ACCESS: DropshipCardModel[] = dsRows.map((r) => toDropshipCard({ id: r.id, title: r.title, image: null }, { hasAccess: false, requestHref: '/account/dropship' }));
export const SAMPLE_DROPSHIP_ACCESS: DropshipCardModel[] = dsRows.map((r) => toDropshipCard({ ...r, image: null }, { hasAccess: true, requestHref: '/account/dropship', country: 'United Arab Emirates' }));

export const SAMPLE_WAREHOUSE_RATES: ServiceCardModel[] = warehouseServicesFrom({
  receiving_per_carton_cents: 150,
  storage_per_pallet_month_cents: 1800,
  pick_pack_first_cents: 120,
  pick_pack_extra_cents: 40,
  returns_per_item_cents: 90,
}).map(toServiceCard);
export const SAMPLE_WAREHOUSE_NO_RATES: ServiceCardModel[] = warehouseServicesFrom(null).map(toServiceCard);

export const SAMPLE_WAREHOUSES = [{ code: 'SZX-EX', name: 'Shenzhen warehouse (example)', city: 'Shenzhen' }];
export const SAMPLE_DEFAULTS = { company: 'Example Trading LLC', contactName: 'Anna Example', email: 'anna@example.com', phone: '', country: 'AE' };

export const SAMPLE_BRAND: BrandCardModel[] = [
  toBrandCard({ key: 'pad', name: 'Pad or silk print', body: 'Your logo printed in one or more colours on the product surface.', moq: 500, days: '5–7 days' }),
  toBrandCard({ key: 'laser', name: 'Laser engraving', body: 'A permanent mark cut into metal, wood or hard plastic.', moq: 300, days: '3–5 days' }),
  toBrandCard({ key: 'box', name: 'Branded colour box', body: 'Retail packaging printed with your brand, artwork and product details.', moq: null, days: null }),
];
