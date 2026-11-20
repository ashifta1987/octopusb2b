-- Down for 202: back to the 198 version (one free-text reason, which was also the receipt reason). The customer reason
-- columns and the label function are removed; the internal note (received_note) is untouched.
drop function if exists confirm_bank_transfer(uuid, bigint, text, text, text, text);
CREATE OR REPLACE FUNCTION public.confirm_bank_transfer(p_topup uuid, p_amount_received_cents bigint, p_bank_ref text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t wallet_topups; v_doc uuid; v_no text;
begin
  perform require_step_up();
  if not can('wallet', 'approve') then raise exception 'FORBIDDEN'; end if;
  if p_amount_received_cents is null or p_amount_received_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(trim(p_bank_ref), '') = '' then raise exception 'BANK_REF_REQUIRED'; end if;
  select * into t from wallet_topups where id = p_topup for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status = 'credited' then return t.receipt_id; end if;
  if t.status <> 'pending' then raise exception 'INVALID_TRANSITION'; end if;
  if p_amount_received_cents <> t.amount_cents and coalesce(trim(p_note), '') = '' then raise exception 'DIFFERENCE_REASON_REQUIRED'; end if;
  perform post_journal('Bank transfer ' || coalesce(t.reference, '') || ' · ' || trim(p_bank_ref), jsonb_build_array(
    jsonb_build_object('account', cash_account(t.currency), 'debit', p_amount_received_cents, 'credit', 0),
    jsonb_build_object('account', wallet_account(t.org_id, t.currency), 'debit', 0, 'credit', p_amount_received_cents, 'org', t.org_id)
  ), 'topup:' || p_topup, 'topup', 'wallet_topup', p_topup);
  v_no := 'RCT-W-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_invoice')::text, 5, '0');
  insert into documents(org_id, doc_type, number, amount_cents, currency, status, data)
  values (t.org_id, 'receipt', v_no, p_amount_received_cents, t.currency, 'paid',
          jsonb_build_object('kind', 'wallet_topup', 'service', 'wallet', 'ref', t.reference, 'topup_id', p_topup, 'bank_ref', trim(p_bank_ref),
                             'claimed_cents', t.amount_cents, 'difference_reason', nullif(trim(coalesce(p_note, '')), ''), 'issuer', (select legal_name from company_profile where id = 1)))
  returning id into v_doc;
  update wallet_topups set status = 'credited', amount_received_cents = p_amount_received_cents, bank_ref = trim(p_bank_ref),
         received_note = nullif(trim(coalesce(p_note, '')), ''), confirmed_by = auth.uid(), confirmed_at = now(), receipt_id = v_doc where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'credited');
  perform audit('wallet.transfer_confirmed', t.org_id, 'wallet', 'wallet_topup', p_topup::text, jsonb_build_object('status', 'pending', 'claimed_cents', t.amount_cents),
                jsonb_build_object('status', 'credited', 'received_cents', p_amount_received_cents, 'bank_ref', trim(p_bank_ref), 'difference_reason', p_note, 'receipt', v_no));
  perform emit_event('wallet.updated', 'wallet_topup', p_topup, jsonb_build_object('org_id', t.org_id, 'currency', t.currency));
  return v_doc;
end $function$
;
revoke execute on function confirm_bank_transfer(uuid, bigint, text, text) from public, anon;
grant execute on function confirm_bank_transfer(uuid, bigint, text, text) to authenticated, service_role;
drop function if exists transfer_reason_label(text, text);
alter table wallet_topups drop column if exists received_reason_text, drop column if exists received_reason;
