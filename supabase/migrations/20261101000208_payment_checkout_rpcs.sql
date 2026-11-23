-- 20261101000208_payment_checkout_rpcs.sql
-- Prompt 2 · Part 3 (23 Nov 2026):
--  1. Aggregator checkout & webhook confirmation:
--      · create_payment_checkout(...) — calculates base amount, surcharge (when fee_mode='surcharge'), selects active provider,
--        validates service × option matrix (enabled, min/max amount).
--      · confirm_aggregator_webhook(...) — idempotent on (provider, event_id); re-checks amount, currency and target on server;
--        for 'pay_now' settles the order/proforma/pool_pledge/topup/saas; for 'payment_protection' books to protection_hold_account
--        ('hold_prot:<org>', never revenue) and creates escrow_holds + Paid/Held timeline events.
--  2. Payment protection (escrow_holds) lifecycle:
--      · pay_with_protection_wallet(...) — customer pays upfront from wallet into protection_hold_account.
--      · open_escrow_dispute(p_hold, p_reason) — customer opens a dispute before release, freezing the hold.
--      · release_or_refund_escrow(...) — Finance releases (full/partial) or refunds (wallet/original_method).
--        Above payments.approval_threshold_cents (default US$ 1,000), creates an escrow_hold_approvals row requiring a second
--        Finance approver (proposed_by <> approved_by).
--        On release: debits protection_hold_account, credits revenue/receivable, and issues the OCT-[div]-[year]-[seq] tax
--        invoice ONCE (unique on escrow_holds.invoice_id).
--        On refund: debits protection_hold_account (or revenue if already invoiced, issuing a CN-[div]-[year]-[seq] credit note).
--  3. Pay later (credit terms & atomic reservation):
--      · propose_customer_credit_terms(...) & decide_customer_credit_terms(...) — ALWAYS two-person approval (proposed_by <> approved_by).
--      · get_customer_credit_status(p_org, p_division) — returns limit, unpaid_invoices_cents, reserved_cents, available_cents, net_days, eligible, reason.
--      · checkout_pay_later(...) — locks org + customer_credit_terms rows FOR UPDATE so concurrent orders cannot exceed the limit;
--        reserves against credit_reservations at order confirmation; issues OCT- invoice immediately only when trigger is
--        'order_confirmation' or 'cycle_start', otherwise waits for shipment / period_end.
--      · transition_order(...) & issue_pay_later_shipment_invoice(...) — when a Pay-later goods order transitions to 'shipped'
--        (or is handed to carrier), converts its credit reservation into an OCT-[div]-[year]-[seq] tax invoice with
--        due_at = now() + net_days and posts Debit ar:<org> / Credit rev:<stream>. If cancelled before shipment, releases the reservation.
--  4. Refunds & failed pools:
--      · issue_payment_refund(...) — always issues a CN-[div]-[year]-[seq] credit note linked to the tax invoice and posts
--        reversing double-entry ledger lines.
--      · cancel_or_fail_pool(p_pool, p_reason) — automatically refunds every paid/held pledge (both escrow:pools and escrow_holds)
--        back to the customer's wallet.
--  5. Daily reconciliation & credit/SaaS overdue jobs:
--      · run_payment_reconciliation() & run_credit_and_saas_overdue_check().
-- Down: supabase/migrations/down/20261101000208_payment_checkout_rpcs.down.sql

-- ───────── 1. Helper: division for a service code ─────────
create or replace function payment_division_for_service(p_service text, p_fallback uuid default null) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    p_fallback,
    division_id_of(case lower(coalesce(p_service, ''))
      when 'sourcing' then 'SRC'
      when 'brand' then 'MMB'
      when 'pools' then 'POOL'
      when 'turnkey' then 'TK'
      when 'warehouse' then '3PL'
      when 'dropship' then 'DS'
      else 'SRC'
    end)
  );
$$;
revoke all on function payment_division_for_service(text, uuid) from public, anon;
grant execute on function payment_division_for_service(text, uuid) to authenticated, service_role;

-- ───────── 2. Credit terms: two-person proposal, approval & atomic status ─────────
create or replace function propose_customer_credit_terms(
  p_org uuid,
  p_credit_limit_cents bigint,
  p_net_days integer default 30,
  p_division uuid default null,
  p_currency text default 'USD',
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or not (is_staff() and (can('finance', 'edit') or can('finance', 'approve') or is_admin())) then
    raise exception 'FORBIDDEN';
  end if;
  if p_org is null or not exists (select 1 from organizations where id = p_org) then
    raise exception 'NOT_FOUND';
  end if;
  if p_credit_limit_cents is null or p_credit_limit_cents < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_net_days not in (7, 15, 30, 45, 60) then
    raise exception 'INVALID_NET_DAYS: must be 7, 15, 30, 45 or 60';
  end if;

  insert into customer_credit_terms (
    org_id, division_id, credit_limit_cents, currency, net_days,
    status, proposed_by, proposed_at, approved_by, approved_at, note, updated_at
  )
  values (
    p_org, p_division, p_credit_limit_cents, upper(coalesce(p_currency, 'USD'))::char(3), p_net_days,
    'pending_approval', v_uid, now(), null, null, nullif(btrim(coalesce(p_note, '')), ''), now()
  )
  on conflict on constraint customer_credit_terms_unique do update set
    credit_limit_cents = excluded.credit_limit_cents,
    currency = excluded.currency,
    net_days = excluded.net_days,
    status = 'pending_approval',
    proposed_by = v_uid,
    proposed_at = now(),
    approved_by = null,
    approved_at = null,
    note = excluded.note,
    updated_at = now()
  returning id into v_id;

  perform write_audit(
    'credit_terms.proposed',
    'customer_credit_terms',
    v_id::text,
    jsonb_build_object('org_id', p_org, 'division_id', p_division, 'credit_limit_cents', p_credit_limit_cents, 'net_days', p_net_days)
  );
  return v_id;
end $$;
revoke all on function propose_customer_credit_terms(uuid, bigint, integer, uuid, text, text) from public, anon;
grant execute on function propose_customer_credit_terms(uuid, bigint, integer, uuid, text, text) to authenticated, service_role;

create or replace function decide_customer_credit_terms(
  p_terms_id uuid,
  p_approve boolean,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t customer_credit_terms;
  v_status text;
begin
  if v_uid is null or not (is_staff() and (can('finance', 'approve') or is_admin())) then
    raise exception 'FORBIDDEN';
  end if;
  select * into t from customer_credit_terms where id = p_terms_id for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status <> 'pending_approval' then raise exception 'INVALID_TRANSITION'; end if;
  if t.proposed_by = v_uid then
    raise exception 'MAKER_CANNOT_APPROVE: credit limits always require two-person approval';
  end if;

  v_status := case when p_approve then 'active' else 'rejected' end;
  update customer_credit_terms
     set status = v_status,
         approved_by = v_uid,
         approved_at = now(),
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
         updated_at = now()
   where id = p_terms_id;

  perform write_audit(
    'credit_terms.' || v_status,
    'customer_credit_terms',
    p_terms_id::text,
    jsonb_build_object('org_id', t.org_id, 'division_id', t.division_id, 'credit_limit_cents', t.credit_limit_cents, 'net_days', t.net_days, 'note', p_note)
  );
  return jsonb_build_object('id', p_terms_id, 'status', v_status);
end $$;
revoke all on function decide_customer_credit_terms(uuid, boolean, text) from public, anon;
grant execute on function decide_customer_credit_terms(uuid, boolean, text) to authenticated, service_role;

-- Returns a customer's Pay-later credit status for a division (or company-wide fallback)
create or replace function get_customer_credit_status(
  p_org uuid,
  p_division uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o organizations;
  t customer_credit_terms;
  v_unpaid bigint := 0;
  v_reserved bigint := 0;
  v_avail bigint := 0;
  v_grace int := coalesce((select (value #>> '{}')::int from site_settings where key = 'payments.pay_later_grace_days'), 7);
  v_overdue_Past_grace boolean := false;
begin
  if p_org is null then
    return jsonb_build_object('eligible', false, 'reason', 'Ask your account manager to set up credit');
  end if;
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or is_staff()) then
    raise exception 'FORBIDDEN';
  end if;

  select * into o from organizations where id = p_org;
  if o.id is null then
    return jsonb_build_object('eligible', false, 'reason', 'Company not found');
  end if;

  -- Prefer division-specific active credit terms; fall back to company-wide (division_id is null)
  select * into t
    from customer_credit_terms
   where org_id = p_org
     and status = 'active'
     and (division_id = p_division or division_id is null)
   order by (division_id is not null) desc, updated_at desc
   limit 1;

  -- Unpaid commercial invoices (OCT-) on Pay-later or awaiting payment for this org (and division if terms are division-scoped)
  select coalesce(sum(greatest(0, coalesce(d.amount_cents, 0) - coalesce(d.paid_cents, 0))), 0)::bigint
    into v_unpaid
    from documents d
   where d.org_id = p_org
     and d.doc_type = 'commercial_invoice'
     and coalesce(d.status, '') not in ('paid', 'void', 'cancelled')
     and (t.id is null or t.division_id is null or d.division_id = t.division_id);

  -- Pending pay-later reservations not yet converted to a tax invoice
  select coalesce(sum(r.amount_cents), 0)::bigint
    into v_reserved
    from credit_reservations r
   where r.org_id = p_org
     and r.status = 'reserved'
     and (t.id is null or t.division_id is null or r.division_id = t.division_id);

  -- Check whether any unpaid invoice is overdue past the grace period
  select exists (
    select 1
      from documents d
     where d.org_id = p_org
       and d.doc_type = 'commercial_invoice'
       and coalesce(d.status, '') not in ('paid', 'void', 'cancelled')
       and coalesce(d.amount_cents, 0) > coalesce(d.paid_cents, 0)
       and d.due_at is not null
       and d.due_at + make_interval(days => v_grace) < now()
  ) into v_overdue_past_grace;

  if o.kyc_status <> 'verified' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'Complete company KYC verification and ask your account manager to set up credit',
      'kyc_status', o.kyc_status,
      'credit_limit_cents', coalesce(t.credit_limit_cents, 0),
      'unpaid_invoices_cents', v_unpaid,
      'reserved_cents', v_reserved,
      'available_cents', 0,
      'net_days', coalesce(t.net_days, 30)
    );
  end if;

  if t.id is null or t.credit_limit_cents <= 0 then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'Ask your account manager to set up credit',
      'kyc_status', o.kyc_status,
      'credit_limit_cents', 0,
      'unpaid_invoices_cents', v_unpaid,
      'reserved_cents', v_reserved,
      'available_cents', 0,
      'net_days', 30
    );
  end if;

  v_avail := greatest(0, t.credit_limit_cents - v_unpaid - v_reserved);

  if t.overdue_blocked or v_overdue_past_grace then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'Pay-later is paused because an invoice is overdue past the grace period',
      'terms_id', t.id,
      'credit_limit_cents', t.credit_limit_cents,
      'unpaid_invoices_cents', v_unpaid,
      'reserved_cents', v_reserved,
      'available_cents', v_avail,
      'net_days', t.net_days,
      'currency', t.currency
    );
  end if;

  return jsonb_build_object(
    'eligible', true,
    'reason', null,
    'terms_id', t.id,
    'credit_limit_cents', t.credit_limit_cents,
    'unpaid_invoices_cents', v_unpaid,
    'reserved_cents', v_reserved,
    'available_cents', v_avail,
    'net_days', t.net_days,
    'currency', t.currency
  );
end $$;
revoke all on function get_customer_credit_status(uuid, uuid) from public, anon;
grant execute on function get_customer_credit_status(uuid, uuid) to authenticated, service_role;

-- ───────── 3. Atomic Pay-Later Checkout (row lock FOR UPDATE on org + credit_terms) ─────────
create or replace function checkout_pay_later(
  p_org uuid,
  p_service text,
  p_target_type text,
  p_target_id uuid,
  p_amount_cents bigint,
  p_currency text default 'USD',
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''), 'paylater:' || p_target_type || ':' || p_target_id::text);
  v_existing credit_reservations;
  o organizations;
  t customer_credit_terms;
  m payment_option_settings;
  v_div uuid;
  v_unpaid bigint;
  v_reserved bigint;
  v_avail bigint;
  v_grace int := coalesce((select (value #>> '{}')::int from site_settings where key = 'payments.pay_later_grace_days'), 7);
  v_trigger text;
  v_res_id uuid;
  v_inv_id uuid;
  v_inv_no text;
  v_due timestamptz;
  v_order orders;
  v_doc documents;
begin
  if p_org is null then raise exception 'NO_ORG'; end if;
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or is_staff()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Idempotent replay check
  select * into v_existing from credit_reservations where idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'reservation_id', v_existing.id,
      'invoice_id', v_existing.invoice_id,
      'status', v_existing.status,
      'net_days', v_existing.net_days,
      'repeated', true
    );
  end if;

  -- Lock the organization row FOR UPDATE so two concurrent pay-later checkouts for the same customer serialize
  select * into o from organizations where id = p_org for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if o.kyc_status <> 'verified' then
    raise exception 'KYC_NOT_VERIFIED: Pay later requires verified company KYC';
  end if;

  select * into m from payment_option_settings where service = p_service and option = 'pay_later';
  if m.service is null or not m.enabled then
    raise exception 'OPTION_DISABLED: Pay later is not enabled for %', p_service;
  end if;
  if p_amount_cents < m.min_amount_cents or (m.max_amount_cents is not null and p_amount_cents > m.max_amount_cents) then
    raise exception 'AMOUNT_OUT_OF_RANGE: Pay later for % allows %..%', p_service, m.min_amount_cents, coalesce(m.max_amount_cents::text, 'unlimited');
  end if;

  v_div := payment_division_for_service(p_service);
  if p_target_type = 'order' then
    select * into v_order from orders where id = p_target_id for update;
    if v_order.id is null or v_order.org_id <> p_org then raise exception 'ORDER_NOT_FOUND'; end if;
    v_div := coalesce(v_order.division_id, v_div);
  elsif p_target_type = 'proforma' then
    select * into v_doc from documents where id = p_target_id for update;
    if v_doc.id is null or v_doc.org_id <> p_org then raise exception 'DOCUMENT_NOT_FOUND'; end if;
    v_div := coalesce(v_doc.division_id, v_div);
  end if;

  -- Lock the active credit terms row FOR UPDATE
  select * into t
    from customer_credit_terms
   where org_id = p_org
     and status = 'active'
     and (division_id = v_div or division_id is null)
   order by (division_id is not null) desc, updated_at desc
   limit 1
   for update;

  if t.id is null or t.credit_limit_cents <= 0 then
    raise exception 'NO_CREDIT_TERMS: Ask your account manager to set up credit';
  end if;

  if t.overdue_blocked or exists (
    select 1 from documents d
     where d.org_id = p_org
       and d.doc_type = 'commercial_invoice'
       and coalesce(d.status, '') not in ('paid', 'void', 'cancelled')
       and coalesce(d.amount_cents, 0) > coalesce(d.paid_cents, 0)
       and d.due_at is not null
       and d.due_at + make_interval(days => v_grace) < now()
  ) then
    raise exception 'CREDIT_OVERDUE_BLOCKED: Pay-later is paused because an invoice is overdue past the grace period';
  end if;

  select coalesce(sum(greatest(0, coalesce(d.amount_cents, 0) - coalesce(d.paid_cents, 0))), 0)::bigint
    into v_unpaid
    from documents d
   where d.org_id = p_org
     and d.doc_type = 'commercial_invoice'
     and coalesce(d.status, '') not in ('paid', 'void', 'cancelled')
     and (t.division_id is null or d.division_id = t.division_id);

  select coalesce(sum(r.amount_cents), 0)::bigint
    into v_reserved
    from credit_reservations r
   where r.org_id = p_org
     and r.status = 'reserved'
     and (t.division_id is null or r.division_id = t.division_id);

  v_avail := t.credit_limit_cents - v_unpaid - v_reserved;
  if p_amount_cents > v_avail then
    raise exception 'CREDIT_LIMIT_EXCEEDED: available credit % cents, requested % cents', greatest(0, v_avail), p_amount_cents;
  end if;

  v_trigger := coalesce(m.pay_later_invoice_trigger, 'shipment');

  insert into credit_reservations (
    org_id, division_id, credit_terms_id, service, target_type, target_id,
    order_id, amount_cents, currency, net_days, invoice_trigger, status, idempotency_key, created_by
  )
  values (
    p_org, v_div, t.id, p_service, p_target_type, p_target_id,
    case when p_target_type = 'order' then p_target_id else v_doc.order_id end,
    p_amount_cents, upper(coalesce(p_currency, 'USD'))::char(3), t.net_days, v_trigger, 'reserved', v_key, auth.uid()
  )
  returning id into v_res_id;

  if p_target_type = 'order' and v_order.id is not null then
    update orders
       set payment_option = 'pay_later',
           status = case when status in ('pi_issued', 'deposit_pending') then 'confirmed'::order_status else status end
     where id = v_order.id;
    insert into order_events (order_id, org_id, kind, title, body, created_by)
    values (
      v_order.id, p_org, 'payment', 'Pay later (Net ' || t.net_days || ') reserved',
      'Reserved against credit limit · Tax invoice (OCT-) issues at ' || replace(v_trigger, '_', ' '),
      auth.uid()
    );
  end if;

  -- If the service trigger is 'order_confirmation' or 'cycle_start' (e.g. SaaS cycle start or service proforma),
  -- issue the OCT- tax invoice immediately; otherwise ('shipment' for goods or 'period_end') keep it reserved until shipment/period end.
  if v_trigger in ('order_confirmation', 'cycle_start') or p_target_type in ('proforma', 'saas_subscription') then
    v_due := now() + make_interval(days => t.net_days);
    v_inv_no := next_document_number('invoice', v_div);
    insert into documents (
      org_id, division_id, doc_type, number, order_id, amount_cents, paid_cents, currency,
      status, due_at, payment_option, credit_terms_days, from_proforma_id, data
    )
    values (
      p_org, v_div, 'commercial_invoice', v_inv_no,
      case when p_target_type = 'order' then p_target_id else v_doc.order_id end,
      p_amount_cents, 0, upper(coalesce(p_currency, 'USD'))::char(3),
      'awaiting_payment', v_due, 'pay_later', t.net_days,
      case when p_target_type = 'proforma' then p_target_id else null end,
      jsonb_build_object(
        'service', p_service,
        'payment_option', 'pay_later',
        'net_days', t.net_days,
        'due_at', v_due,
        'title', coalesce(v_order.title, v_doc.data ->> 'title', initcap(p_service) || ' invoice')
      )
    )
    returning id into v_inv_id;

    if p_target_type = 'proforma' and v_doc.id is not null then
      update documents set status = 'invoiced', payment_option = 'pay_later' where id = v_doc.id;
    end if;

    -- Post receivable journal if not already posted by a proforma
    if p_target_type <> 'proforma' and p_target_type <> 'order' then
      perform post_journal(
        'Pay-later invoice ' || v_inv_no || ' (Net ' || t.net_days || ')',
        jsonb_build_array(
          jsonb_build_object('account', receivable_account(p_org, upper(coalesce(p_currency, 'USD'))), 'debit', p_amount_cents, 'credit', 0, 'org', p_org),
          jsonb_build_object('account', revenue_account(case p_service when 'advertising' then 'ads' else p_service end, upper(coalesce(p_currency, 'USD'))), 'debit', 0, 'credit', p_amount_cents)
        ),
        'paylater-inv:' || v_inv_id::text,
        case p_service when 'advertising' then 'ads' else p_service end,
        'document',
        v_inv_id
      );
    end if;

    update credit_reservations
       set status = 'invoiced', invoice_id = v_inv_id, invoiced_at = now()
     where id = v_res_id;
  end if;

  perform write_audit(
    'pay_later.reserved',
    'credit_reservations',
    v_res_id::text,
    jsonb_build_object('org_id', p_org, 'service', p_service, 'target_type', p_target_type, 'target_id', p_target_id, 'amount_cents', p_amount_cents, 'net_days', t.net_days, 'trigger', v_trigger, 'invoice_id', v_inv_id)
  );

  return jsonb_build_object(
    'reservation_id', v_res_id,
    'invoice_id', v_inv_id,
    'invoice_number', v_inv_no,
    'due_at', v_due,
    'status', case when v_inv_id is not null then 'invoiced' else 'reserved' end,
    'net_days', t.net_days,
    'available_after_cents', v_avail - p_amount_cents,
    'repeated', false
  );
end $$;
revoke all on function checkout_pay_later(uuid, text, text, uuid, bigint, text, text) from public, anon;
grant execute on function checkout_pay_later(uuid, text, text, uuid, bigint, text, text) to authenticated, service_role;

-- Convert a Pay-later goods reservation into an OCT- tax invoice at SHIPMENT (or release it if cancelled before shipment)
create or replace function issue_pay_later_shipment_invoice(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  r credit_reservations;
  v_inv_id uuid;
  v_inv_no text;
  v_due timestamptz;
begin
  select * into o from orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;

  select * into r
    from credit_reservations
   where (order_id = p_order or (target_type = 'order' and target_id = p_order))
     and status = 'reserved'
   order by created_at desc
   limit 1
   for update;

  if r.id is null then
    return null;
  end if;

  -- Check if an active commercial invoice already exists for this order
  select id into v_inv_id
    from documents
   where order_id = p_order and doc_type = 'commercial_invoice' and coalesce(status, '') not in ('void', 'cancelled')
   limit 1;

  v_due := now() + make_interval(days => r.net_days);

  if v_inv_id is null then
    v_inv_no := next_document_number('invoice', coalesce(o.division_id, r.division_id));
    insert into documents (
      org_id, division_id, doc_type, number, order_id, amount_cents, paid_cents, currency,
      status, due_at, payment_option, credit_terms_days, data
    )
    values (
      o.org_id, coalesce(o.division_id, r.division_id), 'commercial_invoice', v_inv_no, p_order,
      r.amount_cents, o.paid_cents, o.currency,
      'awaiting_payment', v_due, 'pay_later', r.net_days,
      jsonb_build_object(
        'title', o.title,
        'qty', o.quantity,
        'unit_price_cents', o.unit_price_cents,
        'shipping_cents', o.shipping_cents,
        'paid_cents', o.paid_cents,
        'balance_cents', r.amount_cents - o.paid_cents,
        'incoterm', o.incoterm,
        'currency', o.currency,
        'payment_option', 'pay_later',
        'net_days', r.net_days,
        'due_at', v_due
      )
    )
    returning id into v_inv_id;

    -- Ensure receivable journal exists (if order wasn't created from a quote PI)
    if not exists (select 1 from journals where idempotency_key in ('pi:' || p_order::text, 'paylater-ar:' || p_order::text)) then
      perform post_journal(
        'Pay-later shipment invoice ' || v_inv_no || ' · ' || o.code,
        jsonb_build_array(
          jsonb_build_object('account', receivable_account(o.org_id, o.currency), 'debit', r.amount_cents, 'credit', 0, 'org', o.org_id),
          jsonb_build_object('account', revenue_account('orders', o.currency), 'debit', 0, 'credit', r.amount_cents)
        ),
        'paylater-ar:' || p_order::text,
        'orders',
        'order',
        p_order
      );
    end if;
  else
    update documents
       set due_at = coalesce(due_at, v_due),
           payment_option = 'pay_later',
           credit_terms_days = r.net_days
     where id = v_inv_id;
  end if;

  update credit_reservations
     set status = 'invoiced', invoice_id = v_inv_id, invoiced_at = now()
   where id = r.id;

  perform write_audit(
    'pay_later.invoiced_on_shipment',
    'documents',
    v_inv_id::text,
    jsonb_build_object('order_id', p_order, 'reservation_id', r.id, 'due_at', v_due, 'net_days', r.net_days)
  );
  return v_inv_id;
end $$;
revoke all on function issue_pay_later_shipment_invoice(uuid) from public, anon;
grant execute on function issue_pay_later_shipment_invoice(uuid) to authenticated, service_role;

-- Trigger on orders: when a pay-later order transitions to 'shipped', issue its OCT- invoice; when 'cancelled', release its credit reservation
create or replace function trg_orders_pay_later_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    perform issue_pay_later_shipment_invoice(new.id);
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update credit_reservations
       set status = 'released', released_at = now()
     where (order_id = new.id or (target_type = 'order' and target_id = new.id))
       and status = 'reserved';
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_pay_later on orders;
create trigger trg_orders_pay_later after update of status on orders
  for each row execute function trg_orders_pay_later_lifecycle();

-- Allow confirmed → in_production / shipped transitions for pay_later orders
create or replace function order_transition_allowed(p_from order_status, p_to order_status) returns boolean
language sql immutable set search_path = public, extensions as $$
  select (p_from, p_to) in (
    ('pi_issued','deposit_pending'),('deposit_pending','deposit_paid'),('deposit_paid','confirmed'),('confirmed','in_production'),
    ('in_production','qc'),('in_production','balance_pending'),('qc','balance_pending'),('balance_pending','balance_paid'),
    ('balance_paid','ready_to_ship'),('ready_to_ship','shipped'),('shipped','delivered'),('delivered','closed'),
    ('pi_issued','cancelled'),('deposit_pending','cancelled'),('confirmed','cancelled'),('delivered','disputed'),('disputed','closed'),
    ('confirmed','ready_to_ship'),('confirmed','shipped'),('in_production','shipped')
  );
$$;

-- ───────── 4. Payment Protection (escrow_holds): create, dispute, release (with 2-person approval > $1,000), refund ─────────
create or replace function create_escrow_hold_internal(
  p_org uuid,
  p_division uuid,
  p_service text,
  p_target_type text,
  p_target_id uuid,
  p_funding_method text,
  p_amount_cents bigint,
  p_currency text,
  p_idempotency_key text,
  p_checkout_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_hold_id uuid;
  v_div uuid := payment_division_for_service(p_service, p_division);
  m payment_option_settings;
  v_rule text;
  v_days int;
  v_label text;
  v_milestones jsonb;
  v_order_id uuid;
  v_doc_id uuid;
  v_pool_id uuid;
  v_debit_acct uuid;
  v_j uuid;
begin
  select id into v_existing from escrow_holds where idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into m from payment_option_settings where service = p_service and option = 'payment_protection';
  if m.service is not null and not m.enabled then
    raise exception 'OPTION_DISABLED: Payment protection is not enabled for %', p_service;
  end if;

  v_rule := coalesce(m.release_rule, case p_service
    when 'dropship' then 'delivery_plus_days'
    when 'pools' then 'pool_close'
    when 'warehouse' then 'service_month_end'
    else 'milestones'
  end);
  v_days := coalesce(m.auto_release_days, 7);

  v_label := case v_rule
    when 'delivery_plus_days' then format('tracking shows delivered (+%s days dispute window)', v_days)
    when 'pool_close' then 'the MOQ pool closes successfully'
    when 'service_month_end' then 'the end of the service month'
    when 'customer_confirmation' then 'your delivery confirmation'
    else '30% at production start, 70% at QC passed and shipped'
  end;

  v_milestones := case v_rule
    when 'milestones' then jsonb_build_array(
      jsonb_build_object('key', 'production_start', 'label', '30% at production start', 'pct', 30, 'amount_cents', round(p_amount_cents * 0.30)::bigint, 'released_cents', 0),
      jsonb_build_object('key', 'qc_shipped', 'label', '70% at QC passed and shipped', 'pct', 70, 'amount_cents', p_amount_cents - round(p_amount_cents * 0.30)::bigint, 'released_cents', 0)
    )
    else jsonb_build_array(
      jsonb_build_object('key', 'full_release', 'label', '100% when ' || v_label, 'pct', 100, 'amount_cents', p_amount_cents, 'released_cents', 0)
    )
  end;

  if p_target_type in ('order', 'dropship_order') then
    v_order_id := p_target_id;
  elsif p_target_type = 'proforma' then
    v_doc_id := p_target_id;
    select order_id into v_order_id from documents where id = p_target_id;
  elsif p_target_type = 'pool_pledge' then
    select pool_id, order_id into v_pool_id, v_order_id from pool_pledges where id = p_target_id;
  end if;

  if p_funding_method = 'wallet' then
    perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || p_org, p_currency)));
    if wallet_balance(p_org, p_currency) < p_amount_cents then
      raise exception 'WALLET_INSUFFICIENT: available % needed %', wallet_balance(p_org, p_currency), p_amount_cents;
    end if;
    v_debit_acct := wallet_account(p_org, p_currency);
  else
    v_debit_acct := cash_account(p_currency);
  end if;

  insert into escrow_holds (
    org_id, division_id, service, target_type, target_id, order_id, document_id, pool_id,
    checkout_id, funding_method, amount_cents, currency, release_rule, milestone_label,
    milestones, auto_release_days, status, idempotency_key, created_by
  )
  values (
    p_org, v_div, p_service, p_target_type, p_target_id, v_order_id, v_doc_id, v_pool_id,
    p_checkout_id, p_funding_method, p_amount_cents, upper(p_currency)::char(3), v_rule, v_label,
    v_milestones, v_days, 'held', p_idempotency_key, auth.uid()
  )
  returning id into v_hold_id;

  -- Book to Held (payment protection) liability account — NEVER revenue!
  v_j := post_journal(
    'Held (payment protection) · ' || p_service || ' · ' || p_target_id::text,
    jsonb_build_array(
      jsonb_build_object('account', v_debit_acct, 'debit', p_amount_cents, 'credit', 0, 'org', case when p_funding_method = 'wallet' then p_org::text else '' end),
      jsonb_build_object('account', protection_hold_account(p_org, p_currency), 'debit', 0, 'credit', p_amount_cents, 'org', p_org)
    ),
    'escrow-hold:' || v_hold_id::text,
    'hold',
    'wallet_hold',
    v_hold_id
  );
  update journals set division_id = v_div where id = v_j;
  update ledger_entries set division_id = v_div where journal_id = v_j;
  update escrow_holds set hold_journal_id = v_j where id = v_hold_id;

  insert into escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
  values
    (v_hold_id, p_org, 'paid', 'Paid upfront', 'Payment received via ' || replace(p_funding_method, '_', ' '), p_amount_cents, auth.uid()),
    (v_hold_id, p_org, 'held', 'Held under Payment protection', 'We hold your payment until ' || v_label, p_amount_cents, auth.uid());

  if v_order_id is not null then
    update orders
       set payment_option = 'payment_protection',
           status = case when status in ('pi_issued', 'deposit_pending') then 'confirmed'::order_status else status end
     where id = v_order_id;
    insert into order_events (order_id, org_id, kind, title, body, created_by)
    values (v_order_id, p_org, 'payment', 'Payment protection active', 'Paid & held until ' || v_label, auth.uid());
  end if;

  perform write_audit(
    'payment_protection.held',
    'escrow_holds',
    v_hold_id::text,
    jsonb_build_object('org_id', p_org, 'service', p_service, 'amount_cents', p_amount_cents, 'funding_method', p_funding_method, 'release_rule', v_rule)
  );
  return v_hold_id;
end $$;
revoke all on function create_escrow_hold_internal(uuid, uuid, text, text, uuid, text, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function create_escrow_hold_internal(uuid, uuid, text, text, uuid, text, bigint, text, text, uuid) to service_role;

-- Customer or staff pays with Payment protection from Wallet balance
create or replace function pay_with_protection_wallet(
  p_service text,
  p_target_type text,
  p_target_id uuid,
  p_amount_cents bigint,
  p_currency text default 'USD',
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := my_org_id();
  v_key text := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''), 'prot-wallet:' || p_target_type || ':' || p_target_id::text);
  v_hold_id uuid;
begin
  if v_org is null then raise exception 'NO_ORG'; end if;
  v_hold_id := create_escrow_hold_internal(
    v_org, null, p_service, p_target_type, p_target_id, 'wallet', p_amount_cents, coalesce(p_currency, 'USD'), v_key, null
  );
  return jsonb_build_object('hold_id', v_hold_id, 'status', 'held');
end $$;
revoke all on function pay_with_protection_wallet(text, text, uuid, bigint, text, text) from public, anon;
grant execute on function pay_with_protection_wallet(text, text, uuid, bigint, text, text) to authenticated, service_role;

-- Customer opens a dispute before release (freezes the held amount)
create or replace function open_escrow_dispute(
  p_hold_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h escrow_holds;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into h from escrow_holds where id = p_hold_id for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  if not (h.org_id in (select my_org_ids()) or is_staff()) then raise exception 'FORBIDDEN'; end if;
  if h.status in ('released', 'refunded') then
    raise exception 'HOLD_ALREADY_CLOSED: cannot open a dispute after full release or refund';
  end if;

  update escrow_holds
     set status = 'disputed',
         dispute_reason = v_reason,
         dispute_opened_by = auth.uid(),
         dispute_opened_at = now(),
         updated_at = now()
   where id = p_hold_id;

  insert into escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
  values (p_hold_id, h.org_id, 'dispute_opened', 'Dispute opened — held funds frozen', v_reason, h.amount_cents - h.released_cents - h.refunded_cents, auth.uid());

  perform write_audit('payment_protection.dispute_opened', 'escrow_holds', p_hold_id::text, jsonb_build_object('org_id', h.org_id, 'reason', v_reason));
  return jsonb_build_object('hold_id', p_hold_id, 'status', 'disputed');
end $$;
revoke all on function open_escrow_dispute(uuid, text) from public, anon;
grant execute on function open_escrow_dispute(uuid, text) to authenticated, service_role;

-- Internal execution of an escrow release or refund (called directly when <= threshold, or when 2nd finance user approves)
create or replace function execute_escrow_action_internal(
  p_hold_id uuid,
  p_action text,
  p_amount_cents bigint,
  p_reason text,
  p_actor uuid,
  p_refund_destination text default 'wallet'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h escrow_holds;
  v_rem bigint;
  v_new_rel bigint;
  v_new_ref bigint;
  v_status text;
  v_inv_id uuid;
  v_inv_no text;
  v_cn_id uuid;
  v_cn_no text;
  v_stream text;
  v_j uuid;
  v_dest_acct uuid;
begin
  select * into h from escrow_holds where id = p_hold_id for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  v_rem := h.amount_cents - h.released_cents - h.refunded_cents;
  if p_amount_cents <= 0 or p_amount_cents > v_rem then
    raise exception 'INVALID_AMOUNT: remaining held % cents, requested % cents', v_rem, p_amount_cents;
  end if;

  v_stream := case h.service
    when 'sourcing' then 'orders'
    when 'advertising' then 'ads'
    else h.service
  end;

  if p_action in ('release', 'partial_release') then
    v_new_rel := h.released_cents + p_amount_cents;
    v_new_ref := h.refunded_cents;
    v_status := case when v_new_rel + v_new_ref >= h.amount_cents then 'released' else 'partially_released' end;

    -- Issue the OCT-[div]-[year]-[seq] tax invoice ONCE on release if it does not already exist
    v_inv_id := h.invoice_id;
    if v_inv_id is null and h.order_id is not null then
      select id into v_inv_id
        from documents
       where order_id = h.order_id and doc_type = 'commercial_invoice' and coalesce(status, '') not in ('void', 'cancelled')
       limit 1;
    end if;

    if v_inv_id is null then
      v_inv_no := next_document_number('invoice', h.division_id, now(), h.legal_entity_id);
      insert into documents (
        org_id, division_id, legal_entity_id, doc_type, number, order_id, amount_cents, paid_cents,
        currency, status, payment_option, from_proforma_id, data
      )
      values (
        h.org_id, h.division_id, h.legal_entity_id, 'commercial_invoice', v_inv_no, h.order_id,
        h.amount_cents, v_new_rel, h.currency,
        case when v_new_rel >= h.amount_cents then 'paid' else 'part_paid' end,
        'payment_protection', h.document_id,
        jsonb_build_object('service', h.service, 'hold_id', h.id, 'payment_option', 'payment_protection', 'released_cents', v_new_rel)
      )
      returning id into v_inv_id;
    else
      update documents
         set paid_cents = least(amount_cents, coalesce(paid_cents, 0) + p_amount_cents),
             status = case when coalesce(paid_cents, 0) + p_amount_cents >= coalesce(amount_cents, 0) then 'paid' else 'part_paid' end
       where id = v_inv_id;
    end if;

    -- Move from Held (payment protection) liability to receivable (settled against the OCT- tax invoice issued above)
    v_dest_acct := receivable_account(h.org_id, h.currency);

    v_j := post_journal(
      'Payment protection released · ' || coalesce(v_inv_no, h.id::text) || ' · ' || p_reason,
      jsonb_build_array(
        jsonb_build_object('account', protection_hold_account(h.org_id, h.currency), 'debit', p_amount_cents, 'credit', 0, 'org', h.org_id),
        jsonb_build_object('account', v_dest_acct, 'debit', 0, 'credit', p_amount_cents, 'org', h.org_id::text)
      ),
      'escrow-rel:' || h.id::text || ':' || v_new_rel::text,
      v_stream,
      'wallet_hold',
      h.id
    );
    update journals set division_id = h.division_id where id = v_j;
    update ledger_entries set division_id = h.division_id where journal_id = v_j;

    update escrow_holds
       set released_cents = v_new_rel,
           status = v_status,
           invoice_id = v_inv_id,
           dispute_resolution = case when h.status = 'disputed' then p_reason else dispute_resolution end,
           dispute_resolved_by = case when h.status = 'disputed' then p_actor else dispute_resolved_by end,
           dispute_resolved_at = case when h.status = 'disputed' then now() else dispute_resolved_at end,
           updated_at = now()
     where id = p_hold_id;

    if h.order_id is not null then
      update orders set paid_cents = least(total_cents, paid_cents + p_amount_cents) where id = h.order_id;
    end if;

    insert into escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
    values
      (p_hold_id, h.org_id, 'milestone_reached', 'Milestone reached', p_reason, p_amount_cents, p_actor),
      (p_hold_id, h.org_id, 'released', case when v_status = 'released' then 'Released in full' else 'Partly released' end, p_reason, p_amount_cents, p_actor);

    perform write_audit(
      'payment_protection.released',
      'escrow_holds',
      p_hold_id::text,
      jsonb_build_object('amount_cents', p_amount_cents, 'status', v_status, 'invoice_id', v_inv_id, 'reason', p_reason)
    );
    return jsonb_build_object('hold_id', p_hold_id, 'status', v_status, 'released_cents', v_new_rel, 'invoice_id', v_inv_id);
  else
    -- Refund from Held (payment protection)
    v_new_rel := h.released_cents;
    v_new_ref := h.refunded_cents + p_amount_cents;
    v_status := case when v_new_rel + v_new_ref >= h.amount_cents then 'refunded' else h.status end;
    if v_status = 'disputed' and v_new_rel + v_new_ref < h.amount_cents then
      v_status := 'partially_released';
    end if;

    v_dest_acct := case when coalesce(p_refund_destination, 'wallet') = 'wallet'
      then wallet_account(h.org_id, h.currency)
      else cash_account(h.currency)
    end;

    v_j := post_journal(
      'Payment protection refund · ' || h.id::text || ' · ' || p_reason,
      jsonb_build_array(
        jsonb_build_object('account', protection_hold_account(h.org_id, h.currency), 'debit', p_amount_cents, 'credit', 0, 'org', h.org_id),
        jsonb_build_object('account', v_dest_acct, 'debit', 0, 'credit', p_amount_cents, 'org', case when coalesce(p_refund_destination, 'wallet') = 'wallet' then h.org_id::text else '' end)
      ),
      'escrow-ref:' || h.id::text || ':' || v_new_ref::text,
      'refunds',
      'wallet_hold',
      h.id
    );
    update journals set division_id = h.division_id where id = v_j;
    update ledger_entries set division_id = h.division_id where journal_id = v_j;

    -- If a tax invoice had already been issued on this hold, issue a CN- credit note against it
    if h.invoice_id is not null then
      v_cn_no := next_document_number('credit_note', h.division_id, now(), h.legal_entity_id);
      insert into documents (
        org_id, division_id, legal_entity_id, doc_type, number, order_id, amount_cents,
        currency, status, original_document_id, data
      )
      values (
        h.org_id, h.division_id, h.legal_entity_id, 'credit_note', v_cn_no, h.order_id, p_amount_cents,
        h.currency, 'issued', h.invoice_id,
        jsonb_build_object('reason', p_reason, 'hold_id', h.id, 'refund_destination', coalesce(p_refund_destination, 'wallet'))
      )
      returning id into v_cn_id;
    end if;

    update escrow_holds
       set refunded_cents = v_new_ref,
           status = v_status,
           dispute_resolution = case when h.status = 'disputed' then p_reason else dispute_resolution end,
           dispute_resolved_by = case when h.status = 'disputed' then p_actor else dispute_resolved_by end,
           dispute_resolved_at = case when h.status = 'disputed' then now() else dispute_resolved_at end,
           updated_at = now()
     where id = p_hold_id;

    insert into escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
    values (p_hold_id, h.org_id, 'refunded', 'Refunded to ' || replace(coalesce(p_refund_destination, 'wallet'), '_', ' '), p_reason, p_amount_cents, p_actor);

    perform write_audit(
      'payment_protection.refunded',
      'escrow_holds',
      p_hold_id::text,
      jsonb_build_object('amount_cents', p_amount_cents, 'status', v_status, 'credit_note_id', v_cn_id, 'destination', coalesce(p_refund_destination, 'wallet'), 'reason', p_reason)
    );
    return jsonb_build_object('hold_id', p_hold_id, 'status', v_status, 'refunded_cents', v_new_ref, 'credit_note_id', v_cn_id);
  end if;
end $$;
revoke all on function execute_escrow_action_internal(uuid, text, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function execute_escrow_action_internal(uuid, text, bigint, text, uuid, text) to service_role;

-- Finance proposes or executes a release / partial_release / refund on an escrow hold
-- Above payments.approval_threshold_cents (default US$ 1,000 = 100000 cents), creates a two-person approval row.
create or replace function finance_act_on_escrow_hold(
  p_hold_id uuid,
  p_action text,
  p_amount_cents bigint default null,
  p_reason text default 'Milestone confirmed',
  p_refund_destination text default 'wallet'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  h escrow_holds;
  v_amt bigint;
  v_threshold bigint := coalesce((select (value #>> '{}')::bigint from site_settings where key = 'payments.approval_threshold_cents'), 100000);
  v_app_id uuid;
begin
  if v_uid is null or not (is_staff() and (can('finance', 'approve') or can('finance', 'edit') or is_admin())) then
    raise exception 'FORBIDDEN';
  end if;
  select * into h from escrow_holds where id = p_hold_id for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  if not in_division(h.division_id) then raise exception 'FORBIDDEN_DIVISION'; end if;
  if p_action not in ('release', 'partial_release', 'refund') then
    raise exception 'INVALID_ACTION';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  v_amt := coalesce(p_amount_cents, h.amount_cents - h.released_cents - h.refunded_cents);
  if v_amt <= 0 or v_amt > (h.amount_cents - h.released_cents - h.refunded_cents) then
    raise exception 'INVALID_AMOUNT';
  end if;

  if convert_amount(v_amt, h.currency, 'USD') > v_threshold then
    insert into escrow_hold_approvals (
      hold_id, action, amount_cents, refund_destination, reason, status, proposed_by
    )
    values (
      p_hold_id, p_action, v_amt, case when p_action = 'refund' then coalesce(p_refund_destination, 'wallet') else null end,
      btrim(p_reason), 'pending', v_uid
    )
    returning id into v_app_id;

    insert into escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
    values (p_hold_id, h.org_id, 'approval_requested', 'Two-person Finance approval requested (' || replace(p_action, '_', ' ') || ')', btrim(p_reason), v_amt, v_uid);

    perform write_audit(
      'payment_protection.approval_proposed',
      'escrow_hold_approvals',
      v_app_id::text,
      jsonb_build_object('hold_id', p_hold_id, 'action', p_action, 'amount_cents', v_amt, 'reason', p_reason)
    );
    return jsonb_build_object('requires_second_approver', true, 'approval_id', v_app_id, 'hold_id', p_hold_id);
  end if;

  return execute_escrow_action_internal(p_hold_id, p_action, v_amt, btrim(p_reason), v_uid, p_refund_destination)
         || jsonb_build_object('requires_second_approver', false);
end $$;
revoke all on function finance_act_on_escrow_hold(uuid, text, bigint, text, text) from public, anon;
grant execute on function finance_act_on_escrow_hold(uuid, text, bigint, text, text) to authenticated, service_role;

-- Second Finance user approves or rejects a held-payment release/refund above threshold (enforces proposed_by <> auth.uid())
create or replace function decide_escrow_hold_approval(
  p_approval_id uuid,
  p_approve boolean,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  a escrow_hold_approvals;
  v_res jsonb;
begin
  if v_uid is null or not (is_staff() and (can('finance', 'approve') or is_admin())) then
    raise exception 'FORBIDDEN';
  end if;
  select * into a from escrow_hold_approvals where id = p_approval_id for update;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if a.status <> 'pending' then raise exception 'INVALID_TRANSITION'; end if;
  if a.proposed_by = v_uid then
    raise exception 'MAKER_CANNOT_APPROVE: releases and refunds above the threshold require a second Finance approver';
  end if;

  if not p_approve then
    update escrow_hold_approvals
       set status = 'rejected', approved_by = v_uid, decision_note = p_note, decided_at = now()
     where id = p_approval_id;
    perform write_audit('payment_protection.approval_rejected', 'escrow_hold_approvals', p_approval_id::text, jsonb_build_object('hold_id', a.hold_id, 'note', p_note));
    return jsonb_build_object('approval_id', p_approval_id, 'status', 'rejected');
  end if;

  update escrow_hold_approvals
     set status = 'approved', approved_by = v_uid, decision_note = p_note, decided_at = now()
   where id = p_approval_id;

  v_res := execute_escrow_action_internal(a.hold_id, a.action, a.amount_cents, a.reason, v_uid, coalesce(a.refund_destination, 'wallet'));
  perform write_audit('payment_protection.approval_approved', 'escrow_hold_approvals', p_approval_id::text, jsonb_build_object('hold_id', a.hold_id, 'note', p_note));
  return v_res || jsonb_build_object('approval_id', p_approval_id, 'approval_status', 'approved');
end $$;
revoke all on function decide_escrow_hold_approval(uuid, boolean, text) from public, anon;
grant execute on function decide_escrow_hold_approval(uuid, boolean, text) to authenticated, service_role;

-- ───────── 5. Refunds: CN-[div]-[year]-[seq] credit note when an OCT- tax invoice exists; ledger reversal only (no CN-) for pre-invoice deposit / proforma / hold refunds ─────────
create or replace function issue_payment_refund(
  p_org uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_reason text,
  p_destination text default 'wallet',
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  inv documents;
  v_key text := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''), 'cn-refund:' || coalesce(p_invoice_id::text, p_org::text) || ':' || p_amount_cents::text);
  v_existing_j uuid;
  v_cn_id uuid;
  v_cn_no text;
  v_j uuid;
  v_credit_acct uuid;
  v_already_credited bigint;
begin
  if v_uid is not null and not (is_staff() and (can('finance', 'approve') or can('finance', 'edit') or is_admin())) then
    raise exception 'FORBIDDEN';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'REASON_REQUIRED'; end if;

  select id into v_existing_j from journals where idempotency_key = v_key;
  if v_existing_j is not null then
    select id, number into v_cn_id, v_cn_no from documents where original_document_id = p_invoice_id and doc_type = 'credit_note' order by created_at desc limit 1;
    return jsonb_build_object('credit_note_id', v_cn_id, 'credit_note_number', v_cn_no, 'journal_id', v_existing_j, 'repeated', true);
  end if;

  select * into inv from documents where id = p_invoice_id for update;
  if inv.id is null then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;
  if inv.org_id <> p_org then raise exception 'ORG_MISMATCH'; end if;

  v_credit_acct := case when coalesce(p_destination, 'wallet') = 'wallet'
    then wallet_account(inv.org_id, inv.currency)
    else cash_account(inv.currency)
  end;

  -- Case A: Pre-invoice deposit / proforma refund (doc_type = 'proforma_invoice', no OCT- tax invoice exists yet):
  -- Refund through ledger reversal ONLY (no CN- credit note is issued because no tax invoice exists).
  if inv.doc_type = 'proforma_invoice' then
    if exists (select 1 from documents where from_proforma_id = inv.id and doc_type = 'commercial_invoice' and coalesce(status, '') not in ('void', 'cancelled')) then
      raise exception 'PROFORMA_ALREADY_INVOICED: refund against the issued commercial_invoice instead';
    end if;
    if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > coalesce(inv.paid_cents, 0) then
      raise exception 'INVALID_AMOUNT: proforma paid % cents, requested refund % cents', coalesce(inv.paid_cents, 0), p_amount_cents;
    end if;

    v_j := post_journal(
      'Deposit refund (pre-invoice) · Proforma ' || inv.number || ' · ' || btrim(p_reason),
      jsonb_build_array(
        jsonb_build_object('account', receivable_account(inv.org_id, inv.currency), 'debit', p_amount_cents, 'credit', 0, 'org', inv.org_id),
        jsonb_build_object('account', v_credit_acct, 'debit', 0, 'credit', p_amount_cents, 'org', case when coalesce(p_destination, 'wallet') = 'wallet' then inv.org_id::text else '' end)
      ),
      v_key,
      'refunds',
      'document',
      inv.id
    );
    update journals set division_id = inv.division_id where id = v_j;
    update ledger_entries set division_id = inv.division_id where journal_id = v_j;

    update documents
       set paid_cents = greatest(0, coalesce(paid_cents, 0) - p_amount_cents),
           status = case when greatest(0, coalesce(paid_cents, 0) - p_amount_cents) = 0 then 'awaiting_payment' else 'part_paid' end
     where id = inv.id;

    perform write_audit(
      'payment.deposit_refund_no_invoice',
      'documents',
      inv.id::text,
      jsonb_build_object('proforma', inv.number, 'amount_cents', p_amount_cents, 'destination', coalesce(p_destination, 'wallet'), 'reason', p_reason)
    );

    return jsonb_build_object('credit_note_id', null, 'credit_note_number', null, 'journal_id', v_j, 'repeated', false);
  end if;

  -- Case B: Invoiced refund (doc_type = 'commercial_invoice') → ALWAYS issues a CN-[div]-[year]-[seq] credit note linked to the OCT- tax invoice
  if inv.doc_type <> 'commercial_invoice' then
    raise exception 'INVOICE_REQUIRED: a credit note refund must reference an issued commercial_invoice (or proforma_invoice for pre-invoice deposit reversal)';
  end if;

  select coalesce(sum(amount_cents), 0)::bigint into v_already_credited
    from documents
   where original_document_id = inv.id and doc_type = 'credit_note' and coalesce(status, '') not in ('void', 'cancelled');

  if p_amount_cents is null or p_amount_cents <= 0 or v_already_credited + p_amount_cents > inv.amount_cents then
    raise exception 'INVALID_AMOUNT: invoice % cents, already credited % cents, requested % cents', inv.amount_cents, v_already_credited, p_amount_cents;
  end if;

  v_cn_no := next_document_number('credit_note', inv.division_id, now(), inv.legal_entity_id);
  insert into documents (
    org_id, division_id, legal_entity_id, doc_type, number, order_id, amount_cents,
    currency, status, original_document_id, data
  )
  values (
    inv.org_id, inv.division_id, inv.legal_entity_id, 'credit_note', v_cn_no, inv.order_id,
    p_amount_cents, inv.currency, 'issued', inv.id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'original_invoice', inv.number,
      'refund_destination', coalesce(p_destination, 'wallet'),
      'currency', inv.currency
    )
  )
  returning id into v_cn_id;

  v_j := post_journal(
    'Refund · Credit note ' || v_cn_no || ' (for ' || inv.number || ') · ' || btrim(p_reason),
    jsonb_build_array(
      jsonb_build_object('account', refunds_account(inv.currency), 'debit', p_amount_cents, 'credit', 0),
      jsonb_build_object('account', v_credit_acct, 'debit', 0, 'credit', p_amount_cents, 'org', case when coalesce(p_destination, 'wallet') = 'wallet' then inv.org_id::text else '' end)
    ),
    v_key,
    'refunds',
    'document',
    v_cn_id
  );
  update journals set division_id = inv.division_id where id = v_j;
  update ledger_entries set division_id = inv.division_id where journal_id = v_j;

  perform write_audit(
    'payment.refund_credit_note_issued',
    'documents',
    v_cn_id::text,
    jsonb_build_object('credit_note', v_cn_no, 'original_invoice', inv.number, 'amount_cents', p_amount_cents, 'destination', coalesce(p_destination, 'wallet'), 'reason', p_reason)
  );

  return jsonb_build_object('credit_note_id', v_cn_id, 'credit_note_number', v_cn_no, 'journal_id', v_j, 'repeated', false);
end $$;
revoke all on function issue_payment_refund(uuid, uuid, bigint, text, text, text) from public, anon;
grant execute on function issue_payment_refund(uuid, uuid, bigint, text, text, text) to authenticated, service_role;

-- ───────── 6. Failed / cancelled pool automatic full refund to everyone ─────────
create or replace function fail_pool_and_refund_all(
  p_pool_id uuid,
  p_reason text default 'Pool closed without reaching target MOQ'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p pools;
  pl pool_pledges;
  h escrow_holds;
  v_refunded_pledges int := 0;
  v_refunded_holds int := 0;
begin
  if auth.uid() is not null and not (is_staff() and (can('orders', 'edit') or can('finance', 'approve') or is_admin())) then
    raise exception 'FORBIDDEN';
  end if;

  select * into p from pools where id = p_pool_id for update;
  if p.id is null then raise exception 'NOT_FOUND'; end if;

  -- 1. Refund every paid pool_pledge deposit from escrow:pools → customer wallet
  for pl in select * from pool_pledges where pool_id = p_pool_id and status in ('paid', 'pending') for update loop
    if pl.status = 'paid' and pl.deposit_minor > 0 then
      perform pool_refund_deposit(pl, 'Pool failed · automatic full refund · ' || p.code, 'poolfail-pledge:' || pl.id::text);
      v_refunded_pledges := v_refunded_pledges + 1;
    end if;
    update pool_pledges set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = pl.id;
  end loop;

  -- 2. Refund every open Payment protection hold linked to this pool or its pledges back to the customer's wallet
  for h in
    select * from escrow_holds
     where (pool_id = p_pool_id or (target_type = 'pool_pledge' and target_id in (select id from pool_pledges where pool_id = p_pool_id)))
       and status in ('held', 'partially_released', 'disputed')
       for update
  loop
    if (h.amount_cents - h.released_cents - h.refunded_cents) > 0 then
      perform execute_escrow_action_internal(
        h.id, 'refund', h.amount_cents - h.released_cents - h.refunded_cents,
        'Pool ' || p.code || ' failed: ' || coalesce(p_reason, 'Automatic full refund to wallet'),
        auth.uid(), 'wallet'
      );
      v_refunded_holds := v_refunded_holds + 1;
    end if;
  end loop;

  update pools set status = 'cancelled', closed_at = now(), updated_at = now() where id = p_pool_id;
  perform pool_log(p_pool_id, 'cancelled', 'Pool closed — deposits refunded', p_reason, 0);
  perform write_audit('pool.failed_auto_refunded', 'pools', p_pool_id::text, jsonb_build_object('refunded_pledges', v_refunded_pledges, 'refunded_holds', v_refunded_holds, 'reason', p_reason));

  return jsonb_build_object('pool_id', p_pool_id, 'status', 'cancelled', 'refunded_pledges', v_refunded_pledges, 'refunded_holds', v_refunded_holds);
end $$;
revoke all on function fail_pool_and_refund_all(uuid, text) from public, anon;
grant execute on function fail_pool_and_refund_all(uuid, text) to authenticated, service_role;

-- ───────── 7. Aggregator Checkout Creation & Signature-Verified Webhook Settlement ─────────
create or replace function create_payment_checkout(
  p_org uuid,
  p_service text,
  p_payment_option text,
  p_target_type text,
  p_target_id uuid,
  p_base_amount_cents bigint,
  p_currency text default 'USD',
  p_method_kind text default 'card',
  p_preferred_provider text default null,
  p_save_payment_method boolean default false,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''), 'chk:' || p_payment_option || ':' || p_target_type || ':' || p_target_id::text);
  v_existing payment_checkouts;
  m payment_option_settings;
  prov payment_provider_settings;
  v_surcharge bigint := 0;
  v_fee bigint := 0;
  v_total bigint;
  v_div uuid;
  v_id uuid;
begin
  if p_org is null then raise exception 'NO_ORG'; end if;
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or is_staff()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_payment_option not in ('pay_now', 'payment_protection') then
    raise exception 'INVALID_PAYMENT_OPTION';
  end if;
  if p_base_amount_cents is null or p_base_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_existing from payment_checkouts where idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'checkout_id', v_existing.id,
      'provider', v_existing.provider,
      'base_amount_cents', v_existing.base_amount_cents,
      'surcharge_cents', v_existing.surcharge_cents,
      'total_amount_cents', v_existing.total_amount_cents,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'repeated', true
    );
  end if;

  select * into m from payment_option_settings where service = p_service and option = p_payment_option;
  if m.service is null or not m.enabled then
    raise exception 'OPTION_DISABLED: % is not enabled for %', p_payment_option, p_service;
  end if;
  if p_base_amount_cents < m.min_amount_cents or (m.max_amount_cents is not null and p_base_amount_cents > m.max_amount_cents) then
    raise exception 'AMOUNT_OUT_OF_RANGE';
  end if;

  -- Pick enabled provider supporting p_method_kind (preferring p_preferred_provider if enabled, else by priority).
  -- Fail closed on environment: 'mock' is ONLY eligible when site_settings.app_environment = 'staging' exactly.
  select * into prov
    from payment_provider_settings
   where enabled
     and (p_method_kind = any(methods) or 'card' = any(methods))
     and (provider <> 'mock' or exists (select 1 from site_settings where key = 'app_environment' and (value #>> '{}') = 'staging'))
   order by (provider = p_preferred_provider) desc, priority asc
   limit 1;

  if prov.provider is null then
    raise exception 'NO_PAYMENT_PROVIDER_ENABLED: no online payment provider is currently switched on';
  end if;

  v_fee := round((p_base_amount_cents * prov.fee_bp) / 10000.0)::bigint + prov.fee_fixed_cents;
  if prov.fee_mode = 'surcharge' then
    v_surcharge := v_fee;
  else
    v_surcharge := 0;
  end if;
  v_total := p_base_amount_cents + v_surcharge;
  v_div := payment_division_for_service(p_service);

  insert into payment_checkouts (
    org_id, division_id, legal_entity_id, service, payment_option, target_type, target_id,
    base_amount_cents, surcharge_cents, provider_fee_cents, total_amount_cents, currency,
    provider, method_kind, save_payment_method, status, idempotency_key, created_by
  )
  values (
    p_org, v_div, prov.legal_entity_id, p_service, p_payment_option, p_target_type, p_target_id,
    p_base_amount_cents, v_surcharge, v_fee, v_total, upper(coalesce(p_currency, 'USD'))::char(3),
    prov.provider, coalesce(p_method_kind, 'card'), coalesce(p_save_payment_method, false), 'pending', v_key, auth.uid()
  )
  returning id into v_id;

  update payment_checkouts set provider_session_id = prov.provider || '_sess_' || replace(v_id::text, '-', '') where id = v_id;

  return jsonb_build_object(
    'checkout_id', v_id,
    'provider', prov.provider,
    'provider_session_id', prov.provider || '_sess_' || replace(v_id::text, '-', ''),
    'base_amount_cents', p_base_amount_cents,
    'surcharge_cents', v_surcharge,
    'total_amount_cents', v_total,
    'currency', upper(coalesce(p_currency, 'USD')),
    'status', 'pending',
    'repeated', false
  );
end $$;
revoke all on function create_payment_checkout(uuid, text, text, text, uuid, bigint, text, text, text, boolean, text) from public, anon;
grant execute on function create_payment_checkout(uuid, text, text, text, uuid, bigint, text, text, text, boolean, text) to authenticated, service_role;

-- Signature-verified webhook settlement (service_role only — NEVER callable from browser redirect)
create or replace function confirm_aggregator_webhook(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_checkout_id uuid,
  p_amount_cents bigint,
  p_currency text,
  p_provider_payment_id text default null,
  p_provider_customer_id text default null,
  p_provider_payment_method_id text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing payment_webhook_events;
  chk payment_checkouts;
  v_j uuid;
  v_hold_id uuid;
  v_pay_id uuid;
  v_proforma_res jsonb;
  v_pledge pool_pledges;
  v_pool pools;
begin
  if btrim(coalesce(p_event_id, '')) = '' then raise exception 'EVENT_ID_REQUIRED'; end if;

  -- 1. Idempotency check on (provider, event_id)
  select * into v_existing from payment_webhook_events where provider = p_provider and event_id = p_event_id;
  if v_existing.id is not null then
    return jsonb_build_object('webhook_event_id', v_existing.id, 'checkout_id', v_existing.checkout_id, 'journal_id', v_existing.journal_id, 'repeated', true);
  end if;

  select * into chk from payment_checkouts where id = p_checkout_id for update;
  if chk.id is null then raise exception 'CHECKOUT_NOT_FOUND'; end if;

  -- 2. Re-check amount and currency on the server (reject tampered webhook payloads)
  if p_amount_cents is distinct from chk.total_amount_cents then
    raise exception 'WEBHOOK_AMOUNT_MISMATCH: checkout expects % cents, webhook reported % cents', chk.total_amount_cents, p_amount_cents;
  end if;
  if upper(btrim(coalesce(p_currency, ''))) is distinct from btrim(chk.currency) then
    raise exception 'WEBHOOK_CURRENCY_MISMATCH: checkout expects %, webhook reported %', chk.currency, p_currency;
  end if;

  -- If checkout was already paid by an earlier distinct event_id, record event without double-posting
  if chk.status = 'paid' then
    insert into payment_webhook_events (provider, event_id, event_type, checkout_id, amount_cents, currency, journal_id, payload)
    values (p_provider, p_event_id, p_event_type, chk.id, p_amount_cents, chk.currency, chk.journal_id, coalesce(p_payload, '{}'::jsonb));
    return jsonb_build_object('checkout_id', chk.id, 'journal_id', chk.journal_id, 'hold_id', chk.hold_id, 'repeated', true);
  end if;

  -- Save payment method IDs only (never card numbers or bank details) if customer consented
  if chk.save_payment_method and nullif(btrim(coalesce(p_provider_customer_id, '')), '') is not null
     and nullif(btrim(coalesce(p_provider_payment_method_id, '')), '') is not null then
    insert into customer_payment_methods (
      org_id, provider, provider_customer_id, provider_payment_method_id,
      method_kind, label, consented_for_recurring, consented_at, is_default
    )
    values (
      chk.org_id, p_provider, btrim(p_provider_customer_id), btrim(p_provider_payment_method_id),
      chk.method_kind, initcap(p_provider) || ' ' || chk.method_kind, true, now(), true
    )
    on conflict (org_id, provider, provider_payment_method_id) do update
      set consented_for_recurring = true, consented_at = now(), is_default = true;
  end if;

  -- 3. Settle according to payment_option ('payment_protection' vs 'pay_now')
  if chk.payment_option = 'payment_protection' then
    v_hold_id := create_escrow_hold_internal(
      chk.org_id, chk.division_id, chk.service, chk.target_type, chk.target_id,
      'aggregator', chk.base_amount_cents, chk.currency, 'chk-hold:' || chk.id::text, chk.id
    );
    select hold_journal_id into v_j from escrow_holds where id = v_hold_id;

    -- If there was a surcharge, post it to cash:bank / rev:service_fees
    if chk.surcharge_cents > 0 then
      perform post_journal(
        'Payment aggregator surcharge · ' || chk.id::text,
        jsonb_build_array(
          jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.surcharge_cents, 'credit', 0),
          jsonb_build_object('account', revenue_account('service_fees', chk.currency), 'debit', 0, 'credit', chk.surcharge_cents)
        ),
        'chk-surcharge:' || chk.id::text,
        'service_fees',
        'payment',
        chk.id
      );
    end if;

    if chk.target_type = 'pool_pledge' then
      update pool_pledges set status = 'paid', paid_at = now(), updated_at = now() where id = chk.target_id;
    end if;
  else
    -- 'pay_now' via aggregator
    if chk.target_type in ('order', 'dropship_order') then
      declare
        v_ord orders;
        v_pay_j uuid;
        v_new_paid bigint;
        v_new_st order_status;
      begin
        select * into v_ord from orders where id = chk.target_id for update;
        if v_ord.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
        insert into payments (order_id, org_id, division_id, legal_entity_id, purpose, method, amount_cents, currency, status, reference, provider_event_id, confirmed_at)
        values (
          v_ord.id, chk.org_id, coalesce(v_ord.division_id, chk.division_id), chk.legal_entity_id,
          case when v_ord.paid_cents < v_ord.deposit_cents then 'deposit' else 'balance' end,
          p_provider, chk.base_amount_cents, chk.currency, 'confirmed',
          coalesce(p_provider_payment_id, p_event_id), p_provider || ':' || p_event_id, now()
        )
        returning id into v_pay_id;

        v_pay_j := post_journal(
          'Order payment (' || p_provider || ') · ' || coalesce(v_ord.code, v_ord.id::text),
          jsonb_build_array(
            jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.base_amount_cents, 'credit', 0),
            jsonb_build_object(
              'account',
              case when exists (select 1 from journals where idempotency_key = 'pi:' || v_ord.id::text)
                then receivable_account(chk.org_id, chk.currency)
                else revenue_account('orders', chk.currency)
              end,
              'debit', 0, 'credit', chk.base_amount_cents,
              'org', case when exists (select 1 from journals where idempotency_key = 'pi:' || v_ord.id::text) then chk.org_id::text else '' end
            )
          ),
          'pay:' || v_pay_id::text,
          'orders',
          'payment',
          v_pay_id
        );
        update journals set division_id = coalesce(v_ord.division_id, chk.division_id) where id = v_pay_j;
        update ledger_entries set division_id = coalesce(v_ord.division_id, chk.division_id) where journal_id = v_pay_j;
        v_j := v_pay_j;

        v_new_paid := v_ord.paid_cents + chk.base_amount_cents;
        v_new_st := v_ord.status;
        if v_ord.status in ('pi_issued', 'deposit_pending') and v_new_paid >= v_ord.deposit_cents then
          v_new_st := 'deposit_paid';
        elsif v_ord.status = 'balance_pending' and v_new_paid >= v_ord.total_cents then
          v_new_st := 'balance_paid';
        end if;
        update orders set paid_cents = v_new_paid, status = v_new_st, payment_option = 'pay_now', updated_at = now() where id = v_ord.id;
        insert into order_events (order_id, org_id, kind, title, body)
        values (v_ord.id, chk.org_id, 'payment', 'Paid via ' || initcap(p_provider), ((chk.base_amount_cents / 100.0)::numeric(12,2)) || ' ' || chk.currency);
      end;
    elsif chk.target_type = 'proforma' then
      declare
        v_pf documents;
        v_pf_new_paid bigint;
        v_pf_st text;
        v_inv_id uuid;
        v_inv_no text;
      begin
        select * into v_pf from documents where id = chk.target_id for update;
        if v_pf.id is null then raise exception 'DOCUMENT_NOT_FOUND'; end if;
        v_j := post_journal(
          'Proforma ' || v_pf.number || ' paid via ' || p_provider,
          jsonb_build_array(
            jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.base_amount_cents, 'credit', 0),
            jsonb_build_object('account', receivable_account(chk.org_id, chk.currency), 'debit', 0, 'credit', chk.base_amount_cents, 'org', chk.org_id)
          ),
          'chk-pf:' || chk.id::text,
          coalesce(v_pf.data ->> 'stream', 'service_fees'),
          'document',
          v_pf.id
        );
        update journals set division_id = v_pf.division_id where id = v_j;
        update ledger_entries set division_id = v_pf.division_id where journal_id = v_j;

        insert into document_payments (document_id, org_id, legal_entity_id, method, amount_cents, currency, reference, journal_id, idempotency_key)
        values (v_pf.id, chk.org_id, chk.legal_entity_id, 'bank_transfer', chk.base_amount_cents, chk.currency, coalesce(p_provider_payment_id, p_event_id), v_j, 'chk-pf:' || chk.id::text);

        v_pf_new_paid := coalesce(v_pf.paid_cents, 0) + chk.base_amount_cents;
        v_pf_st := case when v_pf_new_paid >= v_pf.amount_cents then 'invoiced' else 'part_paid' end;
        update documents set paid_cents = v_pf_new_paid, status = v_pf_st, payment_option = 'pay_now' where id = v_pf.id;

        if v_pf_st = 'invoiced' then
          v_inv_no := next_document_number('invoice', v_pf.division_id, now(), v_pf.legal_entity_id);
          insert into documents (
            org_id, division_id, legal_entity_id, doc_type, number, order_id, amount_cents, paid_cents,
            currency, status, payment_option, from_proforma_id, data
          )
          values (
            v_pf.org_id, v_pf.division_id, v_pf.legal_entity_id, 'commercial_invoice', v_inv_no, v_pf.order_id,
            v_pf.amount_cents, v_pf_new_paid, v_pf.currency, 'paid', 'pay_now', v_pf.id,
            coalesce(v_pf.data, '{}'::jsonb) || jsonb_build_object('from_proforma', v_pf.number, 'paid_cents', v_pf_new_paid, 'balance_cents', 0)
          )
          returning id into v_inv_id;
        end if;
      end;
    elsif chk.target_type = 'pool_pledge' then
      select * into v_pledge from pool_pledges where id = chk.target_id for update;
      select * into v_pool from pools where id = v_pledge.pool_id;
      v_j := post_journal(
        'Group-buy deposit (' || p_provider || ') · ' || coalesce(v_pool.code, ''),
        jsonb_build_array(
          jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.base_amount_cents, 'credit', 0),
          jsonb_build_object('account', escrow_account(chk.currency), 'debit', 0, 'credit', chk.base_amount_cents)
        ),
        'pooldep-agg:' || chk.id::text,
        'pools',
        'pool_pledge',
        chk.target_id
      );
      update journals set division_id = division_id_of('POOL') where id = v_j;
      update ledger_entries set division_id = division_id_of('POOL') where journal_id = v_j;
      update pool_pledges set status = 'paid', paid_at = now(), updated_at = now() where id = chk.target_id;
    elsif chk.target_type = 'wallet_topup' then
      v_j := post_journal(
        'Wallet top-up (' || p_provider || ') · ' || coalesce(p_provider_payment_id, p_event_id),
        jsonb_build_array(
          jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.base_amount_cents, 'credit', 0),
          jsonb_build_object('account', wallet_account(chk.org_id, chk.currency), 'debit', 0, 'credit', chk.base_amount_cents, 'org', chk.org_id)
        ),
        'topup-agg:' || chk.id::text,
        'topup',
        'wallet_topup',
        chk.id
      );
    else
      -- saas_subscription / ad_campaign / service_request
      v_j := post_journal(
        initcap(chk.service) || ' payment (' || p_provider || ') · ' || coalesce(p_provider_payment_id, p_event_id),
        jsonb_build_array(
          jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.base_amount_cents, 'credit', 0),
          jsonb_build_object('account', revenue_account(case chk.service when 'advertising' then 'ads' when 'saas' then 'service_fees' else chk.service end, chk.currency), 'debit', 0, 'credit', chk.base_amount_cents)
        ),
        'pay-agg:' || chk.id::text,
        case chk.service when 'advertising' then 'ads' when 'saas' then 'service_fees' else chk.service end,
        'payment',
        chk.id
      );
      if chk.division_id is not null then
        update journals set division_id = chk.division_id where id = v_j;
        update ledger_entries set division_id = chk.division_id where journal_id = v_j;
      end if;

      if chk.target_type = 'saas_subscription' then
        declare
          v_sub saas_subscriptions;
          v_inv_no text := next_document_number('invoice', chk.division_id, now(), chk.legal_entity_id);
          v_inv_id uuid;
        begin
          select * into v_sub from saas_subscriptions where id = chk.target_id;
          insert into documents (
            org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents,
            currency, status, payment_option, data
          )
          values (
            chk.org_id, chk.division_id, chk.legal_entity_id, 'commercial_invoice', v_inv_no,
            chk.base_amount_cents, chk.base_amount_cents, chk.currency, 'paid', 'pay_now',
            jsonb_build_object('service', 'saas', 'subscription_id', chk.target_id, 'plan_code', v_sub.plan_code)
          )
          returning id into v_inv_id;
          update saas_subscriptions set status = 'active', current_document_id = v_inv_id, updated_at = now() where id = chk.target_id;
        end;
      end if;
    end if;

    if chk.surcharge_cents > 0 then
      perform post_journal(
        'Payment aggregator surcharge · ' || chk.id::text,
        jsonb_build_array(
          jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.surcharge_cents, 'credit', 0),
          jsonb_build_object('account', revenue_account('service_fees', chk.currency), 'debit', 0, 'credit', chk.surcharge_cents)
        ),
        'chk-surcharge:' || chk.id::text,
        'service_fees',
        'payment',
        chk.id
      );
    end if;
  end if;

  update payment_checkouts
     set status = 'paid',
         provider_payment_id = coalesce(p_provider_payment_id, p_event_id),
         journal_id = v_j,
         hold_id = v_hold_id,
         paid_at = now(),
         updated_at = now()
   where id = chk.id;

  insert into payment_webhook_events (provider, event_id, event_type, checkout_id, amount_cents, currency, journal_id, payload)
  values (p_provider, p_event_id, p_event_type, chk.id, p_amount_cents, chk.currency, v_j, coalesce(p_payload, '{}'::jsonb));

  -- Record settlement row for daily reconciliation
  insert into payment_settlements (provider, provider_payment_id, checkout_id, gross_amount_cents, fee_amount_cents, net_amount_cents, currency)
  values (p_provider, coalesce(p_provider_payment_id, p_event_id), chk.id, chk.total_amount_cents, chk.provider_fee_cents, chk.total_amount_cents - chk.provider_fee_cents, chk.currency)
  on conflict (provider, provider_payment_id) do nothing;

  perform write_audit(
    'payment.webhook_confirmed',
    'payment_checkouts',
    chk.id::text,
    jsonb_build_object('provider', p_provider, 'event_id', p_event_id, 'payment_option', chk.payment_option, 'amount_cents', chk.total_amount_cents, 'journal_id', v_j, 'hold_id', v_hold_id)
  );

  return jsonb_build_object('checkout_id', chk.id, 'journal_id', v_j, 'hold_id', v_hold_id, 'status', 'paid', 'repeated', false);
end $$;
revoke all on function confirm_aggregator_webhook(text, text, text, uuid, bigint, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function confirm_aggregator_webhook(text, text, text, uuid, bigint, text, text, text, text, jsonb) to service_role;

-- ───────── 8. Daily Reconciliation, Pool Pledge Expiry & Credit/SaaS Overdue Reminders ─────────
create or replace function run_payment_reconciliation() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s payment_settlements;
  chk payment_checkouts;
  v_checked int := 0;
  v_alerts int := 0;
begin
  if auth.uid() is not null and not (is_staff() and can('finance', 'view')) then
    raise exception 'FORBIDDEN';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('cron:run_payment_reconciliation')) then
    return jsonb_build_object('skipped', true, 'reason', 'lock_held');
  end if;

  for s in select * from payment_settlements where not reconciled for update loop
    v_checked := v_checked + 1;
    select * into chk from payment_checkouts where id = s.checkout_id;
    if chk.id is null or chk.journal_id is null then
      insert into payment_reconciliation_alerts (provider, provider_payment_id, checkout_id, kind, expected_cents, actual_cents, currency, detail)
      values (s.provider, s.provider_payment_id, s.checkout_id, 'missing_in_ledger', s.gross_amount_cents, 0, s.currency,
              'Settlement ' || s.provider_payment_id || ' has no matching ledger journal');
      v_alerts := v_alerts + 1;
    elsif chk.total_amount_cents <> s.gross_amount_cents then
      insert into payment_reconciliation_alerts (provider, provider_payment_id, checkout_id, kind, expected_cents, actual_cents, currency, detail)
      values (s.provider, s.provider_payment_id, s.checkout_id, 'amount_mismatch', chk.total_amount_cents, s.gross_amount_cents, s.currency,
              format('Checkout expected %s cents, settlement reported %s cents', chk.total_amount_cents, s.gross_amount_cents));
      v_alerts := v_alerts + 1;
    end if;
    update payment_settlements set reconciled = true, reconciled_at = now() where id = s.id;
  end loop;

  return jsonb_build_object('checked', v_checked, 'alerts_raised', v_alerts);
end $$;
revoke all on function run_payment_reconciliation() from public, anon;
grant execute on function run_payment_reconciliation() to authenticated, service_role;

-- Expire unpaid aggregator pool pledges and checkouts, and send Pay-later due/overdue reminders + SaaS suspension
create or replace function run_credit_and_saas_overdue_check() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_exp_min int := coalesce((select (value #>> '{}')::int from site_settings where key = 'payments.pool_pledge_expiry_minutes'), 60);
  v_grace int := coalesce((select (value #>> '{}')::int from site_settings where key = 'payments.pay_later_grace_days'), 7);
  v_notice int := coalesce((select (value #>> '{}')::int from site_settings where key = 'payments.saas_suspend_notice_days'), 7);
  v_expired_pledges int := 0;
  v_reminders int := 0;
  v_blocked int := 0;
  v_suspended int := 0;
  pl pool_pledges;
  d documents;
  sub saas_subscriptions;
  v_stage text;
  v_days_diff int;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:run_credit_and_saas_overdue_check')) then
    return jsonb_build_object('skipped', true, 'reason', 'lock_held');
  end if;
  -- 1. Expire unpaid ('pending') pool pledges older than v_exp_min
  for pl in
    select * from pool_pledges
     where status = 'pending'
       and joined_at < now() - make_interval(mins => v_exp_min)
       for update
  loop
    update pool_pledges set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = pl.id;
    update pools set filled_qty = greatest(0, filled_qty - pl.qty) where id = pl.pool_id;
    v_expired_pledges := v_expired_pledges + 1;
  end loop;

  -- 2. Pay-later invoice reminders (-3d, 0d, +3d, +7d, +14d)
  for d in
    select * from documents
     where doc_type = 'commercial_invoice'
       and coalesce(status, '') not in ('paid', 'void', 'cancelled')
       and coalesce(amount_cents, 0) > coalesce(paid_cents, 0)
       and due_at is not null
       for update
  loop
    v_days_diff := floor(extract(epoch from (now() - d.due_at)) / 86400.0)::int;
    v_stage := case
      when v_days_diff >= 14 then 'overdue_14d'
      when v_days_diff >= 7  then 'overdue_7d'
      when v_days_diff >= 3  then 'overdue_3d'
      when v_days_diff >= 0  then 'due_today'
      when v_days_diff >= -3 then 'due_in_3d'
      else null
    end;

    if v_stage is not null and coalesce(d.last_reminder_stage, '') <> v_stage then
      update documents set last_reminder_stage = v_stage where id = d.id;
      insert into notifications (org_id, division_id, title, body, link)
      values (
        d.org_id, d.division_id,
        'Invoice ' || d.number || ' · ' || replace(v_stage, '_', ' '),
        'Amount due: ' || ((d.amount_cents - d.paid_cents) / 100.0)::numeric(12,2) || ' ' || d.currency,
        '/account/invoices'
      );
      perform emit_event('invoice.reminder', 'document', d.id, jsonb_build_object('org_id', d.org_id, 'number', d.number, 'stage', v_stage, 'due_at', d.due_at));
      v_reminders := v_reminders + 1;
    end if;

    if v_days_diff > v_grace then
      update customer_credit_terms
         set overdue_blocked = true, updated_at = now()
       where org_id = d.org_id and not overdue_blocked;
      if found then v_blocked := v_blocked + 1; end if;
    end if;
  end loop;

  -- 3. Overdue SaaS subscriptions: warn after grace period, suspend after grace + notice period
  for sub in
    select s.*
      from saas_subscriptions s
      join documents inv on inv.id = s.current_document_id
     where s.status in ('active', 'past_due')
       and coalesce(inv.status, '') not in ('paid', 'void', 'cancelled')
       and inv.due_at is not null
       and inv.due_at + make_interval(days => v_grace) < now()
       for update of s
  loop
    if sub.grace_warned_at is null then
      update saas_subscriptions set status = 'past_due', grace_warned_at = now(), updated_at = now() where id = sub.id;
      insert into notifications (org_id, division_id, title, body, link)
      values (sub.org_id, sub.division_id, 'SaaS subscription past due — warning', 'Please settle your overdue subscription invoice to avoid service suspension.', '/account/invoices');
    elsif sub.grace_warned_at + make_interval(days => v_notice) < now() then
      update saas_subscriptions set status = 'suspended', suspended_at = now(), updated_at = now() where id = sub.id;
      insert into notifications (org_id, division_id, title, body, link)
      values (sub.org_id, sub.division_id, 'SaaS subscription suspended', 'Your subscription was suspended due to an unpaid overdue invoice.', '/account/invoices');
      v_suspended := v_suspended + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'expired_pledges', v_expired_pledges,
    'reminders_sent', v_reminders,
    'orgs_overdue_blocked', v_blocked,
    'saas_suspended', v_suspended
  );
end $$;
revoke all on function run_credit_and_saas_overdue_check() from public, anon;
grant execute on function run_credit_and_saas_overdue_check() to authenticated, service_role;

-- ───────── 9. Dropshipping Weekly Statement & SaaS Subscription Checkout ─────────
create or replace function generate_dropship_weekly_statement(
  p_org uuid,
  p_from timestamptz default (now() - interval '7 days'),
  p_to timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_div uuid := division_id_of('DS');
  v_items jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_unpaid bigint := 0;
  v_stmt_id uuid;
  v_stmt_no text;
  d record;
begin
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or (is_staff() and can('finance', 'view'))) then
    raise exception 'FORBIDDEN';
  end if;

  for d in
    select id, number, order_id, amount_cents, paid_cents, currency, status, due_at, created_at
      from documents
     where org_id = p_org
       and division_id = v_div
       and doc_type = 'commercial_invoice'
       and coalesce(status, '') not in ('void', 'cancelled')
       and created_at >= p_from
       and created_at <= p_to
     order by created_at asc
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'invoice_id', d.id,
      'number', d.number,
      'order_id', d.order_id,
      'amount_cents', d.amount_cents,
      'paid_cents', d.paid_cents,
      'balance_cents', greatest(0, d.amount_cents - d.paid_cents),
      'currency', d.currency,
      'status', d.status,
      'due_at', d.due_at,
      'issued_at', d.created_at
    ));
    v_total := v_total + coalesce(d.amount_cents, 0);
    v_unpaid := v_unpaid + greatest(0, coalesce(d.amount_cents, 0) - coalesce(d.paid_cents, 0));
  end loop;

  v_stmt_no := 'STMT-DS-' || to_char(p_to at time zone 'UTC', 'YYYYMMDD') || '-' || substr(replace(p_org::text, '-', ''), 1, 6);

  select id into v_stmt_id from documents where org_id = p_org and doc_type = 'statement' and number = v_stmt_no limit 1;
  if v_stmt_id is not null then
    return jsonb_build_object(
      'statement_id', v_stmt_id,
      'number', v_stmt_no,
      'invoice_count', jsonb_array_length(v_items),
      'total_cents', v_total,
      'unpaid_cents', v_unpaid,
      'repeated', true
    );
  end if;

  insert into documents (
    org_id, division_id, doc_type, number, amount_cents, paid_cents, currency, status, data
  )
  values (
    p_org, v_div, 'statement', v_stmt_no, v_total, v_total - v_unpaid, 'USD',
    case when v_unpaid = 0 then 'paid' else 'awaiting_payment' end,
    jsonb_build_object(
      'period_from', p_from,
      'period_to', p_to,
      'invoice_count', jsonb_array_length(v_items),
      'total_cents', v_total,
      'unpaid_cents', v_unpaid,
      'invoices', v_items
    )
  )
  returning id into v_stmt_id;

  return jsonb_build_object(
    'statement_id', v_stmt_id,
    'number', v_stmt_no,
    'invoice_count', jsonb_array_length(v_items),
    'total_cents', v_total,
    'unpaid_cents', v_unpaid
  );
end $$;
revoke all on function generate_dropship_weekly_statement(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function generate_dropship_weekly_statement(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Subscribe to a SaaS plan using Pay now (wallet or aggregator) or Pay later (Net credit terms)
create or replace function subscribe_saas_plan(
  p_org uuid,
  p_plan_code text,
  p_payment_option text default 'pay_now',
  p_method_kind text default 'card',
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pl saas_plans;
  v_sub_id uuid;
  v_period_end timestamptz;
  v_div uuid := division_id_of('SRC');
  v_res jsonb;
  v_inv_no text;
  v_inv_id uuid;
  v_j uuid;
begin
  if p_org is null then raise exception 'NO_ORG'; end if;
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or is_staff()) then
    raise exception 'FORBIDDEN';
  end if;
  select * into pl from saas_plans where code = p_plan_code and active;
  if pl.code is null then raise exception 'PLAN_NOT_FOUND'; end if;

  v_period_end := case when pl.billing_interval = 'annual' then now() + interval '1 year' else now() + interval '1 month' end;

  insert into saas_subscriptions (
    org_id, division_id, plan_code, status, payment_option,
    current_period_start, current_period_end, created_by
  )
  values (
    p_org, v_div, pl.code, 'trialing', p_payment_option,
    now(), v_period_end, auth.uid()
  )
  returning id into v_sub_id;

  if p_payment_option = 'pay_later' then
    v_res := checkout_pay_later(p_org, 'saas', 'saas_subscription', v_sub_id, pl.price_cents, pl.currency, coalesce(p_idempotency_key, 'saas-pl:' || v_sub_id::text));
    update saas_subscriptions
       set status = 'active',
           current_document_id = (v_res ->> 'invoice_id')::uuid,
           updated_at = now()
     where id = v_sub_id;
    return v_res || jsonb_build_object('subscription_id', v_sub_id, 'plan_code', pl.code);
  elsif p_payment_option = 'pay_now' and p_method_kind = 'wallet' then
    perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || p_org, pl.currency)));
    if wallet_balance(p_org, pl.currency) < pl.price_cents then
      raise exception 'WALLET_INSUFFICIENT: available % needed %', wallet_balance(p_org, pl.currency), pl.price_cents;
    end if;
    v_inv_no := next_document_number('invoice', v_div);
    insert into documents (
      org_id, division_id, doc_type, number, amount_cents, paid_cents, currency, status, payment_option, data
    )
    values (
      p_org, v_div, 'commercial_invoice', v_inv_no, pl.price_cents, pl.price_cents, pl.currency, 'paid', 'pay_now',
      jsonb_build_object('service', 'saas', 'subscription_id', v_sub_id, 'plan_code', pl.code, 'title', pl.name)
    )
    returning id into v_inv_id;

    v_j := post_journal(
      'SaaS subscription (' || pl.name || ') · Wallet',
      jsonb_build_array(
        jsonb_build_object('account', wallet_account(p_org, pl.currency), 'debit', pl.price_cents, 'credit', 0, 'org', p_org),
        jsonb_build_object('account', revenue_account('service_fees', pl.currency), 'debit', 0, 'credit', pl.price_cents)
      ),
      coalesce(p_idempotency_key, 'saas-wal:' || v_sub_id::text),
      'service_fees',
      'document',
      v_inv_id
    );
    update journals set division_id = v_div where id = v_j;
    update ledger_entries set division_id = v_div where journal_id = v_j;
    update saas_subscriptions set status = 'active', current_document_id = v_inv_id, updated_at = now() where id = v_sub_id;
    return jsonb_build_object('subscription_id', v_sub_id, 'invoice_id', v_inv_id, 'invoice_number', v_inv_no, 'status', 'active');
  else
    -- Online aggregator checkout (or payment_protection if enabled by admin)
    v_res := create_payment_checkout(
      p_org, 'saas', p_payment_option, 'saas_subscription', v_sub_id,
      pl.price_cents, pl.currency, p_method_kind, null, true,
      coalesce(p_idempotency_key, 'saas-chk:' || v_sub_id::text)
    );
    return v_res || jsonb_build_object('subscription_id', v_sub_id, 'plan_code', pl.code);
  end if;
end $$;
revoke all on function subscribe_saas_plan(uuid, text, text, text, text) from public, anon;
grant execute on function subscribe_saas_plan(uuid, text, text, text, text) to authenticated, service_role;

-- Weekly batch runner for Dropshipping Pay-later statements (called by pg_cron every Monday 01:15 UTC)
create or replace function run_weekly_dropship_statements() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_div uuid := division_id_of('DS');
  v_from timestamptz := date_trunc('week', now() at time zone 'UTC') - interval '7 days';
  v_to timestamptz := date_trunc('week', now() at time zone 'UTC');
  v_org uuid;
  v_generated int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:run_weekly_dropship_statements')) then
    return jsonb_build_object('skipped', true, 'reason', 'lock_held');
  end if;
  for v_org in
    select distinct org_id
      from documents
     where division_id = v_div
       and doc_type = 'commercial_invoice'
       and payment_option = 'pay_later'
       and coalesce(status, '') not in ('void', 'cancelled')
       and created_at >= v_from
       and created_at <= v_to
  loop
    perform generate_dropship_weekly_statement(v_org, v_from, v_to);
    v_generated := v_generated + 1;
  end loop;
  return jsonb_build_object('statements_generated', v_generated, 'period_from', v_from, 'period_to', v_to);
end $$;
revoke all on function run_weekly_dropship_statements() from public, anon, authenticated;
grant execute on function run_weekly_dropship_statements() to service_role;

-- Schedule payment reconciliation, credit/SaaS overdue checks, and weekly Dropshipping statements in pg_cron (single source of truth — not in vercel.json so they never double-run)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'octopus-payment-reconciliation') then
      perform cron.unschedule('octopus-payment-reconciliation');
    end if;
    perform cron.schedule('octopus-payment-reconciliation', '50 0 * * *', 'select public.run_payment_reconciliation()');

    if exists (select 1 from cron.job where jobname = 'octopus-credit-overdue') then
      perform cron.unschedule('octopus-credit-overdue');
    end if;
    perform cron.schedule('octopus-credit-overdue', '55 0 * * *', 'select public.run_credit_and_saas_overdue_check()');

    if exists (select 1 from cron.job where jobname = 'octopus-dropship-weekly-statements') then
      perform cron.unschedule('octopus-dropship-weekly-statements');
    end if;
    perform cron.schedule('octopus-dropship-weekly-statements', '15 1 * * 1', 'select public.run_weekly_dropship_statements()');
  end if;
end $$;
