/** Bulk upload template columns, v2 (ADDON-33) — shared by the template route, the export, the parser and the page. */
export const IMPORT_COLUMNS = [
  { key: 'sku', required: true, width: 22, note: 'Product Id = your SKU code, e.g. FST-BLT-M10X40-A2. 3-40 characters, letters/digits/dash/dot/underscore, no spaces; saved in UPPERCASE. Must be unique across the WHOLE platform (all suppliers), never reused, even after a product is deleted.' },
  { key: 'title', required: true, width: 48, note: 'Product title, e.g. "Stainless steel hex bolts, M10 × 40 mm, A2-70"' },
  { key: 'category_path', required: true, width: 44, note: 'Full category path separated by ">", e.g. "Fasteners > Bolts > Hex bolts" (see Lists sheet)' },
  { key: 'supplier_code', required: true, width: 14, note: 'Supplier code, e.g. OCT-1101 (must be assigned to you)' },
  { key: 'unit', required: false, width: 10, note: 'pcs, pairs, sets, units, boxes… (default pcs)' },
  { key: 'moq', required: true, width: 10, note: 'Minimum order quantity (whole number > 0)' },
  { key: 'lead_time_days', required: false, width: 14, note: 'Lead time in days (whole number)' },
  { key: 'incoterm', required: false, width: 10, note: 'EXW, FOB, CIF, DAP, DDP… (default FOB)' },
  { key: 'origin_country', required: false, width: 14, note: 'ISO 2-letter country code, e.g. CN' },
  { key: 'hs_code', required: false, width: 12, note: 'Customs HS code, e.g. 7318.15' },
  { key: 'currency', required: false, width: 10, note: 'Currency of the tier prices: USD or CNY (default USD; 1688 suppliers quote CNY)' },
  { key: 'tier1_qty', required: true, width: 10, note: 'Tier 1 from-quantity' },
  { key: 'tier1_price', required: true, width: 14, note: 'Tier 1 unit price in the row currency' },
  { key: 'tier2_qty', required: false, width: 10, note: 'Tier 2 from-quantity (must be > tier 1)' },
  { key: 'tier2_price', required: false, width: 14, note: 'Tier 2 unit price in the row currency' },
  { key: 'tier3_qty', required: false, width: 10, note: 'Tier 3 from-quantity (must be > tier 2)' },
  { key: 'tier3_price', required: false, width: 14, note: 'Tier 3 unit price in the row currency' },
  { key: 'octopus_dropship', required: false, width: 16, note: 'yes / no' },
  { key: 'ready_to_ship', required: false, width: 14, note: 'yes / no' },
  { key: 'image_file', required: false, width: 22, note: 'Main photo: file name inside the images .zip you upload with this sheet, e.g. M10x40-bolt.jpg (name only, no folder). .jpg .jpeg .png .webp .avif, max 15 MB. Blank = keep the existing photo.' },
  { key: 'image_file_2', required: false, width: 18, note: 'Second photo (same rules).' },
  { key: 'image_file_3', required: false, width: 18, note: 'Third photo (same rules).' },
  { key: 'description', required: false, width: 60, note: 'Plain-text description' },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]['key'];

export const IMPORT_RULES = [
  'One row per product. Rows are validated first; valid rows are imported as drafts, then you can submit them for moderation.',
  'SKU rules: a new SKU creates a product; a SKU you already own updates that product (a diff is shown before saving). A SKU that belongs to another supplier, or that appears twice in the file, is rejected with the row number.',
  'Upload the images .zip together with this sheet (step 2 of the import). Every image_file name must exist in the zip (name match is case-insensitive; a mismatch is listed before you commit).',
  'Tier quantities must go up (tier1 < tier2 < tier3). Prices are per unit in the row currency (USD or CNY, default USD); all tiers of a product share one currency.',
  'Only suppliers assigned to you (with "product upload" switched on) are accepted.',
];

export type ImportImage = { position: 1 | 2 | 3; cell: string; zip_path: string | null; zip_name: string | null; status: 'matched' | 'case' | 'missing' | 'unchanged' };

/** Normalised, validated row stored in import_rows.data */
export type ImportData = {
  sku?: string;
  title: string; category_path: string; category_id: string | null; supplier_code: string; supplier_id: string | null;
  unit: string; moq: number | null; lead_time_days: number | null; incoterm: string | null; origin_country: string | null; hs_code: string | null;
  /** Currency of all tier prices (price_tiers.currency + products.currency). Missing on rows validated before §15.1 → USD. */
  currency?: 'USD' | 'CNY';
  tiers: { min_qty: number; unit_price_cents: number }[]; octopus_dropship: boolean; ready_to_ship: boolean; description: string | null;
  /** ADDON-33 */
  mode?: 'create' | 'update' | 'unchanged';
  product_id?: string | null;
  images?: ImportImage[];
  warnings?: string[];
  diff?: { field: string; from: string; to: string }[];
};
