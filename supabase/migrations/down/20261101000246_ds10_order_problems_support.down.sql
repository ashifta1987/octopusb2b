-- Down for 20261101000246_ds10_order_problems_support.sql — restores the schema exactly as before DS10 (empty up → down diff).
-- Restores ds_order_address_core to its installed DS8 text, removes the DS10 triggers, storage policies, functions, tables
-- and sequence, the 'update_tracking' channel tasks (then the DS8 action CHECK), and the finance_approvals two-person CHECK.
-- The private 'ds-claims' bucket and its files are storage data, not schema: they stay (as W5 did for its buckets).
-- Issued documents (OCT-DS / CN-DS), journals, finance approvals, tickets, reship store / warehouse orders and Warehouse OS
-- returns created while DS10 was installed stay (financial / operational records); only the DS10 case rows go.

CREATE OR REPLACE FUNCTION public.ds_order_address_core(p_so uuid, p_address jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  so public.store_orders;
  x public.dropship_order_intake;
  v_problem text;
  v_addr jsonb;
  v_pay jsonb;
begin
  select * into so from public.store_orders where id = p_so for update;
  if so.id is null then raise exception 'NOT_FOUND: This order was not found.'; end if;
  if so.cancelled_at is not null then raise exception 'ORDER_CANCELLED: This order is cancelled.'; end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then raise exception 'INVALID_INPUT: Enter the delivery address.'; end if;
  v_addr := jsonb_strip_nulls(jsonb_build_object(
    'name', nullif(btrim(coalesce(p_address ->> 'name', '')), ''), 'phone', nullif(btrim(coalesce(p_address ->> 'phone', '')), ''),
    'line1', nullif(btrim(coalesce(p_address ->> 'line1', '')), ''), 'line2', nullif(btrim(coalesce(p_address ->> 'line2', '')), ''),
    'city', nullif(btrim(coalesce(p_address ->> 'city', '')), ''), 'region', nullif(btrim(coalesce(p_address ->> 'region', '')), ''),
    'postcode', nullif(upper(btrim(coalesce(p_address ->> 'postcode', ''))), ''),
    'country', upper(coalesce(nullif(btrim(p_address ->> 'country'), ''), so.destination_country))));
  if v_addr ->> 'country' <> so.destination_country then
    raise exception 'COUNTRY_CHANGE: A different country changes the shipping price. Cancel this order and send it again instead.';
  end if;
  select * into x from public.dropship_order_intake where store_order_id = so.id for update;
  if x.store_order_id is null then
    insert into public.dropship_order_intake (store_order_id, org_id, channel) values (so.id, so.org_id, so.channel) returning * into x;
  end if;

  if public.ds_order_packing_started(so.id) then
    update public.dropship_order_intake
       set problem_code = 'address_after_packing', problem_detail = jsonb_build_object('address', v_addr, 'requested_at', now(), 'source', p_source), updated_at = now()
     where store_order_id = so.id;
    perform public.ds_order_event(so.id, so.org_id, 'address_problem', 'Address change after packing',
      'The parcel is already packed, so the address was not changed. Octopus support checks whether it can still be redirected and replies in Support.');
    perform write_audit('ds_order.address_problem', 'store_orders', so.id::text, jsonb_build_object('org_id', so.org_id, 'source', p_source));
    return jsonb_build_object('ok', true, 'applied', false, 'problem', true, 'store_order_id', so.id,
      'message', 'The parcel is already packed, so the address was not changed. Octopus support will reply in Support.');
  end if;

  v_problem := public.ds_order_address_problem(v_addr, so.destination_country);
  if v_problem is not null then
    raise exception 'ADDRESS_INVALID: %', v_problem;
  end if;
  update public.store_orders
     set shipping_address = v_addr, buyer_name = coalesce(v_addr ->> 'name', buyer_name), buyer_phone = coalesce(v_addr ->> 'phone', buyer_phone), updated_at = now()
   where id = so.id;
  update public.wh_orders
     set ship_address = v_addr, ship_name = left(coalesce(v_addr ->> 'name', ship_name), 120), ship_phone = left(coalesce(v_addr ->> 'phone', ship_phone), 40), updated_at = now()
   where store_order_id = so.id and status in ('new', 'allocated', 'picking');
  update public.dropship_order_intake set address_ok = true, address_issue = null, updated_at = now() where store_order_id = so.id;
  perform public.ds_order_event(so.id, so.org_id, 'address_updated', 'Delivery address updated', null);
  if x.hold_code = 'address' then
    perform public.ds_order_set_hold(so.id, null, 'Address fixed and resubmitted.');
    if so.payment_state = 'unpaid' then v_pay := public.ds_order_try_auto(so.id); end if;
  end if;
  perform write_audit('ds_order.address_updated', 'store_orders', so.id::text, jsonb_build_object('org_id', so.org_id, 'source', p_source));
  return jsonb_build_object('ok', true, 'applied', true, 'store_order_id', so.id, 'payment', v_pay);
end $function$;

drop trigger if exists trg_ds10_finance_approval_sync on public.finance_approvals;
drop trigger if exists trg_ds10_wh_return_guard on public.wh_returns;
drop trigger if exists trg_ds10_wh_return_lot_owner on public.wh_return_lines;
drop policy if exists "ds claims upload" on storage.objects;
drop policy if exists "ds claims read" on storage.objects;
drop policy if exists "ds reweigh photo read" on storage.objects;

drop function if exists public.ds10_staff_view();
drop function if exists public.ds10_staff_edit();
drop function if exists public.ds10_setting_int(text, integer, integer, integer);
drop function if exists public.ds10_approval_limit_cents();
drop function if exists public.ds10_handed_over(uuid);
drop function if exists public.ds10_label_created(uuid);
drop function if exists public.ds10_delivered_at(uuid);
drop function if exists public.ds10_case_step(uuid, text, text);
drop function if exists public.ds10_notify(uuid, text, text, text);
drop function if exists public.ds10_ticket_open(uuid, uuid, text, text, text, jsonb);
drop function if exists public.ds10_ticket_reply(uuid, text, boolean);
drop function if exists public.ds10_open_hold(uuid);
drop function if exists public.ds10_refund_cap(uuid);
drop function if exists public.ds10_case_json(public.dropship_cases, boolean);
drop function if exists public.ds10_credit_note(uuid, uuid, bigint, text, text, text);
drop function if exists public.ds10_claim_photo_can_upload(text);
drop function if exists public.ds10_claim_photo_can_read(text);
drop function if exists public.ds10_reweigh_photo_can_read(text);
drop function if exists public.ds10_refund_execute(uuid);
drop function if exists public.ds10_release_hold(uuid, text);
drop function if exists public.ds10_reship_create(uuid, jsonb);
drop function if exists public.ds10_reweigh_calc(uuid);
drop function if exists public.ds10_order_detail(uuid);
drop function if exists public.ds10_claim_open(uuid, text, text, text, text[]);
drop function if exists public.ds10_return_open(uuid, text, text, text, jsonb);
drop function if exists public.ds10_reweigh_dispute(uuid, text);
drop function if exists public.ds10_order_address(uuid, jsonb);
drop function if exists public.ds10_support_page();
drop function if exists public.ds10_ticket_create(text, text, text, text, jsonb);
drop function if exists public.ds10_staff_board();
drop function if exists public.ds10_case_for_staff(uuid);
drop function if exists public.ds10_case_carrier(uuid, text);
drop function if exists public.ds10_case_reship(uuid, text, jsonb);
drop function if exists public.ds10_case_refund(uuid, bigint, text);
drop function if exists public.ds10_refund_approve(uuid, boolean, text);
drop function if exists public.ds10_case_reject(uuid, text);
drop function if exists public.ds10_return_receive(uuid, text);
drop function if exists public.ds10_return_suggest(uuid);
drop function if exists public.ds10_return_settle(uuid, bigint, text);
drop function if exists public.ds10_reweigh_decide(uuid, text);
drop function if exists public.ds10_reweigh_dispute_decide(uuid, boolean, text);
drop function if exists public.ds10_ticket_context(uuid);
drop function if exists public.ds10_finance_approval_sync();
drop function if exists public.ds10_is_dropship_return(uuid, uuid);
drop function if exists public.ds10_wh_return_guard();
drop function if exists public.ds10_wh_return_lot_owner();

drop table if exists public.dropship_case_photos;
drop table if exists public.dropship_reweighs;
drop table if exists public.dropship_cases;
drop sequence if exists public.seq_dropship_case;

delete from public.dropship_channel_tasks where action = 'update_tracking';
alter table public.dropship_channel_tasks drop constraint if exists dropship_channel_tasks_action_check;
alter table public.dropship_channel_tasks add constraint dropship_channel_tasks_action_check
  check (action in ('release_fulfillment', 'accept_cancellation', 'reject_cancellation'));
alter table public.finance_approvals drop constraint if exists finance_approvals_two_person;
