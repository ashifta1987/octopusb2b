-- Octopus Dropship · Release 5 · Step 12 (plans and non-Shopify billing) + Step 12b (Finance plan-fee switch) + Step 13
-- (dashboard, reports, settings, staff health).
-- Down: supabase/migrations/down/20261101000247_ds12_billing_reports_health.down.sql
--
-- ONE installed function is REPLACED: guard_saas_billing_settings_locked() (migration 215). It still refuses every insert /
-- delete and every update EXCEPT an update made inside the two-person switch functions below (they set the transaction-local
-- flag octopus.saas_switch). The down restores its exact installed definition. Everything else is new and dropped by the
-- down, so the up → down schema diff is empty. Re-runnable inside one transaction (if not exists / create or replace /
-- drop … if exists before each policy and trigger / ACLs revoked then granted in a fixed order).
--
-- Owner decisions applied:
--  · Shopify (appSubscriptionCreate + app_subscriptions/update) comes LAST. Non-Shopify merchants are billed monthly from the
--    Octopus wallet (balanced journal + OCT-DS tax invoice through the existing document path → it is on the STMT-DS weekly
--    statement automatically). A merchant with an ACTIVE Shopify store is on the 'shopify' channel: nothing is charged and no
--    transition runs for them ("billed through Shopify once your store is connected") — honest stub.
--  · D1: plan prices stay UNSET. No plan rows are seeded. A plan can only be offered (active) with a price; while plan fees are
--    off every merchant sees "Free while plan fees are off" and no limit is enforced.
--  · saas_billing_settings (migration 215) is the ONLY switch: proposer ≠ approver (Finance approvers / admins), 30-day trial
--    once per organisation, 7-day grace, then new pushes pause (paid orders keep shipping). free_forever overrides only for
--    credit_eligible organisations (enforced by a trigger). Everything audit-logged.
--
--  1. Tables: dropship_plans, dropship_plan_changes (two-person plan edits), saas_billing_overrides, dropship_plan_subscriptions,
--     dropship_plan_charges, dropship_merchant_settings (profile, branding, buyer policies), dropship_notification_prefs,
--     dropship_team_roles, dropship_team_invites.
--  2. Plan state + limits (only when billing is ON, from the plan row; no plan / NULL limit = no limit): live products (push
--     jobs for products not yet live are BLOCKED with PLAN_LIMIT, or PLAN_PAUSED after the grace period), connected stores
--     (refused). Orders per month: never stops an order (paid orders always ship) — the merchant is notified at 100 %.
--  3. Step 12b switch: saas_switch_propose / saas_switch_decide / saas_switch_withdraw, overrides, plan proposals.
--  4. Billing: ds_billing_page, ds_billing_choose_plan, ds_billing_charge, ds_billing_jobs (pg_cron hourly).
--  5. Team roles checked in the database for every merchant write (triggers on the DS6 / DS8 tables): owner = everything;
--     manager = products, pushes, pricing, packing, pay / cancel orders; support = see orders, fix addresses, requests.
--  6. Step 13 readers: ds_dashboard, ds_reports_page, ds_reports_csv, ds_settings_page + saves, ds_export_rows,
--     ds_close_dropshipping, ds_public_brand (tracking page, service role only), ds_brand_for_org (packing slip), ds_health_page + actions.

-- ───────────────────────── 1. Tables ─────────────────────────
create table if not exists public.dropship_plans (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 300),
  price_cents bigint check (price_cents is null or (price_cents > 0 and price_cents <= 10000000)),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  live_products_limit integer check (live_products_limit is null or live_products_limit between 1 and 1000000),
  stores_limit integer check (stores_limit is null or stores_limit between 1 and 1000),
  orders_month_limit integer check (orders_month_limit is null or orders_month_limit between 1 and 10000000),
  features text[] not null default '{}'::text[]
    check (features <@ array['import_push', 'order_sync', 'auto_sync', 'priority_handling', 'branded_packaging']::text[]),
  sort_order integer not null default 10,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dropship_plans_active_priced check (not active or price_cents is not null)
);
comment on table public.dropship_plans is 'Octopus Dropship plans (Step 12). Prices and limits come from the owner through a two-person proposal; NULL price = not set (cannot be offered), NULL limit = no limit.';

create table if not exists public.dropship_plan_changes (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null check (plan_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'withdrawn')),
  proposed_by uuid references auth.users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  constraint dropship_plan_changes_two_person check (decided_by is null or proposed_by is distinct from decided_by)
);
create unique index if not exists dropship_plan_changes_open_idx on public.dropship_plan_changes (plan_code) where status = 'proposed';

create table if not exists public.saas_billing_overrides (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('free_forever', 'extra_trial')),
  extra_trial_days integer,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  constraint saas_billing_overrides_days check ((kind = 'extra_trial' and extra_trial_days between 1 and 365) or (kind = 'free_forever' and extra_trial_days is null))
);

create table if not exists public.dropship_plan_subscriptions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  plan_code text references public.dropship_plans(code) on delete restrict,
  channel text not null default 'wallet' check (channel in ('wallet', 'shopify')),
  status text not null default 'free' check (status in ('free', 'trial', 'active', 'grace', 'paused', 'free_forever', 'cancelled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_used boolean not null default false,
  trial_days_left_at_stop integer check (trial_days_left_at_stop is null or trial_days_left_at_stop >= 0),
  plan_approved_at timestamptz,
  plan_approved_user uuid references auth.users(id) on delete set null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  paused_at timestamptz,
  cancelled_at timestamptz,
  last_charge_error text,
  orders_limit_month date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dropship_plan_subscriptions_plan_idx on public.dropship_plan_subscriptions (plan_code);
create index if not exists dropship_plan_subscriptions_status_idx on public.dropship_plan_subscriptions (status);

create table if not exists public.dropship_plan_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_cents bigint not null check (amount_cents > 0),
  journal_id uuid,
  invoice_id uuid references public.documents(id) on delete set null,
  legal_entity_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, period_start)
);
create index if not exists dropship_plan_charges_invoice_idx on public.dropship_plan_charges (invoice_id);

create table if not exists public.dropship_merchant_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  time_zone text not null default 'UTC' check (length(time_zone) between 1 and 64),
  display_currency char(3) not null default 'USD' check (display_currency = 'USD'),
  logo_path text check (logo_path is null or logo_path ~ '^logos/[0-9a-f]{32}\.(png|jpg|webp)$'),
  show_logo_slip boolean not null default false,
  show_logo_tracking boolean not null default false,
  returns_policy text check (returns_policy is null or length(returns_policy) <= 1000),
  support_email text check (support_email is null or (length(support_email) <= 200 and support_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  updated_at timestamptz not null default now()
);

create table if not exists public.dropship_notification_prefs (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (event in ('new_order', 'awaiting_payment', 'on_hold', 'wallet_low', 'out_of_stock', 'cost_changed', 'push_failed', 'store_reconnect')),
  email boolean not null default true,
  in_app boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id, event)
);
create index if not exists dropship_notification_prefs_user_idx on public.dropship_notification_prefs (user_id);

create table if not exists public.dropship_team_roles (
  org_id uuid not null,
  user_id uuid not null,
  ds_role text not null check (ds_role in ('owner', 'manager', 'support')),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id),
  foreign key (org_id, user_id) references public.org_members(org_id, user_id) on delete cascade
);

create table if not exists public.dropship_team_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ds_role text not null check (ds_role in ('manager', 'support')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_user uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);
create unique index if not exists dropship_team_invites_open_idx on public.dropship_team_invites (org_id, email) where status = 'pending';
create index if not exists dropship_team_invites_email_idx on public.dropship_team_invites (email) where status = 'pending';

-- ───────────────────────── 1a. RLS + grants ─────────────────────────
-- Merchants read their own organisation's subscription, charges, settings, team roles and their own notification choices.
-- Staff-only tables (plans, plan proposals, overrides, invites) have NO grant to signed-in users: they are read through the
-- SECURITY DEFINER functions only. Nobody but the service role (and the definer functions) writes.
alter table public.dropship_plans enable row level security;
alter table public.dropship_plan_changes enable row level security;
alter table public.saas_billing_overrides enable row level security;
alter table public.dropship_plan_subscriptions enable row level security;
alter table public.dropship_plan_charges enable row level security;
alter table public.dropship_merchant_settings enable row level security;
alter table public.dropship_notification_prefs enable row level security;
alter table public.dropship_team_roles enable row level security;
alter table public.dropship_team_invites enable row level security;

drop policy if exists ds12_own_read on public.dropship_plan_subscriptions;
create policy ds12_own_read on public.dropship_plan_subscriptions for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds12_own_read on public.dropship_plan_charges;
create policy ds12_own_read on public.dropship_plan_charges for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds12_own_read on public.dropship_merchant_settings;
create policy ds12_own_read on public.dropship_merchant_settings for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds12_own_read on public.dropship_notification_prefs;
create policy ds12_own_read on public.dropship_notification_prefs for select to authenticated using (user_id = auth.uid() and org_id in (select my_org_ids()));
drop policy if exists ds12_own_read on public.dropship_team_roles;
create policy ds12_own_read on public.dropship_team_roles for select to authenticated using (org_id in (select my_org_ids()));

revoke all on public.dropship_plans, public.dropship_plan_changes, public.saas_billing_overrides, public.dropship_plan_subscriptions,
  public.dropship_plan_charges, public.dropship_merchant_settings, public.dropship_notification_prefs, public.dropship_team_roles,
  public.dropship_team_invites from public, anon, authenticated, service_role;
grant select on public.dropship_plan_subscriptions, public.dropship_plan_charges, public.dropship_merchant_settings,
  public.dropship_notification_prefs, public.dropship_team_roles to authenticated;
grant all on public.dropship_plans, public.dropship_plan_changes, public.saas_billing_overrides, public.dropship_plan_subscriptions,
  public.dropship_plan_charges, public.dropship_merchant_settings, public.dropship_notification_prefs, public.dropship_team_roles,
  public.dropship_team_invites to service_role;

-- ───────────────────────── 1b. REPLACED: the saas_billing_settings write lock (exact original restored by the down) ─────────────────────────
create or replace function public.guard_saas_billing_settings_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Step 12b: only the two-person switch functions (saas_switch_*) update the singleton; they set this flag for their own
  -- transaction and clear it before returning. Inserts and deletes stay refused.
  if tg_op = 'UPDATE' and coalesce(current_setting('octopus.saas_switch', true), '') = 'on' then
    return new;
  end if;
  -- deleting a staff user sets proposed_by / approved_by to NULL (FK on delete set null): allowed, nothing else may change
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'proposed_by' - 'approved_by') = (to_jsonb(old) - 'proposed_by' - 'approved_by')
     and (new.proposed_by is null or new.proposed_by is not distinct from old.proposed_by)
     and (new.approved_by is null or new.approved_by is not distinct from old.approved_by) then
    return new;
  end if;
  raise exception 'SAAS_BILLING_LOCKED: Plan fee settings can only be changed through the Step 12b two-person Finance switch';
end $$;

-- ───────────────────────── 2. Helpers ─────────────────────────
create or replace function public.ds12_claims_role()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
$$;

-- Finance approvers and admins (company-wide), 2FA staff session
create or replace function public.saas_finance_can()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and not distributor_restricted() and (is_admin() or can('finance', 'approve'))
$$;

create or replace function public.ds12_usd(p_cents bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_cents is null then 'not set' else 'US$' || to_char(p_cents / 100.0, 'FM999,999,990.00') end
$$;

-- Team role of a member: explicit Dropship role, else from org_members (owner → owner, viewer → support, buyer → manager)
create or replace function public.ds_team_role(p_org uuid, p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.ds_role from public.dropship_team_roles r where r.org_id = p_org and r.user_id = p_uid),
    (select case m.member_role when 'owner' then 'owner' when 'viewer' then 'support' else 'manager' end
       from public.org_members m where m.org_id = p_org and m.user_id = p_uid))
$$;

create or replace function public.ds_role_allows(p_role text, p_action text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_role = 'owner' then true
    when p_role = 'manager' then p_action in ('products', 'pricing', 'setup', 'pay_orders', 'cancel_orders', 'fix_address', 'requests', 'branding', 'view')
    when p_role = 'support' then p_action in ('fix_address', 'requests', 'view')
    else false end
$$;

-- Refuses a signed-in merchant whose team role does not allow p_action. Service role, jobs and staff are not merchants.
create or replace function public.ds_assert_role(p_org uuid, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null or ds12_claims_role() <> 'authenticated' or user_is_staff(v_uid) then return; end if;
  v_role := ds_team_role(p_org, v_uid);
  if v_role is null then return; end if; -- not a member: the RPC's own organisation check refuses
  if not ds_role_allows(v_role, p_action) then
    raise exception 'ROLE_FORBIDDEN: Your team role (%) can''t do this. Ask the account owner.', initcap(v_role);
  end if;
end $$;

-- In-app notification that honours the members' choices (email is stored only; nothing is sent until app email is live).
-- p_event null = account / billing notice, always shown.
create or replace function public.ds_notify(p_org uuid, p_event text, p_title text, p_body text, p_link text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event is null or not exists (select 1 from public.dropship_notification_prefs np where np.org_id = p_org and np.event = p_event and not np.in_app) then
    insert into public.notifications (org_id, division_id, service, title, body, link, dedupe_key)
    values (p_org, division_id_of('DS'), 'dropship', left(p_title, 200), p_body, p_link, p_dedupe)
    on conflict (dedupe_key) do nothing;
  else
    insert into public.notifications (user_id, org_id, division_id, service, title, body, link, dedupe_key)
    select m.user_id, p_org, division_id_of('DS'), 'dropship', left(p_title, 200), p_body, p_link,
           case when p_dedupe is null then null else p_dedupe || ':' || m.user_id::text end
      from public.org_members m
     where m.org_id = p_org
       and not exists (select 1 from public.dropship_notification_prefs np where np.org_id = p_org and np.user_id = m.user_id and np.event = p_event and not np.in_app)
    on conflict (dedupe_key) do nothing;
  end if;
end $$;

-- Buyer-facing text (returns policy, …): never Octopus, Shenzhen, a supplier name / code.
create or replace function public.ds12_text_problem(p_text text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when p_text ~* '(octopus|shenzhen)' then 'Buyer-facing text can''t name Octopus or Shenzhen.'
    when exists (
      select 1 from public.suppliers s
       where (length(btrim(coalesce(s.legal_name, ''))) >= 4 and position(lower(btrim(s.legal_name)) in lower(p_text)) > 0)
          or (length(btrim(coalesce(s.code, ''))) >= 4 and position(lower(btrim(s.code)) in lower(p_text)) > 0))
      or exists (select 1 from public.supplier_name_variants v where length(btrim(coalesce(v.variant_name, ''))) >= 4 and position(lower(btrim(v.variant_name)) in lower(p_text)) > 0)
      then 'Buyer-facing text can''t name a supplier or factory.'
    else null end
$$;

-- ───────────────────────── 3. Plan state and limits ─────────────────────────
create or replace function public.ds_plan_live_products(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct l.product_id)::int from public.dropship_product_links l where l.org_id = p_org and l.status = 'linked'
$$;

create or replace function public.ds_plan_state(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.saas_billing_settings;
  sub public.dropship_plan_subscriptions;
  o public.saas_billing_overrides;
  p public.dropship_plans;
  v_credit boolean;
  v_ff boolean;
  v_status text;
  v_apply boolean;
  v_channel text;
  v_live int;
  v_stores int;
  v_orders int;
begin
  select * into s from public.saas_billing_settings where id = 1;
  select * into sub from public.dropship_plan_subscriptions where org_id = p_org;
  select * into o from public.saas_billing_overrides where org_id = p_org;
  select coalesce(credit_eligible, false) into v_credit from public.organizations where id = p_org;
  if sub.plan_code is not null then select * into p from public.dropship_plans where code = sub.plan_code; end if;
  v_ff := o.kind = 'free_forever' and coalesce(v_credit, false);
  v_status := case when not coalesce(s.enabled, false) then 'free'
                   when v_ff then 'free_forever'
                   else coalesce(sub.status, 'none') end;
  v_apply := coalesce(s.enabled, false) and not coalesce(v_ff, false) and v_status not in ('free', 'free_forever', 'cancelled');
  v_channel := case when exists (select 1 from public.store_connections c where c.org_id = p_org and c.status = 'active') then 'shopify' else 'wallet' end;
  v_live := ds_plan_live_products(p_org);
  select count(*)::int into v_stores from public.store_connections c where c.org_id = p_org and c.status = 'active';
  select count(*)::int into v_orders from public.store_orders so
   where so.org_id = p_org and coalesce(so.kind, 'store') = 'store' and so.created_at >= date_trunc('month', now());
  return jsonb_build_object(
    'billing_enabled', coalesce(s.enabled, false),
    'scheduled_start', s.scheduled_start,
    'trial_days', coalesce(s.trial_days, 30),
    'grace_days', coalesce(s.grace_days, 7),
    'status', v_status,
    'free_forever', coalesce(v_ff, false),
    'extra_trial_days', case when o.kind = 'extra_trial' then o.extra_trial_days end,
    'limits_apply', v_apply,
    'channel', v_channel,
    'plan_code', sub.plan_code,
    'plan_name', p.name,
    'plan_price_cents', p.price_cents,
    'plan_approved', sub.plan_approved_at is not null,
    'live_products_limit', case when v_apply then p.live_products_limit end,
    'stores_limit', case when v_apply then p.stores_limit end,
    'orders_month_limit', case when v_apply then p.orders_month_limit end,
    'trial_ends_at', sub.trial_ends_at,
    'trial_days_left', case when v_status = 'trial' and sub.trial_ends_at is not null
                            then greatest(0, ceil(extract(epoch from (sub.trial_ends_at - now())) / 86400.0))::int end,
    'trial_used', coalesce(sub.trial_used, false),
    'grace_ends_at', case when v_status = 'grace' then sub.grace_ends_at end,
    'current_period_end', case when v_status = 'active' then sub.current_period_end end,
    'last_charge_error', sub.last_charge_error,
    'usage', jsonb_build_object('live_products', v_live, 'stores', v_stores, 'orders_month', v_orders));
end $$;

-- Push jobs for a product that is not live in that store yet: blocked (with the exact reason) when the plan limit is reached,
-- or when new pushes are paused after the grace period. Re-pushing a live product is never limited. Only when billing is ON.
create or replace function public.ds_plan_push_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_limit int;
  v_used int;
begin
  if new.kind <> 'push' or new.status <> 'queued' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'queued' then return new; end if;
  if exists (select 1 from public.dropship_product_links l where l.store_connection_id = new.store_connection_id and l.product_id = new.product_id and l.status = 'linked') then
    return new;
  end if;
  v := ds_plan_state(new.org_id);
  if not (v ->> 'limits_apply')::boolean then return new; end if;
  if v ->> 'status' = 'paused' then
    new.status := 'blocked'; new.error_code := 'PLAN_PAUSED';
    new.error_message := 'New pushes are paused: approve your plan in Plan and billing. Paid orders keep shipping.';
    new.finished_at := now();
    return new;
  end if;
  v_limit := nullif(v ->> 'live_products_limit', '')::int;
  if v_limit is null then return new; end if;
  select count(distinct x.product_id)::int into v_used from (
    select l.product_id from public.dropship_product_links l where l.org_id = new.org_id and l.status = 'linked'
    union
    select j.product_id from public.dropship_push_jobs j
     where j.org_id = new.org_id and j.kind = 'push' and j.status in ('queued', 'running', 'retry_wait') and j.id is distinct from new.id) x
   where x.product_id is distinct from new.product_id;
  if v_used + 1 > v_limit then
    new.status := 'blocked'; new.error_code := 'PLAN_LIMIT';
    new.error_message := format('Your %s plan allows %s live products and you have %s. Unlink a product or change your plan.', coalesce(v ->> 'plan_name', ''), v_limit, v_used);
    new.finished_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_ds12_plan_push on public.dropship_push_jobs;
create trigger trg_ds12_plan_push
  before insert or update of status on public.dropship_push_jobs
  for each row execute function public.ds_plan_push_guard();

-- Connected stores limit (Step 5 writes store_connections with the service role)
create or replace function public.ds_plan_store_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_limit int;
  v_used int;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then return new; end if;
  v := ds_plan_state(new.org_id);
  if not (v ->> 'limits_apply')::boolean then return new; end if;
  v_limit := nullif(v ->> 'stores_limit', '')::int;
  if v_limit is null then return new; end if;
  select count(*)::int into v_used from public.store_connections c where c.org_id = new.org_id and c.status = 'active' and c.id <> new.id;
  if v_used + 1 > v_limit then
    raise exception 'PLAN_LIMIT: Your plan allows % connected store(s). Disconnect a store or change your plan.', v_limit;
  end if;
  return new;
end $$;

drop trigger if exists trg_ds12_plan_store on public.store_connections;
create trigger trg_ds12_plan_store
  before insert or update of status on public.store_connections
  for each row execute function public.ds_plan_store_guard();

-- free_forever only for credit_eligible organisations (Octopus group companies and test accounts)
create or replace function public.saas_override_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'free_forever' and not coalesce((select credit_eligible from public.organizations where id = new.org_id), false) then
    raise exception 'NOT_ELIGIBLE: Free forever is only for Octopus group companies and test accounts (credit eligible).';
  end if;
  return new;
end $$;

drop trigger if exists trg_ds12_override_guard on public.saas_billing_overrides;
create trigger trg_ds12_override_guard
  before insert or update on public.saas_billing_overrides
  for each row execute function public.saas_override_guard();

-- ───────────────────────── 4. Team roles enforced on the existing merchant tables ─────────────────────────
create or replace function public.ds_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_action text := tg_argv[0];
begin
  if auth.uid() is null or ds12_claims_role() <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then v_org := old.org_id; else v_org := new.org_id; end if;
  if tg_table_name = 'dropship_order_intake' then
    if new.charged_at is not null and old.charged_at is null then
      -- auto-pay is the organisation's standing instruction (saved by an owner / manager), so a charge made by the auto-pay path
      -- after a support member fixes an address is allowed; a high-risk hold is only ever cleared by someone who may pay orders
      if old.hold_code = 'high_risk' or not coalesce((select s.auto_pay from public.dropship_order_settings s where s.org_id = v_org), true) then
        v_action := 'pay_orders';
      else
        return new;
      end if;
    elsif new.cancel_state is distinct from old.cancel_state and new.cancel_state is not null then
      v_action := 'cancel_orders';
    else
      return new;
    end if;
  end if;
  perform ds_assert_role(v_org, v_action);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_ds12_role_import_list on public.dropship_import_list;
create trigger trg_ds12_role_import_list before insert or delete on public.dropship_import_list
  for each row execute function public.ds_role_guard('products');
drop trigger if exists trg_ds12_role_listings on public.dropship_listings;
create trigger trg_ds12_role_listings before insert or update on public.dropship_listings
  for each row execute function public.ds_role_guard('products');
drop trigger if exists trg_ds12_role_listing_variants on public.dropship_listing_variants;
create trigger trg_ds12_role_listing_variants before insert or update on public.dropship_listing_variants
  for each row execute function public.ds_role_guard('products');
drop trigger if exists trg_ds12_role_push_batches on public.dropship_push_batches;
create trigger trg_ds12_role_push_batches before insert on public.dropship_push_batches
  for each row execute function public.ds_role_guard('products');
drop trigger if exists trg_ds12_role_push_jobs on public.dropship_push_jobs;
create trigger trg_ds12_role_push_jobs before insert or update on public.dropship_push_jobs
  for each row execute function public.ds_role_guard('products');
drop trigger if exists trg_ds12_role_pricing on public.dropship_pricing_rules;
create trigger trg_ds12_role_pricing before insert or update on public.dropship_pricing_rules
  for each row execute function public.ds_role_guard('pricing');
drop trigger if exists trg_ds12_role_price_approvals on public.dropship_price_approvals;
create trigger trg_ds12_role_price_approvals before update on public.dropship_price_approvals
  for each row execute function public.ds_role_guard('pricing');
drop trigger if exists trg_ds12_role_packing on public.dropship_packing_settings;
create trigger trg_ds12_role_packing before insert or update or delete on public.dropship_packing_settings
  for each row execute function public.ds_role_guard('setup');
drop trigger if exists trg_ds12_role_duty_modes on public.dropship_duty_modes;
create trigger trg_ds12_role_duty_modes before insert or update or delete on public.dropship_duty_modes
  for each row execute function public.ds_role_guard('setup');
drop trigger if exists trg_ds12_role_order_settings on public.dropship_order_settings;
create trigger trg_ds12_role_order_settings before insert or update on public.dropship_order_settings
  for each row execute function public.ds_role_guard('pay_orders');
drop trigger if exists trg_ds12_role_order_intake on public.dropship_order_intake;
create trigger trg_ds12_role_order_intake before update on public.dropship_order_intake
  for each row execute function public.ds_role_guard('pay_orders');

-- ───────────────────────── 5. Billing core (wallet channel) ─────────────────────────
-- Starts / resumes the organisation's plan period when plan fees are ON. One free trial per organisation, ever; a trial
-- interrupted by switching fees off resumes with the days that were left.
create or replace function public.ds_billing_ensure(p_org uuid)
returns public.dropship_plan_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saas_billing_settings;
  sub public.dropship_plan_subscriptions;
  o public.saas_billing_overrides;
  v_ff boolean;
  v_days int;
begin
  select * into s from public.saas_billing_settings where id = 1;
  select * into sub from public.dropship_plan_subscriptions where org_id = p_org for update;
  if not coalesce(s.enabled, false) then return sub; end if;
  select * into o from public.saas_billing_overrides where org_id = p_org;
  v_ff := o.kind = 'free_forever' and coalesce((select credit_eligible from public.organizations where id = p_org), false);
  v_days := s.trial_days + coalesce(case when o.kind = 'extra_trial' then o.extra_trial_days end, 0);
  if sub.org_id is null then
    insert into public.dropship_plan_subscriptions (org_id, status) values (p_org, 'free') returning * into sub;
  end if;
  if coalesce(v_ff, false) then
    if sub.status <> 'free_forever' then
      update public.dropship_plan_subscriptions set status = 'free_forever', grace_ends_at = null, paused_at = null, updated_at = now()
       where org_id = p_org returning * into sub;
    end if;
    return sub;
  end if;
  if sub.status in ('free', 'cancelled', 'free_forever') then
    if sub.trial_days_left_at_stop is not null and sub.trial_days_left_at_stop > 0 then
      update public.dropship_plan_subscriptions
         set status = 'trial', trial_ends_at = now() + make_interval(days => sub.trial_days_left_at_stop), trial_days_left_at_stop = null,
             cancelled_at = null, updated_at = now()
       where org_id = p_org returning * into sub;
    elsif not sub.trial_used then
      update public.dropship_plan_subscriptions
         set status = 'trial', trial_started_at = now(), trial_ends_at = now() + make_interval(days => v_days), trial_used = true,
             trial_days_left_at_stop = null, cancelled_at = null, updated_at = now()
       where org_id = p_org returning * into sub;
      perform ds_notify(p_org, null, format('Free trial started: %s days', v_days),
        'Octopus started plan fees. Choose and approve your plan in Plan and billing before the trial ends; nothing is charged before then.',
        '/account/dropship/billing', 'ds-plan-trial-start:' || p_org::text || ':' || to_char(now(), 'YYYYMMDD'));
    else
      update public.dropship_plan_subscriptions
         set status = 'grace', grace_ends_at = now() + make_interval(days => s.grace_days), trial_days_left_at_stop = null, cancelled_at = null, updated_at = now()
       where org_id = p_org returning * into sub;
    end if;
  end if;
  return sub;
end $$;

-- Charges one monthly plan period from the wallet: OCT-DS tax invoice (paid, DS division, current legal entity) with one line,
-- balanced journal wallet → plan revenue. Idempotent per (organisation, period start). Not enough in the wallet → grace.
create or replace function public.ds_billing_charge(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saas_billing_settings;
  sub public.dropship_plan_subscriptions;
  p public.dropship_plans;
  v_div uuid := division_id_of('DS');
  v_entity uuid := current_legal_entity_id(now());
  v_start timestamptz;
  v_end timestamptz;
  v_avail bigint;
  v_charge uuid;
  v_inv uuid;
  v_no text;
  v_j uuid;
  v_desc text;
begin
  select * into s from public.saas_billing_settings where id = 1;
  select * into sub from public.dropship_plan_subscriptions where org_id = p_org for update;
  if not coalesce(s.enabled, false) or sub.org_id is null then return jsonb_build_object('ok', false, 'code', 'BILLING_OFF'); end if;
  if sub.status in ('free', 'free_forever', 'cancelled') then return jsonb_build_object('ok', false, 'code', 'NOTHING_TO_CHARGE'); end if;
  if sub.plan_code is null or sub.plan_approved_at is null then return jsonb_build_object('ok', false, 'code', 'PLAN_NOT_APPROVED'); end if;
  if exists (select 1 from public.store_connections c where c.org_id = p_org and c.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'SHOPIFY_BILLING', 'message', 'Billed through Shopify once your store is connected.');
  end if;
  select * into p from public.dropship_plans where code = sub.plan_code;
  if p.price_cents is null then return jsonb_build_object('ok', false, 'code', 'PRICE_NOT_SET'); end if;
  v_start := case
    when sub.status = 'trial' then least(coalesce(sub.trial_ends_at, now()), now())
    when sub.status = 'active' and sub.current_period_end is not null then sub.current_period_end
    else now() end;
  v_start := date_trunc('second', v_start);
  if sub.status = 'active' and sub.current_period_end is not null and sub.current_period_end > now() then
    return jsonb_build_object('ok', true, 'already_paid', true, 'period_end', sub.current_period_end);
  end if;
  v_end := v_start + interval '1 month';
  if exists (select 1 from public.dropship_plan_charges c where c.org_id = p_org and c.period_start = v_start) then
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;
  perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || p_org, 'USD')));
  v_avail := wallet_balance(p_org, 'USD');
  if v_avail < p.price_cents then
    update public.dropship_plan_subscriptions
       set last_charge_error = 'WALLET_INSUFFICIENT',
           status = case when status in ('grace', 'paused') then status else 'grace' end,
           grace_ends_at = case when status in ('grace', 'paused') then grace_ends_at else now() + make_interval(days => s.grace_days) end,
           updated_at = now()
     where org_id = p_org returning * into sub;
    perform ds_notify(p_org, null, 'Plan fee not paid: add funds',
      format('Your %s plan costs %s a month and your wallet has %s. Add funds before %s; after that new pushes pause. Paid orders keep shipping.',
             p.name, ds12_usd(p.price_cents), ds12_usd(v_avail), to_char(coalesce(sub.grace_ends_at, now()) at time zone 'UTC', 'DD Mon YYYY')),
      '/account/dropship/wallet#add-funds', 'ds-plan-unpaid:' || p_org::text || ':' || to_char(coalesce(sub.grace_ends_at, v_start), 'YYYYMMDD'));
    return jsonb_build_object('ok', false, 'code', 'WALLET_INSUFFICIENT', 'available_cents', v_avail, 'needed_cents', p.price_cents,
      'message', format('Not enough in your wallet: you have %s and the plan costs %s.', ds12_usd(v_avail), ds12_usd(p.price_cents)));
  end if;

  insert into public.dropship_plan_charges (org_id, plan_code, period_start, period_end, amount_cents, legal_entity_id)
  values (p_org, p.code, v_start, v_end, p.price_cents, v_entity) returning id into v_charge;
  v_no := next_document_number('invoice', v_div, now(), v_entity);
  v_desc := format('Octopus Dropship plan · %s · %s – %s', p.name, to_char(v_start at time zone 'UTC', 'DD Mon YYYY'), to_char(v_end at time zone 'UTC', 'DD Mon YYYY'));
  insert into public.documents (org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents, currency, status, payment_option, data)
  values (p_org, v_div, v_entity, 'commercial_invoice', v_no, p.price_cents, p.price_cents, 'USD', 'paid', 'pay_now',
          jsonb_build_object('service', 'dropship', 'kind', 'plan_fee', 'title', v_desc, 'plan_code', p.code, 'plan_name', p.name,
                             'period_start', v_start, 'period_end', v_end, 'payment_option', 'wallet', 'plan_charge_id', v_charge))
  returning id into v_inv;
  insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
  values (v_inv, 'dropship', v_desc, 1, p.price_cents, p.price_cents, 'dropship_plan_charge', v_charge::text);
  v_j := post_journal(v_desc || ' · ' || v_no || ' · paid from wallet',
    jsonb_build_array(
      jsonb_build_object('account', wallet_account(p_org, 'USD'), 'debit', p.price_cents, 'credit', 0, 'org', p_org),
      jsonb_build_object('account', revenue_account('service_fees', 'USD'), 'debit', 0, 'credit', p.price_cents)),
    'ds-plan:' || p_org::text || ':' || to_char(v_start at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'dropship', 'dropship_plan_charge', v_charge);
  update public.journals set division_id = v_div where id = v_j;
  update public.ledger_entries set division_id = v_div where journal_id = v_j;
  update public.dropship_plan_charges set journal_id = v_j, invoice_id = v_inv where id = v_charge;
  update public.dropship_plan_subscriptions
     set status = 'active', channel = 'wallet', current_period_start = v_start, current_period_end = v_end,
         grace_ends_at = null, paused_at = null, last_charge_error = null, updated_at = now()
   where org_id = p_org;
  perform ds_notify(p_org, null, format('Plan invoice %s: %s', v_no, ds12_usd(p.price_cents)),
    format('%s paid from your wallet. It is on your weekly statement.', v_desc), '/account/dropship/billing', 'ds-plan-paid:' || v_charge::text);
  perform write_audit('ds_plan.charged', 'dropship_plan_charges', v_charge::text,
    jsonb_build_object('org_id', p_org, 'plan', p.code, 'amount_cents', p.price_cents, 'invoice', v_no, 'journal_id', v_j,
                       'period_start', v_start, 'period_end', v_end, 'legal_entity_id', v_entity));
  return jsonb_build_object('ok', true, 'invoice_number', v_no, 'invoice_id', v_inv, 'amount_cents', p.price_cents, 'period_start', v_start, 'period_end', v_end);
end $$;

create or replace function public.ds_billing_start_trials()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; n int := 0;
begin
  for r in select cs.org_id from public.company_services cs where cs.service = 'dropship' and cs.status in ('on', 'paused') loop
    perform ds_billing_ensure(r.org_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Plan fees switched OFF: every plan is free again. Trials keep the days that were left; charges already made stay (no refund).
create or replace function public.ds_billing_stop_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.dropship_plan_subscriptions
     set trial_days_left_at_stop = case when status = 'trial' and trial_ends_at is not null
                                        then greatest(0, ceil(extract(epoch from (trial_ends_at - now())) / 86400.0))::int
                                        else trial_days_left_at_stop end,
         status = 'free', grace_ends_at = null, paused_at = null, updated_at = now()
   where status in ('trial', 'active', 'grace', 'paused', 'free_forever');
  get diagnostics n = row_count;
  return n;
end $$;

-- Hourly job (service role / pg_cron): scheduled start, trial reminders (day 23 and 28 of 30), trial end → charge or grace,
-- monthly renewals, grace end → new pushes paused, orders-per-month notice. Shopify-channel merchants: nothing (stub).
create or replace function public.ds_billing_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saas_billing_settings;
  r record;
  v jsonb;
  v_started int := 0;
  v_charged int := 0;
  v_failed int := 0;
  v_grace int := 0;
  v_paused int := 0;
  v_reminders int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:ds_billing_jobs')) then
    return jsonb_build_object('skipped', true, 'reason', 'lock_held');
  end if;
  select * into s from public.saas_billing_settings where id = 1;
  if not s.enabled and s.scheduled_start is not null and s.scheduled_start <= now() and s.pending_enabled is null and s.approved_by is not null then
    perform set_config('octopus.saas_switch', 'on', true);
    update public.saas_billing_settings set enabled = true, enabled_at = now(), scheduled_start = null, updated_at = now() where id = 1;
    perform set_config('octopus.saas_switch', '', true);
    perform write_audit('saas_billing.started_on_date', 'saas_billing_settings', '1', jsonb_build_object('at', now()));
    select * into s from public.saas_billing_settings where id = 1;
  end if;
  if not s.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  -- every Dropship merchant has a plan period while fees are on (new merchants: first run after activation, or when they pick)
  for r in select cs.org_id from public.company_services cs
            where cs.service = 'dropship' and cs.status in ('on', 'paused')
              and not exists (select 1 from public.dropship_plan_subscriptions x where x.org_id = cs.org_id) loop
    perform ds_billing_ensure(r.org_id);
    v_started := v_started + 1;
  end loop;

  for r in select x.* from public.dropship_plan_subscriptions x
            where x.status in ('trial', 'active', 'grace', 'paused')
              and not exists (select 1 from public.store_connections c where c.org_id = x.org_id and c.status = 'active')
            order by x.org_id loop
    if r.status = 'trial' and r.trial_ends_at > now() then
      if r.trial_ends_at - now() <= interval '7 days' and r.plan_approved_at is null then
        perform ds_notify(r.org_id, null,
          format('Free trial: %s days left', greatest(1, ceil(extract(epoch from (r.trial_ends_at - now())) / 86400.0))::int),
          format('Choose and approve your plan before %s to keep pushing products. Nothing is charged before then.', to_char(r.trial_ends_at at time zone 'UTC', 'DD Mon YYYY')),
          '/account/dropship/billing',
          'ds-plan-trial-' || case when r.trial_ends_at - now() <= interval '2 days' then '2' else '7' end || ':' || r.org_id::text || ':' || to_char(r.trial_ends_at, 'YYYYMMDD'));
        v_reminders := v_reminders + 1;
      end if;
    elsif r.status = 'trial' then
      if r.plan_approved_at is not null and r.plan_code is not null then
        v := ds_billing_charge(r.org_id);
        if (v ->> 'ok')::boolean then v_charged := v_charged + 1; else v_failed := v_failed + 1; end if;
      else
        update public.dropship_plan_subscriptions
           set status = 'grace', grace_ends_at = r.trial_ends_at + make_interval(days => s.grace_days), updated_at = now()
         where org_id = r.org_id;
        perform ds_notify(r.org_id, null, 'Approve your plan to keep pushing',
          format('Your free trial ended. New pushes pause on %s. Paid orders keep shipping.', to_char((r.trial_ends_at + make_interval(days => s.grace_days)) at time zone 'UTC', 'DD Mon YYYY')),
          '/account/dropship/billing', 'ds-plan-grace:' || r.org_id::text || ':' || to_char(r.trial_ends_at, 'YYYYMMDD'));
        v_grace := v_grace + 1;
      end if;
    elsif r.status = 'active' and r.current_period_end is not null and r.current_period_end <= now() then
      v := ds_billing_charge(r.org_id);
      if (v ->> 'ok')::boolean then v_charged := v_charged + 1; else v_failed := v_failed + 1; end if;
    elsif r.status in ('grace', 'paused') then
      if r.plan_approved_at is not null and r.plan_code is not null then
        -- funds may have arrived: try again (a failed retry changes nothing; the notice is de-duplicated per grace period)
        v := ds_billing_charge(r.org_id);
        if (v ->> 'ok')::boolean then v_charged := v_charged + 1; continue; end if;
      end if;
      if r.status = 'grace' and r.grace_ends_at is not null and r.grace_ends_at <= now() then
        update public.dropship_plan_subscriptions set status = 'paused', paused_at = now(), updated_at = now() where org_id = r.org_id;
        perform ds_notify(r.org_id, null, 'New pushes are paused',
          'Your plan is not approved or paid, so new pushes are paused. Paid orders keep shipping. Approve your plan in Plan and billing to continue.',
          '/account/dropship/billing', 'ds-plan-paused:' || r.org_id::text || ':' || to_char(now(), 'YYYYMMDD'));
        perform write_audit('ds_plan.paused', 'dropship_plan_subscriptions', r.org_id::text, jsonb_build_object('org_id', r.org_id));
        v_paused := v_paused + 1;
      end if;
    end if;
  end loop;

  -- orders per month: never stops an order; one notice per month at 100 %
  for r in select x.org_id, p.orders_month_limit lim, p.name
             from public.dropship_plan_subscriptions x join public.dropship_plans p on p.code = x.plan_code
            where x.status in ('trial', 'active', 'grace', 'paused') and p.orders_month_limit is not null
              and x.orders_limit_month is distinct from date_trunc('month', now())::date loop
    if (select count(*) from public.store_orders so where so.org_id = r.org_id and coalesce(so.kind, 'store') = 'store'
          and so.created_at >= date_trunc('month', now())) >= r.lim then
      update public.dropship_plan_subscriptions set orders_limit_month = date_trunc('month', now())::date, updated_at = now() where org_id = r.org_id;
      perform ds_notify(r.org_id, null, format('Orders this month reached your %s plan (%s)', r.name, r.lim),
        'Orders keep coming in and shipping. Consider a bigger plan in Plan and billing.', '/account/dropship/billing',
        'ds-plan-orders:' || r.org_id::text || ':' || to_char(now(), 'YYYYMM'));
    end if;
  end loop;
  return jsonb_build_object('enabled', true, 'started', v_started, 'charged', v_charged, 'failed', v_failed, 'grace', v_grace,
                            'paused', v_paused, 'reminders', v_reminders);
end $$;

-- ───────────────────────── 6. Merchant: Plan and billing ─────────────────────────
create or replace function public.ds_billing_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v jsonb;
  v_live int;
begin
  perform ds_feature_guard('billing');
  v_org := ds_org_read();
  v := ds_plan_state(v_org);
  v_live := (v -> 'usage' ->> 'live_products')::int;
  return v || jsonb_build_object(
    'dropship_status', coalesce((select status from public.company_services where org_id = v_org and service = 'dropship'), 'off'),
    'my_role', ds_team_role(v_org, auth.uid()),
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents,
        'live_products_limit', p.live_products_limit, 'stores_limit', p.stores_limit, 'orders_month_limit', p.orders_month_limit,
        'features', to_jsonb(p.features), 'over_limit', case when p.live_products_limit is not null and v_live > p.live_products_limit then v_live - p.live_products_limit else 0 end)
        order by p.sort_order, p.code) from public.dropship_plans p where p.active), '[]'::jsonb),
    'issuer', (select le.legal_name from public.legal_entities le where le.id = current_legal_entity_id(now())),
    'documents', coalesce((select jsonb_agg(d order by d.created_at desc) from (
        select doc.id, doc.number, doc.created_at, doc.doc_type, doc.amount_cents, doc.status, doc.data ->> 'kind' as kind
          from public.documents doc
         where doc.org_id = v_org and doc.division_id = division_id_of('DS') and doc.doc_type in ('commercial_invoice', 'statement', 'credit_note')
           and coalesce(doc.status, '') <> 'void'
         order by doc.created_at desc limit 25) d), '[]'::jsonb));
end $$;

create or replace function public.ds_billing_choose_plan(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v jsonb;
  p public.dropship_plans;
  sub public.dropship_plan_subscriptions;
  v_res jsonb := null;
begin
  perform ds_feature_guard('billing');
  v_org := assert_dropship_new_activity();
  perform ds_assert_role(v_org, 'plan');
  v := ds_plan_state(v_org);
  if not (v ->> 'billing_enabled')::boolean then
    raise exception 'BILLING_OFF: Plans are free while plan fees are off. There is nothing to choose yet.';
  end if;
  if (v ->> 'free_forever')::boolean then raise exception 'FREE_FOREVER: Your company uses Octopus Dropship free. No plan is needed.'; end if;
  if v ->> 'channel' = 'shopify' then
    raise exception 'SHOPIFY_BILLING: Your plan is billed through Shopify once your store is connected. You approve it in Shopify.';
  end if;
  select * into p from public.dropship_plans where code = lower(btrim(coalesce(p_code, ''))) and active;
  if p.code is null or p.price_cents is null then raise exception 'NOT_FOUND: This plan is not available.'; end if;
  if p.live_products_limit is not null and (v -> 'usage' ->> 'live_products')::int > p.live_products_limit then
    raise exception 'OVER_LIMIT: % products are over the % limit. Unlink % product(s) in Pushed products first.',
      (v -> 'usage' ->> 'live_products')::int - p.live_products_limit, p.name, (v -> 'usage' ->> 'live_products')::int - p.live_products_limit;
  end if;
  if p.stores_limit is not null and (v -> 'usage' ->> 'stores')::int > p.stores_limit then
    raise exception 'OVER_LIMIT: The % plan allows % connected store(s). Disconnect a store first.', p.name, p.stores_limit;
  end if;
  sub := ds_billing_ensure(v_org);
  update public.dropship_plan_subscriptions
     set plan_code = p.code, plan_approved_at = now(), plan_approved_user = auth.uid(), channel = 'wallet', updated_at = now()
   where org_id = v_org returning * into sub;
  if sub.status in ('grace', 'paused') then
    v_res := ds_billing_charge(v_org);
  end if;
  perform write_audit('ds_plan.chosen', 'dropship_plan_subscriptions', v_org::text,
    jsonb_build_object('org_id', v_org, 'plan', p.code, 'status', sub.status, 'charge', v_res));
  return jsonb_build_object('ok', true, 'plan_code', p.code, 'plan_name', p.name,
    'status', (select status from public.dropship_plan_subscriptions where org_id = v_org), 'charge', v_res);
end $$;

-- ───────────────────────── 7. Step 12b: Finance switch, overrides, plan proposals ─────────────────────────
create or replace function public.saas_switch_propose(p_enable boolean, p_start_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saas_billing_settings;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not saas_finance_can() then raise exception 'FORBIDDEN: Only company-wide Finance approvers and admins can change plan fees.'; end if;
  if p_enable is null then raise exception 'INVALID_INPUT: Choose to start or stop plan fees.'; end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'REASON_REQUIRED: Enter the reason (3 to 500 characters).'; end if;
  select * into s from public.saas_billing_settings where id = 1 for update;
  if s.pending_enabled is not null then
    raise exception 'PROPOSAL_PENDING: A change is already waiting for a second approver. Approve, reject or withdraw it first.';
  end if;
  if p_enable and p_start_at is not null and p_start_at <= now() + interval '1 hour' then
    raise exception 'INVALID_DATE: The start date must be at least one hour from now.';
  end if;
  if not p_enable and not s.enabled and s.scheduled_start is null then raise exception 'NO_CHANGE: Plan fees are already off.'; end if;
  if p_enable and s.enabled then raise exception 'NO_CHANGE: Plan fees are already on.'; end if;
  perform set_config('octopus.saas_switch', 'on', true);
  update public.saas_billing_settings
     set pending_enabled = p_enable, pending_scheduled_start = case when p_enable then p_start_at end,
         proposed_by = auth.uid(), proposed_at = now(), proposal_reason = v_reason, approved_by = null, approved_at = null, updated_at = now()
   where id = 1;
  perform set_config('octopus.saas_switch', '', true);
  perform write_audit('saas_billing.proposed', 'saas_billing_settings', '1',
    jsonb_build_object('enable', p_enable, 'start_at', p_start_at, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'pending_enabled', p_enable, 'pending_scheduled_start', p_start_at);
end $$;

create or replace function public.saas_switch_decide(p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saas_billing_settings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_n int := 0;
  v_now_on boolean := false;
begin
  if not saas_finance_can() then raise exception 'FORBIDDEN: Only company-wide Finance approvers and admins can approve plan fees.'; end if;
  select * into s from public.saas_billing_settings where id = 1 for update;
  if s.pending_enabled is null then raise exception 'NOTHING_PENDING: There is no change waiting for approval.'; end if;
  if s.proposed_by is not distinct from auth.uid() then
    raise exception 'SECOND_PERSON_REQUIRED: Another Finance user or an admin must approve or reject this change.';
  end if;
  if p_approve is null then raise exception 'INVALID_INPUT'; end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then raise exception 'REASON_REQUIRED: Say why you reject the change.'; end if;
  perform set_config('octopus.saas_switch', 'on', true);
  if not p_approve then
    update public.saas_billing_settings
       set pending_enabled = null, pending_scheduled_start = null, proposed_by = null, proposed_at = null, proposal_reason = null, updated_at = now()
     where id = 1;
    perform set_config('octopus.saas_switch', '', true);
    perform write_audit('saas_billing.rejected', 'saas_billing_settings', '1',
      jsonb_build_object('enable', s.pending_enabled, 'proposed_by', s.proposed_by, 'note', v_note));
    return jsonb_build_object('ok', true, 'approved', false);
  end if;
  if s.pending_enabled then
    if s.pending_scheduled_start is not null and s.pending_scheduled_start > now() then
      update public.saas_billing_settings
         set scheduled_start = s.pending_scheduled_start, pending_enabled = null, pending_scheduled_start = null,
             approved_by = auth.uid(), approved_at = now(), updated_at = now()
       where id = 1;
    else
      update public.saas_billing_settings
         set enabled = true, enabled_at = now(), scheduled_start = null, pending_enabled = null, pending_scheduled_start = null,
             approved_by = auth.uid(), approved_at = now(), updated_at = now()
       where id = 1;
      v_now_on := true;
    end if;
  else
    update public.saas_billing_settings
       set enabled = false, scheduled_start = null, pending_enabled = null, pending_scheduled_start = null,
           approved_by = auth.uid(), approved_at = now(), updated_at = now()
     where id = 1;
  end if;
  perform set_config('octopus.saas_switch', '', true);
  if v_now_on then
    v_n := ds_billing_start_trials();
  elsif not s.pending_enabled then
    v_n := ds_billing_stop_all();
  end if;
  perform write_audit('saas_billing.approved', 'saas_billing_settings', '1',
    jsonb_build_object('enable', s.pending_enabled, 'start_at', s.pending_scheduled_start, 'proposed_by', s.proposed_by,
                       'reason', s.proposal_reason, 'note', v_note, 'merchants', v_n));
  return jsonb_build_object('ok', true, 'approved', true, 'enabled', v_now_on or (s.enabled and s.pending_enabled), 'merchants', v_n,
    'scheduled_start', case when s.pending_enabled and not v_now_on then s.pending_scheduled_start end);
end $$;

create or replace function public.saas_switch_withdraw()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public.saas_billing_settings;
begin
  if not saas_finance_can() then raise exception 'FORBIDDEN'; end if;
  select * into s from public.saas_billing_settings where id = 1 for update;
  if s.pending_enabled is null then raise exception 'NOTHING_PENDING: There is no change waiting for approval.'; end if;
  if s.proposed_by is distinct from auth.uid() then raise exception 'FORBIDDEN: Only the person who proposed the change can withdraw it.'; end if;
  perform set_config('octopus.saas_switch', 'on', true);
  update public.saas_billing_settings
     set pending_enabled = null, pending_scheduled_start = null, proposed_by = null, proposed_at = null, proposal_reason = null, updated_at = now()
   where id = 1;
  perform set_config('octopus.saas_switch', '', true);
  perform write_audit('saas_billing.withdrawn', 'saas_billing_settings', '1', jsonb_build_object('enable', s.pending_enabled));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.saas_override_set(p_org uuid, p_kind text, p_extra_days integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old public.saas_billing_overrides;
  sub public.dropship_plan_subscriptions;
  v_delta int;
begin
  if not saas_finance_can() then raise exception 'FORBIDDEN: Only company-wide Finance approvers and admins can set overrides.'; end if;
  if p_kind not in ('free_forever', 'extra_trial') then raise exception 'INVALID_INPUT: Choose free forever or a longer trial.'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'REASON_REQUIRED: Enter the reason.'; end if;
  if not exists (select 1 from public.company_services cs where cs.org_id = p_org and cs.service = 'dropship') then
    raise exception 'NOT_FOUND: This company does not use Octopus Dropship.';
  end if;
  if p_kind = 'extra_trial' and (p_extra_days is null or p_extra_days < 1 or p_extra_days > 365) then
    raise exception 'INVALID_INPUT: Extra trial days must be 1 to 365.';
  end if;
  select * into v_old from public.saas_billing_overrides where org_id = p_org;
  insert into public.saas_billing_overrides (org_id, kind, extra_trial_days, reason, set_by, set_at)
  values (p_org, p_kind, case when p_kind = 'extra_trial' then p_extra_days end, v_reason, auth.uid(), now())
  on conflict (org_id) do update set kind = excluded.kind, extra_trial_days = excluded.extra_trial_days, reason = excluded.reason,
    set_by = excluded.set_by, set_at = excluded.set_at;
  select * into sub from public.dropship_plan_subscriptions where org_id = p_org for update;
  if p_kind = 'extra_trial' and sub.status = 'trial' then
    v_delta := p_extra_days - coalesce(case when v_old.kind = 'extra_trial' then v_old.extra_trial_days end, 0);
    update public.dropship_plan_subscriptions set trial_ends_at = trial_ends_at + make_interval(days => v_delta), updated_at = now() where org_id = p_org;
  elsif p_kind = 'free_forever' then
    perform ds_billing_ensure(p_org);
  end if;
  perform write_audit('saas_billing.override_set', 'saas_billing_overrides', p_org::text,
    jsonb_build_object('org_id', p_org, 'kind', p_kind, 'extra_trial_days', p_extra_days, 'reason', v_reason,
                       'before', case when v_old.org_id is null then null else jsonb_build_object('kind', v_old.kind, 'extra_trial_days', v_old.extra_trial_days) end));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.saas_override_remove(p_org uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.saas_billing_overrides;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not saas_finance_can() then raise exception 'FORBIDDEN'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'REASON_REQUIRED: Enter the reason.'; end if;
  delete from public.saas_billing_overrides where org_id = p_org returning * into v_old;
  if v_old.org_id is null then raise exception 'NOT_FOUND: No override for this company.'; end if;
  if v_old.kind = 'free_forever' then
    update public.dropship_plan_subscriptions set status = 'free', updated_at = now() where org_id = p_org and status = 'free_forever';
    perform ds_billing_ensure(p_org);
  elsif v_old.kind = 'extra_trial' then
    update public.dropship_plan_subscriptions set trial_ends_at = trial_ends_at - make_interval(days => v_old.extra_trial_days), updated_at = now()
     where org_id = p_org and status = 'trial';
  end if;
  perform write_audit('saas_billing.override_removed', 'saas_billing_overrides', p_org::text,
    jsonb_build_object('org_id', p_org, 'kind', v_old.kind, 'extra_trial_days', v_old.extra_trial_days, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Plans, prices and limits: proposed by one Finance user, approved by another (the owner's numbers)
create or replace function public.ds_plan_propose(p_code text, p_values jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v jsonb := coalesce(p_values, '{}'::jsonb);
  v_name text := nullif(btrim(coalesce(v ->> 'name', '')), '');
  v_price bigint;
  v_lp int; v_st int; v_om int;
  v_feat text[];
  v_active boolean := coalesce((v ->> 'active')::boolean, false);
  v_id uuid;
begin
  if not saas_finance_can() then raise exception 'FORBIDDEN: Only company-wide Finance approvers and admins can propose plan changes.'; end if;
  if v_code !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'INVALID_INPUT: Plan code: lowercase letters, numbers and _ (2 to 40).'; end if;
  if v_name is null or length(v_name) > 60 then raise exception 'INVALID_INPUT: Enter the plan name (up to 60 characters).'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'REASON_REQUIRED: Enter the reason.'; end if;
  begin
    v_price := nullif(v ->> 'price_cents', '')::bigint;
    v_lp := nullif(v ->> 'live_products_limit', '')::int;
    v_st := nullif(v ->> 'stores_limit', '')::int;
    v_om := nullif(v ->> 'orders_month_limit', '')::int;
    v_feat := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v -> 'features', '[]'::jsonb)) x), '{}');
  exception when others then
    raise exception 'INVALID_INPUT: Price and limits must be whole numbers.';
  end;
  if v_price is not null and (v_price <= 0 or v_price > 10000000) then raise exception 'INVALID_INPUT: Price must be more than 0.'; end if;
  if v_active and v_price is null then raise exception 'PRICE_REQUIRED: A plan can only be offered once its price is set.'; end if;
  if (v_lp is not null and v_lp < 1) or (v_st is not null and v_st < 1) or (v_om is not null and v_om < 1) then
    raise exception 'INVALID_INPUT: Limits must be at least 1, or empty for no limit.';
  end if;
  if not v_feat <@ array['import_push', 'order_sync', 'auto_sync', 'priority_handling', 'branded_packaging']::text[] then
    raise exception 'INVALID_INPUT: Unknown plan feature.';
  end if;
  if exists (select 1 from public.dropship_plan_changes c where c.plan_code = v_code and c.status = 'proposed') then
    raise exception 'PROPOSAL_PENDING: A change to this plan is already waiting for approval.';
  end if;
  insert into public.dropship_plan_changes (plan_code, proposal, reason, proposed_by)
  values (v_code, jsonb_build_object('name', v_name, 'description', nullif(btrim(coalesce(v ->> 'description', '')), ''), 'price_cents', v_price,
            'live_products_limit', v_lp, 'stores_limit', v_st, 'orders_month_limit', v_om, 'features', to_jsonb(v_feat),
            'sort_order', coalesce(nullif(v ->> 'sort_order', '')::int, 10), 'active', v_active), v_reason, auth.uid())
  returning id into v_id;
  perform write_audit('ds_plan.proposed', 'dropship_plan_changes', v_id::text, jsonb_build_object('plan', v_code, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'change_id', v_id);
end $$;

create or replace function public.ds_plan_decide(p_change uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_plan_changes;
  v jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not saas_finance_can() then raise exception 'FORBIDDEN'; end if;
  select * into c from public.dropship_plan_changes where id = p_change for update;
  if c.id is null or c.status <> 'proposed' then raise exception 'NOT_FOUND: This proposal is not waiting for approval.'; end if;
  if c.proposed_by is not distinct from auth.uid() then
    if p_approve is false then
      update public.dropship_plan_changes set status = 'withdrawn', decided_at = now() where id = c.id;
      perform write_audit('ds_plan.withdrawn', 'dropship_plan_changes', c.id::text, jsonb_build_object('plan', c.plan_code));
      return jsonb_build_object('ok', true, 'withdrawn', true);
    end if;
    raise exception 'SECOND_PERSON_REQUIRED: Another Finance user or an admin must approve this change.';
  end if;
  if not p_approve then
    if v_note is null then raise exception 'REASON_REQUIRED: Say why you reject the change.'; end if;
    update public.dropship_plan_changes set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = c.id;
    perform write_audit('ds_plan.rejected', 'dropship_plan_changes', c.id::text, jsonb_build_object('plan', c.plan_code, 'note', v_note));
    return jsonb_build_object('ok', true, 'approved', false);
  end if;
  v := c.proposal;
  insert into public.dropship_plans (code, name, description, price_cents, live_products_limit, stores_limit, orders_month_limit, features, sort_order, active)
  values (c.plan_code, v ->> 'name', v ->> 'description', nullif(v ->> 'price_cents', '')::bigint, nullif(v ->> 'live_products_limit', '')::int,
          nullif(v ->> 'stores_limit', '')::int, nullif(v ->> 'orders_month_limit', '')::int,
          coalesce((select array_agg(x) from jsonb_array_elements_text(v -> 'features') x), '{}'), coalesce((v ->> 'sort_order')::int, 10),
          coalesce((v ->> 'active')::boolean, false))
  on conflict (code) do update set name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
    live_products_limit = excluded.live_products_limit, stores_limit = excluded.stores_limit, orders_month_limit = excluded.orders_month_limit,
    features = excluded.features, sort_order = excluded.sort_order, active = excluded.active, updated_at = now();
  update public.dropship_plan_changes set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = c.id;
  perform write_audit('ds_plan.approved', 'dropship_plans', c.plan_code, jsonb_build_object('change_id', c.id, 'values', v, 'proposed_by', c.proposed_by));
  return jsonb_build_object('ok', true, 'approved', true);
end $$;

-- Finance › SaaS billing screen
create or replace function public.saas_billing_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.saas_billing_settings;
begin
  if not (auth.uid() is not null and is_staff() and (is_admin() or can('finance', 'view'))) then raise exception 'FORBIDDEN'; end if;
  select * into s from public.saas_billing_settings where id = 1;
  return jsonb_build_object(
    'can_decide', saas_finance_can(),
    'me', auth.uid(),
    'settings', jsonb_build_object('enabled', s.enabled, 'enabled_at', s.enabled_at, 'scheduled_start', s.scheduled_start,
      'trial_days', s.trial_days, 'grace_days', s.grace_days, 'trial_start_mode', s.trial_start_mode, 'one_trial_per_org', s.one_trial_per_org,
      'pending_enabled', s.pending_enabled, 'pending_scheduled_start', s.pending_scheduled_start, 'proposal_reason', s.proposal_reason,
      'proposed_by', s.proposed_by, 'proposed_by_name', (select full_name from public.profiles where id = s.proposed_by), 'proposed_at', s.proposed_at,
      'approved_by_name', (select full_name from public.profiles where id = s.approved_by), 'approved_at', s.approved_at, 'updated_at', s.updated_at),
    'counts', (select jsonb_build_object(
        'merchants', count(*),
        'free_off', count(*) filter (where not s.enabled),
        'trial', count(*) filter (where s.enabled and sub.status = 'trial' and coalesce(o.kind, '') <> 'free_forever'),
        'paying', count(*) filter (where s.enabled and sub.status = 'active' and coalesce(o.kind, '') <> 'free_forever'),
        'grace', count(*) filter (where s.enabled and sub.status = 'grace' and coalesce(o.kind, '') <> 'free_forever'),
        'paused', count(*) filter (where s.enabled and sub.status = 'paused' and coalesce(o.kind, '') <> 'free_forever'),
        'free_forever', count(*) filter (where o.kind = 'free_forever' and org.credit_eligible))
      from public.company_services cs
      join public.organizations org on org.id = cs.org_id
      left join public.dropship_plan_subscriptions sub on sub.org_id = cs.org_id
      left join public.saas_billing_overrides o on o.org_id = cs.org_id
     where cs.service = 'dropship' and cs.status in ('on', 'paused')),
    'merchants', coalesce((select jsonb_agg(jsonb_build_object('org_id', org.id, 'name', org.name, 'credit_eligible', coalesce(org.credit_eligible, false),
        'plan_name', p.name, 'status', case when not s.enabled then 'free' else coalesce(sub.status, 'none') end,
        'override', o.kind, 'extra_trial_days', o.extra_trial_days, 'reason', o.reason,
        'set_by_name', (select full_name from public.profiles where id = o.set_by), 'set_at', o.set_at) order by (o.kind is null), org.name)
      from public.company_services cs
      join public.organizations org on org.id = cs.org_id
      left join public.dropship_plan_subscriptions sub on sub.org_id = cs.org_id
      left join public.dropship_plans p on p.code = sub.plan_code
      left join public.saas_billing_overrides o on o.org_id = cs.org_id
     where cs.service = 'dropship' and (cs.status in ('on', 'paused') or o.org_id is not null)), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.code) from public.dropship_plans p), '[]'::jsonb),
    'plan_changes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'plan_code', c.plan_code, 'proposal', c.proposal, 'reason', c.reason,
        'proposed_by', c.proposed_by, 'proposed_by_name', (select full_name from public.profiles where id = c.proposed_by), 'proposed_at', c.proposed_at)
        order by c.proposed_at) from public.dropship_plan_changes c where c.status = 'proposed'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h order by h.created_at desc) from (
        select a.action, a.created_at, a.details, (select full_name from public.profiles where id = a.actor_id) actor_name
          from public.audit_log a
         where a.action like 'saas\_billing.%' or a.action in ('ds_plan.approved', 'ds_plan.rejected', 'ds_plan.proposed')
         order by a.created_at desc limit 30) h), '[]'::jsonb));
end $$;

-- ───────────────────────── 8. Step 13 readers: reports + dashboard ─────────────────────────
-- One row per charged store order (Octopus lines only) of the period. Sales = the buyer's prices on the store order, in USD at
-- the FX rate locked at intake; unknown when a line has no buyer price or the FX rate is missing (never 0). Costs = what was
-- charged (the OCT-DS invoice lines: product, processing, shipping, duties when DDP) minus refunds. A fully refunded order has
-- no sales or costs (it counts in the refund rate). Delivery days = delivered − handed to the carrier (Warehouse OS shipped_at),
-- else − charged.
create or replace function public.ds_report_orders(p_org uuid, p_from timestamptz, p_to timestamptz, p_country text)
returns table (
  store_order_id uuid, order_number text, external_order_name text, created_at timestamptz, country text, shipping_method text,
  buyer_currency text, fx_rate_to_usd numeric, sales_usd_cents bigint, product_cents bigint, processing_cents bigint, shipping_cents bigint,
  duties_cents bigint, refunds_cents bigint, costs_cents bigint, profit_cents bigint, refunded boolean, full_refund boolean,
  delivered_at timestamptz, shipped_at timestamptz, delivery_days numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select so.*, x.charged_cents, coalesce(x.refunded_cents, 0)::bigint as refunded, x.charged_at,
           coalesce(x.refunded_cents, 0) >= coalesce(x.charged_cents, 0) and coalesce(x.refunded_cents, 0) > 0 as full_ref,
           (select max(w.shipped_at) from public.wh_orders w where w.store_order_id = so.id and w.status <> 'cancelled') as ship_at,
           case when count(i.id) = 0 or bool_or(i.buyer_unit_price_cents is null) then null
                when so.buyer_currency = 'USD' then round(sum(i.buyer_unit_price_cents * i.qty) * coalesce(so.fx_rate_to_usd, 1))::bigint
                when so.fx_rate_to_usd is null then null
                else round(sum(i.buyer_unit_price_cents * i.qty) * so.fx_rate_to_usd)::bigint end as sales
      from public.store_orders so
      join public.dropship_order_intake x on x.store_order_id = so.id
      left join public.store_order_items i on i.store_order_id = so.id
     where so.org_id = p_org and coalesce(so.kind, 'store') = 'store' and x.charged_at is not null
       and so.created_at >= p_from and so.created_at < p_to
       and (p_country is null or so.destination_country = p_country)
     group by so.id, x.store_order_id
  )
  select b.id, b.order_number, b.external_order_name, b.created_at, b.destination_country::text, b.shipping_method, b.buyer_currency::text,
         b.fx_rate_to_usd,
         case when b.full_ref then 0 else b.sales end,
         case when b.full_ref then 0 else coalesce(b.product_cents, 0) end,
         case when b.full_ref then 0 else coalesce(b.processing_cents, 0) end,
         case when b.full_ref then 0 else coalesce(b.shipping_cents, 0) end,
         case when b.full_ref or b.incoterm <> 'DDP' then 0 else coalesce(b.duties_cents, 0) end,
         case when b.full_ref then 0 else -b.refunded end,
         case when b.full_ref then 0 else coalesce(b.charged_cents, 0) - b.refunded end,
         case when b.full_ref then 0 when b.sales is null then null else b.sales - (coalesce(b.charged_cents, 0) - b.refunded) end,
         b.refunded > 0, b.full_ref, b.delivered_at, b.ship_at,
         case when b.delivered_at is not null then round((extract(epoch from (b.delivered_at - coalesce(b.ship_at, b.charged_at))) / 86400.0)::numeric, 1) end
    from base b
$$;

create or replace function public.ds12_period_summary(p_org uuid, p_from timestamptz, p_to timestamptz, p_country text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'orders', count(*),
    'sales_cents', coalesce(sum(r.sales_usd_cents), 0),
    'orders_without_price', count(*) filter (where r.sales_usd_cents is null),
    'costs_cents', coalesce(sum(r.costs_cents), 0),
    'profit_cents', coalesce(sum(r.profit_cents), 0),
    'product_cents', coalesce(sum(r.product_cents), 0),
    'processing_cents', coalesce(sum(r.processing_cents), 0),
    'shipping_cents', coalesce(sum(r.shipping_cents), 0),
    'duties_cents', coalesce(sum(r.duties_cents), 0),
    'refunds_cents', coalesce(sum(r.refunds_cents), 0),
    'refunded_orders', count(*) filter (where r.refunded),
    'refund_rate_bp', case when count(*) = 0 then null else round(10000.0 * count(*) filter (where r.refunded) / count(*))::int end,
    'avg_delivery_days', round(avg(r.delivery_days), 1),
    'delivered_orders', count(*) filter (where r.delivery_days is not null))
  from public.ds_report_orders(p_org, p_from, p_to, p_country) r
$$;

create or replace function public.ds_reports_page(p_from timestamptz, p_to timestamptz, p_country text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz := coalesce(p_from, coalesce(p_to, now()) - interval '30 days');
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_len interval;
  v_cur jsonb;
  v_prev jsonb;
  v_week0 timestamptz := date_trunc('week', now()) - interval '11 weeks';
begin
  perform ds_feature_guard('reports');
  v_org := ds_org_read();
  if v_from >= v_to then raise exception 'INVALID_INPUT: The start date must be before the end date.'; end if;
  if v_to - v_from > interval '400 days' then raise exception 'INVALID_INPUT: Choose a period of up to 400 days.'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'INVALID_INPUT: Unknown country.'; end if;
  v_len := v_to - v_from;
  v_cur := ds12_period_summary(v_org, v_from, v_to, v_country);
  v_prev := ds12_period_summary(v_org, v_from - v_len, v_from, v_country);
  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'country', v_country,
    'current', v_cur, 'previous', v_prev,
    'delivery_route', (select jsonb_build_object('country', r.country, 'method', r.shipping_method)
                         from public.ds_report_orders(v_org, v_from, v_to, v_country) r where r.delivery_days is not null
                        group by r.country, r.shipping_method order by count(*) desc, r.country limit 1),
    'countries', coalesce((select jsonb_agg(distinct so.destination_country) from public.store_orders so where so.org_id = v_org and so.destination_country is not null), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'shop_domain', c.shop_domain) order by c.shop_domain) from public.store_connections c where c.org_id = v_org and c.status <> 'disconnected'), '[]'::jsonb),
    'weeks', (select jsonb_agg(jsonb_build_object('week_start', w.ws, 'profit_cents', coalesce(t.p, 0), 'orders', coalesce(t.n, 0)) order by w.ws)
                from generate_series(v_week0, date_trunc('week', now()), interval '1 week') w(ws)
                left join (select date_trunc('week', r.created_at) wk, sum(r.profit_cents)::bigint p, count(*)::int n
                             from public.ds_report_orders(v_org, v_week0, now() + interval '1 second', v_country) r group by 1) t on t.wk = w.ws),
    'top_products', coalesce((select jsonb_agg(tp order by tp.sales_cents desc nulls last, tp.units desc) from (
        select i.product_id, max(i.title_snapshot) as title, min(split_part(i.model_no, '-', 1) || '-' || split_part(i.model_no, '-', 2)) as model_no,
               sum(i.qty) filter (where not r.full_refund)::int as units,
               sum(case when r.full_refund then 0
                        when i.buyer_unit_price_cents is null or (r.buyer_currency <> 'USD' and r.fx_rate_to_usd is null) then null
                        else round(i.buyer_unit_price_cents * i.qty * coalesce(r.fx_rate_to_usd, 1)) end)::bigint as sales_cents,
               sum(case when r.full_refund then 0
                        else coalesce(i.line_product_cents, 0)
                             + case when coalesce(r.product_cents, 0) > 0
                                    then round((r.processing_cents + r.shipping_cents + r.duties_cents + r.refunds_cents)::numeric * coalesce(i.line_product_cents, 0) / r.product_cents)
                                    else 0 end end)::bigint as costs_cents,
               count(distinct r.store_order_id) filter (where r.refunded)::int as refunds,
               round(avg(r.delivery_days), 1) as avg_delivery_days
          from public.ds_report_orders(v_org, v_from, v_to, v_country) r
          join public.store_order_items i on i.store_order_id = r.store_order_id
         group by i.product_id
         order by 4 desc nulls last limit 10) tp), '[]'::jsonb));
end $$;

create or replace function public.ds_reports_csv(p_from timestamptz, p_to timestamptz, p_country text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  perform ds_feature_guard('reports');
  v_org := ds_org_read();
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '400 days' then
    raise exception 'INVALID_INPUT: Choose a period of up to 400 days.';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at)
    from public.ds_report_orders(v_org, p_from, p_to, nullif(upper(btrim(coalesce(p_country, ''))), '')) r), '[]'::jsonb);
end $$;

create or replace function public.ds_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
  v_now timestamptz := now();
  v_avail bigint;
  v_wait record;
  v_attn jsonb := '[]'::jsonb;
  v_conn public.store_connections;
  v_plan jsonb;
begin
  v_avail := wallet_balance(v_org, 'USD');
  select count(*)::int n, coalesce(sum(so.total_cents), 0)::bigint cents into v_wait
    from public.store_orders so join public.dropship_order_intake x on x.store_order_id = so.id
   where so.org_id = v_org and so.payment_state = 'unpaid' and so.cancelled_at is null and x.expired_at is null and x.hold_code is null and so.total_cents is not null;
  v_plan := ds_plan_state(v_org);
  v_conn := ds_active_connection(v_org);

  -- Needs attention, in this order: money, holds, setup problems, information
  v_attn := v_attn || coalesce((select jsonb_agg(jsonb_build_object('kind', 'to_pay', 'order', coalesce(so.external_order_name, so.order_number),
        'amount_cents', so.total_cents, 'wallet_cents', v_avail, 'href', '/account/dropship/wallet#add-funds') order by so.created_at)
      from public.store_orders so join public.dropship_order_intake x on x.store_order_id = so.id
     where so.org_id = v_org and so.payment_state = 'unpaid' and so.cancelled_at is null and x.expired_at is null and x.hold_code is null
       and x.last_charge_error = 'WALLET_INSUFFICIENT'), '[]'::jsonb);
  if v_plan ->> 'status' in ('grace', 'paused') then
    v_attn := v_attn || jsonb_build_array(jsonb_build_object('kind', 'plan_' || (v_plan ->> 'status'), 'until', v_plan ->> 'grace_ends_at', 'href', '/account/dropship/billing'));
  end if;
  v_attn := v_attn || coalesce((select jsonb_agg(jsonb_build_object('kind', 'hold_' || x.hold_code, 'order', coalesce(so.external_order_name, so.order_number),
        'message', x.hold_message, 'href', '/account/dropship/orders') order by so.created_at)
      from public.store_orders so join public.dropship_order_intake x on x.store_order_id = so.id
     where so.org_id = v_org and x.hold_code is not null and so.cancelled_at is null and x.expired_at is null), '[]'::jsonb);
  if v_plan ->> 'status' = 'trial' and (v_plan ->> 'trial_days_left')::int <= 7 and not (v_plan ->> 'plan_approved')::boolean then
    v_attn := v_attn || jsonb_build_array(jsonb_build_object('kind', 'plan_trial', 'days', (v_plan ->> 'trial_days_left')::int, 'href', '/account/dropship/billing'));
  end if;
  v_attn := v_attn || coalesce((select jsonb_agg(jsonb_build_object('kind', 'rate_unmapped', 'rate_name', m.rate_name, 'href', '/account/dropship/packing'))
      from public.dropship_rate_mappings m where m.org_id = v_org and m.method is null), '[]'::jsonb);
  v_attn := v_attn || coalesce((select jsonb_build_array(jsonb_build_object('kind', 'push_failed', 'count', count(*), 'href', '/account/dropship/pushed'))
      from public.dropship_push_jobs j where j.org_id = v_org and j.status = 'failed' having count(*) > 0), '[]'::jsonb);
  v_attn := v_attn || coalesce((select jsonb_agg(jsonb_build_object('kind', 'margin', 'product', coalesce(l.title, dp.title), 'href', '/account/dropship/pricing'))
      from public.dropship_price_approvals a left join public.dropship_listings l on l.org_id = a.org_id and l.product_id = a.product_id
      left join public.dropship_products dp on dp.id = a.product_id
     where a.org_id = v_org and a.status = 'waiting' and a.reason_code = 'below_min'), '[]'::jsonb);
  v_attn := v_attn || coalesce((select jsonb_build_array(jsonb_build_object('kind', 'cost_up', 'count', count(distinct a.product_id), 'href', '/account/dropship/pricing'))
      from public.dropship_price_approvals a where a.org_id = v_org and a.status = 'waiting' and a.reason_code = 'landed_up' having count(*) > 0), '[]'::jsonb);

  return jsonb_build_object(
    'dropship_status', coalesce((select status from public.company_services where org_id = v_org and service = 'dropship'), 'off'),
    'current', ds12_period_summary(v_org, v_now - interval '30 days', v_now, null),
    'previous', ds12_period_summary(v_org, v_now - interval '60 days', v_now - interval '30 days', null),
    'attention', v_attn,
    'recent_orders', coalesce((select jsonb_agg(r order by r.created_at desc) from (
        select so.id, coalesce(so.external_order_name, so.order_number) as order_ref, so.created_at, so.total_cents, so.merchant_status, so.payment_state,
               x.hold_code, x.expired_at, so.cancelled_at,
               ds_order_buyer_short(so.buyer_name) as buyer, so.destination_country as country,
               (select i.title_snapshot || case when i.qty > 1 then ' ×' || i.qty else '' end from public.store_order_items i where i.store_order_id = so.id order by i.created_at, i.id limit 1) as first_item,
               (select count(*) - 1 from public.store_order_items i where i.store_order_id = so.id)::int as more_items
          from public.store_orders so left join public.dropship_order_intake x on x.store_order_id = so.id
         where so.org_id = v_org and coalesce(so.kind, 'store') = 'store'
         order by so.created_at desc limit 5) r), '[]'::jsonb),
    'wallet', jsonb_build_object('available_cents', v_avail, 'held_cents', ds_order_held_cents(v_org), 'waiting_orders', v_wait.n,
                                 'waiting_cents', v_wait.cents, 'low', v_wait.n > 0 and v_wait.cents > v_avail),
    'sync', jsonb_build_object(
      'store', case when v_conn.id is null then null else jsonb_build_object('shop_domain', v_conn.shop_domain, 'status', v_conn.status) end,
      'needs_reconnect', exists (select 1 from public.store_connections c where c.org_id = v_org and c.status = 'needs_reconnect'),
      'last_order_at', (select max(x.created_at) from public.dropship_order_intake x where x.org_id = v_org),
      'last_sync_at', (select max(l.created_at) from public.dropship_sync_log l where l.org_id = v_org),
      'failed_pushes', (select count(*)::int from public.dropship_push_jobs j where j.org_id = v_org and j.status = 'failed')),
    'plan', v_plan);
end $$;

-- ───────────────────────── 9. Step 13: Settings, team, data export, close ─────────────────────────
create or replace function public.ds12_settings_org(p_write boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := dropship_merchant_any_org(); v_status text;
begin
  if v_org is null then raise exception 'DROPSHIP_NOT_ENABLED'; end if;
  perform ds_feature_guard('settings');
  if p_write then
    select status into v_status from public.company_services where org_id = v_org and service = 'dropship';
    if v_status not in ('on', 'paused') then raise exception 'DROPSHIP_CLOSED: Dropshipping is closed for your company; settings can''t be changed.'; end if;
  end if;
  return v_org;
end $$;

create or replace function public.ds_settings_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := ds12_settings_org(false);
  v_uid uuid := auth.uid();
  st public.dropship_merchant_settings;
  sp public.dropship_seller_profiles;
begin
  select * into st from public.dropship_merchant_settings where org_id = v_org;
  select * into sp from public.dropship_seller_profiles where org_id = v_org;
  return jsonb_build_object(
    'dropship_status', coalesce((select status from public.company_services where org_id = v_org and service = 'dropship'), 'off'),
    'my_role', ds_team_role(v_org, v_uid),
    'me', v_uid,
    'org', (select jsonb_build_object('name', o.name, 'country', o.country) from public.organizations o where o.id = v_org),
    'profile', jsonb_build_object('time_zone', coalesce(st.time_zone, 'UTC'), 'display_currency', coalesce(st.display_currency, 'USD')),
    'team', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.full_name, 'email', p.email,
        'ds_role', ds_team_role(v_org, m.user_id), 'is_me', m.user_id = v_uid) order by (ds_team_role(v_org, m.user_id) <> 'owner'), p.full_name)
      from public.org_members m left join public.profiles p on p.id = m.user_id where m.org_id = v_org), '[]'::jsonb),
    'invites', case when ds_team_role(v_org, v_uid) = 'owner' then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'ds_role', i.ds_role,
        'expires_at', i.expires_at) order by i.created_at)
      from public.dropship_team_invites i where i.org_id = v_org and i.status = 'pending' and i.expires_at > now()), '[]'::jsonb) else '[]'::jsonb end,
    'prefs', coalesce((select jsonb_agg(jsonb_build_object('event', e.ev, 'email', coalesce(np.email, true), 'in_app', coalesce(np.in_app, true)) order by e.n)
      from unnest(array['new_order', 'awaiting_payment', 'on_hold', 'wallet_low', 'out_of_stock', 'cost_changed', 'push_failed', 'store_reconnect']) with ordinality e(ev, n)
      left join public.dropship_notification_prefs np on np.org_id = v_org and np.user_id = v_uid and np.event = e.ev), '[]'::jsonb),
    'branding', jsonb_build_object('brand_name', sp.brand_name, 'profile_status', sp.status, 'has_logo', st.logo_path is not null, 'logo_path', st.logo_path,
      'show_logo_slip', coalesce(st.show_logo_slip, false), 'show_logo_tracking', coalesce(st.show_logo_tracking, false)),
    'policies', jsonb_build_object('returns_policy', st.returns_policy, 'support_email', st.support_email),
    'buyer_data_days', (select (value #>> '{}')::int from public.site_settings where key = 'dropship.buyer_data_days' and (value #>> '{}') ~ '^[0-9]+$'));
end $$;

create or replace function public.ds_settings_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := ds12_settings_org(true);
  v_tz text := nullif(btrim(coalesce(p ->> 'time_zone', '')), '');
  v_ret text := nullif(btrim(coalesce(p ->> 'returns_policy', '')), '');
  v_mail text := nullif(lower(btrim(coalesce(p ->> 'support_email', ''))), '');
  v_prob text;
begin
  perform ds_assert_role(v_org, 'branding');
  if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then raise exception 'INVALID_INPUT: Time zone: choose one from the list.'; end if;
  if coalesce(p ->> 'display_currency', 'USD') <> 'USD' then raise exception 'INVALID_INPUT: Amounts are shown in USD, your wallet currency.'; end if;
  if v_ret is not null and length(v_ret) > 1000 then raise exception 'INVALID_INPUT: Returns policy: up to 1,000 characters.'; end if;
  v_prob := ds12_text_problem(v_ret);
  if v_prob is not null then raise exception 'TEXT_CHECK: Returns policy: %', v_prob; end if;
  if v_mail is not null and (length(v_mail) > 200 or v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'INVALID_INPUT: Support email: enter an address like help@yourstore.com.';
  end if;
  v_prob := ds12_text_problem(v_mail);
  if v_prob is not null then raise exception 'TEXT_CHECK: Support email: %', v_prob; end if;
  insert into public.dropship_merchant_settings (org_id, time_zone, display_currency, show_logo_slip, show_logo_tracking, returns_policy, support_email, updated_at)
  values (v_org, coalesce(v_tz, 'UTC'), 'USD', coalesce((p ->> 'show_logo_slip')::boolean, false), coalesce((p ->> 'show_logo_tracking')::boolean, false), v_ret, v_mail, now())
  on conflict (org_id) do update set time_zone = excluded.time_zone, show_logo_slip = excluded.show_logo_slip, show_logo_tracking = excluded.show_logo_tracking,
    returns_policy = excluded.returns_policy, support_email = excluded.support_email, updated_at = now();
  if (p ->> 'show_logo_slip')::boolean or (p ->> 'show_logo_tracking')::boolean then
    if not exists (select 1 from public.dropship_merchant_settings where org_id = v_org and logo_path is not null) then
      raise exception 'LOGO_REQUIRED: Upload your logo first, then choose where it is shown.';
    end if;
  end if;
  perform write_audit('ds_settings.saved', 'dropship_merchant_settings', v_org::text, jsonb_build_object('org_id', v_org));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ds_branding_set_logo(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := ds12_settings_org(true);
begin
  perform ds_assert_role(v_org, 'branding');
  if p_path is not null and p_path !~ '^logos/[0-9a-f]{32}\.(png|jpg|webp)$' then raise exception 'INVALID_INPUT: Logo file name.'; end if;
  insert into public.dropship_merchant_settings (org_id, logo_path, updated_at) values (v_org, p_path, now())
  on conflict (org_id) do update set logo_path = excluded.logo_path,
    show_logo_slip = case when excluded.logo_path is null then false else public.dropship_merchant_settings.show_logo_slip end,
    show_logo_tracking = case when excluded.logo_path is null then false else public.dropship_merchant_settings.show_logo_tracking end,
    updated_at = now();
  perform write_audit('ds_settings.logo', 'dropship_merchant_settings', v_org::text, jsonb_build_object('org_id', v_org, 'removed', p_path is null));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ds_notification_prefs_save(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := ds12_settings_org(false); e jsonb; n int := 0;
begin
  if jsonb_typeof(p_prefs) <> 'array' or jsonb_array_length(p_prefs) > 20 then raise exception 'INVALID_INPUT'; end if;
  for e in select * from jsonb_array_elements(p_prefs) loop
    if e ->> 'event' not in ('new_order', 'awaiting_payment', 'on_hold', 'wallet_low', 'out_of_stock', 'cost_changed', 'push_failed', 'store_reconnect') then
      raise exception 'INVALID_INPUT: Unknown notification.';
    end if;
    insert into public.dropship_notification_prefs (org_id, user_id, event, email, in_app, updated_at)
    values (v_org, auth.uid(), e ->> 'event', coalesce((e ->> 'email')::boolean, true), coalesce((e ->> 'in_app')::boolean, true), now())
    on conflict (org_id, user_id, event) do update set email = excluded.email, in_app = excluded.in_app, updated_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'saved', n);
end $$;

create or replace function public.ds_team_set_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := ds12_settings_org(true); v_old text;
begin
  perform ds_assert_role(v_org, 'team');
  if p_role not in ('owner', 'manager', 'support') then raise exception 'INVALID_INPUT: Choose Owner, Manager or Support.'; end if;
  if not exists (select 1 from public.org_members where org_id = v_org and user_id = p_user) then raise exception 'NOT_FOUND: This person is not in your team.'; end if;
  v_old := ds_team_role(v_org, p_user);
  if v_old = 'owner' and p_role <> 'owner'
     and (select count(*) from public.org_members m where m.org_id = v_org and ds_team_role(v_org, m.user_id) = 'owner') <= 1 then
    raise exception 'LAST_OWNER: Your team needs at least one owner.';
  end if;
  insert into public.dropship_team_roles (org_id, user_id, ds_role, updated_at) values (v_org, p_user, p_role, now())
  on conflict (org_id, user_id) do update set ds_role = excluded.ds_role, updated_at = now();
  perform write_audit('ds_team.role_changed', 'dropship_team_roles', v_org::text || ':' || p_user::text,
    jsonb_build_object('org_id', v_org, 'user_id', p_user, 'from', v_old, 'to', p_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ds_team_remove(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := ds12_settings_org(true); v_role text;
begin
  perform ds_assert_role(v_org, 'team');
  if p_user = auth.uid() then raise exception 'INVALID_INPUT: You can''t remove yourself.'; end if;
  v_role := ds_team_role(v_org, p_user);
  if v_role is null then raise exception 'NOT_FOUND: This person is not in your team.'; end if;
  if v_role = 'owner' then raise exception 'OWNER: Change this person''s role before removing them.'; end if;
  delete from public.org_members where org_id = v_org and user_id = p_user;
  perform write_audit('ds_team.removed', 'org_members', v_org::text || ':' || p_user::text, jsonb_build_object('org_id', v_org, 'user_id', p_user, 'role', v_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ds_team_invite(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := ds12_settings_org(true); v_mail text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  perform ds_assert_role(v_org, 'team');
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_mail) > 200 then raise exception 'INVALID_INPUT: Email: enter an address like name@company.com.'; end if;
  if p_role not in ('manager', 'support') then raise exception 'INVALID_INPUT: Choose Manager or Support.'; end if;
  if exists (select 1 from public.org_members m join public.profiles p on p.id = m.user_id where m.org_id = v_org and lower(p.email) = v_mail) then
    raise exception 'ALREADY_MEMBER: This person is already in your team.';
  end if;
  if exists (select 1 from public.dropship_team_invites i where i.org_id = v_org and i.email = v_mail and i.status = 'pending' and i.expires_at > now()) then
    raise exception 'ALREADY_INVITED: This person already has an invitation.';
  end if;
  update public.dropship_team_invites set status = 'cancelled' where org_id = v_org and email = v_mail and status = 'pending';
  insert into public.dropship_team_invites (org_id, email, ds_role, sent_by) values (v_org, v_mail, p_role, auth.uid()) returning id into v_id;
  perform write_audit('ds_team.invited', 'dropship_team_invites', v_id::text, jsonb_build_object('org_id', v_org, 'email', v_mail, 'role', p_role));
  return jsonb_build_object('ok', true, 'invite_id', v_id);
end $$;

create or replace function public.ds_team_invite_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := ds12_settings_org(false);
begin
  perform ds_assert_role(v_org, 'team');
  update public.dropship_team_invites set status = 'cancelled' where id = p_id and org_id = v_org and status = 'pending';
  if not found then raise exception 'NOT_FOUND: This invitation was not found.'; end if;
  perform write_audit('ds_team.invite_cancelled', 'dropship_team_invites', p_id::text, jsonb_build_object('org_id', v_org));
  return jsonb_build_object('ok', true);
end $$;

-- The invited person signs in with the invited (confirmed) email; an account that already belongs to a company can't join
create or replace function public.ds_team_invites_for_me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'company', o.name, 'ds_role', i.ds_role, 'expires_at', i.expires_at) order by i.created_at), '[]'::jsonb)
    from public.dropship_team_invites i join public.organizations o on o.id = i.org_id
   where i.status = 'pending' and i.expires_at > now()
     and i.email = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;

create or replace function public.ds_team_invite_accept(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mail text;
  i public.dropship_team_invites;
begin
  if v_uid is null or user_is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  select lower(u.email) into v_mail from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  select * into i from public.dropship_team_invites where id = p_id for update;
  if i.id is null or i.status <> 'pending' or i.expires_at <= now() or i.email is distinct from v_mail then
    raise exception 'NOT_FOUND: This invitation is not valid for your sign-in.';
  end if;
  if exists (select 1 from public.org_members where user_id = v_uid) then
    raise exception 'HAS_COMPANY: Your login already belongs to a company. Ask the owner to invite another email address.';
  end if;
  insert into public.org_members (org_id, user_id, member_role) values (i.org_id, v_uid, case when i.ds_role = 'support' then 'viewer' else 'buyer' end);
  insert into public.dropship_team_roles (org_id, user_id, ds_role) values (i.org_id, v_uid, i.ds_role);
  update public.dropship_team_invites set status = 'accepted', accepted_user = v_uid, accepted_at = now() where id = i.id;
  perform write_audit('ds_team.invite_accepted', 'dropship_team_invites', i.id::text, jsonb_build_object('org_id', i.org_id, 'user_id', v_uid, 'role', i.ds_role));
  return jsonb_build_object('ok', true, 'org_id', i.org_id);
end $$;

-- CSV export rows (products, orders, invoices) — active, paused and closed merchants; buyer-safe, no supplier data
create or replace function public.ds_export_rows(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := dropship_merchant_any_org();
begin
  if auth.uid() is null or v_org is null then raise exception 'DROPSHIP_NOT_ENABLED: Dropship is not enabled for your company.'; end if;
  if p_kind = 'products' then
    return coalesce((select jsonb_agg(r order by r.title) from (
      select dp.model_no, coalesce(l.title, dp.title) as title, case when exists (select 1 from public.dropship_product_links k where k.org_id = v_org and k.product_id = dp.id and k.status = 'linked') then 'live in store'
                  when l.id is not null then 'edited, not pushed' else 'in import list' end as status, coalesce(l.saved_at, il.created_at) as updated_at
        from public.dropship_products dp
        left join public.dropship_listings l on l.org_id = v_org and l.product_id = dp.id
        left join lateral (select min(x.created_at) created_at from public.dropship_import_list x where x.org_id = v_org and x.product_id = dp.id) il on true
       where l.id is not null or il.created_at is not null
          or exists (select 1 from public.dropship_product_links k where k.org_id = v_org and k.product_id = dp.id)) r), '[]'::jsonb);
  elsif p_kind = 'orders' then
    return coalesce((select jsonb_agg(r order by r.created_at) from (
      select so.order_number, so.external_order_name, so.channel, so.created_at, so.destination_country, so.shipping_method, so.incoterm,
             so.product_cents, so.processing_cents, so.shipping_cents, so.duties_cents, so.total_cents, so.payment_state, so.merchant_status,
             x.charged_at, x.refunded_cents, so.delivered_at, so.cancelled_at
        from public.store_orders so left join public.dropship_order_intake x on x.store_order_id = so.id
       where so.org_id = v_org) r), '[]'::jsonb);
  elsif p_kind = 'invoices' then
    return coalesce((select jsonb_agg(r order by r.created_at) from (
      select d.number, d.created_at, d.doc_type, d.amount_cents, d.paid_cents, d.currency, d.status, d.due_at
        from public.documents d where d.org_id = v_org and d.division_id = division_id_of('DS')
         and d.doc_type in ('commercial_invoice', 'statement', 'credit_note')) r), '[]'::jsonb);
  end if;
  raise exception 'INVALID_INPUT: Choose products, orders or invoices.';
end $$;

-- Close Dropshipping (owner): service off (closed), stores disconnected, open pushes cancelled, plan cancelled, invitations
-- cancelled. Kept: orders already paid (they finish), wallet, withdrawals, statements, invoices, support, data export.
create or replace function public.ds_close_dropshipping(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := dropship_merchant_any_org();
  v_old public.company_services;
  v_stores int; v_jobs int; v_open int;
begin
  if auth.uid() is null or v_org is null then raise exception 'DROPSHIP_NOT_ENABLED'; end if;
  perform ds_assert_role(v_org, 'close');
  if upper(btrim(coalesce(p_confirm, ''))) <> 'CLOSE' then raise exception 'CONFIRM_REQUIRED: Type CLOSE to confirm.'; end if;
  select * into v_old from public.company_services where org_id = v_org and service = 'dropship' for update;
  if v_old.status not in ('on', 'paused') then raise exception 'ALREADY_CLOSED: Dropshipping is already closed.'; end if;
  update public.company_services set status = 'off', status_reason = 'Closed by the company', ended_at = now(), updated_by = auth.uid(), updated_at = now()
   where org_id = v_org and service = 'dropship';
  update public.store_connections set status = 'disconnected', status_reason = 'Dropshipping closed by the company', disconnected_at = now(), updated_at = now()
   where org_id = v_org and status <> 'disconnected';
  get diagnostics v_stores = row_count;
  update public.dropship_push_jobs set status = 'cancelled', finished_at = now(), error_code = 'DROPSHIP_CLOSED', error_message = 'Dropshipping was closed.', updated_at = now()
   where org_id = v_org and status in ('queued', 'retry_wait', 'blocked');
  get diagnostics v_jobs = row_count;
  update public.dropship_plan_subscriptions set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where org_id = v_org and status <> 'cancelled';
  update public.dropship_team_invites set status = 'cancelled' where org_id = v_org and status = 'pending';
  select count(*)::int into v_open from public.store_orders so where so.org_id = v_org and so.payment_state <> 'unpaid' and so.delivered_at is null and so.cancelled_at is null;
  perform ds_notify(v_org, null, 'Dropshipping account closed',
    'Paid orders in progress keep shipping. Your wallet, withdrawals, statements, invoices, support and data export stay available.',
    '/account/dropship', 'ds-closed:' || v_org::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, org_id, service, before, after, details, division_id)
  values (auth.uid(), 'customer', 'dropship.closed_by_merchant', 'company_services', v_org::text || ':dropship', v_org, 'dropship',
          jsonb_build_object('status', v_old.status, 'reason', v_old.status_reason), jsonb_build_object('status', 'off', 'reason', 'Closed by the company'),
          jsonb_build_object('stores_disconnected', v_stores, 'pushes_cancelled', v_jobs, 'open_orders', v_open), division_id_of('DS'));
  return jsonb_build_object('ok', true, 'stores_disconnected', v_stores, 'pushes_cancelled', v_jobs, 'open_orders', v_open);
end $$;

-- White-label brand for the buyer tracking page (server, service role) and the packing slip (staff): approved brand name only, returns policy,
-- support email, logo file only when the merchant chose to show it. Never an Octopus or supplier detail.
create or replace function public.ds12_brand_json(p_org uuid, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'brand_name', (select sp.brand_name from public.dropship_seller_profiles sp where sp.org_id = p_org and sp.status = 'approved'),
    'logo_path', case when (p_for = 'tracking' and st.show_logo_tracking) or (p_for = 'slip' and st.show_logo_slip) then st.logo_path end,
    'returns_policy', st.returns_policy,
    'support_email', st.support_email)
  from (select 1) x left join public.dropship_merchant_settings st on st.org_id = p_org
$$;

create or replace function public.ds_public_brand(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tok text := nullif(lower(btrim(coalesce(p_token, ''))), '');
  v_org uuid;
begin
  if v_tok is null or v_tok !~ '^[0-9a-f]{32,64}$' then return null; end if;
  select so.org_id into v_org from public.wh_orders w join public.store_orders so on so.id = w.store_order_id where w.tracking_token = v_tok limit 1;
  if v_org is null then
    select so.org_id into v_org from public.shipments s join public.store_orders so on so.id = s.store_order_id where s.tracking_token = v_tok limit 1;
  end if;
  if v_org is null then return null; end if;
  return ds12_brand_json(v_org, 'tracking');
end $$;

create or replace function public.ds_brand_for_org(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if ds12_claims_role() <> 'service_role' and not (auth.uid() is not null and is_staff()) then raise exception 'FORBIDDEN'; end if;
  return ds12_brand_json(p_org, 'slip');
end $$;

-- ───────────────────────── 10. Staff: System health ─────────────────────────
create or replace function public.ds12_health_can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and not distributor_restricted()
     and (is_admin() or in_division(division_id_of('DS')) or can('finance', 'view'))
$$;

create or replace function public.ds_health_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_cron boolean := to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null;
begin
  if not ds12_health_can_view() then raise exception 'FORBIDDEN'; end if;
  if v_cron then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'last_start', d.start_time, 'last_end', d.end_time, 'last_status', d.status,
               'last_message', left(case when d.status = 'failed' then d.return_message end, 300),
               'failed_24h', (select count(*) from cron.job_run_details f where f.jobid = j.jobid and f.status = 'failed' and f.start_time > now() - interval '24 hours'))
             order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (select r.start_time, r.end_time, r.status, r.return_message from cron.job_run_details r
                            where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
       where j.jobname like 'octopus-%'
    $q$ into v_jobs;
  end if;
  return jsonb_build_object(
    'can_act', is_admin() or dropship_can_edit(division_id_of('DS')),
    'checked_at', now(),
    'domain_events', (select jsonb_build_object('pending', count(*) filter (where db_status = 'pending'), 'retry', count(*) filter (where db_status = 'retry'),
        'dead', count(*) filter (where db_status = 'dead'), 'oldest_pending', min(created_at) filter (where db_status in ('pending', 'retry')),
        'processed_24h', count(*) filter (where db_status = 'processed' and processed_at > now() - interval '24 hours')) from public.domain_events),
    'outbox', (select jsonb_build_object('pending', count(*) filter (where status = 'pending'), 'failed', count(*) filter (where status = 'failed'),
        'dead', count(*) filter (where status = 'dead'), 'oldest_pending', min(created_at) filter (where status = 'pending')) from public.outbox_events),
    'failed', coalesce((select jsonb_agg(f order by f.at desc) from (
        select 'domain_event' as kind, e.id, coalesce(e.processed_at, e.available_at, e.created_at) as at, e.event_type as job,
               (select o.name from public.store_orders so join public.organizations o on o.id = so.org_id where so.id = e.aggregate_id) as merchant,
               left(coalesce(e.last_error, 'No reason recorded'), 300) as reason, e.attempts, e.db_status as status
          from public.domain_events e where e.db_status in ('retry', 'dead')
        union all
        select 'outbox', e.id, coalesce(e.available_at, e.created_at), e.event_type, null, left(coalesce(e.last_error, 'No reason recorded'), 300), e.attempts, e.status
          from public.outbox_events e where e.status in ('failed', 'dead')
        union all
        select 'push_job', j.id, coalesce(j.finished_at, j.updated_at), 'Push product', o.name, left(coalesce(j.error_message, j.error_code, 'No reason recorded'), 300), j.attempts, j.status
          from public.dropship_push_jobs j join public.organizations o on o.id = j.org_id where j.status = 'failed'
        order by 3 desc limit 100) f), '[]'::jsonb),
    'webhooks', jsonb_build_object(
      'store_failed', coalesce((select jsonb_agg(jsonb_build_object('source', w.source, 'topic', w.topic, 'received_at', w.received_at, 'attempts', w.attempts,
          'error', left(coalesce(w.error, case when not w.signature_ok then 'Signature did not match' else 'Not processed yet' end), 300)) order by w.received_at desc)
        from (select * from public.webhook_inbox w where w.error is not null or not w.signature_ok or (w.processed_at is null and w.received_at < now() - interval '10 minutes')
              order by w.received_at desc limit 50) w), '[]'::jsonb),
      'payment_unprocessed', (select count(*) from public.payment_webhook_events p where p.processed_at is null and p.provider <> 'mock'),
      'store_received_24h', (select count(*) from public.webhook_inbox w where w.received_at > now() - interval '24 hours')),
    'token_failures', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'merchant', o.name, 'shop_domain', c.shop_domain, 'reason', c.status_reason, 'at', c.updated_at) order by c.updated_at desc)
        from public.store_connections c join public.organizations o on o.id = c.org_id where c.status = 'needs_reconnect'), '[]'::jsonb),
    'stores_active', (select count(*) from public.store_connections c where c.status = 'active'),
    'sync_errors', coalesce((select jsonb_agg(s order by s.at desc) from (
        select l.created_at as at, o.name as merchant, l.kind, left(l.change_text, 200) as change, left(l.result_text, 200) as result
          from public.dropship_sync_log l join public.organizations o on o.id = l.org_id
         where l.result_text ~* '(fail|error|refus|could not|blocked)'
         order by l.created_at desc limit 50) s), '[]'::jsonb),
    'links_failed', (select count(*) from public.dropship_product_links k where k.sync_state = 'failed'),
    'carrier_last_event', (select max(t.created_at) from public.wh_tracking_events t),
    'cron_readable', v_cron,
    'jobs', v_jobs);
end $$;

create or replace function public.ds_health_retry(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (ds12_health_can_view() and (is_admin() or dropship_can_edit(division_id_of('DS')))) then
    raise exception 'FORBIDDEN: Retry needs Dropship edit rights or an admin.';
  end if;
  if p_kind = 'domain_event' then
    update public.domain_events set db_status = 'pending', attempts = 0, available_at = now() where id = p_id and db_status in ('retry', 'dead');
  elsif p_kind = 'outbox' then
    update public.outbox_events set status = 'pending', attempts = 0, available_at = now() where id = p_id and status in ('failed', 'dead');
  elsif p_kind = 'push_job' then
    update public.dropship_push_jobs set status = 'queued', attempts = 0, next_attempt_at = now(), error_code = null, error_message = null,
           finished_at = null, updated_at = now() where id = p_id and status = 'failed';
  else
    raise exception 'INVALID_INPUT';
  end if;
  if not found then raise exception 'NOT_FOUND: This job is not waiting for a retry any more.'; end if;
  perform write_audit('ds_health.retry', p_kind, p_id::text, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ds_health_dead_letter(p_kind text, p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not (ds12_health_can_view() and (is_admin() or dropship_can_edit(division_id_of('DS')))) then raise exception 'FORBIDDEN'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'REASON_REQUIRED: Say why this job should stop.'; end if;
  if p_kind = 'domain_event' then
    update public.domain_events set db_status = 'dead', last_error = left('Stopped by staff: ' || v_reason, 1000) where id = p_id and db_status in ('pending', 'retry');
  elsif p_kind = 'outbox' then
    update public.outbox_events set status = 'dead', last_error = left('Stopped by staff: ' || v_reason, 1000) where id = p_id and status in ('pending', 'failed');
  else
    raise exception 'INVALID_INPUT';
  end if;
  if not found then raise exception 'NOT_FOUND: This job can''t be stopped now.'; end if;
  perform write_audit('ds_health.dead_letter', p_kind, p_id::text, jsonb_build_object('kind', p_kind, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ds_health_notify_merchant(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.store_connections;
begin
  if not (ds12_health_can_view() and (is_admin() or dropship_can_edit(division_id_of('DS')))) then raise exception 'FORBIDDEN'; end if;
  select * into c from public.store_connections where id = p_connection and status = 'needs_reconnect';
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  perform ds_notify(c.org_id, 'store_reconnect', 'Reconnect your store', format('Octopus can''t reach %s any more. Open Stores and choose Reconnect.', c.shop_domain),
    '/account/dropship/stores', 'ds-reconnect:' || c.id::text || ':' || to_char(now(), 'YYYYMMDD'));
  perform write_audit('ds_health.notify_merchant', 'store_connections', c.id::text, jsonb_build_object('org_id', c.org_id));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── 11. Function grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'ds12_claims_role()', 'saas_finance_can()', 'ds12_usd(bigint)', 'ds_team_role(uuid, uuid)', 'ds_role_allows(text, text)',
    'ds_assert_role(uuid, text)', 'ds_notify(uuid, text, text, text, text, text)', 'ds12_text_problem(text)', 'ds_plan_live_products(uuid)',
    'ds_plan_state(uuid)', 'ds_plan_push_guard()', 'ds_plan_store_guard()', 'saas_override_guard()', 'ds_role_guard()',
    'ds_billing_ensure(uuid)', 'ds_billing_charge(uuid)', 'ds_billing_start_trials()', 'ds_billing_stop_all()', 'ds_billing_jobs()',
    'ds_billing_page()', 'ds_billing_choose_plan(text)', 'saas_switch_propose(boolean, timestamptz, text)', 'saas_switch_decide(boolean, text)',
    'saas_switch_withdraw()', 'saas_override_set(uuid, text, integer, text)', 'saas_override_remove(uuid, text)',
    'ds_plan_propose(text, jsonb, text)', 'ds_plan_decide(uuid, boolean, text)', 'saas_billing_page()',
    'ds_report_orders(uuid, timestamptz, timestamptz, text)', 'ds12_period_summary(uuid, timestamptz, timestamptz, text)',
    'ds_reports_page(timestamptz, timestamptz, text)', 'ds_reports_csv(timestamptz, timestamptz, text)', 'ds_dashboard()',
    'ds12_settings_org(boolean)', 'ds_settings_page()', 'ds_settings_save(jsonb)', 'ds_branding_set_logo(text)', 'ds_notification_prefs_save(jsonb)',
    'ds_team_set_role(uuid, text)', 'ds_team_remove(uuid)', 'ds_team_invite(text, text)', 'ds_team_invite_cancel(uuid)',
    'ds_team_invites_for_me()', 'ds_team_invite_accept(uuid)', 'ds_export_rows(text)', 'ds_close_dropshipping(text)',
    'ds12_brand_json(uuid, text)', 'ds_public_brand(text)', 'ds_brand_for_org(uuid)', 'ds12_health_can_view()', 'ds_health_page()',
    'ds_health_retry(text, uuid)', 'ds_health_dead_letter(text, uuid, text)', 'ds_health_notify_merchant(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- signed-in users: each RPC finds the merchant's own organisation (or checks the staff permission) itself
  foreach f in array array[
    'ds_billing_page()', 'ds_billing_choose_plan(text)', 'saas_switch_propose(boolean, timestamptz, text)', 'saas_switch_decide(boolean, text)',
    'saas_switch_withdraw()', 'saas_override_set(uuid, text, integer, text)', 'saas_override_remove(uuid, text)',
    'ds_plan_propose(text, jsonb, text)', 'ds_plan_decide(uuid, boolean, text)', 'saas_billing_page()',
    'ds_reports_page(timestamptz, timestamptz, text)', 'ds_reports_csv(timestamptz, timestamptz, text)', 'ds_dashboard()',
    'ds_settings_page()', 'ds_settings_save(jsonb)', 'ds_branding_set_logo(text)', 'ds_notification_prefs_save(jsonb)',
    'ds_team_set_role(uuid, text)', 'ds_team_remove(uuid)', 'ds_team_invite(text, text)', 'ds_team_invite_cancel(uuid)',
    'ds_team_invites_for_me()', 'ds_team_invite_accept(uuid)', 'ds_export_rows(text)', 'ds_close_dropshipping(text)',
    'ds_brand_for_org(uuid)', 'ds_health_page()', 'ds_health_retry(text, uuid)', 'ds_health_dead_letter(text, uuid, text)',
    'ds_health_notify_merchant(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- ds_public_brand(token) is NOT granted to anon / signed-in users: the public tracking page reads it on the server with the
  -- service role (app/t/[token]/brand-block.tsx), so the brand of a token is never an open RPC.
end $$;

-- ───────────────────────── 12. Storage bucket for merchant logos (private; uploaded by the server with the service role) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dropship-branding', 'dropship-branding', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ───────────────────────── 13. Schedule (pg_cron, where installed) ─────────────────────────
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-billing') then
      perform cron.unschedule('octopus-dropship-billing');
    end if;
    perform cron.schedule('octopus-dropship-billing', '25 * * * *', 'select public.ds_billing_jobs()');
  end if;
end $$;
