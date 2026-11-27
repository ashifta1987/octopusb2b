-- C0 · Connector foundation + customs safety — DOWN (puts the schema back exactly as after 249).
-- Refuses when rows exist that the old CHECKs would reject (orders / connections on the new platforms); waiting-list requests for the
-- new platforms and every C0 table (encrypted credentials, OAuth states, CSV import history, tracking names, label customs snapshots)
-- are removed. The replaced functions get their EXACT installed text back (pg_get_functiondef, read from staging by dump-defs.mjs).
-- Use only within the first hour and only if this migration itself failed (PROJECT-MEMORY §2.5).

do $$
begin
  if exists (select 1 from public.store_orders where channel not in ('shopify', 'woocommerce', 'csv', 'manual', 'api')) then
    raise exception 'C0_DOWN_REFUSED: store orders exist on channels added by C0; the down would break them.';
  end if;
  if exists (select 1 from public.store_connections where platform <> 'shopify') then
    raise exception 'C0_DOWN_REFUSED: store connections exist on platforms added by C0; the down would break them.';
  end if;
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-carrier-tracking-poll') then
      perform cron.unschedule('octopus-carrier-tracking-poll');
    end if;
  end if;
end $$;

drop trigger if exists trg_c0_credential_audit on public.store_credentials;
drop trigger if exists trg_c0_connection_wipe on public.store_connections;
drop trigger if exists trg_c0_declared_locked on public.store_order_items;
drop trigger if exists trg_c0_customs_snapshot_locked on public.wh_shipment_customs;

drop function if exists public.job_carrier_tracking_poll();
drop function if exists public.c0_tracking_name_save(text, text, text, text, boolean, text);
drop function if exists public.c0_connector_health();
drop function if exists public.c0_tracking_export(date, date);
drop function if exists public.c0_product_feed();
drop function if exists public.c0_csv_orders_import(text, text, integer, jsonb, jsonb);
drop function if exists public.c0_file_page();
drop function if exists public.c0_request_platform(text, text);
drop function if exists public.c0_store_link_result(text, text, text);
drop function if exists public.wh_customs_check(uuid);
drop function if exists public.c0_customs_problem(text, text, text);
drop function if exists public.c0_customs_snapshot_locked();
drop function if exists public.c0_declared_locked();
drop function if exists public.c0_connection_wipe();
drop function if exists public.c0_credential_audit();

-- ───────────────────────── replaced functions: the installed text, exactly ─────────────────────────
-- restore get_dropship_order_quote(jsonb,text,text,text,text,numeric,text) (exact installed text)
CREATE OR REPLACE FUNCTION public.get_dropship_order_quote(p_lines jsonb, p_country text, p_method text, p_incoterm text DEFAULT 'DDP'::text, p_buyer_currency text DEFAULT 'USD'::text, p_fx_rate_to_usd numeric DEFAULT NULL::numeric, p_quote_mode text DEFAULT 'order'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- DS16
  v_rule jsonb;
  v_ddp_forced boolean := false;
  v_ship_cost_cents bigint;
  v_markup_pct numeric := public.ds16_shipping_markup_pct();
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

  -- DS16 (owner 26 Nov): countries sold duties-paid only (US) are always quoted DDP
  v_rule := public.ds16_country_rule(v_country);
  if v_rule ->> 'incoterm' = 'DDP' and v_incoterm = 'DAP' then
    v_incoterm := 'DDP';
    v_ddp_forced := true;
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
  -- DS16: rate cards are carrier cost; the merchant's shipping line = cost × (1 + dropship.shipping_markup_pct), integer cents, half-up
  v_ship_cost_cents := v_shipping_cents;
  v_shipping_cents := round(v_ship_cost_cents::numeric * (100 + v_markup_pct) / 100.0)::bigint;

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
      -- DS16: a country rule with de_minimis_cents (US: 0) caps the duty table's de minimis
      if v_rule ? 'de_minimis_cents' and jsonb_typeof(v_rule -> 'de_minimis_cents') = 'number' then
        v_de_min := least(coalesce(v_de_min, 0), (v_rule ->> 'de_minimis_cents')::int);
      end if;
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
    'ddp_only', v_ddp_forced or coalesce(v_rule ->> 'incoterm' = 'DDP', false),
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
  ) || case when v_is_staff
            -- staff only: the carrier cost behind the merchant's shipping line (merchants never see cost or markup)
            then jsonb_build_object('shipping_cost_cents', v_ship_cost_cents, 'shipping_markup_pct', v_markup_pct)
            else '{}'::jsonb end;
end $function$;

-- restore create_dropship_store_order(uuid,text,text,text,text,text,jsonb,text,text,numeric,text,text,jsonb,boolean) (exact installed text)
CREATE OR REPLACE FUNCTION public.create_dropship_store_order(p_org_id uuid, p_channel text, p_external_order_id text, p_external_order_name text, p_buyer_name text, p_buyer_phone text, p_shipping_address jsonb, p_destination_country text, p_buyer_currency text, p_fx_rate_to_usd numeric, p_shipping_method text, p_incoterm text, p_lines jsonb, p_is_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and dropship_can_edit(division_id_of('DS')));
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_ext_id text := nullif(btrim(coalesce(p_external_order_id, '')), '');
  v_country char(2) := upper(btrim(coalesce(p_destination_country, '')))::char(2);
  v_cur char(3) := upper(btrim(coalesce(p_buyer_currency, '')))::char(3);
  v_method text := lower(btrim(coalesce(p_shipping_method, '')));
  v_incoterm text := upper(btrim(coalesce(p_incoterm, 'DDP')));
  v_fx numeric := p_fx_rate_to_usd;
  v_existing public.store_orders;
  v_quote jsonb;
  v_order_id uuid;
  v_order_no text;
  v_line jsonb;
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_route public.dropship_routes;
  v_qty integer;
  v_unit_prod bigint;
  v_buyer_unit bigint;
  v_decl_usd bigint;
  v_fx_mult numeric;
begin
  if not v_is_staff then
    if v_uid is null or p_org_id is null or p_org_id not in (select my_org_ids()) then
      raise exception 'FORBIDDEN';
    end if;
    perform public.assert_dropship_new_activity(p_org_id);
  else
    -- Even webhook / automated ingestion refuses creating new store orders when merchant is paused or closed
    if exists (
      select 1 from public.company_services cs
       where cs.org_id = p_org_id
         and cs.service = 'dropship'
         and (cs.status = 'paused' or (cs.status = 'off' and cs.started_at is not null))
    ) then
      raise exception 'DROPSHIP_PAUSED: Dropshipping is paused or closed for this company; existing paid orders continue shipping.';
    end if;
  end if;

  if v_cur !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_CURRENCY: buyer_currency must be a 3-letter ISO code';
  end if;
  if v_cur <> 'USD' and (v_fx is null or v_fx <= 0) then
    raise exception 'FX_RATE_REQUIRED: fx_rate_to_usd is required and must be > 0 when buyer_currency <> USD';
  end if;
  if v_cur = 'USD' and v_fx is not null and v_fx <= 0 then
    raise exception 'INVALID_FX_RATE: fx_rate_to_usd must be > 0';
  end if;

  if v_ext_id is not null then
    select * into v_existing
      from public.store_orders
     where org_id = p_org_id
       and channel = v_channel
       and external_order_id = v_ext_id
     limit 1;
    if v_existing.id is not null then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'store_order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'merchant_status', v_existing.merchant_status,
        'total_cents', v_existing.total_cents
      );
    end if;
  end if;

  v_quote := public.get_dropship_order_quote(
    p_lines,
    v_country,
    v_method,
    v_incoterm,
    v_cur,
    v_fx,
    'order'
  );

  if not coalesce((v_quote ->> 'ok')::boolean, false) then
    return v_quote;
  end if;

  insert into public.store_orders (
    org_id,
    channel,
    external_order_id,
    external_order_name,
    buyer_name,
    buyer_phone,
    shipping_address,
    destination_country,
    buyer_currency,
    fx_rate_to_usd,
    shipping_method,
    incoterm,
    billed_weight_g,
    product_cents,
    processing_cents,
    shipping_cents,
    duties_cents,
    total_cents,
    shipping_rate_card_id,
    fee_version_id,
    duty_rate_version_id,
    payment_state,
    merchant_status,
    staff_stage,
    is_test,
    created_by
  ) values (
    p_org_id,
    v_channel,
    v_ext_id,
    nullif(btrim(coalesce(p_external_order_name, '')), ''),
    btrim(p_buyer_name),
    nullif(btrim(coalesce(p_buyer_phone, '')), ''),
    p_shipping_address,
    v_country,
    v_cur,
    v_fx,
    v_method,
    v_incoterm,
    (v_quote ->> 'billed_weight_g')::int,
    (v_quote ->> 'product_cents')::bigint,
    (v_quote ->> 'processing_cents')::bigint,
    (v_quote ->> 'shipping_cents')::bigint,
    (v_quote ->> 'duties_cents')::bigint,
    (v_quote ->> 'total_cents')::bigint,
    (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid,
    (v_quote -> 'version_ids' ->> 'fee_version_id')::uuid,
    (v_quote -> 'version_ids' ->> 'duty_rate_version_id')::uuid,
    'unpaid',
    'awaiting_payment',
    'unpaid',
    coalesce(p_is_test, false),
    v_uid
  )
  returning id, order_number into v_order_id, v_order_no;

  if (v_quote -> 'version_ids' ->> 'shipping_rate_card_id') is not null then
    update public.shipping_rate_cards
       set used_count = used_count + 1
     where id = (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid;
  end if;

  v_fx_mult := case when v_cur = 'USD' then coalesce(v_fx, 1.0) else v_fx end;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'qty')::int;
    select * into v_var from public.dropship_variants where id = (v_line ->> 'variant_id')::uuid;
    select * into v_prod from public.dropship_products where id = v_var.product_id;

    if v_prod.product_price_cents is not null then
      v_unit_prod := greatest(0, v_prod.product_price_cents + v_var.price_adjust_cents);
    else
      select * into v_route
        from public.dropship_routes r
       where r.product_id = v_prod.id
         and r.destination_country = v_country
         and r.shipping_method = v_method
         and r.is_active
       limit 1;
      v_unit_prod := greatest(0, (v_route.landed_price_cents - v_route.est_shipping_cents - v_route.est_duties_cents) + v_var.price_adjust_cents);
    end if;

    v_buyer_unit := (v_line ->> 'buyer_unit_price_cents')::bigint;
    if (v_line ? 'buyer_paid_cents') and v_line -> 'buyer_paid_cents' <> 'null'::jsonb then
      v_decl_usd := round(((v_line ->> 'buyer_paid_cents')::bigint)::numeric * v_fx_mult)::bigint;
    elsif v_buyer_unit is not null then
      v_decl_usd := round((v_buyer_unit * v_qty::bigint)::numeric * v_fx_mult)::bigint;
    else
      v_decl_usd := v_unit_prod * v_qty::bigint;
    end if;

    insert into public.store_order_items (
      store_order_id,
      product_id,
      variant_id,
      item_id,
      model_no,
      title_snapshot,
      variant_label,
      fulfilment_type,
      qty,
      unit_product_cents,
      line_product_cents,
      buyer_unit_price_cents,
      declared_usd_cents
    ) values (
      v_order_id,
      v_prod.id,
      v_var.id,
      v_var.item_id,
      v_var.model_no,
      v_prod.title,
      nullif(btrim(coalesce(v_line ->> 'variant_label', '')), ''),
      v_prod.fulfilment_type,
      v_qty,
      v_unit_prod,
      v_unit_prod * v_qty::bigint,
      v_buyer_unit,
      v_decl_usd
    );
  end loop;

  perform write_audit(
    'dropship.store_order_created',
    'store_orders',
    v_order_id::text,
    jsonb_build_object('order_number', v_order_no, 'channel', v_channel, 'total_cents', (v_quote ->> 'total_cents')::bigint)
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'store_order_id', v_order_id,
    'order_number', v_order_no,
    'merchant_status', 'awaiting_payment',
    'staff_stage', 'unpaid',
    'quote', v_quote
  );
end $function$;

-- restore ds_order_intake_core(uuid,text,jsonb,boolean) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds_order_intake_core(p_org uuid, p_channel text, p_order jsonb, p_test boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_ext text := nullif(btrim(coalesce(p_order ->> 'external_order_id', '')), '');
  v_addr jsonb := p_order -> 'address';
  v_country text;
  v_cur text := upper(coalesce(nullif(btrim(p_order ->> 'currency'), ''), 'USD'));
  v_method text;
  v_incoterm text;
  v_line jsonb;
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_lines jsonb := '[]'::jsonb;
  v_other int := greatest(0, coalesce((p_order ->> 'other_items')::int, 0));
  v_qty int;
  v_res jsonb;
  v_so public.store_orders;
  v_risk text := lower(coalesce(nullif(btrim(p_order ->> 'risk'), ''), 'unknown'));
  v_addr_problem text;
  v_hold text;
  v_hold_msg text;
  v_pay jsonb;
  v_existing public.store_orders;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then raise exception 'NOT_FOUND: Organisation not found.'; end if;
  if v_channel not in ('shopify', 'woocommerce', 'csv', 'manual', 'api') then raise exception 'INVALID_INPUT: Unknown sales channel.'; end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' or jsonb_typeof(p_order -> 'lines') is distinct from 'array' then
    raise exception 'INVALID_INPUT: The order needs a list of lines.';
  end if;
  if v_ext is null then
    if v_channel = 'manual' then v_ext := 'TEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    else raise exception 'INVALID_INPUT: external_order_id is required.'; end if;
  end if;
  if v_risk not in ('low', 'medium', 'high', 'unknown') then v_risk := 'unknown'; end if;
  if not dropship_feature_on('orders') then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_OFF', 'message', 'Orders are not switched on yet.');
  end if;

  -- dedupe on (org, channel, external order id): the second delivery of the same order (webhook retry, hourly catch-up) is ignored
  perform pg_advisory_xact_lock(hashtext('ds-intake:' || p_org::text || ':' || v_channel || ':' || v_ext));
  select * into v_existing from public.store_orders where org_id = p_org and channel = v_channel and external_order_id = v_ext limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'store_order_id', v_existing.id, 'order_number', v_existing.order_number);
  end if;

  if exists (select 1 from public.company_services cs where cs.org_id = p_org and cs.service = 'dropship'
                and (cs.status = 'paused' or (cs.status = 'off' and cs.started_at is not null))) then
    perform write_audit('ds_order.intake_refused', 'organizations', p_org::text, jsonb_build_object('org_id', p_org, 'channel', v_channel, 'external_order_id', v_ext, 'code', 'DROPSHIP_PAUSED'));
    return jsonb_build_object('ok', false, 'code', 'DROPSHIP_PAUSED', 'message', 'Dropshipping is paused or closed for this company, so new orders are not taken. Fulfil this order in your store.');
  end if;

  -- only Octopus lines are stored; everything else is counted
  for v_line in select * from jsonb_array_elements(p_order -> 'lines') loop
    v_qty := greatest(0, coalesce((v_line ->> 'qty')::int, 0));
    if v_qty = 0 then continue; end if;
    v_var := null;
    if nullif(v_line ->> 'variant_id', '') is not null and (v_line ->> 'variant_id') ~ '^[0-9a-fA-F-]{36}$' then
      select * into v_var from public.dropship_variants where id = (v_line ->> 'variant_id')::uuid;
    elsif upper(btrim(coalesce(v_line ->> 'model_no', ''))) ~ '^DS-\d{6}-\d{2}$' then
      select * into v_var from public.dropship_variants where model_no = upper(btrim(v_line ->> 'model_no'));
    end if;
    if v_var.id is not null then
      select * into v_prod from public.dropship_products where id = v_var.product_id;
    end if;
    if v_var.id is null or v_prod.id is null or not public.ds_product_visible(v_prod, p_org) then
      v_other := v_other + v_qty;
      continue;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('variant_id', v_var.id, 'qty', v_qty,
      'buyer_unit_price_cents', nullif(v_line ->> 'buyer_unit_price_cents', '')::bigint,
      'variant_label', nullif(btrim(coalesce(v_line ->> 'variant_label', '')), ''))));
  end loop;
  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', true, 'ignored', true, 'code', 'NO_OCTOPUS_ITEMS', 'message', 'No Octopus items in this order; nothing to do.', 'other_items', v_other);
  end if;

  v_country := upper(btrim(coalesce(nullif(v_addr ->> 'country', ''), p_order ->> 'country', '')));
  if v_country !~ '^[A-Z]{2}$' then raise exception 'INVALID_INPUT: The delivery country is missing.'; end if;
  v_method := lower(coalesce(nullif(btrim(p_order ->> 'shipping_method'), ''), public.ds_default_method(p_org)));
  if v_method not in ('economy', 'standard', 'express') then v_method := public.ds_default_method(p_org); end if;
  v_incoterm := public.ds_duty_mode(p_org, v_country);

  v_res := public.create_dropship_store_order(
    p_org, v_channel, v_ext, nullif(btrim(coalesce(p_order ->> 'external_order_name', '')), ''),
    coalesce(nullif(btrim(coalesce(p_order ->> 'buyer_name', '')), ''), nullif(btrim(coalesce(v_addr ->> 'name', '')), ''), 'Buyer'),
    coalesce(nullif(btrim(coalesce(p_order ->> 'buyer_phone', '')), ''), nullif(btrim(coalesce(v_addr ->> 'phone', '')), '')),
    coalesce(v_addr, '{}'::jsonb), v_country, v_cur, nullif(p_order ->> 'fx_rate_to_usd', '')::numeric, v_method, v_incoterm, v_lines, coalesce(p_test, false));
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    perform write_audit('ds_order.intake_refused', 'organizations', p_org::text,
      jsonb_build_object('org_id', p_org, 'channel', v_channel, 'external_order_id', v_ext, 'code', v_res ->> 'code'));
    return jsonb_build_object('ok', false, 'code', coalesce(v_res ->> 'code', 'QUOTE_FAILED'), 'message', coalesce(v_res ->> 'message', 'This order could not be priced.'));
  end if;
  if coalesce((v_res ->> 'idempotent')::boolean, false) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'store_order_id', v_res ->> 'store_order_id', 'order_number', v_res ->> 'order_number');
  end if;
  select * into v_so from public.store_orders where id = (v_res ->> 'store_order_id')::uuid;

  v_addr_problem := case when lower(coalesce(p_order ->> 'address_check', '')) = 'failed'
                         then coalesce(nullif(btrim(p_order ->> 'address_issue'), ''), 'The store''s address check failed. Check the address with the buyer.')
                         else public.ds_order_address_problem(v_addr, v_country) end;
  insert into public.dropship_order_intake (store_order_id, org_id, channel, other_items_count, risk_level, address_ok, address_issue, payment_due_at, test_order)
  values (v_so.id, p_org, v_channel, v_other, v_risk, v_addr_problem is null, left(v_addr_problem, 300),
          now() + make_interval(days => public.ds_order_expiry_days()), coalesce(p_test, false));
  perform public.ds_order_event(v_so.id, p_org, 'received', 'Order received',
    case when v_other > 0 then format('%s from %s. +%s item%s not from Octopus stay with you.', coalesce(v_so.external_order_name, v_so.order_number), v_channel, v_other, case when v_other = 1 then '' else 's' end)
         else format('%s from %s.', coalesce(v_so.external_order_name, v_so.order_number), v_channel) end,
    v_so.total_cents);

  -- holds with exact reasons (before the wallet is charged, so cancelling needs no refund)
  if v_risk = 'high' then
    v_hold := 'high_risk'; v_hold_msg := 'Your store rated this order high risk. It is not charged and not shipped. Check it in your store, then choose.';
  elsif v_addr_problem is not null then
    v_hold := 'address'; v_hold_msg := v_addr_problem;
  elsif v_so.total_cents is null then
    v_hold := 'duty_unknown'; v_hold_msg := 'Duties for this country are not known yet, so the order can''t be charged.';
  elsif public.ds_order_stock_short(v_so.id) then
    v_hold := 'stock_shortage'; v_hold_msg := 'Not enough stock for this order right now. It is not charged.';
  end if;
  if v_hold is not null then
    perform public.ds_order_set_hold(v_so.id, v_hold, v_hold_msg);
  else
    v_pay := public.ds_order_try_auto(v_so.id);
  end if;
  select * into v_so from public.store_orders where id = v_so.id;
  perform write_audit('ds_order.received', 'store_orders', v_so.id::text,
    jsonb_build_object('org_id', p_org, 'channel', v_channel, 'external_order_id', v_ext, 'order_number', v_so.order_number,
                       'other_items', v_other, 'hold', v_hold, 'charged', coalesce((v_pay ->> 'ok')::boolean, false), 'test', coalesce(p_test, false)));
  return jsonb_build_object('ok', true, 'duplicate', false, 'store_order_id', v_so.id, 'order_number', v_so.order_number,
    'other_items', v_other, 'hold_code', v_hold, 'total_cents', v_so.total_cents, 'payment_state', v_so.payment_state,
    'merchant_status', v_so.merchant_status, 'payment', v_pay);
end $function$;

-- restore ds_channel_waitlist(text,boolean) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds_channel_waitlist(p_channel text, p_join boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  perform ds_assert_role(v_org, 'setup');
  if p_channel is null or p_channel not in ('amazon', 'woocommerce', 'tiktok_shop', 'wix', 'ebay') then raise exception 'BAD_CHANNEL: This channel is not available.'; end if;
  if p_join then
    insert into public.dropship_channel_waitlist (org_id, channel) values (v_org, p_channel) on conflict do nothing;
  else
    delete from public.dropship_channel_waitlist where org_id = v_org and channel = p_channel;
  end if;
  perform write_audit('ds_channel.waitlist_' || case when p_join then 'joined' else 'left' end, 'dropship_channel_waitlist', v_org::text || ':' || p_channel, null);
  return jsonb_build_object('joined', p_join);
end $function$;

-- restore ds_channels_page() (exact installed text)
CREATE OR REPLACE FUNCTION public.ds_channels_page()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_plan jsonb;
  v_conn public.store_connections;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  v_plan := ds_plan_state(v_org);
  select * into v_conn from public.store_connections where org_id = v_org and status <> 'disconnected' order by created_at desc limit 1;
  return jsonb_build_object(
    'shopify', case when v_conn.id is null then jsonb_build_object('status', 'not_connected')
                    else jsonb_build_object('status', v_conn.status, 'shop', v_conn.shop_domain, 'connected_at', v_conn.connected_at) end,
    'settings', coalesce((select jsonb_object_agg(s.channel, jsonb_build_object('sync_stock', s.sync_stock, 'sync_prices', s.sync_prices,
                                                                                'send_tracking', s.send_tracking, 'cancel_on_store_cancel', s.cancel_on_store_cancel))
                            from public.dropship_channel_settings s where s.org_id = v_org), '{}'::jsonb),
    'waitlist', coalesce((select jsonb_agg(w.channel order by w.channel) from public.dropship_channel_waitlist w where w.org_id = v_org), '[]'::jsonb),
    'plan_name', v_plan ->> 'plan_name', 'stores_limit', nullif(v_plan ->> 'stores_limit', '')::integer, 'stores_used', coalesce((v_plan #>> '{usage,stores}')::integer, 0),
    'billing_enabled', (v_plan ->> 'billing_enabled')::boolean);
end $function$;

-- restore wh_label_plan(uuid) (exact installed text)
CREATE OR REPLACE FUNCTION public.wh_label_plan(p_parcel uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.wh_parcels;
  o public.wh_orders;
  w public.warehouses;
  v_dg text[];
  v_pick jsonb;
  v_exc uuid;
  a public.wh_carrier_accounts;
  v_ref text;
begin
  p := public.wh_label_parcel_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  select * into w from public.warehouses where code = o.warehouse_code;
  -- the dangerous goods IN THIS PARCEL decide (a multi-parcel order may ship its battery in one parcel only)
  select coalesce(array_agg(distinct x order by x), '{}') into v_dg
    from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id cross join lateral unnest(public.wh_dg_kinds(l.item_id)) x
   where i.parcel_id = p.id;
  v_pick := public.wh_carrier_pick(o.warehouse_code, o.ship_country, v_dg, p.measured_weight_g, null);
  if not coalesce((v_pick ->> 'ok')::boolean, false) then
    v_exc := public.wh_exception_open(o.warehouse_code, 'carrier', format('No carrier for %s parcel %s: %s', o.code, p.seq, v_pick ->> 'reason'),
                                      o.id, p.id, null, null, o.org_id);
    return jsonb_build_object('ok', false, 'message', format('%s. Logged on the Exceptions queue.', v_pick ->> 'reason'), 'reason', v_pick ->> 'reason');
  end if;
  select * into a from public.wh_carrier_accounts where id = (v_pick ->> 'account_id')::uuid;
  select coalesce(o.external_ref, so.external_order_name, so.order_number, o.code) into v_ref
    from (select 1) x left join public.store_orders so on so.id = o.store_order_id;
  return jsonb_build_object(
    'ok', true, 'parcel_id', p.id, 'seq', p.seq, 'parcels', (select count(*) from public.wh_parcels where order_id = o.id),
    'order_id', o.id, 'order_code', o.code, 'reference', v_ref, 'warehouse_code', o.warehouse_code,
    'weight_g', p.measured_weight_g, 'dg', to_jsonb(v_dg),
    'service_id', v_pick ->> 'service_id', 'service_code', v_pick ->> 'service_code', 'service_name', v_pick ->> 'service_name',
    'carrier', a.carrier, 'account_id', a.id, 'account_name', a.name, 'mode', a.mode, 'credential_env', a.credential_env,
    'rule_version_id', v_pick ->> 'rule_version_id', 'rule_seq', v_pick -> 'rule_seq', 'fallback', v_pick -> 'fallback', 'reason', v_pick ->> 'reason',
    'ship_to', jsonb_build_object('name', o.ship_name, 'phone', o.ship_phone, 'address', o.ship_address, 'country', o.ship_country),
    'ship_from', jsonb_build_object('name', w.name, 'city', w.city, 'province', w.province, 'country', w.country, 'address', w.address, 'phone', w.phone),
    'items', coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.name, 'qty', i.qty, 'unit_weight_g', l.unit_weight_g) order by l.sku)
                         from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id where i.parcel_id = p.id), '[]'::jsonb));
end $function$;

-- restore wh_label_record(uuid,uuid,uuid,text,text,text) (exact installed text)
CREATE OR REPLACE FUNCTION public.wh_label_record(p_parcel uuid, p_service uuid, p_rule_version uuid, p_tracking_no text, p_label_path text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.wh_parcels;
  o public.wh_orders;
  s public.wh_carrier_services;
  a public.wh_carrier_accounts;
  v_dg text[];
  v_problem text;
  v_no text := upper(btrim(coalesce(p_tracking_no, '')));
  v_path text := btrim(coalesce(p_label_path, ''));
  v_id uuid;
  v_code text;
  v_state text;
begin
  p := public.wh_label_parcel_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  select * into s from public.wh_carrier_services where id = p_service;
  select * into a from public.wh_carrier_accounts where id = s.account_id;
  if s.id is null or s.warehouse_code <> o.warehouse_code then raise exception 'INVALID_SERVICE: choose a service of %', o.warehouse_code; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_dg
    from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id cross join lateral unnest(public.wh_dg_kinds(l.item_id)) x
   where i.parcel_id = p.id;
  v_problem := public.wh_service_problem(s.id, v_dg, p.measured_weight_g);
  if v_problem is not null then raise exception 'SERVICE_CANNOT_CARRY: %', v_problem; end if;
  if v_no !~ '^[A-Z0-9-]{6,40}$' then raise exception 'INVALID_TRACKING_NO: 6 to 40 letters, digits or dashes'; end if;
  if (a.mode = 'sandbox') <> (v_no like 'SBX%') then
    raise exception 'TRACKING_MODE_MISMATCH: sandbox labels start with SBX and only sandbox labels do';
  end if;
  if v_path <> format('%s/%s/P%s-%s.pdf', o.warehouse_code, o.code, p.seq, v_no) then
    raise exception 'INVALID_LABEL_PATH: expected %/%/P%-%.pdf', o.warehouse_code, o.code, p.seq, v_no;
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'wh-labels' and name = v_path) then
    raise exception 'LABEL_NOT_UPLOADED: upload the label PDF first';
  end if;
  if exists (select 1 from public.wh_shipments x where x.carrier = a.carrier and x.tracking_no = v_no and x.status <> 'voided') then
    raise exception 'DUPLICATE_TRACKING_NO: % is already on another label', v_no;
  end if;
  if p_rule_version is not null and not exists (select 1 from public.wh_carrier_rule_versions where id = p_rule_version and warehouse_code = o.warehouse_code) then
    raise exception 'INVALID_RULE_VERSION';
  end if;
  insert into public.wh_shipments (order_id, parcel_id, warehouse_code, account_id, service_id, carrier, service_code, service_name, rule_version_id, rule_reason,
                                   tracking_no, label_path, sandbox, weight_g, created_by)
  values (o.id, p.id, o.warehouse_code, a.id, s.id, a.carrier, s.code, s.name, p_rule_version, left(nullif(btrim(coalesce(p_reason, '')), ''), 600),
          v_no, v_path, a.mode = 'sandbox', p.measured_weight_g, auth.uid())
  returning id, code into v_id, v_code;
  perform write_audit('wh_label.created', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'parcel', p.seq, 'label', v_code, 'carrier', a.carrier, 'service', s.code, 'tracking_no', v_no,
                       'sandbox', a.mode = 'sandbox', 'reason', p_reason));
  -- a "no carrier" exception of this parcel is answered by the label
  perform public.wh_exceptions_resolve_where('parcel_id', p.id, array['carrier'], format('Label %s made with %s', v_no, s.name), 'label_made');
  v_state := public.wh_order_label_state(o.id);
  return jsonb_build_object('id', v_id, 'code', v_code, 'tracking_no', v_no, 'sandbox', a.mode = 'sandbox', 'order_status', v_state,
                            'service_name', s.name, 'carrier', a.carrier, 'parcel', p.seq);
end $function$;

-- c0_platforms is used by the C0 patches only; dropped after the installed functions are back
drop function if exists public.c0_platforms(text);

drop table if exists public.wh_shipment_customs;
drop table if exists public.carrier_tracking_names;
drop table if exists public.dropship_csv_imports;
drop table if exists public.store_oauth_states;
drop table if exists public.store_credentials;

-- store_orders.channel: back to the DS8 list
alter table public.store_orders drop constraint if exists store_orders_channel_check;
alter table public.store_orders add constraint store_orders_channel_check check (channel in ('shopify', 'woocommerce', 'csv', 'manual', 'api'));

-- waiting list: back to the DS14 channels (requests for the new platforms are removed)
alter table public.dropship_channel_waitlist drop constraint if exists dropship_channel_waitlist_other_named;
alter table public.dropship_channel_waitlist drop column if exists requested_name;
delete from public.dropship_channel_waitlist where channel not in ('amazon', 'woocommerce', 'tiktok_shop', 'wix', 'ebay');
alter table public.dropship_channel_waitlist drop constraint if exists dropship_channel_waitlist_channel_check;
alter table public.dropship_channel_waitlist add constraint dropship_channel_waitlist_channel_check check (channel in ('amazon', 'woocommerce', 'tiktok_shop', 'wix', 'ebay'));

-- store_connections: back to Shopify only (DS6)
alter table public.store_connections drop column if exists last_error_at;
alter table public.store_connections drop column if exists last_error;
alter table public.store_connections drop column if exists last_sync_at;
alter table public.store_connections drop column if exists external_store_id;
alter table public.store_connections drop column if exists scopes;
alter table public.store_connections drop column if exists detected_platform;
alter table public.store_connections drop column if exists store_url;
alter table public.store_connections drop constraint if exists store_connections_shop_domain_check;
alter table public.store_connections add constraint store_connections_shop_domain_check check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$');
alter table public.store_connections drop constraint if exists store_connections_platform_check;
alter table public.store_connections add constraint store_connections_platform_check check (platform in ('shopify'));
comment on table public.store_connections is 'Dropship Step 6 (contract for Step 5): one row per connected store. Merchant-readable, no secrets; written by the service role only (Step 5 OAuth / token exchange). Push jobs run only while status = active.';
