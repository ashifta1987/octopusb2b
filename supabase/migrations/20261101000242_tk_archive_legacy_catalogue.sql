-- 20261101000242_tk_archive_legacy_catalogue.sql
-- Turnkey (owner, 26 Nov 2026): "delete old, I need only the new 300 projects". The 25 catalogue projects from before the
-- new design are taken off the site (status 'archived': the public catalogue, sitemap and enquiry form show none of them).
-- They are archived, not deleted: one client project and one frozen legacy lead still point at a catalogue row (history
-- stays intact). The new 300-project list is loaded with Admin › Turnkey › Catalogue › Import (tk_import_catalogue) once
-- the owner supplies it. Down restores each row's previous status exactly.
-- Down: supabase/migrations/down/20261101000242_tk_archive_legacy_catalogue.down.sql
create table if not exists public.tk_legacy_catalogue_archive (
  project_id text primary key references public.turnkey_projects(project_id) on update cascade on delete cascade,
  previous_status text not null,
  archived_at timestamptz not null default now()
);
comment on table public.tk_legacy_catalogue_archive is 'Turnkey: the pre-redesign catalogue projects archived by migration 242, with their previous status (for the down).';
alter table public.tk_legacy_catalogue_archive enable row level security;
revoke all on public.tk_legacy_catalogue_archive from public, anon, authenticated;
grant all on public.tk_legacy_catalogue_archive to service_role;

insert into public.tk_legacy_catalogue_archive (project_id, previous_status)
select project_id, status from public.turnkey_projects
 where status <> 'archived'
   and project_id = any (array['block-making','bubble-tea','car-wash','claw-fec','cloud-kitchen','cold-room','container-cafe',
     'ev-charging','feed-mill','gym','hotel-ffe','injection-moulding','laser-signage','laundry','lockers','minimart','padel-court',
     'paper-cup','robotic-cafe','solar','trampoline-park','vending','vr-cinema','water-bottling','water-vending'])
on conflict (project_id) do nothing;

update public.turnkey_projects t set status = 'archived', updated_at = now()
  from public.tk_legacy_catalogue_archive a where a.project_id = t.project_id and t.status <> 'archived';

insert into public.audit_log (actor_id, action, entity, entity_id, details)
select null, 'turnkey.catalogue_legacy_archived', 'turnkey_projects', null,
       jsonb_build_object('count', (select count(*) from public.tk_legacy_catalogue_archive), 'reason', 'owner: only the new 300-project catalogue');
