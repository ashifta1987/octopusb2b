-- Down for DS16 · Owner decisions (2026110100024Y_ds16_owner_decisions.sql). Puts every installed function the up replaced back to
-- its exact installed text, restores the site_settings rows the up seeded (from ds16_settings_backup), and drops everything new
-- (data in the new tables goes with them). Rows in dropship_supplier_submissions / audit_log / notifications written while DS16
-- was installed stay (they are history, not schema). The up → down schema diff is empty.

drop trigger if exists trg_ds16_protected_settings on public.site_settings;
drop trigger if exists trg_ds16_duty_mode_guard on public.dropship_duty_modes;
drop trigger if exists trg_ds16_supplier_application_guard on public.supplier_applications;

-- settings as they were before the up (a key the up created is removed; an existing key gets its old row back)
do $$
begin
  if to_regclass('public.ds16_settings_backup') is not null then
    delete from public.site_settings s using public.ds16_settings_backup b where b.key = s.key and not b.existed;
    update public.site_settings s
       set value = b.row -> 'value', description = b.row ->> 'description', is_public = coalesce((b.row ->> 'is_public')::boolean, s.is_public),
           updated_at = coalesce((b.row ->> 'updated_at')::timestamptz, s.updated_at), updated_by = (b.row ->> 'updated_by')::uuid
      from public.ds16_settings_backup b
     where b.key = s.key and b.existed;
  end if;
end $$;

-- ───────────────────────── Replaced functions: the installed text, exactly ─────────────────────────
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
end $function$
;

-- restore ds10_reweigh_calc(uuid) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds10_reweigh_calc(p_so uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  so public.store_orders;
  w public.wh_orders;
  rc public.shipping_rate_cards;
  fv public.fee_versions;
  v_actual int;
  v_vol_cm3 numeric;
  v_vol_g int;
  v_billed int;
  v_tol int;
  v_ship bigint;
  v_amt bigint;
  v_photo text;
begin
  select * into so from public.store_orders where id = p_so;
  if so.id is null then return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); end if;
  select * into w from public.wh_orders where store_order_id = so.id and status in ('packed', 'labelled', 'shipped');
  if w.id is null then return jsonb_build_object('ok', false, 'reason', 'NOT_PACKED'); end if;
  select * into rc from public.shipping_rate_cards where id = so.shipping_rate_card_id;
  select * into fv from public.fee_versions where id = so.fee_version_id;
  if rc.id is null or so.billed_weight_g is null then return jsonb_build_object('ok', false, 'reason', 'NO_QUOTE', 'wh_order_id', w.id); end if;
  v_actual := coalesce((select sum(p.measured_weight_g) from public.wh_parcels p where p.order_id = w.id and p.measured_weight_g is not null), w.measured_weight_g);
  if v_actual is null then return jsonb_build_object('ok', false, 'reason', 'NOT_WEIGHED', 'wh_order_id', w.id); end if;
  v_vol_cm3 := coalesce((select sum(b.length_mm::numeric * b.width_mm * b.height_mm) / 1000.0 from public.wh_parcels p join public.wh_boxes b on b.id = p.box_id where p.order_id = w.id),
                        (select b.length_mm::numeric * b.width_mm * b.height_mm / 1000.0 from public.wh_boxes b where b.id = w.box_id), 0);
  v_vol_g := ceil(v_vol_cm3 / coalesce(nullif(rc.volumetric_divisor, 0), 5000) * 1000.0)::int;
  v_billed := (ceil(greatest(v_actual, v_vol_g)::numeric / rc.step_g::numeric)::int * rc.step_g);
  v_tol := case when fv.weigh_tolerance_g is null and fv.weigh_tolerance_pct is null then null
                else greatest(coalesce(fv.weigh_tolerance_g, 0), ceil(so.billed_weight_g * coalesce(fv.weigh_tolerance_pct, 0) / 100.0)::int) end;
  v_ship := rc.base_cents + ((v_billed / rc.step_g)::bigint * rc.per_100g_cents);
  v_ship := v_ship + round(v_ship::numeric * coalesce(rc.fuel_surcharge_bp, 0) / 10000.0)::bigint;
  v_amt := greatest(0, v_ship - so.shipping_cents);
  select e.storage_path into v_photo from public.wh_pack_evidence e
   where e.order_id = w.id and e.kind = 'scale' and e.purged_at is null order by e.created_at desc limit 1;
  return jsonb_build_object('ok', true, 'wh_order_id', w.id, 'wh_order_code', w.code, 'quoted_g', so.billed_weight_g, 'actual_g', v_actual,
    'volumetric_g', v_vol_g, 'billed_g', v_billed, 'diff_g', v_billed - so.billed_weight_g, 'tolerance_g', v_tol, 'amount_cents', v_amt,
    'new_shipping_cents', v_ship, 'photo_path', v_photo,
    'dispute_days', coalesce(fv.dispute_window_days, 7),
    'over', v_tol is not null and v_billed - so.billed_weight_g > v_tol and v_amt > 0,
    'tolerance_unknown', v_tol is null);
end $function$
;

-- restore ds10_claim_open(uuid,text,text,text,text[]) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds10_claim_open(p_so uuid, p_kind text, p_choice text, p_message text, p_photos text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  so public.store_orders := public.ds_order_own(p_so);
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_msg text := btrim(coalesce(p_message, ''));
  v_days int := public.ds10_setting_int('dropship.claim_window_days', 14, 1, 90);
  v_deliv timestamptz;
  v_case public.dropship_cases;
  v_p text;
  v_ticket uuid;
  h public.escrow_holds;
begin
  perform ds_feature_guard('orders');
  -- paused / closed merchants keep support for orders in progress: a claim is allowed
  if v_kind not in ('lost', 'damaged') then raise exception 'INVALID_INPUT: Choose lost or damaged.'; end if;
  if v_choice not in ('reship', 'refund') then raise exception 'INVALID_INPUT: Choose reship or refund to your wallet.'; end if;
  if length(v_msg) < 10 or length(v_msg) > 2000 then raise exception 'INVALID_INPUT: Describe what happened (10 to 2,000 characters).'; end if;
  if so.cancelled_at is not null then raise exception 'ORDER_CANCELLED: This order is cancelled.'; end if;
  if not public.ds10_handed_over(so.id) then raise exception 'NOT_SHIPPED: Lost and damaged parcel claims open once the parcel has shipped.'; end if;
  v_deliv := public.ds10_delivered_at(so.id);
  if v_kind = 'lost' and v_deliv is not null then raise exception 'DELIVERED: The carrier shows this parcel as delivered. If it arrived damaged, choose damaged.'; end if;
  if v_deliv is not null and v_deliv <= now() - make_interval(days => v_days) then
    raise exception 'TOO_LATE: Claims are possible up to % days after delivery.', v_days;
  end if;
  if exists (select 1 from public.dropship_cases c where c.store_order_id = so.id and c.kind in ('lost', 'damaged') and c.status in ('reported', 'carrier_claim', 'awaiting_approval')) then
    raise exception 'ALREADY_OPEN: A claim for this order is already open.';
  end if;
  if v_kind = 'damaged' and coalesce(cardinality(p_photos), 0) = 0 then raise exception 'PHOTO_REQUIRED: Add at least one photo of the damage.'; end if;
  if coalesce(cardinality(p_photos), 0) > 6 then raise exception 'TOO_MANY_PHOTOS: Up to 6 photos.'; end if;
  insert into public.dropship_cases (store_order_id, org_id, kind, merchant_choice, description)
  values (so.id, so.org_id, v_kind, v_choice, v_msg) returning * into v_case;
  foreach v_p in array coalesce(p_photos, '{}') loop
    if v_p !~ ('^' || so.org_id::text || '/' || so.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then raise exception 'INVALID_PHOTO: A photo is not filed under this order.'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ds-claims' and o.name = v_p) then raise exception 'PHOTO_MISSING: Upload the photo first.'; end if;
    insert into public.dropship_case_photos (case_id, org_id, path) values (v_case.id, so.org_id, v_p);
  end loop;
  v_ticket := public.ds10_ticket_open(so.org_id, so.id,
    format('%s claim %s · order %s', case v_kind when 'lost' then 'Lost parcel' else 'Damaged parcel' end, v_case.code, coalesce(so.external_order_name, so.order_number)),
    'order_problem', format('%s%sThe merchant asks for: %s.', v_msg, E'\n\n', case v_choice when 'reship' then 'a reship' else 'a refund to the wallet' end),
    coalesce((select jsonb_agg(jsonb_build_object('path', p.path, 'name', 'Photo', 'bucket', 'ds-claims')) from public.dropship_case_photos p where p.case_id = v_case.id), '[]'::jsonb));
  update public.dropship_cases set ticket_id = v_ticket where id = v_case.id;
  perform public.ds10_case_step(v_case.id, 'reported', format('You reported the parcel as %s and asked for %s.', v_kind, case v_choice when 'reship' then 'a reship' else 'a refund' end));
  -- payment protection still holding the money: the dispute keeps it held until Octopus decides
  h := public.ds10_open_hold(so.id);
  if h.id is not null and h.status = 'held' then
    perform public.open_escrow_dispute(h.id, format('Dropship %s claim %s', v_kind, v_case.code));
  end if;
  perform write_audit('ds_case.opened', 'dropship_cases', v_case.id::text,
    jsonb_build_object('org_id', so.org_id, 'code', v_case.code, 'kind', v_kind, 'choice', v_choice, 'photos', coalesce(cardinality(p_photos), 0), 'ticket_id', v_ticket));
  return jsonb_build_object('ok', true, 'id', v_case.id, 'code', v_case.code, 'ticket_id', v_ticket,
    'message', format('Claim %s sent. Octopus support replies in Support; the money stays with Octopus until it is decided.', v_case.code));
end $function$
;

-- restore ds10_approval_limit_cents() (exact installed text)
CREATE OR REPLACE FUNCTION public.ds10_approval_limit_cents()
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select 100000::bigint $function$
;

-- restore ds10_case_refund(uuid,bigint,text) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds10_case_refund(p_case uuid, p_amount_cents bigint, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.dropship_cases := public.ds10_case_for_staff(p_case);
  so public.store_orders;
  v_fa uuid;
  v_cap bigint;
begin
  if c.kind = 'return' and c.status <> 'received' then raise exception 'INVALID_STEP: Returns are refunded after the warehouse has checked them (Settle return).'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT: Enter the refund amount.'; end if;
  v_cap := public.ds10_refund_cap(c.store_order_id);
  if p_amount_cents > v_cap then raise exception 'REFUND_TOO_HIGH: The refund can be at most %.', ds_order_usd(v_cap); end if;
  select * into so from public.store_orders where id = c.store_order_id;
  update public.dropship_cases set refund_cents = p_amount_cents, outcome_message = left(nullif(btrim(coalesce(p_message, '')), ''), 600), updated_at = now() where id = c.id;
  if p_amount_cents <= public.ds10_approval_limit_cents() then
    return public.ds10_refund_execute(c.id);
  end if;
  -- over the limit: Finance approval (org_id stays empty: DS10 runs the refund itself once a different person approves)
  insert into public.finance_approvals (kind, org_id, amount_cents, currency, reason, requested_by)
  values ('refund', null, p_amount_cents, 'USD',
          left(format('Dropship %s %s · order %s · %s · refund %s to the merchant wallet', case c.kind when 'return' then 'return' else c.kind || ' parcel claim' end,
                      c.code, so.order_number, (select name from public.organizations where id = c.org_id), ds_order_usd(p_amount_cents)), 500),
          auth.uid())
  returning id into v_fa;
  perform write_audit('finance.request', 'finance_approvals', v_fa::text, jsonb_build_object('kind', 'refund', 'amount', p_amount_cents, 'currency', 'USD', 'case', c.code));
  update public.dropship_cases set status = 'awaiting_approval', finance_approval_id = v_fa, updated_at = now() where id = c.id;
  perform public.ds10_case_step(c.id, 'awaiting_approval', format('Refund of %s proposed; refunds above US$1,000 need a second Finance approver.', ds_order_usd(p_amount_cents)));
  perform write_audit('ds_case.refund_proposed', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'amount_cents', p_amount_cents, 'finance_approval_id', v_fa));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'awaiting_approval', 'finance_approval_id', v_fa,
    'message', 'Waiting for approval. Another Finance user or an admin must approve this refund.');
end $function$
;

-- restore ds10_refund_approve(uuid,boolean,text) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds10_refund_approve(p_case uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.dropship_cases;
  a public.finance_approvals;
begin
  perform require_step_up();
  if not (can('finance', 'approve') or is_admin()) then raise exception 'FORBIDDEN: Finance approvers decide refunds above US$1,000.'; end if;
  select * into c from public.dropship_cases where id = p_case for update;
  if c.id is null or c.status <> 'awaiting_approval' then raise exception 'NOT_WAITING: This case has no refund waiting for approval.'; end if;
  select * into a from public.finance_approvals where id = c.finance_approval_id for update;
  if a.status <> 'requested' then raise exception 'INVALID_TRANSITION'; end if;
  if a.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE: A different person must approve the refund you proposed.'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'INVALID_INPUT: Say why the refund is rejected.'; end if;
  update public.finance_approvals set status = (case when p_approve then 'approved' else 'rejected' end)::approval_status,
         approved_by = auth.uid(), decided_at = now() where id = a.id;
  perform write_audit('finance.decide', 'finance_approvals', a.id::text, jsonb_build_object('approve', p_approve, 'note', p_note, 'case', c.code));
  -- the trigger on finance_approvals runs the refund / puts the case back (one path for both screens)
  select * into c from public.dropship_cases where id = p_case;
  return jsonb_build_object('ok', true, 'code', c.code, 'status', c.status);
end $function$
;

-- restore ds_sup_price_change(uuid,bigint) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds_sup_price_change(p_price_id uuid, p_new_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sup uuid := ds14_supplier();
  pp public.supplier_product_prices;
  sp public.supplier_products;
  p public.products;
  v_pct numeric;
  v_auto integer := (ds14_rules() ->> 'price_auto_pct')::integer;
  v_sub uuid;
  v_status text;
begin
  if not exists (select 1 from public.supplier_switches w where w.supplier_id = v_sup and w.product_upload) then
    raise exception 'UPLOAD_OFF: Product changes are switched off for your account. Ask your Octopus contact.';
  end if;
  if p_new_minor is null or p_new_minor <= 0 or p_new_minor > 1000000000 then raise exception 'BAD_PRICE: Enter a cost above 0.'; end if;
  select * into pp from public.supplier_product_prices where id = p_price_id and supplier_id = v_sup and not is_superseded for update;
  if pp.id is null then raise exception 'NOT_FOUND: This price is not yours.'; end if;
  if p_new_minor = pp.price_minor then raise exception 'NO_CHANGE: The cost is already that amount.'; end if;
  if exists (select 1 from public.dropship_supplier_submissions x where x.supplier_id = v_sup and x.kind = 'price_change' and x.status = 'submitted' and x.payload ->> 'price_id' = pp.id::text) then
    raise exception 'ALREADY_PENDING: A price change for this product is already waiting for review.';
  end if;
  select * into sp from public.supplier_products where supplier_id = pp.supplier_id and product_id = pp.product_id;
  select * into p from public.products where id = pp.product_id;
  v_pct := round(abs(p_new_minor - pp.price_minor)::numeric * 100 / pp.price_minor, 2);
  v_status := case when v_auto is not null and v_pct <= v_auto then 'auto_approved' else 'submitted' end;
  insert into public.dropship_supplier_submissions (supplier_id, kind, status, summary, payload, supplier_product_id, reviewed_at)
  values (v_sup, 'price_change', v_status, left('Price · ' || p.title, 200),
          jsonb_build_object('price_id', pp.id, 'old_minor', pp.price_minor, 'new_minor', p_new_minor, 'currency', pp.currency, 'pct', v_pct), sp.id,
          case when v_status = 'auto_approved' then now() end)
  returning id into v_sub;
  if v_status = 'auto_approved' then perform public.ds14_apply_price(v_sub); end if;
  return jsonb_build_object('id', v_sub, 'status', v_status, 'pct', v_pct);
end $function$
;

-- restore ds_sup_slip(uuid) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds_sup_slip(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sup uuid := ds14_supplier();
  po public.dropship_partner_orders;
  r jsonb;
begin
  select * into po from public.dropship_partner_orders where id = p_id and supplier_id = v_sup for update;
  if po.id is null then raise exception 'NOT_FOUND: This order is not yours.'; end if;
  r := public.ds14_sup_order_row(po, true);
  if r ->> 'status' = 'cancelled' then raise exception 'ORDER_CANCELLED: This order was cancelled. Do not ship it.'; end if;
  update public.dropship_partner_orders set slip_at = coalesce(slip_at, now()), updated_at = now() where id = po.id;
  return jsonb_build_object('order', r -> 'order', 'date', current_date, 'ship_to', r -> 'ship_to', 'items', r -> 'items');
end $function$
;

-- restore ds_staff_rules_save(integer,integer) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds_staff_rules_save(p_price_auto_pct integer, p_ship_within_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  perform ds14_assert('edit');
  if p_price_auto_pct is not null and p_price_auto_pct not between 0 and 50 then raise exception 'BAD_RULE: Auto-approve price changes up to 0 to 50 percent, or leave it empty to review every price change.'; end if;
  if p_ship_within_days is not null and p_ship_within_days not between 1 and 60 then raise exception 'BAD_RULE: Ship within 1 to 60 days, or leave it empty.'; end if;
  v := jsonb_strip_nulls(jsonb_build_object('price_auto_pct', p_price_auto_pct, 'ship_within_days', p_ship_within_days));
  insert into public.site_settings (key, value, description, is_public, updated_by)
  values ('dropship_supplier_rules', v, 'Octopus Dropship supplier portal rules (auto-approve price changes up to N percent; ship within N days)', false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid(), is_public = false;
  perform write_audit('ds_supplier_rules.saved', 'site_settings', 'dropship_supplier_rules', v);
  return v;
end $function$
;

-- restore review_supplier_application(uuid,text,text) (exact installed text)
CREATE OR REPLACE FUNCTION public.review_supplier_application(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare old_status text;
begin
  if not has_permission(auth.uid(), 'suppliers', 'approve') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('in_review','approved','rejected') then raise exception 'BAD_STATUS'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note),'') = '' then raise exception 'NOTE_REQUIRED'; end if;
  select status into old_status from supplier_applications where id = p_id for update;
  if old_status is null then raise exception 'NOT_FOUND'; end if;
  update supplier_applications
     set status = p_status, review_note = nullif(trim(coalesce(p_note,'')),''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  insert into audit_log(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'supplier_application.review', 'supplier_application', p_id::text,
          jsonb_build_object('from', old_status, 'to', p_status, 'note', p_note));
end $function$
;

-- restore tk_send_client_quote(uuid) (exact installed text)
CREATE OR REPLACE FUNCTION public.tk_send_client_quote(p_quote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q public.tk_client_quotes;
  v public.tk_client_projects;
  v_pct integer;
  v_dep bigint;
begin
  select * into q from public.tk_client_quotes where id = p_quote;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = q.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors send quotes'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.stage not in ('sourcing', 'quote_deposit') then raise exception 'NOT_IN_SOURCING: client quotes are sent in Sourcing or Quote and deposit'; end if;
  select * into q from public.tk_client_quotes where id = p_quote for update;
  if q.status <> 'draft' then raise exception 'QUOTE_SENT: this version was already sent'; end if;
  if not exists (select 1 from public.tk_client_quote_lines l where l.quote_id = q.id) or q.total_cents <= 0 then raise exception 'LINES_REQUIRED: add at least one line'; end if;
  if q.valid_until is not null and q.valid_until < current_date then raise exception 'QUOTE_EXPIRED: change the valid-until date first'; end if;
  if exists (select 1 from public.tk_client_quotes x where x.project_id = v.id and x.status = 'accepted') then raise exception 'QUOTE_ACCEPTED: the client has accepted a quote'; end if;
  v_pct := public.tk_deposit_pct();
  if v_pct is null then raise exception 'DEPOSIT_NOT_SET: an admin sets the deposit percentage (Admin › Turnkey › Services and fees) before quotes are sent'; end if;
  v_dep := (q.total_cents * v_pct + 50) / 100;
  if v_dep <= 0 then raise exception 'DEPOSIT_TOO_SMALL: the quote total is too small for a deposit'; end if;
  update public.tk_client_quotes set status = 'superseded', updated_at = now() where project_id = v.id and status = 'sent';
  update public.tk_client_quotes set status = 'sent', deposit_pct = v_pct, deposit_cents = v_dep, sent_at = now(), sent_by = auth.uid(), updated_at = now() where id = q.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'quote', 'quote_deposit', 'Quote version ' || q.version || ' is ready: US$ ' || to_char(q.total_cents / 100.0, 'FM999,999,999,990.00') ||
          '. Deposit when you accept: ' || v_pct || '% (US$ ' || to_char(v_dep / 100.0, 'FM999,999,999,990.00') || ').');
  perform write_audit('turnkey.quote_sent', 'tk_client_quotes', q.id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version, 'total_cents', q.total_cents, 'deposit_pct', v_pct, 'deposit_cents', v_dep));
  return jsonb_build_object('id', q.id, 'deposit_pct', v_pct, 'deposit_cents', v_dep);
end $function$
;

-- restore tk_staff_quotes(uuid) (exact installed text)
CREATE OR REPLACE FUNCTION public.tk_staff_quotes(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'deposit_pct', public.tk_deposit_pct(),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'version', q.version, 'status', q.status, 'total_cents', q.total_cents,
        'deposit_pct', q.deposit_pct, 'deposit_cents', q.deposit_cents, 'message', q.message, 'client_comment', q.client_comment, 'valid_until', q.valid_until,
        'sent_at', q.sent_at, 'decided_at', q.decided_at, 'created_at', q.created_at, 'updated_at', q.updated_at,
        'created_by_name', coalesce(nullif(btrim(pc.full_name), ''), pc.email), 'sent_by_name', coalesce(nullif(btrim(ps.full_name), ''), ps.email),
        'document_id', q.document_id, 'document_number', doc.number, 'document_status', doc.status, 'paid_cents', doc.paid_cents,
        'deposit_paid', q.document_id is not null and public.tk_fee_is_paid(q.document_id),
        'cost_cents', (select sum(c.cost_cents) from public.tk_client_quote_line_costs c where c.quote_id = q.id),
        'cost_complete', not exists (select 1 from public.tk_client_quote_lines l where l.quote_id = q.id
                                       and not exists (select 1 from public.tk_client_quote_line_costs c where c.line_id = l.id)),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'description', l.description, 'qty', l.qty,
             'unit_price_cents', l.unit_price_cents, 'total_cents', l.total_cents, 'unit_cost_cents', c.unit_cost_cents, 'cost_cents', c.cost_cents,
             'factory_line_id', c.factory_line_id, 'supplier_name', fq.supplier_name) order by l.line_no)
           from public.tk_client_quote_lines l
           left join public.tk_client_quote_line_costs c on c.line_id = l.id
           left join public.tk_factory_quote_lines fl on fl.id = c.factory_line_id
           left join public.tk_factory_quotes fq on fq.id = fl.factory_quote_id
          where l.quote_id = q.id), '[]'::jsonb)) order by q.version desc)
      from public.tk_client_quotes q
      left join public.profiles pc on pc.id = q.created_by
      left join public.profiles ps on ps.id = q.sent_by
      left join public.documents doc on doc.id = q.document_id
     where q.project_id = p_project), '[]'::jsonb),
    'factory_quotes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'supplier_name', f.supplier_name, 'supplier_ref', f.supplier_ref,
        'valid_until', f.valid_until, 'notes', f.notes, 'total_cost_cents', f.total_cost_cents, 'created_at', f.created_at,
        'created_by_name', coalesce(nullif(btrim(pf.full_name), ''), pf.email),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', fl.id, 'line_no', fl.line_no, 'description', fl.description, 'qty', fl.qty,
             'unit_cost_cents', fl.unit_cost_cents, 'total_cost_cents', fl.total_cost_cents) order by fl.line_no)
           from public.tk_factory_quote_lines fl where fl.factory_quote_id = f.id), '[]'::jsonb)) order by f.created_at desc)
      from public.tk_factory_quotes f left join public.profiles pf on pf.id = f.created_by where f.project_id = p_project), '[]'::jsonb));
end $function$
;

-- restore tk_settings() (exact installed text)
CREATE OR REPLACE FUNCTION public.tk_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (is_staff() and can('turnkey', 'view')) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'deposit_pct', public.tk_deposit_pct(),
    'extra_traveller_day_cents', (select s.extra_traveller_day_cents from public.tk_services s where s.code = 'visit_china'),
    'included_travellers', (select s.included_travellers from public.tk_services s where s.code = 'visit_china'),
    'visit_rule_text', (select s.rule_text from public.tk_services s where s.code = 'visit_china'),
    'passport_retention_days', public.tk_passport_retention_days(),
    'passport_retention_set', exists (select 1 from public.site_settings x where x.key = 'turnkey.passport_retention_days' and jsonb_typeof(x.value) = 'number'),
    'am_waiver_threshold_cents', public.tk_am_waiver_threshold_cents(),
    'can_edit', is_admin(),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'entity_id', a.entity_id, 'details', a.details, 'at', a.created_at,
                                                             'by', coalesce(nullif(btrim(pr.full_name), ''), pr.email)) order by a.created_at desc)
                           from (select * from public.audit_log l
                                  where l.action in ('turnkey.deposit_pct', 'turnkey.setting')
                                  order by l.created_at desc limit 20) a
                           left join public.profiles pr on pr.id = a.actor_id), '[]'::jsonb));
end $function$
;

-- ───────────────────────── New functions, columns and tables ─────────────────────────
do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
    'tk_set_project_custom', 'tk_set_deposit_pct_custom', 'tk_deposit_pct_custom', 'ds16_markup_page', 'ds16_markup_propose', 'ds16_markup_decide',
    'ds16_markup_withdraw', 'ds16_supplier_bank_page', 'ds16_supplier_bank_propose', 'ds16_supplier_bank_decide', 'ds_staff_rules_save_v2',
    'ds16_shipping_markup_pct', 'ds16_markup_pct_at', 'ds16_country_rule', 'ds16_last_movement_at', 'ds16_notify_ds_staff', 'ds16_markup_can',
    'ds16_guard_protected_settings', 'ds16_duty_mode_guard', 'ds16_supplier_application_guard']) loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

alter table public.supplier_applications drop column if exists first_approved_at;
alter table public.supplier_applications drop column if exists first_approved_by;
alter table public.tk_client_projects drop column if exists custom_branded;

drop table if exists public.supplier_bank_detail_changes;
drop table if exists public.dropship_setting_changes;
drop table if exists public.ds16_settings_backup;
