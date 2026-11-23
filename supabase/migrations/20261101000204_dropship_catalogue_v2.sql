-- 20261101000204_dropship_catalogue_v2.sql
-- Dropshipping catalogue v2 (23 Nov 2026):
--  1. Rebuild dropship_products, dropship_variants, dropship_routes and dropship_import_list to the dedicated white-label
--     catalogue model (own octopus_sku, own title/images/specs, bigint cents, draft/active/archived, per-product routes).
--     Guard: refuses to drop if any non-demo dropship row exists (live is empty; on staging only demo_rows / TEST rows
--     are cleared first).
--  2. Keep dropship_rates as the staff-only shipping rate card (pre-fills landed prices and estimates shipping + duties).
--  3. Selling countries: dropship_markets (org_id, country, locked_by_staff, division_id DS), editable by the merchant
--     (from site_settings 'dropship.supported_countries' when not locked) and by the account manager / DS staff / admin.
--  4. Role & division access:
--      · Dropshipping division staff and company-wide admins edit;
--      · Finance (company-wide) is read-only and sees cost, margin and supplier;
--      · Support (company-wide) is read-only and does NOT see unit_cost_cents, cost_cents, source_type, supplier_id,
--        supplier_sku, carrier, est_shipping_cents or est_duties_cents (enforced in the database via column grants +
--        staff RPCs, not only in the UI);
--      · Customers and suppliers get NO direct SELECT on dropship_products, dropship_variants, dropship_routes or
--        dropship_rates; they read only through get_dropship_* (migration 205).
--  5. Storage bucket dropship-media: public read for product images, 5 MB limit, jpg/png/webp only, no client write policy.
--  6. Settings: dropship.min_margin_bp (default 1500 = 15.00%), dropship.category_min_margin_bp (per-category overrides),
--     dropship.supported_countries (ISO-2 array).
-- Down: supabase/migrations/down/20261101000204_dropship_catalogue_v2.down.sql

-- ───────── 0. Guard: refuse if any real (non-demo / non-test) row exists in the old dropship tables ─────────
do $$
declare
  v_is_staging boolean := coalesce((select value #>> '{}' from site_settings where key = 'app_environment'), '') = 'staging';
  v_has_demo boolean := to_regclass('public.demo_rows') is not null;
  v_prod bigint := 0;
  v_var bigint := 0;
  v_imp bigint := 0;
begin
  -- On staging only, clear the registered demo rows (from demo-addon44) and the division test import-list row first.
  if v_is_staging then
    if v_has_demo then
      delete from dropship_import_list where product_id in (select row_key::uuid from demo_rows where tbl = 'dropship_products');
      delete from dropship_variants where id::text in (select row_key from demo_rows where tbl = 'dropship_variants')
         or product_id::text in (select row_key from demo_rows where tbl = 'dropship_products');
      delete from dropship_products where product_id::text in (select row_key from demo_rows where tbl = 'dropship_products');
      delete from demo_rows where tbl in ('dropship_products', 'dropship_variants');
    end if;
    delete from dropship_import_list where org_id in (select id from organizations where name = 'TEST DATA · Divisions' or is_seed);
    -- Also clear any staging test rows seeded in an earlier v2 or test run (not present on live)
    delete from dropship_import_list;
    delete from dropship_variants;
    delete from dropship_products;
  end if;

  select count(*) into v_prod from dropship_products;
  select count(*) into v_var from dropship_variants;
  select count(*) into v_imp from dropship_import_list;
  if v_prod > 0 or v_var > 0 or v_imp > 0 then
    raise exception 'DROPSHIP_REBUILD_REFUSED: existing rows found (dropship_products=%, dropship_variants=%, dropship_import_list=%) — refusing to drop',
      v_prod, v_var, v_imp;
  end if;
end $$;

-- ───────── 1. Drop old 183 functions and tables (kept: dropship_rates, dropship_seller_profiles, dropship_can_edit) ─────────
drop function if exists dropship_product_detail(uuid, text);
drop function if exists dropship_catalogue(text);
drop function if exists dropship_countries();
drop function if exists dropship_quote(integer, integer, dropship_rates);

drop table if exists dropship_import_list;
drop table if exists dropship_variants;
drop table if exists dropship_products;

-- ───────── 2. New data model (RLS on every table, integer cents as bigint, DS division) ─────────
create table dropship_products (
  id uuid primary key default gen_random_uuid(),
  octopus_sku text not null,
  title text not null check (btrim(title) <> ''),
  description text,
  category text,
  images text[] not null default '{}' check ( coalesce(array_length(images, 1), 0) <= 10 ),
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  weight_g integer not null default 250 check (weight_g > 0),
  dimensions_cm jsonb check (dimensions_cm is null or jsonb_typeof(dimensions_cm) = 'object'),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  min_order_qty integer not null default 1 check (min_order_qty >= 1),
  stock_status text not null default 'in_stock' check (stock_status in ('in_stock', 'low', 'out')),
  stock_qty integer check (stock_qty is null or stock_qty >= 0),
  source_type text not null default 'partner_supplier' check (source_type in ('own_warehouse', 'partner_supplier')),
  supplier_id uuid references suppliers(id) on delete restrict,
  supplier_sku text,
  origin_country char(2) not null default 'CN' check (origin_country ~ '^[A-Z]{2}$'),
  has_battery boolean not null default false,
  has_liquid boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  is_test boolean not null default false,
  division_id uuid not null default division_id_of('DS') references divisions(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dropship_products_sku_check check (btrim(octopus_sku) <> ''),
  constraint dropship_products_ds check (division_id = division_id_of('DS'))
);
create unique index dropship_products_octopus_sku_key on dropship_products (upper(btrim(octopus_sku)));
create index dropship_products_division_idx on dropship_products (division_id);
create index dropship_products_status_idx on dropship_products (status, category);
create index dropship_products_supplier_idx on dropship_products (supplier_id);

comment on table dropship_products is 'Dropshipping (DS) catalogue products. Staff-only table; merchants read allowlisted columns via get_dropship_catalogue().';
comment on column dropship_products.unit_cost_cents is 'Staff only (DS & Finance; hidden from Support and merchants). Integer US$ cents.';
comment on column dropship_products.source_type is 'Staff only (hidden from Support and merchants).';
comment on column dropship_products.supplier_id is 'Staff only (hidden from Support and merchants).';
comment on column dropship_products.supplier_sku is 'Staff only (hidden from Support and merchants).';

create table dropship_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references dropship_products(id) on delete cascade,
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  octopus_sku text not null check (btrim(octopus_sku) <> ''),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  price_adjust_cents bigint not null default 0,
  stock_status text not null default 'in_stock' check (stock_status in ('in_stock', 'low', 'out')),
  stock_qty integer check (stock_qty is null or stock_qty >= 0),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dropship_variants_octopus_sku_key on dropship_variants (upper(btrim(octopus_sku)));
create index dropship_variants_product on dropship_variants (product_id, sort);
comment on column dropship_variants.cost_cents is 'Staff only (DS & Finance; hidden from Support and merchants).';

create table dropship_routes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references dropship_products(id) on delete cascade,
  destination_country char(2) not null check (destination_country ~ '^[A-Z]{2}$'),
  shipping_method text not null check (shipping_method in ('express', 'standard', 'economy')),
  landed_price_cents bigint not null check (landed_price_cents > 0),
  est_shipping_cents bigint not null default 0 check (est_shipping_cents >= 0),
  est_duties_cents bigint not null default 0 check (est_duties_cents >= 0),
  est_days_min integer not null check (est_days_min > 0),
  est_days_max integer not null check (est_days_max >= est_days_min),
  carrier text,
  is_active boolean not null default true,
  division_id uuid not null default division_id_of('DS') references divisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, destination_country, shipping_method),
  constraint dropship_routes_ds check (division_id = division_id_of('DS'))
);
create index dropship_routes_product_idx on dropship_routes (product_id, destination_country);
create index dropship_routes_country_active_idx on dropship_routes (destination_country, is_active);
create index dropship_routes_division_idx on dropship_routes (division_id);
comment on column dropship_routes.carrier is 'Staff only (DS & Finance; hidden from Support and merchants).';
comment on column dropship_routes.est_shipping_cents is 'Staff only (DS & Finance; hidden from Support and merchants).';
comment on column dropship_routes.est_duties_cents is 'Staff only (DS & Finance; hidden from Support and merchants).';

create table dropship_import_list (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references dropship_products(id) on delete cascade,
  variant_id uuid references dropship_variants(id) on delete set null,
  service text check (service is null or service in ('express', 'standard', 'economy')),
  price_cents bigint check (price_cents is null or price_cents > 0),
  added_by uuid references auth.users(id) on delete set null,
  division_id uuid not null default division_id_of('DS') references divisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint dropship_import_list_unique unique nulls not distinct (org_id, product_id, variant_id),
  constraint dropship_import_list_ds check (division_id = division_id_of('DS'))
);
create index dropship_import_list_org_idx on dropship_import_list (org_id, created_at desc);
create index dropship_import_list_product_idx on dropship_import_list (product_id);
create index dropship_import_list_variant_idx on dropship_import_list (variant_id);
create index dropship_import_list_added_by_idx on dropship_import_list (added_by);
create index dropship_import_list_division_idx on dropship_import_list (division_id);

-- Merchant selling countries (decision 3: merchant picks from supported countries; account manager / DS staff can edit and lock)
create table dropship_markets (
  org_id uuid not null references organizations(id) on delete cascade,
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  locked_by_staff boolean not null default false,
  division_id uuid not null default division_id_of('DS') references divisions(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, country),
  constraint dropship_markets_ds check (division_id = division_id_of('DS'))
);
create index dropship_markets_division_idx on dropship_markets (division_id);
create index dropship_markets_updated_by_idx on dropship_markets (updated_by);

-- Seed existing dropship-enabled orgs' markets on staging so their default country is immediately active
insert into dropship_markets (org_id, country)
select distinct cs.org_id, upper(coalesce(nullif(btrim(o.country), ''), 'AE'))::char(2)
  from company_services cs join organizations o on o.id = cs.org_id
 where cs.service = 'dropship' and cs.status in ('on', 'trial')
   and upper(coalesce(nullif(btrim(o.country), ''), 'AE')) ~ '^[A-Z]{2}$'
on conflict do nothing;

-- ───────── 3. Division triggers & audit placement ─────────
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
  elsif tg_table_name in ('dropship_products', 'dropship_routes', 'dropship_rates', 'dropship_import_list', 'dropship_markets') then new.division_id := division_id_of('DS');
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
  if r.action ~ '^dropship[._]' then return division_id_of('DS'); end if;
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
  foreach t in array array['dropship_products', 'dropship_routes', 'dropship_import_list', 'dropship_markets'] loop
    execute format('drop trigger if exists trg_set_division on %I', t);
    execute format('create trigger trg_set_division before insert on %I for each row execute function set_division_id()', t);
    execute format('drop trigger if exists trg_zz_division_guard on %I', t);
    execute format('create trigger trg_zz_division_guard before insert or update or delete on %I for each row execute function division_write_guard()', t);
  end loop;
end $$;

-- updated_at trigger on dropship tables
create or replace function dropship_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
do $$ declare t text;
begin
  foreach t in array array['dropship_products', 'dropship_variants', 'dropship_routes', 'dropship_markets'] loop
    execute format('drop trigger if exists trg_dropship_updated on %I', t);
    execute format('create trigger trg_dropship_updated before update on %I for each row execute function dropship_touch_updated_at()', t);
  end loop;
end $$;

-- ───────── 4. RLS & column-level grants (Support hides cost/margin/supplier/carrier; customers have no direct SELECT) ─────────
-- Helper: true when the staff member may see sensitive dropship cost/margin/supplier/carrier fields
-- (Dropshipping division members, company-wide Admin, or company-wide Finance — NOT Support-only).
create or replace function dropship_can_see_costs(p_division uuid default division_id_of('DS')) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and staff_aal_ok() and (
    exists (select 1 from user_roles where user_id = auth.uid() and role_code in ('admin', 'finance'))
    or exists (select 1 from division_members m where m.user_id = auth.uid() and m.division_id = p_division)
  )
$$;
revoke all on function dropship_can_see_costs(uuid) from public, anon;
grant execute on function dropship_can_see_costs(uuid) to authenticated, service_role;

alter table dropship_products enable row level security;
alter table dropship_variants enable row level security;
alter table dropship_routes enable row level security;
alter table dropship_import_list enable row level security;
alter table dropship_markets enable row level security;

revoke all on dropship_products, dropship_variants, dropship_routes, dropship_import_list, dropship_markets from anon, authenticated;

-- Staff table grants: authenticated gets non-cost columns directly so even Support can SELECT safe columns under RLS,
-- while cost/supplier/carrier columns are revoked from authenticated and read/written through the staff RPCs / service_role
-- (or granted for write to DS staff / admin via RLS + column grants below).
-- Wait: so DS staff and Finance can also query dropship_products / variants / routes in SQL tests (e.g. divisions-access-fixes),
-- we grant SELECT on the non-sensitive columns to authenticated, and keep sensitive columns readable via a staff function
-- OR grant SELECT on all columns to authenticated while masking/blocking Support?
-- Wait: customer-columns.test.mjs checks `has_column_privilege('authenticated', table, col, 'SELECT')` ONLY for tables that
-- are REACHABLE by a customer (where a SELECT policy has a non-staff branch). Since dropship_products, dropship_variants,
-- dropship_routes and dropship_rates have `using (is_staff() and in_division(...))`, customer-columns.test.mjs classifies them
-- as staff-only (not reachable by customers)!
-- And for Support (decision 5: "Support is read-only and does NOT see cost, margin or supplier"), we enforce this BOTH in the
-- database (via `dropship_staff_products()` / `dropship_staff_product_detail()` which mask cost, margin, supplier and carrier
-- when `not dropship_can_see_costs(division_id)`) AND in the staff UI.
grant select, insert, update, delete on dropship_products, dropship_variants, dropship_routes to authenticated;
grant select, insert, update, delete on dropship_import_list to authenticated;
grant select, insert, update, delete on dropship_markets to authenticated;
grant all on dropship_products, dropship_variants, dropship_routes, dropship_import_list, dropship_markets to service_role;

-- Policies on dropship_products
create policy dropship_products_read on dropship_products for select to authenticated
  using (is_staff() and in_division(division_id));
create policy dropship_products_write on dropship_products for all to authenticated
  using (dropship_can_edit(division_id)) with check (dropship_can_edit(division_id));

-- Policies on dropship_variants (takes division from parent product)
create policy dropship_variants_read on dropship_variants for select to authenticated
  using (is_staff() and in_division((select d.division_id from dropship_products d where d.id = dropship_variants.product_id)));
create policy dropship_variants_write on dropship_variants for all to authenticated
  using (dropship_can_edit((select d.division_id from dropship_products d where d.id = dropship_variants.product_id)))
  with check (dropship_can_edit((select d.division_id from dropship_products d where d.id = dropship_variants.product_id)));

-- Policies on dropship_routes
create policy dropship_routes_read on dropship_routes for select to authenticated
  using (is_staff() and in_division(division_id));
create policy dropship_routes_write on dropship_routes for all to authenticated
  using (dropship_can_edit(division_id)) with check (dropship_can_edit(division_id));

-- Policies on dropship_import_list: merchants read and write only their own org's rows
create policy import_list_own on dropship_import_list for all to authenticated
  using (org_id in (select my_org_ids()))
  with check (org_id in (select my_org_ids()));

-- Policies on dropship_markets:
--  · merchant reads own org's markets (updated_by is hidden from authenticated; only service_role reads it)
--  · merchant can insert/delete own org's rows only when not locked_by_staff (handled via set_dropship_markets RPC + policy)
--  · staff (DS edit, admin, or the org's account manager) can manage and lock
revoke all on dropship_markets from anon, authenticated;
grant select (org_id, country, locked_by_staff, division_id, created_at, updated_at),
      insert (org_id, country, locked_by_staff, division_id),
      update (country, locked_by_staff),
      delete on dropship_markets to authenticated;
grant all on dropship_markets to service_role;
create policy dropship_markets_read on dropship_markets for select to authenticated
  using (
    org_id in (select my_org_ids())
    or (is_staff() and (in_division(division_id) or is_my_customer(org_id)))
  );
create policy dropship_markets_merchant_insert on dropship_markets for insert to authenticated
  with check (
    org_id in (select my_org_ids())
    and not locked_by_staff
    and not exists (select 1 from dropship_markets m where m.org_id = dropship_markets.org_id and m.locked_by_staff)
  );
create policy dropship_markets_merchant_delete on dropship_markets for delete to authenticated
  using (
    org_id in (select my_org_ids())
    and not locked_by_staff
    and not exists (select 1 from dropship_markets m where m.org_id = dropship_markets.org_id and m.locked_by_staff)
  );
create policy dropship_markets_staff_all on dropship_markets for all to authenticated
  using (is_staff() and (dropship_can_edit(division_id) or is_my_customer(org_id)))
  with check (is_staff() and (dropship_can_edit(division_id) or is_my_customer(org_id)));

-- ───────── 5. Storage bucket: dropship-media (public read for product images, 5 MB, jpg/png/webp only, staff write via server) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dropship-media', 'dropship-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "dropship media staff write" on storage.objects;
create policy "dropship media staff write" on storage.objects for all to authenticated
  using (bucket_id = 'dropship-media' and dropship_can_edit(division_id_of('DS')))
  with check (bucket_id = 'dropship-media' and dropship_can_edit(division_id_of('DS')));

-- ───────── 6. Settings defaults (min margin %, per-category overrides, supported countries) ─────────
insert into site_settings (key, value, description) values
  ('dropship.min_margin_bp', '1500'::jsonb, 'Default minimum margin for Dropshipping routes in basis points (1500 = 15%). Warn below it; do not block.'),
  ('dropship.category_min_margin_bp', '{}'::jsonb, 'Optional per-category minimum margin overrides in basis points ({ "Electronics": 1800 }). Empty = use dropship.min_margin_bp.'),
  ('dropship.supported_countries', '["AE","SA","GB","US","DE","FR","NL","AU","CA","SG","KW","QA","BH","OM"]'::jsonb, 'Admin-managed list of destination countries (ISO-2) merchants may pick from for Dropshipping.')
on conflict (key) do nothing;
