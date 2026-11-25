-- 20261101000221_ea1_staff_fees_rates_duty.sql
-- Release 1 · EA-1 (staff half of Step 6b): fee versions, shipping rate cards and duty rate versions — the database side of the new
-- /office/dropship/fees and /office/dropship/compliance screens. Everything is audit-logged; Support can read fee
-- versions and the duty table but cannot change anything and cannot read rate cards (Batch 1 rule); customers get nothing.
--  1. Fees: reject_fee_version(), list_fee_versions() (history with names).
--  2. Rate cards: list_shipping_rate_cards() (staff read incl. hidden carrier columns),
--     preview_shipping_rate_card_import() (no writes: new / changed / unchanged / invalid),
--     import_shipping_rate_cards() (one transaction; a change replaces an active card ONLY when staff ticked its key).
--  0. Fee versions carry weighing tolerance (g / %) + dispute window; rate cards carry fuel surcharge % and a
--     remote-area fee. Fuel is added to the shipping line in every quote (0 = no change); the remote-area fee is only
--     flagged as "may apply" until postcodes are known (Release 3).
--  3. Duty: per-entry source + status (needs_data / verify / confirmed); unknown rates stay NULL until confirmed;
--     upsert / delete entries while draft; submit for approval; activate needs a second person and every entry confirmed.
--  4–6. Design v2 (StaffRateCards / StaffDutyEntries / StaffCompliance): rate cards are proposed (CSV price list or one card)
--     and published only after a second person approves (rate_card_imports; staff can no longer publish directly);
--     test quote with billed weight; duty entries are confirmed by a second person and a submitted version can be sent back;
--     versioned customs value policy (two-person); data completeness. Editors of rate cards: 3PL & Shipping, DS editors, admin.
-- Down: supabase/migrations/down/20261101000221_ea1_staff_fees_rates_duty.down.sql

-- ───────── 0. EA-1 additions: weighing tolerance on fee versions; fuel surcharge + remote-area fee on rate cards ─────────
alter table public.fee_versions
  add column if not exists weigh_tolerance_g integer check (weigh_tolerance_g is null or weigh_tolerance_g >= 0),
  add column if not exists weigh_tolerance_pct numeric(5,2) check (weigh_tolerance_pct is null or (weigh_tolerance_pct >= 0 and weigh_tolerance_pct <= 100)),
  add column if not exists dispute_window_days integer check (dispute_window_days is null or (dispute_window_days >= 0 and dispute_window_days <= 90)),
  -- design v2 StaffFees: "Branded packaging handling" (NULL = not set yet; never shown as 0)
  add column if not exists branded_packaging_cents bigint check (branded_packaging_cents is null or branded_packaging_cents >= 0);

-- design v2 StaffRateCards: price lists are imported as a proposal and published only after a second person approves.
create table if not exists public.rate_card_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('csv', 'manual')),
  file_name text,
  column_map jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  replace_keys text[] not null default '{}',
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected')),
  note text,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  reject_reason text,
  effective_from timestamptz,
  published jsonb,
  division_id uuid not null default division_id_of('3PL') references public.divisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_card_imports_two_person check (status <> 'approved' or (decided_by is not null and decided_by <> proposed_by)),
  constraint rate_card_imports_3pl check (division_id = division_id_of('3PL'))
);
create index if not exists rate_card_imports_status_idx on public.rate_card_imports (status, created_at desc);
comment on table public.rate_card_imports is 'EA-1: carrier price-list imports and single new rate cards waiting for a second person. Read and written only through security-definer functions.';
alter table public.rate_card_imports enable row level security;
revoke all on public.rate_card_imports from public, anon, authenticated;
grant all on public.rate_card_imports to service_role;

alter table public.shipping_rate_cards
  add column if not exists fuel_surcharge_bp integer not null default 0 check (fuel_surcharge_bp >= 0 and fuel_surcharge_bp <= 10000),
  add column if not exists remote_area_fee_cents bigint check (remote_area_fee_cents is null or remote_area_fee_cents >= 0),
  add column if not exists import_id uuid references public.rate_card_imports(id) on delete restrict;

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
     or new.weigh_tolerance_g is distinct from old.weigh_tolerance_g
     or new.weigh_tolerance_pct is distinct from old.weigh_tolerance_pct
     or new.dispute_window_days is distinct from old.dispute_window_days
     or new.branded_packaging_cents is distinct from old.branded_packaging_cents
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
     or new.fuel_surcharge_bp is distinct from old.fuel_surcharge_bp
     or new.remote_area_fee_cents is distinct from old.remote_area_fee_cents
     or new.import_id is distinct from old.import_id
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

drop function if exists public.propose_fee_version(bigint, bigint, bigint, bigint, bigint, text);
create or replace function public.propose_fee_version(
  p_pick_pack_first_cents bigint,
  p_pick_pack_extra_cents bigint,
  p_packaging_cents bigint default 0,
  p_storage_per_cbm_day_cents bigint default 0,
  p_return_handling_cents bigint default 0,
  p_note text default null,
  p_weigh_tolerance_g integer default null,
  p_weigh_tolerance_pct numeric default null,
  p_dispute_window_days integer default null,
  p_branded_packaging_cents bigint default null
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

  if (p_weigh_tolerance_g is not null and p_weigh_tolerance_g < 0)
     or (p_weigh_tolerance_pct is not null and (p_weigh_tolerance_pct < 0 or p_weigh_tolerance_pct > 100))
     or (p_dispute_window_days is not null and (p_dispute_window_days < 0 or p_dispute_window_days > 90))
     or (p_branded_packaging_cents is not null and p_branded_packaging_cents < 0) then
    raise exception 'INVALID_FEE_VERSION: tolerance must be 0 g or more, 0–100 %%, dispute window 0–90 days';
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
    proposed_by,
    weigh_tolerance_g,
    weigh_tolerance_pct,
    dispute_window_days,
    branded_packaging_cents
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
    v_uid,
    p_weigh_tolerance_g,
    p_weigh_tolerance_pct,
    p_dispute_window_days,
    p_branded_packaging_cents
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
      'packaging_cents', coalesce(p_packaging_cents, 0),
      'weigh_tolerance_g', p_weigh_tolerance_g,
      'weigh_tolerance_pct', p_weigh_tolerance_pct,
      'dispute_window_days', p_dispute_window_days,
      'branded_packaging_cents', p_branded_packaging_cents
    )
  );

  return v_id;
end $$;

revoke all on function public.propose_fee_version(bigint, bigint, bigint, bigint, bigint, text, integer, numeric, integer, bigint) from public, anon;
grant execute on function public.propose_fee_version(bigint, bigint, bigint, bigint, bigint, text, integer, numeric, integer, bigint) to authenticated, service_role;

drop function if exists public.publish_shipping_rate_card(text, text, text, text, bigint, bigint, integer, integer, integer, numeric, integer, boolean, boolean, boolean, boolean, text);
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
  p_service_label text default null,
  p_fuel_surcharge_bp integer default 0,
  p_remote_area_fee_cents bigint default null,
  p_import_id uuid default null
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
  -- EA-1 (design v2): staff never publish directly. EXECUTE is granted to service_role only; staff publish through
  -- approve_rate_card_import() (a second person approves a proposal), which calls this function as its owner.
  if coalesce(p_fuel_surcharge_bp, 0) < 0 or coalesce(p_fuel_surcharge_bp, 0) > 10000 or coalesce(p_remote_area_fee_cents, 0) < 0 then
    raise exception 'INVALID_RATE_CARD: fuel surcharge must be 0–100 %% and the remote-area fee cannot be negative';
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
    fuel_surcharge_bp,
    remote_area_fee_cents,
    import_id,
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
    coalesce(p_fuel_surcharge_bp, 0),
    p_remote_area_fee_cents,
    p_import_id,
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
      'per_100g_cents', p_per_100g_cents,
      'fuel_surcharge_bp', coalesce(p_fuel_surcharge_bp, 0),
      'remote_area_fee_cents', p_remote_area_fee_cents,
      'import_id', p_import_id
    )
  );

  return v_id;
end $$;

revoke all on function public.publish_shipping_rate_card(text, text, text, text, bigint, bigint, integer, integer, integer, numeric, integer, boolean, boolean, boolean, boolean, text, integer, bigint, uuid) from public, anon, authenticated;
grant execute on function public.publish_shipping_rate_card(text, text, text, text, bigint, bigint, integer, integer, integer, numeric, integer, boolean, boolean, boolean, boolean, text, integer, bigint, uuid) to service_role;

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
  v_tier_cents bigint;
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
  v_de_min_applies text;
begin
  if not v_is_staff then
    v_org := dropship_merchant_org();
    if v_uid is null or v_org is null then
      raise exception 'DROPSHIP_NOT_ENABLED';
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

  select *
    into v_fv
    from public.fee_versions
   where status = 'active'
   limit 1;

  if v_fv.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_FEE_VERSION', 'message', 'No active processing fee schedule');
  end if;

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
    if v_prod.id is null
       or (
         not v_is_staff
         and (
           v_prod.status <> 'active'
           or (v_prod.visible_to_org_id is not null and v_prod.visible_to_org_id <> v_org)
           or not public.dropship_product_supplier_eligible(v_prod)
         )
       ) then
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

    v_tier_cents := null;
    select t.unit_price_cents
      into v_tier_cents
      from public.dropship_price_tiers t
     where t.product_id = v_prod.id
       and t.min_qty <= v_qty
     order by t.min_qty desc
     limit 1;

    if v_tier_cents is not null then
      v_unit_prod_cents := greatest(0, v_tier_cents + v_var.price_adjust_cents);
    elsif v_prod.product_price_cents is not null then
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

  v_combined_vol_g := ceil((v_sum_box_volume_cm3 / v_rc.volumetric_divisor) * 1000.0)::bigint;
  v_raw_parcel_weight_g := greatest(v_sum_actual_weight_g, v_combined_vol_g);
  v_billed_weight_g := (ceil(v_raw_parcel_weight_g::numeric / v_rc.step_g::numeric)::integer * v_rc.step_g);
  if v_billed_weight_g > v_rc.max_weight_g then
    return jsonb_build_object('ok', false, 'code', 'MAX_WEIGHT_EXCEEDED', 'message', 'Order exceeds maximum weight for this shipping method');
  end if;

  v_processing_cents := v_fv.pick_pack_first_cents
    + (greatest(0, v_total_qty - 1)::bigint * v_fv.pick_pack_extra_cents)
    + v_fv.packaging_cents;

  v_shipping_cents := v_rc.base_cents
    + ((v_billed_weight_g / v_rc.step_g)::bigint * v_rc.per_100g_cents);
  -- EA-1: carrier fuel surcharge on the shipping line (0 unless the rate card sets one)
  v_shipping_cents := v_shipping_cents + round(v_shipping_cents::numeric * coalesce(v_rc.fuel_surcharge_bp, 0) / 10000.0)::bigint;

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
      v_de_min_applies := coalesce(v_duty_lookup ->> 'de_minimis_applies_to', 'duty');
      v_elem_decl := (v_dl_elem ->> 'declared_usd_cents')::bigint;
      if v_declared_value_usd_cents <= v_de_min then
        if v_de_min_applies = 'duty_and_tax' then
          v_duties_cents := v_duties_cents + 0;
        else
          v_duties_cents := v_duties_cents + round(v_elem_decl::numeric * v_tax_bp::numeric / 10000.0)::bigint;
        end if;
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
    'fuel_surcharge_bp', coalesce(v_rc.fuel_surcharge_bp, 0),
    -- remote-area fee depends on the buyer postcode (Release 3): only say it may apply, never guess an amount
    'remote_area_fee_may_apply', coalesce(v_rc.remote_area_fee_cents, 0) > 0,
    'declared_value_usd_cents', v_declared_value_usd_cents,
    'duty_basis', case
      when v_quote_mode = 'catalogue' or not v_all_buyer_prices_supplied then 'product_price'
      else 'buyer_paid_price_usd'
    end,
    'duties_cents', v_duties_cents,
    'duties_status', v_duties_status,
    'duties_label', case
      when v_incoterm = 'DAP' then 'Duties paid by buyer'
      when v_duties_known then null
      else 'not known yet'
    end,
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
  'Order-level 4-part quote engine. Enforces DROPSHIP_NOT_ENABLED for non-enabled callers, visible_to_org_id, and dropship_price_tiers volume tiers. Processing fee is charged ONCE per order (first + extra*(total_qty-1) + packaging). Combined parcel billed weight = max(sum(actual weight_g), ceil((sum(box_volume_cm3)/divisor)*1000)) rounded up to 100 g step. DAP returns duties_cents = 0 and duties_label = ''Duties paid by buyer''. Final customs valuation rule is set in Step 6b.';

revoke all on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) to authenticated, service_role;

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
  elsif not (
    is_staff()
    and not distributor_restricted()
    and (
      is_admin()
      or can('orders', 'edit')
      or can('warehouse', 'view')
      or can('finance', 'view')
      or dropship_can_see_costs(division_id_of('DS'))
    )
  ) then
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
             round(
               (
                 rc.base_cents
                 + (ceil(v_weight::numeric / rc.step_g::numeric)::bigint * rc.per_100g_cents)
               )::numeric * (10000 + coalesce(rc.fuel_surcharge_bp, 0)) / 10000.0
             )::bigint * v_parcels::bigint
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
  v_ship := round((rc.base_cents + (v_step_units * rc.per_100g_cents))::numeric * (10000 + coalesce(rc.fuel_surcharge_bp, 0)) / 10000.0)::bigint + v_fee;

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

-- ───────── helpers ─────────
create or replace function public.step6b_staff_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and not distributor_restricted()
     and (in_division(division_id_of('3PL')) or in_division(division_id_of('DS')) or can('finance', 'view') or is_admin())
$$;
revoke all on function public.step6b_staff_read() from public, anon;
grant execute on function public.step6b_staff_read() to authenticated, service_role;

create or replace function public.step6b_rate_card_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- same rule as the shipping_rate_cards_staff_read policy (Batch 1): no Support, no content editors
  select is_staff() and not distributor_restricted()
     and (
       is_admin() or can('finance', 'view') or can('orders', 'edit') or can('warehouse', 'view')
       or exists (select 1 from public.division_members m
                   where m.user_id = auth.uid() and m.division_id in (division_id_of('3PL'), division_id_of('DS')))
     )
$$;
revoke all on function public.step6b_rate_card_read() from public, anon;
grant execute on function public.step6b_rate_card_read() to authenticated, service_role;

create or replace function public.step6b_duty_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and not distributor_restricted()
     and (is_admin() or can('finance', 'approve') or can('products', 'approve') or dropship_can_edit(division_id_of('DS')))
$$;
revoke all on function public.step6b_duty_edit() from public, anon;
grant execute on function public.step6b_duty_edit() to authenticated, service_role;

-- design v2 StaffRateCards: "Shipping division + Dropship managers edit". The database has one '3PL & Shipping' division.
create or replace function public.rate_card_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and not distributor_restricted()
     and (is_admin() or public.warehouse_can_edit() or dropship_can_edit(division_id_of('DS')))
$$;
revoke all on function public.rate_card_can_edit() from public, anon;
grant execute on function public.rate_card_can_edit() to authenticated, service_role;

-- design v2 StaffDutyEntries / StaffCompliance: who may publish a duty or customs-policy version (always a second person)
create or replace function public.step6b_duty_publish()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and not distributor_restricted()
     and (is_admin() or can('finance', 'approve') or dropship_can_edit(division_id_of('DS')))
$$;
revoke all on function public.step6b_duty_publish() from public, anon;
grant execute on function public.step6b_duty_publish() to authenticated, service_role;

-- ───────── 1. Fees ─────────
create or replace function public.reject_fee_version(p_fee_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target public.fee_versions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not (is_staff() and (is_admin() or public.warehouse_can_edit() or can('finance', 'approve'))) then
    raise exception 'FORBIDDEN: only 3PL staff, Finance approvers, or an admin may reject a fee version';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED: enter why this fee version is rejected';
  end if;
  select * into v_target from public.fee_versions where id = p_fee_version_id for update;
  if v_target.id is null then raise exception 'NOT_FOUND'; end if;
  if v_target.status <> 'pending_approval' then
    raise exception 'FEE_VERSION_BAD_STATUS: only pending_approval fee versions can be rejected (got %)', v_target.status;
  end if;

  perform set_config('octopus.allow_fee_version_transition', 'true', true);
  begin
    update public.fee_versions
       set status = 'rejected',
           note = coalesce(note || E'\n', '') || 'Rejected: ' || v_reason
     where id = p_fee_version_id;
  exception when others then
    perform set_config('octopus.allow_fee_version_transition', '', true);
    raise;
  end;
  perform set_config('octopus.allow_fee_version_transition', '', true);

  perform write_audit('fee_version.rejected', 'fee_versions', p_fee_version_id::text,
    jsonb_build_object('version', v_target.version, 'reason', v_reason));
  return jsonb_build_object('rejected_id', p_fee_version_id, 'version', v_target.version);
end $$;
revoke all on function public.reject_fee_version(uuid, text) from public, anon;
grant execute on function public.reject_fee_version(uuid, text) to authenticated, service_role;

create or replace function public.list_fee_versions()
returns table (
  id uuid, version integer, status text,
  pick_pack_first_cents bigint, pick_pack_extra_cents bigint, packaging_cents bigint,
  storage_per_cbm_day_cents bigint, return_handling_cents bigint,
  weigh_tolerance_g integer, weigh_tolerance_pct numeric, dispute_window_days integer, branded_packaging_cents bigint,
  insurance_bp integer, effective_from timestamptz, superseded_at timestamptz, note text,
  proposed_by uuid, proposed_by_name text, approved_by uuid, approved_by_name text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.step6b_staff_read() then raise exception 'FORBIDDEN'; end if;
  return query
    select f.id, f.version, f.status, f.pick_pack_first_cents, f.pick_pack_extra_cents, f.packaging_cents,
           f.storage_per_cbm_day_cents, f.return_handling_cents, f.weigh_tolerance_g, f.weigh_tolerance_pct, f.dispute_window_days, f.branded_packaging_cents,
           f.insurance_bp, f.effective_from, f.superseded_at, f.note,
           f.proposed_by, pp.full_name, f.approved_by, pa.full_name, f.created_at
      from public.fee_versions f
      left join public.profiles pp on pp.id = f.proposed_by
      left join public.profiles pa on pa.id = f.approved_by
     order by f.version desc;
end $$;
revoke all on function public.list_fee_versions() from public, anon;
grant execute on function public.list_fee_versions() to authenticated, service_role;

-- ───────── 2. Shipping rate cards ─────────
create or replace function public.list_shipping_rate_cards(p_include_inactive boolean default false)
returns table (
  id uuid, carrier_code text, carrier_name text, method text, carrier_service_code text, service_label text,
  country text, base_cents bigint, per_100g_cents bigint, step_g integer, max_weight_g integer,
  volumetric_divisor numeric, days_min integer, days_max integer,
  allows_battery boolean, allows_liquid boolean, allows_magnet boolean, allows_powder boolean,
  fuel_surcharge_bp integer, remote_area_fee_cents bigint,
  version integer, effective_from timestamptz, active boolean, used_count bigint, created_by_name text, created_at timestamptz,
  import_id uuid, proposed_by_name text, approved_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.step6b_rate_card_read() then raise exception 'FORBIDDEN'; end if;
  return query
    select r.id, r.carrier_code, c.name, r.method, r.carrier_service_code, r.service_label, r.country::text,
           r.base_cents, r.per_100g_cents, r.step_g, r.max_weight_g, r.volumetric_divisor, r.days_min, r.days_max,
           r.allows_battery, r.allows_liquid, r.allows_magnet, r.allows_powder,
           r.fuel_surcharge_bp, r.remote_area_fee_cents,
           r.version, r.effective_from, r.active, r.used_count, p.full_name, r.created_at,
           r.import_id, pp.full_name, pa.full_name
      from public.shipping_rate_cards r
      left join public.carriers c on lower(c.code) = lower(r.carrier_code)
      left join public.profiles p on p.id = r.created_by
      left join public.rate_card_imports i on i.id = r.import_id
      left join public.profiles pp on pp.id = i.proposed_by
      left join public.profiles pa on pa.id = i.decided_by
     where p_include_inactive or r.active
     order by r.country, r.carrier_code, r.method, r.version desc;
end $$;
revoke all on function public.list_shipping_rate_cards(boolean) from public, anon;
grant execute on function public.list_shipping_rate_cards(boolean) to authenticated, service_role;

-- Normalises and validates import rows; returns one row per input row. NO writes.
create or replace function public.preview_shipping_rate_card_import(p_rows jsonb)
returns table (
  row_no integer, rate_key text, action text, reason text,
  replaces_ids uuid[], current_version integer, changes jsonb, normalized jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e jsonb;
  i integer := 0;
  v_carrier text; v_method text; v_svc text; v_country text; v_label text;
  v_base bigint; v_per bigint; v_step integer; v_max integer; v_div numeric; v_dmin integer; v_dmax integer;
  v_bat boolean; v_liq boolean; v_mag boolean; v_pow boolean;
  v_fuel integer; v_remote bigint;
  v_key text; v_reason text; v_norm jsonb; v_ids uuid[]; v_cur public.shipping_rate_cards; v_changes jsonb;
  v_seen text[] := '{}';
  v_n integer;
  function_num_ok boolean;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') <> 'service_role'
     and not public.rate_card_can_edit() then
    raise exception 'FORBIDDEN: only 3PL & Shipping editors, Dropship editors or an admin may import shipping rate cards';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_IMPORT: rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'IMPORT_TOO_LARGE: at most 2,000 rows per import';
  end if;

  for e in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_reason := null; v_ids := '{}'; v_cur := null; v_changes := '{}'::jsonb;
    v_carrier := lower(btrim(coalesce(e ->> 'carrier_code', '')));
    v_method := lower(btrim(coalesce(e ->> 'method', '')));
    v_svc := upper(btrim(coalesce(e ->> 'carrier_service_code', '')));
    v_country := upper(btrim(coalesce(e ->> 'country', '')));
    v_label := nullif(btrim(coalesce(e ->> 'service_label', '')), '');
    v_key := v_carrier || '|' || v_method || '|' || v_country;

    -- numbers: reject anything that is not a whole number instead of guessing
    begin
      v_base := (e ->> 'base_cents')::bigint;
      v_per := (e ->> 'per_100g_cents')::bigint;
      v_step := coalesce(nullif(e ->> 'step_g', '')::integer, 100);
      v_max := coalesce(nullif(e ->> 'max_weight_g', '')::integer, 30000);
      v_div := coalesce(nullif(e ->> 'volumetric_divisor', '')::numeric, 5000);
      v_dmin := (e ->> 'days_min')::integer;
      v_dmax := (e ->> 'days_max')::integer;
      v_bat := coalesce((e ->> 'allows_battery')::boolean, false);
      v_liq := coalesce((e ->> 'allows_liquid')::boolean, false);
      v_mag := coalesce((e ->> 'allows_magnet')::boolean, false);
      v_pow := coalesce((e ->> 'allows_powder')::boolean, false);
      v_fuel := coalesce(nullif(e ->> 'fuel_surcharge_bp', '')::integer, 0);
      v_remote := nullif(e ->> 'remote_area_fee_cents', '')::bigint;
      function_num_ok := true;
    exception when others then
      function_num_ok := false;
    end;

    if not function_num_ok then
      v_reason := 'Numbers must be whole numbers (cents, grams, days) and yes/no must be true or false';
    elsif v_carrier = '' or not exists (select 1 from public.carriers c where lower(c.code) = v_carrier) then
      v_reason := 'Unknown carrier code';
    elsif v_method not in ('economy', 'standard', 'express') then
      v_reason := 'Method must be economy, standard or express';
    elsif v_svc = '' then
      v_reason := 'Carrier service code is required';
    elsif v_country !~ '^[A-Z]{2}$' then
      v_reason := 'Country must be a 2-letter ISO code';
    elsif v_base is null or v_base < 0 or v_per is null or v_per < 0 then
      v_reason := 'Base and per-100 g prices are required and cannot be negative';
    elsif v_step <= 0 or v_max <= 0 or v_max > 70000 or v_div <= 0 then
      v_reason := 'Weight step, maximum weight (up to 70,000 g) and volumetric divisor must be above 0';
    elsif v_dmin is null or v_dmax is null or v_dmin <= 0 or v_dmax < v_dmin then
      v_reason := 'Delivery days: minimum above 0 and maximum not below minimum';
    elsif v_fuel < 0 or v_fuel > 10000 or coalesce(v_remote, 0) < 0 then
      v_reason := 'Fuel surcharge must be 0–100 % and the remote-area fee cannot be negative';
    elsif v_key = any (v_seen) then
      v_reason := 'Duplicate row for the same carrier, method and country in this file';
    end if;

    v_norm := jsonb_build_object(
      'carrier_code', v_carrier, 'method', v_method, 'carrier_service_code', v_svc, 'service_label', v_label,
      'country', v_country, 'base_cents', v_base, 'per_100g_cents', v_per, 'step_g', v_step, 'max_weight_g', v_max,
      'volumetric_divisor', v_div, 'days_min', v_dmin, 'days_max', v_dmax,
      'allows_battery', v_bat, 'allows_liquid', v_liq, 'allows_magnet', v_mag, 'allows_powder', v_pow,
      'fuel_surcharge_bp', v_fuel, 'remote_area_fee_cents', v_remote);

    if v_reason is not null then
      row_no := i; rate_key := v_key; action := 'invalid'; reason := v_reason;
      replaces_ids := '{}'; current_version := null; changes := '{}'::jsonb; normalized := v_norm;
      return next;
      continue;
    end if;
    v_seen := v_seen || v_key;

    -- the cards publish_shipping_rate_card() would retire for this row
    select coalesce(array_agg(r.id order by r.version desc), '{}'), count(*)
      into v_ids, v_n
      from public.shipping_rate_cards r
     where r.active
       and lower(btrim(r.carrier_code)) = v_carrier
       and r.country = v_country::char(2)
       and (r.method = v_method or upper(btrim(r.carrier_service_code)) = v_svc);

    select * into v_cur from public.shipping_rate_cards r
     where r.active and lower(btrim(r.carrier_code)) = v_carrier and r.country = v_country::char(2) and r.method = v_method
     limit 1;

    if v_n = 0 then
      row_no := i; rate_key := v_key; action := 'new'; reason := null;
      replaces_ids := '{}'; current_version := null; changes := '{}'::jsonb; normalized := v_norm;
      return next;
      continue;
    end if;

    if v_cur.id is not null then
      select coalesce(jsonb_object_agg(k, jsonb_build_object('from', o, 'to', n)), '{}'::jsonb) into v_changes
        from (values
          ('carrier_service_code', to_jsonb(upper(btrim(v_cur.carrier_service_code))), to_jsonb(v_svc)),
          ('service_label', to_jsonb(v_cur.service_label), to_jsonb(v_label)),
          ('base_cents', to_jsonb(v_cur.base_cents), to_jsonb(v_base)),
          ('per_100g_cents', to_jsonb(v_cur.per_100g_cents), to_jsonb(v_per)),
          ('step_g', to_jsonb(v_cur.step_g), to_jsonb(v_step)),
          ('max_weight_g', to_jsonb(v_cur.max_weight_g), to_jsonb(v_max)),
          ('volumetric_divisor', to_jsonb(v_cur.volumetric_divisor::numeric), to_jsonb(v_div)),
          ('days_min', to_jsonb(v_cur.days_min), to_jsonb(v_dmin)),
          ('days_max', to_jsonb(v_cur.days_max), to_jsonb(v_dmax)),
          ('allows_battery', to_jsonb(v_cur.allows_battery), to_jsonb(v_bat)),
          ('allows_liquid', to_jsonb(v_cur.allows_liquid), to_jsonb(v_liq)),
          ('allows_magnet', to_jsonb(v_cur.allows_magnet), to_jsonb(v_mag)),
          ('allows_powder', to_jsonb(v_cur.allows_powder), to_jsonb(v_pow)),
          ('fuel_surcharge_bp', to_jsonb(v_cur.fuel_surcharge_bp), to_jsonb(v_fuel)),
          ('remote_area_fee_cents', to_jsonb(v_cur.remote_area_fee_cents), to_jsonb(v_remote))
        ) d(k, o, n)
       where o is distinct from n;
    end if;

    row_no := i; rate_key := v_key;
    if v_cur.id is not null and v_n = 1 and v_changes = '{}'::jsonb then
      action := 'unchanged'; reason := null;
    else
      action := 'changed';
      reason := case when v_cur.id is null or v_n > 1
                     then 'Replaces another active card for this carrier and country with the same service code'
                     else null end;
    end if;
    replaces_ids := v_ids; current_version := v_cur.version; changes := v_changes; normalized := v_norm;
    return next;
  end loop;
end $$;
revoke all on function public.preview_shipping_rate_card_import(jsonb) from public, anon;
grant execute on function public.preview_shipping_rate_card_import(jsonb) to authenticated, service_role;

-- (the draft's direct import_shipping_rate_cards() is replaced by the two-person import flow in section 4)

-- ───────── 3. Duty rate versions & entries ─────────
-- Existing entries (before 6b) get status 'verify' (they need a source and a check); new entries start as 'needs_data'.
alter table public.duty_rate_entries
  add column if not exists source text,
  add column if not exists status text not null default 'verify',
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_at timestamptz,
  -- design v2: "Confirmed needs a second person who checked the source" — the last person who changed the data
  add column if not exists edited_by uuid references auth.users(id) on delete set null,
  add column if not exists edited_at timestamptz;
alter table public.duty_rate_entries alter column status set default 'needs_data';
alter table public.duty_rate_entries drop constraint if exists duty_rate_entries_status_check;
alter table public.duty_rate_entries add constraint duty_rate_entries_status_check
  check (status in ('needs_data', 'verify', 'confirmed'));
-- unknown stays empty: a rate may be NULL until the entry is confirmed; a confirmed entry has rates and a source
alter table public.duty_rate_entries alter column duty_bp drop not null;
alter table public.duty_rate_entries alter column tax_bp drop not null;
alter table public.duty_rate_entries drop constraint if exists duty_rate_entries_confirmed_check;
alter table public.duty_rate_entries add constraint duty_rate_entries_confirmed_check
  check (status <> 'confirmed' or (duty_bp is not null and tax_bp is not null and nullif(btrim(coalesce(source, '')), '') is not null));

alter table public.duty_rate_versions
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz;

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
  v_applies text;
  v_status text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif v_uid is null or not public.step6b_duty_edit() then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.duty_rate_versions;
  insert into public.duty_rate_versions (version, status, note, created_by)
  values (v_ver, 'draft', nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_id;

  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_applies := lower(btrim(coalesce(e ->> 'de_minimis_applies_to', 'duty')));
    if v_applies not in ('duty', 'duty_and_tax') then
      raise exception 'INVALID_DE_MINIMIS_RULE: de_minimis_applies_to must be duty or duty_and_tax';
    end if;
    v_status := lower(btrim(coalesce(e ->> 'status', 'needs_data')));
    -- a person who types (or copies) an entry cannot also confirm it: it starts as 'verify' for a second person
    if v_status = 'confirmed' and v_uid is not null then
      v_status := 'verify';
    end if;
    insert into public.duty_rate_entries (
      version_id, country, hs_prefix, duty_bp, tax_bp, de_minimis_cents, de_minimis_applies_to,
      source, status, verified_by, verified_at, edited_by, edited_at
    ) values (
      v_id,
      upper(btrim(e ->> 'country'))::char(2),
      nullif(regexp_replace(coalesce(e ->> 'hs_prefix', ''), '[^0-9]', '', 'g'), ''),
      (e ->> 'duty_bp')::int,
      coalesce((e ->> 'tax_bp')::int, case when e ? 'duty_bp' then 0 end),
      coalesce((e ->> 'de_minimis_cents')::int, 0),
      v_applies,
      nullif(btrim(coalesce(e ->> 'source', '')), ''),
      v_status,
      case when v_status = 'confirmed' then v_uid end,
      case when v_status = 'confirmed' then now() end,
      v_uid,
      now()
    );
  end loop;

  perform write_audit('duty_rate_version.created', 'duty_rate_versions', v_id::text, jsonb_build_object('version', v_ver));
  return v_id;
end $$;
revoke all on function public.create_duty_rate_version(text, jsonb) from public, anon;
grant execute on function public.create_duty_rate_version(text, jsonb) to authenticated, service_role;

create or replace function public.upsert_duty_rate_entry(
  p_version_id uuid,
  p_country text,
  p_hs_prefix text,
  p_duty_bp integer,
  p_tax_bp integer,
  p_de_minimis_cents integer,
  p_applies_to text,
  p_source text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.duty_rate_versions;
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_pref text := nullif(regexp_replace(coalesce(p_hs_prefix, ''), '[^0-9]', '', 'g'), '');
  v_status text := lower(btrim(coalesce(p_status, 'needs_data')));
  v_applies text := lower(btrim(coalesce(p_applies_to, 'duty')));
  v_id uuid;
  v_old public.duty_rate_entries;
  v_changed boolean;
  v_src text := nullif(btrim(coalesce(p_source, '')), '');
begin
  if v_uid is null or not public.step6b_duty_edit() then raise exception 'FORBIDDEN'; end if;
  select * into v_ver from public.duty_rate_versions where id = p_version_id for update;
  if v_ver.id is null then raise exception 'NOT_FOUND'; end if;
  if v_ver.status <> 'draft' then raise exception 'DUTY_VERSION_NOT_DRAFT: only draft versions can be edited'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'INVALID_COUNTRY'; end if;
  if v_pref is not null and v_pref !~ '^[0-9]{2,10}$' then raise exception 'INVALID_HS_PREFIX: 2 to 10 digits'; end if;
  if v_status not in ('needs_data', 'verify', 'confirmed') then raise exception 'INVALID_STATUS'; end if;
  if v_applies not in ('duty', 'duty_and_tax') then raise exception 'INVALID_DE_MINIMIS_RULE'; end if;
  if v_country = 'US' and coalesce(p_de_minimis_cents, 0) <> 0 then
    raise exception 'US_NO_DE_MINIMIS: the United States has no de minimis — enter 0';
  end if;
  if v_status = 'confirmed' and (p_duty_bp is null or p_tax_bp is null or nullif(btrim(coalesce(p_source, '')), '') is null) then
    raise exception 'CONFIRM_NEEDS_DATA: a confirmed entry needs duty %%, tax %% and a source';
  end if;

  select * into v_old from public.duty_rate_entries
   where version_id = p_version_id and country = v_country and coalesce(hs_prefix, '') = coalesce(v_pref, '');
  v_id := v_old.id;
  v_changed := v_old.id is null
    or v_old.duty_bp is distinct from p_duty_bp
    or v_old.tax_bp is distinct from p_tax_bp
    or v_old.de_minimis_cents is distinct from coalesce(p_de_minimis_cents, 0)
    or v_old.de_minimis_applies_to is distinct from v_applies
    or v_old.source is distinct from v_src;
  -- design v2: confirming needs a second person who checked the source (not the person who entered the data)
  if v_status = 'confirmed' and (v_changed or v_old.edited_by is not distinct from v_uid) then
    if v_old.id is not null and v_old.status = 'confirmed' and not v_changed then
      null; -- already confirmed by someone else; saving again changes nothing
    else
      raise exception 'CONFIRM_NEEDS_SECOND_PERSON: save the entry as Verify; a second person who checked the source confirms it';
    end if;
  end if;

  if v_id is null then
    insert into public.duty_rate_entries (version_id, country, hs_prefix, duty_bp, tax_bp, de_minimis_cents,
      de_minimis_applies_to, source, status, verified_by, verified_at, edited_by, edited_at)
    values (p_version_id, v_country, v_pref, p_duty_bp, p_tax_bp, coalesce(p_de_minimis_cents, 0), v_applies,
      v_src, v_status, null, null, v_uid, now())
    returning id into v_id;
  elsif v_changed then
    update public.duty_rate_entries
       set duty_bp = p_duty_bp, tax_bp = p_tax_bp, de_minimis_cents = coalesce(p_de_minimis_cents, 0),
           de_minimis_applies_to = v_applies, source = v_src, status = v_status,
           verified_by = null, verified_at = null, edited_by = v_uid, edited_at = now()
     where id = v_id;
  elsif v_status is distinct from v_old.status then
    update public.duty_rate_entries
       set status = v_status,
           verified_by = case when v_status = 'confirmed' then v_uid end,
           verified_at = case when v_status = 'confirmed' then now() end
     where id = v_id;
  else
    return v_id; -- nothing changed
  end if;
  -- content changed: any earlier "submitted for approval" no longer describes this draft
  update public.duty_rate_versions set submitted_by = null, submitted_at = null where id = p_version_id and submitted_at is not null;

  perform write_audit('duty_rate_entry.saved', 'duty_rate_entries', v_id::text,
    jsonb_build_object('version_id', p_version_id, 'country', v_country, 'hs_prefix', v_pref, 'duty_bp', p_duty_bp,
      'tax_bp', p_tax_bp, 'de_minimis_cents', p_de_minimis_cents, 'applies_to', v_applies, 'source', p_source, 'status', v_status));
  return v_id;
end $$;
revoke all on function public.upsert_duty_rate_entry(uuid, text, text, integer, integer, integer, text, text, text) from public, anon;
grant execute on function public.upsert_duty_rate_entry(uuid, text, text, integer, integer, integer, text, text, text) to authenticated, service_role;

create or replace function public.delete_duty_rate_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.duty_rate_entries;
  v_st text;
begin
  if auth.uid() is null or not public.step6b_duty_edit() then raise exception 'FORBIDDEN'; end if;
  select * into v_e from public.duty_rate_entries where id = p_entry_id;
  if v_e.id is null then raise exception 'NOT_FOUND'; end if;
  select status into v_st from public.duty_rate_versions where id = v_e.version_id;
  if v_st <> 'draft' then raise exception 'DUTY_VERSION_NOT_DRAFT: only draft versions can be edited'; end if;
  delete from public.duty_rate_entries where id = p_entry_id;
  update public.duty_rate_versions set submitted_by = null, submitted_at = null where id = v_e.version_id and submitted_at is not null;
  perform write_audit('duty_rate_entry.deleted', 'duty_rate_entries', p_entry_id::text,
    jsonb_build_object('version_id', v_e.version_id, 'country', v_e.country, 'hs_prefix', v_e.hs_prefix));
end $$;
revoke all on function public.delete_duty_rate_entry(uuid) from public, anon;
grant execute on function public.delete_duty_rate_entry(uuid) to authenticated, service_role;

create or replace function public.submit_duty_rate_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.duty_rate_versions;
  v_total integer;
  v_open integer;
begin
  if v_uid is null or not public.step6b_duty_edit() then raise exception 'FORBIDDEN'; end if;
  select * into v_ver from public.duty_rate_versions where id = p_version_id for update;
  if v_ver.id is null then raise exception 'NOT_FOUND'; end if;
  if v_ver.status <> 'draft' then raise exception 'DUTY_VERSION_NOT_DRAFT'; end if;
  select count(*), count(*) filter (where status <> 'confirmed') into v_total, v_open
    from public.duty_rate_entries where version_id = p_version_id;
  if v_total = 0 then raise exception 'DUTY_VERSION_EMPTY: add at least one entry'; end if;
  if v_open > 0 then raise exception 'DUTY_ENTRIES_NOT_CONFIRMED: % entr(y/ies) still need data or verification', v_open; end if;
  if exists (select 1 from public.duty_rate_entries where version_id = p_version_id and country = 'US' and de_minimis_cents <> 0) then
    raise exception 'US_NO_DE_MINIMIS: the United States has no de minimis — set it to 0';
  end if;
  update public.duty_rate_versions set submitted_by = v_uid, submitted_at = now() where id = p_version_id;
  perform write_audit('duty_rate_version.submitted', 'duty_rate_versions', p_version_id::text,
    jsonb_build_object('version', v_ver.version, 'entries', v_total));
  return jsonb_build_object('version_id', p_version_id, 'version', v_ver.version, 'entries', v_total);
end $$;
revoke all on function public.submit_duty_rate_version(uuid) from public, anon;
grant execute on function public.submit_duty_rate_version(uuid) to authenticated, service_role;

create or replace function public.activate_duty_rate_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_service boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role';
  v_target public.duty_rate_versions;
  v_old_id uuid;
  v_open integer;
  v_total integer;
begin
  if v_service then
    null;
  elsif v_uid is null or not public.step6b_duty_publish() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_target from public.duty_rate_versions where id = p_version_id for update;
  if v_target.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target.status <> 'draft' then
    raise exception 'DUTY_VERSION_BAD_STATUS: only draft versions can be activated';
  end if;
  select count(*), count(*) filter (where status <> 'confirmed') into v_total, v_open
    from public.duty_rate_entries where version_id = p_version_id;
  if v_total = 0 then raise exception 'DUTY_VERSION_EMPTY: add at least one entry'; end if;
  if v_open > 0 then
    raise exception 'DUTY_ENTRIES_NOT_CONFIRMED: % entr(y/ies) still need data or verification', v_open;
  end if;
  -- Step 6b: publishing needs a second person (service_role scripts on staging are exempt from the two-person rule only)
  if not v_service then
    if v_target.submitted_at is null then
      raise exception 'DUTY_NOT_SUBMITTED: submit the version for approval first';
    end if;
    if v_uid = v_target.submitted_by or v_uid = v_target.created_by then
      raise exception 'TWO_PERSON_REQUIRED: the approver must be different from the person who prepared and submitted it';
    end if;
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

  perform write_audit('duty_rate_version.activated', 'duty_rate_versions', p_version_id::text,
    jsonb_build_object('version', v_target.version, 'superseded_id', v_old_id, 'submitted_by', v_target.submitted_by));
  return jsonb_build_object('activated_id', p_version_id, 'superseded_id', v_old_id, 'version', v_target.version);
end $$;
revoke all on function public.activate_duty_rate_version(uuid) from public, anon;
grant execute on function public.activate_duty_rate_version(uuid) to authenticated, service_role;

create or replace function public.list_duty_rate_versions()
returns table (
  id uuid, version integer, status text, note text, effective_from timestamptz, superseded_at timestamptz,
  created_by uuid, created_by_name text, submitted_by uuid, submitted_by_name text, submitted_at timestamptz,
  activated_by uuid, activated_by_name text, created_at timestamptz,
  entries integer, confirmed integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return query
    select v.id, v.version, v.status, v.note, v.effective_from, v.superseded_at,
           v.created_by, pc.full_name, v.submitted_by, ps.full_name, v.submitted_at,
           v.activated_by, pa.full_name, v.created_at,
           (select count(*)::int from public.duty_rate_entries e where e.version_id = v.id),
           (select count(*)::int from public.duty_rate_entries e where e.version_id = v.id and e.status = 'confirmed')
      from public.duty_rate_versions v
      left join public.profiles pc on pc.id = v.created_by
      left join public.profiles ps on ps.id = v.submitted_by
      left join public.profiles pa on pa.id = v.activated_by
     order by v.version desc;
end $$;
revoke all on function public.list_duty_rate_versions() from public, anon;
grant execute on function public.list_duty_rate_versions() to authenticated, service_role;

-- ───────── 4. Design v2 (StaffRateCards): two-person rate-card imports, deactivate, test quote ─────────
-- A proposal (CSV price list or one new card) is saved as a draft, sent for approval, and published by a second person.
-- Nothing replaces an active card before approval; a change replaces a card only when its key was ticked.
create or replace function public.save_rate_card_import(
  p_id uuid,
  p_source text,
  p_file_name text,
  p_column_map jsonb,
  p_rows jsonb,
  p_errors jsonb,
  p_replace_keys text[],
  p_rows_in_file integer,
  p_note text,
  p_submit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.rate_card_imports;
  r record;
  v_new integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_invalid integer := 0;
  v_unticked text[] := '{}';
  v_keys text[] := '{}';
  v_counts jsonb;
  v_id uuid;
  v_source text := lower(btrim(coalesce(p_source, '')));
begin
  if v_uid is null or not public.rate_card_can_edit() then
    raise exception 'FORBIDDEN: only 3PL & Shipping editors, Dropship editors or an admin may propose rate cards';
  end if;
  if v_source not in ('csv', 'manual') then raise exception 'INVALID_IMPORT: source must be csv or manual'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    raise exception 'IMPORT_EMPTY: add at least one row';
  end if;
  if jsonb_typeof(coalesce(p_errors, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_IMPORT: errors must be a JSON array'; end if;

  if p_id is not null then
    select * into v_old from public.rate_card_imports where id = p_id for update;
    if v_old.id is null then raise exception 'NOT_FOUND'; end if;
    if v_old.status <> 'draft' then raise exception 'IMPORT_NOT_DRAFT: only drafts can be changed'; end if;
    if v_old.proposed_by <> v_uid then raise exception 'FORBIDDEN: only the person who saved this draft can change it'; end if;
  end if;

  for r in select * from public.preview_shipping_rate_card_import(p_rows) loop
    if r.action = 'invalid' then v_invalid := v_invalid + 1;
    elsif r.action = 'new' then v_new := v_new + 1; v_keys := v_keys || r.rate_key;
    elsif r.action = 'changed' then
      v_changed := v_changed + 1; v_keys := v_keys || r.rate_key;
      if not (r.rate_key = any (coalesce(p_replace_keys, '{}'))) then v_unticked := v_unticked || r.rate_key; end if;
    else v_unchanged := v_unchanged + 1;
    end if;
  end loop;
  if v_invalid > 0 then
    raise exception 'IMPORT_INVALID: % row(s) have errors; fix them or leave them out', v_invalid;
  end if;
  if coalesce(p_submit, false) then
    if array_length(v_unticked, 1) > 0 then
      raise exception 'IMPORT_UNCONFIRMED_CHANGES: tick these cards to replace them: %', array_to_string(v_unticked, ', ');
    end if;
    if v_new + v_changed = 0 then
      raise exception 'IMPORT_NOTHING_TO_CHANGE: every row matches the active cards';
    end if;
  end if;

  v_counts := jsonb_build_object(
    'rows_in_file', greatest(coalesce(p_rows_in_file, 0), jsonb_array_length(p_rows) + jsonb_array_length(coalesce(p_errors, '[]'::jsonb))),
    'new', v_new, 'changed', v_changed, 'unchanged', v_unchanged,
    'errors', jsonb_array_length(coalesce(p_errors, '[]'::jsonb)), 'keys', to_jsonb(v_keys));

  if p_id is null then
    insert into public.rate_card_imports (source, file_name, column_map, rows, replace_keys, counts, errors, status, note,
      proposed_by, submitted_at)
    values (v_source, nullif(btrim(coalesce(p_file_name, '')), ''), coalesce(p_column_map, '{}'::jsonb), p_rows,
      coalesce(p_replace_keys, '{}'), v_counts, coalesce(p_errors, '[]'::jsonb),
      case when coalesce(p_submit, false) then 'pending_approval' else 'draft' end,
      nullif(btrim(coalesce(p_note, '')), ''), v_uid, case when coalesce(p_submit, false) then now() end)
    returning id into v_id;
  else
    update public.rate_card_imports
       set file_name = nullif(btrim(coalesce(p_file_name, '')), ''), column_map = coalesce(p_column_map, '{}'::jsonb),
           rows = p_rows, replace_keys = coalesce(p_replace_keys, '{}'), counts = v_counts,
           errors = coalesce(p_errors, '[]'::jsonb), note = nullif(btrim(coalesce(p_note, '')), ''),
           status = case when coalesce(p_submit, false) then 'pending_approval' else 'draft' end,
           submitted_at = case when coalesce(p_submit, false) then now() end, updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;

  perform write_audit(
    case when coalesce(p_submit, false) then 'shipping_rate_card.import_submitted' else 'shipping_rate_card.import_saved' end,
    'rate_card_imports', v_id::text, v_counts || jsonb_build_object('source', v_source, 'file_name', p_file_name));
  return jsonb_build_object('id', v_id, 'status', case when coalesce(p_submit, false) then 'pending_approval' else 'draft' end) || v_counts;
end $$;
revoke all on function public.save_rate_card_import(uuid, text, text, jsonb, jsonb, jsonb, text[], integer, text, boolean) from public, anon;
grant execute on function public.save_rate_card_import(uuid, text, text, jsonb, jsonb, jsonb, text[], integer, text, boolean) to authenticated, service_role;

create or replace function public.approve_rate_card_import(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_imp public.rate_card_imports;
  r record;
  v_n jsonb;
  v_new integer := 0;
  v_replaced integer := 0;
  v_unchanged integer := 0;
begin
  if v_uid is null or not public.rate_card_can_edit() then
    raise exception 'FORBIDDEN: only 3PL & Shipping editors, Dropship editors or an admin may approve rate cards';
  end if;
  select * into v_imp from public.rate_card_imports where id = p_id for update;
  if v_imp.id is null then raise exception 'NOT_FOUND'; end if;
  if v_imp.status <> 'pending_approval' then raise exception 'IMPORT_NOT_PENDING: only proposals waiting for approval can be approved'; end if;
  if v_imp.proposed_by = v_uid then
    raise exception 'TWO_PERSON_REQUIRED: you can''t approve a change you proposed';
  end if;

  -- the active cards may have changed since it was sent: check again, refuse instead of guessing
  for r in select * from public.preview_shipping_rate_card_import(v_imp.rows) loop
    if r.action = 'invalid' then
      raise exception 'IMPORT_STALE: row % is no longer valid (%); reject it and send a new one', r.row_no, r.reason;
    end if;
    if r.action = 'changed' and not (r.rate_key = any (v_imp.replace_keys)) then
      raise exception 'IMPORT_STALE: % would now replace an active card that was not ticked; reject it and send a new one', r.rate_key;
    end if;
  end loop;

  for r in select * from public.preview_shipping_rate_card_import(v_imp.rows) loop
    if r.action = 'unchanged' then v_unchanged := v_unchanged + 1; continue; end if;
    v_n := r.normalized;
    perform public.publish_shipping_rate_card(
      v_n ->> 'carrier_code', v_n ->> 'method', v_n ->> 'carrier_service_code', v_n ->> 'country',
      (v_n ->> 'base_cents')::bigint, (v_n ->> 'per_100g_cents')::bigint,
      (v_n ->> 'days_min')::integer, (v_n ->> 'days_max')::integer,
      (v_n ->> 'max_weight_g')::integer, (v_n ->> 'volumetric_divisor')::numeric, (v_n ->> 'step_g')::integer,
      (v_n ->> 'allows_battery')::boolean, (v_n ->> 'allows_liquid')::boolean,
      (v_n ->> 'allows_magnet')::boolean, (v_n ->> 'allows_powder')::boolean,
      v_n ->> 'service_label',
      (v_n ->> 'fuel_surcharge_bp')::integer, (v_n ->> 'remote_area_fee_cents')::bigint,
      p_id
    );
    if r.action = 'new' then v_new := v_new + 1; else v_replaced := v_replaced + 1; end if;
  end loop;

  update public.rate_card_imports
     set status = 'approved', decided_by = v_uid, decided_at = now(), effective_from = now(), updated_at = now(),
         published = jsonb_build_object('new', v_new, 'replaced', v_replaced, 'unchanged', v_unchanged)
   where id = p_id;

  perform write_audit('shipping_rate_card.import_approved', 'rate_card_imports', p_id::text,
    jsonb_build_object('new', v_new, 'replaced', v_replaced, 'unchanged', v_unchanged, 'proposed_by', v_imp.proposed_by));
  return jsonb_build_object('id', p_id, 'new', v_new, 'replaced', v_replaced, 'unchanged', v_unchanged);
end $$;
revoke all on function public.approve_rate_card_import(uuid) from public, anon;
grant execute on function public.approve_rate_card_import(uuid) to authenticated, service_role;

create or replace function public.reject_rate_card_import(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_imp public.rate_card_imports;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not public.rate_card_can_edit() then raise exception 'FORBIDDEN'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why this is rejected'; end if;
  select * into v_imp from public.rate_card_imports where id = p_id for update;
  if v_imp.id is null then raise exception 'NOT_FOUND'; end if;
  if v_imp.status <> 'pending_approval' then raise exception 'IMPORT_NOT_PENDING: only proposals waiting for approval can be rejected'; end if;
  update public.rate_card_imports
     set status = 'rejected', decided_by = v_uid, decided_at = now(), reject_reason = v_reason, updated_at = now()
   where id = p_id;
  perform write_audit('shipping_rate_card.import_rejected', 'rate_card_imports', p_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('id', p_id, 'status', 'rejected');
end $$;
revoke all on function public.reject_rate_card_import(uuid, text) from public, anon;
grant execute on function public.reject_rate_card_import(uuid, text) to authenticated, service_role;

create or replace function public.delete_rate_card_import(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_imp public.rate_card_imports;
begin
  if auth.uid() is null or not public.rate_card_can_edit() then raise exception 'FORBIDDEN'; end if;
  select * into v_imp from public.rate_card_imports where id = p_id for update;
  if v_imp.id is null then raise exception 'NOT_FOUND'; end if;
  if v_imp.status <> 'draft' or v_imp.proposed_by <> auth.uid() then
    raise exception 'IMPORT_NOT_DRAFT: only your own drafts can be deleted';
  end if;
  delete from public.rate_card_imports where id = p_id;
  perform write_audit('shipping_rate_card.import_deleted', 'rate_card_imports', p_id::text, v_imp.counts);
end $$;
revoke all on function public.delete_rate_card_import(uuid) from public, anon;
grant execute on function public.delete_rate_card_import(uuid) to authenticated, service_role;

create or replace function public.list_rate_card_imports()
returns table (
  id uuid, source text, file_name text, status text, note text, rows jsonb, replace_keys text[], counts jsonb, errors jsonb,
  proposed_by uuid, proposed_by_name text, submitted_at timestamptz, decided_by uuid, decided_by_name text,
  decided_at timestamptz, reject_reason text, effective_from timestamptz, published jsonb, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.step6b_rate_card_read() then raise exception 'FORBIDDEN'; end if;
  return query
    select i.id, i.source, i.file_name, i.status, i.note, i.rows, i.replace_keys, i.counts, i.errors,
           i.proposed_by, pp.full_name, i.submitted_at, i.decided_by, pd.full_name,
           i.decided_at, i.reject_reason, i.effective_from, i.published, i.created_at
      from public.rate_card_imports i
      left join public.profiles pp on pp.id = i.proposed_by
      left join public.profiles pd on pd.id = i.decided_by
     order by i.created_at desc
     limit 200;
end $$;
revoke all on function public.list_rate_card_imports() from public, anon;
grant execute on function public.list_rate_card_imports() to authenticated, service_role;

-- 211's deactivate, with the design v2 editors and a required reason
create or replace function public.deactivate_shipping_rate_card(p_rate_card_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not public.rate_card_can_edit() then
    raise exception 'FORBIDDEN';
  elsif v_reason is null then
    raise exception 'REASON_REQUIRED: enter why this rate card is deactivated';
  end if;

  perform set_config('octopus.allow_rate_card_supersede', 'true', true);
  begin
    update public.shipping_rate_cards set active = false where id = p_rate_card_id and active;
  exception when others then
    perform set_config('octopus.allow_rate_card_supersede', '', true);
    raise;
  end;
  perform set_config('octopus.allow_rate_card_supersede', '', true);

  perform write_audit('shipping_rate_card.deactivated', 'shipping_rate_cards', p_rate_card_id::text, jsonb_build_object('reason', v_reason));
end $$;
revoke all on function public.deactivate_shipping_rate_card(uuid, text) from public, anon;
grant execute on function public.deactivate_shipping_rate_card(uuid, text) to authenticated, service_role;

-- "Test a quote": billed weight = max(actual, box volume ÷ divisor), rounded up to 100 g; same price formula as quotes
create or replace function public.test_rate_card_quote(
  p_country text,
  p_method text,
  p_weight_g integer,
  p_length_cm numeric default null,
  p_width_cm numeric default null,
  p_height_cm numeric default null
)
returns table (
  rate_card_id uuid, carrier_code text, carrier_name text, carrier_service_code text, method text, version integer,
  volumetric_divisor numeric, box_weight_g integer, billed_weight_g integer, max_weight_g integer, over_max boolean,
  price_cents bigint, fuel_surcharge_bp integer, remote_area_fee_may_apply boolean, days_min integer, days_max integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_method text := lower(btrim(coalesce(p_method, '')));
begin
  if not public.step6b_rate_card_read() then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_weight_g, 0) <= 0 or v_country !~ '^[A-Z]{2}$' then return; end if;
  return query
    with c as (
      select r.*,
             case when coalesce(p_length_cm, 0) > 0 and coalesce(p_width_cm, 0) > 0 and coalesce(p_height_cm, 0) > 0
                  then ceil(p_length_cm * p_width_cm * p_height_cm / r.volumetric_divisor * 1000)::integer end as vol_g
        from public.shipping_rate_cards r
       where r.active and r.country = v_country and (v_method = '' or r.method = v_method)
    ), b as (
      select c.*, (ceil(greatest(p_weight_g, coalesce(c.vol_g, 0))::numeric / 100) * 100)::integer as billed_g from c
    )
    select b.id, b.carrier_code, ca.name, b.carrier_service_code, b.method, b.version, b.volumetric_divisor,
           b.vol_g, b.billed_g, b.max_weight_g, b.billed_g > b.max_weight_g,
           round((b.base_cents + (ceil(b.billed_g::numeric / b.step_g::numeric)::bigint * b.per_100g_cents))::numeric
                 * (10000 + coalesce(b.fuel_surcharge_bp, 0)) / 10000.0)::bigint,
           b.fuel_surcharge_bp, b.remote_area_fee_cents is not null, b.days_min, b.days_max
      from b
      left join public.carriers ca on lower(ca.code) = lower(b.carrier_code)
     order by b.method, b.carrier_code;
end $$;
revoke all on function public.test_rate_card_quote(text, text, integer, numeric, numeric, numeric) from public, anon;
grant execute on function public.test_rate_card_quote(text, text, integer, numeric, numeric, numeric) to authenticated, service_role;

-- ───────── 5. Design v2 (StaffDutyEntries): reject a submitted duty version ─────────
create or replace function public.reject_duty_rate_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ver public.duty_rate_versions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not public.step6b_duty_publish() then raise exception 'FORBIDDEN'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why this version is sent back'; end if;
  select * into v_ver from public.duty_rate_versions where id = p_version_id for update;
  if v_ver.id is null then raise exception 'NOT_FOUND'; end if;
  if v_ver.status <> 'draft' or v_ver.submitted_at is null then
    raise exception 'DUTY_NOT_SUBMITTED: only versions waiting for approval can be rejected';
  end if;
  update public.duty_rate_versions
     set submitted_by = null, submitted_at = null,
         note = coalesce(note || E'\n', '') || 'Sent back: ' || v_reason
   where id = p_version_id;
  perform write_audit('duty_rate_version.rejected', 'duty_rate_versions', p_version_id::text,
    jsonb_build_object('version', v_ver.version, 'reason', v_reason, 'submitted_by', v_ver.submitted_by));
  return jsonb_build_object('version_id', p_version_id, 'version', v_ver.version);
end $$;
revoke all on function public.reject_duty_rate_version(uuid, text) from public, anon;
grant execute on function public.reject_duty_rate_version(uuid, text) to authenticated, service_role;

-- ───────── 6. Design v2 (StaffCompliance): customs value policy, versioned, two-person ─────────
-- Declared value = the price the buyer paid, locked at payment (fixed rule). The block threshold is an owner input:
-- NULL = not set (no label is blocked for it). Labels enforce it from Step 9.
create table if not exists public.customs_policy (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  block_below_pct numeric(5,2) check (block_below_pct is null or (block_below_pct > 0 and block_below_pct <= 100)),
  shipping_in_declared_value text not null default 'follow_destination'
    check (shipping_in_declared_value in ('follow_destination', 'include', 'exclude')),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'active', 'superseded', 'rejected')),
  note text,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  effective_from timestamptz,
  superseded_at timestamptz,
  reject_reason text,
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint customs_policy_two_person check (approved_by is null or approved_by <> proposed_by),
  constraint customs_policy_active_approved check (status <> 'active' or (approved_by is not null and effective_from is not null))
);
create unique index if not exists customs_policy_one_active_idx on public.customs_policy ((true)) where status = 'active';
comment on table public.customs_policy is 'EA-1: customs value policy versions (declared value rules). Two-person approval; read and written only through security-definer functions.';
alter table public.customs_policy enable row level security;
revoke all on public.customs_policy from public, anon, authenticated;
grant all on public.customs_policy to service_role;

create or replace function public.propose_customs_policy(p_block_below_pct numeric, p_shipping_rule text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rule text := lower(btrim(coalesce(p_shipping_rule, 'follow_destination')));
  v_ver integer;
  v_id uuid;
begin
  if v_uid is null or not public.step6b_duty_edit() then raise exception 'FORBIDDEN'; end if;
  if p_block_below_pct is not null and (p_block_below_pct <= 0 or p_block_below_pct > 100) then
    raise exception 'INVALID_CUSTOMS_POLICY: the block threshold must be above 0 and at most 100 %%';
  end if;
  if v_rule not in ('follow_destination', 'include', 'exclude') then raise exception 'INVALID_CUSTOMS_POLICY: unknown shipping rule'; end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.customs_policy;
  insert into public.customs_policy (version, block_below_pct, shipping_in_declared_value, note, proposed_by)
  values (v_ver, p_block_below_pct, v_rule, nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_id;
  perform write_audit('customs_policy.proposed', 'customs_policy', v_id::text,
    jsonb_build_object('version', v_ver, 'block_below_pct', p_block_below_pct, 'shipping_in_declared_value', v_rule));
  return v_id;
end $$;
revoke all on function public.propose_customs_policy(numeric, text, text) from public, anon;
grant execute on function public.propose_customs_policy(numeric, text, text) to authenticated, service_role;

create or replace function public.approve_customs_policy(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t public.customs_policy;
  v_old uuid;
begin
  if v_uid is null or not public.step6b_duty_publish() then raise exception 'FORBIDDEN'; end if;
  select * into v_t from public.customs_policy where id = p_id for update;
  if v_t.id is null then raise exception 'NOT_FOUND'; end if;
  if v_t.status <> 'pending_approval' then raise exception 'CUSTOMS_POLICY_NOT_PENDING'; end if;
  if v_t.proposed_by = v_uid then raise exception 'TWO_PERSON_REQUIRED: the approver must be a different person'; end if;
  update public.customs_policy set status = 'superseded', superseded_at = now() where status = 'active' returning id into v_old;
  update public.customs_policy set status = 'active', approved_by = v_uid, effective_from = now() where id = p_id;
  perform write_audit('customs_policy.approved', 'customs_policy', p_id::text,
    jsonb_build_object('version', v_t.version, 'superseded_id', v_old));
  return jsonb_build_object('activated_id', p_id, 'superseded_id', v_old, 'version', v_t.version);
end $$;
revoke all on function public.approve_customs_policy(uuid) from public, anon;
grant execute on function public.approve_customs_policy(uuid) to authenticated, service_role;

create or replace function public.reject_customs_policy(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.customs_policy;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not (public.step6b_duty_edit() or public.step6b_duty_publish()) then raise exception 'FORBIDDEN'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why this is rejected'; end if;
  select * into v_t from public.customs_policy where id = p_id for update;
  if v_t.id is null then raise exception 'NOT_FOUND'; end if;
  if v_t.status <> 'pending_approval' then raise exception 'CUSTOMS_POLICY_NOT_PENDING'; end if;
  update public.customs_policy set status = 'rejected', reject_reason = v_reason where id = p_id;
  perform write_audit('customs_policy.rejected', 'customs_policy', p_id::text, jsonb_build_object('version', v_t.version, 'reason', v_reason));
  return jsonb_build_object('rejected_id', p_id, 'version', v_t.version);
end $$;
revoke all on function public.reject_customs_policy(uuid, text) from public, anon;
grant execute on function public.reject_customs_policy(uuid, text) to authenticated, service_role;

create or replace function public.list_customs_policy()
returns table (
  id uuid, version integer, block_below_pct numeric, shipping_in_declared_value text, status text, note text,
  proposed_by uuid, proposed_by_name text, approved_by uuid, approved_by_name text, effective_from timestamptz,
  superseded_at timestamptz, reject_reason text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return query
    select c.id, c.version, c.block_below_pct, c.shipping_in_declared_value, c.status, c.note,
           c.proposed_by, pp.full_name, c.approved_by, pa.full_name, c.effective_from, c.superseded_at, c.reject_reason, c.created_at
      from public.customs_policy c
      left join public.profiles pp on pp.id = c.proposed_by
      left join public.profiles pa on pa.id = c.approved_by
     order by c.version desc;
end $$;
revoke all on function public.list_customs_policy() from public, anon;
grant execute on function public.list_customs_policy() to authenticated, service_role;

-- "Data completeness" on the compliance board: share of live Dropship products whose items are complete
create or replace function public.dropship_data_completeness()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not (is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  with p as (
    select dp.id,
           bool_and(coalesce(im.hs_verified, false)) as hs_ok,
           bool_and(im.weight_g is not null and im.weight_g > 0 and coalesce(im.box_l_cm, 0) > 0
                    and coalesce(im.box_w_cm, 0) > 0 and coalesce(im.box_h_cm, 0) > 0) as size_ok
      from public.dropship_products dp
      join public.dropship_variants dv on dv.product_id = dp.id
      join public.item_master im on im.id = dv.item_id
     where dp.status = 'active'
     group by dp.id
  )
  select jsonb_build_object('published', count(*), 'hs_verified', count(*) filter (where hs_ok),
                            'weight_and_box', count(*) filter (where size_ok))
    into v from p;
  return v;
end $$;
revoke all on function public.dropship_data_completeness() from public, anon;
grant execute on function public.dropship_data_completeness() to authenticated, service_role;

-- ───────── 7. Design v2 (StaffRequests): request queue details + staff decline ─────────
-- Adds what the queue shows (target landed, notes, KYC, waiting time) and the Sourcing link; supplier and cost stay on
-- the Sourcing request (permission-gated there). Merchants still see status through status_mappings.
drop function if exists public.list_dropship_product_requests(text);
create or replace function public.list_dropship_product_requests(p_status text default null)
returns table (
  rfq_id uuid, rfq_code text, title text, rfq_status text, merchant_label text, org_name text, product_link text,
  category_label text, monthly_volume_band text, ship_to_countries text[], wants_brand boolean,
  quoted_landed_cents bigint, quoted_country text, created_dropship_product_id uuid, created_at timestamptz,
  target_landed_cents bigint, details text, org_kyc_status text, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (is_staff() and not distributor_restricted() and (in_division(division_id_of('DS')) or in_division(division_id_of('SRC'))))
  ) then
    raise exception 'FORBIDDEN';
  end if;

  return query
    select r.id, r.code, r.title, r.status::text, m.merchant_label, o.name,
           d.product_link, d.category_label, d.monthly_volume_band, d.ship_to_countries, d.wants_brand,
           d.quoted_landed_cents, d.quoted_country::text, d.created_dropship_product_id, d.created_at,
           r.target_price_cents, r.details, o.kyc_status::text, greatest(d.updated_at, r.updated_at)
      from public.dropship_product_requests d
      join public.rfqs r on r.id = d.rfq_id
      join public.organizations o on o.id = d.org_id
      left join public.status_mappings m on m.source_domain = 'sourcing_rfq' and m.source_status = r.status::text
     where p_status is null or r.status::text = p_status
     order by d.created_at desc
     limit 500;
end $$;
revoke all on function public.list_dropship_product_requests(text) from public, anon;
grant execute on function public.list_dropship_product_requests(text) to authenticated, service_role;

-- "Decline request": same rule as quoting (DS edit or Sourcing requests:edit); never Support. Audited and logged.
create or replace function public.decline_dropship_product_request(p_rfq_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rfq public.rfqs;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not (
    is_staff() and not distributor_restricted()
    and (dropship_can_edit(division_id_of('DS')) or (in_division(division_id_of('SRC')) and can('requests', 'edit')))
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the request is declined'; end if;
  select r.* into v_rfq from public.rfqs r join public.dropship_product_requests d on d.rfq_id = r.id where r.id = p_rfq_id for update of r;
  if v_rfq.id is null then raise exception 'NOT_FOUND'; end if;
  if v_rfq.status not in ('submitted'::rfq_status, 'assigned'::rfq_status, 'quoting'::rfq_status, 'quoted'::rfq_status) then
    raise exception 'INVALID_STATE: only open requests can be declined';
  end if;
  update public.rfqs set status = 'cancelled'::rfq_status, updated_at = now() where id = p_rfq_id;
  perform public.log_status('rfq', p_rfq_id, v_rfq.status::text, 'cancelled', 'dropship_staff');
  perform write_audit('dropship_request.declined', 'rfqs', p_rfq_id::text,
    jsonb_build_object('rfq_code', v_rfq.code, 'from', v_rfq.status::text, 'reason', v_reason));
  return jsonb_build_object('rfq_id', p_rfq_id, 'rfq_code', v_rfq.code, 'status', 'cancelled');
end $$;
revoke all on function public.decline_dropship_product_request(uuid, text) from public, anon;
grant execute on function public.decline_dropship_product_request(uuid, text) to authenticated, service_role;

-- Batch 1 keeps column-level SELECT on shipping_rate_cards (carrier codes hidden). The EA-1 columns are not secret;
-- rows stay staff-only through RLS, so grant them like the other visible columns (scripts/hidden-columns.mjs unchanged).
grant select (fuel_surcharge_bp, remote_area_fee_cents, import_id) on public.shipping_rate_cards to authenticated;
