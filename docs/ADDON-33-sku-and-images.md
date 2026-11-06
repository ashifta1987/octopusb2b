> **Implementation note (6 Nov 2026).**
> - **One identifier.** The SKU is `products.external_id` (the ADDON-27/29 "Product Id"). `products.sku` and `sku_norm` are generated from it, so the Bowijie workbook ("Product Id") and the v2 template ("sku") share one column and one rule. Migration `20261101000159_product_sku_unique.sql`: format check `^[A-Z0-9][A-Z0-9._-]{2,39}$`, unique index on `sku_norm` over every row, `external_id` NOT NULL (all 131 existing products already had one, so no `<CATEGORY>-<base32>` backfill was needed), `sku_reservations` (SKU stays taken after a hard delete), `guard_product_sku` (format, reuse, non-admins cannot change a SKU; changes audited), automatic ids skip reserved SKUs, `import_product_row()` (one transaction per product, caller's RLS).
> - **Images:** instead of a second `product_images` table, `product_media` gained `storage_path`, `source_file_name`, `sha256` and `unique(product_id, sha256)`; `product_images` is a view over it. Photos are stored once per content hash at `product-media/products/sha/<sha256>.<ext>`. `product_media.sort` is now the image position 1, 2, 3 everywhere (migration 161 renumbered the 0-based rows from the single form).
> - **Distributor bulk upload** (`/distributor/products/import`): v2 template (23 columns, frozen C2, drop-downs, red duplicate / missing-SKU highlighting, SKU length + no-space validation), optional images .zip (browser → private `imports` bucket, ≤ 200 MB, 15 MB per image), per-row create / update (with field diff) / no change, errors for blank / bad / repeated / other-supplier / retired SKUs (owner never revealed), image warnings (case-insensitive match, exact name reported, missing → imported without it), unused zip files listed, "Download my products" (round-trips with zero changes), "Generate SKUs" (fills blank SKUs with `<CAT>-NNNNNN`, never a reserved one). Blank optional cells on an update keep the current value.
> - **Single-product form:** optional SKU (blank = automatic), read-only after creation; same error texts (`lib/sku.ts`).
> - **Differences:** there is no `POST /api/v1/products` (the API is read-only for buyers) and the supplier portal is off — both would inherit the database rules. Zip processing runs inside the request (no separate background worker); the page shows progress steps. Supabase Storage's project-wide upload limit (Dashboard → Storage → Settings) must be ≥ 200 MB for the largest zips. The Bowijie workbook (ADDON-29) keeps its exact-case image check and its stricter Product Id pattern (a subset of the SKU rule).
> - Tests: `tests/unit/sku.test.ts`, `supabase/tests/sku.test.mjs`, `tests/e2e/sku-import.mjs`.

# Add-on: Product Id (SKU) + images in the bulk product template, with platform-wide unique SKUs

## Why

The current bulk template (`octopus-product-template.xlsx`, sheet "Products", 19 columns) has no SKU and no image column. Without a SKU an update can't find its product, so every re-upload creates duplicates. Without an image column the photos can't be linked to rows. This add-on adds both and makes the SKU unique across the whole platform, whichever way a product is created (bulk, single form, API).

This applies to the in-app template shown on the supplier/admin bulk page. ADDON-29 covers the Bowijie 20-column workbook; the two must agree on the rules below. The updated sample file is `octopus-product-template_v2.xlsx`.

## Decisions (fixed, do not re-ask)

- Product Id and SKU are the same thing. Column name: `sku`. Column A, required on every row.
- One SKU = one product on the entire platform. Two different suppliers cannot hold the same SKU.
- A SKU is never reused, even after the product is deleted or archived.
- A second supplier selling the same physical product is attached through the multi-supplier flow of ADDON-27 (supplier_products), not by repeating the SKU in a new row.
- Images: `image_file`, `image_file_2`, `image_file_3` (file names inside a companion zip).

## Antigravity prompt 33-A — database

```
Read docs/ADDON-27 and ADDON-29. Create a migration `add_product_sku_unique`.

1. products.sku text, stored uppercase and trimmed. Add a generated/normalised column `sku_norm = upper(btrim(sku))`.
2. Format check: sku_norm ~ '^[A-Z0-9][A-Z0-9._-]{2,39}$' (3-40 chars, no spaces).
3. UNIQUE index on sku_norm across ALL rows, including soft-deleted and archived ones (no WHERE clause). That is what stops reuse.
4. Backfill existing products that have no SKU: generate `<CATEGORYCODE>-<6 char base32 of id>` (e.g. FST-7K3M2Q). Then make sku NOT NULL.
5. A BEFORE INSERT/UPDATE trigger rejects changing sku once set unless the actor is an admin (SKU is immutable for suppliers), and writes any change to audit_log.
6. Table sku_reservations(sku_norm primary key, product_id, supplier_id, created_at) filled by trigger on insert, so hard-deleting a product still leaves the SKU reserved.
7. product_images(id, product_id, storage_path, position, source_file_name, sha256, created_at). unique(product_id, sha256) so the same photo is never stored twice for a product.
8. Write pgTAP / SQL tests: duplicate insert fails; same SKU different case fails; SKU with space fails; delete then re-insert same SKU fails; two suppliers cannot share a SKU.
```

## Antigravity prompt 33-B — template and importer

```
Update the template generator (grep "octopus-product-template" and the import route) to match octopus-product-template_v2.xlsx in the kit:

1. Products sheet columns, in order (23):
   sku, title, category_path, supplier_code, unit, moq, lead_time_days, incoterm, origin_country, hs_code, currency,
   tier1_qty, tier1_price, tier2_qty, tier2_price, tier3_qty, tier3_price, octopus_dropship, ready_to_ship,
   image_file, image_file_2, image_file_3, description
   Keep the existing dropdowns (shifted by one column plus the new ones), freeze panes at C2, header style unchanged.
   Excel-side help: highlight duplicate SKUs in red, highlight a row with data but no SKU, reject spaces or length outside 3-40.
2. Instructions sheet: add rows for sku, image_file, image_file_2, image_file_3 and the SKU/zip rules as in the v2 file.
3. "Generate SKUs" button on the download screen: prefill the sku column from category code + running number for rows the user leaves blank, checked against the database so it never proposes a taken SKU.
4. Import wizard gets a step 2 "Upload images (.zip)" (optional, up to 200 MB, accept jpg jpeg png webp avif, max 15 MB per image). Process in a background job; show progress.
5. Validation (everything reported per row, nothing is saved until the user confirms):
   a. sku blank, bad format, or repeated inside the file → error with the row numbers of all copies.
   b. sku exists and belongs to the same supplier → UPDATE; show a diff of changed fields.
   c. sku exists and belongs to another supplier → error "SKU already used by another supplier" (do NOT reveal who).
   d. sku does not exist → CREATE.
   e. image_file name not found in the zip (match case-insensitively; report the exact name) → warning on that row, product still imports without that image.
   f. file in the zip not referenced by any row → info list, ignored.
   g. blank image cell on an UPDATE → keep existing images. A filled cell replaces that position.
   h. same photo (sha256) on several products is stored once in Storage and linked.
6. Run the whole commit in one transaction per product. A unique-violation on sku at commit time (two users uploading the same SKU at once) is caught and reported as row error c, not a 500.
7. Make the single-product form, the supplier portal and POST /api/v1/products use the same SKU rules and the same error text.
8. Re-export: "Download my products" produces the same v2 layout with sku and the current image file names filled in, so edit-and-reupload round-trips with no duplicates.
9. Tests (Playwright + unit): duplicate SKU in file; SKU owned by another supplier; same SKU re-upload updates, not duplicates; missing image; case-mismatched image name; zip with extra files; concurrent upload race; round-trip export → import yields zero changes.

Done when: the downloaded template has the 3 image columns and a SKU first column, a SKU can exist only once on the platform by every route, re-uploading the exported file changes nothing, and all tests are green.
```

## Notes

- Run after ADDON-27 and ADDON-29. If ADDON-29 already added `Product Id` to the Bowijie format, keep that name there and map it to `products.sku`; the rule is the same.
- SKU is a separate thing from `supplier_code` (OCT-1101), which identifies the supplier and stays as is.

## Bug fix (6 Nov 2026): "Submit for moderation" left bulk-imported products in draft

Job `b1e4cb86…` (50 Bowijie UPDATE rows) showed "submitted" while every product stayed `draft`. Causes: the ADDON-27 import gate refused `draft → submitted` for all 50 (supplier OCT-1132 identity under review), and the submit action ignored the per-product errors and set the job to "submitted" anyway. Fix (migration `20261101000162_import_submit_fix.sql`): the gate now guards publishing (`→ live`) only, so blocked products can wait in the queue with the blocker shown to moderators. `submit_import_job()` submits creates and updates in one transaction, stores a reason on each row that fails, sets the job to `submitted` / `partially_submitted` / `submit_failed` from what really changed, and writes an `import_job.submitted` audit row. Imports never lower a product: the workbook's Platform status applies to new rows only. The 50 products were repaired through the same function. Tests: `supabase/tests/import-submit.test.mjs`, plus the submit step in `tests/e2e/sku-import.mjs`.
