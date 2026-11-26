-- 20261101000227_t2_turnkey_projects_journey.sql
-- Turnkey T2 (docs/design/turnkey-v2: "The 8-step flow", Client journey NewProject / ClientIntake / ClientPortal,
-- staff Project screen). The client's own turnkey project and its phases. Fees, payment gates and the 2x approval are T3.
--  1. tk_stages: the 8 phases from the design (Enquiry → Consultation → Design → Sourcing → Quote and deposit →
--     Production and QC → Shipment → Handover). Only the enquiry is free; the others are paid first (gates: T3).
--  2. tk_client_projects: a client company's project (TKP-00001…), optionally linked to a catalogue project
--     (turnkey_projects stays the public catalogue). Customer-safe columns only; customers read their companies' rows.
--     tk_client_project_stages: one row per phase with started / completed / target dates.
--     tk_client_project_events: the history the client sees (created, moved, phase changes, status changes, dates).
--     tk_client_project_staff: staff-only facts (account manager, who created it, the old lead it came from, is_seed).
--  3. Client enquiry: tk_submit_enquiry() (signed-in customer, own company; limits: 5 a day per person, 20 open
--     enquiries per company, 300 an hour overall). Signed-out visitors are sent to log in by the app.
--  4. D3: every frozen turnkey_leads row becomes a project at "Enquiry" (idempotent; the lead table is not changed).
--     Leads without a company link to the company of the account with the same verified email, on first visit
--     (tk_link_legacy_projects()), the same rule the old "My turnkey projects" page used.
--  5. Staff: move one phase forward or back with a reason, put on hold / cancel / complete, target dates per phase,
--     account manager (cover when away: T3). Turnkey editors only (can('turnkey','edit') + TK division), 2FA, audited.
-- Every write goes through a security definer function; tables have no write grants. Re-runnable (the T2 test runs it
-- twice to prove the lead move is idempotent).
-- Down: supabase/migrations/down/20261101000227_t2_turnkey_projects_journey.down.sql

-- ───────── 1. phases ─────────
create table if not exists public.tk_stages (
  code text primary key check (code ~ '^[a-z_]+$'),
  seq smallint not null unique check (seq between 1 and 8),
  name text not null check (btrim(name) <> ''),
  paid boolean not null,
  client_text text not null
);
comment on table public.tk_stages is 'Turnkey T2: the 8 project phases from docs/design/turnkey-v2 (only the enquiry is free).';
insert into public.tk_stages (code, seq, name, paid, client_text) values
  ('enquiry', 1, 'Enquiry', false, 'You pick a project or ask for a new one and tell us your plan.'),
  ('consultation', 2, 'Consultation', true, 'Paid first. We set the exact fee with you.'),
  ('design', 3, 'Design', true, 'Layout drawing: 3 versions free, then 50% of the drawing fee per extra version.'),
  ('sourcing', 4, 'Sourcing', true, 'We collect quotes from factories. You deal only with us.'),
  ('quote_deposit', 5, 'Quote and deposit', true, 'You approve the quote and pay the deposit.'),
  ('production_qc', 6, 'Production and QC', true, 'Factory audit and inspections, each paid before it starts.'),
  ('shipment', 7, 'Shipment', true, 'Booking, tracking and shipping documents.'),
  ('handover', 8, 'Handover', true, 'Final documents, sign-off and an optional China visit.')
on conflict (code) do nothing;
alter table public.tk_stages enable row level security;
revoke all on public.tk_stages from public, anon, authenticated;
grant select on public.tk_stages to anon, authenticated;
grant all on public.tk_stages to service_role;
drop policy if exists tk_stages_read on public.tk_stages;
create policy tk_stages_read on public.tk_stages for select to anon, authenticated using (true);

-- ───────── 2. client projects ─────────
create sequence if not exists public.seq_tk_client_project;

create table if not exists public.tk_client_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('TKP-' || lpad(nextval('public.seq_tk_client_project')::text, 5, '0')),
  org_id uuid references public.organizations(id) on delete restrict,
  catalogue_project_id text references public.turnkey_projects(project_id) on update cascade on delete restrict,
  title text not null check (btrim(title) <> '' and length(title) <= 160),
  stage text not null default 'enquiry' references public.tk_stages(code),
  status text not null default 'open' check (status in ('open', 'on_hold', 'completed', 'cancelled')),
  status_reason text check (status_reason is null or length(status_reason) <= 500),
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  city text check (city is null or (btrim(city) <> '' and length(city) <= 120)),
  target_open_on date,
  floor_area_m2 numeric(10,1) check (floor_area_m2 is null or (floor_area_m2 > 0 and floor_area_m2 <= 1000000)),
  budget_cents bigint check (budget_cents is null or budget_cents >= 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  plan text check (plan is null or length(plan) <= 4000),
  source text not null default 'web' check (source in ('web', 'legacy_lead', 'staff')),
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  division_id uuid not null default public.division_id_of('TK') references public.divisions(id) on delete restrict,
  constraint tk_client_projects_org_required check (org_id is not null or source = 'legacy_lead'),
  constraint tk_client_projects_reason_required check (status not in ('on_hold', 'cancelled') or nullif(btrim(coalesce(status_reason, '')), '') is not null),
  constraint tk_client_projects_completed_at_handover check (status <> 'completed' or stage = 'handover')
);
create index if not exists tk_client_projects_org_idx on public.tk_client_projects (org_id, created_at desc);
create index if not exists tk_client_projects_stage_idx on public.tk_client_projects (stage, status);
create index if not exists tk_client_projects_division_idx on public.tk_client_projects (division_id);
create index if not exists tk_client_projects_catalogue_idx on public.tk_client_projects (catalogue_project_id);
comment on table public.tk_client_projects is 'Turnkey T2: a client company''s turnkey project (TKP-). Customer-safe columns only; staff facts live in tk_client_project_staff. Written through tk_* functions only.';
alter table public.tk_client_projects enable row level security;
revoke all on public.tk_client_projects from public, anon, authenticated;
grant select on public.tk_client_projects to authenticated;
grant all on public.tk_client_projects to service_role;
drop policy if exists tk_client_projects_read on public.tk_client_projects;
create policy tk_client_projects_read on public.tk_client_projects for select to authenticated
  using (org_id in (select my_org_ids()) or (is_staff() and can('turnkey', 'view') and in_division(division_id)));

create table if not exists public.tk_client_project_stages (
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  stage text not null references public.tk_stages(code),
  started_at timestamptz,
  completed_at timestamptz,
  due_on date,
  primary key (project_id, stage),
  constraint tk_client_project_stages_order check (completed_at is null or started_at is not null)
);
comment on table public.tk_client_project_stages is 'Turnkey T2: per project and phase, when it started, when it was completed and the target date.';
alter table public.tk_client_project_stages enable row level security;
revoke all on public.tk_client_project_stages from public, anon, authenticated;
grant select on public.tk_client_project_stages to authenticated;
grant all on public.tk_client_project_stages to service_role;
drop policy if exists tk_client_project_stages_read on public.tk_client_project_stages;
-- the project's own policy decides (customer: own companies; staff: Turnkey viewers in the TK division)
create policy tk_client_project_stages_read on public.tk_client_project_stages for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

create table if not exists public.tk_client_project_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  kind text not null check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date')),
  from_stage text references public.tk_stages(code),
  to_stage text references public.tk_stages(code),
  status text check (status is null or status in ('open', 'on_hold', 'completed', 'cancelled')),
  message text check (message is null or length(message) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists tk_client_project_events_project_idx on public.tk_client_project_events (project_id, created_at);
comment on table public.tk_client_project_events is 'Turnkey T2: project history shown to the client. Who did it is in audit_log (staff only).';
alter table public.tk_client_project_events enable row level security;
revoke all on public.tk_client_project_events from public, anon, authenticated;
grant select on public.tk_client_project_events to authenticated;
grant all on public.tk_client_project_events to service_role;
drop policy if exists tk_client_project_events_read on public.tk_client_project_events;
create policy tk_client_project_events_read on public.tk_client_project_events for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

create table if not exists public.tk_client_project_staff (
  project_id uuid primary key references public.tk_client_projects(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  owner_set_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  legacy_lead_id uuid unique references public.turnkey_leads(lead_id) on delete restrict,
  is_seed boolean not null default false
);
create index if not exists tk_client_project_staff_owner_idx on public.tk_client_project_staff (owner_id);
create index if not exists tk_client_project_staff_created_by_idx on public.tk_client_project_staff (created_by);
comment on table public.tk_client_project_staff is 'Turnkey T2: staff-only facts per client project (account manager, creator, old lead, is_seed). No customer rows.';
alter table public.tk_client_project_staff enable row level security;
revoke all on public.tk_client_project_staff from public, anon, authenticated;
grant select on public.tk_client_project_staff to authenticated;
grant all on public.tk_client_project_staff to service_role;
drop policy if exists tk_client_project_staff_read on public.tk_client_project_staff;
create policy tk_client_project_staff_read on public.tk_client_project_staff for select to authenticated
  using (is_staff() and can('turnkey', 'view') and exists (select 1 from public.tk_client_projects p where p.id = project_id and in_division(p.division_id)));

-- ───────── helpers ─────────
-- creates the 8 phase rows; the first phase starts at p_at
create or replace function public.tk_init_stages(p_project uuid, p_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.tk_client_project_stages (project_id, stage, started_at)
  select p_project, s.code, case when s.seq = 1 then p_at end from public.tk_stages s
  on conflict (project_id, stage) do nothing;
$$;
revoke all on function public.tk_init_stages(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tk_init_stages(uuid, timestamptz) to service_role;

-- Turnkey editor for this project's division, on a 2FA staff session
create or replace function public.tk_staff_can_edit(p_division uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and staff_aal_ok() and can('turnkey', 'edit') and in_division(p_division);
$$;
revoke all on function public.tk_staff_can_edit(uuid) from public, anon;
grant execute on function public.tk_staff_can_edit(uuid) to authenticated, service_role;

-- ───────── 3. client enquiry ─────────
create or replace function public.tk_submit_enquiry(
  p_org uuid, p_catalogue_project text, p_title text, p_country text, p_city text, p_target_open_on date,
  p_floor_area_m2 numeric, p_budget_cents bigint, p_plan text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cat public.turnkey_projects;
  v_cat_id text := nullif(btrim(coalesce(p_catalogue_project, '')), '');
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_plan text := nullif(btrim(coalesce(p_plan, '')), '');
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_row public.tk_client_projects;
begin
  if v_uid is null then raise exception 'SIGN_IN_REQUIRED: sign in to start a project'; end if;
  if exists (select 1 from public.user_roles ur join public.roles r on r.code = ur.role_code where ur.user_id = v_uid and r.is_staff) then
    raise exception 'STAFF_NOT_CUSTOMER: staff accounts cannot start client projects';
  end if;
  if public.setting('turnkey.enabled') = 'false'::jsonb then raise exception 'TURNKEY_CLOSED: turnkey projects are not open right now'; end if;
  if p_org is null or not exists (select 1 from public.my_org_ids() o where o = p_org) then raise exception 'FORBIDDEN: not your company'; end if;
  if v_cat_id is not null then
    select * into v_cat from public.turnkey_projects tp where tp.project_id = v_cat_id and tp.status <> 'archived';
    if v_cat.project_id is null then raise exception 'UNKNOWN_PROJECT: this project is no longer in the catalogue'; end if;
  end if;
  v_title := coalesce(v_title, v_cat.title);
  if v_title is null then raise exception 'TITLE_REQUIRED: tell us what you want to open'; end if;
  if length(v_title) > 160 then raise exception 'TITLE_TOO_LONG: keep the project name under 160 characters'; end if;
  if v_plan is null or length(v_plan) < 20 then raise exception 'PLAN_REQUIRED: tell us about your plan (at least 20 characters)'; end if;
  if length(v_plan) > 4000 then raise exception 'PLAN_TOO_LONG: keep your plan under 4,000 characters'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'INVALID_COUNTRY: choose a country'; end if;
  if v_city is not null and length(v_city) > 120 then raise exception 'INVALID_CITY: keep the city under 120 characters'; end if;
  if p_target_open_on is not null and p_target_open_on <= current_date then raise exception 'INVALID_DATE: the opening date must be in the future'; end if;
  if p_floor_area_m2 is not null and (p_floor_area_m2 <= 0 or p_floor_area_m2 > 1000000) then raise exception 'INVALID_AREA: enter the space in m² (above 0)'; end if;
  if p_budget_cents is not null and p_budget_cents < 0 then raise exception 'INVALID_BUDGET: the budget cannot be negative'; end if;
  -- abuse limits (like the other public forms)
  if (select count(*) from public.tk_client_project_staff s join public.tk_client_projects p on p.id = s.project_id
       where s.created_by = v_uid and p.created_at > now() - interval '1 day') >= 5 then
    raise exception 'TOO_MANY_ENQUIRIES: you have sent 5 enquiries today; we reply to each one';
  end if;
  if (select count(*) from public.tk_client_projects p where p.org_id = p_org and p.stage = 'enquiry' and p.status = 'open') >= 20 then
    raise exception 'TOO_MANY_OPEN_ENQUIRIES: your company has 20 open enquiries; we will reply to those first';
  end if;
  if (select count(*) from public.tk_client_projects p where p.source = 'web' and p.created_at > now() - interval '1 hour') >= 300 then
    raise exception 'TRY_LATER: please try again in an hour';
  end if;

  insert into public.tk_client_projects (org_id, catalogue_project_id, title, country, city, target_open_on, floor_area_m2, budget_cents, plan, source)
  values (p_org, v_cat.project_id, v_title, v_country, v_city, p_target_open_on, p_floor_area_m2, p_budget_cents, v_plan, 'web')
  returning * into v_row;
  insert into public.tk_client_project_staff (project_id, created_by) values (v_row.id, v_uid);
  perform public.tk_init_stages(v_row.id, v_row.created_at);
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v_row.id, 'created', 'enquiry', 'Enquiry sent. We reply with the consultation fee before any work starts.');
  perform write_audit('turnkey.project_created', 'tk_client_projects', v_row.id::text,
    jsonb_build_object('code', v_row.code, 'org_id', p_org, 'catalogue_project', v_cat.project_id));
  return jsonb_build_object('id', v_row.id, 'code', v_row.code);
end $$;
revoke all on function public.tk_submit_enquiry(uuid, text, text, text, text, date, numeric, bigint, text) from public, anon;
grant execute on function public.tk_submit_enquiry(uuid, text, text, text, text, date, numeric, bigint, text) to authenticated, service_role;

-- ───────── 4. D3: frozen leads → projects at Enquiry (idempotent; turnkey_leads is only read) ─────────
do $$
declare
  l record;
  v_org uuid;
  v_id uuid;
  v_title text;
  v_plan text;
begin
  for l in
    select tl.*, tp.title as cat_title, pk.tier_name as pkg_name
      from public.turnkey_leads tl
      left join public.turnkey_projects tp on tp.project_id = tl.project_id
      left join public.turnkey_packages pk on pk.package_id = tl.package_id
     where not exists (select 1 from public.tk_client_project_staff s where s.legacy_lead_id = tl.lead_id)
     order by tl.created_at, tl.reference
  loop
    v_org := l.org_id;
    if v_org is null and l.buyer_user_id is not null then
      select m.org_id into v_org from public.org_members m where m.user_id = l.buyer_user_id
       order by (m.member_role = 'owner') desc, m.created_at limit 1;
    end if;
    v_title := left(coalesce(l.cat_title, l.project_id), 160);
    v_plan := nullif(concat_ws(E'\n',
      nullif(btrim(coalesce(l.message, '')), ''),
      case when l.pkg_name is not null then 'Package asked about: ' || l.pkg_name end,
      case when l.preferred_delivery_term is not null then 'Preferred delivery term: ' || l.preferred_delivery_term end,
      case when nullif(btrim(coalesce(l.delivery_place, '')), '') is not null then 'Delivery place: ' || btrim(l.delivery_place) end), '');
    insert into public.tk_client_projects (org_id, catalogue_project_id, title, stage, status, status_reason, country, target_open_on, plan, source,
      stage_changed_at, created_at, updated_at, division_id)
    values (v_org, l.project_id, v_title, 'enquiry',
      case when l.status = 'lost' then 'cancelled' else 'open' end,
      case when l.status = 'lost' then 'Closed in the earlier enquiry list.' end,
      l.country, l.target_open_date, left(v_plan, 4000), 'legacy_lead', l.created_at, l.created_at, now(), l.division_id)
    returning id into v_id;
    insert into public.tk_client_project_staff (project_id, owner_id, owner_set_at, legacy_lead_id, is_seed)
    values (v_id, l.assigned_to, case when l.assigned_to is not null then l.assigned_at end, l.lead_id, l.is_seed);
    perform public.tk_init_stages(v_id, l.created_at);
    insert into public.tk_client_project_events (project_id, kind, to_stage, status, message, created_at)
    values (v_id, 'migrated', 'enquiry', case when l.status = 'lost' then 'cancelled' else 'open' end,
      'Moved from your earlier Turnkey request ' || l.reference || '.', now());
  end loop;
end $$;

-- a lead sent as a guest (no company) joins the company of the account with the same verified email, on first visit
create or replace function public.tk_link_legacy_projects(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  n integer := 0;
begin
  if v_uid is null then return 0; end if;
  if exists (select 1 from public.user_roles ur join public.roles r on r.code = ur.role_code where ur.user_id = v_uid and r.is_staff) then return 0; end if;
  if p_org is null or not exists (select 1 from public.my_org_ids() o where o = p_org) then raise exception 'FORBIDDEN: not your company'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  update public.tk_client_projects p
     set org_id = p_org, updated_at = now()
    from public.tk_client_project_staff s
    join public.turnkey_leads l on l.lead_id = s.legacy_lead_id
   where s.project_id = p.id and p.org_id is null
     and (l.buyer_user_id = v_uid or (v_email is not null and lower(l.email) = v_email));
  get diagnostics n = row_count;
  if n > 0 then
    perform write_audit('turnkey.legacy_projects_linked', 'organizations', p_org::text, jsonb_build_object('count', n));
  end if;
  return n;
end $$;
revoke all on function public.tk_link_legacy_projects(uuid) from public, anon;
grant execute on function public.tk_link_legacy_projects(uuid) to authenticated, service_role;

-- the client's named contact (account manager) — name only; customers of the project's company or Turnkey staff
create or replace function public.tk_project_manager_name(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(pr.full_name), '')
    from public.tk_client_projects p
    join public.tk_client_project_staff s on s.project_id = p.id
    join public.profiles pr on pr.id = s.owner_id
   where p.id = p_project
     and (p.org_id in (select my_org_ids()) or (is_staff() and can('turnkey', 'view') and in_division(p.division_id)));
$$;
revoke all on function public.tk_project_manager_name(uuid) from public, anon;
grant execute on function public.tk_project_manager_name(uuid) to authenticated, service_role;

-- ───────── 5. staff ─────────
create or replace function public.tk_move_project_stage(p_project uuid, p_to_stage text, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_from smallint;
  v_to smallint;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors move projects'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this old enquiry is not linked to a client company yet'; end if;
  if v_msg is not null and length(v_msg) > 1000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 1,000 characters'; end if;
  select seq into v_from from public.tk_stages where code = v.stage;
  select seq into v_to from public.tk_stages where code = p_to_stage;
  if v_to is null then raise exception 'INVALID_STAGE'; end if;
  if v_to = v_from then raise exception 'SAME_STAGE: the project is already in this phase'; end if;
  if v_to > v_from + 1 then raise exception 'STAGE_SKIP: move one phase at a time'; end if;
  if v_to < v_from and v_msg is null then raise exception 'REASON_REQUIRED: tell the client why the project moves back'; end if;
  -- Payment gates (each paid phase starts after the client's payment is confirmed) are added with the fees in T3.
  if v_to > v_from then
    update public.tk_client_project_stages set completed_at = now() where project_id = v.id and stage = v.stage;
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  else
    update public.tk_client_project_stages set started_at = null, completed_at = null
     where project_id = v.id and stage in (select code from public.tk_stages where seq > v_to);
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  end if;
  update public.tk_client_projects set stage = p_to_stage, stage_changed_at = now(), updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, from_stage, to_stage, message)
  values (v.id, case when v_to > v_from then 'stage_forward' else 'stage_back' end, v.stage, p_to_stage, v_msg);
  perform write_audit('turnkey.project_stage', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.stage, 'to', p_to_stage, 'message', v_msg));
end $$;
revoke all on function public.tk_move_project_stage(uuid, text, text) from public, anon;
grant execute on function public.tk_move_project_stage(uuid, text, text) to authenticated, service_role;

create or replace function public.tk_set_project_status(p_project uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors change projects'; end if;
  if p_status not in ('open', 'on_hold', 'completed', 'cancelled') then raise exception 'INVALID_STATUS'; end if;
  if p_status = v.status then raise exception 'SAME_STATUS: the project already has this status'; end if;
  if p_status in ('on_hold', 'cancelled') and v_reason is null then raise exception 'REASON_REQUIRED: tell the client why'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  if p_status = 'completed' and v.stage <> 'handover' then raise exception 'NOT_AT_HANDOVER: a project is completed at Handover'; end if;
  update public.tk_client_projects
     set status = p_status, status_reason = case when p_status in ('on_hold', 'cancelled') then v_reason end, updated_at = now()
   where id = v.id;
  if p_status = 'completed' then
    update public.tk_client_project_stages set completed_at = now() where project_id = v.id and stage = 'handover';
  elsif v.status = 'completed' then
    update public.tk_client_project_stages set completed_at = null where project_id = v.id and stage = 'handover';
  end if;
  insert into public.tk_client_project_events (project_id, kind, status, message) values (v.id, 'status', p_status, v_reason);
  perform write_audit('turnkey.project_status', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.status, 'to', p_status, 'reason', v_reason));
end $$;
revoke all on function public.tk_set_project_status(uuid, text, text) from public, anon;
grant execute on function public.tk_set_project_status(uuid, text, text) to authenticated, service_role;

create or replace function public.tk_set_stage_due(p_project uuid, p_stage text, p_due date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_name text;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors set dates'; end if;
  select name into v_name from public.tk_stages where code = p_stage;
  if v_name is null then raise exception 'INVALID_STAGE'; end if;
  if p_due is not null and p_due < v.created_at::date then raise exception 'INVALID_DATE: the target date is before the project started'; end if;
  update public.tk_client_project_stages set due_on = p_due where project_id = v.id and stage = p_stage;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'due_date', p_stage, case when p_due is null then 'Target date for ' || v_name || ' removed.'
                                          else 'Target date for ' || v_name || ': ' || to_char(p_due, 'FMDD Mon YYYY') || '.' end);
  perform write_audit('turnkey.project_due_date', 'tk_client_projects', v.id::text, jsonb_build_object('code', v.code, 'stage', p_stage, 'due', p_due));
end $$;
revoke all on function public.tk_set_stage_due(uuid, text, date) from public, anon;
grant execute on function public.tk_set_stage_due(uuid, text, date) to authenticated, service_role;

-- staff who can be a project's account manager: admins, account managers and Turnkey editors
create or replace function public.tk_manager_candidates()
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.id, coalesce(nullif(btrim(p.full_name), ''), p.email)
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
   where is_staff() and can('turnkey', 'view')
     and (ur.role_code in ('admin', 'account_manager')
          or exists (select 1 from public.role_permissions rp where rp.role_code = ur.role_code and rp.area = 'turnkey' and rp.action = 'edit'))
   order by 2;
$$;
revoke all on function public.tk_manager_candidates() from public, anon;
grant execute on function public.tk_manager_candidates() to authenticated, service_role;

create or replace function public.tk_set_project_manager(p_project uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_old uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors choose the account manager'; end if;
  if p_user is not null and not exists (
    select 1 from public.user_roles ur where ur.user_id = p_user
       and (ur.role_code in ('admin', 'account_manager')
            or exists (select 1 from public.role_permissions rp where rp.role_code = ur.role_code and rp.area = 'turnkey' and rp.action = 'edit'))) then
    raise exception 'INVALID_MANAGER: choose an account manager or a Turnkey editor';
  end if;
  select owner_id into v_old from public.tk_client_project_staff where project_id = v.id for update;
  insert into public.tk_client_project_staff (project_id, owner_id, owner_set_at) values (v.id, p_user, case when p_user is not null then now() end)
  on conflict (project_id) do update set owner_id = excluded.owner_id, owner_set_at = excluded.owner_set_at;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  perform write_audit('turnkey.project_manager', 'tk_client_projects', v.id::text, jsonb_build_object('code', v.code, 'from', v_old, 'to', p_user));
end $$;
revoke all on function public.tk_set_project_manager(uuid, uuid) from public, anon;
grant execute on function public.tk_set_project_manager(uuid, uuid) to authenticated, service_role;
