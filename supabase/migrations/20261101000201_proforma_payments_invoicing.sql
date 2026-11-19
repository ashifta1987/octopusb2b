-- Divisions step 5d (20 Nov 2026): a service proforma that is FULLY paid gets its tax invoice automatically.
--  · pay_service_proforma(document, amount, method, reference, idempotency key): wallet payments (customer, or staff
--    with wallet:approve) and confirmed bank transfers (finance:approve, fresh 2FA). Posts the payment to the ledger
--    (wallet or bank → the customer's receivable) and records it in document_payments.
--  · When the proforma is fully paid: an OCT-[division]-[year]-[seq] tax invoice with the same lines, amounts and
--    currency, linked to the proforma (from_proforma_id); the proforma is marked "invoiced". Revenue counts from that
--    tax invoice and the proforma leaves Pipeline (report: migration 200 rules + deposits, below).
--  · Idempotent: every payment has an idempotency key (unique). A repeated request, webhook or double click with the
--    same key returns the first result; a new payment on an already paid proforma is refused; at most one full tax
--    invoice per proforma (unique index).
--  · Part payments / deposits: no tax invoice yet; the report shows them as "Customer deposits" until fully paid.
--    The rule is ONE setting, invoicing.service_proforma_rule:
--      "on_full_payment" (default) — one tax invoice when fully paid
--      "per_payment"               — one tax invoice for every payment (what an accountant may prefer)
-- Down: supabase/migrations/down/20261101000201_proforma_payments_invoicing.down.sql

insert into site_settings(key, value, description, is_public) values
  ('invoicing.service_proforma_rule', '"on_full_payment"',
   'When a service proforma gets its tax invoice: "on_full_payment" = one tax invoice when it is fully paid (part payments are customer deposits); "per_payment" = one tax invoice for every payment.', false)
on conflict (key) do nothing;

alter table documents add column if not exists paid_cents bigint not null default 0 check (paid_cents >= 0);
alter table documents add column if not exists from_proforma_id uuid references documents(id) on delete restrict;
create index if not exists documents_from_proforma_idx on documents (from_proforma_id);
create unique index if not exists documents_one_full_invoice_per_proforma on documents (from_proforma_id)
  where doc_type = 'commercial_invoice' and data ->> 'invoice_kind' = 'full';
-- documents has column grants since 195: new customer-safe columns are granted explicitly
grant select (paid_cents, from_proforma_id) on documents to anon, authenticated;

create table if not exists document_payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete restrict,
  org_id uuid not null references organizations(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null,
  method text not null check (method in ('wallet', 'bank_transfer')),
  reference text,
  idempotency_key text not null unique,
  journal_id uuid references journals(id) on delete restrict,
  invoice_id uuid references documents(id) on delete restrict,     -- the tax invoice covering this payment; null = customer deposit
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists document_payments_document_idx on document_payments (document_id);
create index if not exists document_payments_invoice_idx on document_payments (invoice_id);
alter table document_payments enable row level security;
revoke all on document_payments from public, anon, authenticated;
-- a payment is visible to whoever may see its document (customers their own, staff of the document's division)
drop policy if exists document_payments_read on document_payments;
create policy document_payments_read on document_payments for select to authenticated
  using (exists (select 1 from documents d where d.id = document_payments.document_id));
grant select (id, document_id, org_id, amount_cents, currency, method, reference, journal_id, invoice_id, created_at) on document_payments to authenticated;

-- the tax invoice for a (fully or partly) paid service proforma
create or replace function issue_proforma_tax_invoice(p_proforma uuid, p_amount bigint, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d documents; v_inv uuid;
begin
  select * into d from documents where id = p_proforma;
  if d.division_id is null then raise exception 'DOCUMENT_NEEDS_DIVISION: the proforma has no division'; end if;
  insert into documents(org_id, doc_type, number, amount_cents, currency, status, data, division_id, from_proforma_id, paid_cents, is_seed)
  values (d.org_id, 'commercial_invoice', next_document_number('invoice', d.division_id), p_amount, d.currency, 'paid',
          jsonb_build_object('title', coalesce(d.data ->> 'title', 'Services'), 'service', d.data ->> 'service', 'ref_type', d.data ->> 'ref_type', 'ref', d.data ->> 'ref',
                             'from_proforma', d.number, 'invoice_kind', p_kind, 'currency', d.currency, 'issuer', (select legal_name from company_profile where id = 1)),
          d.division_id, d.id, p_amount, d.is_seed)
  returning id into v_inv;
  if p_kind = 'full' then
    insert into invoice_lines(document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    select v_inv, l.service, l.description, l.qty, l.unit_cents, l.amount_cents, l.ref_type, l.ref_id from invoice_lines l where l.document_id = d.id order by l.created_at;
    if not found then
      insert into invoice_lines(document_id, service, description, qty, unit_cents, amount_cents)
      values (v_inv, d.data ->> 'service', coalesce(d.data ->> 'title', 'Services'), 1, p_amount, p_amount);
    end if;
  else
    insert into invoice_lines(document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    values (v_inv, d.data ->> 'service', 'Payment towards proforma ' || d.number || coalesce(' · ' || (d.data ->> 'title'), ''), 1, p_amount, p_amount, 'document', d.id::text);
  end if;
  perform emit_event('invoice.issued', 'document', v_inv, jsonb_build_object('org_id', d.org_id, 'from_proforma', d.number));
  return v_inv;
end $$;
revoke all on function issue_proforma_tax_invoice(uuid, bigint, text) from public, anon, authenticated;
grant execute on function issue_proforma_tax_invoice(uuid, bigint, text) to service_role;

create or replace function pay_service_proforma(p_document uuid, p_amount bigint, p_method text, p_reference text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d documents; v_key text; e document_payments; v_rule text; v_pay uuid; v_j uuid; v_inv uuid; v_full boolean; v_debit uuid;
        v_service_role boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role';
begin
  if p_method not in ('wallet', 'bank_transfer') then raise exception 'PAYMENT_METHOD_UNKNOWN: %', p_method; end if;
  v_key := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''),
                    case when p_method = 'bank_transfer' and nullif(btrim(coalesce(p_reference, '')), '') is not null then 'bank:' || upper(btrim(p_reference)) end);
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED: send one key per payment (a repeated request with the same key is not charged twice)'; end if;
  -- the same payment again (double click, retried request, repeated webhook): return the first result
  select * into e from document_payments where idempotency_key = v_key;
  if found then return jsonb_build_object('payment_id', e.id, 'invoice_id', e.invoice_id, 'repeated', true); end if;

  select * into d from documents where id = p_document for update;
  if d.id is null or d.doc_type <> 'proforma_invoice' or d.order_id is not null then raise exception 'NOT_A_SERVICE_PROFORMA'; end if;
  -- a concurrent request with the same key may have committed while this one waited for the lock
  select * into e from document_payments where idempotency_key = v_key;
  if found then return jsonb_build_object('payment_id', e.id, 'invoice_id', e.invoice_id, 'repeated', true); end if;

  if p_method = 'wallet' then
    if not (v_service_role or d.org_id in (select my_org_ids()) or can('wallet', 'approve')) then raise exception 'FORBIDDEN'; end if;
    if not setting_bool('wallet_enabled') then raise exception 'WALLET_DISABLED'; end if;
  else
    if not (v_service_role or can('finance', 'approve')) then raise exception 'FORBIDDEN'; end if;
    perform require_step_up();
  end if;
  if coalesce(d.status, '') in ('invoiced', 'paid') then raise exception 'PROFORMA_ALREADY_PAID: % is already paid', d.number; end if;
  if coalesce(d.status, '') in ('void', 'cancelled') then raise exception 'PROFORMA_CANCELLED'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > coalesce(d.amount_cents, 0) - d.paid_cents then
    raise exception 'INVALID_AMOUNT: % is more than the % still to pay', p_amount, coalesce(d.amount_cents, 0) - d.paid_cents;
  end if;

  if p_method = 'wallet' then
    perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || d.org_id, d.currency)));
    if wallet_available(d.org_id, d.currency) < p_amount then raise exception 'WALLET_INSUFFICIENT'; end if;
    v_debit := wallet_account(d.org_id, d.currency);
  else
    v_debit := cash_account(d.currency);
  end if;
  insert into document_payments(document_id, org_id, amount_cents, currency, method, reference, idempotency_key, created_by)
  values (d.id, d.org_id, p_amount, d.currency, p_method, nullif(btrim(coalesce(p_reference, '')), ''), v_key, auth.uid())
  returning id into v_pay;
  v_j := post_journal('Payment ' || coalesce(nullif(btrim(coalesce(p_reference, '')), ''), v_key) || ' · ' || d.number, jsonb_build_array(
           jsonb_build_object('account', v_debit, 'debit', p_amount, 'credit', 0, 'org', case when p_method = 'wallet' then d.org_id::text else '' end),
           jsonb_build_object('account', receivable_account(d.org_id, d.currency), 'debit', 0, 'credit', p_amount, 'org', d.org_id)
         ), 'docpay:' || v_pay, coalesce(nullif(d.data ->> 'service', ''), 'service_fees'), 'document', d.id);
  update document_payments set journal_id = v_j where id = v_pay;
  update documents set paid_cents = paid_cents + p_amount where id = d.id;
  v_full := d.paid_cents + p_amount >= coalesce(d.amount_cents, 0);

  v_rule := coalesce(setting('invoicing.service_proforma_rule') #>> '{}', 'on_full_payment');
  if v_rule = 'per_payment' then
    v_inv := issue_proforma_tax_invoice(d.id, p_amount, 'payment');
    update document_payments set invoice_id = v_inv where id = v_pay;
  elsif v_full then
    v_inv := issue_proforma_tax_invoice(d.id, coalesce(d.amount_cents, 0), 'full');
    update document_payments set invoice_id = v_inv where document_id = d.id and invoice_id is null;
  end if;
  update documents set status = case when v_full then 'invoiced' else 'part_paid' end where id = d.id;
  perform write_audit('proforma.payment', 'documents', d.id::text,
    jsonb_build_object('number', d.number, 'amount_cents', p_amount, 'method', p_method, 'fully_paid', v_full, 'invoice_id', v_inv, 'rule', v_rule));
  perform emit_event('payment.confirmed', 'document', d.id, jsonb_build_object('org_id', d.org_id, 'document', d.number, 'fully_paid', v_full));
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', v_inv, 'fully_paid', v_full, 'repeated', false);
end $$;
revoke all on function pay_service_proforma(uuid, bigint, text, text, text) from public, anon;
grant execute on function pay_service_proforma(uuid, bigint, text, text, text) to authenticated, service_role;

-- ───────── report: proformas leave Pipeline when invoiced; part payments are Customer deposits ─────────
drop function if exists division_report(timestamptz, timestamptz, boolean);
create function division_report(p_from timestamptz default null, p_to timestamptz default null, p_include_test boolean default false)
returns table(line text, division_code text, division_name text, sort_order int, revenue_by_currency jsonb, revenue_converted_minor bigint,
              orders_count int, orders_by_currency jsonb, orders_converted_minor bigint, open_work int, open_detail jsonb,
              pipeline_count int, pipeline_by_currency jsonb, pipeline_converted_minor bigint,
              deposits_by_currency jsonb, deposits_converted_minor bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := current_platform_currency();
begin
  if not (can('finance', 'view') or can('dashboard', 'view')) then raise exception 'FORBIDDEN'; end if;
  return query
  with rev_raw as (
    -- ledger revenue that does not come from issuing a proforma
    select case when j.division_id is not null then 'division' when j.report_line = 'advertising' then 'advertising' else 'company' end as ln,
           j.division_id as div, la.currency::text as cur, (le.credit_cents - le.debit_cents)::bigint as amt
      from ledger_entries le join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' join journals j on j.id = le.journal_id
     where (p_include_test or not j.is_seed) and (p_from is null or j.created_at >= p_from) and (p_to is null or j.created_at < p_to)
       and coalesce(j.idempotency_key, '') !~ '^(pi|poolpi|doc-ar):'
       and not (j.ref_type = 'document' and exists (select 1 from documents x where x.id = j.ref_id and x.doc_type = 'proforma_invoice'))
    union all
    -- tax invoices issued (+) and credit notes issued (−)
    select case when d.division_id is not null then 'division' else 'company' end, d.division_id, coalesce(d.currency, 'USD')::text,
           (case d.doc_type when 'credit_note' then -1 else 1 end * coalesce(d.amount_cents, 0))::bigint
      from documents d
     where d.doc_type in ('commercial_invoice', 'credit_note') and coalesce(d.status, '') not in ('void', 'cancelled')
       and (p_include_test or not d.is_seed) and (p_from is null or d.created_at >= p_from) and (p_to is null or d.created_at < p_to)),
  rev as (select r.ln, r.div, r.cur, sum(r.amt)::bigint as net from rev_raw r group by 1, 2, 3),
  pipe as (   -- proformas issued, not yet invoiced: what is still to be paid (part payments are deposits, below)
    select d.division_id as div, coalesce(d.currency, 'USD')::text as cur, count(*)::int as n, sum(coalesce(d.amount_cents, 0) - coalesce(d.paid_cents, 0))::bigint as v
      from documents d
     where d.doc_type = 'proforma_invoice' and coalesce(d.status, '') not in ('void', 'cancelled', 'invoiced')
       and (p_include_test or not d.is_seed) and (p_from is null or d.created_at >= p_from) and (p_to is null or d.created_at < p_to)
       and not (d.order_id is not null and exists (select 1 from documents i where i.order_id = d.order_id and i.doc_type = 'commercial_invoice' and coalesce(i.status, '') not in ('void', 'cancelled')))
     group by 1, 2),
  dep as (    -- customer deposits: payments on proformas that no tax invoice covers yet (rule: invoicing.service_proforma_rule)
    select d.division_id as div, p.currency::text as cur, sum(p.amount_cents)::bigint as v
      from document_payments p join documents d on d.id = p.document_id
     where p.invoice_id is null and (p_include_test or not d.is_seed) and (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to)
     group by 1, 2),
  ord as (
    select o.division_id as div, o.currency::text as cur, count(*)::int as n, sum(o.total_cents)::bigint as v
      from orders o
     where o.status <> 'cancelled' and (p_include_test or not o.is_seed) and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at < p_to)
     group by 1, 2),
  work as (   -- open work right now (not limited to the period)
    select division_id as div, 'rfqs' as k, count(*)::int as n from rfqs where status in ('submitted', 'assigned', 'quoting') and (p_include_test or not is_seed) group by 1
    union all select division_id, 'service_requests', count(*)::int from service_requests where status in ('requested', 'paid', 'accepted', 'in_progress', 'report_ready') and (p_include_test or not is_seed) group by 1
    union all select division_id, 'orders', count(*)::int from orders where status not in ('delivered', 'closed', 'cancelled') and (p_include_test or not is_seed) group by 1
    union all select division_id, 'brand_projects', count(*)::int from brand_projects b where status <> 'closed' and (p_include_test or not exists (select 1 from organizations g where g.id = b.org_id and g.is_seed)) group by 1
    union all select division_id, 'pools', count(*)::int from pools where status in ('open', 'locked', 'confirmed', 'shipped') and (p_include_test or not is_seed) group by 1
    union all select division_id, 'turnkey_leads', count(*)::int from turnkey_leads where status in ('new', 'contacted', 'quoted') and (p_include_test or not is_seed) group by 1
    union all select division_id, 'shipments', count(*)::int from shipments where status not in ('delivered', 'returned') and (p_include_test or not is_seed) group by 1),
  divs as (select d.id, d.code, d.name, d.sort_order from divisions d where in_division(d.id)),
  company_wide as (select in_division(null) as ok)
  select 'division'::text, d.code, d.name, d.sort_order,
         coalesce((select jsonb_object_agg(r.cur, r.net) from rev r where r.ln = 'division' and r.div = d.id), '{}'::jsonb),
         coalesce((select sum(convert_amount(r.net, r.cur, v_cur)) from rev r where r.ln = 'division' and r.div = d.id), 0)::bigint,
         coalesce((select sum(o.n) from ord o where o.div = d.id), 0)::int,
         coalesce((select jsonb_object_agg(o.cur, o.v) from ord o where o.div = d.id), '{}'::jsonb),
         coalesce((select sum(convert_amount(o.v, o.cur, v_cur)) from ord o where o.div = d.id), 0)::bigint,
         coalesce((select sum(w.n) from work w where w.div = d.id), 0)::int,
         coalesce((select jsonb_object_agg(w.k, w.n) from work w where w.div = d.id), '{}'::jsonb),
         coalesce((select sum(p.n) from pipe p where p.div = d.id), 0)::int,
         coalesce((select jsonb_object_agg(p.cur, p.v) from pipe p where p.div = d.id), '{}'::jsonb),
         coalesce((select sum(convert_amount(p.v, p.cur, v_cur)) from pipe p where p.div = d.id), 0)::bigint,
         coalesce((select jsonb_object_agg(x.cur, x.v) from dep x where x.div = d.id), '{}'::jsonb),
         coalesce((select sum(convert_amount(x.v, x.cur, v_cur)) from dep x where x.div = d.id), 0)::bigint
    from divs d
  union all
  select l.ln, null, case l.ln when 'advertising' then 'Advertising' else 'Company-wide (other)' end, case l.ln when 'advertising' then 98 else 99 end,
         coalesce((select jsonb_object_agg(r.cur, r.net) from rev r where r.ln = l.ln), '{}'::jsonb),
         coalesce((select sum(convert_amount(r.net, r.cur, v_cur)) from rev r where r.ln = l.ln), 0)::bigint,
         0, '{}'::jsonb, 0::bigint, 0, '{}'::jsonb,
         case when l.ln = 'company' then coalesce((select sum(p.n) from pipe p where p.div is null), 0)::int else 0 end,
         case when l.ln = 'company' then coalesce((select jsonb_object_agg(p.cur, p.v) from pipe p where p.div is null), '{}'::jsonb) else '{}'::jsonb end,
         case when l.ln = 'company' then coalesce((select sum(convert_amount(p.v, p.cur, v_cur)) from pipe p where p.div is null), 0)::bigint else 0::bigint end,
         case when l.ln = 'company' then coalesce((select jsonb_object_agg(x.cur, x.v) from dep x where x.div is null), '{}'::jsonb) else '{}'::jsonb end,
         case when l.ln = 'company' then coalesce((select sum(convert_amount(x.v, x.cur, v_cur)) from dep x where x.div is null), 0)::bigint else 0::bigint end
    from (values ('advertising'), ('company')) l(ln), company_wide cw
   where cw.ok
  order by 4;
end $$;
revoke all on function division_report(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function division_report(timestamptz, timestamptz, boolean) to authenticated, service_role;
