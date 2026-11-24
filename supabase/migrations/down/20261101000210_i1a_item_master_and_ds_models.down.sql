-- Down migration for 20261101000210_i1a_item_master_and_ds_models.sql

-- 1. Drop I1a triggers and helper functions on dropship tables
drop trigger if exists trg_freeze_dropship_variant_legacy_cost on public.dropship_variants;
drop function if exists public.freeze_dropship_variant_legacy_cost();

drop trigger if exists trg_freeze_dropship_product_legacy_cost on public.dropship_products;
drop function if exists public.freeze_dropship_product_legacy_cost();

drop trigger if exists trg_dropship_variant_model_no_and_item on public.dropship_variants;
drop function if exists public.dropship_variant_model_no_and_item_guard();

drop trigger if exists trg_dropship_product_model_no on public.dropship_products;
drop function if exists public.dropship_product_model_no_guard();

drop function if exists public.dropship_sourcing_links(uuid[]);
drop function if exists public.list_sourcing_supplier_products(integer);

-- 2. Restore original merchant dropship RPCs (migration 205) BEFORE dropping model_no / supplier_product_id
create or replace function public.get_dropship_countries()
returns table (
  country text,
  locked_by_staff boolean,
  has_active_routes boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := dropship_merchant_org();
begin
  if v_org is null then return; end if;
  return query
    select m.country::text,
           m.locked_by_staff,
           exists (
             select 1
               from dropship_routes r
               join dropship_products p on p.id = r.product_id and p.status = 'active'
               left join suppliers s on s.id = p.supplier_id
              where r.destination_country = m.country
                and r.is_active
                and (p.source_type = 'own_warehouse' or (s.id is not null and s.verified and s.archived_at is null))
           ) as has_active_routes
      from dropship_markets m
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
  octopus_sku text,
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
language plpgsql security definer set search_path = public as $$
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
  if v_org is null or v_uid is null then return; end if;
  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;
  if v_country is null or v_country !~ '^[A-Z]{2}$' then return; end if;
  if not exists (select 1 from dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return;
  end if;

  return query
    with eligible as (
      select p.id,
             p.octopus_sku,
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
                     'octopus_sku', v.octopus_sku,
                     'options', v.options,
                     'price_adjust_cents', v.price_adjust_cents,
                     'stock_status', v.stock_status
                   ) order by v.sort, v.octopus_sku
                 ),
                 '[]'::jsonb
               )
               from dropship_variants v
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
               from dropship_routes r
              where r.product_id = p.id
                and r.destination_country = v_country
                and r.is_active
             ) as routes_json
        from dropship_products p
        left join suppliers s on s.id = p.supplier_id
       where p.status = 'active'
         and (
           (p.supplier_id is not null and s.verified and s.archived_at is null)
           or (p.source_type = 'own_warehouse' and (p.supplier_id is null or (s.verified and s.archived_at is null)))
         )
         and exists (
           select 1 from dropship_routes r
            where r.product_id = p.id
              and r.destination_country = v_country
              and r.is_active
         )
         and (
           v_q is null
           or lower(p.title) like '%' || v_q || '%'
           or lower(coalesce(p.description, '')) like '%' || v_q || '%'
           or lower(coalesce(p.category, '')) like '%' || v_q || '%'
           or lower(p.octopus_sku) like '%' || v_q || '%'
         )
         and (v_cat is null or lower(coalesce(p.category, '')) = lower(v_cat))
    )
    select e.id as product_id,
           e.octopus_sku,
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
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_rate jsonb;
  v_res jsonb;
begin
  if v_org is null or v_uid is null or p_product_id is null then return null; end if;
  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;
  if v_country is null or v_country !~ '^[A-Z]{2}$' then return null; end if;
  if not exists (select 1 from dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return null;
  end if;

  select jsonb_build_object(
           'product_id', p.id,
           'octopus_sku', p.octopus_sku,
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
                 'octopus_sku', v.octopus_sku,
                 'options', v.options,
                 'price_adjust_cents', v.price_adjust_cents,
                 'stock_status', v.stock_status
               ) order by v.sort, v.octopus_sku
             )
             from dropship_variants v where v.product_id = p.id
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
             from dropship_routes r
            where r.product_id = p.id and r.destination_country = v_country and r.is_active
           ), '[]'::jsonb)
         )
    into v_res
    from dropship_products p
    left join suppliers s on s.id = p.supplier_id
   where p.id = p_product_id
     and p.status = 'active'
     and (
       (p.supplier_id is not null and s.verified and s.archived_at is null)
       or (p.source_type = 'own_warehouse' and (p.supplier_id is null or (s.verified and s.archived_at is null)))
     )
     and exists (
       select 1 from dropship_routes r
        where r.product_id = p.id and r.destination_country = v_country and r.is_active
     );

  return v_res;
end $$;
revoke all on function public.get_dropship_product(uuid, text) from public, anon;
grant execute on function public.get_dropship_product(uuid, text) to authenticated, service_role;

drop function if exists public.dropship_product_supplier_eligible(public.dropship_products);

-- 3. Restore octopus_sku & origin_country on dropship_products and dropship_variants, then drop I1a columns
update public.dropship_products
   set octopus_sku = coalesce(nullif(btrim(octopus_sku), ''), nullif(btrim(legacy_sku), ''), model_no),
       origin_country = coalesce(origin_country, 'CN');

update public.dropship_variants
   set octopus_sku = coalesce(nullif(btrim(octopus_sku), ''), nullif(btrim(legacy_sku), ''), model_no);

drop index if exists public.dropship_variants_supplier_product_idx;
drop index if exists public.dropship_variants_model_no_key;
drop index if exists public.dropship_variants_item_id_key;
drop index if exists public.dropship_variants_legacy_sku_key;
alter table public.dropship_variants drop constraint if exists dropship_variants_model_no_check;
alter table public.dropship_variants
  drop column if exists supplier_product_id,
  drop column if exists item_id,
  drop column if exists legacy_sku,
  drop column if exists model_no;

alter table public.dropship_variants alter column octopus_sku set not null;
alter table public.dropship_variants add constraint dropship_variants_octopus_sku_check check (btrim(octopus_sku) <> '');
create unique index if not exists dropship_variants_octopus_sku_key on public.dropship_variants (upper(btrim(octopus_sku)));

drop index if exists public.dropship_products_model_no_key;
drop index if exists public.dropship_products_legacy_sku_key;
alter table public.dropship_products drop constraint if exists dropship_products_model_no_check;
alter table public.dropship_products
  drop column if exists last_variant_seq,
  drop column if exists legacy_sku,
  drop column if exists model_no;

alter table public.dropship_products alter column octopus_sku set not null;
alter table public.dropship_products add constraint dropship_products_sku_check check (btrim(octopus_sku) <> '');
create unique index if not exists dropship_products_octopus_sku_key on public.dropship_products (upper(btrim(octopus_sku)));
alter table public.dropship_products alter column origin_country set default 'CN';
alter table public.dropship_products alter column origin_country set not null;

drop function if exists public.next_ds_product_model_no();
drop sequence if exists public.seq_ds_model_no;

alter table public.supplier_products drop constraint if exists supplier_products_id_key;
alter table public.supplier_products drop column if exists id;

-- 4. Unwind item_master triggers & Sourcing HS functions, restore original HS triggers/functions (migrations 166 & 195)
drop trigger if exists trg_sync_item_master_hs_to_products on public.item_master;
drop function if exists public.sync_item_master_hs_to_products();

drop trigger if exists trg_block_direct_product_hs_write on public.products;
drop function if exists public.block_direct_product_hs_write();

drop trigger if exists trg_products_link_item_master on public.products;
drop function if exists public.products_link_item_master();

drop trigger if exists trg_products_ensure_item_master on public.products;
drop function if exists public.products_ensure_item_master();

drop function if exists public.verify_item_hs_code(uuid, text, text);
drop function if exists public.set_product_item_hs(uuid, text, text);
drop function if exists public.calc_billed_weight_g(uuid, numeric, integer);

-- Drop portal_products() temporarily so products.item_id can be dropped cleanly, then recreate
drop function if exists public.portal_products();
drop index if exists public.products_item_id_key;
alter table public.products drop column if exists item_id;

create or replace function public.portal_products() returns setof public.products
language sql stable security definer set search_path = public as $$
  select p.* from public.products p where can('products', 'view') or is_my_supplier(p.supplier_id)
$$;
revoke all on function public.portal_products() from public, anon;
grant execute on function public.portal_products() to authenticated, service_role;

-- Restore trg_guard_hs_code trigger on products (guard_hs_code() function was kept untouched from migration 166)
drop trigger if exists trg_guard_hs_code on public.products;
create trigger trg_guard_hs_code
  before insert or update of hs_code, hs_code_source, hs_code_status
  on public.products
  for each row execute function public.guard_hs_code();

-- Restore confirm_hs_type, hs_type_change_preview, change_hs_type_heading (migration 166)
create or replace function public.confirm_hs_type(p_type uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t hs_product_types; r record; n int := 0;
begin
  if not (can('products', 'approve') or is_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into t from hs_product_types where id = p_type for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.heading is null then raise exception 'HS_NO_HEADING: set a 4-digit heading before confirming'; end if;
  update hs_product_types set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now() where id = p_type;
  for r in select id, hs_code, hs_code_status from products where hs_product_type_id = p_type and hs_code_source in ('rule', 'ai') and hs_code_status <> 'confirmed' loop
    update products set hs_code = t.heading, hs_code_status = 'confirmed', hs_code_note = null where id = r.id;
    perform write_audit('product.hs_code_confirmed', 'products', r.id::text, jsonb_build_object('type', t.name, 'heading', t.heading, 'from_status', r.hs_code_status));
    n := n + 1;
  end loop;
  perform write_audit('hs_type.confirmed', 'hs_product_types', p_type::text, jsonb_build_object('type', t.name, 'heading', t.heading, 'products', n));
  return jsonb_build_object('type', t.name, 'heading', t.heading, 'products_confirmed', n);
end $$;
grant execute on function public.confirm_hs_type(uuid) to authenticated;

create or replace function public.hs_type_change_preview(p_type uuid, p_heading text) returns table(product_id uuid, sku text, title text, current_code text, new_code text, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku, p.title, p.hs_code, p_heading, p.hs_code_status from products p
  where p.hs_product_type_id = p_type and coalesce(p.hs_code_source, 'rule') in ('rule', 'ai') and (can('products', 'approve') or is_admin())
  order by p.sku
$$;
grant execute on function public.hs_type_change_preview(uuid, text) to authenticated;

create or replace function public.change_hs_type_heading(p_type uuid, p_heading text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t hs_product_types; r record; n int := 0;
begin
  if not (can('products', 'approve') or is_admin()) then raise exception 'FORBIDDEN'; end if;
  if p_heading !~ '^[0-9]{4}$' then raise exception 'HS_BAD_HEADING: the heading must be exactly 4 digits'; end if;
  select * into t from hs_product_types where id = p_type for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  update hs_product_types set heading = p_heading, confirmed = true, source = 'manual', confidence = null, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now() where id = p_type;
  for r in select id, hs_code from products where hs_product_type_id = p_type and coalesce(hs_code_source, 'rule') in ('rule', 'ai') loop
    update products set hs_code = p_heading, hs_code_source = 'rule', hs_code_status = 'confirmed', hs_code_confidence = null, hs_code_note = null, hs_classify_pending = false where id = r.id;
    perform write_audit('product.hs_code_changed', 'products', r.id::text, jsonb_build_object('type', t.name, 'from', r.hs_code, 'to', p_heading));
    n := n + 1;
  end loop;
  perform write_audit('hs_type.heading_changed', 'hs_product_types', p_type::text, jsonb_build_object('type', t.name, 'from', t.heading, 'to', p_heading, 'products', n));
  return jsonb_build_object('type', t.name, 'heading', p_heading, 'products_updated', n);
end $$;
grant execute on function public.change_hs_type_heading(uuid, text) to authenticated;

-- Restore import_product_row (migration 195)
create or replace function public.import_product_row(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $function$
declare v_id uuid; v_img jsonb; v_cur text := coalesce(p->>'currency', 'USD'); v_min bigint; v_sup uuid := (p->>'supplier_id')::uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif auth.uid() is null then raise exception 'FORBIDDEN';
  elsif (p->>'mode') = 'update' then
    if not product_editable((p->>'product_id')::uuid) then raise exception 'NOT_EDITABLE: You cannot edit this product.'; end if;
  elsif not (can('products', 'create') and (is_admin() or not has_role('distributor') or is_my_supplier(v_sup))
             and coalesce((select product_upload from supplier_switches where supplier_id = v_sup), true)) then
    raise exception 'new row violates row-level security policy for table "products"' using errcode = '42501';
  end if;
  select min((t->>'unit_price_cents')::bigint) into v_min from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;
  if (p->>'mode') = 'update' then
    update products set title = p->>'title', category_id = nullif(p->>'category_id','')::uuid, unit = coalesce(p->>'unit','pcs'),
      moq = coalesce((p->>'moq')::int, 1), lead_time_days = (p->>'lead_time_days')::int, incoterm = p->>'incoterm', origin_country = p->>'origin_country',
      hs_code = coalesce(nullif(btrim(p->>'hs_code'), ''), hs_code), hs_code_source = case when nullif(btrim(p->>'hs_code'), '') is not null and nullif(btrim(p->>'hs_code'), '') is distinct from hs_code then 'sheet' else hs_code_source end, currency = v_cur, octopus_dropship = coalesce((p->>'octopus_dropship')::boolean, false),
      ready_to_ship = coalesce((p->>'ready_to_ship')::boolean, false), description = p->>'description', min_price_cents = v_min
    where id = (p->>'product_id')::uuid and supplier_id = v_sup
    returning id into v_id;
    if v_id is null then raise exception 'NOT_EDITABLE: You cannot edit this product.'; end if;
  else
    insert into products(external_id, slug, title, description, supplier_id, category_id, status, unit, moq, lead_time_days, incoterm,
      origin_country, hs_code, hs_code_source, octopus_dropship, ready_to_ship, currency, min_price_cents, created_by, seo_title)
    values (p->>'sku', p->>'slug', p->>'title', p->>'description', (p->>'supplier_id')::uuid, nullif(p->>'category_id','')::uuid, 'draft',
      coalesce(p->>'unit','pcs'), coalesce((p->>'moq')::int, 1), (p->>'lead_time_days')::int, p->>'incoterm', p->>'origin_country', nullif(btrim(p->>'hs_code'), ''), case when nullif(btrim(p->>'hs_code'), '') is not null then 'sheet' end,
      coalesce((p->>'octopus_dropship')::boolean, false), coalesce((p->>'ready_to_ship')::boolean, false), v_cur, v_min, auth.uid(),
      left(p->>'title' || ' | Wholesale', 60))
    returning id into v_id;
  end if;
  delete from price_tiers where product_id = v_id;
  insert into price_tiers(product_id, min_qty, unit_price_cents, currency)
  select v_id, (t->>'min_qty')::int, (t->>'unit_price_cents')::bigint, v_cur from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;
  for v_img in select * from jsonb_array_elements(coalesce(p->'images', '[]')) loop
    delete from product_media where product_id = v_id
      and (sort = (v_img->>'position')::int or sha256 = v_img->>'sha256');
    insert into product_media(product_id, url, kind, sort, storage_path, source_file_name, sha256)
    values (v_id, v_img->>'url', 'image', (v_img->>'position')::int, v_img->>'storage_path', v_img->>'source_file_name', v_img->>'sha256');
  end loop;
  update products set image_url = (select url from product_media where product_id = v_id order by sort limit 1) where id = v_id;
  return v_id;
end $function$;
revoke all on function public.import_product_row(jsonb) from public, anon;
grant execute on function public.import_product_row(jsonb) to authenticated, service_role;

-- 5. Drop item_master and parser helpers
drop trigger if exists trg_guard_item_master on public.item_master;
drop function if exists public.guard_item_master();
drop table if exists public.item_master;
drop function if exists public.parse_unambiguous_box_cm(text);
drop function if exists public.parse_unambiguous_weight_g(text);
