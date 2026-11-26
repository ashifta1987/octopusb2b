-- 20261101000239_w4_carriers_dispatch_tracking.down.sql
-- Reverses 20261101000239_w4_carriers_dispatch_tracking.sql exactly: drops the two storage policies, every W4 function, the W4
-- tables, the two columns added to wh_orders (tracking_token, shipped_at — with their grant, unique and check constraints), the
-- three sequences, the 'dispatch' rows of wh_role_capabilities and the inactive '4px' carriers row (only while no shipment uses it).
-- No existing function was replaced by W4 (wipe_demo_data included), so nothing has to be restored.
-- Data in the W4 tables (carrier accounts / services / rules, labels, scans, dispatches, pallets, tracking events) is lost. Rows
-- already written to the existing shipments / tracking_events tables for Dropship orders stay (they belong to Dropship now).
-- The private 'wh-labels' bucket and any label PDFs in it are storage data, not schema; they stay (remove them with the Storage
-- API if wanted), like W3a's 'wh-evidence' bucket.
-- (_migrations bookkeeping: delete from public._migrations where name = '20261101000239_w4_carriers_dispatch_tracking.sql';)

drop policy if exists "wh labels upload" on storage.objects;
drop policy if exists "wh labels read" on storage.objects;

-- boards and reads
drop function if exists public.wh_parcel_label_board(text);
drop function if exists public.wh_dispatch_board(text);
drop function if exists public.wh_label_json(public.wh_shipments);
drop function if exists public.wh_public_tracking(text);
drop function if exists public.wh_carriers_board(text);
drop function if exists public.wh_carrier_version_json(public.wh_carrier_rule_versions);

-- tracking
drop function if exists public.wh_tracking_record_carrier(text, text, text, text, text, text, timestamptz);
drop function if exists public.wh_tracking_poll_targets(integer);
drop function if exists public.wh_tracking_sandbox_next(uuid);
drop function if exists public.wh_tracking_add(uuid, uuid, text, text, text, timestamptz);

-- freight
drop function if exists public.wh_freight_label_printed(uuid, integer);
drop function if exists public.wh_freight_dispatch(uuid, text, text);
drop function if exists public.wh_freight_reopen(uuid, text);
drop function if exists public.wh_freight_close(uuid, integer, integer, integer, integer);
drop function if exists public.wh_freight_remove(uuid, uuid);
drop function if exists public.wh_freight_add(uuid, text);
drop function if exists public.wh_freight_create(text, text);

-- dispatch
drop function if exists public.wh_dispatch_cancel(uuid, text);
drop function if exists public.wh_dispatch_close(uuid, text, text);
drop function if exists public.wh_dispatch_remove(uuid, uuid);
drop function if exists public.wh_dispatch_scan(uuid, text);
drop function if exists public.wh_dispatch_open(uuid);

-- shipped orders + tracking internals
drop function if exists public.wh_tracking_apply(uuid, uuid, text, text, text, timestamptz, text, text);
drop function if exists public.wh_order_maybe_ship(uuid);
drop function if exists public.wh_legacy_status(text);

-- labels
drop function if exists public.wh_labels_can_upload(text);
drop function if exists public.wh_label_printed(uuid);
drop function if exists public.wh_label_void(uuid, text);
drop function if exists public.wh_label_confirm(text, text, smallint);
drop function if exists public.wh_label_record(uuid, uuid, uuid, text, text, text);
drop function if exists public.wh_order_label_state(uuid);
drop function if exists public.wh_label_plan(uuid);
drop function if exists public.wh_label_parcel_check(uuid);

-- carriers and rules
drop function if exists public.wh_decide_carrier_rules(uuid, text, text);
drop function if exists public.wh_propose_carrier_rules(text, jsonb, uuid, text);
drop function if exists public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean);
drop function if exists public.wh_save_carrier_account(text, uuid, text, text, text, text, boolean);
drop function if exists public.wh_carrier_pick(text, text, text[], integer, uuid);
drop function if exists public.wh_service_problem(uuid, text[], integer);
drop function if exists public.wh_carrier_rule_text(text[], text, integer, integer);
drop function if exists public.wh_product_type_matches(text, text[]);
drop function if exists public.wh_env_is_staging();

-- tables (children first)
drop table if exists public.wh_tracking_events;
drop table if exists public.wh_label_scans;
drop table if exists public.wh_shipments;
drop table if exists public.wh_freight_parcels;
drop table if exists public.wh_freight_pallets;
drop table if exists public.wh_dispatches;
drop table if exists public.wh_carrier_rules;
drop table if exists public.wh_carrier_rule_versions;
drop table if exists public.wh_carrier_services;
drop table if exists public.wh_carrier_accounts;

-- columns added to wh_orders (their grant, unique and check constraints go with them)
alter table public.wh_orders drop column if exists shipped_at;
alter table public.wh_orders drop column if exists tracking_token;

drop sequence if exists public.seq_wh_freight;
drop sequence if exists public.seq_wh_dispatch;
drop sequence if exists public.seq_wh_shipment;

delete from public.wh_role_capabilities where action = 'dispatch';
delete from public.carriers c where c.code = '4px' and not c.active and not exists (select 1 from public.shipments s where s.carrier_code = c.code);
