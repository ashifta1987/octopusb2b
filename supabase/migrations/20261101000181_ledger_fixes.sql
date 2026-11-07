-- ADDON-41 staging fixes (7 Nov 2026)
--  · plain names in hold / capture / release / refund descriptions ("Hold · Dropshipping order SO-TEST-1001")
--  · issuing a proforma for a service posts a receivable debit (Orders account), like order proformas already do
--  · bank transfers: when the amount received differs from the claim, finance records the reason

create or replace function svc_label(p text) returns text language sql immutable as $$
  select case p when 'sourcing' then 'Sourcing' when 'dropship' then 'Dropshipping' when 'warehouse' then '3PL warehouse'
                when 'brand' then 'Make My Brand' when 'wallet' then 'Wallet' else initcap(replace(coalesce(p, ''), '_', ' ')) end;
$$;
create or replace function ref_label(p text) returns text language sql immutable as $$
  select case p when 'store_order' then 'order' when 'charge' then 'charge' when 'project' then 'project' when 'quote' then 'quote'
                when 'asn' then 'inbound' when 'outbound_order' then 'shipment' else replace(coalesce(p, ''), '_', ' ') end;
$$;
-- "Dropshipping order SO-TEST-1001"
create or replace function hold_subject(p_service text, p_ref_type text, p_ref_id text) returns text language sql immutable as $$
  select svc_label(p_service) || ' ' || ref_label(p_ref_type) || ' ' || p_ref_id;
$$;

do $p$
declare f text; v_def text; v_new text;
begin
  foreach f in array array['place_hold(uuid,bigint,text,text,text,timestamp with time zone)', 'capture_hold(uuid,text,bigint)', 'release_hold(uuid,text,boolean)', 'refund_capture(uuid,bigint,text,text)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_new := v_def;
    v_new := replace(v_new, $q$'Hold · ' || p_service || ' ' || p_ref_type || ' ' || p_ref_id$q$, $q$'Hold · ' || hold_subject(p_service, p_ref_type, p_ref_id)$q$);
    v_new := replace(v_new, $q$'Capture · ' || h.service || ' ' || h.ref_type || ' ' || h.ref_id$q$, $q$'Charged · ' || hold_subject(h.service, h.ref_type, h.ref_id)$q$);
    v_new := replace(v_new, $q$'Release · ' || h.service || ' ' || h.ref_type || ' ' || h.ref_id$q$, $q$'Released · ' || hold_subject(h.service, h.ref_type, h.ref_id)$q$);
    v_new := replace(v_new, $q$'Refund · ' || h.service || ' ' || h.ref_type || ' ' || h.ref_id || ' · ' || p_reason$q$, $q$'Refund · ' || hold_subject(h.service, h.ref_type, h.ref_id) || ' · ' || p_reason$q$);
    if v_new = v_def then raise exception '% memo not patched', f; end if;
    execute v_new;
  end loop;
end $p$;

-- ───────── service proformas post a receivable ─────────
-- Posts "debit Orders (receivable) / credit revenue" for a proforma that is not tied to an order (order proformas are
-- posted by approve_quote). Idempotent per document.
create or replace function post_document_receivable(p_doc uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d documents; v_stream text;
begin
  select * into d from documents where id = p_doc;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  if d.doc_type <> 'proforma_invoice' or d.order_id is not null then raise exception 'NOT_A_SERVICE_PROFORMA'; end if;
  if coalesce(d.amount_cents, 0) <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_stream := coalesce(nullif(d.data ->> 'service', ''), 'service_fees');
  return post_journal('Proforma ' || d.number || coalesce(' · ' || nullif(svc_label(d.data ->> 'service'), '') || ' ' || coalesce(d.data ->> 'ref', ''), ''),
    jsonb_build_array(
      jsonb_build_object('account', receivable_account(d.org_id, coalesce(d.currency, 'USD')), 'debit', d.amount_cents, 'credit', 0, 'org', d.org_id),
      jsonb_build_object('account', revenue_account(v_stream, coalesce(d.currency, 'USD')), 'debit', 0, 'credit', d.amount_cents)
    ), 'doc-ar:' || d.id, v_stream, 'document', d.id);
end $$;

-- staff / service: issue a proforma for a service (Make My Brand project, 3PL bill, sourcing fee …) with lines
create or replace function issue_service_proforma(p_org uuid, p_service text, p_ref_type text, p_ref text, p_title text, p_lines jsonb, p_currency text default 'USD')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_total bigint; v_no text; l jsonb;
begin
  if not (auth.role() = 'service_role' or can('finance', 'create') or is_my_customer(p_org)) then raise exception 'FORBIDDEN'; end if;
  if p_service not in ('sourcing', 'dropship', 'warehouse', 'brand') then raise exception 'BAD_SERVICE'; end if;
  select coalesce(sum((x ->> 'amount_cents')::bigint), 0) into v_total from jsonb_array_elements(p_lines) x;
  if v_total <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_no := 'PI-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_pi')::text, 4, '0');
  insert into documents(org_id, doc_type, number, amount_cents, currency, status, data)
  values (p_org, 'proforma_invoice', v_no, v_total, p_currency, 'awaiting_payment',
          jsonb_build_object('service', p_service, 'ref_type', p_ref_type, 'ref', p_ref, 'title', p_title, 'issuer', 'Hong Kong company'))
  returning id into v_doc;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into invoice_lines(document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    values (v_doc, p_service, l ->> 'description', coalesce((l ->> 'qty')::numeric, 1), coalesce((l ->> 'unit_cents')::bigint, (l ->> 'amount_cents')::bigint), (l ->> 'amount_cents')::bigint, p_ref_type, p_ref);
  end loop;
  perform post_document_receivable(v_doc);
  perform audit('invoice.issue', p_org, p_service, 'document', v_doc::text, null, jsonb_build_object('number', v_no, 'amount_cents', v_total, 'ref', p_ref));
  return v_doc;
end $$;
revoke execute on function post_document_receivable(uuid), issue_service_proforma(uuid, text, text, text, text, jsonb, text) from public, anon;
grant execute on function issue_service_proforma(uuid, text, text, text, text, jsonb, text) to authenticated, service_role;
grant execute on function post_document_receivable(uuid) to service_role;

-- ───────── bank transfers: reason when the received amount differs ─────────
alter table wallet_topups add column if not exists received_note text;
drop function if exists confirm_bank_transfer(uuid, bigint, text);
create or replace function confirm_bank_transfer(p_topup uuid, p_amount_received_cents bigint, p_bank_ref text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
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
                             'claimed_cents', t.amount_cents, 'difference_reason', nullif(trim(coalesce(p_note, '')), ''), 'issuer', 'Hong Kong company'))
  returning id into v_doc;
  update wallet_topups set status = 'credited', amount_received_cents = p_amount_received_cents, bank_ref = trim(p_bank_ref),
         received_note = nullif(trim(coalesce(p_note, '')), ''), confirmed_by = auth.uid(), confirmed_at = now(), receipt_id = v_doc where id = p_topup;
  perform log_status('wallet_topup', p_topup, 'pending', 'credited');
  perform audit('wallet.transfer_confirmed', t.org_id, 'wallet', 'wallet_topup', p_topup::text, jsonb_build_object('status', 'pending', 'claimed_cents', t.amount_cents),
                jsonb_build_object('status', 'credited', 'received_cents', p_amount_received_cents, 'bank_ref', trim(p_bank_ref), 'difference_reason', p_note, 'receipt', v_no));
  perform emit_event('wallet.updated', 'wallet_topup', p_topup, jsonb_build_object('org_id', t.org_id, 'currency', t.currency));
  return v_doc;
end $$;
revoke execute on function confirm_bank_transfer(uuid, bigint, text, text) from public, anon;
grant execute on function confirm_bank_transfer(uuid, bigint, text, text) to authenticated, service_role;
