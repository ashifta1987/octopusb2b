-- ODS T8 · Staff notification channel (Back Office bell, Part 7.1 "notifications (count)", phone Alerts tab 7.8). DRAFT on top of 255.
-- Why a new table: public.notifications is the customer bell (org-scoped rows, the account-manager am_read policy, customer pages).
-- A few staff alerts are written there per user today (T7 turnkey alerts) and they stay as they are. Staff need role-wide
-- alerts ("Finance: an approval is waiting") with a read state per person, which notifications cannot express.
--  1. staff_notifications: to ONE staff user (user_id) or to everyone holding a staff role (role_code) — exactly one of them.
--     read_at is the read state of a personal row; role rows keep a read state per person in staff_notification_reads.
--     dedupe_key makes an event notify once. Staff read their own rows and their roles' rows (2FA staff session).
--  2. staff_notify(...) — SECURITY DEFINER, for server code (service role) and other definer functions / triggers only.
--     staff_notifications_list / _unread_count / _mark_read — for the signed-in staff member. A role row is not shown to the
--     person whose action raised it (actor_id).
--  3. Alerts wired here (AFTER triggers only; an alert never blocks the business write — failures become warnings):
--     · Turnkey: a new project ("created" event on tk_client_project_events, i.e. tk_submit_enquiry or staff-created, not
--       legacy imports) → its account manager: the project's active manager (tk_active_manager: owner, or cover during the
--       cover period), else the company's account manager (account_managers), else role office.turnkey_unassigned_role
--       (setting; default 'admin'). tk_submit_enquiry's body is NOT changed.
--     · Turnkey: account manager or cover set on tk_client_project_staff → that person.
--     · staff_approvals (255): a new waiting approval → role finance (admin when nobody holds finance); decided → the requester.
--     · finance_approvals (existing table, existing functions unchanged): a new 'requested' row → role finance.
-- Error codes: INVALID_TARGET, NOT_STAFF, INVALID_ROLE, INVALID_INPUT: <what>, NOT_SIGNED_IN, STAFF_ONLY.
-- Down: supabase/migrations/down/20261101000256_staff_notifications.down.sql

-- ───────────────────────── 1. tables ─────────────────────────
create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  role_code text references public.roles(code) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,60}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text check (body is null or length(body) <= 1000),
  link text check (link is null or (length(link) <= 500 and link ~ '^/([^/\\]|$)')),
  ref_type text check (ref_type is null or ref_type ~ '^[a-z][a-z_]{1,39}$'),
  ref_id text check (ref_id is null or length(ref_id) between 1 and 120),
  actor_id uuid references auth.users(id) on delete set null,
  dedupe_key text check (dedupe_key is null or length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  constraint staff_notifications_one_target check ((user_id is null) <> (role_code is null)),
  constraint staff_notifications_read_personal check (read_at is null or user_id is not null)
);
create unique index if not exists staff_notifications_dedupe_key on public.staff_notifications (dedupe_key) where dedupe_key is not null;
create index if not exists staff_notifications_user_idx on public.staff_notifications (user_id, created_at desc) where user_id is not null;
create index if not exists staff_notifications_role_idx on public.staff_notifications (role_code, created_at desc) where role_code is not null;
comment on table public.staff_notifications is 'ODS T8: Back Office alerts to one staff user or a staff role. Written by staff_notify() only.';

create table if not exists public.staff_notification_reads (
  notification_id uuid not null references public.staff_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
create index if not exists staff_notification_reads_user_idx on public.staff_notification_reads (user_id);
comment on table public.staff_notification_reads is 'ODS T8: who has read a role-wide staff notification. Written by staff_notifications_mark_read().';

-- ───────────────────────── 2. RLS + grants ─────────────────────────
alter table public.staff_notifications enable row level security;
alter table public.staff_notification_reads enable row level security;
revoke all on table public.staff_notifications from public, anon, authenticated;
revoke all on table public.staff_notification_reads from public, anon, authenticated;
grant all on table public.staff_notifications, public.staff_notification_reads to service_role;

drop policy if exists staff_notifications_read on public.staff_notifications;
create policy staff_notifications_read on public.staff_notifications for select to authenticated
  using ((select public.is_staff()) and (user_id = (select auth.uid()) or (user_id is null and public.has_role(role_code))));
grant select (id, user_id, role_code, kind, title, body, link, ref_type, ref_id, created_at, read_at) on table public.staff_notifications to authenticated;

drop policy if exists staff_notification_reads_own on public.staff_notification_reads;
create policy staff_notification_reads_own on public.staff_notification_reads for select to authenticated
  using (user_id = (select auth.uid()));
grant select (notification_id, user_id, read_at) on table public.staff_notification_reads to authenticated;

-- ───────────────────────── 3. sending ─────────────────────────
-- exactly one of p_user / p_role; same p_dedupe again → the existing row's id, nothing new
create or replace function public.staff_notify(
  p_user uuid, p_role text, p_kind text, p_title text, p_body text default null, p_link text default null,
  p_ref_type text default null, p_ref_id text default null, p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_link text := nullif(btrim(coalesce(p_link, '')), ''); v_role text := nullif(btrim(coalesce(p_role, '')), '');
begin
  if (p_user is null) = (v_role is null) then raise exception 'INVALID_TARGET: one staff user or one staff role'; end if;
  if p_user is not null and not public.user_is_staff(p_user) then raise exception 'NOT_STAFF: notifications here are for staff'; end if;
  if v_role is not null and not exists (select 1 from public.roles r where r.code = v_role and r.is_staff) then raise exception 'INVALID_ROLE: %', v_role; end if;
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_.]{1,60}$' then raise exception 'INVALID_INPUT: kind'; end if;
  if length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'INVALID_INPUT: title'; end if;
  if v_link is not null and v_link !~ '^/([^/\\]|$)' then raise exception 'INVALID_INPUT: link must be a path in the app'; end if;
  if p_dedupe is not null then
    select id into v_id from public.staff_notifications where dedupe_key = p_dedupe;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.staff_notifications (user_id, role_code, kind, title, body, link, ref_type, ref_id, actor_id, dedupe_key)
  values (p_user, v_role, p_kind, left(btrim(p_title), 200), left(nullif(btrim(coalesce(p_body, '')), ''), 1000), left(v_link, 500),
          nullif(p_ref_type, ''), left(nullif(p_ref_id, ''), 120), auth.uid(), left(p_dedupe, 200))
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.staff_notifications where dedupe_key = p_dedupe; end if;
  return v_id;
end $$;

-- ───────────────────────── 4. reading (signed-in staff) ─────────────────────────
create or replace function public.staff_notifications_visible()
returns setof public.staff_notifications language sql stable security definer set search_path = public as $$
  select n.* from public.staff_notifications n
   where public.is_staff()
     and (n.user_id = auth.uid()
          or (n.user_id is null and n.actor_id is distinct from auth.uid()
              and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role_code = n.role_code)));
$$;

create or replace function public.staff_notifications_list(p_limit integer default 30, p_unread_only boolean default false, p_before timestamptz default null)
returns table (id uuid, kind text, title text, body text, link text, ref_type text, ref_id text, created_at timestamptz, read_at timestamptz, for_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.office_guard();
  return query
  select n.id, n.kind, n.title, n.body, n.link, n.ref_type, n.ref_id, n.created_at, coalesce(n.read_at, r.read_at), n.role_code
    from public.staff_notifications_visible() n
    left join public.staff_notification_reads r on r.notification_id = n.id and r.user_id = auth.uid()
   where (not coalesce(p_unread_only, false) or coalesce(n.read_at, r.read_at) is null)
     and (p_before is null or n.created_at < p_before)
   order by n.created_at desc, n.id
   limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;

create or replace function public.staff_notifications_unread_count()
returns integer language plpgsql stable security definer set search_path = public as $$
begin
  perform public.office_guard();
  return (select count(*) from public.staff_notifications_visible() n
           where n.read_at is null
             and not exists (select 1 from public.staff_notification_reads r where r.notification_id = n.id and r.user_id = auth.uid()));
end $$;

-- p_ids null = everything visible; returns how many became read
create or replace function public.staff_notifications_mark_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.office_guard(); v_a integer; v_b integer;
begin
  if p_ids is not null and cardinality(p_ids) > 500 then raise exception 'INVALID_INPUT: at most 500 at a time'; end if;
  update public.staff_notifications s set read_at = now()
   where s.user_id = v_uid and s.read_at is null and (p_ids is null or s.id = any(p_ids));
  get diagnostics v_a = row_count;
  insert into public.staff_notification_reads (notification_id, user_id)
  select n.id, v_uid from public.staff_notifications_visible() n
   where n.user_id is null and (p_ids is null or n.id = any(p_ids))
  on conflict do nothing;
  get diagnostics v_b = row_count;
  return v_a + v_b;
end $$;

-- ───────────────────────── 5. alerts ─────────────────────────
create or replace function public.office_money_text(p_minor bigint, p_currency text)
returns text language sql immutable set search_path = public as $$
  select case upper(p_currency) when 'USD' then 'US$ ' when 'CNY' then 'CN¥ ' when 'HKD' then 'HK$ ' else upper(p_currency) || ' ' end
         || to_char(p_minor / 100.0, 'FM999,999,999,990.00');
$$;

-- the role that gets money approvals: finance, or admin while nobody holds finance
create or replace function public.office_finance_role()
returns text language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.user_roles where role_code = 'finance') then 'finance' else 'admin' end;
$$;

-- 5a. Turnkey: a new project → its account manager
create or replace function public.office_tk_enquiry_alert()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record; v_to uuid; v_role text; v_org text;
begin
  select tp.id, tp.code, tp.org_id, tp.title, tp.city, tp.source into p from public.tk_client_projects tp where tp.id = new.project_id;
  if p.id is null or p.source = 'legacy_lead' then return null; end if;
  v_to := coalesce(public.tk_active_manager(p.id), (select am.staff_user_id from public.account_managers am where am.org_id = p.org_id
                                                     order by am.is_primary desc, am.assigned_at desc limit 1));
  if v_to is not null and not public.user_is_staff(v_to) then v_to := null; end if;
  if v_to is not null and v_to = auth.uid() then return null; end if;   -- staff who created it themselves
  select nullif(btrim(o.name), '') into v_org from public.organizations o where o.id = p.org_id;
  if v_to is null then
    v_role := coalesce(nullif(public.setting('office.turnkey_unassigned_role') #>> '{}', ''), 'admin');
    if not exists (select 1 from public.roles r where r.code = v_role and r.is_staff) then v_role := 'admin'; end if;
  end if;
  perform public.staff_notify(v_to, v_role, 'turnkey.enquiry',
    'New Turnkey enquiry · ' || p.code || case when v_to is null then ' (no account manager yet)' else '' end,
    p.title || coalesce(' from ' || v_org, '') || coalesce(' · ' || p.city, '') || '. Reply with the consultation fee before any work starts.',
    '/admin/turnkey/projects/' || p.code, 'tk_client_project', p.id::text, 'tk:enquiry:manager:' || p.id);
  return null;
exception when others then
  raise warning 'staff alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
drop trigger if exists trg_office_tk_enquiry_alert on public.tk_client_project_events;
create trigger trg_office_tk_enquiry_alert after insert on public.tk_client_project_events
  for each row when (new.kind = 'created') execute function public.office_tk_enquiry_alert();

-- 5b. Turnkey: account manager or cover set → that person
create or replace function public.office_tk_manager_alert()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select tp.id, tp.code, tp.title into p from public.tk_client_projects tp where tp.id = new.project_id;
  if p.id is null then return null; end if;
  if new.owner_id is not null and new.owner_id is distinct from old.owner_id and new.owner_id is distinct from auth.uid() then
    perform public.staff_notify(new.owner_id, null, 'turnkey.manager_assigned', 'You are the account manager for ' || p.code,
      p.title, '/admin/turnkey/projects/' || p.code, 'tk_client_project', p.id::text,
      'tk:manager:' || p.id || ':' || new.owner_id || ':' || coalesce(extract(epoch from new.owner_set_at)::bigint::text, ''));
  end if;
  if new.cover_id is not null and new.cover_id is distinct from old.cover_id and new.cover_id is distinct from auth.uid() then
    perform public.staff_notify(new.cover_id, null, 'turnkey.cover_assigned', 'You cover ' || p.code
      || coalesce(' from ' || to_char(new.cover_from, 'DD Mon YYYY'), '') || coalesce(' to ' || to_char(new.cover_to, 'DD Mon YYYY'), ''),
      p.title, '/admin/turnkey/projects/' || p.code, 'tk_client_project', p.id::text,
      'tk:cover:' || p.id || ':' || new.cover_id || ':' || coalesce(new.cover_from::text, '') || ':' || coalesce(new.cover_to::text, ''));
  end if;
  return null;
exception when others then
  raise warning 'staff alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
drop trigger if exists trg_office_tk_manager_alert on public.tk_client_project_staff;
create trigger trg_office_tk_manager_alert after update of owner_id, cover_id on public.tk_client_project_staff
  for each row execute function public.office_tk_manager_alert();

-- 5c. staff approvals (255): waiting → Finance; decided → the requester
create or replace function public.office_staff_approval_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'waiting' then
    perform public.staff_notify(null, public.office_finance_role(), 'approval.waiting',
      'Second approver needed · ' || new.code || ' · ' || replace(new.kind, '_', ' ') || ' ' || public.office_money_text(new.amount_minor, new.currency),
      left(new.reason, 600), '/office/approvals?item=' || new.id, 'staff_approval', new.id::text, 'approval:waiting:' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'waiting' and new.status <> 'waiting' then
    perform public.staff_notify(new.requested_by, null, 'approval.decided',
      new.code || ' ' || new.status::text || ' · ' || replace(new.kind, '_', ' ') || ' ' || public.office_money_text(new.amount_minor, new.currency),
      coalesce(new.decision_note, case when new.status = 'approved' then 'You can complete the action now.' end),
      '/office/approvals?item=' || new.id, 'staff_approval', new.id::text, 'approval:decided:' || new.id);
  end if;
  return null;
exception when others then
  raise warning 'staff alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
drop trigger if exists trg_office_staff_approval_alert on public.staff_approvals;
create trigger trg_office_staff_approval_alert after insert or update of status on public.staff_approvals
  for each row execute function public.office_staff_approval_alert();

-- 5d. finance_approvals (existing; its functions are unchanged): a new request → Finance
create or replace function public.office_finance_approval_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_notify(null, public.office_finance_role(), 'finance.approval_waiting',
    'Finance approval waiting · ' || replace(new.kind, '_', ' ') || ' ' || public.office_money_text(new.amount_cents, coalesce(new.currency::text, 'USD')),
    left(new.reason, 600), '/admin/finance', 'finance_approval', new.id::text, 'finance_approval:waiting:' || new.id);
  return null;
exception when others then
  raise warning 'staff alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
drop trigger if exists trg_office_finance_approval_alert on public.finance_approvals;
create trigger trg_office_finance_approval_alert after insert on public.finance_approvals
  for each row when (new.status = 'requested') execute function public.office_finance_approval_alert();

-- ───────────────────────── 6. function grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array['staff_notify(uuid,text,text,text,text,text,text,text,text)', 'staff_notifications_visible()',
    'staff_notifications_list(integer,boolean,timestamp with time zone)', 'staff_notifications_unread_count()',
    'staff_notifications_mark_read(uuid[])', 'office_money_text(bigint,text)', 'office_finance_role()',
    'office_tk_enquiry_alert()', 'office_tk_manager_alert()', 'office_staff_approval_alert()', 'office_finance_approval_alert()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['staff_notifications_list(integer,boolean,timestamp with time zone)', 'staff_notifications_unread_count()',
    'staff_notifications_mark_read(uuid[])'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
