-- 20261101000239_w4_carriers_dispatch_tracking.sql
-- Warehouse OS · W4 (carriers and rules, parcel labels, label check, dispatch and freight, customer tracking). Design:
-- docs/design/warehouse-os §3 steps 10–11; boards 7 (customer tracking page), 9 (Carriers and rules), 11 (Label centre, parcel
-- labels), 13 (Freight pallet build); §7 "only admins change carrier rules"; decision D7 (two people for carrier rules) and D10
-- (B2B shipping moves into Warehouse OS; /office/shipping keeps working until W7 — nothing of it is changed here).
--  1. Carrier accounts per warehouse (YunExpress, 4PX) with a mode: 'sandbox' (staging only — the database refuses it unless
--     site_settings.app_environment = 'staging') or 'live'. Credentials are NEVER stored: an account names the server
--     environment-variable prefix that holds them (e.g. FOURPX_FS01 → FOURPX_FS01_APP_KEY / FOURPX_FS01_APP_SECRET).
--     Services per account (carrier product code, level, max weight, battery / liquid accepted).
--  2. Carrier rules per warehouse as versions: ordered rules (countries, product type from the order's dangerous goods, weight
--     range in grams) → service, plus a fallback service. Proposed by a warehouse admin, approved by a DIFFERENT warehouse admin
--     or company admin (function check + CHECK constraint). wh_carrier_pick() returns the chosen service and the reason.
--  3. Labels: one carrier label per closed parcel (W3b parcels; the W3a one-parcel close is parcel 1). The adapter (lib/carriers)
--     creates the label; the PDF goes to the private 'wh-labels' bucket; wh_label_record() checks the file and stores the tracking
--     number. Every parcel labelled → order 'labelled'. Label check: the scanned label must belong to the order (else refused,
--     logged and a 'label' exception is raised on the W3b queue); the right label resolves it.
--  4. Dispatch: batches per carrier account; confirmed labels are scanned in; hand-over closes the batch (manifest) → parcels
--     'handed_over'; an order whose every parcel is out is 'shipped' and gets a customer tracking token.
--  5. Freight pallets (board 13): parcels of 3PL client orders grouped on an outbound pallet (no carrier label), closed with weight
--     and size, pallet label, dispatched to a forwarder.
--  6. Tracking: events per label or pallet (carrier polling / staff entry / staging-only sandbox steps). Public page data through
--     wh_public_tracking(token): "packed and shipped from {warehouse city}", events, no carrier / supplier / buyer / merchant
--     names; sandbox shipments are never served unless the database is staging. Octopus Dropship orders: at hand-over a row in the
--     existing shipments table is created for the store order (existing tracking_token, domain event → store sync, merchant status)
--     and later events are mirrored into tracking_events — the Dropship functions themselves are not changed.
--  Writes only through wh_* security-definer functions; staff-only tables (RLS wh_sees); integer grams; audit-logged.
--  No existing function is replaced (wipe_demo_data included): new rows hang off wh_orders / wh_parcels with ON DELETE CASCADE.
-- Down: supabase/migrations/down/20261101000239_w4_carriers_dispatch_tracking.down.sql

create sequence if not exists public.seq_wh_shipment;
create sequence if not exists public.seq_wh_dispatch;
create sequence if not exists public.seq_wh_freight;
revoke all on sequence public.seq_wh_shipment from public, anon, authenticated;
revoke all on sequence public.seq_wh_dispatch from public, anon, authenticated;
revoke all on sequence public.seq_wh_freight from public, anon, authenticated;
grant all on sequence public.seq_wh_shipment to service_role;
grant all on sequence public.seq_wh_dispatch to service_role;
grant all on sequence public.seq_wh_freight to service_role;

-- board 31: labelling and hand-over is its own line in the roles table (packers, supervisors, admins)
insert into public.wh_role_capabilities (role, action, label, sort)
select r, 'dispatch', 'Label parcels, check labels and hand them over', 12
  from unnest(array['packer', 'supervisor', 'admin']) r
on conflict do nothing;

-- the existing shipments table (Dropship store-order tracking) references carriers(code); 4PX is added NOT active so nothing
-- that counts active carriers changes until a live 4PX account exists
insert into public.carriers (code, name, active) values ('4px', '4PX', false) on conflict (code) do nothing;

-- ───────── 1. Carrier accounts and services ─────────
create table if not exists public.wh_carrier_accounts (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  carrier text not null check (carrier in ('yunexpress', '4px')),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  mode text not null check (mode in ('sandbox', 'live')),
  -- server environment-variable PREFIX that holds the API credentials (never the credentials themselves)
  credential_env text check (credential_env is null or credential_env ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_carrier_accounts_name_per_wh unique (warehouse_code, name),
  constraint wh_carrier_accounts_live_env check (mode <> 'live' or credential_env is not null)
);
comment on table public.wh_carrier_accounts is 'Warehouse OS: carrier accounts per warehouse (YunExpress / 4PX). mode sandbox = staging only; credential_env = name of the server env-var prefix (credentials are never stored). Staff only.';
alter table public.wh_carrier_accounts enable row level security;
revoke all on public.wh_carrier_accounts from public, anon, authenticated;
grant select on public.wh_carrier_accounts to authenticated;
grant all on public.wh_carrier_accounts to service_role;
drop policy if exists wh_carrier_accounts_read on public.wh_carrier_accounts;
create policy wh_carrier_accounts_read on public.wh_carrier_accounts for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_carrier_services (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.wh_carrier_accounts(id) on delete restrict,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$'),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  level text not null default 'standard' check (level in ('economy', 'standard', 'express')),
  max_weight_g integer check (max_weight_g is null or max_weight_g between 1 and 1000000),
  accepts_battery boolean not null default false,
  accepts_liquid boolean not null default false,
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_carrier_services_code_per_account unique (account_id, code)
);
create index if not exists wh_carrier_services_wh_idx on public.wh_carrier_services (warehouse_code);
comment on table public.wh_carrier_services is 'Warehouse OS: carrier services (product codes) per account: level, max weight (g), battery / liquid accepted. Staff only.';
alter table public.wh_carrier_services enable row level security;
revoke all on public.wh_carrier_services from public, anon, authenticated;
grant select on public.wh_carrier_services to authenticated;
grant all on public.wh_carrier_services to service_role;
drop policy if exists wh_carrier_services_read on public.wh_carrier_services;
create policy wh_carrier_services_read on public.wh_carrier_services for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 2. Carrier rule versions (two people) and rules ─────────
create table if not exists public.wh_carrier_rule_versions (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  version integer not null check (version >= 1),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'active', 'superseded', 'rejected')),
  fallback_service_id uuid not null references public.wh_carrier_services(id) on delete restrict,
  note text check (note is null or length(note) <= 500),
  proposed_by uuid references auth.users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  reject_reason text check (reject_reason is null or length(reject_reason) <= 500),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  -- D7: the person who approves is never the person who proposed
  constraint wh_carrier_rule_versions_two_person check (approved_by is null or approved_by is distinct from proposed_by),
  constraint wh_carrier_rule_versions_approved check (status not in ('active', 'superseded') or approved_at is not null),
  constraint wh_carrier_rule_versions_rejected check (status <> 'rejected' or nullif(btrim(coalesce(reject_reason, '')), '') is not null)
);
create unique index if not exists wh_carrier_rule_versions_one_active_idx on public.wh_carrier_rule_versions (warehouse_code) where status = 'active';
create unique index if not exists wh_carrier_rule_versions_one_pending_idx on public.wh_carrier_rule_versions (warehouse_code) where status = 'pending_approval';
create unique index if not exists wh_carrier_rule_versions_version_idx on public.wh_carrier_rule_versions (warehouse_code, version);
comment on table public.wh_carrier_rule_versions is 'Warehouse OS: carrier rule versions per warehouse (board 9). Proposed by a warehouse admin, approved by a different admin (D7). One active, one waiting. Staff only.';
alter table public.wh_carrier_rule_versions enable row level security;
revoke all on public.wh_carrier_rule_versions from public, anon, authenticated;
grant select on public.wh_carrier_rule_versions to authenticated;
grant all on public.wh_carrier_rule_versions to service_role;
drop policy if exists wh_carrier_rule_versions_read on public.wh_carrier_rule_versions;
create policy wh_carrier_rule_versions_read on public.wh_carrier_rule_versions for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_carrier_rules (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.wh_carrier_rule_versions(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  seq smallint not null check (seq between 1 and 50),
  countries text[] not null default '{}',
  product_type text not null default 'any' check (product_type in ('any', 'general', 'battery', 'liquid', 'dangerous')),
  min_weight_g integer check (min_weight_g is null or min_weight_g between 0 and 1000000),
  max_weight_g integer check (max_weight_g is null or max_weight_g between 1 and 1000000),
  service_id uuid not null references public.wh_carrier_services(id) on delete restrict,
  constraint wh_carrier_rules_seq_per_version unique (version_id, seq),
  constraint wh_carrier_rules_weights check (min_weight_g is null or max_weight_g is null or min_weight_g <= max_weight_g),
  constraint wh_carrier_rules_countries check (cardinality(countries) <= 250 and array_to_string(countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$')
);
comment on table public.wh_carrier_rules is 'Warehouse OS: ordered carrier rules of a version: countries (empty = any), product type (any / general = no dangerous goods / battery / liquid / dangerous = any), weight range (g) → service. Staff only.';
alter table public.wh_carrier_rules enable row level security;
revoke all on public.wh_carrier_rules from public, anon, authenticated;
grant select on public.wh_carrier_rules to authenticated;
grant all on public.wh_carrier_rules to service_role;
drop policy if exists wh_carrier_rules_read on public.wh_carrier_rules;
create policy wh_carrier_rules_read on public.wh_carrier_rules for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 3. Dispatch batches, freight pallets, labels, label scans, tracking events ─────────
create table if not exists public.wh_dispatches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('DP-' || lpad(nextval('public.seq_wh_dispatch')::text, 6, '0')),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  account_id uuid not null references public.wh_carrier_accounts(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'handed_over', 'cancelled')),
  manifest_no text check (manifest_no is null or (btrim(manifest_no) <> '' and length(manifest_no) <= 64)),
  handed_to text check (handed_to is null or length(handed_to) <= 120),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_dispatches_handed_over check (status <> 'handed_over' or (closed_at is not null and manifest_no is not null and nullif(btrim(coalesce(handed_to, '')), '') is not null)),
  constraint wh_dispatches_cancelled check (status <> 'cancelled' or nullif(btrim(coalesce(cancel_reason, '')), '') is not null)
);
create unique index if not exists wh_dispatches_one_open_idx on public.wh_dispatches (account_id) where status = 'open';
create index if not exists wh_dispatches_wh_idx on public.wh_dispatches (warehouse_code, created_at desc);
comment on table public.wh_dispatches is 'Warehouse OS: hand-over batches per carrier account (DP-######) with the manifest number and who took them. Staff only.';
alter table public.wh_dispatches enable row level security;
revoke all on public.wh_dispatches from public, anon, authenticated;
grant select on public.wh_dispatches to authenticated;
grant all on public.wh_dispatches to service_role;
drop policy if exists wh_dispatches_read on public.wh_dispatches;
create policy wh_dispatches_read on public.wh_dispatches for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_freight_pallets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('FP-' || lpad(nextval('public.seq_wh_freight')::text, 6, '0')),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed', 'dispatched')),
  destination text not null check (btrim(destination) <> '' and length(destination) <= 160),
  gross_weight_g integer check (gross_weight_g is null or gross_weight_g between 1 and 5000000),
  length_mm integer check (length_mm is null or length_mm between 1 and 5000),
  width_mm integer check (width_mm is null or width_mm between 1 and 5000),
  height_mm integer check (height_mm is null or height_mm between 1 and 5000),
  forwarder text check (forwarder is null or length(forwarder) <= 120),
  reference text check (reference is null or length(reference) <= 64),
  created_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  dispatched_by uuid references auth.users(id) on delete set null,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_freight_pallets_closed check (status = 'open' or (closed_at is not null and gross_weight_g is not null and length_mm is not null and width_mm is not null and height_mm is not null)),
  constraint wh_freight_pallets_dispatched check (status <> 'dispatched' or (dispatched_at is not null and nullif(btrim(coalesce(forwarder, '')), '') is not null))
);
create index if not exists wh_freight_pallets_wh_idx on public.wh_freight_pallets (warehouse_code, status, created_at desc);
comment on table public.wh_freight_pallets is 'Warehouse OS: outbound freight pallets (FP-######, board 13): parcels of client orders, weight and size, forwarder. Staff only.';
alter table public.wh_freight_pallets enable row level security;
revoke all on public.wh_freight_pallets from public, anon, authenticated;
grant select on public.wh_freight_pallets to authenticated;
grant all on public.wh_freight_pallets to service_role;
drop policy if exists wh_freight_pallets_read on public.wh_freight_pallets;
create policy wh_freight_pallets_read on public.wh_freight_pallets for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_freight_parcels (
  parcel_id uuid primary key references public.wh_parcels(id) on delete cascade,
  pallet_id uuid not null references public.wh_freight_pallets(id) on delete cascade,
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now()
);
create index if not exists wh_freight_parcels_pallet_idx on public.wh_freight_parcels (pallet_id);
create index if not exists wh_freight_parcels_order_idx on public.wh_freight_parcels (order_id);
comment on table public.wh_freight_parcels is 'Warehouse OS: parcels on a freight pallet (one pallet per parcel). Staff only.';
alter table public.wh_freight_parcels enable row level security;
revoke all on public.wh_freight_parcels from public, anon, authenticated;
grant select on public.wh_freight_parcels to authenticated;
grant all on public.wh_freight_parcels to service_role;
drop policy if exists wh_freight_parcels_read on public.wh_freight_parcels;
create policy wh_freight_parcels_read on public.wh_freight_parcels for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_shipments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('WS-' || lpad(nextval('public.seq_wh_shipment')::text, 6, '0')),
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  parcel_id uuid not null references public.wh_parcels(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  account_id uuid not null references public.wh_carrier_accounts(id) on delete restrict,
  service_id uuid not null references public.wh_carrier_services(id) on delete restrict,
  carrier text not null check (carrier in ('yunexpress', '4px')),
  service_code text not null,
  service_name text not null,
  rule_version_id uuid references public.wh_carrier_rule_versions(id) on delete set null,
  rule_reason text check (rule_reason is null or length(rule_reason) <= 600),
  tracking_no text not null check (tracking_no ~ '^[A-Z0-9-]{6,40}$'),
  label_path text not null check (length(label_path) <= 200),
  sandbox boolean not null,
  weight_g integer check (weight_g is null or weight_g between 1 and 1000000),
  status text not null default 'labelled' check (status in ('labelled', 'confirmed', 'handed_over', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'voided')),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  dispatch_id uuid references public.wh_dispatches(id) on delete set null,
  handed_over_at timestamptz,
  handed_over_by uuid references auth.users(id) on delete set null,
  delivered_at timestamptz,
  last_event_at timestamptz,
  -- Octopus Dropship: the existing shipments row created for the store order at hand-over (store sync, /t/ token)
  legacy_shipment_id uuid references public.shipments(id) on delete set null,
  void_reason text check (void_reason is null or length(void_reason) <= 300),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a sandbox label always says so in its number; a live one never does
  constraint wh_shipments_sandbox_no check (sandbox = (tracking_no like 'SBX%')),
  constraint wh_shipments_confirmed check (status in ('labelled', 'voided') or confirmed_at is not null),
  constraint wh_shipments_handed_over check (status in ('labelled', 'confirmed', 'voided') or handed_over_at is not null),
  constraint wh_shipments_voided check (status <> 'voided' or (voided_at is not null and nullif(btrim(coalesce(void_reason, '')), '') is not null))
);
create unique index if not exists wh_shipments_one_label_idx on public.wh_shipments (parcel_id) where status <> 'voided';
create unique index if not exists wh_shipments_tracking_idx on public.wh_shipments (carrier, tracking_no) where status <> 'voided';
create index if not exists wh_shipments_order_idx on public.wh_shipments (order_id);
create index if not exists wh_shipments_wh_status_idx on public.wh_shipments (warehouse_code, status, created_at desc);
create index if not exists wh_shipments_dispatch_idx on public.wh_shipments (dispatch_id) where dispatch_id is not null;
comment on table public.wh_shipments is 'Warehouse OS: carrier label per parcel (WS-######): service and why it was chosen, tracking number, label PDF (private bucket wh-labels), sandbox flag, label check, hand-over, tracking status. Staff only; customers read tracking through wh_public_tracking().';
alter table public.wh_shipments enable row level security;
revoke all on public.wh_shipments from public, anon, authenticated;
grant select on public.wh_shipments to authenticated;
grant all on public.wh_shipments to service_role;
drop policy if exists wh_shipments_read on public.wh_shipments;
create policy wh_shipments_read on public.wh_shipments for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_label_scans (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  shipment_id uuid references public.wh_shipments(id) on delete cascade,
  code text not null check (length(code) <= 128),
  result text not null check (result in ('ok', 'already', 'wrong_parcel', 'wrong_order', 'voided', 'unknown')),
  exception_id uuid references public.wh_exceptions(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wh_label_scans_order_idx on public.wh_label_scans (order_id, created_at);
create index if not exists wh_label_scans_wh_idx on public.wh_label_scans (warehouse_code, created_at desc);
comment on table public.wh_label_scans is 'Warehouse OS: label check scans (the label read on the parcel must belong to the order). Refused scans are kept. Staff only.';
alter table public.wh_label_scans enable row level security;
revoke all on public.wh_label_scans from public, anon, authenticated;
grant select on public.wh_label_scans to authenticated;
grant all on public.wh_label_scans to service_role;
drop policy if exists wh_label_scans_read on public.wh_label_scans;
create policy wh_label_scans_read on public.wh_label_scans for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_tracking_events (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  shipment_id uuid references public.wh_shipments(id) on delete cascade,
  pallet_id uuid references public.wh_freight_pallets(id) on delete cascade,
  status text not null check (status in ('handed_over', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'info')),
  description text not null check (btrim(description) <> '' and length(description) <= 300),
  location text check (location is null or length(location) <= 120),
  occurred_at timestamptz not null,
  source text not null check (source in ('carrier', 'staff', 'sandbox', 'system')),
  provider_event_id text unique check (provider_event_id is null or length(provider_event_id) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wh_tracking_events_target check ((shipment_id is not null) <> (pallet_id is not null))
);
create index if not exists wh_tracking_events_shipment_idx on public.wh_tracking_events (shipment_id, occurred_at) where shipment_id is not null;
create index if not exists wh_tracking_events_pallet_idx on public.wh_tracking_events (pallet_id, occurred_at) where pallet_id is not null;
comment on table public.wh_tracking_events is 'Warehouse OS: tracking events of a label or a freight pallet (carrier polling, staff entry, staging-only sandbox steps). The description is what the end customer reads. Staff only; customers read them through wh_public_tracking().';
alter table public.wh_tracking_events enable row level security;
revoke all on public.wh_tracking_events from public, anon, authenticated;
grant select on public.wh_tracking_events to authenticated;
grant all on public.wh_tracking_events to service_role;
drop policy if exists wh_tracking_events_read on public.wh_tracking_events;
create policy wh_tracking_events_read on public.wh_tracking_events for select to authenticated using (public.wh_sees(warehouse_code));

-- customer tracking on the order (the client reads its own orders' token and ship date; RLS = own company)
alter table public.wh_orders add column if not exists tracking_token text unique check (tracking_token is null or tracking_token ~ '^[0-9a-f]{32,64}$');
alter table public.wh_orders add column if not exists shipped_at timestamptz;
grant select (tracking_token, shipped_at) on public.wh_orders to authenticated;

-- ───────── 4. Internal helpers ─────────
-- is this database the staging project? (sandbox carriers and sandbox tracking exist only there)
create or replace function public.wh_env_is_staging()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value #>> '{}' from public.site_settings where key = 'app_environment'), '') = 'staging'
$$;
revoke all on function public.wh_env_is_staging() from public, anon, authenticated;
grant execute on function public.wh_env_is_staging() to service_role;

-- does a rule's product type match the order's dangerous goods?
create or replace function public.wh_product_type_matches(p_type text, p_dg text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select case coalesce(p_type, 'any')
    when 'any' then true
    when 'general' then cardinality(coalesce(p_dg, '{}')) = 0
    when 'battery' then 'battery' = any(coalesce(p_dg, '{}'))
    when 'liquid' then 'liquid' = any(coalesce(p_dg, '{}'))
    when 'dangerous' then cardinality(coalesce(p_dg, '{}')) > 0
    else false end
$$;
revoke all on function public.wh_product_type_matches(text, text[]) from public, anon, authenticated;
grant execute on function public.wh_product_type_matches(text, text[]) to service_role;

-- a rule in words: "DE, FR · battery · up to 2,000 g"
create or replace function public.wh_carrier_rule_text(p_countries text[], p_type text, p_min integer, p_max integer)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(' · ',
    case when cardinality(coalesce(p_countries, '{}')) = 0 then 'any country' else array_to_string(p_countries, ', ') end,
    case coalesce(p_type, 'any') when 'any' then 'any product' when 'general' then 'no dangerous goods' when 'battery' then 'battery'
      when 'liquid' then 'liquid' when 'dangerous' then 'any dangerous goods' else p_type end,
    case when p_min is null and p_max is null then 'any weight'
         when p_max is null then format('from %s g', to_char(p_min, 'FM999G999G990'))
         when p_min is null then format('up to %s g', to_char(p_max, 'FM999G999G990'))
         else format('%s–%s g', to_char(p_min, 'FM999G999G990'), to_char(p_max, 'FM999G999G990')) end)
$$;
revoke all on function public.wh_carrier_rule_text(text[], text, integer, integer) from public, anon, authenticated;
grant execute on function public.wh_carrier_rule_text(text[], text, integer, integer) to service_role;

-- why a service can't carry this parcel (NULL = it can)
create or replace function public.wh_service_problem(p_service uuid, p_dg text[], p_weight_g integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.wh_carrier_services;
  a public.wh_carrier_accounts;
begin
  select * into s from public.wh_carrier_services where id = p_service;
  select * into a from public.wh_carrier_accounts where id = s.account_id;
  if s.id is null or a.id is null then return 'service not found'; end if;
  if not s.active then return format('%s is switched off', s.name); end if;
  if not a.active then return format('account %s is switched off', a.name); end if;
  if a.mode = 'sandbox' and not public.wh_env_is_staging() then return format('%s is a sandbox account (staging only)', a.name); end if;
  if 'battery' = any(coalesce(p_dg, '{}')) and not s.accepts_battery then return format('%s does not take batteries', s.name); end if;
  if 'liquid' = any(coalesce(p_dg, '{}')) and not s.accepts_liquid then return format('%s does not take liquids', s.name); end if;
  if s.max_weight_g is not null and p_weight_g is not null and p_weight_g > s.max_weight_g then
    return format('%s takes up to %s g', s.name, to_char(s.max_weight_g, 'FM999G999G990'));
  end if;
  return null;
end $$;
revoke all on function public.wh_service_problem(uuid, text[], integer) from public, anon, authenticated;
grant execute on function public.wh_service_problem(uuid, text[], integer) to service_role;

-- ───────── 5. Rule evaluation (board 9) ─────────
-- First rule (in order) whose countries, product type and weight match AND whose service can carry the parcel; otherwise the
-- fallback (when it can carry it); otherwise no service. p_version NULL = the warehouse's active version.
create or replace function public.wh_carrier_pick(p_warehouse text, p_country text, p_dg text[], p_weight_g integer, p_version uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.wh_carrier_rule_versions;
  r record;
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_dg text[] := coalesce(p_dg, '{}');
  v_problem text;
  v_skipped jsonb := '[]'::jsonb;
  v_text text;
  s record;
begin
  if auth.uid() is not null and not public.wh_sees(p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if p_version is null then
    select * into v from public.wh_carrier_rule_versions where warehouse_code = p_warehouse and status = 'active';
  else
    select * into v from public.wh_carrier_rule_versions where id = p_version and warehouse_code = p_warehouse;
  end if;
  if v.id is null then
    return jsonb_build_object('ok', false, 'service_id', null, 'rule_version_id', null, 'rule_seq', null, 'fallback', false, 'skipped', v_skipped,
      'reason', format('No approved carrier rules at %s yet', p_warehouse));
  end if;
  for r in select * from public.wh_carrier_rules where version_id = v.id order by seq loop
    if cardinality(r.countries) > 0 and not (v_country = any(r.countries)) then continue; end if;
    if not public.wh_product_type_matches(r.product_type, v_dg) then continue; end if;
    if (r.min_weight_g is not null or r.max_weight_g is not null) and p_weight_g is null then
      v_skipped := v_skipped || jsonb_build_object('seq', r.seq, 'why', 'weight unknown');
      continue;
    end if;
    if r.min_weight_g is not null and p_weight_g < r.min_weight_g then continue; end if;
    if r.max_weight_g is not null and p_weight_g > r.max_weight_g then continue; end if;
    v_problem := public.wh_service_problem(r.service_id, v_dg, p_weight_g);
    if v_problem is not null then
      v_skipped := v_skipped || jsonb_build_object('seq', r.seq, 'why', v_problem);
      continue;
    end if;
    v_text := public.wh_carrier_rule_text(r.countries, r.product_type, r.min_weight_g, r.max_weight_g);
    select x.id, x.code, x.name, x.level, a.id account_id, a.carrier, a.mode into s
      from public.wh_carrier_services x join public.wh_carrier_accounts a on a.id = x.account_id where x.id = r.service_id;
    return jsonb_build_object('ok', true, 'service_id', s.id, 'service_code', s.code, 'service_name', s.name, 'level', s.level,
      'account_id', s.account_id, 'carrier', s.carrier, 'mode', s.mode, 'rule_version_id', v.id, 'version', v.version, 'rule_seq', r.seq,
      'fallback', false, 'skipped', v_skipped, 'reason', format('Rule %s (%s) → %s', r.seq, v_text, s.name));
  end loop;
  v_problem := public.wh_service_problem(v.fallback_service_id, v_dg, p_weight_g);
  select x.id, x.code, x.name, x.level, a.id account_id, a.carrier, a.mode into s
    from public.wh_carrier_services x join public.wh_carrier_accounts a on a.id = x.account_id where x.id = v.fallback_service_id;
  if v_problem is null then
    return jsonb_build_object('ok', true, 'service_id', s.id, 'service_code', s.code, 'service_name', s.name, 'level', s.level,
      'account_id', s.account_id, 'carrier', s.carrier, 'mode', s.mode, 'rule_version_id', v.id, 'version', v.version, 'rule_seq', null,
      'fallback', true, 'skipped', v_skipped,
      'reason', case when jsonb_array_length(v_skipped) = 0 then format('No rule matched → fallback %s', s.name)
                     else format('No usable rule (%s) → fallback %s',
                                 (select string_agg(format('rule %s: %s', e ->> 'seq', e ->> 'why'), '; ') from jsonb_array_elements(v_skipped) e), s.name) end);
  end if;
  v_skipped := v_skipped || jsonb_build_object('seq', null, 'why', format('fallback: %s', v_problem));
  return jsonb_build_object('ok', false, 'service_id', null, 'rule_version_id', v.id, 'version', v.version, 'rule_seq', null, 'fallback', false,
    'skipped', v_skipped,
    'reason', format('No carrier service can take this parcel (%s)',
                     (select string_agg(case when e ->> 'seq' is null then e ->> 'why' else format('rule %s: %s', e ->> 'seq', e ->> 'why') end, '; ')
                        from jsonb_array_elements(v_skipped) e)));
end $$;
revoke all on function public.wh_carrier_pick(text, text, text[], integer, uuid) from public, anon;
grant execute on function public.wh_carrier_pick(text, text, text[], integer, uuid) to authenticated, service_role;

-- ───────── 6. Accounts, services, rules (warehouse admins; approval by a different admin) ─────────
create or replace function public.wh_save_carrier_account(
  p_warehouse text, p_id uuid, p_carrier text, p_name text, p_mode text, p_credential_env text, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.wh_carrier_accounts;
  v_id uuid;
  v_env text := nullif(upper(btrim(coalesce(p_credential_env, ''))), '');
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.wh_can('manage_carrier_rules', p_warehouse) then raise exception 'FORBIDDEN: only a warehouse admin manages carrier accounts'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then raise exception 'INVALID_WAREHOUSE'; end if;
  if p_carrier is null or p_carrier not in ('yunexpress', '4px') then raise exception 'INVALID_CARRIER: YunExpress or 4PX'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'INVALID_NAME: give the account a name (up to 80 characters)'; end if;
  if p_mode is null or p_mode not in ('sandbox', 'live') then raise exception 'INVALID_MODE: sandbox or live'; end if;
  if p_mode = 'sandbox' and not public.wh_env_is_staging() then
    raise exception 'SANDBOX_STAGING_ONLY: sandbox carrier accounts exist only on staging; connect a live account';
  end if;
  if v_env is not null and v_env !~ '^[A-Z][A-Z0-9_]{2,40}$' then
    raise exception 'INVALID_ENV_NAME: the credentials name is the server setting prefix in capitals, e.g. FOURPX_FS01 (never the key itself)';
  end if;
  if p_mode = 'live' and v_env is null then raise exception 'ENV_REQUIRED: name the server setting that holds the live credentials, e.g. FOURPX_FS01'; end if;
  if p_id is null then
    if exists (select 1 from public.wh_carrier_accounts where warehouse_code = p_warehouse and name = v_name) then raise exception 'DUPLICATE_ACCOUNT: % already exists at %', v_name, p_warehouse; end if;
    insert into public.wh_carrier_accounts (warehouse_code, carrier, name, mode, credential_env, active, updated_by)
    values (p_warehouse, p_carrier, v_name, p_mode, v_env, coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform write_audit('wh_carrier.account_created', 'wh_carrier_accounts', v_id::text,
      jsonb_build_object('warehouse', p_warehouse, 'carrier', p_carrier, 'name', v_name, 'mode', p_mode, 'credential_env', v_env));
  else
    select * into v_old from public.wh_carrier_accounts where id = p_id for update;
    if v_old.id is null or v_old.warehouse_code <> p_warehouse then raise exception 'NOT_FOUND'; end if;
    if v_old.carrier <> p_carrier and exists (select 1 from public.wh_carrier_services where account_id = p_id) then
      raise exception 'CARRIER_FIXED: the carrier of an account with services cannot change; add a new account';
    end if;
    if exists (select 1 from public.wh_carrier_accounts where warehouse_code = p_warehouse and name = v_name and id <> p_id) then raise exception 'DUPLICATE_ACCOUNT: % already exists at %', v_name, p_warehouse; end if;
    update public.wh_carrier_accounts
       set carrier = p_carrier, name = v_name, mode = p_mode, credential_env = v_env, active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    v_id := p_id;
    perform write_audit('wh_carrier.account_updated', 'wh_carrier_accounts', v_id::text,
      jsonb_build_object('from', jsonb_build_object('name', v_old.name, 'mode', v_old.mode, 'credential_env', v_old.credential_env, 'active', v_old.active),
                         'name', v_name, 'mode', p_mode, 'credential_env', v_env, 'active', coalesce(p_active, true)));
  end if;
  return v_id;
end $$;
revoke all on function public.wh_save_carrier_account(text, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.wh_save_carrier_account(text, uuid, text, text, text, text, boolean) to authenticated, service_role;

create or replace function public.wh_save_carrier_service(
  p_account uuid, p_id uuid, p_code text, p_name text, p_level text, p_max_weight_g integer,
  p_accepts_battery boolean, p_accepts_liquid boolean, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.wh_carrier_accounts;
  v_old public.wh_carrier_services;
  v_id uuid;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
begin
  select * into a from public.wh_carrier_accounts where id = p_account;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('manage_carrier_rules', a.warehouse_code) then raise exception 'FORBIDDEN: only a warehouse admin manages carrier services'; end if;
  if v_code !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$' then raise exception 'INVALID_CODE: the carrier''s product code (letters, digits, . _ -), e.g. PX-STD'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'INVALID_NAME: name the service, e.g. 4PX standard'; end if;
  if p_level is null or p_level not in ('economy', 'standard', 'express') then raise exception 'INVALID_LEVEL: economy, standard or express'; end if;
  if p_max_weight_g is not null and (p_max_weight_g < 1 or p_max_weight_g > 1000000) then raise exception 'INVALID_WEIGHT: maximum weight 1 to 1,000,000 g, or empty'; end if;
  if p_id is null then
    if exists (select 1 from public.wh_carrier_services where account_id = a.id and code = v_code) then raise exception 'DUPLICATE_SERVICE: % already exists on %', v_code, a.name; end if;
    insert into public.wh_carrier_services (account_id, warehouse_code, code, name, level, max_weight_g, accepts_battery, accepts_liquid, active, updated_by)
    values (a.id, a.warehouse_code, v_code, v_name, p_level, p_max_weight_g, coalesce(p_accepts_battery, false), coalesce(p_accepts_liquid, false), coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform write_audit('wh_carrier.service_created', 'wh_carrier_accounts', a.id::text,
      jsonb_build_object('service_id', v_id, 'code', v_code, 'name', v_name, 'level', p_level, 'max_weight_g', p_max_weight_g,
                         'battery', coalesce(p_accepts_battery, false), 'liquid', coalesce(p_accepts_liquid, false)));
  else
    select * into v_old from public.wh_carrier_services where id = p_id for update;
    if v_old.id is null or v_old.account_id <> a.id then raise exception 'NOT_FOUND'; end if;
    if exists (select 1 from public.wh_carrier_services where account_id = a.id and code = v_code and id <> p_id) then raise exception 'DUPLICATE_SERVICE: % already exists on %', v_code, a.name; end if;
    update public.wh_carrier_services
       set code = v_code, name = v_name, level = p_level, max_weight_g = p_max_weight_g, accepts_battery = coalesce(p_accepts_battery, false),
           accepts_liquid = coalesce(p_accepts_liquid, false), active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    v_id := p_id;
    perform write_audit('wh_carrier.service_updated', 'wh_carrier_accounts', a.id::text,
      jsonb_build_object('service_id', v_id, 'from', to_jsonb(v_old) - 'updated_by' - 'updated_at' - 'created_at', 'code', v_code, 'name', v_name, 'level', p_level,
                         'max_weight_g', p_max_weight_g, 'battery', coalesce(p_accepts_battery, false), 'liquid', coalesce(p_accepts_liquid, false), 'active', coalesce(p_active, true)));
  end if;
  return v_id;
end $$;
revoke all on function public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean) to authenticated, service_role;

-- p_rules: [{"countries": ["DE","FR"], "product_type": "battery", "min_weight_g": null, "max_weight_g": 2000, "service_id": "…"}, …] in order
create or replace function public.wh_propose_carrier_rules(p_warehouse text, p_rules jsonb, p_fallback uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ver integer;
  r jsonb;
  i integer := 0;
  v_countries text[];
  v_type text;
  v_min integer;
  v_max integer;
  v_service uuid;
begin
  if not public.wh_can('manage_carrier_rules', p_warehouse) then raise exception 'FORBIDDEN: only a warehouse admin proposes carrier rules'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then raise exception 'INVALID_WAREHOUSE'; end if;
  if exists (select 1 from public.wh_carrier_rule_versions where warehouse_code = p_warehouse and status = 'pending_approval') then
    raise exception 'PENDING_EXISTS: a proposal for % is waiting for approval; approve or reject it first', p_warehouse;
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then raise exception 'INVALID_RULES'; end if;
  if jsonb_array_length(p_rules) > 50 then raise exception 'TOO_MANY_RULES: up to 50 rules'; end if;
  if not exists (select 1 from public.wh_carrier_services s where s.id = p_fallback and s.warehouse_code = p_warehouse and s.active) then
    raise exception 'FALLBACK_REQUIRED: choose a fallback service in use at %', p_warehouse;
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'NOTE_TOO_LONG: up to 500 characters'; end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.wh_carrier_rule_versions where warehouse_code = p_warehouse;
  insert into public.wh_carrier_rule_versions (warehouse_code, version, fallback_service_id, note, proposed_by)
  values (p_warehouse, v_ver, p_fallback, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  for r in select * from jsonb_array_elements(p_rules) loop
    i := i + 1;
    if jsonb_typeof(r) <> 'object' then raise exception 'INVALID_RULE: rule %', i; end if;
    select coalesce(array_agg(distinct upper(btrim(x)) order by upper(btrim(x))), '{}') into v_countries
      from jsonb_array_elements_text(coalesce(r -> 'countries', '[]'::jsonb)) x where btrim(x) <> '';
    if exists (select 1 from unnest(v_countries) c where c !~ '^[A-Z]{2}$') then raise exception 'INVALID_COUNTRY: rule % — use two-letter country codes (DE, US)', i; end if;
    v_type := coalesce(nullif(r ->> 'product_type', ''), 'any');
    if v_type not in ('any', 'general', 'battery', 'liquid', 'dangerous') then raise exception 'INVALID_PRODUCT_TYPE: rule %', i; end if;
    begin
      v_min := nullif(r ->> 'min_weight_g', '')::integer;
      v_max := nullif(r ->> 'max_weight_g', '')::integer;
    exception when others then
      raise exception 'INVALID_WEIGHT: rule % — whole grams', i;
    end;
    if (v_min is not null and (v_min < 0 or v_min > 1000000)) or (v_max is not null and (v_max < 1 or v_max > 1000000)) then raise exception 'INVALID_WEIGHT: rule % — 0 to 1,000,000 g', i; end if;
    if v_min is not null and v_max is not null and v_min > v_max then raise exception 'INVALID_WEIGHT: rule % — the lowest weight is above the highest', i; end if;
    begin
      v_service := (r ->> 'service_id')::uuid;
    exception when others then
      raise exception 'SERVICE_REQUIRED: rule % — choose a service', i;
    end;
    if not exists (select 1 from public.wh_carrier_services s where s.id = v_service and s.warehouse_code = p_warehouse and s.active) then
      raise exception 'SERVICE_REQUIRED: rule % — choose a service in use at %', i, p_warehouse;
    end if;
    insert into public.wh_carrier_rules (version_id, warehouse_code, seq, countries, product_type, min_weight_g, max_weight_g, service_id)
    values (v_id, p_warehouse, i, v_countries, v_type, v_min, v_max, v_service);
  end loop;
  perform write_audit('wh_carrier_rules.proposed', 'wh_carrier_rule_versions', v_id::text,
    jsonb_build_object('warehouse', p_warehouse, 'version', v_ver, 'rules', i, 'fallback_service_id', p_fallback));
  return jsonb_build_object('id', v_id, 'version', v_ver, 'rules', i);
end $$;
revoke all on function public.wh_propose_carrier_rules(text, jsonb, uuid, text) from public, anon;
grant execute on function public.wh_propose_carrier_rules(text, jsonb, uuid, text) to authenticated, service_role;

create or replace function public.wh_decide_carrier_rules(p_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_carrier_rule_versions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_bad text;
begin
  select * into v from public.wh_carrier_rule_versions where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('manage_carrier_rules', v.warehouse_code) then raise exception 'FORBIDDEN: a warehouse admin or company admin decides carrier rules'; end if;
  if v.status <> 'pending_approval' then raise exception 'RULES_NOT_PENDING: version % is %', v.version, v.status; end if;
  if p_decision = 'reject' then
    if v_reason is null then raise exception 'REASON_REQUIRED: enter why the rules are rejected'; end if;
    update public.wh_carrier_rule_versions set status = 'rejected', reject_reason = left(v_reason, 500), rejected_by = auth.uid(), decided_at = now() where id = v.id;
    perform write_audit('wh_carrier_rules.rejected', 'wh_carrier_rule_versions', v.id::text, jsonb_build_object('warehouse', v.warehouse_code, 'version', v.version, 'reason', v_reason));
    return jsonb_build_object('id', v.id, 'version', v.version, 'status', 'rejected');
  end if;
  if p_decision is distinct from 'approve' then raise exception 'INVALID_DECISION'; end if;
  if v.proposed_by = auth.uid() then raise exception 'TWO_PERSON_REQUIRED: you proposed these rules; a different admin approves them'; end if;
  select string_agg(distinct s.name, ', ') into v_bad
    from (select service_id sid from public.wh_carrier_rules where version_id = v.id union select v.fallback_service_id) x
    join public.wh_carrier_services s on s.id = x.sid join public.wh_carrier_accounts a on a.id = s.account_id
   where not s.active or not a.active or s.warehouse_code <> v.warehouse_code;
  if v_bad is not null then raise exception 'SERVICE_OFF: % is no longer in use; reject and propose again', v_bad; end if;
  update public.wh_carrier_rule_versions set status = 'superseded' where warehouse_code = v.warehouse_code and status = 'active';
  update public.wh_carrier_rule_versions set status = 'active', approved_by = auth.uid(), approved_at = now(), decided_at = now() where id = v.id;
  perform write_audit('wh_carrier_rules.approved', 'wh_carrier_rule_versions', v.id::text,
    jsonb_build_object('warehouse', v.warehouse_code, 'version', v.version, 'proposed_by', v.proposed_by));
  return jsonb_build_object('id', v.id, 'version', v.version, 'status', 'active');
end $$;
revoke all on function public.wh_decide_carrier_rules(uuid, text, text) from public, anon;
grant execute on function public.wh_decide_carrier_rules(uuid, text, text) to authenticated, service_role;

-- board 9 data: accounts + services, active rules, waiting proposal, history (per warehouse the caller sees)
create or replace function public.wh_carrier_version_json(v public.wh_carrier_rule_versions)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', v.id, 'warehouse_code', v.warehouse_code, 'version', v.version, 'status', v.status, 'note', v.note,
    'fallback', (select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'carrier', a.carrier, 'account', a.name)
                   from public.wh_carrier_services s join public.wh_carrier_accounts a on a.id = s.account_id where s.id = v.fallback_service_id),
    'proposed_by', v.proposed_by, 'proposed_by_name', (select full_name from public.profiles where id = v.proposed_by), 'proposed_at', v.proposed_at,
    'approved_by_name', (select full_name from public.profiles where id = v.approved_by), 'approved_at', v.approved_at,
    'rejected_by_name', (select full_name from public.profiles where id = v.rejected_by), 'reject_reason', v.reject_reason, 'decided_at', v.decided_at,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('seq', r.seq, 'countries', to_jsonb(r.countries), 'product_type', r.product_type,
               'min_weight_g', r.min_weight_g, 'max_weight_g', r.max_weight_g, 'service_id', r.service_id, 'service_name', s.name, 'carrier', a.carrier,
               'text', public.wh_carrier_rule_text(r.countries, r.product_type, r.min_weight_g, r.max_weight_g)) order by r.seq)
        from public.wh_carrier_rules r join public.wh_carrier_services s on s.id = r.service_id join public.wh_carrier_accounts a on a.id = s.account_id
       where r.version_id = v.id), '[]'::jsonb))
$$;
revoke all on function public.wh_carrier_version_json(public.wh_carrier_rule_versions) from public, anon, authenticated;
grant execute on function public.wh_carrier_version_json(public.wh_carrier_rule_versions) to service_role;

create or replace function public.wh_carriers_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'me', auth.uid(),
    'staging', public.wh_env_is_staging(),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'warehouse_code', w.code, 'name', w.name, 'city', w.city,
               'can_manage', public.wh_can('manage_carrier_rules', w.code),
               'accounts', coalesce((
                 select jsonb_agg(jsonb_build_object('id', a.id, 'carrier', a.carrier, 'name', a.name, 'mode', a.mode, 'credential_env', a.credential_env,
                          'active', a.active, 'updated_at', a.updated_at,
                          'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', s.level,
                                                    'max_weight_g', s.max_weight_g, 'accepts_battery', s.accepts_battery, 'accepts_liquid', s.accepts_liquid,
                                                    'active', s.active) order by s.active desc, s.name)
                                                  from public.wh_carrier_services s where s.account_id = a.id), '[]'::jsonb))
                          order by a.active desc, a.carrier, a.name)
                   from public.wh_carrier_accounts a where a.warehouse_code = w.code), '[]'::jsonb),
               'active', (select public.wh_carrier_version_json(v) from public.wh_carrier_rule_versions v where v.warehouse_code = w.code and v.status = 'active'),
               'pending', (select public.wh_carrier_version_json(v) from public.wh_carrier_rule_versions v where v.warehouse_code = w.code and v.status = 'pending_approval'),
               'history', coalesce((select jsonb_agg(public.wh_carrier_version_json(v) order by v.version desc)
                                      from public.wh_carrier_rule_versions v
                                     where v.id in (select x.id from public.wh_carrier_rule_versions x where x.warehouse_code = w.code and x.status in ('superseded', 'rejected')
                                                     order by x.version desc limit 10)), '[]'::jsonb))
             order by w.is_default desc, w.name)
        from public.warehouses w
       where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_sees(w.code)), '[]'::jsonb));
end $$;
revoke all on function public.wh_carriers_board(text) from public, anon;
grant execute on function public.wh_carriers_board(text) to authenticated, service_role;

-- ───────── 7. Labels ─────────
-- a closed parcel that may get a carrier label now (raises with a sentence otherwise)
create or replace function public.wh_label_parcel_check(p_parcel uuid)
returns public.wh_parcels
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
begin
  select * into p from public.wh_parcels where id = p_parcel;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  select * into o from public.wh_orders where id = p.order_id;
  if not public.wh_can('dispatch', o.warehouse_code) then raise exception 'FORBIDDEN: packers, supervisors and admins of % label parcels', o.warehouse_code; end if;
  if o.status not in ('packed', 'labelled') then raise exception 'ORDER_NOT_PACKED: % is %; labels are made once the order is packed', o.code, o.status; end if;
  if p.status <> 'closed' then raise exception 'PARCEL_OPEN: parcel % of % is not closed', p.seq, o.code; end if;
  perform public.wh_assert_store_order_open(o.store_order_id);
  if exists (select 1 from public.wh_shipments s where s.parcel_id = p.id and s.status <> 'voided') then
    raise exception 'ALREADY_LABELLED: parcel % of % already has a label; void it first to make a new one', p.seq, o.code;
  end if;
  if exists (select 1 from public.wh_freight_parcels f where f.parcel_id = p.id) then
    raise exception 'ON_FREIGHT_PALLET: parcel % of % ships on a freight pallet', p.seq, o.code;
  end if;
  return p;
end $$;
revoke all on function public.wh_label_parcel_check(uuid) from public, anon, authenticated;
grant execute on function public.wh_label_parcel_check(uuid) to service_role;

-- what the label server action needs: the chosen service (rules), the account (mode + credentials NAME), ship-to, weight.
-- No service → a 'carrier' exception is raised on the queue and {ok:false} returned.
create or replace function public.wh_label_plan(p_parcel uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  w public.warehouses;
  v_dg text[];
  v_pick jsonb;
  v_exc uuid;
  a public.wh_carrier_accounts;
  v_ref text;
begin
  p := public.wh_label_parcel_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  select * into w from public.warehouses where code = o.warehouse_code;
  -- the dangerous goods IN THIS PARCEL decide (a multi-parcel order may ship its battery in one parcel only)
  select coalesce(array_agg(distinct x order by x), '{}') into v_dg
    from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id cross join lateral unnest(public.wh_dg_kinds(l.item_id)) x
   where i.parcel_id = p.id;
  v_pick := public.wh_carrier_pick(o.warehouse_code, o.ship_country, v_dg, p.measured_weight_g, null);
  if not coalesce((v_pick ->> 'ok')::boolean, false) then
    v_exc := public.wh_exception_open(o.warehouse_code, 'carrier', format('No carrier for %s parcel %s: %s', o.code, p.seq, v_pick ->> 'reason'),
                                      o.id, p.id, null, null, o.org_id);
    return jsonb_build_object('ok', false, 'message', format('%s. Logged on the Exceptions queue.', v_pick ->> 'reason'), 'reason', v_pick ->> 'reason');
  end if;
  select * into a from public.wh_carrier_accounts where id = (v_pick ->> 'account_id')::uuid;
  select coalesce(o.external_ref, so.external_order_name, so.order_number, o.code) into v_ref
    from (select 1) x left join public.store_orders so on so.id = o.store_order_id;
  return jsonb_build_object(
    'ok', true, 'parcel_id', p.id, 'seq', p.seq, 'parcels', (select count(*) from public.wh_parcels where order_id = o.id),
    'order_id', o.id, 'order_code', o.code, 'reference', v_ref, 'warehouse_code', o.warehouse_code,
    'weight_g', p.measured_weight_g, 'dg', to_jsonb(v_dg),
    'service_id', v_pick ->> 'service_id', 'service_code', v_pick ->> 'service_code', 'service_name', v_pick ->> 'service_name',
    'carrier', a.carrier, 'account_id', a.id, 'account_name', a.name, 'mode', a.mode, 'credential_env', a.credential_env,
    'rule_version_id', v_pick ->> 'rule_version_id', 'rule_seq', v_pick -> 'rule_seq', 'fallback', v_pick -> 'fallback', 'reason', v_pick ->> 'reason',
    'ship_to', jsonb_build_object('name', o.ship_name, 'phone', o.ship_phone, 'address', o.ship_address, 'country', o.ship_country),
    'ship_from', jsonb_build_object('name', w.name, 'city', w.city, 'province', w.province, 'country', w.country, 'address', w.address, 'phone', w.phone),
    'items', coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.name, 'qty', i.qty, 'unit_weight_g', l.unit_weight_g) order by l.sku)
                         from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id where i.parcel_id = p.id), '[]'::jsonb));
end $$;
revoke all on function public.wh_label_plan(uuid) from public, anon;
grant execute on function public.wh_label_plan(uuid) to authenticated, service_role;

-- every parcel of the order is labelled or on a freight pallet → 'labelled' (and back to 'packed' when a label is voided)
create or replace function public.wh_order_label_state(p_order uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_all boolean;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.status not in ('packed', 'labelled') then return o.status; end if;
  select bool_and(exists (select 1 from public.wh_shipments s where s.parcel_id = p.id and s.status <> 'voided')
                  or exists (select 1 from public.wh_freight_parcels f where f.parcel_id = p.id)) into v_all
    from public.wh_parcels p where p.order_id = o.id;
  if coalesce(v_all, false) and o.status = 'packed' then
    update public.wh_orders set status = 'labelled', updated_at = now() where id = o.id;
    perform write_audit('wh_order.labelled', 'wh_orders', o.id::text, jsonb_build_object('code', o.code));
    return 'labelled';
  elsif not coalesce(v_all, false) and o.status = 'labelled' then
    -- back to 'packed' is not a new close: the W3b guard lets parcel operations through (octopus.wh_parcel_op)
    perform set_config('octopus.wh_parcel_op', 'true', true);
    update public.wh_orders set status = 'packed', updated_at = now() where id = o.id;
    perform set_config('octopus.wh_parcel_op', '', true);
    return 'packed';
  end if;
  return o.status;
end $$;
revoke all on function public.wh_order_label_state(uuid) from public, anon, authenticated;
grant execute on function public.wh_order_label_state(uuid) to service_role;

-- the label PDF is already in the private bucket (path <WH>/<WO-code>/P<seq>-<tracking>.pdf); record it
create or replace function public.wh_label_record(p_parcel uuid, p_service uuid, p_rule_version uuid, p_tracking_no text, p_label_path text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  s public.wh_carrier_services;
  a public.wh_carrier_accounts;
  v_dg text[];
  v_problem text;
  v_no text := upper(btrim(coalesce(p_tracking_no, '')));
  v_path text := btrim(coalesce(p_label_path, ''));
  v_id uuid;
  v_code text;
  v_state text;
begin
  p := public.wh_label_parcel_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  select * into s from public.wh_carrier_services where id = p_service;
  select * into a from public.wh_carrier_accounts where id = s.account_id;
  if s.id is null or s.warehouse_code <> o.warehouse_code then raise exception 'INVALID_SERVICE: choose a service of %', o.warehouse_code; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_dg
    from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id cross join lateral unnest(public.wh_dg_kinds(l.item_id)) x
   where i.parcel_id = p.id;
  v_problem := public.wh_service_problem(s.id, v_dg, p.measured_weight_g);
  if v_problem is not null then raise exception 'SERVICE_CANNOT_CARRY: %', v_problem; end if;
  if v_no !~ '^[A-Z0-9-]{6,40}$' then raise exception 'INVALID_TRACKING_NO: 6 to 40 letters, digits or dashes'; end if;
  if (a.mode = 'sandbox') <> (v_no like 'SBX%') then
    raise exception 'TRACKING_MODE_MISMATCH: sandbox labels start with SBX and only sandbox labels do';
  end if;
  if v_path <> format('%s/%s/P%s-%s.pdf', o.warehouse_code, o.code, p.seq, v_no) then
    raise exception 'INVALID_LABEL_PATH: expected %/%/P%-%.pdf', o.warehouse_code, o.code, p.seq, v_no;
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'wh-labels' and name = v_path) then
    raise exception 'LABEL_NOT_UPLOADED: upload the label PDF first';
  end if;
  if exists (select 1 from public.wh_shipments x where x.carrier = a.carrier and x.tracking_no = v_no and x.status <> 'voided') then
    raise exception 'DUPLICATE_TRACKING_NO: % is already on another label', v_no;
  end if;
  if p_rule_version is not null and not exists (select 1 from public.wh_carrier_rule_versions where id = p_rule_version and warehouse_code = o.warehouse_code) then
    raise exception 'INVALID_RULE_VERSION';
  end if;
  insert into public.wh_shipments (order_id, parcel_id, warehouse_code, account_id, service_id, carrier, service_code, service_name, rule_version_id, rule_reason,
                                   tracking_no, label_path, sandbox, weight_g, created_by)
  values (o.id, p.id, o.warehouse_code, a.id, s.id, a.carrier, s.code, s.name, p_rule_version, left(nullif(btrim(coalesce(p_reason, '')), ''), 600),
          v_no, v_path, a.mode = 'sandbox', p.measured_weight_g, auth.uid())
  returning id, code into v_id, v_code;
  perform write_audit('wh_label.created', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'parcel', p.seq, 'label', v_code, 'carrier', a.carrier, 'service', s.code, 'tracking_no', v_no,
                       'sandbox', a.mode = 'sandbox', 'reason', p_reason));
  -- a "no carrier" exception of this parcel is answered by the label
  perform public.wh_exceptions_resolve_where('parcel_id', p.id, array['carrier'], format('Label %s made with %s', v_no, s.name), 'label_made');
  v_state := public.wh_order_label_state(o.id);
  return jsonb_build_object('id', v_id, 'code', v_code, 'tracking_no', v_no, 'sandbox', a.mode = 'sandbox', 'order_status', v_state,
                            'service_name', s.name, 'carrier', a.carrier, 'parcel', p.seq);
end $$;
revoke all on function public.wh_label_record(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.wh_label_record(uuid, uuid, uuid, text, text, text) to authenticated, service_role;

-- label check: the label read on the parcel must belong to this order (and parcel, when given). Refusals are RETURNED (the scan
-- row and the 'label' exception stay); the right label resolves the order's open label exceptions.
create or replace function public.wh_label_confirm(p_order_code text, p_scan text, p_parcel_seq smallint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  x public.wh_shipments;
  v_scan text := upper(btrim(coalesce(p_scan, '')));
  v_seq smallint;
  v_other text;
  v_result text;
  v_msg text;
  v_exc uuid;
  v_exc_code text;
begin
  select * into o from public.wh_orders where code = upper(btrim(coalesce(p_order_code, '')));
  if o.id is null or not public.wh_sees(o.warehouse_code) then raise exception 'ORDER_NOT_FOUND: no order % here', upper(btrim(coalesce(p_order_code, ''))); end if;
  if not public.wh_can('dispatch', o.warehouse_code) then raise exception 'FORBIDDEN: packers, supervisors and admins check labels'; end if;
  if v_scan = '' then raise exception 'SCAN_REQUIRED: scan the label on the parcel'; end if;
  select * into x from public.wh_shipments s where s.tracking_no = v_scan and s.warehouse_code = o.warehouse_code
   order by (s.status = 'voided'), s.created_at desc limit 1;
  if x.id is not null and x.order_id = o.id and x.status <> 'voided' then
    select seq into v_seq from public.wh_parcels where id = x.parcel_id;
    if p_parcel_seq is not null and p_parcel_seq <> v_seq then
      v_result := 'wrong_parcel';
      v_msg := format('This is the label of parcel %s, not parcel %s. Put each label on its own parcel.', v_seq, p_parcel_seq);
    elsif x.status <> 'labelled' then
      insert into public.wh_label_scans (warehouse_code, order_id, shipment_id, code, result, actor_id) values (o.warehouse_code, o.id, x.id, left(v_scan, 128), 'already', auth.uid());
      return jsonb_build_object('ok', true, 'result', 'already', 'parcel', v_seq, 'message', format('Parcel %s of %s was already checked.', v_seq, o.code));
    else
      update public.wh_shipments set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now() where id = x.id;
      insert into public.wh_label_scans (warehouse_code, order_id, shipment_id, code, result, actor_id) values (o.warehouse_code, o.id, x.id, left(v_scan, 128), 'ok', auth.uid());
      perform write_audit('wh_label.confirmed', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'parcel', v_seq, 'tracking_no', v_scan));
      perform public.wh_exceptions_resolve_where('order_id', o.id, array['label'], format('The right label was scanned for parcel %s', v_seq), 'label_ok');
      return jsonb_build_object('ok', true, 'result', 'ok', 'parcel', v_seq,
        'message', format('Label matches %s parcel %s.', o.code, v_seq),
        'all_confirmed', not exists (select 1 from public.wh_shipments s where s.order_id = o.id and s.status = 'labelled'));
    end if;
  elsif x.id is not null and x.status = 'voided' then
    v_result := 'voided';
    v_msg := format('This label (%s) was voided. Take it off and stick the new label on.', v_scan);
  elsif x.id is not null then
    select format('%s parcel %s', oo.code, pp.seq) into v_other from public.wh_orders oo join public.wh_parcels pp on pp.id = x.parcel_id where oo.id = x.order_id;
    v_result := 'wrong_order';
    v_msg := format('Wrong label: this is the label of %s, not %s. Do not ship it.', v_other, o.code);
  else
    v_result := 'unknown';
    v_msg := format('%s is not a label we printed at %s. Do not ship this parcel.', v_scan, o.warehouse_code);
  end if;
  v_exc := public.wh_exception_open(o.warehouse_code, 'label',
    format('Label check on %s refused: %s', o.code, v_msg), o.id, null, null, null, o.org_id);
  select code into v_exc_code from public.wh_exceptions
   where id = coalesce(v_exc, (select e.id from public.wh_exceptions e where e.order_id = o.id and e.parcel_id is null and e.kind = 'label' and e.status <> 'resolved' limit 1));
  insert into public.wh_label_scans (warehouse_code, order_id, shipment_id, code, result, exception_id, actor_id)
  values (o.warehouse_code, o.id, case when v_result in ('wrong_parcel', 'voided') then x.id end, left(v_scan, 128), v_result,
          (select id from public.wh_exceptions where code = v_exc_code), auth.uid());
  perform write_audit('wh_label.wrong_scan', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'scan', left(v_scan, 128), 'result', v_result, 'exception', v_exc_code));
  return jsonb_build_object('ok', false, 'result', v_result, 'exception', v_exc_code,
    'message', v_msg || case when v_exc_code is not null then format(' Logged as %s.', v_exc_code) else '' end);
end $$;
revoke all on function public.wh_label_confirm(text, text, smallint) from public, anon;
grant execute on function public.wh_label_confirm(text, text, smallint) to authenticated, service_role;

-- void a label before hand-over (supervisor / admin); the order goes back to 'packed' until the parcel has a new label
create or replace function public.wh_label_void(p_shipment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.wh_shipments;
  o public.wh_orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_state text;
begin
  select * into x from public.wh_shipments where id = p_shipment for update;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('resolve_exception', x.warehouse_code) then raise exception 'FORBIDDEN: a supervisor or admin voids labels'; end if;
  if x.status not in ('labelled', 'confirmed') then raise exception 'LABEL_LOCKED: % is %; labels are voided only before hand-over', x.tracking_no, x.status; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the label is voided'; end if;
  select * into o from public.wh_orders where id = x.order_id;
  update public.wh_shipments set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = left(v_reason, 300), dispatch_id = null, updated_at = now()
   where id = x.id;
  perform write_audit('wh_label.voided', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'tracking_no', x.tracking_no, 'reason', v_reason));
  v_state := public.wh_order_label_state(o.id);
  return jsonb_build_object('tracking_no', x.tracking_no, 'order_code', o.code, 'order_status', v_state, 'carrier', x.carrier, 'account_id', x.account_id, 'sandbox', x.sandbox);
end $$;
revoke all on function public.wh_label_void(uuid, text) from public, anon;
grant execute on function public.wh_label_void(uuid, text) to authenticated, service_role;

-- a reprint from the label centre is logged
create or replace function public.wh_label_printed(p_shipment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.wh_shipments;
begin
  select * into x from public.wh_shipments where id = p_shipment;
  if x.id is null or not public.wh_sees(x.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', x.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  perform write_audit('wh_label.printed', 'wh_orders', x.order_id::text, jsonb_build_object('label', x.code, 'tracking_no', x.tracking_no));
end $$;
revoke all on function public.wh_label_printed(uuid) from public, anon;
grant execute on function public.wh_label_printed(uuid) to authenticated, service_role;

-- ───────── 8. Shipped orders, Dropship sync, tracking events ─────────
-- shipment_status of the existing shipments table for a W4 status
create or replace function public.wh_legacy_status(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_status when 'handed_over' then 'picked_up' when 'in_transit' then 'in_transit' when 'out_for_delivery' then 'out_for_delivery'
                       when 'delivered' then 'delivered' when 'exception' then 'exception' when 'returned' then 'returned' end
$$;
revoke all on function public.wh_legacy_status(text) from public, anon, authenticated;
grant execute on function public.wh_legacy_status(text) to service_role;

-- every parcel is out (label handed over, or its freight pallet dispatched) → order 'shipped' + customer tracking token.
-- Octopus Dropship: one row in the existing shipments table for the store order (first parcel's tracking number), written as a
-- system step (no caller claims — the Dropship division guard is for people), so the existing trigger raises the
-- shipment.status_changed domain event (store sync, merchant status, handoff 'shipped') and mints the /t/ token.
create or replace function public.wh_order_maybe_ship(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  so public.store_orders;
  v_out boolean;
  v_first public.wh_shipments;
  v_token text;
  v_legacy uuid;
  v_claims text;
  v_n integer;
  v_g integer;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.status not in ('packed', 'labelled') then return false; end if;
  select bool_and(exists (select 1 from public.wh_shipments s where s.parcel_id = p.id and s.status not in ('labelled', 'confirmed', 'voided'))
                  or exists (select 1 from public.wh_freight_parcels f join public.wh_freight_pallets fp on fp.id = f.pallet_id
                              where f.parcel_id = p.id and fp.status = 'dispatched')),
         count(*), sum(p.measured_weight_g)::integer
    into v_out, v_n, v_g
    from public.wh_parcels p where p.order_id = o.id;
  if not coalesce(v_out, false) then return false; end if;
  if o.store_order_id is not null then
    select * into so from public.store_orders where id = o.store_order_id;
    select s.* into v_first from public.wh_shipments s join public.wh_parcels p on p.id = s.parcel_id
     where s.order_id = o.id and s.status not in ('labelled', 'confirmed', 'voided') order by p.seq limit 1;
    if v_first.id is not null then
      v_claims := current_setting('request.jwt.claims', true);
      perform set_config('request.jwt.claims', '', true);
      begin
        insert into public.shipments (order_id, store_order_id, org_id, carrier_code, service_code, tracking_no, status, weight_kg, parcels, currency, division_id, is_seed)
        values (null, so.id, so.org_id, v_first.carrier, v_first.service_code, v_first.tracking_no, 'picked_up'::shipment_status,
                round(coalesce(v_g, v_first.weight_g, 0)::numeric / 1000.0, 3), v_n, 'USD', division_id_of('DS'),
                coalesce(so.is_test, false) or coalesce((select is_seed from public.organizations where id = so.org_id), false))
        returning id, tracking_token into v_legacy, v_token;
      exception when others then
        perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
        raise;
      end;
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      update public.wh_shipments set legacy_shipment_id = v_legacy, updated_at = now() where order_id = o.id and status <> 'voided';
    end if;
  end if;
  v_token := coalesce(v_token, encode(extensions.gen_random_bytes(18), 'hex'));
  update public.wh_orders set status = 'shipped', shipped_at = now(), tracking_token = coalesce(tracking_token, v_token), updated_at = now() where id = o.id;
  perform write_audit('wh_order.shipped', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'parcels', v_n, 'dropship_shipment_id', v_legacy));
  return true;
end $$;
revoke all on function public.wh_order_maybe_ship(uuid) from public, anon, authenticated;
grant execute on function public.wh_order_maybe_ship(uuid) to service_role;

-- one tracking event for a label or a pallet: event row, label status (forward only; exception / returned at any time; 'info'
-- changes nothing), and for a Dropship order's first parcel the same event in tracking_events + shipments.status (store sync)
create or replace function public.wh_tracking_apply(p_shipment uuid, p_pallet uuid, p_status text, p_description text, p_location text,
                                                    p_occurred_at timestamptz, p_source text, p_provider_event text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.wh_shipments;
  fp public.wh_freight_pallets;
  v_wh text;
  v_id uuid;
  v_order text[] := array['handed_over', 'in_transit', 'out_for_delivery', 'delivered'];
  v_new boolean;
  l public.shipments;
  v_legacy text;
  v_claims text;
  v_at timestamptz := coalesce(p_occurred_at, clock_timestamp());
begin
  if p_shipment is not null then
    select * into x from public.wh_shipments where id = p_shipment for update;
    v_wh := x.warehouse_code;
  else
    select * into fp from public.wh_freight_pallets where id = p_pallet for update;
    v_wh := fp.warehouse_code;
  end if;
  if v_wh is null then raise exception 'NOT_FOUND'; end if;
  if p_provider_event is not null and exists (select 1 from public.wh_tracking_events where provider_event_id = p_provider_event) then return null; end if;
  insert into public.wh_tracking_events (warehouse_code, shipment_id, pallet_id, status, description, location, occurred_at, source, provider_event_id, created_by)
  values (v_wh, p_shipment, p_pallet, p_status, left(btrim(p_description), 300), left(nullif(btrim(coalesce(p_location, '')), ''), 120), v_at, p_source, p_provider_event, auth.uid())
  returning id into v_id;
  if p_shipment is null or p_status = 'info' then return v_id; end if;
  v_new := p_status in ('exception', 'returned') or x.status in ('exception')
           or coalesce(array_position(v_order, p_status), 0) > coalesce(array_position(v_order, x.status), 0);
  update public.wh_shipments
     set status = case when v_new and x.status not in ('delivered', 'returned', 'voided') then p_status else status end,
         delivered_at = case when p_status = 'delivered' and v_new then coalesce(delivered_at, v_at) else delivered_at end,
         last_event_at = greatest(coalesce(last_event_at, v_at), v_at), updated_at = now()
   where id = x.id;
  -- Dropship mirror: only the parcel whose tracking number is on the store order's shipment row
  if x.legacy_shipment_id is not null then
    select * into l from public.shipments where id = x.legacy_shipment_id;
    if l.id is not null and l.tracking_no = x.tracking_no then
      v_legacy := public.wh_legacy_status(p_status);
      v_claims := current_setting('request.jwt.claims', true);
      perform set_config('request.jwt.claims', '', true);
      begin
        insert into public.tracking_events (shipment_id, org_id, provider_event_id, status, description, location, occurred_at)
        values (l.id, l.org_id, 'wh:' || v_id::text, coalesce(v_legacy, p_status), left(btrim(p_description), 300), nullif(btrim(coalesce(p_location, '')), ''), v_at)
        on conflict (provider_event_id) do nothing;
        if v_legacy is not null and v_legacy <> l.status::text
           and (v_legacy in ('exception', 'returned') or l.status::text = 'exception'
                or coalesce(array_position(array['draft', 'priced', 'created', 'label_ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'], v_legacy), 0)
                   > coalesce(array_position(array['draft', 'priced', 'created', 'label_ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'], l.status::text), 0)) then
          update public.shipments set status = v_legacy::shipment_status, last_event_at = greatest(coalesce(last_event_at, v_at), v_at) where id = l.id;
        else
          update public.shipments set last_event_at = greatest(coalesce(last_event_at, v_at), v_at) where id = l.id;
        end if;
      exception when others then
        perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
        raise;
      end;
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.wh_tracking_apply(uuid, uuid, text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.wh_tracking_apply(uuid, uuid, text, text, text, timestamptz, text, text) to service_role;

-- ───────── 9. Dispatch batches (hand-over with manifest) ─────────
create or replace function public.wh_dispatch_open(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.wh_carrier_accounts;
  d public.wh_dispatches;
begin
  select * into a from public.wh_carrier_accounts where id = p_account;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', a.warehouse_code) then raise exception 'FORBIDDEN: packers, supervisors and admins hand parcels over'; end if;
  if not a.active then raise exception 'ACCOUNT_OFF: % is switched off', a.name; end if;
  select * into d from public.wh_dispatches where account_id = a.id and status = 'open';
  if d.id is not null then return jsonb_build_object('id', d.id, 'code', d.code, 'existing', true); end if;
  insert into public.wh_dispatches (warehouse_code, account_id, created_by) values (a.warehouse_code, a.id, auth.uid()) returning * into d;
  perform write_audit('wh_dispatch.opened', 'wh_dispatches', d.id::text, jsonb_build_object('code', d.code, 'account', a.name, 'carrier', a.carrier));
  return jsonb_build_object('id', d.id, 'code', d.code, 'existing', false);
end $$;
revoke all on function public.wh_dispatch_open(uuid) from public, anon;
grant execute on function public.wh_dispatch_open(uuid) to authenticated, service_role;

-- scan a checked label into the batch (refusals returned as sentences)
create or replace function public.wh_dispatch_scan(p_dispatch uuid, p_scan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.wh_dispatches;
  x public.wh_shipments;
  v_scan text := upper(btrim(coalesce(p_scan, '')));
  v_order text;
  v_seq smallint;
begin
  select * into d from public.wh_dispatches where id = p_dispatch for update;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', d.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'open' then raise exception 'DISPATCH_CLOSED: % is %', d.code, d.status; end if;
  select * into x from public.wh_shipments where tracking_no = v_scan and warehouse_code = d.warehouse_code and status <> 'voided' limit 1;
  if x.id is null then
    return jsonb_build_object('ok', false, 'message', format('%s is not an open label at %s.', coalesce(nullif(v_scan, ''), '(empty)'), d.warehouse_code));
  end if;
  select o.code, p.seq into v_order, v_seq from public.wh_orders o join public.wh_parcels p on p.id = x.parcel_id where o.id = x.order_id;
  if x.account_id <> d.account_id then
    return jsonb_build_object('ok', false, 'message', format('%s (%s parcel %s) goes with another carrier account; put it in that batch.', v_scan, v_order, v_seq));
  end if;
  if x.dispatch_id = d.id then
    return jsonb_build_object('ok', true, 'message', format('%s is already in %s.', v_scan, d.code), 'already', true);
  end if;
  if x.status = 'labelled' then
    return jsonb_build_object('ok', false, 'message', format('Check the label of %s parcel %s first (Label check).', v_order, v_seq));
  end if;
  if x.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'message', format('%s was already handed over.', v_scan));
  end if;
  if x.dispatch_id is not null then
    return jsonb_build_object('ok', false, 'message', format('%s is in another open batch.', v_scan));
  end if;
  update public.wh_shipments set dispatch_id = d.id, updated_at = now() where id = x.id;
  perform write_audit('wh_dispatch.added', 'wh_orders', x.order_id::text, jsonb_build_object('code', v_order, 'parcel', v_seq, 'dispatch', d.code, 'tracking_no', x.tracking_no));
  return jsonb_build_object('ok', true, 'message', format('%s parcel %s added to %s.', v_order, v_seq, d.code),
                            'count', (select count(*) from public.wh_shipments where dispatch_id = d.id and status <> 'voided'));
end $$;
revoke all on function public.wh_dispatch_scan(uuid, text) from public, anon;
grant execute on function public.wh_dispatch_scan(uuid, text) to authenticated, service_role;

create or replace function public.wh_dispatch_remove(p_dispatch uuid, p_shipment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.wh_dispatches;
  x public.wh_shipments;
begin
  select * into d from public.wh_dispatches where id = p_dispatch for update;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', d.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'open' then raise exception 'DISPATCH_CLOSED: % is %', d.code, d.status; end if;
  select * into x from public.wh_shipments where id = p_shipment and dispatch_id = d.id for update;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  update public.wh_shipments set dispatch_id = null, updated_at = now() where id = x.id;
  perform write_audit('wh_dispatch.removed', 'wh_orders', x.order_id::text, jsonb_build_object('dispatch', d.code, 'tracking_no', x.tracking_no));
end $$;
revoke all on function public.wh_dispatch_remove(uuid, uuid) from public, anon;
grant execute on function public.wh_dispatch_remove(uuid, uuid) to authenticated, service_role;

-- hand-over: the batch closes with a manifest number and who took it; every label in it is handed over (event "Handed to the
-- carrier" at the warehouse city); orders whose every parcel is out become 'shipped'
create or replace function public.wh_dispatch_close(p_dispatch uuid, p_handed_to text, p_manifest_no text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.wh_dispatches;
  w public.warehouses;
  x public.wh_shipments;
  v_to text := nullif(btrim(coalesce(p_handed_to, '')), '');
  v_mf text := nullif(btrim(coalesce(p_manifest_no, '')), '');
  v_n integer := 0;
  v_shipped integer := 0;
  v_order uuid;
begin
  select * into d from public.wh_dispatches where id = p_dispatch for update;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', d.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'open' then raise exception 'DISPATCH_CLOSED: % is %', d.code, d.status; end if;
  if v_to is null then raise exception 'HANDED_TO_REQUIRED: enter who took the parcels (driver or pickup reference)'; end if;
  if length(v_to) > 120 or length(coalesce(v_mf, '')) > 64 then raise exception 'TOO_LONG: up to 120 characters for who took it, 64 for the manifest number'; end if;
  if not exists (select 1 from public.wh_shipments where dispatch_id = d.id and status = 'confirmed') then raise exception 'EMPTY_DISPATCH: scan labels into % first', d.code; end if;
  select * into w from public.warehouses where code = d.warehouse_code;
  for x in select * from public.wh_shipments where dispatch_id = d.id and status = 'confirmed' for update loop
    update public.wh_shipments set status = 'handed_over', handed_over_at = now(), handed_over_by = auth.uid(), updated_at = now() where id = x.id;
    perform public.wh_tracking_apply(x.id, null, 'handed_over', 'Handed to the carrier', concat_ws(', ', w.city, w.country), clock_timestamp(), 'system', null);
    v_n := v_n + 1;
  end loop;
  update public.wh_dispatches set status = 'handed_over', handed_to = v_to, manifest_no = coalesce(v_mf, 'MF-' || substr(d.code, 4)), closed_by = auth.uid(), closed_at = now(), updated_at = now()
   where id = d.id;
  for v_order in select distinct order_id from public.wh_shipments where dispatch_id = d.id and status = 'handed_over' loop
    if public.wh_order_maybe_ship(v_order) then v_shipped := v_shipped + 1; end if;
  end loop;
  perform write_audit('wh_dispatch.handed_over', 'wh_dispatches', d.id::text,
    jsonb_build_object('code', d.code, 'parcels', v_n, 'orders_shipped', v_shipped, 'handed_to', v_to, 'manifest_no', coalesce(v_mf, 'MF-' || substr(d.code, 4))));
  return jsonb_build_object('code', d.code, 'parcels', v_n, 'orders_shipped', v_shipped, 'manifest_no', coalesce(v_mf, 'MF-' || substr(d.code, 4)));
end $$;
revoke all on function public.wh_dispatch_close(uuid, text, text) from public, anon;
grant execute on function public.wh_dispatch_close(uuid, text, text) to authenticated, service_role;

create or replace function public.wh_dispatch_cancel(p_dispatch uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.wh_dispatches;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into d from public.wh_dispatches where id = p_dispatch for update;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', d.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'open' then raise exception 'DISPATCH_CLOSED: % is %', d.code, d.status; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the batch is cancelled'; end if;
  update public.wh_shipments set dispatch_id = null, updated_at = now() where dispatch_id = d.id;
  update public.wh_dispatches set status = 'cancelled', cancel_reason = left(v_reason, 300), closed_by = auth.uid(), closed_at = now(), updated_at = now() where id = d.id;
  perform write_audit('wh_dispatch.cancelled', 'wh_dispatches', d.id::text, jsonb_build_object('code', d.code, 'reason', v_reason));
end $$;
revoke all on function public.wh_dispatch_cancel(uuid, text) from public, anon;
grant execute on function public.wh_dispatch_cancel(uuid, text) to authenticated, service_role;

-- ───────── 10. Freight pallets (board 13) ─────────
create or replace function public.wh_freight_create(p_warehouse text, p_destination text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest text := nullif(btrim(coalesce(p_destination, '')), '');
  fp public.wh_freight_pallets;
begin
  if not public.wh_can('dispatch', p_warehouse) then raise exception 'FORBIDDEN: packers, supervisors and admins build freight pallets'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then raise exception 'INVALID_WAREHOUSE'; end if;
  if v_dest is null or length(v_dest) > 160 then raise exception 'DESTINATION_REQUIRED: where the pallet goes (up to 160 characters)'; end if;
  insert into public.wh_freight_pallets (warehouse_code, destination, created_by) values (p_warehouse, v_dest, auth.uid()) returning * into fp;
  perform write_audit('wh_freight.created', 'wh_freight_pallets', fp.id::text, jsonb_build_object('code', fp.code, 'destination', v_dest));
  return jsonb_build_object('id', fp.id, 'code', fp.code);
end $$;
revoke all on function public.wh_freight_create(text, text) from public, anon;
grant execute on function public.wh_freight_create(text, text) to authenticated, service_role;

-- adds every closed parcel of a packed client order (scan the order number). Dropship orders ship as parcels to end customers.
create or replace function public.wh_freight_add(p_pallet uuid, p_order_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fp public.wh_freight_pallets;
  o public.wh_orders;
  v_n integer;
begin
  select * into fp from public.wh_freight_pallets where id = p_pallet for update;
  if fp.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', fp.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if fp.status <> 'open' then raise exception 'PALLET_CLOSED: % is %', fp.code, fp.status; end if;
  select * into o from public.wh_orders where code = upper(btrim(coalesce(p_order_code, ''))) and warehouse_code = fp.warehouse_code for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND: no order % at %', upper(btrim(coalesce(p_order_code, ''))), fp.warehouse_code; end if;
  if o.source = 'dropship' then raise exception 'FREIGHT_NOT_FOR_DROPSHIP: Dropship orders ship as parcels to the buyer; label them instead'; end if;
  if o.status not in ('packed', 'labelled') then raise exception 'ORDER_NOT_PACKED: % is %', o.code, o.status; end if;
  if exists (select 1 from public.wh_shipments s where s.order_id = o.id and s.status <> 'voided') then
    raise exception 'ORDER_LABELLED: % has carrier labels; void them first to ship it as freight', o.code;
  end if;
  if exists (select 1 from public.wh_parcels where order_id = o.id and status <> 'closed') then raise exception 'PARCEL_OPEN: % has an open parcel', o.code; end if;
  if exists (select 1 from public.wh_freight_parcels f where f.order_id = o.id) then raise exception 'ALREADY_ON_PALLET: % is already on a freight pallet', o.code; end if;
  insert into public.wh_freight_parcels (parcel_id, pallet_id, order_id, warehouse_code, added_by)
  select p.id, fp.id, o.id, fp.warehouse_code, auth.uid() from public.wh_parcels p where p.order_id = o.id;
  get diagnostics v_n = row_count;
  update public.wh_freight_pallets set updated_at = now() where id = fp.id;
  perform write_audit('wh_freight.added', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'pallet', fp.code, 'parcels', v_n));
  perform public.wh_order_label_state(o.id);
  return jsonb_build_object('order_code', o.code, 'parcels', v_n, 'pallet', fp.code);
end $$;
revoke all on function public.wh_freight_add(uuid, text) from public, anon;
grant execute on function public.wh_freight_add(uuid, text) to authenticated, service_role;

create or replace function public.wh_freight_remove(p_pallet uuid, p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fp public.wh_freight_pallets;
  v_code text;
begin
  select * into fp from public.wh_freight_pallets where id = p_pallet for update;
  if fp.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', fp.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if fp.status <> 'open' then raise exception 'PALLET_CLOSED: % is %; reopen it first', fp.code, fp.status; end if;
  delete from public.wh_freight_parcels where pallet_id = fp.id and order_id = p_order;
  if not found then raise exception 'NOT_FOUND'; end if;
  select code into v_code from public.wh_orders where id = p_order;
  perform write_audit('wh_freight.removed', 'wh_orders', p_order::text, jsonb_build_object('code', v_code, 'pallet', fp.code));
  perform public.wh_order_label_state(p_order);
end $$;
revoke all on function public.wh_freight_remove(uuid, uuid) from public, anon;
grant execute on function public.wh_freight_remove(uuid, uuid) to authenticated, service_role;

create or replace function public.wh_freight_close(p_pallet uuid, p_gross_g integer, p_length_mm integer, p_width_mm integer, p_height_mm integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fp public.wh_freight_pallets;
  v_parcels_g integer;
begin
  select * into fp from public.wh_freight_pallets where id = p_pallet for update;
  if fp.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', fp.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if fp.status <> 'open' then raise exception 'PALLET_CLOSED: % is %', fp.code, fp.status; end if;
  if not exists (select 1 from public.wh_freight_parcels where pallet_id = fp.id) then raise exception 'EMPTY_PALLET: add orders to % first', fp.code; end if;
  if p_gross_g is null or p_gross_g < 1 or p_gross_g > 5000000 then raise exception 'INVALID_WEIGHT: weigh the pallet (whole grams, up to 5,000 kg)'; end if;
  if p_length_mm is null or p_width_mm is null or p_height_mm is null or least(p_length_mm, p_width_mm, p_height_mm) < 1 or greatest(p_length_mm, p_width_mm, p_height_mm) > 5000 then
    raise exception 'INVALID_SIZE: length, width and height in mm (1 to 5,000)';
  end if;
  select coalesce(sum(p.measured_weight_g), 0)::integer into v_parcels_g from public.wh_freight_parcels f join public.wh_parcels p on p.id = f.parcel_id where f.pallet_id = fp.id;
  if p_gross_g < v_parcels_g then raise exception 'WEIGHT_TOO_LOW: the parcels alone weigh % g; weigh the pallet again', v_parcels_g; end if;
  update public.wh_freight_pallets set status = 'closed', gross_weight_g = p_gross_g, length_mm = p_length_mm, width_mm = p_width_mm, height_mm = p_height_mm,
         closed_by = auth.uid(), closed_at = now(), updated_at = now()
   where id = fp.id;
  perform write_audit('wh_freight.closed', 'wh_freight_pallets', fp.id::text,
    jsonb_build_object('code', fp.code, 'gross_g', p_gross_g, 'parcels_g', v_parcels_g, 'size_mm', format('%s×%s×%s', p_length_mm, p_width_mm, p_height_mm)));
  return jsonb_build_object('code', fp.code, 'gross_g', p_gross_g, 'parcels_g', v_parcels_g);
end $$;
revoke all on function public.wh_freight_close(uuid, integer, integer, integer, integer) from public, anon;
grant execute on function public.wh_freight_close(uuid, integer, integer, integer, integer) to authenticated, service_role;

create or replace function public.wh_freight_reopen(p_pallet uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fp public.wh_freight_pallets;
begin
  select * into fp from public.wh_freight_pallets where id = p_pallet for update;
  if fp.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('resolve_exception', fp.warehouse_code) then raise exception 'FORBIDDEN: a supervisor or admin reopens a closed pallet'; end if;
  if fp.status <> 'closed' then raise exception 'PALLET_NOT_CLOSED: % is %', fp.code, fp.status; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED'; end if;
  update public.wh_freight_pallets set status = 'open', gross_weight_g = null, length_mm = null, width_mm = null, height_mm = null, closed_by = null, closed_at = null, updated_at = now()
   where id = fp.id;
  perform write_audit('wh_freight.reopened', 'wh_freight_pallets', fp.id::text, jsonb_build_object('code', fp.code, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.wh_freight_reopen(uuid, text) from public, anon;
grant execute on function public.wh_freight_reopen(uuid, text) to authenticated, service_role;

create or replace function public.wh_freight_dispatch(p_pallet uuid, p_forwarder text, p_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fp public.wh_freight_pallets;
  w public.warehouses;
  v_fw text := nullif(btrim(coalesce(p_forwarder, '')), '');
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_order uuid;
  v_shipped integer := 0;
begin
  select * into fp from public.wh_freight_pallets where id = p_pallet for update;
  if fp.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', fp.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if fp.status <> 'closed' then raise exception 'PALLET_NOT_CLOSED: weigh, measure and close % first', fp.code; end if;
  if v_fw is null or length(v_fw) > 120 then raise exception 'FORWARDER_REQUIRED: enter the freight forwarder (up to 120 characters)'; end if;
  if length(coalesce(v_ref, '')) > 64 then raise exception 'TOO_LONG: reference up to 64 characters'; end if;
  select * into w from public.warehouses where code = fp.warehouse_code;
  update public.wh_freight_pallets set status = 'dispatched', forwarder = v_fw, reference = v_ref, dispatched_by = auth.uid(), dispatched_at = now(), updated_at = now()
   where id = fp.id;
  perform public.wh_tracking_apply(null, fp.id, 'handed_over', 'Handed to the freight forwarder', concat_ws(', ', w.city, w.country), clock_timestamp(), 'system', null);
  for v_order in select distinct order_id from public.wh_freight_parcels where pallet_id = fp.id loop
    if public.wh_order_maybe_ship(v_order) then v_shipped := v_shipped + 1; end if;
  end loop;
  perform write_audit('wh_freight.dispatched', 'wh_freight_pallets', fp.id::text, jsonb_build_object('code', fp.code, 'forwarder', v_fw, 'reference', v_ref, 'orders_shipped', v_shipped));
  return jsonb_build_object('code', fp.code, 'orders_shipped', v_shipped);
end $$;
revoke all on function public.wh_freight_dispatch(uuid, text, text) from public, anon;
grant execute on function public.wh_freight_dispatch(uuid, text, text) to authenticated, service_role;

create or replace function public.wh_freight_label_printed(p_pallet uuid, p_copies integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fp public.wh_freight_pallets;
begin
  select * into fp from public.wh_freight_pallets where id = p_pallet;
  if fp.id is null or not public.wh_sees(fp.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', fp.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if p_copies is null or p_copies < 1 or p_copies > 20 then raise exception 'INVALID_COPIES: 1 to 20'; end if;
  perform write_audit('wh_freight.label_printed', 'wh_freight_pallets', fp.id::text, jsonb_build_object('code', fp.code, 'copies', p_copies));
end $$;
revoke all on function public.wh_freight_label_printed(uuid, integer) from public, anon;
grant execute on function public.wh_freight_label_printed(uuid, integer) to authenticated, service_role;

-- ───────── 11. Tracking (staff entry, staging sandbox steps, carrier polling) ─────────
-- staff record what the carrier / forwarder reported (the description is what the end customer reads)
create or replace function public.wh_tracking_add(p_shipment uuid, p_pallet uuid, p_status text, p_description text, p_location text, p_occurred_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.wh_shipments;
  fp public.wh_freight_pallets;
  v_wh text;
  v_out timestamptz;
  v_at timestamptz := coalesce(p_occurred_at, clock_timestamp());
  v_desc text := btrim(coalesce(p_description, ''));
  v_id uuid;
begin
  if (p_shipment is null) = (p_pallet is null) then raise exception 'INVALID_TARGET: a label or a freight pallet'; end if;
  if p_shipment is not null then
    select * into x from public.wh_shipments where id = p_shipment;
    v_wh := x.warehouse_code; v_out := x.handed_over_at;
  else
    select * into fp from public.wh_freight_pallets where id = p_pallet;
    v_wh := fp.warehouse_code; v_out := fp.dispatched_at;
  end if;
  if v_wh is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', v_wh) then raise exception 'FORBIDDEN: warehouse staff who hand parcels over record tracking'; end if;
  if v_out is null then raise exception 'NOT_HANDED_OVER: tracking starts after hand-over'; end if;
  if p_status is null or p_status not in ('in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'info') then
    raise exception 'INVALID_STATUS: in transit, out for delivery, delivered, delivery problem, returned or an update';
  end if;
  if length(v_desc) < 3 or length(v_desc) > 300 then raise exception 'DESCRIPTION_REQUIRED: what the customer reads (3 to 300 characters)'; end if;
  if v_at > now() + interval '10 minutes' or v_at < v_out - interval '1 day' then raise exception 'INVALID_TIME: between hand-over and now'; end if;
  v_id := public.wh_tracking_apply(p_shipment, p_pallet, p_status, v_desc, p_location, v_at, 'staff', null);
  perform write_audit('wh_tracking.event', case when p_shipment is not null then 'wh_orders' else 'wh_freight_pallets' end,
    coalesce(x.order_id, fp.id)::text, jsonb_build_object('status', p_status, 'description', v_desc, 'tracking_no', x.tracking_no, 'pallet', fp.code));
  return jsonb_build_object('id', v_id, 'status', p_status);
end $$;
revoke all on function public.wh_tracking_add(uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.wh_tracking_add(uuid, uuid, text, text, text, timestamptz) to authenticated, service_role;

-- staging only, sandbox labels only: the next believable step, clearly marked as a sandbox event
create or replace function public.wh_tracking_sandbox_next(p_shipment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.wh_shipments;
  o public.wh_orders;
  v_status text;
  v_desc text;
  v_loc text;
begin
  if not public.wh_env_is_staging() then raise exception 'NOT_AVAILABLE: sandbox tracking exists only on staging'; end if;
  select * into x from public.wh_shipments where id = p_shipment;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', x.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if not x.sandbox then raise exception 'NOT_SANDBOX: only sandbox labels get sandbox events'; end if;
  select * into o from public.wh_orders where id = x.order_id;
  if x.status = 'handed_over' then v_status := 'in_transit'; v_desc := 'Departed the sorting centre (sandbox)'; v_loc := 'Guangzhou, CN';
  elsif x.status = 'in_transit' then v_status := 'out_for_delivery'; v_desc := 'Out for delivery (sandbox)'; v_loc := o.ship_country;
  elsif x.status = 'out_for_delivery' then v_status := 'delivered'; v_desc := 'Delivered (sandbox)'; v_loc := o.ship_country;
  else raise exception 'NO_NEXT_STEP: % is %', x.tracking_no, x.status; end if;
  perform public.wh_tracking_apply(x.id, null, v_status, v_desc, v_loc, clock_timestamp(), 'sandbox', null);
  perform write_audit('wh_tracking.event', 'wh_orders', x.order_id::text, jsonb_build_object('status', v_status, 'tracking_no', x.tracking_no, 'sandbox', true));
  return jsonb_build_object('status', v_status, 'description', v_desc);
end $$;
revoke all on function public.wh_tracking_sandbox_next(uuid) from public, anon;
grant execute on function public.wh_tracking_sandbox_next(uuid) to authenticated, service_role;

-- carrier polling (server job with the service role; lib/carriers/poll.ts): live labels on the way
create or replace function public.wh_tracking_poll_targets(p_limit integer default 100)
returns table (shipment_id uuid, carrier text, tracking_no text, credential_env text, last_event_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.carrier, s.tracking_no, a.credential_env, s.last_event_at
    from public.wh_shipments s join public.wh_carrier_accounts a on a.id = s.account_id
   where not s.sandbox and a.mode = 'live' and a.active and s.status in ('handed_over', 'in_transit', 'out_for_delivery', 'exception')
   order by s.last_event_at nulls first
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.wh_tracking_poll_targets(integer) from public, anon, authenticated;
grant execute on function public.wh_tracking_poll_targets(integer) to service_role;

create or replace function public.wh_tracking_record_carrier(p_carrier text, p_tracking_no text, p_provider_event text, p_status text, p_description text,
                                                             p_location text, p_occurred_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.wh_shipments;
begin
  if p_status is null or p_status not in ('in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'info') then raise exception 'INVALID_STATUS'; end if;
  if nullif(btrim(coalesce(p_provider_event, '')), '') is null then raise exception 'PROVIDER_EVENT_REQUIRED'; end if;
  select * into x from public.wh_shipments where carrier = p_carrier and tracking_no = upper(btrim(p_tracking_no)) and status <> 'voided' and not sandbox;
  if x.id is null then raise exception 'NOT_FOUND: label %', p_tracking_no; end if;
  return public.wh_tracking_apply(x.id, null, p_status, coalesce(nullif(btrim(coalesce(p_description, '')), ''), initcap(replace(p_status, '_', ' '))),
                                  p_location, p_occurred_at, 'carrier', p_carrier || ':' || btrim(p_provider_event)) is not null;
end $$;
revoke all on function public.wh_tracking_record_carrier(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.wh_tracking_record_carrier(text, text, text, text, text, text, timestamptz) to service_role;

-- ───────── 12. Customer tracking page data (board 7) ─────────
-- Served to anyone holding the token: order reference, "packed and shipped from {warehouse city}", destination country,
-- parcels (tracking numbers), events. Never: carrier / service / account, supplier, buyer name or address, merchant / store
-- name, staff, weights, internal codes. Sandbox shipments are served only on the staging database.
create or replace function public.wh_public_tracking(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tok text := nullif(lower(btrim(coalesce(p_token, ''))), '');
  o public.wh_orders;
  w public.warehouses;
  v_ref text;
  v_sandbox boolean;
  v_freight boolean;
  v_status text;
  v_states text[];
begin
  if v_tok is null or v_tok !~ '^[0-9a-f]{32,64}$' then return null; end if;
  select * into o from public.wh_orders where tracking_token = v_tok and status = 'shipped';
  if o.id is null then return null; end if;
  select coalesce(bool_or(s.sandbox), false) into v_sandbox from public.wh_shipments s where s.order_id = o.id and s.status <> 'voided';
  if v_sandbox and not public.wh_env_is_staging() then return null; end if;
  select * into w from public.warehouses where code = o.warehouse_code;
  select coalesce(o.external_ref, so.external_order_name, so.order_number, o.code) into v_ref
    from (select 1) x left join public.store_orders so on so.id = o.store_order_id;
  v_freight := exists (select 1 from public.wh_freight_parcels f where f.order_id = o.id);
  select array_agg(coalesce(s.status, case when fp.status = 'dispatched' then 'handed_over' end)) into v_states
    from public.wh_parcels p
    left join public.wh_shipments s on s.parcel_id = p.id and s.status <> 'voided'
    left join public.wh_freight_parcels f on f.parcel_id = p.id
    left join public.wh_freight_pallets fp on fp.id = f.pallet_id
   where p.order_id = o.id;
  v_status := case when 'delivered' = all(v_states) then 'delivered'
                   when 'exception' = any(v_states) then 'exception'
                   when 'returned' = any(v_states) then 'returned'
                   when 'out_for_delivery' = any(v_states) then 'out_for_delivery'
                   when 'in_transit' = any(v_states) or 'delivered' = any(v_states) then 'in_transit'
                   else 'shipped' end;
  return jsonb_build_object(
    'order_ref', v_ref,
    'shipped_from_city', w.city,
    'shipped_from_country', w.country,
    'destination_country', o.ship_country,
    'status', v_status,
    'status_label', case v_status when 'delivered' then 'Delivered' when 'exception' then 'Delivery problem — the carrier is on it'
                    when 'returned' then 'Returned to sender' when 'out_for_delivery' then 'Out for delivery' when 'in_transit' then 'In transit'
                    else 'Shipped' end,
    'shipped_at', o.shipped_at,
    'sandbox', v_sandbox,
    'freight', v_freight,
    'parcels', coalesce((
      select jsonb_agg(jsonb_build_object('seq', p.seq, 'tracking_no', s.tracking_no,
               'status', coalesce(s.status, case when fp.status = 'dispatched' then 'handed_over' end)) order by p.seq)
        from public.wh_parcels p
        left join public.wh_shipments s on s.parcel_id = p.id and s.status <> 'voided'
        left join public.wh_freight_parcels f on f.parcel_id = p.id
        left join public.wh_freight_pallets fp on fp.id = f.pallet_id
       where p.order_id = o.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('status', e.status, 'description', e.description, 'location', e.location, 'occurred_at', e.occurred_at,
               'parcel', e.seq) order by e.occurred_at desc)
        from (select ev.status, ev.description, ev.location, ev.occurred_at, p.seq
                from public.wh_tracking_events ev join public.wh_shipments s on s.id = ev.shipment_id join public.wh_parcels p on p.id = s.parcel_id
               where s.order_id = o.id and s.status <> 'voided'
              union all
              select ev.status, ev.description, ev.location, ev.occurred_at, null::smallint
                from public.wh_tracking_events ev
               where ev.pallet_id in (select f.pallet_id from public.wh_freight_parcels f where f.order_id = o.id)) e), '[]'::jsonb));
end $$;
revoke all on function public.wh_public_tracking(text) from public;
grant execute on function public.wh_public_tracking(text) to anon, authenticated, service_role;

-- ───────── 13. Staff boards ─────────
create or replace function public.wh_label_json(s public.wh_shipments)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', s.id, 'code', s.code, 'tracking_no', s.tracking_no, 'status', s.status, 'carrier', s.carrier, 'service_code', s.service_code,
    'service_name', s.service_name, 'account_id', s.account_id, 'sandbox', s.sandbox, 'label_path', s.label_path, 'weight_g', s.weight_g,
    'rule_reason', s.rule_reason, 'confirmed_at', s.confirmed_at, 'handed_over_at', s.handed_over_at, 'delivered_at', s.delivered_at,
    'dispatch_code', (select code from public.wh_dispatches where id = s.dispatch_id), 'created_at', s.created_at,
    'created_by_name', (select full_name from public.profiles where id = s.created_by),
    'printed', (select count(*) from public.audit_log g where g.entity = 'wh_orders' and g.entity_id = s.order_id::text and g.action = 'wh_label.printed' and g.details ->> 'label' = s.code))
$$;
revoke all on function public.wh_label_json(public.wh_shipments) from public, anon, authenticated;
grant execute on function public.wh_label_json(public.wh_shipments) to service_role;

-- board 13 + label check + manifests + freight + tracking (per warehouse the caller sees)
create or replace function public.wh_dispatch_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'staging', public.wh_env_is_staging(),
    'can_dispatch', coalesce((select jsonb_agg(w.code order by w.code) from public.warehouses w
                               where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_can('dispatch', w.code)), '[]'::jsonb),
    'can_void', coalesce((select jsonb_agg(w.code order by w.code) from public.warehouses w
                           where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_can('resolve_exception', w.code)), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'code', o.code, 'warehouse_code', o.warehouse_code, 'status', o.status, 'source', o.source, 'ship_country', o.ship_country,
               'owner', case when o.org_id is null then 'Octopus Dropship' else (select name from public.organizations where id = o.org_id) end,
               'dg_kinds', to_jsonb(o.dg_kinds), 'packed_at', o.packed_at,
               'parcels', coalesce((
                 select jsonb_agg(jsonb_build_object('id', p.id, 'seq', p.seq, 'weight_g', p.measured_weight_g,
                          'box', (select code from public.wh_boxes where id = p.box_id),
                          'pallet', (select fp.code from public.wh_freight_parcels f join public.wh_freight_pallets fp on fp.id = f.pallet_id where f.parcel_id = p.id),
                          'label', (select public.wh_label_json(s) from public.wh_shipments s where s.parcel_id = p.id and s.status <> 'voided')) order by p.seq)
                   from public.wh_parcels p where p.order_id = o.id), '[]'::jsonb))
             order by o.packed_at nulls last, o.created_at)
        from (select x.id from public.wh_orders x
               where x.status in ('packed', 'labelled') and (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
               order by x.packed_at nulls last limit 200) q
        join public.wh_orders o on o.id = q.id), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'warehouse_code', a.warehouse_code, 'carrier', a.carrier, 'name', a.name, 'mode', a.mode) order by a.warehouse_code, a.name)
        from public.wh_carrier_accounts a where a.active and (p_warehouse is null or a.warehouse_code = p_warehouse) and public.wh_sees(a.warehouse_code)), '[]'::jsonb),
    'ready', coalesce((
      select jsonb_agg(public.wh_label_json(s) || jsonb_build_object('order_code', o.code, 'parcel_seq', p.seq, 'ship_country', o.ship_country, 'warehouse_code', s.warehouse_code)
                       order by s.confirmed_at)
        from public.wh_shipments s join public.wh_orders o on o.id = s.order_id join public.wh_parcels p on p.id = s.parcel_id
       where s.status = 'confirmed' and s.dispatch_id is null and (p_warehouse is null or s.warehouse_code = p_warehouse) and public.wh_sees(s.warehouse_code)), '[]'::jsonb),
    'dispatches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'code', d.code, 'warehouse_code', d.warehouse_code, 'status', d.status, 'manifest_no', d.manifest_no, 'handed_to', d.handed_to,
               'created_at', d.created_at, 'closed_at', d.closed_at, 'closed_by_name', (select full_name from public.profiles where id = d.closed_by),
               'account', (select jsonb_build_object('id', a.id, 'carrier', a.carrier, 'name', a.name, 'mode', a.mode) from public.wh_carrier_accounts a where a.id = d.account_id),
               'lines', coalesce((
                 select jsonb_agg(jsonb_build_object('id', s.id, 'tracking_no', s.tracking_no, 'order_code', o.code, 'parcel_seq', p.seq, 'weight_g', s.weight_g,
                          'ship_country', o.ship_country, 'service_name', s.service_name, 'status', s.status, 'sandbox', s.sandbox) order by o.code, p.seq)
                   from public.wh_shipments s join public.wh_orders o on o.id = s.order_id join public.wh_parcels p on p.id = s.parcel_id
                  where s.dispatch_id = d.id and s.status <> 'voided'), '[]'::jsonb))
             order by (d.status = 'open') desc, coalesce(d.closed_at, d.created_at) desc)
        from (select x.id from public.wh_dispatches x
               where (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
                 and (x.status = 'open' or (x.status = 'handed_over' and x.closed_at > now() - interval '30 days'))
               order by (x.status = 'open') desc, coalesce(x.closed_at, x.created_at) desc limit 30) q
        join public.wh_dispatches d on d.id = q.id), '[]'::jsonb),
    'pallets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', fp.id, 'code', fp.code, 'warehouse_code', fp.warehouse_code, 'status', fp.status, 'destination', fp.destination,
               'gross_weight_g', fp.gross_weight_g, 'length_mm', fp.length_mm, 'width_mm', fp.width_mm, 'height_mm', fp.height_mm,
               'forwarder', fp.forwarder, 'reference', fp.reference, 'created_at', fp.created_at, 'closed_at', fp.closed_at, 'dispatched_at', fp.dispatched_at,
               'orders', coalesce((
                 select jsonb_agg(jsonb_build_object('order_id', o.id, 'order_code', o.code, 'ship_country', o.ship_country,
                          'owner', (select name from public.organizations where id = o.org_id), 'parcels', x.n, 'weight_g', x.g) order by o.code)
                   from (select f.order_id, count(*) n, sum(p.measured_weight_g)::integer g from public.wh_freight_parcels f join public.wh_parcels p on p.id = f.parcel_id
                          where f.pallet_id = fp.id group by f.order_id) x join public.wh_orders o on o.id = x.order_id), '[]'::jsonb),
               'printed', (select count(*) from public.audit_log g where g.entity = 'wh_freight_pallets' and g.entity_id = fp.id::text and g.action = 'wh_freight.label_printed'))
             order by (fp.status = 'dispatched'), fp.created_at desc)
        from (select x.id from public.wh_freight_pallets x
               where (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
                 and (x.status <> 'dispatched' or x.dispatched_at > now() - interval '30 days')
               order by (x.status = 'dispatched'), x.created_at desc limit 30) q
        join public.wh_freight_pallets fp on fp.id = q.id), '[]'::jsonb),
    'on_the_way', coalesce((
      select jsonb_agg(public.wh_label_json(s) || jsonb_build_object('order_code', o.code, 'parcel_seq', p.seq, 'ship_country', o.ship_country,
               'tracking_token', o.tracking_token, 'last_event', (select jsonb_build_object('status', e.status, 'description', e.description, 'at', e.occurred_at)
                                                                   from public.wh_tracking_events e where e.shipment_id = s.id order by e.occurred_at desc limit 1))
                       order by s.handed_over_at desc)
        from (select y.id from public.wh_shipments y
               where y.status in ('handed_over', 'in_transit', 'out_for_delivery', 'exception') and (p_warehouse is null or y.warehouse_code = p_warehouse)
                 and public.wh_sees(y.warehouse_code)
               order by y.handed_over_at desc limit 100) q
        join public.wh_shipments s on s.id = q.id join public.wh_orders o on o.id = s.order_id join public.wh_parcels p on p.id = s.parcel_id), '[]'::jsonb),
    'scans', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'result', c.result, 'order_code', o.code, 'at', c.created_at,
               'by_name', (select full_name from public.profiles where id = c.actor_id),
               'exception', (select code from public.wh_exceptions where id = c.exception_id)) order by c.created_at desc)
        from (select y.* from public.wh_label_scans y where (p_warehouse is null or y.warehouse_code = p_warehouse) and public.wh_sees(y.warehouse_code)
               order by y.created_at desc limit 20) c join public.wh_orders o on o.id = c.order_id), '[]'::jsonb));
end $$;
revoke all on function public.wh_dispatch_board(text) from public, anon;
grant execute on function public.wh_dispatch_board(text) to authenticated, service_role;

-- label centre, parcel tab: labels made in the last 30 days (and every label not yet handed over)
create or replace function public.wh_parcel_label_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(public.wh_label_json(s) || jsonb_build_object('order_code', o.code, 'parcel_seq', p.seq, 'parcels', (select count(*) from public.wh_parcels where order_id = o.id),
                     'ship_country', o.ship_country, 'warehouse_code', s.warehouse_code) order by s.created_at desc)
      from (select y.id from public.wh_shipments y
             where y.status <> 'voided' and (y.status in ('labelled', 'confirmed') or y.created_at > now() - interval '30 days')
               and (p_warehouse is null or y.warehouse_code = p_warehouse) and public.wh_sees(y.warehouse_code)
             order by y.created_at desc limit 300) q
      join public.wh_shipments s on s.id = q.id join public.wh_orders o on o.id = s.order_id join public.wh_parcels p on p.id = s.parcel_id), '[]'::jsonb);
end $$;
revoke all on function public.wh_parcel_label_board(text) from public, anon;
grant execute on function public.wh_parcel_label_board(text) to authenticated, service_role;

-- ───────── 14. Private label bucket ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wh-labels', 'wh-labels', false, 2097152, array['application/pdf'])
on conflict (id) do nothing;

-- staff who label at the warehouse upload a parcel's label PDF while the order is packed / labelled
create or replace function public.wh_labels_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name ~ '^[A-Z]{2,4}-[0-9]{2}/WO-[0-9]{6,}/P[0-9]{1,2}-[A-Z0-9-]{6,40}\.pdf$'
     and exists (select 1 from public.wh_orders o
                  where o.warehouse_code = split_part(p_name, '/', 1) and o.code = split_part(p_name, '/', 2) and o.status in ('packed', 'labelled'))
     and public.wh_can('dispatch', split_part(p_name, '/', 1))
$$;
revoke all on function public.wh_labels_can_upload(text) from public, anon;
grant execute on function public.wh_labels_can_upload(text) to authenticated, service_role;

drop policy if exists "wh labels upload" on storage.objects;
create policy "wh labels upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'wh-labels' and public.wh_labels_can_upload(name));
drop policy if exists "wh labels read" on storage.objects;
create policy "wh labels read" on storage.objects for select to authenticated
  using (bucket_id = 'wh-labels' and public.wh_sees(split_part(name, '/', 1)));
