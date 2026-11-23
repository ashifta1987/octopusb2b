# Dropshipping Catalogue v2 (Migrations 204 & 205)

## Summary

Dropshipping (division `DS`) uses a dedicated white-label catalogue managed by staff at `/office/dropship` and read by eligible merchants at `/account/dropship/catalogue`.

## Data Model (Migration 204)

- **`dropship_products`**: `id`, `octopus_sku` (unique, case-insensitive), `title`, `description`, `category`, `images` (max 10 storage URLs), `specs` (`jsonb`), `weight_g`, `dimensions_cm` (`jsonb`), `unit_cost_cents` (`bigint`, staff only), `min_order_qty`, `stock_status` (`in_stock` | `low` | `out`), `stock_qty` (nullable, staff only), `source_type` (`own_warehouse` | `partner_supplier`, staff only), `supplier_id` (staff only, FK to `suppliers`), `supplier_sku` (staff only), `origin_country` (`char(2)`), `status` (`draft` | `active` | `archived`), `is_test` (`boolean`), `division_id` (`DS`), `created_by`, timestamps.
- **`dropship_variants`**: `id`, `product_id`, `options` (`jsonb`), `octopus_sku` (unique), `cost_cents` (`bigint`, staff only), `price_adjust_cents` (`bigint`), `stock_status`, `stock_qty` (staff only), `sort`.
- **`dropship_routes`**: `id`, `product_id`, `destination_country` (`char(2)`), `shipping_method` (`express` | `standard` | `economy`), `landed_price_cents` (`bigint`), `est_shipping_cents` (`bigint`, staff only), `est_duties_cents` (`bigint`, staff only), `est_days_min`, `est_days_max`, `carrier` (staff only), `is_active`, `division_id` (`DS`), `unique (product_id, destination_country, shipping_method)`.
- **`dropship_import_list`**: `id`, `org_id`, `product_id`, `variant_id` (nullable), `service`, `price_cents` (`bigint`), `added_by`, `division_id` (`DS`), `created_at`, `unique nulls not distinct (org_id, product_id, variant_id)`.
- **`dropship_markets`**: `org_id`, `country` (`char(2)`), `locked_by_staff` (`boolean`), `division_id` (`DS`), `updated_by` (hidden column), timestamps, `primary key (org_id, country)`.
- **`dropship_rates`**: kept as the **staff-only** shipping rate card (used via `dropship_rate_estimate()` to pre-fill estimated shipping, duties, delivery days and suggested landed prices; never exposed to merchants).
- **Storage bucket `dropship-media`**: public read for product images, 5 MB limit, `image/jpeg`, `image/png` and `image/webp` only.

## Security, Roles & White-Label Rules (Migration 205)

1. **Merchant eligibility (`dropship_merchant_org()`)**:
   - Returns `NULL` (and all catalogue RPCs return zero rows) for:
     - signed-out visitors (`anon` cannot execute);
     - customers whose organisation does not have `company_services(service='dropship', status in ('on','trial'))`;
     - supplier accounts (`user_roles = 'supplier'` or linked in `suppliers`);
     - staff accounts (`user_is_staff(auth.uid())`), even if using a customer session.
2. **Allowlisted merchant RPCs (`get_dropship_catalogue`, `get_dropship_product`, `get_dropship_countries`)**:
   - `SECURITY DEFINER` with fixed `search_path = public`. No security-definer views are added.
   - Merchants have **no direct `SELECT`** rows on `dropship_products`, `dropship_variants`, `dropship_routes` or `dropship_rates`.
   - Rate-limited per user (`120` requests per minute via `auth_rate_hit`).
   - Returns only allowlisted columns: never supplier names, supplier codes, `supplier_id`, `supplier_sku`, `source_type`, carrier names, `unit_cost_cents`, `cost_cents`, `est_shipping_cents`, `est_duties_cents`, `stock_qty` or margin.
3. **Staff role scoping (`/office/dropship`)**:
   - Placed under `/office/dropship` so Dropshipping (`DS`) division staff can open it directly without requiring company-wide `/admin/*` permissions.
   - **Dropshipping (`DS`) division staff and company-wide Admins**: full read & edit (`dropship_can_edit`).
   - **Finance (company-wide)**: read-only, sees unit cost, supplier and route margins (`dropship_can_see_costs = true`).
   - **Support (company-wide)**: read-only, and **never** sees unit cost, margin, supplier or carrier (`dropship_can_see_costs = false`).
4. **Image processing (`sharp@0.34.4`)**:
   - Verifies magic bytes (real JPEG, PNG or WebP — not just file extension), enforces `limitInputPixels: 40_000_000` against decompression bombs, re-encodes to strip EXIF/GPS metadata, and stores under `<product_id>/<randomUUID>.<ext>`.
5. **CSV bulk import (`/office/dropship/import`)**:
   - Neutralises formula cells by stripping leading `=`, `+`, `-`, `@` and tab/CR characters (`sanitiseCsvCell`).
   - Rejects external image URLs/columns; upserts on `octopus_sku` idempotently; max 2,000 rows; imported products stay `draft` until images and active routes are added.

## Follow-ups Recorded

- **EXIF stripping and magic-byte file-type checking for other uploads**: apply the `sharp` magic-byte + `limitInputPixels` + EXIF-stripping pipeline used in `dropship-media` to the other upload flows (sourcing request files, Make My Brand logos, KYC documents, bank transfer slips, and marketplace `product-media` imports) as a separate staging-first task.
- **Legacy `/import/CN-GD-BWJ-…` marketplace image paths**: 53 existing `product_media` rows on live use `/import/CN-GD-BWJ-<model>/<model>.jpg`, which contains manufacturer code `BWJ`. Plan a staging-first migration to re-key those files to SHA/UUID paths before changing live.
