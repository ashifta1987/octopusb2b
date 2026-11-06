-- Step C (6 Nov 2026): an import row whose prices equal the supplier cost on every tier must be confirmed before commit.
alter table import_jobs add column if not exists cost_flagged_rows int not null default 0;
alter table import_jobs add column if not exists cost_confirmed_at timestamptz;
alter table import_jobs add column if not exists cost_confirmed_by uuid references auth.users(id);

-- release the moderation hold (owner confirmation), audited per product
create or replace function release_moderation_hold(p_product uuid, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not (is_admin() or auth.uid() is null) then raise exception 'FORBIDDEN: only an Admin can release a moderation hold'; end if;
  select id, external_id, moderation_hold, moderation_hold_reason into p from products where id = p_product for update;
  if p.id is null then return 'the product no longer exists'; end if;
  if not p.moderation_hold then return 'not on hold'; end if;
  update products set moderation_hold = false, moderation_hold_reason = null where id = p_product;
  perform write_audit('product.moderation_hold_released', 'products', p_product::text, jsonb_build_object('sku', p.external_id, 'was', p.moderation_hold_reason, 'note', p_note));
  return 'released';
end $$;
revoke execute on function release_moderation_hold(uuid, text) from public, anon;
grant execute on function release_moderation_hold(uuid, text) to authenticated;
