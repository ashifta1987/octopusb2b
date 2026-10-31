-- Octopus B2B — Public API + system (webhook/cron) RPCs (SPEC §7 Public API, §9, §10).
-- The customer RPCs (submit_rfq, approve_quote, request_service, transition_order) resolve the org from auth.uid().
-- API calls are authenticated by API key / client-credentials token instead of a user session, so these variants take
-- an EXPLICIT org id. They are granted ONLY to service_role: the Route Handler resolves p_org from the verified token.
-- Keep the business logic in sync with 20261101000002_business_rpcs.sql.

-- ───────────────────────── API: submit RFQ for an org ─────────────────────────
create or replace function api_submit_rfq(p_org uuid, p_title text, p_quantity int, p_details text, p_product uuid default null,
  p_destination_country text default null, p_destination_city text default null, p_target_price_cents bigint default null,
  p_incoterm text default null, p_idem text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_fee bigint := coalesce(current_service_price('rfq'),0); v_id uuid; v_unit text;
begin
  if p_org is null or not exists(select 1 from organizations where id = p_org and archived_at is null) then raise exception 'NO_ORG'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_product is not null and not exists(select 1 from products where id = p_product and status = 'live' and archived_at is null) then
    raise exception 'NOT_FOUND: product';
  end if;
  select unit into v_unit from products where id = p_product;
  insert into rfqs(org_id, product_id, title, details, quantity, unit, destination_country, destination_city, target_price_cents, incoterm,
                   status, fee_usd_cents, expires_at, created_by, category_id)
    values (p_org, p_product, p_title, p_details, p_quantity, coalesce(v_unit,'pcs'), p_destination_country, p_destination_city,
            p_target_price_cents, p_incoterm, 'submitted', v_fee, now() + interval '14 days', null,
            (select category_id from products where id = p_product))
    returning id into v_id;
  if v_fee > 0 and setting_bool('wallet_enabled') then
    perform wallet_charge(p_org, v_fee, 'RFQ fee', 'rfq_fees', coalesce('api:' || p_idem, 'rfq:' || v_id::text), 'rfq', v_id);
  end if;
  perform log_status('rfq', v_id, null, 'submitted', 'via API');
  perform emit_event('rfq.submitted', 'rfq', v_id, jsonb_build_object('org_id', p_org, 'source', 'api'));
  return v_id;
end $$;

-- ───────────────────────── API: approve quote for an org (creates PI + order) ─────────────────────────
create or replace function api_approve_quote(p_org uuid, p_quote uuid, p_terms_version uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; r record; v_order uuid; v_total bigint; v_dep bigint; v_pct int := coalesce((setting('deposit_pct'))::text::int, 30);
        v_pi text; v_terms uuid; v_code text;
begin
  select * into q from quotes where id = p_quote for update;
  if q is null then raise exception 'NOT_FOUND'; end if;
  select * into r from rfqs where id = q.rfq_id for update;
  if r.org_id is distinct from p_org then raise exception 'NOT_FOUND'; end if;   -- never leak other orgs' quotes
  if q.status not in ('sent','viewed') then raise exception 'QUOTE_NOT_APPROVABLE: %', q.status; end if;
  if q.valid_until < now() then raise exception 'QUOTE_EXPIRED'; end if;
  if p_terms_version is not null and not exists(select 1 from terms_versions where id = p_terms_version and status = 'published') then
    raise exception 'TERMS_NOT_CURRENT';
  end if;
  v_terms := coalesce(p_terms_version, (select id from terms_versions where status = 'published' order by published_at desc limit 1));
  v_total := q.unit_price_cents * q.quantity + q.shipping_cents;
  v_dep := round(v_total * v_pct / 100.0);
  update quotes set status = 'approved' where id = p_quote;
  update quotes set status = 'superseded' where rfq_id = q.rfq_id and id <> p_quote and status in ('sent','viewed');
  update rfqs set status = 'accepted' where id = q.rfq_id;
  insert into orders(org_id, quote_id, rfq_id, supplier_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents,
                     deposit_pct, deposit_cents, incoterm, terms_version_id)
    values (r.org_id, p_quote, q.rfq_id, q.supplier_id, 'deposit_pending', r.title, q.quantity, q.unit_price_cents, q.shipping_cents,
            v_total, v_pct, v_dep, q.incoterm, v_terms)
    returning id, code into v_order, v_code;
  v_pi := 'PI-' || to_char(now(),'YYYY') || '-' || lpad(nextval('seq_pi')::text, 4, '0');
  insert into proforma_invoices(number, order_id, org_id, total_cents, deposit_cents) values (v_pi, v_order, r.org_id, v_total, v_dep);
  insert into documents(org_id, doc_type, number, order_id, amount_cents, status, data)
    values (r.org_id, 'proforma_invoice', v_pi, v_order, v_total, 'awaiting_payment',
            jsonb_build_object('quote', q.code, 'rfq', r.code, 'title', r.title, 'qty', q.quantity, 'unit_price_cents', q.unit_price_cents,
                               'shipping_cents', q.shipping_cents, 'deposit_pct', v_pct, 'deposit_cents', v_dep, 'incoterm', q.incoterm,
                               'unit', r.unit, 'lead_time_days', q.lead_time_days));
  perform post_journal('PI ' || v_pi || ' issued', jsonb_build_array(
    jsonb_build_object('account', receivable_account(r.org_id), 'debit', v_total, 'credit', 0, 'org', r.org_id),
    jsonb_build_object('account', ledger_account('rev:orders','Revenue · orders','revenue'), 'debit', 0, 'credit', v_total)
  ), 'pi:' || v_order, 'orders', 'order', v_order);
  insert into order_events(order_id, org_id, kind, title, body) values
    (v_order, r.org_id, 'status', 'Proforma invoice issued', v_pi || ' · deposit ' || v_pct || '% due · via API');
  perform log_status('order', v_order, null, 'deposit_pending', 'via API');
  perform emit_event('quote.approved', 'order', v_order, jsonb_build_object('org_id', r.org_id, 'pi', v_pi, 'source', 'api'));
  return jsonb_build_object('order_id', v_order, 'order_code', v_code, 'pi_number', v_pi);
end $$;

-- ───────────────────────── API: request a service for an org ─────────────────────────
create or replace function api_request_service(p_org uuid, p_service text, p_details jsonb, p_product uuid default null, p_idem text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_fee bigint; v_id uuid; v_wallet boolean := setting_bool('wallet_enabled'); v_status service_request_status;
begin
  if p_org is null or not exists(select 1 from organizations where id = p_org and archived_at is null) then raise exception 'NO_ORG'; end if;
  if not exists(select 1 from services where code = p_service and active) then raise exception 'SERVICE_INACTIVE'; end if;
  v_fee := coalesce(current_service_price(p_service), 0);
  v_status := case when v_fee = 0 or v_wallet then 'paid' else 'requested' end;
  insert into service_requests(org_id, service_code, product_id, details, fee_usd_cents, paid_via, status, created_by)
    values (p_org, p_service, p_product, coalesce(p_details,'{}'), v_fee,
            case when v_fee = 0 then 'free' when v_wallet then 'wallet' else 'invoice' end, v_status, null)
    returning id into v_id;
  if v_fee > 0 and v_wallet then
    perform wallet_charge(p_org, v_fee, 'Service fee · ' || p_service, 'service_fees',
      coalesce('api:' || p_idem, 'svc:' || v_id::text), 'service_request', v_id);
  end if;
  perform log_status('service_request', v_id, null, v_status::text, 'via API');
  perform emit_event('service_request.' || v_status, 'service_request', v_id, jsonb_build_object('org_id', p_org, 'service', p_service, 'source', 'api'));
  return v_id;
end $$;

-- ───────────────────────── System: order transition (webhooks / jobs, no user) ─────────────────────────
create or replace function system_transition_order(p_order uuid, p_to order_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_inv text;
begin
  select * into o from orders where id = p_order for update;
  if o is null then raise exception 'NOT_FOUND'; end if;
  if o.status = p_to then return; end if;   -- idempotent for webhook replays
  if not order_transition_allowed(o.status, p_to) then raise exception 'INVALID_TRANSITION: % → %', o.status, p_to; end if;
  if p_to = 'balance_paid' and o.paid_cents < o.total_cents then raise exception 'BALANCE_NOT_PAID'; end if;
  if p_to = 'confirmed' and o.paid_cents < o.deposit_cents then raise exception 'DEPOSIT_NOT_PAID'; end if;
  update orders set status = p_to,
    delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
    claim_visible_until = case when p_to = 'delivered' then now() + make_interval(days => coalesce((setting('claim_visible_days'))::text::int,7)) else claim_visible_until end,
    claim_hidden_until = case when p_to = 'delivered' then now() + make_interval(days => coalesce((setting('claim_hidden_days'))::text::int,30)) else claim_hidden_until end
  where id = p_order;
  if p_to = 'balance_pending' then
    v_inv := 'INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('seq_invoice')::text, 4, '0');
    insert into documents(org_id, doc_type, number, order_id, amount_cents, status, data)
      values (o.org_id, 'commercial_invoice', v_inv, p_order, o.total_cents, case when o.paid_cents >= o.total_cents then 'paid' else 'awaiting_payment' end,
              jsonb_build_object('title', o.title, 'qty', o.quantity, 'unit_price_cents', o.unit_price_cents, 'shipping_cents', o.shipping_cents,
                                 'paid_cents', o.paid_cents, 'balance_cents', o.total_cents - o.paid_cents, 'incoterm', o.incoterm));
  elsif p_to = 'confirmed' then
    insert into documents(org_id, doc_type, number, order_id, amount_cents, status, data)
      values (o.org_id, 'confirmation', 'CNF-' || replace(o.code,'ORD-',''), p_order, o.total_cents, 'issued', jsonb_build_object('title', o.title));
  end if;
  insert into order_events(order_id, org_id, kind, title, body, created_by)
    values (p_order, o.org_id, 'status', initcap(replace(p_to::text,'_',' ')), coalesce(p_reason, 'System'), null);
  perform log_status('order', p_order, o.status::text, p_to::text, coalesce(p_reason, 'system'));
  perform emit_event('order.' || p_to, 'order', p_order, jsonb_build_object('org_id', o.org_id, 'source', 'system'));
end $$;

-- ───────────────────────── System: record a carrier tracking event (YunExpress webhook / poll) ─────────────────────────
-- One transaction: dedupe by provider_event_id, insert tracking_event, move shipment forward (never backwards, except
-- exception/returned), status_history, outbox event shipment.tracking, and order → delivered when the parcel is delivered.
-- Returns false when the provider event was already recorded (webhook replay).
create or replace function system_record_tracking(p_tracking_no text, p_provider_event text, p_status text, p_description text,
  p_location text default null, p_occurred_at timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare s record; v_new shipment_status; v_order_status order_status; v_inserted uuid;
  v_order text[] := array['draft','priced','created','label_ready','picked_up','in_transit','out_for_delivery','delivered'];
begin
  select * into s from shipments where tracking_no = p_tracking_no for update;
  if s is null then raise exception 'NOT_FOUND: shipment %', p_tracking_no; end if;
  insert into tracking_events(shipment_id, org_id, provider_event_id, status, description, location, occurred_at)
    values (s.id, s.org_id, p_provider_event, p_status, p_description, p_location, coalesce(p_occurred_at, now()))
    on conflict (provider_event_id) do nothing
    returning id into v_inserted;
  if v_inserted is null then return false; end if;

  if p_status in (select unnest(enum_range(null::shipment_status))::text) then
    v_new := p_status::shipment_status;
    if v_new <> s.status and (v_new in ('exception','returned') or s.status in ('exception')
        or coalesce(array_position(v_order, v_new::text), 0) > coalesce(array_position(v_order, s.status::text), 0)) then
      update shipments set status = v_new, last_event_at = greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at) where id = s.id;
      perform log_status('shipment', s.id, s.status::text, v_new::text, 'carrier webhook');
    else
      update shipments set last_event_at = greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at) where id = s.id;
    end if;
  else
    update shipments set last_event_at = greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at) where id = s.id;
  end if;

  insert into order_events(order_id, org_id, kind, title, body)
    values (s.order_id, s.org_id, 'tracking', initcap(replace(p_status,'_',' ')), concat_ws(' · ', p_description, p_location));
  perform emit_event('shipment.tracking', 'shipment', s.id, jsonb_build_object('org_id', s.org_id, 'order_id', s.order_id,
    'tracking_no', p_tracking_no, 'status', p_status, 'description', p_description, 'location', p_location, 'occurred_at', p_occurred_at));

  if p_status = 'delivered' then
    select status into v_order_status from orders where id = s.order_id;
    if v_order_status = 'shipped' then
      perform system_transition_order(s.order_id, 'delivered', 'Delivered (carrier tracking ' || p_tracking_no || ')');
    end if;
  end if;
  return true;
end $$;

-- ───────────────────────── Outbox worker helpers ─────────────────────────
-- Claims due events with SKIP LOCKED and leases them (available_at = now() + lease) so a crashed worker's events are retried.
create or replace function claim_outbox_events(p_limit int default 50, p_lease_seconds int default 300)
returns setof outbox_events language plpgsql security definer set search_path = public as $$
begin
  return query
  update outbox_events e set status = 'dispatched', available_at = now() + make_interval(secs => p_lease_seconds)
  where e.id in (
    select id from outbox_events
    where status in ('pending','dispatched') and available_at <= now()
    order by created_at
    limit greatest(1, least(p_limit, 500))
    for update skip locked)
  returning e.*;
end $$;

-- Cleanup job (SPEC §10.3): old idempotency keys (24 h) and finished outbox rows (30 days).
create or replace function job_cleanup() returns void language sql security definer set search_path = public as $$
  delete from idempotency_keys where created_at < now() - interval '24 hours';
  delete from outbox_events where status = 'done' and created_at < now() - interval '30 days';
$$;

-- ───────────────────────── Grants: service_role ONLY ─────────────────────────
do $$ declare f text;
begin
  foreach f in array array[
    'api_submit_rfq(uuid,text,integer,text,uuid,text,text,bigint,text,text)',
    'api_approve_quote(uuid,uuid,uuid)',
    'api_request_service(uuid,text,jsonb,uuid,text)',
    'system_transition_order(uuid,order_status,text)',
    'system_record_tracking(text,text,text,text,text,timestamptz)',
    'claim_outbox_events(integer,integer)',
    'job_cleanup()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

create index if not exists idempotency_keys_created_idx on idempotency_keys(created_at);
create index if not exists api_keys_client_idx on api_keys(client_id);
create index if not exists webhook_endpoints_org_idx on webhook_endpoints(org_id);
create index if not exists shipments_tracking_idx on shipments(tracking_no);
