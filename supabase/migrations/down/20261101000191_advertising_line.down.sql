-- DOWN for 20261101000191_advertising_line.sql. Then: delete from _migrations where name = '20261101000191_advertising_line.sql';
drop index if exists journals_report_line_idx;
alter table journals drop column if exists report_line;
