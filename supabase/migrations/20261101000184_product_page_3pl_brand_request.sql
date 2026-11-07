-- ADDON-44-F — boards 24 (public product page), 25 (3PL request), 26 (Make My Brand request).
-- 1. public_suppliers gains `province` so the product page can say "Octopus verified factory · Guangdong" (no code shown).
-- 2. Private bucket `brand-logos` (own company folder; the account manager / staff with customers:view can read).
--    The app only ever hands out 10-minute signed links.
-- 3. brand_projects (MB-0001 …) created through create_brand_project(): verified products only, audit-logged,
--    the customer's primary account manager is notified (admins when no manager is assigned yet).

create or replace view public_suppliers as
  select id, code, country, verified, supplier_type, province from suppliers where archived_at is null;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('brand-logos', 'brand-logos', false, 20971520,
        array['image/svg+xml', 'application/pdf', 'image/png', 'application/postscript', 'application/illustrator', 'application/octet-stream'])
on conflict (id) do nothing;
drop policy if exists "brand logos upload own org" on storage.objects;
create policy "brand logos upload own org" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-logos' and (storage.foldername(name))[1] = my_org_id()::text);
drop policy if exists "brand logos read own org or manager" on storage.objects;
create policy "brand logos read own org or manager" on storage.objects for select to authenticated
  using (bucket_id = 'brand-logos' and ((storage.foldername(name))[1] = my_org_id()::text
         or staff_sees_org(((storage.foldername(name))[1])::uuid)));

create sequence if not exists brand_project_seq;
create table if not exists brand_projects (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  org_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  product_link text,
  quantity integer check (quantity is null or quantity > 0),
  markets text[] not null default '{}',
  method text check (method in ('pad', 'laser', 'uv', 'box', 'inserts', 'unsure')),
  packaging text check (packaging in ('standard', 'colour_box', 'gift_box', 'unsure')),
  colours text,
  logo_paths text[] not null default '{}',
  stock_destination text check (stock_destination in ('warehouse', 'bulk')),
  bulk_country char(2),
  stores text[] not null default '{}',
  note text,
  status text not null default 'submitted' check (status in ('submitted', 'proof', 'sample', 'quoted', 'production', 'stocked', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists brand_projects_org on brand_projects(org_id, created_at desc);
alter table brand_projects enable row level security;
revoke all on brand_projects from anon;
grant select on brand_projects to authenticated;
drop policy if exists brand_projects_read on brand_projects;
create policy brand_projects_read on brand_projects for select to authenticated
  using (org_id in (select my_org_ids()) or staff_sees_org(org_id));

create or replace function create_brand_project(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := my_org_id();
  v_product uuid := nullif(p->>'product_id', '')::uuid;
  v_ref text; v_id uuid; v_logos text[]; v_title text; v_notified int := 0;
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_A_CUSTOMER'; end if;
  if v_product is not null then
    select p2.title into v_title from products p2 join suppliers s on s.id = p2.supplier_id
     where p2.id = v_product and p2.status = 'live' and s.verified and s.archived_at is null;
    if v_title is null then raise exception 'PRODUCT_NOT_VERIFIED'; end if;
  elsif coalesce(btrim(p->>'product_link'), '') = '' then
    raise exception 'PRODUCT_REQUIRED';
  end if;
  select coalesce(array_agg(x), '{}') into v_logos from jsonb_array_elements_text(coalesce(p->'logo_paths', '[]')) x;
  if exists (select 1 from unnest(v_logos) l where split_part(l, '/', 1) <> v_org::text) then raise exception 'BAD_LOGO_PATH'; end if;
  if (p->>'stock_destination') = 'bulk' and coalesce(p->>'bulk_country', '') !~ '^[A-Z]{2}$' then raise exception 'BULK_COUNTRY_REQUIRED'; end if;

  v_ref := 'MB-' || lpad(nextval('brand_project_seq')::text, 4, '0');
  insert into brand_projects(ref, org_id, created_by, product_id, product_link, quantity, markets, method, packaging, colours, logo_paths, stock_destination, bulk_country, stores, note)
  values (v_ref, v_org, auth.uid(), v_product, nullif(left(btrim(p->>'product_link'), 500), ''), nullif(p->>'quantity', '')::int,
          coalesce((select array_agg(left(x, 2)) from jsonb_array_elements_text(coalesce(p->'markets', '[]')) x), '{}'),
          nullif(p->>'method', ''), nullif(p->>'packaging', ''), nullif(left(btrim(p->>'colours'), 300), ''), v_logos,
          nullif(p->>'stock_destination', ''), nullif(p->>'bulk_country', ''),
          coalesce((select array_agg(left(x, 30)) from jsonb_array_elements_text(coalesce(p->'stores', '[]')) x), '{}'),
          nullif(left(btrim(p->>'note'), 2000), ''))
  returning id into v_id;

  perform audit('brand_project.created', v_org, 'brand', 'brand_project', v_ref, null,
                jsonb_build_object('product_id', v_product, 'method', p->>'method', 'quantity', p->>'quantity', 'logos', coalesce(array_length(v_logos, 1), 0)));

  -- tell the customer's primary account manager; no manager yet → every admin
  insert into notifications(user_id, org_id, title, body, link, service)
  select u, v_org, 'New Make My Brand request ' || v_ref,
         coalesce(v_title, 'Product link') || coalesce(' · ' || (p->>'quantity') || ' units', ''), '/admin/customers/' || v_org, 'brand'
  from (select am.staff_user_id u from account_managers am where am.org_id = v_org and am.is_primary
        union select ur.user_id from user_roles ur where ur.role_code = 'admin'
              and not exists (select 1 from account_managers am2 where am2.org_id = v_org and am2.is_primary)) t;
  get diagnostics v_notified = row_count;

  return jsonb_build_object('id', v_id, 'ref', v_ref, 'notified', v_notified);
end $$;
revoke all on function create_brand_project(jsonb) from public, anon;
grant execute on function create_brand_project(jsonb) to authenticated;
