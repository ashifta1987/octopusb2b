-- 20261101000238_t7_turnkey_reports_alerts_settings.down.sql   (renumber at install)
-- Reverses 20261101000238_t7_turnkey_reports_alerts_settings.sql (empty up → down schema diff of the public schema):
--  · division_report comes back exactly as staging has it before T7 (pg_get_functiondef, 26 Nov 2026; CREATE OR REPLACE
--    keeps its grants);
--  · the T7 alert triggers, their functions, the report / dashboard / settings functions are removed.
-- Data: the T7 settings rows (turnkey.passport_retention_days, turnkey.am_waiver_threshold_cents) are removed, like T4's
-- down removes turnkey.deposit_pct. Notifications already sent stay (they are messages people may have read), and so does
-- a changed extra traveller price on tk_services (T6 data; the audit log has the old value).

drop trigger if exists trg_tk_t7_alert_enquiry on public.tk_client_projects;
drop trigger if exists trg_tk_t7_alert_fee_pending on public.tk_project_fees;
drop trigger if exists trg_tk_t7_alert_fee_pending on public.tk_inspection_fees;
drop trigger if exists trg_tk_t7_alert_fee_pending on public.tk_trip_fees;
drop trigger if exists trg_tk_t7_proforma_issued on public.documents;
drop trigger if exists trg_tk_t7_proforma_paid on public.documents;
drop trigger if exists trg_tk_t7_alert_inspection on public.tk_inspections;
drop trigger if exists trg_tk_t7_alert_shipment_event on public.tk_shipment_events;
drop trigger if exists trg_tk_t7_alert_handover_ready on public.tk_handover_items;

drop function if exists public.tk_purge_trip_passports_by_setting();
drop function if exists public.tk_set_am_waiver_threshold(bigint);
drop function if exists public.tk_set_passport_retention_days(integer);
drop function if exists public.tk_set_extra_traveller_price(bigint);
drop function if exists public.tk_settings();
drop function if exists public.tk_am_waiver_threshold_cents();
drop function if exists public.tk_passport_retention_days();
drop function if exists public.tk_dashboard();
drop function if exists public.tk_report_inspector_load(timestamptz, timestamptz, boolean);
drop function if exists public.tk_report_unpaid_list(boolean);
drop function if exists public.tk_report_unpaid_ageing(boolean);
drop function if exists public.tk_report_funnel(timestamptz, timestamptz, boolean);
drop function if exists public.tk_report_fees_by_service(timestamptz, timestamptz, boolean);
drop function if exists public.tk_t7_proformas(boolean);
drop function if exists public.tk_report_ok();
drop function if exists public.tk_t7_alert_handover_ready();
drop function if exists public.tk_t7_alert_shipment_event();
drop function if exists public.tk_t7_alert_inspection();
drop function if exists public.tk_t7_alert_proforma();
drop function if exists public.tk_t7_alert_fee_pending();
drop function if exists public.tk_t7_alert_enquiry();
drop function if exists public.tk_t7_proforma_label(text);
drop function if exists public.tk_t7_staff_recipients(uuid);
drop function if exists public.tk_t7_notify(uuid, uuid, uuid, text, text, text, text);

delete from public.site_settings where key in ('turnkey.passport_retention_days', 'turnkey.am_waiver_threshold_cents');

-- replaced function, restored exactly (staging, before T7)
CREATE OR REPLACE FUNCTION public.division_report(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_include_test boolean DEFAULT false)
 RETURNS TABLE(line text, division_code text, division_name text, sort_order integer, revenue_by_currency jsonb, revenue_converted_minor bigint, orders_count integer, orders_by_currency jsonb, orders_converted_minor bigint, open_work integer, open_detail jsonb, pipeline_count integer, pipeline_by_currency jsonb, pipeline_converted_minor bigint, deposits_by_currency jsonb, deposits_converted_minor bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
