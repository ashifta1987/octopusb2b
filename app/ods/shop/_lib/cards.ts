/**
 * ODS T4 · Shop card mappers (pure; server, client and unit tests). Database rows → serialisable card MODELS that
 * `<ShopCard model>` (app/ods/shop/_components/shop-card.tsx) renders with the @octopus/ui cards.
 *
 * WHITE-LABEL (Part 1 rule 7): a mapper copies ONLY customer-safe fields into the model, by name — never a spread of the
 * row. No supplier / factory name, code or id, no province/city (only "Verified supplier" from `factory.verified`), no
 * Sourcing model number (dropship `model_no` is dropped), no cost or margin. tests/unit/ods-shop-cards.test.ts checks
 * that nothing else leaks. Money in the models is in US$ (major units, e.g. 12.5 = US$ 12.50).
 *
 * API (stable):
 *  - `toSourcingCard(row: SourcingRow, opts?: { now?: number })`                 → SourcingCardModel  (kind 'sourcing')
 *  - `toPoolCard(row: PoolRow, opts: { now: number })`                            → PoolCardModel | null (null = no pool price yet; leave it out)
 *  - `toDropshipCard(row: DropshipRow, access: DropshipAccess)`                   → DropshipCardModel  (no price fields at all without access)
 *  - `toTurnkeyCard(row: TurnkeyRow, opts?: { supabaseUrl?: string })`            → TurnkeyCardModel
 *  - `toBrandCard(row: BrandRow)`                                                 → BrandCardModel
 *  - `toServiceCard(row: WarehouseServiceRow)`                                    → ServiceCardModel   (kind '3pl')
 *  - `poolStatus(row, now)`  Appendix C name: 'Open' | 'Closing soon' | 'Almost full' | 'Filled'
 *  - `closesIn(deadlineIso, now)`  "5 days" | "18 hours" | "less than an hour" | "closed"
 *  - `cardImage(url, alt)`   { src, alt, unoptimized } or undefined (no photo → neutral placeholder)
 *  - `productHref(slug)`, `poolHref(code)`, `turnkeyHref(id)` public Shop URLs
 *  - type `ShopCardModel` = union of the six models (discriminated by `kind`)
 */
import { isOptimizableImage } from '@octopus/ui/image-url';

/* ───────── models ───────── */

export type CardImageModel = { src: string; alt: string; unoptimized: boolean };
export type CardBadgeModel = { label: string; tone: 'success' | 'info' | 'neutral' };

type Base = { id: string; title: string; href: string; image?: CardImageModel; badges: CardBadgeModel[] };

export type SourcingCardModel = Base & {
  kind: 'sourcing';
  /** products.id — for Add to cart (= addToQuoteList until T5). */
  productId: string;
  fromPrice: number | null;
  unit: string;
  unitPlural: string;
  moq: number;
  delivery: string;
  quoteHref: string;
};
export type PoolCardModel = Base & {
  kind: 'pools';
  code: string;
  poolPrice: number;
  normalPrice: number | null;
  unit: string;
  unitPlural: string;
  filled: number;
  target: number;
  closesIn: string;
  joinFrom: number;
  status: 'Open' | 'Closing soon' | 'Almost full' | 'Filled';
  /** Set when the pool can't be joined (shown next to the disabled button). */
  joinBlockedReason?: string;
  joinHref: string;
};
export type DropshipCardModel = Base & {
  kind: 'dropship';
  productId: string;
  hasAccess: boolean;
  /** Only with access. */
  yourPrice?: number;
  landedCost?: number;
  landedIn?: string;
  importHref?: string;
  accessHref: string;
};
export type ServiceCardModel = Base & {
  kind: '3pl';
  description: string;
  rates: { label: string; amount: number; per: string }[];
  quoteHref: string;
};
export type TurnkeyCardModel = Base & {
  kind: 'turnkey';
  fromPrice: number | null;
  timeline: string;
  includes: string[];
  viewHref: string;
};
export type BrandCardModel = Base & {
  kind: 'brand';
  description: string;
  fromPrice: number | null;
  unit: string;
  moq: number | null;
  proofTime: string;
  brandHref: string;
};

export type ShopCardModel = SourcingCardModel | PoolCardModel | DropshipCardModel | ServiceCardModel | TurnkeyCardModel | BrandCardModel;

/* ───────── input rows (structural: the store/turnkey/dropship types satisfy them) ───────── */

export type SourcingRow = {
  id: string;
  slug: string;
  title: string;
  unit: string;
  moq: number;
  min_price_cents: number | null;
  image_url: string | null;
  tiers?: { min_qty: number; unit_price_cents: number }[] | null;
  tags?: { slug: string; name?: string; kind?: string }[] | null;
  factory?: { verified: boolean } | null;
  ready_to_ship?: boolean | null;
  lead_time_days?: number | null;
  created_at?: string | null;
};

export type PoolRow = {
  id: string;
  code: string;
  status: string;
  product: { slug: string; title: string; unit: string; image_url: string | null };
  target_qty: number;
  filled_qty: number;
  min_pledge: number;
  max_buyers?: number | null;
  buyers?: number | null;
  deadline_at: string;
  pool_price_minor: number | null;
  base_price_minor: number | null;
};

export type DropshipRow = {
  /** CatalogueRow.product_id or products.id */
  id: string;
  title: string;
  image: string | null;
  /** With access only: the best route (pickRoute) for the company's country. */
  route?: { product_cents: number | null; landed_price_cents: number } | null;
  stock_status?: string | null;
};
export type DropshipAccess = {
  hasAccess: boolean;
  /** Where Request access goes (/account/dropship when Dropship v2 is on, else /request/dropship). */
  requestHref: string;
  /** Country name for "Landed in …" (with access). */
  country?: string;
};

export type TurnkeyRow = {
  project_id: string;
  title: string;
  short_reason?: string | null;
  starting_budget_usd: number | string | null;
  hero_image_path: string | null;
  hero_image_alt: string | null;
};

export type BrandRow = { key: string; name: string; body: string; moq: number | null; days: string | null };

export type WarehouseServiceRow = { key: string; title: string; description: string; rates: { label: string; cents: number | null; per: string }[] };

/* ───────── helpers ───────── */

export const productHref = (slug: string) => `/shop/products/${encodeURIComponent(slug)}`;
export const poolHref = (code: string) => `/shop/pools/${encodeURIComponent(code)}`;
export const turnkeyHref = (id: string) => `/shop/turnkey/${encodeURIComponent(id)}`;

export function cardImage(url: string | null | undefined, alt: string): CardImageModel | undefined {
  if (!url) return undefined;
  return { src: url, alt, unoptimized: !isOptimizableImage(url) };
}

const cents = (n: number | string | null | undefined) => (n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n) / 100);

/** "pcs" → "pc", "sets" → "set", "m" → "m" (same rule as the store cards). */
export function unitOne(unit: string): string {
  if (unit === 'pcs') return 'pc';
  return unit.length > 2 && unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

export function closesIn(deadlineIso: string, now: number): string {
  const ms = Date.parse(deadlineIso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'closed';
  const h = Math.floor(ms / 3600e3);
  if (h < 1) return 'less than an hour';
  if (h < 48) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const d = Math.floor(h / 24);
  return `${d} days`;
}

export const FILLED_POOL_STATUSES = ['filled', 'locked', 'confirmed', 'shipped', 'completed'];

export function poolStatus(row: Pick<PoolRow, 'filled_qty' | 'target_qty' | 'deadline_at' | 'status'>, now: number): PoolCardModel['status'] {
  // pool_status values after the target is reached: locked → confirmed → shipped → completed (coordinator fix, T4)
  if (FILLED_POOL_STATUSES.includes(String(row.status)) || (row.target_qty > 0 && row.filled_qty >= row.target_qty)) return 'Filled';
  if (Date.parse(row.deadline_at) - now <= 72 * 3600e3) return 'Closing soon';
  if (row.target_qty > 0 && row.filled_qty / row.target_qty >= 0.75) return 'Almost full';
  return 'Open';
}

/* ───────── mappers ───────── */

export function toSourcingCard(row: SourcingRow, opts: { now?: number } = {}): SourcingCardModel {
  const tierMin = (row.tiers ?? []).reduce<number | null>((m, t) => (m == null || t.unit_price_cents < m ? t.unit_price_cents : m), null);
  const fromCents = row.min_price_cents ?? tierMin;
  const tags = new Set((row.tags ?? []).map((t) => t.slug));
  const badges: CardBadgeModel[] = [];
  if (opts.now && row.created_at && opts.now - Date.parse(row.created_at) < 14 * 864e5) badges.push({ label: 'New', tone: 'info' });
  if (row.factory?.verified) badges.push({ label: 'Verified supplier', tone: 'success' });
  if (row.ready_to_ship) badges.push({ label: 'Ready to ship', tone: 'neutral' });
  if (tags.has('customisable')) badges.push({ label: 'Customisable', tone: 'neutral' });
  if (tags.has('samples') || tags.has('samples-available')) badges.push({ label: 'Samples', tone: 'neutral' });
  const href = productHref(row.slug);
  const days = row.lead_time_days;
  return {
    kind: 'sourcing',
    id: row.id,
    productId: row.id,
    title: row.title,
    href,
    image: cardImage(row.image_url, row.title),
    badges: badges.slice(0, 3),
    fromPrice: cents(fromCents),
    unit: unitOne(row.unit),
    unitPlural: row.unit,
    moq: Number(row.moq) || 1,
    delivery: days != null && days > 0 ? `${days} days` : 'On request',
    quoteHref: `${href}#request`,
  };
}

export function toPoolCard(row: PoolRow, opts: { now: number }): PoolCardModel | null {
  const poolPrice = cents(row.pool_price_minor);
  if (poolPrice == null) return null;
  const status = poolStatus(row, opts.now);
  const full = status === 'Filled' || (row.max_buyers != null && row.buyers != null && row.max_buyers > 0 && row.buyers >= row.max_buyers);
  // a filled pool no longer counts down (coordinator fix, T4)
  const left = status === 'Filled' ? 'closed' : closesIn(row.deadline_at, opts.now);
  return {
    kind: 'pools',
    id: row.id,
    code: row.code,
    title: row.product.title,
    href: poolHref(row.code),
    image: cardImage(row.product.image_url, row.product.title),
    badges: [],
    poolPrice,
    normalPrice: cents(row.base_price_minor),
    unit: unitOne(row.product.unit),
    unitPlural: row.product.unit,
    filled: Number(row.filled_qty) || 0,
    target: Number(row.target_qty) || 0,
    closesIn: left,
    joinFrom: Number(row.min_pledge) || 1,
    status,
    joinBlockedReason: full ? 'This pool is full.' : left === 'closed' ? 'This pool has closed.' : undefined,
    joinHref: poolHref(row.code),
  };
}

export function toDropshipCard(row: DropshipRow, access: DropshipAccess): DropshipCardModel {
  const badges: CardBadgeModel[] = [];
  if (row.stock_status === 'in_stock') badges.push({ label: 'In stock', tone: 'success' });
  if (row.stock_status === 'low') badges.push({ label: 'Low stock', tone: 'neutral' });
  const base: DropshipCardModel = {
    kind: 'dropship',
    id: row.id,
    productId: row.id,
    title: row.title,
    href: access.hasAccess ? `/account/dropship/catalogue/${encodeURIComponent(row.id)}` : '/shop/dropship',
    image: cardImage(row.image, row.title),
    badges: access.hasAccess ? badges : [],
    hasAccess: access.hasAccess,
    accessHref: access.requestHref,
  };
  if (!access.hasAccess) return base; // Part 5.2: no prices, no landed cost without approved access
  const your = cents(row.route?.product_cents ?? null);
  const landed = cents(row.route?.landed_price_cents ?? null);
  return {
    ...base,
    ...(your != null ? { yourPrice: your } : {}),
    ...(landed != null ? { landedCost: landed } : {}),
    ...(landed != null && access.country ? { landedIn: access.country } : {}),
    importHref: `/account/dropship/catalogue/${encodeURIComponent(row.id)}`,
  };
}

export function toTurnkeyCard(row: TurnkeyRow, opts: { supabaseUrl?: string } = {}): TurnkeyCardModel {
  const budget = row.starting_budget_usd == null ? null : Number(row.starting_budget_usd);
  const path = row.hero_image_path;
  const src = !path ? null : /^https:\/\//.test(path) || path.startsWith('/') ? path : opts.supabaseUrl ? `${opts.supabaseUrl}/storage/v1/object/public/site-media/${path.replace(/^\/+/, '')}` : null;
  return {
    kind: 'turnkey',
    id: row.project_id,
    title: row.title,
    href: turnkeyHref(row.project_id),
    image: cardImage(src, row.hero_image_alt ?? row.title),
    badges: [],
    fromPrice: budget != null && Number.isFinite(budget) && budget > 0 ? budget : null,
    timeline: 'In your quote',
    includes: [],
    viewHref: turnkeyHref(row.project_id),
  };
}

export function toBrandCard(row: BrandRow): BrandCardModel {
  return {
    kind: 'brand',
    id: row.key,
    title: row.name,
    description: row.body,
    href: '/shop/brand',
    badges: [],
    fromPrice: null, // priced per product in the quote (no per-method price in settings)
    unit: 'unit',
    moq: row.moq,
    proofTime: row.days ?? 'In your quote',
    brandHref: `/request/brand?method=${encodeURIComponent(row.key)}`,
  };
}

export function toServiceCard(row: WarehouseServiceRow): ServiceCardModel {
  return {
    kind: '3pl',
    id: row.key,
    title: row.title,
    description: row.description,
    href: '/shop/warehouse',
    badges: [],
    rates: row.rates.flatMap((r) => (r.cents == null ? [] : [{ label: r.label, amount: r.cents / 100, per: r.per }])),
    quoteHref: `/3pl/apply?service=${encodeURIComponent(row.key)}`,
  };
}

/** The live standard 3PL rate plan (wh_rate_versions, same columns as /3pl). Any fee may be null = "Rates not set yet". */
export type WarehouseRatePlan = {
  receiving_per_carton_cents: number | null;
  storage_per_pallet_month_cents: number | null;
  pick_pack_first_cents: number | null;
  pick_pack_extra_cents: number | null;
  returns_per_item_cents: number | null;
} | null;

/** The four Warehouse (3PL) services shown as ServiceCards, with the plan's rates (missing rate = left out of the card). */
export function warehouseServicesFrom(plan: WarehouseRatePlan): WarehouseServiceRow[] {
  const n = (v: number | null | undefined) => (v == null ? null : Number(v));
  return [
    { key: 'storage', title: 'Storage in our China warehouse', description: 'Pallet storage, billed by the month.', rates: [{ label: 'Pallet', cents: n(plan?.storage_per_pallet_month_cents), per: '/ month' }] },
    { key: 'receiving', title: 'Receiving and quality check', description: 'We count and check every carton when it arrives.', rates: [{ label: 'Per carton', cents: n(plan?.receiving_per_carton_cents), per: '' }] },
    {
      key: 'fulfilment',
      title: 'Pick, pack and ship',
      description: 'Each order picked, packed and sent with the shipping speed you choose.',
      rates: [
        { label: 'First item', cents: n(plan?.pick_pack_first_cents), per: '/ order' },
        { label: 'Each extra item', cents: n(plan?.pick_pack_extra_cents), per: '' },
      ],
    },
    { key: 'returns', title: 'Returns handling', description: 'Returned items are checked and put back in stock.', rates: [{ label: 'Per item', cents: n(plan?.returns_per_item_cents), per: '' }] },
  ];
}
