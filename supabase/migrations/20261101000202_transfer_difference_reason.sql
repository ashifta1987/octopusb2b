-- 202 · Short bank transfers: the reason is split like KYC (owner, 20 Nov 2026).
--  · received_reason (+ received_reason_text for "Other"): chosen from a list, SHOWN TO THE CUSTOMER
--    ("US$ 5.00 less than claimed: Bank charges").
--  · received_note: the internal note, staff only (hidden since 195), unchanged.
--  · Existing transfers keep their note as an internal note; they have no customer reason, so customers see only
--    the difference.
--  · The receipt's data.difference_reason now holds the customer reason label, never the internal note.
--  · Based on the 198 version (receipt issuer = the legal company name).
-- Down: supabase/migrations/down/20261101000202_transfer_difference_reason.down.sql

alter table wallet_topups
  add column if not exists received_reason text
    constraint wallet_topups_received_reason_check check (received_reason in ('bank_charges', 'exchange_rate', 'partial_payment', 'other')),
  add column if not exists received_reason_text text
    constraint wallet_topups_received_reason_text_check check (received_reason_text is null or (received_reason = 'other' and char_length(received_reason_text) between 1 and 80));

-- customers read their own transfers through column grants (195): the two new columns are customer-safe
grant select (received_reason, received_reason_text) on wallet_topups to authenticated;

-- the label the customer sees (the app uses the same words: lib/core/transfer-reason.ts)
create or replace function transfer_reason_label(p_reason text, p_text text) returns text
language sql immutable set search_path = public as $$
  select case p_reason
    when 'bank_charges' then 'Bank charges'
    when 'exchange_rate' then 'Exchange rate difference'
    when 'partial_payment' then 'Partial payment'
    when 'other' then nullif(trim(coalesce(p_text, '')), '')
  end
$$;
grant execute on function transfer_reason_label(text, text) to anon, authenticated, service_role;

drop function if exists confirm_bank_transfer(uuid, bigint, text, text);
create or replace function confirm_bank_transfer(p_topup uuid, p_amount_received_cents bigint, p_bank_ref text, p_note text default null,
                                                 p_reason text default null, p_reason_text text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t wallet_topups; v_doc uuid; v_no text; v_reason text; v_text text; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform require_step_up();
  if not can('wallet', 'approve') then raise exception 'FORBIDDEN'; end if;
  if p_amount_received_cents is null or p_amount_received_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(trim(p_bank_ref), '') = '' then raise exception 'BANK_REF_REQUIRED'; end if;
  select * into t from wallet_topups where id = p_topup for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status = 'credited' then return t.receipt_id; end if;
  if t.status <> 'pending' then raise exception 'INVALID_TRANSITION'; end if;
  -- the customer reason is required when the amount differs, and only kept then
  if p_amount_received_cents <> t.amount_cents then
    v_reason := nullif(trim(coalesce(p_reason, '')), '');
    if v_reason is null then raise exception 'DIFFERENCE_REASON_REQUIRED'; end if;
    if v_reason not in ('bank_charges', 'exchange_rate', 'partial_payment', 'other') then raise exception 'INVALID_REASON'; end if;
    if v_reason = 'other' then
      v_text := nullif(trim(coalesce(p_reason_text, '')), '');
      if v_text is null then raise exception 'REASON_TEXT_REQUIRED'; end if;
      if char_length(v_text) > 80 then raise exception 'REASON_TEXT_TOO_LONG'; end if;
    end if;
  end if;
  perform post_journal('Bank transfer ' || coalesce(t.reference, '') || ' · ' || trim(p_bank_ref), jsonb_build_array(
    jsonb_build_object('account', cash_account(t.currency), 'debit', p_amount_received_cents, 'credit', 0),
    jsonb_build_object('account', wallet_account(t.org_id, t.currency), 'debit', 0, 'credit', p_amount_received_cents, 'org', t.org_id)
  ), 'topup:' || p_topup, 'topup', 'wallet_topup', p_topup);
  v_no := 'RCT-W-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_invoice')::text, 5, '0');
  insert into documents(org_id, doc_type, number, amount_cents, currency, status, data)
  values (t.org_id, 'receipt', v_no, p_amount_received_cents, t.currency, 'paid',
          jsonb_build_object('kind', 'wallet_topup', 'service', 'wallet', 'ref', t.reference, 'topup_id', p_topup, 'bank_ref', trim(p_bank_ref),
                             'claimed_cents', t.amount_cents, 'difference_reason', transfer_reason_label(v_reason, v_text), 'issuer', (select legal_name from company_profile where id = 1)))
  returning id into v_doc;
  update wallet_topups set status = 'credited', amount_received_cents = p_amount_received_cents, bank_ref = trim(p_bank_ref),
         received_reason = v_reason, received_reason_text = v_text, received_note = v_note,
         confirmed_by = auth.uid(), confirmed_at = now(), receipt_id = v_doc where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'credited');
  perform audit('wallet.transfer_confirmed', t.org_id, 'wallet', 'wallet_topup', p_topup::text, jsonb_build_object('status', 'pending', 'claimed_cents', t.amount_cents),
                jsonb_build_object('status', 'credited', 'received_cents', p_amount_received_cents, 'bank_ref', trim(p_bank_ref),
                                   'customer_reason', transfer_reason_label(v_reason, v_text), 'internal_note', v_note, 'receipt', v_no));
  perform emit_event('wallet.updated', 'wallet_topup', p_topup, jsonb_build_object('org_id', t.org_id, 'currency', t.currency));
  return v_doc;
end $$;
revoke execute on function confirm_bank_transfer(uuid, bigint, text, text, text, text) from public, anon;
grant execute on function confirm_bank_transfer(uuid, bigint, text, text, text, text) to authenticated, service_role;
