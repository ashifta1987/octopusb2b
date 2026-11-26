-- DS16 · Owner decisions of 26 Nov 2026 (scratch/owner-decisions-26nov.md §11). DRAFT — installs as the next free number (249 when
-- written). Renumber at install. Every value below is a SETTING (site_settings) or a row in an existing settings table; nothing is
-- hard-coded in TypeScript. Values are seeded only where the owner gave them. Every change is audit-logged.
--
--  1. Turnkey: deposit 30 % (turnkey.deposit_pct), 50 % for custom / branded projects (turnkey.deposit_pct_custom + the new
--     tk_client_projects.custom_branded flag set by Turnkey editors with tk_set_project_custom). tk_send_client_quote freezes the
--     % that applies to the project on the quote. Balance before shipment: T6 already refuses the Shipment phase until the balance
--     invoice is paid (tk_move_project_stage: BALANCE_NOT_INVOICED / BALANCE_NOT_PAID) and shipments are booked only in that phase —
--     nothing to add. Legal entity: "Shenzhen Octopus Trading Co., Ltd." (SZ-OCTOPUS) is already the active default in legal_entities
--     and stamps every document (trg_aa_document_entity) — nothing to add.
--  2. Dropship processing fee US$1.20 + US$0.40: NOT inserted here. fee_versions needs a real proposer (proposed_by NOT NULL) and a
--     different approver (fee_versions_two_person); staff propose it on Dropship staff › Fees and a second person approves (NOTES.md).
--  3. Shipping markup 10 %: setting dropship.shipping_markup_pct. The merchant's shipping line in get_dropship_order_quote (every
--     merchant quote, order, sample, landed cost and packing preview goes through it) = rate-card cost (incl. fuel surcharge) ×
--     (1 + markup %), integer cents, half-up. Rate cards stay at cost. Changing the setting needs a proposal and a DIFFERENT approver
--     (dropship_setting_changes + ds16_markup_*); a trigger refuses any other write to that key (even set_setting by an admin).
--     The re-weigh check uses the markup that applied when the order was placed (history in dropship_setting_changes).
--  4. Launch countries AE, SA, GB, US (dropship_launch_countries). US = DDP, no de minimis: setting dropship.country_duty_rules;
--     the quote charges DDP and ignores any de minimis for those countries; merchants cannot pick DAP for them (trigger).
--     EA-1 already refuses a US duty entry with a de minimis (upsert_duty_rate_entry / activate_duty_rate_version).
--  6. Refund rules (DS10, minimal changes): cancel before packing = full wallet refund, after packing = refused (DS8 rule, unchanged);
--     lost = no tracking movement for dropship.lost_after_days (15) → ds10_claim_open refuses earlier lost claims; damaged / wrong item =
--     photos within dropship.claim_window_days (7) of delivery (existing setting); re-weigh disputes within dropship.reweigh_dispute_days
--     (7) when the fee version has no dispute window; refunds to the wallet (unchanged); refunds above
--     dropship.claim_second_approver_over_cents (100000) need a second, different Finance approver (ds10_approval_limit_cents reads it).
--     Buyer remorse = the merchant's own policy, the merchant pays return shipping: text in dropship.returns.
--  7. Release 6: the partner packing slip carries the merchant's brand only (ds_sup_slip returns the DS12 brand: approved brand name +
--     logo if the merchant shows it on slips; never Octopus, never prices). Two people approve a new supplier application
--     (review_supplier_application + trigger) and every supplier bank-detail change (new supplier_bank_detail_changes; there was no
--     bank-detail store before). Supplier price changes: decreases auto-approved; increases up to price_auto_pct (3) auto-approved and
--     Dropship staff notified, unless the increase over the last 30 days passes price_cum_30d_pct (5); anything else is reviewed
--     (dropship_supplier_rules). Quotes / orders keep their snapshot (store_order_items.unit_product_cents, store_orders.*_cents).
--
-- REPLACED installed functions (the down restores each exact pg_get_functiondef text): get_dropship_order_quote, ds10_reweigh_calc,
-- ds10_claim_open, ds10_approval_limit_cents, ds10_case_refund, ds10_refund_approve, ds_sup_price_change, ds_sup_slip,
-- ds_staff_rules_save, review_supplier_application, tk_send_client_quote, tk_staff_quotes, tk_settings.
-- NEW: tables dropship_setting_changes, supplier_bank_detail_changes, ds16_settings_backup (the down puts every changed setting back
-- from it); columns tk_client_projects.custom_branded, supplier_applications.first_approved_by / first_approved_at; three triggers.
-- Down: supabase/migrations/down/2026110100024Y_ds16_owner_decisions.down.sql

-- ───────────────────────── 0. Settings backup (read by the down) ─────────────────────────
create table if not exists public.ds16_settings_backup (
  key text primary key,
  existed boolean not null,
  row jsonb,
  saved_at timestamptz not null default now()
);
comment on table public.ds16_settings_backup is 'DS16: site_settings rows as they were before migration 249 seeded the owner decisions; the down restores them and drops this table.';
alter table public.ds16_settings_backup enable row level security;
revoke all on public.ds16_settings_backup from public, anon, authenticated;
grant all on public.ds16_settings_backup to service_role;
insert into public.ds16_settings_backup (key, existed, row)
select k, s.key is not null, case when s.key is not null then to_jsonb(s) end
  from unnest(array['turnkey.deposit_pct', 'turnkey.deposit_pct_custom', 'dropship.shipping_markup_pct', 'dropship_launch_countries',
                    'dropship.country_duty_rules', 'dropship.claim_window_days', 'dropship.lost_after_days', 'dropship.reweigh_dispute_days',
                    'dropship.claim_second_approver_over_cents', 'dropship.returns', 'dropship_supplier_rules']) k
  left join public.site_settings s on s.key = k
on conflict (key) do nothing;

-- ───────────────────────── 1. Tables and columns ─────────────────────────
-- Two-person changes of protected settings (today: the shipping markup). The current value lives in site_settings; this is the
-- proposal + decision and the history (the re-weigh check reads the value in force when an order was placed).
create table if not exists public.dropship_setting_changes (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key in ('dropship.shipping_markup_pct')),
  old_value jsonb,
  new_value jsonb not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'seeded')),
  proposed_by uuid references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  constraint dropship_setting_changes_two_person check (status <> 'approved' or (proposed_by is not null and decided_by is not null and decided_by <> proposed_by)),
  constraint dropship_setting_changes_proposer check (status = 'seeded' or proposed_by is not null),
  constraint dropship_setting_changes_decided check (status = 'pending' or decided_at is not null)
);
create unique index if not exists dropship_setting_changes_one_pending on public.dropship_setting_changes (key) where status = 'pending';
create index if not exists dropship_setting_changes_key_idx on public.dropship_setting_changes (key, decided_at desc);
comment on table public.dropship_setting_changes is 'DS16: proposals and decisions for settings that need two people (dropship.shipping_markup_pct). Read and written only through security-definer functions.';
alter table public.dropship_setting_changes enable row level security;
revoke all on public.dropship_setting_changes from public, anon, authenticated;
grant all on public.dropship_setting_changes to service_role;

-- Supplier bank details: every change is a proposal that a second, different person approves. The details in force are the latest
-- approved row. Staff only (suppliers permission); suppliers, merchants and anon have no access.
create table if not exists public.supplier_bank_detail_changes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  details jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  constraint supplier_bank_detail_changes_two_person check (status <> 'approved' or (decided_by is not null and decided_by <> proposed_by)),
  constraint supplier_bank_detail_changes_decided check (status = 'pending' or decided_at is not null)
);
create unique index if not exists supplier_bank_detail_changes_one_pending on public.supplier_bank_detail_changes (supplier_id) where status = 'pending';
create index if not exists supplier_bank_detail_changes_supplier_idx on public.supplier_bank_detail_changes (supplier_id, proposed_at desc);
comment on table public.supplier_bank_detail_changes is 'DS16: supplier bank details — proposals and decisions (two people). The latest approved row is in force. Read and written only through security-definer functions.';
alter table public.supplier_bank_detail_changes enable row level security;
revoke all on public.supplier_bank_detail_changes from public, anon, authenticated;
grant all on public.supplier_bank_detail_changes to service_role;

alter table public.tk_client_projects add column if not exists custom_branded boolean not null default false;
comment on column public.tk_client_projects.custom_branded is 'DS16: custom / branded order — quotes sent for this project take turnkey.deposit_pct_custom instead of turnkey.deposit_pct.';

alter table public.supplier_applications
  add column if not exists first_approved_by uuid references auth.users(id) on delete restrict,
  add column if not exists first_approved_at timestamptz;

-- ───────────────────────── 2. Internal helpers ─────────────────────────
create or replace function public.ds16_shipping_markup_pct()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- not set / not a number 0–100 → no markup (shipping at cost); the staff card says "Not set"
  select coalesce((select case when jsonb_typeof(s.value) = 'number' and (s.value #>> '{}')::numeric between 0 and 100 then (s.value #>> '{}')::numeric end
                     from public.site_settings s where s.key = 'dropship.shipping_markup_pct'), 0)
$$;

create or replace function public.ds16_markup_pct_at(p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- the markup in force at p_at (approved or seeded changes); before DS16 there was none
  select coalesce((select (c.new_value #>> '{}')::numeric from public.dropship_setting_changes c
                    where c.key = 'dropship.shipping_markup_pct' and c.status in ('approved', 'seeded') and c.decided_at <= p_at
                    order by c.decided_at desc limit 1), 0)
$$;

create or replace function public.ds16_country_rule(p_country text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when jsonb_typeof(s.value) = 'object' and jsonb_typeof(s.value -> upper(btrim(coalesce(p_country, '')))) = 'object'
              then s.value -> upper(btrim(coalesce(p_country, ''))) end
    from public.site_settings s where s.key = 'dropship.country_duty_rules'
$$;

create or replace function public.ds16_last_movement_at(p_so uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  -- the last time anything moved for the parcel(s) of a store order; NULL = not known (no shipment / tracking data at all)
  select greatest(
    (select max(greatest(coalesce(s.last_event_at, '-infinity'::timestamptz), coalesce(s.handed_over_at, '-infinity'::timestamptz)))
       from public.wh_shipments s join public.wh_orders w on w.id = s.order_id
      where w.store_order_id = p_so and s.voided_at is null and (s.last_event_at is not null or s.handed_over_at is not null)),
    (select max(e.occurred_at) from public.wh_tracking_events e join public.wh_shipments s on s.id = e.shipment_id join public.wh_orders w on w.id = s.order_id
      where w.store_order_id = p_so),
    (select max(t.occurred_at) from public.tracking_events t join public.shipments sh on sh.id = t.shipment_id where sh.store_order_id = p_so),
    (select max(po.shipped_at) from public.dropship_partner_orders po where po.store_order_id = p_so))
$$;

create or replace function public.ds16_notify_ds_staff(p_title text, p_body text, p_link text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  -- Dropship division members and admins, one notification each (same pattern as the Turnkey alerts)
  for r in select distinct u from (
      select m.user_id u from public.division_members m where m.division_id = division_id_of('DS')
      union select ur.user_id from public.user_roles ur where ur.role_code = 'admin') x loop
    insert into public.notifications (user_id, org_id, division_id, service, title, body, link, dedupe_key)
    values (r.u, null, division_id_of('DS'), 'dropship', left(p_title, 200), left(p_body, 1000), p_link,
            case when p_dedupe is null then null else p_dedupe || ':' || r.u::text end)
    on conflict (dedupe_key) do nothing;
  end loop;
end $$;

create or replace function public.ds16_markup_can(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when p_kind = 'view' then coalesce(public.step6b_staff_read(), false) and coalesce(staff_aal_ok(), false)
    when p_kind = 'propose' then coalesce(is_staff(), false) and coalesce(staff_aal_ok(), false) and not coalesce(distributor_restricted(), false)
                                 and (coalesce(is_admin(), false) or can('finance', 'approve') or coalesce(dropship_can_edit(division_id_of('DS')), false))
    when p_kind = 'approve' then coalesce(is_staff(), false) and coalesce(staff_aal_ok(), false) and (coalesce(is_admin(), false) or can('finance', 'approve'))
    else false end
$$;

create or replace function public.tk_deposit_pct_custom()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when jsonb_typeof(setting('turnkey.deposit_pct_custom')) = 'number'
               and (setting('turnkey.deposit_pct_custom') #>> '{}')::numeric between 1 and 100
               and (setting('turnkey.deposit_pct_custom') #>> '{}')::numeric = trunc((setting('turnkey.deposit_pct_custom') #>> '{}')::numeric)
              then (setting('turnkey.deposit_pct_custom') #>> '{}')::integer end;
$$;

-- ───────────────────────── 3. Triggers ─────────────────────────
create or replace function public.ds16_guard_protected_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_keys text[] := array['dropship.shipping_markup_pct'];
begin
  if coalesce(current_setting('octopus.ds16_setting_change', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if (tg_op = 'DELETE' and old.key = any (v_keys))
     or (tg_op = 'INSERT' and new.key = any (v_keys))
     or (tg_op = 'UPDATE' and (old.key = any (v_keys) or new.key = any (v_keys)) and (new.key is distinct from old.key or new.value is distinct from old.value)) then
    raise exception 'TWO_PERSON_SETTING: % changes only through a proposal that a second person approves (Dropship staff › Fees).', coalesce(new.key, old.key);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_ds16_protected_settings on public.site_settings;
create trigger trg_ds16_protected_settings
  before insert or update or delete on public.site_settings
  for each row execute function public.ds16_guard_protected_settings();

create or replace function public.ds16_duty_mode_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mode = 'DAP' and public.ds16_country_rule(new.country) ->> 'incoterm' = 'DDP' then
    raise exception 'DDP_ONLY: % is sold duties paid (DDP) only — there is no de minimis. Choose DDP for this country.', new.country;
  end if;
  return new;
end $$;

drop trigger if exists trg_ds16_duty_mode_guard on public.dropship_duty_modes;
create trigger trg_ds16_duty_mode_guard
  before insert or update on public.dropship_duty_modes
  for each row execute function public.ds16_duty_mode_guard();

create or replace function public.ds16_supplier_application_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and (new.first_approved_by is null or new.reviewed_by is null or new.reviewed_by = new.first_approved_by) then
    raise exception 'SECOND_PERSON_REQUIRED: a supplier application is approved by two different people.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ds16_supplier_application_guard on public.supplier_applications;
create trigger trg_ds16_supplier_application_guard
  before update on public.supplier_applications
  for each row execute function public.ds16_supplier_application_guard();

-- ───────────────────────── 4. REPLACED: merchant quote — shipping markup, DDP-only countries without de minimis ─────────────────────────
create or replace function public.get_dropship_order_quote(p_lines jsonb, p_country text, p_method text, p_incoterm text DEFAULT 'DDP'::text, p_buyer_currency text DEFAULT 'USD'::text, p_fx_rate_to_usd numeric DEFAULT NULL::numeric, p_quote_mode text DEFAULT 'order'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted());
  v_org uuid;
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_incoterm text := upper(btrim(coalesce(p_incoterm, 'DDP')));
  v_buyer_currency text := upper(btrim(coalesce(p_buyer_currency, 'USD')));
  v_quote_mode text := lower(btrim(coalesce(p_quote_mode, 'order')));
  v_fx numeric;
  v_rc public.shipping_rate_cards;
  v_fv public.fee_versions;
  v_line jsonb;
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_im public.item_master;
  v_route public.dropship_routes;
  v_qty integer;
  v_total_qty integer := 0;
  v_sum_actual_weight_g bigint := 0;
  v_sum_box_volume_cm3 numeric := 0;
  v_combined_vol_g bigint := 0;
  v_raw_parcel_weight_g bigint := 0;
  v_billed_weight_g integer;
  v_tier_cents bigint;
  v_unit_prod_cents bigint;
  v_line_prod_cents bigint;
  v_product_cents bigint := 0;
  v_line_buyer_minor bigint;
  v_line_declared_usd_cents bigint;
  v_declared_value_usd_cents bigint := 0;
  v_all_buyer_prices_supplied boolean := true;
  v_duty_lines jsonb := '[]'::jsonb;
  v_dl_elem jsonb;
  v_elem_decl bigint;
  v_processing_cents bigint;
  v_shipping_cents bigint;
  v_duty_lookup jsonb;
  v_duty_ver_id uuid := null;
  v_duties_known boolean := true;
  v_duties_cents bigint := 0;
  v_duties_status text;
  v_duty_bp integer;
  v_tax_bp integer;
  v_de_min integer;
  v_de_min_applies text;
  -- DS16
  v_rule jsonb;
  v_ddp_forced boolean := false;
  v_ship_cost_cents bigint;
  v_markup_pct numeric := public.ds16_shipping_markup_pct();
begin
  if not v_is_staff then
    v_org := dropship_merchant_org();
    if v_uid is null or v_org is null then
      raise exception 'DROPSHIP_NOT_ENABLED';
    end if;
    if not exists (select 1 from public.dropship_markets m where m.org_id = v_org and m.country = v_country) then
      return jsonb_build_object('ok', false, 'code', 'MARKET_NOT_ENABLED', 'message', 'Destination country is not in your selling countries');
    end if;
  end if;

  if v_country !~ '^[A-Z]{2}$'
     or v_method not in ('economy', 'standard', 'express')
     or v_incoterm not in ('DDP', 'DAP')
     or v_quote_mode not in ('catalogue', 'order')
     or v_buyer_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'Invalid country, shipping method, incoterm, currency, or quote mode');
  end if;

  -- DS16 (owner 26 Nov): countries sold duties-paid only (US) are always quoted DDP
  v_rule := public.ds16_country_rule(v_country);
  if v_rule ->> 'incoterm' = 'DDP' and v_incoterm = 'DAP' then
    v_incoterm := 'DDP';
    v_ddp_forced := true;
  end if;

  if v_buyer_currency <> 'USD' and (p_fx_rate_to_usd is null or p_fx_rate_to_usd <= 0) then
    return jsonb_build_object('ok', false, 'code', 'FX_RATE_REQUIRED', 'message', 'Locked FX rate to USD is required when buyer currency is not USD');
  end if;
  if p_fx_rate_to_usd is not null and p_fx_rate_to_usd <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FX_RATE', 'message', 'FX rate to USD must be > 0');
  end if;
  v_fx := case
    when v_buyer_currency = 'USD' then coalesce(p_fx_rate_to_usd, 1.0)
    else p_fx_rate_to_usd
  end;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_LINES', 'message', 'At least one order line is required');
  end if;

  select *
    into v_rc
    from public.shipping_rate_cards rc
   where rc.active
     and rc.country = v_country
     and rc.method = v_method
   order by rc.base_cents asc, rc.created_at desc
   limit 1;

  if v_rc.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_RATE_SET', 'message', 'No rate set');
  end if;

  select *
    into v_fv
    from public.fee_versions
   where status = 'active'
   limit 1;

  if v_fv.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_FEE_VERSION', 'message', 'No active processing fee schedule');
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line ->> 'qty')::int, 0);
    if v_qty <= 0 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_QTY', 'message', 'Line quantity must be >= 1');
    end if;

    select * into v_var from public.dropship_variants where id = (v_line ->> 'variant_id')::uuid;
    if v_var.id is null then
      return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'Variant not found');
    end if;

    select * into v_prod from public.dropship_products where id = v_var.product_id;
    if v_prod.id is null
       or (
         not v_is_staff
         and (
           v_prod.status <> 'active'
           or (v_prod.visible_to_org_id is not null and v_prod.visible_to_org_id <> v_org)
           or not public.dropship_product_supplier_eligible(v_prod)
         )
       ) then
      return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_AVAILABLE', 'message', 'Product is not available');
    end if;

    select * into v_im from public.item_master where id = v_var.item_id;
    if public.calc_billed_weight_g(v_im.id, v_rc.volumetric_divisor, v_rc.step_g) is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'WEIGHT_SIZE_MISSING',
        'needs_data', true,
        'message', 'Weight/size missing'
      );
    end if;

    if (v_im.has_battery and not v_rc.allows_battery)
       or (v_im.has_liquid and not v_rc.allows_liquid)
       or (v_im.has_magnet and not v_rc.allows_magnet)
       or (v_im.has_powder and not v_rc.allows_powder) then
      return jsonb_build_object('ok', false, 'code', 'RESTRICTED_ITEM', 'message', 'Selected shipping method does not support this item');
    end if;

    v_sum_actual_weight_g := v_sum_actual_weight_g + (v_im.weight_g::bigint * v_qty::bigint);
    v_sum_box_volume_cm3 := v_sum_box_volume_cm3 + ((v_im.box_l_cm * v_im.box_w_cm * v_im.box_h_cm) * v_qty::numeric);
    v_total_qty := v_total_qty + v_qty;

    v_tier_cents := null;
    select t.unit_price_cents
      into v_tier_cents
      from public.dropship_price_tiers t
     where t.product_id = v_prod.id
       and t.min_qty <= v_qty
     order by t.min_qty desc
     limit 1;

    if v_tier_cents is not null then
      v_unit_prod_cents := greatest(0, v_tier_cents + v_var.price_adjust_cents);
    elsif v_prod.product_price_cents is not null then
      v_unit_prod_cents := greatest(0, v_prod.product_price_cents + v_var.price_adjust_cents);
    else
      select * into v_route
        from public.dropship_routes r
       where r.product_id = v_prod.id
         and r.destination_country = v_country
         and r.shipping_method = v_method
         and r.is_active
       limit 1;
      if v_route.id is null then
        return jsonb_build_object('ok', false, 'code', 'NO_PRODUCT_PRICE', 'message', 'No product price set for this destination');
      end if;
      v_unit_prod_cents := greatest(0, (v_route.landed_price_cents - v_route.est_shipping_cents - v_route.est_duties_cents) + v_var.price_adjust_cents);
    end if;

    v_line_prod_cents := v_unit_prod_cents * v_qty::bigint;
    v_product_cents := v_product_cents + v_line_prod_cents;

    if v_quote_mode = 'catalogue' then
      v_all_buyer_prices_supplied := false;
      v_line_declared_usd_cents := v_line_prod_cents;
    elsif (v_line ? 'buyer_paid_cents') and v_line -> 'buyer_paid_cents' <> 'null'::jsonb then
      v_line_buyer_minor := (v_line ->> 'buyer_paid_cents')::bigint;
      if v_line_buyer_minor < 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'buyer_paid_cents must be >= 0');
      end if;
      v_line_declared_usd_cents := round(v_line_buyer_minor::numeric * v_fx)::bigint;
    elsif (v_line ? 'buyer_unit_price_cents') and v_line -> 'buyer_unit_price_cents' <> 'null'::jsonb then
      v_line_buyer_minor := (v_line ->> 'buyer_unit_price_cents')::bigint * v_qty::bigint;
      if v_line_buyer_minor < 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'buyer_unit_price_cents must be >= 0');
      end if;
      v_line_declared_usd_cents := round(v_line_buyer_minor::numeric * v_fx)::bigint;
    else
      v_all_buyer_prices_supplied := false;
      v_line_declared_usd_cents := v_line_prod_cents;
    end if;

    v_declared_value_usd_cents := v_declared_value_usd_cents + v_line_declared_usd_cents;
    v_duty_lines := v_duty_lines || jsonb_build_array(
      jsonb_build_object('hs_code', v_im.hs_code, 'declared_usd_cents', v_line_declared_usd_cents)
    );
  end loop;

  v_combined_vol_g := ceil((v_sum_box_volume_cm3 / v_rc.volumetric_divisor) * 1000.0)::bigint;
  v_raw_parcel_weight_g := greatest(v_sum_actual_weight_g, v_combined_vol_g);
  v_billed_weight_g := (ceil(v_raw_parcel_weight_g::numeric / v_rc.step_g::numeric)::integer * v_rc.step_g);
  if v_billed_weight_g > v_rc.max_weight_g then
    return jsonb_build_object('ok', false, 'code', 'MAX_WEIGHT_EXCEEDED', 'message', 'Order exceeds maximum weight for this shipping method');
  end if;

  v_processing_cents := v_fv.pick_pack_first_cents
    + (greatest(0, v_total_qty - 1)::bigint * v_fv.pick_pack_extra_cents)
    + v_fv.packaging_cents;

  v_shipping_cents := v_rc.base_cents
    + ((v_billed_weight_g / v_rc.step_g)::bigint * v_rc.per_100g_cents);
  -- EA-1: carrier fuel surcharge on the shipping line (0 unless the rate card sets one)
  v_shipping_cents := v_shipping_cents + round(v_shipping_cents::numeric * coalesce(v_rc.fuel_surcharge_bp, 0) / 10000.0)::bigint;
  -- DS16: rate cards are carrier cost; the merchant's shipping line = cost × (1 + dropship.shipping_markup_pct), integer cents, half-up
  v_ship_cost_cents := v_shipping_cents;
  v_shipping_cents := round(v_ship_cost_cents::numeric * (100 + v_markup_pct) / 100.0)::bigint;

  if v_incoterm = 'DAP' then
    v_duties_known := true;
    v_duties_cents := 0;
    v_duties_status := 'known';
  else
    for v_dl_elem in select * from jsonb_array_elements(v_duty_lines) loop
      v_duty_lookup := public.lookup_duty_rate(v_country, v_dl_elem ->> 'hs_code');
      if v_duty_lookup is null then
        v_duties_known := false;
        v_duties_cents := null;
        exit;
      end if;
      v_duty_ver_id := (v_duty_lookup ->> 'duty_rate_version_id')::uuid;
      v_duty_bp := (v_duty_lookup ->> 'duty_bp')::int;
      v_tax_bp := (v_duty_lookup ->> 'tax_bp')::int;
      v_de_min := (v_duty_lookup ->> 'de_minimis_cents')::int;
      v_de_min_applies := coalesce(v_duty_lookup ->> 'de_minimis_applies_to', 'duty');
      -- DS16: a country rule with de_minimis_cents (US: 0) caps the duty table's de minimis
      if v_rule ? 'de_minimis_cents' and jsonb_typeof(v_rule -> 'de_minimis_cents') = 'number' then
        v_de_min := least(coalesce(v_de_min, 0), (v_rule ->> 'de_minimis_cents')::int);
      end if;
      v_elem_decl := (v_dl_elem ->> 'declared_usd_cents')::bigint;
      if v_declared_value_usd_cents <= v_de_min then
        if v_de_min_applies = 'duty_and_tax' then
          v_duties_cents := v_duties_cents + 0;
        else
          v_duties_cents := v_duties_cents + round(v_elem_decl::numeric * v_tax_bp::numeric / 10000.0)::bigint;
        end if;
      else
        v_duties_cents := v_duties_cents + round(v_elem_decl::numeric * (v_duty_bp + v_tax_bp)::numeric / 10000.0)::bigint;
      end if;
    end loop;

    if not v_duties_known then
      v_duties_status := 'not_known_yet';
    elsif v_quote_mode = 'catalogue' or not v_all_buyer_prices_supplied then
      v_duties_status := 'estimate';
    else
      v_duties_status := 'known';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'country', v_country,
    'shipping_method', v_method,
    'incoterm', v_incoterm,
    'ddp_only', v_ddp_forced or coalesce(v_rule ->> 'incoterm' = 'DDP', false),
    'total_qty', v_total_qty,
    'actual_weight_g', v_sum_actual_weight_g,
    'volumetric_weight_g', v_combined_vol_g,
    'billed_weight_g', v_billed_weight_g,
    'days_min', v_rc.days_min,
    'days_max', v_rc.days_max,
    'product_cents', v_product_cents,
    'processing_cents', v_processing_cents,
    'shipping_cents', v_shipping_cents,
    'fuel_surcharge_bp', coalesce(v_rc.fuel_surcharge_bp, 0),
    -- remote-area fee depends on the buyer postcode (Release 3): only say it may apply, never guess an amount
    'remote_area_fee_may_apply', coalesce(v_rc.remote_area_fee_cents, 0) > 0,
    'declared_value_usd_cents', v_declared_value_usd_cents,
    'duty_basis', case
      when v_quote_mode = 'catalogue' or not v_all_buyer_prices_supplied then 'product_price'
      else 'buyer_paid_price_usd'
    end,
    'duties_cents', v_duties_cents,
    'duties_status', v_duties_status,
    'duties_label', case
      when v_incoterm = 'DAP' then 'Duties paid by buyer'
      when v_duties_known then null
      else 'not known yet'
    end,
    'total_known_cents', v_product_cents + v_processing_cents + v_shipping_cents + coalesce(v_duties_cents, 0),
    'total_cents', case
      when v_duties_known then v_product_cents + v_processing_cents + v_shipping_cents + v_duties_cents
      else null
    end,
    'version_ids', jsonb_build_object(
      'shipping_rate_card_id', v_rc.id,
      'fee_version_id', v_fv.id,
      'duty_rate_version_id', v_duty_ver_id
    )
  ) || case when v_is_staff
            -- staff only: the carrier cost behind the merchant's shipping line (merchants never see cost or markup)
            then jsonb_build_object('shipping_cost_cents', v_ship_cost_cents, 'shipping_markup_pct', v_markup_pct)
            else '{}'::jsonb end;
end $function$;

-- ───────────────────────── 5. REPLACED: DS10 — re-weigh (markup at order time, dispute window setting), claims, approval limit ─────────────────────────
create or replace function public.ds10_reweigh_calc(p_so uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  so public.store_orders;
  w public.wh_orders;
  rc public.shipping_rate_cards;
  fv public.fee_versions;
  v_actual int;
  v_vol_cm3 numeric;
  v_vol_g int;
  v_billed int;
  v_tol int;
  v_ship bigint;
  v_amt bigint;
  v_photo text;
begin
  select * into so from public.store_orders where id = p_so;
  if so.id is null then return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); end if;
  select * into w from public.wh_orders where store_order_id = so.id and status in ('packed', 'labelled', 'shipped');
  if w.id is null then return jsonb_build_object('ok', false, 'reason', 'NOT_PACKED'); end if;
  select * into rc from public.shipping_rate_cards where id = so.shipping_rate_card_id;
  select * into fv from public.fee_versions where id = so.fee_version_id;
  if rc.id is null or so.billed_weight_g is null then return jsonb_build_object('ok', false, 'reason', 'NO_QUOTE', 'wh_order_id', w.id); end if;
  v_actual := coalesce((select sum(p.measured_weight_g) from public.wh_parcels p where p.order_id = w.id and p.measured_weight_g is not null), w.measured_weight_g);
  if v_actual is null then return jsonb_build_object('ok', false, 'reason', 'NOT_WEIGHED', 'wh_order_id', w.id); end if;
  v_vol_cm3 := coalesce((select sum(b.length_mm::numeric * b.width_mm * b.height_mm) / 1000.0 from public.wh_parcels p join public.wh_boxes b on b.id = p.box_id where p.order_id = w.id),
                        (select b.length_mm::numeric * b.width_mm * b.height_mm / 1000.0 from public.wh_boxes b where b.id = w.box_id), 0);
  v_vol_g := ceil(v_vol_cm3 / coalesce(nullif(rc.volumetric_divisor, 0), 5000) * 1000.0)::int;
  v_billed := (ceil(greatest(v_actual, v_vol_g)::numeric / rc.step_g::numeric)::int * rc.step_g);
  v_tol := case when fv.weigh_tolerance_g is null and fv.weigh_tolerance_pct is null then null
                else greatest(coalesce(fv.weigh_tolerance_g, 0), ceil(so.billed_weight_g * coalesce(fv.weigh_tolerance_pct, 0) / 100.0)::int) end;
  v_ship := rc.base_cents + ((v_billed / rc.step_g)::bigint * rc.per_100g_cents);
  v_ship := v_ship + round(v_ship::numeric * coalesce(rc.fuel_surcharge_bp, 0) / 10000.0)::bigint;
  -- DS16: the order's shipping line carried the markup in force when it was placed; compare like with like
  v_ship := round(v_ship::numeric * (100 + public.ds16_markup_pct_at(so.created_at)) / 100.0)::bigint;
  v_amt := greatest(0, v_ship - so.shipping_cents);
  select e.storage_path into v_photo from public.wh_pack_evidence e
   where e.order_id = w.id and e.kind = 'scale' and e.purged_at is null order by e.created_at desc limit 1;
  return jsonb_build_object('ok', true, 'wh_order_id', w.id, 'wh_order_code', w.code, 'quoted_g', so.billed_weight_g, 'actual_g', v_actual,
    'volumetric_g', v_vol_g, 'billed_g', v_billed, 'diff_g', v_billed - so.billed_weight_g, 'tolerance_g', v_tol, 'amount_cents', v_amt,
    'new_shipping_cents', v_ship, 'photo_path', v_photo,
    'dispute_days', coalesce(fv.dispute_window_days, public.ds10_setting_int('dropship.reweigh_dispute_days', 7, 1, 90)),
    'over', v_tol is not null and v_billed - so.billed_weight_g > v_tol and v_amt > 0,
    'tolerance_unknown', v_tol is null);
end $function$;

create or replace function public.ds10_claim_open(p_so uuid, p_kind text, p_choice text, p_message text, p_photos text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  so public.store_orders := public.ds_order_own(p_so);
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_msg text := btrim(coalesce(p_message, ''));
  v_days int := public.ds10_setting_int('dropship.claim_window_days', 14, 1, 90);
  v_lost_days int := public.ds10_setting_int('dropship.lost_after_days', 15, 1, 90);
  v_last timestamptz;
  v_deliv timestamptz;
  v_case public.dropship_cases;
  v_p text;
  v_ticket uuid;
  h public.escrow_holds;
begin
  perform ds_feature_guard('orders');
  -- paused / closed merchants keep support for orders in progress: a claim is allowed
  if v_kind not in ('lost', 'damaged') then raise exception 'INVALID_INPUT: Choose lost or damaged.'; end if;
  if v_choice not in ('reship', 'refund') then raise exception 'INVALID_INPUT: Choose reship or refund to your wallet.'; end if;
  if length(v_msg) < 10 or length(v_msg) > 2000 then raise exception 'INVALID_INPUT: Describe what happened (10 to 2,000 characters).'; end if;
  if so.cancelled_at is not null then raise exception 'ORDER_CANCELLED: This order is cancelled.'; end if;
  if not public.ds10_handed_over(so.id) then raise exception 'NOT_SHIPPED: Lost and damaged parcel claims open once the parcel has shipped.'; end if;
  v_deliv := public.ds10_delivered_at(so.id);
  if v_kind = 'lost' and v_deliv is not null then raise exception 'DELIVERED: The carrier shows this parcel as delivered. If it arrived damaged, choose damaged.'; end if;
  -- DS16 (owner 26 Nov): a parcel is lost after dropship.lost_after_days without tracking movement (unknown movement: support checks)
  if v_kind = 'lost' then
    v_last := public.ds16_last_movement_at(so.id);
    if v_last is not null and v_last > now() - make_interval(days => v_lost_days) then
      raise exception 'TOO_EARLY: A parcel counts as lost after % days without tracking movement. It last moved on %; you can report it as lost from %.',
        v_lost_days, to_char(v_last at time zone 'UTC', 'DD Mon YYYY'), to_char((v_last + make_interval(days => v_lost_days)) at time zone 'UTC', 'DD Mon YYYY');
    end if;
  end if;
  if v_deliv is not null and v_deliv <= now() - make_interval(days => v_days) then
    raise exception 'TOO_LATE: Damaged or wrong items are reported with photos up to % days after delivery.', v_days;
  end if;
  if exists (select 1 from public.dropship_cases c where c.store_order_id = so.id and c.kind in ('lost', 'damaged') and c.status in ('reported', 'carrier_claim', 'awaiting_approval')) then
    raise exception 'ALREADY_OPEN: A claim for this order is already open.';
  end if;
  if v_kind = 'damaged' and coalesce(cardinality(p_photos), 0) = 0 then raise exception 'PHOTO_REQUIRED: Add at least one photo of the damaged or wrong item.'; end if;
  if coalesce(cardinality(p_photos), 0) > 6 then raise exception 'TOO_MANY_PHOTOS: Up to 6 photos.'; end if;
  insert into public.dropship_cases (store_order_id, org_id, kind, merchant_choice, description)
  values (so.id, so.org_id, v_kind, v_choice, v_msg) returning * into v_case;
  foreach v_p in array coalesce(p_photos, '{}') loop
    if v_p !~ ('^' || so.org_id::text || '/' || so.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then raise exception 'INVALID_PHOTO: A photo is not filed under this order.'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ds-claims' and o.name = v_p) then raise exception 'PHOTO_MISSING: Upload the photo first.'; end if;
    insert into public.dropship_case_photos (case_id, org_id, path) values (v_case.id, so.org_id, v_p);
  end loop;
  v_ticket := public.ds10_ticket_open(so.org_id, so.id,
    format('%s claim %s · order %s', case v_kind when 'lost' then 'Lost parcel' else 'Damaged parcel' end, v_case.code, coalesce(so.external_order_name, so.order_number)),
    'order_problem', format('%s%sThe merchant asks for: %s.', v_msg, E'\n\n', case v_choice when 'reship' then 'a reship' else 'a refund to the wallet' end),
    coalesce((select jsonb_agg(jsonb_build_object('path', p.path, 'name', 'Photo', 'bucket', 'ds-claims')) from public.dropship_case_photos p where p.case_id = v_case.id), '[]'::jsonb));
  update public.dropship_cases set ticket_id = v_ticket where id = v_case.id;
  perform public.ds10_case_step(v_case.id, 'reported', format('You reported the parcel as %s and asked for %s.', v_kind, case v_choice when 'reship' then 'a reship' else 'a refund' end));
  -- payment protection still holding the money: the dispute keeps it held until Octopus decides
  h := public.ds10_open_hold(so.id);
  if h.id is not null and h.status = 'held' then
    perform public.open_escrow_dispute(h.id, format('Dropship %s claim %s', v_kind, v_case.code));
  end if;
  perform write_audit('ds_case.opened', 'dropship_cases', v_case.id::text,
    jsonb_build_object('org_id', so.org_id, 'code', v_case.code, 'kind', v_kind, 'choice', v_choice, 'photos', coalesce(cardinality(p_photos), 0), 'ticket_id', v_ticket,
                       'last_movement_at', v_last));
  return jsonb_build_object('ok', true, 'id', v_case.id, 'code', v_case.code, 'ticket_id', v_ticket,
    'message', format('Claim %s sent. Octopus support replies in Support; the money stays with Octopus until it is decided.', v_case.code));
end $function$;

create or replace function public.ds10_approval_limit_cents()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- DS16: refunds above dropship.claim_second_approver_over_cents need a second, different Finance approver (owner: US$1,000)
  select coalesce((select case when jsonb_typeof(s.value) = 'number' and (s.value #>> '{}')::numeric >= 0
                                and (s.value #>> '{}')::numeric = trunc((s.value #>> '{}')::numeric) then (s.value #>> '{}')::bigint end
                     from public.site_settings s where s.key = 'dropship.claim_second_approver_over_cents'), 100000::bigint)
$function$;

create or replace function public.ds10_case_refund(p_case uuid, p_amount_cents bigint, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.dropship_cases := public.ds10_case_for_staff(p_case);
  so public.store_orders;
  v_fa uuid;
  v_cap bigint;
  v_limit bigint := public.ds10_approval_limit_cents();
begin
  if c.kind = 'return' and c.status <> 'received' then raise exception 'INVALID_STEP: Returns are refunded after the warehouse has checked them (Settle return).'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT: Enter the refund amount.'; end if;
  v_cap := public.ds10_refund_cap(c.store_order_id);
  if p_amount_cents > v_cap then raise exception 'REFUND_TOO_HIGH: The refund can be at most %.', ds_order_usd(v_cap); end if;
  select * into so from public.store_orders where id = c.store_order_id;
  update public.dropship_cases set refund_cents = p_amount_cents, outcome_message = left(nullif(btrim(coalesce(p_message, '')), ''), 600), updated_at = now() where id = c.id;
  if p_amount_cents <= v_limit then
    return public.ds10_refund_execute(c.id);
  end if;
  -- over the limit: Finance approval (org_id stays empty: DS10 runs the refund itself once a different person approves)
  insert into public.finance_approvals (kind, org_id, amount_cents, currency, reason, requested_by)
  values ('refund', null, p_amount_cents, 'USD',
          left(format('Dropship %s %s · order %s · %s · refund %s to the merchant wallet', case c.kind when 'return' then 'return' else c.kind || ' parcel claim' end,
                      c.code, so.order_number, (select name from public.organizations where id = c.org_id), ds_order_usd(p_amount_cents)), 500),
          auth.uid())
  returning id into v_fa;
  perform write_audit('finance.request', 'finance_approvals', v_fa::text, jsonb_build_object('kind', 'refund', 'amount', p_amount_cents, 'currency', 'USD', 'case', c.code));
  update public.dropship_cases set status = 'awaiting_approval', finance_approval_id = v_fa, updated_at = now() where id = c.id;
  perform public.ds10_case_step(c.id, 'awaiting_approval', format('Refund of %s proposed; refunds above %s need a second Finance approver.', ds_order_usd(p_amount_cents), ds_order_usd(v_limit)));
  perform write_audit('ds_case.refund_proposed', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'amount_cents', p_amount_cents, 'finance_approval_id', v_fa, 'limit_cents', v_limit));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'awaiting_approval', 'finance_approval_id', v_fa,
    'message', 'Waiting for approval. Another Finance user or an admin must approve this refund.');
end $function$;

create or replace function public.ds10_refund_approve(p_case uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.dropship_cases;
  a public.finance_approvals;
begin
  perform require_step_up();
  if not (can('finance', 'approve') or is_admin()) then raise exception 'FORBIDDEN: Finance approvers decide refunds above %.', ds_order_usd(public.ds10_approval_limit_cents()); end if;
  select * into c from public.dropship_cases where id = p_case for update;
  if c.id is null or c.status <> 'awaiting_approval' then raise exception 'NOT_WAITING: This case has no refund waiting for approval.'; end if;
  select * into a from public.finance_approvals where id = c.finance_approval_id for update;
  if a.status <> 'requested' then raise exception 'INVALID_TRANSITION'; end if;
  if a.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE: A different person must approve the refund you proposed.'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'INVALID_INPUT: Say why the refund is rejected.'; end if;
  update public.finance_approvals set status = (case when p_approve then 'approved' else 'rejected' end)::approval_status,
         approved_by = auth.uid(), decided_at = now() where id = a.id;
  perform write_audit('finance.decide', 'finance_approvals', a.id::text, jsonb_build_object('approve', p_approve, 'note', p_note, 'case', c.code));
  -- the trigger on finance_approvals runs the refund / puts the case back (one path for both screens)
  select * into c from public.dropship_cases where id = p_case;
  return jsonb_build_object('ok', true, 'code', c.code, 'status', c.status);
end $function$;

-- ───────────────────────── 6. REPLACED: DS14 — supplier price changes, merchant-brand slip, rules keep other keys ─────────────────────────
create or replace function public.ds_sup_price_change(p_price_id uuid, p_new_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sup uuid := ds14_supplier();
  pp public.supplier_product_prices;
  sp public.supplier_products;
  p public.products;
  v_pct numeric;
  v_rules jsonb := ds14_rules();
  v_auto integer := case when jsonb_typeof(v_rules -> 'price_auto_pct') = 'number' then (v_rules ->> 'price_auto_pct')::integer end;
  v_cum_max integer := case when jsonb_typeof(v_rules -> 'price_cum_30d_pct') = 'number' then (v_rules ->> 'price_cum_30d_pct')::integer end;
  v_chain text;
  v_base bigint;
  v_cum numeric;
  v_dir text;
  v_sub uuid;
  v_status text;
begin
  if not exists (select 1 from public.supplier_switches w where w.supplier_id = v_sup and w.product_upload) then
    raise exception 'UPLOAD_OFF: Product changes are switched off for your account. Ask your Octopus contact.';
  end if;
  if p_new_minor is null or p_new_minor <= 0 or p_new_minor > 1000000000 then raise exception 'BAD_PRICE: Enter a cost above 0.'; end if;
  select * into pp from public.supplier_product_prices where id = p_price_id and supplier_id = v_sup and not is_superseded for update;
  if pp.id is null then raise exception 'NOT_FOUND: This price is not yours.'; end if;
  if p_new_minor = pp.price_minor then raise exception 'NO_CHANGE: The cost is already that amount.'; end if;
  if exists (select 1 from public.dropship_supplier_submissions x where x.supplier_id = v_sup and x.kind = 'price_change' and x.status = 'submitted' and x.payload ->> 'price_id' = pp.id::text) then
    raise exception 'ALREADY_PENDING: A price change for this product is already waiting for review.';
  end if;
  select * into sp from public.supplier_products where supplier_id = pp.supplier_id and product_id = pp.product_id;
  select * into p from public.products where id = pp.product_id;
  v_pct := round(abs(p_new_minor - pp.price_minor)::numeric * 100 / pp.price_minor, 2);
  v_dir := case when p_new_minor < pp.price_minor then 'decrease' else 'increase' end;
  -- DS16: the same price tier over time (a change supersedes the row, so tiers are matched by product / incoterm / MOQ / variant)
  v_chain := pp.product_id::text || '|' || pp.incoterm || '|' || pp.moq_tier_min::text || '|' || coalesce(pp.variant_label, '');
  select (x.payload ->> 'old_minor')::bigint into v_base
    from public.dropship_supplier_submissions x
   where x.supplier_id = v_sup and x.kind = 'price_change' and x.status in ('approved', 'auto_approved')
     and coalesce(x.reviewed_at, x.created_at) > now() - interval '30 days'
     and (x.payload ->> 'chain' = v_chain or x.payload ->> 'price_id' = pp.id::text)
   order by x.created_at asc limit 1;
  v_base := coalesce(v_base, pp.price_minor);
  v_cum := round((p_new_minor - v_base)::numeric * 100 / v_base, 2);
  -- owner 26 Nov: decreases are applied at once; increases up to price_auto_pct are applied at once (staff are told) unless the
  -- increase over 30 days passes price_cum_30d_pct; everything else is reviewed. No auto rule set → every increase is reviewed.
  v_status := case
    when v_dir = 'decrease' then 'auto_approved'
    when v_auto is not null and v_pct <= v_auto and (v_cum_max is null or v_cum <= v_cum_max) then 'auto_approved'
    else 'submitted' end;
  insert into public.dropship_supplier_submissions (supplier_id, kind, status, summary, payload, supplier_product_id, reviewed_at)
  values (v_sup, 'price_change', v_status, left('Price · ' || p.title, 200),
          jsonb_build_object('price_id', pp.id, 'old_minor', pp.price_minor, 'new_minor', p_new_minor, 'currency', pp.currency, 'pct', v_pct,
                             'direction', v_dir, 'chain', v_chain, 'base_minor', v_base, 'cum_pct', v_cum), sp.id,
          case when v_status = 'auto_approved' then now() end)
  returning id into v_sub;
  if v_status = 'auto_approved' then perform public.ds14_apply_price(v_sub); end if;
  if v_status = 'auto_approved' and v_dir = 'increase' then
    perform public.ds16_notify_ds_staff(
      'Supplier price increase applied · ' || left(coalesce(p.title, 'product'), 120),
      format('A partner supplier raised a cost by %s%% (%s%% over 30 days); it was applied automatically under the auto-approval rule.', v_pct, v_cum),
      '/office/dropship/approvals?tab=approved&id=' || v_sub::text, 'ds16:price-up:' || v_sub::text);
  end if;
  perform write_audit('ds_supplier_price.submitted', 'dropship_supplier_submissions', v_sub::text,
                      jsonb_build_object('supplier_id', v_sup, 'status', v_status, 'direction', v_dir, 'pct', v_pct, 'cum_pct', v_cum));
  return jsonb_build_object('id', v_sub, 'status', v_status, 'pct', v_pct, 'direction', v_dir, 'cum_pct', v_cum);
end $function$;

create or replace function public.ds_sup_slip(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sup uuid := ds14_supplier();
  po public.dropship_partner_orders;
  r jsonb;
  v_brand jsonb;
begin
  select * into po from public.dropship_partner_orders where id = p_id and supplier_id = v_sup for update;
  if po.id is null then raise exception 'NOT_FOUND: This order is not yours.'; end if;
  r := public.ds14_sup_order_row(po, true);
  if r ->> 'status' = 'cancelled' then raise exception 'ORDER_CANCELLED: This order was cancelled. Do not ship it.'; end if;
  update public.dropship_partner_orders set slip_at = coalesce(slip_at, now()), updated_at = now() where id = po.id;
  -- DS16 (owner 26 Nov): a Dropship parcel carries the merchant's brand only — the approved brand name and, when the merchant shows it on
  -- slips, the logo (DS12 brand settings, same source as the tracking page). Never Octopus, never prices, never the merchant's company.
  v_brand := public.ds12_brand_json((select so.org_id from public.store_orders so where so.id = po.store_order_id), 'slip');
  return jsonb_build_object('order', r -> 'order', 'date', current_date, 'ship_to', r -> 'ship_to', 'items', r -> 'items', 'kind', 'dropship',
    'brand', jsonb_build_object('name', v_brand ->> 'brand_name', 'logo_path', v_brand ->> 'logo_path'));
end $function$;

create or replace function public.ds_staff_rules_save(p_price_auto_pct integer, p_ship_within_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  perform ds14_assert('edit');
  if p_price_auto_pct is not null and p_price_auto_pct not between 0 and 50 then raise exception 'BAD_RULE: Auto-approve price changes up to 0 to 50 percent, or leave it empty to review every price change.'; end if;
  if p_ship_within_days is not null and p_ship_within_days not between 1 and 60 then raise exception 'BAD_RULE: Ship within 1 to 60 days, or leave it empty.'; end if;
  -- DS16: keep the other rules (price_cum_30d_pct) — only the two keys this form owns change
  v := (coalesce(ds14_rules(), '{}'::jsonb) - 'price_auto_pct' - 'ship_within_days')
       || jsonb_strip_nulls(jsonb_build_object('price_auto_pct', p_price_auto_pct, 'ship_within_days', p_ship_within_days));
  insert into public.site_settings (key, value, description, is_public, updated_by)
  values ('dropship_supplier_rules', v, 'Octopus Dropship supplier portal rules (auto-approve price changes up to N percent; ship within N days)', false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid(), is_public = false;
  perform write_audit('ds_supplier_rules.saved', 'site_settings', 'dropship_supplier_rules', v);
  return v;
end $function$;

create or replace function public.ds_staff_rules_save_v2(p_price_auto_pct integer, p_ship_within_days integer, p_price_cum_30d_pct integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform ds14_assert('edit');
  if p_price_auto_pct is not null and p_price_auto_pct not between 0 and 50 then raise exception 'BAD_RULE: Auto-approve price increases up to 0 to 50 percent, or leave it empty to review every increase.'; end if;
  if p_ship_within_days is not null and p_ship_within_days not between 1 and 60 then raise exception 'BAD_RULE: Ship within 1 to 60 days, or leave it empty.'; end if;
  if p_price_cum_30d_pct is not null and p_price_cum_30d_pct not between 0 and 100 then raise exception 'BAD_RULE: The 30-day limit is 0 to 100 percent, or leave it empty.'; end if;
  v := (coalesce(ds14_rules(), '{}'::jsonb) - 'price_auto_pct' - 'ship_within_days' - 'price_cum_30d_pct')
       || jsonb_strip_nulls(jsonb_build_object('price_auto_pct', p_price_auto_pct, 'ship_within_days', p_ship_within_days, 'price_cum_30d_pct', p_price_cum_30d_pct));
  insert into public.site_settings (key, value, description, is_public, updated_by)
  values ('dropship_supplier_rules', v, 'Octopus Dropship supplier portal rules (decreases applied at once; increases up to N percent applied at once unless the 30-day total passes M percent; ship within N days)', false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid(), is_public = false;
  perform write_audit('ds_supplier_rules.saved', 'site_settings', 'dropship_supplier_rules', v);
  return v;
end $$;

-- ───────────────────────── 7. REPLACED: supplier application approval needs two different people ─────────────────────────
create or replace function public.review_supplier_application(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.supplier_applications;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not has_permission(auth.uid(), 'suppliers', 'approve') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('in_review','approved','rejected') then raise exception 'BAD_STATUS'; end if;
  if p_status = 'rejected' and v_note is null then raise exception 'NOTE_REQUIRED'; end if;
  select * into a from supplier_applications where id = p_id for update;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  -- DS16 (owner 26 Nov): a new supplier is approved by two different people — the first approval is recorded, the second approves
  if p_status = 'approved' and a.status <> 'approved' then
    if a.first_approved_by is null then
      update supplier_applications
         set status = 'in_review', first_approved_by = auth.uid(), first_approved_at = now(), review_note = coalesce(v_note, review_note)
       where id = p_id;
      insert into audit_log(actor_id, action, entity, entity_id, details)
      values (auth.uid(), 'supplier_application.first_approval', 'supplier_application', p_id::text,
              jsonb_build_object('from', a.status, 'to', 'in_review', 'note', p_note));
      return;
    elsif a.first_approved_by = auth.uid() then
      raise exception 'SECOND_PERSON_REQUIRED: you gave the first approval; a different person approves it.';
    end if;
  end if;
  update supplier_applications
     set status = p_status,
         review_note = case when p_status = 'approved' then coalesce(v_note, review_note) else v_note end,
         reviewed_by = auth.uid(), reviewed_at = now(),
         -- a rejection clears a first approval: approving later starts again with two people
         first_approved_by = case when p_status = 'rejected' then null else first_approved_by end,
         first_approved_at = case when p_status = 'rejected' then null else first_approved_at end
   where id = p_id;
  insert into audit_log(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'supplier_application.review', 'supplier_application', p_id::text,
          jsonb_build_object('from', a.status, 'to', p_status, 'note', p_note, 'first_approved_by', a.first_approved_by));
end $function$;

-- ───────────────────────── 8. REPLACED: Turnkey quotes take the custom / branded deposit when the project is marked ─────────────────────────
create or replace function public.tk_send_client_quote(p_quote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q public.tk_client_quotes;
  v public.tk_client_projects;
  v_pct integer;
  v_dep bigint;
begin
  select * into q from public.tk_client_quotes where id = p_quote;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = q.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors send quotes'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.stage not in ('sourcing', 'quote_deposit') then raise exception 'NOT_IN_SOURCING: client quotes are sent in Sourcing or Quote and deposit'; end if;
  select * into q from public.tk_client_quotes where id = p_quote for update;
  if q.status <> 'draft' then raise exception 'QUOTE_SENT: this version was already sent'; end if;
  if not exists (select 1 from public.tk_client_quote_lines l where l.quote_id = q.id) or q.total_cents <= 0 then raise exception 'LINES_REQUIRED: add at least one line'; end if;
  if q.valid_until is not null and q.valid_until < current_date then raise exception 'QUOTE_EXPIRED: change the valid-until date first'; end if;
  if exists (select 1 from public.tk_client_quotes x where x.project_id = v.id and x.status = 'accepted') then raise exception 'QUOTE_ACCEPTED: the client has accepted a quote'; end if;
  -- DS16 (owner 26 Nov): 30 % standard, 50 % for custom / branded orders — both settings; the % is frozen on the sent version
  if v.custom_branded then
    v_pct := public.tk_deposit_pct_custom();
    if v_pct is null then raise exception 'DEPOSIT_CUSTOM_NOT_SET: an admin sets the custom / branded deposit percentage (Admin › Turnkey › Settings) before this quote is sent'; end if;
  else
    v_pct := public.tk_deposit_pct();
    if v_pct is null then raise exception 'DEPOSIT_NOT_SET: an admin sets the deposit percentage (Admin › Turnkey › Services and fees) before quotes are sent'; end if;
  end if;
  v_dep := (q.total_cents * v_pct + 50) / 100;
  if v_dep <= 0 then raise exception 'DEPOSIT_TOO_SMALL: the quote total is too small for a deposit'; end if;
  update public.tk_client_quotes set status = 'superseded', updated_at = now() where project_id = v.id and status = 'sent';
  update public.tk_client_quotes set status = 'sent', deposit_pct = v_pct, deposit_cents = v_dep, sent_at = now(), sent_by = auth.uid(), updated_at = now() where id = q.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'quote', 'quote_deposit', 'Quote version ' || q.version || ' is ready: US$ ' || to_char(q.total_cents / 100.0, 'FM999,999,999,990.00') ||
          '. Deposit when you accept: ' || v_pct || '% (US$ ' || to_char(v_dep / 100.0, 'FM999,999,999,990.00') || ').');
  perform write_audit('turnkey.quote_sent', 'tk_client_quotes', q.id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version, 'total_cents', q.total_cents, 'deposit_pct', v_pct, 'deposit_cents', v_dep,
                       'custom_branded', v.custom_branded));
  return jsonb_build_object('id', q.id, 'deposit_pct', v_pct, 'deposit_cents', v_dep, 'custom_branded', v.custom_branded);
end $function$;

create or replace function public.tk_staff_quotes(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_custom boolean;
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  select coalesce(p.custom_branded, false) into v_custom from public.tk_client_projects p where p.id = p_project;
  return jsonb_build_object(
    -- DS16: the % the next sent quote of THIS project takes (custom / branded projects: turnkey.deposit_pct_custom)
    'deposit_pct', case when v_custom then public.tk_deposit_pct_custom() else public.tk_deposit_pct() end,
    'custom_branded', coalesce(v_custom, false),
    'deposit_pct_standard', public.tk_deposit_pct(),
    'deposit_pct_custom', public.tk_deposit_pct_custom(),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'version', q.version, 'status', q.status, 'total_cents', q.total_cents,
        'deposit_pct', q.deposit_pct, 'deposit_cents', q.deposit_cents, 'message', q.message, 'client_comment', q.client_comment, 'valid_until', q.valid_until,
        'sent_at', q.sent_at, 'decided_at', q.decided_at, 'created_at', q.created_at, 'updated_at', q.updated_at,
        'created_by_name', coalesce(nullif(btrim(pc.full_name), ''), pc.email), 'sent_by_name', coalesce(nullif(btrim(ps.full_name), ''), ps.email),
        'document_id', q.document_id, 'document_number', doc.number, 'document_status', doc.status, 'paid_cents', doc.paid_cents,
        'deposit_paid', q.document_id is not null and public.tk_fee_is_paid(q.document_id),
        'cost_cents', (select sum(c.cost_cents) from public.tk_client_quote_line_costs c where c.quote_id = q.id),
        'cost_complete', not exists (select 1 from public.tk_client_quote_lines l where l.quote_id = q.id
                                       and not exists (select 1 from public.tk_client_quote_line_costs c where c.line_id = l.id)),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'description', l.description, 'qty', l.qty,
             'unit_price_cents', l.unit_price_cents, 'total_cents', l.total_cents, 'unit_cost_cents', c.unit_cost_cents, 'cost_cents', c.cost_cents,
             'factory_line_id', c.factory_line_id, 'supplier_name', fq.supplier_name) order by l.line_no)
           from public.tk_client_quote_lines l
           left join public.tk_client_quote_line_costs c on c.line_id = l.id
           left join public.tk_factory_quote_lines fl on fl.id = c.factory_line_id
           left join public.tk_factory_quotes fq on fq.id = fl.factory_quote_id
          where l.quote_id = q.id), '[]'::jsonb)) order by q.version desc)
      from public.tk_client_quotes q
      left join public.profiles pc on pc.id = q.created_by
      left join public.profiles ps on ps.id = q.sent_by
      left join public.documents doc on doc.id = q.document_id
     where q.project_id = p_project), '[]'::jsonb),
    'factory_quotes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'supplier_name', f.supplier_name, 'supplier_ref', f.supplier_ref,
        'valid_until', f.valid_until, 'notes', f.notes, 'total_cost_cents', f.total_cost_cents, 'created_at', f.created_at,
        'created_by_name', coalesce(nullif(btrim(pf.full_name), ''), pf.email),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', fl.id, 'line_no', fl.line_no, 'description', fl.description, 'qty', fl.qty,
             'unit_cost_cents', fl.unit_cost_cents, 'total_cost_cents', fl.total_cost_cents) order by fl.line_no)
           from public.tk_factory_quote_lines fl where fl.factory_quote_id = f.id), '[]'::jsonb)) order by f.created_at desc)
      from public.tk_factory_quotes f left join public.profiles pf on pf.id = f.created_by where f.project_id = p_project), '[]'::jsonb));
end $function$;

create or replace function public.tk_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (is_staff() and can('turnkey', 'view')) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'deposit_pct', public.tk_deposit_pct(),
    'deposit_pct_custom', public.tk_deposit_pct_custom(),
    'extra_traveller_day_cents', (select s.extra_traveller_day_cents from public.tk_services s where s.code = 'visit_china'),
    'included_travellers', (select s.included_travellers from public.tk_services s where s.code = 'visit_china'),
    'visit_rule_text', (select s.rule_text from public.tk_services s where s.code = 'visit_china'),
    'passport_retention_days', public.tk_passport_retention_days(),
    'passport_retention_set', exists (select 1 from public.site_settings x where x.key = 'turnkey.passport_retention_days' and jsonb_typeof(x.value) = 'number'),
    'am_waiver_threshold_cents', public.tk_am_waiver_threshold_cents(),
    'can_edit', is_admin(),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'entity_id', a.entity_id, 'details', a.details, 'at', a.created_at,
                                                             'by', coalesce(nullif(btrim(pr.full_name), ''), pr.email)) order by a.created_at desc)
                           from (select * from public.audit_log l
                                  where l.action in ('turnkey.deposit_pct', 'turnkey.deposit_pct_custom', 'turnkey.setting')
                                  order by l.created_at desc limit 20) a
                           left join public.profiles pr on pr.id = a.actor_id), '[]'::jsonb));
end $function$;

-- ───────────────────────── 9. NEW RPCs ─────────────────────────
-- 9a. Turnkey: custom / branded flag and its deposit %
create or replace function public.tk_set_project_custom(p_project uuid, p_custom boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_pct integer;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors mark a project custom / branded'; end if;
  if p_custom is null then raise exception 'INVALID_INPUT: choose custom / branded or standard'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if exists (select 1 from public.tk_client_quotes x where x.project_id = v.id and x.status = 'accepted') then
    raise exception 'QUOTE_ACCEPTED: the client accepted a quote; its deposit is fixed';
  end if;
  if v.custom_branded = p_custom then raise exception 'NO_CHANGE: the project is already marked that way'; end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 then raise exception 'REASON_REQUIRED: say why (3 to 300 characters)'; end if;
  update public.tk_client_projects set custom_branded = p_custom, updated_at = now() where id = v.id;
  v_pct := case when p_custom then public.tk_deposit_pct_custom() else public.tk_deposit_pct() end;
  perform write_audit('turnkey.project_custom', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.custom_branded, 'to', p_custom, 'reason', v_reason, 'deposit_pct', v_pct));
  return jsonb_build_object('custom_branded', p_custom, 'deposit_pct', v_pct,
    'sent_quote_open', exists (select 1 from public.tk_client_quotes x where x.project_id = v.id and x.status = 'sent'));
end $$;

create or replace function public.tk_set_deposit_pct_custom(p_pct integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer := public.tk_deposit_pct_custom();
begin
  if auth.uid() is null or not is_admin() then raise exception 'FORBIDDEN: only admins set the deposit'; end if;
  if p_pct is null or p_pct < 1 or p_pct > 100 then raise exception 'INVALID_DEPOSIT: enter a whole percentage from 1 to 100'; end if;
  perform set_setting('turnkey.deposit_pct_custom', to_jsonb(p_pct));
  update public.site_settings set description = 'Turnkey (DS16): deposit % of the accepted client quote for custom / branded projects. Frozen on each quote when it is sent.', is_public = false
   where key = 'turnkey.deposit_pct_custom';
  perform write_audit('turnkey.deposit_pct_custom', 'site_settings', 'turnkey.deposit_pct_custom', jsonb_build_object('old', v_old, 'new', p_pct));
end $$;

-- 9b. Shipping markup: page, propose, decide (a different Finance approver or admin), withdraw
create or replace function public.ds16_markup_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_set boolean;
begin
  if not public.ds16_markup_can('view') then raise exception 'FORBIDDEN: Dropship, 3PL and Finance staff only.'; end if;
  v_set := exists (select 1 from public.site_settings s where s.key = 'dropship.shipping_markup_pct' and jsonb_typeof(s.value) = 'number');
  return jsonb_build_object(
    'pct', case when v_set then public.ds16_shipping_markup_pct() end,
    'can_propose', public.ds16_markup_can('propose'),
    'can_approve', public.ds16_markup_can('approve'),
    'me', auth.uid(),
    'pending', (select jsonb_build_object('id', c.id, 'old_value', c.old_value, 'new_value', c.new_value, 'reason', c.reason, 'proposed_at', c.proposed_at,
                                          'proposed_by', c.proposed_by, 'proposed_by_name', coalesce(nullif(btrim(pr.full_name), ''), pr.email))
                  from public.dropship_setting_changes c left join public.profiles pr on pr.id = c.proposed_by
                 where c.key = 'dropship.shipping_markup_pct' and c.status = 'pending'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'status', h.status, 'old_value', h.old_value, 'new_value', h.new_value, 'reason', h.reason,
                                                             'proposed_by_name', h.pn, 'decided_by_name', h.dn, 'proposed_at', h.proposed_at, 'decided_at', h.decided_at,
                                                             'decision_note', h.decision_note) order by h.proposed_at desc)
                           from (select c.*, coalesce(nullif(btrim(p1.full_name), ''), p1.email) pn, coalesce(nullif(btrim(p2.full_name), ''), p2.email) dn
                                   from public.dropship_setting_changes c
                                   left join public.profiles p1 on p1.id = c.proposed_by
                                   left join public.profiles p2 on p2.id = c.decided_by
                                  where c.key = 'dropship.shipping_markup_pct' and c.status <> 'pending'
                                  order by c.proposed_at desc limit 20) h), '[]'::jsonb));
end $$;

create or replace function public.ds16_markup_propose(p_pct numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old jsonb := (select s.value from public.site_settings s where s.key = 'dropship.shipping_markup_pct');
  v_id uuid;
begin
  if not public.ds16_markup_can('propose') then raise exception 'FORBIDDEN: Dropship editors, Finance approvers and admins propose the shipping markup.'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 or p_pct <> round(p_pct, 2) then raise exception 'INVALID_INPUT: Enter a markup from 0 to 100 percent (up to 2 decimals).'; end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'REASON_REQUIRED: Enter the reason (3 to 500 characters).'; end if;
  if exists (select 1 from public.dropship_setting_changes c where c.key = 'dropship.shipping_markup_pct' and c.status = 'pending') then
    raise exception 'PROPOSAL_PENDING: A change is already waiting for a second approver. Approve, reject or withdraw it first.';
  end if;
  if v_old is not null and jsonb_typeof(v_old) = 'number' and (v_old #>> '{}')::numeric = p_pct then raise exception 'NO_CHANGE: The markup is already % percent.', p_pct; end if;
  insert into public.dropship_setting_changes (key, old_value, new_value, reason, status, proposed_by)
  values ('dropship.shipping_markup_pct', v_old, to_jsonb(p_pct), v_reason, 'pending', auth.uid())
  returning id into v_id;
  perform write_audit('ds_setting.proposed', 'dropship_setting_changes', v_id::text,
    jsonb_build_object('key', 'dropship.shipping_markup_pct', 'old', v_old, 'new', p_pct, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
end $$;

create or replace function public.ds16_markup_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_setting_changes;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.ds16_markup_can('approve') then raise exception 'FORBIDDEN: Only Finance approvers and admins approve the shipping markup.'; end if;
  if p_approve is null then raise exception 'INVALID_INPUT'; end if;
  select * into c from public.dropship_setting_changes where id = p_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'NOTHING_PENDING: There is no change waiting for approval.'; end if;
  if c.proposed_by is not distinct from auth.uid() then
    raise exception 'SECOND_PERSON_REQUIRED: Another Finance approver or an admin must approve or reject this change.';
  end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then raise exception 'REASON_REQUIRED: Say why you reject the change.'; end if;
  if p_approve then
    perform set_config('octopus.ds16_setting_change', 'on', true);
    insert into public.site_settings (key, value, description, is_public, updated_by, updated_at)
    values (c.key, c.new_value, 'Dropship (DS16): shipping markup % on the YunExpress rate-card cost in the merchant''s shipping line. Two people change it.', false, auth.uid(), now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
    perform set_config('octopus.ds16_setting_change', '', true);
  end if;
  update public.dropship_setting_changes
     set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = c.id;
  perform write_audit(case when p_approve then 'ds_setting.approved' else 'ds_setting.rejected' end, 'dropship_setting_changes', c.id::text,
    jsonb_build_object('key', c.key, 'old', c.old_value, 'new', c.new_value, 'proposed_by', c.proposed_by, 'note', v_note));
  return jsonb_build_object('ok', true, 'approved', p_approve, 'pct', case when p_approve then (c.new_value #>> '{}')::numeric end);
end $$;

create or replace function public.ds16_markup_withdraw(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.dropship_setting_changes;
begin
  if not public.ds16_markup_can('propose') then raise exception 'FORBIDDEN'; end if;
  select * into c from public.dropship_setting_changes where id = p_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'NOTHING_PENDING: There is no change waiting for approval.'; end if;
  if c.proposed_by is distinct from auth.uid() then raise exception 'NOT_YOURS: Only the person who proposed it can withdraw it.'; end if;
  update public.dropship_setting_changes set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = c.id;
  perform write_audit('ds_setting.withdrawn', 'dropship_setting_changes', c.id::text, jsonb_build_object('key', c.key, 'new', c.new_value));
  return jsonb_build_object('ok', true);
end $$;

-- 9c. Supplier bank details (two people)
create or replace function public.ds16_supplier_bank_page(p_supplier uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_full boolean := public.ds14_staff_can('suppliers_edit') or ((can('suppliers', 'approve') or can('finance', 'approve') or coalesce(is_admin(), false)) and coalesce(staff_aal_ok(), false));
  v_cur public.supplier_bank_detail_changes;
  v_pen public.supplier_bank_detail_changes;
begin
  if not (public.ds14_staff_can('suppliers_view') or v_full) then raise exception 'FORBIDDEN: Supplier staff only.'; end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier) then raise exception 'NOT_FOUND'; end if;
  select * into v_cur from public.supplier_bank_detail_changes where supplier_id = p_supplier and status = 'approved' order by decided_at desc limit 1;
  select * into v_pen from public.supplier_bank_detail_changes where supplier_id = p_supplier and status = 'pending';
  return jsonb_build_object(
    'current', case when v_cur.id is null then null
                    else case when v_full then v_cur.details else v_cur.details - 'account_no' - 'iban' || jsonb_build_object('account_no', '•••• ' || right(coalesce(v_cur.details ->> 'account_no', ''), 4)) end
                         || jsonb_build_object('approved_at', v_cur.decided_at) end,
    'pending', case when v_pen.id is null then null else jsonb_build_object('id', v_pen.id, 'proposed_by', v_pen.proposed_by, 'proposed_at', v_pen.proposed_at, 'reason', v_pen.reason,
                    'details', case when v_full then v_pen.details else v_pen.details - 'account_no' - 'iban' end) end,
    'me', auth.uid(),
    'can_propose', public.ds14_staff_can('suppliers_edit'),
    'can_approve', (can('suppliers', 'approve') or can('finance', 'approve') or coalesce(is_admin(), false)) and coalesce(staff_aal_ok(), false));
end $$;

create or replace function public.ds16_supplier_bank_propose(p_supplier uuid, p jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  d jsonb;
  v_id uuid;
begin
  if not public.ds14_staff_can('suppliers_edit') then raise exception 'FORBIDDEN: Supplier editors propose bank details.'; end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier and s.archived_at is null) then raise exception 'NOT_FOUND: Supplier not found.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  d := jsonb_strip_nulls(jsonb_build_object(
    'account_name', nullif(btrim(p ->> 'account_name'), ''), 'bank_name', nullif(btrim(p ->> 'bank_name'), ''),
    'account_no', nullif(upper(regexp_replace(coalesce(p ->> 'account_no', ''), '\s', '', 'g')), ''),
    'swift', nullif(upper(btrim(coalesce(p ->> 'swift', ''))), ''), 'iban', nullif(upper(regexp_replace(coalesce(p ->> 'iban', ''), '\s', '', 'g')), ''),
    'currency', nullif(upper(btrim(coalesce(p ->> 'currency', ''))), ''), 'bank_country', nullif(upper(btrim(coalesce(p ->> 'bank_country', ''))), '')));
  if length(coalesce(d ->> 'account_name', '')) not between 2 and 140 or length(coalesce(d ->> 'bank_name', '')) not between 2 and 140 then
    raise exception 'INVALID_INPUT: Enter the account name and the bank name.';
  end if;
  if coalesce(d ->> 'account_no', '') !~ '^[A-Z0-9-]{4,40}$' then raise exception 'INVALID_INPUT: Enter the account number (4 to 40 letters or digits).'; end if;
  if d ? 'swift' and d ->> 'swift' !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then raise exception 'INVALID_INPUT: The SWIFT / BIC code has 8 or 11 characters.'; end if;
  if d ? 'iban' and d ->> 'iban' !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' then raise exception 'INVALID_INPUT: Check the IBAN.'; end if;
  if d ? 'currency' and d ->> 'currency' !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT: Currency is a 3-letter code.'; end if;
  if d ? 'bank_country' and d ->> 'bank_country' !~ '^[A-Z]{2}$' then raise exception 'INVALID_INPUT: Bank country is a 2-letter code.'; end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'REASON_REQUIRED: Say where the new details come from (3 to 500 characters).'; end if;
  if exists (select 1 from public.supplier_bank_detail_changes c where c.supplier_id = p_supplier and c.status = 'pending') then
    raise exception 'PROPOSAL_PENDING: A bank-detail change is already waiting for a second approver.';
  end if;
  insert into public.supplier_bank_detail_changes (supplier_id, details, reason, proposed_by) values (p_supplier, d, v_reason, auth.uid()) returning id into v_id;
  perform write_audit('supplier_bank.proposed', 'supplier_bank_detail_changes', v_id::text,
    jsonb_build_object('supplier_id', p_supplier, 'account_last4', right(d ->> 'account_no', 4), 'bank_name', d ->> 'bank_name', 'reason', v_reason));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
end $$;

create or replace function public.ds16_supplier_bank_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.supplier_bank_detail_changes;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not ((can('suppliers', 'approve') or can('finance', 'approve') or coalesce(is_admin(), false)) and coalesce(staff_aal_ok(), false)) then
    raise exception 'FORBIDDEN: Supplier approvers, Finance approvers and admins approve bank details.';
  end if;
  if p_approve is null then raise exception 'INVALID_INPUT'; end if;
  select * into c from public.supplier_bank_detail_changes where id = p_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'NOTHING_PENDING: There is no bank-detail change waiting for approval.'; end if;
  if c.proposed_by = auth.uid() then raise exception 'SECOND_PERSON_REQUIRED: A different person must approve the bank details you proposed.'; end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then raise exception 'REASON_REQUIRED: Say why you reject the change.'; end if;
  update public.supplier_bank_detail_changes
     set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = c.id;
  perform write_audit(case when p_approve then 'supplier_bank.approved' else 'supplier_bank.rejected' end, 'supplier_bank_detail_changes', c.id::text,
    jsonb_build_object('supplier_id', c.supplier_id, 'proposed_by', c.proposed_by, 'account_last4', right(c.details ->> 'account_no', 4), 'note', v_note));
  return jsonb_build_object('ok', true, 'approved', p_approve);
end $$;

-- ───────────────────────── 10. Grants ─────────────────────────
do $$
declare
  r record;
  rpc text[] := array['tk_set_project_custom', 'tk_set_deposit_pct_custom', 'ds16_markup_page', 'ds16_markup_propose', 'ds16_markup_decide', 'ds16_markup_withdraw',
    'ds16_supplier_bank_page', 'ds16_supplier_bank_propose', 'ds16_supplier_bank_decide', 'ds_staff_rules_save_v2'];
  internals text[] := array['ds16_shipping_markup_pct', 'ds16_markup_pct_at', 'ds16_country_rule', 'ds16_last_movement_at', 'ds16_notify_ds_staff', 'ds16_markup_can',
    'tk_deposit_pct_custom', 'ds16_guard_protected_settings', 'ds16_duty_mode_guard', 'ds16_supplier_application_guard'];
begin
  for r in select p.oid::regprocedure::text sig, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (rpc || internals) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.proname = any (rpc) then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;

-- ───────────────────────── 11. Owner values (26 Nov 2026) ─────────────────────────
select set_config('octopus.ds16_setting_change', 'on', true);
insert into public.site_settings (key, value, description, is_public, updated_at) values
  ('turnkey.deposit_pct', '30'::jsonb, 'Turnkey T4: deposit % of the accepted client quote, invoiced on acceptance (D5). Frozen on each quote when it is sent.', false, now()),
  ('turnkey.deposit_pct_custom', '50'::jsonb, 'Turnkey (DS16): deposit % of the accepted client quote for custom / branded projects. Frozen on each quote when it is sent.', false, now()),
  ('dropship.shipping_markup_pct', '10'::jsonb, 'Dropship (DS16): shipping markup % on the YunExpress rate-card cost in the merchant''s shipping line. Two people change it.', false, now()),
  ('dropship_launch_countries', '["AE", "SA", "GB", "US"]'::jsonb, 'EA-2: countries listed on the public Dropship page (ISO-2). Empty = not listed.', true, now()),
  ('dropship.country_duty_rules', '{"US": {"incoterm": "DDP", "de_minimis_cents": 0}}'::jsonb, 'Dropship (DS16): per-country duty rules. US = DDP only, no de minimis (duty always charged).', false, now()),
  ('dropship.claim_window_days', '7'::jsonb, 'Dropship (DS10/DS16): damaged or wrong item — photos within N days of delivery.', false, now()),
  ('dropship.lost_after_days', '15'::jsonb, 'Dropship (DS16): a parcel counts as lost after N days without tracking movement → reship or wallet refund.', false, now()),
  ('dropship.reweigh_dispute_days', '7'::jsonb, 'Dropship (DS16): re-weigh charges can be disputed within N days (when the fee version sets no dispute window).', false, now()),
  ('dropship.claim_second_approver_over_cents', '100000'::jsonb, 'Dropship (DS16): refunds / claims above this many US cents need a second, different Finance approver.', false, now())
on conflict (key) do update set value = excluded.value, updated_at = now(), description = coalesce(public.site_settings.description, excluded.description);
-- buyer-facing returns text (owner rules, buyer remorse = the merchant's own policy)
insert into public.site_settings (key, value, description, is_public, updated_at)
values ('dropship.returns', to_jsonb('Damaged or wrong item: send photos within 7 days of delivery and we reship it or refund your wallet. Lost parcel: no tracking movement for 15 days and we reship it or refund your wallet. Change of mind: your own store policy applies and you pay the return shipping. Refunds go to your wallet.'::text),
        'Dropship: returns and claims text shown to merchants.', false, now())
on conflict (key) do update set value = excluded.value, updated_at = now();
insert into public.site_settings (key, value, description, is_public, updated_at)
values ('dropship_supplier_rules', '{"price_auto_pct": 3, "price_cum_30d_pct": 5}'::jsonb,
        'Octopus Dropship supplier portal rules (decreases applied at once; increases up to N percent applied at once unless the 30-day total passes M percent; ship within N days)', false, now())
on conflict (key) do update set value = coalesce(public.site_settings.value, '{}'::jsonb) || excluded.value, updated_at = now();
-- the markup history starts with the owner's value (the re-weigh check uses the value in force when an order was placed)
insert into public.dropship_setting_changes (key, old_value, new_value, reason, status, decided_at)
select 'dropship.shipping_markup_pct', null, '10'::jsonb, 'Owner decision 26 Nov 2026 (migration 249)', 'seeded', now()
 where not exists (select 1 from public.dropship_setting_changes c where c.key = 'dropship.shipping_markup_pct' and c.status = 'seeded');
select set_config('octopus.ds16_setting_change', '', true);

do $$
declare r record;
begin
  -- one audit row per value this migration changed (Turnkey deposit changes use the action the Turnkey settings page lists)
  for r in select b.key, b.row -> 'value' old_value, s.value new_value from public.ds16_settings_backup b join public.site_settings s on s.key = b.key
            where (b.row -> 'value') is distinct from s.value
              and not exists (select 1 from public.audit_log l where l.entity = 'site_settings' and l.entity_id = b.key and l.details ->> 'source' = 'owner decision 26 Nov 2026 (migration 249)') loop
    perform public.write_audit(case when r.key in ('turnkey.deposit_pct', 'turnkey.deposit_pct_custom') then r.key else 'setting.update' end,
      'site_settings', r.key, jsonb_build_object('old', r.old_value, 'new', r.new_value, 'source', 'owner decision 26 Nov 2026 (migration 249)'));
  end loop;
end $$;
