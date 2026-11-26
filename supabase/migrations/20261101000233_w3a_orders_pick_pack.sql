-- 20261101000233_w3a_orders_pick_pack.sql
-- Warehouse OS · W3a (orders in, picking, packing station with proof). Design: docs/design/warehouse-os §3 steps 7–9;
-- boards 2 (Packing station), 3 (Order detail), 4 (Packing evidence), 6 (Handheld picking), 19 (portal Orders and proof); §7 controls.
--  1. wh_orders (WO-######) + wh_order_lines: one order list for 3PL client orders (portal form, CSV; API later) and Octopus
--     Dropship store orders (Octopus-owned stock). new → allocated → picking → picked → packing → packed (W4: labelled, shipped)
--     | exception | cancelled. Dangerous goods come from item_master (battery / liquid / magnet / powder).
--  2. Allocation reserves stock per warehouse order: record_warehouse_stock_movement() accepts a warehouse order reference
--     (new nullable warehouse_stock_movements.wh_order_id, passed only by wh_* functions through the transaction-local
--     octopus.wh_order_id flag next to W2a's octopus.wh_internal). Reserve once per order + item; picks and releases may be
--     partial but never more than reserved. Routing: the client's preferred warehouse, then the default, then any other
--     active warehouse that has every line available; otherwise the order waits ('new').
--  3. Dropship: wh_import_dropship_order() turns a store order whose warehouse handoff happened (every item reserved or
--     received at the 3PL) into a warehouse order and MOVES its reservation (release on the store order, reserve on the
--     warehouse order, same transaction) so the existing Dropship consumers never pick or release it twice. Dropship's
--     own tables and functions are not changed.
--  4. Picking (handheld): scan bin + item; FIFO by lot over wh_bin_stock (owner must match); every scan posts a ledger 'pick'
--     (reserved → out) and takes the units out of the bin in the same transaction. Short pick → exception (supervisor resolves).
--  5. Packing station: scan every item, choose a box, expected weight = items (item_master.weight_g) + box tare, measured
--     weight, per-warehouse tolerance max(g, %) (default 20 g / 5 %). Out of tolerance (or unknown expected weight) needs a
--     supervisor PIN (bcrypt via pgcrypto, set by the supervisor) with a reason; 3 wrong PINs lock the override for the order
--     until a warehouse admin unlocks. Dangerous goods need the battery mark. Contents / sealed / scale photos go to the
--     private 'wh-evidence' bucket; wh_pack_evidence keeps them with retention_until (per-warehouse setting, default 90 days).
--  Writes only through wh_* security-definer functions; every state change audit-logged (entity wh_orders). Integer grams.
-- Down: supabase/migrations/down/20261101000233_w3a_orders_pick_pack.down.sql

create sequence if not exists public.seq_wh_order;
revoke all on sequence public.seq_wh_order from public, anon, authenticated;
grant all on sequence public.seq_wh_order to service_role;

-- ───────── 1. Settings and boxes (per warehouse) ─────────
create table if not exists public.wh_settings (
  warehouse_code text primary key references public.warehouses(code) on update cascade on delete restrict,
  weight_tolerance_g integer not null default 20 check (weight_tolerance_g between 0 and 5000),
  weight_tolerance_pct numeric(5,2) not null default 5 check (weight_tolerance_pct between 0 and 50),
  evidence_retention_days integer not null default 90 check (evidence_retention_days between 7 and 3650),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.wh_settings is 'Warehouse OS: packing settings per warehouse (weight tolerance max(g, %), evidence retention). No row = defaults 20 g / 5 % / 90 days. Staff only.';
alter table public.wh_settings enable row level security;
revoke all on public.wh_settings from public, anon, authenticated;
grant select (warehouse_code, weight_tolerance_g, weight_tolerance_pct, evidence_retention_days, updated_at) on public.wh_settings to authenticated;
grant all on public.wh_settings to service_role;
drop policy if exists wh_settings_read on public.wh_settings;
create policy wh_settings_read on public.wh_settings for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_boxes (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  length_mm integer check (length_mm is null or length_mm between 1 and 3000),
  width_mm integer check (width_mm is null or width_mm between 1 and 3000),
  height_mm integer check (height_mm is null or height_mm between 1 and 3000),
  tare_g integer not null check (tare_g between 0 and 50000),
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_boxes_code_per_wh unique (warehouse_code, code)
);
comment on table public.wh_boxes is 'Warehouse OS: boxes and mailers used at the packing station (tare weight in grams). Materials stock is W3b. Staff only.';
alter table public.wh_boxes enable row level security;
revoke all on public.wh_boxes from public, anon, authenticated;
grant select (id, warehouse_code, code, name, length_mm, width_mm, height_mm, tare_g, active, created_at, updated_at) on public.wh_boxes to authenticated;
grant all on public.wh_boxes to service_role;
drop policy if exists wh_boxes_read on public.wh_boxes;
create policy wh_boxes_read on public.wh_boxes for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 2. Orders ─────────
create table if not exists public.wh_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('WO-' || lpad(nextval('public.seq_wh_order')::text, 6, '0')),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  source text not null check (source in ('dropship', 'client_portal', 'client_csv', 'client_api')),
  store_order_id uuid references public.store_orders(id) on delete restrict,
  org_id uuid references public.organizations(id) on delete restrict,
  external_ref text check (external_ref is null or (btrim(external_ref) <> '' and length(external_ref) <= 64)),
  ship_name text not null check (btrim(ship_name) <> '' and length(ship_name) <= 120),
  ship_phone text check (ship_phone is null or length(ship_phone) <= 40),
  ship_address jsonb not null check (jsonb_typeof(ship_address) = 'object'),
  ship_country char(2) not null check (ship_country ~ '^[A-Z]{2}$'),
  status text not null default 'new' check (status in ('new', 'allocated', 'picking', 'picked', 'packing', 'packed', 'labelled', 'shipped', 'exception', 'cancelled')),
  has_dangerous_goods boolean not null default false,
  dg_kinds text[] not null default '{}',
  exception_reason text check (exception_reason is null or length(exception_reason) <= 600),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  box_id uuid references public.wh_boxes(id) on delete restrict,
  expected_weight_g integer check (expected_weight_g is null or expected_weight_g > 0),
  tolerance_g integer check (tolerance_g is null or tolerance_g >= 0),
  measured_weight_g integer check (measured_weight_g is null or measured_weight_g between 1 and 1000000),
  weighed_by uuid references auth.users(id) on delete set null,
  battery_mark boolean not null default false,
  override_attempts smallint not null default 0 check (override_attempts between 0 and 3),
  override_locked_at timestamptz,
  override_by uuid references auth.users(id) on delete set null,
  override_reason text check (override_reason is null or length(override_reason) <= 500),
  override_weight_g integer,
  override_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  packed_by uuid references auth.users(id) on delete set null,
  allocated_at timestamptz,
  picked_at timestamptz,
  packed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_orders_owner check (
    (source = 'dropship' and store_order_id is not null and org_id is null)
    or (source <> 'dropship' and store_order_id is null and org_id is not null)),
  constraint wh_orders_cancel_reason check (status <> 'cancelled' or nullif(btrim(coalesce(cancel_reason, '')), '') is not null),
  constraint wh_orders_exception_reason check (status <> 'exception' or nullif(btrim(coalesce(exception_reason, '')), '') is not null),
  -- a parcel closes only with a box, a weight inside tolerance (or a supervisor override for exactly that weight, with a
  -- reason) and the battery mark when it carries dangerous goods. (override_at, not override_by: a deleted staff account
  -- nulls override_by but the approval stays on record.)
  constraint wh_orders_packed_proof check (status not in ('packed', 'labelled', 'shipped') or (
    box_id is not null and measured_weight_g is not null and packed_at is not null
    and (not has_dangerous_goods or battery_mark)
    and ((expected_weight_g is not null and tolerance_g is not null and abs(measured_weight_g - expected_weight_g) <= tolerance_g)
         or (override_at is not null and override_weight_g = measured_weight_g and nullif(btrim(coalesce(override_reason, '')), '') is not null)))),
  -- two people: the supervisor who approves a weight override is never the person who weighed or closed the parcel
  constraint wh_orders_override_two_person check (override_by is null or (override_by is distinct from weighed_by and override_by is distinct from packed_by))
);
create unique index if not exists wh_orders_store_order_uidx on public.wh_orders (store_order_id) where store_order_id is not null;
create unique index if not exists wh_orders_org_ref_uidx on public.wh_orders (org_id, external_ref) where org_id is not null and external_ref is not null and status <> 'cancelled';
create index if not exists wh_orders_wh_status_idx on public.wh_orders (warehouse_code, status, created_at desc);
create index if not exists wh_orders_org_idx on public.wh_orders (org_id, created_at desc) where org_id is not null;
comment on table public.wh_orders is 'Warehouse OS: orders to pick and pack (WO-######): 3PL client orders (org_id = owner) and Octopus Dropship store orders (store_order_id; Octopus stock). Written through wh_* functions only.';
alter table public.wh_orders enable row level security;
revoke all on public.wh_orders from public, anon, authenticated;
-- clients read their own orders' customer-facing columns; weights, boxes, overrides and who did what are read by staff through
-- wh_order_detail() and by the client (proof) through wh_portal_proof()
grant select (id, code, org_id, warehouse_code, source, external_ref, ship_name, ship_phone, ship_address, ship_country, status,
  has_dangerous_goods, dg_kinds, allocated_at, picked_at, packed_at, cancelled_at, created_at, updated_at) on public.wh_orders to authenticated;
grant all on public.wh_orders to service_role;
drop policy if exists wh_orders_read on public.wh_orders;
create policy wh_orders_read on public.wh_orders for select to authenticated
  using ((org_id is not null and org_id in (select my_org_ids())) or public.wh_sees(warehouse_code));

create table if not exists public.wh_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  item_id uuid not null references public.item_master(id) on delete restrict,
  sku text not null check (btrim(sku) <> '' and length(sku) <= 64),
  barcode text check (barcode is null or length(barcode) <= 64),
  name text not null check (btrim(name) <> '' and length(name) <= 300),
  qty integer not null check (qty between 1 and 100000),
  picked_qty integer not null default 0,
  short_qty integer not null default 0,
  packed_qty integer not null default 0,
  unit_weight_g integer check (unit_weight_g is null or unit_weight_g > 0),
  created_at timestamptz not null default now(),
  constraint wh_order_lines_one_item unique (order_id, item_id),
  constraint wh_order_lines_counts check (picked_qty >= 0 and short_qty >= 0 and picked_qty + short_qty <= qty and packed_qty between 0 and picked_qty)
);
create index if not exists wh_order_lines_item_idx on public.wh_order_lines (item_id);
comment on table public.wh_order_lines is 'Warehouse OS: order lines (sku / barcode / name are snapshots used for scanning). picked + short ≤ qty; packed ≤ picked.';
alter table public.wh_order_lines enable row level security;
revoke all on public.wh_order_lines from public, anon, authenticated;
grant select (id, order_id, item_id, sku, name, qty, picked_qty, packed_qty, created_at) on public.wh_order_lines to authenticated;
grant all on public.wh_order_lines to service_role;
drop policy if exists wh_order_lines_read on public.wh_order_lines;
create policy wh_order_lines_read on public.wh_order_lines for select to authenticated
  using (exists (select 1 from public.wh_orders o where o.id = order_id));

-- ───────── 3. Pick records, scan log, evidence, overrides (staff only) ─────────
create table if not exists public.wh_pick_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  line_id uuid not null references public.wh_order_lines(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  item_id uuid not null references public.item_master(id) on delete restrict,
  lot_id uuid not null references public.wh_lots(id) on delete restrict,
  bin_id uuid not null references public.wh_bins(id) on delete restrict,
  pallet_id uuid references public.wh_pallets(id) on delete restrict,
  qty integer not null check (qty > 0),
  movement_id uuid,
  picked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wh_pick_records_order_idx on public.wh_pick_records (order_id);
create index if not exists wh_pick_records_lot_idx on public.wh_pick_records (lot_id);
comment on table public.wh_pick_records is 'Warehouse OS: which lot, bin and pallet each picked unit came from, and the ledger pick movement. Append-only; staff only.';
alter table public.wh_pick_records enable row level security;
revoke all on public.wh_pick_records from public, anon, authenticated;
grant select on public.wh_pick_records to authenticated;
grant all on public.wh_pick_records to service_role;
drop policy if exists wh_pick_records_read on public.wh_pick_records;
create policy wh_pick_records_read on public.wh_pick_records for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_scan_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  station text not null check (station in ('pick', 'pack')),
  code text not null check (length(code) <= 128),
  result text not null check (result in ('ok', 'wrong_item', 'too_many', 'unknown_bin', 'not_in_bin', 'not_fifo')),
  line_id uuid references public.wh_order_lines(id) on delete cascade,
  qty integer not null default 1 check (qty > 0),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wh_scan_log_order_idx on public.wh_scan_log (order_id, created_at);
comment on table public.wh_scan_log is 'Warehouse OS: every pick and pack scan (accepted or refused). Append-only; staff only (clients see accepted pack scans through wh_portal_proof()).';
alter table public.wh_scan_log enable row level security;
revoke all on public.wh_scan_log from public, anon, authenticated;
grant select on public.wh_scan_log to authenticated;
grant all on public.wh_scan_log to service_role;
drop policy if exists wh_scan_log_read on public.wh_scan_log;
create policy wh_scan_log_read on public.wh_scan_log for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_pack_evidence (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  kind text not null check (kind in ('contents', 'sealed', 'scale')),
  storage_path text not null unique check (storage_path ~ '^[A-Z]{2,4}-[0-9]{2}/WO-[0-9]{6,}/(contents|sealed|scale)-[0-9a-f-]{36}\.(jpg|png|webp)$'),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  retention_until timestamptz not null
);
create index if not exists wh_pack_evidence_order_idx on public.wh_pack_evidence (order_id);
create index if not exists wh_pack_evidence_retention_idx on public.wh_pack_evidence (retention_until);
comment on table public.wh_pack_evidence is 'Warehouse OS: packing photos (private bucket wh-evidence) kept until retention_until. Staff only; clients read their own through wh_portal_proof() + signed URLs.';
alter table public.wh_pack_evidence enable row level security;
revoke all on public.wh_pack_evidence from public, anon, authenticated;
grant select on public.wh_pack_evidence to authenticated;
grant all on public.wh_pack_evidence to service_role;
drop policy if exists wh_pack_evidence_read on public.wh_pack_evidence;
create policy wh_pack_evidence_read on public.wh_pack_evidence for select to authenticated using (public.wh_sees(warehouse_code));

-- PIN hashes are never readable (no grant, no policy): only the wh_* functions compare them
create table if not exists public.wh_supervisor_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_at timestamptz,
  set_at timestamptz not null default now()
);
comment on table public.wh_supervisor_pins is 'Warehouse OS: weight-override PINs (bcrypt), set by each supervisor. 10 wrong PINs in a row lock the PIN until its owner sets a new one. Not readable by anyone; functions only.';
alter table public.wh_supervisor_pins enable row level security;
revoke all on public.wh_supervisor_pins from public, anon, authenticated;
grant all on public.wh_supervisor_pins to service_role;

create table if not exists public.wh_override_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  supervisor_id uuid references auth.users(id) on delete set null,
  ok boolean not null,
  reason text check (reason is null or length(reason) <= 500),
  expected_weight_g integer,
  measured_weight_g integer,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wh_override_attempts_order_idx on public.wh_override_attempts (order_id, created_at);
comment on table public.wh_override_attempts is 'Warehouse OS: every weight-override PIN attempt (right or wrong). Append-only; staff only.';
alter table public.wh_override_attempts enable row level security;
revoke all on public.wh_override_attempts from public, anon, authenticated;
grant select on public.wh_override_attempts to authenticated;
grant all on public.wh_override_attempts to service_role;
drop policy if exists wh_override_attempts_read on public.wh_override_attempts;
create policy wh_override_attempts_read on public.wh_override_attempts for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 4. Stock ledger: warehouse order reference ─────────
-- no foreign key on purpose: movements are append-only and must outlive a purged test order
alter table public.warehouse_stock_movements add column if not exists wh_order_id uuid;
create index if not exists warehouse_stock_movements_wh_order_idx on public.warehouse_stock_movements (wh_order_id) where wh_order_id is not null;
-- reserve / release / pick need an order: a Dropship store order (i1b) or, from W3a, a warehouse order
alter table public.warehouse_stock_movements drop constraint if exists warehouse_stock_movements_order_req;
-- (NOT VALID only if order movements without either reference already exist, e.g. after a down → up in a test that
-- unwinds this migration: the down drops wh_order_id and the append-only ledger keeps the rows)
do $$
begin
  if exists (select 1 from public.warehouse_stock_movements where kind in ('reserve', 'release', 'pick') and store_order_id is null and wh_order_id is null) then
    alter table public.warehouse_stock_movements add constraint warehouse_stock_movements_order_req check (
      (kind = any (array['reserve', 'release', 'pick']) and (store_order_id is not null or wh_order_id is not null))
      or kind = any (array['inbound', 'adjust_in', 'adjust_out'])) not valid;
  else
    alter table public.warehouse_stock_movements add constraint warehouse_stock_movements_order_req check (
      (kind = any (array['reserve', 'release', 'pick']) and (store_order_id is not null or wh_order_id is not null))
      or kind = any (array['inbound', 'adjust_in', 'adjust_out']));
  end if;
end $$;

-- same signature, default and grants as W2a; adds the warehouse-order branch (reserve once; partial pick / release within it)
CREATE OR REPLACE FUNCTION public.record_warehouse_stock_movement(p_item_id uuid, p_kind text, p_qty integer, p_reason text, p_warehouse_id text DEFAULT public.default_warehouse_code(), p_store_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh text := coalesce(nullif(btrim(p_warehouse_id), ''), public.default_warehouse_code());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_internal boolean := coalesce(current_setting('octopus.wh_internal', true), '') = 'true';
  v_wo uuid;
  v_used integer;
  v_cur public.warehouse_stock;
  v_existing public.warehouse_stock_movements;
  v_res_mov public.warehouse_stock_movements;
  v_oh_delta integer;
  v_res_delta integer;
  v_mov_id uuid;
begin
  -- W3a: a warehouse order (wh_orders) is passed only by the wh_* functions, with the internal flag
  if v_internal and p_store_order_id is null then
    v_wo := nullif(current_setting('octopus.wh_order_id', true), '')::uuid;
  end if;

  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit()
             or (v_internal and is_staff())
             or (v_internal and v_wo is not null and exists (
                   select 1 from public.wh_orders o where o.id = v_wo and o.org_id is not null and public.wh_is_client_member(o.org_id)))) then
    raise exception 'FORBIDDEN: only 3PL staff or an admin may record warehouse stock movements';
  end if;

  if p_item_id is null or p_qty is null or p_qty <= 0 or v_reason is null then
    raise exception 'INVALID_MOVEMENT: item_id, positive qty, and non-empty reason are required';
  end if;

  if v_kind not in ('inbound', 'adjust_in', 'adjust_out', 'reserve', 'release', 'pick') then
    raise exception 'INVALID_MOVEMENT_KIND: %', v_kind;
  end if;

  if v_kind in ('reserve', 'release', 'pick') and p_store_order_id is null and v_wo is null then
    raise exception 'STORE_ORDER_REQUIRED: % movement requires store_order_id', v_kind;
  end if;
  if v_kind not in ('reserve', 'release', 'pick') then
    v_wo := null;
  end if;

  -- Ensure warehouse_stock row exists, then lock it FOR UPDATE
  perform set_config('octopus.allow_warehouse_stock_sync', 'true', true);
  begin
    insert into public.warehouse_stock (warehouse_id, item_id, on_hand_qty, reserved_qty)
    values (v_wh, p_item_id, 0, 0)
    on conflict (warehouse_id, item_id) do nothing;
  exception when others then
    perform set_config('octopus.allow_warehouse_stock_sync', '', true);
    raise;
  end;
  perform set_config('octopus.allow_warehouse_stock_sync', '', true);

  select * into v_cur
    from public.warehouse_stock
   where warehouse_id = v_wh and item_id = p_item_id
   for update;

  if v_wo is not null then
    -- warehouse order: one reservation per warehouse + item; picks and releases consume it, possibly in parts
    if v_kind = 'reserve' then
      select * into v_existing
        from public.warehouse_stock_movements
       where warehouse_id = v_wh and item_id = p_item_id and wh_order_id = v_wo and kind = 'reserve'
       limit 1;
      if v_existing.id is not null then
        return jsonb_build_object(
          'idempotent', true,
          'movement_id', v_existing.id,
          'warehouse_id', v_wh,
          'item_id', p_item_id,
          'on_hand_qty', v_cur.on_hand_qty,
          'reserved_qty', v_cur.reserved_qty,
          'available_qty', v_cur.on_hand_qty - v_cur.reserved_qty
        );
      end if;
    else
      select * into v_res_mov
        from public.warehouse_stock_movements
       where warehouse_id = v_wh and item_id = p_item_id and wh_order_id = v_wo and kind = 'reserve'
       limit 1;
      if v_res_mov.id is null then
        raise exception 'NO_ACTIVE_RESERVATION: no reserve movement found for warehouse order %', v_wo;
      end if;
      select coalesce(sum(qty), 0) into v_used
        from public.warehouse_stock_movements
       where warehouse_id = v_wh and item_id = p_item_id and wh_order_id = v_wo and kind in ('release', 'pick');
      if v_used + p_qty > v_res_mov.qty then
        raise exception 'RESERVATION_EXCEEDED: % of % reserved unit(s) already picked or released; % more requested', v_used, v_res_mov.qty, p_qty;
      end if;
    end if;
  else
    -- Idempotency check for order-scoped movements (reserve / release / pick)
    if p_store_order_id is not null then
      select * into v_existing
        from public.warehouse_stock_movements
       where warehouse_id = v_wh
         and item_id = p_item_id
         and store_order_id = p_store_order_id
         and kind = v_kind
       limit 1;

      if v_existing.id is not null then
        return jsonb_build_object(
          'idempotent', true,
          'movement_id', v_existing.id,
          'warehouse_id', v_wh,
          'item_id', p_item_id,
          'on_hand_qty', v_cur.on_hand_qty,
          'reserved_qty', v_cur.reserved_qty,
          'available_qty', v_cur.on_hand_qty - v_cur.reserved_qty
        );
      end if;
    end if;

    if v_kind in ('release', 'pick') then
      select * into v_res_mov
        from public.warehouse_stock_movements
       where warehouse_id = v_wh
         and item_id = p_item_id
         and store_order_id = p_store_order_id
         and kind = 'reserve'
       limit 1;

      if v_res_mov.id is null then
        raise exception 'NO_ACTIVE_RESERVATION: no reserve movement found for order %', p_store_order_id;
      end if;

      if exists (
        select 1
          from public.warehouse_stock_movements
         where warehouse_id = v_wh
           and item_id = p_item_id
           and store_order_id = p_store_order_id
           and kind in ('release', 'pick')
      ) then
        raise exception 'RESERVATION_ALREADY_CONSUMED: reservation for order % was already released or picked', p_store_order_id;
      end if;

      if p_qty <> v_res_mov.qty then
        raise exception 'RESERVATION_QTY_MISMATCH: expected reserved qty %, got %', v_res_mov.qty, p_qty;
      end if;
    end if;
  end if;

  case v_kind
    when 'inbound' then v_oh_delta := p_qty; v_res_delta := 0;
    when 'adjust_in' then v_oh_delta := p_qty; v_res_delta := 0;
    when 'adjust_out' then
      if (v_cur.on_hand_qty - v_cur.reserved_qty) < p_qty then
        raise exception 'INSUFFICIENT_AVAILABLE_STOCK: available %, requested adjust_out %', (v_cur.on_hand_qty - v_cur.reserved_qty), p_qty;
      end if;
      v_oh_delta := -p_qty; v_res_delta := 0;
    when 'reserve' then
      if (v_cur.on_hand_qty - v_cur.reserved_qty) < p_qty then
        raise exception 'INSUFFICIENT_AVAILABLE_STOCK: available %, requested reserve %', (v_cur.on_hand_qty - v_cur.reserved_qty), p_qty;
      end if;
      v_oh_delta := 0; v_res_delta := p_qty;
    when 'release' then
      v_oh_delta := 0; v_res_delta := -p_qty;
    when 'pick' then
      v_oh_delta := -p_qty; v_res_delta := -p_qty;
  end case;

  perform set_config('octopus.allow_warehouse_stock_sync', 'true', true);
  begin
    update public.warehouse_stock
       set on_hand_qty = on_hand_qty + v_oh_delta,
           reserved_qty = reserved_qty + v_res_delta,
           updated_at = now()
     where warehouse_id = v_wh and item_id = p_item_id
     returning * into v_cur;
  exception when others then
    perform set_config('octopus.allow_warehouse_stock_sync', '', true);
    raise;
  end;
  perform set_config('octopus.allow_warehouse_stock_sync', '', true);

  insert into public.warehouse_stock_movements (
    warehouse_id,
    item_id,
    kind,
    qty,
    on_hand_delta,
    reserved_delta,
    store_order_id,
    wh_order_id,
    reason,
    actor_id
  ) values (
    v_wh,
    p_item_id,
    v_kind,
    p_qty,
    v_oh_delta,
    v_res_delta,
    p_store_order_id,
    v_wo,
    v_reason,
    auth.uid()
  )
  returning id into v_mov_id;

  perform write_audit(
    'warehouse_stock.' || v_kind,
    'warehouse_stock',
    v_wh || ':' || p_item_id::text,
    jsonb_build_object(
      'movement_id', v_mov_id,
      'qty', p_qty,
      'on_hand_qty', v_cur.on_hand_qty,
      'reserved_qty', v_cur.reserved_qty,
      'store_order_id', p_store_order_id,
      'wh_order_id', v_wo,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'idempotent', false,
    'movement_id', v_mov_id,
    'warehouse_id', v_wh,
    'item_id', p_item_id,
    'on_hand_qty', v_cur.on_hand_qty,
    'reserved_qty', v_cur.reserved_qty,
    'available_qty', v_cur.on_hand_qty - v_cur.reserved_qty
  );
end $function$;

-- W2b's free units of a lot now also leave out units picked for orders (they are out of the bins and out of stock)
create or replace function public.wh_lot_free(p_lot uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select t.qty
         - coalesce((select sum(b.qty) from public.wh_bin_stock b where b.lot_id = t.id), 0)::integer
         - coalesce((select sum(p.qty) from public.wh_transfer_picks p where p.lot_id = t.id), 0)::integer
         - coalesce((select sum(k.qty) from public.wh_pick_records k where k.lot_id = t.id), 0)::integer
    from public.wh_lots t where t.id = p_lot
$$;

-- ───────── 5. Internal helpers ─────────
-- reserve / release / pick for a warehouse order through the only stock write path; actor stays auth.uid()
create or replace function public.wh_post_order_movement(p_order uuid, p_item uuid, p_kind text, p_qty integer, p_reason text, p_warehouse text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_kind not in ('reserve', 'release', 'pick') then raise exception 'INVALID_MOVEMENT_KIND: %', p_kind; end if;
  if p_order is null then raise exception 'INVALID_ORDER'; end if;
  perform set_config('octopus.wh_internal', 'true', true);
  perform set_config('octopus.wh_order_id', p_order::text, true);
  begin
    v := public.record_warehouse_stock_movement(p_item, p_kind, p_qty, p_reason, p_warehouse, null);
  exception when others then
    perform set_config('octopus.wh_internal', '', true);
    perform set_config('octopus.wh_order_id', '', true);
    raise;
  end;
  perform set_config('octopus.wh_internal', '', true);
  perform set_config('octopus.wh_order_id', '', true);
  return (v ->> 'movement_id')::uuid;
end $$;
revoke all on function public.wh_post_order_movement(uuid, uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.wh_post_order_movement(uuid, uuid, text, integer, text, text) to service_role;

-- releases what a Dropship store order reserved at payment (existing store-order path; staff caller)
create or replace function public.wh_release_store_order_reserve(p_store_order uuid, p_item uuid, p_qty integer, p_warehouse text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('octopus.wh_internal', 'true', true);
  begin
    perform public.record_warehouse_stock_movement(p_item, 'release', p_qty, p_reason, p_warehouse, p_store_order);
  exception when others then
    perform set_config('octopus.wh_internal', '', true);
    raise;
  end;
  perform set_config('octopus.wh_internal', '', true);
end $$;
revoke all on function public.wh_release_store_order_reserve(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.wh_release_store_order_reserve(uuid, uuid, integer, text, text) to service_role;

-- packing settings with defaults (20 g / 5 % / 90 days)
create or replace function public.wh_settings_for(p_warehouse text)
returns table (tolerance_g integer, tolerance_pct numeric, retention_days integer)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.weight_tolerance_g, 20), coalesce(s.weight_tolerance_pct, 5.00), coalesce(s.evidence_retention_days, 90)
    from (select 1) x left join public.wh_settings s on s.warehouse_code = p_warehouse
$$;
revoke all on function public.wh_settings_for(text) from public, anon, authenticated;
grant execute on function public.wh_settings_for(text) to service_role;

-- allowed difference in grams: the larger of the fixed grams and the percentage of the expected weight (rounded up)
create or replace function public.wh_weight_tolerance(p_expected integer, p_tol_g integer, p_tol_pct numeric)
returns integer
language sql
immutable
set search_path = public
as $$
  select case when p_expected is null then null
              else greatest(coalesce(p_tol_g, 0), ceil(p_expected * coalesce(p_tol_pct, 0) / 100.0)::integer) end
$$;
revoke all on function public.wh_weight_tolerance(integer, integer, numeric) from public, anon;
grant execute on function public.wh_weight_tolerance(integer, integer, numeric) to authenticated, service_role;

-- can a given person (not the caller) do an action at a warehouse (company admins: everywhere)
create or replace function public.wh_user_can(p_user uuid, p_action text, p_warehouse text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and (
    exists (select 1 from public.user_roles r where r.user_id = p_user and r.role_code = 'admin')
    or exists (select 1 from public.warehouse_staff s join public.wh_role_capabilities c on c.role = s.role and c.action = p_action
                where s.user_id = p_user and s.warehouse_code = p_warehouse and s.suspended_at is null))
$$;
revoke all on function public.wh_user_can(uuid, text, text) from public, anon, authenticated;
grant execute on function public.wh_user_can(uuid, text, text) to service_role;

create or replace function public.wh_dg_kinds(p_item uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_remove(array[
           case when i.has_battery then 'battery' end, case when i.has_liquid then 'liquid' end,
           case when i.has_magnet then 'magnet' end, case when i.has_powder then 'powder' end], null), '{}')
    from public.item_master i where i.id = p_item
$$;
revoke all on function public.wh_dg_kinds(uuid) from public, anon, authenticated;
grant execute on function public.wh_dg_kinds(uuid) to service_role;

create or replace function public.wh_refresh_dg(p_order uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.wh_orders o
     set dg_kinds = k.kinds, has_dangerous_goods = cardinality(k.kinds) > 0
    from (select coalesce(array_agg(distinct x order by x), '{}') kinds
            from public.wh_order_lines l cross join lateral unnest(public.wh_dg_kinds(l.item_id)) x
           where l.order_id = p_order) k
   where o.id = p_order
$$;
revoke all on function public.wh_refresh_dg(uuid) from public, anon, authenticated;
grant execute on function public.wh_refresh_dg(uuid) to service_role;

-- a Dropship order that was cancelled after it came to the warehouse is not picked or packed
create or replace function public.wh_assert_store_order_open(p_store_order uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_no text;
begin
  if p_store_order is null then return; end if;
  select order_number into v_no from public.store_orders where id = p_store_order and cancelled_at is not null;
  if v_no is not null then
    raise exception 'STORE_ORDER_CANCELLED: Dropship order % was cancelled; a supervisor cancels this warehouse order', v_no;
  end if;
end $$;
revoke all on function public.wh_assert_store_order_open(uuid) from public, anon, authenticated;
grant execute on function public.wh_assert_store_order_open(uuid) to service_role;

-- records a refused scan and returns the sentence (no exception, so the scan log row stays)
create or replace function public.wh_scan_reject(p_order uuid, p_warehouse text, p_station text, p_code text, p_result text, p_line uuid, p_qty integer, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wh_scan_log (order_id, warehouse_code, station, code, result, line_id, qty, actor_id)
  values (p_order, p_warehouse, p_station, left(coalesce(nullif(p_code, ''), '?'), 128), p_result, p_line, greatest(coalesce(p_qty, 1), 1), auth.uid());
  return jsonb_build_object('ok', false, 'result', p_result, 'message', p_message);
end $$;
revoke all on function public.wh_scan_reject(uuid, text, text, text, text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.wh_scan_reject(uuid, text, text, text, text, uuid, integer, text) to service_role;

-- ───────── 6. Allocation and routing ─────────
-- chooses the warehouse (preferred → default → others, active only) where every line is available and reserves there.
-- Dropship orders move their store-order reservation onto the warehouse order. Returns the warehouse, or NULL (waits).
create or replace function public.wh_allocate(p_order uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_pref text;
  v_wh text;
  r record;
  l public.wh_order_lines;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'new' then return o.warehouse_code; end if;
  v_pref := case when o.org_id is not null then (select c.preferred_warehouse from public.wh_clients c where c.org_id = o.org_id) else o.warehouse_code end;
  select w.code into v_wh
    from public.warehouses w
   where w.status = 'active'
     and not exists (
       select 1
         from public.wh_order_lines x
         left join public.warehouse_stock s on s.warehouse_id = w.code and s.item_id = x.item_id
        where x.order_id = o.id
          and coalesce(s.on_hand_qty - s.reserved_qty, 0)
              + case when o.store_order_id is null then 0 else coalesce((
                  select sum(m.qty)::integer from public.warehouse_stock_movements m
                   where m.store_order_id = o.store_order_id and m.warehouse_id = w.code and m.item_id = x.item_id and m.kind = 'reserve'
                     and not exists (select 1 from public.warehouse_stock_movements m2
                                      where m2.store_order_id = o.store_order_id and m2.warehouse_id = m.warehouse_id
                                        and m2.item_id = m.item_id and m2.kind in ('release', 'pick'))), 0) end
              < x.qty)
   order by (w.code = coalesce(v_pref, '')) desc, w.is_default desc, w.code
   limit 1;
  if v_wh is null then return null; end if;
  begin
    if o.store_order_id is not null then
      for r in
        select m.warehouse_id, m.item_id, m.qty
          from public.warehouse_stock_movements m
         where m.store_order_id = o.store_order_id and m.kind = 'reserve'
           and not exists (select 1 from public.warehouse_stock_movements m2
                            where m2.store_order_id = o.store_order_id and m2.warehouse_id = m.warehouse_id
                              and m2.item_id = m.item_id and m2.kind in ('release', 'pick'))
         order by m.warehouse_id, m.item_id
      loop
        perform public.wh_release_store_order_reserve(o.store_order_id, r.item_id, r.qty, r.warehouse_id, 'Moved to warehouse order ' || o.code);
      end loop;
    end if;
    for l in select * from public.wh_order_lines where order_id = o.id order by item_id loop
      perform public.wh_post_order_movement(o.id, l.item_id, 'reserve', l.qty, 'Warehouse order ' || o.code || ' allocated', v_wh);
    end loop;
  exception when others then
    -- someone took the stock between the check and the reservation: the order waits (everything above is undone)
    if sqlerrm like 'INSUFFICIENT_AVAILABLE_STOCK%' then return null; end if;
    raise;
  end;
  update public.wh_orders set warehouse_code = v_wh, status = 'allocated', allocated_at = now(), updated_at = now() where id = o.id;
  perform write_audit('wh_order.allocated', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'warehouse', v_wh));
  return v_wh;
end $$;
revoke all on function public.wh_allocate(uuid) from public, anon, authenticated;
grant execute on function public.wh_allocate(uuid) to service_role;

-- ───────── 7. Intake: 3PL client orders ─────────
-- validates one order of a client company and returns it normalised (no writes). p_order:
-- {external_ref?, warehouse?, ship: {name, phone?, line1, line2?, city, region?, postcode?, country}, lines: [{sku_id | sku, qty}]}
create or replace function public.wh_check_client_order(p_org uuid, p_order jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ship jsonb := coalesce(p_order -> 'ship', '{}'::jsonb);
  v_name text := btrim(coalesce(v_ship ->> 'name', ''));
  v_phone text := nullif(btrim(coalesce(v_ship ->> 'phone', '')), '');
  v_line1 text := btrim(coalesce(v_ship ->> 'line1', ''));
  v_line2 text := nullif(btrim(coalesce(v_ship ->> 'line2', '')), '');
  v_city text := btrim(coalesce(v_ship ->> 'city', ''));
  v_region text := nullif(btrim(coalesce(v_ship ->> 'region', '')), '');
  v_post text := nullif(upper(btrim(coalesce(v_ship ->> 'postcode', ''))), '');
  v_country text := upper(btrim(coalesce(v_ship ->> 'country', '')));
  v_ref text := nullif(btrim(coalesce(p_order ->> 'external_ref', '')), '');
  v_wh text := nullif(upper(btrim(coalesce(p_order ->> 'warehouse', ''))), '');
  v_line jsonb;
  v_qty text;
  v_sku public.wh_client_skus;
  v_seen uuid[] := '{}';
  v_lines jsonb := '[]'::jsonb;
  v_dup text;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' then raise exception 'INVALID_ORDER: the order is empty'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'INVALID_NAME: enter the customer''s name (up to 120 characters)'; end if;
  if v_phone is not null and v_phone !~ '^[0-9 +().-]{5,40}$' then raise exception 'INVALID_PHONE: a phone number has 5 to 40 digits, spaces, + ( ) . or -'; end if;
  if v_line1 = '' or length(v_line1) > 200 or length(coalesce(v_line2, '')) > 200 then raise exception 'INVALID_ADDRESS: enter the street address (up to 200 characters a line)'; end if;
  if v_city = '' or length(v_city) > 100 then raise exception 'INVALID_CITY: enter the city (up to 100 characters)'; end if;
  if length(coalesce(v_region, '')) > 100 then raise exception 'INVALID_REGION: up to 100 characters'; end if;
  if v_post is not null and v_post !~ '^[A-Z0-9][A-Z0-9 -]{1,11}$' then raise exception 'INVALID_POSTCODE: a postcode has 2 to 12 letters, digits, spaces or dashes'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'INVALID_COUNTRY: use the two-letter country code, e.g. US or DE'; end if;
  if v_ref is not null and (length(v_ref) > 64 or v_ref !~ '^[A-Za-z0-9#._/-]+$') then
    raise exception 'INVALID_REFERENCE: your order number has up to 64 letters, digits, # . _ / or -';
  end if;
  if v_ref is not null then
    select code into v_dup from public.wh_orders where org_id = p_org and external_ref = v_ref and status <> 'cancelled' limit 1;
    if v_dup is not null then raise exception 'DUPLICATE_ORDER: order % was already sent (%)', v_ref, v_dup; end if;
  end if;
  if v_wh is not null and not exists (select 1 from public.warehouses where code = v_wh and status = 'active') then
    raise exception 'INVALID_WAREHOUSE: % is not an active warehouse', v_wh;
  end if;
  if p_order -> 'lines' is null or jsonb_typeof(p_order -> 'lines') <> 'array' or jsonb_array_length(p_order -> 'lines') = 0 then
    raise exception 'NO_LINES: add at least one product';
  end if;
  if jsonb_array_length(p_order -> 'lines') > 100 then raise exception 'TOO_MANY_LINES: up to 100 products per order'; end if;
  for v_line in select * from jsonb_array_elements(p_order -> 'lines') loop
    v_qty := btrim(coalesce(v_line ->> 'qty', ''));
    if v_qty !~ '^[0-9]{1,5}$' or v_qty::integer <= 0 or v_qty::integer > 10000 then
      raise exception 'INVALID_QTY: every line needs a quantity from 1 to 10,000';
    end if;
    select * into v_sku from public.wh_client_skus k
     where k.org_id = p_org and k.status = 'active'
       and (k.id::text = coalesce(v_line ->> 'sku_id', '') or k.sku = upper(btrim(coalesce(v_line ->> 'sku', ''))))
     limit 1;
    if v_sku.id is null then
      raise exception 'UNKNOWN_SKU: % is not one of your active products', coalesce(nullif(upper(btrim(coalesce(v_line ->> 'sku', ''))), ''), 'a line');
    end if;
    if v_sku.item_id = any(v_seen) then raise exception 'DUPLICATE_LINE: % is on more than one line', v_sku.sku; end if;
    v_seen := v_seen || v_sku.item_id;
    v_lines := v_lines || jsonb_build_object('item_id', v_sku.item_id, 'sku', v_sku.sku, 'barcode', v_sku.barcode, 'name', v_sku.name,
      'qty', v_qty::integer, 'weight_g', (select i.weight_g from public.item_master i where i.id = v_sku.item_id));
  end loop;
  return jsonb_build_object(
    'external_ref', v_ref, 'warehouse', v_wh, 'ship_name', v_name, 'ship_phone', v_phone, 'ship_country', v_country,
    'ship_address', jsonb_strip_nulls(jsonb_build_object('line1', v_line1, 'line2', v_line2, 'city', v_city, 'region', v_region, 'postcode', v_post)),
    'lines', v_lines);
end $$;
revoke all on function public.wh_check_client_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wh_check_client_order(uuid, jsonb) to service_role;

-- inserts a checked client order (+ lines, dangerous goods) and tries to allocate it
create or replace function public.wh_insert_client_order(p_org uuid, p_checked jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.wh_orders;
  v_wh text;
  v_alloc text;
begin
  v_wh := coalesce(p_checked ->> 'warehouse',
                   (select c.preferred_warehouse from public.wh_clients c join public.warehouses w on w.code = c.preferred_warehouse and w.status = 'active'
                     where c.org_id = p_org),
                   public.default_warehouse_code());
  insert into public.wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_phone, ship_address, ship_country, created_by)
  values (v_wh, p_source, p_org, p_checked ->> 'external_ref', p_checked ->> 'ship_name', p_checked ->> 'ship_phone',
          p_checked -> 'ship_address', p_checked ->> 'ship_country', auth.uid())
  returning * into v_row;
  insert into public.wh_order_lines (order_id, item_id, sku, barcode, name, qty, unit_weight_g)
  select v_row.id, (x ->> 'item_id')::uuid, x ->> 'sku', x ->> 'barcode', x ->> 'name', (x ->> 'qty')::integer, (x ->> 'weight_g')::integer
    from jsonb_array_elements(p_checked -> 'lines') x;
  perform public.wh_refresh_dg(v_row.id);
  perform write_audit('wh_order.created', 'wh_orders', v_row.id::text,
    jsonb_build_object('code', v_row.code, 'source', p_source, 'org_id', p_org, 'external_ref', v_row.external_ref,
                       'lines', jsonb_array_length(p_checked -> 'lines'),
                       'units', (select sum((x ->> 'qty')::integer) from jsonb_array_elements(p_checked -> 'lines') x)));
  v_alloc := public.wh_allocate(v_row.id);
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', case when v_alloc is null then 'new' else 'allocated' end,
                            'warehouse', coalesce(v_alloc, v_wh), 'external_ref', v_row.external_ref);
end $$;
revoke all on function public.wh_insert_client_order(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.wh_insert_client_order(uuid, jsonb, text) to service_role;

-- portal: one order from the manual form
create or replace function public.wh_create_client_order(p_org uuid, p_order jsonb, p_source text default 'client_portal')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or not public.wh_is_client_member(p_org) then raise exception 'FORBIDDEN: only members of an approved 3PL client send orders'; end if;
  if p_source not in ('client_portal', 'client_csv') then raise exception 'INVALID_SOURCE'; end if;
  return public.wh_insert_client_order(p_org, public.wh_check_client_order(p_org, p_order), p_source);
end $$;
revoke all on function public.wh_create_client_order(uuid, jsonb, text) from public, anon;
grant execute on function public.wh_create_client_order(uuid, jsonb, text) to authenticated, service_role;

-- portal CSV preview: checks every parsed order (no writes); [{index, ok, error, lines, units}]
create or replace function public.wh_validate_client_orders(p_org uuid, p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_o jsonb;
  v_i integer := 0;
  v_ok jsonb;
  v_refs text[] := '{}';
  v_ref text;
begin
  if p_org is null or not public.wh_is_client_member(p_org) then raise exception 'FORBIDDEN'; end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then raise exception 'NO_ORDERS: the file has no orders'; end if;
  if jsonb_array_length(p_orders) > 200 then raise exception 'TOO_MANY_ORDERS: up to 200 orders per file'; end if;
  for v_o in select * from jsonb_array_elements(p_orders) loop
    v_i := v_i + 1;
    v_ref := nullif(btrim(coalesce(v_o ->> 'external_ref', '')), '');
    begin
      if v_ref is not null and v_ref = any(v_refs) then raise exception 'DUPLICATE_ORDER: order % is twice in this file', v_ref; end if;
      v_ok := public.wh_check_client_order(p_org, v_o);
      v_out := v_out || jsonb_build_object('index', v_i, 'ok', true, 'external_ref', v_ref, 'lines', jsonb_array_length(v_ok -> 'lines'),
        'units', (select sum((x ->> 'qty')::integer) from jsonb_array_elements(v_ok -> 'lines') x));
    exception when others then
      v_out := v_out || jsonb_build_object('index', v_i, 'ok', false, 'external_ref', v_ref, 'error', sqlerrm);
    end;
    if v_ref is not null then v_refs := v_refs || v_ref; end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.wh_validate_client_orders(uuid, jsonb) from public, anon;
grant execute on function public.wh_validate_client_orders(uuid, jsonb) to authenticated, service_role;

-- portal CSV create: all orders or none (≤ 200)
create or replace function public.wh_create_client_orders(p_org uuid, p_orders jsonb, p_source text default 'client_csv')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_o jsonb;
  v_i integer := 0;
  v_ref text;
  v_refs text[] := '{}';
begin
  if p_org is null or not public.wh_is_client_member(p_org) then raise exception 'FORBIDDEN: only members of an approved 3PL client send orders'; end if;
  if p_source not in ('client_portal', 'client_csv') then raise exception 'INVALID_SOURCE'; end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then raise exception 'NO_ORDERS: the file has no orders'; end if;
  if jsonb_array_length(p_orders) > 200 then raise exception 'TOO_MANY_ORDERS: up to 200 orders per file'; end if;
  for v_o in select * from jsonb_array_elements(p_orders) loop
    v_i := v_i + 1;
    v_ref := nullif(btrim(coalesce(v_o ->> 'external_ref', '')), '');
    begin
      if v_ref is not null and v_ref = any(v_refs) then raise exception 'DUPLICATE_ORDER: order % is twice in this file', v_ref; end if;
      v_out := v_out || public.wh_insert_client_order(p_org, public.wh_check_client_order(p_org, v_o), p_source);
    exception when others then
      raise exception 'ORDER_REFUSED: order % (%) — %', v_i, coalesce(v_ref, 'no reference'), regexp_replace(sqlerrm, '^[A-Z_]+:\s*', '');
    end;
    if v_ref is not null then v_refs := v_refs || v_ref; end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.wh_create_client_orders(uuid, jsonb, text) from public, anon;
grant execute on function public.wh_create_client_orders(uuid, jsonb, text) to authenticated, service_role;

-- staff (pick or resolve at the order's warehouse) or the owning client: try to allocate a waiting order again
create or replace function public.wh_retry_allocation(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_wh text;
begin
  select * into o from public.wh_orders where id = p_order;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.wh_can('pick', o.warehouse_code) or public.wh_can('resolve_exception', o.warehouse_code)
          or (o.org_id is not null and public.wh_is_client_member(o.org_id))) then
    raise exception 'FORBIDDEN';
  end if;
  if o.status <> 'new' then raise exception 'INVALID_STEP: % is already %', o.code, o.status; end if;
  perform public.wh_assert_store_order_open(o.store_order_id);
  v_wh := public.wh_allocate(o.id);
  if v_wh is null then
    perform write_audit('wh_order.allocation_waiting', 'wh_orders', o.id::text, jsonb_build_object('code', o.code));
  end if;
  return jsonb_build_object('code', o.code, 'allocated', v_wh is not null, 'warehouse', v_wh);
end $$;
revoke all on function public.wh_retry_allocation(uuid) from public, anon;
grant execute on function public.wh_retry_allocation(uuid) to authenticated, service_role;

-- ───────── 8. Intake: Octopus Dropship store orders ─────────
-- a store order is ready for the warehouse when every item has a warehouse pick/pack handoff (reserved, or received from
-- sourcing → ready_to_pick) and no supplier purchase is still open
create or replace function public.wh_dropship_is_ready(p_store_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.store_orders so where so.id = p_store_order and so.cancelled_at is null)
     and exists (select 1 from public.store_order_items i where i.store_order_id = p_store_order)
     and not exists (
       select 1 from public.store_order_items i
        where i.store_order_id = p_store_order
          and not exists (select 1 from public.dropship_handoffs h
                           where h.store_order_id = p_store_order and h.handoff_type = 'warehouse_pick_pack'
                             and h.store_order_item_id = i.id and h.status in ('reserved', 'ready_to_pick')))
     and not exists (select 1 from public.dropship_handoffs h
                      where h.store_order_id = p_store_order and h.handoff_type = 'sourcing_procurement'
                        and h.status not in ('received_at_3pl', 'cancelled'))
$$;
revoke all on function public.wh_dropship_is_ready(uuid) from public, anon, authenticated;
grant execute on function public.wh_dropship_is_ready(uuid) to service_role;

create or replace function public.wh_import_dropship_order(p_store_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders;
  v_row public.wh_orders;
  v_wh text;
  v_alloc text;
begin
  if not (auth.uid() is not null and public.wh_can_any('pick')) then raise exception 'FORBIDDEN: packers, supervisors and admins bring orders in'; end if;
  select * into so from public.store_orders where id = p_store_order for update;
  if so.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_row from public.wh_orders where store_order_id = so.id;
  if v_row.id is not null then
    return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status, 'warehouse', v_row.warehouse_code, 'existing', true);
  end if;
  if so.cancelled_at is not null then raise exception 'STORE_ORDER_CANCELLED: % was cancelled', so.order_number; end if;
  if not public.wh_dropship_is_ready(so.id) then
    raise exception 'NOT_READY: % is not with the warehouse yet (every item must be reserved or received from sourcing)', so.order_number;
  end if;
  v_wh := coalesce((select h.warehouse_id from public.dropship_handoffs h join public.warehouses w on w.code = h.warehouse_id and w.status = 'active'
                     where h.store_order_id = so.id and h.handoff_type = 'warehouse_pick_pack' order by h.created_at limit 1),
                   public.default_warehouse_code());
  insert into public.wh_orders (warehouse_code, source, store_order_id, ship_name, ship_phone, ship_address, ship_country, created_by)
  values (v_wh, 'dropship', so.id, left(btrim(so.buyer_name), 120), left(nullif(btrim(coalesce(so.buyer_phone, '')), ''), 40), so.shipping_address, so.destination_country, auth.uid())
  returning * into v_row;
  insert into public.wh_order_lines (order_id, item_id, sku, name, qty, unit_weight_g)
  select v_row.id, i.item_id, left(min(i.model_no), 64),
         left(min(i.title_snapshot || coalesce(' · ' || nullif(btrim(i.variant_label), ''), '')), 300), sum(i.qty)::integer,
         (select m.weight_g from public.item_master m where m.id = i.item_id)
    from public.store_order_items i
   where i.store_order_id = so.id
   group by i.item_id;
  perform public.wh_refresh_dg(v_row.id);
  perform write_audit('wh_order.created', 'wh_orders', v_row.id::text,
    jsonb_build_object('code', v_row.code, 'source', 'dropship', 'store_order', so.order_number, 'store_order_id', so.id));
  v_alloc := public.wh_allocate(v_row.id);
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', case when v_alloc is null then 'new' else 'allocated' end,
                            'warehouse', coalesce(v_alloc, v_wh), 'existing', false, 'store_order', so.order_number);
end $$;
revoke all on function public.wh_import_dropship_order(uuid) from public, anon;
grant execute on function public.wh_import_dropship_order(uuid) to authenticated, service_role;

-- ───────── 9. Picking (board 6) ─────────
create or replace function public.wh_start_pick(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pick', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status = 'picking' then return; end if;
  if o.status <> 'allocated' then raise exception 'INVALID_STEP: % is %, not ready to pick', o.code, o.status; end if;
  perform public.wh_assert_store_order_open(o.store_order_id);
  update public.wh_orders set status = 'picking', updated_at = now() where id = o.id;
  perform write_audit('wh_order.picking', 'wh_orders', o.id::text, jsonb_build_object('code', o.code));
end $$;
revoke all on function public.wh_start_pick(uuid) from public, anon;
grant execute on function public.wh_start_pick(uuid) to authenticated, service_role;

-- one scan of bin + item (+ quantity): FIFO by lot over the bins of this warehouse, owner must match. The ledger pick
-- (reserved → out) and the bin take happen in this transaction. Refused scans are logged and returned, not raised.
create or replace function public.wh_pick_scan(p_order uuid, p_bin text, p_code text, p_qty integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  l public.wh_order_lines;
  b public.wh_bins;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_bin text := upper(btrim(coalesce(p_bin, '')));
  v_qty integer := coalesce(p_qty, 1);
  v_old_lot_id uuid;
  v_old_lot text;
  v_old_bin text;
  v_in_bin integer;
  v_mov uuid;
  r record;
  v_left integer;
  v_take integer;
  v_taken jsonb := '[]'::jsonb;
  v_done boolean;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pick', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('allocated', 'picking') then raise exception 'INVALID_STEP: % is %, not ready to pick', o.code, o.status; end if;
  perform public.wh_assert_store_order_open(o.store_order_id);
  if v_qty < 1 or v_qty > 10000 then raise exception 'INVALID_QTY: pick 1 to 10,000 units at a time'; end if;
  if v_code = '' then raise exception 'SCAN_ITEM: scan or type the product'; end if;
  if v_bin = '' then raise exception 'SCAN_BIN: scan or type the bin'; end if;

  select * into l from public.wh_order_lines
   where order_id = o.id and (upper(sku) = v_code or upper(coalesce(barcode, '')) = v_code)
   order by (picked_qty + short_qty < qty) desc, id limit 1;
  if l.id is null then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pick', v_code, 'wrong_item', null, v_qty, format('%s is not on order %s', v_code, o.code));
  end if;
  if l.picked_qty + l.short_qty + v_qty > l.qty then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pick', v_code, 'too_many', l.id, v_qty,
      format('Only %s more of %s needed', l.qty - l.picked_qty - l.short_qty, l.sku));
  end if;
  select * into b from public.wh_bins where warehouse_code = o.warehouse_code and code = v_bin;
  if b.id is null then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pick', v_bin, 'unknown_bin', l.id, v_qty, format('There is no bin %s at %s', v_bin, o.warehouse_code));
  end if;

  -- the oldest lot of this owner's units in any bin here (FIFO)
  select t.id, t.lot_code, n.code into v_old_lot_id, v_old_lot, v_old_bin
    from public.wh_bin_stock s join public.wh_lots t on t.id = s.lot_id join public.wh_bins n on n.id = s.bin_id
   where s.warehouse_code = o.warehouse_code and s.item_id = l.item_id and t.org_id is not distinct from o.org_id and t.status = 'released'
   order by t.created_at, t.lot_code, (s.pallet_id is not null), n.code
   limit 1;
  if v_old_lot is null then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pick', v_bin, 'not_in_bin', l.id, v_qty,
      format('No %s is in a bin at %s; it must be put away first', l.sku, o.warehouse_code));
  end if;
  select coalesce(sum(s.qty), 0)::integer into v_in_bin
    from public.wh_bin_stock s join public.wh_lots t on t.id = s.lot_id
   where s.bin_id = b.id and s.item_id = l.item_id and t.org_id is not distinct from o.org_id and t.status = 'released';
  if v_in_bin = 0 then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pick', v_bin, 'not_in_bin', l.id, v_qty,
      format('%s holds no %s; take it from %s', v_bin, l.sku, v_old_bin));
  end if;
  -- FIFO: the scanned bin must hold the oldest lot (by receipt time, then lot number)
  if not exists (select 1 from public.wh_bin_stock s where s.bin_id = b.id and s.lot_id = v_old_lot_id) then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pick', v_bin, 'not_fifo', l.id, v_qty,
      format('Take %s from %s first (%s is older)', l.sku, v_old_bin, v_old_lot));
  end if;
  if v_in_bin < v_qty then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pick', v_bin, 'not_in_bin', l.id, v_qty,
      format('%s holds only %s of %s; pick %s here, then scan the next bin', v_bin, v_in_bin, l.sku, v_in_bin));
  end if;

  -- ledger first (reserved → out; never more than reserved), then the units leave the bin (deferred on-hand check passes)
  v_mov := public.wh_post_order_movement(o.id, l.item_id, 'pick', v_qty, format('Order %s picked from %s', o.code, v_bin), o.warehouse_code);
  v_left := v_qty;
  for r in
    select s.id, s.lot_id, s.pallet_id, s.qty
      from public.wh_bin_stock s join public.wh_lots t on t.id = s.lot_id
     where s.bin_id = b.id and s.item_id = l.item_id and t.org_id is not distinct from o.org_id and t.status = 'released'
     order by t.created_at, t.lot_code, (s.pallet_id is not null), s.id
     for update of s
  loop
    exit when v_left = 0;
    v_take := least(v_left, r.qty);
    if v_take = r.qty then delete from public.wh_bin_stock where id = r.id;
    else update public.wh_bin_stock set qty = qty - v_take, updated_at = now() where id = r.id; end if;
    if r.pallet_id is not null and not exists (select 1 from public.wh_bin_stock where pallet_id = r.pallet_id) then
      update public.wh_pallets set status = 'broken', bin_id = null, updated_at = now() where id = r.pallet_id;
    end if;
    insert into public.wh_pick_records (order_id, line_id, warehouse_code, item_id, lot_id, bin_id, pallet_id, qty, movement_id, picked_by)
    values (o.id, l.id, o.warehouse_code, l.item_id, r.lot_id, b.id, r.pallet_id, v_take, v_mov, auth.uid());
    v_taken := v_taken || jsonb_build_object('lot_id', r.lot_id, 'pallet_id', r.pallet_id, 'qty', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'NOT_ENOUGH_IN_BIN: % changed while picking; scan again', v_bin; end if;

  update public.wh_order_lines set picked_qty = picked_qty + v_qty where id = l.id;
  insert into public.wh_scan_log (order_id, warehouse_code, station, code, result, line_id, qty, actor_id)
  values (o.id, o.warehouse_code, 'pick', v_code, 'ok', l.id, v_qty, auth.uid());
  v_done := not exists (select 1 from public.wh_order_lines where order_id = o.id and picked_qty + short_qty < qty);
  update public.wh_orders
     set status = case when v_done then 'picked' else 'picking' end,
         picked_at = case when v_done then now() else picked_at end, updated_at = now()
   where id = o.id;
  perform write_audit('wh_order.pick_recorded', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'bin', v_bin, 'sku', l.sku, 'qty', v_qty, 'movement_id', v_mov, 'taken', v_taken));
  if v_done then perform write_audit('wh_order.picked', 'wh_orders', o.id::text, jsonb_build_object('code', o.code)); end if;
  return jsonb_build_object('ok', true, 'result', 'ok', 'sku', l.sku, 'line_left', l.qty - l.picked_qty - l.short_qty - v_qty,
                            'status', case when v_done then 'picked' else 'picking' end,
                            'message', format('%s × %s picked from %s', v_qty, l.sku, v_bin));
end $$;
revoke all on function public.wh_pick_scan(uuid, text, text, integer) from public, anon;
grant execute on function public.wh_pick_scan(uuid, text, text, integer) to authenticated, service_role;

-- the picker can't find the rest of a line: the order stops (exception) until a supervisor decides
create or replace function public.wh_report_short(p_order uuid, p_line uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  l public.wh_order_lines;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pick', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('allocated', 'picking') then raise exception 'INVALID_STEP: % is %', o.code, o.status; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: say what you found (empty bin, damaged …)'; end if;
  select * into l from public.wh_order_lines where id = p_line and order_id = o.id for update;
  if l.id is null then raise exception 'NOT_FOUND'; end if;
  if l.picked_qty + l.short_qty >= l.qty then raise exception 'LINE_COMPLETE: nothing is missing on this line'; end if;
  update public.wh_order_lines set short_qty = qty - picked_qty where id = l.id;
  update public.wh_orders
     set status = 'exception', updated_at = now(),
         exception_reason = left(format('Short pick: %s — %s of %s missing. %s', l.sku, l.qty - l.picked_qty, l.qty, v_reason), 600)
   where id = o.id;
  perform write_audit('wh_order.short_pick', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'sku', l.sku, 'missing', l.qty - l.picked_qty, 'reason', v_reason));
end $$;
revoke all on function public.wh_report_short(uuid, uuid, text) from public, anon;
grant execute on function public.wh_report_short(uuid, uuid, text) to authenticated, service_role;

-- supervisor: retry (pick again), ship_short (release the missing units, pack what was picked) or cancel (nothing picked)
create or replace function public.wh_resolve_exception(p_order uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  l public.wh_order_lines;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_picked integer;
  v_status text;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('resolve_exception', o.warehouse_code) then raise exception 'FORBIDDEN: a supervisor resolves exceptions'; end if;
  if o.status <> 'exception' then raise exception 'INVALID_STEP: % is not an exception', o.code; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter the resolution'; end if;
  select coalesce(sum(picked_qty), 0)::integer into v_picked from public.wh_order_lines where order_id = o.id;
  if p_action = 'retry' then
    update public.wh_order_lines set short_qty = 0 where order_id = o.id;
    v_status := case when v_picked > 0 then 'picking' else 'allocated' end;
    update public.wh_orders set status = v_status, exception_reason = null, updated_at = now() where id = o.id;
  elsif p_action = 'ship_short' then
    if v_picked = 0 then raise exception 'NOTHING_PICKED: nothing was picked; cancel the order instead'; end if;
    for l in select * from public.wh_order_lines where order_id = o.id and short_qty > 0 order by item_id loop
      perform public.wh_post_order_movement(o.id, l.item_id, 'release', l.short_qty, format('Order %s short: %s', o.code, v_reason), o.warehouse_code);
    end loop;
    v_status := 'picked';
    update public.wh_orders set status = 'picked', picked_at = now(), exception_reason = null, updated_at = now() where id = o.id;
  elsif p_action = 'cancel' then
    if v_picked > 0 then raise exception 'UNITS_PICKED: % unit(s) are already picked; pack and ship short, or return them to a bin first', v_picked; end if;
    if o.allocated_at is not null then
      for l in select * from public.wh_order_lines where order_id = o.id order by item_id loop
        perform public.wh_post_order_movement(o.id, l.item_id, 'release', l.qty, format('Order %s cancelled: %s', o.code, v_reason), o.warehouse_code);
      end loop;
    end if;
    v_status := 'cancelled';
    update public.wh_orders set status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(), exception_reason = null, updated_at = now() where id = o.id;
  else
    raise exception 'INVALID_ACTION';
  end if;
  perform write_audit('wh_order.exception_resolved', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'action', p_action, 'reason', v_reason, 'was', o.exception_reason, 'status', v_status));
  return jsonb_build_object('code', o.code, 'status', v_status);
end $$;
revoke all on function public.wh_resolve_exception(uuid, text, text) from public, anon;
grant execute on function public.wh_resolve_exception(uuid, text, text) to authenticated, service_role;

-- cancel before anything is picked: the owning client (new / allocated) or a supervisor; reservations are released
create or replace function public.wh_cancel_order(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  l public.wh_order_lines;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_client boolean;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  v_client := o.org_id is not null and public.wh_is_client_member(o.org_id);
  if not (v_client or public.wh_can('resolve_exception', o.warehouse_code)) then raise exception 'FORBIDDEN'; end if;
  if v_client and not public.wh_can('resolve_exception', o.warehouse_code) and o.status not in ('new', 'allocated') then
    raise exception 'ORDER_LOCKED: picking has started; contact support to stop this order';
  end if;
  if o.status not in ('new', 'allocated', 'picking') then raise exception 'ORDER_LOCKED: % is %', o.code, o.status; end if;
  if exists (select 1 from public.wh_order_lines where order_id = o.id and picked_qty > 0) then
    raise exception 'UNITS_PICKED: units are already picked; a supervisor resolves this order';
  end if;
  if v_reason is null then v_reason := case when v_client then 'Cancelled by the client' end; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the order is cancelled'; end if;
  if o.allocated_at is not null then
    for l in select * from public.wh_order_lines where order_id = o.id order by item_id loop
      perform public.wh_post_order_movement(o.id, l.item_id, 'release', l.qty, format('Order %s cancelled: %s', o.code, v_reason), o.warehouse_code);
    end loop;
  end if;
  update public.wh_orders set status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(), updated_at = now() where id = o.id;
  perform write_audit('wh_order.cancelled', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'from', o.status, 'reason', v_reason, 'by_client', v_client));
end $$;
revoke all on function public.wh_cancel_order(uuid, text) from public, anon;
grant execute on function public.wh_cancel_order(uuid, text) to authenticated, service_role;

-- ───────── 10. Packing station (board 2) ─────────
create or replace function public.wh_pack_scan(p_order uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  l public.wh_order_lines;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_all boolean;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not ready to pack', o.code, o.status; end if;
  perform public.wh_assert_store_order_open(o.store_order_id);
  if v_code = '' then raise exception 'SCAN_ITEM: scan or type the product'; end if;
  select * into l from public.wh_order_lines
   where order_id = o.id and (upper(sku) = v_code or upper(coalesce(barcode, '')) = v_code)
   order by (packed_qty < picked_qty) desc, id limit 1;
  if l.id is null then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pack', v_code, 'wrong_item', null, 1, format('%s is not in order %s — keep it out of the box', v_code, o.code));
  end if;
  if l.packed_qty >= l.picked_qty then
    return public.wh_scan_reject(o.id, o.warehouse_code, 'pack', v_code, 'too_many', l.id, 1, format('All %s of %s are already scanned', l.picked_qty, l.sku));
  end if;
  update public.wh_order_lines set packed_qty = packed_qty + 1 where id = l.id;
  insert into public.wh_scan_log (order_id, warehouse_code, station, code, result, line_id, qty, actor_id)
  values (o.id, o.warehouse_code, 'pack', v_code, 'ok', l.id, 1, auth.uid());
  if o.status = 'picked' then
    update public.wh_orders set status = 'packing', updated_at = now() where id = o.id;
    perform write_audit('wh_order.packing', 'wh_orders', o.id::text, jsonb_build_object('code', o.code));
  end if;
  v_all := not exists (select 1 from public.wh_order_lines where order_id = o.id and packed_qty < picked_qty);
  return jsonb_build_object('ok', true, 'result', 'ok', 'sku', l.sku, 'packed', l.packed_qty + 1, 'of', l.picked_qty, 'all_scanned', v_all,
                            'message', format('%s scanned (%s of %s)', l.sku, l.packed_qty + 1, l.picked_qty));
end $$;
revoke all on function public.wh_pack_scan(uuid, text) from public, anon;
grant execute on function public.wh_pack_scan(uuid, text) to authenticated, service_role;

-- box → expected weight (items + tare) and tolerance; unknown item weight leaves the expected weight empty (override needed)
create or replace function public.wh_pack_set_box(p_order uuid, p_box uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  b public.wh_boxes;
  v_items integer;
  v_unknown boolean;
  v_expected integer;
  v_tol integer;
  st record;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not being packed', o.code, o.status; end if;
  select * into b from public.wh_boxes where id = p_box;
  if b.id is null or b.warehouse_code <> o.warehouse_code then raise exception 'INVALID_BOX: choose a box used at %', o.warehouse_code; end if;
  if not b.active then raise exception 'INVALID_BOX: % is not in use', b.name; end if;
  select bool_or(unit_weight_g is null), coalesce(sum(picked_qty * unit_weight_g), 0)::integer
    into v_unknown, v_items from public.wh_order_lines where order_id = o.id and picked_qty > 0;
  v_expected := case when coalesce(v_unknown, true) then null else v_items + b.tare_g end;
  select * into st from public.wh_settings_for(o.warehouse_code);
  v_tol := public.wh_weight_tolerance(v_expected, st.tolerance_g, st.tolerance_pct);
  update public.wh_orders
     set box_id = b.id, expected_weight_g = v_expected, tolerance_g = v_tol,
         measured_weight_g = null, weighed_by = null, override_by = null, override_reason = null, override_weight_g = null, override_at = null,
         status = case when status = 'picked' then 'packing' else status end, updated_at = now()
   where id = o.id;
  perform write_audit('wh_order.box_chosen', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'box', b.code, 'tare_g', b.tare_g, 'expected_g', v_expected, 'tolerance_g', v_tol));
  return jsonb_build_object('box', b.code, 'expected_g', v_expected, 'tolerance_g', v_tol, 'unknown_weight', v_expected is null);
end $$;
revoke all on function public.wh_pack_set_box(uuid, uuid) from public, anon;
grant execute on function public.wh_pack_set_box(uuid, uuid) to authenticated, service_role;

-- the scale reading (entered; scale integration later). A new reading voids an earlier override.
create or replace function public.wh_pack_weigh(p_order uuid, p_grams integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_within boolean;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not being packed', o.code, o.status; end if;
  if o.box_id is null then raise exception 'BOX_REQUIRED: choose the box first'; end if;
  if p_grams is null or p_grams < 1 or p_grams > 1000000 then raise exception 'INVALID_WEIGHT: enter the scale reading in grams'; end if;
  v_within := case when o.expected_weight_g is null then null else abs(p_grams - o.expected_weight_g) <= o.tolerance_g end;
  update public.wh_orders
     set measured_weight_g = p_grams, weighed_by = auth.uid(), updated_at = now(),
         -- an approval survives a re-weigh only for the same grams and only when the approver is not the new weigher
         override_by = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_by end,
         override_reason = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_reason end,
         override_at = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_at end,
         override_weight_g = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_weight_g end
   where id = o.id;
  perform write_audit('wh_order.weighed', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'measured_g', p_grams, 'expected_g', o.expected_weight_g, 'tolerance_g', o.tolerance_g, 'within', v_within));
  return jsonb_build_object('measured_g', p_grams, 'expected_g', o.expected_weight_g, 'tolerance_g', o.tolerance_g, 'within', v_within,
                            'difference_g', case when o.expected_weight_g is null then null else p_grams - o.expected_weight_g end);
end $$;
revoke all on function public.wh_pack_weigh(uuid, integer) from public, anon;
grant execute on function public.wh_pack_weigh(uuid, integer) to authenticated, service_role;

-- a supervisor sets (or changes) their own override PIN: 4–8 digits, not one repeated digit or a straight run
create or replace function public.wh_set_my_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pin text := btrim(coalesce(p_pin, ''));
begin
  if auth.uid() is null or not public.wh_can_any('approve_override') then
    raise exception 'FORBIDDEN: only supervisors and admins set an override PIN';
  end if;
  if v_pin !~ '^[0-9]{4,8}$' then raise exception 'INVALID_PIN: use 4 to 8 digits'; end if;
  if v_pin ~ '^(.)\1*$' or position(v_pin in '0123456789') > 0 or position(v_pin in '9876543210') > 0 then
    raise exception 'WEAK_PIN: avoid one repeated digit or a straight run like 1234';
  end if;
  insert into public.wh_supervisor_pins (user_id, pin_hash, failed_count, locked_at, set_at)
  values (auth.uid(), extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), 0, null, now())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, failed_count = 0, locked_at = null, set_at = now();
  perform write_audit('wh_override.pin_set', 'wh_supervisor_pins', auth.uid()::text, null);
end $$;
revoke all on function public.wh_set_my_pin(text) from public, anon;
grant execute on function public.wh_set_my_pin(text) to authenticated, service_role;

-- weight outside tolerance (or unknown): a supervisor with approve_override at the warehouse enters their PIN and a reason
-- at the station. A wrong PIN is recorded (not raised); the 3rd wrong PIN locks the override for this order.
create or replace function public.wh_weight_override(p_order uuid, p_supervisor uuid, p_pin text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  p public.wh_supervisor_pins;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ok boolean;
  v_attempts integer;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.wh_can('pack', o.warehouse_code) or public.wh_can('approve_override', o.warehouse_code)) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not being packed', o.code, o.status; end if;
  if o.measured_weight_g is null then raise exception 'WEIGH_FIRST: weigh the parcel first'; end if;
  if o.expected_weight_g is not null and abs(o.measured_weight_g - o.expected_weight_g) <= o.tolerance_g then
    raise exception 'NO_OVERRIDE_NEEDED: the weight is inside tolerance';
  end if;
  if o.override_locked_at is not null then raise exception 'OVERRIDE_LOCKED: three wrong PINs; a warehouse admin must unlock the override'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'REASON_REQUIRED: enter why this weight is accepted'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: up to 500 characters'; end if;
  if not public.wh_user_can(p_supervisor, 'approve_override', o.warehouse_code) then
    raise exception 'SUPERVISOR_REQUIRED: choose a supervisor or admin of %; packers cannot approve overrides', o.warehouse_code;
  end if;
  if p_supervisor = o.weighed_by or exists (select 1 from public.wh_scan_log s
                                              where s.order_id = o.id and s.station = 'pack' and s.result = 'ok' and s.actor_id = p_supervisor) then
    raise exception 'TWO_PERSON_REQUIRED: the supervisor who approves must not be the person who packed or weighed this parcel';
  end if;
  select * into p from public.wh_supervisor_pins where user_id = p_supervisor for update;
  if p.user_id is null then raise exception 'NO_PIN: this supervisor has not set an override PIN yet'; end if;
  if p.locked_at is not null then raise exception 'PIN_LOCKED: this PIN is locked after too many wrong tries; its owner sets a new one'; end if;
  v_ok := p.pin_hash = extensions.crypt(btrim(coalesce(p_pin, '')), p.pin_hash);
  insert into public.wh_override_attempts (order_id, warehouse_code, supervisor_id, ok, reason, expected_weight_g, measured_weight_g, actor_id)
  values (o.id, o.warehouse_code, p_supervisor, v_ok, v_reason, o.expected_weight_g, o.measured_weight_g, auth.uid());
  if not v_ok then
    v_attempts := o.override_attempts + 1;
    update public.wh_orders
       set override_attempts = v_attempts, override_locked_at = case when v_attempts >= 3 then now() end, updated_at = now()
     where id = o.id;
    update public.wh_supervisor_pins
       set failed_count = failed_count + 1, locked_at = case when failed_count + 1 >= 10 then now() end
     where user_id = p_supervisor;
    perform write_audit('wh_override.pin_wrong', 'wh_orders', o.id::text,
      jsonb_build_object('code', o.code, 'supervisor', p_supervisor, 'attempt', v_attempts));
    if v_attempts >= 3 then
      perform write_audit('wh_override.locked', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'supervisor', p_supervisor));
    end if;
    return jsonb_build_object('ok', false, 'attempts_left', greatest(3 - v_attempts, 0), 'locked', v_attempts >= 3,
      'message', case when v_attempts >= 3 then 'Wrong PIN. The override is locked; a warehouse admin must unlock it.'
                      else format('Wrong PIN. %s attempt(s) left.', 3 - v_attempts) end);
  end if;
  update public.wh_supervisor_pins set failed_count = 0 where user_id = p_supervisor;
  update public.wh_orders
     set override_by = p_supervisor, override_reason = v_reason, override_weight_g = o.measured_weight_g, override_at = now(), updated_at = now()
   where id = o.id;
  perform write_audit('wh_override.approved', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'supervisor', p_supervisor, 'reason', v_reason, 'expected_g', o.expected_weight_g, 'measured_g', o.measured_weight_g));
  return jsonb_build_object('ok', true, 'message', 'Override approved. You can close the parcel.');
end $$;
revoke all on function public.wh_weight_override(uuid, uuid, text, text) from public, anon;
grant execute on function public.wh_weight_override(uuid, uuid, text, text) to authenticated, service_role;

-- a warehouse admin (or company admin) unlocks a locked override
create or replace function public.wh_unlock_override(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.wh_role(o.warehouse_code) = 'admin' and staff_aal_ok()) then raise exception 'FORBIDDEN: a warehouse admin unlocks overrides'; end if;
  if o.override_locked_at is null then raise exception 'NOT_LOCKED: the override is not locked'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the override is unlocked'; end if;
  update public.wh_orders set override_attempts = 0, override_locked_at = null, updated_at = now() where id = o.id;
  perform write_audit('wh_override.unlocked', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'reason', v_reason));
end $$;
revoke all on function public.wh_unlock_override(uuid, text) from public, anon;
grant execute on function public.wh_unlock_override(uuid, text) to authenticated, service_role;

-- packing photo already uploaded to the private bucket (path <WH>/<WO-code>/<kind>-<uuid>.<ext>)
create or replace function public.wh_add_evidence(p_order uuid, p_kind text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  st record;
  v_row public.wh_pack_evidence;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: photos are added while the parcel is packed'; end if;
  if p_kind not in ('contents', 'sealed', 'scale') then raise exception 'INVALID_KIND'; end if;
  if p_path is null or p_path !~ ('^' || o.warehouse_code || '/' || o.code || '/' || p_kind || '-[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'INVALID_PATH: upload the photo for this order first';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'wh-evidence' and name = p_path) then
    raise exception 'NOT_UPLOADED: the photo did not arrive; take it again';
  end if;
  if (select count(*) from public.wh_pack_evidence where order_id = o.id) >= 12 then raise exception 'TOO_MANY_PHOTOS: up to 12 photos per order'; end if;
  select * into st from public.wh_settings_for(o.warehouse_code);
  insert into public.wh_pack_evidence (order_id, warehouse_code, kind, storage_path, uploaded_by, retention_until)
  values (o.id, o.warehouse_code, p_kind, p_path, auth.uid(), now() + make_interval(days => st.retention_days))
  on conflict (storage_path) do nothing
  returning * into v_row;
  if v_row.id is null then select * into v_row from public.wh_pack_evidence where storage_path = p_path; end if;
  perform write_audit('wh_order.evidence_added', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'kind', p_kind, 'path', p_path, 'retention_until', v_row.retention_until));
  return jsonb_build_object('id', v_row.id, 'kind', v_row.kind, 'retention_until', v_row.retention_until);
end $$;
revoke all on function public.wh_add_evidence(uuid, text, text) from public, anon;
grant execute on function public.wh_add_evidence(uuid, text, text) to authenticated, service_role;

-- close the parcel: every picked unit scanned, box, weight inside tolerance or overridden, battery mark for dangerous goods,
-- contents + sealed + scale photos
create or replace function public.wh_pack_close(p_order uuid, p_battery_mark boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_missing text[];
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not being packed', o.code, o.status; end if;
  perform public.wh_assert_store_order_open(o.store_order_id);
  if not exists (select 1 from public.wh_order_lines where order_id = o.id and picked_qty > 0) then raise exception 'NOTHING_PICKED'; end if;
  if exists (select 1 from public.wh_order_lines where order_id = o.id and packed_qty < picked_qty) then
    raise exception 'NOT_ALL_SCANNED: scan every item into the box first';
  end if;
  if o.box_id is null then raise exception 'BOX_REQUIRED: choose the box first'; end if;
  if o.measured_weight_g is null then raise exception 'WEIGH_FIRST: weigh the parcel first'; end if;
  if o.has_dangerous_goods and not coalesce(p_battery_mark, false) then
    raise exception 'BATTERY_MARK_REQUIRED: this parcel has dangerous goods (%); apply the battery mark and tick it', array_to_string(o.dg_kinds, ', ');
  end if;
  select array_agg(k) into v_missing from unnest(array['contents', 'sealed', 'scale']) k
   where not exists (select 1 from public.wh_pack_evidence e where e.order_id = o.id and e.kind = k);
  if v_missing is not null then raise exception 'EVIDENCE_REQUIRED: add the % photo(s)', array_to_string(v_missing, ', '); end if;
  if not ((o.expected_weight_g is not null and abs(o.measured_weight_g - o.expected_weight_g) <= o.tolerance_g)
          or (o.override_at is not null and o.override_weight_g = o.measured_weight_g)) then
    if o.expected_weight_g is null then
      raise exception 'WEIGHT_UNKNOWN: the expected weight is unknown (a product has no weight); a supervisor approves with a PIN';
    end if;
    raise exception 'WEIGHT_OUT_OF_TOLERANCE: % g measured, % g expected (± % g); a supervisor approves with a PIN',
      o.measured_weight_g, o.expected_weight_g, o.tolerance_g;
  end if;
  if o.override_by = auth.uid() then
    raise exception 'TWO_PERSON_REQUIRED: you approved this weight; another person closes the parcel';
  end if;
  update public.wh_orders
     set status = 'packed', packed_at = now(), packed_by = auth.uid(), battery_mark = coalesce(p_battery_mark, false), updated_at = now()
   where id = o.id;
  perform write_audit('wh_order.packed', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'measured_g', o.measured_weight_g, 'expected_g', o.expected_weight_g, 'tolerance_g', o.tolerance_g,
                       'override', o.override_at is not null, 'battery_mark', coalesce(p_battery_mark, false)));
  return jsonb_build_object('code', o.code, 'status', 'packed');
end $$;
revoke all on function public.wh_pack_close(uuid, boolean) from public, anon;
grant execute on function public.wh_pack_close(uuid, boolean) to authenticated, service_role;

-- ───────── 11. Settings and boxes (admin / supervisor) ─────────
create or replace function public.wh_save_settings(p_warehouse text, p_tolerance_g integer, p_tolerance_pct numeric, p_retention_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.wh_settings;
begin
  if not (public.wh_role(p_warehouse) = 'admin' and staff_aal_ok()) then raise exception 'FORBIDDEN: a warehouse admin changes packing settings'; end if;
  if p_tolerance_g is null or p_tolerance_g < 0 or p_tolerance_g > 5000 then raise exception 'INVALID_TOLERANCE: 0 to 5,000 g'; end if;
  if p_tolerance_pct is null or p_tolerance_pct < 0 or p_tolerance_pct > 50 then raise exception 'INVALID_TOLERANCE: 0 to 50 %%'; end if;
  if p_retention_days is null or p_retention_days < 7 or p_retention_days > 3650 then raise exception 'INVALID_RETENTION: keep photos 7 to 3,650 days'; end if;
  select * into v_old from public.wh_settings where warehouse_code = p_warehouse;
  insert into public.wh_settings (warehouse_code, weight_tolerance_g, weight_tolerance_pct, evidence_retention_days, updated_by, updated_at)
  values (p_warehouse, p_tolerance_g, p_tolerance_pct, p_retention_days, auth.uid(), now())
  on conflict (warehouse_code) do update set weight_tolerance_g = excluded.weight_tolerance_g, weight_tolerance_pct = excluded.weight_tolerance_pct,
    evidence_retention_days = excluded.evidence_retention_days, updated_by = excluded.updated_by, updated_at = now();
  perform write_audit('wh_settings.saved', 'wh_settings', p_warehouse,
    jsonb_build_object('from', to_jsonb(v_old) - 'updated_by' - 'updated_at', 'tolerance_g', p_tolerance_g, 'tolerance_pct', p_tolerance_pct, 'retention_days', p_retention_days));
end $$;
revoke all on function public.wh_save_settings(text, integer, numeric, integer) from public, anon;
grant execute on function public.wh_save_settings(text, integer, numeric, integer) to authenticated, service_role;

create or replace function public.wh_save_box(
  p_warehouse text, p_id uuid, p_code text, p_name text, p_length_mm integer, p_width_mm integer, p_height_mm integer, p_tare_g integer, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_old public.wh_boxes;
  v_id uuid;
begin
  if not (public.wh_role(p_warehouse) in ('supervisor', 'admin') and staff_aal_ok()) then raise exception 'FORBIDDEN: supervisors and admins manage boxes'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then raise exception 'WAREHOUSE_NOT_OPEN'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{0,19}$' then raise exception 'INVALID_CODE: up to 20 letters, digits or dashes, e.g. BOX-S'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'INVALID_NAME: up to 80 characters'; end if;
  if p_tare_g is null or p_tare_g < 0 or p_tare_g > 50000 then raise exception 'INVALID_TARE: enter the empty box weight in grams'; end if;
  if (p_length_mm is not null and (p_length_mm < 1 or p_length_mm > 3000)) or (p_width_mm is not null and (p_width_mm < 1 or p_width_mm > 3000))
     or (p_height_mm is not null and (p_height_mm < 1 or p_height_mm > 3000)) then
    raise exception 'INVALID_SIZE: sides are 1 to 3,000 mm';
  end if;
  if exists (select 1 from public.wh_boxes where warehouse_code = p_warehouse and code = v_code and id is distinct from p_id) then
    raise exception 'DUPLICATE_BOX: % already exists here', v_code;
  end if;
  if p_id is null then
    insert into public.wh_boxes (warehouse_code, code, name, length_mm, width_mm, height_mm, tare_g, active, updated_by)
    values (p_warehouse, v_code, v_name, p_length_mm, p_width_mm, p_height_mm, p_tare_g, coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform write_audit('wh_box.created', 'wh_boxes', v_id::text, jsonb_build_object('warehouse', p_warehouse, 'code', v_code, 'tare_g', p_tare_g));
  else
    select * into v_old from public.wh_boxes where id = p_id and warehouse_code = p_warehouse for update;
    if v_old.id is null then raise exception 'NOT_FOUND'; end if;
    update public.wh_boxes
       set code = v_code, name = v_name, length_mm = p_length_mm, width_mm = p_width_mm, height_mm = p_height_mm, tare_g = p_tare_g,
           active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    v_id := p_id;
    perform write_audit('wh_box.updated', 'wh_boxes', v_id::text, jsonb_build_object('from', to_jsonb(v_old) - 'updated_by' - 'updated_at', 'code', v_code, 'tare_g', p_tare_g, 'active', p_active));
  end if;
  return v_id;
end $$;
revoke all on function public.wh_save_box(text, uuid, text, text, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function public.wh_save_box(text, uuid, text, text, integer, integer, integer, integer, boolean) to authenticated, service_role;

-- ───────── 12. Private evidence bucket ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wh-evidence', 'wh-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- staff who can pack at the warehouse upload photos of an order that is being packed
create or replace function public.wh_evidence_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name ~ '^[A-Z]{2,4}-[0-9]{2}/WO-[0-9]{6,}/(contents|sealed|scale)-[0-9a-f-]{36}\.(jpg|png|webp)$'
     and exists (select 1 from public.wh_orders o
                  where o.warehouse_code = split_part(p_name, '/', 1) and o.code = split_part(p_name, '/', 2)
                    and o.status in ('picked', 'packing'))
     and public.wh_can('pack', split_part(p_name, '/', 1))
$$;
revoke all on function public.wh_evidence_can_upload(text) from public, anon;
grant execute on function public.wh_evidence_can_upload(text) to authenticated, service_role;

-- staff who see the warehouse, or members of the company that owns the order (recorded photos only)
create or replace function public.wh_evidence_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.wh_sees(split_part(p_name, '/', 1))
      or exists (select 1 from public.wh_pack_evidence e join public.wh_orders o on o.id = e.order_id
                  where e.storage_path = p_name and o.org_id is not null and o.org_id in (select public.my_org_ids()))
$$;
revoke all on function public.wh_evidence_can_read(text) from public, anon;
grant execute on function public.wh_evidence_can_read(text) to authenticated, service_role;

drop policy if exists "wh evidence upload" on storage.objects;
create policy "wh evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'wh-evidence' and public.wh_evidence_can_upload(name));
drop policy if exists "wh evidence read" on storage.objects;
create policy "wh evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'wh-evidence' and public.wh_evidence_can_read(name));

-- ───────── 13. Staff reads (only warehouses the caller sees) ─────────
create or replace function public.wh_order_row(o public.wh_orders)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id, 'code', o.code, 'warehouse_code', o.warehouse_code, 'source', o.source, 'status', o.status,
    'org_id', o.org_id, 'owner', case when o.org_id is null then 'Octopus Dropship' else (select name from public.organizations where id = o.org_id) end,
    'store_order', (select order_number from public.store_orders where id = o.store_order_id),
    'store_order_cancelled', (select cancelled_at is not null from public.store_orders where id = o.store_order_id),
    'external_ref', o.external_ref, 'ship_name', o.ship_name, 'ship_country', o.ship_country,
    'has_dangerous_goods', o.has_dangerous_goods, 'dg_kinds', to_jsonb(o.dg_kinds), 'exception_reason', o.exception_reason,
    'lines', (select count(*) from public.wh_order_lines l where l.order_id = o.id),
    'units', (select coalesce(sum(l.qty), 0) from public.wh_order_lines l where l.order_id = o.id),
    'picked', (select coalesce(sum(l.picked_qty), 0) from public.wh_order_lines l where l.order_id = o.id),
    'packed', (select coalesce(sum(l.packed_qty), 0) from public.wh_order_lines l where l.order_id = o.id),
    'override_locked', o.override_locked_at is not null,
    'created_at', o.created_at, 'allocated_at', o.allocated_at, 'picked_at', o.picked_at, 'packed_at', o.packed_at)
$$;
revoke all on function public.wh_order_row(public.wh_orders) from public, anon, authenticated;
grant execute on function public.wh_order_row(public.wh_orders) to service_role;

create or replace function public.wh_orders_board(p_warehouse text default null, p_status text default null, p_source text default null, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(upper(btrim(coalesce(p_q, ''))), '');
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(public.wh_order_row(o) order by o.created_at desc)
        from (select x.id from public.wh_orders x
               where (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
                 and (p_status is null or x.status = p_status or (p_status = 'open' and x.status in ('new', 'allocated', 'picking', 'picked', 'packing', 'exception')))
                 and (p_source is null or x.source = p_source or (p_source = 'client' and x.source like 'client\_%'))
                 and (v_q is null or x.code = v_q or upper(coalesce(x.external_ref, '')) = v_q
                      or exists (select 1 from public.store_orders so where so.id = x.store_order_id and so.order_number = v_q))
               order by x.created_at desc limit 300) q
        join public.wh_orders o on o.id = q.id), '[]'::jsonb),
    'counts', coalesce((
      select jsonb_object_agg(status, n) from (
        select o.status, count(*) n from public.wh_orders o
         where (p_warehouse is null or o.warehouse_code = p_warehouse) and public.wh_sees(o.warehouse_code)
           and o.status not in ('cancelled', 'shipped')
         group by o.status) c), '{}'::jsonb),
    'can_import', public.wh_can_any('pick'),
    'dropship_ready', case when public.wh_can_any('pick') then coalesce((
      select jsonb_agg(jsonb_build_object('id', so.id, 'order_number', so.order_number, 'created_at', so.created_at,
               'items', (select count(*) from public.store_order_items i where i.store_order_id = so.id),
               'units', (select coalesce(sum(i.qty), 0) from public.store_order_items i where i.store_order_id = so.id)) order by so.created_at)
        from public.store_orders so
       where so.cancelled_at is null and not exists (select 1 from public.wh_orders w where w.store_order_id = so.id)
         and exists (select 1 from public.dropship_handoffs h where h.store_order_id = so.id and h.handoff_type = 'warehouse_pick_pack')
         and public.wh_dropship_is_ready(so.id)), '[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.wh_orders_board(text, text, text, text) from public, anon;
grant execute on function public.wh_orders_board(text, text, text, text) to authenticated, service_role;

-- board 3 (order detail) and board 4 (evidence) for one order: WO-###### or id
create or replace function public.wh_order_detail(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  st record;
  b public.wh_boxes;
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  select * into o from public.wh_orders where code = upper(btrim(coalesce(p_ref, ''))) or id::text = btrim(coalesce(p_ref, ''));
  if o.id is null or not public.wh_sees(o.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  select * into st from public.wh_settings_for(o.warehouse_code);
  select * into b from public.wh_boxes where id = o.box_id;
  return jsonb_build_object(
    'order', public.wh_order_row(o) || jsonb_build_object(
      'ship_phone', o.ship_phone, 'ship_address', o.ship_address, 'cancel_reason', o.cancel_reason, 'cancelled_at', o.cancelled_at,
      'box', case when b.id is null then null else jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name, 'tare_g', b.tare_g,
               'length_mm', b.length_mm, 'width_mm', b.width_mm, 'height_mm', b.height_mm) end,
      'expected_weight_g', o.expected_weight_g, 'tolerance_g', o.tolerance_g, 'measured_weight_g', o.measured_weight_g,
      'weighed_by_name', (select full_name from public.profiles where id = o.weighed_by),
      'battery_mark', o.battery_mark, 'override_attempts', o.override_attempts, 'override_locked_at', o.override_locked_at,
      'override_by_id', o.override_by, 'override_by_name', (select full_name from public.profiles where id = o.override_by), 'override_reason', o.override_reason,
      'override_weight_g', o.override_weight_g, 'override_at', o.override_at,
      'created_by_name', (select full_name from public.profiles where id = o.created_by),
      'packed_by_name', (select full_name from public.profiles where id = o.packed_by)),
    'me', auth.uid(),
    'settings', jsonb_build_object('tolerance_g', st.tolerance_g, 'tolerance_pct', st.tolerance_pct, 'retention_days', st.retention_days),
    'can_pick', public.wh_can('pick', o.warehouse_code),
    'can_pack', public.wh_can('pack', o.warehouse_code),
    'can_resolve', public.wh_can('resolve_exception', o.warehouse_code),
    'can_unlock', public.wh_role(o.warehouse_code) = 'admin',
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'sku', l.sku, 'barcode', l.barcode, 'name', l.name, 'qty', l.qty,
               'picked', l.picked_qty, 'short', l.short_qty, 'packed', l.packed_qty, 'unit_weight_g', l.unit_weight_g,
               'dg', to_jsonb(public.wh_dg_kinds(l.item_id)),
               'suggest', coalesce((
                 select jsonb_agg(jsonb_build_object('bin', x.bin, 'lot', x.lot, 'qty', x.qty) order by x.rn)
                   from (select n.code bin, t.lot_code lot, s.qty,
                                row_number() over (order by t.created_at, t.lot_code, (s.pallet_id is not null), n.code) rn
                           from public.wh_bin_stock s join public.wh_lots t on t.id = s.lot_id join public.wh_bins n on n.id = s.bin_id
                          where s.warehouse_code = o.warehouse_code and s.item_id = l.item_id
                            and t.org_id is not distinct from o.org_id and t.status = 'released') x
                  where x.rn <= 3), '[]'::jsonb)) order by l.sku)
        from public.wh_order_lines l where l.order_id = o.id), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object('sku', l.sku, 'bin', n.code, 'lot', t.lot_code, 'pallet', p.code, 'qty', k.qty,
               'by_name', pr.full_name, 'at', k.created_at) order by k.created_at)
        from public.wh_pick_records k join public.wh_order_lines l on l.id = k.line_id join public.wh_bins n on n.id = k.bin_id
        join public.wh_lots t on t.id = k.lot_id left join public.wh_pallets p on p.id = k.pallet_id left join public.profiles pr on pr.id = k.picked_by
       where k.order_id = o.id), '[]'::jsonb),
    'scans', coalesce((
      select jsonb_agg(x order by x ->> 'at') from (
        select jsonb_build_object('station', s.station, 'code', s.code, 'result', s.result, 'qty', s.qty, 'by_name', pr.full_name, 'at', s.created_at) x
          from public.wh_scan_log s left join public.profiles pr on pr.id = s.actor_id
         where s.order_id = o.id order by s.created_at desc limit 300) q), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'path', e.storage_path, 'at', e.created_at,
               'retention_until', e.retention_until, 'by_name', pr.full_name) order by e.created_at)
        from public.wh_pack_evidence e left join public.profiles pr on pr.id = e.uploaded_by where e.order_id = o.id), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object('ok', a.ok, 'reason', a.reason, 'supervisor_name', ps.full_name, 'by_name', pa.full_name,
               'expected_g', a.expected_weight_g, 'measured_g', a.measured_weight_g, 'at', a.created_at) order by a.created_at)
        from public.wh_override_attempts a left join public.profiles ps on ps.id = a.supervisor_id left join public.profiles pa on pa.id = a.actor_id
       where a.order_id = o.id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('action', g.action, 'at', g.created_at, 'by_name', pr.full_name,
               'details', g.details - 'movement_id' - 'taken' - 'store_order_id' - 'supervisor') order by g.created_at)
        from public.audit_log g left join public.profiles pr on pr.id = g.actor_id
       where g.entity = 'wh_orders' and g.entity_id = o.id::text), '[]'::jsonb),
    'boxes', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'tare_g', x.tare_g,
               'length_mm', x.length_mm, 'width_mm', x.width_mm, 'height_mm', x.height_mm) order by x.code)
        from public.wh_boxes x where x.warehouse_code = o.warehouse_code and x.active), '[]'::jsonb),
    'supervisors', coalesce((
      select jsonb_agg(jsonb_build_object('id', sp.user_id, 'name', coalesce(pr.full_name, pr.email)) order by pr.full_name)
        from public.wh_supervisor_pins sp join public.profiles pr on pr.id = sp.user_id
       where sp.locked_at is null and public.wh_user_can(sp.user_id, 'approve_override', o.warehouse_code)
         -- two people: not whoever weighed or scanned this parcel
         and sp.user_id is distinct from o.weighed_by
         and not exists (select 1 from public.wh_scan_log s where s.order_id = o.id and s.station = 'pack' and s.result = 'ok' and s.actor_id = sp.user_id)), '[]'::jsonb));
end $$;
revoke all on function public.wh_order_detail(text) from public, anon;
grant execute on function public.wh_order_detail(text) to authenticated, service_role;

-- board 6: orders to pick at the warehouse (oldest first) with the next FIFO bins per line
create or replace function public.wh_pick_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'can_pick', coalesce((select jsonb_agg(w.code order by w.code) from public.warehouses w
                           where (p_warehouse is null or w.code = p_warehouse) and public.wh_can('pick', w.code)), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(public.wh_order_row(o) order by o.allocated_at, o.created_at)
        from (select x.id from public.wh_orders x
               where x.status in ('allocated', 'picking') and (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
               order by x.allocated_at, x.created_at limit 200) q
        join public.wh_orders o on o.id = q.id), '[]'::jsonb));
end $$;
revoke all on function public.wh_pick_board(text) from public, anon;
grant execute on function public.wh_pick_board(text) to authenticated, service_role;

-- board 2 queue + station settings: orders picked or being packed; settings, boxes; can the caller set a PIN / manage
create or replace function public.wh_pack_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'can_pack', coalesce((select jsonb_agg(w.code order by w.code) from public.warehouses w
                           where (p_warehouse is null or w.code = p_warehouse) and public.wh_can('pack', w.code)), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(public.wh_order_row(o) order by o.picked_at nulls last, o.created_at)
        from (select x.id from public.wh_orders x
               where x.status in ('picked', 'packing') and (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
               order by x.picked_at nulls last, x.created_at limit 200) q
        join public.wh_orders o on o.id = q.id), '[]'::jsonb),
    'can_set_pin', public.wh_can_any('approve_override'),
    'my_pin_set', exists (select 1 from public.wh_supervisor_pins where user_id = auth.uid() and locked_at is null),
    'my_pin_locked', exists (select 1 from public.wh_supervisor_pins where user_id = auth.uid() and locked_at is not null),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'warehouse_code', w.code, 'name', w.name,
               'tolerance_g', s.tolerance_g, 'tolerance_pct', s.tolerance_pct, 'retention_days', s.retention_days,
               'can_settings', public.wh_role(w.code) = 'admin', 'can_boxes', public.wh_role(w.code) in ('supervisor', 'admin'),
               'boxes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'tare_g', x.tare_g, 'active', x.active,
                                          'length_mm', x.length_mm, 'width_mm', x.width_mm, 'height_mm', x.height_mm) order by x.active desc, x.code)
                                   from public.wh_boxes x where x.warehouse_code = w.code), '[]'::jsonb)) order by w.is_default desc, w.name)
        from public.warehouses w cross join lateral public.wh_settings_for(w.code) s
       where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_sees(w.code)), '[]'::jsonb));
end $$;
revoke all on function public.wh_pack_board(text) from public, anon;
grant execute on function public.wh_pack_board(text) to authenticated, service_role;

-- board 4 list: packed orders with their photos and how long they are kept
create or replace function public.wh_evidence_board(p_warehouse text default null, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(upper(btrim(coalesce(p_q, ''))), '');
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(x order by x ->> 'packed_at' desc) from (
        select public.wh_order_row(o) || jsonb_build_object(
                 'expected_weight_g', o.expected_weight_g, 'measured_weight_g', o.measured_weight_g, 'tolerance_g', o.tolerance_g,
                 'override', o.override_at is not null,
                 'photos', (select count(*) from public.wh_pack_evidence e where e.order_id = o.id),
                 'kinds', coalesce((select jsonb_agg(distinct e.kind) from public.wh_pack_evidence e where e.order_id = o.id), '[]'::jsonb),
                 'retention_until', (select min(e.retention_until) from public.wh_pack_evidence e where e.order_id = o.id)) x
          from public.wh_orders o
         where o.status in ('packed', 'labelled', 'shipped') and (p_warehouse is null or o.warehouse_code = p_warehouse) and public.wh_sees(o.warehouse_code)
           and (v_q is null or o.code = v_q or upper(coalesce(o.external_ref, '')) = v_q)
         order by o.packed_at desc limit 200) q), '[]'::jsonb),
    'retention', coalesce((
      select jsonb_agg(jsonb_build_object('warehouse_code', w.code, 'name', w.name, 'days', s.retention_days) order by w.is_default desc, w.name)
        from public.warehouses w cross join lateral public.wh_settings_for(w.code) s
       where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_sees(w.code)), '[]'::jsonb));
end $$;
revoke all on function public.wh_evidence_board(text, text) from public, anon;
grant execute on function public.wh_evidence_board(text, text) to authenticated, service_role;

-- ───────── 14. Client portal: packing proof (own company only) ─────────
-- photos (paths to sign), weight check, accepted pack scans (product + time; no staff names), retention
create or replace function public.wh_portal_proof(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  select * into o from public.wh_orders where code = upper(btrim(coalesce(p_code, '')));
  if o.id is null or o.org_id is null or o.org_id not in (select public.my_org_ids()) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'code', o.code, 'external_ref', o.external_ref, 'status', o.status, 'packed_at', o.packed_at,
    'warehouse', (select name from public.warehouses where code = o.warehouse_code),
    'packed', o.status in ('packed', 'labelled', 'shipped'),
    'box', (select name from public.wh_boxes where id = o.box_id),
    'expected_weight_g', case when o.status in ('packed', 'labelled', 'shipped') then o.expected_weight_g end,
    'measured_weight_g', case when o.status in ('packed', 'labelled', 'shipped') then o.measured_weight_g end,
    'weight_check', case when o.status not in ('packed', 'labelled', 'shipped') then null
                         when o.expected_weight_g is not null and abs(o.measured_weight_g - o.expected_weight_g) <= o.tolerance_g then 'within'
                         else 'supervisor_approved' end,
    'battery_mark', o.battery_mark, 'has_dangerous_goods', o.has_dangerous_goods,
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'path', e.storage_path, 'at', e.created_at, 'retention_until', e.retention_until)
                                           order by e.created_at)
                            from public.wh_pack_evidence e where e.order_id = o.id and e.retention_until > now()), '[]'::jsonb),
    'scans', coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.name, 'at', s.created_at) order by s.created_at)
                         from public.wh_scan_log s join public.wh_order_lines l on l.id = s.line_id
                        where s.order_id = o.id and s.station = 'pack' and s.result = 'ok'), '[]'::jsonb),
    'retention_until', (select min(e.retention_until) from public.wh_pack_evidence e where e.order_id = o.id));
end $$;
revoke all on function public.wh_portal_proof(text) from public, anon;
grant execute on function public.wh_portal_proof(text) to authenticated, service_role;

-- ───────── 15. Staging demo wipe also removes W3a rows of demo / test companies ─────────
-- wipe_demo_data() as defined by 20261101000230 plus one W3a block (next to the 230 Warehouse block). Down restores the exact
-- 230 definition.
CREATE OR REPLACE FUNCTION public.wipe_demo_data(p_confirm text, p_operator uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_ref text := 'ydbxqrizjxpduqbgnwxg';                     -- the STAGING project (19 Nov 2026: staging only)
  v_counts jsonb := '{}';
  v_users uuid[];
  n bigint;
  fk record;
  s record;
  v_bad text := '';
  v_real_wallets jsonb;
  v_kept uuid[];
begin
  if p_confirm is distinct from 'DELETE DEMO DATA FOR ' || v_ref then
    raise exception 'WIPE_REFUSED: type exactly "DELETE DEMO DATA FOR %"', v_ref using errcode = 'P0001';
  end if;
  -- staging only (19 Nov 2026): refuse on any database not marked staging (live is 'production')
  if coalesce((select value #>> '{}' from site_settings where key = 'app_environment'), '') <> 'staging' then
    raise exception 'WIPE_REFUSED: demo data can only be wiped on the staging project' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('wipe_demo_data'));
  perform tag_seed_rows();   -- pick up anything created on demo rows since the migration
  -- real (not demo/test) customers' wallet balances, to prove the wipe did not change them
  select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') into v_real_wallets
    from wallets w join organizations o on o.id = w.org_id where not o.is_seed;

  -- demo staff + demo buyer (admin@demo.octopusb2b.com is KEPT until the owner creates a real admin — owner decision)
  select coalesce(array_agg(id), '{}') into v_users from auth.users
   where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com';
  -- (Batch 3) demo users who proposed or approved a fee schedule stay: fee_versions is an append-only, two-person
  -- approval history (migration 211) — nulling approved_by or deleting the row is refused by guard_fee_versions().
  select coalesce(array_agg(u), '{}') into v_kept from unnest(v_users) u
   where exists (select 1 from fee_versions f where f.proposed_by = u or f.approved_by = u);
  v_users := array(select u from unnest(v_users) u where u <> all (v_kept));

  -- references to those users that don't cascade: null them (or drop the row when the column is NOT NULL)
  for fk in
    select conrelid::regclass::text tbl, a.attname col, a.attnotnull nn
      from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.confdeltype in ('a', 'r')
       and k.connamespace = 'public'::regnamespace
       and k.conrelid <> 'public.fee_versions'::regclass
  loop
    if fk.nn then execute format('delete from %s where %I = any($1)', fk.tbl, fk.col) using v_users;
    else execute format('update %s set %I = null where %I = any($1)', fk.tbl, fk.col, fk.col) using v_users; end if;
  end loop;

  -- seed rows, children before parents. Every FK into these tables is NO ACTION, so links from rows that stay
  -- (or that are deleted later in this list) are cleared first.
  update finance_approvals set executed_journal_id = null where executed_journal_id in (select id from journals where is_seed);
  delete from finance_approvals where order_id in (select id from orders where is_seed)
     or org_id in (select id from organizations where is_seed) or supplier_id in (select id from suppliers where is_seed);
  delete from ledger_entries where is_seed;                   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_entries', n);
  delete from journals where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journals', n);
  delete from assistant_messages where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_messages', n);
  delete from assistant_sessions where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_sessions', n);
  delete from ad_campaigns where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ad_campaigns', n);
  update escalations set ticket_id = null where ticket_id in (select id from tickets where is_seed);
  delete from tickets where is_seed;                          get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tickets', n);
  delete from shipments where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('shipments', n);
  delete from wallet_topups where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_topups', n);
  update wallet_topups set payment_id = null where payment_id in (select id from payments where is_seed);
  delete from payments where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('payments', n);
  delete from documents where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('documents', n);
  delete from proforma_invoices where is_seed;                get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('proforma_invoices', n);
  update orders set pool_pledge_id = null where pool_pledge_id in (select id from pool_pledges where is_seed);
  update pool_pledges set order_id = null where order_id in (select id from orders where is_seed);
  delete from pool_pledges where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pool_pledges', n);
  delete from orders where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders', n);
  delete from quotes where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('quotes', n);
  delete from rfqs where is_seed;                             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('rfqs', n);
  delete from service_requests where is_seed;                 get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('service_requests', n);
  delete from pools where is_seed;                            get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pools', n);
  update import_rows set product_id = null where product_id in (select id from products where is_seed);
  delete from products where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('products', n);
  update import_jobs set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  update payouts set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  delete from suppliers where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', n);
  -- Turnkey T2 + Warehouse OS W1–W2b rows of demo / test companies (migration 230); stock movements are never deleted
  delete from tk_client_projects p where p.org_id in (select id from organizations where is_seed)
     or exists (select 1 from tk_client_project_staff tps where tps.project_id = p.id and tps.is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tk_client_projects', n);
  delete from wh_clients where org_id in (select id from organizations where is_seed);
  -- Warehouse OS W3a (migration W3a): warehouse orders of demo / test companies (and Dropship orders of their store orders) —
  -- lines, picks, scans, photo records and override attempts go with them — before their lots (pick records point at lots).
  -- Stock movements are never deleted (their wh_order_id has no foreign key); packing photos stay in storage until the
  -- retention job (W6) removes them.
  delete from wh_orders where org_id in (select id from organizations where is_seed)
     or store_order_id in (select so.id from store_orders so where so.org_id in (select id from organizations where is_seed));
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_orders', n);
  delete from wh_location_moves where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_transfer_picks where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_bin_stock where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  update wh_transfer_lines set dest_lot_id = null where dest_lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed));
  delete from wh_pallets where org_id in (select id from organizations where is_seed);
  delete from wh_lots where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_lots', n);
  delete from wh_asns where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_asns', n);
  delete from wh_client_skus where org_id in (select id from organizations where is_seed);
  delete from wallet_withdrawals where org_id in (select id from organizations where is_seed);
  -- wallet holds of demo / test companies (added by migration 177 after this function was written)
  delete from wallet_holds where org_id in (select id from organizations where is_seed);   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_holds', n);
  delete from ledger_accounts where org_id in (select id from organizations where is_seed);
  delete from organizations where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('organizations', n);
  delete from auth.users where id = any(v_users);             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('demo_users', n);
  v_counts := v_counts || jsonb_build_object('demo_users_kept_fee_history', coalesce(array_length(v_kept, 1), 0));

  -- (19 Nov 2026) real customers' notifications are no longer touched: the wipe deletes only rows marked as demo/test

  -- human codes restart at 1001 (or after the highest code that still exists)
  for s in select * from (values
      ('seq_supplier_code', 'suppliers', 'code', '^OCT-(\d+)$'),
      ('seq_rfq', 'rfqs', 'code', '^RFQ-(\d+)$'),
      ('seq_order', 'orders', 'code', '^ORD-(\d+)$'),
      ('seq_shipment', 'shipments', 'code', '^SHP-(\d+)$'),
      ('seq_ticket', 'tickets', 'code', '^TKT-(\d+)$'),
      ('seq_pool', 'pools', 'code', '^POOL-(\d+)$'),
      ('seq_service_request', 'service_requests', 'code', '^SRV-(\d+)$'),
      ('seq_export', 'data_exports', 'code', '^EX-(\d+)$'),
      ('seq_restore', 'restore_requests', 'code', '^RS-(\d+)$'),
      ('seq_journal', 'journals', 'number', '^JRN-(\d+)$'),
      ('seq_pi', 'proforma_invoices', 'number', '^PI-\d{4}-(\d+)$'),
      ('seq_invoice', 'documents', 'number', '^INV-\d{4}-(\d+)$'),
      ('seq_quote', 'quotes', 'code', '^QT-(\d+)$'),
      ('seq_buyer_code', 'organizations', 'buyer_code', '^BUYER-(\d+)$')
    ) v(seq, tbl, col, rx)
  loop
    if to_regclass('public.' || s.seq) is null then continue; end if;
    execute format('select coalesce(max((substring(%I from %L))::bigint), 0) from %I', s.col, s.rx, s.tbl) into n;
    perform setval(s.seq, greatest(1000, n), true);
  end loop;

  -- launch defaults (audit C3 / K7)
  update site_settings set value = jsonb_set(coalesce(value, '{}'), '{amount_minor}', '0') || '{"verified_only": true}'::jsonb, updated_at = now()
   where key = 'wallet_credit_default';
  update site_settings set value = 'false'::jsonb, updated_at = now() where key = 'supplier_portal_enabled';
  update site_settings set value = 'true'::jsonb, updated_at = now() where key = 'pool_enabled';
  -- category names: capitalise the first letter of hand-typed lowercase names ("kitchen utensils" → "Kitchen utensils")
  update categories set name = upper(left(name, 1)) || substr(name, 2) where name ~ '^[a-z]';

  -- verify
  select string_agg(t, ', ') into v_bad from (
    select 'organizations' t where exists (select 1 from organizations where is_seed) union all
    select 'suppliers' where exists (select 1 from suppliers where is_seed) union all
    select 'products' where exists (select 1 from products where is_seed) union all
    select 'orders' where exists (select 1 from orders where is_seed) union all
    select 'journals' where exists (select 1 from journals where is_seed) union all
    select 'ledger_entries' where exists (select 1 from ledger_entries where is_seed) union all
    select 'pools' where exists (select 1 from pools where is_seed) union all
    select 'demo users' where exists (select 1 from auth.users where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com' and id <> all (v_kept)) union all
    select 'ledger not balanced' where coalesce((select sum(debit_cents - credit_cents) from ledger_entries), 0) <> 0 union all
    -- 19 Nov 2026: real customers may hold money (e.g. on staging); the check is that their balances did not change
    select 'real wallet balance changed' where v_real_wallets is distinct from
      (select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') from wallets w join organizations o on o.id = w.org_id where not o.is_seed) union all
    select 'open pools' where exists (select 1 from pools where status in ('open', 'locked'))) x;
  if v_bad is not null then raise exception 'WIPE_VERIFY_FAILED: %', v_bad; end if;

  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (p_operator, 'demo_data_wiped', 'database', v_ref, jsonb_build_object('counts', v_counts, 'at', now()));
  insert into site_settings(key, value, description) values ('demo_wipe',
      jsonb_build_object('at', now(), 'by', p_operator, 'by_name', (select full_name from profiles where id = p_operator), 'counts', v_counts),
      'When the demo dataset was removed (ADDON-24). Drives the one-time "Add your first supplier" banner on /admin.')
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_counts;
end $function$;
