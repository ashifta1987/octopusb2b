/**
 * Bulk import (ADDON-27) — shared types. Pure module (relative imports only) so the web app and the CLI
 * (`pnpm import:bulk`) use exactly the same parser.
 */
export type Incoterm = 'EXW' | 'FOB' | 'CIF' | 'DDP' | 'FCA' | 'CFR';

export type StagedPrice = {
  external_id: string;
  incoterm: Incoterm;
  moq_tier_min: number;
  variant_label: string;
  /** price × 10000 — keeps 4-dp supplier prices such as 12.208 or 9.8062 exact */
  price_minor: number;
  currency: 'USD' | 'CNY';
  valid_from: string;
  valid_to: string | null;
};

export type StagedSpec = { key: string; value: string; sort: number };

export type ListingStatus = 'draft' | 'needs_quote' | 'in_development' | 'needs_review';
export type SupplierProductStatus = 'quoted' | 'needs_quote' | 'in_development' | 'no_price';

export type StagedProduct = {
  external_id: string;
  sheet: string;
  factory_model: string | null;
  supplier_model: string | null;
  name: string | null;               // only filled where the supplier file verified it — blank never overwrites
  category: string | null;
  image_file: string | null;
  net_weight: string | null;
  product_size_mm: string | null;
  size_notes: string | null;
  colour_box_mm: string | null;
  carton_size_mm: string | null;
  qty_per_carton: string | null;
  gross_weight: string | null;
  specification_raw: string | null;
  selling_points_raw: string | null;
  exclusive_channels: string | null;
  exclusivity_flag: string | null;
  platform_status: string | null;    // status of the old listing as read by the supplier file (informational)
  listing_status: ListingStatus;
  supplier_status: SupplierProductStatus;
  moq: number | null;
  incoterm: Incoterm | null;
  notes: string | null;
  specs: StagedSpec[];
};

export type StagedImage = { external_id: string; file: string; sort: number; role: 'primary' | 'gallery'; url?: string; bytes?: number };

export type ReviewKind = 'note' | 'outlier' | 'needs_quote' | 'in_development' | 'identity';
export type StagedReview = { external_id: string; kind: ReviewKind; issue: string; evidence: string | null };

export type NameVariant = { variant_name: string; variant_address: string | null; seen_in: string; is_canonical?: boolean };
export type Contact = { name: string; role: string | null; phone: string | null; wechat: string | null; email: string | null; is_primary: boolean };

export type StagedSupplier = {
  external_id: string;
  manufacturer_code: string | null;
  legal_name: string;
  country: string | null;
  province: string | null;
  city: string | null;
  handle: string | null;
  status: 'ok' | 'needs_identity_review';
  notes: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  name_variants: NameVariant[];
  contacts: Contact[];
};

export type StagingBatch = {
  supplier: StagedSupplier;
  products: StagedProduct[];
  prices: StagedPrice[];
  images: StagedImage[];
  review: StagedReview[];
  valid_from: string;
  valid_to: string | null;
  warnings: string[];
  /** blocking validation errors (ADDON-29): the run cannot be committed while any exist */
  errors: ImportError[];
  unmatched_images: string[];
  missing_images: string[];
};

export type ImportError = { sheet: string; row: number | null; column: string | null; message: string };

export type ImportOptions = {
  /** quote validity window written on every price row */
  validFrom: string;
  validDays: number;
  /** price above this multiple of its sheet median → review item */
  outlierX: number;
  /** filenames available in the image ZIP (null = no ZIP supplied) */
  imageFiles?: string[] | null;
};

