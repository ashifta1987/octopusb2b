# ADDON-34 — Automatic HS code detection (4-digit heading)

Added 6 Nov 2026. Covers the bulk import, the single product form and the cron job. There is no `POST /api/v1/products` yet; when one is added it must call `runHsClassification([id])` the same way.

## Detection order (only when `hs_code` is blank)
1. **Confirmed rule** (`hs_product_types.confirmed = true`): the code is filled as `confirmed`.
2. **Unconfirmed rule**: the code is filled as `suggested`.
3. **AI classifier** (`lib/hs/server.ts`, OpenAI with a strict JSON schema, model `HS_AI_MODEL`, default `gpt-4.1`). The model returns `reason`, `heading`, `heading_title`, `confidence` and `product_type`.
   - Accepted only if the heading is exactly 4 digits in chapters 01–97 (not 77). Anything else is rejected, never trimmed.
   - Confidence ≥ `hs.ai_min_confidence` (0.8): the code is filled as `suggested`.
   - Below that, or no usable answer: the code stays blank and the product is flagged "HS code needs manual entry".
4. **Cache.** Every AI answer becomes an unconfirmed `hs_product_types` row keyed by the normalised product_type, so later products of that type match it as a rule. Products filled from a cached AI type keep `hs_code_source = 'ai'` until an admin confirms the type.
5. **Bulk imports** classify in the background (`after()`), at most 20 products per call. The cap is `hs.ai_max_calls_per_run` (10) calls per run. Products over the cap stay `hs_classify_pending` and the daily `hs-classify` cron picks them up.
6. **Service down or no key:** the code is left blank and flagged. The classifier never throws.

## Data
- Product columns: `hs_code_source` (sheet|rule|ai|manual), `hs_code_confidence`, `hs_code_status` (confirmed|suggested|missing), `hs_product_type_id`, `hs_classify_pending`, `hs_code_note`.
- Trigger `guard_hs_code`: rule or AI results never overwrite a sheet or manual code.
- The category default HS code in the form counts as `manual`.
- Only product fields (title, category, specs, material) are sent to the model. Customer, supplier and price data never are.

## Admin → HS codes
- **Confirm** (`confirm_hs_type`): confirms the type and its suggested products. Audited.
- **Change** (`hs_type_change_preview`, then `change_hs_type_heading`): shows a preview first, then updates the type's rule and AI products. Audited.
- **Backfill:** "Build preview" writes `hs_backfill_proposals` only. "Apply" fills products and needs an Admin.

## Display
- Moderation and the product form show a confirmed / suggested badge and a warning on suggested codes. Suggested codes do not block approval. Missing codes show "Missing HS code".
- The storefront shows suggested codes as "(indicative)".

## Model choice (6 Nov 2026)
- The first preview with gpt-4o-mini and a short prompt gave wrong headings at 0.9 confidence (aroma diffusers → 8480 "moulding boxes").
- A reason-first prompt that asks for the official heading title, run with gpt-4.1, gave consistent results: fans 8414, humidifiers and diffusers 8509, thermo-hygrometers 9025. Bare model codes with no specs were left for manual entry.

