/** Bulk upload template columns (shared by the template route, the parser and the page). */
export const IMPORT_COLUMNS = [
  { key: 'title', required: true, width: 48, note: 'Product title, e.g. "Stainless steel hex bolts, M10 × 40 mm, A2-70"' },
  { key: 'category_path', required: true, width: 44, note: 'Full category path separated by ">", e.g. "Fasteners > Bolts > Hex bolts" (see Lists sheet)' },
  { key: 'supplier_code', required: true, width: 14, note: 'Supplier code, e.g. OCT-1101 (must be assigned to you)' },
  { key: 'unit', required: false, width: 10, note: 'pcs, pairs, sets, units, boxes… (default pcs)' },
  { key: 'moq', required: true, width: 10, note: 'Minimum order quantity (whole number > 0)' },
  { key: 'lead_time_days', required: false, width: 14, note: 'Lead time in days (whole number)' },
  { key: 'incoterm', required: false, width: 10, note: 'EXW, FOB, CIF, DAP, DDP… (default FOB)' },
  { key: 'origin_country', required: false, width: 14, note: 'ISO 2-letter country code, e.g. CN' },
  { key: 'hs_code', required: false, width: 12, note: 'Customs HS code, e.g. 7318.15' },
  { key: 'tier1_qty', required: true, width: 10, note: 'Tier 1 from-quantity' },
  { key: 'tier1_price_usd', required: true, width: 14, note: 'Tier 1 unit price in USD' },
  { key: 'tier2_qty', required: false, width: 10, note: 'Tier 2 from-quantity (must be > tier 1)' },
  { key: 'tier2_price_usd', required: false, width: 14, note: 'Tier 2 unit price in USD' },
  { key: 'tier3_qty', required: false, width: 10, note: 'Tier 3 from-quantity (must be > tier 2)' },
  { key: 'tier3_price_usd', required: false, width: 14, note: 'Tier 3 unit price in USD' },
  { key: 'octopus_dropship', required: false, width: 16, note: 'yes / no' },
  { key: 'ready_to_ship', required: false, width: 14, note: 'yes / no' },
  { key: 'description', required: false, width: 60, note: 'Plain-text description' },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]['key'];

/** Normalised, validated row stored in import_rows.data */
export type ImportData = {
  title: string; category_path: string; category_id: string | null; supplier_code: string; supplier_id: string | null;
  unit: string; moq: number | null; lead_time_days: number | null; incoterm: string | null; origin_country: string | null; hs_code: string | null;
  tiers: { min_qty: number; unit_price_cents: number }[]; octopus_dropship: boolean; ready_to_ship: boolean; description: string | null;
};
