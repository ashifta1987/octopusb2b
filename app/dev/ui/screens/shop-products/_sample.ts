/**
 * SAMPLE data for the T4 catalogue fixtures only (staging). Not real products, prices or suppliers. No photos (the cards
 * show the neutral placeholder — no stock images). Rows go through the real white-label mappers.
 */
import { toSourcingCard, toPoolCard, toTurnkeyCard, toBrandCard, toServiceCard, toDropshipCard, warehouseServicesFrom, type SourcingCardModel } from '@/app/ods/shop/_lib/cards';
import type { CategoryOption, ProductPageVM, ShopActor } from '@/app/ods/shop/products/_lib/types';

export const NOW = Date.parse('2026-11-27T10:00:00Z');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tags = (...s: string[]) => s.map((slug) => ({ slug }));
const tiers = (...t: [number, number][]) => t.map(([min_qty, unit_price_cents]) => ({ min_qty, unit_price_cents }));

const ROWS = [
  { title: 'Example silicone baking mat set', unit: 'sets', moq: 500, t: tiers([500, 185], [1000, 162], [5000, 145]), tags: tags('customisable', 'samples'), lead: 15 },
  { title: 'Example stainless lunch box', unit: 'pcs', moq: 300, t: tiers([300, 340], [1000, 310]), tags: tags('samples'), lead: 20 },
  { title: 'Example bamboo storage box', unit: 'pcs', moq: 500, t: tiers([500, 260]), tags: tags(), lead: 25 },
  { title: 'Example glass food containers', unit: 'sets', moq: 300, t: tiers([300, 420], [2000, 390]), tags: tags('customisable'), lead: 20 },
  { title: 'Example spice rack organiser', unit: 'pcs', moq: 500, t: tiers([500, 295]), tags: tags(), lead: 15 },
  { title: 'Example collapsible colander', unit: 'pcs', moq: 1000, t: [], tags: tags('samples'), lead: null },
];

export const SAMPLE_CARDS: SourcingCardModel[] = ROWS.map((r, i) =>
  toSourcingCard(
    { id: id(i + 1), slug: `example-${i + 1}`, title: r.title, unit: r.unit, moq: r.moq, min_price_cents: null, image_url: null, tiers: r.t, tags: r.tags, factory: { verified: i !== 2 }, lead_time_days: r.lead },
    { now: NOW },
  ),
);

export const SAMPLE_CATEGORIES: CategoryOption[] = [
  { slug: 'home-and-kitchen', name: 'Home and kitchen', level: 1, count: 142 },
  { slug: 'bakeware', name: 'Bakeware', level: 2, count: 31 },
  { slug: 'storage', name: 'Storage', level: 2, count: 44 },
  { slug: 'electronics', name: 'Electronics', level: 1, count: 96 },
  { slug: 'beauty', name: 'Beauty', level: 1, count: 51 },
  { slug: 'pets', name: 'Pets', level: 1, count: 38 },
  { slug: 'outdoor', name: 'Outdoor', level: 1, count: 27 },
];
export const SAMPLE_CHIPS = SAMPLE_CATEGORIES.filter((c) => c.level === 1);

export const BUYER: ShopActor = { canAct: true, reason: null, country: 'AE', cartCount: 8 };
export const VIEWER: ShopActor = { canAct: false, reason: 'Your role can browse but not send requests. Ask your company owner to make you a buyer.', country: 'AE', cartCount: 0 };

export const SAMPLE_PRODUCT: ProductPageVM = {
  id: id(1),
  slug: 'example-1',
  title: 'Example silicone baking mat set',
  summary: 'Set of 3 non-stick mats (half, quarter, round). Food-grade silicone with fibreglass mesh, oven-safe to 230 °C.',
  description:
    'Set of 3 non-stick mats (half, quarter, round). Food-grade silicone with fibreglass mesh, oven-safe to 230 °C.\n\nReusable, dishwasher-safe and cut to standard tray sizes. Example text for the staging fixture.',
  images: [],
  verified: true,
  customisable: true,
  samplesAvailable: true,
  unit: 'set',
  unitPlural: 'sets',
  moq: 500,
  leadDays: 15,
  tiers: [
    { minQty: 500, unitCents: 185 },
    { minQty: 1000, unitCents: 162 },
    { minQty: 5000, unitCents: 145 },
  ],
  currency: 'US$',
  sampleCents: 1800,
  shipsFrom: 'China',
  shippingEstimate: null,
  shippingNotes: ['Quotes include Incoterm, port and lead time.'],
  incoterm: 'FOB',
  hsCode: '3924.10',
  hsIndicative: true,
  packing: '100 sets per carton',
  specs: [
    { name: 'Material', value: 'Food-grade silicone, fibreglass mesh' },
    { name: 'Sizes', value: '42×29.5 cm, 30×21 cm, Ø 28 cm' },
    { name: 'Thickness', value: '0.75 mm' },
    { name: 'Temperature', value: '−40 °C to 230 °C' },
    { name: 'Certifications', value: 'LFGB, FDA (documents on request)' },
    { name: 'Packing', value: 'Polybag + card; 100 sets per carton' },
  ],
  breadcrumbs: [
    { label: 'Shop', href: '/shop' },
    { label: 'Products', href: '/shop/products' },
    { label: 'Home and kitchen', href: '/shop/products?category=home-and-kitchen' },
    { label: 'Bakeware', href: '/shop/products?category=bakeware' },
    { label: 'Example silicone baking mat set' },
  ],
  categoryId: id(900),
  pool: { code: 'POOL-EXAMPLE' },
  customise: [
    { value: 'Logo print', label: 'Logo print', minimum: 'Minimum confirmed in your quote', description: 'Your logo printed on the product.' },
    { value: 'Custom colour', label: 'Custom colour', minimum: 'Minimum confirmed in your quote', description: 'A colour matched to your sample or colour code.' },
    { value: 'Branded colour box', label: 'Branded colour box', minimum: 'Minimum confirmed in your quote', description: 'A retail box printed with your artwork.' },
  ],
  questions: [
    { q: 'Can I mix colours in one order?', a: 'Example answer: yes, within the same minimum order; we confirm the split in your quote.' },
    { q: 'How does quality control work?', a: 'Example answer: we check every order before it ships and send you the report.' },
    { q: 'Can you ship to my warehouse?', a: 'Example answer: yes, tell us the address in your quote request.' },
  ],
};

/* search groups */
const poolRow = { id: id(50), code: 'POOL-EXAMPLE', status: 'open', product: { slug: 'example-1', title: 'Example silicone baking mat set', unit: 'sets', image_url: null }, target_qty: 1000, filled_qty: 640, min_pledge: 50, deadline_at: '2026-12-02T10:00:00Z', pool_price_minor: 162, base_price_minor: 185 };
export const SAMPLE_POOL = toPoolCard(poolRow, { now: NOW });
export const SAMPLE_DROPSHIP = toDropshipCard({ id: id(60), title: 'Example silicone spatula set', image: null }, { hasAccess: false, requestHref: '/account/dropship' });
export const SAMPLE_SERVICES = warehouseServicesFrom(null).map(toServiceCard);
export const SAMPLE_TURNKEY = toTurnkeyCard({ project_id: 'EXAMPLE-TK-1', title: 'Example kitchenware private label line', starting_budget_usd: null, hero_image_path: null, hero_image_alt: null });
export const SAMPLE_BRAND = toBrandCard({ key: 'logo', name: 'Logo on the product', body: 'Your logo printed, engraved or embossed on the product.', moq: null, days: null });
