-- DOWN for 20261101000221_ea1_staff_fees_rates_duty.sql
-- Restores create_duty_rate_version (212) and activate_duty_rate_version (211), drops the Step 6b functions and the new
-- duty columns. Fails on purpose if a draft entry still has an empty (unknown) rate — fill or delete it first.
-- Then: delete from _migrations where name = '20261101000221_ea1_staff_fees_rates_duty.sql';

-- design v2 additions (sections 4–7)
drop function if exists public.decline_dropship_product_request(uuid, text);
drop function if exists public.list_dropship_product_requests(text);
-- list_dropship_product_requests back to 220
CREATE OR REPLACE FUNCTION public.list_dropship_product_requests(p_status text DEFAULT NULL::text)
 RETURNS TABLE(rfq_id uuid, rfq_code text, title text, rfq_status text, merchant_label text, org_name text, product_link text, category_label text, monthly_volume_band text, ship_to_countries text[], wants_brand boolean, quoted_landed_cents bigint, quoted_country text, created_dropship_product_id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           d.quoted_landed_cents, d.quoted_country::text, d.created_dropship_product_id, d.created_at
      from public.dropship_product_requests d
      join public.rfqs r on r.id = d.rfq_id
      join public.organizations o on o.id = d.org_id
      left join public.status_mappings m on m.source_domain = 'sourcing_rfq' and m.source_status = r.status::text
     where p_status is null or r.status::text = p_status
     order by d.created_at desc
     limit 500;
end $function$;
revoke all on function public.list_dropship_product_requests(text) from public, anon;
grant execute on function public.list_dropship_product_requests(text) to authenticated, service_role;
drop function if exists public.dropship_data_completeness();
drop function if exists public.list_customs_policy();
drop function if exists public.reject_customs_policy(uuid, text);
drop function if exists public.approve_customs_policy(uuid);
drop function if exists public.propose_customs_policy(numeric, text, text);
drop table if exists public.customs_policy;
drop function if exists public.reject_duty_rate_version(uuid, text);
drop function if exists public.test_rate_card_quote(text, text, integer, numeric, numeric, numeric);
drop function if exists public.list_rate_card_imports();
drop function if exists public.delete_rate_card_import(uuid);
drop function if exists public.reject_rate_card_import(uuid, text);
drop function if exists public.approve_rate_card_import(uuid);
drop function if exists public.save_rate_card_import(uuid, text, text, jsonb, jsonb, jsonb, text[], integer, text, boolean);
-- deactivate back to 211
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

drop function if exists public.list_duty_rate_versions();
drop function if exists public.submit_duty_rate_version(uuid);
drop function if exists public.delete_duty_rate_entry(uuid);
drop function if exists public.upsert_duty_rate_entry(uuid, text, text, integer, integer, integer, text, text, text);
drop function if exists public.import_shipping_rate_cards(jsonb, text[]);
drop function if exists public.preview_shipping_rate_card_import(jsonb);
drop function if exists public.list_shipping_rate_cards(boolean);
drop function if exists public.list_fee_versions();
drop function if exists public.reject_fee_version(uuid, text);

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
    v_applies := lower(btrim(coalesce(e->>'de_minimis_applies_to', 'duty')));
    if v_applies not in ('duty', 'duty_and_tax') then
      raise exception 'INVALID_DE_MINIMIS_RULE: de_minimis_applies_to must be duty or duty_and_tax';
    end if;
    insert into public.duty_rate_entries (
      version_id,
      country,
      hs_prefix,
      duty_bp,
      tax_bp,
      de_minimis_cents,
      de_minimis_applies_to
    ) values (
      v_id,
      upper(btrim(e->>'country'))::char(2),
      nullif(regexp_replace(coalesce(e->>'hs_prefix', ''), '[^0-9]', '', 'g'), ''),
      coalesce((e->>'duty_bp')::int, 0),
      coalesce((e->>'tax_bp')::int, 0),
      coalesce((e->>'de_minimis_cents')::int, 0),
      v_applies
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

drop function if exists public.step6b_duty_publish();
drop function if exists public.rate_card_can_edit();
drop function if exists public.step6b_duty_edit();
drop function if exists public.step6b_rate_card_read();
drop function if exists public.step6b_staff_read();

alter table public.duty_rate_versions
  drop column if exists submitted_at,
  drop column if exists submitted_by;

alter table public.duty_rate_entries drop constraint if exists duty_rate_entries_confirmed_check;
alter table public.duty_rate_entries drop constraint if exists duty_rate_entries_status_check;
alter table public.duty_rate_entries alter column duty_bp set not null;
alter table public.duty_rate_entries alter column tax_bp set not null;
alter table public.duty_rate_entries
  drop column if exists edited_at,
  drop column if exists edited_by,
  drop column if exists verified_at,
  drop column if exists verified_by,
  drop column if exists status,
  drop column if exists source;

-- EA-1 additions back to 211 / 214 / 216
drop function if exists public.propose_fee_version(bigint, bigint, bigint, bigint, bigint, text, integer, numeric, integer, bigint);
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

drop function if exists public.publish_shipping_rate_card(text, text, text, text, bigint, bigint, integer, integer, integer, numeric, integer, boolean, boolean, boolean, boolean, text, integer, bigint, uuid);
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

alter table public.shipping_rate_cards
  drop column if exists import_id,
  drop column if exists remote_area_fee_cents,
  drop column if exists fuel_surcharge_bp;
drop table if exists public.rate_card_imports;
alter table public.fee_versions
  drop column if exists branded_packaging_cents,
  drop column if exists dispute_window_days,
  drop column if exists weigh_tolerance_pct,
  drop column if exists weigh_tolerance_g;
