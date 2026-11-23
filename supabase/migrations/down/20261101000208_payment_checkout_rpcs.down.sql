-- Down migration for 20261101000208_payment_checkout_rpcs.sql
drop function if exists subscribe_saas_plan(uuid, text, text, text, text);
drop function if exists generate_dropship_weekly_statement(uuid, timestamptz, timestamptz);
drop function if exists run_credit_and_saas_overdue_check();
drop function if exists run_payment_reconciliation();
drop function if exists confirm_aggregator_webhook(text, text, text, uuid, bigint, text, text, text, text, jsonb);
drop function if exists create_payment_checkout(uuid, text, text, text, uuid, bigint, text, text, text, boolean, text);
drop function if exists fail_pool_and_refund_all(uuid, text);
drop function if exists issue_payment_refund(uuid, uuid, bigint, text, text, text);
drop function if exists decide_escrow_hold_approval(uuid, boolean, text);
drop function if exists finance_act_on_escrow_hold(uuid, text, bigint, text, text);
drop function if exists execute_escrow_action_internal(uuid, text, bigint, text, uuid, text);
drop function if exists open_escrow_dispute(uuid, text);
drop function if exists pay_with_protection_wallet(text, text, uuid, bigint, text, text);
drop function if exists create_escrow_hold_internal(uuid, uuid, text, text, uuid, text, bigint, text, text, uuid);
drop trigger if exists trg_orders_pay_later on orders;
drop function if exists trg_orders_pay_later_lifecycle();
drop function if exists issue_pay_later_shipment_invoice(uuid);
drop function if exists checkout_pay_later(uuid, text, text, uuid, bigint, text, text);
drop function if exists get_customer_credit_status(uuid, uuid);
drop function if exists decide_customer_credit_terms(uuid, boolean, text);
drop function if exists propose_customer_credit_terms(uuid, bigint, integer, uuid, text, text);
drop function if exists payment_division_for_service(text, uuid);

-- Restore order_transition_allowed from migration 054/152
create or replace function order_transition_allowed(p_from order_status, p_to order_status) returns boolean
language sql immutable set search_path = public, extensions as $$
  select (p_from, p_to) in (
    ('pi_issued','deposit_pending'),('deposit_pending','deposit_paid'),('deposit_paid','confirmed'),('confirmed','in_production'),
    ('in_production','qc'),('in_production','balance_pending'),('qc','balance_pending'),('balance_pending','balance_paid'),
    ('balance_paid','ready_to_ship'),('ready_to_ship','shipped'),('shipped','delivered'),('delivered','closed'),
    ('pi_issued','cancelled'),('deposit_pending','cancelled'),('delivered','disputed'),('disputed','closed')
  );
$$;
