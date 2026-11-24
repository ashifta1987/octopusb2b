-- 20261101000211_i1b_rate_cards_stock_and_fees.sql
-- Phase 1 · Step I1b: Rate cards, 3PL fee versions, duty rate schedules, 3PL warehouse stock & movements,
-- supplier stock tracking, order-level 4-part quote engine, plus I1a supplier-scope follow-up.
--
-- Rules implemented:
--  · I1a follow-up 1: item_master RLS tightened so suppliers (and restricted distributors) read/update ONLY
--    item_master rows linked to their own / assigned Sourcing products — never other suppliers' items and never
--    standalone dropship_variants items.
--  · Item 11 (C11, C12): shipping_rate_cards splits method ('economy','standard','express') from carrier_service_code
--    ('BKPHR' etc.), adds max_weight_g, enforces one active row per (carrier_code, carrier_service_code, country) and
--    per (carrier_code, method, country) via partial unique indexes, never edited after creation/use, migrates active
--    dropship_rates rows, freezes dropship_rates, and returns 0 rows ("No rate set", never 0) when missing.
--  · Item 12 (C18): fee_versions enforces two-person approval (approved_by <> proposed_by), one active row via partial
--    unique index, insurance_bp = 0, activate_fee_version() superseding the old active row in the same transaction,
--    and a block-trigger allowing ONLY active -> superseded once active.
--  · Item 13 (C13): processing fee is per ORDER (pick_pack_first_cents once + pick_pack_extra_cents per additional item
--    across all lines + packaging_cents once). get_dropship_order_quote() computes the 4-part split across multi-line
--    orders and returns version_ids; get_dropship_quote() delegates to it for single-item preview.
--  · Item 14: duty_rate_versions + duty_rate_entries with hs_prefix (NULL = country default; longest prefix match wins)
--    and de_minimis_cents; unknown -> NULL ("not known yet", never 0).
--  · Item 15 (C17): supplier_products.stock_qty nullable (NULL = not tracked, NOT 0) + stock_updated_at.
--  · Item 16 (C14–C17): warehouse_stock PK (warehouse_id, item_id) default 'SZ-01' + append-only
--    warehouse_stock_movements (inbound, adjust_in, adjust_out, reserve, release, pick) with signed on_hand_delta and
--    reserved_delta. Direct writes to warehouse_stock blocked; sum of movements === on_hand_qty & reserved_qty.
--    Legacy dropship_products/variants.(stock_status, stock_qty) frozen; get_dropship_variant_stock() reads by type.
--  · Item 17: RLS enabled on all 6 new tables; merchants/anon/suppliers get 0 direct rows on rate cards, fees, duties,
--    and warehouse stock tables.
--
-- Down: supabase/migrations/down/20261101000211_i1b_rate_cards_stock_and_fees.down.sql

-- ───────── 1. I1a Follow-up 1: Tighten item_master supplier & restricted-distributor access ─────────
drop policy if exists item_master_read on public.item_master;
drop policy if exists item_master_write on public.item_master;
drop policy if exists item_master_insert on public.item_master;
drop policy if exists item_master_update on public.item_master;

create policy item_master_read on public.item_master
  for select to authenticated
  using (
    (
      is_staff()
      and not distributor_restricted()
      and (
        can('products', 'view')
        or in_division(division_id_of('DS'))
        or in_division(division_id_of('3PL'))
        or can('finance', 'view')
      )
    )
    or (sourcing_product_id is not null and product_is_my_supplier(sourcing_product_id))
  );

create policy item_master_insert on public.item_master
  for insert to authenticated
  with check (
    is_staff()
    and not distributor_restricted()
    and (can('products', 'edit') or dropship_can_edit(division_id_of('DS')))
  );

create policy item_master_update on public.item_master
  for update to authenticated
  using (
    (
      is_staff()
      and not distributor_restricted()
      and (dropship_can_edit(division_id_of('DS')) or can('products', 'edit'))
    )
    or (sourcing_product_id is not null and product_is_my_supplier(sourcing_product_id))
  )
  with check (
    (
      is_staff()
      and not distributor_restricted()
      and (dropship_can_edit(division_id_of('DS')) or can('products', 'edit'))
    )
    or (sourcing_product_id is not null and product_is_my_supplier(sourcing_product_id))
  );

-- Also block non-platform callers from relinking sourcing_product_id inside guard_item_master()
create or replace function public.guard_item_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow_verify boolean := coalesce(current_setting('octopus.allow_hs_verify', true), '') = 'true';
  v_oc text := upper(btrim(coalesce(new.origin_country::text, '')));
begin
  if tg_op = 'UPDATE'
     and new.sourcing_product_id is distinct from old.sourcing_product_id
     and old.sourcing_product_id is not null
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') <> 'service_role'
     and not (is_staff() and not distributor_restricted() and (is_admin() or dropship_can_edit(division_id_of('DS')) or can('products', 'edit'))) then
    raise exception 'FORBIDDEN: only platform staff may relink sourcing_product_id';
  end if;

  if v_oc ~ '^[A-Z]{2}$' then
    new.origin_country := v_oc::char(2);
  else
    new.origin_country := null;
  end if;

  new.hs_code := nullif(btrim(coalesce(new.hs_code, '')), '');

  if tg_op = 'UPDATE'
     and old.hs_code_source in ('sheet', 'manual')
     and coalesce(btrim(old.hs_code), '') <> ''
     and new.hs_code_source in ('rule', 'ai') then
    new.hs_code := old.hs_code;
    new.hs_code_source := old.hs_code_source;
    new.hs_code_status := old.hs_code_status;
    new.hs_code_confidence := old.hs_code_confidence;
    new.hs_product_type_id := old.hs_product_type_id;
    new.hs_classify_pending := false;
    new.hs_verified := old.hs_verified;
    new.hs_verified_by := old.hs_verified_by;
    new.hs_verified_at := old.hs_verified_at;
  else
    if new.hs_code is null then
      if new.hs_code_source in ('sheet', 'manual')
         or (tg_op = 'UPDATE' and old.hs_code is not null and new.hs_code_source is not distinct from old.hs_code_source) then
        new.hs_code_source := null;
      end if;
      if new.hs_code_source is null then
        new.hs_code_status := 'missing';
        new.hs_code_confidence := null;
      end if;
    elsif new.hs_code_source is null
          or (tg_op = 'UPDATE' and new.hs_code is distinct from old.hs_code and new.hs_code_source is not distinct from old.hs_code_source and old.hs_code_source in ('rule', 'ai')) then
      new.hs_code_source := 'manual';
      new.hs_code_status := 'confirmed';
      new.hs_code_confidence := null;
      new.hs_classify_pending := false;
    end if;

    if new.hs_code_source in ('sheet', 'manual') and new.hs_code is not null then
      new.hs_code_status := 'confirmed';
      new.hs_classify_pending := false;
      new.hs_code_note := null;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.hs_verified, false) and not v_allow_verify then
      raise exception 'HS_VERIFY_FORBIDDEN: hs_verified can only be set by an explicit staff verification action';
    end if;
    if new.hs_code is null then
      new.hs_verified := false;
      new.hs_verified_by := null;
      new.hs_verified_at := null;
    end if;
  else
    if coalesce(new.hs_verified, false) and not coalesce(old.hs_verified, false) and not v_allow_verify then
      raise exception 'HS_VERIFY_FORBIDDEN: hs_verified can only be set by an explicit staff verification action';
    end if;
    if new.hs_code is null then
      new.hs_verified := false;
      new.hs_verified_by := null;
      new.hs_verified_at := null;
    elsif new.hs_code is distinct from old.hs_code and not v_allow_verify then
      new.hs_verified := false;
      new.hs_verified_by := null;
      new.hs_verified_at := null;
    end if;
    new.updated_at := now();
  end if;

  new.needs_data := (
    new.origin_country is null
    or new.weight_g is null
    or new.box_l_cm is null
    or new.box_w_cm is null
    or new.box_h_cm is null
  );

  return new;
end $$;

-- ───────── 2. Item 11 (C11, C12): shipping_rate_cards + Freeze dropship_rates ─────────
create table if not exists public.shipping_rate_cards (
  id uuid primary key default gen_random_uuid(),
  carrier_code text not null check (btrim(carrier_code) <> ''),
  method text not null check (method in ('economy', 'standard', 'express')),
  carrier_service_code text not null check (btrim(carrier_service_code) <> ''),
  service_label text,
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  base_cents bigint not null check (base_cents >= 0),
  per_100g_cents bigint not null check (per_100g_cents >= 0),
  step_g integer not null default 100 check (step_g > 0),
  max_weight_g integer not null default 30000 check (max_weight_g > 0),
  volumetric_divisor numeric(8,2) not null default 5000 check (volumetric_divisor > 0),
  days_min integer not null check (days_min > 0),
  days_max integer not null check (days_max >= days_min),
  allows_battery boolean not null default false,
  allows_liquid boolean not null default false,
  allows_magnet boolean not null default false,
  allows_powder boolean not null default false,
  version integer not null default 1 check (version >= 1),
  effective_from timestamptz not null default now(),
  active boolean not null default true,
  used_count bigint not null default 0 check (used_count >= 0),
  division_id uuid not null default division_id_of('3PL') references public.divisions(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint shipping_rate_cards_3pl check (division_id = division_id_of('3PL'))
);

create unique index if not exists shipping_rate_cards_one_active_service_idx
  on public.shipping_rate_cards (lower(btrim(carrier_code)), upper(btrim(carrier_service_code)), country)
  where active;

create unique index if not exists shipping_rate_cards_one_active_method_idx
  on public.shipping_rate_cards (lower(btrim(carrier_code)), method, country)
  where active;

create index if not exists shipping_rate_cards_lookup_idx
  on public.shipping_rate_cards (country, method, active);

comment on table public.shipping_rate_cards is '3PL-owned versioned carrier shipping rate cards. Immutable once created; updates publish a new version and deactivate the old row.';

alter table public.shipping_rate_cards enable row level security;
revoke all on public.shipping_rate_cards from public, anon, authenticated;
grant select on public.shipping_rate_cards to authenticated;
grant all on public.shipping_rate_cards to service_role;

drop policy if exists shipping_rate_cards_staff_read on public.shipping_rate_cards;
create policy shipping_rate_cards_staff_read on public.shipping_rate_cards
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (
      in_division(division_id_of('3PL'))
      or in_division(division_id_of('DS'))
      or can('orders', 'view')
      or can('finance', 'view')
    )
  );

-- Immutability guard: rate card rows are never edited in place (only active: true->false and monotonic used_count)
create or replace function public.guard_shipping_rate_cards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.used_count > 0 then
      raise exception 'RATE_CARD_IN_USE: shipping_rate_cards row % has been used and cannot be deleted', old.id;
    end if;
    return old;
  end if;

  if new.carrier_code is distinct from old.carrier_code
     or new.method is distinct from old.method
     or new.carrier_service_code is distinct from old.carrier_service_code
     or new.service_label is distinct from old.service_label
     or new.country is distinct from old.country
     or new.base_cents is distinct from old.base_cents
     or new.per_100g_cents is distinct from old.per_100g_cents
     or new.step_g is distinct from old.step_g
     or new.max_weight_g is distinct from old.max_weight_g
     or new.volumetric_divisor is distinct from old.volumetric_divisor
     or new.days_min is distinct from old.days_min
     or new.days_max is distinct from old.days_max
     or new.allows_battery is distinct from old.allows_battery
     or new.allows_liquid is distinct from old.allows_liquid
     or new.allows_magnet is distinct from old.allows_magnet
     or new.allows_powder is distinct from old.allows_powder
     or new.version is distinct from old.version
     or new.effective_from is distinct from old.effective_from
     or new.division_id is distinct from old.division_id then
    raise exception 'RATE_CARD_IMMUTABLE: shipping_rate_cards rows cannot be edited; publish a new rate card version instead';
  end if;

  if new.used_count < old.used_count then
    raise exception 'RATE_CARD_IMMUTABLE: used_count cannot decrease';
  end if;

  if not old.active and new.active then
    raise exception 'RATE_CARD_IMMUTABLE: a deactivated rate card version cannot be re-activated; publish a new version';
  end if;

  if old.active and not new.active and coalesce(current_setting('octopus.allow_rate_card_supersede', true), '') <> 'true' then
    raise exception 'RATE_CARD_IMMUTABLE: use publish_shipping_rate_card or deactivate_shipping_rate_card to retire a rate card';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_shipping_rate_cards on public.shipping_rate_cards;
create trigger trg_guard_shipping_rate_cards
  before update or delete on public.shipping_rate_cards
  for each row execute function public.guard_shipping_rate_cards();

-- Migrate existing active dropship_rates rows (0 on live; test rows on staging) into shipping_rate_cards
insert into public.shipping_rate_cards (
  carrier_code,
  method,
  carrier_service_code,
  service_label,
  country,
  base_cents,
  per_100g_cents,
  step_g,
  max_weight_g,
  volumetric_divisor,
  days_min,
  days_max,
  allows_battery,
  allows_liquid,
  version,
  active
)
select 'yunexpress',
       r.service,
       case r.service
         when 'express' then 'BKPHR'
         when 'standard' then 'THZXR'
         else 'YUN-ECO'
       end,
       case r.service
         when 'express' then 'YunExpress Priority Direct'
         when 'standard' then 'YunExpress Standard Direct'
         else 'YunExpress Economy Line'
       end,
       r.country,
       r.ship_base_cents::bigint,
       r.ship_per_100g_cents::bigint,
       100,
       30000,
       5000,
       r.days_min,
       r.days_max,
       r.allows_battery,
       r.allows_liquid,
       1,
       r.active
  from public.dropship_rates r
 where r.active
   and r.service in ('economy', 'standard', 'express')
on conflict do nothing;

-- Freeze dropship_rates against all new writes (Item C12)
create or replace function public.freeze_dropship_rates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'DROPSHIP_RATES_FROZEN: dropship_rates is frozen; use shipping_rate_cards, fee_versions, and duty_rate_entries';
end $$;

drop trigger if exists trg_freeze_dropship_rates on public.dropship_rates;
create trigger trg_freeze_dropship_rates
  before insert or update or delete on public.dropship_rates
  for each row execute function public.freeze_dropship_rates();

-- Helper: 3PL write permission check
create or replace function public.warehouse_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and staff_aal_ok() and (
    is_admin()
    or exists (
      select 1
        from public.division_members m
       where m.user_id = auth.uid()
         and m.division_id = division_id_of('3PL')
         and m.role in ('manager', 'staff')
    )
  )
$$;

revoke all on function public.warehouse_can_edit() from public, anon;
grant execute on function public.warehouse_can_edit() to authenticated, service_role;

-- Publish a new shipping rate card version (supersedes any active card on the same carrier+method+country or carrier+service+country)
create or replace function public.publish_shipping_rate_card(
  p_carrier_code text,
  p_method text,
  p_carrier_service_code text,
  p_country text,
  p_base_cents bigint,
  p_per_100g_cents bigint,
  p_days_min integer,
  p_days_max integer,
  p_max_weight_g integer default 30000,
  p_volumetric_divisor numeric default 5000,
  p_step_g integer default 100,
  p_allows_battery boolean default false,
  p_allows_liquid boolean default false,
  p_allows_magnet boolean default false,
  p_allows_powder boolean default false,
  p_service_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carrier text := lower(btrim(coalesce(p_carrier_code, '')));
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_svc text := upper(btrim(coalesce(p_carrier_service_code, '')));
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_ver integer;
  v_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not public.warehouse_can_edit() then
    raise exception 'FORBIDDEN: only 3PL staff or an admin may publish shipping rate cards';
  end if;

  if v_carrier = '' or v_svc = '' or v_method not in ('economy', 'standard', 'express') or v_country !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_RATE_CARD: check carrier_code, method, carrier_service_code, and ISO-2 country';
  end if;

  perform set_config('octopus.allow_rate_card_supersede', 'true', true);
  begin
    update public.shipping_rate_cards
       set active = false
     where active
       and lower(btrim(carrier_code)) = v_carrier
       and country = v_country
       and (method = v_method or upper(btrim(carrier_service_code)) = v_svc);
  exception when others then
    perform set_config('octopus.allow_rate_card_supersede', '', true);
    raise;
  end;
  perform set_config('octopus.allow_rate_card_supersede', '', true);

  select coalesce(max(version), 0) + 1
    into v_ver
    from public.shipping_rate_cards
   where lower(btrim(carrier_code)) = v_carrier
     and country = v_country
     and method = v_method;

  insert into public.shipping_rate_cards (
    carrier_code,
    method,
    carrier_service_code,
    service_label,
    country,
    base_cents,
    per_100g_cents,
    step_g,
    max_weight_g,
    volumetric_divisor,
    days_min,
    days_max,
    allows_battery,
    allows_liquid,
    allows_magnet,
    allows_powder,
    version,
    effective_from,
    active,
    created_by
  ) values (
    v_carrier,
    v_method,
    v_svc,
    nullif(btrim(coalesce(p_service_label, '')), ''),
    v_country,
    p_base_cents,
    p_per_100g_cents,
    greatest(1, coalesce(p_step_g, 100)),
    greatest(1, coalesce(p_max_weight_g, 30000)),
    coalesce(nullif(p_volumetric_divisor, 0), 5000),
    p_days_min,
    p_days_max,
    coalesce(p_allows_battery, false),
    coalesce(p_allows_liquid, false),
    coalesce(p_allows_magnet, false),
    coalesce(p_allows_powder, false),
    v_ver,
    now(),
    true,
    auth.uid()
  )
  returning id into v_id;

  perform write_audit(
    'shipping_rate_card.published',
    'shipping_rate_cards',
    v_id::text,
    jsonb_build_object(
      'carrier_code', v_carrier,
      'method', v_method,
      'carrier_service_code', v_svc,
      'country', v_country,
      'version', v_ver,
      'base_cents', p_base_cents,
      'per_100g_cents', p_per_100g_cents
    )
  );

  return v_id;
end $$;

revoke all on function public.publish_shipping_rate_card(text, text, text, text, bigint, bigint, integer, integer, integer, numeric, integer, boolean, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.publish_shipping_rate_card(text, text, text, text, bigint, bigint, integer, integer, integer, numeric, integer, boolean, boolean, boolean, boolean, text) to authenticated, service_role;

-- Deactivate a shipping rate card (when a lane is suspended without replacement)
create or replace function public.deactivate_shipping_rate_card(p_rate_card_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not public.warehouse_can_edit() then
    raise exception 'FORBIDDEN';
  end if;

  perform set_config('octopus.allow_rate_card_supersede', 'true', true);
  begin
    update public.shipping_rate_cards set active = false where id = p_rate_card_id and active;
  exception when others then
    perform set_config('octopus.allow_rate_card_supersede', '', true);
    raise;
  end;
  perform set_config('octopus.allow_rate_card_supersede', '', true);

  perform write_audit('shipping_rate_card.deactivated', 'shipping_rate_cards', p_rate_card_id::text, jsonb_build_object('reason', p_reason));
end $$;

revoke all on function public.deactivate_shipping_rate_card(uuid, text) from public, anon;
grant execute on function public.deactivate_shipping_rate_card(uuid, text) to authenticated, service_role;

-- Quote carrier rates for YunExpressAdapter.priceTrial & staff Shipping workspace (0 rows -> "No rate set", never 0)
create or replace function public.quote_carrier_rates(
  p_carrier_code text,
  p_country text,
  p_weight_g integer,
  p_parcels integer default 1
)
returns table (
  rate_card_id uuid,
  carrier_code text,
  method text,
  carrier_service_code text,
  service_label text,
  price_cents bigint,
  days_min integer,
  days_max integer,
  version integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_carrier text := lower(btrim(coalesce(p_carrier_code, '')));
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_weight integer := coalesce(p_weight_g, 0);
  v_parcels integer := greatest(1, coalesce(p_parcels, 1));
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (is_staff() and not distributor_restricted()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_weight <= 0 or v_country !~ '^[A-Z]{2}$' then
    return;
  end if;

  return query
    select rc.id as rate_card_id,
           rc.carrier_code,
           rc.method,
           rc.carrier_service_code,
           coalesce(rc.service_label, initcap(rc.method) || ' (' || rc.carrier_service_code || ')') as service_label,
           (
             (
               rc.base_cents
               + (ceil(v_weight::numeric / rc.step_g::numeric)::bigint * rc.per_100g_cents)
             ) * v_parcels::bigint
           ) as price_cents,
           rc.days_min,
           rc.days_max,
           rc.version
      from public.shipping_rate_cards rc
     where rc.active
       and lower(btrim(rc.carrier_code)) = v_carrier
       and rc.country = v_country
       and v_weight <= rc.max_weight_g
     order by rc.days_min asc, price_cents asc;
end $$;

revoke all on function public.quote_carrier_rates(text, text, integer, integer) from public, anon;
grant execute on function public.quote_carrier_rates(text, text, integer, integer) to authenticated, service_role;

-- ───────── 3. Item 12 (C18): fee_versions (two-person approval, one active row, active -> superseded only, insurance_bp = 0) ─────────
create table if not exists public.fee_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  pick_pack_first_cents bigint not null check (pick_pack_first_cents >= 0),
  pick_pack_extra_cents bigint not null check (pick_pack_extra_cents >= 0),
  packaging_cents bigint not null default 0 check (packaging_cents >= 0),
  storage_per_cbm_day_cents bigint not null default 0 check (storage_per_cbm_day_cents >= 0),
  return_handling_cents bigint not null default 0 check (return_handling_cents >= 0),
  insurance_bp integer not null default 0 check (insurance_bp = 0),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'active', 'superseded', 'rejected')),
  effective_from timestamptz,
  superseded_at timestamptz,
  note text,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  division_id uuid not null default division_id_of('3PL') references public.divisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint fee_versions_two_person check (approved_by is null or approved_by <> proposed_by),
  constraint fee_versions_active_approved check (status <> 'active' or (approved_by is not null and effective_from is not null)),
  constraint fee_versions_3pl check (division_id = division_id_of('3PL'))
);

create unique index if not exists fee_versions_one_active_idx
  on public.fee_versions ((true))
  where status = 'active';

comment on table public.fee_versions is '3PL processing & packaging fee schedule versions. Requires two-person approval; at most one active row; active rows can only transition to superseded.';

alter table public.fee_versions enable row level security;
revoke all on public.fee_versions from public, anon, authenticated;
grant select on public.fee_versions to authenticated;
grant all on public.fee_versions to service_role;

drop policy if exists fee_versions_staff_read on public.fee_versions;
create policy fee_versions_staff_read on public.fee_versions
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (
      in_division(division_id_of('3PL'))
      or in_division(division_id_of('DS'))
      or can('finance', 'view')
    )
  );

create or replace function public.guard_fee_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'FEE_VERSION_IMMUTABLE: fee_versions rows cannot be deleted';
  end if;

  if new.version is distinct from old.version
     or new.pick_pack_first_cents is distinct from old.pick_pack_first_cents
     or new.pick_pack_extra_cents is distinct from old.pick_pack_extra_cents
     or new.packaging_cents is distinct from old.packaging_cents
     or new.storage_per_cbm_day_cents is distinct from old.storage_per_cbm_day_cents
     or new.return_handling_cents is distinct from old.return_handling_cents
     or new.insurance_bp is distinct from old.insurance_bp
     or new.proposed_by is distinct from old.proposed_by
     or new.division_id is distinct from old.division_id then
    raise exception 'FEE_VERSION_IMMUTABLE: fee_versions amounts and proposer cannot be modified';
  end if;

  if coalesce(current_setting('octopus.allow_fee_version_transition', true), '') <> 'true' then
    raise exception 'FEE_VERSION_IMMUTABLE: use activate_fee_version / reject_fee_version to change status';
  end if;

  if old.status = 'active' then
    -- Item 12: once active, ONLY active -> superseded is allowed
    if new.status <> 'superseded'
       or new.approved_by is distinct from old.approved_by
       or new.effective_from is distinct from old.effective_from then
      raise exception 'FEE_VERSION_ACTIVE_LOCKED: an active fee_version can only transition from active to superseded';
    end if;
  elsif old.status = 'pending_approval' then
    if new.status not in ('active', 'rejected') then
      raise exception 'FEE_VERSION_BAD_TRANSITION: pending_approval can only transition to active or rejected';
    end if;
  else
    raise exception 'FEE_VERSION_TERMINAL: % fee_version cannot be modified', old.status;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_fee_versions on public.fee_versions;
create trigger trg_guard_fee_versions
  before update or delete on public.fee_versions
  for each row execute function public.guard_fee_versions();

create or replace function public.propose_fee_version(
  p_pick_pack_first_cents bigint,
  p_pick_pack_extra_cents bigint,
  p_packaging_cents bigint default 0,
  p_storage_per_cbm_day_cents bigint default 0,
  p_return_handling_cents bigint default 0,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver integer;
  v_id uuid;
begin
  if v_uid is null or not (is_staff() and (public.warehouse_can_edit() or can('finance', 'approve'))) then
    raise exception 'FORBIDDEN: only 3PL staff, Finance approvers, or an admin may propose a fee version';
  end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.fee_versions;

  insert into public.fee_versions (
    version,
    pick_pack_first_cents,
    pick_pack_extra_cents,
    packaging_cents,
    storage_per_cbm_day_cents,
    return_handling_cents,
    insurance_bp,
    status,
    note,
    proposed_by
  ) values (
    v_ver,
    p_pick_pack_first_cents,
    p_pick_pack_extra_cents,
    coalesce(p_packaging_cents, 0),
    coalesce(p_storage_per_cbm_day_cents, 0),
    coalesce(p_return_handling_cents, 0),
    0,
    'pending_approval',
    nullif(btrim(coalesce(p_note, '')), ''),
    v_uid
  )
  returning id into v_id;

  perform write_audit(
    'fee_version.proposed',
    'fee_versions',
    v_id::text,
    jsonb_build_object(
      'version', v_ver,
      'pick_pack_first_cents', p_pick_pack_first_cents,
      'pick_pack_extra_cents', p_pick_pack_extra_cents,
      'packaging_cents', coalesce(p_packaging_cents, 0)
    )
  );

  return v_id;
end $$;

revoke all on function public.propose_fee_version(bigint, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.propose_fee_version(bigint, bigint, bigint, bigint, bigint, text) to authenticated, service_role;

create or replace function public.activate_fee_version(
  p_fee_version_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target public.fee_versions;
  v_old_id uuid;
begin
  if v_uid is null or not (is_staff() and (is_admin() or can('finance', 'approve'))) then
    raise exception 'FORBIDDEN: only Finance approvers or an admin may activate a fee version';
  end if;

  select * into v_target from public.fee_versions where id = p_fee_version_id for update;
  if v_target.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target.status <> 'pending_approval' then
    raise exception 'FEE_VERSION_BAD_STATUS: only pending_approval fee versions can be activated (got %)', v_target.status;
  end if;
  if v_target.proposed_by = v_uid then
    raise exception 'TWO_PERSON_REQUIRED: approver must be different from proposer';
  end if;

  perform set_config('octopus.allow_fee_version_transition', 'true', true);
  begin
    update public.fee_versions
       set status = 'superseded',
           superseded_at = now()
     where status = 'active'
     returning id into v_old_id;

    update public.fee_versions
       set status = 'active',
           approved_by = v_uid,
           effective_from = now(),
           note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
     where id = p_fee_version_id;
  exception when others then
    perform set_config('octopus.allow_fee_version_transition', '', true);
    raise;
  end;
  perform set_config('octopus.allow_fee_version_transition', '', true);

  perform write_audit(
    'fee_version.activated',
    'fee_versions',
    p_fee_version_id::text,
    jsonb_build_object('version', v_target.version, 'superseded_id', v_old_id, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );

  return jsonb_build_object(
    'activated_id', p_fee_version_id,
    'superseded_id', v_old_id,
    'version', v_target.version
  );
end $$;

revoke all on function public.activate_fee_version(uuid, text) from public, anon;
grant execute on function public.activate_fee_version(uuid, text) to authenticated, service_role;

-- ───────── 4. Item 14: duty_rate_versions & duty_rate_entries (hs_prefix + de_minimis_cents, unknown = NULL) ─────────
create table if not exists public.duty_rate_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded')),
  effective_from timestamptz,
  superseded_at timestamptz,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  activated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists duty_rate_versions_one_active_idx
  on public.duty_rate_versions ((true))
  where status = 'active';

create table if not exists public.duty_rate_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.duty_rate_versions(id) on delete cascade,
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  hs_prefix text check (hs_prefix is null or hs_prefix ~ '^[0-9]{2,10}$'),
  duty_bp integer not null check (duty_bp >= 0 and duty_bp <= 100000),
  tax_bp integer not null default 0 check (tax_bp >= 0 and tax_bp <= 100000),
  de_minimis_cents integer not null default 0 check (de_minimis_cents >= 0),
  created_at timestamptz not null default now()
);

create unique index if not exists duty_rate_entries_version_country_prefix_key
  on public.duty_rate_entries (version_id, country, coalesce(hs_prefix, ''));

create index if not exists duty_rate_entries_lookup_idx
  on public.duty_rate_entries (version_id, country);

comment on table public.duty_rate_versions is 'Versioned destination duty & import-tax schedules. Unknown country/HS returns NULL ("not known yet"), never 0.';
comment on column public.duty_rate_entries.hs_prefix is 'Digits-only HS prefix (2–10 digits), or NULL for country-wide default. Most specific prefix wins.';

alter table public.duty_rate_versions enable row level security;
alter table public.duty_rate_entries enable row level security;
revoke all on public.duty_rate_versions, public.duty_rate_entries from public, anon, authenticated;
grant select on public.duty_rate_versions, public.duty_rate_entries to authenticated;
grant all on public.duty_rate_versions, public.duty_rate_entries to service_role;

drop policy if exists duty_rate_versions_staff_read on public.duty_rate_versions;
create policy duty_rate_versions_staff_read on public.duty_rate_versions
  for select to authenticated
  using (is_staff() and not distributor_restricted());

drop policy if exists duty_rate_entries_staff_read on public.duty_rate_entries;
create policy duty_rate_entries_staff_read on public.duty_rate_entries
  for select to authenticated
  using (is_staff() and not distributor_restricted());

create or replace function public.guard_duty_rate_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'DUTY_VERSION_IMMUTABLE: active or superseded duty_rate_versions cannot be deleted';
    end if;
    return old;
  end if;

  if old.status = 'active' then
    if coalesce(current_setting('octopus.allow_duty_version_transition', true), '') <> 'true'
       or new.status <> 'superseded'
       or new.version is distinct from old.version
       or new.effective_from is distinct from old.effective_from then
      raise exception 'DUTY_VERSION_IMMUTABLE: active duty_rate_versions can only transition to superseded';
    end if;
  elsif old.status = 'superseded' then
    raise exception 'DUTY_VERSION_IMMUTABLE: superseded duty_rate_versions cannot be modified';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_duty_rate_versions on public.duty_rate_versions;
create trigger trg_guard_duty_rate_versions
  before update or delete on public.duty_rate_versions
  for each row execute function public.guard_duty_rate_versions();

create or replace function public.guard_duty_rate_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vid uuid := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  v_st text;
  v_pref text;
begin
  select status into v_st from public.duty_rate_versions where id = v_vid;
  if v_st in ('active', 'superseded') then
    raise exception 'DUTY_ENTRIES_LOCKED: entries of an % duty_rate_version cannot be modified', v_st;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.country := upper(btrim(new.country))::char(2);
  v_pref := regexp_replace(coalesce(new.hs_prefix, ''), '[^0-9]', '', 'g');
  new.hs_prefix := nullif(v_pref, '');
  return new;
end $$;

drop trigger if exists trg_guard_duty_rate_entries on public.duty_rate_entries;
create trigger trg_guard_duty_rate_entries
  before insert or update or delete on public.duty_rate_entries
  for each row execute function public.guard_duty_rate_entries();

create or replace function public.create_duty_rate_version(p_note text default null, p_entries jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver integer;
  v_id uuid;
  e jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif v_uid is null or not (is_staff() and (is_admin() or can('finance', 'approve') or can('products', 'approve'))) then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.duty_rate_versions;
  insert into public.duty_rate_versions (version, status, note, created_by)
  values (v_ver, 'draft', nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_id;

  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    insert into public.duty_rate_entries (
      version_id,
      country,
      hs_prefix,
      duty_bp,
      tax_bp,
      de_minimis_cents
    ) values (
      v_id,
      upper(btrim(e->>'country'))::char(2),
      nullif(regexp_replace(coalesce(e->>'hs_prefix', ''), '[^0-9]', '', 'g'), ''),
      coalesce((e->>'duty_bp')::int, 0),
      coalesce((e->>'tax_bp')::int, 0),
      coalesce((e->>'de_minimis_cents')::int, 0)
    );
  end loop;

  perform write_audit('duty_rate_version.created', 'duty_rate_versions', v_id::text, jsonb_build_object('version', v_ver));
  return v_id;
end $$;

revoke all on function public.create_duty_rate_version(text, jsonb) from public, anon;
grant execute on function public.create_duty_rate_version(text, jsonb) to authenticated, service_role;

create or replace function public.activate_duty_rate_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target public.duty_rate_versions;
  v_old_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif v_uid is null or not (is_staff() and (is_admin() or can('finance', 'approve'))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_target from public.duty_rate_versions where id = p_version_id for update;
  if v_target.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target.status <> 'draft' then
    raise exception 'DUTY_VERSION_BAD_STATUS: only draft versions can be activated';
  end if;

  perform set_config('octopus.allow_duty_version_transition', 'true', true);
  begin
    update public.duty_rate_versions
       set status = 'superseded',
           superseded_at = now()
     where status = 'active'
     returning id into v_old_id;

    update public.duty_rate_versions
       set status = 'active',
           effective_from = now(),
           activated_by = v_uid
     where id = p_version_id;
  exception when others then
    perform set_config('octopus.allow_duty_version_transition', '', true);
    raise;
  end;
  perform set_config('octopus.allow_duty_version_transition', '', true);

  perform write_audit('duty_rate_version.activated', 'duty_rate_versions', p_version_id::text, jsonb_build_object('version', v_target.version, 'superseded_id', v_old_id));
  return jsonb_build_object('activated_id', p_version_id, 'superseded_id', v_old_id, 'version', v_target.version);
end $$;

revoke all on function public.activate_duty_rate_version(uuid) from public, anon;
grant execute on function public.activate_duty_rate_version(uuid) to authenticated, service_role;

-- Most-specific hs_prefix match wins; NULL hs_prefix = country default; no match / no active version -> NULL ("not known yet")
create or replace function public.lookup_duty_rate(p_country text, p_hs_code text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ver_id uuid;
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_hs text := regexp_replace(coalesce(p_hs_code, ''), '[^0-9]', '', 'g');
  v_entry public.duty_rate_entries;
begin
  if v_country !~ '^[A-Z]{2}$' then
    return null;
  end if;
  select id into v_ver_id from public.duty_rate_versions where status = 'active' limit 1;
  if v_ver_id is null then
    return null;
  end if;

  select e.*
    into v_entry
    from public.duty_rate_entries e
   where e.version_id = v_ver_id
     and e.country = v_country
     and (
       e.hs_prefix is null
       or (v_hs <> '' and v_hs like e.hs_prefix || '%')
     )
   order by coalesce(length(e.hs_prefix), 0) desc
   limit 1;

  if v_entry.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'duty_rate_version_id', v_ver_id,
    'entry_id', v_entry.id,
    'hs_prefix', v_entry.hs_prefix,
    'duty_bp', v_entry.duty_bp,
    'tax_bp', v_entry.tax_bp,
    'de_minimis_cents', v_entry.de_minimis_cents
  );
end $$;

revoke all on function public.lookup_duty_rate(text, text) from public, anon;
grant execute on function public.lookup_duty_rate(text, text) to authenticated, service_role;

-- ───────── 5. Item 15: supplier_products.stock_qty (nullable, NULL = not tracked, NOT 0) + stock_updated_at ─────────
alter table public.supplier_products
  add column if not exists stock_qty integer check (stock_qty is null or stock_qty >= 0),
  add column if not exists stock_updated_at timestamptz;

comment on column public.supplier_products.stock_qty is 'Nullable supplier stock quantity. NULL means stock is not tracked (never 0).';

create or replace function public.set_supplier_product_stock(
  p_supplier_product_id uuid,
  p_stock_qty integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp public.supplier_products;
begin
  if p_stock_qty is not null and p_stock_qty < 0 then
    raise exception 'INVALID_STOCK_QTY: stock_qty must be NULL or >= 0';
  end if;

  select * into v_sp from public.supplier_products where id = p_supplier_product_id for update;
  if v_sp.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif auth.uid() is null or not (
    (is_staff() and can('products', 'edit') and not distributor_restricted())
    or is_my_supplier(v_sp.supplier_id)
  ) then
    raise exception 'FORBIDDEN';
  end if;

  update public.supplier_products
     set stock_qty = p_stock_qty,
         stock_updated_at = now(),
         updated_at = now()
   where id = p_supplier_product_id;

  perform write_audit(
    'supplier_product.stock_updated',
    'supplier_products',
    p_supplier_product_id::text,
    jsonb_build_object('from_qty', v_sp.stock_qty, 'to_qty', p_stock_qty)
  );

  return jsonb_build_object(
    'supplier_product_id', p_supplier_product_id,
    'stock_qty', p_stock_qty,
    'stock_tracked', p_stock_qty is not null
  );
end $$;

revoke all on function public.set_supplier_product_stock(uuid, integer) from public, anon;
grant execute on function public.set_supplier_product_stock(uuid, integer) to authenticated, service_role;

-- ───────── 6. Item 16 (C14–C17): warehouse_stock + append-only warehouse_stock_movements + stock-by-type ─────────
create table if not exists public.warehouse_stock (
  warehouse_id text not null default 'SZ-01' check (btrim(warehouse_id) <> ''),
  item_id uuid not null references public.item_master(id) on delete restrict,
  on_hand_qty integer not null default 0 check (on_hand_qty >= 0),
  reserved_qty integer not null default 0 check (reserved_qty >= 0 and reserved_qty <= on_hand_qty),
  division_id uuid not null default division_id_of('3PL') references public.divisions(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, item_id),
  constraint warehouse_stock_3pl check (division_id = division_id_of('3PL'))
);

create index if not exists warehouse_stock_item_idx on public.warehouse_stock (item_id);

create table if not exists public.warehouse_stock_movements (
  id uuid primary key default gen_random_uuid(),
  warehouse_id text not null default 'SZ-01' check (btrim(warehouse_id) <> ''),
  item_id uuid not null references public.item_master(id) on delete restrict,
  kind text not null check (kind in ('inbound', 'adjust_in', 'adjust_out', 'reserve', 'release', 'pick')),
  qty integer not null check (qty > 0),
  on_hand_delta integer not null,
  reserved_delta integer not null,
  store_order_id uuid,
  reason text not null check (btrim(reason) <> ''),
  actor_id uuid references auth.users(id) on delete set null,
  division_id uuid not null default division_id_of('3PL') references public.divisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (warehouse_id, item_id) references public.warehouse_stock(warehouse_id, item_id) on delete restrict,
  constraint warehouse_stock_movements_3pl check (division_id = division_id_of('3PL')),
  constraint warehouse_stock_movements_order_req check (
    (kind in ('reserve', 'release', 'pick') and store_order_id is not null)
    or kind in ('inbound', 'adjust_in', 'adjust_out')
  ),
  constraint warehouse_stock_movements_deltas_check check (
    (kind in ('inbound', 'adjust_in') and on_hand_delta = qty and reserved_delta = 0)
    or (kind = 'adjust_out' and on_hand_delta = -qty and reserved_delta = 0)
    or (kind = 'reserve' and on_hand_delta = 0 and reserved_delta = qty)
    or (kind = 'release' and on_hand_delta = 0 and reserved_delta = -qty)
    or (kind = 'pick' and on_hand_delta = -qty and reserved_delta = -qty)
  )
);

create index if not exists warehouse_stock_movements_item_idx
  on public.warehouse_stock_movements (warehouse_id, item_id, created_at desc);

create unique index if not exists warehouse_stock_movements_order_kind_idem_idx
  on public.warehouse_stock_movements (warehouse_id, item_id, store_order_id, kind)
  where store_order_id is not null;

comment on table public.warehouse_stock is '3PL physical warehouse stock per (warehouse_id, item_id). Modified ONLY through record_warehouse_stock_movement.';
comment on table public.warehouse_stock_movements is 'Append-only 3PL stock ledger. Sum(on_hand_delta) = on_hand_qty and sum(reserved_delta) = reserved_qty.';

alter table public.warehouse_stock enable row level security;
alter table public.warehouse_stock_movements enable row level security;
revoke all on public.warehouse_stock, public.warehouse_stock_movements from public, anon, authenticated;
grant select on public.warehouse_stock, public.warehouse_stock_movements to authenticated;
grant all on public.warehouse_stock, public.warehouse_stock_movements to service_role;

drop policy if exists warehouse_stock_staff_read on public.warehouse_stock;
create policy warehouse_stock_staff_read on public.warehouse_stock
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (
      in_division(division_id_of('3PL'))
      or in_division(division_id_of('DS'))
      or can('finance', 'view')
    )
  );

drop policy if exists warehouse_stock_movements_staff_read on public.warehouse_stock_movements;
create policy warehouse_stock_movements_staff_read on public.warehouse_stock_movements
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (
      in_division(division_id_of('3PL'))
      or in_division(division_id_of('DS'))
      or can('finance', 'view')
    )
  );

-- Block direct writes on warehouse_stock and block UPDATE/DELETE on warehouse_stock_movements
create or replace function public.block_direct_warehouse_stock_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'WAREHOUSE_STOCK_IMMUTABLE: warehouse_stock rows cannot be deleted';
  end if;
  if coalesce(current_setting('octopus.allow_warehouse_stock_sync', true), '') <> 'true' then
    raise exception 'DIRECT_STOCK_WRITE_BLOCKED: warehouse_stock changes only through record_warehouse_stock_movement';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_direct_warehouse_stock_write on public.warehouse_stock;
create trigger trg_block_direct_warehouse_stock_write
  before insert or update or delete on public.warehouse_stock
  for each row execute function public.block_direct_warehouse_stock_write();

create or replace function public.immutable_warehouse_stock_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'STOCK_MOVEMENT_APPEND_ONLY: warehouse_stock_movements is append-only and cannot be updated or deleted';
end $$;

drop trigger if exists trg_immutable_warehouse_stock_movements on public.warehouse_stock_movements;
create trigger trg_immutable_warehouse_stock_movements
  before update or delete on public.warehouse_stock_movements
  for each row execute function public.immutable_warehouse_stock_movements();

-- Atomic stock movement writer (row lock + available check + idempotency per store_order_id + item)
create or replace function public.record_warehouse_stock_movement(
  p_item_id uuid,
  p_kind text,
  p_qty integer,
  p_reason text,
  p_warehouse_id text default 'SZ-01',
  p_store_order_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh text := coalesce(nullif(btrim(p_warehouse_id), ''), 'SZ-01');
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
  elsif not public.warehouse_can_edit() then
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
end $$;

revoke all on function public.record_warehouse_stock_movement(uuid, text, integer, text, text, uuid) from public, anon;
grant execute on function public.record_warehouse_stock_movement(uuid, text, integer, text, text, uuid) to authenticated, service_role;

-- Fulfilment type & optional base product_price_cents on dropship_products + freeze legacy stock columns (Item C17)
alter table public.dropship_products
  add column if not exists fulfilment_type text not null default 'extended_catalog' check (fulfilment_type in ('fast_ship', 'extended_catalog')),
  add column if not exists product_price_cents bigint check (product_price_cents is null or product_price_cents >= 0);

update public.dropship_products
   set fulfilment_type = case when source_type = 'own_warehouse' then 'fast_ship' else 'extended_catalog' end;

-- Migrate existing staging fast_ship variants' stock_qty into real warehouse_stock inbound movements so stock is never lost
do $$
declare
  r record;
begin
  for r in
    select v.item_id, coalesce(v.stock_qty, p.stock_qty, 0) as qty
      from public.dropship_variants v
      join public.dropship_products p on p.id = v.product_id
     where p.fulfilment_type = 'fast_ship'
       and coalesce(v.stock_qty, p.stock_qty, 0) > 0
       and not exists (
         select 1 from public.warehouse_stock ws where ws.warehouse_id = 'SZ-01' and ws.item_id = v.item_id
       )
  loop
    perform public.record_warehouse_stock_movement(r.item_id, 'inbound', r.qty, 'Initial I1b migration from legacy stock_qty', 'SZ-01', null);
  end loop;
end $$;

create or replace function public.freeze_dropship_product_legacy_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.stock_qty is not null or coalesce(new.stock_status, 'in_stock') <> 'in_stock' then
      raise exception 'LEGACY_STOCK_FROZEN: dropship_products stock_qty and stock_status are frozen; use warehouse_stock or supplier_products.stock_qty';
    end if;
    if new.source_type = 'own_warehouse' and new.fulfilment_type = 'extended_catalog' then
      new.fulfilment_type := 'fast_ship';
    end if;
  else
    if new.stock_qty is distinct from old.stock_qty
       or new.stock_status is distinct from old.stock_status then
      raise exception 'LEGACY_STOCK_FROZEN: dropship_products stock_qty and stock_status are frozen; use warehouse_stock or supplier_products.stock_qty';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_freeze_dropship_product_legacy_stock on public.dropship_products;
create trigger trg_freeze_dropship_product_legacy_stock
  before insert or update on public.dropship_products
  for each row execute function public.freeze_dropship_product_legacy_stock();

create or replace function public.freeze_dropship_variant_legacy_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.stock_qty is not null or coalesce(new.stock_status, 'in_stock') <> 'in_stock' then
      raise exception 'LEGACY_STOCK_FROZEN: dropship_variants stock_qty and stock_status are frozen; use warehouse_stock or supplier_products.stock_qty';
    end if;
  else
    if new.stock_qty is distinct from old.stock_qty
       or new.stock_status is distinct from old.stock_status then
      raise exception 'LEGACY_STOCK_FROZEN: dropship_variants stock_qty and stock_status are frozen; use warehouse_stock or supplier_products.stock_qty';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_freeze_dropship_variant_legacy_stock on public.dropship_variants;
create trigger trg_freeze_dropship_variant_legacy_stock
  before insert or update on public.dropship_variants
  for each row execute function public.freeze_dropship_variant_legacy_stock();

-- Stock-by-type read helper (fast_ship -> 3PL warehouse_stock; extended_catalog -> Sourcing supplier_products.stock_qty)
create or replace function public.get_dropship_variant_stock(
  p_variant_id uuid,
  p_warehouse_id text default 'SZ-01'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_ws public.warehouse_stock;
  v_sp public.supplier_products;
  v_avail integer;
  v_status text;
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (auth.uid() is not null and is_staff() and not distributor_restricted());
begin
  select * into v_var from public.dropship_variants where id = p_variant_id;
  if v_var.id is null then
    return null;
  end if;
  select * into v_prod from public.dropship_products where id = v_var.product_id;

  if v_prod.fulfilment_type = 'fast_ship' then
    select * into v_ws
      from public.warehouse_stock
     where warehouse_id = coalesce(nullif(btrim(p_warehouse_id), ''), 'SZ-01')
       and item_id = v_var.item_id;
    v_avail := greatest(0, coalesce(v_ws.on_hand_qty, 0) - coalesce(v_ws.reserved_qty, 0));
    v_status := case
      when v_avail <= 0 then 'out'
      when v_avail <= 10 then 'low'
      else 'in_stock'
    end;
    if v_is_staff then
      return jsonb_build_object(
        'fulfilment_type', 'fast_ship',
        'stock_tracked', true,
        'stock_status', v_status,
        'available_qty', v_avail,
        'on_hand_qty', coalesce(v_ws.on_hand_qty, 0),
        'reserved_qty', coalesce(v_ws.reserved_qty, 0)
      );
    end if;
    return jsonb_build_object(
      'fulfilment_type', 'fast_ship',
      'stock_tracked', true,
      'stock_status', v_status
    );
  else
    if v_var.supplier_product_id is not null then
      select * into v_sp from public.supplier_products where id = v_var.supplier_product_id;
    end if;
    if v_sp.id is null or v_sp.stock_qty is null then
      -- Item 15: NULL = supplier stock not tracked (NOT 0!)
      v_status := 'in_stock';
      if v_is_staff then
        return jsonb_build_object(
          'fulfilment_type', 'extended_catalog',
          'stock_tracked', false,
          'stock_status', v_status,
          'stock_qty', null,
          'stock_updated_at', v_sp.stock_updated_at
        );
      end if;
      return jsonb_build_object(
        'fulfilment_type', 'extended_catalog',
        'stock_tracked', false,
        'stock_status', v_status
      );
    else
      v_status := case
        when v_sp.stock_qty <= 0 then 'out'
        when v_sp.stock_qty <= 10 then 'low'
        else 'in_stock'
      end;
      if v_is_staff then
        return jsonb_build_object(
          'fulfilment_type', 'extended_catalog',
          'stock_tracked', true,
          'stock_status', v_status,
          'stock_qty', v_sp.stock_qty,
          'stock_updated_at', v_sp.stock_updated_at
        );
      end if;
      return jsonb_build_object(
        'fulfilment_type', 'extended_catalog',
        'stock_tracked', true,
        'stock_status', v_status
      );
    end if;
  end if;
end $$;

revoke all on function public.get_dropship_variant_stock(uuid, text) from public, anon;
grant execute on function public.get_dropship_variant_stock(uuid, text) to authenticated, service_role;

-- Update get_dropship_catalogue & get_dropship_product so stock_status comes from get_dropship_variant_stock (never reading frozen stock columns)
create or replace function public.get_dropship_catalogue(
  p_country text,
  p_search text default null,
  p_category text default null,
  p_page integer default 1
)
returns table (
  product_id uuid,
  model_no text,
  title text,
  description text,
  category text,
  images text[],
  specs jsonb,
  weight_g integer,
  dimensions_cm jsonb,
  min_order_qty integer,
  stock_status text,
  variants jsonb,
  routes jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_q text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_limit integer := 48;
  v_offset integer := (v_page - 1) * 48;
  v_rate jsonb;
begin
  if v_org is null or v_uid is null then
    return;
  end if;

  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' then
    return;
  end if;
  if not exists (select 1 from public.dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return;
  end if;

  return query
    with eligible as (
      select p.id,
             p.model_no,
             p.title,
             p.description,
             p.category,
             p.images,
             p.specs,
             p.weight_g,
             p.dimensions_cm,
             p.min_order_qty,
             p.created_at,
             (
               select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', v.id,
                     'model_no', v.model_no,
                     'options', v.options,
                     'price_adjust_cents', v.price_adjust_cents,
                     'stock_status', coalesce(public.get_dropship_variant_stock(v.id) ->> 'stock_status', 'in_stock')
                   ) order by v.sort, v.model_no
                 ),
                 '[]'::jsonb
               )
               from public.dropship_variants v
              where v.product_id = p.id
             ) as variants_json,
             (
               select jsonb_agg(
                 jsonb_build_object(
                   'destination_country', r.destination_country,
                   'shipping_method', r.shipping_method,
                   'landed_price_cents', r.landed_price_cents,
                   'est_days_min', r.est_days_min,
                   'est_days_max', r.est_days_max
                 ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
               )
               from public.dropship_routes r
              where r.product_id = p.id
                and r.destination_country = v_country
                and r.is_active
             ) as routes_json
        from public.dropship_products p
       where p.status = 'active'
         and public.dropship_product_supplier_eligible(p)
         and exists (
           select 1 from public.dropship_routes r
            where r.product_id = p.id
              and r.destination_country = v_country
              and r.is_active
         )
         and (
           v_q is null
           or lower(p.title) like '%' || v_q || '%'
           or lower(coalesce(p.description, '')) like '%' || v_q || '%'
           or lower(coalesce(p.category, '')) like '%' || v_q || '%'
           or lower(p.model_no) like '%' || v_q || '%'
         )
         and (v_cat is null or lower(coalesce(p.category, '')) = lower(v_cat))
    )
    select e.id as product_id,
           e.model_no,
           e.title,
           e.description,
           e.category,
           e.images,
           e.specs,
           e.weight_g,
           e.dimensions_cm,
           e.min_order_qty,
           case
             when exists (select 1 from jsonb_array_elements(e.variants_json) x where x ->> 'stock_status' = 'in_stock') then 'in_stock'
             when exists (select 1 from jsonb_array_elements(e.variants_json) x where x ->> 'stock_status' = 'low') then 'low'
             else 'out'
           end as stock_status,
           e.variants_json as variants,
           e.routes_json as routes,
           count(*) over() as total_count
      from eligible e
     order by e.created_at desc, e.id
     limit v_limit offset v_offset;
end $$;

revoke all on function public.get_dropship_catalogue(text, text, text, integer) from public, anon;
grant execute on function public.get_dropship_catalogue(text, text, text, integer) to authenticated, service_role;

create or replace function public.get_dropship_product(
  p_product_id uuid,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_rate jsonb;
  v_vars jsonb;
  v_prod_stock text;
  v_res jsonb;
begin
  if v_org is null or v_uid is null or p_product_id is null then
    return null;
  end if;

  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' then
    return null;
  end if;
  if not exists (select 1 from public.dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return null;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', v.id,
               'model_no', v.model_no,
               'options', v.options,
               'price_adjust_cents', v.price_adjust_cents,
               'stock_status', coalesce(public.get_dropship_variant_stock(v.id) ->> 'stock_status', 'in_stock')
             ) order by v.sort, v.model_no
           ),
           '[]'::jsonb
         )
    into v_vars
    from public.dropship_variants v
   where v.product_id = p_product_id;

  v_prod_stock := case
    when exists (select 1 from jsonb_array_elements(v_vars) x where x ->> 'stock_status' = 'in_stock') then 'in_stock'
    when exists (select 1 from jsonb_array_elements(v_vars) x where x ->> 'stock_status' = 'low') then 'low'
    else 'out'
  end;

  select jsonb_build_object(
           'product_id', p.id,
           'model_no', p.model_no,
           'title', p.title,
           'description', p.description,
           'category', p.category,
           'images', to_jsonb(p.images),
           'specs', p.specs,
           'weight_g', p.weight_g,
           'dimensions_cm', p.dimensions_cm,
           'min_order_qty', p.min_order_qty,
           'stock_status', v_prod_stock,
           'variants', v_vars,
           'routes', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'destination_country', r.destination_country,
                 'shipping_method', r.shipping_method,
                 'landed_price_cents', r.landed_price_cents,
                 'est_days_min', r.est_days_min,
                 'est_days_max', r.est_days_max
               ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
             )
             from public.dropship_routes r
            where r.product_id = p.id and r.destination_country = v_country and r.is_active
           ), '[]'::jsonb)
         )
    into v_res
    from public.dropship_products p
   where p.id = p_product_id
     and p.status = 'active'
     and public.dropship_product_supplier_eligible(p)
     and exists (
       select 1 from public.dropship_routes r
        where r.product_id = p.id and r.destination_country = v_country and r.is_active
     );

  return v_res;
end $$;

revoke all on function public.get_dropship_product(uuid, text) from public, anon;
grant execute on function public.get_dropship_product(uuid, text) to authenticated, service_role;

-- ───────── 7. Item 13 (C13): Order-level 4-part quote engine & single-product quote preview ─────────
--Parcel weight rule:
--  Combined parcel billed weight for a multi-line order = max(Σ actual weight_g, ceil((Σ box_volume_cm3 / divisor) * 1000)),
--  rounded up to the 100 g step (step_g) — NOT the sum of each item's billed weight.
--  Pack-station re-weigh corrects actual parcel weight later (tolerance: 50 g / 10%).
--Duty base rule (final rule set in Step 6b):
--  · Catalogue / product quote (get_dropship_quote, p_quote_mode = 'catalogue'): uses Octopus product price as the
--    declared customs value and marks duties_status = 'estimate' (or 'not_known_yet' when no duty entry exists).
--  · Order quote (get_dropship_order_quote, p_quote_mode = 'order'): uses the buyer's paid item price
--    (buyer_paid_cents or buyer_unit_price_cents * qty), converted to USD cents at the locked FX rate (p_fx_rate_to_usd,
--    required when p_buyer_currency <> 'USD'), and marks duties_status = 'known' (falls back to product price with
--    duties_status = 'estimate' only if buyer paid prices are not supplied yet).
create or replace function public.get_dropship_order_quote(
  p_lines jsonb,
  p_country text,
  p_method text,
  p_incoterm text default 'DDP',
  p_buyer_currency text default 'USD',
  p_fx_rate_to_usd numeric default null,
  p_quote_mode text default 'order'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted());
  v_org uuid;
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_incoterm text := upper(btrim(coalesce(p_incoterm, 'DDP')));
  v_buyer_currency text := upper(btrim(coalesce(p_buyer_currency, 'USD')));
  v_quote_mode text := lower(btrim(coalesce(p_quote_mode, 'order')));
  v_fx numeric;
  v_rc public.shipping_rate_cards;
  v_fv public.fee_versions;
  v_line jsonb;
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_im public.item_master;
  v_route public.dropship_routes;
  v_qty integer;
  v_total_qty integer := 0;
  v_sum_actual_weight_g bigint := 0;
  v_sum_box_volume_cm3 numeric := 0;
  v_combined_vol_g bigint := 0;
  v_raw_parcel_weight_g bigint := 0;
  v_billed_weight_g integer;
  v_unit_prod_cents bigint;
  v_line_prod_cents bigint;
  v_product_cents bigint := 0;
  v_line_buyer_minor bigint;
  v_line_declared_usd_cents bigint;
  v_declared_value_usd_cents bigint := 0;
  v_all_buyer_prices_supplied boolean := true;
  v_duty_lines jsonb := '[]'::jsonb;
  v_dl_elem jsonb;
  v_elem_decl bigint;
  v_processing_cents bigint;
  v_shipping_cents bigint;
  v_duty_lookup jsonb;
  v_duty_ver_id uuid := null;
  v_duties_known boolean := true;
  v_duties_cents bigint := 0;
  v_duties_status text;
  v_duty_bp integer;
  v_tax_bp integer;
  v_de_min integer;
begin
  if not v_is_staff then
    v_org := dropship_merchant_org();
    if v_org is null then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Dropshipping is not switched on for your account');
    end if;
    if not exists (select 1 from public.dropship_markets m where m.org_id = v_org and m.country = v_country) then
      return jsonb_build_object('ok', false, 'code', 'MARKET_NOT_ENABLED', 'message', 'Destination country is not in your selling countries');
    end if;
  end if;

  if v_country !~ '^[A-Z]{2}$'
     or v_method not in ('economy', 'standard', 'express')
     or v_incoterm not in ('DDP', 'DAP')
     or v_quote_mode not in ('catalogue', 'order')
     or v_buyer_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'Invalid country, shipping method, incoterm, currency, or quote mode');
  end if;

  if v_buyer_currency <> 'USD' and (p_fx_rate_to_usd is null or p_fx_rate_to_usd <= 0) then
    return jsonb_build_object('ok', false, 'code', 'FX_RATE_REQUIRED', 'message', 'Locked FX rate to USD is required when buyer currency is not USD');
  end if;
  if p_fx_rate_to_usd is not null and p_fx_rate_to_usd <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FX_RATE', 'message', 'FX rate to USD must be > 0');
  end if;
  v_fx := case
    when v_buyer_currency = 'USD' then coalesce(p_fx_rate_to_usd, 1.0)
    else p_fx_rate_to_usd
  end;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_LINES', 'message', 'At least one order line is required');
  end if;

  -- 1. Active shipping rate card (no rate -> "No rate set", never 0)
  select *
    into v_rc
    from public.shipping_rate_cards rc
   where rc.active
     and rc.country = v_country
     and rc.method = v_method
   order by rc.base_cents asc, rc.created_at desc
   limit 1;

  if v_rc.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_RATE_SET', 'message', 'No rate set');
  end if;

  -- 2. Active 3PL fee version
  select *
    into v_fv
    from public.fee_versions
   where status = 'active'
   limit 1;

  if v_fv.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_FEE_VERSION', 'message', 'No active processing fee schedule');
  end if;

  -- 3. Evaluate all order lines (accumulate Σ actual weight & Σ box volume across the combined parcel)
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line ->> 'qty')::int, 0);
    if v_qty <= 0 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_QTY', 'message', 'Line quantity must be >= 1');
    end if;

    select * into v_var from public.dropship_variants where id = (v_line ->> 'variant_id')::uuid;
    if v_var.id is null then
      return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'Variant not found');
    end if;

    select * into v_prod from public.dropship_products where id = v_var.product_id;
    if v_prod.id is null or (not v_is_staff and (v_prod.status <> 'active' or not public.dropship_product_supplier_eligible(v_prod))) then
      return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_AVAILABLE', 'message', 'Product is not available');
    end if;

    select * into v_im from public.item_master where id = v_var.item_id;
    if public.calc_billed_weight_g(v_im.id, v_rc.volumetric_divisor, v_rc.step_g) is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'WEIGHT_SIZE_MISSING',
        'needs_data', true,
        'message', 'Weight/size missing'
      );
    end if;

    if (v_im.has_battery and not v_rc.allows_battery)
       or (v_im.has_liquid and not v_rc.allows_liquid)
       or (v_im.has_magnet and not v_rc.allows_magnet)
       or (v_im.has_powder and not v_rc.allows_powder) then
      return jsonb_build_object('ok', false, 'code', 'RESTRICTED_ITEM', 'message', 'Selected shipping method does not support this item');
    end if;

    v_sum_actual_weight_g := v_sum_actual_weight_g + (v_im.weight_g::bigint * v_qty::bigint);
    v_sum_box_volume_cm3 := v_sum_box_volume_cm3 + ((v_im.box_l_cm * v_im.box_w_cm * v_im.box_h_cm) * v_qty::numeric);
    v_total_qty := v_total_qty + v_qty;

    -- Resolve unit product price (explicit product_price_cents when set, else route base product price)
    if v_prod.product_price_cents is not null then
      v_unit_prod_cents := greatest(0, v_prod.product_price_cents + v_var.price_adjust_cents);
    else
      select * into v_route
        from public.dropship_routes r
       where r.product_id = v_prod.id
         and r.destination_country = v_country
         and r.shipping_method = v_method
         and r.is_active
       limit 1;
      if v_route.id is null then
        return jsonb_build_object('ok', false, 'code', 'NO_PRODUCT_PRICE', 'message', 'No product price set for this destination');
      end if;
      v_unit_prod_cents := greatest(0, (v_route.landed_price_cents - v_route.est_shipping_cents - v_route.est_duties_cents) + v_var.price_adjust_cents);
    end if;

    v_line_prod_cents := v_unit_prod_cents * v_qty::bigint;
    v_product_cents := v_product_cents + v_line_prod_cents;

    -- Duty base per line:
    --  · catalogue mode -> Octopus product price (estimate)
    --  · order mode -> buyer's paid item price converted to USD cents at locked FX rate
    if v_quote_mode = 'catalogue' then
      v_all_buyer_prices_supplied := false;
      v_line_declared_usd_cents := v_line_prod_cents;
    elsif (v_line ? 'buyer_paid_cents') and v_line -> 'buyer_paid_cents' <> 'null'::jsonb then
      v_line_buyer_minor := (v_line ->> 'buyer_paid_cents')::bigint;
      if v_line_buyer_minor < 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'buyer_paid_cents must be >= 0');
      end if;
      v_line_declared_usd_cents := round(v_line_buyer_minor::numeric * v_fx)::bigint;
    elsif (v_line ? 'buyer_unit_price_cents') and v_line -> 'buyer_unit_price_cents' <> 'null'::jsonb then
      v_line_buyer_minor := (v_line ->> 'buyer_unit_price_cents')::bigint * v_qty::bigint;
      if v_line_buyer_minor < 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'buyer_unit_price_cents must be >= 0');
      end if;
      v_line_declared_usd_cents := round(v_line_buyer_minor::numeric * v_fx)::bigint;
    else
      v_all_buyer_prices_supplied := false;
      v_line_declared_usd_cents := v_line_prod_cents;
    end if;

    v_declared_value_usd_cents := v_declared_value_usd_cents + v_line_declared_usd_cents;
    v_duty_lines := v_duty_lines || jsonb_build_array(
      jsonb_build_object('hs_code', v_im.hs_code, 'declared_usd_cents', v_line_declared_usd_cents)
    );
  end loop;

  -- Combined parcel billed weight = max(Σ actual weight, ceil((Σ box volume / divisor) * 1000)), rounded up to step_g (100 g)
  v_combined_vol_g := ceil((v_sum_box_volume_cm3 / v_rc.volumetric_divisor) * 1000.0)::bigint;
  v_raw_parcel_weight_g := greatest(v_sum_actual_weight_g, v_combined_vol_g);
  v_billed_weight_g := (ceil(v_raw_parcel_weight_g::numeric / v_rc.step_g::numeric)::integer * v_rc.step_g);
  if v_billed_weight_g > v_rc.max_weight_g then
    return jsonb_build_object('ok', false, 'code', 'MAX_WEIGHT_EXCEEDED', 'message', 'Order exceeds maximum weight for this shipping method');
  end if;

  -- Item 13: Processing fee is charged ONCE per ORDER (first item once + extra per additional item across all lines + packaging once)
  v_processing_cents := v_fv.pick_pack_first_cents
    + (greatest(0, v_total_qty - 1)::bigint * v_fv.pick_pack_extra_cents)
    + v_fv.packaging_cents;

  v_shipping_cents := v_rc.base_cents
    + ((v_billed_weight_g / v_rc.step_g)::bigint * v_rc.per_100g_cents);

  if v_incoterm = 'DAP' then
    v_duties_known := true;
    v_duties_cents := 0;
    v_duties_status := 'known';
  else
    for v_dl_elem in select * from jsonb_array_elements(v_duty_lines) loop
      v_duty_lookup := public.lookup_duty_rate(v_country, v_dl_elem ->> 'hs_code');
      if v_duty_lookup is null then
        v_duties_known := false;
        v_duties_cents := null;
        exit;
      end if;
      v_duty_ver_id := (v_duty_lookup ->> 'duty_rate_version_id')::uuid;
      v_duty_bp := (v_duty_lookup ->> 'duty_bp')::int;
      v_tax_bp := (v_duty_lookup ->> 'tax_bp')::int;
      v_de_min := (v_duty_lookup ->> 'de_minimis_cents')::int;
      v_elem_decl := (v_dl_elem ->> 'declared_usd_cents')::bigint;
      if v_declared_value_usd_cents <= v_de_min then
        v_duties_cents := v_duties_cents + round(v_elem_decl::numeric * v_tax_bp::numeric / 10000.0)::bigint;
      else
        v_duties_cents := v_duties_cents + round(v_elem_decl::numeric * (v_duty_bp + v_tax_bp)::numeric / 10000.0)::bigint;
      end if;
    end loop;

    if not v_duties_known then
      v_duties_status := 'not_known_yet';
    elsif v_quote_mode = 'catalogue' or not v_all_buyer_prices_supplied then
      v_duties_status := 'estimate';
    else
      v_duties_status := 'known';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'country', v_country,
    'shipping_method', v_method,
    'incoterm', v_incoterm,
    'total_qty', v_total_qty,
    'actual_weight_g', v_sum_actual_weight_g,
    'volumetric_weight_g', v_combined_vol_g,
    'billed_weight_g', v_billed_weight_g,
    'days_min', v_rc.days_min,
    'days_max', v_rc.days_max,
    'product_cents', v_product_cents,
    'processing_cents', v_processing_cents,
    'shipping_cents', v_shipping_cents,
    'declared_value_usd_cents', v_declared_value_usd_cents,
    'duty_basis', case
      when v_quote_mode = 'catalogue' or not v_all_buyer_prices_supplied then 'product_price'
      else 'buyer_paid_price_usd'
    end,
    'duties_cents', v_duties_cents,
    'duties_status', v_duties_status,
    'duties_label', case when v_duties_known then null else 'not known yet' end,
    'total_known_cents', v_product_cents + v_processing_cents + v_shipping_cents + coalesce(v_duties_cents, 0),
    'total_cents', case
      when v_duties_known then v_product_cents + v_processing_cents + v_shipping_cents + v_duties_cents
      else null
    end,
    'version_ids', jsonb_build_object(
      'shipping_rate_card_id', v_rc.id,
      'fee_version_id', v_fv.id,
      'duty_rate_version_id', v_duty_ver_id
    )
  );
end $$;

comment on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) is
  'Order-level 4-part quote engine. Processing fee is charged ONCE per order (first + extra*(total_qty-1) + packaging). Combined parcel billed weight = max(sum(actual weight_g), ceil((sum(box_volume_cm3)/divisor)*1000)) rounded up to 100 g step (pack-station re-weigh corrects later within 50 g / 10% tolerance). Duty base: catalogue/product quotes use Octopus product price and mark duties_status = ''estimate''; order quotes use the buyer''s paid item price converted to USD cents at the locked FX rate. Final customs valuation rule is set in Step 6b.';

revoke all on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) to authenticated, service_role;

-- Single-product catalogue quote preview: uses Octopus product price as declared value and marks duties_status = 'estimate' (final rule set in Step 6b)
create or replace function public.get_dropship_quote(
  p_variant_id uuid,
  p_country text,
  p_method text,
  p_qty integer default 1,
  p_incoterm text default 'DDP'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_dropship_order_quote(
    jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'qty', greatest(1, coalesce(p_qty, 1)))),
    p_country,
    p_method,
    p_incoterm,
    'USD',
    null,
    'catalogue'
  )
$$;

comment on function public.get_dropship_quote(uuid, text, text, integer, text) is
  'Catalogue/product quote preview. Uses Octopus product price as declared customs value and marks duties_status = ''estimate'' (order quotes in get_dropship_order_quote use buyer paid item price converted to USD at locked FX rate; final rule is set in Step 6b).';

revoke all on function public.get_dropship_quote(uuid, text, text, integer, text) from public, anon;
grant execute on function public.get_dropship_quote(uuid, text, text, integer, text) to authenticated, service_role;

-- Update staff helper dropship_rate_estimate to read shipping_rate_cards + active fee_versions + lookup_duty_rate (never dropship_rates)
create or replace function public.dropship_rate_estimate(
  p_weight_g integer,
  p_unit_cost_cents bigint,
  p_country text,
  p_method text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rc public.shipping_rate_cards;
  fv public.fee_versions;
  v_dl jsonb;
  v_step_units bigint;
  v_ship bigint;
  v_fee bigint;
  v_duty bigint;
begin
  if auth.uid() is not null and not (is_staff() and dropship_can_see_costs(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into rc
    from public.shipping_rate_cards
   where active
     and country = upper(btrim(coalesce(p_country, '')))::char(2)
     and method = lower(btrim(coalesce(p_method, '')))
     and greatest(1, coalesce(p_weight_g, 250)) <= max_weight_g
   order by base_cents asc
   limit 1;

  if rc.id is null then
    return null;
  end if;

  select * into fv from public.fee_versions where status = 'active' limit 1;
  v_fee := coalesce(fv.pick_pack_first_cents + fv.packaging_cents, 0);
  v_step_units := ceil(greatest(1, coalesce(p_weight_g, 250))::numeric / rc.step_g::numeric)::bigint;
  v_ship := rc.base_cents + (v_step_units * rc.per_100g_cents) + v_fee;

  v_dl := public.lookup_duty_rate(rc.country, null);
  if v_dl is null then
    v_duty := 0;
  else
    v_duty := round(
      greatest(0, coalesce(p_unit_cost_cents, 0))::numeric
      * (((v_dl ->> 'duty_bp')::int + (v_dl ->> 'tax_bp')::int)::numeric)
      / 10000.0
    )::bigint;
  end if;

  return jsonb_build_object(
    'country', rc.country,
    'shipping_method', rc.method,
    'est_shipping_cents', v_ship,
    'est_duties_cents', v_duty,
    'fee_cents', v_fee,
    'est_days_min', rc.days_min,
    'est_days_max', rc.days_max,
    'allows_battery', rc.allows_battery,
    'allows_liquid', rc.allows_liquid
  );
end $$;

revoke all on function public.dropship_rate_estimate(integer, bigint, text, text) from public, anon;
grant execute on function public.dropship_rate_estimate(integer, bigint, text, text) to authenticated, service_role;
