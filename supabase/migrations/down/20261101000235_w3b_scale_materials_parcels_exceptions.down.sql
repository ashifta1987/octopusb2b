-- 20261101000235_w3b_scale_materials_parcels_exceptions.down.sql
-- Reverses 20261101000235_w3b_scale_materials_parcels_exceptions.sql exactly: drops the W3b triggers on the W2a / W3a tables, every
-- W3b function, the four nullable W3b columns on W3a tables (with their foreign keys and indexes), the W3b tables and the
-- exception sequence. No W0–W3a function was replaced by W3b (wipe_demo_data() included), so nothing has to be restored.
-- Data in the W3b tables (benches, checks, materials and their ledger, parcels, usage, exceptions) is lost.
-- (_migrations bookkeeping: delete from public._migrations where name = '20261101000235_w3b_scale_materials_parcels_exceptions.sql';)

-- triggers on tables that stay
drop trigger if exists wh_lots_w3b_exceptions on public.wh_lots;
drop trigger if exists wh_orders_w3b_exceptions on public.wh_orders;
drop trigger if exists wh_orders_w3b_single_parcel on public.wh_orders;
drop trigger if exists wh_orders_w3b_guard on public.wh_orders;
drop trigger if exists wh_order_lines_w3b_guard on public.wh_order_lines;
drop trigger if exists wh_pack_evidence_w3b_guard on public.wh_pack_evidence;
drop trigger if exists wh_parcels_w3b_exceptions on public.wh_parcels;

-- exceptions
drop function if exists public.wh_exceptions_board(text, text, text);
drop function if exists public.wh_exception_resolve(uuid, text, text, integer);
drop function if exists public.wh_exception_assign(uuid, uuid);
drop function if exists public.wh_exception_raise(text, text, text, text, text);
drop function if exists public.wh_exception_actions(public.wh_exceptions);
drop function if exists public.wh_exception_held(public.wh_exceptions);
drop function if exists public.wh_lots_w3b_exceptions();
drop function if exists public.wh_parcels_w3b_exceptions();
drop function if exists public.wh_orders_w3b_exceptions();
drop function if exists public.wh_exception_open(text, text, text, uuid, uuid, uuid, uuid, uuid);
drop function if exists public.wh_exceptions_resolve_where(text, uuid, text[], text, text);

-- multi-parcel
drop function if exists public.wh_multi_parcel_queue(text);
drop function if exists public.wh_multi_parcel(text);
drop function if exists public.wh_parcels_close_order(uuid);
drop function if exists public.wh_parcel_remove(uuid);
drop function if exists public.wh_parcel_reopen(uuid, text);
drop function if exists public.wh_parcel_close(uuid, boolean);
drop function if exists public.wh_parcel_add_evidence(uuid, text, text);
drop function if exists public.wh_parcel_unlock_override(uuid, text);
drop function if exists public.wh_parcel_override(uuid, uuid, text, text);
drop function if exists public.wh_parcel_weigh(uuid, uuid, integer);
drop function if exists public.wh_parcel_set_box(uuid, uuid);
drop function if exists public.wh_parcel_unscan(uuid, uuid);
drop function if exists public.wh_parcel_scan(uuid, text);
drop function if exists public.wh_parcel_open_check(uuid);
drop function if exists public.wh_parcel_add(uuid);
drop function if exists public.wh_parcel_order_check(uuid);

-- materials
drop function if exists public.wh_pack_extras(uuid);
drop function if exists public.wh_materials_board(text);
drop function if exists public.wh_pack_void_material(uuid, text);
drop function if exists public.wh_pack_use_material(uuid, uuid, uuid, integer);
drop function if exists public.wh_material_count(uuid, integer, text);
drop function if exists public.wh_material_receive(uuid, integer, text);
drop function if exists public.wh_set_material_charge(uuid, bigint);
drop function if exists public.wh_save_material(text, uuid, text, text, text, text, uuid, integer, boolean, boolean);

-- scale benches
drop function if exists public.wh_scale_board(text);
drop function if exists public.wh_pack_weigh_on(uuid, uuid, integer);
drop function if exists public.wh_scale_check(uuid, integer, integer, text);
drop function if exists public.wh_save_bench(text, uuid, text, text, integer, integer, integer, boolean);

-- guards and helpers
drop function if exists public.wh_orders_w3b_single_parcel();
drop function if exists public.wh_pack_evidence_w3b_guard();
drop function if exists public.wh_order_lines_w3b_guard();
drop function if exists public.wh_orders_w3b_guard();
drop function if exists public.wh_parcel_recalc(uuid);
drop function if exists public.wh_use_pack_materials(uuid, uuid, uuid, boolean);
drop function if exists public.wh_material_void_internal(uuid, text);
drop function if exists public.wh_material_use(uuid, uuid, uuid, integer, text, text);
drop function if exists public.wh_material_post(uuid, text, integer, text, uuid, uuid, uuid);
drop function if exists public.wh_bench_assert(uuid, text, integer);

-- columns added to W3a tables (their foreign keys and indexes go with them)
alter table public.wh_override_attempts drop column if exists parcel_id;
alter table public.wh_scan_log drop column if exists parcel_id;
alter table public.wh_pack_evidence drop column if exists parcel_id;
alter table public.wh_orders drop column if exists weighed_bench_id;

-- W3b tables (children first)
drop table if exists public.wh_exceptions;
drop table if exists public.wh_material_usage;
drop table if exists public.wh_parcel_items;
drop table if exists public.wh_parcels;
drop table if exists public.wh_material_moves;
drop table if exists public.wh_materials;
drop table if exists public.wh_scale_checks;
drop table if exists public.wh_scale_benches;

drop sequence if exists public.seq_wh_exception;
