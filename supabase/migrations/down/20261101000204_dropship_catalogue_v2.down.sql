-- Down for 20261101000204_dropship_catalogue_v2.sql: restores the 183 / 190 / 192 / 194 dropship schema and functions exactly.
drop policy if exists "dropship media staff write" on storage.objects;

delete from site_settings where key in ('dropship.min_margin_bp', 'dropship.category_min_margin_bp', 'dropship.supported_countries');

drop table if exists dropship_markets;
drop table if exists dropship_import_list;
drop table if exists dropship_routes;
drop table if exists dropship_variants;
drop table if exists dropship_products;

drop function if exists dropship_can_see_costs(uuid);
drop function if exists dropship_touch_updated_at();

-- Restore the 183 tables with their 190 division_id columns, constraints, indexes, triggers and 194 policies
create table dropship_products (
  product_id uuid primary key references products(id) on delete cascade,
  enabled boolean not null default false,
  unit_cents integer not null check (unit_cents > 0),
  weight_g integer not null check (weight_g > 0),
  has_battery boolean not null default false,
  has_liquid boolean not null default false,
  store_title text,
  store_bullets text[] not null default '{}',
  store_description text,
  updated_at timestamptz not null default now(),
  division_id uuid not null,
  constraint dropship_products_division_fk foreign key (division_id) references divisions(id) on delete restrict
);
create index dropship_products_division_idx on dropship_products (division_id);

create table dropship_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references dropship_products(product_id) on delete cascade,
  name text not null,
  colour_hex text check (colour_hex is null or colour_hex ~ '^#[0-9A-Fa-f]{6}$'),
  stock_warehouse integer not null default 0 check (stock_warehouse >= 0),
  stock_partner integer not null default 0 check (stock_partner >= 0),
  sort integer not null default 0
);
create index dropship_variants_product on dropship_variants (product_id, sort);

create table dropship_import_list (
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references dropship_products(product_id) on delete cascade,
  variant_id uuid references dropship_variants(id) on delete set null,
  service text check (service in ('express', 'standard', 'economy')),
  price_cents integer check (price_cents is null or price_cents > 0),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  division_id uuid not null,
  primary key (org_id, product_id),
  constraint dropship_import_list_division_fk foreign key (division_id) references divisions(id) on delete restrict
);
create index dropship_import_list_added_by_fk_d1f138 on dropship_import_list (added_by);
create index dropship_import_list_division_idx on dropship_import_list (division_id);
create index dropship_import_list_product_id_fk_556a41 on dropship_import_list (product_id);
create index dropship_import_list_variant_id_fk_c6f274 on dropship_import_list (variant_id);

-- Restore 190 set_division_id and division_of_audit
create or replace function set_division_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.division_id is not null then return new; end if;
  if tg_table_name = 'service_requests' then new.division_id := division_of_service_request(new);
  elsif tg_table_name = 'rfqs' then new.division_id := division_of_rfq(new);
  elsif tg_table_name = 'quotes' then new.division_id := division_of_quote(new);
  elsif tg_table_name = 'orders' then new.division_id := division_of_order(new);
  elsif tg_table_name = 'proforma_invoices' then new.division_id := division_of_proforma(new);
  elsif tg_table_name = 'payments' then new.division_id := division_of_payment(new);
  elsif tg_table_name = 'shipments' then new.division_id := division_of_shipment(new);
  elsif tg_table_name = 'documents' then new.division_id := division_of_document(new);
  elsif tg_table_name = 'brand_projects' then new.division_id := division_id_of('MMB');
  elsif tg_table_name in ('pools', 'pool_pledges') then new.division_id := division_id_of('POOL');
  elsif tg_table_name in ('turnkey_projects', 'turnkey_leads') then new.division_id := division_id_of('TK');
  elsif tg_table_name in ('dropship_products', 'dropship_rates', 'dropship_import_list') then new.division_id := division_id_of('DS');
  elsif tg_table_name = 'company_services' then new.division_id := division_id_of(division_code_for_service(to_jsonb(new) ->> 'service'));
  elsif tg_table_name = 'wallet_holds' then new.division_id := division_of_wallet_hold(new);
  elsif tg_table_name = 'journals' then new.division_id := division_of_journal(new);
  elsif tg_table_name = 'notifications' then new.division_id := division_of_notification(new);
  elsif tg_table_name = 'audit_log' then new.division_id := division_of_audit(new);
  end if;
  return new;
end $$;

create or replace function division_of_audit(r audit_log) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid; v_id uuid := case when r.entity_id ~* '^[0-9a-f-]{36}$' then r.entity_id::uuid end;
begin
  v := division_id_of(division_code_for_service(r.service));
  if v is not null then return v; end if;
  if r.action ~ '^pool[._]' then return division_id_of('POOL'); end if;
  if r.action ~ '^turnkey[._]' then return division_id_of('TK'); end if;
  if r.action like 'brand_project.%' then return division_id_of('MMB'); end if;
  if r.action like 'status.%' then
    return case r.entity
      when 'rfq' then coalesce((select division_id from rfqs where id = v_id), division_id_of('SRC'))
      when 'quote' then (select division_id from quotes where id = v_id)
      when 'order' then (select division_id from orders where id = v_id)
      when 'service_request' then (select division_id from service_requests where id = v_id)
      when 'pool' then division_id_of('POOL')
      when 'pool_pledge' then division_id_of('POOL')
      when 'brand_project' then division_id_of('MMB')
      else null end;
  end if;
  return null;
end $$;

do $$ declare t text;
begin
  foreach t in array array['dropship_products', 'dropship_import_list'] loop
    execute format('create trigger trg_set_division before insert on %I for each row execute function set_division_id()', t);
    execute format('create trigger trg_zz_division_guard before insert or update or delete on %I for each row execute function division_write_guard()', t);
  end loop;
end $$;

alter table dropship_products enable row level security;
alter table dropship_variants enable row level security;
alter table dropship_import_list enable row level security;
revoke all on dropship_products, dropship_variants, dropship_import_list from anon, authenticated;
grant select, insert, update, delete on dropship_products, dropship_variants, dropship_import_list to authenticated;
grant all on dropship_products, dropship_variants, dropship_import_list to service_role;

create policy import_list_own on dropship_import_list for all to authenticated
  using (org_id in (select my_org_ids())) with check (org_id in (select my_org_ids()));

create policy dropship_products_read on dropship_products for select to authenticated
  using (is_staff() and in_division(division_id));
create policy dropship_products_write on dropship_products for all to authenticated
  using (dropship_can_edit(division_id)) with check (dropship_can_edit(division_id));

create policy dropship_variants_read on dropship_variants for select to authenticated
  using (is_staff() and in_division((select d.division_id from dropship_products d where d.product_id = dropship_variants.product_id)));
create policy dropship_variants_write on dropship_variants for all to authenticated
  using (dropship_can_edit((select d.division_id from dropship_products d where d.product_id = dropship_variants.product_id)))
  with check (dropship_can_edit((select d.division_id from dropship_products d where d.product_id = dropship_variants.product_id)));

-- Restore 183 functions
create or replace function dropship_quote(p_unit integer, p_weight integer, r dropship_rates)
returns jsonb language sql immutable set search_path = public, extensions as $$
  select jsonb_build_object(
    'service', r.service,
    'ships_from', case r.service when 'express' then 'Octopus warehouse' when 'standard' then 'Partner warehouses' else 'Global network, checked and repacked by Octopus' end,
    'product_cents', p_unit,
    'ship_duty_cents', r.ship_base_cents + ceil(p_weight / 100.0)::int * r.ship_per_100g_cents + round(p_unit * r.duty_pct / 100.0)::int,
    'fee_cents', r.fee_cents,
    'total_cents', p_unit + r.ship_base_cents + ceil(p_weight / 100.0)::int * r.ship_per_100g_cents + round(p_unit * r.duty_pct / 100.0)::int + r.fee_cents,
    'days_min', r.days_min, 'days_max', r.days_max)
$$;
revoke all on function dropship_quote(integer, integer, dropship_rates) from public, anon, authenticated;

create or replace function dropship_catalogue(p_country text)
returns table (product_id uuid, slug text, title text, image_url text, category_id uuid, category_name text,
               stock_warehouse integer, stock_partner integer, variant_count integer, services jsonb, blocked_reason text)
language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.slug, p.title, p.image_url, p.category_id, c.name as category_name, d.unit_cents, d.weight_g, d.has_battery, d.has_liquid,
           coalesce((select sum(v.stock_warehouse) from dropship_variants v where v.product_id = p.id), 0)::int as wh,
           coalesce((select sum(v.stock_partner) from dropship_variants v where v.product_id = p.id), 0)::int as pt,
           (select count(*) from dropship_variants v where v.product_id = p.id)::int as nv
    from dropship_products d
    join products p on p.id = d.product_id and p.status = 'live'
    join suppliers s on s.id = p.supplier_id and s.verified and s.archived_at is null
    left join categories c on c.id = p.category_id
    where d.enabled and auth.uid() is not null
  ), svc as (
    select b.id, jsonb_agg(dropship_quote(b.unit_cents, b.weight_g, r) order by r.days_min, r.service) as services
    from base b join dropship_rates r on r.active and r.country = upper(p_country)
      and (not b.has_battery or r.allows_battery) and (not b.has_liquid or r.allows_liquid)
      and (r.service <> 'express' or b.wh > 0) and (r.service <> 'standard' or b.pt > 0)
    group by b.id
  )
  select b.id, b.slug, b.title, b.image_url, b.category_id, b.category_name, b.wh, b.pt, b.nv,
         coalesce(svc.services, '[]'::jsonb),
         case when svc.id is not null then null
              when not exists (select 1 from dropship_rates r where r.active and r.country = upper(p_country)) then 'no shipping route there yet'
              when b.has_battery and not exists (select 1 from dropship_rates r where r.active and r.country = upper(p_country) and r.allows_battery) then 'contains a battery, which no route there accepts'
              when b.has_liquid and not exists (select 1 from dropship_rates r where r.active and r.country = upper(p_country) and r.allows_liquid) then 'contains liquid, which no route there accepts'
              else 'out of stock for the routes there' end
  from base b left join svc on svc.id = b.id
$$;
revoke all on function dropship_catalogue(text) from public, anon;
grant execute on function dropship_catalogue(text) to authenticated;

create or replace function dropship_product_detail(p_product uuid, p_country text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'product_id', c.product_id, 'slug', c.slug, 'title', c.title, 'image_url', c.image_url, 'category_name', c.category_name,
    'stock_warehouse', c.stock_warehouse, 'stock_partner', c.stock_partner, 'services', c.services, 'blocked_reason', c.blocked_reason,
    'has_battery', d.has_battery, 'has_liquid', d.has_liquid, 'weight_g', d.weight_g,
    'store_title', coalesce(d.store_title, c.title), 'store_bullets', to_jsonb(d.store_bullets), 'store_description', d.store_description,
    'images', coalesce((select jsonb_agg(m.url order by m.sort) from product_media m where m.product_id = c.product_id and m.kind = 'image' and m.url is not null), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'colour', v.colour_hex, 'stock_warehouse', v.stock_warehouse, 'stock_partner', v.stock_partner) order by v.sort, v.name) from dropship_variants v where v.product_id = c.product_id), '[]'::jsonb),
    'blocked_countries', coalesce((select jsonb_agg(distinct r.country) from dropship_rates r where r.active and ((d.has_battery and not r.allows_battery) or (d.has_liquid and not r.allows_liquid))
                                   and not exists (select 1 from dropship_rates r2 where r2.active and r2.country = r.country and (not d.has_battery or r2.allows_battery) and (not d.has_liquid or r2.allows_liquid))), '[]'::jsonb))
  from dropship_catalogue(p_country) c join dropship_products d on d.product_id = c.product_id
  where c.product_id = p_product
$$;
revoke all on function dropship_product_detail(uuid, text) from public, anon;
grant execute on function dropship_product_detail(uuid, text) to authenticated;

create or replace function dropship_countries()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct country::text from dropship_rates where active and auth.uid() is not null order by 1
$$;
revoke all on function dropship_countries() from public, anon;
grant execute on function dropship_countries() to authenticated;
