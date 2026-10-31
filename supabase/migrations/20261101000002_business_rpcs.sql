-- Octopus B2B — business RPCs (SPEC §5, §9). Every money movement = balanced journal, one transaction, idempotent.

-- ───────────────────────── Ledger core ─────────────────────────
create or replace function ledger_account(p_code text, p_name text, p_kind text, p_org uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from ledger_accounts where code = p_code;
  if v is null then
    insert into ledger_accounts(code, name, kind, org_id) values (p_code, p_name, p_kind, p_org)
    on conflict (code) do nothing returning id into v;
    if v is null then select id into v from ledger_accounts where code = p_code; end if;
  end if;
  return v;
end $$;

create or replace function wallet_account(p_org uuid) returns uuid
language sql security definer set search_path = public as $$
  select ledger_account('wallet:' || p_org, 'Customer wallet', 'liability', p_org);
$$;

create or replace function receivable_account(p_org uuid) returns uuid
language sql security definer set search_path = public as $$
  select ledger_account('ar:' || p_org, 'Accounts receivable', 'asset', p_org);
$$;

-- entries: [{"account": uuid, "debit": cents, "credit": cents, "org": uuid, "memo": text}]
create or replace function post_journal(p_memo text, p_entries jsonb, p_idem text default null,
  p_stream text default null, p_ref_type text default null, p_ref_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_j uuid; v_d bigint; v_c bigint; e jsonb;
begin
  if p_idem is not null then
    select id into v_j from journals where idempotency_key = p_idem;
    if v_j is not null then return v_j; end if;   -- replay is a no-op
  end if;
  select coalesce(sum((x->>'debit')::bigint),0), coalesce(sum((x->>'credit')::bigint),0)
    into v_d, v_c from jsonb_array_elements(p_entries) x;
  if v_d <> v_c or v_d = 0 then
    raise exception 'LEDGER_UNBALANCED: debit % credit %', v_d, v_c using errcode = 'P0001';
  end if;
  insert into journals(memo, idempotency_key, stream, ref_type, ref_id, created_by)
    values (p_memo, p_idem, p_stream, p_ref_type, p_ref_id, auth.uid()) returning id into v_j;
  for e in select * from jsonb_array_elements(p_entries) loop
    insert into ledger_entries(journal_id, account_id, org_id, debit_cents, credit_cents, memo)
    values (v_j, (e->>'account')::uuid, nullif(e->>'org','')::uuid,
            coalesce((e->>'debit')::bigint,0), coalesce((e->>'credit')::bigint,0), coalesce(e->>'memo', p_memo));
  end loop;
  return v_j;
end $$;

create or replace function wallet_balance(p_org uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint
  from ledger_entries le join ledger_accounts la on la.id = le.account_id
  where la.code = 'wallet:' || p_org;
$$;

create or replace function my_wallet_balance() returns bigint
language sql stable security definer set search_path = public as $$
  select wallet_balance(my_org_id());
$$;

-- Debit wallet → revenue. Never negative.
create or replace function wallet_charge(p_org uuid, p_amount bigint, p_memo text, p_stream text, p_idem text,
  p_ref_type text default null, p_ref_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  perform pg_advisory_xact_lock(hashtext('wallet:' || p_org));
  if exists(select 1 from journals where idempotency_key = p_idem) then
    return (select id from journals where idempotency_key = p_idem);
  end if;
  v_bal := wallet_balance(p_org);
  if v_bal < p_amount then
    raise exception 'WALLET_INSUFFICIENT: balance % needed %', v_bal, p_amount using errcode = 'P0001';
  end if;
  return post_journal(p_memo, jsonb_build_array(
    jsonb_build_object('account', wallet_account(p_org), 'debit', p_amount, 'credit', 0, 'org', p_org),
    jsonb_build_object('account', ledger_account('rev:' || p_stream, 'Revenue · ' || p_stream, 'revenue'), 'debit', 0, 'credit', p_amount)
  ), p_idem, p_stream, p_ref_type, p_ref_id);
end $$;

-- ───────────────────────── Onboarding / profile ─────────────────────────
create or replace function complete_onboarding(p_full_name text, p_company text, p_country text, p_phone text, p_business_type text, p_city text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  insert into profiles(id, full_name, email, phone, country)
    values (v_uid, p_full_name, (select email from auth.users where id = v_uid), p_phone, p_country)
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone, country = excluded.country;
  select org_id into v_org from org_members where user_id = v_uid limit 1;
  if v_org is null then
    insert into organizations(name, country, city, business_type) values (p_company, p_country, p_city, p_business_type) returning id into v_org;
    insert into org_members(org_id, user_id, member_role) values (v_org, v_uid, 'owner');
    perform wallet_account(v_org);
    perform receivable_account(v_org);
  else
    update organizations set name = p_company, country = p_country, city = coalesce(p_city, city), business_type = p_business_type where id = v_org;
  end if;
  return v_org;
end $$;

-- ───────────────────────── KYC ─────────────────────────
create or replace function submit_kyc(p_company text, p_reg_no text, p_address text, p_contact text, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org_id(); v_id uuid; v_old kyc_status;
begin
  if v_org is null then raise exception 'NO_ORG'; end if;
  select kyc_status into v_old from organizations where id = v_org;
  if v_old in ('verified','in_review') then raise exception 'KYC_INVALID_TRANSITION: %', v_old; end if;
  insert into kyc_submissions(org_id, status, company_name, registration_no, address, contact_name, contact_phone, contact_email)
    values (v_org, 'submitted', p_company, p_reg_no, p_address, p_contact, p_phone, p_email) returning id into v_id;
  update organizations set kyc_status = 'submitted', registration_no = p_reg_no where id = v_org;
  perform log_status('kyc', v_id, v_old::text, 'submitted');
  perform emit_event('kyc.submitted', 'kyc', v_id, jsonb_build_object('org_id', v_org));
  return v_id;
end $$;

create or replace function review_kyc(p_submission uuid, p_to kyc_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not can('customers','approve') then raise exception 'FORBIDDEN'; end if;
  select * into s from kyc_submissions where id = p_submission for update;
  if s is null then raise exception 'NOT_FOUND'; end if;
  if p_to not in ('in_review','verified','rejected','more_info') then raise exception 'KYC_INVALID_TRANSITION'; end if;
  if s.status in ('verified','rejected') then raise exception 'KYC_INVALID_TRANSITION: already %', s.status; end if;
  update kyc_submissions set status = p_to, reviewer_id = auth.uid(), review_note = p_note, reviewed_at = now() where id = p_submission;
  update organizations set kyc_status = p_to where id = s.org_id;
  perform log_status('kyc', p_submission, s.status::text, p_to::text, p_note);
  perform write_audit('kyc.review', 'kyc_submissions', p_submission::text, jsonb_build_object('to', p_to));
  perform emit_event('kyc.' || p_to, 'kyc', p_submission, jsonb_build_object('org_id', s.org_id));
end $$;

-- ───────────────────────── Services (wallet path / card path) ─────────────────────────
create or replace function request_service(p_service text, p_details jsonb, p_product uuid default null, p_idem text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org_id(); v_fee bigint; v_id uuid; v_wallet boolean := setting_bool('wallet_enabled'); v_status service_request_status;
begin
  if v_org is null then raise exception 'NO_ORG'; end if;
  if not exists(select 1 from services where code = p_service and active) then raise exception 'SERVICE_INACTIVE'; end if;
  v_fee := coalesce(current_service_price(p_service), 0);
  v_status := case when v_fee = 0 or v_wallet then 'paid' else 'requested' end;
  insert into service_requests(org_id, service_code, product_id, details, fee_usd_cents, paid_via, status, created_by)
    values (v_org, p_service, p_product, coalesce(p_details,'{}'), v_fee,
            case when v_fee = 0 then 'free' when v_wallet then 'wallet' else 'invoice' end, v_status, auth.uid())
    returning id into v_id;
  if v_fee > 0 and v_wallet then
    perform wallet_charge(v_org, v_fee, 'Service fee · ' || p_service, 'service_fees',
      coalesce(p_idem, 'svc:' || v_id::text), 'service_request', v_id);
  end if;
  perform log_status('service_request', v_id, null, v_status::text);
  perform emit_event('service_request.' || v_status, 'service_request', v_id, jsonb_build_object('org_id', v_org, 'service', p_service));
  return v_id;
end $$;

create or replace function transition_service_request(p_id uuid, p_to service_request_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record; ok boolean;
begin
  if not can('requests','edit') then raise exception 'FORBIDDEN'; end if;
  select * into s from service_requests where id = p_id for update;
  ok := (s.status, p_to) in (
    ('requested','paid'),('requested','rejected'),('paid','accepted'),('paid','rejected'),('accepted','in_progress'),
    ('in_progress','report_ready'),('report_ready','completed'),('in_progress','completed'),('rejected','refunded'));
  if not ok then raise exception 'INVALID_TRANSITION: % → %', s.status, p_to; end if;
  update service_requests set status = p_to where id = p_id;
  -- refund to wallet on rejection of a wallet-paid request
  if p_to = 'rejected' and s.paid_via = 'wallet' and s.fee_usd_cents > 0 then
    perform post_journal('Refund · ' || s.code, jsonb_build_array(
      jsonb_build_object('account', ledger_account('rev:service_fees','Revenue · service_fees','revenue'), 'debit', s.fee_usd_cents, 'credit', 0),
      jsonb_build_object('account', wallet_account(s.org_id), 'debit', 0, 'credit', s.fee_usd_cents, 'org', s.org_id)
    ), 'svc-refund:' || p_id, 'service_fees', 'service_request', p_id);
    update service_requests set status = 'refunded' where id = p_id;
  end if;
  perform log_status('service_request', p_id, s.status::text, p_to::text, p_reason);
  perform emit_event('service_request.updated', 'service_request', p_id, jsonb_build_object('org_id', s.org_id, 'to', p_to));
end $$;

-- ───────────────────────── RFQ → Quote → PI → Order ─────────────────────────
create or replace function submit_rfq(p_title text, p_quantity int, p_details text, p_product uuid default null,
  p_destination_country text default null, p_destination_city text default null, p_target_price_cents bigint default null,
  p_incoterm text default null, p_idem text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org_id(); v_fee bigint := coalesce(current_service_price('rfq'),0); v_id uuid; v_unit text;
begin
  if v_org is null then raise exception 'NO_ORG'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  select unit into v_unit from products where id = p_product;
  insert into rfqs(org_id, product_id, title, details, quantity, unit, destination_country, destination_city, target_price_cents, incoterm,
                   status, fee_usd_cents, expires_at, created_by, category_id)
    values (v_org, p_product, p_title, p_details, p_quantity, coalesce(v_unit,'pcs'), p_destination_country, p_destination_city,
            p_target_price_cents, p_incoterm, 'submitted', v_fee, now() + interval '14 days', auth.uid(),
            (select category_id from products where id = p_product))
    returning id into v_id;
  if v_fee > 0 and setting_bool('wallet_enabled') then
    perform wallet_charge(v_org, v_fee, 'RFQ fee', 'rfq_fees', coalesce(p_idem, 'rfq:' || v_id::text), 'rfq', v_id);
  end if;
  perform log_status('rfq', v_id, null, 'submitted');
  perform emit_event('rfq.submitted', 'rfq', v_id, jsonb_build_object('org_id', v_org));
  return v_id;
end $$;

create or replace function send_quote(p_rfq uuid, p_supplier uuid, p_unit_price_cents bigint, p_quantity int,
  p_incoterm text, p_lead_days int, p_shipping_cents bigint default 0, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; v_id uuid; v_n int; v_validity int := coalesce((setting('quote_validity_days'))::text::int, 30);
begin
  if not (can('requests','create') or is_my_supplier(p_supplier)) then raise exception 'FORBIDDEN'; end if;
  if has_role('distributor') and not is_admin() and not is_my_supplier(p_supplier) then raise exception 'FORBIDDEN_SUPPLIER'; end if;
  if not coalesce((select rfq_replies from supplier_switches where supplier_id = p_supplier), true) then raise exception 'SUPPLIER_RFQ_REPLIES_OFF'; end if;
  select * into r from rfqs where id = p_rfq for update;
  if r.status not in ('submitted','assigned','quoting','quoted') then raise exception 'RFQ_NOT_OPEN: %', r.status; end if;
  select count(*) + 1 into v_n from quotes where rfq_id = p_rfq;
  insert into quotes(code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until, created_by)
    values ('QT-' || replace(r.code,'RFQ-','') || '-' || v_n, p_rfq, p_supplier, p_unit_price_cents, p_quantity, p_incoterm, p_lead_days,
            coalesce(p_shipping_cents,0), p_notes, 'sent', now() + make_interval(days => v_validity), auth.uid())
    returning id into v_id;
  update rfqs set status = 'quoted' where id = p_rfq;
  perform log_status('rfq', p_rfq, r.status::text, 'quoted');
  perform emit_event('quote.sent', 'quote', v_id, jsonb_build_object('org_id', r.org_id, 'rfq_id', p_rfq));
  return v_id;
end $$;

create or replace function approve_quote(p_quote uuid, p_terms_version uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; r record; v_order uuid; v_total bigint; v_dep bigint; v_pct int := coalesce((setting('deposit_pct'))::text::int, 30);
        v_pi text; v_terms uuid; v_code text;
begin
  select * into q from quotes where id = p_quote for update;
  if q is null then raise exception 'NOT_FOUND'; end if;
  select * into r from rfqs where id = q.rfq_id for update;
  if r.org_id not in (select my_org_ids()) then raise exception 'FORBIDDEN'; end if;
  if q.status not in ('sent','viewed') then raise exception 'QUOTE_NOT_APPROVABLE: %', q.status; end if;
  if q.valid_until < now() then raise exception 'QUOTE_EXPIRED'; end if;
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
  -- receivable for the full order value (sales revenue recognised as order margin stream)
  perform post_journal('PI ' || v_pi || ' issued', jsonb_build_array(
    jsonb_build_object('account', receivable_account(r.org_id), 'debit', v_total, 'credit', 0, 'org', r.org_id),
    jsonb_build_object('account', ledger_account('rev:orders','Revenue · orders','revenue'), 'debit', 0, 'credit', v_total)
  ), 'pi:' || v_order, 'orders', 'order', v_order);
  insert into order_events(order_id, org_id, kind, title, body) values
    (v_order, r.org_id, 'status', 'Proforma invoice issued', v_pi || ' · deposit ' || v_pct || '% due');
  perform log_status('order', v_order, null, 'deposit_pending');
  perform emit_event('quote.approved', 'order', v_order, jsonb_build_object('org_id', r.org_id, 'pi', v_pi));
  return jsonb_build_object('order_id', v_order, 'order_code', v_code, 'pi_number', v_pi);
end $$;

create or replace function order_transition_allowed(p_from order_status, p_to order_status) returns boolean
language sql immutable as $$
  select (p_from, p_to) in (
    ('pi_issued','deposit_pending'),('deposit_pending','deposit_paid'),('deposit_paid','confirmed'),('confirmed','in_production'),
    ('in_production','qc'),('in_production','balance_pending'),('qc','balance_pending'),('balance_pending','balance_paid'),
    ('balance_paid','ready_to_ship'),('ready_to_ship','shipped'),('shipped','delivered'),('delivered','closed'),
    ('pi_issued','cancelled'),('deposit_pending','cancelled'),('delivered','disputed'),('disputed','closed'));
$$;

create or replace function transition_order(p_order uuid, p_to order_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_inv text;
begin
  select * into o from orders where id = p_order for update;
  if o is null then raise exception 'NOT_FOUND'; end if;
  -- customers may only cancel before deposit; everything else is staff
  if not (can('orders','edit') or (p_to = 'cancelled' and o.org_id in (select my_org_ids()))) then raise exception 'FORBIDDEN'; end if;
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
    values (p_order, o.org_id, 'status', initcap(replace(p_to::text,'_',' ')), p_reason, auth.uid());
  perform log_status('order', p_order, o.status::text, p_to::text, p_reason);
  perform emit_event('order.' || p_to, 'order', p_order, jsonb_build_object('org_id', o.org_id));
end $$;

-- Finance records/matches an incoming payment against an order (bank transfer or card) or pays from wallet
create or replace function record_payment(p_order uuid, p_amount bigint, p_method text, p_reference text, p_provider_event text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare o record; v_pay uuid; v_purpose text; v_from_wallet boolean := p_method = 'wallet'; v_debit_acct uuid;
begin
  select * into o from orders where id = p_order for update;
  if o is null then raise exception 'NOT_FOUND'; end if;
  if v_from_wallet then
    if o.org_id not in (select my_org_ids()) and not can('wallet','approve') then raise exception 'FORBIDDEN'; end if;
    if not setting_bool('wallet_enabled') then raise exception 'WALLET_DISABLED'; end if;
  elsif not can('finance','approve') then raise exception 'FORBIDDEN';
  end if;
  if p_provider_event is not null and exists(select 1 from payments where provider_event_id = p_provider_event) then
    return (select id from payments where provider_event_id = p_provider_event);   -- webhook replay
  end if;
  if p_amount <= 0 or o.paid_cents + p_amount > o.total_cents then raise exception 'INVALID_AMOUNT'; end if;
  v_purpose := case when o.paid_cents < o.deposit_cents then 'deposit' else 'balance' end;
  insert into payments(org_id, order_id, purpose, method, amount_cents, reference, provider_event_id, status, matched_by, confirmed_at)
    values (o.org_id, p_order, v_purpose, p_method, p_amount, p_reference, p_provider_event, 'confirmed', auth.uid(), now())
    returning id into v_pay;
  if v_from_wallet then
    perform pg_advisory_xact_lock(hashtext('wallet:' || o.org_id));
    if wallet_balance(o.org_id) < p_amount then raise exception 'WALLET_INSUFFICIENT'; end if;
    v_debit_acct := wallet_account(o.org_id);
  else
    v_debit_acct := ledger_account('cash:bank', 'Bank / payment partner', 'asset');
  end if;
  perform post_journal('Payment ' || coalesce(p_reference, v_pay::text) || ' · ' || o.code, jsonb_build_array(
    jsonb_build_object('account', v_debit_acct, 'debit', p_amount, 'credit', 0, 'org', case when v_from_wallet then o.org_id::text else '' end),
    jsonb_build_object('account', receivable_account(o.org_id), 'debit', 0, 'credit', p_amount, 'org', o.org_id)
  ), 'pay:' || v_pay, 'orders', 'payment', v_pay);
  update orders set paid_cents = paid_cents + p_amount where id = p_order;
  insert into documents(org_id, doc_type, number, order_id, amount_cents, status, data)
    values (o.org_id, 'receipt', 'RCT-' || upper(substr(v_pay::text,1,8)), p_order, p_amount, 'paid',
            jsonb_build_object('method', p_method, 'reference', p_reference, 'purpose', v_purpose));
  insert into order_events(order_id, org_id, kind, title, body) values (p_order, o.org_id, 'payment', 'Payment received',
    to_char(p_amount/100.0, 'FM999,999,990.00') || ' USD · ' || v_purpose);
  -- auto-advance status
  if o.status = 'deposit_pending' and o.paid_cents + p_amount >= o.deposit_cents then
    update orders set status = 'deposit_paid' where id = p_order;
    perform log_status('order', p_order, 'deposit_pending', 'deposit_paid', 'deposit matched');
  elsif o.status = 'balance_pending' and o.paid_cents + p_amount >= o.total_cents then
    update orders set status = 'balance_paid' where id = p_order;
    update documents set status = 'paid' where order_id = p_order and doc_type in ('commercial_invoice','proforma_invoice');
    perform log_status('order', p_order, 'balance_pending', 'balance_paid', 'balance matched');
  end if;
  perform emit_event('payment.confirmed', 'payment', v_pay, jsonb_build_object('org_id', o.org_id, 'order_id', p_order));
  return v_pay;
end $$;

-- ───────────────────────── Wallet top-ups ─────────────────────────
create or replace function request_topup(p_amount bigint, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid := my_org_id();
begin
  if not setting_bool('wallet_enabled') then raise exception 'WALLET_DISABLED'; end if;
  if v_org is null then raise exception 'NO_ORG'; end if;
  if p_amount < 100 then raise exception 'INVALID_AMOUNT'; end if;
  insert into wallet_topups(org_id, amount_cents, method, reference, status, created_by)
    values (v_org, p_amount, p_method, p_reference, 'pending', auth.uid()) returning id into v_id;
  perform emit_event('wallet.topup_requested', 'wallet_topup', v_id, jsonb_build_object('org_id', v_org));
  return v_id;
end $$;

create or replace function confirm_topup(p_topup uuid, p_provider_event text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not can('wallet','approve') and auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into t from wallet_topups where id = p_topup for update;
  if t.status = 'credited' then return; end if;   -- idempotent
  if t.status <> 'pending' then raise exception 'INVALID_TRANSITION'; end if;
  perform post_journal('Wallet top-up ' || coalesce(t.reference,''), jsonb_build_array(
    jsonb_build_object('account', ledger_account('cash:bank','Bank / payment partner','asset'), 'debit', t.amount_cents, 'credit', 0),
    jsonb_build_object('account', wallet_account(t.org_id), 'debit', 0, 'credit', t.amount_cents, 'org', t.org_id)
  ), coalesce('topup-evt:' || p_provider_event, 'topup:' || p_topup), null, 'wallet_topup', p_topup);
  update wallet_topups set status = 'credited' where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'credited');
  perform emit_event('wallet.updated', 'wallet_topup', p_topup, jsonb_build_object('org_id', t.org_id));
end $$;

-- ───────────────────────── Finance approvals (maker–checker) ─────────────────────────
create or replace function request_finance_approval(p_kind text, p_amount bigint, p_reason text, p_org uuid default null,
  p_order uuid default null, p_supplier uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (can('finance','create') or can('support','create')) then raise exception 'FORBIDDEN'; end if;
  insert into finance_approvals(kind, org_id, order_id, supplier_id, amount_cents, reason, requested_by)
    values (p_kind, p_org, p_order, p_supplier, p_amount, p_reason, auth.uid()) returning id into v_id;
  perform write_audit('finance.request', 'finance_approvals', v_id::text, jsonb_build_object('kind', p_kind, 'amount', p_amount));
  return v_id;
end $$;

create or replace function decide_finance_approval(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record; v_limit bigint := coalesce((setting('finance_approval_limit_cents'))::text::bigint, 100000); v_j uuid;
begin
  if not can('finance','approve') then raise exception 'FORBIDDEN'; end if;
  select * into a from finance_approvals where id = p_id for update;
  if a.status <> 'requested' then raise exception 'INVALID_TRANSITION'; end if;
  if a.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE'; end if;
  if p_approve and a.amount_cents > v_limit and not is_admin() then raise exception 'OVER_LIMIT_NEEDS_ADMIN'; end if;
  if not p_approve then
    update finance_approvals set status = 'rejected', approved_by = auth.uid(), decided_at = now() where id = p_id;
  else
    if a.kind in ('refund','credit_note','adjustment') and a.org_id is not null then
      v_j := post_journal(initcap(replace(a.kind,'_',' ')) || ' · ' || a.reason, jsonb_build_array(
        jsonb_build_object('account', ledger_account('exp:refunds','Refunds & credits','expense'), 'debit', a.amount_cents, 'credit', 0),
        jsonb_build_object('account', wallet_account(a.org_id), 'debit', 0, 'credit', a.amount_cents, 'org', a.org_id)
      ), 'fa:' || p_id, 'refunds', 'finance_approval', p_id);
      if a.kind = 'credit_note' then
        insert into documents(org_id, doc_type, number, order_id, amount_cents, status, data)
        values (a.org_id, 'credit_note', 'CN-' || upper(substr(p_id::text,1,8)), a.order_id, a.amount_cents, 'issued', jsonb_build_object('reason', a.reason));
      end if;
    elsif a.kind = 'payout' then
      insert into payouts(supplier_id, amount_cents, status, approval_id) values (a.supplier_id, a.amount_cents, 'approved', p_id);
    end if;
    update finance_approvals set status = case when v_j is not null or a.kind = 'payout' then 'executed' else 'approved' end,
      approved_by = auth.uid(), decided_at = now(), executed_journal_id = v_j where id = p_id;
  end if;
  perform write_audit('finance.decide', 'finance_approvals', p_id::text, jsonb_build_object('approve', p_approve, 'note', p_note));
end $$;

-- ───────────────────────── Product moderation ─────────────────────────
create or replace function transition_product(p_product uuid, p_to product_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p record; ok boolean;
begin
  select * into p from products where id = p_product for update;
  if p is null then raise exception 'NOT_FOUND'; end if;
  if p_to in ('live','rejected','in_review') then
    if not can('products','approve') then raise exception 'FORBIDDEN'; end if;
  elsif not (can('products','edit') or is_my_supplier(p.supplier_id)) then raise exception 'FORBIDDEN';
  end if;
  ok := (p.status, p_to) in (('draft','submitted'),('rejected','submitted'),('submitted','in_review'),('submitted','live'),('submitted','rejected'),
        ('in_review','live'),('in_review','rejected'),('live','paused'),('paused','live'),('live','archived'),('paused','archived'),('draft','archived'));
  if not ok then raise exception 'INVALID_TRANSITION: % → %', p.status, p_to; end if;
  if p_to = 'live' and not coalesce((select listings_live from supplier_switches where supplier_id = p.supplier_id), true) then
    raise exception 'SUPPLIER_LISTINGS_OFF';
  end if;
  update products set status = p_to, rejection_reason = case when p_to = 'rejected' then p_reason else null end where id = p_product;
  perform log_status('product', p_product, p.status::text, p_to::text, p_reason);
  if p_to = 'live' then perform emit_event('product.published', 'product', p_product, '{}'); end if;
end $$;

-- ───────────────────────── Support ─────────────────────────
create or replace function create_ticket(p_subject text, p_category text, p_body text, p_order uuid default null, p_priority text default 'normal', p_attachments jsonb default '[]')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org_id(); v_id uuid; v_hours int;
begin
  if v_org is null then raise exception 'NO_ORG'; end if;
  select first_response_hours into v_hours from sla_policies where priority = p_priority;
  insert into tickets(org_id, order_id, subject, category, priority, status, sla_due_at, created_by)
    values (v_org, p_order, p_subject, p_category, p_priority, 'new', now() + make_interval(hours => coalesce(v_hours, 24)), auth.uid())
    returning id into v_id;
  insert into ticket_messages(ticket_id, org_id, author_id, body, attachments) values (v_id, v_org, auth.uid(), p_body, coalesce(p_attachments,'[]'));
  perform emit_event('ticket.created', 'ticket', v_id, jsonb_build_object('org_id', v_org));
  return v_id;
end $$;

create or replace function reply_ticket(p_ticket uuid, p_body text, p_internal boolean default false, p_status ticket_status default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_staff boolean := can('support','edit');
begin
  select * into t from tickets where id = p_ticket for update;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not v_staff and t.org_id not in (select my_org_ids()) then raise exception 'FORBIDDEN'; end if;
  insert into ticket_messages(ticket_id, org_id, author_id, is_staff, internal, body)
    values (p_ticket, t.org_id, auth.uid(), v_staff, v_staff and p_internal, p_body);
  update tickets set status = coalesce(p_status, case when v_staff then 'waiting_customer'::ticket_status
                                                     when t.status in ('resolved','closed') then 'reopened'::ticket_status
                                                     else 'open'::ticket_status end),
                     assigned_to = case when v_staff and assigned_to is null then auth.uid() else assigned_to end
  where id = p_ticket;
  perform emit_event('ticket.replied', 'ticket', p_ticket, jsonb_build_object('org_id', t.org_id, 'staff', v_staff));
end $$;

-- ───────────────────────── Advertising ─────────────────────────
create or replace function record_ad_click(p_campaign uuid, p_fingerprint text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c record; v_charge bigint;
begin
  select * into c from ad_campaigns where id = p_campaign for update;
  if c is null or c.status <> 'active' or not setting_bool('ads_enabled') then return false; end if;
  -- dedupe: one charge per fingerprint per campaign per 24h
  if exists(select 1 from ad_clicks where campaign_id = p_campaign and fingerprint = p_fingerprint and created_at > now() - interval '24 hours') then
    insert into ad_clicks(campaign_id, fingerprint, charged_cents, valid) values (p_campaign, p_fingerprint, 0, false);
    return false;
  end if;
  v_charge := c.max_cpc_cents;
  if c.spent_today_cents + v_charge > c.daily_budget_cents or c.org_id is null or wallet_balance(c.org_id) < v_charge then
    update ad_campaigns set status = 'paused' where id = p_campaign;
    return false;
  end if;
  insert into ad_clicks(campaign_id, fingerprint, charged_cents) values (p_campaign, p_fingerprint, v_charge);
  perform wallet_charge(c.org_id, v_charge, 'Ad click · ' || c.name, 'ads', 'adclick:' || p_campaign || ':' || p_fingerprint || ':' || to_char(now(),'YYYYMMDD'), 'ad_campaign', p_campaign);
  update ad_campaigns set spent_today_cents = spent_today_cents + v_charge where id = p_campaign;
  return true;
end $$;

-- ───────────────────────── Scheduled jobs (called by pg_cron / Vercel cron) ─────────────────────────
create or replace function job_expire_quotes() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update quotes set status = 'expired' where status in ('sent','viewed') and valid_until < now();
  get diagnostics n = row_count;
  update rfqs set status = 'expired' where status in ('submitted','assigned','quoting') and expires_at < now();
  return n;
end $$;

create or replace function job_reset_ad_budgets() returns void language sql security definer set search_path = public as $$
  update ad_campaigns set spent_today_cents = 0, status = case when status = 'paused' then 'active'::campaign_status else status end
  where status in ('active','paused');
$$;

create or replace function job_close_claim_windows() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update orders set status = 'closed' where status = 'delivered' and claim_hidden_until < now();
  get diagnostics n = row_count; return n;
end $$;

create or replace function job_publish_scheduled_terms() returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  for v in select id from terms_versions where status = 'scheduled' and publish_at <= now() loop
    update terms_versions set status = 'superseded' where status = 'published';
    update terms_versions set status = 'published', published_at = now() where id = v;
    perform emit_event('terms.published', 'terms', v, '{}');
  end loop;
end $$;

create or replace function job_certificate_expiry() returns void language sql security definer set search_path = public as $$
  update certificates set status = 'expired' where status in ('verified','expiring') and expires_at < current_date;
  update certificates set status = 'expiring' where status = 'verified' and expires_at < current_date + 30;
$$;
