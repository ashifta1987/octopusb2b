-- DOWN for 20261101000189_divisions.sql (run after the 190 down). Restores the company legal name spelling that was
-- there before (staging: 'Shenzhen Octopus Trading Co. Ltd.'). Then:
--   delete from _migrations where name = '20261101000189_divisions.sql';
update company_profile set legal_name = 'Shenzhen Octopus Trading Co. Ltd.' where id = 1 and legal_name = 'Shenzhen Octopus Trading Co., Ltd.';
alter table company_profile drop column if exists tax_id;
alter table company_profile drop column if exists registration_no;
drop table if exists division_members;
drop function if exists division_code_for_service(text);
drop function if exists division_id_of(text);
drop table if exists divisions;
