-- 20261101000212_i2_store_orders_handoffs_and_outbox.sql
-- Phase 1 · Step I2: Store orders core, cross-division handoffs, DB-only domain_events outbox + pg_cron,
-- status_mappings with target column, shipments & tickets links, public tracking token,
-- internal_charge_rules (seeded inactive, null rates), and duty_rate_entries.de_minimis_applies_to.
--
-- Rules implemented:
--  · Item 18 & Review 3: status_mappings with target ('order' | 'request' | 'brand_project' | 'ticket'), covering
--    store_order_stage -> merchant_status, division_handoff, escrow_hold, 3pl_shipment, 3pl_stock, sourcing_po,
--    sourcing_rfq (-> 'request'), mmb_brand_project (-> 'brand_project'), and support_ticket (-> 'ticket').
--  · Item 19: store_orders.fx_rate_to_usd nullable, NO default 1; required (> 0) when buyer_currency <> 'USD'.
--  · Item 20 & Review 1: shipments.tracking_token via extensions.gen_random_bytes; /t/[token] serves ONLY store_order
--    shipments. tickets adds store_order_id, rfq_id, and division_id with "at most one" link check (0 or 1 link).
--  · Item 21 & Review 4–5: domain_events DB-only SQL consumer + pg_cron ('10 seconds'), exponential retry/backoff
--    (1m/5m/30m/2h -> dead at 5 attempts), duplicate idempotency_key no-op, fast_ship stock shortage -> on_hold
--    (hold_reason='stock_shortage', no error), label_ready stays 'processing', picked_up -> 'shipped', delivered sets
--    store_orders.delivered_at and Finance's escrow_holds.auto_release_at (no second copy on store_orders).
--  · Item 22: internal_charge_rules seeded inactive (active = false) with NULL rates.
--  · Item 23 & Review 6: store_orders has NO buyer_email (PII columns: buyer_name, buyer_phone, shipping_address only);
--    RLS restricts store_orders/items to merchant org + DS/Finance staff; 0 buyer PII on /t/[token] or reports.
--  · Item 24: duty_rate_entries.de_minimis_applies_to ('duty' | 'duty_and_tax').
--
-- Down: supabase/migrations/down/20261101000212_i2_store_orders_handoffs_and_outbox.down.sql

-- ───────── 1. Item 24: duty_rate_entries.de_minimis_applies_to ('duty' | 'duty_and_tax') ─────────
alter table public.duty_rate_entries
  add column if not exists de_minimis_applies_to text not null default 'duty'
    check (de_minimis_applies_to in ('duty', 'duty_and_tax'));

comment on column public.duty_rate_entries.de_minimis_applies_to is
  'Controls de minimis exemption below de_minimis_cents: ''duty'' exempts customs duty while configured import tax (tax_bp) still applies; ''duty_and_tax'' exempts both duty and import tax.';

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
    'de_minimis_cents', v_entry.de_minimis_cents,
    'de_minimis_applies_to', v_entry.de_minimis_applies_to
  );
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
      -- Item 24: below de_minimis_cents -> duty is 0; tax applies when de_minimis_applies_to = 'duty' and is 0 when 'duty_and_tax'
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
  'Order-level 4-part quote engine. Processing fee is charged ONCE per order (first + extra*(total_qty-1) + packaging). Combined parcel billed weight = max(sum(actual weight_g), ceil((sum(box_volume_cm3)/divisor)*1000)) rounded up to 100 g step (pack-station re-weigh corrects later within 50 g / 10% tolerance). Duty base: catalogue/product quotes use Octopus product price and mark duties_status = ''estimate''; order quotes use the buyer''s paid item price converted to USD cents at the locked FX rate. Below de_minimis_cents: duty = 0, import tax per de_minimis_applies_to (''duty'' charges tax_bp; ''duty_and_tax'' charges 0). Final customs valuation rule is set in Step 6b.';

-- ───────── 2. Item 18 & Review 3: status_mappings with target ('order' | 'request' | 'brand_project' | 'ticket') ─────────
create table if not exists public.status_mappings (
  id uuid primary key default gen_random_uuid(),
  source_domain text not null check (
    source_domain in (
      'store_order_stage', 'division_handoff', 'escrow_hold',
      '3pl_shipment', '3pl_stock', 'sourcing_po',
      'sourcing_rfq', 'mmb_brand_project', 'support_ticket'
    )
  ),
  source_status text not null check (btrim(source_status) <> ''),
  target text not null check (target in ('order', 'request', 'brand_project', 'ticket')),
  merchant_status text not null check (btrim(merchant_status) <> ''),
  merchant_label text not null check (btrim(merchant_label) <> ''),
  staff_stage text,
  triggers_escrow_clock boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (source_domain, source_status),
  constraint status_mappings_domain_target_check check (
    (
      source_domain in ('store_order_stage', 'division_handoff', 'escrow_hold', '3pl_shipment', '3pl_stock', 'sourcing_po')
      and target = 'order'
      and staff_stage is not null
      and staff_stage in (
        'unpaid', 'on_hold', 'paid_to_assign', 'sourcing', 'packing',
        'handed_over', 'delivered', 'cancelled', 'refunded', 'exception'
      )
      and merchant_status in (
        'awaiting_payment', 'on_hold', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'
      )
    )
    or (source_domain = 'sourcing_rfq' and target = 'request' and staff_stage is null)
    or (source_domain = 'mmb_brand_project' and target = 'brand_project' and staff_stage is null)
    or (source_domain = 'support_ticket' and target = 'ticket' and staff_stage is null)
  ),
  constraint status_mappings_escrow_clock_check check (
    not triggers_escrow_clock or (target = 'order' and merchant_status = 'delivered')
  )
);

comment on table public.status_mappings is
  'Cross-division white-label status translation table. Order-affecting domains map to target=''order'' + canonical staff_stage/merchant_status; rfqs->''request'', brand_projects->''brand_project'', tickets->''ticket''.';

alter table public.status_mappings enable row level security;
revoke all on public.status_mappings from public, anon, authenticated;
grant select on public.status_mappings to authenticated;
grant all on public.status_mappings to service_role;

drop policy if exists status_mappings_staff_read on public.status_mappings;
create policy status_mappings_staff_read on public.status_mappings
  for select to authenticated
  using (is_staff() and not distributor_restricted());

insert into public.status_mappings (source_domain, source_status, target, merchant_status, merchant_label, staff_stage, triggers_escrow_clock, sort)
values
  -- 1) Canonical store_orders.staff_stage -> merchant_status (Review item 3)
  ('store_order_stage', 'unpaid',         'order', 'awaiting_payment', 'Awaiting payment', 'unpaid',         false, 10),
  ('store_order_stage', 'on_hold',        'order', 'on_hold',          'On hold',          'on_hold',        false, 20),
  ('store_order_stage', 'paid_to_assign', 'order', 'processing',       'Processing',       'paid_to_assign', false, 30),
  ('store_order_stage', 'sourcing',       'order', 'processing',       'Processing',       'sourcing',       false, 40),
  ('store_order_stage', 'packing',        'order', 'processing',       'Processing',       'packing',        false, 50),
  ('store_order_stage', 'handed_over',    'order', 'shipped',          'Shipped',          'handed_over',    false, 60),
  ('store_order_stage', 'delivered',      'order', 'delivered',        'Delivered',        'delivered',      true,  70),
  ('store_order_stage', 'cancelled',      'order', 'cancelled',        'Cancelled',        'cancelled',      false, 80),
  ('store_order_stage', 'refunded',       'order', 'refunded',         'Refunded',         'refunded',       false, 90),
  ('store_order_stage', 'exception',      'order', 'on_hold',          'On hold',          'exception',      false, 100),

  -- 2) division_handoffs (dropship_handoffs.status) -> target = 'order'
  ('division_handoff', 'pending',               'order', 'processing', 'Processing',  'paid_to_assign', false, 110),
  ('division_handoff', 'reserved',              'order', 'processing', 'Processing',  'packing',        false, 120),
  ('division_handoff', 'ordered_from_supplier', 'order', 'processing', 'Processing',  'sourcing',       false, 130),
  ('division_handoff', 'in_transit_to_3pl',     'order', 'processing', 'Processing',  'sourcing',       false, 140),
  ('division_handoff', 'received_at_3pl',       'order', 'processing', 'Processing',  'packing',        false, 150),
  ('division_handoff', 'ready_to_pick',         'order', 'processing', 'Processing',  'packing',        false, 160),
  ('division_handoff', 'packed',                'order', 'processing', 'Processing',  'packing',        false, 170),
  ('division_handoff', 'shipped',               'order', 'shipped',    'Shipped',     'handed_over',    false, 180),
  ('division_handoff', 'cancelled',             'order', 'cancelled',  'Cancelled',   'cancelled',      false, 190),
  ('division_handoff', 'exception',             'order', 'on_hold',    'On hold',     'exception',      false, 200),

  -- 3) Finance escrow_holds.status -> target = 'order'
  ('escrow_hold', 'held',               'order', 'processing', 'Payment protected',  'paid_to_assign', false, 210),
  ('escrow_hold', 'partially_released', 'order', 'delivered',  'Partially settled',  'delivered',      false, 220),
  ('escrow_hold', 'disputed',           'order', 'on_hold',    'Payment on hold',    'exception',      false, 230),
  ('escrow_hold', 'released',           'order', 'delivered',  'Settled',            'delivered',      false, 240),
  ('escrow_hold', 'refunded',           'order', 'refunded',   'Refunded',           'refunded',       false, 250),

  -- 4) 3PL shipment_status enum -> target = 'order' (label_ready stays 'processing'; picked_up -> 'shipped'; delivered -> 'delivered')
  ('3pl_shipment', 'draft',            'order', 'processing', 'Preparing shipment',  'packing',     false, 310),
  ('3pl_shipment', 'priced',           'order', 'processing', 'Preparing shipment',  'packing',     false, 320),
  ('3pl_shipment', 'created',          'order', 'processing', 'Packed at warehouse', 'packing',     false, 330),
  ('3pl_shipment', 'label_ready',      'order', 'processing', 'Label ready',         'packing',     false, 340),
  ('3pl_shipment', 'picked_up',        'order', 'shipped',    'Handed to carrier',   'handed_over', false, 350),
  ('3pl_shipment', 'in_transit',       'order', 'shipped',    'In transit',          'handed_over', false, 360),
  ('3pl_shipment', 'out_for_delivery', 'order', 'shipped',    'Out for delivery',    'handed_over', false, 370),
  ('3pl_shipment', 'delivered',        'order', 'delivered',  'Delivered',           'delivered',   true,  380),
  ('3pl_shipment', 'exception',        'order', 'on_hold',    'Delivery exception',  'exception',   false, 390),
  ('3pl_shipment', 'returned',         'order', 'on_hold',    'Returned',            'exception',   false, 400),

  -- 5) 3PL warehouse stock lifecycle -> target = 'order'
  ('3pl_stock', 'reserved', 'order', 'processing', 'Stock reserved', 'packing',   false, 410),
  ('3pl_stock', 'picked',   'order', 'processing', 'Picked & packed','packing',   false, 420),
  ('3pl_stock', 'released', 'order', 'cancelled',  'Cancelled',      'cancelled', false, 430),
  ('3pl_stock', 'shortage', 'order', 'on_hold',    'On hold',        'on_hold',   false, 440),

  -- 6) Sourcing PO / procurement -> target = 'order'
  ('sourcing_po', 'pending_procurement',   'order', 'processing', 'Processing',  'sourcing',  false, 510),
  ('sourcing_po', 'ordered_from_supplier', 'order', 'processing', 'Processing',  'sourcing',  false, 520),
  ('sourcing_po', 'in_transit_to_3pl',     'order', 'processing', 'Processing',  'sourcing',  false, 530),
  ('sourcing_po', 'received_at_3pl',       'order', 'processing', 'Processing',  'packing',   false, 540),
  ('sourcing_po', 'qc_failed',             'order', 'on_hold',    'On hold',     'exception', false, 550),
  ('sourcing_po', 'cancelled',             'order', 'cancelled',  'Cancelled',   'cancelled', false, 560),

  -- 7) Sourcing rfq_status enum -> target = 'request' (NEVER order!)
  ('sourcing_rfq', 'draft',     'request', 'draft',     'Draft request',        null, false, 610),
  ('sourcing_rfq', 'submitted', 'request', 'submitted', 'Request submitted',    null, false, 620),
  ('sourcing_rfq', 'assigned',  'request', 'reviewing', 'Sourcing in progress', null, false, 630),
  ('sourcing_rfq', 'quoting',   'request', 'reviewing', 'Preparing quote',      null, false, 640),
  ('sourcing_rfq', 'quoted',    'request', 'quoted',    'Quote ready',          null, false, 650),
  ('sourcing_rfq', 'accepted',  'request', 'accepted',  'Quote accepted',       null, false, 660),
  ('sourcing_rfq', 'expired',   'request', 'expired',   'Quote expired',        null, false, 670),
  ('sourcing_rfq', 'cancelled', 'request', 'cancelled', 'Request cancelled',    null, false, 680),

  -- 8) Make-My-Brand brand_projects status (6 active stages + terminal 'closed') -> target = 'brand_project'
  ('mmb_brand_project', 'submitted',  'brand_project', 'submitted',  'Brief submitted',      null, false, 710),
  ('mmb_brand_project', 'proof',      'brand_project', 'artwork',    'Artwork proof ready',  null, false, 720),
  ('mmb_brand_project', 'sample',     'brand_project', 'sampling',   'Sample in progress',   null, false, 730),
  ('mmb_brand_project', 'quoted',     'brand_project', 'quoted',     'Production quoted',    null, false, 740),
  ('mmb_brand_project', 'production', 'brand_project', 'production', 'In production',        null, false, 750),
  ('mmb_brand_project', 'stocked',    'brand_project', 'stocked',    'Stocked at warehouse', null, false, 760),
  ('mmb_brand_project', 'closed',     'brand_project', 'closed',     'Closed',               null, false, 770),

  -- 9) Support ticket_status enum -> target = 'ticket'
  ('support_ticket', 'new',              'ticket', 'open',          'Ticket received',        null, false, 810),
  ('support_ticket', 'open',             'ticket', 'open',          'In progress',            null, false, 820),
  ('support_ticket', 'waiting_customer', 'ticket', 'action_needed', 'Waiting for your reply', null, false, 830),
  ('support_ticket', 'waiting_internal', 'ticket', 'open',          'Under review',           null, false, 840),
  ('support_ticket', 'resolved',         'ticket', 'resolved',      'Resolved',               null, false, 850),
  ('support_ticket', 'closed',           'ticket', 'closed',        'Closed',                 null, false, 860),
  ('support_ticket', 'reopened',         'ticket', 'open',          'Reopened',               null, false, 870)
on conflict (source_domain, source_status) do nothing;

create or replace function public.resolve_dropship_status_mapping(
  p_source_domain text,
  p_source_status text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.status_mappings;
begin
  select *
    into m
    from public.status_mappings
   where source_domain = lower(btrim(coalesce(p_source_domain, '')))
     and source_status = lower(btrim(coalesce(p_source_status, '')))
   limit 1;

  if m.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'source_domain', m.source_domain,
    'source_status', m.source_status,
    'target', m.target,
    'merchant_status', m.merchant_status,
    'merchant_label', m.merchant_label,
    'staff_stage', m.staff_stage,
    'triggers_escrow_clock', m.triggers_escrow_clock
  );
end $$;

revoke all on function public.resolve_dropship_status_mapping(text, text) from public, anon;
grant execute on function public.resolve_dropship_status_mapping(text, text) to authenticated, service_role;

-- ───────── 3. Item 19, 23, Review 5 & 6: store_orders (NO buyer_email, NO escrow_release_at), store_order_items, & dropship_handoffs ─────────
create sequence if not exists public.seq_store_order
  as bigint
  start with 100001
  increment by 1
  no minvalue
  no maxvalue
  cache 1;

revoke all on sequence public.seq_store_order from public, anon, authenticated;
grant all on sequence public.seq_store_order to service_role;

create or replace function public.next_store_order_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'DSO-' || lpad(nextval('public.seq_store_order')::text, 6, '0')
$$;

revoke all on function public.next_store_order_number() from public, anon;
grant execute on function public.next_store_order_number() to authenticated, service_role;

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default public.next_store_order_number(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  channel text not null check (channel in ('shopify', 'woocommerce', 'csv', 'manual', 'api')),
  external_order_id text check (external_order_id is null or btrim(external_order_id) <> ''),
  external_order_name text,
  -- Review 6: Level 2 buyer shipping data ONLY (buyer_name, buyer_phone, shipping_address) — NO buyer_email!
  buyer_name text not null check (btrim(buyer_name) <> ''),
  buyer_phone text,
  shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
  destination_country char(2) not null check (destination_country ~ '^[A-Z]{2}$'),
  -- Item 19: fx_rate_to_usd is nullable with NO default 1; required (> 0) when buyer_currency <> 'USD'
  buyer_currency char(3) not null check (buyer_currency ~ '^[A-Z]{3}$'),
  fx_rate_to_usd numeric(18,8),
  shipping_method text not null check (shipping_method in ('economy', 'standard', 'express')),
  incoterm text not null default 'DDP' check (incoterm in ('DDP', 'DAP')),
  billed_weight_g integer check (billed_weight_g is null or billed_weight_g > 0),
  actual_pack_weight_g integer check (actual_pack_weight_g is null or actual_pack_weight_g > 0),
  product_cents bigint not null default 0 check (product_cents >= 0),
  processing_cents bigint not null default 0 check (processing_cents >= 0),
  shipping_cents bigint not null default 0 check (shipping_cents >= 0),
  duties_cents bigint check (duties_cents is null or duties_cents >= 0),
  total_cents bigint check (total_cents is null or total_cents >= 0),
  shipping_rate_card_id uuid references public.shipping_rate_cards(id) on delete restrict,
  fee_version_id uuid references public.fee_versions(id) on delete restrict,
  duty_rate_version_id uuid references public.duty_rate_versions(id) on delete restrict,
  payment_state text not null default 'unpaid' check (payment_state in ('unpaid', 'held', 'paid', 'refunded')),
  wallet_hold_id uuid references public.wallet_holds(id) on delete set null,
  escrow_hold_id uuid references public.escrow_holds(id) on delete set null,
  merchant_status text not null default 'awaiting_payment' check (
    merchant_status in ('awaiting_payment', 'on_hold', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')
  ),
  staff_stage text not null default 'unpaid' check (
    staff_stage in (
      'unpaid', 'on_hold', 'paid_to_assign', 'sourcing', 'packing',
      'handed_over', 'delivered', 'cancelled', 'refunded', 'exception'
    )
  ),
  hold_reason text,
  -- Review 5: store_orders keeps ONLY delivered_at; Finance owns escrow release date on escrow_holds.auto_release_at
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  is_test boolean not null default false,
  trace_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_orders_ds_division check (division_id = division_id_of('DS')),
  constraint store_orders_fx_check check (
    (buyer_currency = 'USD' and (fx_rate_to_usd is null or fx_rate_to_usd > 0))
    or (buyer_currency <> 'USD' and fx_rate_to_usd is not null and fx_rate_to_usd > 0)
  )
);

create unique index if not exists store_orders_org_channel_ext_uidx
  on public.store_orders (org_id, channel, external_order_id)
  where external_order_id is not null;

create index if not exists store_orders_org_created_idx on public.store_orders (org_id, created_at desc);
create index if not exists store_orders_division_idx on public.store_orders (division_id);
create index if not exists store_orders_rate_card_idx on public.store_orders (shipping_rate_card_id);
create index if not exists store_orders_fee_version_idx on public.store_orders (fee_version_id);
create index if not exists store_orders_duty_version_idx on public.store_orders (duty_rate_version_id);
create index if not exists store_orders_wallet_hold_idx on public.store_orders (wallet_hold_id);
create index if not exists store_orders_escrow_hold_idx on public.store_orders (escrow_hold_id);
create index if not exists store_orders_created_by_idx on public.store_orders (created_by);

comment on column public.store_orders.fx_rate_to_usd is
  'Locked FX multiplier to USD at order import/checkout. Nullable (no default 1) when buyer_currency = USD; required (> 0) when buyer_currency <> USD.';

-- Keep store_orders.merchant_status strictly derived from store_orders.staff_stage via status_mappings ('store_order_stage')
create or replace function public.sync_store_order_merchant_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_map jsonb;
begin
  v_map := public.resolve_dropship_status_mapping('store_order_stage', new.staff_stage);
  if v_map is not null then
    new.merchant_status := v_map ->> 'merchant_status';
  end if;
  return new;
end $$;

drop trigger if exists trg_store_orders_sync_merchant_status on public.store_orders;
create trigger trg_store_orders_sync_merchant_status
  before insert or update of staff_stage on public.store_orders
  for each row execute function public.sync_store_order_merchant_status();

create table if not exists public.store_order_items (
  id uuid primary key default gen_random_uuid(),
  store_order_id uuid not null references public.store_orders(id) on delete cascade,
  product_id uuid not null references public.dropship_products(id) on delete restrict,
  variant_id uuid not null references public.dropship_variants(id) on delete restrict,
  item_id uuid not null references public.item_master(id) on delete restrict,
  model_no text not null check (btrim(model_no) <> ''),
  title_snapshot text not null check (btrim(title_snapshot) <> ''),
  variant_label text,
  fulfilment_type text not null check (fulfilment_type in ('fast_ship', 'extended_catalog')),
  qty integer not null check (qty > 0),
  unit_product_cents bigint not null check (unit_product_cents >= 0),
  line_product_cents bigint not null check (line_product_cents = unit_product_cents * qty),
  buyer_unit_price_cents bigint check (buyer_unit_price_cents is null or buyer_unit_price_cents >= 0),
  declared_usd_cents bigint not null check (declared_usd_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists store_order_items_order_idx on public.store_order_items (store_order_id);
create index if not exists store_order_items_product_idx on public.store_order_items (product_id);
create index if not exists store_order_items_variant_idx on public.store_order_items (variant_id);
create index if not exists store_order_items_item_idx on public.store_order_items (item_id);

-- Item 23: RLS on store_orders & store_order_items (merchant org members + DS/Finance staff; column grants hide internal fields)
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;

revoke all on public.store_orders from public, anon, authenticated;
grant select (
  id, order_number, org_id, channel, external_order_id, external_order_name,
  buyer_name, buyer_phone, shipping_address, destination_country,
  buyer_currency, fx_rate_to_usd, shipping_method, incoterm, billed_weight_g,
  product_cents, processing_cents, shipping_cents, duties_cents, total_cents,
  payment_state, wallet_hold_id, escrow_hold_id, merchant_status,
  delivered_at, cancelled_at, cancel_reason, division_id,
  created_at, updated_at
) on public.store_orders to authenticated;
grant all on public.store_orders to service_role;

revoke all on public.store_order_items from public, anon, authenticated;
grant select (
  id, store_order_id, product_id, variant_id, model_no, title_snapshot, variant_label,
  fulfilment_type, qty, unit_product_cents, line_product_cents, buyer_unit_price_cents,
  declared_usd_cents, created_at
) on public.store_order_items to authenticated;
grant all on public.store_order_items to service_role;

drop policy if exists store_orders_read on public.store_orders;
create policy store_orders_read on public.store_orders
  for select to authenticated
  using (
    (
      org_id in (select my_org_ids())
      and exists (
        select 1
          from public.company_services cs
         where cs.org_id = store_orders.org_id
           and cs.service = 'dropship'
           and cs.status = 'on'
      )
    )
    or (
      is_staff()
      and not distributor_restricted()
      and (
        in_division(division_id_of('DS'))
        or can('finance', 'view')
      )
    )
  );

drop policy if exists store_order_items_read on public.store_order_items;
create policy store_order_items_read on public.store_order_items
  for select to authenticated
  using (
    exists (
      select 1
        from public.store_orders so
       where so.id = store_order_items.store_order_id
         and (
           (
             so.org_id in (select my_org_ids())
             and exists (
               select 1
                 from public.company_services cs
                where cs.org_id = so.org_id
                  and cs.service = 'dropship'
                  and cs.status = 'on'
             )
           )
           or (
             is_staff()
             and not distributor_restricted()
             and (
               in_division(division_id_of('DS'))
               or can('finance', 'view')
             )
           )
         )
    )
  );

-- Wire real FK from warehouse_stock_movements.store_order_id -> store_orders(id) (Item 20)
alter table public.warehouse_stock_movements
  drop constraint if exists warehouse_stock_movements_store_order_id_fkey;
alter table public.warehouse_stock_movements
  add constraint warehouse_stock_movements_store_order_id_fkey
  foreign key (store_order_id) references public.store_orders(id) on delete restrict;

create index if not exists warehouse_stock_movements_store_order_id_idx
  on public.warehouse_stock_movements (store_order_id);

-- Cross-division handoffs (DS -> 3PL pick/pack & DS -> SRC procurement; staff-only, 0 merchant rows)
create table if not exists public.dropship_handoffs (
  id uuid primary key default gen_random_uuid(),
  store_order_id uuid not null references public.store_orders(id) on delete cascade,
  store_order_item_id uuid references public.store_order_items(id) on delete cascade,
  handoff_type text not null check (handoff_type in ('warehouse_pick_pack', 'sourcing_procurement')),
  from_division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  to_division_id uuid not null references public.divisions(id) on delete restrict,
  warehouse_id text default 'SZ-01',
  supplier_product_id uuid references public.supplier_products(id) on delete restrict,
  status text not null default 'pending' check (
    status in (
      'pending', 'reserved', 'ordered_from_supplier', 'in_transit_to_3pl',
      'received_at_3pl', 'ready_to_pick', 'packed', 'shipped', 'cancelled', 'exception'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dropship_handoffs_idem_uidx
  on public.dropship_handoffs (
    store_order_id,
    handoff_type,
    coalesce(store_order_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists dropship_handoffs_item_idx on public.dropship_handoffs (store_order_item_id);
create index if not exists dropship_handoffs_from_div_idx on public.dropship_handoffs (from_division_id);
create index if not exists dropship_handoffs_to_div_idx on public.dropship_handoffs (to_division_id);
create index if not exists dropship_handoffs_supplier_product_idx on public.dropship_handoffs (supplier_product_id);

alter table public.dropship_handoffs enable row level security;
revoke all on public.dropship_handoffs from public, anon, authenticated;
grant select on public.dropship_handoffs to authenticated;
grant all on public.dropship_handoffs to service_role;

drop policy if exists dropship_handoffs_staff_read on public.dropship_handoffs;
create policy dropship_handoffs_staff_read on public.dropship_handoffs
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (
      in_division(division_id_of('DS'))
      or in_division(to_division_id)
      or can('finance', 'view')
    )
  );

-- ───────── 4. Item 21 & Review 4: domain_events (retry/backoff + dead-letter + duplicate-key no-op + pg_cron) ─────────
create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (btrim(event_type) <> ''),
  aggregate_type text not null check (btrim(aggregate_type) <> ''),
  aggregate_id uuid not null,
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  payload jsonb not null default '{}'::jsonb,
  db_status text not null default 'pending' check (db_status in ('pending', 'retry', 'processed', 'dead')),
  external_status text not null default 'not_applicable' check (
    external_status in ('not_applicable', 'pending', 'dispatched', 'done', 'dead')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  available_at timestamptz not null default now(),
  division_id uuid references public.divisions(id) on delete restrict,
  trace_id text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists domain_events_db_due_idx
  on public.domain_events (available_at, created_at)
  where db_status in ('pending', 'retry');
create index if not exists domain_events_ext_pending_idx
  on public.domain_events (external_status, created_at)
  where external_status = 'pending';
create index if not exists domain_events_agg_idx on public.domain_events (aggregate_type, aggregate_id);
create index if not exists domain_events_division_idx on public.domain_events (division_id);

create table if not exists public.domain_event_consumptions (
  event_id uuid not null references public.domain_events(id) on delete cascade,
  consumer text not null check (btrim(consumer) <> ''),
  outcome text not null default 'ok' check (outcome in ('ok', 'skipped')),
  processed_at timestamptz not null default now(),
  primary key (event_id, consumer)
);

comment on table public.domain_events is
  'Dropship & cross-division domain event outbox. SQL consumers perform DB-only work with 5-attempt exponential retry/backoff (1m/5m/30m/2h -> dead) and duplicate idempotency_key no-ops. External pushes run in the app worker (Steps 5/7); supplier-verification pause is added in Step 11.';

alter table public.domain_events enable row level security;
alter table public.domain_event_consumptions enable row level security;
revoke all on public.domain_events, public.domain_event_consumptions from public, anon, authenticated;
grant select on public.domain_events, public.domain_event_consumptions to authenticated;
grant all on public.domain_events, public.domain_event_consumptions to service_role;

drop policy if exists domain_events_staff_read on public.domain_events;
create policy domain_events_staff_read on public.domain_events
  for select to authenticated
  using (is_staff() and not distributor_restricted());

drop policy if exists domain_event_consumptions_staff_read on public.domain_event_consumptions;
create policy domain_event_consumptions_staff_read on public.domain_event_consumptions
  for select to authenticated
  using (is_staff() and not distributor_restricted());

-- Duplicate idempotency_key is a strict NO-OP (never resets a processed/retry/dead event)
create or replace function public.emit_dropship_domain_event(
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_division_id uuid default division_id_of('DS'),
  p_needs_external_push boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := btrim(p_idempotency_key);
  v_id uuid;
begin
  insert into public.domain_events (
    event_type,
    aggregate_type,
    aggregate_id,
    idempotency_key,
    payload,
    db_status,
    external_status,
    available_at,
    division_id
  ) values (
    btrim(p_event_type),
    btrim(p_aggregate_type),
    p_aggregate_id,
    v_key,
    coalesce(p_payload, '{}'::jsonb),
    'pending',
    case when coalesce(p_needs_external_push, false) then 'pending' else 'not_applicable' end,
    now(),
    p_division_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.domain_events where idempotency_key = v_key;
  end if;

  return v_id;
end $$;

revoke all on function public.emit_dropship_domain_event(text, text, uuid, text, jsonb, uuid, boolean) from public, anon;
grant execute on function public.emit_dropship_domain_event(text, text, uuid, text, jsonb, uuid, boolean) to authenticated, service_role;

-- ───────── 5. Item 20 & Review 1: shipments (store_order_id + tracking_token) & tickets (store_order_id + rfq_id + division_id + at-most-one) ─────────
alter table public.shipments alter column order_id drop not null;
alter table public.shipments
  add column if not exists store_order_id uuid references public.store_orders(id) on delete restrict,
  add column if not exists tracking_token text unique;

alter table public.shipments drop constraint if exists shipments_parent_xor_check;
alter table public.shipments
  add constraint shipments_parent_xor_check check (
    (order_id is not null and store_order_id is null)
    or (order_id is null and store_order_id is not null)
  );

alter table public.shipments drop constraint if exists shipments_tracking_token_check;
alter table public.shipments
  add constraint shipments_tracking_token_check check (
    (store_order_id is null and tracking_token is null)
    or (store_order_id is not null and tracking_token is not null and tracking_token ~ '^[0-9a-f]{32,64}$')
  );

create index if not exists shipments_store_order_id_idx on public.shipments (store_order_id);
grant select (store_order_id, tracking_token) on public.shipments to anon, authenticated;

create or replace function public.division_of_shipment(r shipments)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select division_id from orders where id = r.order_id),
    (select division_id from store_orders where id = r.store_order_id),
    case when r.order_id is null then division_id_of(division_code_for_service(r.service_code)) end
  )
$$;

create or replace function public.set_shipment_dropship_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.store_order_id is not null then
    if new.tracking_token is null or btrim(new.tracking_token) = '' then
      new.tracking_token := encode(extensions.gen_random_bytes(18), 'hex');
    end if;
  else
    new.tracking_token := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_shipments_dropship_token on public.shipments;
create trigger trg_shipments_dropship_token
  before insert or update of store_order_id, tracking_token on public.shipments
  for each row execute function public.set_shipment_dropship_token();

-- Review 1: tickets adds store_order_id, rfq_id, and division_id, with "at most one" link check (0 or 1 link allowed)
alter table public.tickets
  add column if not exists store_order_id uuid references public.store_orders(id) on delete set null,
  add column if not exists rfq_id uuid references public.rfqs(id) on delete set null,
  add column if not exists division_id uuid references public.divisions(id) on delete restrict;

alter table public.tickets drop constraint if exists tickets_order_xor_check;
alter table public.tickets drop constraint if exists tickets_link_at_most_one_check;
alter table public.tickets
  add constraint tickets_link_at_most_one_check check (
    num_nonnulls(order_id, store_order_id, rfq_id) <= 1
  );

-- Backfill division_id on existing order-linked tickets (general unlinked tickets stay NULL = company-wide)
update public.tickets t
   set division_id = o.division_id
  from public.orders o
 where t.order_id = o.id
   and t.division_id is null;

create or replace function public.set_ticket_division()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.division_id is not null and (
    tg_op = 'INSERT'
    or (
      new.order_id is not distinct from old.order_id
      and new.store_order_id is not distinct from old.store_order_id
      and new.rfq_id is not distinct from old.rfq_id
    )
  ) then
    return new;
  end if;

  if new.order_id is not null then
    new.division_id := (select division_id from public.orders where id = new.order_id);
  elsif new.store_order_id is not null then
    new.division_id := (select division_id from public.store_orders where id = new.store_order_id);
  elsif new.rfq_id is not null then
    new.division_id := (select division_id from public.rfqs where id = new.rfq_id);
  else
    new.division_id := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_tickets_set_division on public.tickets;
create trigger trg_tickets_set_division
  before insert or update of order_id, store_order_id, rfq_id, division_id on public.tickets
  for each row execute function public.set_ticket_division();

create index if not exists tickets_store_order_id_idx on public.tickets (store_order_id);
create index if not exists tickets_rfq_id_idx on public.tickets (rfq_id);
create index if not exists tickets_division_id_idx on public.tickets (division_id);
grant select (store_order_id, rfq_id, division_id) on public.tickets to anon, authenticated;

-- ───────── 6. Item 21 & Review 4–5: DB-only SQL consumer process_dropship_domain_events() + pg_cron ─────────
create or replace function public.process_dropship_domain_events(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.domain_events;
  v_processed integer := 0;
  v_retried integer := 0;
  v_dead integer := 0;
  v_so public.store_orders;
  v_it record;
  v_ws public.warehouse_stock;
  v_avail integer;
  v_shortage boolean;
  v_has_sourcing boolean;
  v_map jsonb;
  v_ship public.shipments;
  v_ho public.dropship_handoffs;
  v_deliv_at timestamptz;
  v_next_attempt integer;
  v_backoff interval;
  v_prev_role text;
begin
  v_prev_role := coalesce(current_setting('request.jwt.claims', true), '');

  for ev in
    select *
      from public.domain_events
     where db_status in ('pending', 'retry')
       and available_at <= now()
     order by created_at asc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked
  loop
    begin
      if exists (
        select 1 from public.domain_event_consumptions c where c.event_id = ev.id and c.consumer = 'db_core'
      ) then
        update public.domain_events
           set db_status = 'processed',
               processed_at = coalesce(processed_at, now())
         where id = ev.id;
        v_processed := v_processed + 1;
        continue;
      end if;

      perform set_config('request.jwt.claims', '', true);

      if ev.event_type = 'domain_event.test_poison' then
        raise exception 'SIMULATED_OUTBOX_FAILURE: %', coalesce(ev.payload ->> 'reason', 'poison event');

      elsif ev.event_type = 'store_order.paid' then
        select * into v_so from public.store_orders where id = ev.aggregate_id for update;
        if v_so.id is not null and v_so.cancelled_at is null then
          -- First check if any fast_ship line has insufficient 3PL stock (Review 4: on_hold + hold_reason='stock_shortage', no error)
          v_shortage := false;
          for v_it in
            select soi.*
              from public.store_order_items soi
             where soi.store_order_id = v_so.id
               and soi.fulfilment_type = 'fast_ship'
          loop
            select * into v_ws
              from public.warehouse_stock
             where warehouse_id = 'SZ-01' and item_id = v_it.item_id;
            v_avail := greatest(0, coalesce(v_ws.on_hand_qty, 0) - coalesce(v_ws.reserved_qty, 0));
            if v_avail < v_it.qty and not exists (
              select 1 from public.warehouse_stock_movements m
               where m.warehouse_id = 'SZ-01' and m.item_id = v_it.item_id and m.store_order_id = v_so.id and m.kind = 'reserve'
            ) then
              v_shortage := true;
              exit;
            end if;
          end loop;

          if v_shortage then
            v_map := public.resolve_dropship_status_mapping('3pl_stock', 'shortage');
            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   hold_reason = 'stock_shortage',
                   updated_at = now()
             where id = v_so.id;
          else
            v_has_sourcing := false;
            for v_it in
              select soi.*, dv.supplier_product_id
                from public.store_order_items soi
                join public.dropship_variants dv on dv.id = soi.variant_id
               where soi.store_order_id = v_so.id
               order by soi.created_at asc, soi.id asc
            loop
              if v_it.fulfilment_type = 'fast_ship' then
                perform public.record_warehouse_stock_movement(
                  v_it.item_id, 'reserve', v_it.qty, 'Store order ' || v_so.order_number || ' paid', 'SZ-01', v_so.id
                );
                insert into public.dropship_handoffs (
                  store_order_id, store_order_item_id, handoff_type, from_division_id, to_division_id, warehouse_id, status
                ) values (
                  v_so.id, v_it.id, 'warehouse_pick_pack', division_id_of('DS'), division_id_of('3PL'), 'SZ-01', 'reserved'
                )
                on conflict do nothing;
              else
                v_has_sourcing := true;
                insert into public.dropship_handoffs (
                  store_order_id, store_order_item_id, handoff_type, from_division_id, to_division_id, supplier_product_id, status
                ) values (
                  v_so.id, v_it.id, 'sourcing_procurement', division_id_of('DS'), division_id_of('SRC'), v_it.supplier_product_id, 'ordered_from_supplier'
                )
                on conflict do nothing;
              end if;
            end loop;

            if v_has_sourcing then
              v_map := public.resolve_dropship_status_mapping('division_handoff', 'ordered_from_supplier');
            else
              v_map := public.resolve_dropship_status_mapping('division_handoff', 'reserved');
            end if;

            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   hold_reason = null,
                   updated_at = now()
             where id = v_so.id;
          end if;
        end if;

      elsif ev.event_type = 'store_order.cancelled' then
        select * into v_so from public.store_orders where id = ev.aggregate_id for update;
        if v_so.id is not null then
          for v_it in
            select m.warehouse_id, m.item_id, m.qty
              from public.warehouse_stock_movements m
             where m.store_order_id = v_so.id
               and m.kind = 'reserve'
               and not exists (
                 select 1 from public.warehouse_stock_movements m2
                  where m2.warehouse_id = m.warehouse_id
                    and m2.item_id = m.item_id
                    and m2.store_order_id = v_so.id
                    and m2.kind in ('release', 'pick')
               )
          loop
            perform public.record_warehouse_stock_movement(
              v_it.item_id, 'release', v_it.qty, 'Store order ' || v_so.order_number || ' cancelled', v_it.warehouse_id, v_so.id
            );
          end loop;

          update public.dropship_handoffs
             set status = 'cancelled',
                 updated_at = now()
           where store_order_id = v_so.id
             and status not in ('shipped', 'cancelled');

          v_map := public.resolve_dropship_status_mapping('3pl_stock', 'released');
          update public.store_orders
             set staff_stage = v_map ->> 'staff_stage',
                 merchant_status = v_map ->> 'merchant_status',
                 cancelled_at = coalesce(cancelled_at, now()),
                 updated_at = now()
           where id = v_so.id;
        end if;

      elsif ev.event_type = 'shipment.status_changed' then
        select * into v_ship from public.shipments where id = ev.aggregate_id;
        if v_ship.id is not null and v_ship.store_order_id is not null then
          select * into v_so from public.store_orders where id = v_ship.store_order_id for update;
          v_map := public.resolve_dropship_status_mapping('3pl_shipment', coalesce(ev.payload ->> 'status', v_ship.status::text));

          -- Physical pick stock movement runs when parcel is packed/label_ready or handed over (idempotent per order+item)
          if coalesce(ev.payload ->> 'status', v_ship.status::text) in ('label_ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered') then
            for v_it in
              select m.warehouse_id, m.item_id, m.qty
                from public.warehouse_stock_movements m
               where m.store_order_id = v_so.id
                 and m.kind = 'reserve'
                 and not exists (
                   select 1 from public.warehouse_stock_movements m2
                    where m2.warehouse_id = m.warehouse_id
                      and m2.item_id = m.item_id
                      and m2.store_order_id = v_so.id
                      and m2.kind in ('release', 'pick')
                 )
            loop
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'pick', v_it.qty, 'Shipment ' || v_ship.code || ' packed', v_it.warehouse_id, v_so.id
              );
            end loop;

            update public.dropship_handoffs
               set status = case
                     when coalesce(ev.payload ->> 'status', v_ship.status::text) in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') then 'shipped'
                     else 'packed'
                   end,
                   updated_at = now()
             where store_order_id = v_so.id
               and handoff_type = 'warehouse_pick_pack';
          end if;

          if v_map is not null then
            v_deliv_at := case
              when (v_map ->> 'triggers_escrow_clock')::boolean then coalesce(v_so.delivered_at, now())
              else v_so.delivered_at
            end;

            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   delivered_at = v_deliv_at,
                   updated_at = now()
             where id = v_so.id;

            -- Review 5: Finance owns the escrow release date on escrow_holds.auto_release_at (no second copy on store_orders)
            if (v_map ->> 'triggers_escrow_clock')::boolean then
              update public.escrow_holds
                 set delivered_at = coalesce(delivered_at, v_deliv_at),
                     auto_release_at = coalesce(auto_release_at, v_deliv_at + make_interval(days => auto_release_days))
               where (id = v_so.escrow_hold_id or (target_type = 'dropship_order' and target_id = v_so.id))
                 and status = 'held';
            end if;
          end if;
        end if;

      elsif ev.event_type = 'sourcing_handoff.received_at_3pl' then
        select * into v_ho from public.dropship_handoffs where id = ev.aggregate_id for update;
        if v_ho.id is not null then
          select * into v_so from public.store_orders where id = v_ho.store_order_id for update;
          if v_ho.store_order_item_id is not null then
            select item_id, qty into v_it from public.store_order_items where id = v_ho.store_order_item_id;
            if v_it.item_id is not null and not exists (
              select 1 from public.warehouse_stock_movements m
               where m.warehouse_id = coalesce(v_ho.warehouse_id, 'SZ-01')
                 and m.item_id = v_it.item_id
                 and m.store_order_id = v_so.id
                 and m.kind = 'reserve'
            ) then
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'inbound', v_it.qty, 'Sourcing inbound for ' || v_so.order_number, coalesce(v_ho.warehouse_id, 'SZ-01'), null
              );
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'reserve', v_it.qty, 'Reserve inbound stock for ' || v_so.order_number, coalesce(v_ho.warehouse_id, 'SZ-01'), v_so.id
              );
            end if;
          end if;

          update public.dropship_handoffs
             set status = 'received_at_3pl',
                 updated_at = now()
           where id = v_ho.id;

          insert into public.dropship_handoffs (
            store_order_id, store_order_item_id, handoff_type, from_division_id, to_division_id, warehouse_id, status
          ) values (
            v_so.id, v_ho.store_order_item_id, 'warehouse_pick_pack', division_id_of('DS'), division_id_of('3PL'), coalesce(v_ho.warehouse_id, 'SZ-01'), 'ready_to_pick'
          )
          on conflict do nothing;

          if not exists (
            select 1 from public.dropship_handoffs h2
             where h2.store_order_id = v_so.id
               and h2.handoff_type = 'sourcing_procurement'
               and h2.status <> 'received_at_3pl'
          ) then
            v_map := public.resolve_dropship_status_mapping('sourcing_po', 'received_at_3pl');
            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   updated_at = now()
             where id = v_so.id;
          end if;
        end if;
      end if;

      insert into public.domain_event_consumptions (event_id, consumer, outcome)
      values (ev.id, 'db_core', 'ok')
      on conflict (event_id, consumer) do nothing;

      update public.domain_events
         set db_status = 'processed',
             processed_at = now(),
             last_error = null
       where id = ev.id;

      v_processed := v_processed + 1;
      perform set_config('request.jwt.claims', v_prev_role, true);
    exception when others then
      perform set_config('request.jwt.claims', v_prev_role, true);
      v_next_attempt := ev.attempts + 1;
      if v_next_attempt >= 5 then
        update public.domain_events
           set db_status = 'dead',
               attempts = v_next_attempt,
               last_error = left(sqlerrm, 1000)
         where id = ev.id;
        perform write_audit(
          'domain_event.dead_letter',
          'domain_events',
          ev.id::text,
          jsonb_build_object('event_type', ev.event_type, 'attempts', v_next_attempt, 'error', left(sqlerrm, 300))
        );
        v_dead := v_dead + 1;
      else
        v_backoff := case v_next_attempt
          when 1 then interval '1 minute'
          when 2 then interval '5 minutes'
          when 3 then interval '30 minutes'
          else interval '2 hours'
        end;
        update public.domain_events
           set db_status = 'retry',
               attempts = v_next_attempt,
               available_at = now() + v_backoff,
               last_error = left(sqlerrm, 1000)
         where id = ev.id;
        v_retried := v_retried + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('processed', v_processed, 'retried', v_retried, 'dead', v_dead);
end $$;

revoke all on function public.process_dropship_domain_events(integer) from public, anon;
grant execute on function public.process_dropship_domain_events(integer) to authenticated, service_role;

-- Schedule pg_cron worker ('octopus-dropship-domain-events' every 10 seconds; pure DB-only no-op when 0 events pending)
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-domain-events') then
      perform cron.unschedule('octopus-dropship-domain-events');
    end if;
    perform cron.schedule(
      'octopus-dropship-domain-events',
      '10 seconds',
      'select public.process_dropship_domain_events(100)'
    );
  end if;
end $$;

-- Trigger on shipments status updates for store_orders -> emit domain_event & run DB-only consumer
create or replace function public.shipments_emit_dropship_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.store_order_id is not null and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform public.emit_dropship_domain_event(
      'shipment.status_changed',
      'shipment',
      new.id,
      'shipment:' || new.id::text || ':status:' || new.status::text || ':' || extract(epoch from clock_timestamp())::text,
      jsonb_build_object(
        'shipment_id', new.id,
        'store_order_id', new.store_order_id,
        'status', new.status::text,
        'tracking_no', new.tracking_no
      ),
      division_id_of('DS'),
      new.status::text in ('label_ready', 'picked_up', 'in_transit', 'delivered')
    );
    perform public.process_dropship_domain_events(25);
  end if;
  return new;
end $$;

drop trigger if exists trg_shipments_emit_dropship_domain_event on public.shipments;
create trigger trg_shipments_emit_dropship_domain_event
  after insert or update of status on public.shipments
  for each row execute function public.shipments_emit_dropship_event();

-- ───────── 7. Core store_orders pipeline RPCs + Escrow Join RPC + Public tracking & Sanitized reporting RPCs ─────────
create or replace function public.create_dropship_store_order(
  p_org_id uuid,
  p_channel text,
  p_external_order_id text,
  p_external_order_name text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address jsonb,
  p_destination_country text,
  p_buyer_currency text,
  p_fx_rate_to_usd numeric,
  p_shipping_method text,
  p_incoterm text,
  p_lines jsonb,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    if not exists (
      select 1 from public.company_services cs
       where cs.org_id = p_org_id and cs.service = 'dropship' and cs.status = 'on'
    ) then
      raise exception 'DROPSHIP_NOT_ENABLED';
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
end $$;

revoke all on function public.create_dropship_store_order(uuid, text, text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, boolean) from public, anon;
grant execute on function public.create_dropship_store_order(uuid, text, text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, boolean) to authenticated, service_role;

-- Review 5: Read escrow release date directly from Finance's escrow_holds row (no duplicate column on store_orders)
create or replace function public.get_store_order_escrow_info(p_store_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and (in_division(division_id_of('DS')) or can('finance', 'view')));
  v_so public.store_orders;
  v_eh public.escrow_holds;
  v_eh_map jsonb;
begin
  select * into v_so from public.store_orders where id = p_store_order_id;
  if v_so.id is null then
    return null;
  end if;
  if not v_is_staff and (v_uid is null or v_so.org_id not in (select my_org_ids())) then
    raise exception 'FORBIDDEN';
  end if;

  select *
    into v_eh
    from public.escrow_holds eh
   where eh.id = v_so.escrow_hold_id
      or (eh.target_type = 'dropship_order' and eh.target_id = v_so.id)
   order by eh.created_at desc
   limit 1;

  if v_eh.id is null then
    return jsonb_build_object(
      'store_order_id', v_so.id,
      'delivered_at', v_so.delivered_at,
      'has_escrow_hold', false,
      'escrow_status', null,
      'auto_release_at', null
    );
  end if;

  v_eh_map := public.resolve_dropship_status_mapping('escrow_hold', v_eh.status);

  return jsonb_build_object(
    'store_order_id', v_so.id,
    'delivered_at', v_so.delivered_at,
    'has_escrow_hold', true,
    'escrow_hold_id', v_eh.id,
    'escrow_status', v_eh.status,
    'merchant_escrow_label', v_eh_map ->> 'merchant_label',
    'auto_release_days', v_eh.auto_release_days,
    'auto_release_at', v_eh.auto_release_at
  );
end $$;

revoke all on function public.get_store_order_escrow_info(uuid) from public, anon;
grant execute on function public.get_store_order_escrow_info(uuid) to authenticated, service_role;

create or replace function public.mark_store_order_paid(
  p_store_order_id uuid,
  p_wallet_hold_id uuid default null,
  p_escrow_hold_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and (dropship_can_edit(division_id_of('DS')) or can('finance', 'edit')));
  v_so public.store_orders;
  v_ev_id uuid;
begin
  select * into v_so from public.store_orders where id = p_store_order_id for update;
  if v_so.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if not v_is_staff and v_so.org_id not in (select my_org_ids()) then
    raise exception 'FORBIDDEN';
  end if;
  if v_so.cancelled_at is not null then
    raise exception 'ORDER_CANCELLED';
  end if;

  update public.store_orders
     set payment_state = case when p_escrow_hold_id is not null or p_wallet_hold_id is not null then 'held' else 'paid' end,
         wallet_hold_id = coalesce(p_wallet_hold_id, wallet_hold_id),
         escrow_hold_id = coalesce(p_escrow_hold_id, escrow_hold_id),
         staff_stage = case when staff_stage = 'unpaid' then 'paid_to_assign' else staff_stage end,
         updated_at = now()
   where id = p_store_order_id;

  v_ev_id := public.emit_dropship_domain_event(
    'store_order.paid',
    'store_order',
    v_so.id,
    'store_order:' || v_so.id::text || ':paid',
    jsonb_build_object('store_order_id', v_so.id, 'order_number', v_so.order_number),
    division_id_of('DS'),
    false
  );

  perform public.process_dropship_domain_events(25);
  select * into v_so from public.store_orders where id = p_store_order_id;

  perform write_audit(
    'dropship.store_order_paid',
    'store_orders',
    v_so.id::text,
    jsonb_build_object(
      'order_number', v_so.order_number,
      'merchant_status', v_so.merchant_status,
      'staff_stage', v_so.staff_stage,
      'hold_reason', v_so.hold_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'store_order_id', v_so.id,
    'event_id', v_ev_id,
    'payment_state', v_so.payment_state,
    'merchant_status', v_so.merchant_status,
    'staff_stage', v_so.staff_stage,
    'hold_reason', v_so.hold_reason
  );
end $$;

revoke all on function public.mark_store_order_paid(uuid, uuid, uuid) from public, anon;
grant execute on function public.mark_store_order_paid(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.cancel_store_order(
  p_store_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and dropship_can_edit(division_id_of('DS')));
  v_so public.store_orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'REASON_REQUIRED';
  end if;
  select * into v_so from public.store_orders where id = p_store_order_id for update;
  if v_so.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if not v_is_staff and v_so.org_id not in (select my_org_ids()) then
    raise exception 'FORBIDDEN';
  end if;
  if v_so.staff_stage in ('handed_over', 'delivered') then
    raise exception 'CANNOT_CANCEL_SHIPPED_ORDER';
  end if;

  update public.store_orders
     set cancel_reason = v_reason,
         cancelled_at = coalesce(cancelled_at, now()),
         updated_at = now()
   where id = p_store_order_id;

  perform public.emit_dropship_domain_event(
    'store_order.cancelled',
    'store_order',
    v_so.id,
    'store_order:' || v_so.id::text || ':cancelled',
    jsonb_build_object('store_order_id', v_so.id, 'reason', v_reason),
    division_id_of('DS'),
    false
  );

  perform public.process_dropship_domain_events(25);
  select * into v_so from public.store_orders where id = p_store_order_id;

  perform write_audit('dropship.store_order_cancelled', 'store_orders', v_so.id::text, jsonb_build_object('reason', v_reason));

  return jsonb_build_object(
    'ok', true,
    'store_order_id', v_so.id,
    'merchant_status', v_so.merchant_status,
    'staff_stage', v_so.staff_stage
  );
end $$;

revoke all on function public.cancel_store_order(uuid, text) from public, anon;
grant execute on function public.cancel_store_order(uuid, text) to authenticated, service_role;

create or replace function public.receive_sourcing_handoff_at_3pl(
  p_handoff_id uuid,
  p_warehouse_id text default 'SZ-01'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ho public.dropship_handoffs;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit() or (is_staff() and in_division(division_id_of('SRC')))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_ho from public.dropship_handoffs where id = p_handoff_id for update;
  if v_ho.id is null or v_ho.handoff_type <> 'sourcing_procurement' then
    raise exception 'NOT_FOUND';
  end if;

  update public.dropship_handoffs
     set warehouse_id = coalesce(nullif(btrim(p_warehouse_id), ''), 'SZ-01'),
         updated_at = now()
   where id = p_handoff_id;

  perform public.emit_dropship_domain_event(
    'sourcing_handoff.received_at_3pl',
    'dropship_handoff',
    v_ho.id,
    'handoff:' || v_ho.id::text || ':received_at_3pl',
    jsonb_build_object('handoff_id', v_ho.id, 'store_order_id', v_ho.store_order_id),
    division_id_of('3PL'),
    false
  );

  perform public.process_dropship_domain_events(25);
  perform write_audit('dropship.handoff_received_at_3pl', 'dropship_handoffs', v_ho.id::text, jsonb_build_object('store_order_id', v_ho.store_order_id));

  return jsonb_build_object('ok', true, 'handoff_id', v_ho.id);
end $$;

revoke all on function public.receive_sourcing_handoff_at_3pl(uuid, text) from public, anon;
grant execute on function public.receive_sourcing_handoff_at_3pl(uuid, text) to authenticated, service_role;

create or replace function public.create_store_order_shipment(
  p_store_order_id uuid,
  p_carrier_code text,
  p_service_code text default null,
  p_tracking_no text default null,
  p_weight_kg numeric default null,
  p_rate_cents bigint default null,
  p_status shipment_status default 'label_ready'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.store_orders;
  v_ship public.shipments;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit() or dropship_can_edit(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_so from public.store_orders where id = p_store_order_id for update;
  if v_so.id is null then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.shipments (
    order_id,
    store_order_id,
    org_id,
    carrier_code,
    service_code,
    tracking_no,
    status,
    weight_kg,
    parcels,
    rate_cents,
    currency,
    division_id,
    is_seed
  ) values (
    null,
    v_so.id,
    v_so.org_id,
    btrim(p_carrier_code),
    nullif(btrim(coalesce(p_service_code, '')), ''),
    nullif(btrim(coalesce(p_tracking_no, '')), ''),
    coalesce(p_status, 'label_ready'::shipment_status),
    coalesce(p_weight_kg, round(coalesce(v_so.billed_weight_g, 500)::numeric / 1000.0, 3)),
    1,
    coalesce(p_rate_cents, v_so.shipping_cents),
    'USD',
    division_id_of('DS'),
    v_so.is_test
  )
  returning * into v_ship;

  perform write_audit(
    'dropship.shipment_created',
    'shipments',
    v_ship.id::text,
    jsonb_build_object('store_order_id', v_so.id, 'shipment_code', v_ship.code, 'status', v_ship.status::text)
  );

  return jsonb_build_object(
    'shipment_id', v_ship.id,
    'code', v_ship.code,
    'tracking_token', v_ship.tracking_token,
    'tracking_no', v_ship.tracking_no,
    'status', v_ship.status::text
  );
end $$;

revoke all on function public.create_store_order_shipment(uuid, text, text, text, numeric, bigint, shipment_status) from public, anon;
grant execute on function public.create_store_order_shipment(uuid, text, text, text, numeric, bigint, shipment_status) to authenticated, service_role;

-- Item 20 & 23: Public white-label tracking RPC for /t/[token]
--  · Serves ONLY shipments with store_order_id IS NOT NULL.
--  · NEVER returns buyer_name, buyer_phone, shipping_address, carrier_code, supplier names, or Octopus branding.
create or replace function public.get_public_dropship_tracking(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tok text := nullif(lower(btrim(coalesce(p_token, ''))), '');
  v_ship public.shipments;
  v_so public.store_orders;
  v_sp public.dropship_seller_profiles;
  v_map jsonb;
  v_events jsonb;
begin
  if v_tok is null or v_tok !~ '^[0-9a-f]{32,64}$' then
    return null;
  end if;

  select *
    into v_ship
    from public.shipments s
   where s.tracking_token = v_tok
     and s.store_order_id is not null
   limit 1;

  if v_ship.id is null then
    return null;
  end if;

  select * into v_so from public.store_orders where id = v_ship.store_order_id;
  if v_so.id is null then
    return null;
  end if;

  select *
    into v_sp
    from public.dropship_seller_profiles
   where org_id = v_so.org_id
     and status = 'approved'
   limit 1;

  v_map := public.resolve_dropship_status_mapping('3pl_shipment', v_ship.status::text);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'status', te.status,
               'description', te.description,
               'location', te.location,
               'occurred_at', te.occurred_at
             ) order by te.occurred_at desc
           ),
           '[]'::jsonb
         )
    into v_events
    from public.tracking_events te
   where te.shipment_id = v_ship.id;

  return jsonb_build_object(
    'order_ref', coalesce(v_so.external_order_name, v_so.order_number),
    'seller_name', coalesce(nullif(btrim(coalesce(v_sp.brand_name, '')), ''), 'Online Store'),
    'destination_country', v_so.destination_country,
    'tracking_no', v_ship.tracking_no,
    'status', coalesce(v_map ->> 'merchant_status', 'shipped'),
    'status_label', coalesce(v_map ->> 'merchant_label', initcap(replace(v_ship.status::text, '_', ' '))),
    'eta', v_ship.eta,
    'last_event_at', coalesce(v_ship.last_event_at, v_ship.created_at),
    'events', v_events
  );
end $$;

revoke all on function public.get_public_dropship_tracking(text) from public;
grant execute on function public.get_public_dropship_tracking(text) to anon, authenticated, service_role;

-- Item 23: Sanitized reporting RPC — NEVER returns buyer_name, buyer_phone, or shipping_address
create or replace function public.get_dropship_orders_report(
  p_org_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  store_order_id uuid,
  order_number text,
  external_order_name text,
  org_id uuid,
  channel text,
  destination_country char(2),
  buyer_currency char(3),
  fx_rate_to_usd numeric(18,8),
  shipping_method text,
  incoterm text,
  product_cents bigint,
  processing_cents bigint,
  shipping_cents bigint,
  duties_cents bigint,
  total_cents bigint,
  payment_state text,
  merchant_status text,
  created_at timestamptz,
  delivered_at timestamptz,
  escrow_auto_release_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and (in_division(division_id_of('DS')) or can('finance', 'view')));
begin
  if not v_is_staff then
    if v_uid is null then
      return;
    end if;
    if p_org_id is not null and p_org_id not in (select my_org_ids()) then
      return;
    end if;
  end if;

  return query
    select so.id as store_order_id,
           so.order_number,
           so.external_order_name,
           so.org_id,
           so.channel,
           so.destination_country,
           so.buyer_currency,
           so.fx_rate_to_usd,
           so.shipping_method,
           so.incoterm,
           so.product_cents,
           so.processing_cents,
           so.shipping_cents,
           so.duties_cents,
           so.total_cents,
           so.payment_state,
           so.merchant_status,
           so.created_at,
           so.delivered_at,
           eh.auto_release_at as escrow_auto_release_at
      from public.store_orders so
      left join public.escrow_holds eh on eh.id = so.escrow_hold_id
     where (v_is_staff or so.org_id in (select my_org_ids()))
       and (p_org_id is null or so.org_id = p_org_id)
       and (p_from is null or so.created_at >= p_from)
       and (p_to is null or so.created_at <= p_to)
     order by so.created_at desc, so.id desc;
end $$;

revoke all on function public.get_dropship_orders_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_dropship_orders_report(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ───────── 8. Item 22: internal_charge_rules seeded INACTIVE (active = false) with NULL rates ─────────
create table if not exists public.internal_charge_rules (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique check (btrim(rule_code) <> ''),
  from_division_id uuid not null references public.divisions(id) on delete restrict,
  to_division_id uuid not null references public.divisions(id) on delete restrict,
  charge_kind text not null check (
    charge_kind in ('pick_pack_handling', 'outbound_freight_passthrough', 'sourcing_goods_transfer', 'return_restocking')
  ),
  rate_bp integer check (rate_bp is null or (rate_bp >= 0 and rate_bp <= 100000)),
  flat_fee_cents bigint check (flat_fee_cents is null or flat_fee_cents >= 0),
  active boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_charge_rules_distinct_divs check (from_division_id <> to_division_id),
  constraint internal_charge_rules_active_requires_rate check (
    not active or rate_bp is not null or flat_fee_cents is not null
  )
);

create index if not exists internal_charge_rules_from_div_idx on public.internal_charge_rules (from_division_id);
create index if not exists internal_charge_rules_to_div_idx on public.internal_charge_rules (to_division_id);
create index if not exists internal_charge_rules_updated_by_idx on public.internal_charge_rules (updated_by);

comment on table public.internal_charge_rules is
  'Internal inter-division settlement rules (DS -> 3PL, DS -> SRC). Seeded inactive (active = false) with NULL rates until Finance configures them.';

alter table public.internal_charge_rules enable row level security;
revoke all on public.internal_charge_rules from public, anon, authenticated;
grant select on public.internal_charge_rules to authenticated;
grant all on public.internal_charge_rules to service_role;

drop policy if exists internal_charge_rules_staff_read on public.internal_charge_rules;
create policy internal_charge_rules_staff_read on public.internal_charge_rules
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (is_admin() or can('finance', 'view'))
  );

insert into public.internal_charge_rules (rule_code, from_division_id, to_division_id, charge_kind, rate_bp, flat_fee_cents, active)
values
  ('DS_TO_3PL_PICK_PACK',        division_id_of('DS'), division_id_of('3PL'), 'pick_pack_handling',           null, null, false),
  ('DS_TO_3PL_OUTBOUND_FREIGHT', division_id_of('DS'), division_id_of('3PL'), 'outbound_freight_passthrough', null, null, false),
  ('DS_TO_SRC_GOODS_TRANSFER',   division_id_of('DS'), division_id_of('SRC'), 'sourcing_goods_transfer',      null, null, false),
  ('DS_TO_3PL_RETURN_RESTOCK',   division_id_of('DS'), division_id_of('3PL'), 'return_restocking',            null, null, false)
on conflict (rule_code) do nothing;
