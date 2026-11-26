-- 20261101000228_w2a_warehouse_inbound.sql
-- Warehouse OS · W2a (inbound). Design: docs/design/warehouse-os §3 steps 2–5; boards 5, 15, 16, 20 (text, no board files).
--  0. Legacy defaults: record_warehouse_stock_movement() and dropship_handoffs.warehouse_id default to the default warehouse
--     (was 'SZ-01'). The movement function also accepts W2a's own security-definer functions (transaction-local GUC
--     octopus.wh_internal, set only after their own wh_can() check); the movement actor stays auth.uid().
--  1. wh_client_skus: products a 3PL client owns (one item_master row each). Items without one are Octopus-owned.
--  2. wh_asns / wh_asn_lines: stock notices ASN-####, from the portal (client) or staff (Octopus stock).
--  3. wh_dock_slots: Booked → Arrived → Unloading → Done. No ASN, no check-in. A double-booked slot is refused.
--  4. wh_counts / wh_lots / wh_serials: two-pass counts (pass 2 by a different person); a lot with a difference is
--     blocked (not on hand) until a supervisor who did not count pass 2 approves; serials unique per item.
--  Writes only through wh_* security-definer functions; every change audit-logged. Unknown stays empty, never 0.
-- Down: supabase/migrations/down/20261101000228_w2a_warehouse_inbound.down.sql

create sequence if not exists public.seq_wh_asn;
create sequence if not exists public.seq_wh_lot;
revoke all on sequence public.seq_wh_asn from public, anon, authenticated;
revoke all on sequence public.seq_wh_lot from public, anon, authenticated;
grant all on sequence public.seq_wh_asn to service_role;
grant all on sequence public.seq_wh_lot to service_role;

-- ───────── 0. Legacy defaults + internal stock posting ─────────
alter table public.dropship_handoffs alter column warehouse_id set default public.default_warehouse_code();

-- same signature and grants; only the default warehouse and the internal-caller branch change
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
  v_cur public.warehouse_stock;
  v_existing public.warehouse_stock_movements;
  v_res_mov public.warehouse_stock_movements;
  v_oh_delta integer;
  v_res_delta integer;
  v_mov_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit()
             or (coalesce(current_setting('octopus.wh_internal', true), '') = 'true' and is_staff())) then
    raise exception 'FORBIDDEN: only 3PL staff or an admin may record warehouse stock movements';
  end if;

  if p_item_id is null or p_qty is null or p_qty <= 0 or v_reason is null then
    raise exception 'INVALID_MOVEMENT: item_id, positive qty, and non-empty reason are required';
  end if;

  if v_kind not in ('inbound', 'adjust_in', 'adjust_out', 'reserve', 'release', 'pick') then
    raise exception 'INVALID_MOVEMENT_KIND: %', v_kind;
  end if;

  if v_kind in ('reserve', 'release', 'pick') and p_store_order_id is null then
    raise exception 'STORE_ORDER_REQUIRED: % movement requires store_order_id', v_kind;
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

-- internal: posts an inbound movement through the only stock write path. Called only by the W2a functions below, after
-- their own wh_can() check; the movement's actor stays the signed-in person (auth.uid()).
create or replace function public.wh_post_inbound(p_item uuid, p_qty integer, p_reason text, p_warehouse text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform set_config('octopus.wh_internal', 'true', true);
  begin
    v := public.record_warehouse_stock_movement(p_item, 'inbound', p_qty, p_reason, p_warehouse, null);
  exception when others then
    perform set_config('octopus.wh_internal', '', true);
    raise;
  end;
  perform set_config('octopus.wh_internal', '', true);
  return (v ->> 'movement_id')::uuid;
end $$;
revoke all on function public.wh_post_inbound(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.wh_post_inbound(uuid, integer, text, text) to service_role;

-- ───────── helpers ─────────
-- staff who may see a warehouse's inbound screens (company admins, company-wide 3PL viewers, anyone with a role there)
create or replace function public.wh_sees(p_warehouse text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and not distributor_restricted()
     and (is_admin() or can('warehouse', 'view') or public.wh_role(p_warehouse) is not null)
$$;
revoke all on function public.wh_sees(text) from public, anon;
grant execute on function public.wh_sees(text) to authenticated, service_role;

-- a member of an approved, active 3PL client company
create or replace function public.wh_is_client_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and p_org in (select public.my_org_ids())
     and exists (select 1 from public.wh_clients c where c.org_id = p_org and c.status = 'active')
$$;
revoke all on function public.wh_is_client_member(uuid) from public, anon;
grant execute on function public.wh_is_client_member(uuid) to authenticated, service_role;

-- the caller can do an action at one or more warehouses (company admins: everywhere)
create or replace function public.wh_can_any(p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and staff_aal_ok() and (
    is_admin() or exists (
      select 1 from public.warehouse_staff s join public.wh_role_capabilities c on c.role = s.role and c.action = p_action
       where s.user_id = auth.uid() and s.suspended_at is null))
$$;
revoke all on function public.wh_can_any(text) from public, anon;
grant execute on function public.wh_can_any(text) to authenticated, service_role;

-- ───────── 1. Client-owned products ─────────
create table if not exists public.wh_client_skus (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  sku text not null check (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  barcode text check (barcode is null or barcode ~ '^[A-Za-z0-9-]{4,64}$'),
  item_id uuid not null unique references public.item_master(id) on delete restrict,
  weight_g integer check (weight_g is null or (weight_g > 0 and weight_g <= 100000)),
  has_battery boolean not null default false,
  has_liquid boolean not null default false,
  image_path text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_client_skus_org_sku unique (org_id, sku)
);
comment on table public.wh_client_skus is 'Warehouse OS: products a 3PL client owns. One item_master row each; items without a client SKU are Octopus-owned. Written through wh_* functions only.';
alter table public.wh_client_skus enable row level security;
revoke all on public.wh_client_skus from public, anon, authenticated;
grant select (id, org_id, sku, name, barcode, item_id, weight_g, has_battery, has_liquid, image_path, status, created_at, updated_at)
  on public.wh_client_skus to authenticated;
grant all on public.wh_client_skus to service_role;
drop policy if exists wh_client_skus_read on public.wh_client_skus;
create policy wh_client_skus_read on public.wh_client_skus for select to authenticated
  using (org_id in (select my_org_ids()) or (is_staff() and not distributor_restricted()
         and (is_admin() or can('warehouse', 'view') or exists (select 1 from public.warehouse_staff s where s.user_id = auth.uid() and s.suspended_at is null))));

-- ───────── 2. Stock notices (ASN) ─────────
create table if not exists public.wh_asns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('ASN-' || lpad(nextval('public.seq_wh_asn')::text, 4, '0')),
  org_id uuid references public.organizations(id) on delete restrict,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  source text not null check (source in ('client', 'sourcing', 'make_my_brand')),
  expected_date date not null,
  cartons integer check (cartons is null or cartons between 0 and 100000),
  pallets integer check (pallets is null or pallets between 0 and 10000),
  status text not null default 'submitted' check (status in ('submitted', 'booked', 'arrived', 'receiving', 'received', 'cancelled')),
  booked_slot_at timestamptz,
  client_note text check (client_note is null or length(client_note) <= 1000),
  cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_asns_owner check ((source = 'client') = (org_id is not null)),
  constraint wh_asns_load check (coalesce(cartons, 0) > 0 or coalesce(pallets, 0) > 0)
);
create index if not exists wh_asns_org_idx on public.wh_asns (org_id, created_at desc);
create index if not exists wh_asns_wh_status_idx on public.wh_asns (warehouse_code, status);
comment on table public.wh_asns is 'Warehouse OS: stock notices (ASN-####). org_id NULL = Octopus stock (sourcing / Make My Brand). Written through wh_* functions only.';
alter table public.wh_asns enable row level security;
revoke all on public.wh_asns from public, anon, authenticated;
-- the note, who created it and the cancel reason are read by staff through wh_list_asns() / wh_asn_detail()
grant select (id, code, org_id, warehouse_code, source, expected_date, cartons, pallets, status, booked_slot_at, received_at, created_at, updated_at)
  on public.wh_asns to authenticated;
grant all on public.wh_asns to service_role;
drop policy if exists wh_asns_read on public.wh_asns;
create policy wh_asns_read on public.wh_asns for select to authenticated
  using (org_id in (select my_org_ids()) or public.wh_sees(warehouse_code));

create table if not exists public.wh_asn_lines (
  id uuid primary key default gen_random_uuid(),
  asn_id uuid not null references public.wh_asns(id) on delete cascade,
  item_id uuid not null references public.item_master(id) on delete restrict,
  expected_qty integer not null check (expected_qty > 0 and expected_qty <= 1000000),
  received_good integer check (received_good is null or received_good >= 0),
  received_damaged integer check (received_damaged is null or received_damaged >= 0),
  status text not null default 'pending' check (status in ('pending', 'counted', 'blocked', 'accepted')),
  updated_at timestamptz not null default now(),
  constraint wh_asn_lines_one_item unique (asn_id, item_id)
);
comment on table public.wh_asn_lines is 'Warehouse OS: ASN lines. received_* stay empty until the line is accepted or approved.';
alter table public.wh_asn_lines enable row level security;
revoke all on public.wh_asn_lines from public, anon, authenticated;
grant select on public.wh_asn_lines to authenticated;
grant all on public.wh_asn_lines to service_role;
drop policy if exists wh_asn_lines_read on public.wh_asn_lines;
create policy wh_asn_lines_read on public.wh_asn_lines for select to authenticated
  using (exists (select 1 from public.wh_asns a where a.id = asn_id));

-- ───────── 3. Dock appointments ─────────
create table if not exists public.wh_dock_slots (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  dock text not null check (dock ~ '^[A-Z0-9-]{1,10}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  asn_id uuid references public.wh_asns(id) on delete set null,
  status text not null default 'booked' check (status in ('booked', 'arrived', 'unloading', 'done', 'cancelled')),
  load_note text check (load_note is null or length(load_note) <= 300),
  booked_by uuid references auth.users(id) on delete set null,
  arrived_at timestamptz,
  unloading_at timestamptz,
  done_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_dock_slots_time check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours')
);
create index if not exists wh_dock_slots_wh_idx on public.wh_dock_slots (warehouse_code, dock, starts_at);
create unique index if not exists wh_dock_slots_one_per_asn on public.wh_dock_slots (asn_id) where asn_id is not null and status <> 'cancelled';
comment on table public.wh_dock_slots is 'Warehouse OS: dock slots. Booked → Arrived → Unloading → Done. No ASN, no check-in; double booking refused in wh_book_slot().';
alter table public.wh_dock_slots enable row level security;
revoke all on public.wh_dock_slots from public, anon, authenticated;
grant select on public.wh_dock_slots to authenticated;
grant all on public.wh_dock_slots to service_role;
drop policy if exists wh_dock_slots_read on public.wh_dock_slots;
create policy wh_dock_slots_read on public.wh_dock_slots for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 4. Counts, lots, serials ─────────
create table if not exists public.wh_counts (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.wh_asn_lines(id) on delete cascade,
  pass smallint not null check (pass in (1, 2)),
  qty_good integer not null check (qty_good >= 0 and qty_good <= 1000000),
  qty_damaged integer not null check (qty_damaged >= 0 and qty_damaged <= 1000000),
  counted_by uuid references auth.users(id) on delete set null,
  photo_paths text[],
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint wh_counts_one_per_pass unique (line_id, pass)
);
comment on table public.wh_counts is 'Warehouse OS: count passes per ASN line (pass 2 by a different person when pass 1 differs). Staff only.';
alter table public.wh_counts enable row level security;
revoke all on public.wh_counts from public, anon, authenticated;
grant select on public.wh_counts to authenticated;
grant all on public.wh_counts to service_role;
drop policy if exists wh_counts_read on public.wh_counts;
create policy wh_counts_read on public.wh_counts for select to authenticated
  using (public.wh_sees((select a.warehouse_code from public.wh_asn_lines l join public.wh_asns a on a.id = l.asn_id where l.id = line_id)));

create table if not exists public.wh_lots (
  id uuid primary key default gen_random_uuid(),
  lot_code text not null unique default ('LOT-' || lpad(nextval('public.seq_wh_lot')::text, 5, '0')),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  item_id uuid not null references public.item_master(id) on delete restrict,
  org_id uuid references public.organizations(id) on delete restrict,
  asn_line_id uuid references public.wh_asn_lines(id) on delete set null,
  qty integer not null check (qty >= 0),
  status text not null check (status in ('released', 'blocked')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approve_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_lots_approved check (approved_by is null or nullif(btrim(coalesce(approve_reason, '')), '') is not null)
);
create index if not exists wh_lots_wh_status_idx on public.wh_lots (warehouse_code, status);
create index if not exists wh_lots_org_idx on public.wh_lots (org_id);
create unique index if not exists wh_lots_one_per_line on public.wh_lots (asn_line_id) where asn_line_id is not null;
comment on table public.wh_lots is 'Warehouse OS: received lots. Blocked lots are not on hand (no stock movement) until a supervisor approves.';
alter table public.wh_lots enable row level security;
revoke all on public.wh_lots from public, anon, authenticated;
grant select (id, lot_code, warehouse_code, item_id, org_id, asn_line_id, qty, status, created_at, updated_at) on public.wh_lots to authenticated;
grant all on public.wh_lots to service_role;
drop policy if exists wh_lots_read on public.wh_lots;
create policy wh_lots_read on public.wh_lots for select to authenticated
  using (org_id in (select my_org_ids()) or public.wh_sees(warehouse_code));

create table if not exists public.wh_serials (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.item_master(id) on delete restrict,
  serial text not null check (serial ~ '^[A-Z0-9][A-Z0-9._/-]{2,79}$'),
  lot_id uuid not null references public.wh_lots(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wh_serials_unique unique (item_id, serial)
);
create index if not exists wh_serials_lot_idx on public.wh_serials (lot_id);
comment on table public.wh_serials is 'Warehouse OS: serial numbers per lot; one serial per item, duplicates refused. Staff only.';
alter table public.wh_serials enable row level security;
revoke all on public.wh_serials from public, anon, authenticated;
grant select on public.wh_serials to authenticated;
grant all on public.wh_serials to service_role;
drop policy if exists wh_serials_read on public.wh_serials;
create policy wh_serials_read on public.wh_serials for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 5. Client SKUs (portal + staff) ─────────
create or replace function public.wh_save_client_sku(
  p_org uuid, p_id uuid, p_sku text, p_name text, p_barcode text, p_weight_g integer, p_has_battery boolean, p_has_liquid boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := upper(btrim(coalesce(p_sku, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_old public.wh_client_skus;
  v_item uuid;
  v_id uuid;
begin
  if p_org is null then raise exception 'INVALID_CLIENT'; end if;
  if not (public.wh_is_client_member(p_org)
          or (public.wh_can_any('receive') and exists (select 1 from public.wh_clients c where c.org_id = p_org and c.status = 'active'))) then
    raise exception 'FORBIDDEN';
  end if;
  if v_sku !~ '^[A-Z0-9][A-Z0-9._-]{0,63}$' then raise exception 'INVALID_SKU: use letters, digits, dots, dashes or underscores (up to 64 characters)'; end if;
  if v_name = '' or length(v_name) > 200 then raise exception 'INVALID_NAME: enter a product name (up to 200 characters)'; end if;
  if v_barcode is not null and v_barcode !~ '^[A-Za-z0-9-]{4,64}$' then raise exception 'INVALID_BARCODE: a barcode has 4 to 64 letters or digits'; end if;
  if p_weight_g is not null and (p_weight_g <= 0 or p_weight_g > 100000) then raise exception 'INVALID_WEIGHT: enter the weight in grams (1 to 100,000)'; end if;
  if exists (select 1 from public.wh_client_skus where org_id = p_org and sku = v_sku and id is distinct from p_id) then
    raise exception 'DUPLICATE_SKU: you already have a product with SKU %', v_sku;
  end if;
  if p_id is null then
    insert into public.item_master (weight_g, has_battery, has_liquid)
    values (p_weight_g, coalesce(p_has_battery, false), coalesce(p_has_liquid, false))
    returning id into v_item;
    insert into public.wh_client_skus (org_id, sku, name, barcode, item_id, weight_g, has_battery, has_liquid, created_by)
    values (p_org, v_sku, v_name, v_barcode, v_item, p_weight_g, coalesce(p_has_battery, false), coalesce(p_has_liquid, false), auth.uid())
    returning id into v_id;
    perform write_audit('wh_client_sku.created', 'wh_client_skus', v_id::text, jsonb_build_object('org_id', p_org, 'sku', v_sku, 'item_id', v_item));
  else
    select * into v_old from public.wh_client_skus where id = p_id and org_id = p_org for update;
    if v_old.id is null then raise exception 'NOT_FOUND'; end if;
    update public.wh_client_skus
       set sku = v_sku, name = v_name, barcode = v_barcode, weight_g = p_weight_g,
           has_battery = coalesce(p_has_battery, false), has_liquid = coalesce(p_has_liquid, false), updated_at = now()
     where id = p_id;
    update public.item_master
       set weight_g = p_weight_g, has_battery = coalesce(p_has_battery, false), has_liquid = coalesce(p_has_liquid, false)
     where id = v_old.item_id;
    v_id := p_id;
    perform write_audit('wh_client_sku.updated', 'wh_client_skus', v_id::text,
      jsonb_build_object('from', to_jsonb(v_old) - 'created_by' - 'updated_at', 'sku', v_sku, 'name', v_name, 'weight_g', p_weight_g));
  end if;
  return v_id;
end $$;
revoke all on function public.wh_save_client_sku(uuid, uuid, text, text, text, integer, boolean, boolean) from public, anon;
grant execute on function public.wh_save_client_sku(uuid, uuid, text, text, text, integer, boolean, boolean) to authenticated, service_role;

create or replace function public.wh_set_client_sku_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_client_skus;
begin
  if p_status not in ('active', 'archived') then raise exception 'INVALID_STATUS'; end if;
  select * into v from public.wh_client_skus where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.wh_is_client_member(v.org_id) or public.wh_can_any('receive')) then raise exception 'FORBIDDEN'; end if;
  if v.status = p_status then return; end if;
  update public.wh_client_skus set status = p_status, updated_at = now() where id = p_id;
  perform write_audit('wh_client_sku.' || p_status, 'wh_client_skus', p_id::text, jsonb_build_object('sku', v.sku));
end $$;
revoke all on function public.wh_set_client_sku_status(uuid, text) from public, anon;
grant execute on function public.wh_set_client_sku_status(uuid, text) to authenticated, service_role;

-- ───────── 6. Stock notices ─────────
-- Clients: their own active client company and own active SKUs (lines [{sku_id, qty}]).
-- Staff with receive at the warehouse: a client's notice, or Octopus stock (p_org NULL, source sourcing / make_my_brand,
-- lines [{item_id, qty}] of items that are not client SKUs).
create or replace function public.wh_create_asn(
  p_org uuid, p_warehouse text, p_expected_date date, p_cartons integer, p_pallets integer, p_lines jsonb, p_note text,
  p_source text default 'client'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := lower(btrim(coalesce(p_source, 'client')));
  v_wh text;
  v_tz text;
  v_today date;
  v_line jsonb;
  v_items uuid[] := '{}';
  v_qtys integer[] := '{}';
  v_item uuid;
  v_qty text;
  v_row public.wh_asns;
begin
  if p_org is not null then
    if v_source <> 'client' then raise exception 'INVALID_SOURCE: a client''s stock notice has source client'; end if;
    v_wh := coalesce(nullif(btrim(coalesce(p_warehouse, '')), ''),
                     (select preferred_warehouse from public.wh_clients where org_id = p_org), public.default_warehouse_code());
    if not (public.wh_is_client_member(p_org)
            or (public.wh_can('receive', v_wh) and exists (select 1 from public.wh_clients c where c.org_id = p_org and c.status = 'active'))) then
      raise exception 'FORBIDDEN';
    end if;
  else
    if v_source not in ('sourcing', 'make_my_brand') then raise exception 'INVALID_SOURCE: Octopus stock comes from sourcing or Make My Brand'; end if;
    v_wh := coalesce(nullif(btrim(coalesce(p_warehouse, '')), ''), public.default_warehouse_code());
    if not public.wh_can('receive', v_wh) then raise exception 'FORBIDDEN'; end if;
  end if;
  select timezone into v_tz from public.warehouses where code = v_wh and status = 'active';
  if v_tz is null then raise exception 'WAREHOUSE_NOT_ACTIVE: % is not an active warehouse', v_wh; end if;
  v_today := (now() at time zone v_tz)::date;
  if p_expected_date is null or p_expected_date < v_today or p_expected_date > v_today + 365 then
    raise exception 'INVALID_DATE: choose an arrival date from today to one year ahead';
  end if;
  if coalesce(p_cartons, 0) < 0 or coalesce(p_pallets, 0) < 0 or (coalesce(p_cartons, 0) = 0 and coalesce(p_pallets, 0) = 0) then
    raise exception 'INVALID_LOAD: enter how many cartons or pallets are coming';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'NO_LINES: add at least one product';
  end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'TOO_MANY_LINES: up to 200 products per notice'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := v_line ->> 'qty';
    if v_qty is null or v_qty !~ '^[0-9]{1,7}$' then raise exception 'INVALID_QTY: every line needs a quantity above 0'; end if;
    if v_qty::integer <= 0 then raise exception 'INVALID_QTY: every line needs a quantity above 0'; end if;
    if p_org is not null then
      select k.item_id into v_item from public.wh_client_skus k
       where k.id::text = (v_line ->> 'sku_id') and k.org_id = p_org and k.status = 'active';
      if v_item is null then raise exception 'UNKNOWN_SKU: a line uses a product that is not one of yours'; end if;
    else
      select i.id into v_item from public.item_master i
       where i.id::text = (v_line ->> 'item_id') and not exists (select 1 from public.wh_client_skus k where k.item_id = i.id);
      if v_item is null then raise exception 'UNKNOWN_ITEM: a line uses an item that is not Octopus stock'; end if;
    end if;
    if v_item = any(v_items) then raise exception 'DUPLICATE_LINE: each product goes on one line'; end if;
    v_items := v_items || v_item;
    v_qtys := v_qtys || v_qty::integer;
    v_item := null;
  end loop;
  insert into public.wh_asns (org_id, warehouse_code, source, expected_date, cartons, pallets, client_note, created_by)
  values (p_org, v_wh, v_source, p_expected_date, nullif(p_cartons, 0), nullif(p_pallets, 0),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;
  insert into public.wh_asn_lines (asn_id, item_id, expected_qty)
  select v_row.id, u.item, u.qty from unnest(v_items, v_qtys) as u(item, qty);
  perform write_audit('wh_asn.created', 'wh_asns', v_row.id::text,
    jsonb_build_object('code', v_row.code, 'org_id', p_org, 'warehouse', v_wh, 'source', v_source, 'lines', cardinality(v_items),
                       'units', (select sum(q) from unnest(v_qtys) q)));
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'warehouse', v_wh);
end $$;
revoke all on function public.wh_create_asn(uuid, text, date, integer, integer, jsonb, text, text) from public, anon;
grant execute on function public.wh_create_asn(uuid, text, date, integer, integer, jsonb, text, text) to authenticated, service_role;

create or replace function public.wh_cancel_asn(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_asns;
begin
  select * into v from public.wh_asns where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not ((v.org_id is not null and public.wh_is_client_member(v.org_id)) or public.wh_can('receive', v.warehouse_code)) then
    raise exception 'FORBIDDEN';
  end if;
  if v.status not in ('submitted', 'booked') then
    raise exception 'ASN_LOCKED: a stock notice can be cancelled only before it arrives';
  end if;
  update public.wh_dock_slots set status = 'cancelled', cancel_reason = 'Stock notice cancelled', updated_at = now()
   where asn_id = p_id and status = 'booked';
  update public.wh_asns set status = 'cancelled', booked_slot_at = null, cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   where id = p_id;
  perform write_audit('wh_asn.cancelled', 'wh_asns', p_id::text, jsonb_build_object('code', v.code, 'from', v.status, 'reason', p_reason));
end $$;
revoke all on function public.wh_cancel_asn(uuid, text) from public, anon;
grant execute on function public.wh_cancel_asn(uuid, text) to authenticated, service_role;

-- ───────── 7. Dock ─────────
-- p_date + p_start / p_end are local times at the warehouse (its timezone). Overlaps on the same dock are refused;
-- the warehouse row is locked so two bookings can't pass the check at the same time.
create or replace function public.wh_book_slot(
  p_warehouse text, p_dock text, p_date date, p_start time, p_end time, p_asn uuid default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dock text := upper(btrim(coalesce(p_dock, '')));
  v_tz text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_asn public.wh_asns;
  v_clash public.wh_dock_slots;
  v_id uuid;
begin
  if not public.wh_can('receive', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  select timezone into v_tz from public.warehouses where code = p_warehouse and status = 'active' for update;
  if v_tz is null then raise exception 'WAREHOUSE_NOT_ACTIVE: % is not an active warehouse', p_warehouse; end if;
  if v_dock !~ '^[A-Z0-9-]{1,10}$' then raise exception 'INVALID_DOCK: name the dock with letters and digits, e.g. D1'; end if;
  if p_date is null or p_start is null or p_end is null or p_end <= p_start then raise exception 'INVALID_TIME: the slot must end after it starts'; end if;
  v_starts := (p_date + p_start) at time zone v_tz;
  v_ends := (p_date + p_end) at time zone v_tz;
  if v_ends - v_starts > interval '12 hours' then raise exception 'INVALID_TIME: a slot is at most 12 hours'; end if;
  if p_asn is not null then
    select * into v_asn from public.wh_asns where id = p_asn for update;
    if v_asn.id is null then raise exception 'NOT_FOUND: stock notice not found'; end if;
    if v_asn.warehouse_code <> p_warehouse then raise exception 'WRONG_WAREHOUSE: % is for %', v_asn.code, v_asn.warehouse_code; end if;
    if v_asn.status <> 'submitted' then raise exception 'ASN_NOT_OPEN: % is already booked or closed', v_asn.code; end if;
  end if;
  select * into v_clash from public.wh_dock_slots
   where warehouse_code = p_warehouse and dock = v_dock and status <> 'cancelled'
     and tstzrange(starts_at, ends_at) && tstzrange(v_starts, v_ends)
   order by starts_at limit 1;
  if v_clash.id is not null then
    raise exception 'DOUBLE_BOOKED: dock % is already booked from % to %', v_dock,
      to_char(v_clash.starts_at at time zone v_tz, 'HH24:MI'), to_char(v_clash.ends_at at time zone v_tz, 'HH24:MI');
  end if;
  insert into public.wh_dock_slots (warehouse_code, dock, starts_at, ends_at, asn_id, load_note, booked_by)
  values (p_warehouse, v_dock, v_starts, v_ends, p_asn, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  if p_asn is not null then
    update public.wh_asns set status = 'booked', booked_slot_at = v_starts, updated_at = now() where id = p_asn;
  end if;
  perform write_audit('wh_dock.booked', 'wh_dock_slots', v_id::text,
    jsonb_build_object('warehouse', p_warehouse, 'dock', v_dock, 'starts_at', v_starts, 'ends_at', v_ends, 'asn', v_asn.code));
  return v_id;
end $$;
revoke all on function public.wh_book_slot(text, text, date, time, time, uuid, text) from public, anon;
grant execute on function public.wh_book_slot(text, text, date, time, time, uuid, text) to authenticated, service_role;

create or replace function public.wh_slot_set_asn(p_slot uuid, p_asn uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_dock_slots;
  v_asn public.wh_asns;
begin
  select * into v from public.wh_dock_slots where id = p_slot for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('receive', v.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v.status <> 'booked' then raise exception 'INVALID_STEP: only a booked slot can take a stock notice'; end if;
  if v.asn_id is not null then raise exception 'ASN_ALREADY_LINKED'; end if;
  select * into v_asn from public.wh_asns where id = p_asn for update;
  if v_asn.id is null then raise exception 'NOT_FOUND: stock notice not found'; end if;
  if v_asn.warehouse_code <> v.warehouse_code then raise exception 'WRONG_WAREHOUSE: % is for %', v_asn.code, v_asn.warehouse_code; end if;
  if v_asn.status <> 'submitted' then raise exception 'ASN_NOT_OPEN: % is already booked or closed', v_asn.code; end if;
  update public.wh_dock_slots set asn_id = p_asn, updated_at = now() where id = p_slot;
  update public.wh_asns set status = 'booked', booked_slot_at = v.starts_at, updated_at = now() where id = p_asn;
  perform write_audit('wh_dock.asn_linked', 'wh_dock_slots', p_slot::text, jsonb_build_object('asn', v_asn.code));
end $$;
revoke all on function public.wh_slot_set_asn(uuid, uuid) from public, anon;
grant execute on function public.wh_slot_set_asn(uuid, uuid) to authenticated, service_role;

create or replace function public.wh_check_in(p_slot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_dock_slots;
  v_asn public.wh_asns;
begin
  select * into v from public.wh_dock_slots where id = p_slot for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('receive', v.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v.status <> 'booked' then raise exception 'INVALID_STEP: only a booked slot can be checked in'; end if;
  if v.asn_id is null then raise exception 'NO_ASN: no stock notice is linked to this slot; link an ASN before check-in'; end if;
  select * into v_asn from public.wh_asns where id = v.asn_id for update;
  if v_asn.status <> 'booked' then raise exception 'ASN_NOT_OPEN: % is %', v_asn.code, v_asn.status; end if;
  update public.wh_dock_slots set status = 'arrived', arrived_at = now(), updated_at = now() where id = p_slot;
  update public.wh_asns set status = 'arrived', updated_at = now() where id = v.asn_id;
  perform write_audit('wh_dock.arrived', 'wh_dock_slots', p_slot::text, jsonb_build_object('asn', v_asn.code, 'dock', v.dock));
end $$;
revoke all on function public.wh_check_in(uuid) from public, anon;
grant execute on function public.wh_check_in(uuid) to authenticated, service_role;

create or replace function public.wh_slot_advance(p_slot uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_dock_slots;
  v_asn_status text;
begin
  if p_to = 'arrived' then perform public.wh_check_in(p_slot); return; end if;
  select * into v from public.wh_dock_slots where id = p_slot for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('receive', v.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if p_to = 'unloading' then
    if v.status <> 'arrived' then raise exception 'INVALID_STEP: check the delivery in first'; end if;
    update public.wh_dock_slots set status = 'unloading', unloading_at = now(), updated_at = now() where id = p_slot;
  elsif p_to = 'done' then
    if v.status <> 'unloading' then raise exception 'INVALID_STEP: start unloading first'; end if;
    select status into v_asn_status from public.wh_asns where id = v.asn_id;
    if v_asn_status is distinct from 'received' then raise exception 'NOT_RECEIVED: count and accept every line before finishing'; end if;
    update public.wh_dock_slots set status = 'done', done_at = now(), updated_at = now() where id = p_slot;
  else
    raise exception 'INVALID_STEP';
  end if;
  perform write_audit('wh_dock.' || p_to, 'wh_dock_slots', p_slot::text, jsonb_build_object('from', v.status, 'dock', v.dock));
end $$;
revoke all on function public.wh_slot_advance(uuid, text) from public, anon;
grant execute on function public.wh_slot_advance(uuid, text) to authenticated, service_role;

create or replace function public.wh_cancel_slot(p_slot uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_dock_slots;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from public.wh_dock_slots where id = p_slot for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('receive', v.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v.status <> 'booked' then raise exception 'INVALID_STEP: only a booked slot can be cancelled'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the slot is cancelled'; end if;
  update public.wh_dock_slots set status = 'cancelled', cancel_reason = v_reason, updated_at = now() where id = p_slot;
  if v.asn_id is not null then
    update public.wh_asns set status = 'submitted', booked_slot_at = null, updated_at = now() where id = v.asn_id and status = 'booked';
  end if;
  perform write_audit('wh_dock.cancelled', 'wh_dock_slots', p_slot::text, jsonb_build_object('reason', v_reason, 'dock', v.dock));
end $$;
revoke all on function public.wh_cancel_slot(uuid, text) from public, anon;
grant execute on function public.wh_cancel_slot(uuid, text) to authenticated, service_role;

-- ───────── 8. Receiving: two-pass counts, lots ─────────
-- internal: the notice is received when every line is accepted
create or replace function public.wh_asn_check_received(p_asn uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if exists (select 1 from public.wh_asn_lines where asn_id = p_asn and status <> 'accepted') then return false; end if;
  update public.wh_asns set status = 'received', received_at = now(), updated_at = now()
   where id = p_asn and status in ('arrived', 'receiving') returning code into v_code;
  if v_code is not null then
    perform write_audit('wh_asn.received', 'wh_asns', p_asn::text, jsonb_build_object('code', v_code));
  end if;
  return true;
end $$;
revoke all on function public.wh_asn_check_received(uuid) from public, anon, authenticated;
grant execute on function public.wh_asn_check_received(uuid) to service_role;

create or replace function public.wh_count_line(
  p_line uuid, p_good integer, p_damaged integer, p_note text default null, p_photos text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.wh_asn_lines;
  v_asn public.wh_asns;
  v_pass smallint;
  v_first public.wh_counts;
  v_lot public.wh_lots;
  v_result text;
begin
  select * into v_line from public.wh_asn_lines where id = p_line for update;
  if v_line.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_asn from public.wh_asns where id = v_line.asn_id for update;
  if not public.wh_can('receive', v_asn.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v_asn.status not in ('arrived', 'receiving') then raise exception 'NOT_ARRIVED: check the delivery in at the dock first'; end if;
  if p_good is null or p_damaged is null or p_good < 0 or p_damaged < 0 or p_good > 1000000 or p_damaged > 1000000 then
    raise exception 'INVALID_COUNT: enter the good and damaged quantities (0 or more)';
  end if;
  if v_line.status = 'pending' then
    v_pass := 1;
  elsif v_line.status = 'counted' then
    v_pass := 2;
    select * into v_first from public.wh_counts where line_id = p_line and pass = 1;
    if v_first.counted_by = auth.uid() then raise exception 'SECOND_COUNTER_REQUIRED: a different person must do the recount'; end if;
  else
    raise exception 'ALREADY_COUNTED: this line is %', v_line.status;
  end if;
  insert into public.wh_counts (line_id, pass, qty_good, qty_damaged, counted_by, photo_paths, note)
  values (p_line, v_pass, p_good, p_damaged, auth.uid(), p_photos, nullif(btrim(coalesce(p_note, '')), ''));
  if v_asn.status = 'arrived' then
    update public.wh_asns set status = 'receiving', updated_at = now() where id = v_asn.id;
  end if;

  if p_good = v_line.expected_qty and p_damaged = 0 then
    insert into public.wh_lots (warehouse_code, item_id, org_id, asn_line_id, qty, status, created_by)
    values (v_asn.warehouse_code, v_line.item_id, v_asn.org_id, p_line, p_good, 'released', auth.uid())
    returning * into v_lot;
    update public.wh_asn_lines set status = 'accepted', received_good = p_good, received_damaged = 0, updated_at = now() where id = p_line;
    perform public.wh_post_inbound(v_line.item_id, p_good, v_asn.code || ' received · ' || v_lot.lot_code, v_asn.warehouse_code);
    v_result := 'accepted';
  elsif v_pass = 1 then
    update public.wh_asn_lines set status = 'counted', updated_at = now() where id = p_line;
    v_result := 'recount';
  else
    insert into public.wh_lots (warehouse_code, item_id, org_id, asn_line_id, qty, status, created_by)
    values (v_asn.warehouse_code, v_line.item_id, v_asn.org_id, p_line, p_good, 'blocked', auth.uid())
    returning * into v_lot;
    update public.wh_asn_lines set status = 'blocked', updated_at = now() where id = p_line;
    v_result := 'blocked';
  end if;
  perform write_audit('wh_count.recorded', 'wh_asn_lines', p_line::text,
    jsonb_build_object('asn', v_asn.code, 'pass', v_pass, 'good', p_good, 'damaged', p_damaged, 'expected', v_line.expected_qty,
                       'result', v_result, 'lot', v_lot.lot_code));
  perform public.wh_asn_check_received(v_asn.id);
  return jsonb_build_object('result', v_result, 'pass', v_pass, 'lot', v_lot.lot_code);
end $$;
revoke all on function public.wh_count_line(uuid, integer, integer, text, text[]) from public, anon;
grant execute on function public.wh_count_line(uuid, integer, integer, text, text[]) to authenticated, service_role;

-- a supervisor (approve_count) who did not count pass 2 releases a blocked lot for the approved quantity
create or replace function public.wh_approve_lot(p_lot uuid, p_qty integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.wh_lots;
  v_line public.wh_asn_lines;
  v_asn public.wh_asns;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_second uuid;
  v_damaged integer;
  v_max integer;
begin
  select * into v_lot from public.wh_lots where id = p_lot for update;
  if v_lot.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('approve_count', v_lot.warehouse_code) then raise exception 'FORBIDDEN: only a supervisor approves counts'; end if;
  if v_lot.status <> 'blocked' then raise exception 'NOT_BLOCKED: this lot is already released'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why this quantity is approved'; end if;
  select * into v_line from public.wh_asn_lines where id = v_lot.asn_line_id for update;
  select * into v_asn from public.wh_asns where id = v_line.asn_id for update;
  select counted_by, qty_damaged into v_second, v_damaged from public.wh_counts where line_id = v_line.id and pass = 2;
  if v_second = auth.uid() then raise exception 'TWO_PERSON_REQUIRED: you counted this lot; another supervisor approves it'; end if;
  select greatest(v_line.expected_qty, coalesce(max(qty_good), 0)) into v_max from public.wh_counts where line_id = v_line.id;
  if p_qty is null or p_qty < 0 or p_qty > v_max then raise exception 'INVALID_QTY: approve between 0 and %', v_max; end if;
  update public.wh_lots set status = 'released', qty = p_qty, approved_by = auth.uid(), approved_at = now(), approve_reason = v_reason, updated_at = now()
   where id = p_lot;
  update public.wh_asn_lines set status = 'accepted', received_good = p_qty, received_damaged = coalesce(v_damaged, 0), updated_at = now()
   where id = v_line.id;
  if p_qty > 0 then
    perform public.wh_post_inbound(v_lot.item_id, p_qty, v_asn.code || ' approved · ' || v_lot.lot_code || ' · ' || v_reason, v_lot.warehouse_code);
  end if;
  perform write_audit('wh_lot.approved', 'wh_lots', p_lot::text,
    jsonb_build_object('lot', v_lot.lot_code, 'asn', v_asn.code, 'counted', v_lot.qty, 'approved', p_qty, 'expected', v_line.expected_qty, 'reason', v_reason));
  perform public.wh_asn_check_received(v_asn.id);
  return jsonb_build_object('lot', v_lot.lot_code, 'qty', p_qty);
end $$;
revoke all on function public.wh_approve_lot(uuid, integer, text) from public, anon;
grant execute on function public.wh_approve_lot(uuid, integer, text) to authenticated, service_role;

create or replace function public.wh_add_serials(p_lot uuid, p_serials text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.wh_lots;
  v_clean text[];
  v_dups text[];
  v_bad text;
  v_have integer;
begin
  select * into v_lot from public.wh_lots where id = p_lot for update;
  if v_lot.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('receive', v_lot.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  select array_agg(distinct x order by x) into v_clean
    from (select upper(btrim(s)) x from unnest(coalesce(p_serials, '{}')) s where nullif(btrim(s), '') is not null) t;
  if v_clean is null then raise exception 'NO_SERIALS: scan or type at least one serial'; end if;
  select x into v_bad from unnest(v_clean) x where x !~ '^[A-Z0-9][A-Z0-9._/-]{2,79}$' limit 1;
  if v_bad is not null then raise exception 'INVALID_SERIAL: % is not a valid serial (3 to 80 letters, digits, . _ / -)', v_bad; end if;
  select array_agg(x order by x) into v_dups from (
    select upper(btrim(s)) x from unnest(p_serials) s where nullif(btrim(s), '') is not null group by 1 having count(*) > 1
    union
    select serial from public.wh_serials where item_id = v_lot.item_id and serial = any(v_clean)
  ) d;
  if v_dups is not null then raise exception 'DUPLICATE_SERIAL: % already recorded', array_to_string(v_dups, ', '); end if;
  select count(*) into v_have from public.wh_serials where lot_id = p_lot;
  if v_have + cardinality(v_clean) > v_lot.qty then
    raise exception 'TOO_MANY_SERIALS: this lot has % unit(s) and % serial(s) already', v_lot.qty, v_have;
  end if;
  insert into public.wh_serials (item_id, serial, lot_id, warehouse_code, created_by)
  select v_lot.item_id, x, p_lot, v_lot.warehouse_code, auth.uid() from unnest(v_clean) x;
  perform write_audit('wh_serials.added', 'wh_lots', p_lot::text, jsonb_build_object('lot', v_lot.lot_code, 'count', cardinality(v_clean)));
  return cardinality(v_clean);
end $$;
revoke all on function public.wh_add_serials(uuid, text[]) from public, anon;
grant execute on function public.wh_add_serials(uuid, text[]) to authenticated, service_role;

-- ───────── 9. Staff reads (internal columns included; only warehouses the caller sees) ─────────
create or replace function public.wh_item_label(p_item uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sku', k.sku,
    'name', coalesce(k.name, p.title),
    'barcode', k.barcode,
    'owner', case when k.id is null then 'octopus' else 'client' end)
    from public.item_master i
    left join public.wh_client_skus k on k.item_id = i.id
    left join public.products p on p.id = i.sourcing_product_id
   where i.id = p_item
$$;
revoke all on function public.wh_item_label(uuid) from public, anon, authenticated;
grant execute on function public.wh_item_label(uuid) to service_role;

create or replace function public.wh_list_asns(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select a.id, a.code, a.org_id, o.name as org_name, a.warehouse_code, a.source, a.expected_date, a.cartons, a.pallets, a.status,
               a.client_note, a.cancel_reason, a.booked_slot_at, a.received_at, a.created_at,
               (select count(*) from public.wh_asn_lines l where l.asn_id = a.id) as lines,
               (select sum(l.expected_qty) from public.wh_asn_lines l where l.asn_id = a.id) as units,
               (select count(*) from public.wh_asn_lines l where l.asn_id = a.id and l.status in ('counted', 'blocked')) as attention
          from public.wh_asns a
          left join public.organizations o on o.id = a.org_id
         where (p_warehouse is null or a.warehouse_code = p_warehouse) and public.wh_sees(a.warehouse_code)
         order by a.created_at desc
         limit 500
      ) x), '[]'::jsonb);
end $$;
revoke all on function public.wh_list_asns(text) from public, anon;
grant execute on function public.wh_list_asns(text) to authenticated, service_role;

-- one notice by code (ASN-0091) or id, with lines, counts (who counted), lots and its dock slot
create or replace function public.wh_asn_detail(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.wh_asns;
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  select * into v from public.wh_asns where code = upper(btrim(coalesce(p_ref, ''))) or id::text = btrim(coalesce(p_ref, ''));
  if v.id is null or not public.wh_sees(v.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'asn', to_jsonb(v) || jsonb_build_object(
      'org_name', (select name from public.organizations where id = v.org_id),
      'created_by_name', (select full_name from public.profiles where id = v.created_by)),
    'me', auth.uid(),
    'can_receive', public.wh_can('receive', v.warehouse_code),
    'can_approve', public.wh_can('approve_count', v.warehouse_code),
    'slot', (select jsonb_build_object('id', s.id, 'dock', s.dock, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'status', s.status)
               from public.wh_dock_slots s where s.asn_id = v.id and s.status <> 'cancelled' limit 1),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'item_id', l.item_id, 'expected', l.expected_qty, 'good', l.received_good, 'damaged', l.received_damaged,
               'status', l.status, 'item', public.wh_item_label(l.item_id),
               'counts', coalesce((select jsonb_agg(jsonb_build_object('pass', c.pass, 'good', c.qty_good, 'damaged', c.qty_damaged,
                                     'by', c.counted_by, 'by_name', pr.full_name, 'note', c.note, 'at', c.created_at) order by c.pass)
                                     from public.wh_counts c left join public.profiles pr on pr.id = c.counted_by where c.line_id = l.id), '[]'::jsonb),
               'lot', (select jsonb_build_object('id', t.id, 'code', t.lot_code, 'qty', t.qty, 'status', t.status)
                         from public.wh_lots t where t.asn_line_id = l.id))
             order by l.id)
        from public.wh_asn_lines l where l.asn_id = v.id), '[]'::jsonb));
end $$;
revoke all on function public.wh_asn_detail(text) from public, anon;
grant execute on function public.wh_asn_detail(text) to authenticated, service_role;

-- board 15: the day's slots (warehouse local date; NULL = today there) and the notices that still need a slot
create or replace function public.wh_dock_board(p_warehouse text default null, p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone coalesce(
    (select timezone from public.warehouses where code = coalesce(p_warehouse, public.default_warehouse_code())), 'Asia/Shanghai'))::date);
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'day', v_day,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'warehouse_code', s.warehouse_code, 'dock', s.dock, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
               'start_local', to_char(s.starts_at at time zone w.timezone, 'HH24:MI'), 'end_local', to_char(s.ends_at at time zone w.timezone, 'HH24:MI'),
               'status', s.status, 'load_note', s.load_note, 'asn_id', s.asn_id, 'asn_code', a.code, 'asn_status', a.status,
               'owner', case when a.id is null then null when a.org_id is null then 'Octopus stock' else o.name end,
               'cartons', a.cartons, 'pallets', a.pallets, 'can_act', public.wh_can('receive', s.warehouse_code))
             order by s.dock, s.starts_at)
        from public.wh_dock_slots s
        join public.warehouses w on w.code = s.warehouse_code
        left join public.wh_asns a on a.id = s.asn_id
        left join public.organizations o on o.id = a.org_id
       where (p_warehouse is null or s.warehouse_code = p_warehouse) and public.wh_sees(s.warehouse_code)
         and s.status <> 'cancelled' and (s.starts_at at time zone w.timezone)::date = v_day), '[]'::jsonb),
    'open_asns', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'warehouse_code', a.warehouse_code, 'expected_date', a.expected_date,
               'owner', case when a.org_id is null then 'Octopus stock' else o.name end, 'cartons', a.cartons, 'pallets', a.pallets)
             order by a.expected_date, a.code)
        from public.wh_asns a left join public.organizations o on o.id = a.org_id
       where a.status = 'submitted' and (p_warehouse is null or a.warehouse_code = p_warehouse) and public.wh_sees(a.warehouse_code)), '[]'::jsonb),
    'docks', coalesce((
      select jsonb_agg(distinct s.dock) from public.wh_dock_slots s
       where (p_warehouse is null or s.warehouse_code = p_warehouse) and public.wh_sees(s.warehouse_code)), '[]'::jsonb));
end $$;
revoke all on function public.wh_dock_board(text, date) from public, anon;
grant execute on function public.wh_dock_board(text, date) to authenticated, service_role;

-- board 16: lines waiting for a recount, blocked lots, and recent lots for serial scanning
create or replace function public.wh_counts_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'me', auth.uid(),
    'recount', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_id', l.id, 'asn_code', a.code, 'warehouse_code', a.warehouse_code, 'expected', l.expected_qty, 'item', public.wh_item_label(l.item_id),
               'pass1', (select jsonb_build_object('good', c.qty_good, 'damaged', c.qty_damaged, 'by', c.counted_by, 'by_name', pr.full_name, 'at', c.created_at)
                           from public.wh_counts c left join public.profiles pr on pr.id = c.counted_by where c.line_id = l.id and c.pass = 1))
             order by a.code)
        from public.wh_asn_lines l join public.wh_asns a on a.id = l.asn_id
       where l.status = 'counted' and (p_warehouse is null or a.warehouse_code = p_warehouse) and public.wh_sees(a.warehouse_code)), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lot_id', t.id, 'lot_code', t.lot_code, 'qty', t.qty, 'asn_code', a.code, 'warehouse_code', t.warehouse_code, 'expected', l.expected_qty,
               'item', public.wh_item_label(t.item_id), 'can_approve', public.wh_can('approve_count', t.warehouse_code),
               'counts', coalesce((select jsonb_agg(jsonb_build_object('pass', c.pass, 'good', c.qty_good, 'damaged', c.qty_damaged, 'by', c.counted_by,
                                     'by_name', pr.full_name, 'note', c.note) order by c.pass)
                                     from public.wh_counts c left join public.profiles pr on pr.id = c.counted_by where c.line_id = l.id), '[]'::jsonb))
             order by t.created_at)
        from public.wh_lots t
        left join public.wh_asn_lines l on l.id = t.asn_line_id
        left join public.wh_asns a on a.id = l.asn_id
       where t.status = 'blocked' and (p_warehouse is null or t.warehouse_code = p_warehouse) and public.wh_sees(t.warehouse_code)), '[]'::jsonb),
    'lots', coalesce((
      select jsonb_agg(x order by x ->> 'created_at' desc) from (
        select jsonb_build_object('lot_id', t.id, 'lot_code', t.lot_code, 'qty', t.qty, 'status', t.status, 'warehouse_code', t.warehouse_code,
                 'item', public.wh_item_label(t.item_id), 'created_at', t.created_at,
                 'serials', (select count(*) from public.wh_serials z where z.lot_id = t.id),
                 'can_receive', public.wh_can('receive', t.warehouse_code)) x
          from public.wh_lots t
         where (p_warehouse is null or t.warehouse_code = p_warehouse) and public.wh_sees(t.warehouse_code)
         order by t.created_at desc limit 100) q), '[]'::jsonb));
end $$;
revoke all on function public.wh_counts_board(text) from public, anon;
grant execute on function public.wh_counts_board(text) to authenticated, service_role;
