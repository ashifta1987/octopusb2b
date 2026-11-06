-- ADDON-27 fix: categories are unique per (parent_id, slug), not by slug alone — look the top-level category up
-- by slug before inserting instead of ON CONFLICT (slug).
do $$
declare def text; p text;
begin
  def := pg_get_functiondef('commit_import_run(uuid,uuid,text)'::regprocedure);
  if position('on conflict (slug)' in def) = 0 then return; end if;
  p := replace(def,
    $a$        insert into categories(name, slug, level, sort, active)
        values (v->>'category', regexp_replace(lower(v->>'category'), '[^a-z0-9]+', '-', 'g'), 0, 100, false)
        on conflict (slug) do update set name = categories.name returning id into v_cat;$a$,
    $b$        select id into v_cat from categories where parent_id is null and slug = trim(both '-' from regexp_replace(lower(v->>'category'), '[^a-z0-9]+', '-', 'g'));
        if v_cat is null then
          insert into categories(name, slug, level, sort, active)
          values (v->>'category', trim(both '-' from regexp_replace(lower(v->>'category'), '[^a-z0-9]+', '-', 'g')), 0, 100, false)
          returning id into v_cat;
        end if;$b$);
  if p = def then raise exception 'ADDON-27 patch: category block not found'; end if;
  execute p;
end $$;
