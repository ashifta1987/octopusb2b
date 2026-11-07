-- ADDON-41 · 41-B shared parts (decisions 7 Nov 2026: D1 reuse + extend existing tables; D4 role mapping; D6 W-##### wallet reference)
-- Every new table has row-level security. Staff-only tables have no customer policy at all.

-- ───────── roles (D4: owner = admin, buyer = sourcing_agent, finance = finance; new account_manager and warehouse) ─────────
insert into roles(code, name, description, is_staff, sort) values
  ('account_manager', 'Account manager', 'One person per customer across all services; sets each customer''s limits within their own ceiling', true, 9),
  ('warehouse', 'Warehouse', '3PL receiving, put-away, picking, packing and counts; phone scanner', true, 10)
on conflict (code) do nothing;
insert into permission_areas(code, name, sort) values
  ('approvals', 'Approvals & limits', 19), ('warehouse', '3PL warehouse', 20), ('dropship', 'Dropshipping', 21), ('brand', 'Make My Brand', 22)
on conflict (code) do nothing;
with m(role_code, area, actions) as (values
  ('account_manager', 'dashboard', '{view}'), ('account_manager', 'requests', '{view,create,edit}'), ('account_manager', 'orders', '{view,edit}'),
  ('account_manager', 'approvals', '{view,approve}'), ('account_manager', 'support', '{view,create,edit}'), ('account_manager', 'dropship', '{view,edit}'),
  ('account_manager', 'brand', '{view,edit}'), ('account_manager', 'warehouse', '{view}'),
  ('warehouse', 'dashboard', '{view}'), ('warehouse', 'warehouse', '{view,create,edit,approve}'), ('warehouse', 'orders', '{view}'),
  ('finance', 'approvals', '{view}')
)
insert into role_permissions(role_code, area, action) select role_code, area, unnest(actions::text[]) from m on conflict do nothing;

-- Account managers see only their own customers (they get no global customers:view).
create or replace function is_my_customer(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from account_managers am where am.org_id = p_org and am.staff_user_id = auth.uid() and am.is_primary) and staff_aal_ok();
$$;
create or replace function staff_sees_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can('customers', 'view') or is_my_customer(p_org);
$$;
revoke execute on function is_my_customer(uuid), staff_sees_org(uuid) from public, anon;
grant execute on function is_my_customer(uuid), staff_sees_org(uuid) to authenticated, service_role;

-- read access for an account manager to their customers' existing records
do $am$
declare t text;
begin
  foreach t in array array['organizations', 'orders', 'rfqs', 'service_requests', 'wallet_topups', 'documents', 'shipments', 'tickets', 'notifications'] loop
    execute format('drop policy if exists am_read on %I', t);
    execute format('create policy am_read on %I for select to authenticated using (is_my_customer(%s))', t, case when t = 'organizations' then 'id' else 'org_id' end);
  end loop;
end $am$;
drop policy if exists am_read on account_managers;
create policy am_read on account_managers for select to authenticated using (staff_user_id = auth.uid() or org_id in (select my_org_ids()));

-- one primary manager per company
create unique index if not exists account_managers_one_primary on account_managers(org_id) where is_primary;

-- customer membership roles: owner, buyer, viewer
update org_members set member_role = 'owner' where member_role is null or member_role not in ('owner', 'buyer', 'viewer');
alter table org_members alter column member_role set default 'buyer';
alter table org_members drop constraint if exists org_members_role_check;
alter table org_members add constraint org_members_role_check check (member_role in ('owner', 'buyer', 'viewer'));

-- ───────── audit log: append-only + richer columns ─────────
alter table audit_log add column if not exists actor_kind text check (actor_kind in ('customer', 'staff', 'system'));
alter table audit_log add column if not exists org_id uuid;
alter table audit_log add column if not exists service text;
alter table audit_log add column if not exists before jsonb;
alter table audit_log add column if not exists after jsonb;
create index if not exists audit_log_org_idx on audit_log(org_id, created_at desc);

create or replace function audit_log_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.actor_id is null then new.actor_id := auth.uid(); end if;
  if new.actor_kind is null then
    new.actor_kind := case when new.actor_id is null then 'system' when user_is_staff(new.actor_id) then 'staff' else 'customer' end;
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_log_defaults on audit_log;
create trigger trg_audit_log_defaults before insert on audit_log for each row execute function audit_log_defaults();

-- append-only for every role. The one documented exception is erasing a deleted supplier's identity
-- (delete_supplier sets app.audit_erasure for its own transaction).
create or replace function audit_log_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('app.audit_erasure', true), '') = 'on' then return new; end if;
  raise exception 'AUDIT_APPEND_ONLY: audit_log rows cannot be changed or deleted';
end $$;
drop trigger if exists trg_audit_log_append_only on audit_log;
create trigger trg_audit_log_append_only before update or delete on audit_log for each row execute function audit_log_append_only();
drop trigger if exists trg_audit_log_no_truncate on audit_log;
create trigger trg_audit_log_no_truncate before truncate on audit_log for each statement execute function audit_log_append_only();

do $patch$
declare v_def text; v_new text;
begin
  if to_regprocedure('delete_supplier(uuid,text)') is null then return; end if;
  v_def := pg_get_functiondef('delete_supplier(uuid,text)'::regprocedure);
  if position('app.audit_erasure' in v_def) > 0 then return; end if;
  v_new := regexp_replace(v_def, '(\n\s*)update audit_log set details', E'\\1perform set_config(''app.audit_erasure'', ''on'', true);\\1update audit_log set details');
  if v_new = v_def then raise exception 'delete_supplier not patched for audit erasure'; end if;
  execute v_new;
end $patch$;

-- one helper for every section: audit(action, org, service, ref_type, ref_id, before, after)
create or replace function audit(p_action text, p_org uuid, p_service text, p_ref_type text, p_ref_id text, p_before jsonb default null, p_after jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log(actor_id, action, entity, entity_id, org_id, service, before, after, details)
  values (auth.uid(), p_action, p_ref_type, p_ref_id, p_org, p_service, p_before, p_after, null);
$$;
revoke execute on function audit(text, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function audit(text, uuid, text, text, text, jsonb, jsonb) to service_role;

alter table notifications add column if not exists service text;

-- ───────── company services ─────────
create table if not exists company_services (
  org_id uuid not null references organizations(id) on delete cascade,
  service text not null check (service in ('sourcing', 'dropship', 'warehouse', 'brand')),
  status text not null default 'off' check (status in ('off', 'trial', 'on', 'paused')),
  plan text,
  started_at timestamptz,
  ended_at timestamptz,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, service)
);
alter table company_services enable row level security;
drop policy if exists cs_read on company_services;
create policy cs_read on company_services for select to authenticated using (org_id in (select my_org_ids()) or staff_sees_org(org_id));
grant select on company_services to authenticated;
-- every existing company can already source
insert into company_services(org_id, service, status, started_at)
select id, 'sourcing', 'on', created_at from organizations where archived_at is null
on conflict do nothing;

create or replace function set_company_service(p_org uuid, p_service text, p_status text, p_plan text default null) returns void
language plpgsql security definer set search_path = public as $$
declare old company_services;
begin
  if not (can('customers', 'edit') or is_my_customer(p_org)) then raise exception 'FORBIDDEN'; end if;
  select * into old from company_services where org_id = p_org and service = p_service;
  insert into company_services(org_id, service, status, plan, started_at, ended_at, updated_by, updated_at)
  values (p_org, p_service, p_status, p_plan, case when p_status in ('on', 'trial') then now() end, case when p_status = 'off' then now() end, auth.uid(), now())
  on conflict (org_id, service) do update set status = excluded.status, plan = coalesce(excluded.plan, company_services.plan),
    started_at = case when excluded.status in ('on', 'trial') and company_services.status not in ('on', 'trial') then now() else company_services.started_at end,
    ended_at = case when excluded.status = 'off' then now() else null end, updated_by = auth.uid(), updated_at = now();
  perform audit('company_service.set', p_org, p_service, 'company_service', p_org::text || ':' || p_service,
                case when old.org_id is null then null else jsonb_build_object('status', old.status, 'plan', old.plan) end,
                jsonb_build_object('status', p_status, 'plan', p_plan));
end $$;
revoke execute on function set_company_service(uuid, text, text, text) from public, anon;
grant execute on function set_company_service(uuid, text, text, text) to authenticated, service_role;

-- ───────── limits and approvals (staff only) ─────────
create table if not exists manager_limits (           -- the manager's own ceiling, set by the owner
  manager_user_id uuid primary key references auth.users(id) on delete cascade,
  max_amount_cents bigint not null check (max_amount_cents >= 0),
  min_margin_pct numeric(5,2) not null check (min_margin_pct between 0 and 100),
  approver_role text not null default 'admin',
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now()
);
create table if not exists customer_limits (          -- set by the customer's manager, within the manager's ceiling
  org_id uuid primary key references organizations(id) on delete cascade,
  max_order_cents bigint check (max_order_cents >= 0),
  max_month_cents bigint check (max_month_cents >= 0),
  min_margin_pct numeric(5,2) check (min_margin_pct between 0 and 100),
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now()
);
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  service text not null check (service in ('sourcing', 'dropship', 'warehouse', 'brand', 'wallet')),
  ref_type text not null,
  ref_id text not null,
  amount_cents bigint not null default 0,
  currency char(3) not null default 'USD',
  margin_pct numeric(6,2),
  reason text,
  approver text not null check (approver in ('auto', 'manager', 'owner')),
  assigned_to uuid references auth.users(id),
  requested_by uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists approvals_open_idx on approvals(status, approver, created_at);
create unique index if not exists approvals_one_open on approvals(service, ref_type, ref_id) where status = 'pending';

alter table manager_limits enable row level security;
alter table customer_limits enable row level security;
alter table approvals enable row level security;
drop policy if exists ml_read on manager_limits;
create policy ml_read on manager_limits for select to authenticated using (manager_user_id = auth.uid() or is_admin());
drop policy if exists cl_read on customer_limits;
create policy cl_read on customer_limits for select to authenticated using (is_admin() or is_my_customer(org_id));
drop policy if exists ap_read on approvals;
create policy ap_read on approvals for select to authenticated using (is_admin() or is_my_customer(org_id) or can('approvals', 'view'));
grant select on manager_limits, customer_limits, approvals to authenticated;

create or replace function set_manager_limits(p_manager uuid, p_max_amount_cents bigint, p_min_margin_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
declare old manager_limits;
begin
  perform require_step_up();
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from user_roles where user_id = p_manager and role_code = 'account_manager') then raise exception 'NOT_A_MANAGER'; end if;
  select * into old from manager_limits where manager_user_id = p_manager;
  insert into manager_limits(manager_user_id, max_amount_cents, min_margin_pct, set_by, set_at)
  values (p_manager, p_max_amount_cents, p_min_margin_pct, auth.uid(), now())
  on conflict (manager_user_id) do update set max_amount_cents = excluded.max_amount_cents, min_margin_pct = excluded.min_margin_pct, set_by = auth.uid(), set_at = now();
  perform audit('manager_limits.set', null, null, 'manager_limits', p_manager::text,
    case when old.manager_user_id is null then null else jsonb_build_object('max_amount_cents', old.max_amount_cents, 'min_margin_pct', old.min_margin_pct) end,
    jsonb_build_object('max_amount_cents', p_max_amount_cents, 'min_margin_pct', p_min_margin_pct));
end $$;

create or replace function set_customer_limits(p_org uuid, p_max_order_cents bigint, p_max_month_cents bigint, p_min_margin_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
declare ml manager_limits; old customer_limits; v_mgr uuid;
begin
  if not (is_admin() or is_my_customer(p_org)) then raise exception 'FORBIDDEN'; end if;
  if not is_admin() then
    select * into ml from manager_limits where manager_user_id = auth.uid();
    if ml.manager_user_id is null then raise exception 'MANAGER_LIMITS_NOT_SET: ask the owner to set your own approval limit first'; end if;
    if coalesce(p_max_order_cents, 0) > ml.max_amount_cents then raise exception 'ABOVE_MANAGER_LIMIT: the order limit is above your own amount limit'; end if;
    if p_min_margin_pct is not null and p_min_margin_pct < ml.min_margin_pct then raise exception 'BELOW_MANAGER_MARGIN: the minimum margin is below your own minimum'; end if;
  end if;
  select * into old from customer_limits where org_id = p_org;
  insert into customer_limits(org_id, max_order_cents, max_month_cents, min_margin_pct, set_by, set_at)
  values (p_org, p_max_order_cents, p_max_month_cents, p_min_margin_pct, auth.uid(), now())
  on conflict (org_id) do update set max_order_cents = excluded.max_order_cents, max_month_cents = excluded.max_month_cents,
    min_margin_pct = excluded.min_margin_pct, set_by = auth.uid(), set_at = now();
  perform audit('customer_limits.set', p_org, null, 'customer_limits', p_org::text,
    case when old.org_id is null then null else jsonb_build_object('max_order_cents', old.max_order_cents, 'max_month_cents', old.max_month_cents, 'min_margin_pct', old.min_margin_pct) end,
    jsonb_build_object('max_order_cents', p_max_order_cents, 'max_month_cents', p_max_month_cents, 'min_margin_pct', p_min_margin_pct));
end $$;

-- inside the customer's limits AND the manager's ceiling → approved automatically;
-- inside the manager's ceiling → the manager; otherwise (or limits not set) → the owner.
create or replace function request_approval(p_org uuid, p_service text, p_ref_type text, p_ref_id text, p_amount_cents bigint,
                                            p_margin_pct numeric default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cl customer_limits; ml manager_limits; v_mgr uuid; v_who text; v_id uuid; v_status text; v_existing approvals;
begin
  if not (auth.role() = 'service_role' or is_staff()) then raise exception 'FORBIDDEN'; end if;
  select * into v_existing from approvals where service = p_service and ref_type = p_ref_type and ref_id = p_ref_id and status = 'pending';
  if v_existing.id is not null then return jsonb_build_object('id', v_existing.id, 'status', 'pending', 'approver', v_existing.approver); end if;
  select staff_user_id into v_mgr from account_managers where org_id = p_org and is_primary;
  select * into cl from customer_limits where org_id = p_org;
  if v_mgr is not null then select * into ml from manager_limits where manager_user_id = v_mgr; end if;
  if ml.manager_user_id is null then
    v_who := 'owner';                                       -- no manager or no ceiling yet: the owner approves
  elsif p_amount_cents > ml.max_amount_cents or (p_margin_pct is not null and p_margin_pct < ml.min_margin_pct) then
    v_who := 'owner';
  elsif cl.org_id is not null and coalesce(p_amount_cents <= cl.max_order_cents, false) and (p_margin_pct is null or cl.min_margin_pct is null or p_margin_pct >= cl.min_margin_pct) then
    v_who := 'auto';
  else
    v_who := 'manager';
  end if;
  v_status := case when v_who = 'auto' then 'approved' else 'pending' end;
  insert into approvals(org_id, service, ref_type, ref_id, amount_cents, margin_pct, reason, approver, assigned_to, requested_by, status, decided_at, note)
  values (p_org, p_service, p_ref_type, p_ref_id, p_amount_cents, p_margin_pct, p_reason, v_who, case when v_who = 'manager' then v_mgr end, auth.uid(),
          v_status, case when v_who = 'auto' then now() end, case when v_who = 'auto' then 'Within the customer''s limits' end)
  returning id into v_id;
  perform audit('approval.request', p_org, p_service, p_ref_type, p_ref_id, null,
    jsonb_build_object('approval_id', v_id, 'amount_cents', p_amount_cents, 'margin_pct', p_margin_pct, 'approver', v_who, 'status', v_status));
  return jsonb_build_object('id', v_id, 'status', v_status, 'approver', v_who);
end $$;

create or replace function decide_approval(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a approvals;
begin
  if p_decision not in ('approved', 'declined') then raise exception 'BAD_DECISION'; end if;
  select * into a from approvals where id = p_id for update;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if a.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  if not (is_admin() or (a.approver = 'manager' and a.assigned_to = auth.uid() and has_role('account_manager'))) then raise exception 'FORBIDDEN'; end if;
  if p_decision = 'declined' and coalesce(trim(p_note), '') = '' then raise exception 'NOTE_REQUIRED'; end if;
  perform require_step_up();
  update approvals set status = p_decision, decided_by = auth.uid(), decided_at = now(), note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  perform audit('approval.decide', a.org_id, a.service, a.ref_type, a.ref_id, jsonb_build_object('status', 'pending'),
                jsonb_build_object('approval_id', p_id, 'status', p_decision, 'note', p_note));
end $$;
revoke execute on function set_manager_limits(uuid, bigint, numeric), set_customer_limits(uuid, bigint, bigint, numeric),
  request_approval(uuid, text, text, text, bigint, numeric, text), decide_approval(uuid, text, text) from public, anon;
grant execute on function set_manager_limits(uuid, bigint, numeric), set_customer_limits(uuid, bigint, bigint, numeric),
  request_approval(uuid, text, text, text, bigint, numeric, text), decide_approval(uuid, text, text) to authenticated, service_role;

-- ───────── wallet reference (D6) and bank-transfer top-ups ─────────
create sequence if not exists seq_wallet_ref start 10001;
alter table organizations add column if not exists wallet_reference text;
update organizations set wallet_reference = 'W-' || nextval('seq_wallet_ref') where wallet_reference is null;
alter table organizations alter column wallet_reference set default ('W-' || nextval('seq_wallet_ref'));
alter table organizations alter column wallet_reference set not null;
create unique index if not exists organizations_wallet_reference_key on organizations(wallet_reference);

alter table wallet_topups add column if not exists slip_path text;
alter table wallet_topups add column if not exists amount_received_cents bigint;
alter table wallet_topups add column if not exists bank_ref text;
alter table wallet_topups add column if not exists reject_reason text;
alter table wallet_topups add column if not exists confirmed_by uuid references auth.users(id);
alter table wallet_topups add column if not exists confirmed_at timestamptz;
alter table wallet_topups add column if not exists receipt_id uuid references documents(id);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('transfer-slips', 'transfer-slips', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
drop policy if exists "slips upload own org" on storage.objects;
create policy "slips upload own org" on storage.objects for insert to authenticated
  with check (bucket_id = 'transfer-slips' and (storage.foldername(name))[1] = my_org_id()::text);
drop policy if exists "slips read own org or finance" on storage.objects;
create policy "slips read own org or finance" on storage.objects for select to authenticated
  using (bucket_id = 'transfer-slips' and ((storage.foldername(name))[1] = my_org_id()::text or can('wallet', 'approve')));

create or replace function submit_bank_transfer(p_amount_cents bigint, p_slip_path text, p_bank_ref text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org_id(); v_ref text; v_id uuid;
begin
  if not setting_bool('wallet_enabled') then raise exception 'WALLET_DISABLED'; end if;
  if v_org is null or user_is_staff(auth.uid()) then raise exception 'NO_ORG'; end if;
  if p_amount_cents is null or p_amount_cents < 100 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(p_slip_path, '') = '' or split_part(p_slip_path, '/', 1) <> v_org::text then raise exception 'SLIP_REQUIRED'; end if;
  select wallet_reference into v_ref from organizations where id = v_org;
  insert into wallet_topups(org_id, amount_cents, currency, method, reference, status, created_by, slip_path, bank_ref)
  values (v_org, p_amount_cents, 'USD', 'bank_transfer', v_ref, 'pending', auth.uid(), p_slip_path, nullif(trim(coalesce(p_bank_ref, '')), ''))
  returning id into v_id;
  perform audit('wallet.transfer_submitted', v_org, 'wallet', 'wallet_topup', v_id::text, null,
                jsonb_build_object('amount_usd_claimed_cents', p_amount_cents, 'reference', v_ref));
  perform emit_event('wallet.topup_requested', 'wallet_topup', v_id, jsonb_build_object('org_id', v_org, 'currency', 'USD'));
  return v_id;
end $$;

-- finance only: credits the amount ACTUALLY received (not what the customer claimed) and issues a receipt
create or replace function confirm_bank_transfer(p_topup uuid, p_amount_received_cents bigint, p_bank_ref text) returns uuid
language plpgsql security definer set search_path = public as $$
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
  perform post_journal('Bank transfer ' || coalesce(t.reference, '') || ' · ' || trim(p_bank_ref), jsonb_build_array(
    jsonb_build_object('account', cash_account(t.currency), 'debit', p_amount_received_cents, 'credit', 0),
    jsonb_build_object('account', wallet_account(t.org_id, t.currency), 'debit', 0, 'credit', p_amount_received_cents, 'org', t.org_id)
  ), 'topup:' || p_topup, 'topup', 'wallet_topup', p_topup);
  v_no := 'RCT-W-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_invoice')::text, 5, '0');
  insert into documents(org_id, doc_type, number, amount_cents, currency, status, data)
  values (t.org_id, 'receipt', v_no, p_amount_received_cents, t.currency, 'paid',
          jsonb_build_object('kind', 'wallet_topup', 'topup_id', p_topup, 'reference', t.reference, 'bank_ref', trim(p_bank_ref),
                             'claimed_cents', t.amount_cents, 'issuer', 'Hong Kong company'))
  returning id into v_doc;
  update wallet_topups set status = 'credited', amount_received_cents = p_amount_received_cents, bank_ref = trim(p_bank_ref),
         confirmed_by = auth.uid(), confirmed_at = now(), receipt_id = v_doc where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'credited');
  perform audit('wallet.transfer_confirmed', t.org_id, 'wallet', 'wallet_topup', p_topup::text, jsonb_build_object('status', 'pending', 'claimed_cents', t.amount_cents),
                jsonb_build_object('status', 'credited', 'received_cents', p_amount_received_cents, 'bank_ref', trim(p_bank_ref), 'receipt', v_no));
  perform emit_event('wallet.updated', 'wallet_topup', p_topup, jsonb_build_object('org_id', t.org_id, 'currency', t.currency));
  return v_doc;
end $$;

create or replace function reject_bank_transfer(p_topup uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t wallet_topups;
begin
  perform require_step_up();
  if not can('wallet', 'approve') then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into t from wallet_topups where id = p_topup for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status <> 'pending' then raise exception 'INVALID_TRANSITION'; end if;
  update wallet_topups set status = 'failed', reject_reason = trim(p_reason), confirmed_by = auth.uid(), confirmed_at = now() where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'failed', trim(p_reason));
  perform audit('wallet.transfer_rejected', t.org_id, 'wallet', 'wallet_topup', p_topup::text, jsonb_build_object('status', 'pending'),
                jsonb_build_object('status', 'rejected', 'reason', trim(p_reason)));
end $$;
revoke execute on function submit_bank_transfer(bigint, text, text), confirm_bank_transfer(uuid, bigint, text), reject_bank_transfer(uuid, text) from public, anon;
grant execute on function submit_bank_transfer(bigint, text, text), confirm_bank_transfer(uuid, bigint, text), reject_bank_transfer(uuid, text) to authenticated, service_role;

-- ───────── wallet holds (on top of the double-entry ledger) ─────────
-- hold:    wallet → hold:<org>      (balance drops at once)
-- capture: hold:<org> → revenue    release: hold:<org> → wallet    refund: revenue → wallet
create table if not exists wallet_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD',
  service text not null check (service in ('sourcing', 'dropship', 'warehouse', 'brand')),
  ref_type text not null,
  ref_id text not null,
  status text not null default 'open' check (status in ('open', 'captured', 'released', 'expired')),
  captured_cents bigint not null default 0,
  refunded_cents bigint not null default 0,
  stream text,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (service, ref_type, ref_id)
);
create index if not exists wallet_holds_org_idx on wallet_holds(org_id, status);
alter table wallet_holds enable row level security;
drop policy if exists wh_read on wallet_holds;
create policy wh_read on wallet_holds for select to authenticated using (org_id in (select my_org_ids()) or can('wallet', 'view') or is_my_customer(org_id));
grant select on wallet_holds to authenticated;

create or replace function hold_account(p_org uuid, p_currency text default 'USD') returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('hold:' || p_org, p_currency), 'Customer funds on hold · ' || p_currency, 'liability', p_org, p_currency);
$$;

create or replace function place_hold(p_org uuid, p_amount_cents bigint, p_service text, p_ref_type text, p_ref_id text, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare h wallet_holds; v_id uuid; v_cur text := 'USD';
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || p_org, v_cur)));
  select * into h from wallet_holds where service = p_service and ref_type = p_ref_type and ref_id = p_ref_id;
  if h.id is not null then return h.id; end if;                       -- idempotent on the reference
  if wallet_balance(p_org, v_cur) < p_amount_cents then
    raise exception 'INSUFFICIENT_FUNDS: available % needed %', wallet_balance(p_org, v_cur), p_amount_cents using errcode = 'P0001';
  end if;
  insert into wallet_holds(org_id, amount_cents, currency, service, ref_type, ref_id, expires_at, created_by)
  values (p_org, p_amount_cents, v_cur, p_service, p_ref_type, p_ref_id, p_expires_at, auth.uid()) returning id into v_id;
  perform post_journal('Hold · ' || p_service || ' ' || p_ref_type || ' ' || p_ref_id, jsonb_build_array(
    jsonb_build_object('account', wallet_account(p_org, v_cur), 'debit', p_amount_cents, 'credit', 0, 'org', p_org),
    jsonb_build_object('account', hold_account(p_org, v_cur), 'debit', 0, 'credit', p_amount_cents, 'org', p_org)
  ), 'hold:' || v_id, 'hold', 'wallet_hold', v_id);
  perform audit('wallet.hold', p_org, p_service, p_ref_type, p_ref_id, null, jsonb_build_object('hold_id', v_id, 'amount_cents', p_amount_cents));
  return v_id;
end $$;

create or replace function capture_hold(p_hold uuid, p_stream text default null, p_amount_cents bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare h wallet_holds; v_amt bigint; v_stream text;
begin
  select * into h from wallet_holds where id = p_hold for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  if h.status = 'captured' then return; end if;
  if h.status <> 'open' then raise exception 'HOLD_NOT_OPEN'; end if;
  v_amt := coalesce(p_amount_cents, h.amount_cents);
  if v_amt <= 0 or v_amt > h.amount_cents then raise exception 'INVALID_AMOUNT'; end if;
  v_stream := coalesce(p_stream, h.service);
  perform post_journal('Capture · ' || h.service || ' ' || h.ref_type || ' ' || h.ref_id, jsonb_build_array(
    jsonb_build_object('account', hold_account(h.org_id, h.currency), 'debit', h.amount_cents, 'credit', 0, 'org', h.org_id),
    jsonb_build_object('account', revenue_account(v_stream, h.currency), 'debit', 0, 'credit', v_amt),
    jsonb_build_object('account', wallet_account(h.org_id, h.currency), 'debit', 0, 'credit', h.amount_cents - v_amt, 'org', h.org_id)
  ) - (case when h.amount_cents = v_amt then 2 else 99 end), 'capture:' || p_hold, v_stream, 'wallet_hold', p_hold);
  update wallet_holds set status = 'captured', captured_cents = v_amt, stream = v_stream, closed_at = now() where id = p_hold;
  perform audit('wallet.capture', h.org_id, h.service, h.ref_type, h.ref_id, jsonb_build_object('status', 'open'),
                jsonb_build_object('hold_id', p_hold, 'captured_cents', v_amt, 'released_cents', h.amount_cents - v_amt));
end $$;

create or replace function release_hold(p_hold uuid, p_reason text default null, p_expired boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare h wallet_holds;
begin
  select * into h from wallet_holds where id = p_hold for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  if h.status in ('released', 'expired') then return; end if;
  if h.status <> 'open' then raise exception 'HOLD_NOT_OPEN'; end if;
  perform post_journal('Release · ' || h.service || ' ' || h.ref_type || ' ' || h.ref_id, jsonb_build_array(
    jsonb_build_object('account', hold_account(h.org_id, h.currency), 'debit', h.amount_cents, 'credit', 0, 'org', h.org_id),
    jsonb_build_object('account', wallet_account(h.org_id, h.currency), 'debit', 0, 'credit', h.amount_cents, 'org', h.org_id)
  ), 'release:' || p_hold, 'hold', 'wallet_hold', p_hold);
  update wallet_holds set status = case when p_expired then 'expired' else 'released' end, closed_at = now() where id = p_hold;
  perform audit(case when p_expired then 'wallet.hold_expired' else 'wallet.release' end, h.org_id, h.service, h.ref_type, h.ref_id,
                jsonb_build_object('status', 'open'), jsonb_build_object('hold_id', p_hold, 'amount_cents', h.amount_cents, 'reason', p_reason));
end $$;

create or replace function refund_capture(p_hold uuid, p_amount_cents bigint, p_reason text, p_idem text) returns void
language plpgsql security definer set search_path = public as $$
declare h wallet_holds;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if coalesce(p_idem, '') = '' then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists(select 1 from journals where idempotency_key = 'refund:' || p_idem) then return; end if;
  select * into h from wallet_holds where id = p_hold for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  if h.status <> 'captured' then raise exception 'NOT_CAPTURED'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or h.refunded_cents + p_amount_cents > h.captured_cents then raise exception 'INVALID_AMOUNT'; end if;
  perform post_journal('Refund · ' || h.service || ' ' || h.ref_type || ' ' || h.ref_id || ' · ' || p_reason, jsonb_build_array(
    jsonb_build_object('account', revenue_account(h.stream, h.currency), 'debit', p_amount_cents, 'credit', 0),
    jsonb_build_object('account', wallet_account(h.org_id, h.currency), 'debit', 0, 'credit', p_amount_cents, 'org', h.org_id)
  ), 'refund:' || p_idem, h.stream, 'wallet_hold', p_hold);
  update wallet_holds set refunded_cents = refunded_cents + p_amount_cents where id = p_hold;
  perform audit('wallet.refund', h.org_id, h.service, h.ref_type, h.ref_id, null,
                jsonb_build_object('hold_id', p_hold, 'amount_cents', p_amount_cents, 'reason', p_reason));
end $$;

create or replace function expire_holds() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from wallet_holds where status = 'open' and expires_at is not null and expires_at < now() loop
    perform release_hold(r.id, 'expired', true); n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function hold_account(uuid, text), place_hold(uuid, bigint, text, text, text, timestamptz), capture_hold(uuid, text, bigint),
  release_hold(uuid, text, boolean), refund_capture(uuid, bigint, text, text), expire_holds() from public, anon, authenticated;
grant execute on function hold_account(uuid, text), place_hold(uuid, bigint, text, text, text, timestamptz), capture_hold(uuid, text, bigint),
  release_hold(uuid, text, boolean), refund_capture(uuid, bigint, text, text), expire_holds() to service_role;

create or replace function my_wallet_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'reference', o.wallet_reference,
    'available_cents', wallet_balance(o.id, 'USD'),
    'on_hold_cents', coalesce((select sum(amount_cents) from wallet_holds h where h.org_id = o.id and h.status = 'open'), 0),
    'pending_transfers_cents', coalesce((select sum(amount_cents) from wallet_topups t where t.org_id = o.id and t.status = 'pending'), 0))
  from organizations o where o.id = my_org_id();
$$;
revoke execute on function my_wallet_summary() from public, anon;
grant execute on function my_wallet_summary() to authenticated;

-- ───────── invoices: lines from any section ─────────
create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  service text check (service in ('sourcing', 'dropship', 'warehouse', 'brand', 'wallet')),
  description text not null,
  qty numeric(14,3) not null default 1,
  unit_cents bigint not null,
  amount_cents bigint not null,
  ref_type text,
  ref_id text,
  created_at timestamptz not null default now()
);
create index if not exists invoice_lines_doc_idx on invoice_lines(document_id);
alter table invoice_lines enable row level security;
drop policy if exists il_read on invoice_lines;
create policy il_read on invoice_lines for select to authenticated using (
  exists(select 1 from documents d where d.id = document_id and (d.org_id in (select my_org_ids()) or can('finance', 'view') or is_my_customer(d.org_id))));
grant select on invoice_lines to authenticated;

-- ───────── incoming webhooks: checked and recorded once ─────────
create table if not exists webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_event_id text not null,
  topic text,
  received_at timestamptz not null default now(),
  signature_ok boolean not null,
  payload jsonb,
  processed_at timestamptz,
  attempts int not null default 0,
  error text,
  unique (source, external_event_id)
);
alter table webhook_inbox enable row level security;
drop policy if exists wi_read on webhook_inbox;
create policy wi_read on webhook_inbox for select to authenticated using (can('integrations', 'view'));
grant select on webhook_inbox to authenticated;

-- ───────── white-label: customers never read the carrier behind a shipment ─────────
-- (staff screens read it with the service client after their own permission check)
revoke select on shipments from authenticated;
grant select (id, code, order_id, org_id, service_code, tracking_no, label_url, status, weight_kg, parcels, rate_cents, eta, last_event_at, created_at, currency, trace_id, is_seed)
  on shipments to authenticated;

-- staff accounts never act as customers: no staff user may be a member of a customer company
create or replace function guard_staff_not_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if user_is_staff(new.user_id) then raise exception 'STAFF_CANNOT_BE_CUSTOMER: a staff account cannot belong to a customer company'; end if;
  return new;
end $$;
drop trigger if exists trg_guard_staff_not_member on org_members;
create trigger trg_guard_staff_not_member before insert or update of user_id on org_members for each row execute function guard_staff_not_member();

-- (the reverse case — giving a customer account a staff role — is already blocked by trg_customer_not_staff)
