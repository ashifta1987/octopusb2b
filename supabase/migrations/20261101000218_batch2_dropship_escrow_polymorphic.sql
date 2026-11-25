-- 20261101000218_batch2_dropship_escrow_polymorphic.sql
-- Phase 2 · Batch 2 (F-03): Polymorphic targets (order_id XOR store_order_id) on escrow_holds
-- and payment_checkouts, plus dropship_order support in create_escrow_hold_internal,
-- execute_escrow_action_internal, create_payment_checkout, confirm_aggregator_webhook, and
-- get_store_order_escrow_info.
-- Down: supabase/migrations/down/20261101000218_batch2_dropship_escrow_polymorphic.down.sql

-- ───────── 1. Polymorphic order_id XOR store_order_id on escrow_holds & payment_checkouts ─────────
alter table public.escrow_holds
  add column if not exists store_order_id uuid references public.store_orders(id) on delete restrict;

create index if not exists escrow_holds_store_order_idx
  on public.escrow_holds (store_order_id);

grant select (store_order_id) on public.escrow_holds to authenticated;

update public.escrow_holds
   set order_id = target_id,
       store_order_id = null
 where target_type = 'order'
   and (order_id is null or order_id <> target_id or store_order_id is not null);

update public.escrow_holds
   set store_order_id = target_id,
       order_id = null
 where target_type = 'dropship_order'
   and (store_order_id is null or store_order_id <> target_id or order_id is not null);

alter table public.escrow_holds drop constraint if exists escrow_holds_order_target_xor_check;
alter table public.escrow_holds
  add constraint escrow_holds_order_target_xor_check check (
    not (order_id is not null and store_order_id is not null)
    and (
      (target_type = 'order' and order_id is not null and order_id = target_id and store_order_id is null)
      or (target_type = 'dropship_order' and store_order_id is not null and store_order_id = target_id and order_id is null)
      or (target_type not in ('order', 'dropship_order') and store_order_id is null)
    )
  );

alter table public.payment_checkouts
  add column if not exists order_id uuid references public.orders(id) on delete restrict,
  add column if not exists store_order_id uuid references public.store_orders(id) on delete restrict;

create index if not exists payment_checkouts_order_idx
  on public.payment_checkouts (order_id);

create index if not exists payment_checkouts_store_order_idx
  on public.payment_checkouts (store_order_id);

grant select (order_id, store_order_id) on public.payment_checkouts to authenticated;

update public.payment_checkouts
   set order_id = target_id,
       store_order_id = null
 where target_type = 'order'
   and (order_id is null or order_id <> target_id or store_order_id is not null);

update public.payment_checkouts
   set store_order_id = target_id,
       order_id = null
 where target_type = 'dropship_order'
   and (store_order_id is null or store_order_id <> target_id or order_id is not null);

alter table public.payment_checkouts drop constraint if exists payment_checkouts_order_target_xor_check;
alter table public.payment_checkouts
  add constraint payment_checkouts_order_target_xor_check check (
    not (order_id is not null and store_order_id is not null)
    and (
      (target_type = 'order' and order_id is not null and order_id = target_id and store_order_id is null)
      or (target_type = 'dropship_order' and store_order_id is not null and store_order_id = target_id and order_id is null)
      or (target_type not in ('order', 'dropship_order') and order_id is null and store_order_id is null)
    )
  );

-- ───────── 2. Polymorphic create_escrow_hold_internal ─────────
create or replace function public.create_escrow_hold_internal(
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
  v_order_id uuid := null;
  v_store_order_id uuid := null;
  v_doc_id uuid := null;
  v_pool_id uuid := null;
  v_ord public.orders;
  v_so public.store_orders;
  v_debit_acct uuid;
  v_j uuid;
begin
  select id into v_existing from public.escrow_holds where idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into m from public.payment_option_settings where service = p_service and option = 'payment_protection';
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

  if p_target_type = 'order' then
    select * into v_ord from public.orders where id = p_target_id for update;
    if v_ord.id is null or v_ord.org_id <> p_org then
      raise exception 'ORDER_NOT_FOUND';
    end if;
    v_order_id := v_ord.id;
    v_store_order_id := null;
    v_div := coalesce(v_ord.division_id, v_div);
  elsif p_target_type = 'dropship_order' then
    select * into v_so from public.store_orders where id = p_target_id for update;
    if v_so.id is null or v_so.org_id <> p_org then
      raise exception 'STORE_ORDER_NOT_FOUND';
    end if;
    if v_so.cancelled_at is not null then
      raise exception 'ORDER_CANCELLED';
    end if;
    if coalesce(v_so.kind, 'store') = 'sample' then
      raise exception 'SAMPLE_ORDER_NO_ESCROW: Sample orders pay directly from your wallet';
    end if;
    if v_so.payment_state <> 'unpaid' then
      raise exception 'ORDER_ALREADY_PAID: store order % is already %', v_so.order_number, v_so.payment_state;
    end if;
    perform public.assert_dropship_new_activity(p_org);
    if v_so.total_cents is not null and p_amount_cents is distinct from v_so.total_cents then
      raise exception 'AMOUNT_MISMATCH: store order expects % cents, got % cents', v_so.total_cents, p_amount_cents;
    end if;
    v_store_order_id := v_so.id;
    v_order_id := null;
    v_div := division_id_of('DS');
  elsif p_target_type = 'proforma' then
    v_doc_id := p_target_id;
    select order_id into v_order_id from public.documents where id = p_target_id;
  elsif p_target_type = 'pool_pledge' then
    select pool_id, order_id into v_pool_id, v_order_id from public.pool_pledges where id = p_target_id;
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

  insert into public.escrow_holds (
    org_id, division_id, service, target_type, target_id, order_id, store_order_id, document_id, pool_id,
    checkout_id, funding_method, amount_cents, currency, release_rule, milestone_label,
    milestones, auto_release_days, status, idempotency_key, created_by
  )
  values (
    p_org, v_div, p_service, p_target_type, p_target_id, v_order_id, v_store_order_id, v_doc_id, v_pool_id,
    p_checkout_id, p_funding_method, p_amount_cents, upper(p_currency)::char(3), v_rule, v_label,
    v_milestones, v_days, 'held', p_idempotency_key, auth.uid()
  )
  returning id into v_hold_id;

  -- Book to Held (payment protection) liability account — NEVER revenue!
  v_j := post_journal(
    'Held (payment protection) · ' || p_service || ' · ' || coalesce(v_so.order_number, p_target_id::text),
    jsonb_build_array(
      jsonb_build_object('account', v_debit_acct, 'debit', p_amount_cents, 'credit', 0, 'org', case when p_funding_method = 'wallet' then p_org::text else '' end),
      jsonb_build_object('account', protection_hold_account(p_org, p_currency), 'debit', 0, 'credit', p_amount_cents, 'org', p_org)
    ),
    'escrow-hold:' || v_hold_id::text,
    'hold',
    'wallet_hold',
    v_hold_id
  );
  update public.journals set division_id = v_div where id = v_j;
  update public.ledger_entries set division_id = v_div where journal_id = v_j;
  update public.escrow_holds set hold_journal_id = v_j where id = v_hold_id;

  insert into public.escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
  values
    (v_hold_id, p_org, 'paid', 'Paid upfront', 'Payment received via ' || replace(p_funding_method, '_', ' '), p_amount_cents, auth.uid()),
    (v_hold_id, p_org, 'held', 'Held under Payment protection', 'We hold your payment until ' || v_label, p_amount_cents, auth.uid());

  if v_order_id is not null then
    update public.orders
       set payment_option = 'payment_protection',
           status = case when status in ('pi_issued', 'deposit_pending') then 'confirmed'::order_status else status end
     where id = v_order_id;
    insert into public.order_events (order_id, org_id, kind, title, body, created_by)
    values (v_order_id, p_org, 'payment', 'Payment protection active', 'Paid & held until ' || v_label, auth.uid());
  elsif v_store_order_id is not null then
    perform public.mark_store_order_paid(v_store_order_id, null, v_hold_id);
  end if;

  perform write_audit(
    'payment_protection.held',
    'escrow_holds',
    v_hold_id::text,
    jsonb_build_object(
      'org_id', p_org,
      'service', p_service,
      'target_type', p_target_type,
      'target_id', p_target_id,
      'order_id', v_order_id,
      'store_order_id', v_store_order_id,
      'amount_cents', p_amount_cents,
      'funding_method', p_funding_method,
      'release_rule', v_rule
    )
  );
  return v_hold_id;
end $$;
revoke all on function public.create_escrow_hold_internal(uuid, uuid, text, text, uuid, text, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_escrow_hold_internal(uuid, uuid, text, text, uuid, text, bigint, text, text, uuid) to service_role;

-- ───────── 3. execute_escrow_action_internal: support store_order_id release/refund state sync ─────────
create or replace function public.execute_escrow_action_internal(
  p_hold_id uuid,
  p_action text,
  p_amount_cents bigint,
  p_reason text,
  p_actor uuid,
  p_refund_destination text default 'wallet'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h public.escrow_holds;
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
  select * into h from public.escrow_holds where id = p_hold_id for update;
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
        from public.documents
       where order_id = h.order_id and doc_type = 'commercial_invoice' and coalesce(status, '') not in ('void', 'cancelled')
       limit 1;
    end if;

    if v_inv_id is null then
      v_inv_no := next_document_number('invoice', h.division_id, now(), h.legal_entity_id);
      insert into public.documents (
        org_id, division_id, legal_entity_id, doc_type, number, order_id, amount_cents, paid_cents,
        currency, status, payment_option, from_proforma_id, data
      )
      values (
        h.org_id, h.division_id, h.legal_entity_id, 'commercial_invoice', v_inv_no, h.order_id,
        h.amount_cents, v_new_rel, h.currency,
        case when v_new_rel >= h.amount_cents then 'paid' else 'part_paid' end,
        'payment_protection', h.document_id,
        jsonb_build_object('service', h.service, 'hold_id', h.id, 'payment_option', 'payment_protection', 'released_cents', v_new_rel)
          || case when h.store_order_id is not null then jsonb_build_object('store_order_id', h.store_order_id) else '{}'::jsonb end
      )
      returning id into v_inv_id;
    else
      update public.documents
         set paid_cents = least(amount_cents, coalesce(paid_cents, 0) + p_amount_cents),
             status = case when coalesce(paid_cents, 0) + p_amount_cents >= coalesce(amount_cents, 0) then 'paid' else 'part_paid' end
       where id = v_inv_id;
    end if;

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
    update public.journals set division_id = h.division_id where id = v_j;
    update public.ledger_entries set division_id = h.division_id where journal_id = v_j;

    update public.escrow_holds
       set released_cents = v_new_rel,
           status = v_status,
           invoice_id = v_inv_id,
           dispute_resolution = case when h.status = 'disputed' then p_reason else dispute_resolution end,
           dispute_resolved_by = case when h.status = 'disputed' then p_actor else dispute_resolved_by end,
           dispute_resolved_at = case when h.status = 'disputed' then now() else dispute_resolved_at end,
           updated_at = now()
     where id = p_hold_id;

    if h.order_id is not null then
      update public.orders set paid_cents = least(total_cents, paid_cents + p_amount_cents) where id = h.order_id;
    elsif v_status = 'released' and h.store_order_id is not null then
      update public.store_orders
         set payment_state = 'paid',
             updated_at = now()
       where id = h.store_order_id
         and payment_state = 'held';
    end if;

    insert into public.escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
    values
      (p_hold_id, h.org_id, 'milestone_reached', 'Milestone reached', p_reason, p_amount_cents, p_actor),
      (p_hold_id, h.org_id, 'released', case when v_status = 'released' then 'Released in full' else 'Partly released' end, p_reason, p_amount_cents, p_actor);

    perform write_audit(
      'payment_protection.released',
      'escrow_holds',
      p_hold_id::text,
      jsonb_build_object('amount_cents', p_amount_cents, 'status', v_status, 'invoice_id', v_inv_id, 'store_order_id', h.store_order_id, 'reason', p_reason)
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
    update public.journals set division_id = h.division_id where id = v_j;
    update public.ledger_entries set division_id = h.division_id where journal_id = v_j;

    if h.invoice_id is not null then
      v_cn_no := next_document_number('credit_note', h.division_id, now(), h.legal_entity_id);
      insert into public.documents (
        org_id, division_id, legal_entity_id, doc_type, number, order_id, amount_cents,
        currency, status, original_document_id, data
      )
      values (
        h.org_id, h.division_id, h.legal_entity_id, 'credit_note', v_cn_no, h.order_id, p_amount_cents,
        h.currency, 'issued', h.invoice_id,
        jsonb_build_object('reason', p_reason, 'hold_id', h.id, 'refund_destination', coalesce(p_refund_destination, 'wallet'))
          || case when h.store_order_id is not null then jsonb_build_object('store_order_id', h.store_order_id) else '{}'::jsonb end
      )
      returning id into v_cn_id;
    end if;

    update public.escrow_holds
       set refunded_cents = v_new_ref,
           status = v_status,
           dispute_resolution = case when h.status = 'disputed' then p_reason else dispute_resolution end,
           dispute_resolved_by = case when h.status = 'disputed' then p_actor else dispute_resolved_by end,
           dispute_resolved_at = case when h.status = 'disputed' then now() else dispute_resolved_at end,
           updated_at = now()
     where id = p_hold_id;

    if v_status = 'refunded' and h.store_order_id is not null then
      update public.store_orders
         set payment_state = 'refunded',
             staff_stage = 'refunded',
             updated_at = now()
       where id = h.store_order_id;
    end if;

    insert into public.escrow_hold_events (hold_id, org_id, step, title, body, amount_cents, actor_id)
    values (p_hold_id, h.org_id, 'refunded', 'Refunded to ' || replace(coalesce(p_refund_destination, 'wallet'), '_', ' '), p_reason, p_amount_cents, p_actor);

    perform write_audit(
      'payment_protection.refunded',
      'escrow_holds',
      p_hold_id::text,
      jsonb_build_object('amount_cents', p_amount_cents, 'status', v_status, 'credit_note_id', v_cn_id, 'store_order_id', h.store_order_id, 'destination', coalesce(p_refund_destination, 'wallet'), 'reason', p_reason)
    );
    return jsonb_build_object('hold_id', p_hold_id, 'status', v_status, 'refunded_cents', v_new_ref, 'credit_note_id', v_cn_id);
  end if;
end $$;
revoke all on function public.execute_escrow_action_internal(uuid, text, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.execute_escrow_action_internal(uuid, text, bigint, text, uuid, text) to service_role;

-- ───────── 4. Polymorphic create_payment_checkout ─────────
create or replace function public.create_payment_checkout(
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
  v_existing public.payment_checkouts;
  m public.payment_option_settings;
  prov public.payment_provider_settings;
  v_ord public.orders;
  v_so public.store_orders;
  v_order_id uuid := null;
  v_store_order_id uuid := null;
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

  select * into v_existing from public.payment_checkouts where idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'checkout_id', v_existing.id,
      'order_id', v_existing.order_id,
      'store_order_id', v_existing.store_order_id,
      'provider', v_existing.provider,
      'base_amount_cents', v_existing.base_amount_cents,
      'surcharge_cents', v_existing.surcharge_cents,
      'total_amount_cents', v_existing.total_amount_cents,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'repeated', true
    );
  end if;

  select * into m from public.payment_option_settings where service = p_service and option = p_payment_option;
  if m.service is null or not m.enabled then
    raise exception 'OPTION_DISABLED: % is not enabled for %', p_payment_option, p_service;
  end if;
  if p_base_amount_cents < m.min_amount_cents or (m.max_amount_cents is not null and p_base_amount_cents > m.max_amount_cents) then
    raise exception 'AMOUNT_OUT_OF_RANGE';
  end if;

  v_div := payment_division_for_service(p_service);
  if p_target_type = 'order' then
    select * into v_ord from public.orders where id = p_target_id;
    if v_ord.id is null or v_ord.org_id <> p_org then
      raise exception 'ORDER_NOT_FOUND';
    end if;
    v_order_id := v_ord.id;
    v_div := coalesce(v_ord.division_id, v_div);
  elsif p_target_type = 'dropship_order' then
    select * into v_so from public.store_orders where id = p_target_id;
    if v_so.id is null or v_so.org_id <> p_org then
      raise exception 'STORE_ORDER_NOT_FOUND';
    end if;
    if v_so.cancelled_at is not null then
      raise exception 'ORDER_CANCELLED';
    end if;
    if coalesce(v_so.kind, 'store') = 'sample' then
      raise exception 'SAMPLE_ORDER_WALLET_ONLY: Sample orders pay directly from your wallet';
    end if;
    if v_so.payment_state <> 'unpaid' then
      raise exception 'ORDER_ALREADY_PAID: store order % is already %', v_so.order_number, v_so.payment_state;
    end if;
    perform public.assert_dropship_new_activity(p_org);
    if v_so.total_cents is not null and p_base_amount_cents is distinct from v_so.total_cents then
      raise exception 'AMOUNT_MISMATCH: store order expects % cents, got % cents', v_so.total_cents, p_base_amount_cents;
    end if;
    v_store_order_id := v_so.id;
    v_div := division_id_of('DS');
  end if;

  -- Pick enabled provider supporting p_method_kind (preferring p_preferred_provider if enabled, else by priority).
  -- Fail closed on environment: 'mock' is ONLY eligible when site_settings.app_environment = 'staging' exactly.
  select * into prov
    from public.payment_provider_settings
   where enabled
     and (p_method_kind = any(methods) or 'card' = any(methods))
     and (provider <> 'mock' or exists (select 1 from public.site_settings where key = 'app_environment' and (value #>> '{}') = 'staging'))
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

  insert into public.payment_checkouts (
    org_id, division_id, legal_entity_id, service, payment_option, target_type, target_id,
    order_id, store_order_id,
    base_amount_cents, surcharge_cents, provider_fee_cents, total_amount_cents, currency,
    provider, method_kind, save_payment_method, status, idempotency_key, created_by
  )
  values (
    p_org, v_div, prov.legal_entity_id, p_service, p_payment_option, p_target_type, p_target_id,
    v_order_id, v_store_order_id,
    p_base_amount_cents, v_surcharge, v_fee, v_total, upper(coalesce(p_currency, 'USD'))::char(3),
    prov.provider, coalesce(p_method_kind, 'card'), coalesce(p_save_payment_method, false), 'pending', v_key, auth.uid()
  )
  returning id into v_id;

  update public.payment_checkouts set provider_session_id = prov.provider || '_sess_' || replace(v_id::text, '-', '') where id = v_id;

  return jsonb_build_object(
    'checkout_id', v_id,
    'order_id', v_order_id,
    'store_order_id', v_store_order_id,
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
revoke all on function public.create_payment_checkout(uuid, text, text, text, uuid, bigint, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_payment_checkout(uuid, text, text, text, uuid, bigint, text, text, text, boolean, text) to authenticated, service_role;

-- ───────── 5. Polymorphic confirm_aggregator_webhook (order vs dropship_order) ─────────
create or replace function public.confirm_aggregator_webhook(
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
  v_existing public.payment_webhook_events;
  chk public.payment_checkouts;
  v_j uuid;
  v_hold_id uuid;
  v_pay_id uuid;
  v_pledge public.pool_pledges;
  v_pool public.pools;
begin
  if btrim(coalesce(p_event_id, '')) = '' then raise exception 'EVENT_ID_REQUIRED'; end if;

  select * into v_existing from public.payment_webhook_events where provider = p_provider and event_id = p_event_id;
  if v_existing.id is not null then
    return jsonb_build_object('webhook_event_id', v_existing.id, 'checkout_id', v_existing.checkout_id, 'journal_id', v_existing.journal_id, 'repeated', true);
  end if;

  select * into chk from public.payment_checkouts where id = p_checkout_id for update;
  if chk.id is null then raise exception 'CHECKOUT_NOT_FOUND'; end if;

  if p_amount_cents is distinct from chk.total_amount_cents then
    raise exception 'WEBHOOK_AMOUNT_MISMATCH: checkout expects % cents, webhook reported % cents', chk.total_amount_cents, p_amount_cents;
  end if;
  if upper(btrim(coalesce(p_currency, ''))) is distinct from btrim(chk.currency) then
    raise exception 'WEBHOOK_CURRENCY_MISMATCH: checkout expects %, webhook reported %', chk.currency, p_currency;
  end if;

  if chk.status = 'paid' then
    insert into public.payment_webhook_events (provider, event_id, event_type, checkout_id, amount_cents, currency, journal_id, payload)
    values (p_provider, p_event_id, p_event_type, chk.id, p_amount_cents, chk.currency, chk.journal_id, coalesce(p_payload, '{}'::jsonb));
    return jsonb_build_object('checkout_id', chk.id, 'journal_id', chk.journal_id, 'hold_id', chk.hold_id, 'repeated', true);
  end if;

  if chk.save_payment_method and nullif(btrim(coalesce(p_provider_customer_id, '')), '') is not null
     and nullif(btrim(coalesce(p_provider_payment_method_id, '')), '') is not null then
    insert into public.customer_payment_methods (
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

  if chk.payment_option = 'payment_protection' then
    v_hold_id := create_escrow_hold_internal(
      chk.org_id, chk.division_id, chk.service, chk.target_type, chk.target_id,
      'aggregator', chk.base_amount_cents, chk.currency, 'chk-hold:' || chk.id::text, chk.id
    );
    select hold_journal_id into v_j from public.escrow_holds where id = v_hold_id;

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
      update public.pool_pledges set status = 'paid', paid_at = now(), updated_at = now() where id = chk.target_id;
    end if;
  else
    if chk.target_type = 'order' then
      declare
        v_ord public.orders;
        v_pay_j uuid;
        v_new_paid bigint;
        v_new_st order_status;
      begin
        select * into v_ord from public.orders where id = coalesce(chk.order_id, chk.target_id) for update;
        if v_ord.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
        insert into public.payments (order_id, org_id, division_id, legal_entity_id, purpose, method, amount_cents, currency, status, reference, provider_event_id, confirmed_at)
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
              case when exists (select 1 from public.journals where idempotency_key = 'pi:' || v_ord.id::text)
                then receivable_account(chk.org_id, chk.currency)
                else revenue_account('orders', chk.currency)
              end,
              'debit', 0, 'credit', chk.base_amount_cents,
              'org', case when exists (select 1 from public.journals where idempotency_key = 'pi:' || v_ord.id::text) then chk.org_id::text else '' end
            )
          ),
          'pay:' || v_pay_id::text,
          'orders',
          'payment',
          v_pay_id
        );
        update public.journals set division_id = coalesce(v_ord.division_id, chk.division_id) where id = v_pay_j;
        update public.ledger_entries set division_id = coalesce(v_ord.division_id, chk.division_id) where journal_id = v_pay_j;
        v_j := v_pay_j;

        v_new_paid := v_ord.paid_cents + chk.base_amount_cents;
        v_new_st := v_ord.status;
        if v_ord.status in ('pi_issued', 'deposit_pending') and v_new_paid >= v_ord.deposit_cents then
          v_new_st := 'deposit_paid';
        elsif v_ord.status = 'balance_pending' and v_new_paid >= v_ord.total_cents then
          v_new_st := 'balance_paid';
        end if;
        update public.orders set paid_cents = v_new_paid, status = v_new_st, payment_option = 'pay_now', updated_at = now() where id = v_ord.id;
        insert into public.order_events (order_id, org_id, kind, title, body)
        values (v_ord.id, chk.org_id, 'payment', 'Paid via ' || initcap(p_provider), ((chk.base_amount_cents / 100.0)::numeric(12,2)) || ' ' || chk.currency);
      end;
    elsif chk.target_type = 'dropship_order' then
      declare
        v_so public.store_orders;
        v_pay_j uuid;
      begin
        select * into v_so from public.store_orders where id = coalesce(chk.store_order_id, chk.target_id) for update;
        if v_so.id is null or v_so.org_id <> chk.org_id then raise exception 'STORE_ORDER_NOT_FOUND'; end if;
        if v_so.cancelled_at is not null then raise exception 'ORDER_CANCELLED'; end if;
        if v_so.payment_state <> 'unpaid' then raise exception 'ORDER_ALREADY_PAID'; end if;

        v_pay_j := post_journal(
          'Dropship order payment (' || p_provider || ') · ' || coalesce(v_so.order_number, v_so.id::text),
          jsonb_build_array(
            jsonb_build_object('account', cash_account(chk.currency), 'debit', chk.base_amount_cents, 'credit', 0),
            jsonb_build_object('account', revenue_account('dropship', chk.currency), 'debit', 0, 'credit', chk.base_amount_cents)
          ),
          'pay-ds-agg:' || chk.id::text,
          'dropship',
          'store_order',
          v_so.id
        );
        update public.journals set division_id = division_id_of('DS') where id = v_pay_j;
        update public.ledger_entries set division_id = division_id_of('DS') where journal_id = v_pay_j;
        v_j := v_pay_j;

        perform public.mark_store_order_paid(v_so.id, null, null);
      end;
    elsif chk.target_type = 'proforma' then
      declare
        v_pf public.documents;
        v_pf_new_paid bigint;
        v_pf_st text;
        v_inv_id uuid;
        v_inv_no text;
      begin
        select * into v_pf from public.documents where id = chk.target_id for update;
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
        update public.journals set division_id = v_pf.division_id where id = v_j;
        update public.ledger_entries set division_id = v_pf.division_id where journal_id = v_j;

        insert into public.document_payments (document_id, org_id, legal_entity_id, method, amount_cents, currency, reference, journal_id, idempotency_key)
        values (v_pf.id, chk.org_id, chk.legal_entity_id, 'bank_transfer', chk.base_amount_cents, chk.currency, coalesce(p_provider_payment_id, p_event_id), v_j, 'chk-pf:' || chk.id::text);

        v_pf_new_paid := coalesce(v_pf.paid_cents, 0) + chk.base_amount_cents;
        v_pf_st := case when v_pf_new_paid >= v_pf.amount_cents then 'invoiced' else 'part_paid' end;
        update public.documents set paid_cents = v_pf_new_paid, status = v_pf_st, payment_option = 'pay_now' where id = v_pf.id;

        if v_pf_st = 'invoiced' then
          v_inv_no := next_document_number('invoice', v_pf.division_id, now(), v_pf.legal_entity_id);
          insert into public.documents (
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
      select * into v_pledge from public.pool_pledges where id = chk.target_id for update;
      select * into v_pool from public.pools where id = v_pledge.pool_id;
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
      update public.journals set division_id = division_id_of('POOL') where id = v_j;
      update public.ledger_entries set division_id = division_id_of('POOL') where journal_id = v_j;
      update public.pool_pledges set status = 'paid', paid_at = now(), updated_at = now() where id = chk.target_id;
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
        update public.journals set division_id = chk.division_id where id = v_j;
        update public.ledger_entries set division_id = chk.division_id where journal_id = v_j;
      end if;

      if chk.target_type = 'saas_subscription' then
        declare
          v_sub public.saas_subscriptions;
          v_inv_no text := next_document_number('invoice', chk.division_id, now(), chk.legal_entity_id);
          v_inv_id uuid;
        begin
          select * into v_sub from public.saas_subscriptions where id = chk.target_id;
          insert into public.documents (
            org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents,
            currency, status, payment_option, data
          )
          values (
            chk.org_id, chk.division_id, chk.legal_entity_id, 'commercial_invoice', v_inv_no,
            chk.base_amount_cents, chk.base_amount_cents, chk.currency, 'paid', 'pay_now',
            jsonb_build_object('service', 'saas', 'subscription_id', chk.target_id, 'plan_code', v_sub.plan_code)
          )
          returning id into v_inv_id;
          update public.saas_subscriptions set status = 'active', current_document_id = v_inv_id, updated_at = now() where id = chk.target_id;
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

  update public.payment_checkouts
     set status = 'paid',
         provider_payment_id = coalesce(p_provider_payment_id, p_event_id),
         journal_id = v_j,
         hold_id = v_hold_id,
         paid_at = now(),
         updated_at = now()
   where id = chk.id;

  insert into public.payment_webhook_events (provider, event_id, event_type, checkout_id, amount_cents, currency, journal_id, payload)
  values (p_provider, p_event_id, p_event_type, chk.id, p_amount_cents, chk.currency, v_j, coalesce(p_payload, '{}'::jsonb));

  insert into public.payment_settlements (provider, provider_payment_id, checkout_id, gross_amount_cents, fee_amount_cents, net_amount_cents, currency)
  values (p_provider, coalesce(p_provider_payment_id, p_event_id), chk.id, chk.total_amount_cents, chk.provider_fee_cents, chk.total_amount_cents - chk.provider_fee_cents, chk.currency)
  on conflict (provider, provider_payment_id) do nothing;

  perform write_audit(
    'payment.webhook_confirmed',
    'payment_checkouts',
    chk.id::text,
    jsonb_build_object(
      'provider', p_provider,
      'event_id', p_event_id,
      'payment_option', chk.payment_option,
      'target_type', chk.target_type,
      'target_id', chk.target_id,
      'order_id', chk.order_id,
      'store_order_id', chk.store_order_id,
      'amount_cents', chk.total_amount_cents,
      'journal_id', v_j,
      'hold_id', v_hold_id
    )
  );

  return jsonb_build_object('checkout_id', chk.id, 'journal_id', v_j, 'hold_id', v_hold_id, 'status', 'paid', 'repeated', false);
end $$;
revoke all on function public.confirm_aggregator_webhook(text, text, text, uuid, bigint, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_aggregator_webhook(text, text, text, uuid, bigint, text, text, text, text, jsonb) to service_role;

-- ───────── 6. Polymorphic store_order_id match in get_store_order_escrow_info ─────────
create or replace function public.get_store_order_escrow_info(p_store_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and (in_division(division_id_of('DS')) or can('finance', 'view')));
  v_so public.store_orders;
  v_eh public.escrow_holds;
  v_eh_map jsonb;
begin
  select * into v_so from public.store_orders where id = p_store_order_id;
  if v_so.id is null then
    return null;
  end if;
  if not v_is_staff and (v_uid is null or v_so.org_id not in (select my_org_ids())) then
    raise exception 'FORBIDDEN';
  end if;

  select *
    into v_eh
    from public.escrow_holds eh
   where eh.id = v_so.escrow_hold_id
      or eh.store_order_id = v_so.id
      or (eh.target_type = 'dropship_order' and eh.target_id = v_so.id)
   order by eh.created_at desc
   limit 1;

  if v_eh.id is null then
    return jsonb_build_object(
      'store_order_id', v_so.id,
      'delivered_at', v_so.delivered_at,
      'has_escrow_hold', false,
      'escrow_status', null,
      'auto_release_at', null
    );
  end if;

  v_eh_map := public.resolve_dropship_status_mapping('escrow_hold', v_eh.status);

  return jsonb_build_object(
    'store_order_id', v_so.id,
    'delivered_at', v_so.delivered_at,
    'has_escrow_hold', true,
    'escrow_hold_id', v_eh.id,
    'escrow_status', v_eh.status,
    'merchant_escrow_label', v_eh_map ->> 'merchant_label',
    'auto_release_days', v_eh.auto_release_days,
    'auto_release_at', v_eh.auto_release_at
  );
end $$;
revoke all on function public.get_store_order_escrow_info(uuid) from public, anon;
grant execute on function public.get_store_order_escrow_info(uuid) to authenticated, service_role;
