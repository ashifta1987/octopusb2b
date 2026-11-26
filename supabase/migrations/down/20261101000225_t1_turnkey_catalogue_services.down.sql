-- DOWN for 20261101000225_t1_turnkey_catalogue_services.sql
-- Fails on purpose if projects now use categories outside the 6 ADDON-31 codes (review them first).
-- Then: delete from _migrations where name = '20261101000225_t1_turnkey_catalogue_services.sql';
drop table if exists public.tk_services;
drop function if exists public.tk_import_catalogue(jsonb, boolean, text[]);
alter table public.turnkey_projects drop column if exists floor_area_m2;
alter table public.turnkey_projects drop constraint if exists turnkey_projects_category_label;
-- the owner's 300-project catalogue (26 Nov 2026) uses free category labels: the old fixed list comes back NOT VALID
-- when such rows exist (catalogue rows are never deleted by a down)
do $$
begin
  if exists (select 1 from public.turnkey_projects where category <> all (array['self-service', 'food', 'leisure', 'small-factory', 'infrastructure', 'fit-out'])) then
    alter table public.turnkey_projects add constraint turnkey_projects_category_check
      check (category = any (array['self-service'::text, 'food'::text, 'leisure'::text, 'small-factory'::text, 'infrastructure'::text, 'fit-out'::text])) not valid;
  else
    alter table public.turnkey_projects add constraint turnkey_projects_category_check
      check (category = any (array['self-service'::text, 'food'::text, 'leisure'::text, 'small-factory'::text, 'infrastructure'::text, 'fit-out'::text]));
  end if;
end $$;
