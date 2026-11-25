-- 20261101000223_w0_warehouse_foundation.sql
-- Warehouse OS · W0 (multi-warehouse foundation). Design: docs/design/warehouse-os (boards 1, 8, 31; text, no board files).
--  1. warehouses: every China location (Foshan FS-01 = default; SZ-01 kept as legacy because stock rows use it).
--     warehouse_stock / warehouse_stock_movements / dropship_handoffs reference it; their defaults use the default warehouse.
--  2. warehouse_staff: one role per person per warehouse (packer / receiver / supervisor / admin), suspend / restore.
--  3. wh_role_capabilities: what each role can do (board 31 table) — wh_can(action, warehouse) reads it.
--  4. Admin-only location management; warehouse admins (and company admins) manage staff. Everything audit-logged.
--  5. wh_dashboard(): the day at a glance + connections (board 1), per warehouse or all.
-- Down: supabase/migrations/down/20261101000223_w0_warehouse_foundation.down.sql

-- ───────── 1. Locations ─────────
create table if not exists public.warehouses (
  code text primary key check (code ~ '^[A-Z]{2,4}-[0-9]{2}$'),
  name text not null check (btrim(name) <> ''),
  country char(2) not null default 'CN' check (country ~ '^[A-Z]{2}$'),
  province text,
  city text not null check (btrim(city) <> ''),
  address text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  hours text,
  timezone text not null default 'Asia/Shanghai',
  status text not null default 'active' check (status in ('active', 'paused', 'closed', 'legacy')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint warehouses_default_active check (not is_default or status = 'active')
);
create unique index if not exists warehouses_one_default_idx on public.warehouses ((true)) where is_default;
comment on table public.warehouses is 'Warehouse OS: China warehouse locations. Changed only through wh_* functions (admin), audit-logged.';

insert into public.warehouses (code, name, province, city, email, hours, status, is_default)
values ('FS-01', 'Foshan', 'Guangdong', 'Foshan', 'foshan@octopusb2b.com', '08:00–18:00 China time', 'active', true)
on conflict (code) do nothing;
insert into public.warehouses (code, name, province, city, hours, status, is_default)
values ('SZ-01', 'Shenzhen (legacy)', 'Guangdong', 'Shenzhen', null, 'legacy', false)
on conflict (code) do nothing;
-- any other warehouse code already used by stock rows is kept as a legacy location (no row is rewritten)
insert into public.warehouses (code, name, city, status)
select distinct s.warehouse_id, s.warehouse_id || ' (legacy)', 'Unknown', 'legacy'
  from (select warehouse_id from public.warehouse_stock
        union select warehouse_id from public.warehouse_stock_movements
        union select warehouse_id from public.dropship_handoffs where warehouse_id is not null) s
 where s.warehouse_id ~ '^[A-Z]{2,4}-[0-9]{2}$'
on conflict (code) do nothing;

alter table public.warehouses enable row level security;
revoke all on public.warehouses from public, anon, authenticated;
-- column-level: who changed a location (updated_by) is not shown outside the audit log
grant select (code, name, country, province, city, address, email, phone, hours, timezone, status, is_default, created_at, updated_at) on public.warehouses to authenticated;
grant all on public.warehouses to service_role;
drop policy if exists warehouses_read on public.warehouses;
-- staff see every location; customers see active locations (the portal and Apply list them; W1)
create policy warehouses_read on public.warehouses for select to authenticated
  using (is_staff() or status = 'active');

create or replace function public.default_warehouse_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select code from public.warehouses where is_default limit 1), 'FS-01')
$$;
revoke all on function public.default_warehouse_code() from public, anon;
grant execute on function public.default_warehouse_code() to authenticated, service_role;

alter table public.warehouse_stock alter column warehouse_id set default public.default_warehouse_code();
alter table public.warehouse_stock_movements alter column warehouse_id set default public.default_warehouse_code();
alter table public.warehouse_stock drop constraint if exists warehouse_stock_warehouse_fk;
alter table public.warehouse_stock add constraint warehouse_stock_warehouse_fk
  foreign key (warehouse_id) references public.warehouses(code) on update cascade on delete restrict;
alter table public.warehouse_stock_movements drop constraint if exists warehouse_stock_movements_warehouse_fk;
alter table public.warehouse_stock_movements add constraint warehouse_stock_movements_warehouse_fk
  foreign key (warehouse_id) references public.warehouses(code) on update cascade on delete restrict;
alter table public.dropship_handoffs drop constraint if exists dropship_handoffs_warehouse_fk;
alter table public.dropship_handoffs add constraint dropship_handoffs_warehouse_fk
  foreign key (warehouse_id) references public.warehouses(code) on update cascade on delete restrict;

-- 212's handoff receipt: the default warehouse instead of the hard-coded 'SZ-01'; only active locations receive
create or replace function public.receive_sourcing_handoff_at_3pl(
  p_handoff_id uuid,
  p_warehouse_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ho public.dropship_handoffs;
  v_wh text := coalesce(nullif(btrim(p_warehouse_id), ''), public.default_warehouse_code());
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit() or (is_staff() and in_division(division_id_of('SRC')))) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.warehouses where code = v_wh and status = 'active') then
    raise exception 'WAREHOUSE_NOT_ACTIVE: % is not an active warehouse', v_wh;
  end if;

  select * into v_ho from public.dropship_handoffs where id = p_handoff_id for update;
  if v_ho.id is null or v_ho.handoff_type <> 'sourcing_procurement' then
    raise exception 'NOT_FOUND';
  end if;

  update public.dropship_handoffs
     set warehouse_id = v_wh,
         updated_at = now()
   where id = p_handoff_id;

  perform public.emit_dropship_domain_event(
    'sourcing_handoff.received_at_3pl',
    'dropship_handoff',
    v_ho.id,
    'handoff:' || v_ho.id::text || ':received_at_3pl',
    jsonb_build_object('handoff_id', v_ho.id, 'store_order_id', v_ho.store_order_id, 'warehouse_id', v_wh),
    division_id_of('3PL'),
    false
  );

  perform public.process_dropship_domain_events(25);
  perform write_audit('dropship.handoff_received_at_3pl', 'dropship_handoffs', v_ho.id::text,
    jsonb_build_object('store_order_id', v_ho.store_order_id, 'warehouse_id', v_wh));

  return jsonb_build_object('ok', true, 'handoff_id', v_ho.id, 'warehouse_id', v_wh);
end $$;
revoke all on function public.receive_sourcing_handoff_at_3pl(uuid, text) from public, anon;
grant execute on function public.receive_sourcing_handoff_at_3pl(uuid, text) to authenticated, service_role;

-- ───────── 2–3. Staff roles per warehouse + capabilities ─────────
create table if not exists public.wh_role_capabilities (
  role text not null check (role in ('packer', 'receiver', 'supervisor', 'admin')),
  action text not null,
  label text not null,
  sort integer not null default 0,
  primary key (role, action)
);
comment on table public.wh_role_capabilities is 'Warehouse OS: what each warehouse role can do (Users and roles table). Packers cannot approve overrides or counts; only admins change rates, carrier rules or users.';
insert into public.wh_role_capabilities (role, action, label, sort)
select r, a, l, s from (values
  ('view', 'See the warehouse screens', 1),
  ('receive', 'Receive deliveries and count cartons', 2),
  ('pick', 'Pick orders', 3),
  ('pack', 'Pack orders with proof', 4),
  ('putaway', 'Put away and move stock', 5),
  ('approve_override', 'Approve weight overrides (PIN)', 6),
  ('approve_count', 'Approve counts and unblock lots', 7),
  ('resolve_exception', 'Resolve exceptions and release orders', 8),
  ('manage_staff', 'Add, suspend and restore people', 9),
  ('manage_rates', 'Propose client rates', 10),
  ('manage_carrier_rules', 'Propose carrier rules', 11)
) as caps(a, l, s)
cross join lateral (
  select unnest(case
    when a in ('view') then array['packer', 'receiver', 'supervisor', 'admin']
    when a in ('pick', 'pack') then array['packer', 'supervisor', 'admin']
    when a in ('receive', 'putaway') then array['receiver', 'supervisor', 'admin']
    when a in ('approve_override', 'approve_count', 'resolve_exception') then array['supervisor', 'admin']
    else array['admin']
  end) as r
) roles
on conflict do nothing;
alter table public.wh_role_capabilities enable row level security;
revoke all on public.wh_role_capabilities from public, anon, authenticated;
grant select on public.wh_role_capabilities to authenticated;
grant all on public.wh_role_capabilities to service_role;
drop policy if exists wh_role_capabilities_read on public.wh_role_capabilities;
create policy wh_role_capabilities_read on public.wh_role_capabilities for select to authenticated using (is_staff());

create table if not exists public.warehouse_staff (
  user_id uuid not null references auth.users(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  role text not null check (role in ('packer', 'receiver', 'supervisor', 'admin')),
  suspended_at timestamptz,
  suspended_by uuid references auth.users(id) on delete set null,
  suspend_reason text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, warehouse_code),
  constraint warehouse_staff_suspend_reason check (suspended_at is null or nullif(btrim(coalesce(suspend_reason, '')), '') is not null)
);
create index if not exists warehouse_staff_wh_idx on public.warehouse_staff (warehouse_code);
comment on table public.warehouse_staff is 'Warehouse OS: one role per person per warehouse. Written only through wh_* functions; audit-logged.';
alter table public.warehouse_staff enable row level security;
revoke all on public.warehouse_staff from public, anon, authenticated;
grant select (user_id, warehouse_code, role, suspended_at, suspend_reason, created_at, updated_at) on public.warehouse_staff to authenticated;
grant all on public.warehouse_staff to service_role;
drop policy if exists warehouse_staff_read on public.warehouse_staff;
create policy warehouse_staff_read on public.warehouse_staff for select to authenticated
  using (is_staff() and not distributor_restricted());

-- existing 3PL & Shipping division members keep their access, at the default warehouse
insert into public.warehouse_staff (user_id, warehouse_code, role)
select m.user_id, public.default_warehouse_code(),
       case m.role when 'manager' then 'supervisor' else 'packer' end
  from public.division_members m
 where m.division_id = division_id_of('3PL') and m.role in ('manager', 'staff', 'warehouse')
on conflict do nothing;

-- the caller's role at a warehouse (company admins = admin everywhere); NULL when none or suspended
create or replace function public.wh_role(p_warehouse text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when is_admin() then 'admin'
    else (select s.role from public.warehouse_staff s
           where s.user_id = auth.uid() and s.warehouse_code = p_warehouse and s.suspended_at is null)
  end
$$;
revoke all on function public.wh_role(text) from public, anon;
grant execute on function public.wh_role(text) to authenticated, service_role;

create or replace function public.wh_can(p_action text, p_warehouse text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_staff() and staff_aal_ok() and exists (
    select 1 from public.wh_role_capabilities c
     where c.role = public.wh_role(p_warehouse) and c.action = p_action
  )
$$;
revoke all on function public.wh_can(text, text) from public, anon;
grant execute on function public.wh_can(text, text) to authenticated, service_role;

-- warehouses the caller works in (company admins and company-wide 3PL viewers: all)
create or replace function public.wh_my_warehouses()
returns table (code text, name text, city text, status text, is_default boolean, role text)
language sql
stable
security definer
set search_path = public
as $$
  select w.code, w.name, w.city, w.status, w.is_default,
         coalesce(public.wh_role(w.code), case when can('warehouse', 'view') then 'viewer' end)
    from public.warehouses w
   where is_staff() and not distributor_restricted()
     and (is_admin() or can('warehouse', 'view') or public.wh_role(w.code) is not null)
   order by w.is_default desc, w.status = 'active' desc, w.name
$$;
revoke all on function public.wh_my_warehouses() from public, anon;
grant execute on function public.wh_my_warehouses() to authenticated, service_role;

create or replace function public.wh_add_staff(p_email text, p_warehouse text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_role text := lower(btrim(coalesce(p_role, '')));
begin
  if not public.wh_can('manage_staff', p_warehouse) then raise exception 'FORBIDDEN: only a warehouse admin can add people'; end if;
  if v_role not in ('packer', 'receiver', 'supervisor', 'admin') then raise exception 'INVALID_ROLE'; end if;
  if v_role = 'admin' and not is_admin() then raise exception 'FORBIDDEN: only a company admin can make someone a warehouse admin'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then
    raise exception 'WAREHOUSE_NOT_OPEN: people are added only to active or paused warehouses';
  end if;
  select p.id into v_user from public.profiles p where lower(p.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_user is null or not exists (
    select 1 from public.user_roles r where r.user_id = v_user
      and r.role_code in ('admin', 'operations', 'finance', 'support', 'sourcing_agent', 'qc_coordinator', 'content_editor', 'account_manager', 'warehouse')
  ) then
    raise exception 'NOT_STAFF: no staff account with this email; create the staff account first in Admin › Staff & roles';
  end if;
  if exists (select 1 from public.warehouse_staff where user_id = v_user and warehouse_code = p_warehouse) then
    raise exception 'ALREADY_ADDED: this person already works at this warehouse; change their role instead';
  end if;
  insert into public.warehouse_staff (user_id, warehouse_code, role, added_by) values (v_user, p_warehouse, v_role, auth.uid());
  perform write_audit('warehouse_staff.added', 'warehouse_staff', v_user::text, jsonb_build_object('warehouse', p_warehouse, 'role', v_role));
  return jsonb_build_object('user_id', v_user, 'warehouse', p_warehouse, 'role', v_role);
end $$;
revoke all on function public.wh_add_staff(text, text, text) from public, anon;
grant execute on function public.wh_add_staff(text, text, text) to authenticated, service_role;

create or replace function public.wh_set_staff_role(p_user uuid, p_warehouse text, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_role text := lower(btrim(coalesce(p_role, '')));
begin
  if not public.wh_can('manage_staff', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if v_role not in ('packer', 'receiver', 'supervisor', 'admin') then raise exception 'INVALID_ROLE'; end if;
  select role into v_old from public.warehouse_staff where user_id = p_user and warehouse_code = p_warehouse for update;
  if v_old is null then raise exception 'NOT_FOUND'; end if;
  if (v_role = 'admin' or v_old = 'admin') and not is_admin() then raise exception 'FORBIDDEN: only a company admin can change a warehouse admin'; end if;
  if p_user = auth.uid() then raise exception 'FORBIDDEN: you cannot change your own role'; end if;
  update public.warehouse_staff set role = v_role, updated_at = now() where user_id = p_user and warehouse_code = p_warehouse;
  perform write_audit('warehouse_staff.role_changed', 'warehouse_staff', p_user::text, jsonb_build_object('warehouse', p_warehouse, 'from', v_old, 'to', v_role));
end $$;
revoke all on function public.wh_set_staff_role(uuid, text, text) from public, anon;
grant execute on function public.wh_set_staff_role(uuid, text, text) to authenticated, service_role;

create or replace function public.wh_suspend_staff(p_user uuid, p_warehouse text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.warehouse_staff;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.wh_can('manage_staff', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why this person is suspended'; end if;
  if p_user = auth.uid() then raise exception 'FORBIDDEN: you cannot suspend yourself'; end if;
  select * into v_row from public.warehouse_staff where user_id = p_user and warehouse_code = p_warehouse for update;
  if v_row.user_id is null then raise exception 'NOT_FOUND'; end if;
  if v_row.role = 'admin' and not is_admin() then raise exception 'FORBIDDEN: only a company admin can suspend a warehouse admin'; end if;
  if v_row.suspended_at is not null then raise exception 'ALREADY_SUSPENDED'; end if;
  update public.warehouse_staff set suspended_at = now(), suspended_by = auth.uid(), suspend_reason = v_reason, updated_at = now()
   where user_id = p_user and warehouse_code = p_warehouse;
  perform write_audit('warehouse_staff.suspended', 'warehouse_staff', p_user::text, jsonb_build_object('warehouse', p_warehouse, 'reason', v_reason));
end $$;
revoke all on function public.wh_suspend_staff(uuid, text, text) from public, anon;
grant execute on function public.wh_suspend_staff(uuid, text, text) to authenticated, service_role;

create or replace function public.wh_restore_staff(p_user uuid, p_warehouse text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.warehouse_staff;
begin
  if not public.wh_can('manage_staff', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.warehouse_staff where user_id = p_user and warehouse_code = p_warehouse for update;
  if v_row.user_id is null then raise exception 'NOT_FOUND'; end if;
  if v_row.suspended_at is null then raise exception 'NOT_SUSPENDED'; end if;
  update public.warehouse_staff set suspended_at = null, suspended_by = null, suspend_reason = null, updated_at = now()
   where user_id = p_user and warehouse_code = p_warehouse;
  perform write_audit('warehouse_staff.restored', 'warehouse_staff', p_user::text, jsonb_build_object('warehouse', p_warehouse));
end $$;
revoke all on function public.wh_restore_staff(uuid, text) from public, anon;
grant execute on function public.wh_restore_staff(uuid, text) to authenticated, service_role;

create or replace function public.wh_list_staff(p_warehouse text default null)
returns table (user_id uuid, full_name text, email text, warehouse_code text, warehouse_name text, role text,
               suspended_at timestamptz, suspend_reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return query
    select s.user_id, p.full_name, p.email, s.warehouse_code, w.name, s.role, s.suspended_at, s.suspend_reason, s.created_at
      from public.warehouse_staff s
      join public.warehouses w on w.code = s.warehouse_code
      left join public.profiles p on p.id = s.user_id
     where (p_warehouse is null or s.warehouse_code = p_warehouse)
       and (is_admin() or can('warehouse', 'view') or public.wh_role(s.warehouse_code) is not null)
     order by w.name, s.suspended_at nulls first, p.full_name;
end $$;
revoke all on function public.wh_list_staff(text) from public, anon;
grant execute on function public.wh_list_staff(text) to authenticated, service_role;

-- ───────── 4. Locations (admin) ─────────
create or replace function public.wh_save_location(
  p_code text, p_name text, p_province text, p_city text, p_address text, p_email text, p_phone text,
  p_hours text, p_timezone text default 'Asia/Shanghai'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_old public.warehouses;
begin
  if auth.uid() is null or not (is_admin() and staff_aal_ok()) then raise exception 'FORBIDDEN: only an admin can manage warehouse locations'; end if;
  if v_code !~ '^[A-Z]{2,4}-[0-9]{2}$' then raise exception 'INVALID_CODE: use letters, a dash and two digits, e.g. GZ-01'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or nullif(btrim(coalesce(p_city, '')), '') is null then
    raise exception 'INVALID_LOCATION: name and city are required';
  end if;
  select * into v_old from public.warehouses where code = v_code for update;
  if v_old.code is null then
    insert into public.warehouses (code, name, province, city, address, email, phone, hours, timezone, status, updated_by)
    values (v_code, btrim(p_name), nullif(btrim(coalesce(p_province, '')), ''), btrim(p_city), nullif(btrim(coalesce(p_address, '')), ''),
            nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_hours, '')), ''),
            coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), 'Asia/Shanghai'), 'active', auth.uid());
    perform write_audit('warehouse.created', 'warehouses', v_code, jsonb_build_object('name', p_name, 'city', p_city));
  else
    if v_old.status = 'closed' then raise exception 'WAREHOUSE_CLOSED: a closed warehouse is kept as history and cannot be edited'; end if;
    update public.warehouses
       set name = btrim(p_name), province = nullif(btrim(coalesce(p_province, '')), ''), city = btrim(p_city),
           address = nullif(btrim(coalesce(p_address, '')), ''), email = nullif(btrim(coalesce(p_email, '')), ''),
           phone = nullif(btrim(coalesce(p_phone, '')), ''), hours = nullif(btrim(coalesce(p_hours, '')), ''),
           timezone = coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), timezone), updated_at = now(), updated_by = auth.uid()
     where code = v_code;
    perform write_audit('warehouse.updated', 'warehouses', v_code,
      jsonb_build_object('from', to_jsonb(v_old) - 'updated_at' - 'updated_by', 'name', p_name, 'city', p_city, 'address', p_address));
  end if;
  return v_code;
end $$;
revoke all on function public.wh_save_location(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.wh_save_location(text, text, text, text, text, text, text, text, text) to authenticated, service_role;

create or replace function public.wh_set_location_status(p_code text, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.warehouses;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_units bigint;
begin
  if auth.uid() is null or not (is_admin() and staff_aal_ok()) then raise exception 'FORBIDDEN'; end if;
  if v_status not in ('active', 'paused', 'closed') then raise exception 'INVALID_STATUS'; end if;
  select * into v_old from public.warehouses where code = upper(btrim(p_code)) for update;
  if v_old.code is null then raise exception 'NOT_FOUND'; end if;
  if v_old.status = 'closed' then raise exception 'WAREHOUSE_CLOSED: closed warehouses stay closed'; end if;
  if v_old.is_default and v_status <> 'active' then raise exception 'DEFAULT_WAREHOUSE: choose another default warehouse first'; end if;
  if v_status <> 'active' and nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED'; end if;
  if v_status = 'closed' then
    select coalesce(sum(on_hand_qty), 0) into v_units from public.warehouse_stock where warehouse_id = v_old.code;
    if v_units > 0 then raise exception 'WAREHOUSE_HAS_STOCK: move the % unit(s) out before closing', v_units; end if;
  end if;
  update public.warehouses set status = v_status, updated_at = now(), updated_by = auth.uid() where code = v_old.code;
  perform write_audit('warehouse.status_changed', 'warehouses', v_old.code, jsonb_build_object('from', v_old.status, 'to', v_status, 'reason', p_reason));
end $$;
revoke all on function public.wh_set_location_status(text, text, text) from public, anon;
grant execute on function public.wh_set_location_status(text, text, text) to authenticated, service_role;

create or replace function public.wh_set_default(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text := public.default_warehouse_code();
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if auth.uid() is null or not (is_admin() and staff_aal_ok()) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.warehouses where code = v_code and status = 'active') then
    raise exception 'WAREHOUSE_NOT_ACTIVE: only an active warehouse can be the default';
  end if;
  update public.warehouses set is_default = false, updated_at = now(), updated_by = auth.uid() where is_default and code <> v_code;
  update public.warehouses set is_default = true, updated_at = now(), updated_by = auth.uid() where code = v_code;
  perform write_audit('warehouse.default_changed', 'warehouses', v_code, jsonb_build_object('from', v_old, 'to', v_code));
end $$;
revoke all on function public.wh_set_default(text) from public, anon;
grant execute on function public.wh_set_default(text) to authenticated, service_role;

-- ───────── 5. Dashboard (board 1) ─────────
-- Unknown stays NULL (never 0). p_warehouse NULL = all warehouses the caller works in.
create or replace function public.wh_dashboard(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not (is_staff() and not distributor_restricted()
          and (is_admin() or can('warehouse', 'view') or exists (select 1 from public.wh_my_warehouses()))) then
    raise exception 'FORBIDDEN';
  end if;
  select jsonb_build_object(
    'warehouse', p_warehouse,
    'units_on_hand', (select coalesce(sum(on_hand_qty), 0) from public.warehouse_stock where p_warehouse is null or warehouse_id = p_warehouse),
    'units_reserved', (select coalesce(sum(reserved_qty), 0) from public.warehouse_stock where p_warehouse is null or warehouse_id = p_warehouse),
    'movements_today', (select count(*) from public.warehouse_stock_movements
                          where (p_warehouse is null or warehouse_id = p_warehouse) and created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'),
    'handoffs_open', (select count(*) from public.dropship_handoffs
                        where status not in ('shipped', 'cancelled') and (p_warehouse is null or warehouse_id = p_warehouse or warehouse_id is null)),
    'handoffs_exception', (select count(*) from public.dropship_handoffs
                        where status = 'exception' and (p_warehouse is null or warehouse_id = p_warehouse or warehouse_id is null)),
    -- shipments are not tied to a warehouse until W3; these counts are company-wide
    'shipments_open', (select count(*) from public.shipments where status in ('created', 'label_ready', 'picked_up', 'in_transit', 'out_for_delivery')),
    'shipments_exception', (select count(*) from public.shipments where status = 'exception'),
    'outbox', jsonb_build_object(
      'pending', (select count(*) from public.domain_events where db_status in ('pending', 'retry')),
      'dead', (select count(*) from public.domain_events where db_status = 'dead'),
      'last_processed_at', (select max(processed_at) from public.domain_events)
    )
  ) into v;
  return v;
end $$;
revoke all on function public.wh_dashboard(text) from public, anon;
grant execute on function public.wh_dashboard(text) to authenticated, service_role;
