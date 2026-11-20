-- Item 3 (change request v2, 8 Nov 2026): a distributor may read and change ONLY the products of the suppliers assigned
-- to them (distributor_suppliers) — enforced in the database, not only in the screen query.
--
-- Root cause: products_public (`status = 'live' … for select to public`) and product_visible() (child tables) applied to
-- every role, so a distributor's session read every live product of every supplier (all 55 columns) straight through the
-- REST API. product_editable() and transition_product() / withdraw_from_moderation() accepted `can('products','edit')`,
-- which distributors hold globally, so child rows and status moves of OTHER suppliers' products were writable too.
-- Storage: 'certificates' was open to anyone with products:create; 'product-media' could be listed by anyone and written
-- into any supplier's folder.
--
-- Admins, staff with products:view / products:edit (no distributor role), buyers and anonymous visitors keep exactly the
-- access they had. Down migration: supabase/migrations/down/20261101000186_distributor_product_scope.down.sql

-- ── helper: is the caller a distributor without platform-wide product rights? ──
-- Deliberately WITHOUT the aal2 requirement of has_role()/can(): a distributor on an aal1 session must not fall back to
-- the public policy either. Admins and roles with products:view are never restricted.
create or replace function distributor_restricted() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from user_roles where user_id = auth.uid() and role_code = 'distributor')
     and not exists (select 1 from user_roles where user_id = auth.uid() and role_code = 'admin')
     and not exists (select 1 from user_roles ur join role_permissions rp on rp.role_code = ur.role_code
                     where ur.user_id = auth.uid() and rp.area = 'products' and rp.action = 'view');
$$;
revoke execute on function distributor_restricted() from public;
grant execute on function distributor_restricted() to anon, authenticated, service_role;

-- "a text that may be a uuid" → uuid or null (storage folder names)
create or replace function try_uuid(p text) returns uuid
language sql immutable set search_path = public as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

-- ── products: the public (storefront) policy no longer applies to restricted distributors ──
drop policy if exists products_public on products;
create policy products_public on products for select
  using (status = 'live' and archived_at is null and supplier_listings_live(supplier_id) and not (select distributor_restricted()));

-- ── child tables (price_tiers, product_media, product_specs, product_tags, product_certificates) ──
create or replace function product_visible(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from products where id = p and (
    (status = 'live' and archived_at is null and not distributor_restricted())
    or can('products','view') or is_my_supplier(supplier_id)));
$$;

create or replace function product_editable(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from products where id = p and (
    (can('products','edit') and not distributor_restricted()) or is_my_supplier(supplier_id)));
$$;

-- ── status moves: a distributor only for assigned suppliers ──
create or replace function public.transition_product(p_product uuid, p_to product_status, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare p record; ok boolean;
begin
  select * into p from products where id = p_product for update;
  if p is null then raise exception 'NOT_FOUND'; end if;
  if p_to in ('live','rejected','in_review') then
    if not can('products','approve') then raise exception 'FORBIDDEN'; end if;
  elsif not ((can('products','edit') and not distributor_restricted()) or is_my_supplier(p.supplier_id)) then raise exception 'FORBIDDEN';
  end if;
  ok := (p.status, p_to) in (('draft','submitted'),('rejected','submitted'),('submitted','in_review'),('submitted','live'),('submitted','rejected'),
        ('in_review','live'),('in_review','rejected'),('live','paused'),('paused','live'),('live','archived'),('paused','archived'),('draft','archived'));
  if not ok then raise exception 'INVALID_TRANSITION: % → %', p.status, p_to; end if;
  if p_to = 'live' and not coalesce((select listings_live from supplier_switches where supplier_id = p.supplier_id), true) then
    raise exception 'SUPPLIER_LISTINGS_OFF';
  end if;
  update products set status = p_to, rejection_reason = case when p_to = 'rejected' then p_reason else null end where id = p_product;
  perform log_status('product', p_product, p.status::text, p_to::text, p_reason);
  if p_to = 'live' then perform emit_event('product.published', 'product', p_product, '{}'); end if;
end $function$;

create or replace function public.withdraw_from_moderation(p_product uuid, p_reason text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare p record;
begin
  if not (can('products', 'approve') or can('products', 'edit')) then raise exception 'FORBIDDEN'; end if;
  select id, supplier_id, status::text status, listing_status, external_id into p from products where id = p_product for update;
  if p.id is null then return 'the product no longer exists'; end if;
  if distributor_restricted() and not can('products', 'approve') and not is_my_supplier(p.supplier_id) then raise exception 'FORBIDDEN'; end if;
  if p.status not in ('submitted', 'in_review') then return 'not in moderation (status ' || p.status || ')'; end if;
  update products set status = 'draft', moderation_hold = false, moderation_hold_reason = null where id = p_product;
  perform log_status('product', p_product, p.status, 'draft', p_reason);
  perform write_audit('product.withdrawn_from_moderation', 'products', p_product::text,
    jsonb_build_object('sku', p.external_id, 'from', p.status, 'to', 'draft', 'listing_status', p.listing_status, 'reason', p_reason));
  return 'withdrawn';
end $function$;

-- ── Admin bulk import (import_runs): staff only, never a distributor ──
-- import_runs.staging holds whole supplier workbooks (all suppliers, cost columns); it was readable with products:edit.
drop policy if exists ir_staff on import_runs;
create policy ir_staff on import_runs for select to authenticated using (can('products', 'edit') and not distributor_restricted());
create or replace function public.decide_import_review(p_item uuid, p_status text, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not can('products', 'edit') or distributor_restricted() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('accepted_quote', 'accepted_dashboard', 'resolved', 'held', 'open') then raise exception 'INVALID_STATUS'; end if;
  update import_review_items set status = p_status, decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
   where id = p_item;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform write_audit('import.review_decided', 'import_review_items', p_item::text, jsonb_build_object('status', p_status, 'note', p_note));
end $function$;
-- commit_import_run writes products of any supplier; only the server (service role: Admin › Import, scripts/import-bulk) calls it
revoke execute on function commit_import_run(uuid, uuid, text) from public, anon, authenticated;
grant execute on function commit_import_run(uuid, uuid, text) to service_role;

-- ── Storage ──
-- product-media stays a public bucket (public URLs keep working without a SELECT policy) but can no longer be LISTED by
-- everyone; owners (assigned supplier folder) and product staff may list. Banners keep their public read.
drop policy if exists "public media read" on storage.objects;
create policy "public media read" on storage.objects for select using (bucket_id = 'banners');
create policy "product media read own" on storage.objects for select to authenticated using (
  bucket_id = 'product-media' and (can('products', 'view') or can('content', 'edit') or is_my_supplier(try_uuid((storage.foldername(name))[1]))));
-- uploads: a restricted distributor only into an assigned supplier's folder (<supplier uuid>/…)
drop policy if exists "staff media write" on storage.objects;
create policy "staff media write" on storage.objects for insert to authenticated with check (
  bucket_id in ('product-media', 'banners') and (can('products', 'create') or can('content', 'edit'))
  and (bucket_id = 'banners' or not distributor_restricted() or is_my_supplier(try_uuid((storage.foldername(name))[1]))));
-- certificates: services_ops staff, product staff, or the assigned supplier's folder (<supplier uuid>/…)
drop policy if exists "certs staff" on storage.objects;
create policy "certs staff" on storage.objects for all to authenticated
  using (bucket_id = 'certificates' and (can('services_ops', 'view')
    or (can('products', 'create') and (not distributor_restricted() or is_my_supplier(try_uuid((storage.foldername(name))[1]))))))
  with check (bucket_id = 'certificates' and (can('services_ops', 'edit')
    or (can('products', 'create') and (not distributor_restricted() or is_my_supplier(try_uuid((storage.foldername(name))[1]))))));
