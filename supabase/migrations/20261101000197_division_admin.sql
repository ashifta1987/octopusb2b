-- Divisions step 4 (19 Nov 2026): Admin › Company, Admin › Divisions, Admin › Staff (division memberships).
--  · The legal company record (company_profile): the legal fields can be changed by a company-wide Admin only.
--    Content editors keep editing the public site fields (tagline, contact, …). Every change is already written to the
--    audit log (trg_audit_company_profile).
--  · Divisions: name / order / logo / active are edited by an Admin (policy divisions_admin + audit from 189). At least
--    one division must stay active.
--  · Division members: only STAFF accounts can be added to a division (never a customer account); a person may be in
--    any number of divisions (one role per division). Writes need staff:edit + a fresh 2FA code (dm_write, 189).
-- Down: supabase/migrations/down/20261101000197_division_admin.down.sql

create or replace function company_legal_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.legal_name, new.legal_name_cn, new.registration_no, new.tax_id, new.address, new.address_cn, new.registered_in, new.governing_law)
     is distinct from
     (old.legal_name, old.legal_name_cn, old.registration_no, old.tax_id, old.address, old.address_cn, old.registered_in, old.governing_law)
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') <> 'service_role'
     and not is_admin() then
    raise exception 'COMPANY_LEGAL_ADMIN_ONLY: only a company-wide Admin can change the legal company details' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_company_legal_guard on company_profile;
create trigger trg_company_legal_guard before update on company_profile for each row execute function company_legal_guard();

create or replace function divisions_keep_one_active() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from divisions where status = 'active') then
    raise exception 'DIVISION_LAST_ACTIVE: at least one division must stay active';
  end if;
  return null;
end $$;
drop trigger if exists trg_divisions_keep_one_active on divisions;
create constraint trigger trg_divisions_keep_one_active after update on divisions deferrable initially deferred
  for each row execute function divisions_keep_one_active();

create or replace function division_member_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not user_is_staff(new.user_id) then
    raise exception 'DIVISION_MEMBER_NOT_STAFF: only staff accounts can be added to a division';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
drop trigger if exists trg_division_member_guard on division_members;
create trigger trg_division_member_guard before insert or update on division_members for each row execute function division_member_guard();
