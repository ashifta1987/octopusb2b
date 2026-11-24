-- 20261101000215_step4_access_requests_onboarding_and_merchants.sql
-- Phase 2 · Step 4: Merchant access requests, staff approval/pause/close, KYC auto-pause,
-- onboarding wizard, seller profile review, and read-only saas_billing_settings singleton.
--
-- Rules implemented (Step 4 + Corrections 1–5):
--  1. Pause/close ('paused' or closed 'off' after having been active) blocks ONLY new activity
--     (imports, pushes, new store orders / new store orders being charged, samples, product requests)
--     with a separate error code DROPSHIP_PAUSED. Paused or closed merchants still see orders in
--     progress (which keep being fulfilled), wallet, withdrawals, statements/invoices, support, and data export.
--  2. company_services dropship status = 'on' | 'paused' | 'off' ONLY (no 'trial' for access; any
--     existing 'trial' is mapped to 'on' and removed from dropship checks).
--  3. saas_billing_settings created here is the ONLY one (reused in Step 12b). Zero writes allowed
--     until Step 12b's two-person Finance switch (enabled = false, trial_days = 30, grace_days = 7).
--  4. If organizations.kyc_status leaves 'verified', dropship auto-pauses with reason
--     'KYC no longer verified' (audit-logged + in-app notification); staff reactivate after re-verification.
--  5. Notifications are in-app only (public.notifications); never fail if Resend/email is not configured.
--
-- Down: supabase/migrations/down/20261101000215_step4_access_requests_onboarding_and_merchants.down.sql

-- ───────── 1. Correction 2: company_services dropship status = on | paused | off ONLY + status_reason ─────────
update public.company_services
   set status = 'on',
       updated_at = now()
 where service = 'dropship'
   and status = 'trial';

alter table public.company_services
  add column if not exists status_reason text;

grant select (status_reason) on public.company_services to authenticated;

alter table public.company_services
  drop constraint if exists company_services_dropship_no_trial_check;

alter table public.company_services
  add constraint company_services_dropship_no_trial_check
  check (service <> 'dropship' or status in ('on', 'paused', 'off'));

create or replace function public.set_company_service(
  p_org uuid,
  p_service text,
  p_status text,
  p_plan text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  old public.company_services;
  v_status text := case when p_service = 'dropship' and p_status = 'trial' then 'on' else p_status end;
begin
  if not (can('customers', 'edit') or is_my_customer(p_org)) then raise exception 'FORBIDDEN'; end if;
  select * into old from public.company_services where org_id = p_org and service = p_service;
  insert into public.company_services(org_id, service, status, plan, started_at, ended_at, updated_by, updated_at)
  values (
    p_org,
    p_service,
    v_status,
    p_plan,
    case when (p_service = 'dropship' and v_status = 'on') or (p_service <> 'dropship' and v_status in ('on', 'trial')) then now() end,
    case when v_status = 'off' then now() end,
    auth.uid(),
    now()
  )
  on conflict (org_id, service) do update
    set status = excluded.status,
        plan = coalesce(excluded.plan, public.company_services.plan),
        started_at = case
          when (p_service = 'dropship' and excluded.status = 'on' and public.company_services.status <> 'on')
            or (p_service <> 'dropship' and excluded.status in ('on', 'trial') and public.company_services.status not in ('on', 'trial'))
          then coalesce(public.company_services.started_at, now())
          else public.company_services.started_at
        end,
        ended_at = case when excluded.status = 'off' then now() else null end,
        updated_by = auth.uid(),
        updated_at = now();
  perform audit('company_service.set', p_org, p_service, 'company_service', p_org::text || ':' || p_service,
                case when old.org_id is null then null else jsonb_build_object('status', old.status, 'plan', old.plan) end,
                jsonb_build_object('status', v_status, 'plan', p_plan));
end $$;
revoke execute on function public.set_company_service(uuid, text, text, text) from public, anon;
grant execute on function public.set_company_service(uuid, text, text, text) to authenticated, service_role;

-- ───────── 2. Customer-facing review message on dropship_seller_profiles ─────────
alter table public.dropship_seller_profiles
  add column if not exists customer_message text;

grant select (customer_message) on public.dropship_seller_profiles to authenticated;
comment on column public.dropship_seller_profiles.customer_message is 'Shown to the merchant when staff review the brand/return address profile.';

-- ───────── 3. Correction 3: Singleton saas_billing_settings (ONLY table, reused in Step 12b; zero writes until Step 12b) ─────────
create table if not exists public.saas_billing_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  enabled_at timestamptz,
  scheduled_start timestamptz,
  trial_days integer not null default 30 check (trial_days >= 0 and trial_days <= 365),
  trial_start_mode text not null default 'switch_or_pick' check (trial_start_mode in ('switch_or_pick', 'on_plan_pick')),
  grace_days integer not null default 7 check (grace_days >= 0 and grace_days <= 90),
  one_trial_per_org boolean not null default true,
  pending_enabled boolean,
  pending_scheduled_start timestamptz,
  proposed_by uuid references auth.users(id) on delete set null,
  proposed_at timestamptz,
  proposal_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint saas_billing_two_person_check check (approved_by is null or proposed_by is distinct from approved_by)
);

comment on table public.saas_billing_settings is 'Singleton SaaS plan-fee switch for Octopus Dropship (reused in Step 12b). Write-locked until Step 12b two-person Finance switch.';

insert into public.saas_billing_settings (id, enabled, trial_days, trial_start_mode, grace_days, one_trial_per_org)
values (1, false, 30, 'switch_or_pick', 7, true)
on conflict (id) do nothing;

create or replace function public.guard_saas_billing_settings_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'SAAS_BILLING_LOCKED: Plan fee settings can only be changed through the Step 12b two-person Finance switch';
end $$;

drop trigger if exists trg_guard_saas_billing_settings_locked on public.saas_billing_settings;
create trigger trg_guard_saas_billing_settings_locked
  before insert or update or delete on public.saas_billing_settings
  for each row execute function public.guard_saas_billing_settings_locked();

alter table public.saas_billing_settings enable row level security;
revoke all on public.saas_billing_settings from public, anon, authenticated, service_role;
grant select (id, enabled, enabled_at, scheduled_start, trial_days, trial_start_mode, grace_days, one_trial_per_org, updated_at)
  on public.saas_billing_settings to authenticated;
grant select on public.saas_billing_settings to service_role;

drop policy if exists saas_billing_settings_read on public.saas_billing_settings;
create policy saas_billing_settings_read on public.saas_billing_settings
  for select to authenticated
  using (true);

-- ───────── 4. dropship_access_requests table ─────────
create table if not exists public.dropship_access_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  store_platform text not null default 'shopify' check (store_platform in ('shopify', 'woocommerce', 'wix')),
  store_address text,
  expected_orders_band text not null default 'Under 100',
  countries text[] not null default '{}'::text[],
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dropship_access_requests_ds check (division_id = division_id_of('DS'))
);

create unique index if not exists dropship_access_requests_one_pending_idx
  on public.dropship_access_requests (org_id)
  where status = 'pending';

create index if not exists dropship_access_requests_status_created_idx
  on public.dropship_access_requests (status, created_at desc);

comment on table public.dropship_access_requests is 'Merchant requests to switch on Octopus Dropship (KYC-verified orgs only; staff approve/reject with reason).';

alter table public.dropship_access_requests enable row level security;
revoke all on public.dropship_access_requests from public, anon, authenticated;
grant select, insert, update on public.dropship_access_requests to authenticated;
grant all on public.dropship_access_requests to service_role;

drop policy if exists dropship_access_requests_staff_read on public.dropship_access_requests;
create policy dropship_access_requests_staff_read on public.dropship_access_requests
  for select to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (in_division(division_id_of('DS')) or can('finance', 'view') or is_my_customer(org_id))
  );

drop policy if exists dropship_access_requests_staff_write on public.dropship_access_requests;
create policy dropship_access_requests_staff_write on public.dropship_access_requests
  for all to authenticated
  using (
    is_staff()
    and not distributor_restricted()
    and (dropship_can_edit(division_id_of('DS')) or is_my_customer(org_id))
  )
  with check (
    is_staff()
    and not distributor_restricted()
    and (dropship_can_edit(division_id_of('DS')) or is_my_customer(org_id))
  );

-- ───────── 5. Correction 4: Auto-pause Dropship if organizations.kyc_status leaves 'verified' ─────────
create or replace function public.dropship_kyc_autopause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cs public.company_services;
begin
  if old.kyc_status = 'verified'::kyc_status and new.kyc_status is distinct from 'verified'::kyc_status then
    select *
      into v_cs
      from public.company_services
     where org_id = new.id
       and service = 'dropship'
       and status = 'on'
     for update;

    if v_cs.org_id is not null then
      update public.company_services
         set status = 'paused',
             status_reason = 'KYC no longer verified',
             updated_at = now()
       where org_id = new.id
         and service = 'dropship';

      insert into public.audit_log (
        actor_id,
        actor_kind,
        action,
        entity,
        entity_id,
        org_id,
        service,
        before,
        after,
        details,
        division_id
      ) values (
        auth.uid(),
        case when auth.uid() is not null and user_is_staff(auth.uid()) then 'staff' else 'system' end,
        'dropship.auto_paused_kyc',
        'company_services',
        new.id::text || ':dropship',
        new.id,
        'dropship',
        jsonb_build_object('status', v_cs.status, 'kyc_status', old.kyc_status),
        jsonb_build_object('status', 'paused', 'kyc_status', new.kyc_status, 'reason', 'KYC no longer verified'),
        jsonb_build_object('reason', 'KYC no longer verified', 'kyc_from', old.kyc_status, 'kyc_to', new.kyc_status),
        division_id_of('DS')
      );

      insert into public.notifications (org_id, division_id, service, title, body, link)
      values (
        new.id,
        division_id_of('DS'),
        'dropship',
        'Dropshipping paused: company verification needed',
        'KYC no longer verified. Paid orders in progress keep shipping; new imports, samples and orders are paused until your company is verified again.',
        '/account/kyc'
      );
    end if;
  end if;
  return new;
end $$;

revoke all on function public.dropship_kyc_autopause() from public, anon, authenticated;

drop trigger if exists trg_dropship_kyc_autopause on public.organizations;
create trigger trg_dropship_kyc_autopause
  after update of kyc_status on public.organizations
  for each row execute function public.dropship_kyc_autopause();

-- ───────── 6. Corrections 1 & 2: Access & Pause/Close Gate Helpers + Policies + Updated RPCs ─────────
-- Active dropship merchant ('on' only — no 'trial')
create or replace function public.dropship_merchant_org() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then return null; end if;
  if user_is_staff(v_uid) then return null; end if;
  if exists (select 1 from public.user_roles where user_id = v_uid and role_code = 'supplier')
     or exists (select 1 from public.suppliers where user_id = v_uid) then
    return null;
  end if;
  select m.org_id into v_org
    from public.org_members m
    join public.organizations o on o.id = m.org_id and o.archived_at is null
    join public.company_services cs on cs.org_id = m.org_id and cs.service = 'dropship' and cs.status = 'on'
   where m.user_id = v_uid
   order by m.created_at asc
   limit 1;
  return v_org;
end $$;
revoke all on function public.dropship_merchant_org() from public, anon;
grant execute on function public.dropship_merchant_org() to authenticated, service_role;

-- Active, paused, OR closed (previously-enabled) dropship merchant — allowed to view orders in progress, samples, requests, onboarding state
create or replace function public.dropship_merchant_any_org() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then return null; end if;
  if user_is_staff(v_uid) then return null; end if;
  if exists (select 1 from public.user_roles where user_id = v_uid and role_code = 'supplier')
     or exists (select 1 from public.suppliers where user_id = v_uid) then
    return null;
  end if;
  select m.org_id into v_org
    from public.org_members m
    join public.organizations o on o.id = m.org_id and o.archived_at is null
    join public.company_services cs
      on cs.org_id = m.org_id
     and cs.service = 'dropship'
     and (cs.status in ('on', 'paused') or cs.started_at is not null)
   where m.user_id = v_uid
   order by m.created_at asc
   limit 1;
  return v_org;
end $$;
revoke all on function public.dropship_merchant_any_org() from public, anon;
grant execute on function public.dropship_merchant_any_org() to authenticated, service_role;

-- Gate for NEW activity (imports, pushes, new store orders / new store orders being charged, samples, product requests):
--   · 'on' -> returns org_id
--   · 'paused' or closed ('off' after started_at is not null) -> raises DROPSHIP_PAUSED
--   · never enabled / non-merchant -> raises DROPSHIP_NOT_ENABLED
create or replace function public.assert_dropship_new_activity(p_org_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_service boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role';
  v_org uuid;
  v_cs public.company_services;
begin
  if p_org_id is not null and (v_is_service or (v_uid is not null and is_staff() and not distributor_restricted())) then
    v_org := p_org_id;
  else
    if v_uid is null or user_is_staff(v_uid) then
      raise exception 'DROPSHIP_NOT_ENABLED';
    end if;
    if exists (select 1 from public.user_roles where user_id = v_uid and role_code = 'supplier')
       or exists (select 1 from public.suppliers where user_id = v_uid) then
      raise exception 'DROPSHIP_NOT_ENABLED';
    end if;

    if p_org_id is not null then
      if p_org_id not in (select my_org_ids()) then
        raise exception 'FORBIDDEN';
      end if;
      v_org := p_org_id;
    else
      select m.org_id into v_org
        from public.org_members m
        join public.organizations o on o.id = m.org_id and o.archived_at is null
       where m.user_id = v_uid
       order by m.created_at asc
       limit 1;
    end if;
  end if;

  if v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  select *
    into v_cs
    from public.company_services cs
   where cs.org_id = v_org
     and cs.service = 'dropship';

  if v_cs.org_id is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  if v_cs.status = 'on' then
    return v_org;
  end if;

  if v_cs.status = 'paused' or (v_cs.status = 'off' and v_cs.started_at is not null) then
    raise exception 'DROPSHIP_PAUSED: Dropshipping is paused or closed for this company; existing paid orders continue shipping.';
  end if;

  raise exception 'DROPSHIP_NOT_ENABLED';
end $$;
revoke all on function public.assert_dropship_new_activity(uuid) from public, anon;
grant execute on function public.assert_dropship_new_activity(uuid) to authenticated, service_role;

-- Block new imports / edits on dropship_import_list when paused or closed (SELECT and DELETE remain allowed)
create or replace function public.guard_dropship_import_list_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not is_staff() then
    perform public.assert_dropship_new_activity(new.org_id);
  end if;
  return new;
end $$;
revoke all on function public.guard_dropship_import_list_active() from public, anon, authenticated;

drop trigger if exists trg_guard_dropship_import_list_active on public.dropship_import_list;
create trigger trg_guard_dropship_import_list_active
  before insert or update on public.dropship_import_list
  for each row execute function public.guard_dropship_import_list_active();

-- Allow paused and closed merchants to continue reading their store_orders & store_order_items in progress
drop policy if exists store_orders_read on public.store_orders;
create policy store_orders_read on public.store_orders
  for select to authenticated
  using (
    (
      org_id in (select my_org_ids())
      and exists (
        select 1
          from public.company_services cs
         where cs.org_id = store_orders.org_id
           and cs.service = 'dropship'
           and (cs.status in ('on', 'paused') or cs.started_at is not null)
      )
    )
    or (
      is_staff()
      and not distributor_restricted()
      and (
        in_division(division_id_of('DS'))
        or can('finance', 'view')
      )
    )
  );

drop policy if exists store_order_items_read on public.store_order_items;
create policy store_order_items_read on public.store_order_items
  for select to authenticated
  using (
    exists (
      select 1
        from public.store_orders so
       where so.id = store_order_items.store_order_id
         and (
           (
             so.org_id in (select my_org_ids())
             and exists (
               select 1
                 from public.company_services cs
                where cs.org_id = so.org_id
                  and cs.service = 'dropship'
                  and (cs.status in ('on', 'paused') or cs.started_at is not null)
             )
           )
           or (
             is_staff()
             and not distributor_restricted()
             and (
               in_division(division_id_of('DS'))
               or can('finance', 'view')
             )
           )
         )
    )
  );

-- Update create_dropship_store_order & mark_store_order_paid so new store orders / new store orders being charged raise DROPSHIP_PAUSED when paused/closed
create or replace function public.create_dropship_store_order(
  p_org_id uuid,
  p_channel text,
  p_external_order_id text,
  p_external_order_name text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address jsonb,
  p_destination_country text,
  p_buyer_currency text,
  p_fx_rate_to_usd numeric,
  p_shipping_method text,
  p_incoterm text,
  p_lines jsonb,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and dropship_can_edit(division_id_of('DS')));
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_ext_id text := nullif(btrim(coalesce(p_external_order_id, '')), '');
  v_country char(2) := upper(btrim(coalesce(p_destination_country, '')))::char(2);
  v_cur char(3) := upper(btrim(coalesce(p_buyer_currency, '')))::char(3);
  v_method text := lower(btrim(coalesce(p_shipping_method, '')));
  v_incoterm text := upper(btrim(coalesce(p_incoterm, 'DDP')));
  v_fx numeric := p_fx_rate_to_usd;
  v_existing public.store_orders;
  v_quote jsonb;
  v_order_id uuid;
  v_order_no text;
  v_line jsonb;
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_route public.dropship_routes;
  v_qty integer;
  v_unit_prod bigint;
  v_buyer_unit bigint;
  v_decl_usd bigint;
  v_fx_mult numeric;
begin
  if not v_is_staff then
    if v_uid is null or p_org_id is null or p_org_id not in (select my_org_ids()) then
      raise exception 'FORBIDDEN';
    end if;
    perform public.assert_dropship_new_activity(p_org_id);
  else
    -- Even webhook / automated ingestion refuses creating new store orders when merchant is paused or closed
    if exists (
      select 1 from public.company_services cs
       where cs.org_id = p_org_id
         and cs.service = 'dropship'
         and (cs.status = 'paused' or (cs.status = 'off' and cs.started_at is not null))
    ) then
      raise exception 'DROPSHIP_PAUSED: Dropshipping is paused or closed for this company; existing paid orders continue shipping.';
    end if;
  end if;

  if v_cur !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_CURRENCY: buyer_currency must be a 3-letter ISO code';
  end if;
  if v_cur <> 'USD' and (v_fx is null or v_fx <= 0) then
    raise exception 'FX_RATE_REQUIRED: fx_rate_to_usd is required and must be > 0 when buyer_currency <> USD';
  end if;
  if v_cur = 'USD' and v_fx is not null and v_fx <= 0 then
    raise exception 'INVALID_FX_RATE: fx_rate_to_usd must be > 0';
  end if;

  if v_ext_id is not null then
    select * into v_existing
      from public.store_orders
     where org_id = p_org_id
       and channel = v_channel
       and external_order_id = v_ext_id
     limit 1;
    if v_existing.id is not null then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'store_order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'merchant_status', v_existing.merchant_status,
        'total_cents', v_existing.total_cents
      );
    end if;
  end if;

  v_quote := public.get_dropship_order_quote(
    p_lines,
    v_country,
    v_method,
    v_incoterm,
    v_cur,
    v_fx,
    'order'
  );

  if not coalesce((v_quote ->> 'ok')::boolean, false) then
    return v_quote;
  end if;

  insert into public.store_orders (
    org_id,
    channel,
    external_order_id,
    external_order_name,
    buyer_name,
    buyer_phone,
    shipping_address,
    destination_country,
    buyer_currency,
    fx_rate_to_usd,
    shipping_method,
    incoterm,
    billed_weight_g,
    product_cents,
    processing_cents,
    shipping_cents,
    duties_cents,
    total_cents,
    shipping_rate_card_id,
    fee_version_id,
    duty_rate_version_id,
    payment_state,
    merchant_status,
    staff_stage,
    is_test,
    created_by
  ) values (
    p_org_id,
    v_channel,
    v_ext_id,
    nullif(btrim(coalesce(p_external_order_name, '')), ''),
    btrim(p_buyer_name),
    nullif(btrim(coalesce(p_buyer_phone, '')), ''),
    p_shipping_address,
    v_country,
    v_cur,
    v_fx,
    v_method,
    v_incoterm,
    (v_quote ->> 'billed_weight_g')::int,
    (v_quote ->> 'product_cents')::bigint,
    (v_quote ->> 'processing_cents')::bigint,
    (v_quote ->> 'shipping_cents')::bigint,
    (v_quote ->> 'duties_cents')::bigint,
    (v_quote ->> 'total_cents')::bigint,
    (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid,
    (v_quote -> 'version_ids' ->> 'fee_version_id')::uuid,
    (v_quote -> 'version_ids' ->> 'duty_rate_version_id')::uuid,
    'unpaid',
    'awaiting_payment',
    'unpaid',
    coalesce(p_is_test, false),
    v_uid
  )
  returning id, order_number into v_order_id, v_order_no;

  if (v_quote -> 'version_ids' ->> 'shipping_rate_card_id') is not null then
    update public.shipping_rate_cards
       set used_count = used_count + 1
     where id = (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid;
  end if;

  v_fx_mult := case when v_cur = 'USD' then coalesce(v_fx, 1.0) else v_fx end;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'qty')::int;
    select * into v_var from public.dropship_variants where id = (v_line ->> 'variant_id')::uuid;
    select * into v_prod from public.dropship_products where id = v_var.product_id;

    if v_prod.product_price_cents is not null then
      v_unit_prod := greatest(0, v_prod.product_price_cents + v_var.price_adjust_cents);
    else
      select * into v_route
        from public.dropship_routes r
       where r.product_id = v_prod.id
         and r.destination_country = v_country
         and r.shipping_method = v_method
         and r.is_active
       limit 1;
      v_unit_prod := greatest(0, (v_route.landed_price_cents - v_route.est_shipping_cents - v_route.est_duties_cents) + v_var.price_adjust_cents);
    end if;

    v_buyer_unit := (v_line ->> 'buyer_unit_price_cents')::bigint;
    if (v_line ? 'buyer_paid_cents') and v_line -> 'buyer_paid_cents' <> 'null'::jsonb then
      v_decl_usd := round(((v_line ->> 'buyer_paid_cents')::bigint)::numeric * v_fx_mult)::bigint;
    elsif v_buyer_unit is not null then
      v_decl_usd := round((v_buyer_unit * v_qty::bigint)::numeric * v_fx_mult)::bigint;
    else
      v_decl_usd := v_unit_prod * v_qty::bigint;
    end if;

    insert into public.store_order_items (
      store_order_id,
      product_id,
      variant_id,
      item_id,
      model_no,
      title_snapshot,
      variant_label,
      fulfilment_type,
      qty,
      unit_product_cents,
      line_product_cents,
      buyer_unit_price_cents,
      declared_usd_cents
    ) values (
      v_order_id,
      v_prod.id,
      v_var.id,
      v_var.item_id,
      v_var.model_no,
      v_prod.title,
      nullif(btrim(coalesce(v_line ->> 'variant_label', '')), ''),
      v_prod.fulfilment_type,
      v_qty,
      v_unit_prod,
      v_unit_prod * v_qty::bigint,
      v_buyer_unit,
      v_decl_usd
    );
  end loop;

  perform write_audit(
    'dropship.store_order_created',
    'store_orders',
    v_order_id::text,
    jsonb_build_object('order_number', v_order_no, 'channel', v_channel, 'total_cents', (v_quote ->> 'total_cents')::bigint)
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'store_order_id', v_order_id,
    'order_number', v_order_no,
    'merchant_status', 'awaiting_payment',
    'staff_stage', 'unpaid',
    'quote', v_quote
  );
end $$;

revoke all on function public.create_dropship_store_order(uuid, text, text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, boolean) from public, anon;
grant execute on function public.create_dropship_store_order(uuid, text, text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, boolean) to authenticated, service_role;

create or replace function public.mark_store_order_paid(
  p_store_order_id uuid,
  p_wallet_hold_id uuid default null,
  p_escrow_hold_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and (dropship_can_edit(division_id_of('DS')) or can('finance', 'edit')));
  v_so public.store_orders;
  v_ev_id uuid;
begin
  select * into v_so from public.store_orders where id = p_store_order_id for update;
  if v_so.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if not v_is_staff and v_so.org_id not in (select my_org_ids()) then
    raise exception 'FORBIDDEN';
  end if;
  if v_so.cancelled_at is not null then
    raise exception 'ORDER_CANCELLED';
  end if;

  -- Correction 1: Charging a new (unpaid) store order is blocked with DROPSHIP_PAUSED when merchant is paused or closed;
  -- already-paid/held orders continue processing idempotently.
  if v_so.payment_state = 'unpaid' then
    perform public.assert_dropship_new_activity(v_so.org_id);
  end if;

  update public.store_orders
     set payment_state = case when p_escrow_hold_id is not null or p_wallet_hold_id is not null then 'held' else 'paid' end,
         wallet_hold_id = coalesce(p_wallet_hold_id, wallet_hold_id),
         escrow_hold_id = coalesce(p_escrow_hold_id, escrow_hold_id),
         staff_stage = case when staff_stage = 'unpaid' then 'paid_to_assign' else staff_stage end,
         updated_at = now()
   where id = p_store_order_id;

  v_ev_id := public.emit_dropship_domain_event(
    'store_order.paid',
    'store_order',
    v_so.id,
    'store_order:' || v_so.id::text || ':paid',
    jsonb_build_object('store_order_id', v_so.id, 'order_number', v_so.order_number),
    division_id_of('DS'),
    false
  );

  perform public.process_dropship_domain_events(25);
  select * into v_so from public.store_orders where id = p_store_order_id;

  perform write_audit(
    'dropship.store_order_paid',
    'store_orders',
    v_so.id::text,
    jsonb_build_object(
      'order_number', v_so.order_number,
      'merchant_status', v_so.merchant_status,
      'staff_stage', v_so.staff_stage,
      'hold_reason', v_so.hold_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'store_order_id', v_so.id,
    'event_id', v_ev_id,
    'payment_state', v_so.payment_state,
    'merchant_status', v_so.merchant_status,
    'staff_stage', v_so.staff_stage,
    'hold_reason', v_so.hold_reason
  );
end $$;

revoke all on function public.mark_store_order_paid(uuid, uuid, uuid) from public, anon;
grant execute on function public.mark_store_order_paid(uuid, uuid, uuid) to authenticated, service_role;

-- Enforce approved dropship_seller_profiles before creating a shipping label for any store order (kind = 'store')
create or replace function public.create_store_order_shipment(
  p_store_order_id uuid,
  p_carrier_code text,
  p_service_code text default null,
  p_tracking_no text default null,
  p_weight_kg numeric default null,
  p_rate_cents bigint default null,
  p_status shipment_status default 'label_ready'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.store_orders;
  v_ship public.shipments;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit() or dropship_can_edit(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_so from public.store_orders where id = p_store_order_id for update;
  if v_so.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_so.kind = 'store' and not exists (
    select 1
      from public.dropship_seller_profiles sp
     where sp.org_id = v_so.org_id
       and sp.status = 'approved'
  ) then
    raise exception 'SELLER_PROFILE_NOT_APPROVED: Staff must approve the merchant brand and return address before creating a shipping label.';
  end if;

  insert into public.shipments (
    order_id,
    store_order_id,
    org_id,
    carrier_code,
    service_code,
    tracking_no,
    status,
    weight_kg,
    parcels,
    rate_cents,
    currency,
    division_id,
    is_seed
  ) values (
    null,
    v_so.id,
    v_so.org_id,
    btrim(p_carrier_code),
    nullif(btrim(coalesce(p_service_code, '')), ''),
    nullif(btrim(coalesce(p_tracking_no, '')), ''),
    coalesce(p_status, 'label_ready'::shipment_status),
    coalesce(p_weight_kg, round(coalesce(v_so.billed_weight_g, 500)::numeric / 1000.0, 3)),
    1,
    coalesce(p_rate_cents, v_so.shipping_cents),
    'USD',
    division_id_of('DS'),
    v_so.is_test
  )
  returning * into v_ship;

  perform write_audit(
    'dropship.shipment_created',
    'shipments',
    v_ship.id::text,
    jsonb_build_object('store_order_id', v_so.id, 'shipment_code', v_ship.code, 'status', v_ship.status::text)
  );

  return jsonb_build_object(
    'shipment_id', v_ship.id,
    'code', v_ship.code,
    'tracking_token', v_ship.tracking_token,
    'tracking_no', v_ship.tracking_no,
    'status', v_ship.status::text
  );
end $$;

revoke all on function public.create_store_order_shipment(uuid, text, text, text, numeric, bigint, shipment_status) from public, anon;
grant execute on function public.create_store_order_shipment(uuid, text, text, text, numeric, bigint, shipment_status) to authenticated, service_role;

-- Update Step 3 request & sample RPCs:
--   · create_dropship_product_request, respond_dropship_request_quote ('accept'), create_dropship_sample_order -> assert_dropship_new_activity() (DROPSHIP_PAUSED when paused/closed, DROPSHIP_NOT_ENABLED when never enabled)
--   · list_my_dropship_requests, list_my_dropship_sample_orders -> dropship_merchant_any_org() so paused/closed merchants still view existing requests & sample orders
create or replace function public.create_dropship_product_request(
  p_title text,
  p_product_link text default null,
  p_category text default null,
  p_target_landed_cents bigint default null,
  p_monthly_volume_band text default null,
  p_ship_to_countries text[] default '{}'::text[],
  p_wants_brand boolean default false,
  p_notes text default null,
  p_images text[] default '{}'::text[],
  p_idem text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_link text := nullif(btrim(coalesce(p_product_link, '')), '');
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_band text := nullif(btrim(coalesce(p_monthly_volume_band, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_countries text[];
  v_main_country text;
  v_qty integer;
  v_fee bigint;
  v_details text;
  v_rfq public.rfqs;
begin
  v_org := public.assert_dropship_new_activity();

  if length(v_title) < 2 or length(v_title) > 160 then
    raise exception 'INVALID_TITLE: Enter a product name between 2 and 160 characters.';
  end if;

  if v_link is not null and v_link !~* '^https?://' then
    raise exception 'INVALID_LINK: Product link must start with https:// or http://';
  end if;

  select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}'::text[])
    into v_countries
    from unnest(coalesce(p_ship_to_countries, '{}'::text[])) c
   where upper(btrim(c)) ~ '^[A-Z]{2}$';

  if coalesce(array_length(v_countries, 1), 0) = 0 then
    raise exception 'COUNTRY_REQUIRED: Choose at least one destination country.';
  end if;
  v_main_country := v_countries[1];

  v_qty := case v_band
    when 'Under 50' then 25
    when '50 to 200' then 100
    when '200 to 1,000' then 500
    when 'More than 1,000' then 1000
    else 50
  end;

  v_fee := greatest(0, coalesce(public.current_service_price('dropship_request', 'USD'), 0));

  v_details := array_to_string(
    array_remove(array[
      '[Dropship product request]',
      case when v_cat is not null then 'Category: ' || v_cat end,
      case when v_link is not null then 'Reference link: ' || v_link end,
      case when v_band is not null then 'Expected orders/month: ' || v_band end,
      'Ship to: ' || array_to_string(v_countries, ', '),
      case when coalesce(p_wants_brand, false) then 'Branding requested: Make My Brand (logo & packaging)' end,
      v_notes
    ], null),
    E'\n'
  );

  insert into public.rfqs (
    org_id,
    title,
    details,
    quantity,
    unit,
    destination_country,
    target_price_cents,
    incoterm,
    status,
    fee_minor,
    currency,
    expires_at,
    created_by,
    division_id
  ) values (
    v_org,
    v_title,
    v_details,
    v_qty,
    'pcs',
    v_main_country,
    case when p_target_landed_cents is not null and p_target_landed_cents >= 0 then p_target_landed_cents else null end,
    'DDP',
    'submitted',
    v_fee,
    'USD',
    now() + interval '14 days',
    v_uid,
    division_id_of('SRC')
  )
  returning * into v_rfq;

  insert into public.dropship_product_requests (
    rfq_id,
    org_id,
    product_link,
    category_label,
    monthly_volume_band,
    ship_to_countries,
    wants_brand,
    images
  ) values (
    v_rfq.id,
    v_org,
    v_link,
    v_cat,
    v_band,
    v_countries,
    coalesce(p_wants_brand, false),
    coalesce(p_images, '{}'::text[])
  );

  if v_fee > 0 and setting_bool('wallet_enabled') then
    perform public.wallet_charge(
      v_org,
      v_fee,
      'Dropship product request fee',
      'dropship_request_fees',
      coalesce(nullif(btrim(coalesce(p_idem, '')), ''), 'ds_req:' || v_rfq.id::text),
      'rfq',
      v_rfq.id,
      'USD'
    );
  end if;

  perform public.log_status('rfq', v_rfq.id, null, 'submitted', 'dropship');
  perform public.emit_event('rfq.submitted', 'rfq', v_rfq.id, jsonb_build_object('org_id', v_org, 'source', 'dropship', 'code', v_rfq.code));

  return jsonb_build_object(
    'ok', true,
    'rfq_id', v_rfq.id,
    'rfq_code', v_rfq.code,
    'fee_cents', v_fee
  );
end $$;

revoke all on function public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text) from public, anon;
grant execute on function public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text) to authenticated, service_role;

create or replace function public.list_my_dropship_requests()
returns table (
  rfq_id uuid,
  rfq_code text,
  title text,
  category_label text,
  monthly_volume_band text,
  ship_to_countries text[],
  target_landed_cents bigint,
  wants_brand boolean,
  fee_cents bigint,
  merchant_status text,
  merchant_label text,
  quoted_landed_cents bigint,
  quoted_country text,
  dropship_product_id uuid,
  dropship_model_no text,
  dropship_product_status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_any_org();
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  return query
    select r.id as rfq_id,
           r.code as rfq_code,
           r.title,
           dpr.category_label,
           dpr.monthly_volume_band,
           dpr.ship_to_countries,
           r.target_price_cents as target_landed_cents,
           dpr.wants_brand,
           r.fee_minor as fee_cents,
           coalesce(sm.merchant_status, r.status::text) as merchant_status,
           coalesce(sm.merchant_label, initcap(r.status::text)) as merchant_label,
           dpr.quoted_landed_cents,
           dpr.quoted_country::text,
           dp.id as dropship_product_id,
           dp.model_no as dropship_model_no,
           dp.status as dropship_product_status,
           r.created_at
      from public.dropship_product_requests dpr
      join public.rfqs r on r.id = dpr.rfq_id
      left join public.status_mappings sm
        on sm.source_domain = 'sourcing_rfq'
       and sm.source_status = r.status::text
       and sm.target = 'request'
      left join lateral (
        select p.id, p.model_no, p.status
          from public.dropship_products p
         where (p.id = dpr.created_dropship_product_id or p.sourced_from_rfq_id = r.id)
           and p.visible_to_org_id = v_org
         order by (p.status = 'active') desc, p.created_at desc
         limit 1
      ) dp on true
     where dpr.org_id = v_org
     order by r.created_at desc, r.id desc;
end $$;

revoke all on function public.list_my_dropship_requests() from public, anon;
grant execute on function public.list_my_dropship_requests() to authenticated, service_role;

create or replace function public.respond_dropship_request_quote(
  p_rfq_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_act text := lower(btrim(coalesce(p_action, '')));
  v_org uuid;
  v_rfq public.rfqs;
  v_dpr public.dropship_product_requests;
  v_dp public.dropship_products;
  v_saved_claims text;
begin
  if v_act not in ('accept', 'decline') then
    -- Still enforce access gate first when caller is not enabled/paused
    v_org := public.assert_dropship_new_activity();
    raise exception 'INVALID_ACTION';
  end if;

  if v_act = 'accept' then
    v_org := public.assert_dropship_new_activity();
  else
    v_org := public.dropship_merchant_any_org();
    if v_uid is null or v_org is null then
      raise exception 'DROPSHIP_NOT_ENABLED';
    end if;
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id and org_id = v_org for update;
  if v_rfq.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_dpr from public.dropship_product_requests where rfq_id = p_rfq_id and org_id = v_org for update;
  if v_dpr.rfq_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_rfq.status <> 'quoted'::rfq_status then
    raise exception 'INVALID_STATE: Only quoted requests can be accepted or declined.';
  end if;

  if v_act = 'decline' then
    update public.rfqs set status = 'cancelled'::rfq_status, updated_at = now() where id = p_rfq_id;
    perform public.log_status('rfq', p_rfq_id, 'quoted', 'cancelled', 'dropship_merchant');
    return jsonb_build_object('ok', true, 'rfq_id', p_rfq_id, 'rfq_code', v_rfq.code, 'action', 'declined');
  end if;

  update public.rfqs set status = 'accepted'::rfq_status, updated_at = now() where id = p_rfq_id;
  perform public.log_status('rfq', p_rfq_id, 'quoted', 'accepted', 'dropship_merchant');

  select *
    into v_dp
    from public.dropship_products p
   where (p.id = v_dpr.created_dropship_product_id or p.sourced_from_rfq_id = v_rfq.id)
     and p.visible_to_org_id = v_org
   limit 1;

  if v_dp.id is null then
    v_saved_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims', '', true);
    begin
      insert into public.dropship_products (
        octopus_sku,
        title,
        description,
        category,
        images,
        source_type,
        fulfilment_type,
        visible_to_org_id,
        sourced_from_rfq_id,
        status,
        created_by
      ) values (
        'DS-REQ-' || replace(gen_random_uuid()::text, '-', ''),
        v_rfq.title,
        null,
        v_dpr.category_label,
        coalesce(v_dpr.images, '{}'::text[]),
        'partner_supplier',
        'extended_catalog',
        v_org,
        v_rfq.id,
        'draft',
        v_uid
      )
      returning * into v_dp;

      insert into public.dropship_variants (product_id, options, sort)
      values (v_dp.id, '{}'::jsonb, 0);
    exception when others then
      perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
      raise;
    end;
    perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);

    update public.dropship_product_requests
       set created_dropship_product_id = v_dp.id,
           updated_at = now()
     where rfq_id = p_rfq_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rfq_id', p_rfq_id,
    'rfq_code', v_rfq.code,
    'action', 'accepted',
    'dropship_product_id', v_dp.id,
    'dropship_model_no', v_dp.model_no
  );
end $$;

revoke all on function public.respond_dropship_request_quote(uuid, text) from public, anon;
grant execute on function public.respond_dropship_request_quote(uuid, text) to authenticated, service_role;

create or replace function public.create_dropship_sample_order(
  p_variant_id uuid,
  p_qty integer,
  p_destination_country text,
  p_shipping_method text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address jsonb,
  p_idempotency_key text,
  p_incoterm text default null,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_country char(2) := upper(btrim(coalesce(p_destination_country, '')))::char(2);
  v_method text := lower(btrim(coalesce(p_shipping_method, '')));
  v_idem text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_route public.dropship_routes;
  v_incoterm text;
  v_existing public.store_orders;
  v_lines jsonb;
  v_quote jsonb;
  v_total_cents bigint;
  v_cash_balance bigint;
  v_spendable_cash bigint;
  v_unit_prod bigint;
  v_var_label text;
  v_order_id uuid;
  v_order_no text;
  v_journal_id uuid;
begin
  v_org := public.assert_dropship_new_activity();

  if p_qty is null or p_qty < 1 or p_qty > 3 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_SAMPLE_QTY',
      'message', 'Sample quantity must be between 1 and 3 per product.'
    );
  end if;

  if btrim(coalesce(p_buyer_name, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'BUYER_NAME_REQUIRED', 'message', 'Enter the recipient full name.');
  end if;

  if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'ADDRESS_REQUIRED', 'message', 'Enter a shipping address.');
  end if;

  if v_idem is null then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'Missing idempotency key.');
  end if;

  perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || v_org::text, 'USD')));

  select *
    into v_existing
    from public.store_orders
   where org_id = v_org
     and kind = 'sample'
     and channel = 'manual'
     and external_order_id = v_idem
   limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'store_order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'kind', v_existing.kind,
      'merchant_status', v_existing.merchant_status,
      'payment_state', v_existing.payment_state,
      'total_cents', v_existing.total_cents
    );
  end if;

  select * into v_var from public.dropship_variants where id = p_variant_id;
  if v_var.id is null then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'Selected variant not found.');
  end if;

  select * into v_prod from public.dropship_products where id = v_var.product_id;
  if v_prod.id is null
     or v_prod.status <> 'active'
     or (v_prod.visible_to_org_id is not null and v_prod.visible_to_org_id <> v_org)
     or not public.dropship_product_supplier_eligible(v_prod) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_AVAILABLE', 'message', 'This product is not available.');
  end if;

  select *
    into v_route
    from public.dropship_routes r
   where r.product_id = v_prod.id
     and r.destination_country = v_country
     and r.shipping_method = v_method
     and r.is_active
   limit 1;

  if v_route.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_ROUTE', 'message', 'No active shipping route for this country and method.');
  end if;

  v_incoterm := upper(btrim(coalesce(nullif(btrim(coalesce(p_incoterm, '')), ''), v_route.incoterm, 'DDP')));

  v_lines := jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'qty', p_qty));
  v_quote := public.get_dropship_order_quote(
    v_lines,
    v_country,
    v_method,
    v_incoterm,
    'USD',
    null,
    'order'
  );

  if not coalesce((v_quote ->> 'ok')::boolean, false) then
    return v_quote;
  end if;

  if v_incoterm = 'DDP' and (
    coalesce(v_quote ->> 'duties_status', '') = 'not_known_yet'
    or v_quote -> 'duties_cents' is null
    or v_quote -> 'duties_cents' = 'null'::jsonb
    or v_quote -> 'total_cents' is null
    or v_quote -> 'total_cents' = 'null'::jsonb
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'DUTIES_NOT_SET',
      'message', 'Duties for this country aren''t set yet, choose another country or method'
    );
  end if;

  v_total_cents := (v_quote ->> 'total_cents')::bigint;
  v_cash_balance := public.wallet_balance(v_org, 'USD');
  v_spendable_cash := v_cash_balance;

  if v_spendable_cash < v_total_cents then
    return jsonb_build_object(
      'ok', false,
      'code', 'WALLET_INSUFFICIENT',
      'wallet_balance_cents', greatest(0, v_spendable_cash),
      'required_cents', v_total_cents,
      'shortfall_cents', v_total_cents - greatest(0, v_spendable_cash),
      'message', 'Not enough in your wallet'
    );
  end if;

  insert into public.store_orders (
    org_id,
    kind,
    channel,
    external_order_id,
    external_order_name,
    buyer_name,
    buyer_phone,
    shipping_address,
    destination_country,
    buyer_currency,
    fx_rate_to_usd,
    shipping_method,
    incoterm,
    billed_weight_g,
    product_cents,
    processing_cents,
    shipping_cents,
    duties_cents,
    total_cents,
    shipping_rate_card_id,
    fee_version_id,
    duty_rate_version_id,
    payment_state,
    merchant_status,
    staff_stage,
    is_test,
    created_by
  ) values (
    v_org,
    'sample',
    'manual',
    v_idem,
    'SAMPLE · ' || v_prod.model_no,
    btrim(p_buyer_name),
    nullif(btrim(coalesce(p_buyer_phone, '')), ''),
    p_shipping_address,
    v_country,
    'USD',
    null,
    v_method,
    v_incoterm,
    (v_quote ->> 'billed_weight_g')::int,
    (v_quote ->> 'product_cents')::bigint,
    (v_quote ->> 'processing_cents')::bigint,
    (v_quote ->> 'shipping_cents')::bigint,
    (v_quote ->> 'duties_cents')::bigint,
    v_total_cents,
    (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid,
    (v_quote -> 'version_ids' ->> 'fee_version_id')::uuid,
    (v_quote -> 'version_ids' ->> 'duty_rate_version_id')::uuid,
    'paid',
    'processing',
    'paid_to_assign',
    coalesce(p_is_test, false),
    v_uid
  )
  returning id, order_number into v_order_id, v_order_no;

  if (v_quote -> 'version_ids' ->> 'shipping_rate_card_id') is not null then
    update public.shipping_rate_cards
       set used_count = used_count + 1
     where id = (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid;
  end if;

  v_unit_prod := ((v_quote ->> 'product_cents')::bigint / p_qty::bigint);
  select string_agg(value, ' / ')
    into v_var_label
    from jsonb_each_text(coalesce(v_var.options, '{}'::jsonb));

  insert into public.store_order_items (
    store_order_id,
    product_id,
    variant_id,
    item_id,
    model_no,
    title_snapshot,
    variant_label,
    fulfilment_type,
    qty,
    unit_product_cents,
    line_product_cents,
    buyer_unit_price_cents,
    declared_usd_cents
  ) values (
    v_order_id,
    v_prod.id,
    v_var.id,
    v_var.item_id,
    v_var.model_no,
    v_prod.title,
    v_var_label,
    v_prod.fulfilment_type,
    p_qty,
    v_unit_prod,
    (v_quote ->> 'product_cents')::bigint,
    v_unit_prod,
    (v_quote ->> 'product_cents')::bigint
  );

  if v_total_cents > 0 then
    v_journal_id := public.post_journal(
      'Dropship sample order ' || v_order_no,
      jsonb_build_array(
        jsonb_build_object('account', public.wallet_account(v_org, 'USD'), 'debit', v_total_cents, 'credit', 0, 'org', v_org),
        jsonb_build_object('account', public.revenue_account('dropship_samples', 'USD'), 'debit', 0, 'credit', v_total_cents)
      ),
      'dropship_sample:' || v_order_id::text,
      'dropship',
      'store_order',
      v_order_id
    );
  end if;

  perform public.emit_dropship_domain_event(
    'store_order.paid',
    'store_order',
    v_order_id,
    'store_order:' || v_order_id::text || ':paid',
    jsonb_build_object('store_order_id', v_order_id, 'order_number', v_order_no, 'kind', 'sample'),
    division_id_of('DS'),
    false
  );
  perform public.process_dropship_domain_events(25);

  select * into v_existing from public.store_orders where id = v_order_id;

  perform write_audit(
    'dropship.sample_order_paid',
    'store_orders',
    v_order_id::text,
    jsonb_build_object(
      'order_number', v_order_no,
      'kind', 'sample',
      'total_cents', v_total_cents,
      'journal_id', v_journal_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'store_order_id', v_order_id,
    'order_number', v_order_no,
    'kind', 'sample',
    'payment_state', v_existing.payment_state,
    'merchant_status', v_existing.merchant_status,
    'total_cents', v_total_cents,
    'quote', v_quote
  );
end $$;

revoke all on function public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean) from public, anon;
grant execute on function public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean) to authenticated, service_role;

create or replace function public.list_my_dropship_sample_orders(
  p_product_id uuid default null
)
returns table (
  store_order_id uuid,
  order_number text,
  product_id uuid,
  variant_id uuid,
  model_no text,
  title_snapshot text,
  variant_label text,
  qty integer,
  destination_country text,
  shipping_method text,
  incoterm text,
  product_cents bigint,
  processing_cents bigint,
  shipping_cents bigint,
  duties_cents bigint,
  total_cents bigint,
  merchant_status text,
  tracking_no text,
  created_at timestamptz,
  delivered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_any_org();
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  return query
    select so.id as store_order_id,
           so.order_number,
           soi.product_id,
           soi.variant_id,
           soi.model_no,
           soi.title_snapshot,
           soi.variant_label,
           soi.qty,
           so.destination_country::text,
           so.shipping_method,
           so.incoterm,
           so.product_cents,
           so.processing_cents,
           so.shipping_cents,
           so.duties_cents,
           so.total_cents,
           so.merchant_status,
           sh.tracking_no,
           so.created_at,
           so.delivered_at
      from public.store_orders so
      join public.store_order_items soi on soi.store_order_id = so.id
      left join lateral (
        select s.tracking_no
          from public.shipments s
         where s.store_order_id = so.id
         order by s.created_at desc
         limit 1
      ) sh on true
     where so.org_id = v_org
       and so.kind = 'sample'
       and (p_product_id is null or soi.product_id = p_product_id)
     order by so.created_at desc, so.id desc
     limit 25;
end $$;

revoke all on function public.list_my_dropship_sample_orders(uuid) from public, anon;
grant execute on function public.list_my_dropship_sample_orders(uuid) to authenticated, service_role;

-- ───────── 7. Step 4 Merchant & Staff RPCs (Activate, Onboarding, StaffMerchants) ─────────
create or replace function public.get_my_dropship_access_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org public.organizations;
  v_cs public.company_services;
  v_req public.dropship_access_requests;
  v_saas public.saas_billing_settings;
  v_supported jsonb;
begin
  if v_uid is null or user_is_staff(v_uid) then
    return null;
  end if;
  if exists (select 1 from public.user_roles where user_id = v_uid and role_code = 'supplier')
     or exists (select 1 from public.suppliers where user_id = v_uid) then
    return null;
  end if;

  select o.*
    into v_org
    from public.org_members m
    join public.organizations o on o.id = m.org_id and o.archived_at is null
   where m.user_id = v_uid
   order by m.created_at asc
   limit 1;

  if v_org.id is null then
    return null;
  end if;

  select * into v_cs from public.company_services where org_id = v_org.id and service = 'dropship';
  select * into v_req from public.dropship_access_requests where org_id = v_org.id order by created_at desc limit 1;
  select * into v_saas from public.saas_billing_settings where id = 1;

  select coalesce(
           (select value from public.site_settings where key = 'dropship.supported_countries'),
           '["AE","SA","GB","US","DE","FR","NL","AU","CA","SG","KW","QA","BH","OM"]'::jsonb
         )
    into v_supported;

  return jsonb_build_object(
    'org_id', v_org.id,
    'org_name', v_org.name,
    'org_country', v_org.country,
    'kyc_status', v_org.kyc_status::text,
    'dropship_status', coalesce(v_cs.status, 'off'),
    'ever_enabled', (v_cs.started_at is not null),
    'status_reason', v_cs.status_reason,
    'supported_countries', v_supported,
    'saas_billing', jsonb_build_object(
      'enabled', coalesce(v_saas.enabled, false),
      'trial_days', coalesce(v_saas.trial_days, 30),
      'grace_days', coalesce(v_saas.grace_days, 7)
    ),
    'latest_request', case
      when v_req.id is null then null
      else jsonb_build_object(
        'id', v_req.id,
        'store_platform', v_req.store_platform,
        'store_address', v_req.store_address,
        'expected_orders_band', v_req.expected_orders_band,
        'countries', to_jsonb(v_req.countries),
        'status', v_req.status,
        'decision_reason', v_req.decision_reason,
        'created_at', v_req.created_at,
        'decided_at', v_req.decided_at
      )
    end
  );
end $$;
revoke all on function public.get_my_dropship_access_state() from public, anon;
grant execute on function public.get_my_dropship_access_state() to authenticated, service_role;

create or replace function public.request_dropship_access(
  p_store_platform text default 'shopify',
  p_store_address text default null,
  p_expected_orders_band text default 'Under 100',
  p_countries text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org public.organizations;
  v_cs public.company_services;
  v_platform text := lower(btrim(coalesce(p_store_platform, 'shopify')));
  v_addr text := nullif(btrim(coalesce(p_store_address, '')), '');
  v_band text := coalesce(nullif(btrim(coalesce(p_expected_orders_band, '')), ''), 'Under 100');
  v_supported text[];
  v_clean text[];
  v_req public.dropship_access_requests;
  v_am uuid;
  c text;
begin
  if v_uid is null or user_is_staff(v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if exists (select 1 from public.user_roles where user_id = v_uid and role_code = 'supplier')
     or exists (select 1 from public.suppliers where user_id = v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select o.*
    into v_org
    from public.org_members m
    join public.organizations o on o.id = m.org_id and o.archived_at is null
   where m.user_id = v_uid
   order by m.created_at asc
   limit 1;

  if v_org.id is null then
    raise exception 'NO_ORG';
  end if;

  -- Step 4 Rule: Only KYC-verified orgs can request access; nothing auto-approves!
  if v_org.kyc_status <> 'verified'::kyc_status then
    raise exception 'KYC_NOT_VERIFIED: Verify your company first before requesting Dropshipping access.';
  end if;

  select * into v_cs from public.company_services where org_id = v_org.id and service = 'dropship';
  if v_cs.status = 'on' then
    raise exception 'ALREADY_ENABLED: Dropshipping is already switched on for your company.';
  end if;

  if v_platform not in ('shopify', 'woocommerce', 'wix') then
    raise exception 'INVALID_PLATFORM';
  end if;

  select coalesce(array_agg(upper(x)), array['AE','SA','GB','US','DE','FR','NL','AU','CA','SG','KW','QA','BH','OM'])
    into v_supported
    from jsonb_array_elements_text(
      coalesce((select value from public.site_settings where key = 'dropship.supported_countries'), '["AE","SA","GB","US","DE","FR","NL","AU","CA","SG","KW","QA","BH","OM"]'::jsonb)
    ) x;

  select coalesce(array_agg(distinct upper(btrim(x)) order by upper(btrim(x))), '{}'::text[])
    into v_clean
    from unnest(coalesce(p_countries, '{}'::text[])) x
   where btrim(x) <> '';

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    raise exception 'COUNTRY_REQUIRED: Choose at least one selling country.';
  end if;

  foreach c in array v_clean loop
    if c !~ '^[A-Z]{2}$' or not (c = any(v_supported)) then
      raise exception 'MARKET_UNSUPPORTED: % is not in the supported Dropshipping countries list', c;
    end if;
  end loop;

  select * into v_req from public.dropship_access_requests where org_id = v_org.id and status = 'pending' for update;
  if v_req.id is not null then
    update public.dropship_access_requests
       set store_platform = v_platform,
           store_address = v_addr,
           expected_orders_band = v_band,
           countries = v_clean,
           requested_by = v_uid,
           updated_at = now()
     where id = v_req.id
    returning * into v_req;
  else
    insert into public.dropship_access_requests (
      org_id,
      division_id,
      store_platform,
      store_address,
      expected_orders_band,
      countries,
      status,
      requested_by
    ) values (
      v_org.id,
      division_id_of('DS'),
      v_platform,
      v_addr,
      v_band,
      v_clean,
      'pending',
      v_uid
    )
    returning * into v_req;
  end if;

  perform write_audit(
    'dropship.access_requested',
    'dropship_access_requests',
    v_req.id::text,
    jsonb_build_object(
      'org_id', v_org.id,
      'store_platform', v_platform,
      'store_address', v_addr,
      'expected_orders_band', v_band,
      'countries', to_jsonb(v_clean)
    )
  );

  -- In-app notification to assigned account manager (if any); never sends email
  select am.staff_user_id into v_am from public.account_managers am where am.org_id = v_org.id limit 1;
  if v_am is not null then
    insert into public.notifications (user_id, division_id, service, title, body, link)
    values (
      v_am,
      division_id_of('DS'),
      'dropship',
      'New Dropshipping access request · ' || v_org.name,
      v_org.name || ' requested Dropshipping access (' || array_to_string(v_clean, ', ') || ').',
      '/office/dropship/merchants'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_req.id,
    'status', v_req.status,
    'countries', to_jsonb(v_req.countries)
  );
end $$;
revoke all on function public.request_dropship_access(text, text, text, text[]) from public, anon;
grant execute on function public.request_dropship_access(text, text, text, text[]) to authenticated, service_role;

create or replace function public.get_my_dropship_onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid := dropship_merchant_any_org();
  v_org public.organizations;
  v_cs public.company_services;
  v_prof public.dropship_seller_profiles;
  v_saas public.saas_billing_settings;
  v_req public.dropship_access_requests;
  v_supported jsonb;
  v_markets jsonb;
begin
  if v_uid is null or v_org_id is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  select * into v_org from public.organizations where id = v_org_id;
  select * into v_cs from public.company_services where org_id = v_org_id and service = 'dropship';
  select * into v_prof from public.dropship_seller_profiles where org_id = v_org_id;
  select * into v_saas from public.saas_billing_settings where id = 1;
  select * into v_req from public.dropship_access_requests where org_id = v_org_id order by created_at desc limit 1;

  select coalesce(
           (select value from public.site_settings where key = 'dropship.supported_countries'),
           '["AE","SA","GB","US","DE","FR","NL","AU","CA","SG","KW","QA","BH","OM"]'::jsonb
         )
    into v_supported;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('country', m.country::text, 'locked_by_staff', m.locked_by_staff)
             order by m.country
           ),
           '[]'::jsonb
         )
    into v_markets
    from public.dropship_markets m
   where m.org_id = v_org_id;

  return jsonb_build_object(
    'org_id', v_org.id,
    'org_name', v_org.name,
    'org_country', v_org.country,
    'kyc_status', v_org.kyc_status::text,
    'dropship_status', coalesce(v_cs.status, 'off'),
    'status_reason', v_cs.status_reason,
    'supported_countries', v_supported,
    'markets', v_markets,
    'wallet_balance_cents', public.wallet_balance(v_org_id, 'USD'),
    'saas_billing', jsonb_build_object(
      'enabled', coalesce(v_saas.enabled, false),
      'trial_days', coalesce(v_saas.trial_days, 30),
      'grace_days', coalesce(v_saas.grace_days, 7)
    ),
    'seller_profile', case
      when v_prof.org_id is null then null
      else jsonb_build_object(
        'brand_name', v_prof.brand_name,
        'return_name', v_prof.return_name,
        'return_line1', v_prof.return_line1,
        'return_line2', v_prof.return_line2,
        'return_city', v_prof.return_city,
        'return_region', v_prof.return_region,
        'return_postal_code', v_prof.return_postal_code,
        'return_country', v_prof.return_country,
        'status', v_prof.status,
        'customer_message', v_prof.customer_message,
        'reviewed_at', v_prof.reviewed_at,
        'updated_at', v_prof.updated_at
      )
    end,
    'store_address_hint', v_req.store_address
  );
end $$;
revoke all on function public.get_my_dropship_onboarding_state() from public, anon;
grant execute on function public.get_my_dropship_onboarding_state() to authenticated, service_role;

create or replace function public.save_my_dropship_seller_profile(
  p_brand_name text,
  p_return_name text,
  p_return_line1 text,
  p_return_line2 text default null,
  p_return_city text default '',
  p_return_region text default null,
  p_return_postal_code text default null,
  p_return_country text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.assert_dropship_new_activity();
  v_brand text := btrim(coalesce(p_brand_name, ''));
  v_rname text := btrim(coalesce(p_return_name, ''));
  v_rline1 text := btrim(coalesce(p_return_line1, ''));
  v_rline2 text := nullif(btrim(coalesce(p_return_line2, '')), '');
  v_rcity text := btrim(coalesce(p_return_city, ''));
  v_rreg text := nullif(btrim(coalesce(p_return_region, '')), '');
  v_rpost text := nullif(btrim(coalesce(p_return_postal_code, '')), '');
  v_rcountry text := btrim(coalesce(p_return_country, ''));
  v_prof public.dropship_seller_profiles;
begin
  if v_brand = '' or length(v_brand) > 80 then
    raise exception 'INVALID_BRAND_NAME: Enter a brand name up to 80 characters.';
  end if;
  if v_rname = '' or v_rline1 = '' or v_rcity = '' or v_rcountry = '' then
    raise exception 'INVALID_RETURN_ADDRESS: Fill in return contact name, street line 1, city and country.';
  end if;

  insert into public.dropship_seller_profiles (
    org_id,
    division_id,
    brand_name,
    return_name,
    return_line1,
    return_line2,
    return_city,
    return_region,
    return_postal_code,
    return_country,
    status,
    customer_message
  ) values (
    v_org,
    division_id_of('DS'),
    v_brand,
    v_rname,
    v_rline1,
    v_rline2,
    v_rcity,
    v_rreg,
    v_rpost,
    v_rcountry,
    'pending',
    null
  )
  on conflict (org_id) do update
    set brand_name = excluded.brand_name,
        return_name = excluded.return_name,
        return_line1 = excluded.return_line1,
        return_line2 = excluded.return_line2,
        return_city = excluded.return_city,
        return_region = excluded.return_region,
        return_postal_code = excluded.return_postal_code,
        return_country = excluded.return_country,
        customer_message = case
          when (
            public.dropship_seller_profiles.brand_name,
            public.dropship_seller_profiles.return_name,
            public.dropship_seller_profiles.return_line1,
            public.dropship_seller_profiles.return_line2,
            public.dropship_seller_profiles.return_city,
            public.dropship_seller_profiles.return_region,
            public.dropship_seller_profiles.return_postal_code,
            public.dropship_seller_profiles.return_country
          ) is distinct from (
            excluded.brand_name,
            excluded.return_name,
            excluded.return_line1,
            excluded.return_line2,
            excluded.return_city,
            excluded.return_region,
            excluded.return_postal_code,
            excluded.return_country
          ) then null
          else public.dropship_seller_profiles.customer_message
        end
  returning * into v_prof;

  perform write_audit(
    'dropship.seller_profile_saved',
    'dropship_seller_profiles',
    v_org::text,
    jsonb_build_object('brand_name', v_prof.brand_name, 'return_country', v_prof.return_country, 'status', v_prof.status)
  );

  return jsonb_build_object(
    'ok', true,
    'org_id', v_prof.org_id,
    'status', v_prof.status
  );
end $$;
revoke all on function public.save_my_dropship_seller_profile(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_my_dropship_seller_profile(text, text, text, text, text, text, text, text) to authenticated, service_role;

create or replace function public.decide_dropship_access_request(
  p_request_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dec text := lower(btrim(coalesce(p_decision, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_req public.dropship_access_requests;
  v_org public.organizations;
  v_old_cs public.company_services;
  v_locked boolean;
  c text;
begin
  if v_reason is null then
    raise exception 'REASON_REQUIRED: Enter a reason for this decision.';
  end if;
  if v_dec not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_req from public.dropship_access_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (
    v_uid is not null
    and is_staff()
    and staff_aal_ok()
    and not distributor_restricted()
    and (dropship_can_edit(division_id_of('DS')) or is_my_customer(v_req.org_id))
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'ALREADY_DECIDED: Request is already %', v_req.status;
  end if;

  select * into v_org from public.organizations where id = v_req.org_id;
  if v_org.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_old_cs from public.company_services where org_id = v_req.org_id and service = 'dropship' for update;

  if v_dec = 'approve' then
    if v_org.kyc_status <> 'verified'::kyc_status then
      raise exception 'KYC_NOT_VERIFIED: Company KYC must be verified before approving Dropshipping access.';
    end if;

    update public.dropship_access_requests
       set status = 'approved',
           decided_by = v_uid,
           decided_at = now(),
           decision_reason = v_reason,
           updated_at = now()
     where id = p_request_id;

    insert into public.company_services (
      org_id,
      service,
      status,
      status_reason,
      started_at,
      ended_at,
      updated_by,
      updated_at,
      division_id
    ) values (
      v_req.org_id,
      'dropship',
      'on',
      v_reason,
      now(),
      null,
      v_uid,
      now(),
      division_id_of('DS')
    )
    on conflict (org_id, service) do update
      set status = 'on',
          status_reason = excluded.status_reason,
          started_at = coalesce(public.company_services.started_at, now()),
          ended_at = null,
          updated_by = excluded.updated_by,
          updated_at = now();

    select coalesce(bool_or(locked_by_staff), false)
      into v_locked
      from public.dropship_markets
     where org_id = v_req.org_id;

    if not v_locked and coalesce(array_length(v_req.countries, 1), 0) > 0 then
      foreach c in array v_req.countries loop
        insert into public.dropship_markets (org_id, country, locked_by_staff, updated_by)
        values (v_req.org_id, upper(btrim(c))::char(2), false, v_uid)
        on conflict (org_id, country) do nothing;
      end loop;
    end if;

    insert into public.notifications (org_id, division_id, service, title, body, link)
    values (
      v_req.org_id,
      division_id_of('DS'),
      'dropship',
      'Dropshipping is switched on',
      'Your request was approved (' || v_reason || '). Finish onboarding to set your return address and selling countries.',
      '/account/dropship/onboarding'
    );

    insert into public.audit_log (
      actor_id,
      actor_kind,
      action,
      entity,
      entity_id,
      org_id,
      service,
      before,
      after,
      details,
      division_id
    ) values (
      v_uid,
      'staff',
      'dropship.access_approved',
      'dropship_access_requests',
      v_req.id::text,
      v_req.org_id,
      'dropship',
      jsonb_build_object('request_status', v_req.status, 'service_status', coalesce(v_old_cs.status, 'off')),
      jsonb_build_object('request_status', 'approved', 'service_status', 'on', 'reason', v_reason),
      jsonb_build_object('reason', v_reason, 'countries', to_jsonb(v_req.countries)),
      division_id_of('DS')
    );

    return jsonb_build_object('ok', true, 'request_id', v_req.id, 'org_id', v_req.org_id, 'status', 'approved', 'service_status', 'on');
  else
    update public.dropship_access_requests
       set status = 'rejected',
           decided_by = v_uid,
           decided_at = now(),
           decision_reason = v_reason,
           updated_at = now()
     where id = p_request_id;

    insert into public.company_services (
      org_id,
      service,
      status,
      status_reason,
      started_at,
      ended_at,
      updated_by,
      updated_at,
      division_id
    ) values (
      v_req.org_id,
      'dropship',
      'off',
      v_reason,
      null,
      null,
      v_uid,
      now(),
      division_id_of('DS')
    )
    on conflict (org_id, service) do update
      set status = 'off',
          status_reason = excluded.status_reason,
          ended_at = case when public.company_services.started_at is not null then now() else null end,
          updated_by = excluded.updated_by,
          updated_at = now();

    insert into public.notifications (org_id, division_id, service, title, body, link)
    values (
      v_req.org_id,
      division_id_of('DS'),
      'dropship',
      'Dropshipping access request declined',
      v_reason,
      '/account/dropship'
    );

    insert into public.audit_log (
      actor_id,
      actor_kind,
      action,
      entity,
      entity_id,
      org_id,
      service,
      before,
      after,
      details,
      division_id
    ) values (
      v_uid,
      'staff',
      'dropship.access_rejected',
      'dropship_access_requests',
      v_req.id::text,
      v_req.org_id,
      'dropship',
      jsonb_build_object('request_status', v_req.status, 'service_status', coalesce(v_old_cs.status, 'off')),
      jsonb_build_object('request_status', 'rejected', 'service_status', 'off', 'reason', v_reason),
      jsonb_build_object('reason', v_reason),
      division_id_of('DS')
    );

    return jsonb_build_object('ok', true, 'request_id', v_req.id, 'org_id', v_req.org_id, 'status', 'rejected', 'service_status', 'off');
  end if;
end $$;
revoke all on function public.decide_dropship_access_request(uuid, text, text) from public, anon;
grant execute on function public.decide_dropship_access_request(uuid, text, text) to authenticated, service_role;

create or replace function public.set_dropship_merchant_status(
  p_org_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_org public.organizations;
  v_old public.company_services;
begin
  if v_reason is null then
    raise exception 'REASON_REQUIRED: Enter a reason for changing merchant status.';
  end if;
  if v_status not in ('on', 'paused', 'off') then
    raise exception 'INVALID_STATUS: Dropship status must be on, paused, or off.';
  end if;

  select * into v_org from public.organizations where id = p_org_id;
  if v_org.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (
    v_uid is not null
    and is_staff()
    and staff_aal_ok()
    and not distributor_restricted()
    and (dropship_can_edit(division_id_of('DS')) or is_my_customer(p_org_id))
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status = 'on' and v_org.kyc_status <> 'verified'::kyc_status then
    raise exception 'KYC_NOT_VERIFIED: Company KYC must be verified before activating Dropshipping.';
  end if;

  select * into v_old from public.company_services where org_id = p_org_id and service = 'dropship' for update;

  insert into public.company_services (
    org_id,
    service,
    status,
    status_reason,
    started_at,
    ended_at,
    updated_by,
    updated_at,
    division_id
  ) values (
    p_org_id,
    'dropship',
    v_status,
    v_reason,
    case when v_status = 'on' then now() else null end,
    case when v_status = 'off' then now() else null end,
    v_uid,
    now(),
    division_id_of('DS')
  )
  on conflict (org_id, service) do update
    set status = excluded.status,
        status_reason = excluded.status_reason,
        started_at = case
          when excluded.status = 'on' then coalesce(public.company_services.started_at, now())
          else public.company_services.started_at
        end,
        ended_at = case
          when excluded.status = 'off' then now()
          else null
        end,
        updated_by = excluded.updated_by,
        updated_at = now();

  insert into public.notifications (org_id, division_id, service, title, body, link)
  values (
    p_org_id,
    division_id_of('DS'),
    'dropship',
    case v_status
      when 'on' then 'Dropshipping is active'
      when 'paused' then 'Dropshipping is paused'
      else 'Dropshipping account closed'
    end,
    v_reason,
    '/account/dropship'
  );

  insert into public.audit_log (
    actor_id,
    actor_kind,
    action,
    entity,
    entity_id,
    org_id,
    service,
    before,
    after,
    details,
    division_id
  ) values (
    v_uid,
    'staff',
    'dropship.merchant_status_changed',
    'company_services',
    p_org_id::text || ':dropship',
    p_org_id,
    'dropship',
    case when v_old.org_id is null then null else jsonb_build_object('status', v_old.status, 'reason', v_old.status_reason) end,
    jsonb_build_object('status', v_status, 'reason', v_reason),
    jsonb_build_object('status', v_status, 'reason', v_reason),
    division_id_of('DS')
  );

  return jsonb_build_object('ok', true, 'org_id', p_org_id, 'status', v_status, 'reason', v_reason);
end $$;
revoke all on function public.set_dropship_merchant_status(uuid, text, text) from public, anon;
grant execute on function public.set_dropship_merchant_status(uuid, text, text) to authenticated, service_role;

create or replace function public.review_dropship_merchant_profile(
  p_org_id uuid,
  p_status text,
  p_reason text,
  p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  v_old public.dropship_seller_profiles;
begin
  if v_reason is null then
    raise exception 'REASON_REQUIRED: Enter a message/reason for this profile decision.';
  end if;
  if v_status not in ('approved', 'rejected') then
    raise exception 'INVALID_STATUS: approved or rejected';
  end if;

  select * into v_old from public.dropship_seller_profiles where org_id = p_org_id for update;
  if v_old.org_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not dropship_can_edit(v_old.division_id) then
    raise exception 'FORBIDDEN';
  end if;

  update public.dropship_seller_profiles
     set status = v_status,
         reviewed_by = v_uid,
         reviewed_at = now(),
         review_note = coalesce(v_note, v_reason),
         customer_message = v_reason
   where org_id = p_org_id;

  insert into public.notifications (org_id, division_id, service, title, body, link)
  values (
    p_org_id,
    division_id_of('DS'),
    'dropship',
    case when v_status = 'approved' then 'Return & brand profile approved' else 'Return & brand profile needs changes' end,
    v_reason,
    '/account/dropship/onboarding'
  );

  insert into public.audit_log (
    actor_id,
    actor_kind,
    action,
    entity,
    entity_id,
    org_id,
    service,
    details,
    division_id
  ) values (
    v_uid,
    'staff',
    'dropship_profile.review',
    'dropship_seller_profiles',
    p_org_id::text,
    p_org_id,
    'dropship',
    jsonb_build_object('from', v_old.status, 'to', v_status, 'brand_name', v_old.brand_name, 'reason', v_reason),
    v_old.division_id
  );

  return jsonb_build_object('ok', true, 'org_id', p_org_id, 'status', v_status);
end $$;
revoke all on function public.review_dropship_merchant_profile(uuid, text, text, text) from public, anon;
grant execute on function public.review_dropship_merchant_profile(uuid, text, text, text) to authenticated, service_role;

create or replace function public.list_dropship_merchants_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_service boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role';
  v_can_see_costs boolean;
  v_saas public.saas_billing_settings;
  v_requests jsonb;
  v_merchants jsonb;
begin
  if not v_is_service then
    if v_uid is null or not is_staff() or not staff_aal_ok() or distributor_restricted() then
      raise exception 'FORBIDDEN';
    end if;
    if not (in_division(division_id_of('DS')) or can('finance', 'view') or can('support', 'view')) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  v_can_see_costs := v_is_service or dropship_can_see_costs(division_id_of('DS'));
  select * into v_saas from public.saas_billing_settings where id = 1;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', r.id,
               'org_id', r.org_id,
               'org_name', o.name,
               'org_country', o.country,
               'kyc_status', o.kyc_status::text,
               'store_platform', r.store_platform,
               'store_address', r.store_address,
               'expected_orders_band', r.expected_orders_band,
               'countries', to_jsonb(r.countries),
               'status', r.status,
               'decision_reason', r.decision_reason,
               'created_at', r.created_at,
               'decided_at', r.decided_at
             )
             order by (r.status = 'pending') desc, r.created_at desc
           ),
           '[]'::jsonb
         )
    into v_requests
    from public.dropship_access_requests r
    join public.organizations o on o.id = r.org_id and o.archived_at is null;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'org_id', o.id,
               'org_name', o.name,
               'org_country', o.country,
               'kyc_status', o.kyc_status::text,
               'credit_eligible', coalesce(o.credit_eligible, false),
               'dropship_status', cs.status,
               'status_reason', cs.status_reason,
               'started_at', cs.started_at,
               'plan_label', case when coalesce(v_saas.enabled, false) then coalesce(cs.plan, 'Starter') else 'Free while plan fees are off' end,
               'stores_count', 0,
               'wallet_cash_cents', public.wallet_balance(o.id, 'USD'),
               'held_cents', (
                 coalesce((
                   select sum(eh.amount_cents)::bigint
                     from public.escrow_holds eh
                    where eh.org_id = o.id
                      and eh.currency = 'USD'
                      and eh.status in ('held', 'disputed', 'partially_released')
                 ), 0)
                 +
                 coalesce((
                   select sum(wh.amount_cents)::bigint
                     from public.wallet_holds wh
                    where wh.org_id = o.id
                      and wh.currency = 'USD'
                      and wh.status = 'open'
                 ), 0)
               ),
               'orders_30d', (
                 select count(*)::int
                   from public.store_orders so
                  where so.org_id = o.id
                    and so.created_at >= now() - interval '30 days'
               ),
               'hold_orders_count', (
                 select count(*)::int
                   from public.store_orders so
                  where so.org_id = o.id
                    and so.staff_stage = 'on_hold'
               ),
               'open_tickets_count', (
                 select count(*)::int
                   from public.tickets t
                  where t.org_id = o.id
                    and t.status not in ('resolved', 'closed')
               ),
               'account_manager_name', (
                 select coalesce(p.full_name, p.email)
                   from public.account_managers am
                   join public.profiles p on p.id = am.staff_user_id
                  where am.org_id = o.id
                  limit 1
               ),
               'markets', coalesce((
                 select jsonb_agg(m.country::text order by m.country)
                   from public.dropship_markets m
                  where m.org_id = o.id
               ), '[]'::jsonb),
               'markets_locked', coalesce((
                 select bool_or(m.locked_by_staff)
                   from public.dropship_markets m
                  where m.org_id = o.id
               ), false),
               'seller_profile', (
                 select jsonb_build_object(
                   'brand_name', sp.brand_name,
                   'return_name', sp.return_name,
                   'return_line1', sp.return_line1,
                   'return_line2', sp.return_line2,
                   'return_city', sp.return_city,
                   'return_region', sp.return_region,
                   'return_postal_code', sp.return_postal_code,
                   'return_country', sp.return_country,
                   'status', sp.status,
                   'customer_message', sp.customer_message,
                   'review_note', case when v_can_see_costs then sp.review_note else null end,
                   'reviewed_at', sp.reviewed_at
                 )
                 from public.dropship_seller_profiles sp
                 where sp.org_id = o.id
               )
             )
             order by (cs.status = 'on') desc, (cs.status = 'paused') desc, o.name asc
           ),
           '[]'::jsonb
         )
    into v_merchants
    from public.company_services cs
    join public.organizations o on o.id = cs.org_id and o.archived_at is null
   where cs.service = 'dropship'
     and (cs.status in ('on', 'paused') or cs.started_at is not null);

  return jsonb_build_object(
    'access_requests', v_requests,
    'merchants', v_merchants,
    'saas_billing', jsonb_build_object(
      'enabled', coalesce(v_saas.enabled, false),
      'trial_days', coalesce(v_saas.trial_days, 30),
      'grace_days', coalesce(v_saas.grace_days, 7)
    ),
    'can_edit', v_is_service or dropship_can_edit(division_id_of('DS')),
    'can_propose_wallet_adjustment', v_is_service or (v_can_see_costs and can('finance', 'create'))
  );
end $$;
revoke all on function public.list_dropship_merchants_staff() from public, anon;
grant execute on function public.list_dropship_merchants_staff() to authenticated, service_role;

-- ── 13. export_my_dropship_data (ongoing merchant data export — allowed while on, paused, or closed) ──
create or replace function public.export_my_dropship_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.dropship_merchant_any_org();
  v_payload jsonb;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED: Dropship is not enabled for your company.';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'organization', (
      select jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'country', o.country,
        'kyc_status', o.kyc_status::text
      )
      from public.organizations o
      where o.id = v_org
    ),
    'service', (
      select jsonb_build_object(
        'status', cs.status,
        'status_reason', cs.status_reason,
        'started_at', cs.started_at,
        'updated_at', cs.updated_at
      )
      from public.company_services cs
      where cs.org_id = v_org and cs.service = 'dropship'
    ),
    'selling_markets', coalesce((
      select jsonb_agg(jsonb_build_object('country', m.country::text, 'locked_by_staff', m.locked_by_staff) order by m.country)
      from public.dropship_markets m
      where m.org_id = v_org
    ), '[]'::jsonb),
    'seller_profile', (
      select jsonb_build_object(
        'brand_name', sp.brand_name,
        'return_name', sp.return_name,
        'return_line1', sp.return_line1,
        'return_line2', sp.return_line2,
        'return_city', sp.return_city,
        'return_region', sp.return_region,
        'return_postal_code', sp.return_postal_code,
        'return_country', sp.return_country,
        'status', sp.status,
        'reviewed_at', sp.reviewed_at
      )
      from public.dropship_seller_profiles sp
      where sp.org_id = v_org
    ),
    'store_orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', so.id,
          'order_number', so.order_number,
          'kind', so.kind,
          'channel', so.channel,
          'external_order_name', so.external_order_name,
          'merchant_status', so.merchant_status,
          'destination_country', so.destination_country,
          'shipping_method', so.shipping_method,
          'incoterm', so.incoterm,
          'total_cents', so.total_cents,
          'created_at', so.created_at
        )
        order by so.created_at desc
      )
      from public.store_orders so
      where so.org_id = v_org
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'number', d.number,
          'doc_type', d.doc_type,
          'amount_cents', d.amount_cents,
          'status', d.status,
          'created_at', d.created_at
        )
        order by d.created_at desc
      )
      from public.documents d
      where d.org_id = v_org
        and (d.number like 'OCT-DS-%' or d.number like 'STMT-DS-%')
    ), '[]'::jsonb),
    'wallet_withdrawals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'amount_cents', w.amount_cents,
          'currency', w.currency,
          'status', w.status::text,
          'created_at', w.created_at
        )
        order by w.created_at desc
      )
      from public.wallet_withdrawals w
      where w.org_id = v_org
    ), '[]'::jsonb)
  ) into v_payload;

  perform public.write_audit(
    'dropship.data_exported',
    'company_services',
    v_org::text,
    jsonb_build_object('org_id', v_org)
  );

  return v_payload;
end $$;
revoke all on function public.export_my_dropship_data() from public, anon;
grant execute on function public.export_my_dropship_data() to authenticated, service_role;
