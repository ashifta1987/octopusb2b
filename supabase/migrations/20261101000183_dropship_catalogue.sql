-- ADDON-44-E — Dropshipping catalogue (boards 22 and 23).
-- Structure only: no rates, products or prices are inserted here (live stays empty until real numbers arrive;
-- staging gets EXAMPLE data from `pnpm demo:seed`).
-- Hard rules enforced in the database, not only in the UI:
--   * only products from VERIFIED, non-archived suppliers, live, switched on for dropshipping;
--   * blocked products (no route to the country, battery/liquid not allowed on any route) come back with a reason;
--   * responses carry service names only — never supplier names/codes, carrier names, Octopus cost or margin.
-- Tables are not readable by anon/authenticated; customers read through the two SECURITY DEFINER functions.

create table if not exists dropship_products (
  product_id uuid primary key references products(id) on delete cascade,
  enabled boolean not null default false,
  unit_cents integer not null check (unit_cents > 0),          -- product price to the seller per unit (US$ cents), not Octopus cost
  weight_g integer not null check (weight_g > 0),               -- shipping weight incl. retail box
  has_battery boolean not null default false,
  has_liquid boolean not null default false,
  store_title text, store_bullets text[] not null default '{}', store_description text,
  updated_at timestamptz not null default now()
);

create table if not exists dropship_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references dropship_products(product_id) on delete cascade,
  name text not null, colour_hex text check (colour_hex is null or colour_hex ~ '^#[0-9A-Fa-f]{6}$'),
  stock_warehouse integer not null default 0 check (stock_warehouse >= 0),   -- Octopus warehouse (Express)
  stock_partner integer not null default 0 check (stock_partner >= 0),       -- partner warehouses (Standard)
  sort integer not null default 0
);
create index if not exists dropship_variants_product on dropship_variants(product_id, sort);

create table if not exists dropship_rates (
  id uuid primary key default gen_random_uuid(),
  country char(2) not null,
  service text not null check (service in ('express', 'standard', 'economy')),
  ship_base_cents integer not null check (ship_base_cents >= 0),
  ship_per_100g_cents integer not null check (ship_per_100g_cents >= 0),
  duty_pct numeric(5,2) not null default 0 check (duty_pct >= 0),
  fee_cents integer not null check (fee_cents >= 0),                         -- fulfilment fee per order
  days_min integer not null check (days_min > 0), days_max integer not null check (days_max >= days_min),
  allows_battery boolean not null default true, allows_liquid boolean not null default false,
  active boolean not null default true,
  unique (country, service)
);

create table if not exists dropship_import_list (
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references dropship_products(product_id) on delete cascade,
  variant_id uuid references dropship_variants(id) on delete set null,
  service text check (service in ('express', 'standard', 'economy')),
  price_cents integer check (price_cents is null or price_cents > 0),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, product_id)
);

alter table dropship_products enable row level security;
alter table dropship_variants enable row level security;
alter table dropship_rates enable row level security;
alter table dropship_import_list enable row level security;
revoke all on dropship_products, dropship_variants, dropship_rates from anon, authenticated;
-- staff manage the catalogue through the service role / admin tools; customers only see their own import list
revoke all on dropship_import_list from anon;
grant select, insert, update, delete on dropship_import_list to authenticated;
drop policy if exists import_list_own on dropship_import_list;
create policy import_list_own on dropship_import_list for all to authenticated
  using (org_id in (select my_org_ids())) with check (org_id in (select my_org_ids()));

-- price per service for one product to one country (internal helper, not callable by clients)
create or replace function dropship_quote(p_unit integer, p_weight integer, r dropship_rates)
returns jsonb language sql immutable as $$
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

-- one row per catalogue product for a country: available services (cheapest first) or a block reason
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

-- full product view for board 23 (same filters); null when the product is not in the catalogue
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

-- countries that have at least one active route (for the "Customers in" select)
create or replace function dropship_countries()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct country::text from dropship_rates where active and auth.uid() is not null order by 1
$$;
revoke all on function dropship_countries() from public, anon;
grant execute on function dropship_countries() to authenticated;

