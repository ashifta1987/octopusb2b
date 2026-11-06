# Add-on: bulk upload of products, suppliers and tiered prices

> **Implementation note (6 Nov 2026):** built and the Bowijie catalogue is loaded (69 draft products, supplier OCT-1132, 77 prices, 53 images, 31 review items). Adapted to the existing schema with the owner's approval: suppliers/products keep uuid ids and OCT- codes and get a unique `external_id` (CN-GD-BWJ-0010, CN-GD-BWJ-F8…); `supplier_products`, `supplier_product_prices` (cost, 4-dp), `supplier_name_variants`, `supplier_contacts`, `import_runs`, `import_review_items` are new. Supplier prices are COSTS — buyer `price_tiers` = preferred supplier cost × (1 + `pricing.default_markup_pct`, default 25 %), per-product override or manual mode (owner decision). Photos go to the existing public `product-media` bucket (`import/<external_id>/<file>`), uploads to the private `imports` bucket. The review queue keeps every supplier note (31) instead of the kit's curated 11; all 11 are included. The old single price is not dropped — `price_tiers` stays the buyer price. The storefront still shows one supplier per product (the multi-supplier picker on the product page is a follow-up). Migrations 152–155, `/admin/import`, `/admin/import/review`, `pnpm import:bulk`, tests `tests/unit/import-parser.test.ts` (golden CSVs), `supabase/tests/bulk-import.test.mjs`, `tests/e2e/bulk-import.mjs`.

## Why

Loading 69 Bowijie products by hand — each with specs, carton data, up to 4 price tiers (MOQ × variant × incoterm), images and exclusivity notes — would take days and introduce typos. A real B2B catalogue also needs **more than one supplier per product** (so buyers can compare and so sourcing has a backup) and **more than one price per supplier-product** (tiered by MOQ, by variant, by incoterm).

The SPEC's product model has one price field. This add-on splits that into the correct normalized shape and adds a `/admin/import` screen that reads an XLSX workbook + an image zip, previews every change, and commits them in one transaction only after the admin approves.

## What the data looks like

Given to Antigravity in the kit under `data/bulk/bowijie/`:
- `source.xlsx` — the raw workbook (6 sheets: README, Fans, Diffusers, Humidifiers, Not Quoted, Supplier)
- `csv/suppliers.csv`, `csv/supplier_name_variants.csv`, `csv/supplier_contacts.csv`
- `csv/products.csv` — 69 rows
- `csv/product_images.csv` — 53 rows
- `csv/supplier_products.csv` — 69 rows (one supplier for now; schema supports many)
- `csv/supplier_product_prices.csv` — 77 rows (tiered: MOQ 3000 vs 1000; Plug-in vs Rechargeable; EXW for fans vs FOB for diffusers/humidifiers)
- `csv/review_queue.csv` — 11 flagged rows (spec mismatches between quote and dashboard, out-of-range prices, cloned specs)
- `images/*.jpg` — 53 product photos, filenames match `product_images.csv`

The CSVs are what the importer actually reads. The XLSX is kept for admin review and for the next supplier file (format is stable across suppliers).

## Antigravity prompt 27-A — schema + bulk importer

```
Read docs/SPEC.md sections 6, 8, 11, and docs/ADDON-24-remove-demo-data.md (seed flag). Add proper multi-supplier, multi-price support and a bulk importer. Reference data lives under data/bulk/bowijie/ in the repo (added alongside this prompt).

1. Schema migration `<timestamp>_multi_supplier_prices.sql`:

   a. table suppliers
      supplier_id text primary key   -- e.g. 'CN-GD-BWJ-0010'
      manufacturer_code text not null
      legal_name text not null
      country text, province text, city text
      handle text
      status text not null default 'active'  -- active|needs_identity_review|blocked
      kyc_status text not null default 'pending'
      is_seed boolean not null default false
      notes text
      created_at timestamptz default now()

   b. table supplier_name_variants
      id uuid pk, supplier_id references suppliers,
      variant_name text, variant_address text, seen_in text,
      is_canonical boolean default false
      (one supplier can carry up to 10 historical name/address variants.)

   c. table supplier_contacts
      id uuid pk, supplier_id references suppliers,
      name, role, phone, wechat, email, is_primary boolean

   d. table products
      product_id text primary key  -- external id, e.g. 'CN-GD-BWJ-F8'. Human-readable, used in URLs.
      slug text unique not null
      factory_model text
      name text
      category text
      specification_raw text   -- supplier's raw spec blob, preserved
      selling_points_raw text
      net_weight text
      product_size_mm text
      colour_box_mm text
      carton_size_mm text
      qty_per_carton text
      gross_weight text
      listing_status text not null default 'draft' -- draft|published|needs_quote|in_development|needs_review
      notes text
      is_seed boolean not null default false
      created_at timestamptz, updated_at timestamptz

   e. table product_specs
      id uuid pk, product_id references products,
      key text, value text, sort_order int
      (parsed key:value pairs extracted from specification_raw; the raw text stays on products.)

   f. table product_images
      id uuid pk, product_id references products,
      storage_path text, role text default 'primary', sort_order int default 1

   g. table supplier_products
      supplier_id, product_id — composite primary key
      supplier_model text         -- 'F8制冷手持风扇'
      moq int
      exclusive_channels text
      exclusivity_flag text       -- 'Region Already Exclusively Distributed' or ''
      status text not null default 'quoted'  -- quoted|needs_quote|in_development|withdrawn
      is_preferred boolean default false     -- for ranking when several suppliers carry the same product
      lead_time_days int
      moq_notes text
      created_at timestamptz

   h. table supplier_product_prices
      id uuid pk
      supplier_id, product_id — references supplier_products (composite FK)
      incoterm text not null  -- 'EXW'|'FOB'|'CIF'
      moq_tier_min int not null
      variant_label text default ''  -- e.g. 'Plug-in', 'Rechargeable', or blank for single-variant
      price_minor int not null       -- price × 10000 (USD, 4-dp precision)
      currency text not null default 'USD'
      valid_from date, valid_to date
      is_superseded boolean default false
      created_at timestamptz
      unique (supplier_id, product_id, incoterm, moq_tier_min, variant_label, valid_from)

   RLS: Admin, Finance, Sourcing roles can select/write. Suppliers see only rows where supplier_id = their own org's supplier_id. Customers see only joined views (view_product_cards) that pick the cheapest active price per product.

2. Migrate the existing products table:
   - Copy every row into the new products table.
   - For any product that had a single price field, create one supplier_products row (supplier_id = 'OCTO-INTERNAL-0001' placeholder if the product had no supplier) and one supplier_product_prices row with incoterm='EXW', moq_tier_min=1, variant_label=''.
   - Drop the old price column after the data is copied.
   - Views used by the storefront must be rewritten to read from view_product_cards.

3. Build /admin/import — a 4-step wizard:

   Step 1 Upload:
   - Two file inputs: XLSX workbook and a ZIP of images (optional if images are already on Storage).
   - Max 50 MB per file.
   - Admin names the import (e.g. 'Bowijie 2026-11 catalogue').

   Step 2 Map & validate:
   - Parse the workbook. Supplier sheet is key/value. Product sheets are detected by having 'Product Id' in A1.
   - Images are matched by filename against the Image file column.
   - Prices are parsed with the same rules as scripts/parse_prices.ts (see step 4).
   - Show a table per target table (suppliers, products, supplier_products, supplier_product_prices, product_images) with:
     * row count
     * create vs update vs skip (based on existing product_id / (supplier_id, product_id))
     * conflicts (same key, different values)
   - Show the review queue: rows where notes/discrepancies is non-empty, or where a price is a statistical outlier (> 3× median of its sheet), or where exclusivity blocks a region.
   - A blank cell is a null, never a zero. The parser must enforce this and the UI must show it explicitly.

   Step 3 Review:
   - Admin ticks a box next to each row group to commit or hold.
   - Held rows go to /admin/import/<id>/review as drafts.
   - Admin can override any field inline before commit.
   - The flagged company-identity rows for Bowijie (3 name variants) require an explicit "canonical name" choice before supplier.legal_name can change.

   Step 4 Commit:
   - Single transaction: upsert suppliers → name_variants → contacts → products → supplier_products → supplier_product_prices → product_images (Storage upload first, then DB row).
   - If any row fails, rollback and report which one.
   - Write an audit_log entry 'bulk_import_committed' with counts and the import id.
   - All newly created rows carry listing_status='draft' until the admin publishes them from /admin/products.

4. Parser (`apps/web/scripts/import/`):

   a. parse_workbook.ts
      - Reads suppliers, products, images, supplier_products from the sheets. Normalizes whitespace, strips 含底座 and other parenthetical notes from size fields into a separate 'size_notes' column.
      - Produces an in-memory StagingBatch and writes it to table import_runs for audit.

   b. parse_prices.ts — handle every quote shape seen in the Bowijie file:
      - 'EXW, MOQ 3000' → one row (EXW, 3000, '', uses Price USD column).
      - 'Machine：1.3  |  FOB, MOQ 3000' → one row (FOB, 3000, '', 1.3).
      - 'MOQ 3000 / Plug-in: 1.12 / Rechargeable: 1.5  |  MOQ 1000 / Plug-in: 1.34 / Rechargeable: 1.8  |  FOB'
         → 4 rows (FOB, 3000, Plug-in, 1.12) (FOB, 3000, Rechargeable, 1.5) (FOB, 1000, Plug-in, 1.34) (FOB, 1000, Rechargeable, 1.8).
      - 'No price quoted' → listing_status='needs_quote', no price row.
      - Incoterm default from the sheet: Fans=EXW, others=FOB (already a pattern in the Bowijie file).
      - Currency default = USD (confirmed in the README sheet; override if a quote carries a currency marker).
      - Prices are stored as price_minor = round(price × 10000) to keep 4-dp fractions like 12.208.

   c. parse_specs.ts — split specification_raw into product_specs rows by splitting on newline and ':'. Keep the raw text too; it's authoritative, the parsed rows are for filters.

   d. unit tests on every example quote shape from the README sheet.

5. Image handling:
   - On commit, upload each image in the zip to Storage bucket 'product-images' at the path `<product_id>/<filename>`.
   - Row in product_images stores the Storage path, not the URL.
   - A serving view generates a signed URL on read.
   - Any image in the zip not referenced by an Image file column goes to 'product-images/unmatched/' and is listed in the import run report.

6. Multi-supplier for the same product:
   The first Bowijie import creates one supplier_products row per product. When a second supplier is later imported with the same product_id (or a product_id Antigravity matches by GTIN / UPC / factory model after the admin confirms), it creates a SECOND row in supplier_products and SECOND price rows — it does not overwrite the first. The product card (/products/<slug>) then shows both suppliers with their prices and lets the buyer pick.

7. Review queue on /admin/import/<id>/review, pre-populated from the Bowijie file's own flags:
   - F8: quote says 75 pcs/carton, listing says 80.
   - F3 / J1000 / G2000: mAh mismatch between quote and listing.
   - S13 / S15 / S16: prices 4–5× the median of their sheet, specs blank, rows untranslated.
   - P06: dimensions/carton/weight identical to P05 but spec text claims different tank size.
   - P08: 2 filters in the quote, 2 cleaning swabs in the catalogue.
   - P09: identical to P08 except material (PC/ABS vs ABS).
   - P10: marked 'In Development', no price — listing_status='in_development'.
   Each row shows the evidence pair and a one-click action (accept quote, accept dashboard, hold).

8. Supplier identity:
   When the Bowijie import runs, it populates supplier_name_variants with three rows (the quotation name, the dashboard name, the catalogue name). suppliers.status is set to 'needs_identity_review'. The product side of the import proceeds (drafts are safe). /admin/suppliers/<id> must display a banner 'Three legal names in use — resolve before the first order ships' and refuses to publish any Bowijie product until the admin picks a canonical variant.

9. Settings:
   site_settings `import.price_validity_default_days` = 30
   site_settings `import.outlier_threshold_median_x`  = 3
   site_settings `import.images.max_bytes_each`       = 15_000_000
   site_settings `import.images.max_total_bytes`      = 500_000_000

10. CLI for re-runs: `pnpm import:bulk --xlsx <path> --images <zip> --commit=false` runs step 1-2 and prints the diff to stdout. Same command with --commit=true commits after a confirmation prompt. Used for scripted re-imports from a weekly supplier drop.

11. Tests:
    - pgTAP: upsert math on supplier_products composite key; superseding a price sets is_superseded=true on the prior row.
    - Vitest: parse_prices.ts against every example in parse_prices.test.ts (one per quote shape from the Bowijie workbook).
    - Playwright: upload data/bulk/bowijie/source.xlsx + data/bulk/bowijie/images.zip; preview shows 69 product rows, 77 price rows, 53 images, 11 review-queue entries; commit creates them all; the F8 product page shows one supplier, one price, one image, two listed discrepancies in the admin side panel.
    - Playwright: a second import of the SAME workbook makes zero changes (idempotent).
    - Playwright: a modified workbook with 1 new product and 1 updated price shows exactly 1 create + 1 update in the diff.

Done when: an admin can upload data/bulk/bowijie/source.xlsx + the image zip and have 69 draft products, one supplier with 3 flagged name variants, 77 tiered prices and 53 images land in the database, with the 11 review items waiting for a decision before any Bowijie product can be published.
```

## How to run this

1. Paste the prompt above into Antigravity. The `data/bulk/bowijie/` folder is already in the kit zip.
2. Antigravity builds the schema, the importer and the review screens.
3. Open `/admin/import`, upload `data/bulk/bowijie/source.xlsx` and `data/bulk/bowijie/images.zip`, step through the wizard.
4. Resolve the 11 review items with Tom (the Bowijie contact) and the identity question (pick one canonical legal name).
5. Publish from `/admin/products` once you're happy.

## For future suppliers

The workbook shape is now standard. Any supplier gives you a workbook with these sheets (one Supplier sheet + one sheet per product category) and a zip of images with filenames matching the Image file column, and the importer handles it. The parser rules in step 4b cover the shapes we've seen so far; add a new rule only when a supplier invents a new one.
