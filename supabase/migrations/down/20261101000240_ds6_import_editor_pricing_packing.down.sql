-- Down for 20261101000240_ds6_import_editor_pricing_packing.sql (Dropship Step 6 + 6b merchant).
-- The up replaced nothing, so the down only drops what it created: functions first (some take this migration's row
-- types), then tables children → parents. Existing tables (dropship_import_list, fee_versions, wh_client_skus, …) are
-- untouched. Data written in the new tables is lost — run only within the first hour, per the release rules.

drop function if exists public.ds_rate_mapping_save(uuid, text);
drop function if exists public.ds_packing_save(jsonb);
drop function if exists public.ds_packing_get();
drop function if exists public.ds_push_fail(uuid, text, text, integer, boolean);
drop function if exists public.ds_push_complete(uuid, jsonb);
drop function if exists public.ds_push_claim(text, integer);
drop function if exists public.ds_pushed_list();
drop function if exists public.ds_unlink(uuid[], uuid);
drop function if exists public.ds_push_retry(uuid[], uuid, uuid[]);
drop function if exists public.ds_push_cancel(uuid[]);
drop function if exists public.ds_push_enqueue(uuid[], jsonb, uuid[], uuid);
drop function if exists public.ds_push_page(uuid[]);
drop function if exists public.ds_job_json(public.dropship_push_jobs);
drop function if exists public.ds_record_fx_rate(text, numeric, text);
drop function if exists public.ds_price_approval_decide(uuid, text);
drop function if exists public.ds_pricing_save(jsonb);
drop function if exists public.ds_pricing_get();
drop function if exists public.ds_listing_save(uuid, jsonb);
drop function if exists public.ds_text_check(uuid, jsonb);
drop function if exists public.ds_listing_get(uuid);
drop function if exists public.ds_import_apply_rule(uuid[]);
drop function if exists public.ds_import_bulk_add(jsonb);
drop function if exists public.ds_import_remove(uuid[]);
drop function if exists public.ds_import_add(uuid[]);
drop function if exists public.ds_import_list();
drop function if exists public.ds_listing_state(uuid, uuid, boolean);
drop function if exists public.ds_variant_landed(uuid, text, text, text, bigint);
drop function if exists public.ds_text_problems(uuid, jsonb);
drop function if exists public.ds_packaging_extra_cents(uuid);
drop function if exists public.ds_fx_for(text);
drop function if exists public.ds_active_connection(uuid);
drop function if exists public.ds_duty_mode(uuid, text);
drop function if exists public.ds_default_method(uuid);
drop function if exists public.ds_main_market(uuid);
drop function if exists public.ds_rules_for(uuid);
drop function if exists public.ds_variant_stock_label(uuid);
drop function if exists public.ds_product_visible(public.dropship_products, uuid);
drop function if exists public.ds_feature_guard(text);
drop function if exists public.ds_org_read();
drop function if exists public.ds_text_to_html(text);
drop function if exists public.ds_profit_bp(bigint, bigint, numeric, text);
drop function if exists public.ds_fmt_money(bigint, text);
drop function if exists public.ds_price_compute(bigint, jsonb, text, integer, integer, numeric, text);
drop function if exists public.ds_bands_problem(jsonb);
drop function if exists public.ds_round_price(numeric, text, integer);
drop function if exists public.ds_currency_exponent(text);
drop function if exists public.ds_supported_currencies();

drop table if exists public.dropship_rate_mappings;
drop table if exists public.dropship_duty_modes;
drop table if exists public.dropship_packing_settings;
drop table if exists public.dropship_sync_log;
drop table if exists public.dropship_price_approvals;
drop table if exists public.dropship_variant_links;
drop table if exists public.dropship_product_links;
drop table if exists public.dropship_push_jobs;
drop table if exists public.dropship_push_batches;
drop table if exists public.dropship_listing_variants;
drop table if exists public.dropship_listings;
drop table if exists public.dropship_pricing_rules;
drop table if exists public.dropship_fx_rates;
drop table if exists public.store_connections;
