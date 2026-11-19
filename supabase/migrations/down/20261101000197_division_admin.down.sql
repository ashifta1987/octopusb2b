-- Down for 20261101000197_division_admin.sql
drop trigger if exists trg_division_member_guard on division_members;
drop function if exists division_member_guard();
drop trigger if exists trg_divisions_keep_one_active on divisions;
drop function if exists divisions_keep_one_active();
drop trigger if exists trg_company_legal_guard on company_profile;
drop function if exists company_legal_guard();
