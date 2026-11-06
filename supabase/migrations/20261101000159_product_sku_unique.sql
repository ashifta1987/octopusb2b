-- ADDON-33: Product Id = SKU, unique across the whole platform and never reused; images with sha256 de-duplication.
-- products.external_id (ADDON-27/29 "Product Id") stays the single source of truth; products.sku / sku_norm are generated
-- from it so every route (bulk template, Bowijie workbook, single form, API) shares one rule set.

-- 1–4 · sku columns, format, platform-wide uniqueness (no WHERE clause → archived/soft-deleted rows keep their SKU)
update products set external_id = upper(btrim(external_id)) where external_id is distinct from upper(btrim(external_id));
alter table products alter column external_id set not null;
alter table products add column if not exists sku text generated always as (external_id) stored;
alter table products add column if not exists sku_norm text generated always as (upper(btrim(external_id))) stored;
do $$ begin
  alter table products add constraint products_sku_format check (sku_norm ~ '^[A-Z0-9][A-Z0-9._-]{2,39}$');
exception when duplicate_object then null; end $$;
create unique index if not exists products_sku_norm_key on products (sku_norm);
drop index if exists products_external_id_key;   -- superseded by products_sku_norm_key (covers every row)

-- 6 · reservations: a SKU stays taken even after the product row is hard-deleted
create table if not exists sku_reservations (
  sku_norm text primary key,
  product_id uuid not null,          -- no FK on purpose: survives deletion of the product
  supplier_id uuid,
  created_at timestamptz not null default now()
);
alter table sku_reservations enable row level security;   -- service role / triggers only
revoke all on sku_reservations from anon, authenticated;
insert into sku_reservations(sku_norm, product_id, supplier_id)
select sku_norm, id, supplier_id from products on conflict (sku_norm) do nothing;

-- new automatic ids (blank SKU on the single form / API) never land on a reserved SKU
create or replace function next_product_external_id(p_supplier uuid) returns text
language plpgsql security definer set search_path = public as $$
declare s suppliers; v_prefix text; v_n int;
begin
  select * into s from suppliers where id = p_supplier;
  if s.id is null then return null; end if;
  if s.external_id ~ '^[A-Z]{2}-[A-Z0-9]{2,3}-[A-Z0-9]{2,8}-' then
    v_prefix := array_to_string((string_to_array(s.external_id, '-'))[1:3], '-');
  else
    v_prefix := upper(coalesce(nullif(s.country, ''), 'XX')) || '-XX-' ||
                upper(coalesce(nullif(regexp_replace(coalesce(s.manufacturer_code, ''), '[^A-Za-z0-9]', '', 'g'), ''), 'S' || regexp_replace(s.code, '\D', '', 'g')));
  end if;
  select coalesce(max((substring(sku_norm from '-(\d{4})$'))::int), 0) + 1 into v_n
    from sku_reservations where sku_norm like v_prefix || '-%' and sku_norm ~ '-\d{4}$';
  loop
    exit when not exists (select 1 from sku_reservations where sku_norm = v_prefix || '-' || lpad(v_n::text, 4, '0'))
          and not exists (select 1 from products where sku_norm = v_prefix || '-' || lpad(v_n::text, 4, '0'));
    v_n := v_n + 1;
  end loop;
  return v_prefix || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke execute on function next_product_external_id(uuid) from public, anon, authenticated;

create or replace function assign_product_external_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.external_id is null or btrim(new.external_id) = '' then new.external_id := next_product_external_id(new.supplier_id);
  else new.external_id := upper(btrim(new.external_id)); end if;
  return new;
end $$;

-- 5 · guard: format, reservation check, immutability for non-admins, audit of every change
create or replace function guard_product_sku() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_norm text; v_owner uuid;
begin
  if tg_op = 'UPDATE' and new.external_id is not distinct from old.external_id then return new; end if;
  new.external_id := upper(btrim(new.external_id));
  v_norm := new.external_id;
  if v_norm !~ '^[A-Z0-9][A-Z0-9._-]{2,39}$' then
    raise exception 'SKU_FORMAT: SKU must be 3–40 characters: letters, digits, dash, dot or underscore, no spaces.';
  end if;
  if tg_op = 'UPDATE' and not (is_admin() or auth.uid() is null) then
    raise exception 'SKU_IMMUTABLE: The SKU of an existing product can only be changed by an Admin.';
  end if;
  select product_id into v_owner from sku_reservations where sku_norm = v_norm;
  if v_owner is not null and v_owner <> new.id then
    if exists (select 1 from products where id = v_owner) then
      raise exception 'SKU_TAKEN: SKU already used by another supplier.' using errcode = '23505';
    else
      raise exception 'SKU_RETIRED: This SKU was used before and cannot be reused.' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_sku_guard on products;
create trigger trg_sku_guard before insert or update of external_id on products for each row execute function guard_product_sku();

create or replace function reserve_product_sku() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into sku_reservations(sku_norm, product_id, supplier_id) values (new.sku_norm, new.id, new.supplier_id)
  on conflict (sku_norm) do nothing;
  if tg_op = 'UPDATE' and old.external_id is distinct from new.external_id then
    insert into audit_log(actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'product.sku_changed', 'products', new.id::text, jsonb_build_object('from', old.external_id, 'to', new.external_id));
  end if;
  return null;
end $$;
drop trigger if exists trg_sku_reserve on products;
create trigger trg_sku_reserve after insert or update of external_id on products for each row execute function reserve_product_sku();

-- 7 · images: product_media gains storage path, original file name and sha256 (same photo never stored twice per product)
alter table product_media add column if not exists storage_path text;
alter table product_media add column if not exists source_file_name text;
alter table product_media add column if not exists sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
alter table product_media add column if not exists created_at timestamptz not null default now();
create unique index if not exists product_media_product_sha_key on product_media(product_id, sha256) where sha256 is not null;
create or replace view product_images with (security_invoker = true) as
  select id, product_id, storage_path, sort as position, source_file_name, sha256, url, created_at from product_media;

-- availability lookup for the import preview / "Generate SKUs" (service role; callers never learn who owns a SKU)
create or replace function sku_status(p_skus text[]) returns table(sku text, product_id uuid, supplier_id uuid, state text)
language sql stable security definer set search_path = public as $$
  select n.s, p.id, p.supplier_id,
         case when p.id is not null then 'exists' when r.sku_norm is not null then 'retired' else 'free' end
  from unnest(p_skus) as n(s)
  left join products p on p.sku_norm = upper(btrim(n.s))
  left join sku_reservations r on r.sku_norm = upper(btrim(n.s))
$$;
revoke execute on function sku_status(text[]) from public, anon, authenticated;
grant execute on function sku_status(text[]) to service_role;

create or replace function skus_with_prefix(p_prefix text) returns setof text
language sql stable security definer set search_path = public as $$
  select sku_norm from sku_reservations where sku_norm like upper(p_prefix) || '-%'
$$;
revoke execute on function skus_with_prefix(text) from public, anon, authenticated;
grant execute on function skus_with_prefix(text) to service_role;

-- one product per transaction from the bulk template (runs with the caller's rights → RLS applies)
create or replace function import_product_row(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_img jsonb; v_cur text := coalesce(p->>'currency', 'USD'); v_min bigint;
begin
  select min((t->>'unit_price_cents')::bigint) into v_min from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;
  if (p->>'mode') = 'update' then
    update products set title = p->>'title', category_id = nullif(p->>'category_id','')::uuid, unit = coalesce(p->>'unit','pcs'),
      moq = coalesce((p->>'moq')::int, 1), lead_time_days = (p->>'lead_time_days')::int, incoterm = p->>'incoterm', origin_country = p->>'origin_country',
      hs_code = p->>'hs_code', currency = v_cur, octopus_dropship = coalesce((p->>'octopus_dropship')::boolean, false),
      ready_to_ship = coalesce((p->>'ready_to_ship')::boolean, false), description = p->>'description', min_price_cents = v_min
    where id = (p->>'product_id')::uuid and supplier_id = (p->>'supplier_id')::uuid
    returning id into v_id;
    if v_id is null then raise exception 'NOT_EDITABLE: You cannot edit this product.'; end if;
  else
    insert into products(external_id, slug, title, description, supplier_id, category_id, status, unit, moq, lead_time_days, incoterm,
      origin_country, hs_code, octopus_dropship, ready_to_ship, currency, min_price_cents, created_by, seo_title)
    values (p->>'sku', p->>'slug', p->>'title', p->>'description', (p->>'supplier_id')::uuid, nullif(p->>'category_id','')::uuid, 'draft',
      coalesce(p->>'unit','pcs'), coalesce((p->>'moq')::int, 1), (p->>'lead_time_days')::int, p->>'incoterm', p->>'origin_country', p->>'hs_code',
      coalesce((p->>'octopus_dropship')::boolean, false), coalesce((p->>'ready_to_ship')::boolean, false), v_cur, v_min, auth.uid(),
      left(p->>'title' || ' | Wholesale', 60))
    returning id into v_id;
  end if;
  delete from price_tiers where product_id = v_id;
  insert into price_tiers(product_id, min_qty, unit_price_cents, currency)
  select v_id, (t->>'min_qty')::int, (t->>'unit_price_cents')::bigint, v_cur from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;
  for v_img in select * from jsonb_array_elements(coalesce(p->'images', '[]')) loop
    delete from product_media where product_id = v_id and (sort = (v_img->>'position')::int or sha256 = v_img->>'sha256');
    insert into product_media(product_id, url, kind, sort, storage_path, source_file_name, sha256)
    values (v_id, v_img->>'url', 'image', (v_img->>'position')::int, v_img->>'storage_path', v_img->>'source_file_name', v_img->>'sha256');
  end loop;
  update products set image_url = (select url from product_media where product_id = v_id order by sort limit 1) where id = v_id;
  return v_id;
end $$;
grant execute on function import_product_row(jsonb) to authenticated;

