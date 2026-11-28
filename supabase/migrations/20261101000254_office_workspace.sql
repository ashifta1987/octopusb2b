-- ODS T8 · Back Office workspace data (master prompt Part 7.1 workspace tabs, 7.2 saved views, Part 8). DRAFT on top of 253.
--  1. workspace_tabs: one row per staff user — open tabs (order, pins, per-tab filters / scroll) + the active tab. The browser keeps
--     a localStorage copy; this row restores them on another device / after a reload. Owner only.
--  2. saved_views: grid views (filters, columns, sort) per page. personal = the owner only; shared = staff holding shared_role
--     (shared_role NULL = every staff member, admins only). One default view per user and page.
--  3. ui_prefs: remembered UI choices (sidebar collapsed, density override, collapsed sidebar groups, small extra object). Owner only.
--  4. RPCs: save_workspace_tabs, save_ui_prefs, save_view, delete_view. Tables have column READ grants only; every write goes
--     through these SECURITY DEFINER functions (search_path = public), which validate shape and size.
-- Staff only everywhere (is_staff(): a staff role on a 2FA session). No money, no customer data. Re-runnable.
-- Error codes: NOT_SIGNED_IN, STAFF_ONLY, INVALID_INPUT: <what>, VIEW_NAME_TAKEN, VIEW_LIMIT, ROLE_NOT_ALLOWED, NOT_FOUND.
-- Down: supabase/migrations/down/20261101000254_office_workspace.down.sql

-- ───────────────────────── 1. tables ─────────────────────────
create table if not exists public.workspace_tabs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tabs jsonb not null default '[]'::jsonb,
  active_id text check (active_id is null or length(active_id) between 1 and 80),
  updated_at timestamptz not null default now(),
  -- 12 open tabs + the pinned Dashboard; 32 KB is far above 13 tabs with filters
  constraint workspace_tabs_shape check (jsonb_typeof(tabs) = 'array' and jsonb_array_length(tabs) <= 13 and octet_length(tabs::text) <= 32768)
);
comment on table public.workspace_tabs is 'ODS T8: a staff user''s open Back Office tabs (Part 7.1 persistence). Owner only; written by save_workspace_tabs().';

do $$ begin
  create type public.saved_view_scope as enum ('personal', 'shared');
exception when duplicate_object then null; end $$;

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope public.saved_view_scope not null default 'personal',
  page text not null check (page ~ '^/[a-z0-9/_-]{1,119}$'),
  name text not null check (length(btrim(name)) between 1 and 60),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) in ('object', 'array') and octet_length(filters::text) <= 8192),
  columns jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array' and octet_length(columns::text) <= 4096),
  sort jsonb not null default '[]'::jsonb check (jsonb_typeof(sort) in ('object', 'array') and octet_length(sort::text) <= 1024),
  shared_role text references public.roles(code) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_views_role_only_shared check (scope = 'shared' or shared_role is null),
  constraint saved_views_default_personal check (not is_default or scope = 'personal'),
  constraint saved_views_name_key unique (user_id, page, name)
);
create unique index if not exists saved_views_one_default on public.saved_views (user_id, page) where is_default;
create index if not exists saved_views_shared_idx on public.saved_views (page, shared_role) where scope = 'shared';
comment on table public.saved_views is 'ODS T8: OctopusDataGrid saved views (Part 7.2). personal = owner; shared = staff with shared_role (NULL = all staff). Written by save_view() / delete_view().';

create table if not exists public.ui_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sidebar_collapsed boolean not null default false,
  density_override text check (density_override is null or density_override in ('compact', 'comfortable')),
  groups_collapsed jsonb not null default '[]'::jsonb check (jsonb_typeof(groups_collapsed) = 'array' and jsonb_array_length(groups_collapsed) <= 40),
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 8192),
  updated_at timestamptz not null default now()
);
comment on table public.ui_prefs is 'ODS T8: remembered Back Office UI choices (sidebar, density, collapsed groups). Owner only; written by save_ui_prefs().';

-- ───────────────────────── 2. RLS + grants ─────────────────────────
alter table public.workspace_tabs enable row level security;
alter table public.saved_views enable row level security;
alter table public.ui_prefs enable row level security;
revoke all on table public.workspace_tabs from public, anon, authenticated;
revoke all on table public.saved_views from public, anon, authenticated;
revoke all on table public.ui_prefs from public, anon, authenticated;
grant all on table public.workspace_tabs, public.saved_views, public.ui_prefs to service_role;

drop policy if exists workspace_tabs_own_read on public.workspace_tabs;
create policy workspace_tabs_own_read on public.workspace_tabs for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_staff()));
grant select (user_id, tabs, active_id, updated_at) on table public.workspace_tabs to authenticated;

drop policy if exists ui_prefs_own_read on public.ui_prefs;
create policy ui_prefs_own_read on public.ui_prefs for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_staff()));
grant select (user_id, sidebar_collapsed, density_override, groups_collapsed, extra, updated_at) on table public.ui_prefs to authenticated;

drop policy if exists saved_views_read on public.saved_views;
create policy saved_views_read on public.saved_views for select to authenticated
  using ((select public.is_staff()) and (
    user_id = (select auth.uid())
    or (scope = 'shared' and (shared_role is null or public.has_role(shared_role) or (select public.is_admin())))));
grant select (id, user_id, scope, page, name, filters, columns, sort, shared_role, is_default, created_at, updated_at)
  on table public.saved_views to authenticated;

-- ───────────────────────── 3. helpers ─────────────────────────
-- signed-in staff member on a 2FA session → their user id
create or replace function public.office_guard()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not public.is_staff() then raise exception 'STAFF_ONLY'; end if;
  return auth.uid();
end $$;

-- a JSON string value, trimmed, with a length range (else INVALID_INPUT)
create or replace function public.office_json_text(p jsonb, p_what text, p_min integer, p_max integer)
returns text language plpgsql immutable set search_path = public as $$
declare v text;
begin
  if p is null or jsonb_typeof(p) <> 'string' then raise exception 'INVALID_INPUT: % must be text', p_what; end if;
  v := btrim(p #>> '{}');
  if length(v) < p_min or length(v) > p_max then raise exception 'INVALID_INPUT: % must be % to % characters', p_what, p_min, p_max; end if;
  return v;
end $$;

-- ───────────────────────── 4. workspace tabs ─────────────────────────
-- p_tabs: [{id, href, title, icon?, pinned?, filters?, scrollY?, openedAt?}, …]; href is an app path ("/office/…", never "//host")
create or replace function public.save_workspace_tabs(p_tabs jsonb, p_active text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.office_guard(); t jsonb; v_ids text[] := '{}'; v_id text; v_href text; v_at timestamptz;
begin
  if p_tabs is null or jsonb_typeof(p_tabs) <> 'array' then raise exception 'INVALID_INPUT: tabs must be a list'; end if;
  if jsonb_array_length(p_tabs) > 13 then raise exception 'INVALID_INPUT: at most 12 open tabs plus the Dashboard'; end if;
  if octet_length(p_tabs::text) > 32768 then raise exception 'INVALID_INPUT: tabs are too large'; end if;
  for t in select value from jsonb_array_elements(p_tabs) loop
    if jsonb_typeof(t) <> 'object' then raise exception 'INVALID_INPUT: each tab must be an object'; end if;
    v_id := public.office_json_text(t -> 'id', 'tab id', 1, 80);
    if v_id = any(v_ids) then raise exception 'INVALID_INPUT: duplicate tab id %', v_id; end if;
    v_ids := v_ids || v_id;
    v_href := public.office_json_text(t -> 'href', 'tab link', 1, 500);
    if v_href !~ '^/([^/\\]|$)' then raise exception 'INVALID_INPUT: tab link must be a path in the app'; end if;
    perform public.office_json_text(t -> 'title', 'tab title', 1, 200);
    if t ? 'pinned' and jsonb_typeof(t -> 'pinned') <> 'boolean' then raise exception 'INVALID_INPUT: pinned must be true or false'; end if;
    if t ? 'filters' and jsonb_typeof(t -> 'filters') not in ('object', 'null') then raise exception 'INVALID_INPUT: tab filters must be an object'; end if;
    if t ? 'scrollY' and jsonb_typeof(t -> 'scrollY') not in ('number', 'null') then raise exception 'INVALID_INPUT: scrollY must be a number'; end if;
  end loop;
  if p_active is not null and not (p_active = any(v_ids)) then raise exception 'INVALID_INPUT: the active tab is not open'; end if;
  insert into public.workspace_tabs (user_id, tabs, active_id, updated_at) values (v_uid, p_tabs, p_active, clock_timestamp())
  on conflict (user_id) do update set tabs = excluded.tabs, active_id = excluded.active_id, updated_at = excluded.updated_at
  returning updated_at into v_at;
  return v_at;
end $$;

-- ───────────────────────── 5. UI preferences ─────────────────────────
-- p_patch: any of {sidebar_collapsed, density_override, groups_collapsed, extra}; extra is merged key by key (null value removes a key)
create or replace function public.save_ui_prefs(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.office_guard(); k text; r public.ui_prefs; g jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_INPUT: preferences must be an object'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('sidebar_collapsed', 'density_override', 'groups_collapsed', 'extra') then raise exception 'INVALID_INPUT: unknown preference %', k; end if;
  end loop;
  if p_patch ? 'sidebar_collapsed' and jsonb_typeof(p_patch -> 'sidebar_collapsed') <> 'boolean' then raise exception 'INVALID_INPUT: sidebar_collapsed must be true or false'; end if;
  if p_patch ? 'density_override' and not (jsonb_typeof(p_patch -> 'density_override') = 'null'
       or (p_patch ->> 'density_override') in ('compact', 'comfortable')) then raise exception 'INVALID_INPUT: density must be compact or comfortable'; end if;
  if p_patch ? 'groups_collapsed' then
    g := p_patch -> 'groups_collapsed';
    if jsonb_typeof(g) <> 'array' or jsonb_array_length(g) > 40
       or exists (select 1 from jsonb_array_elements(g) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 40) then
      raise exception 'INVALID_INPUT: collapsed groups must be a list of up to 40 short names';
    end if;
  end if;
  if p_patch ? 'extra' and jsonb_typeof(p_patch -> 'extra') <> 'object' then raise exception 'INVALID_INPUT: extra must be an object'; end if;
  insert into public.ui_prefs (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into r from public.ui_prefs where user_id = v_uid for update;
  if p_patch ? 'extra' and octet_length(jsonb_strip_nulls(r.extra || (p_patch -> 'extra'))::text) > 8192 then raise exception 'INVALID_INPUT: extra is too large'; end if;
  update public.ui_prefs set
    sidebar_collapsed = case when p_patch ? 'sidebar_collapsed' then (p_patch ->> 'sidebar_collapsed')::boolean else sidebar_collapsed end,
    density_override = case when p_patch ? 'density_override' then p_patch ->> 'density_override' else density_override end,
    groups_collapsed = case when p_patch ? 'groups_collapsed' then p_patch -> 'groups_collapsed' else groups_collapsed end,
    extra = case when p_patch ? 'extra' then jsonb_strip_nulls(extra || (p_patch -> 'extra')) else extra end,
    updated_at = clock_timestamp()
  where user_id = v_uid returning * into r;
  return jsonb_build_object('sidebar_collapsed', r.sidebar_collapsed, 'density_override', r.density_override,
                            'groups_collapsed', r.groups_collapsed, 'extra', r.extra, 'updated_at', r.updated_at);
end $$;

-- ───────────────────────── 6. saved views ─────────────────────────
-- create (p_id null) or update (own view). Shared views: to one of your own roles (admins: any role, or NULL = all staff).
create or replace function public.save_view(
  p_id uuid, p_page text, p_name text, p_scope text default 'personal', p_shared_role text default null,
  p_filters jsonb default '{}'::jsonb, p_columns jsonb default '[]'::jsonb, p_sort jsonb default '[]'::jsonb, p_is_default boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.office_guard(); v_id uuid; v_name text := btrim(coalesce(p_name, '')); v_page text := btrim(coalesce(p_page, ''));
  v_scope public.saved_view_scope; v_role text := nullif(btrim(coalesce(p_shared_role, '')), ''); v_default boolean := coalesce(p_is_default, false);
begin
  if p_scope is null or p_scope not in ('personal', 'shared') then raise exception 'INVALID_INPUT: scope must be personal or shared'; end if;
  v_scope := p_scope::public.saved_view_scope;
  if v_page !~ '^/[a-z0-9/_-]{1,119}$' then raise exception 'INVALID_INPUT: page'; end if;
  if length(v_name) not between 1 and 60 then raise exception 'INVALID_INPUT: name must be 1 to 60 characters'; end if;
  if jsonb_typeof(coalesce(p_filters, 'null')) not in ('object', 'array') or octet_length(p_filters::text) > 8192 then raise exception 'INVALID_INPUT: filters'; end if;
  if jsonb_typeof(coalesce(p_columns, 'null')) <> 'array' or octet_length(p_columns::text) > 4096 then raise exception 'INVALID_INPUT: columns'; end if;
  if jsonb_typeof(coalesce(p_sort, 'null')) not in ('object', 'array') or octet_length(p_sort::text) > 1024 then raise exception 'INVALID_INPUT: sort'; end if;
  if v_scope = 'personal' then v_role := null; end if;
  if v_scope = 'shared' then
    v_default := false;
    if v_role is null and not public.is_admin() then raise exception 'ROLE_NOT_ALLOWED: choose one of your roles to share with'; end if;
    if v_role is not null and not exists (select 1 from public.roles r where r.code = v_role and r.is_staff) then raise exception 'INVALID_INPUT: role'; end if;
    if v_role is not null and not (public.has_role(v_role) or public.is_admin()) then raise exception 'ROLE_NOT_ALLOWED: you can share only with your own roles'; end if;
  end if;
  if p_id is null then
    if (select count(*) from public.saved_views where user_id = v_uid and page = v_page) >= 50 then raise exception 'VIEW_LIMIT: at most 50 views per page'; end if;
  elsif not exists (select 1 from public.saved_views where id = p_id and user_id = v_uid) then
    raise exception 'NOT_FOUND: view';
  end if;
  if v_default then update public.saved_views set is_default = false, updated_at = now() where user_id = v_uid and page = v_page and is_default and id is distinct from p_id; end if;
  begin
    if p_id is null then
      insert into public.saved_views (user_id, scope, page, name, filters, columns, sort, shared_role, is_default)
        values (v_uid, v_scope, v_page, v_name, p_filters, p_columns, p_sort, v_role, v_default) returning id into v_id;
    else
      update public.saved_views set scope = v_scope, page = v_page, name = v_name, filters = p_filters, columns = p_columns, sort = p_sort,
             shared_role = v_role, is_default = v_default, updated_at = now()
       where id = p_id and user_id = v_uid returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'VIEW_NAME_TAKEN: you already have a view called "%" on this page', v_name;
  end;
  if v_scope = 'shared' then
    perform public.write_audit('office.view_shared', 'saved_views', v_id::text, jsonb_build_object('page', v_page, 'name', v_name, 'role', v_role));
  end if;
  return v_id;
end $$;

-- own views; admins may also remove a shared view of someone else
create or replace function public.delete_view(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.office_guard(); v public.saved_views;
begin
  select * into v from public.saved_views where id = p_id;
  if v.id is null or not (v.user_id = v_uid or (v.scope = 'shared' and public.is_admin())) then raise exception 'NOT_FOUND: view'; end if;
  delete from public.saved_views where id = p_id;
  if v.scope = 'shared' then
    perform public.write_audit('office.view_deleted', 'saved_views', p_id::text, jsonb_build_object('page', v.page, 'name', v.name, 'role', v.shared_role, 'owner', v.user_id));
  end if;
  return true;
end $$;

-- ───────────────────────── 7. function grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array['office_guard()', 'office_json_text(jsonb,text,integer,integer)',
    'save_workspace_tabs(jsonb,text)', 'save_ui_prefs(jsonb)',
    'save_view(uuid,text,text,text,text,jsonb,jsonb,jsonb,boolean)', 'delete_view(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['save_workspace_tabs(jsonb,text)', 'save_ui_prefs(jsonb)',
    'save_view(uuid,text,text,text,text,jsonb,jsonb,jsonb,boolean)', 'delete_view(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
