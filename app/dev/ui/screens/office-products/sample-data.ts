/** Staging fixtures (T9 batch 5 · Catalogue): SAMPLE data only, for design review. Never used by the live pages. */
import type { ProductDetail, QueueRow } from '@/app/ods/office/products/_components/moderation-screen';
import type { SupplierRow, Variant, DelPreview } from '@/app/ods/admin/suppliers/_components/suppliers-screen';
import type { RunRow, SupplierOpt } from '@/app/ods/admin/import/_components/import-list';
import type { ImportRunData } from '@/app/ods/admin/import/_components/import-run';
import type { ReviewItem, ReviewProduct } from '@/app/ods/admin/import/_components/import-review';
import type { HsProposal, HsType } from '@/app/ods/admin/hs-codes/_components/hs-codes-screen';
import type { CatRow, TagRow } from '@/app/ods/admin/_catalogue/core';

const id = (n: number) => `c4c4c4c4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IMG = '/brand/apple-touch-icon-180.png';

export const QUEUE: QueueRow[] = [
  { id: id(1), title: 'Bamboo kitchen towels, custom print, 30 × 30 cm', status: 'submitted', updated_at: '2026-11-25T08:00:00Z', image_url: IMG, moderation_hold: false, supplier_code: 'SUP-0142', supplier_country: 'CN' },
  { id: id(2), title: 'Stainless steel lunch box, 3 compartments', status: 'in_review', updated_at: '2026-11-25T11:20:00Z', image_url: null, moderation_hold: false, supplier_code: 'SUP-0098', supplier_country: 'CN' },
  { id: id(3), title: 'Private-label shampoo 300 ml', status: 'submitted', updated_at: '2026-11-26T07:30:00Z', image_url: null, moderation_hold: true, supplier_code: 'SUP-0211', supplier_country: 'CN' },
  { id: id(4), title: 'LED desk lamp, USB-C, dimmable', status: 'in_review', updated_at: '2026-11-26T15:10:00Z', image_url: IMG, moderation_hold: false, supplier_code: 'SUP-0077', supplier_country: 'VN' },
];
export function productDetail(n: 1 | 3): ProductDetail {
  const held = n === 3;
  return {
    id: id(n), external_id: held ? 'CN-GD-NRB-SH300' : 'CN-ZJ-NGL-BT30', title: QUEUE[n - 1].title, description: held ? 'Sulphate-free shampoo.' : 'Soft, absorbent bamboo-fibre kitchen towels printed with your design. Machine washable at 40 °C; sold in packs of 3 with a printed paper band.',
    status: QUEUE[n - 1].status, moderation_hold: held, moderation_hold_reason: held ? 'Cosmetics need the owner’s confirmation of the CPNP file' : null,
    hs_code: held ? null : '6302.60', hs_code_status: held ? 'missing' : 'suggested', hs_code_source: held ? null : 'rule', hs_code_note: null, unit: 'pcs', moq: held ? 3000 : 1000, lead_time_days: 25, incoterm: 'FOB',
    origin: 'CN', weight_box: '120 g · 32 × 22 × 4 cm', shippingFlags: held ? 'Liquid' : 'None', flags: 'Ready to ship', seo_title: null, seo_description: null, image_url: held ? null : IMG, updated_at: QUEUE[n - 1].updated_at,
    supplier: { code: QUEUE[n - 1].supplier_code!, legal_name: held ? 'Guangzhou Nuorui Biotech Co., Ltd.' : 'Ningbo Greenleaf Textiles Co., Ltd.', country: 'CN', verified: !held }, category: held ? null : 'Home & kitchen › Textiles',
    tiers: held ? [] : [{ min_qty: 1000, unit_price_cents: 210, currency: 'USD' }, { min_qty: 5000, unit_price_cents: 185, currency: 'USD' }, { min_qty: 10000, unit_price_cents: 168, currency: 'USD' }],
    lowestPlatform: null, specs: held ? [] : [{ name: 'Material', value: '70% bamboo, 30% cotton' }, { name: 'Size', value: '30 × 30 cm' }], media: held ? [] : [IMG], tags: held ? [] : ['Eco', 'Custom print'], certificates: held ? [] : ['OEKO-TEX · valid'],
    blocker: held ? 'The supplier’s legal name is not resolved yet' : null, listingsOff: false,
  };
}

export const SUPPLIERS: SupplierRow[] = [
  { id: id(11), code: 'SUP-0142', legal_name: 'Ningbo Greenleaf Textiles Co., Ltd.', country: 'CN', city: 'Ningbo', supplier_type: 'Manufacturer', main_categories: 'Home textiles', contact_name: 'Lily Chen', contact_email: 'lily@greenleaf.example', contact_phone: '+86 574 0000 0000', verified: true, archived_at: null, created_at: '2025-06-01T00:00:00Z', identity_status: 'ok', switches: { portal_login: true, product_upload: true, rfq_replies: true, listings_live: true, ai_tools: false }, counts: { live: 42, total: 51, review: 3 } },
  { id: id(12), code: 'SUP-0211', legal_name: 'Guangzhou Nuorui Biotech Co., Ltd.', country: 'CN', city: 'Guangzhou', supplier_type: 'Manufacturer', main_categories: 'Cosmetics', contact_name: 'Kevin Wu', contact_email: null, contact_phone: null, verified: false, archived_at: null, created_at: '2026-10-12T00:00:00Z', identity_status: 'needs_identity_review', switches: { listings_live: false }, counts: { live: 0, total: 14, review: 1 } },
  { id: id(13), code: 'SUP-0077', legal_name: 'Hanoi Bright Lighting JSC', country: 'VN', city: 'Hanoi', supplier_type: 'Manufacturer', main_categories: 'Lighting', contact_name: 'Minh Tran', contact_email: 'minh@bright.example', contact_phone: null, verified: true, archived_at: null, created_at: '2025-02-20T00:00:00Z', identity_status: 'ok', switches: {}, counts: { live: 18, total: 20, review: 1 } },
  { id: id(14), code: 'SUP-0009', legal_name: 'Yiwu Old Trading Co.', country: 'CN', city: 'Yiwu', supplier_type: 'Trading company', main_categories: null, contact_name: null, contact_email: null, contact_phone: null, verified: false, archived_at: '2026-08-01T00:00:00Z', created_at: '2024-01-10T00:00:00Z', identity_status: 'ok', switches: {}, counts: { live: 0, total: 0, review: 0 } },
];
export const VARIANTS: Variant[] = [
  { id: id(21), variant_name: 'Guangzhou Nuorui Biotech Co., Ltd.', variant_address: 'Baiyun District, Guangzhou', seen_in: 'supplier_sheet', is_canonical: false },
  { id: id(22), variant_name: 'Nuorui Cosmetics (GZ) Ltd.', variant_address: null, seen_in: 'product_sheet', is_canonical: false },
];
export const DEL_PREVIEW: DelPreview = { code: 'SUP-0211', products: 14, products_by_status: { draft: 13, submitted: 1 }, in_moderation: 1, photos: 22, skus_released: 14, contacts: 1, name_variants: 2, certificates: 0, import_jobs: 1, import_runs: 1, distributors: 0, blockers: [], can_delete: true };
export const COUNTRIES: [string, string][] = [['CN', 'China'], ['VN', 'Vietnam'], ['IN', 'India'], ['TR', 'Turkey']];

export const RUNS: RunRow[] = [
  { id: id(31), name: 'Greenleaf 2026-11 catalogue', status: 'previewed', created_at: '2026-11-26T09:00:00Z', committed_at: null, diff: { products: { create: 12, update: 30 }, prices: { create: 96, update: 4 }, images: { create: 40 }, review: { total: 5 } }, report: null },
  { id: id(32), name: 'Nuorui launch range', status: 'committed', created_at: '2026-11-20T09:00:00Z', committed_at: '2026-11-20T10:00:00Z', diff: null, report: { products: { create: 14, update: 0 }, prices: { create: 42 }, images: { create: 22 }, review: { create: 3 } } },
  { id: id(33), name: 'Bright lighting test', status: 'discarded', created_at: '2026-11-02T09:00:00Z', committed_at: null, diff: { products: { create: 2 }, prices: { create: 6 }, images: { create: 0 }, review: { total: 0 } }, report: null },
];
export const SUPPLIER_OPTS: SupplierOpt[] = [{ id: id(11), code: 'SUP-0142', legal_name: 'Ningbo Greenleaf Textiles Co., Ltd.', external_id: 'CN-ZJ-NGL-0001' }, { id: id(12), code: 'SUP-0211', legal_name: 'Guangzhou Nuorui Biotech Co., Ltd.', external_id: 'CN-GD-NRB-0003' }];

export function importRun(kind: 'preview' | 'errors' | 'committed'): ImportRunData {
  const committed = kind === 'committed';
  return {
    id: id(31), name: committed ? 'Nuorui launch range' : 'Greenleaf 2026-11 catalogue', status: committed ? 'committed' : 'previewed', created_at: '2026-11-26T09:00:00Z', committed_at: committed ? '2026-11-26T10:00:00Z' : null, error: null,
    batch: {
      supplier: { external_id: 'CN-ZJ-NGL-0001', manufacturer_code: null, legal_name: 'Ningbo Greenleaf Textiles Co., Ltd.', country: 'CN', province: 'Zhejiang', city: 'Ningbo', handle: 'greenleaf', status: 'needs_identity_review', notes: null, contact_name: 'Lily Chen', contact_email: 'lily@greenleaf.example', contact_phone: null,
        name_variants: [{ variant_name: 'Ningbo Greenleaf Textiles Co., Ltd.', variant_address: null, seen_in: 'supplier_sheet' }, { variant_name: 'Greenleaf Home Textile Factory', variant_address: 'Yinzhou, Ningbo', seen_in: 'invoice_header' }],
        contacts: [{ name: 'Lily Chen', role: 'Sales', phone: '+86 574 0000 0000', wechat: null, email: 'lily@greenleaf.example', is_primary: true }] },
      products: [
        { external_id: 'CN-ZJ-NGL-BT30', sheet: 'Kitchen', factory_model: 'BT30', supplier_model: null, name: 'Bamboo kitchen towel 30 cm', category: 'Kitchen textiles', image_file: 'bt30.jpg', net_weight: null, product_size_mm: null, size_notes: null, colour_box_mm: null, carton_size_mm: null, qty_per_carton: null, gross_weight: null, specification_raw: null, selling_points_raw: null, exclusive_channels: null, exclusivity_flag: null, platform_status: null, listing_status: 'draft', supplier_status: 'quoted', moq: 1000, incoterm: 'FOB', notes: null, specs: [] },
        { external_id: 'CN-ZJ-NGL-AP50', sheet: 'Kitchen', factory_model: 'AP50', supplier_model: null, name: null, category: null, image_file: null, net_weight: null, product_size_mm: null, size_notes: null, colour_box_mm: null, carton_size_mm: null, qty_per_carton: null, gross_weight: null, specification_raw: null, selling_points_raw: null, exclusive_channels: null, exclusivity_flag: null, platform_status: null, listing_status: 'needs_quote', supplier_status: 'needs_quote', moq: null, incoterm: null, notes: null, specs: [] },
      ],
      prices: [
        { external_id: 'CN-ZJ-NGL-BT30', incoterm: 'FOB', moq_tier_min: 1000, variant_label: '', price_minor: 15800, currency: 'USD', valid_from: '2026-11-01', valid_to: '2026-12-01' },
        { external_id: 'CN-ZJ-NGL-BT30', incoterm: 'FOB', moq_tier_min: 5000, variant_label: '', price_minor: 14250, currency: 'USD', valid_from: '2026-11-01', valid_to: '2026-12-01' },
      ],
      images: [{ external_id: 'CN-ZJ-NGL-BT30', file: 'bt30.jpg', sort: 0, role: 'primary' }],
      review: [{ external_id: 'CN-ZJ-NGL-AP50', kind: 'needs_quote', issue: 'No supplier price', evidence: null }],
      valid_from: '2026-11-01', valid_to: '2026-12-01', warnings: ['Sheet “Old” was skipped (no Product Id in A1).'],
      errors: kind === 'errors' ? [{ sheet: 'Kitchen', row: 14, column: 'MOQ', message: 'MOQ must be a whole number' }, { sheet: 'Kitchen', row: 22, column: 'Product Id', message: 'Duplicate Product Id CN-ZJ-NGL-BT30' }] : [],
      unmatched_images: ['old-photo.jpg'], missing_images: [],
    },
    diff: { suppliers: { create: 0, update: 1, skip: 0 }, products: { create: 1, update: 1, skip: 0 }, supplier_products: { create: 1, update: 0, skip: 1 }, prices: { create: 2, update: 0, skip: 0 }, images: { create: 1, update: 0, skip: 0 }, review: { total: 1, by_kind: { needs_quote: 1 }, already_known: 0 },
      changes: [{ external_id: 'CN-ZJ-NGL-BT30', field: 'category', from: 'Textiles', to: 'Kitchen textiles' }, { external_id: 'CN-ZJ-NGL-BT30', field: 'name', from: 'Bamboo towel', to: 'Bamboo kitchen towel 30 cm' }] },
    report: committed ? { products: { create: 1, update: 1 }, prices: { create: 2, update: 0, superseded: 1 }, images: { create: 1 }, review: { create: 1 }, suppliers: { create: 0, update: 1 }, supplier_products: { create: 1, update: 0 } } : null,
    statusOf: committed ? { 'CN-ZJ-NGL-BT30': 'draft', 'CN-ZJ-NGL-AP50': 'draft' } : {}, listingOf: committed ? { 'CN-ZJ-NGL-BT30': 'draft', 'CN-ZJ-NGL-AP50': 'needs_quote' } : {},
    drafts: committed ? 1 : 0, submitResults: {}, supplier: { id: id(11), code: 'SUP-0142', identity_status: 'needs_identity_review' },
  };
}

export const REVIEW_ITEMS: ReviewItem[] = [
  { id: id(41), external_id: 'CN-ZJ-NGL-AP50', kind: 'needs_quote', issue: 'No supplier price in the workbook', evidence: 'Kitchen!H22 blank', status: 'open', decision_note: null, decided_at: null, run_id: id(31), product_id: id(51) },
  { id: id(42), external_id: 'CN-ZJ-NGL-BT30', kind: 'outlier', issue: 'Price 3.4× the sheet median', evidence: 'US$ 1.58 vs median US$ 0.46', status: 'held', decision_note: 'Asked the supplier', decided_at: '2026-11-26T10:00:00Z', run_id: id(31), product_id: id(52) },
  { id: id(43), external_id: 'CN-ZJ-NGL-CT10', kind: 'note', issue: 'Supplier note: colour may vary', evidence: null, status: 'resolved', decision_note: 'OK for listing', decided_at: '2026-11-25T10:00:00Z', run_id: id(31), product_id: null },
];
export const REVIEW_PRODUCTS: ReviewProduct[] = [
  { id: id(51), external_id: 'CN-ZJ-NGL-AP50', title: 'Apron, 50 × 70 cm', status: 'draft', listing_status: 'needs_quote', markup_pct: null, sell_price_mode: 'markup', currency: 'USD', tiers: [], cost_cents: null },
  { id: id(52), external_id: 'CN-ZJ-NGL-BT30', title: 'Bamboo kitchen towel 30 cm', status: 'draft', listing_status: 'draft', markup_pct: 30, sell_price_mode: 'markup', currency: 'USD', tiers: [{ min_qty: 1000, unit_price_cents: 205 }, { min_qty: 5000, unit_price_cents: 185 }], cost_cents: 158 },
];

export const HS_TYPES: HsType[] = [
  { id: id(61), name: 'Kitchen towels', type_key: 'kitchen_towel', heading: '6302', confirmed: true, source: 'seed', confidence: null, reason: 'Toilet and kitchen linen of terry towelling', total: 18, suggested: 0 },
  { id: id(62), name: 'Lunch boxes', type_key: 'lunch_box', heading: '7323', confirmed: false, source: 'ai', confidence: 0.86, reason: 'Table / kitchen articles of iron or steel', total: 9, suggested: 6 },
  { id: id(63), name: 'Shampoo', type_key: 'shampoo', heading: null, confirmed: false, source: 'manual', confidence: null, reason: null, total: 3, suggested: 0 },
];
export const HS_PROPOSALS: HsProposal[] = [
  { product_id: id(71), sku: 'OCT-000231', title: 'Stainless lunch box, 2 layers', heading: '7323', type_name: 'Lunch boxes', source: 'ai', confidence: 0.82, status: 'suggested', note: null },
  { product_id: id(72), sku: 'OCT-000232', title: 'Herbal shampoo 500 ml', heading: null, type_name: 'Shampoo', source: null, confidence: null, status: 'missing', note: 'No rule matched; AI unsure' },
];

export const CATS: CatRow[] = [
  { id: id(81), name: 'Home & kitchen', slug: 'home-kitchen', parent_id: null, level: 1, hs_code: null, sort: 1, active: true, products: 0 },
  { id: id(82), name: 'Kitchen textiles', slug: 'kitchen-textiles', parent_id: id(81), level: 2, hs_code: '6302', sort: 1, active: true, products: 18 },
  { id: id(83), name: 'Lunch boxes', slug: 'lunch-boxes', parent_id: id(81), level: 2, hs_code: '7323', sort: 2, active: true, products: 9 },
  { id: id(84), name: 'Old stock', slug: 'old-stock', parent_id: id(81), level: 2, hs_code: null, sort: 3, active: false, products: 0 },
  { id: id(85), name: 'Beauty', slug: 'beauty', parent_id: null, level: 1, hs_code: null, sort: 2, active: true, products: 0 },
  { id: id(86), name: 'Hair care', slug: 'hair-care', parent_id: id(85), level: 2, hs_code: '3305', sort: 1, active: true, products: 3 },
];
export const TAGS: TagRow[] = [
  { id: id(91), name: 'Eco', kind: 'feature', products: 22 },
  { id: id(92), name: 'Custom print', kind: 'feature', products: 9 },
  { id: id(93), name: 'Best seller', kind: 'badge', products: 4 },
  { id: id(94), name: 'OEKO-TEX', kind: 'certification', products: 11 },
];
