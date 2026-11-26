-- Octopus Dropship · Release 3 · Step 8 (paying for orders) + the source-agnostic part of Step 7 (order intake rules).
-- Down: supabase/migrations/down/20261101000245_ds8_order_payment_intake.down.sql
--
-- One installed function is REPLACED (see 9.); the down restores its exact installed definition. Everything else
-- below is new and the down drops it, so the up → down schema diff is empty. Re-runnable inside one transaction
-- (if not exists / create or replace / drop … if exists before each policy and trigger / ACLs revoked then granted in a
-- fixed order), so supabase/tests/lib-later-migrations.mjs unwind + reapply keeps working.
--
-- Owner decision 26 Nov 2026: the Shopify connection (and YunExpress live keys) come LAST. So intake here takes an order
-- from ANY source (the future Shopify webhook / hourly catch-up, CSV, API, or the staff staging-only test path) through
-- one function, and everything a store must be told (release an unpaid order, accept / reject a cancellation) is queued
-- as a channel task that the Step 7 executor works off once a store is connected — nothing is pretended meanwhile.
--
--  1. dropship_order_settings — how new orders are paid (wallet automatically / payment protection / pay later — the
--     last only for credit_eligible organisations) and whether new orders are charged automatically.
--  2. dropship_order_intake — one row per store order: "+N items not from Octopus", buyer risk, address check, the hold
--     with its exact reason (high risk / address / stock shortage / duties not known), the payment window (expiry), how
--     it was paid, the OCT-DS invoice, cancellation and address-after-packing problem state.
--  3. dropship_order_events — the merchant's order timeline (received, held, charged, awaiting funds, expired, …).
--  4. dropship_channel_tasks — what the store must be told (staff / service only; Step 7 executor).
--  5. Intake: ds_order_intake(org, channel, order) — service role (webhook / catch-up job); ds_test_order_create — staff
--     with Dropship edit rights on STAGING only. Only Octopus lines are stored (others counted), dedupe on
--     (org, channel, external order id), quote locked at intake (create_dropship_store_order stores the fee / rate /
--     duty version IDs, FX and billed weight), holds with exact reasons, auto-pay per merchant setting.
--  6. Paying: ds_order_charge(ids[], option) "Charge and ship" per order or in bulk (oldest first); wallet → OCT-DS
--     invoice + balanced journal (wallet → Dropship revenue); payment protection → the existing escrow hold (held until
--     7 days after delivery; invoice issued on release, revenue journal on release by trigger); pay later → existing
--     credit terms (credit_eligible only) + OCT-DS invoice due in net days + receivable journal. Not enough funds →
--     "Awaiting payment · N days left"; unpaid orders expire after N days (site setting dropship.unpaid_expiry_days,
--     default 3): released, never charged. After payment the existing store_order.paid event hands the order to the
--     warehouse (handoffs → Warehouse OS "Dropship orders ready" → wh_import_dropship_order; W3a / W4 do the rest).
--  7. Cancellation before packing (stock released, refund to the wallet / credit note), rejected after; address change
--     before packing applied (warehouse order too), after packing → problem flow.
--  8. Jobs (pg_cron every 10 min, service role): expire unpaid orders, pay waiting orders oldest first when funds arrive,
--     release payment protection 7 days after delivery (no dispute).
--
--  9. REPLACES generate_dropship_weekly_statement (exact installed definition restored by the down): CN-DS credit notes of
--     the period are listed (negative lines) and taken off the STMT-DS total. Requires W7 (244), which already moves the
--     paid-event reservation and the stock label from the legacy 'SZ-01' to default_warehouse_code().
--
-- Money: integer US cents; the FX rate of the buyer currency is stored on the store order at intake. Every money movement
-- is one balanced journal (post_journal refuses unbalanced ones). Paused / closed merchants can't start new charges
-- (assert_dropship_new_activity) but keep reading, cancelling and their history. Merchants read their own rows only.

-- ───────────────────────── 1. Tables ─────────────────────────
create table if not exists public.dropship_order_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  payment_mode text not null default 'wallet' check (payment_mode in ('wallet', 'protection', 'pay_later')),
  auto_pay boolean not null default true,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users(id) on delete set null
);

create table if not exists public.dropship_order_intake (
  store_order_id uuid primary key references public.store_orders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  other_items_count integer not null default 0 check (other_items_count >= 0),
  risk_level text not null default 'unknown' check (risk_level in ('low', 'medium', 'high', 'unknown')),
  address_ok boolean not null default true,
  address_issue text check (address_issue is null or length(address_issue) <= 300),
  hold_code text check (hold_code is null or hold_code in ('high_risk', 'address', 'stock_shortage', 'duty_unknown')),
  hold_message text check (hold_message is null or length(hold_message) <= 400),
  payment_due_at timestamptz,
  expired_at timestamptz,
  payment_option text check (payment_option is null or payment_option in ('wallet', 'protection', 'pay_later')),
  charged_cents bigint check (charged_cents is null or charged_cents >= 0),
  charged_at timestamptz,
  charge_journal_id uuid,
  invoice_id uuid references public.documents(id) on delete set null,
  credit_document_id uuid references public.documents(id) on delete set null,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  last_charge_error text check (last_charge_error is null or length(last_charge_error) <= 60),
  cancel_state text check (cancel_state is null or cancel_state in ('accepted', 'rejected')),
  cancel_message text check (cancel_message is null or length(cancel_message) <= 400),
  problem_code text check (problem_code is null or problem_code in ('address_after_packing')),
  problem_detail jsonb,
  test_order boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dropship_order_intake_org_idx on public.dropship_order_intake (org_id, created_at desc);
create index if not exists dropship_order_intake_due_idx on public.dropship_order_intake (payment_due_at) where expired_at is null and charged_at is null;
create index if not exists dropship_order_intake_invoice_idx on public.dropship_order_intake (invoice_id);
create index if not exists dropship_order_intake_cdoc_idx on public.dropship_order_intake (credit_document_id);
create index if not exists dropship_order_intake_entity_idx on public.dropship_order_intake (legal_entity_id);

create table if not exists public.dropship_order_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  store_order_id uuid not null references public.store_orders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('received', 'held', 'hold_cleared', 'charged', 'awaiting_funds', 'charge_failed', 'expired',
    'cancel_accepted', 'cancel_rejected', 'address_updated', 'address_problem', 'refunded', 'handed_to_warehouse', 'protection_released')),
  title text not null check (length(title) between 1 and 200),
  body text check (body is null or length(body) <= 600),
  amount_cents bigint,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists dropship_order_events_order_idx on public.dropship_order_events (store_order_id, created_at);
create index if not exists dropship_order_events_org_idx on public.dropship_order_events (org_id, created_at desc);

create table if not exists public.dropship_channel_tasks (
  id uuid primary key default gen_random_uuid(),
  store_order_id uuid not null references public.store_orders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  action text not null check (action in ('release_fulfillment', 'accept_cancellation', 'reject_cancellation')),
  status text not null default 'waiting_store' check (status in ('waiting_store', 'done', 'not_needed')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (store_order_id, action)
);
create index if not exists dropship_channel_tasks_org_idx on public.dropship_channel_tasks (org_id);
create index if not exists dropship_channel_tasks_open_idx on public.dropship_channel_tasks (status, created_at) where status = 'waiting_store';

-- ───────────────────────── 2. RLS + grants (merchants read their own org; nobody but the service role writes) ─────────────────────────
alter table public.dropship_order_settings enable row level security;
alter table public.dropship_order_intake enable row level security;
alter table public.dropship_order_events enable row level security;
alter table public.dropship_channel_tasks enable row level security;

drop policy if exists ds8_own_read on public.dropship_order_settings;
create policy ds8_own_read on public.dropship_order_settings for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds8_own_read on public.dropship_order_intake;
create policy ds8_own_read on public.dropship_order_intake for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds8_own_read on public.dropship_order_events;
create policy ds8_own_read on public.dropship_order_events for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds8_staff_read on public.dropship_channel_tasks;
create policy ds8_staff_read on public.dropship_channel_tasks for select to authenticated using (is_staff());

revoke all on public.dropship_order_settings, public.dropship_order_intake, public.dropship_order_events, public.dropship_channel_tasks
  from public, anon, authenticated, service_role;
grant select on public.dropship_order_settings, public.dropship_order_intake, public.dropship_order_events, public.dropship_channel_tasks to authenticated;
grant all on public.dropship_order_settings, public.dropship_order_intake, public.dropship_order_events, public.dropship_channel_tasks to service_role;

-- ───────────────────────── 2a. CN-DS credit notes on the STMT-DS weekly statement (REPLACES the installed function) ─────────────────────────
-- Exactly the installed generate_dropship_weekly_statement plus: credit notes of the period listed (data.credit_notes), negative
-- invoice lines, taken off the total, paid_cents never below 0, re-run compares the credit-note count. The down restores it.
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
  v_credits jsonb := '[]'::jsonb;
  v_credit_total bigint := 0;
  cn record;
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

  -- DS8: CN-DS credit notes issued in the period (cancelled orders, refunds) are listed and taken off the total
  for cn in
    select c.id, c.number, c.amount_cents, c.currency, c.created_at, c.original_document_id, o.number as invoice_number
      from public.documents c
      left join public.documents o on o.id = c.original_document_id
     where c.org_id = p_org
       and c.division_id = v_div
       and c.doc_type = 'credit_note'
       and coalesce(c.status, '') not in ('void', 'cancelled')
       and c.created_at >= p_from
       and c.created_at <= p_to
     order by c.created_at asc, c.id asc
  loop
    v_credits := v_credits || jsonb_build_array(jsonb_build_object(
      'credit_note_id', cn.id,
      'number', cn.number,
      'invoice_number', cn.invoice_number,
      'original_document_id', cn.original_document_id,
      'amount_cents', cn.amount_cents,
      'currency', cn.currency,
      'issued_at', cn.created_at
    ));
    v_credit_total := v_credit_total + coalesce(cn.amount_cents, 0);
  end loop;
  v_total := v_total - v_credit_total;

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
       and coalesce((v_prev_data ->> 'sample_count')::int, -1) = jsonb_array_length(v_samples)
       and coalesce((v_prev_data ->> 'credit_note_count')::int, 0) = jsonb_array_length(v_credits) then
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
           paid_cents = greatest(0, v_total - v_unpaid),
           status = case when v_unpaid = 0 then 'paid' else 'awaiting_payment' end,
           data = coalesce(v_prev_data, '{}'::jsonb) || jsonb_build_object(
             'service', 'dropship',
             'period_from', p_from,
             'period_to', p_to,
             'invoice_count', jsonb_array_length(v_items),
             'sample_count', jsonb_array_length(v_samples),
             'total_cents', v_total,
             'paid_cents', greatest(0, v_total - v_unpaid),
             'unpaid_cents', v_unpaid,
             'invoices', v_items,
             'sample_orders', v_samples,
              'credit_note_count', jsonb_array_length(v_credits),
              'credit_notes_cents', v_credit_total,
              'credit_notes', v_credits
           )
     where id = v_stmt_id;

    delete from public.invoice_lines where document_id = v_stmt_id;
  else
    insert into public.documents (
      org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents, currency, status, data
    )
    values (
      p_org, v_div, v_entity, 'statement', v_stmt_no, v_total, greatest(0, v_total - v_unpaid), 'USD',
      case when v_unpaid = 0 then 'paid' else 'awaiting_payment' end,
      jsonb_build_object(
        'service', 'dropship',
        'period_from', p_from,
        'period_to', p_to,
        'invoice_count', jsonb_array_length(v_items),
        'sample_count', jsonb_array_length(v_samples),
        'total_cents', v_total,
        'paid_cents', greatest(0, v_total - v_unpaid),
        'unpaid_cents', v_unpaid,
        'invoices', v_items,
        'sample_orders', v_samples,
              'credit_note_count', jsonb_array_length(v_credits),
              'credit_notes_cents', v_credit_total,
              'credit_notes', v_credits
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

  insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
  select v_stmt_id,
         'dropship',
         'Credit note ' || (c ->> 'number') || coalesce(' (for invoice ' || (c ->> 'invoice_number') || ')', ''),
         1,
         - coalesce((c ->> 'amount_cents')::bigint, 0),
         - coalesce((c ->> 'amount_cents')::bigint, 0),
         'document',
         c ->> 'credit_note_id'
    from jsonb_array_elements(v_credits) c;

  return jsonb_build_object(
    'statement_id', v_stmt_id,
    'number', v_stmt_no,
    'legal_entity_id', v_entity,
    'invoice_count', jsonb_array_length(v_items),
    'sample_count', jsonb_array_length(v_samples),
    'credit_note_count', jsonb_array_length(v_credits),
    'credit_notes_cents', v_credit_total,
    'total_cents', v_total,
    'unpaid_cents', v_unpaid
  );
end $function$;

-- ───────────────────────── 3. Small helpers (internal) ─────────────────────────
-- Unpaid orders expire after N days (site setting dropship.unpaid_expiry_days, Admin; default 3, kept within 1..30)
create or replace function public.ds_order_expiry_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, least(30, coalesce((select (value #>> '{}')::int from public.site_settings where key = 'dropship.unpaid_expiry_days'), 3)))
$$;

create or replace function public.ds_order_usd(p_cents bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_cents is null then 'not known yet' else 'US$' || to_char(p_cents / 100.0, 'FM999,999,990.00') end
$$;

-- "Omar Saleh" → "Omar S." (the merchant's list shows the buyer's first name and initial only)
create or replace function public.ds_order_buyer_short(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_name is null or btrim(p_name) = '' then null
    when position(' ' in btrim(p_name)) = 0 then btrim(p_name)
    else split_part(btrim(p_name), ' ', 1) || ' ' || upper(left(btrim(regexp_replace(btrim(p_name), '^\S+\s+', '')), 1)) || '.'
  end
$$;

-- Address check (no geocoder yet): street, city, the order's country, and the postcode format of countries that use one.
-- null = OK, otherwise one plain sentence naming the field and how to fix it.
create or replace function public.ds_order_address_problem(p_addr jsonb, p_country text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  c text := upper(btrim(coalesce(p_country, '')));
  pc text;
begin
  if p_addr is null or jsonb_typeof(p_addr) <> 'object' then return 'The delivery address is missing.'; end if;
  pc := upper(btrim(coalesce(p_addr ->> 'postcode', p_addr ->> 'zip', '')));
  if length(btrim(coalesce(p_addr ->> 'line1', ''))) < 3 then return 'Street address is missing. Enter the street and number.'; end if;
  if length(btrim(coalesce(p_addr ->> 'city', ''))) < 2 then return 'City is missing. Enter the city.'; end if;
  if nullif(btrim(coalesce(p_addr ->> 'country', '')), '') is not null and upper(btrim(p_addr ->> 'country')) <> c then
    return 'The country in the address is not the order''s destination country.';
  end if;
  if c = 'US' and pc !~ '^\d{5}(-\d{4})?$' then return 'Postcode: a US ZIP code has 5 digits, like 10001.'; end if;
  if c = 'CA' and pc !~ '^[A-Z]\d[A-Z] ?\d[A-Z]\d$' then return 'Postcode: a Canadian postcode looks like K1A 0B1.'; end if;
  if c = 'GB' and pc !~ '^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$' then return 'Postcode: a UK postcode looks like SW1A 1AA.'; end if;
  if c in ('DE', 'FR', 'SA', 'KW') and pc !~ '^\d{5}$' then return 'Postcode: it has 5 digits in this country.'; end if;
  if c = 'NL' and pc !~ '^\d{4} ?[A-Z]{2}$' then return 'Postcode: a Dutch postcode looks like 1012 AB.'; end if;
  if c = 'AU' and pc !~ '^\d{4}$' then return 'Postcode: an Australian postcode has 4 digits.'; end if;
  if c = 'SG' and pc !~ '^\d{6}$' then return 'Postcode: a Singapore postcode has 6 digits.'; end if;
  return null;
end $$;

create or replace function public.ds_order_event(p_so uuid, p_org uuid, p_kind text, p_title text, p_body text default null, p_amount bigint default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.dropship_order_events (store_order_id, org_id, kind, title, body, amount_cents)
  values (p_so, p_org, p_kind, left(p_title, 200), left(p_body, 600), p_amount)
$$;

-- what the connected store must be told; channels without a store connection need nothing
create or replace function public.ds_order_channel_task(p_so uuid, p_org uuid, p_channel text, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.dropship_channel_tasks (store_order_id, org_id, channel, action, status, detail)
  values (p_so, p_org, p_channel, p_action, case when p_channel = 'shopify' then 'waiting_store' else 'not_needed' end, coalesce(p_detail, '{}'::jsonb))
  on conflict (store_order_id, action) do nothing
$$;

-- money held under payment protection for this org's Dropship orders (not yet released / refunded)
create or replace function public.ds_order_held_cents(p_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(e.amount_cents - e.released_cents - e.refunded_cents), 0)::bigint
    from public.escrow_holds e
   where e.org_id = p_org and e.service = 'dropship' and e.store_order_id is not null
     and e.status in ('held', 'partially_released', 'disputed')
$$;

-- Packing has started when the warehouse order is past picking (or units are picked) or the parcel left
create or replace function public.ds_order_packing_started(p_so uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.store_orders so where so.id = p_so and so.staff_stage in ('handed_over', 'delivered'))
      or exists (select 1 from public.wh_orders w
                  where w.store_order_id = p_so and w.status <> 'cancelled'
                    and (w.status in ('picked', 'packing', 'packed', 'labelled', 'shipped', 'exception')
                         or exists (select 1 from public.wh_order_lines l where l.order_id = w.id and l.picked_qty > 0)))
$$;

-- a fast-ship line with less free stock than ordered at the default warehouse — where the paid event reserves (W7, 244:
-- default_warehouse_code() instead of the legacy 'SZ-01'), so "On hold: stock" before charging and the paid event agree
create or replace function public.ds_order_stock_short(p_so uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from (select i.item_id, sum(i.qty)::int as qty from public.store_order_items i
             where i.store_order_id = p_so and i.fulfilment_type = 'fast_ship' group by i.item_id) need
      left join public.warehouse_stock s on s.warehouse_id = public.default_warehouse_code() and s.item_id = need.item_id
     where greatest(0, coalesce(s.on_hand_qty, 0) - coalesce(s.reserved_qty, 0)) < need.qty
       and not exists (select 1 from public.warehouse_stock_movements m where m.store_order_id = p_so and m.item_id = need.item_id and m.kind = 'reserve'))
$$;

-- pay later: only for credit_eligible organisations with active credit terms (never shown to anyone else)
create or replace function public.ds_order_pay_later_ok(p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.organizations o where o.id = p_org and o.credit_eligible is true) then return false; end if;
  if not exists (select 1 from public.payment_option_settings m where m.service = 'dropship' and m.option = 'pay_later' and m.enabled) then return false; end if;
  v := public.get_customer_credit_status(p_org, division_id_of('DS'));
  return coalesce((v ->> 'eligible')::boolean, false);
end $$;

create or replace function public.ds_order_err(p_msg text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when p_msg ~ '^[A-Z][A-Z_]+:' then
      jsonb_build_object('ok', false, 'code', split_part(p_msg, ':', 1), 'message', btrim(substr(p_msg, position(':' in p_msg) + 1)))
    when p_msg ~ '^[A-Z][A-Z_]+$' then jsonb_build_object('ok', false, 'code', p_msg, 'message', p_msg)
    else jsonb_build_object('ok', false, 'code', 'ERROR', 'message', p_msg) end
$$;

-- set or clear the hold (store_orders.staff_stage on_hold ↔ unpaid; merchant_status follows by the existing trigger)
create or replace function public.ds_order_set_hold(p_so uuid, p_code text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare so public.store_orders;
begin
  select * into so from public.store_orders where id = p_so for update;
  update public.dropship_order_intake
     set hold_code = p_code, hold_message = left(p_message, 400), updated_at = now()
   where store_order_id = p_so;
  if p_code is not null then
    if so.payment_state = 'unpaid' and so.cancelled_at is null then
      update public.store_orders set staff_stage = 'on_hold', hold_reason = case p_code when 'address' then 'address_failed' else p_code end, updated_at = now()
       where id = p_so;
    end if;
    perform public.ds_order_event(p_so, so.org_id, 'held',
      case p_code when 'high_risk' then 'On hold: high risk' when 'address' then 'On hold: address problem'
                  when 'stock_shortage' then 'On hold: stock shortage' else 'On hold: duties not known yet' end, p_message);
  else
    if so.payment_state = 'unpaid' and so.cancelled_at is null and so.staff_stage = 'on_hold' then
      update public.store_orders set staff_stage = 'unpaid', hold_reason = null, updated_at = now() where id = p_so;
    end if;
    perform public.ds_order_event(p_so, so.org_id, 'hold_cleared', 'Hold cleared', p_message);
  end if;
end $$;

-- ───────────────────────── 4. Paying one order (the core; every caller wraps it in its own sub-transaction) ─────────────────────────
-- p_option: 'wallet' | 'protection' | 'pay_later' | null (the merchant's setting). p_mode: 'merchant' (Charge and ship —
-- clears a high-risk hold) | 'auto' (new order / waiting order: never charges a held order).
create or replace function public.ds_order_charge_core(p_so uuid, p_option text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders;
  x public.dropship_order_intake;
  st public.dropship_order_settings;
  v_div uuid := division_id_of('DS');
  v_entity uuid := current_legal_entity_id(now());
  v_opt text;
  v_amt bigint;
  v_avail bigint;
  v_inv_id uuid;
  v_inv_no text;
  v_j uuid;
  v_hold uuid;
  v_res jsonb;
  v_net int;
  v_due timestamptz;
  v_items text;
  v_units int;
  v_inv_status text;
begin
  select * into so from public.store_orders where id = p_so for update;
  if so.id is null then raise exception 'NOT_FOUND: This order was not found.'; end if;
  if coalesce(so.kind, 'store') = 'sample' then raise exception 'SAMPLE_ORDER: Sample orders are paid when they are placed.'; end if;
  select * into x from public.dropship_order_intake where store_order_id = so.id for update;
  if x.store_order_id is null then
    insert into public.dropship_order_intake (store_order_id, org_id, channel, payment_due_at)
    values (so.id, so.org_id, so.channel, so.created_at + make_interval(days => public.ds_order_expiry_days()))
    returning * into x;
  end if;
  if so.payment_state <> 'unpaid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'store_order_id', so.id, 'order_number', so.order_number, 'payment_state', so.payment_state);
  end if;
  if x.expired_at is not null then raise exception 'ORDER_EXPIRED: The payment window ended, so this order went back to your store and was not charged.'; end if;
  if so.cancelled_at is not null then raise exception 'ORDER_CANCELLED: This order is cancelled.'; end if;
  perform public.assert_dropship_new_activity(so.org_id);
  if x.hold_code = 'address' then raise exception 'ADDRESS_PROBLEM: Fix the delivery address first. %', coalesce(x.address_issue, ''); end if;
  if x.hold_code = 'duty_unknown' or so.total_cents is null then
    raise exception 'DUTY_UNKNOWN: Duties for this country are not known yet, so the order can''t be charged. Octopus adds them soon, or choose duties paid by the buyer (DAP) in Packing and shipping for new orders.';
  end if;
  if x.hold_code = 'high_risk' and p_mode <> 'merchant' then
    raise exception 'HIGH_RISK: This order is on hold as high risk. Check it in your store, then choose Charge and ship or Cancel.';
  end if;
  if public.ds_order_stock_short(so.id) then
    if x.hold_code is distinct from 'stock_shortage' then
      perform public.ds_order_set_hold(so.id, 'stock_shortage', 'Not enough stock for this order right now. It is not charged; Octopus tells you when it is back.');
    end if;
    raise exception 'STOCK_SHORT: Not enough stock for this order right now, so it was not charged.';
  end if;

  select * into st from public.dropship_order_settings where org_id = so.org_id;
  v_opt := coalesce(nullif(btrim(coalesce(p_option, '')), ''), st.payment_mode, 'wallet');
  if v_opt not in ('wallet', 'protection', 'pay_later') then raise exception 'INVALID_INPUT: Choose how to pay.'; end if;
  if v_opt = 'pay_later' and not public.ds_order_pay_later_ok(so.org_id) then
    -- never reveal pay later: an explicit request is refused as unavailable; the saved setting falls back to the wallet
    if nullif(btrim(coalesce(p_option, '')), '') is not null then raise exception 'OPTION_UNAVAILABLE: This payment option is not available.'; end if;
    v_opt := 'wallet';
  end if;
  v_amt := so.total_cents;

  if v_opt in ('wallet', 'protection') then
    perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || so.org_id, 'USD')));
    v_avail := wallet_balance(so.org_id, 'USD');
    if v_avail < v_amt then
      update public.dropship_order_intake set last_charge_error = 'WALLET_INSUFFICIENT', updated_at = now() where store_order_id = so.id;
      if p_mode = 'auto' and not exists (select 1 from public.dropship_order_events e where e.store_order_id = so.id and e.kind = 'awaiting_funds') then
        perform public.ds_order_event(so.id, so.org_id, 'awaiting_funds', 'Waiting for payment',
          format('Your wallet has %s; this order needs %s. It waits until %s, then goes back to your store unfulfilled.',
                 public.ds_order_usd(v_avail), public.ds_order_usd(v_amt), to_char(x.payment_due_at at time zone 'UTC', 'DD Mon YYYY')), v_amt);
      end if;
      return jsonb_build_object('ok', false, 'code', 'WALLET_INSUFFICIENT', 'store_order_id', so.id, 'order_number', so.order_number,
        'available_cents', v_avail, 'needed_cents', v_amt, 'payment_due_at', x.payment_due_at,
        'message', format('Not enough in your wallet: you have %s and this order needs %s. Add funds; the order waits until %s.',
                          public.ds_order_usd(v_avail), public.ds_order_usd(v_amt), to_char(x.payment_due_at at time zone 'UTC', 'DD Mon YYYY')));
    end if;
  end if;

  -- a merchant's explicit Charge and ship clears the high-risk hold (they checked the order in their store)
  if x.hold_code is not null then
    perform public.ds_order_set_hold(so.id, null, case when x.hold_code = 'high_risk' then 'You checked the order and chose Charge and ship.' else null end);
  end if;

  select string_agg(i.qty || ' × ' || i.model_no || ' ' || i.title_snapshot || coalesce(' (' || nullif(btrim(i.variant_label), '') || ')', ''), '; ' order by i.created_at, i.id),
         coalesce(sum(i.qty), 0)::int
    into v_items, v_units
    from public.store_order_items i where i.store_order_id = so.id;

  if v_opt = 'protection' then
    v_hold := public.create_escrow_hold_internal(so.org_id, v_div, 'dropship', 'dropship_order', so.id, 'wallet', v_amt, 'USD', 'ds-prot:' || so.id::text, null);
    select hold_journal_id into v_j from public.escrow_holds where id = v_hold;
  else
    if v_opt = 'pay_later' then
      v_res := public.checkout_pay_later(so.org_id, 'dropship', 'dropship_order', so.id, v_amt, 'USD', 'ds-paylater:' || so.id::text);
      v_net := coalesce((v_res ->> 'net_days')::int, 30);
      v_due := now() + make_interval(days => v_net);
      v_inv_status := 'awaiting_payment';
    else
      v_inv_status := 'paid';
    end if;
    v_inv_no := next_document_number('invoice', v_div, now(), v_entity);
    insert into public.documents (org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents, currency, status,
                                  payment_option, due_at, credit_terms_days, data)
    values (so.org_id, v_div, v_entity, 'commercial_invoice', v_inv_no, v_amt, case when v_opt = 'wallet' then v_amt else 0 end, 'USD', v_inv_status,
            case when v_opt = 'wallet' then 'pay_now' else 'pay_later' end, v_due, v_net,
            jsonb_build_object('service', 'dropship', 'store_order_id', so.id, 'order_number', so.order_number,
              'external_order_name', so.external_order_name, 'title', 'Dropship order ' || so.order_number,
              'payment_option', case when v_opt = 'wallet' then 'wallet' else 'pay_later' end,
              'product_cents', so.product_cents, 'processing_cents', so.processing_cents, 'shipping_cents', so.shipping_cents,
              'duties_cents', so.duties_cents, 'incoterm', so.incoterm, 'destination_country', so.destination_country,
              'shipping_method', so.shipping_method, 'billed_weight_g', so.billed_weight_g,
              'buyer_currency', so.buyer_currency, 'fx_rate_to_usd', so.fx_rate_to_usd, 'net_days', v_net, 'due_at', v_due))
    returning id into v_inv_id;
    insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    select v_inv_id, 'dropship', l.d, 1, l.c, l.c, 'store_order', so.id::text
      from (values
        (1, left('Products: ' || coalesce(v_items, ''), 500), so.product_cents),
        (2, 'Processing (pick, pack and packaging) · ' || v_units || ' item' || case when v_units = 1 then '' else 's' end, so.processing_cents),
        (3, 'Shipping · ' || so.shipping_method || coalesce(' · ' || so.billed_weight_g || ' g billed', '') || ' · ' || so.destination_country, so.shipping_cents),
        (4, 'Duties and tax (DDP)', case when so.incoterm = 'DDP' then so.duties_cents end)
      ) as l(n, d, c)
     where l.c is not null
     order by l.n;
    if v_opt = 'wallet' then
      v_j := post_journal('Dropship order ' || so.order_number || ' · ' || v_inv_no || ' · paid from wallet',
        jsonb_build_array(
          jsonb_build_object('account', wallet_account(so.org_id, 'USD'), 'debit', v_amt, 'credit', 0, 'org', so.org_id),
          jsonb_build_object('account', revenue_account('dropship', 'USD'), 'debit', 0, 'credit', v_amt)),
        'ds-charge:' || so.id::text, 'dropship', 'store_order', so.id);
    else
      v_j := post_journal('Dropship order ' || so.order_number || ' · ' || v_inv_no || ' · pay later (Net ' || v_net || ')',
        jsonb_build_array(
          jsonb_build_object('account', receivable_account(so.org_id, 'USD'), 'debit', v_amt, 'credit', 0, 'org', so.org_id),
          jsonb_build_object('account', revenue_account('dropship', 'USD'), 'debit', 0, 'credit', v_amt)),
        'ds-paylater-ar:' || so.id::text, 'dropship', 'store_order', so.id);
      update public.credit_reservations set status = 'invoiced', invoice_id = v_inv_id, invoiced_at = now()
       where id = (v_res ->> 'reservation_id')::uuid and status = 'reserved';
    end if;
    update public.journals set division_id = v_div where id = v_j;
    update public.ledger_entries set division_id = v_div where journal_id = v_j;
    perform public.mark_store_order_paid(so.id, null, null);
  end if;

  update public.dropship_order_intake
     set payment_option = v_opt, charged_cents = v_amt, charged_at = now(), charge_journal_id = v_j, invoice_id = v_inv_id,
         legal_entity_id = v_entity, last_charge_error = null, updated_at = now()
   where store_order_id = so.id;
  select * into so from public.store_orders where id = so.id;
  perform public.ds_order_event(so.id, so.org_id, 'charged',
    case v_opt when 'wallet' then 'Paid from your wallet' when 'protection' then 'Paid with payment protection' else 'Pay later' end,
    case v_opt when 'wallet' then format('%s charged. Invoice %s.', public.ds_order_usd(v_amt), v_inv_no)
               when 'protection' then format('%s held until 7 days after delivery, then released. The invoice is issued on release.', public.ds_order_usd(v_amt))
               else format('%s on invoice %s, due %s.', public.ds_order_usd(v_amt), v_inv_no, to_char(v_due at time zone 'UTC', 'DD Mon YYYY')) end,
    v_amt);
  if so.staff_stage in ('packing', 'sourcing', 'paid_to_assign') then
    perform public.ds_order_event(so.id, so.org_id, 'handed_to_warehouse', 'Sent to the warehouse',
      case when so.staff_stage = 'sourcing' then 'Some items are being sourced first; packing starts when they arrive.' else 'Stock is reserved; the warehouse picks and packs it.' end);
  elsif so.hold_reason = 'stock_shortage' then
    update public.dropship_order_intake set hold_code = 'stock_shortage', hold_message = 'Paid. Waiting for stock before packing.', updated_at = now() where store_order_id = so.id;
  end if;
  perform write_audit('ds_order.charged', 'store_orders', so.id::text,
    jsonb_build_object('org_id', so.org_id, 'order_number', so.order_number, 'option', v_opt, 'amount_cents', v_amt, 'invoice', v_inv_no,
                       'journal_id', v_j, 'hold_id', v_hold, 'mode', p_mode, 'legal_entity_id', v_entity));
  return jsonb_build_object('ok', true, 'store_order_id', so.id, 'order_number', so.order_number, 'option', v_opt, 'amount_cents', v_amt,
    'invoice_number', v_inv_no, 'payment_state', so.payment_state, 'merchant_status', so.merchant_status);
end $$;

-- auto-pay a new or waiting order when the merchant's setting says so (never raises)
create or replace function public.ds_order_try_auto(p_so uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_org uuid;
begin
  select org_id into v_org from public.store_orders where id = p_so;
  if exists (select 1 from public.dropship_order_settings s where s.org_id = v_org and not s.auto_pay) then
    return jsonb_build_object('ok', false, 'code', 'AUTO_PAY_OFF', 'message', 'Automatic payment is off; pay this order from the Orders page.');
  end if;
  begin
    v := public.ds_order_charge_core(p_so, null, 'auto');
  exception when others then
    v := public.ds_order_err(sqlerrm);
  end;
  return v;
end $$;

-- ───────────────────────── 5. Intake (source-agnostic) ─────────────────────────
-- p_order: { external_order_id, external_order_name?, buyer_name?, buyer_phone?, address: {name, phone?, line1, line2?, city,
--   region?, postcode?, country}, address_check?: 'ok' | 'failed', address_issue?, risk?: 'low' | 'medium' | 'high',
--   currency?: 'USD', fx_rate_to_usd?, shipping_method?, other_items?: n, lines: [{ variant_id? | model_no?, qty,
--   buyer_unit_price_cents?, title? }] }. Lines that are not an Octopus variant visible to this merchant are not stored —
--   they are counted ("+N items not from Octopus").
create or replace function public.ds_order_intake_core(p_org uuid, p_channel text, p_order jsonb, p_test boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_ext text := nullif(btrim(coalesce(p_order ->> 'external_order_id', '')), '');
  v_addr jsonb := p_order -> 'address';
  v_country text;
  v_cur text := upper(coalesce(nullif(btrim(p_order ->> 'currency'), ''), 'USD'));
  v_method text;
  v_incoterm text;
  v_line jsonb;
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_lines jsonb := '[]'::jsonb;
  v_other int := greatest(0, coalesce((p_order ->> 'other_items')::int, 0));
  v_qty int;
  v_res jsonb;
  v_so public.store_orders;
  v_risk text := lower(coalesce(nullif(btrim(p_order ->> 'risk'), ''), 'unknown'));
  v_addr_problem text;
  v_hold text;
  v_hold_msg text;
  v_pay jsonb;
  v_existing public.store_orders;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then raise exception 'NOT_FOUND: Organisation not found.'; end if;
  if v_channel not in ('shopify', 'woocommerce', 'csv', 'manual', 'api') then raise exception 'INVALID_INPUT: Unknown sales channel.'; end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' or jsonb_typeof(p_order -> 'lines') is distinct from 'array' then
    raise exception 'INVALID_INPUT: The order needs a list of lines.';
  end if;
  if v_ext is null then
    if v_channel = 'manual' then v_ext := 'TEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    else raise exception 'INVALID_INPUT: external_order_id is required.'; end if;
  end if;
  if v_risk not in ('low', 'medium', 'high', 'unknown') then v_risk := 'unknown'; end if;
  if not dropship_feature_on('orders') then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_OFF', 'message', 'Orders are not switched on yet.');
  end if;

  -- dedupe on (org, channel, external order id): the second delivery of the same order (webhook retry, hourly catch-up) is ignored
  perform pg_advisory_xact_lock(hashtext('ds-intake:' || p_org::text || ':' || v_channel || ':' || v_ext));
  select * into v_existing from public.store_orders where org_id = p_org and channel = v_channel and external_order_id = v_ext limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'store_order_id', v_existing.id, 'order_number', v_existing.order_number);
  end if;

  if exists (select 1 from public.company_services cs where cs.org_id = p_org and cs.service = 'dropship'
                and (cs.status = 'paused' or (cs.status = 'off' and cs.started_at is not null))) then
    perform write_audit('ds_order.intake_refused', 'organizations', p_org::text, jsonb_build_object('org_id', p_org, 'channel', v_channel, 'external_order_id', v_ext, 'code', 'DROPSHIP_PAUSED'));
    return jsonb_build_object('ok', false, 'code', 'DROPSHIP_PAUSED', 'message', 'Dropshipping is paused or closed for this company, so new orders are not taken. Fulfil this order in your store.');
  end if;

  -- only Octopus lines are stored; everything else is counted
  for v_line in select * from jsonb_array_elements(p_order -> 'lines') loop
    v_qty := greatest(0, coalesce((v_line ->> 'qty')::int, 0));
    if v_qty = 0 then continue; end if;
    v_var := null;
    if nullif(v_line ->> 'variant_id', '') is not null and (v_line ->> 'variant_id') ~ '^[0-9a-fA-F-]{36}$' then
      select * into v_var from public.dropship_variants where id = (v_line ->> 'variant_id')::uuid;
    elsif upper(btrim(coalesce(v_line ->> 'model_no', ''))) ~ '^DS-\d{6}-\d{2}$' then
      select * into v_var from public.dropship_variants where model_no = upper(btrim(v_line ->> 'model_no'));
    end if;
    if v_var.id is not null then
      select * into v_prod from public.dropship_products where id = v_var.product_id;
    end if;
    if v_var.id is null or v_prod.id is null or not public.ds_product_visible(v_prod, p_org) then
      v_other := v_other + v_qty;
      continue;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('variant_id', v_var.id, 'qty', v_qty,
      'buyer_unit_price_cents', nullif(v_line ->> 'buyer_unit_price_cents', '')::bigint,
      'variant_label', nullif(btrim(coalesce(v_line ->> 'variant_label', '')), ''))));
  end loop;
  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', true, 'ignored', true, 'code', 'NO_OCTOPUS_ITEMS', 'message', 'No Octopus items in this order; nothing to do.', 'other_items', v_other);
  end if;

  v_country := upper(btrim(coalesce(nullif(v_addr ->> 'country', ''), p_order ->> 'country', '')));
  if v_country !~ '^[A-Z]{2}$' then raise exception 'INVALID_INPUT: The delivery country is missing.'; end if;
  v_method := lower(coalesce(nullif(btrim(p_order ->> 'shipping_method'), ''), public.ds_default_method(p_org)));
  if v_method not in ('economy', 'standard', 'express') then v_method := public.ds_default_method(p_org); end if;
  v_incoterm := public.ds_duty_mode(p_org, v_country);

  v_res := public.create_dropship_store_order(
    p_org, v_channel, v_ext, nullif(btrim(coalesce(p_order ->> 'external_order_name', '')), ''),
    coalesce(nullif(btrim(coalesce(p_order ->> 'buyer_name', '')), ''), nullif(btrim(coalesce(v_addr ->> 'name', '')), ''), 'Buyer'),
    coalesce(nullif(btrim(coalesce(p_order ->> 'buyer_phone', '')), ''), nullif(btrim(coalesce(v_addr ->> 'phone', '')), '')),
    coalesce(v_addr, '{}'::jsonb), v_country, v_cur, nullif(p_order ->> 'fx_rate_to_usd', '')::numeric, v_method, v_incoterm, v_lines, coalesce(p_test, false));
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    perform write_audit('ds_order.intake_refused', 'organizations', p_org::text,
      jsonb_build_object('org_id', p_org, 'channel', v_channel, 'external_order_id', v_ext, 'code', v_res ->> 'code'));
    return jsonb_build_object('ok', false, 'code', coalesce(v_res ->> 'code', 'QUOTE_FAILED'), 'message', coalesce(v_res ->> 'message', 'This order could not be priced.'));
  end if;
  if coalesce((v_res ->> 'idempotent')::boolean, false) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'store_order_id', v_res ->> 'store_order_id', 'order_number', v_res ->> 'order_number');
  end if;
  select * into v_so from public.store_orders where id = (v_res ->> 'store_order_id')::uuid;

  v_addr_problem := case when lower(coalesce(p_order ->> 'address_check', '')) = 'failed'
                         then coalesce(nullif(btrim(p_order ->> 'address_issue'), ''), 'The store''s address check failed. Check the address with the buyer.')
                         else public.ds_order_address_problem(v_addr, v_country) end;
  insert into public.dropship_order_intake (store_order_id, org_id, channel, other_items_count, risk_level, address_ok, address_issue, payment_due_at, test_order)
  values (v_so.id, p_org, v_channel, v_other, v_risk, v_addr_problem is null, left(v_addr_problem, 300),
          now() + make_interval(days => public.ds_order_expiry_days()), coalesce(p_test, false));
  perform public.ds_order_event(v_so.id, p_org, 'received', 'Order received',
    case when v_other > 0 then format('%s from %s. +%s item%s not from Octopus stay with you.', coalesce(v_so.external_order_name, v_so.order_number), v_channel, v_other, case when v_other = 1 then '' else 's' end)
         else format('%s from %s.', coalesce(v_so.external_order_name, v_so.order_number), v_channel) end,
    v_so.total_cents);

  -- holds with exact reasons (before the wallet is charged, so cancelling needs no refund)
  if v_risk = 'high' then
    v_hold := 'high_risk'; v_hold_msg := 'Your store rated this order high risk. It is not charged and not shipped. Check it in your store, then choose.';
  elsif v_addr_problem is not null then
    v_hold := 'address'; v_hold_msg := v_addr_problem;
  elsif v_so.total_cents is null then
    v_hold := 'duty_unknown'; v_hold_msg := 'Duties for this country are not known yet, so the order can''t be charged.';
  elsif public.ds_order_stock_short(v_so.id) then
    v_hold := 'stock_shortage'; v_hold_msg := 'Not enough stock for this order right now. It is not charged.';
  end if;
  if v_hold is not null then
    perform public.ds_order_set_hold(v_so.id, v_hold, v_hold_msg);
  else
    v_pay := public.ds_order_try_auto(v_so.id);
  end if;
  select * into v_so from public.store_orders where id = v_so.id;
  perform write_audit('ds_order.received', 'store_orders', v_so.id::text,
    jsonb_build_object('org_id', p_org, 'channel', v_channel, 'external_order_id', v_ext, 'order_number', v_so.order_number,
                       'other_items', v_other, 'hold', v_hold, 'charged', coalesce((v_pay ->> 'ok')::boolean, false), 'test', coalesce(p_test, false)));
  return jsonb_build_object('ok', true, 'duplicate', false, 'store_order_id', v_so.id, 'order_number', v_so.order_number,
    'other_items', v_other, 'hold_code', v_hold, 'total_cents', v_so.total_cents, 'payment_state', v_so.payment_state,
    'merchant_status', v_so.merchant_status, 'payment', v_pay);
end $$;

-- service role: the store webhook / hourly catch-up job / CSV or API importer
create or replace function public.ds_order_intake(p_org uuid, p_channel text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.ds_order_intake_core(p_org, p_channel, p_order, false);
end $$;

-- staff with Dropship edit rights, STAGING ONLY: create a test order for a merchant (channel "manual", flagged as a test)
create or replace function public.ds_test_order_create(p_org uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted() and dropship_can_edit(division_id_of('DS'))) then
    raise exception 'FORBIDDEN: Only Dropship staff can create test orders.';
  end if;
  if not public.wh_env_is_staging() then
    raise exception 'STAGING_ONLY: Test orders can only be created on staging.';
  end if;
  return public.ds_order_intake_core(p_org, 'manual', p_order, true);
end $$;

-- ───────────────────────── 6. Cancellation and address change (source-agnostic cores) ─────────────────────────
create or replace function public.ds_order_cancel_core(p_so uuid, p_reason text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders;
  x public.dropship_order_intake;
  w public.wh_orders;
  l public.wh_order_lines;
  h public.escrow_holds;
  inv public.documents;
  v_reason text := left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), case when p_source = 'store' then 'Cancelled in the store' else 'Cancelled by the merchant' end), 300);
  v_refund bigint := 0;
  v_cn_id uuid;
  v_cn_no text;
  v_j uuid;
  v_claims text;
  v_msg text;
  v_div uuid := division_id_of('DS');
begin
  select * into so from public.store_orders where id = p_so for update;
  if so.id is null then raise exception 'NOT_FOUND: This order was not found.'; end if;
  if so.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'accepted', true, 'already', true, 'store_order_id', so.id, 'order_number', so.order_number);
  end if;
  select * into x from public.dropship_order_intake where store_order_id = so.id for update;
  if x.store_order_id is null then
    insert into public.dropship_order_intake (store_order_id, org_id, channel) values (so.id, so.org_id, so.channel) returning * into x;
  end if;

  if public.ds_order_packing_started(so.id) then
    v_msg := 'Packing has started, so this order can''t be cancelled. After delivery you can ask for a return from Support.';
    update public.dropship_order_intake set cancel_state = 'rejected', cancel_message = v_msg, updated_at = now() where store_order_id = so.id;
    perform public.ds_order_event(so.id, so.org_id, 'cancel_rejected', 'Cancellation refused', v_msg);
    if p_source = 'store' then perform public.ds_order_channel_task(so.id, so.org_id, so.channel, 'reject_cancellation', jsonb_build_object('reason', v_msg)); end if;
    perform write_audit('ds_order.cancel_rejected', 'store_orders', so.id::text, jsonb_build_object('org_id', so.org_id, 'source', p_source, 'reason', v_reason));
    return jsonb_build_object('ok', true, 'accepted', false, 'store_order_id', so.id, 'order_number', so.order_number, 'message', v_msg);
  end if;

  -- a warehouse order not yet picked: cancel it and release its reservation (system action, after the checks above)
  select * into w from public.wh_orders where store_order_id = so.id and status <> 'cancelled' for update;
  if w.id is not null then
    v_claims := coalesce(current_setting('request.jwt.claims', true), '');
    perform set_config('request.jwt.claims', '', true);
    begin
      if w.allocated_at is not null then
        for l in select * from public.wh_order_lines where order_id = w.id order by item_id loop
          perform public.wh_post_order_movement(w.id, l.item_id, 'release', l.qty, format('Order %s cancelled: %s', w.code, v_reason), w.warehouse_code);
        end loop;
      end if;
      update public.wh_orders set status = 'cancelled', cancel_reason = left(v_reason, 500), cancelled_at = now(), updated_at = now() where id = w.id;
    exception when others then
      perform set_config('request.jwt.claims', v_claims, true);
      raise;
    end;
    perform set_config('request.jwt.claims', v_claims, true);
    perform write_audit('wh_order.cancelled', 'wh_orders', w.id::text, jsonb_build_object('code', w.code, 'from', w.status, 'reason', v_reason, 'by', 'dropship_cancel'));
  end if;

  -- refund what was paid
  if so.payment_state = 'held' or (x.payment_option = 'protection' and so.escrow_hold_id is not null) then
    select * into h from public.escrow_holds where id = so.escrow_hold_id;
    if h.id is not null and h.amount_cents - h.released_cents - h.refunded_cents > 0 then
      v_refund := h.amount_cents - h.released_cents - h.refunded_cents;
      perform public.execute_escrow_action_internal(h.id, 'refund', v_refund, 'Cancelled before packing: ' || v_reason, auth.uid(), 'wallet');
    end if;
  elsif so.payment_state = 'paid' and x.charged_cents is not null and x.payment_option in ('wallet', 'pay_later') then
    v_refund := x.charged_cents;
    select * into inv from public.documents where id = x.invoice_id;
    v_j := post_journal('Dropship order ' || so.order_number || ' cancelled before packing · ' || case when x.payment_option = 'wallet' then 'refund to wallet' else 'invoice credited' end,
      jsonb_build_array(
        jsonb_build_object('account', revenue_account('dropship', 'USD'), 'debit', v_refund, 'credit', 0),
        case when x.payment_option = 'wallet'
          then jsonb_build_object('account', wallet_account(so.org_id, 'USD'), 'debit', 0, 'credit', v_refund, 'org', so.org_id)
          else jsonb_build_object('account', receivable_account(so.org_id, 'USD'), 'debit', 0, 'credit', v_refund, 'org', so.org_id) end),
      'ds-refund:' || so.id::text, case when x.payment_option = 'wallet' then 'refunds' else 'dropship' end, 'store_order', so.id);
    update public.journals set division_id = v_div where id = v_j;
    update public.ledger_entries set division_id = v_div where journal_id = v_j;
    if inv.id is not null then
      v_cn_no := next_document_number('credit_note', v_div, now(), inv.legal_entity_id);
      insert into public.documents (org_id, division_id, legal_entity_id, doc_type, number, amount_cents, currency, status, original_document_id, data)
      values (so.org_id, v_div, inv.legal_entity_id, 'credit_note', v_cn_no, v_refund, 'USD', 'issued', inv.id,
              jsonb_build_object('service', 'dropship', 'store_order_id', so.id, 'order_number', so.order_number, 'reason', v_reason,
                                 'refund_destination', case when x.payment_option = 'wallet' then 'wallet' else 'invoice' end))
      returning id into v_cn_id;
      if x.payment_option = 'pay_later' then
        -- the unpaid pay-later invoice is settled by the credit note (both stay on the STMT-DS statement: +X and −X)
        update public.documents set paid_cents = amount_cents, status = 'paid',
               data = coalesce(data, '{}'::jsonb) || jsonb_build_object('credited_by', v_cn_no, 'settled_by', 'credit_note') where id = inv.id;
      end if;
    end if;
    update public.store_orders set payment_state = 'refunded', updated_at = now() where id = so.id;
  end if;

  perform public.cancel_store_order(so.id, v_reason);
  v_msg := case when v_refund > 0 and x.payment_option = 'pay_later' then format('Order %s cancelled. Invoice credited with %s.', coalesce(so.external_order_name, so.order_number), public.ds_order_usd(v_refund))
                when v_refund > 0 then format('Order %s cancelled. %s returned to your wallet.', coalesce(so.external_order_name, so.order_number), public.ds_order_usd(v_refund))
                else format('Order %s cancelled. Nothing was charged.', coalesce(so.external_order_name, so.order_number)) end;
  update public.dropship_order_intake
     set cancel_state = 'accepted', cancel_message = v_msg, refunded_cents = refunded_cents + v_refund, credit_document_id = coalesce(v_cn_id, credit_document_id), updated_at = now()
   where store_order_id = so.id;
  perform public.ds_order_event(so.id, so.org_id, 'cancel_accepted', 'Cancelled', v_msg, nullif(v_refund, 0));
  if v_refund > 0 then perform public.ds_order_event(so.id, so.org_id, 'refunded', case when x.payment_option = 'pay_later' then 'Invoice credited' else 'Refunded to your wallet' end, v_msg, v_refund); end if;
  perform public.ds_order_channel_task(so.id, so.org_id, so.channel, case when p_source = 'store' then 'accept_cancellation' else 'release_fulfillment' end, jsonb_build_object('reason', v_reason));
  perform write_audit('ds_order.cancelled', 'store_orders', so.id::text,
    jsonb_build_object('org_id', so.org_id, 'source', p_source, 'reason', v_reason, 'refund_cents', v_refund, 'credit_note', v_cn_no, 'journal_id', v_j));
  return jsonb_build_object('ok', true, 'accepted', true, 'store_order_id', so.id, 'order_number', so.order_number, 'refund_cents', v_refund, 'credit_note', v_cn_no, 'message', v_msg);
end $$;

create or replace function public.ds_order_address_core(p_so uuid, p_address jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

-- service role: the store sent a cancellation request / an address change
create or replace function public.ds_order_channel_cancel(p_org uuid, p_channel text, p_external_order_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v uuid;
begin
  select id into v from public.store_orders where org_id = p_org and channel = lower(btrim(coalesce(p_channel, ''))) and external_order_id = btrim(coalesce(p_external_order_id, ''));
  if v is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'No Octopus order for this store order.'); end if;
  return public.ds_order_cancel_core(v, p_reason, 'store');
end $$;

create or replace function public.ds_order_channel_address(p_org uuid, p_channel text, p_external_order_id text, p_address jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v uuid;
begin
  select id into v from public.store_orders where org_id = p_org and channel = lower(btrim(coalesce(p_channel, ''))) and external_order_id = btrim(coalesce(p_external_order_id, ''));
  if v is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'No Octopus order for this store order.'); end if;
  begin
    return public.ds_order_address_core(v, p_address, 'store');
  exception when others then
    return public.ds_order_err(sqlerrm);
  end;
end $$;

-- ───────────────────────── 7. Merchant RPCs ─────────────────────────
create or replace function public.ds_order_own(p_so uuid)
returns public.store_orders
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
  so public.store_orders;
begin
  select * into so from public.store_orders where id = p_so;
  if so.id is null or so.org_id <> v_org then raise exception 'NOT_FOUND: This order was not found.'; end if;
  return so;
end $$;

create or replace function public.ds_orders_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
  st public.dropship_order_settings;
  v_status text;
  v_rows jsonb;
  v_credit boolean;
begin
  perform ds_feature_guard('orders');
  select * into st from public.dropship_order_settings where org_id = v_org;
  select status into v_status from public.company_services where org_id = v_org and service = 'dropship';
  select coalesce(credit_eligible, false) into v_credit from public.organizations where id = v_org;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.order_number desc), '[]'::jsonb) into v_rows from (
    select so.id, so.order_number, so.external_order_name, so.channel, so.kind, so.created_at, so.destination_country, so.incoterm, so.shipping_method,
           so.total_cents, so.product_cents, so.processing_cents, so.shipping_cents, so.duties_cents, so.payment_state, so.merchant_status,
           so.cancelled_at, so.delivered_at, public.ds_order_buyer_short(so.buyer_name) as buyer,
           (select coalesce(jsonb_agg(jsonb_build_object('title', i.title_snapshot, 'variant', i.variant_label, 'qty', i.qty, 'model_no', i.model_no) order by i.created_at, i.id), '[]'::jsonb)
              from public.store_order_items i where i.store_order_id = so.id) as items,
           coalesce(x.other_items_count, 0) as other_items, x.hold_code, x.hold_message, x.address_issue, x.payment_option, x.payment_due_at, x.expired_at,
           case when x.payment_due_at is not null and so.payment_state = 'unpaid' and so.cancelled_at is null
                then greatest(0, ceil(extract(epoch from (x.payment_due_at - now())) / 86400.0))::int end as days_left,
           x.cancel_state, x.cancel_message, x.problem_code, coalesce(x.refunded_cents, 0) as refunded_cents, x.last_charge_error, x.charged_at,
           coalesce(x.test_order, false) as test_order,
           d.number as invoice_number, d.due_at as invoice_due_at, d.status as invoice_status,
           eh.status as protection_status, eh.auto_release_at as protection_release_at,
           coalesce((select w.tracking_token from public.wh_orders w where w.store_order_id = so.id and w.tracking_token is not null limit 1),
                    (select sh.tracking_token from public.shipments sh where sh.store_order_id = so.id and sh.tracking_token is not null order by sh.created_at desc limit 1)) as track_token,
           so.shipping_address as address
      from public.store_orders so
      left join public.dropship_order_intake x on x.store_order_id = so.id
      left join public.documents d on d.id = coalesce(x.invoice_id, (select e2.invoice_id from public.escrow_holds e2 where e2.id = so.escrow_hold_id))
      left join public.escrow_holds eh on eh.id = so.escrow_hold_id
     where so.org_id = v_org
     order by so.created_at desc
     limit 200) r;
  return jsonb_build_object(
    'dropship_status', coalesce(v_status, 'off'),
    'wallet', jsonb_build_object('available_cents', wallet_balance(v_org, 'USD'), 'held_cents', public.ds_order_held_cents(v_org)),
    'settings', jsonb_build_object('payment_mode', coalesce(st.payment_mode, 'wallet'), 'auto_pay', coalesce(st.auto_pay, true), 'saved', st.org_id is not null),
    'pay_later', case when v_credit then public.ds_order_pay_later_ok(v_org) end,
    'expiry_days', public.ds_order_expiry_days(),
    'store_connected', exists (select 1 from public.store_connections c where c.org_id = v_org and c.status = 'active'),
    'rows', v_rows);
end $$;

create or replace function public.ds_order_detail_events(p_so uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare so public.store_orders := public.ds_order_own(p_so);
begin
  perform ds_feature_guard('orders');
  return (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'title', e.title, 'body', e.body, 'amount_cents', e.amount_cents, 'at', e.created_at) order by e.seq), '[]'::jsonb)
            from public.dropship_order_events e where e.store_order_id = so.id);
end $$;

-- Wallet page (Dropship): the two balances, how new orders are paid, waiting orders. Pay later appears ONLY for credit_eligible orgs.
create or replace function public.ds_wallet_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
  st public.dropship_order_settings;
  v_credit boolean;
  v_wait record;
  v_held record;
begin
  select * into st from public.dropship_order_settings where org_id = v_org;
  select coalesce(credit_eligible, false) into v_credit from public.organizations where id = v_org;
  select count(*)::int n, coalesce(sum(so.total_cents), 0)::bigint cents into v_wait
    from public.store_orders so join public.dropship_order_intake x on x.store_order_id = so.id
   where so.org_id = v_org and so.payment_state = 'unpaid' and so.cancelled_at is null and x.expired_at is null and x.hold_code is null and so.total_cents is not null;
  select count(*)::int n into v_held from public.escrow_holds e
   where e.org_id = v_org and e.service = 'dropship' and e.store_order_id is not null and e.status in ('held', 'partially_released', 'disputed');
  return jsonb_build_object(
    'orders_on', dropship_feature_on('orders'),
    'dropship_status', coalesce((select status from public.company_services where org_id = v_org and service = 'dropship'), 'off'),
    'available_cents', wallet_balance(v_org, 'USD'),
    'held_cents', public.ds_order_held_cents(v_org),
    'held_orders', v_held.n,
    'waiting_orders', v_wait.n,
    'waiting_cents', v_wait.cents,
    'expiry_days', public.ds_order_expiry_days(),
    'protection_days', coalesce((select auto_release_days from public.payment_option_settings where service = 'dropship' and option = 'payment_protection'), 7),
    'protection_enabled', coalesce((select enabled from public.payment_option_settings where service = 'dropship' and option = 'payment_protection'), true),
    'settings', jsonb_build_object('payment_mode', coalesce(st.payment_mode, 'wallet'), 'auto_pay', coalesce(st.auto_pay, true), 'saved', st.org_id is not null),
    'pay_later', case when v_credit then public.ds_order_pay_later_ok(v_org) end);
end $$;

create or replace function public.ds_order_settings_save(p_payment_mode text, p_auto_pay boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.assert_dropship_new_activity(null);
  v_mode text := lower(btrim(coalesce(p_payment_mode, '')));
begin
  perform ds_feature_guard('orders');
  if v_mode not in ('wallet', 'protection', 'pay_later') or (v_mode = 'pay_later' and not public.ds_order_pay_later_ok(v_org)) then
    raise exception 'INVALID_INPUT: Choose how new orders are paid.';
  end if;
  if v_mode = 'protection' and exists (select 1 from public.payment_option_settings m where m.service = 'dropship' and m.option = 'payment_protection' and not m.enabled) then
    raise exception 'OPTION_DISABLED: Payment protection is switched off by Octopus at the moment.';
  end if;
  insert into public.dropship_order_settings (org_id, payment_mode, auto_pay, saved_at, saved_by)
  values (v_org, v_mode, coalesce(p_auto_pay, true), now(), auth.uid())
  on conflict (org_id) do update set payment_mode = excluded.payment_mode, auto_pay = excluded.auto_pay, saved_at = now(), saved_by = auth.uid();
  perform write_audit('ds_order.settings_saved', 'dropship_order_settings', v_org::text, jsonb_build_object('org_id', v_org, 'payment_mode', v_mode, 'auto_pay', coalesce(p_auto_pay, true)));
  return jsonb_build_object('ok', true, 'payment_mode', v_mode, 'auto_pay', coalesce(p_auto_pay, true));
end $$;

-- "Charge and ship": one order or many (oldest first). Each order is its own sub-transaction; one refusal never undoes another.
create or replace function public.ds_order_charge(p_ids uuid[], p_option text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
  r record;
  v jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ok int := 0;
  v_bad int := 0;
begin
  perform ds_feature_guard('orders');
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 200 then raise exception 'INVALID_INPUT: Choose between 1 and 200 orders.'; end if;
  if p_option is not null and p_option not in ('wallet', 'protection', 'pay_later') then raise exception 'INVALID_INPUT: Choose how to pay.'; end if;
  for r in select so.id, so.order_number from public.store_orders so where so.id = any(p_ids) and so.org_id = v_org order by so.created_at, so.order_number loop
    begin
      v := public.ds_order_charge_core(r.id, p_option, 'merchant');
    exception when others then
      v := public.ds_order_err(sqlerrm) || jsonb_build_object('store_order_id', r.id, 'order_number', r.order_number);
    end;
    if coalesce((v ->> 'ok')::boolean, false) then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;
    v_results := v_results || jsonb_build_array(v);
  end loop;
  if jsonb_array_length(v_results) = 0 then raise exception 'NOT_FOUND: These orders were not found.'; end if;
  return jsonb_build_object('ok', v_bad = 0, 'charged', v_ok, 'failed', v_bad, 'results', v_results);
end $$;

create or replace function public.ds_order_cancel(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare so public.store_orders := public.ds_order_own(p_id);
begin
  -- cancelling is allowed for paused / closed merchants too (it stops activity, it doesn't start any)
  perform ds_feature_guard('orders');
  return public.ds_order_cancel_core(so.id, p_reason, 'merchant');
end $$;

create or replace function public.ds_order_update_address(p_id uuid, p_address jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare so public.store_orders := public.ds_order_own(p_id);
begin
  perform ds_feature_guard('orders');
  return public.ds_order_address_core(so.id, p_address, 'merchant');
end $$;

-- ───────────────────────── 8. Jobs (service role; pg_cron every 10 minutes) ─────────────────────────
create or replace function public.ds_order_expire_due()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
  v_days int := public.ds_order_expiry_days();
begin
  for r in
    select so.id, so.org_id, so.channel, so.order_number, so.external_order_name
      from public.dropship_order_intake x join public.store_orders so on so.id = x.store_order_id
     where x.expired_at is null and x.payment_due_at <= now() and so.payment_state = 'unpaid' and so.cancelled_at is null
     order by x.payment_due_at
     for update of x skip locked
  loop
    begin
      update public.dropship_order_intake set expired_at = now(), updated_at = now() where store_order_id = r.id;
      perform public.cancel_store_order(r.id, format('Not paid within %s days; released back to the store', v_days));
      perform public.ds_order_event(r.id, r.org_id, 'expired', 'Went back to your store',
        format('Order %s wasn''t paid in time, so Octopus didn''t ship it and nothing was charged. Fulfil it yourself or cancel it in your store.', coalesce(r.external_order_name, r.order_number)));
      perform public.ds_order_channel_task(r.id, r.org_id, r.channel, 'release_fulfillment', jsonb_build_object('reason', 'unpaid'));
      perform write_audit('ds_order.expired', 'store_orders', r.id::text, jsonb_build_object('org_id', r.org_id, 'days', v_days));
      n := n + 1;
    exception when others then
      perform write_audit('ds_order.expire_failed', 'store_orders', r.id::text, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;
  return n;
end $$;

-- waiting orders are paid oldest first when funds arrive (per org; stops at the first order the wallet can't cover)
create or replace function public.ds_order_autopay_waiting()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  r record;
  v jsonb;
  n int := 0;
begin
  for o in
    select distinct so.org_id
      from public.store_orders so join public.dropship_order_intake x on x.store_order_id = so.id
      join public.company_services cs on cs.org_id = so.org_id and cs.service = 'dropship' and cs.status = 'on'
     where so.payment_state = 'unpaid' and so.cancelled_at is null and x.expired_at is null and x.hold_code is null and so.total_cents is not null
       and not exists (select 1 from public.dropship_order_settings s where s.org_id = so.org_id and not s.auto_pay)
  loop
    for r in
      select so.id from public.store_orders so join public.dropship_order_intake x on x.store_order_id = so.id
       where so.org_id = o.org_id and so.payment_state = 'unpaid' and so.cancelled_at is null and x.expired_at is null and x.hold_code is null and so.total_cents is not null
       order by so.created_at, so.order_number
    loop
      begin
        v := public.ds_order_charge_core(r.id, null, 'auto');
      exception when others then
        v := public.ds_order_err(sqlerrm);
      end;
      if coalesce((v ->> 'ok')::boolean, false) then n := n + 1;
      elsif v ->> 'code' = 'WALLET_INSUFFICIENT' then exit;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- payment protection: released 7 days after delivery when nobody opened a dispute (invoice issued by the existing release)
create or replace function public.ds_protection_release_due()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  h record;
  n int := 0;
  v_no text;
begin
  for h in
    select e.id, e.org_id, e.store_order_id, e.amount_cents - e.released_cents - e.refunded_cents as rem
      from public.escrow_holds e
     where e.service = 'dropship' and e.store_order_id is not null and e.status = 'held' and e.dispute_opened_at is null
       and e.auto_release_at is not null and e.auto_release_at <= now()
     order by e.auto_release_at
     for update skip locked
  loop
    begin
      if h.rem > 0 then
        perform public.execute_escrow_action_internal(h.id, 'release', h.rem, 'Delivered + 7 days, no dispute', null, 'wallet');
        select coalesce(external_order_name, order_number) into v_no from public.store_orders where id = h.store_order_id;
        perform public.ds_order_event(h.store_order_id, h.org_id, 'protection_released', 'Payment released',
          format('%s moved from Held to paid for order %s. The order is complete.', public.ds_order_usd(h.rem), v_no), h.rem);
        n := n + 1;
      end if;
    exception when others then
      perform write_audit('ds_order.protection_release_failed', 'escrow_holds', h.id::text, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;
  return n;
end $$;

create or replace function public.ds_order_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a int; b int; c int;
begin
  a := public.ds_order_expire_due();
  b := public.ds_order_autopay_waiting();
  c := public.ds_protection_release_due();
  return jsonb_build_object('expired', a, 'paid', b, 'released', c);
end $$;

-- ───────────────────────── 9. Protection release → Dropship revenue + invoice lines (trigger on escrow_holds) ─────────────────────────
-- The existing release posts Held (payment protection) → receivable; for a store order nothing was invoiced before, so the
-- same amount is recognised as Dropship revenue here (receivable → revenue). Net: held → revenue, one balanced journal each.
create or replace function public.ds_escrow_release_revenue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta bigint := new.released_cents - old.released_cents;
  so public.store_orders;
  v_j uuid;
  v_div uuid := division_id_of('DS');
  v_items text;
  v_units int;
begin
  if new.store_order_id is null or v_delta <= 0 then return new; end if;
  select * into so from public.store_orders where id = new.store_order_id;
  v_j := post_journal('Dropship order ' || coalesce(so.order_number, new.store_order_id::text) || ' · revenue on payment protection release',
    jsonb_build_array(
      jsonb_build_object('account', receivable_account(new.org_id, new.currency), 'debit', v_delta, 'credit', 0, 'org', new.org_id),
      jsonb_build_object('account', revenue_account('dropship', new.currency), 'debit', 0, 'credit', v_delta)),
    'ds-prot-rev:' || new.id::text || ':' || new.released_cents::text, 'dropship', 'wallet_hold', new.id);
  update public.journals set division_id = v_div where id = v_j;
  update public.ledger_entries set division_id = v_div where journal_id = v_j;
  if new.invoice_id is not null and so.id is not null and not exists (select 1 from public.invoice_lines il where il.document_id = new.invoice_id) then
    select string_agg(i.qty || ' × ' || i.model_no || ' ' || i.title_snapshot || coalesce(' (' || nullif(btrim(i.variant_label), '') || ')', ''), '; ' order by i.created_at, i.id),
           coalesce(sum(i.qty), 0)::int into v_items, v_units
      from public.store_order_items i where i.store_order_id = so.id;
    insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    select new.invoice_id, 'dropship', l.d, 1, l.c, l.c, 'store_order', so.id::text
      from (values
        (1, left('Products: ' || coalesce(v_items, ''), 500), so.product_cents),
        (2, 'Processing (pick, pack and packaging) · ' || v_units || ' item' || case when v_units = 1 then '' else 's' end, so.processing_cents),
        (3, 'Shipping · ' || so.shipping_method || coalesce(' · ' || so.billed_weight_g || ' g billed', '') || ' · ' || so.destination_country, so.shipping_cents),
        (4, 'Duties and tax (DDP)', case when so.incoterm = 'DDP' then so.duties_cents end)
      ) as l(n, d, c)
     where l.c is not null
     order by l.n;
    update public.dropship_order_intake set invoice_id = coalesce(invoice_id, new.invoice_id), updated_at = now() where store_order_id = so.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ds_escrow_release_revenue on public.escrow_holds;
create trigger trg_ds_escrow_release_revenue
  after update of released_cents on public.escrow_holds
  for each row when (new.store_order_id is not null and new.released_cents > old.released_cents)
  execute function public.ds_escrow_release_revenue();

-- ───────────────────────── 10. Function grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'ds_order_expiry_days()', 'ds_order_usd(bigint)', 'ds_order_buyer_short(text)', 'ds_order_address_problem(jsonb, text)',
    'ds_order_event(uuid, uuid, text, text, text, bigint)', 'ds_order_channel_task(uuid, uuid, text, text, jsonb)', 'ds_order_held_cents(uuid)',
    'ds_order_packing_started(uuid)', 'ds_order_stock_short(uuid)', 'ds_order_pay_later_ok(uuid)', 'ds_order_err(text)',
    'ds_order_set_hold(uuid, text, text)', 'ds_order_charge_core(uuid, text, text)', 'ds_order_try_auto(uuid)',
    'ds_order_intake_core(uuid, text, jsonb, boolean)', 'ds_order_intake(uuid, text, jsonb)', 'ds_test_order_create(uuid, jsonb)',
    'ds_order_cancel_core(uuid, text, text)', 'ds_order_address_core(uuid, jsonb, text)',
    'ds_order_channel_cancel(uuid, text, text, text)', 'ds_order_channel_address(uuid, text, text, jsonb)',
    'ds_order_own(uuid)', 'ds_orders_page()', 'ds_order_detail_events(uuid)', 'ds_wallet_get()', 'ds_order_settings_save(text, boolean)',
    'ds_order_charge(uuid[], text)', 'ds_order_cancel(uuid, text)', 'ds_order_update_address(uuid, jsonb)',
    'ds_order_expire_due()', 'ds_order_autopay_waiting()', 'ds_protection_release_due()', 'ds_order_jobs()', 'ds_escrow_release_revenue()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- signed-in users: merchants (each RPC finds the merchant's own org itself) + staff for the staging test path
  foreach f in array array[
    'ds_orders_page()', 'ds_order_detail_events(uuid)', 'ds_wallet_get()', 'ds_order_settings_save(text, boolean)',
    'ds_order_charge(uuid[], text)', 'ds_order_cancel(uuid, text)', 'ds_order_update_address(uuid, jsonb)', 'ds_test_order_create(uuid, jsonb)',
    'ds_order_address_problem(jsonb, text)', 'ds_order_buyer_short(text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────────────────── 11. Schedule (pg_cron, where installed) ─────────────────────────
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-order-jobs') then
      perform cron.unschedule('octopus-dropship-order-jobs');
    end if;
    perform cron.schedule('octopus-dropship-order-jobs', '*/10 * * * *', 'select public.ds_order_jobs()');
  end if;
end $$;
