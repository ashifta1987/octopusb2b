-- 20261101000224_t0_turnkey_retire_legacy.sql
-- Turnkey T0 (new design: docs/design/turnkey-v2). The ADDON-31 lead-generation model is retired; nothing is deleted.
--  · Legacy catalogue tables (hubs, packages, equipment, project sources, atlas signals) become staff-read-only archives.
--  · turnkey_leads is kept and frozen: no new rows (T2 moves each lead into a new project at "Enquiry").
--  · The old lead / signal / routing functions are removed (the down file restores them).
--  · turnkey_projects stays public (the new catalogue builds on it in T1). The 'turnkey' service code and division TK stay.
-- Down: supabase/migrations/down/20261101000224_t0_turnkey_retire_legacy.down.sql

drop policy if exists turnkey_signals_staff on public.turnkey_atlas_signals;
drop policy if exists turnkey_equipment_read on public.turnkey_equipment;
drop policy if exists turnkey_equipment_write on public.turnkey_equipment;
drop policy if exists turnkey_hubs_read on public.turnkey_hubs;
drop policy if exists turnkey_hubs_write on public.turnkey_hubs;
drop policy if exists turnkey_packages_read on public.turnkey_packages;
drop policy if exists turnkey_packages_write on public.turnkey_packages;
drop policy if exists turnkey_sources_read on public.turnkey_project_sources;
drop policy if exists turnkey_sources_write on public.turnkey_project_sources;

create policy turnkey_hubs_legacy_staff_read on public.turnkey_hubs for select to authenticated using (is_staff() and can('turnkey', 'view'));
create policy turnkey_packages_legacy_staff_read on public.turnkey_packages for select to authenticated using (is_staff() and can('turnkey', 'view'));
create policy turnkey_equipment_legacy_staff_read on public.turnkey_equipment for select to authenticated using (is_staff() and can('turnkey', 'view'));
create policy turnkey_sources_legacy_staff_read on public.turnkey_project_sources for select to authenticated using (is_staff() and can('turnkey', 'view'));
create policy turnkey_signals_legacy_staff_read on public.turnkey_atlas_signals for select to authenticated using (is_staff() and can('turnkey', 'view'));

comment on table public.turnkey_hubs is 'LEGACY (Turnkey T0, 26 Nov 2026): old factory-hub Atlas. Staff read-only archive.';
comment on table public.turnkey_packages is 'LEGACY (Turnkey T0): old tiered packages. Staff read-only archive.';
comment on table public.turnkey_equipment is 'LEGACY (Turnkey T0): old package equipment lists. Staff read-only archive.';
comment on table public.turnkey_project_sources is 'LEGACY (Turnkey T0): old project sources. Staff read-only archive.';
comment on table public.turnkey_atlas_signals is 'LEGACY (Turnkey T0): old Atlas analytics. Staff read-only archive.';

-- leads are customer data: kept, readable as before, but no new leads (the old form is gone)
create or replace function public.turnkey_leads_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'TURNKEY_LEADS_FROZEN: the old turnkey lead form is retired; start a project instead';
end $$;
drop trigger if exists trg_turnkey_leads_frozen on public.turnkey_leads;
create trigger trg_turnkey_leads_frozen before insert on public.turnkey_leads for each row execute function public.turnkey_leads_frozen();
comment on table public.turnkey_leads is 'LEGACY (Turnkey T0): frozen, kept for history; T2 moves each lead into a new project.';

drop function if exists public.submit_turnkey_lead(jsonb);
drop function if exists public.log_turnkey_signal(text, text, text, text);
drop function if exists public.turnkey_pick_assignee(text);
drop function if exists public.turnkey_region_for(text);
