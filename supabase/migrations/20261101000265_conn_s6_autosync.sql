-- CONN S6 · Step 11 auto-sync engine (migration 265; after 264). pg_cron + an advisory lock, throttled per merchant
-- (dropship_pricing_rules.check_every_hours). No keys: the FX feed is the European Central Bank's public reference rates.
--   1. FX daily: /api/cron/fx-ecb (pg_cron 15:30 UTC on weekdays → pg_net) reads the ECB reference rates and c6_fx_record stores
--      a new dropship_fx_rates row (named source + date) for every store currency the ECB publishes, when it changed. Currencies
--      the ECB does not publish (e.g. AED, SAR) stay staff-entered, as today. Sync log + integration_logs.
--   2. Reprice by the merchant's rules (c6_reprice_org): for every linked product with "keep price in sync" on its last push and a
--      rule price (not a manual price), the price the rules give now is compared with the price in the store:
--        landed cost up    → reprice / ask (approval) / alert only   (when_landed_up)
--        landed cost down  → reprice / keep                          (when_landed_down)
--        exchange rate     → reprice when the change passes fx_threshold_bp
--      Never below the merchant's minimum profit without approval (reason below_min). Repricing = a re-push job (S2b queue) with the
--      new prices; approvals go to dropship_price_approvals; an approved change is re-pushed (ds_price_approval_decide).
--   3. Out-of-stock rule: when every variant of a linked product is out, when_out_of_stock = 'draft' hides it in the store (re-push
--      as draft) and shows it again when stock is back (only if the engine hid it).
--   4. Supplier loses verification → its Dropship products are paused (needs review, our reason) and their linked store products
--      go out of stock (c2b_stock_targets treats paused products as out); verified again → un-paused (only our pause).
--   5. c6_engine_run() (pg_cron hourly) and c6_engine_status() for System health.
-- Money: integer minor units of the store currency; profit in basis points; no float. Every automatic change is in the sync log.

alter table public.dropship_pricing_rules add column if not exists engine_checked_at timestamptz;

-- ───────────────────────── 1. FX ─────────────────────────
-- p_rates: [{currency, rate_per_usd}] (units of the currency per 1 USD)
create or replace function public.c6_fx_record(p_rates jsonb, p_source text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_cur text;
  v_rate numeric;
  v_prev numeric;
  v_ins int := 0;
  v_same int := 0;
  v_skip int := 0;
  v_src text := left(format('%s (%s)', coalesce(nullif(btrim(p_source), ''), 'European Central Bank reference rate'), coalesce(p_date, current_date)), 120);
begin
  if jsonb_typeof(p_rates) is distinct from 'array' or jsonb_array_length(p_rates) > 100 then raise exception 'INVALID_INPUT: rates'; end if;
  for r in select value from jsonb_array_elements(p_rates) loop
    v_cur := upper(btrim(coalesce(r ->> 'currency', '')));
    v_rate := nullif(r ->> 'rate_per_usd', '')::numeric;
    if v_cur !~ '^[A-Z]{3}$' or v_cur = 'USD' or v_rate is null or v_rate <= 0 or v_rate > 1000000 then v_skip := v_skip + 1; continue; end if;
    -- only currencies Octopus prices in (a store currency, or one staff already keep a rate for)
    if not (exists (select 1 from public.dropship_pricing_rules p where p.store_currency = v_cur)
            or exists (select 1 from public.store_connections c where c.shop_currency = v_cur and c.status <> 'disconnected')
            or exists (select 1 from public.dropship_fx_rates f where f.currency = v_cur)) then v_skip := v_skip + 1; continue; end if;
    select f.rate_per_usd into v_prev from public.dropship_fx_rates f where f.currency = v_cur and f.effective_from <= now() order by f.effective_from desc, f.created_at desc limit 1;
    if v_prev is not null and round(v_prev, 6) = round(v_rate, 6) then v_same := v_same + 1; continue; end if;
    insert into public.dropship_fx_rates (currency, rate_per_usd, source_name, effective_from) values (v_cur, round(v_rate, 6), v_src, now());
    insert into public.dropship_sync_log (org_id, kind, change_text, result_text)
    select distinct p.org_id, 'fx', 'Exchange rate updated', left(format('1 USD = %s %s (%s)', trim_scale(round(v_rate, 6)), v_cur, v_src), 500)
      from public.dropship_pricing_rules p where p.store_currency = v_cur;
    v_ins := v_ins + 1;
  end loop;
  insert into public.integration_logs (integration_code, direction, status, summary)
  values ('fx-ecb', 'in', 200, left(format('fx-ecb %s: %s new rate(s), %s unchanged, %s not used', coalesce(p_date, current_date), v_ins, v_same, v_skip), 300));
  perform write_audit('ds_fx.feed_recorded', 'dropship_fx_rates', coalesce(p_date, current_date)::text, jsonb_build_object('inserted', v_ins, 'unchanged', v_same, 'skipped', v_skip, 'source', v_src));
  return jsonb_build_object('inserted', v_ins, 'unchanged', v_same, 'skipped', v_skip);
end $$;

-- ───────────────────────── 2. re-push with new prices / status (internal) ─────────────────────────
-- copies the last finished push of this product to this store, with p_overrides {variant_id: {price_minor, compare_at_minor}},
-- the current stock labels and, when given, a new status (DRAFT / ACTIVE). Never two open jobs for the same product and store.
create or replace function public.c6_repush(p_link uuid, p_overrides jsonb, p_status text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.dropship_product_links;
  j public.dropship_push_jobs;
  v_batch uuid;
  v_job uuid;
  v_payload jsonb;
begin
  select * into l from public.dropship_product_links where id = p_link and status = 'linked';
  if l.id is null or not exists (select 1 from public.store_connections c where c.id = l.store_connection_id and c.status = 'active') then return null; end if;
  if exists (select 1 from public.dropship_push_jobs q where q.store_connection_id = l.store_connection_id and q.product_id = l.product_id and q.status in ('queued', 'running', 'retry_wait')) then return null; end if;
  select * into j from public.dropship_push_jobs q where q.store_connection_id = l.store_connection_id and q.product_id = l.product_id and q.kind = 'push' and q.status = 'done'
   order by q.finished_at desc nulls last limit 1;
  if j.id is null then return null; end if;
  v_payload := jsonb_set(j.payload, '{product_gid}', to_jsonb(l.product_gid));
  v_payload := jsonb_set(v_payload, '{variants}', coalesce((
    select jsonb_agg(v || jsonb_build_object(
             'stock_status', coalesce(public.ds_variant_stock_label((v ->> 'variant_id')::uuid), v ->> 'stock_status'),
             'variant_gid', coalesce((select vl.variant_gid from public.dropship_variant_links vl where vl.product_link_id = l.id and vl.variant_id = (v ->> 'variant_id')::uuid), v ->> 'variant_gid'))
           || coalesce(p_overrides -> (v ->> 'variant_id'), '{}'::jsonb))
      from jsonb_array_elements(j.payload -> 'variants') v), '[]'::jsonb));
  if p_status in ('DRAFT', 'ACTIVE') then v_payload := jsonb_set(v_payload, '{status}', to_jsonb(p_status)); end if;
  insert into public.dropship_push_batches (org_id, store_connection_id, kind, request_key, options)
  values (l.org_id, l.store_connection_id, 'push', gen_random_uuid(), jsonb_build_object('engine', true, 'reason', left(p_reason, 120)))
  returning id into v_batch;
  insert into public.dropship_push_jobs (batch_id, org_id, store_connection_id, product_id, listing_id, kind, status, payload, pricing)
  values (v_batch, l.org_id, l.store_connection_id, l.product_id, l.listing_id, 'push', 'queued', v_payload,
          j.pricing || jsonb_build_object('engine_reason', left(p_reason, 120), 'calculated_at', now()))
  returning id into v_job;
  return v_job;
end $$;

-- ───────────────────────── 3. reprice + out-of-stock rules for one merchant (internal) ─────────────────────────
create or replace function public.c6_reprice_org(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rules public.dropship_pricing_rules;
  l public.dropship_product_links;
  j public.dropship_push_jobs;
  st jsonb;
  v jsonb;
  vl public.dropship_variant_links;
  v_cur text;
  v_old bigint;
  v_new bigint;
  v_old_land bigint;
  v_new_land bigint;
  v_reason text;
  v_action text;
  v_over jsonb;
  v_lines text[];
  v_appr int;
  v_repriced int := 0;
  v_asked int := 0;
  v_alerts int := 0;
  v_hidden int := 0;
  v_shown int := 0;
  v_all_out boolean;
  v_min int;
  v_fx_bp int;
begin
  select * into rules from public.dropship_pricing_rules where org_id = p_org;
  if rules.org_id is null then return jsonb_build_object('skipped', 'no pricing rules'); end if;
  v_min := coalesce(rules.min_profit_bp, 0);
  v_fx_bp := coalesce(rules.fx_threshold_bp, 0);
  for l in select x.* from public.dropship_product_links x join public.store_connections c on c.id = x.store_connection_id and c.status = 'active'
            where x.org_id = p_org and x.status = 'linked' loop
    select * into j from public.dropship_push_jobs q where q.store_connection_id = l.store_connection_id and q.product_id = l.product_id and q.kind = 'push' and q.status = 'done'
     order by q.finished_at desc nulls last limit 1;
    if j.id is null then continue; end if;
    st := public.ds_listing_state(p_org, l.product_id, true);
    if st is null then continue; end if;
    v_cur := st ->> 'currency';

    -- out-of-stock rule (every variant in the store is out)
    v_all_out := not exists (select 1 from jsonb_array_elements(j.payload -> 'variants') x where coalesce(public.ds_variant_stock_label((x ->> 'variant_id')::uuid), 'out') <> 'out');
    if rules.when_out_of_stock = 'draft' and v_all_out and l.store_status = 'active' then
      if public.c6_repush(l.id, '{}'::jsonb, 'DRAFT', 'Hidden: out of stock') is not null then
        insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
        values (p_org, l.store_connection_id, l.product_id, 'status', 'Hidden: out of stock', 'Every variant is out of stock; the product is set to draft in your store.');
        perform ds_notify(p_org, 'out_of_stock', 'Product hidden: out of stock', format('%s is out of stock and was set to draft in your store.', coalesce(st ->> 'title', 'A product')),
          '/account/dropship/pushed', 'ds-oos:' || l.id::text || ':' || to_char(now(), 'YYYYMMDD'));
        v_hidden := v_hidden + 1;
      end if;
      continue;
    elsif not v_all_out and l.store_status = 'draft'
          and (select s.change_text from public.dropship_sync_log s where s.store_connection_id = l.store_connection_id and s.product_id = l.product_id and s.kind = 'status' order by s.created_at desc limit 1) = 'Hidden: out of stock' then
      if public.c6_repush(l.id, '{}'::jsonb, 'ACTIVE', 'Shown again: back in stock') is not null then
        insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
        values (p_org, l.store_connection_id, l.product_id, 'status', 'Shown again: back in stock', 'Stock is back; the product is active in your store again.');
        v_shown := v_shown + 1;
      end if;
      continue;
    end if;

    -- prices: only when the last push kept prices in sync and the listing uses the rule (not a manual price)
    if not coalesce((j.payload -> 'sync' ->> 'price')::boolean, false) or coalesce(st ->> 'price_mode', 'rule') = 'manual' then continue; end if;
    v_over := '{}'::jsonb;
    v_lines := '{}';
    for v in select value from jsonb_array_elements(st -> 'variants') where coalesce((value ->> 'include')::boolean, false) and not coalesce((value ->> 'manual')::boolean, false) loop
      select * into vl from public.dropship_variant_links x where x.product_link_id = l.id and x.variant_id = (v ->> 'variant_id')::uuid;
      if vl.product_link_id is null then continue; end if;
      v_old := vl.price_minor;
      v_new := nullif(v ->> 'price_minor', '')::bigint;
      if v_new is null or v_old is null or v_new = v_old then continue; end if;
      v_old_land := (select (x ->> 'landed_usd_cents')::bigint from jsonb_array_elements(j.pricing -> 'variants') x where x ->> 'variant_id' = v ->> 'variant_id' limit 1);
      v_new_land := nullif(v ->> 'landed_usd_cents', '')::bigint;
      v_reason := case when v_old_land is not null and v_new_land > v_old_land then 'landed_up'
                       when v_old_land is not null and v_new_land < v_old_land then 'landed_down' else 'fx_moved' end;
      v_action := case v_reason
        when 'landed_up' then case rules.when_landed_up when 'reprice' then 'reprice' when 'ask' then 'ask' else 'alert' end
        when 'landed_down' then case rules.when_landed_down when 'reprice' then 'reprice' else 'keep' end
        else case when abs(v_new - v_old) * 10000 >= v_fx_bp * v_old then 'reprice' else 'keep' end end;
      if v_action = 'reprice' and coalesce((v ->> 'below_min')::boolean, false) then v_action := 'ask'; v_reason := 'below_min'; end if;
      if v_action = 'reprice' then
        v_over := v_over || jsonb_build_object(v ->> 'variant_id', jsonb_build_object('price_minor', v_new, 'compare_at_minor', nullif(v ->> 'compare_at_minor', '')::bigint));
        v_lines := v_lines || format('%s: %s → %s', coalesce(vl.store_sku, v ->> 'model_no'), ds_fmt_money(v_old, v_cur), ds_fmt_money(v_new, v_cur));
      elsif v_action = 'ask' then
        if not exists (select 1 from public.dropship_price_approvals a where a.product_link_id = l.id and a.variant_id = vl.variant_id and a.status = 'waiting') then
          insert into public.dropship_price_approvals (org_id, product_link_id, product_id, variant_id, reason_code, old_landed_usd_cents, new_landed_usd_cents,
                                                       old_price_minor, new_price_minor, currency, fx_rate, old_profit_bp, new_profit_bp, status)
          values (p_org, l.id, l.product_id, vl.variant_id, v_reason, v_old_land, v_new_land, v_old, v_new, v_cur::char(3), nullif(st #>> '{fx,rate}', '')::numeric,
                  (select (x ->> 'profit_bp')::integer from jsonb_array_elements(j.pricing -> 'variants') x where x ->> 'variant_id' = v ->> 'variant_id' limit 1),
                  nullif(v ->> 'profit_bp', '')::integer, 'waiting');
          v_asked := v_asked + 1;
        end if;
      elsif v_action = 'alert' then
        if not exists (select 1 from public.dropship_sync_log s where s.product_id = l.product_id and s.store_connection_id = l.store_connection_id and s.kind = 'price'
                        and s.change_text = 'Landed cost went up' and s.created_at > now() - interval '24 hours') then
          insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
          values (p_org, l.store_connection_id, l.product_id, 'price', 'Landed cost went up', left(format('%s: your rules would price it %s (now %s). Your setting: alert only, nothing changed.',
                  coalesce(vl.store_sku, v ->> 'model_no'), ds_fmt_money(v_new, v_cur), ds_fmt_money(v_old, v_cur)), 500));
          v_alerts := v_alerts + 1;
        end if;
      end if;
    end loop;
    if v_over <> '{}'::jsonb then
      if public.c6_repush(l.id, v_over, null, 'Price updated by your rules') is not null then
        update public.dropship_product_links set sync_state = 'price_updated', sync_message = null, updated_at = now() where id = l.id;
        insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
        values (p_org, l.store_connection_id, l.product_id, 'price', 'Price updated by your rules', left(array_to_string(v_lines, '; '), 500));
        v_repriced := v_repriced + 1;
      end if;
    end if;
    select count(*) into v_appr from public.dropship_price_approvals a where a.product_link_id = l.id and a.status = 'waiting';
    if v_appr > 0 then update public.dropship_product_links set sync_state = 'needs_you', updated_at = now() where id = l.id and sync_state <> 'needs_you'; end if;
  end loop;
  if v_asked > 0 then
    perform ds_notify(p_org, 'cost_changed', 'Prices to approve', format('%s price change(s) wait for your approval in Pricing and sync.', v_asked),
      '/account/dropship/pricing', 'ds-approvals:' || p_org::text || ':' || to_char(now(), 'YYYYMMDD'));
  end if;
  update public.dropship_pricing_rules set engine_checked_at = now() where org_id = p_org;
  return jsonb_build_object('repriced', v_repriced, 'asked', v_asked, 'alerts', v_alerts, 'hidden', v_hidden, 'shown', v_shown);
end $$;

-- ───────────────────────── 4. the hourly run (one at a time) ─────────────────────────
create or replace function public.c6_engine_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o uuid;
  r jsonb;
  v_orgs int := 0;
  v_tot jsonb := jsonb_build_object('repriced', 0, 'asked', 0, 'alerts', 0, 'hidden', 0, 'shown', 0);
  v_err text;
begin
  if not pg_try_advisory_xact_lock(hashtext('octopus-dropship-sync-engine')) then return jsonb_build_object('skipped', 'already running'); end if;
  for o in select p.org_id from public.dropship_pricing_rules p
            where (p.engine_checked_at is null or p.engine_checked_at < now() - make_interval(hours => coalesce(p.check_every_hours, 24)) + interval '5 minutes')
              and exists (select 1 from public.dropship_product_links x join public.store_connections c on c.id = x.store_connection_id and c.status = 'active'
                           where x.org_id = p.org_id and x.status = 'linked')
            order by p.engine_checked_at nulls first limit 50 loop
    begin
      r := public.c6_reprice_org(o);
      v_orgs := v_orgs + 1;
      v_tot := jsonb_build_object('repriced', (v_tot ->> 'repriced')::int + coalesce((r ->> 'repriced')::int, 0), 'asked', (v_tot ->> 'asked')::int + coalesce((r ->> 'asked')::int, 0),
                                  'alerts', (v_tot ->> 'alerts')::int + coalesce((r ->> 'alerts')::int, 0), 'hidden', (v_tot ->> 'hidden')::int + coalesce((r ->> 'hidden')::int, 0),
                                  'shown', (v_tot ->> 'shown')::int + coalesce((r ->> 'shown')::int, 0));
    exception when others then
      v_err := left(sqlerrm, 200);
      update public.dropship_pricing_rules set engine_checked_at = now() where org_id = o;
      insert into public.integration_logs (integration_code, direction, status, summary) values ('dropship-sync-engine', 'out', 500, left(format('merchant %s: %s', o, v_err), 300));
    end;
  end loop;
  insert into public.integration_logs (integration_code, direction, status, summary)
  values ('dropship-sync-engine', 'out', 200, left(format('sync engine: %s merchant(s) checked; %s repriced, %s to approve, %s alerts, %s hidden, %s shown again',
          v_orgs, v_tot ->> 'repriced', v_tot ->> 'asked', v_tot ->> 'alerts', v_tot ->> 'hidden', v_tot ->> 'shown'), 300));
  return v_tot || jsonb_build_object('merchants', v_orgs);
end $$;

-- staff: last engine run and FX feed (System health tile)
create or replace function public.c6_engine_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ds12_health_can_view() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'engine', (select jsonb_build_object('at', g.created_at, 'status', g.status, 'summary', g.summary) from public.integration_logs g where g.integration_code = 'dropship-sync-engine' order by g.created_at desc limit 1),
    'engine_errors_24h', (select count(*) from public.integration_logs g where g.integration_code = 'dropship-sync-engine' and g.status >= 400 and g.created_at > now() - interval '24 hours'),
    'fx', (select jsonb_build_object('at', g.created_at, 'status', g.status, 'summary', g.summary) from public.integration_logs g where g.integration_code = 'fx-ecb' order by g.created_at desc limit 1),
    'waiting_approvals', (select count(*) from public.dropship_price_approvals a where a.status = 'waiting'));
end $$;

-- ───────────────────────── 5. supplier verification ─────────────────────────
create or replace function public.c6_supplier_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  -- a Dropship product is supplied through its variants (dropship_variants.supplier_product_id → supplier_products); older
  -- products may still name the supplier on the product (legacy, frozen)
  if old.verified and not coalesce(new.verified, false) then
    update public.dropship_products p set needs_review = true, needs_review_reason = 'Supplier lost verification', updated_at = now()
     where p.status = 'active' and not coalesce(p.needs_review, false)
       and (p.supplier_id = new.id or exists (select 1 from public.dropship_variants v join public.supplier_products sp on sp.id = v.supplier_product_id
                                               where v.product_id = p.id and sp.supplier_id = new.id));
    get diagnostics v_n = row_count;
    perform write_audit('ds_product.paused_supplier', 'suppliers', new.id::text, jsonb_build_object('products', v_n));
  elsif not coalesce(old.verified, false) and new.verified then
    -- un-pause only our pause, and only when no other supplier of the product is still unverified
    update public.dropship_products p set needs_review = false, needs_review_reason = null, updated_at = now()
     where p.needs_review and p.needs_review_reason = 'Supplier lost verification'
       and (p.supplier_id = new.id or exists (select 1 from public.dropship_variants v join public.supplier_products sp on sp.id = v.supplier_product_id
                                               where v.product_id = p.id and sp.supplier_id = new.id))
       and not exists (select 1 from public.suppliers s where not coalesce(s.verified, false) and s.id <> new.id
                        and (p.supplier_id = s.id or exists (select 1 from public.dropship_variants v join public.supplier_products sp on sp.id = v.supplier_product_id
                                                              where v.product_id = p.id and sp.supplier_id = s.id)));
    get diagnostics v_n = row_count;
    perform write_audit('ds_product.unpaused_supplier', 'suppliers', new.id::text, jsonb_build_object('products', v_n));
  end if;
  return new;
end $$;
drop trigger if exists trg_c6_supplier_verification on public.suppliers;
create trigger trg_c6_supplier_verification after update of verified on public.suppliers
  for each row execute function public.c6_supplier_verification();

-- ───────────────────────── 6. FX job (pg_net → /api/cron/fx-ecb) ─────────────────────────
create or replace function public.job_fx_ecb()
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
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'octopus_app_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'octopus_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return null; end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := $3)'
    into v_id
    using rtrim(v_url, '/') || '/api/cron/fx-ecb',
          jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'x-trace-id', 'cron-fx-ecb-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
          30000;
  return v_id;
end $$;

-- ───────────────────────── replaced functions (previous text + CONN S6 patches) ─────────────────────────
-- c2b_stock_targets(text[],integer)  (CONN S2b text)
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
    -- CONN S6: a product paused because its supplier lost verification is out of stock in every store
    cross join lateral (select case when exists (select 1 from public.dropship_products p where p.id = l.product_id and p.needs_review and p.needs_review_reason = 'Supplier lost verification')
                                    then 'out' else public.ds_variant_stock_label(vl.variant_id) end as label) t
   where l.status = 'linked' and c.platform = any (coalesce(p_platforms, array[]::text[])) and c.platform <> 'shopify'
     and vl.variant_gid is not null and t.label is not null and t.label is distinct from vl.stock_label
     and coalesce((select (q.payload -> 'sync' ->> 'stock')::boolean from public.dropship_push_jobs q
                    where q.store_connection_id = l.store_connection_id and q.product_id = l.product_id and q.kind = 'push' and q.status = 'done'
                    order by q.finished_at desc nulls last limit 1), false)
   order by vl.stock_synced_at nulls first, l.id
   limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

-- ds_price_approval_decide(uuid,text)
CREATE OR REPLACE FUNCTION public.ds_price_approval_decide(p_id uuid, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := assert_dropship_new_activity();
  v_a public.dropship_price_approvals;
begin
  perform ds_feature_guard('pricing');
  if p_decision not in ('approve', 'keep_old') then raise exception 'INVALID_INPUT'; end if;
  select * into v_a from public.dropship_price_approvals where id = p_id and org_id = v_org for update;
  if v_a.id is null then raise exception 'NOT_FOUND'; end if;
  if v_a.status <> 'waiting' then raise exception 'ALREADY_DECIDED: This change was already decided.'; end if;
  update public.dropship_price_approvals set status = case when p_decision = 'approve' then 'approved' else 'kept_old' end,
         decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform write_audit('ds_price_approval.decided', 'dropship_price_approvals', p_id::text, jsonb_build_object('decision', p_decision));
  -- CONN S6: an approved price goes to the store (re-push with the approved price for this variant)
  if p_decision = 'approve' and v_a.product_link_id is not null and v_a.new_price_minor is not null then
    if public.c6_repush(v_a.product_link_id, jsonb_build_object(v_a.variant_id::text, jsonb_build_object('price_minor', v_a.new_price_minor)), null, 'Approved price change') is not null then
      insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
      select v_org, l.store_connection_id, l.product_id, 'price', 'Approved price change', left(format('%s → %s', ds_fmt_money(v_a.old_price_minor, v_a.currency), ds_fmt_money(v_a.new_price_minor, v_a.currency)), 500)
        from public.dropship_product_links l where l.id = v_a.product_link_id;
      update public.dropship_product_links set sync_state = 'price_updated', updated_at = now() where id = v_a.product_link_id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $function$;

-- ───────────────────────── grants + schedule ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array['c6_fx_record(jsonb, text, date)', 'c6_repush(uuid, jsonb, text, text)', 'c6_reprice_org(uuid)', 'c6_engine_run()', 'c6_engine_status()', 'c6_supplier_verification()', 'job_fx_ecb()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  grant execute on function public.c6_engine_status() to authenticated;
end $$;

do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-sync') then perform cron.unschedule('octopus-dropship-sync'); end if;
    perform cron.schedule('octopus-dropship-sync', '17 * * * *', 'select public.c6_engine_run()');
    if exists (select 1 from cron.job where jobname = 'octopus-fx-ecb') then perform cron.unschedule('octopus-fx-ecb'); end if;
    perform cron.schedule('octopus-fx-ecb', '30 15 * * 1-5', 'select public.job_fx_ecb()');
  end if;
end $$;
