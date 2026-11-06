-- ADDON-27 (6 Nov 2026): multi-supplier products, tiered supplier prices, bulk importer.
-- Adapted to the existing schema (owner-approved): suppliers/products keep their uuid ids and OCT- codes; the
-- supplier's / importer's external ids (e.g. CN-GD-BWJ-0010, CN-GD-BWJ-F8) become unique `external_id` columns.
-- Supplier prices are COSTS (EXW/FOB). Buyer prices stay in price_tiers and are derived from the preferred
-- supplier's cost × (1 + markup) (site setting pricing.default_markup_pct, per-product override) — owner decision.

-- ───────── suppliers: identity + external id ─────────
alter table suppliers
  add column if not exists external_id text,
  add column if not exists manufacturer_code text,
  add column if not exists province text,
  add column if not exists handle text,
  add column if not exists identity_status text not null default 'ok'
    check (identity_status in ('ok', 'needs_identity_review', 'blocked')),
  add column if not exists notes text;
create unique index if not exists suppliers_external_id_key on suppliers (external_id) where external_id is not null;

create table if not exists supplier_name_variants (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  variant_name text not null,
  variant_address text,
  seen_in text,
  is_canonical boolean not null default false,
  created_at timestamptz not null default now(),
  unique (supplier_id, variant_name)
);
create unique index if not exists supplier_name_variants_one_canonical on supplier_name_variants (supplier_id) where is_canonical;

create table if not exists supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  name text not null,
  role text, phone text, wechat text, email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (supplier_id, name)
);

-- ───────── products: external id + raw supplier data ─────────
alter table products
  add column if not exists external_id text,
  add column if not exists factory_model text,
  add column if not exists specification_raw text,
  add column if not exists selling_points_raw text,
  add column if not exists net_weight text,
  add column if not exists product_size_mm text,
  add column if not exists size_notes text,
  add column if not exists colour_box_mm text,
  add column if not exists carton_size_mm text,
  add column if not exists qty_per_carton text,
  add column if not exists gross_weight text,
  add column if not exists listing_status text not null default 'draft'
    check (listing_status in ('draft', 'published', 'needs_quote', 'in_development', 'needs_review')),
  add column if not exists import_notes text,
  add column if not exists markup_pct numeric(6,2) check (markup_pct is null or (markup_pct >= 0 and markup_pct <= 1000)),
  add column if not exists sell_price_mode text not null default 'markup' check (sell_price_mode in ('markup', 'manual'));
create unique index if not exists products_external_id_key on products (external_id) where external_id is not null;

-- ───────── supplier ↔ product, and tiered supplier prices (costs) ─────────
create table if not exists supplier_products (
  supplier_id uuid not null references suppliers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  supplier_model text,
  moq int,
  exclusive_channels text,
  exclusivity_flag text,
  status text not null default 'quoted' check (status in ('quoted', 'needs_quote', 'in_development', 'no_price', 'withdrawn')),
  is_preferred boolean not null default false,
  lead_time_days int,
  moq_notes text,
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, product_id)
);
create unique index if not exists supplier_products_one_preferred on supplier_products (product_id) where is_preferred;
create index if not exists supplier_products_product_idx on supplier_products (product_id);

create table if not exists supplier_product_prices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null,
  product_id uuid not null,
  incoterm text not null check (incoterm in ('EXW', 'FOB', 'CIF', 'DDP', 'FCA', 'CFR')),
  moq_tier_min int not null check (moq_tier_min > 0),
  variant_label text not null default '',
  price_minor bigint not null check (price_minor >= 0),     -- price × 10000 (4-dp precision, e.g. 12.208 → 122080)
  currency text not null default 'USD' check (currency in ('USD', 'CNY')),
  valid_from date not null,
  valid_to date,
  is_superseded boolean not null default false,
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (supplier_id, product_id) references supplier_products(supplier_id, product_id) on delete cascade,
  unique (supplier_id, product_id, incoterm, moq_tier_min, variant_label, valid_from)
);
create index if not exists spp_product_idx on supplier_product_prices (product_id) where not is_superseded;

-- ───────── import runs + review queue ─────────
create table if not exists import_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'failed', 'discarded')),
  source jsonb not null default '{}',     -- {xlsx_path, images_path, files: [...]}
  staging jsonb not null,                 -- parsed batch (suppliers, products, prices, images, review)
  diff jsonb not null default '{}',       -- create/update/skip counts per table
  report jsonb,                           -- commit report
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table if not exists import_review_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references import_runs(id) on delete set null,
  product_id uuid references products(id) on delete cascade,
  external_id text not null,
  kind text not null default 'note' check (kind in ('note', 'outlier', 'needs_quote', 'in_development', 'identity')),
  issue text not null,
  evidence text,
  status text not null default 'open' check (status in ('open', 'accepted_quote', 'accepted_dashboard', 'resolved', 'held')),
  decision_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (external_id, issue)
);
create index if not exists import_review_open_idx on import_review_items (product_id) where status in ('open', 'held');

-- ───────── settings ─────────
insert into site_settings(key, value, description) values
  ('import.price_validity_default_days', '30', 'Bulk import: days a supplier quote stays valid when the file gives no end date.'),
  ('import.outlier_threshold_median_x', '3', 'Bulk import: a price above this multiple of its sheet median is flagged for review.'),
  ('import.images.max_bytes_each', '15000000', 'Bulk import: maximum size of one product image (bytes).'),
  ('import.images.max_total_bytes', '500000000', 'Bulk import: maximum total size of an image ZIP (bytes).'),
  ('pricing.default_markup_pct', '25', 'Buyer price = supplier cost × (1 + markup %). Per-product override on the product. Owner can change this.')
on conflict (key) do nothing;

-- private bucket for uploaded import files (XLSX + ZIP) — product photos still go to the public product-media bucket
insert into storage.buckets (id, name, public) values ('imports', 'imports', false) on conflict (id) do nothing;

-- ───────── RLS ─────────
alter table supplier_name_variants enable row level security;
alter table supplier_contacts enable row level security;
alter table supplier_products enable row level security;
alter table supplier_product_prices enable row level security;
alter table import_runs enable row level security;
alter table import_review_items enable row level security;

drop policy if exists snv_staff on supplier_name_variants;
create policy snv_staff on supplier_name_variants for select to authenticated using (can('suppliers', 'view') or is_my_supplier(supplier_id));
drop policy if exists sc_staff on supplier_contacts;
create policy sc_staff on supplier_contacts for select to authenticated using (can('suppliers', 'view') or is_my_supplier(supplier_id));
-- costs: admin / finance / sourcing (requests) staff and the supplier itself; never customers
drop policy if exists sp_staff on supplier_products;
create policy sp_staff on supplier_products for select to authenticated
  using (can('products', 'view') or can('finance', 'view') or can('requests', 'view') or is_my_supplier(supplier_id));
drop policy if exists spp_staff on supplier_product_prices;
create policy spp_staff on supplier_product_prices for select to authenticated
  using (can('finance', 'view') or can('requests', 'view') or can('products', 'approve') or is_my_supplier(supplier_id));
drop policy if exists ir_staff on import_runs;
create policy ir_staff on import_runs for select to authenticated using (can('products', 'edit'));
drop policy if exists iri_staff on import_review_items;
create policy iri_staff on import_review_items for select to authenticated using (can('products', 'view'));
-- writes go through the security-definer RPCs below (no write policies)
revoke insert, update, delete on supplier_name_variants, supplier_contacts, supplier_products, supplier_product_prices,
  import_runs, import_review_items from anon, authenticated;
grant select on supplier_name_variants, supplier_contacts, supplier_products, supplier_product_prices,
  import_runs, import_review_items to authenticated;

-- ───────── buyer prices from supplier costs ─────────
-- price_tiers (what buyers see) = preferred supplier's current cost per MOQ tier (cheapest variant, cheapest incoterm
-- row) × (1 + markup), rounded up to the cent. Skipped when the product is in 'manual' price mode.
create or replace function recompute_sell_prices(p_product uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_mode text; v_markup numeric; v_default numeric; v_sup uuid; n int := 0; v_cur text;
begin
  select sell_price_mode, markup_pct into v_mode, v_markup from products where id = p_product;
  if v_mode is null or v_mode = 'manual' then return 0; end if;
  select coalesce((value #>> '{}')::numeric, 25) into v_default from site_settings where key = 'pricing.default_markup_pct';
  v_markup := coalesce(v_markup, v_default, 25);
  select supplier_id into v_sup from supplier_products where product_id = p_product order by is_preferred desc, created_at limit 1;
  if v_sup is null then return 0; end if;
  delete from price_tiers where product_id = p_product;
  for v_cur in select distinct currency from supplier_product_prices where product_id = p_product and supplier_id = v_sup and not is_superseded loop
    insert into price_tiers(product_id, min_qty, unit_price_cents, currency)
    select p_product, moq_tier_min, ceil(min(price_minor) * (1 + v_markup / 100.0) / 100.0)::bigint, v_cur
      from supplier_product_prices
     where product_id = p_product and supplier_id = v_sup and not is_superseded and currency = v_cur
       and (valid_to is null or valid_to >= current_date - 365)
     group by moq_tier_min;
    get diagnostics n = row_count;
  end loop;
  update products p set
    min_price_cents = (select min(unit_price_cents) from price_tiers t where t.product_id = p_product),
    moq = coalesce((select min(min_qty) from price_tiers t where t.product_id = p_product), p.moq),
    currency = coalesce((select currency from price_tiers t where t.product_id = p_product limit 1), p.currency)
   where id = p_product;
  insert into product_costs(product_id, supplier_cost_cents)
    select p_product, ceil(min(price_minor) / 100.0)::bigint from supplier_product_prices
     where product_id = p_product and supplier_id = v_sup and not is_superseded
    having count(*) > 0
  on conflict (product_id) do update set supplier_cost_cents = excluded.supplier_cost_cents;
  return n;
end $$;
revoke execute on function recompute_sell_prices(uuid) from public, anon, authenticated;

-- ───────── publish gate ─────────
-- An imported product cannot go to moderation / live while its supplier's identity is unresolved, while review items
-- are open or held, or while it has no buyer price.
create or replace function guard_import_publish() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if new.status not in ('submitted', 'in_review', 'live') or new.status is not distinct from old.status then return new; end if;
  if new.external_id is null then return new; end if;
  if exists (select 1 from suppliers s join supplier_products sp on sp.supplier_id = s.id
              where sp.product_id = new.id and s.identity_status <> 'ok') then
    v_reason := 'the supplier has unresolved legal-name variants — pick the canonical name in Admin → Suppliers';
  elsif exists (select 1 from import_review_items where product_id = new.id and status in ('open', 'held')) then
    v_reason := 'it has open import review items — resolve them in Admin → Bulk import → Review';
  elsif new.listing_status in ('needs_quote', 'in_development') then
    v_reason := 'the supplier has not quoted a price yet';
  elsif not exists (select 1 from price_tiers where product_id = new.id) then
    v_reason := 'it has no buyer price';
  end if;
  if v_reason is not null then
    raise exception 'IMPORT_PUBLISH_BLOCKED: % cannot be published: %', coalesce(new.external_id, new.title), v_reason using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_import_publish on products;
create trigger trg_guard_import_publish before update of status on products
  for each row execute function guard_import_publish();

-- ───────── commit an import run (one transaction; images are uploaded by the caller first) ─────────
-- staging shape: {supplier:{external_id,...,name_variants:[...],contacts:[...]}, products:[...], prices:[...],
--                 images:[{external_id,file,url,sort}], review:[...], valid_from, valid_to}
create or replace function commit_import_run(p_run uuid, p_actor uuid default null, p_canonical text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r import_runs; s jsonb; v_sup uuid; v_sup_ext text; v jsonb; v_pid uuid; v_cat uuid; v_slug text; v_old products;
  c jsonb := jsonb_build_object('suppliers', jsonb_build_object('create',0,'update',0,'skip',0),
    'products', jsonb_build_object('create',0,'update',0,'skip',0), 'supplier_products', jsonb_build_object('create',0,'update',0,'skip',0),
    'prices', jsonb_build_object('create',0,'update',0,'skip',0,'superseded',0), 'images', jsonb_build_object('create',0,'skip',0),
    'specs', jsonb_build_object('create',0), 'review', jsonb_build_object('create',0,'skip',0));
  n int; v_price record; v_existing supplier_product_prices; v_touched uuid[] := '{}';
begin
  if p_actor is not null and not exists (select 1 from user_roles where user_id = p_actor) then raise exception 'FORBIDDEN'; end if;
  if auth.uid() is not null and not can('products', 'edit') then raise exception 'FORBIDDEN'; end if;
  select * into r from import_runs where id = p_run for update;
  if r.id is null then raise exception 'IMPORT_NOT_FOUND'; end if;
  if r.status = 'committed' then return r.report; end if;
  s := r.staging;

  -- supplier
  v_sup_ext := s #>> '{supplier,external_id}';
  select id into v_sup from suppliers where external_id = v_sup_ext;
  if v_sup is null then
    insert into suppliers(legal_name, country, city, contact_name, contact_email, contact_phone, verified, external_id, manufacturer_code,
                          province, handle, identity_status, notes, supplier_type)
    values (coalesce(nullif(p_canonical, ''), s #>> '{supplier,legal_name}'), s #>> '{supplier,country}', s #>> '{supplier,city}',
            s #>> '{supplier,contact_name}', s #>> '{supplier,contact_email}', s #>> '{supplier,contact_phone}', false, v_sup_ext,
            s #>> '{supplier,manufacturer_code}', s #>> '{supplier,province}', s #>> '{supplier,handle}',
            coalesce(s #>> '{supplier,status}', 'ok'), s #>> '{supplier,notes}', 'manufacturer')
    returning id into v_sup;
    c := jsonb_set(c, '{suppliers,create}', to_jsonb(1));
  else
    -- legal_name never changes from an import unless the admin picked a canonical name
    update suppliers set manufacturer_code = coalesce(s #>> '{supplier,manufacturer_code}', manufacturer_code),
           province = coalesce(s #>> '{supplier,province}', province), handle = coalesce(s #>> '{supplier,handle}', handle),
           contact_name = coalesce(s #>> '{supplier,contact_name}', contact_name), contact_email = coalesce(s #>> '{supplier,contact_email}', contact_email),
           contact_phone = coalesce(s #>> '{supplier,contact_phone}', contact_phone)
     where id = v_sup and (manufacturer_code, province, handle, contact_name, contact_email, contact_phone) is distinct from
       (coalesce(s #>> '{supplier,manufacturer_code}', manufacturer_code), coalesce(s #>> '{supplier,province}', province), coalesce(s #>> '{supplier,handle}', handle),
        coalesce(s #>> '{supplier,contact_name}', contact_name), coalesce(s #>> '{supplier,contact_email}', contact_email), coalesce(s #>> '{supplier,contact_phone}', contact_phone));
    get diagnostics n = row_count;
    c := jsonb_set(c, case when n > 0 then '{suppliers,update}' else '{suppliers,skip}' end::text[], to_jsonb(1));
  end if;
  insert into supplier_switches(supplier_id) values (v_sup) on conflict do nothing;
  for v in select * from jsonb_array_elements(coalesce(s #> '{supplier,name_variants}', '[]')) loop
    insert into supplier_name_variants(supplier_id, variant_name, variant_address, seen_in, is_canonical)
    values (v_sup, v->>'variant_name', v->>'variant_address', v->>'seen_in', false)
    on conflict (supplier_id, variant_name) do update set variant_address = excluded.variant_address, seen_in = excluded.seen_in;
  end loop;
  for v in select * from jsonb_array_elements(coalesce(s #> '{supplier,contacts}', '[]')) loop
    insert into supplier_contacts(supplier_id, name, role, phone, wechat, email, is_primary)
    values (v_sup, v->>'name', v->>'role', v->>'phone', v->>'wechat', v->>'email', coalesce((v->>'is_primary')::boolean, false))
    on conflict (supplier_id, name) do update set role = excluded.role, phone = excluded.phone, wechat = excluded.wechat,
      email = excluded.email, is_primary = excluded.is_primary;
  end loop;

  -- products (always drafts; an existing live product keeps its status)
  for v in select * from jsonb_array_elements(coalesce(s->'products', '[]')) loop
    v_cat := null;
    if coalesce(v->>'category', '') <> '' then
      select id into v_cat from categories where lower(name) = lower(v->>'category') order by level limit 1;
      if v_cat is null then
        insert into categories(name, slug, level, sort, active)
        values (v->>'category', regexp_replace(lower(v->>'category'), '[^a-z0-9]+', '-', 'g'), 0, 100, false)
        on conflict (slug) do update set name = categories.name returning id into v_cat;
      end if;
    end if;
    select * into v_old from products where external_id = v->>'external_id';
    if v_old.id is null then
      v_slug := left(regexp_replace(lower(coalesce(nullif(v->>'name', ''), v->>'factory_model', v->>'external_id') || ' ' || (v->>'external_id')), '[^a-z0-9]+', '-', 'g'), 90);
      v_slug := trim(both '-' from v_slug);
      insert into products(slug, title, supplier_id, category_id, status, unit, moq, incoterm, origin_country, currency, external_id,
             factory_model, specification_raw, selling_points_raw, net_weight, product_size_mm, size_notes, colour_box_mm, carton_size_mm,
             qty_per_carton, gross_weight, listing_status, import_notes, created_by)
      values (v_slug, coalesce(nullif(v->>'name', ''), v->>'factory_model', v->>'external_id'), v_sup, v_cat, 'draft', 'pcs',
             nullif(v->>'moq', '')::int, v->>'incoterm', 'CN', 'USD', v->>'external_id', v->>'factory_model', v->>'specification_raw',
             v->>'selling_points_raw', v->>'net_weight', v->>'product_size_mm', v->>'size_notes', v->>'colour_box_mm', v->>'carton_size_mm',
             v->>'qty_per_carton', v->>'gross_weight', coalesce(v->>'listing_status', 'draft'), v->>'notes', p_actor)
      returning id into v_pid;
      c := jsonb_set(c, '{products,create}', to_jsonb((c #>> '{products,create}')::int + 1));
    else
      v_pid := v_old.id;
      update products set factory_model = v->>'factory_model', specification_raw = v->>'specification_raw',
             selling_points_raw = v->>'selling_points_raw', net_weight = v->>'net_weight', product_size_mm = v->>'product_size_mm',
             size_notes = v->>'size_notes', colour_box_mm = v->>'colour_box_mm', carton_size_mm = v->>'carton_size_mm',
             qty_per_carton = v->>'qty_per_carton', gross_weight = v->>'gross_weight', incoterm = coalesce(v->>'incoterm', incoterm),
             category_id = coalesce(v_cat, category_id), listing_status = coalesce(v->>'listing_status', listing_status),
             import_notes = v->>'notes',
             -- a verified name in the file replaces the title; a blank name never overwrites good copy (README rule)
             title = coalesce(nullif(v->>'name', ''), title), updated_at = now()
       where id = v_pid and (factory_model, specification_raw, selling_points_raw, net_weight, product_size_mm, size_notes, colour_box_mm,
             carton_size_mm, qty_per_carton, gross_weight, incoterm, category_id, listing_status, import_notes, title)
             is distinct from (v->>'factory_model', v->>'specification_raw', v->>'selling_points_raw', v->>'net_weight', v->>'product_size_mm',
             v->>'size_notes', v->>'colour_box_mm', v->>'carton_size_mm', v->>'qty_per_carton', v->>'gross_weight', coalesce(v->>'incoterm', incoterm),
             coalesce(v_cat, category_id), coalesce(v->>'listing_status', listing_status), v->>'notes', coalesce(nullif(v->>'name', ''), title));
      get diagnostics n = row_count;
      c := jsonb_set(c, case when n > 0 then '{products,update}' else '{products,skip}' end::text[],
             to_jsonb((c #>> (case when n > 0 then '{products,update}' else '{products,skip}' end)::text[])::int + 1));
    end if;
    -- parsed specs (raw text stays authoritative on the product)
    delete from product_specs where product_id = v_pid;
    insert into product_specs(product_id, name, value, sort)
      select v_pid, x->>'key', x->>'value', (x->>'sort')::int from jsonb_array_elements(coalesce(v->'specs', '[]')) x;
    get diagnostics n = row_count;
    c := jsonb_set(c, '{specs,create}', to_jsonb((c #>> '{specs,create}')::int + n));

    -- supplier ↔ product (a second supplier adds a row; never overwrites another supplier's row)
    insert into supplier_products(supplier_id, product_id, supplier_model, moq, exclusive_channels, exclusivity_flag, status, is_preferred)
    values (v_sup, v_pid, v->>'supplier_model', nullif(v->>'moq', '')::int, nullif(v->>'exclusive_channels', ''), nullif(v->>'exclusivity_flag', ''),
            coalesce(v->>'supplier_status', 'quoted'), not exists (select 1 from supplier_products where product_id = v_pid))
    on conflict (supplier_id, product_id) do nothing;
    get diagnostics n = row_count;
    if n > 0 then c := jsonb_set(c, '{supplier_products,create}', to_jsonb((c #>> '{supplier_products,create}')::int + 1));
    else
      update supplier_products set supplier_model = v->>'supplier_model', moq = nullif(v->>'moq', '')::int,
             exclusive_channels = nullif(v->>'exclusive_channels', ''), exclusivity_flag = nullif(v->>'exclusivity_flag', ''),
             status = coalesce(v->>'supplier_status', 'quoted'), updated_at = now()
       where supplier_id = v_sup and product_id = v_pid
         and (supplier_model, moq, exclusive_channels, exclusivity_flag, status) is distinct from
             (v->>'supplier_model', nullif(v->>'moq', '')::int, nullif(v->>'exclusive_channels', ''), nullif(v->>'exclusivity_flag', ''), coalesce(v->>'supplier_status', 'quoted'));
      get diagnostics n = row_count;
      c := jsonb_set(c, case when n > 0 then '{supplier_products,update}' else '{supplier_products,skip}' end::text[],
             to_jsonb((c #>> (case when n > 0 then '{supplier_products,update}' else '{supplier_products,skip}' end)::text[])::int + 1));
    end if;
    v_touched := v_touched || v_pid;
  end loop;

  -- prices: same key + same price → skip; same key, different price → update; new valid_from → insert and supersede older rows
  for v_price in
    select p.id pid, x->>'incoterm' incoterm, (x->>'moq_tier_min')::int moq, coalesce(x->>'variant_label', '') variant,
           (x->>'price_minor')::bigint price, coalesce(x->>'currency', 'USD') cur, (x->>'valid_from')::date vf, nullif(x->>'valid_to', '')::date vt
      from jsonb_array_elements(coalesce(s->'prices', '[]')) x join products p on p.external_id = x->>'external_id'
  loop
    select * into v_existing from supplier_product_prices
     where supplier_id = v_sup and product_id = v_price.pid and incoterm = v_price.incoterm and moq_tier_min = v_price.moq
       and variant_label = v_price.variant and valid_from = v_price.vf;
    if v_existing.id is null then
      update supplier_product_prices set is_superseded = true
       where supplier_id = v_sup and product_id = v_price.pid and incoterm = v_price.incoterm and moq_tier_min = v_price.moq
         and variant_label = v_price.variant and valid_from < v_price.vf and not is_superseded;
      get diagnostics n = row_count;
      c := jsonb_set(c, '{prices,superseded}', to_jsonb((c #>> '{prices,superseded}')::int + n));
      insert into supplier_product_prices(supplier_id, product_id, incoterm, moq_tier_min, variant_label, price_minor, currency, valid_from, valid_to)
      values (v_sup, v_price.pid, v_price.incoterm, v_price.moq, v_price.variant, v_price.price, v_price.cur, v_price.vf, v_price.vt);
      c := jsonb_set(c, '{prices,create}', to_jsonb((c #>> '{prices,create}')::int + 1));
    elsif v_existing.price_minor <> v_price.price or v_existing.currency <> v_price.cur or v_existing.valid_to is distinct from v_price.vt then
      update supplier_product_prices set price_minor = v_price.price, currency = v_price.cur, valid_to = v_price.vt where id = v_existing.id;
      c := jsonb_set(c, '{prices,update}', to_jsonb((c #>> '{prices,update}')::int + 1));
    else
      c := jsonb_set(c, '{prices,skip}', to_jsonb((c #>> '{prices,skip}')::int + 1));
    end if;
  end loop;

  -- images (already uploaded to product-media by the caller; here only the rows)
  for v in select * from jsonb_array_elements(coalesce(s->'images', '[]')) loop
    select id into v_pid from products where external_id = v->>'external_id';
    if v_pid is null or coalesce(v->>'url', '') = '' then continue; end if;
    if exists (select 1 from product_media where product_id = v_pid and url = v->>'url') then
      c := jsonb_set(c, '{images,skip}', to_jsonb((c #>> '{images,skip}')::int + 1));
    else
      insert into product_media(product_id, url, kind, sort, alt) values (v_pid, v->>'url', 'image', coalesce((v->>'sort')::int, 1), v->>'alt');
      update products set image_url = coalesce(image_url, v->>'url') where id = v_pid;
      c := jsonb_set(c, '{images,create}', to_jsonb((c #>> '{images,create}')::int + 1));
    end if;
  end loop;

  -- review queue
  for v in select * from jsonb_array_elements(coalesce(s->'review', '[]')) loop
    insert into import_review_items(run_id, product_id, external_id, kind, issue, evidence)
    values (p_run, (select id from products where external_id = v->>'external_id'), v->>'external_id', coalesce(v->>'kind', 'note'), v->>'issue', v->>'evidence')
    on conflict (external_id, issue) do nothing;
    get diagnostics n = row_count;
    c := jsonb_set(c, case when n > 0 then '{review,create}' else '{review,skip}' end::text[],
           to_jsonb((c #>> (case when n > 0 then '{review,create}' else '{review,skip}' end)::text[])::int + 1));
  end loop;

  -- buyer prices for every product touched
  perform recompute_sell_prices(x) from unnest(v_touched) x;

  update import_runs set status = 'committed', committed_at = now(), report = c where id = p_run;
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (coalesce(auth.uid(), p_actor), 'bulk_import_committed', 'import_runs', p_run::text, jsonb_build_object('name', r.name, 'counts', c, 'supplier', v_sup_ext));
  return c;
end $$;
revoke execute on function commit_import_run(uuid, uuid, text) from public, anon, authenticated;
grant execute on function commit_import_run(uuid, uuid, text) to authenticated;

-- ───────── supplier identity: pick the canonical legal name ─────────
create or replace function set_supplier_canonical_name(p_supplier uuid, p_variant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v supplier_name_variants;
begin
  if not can('suppliers', 'edit') then raise exception 'FORBIDDEN'; end if;
  select * into v from supplier_name_variants where id = p_variant and supplier_id = p_supplier;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  update supplier_name_variants set is_canonical = false where supplier_id = p_supplier and is_canonical;
  update supplier_name_variants set is_canonical = true where id = p_variant;
  update suppliers set legal_name = v.variant_name, identity_status = 'ok' where id = p_supplier;
  perform write_audit('supplier.canonical_name_set', 'suppliers', p_supplier::text, jsonb_build_object('name', v.variant_name, 'address', v.variant_address));
end $$;
revoke execute on function set_supplier_canonical_name(uuid, uuid) from public, anon;
grant execute on function set_supplier_canonical_name(uuid, uuid) to authenticated;

-- ───────── review decisions ─────────
create or replace function decide_import_review(p_item uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can('products', 'edit') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('accepted_quote', 'accepted_dashboard', 'resolved', 'held', 'open') then raise exception 'INVALID_STATUS'; end if;
  update import_review_items set status = p_status, decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
   where id = p_item;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform write_audit('import.review_decided', 'import_review_items', p_item::text, jsonb_build_object('status', p_status, 'note', p_note));
end $$;
revoke execute on function decide_import_review(uuid, text, text) from public, anon;
grant execute on function decide_import_review(uuid, text, text) to authenticated;

-- ───────── manual price override per product ─────────
create or replace function set_product_pricing(p_product uuid, p_mode text, p_markup numeric default null) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not (can('products', 'edit') and (is_admin() or can('products', 'approve'))) then raise exception 'FORBIDDEN'; end if;
  if p_mode not in ('markup', 'manual') then raise exception 'INVALID_MODE'; end if;
  update products set sell_price_mode = p_mode, markup_pct = p_markup where id = p_product;
  perform write_audit('product.pricing_set', 'products', p_product::text, jsonb_build_object('mode', p_mode, 'markup_pct', p_markup));
  return recompute_sell_prices(p_product);
end $$;
revoke execute on function set_product_pricing(uuid, text, numeric) from public, anon;
grant execute on function set_product_pricing(uuid, text, numeric) to authenticated;
