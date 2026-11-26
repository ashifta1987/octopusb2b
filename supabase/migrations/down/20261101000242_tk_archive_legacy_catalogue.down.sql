-- DOWN for 20261101000242_tk_archive_legacy_catalogue.sql: the 25 legacy projects get their previous status back.
-- Then: delete from _migrations where name = '20261101000242_tk_archive_legacy_catalogue.sql';
update public.turnkey_projects t set status = a.previous_status, updated_at = now()
  from public.tk_legacy_catalogue_archive a where a.project_id = t.project_id;
drop table if exists public.tk_legacy_catalogue_archive;
