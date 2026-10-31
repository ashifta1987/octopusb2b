-- SPEC §16 — Data backup and restore (layer 2 own backups, layer 3 exports, partial restore, maintenance mode).
-- Backups themselves run in GitHub Actions (backup.yml / restore.yml); they report back through service-role RPCs below.

-- ───────────────────────── Permissions: area "Backups & restore" (admin only by default) ─────────────────────────
alter table role_permissions drop constraint role_permissions_action_check;
alter table role_permissions add constraint role_permissions_action_check
  check (action in ('view','create','edit','delete','approve','export','backup','download','request_restore','approve_restore'));
insert into permission_areas(code, name, sort) values ('backups', 'Backups & restore', 19) on conflict (code) do nothing;

-- ───────────────────────── Settings ─────────────────────────
insert into site_settings(key, value, description, is_public) values
  ('maintenance_mode', '{"enabled":false,"message":"We are performing scheduled maintenance. Please try again shortly.","retry_after":900}',
   'Maintenance mode: storefront/portals show a notice, API returns 503, outbox pauses', true),
  ('backup_settings', '{"schedule":"0 18 * * *","schedule_label":"Nightly 02:00 China time","timezone":"Asia/Shanghai","keep_daily":14,"keep_weekly":8,"keep_monthly":12,"keep_exports_months":12,"offsite":{"provider":"","bucket":"","endpoint":"","region":"auto","last_test_at":null,"last_test_ok":null},"key_fingerprint":"","alert_email":"support@octopusb2b.com","monthly_drill":true,"alert_missing_hours":26,"pitr_enabled":false,"require_mfa":true}',
   'Backup schedule, retention, off-site storage (no secrets), key fingerprint, alerts', false)
on conflict (key) do nothing;

-- ───────────────────────── Tables ─────────────────────────
create sequence if not exists seq_restore start 1;
create sequence if not exists seq_export start 1;

create table backups (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('BK-' || to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MMDD-HH24MI')),
  kind text not null default 'full' check (kind in ('full','database','storage')),
  trigger text not null default 'scheduled' check (trigger in ('scheduled','manual','drill','retry')),
  retention_class text not null default 'daily' check (retention_class in ('daily','weekly','monthly','manual')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','expired')),
  progress int not null default 0 check (progress between 0 and 100),
  includes jsonb not null default '{"database":true,"buckets":[]}',
  size_bytes bigint,
  location text,                       -- off-site object prefix (no credentials)
  manifest jsonb,                      -- files, sha256, row counts, ledger totals per currency, migration version
  checksum_ok boolean,
  migration_version text,
  note text,
  error text,
  github_run_id text,
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on backups(created_at desc);

create table backup_files (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null references backups(id) on delete cascade,
  path text not null,
  kind text not null check (kind in ('db_roles','db_schema','db_data','storage','manifest')),
  bucket text,
  size_bytes bigint,
  sha256 text,
  created_at timestamptz not null default now()
);
create index on backup_files(backup_id);

create type restore_status as enum ('draft','verifying','verified','pending_approval','approved','running','completed','failed','cancelled');
create table restore_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('RS-' || lpad(nextval('seq_restore')::text, 4, '0')),
  backup_id uuid not null references backups(id),
  restore_type text not null check (restore_type in ('full_staging','full_production','partial','drill')),
  target text not null check (target in ('scratch','staging','production')),
  modules text[] not null default '{}',
  records jsonb not null default '{}',          -- partial: {"products":[uuid,...], ...}
  reason text not null,
  touches_money boolean not null default false,
  status restore_status not null default 'draft',
  requested_by uuid not null references auth.users(id),
  requester_mfa_at timestamptz,
  approved_by uuid references auth.users(id),
  approver_mfa_at timestamptz,
  approved_at timestamptz,
  github_run_id text,
  started_at timestamptz,
  finished_at timestamptz,
  report jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_restore_updated before update on restore_requests for each row execute function set_updated_at();

create table restore_checks (
  id uuid primary key default gen_random_uuid(),
  restore_id uuid references restore_requests(id) on delete cascade,
  backup_id uuid references backups(id) on delete cascade,
  phase text not null default 'verify' check (phase in ('verify','post_restore','drill','backup')),
  kind text not null check (kind in ('checksums','row_counts','ledger_balanced','migration_version','integration_keys','storage','other')),
  status text not null check (status in ('pass','fail','note')),
  detail text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index on restore_checks(restore_id);
create index on restore_checks(backup_id);

create table data_exports (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('EX-' || lpad(nextval('seq_export')::text, 4, '0')),
  title text,
  modules text[] not null check (array_length(modules, 1) >= 1),
  date_from date,
  date_to date,
  format text not null check (format in ('xlsx','csv','json')),
  status text not null default 'queued' check (status in ('queued','running','ready','failed','expired')),
  trigger text not null default 'manual' check (trigger in ('manual','monthly')),
  file_path text,
  size_bytes bigint,
  row_counts jsonb,
  email_link boolean not null default false,
  error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz
);

do $$ declare t text;
begin
  foreach t in array array['backups','backup_files','restore_requests','restore_checks','data_exports'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
create policy backups_read on backups for select to authenticated using (can('backups','view'));
create policy backup_files_read on backup_files for select to authenticated using (can('backups','view'));
create policy restore_read on restore_requests for select to authenticated using (can('backups','view') or requested_by = auth.uid());
create policy restore_checks_read on restore_checks for select to authenticated using (can('backups','view'));
create policy exports_read on data_exports for select to authenticated using (can('backups','export') or can('backups','view'));

insert into storage.buckets (id, name, public) values ('exports', 'exports', false) on conflict (id) do nothing;
-- exports are written/read by the server (service role) and handed out as short signed URLs only.

-- ───────────────────────── Recovery schema (partial restore staging area) ─────────────────────────
create schema if not exists recovery;
revoke all on schema recovery from public, anon, authenticated;
grant usage on schema recovery to service_role;
alter default privileges in schema recovery revoke all on tables from public, anon, authenticated;

-- ───────────────────────── Helpers ─────────────────────────
create or replace function mfa_recent() returns boolean
language sql stable security definer set search_path = public as $$
  -- re-entered 2FA: aal2 session. Can be relaxed with backup_settings.require_mfa=false (e.g. before staff enrol TOTP).
  select coalesce((setting('backup_settings') ->> 'require_mfa')::boolean, true) = false
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function money_modules() returns text[] language sql immutable as $$
  select array['orders','invoices','ledger','wallet','payments','finance']::text[];
$$;

-- ───────────────────────── Backups ─────────────────────────
create or replace function request_backup(p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not can('backups','backup') then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from backups where status in ('queued','running') and created_at > now() - interval '3 hours') then
    raise exception 'BACKUP_ALREADY_RUNNING';
  end if;
  insert into backups(trigger, retention_class, status, note, created_by,
                      code)
    values ('manual', 'manual', 'queued', p_note, auth.uid(),
            'BK-' || to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MMDD-HH24MI'))
    returning id into v;
  perform write_audit('backup.requested', 'backups', v::text, jsonb_build_object('note', p_note));
  return v;
end $$;

-- called by the workflow callback route (service role) — create or update a backup row
create or replace function backup_report(p_code text, p_status text, p_progress int default null, p_trigger text default null,
  p_retention_class text default null, p_size_bytes bigint default null, p_location text default null, p_manifest jsonb default null,
  p_files jsonb default null, p_checksum_ok boolean default null, p_migration_version text default null, p_error text default null,
  p_github_run_id text default null, p_includes jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; f jsonb;
begin
  select id into v from backups where code = p_code;
  if v is null then
    insert into backups(code, trigger, retention_class, status, started_at)
      values (p_code, coalesce(p_trigger,'scheduled'), coalesce(p_retention_class,'daily'), 'running', now()) returning id into v;
  end if;
  update backups set
    status = coalesce(p_status, status),
    progress = coalesce(p_progress, case when p_status = 'completed' then 100 else progress end),
    trigger = coalesce(p_trigger, trigger),
    retention_class = coalesce(p_retention_class, retention_class),
    size_bytes = coalesce(p_size_bytes, size_bytes),
    location = coalesce(p_location, location),
    manifest = coalesce(p_manifest, manifest),
    includes = coalesce(p_includes, includes),
    checksum_ok = coalesce(p_checksum_ok, checksum_ok),
    migration_version = coalesce(p_migration_version, migration_version),
    error = coalesce(p_error, error),
    github_run_id = coalesce(p_github_run_id, github_run_id),
    started_at = coalesce(started_at, case when p_status in ('running','completed','failed') then now() end),
    finished_at = case when p_status in ('completed','failed') then now() else finished_at end
  where id = v;
  if p_files is not null then
    delete from backup_files where backup_id = v;
    for f in select * from jsonb_array_elements(p_files) loop
      insert into backup_files(backup_id, path, kind, bucket, size_bytes, sha256)
      values (v, f->>'path', coalesce(f->>'kind','storage'), f->>'bucket', nullif(f->>'size_bytes','')::bigint, f->>'sha256');
    end loop;
  end if;
  if p_status in ('completed','failed') then
    insert into audit_log(action, entity, entity_id, details)
      values ('backup.' || p_status, 'backups', v::text, jsonb_build_object('code', p_code, 'size', p_size_bytes, 'error', p_error));
    if p_status = 'failed' then
      perform emit_event('backup.failed', 'backup', v, jsonb_build_object('code', p_code, 'error', p_error));
    end if;
  end if;
  return v;
end $$;

-- retention: mark backups expired beyond keep_daily / keep_weekly / keep_monthly (workflow deletes the objects)
create or replace function backup_retention_plan() returns table(id uuid, code text, location text)
language plpgsql security definer set search_path = public as $$
declare s jsonb := setting('backup_settings');
begin
  return query
  with ranked as (
    select b.id, b.code, b.location, b.retention_class,
           row_number() over (partition by b.retention_class order by b.created_at desc) rn
    from backups b where b.status = 'completed'
  )
  select r.id, r.code, r.location from ranked r
  where (r.retention_class = 'daily' and r.rn > coalesce((s->>'keep_daily')::int, 14))
     or (r.retention_class = 'weekly' and r.rn > coalesce((s->>'keep_weekly')::int, 8))
     or (r.retention_class = 'monthly' and r.rn > coalesce((s->>'keep_monthly')::int, 12));
end $$;

create or replace function backup_mark_expired(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update backups set status = 'expired', expires_at = now() where id = any(p_ids) and status = 'completed';
  get diagnostics n = row_count; return n;
end $$;

-- monitoring: true when no successful backup within alert_missing_hours
create or replace function backup_overdue() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists(select 1 from backups where status = 'completed'
                    and finished_at > now() - make_interval(hours => coalesce((setting('backup_settings')->>'alert_missing_hours')::int, 26)));
$$;

-- ───────────────────────── Restore workflow ─────────────────────────
create or replace function request_restore(p_backup uuid, p_type text, p_reason text, p_modules text[] default '{}', p_records jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; b record; v_target text; v_money boolean;
begin
  if not can('backups','request_restore') then raise exception 'FORBIDDEN'; end if;
  if not mfa_recent() then raise exception 'MFA_REQUIRED'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into b from backups where id = p_backup;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if b.status <> 'completed' then raise exception 'BACKUP_NOT_COMPLETED'; end if;
  v_target := case p_type when 'full_production' then 'production' when 'full_staging' then 'staging' when 'drill' then 'scratch' else 'production' end;
  v_money := p_type in ('full_production','full_staging') or coalesce(p_modules && money_modules(), false);
  if p_type = 'partial' and coalesce(array_length(p_modules,1),0) = 0 then raise exception 'MODULES_REQUIRED'; end if;
  insert into restore_requests(backup_id, restore_type, target, modules, records, reason, touches_money, status, requested_by, requester_mfa_at)
    values (p_backup, p_type, v_target, coalesce(p_modules,'{}'), coalesce(p_records,'{}'), p_reason, v_money, 'verifying', auth.uid(),
            case when coalesce(auth.jwt() ->> 'aal','') = 'aal2' then now() end)
    returning id into v;
  perform write_audit('restore.requested', 'restore_requests', v::text,
    jsonb_build_object('backup', b.code, 'type', p_type, 'modules', p_modules, 'reason', p_reason));
  return v;
end $$;

-- workflow callback (service role): verification / run results
create or replace function restore_report(p_id uuid, p_status restore_status, p_checks jsonb default null, p_report jsonb default null,
  p_error text default null, p_github_run_id text default null, p_phase text default 'verify')
returns void language plpgsql security definer set search_path = public as $$
declare r record; c jsonb; v_failed boolean := false;
begin
  select * into r from restore_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if p_checks is not null then
    for c in select * from jsonb_array_elements(p_checks) loop
      insert into restore_checks(restore_id, backup_id, phase, kind, status, detail, data)
      values (p_id, r.backup_id, coalesce(p_phase,'verify'), coalesce(c->>'kind','other'), c->>'status', c->>'detail', c->'data');
      if c->>'status' = 'fail' then v_failed := true; end if;
    end loop;
  end if;
  update restore_requests set
    status = case when p_status = 'verified' and v_failed then 'failed'::restore_status
                  when p_status = 'verified' then 'pending_approval'::restore_status    -- verified → waits for the second approver
                  else p_status end,
    report = coalesce(p_report, report), error = coalesce(p_error, error),
    github_run_id = coalesce(p_github_run_id, github_run_id),
    started_at = case when p_status = 'running' then now() else started_at end,
    finished_at = case when p_status in ('completed','failed') then now() else finished_at end
  where id = p_id;
  insert into audit_log(action, entity, entity_id, details)
    values ('restore.' || p_status, 'restore_requests', p_id::text, jsonb_build_object('failed_checks', v_failed, 'error', p_error));
  if p_status in ('completed','failed') then
    perform emit_event('restore.' || p_status, 'restore', p_id, jsonb_build_object('code', r.code));
  end if;
end $$;

create or replace function approve_restore(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not can('backups','approve_restore') then raise exception 'FORBIDDEN'; end if;
  if not mfa_recent() then raise exception 'MFA_REQUIRED'; end if;
  select * into r from restore_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending_approval' then raise exception 'INVALID_TRANSITION: %', r.status; end if;
  if r.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE'; end if;
  if exists(select 1 from restore_checks where restore_id = p_id and phase = 'verify' and status = 'fail') then raise exception 'VERIFICATION_FAILED'; end if;
  -- second approver: Finance for anything touching money, otherwise another Admin
  if r.touches_money and not (has_role('finance') or is_admin()) then raise exception 'NEEDS_FINANCE_APPROVER'; end if;
  if not r.touches_money and not is_admin() then raise exception 'NEEDS_ADMIN_APPROVER'; end if;
  update restore_requests set status = 'approved', approved_by = auth.uid(), approved_at = now(),
    approver_mfa_at = case when coalesce(auth.jwt() ->> 'aal','') = 'aal2' then now() end where id = p_id;
  perform write_audit('restore.approved', 'restore_requests', p_id::text, null);
end $$;

create or replace function cancel_restore(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from restore_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if not (r.requested_by = auth.uid() or can('backups','approve_restore')) then raise exception 'FORBIDDEN'; end if;
  if r.status in ('running','completed','failed','cancelled') then raise exception 'INVALID_TRANSITION: %', r.status; end if;
  update restore_requests set status = 'cancelled', error = coalesce(p_reason, error) where id = p_id;
  perform write_audit('restore.cancelled', 'restore_requests', p_id::text, jsonb_build_object('reason', p_reason));
end $$;

-- mark approved → running (called by the trigger route before dispatching restore.yml)
create or replace function start_restore(p_id uuid) returns restore_requests
language plpgsql security definer set search_path = public as $$
declare r restore_requests;
begin
  if not can('backups','approve_restore') and not can('backups','request_restore') then raise exception 'FORBIDDEN'; end if;
  select * into r from restore_requests where id = p_id for update;
  if r.status <> 'approved' then raise exception 'INVALID_TRANSITION: %', r.status; end if;
  update restore_requests set status = 'running', started_at = now() where id = p_id returning * into r;
  perform write_audit('restore.started', 'restore_requests', p_id::text, null);
  return r;
end $$;

-- ───────────────────────── Partial restore from the recovery schema ─────────────────────────
-- Tables that may be restored row-by-row. Money tables (ledger, journals, payments, wallets, orders, invoices, approvals, payouts) are NEVER restored:
-- corrections there go through finance adjustments (SPEC §16.3).
create or replace function restorable_tables() returns text[] language sql immutable as $$
  select array['products','price_tiers','product_specs','product_media','categories','tags','suppliers','certificates',
               'organizations','addresses','kyc_submissions','kyc_documents','pages','branches','banners','terms_versions',
               'services','tickets','ticket_messages','support_macros','rfqs','ad_campaigns','api_clients','webhook_endpoints']::text[];
$$;

create or replace function recovery_tables() returns table(table_name text, row_count bigint, restorable boolean)
language plpgsql security definer set search_path = public as $$
declare t text; n bigint;
begin
  if not can('backups','view') then raise exception 'FORBIDDEN'; end if;
  for t in select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'recovery' and c.relkind = 'r' order by 1 loop
    execute format('select count(*) from recovery.%I', t) into n;
    table_name := t; row_count := n; restorable := t = any(restorable_tables());
    return next;
  end loop;
end $$;

-- side-by-side compare: [{id, current, backup, status: missing|changed|same}]
create or replace function recovery_compare(p_table text, p_ids uuid[] default null, p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not can('backups','view') then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'recovery' and c.relname = p_table) then
    raise exception 'NOT_IN_RECOVERY: %', p_table;
  end if;
  if not exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = p_table) then raise exception 'UNKNOWN_TABLE'; end if;
  execute format($q$
    select coalesce(jsonb_agg(x order by x->>'status', x->>'id'), '[]') from (
      select jsonb_build_object('id', b.id, 'backup', to_jsonb(b), 'current', to_jsonb(c),
             'status', case when c.id is null then 'missing' when to_jsonb(b) - 'updated_at' = to_jsonb(c) - 'updated_at' then 'same' else 'changed' end) x
      from recovery.%1$I b left join public.%1$I c on c.id = b.id
      where ($1 is null or b.id = any($1))
      limit $2) s $q$, p_table)
  into v using p_ids, p_limit;
  return v;
end $$;

create or replace function restore_records(p_table text, p_ids uuid[], p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare v_cols text; v_upd text; n int;
begin
  if not can('backups','approve_restore') then raise exception 'FORBIDDEN'; end if;
  if not mfa_recent() then raise exception 'MFA_REQUIRED'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_table in ('ledger_entries','journals','ledger_accounts','payments','wallet_topups','wallet_withdrawals','finance_approvals','payouts',
                 'orders','proforma_invoices','documents','ad_clicks','ad_charges') then
    raise exception 'MONEY_RECORDS_NOT_RESTORABLE: %', p_table;
  end if;
  if not (p_table = any(restorable_tables())) then raise exception 'TABLE_NOT_RESTORABLE: %', p_table; end if;
  if not exists(select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'recovery' and c.relname = p_table) then
    raise exception 'NOT_IN_RECOVERY: %', p_table;
  end if;
  -- columns present in BOTH schemas, excluding generated columns
  select string_agg(quote_ident(p.column_name), ', ' order by p.ordinal_position),
         string_agg(case when p.column_name <> 'id' then quote_ident(p.column_name) || ' = excluded.' || quote_ident(p.column_name) end, ', ' order by p.ordinal_position)
    into v_cols, v_upd
  from information_schema.columns p
  join information_schema.columns r on r.table_schema = 'recovery' and r.table_name = p.table_name and r.column_name = p.column_name
  where p.table_schema = 'public' and p.table_name = p_table and p.is_generated = 'NEVER';
  execute format('insert into public.%1$I (%2$s) select %2$s from recovery.%1$I where id = any($1) on conflict (id) do update set %3$s',
                 p_table, v_cols, v_upd) using p_ids;
  get diagnostics n = row_count;
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'restore.records', p_table, array_to_string(p_ids, ','), jsonb_build_object('count', n, 'reason', p_reason));
  return n;
end $$;

-- ───────────────────────── Maintenance mode ─────────────────────────
create or replace function set_maintenance(p_enabled boolean, p_message text default null, p_retry_after int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  update site_settings set value = jsonb_build_object(
      'enabled', p_enabled,
      'message', coalesce(p_message, value->>'message'),
      'retry_after', coalesce(p_retry_after, (value->>'retry_after')::int, 900),
      'since', case when p_enabled then now() else null end),
    updated_at = now()
  where key = 'maintenance_mode';
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'maintenance.' || case when p_enabled then 'on' else 'off' end, 'site_settings', 'maintenance_mode', jsonb_build_object('message', p_message));
end $$;

create or replace function maintenance_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((setting('maintenance_mode') ->> 'enabled')::boolean, false);
$$;

-- ───────────────────────── Data exports ─────────────────────────
create or replace function request_export(p_modules text[], p_format text, p_from date default null, p_to date default null,
  p_email boolean default false, p_title text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not can('backups','export') then raise exception 'FORBIDDEN'; end if;
  if p_format not in ('xlsx','csv','json') then raise exception 'INVALID_FORMAT'; end if;
  if p_modules is null or array_length(p_modules,1) is null then raise exception 'MODULES_REQUIRED'; end if;
  if not (p_modules <@ array['customers','suppliers','products','categories','orders','invoices','ledger','wallet','services','tickets','cms']) then
    raise exception 'UNKNOWN_MODULE';
  end if;
  insert into data_exports(title, modules, date_from, date_to, format, email_link, created_by, expires_at)
    values (p_title, p_modules, p_from, p_to, p_format, coalesce(p_email,false), auth.uid(),
            now() + make_interval(months => coalesce((setting('backup_settings')->>'keep_exports_months')::int, 12)))
    returning id into v;
  perform write_audit('export.requested', 'data_exports', v::text, jsonb_build_object('modules', p_modules, 'format', p_format));
  perform emit_event('export.requested', 'data_export', v, jsonb_build_object('modules', p_modules));
  return v;
end $$;

create or replace function update_backup_settings(p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  -- never store secrets here: drop any key that looks like a credential
  update site_settings set value = (value || (p_settings - 'access_key' - 'secret_key' - 'secret' - 'password' - 'private_key')), updated_at = now(), updated_by = auth.uid()
  where key = 'backup_settings';
  perform write_audit('backup.settings', 'site_settings', 'backup_settings', p_settings - 'access_key' - 'secret_key' - 'secret' - 'password' - 'private_key');
end $$;

-- ───────────────────────── Grants ─────────────────────────
do $$ declare f text;
begin
  foreach f in array array['request_backup(text)','request_restore(uuid,text,text,text[],jsonb)','approve_restore(uuid)','cancel_restore(uuid,text)',
                           'start_restore(uuid)','recovery_tables()','recovery_compare(text,uuid[],integer)','restore_records(text,uuid[],text)',
                           'set_maintenance(boolean,text,integer)','request_export(text[],text,date,date,boolean,text)','update_backup_settings(jsonb)',
                           'backup_overdue()','mfa_recent()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['backup_report(text,text,integer,text,text,bigint,text,jsonb,jsonb,boolean,text,text,text,jsonb)',
                           'restore_report(uuid,restore_status,jsonb,jsonb,text,text,text)','backup_retention_plan()','backup_mark_expired(uuid[])'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'grant execute on function public.maintenance_enabled() to anon, authenticated, service_role';
end $$;
