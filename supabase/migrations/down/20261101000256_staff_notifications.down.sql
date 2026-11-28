-- Down for ODS T8 staff notifications (256). Drops the staff alert channel and its triggers. The business tables the triggers
-- sat on (tk_client_project_events, tk_client_project_staff, staff_approvals, finance_approvals) are not otherwise touched;
-- the T7 turnkey alerts in public.notifications keep working. No money rows involved.
drop trigger if exists trg_office_finance_approval_alert on public.finance_approvals;
drop trigger if exists trg_office_staff_approval_alert on public.staff_approvals;
drop trigger if exists trg_office_tk_manager_alert on public.tk_client_project_staff;
drop trigger if exists trg_office_tk_enquiry_alert on public.tk_client_project_events;
drop function if exists public.office_finance_approval_alert();
drop function if exists public.office_staff_approval_alert();
drop function if exists public.office_tk_manager_alert();
drop function if exists public.office_tk_enquiry_alert();
drop function if exists public.office_finance_role();
drop function if exists public.office_money_text(bigint, text);
drop function if exists public.staff_notifications_mark_read(uuid[]);
drop function if exists public.staff_notifications_unread_count();
drop function if exists public.staff_notifications_list(integer, boolean, timestamp with time zone);
drop function if exists public.staff_notifications_visible();
drop function if exists public.staff_notify(uuid, text, text, text, text, text, text, text, text);
drop table if exists public.staff_notification_reads;
drop table if exists public.staff_notifications;
