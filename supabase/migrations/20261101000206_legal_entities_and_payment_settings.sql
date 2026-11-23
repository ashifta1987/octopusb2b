-- 20261101000206_legal_entities_and_payment_settings.sql
-- Prompt 2 · Part 1 (23 Nov 2026):
--  1. Multi-company legal_entities (name, registration_no, tax_id, address, logo_key, default_currency, active_from, is_default).
--     Today everything stays on "Shenzhen Octopus Trading Co., Ltd." (seeded with deterministic id 00000000-0000-0000-0000-000000000001).
--     Old documents, proformas, payments and bank accounts link to their original entity forever.
--     document_counters are per entity (entity_id, series, year) so each company has its own gap-free OCT- and CN- series.
--  2. Payment option matrix (payment_option_settings): 8 services × 3 options (pay_now, payment_protection, pay_later),
--     with on/off, min/max amount, release_rule, auto_release_days, and pay_later_invoice_trigger ('shipment' | 'order_confirmation' | 'period_end' | 'cycle_start').
--     Only company-wide admin/finance can change it, and every change goes to the audit log.
--  3. Multi-provider aggregator routing (payment_provider_settings): mock, stripe, airwallex — enabled flag, methods,
--     legal_entity_id, fee mode (absorb by default vs surcharge with compliance warning).
--  4. Aggregator checkout & webhook tables: payment_checkouts, payment_webhook_events, customer_payment_methods (provider IDs only),
--     payment_settlements, payment_reconciliation_alerts.
-- Down: supabase/migrations/down/20261101000206_legal_entities_and_payment_settings.down.sql

-- ───────── 1. Legal entities ─────────
create table if not exists legal_entities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (btrim(code) <> ''),
  legal_name text not null check (btrim(legal_name) <> ''),
  legal_name_cn text,
  registration_no text,
  tax_id text,
  address text,
  address_cn text,
  registered_in text,
  governing_law text,
  logo_key text not null default 'octopus-b2b',
  default_currency char(3) not null default 'USD' check (default_currency in ('USD', 'CNY', 'HKD')),
  active_from timestamptz not null default '2026-01-01T00:00:00Z'::timestamptz,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'upcoming', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table legal_entities enable row level security;
revoke all on legal_entities from public, anon, authenticated;
grant select on legal_entities to anon, authenticated;
grant insert, update, delete on legal_entities to authenticated;
grant all on legal_entities to service_role;

drop policy if exists legal_entities_read on legal_entities;
create policy legal_entities_read on legal_entities for select to anon, authenticated using (true);

drop policy if exists legal_entities_write on legal_entities;
create policy legal_entities_write on legal_entities for all to authenticated
  using (is_admin() and staff_aal_ok())
  with check (is_admin() and staff_aal_ok());

-- Seed Shenzhen Octopus Trading Co., Ltd. as the current active default entity (deterministic UUID)
insert into legal_entities (
  id, code, legal_name, legal_name_cn, registration_no, tax_id, address, address_cn,
  registered_in, governing_law, logo_key, default_currency, active_from, is_default, status
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  'SZ-OCTOPUS',
  coalesce(cp.legal_name, 'Shenzhen Octopus Trading Co., Ltd.'),
  cp.legal_name_cn,
  cp.registration_no,
  cp.tax_id,
  cp.address,
  cp.address_cn,
  cp.registered_in,
  cp.governing_law,
  'octopus-b2b',
  'USD',
  '2026-01-01T00:00:00Z'::timestamptz,
  true,
  'active'
from company_profile cp where cp.id = 1
on conflict (id) do update set
  legal_name = excluded.legal_name,
  registration_no = excluded.registration_no,
  tax_id = excluded.tax_id,
  address = excluded.address;

-- Fallback if company_profile row 1 was absent
insert into legal_entities (id, code, legal_name, default_currency, active_from, is_default, status)
values ('00000000-0000-0000-0000-000000000001'::uuid, 'SZ-OCTOPUS', 'Shenzhen Octopus Trading Co., Ltd.', 'USD', '2026-01-01T00:00:00Z'::timestamptz, true, 'active')
on conflict (id) do nothing;

-- Current issuing entity at a given timestamp:
-- Uses any entity whose active_from <= p_at and is marked is_default (or scheduled via legal_entity.switch_schedule),
-- defaulting to Shenzhen Octopus Trading Co., Ltd. ('00000000-0000-0000-0000-000000000001').
create or replace function current_legal_entity_id(p_at timestamptz default now()) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_sched jsonb;
  v_target uuid;
  v_eff timestamptz;
  v_id uuid;
begin
  select value into v_sched from site_settings where key = 'legal_entity.switch_schedule';
  if v_sched is not null and jsonb_typeof(v_sched) = 'object' then
    v_target := nullif(v_sched ->> 'entity_id', '')::uuid;
    v_eff := nullif(v_sched ->> 'effective_at', '')::timestamptz;
    if v_target is not null and v_eff is not null and p_at >= v_eff
       and exists (select 1 from legal_entities where id = v_target and status = 'active') then
      return v_target;
    end if;
  end if;
  select id into v_id
    from legal_entities
   where status = 'active' and is_default and active_from <= p_at
   order by active_from desc
   limit 1;
  return coalesce(v_id, '00000000-0000-0000-0000-000000000001'::uuid);
end $$;
revoke all on function current_legal_entity_id(timestamptz) from public;
grant execute on function current_legal_entity_id(timestamptz) to anon, authenticated, service_role;

-- Link company_bank_accounts, documents, proforma_invoices and payments to their issuing legal_entity_id
alter table company_bank_accounts
  add column if not exists legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
  references legal_entities(id) on delete restrict;
create index if not exists company_bank_accounts_entity_idx on company_bank_accounts (legal_entity_id);
grant select (legal_entity_id) on company_bank_accounts to anon, authenticated;

alter table documents
  add column if not exists legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
  references legal_entities(id) on delete restrict;
create index if not exists documents_legal_entity_idx on documents (legal_entity_id);
grant select (legal_entity_id) on documents to anon, authenticated;

alter table proforma_invoices
  add column if not exists legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
  references legal_entities(id) on delete restrict;
create index if not exists proforma_invoices_legal_entity_idx on proforma_invoices (legal_entity_id);
grant select (legal_entity_id) on proforma_invoices to authenticated;

alter table payments
  add column if not exists legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
  references legal_entities(id) on delete restrict;
create index if not exists payments_legal_entity_idx on payments (legal_entity_id);
grant select (legal_entity_id) on payments to authenticated;

alter table document_payments
  add column if not exists legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
  references legal_entities(id) on delete restrict;
create index if not exists document_payments_legal_entity_idx on document_payments (legal_entity_id);
grant select (legal_entity_id) on document_payments to authenticated;

-- ───────── 2. Per-entity document_counters (gap-free per entity, series, year) ─────────
alter table document_counters
  add column if not exists entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
  references legal_entities(id) on delete restrict;

alter table document_counters drop constraint if exists document_counters_pkey;
alter table document_counters add constraint document_counters_pkey primary key (entity_id, series, year);

-- Replace document_series_number_key with per-entity uniqueness so each legal entity has its own gap-free series
drop index if exists documents_series_number_key;
create unique index if not exists documents_series_number_key
  on documents (legal_entity_id, number)
  where number ~ '^(OCT|CN|PF)-';

-- 4-argument next_document_number(p_kind, p_division, p_at, p_entity); keeps 3-arg calls working via default null
drop function if exists next_document_number(text, uuid, timestamptz);
create or replace function next_document_number(
  p_kind text,
  p_division uuid default null,
  p_at timestamptz default now(),
  p_entity uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_series text;
  v_year int := extract(year from (p_at at time zone 'Asia/Shanghai'))::int;
  v_code text;
  v_n bigint;
  v_entity uuid := coalesce(p_entity, current_legal_entity_id(p_at));
begin
  v_series := case p_kind when 'invoice' then 'OCT' when 'credit_note' then 'CN' when 'proforma' then 'PF' end;
  if v_series is null then raise exception 'DOCUMENT_KIND_UNKNOWN: %', p_kind; end if;
  if v_series in ('OCT', 'CN') then
    select code into v_code from divisions where id = p_division;
    if v_code is null then raise exception 'DOCUMENT_NEEDS_DIVISION: an invoice or credit note must belong to a division'; end if;
  end if;
  insert into document_counters as c (entity_id, series, year, last_value)
  values (v_entity, v_series, v_year, 1)
  on conflict (entity_id, series, year) do update
    set last_value = c.last_value + 1, updated_at = now()
  returning c.last_value into v_n;
  return case v_series
    when 'PF' then format('PF-%s-%s', v_year, lpad(v_n::text, 6, '0'))
    else format('%s-%s-%s-%s', v_series, v_code, v_year, lpad(v_n::text, 6, '0'))
  end;
end $$;
revoke all on function next_document_number(text, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function next_document_number(text, uuid, timestamptz, uuid) to service_role;

-- Stamp new documents with current_legal_entity_id() and put issuer legal_name into data->>'issuer' if not explicitly set
create or replace function trg_stamp_document_entity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ent legal_entities;
begin
  if new.legal_entity_id is null then
    new.legal_entity_id := current_legal_entity_id(coalesce(new.created_at, now()));
  end if;
  select * into v_ent from legal_entities where id = new.legal_entity_id;
  if v_ent.id is not null and jsonb_typeof(coalesce(new.data, '{}'::jsonb)) = 'object' then
    if (new.data ->> 'issuer') is null then
      new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('issuer', v_ent.legal_name, 'legal_entity_code', v_ent.code);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_aa_document_entity on documents;
create trigger trg_aa_document_entity before insert on documents
  for each row execute function trg_stamp_document_entity();

-- ───────── 3. Payment option matrix (Finance › Payment settings) ─────────
create table if not exists payment_option_settings (
  service text not null check (service in ('sourcing', 'brand', 'pools', 'turnkey', 'warehouse', 'dropship', 'advertising', 'saas')),
  option text not null check (option in ('pay_now', 'payment_protection', 'pay_later')),
  enabled boolean not null default true,
  min_amount_cents bigint not null default 0 check (min_amount_cents >= 0),
  max_amount_cents bigint check (max_amount_cents is null or max_amount_cents >= min_amount_cents),
  release_rule text check (release_rule is null or release_rule in ('milestones', 'customer_confirmation', 'delivery_plus_days', 'pool_close', 'service_month_end')),
  auto_release_days integer check (auto_release_days is null or (auto_release_days >= 0 and auto_release_days <= 180)),
  pay_later_invoice_trigger text check (pay_later_invoice_trigger is null or pay_later_invoice_trigger in ('shipment', 'order_confirmation', 'period_end', 'cycle_start')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (service, option)
);

alter table payment_option_settings enable row level security;
revoke all on payment_option_settings from public, anon, authenticated;
grant select (service, option, enabled, min_amount_cents, max_amount_cents, release_rule, auto_release_days, pay_later_invoice_trigger, updated_at) on payment_option_settings to authenticated;
grant insert, update on payment_option_settings to authenticated;
grant all on payment_option_settings to service_role;

-- Helper: true only for company-wide Admin or company-wide Finance with 2FA
create or replace function is_company_wide_finance_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and staff_aal_ok() and exists (
    select 1 from user_roles where user_id = auth.uid() and role_code in ('admin', 'finance')
  )
$$;
revoke all on function is_company_wide_finance_or_admin() from public, anon;
grant execute on function is_company_wide_finance_or_admin() to authenticated, service_role;

drop policy if exists payment_option_settings_read on payment_option_settings;
create policy payment_option_settings_read on payment_option_settings for select to authenticated using (true);

drop policy if exists payment_option_settings_write on payment_option_settings;
create policy payment_option_settings_write on payment_option_settings for all to authenticated
  using (is_company_wide_finance_or_admin())
  with check (is_company_wide_finance_or_admin());

-- Seed defaults: everything ON except payment_protection for saas and advertising
insert into payment_option_settings (service, option, enabled, min_amount_cents, max_amount_cents, release_rule, auto_release_days, pay_later_invoice_trigger)
values
  ('sourcing',    'pay_now',            true,  0, null, null,                  null, null),
  ('sourcing',    'payment_protection', true,  0, null, 'milestones',          14,   null),
  ('sourcing',    'pay_later',          true,  0, null, null,                  null, 'shipment'),
  ('brand',       'pay_now',            true,  0, null, null,                  null, null),
  ('brand',       'payment_protection', true,  0, null, 'milestones',          14,   null),
  ('brand',       'pay_later',          true,  0, null, null,                  null, 'shipment'),
  ('pools',       'pay_now',            true,  0, null, null,                  null, null),
  ('pools',       'payment_protection', true,  0, null, 'pool_close',          0,    null),
  ('pools',       'pay_later',          true,  0, null, null,                  null, 'shipment'),
  ('turnkey',     'pay_now',            true,  0, null, null,                  null, null),
  ('turnkey',     'payment_protection', true,  0, null, 'milestones',          14,   null),
  ('turnkey',     'pay_later',          true,  0, null, null,                  null, 'shipment'),
  ('warehouse',   'pay_now',            true,  0, null, null,                  null, null),
  ('warehouse',   'payment_protection', true,  0, null, 'service_month_end',   0,    null),
  ('warehouse',   'pay_later',          true,  0, null, null,                  null, 'period_end'),
  ('dropship',    'pay_now',            true,  0, null, null,                  null, null),
  ('dropship',    'payment_protection', true,  0, null, 'delivery_plus_days',  7,    null),
  ('dropship',    'pay_later',          true,  0, null, null,                  null, 'shipment'),
  ('advertising', 'pay_now',            true,  0, null, null,                  null, null),
  ('advertising', 'payment_protection', false, 0, null, null,                  null, null),
  ('advertising', 'pay_later',          true,  0, null, null,                  null, 'period_end'),
  ('saas',        'pay_now',            true,  0, null, null,                  null, null),
  ('saas',        'payment_protection', false, 0, null, null,                  null, null),
  ('saas',        'pay_later',          true,  0, null, null,                  null, 'cycle_start')
on conflict (service, option) do nothing;

-- Audit trigger for payment_option_settings
create or replace function trg_audit_payment_option_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, details)
  values (
    auth.uid(),
    'staff',
    'payment_settings.matrix_updated',
    'payment_option_settings',
    new.service || ':' || new.option,
    to_jsonb(old) - 'updated_by',
    to_jsonb(new) - 'updated_by',
    jsonb_build_object('service', new.service, 'option', new.option, 'enabled', new.enabled)
  );
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_payment_option_settings_audit on payment_option_settings;
create trigger trg_payment_option_settings_audit before update on payment_option_settings
  for each row execute function trg_audit_payment_option_settings();

-- ───────── 4. Payment provider routing & fee settings ─────────
create table if not exists payment_provider_settings (
  provider text primary key check (provider in ('mock', 'stripe', 'airwallex')),
  display_name text not null,
  enabled boolean not null default false,
  methods text[] not null default array['card'],
  priority integer not null default 10,
  legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid references legal_entities(id) on delete restrict,
  fee_mode text not null default 'absorb' check (fee_mode in ('absorb', 'surcharge')),
  fee_bp integer not null default 290 check (fee_bp >= 0 and fee_bp <= 2000),
  fee_fixed_cents bigint not null default 30 check (fee_fixed_cents >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table payment_provider_settings enable row level security;
revoke all on payment_provider_settings from public, anon, authenticated;
grant select (provider, display_name, enabled, methods, priority, legal_entity_id, fee_mode, fee_bp, fee_fixed_cents, updated_at) on payment_provider_settings to authenticated;
grant insert, update on payment_provider_settings to authenticated;
grant all on payment_provider_settings to service_role;

drop policy if exists payment_provider_settings_read on payment_provider_settings;
create policy payment_provider_settings_read on payment_provider_settings for select to authenticated using (true);

drop policy if exists payment_provider_settings_write on payment_provider_settings;
create policy payment_provider_settings_write on payment_provider_settings for all to authenticated
  using (is_company_wide_finance_or_admin())
  with check (is_company_wide_finance_or_admin());

insert into payment_provider_settings (provider, display_name, enabled, methods, priority, fee_mode, fee_bp, fee_fixed_cents)
values
  ('mock',      'Mock Aggregator (Staging Sandbox)', (select (value #>> '{}') = 'staging' from site_settings where key = 'app_environment'), array['card', 'local_transfer'], 1,  'absorb', 290, 30),
  ('stripe',    'Stripe (Cards)',                    false, array['card'],                   10, 'absorb', 290, 30),
  ('airwallex', 'Airwallex (Cards & Local Rails)',   false, array['card', 'local_transfer'], 20, 'absorb', 250, 20)
on conflict (provider) do nothing;

-- Global payment settings in site_settings
insert into site_settings (key, value, description) values
  ('payments.approval_threshold_cents', '100000'::jsonb, 'Two-person Finance approval threshold for held-payment releases and refunds in US$ cents (default 100000 = US$ 1,000.00).'),
  ('payments.pay_later_grace_days', '7'::jsonb, 'Grace days after an invoice due date before new Pay-later orders are blocked for that customer.'),
  ('payments.saas_suspend_notice_days', '7'::jsonb, 'Further notice days after the Pay-later grace period before an overdue SaaS subscription is suspended (warning sent first).'),
  ('payments.late_fee_enabled', 'false'::jsonb, 'Whether overdue Pay-later invoices accrue a late fee (off by default).'),
  ('payments.late_fee_bp', '0'::jsonb, 'Monthly late fee in basis points when payments.late_fee_enabled is true.'),
  ('payments.pool_pledge_expiry_minutes', '60'::jsonb, 'Minutes before an unpaid aggregator pool pledge expires automatically.'),
  ('legal_entity.switch_schedule', 'null'::jsonb, 'Optional scheduled switch of the default issuing legal entity: {"entity_id":"<uuid>","effective_at":"<iso>"}. Null = stay on Shenzhen Octopus Trading Co., Ltd.')
on conflict (key) do nothing;

-- ───────── 5. Customer saved payment methods (PROVIDER IDs ONLY — never card numbers or bank logins) ─────────
create table if not exists customer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('mock', 'stripe', 'airwallex')),
  provider_customer_id text not null check (btrim(provider_customer_id) <> ''),
  provider_payment_method_id text not null check (btrim(provider_payment_method_id) <> ''),
  method_kind text not null default 'card' check (method_kind in ('card', 'direct_debit')),
  label text not null default 'Saved payment method',
  consented_for_recurring boolean not null default false,
  consented_at timestamptz,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, provider, provider_payment_method_id)
);
create index if not exists customer_payment_methods_org_idx on customer_payment_methods (org_id);

alter table customer_payment_methods enable row level security;
revoke all on customer_payment_methods from public, anon, authenticated;
grant select, delete on customer_payment_methods to authenticated;
grant all on customer_payment_methods to service_role;

drop policy if exists cpm_read on customer_payment_methods;
create policy cpm_read on customer_payment_methods for select to authenticated
  using (org_id in (select my_org_ids()) or (is_staff() and can('finance', 'view')));

drop policy if exists cpm_delete_own on customer_payment_methods;
create policy cpm_delete_own on customer_payment_methods for delete to authenticated
  using (org_id in (select my_org_ids()));

-- ───────── 6. Aggregator checkouts, webhook events, settlements & reconciliation alerts ─────────
create table if not exists payment_checkouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  division_id uuid references divisions(id) on delete restrict,
  legal_entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid references legal_entities(id) on delete restrict,
  service text not null check (service in ('sourcing', 'brand', 'pools', 'turnkey', 'warehouse', 'dropship', 'advertising', 'saas')),
  payment_option text not null check (payment_option in ('pay_now', 'payment_protection')),
  target_type text not null check (target_type in ('order', 'proforma', 'pool_pledge', 'service_request', 'wallet_topup', 'ad_campaign', 'saas_subscription', 'dropship_order')),
  target_id uuid not null,
  base_amount_cents bigint not null check (base_amount_cents > 0),
  surcharge_cents bigint not null default 0 check (surcharge_cents >= 0),
  provider_fee_cents bigint not null default 0 check (provider_fee_cents >= 0),
  total_amount_cents bigint not null check (total_amount_cents = base_amount_cents + surcharge_cents),
  currency char(3) not null default 'USD' check (currency in ('USD', 'CNY', 'HKD')),
  provider text not null check (provider in ('mock', 'stripe', 'airwallex')),
  method_kind text not null default 'card',
  provider_session_id text unique,
  provider_payment_id text,
  save_payment_method boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled', 'refunded')),
  idempotency_key text not null unique,
  journal_id uuid references journals(id) on delete restrict,
  hold_id uuid,
  expires_at timestamptz not null default (now() + interval '60 minutes'),
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_checkouts_org_idx on payment_checkouts (org_id, created_at desc);
create index if not exists payment_checkouts_target_idx on payment_checkouts (target_type, target_id);
create index if not exists payment_checkouts_division_idx on payment_checkouts (division_id);

alter table payment_checkouts enable row level security;
revoke all on payment_checkouts from public, anon, authenticated;
grant select (
  id, org_id, division_id, legal_entity_id, service, payment_option, target_type, target_id,
  base_amount_cents, surcharge_cents, total_amount_cents, currency, provider, method_kind,
  provider_session_id, provider_payment_id, save_payment_method, status, idempotency_key,
  journal_id, hold_id, expires_at, paid_at, created_at, updated_at
) on payment_checkouts to authenticated;
grant all on payment_checkouts to service_role;

drop policy if exists payment_checkouts_read on payment_checkouts;
create policy payment_checkouts_read on payment_checkouts for select to authenticated
  using (org_id in (select my_org_ids()) or (is_staff() and (can('finance', 'view') or in_division(division_id))));

create table if not exists payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mock', 'stripe', 'airwallex')),
  event_id text not null,
  event_type text not null,
  checkout_id uuid references payment_checkouts(id) on delete set null,
  amount_cents bigint,
  currency char(3),
  journal_id uuid references journals(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index if not exists payment_webhook_events_checkout_idx on payment_webhook_events (checkout_id);

alter table payment_webhook_events enable row level security;
revoke all on payment_webhook_events from public, anon, authenticated;
grant select on payment_webhook_events to authenticated;
grant all on payment_webhook_events to service_role;

drop policy if exists payment_webhook_events_staff_read on payment_webhook_events;
create policy payment_webhook_events_staff_read on payment_webhook_events for select to authenticated
  using (is_staff() and can('finance', 'view'));

create table if not exists payment_settlements (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mock', 'stripe', 'airwallex')),
  provider_payment_id text not null,
  checkout_id uuid references payment_checkouts(id) on delete set null,
  gross_amount_cents bigint not null,
  fee_amount_cents bigint not null default 0,
  net_amount_cents bigint not null,
  currency char(3) not null default 'USD',
  settled_at timestamptz not null default now(),
  reconciled boolean not null default false,
  reconciled_at timestamptz,
  unique (provider, provider_payment_id)
);

alter table payment_settlements enable row level security;
revoke all on payment_settlements from public, anon, authenticated;
grant select on payment_settlements to authenticated;
grant all on payment_settlements to service_role;

drop policy if exists payment_settlements_staff_read on payment_settlements;
create policy payment_settlements_staff_read on payment_settlements for select to authenticated
  using (is_staff() and can('finance', 'view'));

create table if not exists payment_reconciliation_alerts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_payment_id text,
  checkout_id uuid references payment_checkouts(id) on delete set null,
  kind text not null check (kind in ('missing_in_ledger', 'missing_in_provider', 'amount_mismatch', 'currency_mismatch')),
  expected_cents bigint,
  actual_cents bigint,
  currency char(3),
  detail text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table payment_reconciliation_alerts enable row level security;
revoke all on payment_reconciliation_alerts from public, anon, authenticated;
grant select (id, provider, provider_payment_id, checkout_id, kind, expected_cents, actual_cents, currency, detail, status, resolved_at, created_at) on payment_reconciliation_alerts to authenticated;
grant update (status, resolved_note, resolved_at) on payment_reconciliation_alerts to authenticated;
grant all on payment_reconciliation_alerts to service_role;

drop policy if exists payment_reconciliation_alerts_staff on payment_reconciliation_alerts;
create policy payment_reconciliation_alerts_staff on payment_reconciliation_alerts for all to authenticated
  using (is_staff() and can('finance', 'view'))
  with check (is_company_wide_finance_or_admin());
