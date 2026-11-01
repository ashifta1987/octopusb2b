-- QA §19 (SPEC §12 Performance: "indexes on all foreign keys and filter columns"; §19.1 "EXPLAIN on list queries uses indexes").
-- Status/queue filter columns used by back-office queues, finance, shipping and the storefront had no index.
-- Additive and idempotent: no data change.
create index if not exists tickets_status_sla_idx on public.tickets (status, sla_due_at);
create index if not exists kyc_submissions_status_created_idx on public.kyc_submissions (status, created_at);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists ad_campaigns_status_idx on public.ad_campaigns (status);
create index if not exists certificates_status_expires_idx on public.certificates (status);
create index if not exists finance_approvals_status_idx on public.finance_approvals (status, created_at);
create index if not exists payments_status_idx on public.payments (status, created_at);
create index if not exists payouts_status_idx on public.payouts (status);
create index if not exists pool_pledges_status_idx on public.pool_pledges (status);
create index if not exists quotes_status_idx on public.quotes (status);
create index if not exists service_requests_status_idx on public.service_requests (status, created_at);
create index if not exists shipments_status_idx on public.shipments (status);
create index if not exists terms_versions_status_idx on public.terms_versions (status);
create index if not exists wallet_topups_status_idx on public.wallet_topups (status, created_at);
create index if not exists wallet_withdrawals_status_idx on public.wallet_withdrawals (status, created_at);
create index if not exists documents_status_idx on public.documents (status);
create index if not exists backups_status_idx on public.backups (status, created_at);
create index if not exists restore_requests_status_idx on public.restore_requests (status);
create index if not exists currency_switch_requests_status_idx on public.currency_switch_requests (status);
create index if not exists assistant_sessions_status_idx on public.assistant_sessions (status, last_message_at);
create index if not exists integration_logs_created_idx on public.integration_logs (created_at desc);
