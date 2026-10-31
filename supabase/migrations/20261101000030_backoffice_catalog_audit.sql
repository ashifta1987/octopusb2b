-- Back office / distributor helpers (agent range 30–39). Forward-only.

-- Merge category A into B: move products (all suppliers) and, when both are on the same level, re-parent A's children.
-- Then deactivate A. Needs catalog:edit. Audited.
create or replace function merge_category(p_from uuid, p_to uuid)
returns int language plpgsql security definer set search_path = public as $$
declare a record; b record; n int;
begin
  if not can('catalog','edit') then raise exception 'FORBIDDEN'; end if;
  if p_from = p_to then raise exception 'MERGE_SAME_CATEGORY'; end if;
  select * into a from categories where id = p_from for update;
  select * into b from categories where id = p_to for update;
  if a is null or b is null then raise exception 'NOT_FOUND'; end if;
  -- B must not be A or a descendant of A
  if exists (
    with recursive d as (select id from categories where parent_id = p_from union all select c.id from categories c join d on c.parent_id = d.id)
    select 1 from d where id = p_to
  ) then raise exception 'MERGE_INTO_DESCENDANT'; end if;
  if exists(select 1 from categories where parent_id = p_from) then
    if a.level <> b.level then raise exception 'MERGE_HAS_CHILDREN: move or merge the subcategories first'; end if;
    update categories set parent_id = p_to where parent_id = p_from;
  end if;
  update products set category_id = p_to where category_id = p_from;
  get diagnostics n = row_count;
  update rfqs set category_id = p_to where category_id = p_from;
  update categories set active = false where id = p_from;
  perform write_audit('category.merge', 'categories', p_from::text, jsonb_build_object('into', p_to, 'products', n));
  return n;
end $$;

-- Staff "viewed sensitive data" log (SPEC §3: every view of KYC documents or customer contacts is logged).
create or replace function log_staff_view(p_entity text, p_entity_id text, p_details jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'FORBIDDEN'; end if;
  perform write_audit('view.' || p_entity, p_entity, p_entity_id, p_details);
end $$;

-- Generic catalog audit for distributor/admin catalog edits (create/rename/hide/reorder/tags).
create or replace function log_catalog_change(p_action text, p_entity_id text, p_details jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can('catalog','edit') then raise exception 'FORBIDDEN'; end if;
  perform write_audit('catalog.' || p_action, 'catalog', p_entity_id, p_details);
end $$;

revoke execute on function public.merge_category(uuid,uuid) from public, anon;
revoke execute on function public.log_staff_view(text,text,jsonb) from public, anon;
revoke execute on function public.log_catalog_change(text,text,jsonb) from public, anon;
grant execute on function public.merge_category(uuid,uuid) to authenticated, service_role;
grant execute on function public.log_staff_view(text,text,jsonb) to authenticated, service_role;
grant execute on function public.log_catalog_change(text,text,jsonb) to authenticated, service_role;
