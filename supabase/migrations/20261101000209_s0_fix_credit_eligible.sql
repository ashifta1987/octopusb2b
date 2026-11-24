-- 20261101000209_s0_fix_credit_eligible.sql
-- Step S0-fix (24 Nov 2026) — Schema, functions, triggers and grants ONLY (no data updates):
--  1. Add organizations.credit_eligible (boolean not null default false).
--  2. Customers must not be able to set credit_eligible, kyc_status, archived_at, registration_no, etc. themselves:
--     - Convert table-level UPDATE grant on public.organizations to column-level UPDATE grants for authenticated
--       restricted strictly to plain profile fields: (name, country, city, business_type, website).
--       Revoke UPDATE on public.organizations from anon.
--     - Add BEFORE INSERT OR UPDATE trigger trg_guard_org_credit_eligible on public.organizations that rejects
--       any change to credit_eligible unless current_setting('octopus.allow_credit_eligible_write', true) = 'true'.
--     - Add company-wide admin RPC set_org_credit_eligible(p_org, p_value, p_reason) which sets that local session guard,
--       updates organizations.credit_eligible, resets the session guard, and writes audit_log ('org.credit_eligible_changed').
--  3. Update Pay-later RPCs (get_customer_credit_status, propose_customer_credit_terms, decide_customer_credit_terms,
--     checkout_pay_later, subscribe_saas_plan) so every Pay-later path enforces organizations.credit_eligible = true
--     (returning/raising CREDIT_NOT_ELIGIBLE when false, and NO_CREDIT_TERMS when credit_eligible = true with no active terms),
--     removing all "Ask your account manager to set up credit" copy.
-- Down: supabase/migrations/down/20261101000209_s0_fix_credit_eligible.down.sql

-- ───────── 1. Column & Privilege Hardening on public.organizations ─────────
alter table public.organizations
  add column if not exists credit_eligible boolean not null default false;

comment on column public.organizations.credit_eligible is
  'Admin-only flag: whether this organization is eligible for Pay later (Net credit terms). Only writable via set_org_credit_eligible().';

-- SELECT: readable by authenticated & service_role; not granted to anon
revoke select (credit_eligible) on public.organizations from public, anon;
grant select (credit_eligible) on public.organizations to authenticated, service_role;

-- UPDATE: replace table-level UPDATE on public.organizations with explicit column-level UPDATE grants for authenticated
-- restricted strictly to plain profile fields (name, country, city, business_type, website).
-- Excluded from authenticated UPDATE: id, registration_no, kyc_status, created_at, updated_at, archived_at,
-- buyer_code, is_seed, wallet_reference, credit_eligible.
revoke update on public.organizations from public, anon, authenticated;
grant update (
  name,
  country,
  city,
  business_type,
  website
) on public.organizations to authenticated;
grant all on public.organizations to service_role;

-- ───────── 2. Trigger Guarding organizations.credit_eligible ─────────
create or replace function public.guard_org_credit_eligible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.credit_eligible, false) is true
       and coalesce(current_setting('octopus.allow_credit_eligible_write', true), '') <> 'true' then
      raise exception 'CREDIT_ELIGIBLE_ADMIN_ONLY: Use set_org_credit_eligible() to enable Pay later eligibility';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.credit_eligible is distinct from old.credit_eligible
       and coalesce(current_setting('octopus.allow_credit_eligible_write', true), '') <> 'true' then
      raise exception 'CREDIT_ELIGIBLE_ADMIN_ONLY: Use set_org_credit_eligible() to change Pay later eligibility';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_org_credit_eligible() from public, anon, authenticated;

drop trigger if exists trg_guard_org_credit_eligible on public.organizations;
create trigger trg_guard_org_credit_eligible
  before insert or update on public.organizations
  for each row execute function public.guard_org_credit_eligible();

-- ───────── 3. Admin-Only RPC: set_org_credit_eligible(p_org, p_value, p_reason) ─────────
create or replace function public.set_org_credit_eligible(
  p_org uuid,
  p_value boolean,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old boolean;
  v_new boolean := coalesce(p_value, false);
  v_clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: Only a company-wide admin can change Pay-later credit eligibility';
  end if;
  if p_org is null then
    raise exception 'NO_ORG';
  end if;
  if v_clean_reason is null then
    raise exception 'REASON_REQUIRED: Provide a reason for changing Pay-later credit eligibility';
  end if;

  select credit_eligible into v_old
    from public.organizations
   where id = p_org
     for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  perform set_config('octopus.allow_credit_eligible_write', 'true', true);

  update public.organizations
     set credit_eligible = v_new,
         updated_at = now()
   where id = p_org;

  perform set_config('octopus.allow_credit_eligible_write', '', true);

  perform write_audit(
    'org.credit_eligible_changed',
    'organizations',
    p_org::text,
    jsonb_build_object(
      'from', v_old,
      'to', v_new,
      'credit_eligible', v_new,
      'reason', v_clean_reason
    )
  );

  return jsonb_build_object(
    'org_id', p_org,
    'credit_eligible', v_new,
    'previous', v_old,
    'reason', v_clean_reason
  );
end;
$$;
revoke all on function public.set_org_credit_eligible(uuid, boolean, text) from public, anon;
grant execute on function public.set_org_credit_eligible(uuid, boolean, text) to authenticated, service_role;

-- ───────── 4. Enforce credit_eligible + CREDIT_NOT_ELIGIBLE / NO_CREDIT_TERMS across Pay-later RPCs ─────────

create or replace function public.propose_customer_credit_terms(
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
  o public.organizations;
  v_id uuid;
begin
  if v_uid is null or not (is_staff() and (can('finance', 'edit') or can('finance', 'approve') or is_admin())) then
    raise exception 'FORBIDDEN';
  end if;
  if p_org is null then
    raise exception 'NOT_FOUND';
  end if;
  select * into o from public.organizations where id = p_org;
  if o.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if o.credit_eligible is not true then
    raise exception 'CREDIT_NOT_ELIGIBLE: Organization is not marked credit_eligible by an admin';
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
revoke all on function public.propose_customer_credit_terms(uuid, bigint, integer, uuid, text, text) from public, anon;
grant execute on function public.propose_customer_credit_terms(uuid, bigint, integer, uuid, text, text) to authenticated, service_role;

create or replace function public.decide_customer_credit_terms(
  p_terms_id uuid,
  p_approve boolean,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t customer_credit_terms;
  o public.organizations;
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

  if p_approve then
    select * into o from public.organizations where id = t.org_id;
    if o.id is null or o.credit_eligible is not true then
      raise exception 'CREDIT_NOT_ELIGIBLE: Organization is not marked credit_eligible by an admin';
    end if;
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
revoke all on function public.decide_customer_credit_terms(uuid, boolean, text) from public, anon;
grant execute on function public.decide_customer_credit_terms(uuid, boolean, text) to authenticated, service_role;

create or replace function public.get_customer_credit_status(
  p_org uuid,
  p_division uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.organizations;
  t customer_credit_terms;
  v_unpaid bigint := 0;
  v_reserved bigint := 0;
  v_avail bigint := 0;
  v_grace int := coalesce((select (value #>> '{}')::int from site_settings where key = 'payments.pay_later_grace_days'), 7);
  v_overdue_past_grace boolean := false;
begin
  if p_org is null then
    return jsonb_build_object(
      'eligible', false,
      'credit_eligible', false,
      'reason', 'CREDIT_NOT_ELIGIBLE',
      'credit_limit_cents', 0,
      'unpaid_invoices_cents', 0,
      'reserved_cents', 0,
      'available_cents', 0,
      'net_days', 30
    );
  end if;
  if auth.uid() is not null and not (p_org in (select my_org_ids()) or is_staff()) then
    raise exception 'FORBIDDEN';
  end if;

  select * into o from public.organizations where id = p_org;
  if o.id is null or o.credit_eligible is not true then
    return jsonb_build_object(
      'eligible', false,
      'credit_eligible', false,
      'reason', 'CREDIT_NOT_ELIGIBLE',
      'credit_limit_cents', 0,
      'unpaid_invoices_cents', 0,
      'reserved_cents', 0,
      'available_cents', 0,
      'net_days', 30
    );
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

  if t.id is null or t.credit_limit_cents <= 0 then
    return jsonb_build_object(
      'eligible', false,
      'credit_eligible', true,
      'reason', 'NO_CREDIT_TERMS',
      'kyc_status', o.kyc_status,
      'credit_limit_cents', 0,
      'unpaid_invoices_cents', v_unpaid,
      'reserved_cents', v_reserved,
      'available_cents', 0,
      'net_days', 30
    );
  end if;

  if o.kyc_status <> 'verified' then
    return jsonb_build_object(
      'eligible', false,
      'credit_eligible', true,
      'reason', 'KYC_NOT_VERIFIED',
      'kyc_status', o.kyc_status,
      'credit_limit_cents', coalesce(t.credit_limit_cents, 0),
      'unpaid_invoices_cents', v_unpaid,
      'reserved_cents', v_reserved,
      'available_cents', 0,
      'net_days', coalesce(t.net_days, 30)
    );
  end if;

  v_avail := greatest(0, t.credit_limit_cents - v_unpaid - v_reserved);

  if t.overdue_blocked or v_overdue_past_grace then
    return jsonb_build_object(
      'eligible', false,
      'credit_eligible', true,
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
    'credit_eligible', true,
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
revoke all on function public.get_customer_credit_status(uuid, uuid) from public, anon;
grant execute on function public.get_customer_credit_status(uuid, uuid) to authenticated, service_role;

create or replace function public.checkout_pay_later(
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
  o public.organizations;
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
  select * into o from public.organizations where id = p_org for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if o.credit_eligible is not true then
    raise exception 'CREDIT_NOT_ELIGIBLE: Organization is not eligible for Pay later';
  end if;
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
    raise exception 'NO_CREDIT_TERMS: No active credit terms';
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
revoke all on function public.checkout_pay_later(uuid, text, text, uuid, bigint, text, text) from public, anon;
grant execute on function public.checkout_pay_later(uuid, text, text, uuid, bigint, text, text) to authenticated, service_role;

create or replace function public.subscribe_saas_plan(
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
  if p_payment_option = 'pay_later' then
    if not exists (select 1 from public.organizations where id = p_org and credit_eligible is true) then
      raise exception 'CREDIT_NOT_ELIGIBLE: Organization is not eligible for Pay later';
    end if;
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
revoke all on function public.subscribe_saas_plan(uuid, text, text, text, text) from public, anon;
grant execute on function public.subscribe_saas_plan(uuid, text, text, text, text) to authenticated, service_role;
