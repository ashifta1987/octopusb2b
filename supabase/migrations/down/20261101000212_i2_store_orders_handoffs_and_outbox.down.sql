-- Down migration for 20261101000212_i2_store_orders_handoffs_and_outbox.sql

-- 1. Drop I2 triggers on shipments & drop I2 functions
drop trigger if exists trg_shipments_emit_dropship_domain_event on public.shipments;
drop function if exists public.shipments_emit_dropship_event();

drop trigger if exists trg_shipments_dropship_token on public.shipments;
drop function if exists public.set_shipment_dropship_token();

drop function if exists public.get_dropship_orders_report(uuid, timestamptz, timestamptz);
drop function if exists public.get_public_dropship_tracking(text);
drop function if exists public.create_store_order_shipment(uuid, text, text, text, numeric, bigint, shipment_status);
drop function if exists public.receive_sourcing_handoff_at_3pl(uuid, text);
drop function if exists public.cancel_store_order(uuid, text);
drop function if exists public.mark_store_order_paid(uuid, uuid, uuid);
drop function if exists public.create_dropship_store_order(uuid, text, text, text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, boolean);
drop function if exists public.process_dropship_domain_events(integer);
drop function if exists public.emit_dropship_domain_event(text, text, uuid, text, jsonb, uuid, boolean);
drop function if exists public.resolve_dropship_status_mapping(text, text);

-- 2. Restore division_of_shipment(r shipments) BEFORE dropping shipments.store_order_id
create or replace function public.division_of_shipment(r shipments)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select division_id from orders where id = r.order_id),
                  case when r.order_id is null then division_id_of(division_code_for_service(r.service_code)) end) $function$;

-- 3. Remove any store_order shipments, unlink tickets, and drop new columns/constraints on tickets, shipments, and warehouse_stock_movements
update public.tickets set store_order_id = null where store_order_id is not null;
alter table public.tickets drop constraint if exists tickets_order_xor_check;
drop index if exists public.tickets_store_order_id_idx;
alter table public.tickets drop column if exists store_order_id;

delete from public.tracking_events where shipment_id in (select id from public.shipments where store_order_id is not null);
delete from public.shipments where store_order_id is not null;
alter table public.shipments drop constraint if exists shipments_tracking_token_check;
alter table public.shipments drop constraint if exists shipments_parent_xor_check;
drop index if exists public.shipments_store_order_id_idx;
alter table public.shipments drop column if exists tracking_token;
alter table public.shipments drop column if exists store_order_id;
alter table public.shipments alter column order_id set not null;

alter table public.warehouse_stock_movements drop constraint if exists warehouse_stock_movements_store_order_id_fkey;
drop index if exists public.warehouse_stock_movements_store_order_id_idx;

-- 4. Drop I2 tables & sequence
drop table if exists public.internal_charge_rules;
drop table if exists public.domain_event_consumptions;
drop table if exists public.domain_events;
drop table if exists public.dropship_handoffs;
drop table if exists public.store_order_items;
drop table if exists public.store_orders;
drop function if exists public.next_store_order_number();
drop sequence if exists public.seq_store_order;
drop table if exists public.status_mappings;

-- 5. Restore 211 definitions of get_dropship_order_quote, lookup_duty_rate, and create_duty_rate_version, then drop de_minimis_applies_to
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

alter table public.duty_rate_entries drop column if exists de_minimis_applies_to;
