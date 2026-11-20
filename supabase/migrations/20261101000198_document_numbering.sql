-- Divisions step 5a (19 Nov 2026): document numbering for Shenzhen Octopus Trading Co., Ltd.
--  · Tax / commercial invoices: OCT-[division]-[year]-[000001] — ONE gap-free sequence shared by all six divisions.
--  · Credit notes:              CN-[division]-[year]-[000001]  — own gap-free sequence, always linked to the invoice.
--  · Proforma invoices:         PF-[year]-[000001]              — own sequence (gaps allowed; the PDF says "not a tax invoice").
--  · Every sequence restarts on 1 January, Asia/Shanghai time. Documents already issued keep their numbers.
-- Gap-free: the counter row is incremented inside the SAME transaction that inserts the document. The row lock is held
-- until commit, so concurrent issuers wait their turn; a transaction that rolls back also rolls back its number, and
-- the next issuer gets it. (A Postgres sequence would leave a gap on every rollback.)
-- The functions that issue documents are re-created with only the number expression changed (+ credit-note link, and
-- the issuer is the legal company instead of the old "Hong Kong company" text).
-- Down: supabase/migrations/down/20261101000198_document_numbering.down.sql

create table if not exists document_counters (
  series text not null check (series in ('OCT', 'CN', 'PF')),
  year int not null check (year between 2000 and 2999),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (series, year)
);
alter table document_counters enable row level security;
revoke all on document_counters from public, anon, authenticated;
drop policy if exists document_counters_read on document_counters;
create policy document_counters_read on document_counters for select to authenticated using (can('finance', 'view'));
grant select on document_counters to authenticated;

create or replace function next_document_number(p_kind text, p_division uuid default null, p_at timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare v_series text; v_year int := extract(year from (p_at at time zone 'Asia/Shanghai'))::int; v_code text; v_n bigint;
begin
  v_series := case p_kind when 'invoice' then 'OCT' when 'credit_note' then 'CN' when 'proforma' then 'PF' end;
  if v_series is null then raise exception 'DOCUMENT_KIND_UNKNOWN: %', p_kind; end if;
  if v_series in ('OCT', 'CN') then
    select code into v_code from divisions where id = p_division;
    if v_code is null then raise exception 'DOCUMENT_NEEDS_DIVISION: an invoice or credit note must belong to a division'; end if;
  end if;
  insert into document_counters as c (series, year, last_value) values (v_series, v_year, 1)
  on conflict (series, year) do update set last_value = c.last_value + 1, updated_at = now()
  returning c.last_value into v_n;
  return case v_series when 'PF' then format('PF-%s-%s', v_year, lpad(v_n::text, 6, '0'))
                       else format('%s-%s-%s-%s', v_series, v_code, v_year, lpad(v_n::text, 6, '0')) end;
end $$;
revoke all on function next_document_number(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function next_document_number(text, uuid, timestamptz) to service_role;

-- credit notes always reference the invoice they credit (existing rows are left as they are: NOT VALID)
alter table documents add column if not exists original_document_id uuid references documents(id) on delete restrict;
create index if not exists documents_original_document_idx on documents (original_document_id);
-- documents has column grants since 195: the new (customer-safe) column must be granted explicitly
grant select (original_document_id) on documents to anon, authenticated;
alter table documents drop constraint if exists documents_credit_note_has_invoice;
alter table documents add constraint documents_credit_note_has_invoice check (doc_type <> 'credit_note' or original_document_id is not null) not valid;
-- the new series can never repeat a number
create unique index if not exists documents_series_number_key on documents (number) where number ~ '^(OCT|CN|PF)-';

-- ───────── document-issuing functions (only the number expression changed) ─────────
CREATE OR REPLACE FUNCTION public.transition_order(p_order uuid, p_to order_status, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_inv := next_document_number('invoice', o.division_id);
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
end $function$
;

CREATE OR REPLACE FUNCTION public.system_transition_order(p_order uuid, p_to order_status, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_inv := next_document_number('invoice', o.division_id);
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
end $function$
;

CREATE OR REPLACE FUNCTION public.core_approve_quote(p_org uuid, p_quote uuid, p_terms_version uuid, p_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q record; r record; v_order uuid; v_total bigint; v_dep bigint; v_pct int := coalesce((setting('deposit_pct'))::text::int, 30);
        v_pi text; v_terms uuid; v_code text;
begin
  select * into q from quotes where id = p_quote for update;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into r from rfqs where id = q.rfq_id for update;
  if r.org_id is distinct from p_org then raise exception 'NOT_FOUND'; end if;
  if q.status not in ('sent','viewed') then raise exception 'QUOTE_NOT_APPROVABLE: %', q.status; end if;
  if q.valid_until < now() then raise exception 'QUOTE_EXPIRED'; end if;
  if p_terms_version is not null and not exists(select 1 from terms_versions where id = p_terms_version and status = 'published' and kind = 'general') then
    raise exception 'TERMS_NOT_CURRENT';
  end if;
  v_terms := coalesce(p_terms_version, (select id from terms_versions where status = 'published' and kind = 'general' order by published_at desc limit 1));
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
  v_pi := next_document_number('proforma');
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
end $function$
;

CREATE OR REPLACE FUNCTION public.settle_pool(p_pool uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p pools; pr products; pl pool_pledges; v_price bigint; v_total bigint; v_order uuid; v_code text; v_pi text; v_qty int; v_n int := 0;
        v_po uuid; v_cost bigint; v_due timestamptz;
begin
  if not (can('orders','edit') or auth.role() = 'service_role' or auth.uid() is null) then raise exception 'FORBIDDEN'; end if;
  select * into p from pools where id = p_pool for update;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  if p.status <> 'open' then return jsonb_build_object('ok', true, 'idempotent', true, 'status', p.status); end if;   -- idempotent
  -- unpaid (card) pledges lapse at fill time
  for pl in select * from pool_pledges where pool_id = p_pool and status = 'pending' for update loop
    update pool_pledges set status = 'withdrawn', withdrawn_at = now() where id = pl.id;
    perform pool_log(p_pool, 'lapsed', 'Unpaid pledge lapsed', null, -pl.qty);
  end loop;
  select coalesce(sum(qty),0) into v_qty from pool_pledges where pool_id = p_pool and status = 'paid';
  if v_qty < p.target_qty then
    update pools set filled_qty = v_qty where id = p_pool;
    raise exception 'POOL_NOT_FILLED: % of %', v_qty, p.target_qty;
  end if;
  select * into pr from products where id = p.product_id;
  v_price := pool_unit_price(p.product_id, v_qty, p.currency, p.fx_rate_id);       -- everyone pays the final tier price
  v_due := now() + make_interval(hours => pool_setting_int('pool_balance_hours', 48));
  for pl in select * from pool_pledges where pool_id = p_pool and status = 'paid' order by joined_at for update loop
    v_total := v_price * pl.qty;
    insert into orders(org_id, supplier_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents,
                       paid_cents, incoterm, terms_version_id, currency, fx_rate_id, pool_id, pool_pledge_id)
      values (pl.org_id, p.supplier_id, 'balance_pending', 'Group buy ' || p.code || ' · ' || pr.title, pl.qty, v_price, 0, v_total, p.deposit_pct,
              least(pl.deposit_minor, v_total), least(pl.deposit_minor, v_total), pr.incoterm, pl.terms_version_id, p.currency, p.fx_rate_id, p_pool, pl.id)
      returning id, code into v_order, v_code;
    v_pi := next_document_number('proforma');
    insert into proforma_invoices(number, order_id, org_id, total_cents, deposit_cents, currency, fx_rate_id, pool_id)
      values (v_pi, v_order, pl.org_id, v_total, least(pl.deposit_minor, v_total), p.currency, p.fx_rate_id, p_pool);
    insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
      values (pl.org_id, 'proforma_invoice', v_pi, v_order, v_total, p.currency, 'awaiting_payment',
              jsonb_build_object('pool', p.code, 'title', pr.title, 'qty', pl.qty, 'unit_price_cents', v_price, 'unit', pr.unit,
                                 'deposit_cents', least(pl.deposit_minor, v_total), 'balance_cents', v_total - least(pl.deposit_minor, v_total),
                                 'balance_due_at', v_due, 'currency', p.currency, 'shipping', 'Freight charged per buyer at balance time'));
    -- PI: receivable for the full value; then the escrowed deposit is applied to it
    perform post_journal('PI ' || v_pi || ' issued · ' || p.code, jsonb_build_array(
      jsonb_build_object('account', receivable_account(pl.org_id, p.currency), 'debit', v_total, 'credit', 0, 'org', pl.org_id),
      jsonb_build_object('account', revenue_account('orders', p.currency), 'debit', 0, 'credit', v_total)
    ), 'poolpi:' || pl.id, 'orders', 'order', v_order);
    if least(pl.deposit_minor, v_total) > 0 then
      perform post_journal('Group-buy deposit applied · ' || v_pi, jsonb_build_array(
        jsonb_build_object('account', escrow_account(p.currency), 'debit', least(pl.deposit_minor, v_total), 'credit', 0),
        jsonb_build_object('account', receivable_account(pl.org_id, p.currency), 'debit', 0, 'credit', least(pl.deposit_minor, v_total), 'org', pl.org_id)
      ), 'pooldepapply:' || pl.id, 'pools', 'order', v_order);
      -- deposit larger than the final value (price dropped a lot): refund the excess
      if pl.deposit_minor > v_total then
        perform post_journal('Group-buy deposit excess refunded · ' || v_pi, jsonb_build_array(
          jsonb_build_object('account', escrow_account(p.currency), 'debit', pl.deposit_minor - v_total, 'credit', 0),
          jsonb_build_object('account', wallet_account(pl.org_id, p.currency), 'debit', 0, 'credit', pl.deposit_minor - v_total, 'org', pl.org_id)
        ), 'pooldepexcess:' || pl.id, 'pools', 'order', v_order);
      end if;
    end if;
    update pool_pledges set balance_minor = v_total - least(pl.deposit_minor, v_total), order_id = v_order where id = pl.id;
    insert into order_events(order_id, org_id, kind, title, body) values (v_order, pl.org_id, 'status', 'Group buy filled',
      p.code || ' · PI ' || v_pi || ' · balance due by ' || to_char(v_due at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
    perform log_status('order', v_order, null, 'balance_pending', 'pool ' || p.code);
    perform emit_event('pi.created', 'order', v_order, jsonb_build_object('org_id', pl.org_id, 'pi', v_pi, 'pool', p.code));
    v_n := v_n + 1;
  end loop;
  -- one aggregate purchase order to the supplier — no customer identities
  select supplier_cost_cents into v_cost from product_costs where product_id = p.product_id;
  insert into documents(org_id, supplier_id, doc_type, number, amount_cents, currency, status, data)
    values (null, p.supplier_id, 'purchase_order', 'PO-' || p.code, case when v_cost is not null then v_cost * v_qty end, 'USD', 'awaiting_balance',
            jsonb_build_object('pool', p.code, 'product', pr.title, 'aggregate_qty', v_qty, 'unit', pr.unit, 'buyers', v_n,
                               'note', 'Confirmed after balance payments; ship to Octopus consolidation for split shipments'))
    returning id into v_po;
  update pools set status = 'locked', filled_qty = v_qty, final_price_minor = v_price, pool_price_minor = v_price, filled_at = now(),
                   balance_due_at = v_due, settled_at = now(), po_document_id = v_po where id = p_pool;
  perform pool_log(p_pool, 'filled', 'Pool filled', v_n || ' buyers · ' || v_qty || ' ' || pr.unit || ' · balance due in ' || pool_setting_int('pool_balance_hours', 48) || ' h', v_qty);
  perform log_status('pool', p_pool, 'open', 'locked', 'filled');
  perform emit_event('pool.filled', 'pool', p_pool, jsonb_build_object('qty', v_qty, 'buyers', v_n, 'price_minor', v_price, 'currency', p.currency));
  perform emit_event('po.created', 'pool', p_pool, jsonb_build_object('document_id', v_po, 'qty', v_qty));
  return jsonb_build_object('ok', true, 'orders', v_n, 'qty', v_qty, 'unit_price_minor', v_price, 'po_document_id', v_po);
end $function$
;

CREATE OR REPLACE FUNCTION public.issue_service_proforma(p_org uuid, p_service text, p_ref_type text, p_ref text, p_title text, p_lines jsonb, p_currency text DEFAULT 'USD'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_doc uuid; v_total bigint; v_no text; l jsonb;
begin
  if not (auth.role() = 'service_role' or can('finance', 'create') or is_my_customer(p_org)) then raise exception 'FORBIDDEN'; end if;
  if p_service not in ('sourcing', 'dropship', 'warehouse', 'brand') then raise exception 'BAD_SERVICE'; end if;
  select coalesce(sum((x ->> 'amount_cents')::bigint), 0) into v_total from jsonb_array_elements(p_lines) x;
  if v_total <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_no := next_document_number('proforma');
  insert into documents(org_id, doc_type, number, amount_cents, currency, status, data)
  values (p_org, 'proforma_invoice', v_no, v_total, p_currency, 'awaiting_payment',
          jsonb_build_object('service', p_service, 'ref_type', p_ref_type, 'ref', p_ref, 'title', p_title, 'issuer', (select legal_name from company_profile where id = 1)))
  returning id into v_doc;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into invoice_lines(document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    values (v_doc, p_service, l ->> 'description', coalesce((l ->> 'qty')::numeric, 1), coalesce((l ->> 'unit_cents')::bigint, (l ->> 'amount_cents')::bigint), (l ->> 'amount_cents')::bigint, p_ref_type, p_ref);
  end loop;
  perform post_document_receivable(v_doc);
  perform audit('invoice.issue', p_org, p_service, 'document', v_doc::text, null, jsonb_build_object('number', v_no, 'amount_cents', v_total, 'ref', p_ref));
  return v_doc;
end $function$
;

CREATE OR REPLACE FUNCTION public.confirm_bank_transfer(p_topup uuid, p_amount_received_cents bigint, p_bank_ref text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t wallet_topups; v_doc uuid; v_no text;
begin
  perform require_step_up();
  if not can('wallet', 'approve') then raise exception 'FORBIDDEN'; end if;
  if p_amount_received_cents is null or p_amount_received_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(trim(p_bank_ref), '') = '' then raise exception 'BANK_REF_REQUIRED'; end if;
  select * into t from wallet_topups where id = p_topup for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status = 'credited' then return t.receipt_id; end if;
  if t.status <> 'pending' then raise exception 'INVALID_TRANSITION'; end if;
  if p_amount_received_cents <> t.amount_cents and coalesce(trim(p_note), '') = '' then raise exception 'DIFFERENCE_REASON_REQUIRED'; end if;
  perform post_journal('Bank transfer ' || coalesce(t.reference, '') || ' · ' || trim(p_bank_ref), jsonb_build_array(
    jsonb_build_object('account', cash_account(t.currency), 'debit', p_amount_received_cents, 'credit', 0),
    jsonb_build_object('account', wallet_account(t.org_id, t.currency), 'debit', 0, 'credit', p_amount_received_cents, 'org', t.org_id)
  ), 'topup:' || p_topup, 'topup', 'wallet_topup', p_topup);
  v_no := 'RCT-W-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_invoice')::text, 5, '0');
  insert into documents(org_id, doc_type, number, amount_cents, currency, status, data)
  values (t.org_id, 'receipt', v_no, p_amount_received_cents, t.currency, 'paid',
          jsonb_build_object('kind', 'wallet_topup', 'service', 'wallet', 'ref', t.reference, 'topup_id', p_topup, 'bank_ref', trim(p_bank_ref),
                             'claimed_cents', t.amount_cents, 'difference_reason', nullif(trim(coalesce(p_note, '')), ''), 'issuer', (select legal_name from company_profile where id = 1)))
  returning id into v_doc;
  update wallet_topups set status = 'credited', amount_received_cents = p_amount_received_cents, bank_ref = trim(p_bank_ref),
         received_note = nullif(trim(coalesce(p_note, '')), ''), confirmed_by = auth.uid(), confirmed_at = now(), receipt_id = v_doc where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'credited');
  perform audit('wallet.transfer_confirmed', t.org_id, 'wallet', 'wallet_topup', p_topup::text, jsonb_build_object('status', 'pending', 'claimed_cents', t.amount_cents),
                jsonb_build_object('status', 'credited', 'received_cents', p_amount_received_cents, 'bank_ref', trim(p_bank_ref), 'difference_reason', p_note, 'receipt', v_no));
  perform emit_event('wallet.updated', 'wallet_topup', p_topup, jsonb_build_object('org_id', t.org_id, 'currency', t.currency));
  return v_doc;
end $function$
;

CREATE OR REPLACE FUNCTION public.decide_finance_approval(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; v_inv record; v_limit bigint := coalesce((setting('finance_approval_limit_cents'))::text::bigint, 100000); v_j uuid; v_amt_usd bigint;
begin
  perform require_step_up();
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
        -- a credit note always credits an issued tax invoice (the order's latest commercial invoice)
        select id, number, division_id into v_inv from documents
         where order_id = a.order_id and doc_type = 'commercial_invoice' and status <> 'void' order by created_at desc limit 1;
        if v_inv.id is null then raise exception 'CREDIT_NOTE_NEEDS_INVOICE: a credit note must reference an issued invoice of this order'; end if;
        insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data, original_document_id)
        values (a.org_id, 'credit_note', next_document_number('credit_note', v_inv.division_id), a.order_id, a.amount_cents, a.currency, 'issued',
                jsonb_build_object('reason', a.reason, 'currency', a.currency, 'original_invoice', v_inv.number), v_inv.id);
      end if;
    elsif a.kind = 'payout' then
      insert into payouts(supplier_id, amount_cents, currency, status, approval_id) values (a.supplier_id, a.amount_cents, a.currency, 'approved', p_id);
    end if;
    update finance_approvals set status = (case when v_j is not null or a.kind = 'payout' then 'executed' else 'approved' end)::approval_status,
      approved_by = auth.uid(), decided_at = now(), executed_journal_id = v_j where id = p_id;
  end if;
  perform write_audit('finance.decide', 'finance_approvals', p_id::text, jsonb_build_object('approve', p_approve, 'note', p_note));
end $function$
;
