-- CONN S5 · Connector + carrier health (migration 264; after 263). Staff › System health gets what Phase 9 asks for:
--   1. c5_health_connectors(): store connections in error (needs reconnect, stuck connecting > 1 h, or a last error) with the
--      merchant; store updates that failed after 8 tries (Retry = c1_task_retry, S1); carrier accounts with their last connection
--      test (S4) and carrier failures in 24 h / the last carrier error (integration_logs).
--   2. c5_connection_retry_check(): may this staff member re-test a store connection (Dropship editors / admins)? The server then
--      re-tests with the sealed keys (service role) — never shown to staff. Audited.
--   3. c5_notify_merchant(): "Contact merchant" for any connection with a problem (DS12's notify covered needs-reconnect only).
--   4. c5_carrier_error_record(): a label the carrier refused is logged for System health (dispatch roles), never a key.
-- Money: none. RLS unchanged. search_path = public.

create or replace function public.c5_health_connectors()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ds12_health_can_view() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'can_edit', is_admin() or dropship_can_edit(division_id_of('DS')),
    'checked_at', now(),
    'connections', coalesce((select jsonb_agg(x order by x.at desc nulls last) from (
        select c.id, o.name as merchant, c.org_id, c.platform, c.shop_domain as shop, c.status, left(coalesce(c.last_error, c.status_reason), 300) as last_error,
               coalesce(c.last_error_at, c.updated_at) as at, c.last_sync_at
          from public.store_connections c join public.organizations o on o.id = c.org_id
         where c.status = 'needs_reconnect'
            or (c.status = 'connecting' and c.created_at < now() - interval '1 hour')
            or (c.status = 'active' and c.last_error is not null and c.last_error_at > coalesce(c.last_sync_at, '-infinity'::timestamptz))
         limit 200) x), '[]'::jsonb),
    'failed_tasks', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select t.id, o.name as merchant, t.channel as platform, so.order_number, so.external_order_name, t.action, t.attempts, left(t.last_error, 300) as last_error, t.created_at
          from public.dropship_channel_tasks t join public.store_orders so on so.id = t.store_order_id join public.organizations o on o.id = t.org_id
         where t.status = 'failed' order by t.created_at desc limit 200) x), '[]'::jsonb),
    'carriers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'warehouse_code', a.warehouse_code, 'carrier', a.carrier, 'name', a.name, 'mode', a.mode, 'active', a.active,
        'last_check_at', a.last_check_at, 'last_check_ok', a.last_check_ok, 'last_check_message', a.last_check_message,
        'failures_24h', (select count(*) from public.integration_logs g where g.endpoint = 'carrier_account:' || a.id::text and g.status >= 400 and g.created_at > now() - interval '24 hours'),
        'last_error', (select left(g.summary, 300) from public.integration_logs g where g.endpoint = 'carrier_account:' || a.id::text and g.status >= 400 order by g.created_at desc limit 1),
        'last_error_at', (select max(g.created_at) from public.integration_logs g where g.endpoint = 'carrier_account:' || a.id::text and g.status >= 400))
        order by a.active desc, a.warehouse_code, a.carrier, a.name)
      from public.wh_carrier_accounts a), '[]'::jsonb));
end $$;

create or replace function public.c5_connection_retry_check(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.store_connections;
begin
  if not (ds12_health_can_view() and (is_admin() or dropship_can_edit(division_id_of('DS')))) then raise exception 'FORBIDDEN: Dropship editors and admins retry store connections.'; end if;
  select * into c from public.store_connections where id = p_id;
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if c.status = 'disconnected' then raise exception 'DISCONNECTED: The merchant disconnected this store.'; end if;
  perform write_audit('store_connection.retry_requested', 'store_connections', c.id::text, jsonb_build_object('org_id', c.org_id, 'platform', c.platform, 'status', c.status));
  return jsonb_build_object('id', c.id, 'platform', c.platform, 'status', c.status);
end $$;

create or replace function public.c5_notify_merchant(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.store_connections;
begin
  if not (ds12_health_can_view() and (is_admin() or dropship_can_edit(division_id_of('DS')))) then raise exception 'FORBIDDEN'; end if;
  select * into c from public.store_connections where id = p_connection and status <> 'disconnected';
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  perform ds_notify(c.org_id, 'store_reconnect',
    case when c.status = 'needs_reconnect' then 'Reconnect your store' else 'Check your store connection' end,
    case when c.status = 'needs_reconnect' then format('Octopus can''t reach %s any more. Open Integrations and connect it again.', c.shop_domain)
         else format('Octopus has a problem with %s: %s Open Integrations to check it.', c.shop_domain, coalesce(left(c.last_error, 200), 'the connection did not finish.')) end,
    '/account/dropship/integrations', 'ds-store-problem:' || c.id::text || ':' || to_char(now(), 'YYYYMMDD'));
  perform write_audit('ds_health.notify_merchant', 'store_connections', c.id::text, jsonb_build_object('org_id', c.org_id, 'status', c.status));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.c5_carrier_error_record(p_account uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a public.wh_carrier_accounts;
begin
  select * into a from public.wh_carrier_accounts where id = p_account;
  if a.id is null or not public.wh_sees(a.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', a.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  insert into public.integration_logs (integration_code, direction, status, summary, endpoint)
  values (a.carrier, 'out', 502, left(format('%s label refused (%s): %s', a.carrier, a.name, regexp_replace(coalesce(nullif(btrim(p_message), ''), 'no reason given'), '[\r\n]+', ' ', 'g')), 300),
          'carrier_account:' || a.id::text);
end $$;

do $$
declare f text;
begin
  foreach f in array array['c5_health_connectors()', 'c5_connection_retry_check(uuid)', 'c5_notify_merchant(uuid)', 'c5_carrier_error_record(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
