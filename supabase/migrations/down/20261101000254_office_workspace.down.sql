-- Down for ODS T8 workspace data (254). Drops the Back Office tabs, saved views and UI preferences (UI state only — no business
-- or money rows). The browser keeps its localStorage copy of the tabs, so nothing a user needs is lost.
drop function if exists public.delete_view(uuid);
drop function if exists public.save_view(uuid, text, text, text, text, jsonb, jsonb, jsonb, boolean);
drop function if exists public.save_ui_prefs(jsonb);
drop function if exists public.save_workspace_tabs(jsonb, text);
drop function if exists public.office_json_text(jsonb, text, integer, integer);
drop function if exists public.office_guard();
drop table if exists public.ui_prefs;
drop table if exists public.saved_views;
drop table if exists public.workspace_tabs;
drop type if exists public.saved_view_scope;
