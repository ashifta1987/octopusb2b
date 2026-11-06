-- Step A (6 Nov 2026): no unpriced / unquoted product enters moderation, from any route; withdraw helper; moderation hold.

-- 1 · submit requirements: enforced on the row itself, so import jobs, import runs, the single form and any future API share it
create or replace function product_submit_blocker(p_product uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.listing_status = 'needs_quote' then 'the supplier has not quoted a price yet (needs quote)'
    when p.listing_status = 'in_development' then 'the product is still in development'
    when not exists (select 1 from price_tiers t where t.product_id = p.id) then 'it has no buyer price tier'
  end
  from products p where p.id = p_product
$$;
grant execute on function product_submit_blocker(uuid) to authenticated;

create or replace function guard_submit_requirements() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if new.status not in ('submitted', 'in_review') or new.status is not distinct from old.status then return new; end if;
  v_reason := product_submit_blocker(new.id);
  if v_reason is not null then
    raise exception 'SUBMIT_BLOCKED: % cannot be submitted for moderation: %', coalesce(new.external_id, new.title), v_reason using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_submit_requirements on products;
create trigger trg_guard_submit_requirements before update of status on products for each row execute function guard_submit_requirements();

-- plain per-row wording for the shared submit step
create or replace function submit_one_for_moderation(p_product uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status::text into v_status from products where id = p_product;
  if v_status is null then return 'the product no longer exists'; end if;
  if v_status in ('submitted', 'in_review', 'live', 'paused') then return 'already'; end if;
  begin
    perform transition_product(p_product, 'submitted', p_reason);
    return 'submitted';
  exception when others then
    return case
      when sqlerrm like 'SUBMIT_BLOCKED%' then regexp_replace(sqlerrm, '^SUBMIT_BLOCKED: .* cannot be submitted for moderation: ', '')
      when sqlerrm like 'INVALID_TRANSITION%' then 'the product is ' || v_status || ' — only draft or rejected products can be submitted'
      when sqlerrm like 'FORBIDDEN%' then 'you do not have permission to submit this product'
      else regexp_replace(sqlerrm, '^[A-Z_]+:\s*', '') end;
  end;
end $$;
revoke execute on function submit_one_for_moderation(uuid, text) from public, anon, authenticated;

-- 2 · withdraw from moderation (submitted / in_review → draft), audited per product
create or replace function withdraw_from_moderation(p_product uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
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
end $$;
revoke execute on function withdraw_from_moderation(uuid, text) from public, anon;
grant execute on function withdraw_from_moderation(uuid, text) to authenticated;

-- 3 · moderation hold (used in step B): stays in the queue, cannot be approved until released
alter table products add column if not exists moderation_hold boolean not null default false;
alter table products add column if not exists moderation_hold_reason text;

create or replace function guard_moderation_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and old.status is distinct from 'live' and coalesce(old.moderation_hold, false) then
    raise exception 'MODERATION_HOLD: % is on hold: %', coalesce(new.external_id, new.title), coalesce(old.moderation_hold_reason, 'waiting for owner confirmation');
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_moderation_hold on products;
create trigger trg_guard_moderation_hold before update of status on products for each row execute function guard_moderation_hold();

