-- Down for 20261101000245_ds8_order_payment_intake.sql (Dropship Step 8 + source-agnostic Step 7).
-- The down restores generate_dropship_weekly_statement EXACTLY as installed (pg_get_functiondef on staging), then drops
-- what the up created: the cron job, the trigger on escrow_holds, the functions, then the four tables. Existing tables (store_orders, escrow_holds, documents, journals, …) and functions
-- (create_dropship_store_order, mark_store_order_paid, cancel_store_order, create_escrow_hold_internal, …) are untouched.
-- Rows written in the new tables are lost; issued OCT-DS invoices / CN- credit notes, journals and escrow holds STAY
-- (they live in the existing tables) — run only within the first hour, per the release rules.

do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-order-jobs') then
      perform cron.unschedule('octopus-dropship-order-jobs');
    end if;
  end if;
end $$;

drop trigger if exists trg_ds_escrow_release_revenue on public.escrow_holds;

-- restore the exact installed definition (pg_get_functiondef on staging before DS8); grants are unchanged by create or replace
CREATE OR REPLACE FUNCTION public.generate_dropship_weekly_statement(p_org uuid, p_from timestamp with time zone DEFAULT (now() - '7 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_div uuid := division_id_of('DS');
  v_entity uuid := current_legal_entity_id(coalesce(p_to, now()));
  v_items jsonb := '[]'::jsonb;
  v_samples jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_unpaid bigint := 0;
  v_stmt_id uuid;
  v_stmt_no text;
  v_prev_amount bigint;
  v_prev_data jsonb;
  d record;
  s record;
begin
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or (is_staff() and can('finance', 'view'))) then
    raise exception 'FORBIDDEN';
  end if;

  for d in
    select id, number, order_id, amount_cents, paid_cents, currency, status, due_at, created_at
      from public.documents
     where org_id = p_org
       and division_id = v_div
       and doc_type = 'commercial_invoice'
       and coalesce(status, '') not in ('void', 'cancelled')
       and created_at >= p_from
       and created_at <= p_to
     order by created_at asc, id asc
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

  for s in
    select so.id,
           so.order_number,
           so.destination_country::text as destination_country,
           so.shipping_method,
           so.incoterm,
           so.product_cents,
           so.processing_cents,
           so.shipping_cents,
           so.duties_cents,
           so.total_cents,
           so.created_at,
           soi.model_no,
           soi.title_snapshot,
           soi.variant_label,
           coalesce(soi.qty, 1) as qty
      from public.store_orders so
      left join lateral (
        select i.model_no, i.title_snapshot, i.variant_label, i.qty
          from public.store_order_items i
         where i.store_order_id = so.id
         order by i.created_at asc
         limit 1
      ) soi on true
     where so.org_id = p_org
       and so.kind = 'sample'
       and so.payment_state = 'paid'
       and so.cancelled_at is null
       and so.created_at >= p_from
       and so.created_at <= p_to
     order by so.created_at asc, so.id asc
  loop
    v_samples := v_samples || jsonb_build_array(jsonb_build_object(
      'store_order_id', s.id,
      'order_number', s.order_number,
      'model_no', s.model_no,
      'title', s.title_snapshot,
      'variant_label', s.variant_label,
      'qty', s.qty,
      'destination_country', s.destination_country,
      'shipping_method', s.shipping_method,
      'incoterm', s.incoterm,
      'product_cents', s.product_cents,
      'processing_cents', s.processing_cents,
      'shipping_cents', s.shipping_cents,
      'duties_cents', s.duties_cents,
      'total_cents', s.total_cents,
      'paid_cents', s.total_cents,
      'paid_via', 'wallet',
      'created_at', s.created_at
    ));
    v_total := v_total + coalesce(s.total_cents, 0);
  end loop;

  v_stmt_no := 'STMT-DS-' || to_char(p_to at time zone 'UTC', 'YYYYMMDD') || '-' || substr(replace(p_org::text, '-', ''), 1, 6);

  select id, amount_cents, data
    into v_stmt_id, v_prev_amount, v_prev_data
    from public.documents
   where org_id = p_org
     and doc_type = 'statement'
     and number = v_stmt_no
   limit 1;

  if v_stmt_id is not null then
    if coalesce(v_prev_amount, -1) = v_total
       and coalesce((v_prev_data ->> 'invoice_count')::int, -1) = jsonb_array_length(v_items)
       and coalesce((v_prev_data ->> 'sample_count')::int, -1) = jsonb_array_length(v_samples) then
      return jsonb_build_object(
        'statement_id', v_stmt_id,
        'number', v_stmt_no,
        'legal_entity_id', v_entity,
        'invoice_count', jsonb_array_length(v_items),
        'sample_count', jsonb_array_length(v_samples),
        'total_cents', v_total,
        'unpaid_cents', v_unpaid,
        'repeated', true
      );
    end if;

    update public.documents
       set legal_entity_id = coalesce(legal_entity_id, v_entity),
           amount_cents = v_total,
           paid_cents = v_total - v_unpaid,
           status = case when v_unpaid = 0 then 'paid' else 'awaiting_payment' end,
           data = coalesce(v_prev_data, '{}'::jsonb) || jsonb_build_object(
             'service', 'dropship',
             'period_from', p_from,
             'period_to', p_to,
             'invoice_count', jsonb_array_length(v_items),
             'sample_count', jsonb_array_length(v_samples),
             'total_cents', v_total,
             'paid_cents', v_total - v_unpaid,
             'unpaid_cents', v_unpaid,
             'invoices', v_items,
             'sample_orders', v_samples
           )
     where id = v_stmt_id;

    delete from public.invoice_lines where document_id = v_stmt_id;
  else
    insert into public.documents (
      org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents, currency, status, data
    )
    values (
      p_org, v_div, v_entity, 'statement', v_stmt_no, v_total, v_total - v_unpaid, 'USD',
      case when v_unpaid = 0 then 'paid' else 'awaiting_payment' end,
      jsonb_build_object(
        'service', 'dropship',
        'period_from', p_from,
        'period_to', p_to,
        'invoice_count', jsonb_array_length(v_items),
        'sample_count', jsonb_array_length(v_samples),
        'total_cents', v_total,
        'paid_cents', v_total - v_unpaid,
        'unpaid_cents', v_unpaid,
        'invoices', v_items,
        'sample_orders', v_samples
      )
    )
    returning id into v_stmt_id;
  end if;

  insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
  select v_stmt_id,
         'dropship',
         'Dropship shipment invoice ' || (inv ->> 'number') || ' (' || coalesce(inv ->> 'status', 'issued') || ')',
         1,
         coalesce((inv ->> 'amount_cents')::bigint, 0),
         coalesce((inv ->> 'amount_cents')::bigint, 0),
         'document',
         inv ->> 'invoice_id'
    from jsonb_array_elements(v_items) inv;

  insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
  select v_stmt_id,
         'dropship',
         btrim(
           'Sample order ' || (smp ->> 'order_number')
           || case when coalesce(smp ->> 'model_no', '') <> '' then ' · ' || (smp ->> 'model_no') else '' end
           || case when coalesce(smp ->> 'title', '') <> '' then ' ' || (smp ->> 'title') else '' end
           || case when coalesce(smp ->> 'variant_label', '') <> '' then ' (' || (smp ->> 'variant_label') || ')' else '' end
           || ' · ' || coalesce(smp ->> 'destination_country', '') || ' ' || coalesce(smp ->> 'incoterm', 'DDP')
           || ' (Paid via Wallet)'
         ),
         greatest(1, coalesce((smp ->> 'qty')::numeric, 1)),
         case
           when greatest(1, coalesce((smp ->> 'qty')::int, 1)) > 0
           then round(coalesce((smp ->> 'total_cents')::numeric, 0) / greatest(1, coalesce((smp ->> 'qty')::numeric, 1)))::bigint
           else coalesce((smp ->> 'total_cents')::bigint, 0)
         end,
         coalesce((smp ->> 'total_cents')::bigint, 0),
         'store_order',
         smp ->> 'store_order_id'
    from jsonb_array_elements(v_samples) smp;

  return jsonb_build_object(
    'statement_id', v_stmt_id,
    'number', v_stmt_no,
    'legal_entity_id', v_entity,
    'invoice_count', jsonb_array_length(v_items),
    'sample_count', jsonb_array_length(v_samples),
    'total_cents', v_total,
    'unpaid_cents', v_unpaid
  );
end $function$;


drop function if exists public.ds_escrow_release_revenue();
drop function if exists public.ds_order_jobs();
drop function if exists public.ds_protection_release_due();
drop function if exists public.ds_order_autopay_waiting();
drop function if exists public.ds_order_expire_due();
drop function if exists public.ds_order_update_address(uuid, jsonb);
drop function if exists public.ds_order_cancel(uuid, text);
drop function if exists public.ds_order_charge(uuid[], text);
drop function if exists public.ds_order_settings_save(text, boolean);
drop function if exists public.ds_wallet_get();
drop function if exists public.ds_order_detail_events(uuid);
drop function if exists public.ds_orders_page();
drop function if exists public.ds_order_own(uuid);
drop function if exists public.ds_order_channel_address(uuid, text, text, jsonb);
drop function if exists public.ds_order_channel_cancel(uuid, text, text, text);
drop function if exists public.ds_order_address_core(uuid, jsonb, text);
drop function if exists public.ds_order_cancel_core(uuid, text, text);
drop function if exists public.ds_test_order_create(uuid, jsonb);
drop function if exists public.ds_order_intake(uuid, text, jsonb);
drop function if exists public.ds_order_intake_core(uuid, text, jsonb, boolean);
drop function if exists public.ds_order_try_auto(uuid);
drop function if exists public.ds_order_charge_core(uuid, text, text);
drop function if exists public.ds_order_set_hold(uuid, text, text);
drop function if exists public.ds_order_err(text);
drop function if exists public.ds_order_pay_later_ok(uuid);
drop function if exists public.ds_order_stock_short(uuid);
drop function if exists public.ds_order_packing_started(uuid);
drop function if exists public.ds_order_held_cents(uuid);
drop function if exists public.ds_order_channel_task(uuid, uuid, text, text, jsonb);
drop function if exists public.ds_order_event(uuid, uuid, text, text, text, bigint);
drop function if exists public.ds_order_address_problem(jsonb, text);
drop function if exists public.ds_order_buyer_short(text);
drop function if exists public.ds_order_usd(bigint);
drop function if exists public.ds_order_expiry_days();

drop table if exists public.dropship_channel_tasks;
drop table if exists public.dropship_order_events;
drop table if exists public.dropship_order_intake;
drop table if exists public.dropship_order_settings;
