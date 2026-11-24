-- Down migration for 20261101000214_step3_merchant_catalogue_requests_and_samples.sql

-- Restore 208 generate_dropship_weekly_statement & run_weekly_dropship_statements verbatim
create or replace function generate_dropship_weekly_statement(
  p_org uuid,
  p_from timestamptz default (now() - interval '7 days'),
  p_to timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_div uuid := division_id_of('DS');
  v_items jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_unpaid bigint := 0;
  v_stmt_id uuid;
  v_stmt_no text;
  d record;
begin
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or (is_staff() and can('finance', 'view'))) then
    raise exception 'FORBIDDEN';
  end if;

  for d in
    select id, number, order_id, amount_cents, paid_cents, currency, status, due_at, created_at
      from documents
     where org_id = p_org
       and division_id = v_div
       and doc_type = 'commercial_invoice'
       and coalesce(status, '') not in ('void', 'cancelled')
       and created_at >= p_from
       and created_at <= p_to
     order by created_at asc
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'invoice_id', d.id,
      'number', d.number,
      'order_id', d.order_id,
      'amount_cents', d.amount_cents,
      'paid_cents', d.paid_cents,
      'balance_cents', greatest(0, d.amount_cents - d.paid_cents),
      'currency', d.currency,
      'status', d.status,
      'due_at', d.due_at,
      'issued_at', d.created_at
    ));
    v_total := v_total + coalesce(d.amount_cents, 0);
    v_unpaid := v_unpaid + greatest(0, coalesce(d.amount_cents, 0) - coalesce(d.paid_cents, 0));
  end loop;

  v_stmt_no := 'STMT-DS-' || to_char(p_to at time zone 'UTC', 'YYYYMMDD') || '-' || substr(replace(p_org::text, '-', ''), 1, 6);

  select id into v_stmt_id from documents where org_id = p_org and doc_type = 'statement' and number = v_stmt_no limit 1;
  if v_stmt_id is not null then
    return jsonb_build_object(
      'statement_id', v_stmt_id,
      'number', v_stmt_no,
      'invoice_count', jsonb_array_length(v_items),
      'total_cents', v_total,
      'unpaid_cents', v_unpaid,
      'repeated', true
    );
  end if;

  insert into documents (
    org_id, division_id, doc_type, number, amount_cents, paid_cents, currency, status, data
  )
  values (
    p_org, v_div, 'statement', v_stmt_no, v_total, v_total - v_unpaid, 'USD',
    case when v_unpaid = 0 then 'paid' else 'awaiting_payment' end,
    jsonb_build_object(
      'period_from', p_from,
      'period_to', p_to,
      'invoice_count', jsonb_array_length(v_items),
      'total_cents', v_total,
      'unpaid_cents', v_unpaid,
      'invoices', v_items
    )
  )
  returning id into v_stmt_id;

  return jsonb_build_object(
    'statement_id', v_stmt_id,
    'number', v_stmt_no,
    'invoice_count', jsonb_array_length(v_items),
    'total_cents', v_total,
    'unpaid_cents', v_unpaid
  );
end $$;
revoke all on function generate_dropship_weekly_statement(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function generate_dropship_weekly_statement(uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function run_weekly_dropship_statements() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_div uuid := division_id_of('DS');
  v_from timestamptz := date_trunc('week', now() at time zone 'UTC') - interval '7 days';
  v_to timestamptz := date_trunc('week', now() at time zone 'UTC');
  v_org uuid;
  v_generated int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:run_weekly_dropship_statements')) then
    return jsonb_build_object('skipped', true, 'reason', 'lock_held');
  end if;
  for v_org in
    select distinct org_id
      from documents
     where division_id = v_div
       and doc_type = 'commercial_invoice'
       and payment_option = 'pay_later'
       and coalesce(status, '') not in ('void', 'cancelled')
       and created_at >= v_from
       and created_at <= v_to
  loop
    perform generate_dropship_weekly_statement(v_org, v_from, v_to);
    v_generated := v_generated + 1;
  end loop;
  return jsonb_build_object('statements_generated', v_generated, 'period_from', v_from, 'period_to', v_to);
end $$;
revoke all on function run_weekly_dropship_statements() from public, anon, authenticated;
grant execute on function run_weekly_dropship_statements() to service_role;

drop function if exists public.list_my_dropship_sample_orders(uuid);
drop function if exists public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean);
drop function if exists public.respond_dropship_request_quote(uuid, text);
drop function if exists public.list_my_dropship_requests();
drop function if exists public.set_dropship_request_landed_quote(uuid, bigint, text);
drop function if exists public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text);

-- Restore 213 get_dropship_countries, get_dropship_catalogue, get_dropship_product & get_dropship_order_quote verbatim
create or replace function public.get_dropship_countries()
returns table (
  country text,
  locked_by_staff boolean,
  has_active_routes boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := dropship_merchant_org();
begin
  if v_org is null then
    return;
  end if;
  return query
    select m.country::text,
           m.locked_by_staff,
           exists (
             select 1
               from public.dropship_routes r
               join public.dropship_products p on p.id = r.product_id and p.status = 'active'
              where r.destination_country = m.country
                and r.is_active
                and (p.visible_to_org_id is null or p.visible_to_org_id = v_org)
                and public.dropship_product_supplier_eligible(p)
           ) as has_active_routes
      from public.dropship_markets m
     where m.org_id = v_org
     order by m.country;
end $$;

revoke all on function public.get_dropship_countries() from public, anon;
grant execute on function public.get_dropship_countries() to authenticated, service_role;

drop function if exists public.get_dropship_catalogue(text, text, text, integer);

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
                   'incoterm', r.incoterm,
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
         and (p.visible_to_org_id is null or p.visible_to_org_id = v_org)
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
           'price_tiers', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'min_qty', t.min_qty,
                 'unit_price_cents', t.unit_price_cents
               ) order by t.min_qty asc
             )
             from public.dropship_price_tiers t
            where t.product_id = p.id
           ), '[]'::jsonb),
           'routes', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'destination_country', r.destination_country,
                 'shipping_method', r.shipping_method,
                 'incoterm', r.incoterm,
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
     and (p.visible_to_org_id is null or p.visible_to_org_id = v_org)
     and public.dropship_product_supplier_eligible(p)
     and exists (
       select 1 from public.dropship_routes r
        where r.product_id = p.id and r.destination_country = v_country and r.is_active
     );

  return v_res;
end $$;

revoke all on function public.get_dropship_product(uuid, text) from public, anon;
grant execute on function public.get_dropship_product(uuid, text) to authenticated, service_role;

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

    -- Correction 2: Check dropship_price_tiers first (highest matching min_qty <= v_qty)
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
  'Order-level 4-part quote engine. Enforces visible_to_org_id and dropship_price_tiers volume tiers. Processing fee is charged ONCE per order (first + extra*(total_qty-1) + packaging). Combined parcel billed weight = max(sum(actual weight_g), ceil((sum(box_volume_cm3)/divisor)*1000)) rounded up to 100 g step. DAP returns duties_cents = 0 and duties_label = ''Duties paid by buyer''. Final customs valuation rule is set in Step 6b.';

revoke all on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) to authenticated, service_role;

-- Drop dropship_product_requests
drop policy if exists dropship_product_requests_staff_write on public.dropship_product_requests;
drop policy if exists dropship_product_requests_staff_read on public.dropship_product_requests;
drop table if exists public.dropship_product_requests;

-- Restore sp_write policy & remove dropship_request service
drop policy if exists sp_write on public.service_prices;
create policy sp_write on public.service_prices
  for insert to authenticated
  with check (can('services'::text, 'edit'::text));

delete from public.services where code = 'dropship_request';

-- Remove store_orders.kind
alter table public.store_orders
  drop constraint if exists store_orders_kind_check;

alter table public.store_orders
  drop column if exists kind;
