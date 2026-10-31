-- SPEC §15.1 — Platform currency USD ↔ CNY.
-- Conventions after this migration:
--   * Every money column holds MINOR units (cents / fen) of the currency in the row's `currency` column.
--     Columns that embedded a currency name are renamed (amount_usd_cents → amount_minor, fee_usd_cents → fee_minor);
--     legacy *_cents columns are generic minor units of `currency` (both USD and CNY have 100 minor units).
--   * Documents (quotes, PIs, orders, service requests, ad campaigns, payments, top-ups, documents) lock currency + fx_rate_id at creation.
--   * One wallet ledger account per (org, currency). Journals balance per currency; cross-currency moves use fx_conversion accounts.

-- ───────────────────────── FX rates (approved by Admin; reference rates are display-only) ─────────────────────────
drop table if exists fx_rates cascade;
create table fx_rates (
  id uuid primary key default gen_random_uuid(),
  base char(3) not null default 'USD' check (base = 'USD'),
  quote char(3) not null default 'CNY' check (quote = 'CNY'),
  rate numeric(12,6) not null check (rate > 0),         -- CNY per 1 USD
  effective_from timestamptz not null default now(),
  set_by uuid references auth.users(id),
  source text not null default 'manual' check (source in ('manual','reference')),
  note text,
  created_at timestamptz not null default now()
);
create index on fx_rates(source, effective_from desc);
alter table fx_rates enable row level security;
create policy fx_read on fx_rates for select using (true);

insert into fx_rates(rate, source, note, effective_from) values (7.100000, 'manual', 'Seed rate — review in Admin › Currency', now() - interval '1 day');

insert into site_settings(key, value, description, is_public) values
  ('platform_currency', '"USD"', 'Active platform currency (USD or CNY) — change only via Admin › Currency switch', true),
  ('currency_rounding', '{"USD":{"step_minor":1},"CNY":{"step_minor":1}}', 'Rounding step (minor units) when converting into each currency', true),
  ('currency_switch_banner', 'null', 'Banner shown after a currency switch', true)
on conflict (key) do nothing;
update content_blocks set value = replace(value, 'All prices in USD', 'All prices in {currency}') where value like '%All prices in USD%';

create or replace function current_platform_currency() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from site_settings where key = 'platform_currency'), 'USD');
$$;

create or replace function current_fx_rate_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from fx_rates where source = 'manual' and effective_from <= now() order by effective_from desc, created_at desc limit 1;
$$;

create or replace function round_minor(p_amount numeric, p_currency text) returns bigint
language sql stable security definer set search_path = public as $$
  select (round(p_amount / s) * s)::bigint
  from (select greatest(coalesce((setting('currency_rounding') -> p_currency ->> 'step_minor')::numeric, 1), 1) s) x;
$$;

create or replace function convert_amount(p_amount bigint, p_from text, p_to text, p_fx_rate_id uuid default null) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_rate numeric;
begin
  if p_amount is null then return null; end if;
  if p_from = p_to then return p_amount; end if;
  select rate into v_rate from fx_rates where id = coalesce(p_fx_rate_id, current_fx_rate_id());
  if v_rate is null then raise exception 'FX_RATE_MISSING'; end if;
  if p_from = 'USD' and p_to = 'CNY' then return round_minor(p_amount * v_rate, 'CNY'); end if;
  if p_from = 'CNY' and p_to = 'USD' then return round_minor(p_amount / v_rate, 'USD'); end if;
  raise exception 'UNSUPPORTED_CURRENCY: % → %', p_from, p_to;
end $$;

-- ───────────────────────── Currency columns ─────────────────────────
alter table service_prices rename column amount_usd_cents to amount_minor;
alter table service_requests rename column fee_usd_cents to fee_minor;
alter table rfqs rename column fee_usd_cents to fee_minor;

do $$ declare t text;
begin
  foreach t in array array['service_prices','service_requests','rfqs','quotes','proforma_invoices','orders','ad_campaigns','ad_clicks',
                           'payments','wallet_topups','wallet_withdrawals','documents','finance_approvals','payouts','price_tiers','products','shipments','ledger_accounts','ledger_entries'] loop
    execute format('alter table %I add column if not exists currency char(3) not null default ''USD'' check (currency in (''USD'',''CNY''))', t);
  end loop;
  foreach t in array array['quotes','proforma_invoices','orders','service_requests','ad_campaigns'] loop
    execute format('alter table %I add column if not exists fx_rate_id uuid references fx_rates(id)', t);
  end loop;
end $$;
update quotes set fx_rate_id = current_fx_rate_id() where fx_rate_id is null;
update orders set fx_rate_id = current_fx_rate_id() where fx_rate_id is null;
update proforma_invoices set fx_rate_id = current_fx_rate_id() where fx_rate_id is null;
update service_requests set fx_rate_id = current_fx_rate_id() where fx_rate_id is null;
update ad_campaigns set fx_rate_id = current_fx_rate_id() where fx_rate_id is null;
create index on service_prices(service_code, currency, effective_from desc);

-- ledger entries inherit the account currency
create or replace function set_entry_currency() returns trigger language plpgsql as $$
begin
  select currency into new.currency from ledger_accounts where id = new.account_id;
  return new;
end $$;
create trigger trg_entry_currency before insert on ledger_entries for each row execute function set_entry_currency();
create unique index wallets_org_currency on ledger_accounts(org_id, currency) where code like 'wallet:%';

-- currency is immutable once a record exists (documents lock their currency)
create or replace function guard_currency_immutable() returns trigger language plpgsql as $$
begin
  if new.currency is distinct from old.currency then raise exception 'CURRENCY_LOCKED'; end if;
  return new;
end $$;
do $$ declare t text;
begin
  foreach t in array array['quotes','proforma_invoices','orders','service_requests','ad_campaigns','payments','wallet_topups','documents','finance_approvals','ledger_accounts','ledger_entries'] loop
    execute format('create trigger trg_currency_locked_%s before update on %I for each row execute function guard_currency_immutable()', t, t);
  end loop;
end $$;

-- ad campaigns created by clients take the platform currency + rate at creation
create or replace function set_campaign_currency() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.currency := current_platform_currency();
  new.fx_rate_id := current_fx_rate_id();
  return new;
end $$;
create trigger trg_campaign_currency before insert on ad_campaigns for each row execute function set_campaign_currency();

-- ───────────────────────── Accounts per currency ─────────────────────────
create or replace function acct_code(p_base text, p_currency text) returns text
language sql immutable as $$ select p_base || case when coalesce(p_currency,'USD') = 'USD' then '' else ':' || p_currency end $$;

drop function if exists ledger_account(text,text,text,uuid) cascade;
create or replace function ledger_account(p_code text, p_name text, p_kind text, p_org uuid default null, p_currency text default 'USD')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from ledger_accounts where code = p_code;
  if v is null then
    insert into ledger_accounts(code, name, kind, org_id, currency) values (p_code, p_name, p_kind, p_org, coalesce(p_currency,'USD'))
    on conflict (code) do nothing returning id into v;
    if v is null then select id into v from ledger_accounts where code = p_code; end if;
  end if;
  return v;
end $$;

drop function if exists wallet_account(uuid) cascade;
create or replace function wallet_account(p_org uuid, p_currency text default 'USD') returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('wallet:' || p_org, p_currency), 'Customer wallet · ' || p_currency, 'liability', p_org, p_currency);
$$;
drop function if exists receivable_account(uuid) cascade;
create or replace function receivable_account(p_org uuid, p_currency text default 'USD') returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('ar:' || p_org, p_currency), 'Accounts receivable · ' || p_currency, 'asset', p_org, p_currency);
$$;
create or replace function revenue_account(p_stream text, p_currency text default 'USD') returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('rev:' || p_stream, p_currency), 'Revenue · ' || p_stream || ' · ' || p_currency, 'revenue', null, p_currency);
$$;
create or replace function cash_account(p_currency text default 'USD') returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('cash:bank', p_currency), 'Bank / payment partner · ' || p_currency, 'asset', null, p_currency);
$$;
create or replace function fx_conversion_account(p_currency text) returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('fx_conversion', p_currency), 'FX conversion · ' || p_currency, 'equity', null, p_currency);
$$;
create or replace function refunds_account(p_currency text default 'USD') returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('exp:refunds', p_currency), 'Refunds & credits · ' || p_currency, 'expense', null, p_currency);
$$;

-- Journals must balance PER CURRENCY
create or replace function post_journal(p_memo text, p_entries jsonb, p_idem text default null,
  p_stream text default null, p_ref_type text default null, p_ref_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_j uuid; e jsonb; v_bad text; v_total bigint;
begin
  if p_idem is not null then
    select id into v_j from journals where idempotency_key = p_idem;
    if v_j is not null then return v_j; end if;
  end if;
  select coalesce(sum((x->>'debit')::bigint),0) into v_total from jsonb_array_elements(p_entries) x;
  select string_agg(cur || ' ' || d || '/' || c, ', ') into v_bad from (
    select la.currency cur, sum(coalesce((x->>'debit')::bigint,0)) d, sum(coalesce((x->>'credit')::bigint,0)) c
    from jsonb_array_elements(p_entries) x join ledger_accounts la on la.id = (x->>'account')::uuid
    group by la.currency having sum(coalesce((x->>'debit')::bigint,0)) <> sum(coalesce((x->>'credit')::bigint,0))) b;
  if v_bad is not null or v_total = 0 then
    raise exception 'LEDGER_UNBALANCED: %', coalesce(v_bad, 'empty journal') using errcode = 'P0001';
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

drop function if exists wallet_balance(uuid) cascade;
create or replace function wallet_balance(p_org uuid, p_currency text default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint
  from ledger_entries le join ledger_accounts la on la.id = le.account_id
  where la.code = acct_code('wallet:' || p_org, coalesce(p_currency, current_platform_currency()));
$$;

drop function if exists my_wallet_balance() cascade;
create or replace function my_wallet_balance(p_currency text default null) returns bigint
language sql stable security definer set search_path = public as $$
  select wallet_balance(my_org_id(), p_currency);
$$;

-- all wallets of my org (or all, for finance) with balances per currency
create or replace view wallets with (security_invoker = true) as
  select la.org_id, la.currency, la.id as account_id,
         coalesce((select sum(le.credit_cents - le.debit_cents) from ledger_entries le where le.account_id = la.id), 0)::bigint as balance_minor
  from ledger_accounts la where la.code like 'wallet:%';
grant select on wallets to authenticated;

drop function if exists wallet_charge(uuid,bigint,text,text,text,text,uuid) cascade;
create or replace function wallet_charge(p_org uuid, p_amount bigint, p_memo text, p_stream text, p_idem text,
  p_ref_type text default null, p_ref_id uuid default null, p_currency text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bal bigint; v_cur text := coalesce(p_currency, current_platform_currency());
begin
  perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || p_org, v_cur)));
  if exists(select 1 from journals where idempotency_key = p_idem) then
    return (select id from journals where idempotency_key = p_idem);
  end if;
  v_bal := wallet_balance(p_org, v_cur);
  if v_bal < p_amount then
    raise exception 'WALLET_INSUFFICIENT: balance % needed % %', v_bal, p_amount, v_cur using errcode = 'P0001';
  end if;
  return post_journal(p_memo, jsonb_build_array(
    jsonb_build_object('account', wallet_account(p_org, v_cur), 'debit', p_amount, 'credit', 0, 'org', p_org),
    jsonb_build_object('account', revenue_account(p_stream, v_cur), 'debit', 0, 'credit', p_amount)
  ), p_idem, p_stream, p_ref_type, p_ref_id);
end $$;

-- ───────────────────────── Service prices per currency ─────────────────────────
drop function if exists current_service_price(text) cascade;
create or replace function service_price_info(p_code text, p_currency text default null)
returns table(amount_minor bigint, currency text, converted boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := coalesce(p_currency, current_platform_currency()); v_amt bigint; v_usd bigint;
begin
  select sp.amount_minor into v_amt from service_prices sp
    where sp.service_code = p_code and sp.currency = v_cur and sp.effective_from <= now() order by sp.effective_from desc limit 1;
  if v_amt is not null then return query select v_amt, v_cur, false; return; end if;
  select sp.amount_minor into v_usd from service_prices sp
    where sp.service_code = p_code and sp.currency = 'USD' and sp.effective_from <= now() order by sp.effective_from desc limit 1;
  if v_usd is null then return query select null::bigint, v_cur, false; return; end if;
  return query select convert_amount(v_usd, 'USD', v_cur), v_cur, v_cur <> 'USD';
end $$;

create or replace function current_service_price(p_code text, p_currency text default null) returns bigint
language sql stable security definer set search_path = public as $$
  select amount_minor from service_price_info(p_code, p_currency);
$$;

-- ───────────────────────── Core trade functions (shared by customer UI and public API) ─────────────────────────
create or replace function core_submit_rfq(p_org uuid, p_actor uuid, p_title text, p_quantity int, p_details text, p_product uuid,
  p_destination_country text, p_destination_city text, p_target_price_minor bigint, p_incoterm text, p_idem text, p_source text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cur text := current_platform_currency(); v_fee bigint := coalesce(current_service_price('rfq', v_cur), 0); v_id uuid; v_unit text;
begin
  if p_org is null or not exists(select 1 from organizations where id = p_org and archived_at is null) then raise exception 'NO_ORG'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_product is not null and not exists(select 1 from products where id = p_product and status = 'live' and archived_at is null) then
    raise exception 'NOT_FOUND: product';
  end if;
  select unit into v_unit from products where id = p_product;
  insert into rfqs(org_id, product_id, title, details, quantity, unit, destination_country, destination_city, target_price_cents, incoterm,
                   status, fee_minor, currency, expires_at, created_by, category_id)
    values (p_org, p_product, p_title, p_details, p_quantity, coalesce(v_unit,'pcs'), p_destination_country, p_destination_city,
            p_target_price_minor, p_incoterm, 'submitted', v_fee, v_cur, now() + interval '14 days', p_actor,
            (select category_id from products where id = p_product))
    returning id into v_id;
  if v_fee > 0 and setting_bool('wallet_enabled') then
    perform wallet_charge(p_org, v_fee, 'RFQ fee', 'rfq_fees', coalesce(p_idem, 'rfq:' || v_id::text), 'rfq', v_id, v_cur);
  end if;
  perform log_status('rfq', v_id, null, 'submitted', p_source);
  perform emit_event('rfq.submitted', 'rfq', v_id, jsonb_build_object('org_id', p_org, 'source', coalesce(p_source,'web')));
  return v_id;
end $$;

create or replace function core_request_service(p_org uuid, p_actor uuid, p_service text, p_details jsonb, p_product uuid, p_idem text, p_source text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cur text := current_platform_currency(); v_fee bigint; v_id uuid; v_wallet boolean := setting_bool('wallet_enabled'); v_status service_request_status;
begin
  if p_org is null or not exists(select 1 from organizations where id = p_org and archived_at is null) then raise exception 'NO_ORG'; end if;
  if not exists(select 1 from services where code = p_service and active) then raise exception 'SERVICE_INACTIVE'; end if;
  v_fee := coalesce(current_service_price(p_service, v_cur), 0);
  v_status := case when v_fee = 0 or v_wallet then 'paid' else 'requested' end;
  insert into service_requests(org_id, service_code, product_id, details, fee_minor, currency, fx_rate_id, paid_via, status, created_by)
    values (p_org, p_service, p_product, coalesce(p_details,'{}'), v_fee, v_cur, current_fx_rate_id(),
            case when v_fee = 0 then 'free' when v_wallet then 'wallet' else 'invoice' end, v_status, p_actor)
    returning id into v_id;
  if v_fee > 0 and v_wallet then
    perform wallet_charge(p_org, v_fee, 'Service fee · ' || p_service, 'service_fees', coalesce(p_idem, 'svc:' || v_id::text), 'service_request', v_id, v_cur);
  end if;
  perform log_status('service_request', v_id, null, v_status::text, p_source);
  perform emit_event('service_request.' || v_status, 'service_request', v_id, jsonb_build_object('org_id', p_org, 'service', p_service, 'source', coalesce(p_source,'web')));
  return v_id;
end $$;

create or replace function core_approve_quote(p_org uuid, p_quote uuid, p_terms_version uuid, p_source text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; r record; v_order uuid; v_total bigint; v_dep bigint; v_pct int := coalesce((setting('deposit_pct'))::text::int, 30);
        v_pi text; v_terms uuid; v_code text;
begin
  select * into q from quotes where id = p_quote for update;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into r from rfqs where id = q.rfq_id for update;
  if r.org_id is distinct from p_org then raise exception 'NOT_FOUND'; end if;
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
  -- the order, PI and document lock the QUOTE's currency and rate (a later platform switch never changes them)
  insert into orders(org_id, quote_id, rfq_id, supplier_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents,
                     deposit_pct, deposit_cents, incoterm, terms_version_id, currency, fx_rate_id)
    values (r.org_id, p_quote, q.rfq_id, q.supplier_id, 'deposit_pending', r.title, q.quantity, q.unit_price_cents, q.shipping_cents,
            v_total, v_pct, v_dep, q.incoterm, v_terms, q.currency, q.fx_rate_id)
    returning id, code into v_order, v_code;
  v_pi := 'PI-' || to_char(now(),'YYYY') || '-' || lpad(nextval('seq_pi')::text, 4, '0');
  insert into proforma_invoices(number, order_id, org_id, total_cents, deposit_cents, currency, fx_rate_id)
    values (v_pi, v_order, r.org_id, v_total, v_dep, q.currency, q.fx_rate_id);
  insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
    values (r.org_id, 'proforma_invoice', v_pi, v_order, v_total, q.currency, 'awaiting_payment',
            jsonb_build_object('quote', q.code, 'rfq', r.code, 'title', r.title, 'qty', q.quantity, 'unit_price_cents', q.unit_price_cents,
                               'shipping_cents', q.shipping_cents, 'deposit_pct', v_pct, 'deposit_cents', v_dep, 'incoterm', q.incoterm,
                               'unit', r.unit, 'lead_time_days', q.lead_time_days, 'currency', q.currency));
  perform post_journal('PI ' || v_pi || ' issued', jsonb_build_array(
    jsonb_build_object('account', receivable_account(r.org_id, q.currency), 'debit', v_total, 'credit', 0, 'org', r.org_id),
    jsonb_build_object('account', revenue_account('orders', q.currency), 'debit', 0, 'credit', v_total)
  ), 'pi:' || v_order, 'orders', 'order', v_order);
  insert into order_events(order_id, org_id, kind, title, body) values
    (v_order, r.org_id, 'status', 'Proforma invoice issued', v_pi || ' · deposit ' || v_pct || '% due' || coalesce(' · ' || p_source, ''));
  perform log_status('order', v_order, null, 'deposit_pending', p_source);
  perform emit_event('quote.approved', 'order', v_order, jsonb_build_object('org_id', r.org_id, 'pi', v_pi, 'source', coalesce(p_source,'web')));
  return jsonb_build_object('order_id', v_order, 'order_code', v_code, 'pi_number', v_pi, 'currency', q.currency);
end $$;

-- customer wrappers (same signatures as before)
create or replace function submit_rfq(p_title text, p_quantity int, p_details text, p_product uuid default null,
  p_destination_country text default null, p_destination_city text default null, p_target_price_cents bigint default null,
  p_incoterm text default null, p_idem text default null)
returns uuid language sql security definer set search_path = public as $$
  select core_submit_rfq(my_org_id(), auth.uid(), p_title, p_quantity, p_details, p_product, p_destination_country, p_destination_city,
                         p_target_price_cents, p_incoterm, p_idem, null);
$$;
create or replace function request_service(p_service text, p_details jsonb, p_product uuid default null, p_idem text default null)
returns uuid language sql security definer set search_path = public as $$
  select core_request_service(my_org_id(), auth.uid(), p_service, p_details, p_product, p_idem, null);
$$;
create or replace function approve_quote(p_quote uuid, p_terms_version uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select r.org_id into v_org from quotes q join rfqs r on r.id = q.rfq_id where q.id = p_quote;
  if v_org is null then raise exception 'NOT_FOUND'; end if;
  if v_org not in (select my_org_ids()) then raise exception 'FORBIDDEN'; end if;
  return core_approve_quote(v_org, p_quote, p_terms_version, null);
end $$;

-- API wrappers (service_role only; same signatures as before)
create or replace function api_submit_rfq(p_org uuid, p_title text, p_quantity int, p_details text, p_product uuid default null,
  p_destination_country text default null, p_destination_city text default null, p_target_price_cents bigint default null,
  p_incoterm text default null, p_idem text default null)
returns uuid language sql security definer set search_path = public as $$
  select core_submit_rfq(p_org, null, p_title, p_quantity, p_details, p_product, p_destination_country, p_destination_city,
                         p_target_price_cents, p_incoterm, case when p_idem is null then null else 'api:' || p_idem end, 'via API');
$$;
create or replace function api_request_service(p_org uuid, p_service text, p_details jsonb, p_product uuid default null, p_idem text default null)
returns uuid language sql security definer set search_path = public as $$
  select core_request_service(p_org, null, p_service, p_details, p_product, case when p_idem is null then null else 'api:' || p_idem end, 'via API');
$$;
create or replace function api_approve_quote(p_org uuid, p_quote uuid, p_terms_version uuid default null)
returns jsonb language sql security definer set search_path = public as $$
  select core_approve_quote(p_org, p_quote, p_terms_version, 'via API');
$$;

-- quotes are created in the platform currency at the current approved rate
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
  insert into quotes(code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until,
                     created_by, currency, fx_rate_id)
    values ('QT-' || replace(r.code,'RFQ-','') || '-' || v_n, p_rfq, p_supplier, p_unit_price_cents, p_quantity, p_incoterm, p_lead_days,
            coalesce(p_shipping_cents,0), p_notes, 'sent', now() + make_interval(days => v_validity), auth.uid(),
            current_platform_currency(), current_fx_rate_id())
    returning id into v_id;
  update rfqs set status = 'quoted' where id = p_rfq;
  perform log_status('rfq', p_rfq, r.status::text, 'quoted');
  perform emit_event('quote.sent', 'quote', v_id, jsonb_build_object('org_id', r.org_id, 'rfq_id', p_rfq));
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
  if p_to = 'rejected' and s.paid_via = 'wallet' and s.fee_minor > 0 then
    perform post_journal('Refund · ' || s.code, jsonb_build_array(
      jsonb_build_object('account', revenue_account('service_fees', s.currency), 'debit', s.fee_minor, 'credit', 0),
      jsonb_build_object('account', wallet_account(s.org_id, s.currency), 'debit', 0, 'credit', s.fee_minor, 'org', s.org_id)
    ), 'svc-refund:' || p_id, 'service_fees', 'service_request', p_id);
    update service_requests set status = 'refunded' where id = p_id;
  end if;
  perform log_status('service_request', p_id, s.status::text, p_to::text, p_reason);
  perform emit_event('service_request.updated', 'service_request', p_id, jsonb_build_object('org_id', s.org_id, 'to', p_to));
end $$;

-- documents created on order transitions carry the order currency
create or replace function transition_order(p_order uuid, p_to order_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_inv text;
begin
  select * into o from orders where id = p_order for update;
  if o is null then raise exception 'NOT_FOUND'; end if;
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
    insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
      values (o.org_id, 'commercial_invoice', v_inv, p_order, o.total_cents, o.currency, case when o.paid_cents >= o.total_cents then 'paid' else 'awaiting_payment' end,
              jsonb_build_object('title', o.title, 'qty', o.quantity, 'unit_price_cents', o.unit_price_cents, 'shipping_cents', o.shipping_cents,
                                 'paid_cents', o.paid_cents, 'balance_cents', o.total_cents - o.paid_cents, 'incoterm', o.incoterm, 'currency', o.currency));
  elsif p_to = 'confirmed' then
    insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
      values (o.org_id, 'confirmation', 'CNF-' || replace(o.code,'ORD-',''), p_order, o.total_cents, o.currency, 'issued', jsonb_build_object('title', o.title, 'currency', o.currency));
  end if;
  insert into order_events(order_id, org_id, kind, title, body, created_by)
    values (p_order, o.org_id, 'status', initcap(replace(p_to::text,'_',' ')), p_reason, auth.uid());
  perform log_status('order', p_order, o.status::text, p_to::text, p_reason);
  perform emit_event('order.' || p_to, 'order', p_order, jsonb_build_object('org_id', o.org_id));
end $$;

create or replace function system_transition_order(p_order uuid, p_to order_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_inv text;
begin
  select * into o from orders where id = p_order for update;
  if o is null then raise exception 'NOT_FOUND'; end if;
  if o.status = p_to then return; end if;
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
    insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
      values (o.org_id, 'commercial_invoice', v_inv, p_order, o.total_cents, o.currency, case when o.paid_cents >= o.total_cents then 'paid' else 'awaiting_payment' end,
              jsonb_build_object('title', o.title, 'qty', o.quantity, 'unit_price_cents', o.unit_price_cents, 'shipping_cents', o.shipping_cents,
                                 'paid_cents', o.paid_cents, 'balance_cents', o.total_cents - o.paid_cents, 'incoterm', o.incoterm, 'currency', o.currency));
  elsif p_to = 'confirmed' then
    insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
      values (o.org_id, 'confirmation', 'CNF-' || replace(o.code,'ORD-',''), p_order, o.total_cents, o.currency, 'issued', jsonb_build_object('title', o.title, 'currency', o.currency));
  end if;
  insert into order_events(order_id, org_id, kind, title, body, created_by)
    values (p_order, o.org_id, 'status', initcap(replace(p_to::text,'_',' ')), coalesce(p_reason, 'System'), null);
  perform log_status('order', p_order, o.status::text, p_to::text, coalesce(p_reason, 'system'));
  perform emit_event('order.' || p_to, 'order', p_order, jsonb_build_object('org_id', o.org_id, 'source', 'system'));
end $$;

-- payments are always in the ORDER's currency (an old USD PI is paid in USD even after a switch to CNY)
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
    return (select id from payments where provider_event_id = p_provider_event);
  end if;
  if p_amount <= 0 or o.paid_cents + p_amount > o.total_cents then raise exception 'INVALID_AMOUNT'; end if;
  v_purpose := case when o.paid_cents < o.deposit_cents then 'deposit' else 'balance' end;
  insert into payments(org_id, order_id, purpose, method, amount_cents, currency, reference, provider_event_id, status, matched_by, confirmed_at)
    values (o.org_id, p_order, v_purpose, p_method, p_amount, o.currency, p_reference, p_provider_event, 'confirmed', auth.uid(), now())
    returning id into v_pay;
  if v_from_wallet then
    perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || o.org_id, o.currency)));
    if wallet_balance(o.org_id, o.currency) < p_amount then raise exception 'WALLET_INSUFFICIENT'; end if;
    v_debit_acct := wallet_account(o.org_id, o.currency);
  else
    v_debit_acct := cash_account(o.currency);
  end if;
  perform post_journal('Payment ' || coalesce(p_reference, v_pay::text) || ' · ' || o.code, jsonb_build_array(
    jsonb_build_object('account', v_debit_acct, 'debit', p_amount, 'credit', 0, 'org', case when v_from_wallet then o.org_id::text else '' end),
    jsonb_build_object('account', receivable_account(o.org_id, o.currency), 'debit', 0, 'credit', p_amount, 'org', o.org_id)
  ), 'pay:' || v_pay, 'orders', 'payment', v_pay);
  update orders set paid_cents = paid_cents + p_amount where id = p_order;
  insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
    values (o.org_id, 'receipt', 'RCT-' || upper(substr(v_pay::text,1,8)), p_order, p_amount, o.currency, 'paid',
            jsonb_build_object('method', p_method, 'reference', p_reference, 'purpose', v_purpose, 'currency', o.currency));
  insert into order_events(order_id, org_id, kind, title, body) values (p_order, o.org_id, 'payment', 'Payment received',
    to_char(p_amount/100.0, 'FM999,999,990.00') || ' ' || o.currency || ' · ' || v_purpose);
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

-- top-ups go to the wallet in the platform currency at the time of the request
create or replace function request_topup(p_amount bigint, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid := my_org_id(); v_cur text := current_platform_currency();
begin
  if not setting_bool('wallet_enabled') then raise exception 'WALLET_DISABLED'; end if;
  if v_org is null then raise exception 'NO_ORG'; end if;
  if p_amount < 100 then raise exception 'INVALID_AMOUNT'; end if;
  insert into wallet_topups(org_id, amount_cents, currency, method, reference, status, created_by)
    values (v_org, p_amount, v_cur, p_method, p_reference, 'pending', auth.uid()) returning id into v_id;
  perform emit_event('wallet.topup_requested', 'wallet_topup', v_id, jsonb_build_object('org_id', v_org, 'currency', v_cur));
  return v_id;
end $$;

create or replace function confirm_topup(p_topup uuid, p_provider_event text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not can('wallet','approve') and auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into t from wallet_topups where id = p_topup for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status = 'credited' then return; end if;
  if t.status <> 'pending' then raise exception 'INVALID_TRANSITION'; end if;
  perform post_journal('Wallet top-up ' || coalesce(t.reference,''), jsonb_build_array(
    jsonb_build_object('account', cash_account(t.currency), 'debit', t.amount_cents, 'credit', 0),
    jsonb_build_object('account', wallet_account(t.org_id, t.currency), 'debit', 0, 'credit', t.amount_cents, 'org', t.org_id)
  ), coalesce('topup-evt:' || p_provider_event, 'topup:' || p_topup), null, 'wallet_topup', p_topup);
  update wallet_topups set status = 'credited' where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'credited');
  perform emit_event('wallet.updated', 'wallet_topup', p_topup, jsonb_build_object('org_id', t.org_id, 'currency', t.currency));
end $$;

create or replace function request_finance_approval(p_kind text, p_amount bigint, p_reason text, p_org uuid default null,
  p_order uuid default null, p_supplier uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cur text := coalesce((select currency from orders where id = p_order), current_platform_currency());
begin
  if not (can('finance','create') or can('support','create')) then raise exception 'FORBIDDEN'; end if;
  insert into finance_approvals(kind, org_id, order_id, supplier_id, amount_cents, currency, reason, requested_by)
    values (p_kind, p_org, p_order, p_supplier, p_amount, v_cur, p_reason, auth.uid()) returning id into v_id;
  perform write_audit('finance.request', 'finance_approvals', v_id::text, jsonb_build_object('kind', p_kind, 'amount', p_amount, 'currency', v_cur));
  return v_id;
end $$;

create or replace function decide_finance_approval(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record; v_limit bigint := coalesce((setting('finance_approval_limit_cents'))::text::bigint, 100000); v_j uuid; v_amt_usd bigint;
begin
  if not can('finance','approve') then raise exception 'FORBIDDEN'; end if;
  select * into a from finance_approvals where id = p_id for update;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if a.status <> 'requested' then raise exception 'INVALID_TRANSITION'; end if;
  if a.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE'; end if;
  v_amt_usd := convert_amount(a.amount_cents, a.currency, 'USD');   -- limit is set in USD
  if p_approve and v_amt_usd > v_limit and not is_admin() then raise exception 'OVER_LIMIT_NEEDS_ADMIN'; end if;
  if not p_approve then
    update finance_approvals set status = 'rejected', approved_by = auth.uid(), decided_at = now() where id = p_id;
  else
    if a.kind in ('refund','credit_note','adjustment') and a.org_id is not null then
      v_j := post_journal(initcap(replace(a.kind,'_',' ')) || ' · ' || a.reason, jsonb_build_array(
        jsonb_build_object('account', refunds_account(a.currency), 'debit', a.amount_cents, 'credit', 0),
        jsonb_build_object('account', wallet_account(a.org_id, a.currency), 'debit', 0, 'credit', a.amount_cents, 'org', a.org_id)
      ), 'fa:' || p_id, 'refunds', 'finance_approval', p_id);
      if a.kind = 'credit_note' then
        insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
        values (a.org_id, 'credit_note', 'CN-' || upper(substr(p_id::text,1,8)), a.order_id, a.amount_cents, a.currency, 'issued', jsonb_build_object('reason', a.reason, 'currency', a.currency));
      end if;
    elsif a.kind = 'payout' then
      insert into payouts(supplier_id, amount_cents, currency, status, approval_id) values (a.supplier_id, a.amount_cents, a.currency, 'approved', p_id);
    end if;
    update finance_approvals set status = (case when v_j is not null or a.kind = 'payout' then 'executed' else 'approved' end)::approval_status,
      approved_by = auth.uid(), decided_at = now(), executed_journal_id = v_j where id = p_id;
  end if;
  perform write_audit('finance.decide', 'finance_approvals', p_id::text, jsonb_build_object('approve', p_approve, 'note', p_note));
end $$;

-- ad clicks charge the advertiser wallet in the CAMPAIGN's currency
create or replace function record_ad_click(p_campaign uuid, p_fingerprint text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c record; v_charge bigint;
begin
  select * into c from ad_campaigns where id = p_campaign for update;
  if c is null or c.status <> 'active' or not setting_bool('ads_enabled') then return false; end if;
  if exists(select 1 from ad_clicks where campaign_id = p_campaign and fingerprint = p_fingerprint and created_at > now() - interval '24 hours') then
    insert into ad_clicks(campaign_id, fingerprint, charged_cents, currency, valid) values (p_campaign, p_fingerprint, 0, c.currency, false);
    return false;
  end if;
  v_charge := c.max_cpc_cents;
  if c.spent_today_cents + v_charge > c.daily_budget_cents or c.org_id is null or wallet_balance(c.org_id, c.currency) < v_charge then
    update ad_campaigns set status = 'paused' where id = p_campaign;
    return false;
  end if;
  insert into ad_clicks(campaign_id, fingerprint, charged_cents, currency) values (p_campaign, p_fingerprint, v_charge, c.currency);
  perform wallet_charge(c.org_id, v_charge, 'Ad click · ' || c.name, 'ads',
    'adclick:' || p_campaign || ':' || p_fingerprint || ':' || to_char(now(),'YYYYMMDD'), 'ad_campaign', p_campaign, c.currency);
  update ad_campaigns set spent_today_cents = spent_today_cents + v_charge where id = p_campaign;
  return true;
end $$;

-- ───────────────────────── Admin reporting per currency ─────────────────────────
drop function if exists admin_wallet_balances();
create or replace function admin_wallet_balances()
returns table(org_id uuid, org_name text, country text, kyc_status kyc_status, balance_cents bigint, last_activity timestamptz, currency text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can('wallet','view') or can('finance','view')) then raise exception 'FORBIDDEN'; end if;
  return query
    select o.id, o.name, o.country, o.kyc_status, coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint, max(le.created_at), la.currency::text
    from ledger_accounts la join organizations o on o.id = la.org_id left join ledger_entries le on le.account_id = la.id
    where la.code like 'wallet:%'
    group by o.id, o.name, o.country, o.kyc_status, la.currency
    order by 5 desc;
end $$;

drop function if exists admin_revenue_by_stream(timestamptz, timestamptz);
create or replace function admin_revenue_by_stream(p_from timestamptz default null, p_to timestamptz default null)
returns table(month date, stream text, credit_cents bigint, debit_cents bigint, net_cents bigint, currency text, net_converted_minor bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := current_platform_currency();
begin
  if not (can('finance','view') or can('dashboard','view')) then raise exception 'FORBIDDEN'; end if;
  return query
    select x.m, x.s, x.c, x.d, x.n, x.cur, convert_amount(x.n, x.cur, v_cur)
    from (
      select date_trunc('month', j.created_at)::date m, coalesce(j.stream, split_part(replace(la.code, 'rev:', ''), ':', 1)) s,
             sum(le.credit_cents)::bigint c, sum(le.debit_cents)::bigint d, sum(le.credit_cents - le.debit_cents)::bigint n, la.currency::text cur
      from ledger_entries le join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' join journals j on j.id = le.journal_id
      where (p_from is null or j.created_at >= p_from) and (p_to is null or j.created_at < p_to)
      group by 1, 2, la.currency) x
    order by 1 desc, 5 desc;
end $$;

drop function if exists admin_ledger_check();
create or replace function admin_ledger_check()
returns table(total_debit bigint, total_credit bigint, journals bigint, unbalanced_journals bigint, currency text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can('finance','view') then raise exception 'FORBIDDEN'; end if;
  return query
    select sum(le.debit_cents)::bigint, sum(le.credit_cents)::bigint, count(distinct le.journal_id)::bigint,
           (select count(*) from (select journal_id from ledger_entries x where x.currency = le.currency group by journal_id
                                  having sum(debit_cents) <> sum(credit_cents)) u)::bigint,
           le.currency::text
    from ledger_entries le group by le.currency order by le.currency;
end $$;

drop function if exists admin_geography();
create or replace function admin_geography()
returns table(country text, customers bigint, verified bigint, pending bigint, not_started bigint, rejected bigint, orders bigint, gmv_cents bigint, currency text)
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := current_platform_currency();
begin
  if not can('customers','view') then raise exception 'FORBIDDEN'; end if;
  return query
    with oc as (
      select o.org_id, count(*)::bigint n, sum(convert_amount(o.total_cents, o.currency, v_cur))::bigint gmv
      from orders o where o.status <> 'cancelled' group by o.org_id
    )
    select coalesce(g.country, '??'), count(*)::bigint,
           count(*) filter (where g.kyc_status = 'verified')::bigint,
           count(*) filter (where g.kyc_status in ('submitted','in_review','more_info'))::bigint,
           count(*) filter (where g.kyc_status = 'not_started')::bigint,
           count(*) filter (where g.kyc_status = 'rejected')::bigint,
           coalesce(sum(oc.n), 0)::bigint, coalesce(sum(oc.gmv), 0)::bigint, v_cur
    from organizations g left join oc on oc.org_id = g.id
    where g.archived_at is null group by 1 order by 8 desc, 2 desc;
end $$;

-- ───────────────────────── Currency switch workflow ─────────────────────────
create type currency_switch_status as enum ('draft','pending_approval','scheduled','applied','cancelled');
create table currency_switch_requests (
  id uuid primary key default gen_random_uuid(),
  from_currency char(3) not null,
  to_currency char(3) not null check (to_currency in ('USD','CNY')),
  rate numeric(12,6) not null check (rate > 0),
  fx_rate_id uuid references fx_rates(id),
  wallet_option text not null default 'keep' check (wallet_option in ('keep','convert')),
  effective_at timestamptz not null default now(),
  status currency_switch_status not null default 'pending_approval',
  impact jsonb,
  note text,
  requested_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_currency <> to_currency)
);
alter table currency_switch_requests enable row level security;
create policy csr_read on currency_switch_requests for select to authenticated using (is_admin() or can('finance','view'));

-- Admin sets an approved rate (manual) — used for billing
create or replace function set_fx_rate(p_rate numeric, p_note text default null, p_effective_from timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_rate is null or p_rate <= 0 then raise exception 'INVALID_RATE'; end if;
  insert into fx_rates(rate, source, set_by, note, effective_from) values (p_rate, 'manual', auth.uid(), p_note, coalesce(p_effective_from, now())) returning id into v;
  perform write_audit('fx.set_rate', 'fx_rates', v::text, jsonb_build_object('rate', p_rate));
  return v;
end $$;

create or replace function payment_supports_currency(p_currency text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select config -> 'currencies' ? p_currency from integrations where code = 'payment'), p_currency = 'USD');
$$;

create or replace function currency_switch_impact(p_to text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from text := current_platform_currency();
begin
  if not (is_admin() or can('finance','view')) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'from', v_from, 'to', p_to,
    'open_quotes', (select jsonb_object_agg(currency, n) from (select currency, count(*) n from quotes where status in ('sent','viewed') group by currency) x),
    'open_pis', (select jsonb_object_agg(currency, n) from (select currency, count(*) n from orders where status in ('pi_issued','deposit_pending','balance_pending') group by currency) x),
    'wallets', (select jsonb_object_agg(currency, jsonb_build_object('wallets', n, 'total_minor', t)) from (
                  select currency, count(*) filter (where balance_minor <> 0) n, sum(balance_minor)::bigint t from wallets group by currency) x),
    'active_ad_budgets', (select jsonb_object_agg(currency, jsonb_build_object('campaigns', n, 'daily_budget_minor', t)) from (
                  select currency, count(*) n, sum(daily_budget_cents)::bigint t from ad_campaigns where status in ('active','paused','in_review') group by currency) x),
    'services_without_price', (select coalesce(jsonb_agg(s.code), '[]') from services s where s.active and not exists(
                  select 1 from service_prices sp where sp.service_code = s.code and sp.currency = p_to)),
    'payment_adapter_supports', payment_supports_currency(p_to)
  );
end $$;

create or replace function request_currency_switch(p_to text, p_rate numeric, p_wallet_option text default 'keep',
  p_effective_at timestamptz default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_from text := current_platform_currency();
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_to = v_from then raise exception 'ALREADY_ACTIVE: %', p_to; end if;
  if p_to not in ('USD','CNY') then raise exception 'UNSUPPORTED_CURRENCY'; end if;
  if not payment_supports_currency(p_to) then raise exception 'PAYMENT_ADAPTER_UNSUPPORTED: %', p_to; end if;
  if exists(select 1 from currency_switch_requests where status in ('pending_approval','scheduled')) then raise exception 'SWITCH_ALREADY_PENDING'; end if;
  insert into currency_switch_requests(from_currency, to_currency, rate, wallet_option, effective_at, status, impact, note, requested_by)
    values (v_from, p_to, p_rate, coalesce(p_wallet_option,'keep'), coalesce(p_effective_at, now()), 'pending_approval',
            currency_switch_impact(p_to), p_note, auth.uid())
    returning id into v_id;
  perform write_audit('currency.switch_requested', 'currency_switch_requests', v_id::text,
    jsonb_build_object('from', v_from, 'to', p_to, 'rate', p_rate, 'wallet_option', p_wallet_option));
  return v_id;
end $$;

create or replace function apply_currency_switch(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_fx uuid; w record; v_conv bigint;
begin
  select * into r from currency_switch_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status = 'applied' then return; end if;
  if r.status <> 'scheduled' then raise exception 'INVALID_TRANSITION: %', r.status; end if;
  -- the rate entered in the switch becomes the approved billing rate (always expressed as CNY per USD)
  insert into fx_rates(rate, source, set_by, note) values (r.rate, 'manual', r.requested_by, 'Currency switch ' || r.from_currency || ' → ' || r.to_currency)
    returning id into v_fx;
  update site_settings set value = to_jsonb(r.to_currency::text), updated_at = now() where key = 'platform_currency';
  if r.wallet_option = 'convert' then
    for w in select org_id, balance_minor from wallets where currency = r.from_currency and balance_minor > 0 loop
      v_conv := convert_amount(w.balance_minor, r.from_currency, r.to_currency, v_fx);
      perform post_journal('Currency switch: wallet converted ' || r.from_currency || ' → ' || r.to_currency || ' @ ' || r.rate, jsonb_build_array(
        jsonb_build_object('account', wallet_account(w.org_id, r.from_currency), 'debit', w.balance_minor, 'credit', 0, 'org', w.org_id),
        jsonb_build_object('account', fx_conversion_account(r.from_currency), 'debit', 0, 'credit', w.balance_minor),
        jsonb_build_object('account', fx_conversion_account(r.to_currency), 'debit', v_conv, 'credit', 0),
        jsonb_build_object('account', wallet_account(w.org_id, r.to_currency), 'debit', 0, 'credit', v_conv, 'org', w.org_id)
      ), 'fxswitch:' || p_id || ':' || w.org_id, 'fx_conversion', 'currency_switch', p_id);
    end loop;
  end if;
  update site_settings set value = jsonb_build_object('from', r.from_currency, 'to', r.to_currency, 'rate', r.rate, 'applied_at', now(), 'wallet_option', r.wallet_option)
    where key = 'currency_switch_banner';
  update currency_switch_requests set status = 'applied', applied_at = now(), fx_rate_id = v_fx where id = p_id;
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (coalesce(auth.uid(), r.approved_by), 'currency.switch_applied', 'currency_switch_requests', p_id::text,
            jsonb_build_object('from', r.from_currency, 'to', r.to_currency, 'rate', r.rate, 'wallet_option', r.wallet_option));
  perform emit_event('settings.currency_changed', 'currency_switch', p_id,
    jsonb_build_object('from', r.from_currency, 'to', r.to_currency, 'rate', r.rate, 'fx_rate_id', v_fx, 'wallet_option', r.wallet_option));
end $$;

create or replace function approve_currency_switch(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not can('finance','approve') then raise exception 'FORBIDDEN'; end if;
  select * into r from currency_switch_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending_approval' then raise exception 'INVALID_TRANSITION: %', r.status; end if;
  if r.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE'; end if;
  if not payment_supports_currency(r.to_currency) then raise exception 'PAYMENT_ADAPTER_UNSUPPORTED: %', r.to_currency; end if;
  update currency_switch_requests set status = 'scheduled', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform write_audit('currency.switch_approved', 'currency_switch_requests', p_id::text, null);
  if r.effective_at <= now() then perform apply_currency_switch(p_id); end if;
end $$;

create or replace function cancel_currency_switch(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from currency_switch_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if not (is_admin() or (can('finance','approve') and r.status = 'pending_approval')) then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('draft','pending_approval','scheduled') then raise exception 'INVALID_TRANSITION: %', r.status; end if;
  update currency_switch_requests set status = 'cancelled', cancelled_at = now(), note = coalesce(p_reason, note) where id = p_id;
  perform write_audit('currency.switch_cancelled', 'currency_switch_requests', p_id::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function job_apply_currency_switches() returns int
language plpgsql security definer set search_path = public as $$
declare v uuid; n int := 0;
begin
  for v in select id from currency_switch_requests where status = 'scheduled' and effective_at <= now() order by effective_at loop
    perform apply_currency_switch(v); n := n + 1;
  end loop;
  return n;
end $$;

update integrations set config = config || '{"currencies":["USD","CNY"]}'::jsonb where code = 'payment';   -- test adapter supports both
update integrations set config = config || '{"currencies":["USD","CNY"]}'::jsonb where code = 'email';

do $$ begin
  perform cron.schedule('octopus-currency-switch', '*/5 * * * *', 'select public.job_apply_currency_switches()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ───────────────────────── Grants ─────────────────────────
do $$ declare f text;
begin
  -- internal helpers: service_role only
  foreach f in array array[
    'ledger_account(text,text,text,uuid,text)','wallet_account(uuid,text)','receivable_account(uuid,text)','revenue_account(text,text)',
    'cash_account(text)','fx_conversion_account(text)','refunds_account(text)','post_journal(text,jsonb,text,text,text,uuid)',
    'wallet_charge(uuid,bigint,text,text,text,text,uuid,text)','wallet_balance(uuid,text)',
    'core_submit_rfq(uuid,uuid,text,integer,text,uuid,text,text,bigint,text,text,text)','core_request_service(uuid,uuid,text,jsonb,uuid,text,text)',
    'core_approve_quote(uuid,uuid,uuid,text)','api_submit_rfq(uuid,text,integer,text,uuid,text,text,bigint,text,text)',
    'api_request_service(uuid,text,jsonb,uuid,text)','api_approve_quote(uuid,uuid,uuid)','system_transition_order(uuid,order_status,text)',
    'record_ad_click(uuid,text)','apply_currency_switch(uuid)','job_apply_currency_switches()','set_campaign_currency()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- authenticated RPCs
  foreach f in array array[
    'submit_rfq(text,integer,text,uuid,text,text,bigint,text,text)','request_service(text,jsonb,uuid,text)','approve_quote(uuid,uuid)',
    'send_quote(uuid,uuid,bigint,integer,text,integer,bigint,text)','transition_service_request(uuid,service_request_status,text)',
    'transition_order(uuid,order_status,text)','record_payment(uuid,bigint,text,text,text)','request_topup(bigint,text,text)',
    'confirm_topup(uuid,text)','request_finance_approval(text,bigint,text,uuid,uuid,uuid)','decide_finance_approval(uuid,boolean,text)',
    'my_wallet_balance(text)','admin_wallet_balances()','admin_revenue_by_stream(timestamptz,timestamptz)','admin_ledger_check()','admin_geography()',
    'set_fx_rate(numeric,text,timestamptz)','currency_switch_impact(text)','request_currency_switch(text,numeric,text,timestamptz,text)',
    'approve_currency_switch(uuid)','cancel_currency_switch(uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- public helpers (storefront converts prices for anon visitors)
  foreach f in array array['current_platform_currency()','current_fx_rate_id()','convert_amount(bigint,text,text,uuid)','round_minor(numeric,text)',
                           'service_price_info(text,text)','current_service_price(text,text)','payment_supports_currency(text)','acct_code(text,text)'] loop
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end $$;

