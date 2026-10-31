-- Octopus B2B — core schema (SPEC §5, §6). Forward-only migration.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ───────────────────────── Enums (state machines §5) ─────────────────────────
create type kyc_status as enum ('not_started','submitted','in_review','verified','rejected','more_info');
create type product_status as enum ('draft','submitted','in_review','live','rejected','paused','archived');
create type rfq_status as enum ('draft','submitted','assigned','quoting','quoted','accepted','expired','cancelled');
create type quote_status as enum ('draft','sent','viewed','approved','rejected','expired','superseded');
create type order_status as enum ('pi_issued','deposit_pending','deposit_paid','confirmed','in_production','qc','balance_pending','balance_paid','ready_to_ship','shipped','delivered','closed','cancelled','disputed');
create type payment_status as enum ('initiated','pending','matched','confirmed','failed','refunded');
create type shipment_status as enum ('draft','priced','created','label_ready','picked_up','in_transit','out_for_delivery','delivered','exception','returned');
create type service_request_status as enum ('requested','paid','accepted','in_progress','report_ready','completed','rejected','refunded');
create type certificate_status as enum ('uploaded','verified','expiring','expired','rejected');
create type ticket_status as enum ('new','open','waiting_customer','waiting_internal','resolved','closed','reopened');
create type approval_status as enum ('requested','approved','rejected','executed');
create type payout_status as enum ('scheduled','approved','sent','settled','failed');
create type campaign_status as enum ('draft','in_review','active','paused','ended','rejected');
create type topup_status as enum ('initiated','pending','credited','failed');
create type withdrawal_status as enum ('requested','approved','sent','completed','rejected');
create type content_status as enum ('draft','in_review','scheduled','published','superseded');

-- ───────────────────────── Utility ─────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create sequence seq_supplier_code start 1101;
create sequence seq_rfq start 1001;
create sequence seq_quote start 1;
create sequence seq_pi start 1001;
create sequence seq_order start 2201;
create sequence seq_shipment start 1001;
create sequence seq_ticket start 1001;
create sequence seq_service_request start 301;
create sequence seq_invoice start 401;
create sequence seq_journal start 1;

-- ───────────────────────── Identity & orgs ─────────────────────────
create table roles (
  code text primary key,
  name text not null,
  description text,
  is_staff boolean not null default true,
  sort int not null default 0
);

create table permission_areas (
  code text primary key,
  name text not null,
  sort int not null default 0
);

create table role_permissions (
  role_code text references roles(code) on delete cascade,
  area text references permission_areas(code) on delete cascade,
  action text not null check (action in ('view','create','edit','delete','approve','export')),
  primary key (role_code, area, action)
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  country text,
  avatar_url text,
  totp_required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();

create table user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role_code text references roles(code) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (user_id, role_code)
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  city text,
  business_type text,
  registration_no text,
  website text,
  kyc_status kyc_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create trigger trg_org_updated before update on organizations for each row execute function set_updated_at();

create table org_members (
  org_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  member_role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on org_members(user_id);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  label text, line1 text not null, line2 text, city text, region text, postal_code text, country text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index on addresses(org_id);

create table kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  status kyc_status not null default 'submitted',
  company_name text, registration_no text, address text, contact_name text, contact_phone text, contact_email text,
  reviewer_id uuid references auth.users(id),
  review_note text,
  submitted_at timestamptz default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on kyc_submissions(org_id);

create table kyc_documents (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references kyc_submissions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  file_name text,
  created_at timestamptz not null default now()
);
create index on kyc_documents(submission_id);

create table audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  entity text,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create table status_history (
  id bigserial primary key,
  entity text not null,
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);
create index on status_history(entity, entity_id);

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','dispatched','done','failed','dead')),
  attempts int not null default 0,
  last_error text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on outbox_events(status, available_at);

create table job_runs (
  event_id uuid not null,
  consumer text not null,
  outcome text not null default 'ok',
  duration_ms int,
  created_at timestamptz not null default now(),
  primary key (event_id, consumer)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications(user_id);
create index on notifications(org_id);

-- ───────────────────────── Permission helpers ─────────────────────────
create or replace function has_role(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role_code = p_role);
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role_code = 'admin');
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles ur join roles r on r.code = ur.role_code
                where ur.user_id = auth.uid() and r.is_staff);
$$;

create or replace function has_permission(p_user uuid, p_area text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = p_user and role_code = 'admin')
      or exists(select 1 from user_roles ur join role_permissions rp on rp.role_code = ur.role_code
                where ur.user_id = p_user and rp.area = p_area and rp.action = p_action);
$$;

create or replace function can(p_area text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select has_permission(auth.uid(), p_area, p_action);
$$;

create or replace function my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid();
$$;

create or replace function my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid() order by created_at limit 1;
$$;

create or replace function write_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), p_action, p_entity, p_entity_id, p_details);
$$;

create or replace function emit_event(p_type text, p_agg_type text, p_agg_id uuid, p_payload jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into outbox_events(event_type, aggregate_type, aggregate_id, payload) values (p_type, p_agg_type, p_agg_id, coalesce(p_payload,'{}'));
$$;

create or replace function log_status(p_entity text, p_id uuid, p_from text, p_to text, p_reason text default null)
returns void language sql security definer set search_path = public as $$
  insert into status_history(entity, entity_id, from_status, to_status, actor_id, reason) values (p_entity, p_id, p_from, p_to, auth.uid(), p_reason);
$$;

-- ───────────────────────── Content & settings ─────────────────────────
create table site_settings (
  key text primary key,
  value jsonb not null,
  description text,
  is_public boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table company_profile (
  id int primary key default 1 check (id = 1),
  legal_name text not null,
  brand text, tagline text,
  address text, address_cn text,
  contact_person text, phone text, whatsapp text, email text, website text,
  updated_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null, city text, country text, address text, phone text, email text,
  sort int not null default 0, active boolean not null default true,
  created_at timestamptz not null default now()
);

create table content_blocks (
  key text primary key,
  value text not null,
  status content_status not null default 'published',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  body text not null default '',
  status content_status not null default 'draft',
  is_legal boolean not null default false,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  entity text not null, entity_id text not null,
  snapshot jsonb not null,
  created_by uuid, created_at timestamptz not null default now()
);

create table terms_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  status content_status not null default 'draft',
  sections jsonb not null default '[]',   -- [{no, title, body}] 15 sections
  publish_at timestamptz,
  published_at timestamptz,
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz not null default now()
);

create table banners (
  id uuid primary key default gen_random_uuid(),
  placement text not null, title text, subtitle text, image_url text, link text,
  active boolean not null default true, sort int not null default 0
);

create table email_templates (
  code text primary key, subject text not null, body text not null, updated_at timestamptz not null default now()
);

create or replace function setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from site_settings where key = p_key;
$$;

create or replace function setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value)::text::boolean from site_settings where key = p_key), false);
$$;

-- ───────────────────────── Suppliers ─────────────────────────
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('OCT-' || nextval('seq_supplier_code')),
  legal_name text not null,
  country text not null,
  city text,
  supplier_type text default 'Manufacturer',
  contact_name text, contact_email text, contact_phone text,
  verified boolean not null default false,
  main_categories text,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table supplier_switches (
  supplier_id uuid primary key references suppliers(id) on delete cascade,
  portal_login boolean not null default false,
  product_upload boolean not null default true,
  rfq_replies boolean not null default true,
  listings_live boolean not null default true,
  ai_tools boolean not null default true,
  updated_at timestamptz not null default now()
);

create table distributor_suppliers (
  distributor_id uuid references auth.users(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  primary key (distributor_id, supplier_id)
);

create table supplier_verifications (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  doc_type text, storage_path text, status text default 'pending',
  created_at timestamptz not null default now()
);

create or replace function is_my_supplier(p_supplier uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from distributor_suppliers where distributor_id = auth.uid() and supplier_id = p_supplier)
      or exists(select 1 from suppliers where id = p_supplier and user_id = auth.uid());
$$;

-- Buyers only ever see code + country + badge (§3)
create view public_suppliers as
  select id, code, country, verified, supplier_type from suppliers where archived_at is null;

-- ───────────────────────── Catalog ─────────────────────────
create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id) on delete restrict,
  name text not null,
  slug text not null,
  level int not null check (level between 1 and 4),
  hs_code text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (parent_id, slug)
);
create index on categories(parent_id);

create table tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  slug text unique not null,
  kind text not null default 'general',
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  supplier_id uuid not null references suppliers(id),
  category_id uuid references categories(id),
  status product_status not null default 'draft',
  unit text not null default 'pcs',
  moq int not null default 1,
  lead_time_days int,
  incoterm text default 'FOB',
  origin_country text,
  hs_code text,
  octopus_dropship boolean not null default false,
  ready_to_ship boolean not null default false,
  featured boolean not null default false,
  seo_title text, seo_description text,
  image_url text,
  min_price_cents bigint,
  rejection_reason text,
  search tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(hs_code,''))) stored,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create trigger trg_products_updated before update on products for each row execute function set_updated_at();
create index on products(status);
create index on products(category_id);
create index on products(supplier_id);
create index products_search_idx on products using gin(search);
create index products_title_trgm on products using gin(title gin_trgm_ops);

create table product_tags (
  product_id uuid references products(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

create table price_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  min_qty int not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  unique (product_id, min_qty)
);

-- Supplier cost is staff-only (buyers never see costs)
create table product_costs (
  product_id uuid primary key references products(id) on delete cascade,
  supplier_cost_cents bigint not null
);

create table product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url text not null, kind text not null default 'image', sort int not null default 0, alt text
);

create table product_specs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null, value text not null, sort int not null default 0
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  name text not null, issuer text, number text,
  storage_path text, status certificate_status not null default 'uploaded',
  expires_at date,
  created_at timestamptz not null default now()
);

create table product_certificates (
  product_id uuid references products(id) on delete cascade,
  certificate_id uuid references certificates(id) on delete cascade,
  primary key (product_id, certificate_id)
);

create table recommendations (
  product_id uuid references products(id) on delete cascade,
  recommended_id uuid references products(id) on delete cascade,
  score real default 1,
  primary key (product_id, recommended_id)
);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id),
  file_name text, status text not null default 'validating',
  total_rows int default 0, valid_rows int default 0, error_rows int default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table import_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references import_jobs(id) on delete cascade,
  row_no int not null, data jsonb not null, errors jsonb, product_id uuid references products(id)
);

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('photo_enhance','poster','seo_fix','description')),
  product_id uuid references products(id) on delete set null,
  input jsonb, output jsonb, status text not null default 'queued',
  org_id uuid, created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table source_connections (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  source text not null check (source in ('1688','alibaba')),
  status text not null default 'disconnected',
  created_at timestamptz not null default now()
);

-- ───────────────────────── Services & fees ─────────────────────────
create table services (
  code text primary key,
  name text not null,
  description text,
  unit text not null default 'per request',
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table service_prices (
  id uuid primary key default gen_random_uuid(),
  service_code text not null references services(code) on delete cascade,
  amount_usd_cents bigint not null check (amount_usd_cents >= 0),
  effective_from timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on service_prices(service_code, effective_from desc);

create or replace function current_service_price(p_code text) returns bigint
language sql stable security definer set search_path = public as $$
  select amount_usd_cents from service_prices where service_code = p_code and effective_from <= now()
  order by effective_from desc limit 1;
$$;

create table service_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('SRV-' || lpad(nextval('seq_service_request')::text, 4, '0')),
  org_id uuid not null references organizations(id),
  service_code text not null references services(code),
  product_id uuid references products(id),
  order_id uuid,
  status service_request_status not null default 'requested',
  details jsonb not null default '{}',
  fee_usd_cents bigint not null default 0,
  paid_via text,
  assigned_to uuid references auth.users(id),
  report_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_sr_updated before update on service_requests for each row execute function set_updated_at();
create index on service_requests(org_id);

-- ───────────────────────── Trade ─────────────────────────
create table rfqs (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('RFQ-' || nextval('seq_rfq')),
  org_id uuid not null references organizations(id),
  product_id uuid references products(id),
  category_id uuid references categories(id),
  title text not null,
  details text,
  quantity int not null check (quantity > 0),
  unit text default 'pcs',
  target_price_cents bigint,
  destination_country text,
  destination_city text,
  incoterm text,
  status rfq_status not null default 'submitted',
  fee_usd_cents bigint not null default 0,
  assigned_to uuid references auth.users(id),
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_rfq_updated before update on rfqs for each row execute function set_updated_at();
create index on rfqs(org_id);
create index on rfqs(status);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  rfq_id uuid not null references rfqs(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  unit_price_cents bigint not null check (unit_price_cents > 0),
  quantity int not null,
  incoterm text not null default 'FOB',
  lead_time_days int,
  shipping_cents bigint not null default 0,
  notes text,
  status quote_status not null default 'sent',
  valid_until timestamptz not null default (now() + interval '30 days'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on quotes(rfq_id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('ORD-' || nextval('seq_order')),
  org_id uuid not null references organizations(id),
  quote_id uuid references quotes(id),
  rfq_id uuid references rfqs(id),
  supplier_id uuid references suppliers(id),
  status order_status not null default 'pi_issued',
  title text not null,
  quantity int not null,
  unit_price_cents bigint not null,
  shipping_cents bigint not null default 0,
  total_cents bigint not null,
  deposit_pct int not null default 30,
  deposit_cents bigint not null,
  paid_cents bigint not null default 0,
  incoterm text,
  terms_version_id uuid references terms_versions(id),
  delivered_at timestamptz,
  claim_visible_until timestamptz,
  claim_hidden_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_orders_updated before update on orders for each row execute function set_updated_at();
create index on orders(org_id);
create index on orders(status);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  org_id uuid not null,
  kind text not null,
  title text not null,
  body text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on order_events(order_id);

create table proforma_invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  order_id uuid not null references orders(id) on delete cascade,
  org_id uuid not null,
  total_cents bigint not null,
  deposit_cents bigint not null,
  issued_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  supplier_id uuid references suppliers(id),
  doc_type text not null check (doc_type in ('proforma_invoice','commercial_invoice','receipt','confirmation','statement','credit_note','purchase_order','remittance','qc_report')),
  number text not null,
  order_id uuid references orders(id),
  amount_cents bigint,
  status text default 'issued',
  pdf_path text,
  data jsonb,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on documents(org_id);

-- ───────────────────────── Money (double-entry ledger) ─────────────────────────
create table ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  kind text not null check (kind in ('asset','liability','revenue','expense','equity')),
  org_id uuid references organizations(id),
  created_at timestamptz not null default now()
);

create table journals (
  id uuid primary key default gen_random_uuid(),
  number text unique not null default ('JRN-' || lpad(nextval('seq_journal')::text, 6, '0')),
  memo text not null,
  idempotency_key text unique,
  stream text,                 -- revenue stream tag for reporting
  ref_type text, ref_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table ledger_entries (
  id bigserial primary key,
  journal_id uuid not null references journals(id),
  account_id uuid not null references ledger_accounts(id),
  org_id uuid,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  memo text,
  created_at timestamptz not null default now(),
  check ((debit_cents = 0) <> (credit_cents = 0))
);
create index on ledger_entries(account_id);
create index on ledger_entries(org_id);
create index on ledger_entries(journal_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  order_id uuid references orders(id),
  purpose text not null check (purpose in ('deposit','balance','topup','service','other')),
  method text not null default 'bank_transfer',
  amount_cents bigint not null check (amount_cents > 0),
  reference text,
  provider_event_id text unique,
  status payment_status not null default 'pending',
  matched_by uuid, confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table wallet_topups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'bank_transfer',
  reference text,
  status topup_status not null default 'pending',
  payment_id uuid references payments(id),
  created_by uuid,
  created_at timestamptz not null default now()
);

create table wallet_withdrawals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  amount_cents bigint not null check (amount_cents > 0),
  status withdrawal_status not null default 'requested',
  bank_details jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table finance_approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund','credit_note','payout','adjustment','withdrawal')),
  org_id uuid references organizations(id),
  supplier_id uuid references suppliers(id),
  order_id uuid references orders(id),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null,
  status approval_status not null default 'requested',
  requested_by uuid not null,
  approved_by uuid,
  decided_at timestamptz,
  executed_journal_id uuid references journals(id),
  created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  amount_cents bigint not null,
  status payout_status not null default 'scheduled',
  approval_id uuid references finance_approvals(id),
  reference text,
  created_at timestamptz not null default now()
);

create table fx_rates (
  currency text, rate numeric not null, as_of date not null default current_date,
  primary key (currency, as_of)
);

-- ───────────────────────── Logistics ─────────────────────────
create table carriers (
  code text primary key, name text not null, active boolean not null default true
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('SHP-' || nextval('seq_shipment')),
  order_id uuid not null references orders(id),
  org_id uuid not null,
  carrier_code text not null references carriers(code),
  service_code text,
  tracking_no text,
  label_url text,
  status shipment_status not null default 'draft',
  weight_kg numeric, parcels int default 1,
  rate_cents bigint,
  eta date,
  last_event_at timestamptz,
  created_at timestamptz not null default now()
);
create index on shipments(order_id);

create table tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  org_id uuid not null,
  provider_event_id text unique,
  status text not null,
  description text,
  location text,
  occurred_at timestamptz not null default now()
);
create index on tracking_events(shipment_id);

-- ───────────────────────── Integrations & API ─────────────────────────
create table integrations (
  code text primary key,
  name text not null,
  kind text not null,
  mode text not null default 'sandbox' check (mode in ('sandbox','live','off')),
  status text not null default 'not_configured',
  config jsonb not null default '{}',   -- non-secret config only; secrets in Vault
  last_tested_at timestamptz,
  updated_at timestamptz not null default now()
);

create table integration_logs (
  id bigserial primary key, integration_code text, direction text, status int, summary text, created_at timestamptz default now()
);

create table api_clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  client_id text unique not null default ('cli_' || encode(gen_random_bytes(8), 'hex')),
  scopes text[] not null default '{catalog:read}',
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references api_clients(id) on delete cascade,
  org_id uuid not null,
  mode text not null check (mode in ('test','live')),
  prefix text not null,
  key_hash text unique not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  url text not null,
  events text[] not null default '{order.updated}',
  secret text not null default encode(gen_random_bytes(24), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid references webhook_endpoints(id) on delete cascade,
  org_id uuid,
  event_type text, payload jsonb, response_status int, attempts int default 0,
  delivered_at timestamptz, created_at timestamptz not null default now()
);

create table idempotency_keys (
  key text primary key, scope text, response jsonb, created_at timestamptz not null default now()
);

-- ───────────────────────── Support ─────────────────────────
create table sla_policies (
  priority text primary key, first_response_hours int not null, resolve_hours int not null
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('TKT-' || nextval('seq_ticket')),
  org_id uuid not null references organizations(id),
  order_id uuid references orders(id),
  subject text not null,
  category text not null default 'question',
  priority text not null default 'normal' references sla_policies(priority),
  status ticket_status not null default 'new',
  assigned_to uuid references auth.users(id),
  sla_due_at timestamptz,
  csat int check (csat between 1 and 5),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_tickets_updated before update on tickets for each row execute function set_updated_at();
create index on tickets(org_id);

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  org_id uuid not null,
  author_id uuid references auth.users(id),
  is_staff boolean not null default false,
  internal boolean not null default false,
  body text not null,
  attachments jsonb default '[]',
  created_at timestamptz not null default now()
);
create index on ticket_messages(ticket_id);

create table support_macros (
  id uuid primary key default gen_random_uuid(), title text not null, body text not null
);

-- ───────────────────────── Advertising ─────────────────────────
create table ad_placements (
  code text primary key, name text not null, min_cpc_cents bigint not null default 10
);

create table ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  supplier_id uuid references suppliers(id),
  name text not null,
  placement text not null references ad_placements(code),
  headline text not null, body text, link text, image_url text,
  target_categories uuid[] default '{}', target_countries text[] default '{}',
  daily_budget_cents bigint not null check (daily_budget_cents > 0),
  max_cpc_cents bigint not null check (max_cpc_cents > 0),
  spent_today_cents bigint not null default 0,
  status campaign_status not null default 'draft',
  rejection_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table ad_clicks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references ad_campaigns(id) on delete cascade,
  fingerprint text not null,
  charged_cents bigint not null default 0,
  valid boolean not null default true,
  created_at timestamptz not null default now()
);
create index on ad_clicks(campaign_id, created_at);
create table ad_impressions (
  campaign_id uuid references ad_campaigns(id) on delete cascade, day date not null default current_date, count int not null default 0,
  primary key (campaign_id, day)
);
