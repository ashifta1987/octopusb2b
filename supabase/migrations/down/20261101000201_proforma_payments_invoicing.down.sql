-- Down for 20261101000201_proforma_payments_invoicing.sql: the report as in 200, no proforma payments / auto invoices.
-- (Tax invoices already issued from proformas keep their numbers; the link column goes away with this down.)
drop function if exists division_report(timestamptz, timestamptz, boolean);
create function division_report(p_from timestamptz default null, p_to timestamptz default null, p_include_test boolean default false)
returns table(line text, division_code text, division_name text, sort_order int, revenue_by_currency jsonb, revenue_converted_minor bigint,
              orders_count int, orders_by_currency jsonb, orders_converted_minor bigint, open_work int, open_detail jsonb,
              pipeline_count int, pipeline_by_currency jsonb, pipeline_converted_minor bigint)
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
  pipe as (   -- proformas issued, not yet invoiced
    select d.division_id as div, coalesce(d.currency, 'USD')::text as cur, count(*)::int as n, sum(coalesce(d.amount_cents, 0))::bigint as v
      from documents d
     where d.doc_type = 'proforma_invoice' and coalesce(d.status, '') not in ('void', 'cancelled')
       and (p_include_test or not d.is_seed) and (p_from is null or d.created_at >= p_from) and (p_to is null or d.created_at < p_to)
       and not (d.order_id is not null and exists (select 1 from documents i where i.order_id = d.order_id and i.doc_type = 'commercial_invoice' and coalesce(i.status, '') not in ('void', 'cancelled')))
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
         coalesce((select sum(convert_amount(p.v, p.cur, v_cur)) from pipe p where p.div = d.id), 0)::bigint
    from divs d
  union all
  select l.ln, null, case l.ln when 'advertising' then 'Advertising' else 'Company-wide (other)' end, case l.ln when 'advertising' then 98 else 99 end,
         coalesce((select jsonb_object_agg(r.cur, r.net) from rev r where r.ln = l.ln), '{}'::jsonb),
         coalesce((select sum(convert_amount(r.net, r.cur, v_cur)) from rev r where r.ln = l.ln), 0)::bigint,
         0, '{}'::jsonb, 0::bigint, 0, '{}'::jsonb,
         case when l.ln = 'company' then coalesce((select sum(p.n) from pipe p where p.div is null), 0)::int else 0 end,
         case when l.ln = 'company' then coalesce((select jsonb_object_agg(p.cur, p.v) from pipe p where p.div is null), '{}'::jsonb) else '{}'::jsonb end,
         case when l.ln = 'company' then coalesce((select sum(convert_amount(p.v, p.cur, v_cur)) from pipe p where p.div is null), 0)::bigint else 0::bigint end
    from (values ('advertising'), ('company')) l(ln), company_wide cw
   where cw.ok
  order by 4;
end $$;
revoke all on function division_report(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function division_report(timestamptz, timestamptz, boolean) to authenticated, service_role;

drop function if exists pay_service_proforma(uuid, bigint, text, text, text);
drop function if exists issue_proforma_tax_invoice(uuid, bigint, text);
drop table if exists document_payments;
drop index if exists documents_one_full_invoice_per_proforma;
drop index if exists documents_from_proforma_idx;
alter table documents drop column if exists from_proforma_id;
alter table documents drop column if exists paid_cents;
delete from site_settings where key = 'invoicing.service_proforma_rule';
