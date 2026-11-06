> **Implementation note (6 Nov 2026).** Built on `/admin/import` (there is no `/admin/products` screen; the Product Id is shown on the distributor product list and in office moderation).
> Template: `lib/import/template.ts` (README → Supplier → category sheets, 20 columns, Product Id col 1, Image file col 9, yellow required headers, frozen bold header with notes). Download: `GET /admin/import/template?kind=blank|prefilled&supplier=<id>` (products:edit). Pre-fill export: `lib/import/export.ts`.
> Validation (`lib/import/parse-workbook.ts`): blank / malformed / duplicate Product Id, missing Factory model or Category, Image file that is a path, has a bad extension, is missing from the ZIP or differs only by case → blocking errors; the preview lists them and hides Commit, and `commit_import_run` raises `IMPORT_HAS_ERRORS`. A photo used by several rows is uploaded once (`product-media/import/<supplier>/<file>`).
> Product Ids: migration 156 backfilled all 131 existing products (`<country>-XX-S<supplier code>-NNNN` for non-imported products, audit `product.external_id_assigned`) and a trigger assigns one to every new product.
> Bowijie's original "Not Quoted" sheet has 6 columns; the template uses the full 20 everywhere. The parser reads columns by header name, so both shapes import. Demo suppliers have no supplier cost rows, so their pre-filled export has blank prices.
> Tests: `tests/unit/import-template.test.ts`, `supabase/tests/import-roundtrip.test.mjs`, `tests/e2e/template-roundtrip.mjs`.

# Add-on: fix the bulk-update download template

## Why

The template a user downloads from `/admin/import` (or `/admin/products/bulk-update`, whichever the current screen is) is missing two columns the importer needs:

- **Product Id** — the match key. Without it, every row looks new, every re-import duplicates, and there is no way to update a product's spec, price or image after the first upload.
- **Image file** — the link between a row and a photo in the companion zip. Without it the image zip is dead weight.

Both columns exist in ADDON-27's schema and in the reference Bowijie workbook. The template generator just wasn't updated.

## Antigravity prompt 29-A — add Product Id and Image file to the download template

```
Read docs/ADDON-27-bulk-upload.md and the current template-generator route (likely app/api/admin/import/template/route.ts, or similar — grep for "bulk" and "template").

1. Update the generated XLSX so every product-category sheet (Fans, Diffusers, Humidifiers, Not Quoted, and any future category) carries EXACTLY these 20 columns in this order, matching data/bulk/bowijie/source.xlsx:
   1  Product Id           (required; the external ID, e.g. CN-GD-BWJ-F8. Match key for updates.)
   2  Factory model
   3  Product name (live on platform)
   4  Category             (one of the SPEC §6 category codes)
   5  Price USD
   6  Price options as quoted  (free text; parsed by scripts/import/parse_prices.ts)
   7  MOQ
   8  Sample               (Yes/No)
   9  Image file           (filename in the companion zip, e.g. F8.jpg)
   10 Net weight
   11 Product size (mm)
   12 Colour box (mm)
   13 Carton size (mm)
   14 Qty / carton
   15 Gross weight
   16 Specification (supplier)
   17 Selling points (supplier)
   18 Exclusive channels
   19 Platform status      (draft | published | needs_quote | in_development | needs_review)
   20 Notes / discrepancies

2. Product Id rules:
   - Required on every data row. The validator rejects the import if any row has a blank Product Id.
   - Format: `<country>-<province>-<supplier_code>-<model>` (e.g. `CN-GD-BWJ-F8`). Validate with a regex and fail with a per-row error message.
   - Case-sensitive. Uppercased by the parser before matching.
   - If a Product Id is not found in the products table, the row is a CREATE. If it is found, the row is an UPDATE and the diff screen shows every field that differs.
   - A "Generate Product Ids" button on the template-download screen offers to pre-fill Product Id from Factory model + the user's supplier record. Admin can still edit before saving.

3. Image file rules:
   - Optional. Blank means "no image for this row this time"; existing images on the product are kept.
   - Filename only, not a path (`F8.jpg`, not `images/F8.jpg`).
   - Allowed: .jpg .jpeg .png .webp .avif. Max 15 MB each per ADDON-28's budget.
   - The validator checks that every non-blank Image file resolves to a file in the companion zip. A mismatch (`F8.jpg` in the sheet, `f8.jpg` in the zip) is reported with the exact rows affected before commit.
   - If the same Image file appears on two rows, the same photo is linked to both products (not duplicated in Storage) and the preview warns.
   - To add a second image to a product, the current flow only supports primary; multi-image is handled from /admin/products/<id>/images. (ADDON-27 can extend this later with Image file 2, 3… columns.)

4. Fix the Supplier sheet of the template too, matching the Bowijie reference:
   Supplier record (key / value):
   - Supplier ID                 (required, format `<country>-<province>-<supplier_code>-<seq>`)
   - Manufacturer code
   - Contact
   - Phone / WeChat
   - Email
   - Handle
   Separate section "Name variants in circulation" with up to 5 rows (variant name, address, seen_in, canonical=true/false). Required when more than one legal name has been seen (per the Bowijie identity issue).

5. Template header row styling: bold, frozen top row, a one-line note under each required column explaining what it means (XLSX comments, not visible cell text). "Required" columns (Product Id, Factory model, Category) get a yellow fill in row 1.

6. A second sheet "README" prepended to the workbook with the HOW-TO-USE copy currently in data/bulk/bowijie/source.xlsx's README sheet (blank = null not zero; Product Id is the key; images come in a companion zip; etc.).

7. Backfill: for every product already in the database when this ships, make sure it has a Product Id. If any product lacks one, generate one from supplier_code + factory_model + a sequence suffix and log it to audit_log. Expose a /admin/products column "Product Id" so the admin can see and copy it.

8. UI on /admin/import template-download page:
   - Two download buttons: "Blank template" and "Template pre-filled with existing products" (the second one exports every current product so an admin can edit in place and re-upload).
   - A dropdown "Supplier to pre-fill" — picks that supplier's Supplier Id + name variants into the Supplier sheet.
   - One-line reminder: "Save the workbook as .xlsx. Put image files in a separate .zip (any folder structure). Filenames must match the Image file column exactly, including case."

9. Tests:
   - Vitest: template-generator returns a workbook whose header rows on every category sheet match the 20-column spec above.
   - Vitest: validator rejects a row with blank Product Id.
   - Vitest: validator rejects an Image file that is not in the companion zip.
   - Playwright: admin downloads the template, fills two rows (one with image, one without), zips one image, uploads both, commits — exactly one product gets an image, both are created.
   - Playwright: admin downloads the "pre-filled with existing products" template, edits one price cell, re-uploads — exactly one product shows as UPDATE with one price diff; all others SKIP.

Done when: the downloaded template carries Product Id (column 1) and Image file (column 9) on every category sheet; a user can round-trip a product (download → edit → upload) without losing anything; a blank Product Id blocks the import with a clear error; the Bowijie reference workbook at data/bulk/bowijie/source.xlsx is byte-identical in structure to what the template generator produces.
```

## What to do with it

1. Paste ADDON-29-A into Antigravity. It's small — no schema change, just the template generator + a validator fix.
2. After it lands, download the template again and compare against `data/bulk/bowijie/source.xlsx`. They should match column-for-column.
3. Any supplier workbook you've already prepared keeps working — the two new columns are the first and the ninth, and the parser treats them as required+optional in that order.
