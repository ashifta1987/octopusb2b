-- Divisions step 2a (19 Nov 2026): Octopus B2B's six services become DIVISIONS of one legal company,
-- Shenzhen Octopus Trading Co., Ltd. Reference tables only — nothing here changes who can see what (that is step 3).
--  · divisions: DS, MMB, SRC, POOL, TK, 3PL (seeded in the owner's order)
--  · division_members: staff ↔ division with a role (manager, staff, warehouse, finance). Company-wide roles
--    (admin, finance, support) stay on user_roles and cover every division.
--  · role mapping approved by the owner (19 Nov): operations, sourcing_agent → SRC staff; qc_coordinator → SRC + MMB +
--    TK staff; warehouse → 3PL warehouse. account_manager (company-wide, per customer), content_editor and distributor
--    unchanged. Staging and live have no users with these roles today, so this inserts nothing on either.
--  · legal company: the existing company_profile row is the one company record. New, empty: registration_no, tax_id.
--    Legal name set to the owner's exact spelling. Bank details stay in company_bank_accounts.
-- Down: supabase/migrations/down/20261101000189_divisions.down.sql

create table if not exists divisions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('DS', 'MMB', 'SRC', 'POOL', 'TK', '3PL')),
  name text not null,
  sort_order int not null,
  logo_key text not null check (logo_key in ('octopus-b2b', 'octopus-dropship')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into divisions (code, name, sort_order, logo_key) values
  ('DS', 'Dropshipping', 1, 'octopus-dropship'),
  ('MMB', 'Make My Brand', 2, 'octopus-b2b'),
  ('SRC', 'Product Sourcing', 3, 'octopus-b2b'),
  ('POOL', 'MOQ Pools', 4, 'octopus-b2b'),
  ('TK', 'Turnkey Projects', 5, 'octopus-b2b'),
  ('3PL', '3PL & Shipping', 6, 'octopus-b2b')
on conflict (code) do nothing;
alter table divisions enable row level security;
revoke all on divisions from anon;
grant select on divisions to authenticated;
drop policy if exists divisions_read on divisions;
create policy divisions_read on divisions for select to authenticated using (true);           -- names / order / logo only
drop policy if exists divisions_admin on divisions;
create policy divisions_admin on divisions for update to authenticated using (is_admin()) with check (is_admin());
drop trigger if exists trg_audit_divisions on divisions;
create trigger trg_audit_divisions after insert or update or delete on divisions for each row execute function audit_row_change();

-- division code → id (stable; used by backfills, triggers and the step 3 helper)
create or replace function division_id_of(p_code text) returns uuid
language sql stable security definer set search_path = public as $$ select id from divisions where code = p_code $$;
-- service / stream word used across the app → division code (null = not a division word)
create or replace function division_code_for_service(p text) returns text
language sql immutable set search_path = public as $$
  select case lower(coalesce(p, ''))
    when 'rfq' then 'SRC' when 'sample' then 'SRC' when 'qc' then 'SRC' when 'certification' then 'SRC'
    when 'sourcing' then 'SRC' when 'rfq_fees' then 'SRC'
    when '3pl' then '3PL' when 'warehouse' then '3PL'
    when 'dropship' then 'DS'
    when 'brand' then 'MMB'
    when 'pool' then 'POOL' when 'pools' then 'POOL'
    when 'turnkey' then 'TK'
    else null end
$$;
grant execute on function division_id_of(text), division_code_for_service(text) to authenticated, service_role;

create table if not exists division_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete restrict,
  role text not null check (role in ('manager', 'staff', 'warehouse', 'finance')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id, division_id)
);
create index if not exists division_members_division_idx on division_members (division_id);
alter table division_members enable row level security;
revoke all on division_members from anon;
grant select on division_members to authenticated;
drop policy if exists dm_read on division_members;
create policy dm_read on division_members for select to authenticated using (user_id = auth.uid() or can('staff', 'view'));
drop policy if exists dm_write on division_members;
create policy dm_write on division_members for all to authenticated using (can('staff', 'edit') and mfa_fresh()) with check (can('staff', 'edit') and mfa_fresh());
drop trigger if exists trg_audit_division_members on division_members;
create trigger trg_audit_division_members after insert or update or delete on division_members for each row execute function audit_row_change();

-- approved role mapping (data-driven: only users who hold these roles today; none on staging or live)
insert into division_members (user_id, division_id, role)
select ur.user_id, d.id, m.role
  from user_roles ur
  join (values ('operations', 'SRC', 'staff'), ('sourcing_agent', 'SRC', 'staff'),
               ('qc_coordinator', 'SRC', 'staff'), ('qc_coordinator', 'MMB', 'staff'), ('qc_coordinator', 'TK', 'staff'),
               ('warehouse', '3PL', 'warehouse')) m(role_code, div, role) on m.role_code = ur.role_code
  join divisions d on d.code = m.div
on conflict (user_id, division_id) do nothing;

-- the one legal company record (values the owner has not given stay empty)
alter table company_profile add column if not exists registration_no text;
alter table company_profile add column if not exists tax_id text;
update company_profile set legal_name = 'Shenzhen Octopus Trading Co., Ltd.' where id = 1 and legal_name is distinct from 'Shenzhen Octopus Trading Co., Ltd.';
