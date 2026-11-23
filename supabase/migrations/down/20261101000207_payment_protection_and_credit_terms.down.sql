-- Down for 20261101000207_payment_protection_and_credit_terms.down.sql
delete from wallet_credit_limits where note = 'Staging seed org legacy wallet credit limit';
update site_settings
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{amount_minor}', '200000'::jsonb) || '{"verified_only": true}'::jsonb
 where key = 'wallet_credit_default';

drop function if exists held_payment_protection_by_division(timestamptz, timestamptz, boolean);

create or replace function my_wallet_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'reference', o.wallet_reference,
    'available_cents', wallet_balance(o.id, 'USD'),
    'on_hold_cents', coalesce((select sum(amount_cents) from wallet_holds h where h.org_id = o.id and h.status = 'open'), 0),
    'pending_transfers_cents', coalesce((select sum(amount_cents) from wallet_topups t where t.org_id = o.id and t.status = 'pending'), 0))
  from organizations o where o.id = my_org_id();
$$;
revoke all on function my_wallet_summary() from public, anon;
grant execute on function my_wallet_summary() to authenticated, service_role;

drop table if exists saas_subscriptions;
drop table if exists saas_plans;

alter table orders drop column if exists payment_option;

drop index if exists documents_due_at_idx;
alter table documents drop column if exists last_reminder_stage;
alter table documents drop column if exists credit_terms_days;
alter table documents drop column if exists payment_option;
alter table documents drop column if exists due_at;

drop table if exists credit_reservations;
drop table if exists customer_credit_terms;
drop table if exists escrow_hold_approvals;
drop table if exists escrow_hold_events;
drop table if exists escrow_holds;
drop function if exists protection_hold_account(uuid, text);
