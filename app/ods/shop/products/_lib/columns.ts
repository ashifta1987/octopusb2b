/**
 * The exact columns the ODS product page selects (pure, so tests/unit/ods-shop-price.test.ts can check them).
 * Customer-safe only (Part 1 rule 7): no supplier_id / supplier name or code, no factory id, no model number,
 * no cost, no margin, no internal status columns. product_factory is read separately for `verified` only.
 */
export const PRODUCT_COLS =
  'id, slug, title, unit, moq, min_price_cents, currency, image_url, category_id, lead_time_days, description, incoterm, hs_code, qty_per_carton, ' +
  'price_tiers(min_qty, unit_price_cents, currency), product_tags(tags(slug)), product_specs(name, value, sort), product_media(url, alt, sort, kind)';

export const PRODUCT_FACTORY_COLS = 'verified';

/** Column names that must never appear in a customer-facing select. */
export const FORBIDDEN_COLUMN = /(supplier|factory_id|factory_code|model_no|model_number|sourcing_model|cost|margin|hs_code_status|internal)/i;
