-- Divisions (19 Nov 2026, owner's answer 1): ad-click charges stay company-wide (no division) but are marked as
-- "advertising" so the reports show advertising income as its own line. Derived from the journal itself, so every
-- existing and future ad-click journal is marked without changing the ads code.
-- Down: supabase/migrations/down/20261101000191_advertising_line.down.sql
alter table journals add column if not exists report_line text
  generated always as (case when stream = 'ads' or ref_type = 'ad_campaign' then 'advertising' end) stored;
comment on column journals.report_line is 'Company-wide income line for reports (advertising); null = use division_id / company-wide';
create index if not exists journals_report_line_idx on journals (report_line) where report_line is not null;
