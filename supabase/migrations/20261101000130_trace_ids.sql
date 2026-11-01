-- SPEC §21 (prompt 21-A "Before running"): one trace id across every layer.
-- The app sends header `x-trace-id` on every Supabase request (lib/supabase/server.ts); PostgREST exposes request headers
-- as the GUC `request.headers`. Direct SQL sessions (tests, pg_cron) can `set local app.trace_id = '…'` instead.
-- BEFORE INSERT triggers stamp `trace_id` (and the Postgres txid on the core tables) so no RPC had to be rewritten.
-- Additive only: nullable columns, new tables, triggers, partial indexes. No data is changed.

create or replace function public.app_trace_id() returns text
language plpgsql stable
set search_path = public
as $$
declare v text;
begin
  v := nullif(current_setting('app.trace_id', true), '');
  if v is null then
    begin
      v := nullif(current_setting('request.headers', true), '')::json ->> 'x-trace-id';
    exception when others then
      v := null;
    end;
  end if;
  if v is null or v !~ '^[A-Za-z0-9._:-]{8,64}$' then return null; end if;
  return v;
end $$;
comment on function public.app_trace_id() is 'SPEC §21: trace id of the current request (header x-trace-id via PostgREST, or app.trace_id GUC).';
grant execute on function public.app_trace_id() to anon, authenticated, service_role;

-- generic stamp: trace id when missing; TG_ARGV[0] = 'txid' also records txid_current()
create or replace function public.stamp_trace() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.trace_id is null then new.trace_id := app_trace_id(); end if;
  if TG_NARGS > 0 and TG_ARGV[0] = 'txid' then new.txid := txid_current(); end if;
  return new;
end $$;

do $$
declare
  t text;
  core text[] := array['status_history','journals','ledger_entries','outbox_events','audit_log'];
  plain text[] := array['integration_logs','webhook_deliveries','notifications','job_runs','tracking_events',
    'rfqs','quotes','proforma_invoices','orders','documents','shipments','service_requests','wallet_topups','payments',
    'tickets','ticket_messages','assistant_messages','escalations','ad_clicks','pools','pool_pledges','pool_events',
    'backups','restore_requests','currency_switch_requests','account_managers','finance_approvals','kyc_submissions'];
begin
  foreach t in array core || plain loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists trace_id text', t);
    if t = any(core) then execute format('alter table public.%I add column if not exists txid bigint', t); end if;
    execute format('create index if not exists %I on public.%I (trace_id) where trace_id is not null', t || '_trace_idx', t);
    execute format('drop trigger if exists trg_stamp_trace on public.%I', t);
    execute format('create trigger trg_stamp_trace before insert on public.%I for each row execute function public.stamp_trace(%L)',
                   t, case when t = any(core) then 'txid' else '' end);
  end loop;
end $$;

-- ledger lines inherit their journal's trace; job runs and webhook deliveries inherit their outbox event's trace
-- (so the hop stays linked even when the worker runs without the header, e.g. an older deployment).
create or replace function public.stamp_trace_from_parent() returns trigger
language plpgsql
set search_path = public
as $$
declare v text;
begin
  if new.trace_id is null then
    if TG_TABLE_NAME = 'ledger_entries' then
      select j.trace_id into v from journals j where j.id = new.journal_id;
    elsif TG_TABLE_NAME = 'job_runs' then
      select e.trace_id into v from outbox_events e where e.id = new.event_id;
    elsif TG_TABLE_NAME = 'webhook_deliveries' then
      begin
        select e.trace_id into v from outbox_events e
        where e.id = (regexp_replace(new.payload ->> 'id', '^evt_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$', '\1-\2-\3-\4-\5'))::uuid;
      exception when others then v := null;
      end;
    end if;
    new.trace_id := coalesce(v, app_trace_id());
  end if;
  if TG_TABLE_NAME = 'ledger_entries' then new.txid := txid_current(); end if;
  return new;
end $$;

drop trigger if exists trg_stamp_trace on public.ledger_entries;
create trigger trg_stamp_trace before insert on public.ledger_entries for each row execute function public.stamp_trace_from_parent();
drop trigger if exists trg_stamp_trace on public.job_runs;
create trigger trg_stamp_trace before insert on public.job_runs for each row execute function public.stamp_trace_from_parent();
drop trigger if exists trg_stamp_trace on public.webhook_deliveries;
create trigger trg_stamp_trace before insert on public.webhook_deliveries for each row execute function public.stamp_trace_from_parent();

-- integration_logs: adapter call details (SPEC §21.4 step 4)
alter table public.integration_logs
  add column if not exists endpoint text,
  add column if not exists request_sha text,
  add column if not exists response_sha text,
  add column if not exists duration_ms integer,
  add column if not exists event_id uuid;

-- email deliveries (SPEC §21.4 step 5): one row per message handed to the e-mail adapter
create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  trace_id text,
  event_id uuid references public.outbox_events(id) on delete set null,
  template text not null,
  recipient_hash text not null,
  provider text not null,
  provider_message_id text,
  status text not null check (status in ('sent','logged','failed')),
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
alter table public.email_deliveries enable row level security;
drop policy if exists email_deliveries_read on public.email_deliveries;
create policy email_deliveries_read on public.email_deliveries for select using (can('integrations','view'));
create index if not exists email_deliveries_trace_idx on public.email_deliveries (trace_id) where trace_id is not null;
create index if not exists email_deliveries_event_idx on public.email_deliveries (event_id);
drop trigger if exists trg_stamp_trace on public.email_deliveries;
create trigger trg_stamp_trace before insert on public.email_deliveries for each row execute function public.stamp_trace();

-- idempotency hits (SPEC §21.4 step 5): every replay that was absorbed as a no-op
create table if not exists public.idempotency_hits (
  id bigint generated always as identity primary key,
  trace_id text,
  scope text not null,
  key text not null,
  original_trace_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.idempotency_hits enable row level security;
drop policy if exists idempotency_hits_read on public.idempotency_hits;
create policy idempotency_hits_read on public.idempotency_hits for select using (can('integrations','view'));
create index if not exists idempotency_hits_trace_idx on public.idempotency_hits (trace_id) where trace_id is not null;
create index if not exists idempotency_hits_scope_idx on public.idempotency_hits (scope, key);
drop trigger if exists trg_stamp_trace on public.idempotency_hits;
create trigger trg_stamp_trace before insert on public.idempotency_hits for each row execute function public.stamp_trace();

-- every row of one trace, per table (service role only; used by the trace report and Admin → Integrations)
create or replace function public.trace_rows(p_trace text) returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare r record; v jsonb; out jsonb := '{}'::jsonb;
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'trace_id' order by 1
  loop
    execute format('select jsonb_agg(to_jsonb(x)) from public.%I x where x.trace_id = $1', r.table_name) into v using p_trace;
    if v is not null then out := out || jsonb_build_object(r.table_name, v); end if;
  end loop;
  return out;
end $$;
revoke all on function public.trace_rows(text) from public, anon, authenticated;
grant execute on function public.trace_rows(text) to service_role;
