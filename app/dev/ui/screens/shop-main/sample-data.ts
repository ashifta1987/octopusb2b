/**
 * SAMPLE DATA for the staging fixture /dev/ui/screens/shop-main only (labelled "Sample data" on the page). Built with the
 * real mappers from app/ods/shop/_lib/cards.ts so the fixture shows exactly what the live page would render.
 */
import {
  toBrandCard, toDropshipCard, toPoolCard, toServiceCard, toSourcingCard, toTurnkeyCard, warehouseServicesFrom,
  type ShopCardModel, type SourcingCardModel,
} from '@/app/ods/shop/_lib/cards';
import type { ShopSectionKey } from '@/app/ods/shop/_lib/sections';
import type { WaitingItem } from '@/lib/core/waiting-items';

export const NOW = Date.parse('2026-11-27T12:00:00Z');
const day = 864e5;
const iso = (ms: number) => new Date(ms).toISOString();

export const SAMPLE_CATEGORIES = [
  { slug: 'home-kitchen', name: 'Home and kitchen', children: [{ slug: 'bakeware', name: 'Bakeware' }, { slug: 'storage', name: 'Storage' }, { slug: 'tableware', name: 'Tableware' }] },
  { slug: 'electronics', name: 'Electronics', children: [{ slug: 'lighting', name: 'Lighting' }, { slug: 'phone-accessories', name: 'Phone accessories' }] },
  { slug: 'pets', name: 'Pets', children: [{ slug: 'beds-crates', name: 'Beds and crates' }, { slug: 'feeding', name: 'Feeding' }] },
  { slug: 'beauty', name: 'Beauty', children: [] },
  { slug: 'outdoor', name: 'Outdoor', children: [] },
  { slug: 'office', name: 'Office', children: [] },
  { slug: 'toys', name: 'Toys', children: [] },
  { slug: 'packaging', name: 'Packaging', children: [] },
];

type Tagged<T> = T & { cat: string };

const sourcingRows: Tagged<Parameters<typeof toSourcingCard>[0]>[] = [
  { cat: 'home-kitchen', id: 's1', slug: 'silicone-baking-mat-set', title: 'Silicone baking mat set', unit: 'sets', moq: 500, min_price_cents: 145, image_url: null, factory: { verified: true }, tags: [{ slug: 'samples' }], lead_time_days: 20 },
  { cat: 'electronics', id: 's2', slug: 'led-desk-lamp', title: 'LED desk lamp', unit: 'units', moq: 200, min_price_cents: 620, image_url: null, factory: { verified: true }, tags: [{ slug: 'customisable' }], lead_time_days: 20 },
  { cat: 'home-kitchen', id: 's3', slug: 'bamboo-storage-box', title: 'Bamboo storage box', unit: 'units', moq: 500, min_price_cents: 260, image_url: null, factory: { verified: true }, lead_time_days: 30 },
  { cat: 'home-kitchen', id: 's4', slug: 'glass-food-containers', title: 'Glass food containers', unit: 'sets', moq: 300, min_price_cents: null, image_url: null, factory: { verified: true }, lead_time_days: null, created_at: iso(NOW - 3 * day) },
  { cat: 'pets', id: 's5', slug: 'foldable-pet-crate', title: 'Foldable pet crate', unit: 'units', moq: 500, min_price_cents: 1180, image_url: null, factory: { verified: true }, lead_time_days: 25 },
];

const poolRows: Tagged<Parameters<typeof toPoolCard>[0]>[] = [
  { cat: 'pets', id: 'p1', code: 'POOL-101', status: 'open', product: { slug: 'foldable-pet-crate', title: 'Foldable pet crate', unit: 'units', image_url: null }, target_qty: 1000, filled_qty: 640, min_pledge: 50, deadline_at: iso(NOW + 5 * day), pool_price_minor: 1120, base_price_minor: 1390 },
  { cat: 'outdoor', id: 'p2', code: 'POOL-102', status: 'open', product: { slug: 'insulated-water-bottle', title: 'Insulated water bottle', unit: 'units', image_url: null }, target_qty: 2000, filled_qty: 1820, min_pledge: 100, deadline_at: iso(NOW + 2 * day), pool_price_minor: 295, base_price_minor: 360 },
  { cat: 'outdoor', id: 'p3', code: 'POOL-103', status: 'open', product: { slug: 'yoga-mat-6mm', title: 'Yoga mat 6 mm', unit: 'units', image_url: null }, target_qty: 1000, filled_qty: 310, min_pledge: 50, deadline_at: iso(NOW + 12 * day), pool_price_minor: 410, base_price_minor: 490 },
  { cat: 'home-kitchen', id: 'p4', code: 'POOL-104', status: 'open', product: { slug: 'ceramic-mug-set', title: 'Ceramic mug set', unit: 'units', image_url: null }, target_qty: 3000, filled_qty: 2100, min_pledge: 100, deadline_at: iso(NOW + 8 * day), pool_price_minor: 180, base_price_minor: 210 },
];

const dropRows: Tagged<{ id: string; title: string; landed: number; price: number }>[] = [
  { cat: 'pets', id: 'd1', title: 'Pet water fountain', price: 780, landed: 995 },
  { cat: 'pets', id: 'd2', title: 'Magnetic phone holder', price: 240, landed: 385 },
  { cat: 'electronics', id: 'd3', title: 'LED desk lamp', price: 810, landed: 1040 },
  { cat: 'outdoor', id: 'd4', title: 'Yoga mat', price: 520, landed: 765 },
];

const turnkeyRows: Parameters<typeof toTurnkeyCard>[0][] = [
  { project_id: 'TK-KITCHEN', title: 'Private-label kitchen storage line', starting_budget_usd: 8500, hero_image_path: null, hero_image_alt: null },
  { project_id: 'TK-PETS', title: 'Pet accessories starter range', starting_budget_usd: 6200, hero_image_path: null, hero_image_alt: null },
  { project_id: 'TK-BATH', title: 'Bathroom set under your brand', starting_budget_usd: null, hero_image_path: null, hero_image_alt: null },
  { project_id: 'TK-FIT', title: 'Fitness accessories line', starting_budget_usd: 9800, hero_image_path: null, hero_image_alt: null },
];

const brandRows: Parameters<typeof toBrandCard>[0][] = [
  { key: 'box', name: 'Branded colour box', body: 'Retail packaging printed with your brand.', moq: 1000, days: '3 days' },
  { key: 'pad', name: 'Pad or silk print', body: 'Your logo printed on the product surface.', moq: 1000, days: null },
  { key: 'inserts', name: 'Inserts and manuals', body: 'Thank-you cards, warranty cards and manuals in your name.', moq: null, days: '2 days' },
  { key: 'laser', name: 'Laser engraving', body: 'A permanent mark in metal, wood or hard plastic.', moq: null, days: null },
];

export function sampleSection(service: ShopSectionKey, category: string | null, dropshipAccess: boolean): { items: ShopCardModel[]; total: number } {
  const inCat = <T extends { cat: string }>(rows: T[]) => (category ? rows.filter((r) => r.cat === category) : rows);
  switch (service) {
    case 'sourcing': {
      const rows = inCat(sourcingRows);
      return { items: rows.slice(0, 4).map((r) => toSourcingCard(r, { now: NOW })), total: rows.length ? rows.length * 196 : 0 };
    }
    case 'pools': {
      const rows = inCat(poolRows);
      return { items: rows.map((r) => toPoolCard(r, { now: NOW })).filter((c): c is NonNullable<typeof c> => !!c), total: rows.length * 3 };
    }
    case 'dropship': {
      const rows = inCat(dropRows);
      const access = { hasAccess: dropshipAccess, requestHref: '/account/dropship', country: 'United Arab Emirates' };
      return {
        items: rows.map((r) => toDropshipCard({ id: r.id, title: r.title, image: null, stock_status: 'in_stock', route: { product_cents: r.price, landed_price_cents: r.landed } }, access)),
        total: rows.length * 53,
      };
    }
    case '3pl': {
      const rows = warehouseServicesFrom({ receiving_per_carton_cents: 150, storage_per_pallet_month_cents: 1800, pick_pack_first_cents: 120, pick_pack_extra_cents: null, returns_per_item_cents: null });
      return { items: rows.map(toServiceCard), total: rows.length };
    }
    case 'turnkey':
      return { items: turnkeyRows.map((r) => toTurnkeyCard(r)), total: 18 };
    case 'brand':
      return { items: brandRows.map(toBrandCard), total: 5 };
  }
}

export const SAMPLE_RECENT: SourcingCardModel[] = sourcingRows.slice(1, 5).map((r) => toSourcingCard(r, { now: NOW }));

export const SAMPLE_TILES: WaitingItem[] = [
  { key: 'q-1', kind: 'quote', title: '1 quote to review', body: 'Foldable pet crate · RFQ-1042 · valid until 29 Nov', href: '/account/sourcing/RFQ-1042', at: iso(NOW + 2 * day) },
  { key: 'o-1', kind: 'payment', title: 'Deposit due · OCT-SRC-2026-0118', body: 'Bamboo storage box · It moves on as soon as it is paid.', href: '/account/orders/sample', at: iso(NOW + 3 * day) },
  { key: 'kyc', kind: 'verification', title: 'Company verification needs more information', body: 'Please upload a clearer copy of the trade licence.', href: '/account/kyc', at: iso(NOW + 4 * day) },
];

export const SAMPLE_SUGGEST_SOURCES = {
  products: sourcingRows.map((r) => ({ slug: r.slug, title: r.title })),
  pools: poolRows.map((p) => ({ code: p.code, product: { title: p.product.title } })),
  projects: turnkeyRows.map((p) => ({ project_id: p.project_id, title: p.title })),
  categories: SAMPLE_CATEGORIES.flatMap((c) => [{ slug: c.slug, name: c.name }, ...c.children]),
};
