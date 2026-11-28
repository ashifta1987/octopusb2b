-- CONN S6 · DOWN (schema back exactly as after 264).
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-sync') then perform cron.unschedule('octopus-dropship-sync'); end if;
    if exists (select 1 from cron.job where jobname = 'octopus-fx-ecb') then perform cron.unschedule('octopus-fx-ecb'); end if;
  end if;
end $$;

-- restore ds_price_approval_decide(uuid,text) (exact installed text)
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
  return jsonb_build_object('ok', true);
end $function$;

-- restore c2b_stock_targets(text[],integer) (CONN S2b text)
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

drop trigger if exists trg_c6_supplier_verification on public.suppliers;
drop function if exists public.job_fx_ecb();
drop function if exists public.c6_supplier_verification();
drop function if exists public.c6_engine_status();
drop function if exists public.c6_engine_run();
drop function if exists public.c6_reprice_org(uuid);
drop function if exists public.c6_repush(uuid, jsonb, text, text);
drop function if exists public.c6_fx_record(jsonb, text, date);
alter table public.dropship_pricing_rules drop column if exists engine_checked_at;
