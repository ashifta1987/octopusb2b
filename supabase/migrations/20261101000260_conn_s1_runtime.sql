-- CONN S1 · Connector runtime (migration 260; after 256; 257–259 are reserved for the ODS builder). No keys needed, no platform called here.
-- Builds on C0 (250): store_connections / store_credentials / store_oauth_states, the Connector registry, ds_order_intake.
--   1. Connection lifecycle RPCs (service role; disconnect also for the merchant): connecting → active → needs_reconnect →
--      disconnected. A connection row is created only after a VERIFIED connect (platform approval / tested key), never from a
--      pasted link; another account's store is refused (ALREADY_LINKED).
--   2. Signed webhooks: every connector webhook lands in the existing webhook_inbox (dedupe on source + event id; bad signatures
--      kept without payload, for the health card), linked to its store connection; a claim / done pair drives the processor.
--   3. Store tasks (dropship_channel_tasks, DS8): tasks are "waiting_store" for every channel with an ACTIVE store connection
--      (was: Shopify only), with attempts, back-off and "failed" after 8 tries (staff Retry); new action send_tracking, queued
--      when Warehouse OS ships a Dropship order (tracking number + the merchant-branded /t/ link).
--   4. Order catch-up targets (hourly pull for missed webhooks) and one scheduled job (pg_cron → pg_net → /api/cron/connector-sync)
--      that makes no HTTP call while there is nothing to do.
-- Money: none. Every lifecycle change is audited with write_audit(). RLS stays on every table. search_path = public.

-- ───────────────────────── 1. existing tables ─────────────────────────
alter table public.webhook_inbox add column if not exists store_connection_id uuid references public.store_connections(id) on delete set null;
create index if not exists webhook_inbox_todo_idx on public.webhook_inbox (received_at) where processed_at is null;
create index if not exists webhook_inbox_connection_idx on public.webhook_inbox (store_connection_id, received_at desc);

alter table public.dropship_channel_tasks drop constraint if exists dropship_channel_tasks_action_check;
alter table public.dropship_channel_tasks add constraint dropship_channel_tasks_action_check
  check (action = any (array['release_fulfillment', 'accept_cancellation', 'reject_cancellation', 'update_tracking', 'send_tracking']));
alter table public.dropship_channel_tasks drop constraint if exists dropship_channel_tasks_status_check;
alter table public.dropship_channel_tasks add constraint dropship_channel_tasks_status_check
  check (status = any (array['waiting_store', 'done', 'not_needed', 'failed']));
alter table public.dropship_channel_tasks add column if not exists store_connection_id uuid references public.store_connections(id) on delete set null;
alter table public.dropship_channel_tasks add column if not exists attempts integer not null default 0 check (attempts between 0 and 100);
alter table public.dropship_channel_tasks add column if not exists next_attempt_at timestamptz;
alter table public.dropship_channel_tasks add column if not exists last_error text check (last_error is null or length(last_error) <= 300);

-- ───────────────────────── 2. store tasks follow the connection ─────────────────────────
-- the active connection of this organisation for that channel (one per platform is the normal case; newest wins)
create or replace function public.c1_active_connection(p_org uuid, p_channel text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.store_connections c
   where c.org_id = p_org and c.platform = p_channel and c.status = 'active'
   order by c.connected_at desc nulls last, c.created_at desc limit 1
$$;

-- ───────────────────────── 3. send tracking when Warehouse OS ships a Dropship order ─────────────────────────
create or replace function public.c1_wh_order_shipped()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders;
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' and new.store_order_id is not null then
    select * into so from public.store_orders where id = new.store_order_id;
    -- the merchant's channel setting "send tracking to my store" (DS14; on unless switched off)
    if so.id is not null and coalesce((select s.send_tracking from public.dropship_channel_settings s where s.org_id = so.org_id and s.channel = so.channel), true) then
      perform public.ds_order_channel_task(so.id, so.org_id, so.channel, 'send_tracking', jsonb_build_object(
        'wh_order_code', new.code,
        'tracking_token', new.tracking_token,
        'tracking_numbers', coalesce((select jsonb_agg(s.tracking_no order by s.created_at) from public.wh_shipments s where s.order_id = new.id and s.status <> 'voided'), '[]'::jsonb),
        'carrier', (select s.carrier from public.wh_shipments s where s.order_id = new.id and s.status <> 'voided' order by s.created_at limit 1),
        'shipped_at', coalesce(new.shipped_at, now())));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_c1_wh_order_shipped on public.wh_orders;
create trigger trg_c1_wh_order_shipped after update of status on public.wh_orders
  for each row execute function public.c1_wh_order_shipped();

-- ───────────────────────── 4. connection lifecycle ─────────────────────────
-- called by the server after the platform confirmed the merchant's approval (OAuth / WooCommerce key callback) or a pasted key
-- passed its test; the row starts "connecting" and becomes "active" once the connector's first test succeeds
create or replace function public.c1_connection_upsert(p_org uuid, p_platform text, p_shop_domain text, p_store_url text, p_shop_name text,
                                                       p_currency text, p_external_store_id text, p_scopes text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text := lower(btrim(coalesce(p_shop_domain, '')));
  v_id uuid;
  v_other uuid;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then raise exception 'NOT_FOUND: Organisation not found.'; end if;
  if p_platform is null or not (p_platform = any (public.c0_platforms('store'))) then raise exception 'INVALID_INPUT: Unknown platform.'; end if;
  if p_platform = 'shopify' then raise exception 'NOT_SUPPORTED: Shopify connects through its own app (Step 5).'; end if;
  select c.org_id into v_other from public.store_connections c
   where c.platform = p_platform and c.shop_domain = v_domain and c.status <> 'disconnected' and c.org_id <> p_org limit 1;
  if v_other is not null then raise exception 'ALREADY_LINKED: This store is already linked to another Octopus account.'; end if;
  select c.id into v_id from public.store_connections c
   where c.org_id = p_org and c.platform = p_platform and c.shop_domain = v_domain and c.status <> 'disconnected' limit 1;
  if v_id is null then
    insert into public.store_connections (org_id, platform, shop_domain, store_url, detected_platform, shop_name, shop_currency, external_store_id, scopes, status)
    values (p_org, p_platform, v_domain, p_store_url, p_platform, left(nullif(btrim(coalesce(p_shop_name, '')), ''), 120),
            nullif(upper(btrim(coalesce(p_currency, ''))), '')::char(3), nullif(btrim(coalesce(p_external_store_id, '')), ''), p_scopes, 'connecting')
    returning id into v_id;
    perform write_audit('store_connection.created', 'store_connections', v_id::text, jsonb_build_object('org_id', p_org, 'platform', p_platform, 'shop', v_domain));
  else
    update public.store_connections set store_url = coalesce(p_store_url, store_url), shop_name = coalesce(left(nullif(btrim(coalesce(p_shop_name, '')), ''), 120), shop_name),
           shop_currency = coalesce(nullif(upper(btrim(coalesce(p_currency, ''))), '')::char(3), shop_currency),
           external_store_id = coalesce(nullif(btrim(coalesce(p_external_store_id, '')), ''), external_store_id), scopes = coalesce(p_scopes, scopes),
           status = case when status = 'active' then status else 'connecting' end, updated_at = now()
     where id = v_id;
    perform write_audit('store_connection.reauthorised', 'store_connections', v_id::text, jsonb_build_object('org_id', p_org, 'platform', p_platform, 'shop', v_domain));
  end if;
  return v_id;
end $$;

create or replace function public.c1_connection_set_status(p_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.store_connections;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 300);
begin
  select * into c from public.store_connections where id = p_id for update;
  if c.id is null then raise exception 'NOT_FOUND: Store connection not found.'; end if;
  if p_status not in ('active', 'needs_reconnect') then raise exception 'INVALID_INPUT: Status must be active or needs_reconnect.'; end if;
  if c.status = 'disconnected' then raise exception 'DISCONNECTED: This store was disconnected; connect it again.'; end if;
  if p_status = 'active' then
    update public.store_connections set status = 'active', connected_at = coalesce(connected_at, now()), status_reason = null, last_error = null, last_error_at = null, updated_at = now()
     where id = p_id;
  else
    update public.store_connections set status = 'needs_reconnect', status_reason = coalesce(v_reason, 'The store refused our access. Reconnect it.'),
           last_error = coalesce(v_reason, 'The store refused our access. Reconnect it.'), last_error_at = now(), updated_at = now()
     where id = p_id;
  end if;
  perform write_audit('store_connection.' || p_status, 'store_connections', p_id::text, jsonb_build_object('org_id', c.org_id, 'platform', c.platform, 'from', c.status, 'reason', v_reason));
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- one row in integration_logs per sync run (feeds "failures in 24 h" on the staff card); never a token in the summary
create or replace function public.c1_connection_record_sync(p_id uuid, p_kind text, p_ok boolean, p_summary text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.store_connections;
  v_sum text := left(regexp_replace(coalesce(p_summary, ''), '[\r\n]+', ' ', 'g'), 300);
begin
  select * into c from public.store_connections where id = p_id;
  if c.id is null then raise exception 'NOT_FOUND: Store connection not found.'; end if;
  if p_kind not in ('orders', 'tasks', 'webhooks', 'test', 'products', 'stock', 'prices') then raise exception 'INVALID_INPUT: Unknown sync kind.'; end if;
  insert into public.integration_logs (integration_code, direction, status, summary, endpoint)
  values (c.platform, case when p_kind = 'webhooks' then 'in' else 'out' end, case when p_ok then 200 else 502 end,
          left(format('%s %s: %s', c.platform, p_kind, coalesce(nullif(v_sum, ''), case when p_ok then 'ok' else 'failed' end)), 300), 'connection:' || p_id::text);
  if p_ok then
    update public.store_connections set last_sync_at = case when p_kind in ('orders', 'test') then now() else last_sync_at end, updated_at = now() where id = p_id;
  else
    update public.store_connections set last_error = coalesce(nullif(v_sum, ''), 'Sync failed.'), last_error_at = now(), updated_at = now() where id = p_id;
  end if;
end $$;

-- the merchant (own organisation, setup role) or the service role; credentials are wiped by trg_c0_connection_wipe
create or replace function public.c1_connection_disconnect(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.store_connections;
  v_service boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role';
begin
  select * into c from public.store_connections where id = p_id for update;
  if c.id is null then raise exception 'NOT_FOUND: Store connection not found.'; end if;
  if not v_service then
    perform ds_feature_guard('stores');
    if c.org_id <> ds_org_read() then raise exception 'NOT_FOUND: Store connection not found.'; end if;
    perform ds_assert_role(c.org_id, 'setup');
  end if;
  if c.platform = 'shopify' and not v_service then raise exception 'NOT_SUPPORTED: Disconnect Shopify from the Octopus app in your Shopify admin.'; end if;
  if c.status = 'disconnected' then return jsonb_build_object('id', p_id, 'status', 'disconnected', 'already', true); end if;
  update public.store_connections set status = 'disconnected', disconnected_at = now(), status_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300), updated_at = now()
   where id = p_id;
  -- tasks that can no longer reach the store
  update public.dropship_channel_tasks set status = 'not_needed', last_error = 'Store disconnected', done_at = now()
   where store_connection_id = p_id and status in ('waiting_store', 'failed');
  perform write_audit('store_connection.disconnected', 'store_connections', p_id::text,
    jsonb_build_object('org_id', c.org_id, 'platform', c.platform, 'shop', c.shop_domain, 'by', case when v_service then 'system' else 'merchant' end, 'reason', left(p_reason, 300)));
  return jsonb_build_object('id', p_id, 'status', 'disconnected');
end $$;

-- ───────────────────────── 5. webhooks (verified by the route BEFORE this is called; bad signatures recorded without payload) ─────────────────────────
create or replace function public.c1_webhook_receive(p_platform text, p_connection uuid, p_event_id text, p_topic text, p_signature_ok boolean, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_event text := left(btrim(coalesce(p_event_id, '')), 200);
begin
  if p_platform is null or not (p_platform = any (public.c0_platforms('store'))) then raise exception 'INVALID_INPUT: Unknown platform.'; end if;
  if v_event = '' then v_event := 'noid-' || gen_random_uuid()::text; end if;
  if not coalesce(p_signature_ok, false) then v_event := 'badsig-' || gen_random_uuid()::text; end if;
  insert into public.webhook_inbox (source, external_event_id, topic, signature_ok, payload, store_connection_id, error)
  values (p_platform, v_event, left(p_topic, 120), coalesce(p_signature_ok, false), case when coalesce(p_signature_ok, false) then p_payload end, p_connection,
          case when coalesce(p_signature_ok, false) then null else 'Signature did not match' end)
  on conflict (source, external_event_id) do nothing
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'duplicate', v_id is null);
end $$;

create or replace function public.c1_webhook_claim(p_limit integer)
returns table (id uuid, source text, topic text, payload jsonb, store_connection_id uuid, org_id uuid, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select w.id from public.webhook_inbox w
     where w.processed_at is null and w.signature_ok and w.store_connection_id is not null and w.attempts < 5
       and w.source = any (public.c0_platforms('store')) and w.source <> 'shopify'
     order by w.received_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked)
  update public.webhook_inbox w set attempts = w.attempts + 1
    from picked, public.store_connections c
   where w.id = picked.id and c.id = w.store_connection_id
  returning w.id, w.source, w.topic, w.payload, w.store_connection_id, c.org_id, w.attempts;
end $$;

create or replace function public.c1_webhook_done(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.webhook_inbox
     set processed_at = case when p_error is null then now() else processed_at end,
         error = left(p_error, 300)
   where id = p_id
$$;

-- ───────────────────────── 6. store tasks executor ─────────────────────────
create or replace function public.c1_task_claim(p_limit integer)
returns table (id uuid, action text, detail jsonb, attempts integer, store_order_id uuid, org_id uuid, channel text, store_connection_id uuid,
               external_order_id text, external_order_name text, order_number text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select t.id, coalesce(t.store_connection_id, public.c1_active_connection(t.org_id, t.channel)) as conn
      from public.dropship_channel_tasks t
     where t.status = 'waiting_store' and t.channel <> 'shopify' and (t.next_attempt_at is null or t.next_attempt_at <= now())
     order by t.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update of t skip locked)
  update public.dropship_channel_tasks t set attempts = t.attempts + 1, store_connection_id = picked.conn,
         next_attempt_at = now() + make_interval(mins => 10)
    from picked, public.store_orders so, public.store_connections c
   where t.id = picked.id and so.id = t.store_order_id and c.id = picked.conn and c.status = 'active'
  returning t.id, t.action, t.detail, t.attempts, t.store_order_id, t.org_id, t.channel, t.store_connection_id, so.external_order_id, so.external_order_name, so.order_number;
end $$;

create or replace function public.c1_task_done(p_id uuid, p_ok boolean, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.dropship_channel_tasks;
  v_status text;
begin
  select * into t from public.dropship_channel_tasks where id = p_id for update;
  if t.id is null then raise exception 'NOT_FOUND: Task not found.'; end if;
  if coalesce(p_ok, false) then
    update public.dropship_channel_tasks set status = 'done', done_at = now(), last_error = null, next_attempt_at = null where id = p_id;
    v_status := 'done';
  else
    -- back-off 2, 4, 8 … minutes (max 6 h); after 8 tries staff decide (Retry on the connector health card)
    v_status := case when t.attempts >= 8 then 'failed' else 'waiting_store' end;
    update public.dropship_channel_tasks set status = v_status, last_error = left(coalesce(nullif(btrim(p_error), ''), 'The store did not accept the update.'), 300),
           next_attempt_at = case when v_status = 'failed' then null else now() + make_interval(mins => least(360, power(2, greatest(1, t.attempts))::int)) end
     where id = p_id;
    if v_status = 'failed' then
      perform write_audit('channel_task.failed', 'dropship_channel_tasks', p_id::text,
        jsonb_build_object('org_id', t.org_id, 'channel', t.channel, 'action', t.action, 'store_order_id', t.store_order_id, 'error', left(p_error, 300)));
    end if;
  end if;
  return jsonb_build_object('id', p_id, 'status', v_status);
end $$;

-- staff: try a failed store task again (Dropship editors and admins)
create or replace function public.c1_task_retry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.dropship_channel_tasks;
begin
  if auth.uid() is null or not is_staff() or distributor_restricted() or not (is_admin() or dropship_can_edit(division_id_of('DS'))) then
    raise exception 'FORBIDDEN: Dropship editors and admins retry store updates.';
  end if;
  select * into t from public.dropship_channel_tasks where id = p_id for update;
  if t.id is null then raise exception 'NOT_FOUND: Task not found.'; end if;
  if t.status <> 'failed' then raise exception 'INVALID_STATE: Only failed store updates are retried.'; end if;
  update public.dropship_channel_tasks set status = 'waiting_store', attempts = 0, next_attempt_at = null where id = p_id;
  perform write_audit('channel_task.retried', 'dropship_channel_tasks', p_id::text, jsonb_build_object('org_id', t.org_id, 'channel', t.channel, 'action', t.action));
  return jsonb_build_object('id', p_id, 'status', 'waiting_store');
end $$;

-- ───────────────────────── 7. hourly order catch-up targets ─────────────────────────
create or replace function public.c1_pull_targets(p_platforms text[], p_limit integer)
returns table (id uuid, org_id uuid, platform text, shop_domain text, store_url text, last_sync_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.org_id, c.platform, c.shop_domain, c.store_url, c.last_sync_at
    from public.store_connections c
   where c.status = 'active' and c.platform = any (coalesce(p_platforms, array[]::text[])) and c.platform <> 'shopify'
     and (c.last_sync_at is null or c.last_sync_at < now() - interval '50 minutes')
   order by c.last_sync_at nulls first
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- ───────────────────────── 8. the scheduled job (no HTTP call while there is nothing to do) ─────────────────────────
create or replace function public.job_connector_sync()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_id bigint;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then return null; end if;
  if not exists (select 1 from public.store_connections c where c.status = 'active' and c.platform <> 'shopify') then return 0; end if;
  if not (exists (select 1 from public.dropship_channel_tasks t where t.status = 'waiting_store' and t.channel <> 'shopify' and (t.next_attempt_at is null or t.next_attempt_at <= now()))
          or exists (select 1 from public.webhook_inbox w where w.processed_at is null and w.signature_ok and w.store_connection_id is not null and w.attempts < 5)
          or exists (select 1 from public.store_connections c where c.status = 'active' and c.platform <> 'shopify'
                       and (c.last_sync_at is null or c.last_sync_at < now() - interval '50 minutes'))) then
    return 0;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'octopus_app_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'octopus_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return null; end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := $3)'
    into v_id
    using rtrim(v_url, '/') || '/api/cron/connector-sync',
          jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'x-trace-id', 'cron-connector-sync-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
          55000;
  return v_id;
end $$;
comment on function public.job_connector_sync() is 'CONN S1: pg_cron → pg_net GET /api/cron/connector-sync (webhook inbox, store tasks, hourly order catch-up) when a non-Shopify store is connected and there is work.';

-- ───────────────────────── 9. replaced functions (installed text + CONN S1 patches) ─────────────────────────
-- ds_order_channel_task(uuid,uuid,text,text,jsonb)
CREATE OR REPLACE FUNCTION public.ds_order_channel_task(p_so uuid, p_org uuid, p_channel text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- CONN S1: every channel with an ACTIVE store connection waits for the store (Shopify keeps waiting for its Step 5 app)
  insert into public.dropship_channel_tasks (store_order_id, org_id, channel, action, status, detail, store_connection_id)
  values (p_so, p_org, p_channel, p_action,
          case when p_channel = 'shopify' or public.c1_active_connection(p_org, p_channel) is not null then 'waiting_store' else 'not_needed' end,
          coalesce(p_detail, '{}'::jsonb), public.c1_active_connection(p_org, p_channel))
  on conflict (store_order_id, action) do nothing
$function$;


-- ───────────────────────── 10. grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array['c1_active_connection(uuid, text)', 'c1_wh_order_shipped()', 'c1_connection_upsert(uuid, text, text, text, text, text, text, text[])',
    'c1_connection_set_status(uuid, text, text)', 'c1_connection_record_sync(uuid, text, boolean, text)', 'c1_connection_disconnect(uuid, text)',
    'c1_webhook_receive(text, uuid, text, text, boolean, jsonb)', 'c1_webhook_claim(integer)', 'c1_webhook_done(uuid, text)', 'c1_task_claim(integer)',
    'c1_task_done(uuid, boolean, text)', 'c1_task_retry(uuid)', 'c1_pull_targets(text[], integer)', 'job_connector_sync()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['c1_connection_disconnect(uuid, text)', 'c1_task_retry(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────────────────── 11. schedule (pg_cron, where installed) ─────────────────────────
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-connector-sync') then
      perform cron.unschedule('octopus-connector-sync');
    end if;
    perform cron.schedule('octopus-connector-sync', '*/5 * * * *', 'select public.job_connector_sync()');
  end if;
end $$;
