-- Down for 20261101000200_report_revenue_from_invoices.sql: division_report() as in 199 (ledger revenue incl. proformas, no pipeline)
drop function if exists division_report(timestamptz, timestamptz, boolean);
create function division_report(p_from timestamptz default null, p_to timestamptz default null, p_include_test boolean default false)
returns table(line text, division_code text, division_name text, sort_order int, revenue_by_currency jsonb, revenue_converted_minor bigint,
              orders_count int, orders_by_currency jsonb, orders_converted_minor bigint, open_work int, open_detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := current_platform_currency();
begin
  if not (can('finance', 'view') or can('dashboard', 'view')) then raise exception 'FORBIDDEN'; end if;
  return query
  with rev as (   -- revenue lines (credits - debits on revenue accounts) by division / advertising / company-wide
    select case when j.division_id is not null then 'division' when j.report_line = 'advertising' then 'advertising' else 'company' end as ln,
           j.division_id as div, la.currency::text as cur, sum(le.credit_cents - le.debit_cents)::bigint as net
      from ledger_entries le join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' join journals j on j.id = le.journal_id
     where (p_include_test or not j.is_seed) and (p_from is null or j.created_at >= p_from) and (p_to is null or j.created_at < p_to)
     group by 1, 2, 3),
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
         coalesce((select jsonb_object_agg(w.k, w.n) from work w where w.div = d.id), '{}'::jsonb)
    from divs d
  union all
  select l.ln, null, case l.ln when 'advertising' then 'Advertising' else 'Company-wide (other)' end, case l.ln when 'advertising' then 98 else 99 end,
         coalesce((select jsonb_object_agg(r.cur, r.net) from rev r where r.ln = l.ln), '{}'::jsonb),
         coalesce((select sum(convert_amount(r.net, r.cur, v_cur)) from rev r where r.ln = l.ln), 0)::bigint,
         0, '{}'::jsonb, 0::bigint, 0, '{}'::jsonb
    from (values ('advertising'), ('company')) l(ln), company_wide cw
   where cw.ok
  order by 4;
end $$;
revoke all on function division_report(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function division_report(timestamptz, timestamptz, boolean) to authenticated, service_role;
