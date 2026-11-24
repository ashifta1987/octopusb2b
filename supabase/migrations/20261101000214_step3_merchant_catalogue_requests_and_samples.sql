-- 20261101000214_step3_merchant_catalogue_requests_and_samples.sql
-- Phase 2 · Step 3: Merchant catalogue, product detail, landed cost, free product requests (real RFQ codes),
-- and sample orders (store_orders kind = 'sample' + store_order_items, wallet debit only).
--
-- Rules implemented (Step 3 + Corrections 1–6):
--  1. Real RFQ codes only (rfqs.code, e.g. RFQ-1023 / RFQ-YYYY-NNNNNN). Zero "SR-" strings anywhere.
--  2. Reuses I2 store_orders + store_order_items: adds store_orders.kind ('store' | 'sample', default 'store');
--     no 'customer' value, no new 'channel' value ('manual' is used for samples).
--  3. Dropship product requests are FREE by default via services + service_prices code 'dropship_request' = 0 (USD),
--     editable by Finance (sp_write allows can('finance','edit') on service_code = 'dropship_request').
--     Never charges the Sourcing 'rfq' fee. Merchant request status comes from status_mappings (target = 'request').
--  4. Sample orders (create_dropship_sample_order): 1–3 qty max per product; refuses DDP when duty is unknown
--     ("Duties for this country aren't set yet, choose another country or method"); wallet cash debit ONLY
--     (no Pay later / credit limit, no escrow / payment protection); processing fee applies; declared_usd_cents = sample price paid.
--  5. Catalogue & product detail stock = label only ('in_stock' | 'low' | 'out' | 'extended'), never a stock number.
--  6. Merchant RPCs (get_dropship_catalogue, get_dropship_product, list_my_dropship_requests, list_my_dropship_sample_orders)
--     return strictly allowlisted merchant-safe columns — never supplier name/code/ID, Sourcing SKU, our cost, or margin.
--
-- Down: supabase/migrations/down/20261101000214_step3_merchant_catalogue_requests_and_samples.down.sql

-- ───────── 1. Correction 2: store_orders.kind ('store' | 'sample') ─────────
alter table public.store_orders
  add column if not exists kind text not null default 'store';

alter table public.store_orders
  drop constraint if exists store_orders_kind_check;

alter table public.store_orders
  add constraint store_orders_kind_check check (kind in ('store', 'sample'));

grant select (kind) on public.store_orders to authenticated;

comment on column public.store_orders.kind is 'Order kind: ''store'' for merchant store orders, ''sample'' for merchant sample orders (wallet debit only, 1–3 units).';

-- ───────── 2. Correction 3: Free 'dropship_request' service price (editable by Finance) ─────────
insert into public.services (code, name, description, unit, active, sort)
values (
  'dropship_request',
  'Dropship product request',
  'Source and quote a product for Octopus Dropship',
  'per request',
  true,
  7
)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      unit = excluded.unit,
      active = true;

insert into public.service_prices (service_code, amount_minor, currency, effective_from)
select 'dropship_request', 0, 'USD', '2026-01-01T00:00:00Z'::timestamptz
where not exists (
  select 1 from public.service_prices where service_code = 'dropship_request' and currency = 'USD'
);

drop policy if exists sp_write on public.service_prices;
create policy sp_write on public.service_prices
  for insert to authenticated
  with check (
    can('services'::text, 'edit'::text)
    or (service_code = 'dropship_request' and is_staff() and can('finance'::text, 'edit'::text))
  );

-- ───────── 3. Dropship product requests companion metadata on public.rfqs ─────────
create table if not exists public.dropship_product_requests (
  rfq_id uuid primary key references public.rfqs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_link text,
  category_label text,
  monthly_volume_band text,
  ship_to_countries text[] not null default '{}'::text[],
  wants_brand boolean not null default false,
  images text[] not null default '{}'::text[],
  quoted_landed_cents bigint check (quoted_landed_cents is null or quoted_landed_cents >= 0),
  quoted_country char(2) check (quoted_country is null or quoted_country ~ '^[A-Z]{2}$'),
  created_dropship_product_id uuid references public.dropship_products(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dropship_product_requests_org_idx
  on public.dropship_product_requests (org_id, created_at desc);

comment on table public.dropship_product_requests is 'Dropship-specific request metadata linked 1:1 to public.rfqs (real RFQ code). Merchants read via list_my_dropship_requests.';

alter table public.dropship_product_requests enable row level security;
revoke all on public.dropship_product_requests from public, anon, authenticated;
grant select, insert, update on public.dropship_product_requests to authenticated;
grant all on public.dropship_product_requests to service_role;

drop policy if exists dropship_product_requests_staff_read on public.dropship_product_requests;
create policy dropship_product_requests_staff_read on public.dropship_product_requests
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (in_division(division_id_of('DS')) or in_division(division_id_of('SRC')))
  );

drop policy if exists dropship_product_requests_staff_write on public.dropship_product_requests;
create policy dropship_product_requests_staff_write on public.dropship_product_requests
  for all to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (dropship_can_edit(division_id_of('DS')) or in_division(division_id_of('SRC')))
  )
  with check (
    is_staff()
    and not distributor_restricted()
    and (dropship_can_edit(division_id_of('DS')) or in_division(division_id_of('SRC')))
  );

-- ───────── 4. Merchant Catalogue & Product Detail RPCs (4-part split, stock labels only, real RFQ code) ─────────
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
  fulfilment_type text,
  only_for_you boolean,
  only_for_you_count bigint,
  sourced_rfq_code text,
  has_battery boolean,
  restricted_flags jsonb,
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
  v_only_cnt bigint := 0;
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

  select count(*)
    into v_only_cnt
    from public.dropship_products p
   where p.status = 'active'
     and p.visible_to_org_id = v_org
     and public.dropship_product_supplier_eligible(p)
     and exists (
       select 1 from public.dropship_routes r
        where r.product_id = p.id
          and r.destination_country = v_country
          and r.is_active
     );

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
             p.fulfilment_type,
             (p.visible_to_org_id = v_org) as is_only_for_you,
             (select rf.code from public.rfqs rf where rf.id = p.sourced_from_rfq_id) as rfq_code,
             p.created_at,
             pv.id as primary_variant_id,
             coalesce(im.has_battery, false) as im_battery,
             jsonb_build_object(
               'battery', coalesce(im.has_battery, false),
               'liquid', coalesce(im.has_liquid, false),
               'magnet', coalesce(im.has_magnet, false),
               'powder', coalesce(im.has_powder, false),
               'fragile', coalesce(im.is_fragile, false)
             ) as im_flags,
             (
               select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', v.id,
                     'model_no', v.model_no,
                     'options', v.options,
                     'price_adjust_cents', v.price_adjust_cents,
                     'stock_status', (
                       select case
                         when p.fulfilment_type = 'extended_catalog'
                              and not coalesce((st ->> 'stock_tracked')::boolean, false)
                         then 'extended'
                         else coalesce(st ->> 'stock_status', 'in_stock')
                       end
                       from (select public.get_dropship_variant_stock(v.id) as st) s
                     )
                   ) order by v.sort, v.model_no
                 ),
                 '[]'::jsonb
               )
               from public.dropship_variants v
              where v.product_id = p.id
             ) as variants_json,
             (
               select jsonb_agg(
                 (
                   select jsonb_build_object(
                     'destination_country', r.destination_country,
                     'shipping_method', r.shipping_method,
                     'incoterm', r.incoterm,
                     'product_cents', (qt ->> 'product_cents')::bigint,
                     'processing_cents', (qt ->> 'processing_cents')::bigint,
                     'shipping_cents', (qt ->> 'shipping_cents')::bigint,
                     'duties_cents', (qt ->> 'duties_cents')::bigint,
                     'duties_status', coalesce(qt ->> 'duties_status', 'estimate'),
                     'duties_label', qt ->> 'duties_label',
                     'landed_price_cents', coalesce((qt ->> 'total_cents')::bigint, r.landed_price_cents),
                     'billed_weight_g', (qt ->> 'billed_weight_g')::int,
                     'est_days_min', coalesce((qt ->> 'days_min')::int, r.est_days_min),
                     'est_days_max', coalesce((qt ->> 'days_max')::int, r.est_days_max)
                   )
                   from (
                     select case
                       when pv.id is not null
                       then public.get_dropship_quote(pv.id, r.destination_country, r.shipping_method, 1, r.incoterm)
                       else '{}'::jsonb
                     end as qt
                   ) q
                 ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
               )
               from public.dropship_routes r
              where r.product_id = p.id
                and r.destination_country = v_country
                and r.is_active
             ) as routes_json
        from public.dropship_products p
        left join lateral (
          select v.id, v.item_id
            from public.dropship_variants v
           where v.product_id = p.id
           order by v.sort asc, v.model_no asc
           limit 1
        ) pv on true
        left join public.item_master im on im.id = pv.item_id
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
           e.fulfilment_type,
           e.is_only_for_you as only_for_you,
           v_only_cnt as only_for_you_count,
           e.rfq_code as sourced_rfq_code,
           e.im_battery as has_battery,
           e.im_flags as restricted_flags,
           case
             when exists (select 1 from jsonb_array_elements(e.variants_json) x where x ->> 'stock_status' = 'in_stock') then 'in_stock'
             when exists (select 1 from jsonb_array_elements(e.variants_json) x where x ->> 'stock_status' = 'extended') then 'extended'
             when exists (select 1 from jsonb_array_elements(e.variants_json) x where x ->> 'stock_status' = 'low') then 'low'
             else 'out'
           end as stock_status,
           e.variants_json as variants,
           e.routes_json as routes,
           count(*) over() as total_count
      from eligible e
     order by e.is_only_for_you desc, e.created_at desc, e.id
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
  v_prod public.dropship_products;
  v_primary_var public.dropship_variants;
  v_im public.item_master;
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

  select *
    into v_prod
    from public.dropship_products p
   where p.id = p_product_id
     and p.status = 'active'
     and (p.visible_to_org_id is null or p.visible_to_org_id = v_org)
     and public.dropship_product_supplier_eligible(p)
     and exists (
       select 1 from public.dropship_routes r
        where r.product_id = p.id and r.destination_country = v_country and r.is_active
     );

  if v_prod.id is null then
    return null;
  end if;

  select *
    into v_primary_var
    from public.dropship_variants v
   where v.product_id = p_product_id
   order by v.sort asc, v.model_no asc
   limit 1;

  if v_primary_var.item_id is not null then
    select * into v_im from public.item_master where id = v_primary_var.item_id;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', v.id,
               'model_no', v.model_no,
               'options', v.options,
               'price_adjust_cents', v.price_adjust_cents,
               'stock_status', (
                 select case
                   when v_prod.fulfilment_type = 'extended_catalog'
                        and not coalesce((st ->> 'stock_tracked')::boolean, false)
                   then 'extended'
                   else coalesce(st ->> 'stock_status', 'in_stock')
                 end
                 from (select public.get_dropship_variant_stock(v.id) as st) s
               )
             ) order by v.sort, v.model_no
           ),
           '[]'::jsonb
         )
    into v_vars
    from public.dropship_variants v
   where v.product_id = p_product_id;

  v_prod_stock := case
    when exists (select 1 from jsonb_array_elements(v_vars) x where x ->> 'stock_status' = 'in_stock') then 'in_stock'
    when exists (select 1 from jsonb_array_elements(v_vars) x where x ->> 'stock_status' = 'extended') then 'extended'
    when exists (select 1 from jsonb_array_elements(v_vars) x where x ->> 'stock_status' = 'low') then 'low'
    else 'out'
  end;

  v_res := jsonb_build_object(
    'product_id', v_prod.id,
    'model_no', v_prod.model_no,
    'title', v_prod.title,
    'description', v_prod.description,
    'category', v_prod.category,
    'images', to_jsonb(v_prod.images),
    'specs', v_prod.specs,
    'weight_g', coalesce(v_im.weight_g, v_prod.weight_g),
    'dimensions_cm', case
      when v_im.box_l_cm is not null and v_im.box_w_cm is not null and v_im.box_h_cm is not null
      then jsonb_build_object('l', v_im.box_l_cm, 'w', v_im.box_w_cm, 'h', v_im.box_h_cm)
      else v_prod.dimensions_cm
    end,
    'min_order_qty', v_prod.min_order_qty,
    'fulfilment_type', v_prod.fulfilment_type,
    'only_for_you', (v_prod.visible_to_org_id = v_org),
    'sourced_rfq_code', (select rf.code from public.rfqs rf where rf.id = v_prod.sourced_from_rfq_id),
    'stock_status', v_prod_stock,
    'shipping_customs', jsonb_build_object(
      'weight_g', coalesce(v_im.weight_g, v_prod.weight_g),
      'box_l_cm', v_im.box_l_cm,
      'box_w_cm', v_im.box_w_cm,
      'box_h_cm', v_im.box_h_cm,
      'billed_weight_g', case when v_im.id is not null then public.calc_billed_weight_g(v_im.id) else null end,
      'hs_code', v_im.hs_code,
      'hs_verified', coalesce(v_im.hs_verified, false),
      'origin_country', coalesce(btrim(v_im.origin_country::text), btrim(v_prod.origin_country::text)),
      'has_battery', coalesce(v_im.has_battery, false),
      'has_liquid', coalesce(v_im.has_liquid, false),
      'has_magnet', coalesce(v_im.has_magnet, false),
      'has_powder', coalesce(v_im.has_powder, false),
      'is_fragile', coalesce(v_im.is_fragile, false)
    ),
    'variants', v_vars,
    'price_tiers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'min_qty', t.min_qty,
          'unit_price_cents', t.unit_price_cents
        ) order by t.min_qty asc
      )
      from public.dropship_price_tiers t
     where t.product_id = v_prod.id
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(
        (
          select jsonb_build_object(
            'destination_country', r.destination_country,
            'shipping_method', r.shipping_method,
            'incoterm', r.incoterm,
            'product_cents', (qt ->> 'product_cents')::bigint,
            'processing_cents', (qt ->> 'processing_cents')::bigint,
            'shipping_cents', (qt ->> 'shipping_cents')::bigint,
            'duties_cents', (qt ->> 'duties_cents')::bigint,
            'duties_status', coalesce(qt ->> 'duties_status', 'estimate'),
            'duties_label', qt ->> 'duties_label',
            'landed_price_cents', coalesce((qt ->> 'total_cents')::bigint, r.landed_price_cents),
            'billed_weight_g', (qt ->> 'billed_weight_g')::int,
            'est_days_min', coalesce((qt ->> 'days_min')::int, r.est_days_min),
            'est_days_max', coalesce((qt ->> 'days_max')::int, r.est_days_max)
          )
          from (
            select case
              when v_primary_var.id is not null
              then public.get_dropship_quote(v_primary_var.id, r.destination_country, r.shipping_method, 1, r.incoterm)
              else '{}'::jsonb
            end as qt
          ) q
        ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
      )
      from public.dropship_routes r
     where r.product_id = v_prod.id and r.destination_country = v_country and r.is_active
    ), '[]'::jsonb),
    'all_country_routes', coalesce((
      select jsonb_agg(
        (
          select jsonb_build_object(
            'destination_country', r.destination_country,
            'shipping_method', r.shipping_method,
            'incoterm', r.incoterm,
            'product_cents', (qt ->> 'product_cents')::bigint,
            'processing_cents', (qt ->> 'processing_cents')::bigint,
            'shipping_cents', (qt ->> 'shipping_cents')::bigint,
            'duties_cents', (qt ->> 'duties_cents')::bigint,
            'duties_status', coalesce(qt ->> 'duties_status', 'estimate'),
            'duties_label', qt ->> 'duties_label',
            'landed_price_cents', (qt ->> 'total_cents')::bigint,
            'billed_weight_g', (qt ->> 'billed_weight_g')::int,
            'est_days_min', coalesce((qt ->> 'days_min')::int, r.est_days_min),
            'est_days_max', coalesce((qt ->> 'days_max')::int, r.est_days_max)
          )
          from (
            select case
              when v_primary_var.id is not null
              then public.get_dropship_quote(v_primary_var.id, r.destination_country, r.shipping_method, 1, r.incoterm)
              else '{}'::jsonb
            end as qt
          ) q
        ) order by (r.destination_country = v_country) desc, r.destination_country, r.est_days_min, r.shipping_method
      )
      from public.dropship_routes r
      join public.dropship_markets m on m.org_id = v_org and m.country = r.destination_country
     where r.product_id = v_prod.id and r.is_active
    ), '[]'::jsonb)
  );

  return v_res;
end $$;

revoke all on function public.get_dropship_product(uuid, text) from public, anon;
grant execute on function public.get_dropship_product(uuid, text) to authenticated, service_role;

-- ───────── 5. Dropship Product Request RPCs (Corrections 1 & 3) ─────────
create or replace function public.create_dropship_product_request(
  p_title text,
  p_product_link text default null,
  p_category text default null,
  p_target_landed_cents bigint default null,
  p_monthly_volume_band text default null,
  p_ship_to_countries text[] default '{}'::text[],
  p_wants_brand boolean default false,
  p_notes text default null,
  p_images text[] default '{}'::text[],
  p_idem text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_title text := btrim(coalesce(p_title, ''));
  v_link text := nullif(btrim(coalesce(p_product_link, '')), '');
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_band text := nullif(btrim(coalesce(p_monthly_volume_band, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_countries text[];
  v_main_country text;
  v_qty integer;
  v_fee bigint;
  v_details text;
  v_rfq public.rfqs;
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  if length(v_title) < 2 or length(v_title) > 160 then
    raise exception 'INVALID_TITLE: Enter a product name between 2 and 160 characters.';
  end if;

  if v_link is not null and v_link !~* '^https?://' then
    raise exception 'INVALID_LINK: Product link must start with https:// or http://';
  end if;

  select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}'::text[])
    into v_countries
    from unnest(coalesce(p_ship_to_countries, '{}'::text[])) c
   where upper(btrim(c)) ~ '^[A-Z]{2}$';

  if coalesce(array_length(v_countries, 1), 0) = 0 then
    raise exception 'COUNTRY_REQUIRED: Choose at least one destination country.';
  end if;
  v_main_country := v_countries[1];

  v_qty := case v_band
    when 'Under 50' then 25
    when '50 to 200' then 100
    when '200 to 1,000' then 500
    when 'More than 1,000' then 1000
    else 50
  end;

  -- Correction 3: Use service_prices code 'dropship_request' (defaults to 0 USD), NEVER Sourcing 'rfq' fee!
  v_fee := greatest(0, coalesce(public.current_service_price('dropship_request', 'USD'), 0));

  v_details := array_to_string(
    array_remove(array[
      '[Dropship product request]',
      case when v_cat is not null then 'Category: ' || v_cat end,
      case when v_link is not null then 'Reference link: ' || v_link end,
      case when v_band is not null then 'Expected orders/month: ' || v_band end,
      'Ship to: ' || array_to_string(v_countries, ', '),
      case when coalesce(p_wants_brand, false) then 'Branding requested: Make My Brand (logo & packaging)' end,
      v_notes
    ], null),
    E'\n'
  );

  insert into public.rfqs (
    org_id,
    title,
    details,
    quantity,
    unit,
    destination_country,
    target_price_cents,
    incoterm,
    status,
    fee_minor,
    currency,
    expires_at,
    created_by,
    division_id
  ) values (
    v_org,
    v_title,
    v_details,
    v_qty,
    'pcs',
    v_main_country,
    case when p_target_landed_cents is not null and p_target_landed_cents >= 0 then p_target_landed_cents else null end,
    'DDP',
    'submitted',
    v_fee,
    'USD',
    now() + interval '14 days',
    v_uid,
    division_id_of('SRC')
  )
  returning * into v_rfq;

  insert into public.dropship_product_requests (
    rfq_id,
    org_id,
    product_link,
    category_label,
    monthly_volume_band,
    ship_to_countries,
    wants_brand,
    images
  ) values (
    v_rfq.id,
    v_org,
    v_link,
    v_cat,
    v_band,
    v_countries,
    coalesce(p_wants_brand, false),
    coalesce(p_images, '{}'::text[])
  );

  if v_fee > 0 and setting_bool('wallet_enabled') then
    perform public.wallet_charge(
      v_org,
      v_fee,
      'Dropship product request fee',
      'dropship_request_fees',
      coalesce(nullif(btrim(coalesce(p_idem, '')), ''), 'ds_req:' || v_rfq.id::text),
      'rfq',
      v_rfq.id,
      'USD'
    );
  end if;

  perform public.log_status('rfq', v_rfq.id, null, 'submitted', 'dropship');
  perform public.emit_event('rfq.submitted', 'rfq', v_rfq.id, jsonb_build_object('org_id', v_org, 'source', 'dropship', 'code', v_rfq.code));

  return jsonb_build_object(
    'ok', true,
    'rfq_id', v_rfq.id,
    'rfq_code', v_rfq.code,
    'fee_cents', v_fee
  );
end $$;

revoke all on function public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text) from public, anon;
grant execute on function public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text) to authenticated, service_role;

create or replace function public.set_dropship_request_landed_quote(
  p_rfq_id uuid,
  p_landed_cents bigint,
  p_country text default 'AE'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rfq public.rfqs;
  v_country char(2) := upper(btrim(coalesce(p_country, 'AE')))::char(2);
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (is_staff() and not distributor_restricted() and (dropship_can_edit(division_id_of('DS')) or in_division(division_id_of('SRC')))) then
    raise exception 'FORBIDDEN';
  end if;

  if p_landed_cents is null or p_landed_cents < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if v_rfq.id is null then
    raise exception 'NOT_FOUND';
  end if;

  update public.dropship_product_requests
     set quoted_landed_cents = p_landed_cents,
         quoted_country = v_country,
         updated_at = now()
   where rfq_id = p_rfq_id;

  update public.rfqs
     set status = 'quoted',
         updated_at = now()
   where id = p_rfq_id;

  perform write_audit(
    'dropship.request_quoted',
    'rfq',
    p_rfq_id::text,
    jsonb_build_object('rfq_code', v_rfq.code, 'quoted_landed_cents', p_landed_cents, 'country', v_country)
  );

  return jsonb_build_object('ok', true, 'rfq_id', p_rfq_id, 'rfq_code', v_rfq.code, 'status', 'quoted');
end $$;

revoke all on function public.set_dropship_request_landed_quote(uuid, bigint, text) from public, anon;
grant execute on function public.set_dropship_request_landed_quote(uuid, bigint, text) to authenticated, service_role;

create or replace function public.list_my_dropship_requests()
returns table (
  rfq_id uuid,
  rfq_code text,
  title text,
  category_label text,
  monthly_volume_band text,
  ship_to_countries text[],
  target_landed_cents bigint,
  wants_brand boolean,
  fee_cents bigint,
  merchant_status text,
  merchant_label text,
  quoted_landed_cents bigint,
  quoted_country text,
  dropship_product_id uuid,
  dropship_model_no text,
  dropship_product_status text,
  created_at timestamptz
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
    select r.id as rfq_id,
           r.code as rfq_code,
           r.title,
           dpr.category_label,
           dpr.monthly_volume_band,
           dpr.ship_to_countries,
           r.target_price_cents as target_landed_cents,
           dpr.wants_brand,
           r.fee_minor as fee_cents,
           coalesce(sm.merchant_status, r.status::text) as merchant_status,
           coalesce(sm.merchant_label, initcap(r.status::text)) as merchant_label,
           dpr.quoted_landed_cents,
           dpr.quoted_country::text,
           dp.id as dropship_product_id,
           dp.model_no as dropship_model_no,
           dp.status as dropship_product_status,
           r.created_at
      from public.dropship_product_requests dpr
      join public.rfqs r on r.id = dpr.rfq_id
      left join public.status_mappings sm
        on sm.source_domain = 'sourcing_rfq'
       and sm.source_status = r.status::text
       and sm.target = 'request'
      left join lateral (
        select p.id, p.model_no, p.status
          from public.dropship_products p
         where (p.id = dpr.created_dropship_product_id or p.sourced_from_rfq_id = r.id)
           and p.visible_to_org_id = v_org
         order by (p.status = 'active') desc, p.created_at desc
         limit 1
      ) dp on true
     where dpr.org_id = v_org
     order by r.created_at desc, r.id desc;
end $$;

revoke all on function public.list_my_dropship_requests() from public, anon;
grant execute on function public.list_my_dropship_requests() to authenticated, service_role;

create or replace function public.respond_dropship_request_quote(
  p_rfq_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_act text := lower(btrim(coalesce(p_action, '')));
  v_rfq public.rfqs;
  v_dpr public.dropship_product_requests;
  v_dp public.dropship_products;
  v_saved_claims text;
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;
  if v_act not in ('accept', 'decline') then
    raise exception 'INVALID_ACTION';
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id and org_id = v_org for update;
  if v_rfq.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_dpr from public.dropship_product_requests where rfq_id = p_rfq_id and org_id = v_org for update;
  if v_dpr.rfq_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_rfq.status <> 'quoted'::rfq_status then
    raise exception 'INVALID_STATE: Only quoted requests can be accepted or declined.';
  end if;

  if v_act = 'decline' then
    update public.rfqs set status = 'cancelled'::rfq_status, updated_at = now() where id = p_rfq_id;
    perform public.log_status('rfq', p_rfq_id, 'quoted', 'cancelled', 'dropship_merchant');
    return jsonb_build_object('ok', true, 'rfq_id', p_rfq_id, 'rfq_code', v_rfq.code, 'action', 'declined');
  end if;

  update public.rfqs set status = 'accepted'::rfq_status, updated_at = now() where id = p_rfq_id;
  perform public.log_status('rfq', p_rfq_id, 'quoted', 'accepted', 'dropship_merchant');

  -- Create private dropship draft (visible_to_org_id = v_org, sourced_from_rfq_id = v_rfq.id) for DS staff to complete
  select *
    into v_dp
    from public.dropship_products p
   where (p.id = v_dpr.created_dropship_product_id or p.sourced_from_rfq_id = v_rfq.id)
     and p.visible_to_org_id = v_org
   limit 1;

  if v_dp.id is null then
    v_saved_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims', '', true);
    begin
      insert into public.dropship_products (
        octopus_sku,
        title,
        description,
        category,
        images,
        source_type,
        fulfilment_type,
        visible_to_org_id,
        sourced_from_rfq_id,
        status,
        created_by
      ) values (
        'DS-REQ-' || replace(gen_random_uuid()::text, '-', ''),
        v_rfq.title,
        null,
        v_dpr.category_label,
        coalesce(v_dpr.images, '{}'::text[]),
        'partner_supplier',
        'extended_catalog',
        v_org,
        v_rfq.id,
        'draft',
        v_uid
      )
      returning * into v_dp;

      insert into public.dropship_variants (product_id, options, sort)
      values (v_dp.id, '{}'::jsonb, 0);
    exception when others then
      perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
      raise;
    end;
    perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);

    update public.dropship_product_requests
       set created_dropship_product_id = v_dp.id,
           updated_at = now()
     where rfq_id = p_rfq_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rfq_id', p_rfq_id,
    'rfq_code', v_rfq.code,
    'action', 'accepted',
    'dropship_product_id', v_dp.id,
    'dropship_model_no', v_dp.model_no
  );
end $$;

revoke all on function public.respond_dropship_request_quote(uuid, text) from public, anon;
grant execute on function public.respond_dropship_request_quote(uuid, text) to authenticated, service_role;

-- ───────── 6. Sample Order RPCs (Corrections 2 & 4) ─────────
create or replace function public.create_dropship_sample_order(
  p_variant_id uuid,
  p_qty integer,
  p_destination_country text,
  p_shipping_method text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address jsonb,
  p_idempotency_key text,
  p_incoterm text default null,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_destination_country, '')))::char(2);
  v_method text := lower(btrim(coalesce(p_shipping_method, '')));
  v_idem text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_route public.dropship_routes;
  v_incoterm text;
  v_existing public.store_orders;
  v_lines jsonb;
  v_quote jsonb;
  v_total_cents bigint;
  v_cash_balance bigint;
  v_held_cents bigint;
  v_spendable_cash bigint;
  v_unit_prod bigint;
  v_var_label text;
  v_order_id uuid;
  v_order_no text;
  v_journal_id uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  if p_qty is null or p_qty < 1 or p_qty > 3 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_SAMPLE_QTY',
      'message', 'Sample quantity must be between 1 and 3 per product.'
    );
  end if;

  if btrim(coalesce(p_buyer_name, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'BUYER_NAME_REQUIRED', 'message', 'Enter the recipient full name.');
  end if;

  if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'ADDRESS_REQUIRED', 'message', 'Enter a shipping address.');
  end if;

  if v_idem is null then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'Missing idempotency key.');
  end if;

  -- Lock wallet advisory lock first to prevent concurrent double-spend
  perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || v_org::text, 'USD')));

  select *
    into v_existing
    from public.store_orders
   where org_id = v_org
     and kind = 'sample'
     and channel = 'manual'
     and external_order_id = v_idem
   limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'store_order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'kind', v_existing.kind,
      'merchant_status', v_existing.merchant_status,
      'payment_state', v_existing.payment_state,
      'total_cents', v_existing.total_cents
    );
  end if;

  select * into v_var from public.dropship_variants where id = p_variant_id;
  if v_var.id is null then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'Selected variant not found.');
  end if;

  select * into v_prod from public.dropship_products where id = v_var.product_id;
  if v_prod.id is null
     or v_prod.status <> 'active'
     or (v_prod.visible_to_org_id is not null and v_prod.visible_to_org_id <> v_org)
     or not public.dropship_product_supplier_eligible(v_prod) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_AVAILABLE', 'message', 'This product is not available.');
  end if;

  select *
    into v_route
    from public.dropship_routes r
   where r.product_id = v_prod.id
     and r.destination_country = v_country
     and r.shipping_method = v_method
     and r.is_active
   limit 1;

  if v_route.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_ROUTE', 'message', 'No active shipping route for this country and method.');
  end if;

  v_incoterm := upper(btrim(coalesce(nullif(btrim(coalesce(p_incoterm, '')), ''), v_route.incoterm, 'DDP')));

  -- Declared value = sample product price paid (no buyer_unit_price_cents override)
  v_lines := jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'qty', p_qty));
  v_quote := public.get_dropship_order_quote(
    v_lines,
    v_country,
    v_method,
    v_incoterm,
    'USD',
    null,
    'order'
  );

  if not coalesce((v_quote ->> 'ok')::boolean, false) then
    return v_quote;
  end if;

  -- Correction 4: Refuse DDP when duty is unknown; NEVER charge with duty missing!
  if v_incoterm = 'DDP' and (
    coalesce(v_quote ->> 'duties_status', '') = 'not_known_yet'
    or v_quote -> 'duties_cents' is null
    or v_quote -> 'duties_cents' = 'null'::jsonb
    or v_quote -> 'total_cents' is null
    or v_quote -> 'total_cents' = 'null'::jsonb
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'DUTIES_NOT_SET',
      'message', 'Duties for this country aren''t set yet, choose another country or method'
    );
  end if;

  v_total_cents := (v_quote ->> 'total_cents')::bigint;

  -- Correction 4: Pure wallet cash balance ONLY (wallet_balance excludes credit_limit and already reflects open holds; NO Pay later, NO escrow)
  v_cash_balance := public.wallet_balance(v_org, 'USD');
  v_held_cents := 0;
  v_spendable_cash := v_cash_balance;

  if v_spendable_cash < v_total_cents then
    return jsonb_build_object(
      'ok', false,
      'code', 'WALLET_INSUFFICIENT',
      'wallet_balance_cents', greatest(0, v_spendable_cash),
      'required_cents', v_total_cents,
      'shortfall_cents', v_total_cents - greatest(0, v_spendable_cash),
      'message', 'Not enough in your wallet'
    );
  end if;

  insert into public.store_orders (
    org_id,
    kind,
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
    v_org,
    'sample',
    'manual',
    v_idem,
    'SAMPLE · ' || v_prod.model_no,
    btrim(p_buyer_name),
    nullif(btrim(coalesce(p_buyer_phone, '')), ''),
    p_shipping_address,
    v_country,
    'USD',
    null,
    v_method,
    v_incoterm,
    (v_quote ->> 'billed_weight_g')::int,
    (v_quote ->> 'product_cents')::bigint,
    (v_quote ->> 'processing_cents')::bigint,
    (v_quote ->> 'shipping_cents')::bigint,
    (v_quote ->> 'duties_cents')::bigint,
    v_total_cents,
    (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid,
    (v_quote -> 'version_ids' ->> 'fee_version_id')::uuid,
    (v_quote -> 'version_ids' ->> 'duty_rate_version_id')::uuid,
    'paid',
    'processing',
    'paid_to_assign',
    coalesce(p_is_test, false),
    v_uid
  )
  returning id, order_number into v_order_id, v_order_no;

  if (v_quote -> 'version_ids' ->> 'shipping_rate_card_id') is not null then
    update public.shipping_rate_cards
       set used_count = used_count + 1
     where id = (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid;
  end if;

  v_unit_prod := ((v_quote ->> 'product_cents')::bigint / p_qty::bigint);
  select string_agg(value, ' / ')
    into v_var_label
    from jsonb_each_text(coalesce(v_var.options, '{}'::jsonb));

  -- Declared value = sample product price paid (line_product_cents)
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
    v_var_label,
    v_prod.fulfilment_type,
    p_qty,
    v_unit_prod,
    (v_quote ->> 'product_cents')::bigint,
    v_unit_prod,
    (v_quote ->> 'product_cents')::bigint
  );

  -- Direct wallet debit (double-entry balanced journal under division DS; zero escrow hold, zero credit)
  if v_total_cents > 0 then
    v_journal_id := public.post_journal(
      'Dropship sample order ' || v_order_no,
      jsonb_build_array(
        jsonb_build_object('account', public.wallet_account(v_org, 'USD'), 'debit', v_total_cents, 'credit', 0, 'org', v_org),
        jsonb_build_object('account', public.revenue_account('dropship_samples', 'USD'), 'debit', 0, 'credit', v_total_cents)
      ),
      'dropship_sample:' || v_order_id::text,
      'dropship',
      'store_order',
      v_order_id
    );
  end if;

  -- Enqueue & process paid order outbox (reserves 3PL stock / creates Sourcing handoff)
  perform public.emit_dropship_domain_event(
    'store_order.paid',
    'store_order',
    v_order_id,
    'store_order:' || v_order_id::text || ':paid',
    jsonb_build_object('store_order_id', v_order_id, 'order_number', v_order_no, 'kind', 'sample'),
    division_id_of('DS'),
    false
  );
  perform public.process_dropship_domain_events(25);

  select * into v_existing from public.store_orders where id = v_order_id;

  perform write_audit(
    'dropship.sample_order_paid',
    'store_orders',
    v_order_id::text,
    jsonb_build_object(
      'order_number', v_order_no,
      'kind', 'sample',
      'total_cents', v_total_cents,
      'journal_id', v_journal_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'store_order_id', v_order_id,
    'order_number', v_order_no,
    'kind', 'sample',
    'payment_state', v_existing.payment_state,
    'merchant_status', v_existing.merchant_status,
    'total_cents', v_total_cents,
    'quote', v_quote
  );
end $$;

revoke all on function public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean) from public, anon;
grant execute on function public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean) to authenticated, service_role;

create or replace function public.list_my_dropship_sample_orders(
  p_product_id uuid default null
)
returns table (
  store_order_id uuid,
  order_number text,
  product_id uuid,
  variant_id uuid,
  model_no text,
  title_snapshot text,
  variant_label text,
  qty integer,
  destination_country text,
  shipping_method text,
  incoterm text,
  product_cents bigint,
  processing_cents bigint,
  shipping_cents bigint,
  duties_cents bigint,
  total_cents bigint,
  merchant_status text,
  tracking_no text,
  created_at timestamptz,
  delivered_at timestamptz
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
    select so.id as store_order_id,
           so.order_number,
           soi.product_id,
           soi.variant_id,
           soi.model_no,
           soi.title_snapshot,
           soi.variant_label,
           soi.qty,
           so.destination_country::text,
           so.shipping_method,
           so.incoterm,
           so.product_cents,
           so.processing_cents,
           so.shipping_cents,
           so.duties_cents,
           so.total_cents,
           so.merchant_status,
           sh.tracking_no,
           so.created_at,
           so.delivered_at
      from public.store_orders so
      join public.store_order_items soi on soi.store_order_id = so.id
      left join lateral (
        select s.tracking_no
          from public.shipments s
         where s.store_order_id = so.id
         order by s.created_at desc
         limit 1
      ) sh on true
     where so.org_id = v_org
       and so.kind = 'sample'
       and (p_product_id is null or soi.product_id = p_product_id)
     order by so.created_at desc, so.id desc
     limit 25;
end $$;

revoke all on function public.list_my_dropship_sample_orders(uuid) from public, anon;
grant execute on function public.list_my_dropship_sample_orders(uuid) to authenticated, service_role;
