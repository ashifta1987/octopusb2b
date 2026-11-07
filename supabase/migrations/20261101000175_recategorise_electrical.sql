-- ADDON-36 · 36-A (C4): move products that sat directly on the "Electrical" parent
-- into proper sub-categories (owner-approved 2026-11-07):
--   XTW-0001…0008 (chargers)      → Electrical › Chargers & power (new)
--   XTW-0009…0037 (cables)        → Electrical › Cables & wires
--   CN-GD-DMN-* (projectors)      → Electronics › Projectors (new)
-- Every move is written to audit_log.
do $m$
declare
  v_elec uuid; v_tron uuid; v_cables uuid; v_chargers uuid; v_proj uuid; n int;
begin
  select id into v_elec from categories where parent_id is null and slug = 'electrical';
  select id into v_tron from categories where parent_id is null and slug = 'electronics';
  select id into v_cables from categories where parent_id = v_elec and slug = 'cables-wires';
  if v_elec is null or v_tron is null or v_cables is null then
    -- fresh database (staging/local) without the live catalogue: nothing to move
    raise notice 'recategorise skipped: Electrical/Electronics categories not present';
    return;
  end if;

  insert into categories(parent_id, name, slug, level, sort, active)
  values (v_elec, 'Chargers & power', 'chargers-power', 2, 4, true)
  on conflict (parent_id, slug) do update set active = true
  returning id into v_chargers;

  insert into categories(parent_id, name, slug, level, sort, active)
  values (v_tron, 'Projectors', 'projectors', 2, 1, true)
  on conflict (parent_id, slug) do update set active = true
  returning id into v_proj;

  insert into audit_log(action, entity, entity_id, details)
  values ('category.create', 'category', v_chargers::text, jsonb_build_object('name','Chargers & power','parent','Electrical','source','ADDON-36 C4')),
         ('category.create', 'category', v_proj::text, jsonb_build_object('name','Projectors','parent','Electronics','source','ADDON-36 C4'));

  with moved as (
    update products p set category_id = x.to_cat
    from (
      select id,
        case
          when sku ~ '^XTW-00(0[1-8])$' then v_chargers
          when sku ~ '^XTW-00(09|[1-2][0-9]|3[0-7])$' then v_cables
          when sku like 'CN-GD-DMN-%' then v_proj
        end as to_cat
      from products
      where category_id = v_elec
    ) x
    where p.id = x.id and x.to_cat is not null
    returning p.id, p.sku, x.to_cat
  )
  insert into audit_log(action, entity, entity_id, details)
  select 'product.recategorise', 'product', id::text,
         jsonb_build_object('sku', sku, 'from', v_elec, 'to', to_cat, 'source', 'ADDON-36 C4')
  from moved;
  get diagnostics n = row_count;
  raise notice 'recategorised % products', n;
end $m$;

