-- 20261101000238_t7_turnkey_reports_alerts_settings.sql   (renumber at install)
-- Turnkey T7 (docs/design/turnkey-v2: staff operations "Main (Dashboard) … Reports, Alerts, Settings"; "Dashboard is the
-- staff home"; "Reports shows fees by service, funnel, unpaid ageing and inspector workload"; Admin "sees reports";
-- open placeholder "[THRESHOLD]: project value above which the account manager fee is waived"; T2 open item: the division
-- report still counted the frozen turnkey_leads).
--  1. Alerts through the EXISTING notifications table (bell, /account/notifications, /admin/notifications; one row per
--     event and recipient through dedupe_key; service 'turnkey' → TK division). AFTER triggers only — no T2–T6 function
--     is replaced:
--       · new client enquiry (tk_client_projects, source web) → Turnkey staff of the division (admins or Turnkey editors
--         who are division members; the admins when there are none);
--       · fee waiting for approval (tk_project_fees / tk_inspection_fees / tk_trip_fees, pending) → every admin except
--         the proposer;
--       · turnkey proforma issued / fully paid (documents, service turnkey) → the client company and the project's
--         active account manager;
--       · inspection report published (tk_inspections) → the client company;
--       · shipment tracking event (tk_shipment_events, shipment not cancelled) → the client company;
--       · handover ready (last open tk_handover_items line ticked, not signed yet) → the client company, once.
--     An alert never blocks the business write: a failure is logged as a warning and the write goes on. Texts never name
--     a factory (labels come from service names, the T5 / T6 labels and client-visible tracking text).
--  2. Reports (definer reads; Turnkey viewers of the TK division; demo data left out unless asked): fees by service and
--     month (issued / paid / outstanding, integer cents, from the proformas and the fee rows that issued them), phase
--     funnel, unpaid ageing (0–30 / 31–60 / 61–90 / 90+ days since issue) with the list behind it, inspector workload.
--  3. Staff dashboard: KPIs from real rows (open projects by phase, on hold, fees waiting for approval, unpaid proformas,
--     inspections to schedule / due / overdue / to review, trips requested / upcoming) and "my projects" for account
--     managers (primary, or cover during the cover period).
--  4. Settings (admins on 2FA, every change audited 'turnkey.setting'): extra traveller price per day (T6 column on
--     tk_services; the amount in the public rule text follows), passport retention days (default 30 = T6's purge
--     default; tk_purge_trip_passports_by_setting for the scheduled job, service role), the account manager waiver
--     threshold (unset until the owner sets it; not applied automatically). The deposit % keeps T4's tk_set_deposit_pct.
--  5. division_report: open work counts open / on-hold client projects ('turnkey_projects') instead of the frozen
--     turnkey_leads (they were moved into projects by T2, so counting both would double them). Everything else in the
--     function is unchanged (staging definition, pg_get_functiondef, 26 Nov 2026).
-- No new table. Every function is a security definer with search_path = public and not callable by anon; internal
-- helpers and trigger functions are not callable by signed-in users either.
-- Down: supabase/migrations/down/20261101000238_t7_turnkey_reports_alerts_settings.down.sql

-- ───────── 1. alerts: the existing notifications table (bell + /account/notifications + /admin/notifications) ─────────
-- one notification per event and recipient (dedupe_key, unique since migration 187); service 'turnkey' → TK division
create or replace function public.tk_t7_notify(p_user uuid, p_org uuid, p_division uuid, p_title text, p_body text, p_link text, p_dedupe text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, org_id, division_id, service, title, body, link, dedupe_key)
  values (p_user, p_org, p_division, 'turnkey', left(p_title, 200), left(p_body, 1000), p_link, p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;
revoke all on function public.tk_t7_notify(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.tk_t7_notify(uuid, uuid, uuid, text, text, text, text) to service_role;

-- Turnkey staff to tell about a new enquiry: members of the project's division who are admins or Turnkey editors;
-- when the division has none yet, the admins (so an enquiry is never unseen)
create or replace function public.tk_t7_staff_recipients(p_division uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with editors as (
    select distinct m.user_id
      from public.division_members m
     where m.division_id = p_division
       and exists (select 1 from public.user_roles ur where ur.user_id = m.user_id
                      and (ur.role_code = 'admin'
                           or exists (select 1 from public.role_permissions rp where rp.role_code = ur.role_code and rp.area = 'turnkey' and rp.action = 'edit'))))
  select user_id from editors
  union
  select distinct ur.user_id from public.user_roles ur where ur.role_code = 'admin' and not exists (select 1 from editors);
$$;
revoke all on function public.tk_t7_staff_recipients(uuid) from public, anon, authenticated;
grant execute on function public.tk_t7_staff_recipients(uuid) to service_role;

-- the text a client sees for a turnkey proforma: its title without the "Turnkey TKP-00001 · " prefix
create or replace function public.tk_t7_proforma_label(p_title text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(regexp_replace(coalesce(p_title, ''), '^Turnkey [A-Z0-9-]+ · ', '')), ''), 'Turnkey fee');
$$;
revoke all on function public.tk_t7_proforma_label(text) from public, anon, authenticated;
grant execute on function public.tk_t7_proforma_label(text) to service_role;

-- a new client enquiry → Turnkey staff (an alert never blocks the business write: failures are logged as warnings)
create or replace function public.tk_t7_alert_enquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_org text;
begin
  select nullif(btrim(o.name), '') into v_org from public.organizations o where o.id = new.org_id;
  for r in select u from public.tk_t7_staff_recipients(new.division_id) u loop
    perform public.tk_t7_notify(r.u, null, new.division_id, 'New Turnkey enquiry · ' || new.code,
      new.title || coalesce(' from ' || v_org, '') || '. Reply with the consultation fee before any work starts.',
      '/admin/turnkey/projects/' || new.code, 'tk:enquiry:' || new.id || ':' || r.u);
  end loop;
  return null;
exception when others then
  raise warning 'turnkey alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
revoke all on function public.tk_t7_alert_enquiry() from public, anon, authenticated;
drop trigger if exists trg_tk_t7_alert_enquiry on public.tk_client_projects;
create trigger trg_tk_t7_alert_enquiry after insert on public.tk_client_projects
  for each row when (new.source = 'web') execute function public.tk_t7_alert_enquiry();

-- a fee above 2x its starting fee waits for approval → every admin except the person who set it (T3 phase fees,
-- T5 inspection fees, T6 China visit fees)
create or replace function public.tk_t7_alert_fee_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  r record;
  v_kind text := case tg_table_name when 'tk_project_fees' then 'A phase fee' when 'tk_inspection_fees' then 'An inspection fee' else 'A China visit fee' end;
begin
  if new.status <> 'pending_approval' then return null; end if;
  select * into v from public.tk_client_projects where id = new.project_id;
  if v.id is null then return null; end if;
  for r in select distinct ur.user_id u from public.user_roles ur where ur.role_code = 'admin' and ur.user_id is distinct from new.proposed_by loop
    perform public.tk_t7_notify(r.u, null, v.division_id, 'Fee waiting for approval · ' || v.code,
      v_kind || ' of ' || public.tk_usd(new.amount_cents) || ' for ' || v.title || ' needs an admin''s approval (above 2× the starting fee). The person who set it cannot approve it.',
      '/admin/turnkey/approvals', 'tk:fee-approval:' || new.id || ':' || r.u);
  end loop;
  return null;
exception when others then
  raise warning 'turnkey alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
revoke all on function public.tk_t7_alert_fee_pending() from public, anon, authenticated;
drop trigger if exists trg_tk_t7_alert_fee_pending on public.tk_project_fees;
create trigger trg_tk_t7_alert_fee_pending after insert on public.tk_project_fees
  for each row when (new.status = 'pending_approval') execute function public.tk_t7_alert_fee_pending();
drop trigger if exists trg_tk_t7_alert_fee_pending on public.tk_inspection_fees;
create trigger trg_tk_t7_alert_fee_pending after insert on public.tk_inspection_fees
  for each row when (new.status = 'pending_approval') execute function public.tk_t7_alert_fee_pending();
drop trigger if exists trg_tk_t7_alert_fee_pending on public.tk_trip_fees;
create trigger trg_tk_t7_alert_fee_pending after insert on public.tk_trip_fees
  for each row when (new.status = 'pending_approval') execute function public.tk_t7_alert_fee_pending();

-- a turnkey proforma (T3–T6: phase fees, extra drawing versions, deposit, inspections, balance, China visits) is issued
-- → the client company and the project's account manager; fully paid → both again
create or replace function public.tk_t7_alert_proforma()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_am uuid;
  v_label text := public.tk_t7_proforma_label(new.data ->> 'title');
  v_amount text := public.tk_usd(new.amount_cents);
begin
  select * into v from public.tk_client_projects where code = new.data ->> 'ref';
  if v.id is null or new.org_id is null then return null; end if;
  v_am := public.tk_active_manager(v.id);
  if tg_op = 'INSERT' then
    perform public.tk_t7_notify(null, new.org_id, v.division_id, 'Proforma ready to pay · ' || v.code,
      v_label || ': ' || v_amount || ' (proforma ' || coalesce(new.number, '') || '). The work starts after your payment is confirmed.',
      '/account/turnkey/' || v.code, 'tk:pf-issued:' || new.id || ':client');
    if v_am is not null then
      perform public.tk_t7_notify(v_am, null, v.division_id, 'Proforma issued · ' || v.code,
        v_label || ': ' || v_amount || ' (proforma ' || coalesce(new.number, '') || ') for ' || v.title || '.',
        '/admin/turnkey/projects/' || v.code, 'tk:pf-issued:' || new.id || ':am:' || v_am);
    end if;
  else
    perform public.tk_t7_notify(null, new.org_id, v.division_id, 'Payment received · ' || v.code,
      v_label || ': ' || v_amount || ' is paid (proforma ' || coalesce(new.number, '') || '). Thank you.',
      '/account/turnkey/' || v.code, 'tk:pf-paid:' || new.id || ':client');
    if v_am is not null then
      perform public.tk_t7_notify(v_am, null, v.division_id, 'Client paid · ' || v.code,
        v_label || ': ' || v_amount || ' (proforma ' || coalesce(new.number, '') || ') is paid in full.',
        '/admin/turnkey/projects/' || v.code, 'tk:pf-paid:' || new.id || ':am:' || v_am);
    end if;
  end if;
  return null;
exception when others then
  raise warning 'turnkey alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
revoke all on function public.tk_t7_alert_proforma() from public, anon, authenticated;
drop trigger if exists trg_tk_t7_proforma_issued on public.documents;
create trigger trg_tk_t7_proforma_issued after insert on public.documents
  for each row when (new.doc_type = 'proforma_invoice' and (new.data ->> 'service') = 'turnkey')
  execute function public.tk_t7_alert_proforma();
drop trigger if exists trg_tk_t7_proforma_paid on public.documents;
create trigger trg_tk_t7_proforma_paid after update of paid_cents on public.documents
  for each row when (new.doc_type = 'proforma_invoice' and (new.data ->> 'service') = 'turnkey' and new.amount_cents > 0
                     and old.paid_cents < old.amount_cents and new.paid_cents >= new.amount_cents)
  execute function public.tk_t7_alert_proforma();

-- an inspection report is published (T5) → the client company
create or replace function public.tk_t7_alert_inspection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
begin
  select * into v from public.tk_client_projects where id = new.project_id;
  if v.id is null or v.org_id is null then return null; end if;
  perform public.tk_t7_notify(null, v.org_id, v.division_id, 'Inspection report published · ' || v.code,
    public.tk_inspection_label(new.kind, new.round) || ' report for ' || v.title || ' is ready to read.',
    '/account/turnkey/' || v.code, 'tk:inspection-published:' || new.id);
  return null;
exception when others then
  raise warning 'turnkey alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
revoke all on function public.tk_t7_alert_inspection() from public, anon, authenticated;
drop trigger if exists trg_tk_t7_alert_inspection on public.tk_inspections;
create trigger trg_tk_t7_alert_inspection after update of status on public.tk_inspections
  for each row when (new.status = 'published' and old.status is distinct from 'published')
  execute function public.tk_t7_alert_inspection();

-- a tracking event on a shipment the client can see (T6) → the client company
create or replace function public.tk_t7_alert_shipment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  s public.tk_shipments;
begin
  select * into s from public.tk_shipments where id = new.shipment_id;
  if s.id is null or s.status = 'cancelled' then return null; end if;
  select * into v from public.tk_client_projects where id = new.project_id;
  if v.id is null or v.org_id is null then return null; end if;
  perform public.tk_t7_notify(null, v.org_id, v.division_id, 'Shipment update · ' || v.code,
    'Shipment ' || s.seq || ' (' || s.carrier || '): ' || coalesce(public.tk_shipment_status_label(new.status_to) || '. ', '')
      || new.description || coalesce(' (' || new.location || ')', ''),
    '/account/turnkey/' || v.code, 'tk:shipment-event:' || new.id);
  return null;
exception when others then
  raise warning 'turnkey alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
revoke all on function public.tk_t7_alert_shipment_event() from public, anon, authenticated;
drop trigger if exists trg_tk_t7_alert_shipment_event on public.tk_shipment_events;
create trigger trg_tk_t7_alert_shipment_event after insert on public.tk_shipment_events
  for each row execute function public.tk_t7_alert_shipment_event();

-- the last open handover line is ticked (T6) → the client company: ready to sign (once per project)
create or replace function public.tk_t7_alert_handover_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
begin
  if exists (select 1 from public.tk_handover_items h where h.project_id = new.project_id and h.done_at is null)
     or exists (select 1 from public.tk_handover_signoffs s where s.project_id = new.project_id) then
    return null;
  end if;
  select * into v from public.tk_client_projects where id = new.project_id;
  if v.id is null or v.org_id is null or v.status <> 'open' then return null; end if;
  perform public.tk_t7_notify(null, v.org_id, v.division_id, 'Handover ready to sign · ' || v.code,
    'Every handover item for ' || v.title || ' is ready. Check the final documents and sign the handover.',
    '/account/turnkey/' || v.code, 'tk:handover-ready:' || v.id);
  return null;
exception when others then
  raise warning 'turnkey alert skipped (%): %', tg_name, sqlerrm;
  return null;
end $$;
revoke all on function public.tk_t7_alert_handover_ready() from public, anon, authenticated;
drop trigger if exists trg_tk_t7_alert_handover_ready on public.tk_handover_items;
create trigger trg_tk_t7_alert_handover_ready after update of done_at on public.tk_handover_items
  for each row when (new.done_at is not null and old.done_at is null)
  execute function public.tk_t7_alert_handover_ready();

-- ───────── 2. reports (staff: Turnkey viewers of the TK division; numbers only from real rows) ─────────
create or replace function public.tk_report_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and can('turnkey', 'view') and in_division(division_id_of('TK'));
$$;
revoke all on function public.tk_report_ok() from public, anon;
grant execute on function public.tk_report_ok() to authenticated, service_role;

-- every turnkey proforma with the service it bills (from the fee row that issued it). Internal.
-- p_include_test = false leaves out demo data (seed documents, seed projects, seed companies).
create or replace function public.tk_t7_proformas(p_include_test boolean)
returns table (
  document_id uuid, number text, project_id uuid, project_code text, org_id uuid, division_id uuid,
  service_key text, service_name text, amount_cents bigint, paid_cents bigint, status text, issued_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select d.id, d.number, p.id as project_id, p.code, p.org_id, p.division_id, d.amount_cents, d.paid_cents, coalesce(d.status, '') as status, d.created_at,
           case d.data ->> 'ref_type'
             when 'tk_project_fee' then (select coalesce(f.service_code, 'stage_' || f.stage) from public.tk_project_fees f where f.document_id = d.id limit 1)
             when 'tk_inspection' then (select i.service_code from public.tk_inspection_fees i where i.document_id = d.id limit 1)
             when 'tk_drawing_version' then 'layout_drawing_extra'
             when 'tk_client_quote' then 'quote_deposit'
             when 'tk_quote_balance' then 'quote_balance'
             when 'tk_trip' then 'visit_china'
           end as k
      from public.documents d
      join public.tk_client_projects p on p.code = d.data ->> 'ref'
     where d.doc_type = 'proforma_invoice' and d.data ->> 'service' = 'turnkey'
       and (p_include_test
            or (not coalesce(d.is_seed, false)
                and not exists (select 1 from public.tk_client_project_staff s where s.project_id = p.id and s.is_seed)
                and not exists (select 1 from public.organizations g where g.id = p.org_id and g.is_seed)))
  )
  select d.id, d.number, d.project_id, d.code, d.org_id, d.division_id, coalesce(d.k, 'other'),
         case
           when d.k = 'layout_drawing_extra' then 'Layout drawing (extra versions)'
           when d.k = 'quote_deposit' then 'Quote deposit'
           when d.k = 'quote_balance' then 'Quote balance'
           when d.k like 'stage\_%' then coalesce((select st.name || ' fee' from public.tk_stages st where st.code = substr(d.k, 7)), 'Phase fee')
           when d.k is null then 'Other'
           else coalesce((select s.name from public.tk_services s where s.code = d.k), d.k)
         end,
         d.amount_cents, d.paid_cents, d.status, d.created_at
    from d;
$$;
revoke all on function public.tk_t7_proformas(boolean) from public, anon, authenticated;
grant execute on function public.tk_t7_proformas(boolean) to service_role;

-- fees by service and month (UTC), integer cents: issued (not void) and paid of the proformas issued in the period
create or replace function public.tk_report_fees_by_service(p_from timestamptz default null, p_to timestamptz default null, p_include_test boolean default false)
returns table (period date, service_key text, service_name text, issued_count integer, issued_cents bigint, paid_cents bigint, outstanding_cents bigint, void_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_report_ok() then raise exception 'FORBIDDEN: Turnkey reports are for Turnkey staff'; end if;
  return query
    select (date_trunc('month', x.issued_at at time zone 'UTC'))::date, x.service_key, x.service_name,
           (count(*) filter (where x.status not in ('void', 'cancelled')))::integer,
           coalesce(sum(x.amount_cents) filter (where x.status not in ('void', 'cancelled')), 0)::bigint,
           coalesce(sum(x.paid_cents) filter (where x.status not in ('void', 'cancelled')), 0)::bigint,
           coalesce(sum(x.amount_cents - x.paid_cents) filter (where x.status not in ('void', 'cancelled')), 0)::bigint,
           (count(*) filter (where x.status in ('void', 'cancelled')))::integer
      from public.tk_t7_proformas(coalesce(p_include_test, false)) x
     where in_division(x.division_id)
       and (p_from is null or x.issued_at >= p_from) and (p_to is null or x.issued_at < p_to)
     group by 1, 2, 3
     order by 1 desc, 3;
end $$;
revoke all on function public.tk_report_fees_by_service(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.tk_report_fees_by_service(timestamptz, timestamptz, boolean) to authenticated, service_role;

-- phase funnel of the projects started in the period: how many reached each phase (current phase at or after it),
-- and where they are now (open / on hold / cancelled / completed in that phase)
create or replace function public.tk_report_funnel(p_from timestamptz default null, p_to timestamptz default null, p_include_test boolean default false)
returns table (seq smallint, stage text, stage_name text, reached integer, open_now integer, on_hold_now integer, cancelled_here integer, completed_here integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_report_ok() then raise exception 'FORBIDDEN: Turnkey reports are for Turnkey staff'; end if;
  return query
    with p as (
      select p.id, p.status, ps.seq as at_seq, p.stage
        from public.tk_client_projects p
        join public.tk_stages ps on ps.code = p.stage
       where in_division(p.division_id)
         and (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to)
         and (coalesce(p_include_test, false)
              or (not exists (select 1 from public.tk_client_project_staff s where s.project_id = p.id and s.is_seed)
                  and not exists (select 1 from public.organizations g where g.id = p.org_id and g.is_seed))))
    select s.seq, s.code, s.name,
           (select count(*) from p where p.at_seq >= s.seq)::integer,
           (select count(*) from p where p.stage = s.code and p.status = 'open')::integer,
           (select count(*) from p where p.stage = s.code and p.status = 'on_hold')::integer,
           (select count(*) from p where p.stage = s.code and p.status = 'cancelled')::integer,
           (select count(*) from p where p.stage = s.code and p.status = 'completed')::integer
      from public.tk_stages s
     order by s.seq;
end $$;
revoke all on function public.tk_report_funnel(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.tk_report_funnel(timestamptz, timestamptz, boolean) to authenticated, service_role;

-- unpaid turnkey proformas today, by days since issue (UTC dates): 0–30, 31–60, 61–90, 90+ (= 91 days or more)
create or replace function public.tk_report_unpaid_ageing(p_include_test boolean default false)
returns table (bucket text, sort smallint, open_count integer, outstanding_cents bigint, oldest_days integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_report_ok() then raise exception 'FORBIDDEN: Turnkey reports are for Turnkey staff'; end if;
  return query
    with u as (
      select x.amount_cents - x.paid_cents as due, ((now() at time zone 'UTC')::date - (x.issued_at at time zone 'UTC')::date) as age
        from public.tk_t7_proformas(coalesce(p_include_test, false)) x
       where in_division(x.division_id) and x.status not in ('void', 'cancelled') and x.paid_cents < x.amount_cents),
    b(label, srt, lo, hi) as (values ('0–30', 1, 0, 30), ('31–60', 2, 31, 60), ('61–90', 3, 61, 90), ('90+', 4, 91, null::integer))
    select b.label, b.srt::smallint, count(u.due)::integer, coalesce(sum(u.due), 0)::bigint, max(u.age)::integer
      from b left join u on u.age >= b.lo and (b.hi is null or u.age <= b.hi)
     group by b.label, b.srt
     order by b.srt;
end $$;
revoke all on function public.tk_report_unpaid_ageing(boolean) from public, anon;
grant execute on function public.tk_report_unpaid_ageing(boolean) to authenticated, service_role;

-- the unpaid proformas behind the ageing buckets (for the list and the CSV)
create or replace function public.tk_report_unpaid_list(p_include_test boolean default false)
returns table (document_id uuid, number text, project_code text, client_name text, service_name text, amount_cents bigint, paid_cents bigint, outstanding_cents bigint, issued_at timestamptz, age_days integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_report_ok() then raise exception 'FORBIDDEN: Turnkey reports are for Turnkey staff'; end if;
  return query
    select x.document_id, x.number, x.project_code, o.name, x.service_name, x.amount_cents, x.paid_cents, (x.amount_cents - x.paid_cents)::bigint, x.issued_at,
           ((now() at time zone 'UTC')::date - (x.issued_at at time zone 'UTC')::date)::integer
      from public.tk_t7_proformas(coalesce(p_include_test, false)) x
      left join public.organizations o on o.id = x.org_id
     where in_division(x.division_id) and x.status not in ('void', 'cancelled') and x.paid_cents < x.amount_cents
     order by x.issued_at, x.number
     limit 1000;
end $$;
revoke all on function public.tk_report_unpaid_list(boolean) from public, anon;
grant execute on function public.tk_report_unpaid_list(boolean) to authenticated, service_role;

-- inspector workload (T5): open jobs, due within 7 days, overdue, waiting for review, published in the period, next date.
-- Only inspectors who have a job (no invented rows).
create or replace function public.tk_report_inspector_load(p_from timestamptz default null, p_to timestamptz default null, p_include_test boolean default false)
returns table (inspector_id uuid, inspector_name text, open_jobs integer, due_7_days integer, overdue integer, awaiting_review integer, published_in_period integer, next_on date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
begin
  if not public.tk_report_ok() then raise exception 'FORBIDDEN: Turnkey reports are for Turnkey staff'; end if;
  return query
    with i as (
      select i.* from public.tk_inspections i
        join public.tk_client_projects p on p.id = i.project_id
       where i.inspector_id is not null and in_division(p.division_id)
         and (coalesce(p_include_test, false)
              or (not exists (select 1 from public.tk_client_project_staff s where s.project_id = p.id and s.is_seed)
                  and not exists (select 1 from public.organizations g where g.id = p.org_id and g.is_seed))))
    select i.inspector_id, coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Former team member'),
           (count(*) filter (where i.status in ('scheduled', 'in_progress')))::integer,
           (count(*) filter (where i.status in ('scheduled', 'in_progress') and i.scheduled_on between v_today and v_today + 7))::integer,
           (count(*) filter (where i.status = 'scheduled' and i.scheduled_on < v_today))::integer,
           (count(*) filter (where i.status = 'submitted'))::integer,
           (count(*) filter (where i.status = 'published' and (p_from is null or i.published_at >= p_from) and (p_to is null or i.published_at < p_to)))::integer,
           min(i.scheduled_on) filter (where i.status in ('scheduled', 'in_progress') and i.scheduled_on >= v_today)
      from i
      left join public.profiles pr on pr.id = i.inspector_id
     group by i.inspector_id, pr.full_name, pr.email
    having count(*) filter (where i.status in ('scheduled', 'in_progress', 'submitted')) > 0
        or count(*) filter (where i.status = 'published' and (p_from is null or i.published_at >= p_from) and (p_to is null or i.published_at < p_to)) > 0
     order by 3 desc, 2;
end $$;
revoke all on function public.tk_report_inspector_load(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.tk_report_inspector_load(timestamptz, timestamptz, boolean) to authenticated, service_role;

-- ───────── 3. staff dashboard (/admin/turnkey) ─────────
-- KPIs for Turnkey viewers of the TK division; "my projects" for every staff member who manages projects (primary
-- account manager, or cover during the cover period). Demo data is left out of the KPIs.
create or replace function public.tk_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_all boolean := public.tk_report_ok();
  v_today date := (now() at time zone 'UTC')::date;
  v_kpi jsonb := null;
begin
  if auth.uid() is null or not is_staff() then raise exception 'FORBIDDEN'; end if;
  if v_all then
    with p as (
      select p.* from public.tk_client_projects p
       where in_division(p.division_id)
         and not exists (select 1 from public.tk_client_project_staff s where s.project_id = p.id and s.is_seed)
         and not exists (select 1 from public.organizations g where g.id = p.org_id and g.is_seed))
    select jsonb_build_object(
      'open_by_stage', coalesce((select jsonb_object_agg(x.stage, x.n) from (select p.stage, count(*) n from p where p.status = 'open' group by p.stage) x), '{}'::jsonb),
      'open_total', (select count(*) from p where p.status = 'open'),
      'on_hold', (select count(*) from p where p.status = 'on_hold'),
      'new_enquiries_7d', (select count(*) from p where p.stage = 'enquiry' and p.status = 'open' and p.created_at >= now() - interval '7 days'),
      'waiting_approvals', (select count(*) from public.tk_project_fees f join p on p.id = f.project_id where f.status = 'pending_approval')
                         + (select count(*) from public.tk_inspection_fees f join p on p.id = f.project_id where f.status = 'pending_approval')
                         + (select count(*) from public.tk_trip_fees f join p on p.id = f.project_id where f.status = 'pending_approval'),
      'unpaid_count', (select count(*) from public.tk_t7_proformas(false) x where in_division(x.division_id) and x.status not in ('void', 'cancelled') and x.paid_cents < x.amount_cents),
      'unpaid_cents', (select coalesce(sum(x.amount_cents - x.paid_cents), 0) from public.tk_t7_proformas(false) x where in_division(x.division_id) and x.status not in ('void', 'cancelled') and x.paid_cents < x.amount_cents),
      'inspections_to_schedule', (select count(*) from public.tk_inspections i join p on p.id = i.project_id where i.status = 'planned'),
      'inspections_due_7d', (select count(*) from public.tk_inspections i join p on p.id = i.project_id where i.status in ('scheduled', 'in_progress') and i.scheduled_on <= v_today + 7),
      'inspections_overdue', (select count(*) from public.tk_inspections i join p on p.id = i.project_id where i.status = 'scheduled' and i.scheduled_on < v_today),
      'reports_to_review', (select count(*) from public.tk_inspections i join p on p.id = i.project_id where i.status = 'submitted'),
      'trips_requested', (select count(*) from public.tk_trips t join p on p.id = t.project_id where t.status = 'requested'),
      'trips_upcoming_30d', (select count(*) from public.tk_trips t join p on p.id = t.project_id where t.status = 'confirmed' and t.start_on between v_today and v_today + 30),
      'next_trips', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'title', x.title, 'start_on', x.start_on, 'end_on', x.end_on, 'travellers', x.travellers) order by x.start_on)
                                from (select p.code, p.title, t.start_on, t.end_on, t.travellers from public.tk_trips t join p on p.id = t.project_id
                                       where t.status = 'confirmed' and t.end_on >= v_today order by t.start_on limit 5) x), '[]'::jsonb),
      'due_inspections', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'title', x.title, 'kind', x.kind, 'round', x.round, 'scheduled_on', x.scheduled_on, 'status', x.status) order by x.scheduled_on)
                                from (select p.code, p.title, i.kind, i.round, i.scheduled_on, i.status from public.tk_inspections i join p on p.id = i.project_id
                                       where i.status in ('scheduled', 'in_progress') and i.scheduled_on <= v_today + 7 order by i.scheduled_on limit 5) x), '[]'::jsonb)
    ) into v_kpi;
  end if;
  return jsonb_build_object(
    'can_see_all', v_all,
    'kpi', v_kpi,
    'my_projects', coalesce((
      select jsonb_agg(jsonb_build_object('code', x.code, 'title', x.title, 'stage', x.stage, 'status', x.status, 'client', x.client, 'updated_at', x.updated_at,
                                          'unpaid', x.unpaid, 'on_cover', x.on_cover) order by x.updated_at desc)
        from (select p.code, p.title, p.stage, p.status, o.name as client, p.updated_at,
                     (select count(*) from public.documents d where d.doc_type = 'proforma_invoice' and d.data ->> 'service' = 'turnkey' and d.data ->> 'ref' = p.code
                         and coalesce(d.status, '') not in ('void', 'cancelled') and d.paid_cents < d.amount_cents) as unpaid,
                     (s.owner_id is distinct from auth.uid()) as on_cover
                from public.tk_client_projects p
                join public.tk_client_project_staff s on s.project_id = p.id
                left join public.organizations o on o.id = p.org_id
               where p.id in (select public.tk_my_managed_projects()) and p.status in ('open', 'on_hold')
               order by p.updated_at desc limit 50) x), '[]'::jsonb));
end $$;
revoke all on function public.tk_dashboard() from public, anon;
grant execute on function public.tk_dashboard() to authenticated, service_role;

-- ───────── 4. settings (/admin/turnkey/settings; admins on 2FA change them; every change audited) ─────────
-- passport copies are kept this many days after a trip (T6's purge default is 30 when the setting is not set)
create or replace function public.tk_passport_retention_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case when jsonb_typeof(setting('turnkey.passport_retention_days')) = 'number'
                        and (setting('turnkey.passport_retention_days') #>> '{}')::numeric between 1 and 365
                        and (setting('turnkey.passport_retention_days') #>> '{}')::numeric = trunc((setting('turnkey.passport_retention_days') #>> '{}')::numeric)
                       then (setting('turnkey.passport_retention_days') #>> '{}')::integer end, 30);
$$;
revoke all on function public.tk_passport_retention_days() from public, anon;
grant execute on function public.tk_passport_retention_days() to authenticated, service_role;

-- [THRESHOLD] in the design: project value (integer cents) above which the account manager fee is waived. Unset
-- (null) until the owner sets it; nothing applies it automatically yet.
create or replace function public.tk_am_waiver_threshold_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case when jsonb_typeof(setting('turnkey.am_waiver_threshold_cents')) = 'number'
               and (setting('turnkey.am_waiver_threshold_cents') #>> '{}')::numeric > 0
               and (setting('turnkey.am_waiver_threshold_cents') #>> '{}')::numeric = trunc((setting('turnkey.am_waiver_threshold_cents') #>> '{}')::numeric)
              then (setting('turnkey.am_waiver_threshold_cents') #>> '{}')::bigint end;
$$;
revoke all on function public.tk_am_waiver_threshold_cents() from public, anon;
grant execute on function public.tk_am_waiver_threshold_cents() to authenticated, service_role;

create or replace function public.tk_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_staff() and can('turnkey', 'view')) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'deposit_pct', public.tk_deposit_pct(),
    'extra_traveller_day_cents', (select s.extra_traveller_day_cents from public.tk_services s where s.code = 'visit_china'),
    'included_travellers', (select s.included_travellers from public.tk_services s where s.code = 'visit_china'),
    'visit_rule_text', (select s.rule_text from public.tk_services s where s.code = 'visit_china'),
    'passport_retention_days', public.tk_passport_retention_days(),
    'passport_retention_set', exists (select 1 from public.site_settings x where x.key = 'turnkey.passport_retention_days' and jsonb_typeof(x.value) = 'number'),
    'am_waiver_threshold_cents', public.tk_am_waiver_threshold_cents(),
    'can_edit', is_admin(),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'entity_id', a.entity_id, 'details', a.details, 'at', a.created_at,
                                                             'by', coalesce(nullif(btrim(pr.full_name), ''), pr.email)) order by a.created_at desc)
                           from (select * from public.audit_log l
                                  where l.action in ('turnkey.deposit_pct', 'turnkey.setting')
                                  order by l.created_at desc limit 20) a
                           left join public.profiles pr on pr.id = a.actor_id), '[]'::jsonb));
end $$;
revoke all on function public.tk_settings() from public, anon;
grant execute on function public.tk_settings() to authenticated, service_role;

-- extra traveller price per day for Visit China (T6 data on tk_services; frozen on each trip when it is requested).
-- The "extra traveller $X per day" amount in the public rule text follows the new price.
create or replace function public.tk_set_extra_traveller_price(p_cents bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.tk_services;
  v_usd text;
  v_rule text;
begin
  if auth.uid() is null or not is_admin() then raise exception 'FORBIDDEN: only admins change Turnkey settings'; end if;
  if p_cents is null or p_cents < 0 or p_cents > 100000000 then raise exception 'INVALID_PRICE: enter a price per day from US$ 0 to US$ 1,000,000'; end if;
  select * into s from public.tk_services where code = 'visit_china' for update;
  if s.code is null then raise exception 'NOT_FOUND: the Visit China service is missing'; end if;
  v_usd := '$' || case when p_cents % 100 = 0 then to_char(p_cents / 100, 'FM999,999,990') else to_char(p_cents / 100.0, 'FM999,999,990.00') end;
  v_rule := case when s.rule_text ~ 'extra traveller \$[0-9][0-9,]*(\.[0-9]{2})? per day'
                 then regexp_replace(s.rule_text, 'extra traveller \$[0-9][0-9,]*(\.[0-9]{2})? per day', 'extra traveller ' || v_usd || ' per day')
                 else s.rule_text end;
  update public.tk_services
     set extra_traveller_day_cents = p_cents, rule_text = v_rule, updated_at = now(), updated_by = auth.uid()
   where code = 'visit_china';
  perform write_audit('turnkey.setting', 'tk_services', 'visit_china.extra_traveller_day_cents',
    jsonb_build_object('setting', 'extra_traveller_day_cents', 'old', s.extra_traveller_day_cents, 'new', p_cents,
                       'rule_text_old', s.rule_text, 'rule_text_new', v_rule));
end $$;
revoke all on function public.tk_set_extra_traveller_price(bigint) from public, anon;
grant execute on function public.tk_set_extra_traveller_price(bigint) to authenticated, service_role;

create or replace function public.tk_set_passport_retention_days(p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer := public.tk_passport_retention_days();
begin
  if auth.uid() is null or not is_admin() then raise exception 'FORBIDDEN: only admins change Turnkey settings'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'INVALID_DAYS: enter a whole number of days from 1 to 365'; end if;
  perform set_setting('turnkey.passport_retention_days', to_jsonb(p_days));
  update public.site_settings set description = 'Turnkey T7: days passport copies are kept after a China visit (tk_purge_trip_passports_by_setting).', is_public = false
   where key = 'turnkey.passport_retention_days';
  perform write_audit('turnkey.setting', 'site_settings', 'turnkey.passport_retention_days', jsonb_build_object('setting', 'passport_retention_days', 'old', v_old, 'new', p_days));
end $$;
revoke all on function public.tk_set_passport_retention_days(integer) from public, anon;
grant execute on function public.tk_set_passport_retention_days(integer) to authenticated, service_role;

-- null clears it (back to "not set")
create or replace function public.tk_set_am_waiver_threshold(p_cents bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old bigint := public.tk_am_waiver_threshold_cents();
begin
  if auth.uid() is null or not is_admin() then raise exception 'FORBIDDEN: only admins change Turnkey settings'; end if;
  if p_cents is not null and (p_cents <= 0 or p_cents > 100000000000) then raise exception 'INVALID_THRESHOLD: enter a project value above US$ 0'; end if;
  if p_cents is null and v_old is null then raise exception 'NOT_SET: the threshold is not set'; end if;
  perform set_setting('turnkey.am_waiver_threshold_cents', coalesce(to_jsonb(p_cents), 'null'::jsonb));
  update public.site_settings set description = 'Turnkey T7: [THRESHOLD] project value (US cents) above which the account manager fee is waived. Set by the owner.', is_public = false
   where key = 'turnkey.am_waiver_threshold_cents';
  perform write_audit('turnkey.setting', 'site_settings', 'turnkey.am_waiver_threshold_cents', jsonb_build_object('setting', 'am_waiver_threshold_cents', 'old', v_old, 'new', p_cents));
end $$;
revoke all on function public.tk_set_am_waiver_threshold(bigint) from public, anon;
grant execute on function public.tk_set_am_waiver_threshold(bigint) to authenticated, service_role;

-- for the scheduled purge job (service role; not scheduled yet): T6's purge with the retention setting
create or replace function public.tk_purge_trip_passports_by_setting()
returns setof text
language sql
security definer
set search_path = public
as $$
  select public.tk_purge_trip_passports(public.tk_passport_retention_days());
$$;
revoke all on function public.tk_purge_trip_passports_by_setting() from public, anon, authenticated;
grant execute on function public.tk_purge_trip_passports_by_setting() to service_role;

-- ───────── 5. division report: client projects instead of the frozen turnkey_leads (T2 open item) ─────────
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
    union all select p.division_id, 'turnkey_projects', count(*)::int from tk_client_projects p where p.status in ('open', 'on_hold')
      and (p_include_test or (not exists (select 1 from tk_client_project_staff s where s.project_id = p.id and s.is_seed)
                              and not exists (select 1 from organizations g where g.id = p.org_id and g.is_seed))) group by 1
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
