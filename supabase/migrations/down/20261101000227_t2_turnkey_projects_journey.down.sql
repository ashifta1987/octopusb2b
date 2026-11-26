-- DOWN for 20261101000227_t2_turnkey_projects_journey.sql
-- Removes the client projects, phases, history and staff facts (the old turnkey_leads rows are untouched, so running the
-- up file again moves them back in at "Enquiry"). Projects clients created through the enquiry form are LOST: export
-- tk_client_projects first if any exist (rule 12: never on live without the owner's OK).
-- Then: delete from _migrations where name = '20261101000227_t2_turnkey_projects_journey.sql';
drop function if exists public.tk_set_project_manager(uuid, uuid);
drop function if exists public.tk_manager_candidates();
drop function if exists public.tk_set_stage_due(uuid, text, date);
drop function if exists public.tk_set_project_status(uuid, text, text);
drop function if exists public.tk_move_project_stage(uuid, text, text);
drop function if exists public.tk_project_manager_name(uuid);
drop function if exists public.tk_link_legacy_projects(uuid);
drop function if exists public.tk_submit_enquiry(uuid, text, text, text, text, date, numeric, bigint, text);
drop function if exists public.tk_staff_can_edit(uuid);
drop function if exists public.tk_init_stages(uuid, timestamptz);
drop table if exists public.tk_client_project_staff;
drop table if exists public.tk_client_project_events;
drop table if exists public.tk_client_project_stages;
drop table if exists public.tk_client_projects;
drop sequence if exists public.seq_tk_client_project;
drop table if exists public.tk_stages;
