-- Lock down internal SECURITY DEFINER helpers: callable only from other functions / service role.
do $$ declare f text;
begin
  foreach f in array array[
    'ledger_account(text,text,text,uuid)','wallet_account(uuid)','receivable_account(uuid)',
    'post_journal(text,jsonb,text,text,text,uuid)','wallet_charge(uuid,bigint,text,text,text,text,uuid)',
    'emit_event(text,text,uuid,jsonb)','log_status(text,uuid,text,text,text)','write_audit(text,text,text,jsonb)',
    'wallet_balance(uuid)','has_permission(uuid,text,text)',
    'job_expire_quotes()','job_reset_ad_budgets()','job_close_claim_windows()','job_publish_scheduled_terms()','job_certificate_expiry()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Customer/staff RPCs: authenticated only (not anon)
do $$ declare f text;
begin
  foreach f in array array[
    'complete_onboarding(text,text,text,text,text,text)','submit_kyc(text,text,text,text,text,text)','review_kyc(uuid,kyc_status,text)',
    'request_service(text,jsonb,uuid,text)','transition_service_request(uuid,service_request_status,text)',
    'submit_rfq(text,integer,text,uuid,text,text,bigint,text,text)','send_quote(uuid,uuid,bigint,integer,text,integer,bigint,text)',
    'approve_quote(uuid,uuid)','transition_order(uuid,order_status,text)','record_payment(uuid,bigint,text,text,text)',
    'request_topup(bigint,text,text)','confirm_topup(uuid,text)','request_finance_approval(text,bigint,text,uuid,uuid,uuid)',
    'decide_finance_approval(uuid,boolean,text)','transition_product(uuid,product_status,text)',
    'create_ticket(text,text,text,uuid,text,jsonb)','reply_ticket(uuid,text,boolean,ticket_status)','my_wallet_balance()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- record_ad_click is called server-side with the service role (fraud filter lives there)
revoke execute on function public.record_ad_click(uuid,text) from public, anon, authenticated;
grant execute on function public.record_ad_click(uuid,text) to service_role;

-- Product status may only move to live/in_review/rejected through transition_product (moderation)
create or replace function guard_product_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status not in ('draft','submitted','paused','archived') then
    raise exception 'USE_TRANSITION_PRODUCT';
  end if;
  return new;
end $$;
create trigger trg_guard_product before update on products for each row execute function guard_product_status();

-- Orders / quotes / ledger are never written directly by clients
revoke insert, update, delete on orders, quotes, journals, ledger_entries, payments, proforma_invoices, wallet_topups, finance_approvals, payouts from anon, authenticated;
revoke insert, update, delete on ledger_accounts, status_history, outbox_events, audit_log from anon, authenticated;
