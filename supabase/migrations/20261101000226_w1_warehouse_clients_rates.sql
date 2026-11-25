-- 20261101000226_w1_warehouse_clients_rates.sql
-- Warehouse OS · W1 (docs/design/warehouse-os boards 25, 27, 26, 28; matched to the written design).
--  1. wh_applications: the public "Apply for an account" form (APP-0001…). Batteries/liquids need a safety data sheet.
--     Submitted through wh_submit_application() (signed out allowed; basic abuse limits). Reply promise: one working day.
--  2. Staff review (Clients and applications): four checks (documents, dangerous goods, terms sent, rate plan chosen);
--     approve stays refused until every check is done; decline needs a reason. Approval switches the 3PL service on for
--     the applicant's company when an account with that email exists; otherwise it links on first sign-in.
--  3. wh_clients: approved 3PL clients (company, plan, preferred warehouse, status).
--  4. Client price plans (Standard / Volume / Custom) as versions per plan and optional warehouse; two-person approval
--     (D7: proposed by a warehouse admin / admin, approved by a different admin). Unknown fees stay empty, never 0.
-- Down: supabase/migrations/down/20261101000226_w1_warehouse_clients_rates.down.sql

create sequence if not exists public.seq_wh_application;

-- the public intro page and the Apply form list the active warehouses (name, city, contact, hours; not the street address,
-- which approved clients see in their portal)
grant select (code, name, country, province, city, email, phone, hours, timezone, status, is_default) on public.warehouses to anon;
drop policy if exists warehouses_public_read on public.warehouses;
create policy warehouses_public_read on public.warehouses for select to anon using (status = 'active');

create table if not exists public.wh_applications (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('APP-' || lpad(nextval('public.seq_wh_application')::text, 4, '0')),
  company text not null check (btrim(company) <> '' and length(company) <= 200),
  contact_name text not null check (btrim(contact_name) <> '' and length(contact_name) <= 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  sells text not null check (btrim(sells) <> '' and length(sells) <= 500),
  orders_band text not null check (orders_band in ('under_100', '100_500', '500_2000', 'over_2000')),
  channels text[] not null default '{}',
  stock_route text not null check (stock_route in ('octopus_b2b', 'make_my_brand', 'own_supplier', 'mixed')),
  has_batteries boolean not null default false,
  has_liquids boolean not null default false,
  preferred_warehouse text references public.warehouses(code) on update cascade on delete restrict,
  status text not null default 'new' check (status in ('new', 'in_review', 'approved', 'declined')),
  check_documents boolean not null default false,
  check_dangerous_goods boolean not null default false,
  check_terms_sent boolean not null default false,
  plan_code text,
  decline_reason text,
  reviewed_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  org_id uuid references public.organizations(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_applications_decline_reason check (status <> 'declined' or nullif(btrim(coalesce(decline_reason, '')), '') is not null),
  constraint wh_applications_approved_checks check (status <> 'approved' or (check_documents and check_dangerous_goods and check_terms_sent and plan_code is not null))
);
create index if not exists wh_applications_status_idx on public.wh_applications (status, created_at desc);
create index if not exists wh_applications_email_idx on public.wh_applications (lower(email));
comment on table public.wh_applications is 'Warehouse OS: 3PL account applications (public Apply form). Written through wh_* functions only.';
alter table public.wh_applications enable row level security;
revoke all on public.wh_applications from public, anon, authenticated;
grant select on public.wh_applications to authenticated;
grant all on public.wh_applications to service_role;
drop policy if exists wh_applications_staff_read on public.wh_applications;
create policy wh_applications_staff_read on public.wh_applications for select to authenticated
  using (is_staff() and not distributor_restricted() and (is_admin() or can('warehouse', 'view') or exists (select 1 from public.warehouse_staff s where s.user_id = auth.uid() and s.suspended_at is null)));

create table if not exists public.wh_rate_plans (
  code text primary key check (code in ('standard', 'volume', 'custom')),
  name text not null,
  description text,
  sort integer not null default 0
);
insert into public.wh_rate_plans (code, name, description, sort) values
  ('standard', 'Standard', 'Pay as you go. No minimum order and no minimum stock.', 1),
  ('volume', 'Volume', 'Lower handling fees for steady monthly volumes.', 2),
  ('custom', 'Custom', 'Agreed with you for special products or large volumes.', 3)
on conflict (code) do nothing;
alter table public.wh_rate_plans enable row level security;
revoke all on public.wh_rate_plans from public, anon, authenticated;
grant select on public.wh_rate_plans to anon, authenticated;
grant all on public.wh_rate_plans to service_role;
drop policy if exists wh_rate_plans_read on public.wh_rate_plans;
create policy wh_rate_plans_read on public.wh_rate_plans for select to anon, authenticated using (true);
alter table public.wh_applications add constraint wh_applications_plan_fk foreign key (plan_code) references public.wh_rate_plans(code);

create table if not exists public.wh_clients (
  org_id uuid primary key references public.organizations(id) on delete restrict,
  plan_code text not null references public.wh_rate_plans(code),
  preferred_warehouse text references public.warehouses(code) on update cascade on delete restrict,
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  application_id uuid references public.wh_applications(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.wh_clients is 'Warehouse OS: approved 3PL clients (company, plan, preferred warehouse).';
alter table public.wh_clients enable row level security;
revoke all on public.wh_clients from public, anon, authenticated;
grant select on public.wh_clients to authenticated;
grant all on public.wh_clients to service_role;
drop policy if exists wh_clients_read on public.wh_clients;
create policy wh_clients_read on public.wh_clients for select to authenticated
  using ((is_staff() and not distributor_restricted()) or org_id in (select my_org_ids()));

-- client fees per plan (and optionally per warehouse); integer cents; NULL = not set (shown as "Not set")
create table if not exists public.wh_rate_versions (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null references public.wh_rate_plans(code),
  warehouse_code text references public.warehouses(code) on update cascade on delete restrict,
  version integer not null check (version >= 1),
  receiving_per_carton_cents bigint check (receiving_per_carton_cents is null or receiving_per_carton_cents >= 0),
  storage_per_pallet_month_cents bigint check (storage_per_pallet_month_cents is null or storage_per_pallet_month_cents >= 0),
  storage_per_cbm_month_cents bigint check (storage_per_cbm_month_cents is null or storage_per_cbm_month_cents >= 0),
  pick_pack_first_cents bigint check (pick_pack_first_cents is null or pick_pack_first_cents >= 0),
  pick_pack_extra_cents bigint check (pick_pack_extra_cents is null or pick_pack_extra_cents >= 0),
  returns_per_item_cents bigint check (returns_per_item_cents is null or returns_per_item_cents >= 0),
  min_monthly_cents bigint check (min_monthly_cents is null or min_monthly_cents >= 0),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'active', 'superseded', 'rejected')),
  note text,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  effective_from timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  constraint wh_rate_versions_two_person check (approved_by is null or approved_by <> proposed_by),
  constraint wh_rate_versions_active_approved check (status <> 'active' or (approved_by is not null and effective_from is not null))
);
create unique index if not exists wh_rate_versions_one_active_idx on public.wh_rate_versions (plan_code, coalesce(warehouse_code, '*')) where status = 'active';
create unique index if not exists wh_rate_versions_version_idx on public.wh_rate_versions (plan_code, coalesce(warehouse_code, '*'), version);
comment on table public.wh_rate_versions is 'Warehouse OS: client price plans (versions; two-person approval; warehouse_code NULL = all warehouses).';
alter table public.wh_rate_versions enable row level security;
revoke all on public.wh_rate_versions from public, anon, authenticated;
-- public columns only; who proposed/approved, the internal note and reject reason are read by staff through wh_list_rate_versions()
grant select (id, plan_code, warehouse_code, version, receiving_per_carton_cents, storage_per_pallet_month_cents, storage_per_cbm_month_cents,
  pick_pack_first_cents, pick_pack_extra_cents, returns_per_item_cents, min_monthly_cents, status, effective_from, created_at)
  on public.wh_rate_versions to anon, authenticated;
grant all on public.wh_rate_versions to service_role;
drop policy if exists wh_rate_versions_read on public.wh_rate_versions;
-- active prices are public (the intro page Billing section and the client portal); proposals are staff-only
create policy wh_rate_versions_read on public.wh_rate_versions for select to anon, authenticated
  using (status = 'active' or (is_staff() and not distributor_restricted()));

-- ───────── Apply (public) ─────────
create or replace function public.wh_submit_application(
  p_company text, p_contact_name text, p_email text, p_phone text, p_country text, p_sells text, p_orders_band text,
  p_channels text[], p_stock_route text, p_has_batteries boolean, p_has_liquids boolean, p_preferred_warehouse text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_recent integer;
  v_row public.wh_applications;
  v_wh text := nullif(btrim(coalesce(p_preferred_warehouse, '')), '');
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL: enter a valid work email'; end if;
  if v_email ~* '@(gmail|yahoo|hotmail|outlook|icloud|qq|163)\.' then raise exception 'WORK_EMAIL_REQUIRED: use your company email address'; end if;
  select count(*) into v_recent from public.wh_applications where lower(email) = v_email and created_at > now() - interval '1 day';
  if v_recent >= 3 then raise exception 'TOO_MANY_APPLICATIONS: we already have your application; we reply within one working day'; end if;
  if (select count(*) from public.wh_applications where created_at > now() - interval '1 hour') > 200 then
    raise exception 'TRY_LATER: please try again in an hour';
  end if;
  if v_wh is not null and not exists (select 1 from public.warehouses where code = v_wh and status = 'active') then
    raise exception 'INVALID_WAREHOUSE';
  end if;
  insert into public.wh_applications (company, contact_name, email, phone, country, sells, orders_band, channels, stock_route,
    has_batteries, has_liquids, preferred_warehouse, submitted_by)
  values (btrim(p_company), btrim(p_contact_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''), nullif(upper(btrim(coalesce(p_country, ''))), ''),
    btrim(p_sells), p_orders_band, coalesce(p_channels, '{}'), p_stock_route, coalesce(p_has_batteries, false), coalesce(p_has_liquids, false),
    v_wh, auth.uid())
  returning * into v_row;
  perform write_audit('wh_application.submitted', 'wh_applications', v_row.id::text, jsonb_build_object('code', v_row.code, 'email', v_email));
  return jsonb_build_object('code', v_row.code, 'safety_data_sheet', v_row.has_batteries or v_row.has_liquids);
end $$;
revoke all on function public.wh_submit_application(text, text, text, text, text, text, text, text[], text, boolean, boolean, text) from public;
grant execute on function public.wh_submit_application(text, text, text, text, text, text, text, text[], text, boolean, boolean, text) to anon, authenticated, service_role;

-- ───────── Review (staff) ─────────
create or replace function public.wh_can_manage_clients()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and staff_aal_ok() and (
    is_admin() or exists (select 1 from public.warehouse_staff s where s.user_id = auth.uid() and s.role = 'admin' and s.suspended_at is null))
$$;
revoke all on function public.wh_can_manage_clients() from public, anon;
grant execute on function public.wh_can_manage_clients() to authenticated, service_role;

create or replace function public.wh_review_application(p_id uuid, p_documents boolean, p_dangerous_goods boolean, p_terms_sent boolean, p_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_applications;
begin
  if not public.wh_can_manage_clients() then raise exception 'FORBIDDEN: only warehouse admins review applications'; end if;
  select * into v from public.wh_applications where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if v.status in ('approved', 'declined') then raise exception 'APPLICATION_DECIDED'; end if;
  if p_plan is not null and not exists (select 1 from public.wh_rate_plans where code = p_plan) then raise exception 'INVALID_PLAN'; end if;
  update public.wh_applications
     set check_documents = coalesce(p_documents, false), check_dangerous_goods = coalesce(p_dangerous_goods, false),
         check_terms_sent = coalesce(p_terms_sent, false), plan_code = p_plan, status = 'in_review', reviewed_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform write_audit('wh_application.reviewed', 'wh_applications', p_id::text,
    jsonb_build_object('documents', p_documents, 'dangerous_goods', p_dangerous_goods, 'terms_sent', p_terms_sent, 'plan', p_plan));
end $$;
revoke all on function public.wh_review_application(uuid, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.wh_review_application(uuid, boolean, boolean, boolean, text) to authenticated, service_role;

-- links an approved application to the company of an account with the same email (now or at first sign-in)
create or replace function public.wh_link_application(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_applications;
  v_org uuid;
  v_saved_claims text;
begin
  select * into v from public.wh_applications where id = p_id and status = 'approved';
  if v.id is null then return null; end if;
  select m.org_id into v_org
    from public.profiles p join public.org_members m on m.user_id = p.id
   where lower(p.email) = lower(v.email)
   order by (m.member_role = 'owner') desc, m.created_at
   limit 1;
  if v_org is null then return null; end if;
  insert into public.wh_clients (org_id, plan_code, preferred_warehouse, application_id, approved_by)
  values (v_org, v.plan_code, coalesce(v.preferred_warehouse, public.default_warehouse_code()), v.id, v.reviewed_by)
  on conflict (org_id) do nothing;
  -- switching the 3PL service on is a system step of the approval (the approver may be warehouse staff outside the
  -- 3PL division), so it runs without the caller's claims (same pattern as step 4's dropship_products insert)
  v_saved_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into public.company_services (org_id, service, status, division_id) values (v_org, 'warehouse', 'on', division_id_of('3PL'))
    on conflict (org_id, service) do update set status = 'on';
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
  update public.wh_applications set org_id = v_org, updated_at = now() where id = v.id and org_id is null;
  perform write_audit('wh_client.linked', 'wh_clients', v_org::text, jsonb_build_object('application', v.code));
  return v_org;
end $$;
revoke all on function public.wh_link_application(uuid) from public, anon, authenticated;
grant execute on function public.wh_link_application(uuid) to service_role;

create or replace function public.wh_decide_application(p_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_applications;
  v_org uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.wh_can_manage_clients() then raise exception 'FORBIDDEN: only warehouse admins decide applications'; end if;
  select * into v from public.wh_applications where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if v.status in ('approved', 'declined') then raise exception 'APPLICATION_DECIDED'; end if;
  if p_decision = 'decline' then
    if v_reason is null then raise exception 'REASON_REQUIRED: enter why the application is declined'; end if;
    update public.wh_applications set status = 'declined', decline_reason = v_reason, reviewed_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
    perform write_audit('wh_application.declined', 'wh_applications', p_id::text, jsonb_build_object('code', v.code, 'reason', v_reason));
    return jsonb_build_object('status', 'declined');
  elsif p_decision = 'approve' then
    if not (v.check_documents and v.check_dangerous_goods and v.check_terms_sent and v.plan_code is not null) then
      raise exception 'CHECKS_NOT_DONE: tick every check and choose a rate plan first';
    end if;
    update public.wh_applications set status = 'approved', reviewed_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
    v_org := public.wh_link_application(p_id);
    perform write_audit('wh_application.approved', 'wh_applications', p_id::text, jsonb_build_object('code', v.code, 'org_id', v_org, 'plan', v.plan_code));
    return jsonb_build_object('status', 'approved', 'org_id', v_org, 'linked', v_org is not null);
  end if;
  raise exception 'INVALID_DECISION';
end $$;
revoke all on function public.wh_decide_application(uuid, text, text) from public, anon;
grant execute on function public.wh_decide_application(uuid, text, text) to authenticated, service_role;

-- a signed-in customer whose email has an approved application gets the portal (first sign-in after approval)
create or replace function public.wh_claim_my_application()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then return null; end if;
  select a.id into v_id from public.wh_applications a join public.profiles p on lower(p.email) = lower(a.email)
   where p.id = auth.uid() and a.status = 'approved' and a.org_id is null
   order by a.decided_at desc limit 1;
  if v_id is null then return null; end if;
  return public.wh_link_application(v_id);
end $$;
revoke all on function public.wh_claim_my_application() from public, anon;
grant execute on function public.wh_claim_my_application() to authenticated, service_role;

-- ───────── Rates (two-person) ─────────
create or replace function public.wh_propose_rates(
  p_plan text, p_warehouse text, p_receiving bigint, p_storage_pallet bigint, p_storage_cbm bigint,
  p_pick_first bigint, p_pick_extra bigint, p_returns bigint, p_min_monthly bigint, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ver integer;
  v_id uuid;
  v_wh text := nullif(btrim(coalesce(p_warehouse, '')), '');
begin
  if not public.wh_can_manage_clients() then raise exception 'FORBIDDEN: only warehouse admins propose client rates'; end if;
  if not exists (select 1 from public.wh_rate_plans where code = p_plan) then raise exception 'INVALID_PLAN'; end if;
  if v_wh is not null and not exists (select 1 from public.warehouses where code = v_wh and status in ('active', 'paused')) then raise exception 'INVALID_WAREHOUSE'; end if;
  if least(coalesce(p_receiving, 0), coalesce(p_storage_pallet, 0), coalesce(p_storage_cbm, 0), coalesce(p_pick_first, 0), coalesce(p_pick_extra, 0), coalesce(p_returns, 0), coalesce(p_min_monthly, 0)) < 0 then
    raise exception 'INVALID_RATES: fees cannot be negative';
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.wh_rate_versions where plan_code = p_plan and coalesce(warehouse_code, '*') = coalesce(v_wh, '*');
  insert into public.wh_rate_versions (plan_code, warehouse_code, version, receiving_per_carton_cents, storage_per_pallet_month_cents, storage_per_cbm_month_cents,
    pick_pack_first_cents, pick_pack_extra_cents, returns_per_item_cents, min_monthly_cents, note, proposed_by)
  values (p_plan, v_wh, v_ver, p_receiving, p_storage_pallet, p_storage_cbm, p_pick_first, p_pick_extra, p_returns, p_min_monthly,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  perform write_audit('wh_rates.proposed', 'wh_rate_versions', v_id::text, jsonb_build_object('plan', p_plan, 'warehouse', v_wh, 'version', v_ver));
  return v_id;
end $$;
revoke all on function public.wh_propose_rates(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.wh_propose_rates(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text) to authenticated, service_role;

create or replace function public.wh_decide_rates(p_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_rate_versions;
begin
  if auth.uid() is null or not (is_admin() and staff_aal_ok()) then raise exception 'FORBIDDEN: an admin approves client rates'; end if;
  select * into v from public.wh_rate_versions where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'pending_approval' then raise exception 'RATES_NOT_PENDING'; end if;
  if p_decision = 'reject' then
    if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.wh_rate_versions set status = 'rejected', reject_reason = btrim(p_reason) where id = p_id;
    perform write_audit('wh_rates.rejected', 'wh_rate_versions', p_id::text, jsonb_build_object('reason', p_reason));
    return;
  end if;
  if p_decision <> 'approve' then raise exception 'INVALID_DECISION'; end if;
  if v.proposed_by = auth.uid() then raise exception 'TWO_PERSON_REQUIRED: you can''t approve rates you proposed'; end if;
  update public.wh_rate_versions set status = 'superseded'
   where status = 'active' and plan_code = v.plan_code and coalesce(warehouse_code, '*') = coalesce(v.warehouse_code, '*');
  update public.wh_rate_versions set status = 'active', approved_by = auth.uid(), effective_from = now() where id = p_id;
  perform write_audit('wh_rates.approved', 'wh_rate_versions', p_id::text, jsonb_build_object('plan', v.plan_code, 'warehouse', v.warehouse_code, 'version', v.version));
end $$;
revoke all on function public.wh_decide_rates(uuid, text, text) from public, anon;
grant execute on function public.wh_decide_rates(uuid, text, text) to authenticated, service_role;

-- staff list of every rate version, with who proposed/approved and the internal note (column grants hide these from the public)
create or replace function public.wh_list_rate_versions()
returns setof public.wh_rate_versions
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not (is_staff() and not distributor_restricted()
     and (is_admin() or can('warehouse', 'view') or exists (select 1 from public.warehouse_staff s where s.user_id = auth.uid() and s.suspended_at is null))) then
    raise exception 'FORBIDDEN';
  end if;
  return query select * from public.wh_rate_versions order by created_at desc;
end $$;
revoke all on function public.wh_list_rate_versions() from public, anon;
grant execute on function public.wh_list_rate_versions() to authenticated, service_role;
