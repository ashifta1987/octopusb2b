-- SPEC §10 / §10.3 (QA FN-02): the outbox dispatcher runs every 10 s from the database instead of once a day
-- from Vercel Cron (Hobby plan only allows daily crons). pg_cron calls public.job_dispatch_outbox(), which asks pg_net
-- to GET <app>/api/cron/outbox with `Authorization: Bearer <CRON_SECRET>`.
--
-- Secrets are NOT in this file. They live in Supabase Vault under the names
--   octopus_app_url      e.g. https://octopus-b2b.vercel.app
--   octopus_cron_secret  the same value as the app's CRON_SECRET
-- and are written by `node scripts/cron-dispatcher-secrets.mjs` (reads CRON_SECRET from .env.local).
-- Until both secrets exist the job is a no-op.

do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net could not be enabled (%); the outbox dispatcher job stays a no-op', sqlerrm;
  end;
end $$;

create or replace function public.job_dispatch_outbox() returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_id bigint;
begin
  if to_regnamespace('net') is null then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'octopus_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'octopus_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return null; end if;
  -- nothing due → no HTTP call (keeps function invocations proportional to real work)
  if not exists (select 1 from outbox_events where status in ('pending', 'dispatched') and available_at <= now()) then
    return 0;
  end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := $3)'
    into v_id
    using rtrim(v_url, '/') || '/api/cron/outbox',
          jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'x-trace-id', 'cron-outbox-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
          55000;
  return v_id;
end $$;
comment on function public.job_dispatch_outbox() is 'SPEC §10.3 outbox dispatcher: pg_cron → pg_net GET /api/cron/outbox (URL + CRON_SECRET from Vault).';
revoke all on function public.job_dispatch_outbox() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'octopus-outbox-dispatch') then
    perform cron.unschedule('octopus-outbox-dispatch');
  end if;
  perform cron.schedule('octopus-outbox-dispatch', '10 seconds', 'select public.job_dispatch_outbox()');
end $$;
