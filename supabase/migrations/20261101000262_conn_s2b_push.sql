-- CONN S2b · Product push, stock and price for non-Shopify stores (migration 262; after 261). WooCommerce first.
-- Builds on DS6 (push queue: dropship_push_batches / dropship_push_jobs → dropship_product_links / dropship_variant_links) and CONN S1/S2.
--   1. c2b_push_claim: the push queue for non-Shopify platforms (the Shopify executor keeps ds_push_claim, now Shopify-only, so
--      neither executor takes the other's jobs). ds_push_complete accepts WooCommerce product ids and words the log per platform.
--   2. Stock follows Octopus: dropship_variant_links remembers the stock label last sent; c2b_stock_targets lists linked variants
--      (keep-in-sync on, active store) whose label changed; c2b_stock_done records the result (sync log; out of stock / failed).
--      Prices go out with every push / re-push (the pricing engine, Step 11, re-pushes approved prices).
--   3. ds_push_page / ds_pushed_list also say which platform the store is (the screens name it); job_connector_sync also wakes for
--      queued push jobs and stock changes.
-- Money: prices are integer minor units of the store currency (already calculated at enqueue). RLS unchanged. Audited.

alter table public.dropship_variant_links add column if not exists stock_label text
  check (stock_label is null or stock_label in ('in_stock', 'low', 'out', 'extended'));
alter table public.dropship_variant_links add column if not exists stock_synced_at timestamptz;

create or replace function public.c2b_push_claim(p_platforms text[], p_worker text, p_limit integer)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.dropship_push_jobs;
  v_id uuid;
  v_platform text;
begin
  for v_id, v_platform in
    select q.id, c.platform from public.dropship_push_jobs q
      join public.store_connections c on c.id = q.store_connection_id and c.status = 'active'
     where c.platform = any (coalesce(p_platforms, array[]::text[])) and c.platform <> 'shopify'
       and ((q.status in ('queued', 'retry_wait') and q.next_attempt_at <= now())
            or (q.status = 'running' and q.locked_at < now() - interval '10 minutes'))   -- resume after a crashed worker
     order by q.next_attempt_at, q.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 50))
     for update of q skip locked
  loop
    update public.dropship_push_jobs set status = 'running', locked_at = now(), locked_by = left(coalesce(p_worker, 'worker'), 80),
           attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
     where id = v_id returning * into j;
    return next jsonb_build_object('id', j.id, 'kind', j.kind, 'org_id', j.org_id, 'store_connection_id', j.store_connection_id, 'platform', v_platform,
      'product_id', j.product_id, 'attempts', j.attempts, 'max_attempts', j.max_attempts, 'payload', j.payload);
  end loop;
end $$;

-- linked variants whose Octopus stock label differs from the one last sent (keep-in-sync on for the last push; active store)
create or replace function public.c2b_stock_targets(p_platforms text[], p_limit integer)
returns table (product_link_id uuid, variant_id uuid, org_id uuid, store_connection_id uuid, platform text, product_id uuid, product_gid text, variant_gid text, label text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, vl.variant_id, l.org_id, l.store_connection_id, c.platform, l.product_id, l.product_gid, vl.variant_gid, t.label
    from public.dropship_product_links l
    join public.store_connections c on c.id = l.store_connection_id and c.status = 'active'
    join public.dropship_variant_links vl on vl.product_link_id = l.id
    cross join lateral (select public.ds_variant_stock_label(vl.variant_id) as label) t
   where l.status = 'linked' and c.platform = any (coalesce(p_platforms, array[]::text[])) and c.platform <> 'shopify'
     and vl.variant_gid is not null and t.label is not null and t.label is distinct from vl.stock_label
     and coalesce((select (q.payload -> 'sync' ->> 'stock')::boolean from public.dropship_push_jobs q
                    where q.store_connection_id = l.store_connection_id and q.product_id = l.product_id and q.kind = 'push' and q.status = 'done'
                    order by q.finished_at desc nulls last limit 1), false)
   order by vl.stock_synced_at nulls first, l.id
   limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

-- p_items: [{product_link_id, variant_id, label, ok, error}]
create or replace function public.c2b_stock_done(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  l public.dropship_product_links;
  v_ok int := 0;
  v_failed int := 0;
  v_links uuid[] := '{}';
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then raise exception 'INVALID_INPUT: items'; end if;
  for v in select value from jsonb_array_elements(p_items) loop
    if coalesce((v ->> 'label'), '') not in ('in_stock', 'low', 'out', 'extended') then continue; end if;
    if coalesce((v ->> 'ok')::boolean, false) then
      update public.dropship_variant_links set stock_label = v ->> 'label', stock_synced_at = now(), updated_at = now()
       where product_link_id = (v ->> 'product_link_id')::uuid and variant_id = (v ->> 'variant_id')::uuid;
      if found then v_ok := v_ok + 1; v_links := array_append(v_links, (v ->> 'product_link_id')::uuid); end if;
    else
      update public.dropship_product_links set sync_state = 'failed', sync_message = left(coalesce(nullif(v ->> 'error', ''), 'The store did not accept the stock update.'), 500), updated_at = now()
       where id = (v ->> 'product_link_id')::uuid;
      v_failed := v_failed + 1;
    end if;
  end loop;
  for l in select * from public.dropship_product_links where id = any (v_links) loop
    update public.dropship_product_links
       set sync_state = case when exists (select 1 from public.dropship_variant_links x where x.product_link_id = l.id and coalesce(x.stock_label, 'in_stock') <> 'out') then 'in_sync' else 'out_of_stock' end,
           sync_message = null, last_synced_at = now(), updated_at = now()
     where id = l.id;
    insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
    values (l.org_id, l.store_connection_id, l.product_id, 'stock', 'Stock updated',
            coalesce((select left(string_agg(format('%s: %s', coalesce(x.store_sku, 'variant'), replace(x.stock_label, '_', ' ')), ', ' order by x.store_sku), 500)
               from public.dropship_variant_links x where x.product_link_id = l.id and x.stock_synced_at > now() - interval '1 minute'), 'Stock updated'));
  end loop;
  return jsonb_build_object('ok', v_ok, 'failed', v_failed);
end $$;

-- ───────────────────────── replaced functions (installed text + CONN S2b patches) ─────────────────────────
-- ds_push_claim(text,integer)
CREATE OR REPLACE FUNCTION public.ds_push_claim(p_worker text, p_limit integer DEFAULT 5)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j public.dropship_push_jobs;
begin
  for j in
    select q.* from public.dropship_push_jobs q join public.store_connections c on c.id = q.store_connection_id and c.status = 'active' and c.platform = 'shopify'  -- CONN S2b: other platforms: c2b_push_claim
     where (q.status in ('queued', 'retry_wait') and q.next_attempt_at <= now())
        or (q.status = 'running' and q.locked_at < now() - interval '10 minutes')   -- resume after a crashed worker
     order by q.next_attempt_at, q.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 50))
     for update of q skip locked
  loop
    update public.dropship_push_jobs set status = 'running', locked_at = now(), locked_by = left(coalesce(p_worker, 'worker'), 80),
           attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
     where id = j.id returning * into j;
    return next jsonb_build_object('id', j.id, 'kind', j.kind, 'org_id', j.org_id, 'store_connection_id', j.store_connection_id,
      'product_id', j.product_id, 'attempts', j.attempts, 'max_attempts', j.max_attempts, 'payload', j.payload);
  end loop;
end $function$;

-- ds_push_complete(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.ds_push_complete(p_job_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j public.dropship_push_jobs;
  v_link_id uuid;
  v jsonb;
begin
  select * into j from public.dropship_push_jobs where id = p_job_id for update;
  if j.id is null or j.status <> 'running' then raise exception 'JOB_NOT_RUNNING'; end if;
  if j.kind = 'push' then
    -- CONN S2b: WooCommerce products are "woocommerce:product:<id>"
    if coalesce(p_result ->> 'product_gid', '') !~ '^(gid://shopify/Product/\d+|woocommerce:product:\d+)$' then raise exception 'INVALID_RESULT'; end if;
    insert into public.dropship_product_links as l (org_id, store_connection_id, product_id, listing_id, product_gid, status, store_status, sync_state, last_pushed_at, last_synced_at)
    values (j.org_id, j.store_connection_id, j.product_id, j.listing_id, p_result ->> 'product_gid', 'linked',
            coalesce(lower(p_result ->> 'store_status'), lower(j.payload ->> 'status'), 'draft'), 'in_sync', now(), now())
    on conflict (store_connection_id, product_id) do update set product_gid = excluded.product_gid, listing_id = excluded.listing_id, status = 'linked',
        store_status = excluded.store_status, sync_state = 'in_sync', sync_message = null, last_pushed_at = now(), last_synced_at = now(),
        unlinked_at = null, updated_at = now()
    returning id into v_link_id;
    for v in select value from jsonb_array_elements(coalesce(p_result -> 'variants', '[]'::jsonb)) loop
      insert into public.dropship_variant_links (product_link_id, org_id, variant_id, variant_gid, inventory_item_gid, store_sku, price_minor, compare_at_minor, currency, stock_label, stock_synced_at, updated_at)
      values (v_link_id, j.org_id, (v ->> 'variant_id')::uuid, v ->> 'variant_gid', v ->> 'inventory_item_gid', v ->> 'sku',
              (v ->> 'price_minor')::bigint, (v ->> 'compare_at_minor')::bigint, j.payload ->> 'currency',
              case when v ->> 'stock_status' in ('in_stock', 'low', 'out', 'extended') then v ->> 'stock_status' end, case when v ? 'stock_status' then now() end, now())
      on conflict (product_link_id, variant_id) do update set variant_gid = excluded.variant_gid, inventory_item_gid = excluded.inventory_item_gid,
          store_sku = excluded.store_sku, price_minor = excluded.price_minor, compare_at_minor = excluded.compare_at_minor, currency = excluded.currency,
          stock_label = coalesce(excluded.stock_label, dropship_variant_links.stock_label), stock_synced_at = coalesce(excluded.stock_synced_at, dropship_variant_links.stock_synced_at), updated_at = now();
    end loop;
    insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
    values (j.org_id, j.store_connection_id, j.product_id, 'push', 'Pushed', 'Created or updated in ' || coalesce((select case c.platform when 'shopify' then 'Shopify' when 'woocommerce' then 'WooCommerce' else 'your store' end from public.store_connections c where c.id = j.store_connection_id), 'your store')
              || ' as ' || coalesce(lower(j.payload ->> 'status'), 'draft'));
  else
    update public.dropship_product_links set status = 'unlinked', unlinked_at = now(), updated_at = now()
     where store_connection_id = j.store_connection_id and product_id = j.product_id;
    insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
    values (j.org_id, j.store_connection_id, j.product_id, 'unlink', 'Unlinked', case when exists (select 1 from public.store_connections c where c.id = j.store_connection_id and c.platform <> 'shopify') then 'Set to out of stock in your store; sync stopped' else 'Stock set to 0 at the Octopus location; sync stopped' end);
  end if;
  update public.dropship_push_jobs set status = 'done', finished_at = now(), locked_at = null, locked_by = null, error_code = null, error_message = null, updated_at = now()
   where id = j.id;
  perform write_audit('ds_push.completed', 'dropship_push_jobs', j.id::text, jsonb_build_object('org_id', j.org_id, 'kind', j.kind));
  return jsonb_build_object('ok', true);
end $function$;

-- ds_push_page(uuid[])
CREATE OR REPLACE FUNCTION public.ds_push_page(p_product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := ds_org_read();
  v_conn public.store_connections;
  v_items jsonb := '[]'::jsonb;
  v_pid uuid;
  st jsonb;
  v_status text;
begin
  perform ds_feature_guard('import_list');
  v_conn := ds_active_connection(v_org);
  select status into v_status from public.company_services where org_id = v_org and service = 'dropship';
  foreach v_pid in array coalesce(p_product_ids, '{}') loop
    st := ds_listing_state(v_org, v_pid, true);
    if st is null then continue; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', st -> 'product_id', 'model_no', st -> 'model_no',
      'title', st -> 'title', 'variants_included', st -> 'variants_included', 'ready', st -> 'ready', 'problems', st -> 'problems',
      'collection', st -> 'collection', 'publish_as', st -> 'publish_as', 'currency', st -> 'currency',
      'below', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', x -> 'variant_id', 'options', x -> 'options', 'price_minor', x -> 'price_minor', 'profit_bp', x -> 'profit_bp')), '[]'::jsonb)
                  from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean and (x ->> 'below_min')::boolean),
      'min_profit_bp', st -> 'min_profit_bp'));
  end loop;
  return jsonb_build_object(
    'dropship_status', coalesce(v_status, 'off'),
    'store', case when v_conn.id is null then null else jsonb_build_object('id', v_conn.id, 'shop_domain', v_conn.shop_domain, 'currency', v_conn.shop_currency, 'platform', v_conn.platform) end,
    'store_needs_reconnect', exists (select 1 from public.store_connections where org_id = v_org and status = 'needs_reconnect'),
    'items', v_items,
    'batches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'created_at', b.created_at, 'options', b.options,
                   'jobs', (select coalesce(jsonb_agg(ds_job_json(j) order by j.created_at), '[]'::jsonb) from public.dropship_push_jobs j where j.batch_id = b.id))
                   order by b.created_at desc), '[]'::jsonb)
                  from (select * from public.dropship_push_batches where org_id = v_org order by created_at desc limit 5) b));
end $function$;

-- ds_pushed_list()
CREATE OR REPLACE FUNCTION public.ds_pushed_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid := ds_org_read();
begin
  perform ds_feature_guard('pushed');
  return jsonb_build_object(
    'store', (select jsonb_build_object('shop_domain', c.shop_domain, 'currency', c.shop_currency, 'platform', c.platform) from public.store_connections c where c.id = (ds_active_connection(v_org)).id),
    'store_needs_reconnect', exists (select 1 from public.store_connections where org_id = v_org and status = 'needs_reconnect'),
    'import_count', (select count(distinct product_id) from public.dropship_import_list where org_id = v_org),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'model_no', p.model_no, 'title', coalesce(li.title, p.title),
               'store_status', l.store_status, 'sync_state', l.sync_state, 'sync_message', l.sync_message, 'last_synced_at', coalesce(l.last_synced_at, l.last_pushed_at),
               'stock_status', (select case when bool_or(ds_variant_stock_label(vl.variant_id) in ('in_stock', 'extended')) then 'in_stock'
                                             when bool_or(ds_variant_stock_label(vl.variant_id) = 'low') then 'low' else 'out' end
                                  from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'price_min', (select min(vl.price_minor) from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'price_max', (select max(vl.price_minor) from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'currency', (select max(vl.currency) from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'open_job', (select ds_job_json(j) from public.dropship_push_jobs j where j.org_id = v_org and j.product_id = l.product_id and j.status in ('queued', 'running', 'retry_wait') limit 1))
               order by l.updated_at desc), '[]'::jsonb)
             from public.dropship_product_links l join public.dropship_products p on p.id = l.product_id
             left join public.dropship_listings li on li.org_id = l.org_id and li.product_id = l.product_id
            where l.org_id = v_org and l.status = 'linked'),
    'failed', (select coalesce(jsonb_agg(ds_job_json(j) order by j.created_at desc), '[]'::jsonb)
                 from public.dropship_push_jobs j where j.org_id = v_org and j.status = 'failed'
                  and not exists (select 1 from public.dropship_push_jobs k where k.org_id = j.org_id and k.product_id = j.product_id and k.created_at > j.created_at
                                    and k.status in ('queued', 'running', 'retry_wait', 'done'))));
end $function$;

-- job_connector_sync()
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
          -- CONN S2b: product push jobs and stock changes for non-Shopify stores
          or exists (select 1 from public.dropship_push_jobs q join public.store_connections c on c.id = q.store_connection_id and c.status = 'active' and c.platform <> 'shopify'
                      where (q.status in ('queued', 'retry_wait') and q.next_attempt_at <= now()) or (q.status = 'running' and q.locked_at < now() - interval '10 minutes'))
          or exists (select 1 from public.c2b_stock_targets(public.c0_platforms('store'), 1))
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
comment on function public.job_connector_sync() is 'CONN S1/S2b: pg_cron → pg_net GET /api/cron/connector-sync (webhook inbox, store tasks, hourly order catch-up, product push, stock) when a non-Shopify store is connected and there is work.';


do $$
declare f text;
begin
  foreach f in array array['c2b_push_claim(text[], text, integer)', 'c2b_stock_targets(text[], integer)', 'c2b_stock_done(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
