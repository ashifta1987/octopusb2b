-- Down for ODS T8 staff approvals (255). Only within the first hour and only if 255 itself failed (PROJECT-MEMORY §2.5).
-- Drops the approval records of the new staff money flow. Nothing financial is touched: 255 never wrote journals, ledger,
-- wallets, payments or orders, and finance_approvals / escrow_hold_approvals / customer_credit_terms were only read.
-- The audit_log rows written by 255 stay (append-only by design).
drop function if exists public.staff_approvals_readiness();
drop function if exists public.office_approval_queue(text, integer);
drop function if exists public.staff_approval_mark_executed(uuid, text);
drop function if exists public.staff_approval_ready(text, text, text, bigint);
drop function if exists public.staff_approval_decide(uuid, boolean, text, text);
drop function if exists public.staff_approval_request(text, bigint, text, text, text, text, uuid, jsonb, text);
drop function if exists public.staff_approval_audit(text, public.staff_approvals, public.staff_approvals, inet);
drop function if exists public.staff_approval_ip(text);
drop function if exists public.staff_approval_usd(bigint, text);
drop function if exists public.staff_approval_limit_minor();
drop table if exists public.staff_approvals;
drop function if exists public.staff_approvals_guard();
drop sequence if exists public.seq_staff_approval;
drop type if exists public.staff_approval_status;
delete from public.site_settings where key = 'office.second_approver_over_cents' and value = '250000'::jsonb;
