-- SPEC §17 — Staff & back-office login: 2FA (aal2) everywhere for staff, step-up for sensitive actions,
-- lockout, session tracking, invitation-only staff, staff ≠ customer, admin security controls, audit with IP/device.

insert into site_settings(key, value, description, is_public) values
  ('staff_security', '{"enforce_aal2":true,"lockout_attempts":5,"lockout_minutes":15,"idle_minutes":30,"max_session_hours":12,"step_up_minutes":10,"trust_hours":12,"ip_allowlist":[],"ip_rule_roles":["admin","finance"],"ip_rule_enabled":false,"google_domain":"octopusb2b.com","staff_email_domains":["octopusb2b.com","demo.octopusb2b.com"]}',
   'Staff sign-in security: 2FA enforcement, lockout, sessions, step-up, office IP allow-list', false)
on conflict (key) do nothing;

alter table profiles add column if not exists office text;
alter table profiles add column if not exists invited_at timestamptz;
alter table profiles add column if not exists invited_by uuid references auth.users(id);
alter table profiles add column if not exists last_workspace text;

-- ───────────────────────── AAL / step-up helpers ─────────────────────────
create or replace function staff_aal_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((setting('staff_security') ->> 'enforce_aal2')::boolean, true) = false
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- fresh second factor: a TOTP (or recovery) verification within step_up_minutes (JWT amr timestamps)
create or replace function mfa_fresh(p_minutes int default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((setting('staff_security') ->> 'enforce_aal2')::boolean, true) = false
      or exists(
        select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
        where a ->> 'method' in ('totp','mfa/totp','recovery','phone')
          and to_timestamp((a ->> 'timestamp')::bigint) > now() - make_interval(mins => coalesce(p_minutes, (setting('staff_security') ->> 'step_up_minutes')::int, 10)));
$$;

create or replace function require_step_up() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' or auth.uid() is null then return; end if;
  if not user_is_staff(auth.uid()) then return; end if;   -- step-up applies to staff (customers paying from wallet are unaffected)
  if not mfa_fresh() then raise exception 'STEP_UP_REQUIRED'; end if;
end $$;

-- every staff permission now also requires an aal2 session (RLS + RPCs all go through these)
create or replace function has_permission(p_user uuid, p_area text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select (exists(select 1 from user_roles where user_id = p_user and role_code = 'admin')
       or exists(select 1 from user_roles ur join role_permissions rp on rp.role_code = ur.role_code
                 where ur.user_id = p_user and rp.area = p_area and rp.action = p_action))
     and (p_user is distinct from auth.uid() or staff_aal_ok());
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role_code = 'admin') and staff_aal_ok();
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles ur join roles r on r.code = ur.role_code where ur.user_id = auth.uid() and r.is_staff) and staff_aal_ok();
$$;

create or replace function has_role(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role_code = p_role)
     and (not exists(select 1 from roles where code = p_role and is_staff) or staff_aal_ok());
$$;

-- distributor access to assigned suppliers needs aal2 as well (supplier-portal users are not staff)
create or replace function is_my_supplier(p_supplier uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (exists(select 1 from distributor_suppliers where distributor_id = auth.uid() and supplier_id = p_supplier) and staff_aal_ok())
      or exists(select 1 from suppliers where id = p_supplier and user_id = auth.uid());
$$;

-- "is this user staff?" without the aal requirement (routing / onboarding guards)
create or replace function user_is_staff(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles ur join roles r on r.code = ur.role_code where ur.user_id = p_user and r.is_staff);
$$;

-- ───────────────────────── Step-up on sensitive actions ─────────────────────────
-- Money approvals, currency switch, restores, wallet confirmations: inject `perform require_step_up();` right after the
-- first BEGIN of each RPC (keeps their business logic byte-for-byte identical otherwise).
do $$
declare f text; v_def text; v_new text;
begin
  foreach f in array array['decide_finance_approval(uuid,boolean,text)','approve_currency_switch(uuid)','approve_restore(uuid)',
                           'restore_records(text,uuid[],text)','confirm_topup(uuid,text)','set_fx_rate(numeric,text,timestamp with time zone)',
                           'request_currency_switch(text,numeric,text,timestamp with time zone,text)','request_restore(uuid,text,text,text[],jsonb)',
                           'record_payment(uuid,bigint,text,text,text)'] loop
    select pg_get_functiondef(f::regprocedure) into v_def;
    if position('require_step_up()' in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, E'\\nbegin\\n', E'\nbegin\n  perform require_step_up();\n');
    if v_new = v_def then raise exception 'could not inject step-up into %', f; end if;
    execute v_new;
  end loop;
end $$;

-- KYC document downloads + role changes: RLS policies require a fresh code
drop policy if exists user_roles_write on user_roles;
create policy user_roles_write on user_roles for all to authenticated using (can('staff','edit') and mfa_fresh()) with check (can('staff','edit') and mfa_fresh());
drop policy if exists rp_admin on role_permissions;
create policy rp_admin on role_permissions for all to authenticated using (can('staff','edit') and mfa_fresh()) with check (can('staff','edit') and mfa_fresh());
drop policy if exists "kyc read own org or staff" on storage.objects;
create policy "kyc read own org or staff" on storage.objects for select to authenticated
  using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = my_org_id()::text or (can('customers','view') and mfa_fresh())));

-- ───────────────────────── Lockout ─────────────────────────
create table auth_lockouts (
  email text primary key,
  failed_count int not null default 0,
  last_failed_at timestamptz,
  locked_until timestamptz,
  kind text,
  updated_at timestamptz not null default now()
);
alter table auth_lockouts enable row level security;
create policy lockouts_admin on auth_lockouts for select to authenticated using (can('staff','view'));

create or replace function auth_lock_status(p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('locked', coalesce(locked_until > now(), false), 'locked_until', locked_until, 'failed', coalesce(failed_count, 0))
  from (select 1) x left join auth_lockouts l on l.email = lower(p_email);
$$;

-- record a failed password/code attempt; returns {locked, locked_until, failed, just_locked}
create or replace function auth_record_failure(p_email text, p_kind text, p_ip text default null, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := setting('staff_security'); v_max int := coalesce((s->>'lockout_attempts')::int, 5); v_min int := coalesce((s->>'lockout_minutes')::int, 15);
        l auth_lockouts; v_just boolean := false; v_uid uuid;
begin
  insert into auth_lockouts(email, failed_count, last_failed_at, kind) values (lower(p_email), 1, now(), p_kind)
  on conflict (email) do update set
    failed_count = case when auth_lockouts.locked_until is not null and auth_lockouts.locked_until < now() then 1
                        when auth_lockouts.last_failed_at < now() - make_interval(mins => v_min) then 1
                        else auth_lockouts.failed_count + 1 end,
    locked_until = case when auth_lockouts.locked_until < now() then null else auth_lockouts.locked_until end,
    last_failed_at = now(), kind = p_kind, updated_at = now()
  returning * into l;
  if l.failed_count >= v_max and (l.locked_until is null or l.locked_until < now()) then
    update auth_lockouts set locked_until = now() + make_interval(mins => v_min) where email = l.email returning * into l;
    v_just := true;
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (v_uid, case when v_just then 'auth.lockout' else 'auth.' || p_kind || '_failed' end, 'auth', lower(p_email),
            jsonb_build_object('ip', p_ip, 'device', p_ua, 'failed', l.failed_count));
  if v_just then
    insert into notifications(user_id, title, body, link)
      select ur.user_id, 'Staff account locked', lower(p_email) || ' was locked for ' || v_min || ' minutes after ' || v_max || ' failed attempts.', '/admin/staff'
      from user_roles ur where ur.role_code = 'admin';
    perform emit_event('auth.lockout', 'auth', v_uid, jsonb_build_object('email', lower(p_email), 'ip', p_ip));
  end if;
  return jsonb_build_object('locked', l.locked_until is not null and l.locked_until > now(), 'locked_until', l.locked_until,
                            'failed', l.failed_count, 'just_locked', v_just, 'max', v_max);
end $$;

create or replace function auth_record_success(p_email text) returns void
language sql security definer set search_path = public as $$
  delete from auth_lockouts where email = lower(p_email);
$$;

create or replace function auth_audit(p_user uuid, p_action text, p_ip text default null, p_ua text default null, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_log(actor_id, action, entity, entity_id, details)
  values (p_user, p_action, 'auth', p_user::text, coalesce(p_details,'{}') || jsonb_build_object('ip', p_ip, 'device', p_ua));
$$;

-- ───────────────────────── Backup codes (10, single use, hashed) ─────────────────────────
create table staff_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on staff_backup_codes(user_id);
alter table staff_backup_codes enable row level security;
create policy backup_codes_own on staff_backup_codes for select to authenticated using (user_id = auth.uid());

-- ───────────────────────── Sessions & 2FA admin controls ─────────────────────────
create or replace function admin_staff_security()
returns table(user_id uuid, email text, last_sign_in_at timestamptz, totp_factors int, active_sessions int, banned_until timestamptz,
              invited_at timestamptz, email_confirmed boolean, locked_until timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not can('staff','view') then raise exception 'FORBIDDEN'; end if;
  return query
    select u.id, u.email::text, u.last_sign_in_at,
           (select count(*)::int from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
           (select count(*)::int from auth.sessions s where s.user_id = u.id and (s.not_after is null or s.not_after > now())),
           u.banned_until, p.invited_at, u.email_confirmed_at is not null,
           (select l.locked_until from public.auth_lockouts l where l.email = lower(u.email) and l.locked_until > now())
    from auth.users u join public.profiles p on p.id = u.id
    where exists(select 1 from public.user_roles ur join public.roles r on r.code = ur.role_code where ur.user_id = u.id and r.is_staff);
end $$;

create or replace function admin_end_sessions(p_user uuid, p_reason text default null) returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not (can('staff','edit') or auth.uid() = p_user) then raise exception 'FORBIDDEN'; end if;
  if auth.uid() <> p_user then perform require_step_up(); end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), 'auth.sessions_ended', 'auth', p_user::text, jsonb_build_object('count', n, 'reason', p_reason));
  return n;
end $$;

create or replace function admin_reset_2fa(p_user uuid, p_reason text default null) returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  perform require_step_up();
  delete from auth.mfa_factors where user_id = p_user;
  get diagnostics n = row_count;
  delete from public.staff_backup_codes where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), 'auth.2fa_reset', 'auth', p_user::text, jsonb_build_object('factors', n, 'reason', p_reason));
  return n;
end $$;

create or replace function admin_unlock_account(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can('staff','edit') then raise exception 'FORBIDDEN'; end if;
  delete from auth_lockouts where email = lower(p_email);
  insert into audit_log(actor_id, action, entity, entity_id) values (auth.uid(), 'auth.unlocked', 'auth', lower(p_email));
end $$;

create or replace function update_staff_security(p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  perform require_step_up();
  update site_settings set value = value || p_settings, updated_at = now(), updated_by = auth.uid() where key = 'staff_security';
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), 'auth.security_settings', 'site_settings', 'staff_security', p_settings);
end $$;

-- ───────────────────────── Staff ≠ customer ─────────────────────────
create or replace function guard_staff_not_customer() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if user_is_staff(new.user_id) then raise exception 'STAFF_CANNOT_BE_CUSTOMER'; end if;
  return new;
end $$;
create trigger trg_staff_not_customer before insert on org_members for each row execute function guard_staff_not_customer();

create or replace function guard_customer_not_staff() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from roles where code = new.role_code and is_staff) and exists(select 1 from org_members where user_id = new.user_id) then
    raise exception 'CUSTOMER_CANNOT_BE_STAFF';
  end if;
  return new;
end $$;
create trigger trg_customer_not_staff before insert on user_roles for each row execute function guard_customer_not_staff();

-- email belongs to staff? (customer sign-up form check)
create or replace function email_is_staff(p_email text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists(select 1 from auth.users u where lower(u.email) = lower(p_email) and user_is_staff(u.id))
      or split_part(lower(p_email), '@', 2) in (select jsonb_array_elements_text(setting('staff_security') -> 'staff_email_domains'));
$$;

-- ───────────────────────── Grants ─────────────────────────
do $$ declare f text;
begin
  foreach f in array array['staff_aal_ok()','mfa_fresh(integer)','require_step_up()','user_is_staff(uuid)','admin_staff_security()',
                           'admin_end_sessions(uuid,text)','admin_reset_2fa(uuid,text)','admin_unlock_account(text)','update_staff_security(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['auth_lock_status(text)','auth_record_failure(text,text,text,text)','auth_record_success(text)',
                           'auth_audit(uuid,text,text,text,jsonb)','email_is_staff(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
