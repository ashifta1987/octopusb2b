-- Down migration for 20261101000211_i1b_rate_cards_stock_and_fees.sql

-- 1. Drop I1b quote functions & restore dropship_rate_estimate (from 205) and get_dropship_catalogue / get_dropship_product (from 210)
drop function if exists public.get_dropship_quote(uuid, text, text, integer, text);
drop function if exists public.get_dropship_order_quote(jsonb, text, text, text);

create or replace function dropship_rate_estimate(
  p_weight_g integer,
  p_unit_cost_cents bigint,
  p_country text,
  p_method text
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r dropship_rates;
  v_ship bigint;
  v_duty bigint;
  v_fee bigint;
begin
  if auth.uid() is not null and not (is_staff() and dropship_can_see_costs(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;
  select * into r
    from dropship_rates
   where active
     and country = upper(btrim(coalesce(p_country, '')))::char(2)
     and service = lower(btrim(coalesce(p_method, '')))
   limit 1;
  if r.id is null then return null; end if;

  v_ship := r.ship_base_cents + ceil(greatest(1, coalesce(p_weight_g, 250)) / 100.0)::bigint * r.ship_per_100g_cents + r.fee_cents;
  v_duty := round(greatest(0, coalesce(p_unit_cost_cents, 0)) * r.duty_pct / 100.0)::bigint;
  v_fee := r.fee_cents;
  return jsonb_build_object(
    'country', r.country,
    'shipping_method', r.service,
    'est_shipping_cents', v_ship,
    'est_duties_cents', v_duty,
    'fee_cents', v_fee,
    'est_days_min', r.days_min,
    'est_days_max', r.days_max,
    'allows_battery', r.allows_battery,
    'allows_liquid', r.allows_liquid
  );
end $$;
revoke all on function dropship_rate_estimate(integer, bigint, text, text) from public, anon;
grant execute on function dropship_rate_estimate(integer, bigint, text, text) to authenticated, service_role;

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
             p.stock_status,
             p.created_at,
             (
               select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', v.id,
                     'model_no', v.model_no,
                     'options', v.options,
                     'price_adjust_cents', v.price_adjust_cents,
                     'stock_status', v.stock_status
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
           e.stock_status,
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
           'stock_status', p.stock_status,
           'variants', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'id', v.id,
                 'model_no', v.model_no,
                 'options', v.options,
                 'price_adjust_cents', v.price_adjust_cents,
                 'stock_status', v.stock_status
               ) order by v.sort, v.model_no
             )
             from public.dropship_variants v where v.product_id = p.id
           ), '[]'::jsonb),
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

-- 2. Drop stock-by-type helpers, stock freezes, dropship_products I1b columns, and warehouse stock tables
drop function if exists public.get_dropship_variant_stock(uuid, text);

drop trigger if exists trg_freeze_dropship_variant_legacy_stock on public.dropship_variants;
drop function if exists public.freeze_dropship_variant_legacy_stock();

drop trigger if exists trg_freeze_dropship_product_legacy_stock on public.dropship_products;
drop function if exists public.freeze_dropship_product_legacy_stock();

alter table public.dropship_products
  drop column if exists product_price_cents,
  drop column if exists fulfilment_type;

drop function if exists public.record_warehouse_stock_movement(uuid, text, integer, text, text, uuid);

drop trigger if exists trg_immutable_warehouse_stock_movements on public.warehouse_stock_movements;
drop function if exists public.immutable_warehouse_stock_movements();
drop table if exists public.warehouse_stock_movements;

drop trigger if exists trg_block_direct_warehouse_stock_write on public.warehouse_stock;
drop function if exists public.block_direct_warehouse_stock_write();
drop table if exists public.warehouse_stock;

-- 3. Drop supplier stock columns & helper
drop function if exists public.set_supplier_product_stock(uuid, integer);
alter table public.supplier_products
  drop column if exists stock_updated_at,
  drop column if exists stock_qty;

-- 4. Drop duty_rate_entries & duty_rate_versions
drop function if exists public.lookup_duty_rate(text, text);
drop function if exists public.activate_duty_rate_version(uuid);
drop function if exists public.create_duty_rate_version(text, jsonb);

drop trigger if exists trg_guard_duty_rate_entries on public.duty_rate_entries;
drop function if exists public.guard_duty_rate_entries();
drop table if exists public.duty_rate_entries;

drop trigger if exists trg_guard_duty_rate_versions on public.duty_rate_versions;
drop function if exists public.guard_duty_rate_versions();
drop table if exists public.duty_rate_versions;

-- 5. Drop fee_versions & RPCs
drop function if exists public.activate_fee_version(uuid, text);
drop function if exists public.propose_fee_version(bigint, bigint, bigint, bigint, bigint, text);

drop trigger if exists trg_guard_fee_versions on public.fee_versions;
drop function if exists public.guard_fee_versions();
drop table if exists public.fee_versions;

-- 6. Drop shipping_rate_cards, unfreeze dropship_rates, and drop warehouse_can_edit
drop function if exists public.quote_carrier_rates(text, text, integer, integer);
drop function if exists public.deactivate_shipping_rate_card(uuid, text);
drop function if exists public.publish_shipping_rate_card(text, text, text, text, bigint, bigint, integer, integer, integer, numeric, integer, boolean, boolean, boolean, boolean, text);
drop function if exists public.warehouse_can_edit();

drop trigger if exists trg_freeze_dropship_rates on public.dropship_rates;
drop function if exists public.freeze_dropship_rates();

drop trigger if exists trg_guard_shipping_rate_cards on public.shipping_rate_cards;
drop function if exists public.guard_shipping_rate_cards();
drop table if exists public.shipping_rate_cards;

-- 7. Restore item_master policies & guard_item_master() to exact 210 state
drop policy if exists item_master_read on public.item_master;
drop policy if exists item_master_insert on public.item_master;
drop policy if exists item_master_update on public.item_master;
drop policy if exists item_master_write on public.item_master;

create policy item_master_read on public.item_master
  for select to authenticated
  using (
    is_staff()
    or (sourcing_product_id is not null and product_is_my_supplier(sourcing_product_id))
  );

create policy item_master_write on public.item_master
  for all to authenticated
  using (
    can('products', 'edit')
    or dropship_can_edit(division_id_of('DS'))
    or (sourcing_product_id is not null and product_editable(sourcing_product_id))
  )
  with check (
    can('products', 'edit')
    or dropship_can_edit(division_id_of('DS'))
    or (sourcing_product_id is not null and product_editable(sourcing_product_id))
  );

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
  -- Normalise origin_country: nullable, never defaults to 'CN'
  if v_oc ~ '^[A-Z]{2}$' then
    new.origin_country := v_oc::char(2);
  else
    new.origin_country := null;
  end if;

  new.hs_code := nullif(btrim(coalesce(new.hs_code, '')), '');

  -- Never overwrite a sheet-supplied or manually entered code with a rule / AI value
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

  -- Enforce Item 3: hs_verified can ONLY be set via explicit staff verification RPC
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
      -- Changing hs_code outside explicit verification un-verifies the item until staff verifies the new code
      new.hs_verified := false;
      new.hs_verified_by := null;
      new.hs_verified_at := null;
    end if;
    new.updated_at := now();
  end if;

  -- Recompute needs_data whenever physical / origin fields are missing
  new.needs_data := (
    new.origin_country is null
    or new.weight_g is null
    or new.box_l_cm is null
    or new.box_w_cm is null
    or new.box_h_cm is null
  );

  return new;
end $$;
