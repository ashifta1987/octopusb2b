-- SPEC §21 chain 5 gap (money integrity): calling request_service twice with the same idempotency key created a
-- SECOND service request in status 'paid' while wallet_charge() (correctly) returned the first journal — i.e. a paid
-- service without a payment. The key is now stored on the request and a replay returns the existing request.
-- The fee, wallet charge and journal logic are unchanged (body copied from 20261101000060_currency.sql).

alter table public.service_requests add column if not exists idempotency_key text;
create unique index if not exists service_requests_idem_uq on public.service_requests (org_id, idempotency_key) where idempotency_key is not null;

create or replace function core_request_service(p_org uuid, p_actor uuid, p_service text, p_details jsonb, p_product uuid, p_idem text, p_source text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cur text := current_platform_currency(); v_fee bigint; v_id uuid; v_wallet boolean := setting_bool('wallet_enabled'); v_status service_request_status;
begin
  if p_org is null or not exists(select 1 from organizations where id = p_org and archived_at is null) then raise exception 'NO_ORG'; end if;
  if p_idem is not null then
    -- replay of the same request: return it, charge nothing, emit nothing
    select id into v_id from service_requests where org_id = p_org and idempotency_key = p_idem;
    if v_id is not null then
      insert into idempotency_hits(scope, key, original_trace_id, detail)
        select 'request_service', p_idem, trace_id, jsonb_build_object('service_request_id', id) from service_requests where id = v_id;
      return v_id;
    end if;
  end if;
  if not exists(select 1 from services where code = p_service and active) then raise exception 'SERVICE_INACTIVE'; end if;
  v_fee := coalesce(current_service_price(p_service, v_cur), 0);
  v_status := case when v_fee = 0 or v_wallet then 'paid' else 'requested' end;
  insert into service_requests(org_id, service_code, product_id, details, fee_minor, currency, fx_rate_id, paid_via, status, created_by, idempotency_key)
    values (p_org, p_service, p_product, coalesce(p_details,'{}'), v_fee, v_cur, current_fx_rate_id(),
            case when v_fee = 0 then 'free' when v_wallet then 'wallet' else 'invoice' end, v_status, p_actor, p_idem)
    returning id into v_id;
  if v_fee > 0 and v_wallet then
    perform wallet_charge(p_org, v_fee, 'Service fee · ' || p_service, 'service_fees', coalesce(p_idem, 'svc:' || v_id::text), 'service_request', v_id, v_cur);
  end if;
  perform log_status('service_request', v_id, null, v_status::text, p_source);
  perform emit_event('service_request.' || v_status, 'service_request', v_id, jsonb_build_object('org_id', p_org, 'service', p_service, 'source', coalesce(p_source,'web')));
  return v_id;
end $$;
revoke all on function core_request_service(uuid, uuid, text, jsonb, uuid, text, text) from public, anon, authenticated;
