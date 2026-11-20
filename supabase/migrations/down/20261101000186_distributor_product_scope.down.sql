-- DOWN for 20261101000186_distributor_product_scope.sql — restores the exact previous definitions.
-- Run by hand on staging only if the change must be rolled back, then: delete from _migrations where name = '20261101000186_distributor_product_scope.sql';

drop policy if exists products_public on products;
create policy products_public on products for select using (status = 'live' and archived_at is null and supplier_listings_live(supplier_id));

create or replace function product_visible(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from products where id = p and ((status = 'live' and archived_at is null) or can('products','view') or is_my_supplier(supplier_id)));
$$;
create or replace function product_editable(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from products where id = p and (can('products','edit') or is_my_supplier(supplier_id)));
$$;

create or replace function public.transition_product(p_product uuid, p_to product_status, p_reason text default null::text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare p record; ok boolean;
begin
  select * into p from products where id = p_product for update;
  if p is null then raise exception 'NOT_FOUND'; end if;
  if p_to in ('live','rejected','in_review') then
    if not can('products','approve') then raise exception 'FORBIDDEN'; end if;
  elsif not (can('products','edit') or is_my_supplier(p.supplier_id)) then raise exception 'FORBIDDEN';
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
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare p record;
begin
  if not (can('products', 'approve') or can('products', 'edit')) then raise exception 'FORBIDDEN'; end if;
  select id, status::text status, listing_status, external_id into p from products where id = p_product for update;
  if p.id is null then return 'the product no longer exists'; end if;
  if p.status not in ('submitted', 'in_review') then return 'not in moderation (status ' || p.status || ')'; end if;
  update products set status = 'draft', moderation_hold = false, moderation_hold_reason = null where id = p_product;
  perform log_status('product', p_product, p.status, 'draft', p_reason);
  perform write_audit('product.withdrawn_from_moderation', 'products', p_product::text,
    jsonb_build_object('sku', p.external_id, 'from', p.status, 'to', 'draft', 'listing_status', p.listing_status, 'reason', p_reason));
  return 'withdrawn';
end $function$;

drop policy if exists ir_staff on import_runs;
create policy ir_staff on import_runs for select to authenticated using (can('products', 'edit'));
create or replace function public.decide_import_review(p_item uuid, p_status text, p_note text default null::text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not can('products', 'edit') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('accepted_quote', 'accepted_dashboard', 'resolved', 'held', 'open') then raise exception 'INVALID_STATUS'; end if;
  update import_review_items set status = p_status, decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
   where id = p_item;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform write_audit('import.review_decided', 'import_review_items', p_item::text, jsonb_build_object('status', p_status, 'note', p_note));
end $function$;
grant execute on function commit_import_run(uuid, uuid, text) to authenticated;

drop policy if exists "product media read own" on storage.objects;
drop policy if exists "public media read" on storage.objects;
create policy "public media read" on storage.objects for select using (bucket_id in ('product-media','banners'));
drop policy if exists "staff media write" on storage.objects;
create policy "staff media write" on storage.objects for insert to authenticated with check (bucket_id in ('product-media','banners') and (can('products','create') or can('content','edit')));
drop policy if exists "certs staff" on storage.objects;
create policy "certs staff" on storage.objects for all to authenticated
  using (bucket_id = 'certificates' and (can('services_ops','view') or can('products','create')))
  with check (bucket_id = 'certificates' and (can('services_ops','edit') or can('products','create')));

drop function if exists try_uuid(text);
drop function if exists distributor_restricted();
