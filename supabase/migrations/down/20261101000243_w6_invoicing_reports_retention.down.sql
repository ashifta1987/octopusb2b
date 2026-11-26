-- 20261101000243_w6_invoicing_reports_retention.down.sql
-- Reverses 20261101000243_w6_invoicing_reports_retention.sql exactly: drops every W6 function, the triggers on wh_pallets /
-- wh_invoices / wh_invoice_lines, the W6 tables (wh_invoice_lines, wh_invoices, wh_service_settings, wh_pallet_stays) and the
-- purged_at columns (+ index) added to wh_pack_evidence / wh_return_photos. No existing function was replaced by W6
-- (wipe_demo_data included), so nothing has to be restored.
-- Data in the W6 tables (which proforma is which client's month, the line drill-down snapshots, pallet storage periods, targets,
-- return-photo retention, purge markers) is lost. Rows W6 wrote into existing tables stay: the proformas (documents +
-- invoice_lines + their balanced journals, payments and tax invoices — financial records), invoiced_at on packaging uses and
-- returns, audit rows. Files removed by the retention job are not restored (storage data, not schema).
-- (_migrations bookkeeping: delete from public._migrations where name = '20261101000243_w6_invoicing_reports_retention.sql';)

-- retention
drop function if exists public.wh_retention_mark(jsonb);
drop function if exists public.wh_retention_due(integer);
drop function if exists public.wh_retention_summary(text);

-- reports
drop function if exists public.wh_report(date, date, text, uuid);
drop function if exists public.wh_save_service_settings(text, integer, integer, integer);

-- invoices
drop function if exists public.wh_portal_invoices(uuid);
drop function if exists public.wh_invoice_issue(uuid, date);
drop function if exists public.wh_invoice_preview(uuid, date);
drop function if exists public.wh_invoice_board(date);
drop function if exists public.wh_invoice_json(public.wh_invoices, boolean);
drop function if exists public.wh_invoice_compute(uuid, date);
drop function if exists public.wh_month_start(date);
drop function if exists public.wh_rate_at(text, text, timestamptz);
drop trigger if exists wh_invoice_lines_guard on public.wh_invoice_lines;
drop trigger if exists wh_invoices_guard on public.wh_invoices;
drop function if exists public.wh_invoice_guard();
drop policy if exists wh_invoice_lines_read on public.wh_invoice_lines;
drop policy if exists wh_invoices_read on public.wh_invoices;
drop function if exists public.wh_invoice_access();
drop function if exists public.wh_invoice_can_issue();
drop function if exists public.wh_invoice_can_preview();
drop table if exists public.wh_invoice_lines;
drop table if exists public.wh_invoices;

-- retention markers
drop index if exists public.wh_pack_evidence_unpurged_idx;
alter table public.wh_return_photos drop column if exists purged_at;
alter table public.wh_pack_evidence drop column if exists purged_at;

-- settings
drop table if exists public.wh_service_settings;

-- pallet storage periods
drop trigger if exists wh_pallet_stay_track on public.wh_pallets;
drop function if exists public.wh_pallet_stay_track();
drop table if exists public.wh_pallet_stays;
