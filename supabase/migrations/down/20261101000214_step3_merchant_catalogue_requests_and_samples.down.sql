-- Down migration for 20261101000214_step3_merchant_catalogue_requests_and_samples.sql

drop function if exists public.list_my_dropship_sample_orders(uuid);
drop function if exists public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean);
drop function if exists public.respond_dropship_request_quote(uuid, text);
drop function if exists public.list_my_dropship_requests();
drop function if exists public.set_dropship_request_landed_quote(uuid, bigint, text);
drop function if exists public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text);

-- Restore 213 get_dropship_catalogue & get_dropship_product verbatim
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
