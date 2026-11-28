-- CONN S1 · Connector runtime — DOWN (schema back exactly as after 256). Store tasks created by S1 (send_tracking) are removed and
-- "failed" tasks go back to "waiting_store" so the DS10 CHECKs fit again; inbox rows keep their data (the new column is dropped).
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-connector-sync') then
      perform cron.unschedule('octopus-connector-sync');
    end if;
  end if;
end $$;

drop trigger if exists trg_c1_wh_order_shipped on public.wh_orders;
drop function if exists public.job_connector_sync();
drop function if exists public.c1_pull_targets(text[], integer);
drop function if exists public.c1_task_retry(uuid);
drop function if exists public.c1_task_done(uuid, boolean, text);
drop function if exists public.c1_task_claim(integer);
drop function if exists public.c1_webhook_done(uuid, text);
drop function if exists public.c1_webhook_claim(integer);
drop function if exists public.c1_webhook_receive(text, uuid, text, text, boolean, jsonb);
drop function if exists public.c1_connection_disconnect(uuid, text);
drop function if exists public.c1_connection_record_sync(uuid, text, boolean, text);
drop function if exists public.c1_connection_set_status(uuid, text, text);
drop function if exists public.c1_connection_upsert(uuid, text, text, text, text, text, text, text[]);
drop function if exists public.c1_wh_order_shipped();

-- replaced functions: the installed text, exactly
-- restore ds_order_channel_task(uuid,uuid,text,text,jsonb) (exact installed text)
CREATE OR REPLACE FUNCTION public.ds_order_channel_task(p_so uuid, p_org uuid, p_channel text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.dropship_channel_tasks (store_order_id, org_id, channel, action, status, detail)
  values (p_so, p_org, p_channel, p_action, case when p_channel = 'shopify' then 'waiting_store' else 'not_needed' end, coalesce(p_detail, '{}'::jsonb))
  on conflict (store_order_id, action) do nothing
$function$;

drop function if exists public.c1_active_connection(uuid, text);

delete from public.dropship_channel_tasks where action = 'send_tracking';
update public.dropship_channel_tasks set status = 'waiting_store' where status = 'failed';
alter table public.dropship_channel_tasks drop column if exists last_error;
alter table public.dropship_channel_tasks drop column if exists next_attempt_at;
alter table public.dropship_channel_tasks drop column if exists attempts;
alter table public.dropship_channel_tasks drop column if exists store_connection_id;
alter table public.dropship_channel_tasks drop constraint if exists dropship_channel_tasks_status_check;
alter table public.dropship_channel_tasks add constraint dropship_channel_tasks_status_check check (status in ('waiting_store', 'done', 'not_needed'));
alter table public.dropship_channel_tasks drop constraint if exists dropship_channel_tasks_action_check;
alter table public.dropship_channel_tasks add constraint dropship_channel_tasks_action_check
  check (action in ('release_fulfillment', 'accept_cancellation', 'reject_cancellation', 'update_tracking'));

drop index if exists public.webhook_inbox_connection_idx;
drop index if exists public.webhook_inbox_todo_idx;
alter table public.webhook_inbox drop column if exists store_connection_id;
