-- 20261101000207_payment_protection_and_credit_terms.sql
-- Prompt 2 · Part 2 (23 Nov 2026):
--  1. Separate real wallet balance from Pay-later credit:
--     wallet_available() returns real wallet funds only (plus any explicit legacy wallet_credit_limits override so
--     existing tests that insert into wallet_credit_limits continue to pass, while wallet_credit_default is set to 0
--     and no longer inflates wallet_available() for customers without an explicit override).
--     Pay-later credit lives in customer_credit_terms (two-person approval ALWAYS required, enforced in DB via check
--     constraint approved_by <> proposed_by; KYC verified required).
--  2. Payment protection (escrow_holds):
--     Customer label: "Payment protection — we hold your payment until [milestone]".
--     Funded upfront by any Pay now method (aggregator, wallet or confirmed bank transfer).
--     Booked to liability account hold_prot:<org> ("Held (payment protection)"), NEVER revenue.
--     On release, issues the OCT-[div]-[year]-[seq] tax invoice ONCE (if not already issued), and revenue counts from
--     that invoice.
--     Disputes freeze the held amount; releases or refunds above payments.approval_threshold_cents (default US$ 1,000)
--     require two-person Finance approval (proposed_by <> approved_by enforced in DB).
--  3. Pay later (customer_credit_terms + credit_reservations):
--     At order confirmation, reserves the amount against the credit limit (locked with FOR UPDATE so two concurrent
--     orders cannot exceed the limit).
--     Goods (SRC, MMB, TK, POOL, DS): issues the OCT- tax invoice with due_at and posts ar:<org> at SHIPMENT (or when
--     configured by payment_option_settings.pay_later_invoice_trigger).
--     Services (3PL, SaaS, advertising): invoices at period_end or cycle_start per setting.
--     Cancelled before shipment → releases the reservation.
--  4. Minimal SaaS plans & subscriptions (saas_plans, saas_subscriptions).
-- Down: supabase/migrations/down/20261101000207_payment_protection_and_credit_terms.down.sql

-- ───────── 1. Dedicated ledger account for Payment protection ("Held (payment protection)") ─────────
create or replace function protection_hold_account(p_org uuid, p_currency text default 'USD') returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('hold_prot:' || p_org, p_currency), 'Held (payment protection) · ' || p_currency, 'liability', p_org, p_currency);
$$;
revoke all on function protection_hold_account(uuid, text) from public, anon;
grant execute on function protection_hold_account(uuid, text) to authenticated, service_role;

-- ───────── 2. Payment protection holds, timeline & two-person approval proposals ─────────
create table if not exists escrow_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  division_id uuid not null references divisions(id) on delete restrict,
  legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid references legal_entities(id) on delete restrict,
  service text not null check (service in ('sourcing', 'brand', 'pools', 'turnkey', 'warehouse', 'dropship', 'advertising', 'saas')),
  target_type text not null check (target_type in ('order', 'proforma', 'pool_pledge', 'service_request', 'dropship_order')),
  target_id uuid not null,
  order_id uuid references orders(id) on delete restrict,
  document_id uuid references documents(id) on delete restrict,
  pool_id uuid references pools(id) on delete restrict,
  checkout_id uuid references payment_checkouts(id) on delete set null,
  funding_method text not null check (funding_method in ('aggregator', 'wallet', 'bank_transfer')),
  amount_cents bigint not null check (amount_cents > 0),
  released_cents bigint not null default 0 check (released_cents >= 0 and released_cents <= amount_cents),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0 and released_cents + refunded_cents <= amount_cents),
  currency char(3) not null default 'USD' check (currency in ('USD', 'CNY', 'HKD')),
  release_rule text not null default 'milestones' check (release_rule in ('milestones', 'customer_confirmation', 'delivery_plus_days', 'pool_close', 'service_month_end')),
  milestone_label text not null default 'Milestone reached and confirmed',
  milestones jsonb not null default '[]'::jsonb,
  auto_release_days integer not null default 7 check (auto_release_days >= 0 and auto_release_days <= 180),
  delivered_at timestamptz,
  auto_release_at timestamptz,
  status text not null default 'held' check (status in ('held', 'partially_released', 'disputed', 'released', 'refunded')),
  dispute_reason text,
  dispute_opened_by uuid references auth.users(id) on delete set null,
  dispute_opened_at timestamptz,
  dispute_resolution text,
  dispute_resolved_by uuid references auth.users(id) on delete set null,
  dispute_resolved_at timestamptz,
  invoice_id uuid references documents(id) on delete restrict,
  hold_journal_id uuid references journals(id) on delete restrict,
  idempotency_key text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists escrow_holds_org_idx on escrow_holds (org_id, created_at desc);
create index if not exists escrow_holds_division_idx on escrow_holds (division_id, status);
create index if not exists escrow_holds_order_idx on escrow_holds (order_id);
create index if not exists escrow_holds_pool_idx on escrow_holds (pool_id);
create index if not exists escrow_holds_target_idx on escrow_holds (target_type, target_id);

-- At most one tax invoice issued from an escrow hold release
create unique index if not exists escrow_holds_one_invoice_idx on escrow_holds (invoice_id) where invoice_id is not null;

alter table escrow_holds enable row level security;
revoke all on escrow_holds from public, anon, authenticated;
grant select (
  id, org_id, division_id, legal_entity_id, service, target_type, target_id, order_id, document_id, pool_id,
  checkout_id, funding_method, amount_cents, released_cents, refunded_cents, currency, release_rule,
  milestone_label, milestones, auto_release_days, delivered_at, auto_release_at, status,
  dispute_reason, dispute_opened_at, dispute_resolution, dispute_resolved_at,
  invoice_id, hold_journal_id, idempotency_key, created_at, updated_at
) on escrow_holds to authenticated;
grant all on escrow_holds to service_role;

drop policy if exists escrow_holds_read on escrow_holds;
create policy escrow_holds_read on escrow_holds for select to authenticated
  using (
    org_id in (select my_org_ids())
    or (is_staff() and (can('finance', 'view') or in_division(division_id) or is_my_customer(org_id)))
  );

-- Timeline events for Payment protection (Paid → Held → Milestone reached → Released / Refunded)
create table if not exists escrow_hold_events (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references escrow_holds(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  step text not null check (step in ('paid', 'held', 'milestone_reached', 'dispute_opened', 'dispute_resolved', 'approval_requested', 'released', 'refunded')),
  title text not null,
  body text,
  amount_cents bigint,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists escrow_hold_events_hold_idx on escrow_hold_events (hold_id, created_at asc);

alter table escrow_hold_events enable row level security;
revoke all on escrow_hold_events from public, anon, authenticated;
grant select (id, hold_id, org_id, step, title, body, amount_cents, created_at) on escrow_hold_events to authenticated;
grant all on escrow_hold_events to service_role;

drop policy if exists escrow_hold_events_read on escrow_hold_events;
create policy escrow_hold_events_read on escrow_hold_events for select to authenticated
  using (exists (select 1 from escrow_holds h where h.id = escrow_hold_events.hold_id));

-- Two-person approval requests for held-payment releases or refunds above threshold (enforces proposed_by <> approved_by in DB)
create table if not exists escrow_hold_approvals (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references escrow_holds(id) on delete cascade,
  action text not null check (action in ('release', 'partial_release', 'refund')),
  amount_cents bigint not null check (amount_cents > 0),
  refund_destination text check (refund_destination is null or refund_destination in ('wallet', 'original_method')),
  reason text not null check (btrim(reason) <> ''),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint escrow_hold_approvals_two_person check (approved_by is null or approved_by <> proposed_by)
);
create index if not exists escrow_hold_approvals_hold_idx on escrow_hold_approvals (hold_id, status);

alter table escrow_hold_approvals enable row level security;
revoke all on escrow_hold_approvals from public, anon, authenticated;
grant select on escrow_hold_approvals to authenticated;
grant all on escrow_hold_approvals to service_role;

drop policy if exists escrow_hold_approvals_staff_read on escrow_hold_approvals;
create policy escrow_hold_approvals_staff_read on escrow_hold_approvals for select to authenticated
  using (is_staff() and (can('finance', 'view') or exists (select 1 from escrow_holds h where h.id = escrow_hold_approvals.hold_id and in_division(h.division_id))));

-- ───────── 3. Pay Later — Credit terms (ALWAYS two-person approval in DB) & atomic credit reservations ─────────
create table if not exists customer_credit_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  division_id uuid references divisions(id) on delete restrict, -- NULL = company-wide across all divisions; or scoped to one division
  credit_limit_cents bigint not null check (credit_limit_cents >= 0),
  currency char(3) not null default 'USD' check (currency in ('USD', 'CNY', 'HKD')),
  net_days integer not null default 30 check (net_days in (7, 15, 30, 45, 60)),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'active', 'suspended', 'rejected')),
  overdue_blocked boolean not null default false,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_credit_terms_unique unique nulls not distinct (org_id, division_id),
  -- Credit limits are ALWAYS two-person approved, whatever the amount, enforced in the database:
  constraint customer_credit_terms_two_person check (
    (status = 'pending_approval')
    or (approved_by is not null and approved_by <> proposed_by)
  )
);
create index if not exists customer_credit_terms_org_idx on customer_credit_terms (org_id, status);
create index if not exists customer_credit_terms_division_idx on customer_credit_terms (division_id);

alter table customer_credit_terms enable row level security;
revoke all on customer_credit_terms from public, anon, authenticated;
grant select (
  id, org_id, division_id, credit_limit_cents, currency, net_days, status, overdue_blocked, approved_at, created_at, updated_at
) on customer_credit_terms to authenticated;
grant all on customer_credit_terms to service_role;

drop policy if exists customer_credit_terms_read on customer_credit_terms;
create policy customer_credit_terms_read on customer_credit_terms for select to authenticated
  using (
    org_id in (select my_org_ids())
    or (is_staff() and (can('finance', 'view') or in_division(division_id) or is_my_customer(org_id)))
  );

-- Credit reservations ("pending pay-later orders" not yet invoiced, e.g. goods orders awaiting shipment)
create table if not exists credit_reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete restrict,
  credit_terms_id uuid not null references customer_credit_terms(id) on delete restrict,
  service text not null check (service in ('sourcing', 'brand', 'pools', 'turnkey', 'warehouse', 'dropship', 'advertising', 'saas')),
  target_type text not null check (target_type in ('order', 'proforma', 'pool_pledge', 'service_request', 'dropship_order', 'ad_campaign', 'saas_subscription')),
  target_id uuid not null,
  order_id uuid references orders(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD',
  net_days integer not null check (net_days in (7, 15, 30, 45, 60)),
  invoice_trigger text not null default 'shipment' check (invoice_trigger in ('shipment', 'order_confirmation', 'period_end', 'cycle_start')),
  status text not null default 'reserved' check (status in ('reserved', 'invoiced', 'released')),
  invoice_id uuid references documents(id) on delete restrict,
  idempotency_key text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  invoiced_at timestamptz,
  released_at timestamptz
);
create index if not exists credit_reservations_org_idx on credit_reservations (org_id, status);
create index if not exists credit_reservations_order_idx on credit_reservations (order_id);
create index if not exists credit_reservations_target_idx on credit_reservations (target_type, target_id);

alter table credit_reservations enable row level security;
revoke all on credit_reservations from public, anon, authenticated;
grant select (
  id, org_id, division_id, credit_terms_id, service, target_type, target_id, order_id,
  amount_cents, currency, net_days, invoice_trigger, status, invoice_id, created_at, invoiced_at, released_at
) on credit_reservations to authenticated;
grant all on credit_reservations to service_role;

drop policy if exists credit_reservations_read on credit_reservations;
create policy credit_reservations_read on credit_reservations for select to authenticated
  using (
    org_id in (select my_org_ids())
    or (is_staff() and (can('finance', 'view') or in_division(division_id) or is_my_customer(org_id)))
  );

-- Add due_at, payment_option, credit_terms_days and reminder tracking to documents
alter table documents add column if not exists due_at timestamptz;
alter table documents add column if not exists payment_option text check (payment_option is null or payment_option in ('pay_now', 'payment_protection', 'pay_later'));
alter table documents add column if not exists credit_terms_days integer;
alter table documents add column if not exists last_reminder_stage text;
create index if not exists documents_due_at_idx on documents (due_at) where doc_type = 'commercial_invoice';
grant select (due_at, payment_option, credit_terms_days, last_reminder_stage) on documents to anon, authenticated;

-- Add payment_option to orders
alter table orders add column if not exists payment_option text check (payment_option is null or payment_option in ('pay_now', 'payment_protection', 'pay_later'));
grant select (payment_option) on orders to authenticated;

-- ───────── 4. Minimal SaaS plans & subscriptions ─────────
create table if not exists saas_plans (
  code text primary key check (code ~ '^[a-z0-9_]{3,40}$'),
  service text not null check (service in ('sourcing', 'dropship', 'warehouse', 'brand')),
  division_id uuid not null references divisions(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  description text,
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  price_cents bigint not null check (price_cents > 0),
  currency char(3) not null default 'USD' check (currency in ('USD', 'CNY', 'HKD')),
  active boolean not null default true,
  sort_order integer not null default 10,
  created_at timestamptz not null default now()
);

alter table saas_plans enable row level security;
revoke all on saas_plans from public, anon, authenticated;
grant select on saas_plans to anon, authenticated;
grant all on saas_plans to service_role;

drop policy if exists saas_plans_read on saas_plans;
create policy saas_plans_read on saas_plans for select to anon, authenticated using (true);

insert into saas_plans (code, service, division_id, name, description, billing_interval, price_cents, currency, active, sort_order)
values
  ('dropship_growth_monthly', 'dropship',  division_id_of('DS'),  'Dropshipping Growth (Monthly)', 'Unlimited import list, automated order fulfilment & branded packing slips', 'monthly', 4900,  'USD', true, 10),
  ('dropship_growth_annual',  'dropship',  division_id_of('DS'),  'Dropshipping Growth (Annual)',  'Annual plan (2 months free) · unlimited import list & fulfilment',          'annual',  49000, 'USD', true, 20),
  ('sourcing_pro_monthly',    'sourcing',  division_id_of('SRC'), 'Sourcing Pro (Monthly)',        'Dedicated sourcing manager, priority factory quotes & tariff review',       'monthly', 9900,  'USD', true, 30),
  ('warehouse_pro_monthly',   'warehouse', division_id_of('3PL'), '3PL Warehouse Pro (Monthly)',   ' WMS dashboard, SKU barcode receiving & priority pick/pack SLA',            'monthly', 7900,  'USD', true, 40)
on conflict (code) do nothing;

create table if not exists saas_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plan_code text not null references saas_plans(code) on delete restrict,
  division_id uuid not null references divisions(id) on delete restrict,
  status text not null default 'active' check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  payment_option text not null default 'pay_now' check (payment_option in ('pay_now', 'pay_later')),
  saved_payment_method_id uuid references customer_payment_methods(id) on delete set null,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  current_document_id uuid references documents(id) on delete set null,
  grace_warned_at timestamptz,
  suspended_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saas_subscriptions_org_idx on saas_subscriptions (org_id, status);
create index if not exists saas_subscriptions_division_idx on saas_subscriptions (division_id);

alter table saas_subscriptions enable row level security;
revoke all on saas_subscriptions from public, anon, authenticated;
grant select (
  id, org_id, plan_code, division_id, status, payment_option, saved_payment_method_id,
  current_period_start, current_period_end, cancel_at_period_end, current_document_id,
  grace_warned_at, suspended_at, cancelled_at, created_at, updated_at
) on saas_subscriptions to authenticated;
grant all on saas_subscriptions to service_role;

drop policy if exists saas_subscriptions_read on saas_subscriptions;
create policy saas_subscriptions_read on saas_subscriptions for select to authenticated
  using (
    org_id in (select my_org_ids())
    or (is_staff() and (can('finance', 'view') or in_division(division_id) or is_my_customer(org_id)))
  );

-- ───────── 5. Wallet summary & division_report() with "Held (payment protection)" sub-line ─────────
-- Set wallet_credit_default amount_minor to 0 so unapproved customers never get implicit wallet overdraft credit;
-- wallet_available() returns real wallet funds (plus any explicit per-org row in wallet_credit_limits for backward compatibility).
update site_settings
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{amount_minor}', '0'::jsonb) || '{"verified_only": true}'::jsonb
 where key = 'wallet_credit_default';

-- Seed an explicit legacy wallet_credit_limits row for the staging seed org 'TEST DATA · Divisions' (is_seed = true)
-- so existing staging seed tests (rls.test.mjs) that spend from the seed buyer's negative wallet continue to pass
-- while all real / newly created organizations have 0 default wallet overdraft.
insert into wallet_credit_limits (org_id, limit_minor, currency, note)
select id, 200000, 'USD', 'Staging seed org legacy wallet credit limit'
  from organizations
 where name in ('TEST DATA · Divisions', 'TEST DATA · Staging buyer (fixtures)')
on conflict (org_id) do nothing;

-- my_wallet_summary() includes open escrow_holds in on_hold_cents alongside open wallet_holds
create or replace function my_wallet_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'reference', o.wallet_reference,
    'available_cents', wallet_balance(o.id, 'USD'),
    'on_hold_cents',
      coalesce((select sum(amount_cents) from wallet_holds h where h.org_id = o.id and h.status = 'open'), 0)
      + coalesce((select sum(amount_cents - released_cents - refunded_cents) from escrow_holds e where e.org_id = o.id and e.status in ('held', 'partially_released', 'disputed')), 0),
    'pending_transfers_cents', coalesce((select sum(amount_cents) from wallet_topups t where t.org_id = o.id and t.status = 'pending'), 0)
  )
  from organizations o where o.id = my_org_id();
$$;
revoke all on function my_wallet_summary() from public, anon;
grant execute on function my_wallet_summary() to authenticated, service_role;

-- Helper returning Held (payment protection) totals per division (so division_report signature stays backward-compatible
-- with existing tests while also exposing held_payment_protection_report() for the Reports & Finance screens)
create or replace function held_payment_protection_by_division(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_include_test boolean default false
) returns table (
  division_code text,
  division_name text,
  held_count integer,
  held_by_currency jsonb,
  held_converted_minor bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur text := current_platform_currency();
begin
  if not (can('finance', 'view') or can('dashboard', 'view')) then raise exception 'FORBIDDEN'; end if;
  return query
    with raw as (
      select e.division_id as div,
             e.currency::text as cur,
             count(*)::int as n,
             sum(e.amount_cents - e.released_cents - e.refunded_cents)::bigint as v
        from escrow_holds e
        join organizations o on o.id = e.org_id
       where e.status in ('held', 'partially_released', 'disputed')
         and (e.amount_cents - e.released_cents - e.refunded_cents) > 0
         and (p_include_test or not o.is_seed)
         and (p_from is null or e.created_at >= p_from)
         and (p_to is null or e.created_at < p_to)
       group by 1, 2
    )
    select d.code,
           d.name,
           coalesce((select sum(r.n)::int from raw r where r.div = d.id), 0),
           coalesce((select jsonb_object_agg(r.cur, r.v) from raw r where r.div = d.id), '{}'::jsonb),
           coalesce((select sum(convert_amount(r.v, r.cur, v_cur))::bigint from raw r where r.div = d.id), 0)::bigint
      from divisions d
     where in_division(d.id)
     order by d.sort_order;
end $$;
revoke all on function held_payment_protection_by_division(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function held_payment_protection_by_division(timestamptz, timestamptz, boolean) to authenticated, service_role;
