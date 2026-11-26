-- 20261101000243_w6_invoicing_reports_retention.sql
-- Warehouse OS · W6 (monthly 3PL client invoice, warehouse reports, retention jobs). Design: docs/design/warehouse-os
-- §3 step 11 ("one monthly invoice lists every charge"), portal board 22 (Invoices: "monthly statement; every line opens to the
-- orders and movements behind it"), staff board 30 (Reports: "orders shipped, dock-to-shelf time, order-to-handoff time and
-- exceptions, by period and client, with service-quality bars"), packing evidence retention (W3a), D8 (3PL plans are separate
-- from the Dropship processing fee: Dropship orders carry no client and are never on a 3PL invoice).
--  1. Charges per client per month (China time, Asia/Shanghai), computed from real events with the client's rate version IN
--     EFFECT at the event time (warehouse-specific version first, else the plan-wide one; W1 two-person approved versions —
--     'active' or 'superseded', effective_from <= event time):
--       receiving   per carton   — stock notices received in the month (wh_asns.received_at), cartons declared on the notice
--                                  (W2a records no separate carton count); a pallet-only notice has no carton count → "not
--                                  measured — not charged".
--       storage     per pallet-month — pallets owned by the client while 'stored' (wh_pallet_stays, below): pallet-seconds in
--                                  the month ÷ seconds in the month, split at every rate change. There are no pallet volumes, so
--                                  a per-m³ fee is "not measured — not charged". Loose stock in bins without a pallet is not
--                                  charged (no measured basis).
--       pick & pack first item + each extra item — client orders shipped in the month (wh_orders.shipped_at), units packed.
--       packaging   — wh_material_usage of the client in the month, at the unit charge copied at use (W3b; voided uses out).
--       returns     per item — returns inspected in the month at the charge copied at inspection (W5).
--       minimum     — top-up line when the billed total is below the plan's monthly minimum (rate in effect at month end, for
--                     the client's preferred warehouse; active clients, or any client with charges that month).
--     A fee that is not set (NULL, or no rate version in effect) is shown to staff as "not set — not charged" and never billed
--     as 0. Unknown quantities are never 0 either ("not measured").
--  2. Monthly invoice run: warehouse admins and Finance preview (wh_invoice_board / wh_invoice_preview); FINANCE (or an admin)
--     issues (wh_invoice_issue) a proforma through the existing document path — next_document_number('proforma'), documents
--     (service 'warehouse' → 3PL division, revenue stream 'warehouse'), invoice_lines, post_document_receivable (balanced
--     journal), audit 'invoice.issue'. One invoice per client per month (unique; a repeated issue returns the first one), only
--     after the month is over, never for 0. The lines are kept in wh_invoice_lines with the drill-down references (orders,
--     notices, pallets, packaging uses, returns — a snapshot, so the invoice outlives later clean-ups). Packaging uses and
--     returns on the invoice get invoiced_at. The client pays through the existing pay_service_proforma (wallet in the portal;
--     bank transfer recorded by Finance); full payment issues the OCT-3PL tax invoice as for every service proforma.
--  3. Portal (board 22): wh_portal_invoices(org) — the company's statements with lines and references (company members).
--  4. Reports (board 30): wh_report(from, to, warehouse, client) — orders shipped, order-to-handoff hours (created → first
--     hand-over of a non-voided label, else shipped_at), dock-to-shelf hours (first dock check-in → last putaway of the notice's
--     lots once every lot is released and fully placed), exceptions by kind; share within target per warehouse
--     (wh_service_settings; no target = no bar). Real rows only.
--  5. Retention: wh_retention_due() lists files to delete — packing photos past retention_until, return photos of finished
--     returns older than the warehouse's return-photo setting (no setting = kept), product photos and label PDFs no row points
--     at (30 days grace). The cron route removes the files with the Storage API (service role) and wh_retention_mark() marks the
--     rows purged (rows are kept; nothing financial is deleted).
--  Writes only through security-definer functions (set search_path = public; not for public / anon); internals are service-role
--  only. Integer cents. Audit-logged. No existing function is replaced (wipe_demo_data included): new rows hang off
--  organizations / documents / pallets with ON DELETE CASCADE.
-- Down: supabase/migrations/down/20261101000243_w6_invoicing_reports_retention.down.sql

-- ───────── 1. Pallet storage periods ─────────
create table if not exists public.wh_pallet_stays (
  id uuid primary key default gen_random_uuid(),
  pallet_id uuid not null references public.wh_pallets(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz,
  constraint wh_pallet_stays_order check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists wh_pallet_stays_open_idx on public.wh_pallet_stays (pallet_id) where ended_at is null;
create index if not exists wh_pallet_stays_org_idx on public.wh_pallet_stays (org_id, started_at) where org_id is not null;
comment on table public.wh_pallet_stays is 'Warehouse OS W6: when each pallet was stored (status stored → anything else), kept by a trigger on wh_pallets. Basis of the storage charge (pallet-months). Staff only.';
alter table public.wh_pallet_stays enable row level security;
revoke all on public.wh_pallet_stays from public, anon, authenticated;
grant select on public.wh_pallet_stays to authenticated;
grant all on public.wh_pallet_stays to service_role;
drop policy if exists wh_pallet_stays_read on public.wh_pallet_stays;
create policy wh_pallet_stays_read on public.wh_pallet_stays for select to authenticated using (public.wh_sees(warehouse_code));

create or replace function public.wh_pallet_stay_track()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'stored' and (tg_op = 'INSERT' or old.status is distinct from 'stored') then
    insert into public.wh_pallet_stays (pallet_id, org_id, warehouse_code, started_at)
    values (new.id, new.org_id, new.warehouse_code, now())
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'stored' and new.status is distinct from 'stored' then
    update public.wh_pallet_stays set ended_at = now() where pallet_id = new.id and ended_at is null;
  end if;
  return null;
end $$;
revoke all on function public.wh_pallet_stay_track() from public, anon, authenticated;
drop trigger if exists wh_pallet_stay_track on public.wh_pallets;
create trigger wh_pallet_stay_track after insert or update of status on public.wh_pallets
  for each row execute function public.wh_pallet_stay_track();

-- history before W6: start = the pallet's first putaway; end = its last change once it left 'stored' (broken / shipped are final)
insert into public.wh_pallet_stays (pallet_id, org_id, warehouse_code, started_at, ended_at)
select p.id, p.org_id, p.warehouse_code, f.first_at,
       case when p.status in ('broken', 'shipped') then greatest(p.updated_at, f.first_at) end
  from public.wh_pallets p
  cross join lateral (select min(m.created_at) first_at from public.wh_location_moves m where m.pallet_id = p.id and m.kind = 'putaway') f
 where f.first_at is not null and p.status in ('stored', 'broken', 'shipped')
   and not exists (select 1 from public.wh_pallet_stays s where s.pallet_id = p.id);

-- ───────── 2. Service targets and retention settings (per warehouse) ─────────
create table if not exists public.wh_service_settings (
  warehouse_code text primary key references public.warehouses(code) on update cascade on delete restrict,
  dock_to_shelf_target_hours integer check (dock_to_shelf_target_hours is null or dock_to_shelf_target_hours between 1 and 720),
  handoff_target_hours integer check (handoff_target_hours is null or handoff_target_hours between 1 and 720),
  return_photo_retention_days integer check (return_photo_retention_days is null or return_photo_retention_days between 30 and 3650),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.wh_service_settings is 'Warehouse OS W6: service-quality targets (hours; NULL = no target, no bar) and how long return photos are kept after a return is finished (NULL = kept). Staff only.';
alter table public.wh_service_settings enable row level security;
revoke all on public.wh_service_settings from public, anon, authenticated;
grant select (warehouse_code, dock_to_shelf_target_hours, handoff_target_hours, return_photo_retention_days, updated_at) on public.wh_service_settings to authenticated;
grant all on public.wh_service_settings to service_role;
drop policy if exists wh_service_settings_read on public.wh_service_settings;
create policy wh_service_settings_read on public.wh_service_settings for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 3. Retention markers on existing photo rows ─────────
alter table public.wh_pack_evidence add column if not exists purged_at timestamptz;
alter table public.wh_return_photos add column if not exists purged_at timestamptz;
create index if not exists wh_pack_evidence_unpurged_idx on public.wh_pack_evidence (retention_until) where purged_at is null;

-- ───────── 4. Invoices ─────────
create table if not exists public.wh_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  document_id uuid not null unique references public.documents(id) on delete cascade,
  plan_code text not null,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  minimum_cents bigint check (minimum_cents is null or minimum_cents >= 0),
  topup_cents bigint not null default 0 check (topup_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  constraint wh_invoices_total check (total_cents = subtotal_cents + topup_cents),
  constraint wh_invoices_one_per_month unique (org_id, period)
);
comment on table public.wh_invoices is 'Warehouse OS W6: one monthly 3PL invoice per client and month (the proforma in documents). Written by wh_invoice_issue() only; never rewritten.';
alter table public.wh_invoices enable row level security;
revoke all on public.wh_invoices from public, anon, authenticated;
-- customer-safe columns only (who issued it is read by staff through the definer functions)
grant select (id, org_id, period, document_id, plan_code, subtotal_cents, minimum_cents, topup_cents, total_cents, issued_at) on public.wh_invoices to authenticated;
grant all on public.wh_invoices to service_role;

create table if not exists public.wh_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.wh_invoices(id) on delete cascade,
  seq integer not null check (seq >= 1),
  kind text not null check (kind in ('receiving', 'storage', 'pick_first', 'pick_extra', 'materials', 'returns', 'minimum')),
  warehouse_code text,
  description text not null check (btrim(description) <> '' and length(description) <= 300),
  unit_label text,
  qty numeric(14, 4) not null check (qty > 0),
  unit_cents bigint not null check (unit_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  rate_version_id uuid,
  rate_version integer,
  refs jsonb not null default '[]' check (jsonb_typeof(refs) = 'array'),
  document_line_id uuid references public.invoice_lines(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (invoice_id, seq)
);
create index if not exists wh_invoice_lines_invoice_idx on public.wh_invoice_lines (invoice_id, seq);
comment on table public.wh_invoice_lines is 'Warehouse OS W6: lines of a monthly 3PL invoice with the rate version used and a snapshot of the orders / notices / pallets / packaging uses / returns behind each line (refs).';
alter table public.wh_invoice_lines enable row level security;
revoke all on public.wh_invoice_lines from public, anon, authenticated;
grant select on public.wh_invoice_lines to authenticated;
grant all on public.wh_invoice_lines to service_role;

-- who previews / issues
create or replace function public.wh_invoice_can_preview()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and staff_aal_ok() and not distributor_restricted() and (
    is_admin() or can('finance', 'view')
    or exists (select 1 from public.warehouse_staff s where s.user_id = auth.uid() and s.role = 'admin' and s.suspended_at is null))
$$;
revoke all on function public.wh_invoice_can_preview() from public, anon;
grant execute on function public.wh_invoice_can_preview() to authenticated, service_role;

create or replace function public.wh_invoice_can_issue()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and staff_aal_ok() and not distributor_restricted() and (is_admin() or can('finance', 'create'))
$$;
revoke all on function public.wh_invoice_can_issue() from public, anon;
grant execute on function public.wh_invoice_can_issue() to authenticated, service_role;

create or replace function public.wh_invoice_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('preview', public.wh_invoice_can_preview(), 'issue', public.wh_invoice_can_preview() and public.wh_invoice_can_issue())
$$;
revoke all on function public.wh_invoice_access() from public, anon;
grant execute on function public.wh_invoice_access() to authenticated, service_role;

drop policy if exists wh_invoices_read on public.wh_invoices;
create policy wh_invoices_read on public.wh_invoices for select to authenticated
  using (org_id in (select public.my_org_ids()) or public.wh_invoice_can_preview());
drop policy if exists wh_invoice_lines_read on public.wh_invoice_lines;
create policy wh_invoice_lines_read on public.wh_invoice_lines for select to authenticated
  using (exists (select 1 from public.wh_invoices i where i.id = invoice_id));

-- financial records are written once: no updates, no deletes (except together with their document / company)
create or replace function public.wh_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  raise exception 'INVOICE_KEPT: issued 3PL invoices are never changed or deleted';
end $$;
revoke all on function public.wh_invoice_guard() from public, anon, authenticated;
drop trigger if exists wh_invoices_guard on public.wh_invoices;
create trigger wh_invoices_guard before update or delete on public.wh_invoices for each row execute function public.wh_invoice_guard();
drop trigger if exists wh_invoice_lines_guard on public.wh_invoice_lines;
create trigger wh_invoice_lines_guard before update or delete on public.wh_invoice_lines for each row execute function public.wh_invoice_guard();

-- the client's rate version in effect at a moment: warehouse-specific first, else plan-wide (approved versions only)
create or replace function public.wh_rate_at(p_plan text, p_warehouse text, p_at timestamptz)
returns setof public.wh_rate_versions
language sql
stable
security definer
set search_path = public
as $$
  select v.* from public.wh_rate_versions v
   where v.plan_code = p_plan and v.status in ('active', 'superseded') and v.effective_from is not null and v.effective_from <= p_at
     and (v.warehouse_code = p_warehouse or v.warehouse_code is null)
   order by (v.warehouse_code is null), v.effective_from desc
   limit 1
$$;
revoke all on function public.wh_rate_at(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.wh_rate_at(text, text, timestamptz) to service_role;

-- first day of the month of p_month and the month's bounds in China time
create or replace function public.wh_month_start(p_month date)
returns date
language sql
immutable
security definer
set search_path = public
as $$
  select make_date(extract(year from p_month)::integer, extract(month from p_month)::integer, 1)
$$;
revoke all on function public.wh_month_start(date) from public, anon;
grant execute on function public.wh_month_start(date) to authenticated, service_role;

-- every charge of one client and month (internal; previews and the issue use it). Lines: billable / not_set / not_measured.
create or replace function public.wh_invoice_compute(p_org uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.wh_clients;
  v_period date := public.wh_month_start(p_month);
  v_start timestamptz;
  v_end timestamptz;
  v_cut timestamptz;
  v_month_secs numeric;
  v_lines jsonb := '[]';
  v_storage jsonb := '[]';
  v_sub bigint;
  v_min public.wh_rate_versions;
  v_min_applies boolean;
  v_topup bigint := 0;
  v_all jsonb;
begin
  select * into c from public.wh_clients where org_id = p_org;
  if c.org_id is null then raise exception 'NOT_A_CLIENT: this company has no 3PL account'; end if;
  v_start := v_period::timestamp at time zone 'Asia/Shanghai';
  v_end := (v_period + interval '1 month')::timestamp at time zone 'Asia/Shanghai';
  v_cut := least(v_end, now());
  v_month_secs := extract(epoch from (v_end - v_start));

  -- event-based lines (one row per event, then grouped by kind / warehouse / rate version / unit price)
  with shipped_orders as (
    select o.id, o.code, o.external_ref, o.warehouse_code, o.shipped_at,
           coalesce(nullif((select sum(l.packed_qty) from public.wh_order_lines l where l.order_id = o.id), 0),
                    (select sum(greatest(l.qty - l.short_qty, 0)) from public.wh_order_lines l where l.order_id = o.id), 0)::integer units
      from public.wh_orders o
     where o.org_id = p_org and o.source <> 'dropship' and o.shipped_at >= v_start and o.shipped_at < v_end
  ), ev as (
    select 'receiving'::text kind, 1 ord, a.warehouse_code wh, r.id rv_id, r.version rv, ''::text label_key, 'carton'::text unit_label,
           r.receiving_per_carton_cents unit_cents, a.cartons::numeric qty, (a.cartons is null) unmeasured,
           jsonb_build_object('type', 'asn', 'id', a.id, 'code', a.code, 'at', a.received_at, 'qty', a.cartons) ref, a.received_at ev_at
      from public.wh_asns a
      left join lateral public.wh_rate_at(c.plan_code, a.warehouse_code, a.received_at) r on true
     where a.org_id = p_org and a.status = 'received' and a.received_at >= v_start and a.received_at < v_end
    union all
    select 'pick_first', 3, o.warehouse_code, r.id, r.version, '', 'order', r.pick_pack_first_cents, 1::numeric, false,
           jsonb_build_object('type', 'order', 'id', o.id, 'code', o.code, 'ref', o.external_ref, 'at', o.shipped_at, 'qty', 1, 'units', o.units), o.shipped_at
      from shipped_orders o left join lateral public.wh_rate_at(c.plan_code, o.warehouse_code, o.shipped_at) r on true
     where o.units >= 1
    union all
    select 'pick_extra', 4, o.warehouse_code, r.id, r.version, '', 'item', r.pick_pack_extra_cents, (o.units - 1)::numeric, false,
           jsonb_build_object('type', 'order', 'id', o.id, 'code', o.code, 'ref', o.external_ref, 'at', o.shipped_at, 'qty', o.units - 1, 'units', o.units), o.shipped_at
      from shipped_orders o left join lateral public.wh_rate_at(c.plan_code, o.warehouse_code, o.shipped_at) r on true
     where o.units > 1
    union all
    select 'materials', 5, u.warehouse_code, null::uuid, null::integer, m.name, coalesce(nullif(m.unit, ''), 'unit'), u.unit_charge_cents, u.qty::numeric, false,
           jsonb_build_object('type', 'material', 'id', u.id, 'name', m.name, 'order_id', u.order_id, 'order_code', o.code, 'at', u.created_at, 'qty', u.qty), u.created_at
      from public.wh_material_usage u
      join public.wh_materials m on m.id = u.material_id
      left join public.wh_orders o on o.id = u.order_id
     where u.org_id = p_org and u.voided_at is null and u.created_at >= v_start and u.created_at < v_end
    union all
    select 'returns', 6, t.warehouse_code, null::uuid, null::integer, '', 'item', t.charge_per_item_cents, x.units::numeric, false,
           jsonb_build_object('type', 'return', 'id', t.id, 'code', t.code, 'at', t.inspected_at, 'qty', x.units), t.inspected_at
      from public.wh_returns t
      cross join lateral (select coalesce(t.charge_units, (select sum(l.qty) from public.wh_return_lines l where l.return_id = t.id), 0)::integer units) x
     where t.org_id = p_org and t.inspected_at >= v_start and t.inspected_at < v_end and x.units > 0
  ), grp as (
    select kind, ord, wh, rv_id, rv, label_key, unit_label, unit_cents, unmeasured,
           sum(qty) qty, jsonb_agg(ref order by ev_at, ref ->> 'code') refs
      from ev
     group by kind, ord, wh, rv_id, rv, label_key, unit_label, unit_cents, unmeasured
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', g.kind, 'warehouse_code', g.wh, 'label_key', nullif(g.label_key, ''), 'unit_label', g.unit_label,
           'qty', g.qty, 'unit_cents', g.unit_cents, 'rate_version_id', g.rv_id, 'rate_version', g.rv,
           'status', case when g.unmeasured then 'not_measured' when g.unit_cents is null then 'not_set' else 'billable' end,
           'amount_cents', case when g.unmeasured or g.unit_cents is null then null else round(g.unit_cents * g.qty)::bigint end,
           'refs', g.refs,
           'description', case g.kind
              when 'receiving' then 'Receiving per carton'
              when 'pick_first' then 'Pick and pack · first item per order'
              when 'pick_extra' then 'Pick and pack · each extra item'
              when 'materials' then 'Packaging · ' || g.label_key
              when 'returns' then 'Returns handling per item' end
              || ' · ' || coalesce((select w.name from public.warehouses w where w.code = g.wh), g.wh) || ' (' || g.wh || ')',
           'sort', g.ord)
         order by g.ord, g.wh, g.label_key, g.rv nulls first, g.unit_cents nulls first), '[]')
    into v_lines
    from grp g;

  -- storage: pallet-seconds per warehouse and rate version, split at every rate change inside the month
  with st as (
    select s.pallet_id, p.code, s.warehouse_code wh, greatest(s.started_at, v_start) f, least(coalesce(s.ended_at, v_cut), v_cut) t
      from public.wh_pallet_stays s join public.wh_pallets p on p.id = s.pallet_id
     where s.org_id = p_org and s.started_at < v_cut and coalesce(s.ended_at, v_cut) > v_start
  ), whs as (
    select distinct wh from st
  ), pts as (
    select distinct w.wh, x.pt_at
      from whs w
      cross join lateral (
        select v_start pt_at
        union select v_cut
        union select v.effective_from from public.wh_rate_versions v
               where v.plan_code = c.plan_code and v.status in ('active', 'superseded') and v.effective_from > v_start and v.effective_from < v_cut
                 and (v.warehouse_code = w.wh or v.warehouse_code is null)) x
  ), seg as (
    select wh, pt_at s_from, lead(pt_at) over (partition by wh order by pt_at) s_to from pts
  ), piece as (
    select g.wh, g.s_from, st.pallet_id, st.code, greatest(st.f, g.s_from) pf, least(st.t, g.s_to) pt,
           extract(epoch from (least(st.t, g.s_to) - greatest(st.f, g.s_from))) secs
      from seg g join st on st.wh = g.wh and st.f < g.s_to and st.t > g.s_from
     where g.s_to is not null
  ), rated as (
    select pc.*, rv.id rv_id, rv.version rv, rv.storage_per_pallet_month_cents pal, rv.storage_per_cbm_month_cents cbm
      from piece pc left join lateral public.wh_rate_at(c.plan_code, pc.wh, pc.s_from) rv on true
     where pc.secs > 0
  ), grp as (
    select wh, rv_id, rv, pal, cbm, round(sum(secs) / v_month_secs, 4) qty,
           jsonb_agg(jsonb_build_object('type', 'pallet', 'id', pallet_id, 'code', code, 'from', pf, 'to', pt, 'days', round(secs / 86400.0, 2)) order by code, pf) refs
      from rated group by wh, rv_id, rv, pal, cbm
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'storage', 'warehouse_code', g.wh, 'label_key', null, 'unit_label', 'pallet-month', 'qty', g.qty,
           'unit_cents', g.pal, 'rate_version_id', g.rv_id, 'rate_version', g.rv,
           'status', case when g.pal is not null then 'billable' when g.cbm is not null then 'not_measured' else 'not_set' end,
           'amount_cents', case when g.pal is not null then round(g.pal * g.qty)::bigint end,
           'refs', g.refs,
           'description', 'Storage per pallet per month · ' || coalesce((select w.name from public.warehouses w where w.code = g.wh), g.wh) || ' (' || g.wh || ')'
                          || case when g.pal is null and g.cbm is not null then ' — priced per m³, pallet volumes are not measured' else '' end,
           'sort', 2)
         order by g.wh, g.rv nulls first), '[]')
    into v_storage
    from grp g where g.qty > 0;

  select coalesce(jsonb_agg(x order by (x ->> 'sort')::integer, x ->> 'warehouse_code', coalesce(x ->> 'label_key', ''), coalesce((x ->> 'rate_version')::integer, 0)), '[]')
    into v_all
    from jsonb_array_elements(v_lines || v_storage) x;
  select coalesce(sum((x ->> 'amount_cents')::bigint), 0) into v_sub from jsonb_array_elements(v_all) x where x ->> 'status' = 'billable';

  -- monthly minimum: rate in effect at the end of the month (or now) for the client's preferred warehouse
  select * into v_min from public.wh_rate_at(c.plan_code, coalesce(c.preferred_warehouse, public.default_warehouse_code()), least(v_end, now()) - interval '1 second');
  v_min_applies := v_min.min_monthly_cents is not null and c.created_at < v_end and (c.status = 'active' or v_sub > 0);
  if v_min_applies and v_sub < v_min.min_monthly_cents then
    v_topup := v_min.min_monthly_cents - v_sub;
    v_all := v_all || jsonb_build_array(jsonb_build_object(
      'kind', 'minimum', 'warehouse_code', null, 'label_key', null, 'unit_label', 'month', 'qty', 1, 'unit_cents', v_topup,
      'rate_version_id', v_min.id, 'rate_version', v_min.version, 'status', 'billable', 'amount_cents', v_topup, 'refs', '[]'::jsonb,
      'description', 'Monthly minimum top-up (plan minimum ' || to_char(v_min.min_monthly_cents / 100.0, 'FM999,999,990.00') || ' USD)', 'sort', 7));
  end if;

  return jsonb_build_object(
    'org_id', p_org, 'period', v_period, 'plan', c.plan_code, 'client_status', c.status,
    'month_closed', v_end <= now(), 'lines', v_all,
    'subtotal_cents', v_sub,
    'minimum', jsonb_build_object('cents', v_min.min_monthly_cents, 'rate_version', v_min.version, 'applies', v_min_applies,
                                  'status', case when v_min.id is null or v_min.min_monthly_cents is null then 'not_set' else 'set' end),
    'topup_cents', v_topup,
    'total_cents', v_sub + v_topup,
    'unbilled_count', (select count(*) from jsonb_array_elements(v_all) x where x ->> 'status' <> 'billable'));
end $$;
revoke all on function public.wh_invoice_compute(uuid, date) from public, anon, authenticated;
grant execute on function public.wh_invoice_compute(uuid, date) to service_role;

-- an issued invoice with its lines and the document state (internal)
create or replace function public.wh_invoice_json(i public.wh_invoices, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id, 'org_id', i.org_id, 'period', i.period, 'document_id', i.document_id, 'number', d.number, 'status', d.status,
    'amount_cents', d.amount_cents, 'paid_cents', d.paid_cents, 'currency', d.currency, 'issued_at', i.issued_at,
    'subtotal_cents', i.subtotal_cents, 'minimum_cents', i.minimum_cents, 'topup_cents', i.topup_cents, 'total_cents', i.total_cents,
    'tax_invoice', (select jsonb_build_object('id', t.id, 'number', t.number) from public.documents t
                     where t.from_proforma_id = d.id and t.doc_type = 'commercial_invoice' order by t.created_at desc limit 1),
    'issued_by', case when p_staff then (select p.full_name from public.profiles p where p.id = i.issued_by) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'seq', l.seq, 'kind', l.kind, 'warehouse_code', l.warehouse_code,
                         'description', l.description, 'unit_label', l.unit_label, 'qty', l.qty, 'unit_cents', l.unit_cents,
                         'amount_cents', l.amount_cents, 'rate_version', l.rate_version, 'refs', l.refs) order by l.seq)
                        from public.wh_invoice_lines l where l.invoice_id = i.id), '[]'))
    from public.documents d where d.id = i.document_id
$$;
revoke all on function public.wh_invoice_json(public.wh_invoices, boolean) from public, anon, authenticated;
grant execute on function public.wh_invoice_json(public.wh_invoices, boolean) to service_role;

-- staff: every 3PL client for a month with its preview totals and the issued invoice (if any)
create or replace function public.wh_invoice_board(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period date := public.wh_month_start(coalesce(p_month, (now() at time zone 'Asia/Shanghai')::date));
  v_rows jsonb := '[]';
  r record;
  v jsonb;
  i public.wh_invoices;
begin
  if not public.wh_invoice_can_preview() then raise exception 'FORBIDDEN'; end if;
  for r in select c.org_id, o.name, c.plan_code, c.status, c.created_at from public.wh_clients c join public.organizations o on o.id = c.org_id
            where c.created_at < (v_period + interval '1 month')::timestamp at time zone 'Asia/Shanghai'
            order by o.name loop
    select * into i from public.wh_invoices where org_id = r.org_id and period = v_period;
    v := public.wh_invoice_compute(r.org_id, v_period);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'org_id', r.org_id, 'name', r.name, 'plan', r.plan_code, 'status', r.status,
      'subtotal_cents', v -> 'subtotal_cents', 'topup_cents', v -> 'topup_cents', 'total_cents', v -> 'total_cents',
      'billable_count', (select count(*) from jsonb_array_elements(v -> 'lines') x where x ->> 'status' = 'billable'),
      'unbilled_count', v -> 'unbilled_count',
      'invoice', case when i.id is null then null else
        (select jsonb_build_object('id', i.id, 'number', d.number, 'status', d.status, 'amount_cents', d.amount_cents, 'paid_cents', d.paid_cents)
           from public.documents d where d.id = i.document_id) end));
  end loop;
  return jsonb_build_object('period', v_period,
    'month_closed', (v_period + interval '1 month')::timestamp at time zone 'Asia/Shanghai' <= now(),
    'can_issue', public.wh_invoice_can_issue(), 'clients', v_rows);
end $$;
revoke all on function public.wh_invoice_board(date) from public, anon;
grant execute on function public.wh_invoice_board(date) to authenticated, service_role;

-- staff: one client's month — every line (billable, not set, not measured) and the issued invoice
create or replace function public.wh_invoice_preview(p_org uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period date := public.wh_month_start(p_month);
  i public.wh_invoices;
begin
  if not public.wh_invoice_can_preview() then raise exception 'FORBIDDEN'; end if;
  select * into i from public.wh_invoices where org_id = p_org and period = v_period;
  return public.wh_invoice_compute(p_org, v_period) || jsonb_build_object(
    'client', (select o.name from public.organizations o where o.id = p_org),
    'can_issue', public.wh_invoice_can_issue(),
    'invoice', case when i.id is null then null else public.wh_invoice_json(i, true) end);
end $$;
revoke all on function public.wh_invoice_preview(uuid, date) from public, anon;
grant execute on function public.wh_invoice_preview(uuid, date) to authenticated, service_role;

-- Finance issues the month's invoice (idempotent: one per client and month)
create or replace function public.wh_invoice_issue(p_org uuid, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := public.wh_month_start(p_month);
  i public.wh_invoices;
  v jsonb;
  l jsonb;
  n integer := 0;
  v_no text;
  v_doc uuid;
  v_inv uuid;
  v_line uuid;
  v_dline uuid;
  v_total bigint;
begin
  if not public.wh_invoice_can_issue() then raise exception 'FORBIDDEN: Finance issues 3PL invoices'; end if;
  if p_org is null or p_month is null then raise exception 'INVALID_INPUT'; end if;
  if (v_period + interval '1 month')::timestamp at time zone 'Asia/Shanghai' > now() then
    raise exception 'MONTH_NOT_OVER: % can be invoiced from the first day of the next month (China time)', to_char(v_period, 'FMMonth YYYY');
  end if;
  perform pg_advisory_xact_lock(hashtext('wh_invoice:' || p_org::text || ':' || v_period::text));
  select * into i from public.wh_invoices where org_id = p_org and period = v_period;
  if i.id is not null then
    return jsonb_build_object('id', i.id, 'document_id', i.document_id, 'number', (select number from public.documents where id = i.document_id),
                              'total_cents', i.total_cents, 'repeated', true);
  end if;
  v := public.wh_invoice_compute(p_org, v_period);
  v_total := (v ->> 'total_cents')::bigint;
  if v_total <= 0 then raise exception 'NOTHING_TO_BILL: there are no charges for % (fees that are not set are never billed)', to_char(v_period, 'FMMonth YYYY'); end if;

  v_no := next_document_number('proforma');
  insert into public.documents (org_id, doc_type, number, amount_cents, currency, status, data)
  values (p_org, 'proforma_invoice', v_no, v_total, 'USD', 'awaiting_payment',
          jsonb_build_object('service', 'warehouse', 'ref_type', 'wh_invoice', 'ref', to_char(v_period, 'YYYY-MM'),
                             'title', '3PL warehouse · ' || to_char(v_period, 'FMMonth YYYY'),
                             'issuer', (select legal_name from public.company_profile where id = 1)))
  returning id into v_doc;
  insert into public.wh_invoices (org_id, period, document_id, plan_code, subtotal_cents, minimum_cents, topup_cents, total_cents, issued_by)
  values (p_org, v_period, v_doc, v ->> 'plan', (v ->> 'subtotal_cents')::bigint, (v -> 'minimum' ->> 'cents')::bigint,
          (v ->> 'topup_cents')::bigint, v_total, auth.uid())
  returning id into v_inv;
  for l in select x from jsonb_array_elements(v -> 'lines') x where x ->> 'status' = 'billable' and (x ->> 'amount_cents')::bigint > 0 loop
    n := n + 1;
    v_line := gen_random_uuid();
    insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    values (v_doc, 'warehouse', l ->> 'description', (l ->> 'qty')::numeric, (l ->> 'unit_cents')::bigint, (l ->> 'amount_cents')::bigint,
            'wh_invoice_line', v_line::text)
    returning id into v_dline;
    insert into public.wh_invoice_lines (id, invoice_id, seq, kind, warehouse_code, description, unit_label, qty, unit_cents, amount_cents,
                                         rate_version_id, rate_version, refs, document_line_id)
    values (v_line, v_inv, n, l ->> 'kind', l ->> 'warehouse_code', l ->> 'description', l ->> 'unit_label', (l ->> 'qty')::numeric,
            (l ->> 'unit_cents')::bigint, (l ->> 'amount_cents')::bigint, nullif(l ->> 'rate_version_id', '')::uuid,
            nullif(l ->> 'rate_version', '')::integer, coalesce(l -> 'refs', '[]'::jsonb), v_dline);
  end loop;
  if (select coalesce(sum(amount_cents), 0) from public.wh_invoice_lines where invoice_id = v_inv) <> v_total then
    raise exception 'INVOICE_TOTAL_MISMATCH';
  end if;
  perform post_document_receivable(v_doc);
  -- the packaging uses and returns on this invoice
  update public.wh_material_usage set invoiced_at = now()
   where invoiced_at is null and id in (select (r ->> 'id')::uuid from public.wh_invoice_lines wl cross join lateral jsonb_array_elements(wl.refs) r
                                         where wl.invoice_id = v_inv and wl.kind = 'materials');
  update public.wh_returns set invoiced_at = now()
   where invoiced_at is null and id in (select (r ->> 'id')::uuid from public.wh_invoice_lines wl cross join lateral jsonb_array_elements(wl.refs) r
                                         where wl.invoice_id = v_inv and wl.kind = 'returns');
  perform audit('invoice.issue', p_org, 'warehouse', 'document', v_doc::text, null,
                jsonb_build_object('number', v_no, 'amount_cents', v_total, 'ref', to_char(v_period, 'YYYY-MM')));
  perform write_audit('wh_invoice.issued', 'wh_invoices', v_inv::text,
    jsonb_build_object('org_id', p_org, 'period', v_period, 'number', v_no, 'total_cents', v_total, 'lines', n, 'topup_cents', (v ->> 'topup_cents')::bigint));
  return jsonb_build_object('id', v_inv, 'document_id', v_doc, 'number', v_no, 'total_cents', v_total, 'repeated', false);
end $$;
revoke all on function public.wh_invoice_issue(uuid, date) from public, anon;
grant execute on function public.wh_invoice_issue(uuid, date) to authenticated, service_role;

-- client portal: the company's monthly statements (newest first)
create or replace function public.wh_portal_invoices(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (p_org in (select public.my_org_ids()) or public.wh_invoice_can_preview()) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(public.wh_invoice_json(i, false) order by i.period desc) from public.wh_invoices i where i.org_id = p_org), '[]');
end $$;
revoke all on function public.wh_portal_invoices(uuid) from public, anon;
grant execute on function public.wh_portal_invoices(uuid) to authenticated, service_role;

-- ───────── 5. Reports (board 30) ─────────
create or replace function public.wh_save_service_settings(p_warehouse text, p_dock_to_shelf_hours integer, p_handoff_hours integer, p_return_photo_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.wh_service_settings;
begin
  if auth.uid() is null or not (is_staff() and staff_aal_ok() and public.wh_role(p_warehouse) = 'admin') then
    raise exception 'FORBIDDEN: a warehouse admin sets targets and retention';
  end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse) then raise exception 'NOT_FOUND'; end if;
  if (p_dock_to_shelf_hours is not null and p_dock_to_shelf_hours not between 1 and 720)
     or (p_handoff_hours is not null and p_handoff_hours not between 1 and 720) then
    raise exception 'INVALID_TARGET: targets are whole hours from 1 to 720 (leave empty for no target)';
  end if;
  if p_return_photo_days is not null and p_return_photo_days not between 30 and 3650 then
    raise exception 'INVALID_RETENTION: keep return photos 30 to 3650 days (leave empty to keep them)';
  end if;
  select * into v_old from public.wh_service_settings where warehouse_code = p_warehouse;
  insert into public.wh_service_settings (warehouse_code, dock_to_shelf_target_hours, handoff_target_hours, return_photo_retention_days, updated_by, updated_at)
  values (p_warehouse, p_dock_to_shelf_hours, p_handoff_hours, p_return_photo_days, auth.uid(), now())
  on conflict (warehouse_code) do update
    set dock_to_shelf_target_hours = excluded.dock_to_shelf_target_hours, handoff_target_hours = excluded.handoff_target_hours,
        return_photo_retention_days = excluded.return_photo_retention_days, updated_by = excluded.updated_by, updated_at = now();
  perform write_audit('wh_service_settings.saved', 'wh_service_settings', p_warehouse,
    jsonb_build_object('from', case when v_old.warehouse_code is null then null else to_jsonb(v_old) - 'updated_by' - 'updated_at' end,
                       'dock_to_shelf_target_hours', p_dock_to_shelf_hours, 'handoff_target_hours', p_handoff_hours,
                       'return_photo_retention_days', p_return_photo_days));
end $$;
revoke all on function public.wh_save_service_settings(text, integer, integer, integer) from public, anon;
grant execute on function public.wh_save_service_settings(text, integer, integer, integer) to authenticated, service_role;

create or replace function public.wh_report(p_from date, p_to date, p_warehouse text default null, p_org uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v jsonb;
begin
  if auth.uid() is null or not (is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  if p_warehouse is not null and not public.wh_sees(p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if p_warehouse is null and not exists (select 1 from public.warehouses w where public.wh_sees(w.code)) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'INVALID_PERIOD: choose a period of up to one year';
  end if;
  v_start := p_from::timestamp at time zone 'Asia/Shanghai';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Shanghai';

  with whs as (
    select w.code, w.name from public.warehouses w where (p_warehouse is null or w.code = p_warehouse) and public.wh_sees(w.code)
  ), tg as (
    select w.code, s.dock_to_shelf_target_hours d, s.handoff_target_hours h from whs w left join public.wh_service_settings s on s.warehouse_code = w.code
  ), shipped as (
    select o.org_id, o.warehouse_code wh, (select coalesce(sum(l.packed_qty), 0) from public.wh_order_lines l where l.order_id = o.id) units
      from public.wh_orders o
     where o.warehouse_code in (select code from whs) and (p_org is null or o.org_id = p_org)
       and o.shipped_at >= v_start and o.shipped_at < v_end
  ), handoff as (
    select o.org_id, o.warehouse_code wh, extract(epoch from (h.h_at - o.created_at)) / 3600.0 hrs
      from public.wh_orders o
      cross join lateral (select coalesce((select min(s.handed_over_at) from public.wh_shipments s
                                            where s.order_id = o.id and s.status <> 'voided' and s.handed_over_at is not null), o.shipped_at) h_at) h
     where o.warehouse_code in (select code from whs) and (p_org is null or o.org_id = p_org)
       and h.h_at >= v_start and h.h_at < v_end
  ), asn as (
    select a.id, a.org_id, a.warehouse_code wh,
           (select min(d.arrived_at) from public.wh_dock_slots d where d.asn_id = a.id and d.arrived_at is not null) arrived,
           (select case when count(*) > 0 and bool_and(l.status = 'released' and coalesce(pa.placed, 0) >= l.qty) then max(pa.last_at) end
              from public.wh_lots l join public.wh_asn_lines al on al.id = l.asn_line_id
              left join lateral (select sum(m.qty) placed, max(m.created_at) last_at from public.wh_location_moves m
                                  where m.lot_id = l.id and m.kind = 'putaway') pa on true
             where al.asn_id = a.id) shelved
      from public.wh_asns a
     where a.warehouse_code in (select code from whs) and (p_org is null or a.org_id = p_org) and a.status in ('arrived', 'receiving', 'received')
  ), d2s as (
    select org_id, wh, extract(epoch from (shelved - arrived)) / 3600.0 hrs from asn
     where arrived is not null and shelved is not null and shelved >= v_start and shelved < v_end
  ), d2s_open as (
    select org_id, wh from asn where arrived is not null and arrived >= v_start and arrived < v_end and shelved is null
  ), exc as (
    select e.org_id, e.warehouse_code wh, e.kind from public.wh_exceptions e
     where e.warehouse_code in (select code from whs) and (p_org is null or e.org_id = p_org) and e.created_at >= v_start and e.created_at < v_end
  ), keys as (
    select org_id, wh from shipped union select org_id, wh from handoff union select org_id, wh from d2s
    union select org_id, wh from d2s_open union select org_id, wh from exc
  ), rows_ as (
    select k.org_id, k.wh,
           coalesce((select o.name from public.organizations o where o.id = k.org_id), 'Octopus stock') client,
           (select w.name from whs w where w.code = k.wh) wh_name,
           (select count(*) from shipped s where s.org_id is not distinct from k.org_id and s.wh = k.wh) orders_shipped,
           (select coalesce(sum(units), 0) from shipped s where s.org_id is not distinct from k.org_id and s.wh = k.wh) units_shipped,
           (select jsonb_build_object('n', count(*), 'avg_h', round(avg(x.hrs)::numeric, 1),
                     'median_h', round((percentile_cont(0.5) within group (order by x.hrs))::numeric, 1),
                     'target_h', max(t.h), 'measured', count(*) filter (where t.h is not null),
                     'within', count(*) filter (where t.h is not null and x.hrs <= t.h))
              from handoff x left join tg t on t.code = x.wh where x.org_id is not distinct from k.org_id and x.wh = k.wh) handoff,
           (select jsonb_build_object('n', count(*), 'avg_h', round(avg(x.hrs)::numeric, 1),
                     'median_h', round((percentile_cont(0.5) within group (order by x.hrs))::numeric, 1),
                     'target_h', max(t.d), 'measured', count(*) filter (where t.d is not null),
                     'within', count(*) filter (where t.d is not null and x.hrs <= t.d),
                     'open', (select count(*) from d2s_open y where y.org_id is not distinct from k.org_id and y.wh = k.wh))
              from d2s x left join tg t on t.code = x.wh where x.org_id is not distinct from k.org_id and x.wh = k.wh) dock_to_shelf,
           (select jsonb_build_object('total', coalesce(sum(z.n), 0), 'by_kind', coalesce(jsonb_object_agg(z.kind, z.n), '{}'))
              from (select e.kind, count(*) n from exc e where e.org_id is not distinct from k.org_id and e.wh = k.wh group by e.kind) z) exceptions
      from keys k
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'warehouse', p_warehouse, 'org_id', p_org,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('org_id', r.org_id, 'client', r.client, 'warehouse_code', r.wh, 'warehouse', r.wh_name,
                        'orders_shipped', r.orders_shipped, 'units_shipped', r.units_shipped, 'handoff', r.handoff,
                        'dock_to_shelf', r.dock_to_shelf,
                        'exceptions', jsonb_build_object('total', coalesce((r.exceptions ->> 'total')::integer, 0), 'by_kind', coalesce(r.exceptions -> 'by_kind', '{}')))
                        order by r.client, r.wh) from rows_ r), '[]'),
    'totals', jsonb_build_object(
      'orders_shipped', (select count(*) from shipped), 'units_shipped', (select coalesce(sum(units), 0) from shipped),
      'handoff', (select jsonb_build_object('n', count(*), 'avg_h', round(avg(x.hrs)::numeric, 1),
                    'median_h', round((percentile_cont(0.5) within group (order by x.hrs))::numeric, 1),
                    'measured', count(*) filter (where t.h is not null), 'within', count(*) filter (where t.h is not null and x.hrs <= t.h))
                    from handoff x left join tg t on t.code = x.wh),
      'dock_to_shelf', (select jsonb_build_object('n', count(*), 'avg_h', round(avg(x.hrs)::numeric, 1),
                    'median_h', round((percentile_cont(0.5) within group (order by x.hrs))::numeric, 1),
                    'measured', count(*) filter (where t.d is not null), 'within', count(*) filter (where t.d is not null and x.hrs <= t.d),
                    'open', (select count(*) from d2s_open))
                    from d2s x left join tg t on t.code = x.wh),
      'exceptions', jsonb_build_object('total', (select count(*) from exc),
                    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from exc group by kind) z), '{}'))),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('warehouse_code', t.code, 'warehouse', w.name, 'dock_to_shelf_hours', t.d, 'handoff_hours', t.h) order by w.name)
                           from tg t join whs w on w.code = t.code), '[]'),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('org_id', c.org_id, 'name', o.name) order by o.name)
                           from public.wh_clients c join public.organizations o on o.id = c.org_id), '[]'))
    into v;
  return v;
end $$;
revoke all on function public.wh_report(date, date, text, uuid) from public, anon;
grant execute on function public.wh_report(date, date, text, uuid) to authenticated, service_role;

-- ───────── 6. Retention ─────────
-- staff: what the job keeps and removes, per warehouse (or every warehouse the caller sees)
create or replace function public.wh_retention_summary(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not (is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  if p_warehouse is not null and not public.wh_sees(p_warehouse) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'warehouse_code', w.code, 'warehouse', w.name,
      'evidence_retention_days', (select r.retention_days from public.wh_settings_for(w.code) r),
      'return_photo_retention_days', (select s.return_photo_retention_days from public.wh_service_settings s where s.warehouse_code = w.code),
      'dock_to_shelf_target_hours', (select s.dock_to_shelf_target_hours from public.wh_service_settings s where s.warehouse_code = w.code),
      'handoff_target_hours', (select s.handoff_target_hours from public.wh_service_settings s where s.warehouse_code = w.code),
      'can_edit', public.wh_role(w.code) = 'admin' and staff_aal_ok(),
      'evidence_due', (select count(*) from public.wh_pack_evidence e where e.warehouse_code = w.code and e.purged_at is null and e.retention_until < now()),
      'evidence_purged', (select count(*) from public.wh_pack_evidence e where e.warehouse_code = w.code and e.purged_at is not null),
      'return_photos_due', (select count(*) from public.wh_return_photos p join public.wh_returns r on r.id = p.return_id
                              join public.wh_service_settings s on s.warehouse_code = r.warehouse_code
                             where r.warehouse_code = w.code and p.purged_at is null and r.status = 'done' and s.return_photo_retention_days is not null
                               and r.done_at < now() - make_interval(days => s.return_photo_retention_days)),
      'return_photos_purged', (select count(*) from public.wh_return_photos p where p.warehouse_code = w.code and p.purged_at is not null))
    order by w.is_default desc, w.name)
    from public.warehouses w where (p_warehouse is null or w.code = p_warehouse) and public.wh_sees(w.code) and w.status <> 'legacy'), '[]');
end $$;
revoke all on function public.wh_retention_summary(text) from public, anon;
grant execute on function public.wh_retention_summary(text) to authenticated, service_role;

-- service role (cron): files to remove now. kind: evidence | return_photo (rows marked purged afterwards) | product_orphan | label_orphan
create or replace function public.wh_retention_due(p_limit integer default 500)
returns table (kind text, id uuid, bucket text, path text)
language sql
stable
security definer
set search_path = public
as $$
  (select 'evidence'::text, e.id, 'wh-evidence'::text, e.storage_path
     from public.wh_pack_evidence e where e.purged_at is null and e.retention_until < now()
    order by e.retention_until limit greatest(coalesce(p_limit, 500), 1))
  union all
  (select 'return_photo', p.id, 'wh-returns', p.storage_path
     from public.wh_return_photos p join public.wh_returns r on r.id = p.return_id
     join public.wh_service_settings s on s.warehouse_code = r.warehouse_code
    where p.purged_at is null and r.status = 'done' and s.return_photo_retention_days is not null
      and r.done_at < now() - make_interval(days => s.return_photo_retention_days)
    order by r.done_at limit greatest(coalesce(p_limit, 500), 1))
  union all
  (select 'product_orphan', o.id, 'wh-products', o.name
     from storage.objects o
    where o.bucket_id = 'wh-products' and o.created_at < now() - interval '30 days'
      and not exists (select 1 from public.wh_client_skus k where k.image_path = o.name)
    order by o.created_at limit greatest(coalesce(p_limit, 500), 1))
  union all
  (select 'label_orphan', o.id, 'wh-labels', o.name
     from storage.objects o
    where o.bucket_id = 'wh-labels' and o.created_at < now() - interval '30 days'
      and not exists (select 1 from public.wh_shipments s where s.label_path = o.name)
    order by o.created_at limit greatest(coalesce(p_limit, 500), 1))
$$;
revoke all on function public.wh_retention_due(integer) from public, anon, authenticated;
grant execute on function public.wh_retention_due(integer) to service_role;

-- service role (cron): marks rows whose files were removed. p_items = [{kind, id}]; returns counts
create or replace function public.wh_retention_mark(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev integer;
  v_rp integer;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  update public.wh_pack_evidence set purged_at = now()
   where purged_at is null and retention_until < now()
     and id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_items) x where x ->> 'kind' = 'evidence');
  get diagnostics v_ev = row_count;
  update public.wh_return_photos set purged_at = now()
   where purged_at is null
     and id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_items) x where x ->> 'kind' = 'return_photo');
  get diagnostics v_rp = row_count;
  if v_ev + v_rp > 0 or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    perform write_audit('wh_retention.purged', 'storage', null,
      jsonb_build_object('evidence', v_ev, 'return_photos', v_rp,
                         'product_orphans', (select count(*) from jsonb_array_elements(p_items) x where x ->> 'kind' = 'product_orphan'),
                         'label_orphans', (select count(*) from jsonb_array_elements(p_items) x where x ->> 'kind' = 'label_orphan')));
  end if;
  return jsonb_build_object('evidence', v_ev, 'return_photos', v_rp);
end $$;
revoke all on function public.wh_retention_mark(jsonb) from public, anon, authenticated;
grant execute on function public.wh_retention_mark(jsonb) to service_role;
