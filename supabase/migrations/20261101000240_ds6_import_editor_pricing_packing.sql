-- Octopus Dropship · Release 2 · Step 6 (import list, merchant product editor, push queue, pushed products, pricing and
-- sync rules) + Step 6b merchant half (packing and shipping).
-- Down: supabase/migrations/down/20261101000240_ds6_import_editor_pricing_packing.down.sql
--
-- Nothing existing is replaced or altered: every object below is new, so the down only drops what this file creates and
-- the up → down schema diff is empty by construction. Re-runnable inside one transaction (if not exists / create or
-- replace / drop … if exists before each policy), so supabase/tests/lib-later-migrations.mjs unwind + reapply keeps working.
--
--  1. store_connections — the merchant-readable store record Step 5 writes (no secrets; service role writes only). Created
--     here so push jobs and rate mappings can reference it; Step 5 adds credentials, nonces and webhook dedupe next to it.
--     No row can exist until Step 5 ships, so every push stays at "Connect a store first" (no fake pushes).
--  2. dropship_fx_rates — store-currency exchange rates with a NAMED source (staff-only table; merchants read through RPCs).
--  3. dropship_pricing_rules — cost bands, rounding, compare-at, minimum profit, store currency, reprice threshold,
--     "when things change" choices (the engine that acts on them is Step 11).
--  4. dropship_listings / dropship_listing_variants — the merchant's own copy of a product (Octopus data never changes).
--  5. dropship_push_batches / dropship_push_jobs — durable, idempotent, resumable push queue (one job per product).
--  6. dropship_product_links / dropship_variant_links — Shopify product / variant IDs after a push (matching never uses SKU).
--  7. dropship_price_approvals / dropship_sync_log — written by the Step 11 engine; empty states today.
--  8. dropship_packing_settings / dropship_duty_modes / dropship_rate_mappings — Packing and shipping (Step 6b merchant).
--  9. RPCs (SECURITY DEFINER, search_path = public, revoked from public/anon). Merchants never write these tables directly.
--
-- Money: integer minor units. USD cents for landed cost; store-currency minor units (exponent per currency: KWD/BHD/OMR = 3)
-- for prices. The FX rate (and its source) is stored with every price calculation saved in a push job.
-- White-label: every text the merchant sends to the store is checked for the words "Octopus" / "Shenzhen", supplier and
-- factory names / codes and the product's Sourcing model numbers; the merchant is told WHICH FIELD, never the matched term.

-- ───────────────────────── 1. store_connections ─────────────────────────
create table if not exists public.store_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null default 'shopify' check (platform in ('shopify')),
  shop_domain text not null check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  shop_name text,
  status text not null default 'connecting' check (status in ('connecting', 'active', 'needs_reconnect', 'disconnected')),
  status_reason text,
  shop_currency char(3) check (shop_currency is null or shop_currency ~ '^[A-Z]{3}$'),
  octopus_location_id text,
  fulfillment_service_id text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.store_connections is 'Dropship Step 6 (contract for Step 5): one row per connected store. Merchant-readable, no secrets; written by the service role only (Step 5 OAuth / token exchange). Push jobs run only while status = active.';
create unique index if not exists store_connections_shop_uidx on public.store_connections (platform, shop_domain) where status <> 'disconnected';
create index if not exists store_connections_org_idx on public.store_connections (org_id, status);

-- ───────────────────────── 2. dropship_fx_rates ─────────────────────────
create table if not exists public.dropship_fx_rates (
  id uuid primary key default gen_random_uuid(),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$' and currency <> 'USD'),
  rate_per_usd numeric(18, 8) not null check (rate_per_usd > 0),
  source_name text not null check (length(btrim(source_name)) between 2 and 120),
  effective_from timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.dropship_fx_rates is 'Dropship Step 6: store-currency rates (store currency per 1 USD) with a named source. Staff-only table; merchants read the current rate through ds_pricing_get(). The daily feed is Step 11.';
create index if not exists dropship_fx_rates_cur_idx on public.dropship_fx_rates (currency, effective_from desc);

-- ───────────────────────── 3. dropship_pricing_rules ─────────────────────────
create table if not exists public.dropship_pricing_rules (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  bands jsonb not null default '[]'::jsonb check (jsonb_typeof(bands) = 'array'),
  rounding text not null default 'end_99' check (rounding in ('end_99', 'end_95', 'whole', 'none')),
  compare_at_bp integer check (compare_at_bp is null or compare_at_bp in (2500, 5000)),
  min_profit_bp integer not null check (min_profit_bp between 0 and 9000),
  store_currency char(3) not null default 'USD' check (store_currency ~ '^[A-Z]{3}$'),
  fx_threshold_bp integer check (fx_threshold_bp is null or fx_threshold_bp between 0 and 5000),
  main_market char(2) check (main_market is null or main_market ~ '^[A-Z]{2}$'),
  when_landed_up text not null default 'reprice' check (when_landed_up in ('reprice', 'ask', 'alert')),
  when_landed_down text not null default 'keep' check (when_landed_down in ('keep', 'reprice')),
  when_out_of_stock text not null default 'draft' check (when_out_of_stock in ('draft', 'sold_out', 'nothing')),
  check_every_hours integer not null default 1 check (check_every_hours in (1, 3, 6, 24)),
  alert_low_stock boolean not null default true,
  email_alerts boolean not null default true,
  saved_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict
);
comment on table public.dropship_pricing_rules is 'Dropship Step 6: the merchant''s pricing rule (cost bands on the landed cost in USD cents, rounding, compare-at, minimum profit) and sync choices. Written only by ds_pricing_save().';

-- ───────────────────────── 4. merchant listing copy ─────────────────────────
create table if not exists public.dropship_listings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.dropship_products(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 255),
  description text not null default '' check (length(description) <= 20000),
  image_urls text[] not null default '{}',
  vendor text check (vendor is null or length(vendor) <= 120),
  product_type text check (product_type is null or length(product_type) <= 120),
  collection text check (collection is null or length(collection) <= 120),
  tags text[] not null default '{}',
  handle text check (handle is null or handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  seo_title text check (seo_title is null or length(seo_title) <= 70),
  seo_description text check (seo_description is null or length(seo_description) <= 160),
  publish_as text not null default 'draft' check (publish_as in ('draft', 'active')),
  sync_stock boolean not null default true,
  sync_price boolean not null default true,
  price_mode text not null default 'rule' check (price_mode in ('rule', 'manual')),
  text_checked_at timestamptz,
  saved_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  unique (org_id, product_id)
);
comment on table public.dropship_listings is 'Dropship Step 6: the merchant''s copy of a catalogue product for their store (title, description, images, organisation, SEO). Octopus product data is never changed. Written only by ds_listing_save().';
create index if not exists dropship_listings_product_idx on public.dropship_listings (product_id);

create table if not exists public.dropship_listing_variants (
  listing_id uuid not null references public.dropship_listings(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  variant_id uuid not null references public.dropship_variants(id) on delete cascade,
  include boolean not null default true,
  store_sku text check (store_sku is null or store_sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  price_minor bigint check (price_minor is null or price_minor > 0),
  compare_at_minor bigint check (compare_at_minor is null or compare_at_minor > 0),
  saved_at timestamptz not null default now(),
  primary key (listing_id, variant_id)
);
comment on table public.dropship_listing_variants is 'Dropship Step 6: per-variant choices of the merchant copy (push or not, store SKU — default the DS variant model no. — manual price / compare-at in store-currency minor units).';
create index if not exists dropship_listing_variants_variant_idx on public.dropship_listing_variants (variant_id);
create index if not exists dropship_listing_variants_org_idx on public.dropship_listing_variants (org_id);

-- ───────────────────────── 5. push queue ─────────────────────────
create table if not exists public.dropship_push_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_connection_id uuid references public.store_connections(id) on delete cascade,
  kind text not null default 'push' check (kind in ('push', 'unlink')),
  request_key uuid not null,
  options jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, request_key)
);
comment on table public.dropship_push_batches is 'Dropship Step 6: one push (or unlink) request from the merchant; request_key makes a double submit a replay, not a second batch.';

create table if not exists public.dropship_push_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.dropship_push_batches(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_connection_id uuid references public.store_connections(id) on delete cascade,
  product_id uuid not null references public.dropship_products(id) on delete cascade,
  listing_id uuid references public.dropship_listings(id) on delete set null,
  kind text not null default 'push' check (kind in ('push', 'unlink')),
  status text not null default 'queued' check (status in ('queued', 'running', 'retry_wait', 'done', 'failed', 'blocked', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.dropship_push_jobs is 'Dropship Step 6: one durable job per product. payload = merchant-safe listing snapshot (no supplier, cost or Sourcing fields); pricing = calculation snapshot with FX rate + source. At most one open job per store and product. Executed only while the store connection is active (ds_push_claim).';
create unique index if not exists dropship_push_jobs_open_uidx on public.dropship_push_jobs (store_connection_id, product_id)
  where status in ('queued', 'running', 'retry_wait');
create index if not exists dropship_push_jobs_due_idx on public.dropship_push_jobs (status, next_attempt_at);
create index if not exists dropship_push_jobs_org_idx on public.dropship_push_jobs (org_id, created_at desc);
create index if not exists dropship_push_jobs_batch_idx on public.dropship_push_jobs (batch_id);
create index if not exists dropship_push_jobs_product_idx on public.dropship_push_jobs (product_id);
create index if not exists dropship_push_jobs_listing_idx on public.dropship_push_jobs (listing_id);

-- ───────────────────────── 6. links after a push ─────────────────────────
create table if not exists public.dropship_product_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_connection_id uuid not null references public.store_connections(id) on delete cascade,
  product_id uuid not null references public.dropship_products(id) on delete cascade,
  listing_id uuid references public.dropship_listings(id) on delete set null,
  product_gid text not null,
  status text not null default 'linked' check (status in ('linked', 'unlinked')),
  store_status text not null default 'draft' check (store_status in ('draft', 'active', 'archived')),
  sync_state text not null default 'in_sync' check (sync_state in ('in_sync', 'needs_you', 'out_of_stock', 'price_updated', 'failed')),
  sync_message text,
  last_pushed_at timestamptz,
  last_synced_at timestamptz,
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_connection_id, product_id)
);
comment on table public.dropship_product_links is 'Dropship Step 6: the Shopify product a catalogue product was pushed to. Re-push updates through product_gid, so it never duplicates.';
create index if not exists dropship_product_links_org_idx on public.dropship_product_links (org_id, status);
create index if not exists dropship_product_links_product_idx on public.dropship_product_links (product_id);
create index if not exists dropship_product_links_listing_idx on public.dropship_product_links (listing_id);

create table if not exists public.dropship_variant_links (
  product_link_id uuid not null references public.dropship_product_links(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  variant_id uuid not null references public.dropship_variants(id) on delete cascade,
  variant_gid text not null,
  inventory_item_gid text,
  store_sku text,
  price_minor bigint,
  compare_at_minor bigint,
  currency char(3),
  updated_at timestamptz not null default now(),
  primary key (product_link_id, variant_id)
);
comment on table public.dropship_variant_links is 'Dropship Step 6: Shopify variant / inventory item IDs per DS variant (orders are matched by these IDs, never by SKU).';
create index if not exists dropship_variant_links_variant_idx on public.dropship_variant_links (variant_id);
create index if not exists dropship_variant_links_org_idx on public.dropship_variant_links (org_id);

-- ───────────────────────── 7. approvals + sync log (Step 11 writes them) ─────────────────────────
create table if not exists public.dropship_price_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_link_id uuid references public.dropship_product_links(id) on delete cascade,
  product_id uuid not null references public.dropship_products(id) on delete cascade,
  variant_id uuid references public.dropship_variants(id) on delete cascade,
  reason_code text not null check (reason_code in ('landed_up', 'landed_down', 'fx_moved', 'below_min')),
  old_landed_usd_cents bigint,
  new_landed_usd_cents bigint,
  old_price_minor bigint,
  new_price_minor bigint,
  currency char(3),
  fx_rate numeric(18, 8),
  old_profit_bp integer,
  new_profit_bp integer,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'kept_old', 'expired')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.dropship_price_approvals is 'Dropship Step 6: price changes waiting for the merchant (written by the Step 11 sync engine; decided with ds_price_approval_decide()).';
create index if not exists dropship_price_approvals_org_idx on public.dropship_price_approvals (org_id, status);
create index if not exists dropship_price_approvals_link_idx on public.dropship_price_approvals (product_link_id);
create index if not exists dropship_price_approvals_product_idx on public.dropship_price_approvals (product_id);
create index if not exists dropship_price_approvals_variant_idx on public.dropship_price_approvals (variant_id);

create table if not exists public.dropship_sync_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_connection_id uuid references public.store_connections(id) on delete cascade,
  product_id uuid references public.dropship_products(id) on delete set null,
  kind text not null check (kind in ('push', 'unlink', 'price', 'stock', 'fx', 'status')),
  change_text text not null,
  result_text text not null,
  created_at timestamptz not null default now()
);
comment on table public.dropship_sync_log is 'Dropship Step 6: merchant-safe sync history (plain words only; no supplier, cost or stock numbers).';
create index if not exists dropship_sync_log_org_idx on public.dropship_sync_log (org_id, created_at desc);
create index if not exists dropship_sync_log_conn_idx on public.dropship_sync_log (store_connection_id);
create index if not exists dropship_sync_log_product_idx on public.dropship_sync_log (product_id);

-- ───────────────────────── 8. Packing and shipping (Step 6b merchant) ─────────────────────────
create table if not exists public.dropship_packing_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  default_packaging text not null default 'standard' check (default_packaging in ('standard', 'protective', 'branded')),
  branded_sku_id uuid references public.wh_client_skus(id) on delete set null,
  insert_card boolean not null default false,
  insert_card_sku_id uuid references public.wh_client_skus(id) on delete set null,
  sticker boolean not null default false,
  sticker_sku_id uuid references public.wh_client_skus(id) on delete set null,
  gift_message boolean not null default true,
  packing_slip text not null default 'brand_no_prices' check (packing_slip in ('brand_no_prices', 'none')),
  insurance boolean not null default false,
  signature boolean not null default false,
  default_method text not null default 'standard' check (default_method in ('economy', 'standard', 'express')),
  fallback_method text not null default 'cheapest_on_time' check (fallback_method in ('cheapest_on_time', 'economy', 'standard', 'express')),
  saved_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict
);
comment on table public.dropship_packing_settings is 'Dropship Step 6b: default packaging (branded = the merchant''s own stock at the warehouse), inserts, packing slip, extras, default + fallback shipping method. Written only by ds_packing_save().';
create index if not exists dropship_packing_settings_branded_idx on public.dropship_packing_settings (branded_sku_id);
create index if not exists dropship_packing_settings_card_idx on public.dropship_packing_settings (insert_card_sku_id);
create index if not exists dropship_packing_settings_sticker_idx on public.dropship_packing_settings (sticker_sku_id);

create table if not exists public.dropship_duty_modes (
  org_id uuid not null references public.organizations(id) on delete cascade,
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  mode text not null check (mode in ('DDP', 'DAP')),
  saved_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (org_id, country)
);
comment on table public.dropship_duty_modes is 'Dropship Step 6b: who pays duties per destination (DDP / DAP). Set ONLY on Packing and shipping. No row = DDP (the US always defaults to DDP: no de minimis).';

create table if not exists public.dropship_rate_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_connection_id uuid not null references public.store_connections(id) on delete cascade,
  rate_name text not null check (length(btrim(rate_name)) between 1 and 255),
  countries text[] not null default '{}',
  method text check (method is null or method in ('economy', 'standard', 'express')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_connection_id, rate_name)
);
comment on table public.dropship_rate_mappings is 'Dropship Step 6b: store delivery-profile rate names (read with read_shipping by Step 5) mapped to economy / standard / express. method null = not mapped yet (the fallback applies).';
create index if not exists dropship_rate_mappings_org_idx on public.dropship_rate_mappings (org_id);

-- ───────────────────────── RLS + grants (merchants read their own org; nobody but the service role writes) ─────────────────────────
alter table public.store_connections enable row level security;
alter table public.dropship_fx_rates enable row level security;
alter table public.dropship_pricing_rules enable row level security;
alter table public.dropship_listings enable row level security;
alter table public.dropship_listing_variants enable row level security;
alter table public.dropship_push_batches enable row level security;
alter table public.dropship_push_jobs enable row level security;
alter table public.dropship_product_links enable row level security;
alter table public.dropship_variant_links enable row level security;
alter table public.dropship_price_approvals enable row level security;
alter table public.dropship_sync_log enable row level security;
alter table public.dropship_packing_settings enable row level security;
alter table public.dropship_duty_modes enable row level security;
alter table public.dropship_rate_mappings enable row level security;

drop policy if exists ds6_own_read on public.store_connections;
create policy ds6_own_read on public.store_connections for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_staff_read on public.dropship_fx_rates;
create policy ds6_staff_read on public.dropship_fx_rates for select to authenticated using (is_staff());
drop policy if exists ds6_own_read on public.dropship_pricing_rules;
create policy ds6_own_read on public.dropship_pricing_rules for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_listings;
create policy ds6_own_read on public.dropship_listings for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_listing_variants;
create policy ds6_own_read on public.dropship_listing_variants for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_push_batches;
create policy ds6_own_read on public.dropship_push_batches for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_push_jobs;
create policy ds6_own_read on public.dropship_push_jobs for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_product_links;
create policy ds6_own_read on public.dropship_product_links for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_variant_links;
create policy ds6_own_read on public.dropship_variant_links for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_price_approvals;
create policy ds6_own_read on public.dropship_price_approvals for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_sync_log;
create policy ds6_own_read on public.dropship_sync_log for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_packing_settings;
create policy ds6_own_read on public.dropship_packing_settings for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_duty_modes;
create policy ds6_own_read on public.dropship_duty_modes for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds6_own_read on public.dropship_rate_mappings;
create policy ds6_own_read on public.dropship_rate_mappings for select to authenticated using (org_id in (select my_org_ids()));

revoke all on public.store_connections, public.dropship_fx_rates, public.dropship_pricing_rules, public.dropship_listings,
  public.dropship_listing_variants, public.dropship_push_batches, public.dropship_push_jobs, public.dropship_product_links,
  public.dropship_variant_links, public.dropship_price_approvals, public.dropship_sync_log, public.dropship_packing_settings,
  public.dropship_duty_modes, public.dropship_rate_mappings from public, anon, authenticated, service_role;
grant select on public.store_connections, public.dropship_fx_rates, public.dropship_pricing_rules, public.dropship_listings,
  public.dropship_listing_variants, public.dropship_push_batches, public.dropship_push_jobs, public.dropship_product_links,
  public.dropship_variant_links, public.dropship_price_approvals, public.dropship_sync_log, public.dropship_packing_settings,
  public.dropship_duty_modes, public.dropship_rate_mappings to authenticated;
grant all on public.store_connections, public.dropship_fx_rates, public.dropship_pricing_rules, public.dropship_listings,
  public.dropship_listing_variants, public.dropship_push_batches, public.dropship_push_jobs, public.dropship_product_links,
  public.dropship_variant_links, public.dropship_price_approvals, public.dropship_sync_log, public.dropship_packing_settings,
  public.dropship_duty_modes, public.dropship_rate_mappings to service_role;

-- ───────────────────────── 9a. Pure pricing helpers (mirrored by lib/dropship-pricing.ts) ─────────────────────────
-- Store currencies a merchant can price in (Dropship launch markets) and their minor-unit exponent.
create or replace function public.ds_supported_currencies()
returns text[] language sql immutable set search_path = public as $$
  select array['USD', 'AED', 'SAR', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'KWD', 'QAR', 'BHD', 'OMR']::text[]
$$;

create or replace function public.ds_currency_exponent(p_currency text)
returns integer language sql immutable set search_path = public as $$
  select case upper(coalesce(p_currency, 'USD'))
    when 'KWD' then 3 when 'BHD' then 3 when 'OMR' then 3 when 'JOD' then 3 when 'TND' then 3
    when 'JPY' then 0 when 'KRW' then 0 when 'VND' then 0
    else 2 end
$$;

-- Round UP (never below the raw price, so rounding never lowers the margin). p_raw is in store minor units.
create or replace function public.ds_round_price(p_raw numeric, p_mode text, p_exp integer)
returns bigint language plpgsql immutable set search_path = public as $$
declare
  v_unit numeric := power(10::numeric, p_exp);
  v_step numeric := case when p_exp >= 2 then power(10::numeric, p_exp - 2) else null end;
  v_out numeric;
begin
  if p_raw is null then return null; end if;
  if p_mode = 'none' then
    v_out := ceil(p_raw);
  elsif p_mode = 'whole' or v_step is null then
    v_out := ceil(p_raw / v_unit) * v_unit;
  elsif p_mode = 'end_95' then
    v_out := ceil((p_raw + 5 * v_step) / v_unit) * v_unit - 5 * v_step;
  else -- end_99
    v_out := ceil((p_raw + v_step) / v_unit) * v_unit - v_step;
  end if;
  return greatest(1, v_out)::bigint;
end $$;

-- Band list check: from 0, contiguous, last band open-ended, multiplier 1.000–20.000 (in thousandths), fixed 0–US$1,000.
-- Returns null when valid, else a sentence that names the band and how to fix it.
create or replace function public.ds_bands_problem(p_bands jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_n integer;
  v_prev_to bigint := 0;
  b jsonb;
  i integer := 0;
  v_from bigint; v_to bigint; v_mult integer; v_fixed bigint;
begin
  if p_bands is null or jsonb_typeof(p_bands) <> 'array' then return 'Add at least one cost band.'; end if;
  v_n := jsonb_array_length(p_bands);
  if v_n = 0 then return 'Add at least one cost band.'; end if;
  if v_n > 10 then return 'Use 10 cost bands or fewer.'; end if;
  for b in select value from jsonb_array_elements(p_bands) loop
    i := i + 1;
    if jsonb_typeof(b -> 'from_cents') <> 'number' or jsonb_typeof(b -> 'multiplier_milli') <> 'number'
       or jsonb_typeof(coalesce(b -> 'fixed_cents', '0'::jsonb)) <> 'number'
       or (b ? 'to_cents' and jsonb_typeof(b -> 'to_cents') not in ('number', 'null')) then
      return format('Band %s: enter amounts as numbers.', i);
    end if;
    v_from := (b ->> 'from_cents')::numeric::bigint;
    v_to := case when jsonb_typeof(b -> 'to_cents') = 'number' then (b ->> 'to_cents')::numeric::bigint end;
    v_mult := (b ->> 'multiplier_milli')::numeric::integer;
    v_fixed := coalesce((b ->> 'fixed_cents')::numeric::bigint, 0);
    if v_from <> v_prev_to then
      return case when i = 1 then 'Band 1 must start at $0.00.' else format('Band %s must start where band %s ends.', i, i - 1) end;
    end if;
    if i < v_n and (v_to is null or v_to <= v_from) then return format('Band %s: "To" must be more than "From".', i); end if;
    if i = v_n and v_to is not null then return format('Band %s (the last band) must go "and up".', i); end if;
    if v_mult < 1000 or v_mult > 20000 then return format('Band %s: the multiplier must be between 1.0 and 20.0.', i); end if;
    if v_fixed < 0 or v_fixed > 100000 then return format('Band %s: the fixed amount must be between $0.00 and $1,000.00.', i); end if;
    v_prev_to := v_to;
  end loop;
  return null;
end $$;

-- First-push pricing: landed cost (USD cents) → band → × multiplier + fixed → × FX (store currency per USD) → rounding.
-- Compare-at = price + 25 % / 50 %, rounded the same way. profit_bp = (price − landed in store currency) / price, floored.
create or replace function public.ds_price_compute(
  p_landed_usd_cents bigint, p_bands jsonb, p_rounding text, p_compare_at_bp integer, p_min_profit_bp integer,
  p_fx numeric, p_currency text
) returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_exp integer := ds_currency_exponent(p_currency);
  v_scale numeric := power(10::numeric, v_exp - 2);
  v_fx numeric := case when upper(coalesce(p_currency, 'USD')) = 'USD' then 1 else p_fx end;
  b jsonb;
  i integer := 0;
  v_band integer;
  v_mult integer;
  v_fixed bigint;
  v_raw numeric;
  v_price bigint;
  v_cmp bigint;
  v_cost bigint;
  v_profit integer;
begin
  if p_landed_usd_cents is null or p_landed_usd_cents <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_LANDED', 'message', 'The landed cost is not known yet.');
  end if;
  if v_fx is null or v_fx <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NEEDS_FX', 'message', format('No exchange rate for %s yet.', upper(p_currency)));
  end if;
  if ds_bands_problem(p_bands) is not null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_BANDS', 'message', ds_bands_problem(p_bands));
  end if;
  for b in select value from jsonb_array_elements(p_bands) loop
    i := i + 1;
    if p_landed_usd_cents >= (b ->> 'from_cents')::numeric
       and (jsonb_typeof(b -> 'to_cents') is distinct from 'number' or p_landed_usd_cents < (b ->> 'to_cents')::numeric) then
      v_band := i;
      v_mult := (b ->> 'multiplier_milli')::numeric::integer;
      v_fixed := coalesce((b ->> 'fixed_cents')::numeric::bigint, 0);
      exit;
    end if;
  end loop;
  v_raw := (p_landed_usd_cents::numeric * v_mult + v_fixed * 1000) * v_fx * v_scale / 1000;
  v_price := ds_round_price(v_raw, p_rounding, v_exp);
  v_cmp := case when p_compare_at_bp is null then null
                else ds_round_price(v_price::numeric * (10000 + p_compare_at_bp) / 10000, p_rounding, v_exp) end;
  v_cost := ceil(p_landed_usd_cents::numeric * v_fx * v_scale)::bigint;
  v_profit := floor((v_price - v_cost)::numeric * 10000 / v_price)::integer;
  return jsonb_build_object(
    'ok', true, 'band', v_band, 'multiplier_milli', v_mult, 'fixed_cents', v_fixed,
    'raw_minor', round(v_raw, 4), 'price_minor', v_price, 'compare_at_minor', v_cmp,
    'landed_minor', v_cost, 'profit_bp', v_profit,
    'below_min', v_profit < coalesce(p_min_profit_bp, 0),
    'currency', upper(coalesce(p_currency, 'USD')), 'fx_rate', v_fx);
end $$;

-- "US$ 12.99" / "AED 159.99" / "KWD 4.990" — the merchant-facing money format used in messages
create or replace function public.ds_fmt_money(p_minor bigint, p_currency text)
returns text language sql immutable set search_path = public as $$
  select case when p_minor is null then null else
    (case when upper(coalesce(p_currency, 'USD')) = 'USD' then 'US$' else upper(p_currency) end) || ' ' ||
    to_char(p_minor::numeric / power(10::numeric, ds_currency_exponent(p_currency)),
            case ds_currency_exponent(p_currency) when 0 then 'FM999,999,999,990' when 3 then 'FM999,999,990.000' else 'FM999,999,990.00' end) end
$$;

-- profit of a given (manual) price against the landed cost, same rule as ds_price_compute
create or replace function public.ds_profit_bp(p_price_minor bigint, p_landed_usd_cents bigint, p_fx numeric, p_currency text)
returns integer language sql immutable set search_path = public as $$
  select case when p_price_minor is null or p_price_minor <= 0 or p_landed_usd_cents is null then null
    else floor((p_price_minor - ceil(p_landed_usd_cents::numeric
                 * (case when upper(coalesce(p_currency, 'USD')) = 'USD' then 1 else p_fx end)
                 * power(10::numeric, ds_currency_exponent(p_currency) - 2)))::numeric * 10000 / p_price_minor)::integer end
$$;

-- Plain text (with "- " / "• " bullet lines and blank-line paragraphs) → safe HTML for the store (everything escaped).
create or replace function public.ds_text_to_html(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_line text;
  v_out text := '';
  v_para text := '';
  v_in_list boolean := false;
  v_esc text;
begin
  for v_line in select unnest(string_to_array(replace(coalesce(p_text, ''), E'\r', ''), E'\n')) loop
    v_esc := replace(replace(replace(replace(btrim(v_line), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
    if v_esc ~ '^(-|•|\*)\s+' then
      if v_para <> '' then v_out := v_out || '<p>' || v_para || '</p>'; v_para := ''; end if;
      if not v_in_list then v_out := v_out || '<ul>'; v_in_list := true; end if;
      v_out := v_out || '<li>' || regexp_replace(v_esc, '^(-|•|\*)\s+', '') || '</li>';
    elsif v_esc = '' then
      if v_in_list then v_out := v_out || '</ul>'; v_in_list := false; end if;
      if v_para <> '' then v_out := v_out || '<p>' || v_para || '</p>'; v_para := ''; end if;
    else
      if v_in_list then v_out := v_out || '</ul>'; v_in_list := false; end if;
      v_para := case when v_para = '' then v_esc else v_para || '<br>' || v_esc end;
    end if;
  end loop;
  if v_in_list then v_out := v_out || '</ul>'; end if;
  if v_para <> '' then v_out := v_out || '<p>' || v_para || '</p>'; end if;
  return v_out;
end $$;

-- ───────────────────────── 9b. Internal helpers (not callable by customers) ─────────────────────────
-- the merchant org for reads: on, paused or closed (history stays readable)
create or replace function public.ds_org_read()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := dropship_merchant_any_org();
begin
  if v_org is null then raise exception 'DROPSHIP_NOT_ENABLED'; end if;
  return v_org;
end $$;

create or replace function public.ds_feature_guard(p_key text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not dropship_feature_on(p_key) then
    raise exception 'FEATURE_OFF: This part of Octopus Dropship is not switched on yet.';
  end if;
end $$;

create or replace function public.ds_product_visible(p_product public.dropship_products, p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_product.id is not null and p_product.status = 'active'
     and (p_product.visible_to_org_id is null or p_product.visible_to_org_id = p_org)
     and dropship_product_supplier_eligible(p_product)
$$;

create or replace function public.ds_variant_stock_label(p_variant_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.fulfilment_type = 'extended_catalog' and not coalesce((st ->> 'stock_tracked')::boolean, false) then 'extended'
    else coalesce(st ->> 'stock_status', 'in_stock') end
    from public.dropship_variants v
    join public.dropship_products p on p.id = v.product_id
    cross join lateral (select public.get_dropship_variant_stock(v.id) as st) s
   where v.id = p_variant_id
$$;

create or replace function public.ds_rules_for(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.dropship_pricing_rules;
  v_markup numeric;
  v_min integer;
begin
  select * into r from public.dropship_pricing_rules where org_id = p_org;
  if r.org_id is not null then
    return jsonb_build_object('saved', true, 'bands', r.bands, 'rounding', r.rounding, 'compare_at_bp', r.compare_at_bp,
      'min_profit_bp', r.min_profit_bp, 'store_currency', r.store_currency, 'fx_threshold_bp', r.fx_threshold_bp,
      'main_market', r.main_market, 'when_landed_up', r.when_landed_up, 'when_landed_down', r.when_landed_down,
      'when_out_of_stock', r.when_out_of_stock, 'check_every_hours', r.check_every_hours, 'alert_low_stock', r.alert_low_stock,
      'email_alerts', r.email_alerts, 'saved_at', r.saved_at);
  end if;
  -- not saved yet: start from the platform's suggested markup and minimum (Admin settings), never sample numbers
  select nullif(value #>> '{}', '')::numeric into v_markup from public.site_settings where key = 'dropship.markup';
  select nullif(value #>> '{}', '')::numeric::integer into v_min from public.site_settings where key = 'dropship.min_margin_bp';
  return jsonb_build_object('saved', false,
    'bands', case when v_markup is not null and v_markup >= 1 and v_markup <= 20
                  then jsonb_build_array(jsonb_build_object('from_cents', 0, 'to_cents', null, 'multiplier_milli', round(v_markup * 1000)::integer, 'fixed_cents', 0))
                  else '[]'::jsonb end,
    'rounding', 'end_99', 'compare_at_bp', null, 'min_profit_bp', coalesce(v_min, 0), 'store_currency', 'USD',
    'fx_threshold_bp', null, 'main_market', null, 'when_landed_up', 'reprice', 'when_landed_down', 'keep',
    'when_out_of_stock', 'draft', 'check_every_hours', 1, 'alert_low_stock', true, 'email_alerts', true, 'saved_at', null);
end $$;

-- the market "your cost" is landed to: the saved main market if it is still a selling country, else the platform default
-- country, the company's country, or the first selling country
create or replace function public.ds_main_market(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.main_market::text from public.dropship_pricing_rules r join public.dropship_markets m on m.org_id = r.org_id and m.country = r.main_market where r.org_id = p_org),
    (select m.country::text from public.dropship_markets m where m.org_id = p_org
        and m.country = (select value #>> '{}' from public.site_settings where key = 'dropship.default_country')),
    (select m.country::text from public.dropship_markets m join public.organizations o on o.id = m.org_id and o.country = m.country where m.org_id = p_org),
    (select min(m.country)::text from public.dropship_markets m where m.org_id = p_org))
$$;

create or replace function public.ds_default_method(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select default_method from public.dropship_packing_settings where org_id = p_org), 'standard')
$$;

-- DDP / DAP for a destination. No saved row = DDP (US: always DDP by default — no de minimis).
create or replace function public.ds_duty_mode(p_org uuid, p_country text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select mode from public.dropship_duty_modes where org_id = p_org and country = upper(p_country)), 'DDP')
$$;

create or replace function public.ds_active_connection(p_org uuid)
returns public.store_connections language sql stable security definer set search_path = public as $$
  select * from public.store_connections where org_id = p_org and status = 'active' order by connected_at desc nulls last, created_at desc limit 1
$$;

create or replace function public.ds_fx_for(p_currency text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when upper(coalesce(p_currency, 'USD')) = 'USD'
    then jsonb_build_object('currency', 'USD', 'rate', 1, 'source_name', null, 'effective_from', null)
    else (select jsonb_build_object('currency', f.currency, 'rate', f.rate_per_usd, 'source_name', f.source_name, 'effective_from', f.effective_from)
            from public.dropship_fx_rates f where f.currency = upper(p_currency) and f.effective_from <= now()
           order by f.effective_from desc, f.created_at desc limit 1) end
$$;

-- packaging upgrade added to the landed cost (only known fees; unknown fees cannot be chosen — see ds_packing_save)
create or replace function public.ds_packaging_extra_cents(p_org uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select case when s.default_packaging = 'branded' then (select f.branded_packaging_cents from public.fee_versions f where f.status = 'active' limit 1)
              else 0 end
    from (select coalesce((select default_packaging from public.dropship_packing_settings where org_id = p_org), 'standard') as default_packaging) s
$$;

-- White-label text check. p_fields = {"title": "...", "tags": "a, b", "sku:<variant>": "..."}. Returns
-- [{field, kind}] with kind octopus_word | supplier | model_no. The matched term itself is NEVER returned.
create or replace function public.ds_text_problems(p_product_id uuid, p_fields jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb := '[]'::jsonb;
  f record;
  v_txt text;
  v_kind text;
begin
  for f in select key, value from jsonb_each_text(coalesce(p_fields, '{}'::jsonb)) loop
    v_txt := lower(coalesce(f.value, ''));
    if btrim(v_txt) = '' then continue; end if;
    v_kind := null;
    if v_txt ~ 'octopus|shenzhen' then
      v_kind := 'octopus_word';
    elsif v_txt ~ 'cn-[a-z]{2}-[a-z0-9]{2,}-' or exists (
      select 1 from (
        select btrim(x) t from public.dropship_products p, unnest(array[p.supplier_sku, p.octopus_sku, p.legacy_sku]) x where p.id = p_product_id
        union all
        select btrim(x) from public.dropship_variants v, unnest(array[v.octopus_sku, v.legacy_sku]) x where v.product_id = p_product_id
        union all
        select btrim(sp.supplier_model) from public.dropship_variants v join public.supplier_products sp on sp.id = v.supplier_product_id where v.product_id = p_product_id
        union all
        select btrim(x) from public.dropship_variants v join public.products pr on pr.item_id = v.item_id, unnest(array[pr.sku, pr.factory_model]) x where v.product_id = p_product_id
      ) m where length(coalesce(m.t, '')) >= 3 and position(lower(m.t) in v_txt) > 0) then
      v_kind := 'model_no';
    elsif exists (
      select 1 from (
        select btrim(s.code) term from public.suppliers s
        union all select btrim(s.legal_name) from public.suppliers s
        union all select btrim(s.manufacturer_code) from public.suppliers s
        union all select btrim(regexp_replace(s.handle, '^@+', '')) from public.suppliers s
        union all select btrim(s.external_id) from public.suppliers s
        union all select btrim(v.variant_name) from public.supplier_name_variants v
        union all select btrim(regexp_replace(
                   regexp_replace(s.legal_name, '^(Shenzhen|Shenzeh|Xiamen|Guangzhou|Yiwu|Ningbo|Foshan|Dongguan|Huizhou)\s+', '', 'i'),
                   '\s+(Technology|Techonolgy|Electronics|Lighting|Industrial|Trading|Manufacturing|Industry|Co\.?,?\s*Ltd\.?|Limited|Inc\.?|Corp\.?)(\s+|$).*$',
                   '', 'i')) from public.suppliers s
      ) t where length(coalesce(t.term, '')) >= 3 and position(lower(t.term) in v_txt) > 0) then
      v_kind := 'supplier';
    end if;
    if v_kind is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('field', f.key, 'kind', v_kind));
    end if;
  end loop;
  return v_out;
end $$;

-- Landed cost of ONE unit of a variant to a market (quote engine get_dropship_order_quote, catalogue mode, the merchant's
-- duty mode) + the packaging upgrade. Unknown duties (DDP) = not known, never 0.
create or replace function public.ds_variant_landed(p_variant_id uuid, p_country text, p_method text, p_mode text, p_extra_cents bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q jsonb;
  v_code text;
begin
  if p_country is null then
    return jsonb_build_object('ok', false, 'code', 'NO_MARKET', 'message', 'Choose your selling countries first.');
  end if;
  begin
    v_q := public.get_dropship_order_quote(jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'qty', 1)),
                                           p_country, p_method, p_mode, 'USD', null, 'catalogue');
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'NOT_AVAILABLE', 'message', 'Prices are not available for your account right now.');
  end;
  if not coalesce((v_q ->> 'ok')::boolean, false) then
    v_code := coalesce(v_q ->> 'code', 'NO_QUOTE');
    return jsonb_build_object('ok', false, 'code', v_code, 'message', case v_code
      when 'NO_RATE_SET' then 'No shipping rate to this country with this method yet.'
      when 'NO_FEE_VERSION' then 'Processing fees are not set yet.'
      when 'WEIGHT_SIZE_MISSING' then 'Octopus is still measuring this product.'
      when 'RESTRICTED_ITEM' then 'This shipping method can''t carry this product.'
      when 'MARKET_NOT_ENABLED' then 'This country is not one of your selling countries.'
      when 'PRODUCT_NOT_AVAILABLE' then 'This product is not available right now.'
      else 'No price for this country yet.' end);
  end if;
  if v_q -> 'total_cents' is null or jsonb_typeof(v_q -> 'total_cents') = 'null' then
    return jsonb_build_object('ok', false, 'code', 'DUTY_UNKNOWN',
      'message', 'Duties to this country are not known yet. Choose "Buyer pays (DAP)" in Packing and shipping, or wait for Octopus to confirm them.');
  end if;
  return jsonb_build_object('ok', true,
    'landed_usd_cents', (v_q ->> 'total_cents')::bigint + coalesce(p_extra_cents, 0),
    'product_cents', (v_q ->> 'product_cents')::bigint, 'processing_cents', (v_q ->> 'processing_cents')::bigint,
    'shipping_cents', (v_q ->> 'shipping_cents')::bigint, 'duties_cents', (v_q ->> 'duties_cents')::bigint,
    'packaging_cents', coalesce(p_extra_cents, 0), 'incoterm', v_q ->> 'incoterm', 'country', v_q ->> 'country',
    'method', v_q ->> 'shipping_method', 'billed_weight_g', (v_q ->> 'billed_weight_g')::integer);
end $$;

-- Everything one product needs for the editor, the import list row and the push: product (merchant-safe fields only),
-- the merchant copy (or defaults), per-variant landed cost + price + profit, the store, and problems. null = not available
-- to this merchant (not visible, or neither in the import list nor pushed).
create or replace function public.ds_listing_state(p_org uuid, p_product_id uuid, p_with_quotes boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_prod public.dropship_products;
  v_lst public.dropship_listings;
  v_link public.dropship_product_links;
  v_conn public.store_connections;
  v_rules jsonb := ds_rules_for(p_org);
  v_country text := ds_main_market(p_org);
  v_method text := ds_default_method(p_org);
  v_mode text;
  v_cur text;
  v_fx jsonb;
  v_fx_rate numeric;
  v_extra bigint := ds_packaging_extra_cents(p_org);
  v_in_list boolean;
  v_brand text;
  v_vars jsonb := '[]'::jsonb;
  v_problems jsonb := '[]'::jsonb;
  v_texts jsonb;
  v_text_hits jsonb;
  v_min integer := coalesce((v_rules ->> 'min_profit_bp')::integer, 0);
  v record;
  v_lv public.dropship_listing_variants;
  v_stock text;
  v_include boolean;
  v_land jsonb;
  v_rule jsonb;
  v_manual boolean;
  v_price bigint;
  v_cmp bigint;
  v_profit integer;
  v_included integer := 0;
  v_priced integer := 0;
  v_below integer := 0;
  v_min_profit integer;
  v_first_code text;
  v_first_msg text;
  v_images text[];
begin
  select * into v_prod from public.dropship_products where id = p_product_id;
  if v_prod.id is null or not ds_product_visible(v_prod, p_org) then return null; end if;
  v_in_list := exists (select 1 from public.dropship_import_list where org_id = p_org and product_id = p_product_id);
  select * into v_link from public.dropship_product_links where org_id = p_org and product_id = p_product_id and status = 'linked'
   order by updated_at desc limit 1;
  if not v_in_list and v_link.id is null then return null; end if;
  select * into v_lst from public.dropship_listings where org_id = p_org and product_id = p_product_id;
  v_conn := ds_active_connection(p_org);
  v_cur := upper(coalesce(v_conn.shop_currency, v_rules ->> 'store_currency', 'USD'));
  v_fx := ds_fx_for(v_cur);
  v_fx_rate := (v_fx ->> 'rate')::numeric;
  v_mode := ds_duty_mode(p_org, coalesce(v_country, 'US'));
  select brand_name into v_brand from public.dropship_seller_profiles where org_id = p_org;
  v_images := coalesce(v_lst.image_urls, v_prod.images, '{}');
  -- only images that are still on the Octopus product (staff may remove a flagged image)
  v_images := array(select u from unnest(v_images) with ordinality x(u, n) where u = any(v_prod.images) and not (u = any(coalesce(v_prod.flagged_images, '{}'))) order by n);

  for v in select dv.id, dv.model_no, dv.options from public.dropship_variants dv where dv.product_id = p_product_id order by dv.sort, dv.model_no loop
    v_lv := null;
    if v_lst.id is not null then
      select * into v_lv from public.dropship_listing_variants where listing_id = v_lst.id and variant_id = v.id;
    end if;
    v_stock := ds_variant_stock_label(v.id);
    v_include := coalesce(v_lv.include, true) and v_stock <> 'out';
    v_land := case when p_with_quotes then ds_variant_landed(v.id, v_country, v_method, v_mode, v_extra) else null end;
    v_rule := null; v_price := null; v_cmp := null; v_profit := null;
    v_manual := v_lst.price_mode = 'manual' and v_lv.price_minor is not null;
    if coalesce((v_land ->> 'ok')::boolean, false) then
      -- the rule also prices products before it is saved (preview); RULES_NOT_SAVED below still blocks the push
      if v_fx_rate is not null and jsonb_array_length(coalesce(v_rules -> 'bands', '[]'::jsonb)) > 0 then
        v_rule := ds_price_compute((v_land ->> 'landed_usd_cents')::bigint, v_rules -> 'bands', v_rules ->> 'rounding',
                    (v_rules ->> 'compare_at_bp')::integer, v_min, v_fx_rate, v_cur);
      end if;
      if v_manual then
        v_price := v_lv.price_minor;
        v_cmp := v_lv.compare_at_minor;
      elsif coalesce((v_rule ->> 'ok')::boolean, false) then
        v_price := (v_rule ->> 'price_minor')::bigint;
        v_cmp := (v_rule ->> 'compare_at_minor')::bigint;
      end if;
      if v_price is not null and v_fx_rate is not null then
        v_profit := ds_profit_bp(v_price, (v_land ->> 'landed_usd_cents')::bigint, v_fx_rate, v_cur);
      end if;
    end if;
    if v_include then
      v_included := v_included + 1;
      if v_price is not null then v_priced := v_priced + 1; end if;
      if v_profit is not null and v_profit < v_min then v_below := v_below + 1; end if;
      if v_profit is not null then v_min_profit := least(coalesce(v_min_profit, v_profit), v_profit); end if;
      if v_price is null and v_first_code is null then
        v_first_code := coalesce(v_land ->> 'code', v_rule ->> 'code', case when v_fx_rate is null then 'NEEDS_FX' else 'NO_RULE' end);
        v_first_msg := coalesce(v_land ->> 'message', v_rule ->> 'message',
          case when v_fx_rate is null then format('No exchange rate for %s yet.', v_cur) else 'Save your pricing rule or enter a price.' end);
      end if;
    end if;
    v_vars := v_vars || jsonb_build_array(jsonb_build_object(
      'variant_id', v.id, 'model_no', v.model_no, 'options', coalesce(v.options, '{}'::jsonb), 'stock_status', v_stock,
      'include', v_include, 'store_sku', coalesce(nullif(v_lv.store_sku, ''), v.model_no),
      'landed', v_land, 'landed_usd_cents', (v_land ->> 'landed_usd_cents')::bigint,
      'rule_price_minor', (v_rule ->> 'price_minor')::bigint, 'rule_compare_at_minor', (v_rule ->> 'compare_at_minor')::bigint,
      'rule_band', (v_rule ->> 'band')::integer,
      'manual', v_manual, 'manual_price_minor', v_lv.price_minor, 'manual_compare_at_minor', v_lv.compare_at_minor,
      'price_minor', v_price, 'compare_at_minor', v_cmp, 'profit_bp', v_profit,
      'below_min', coalesce(v_profit < v_min, false)));
  end loop;

  -- problems (blocking unless noted)
  if v_included = 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('code', 'OUT_OF_STOCK', 'blocking', true,
      'message', 'Out of stock at Octopus. It can be pushed when it is back in stock.'));
  end if;
  if v_included > 0 and v_priced < v_included then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('code', coalesce(v_first_code, 'NO_PRICE'), 'blocking', true, 'message', v_first_msg));
  end if;
  if not coalesce((v_rules ->> 'saved')::boolean, false) and not coalesce(v_lst.price_mode = 'manual', false) then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('code', 'RULES_NOT_SAVED', 'blocking', true,
      'message', 'Save your pricing rule in Pricing and sync first.'));
  end if;
  v_texts := jsonb_build_object('title', coalesce(v_lst.title, v_prod.title), 'description', coalesce(v_lst.description, v_prod.description, ''),
    'vendor', coalesce(v_lst.vendor, v_brand, ''), 'product_type', coalesce(v_lst.product_type, ''), 'collection', coalesce(v_lst.collection, ''),
    'tags', array_to_string(coalesce(v_lst.tags, '{}'), ', '), 'handle', coalesce(v_lst.handle, ''),
    'seo_title', coalesce(v_lst.seo_title, ''), 'seo_description', coalesce(v_lst.seo_description, ''));
  select v_texts || coalesce(jsonb_object_agg('sku:' || (x ->> 'variant_id'), x ->> 'store_sku'), '{}'::jsonb)
    into v_texts from jsonb_array_elements(v_vars) x where (x ->> 'include')::boolean;
  v_text_hits := ds_text_problems(p_product_id, v_texts);
  if jsonb_array_length(v_text_hits) > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('code', 'TEXT_CHECK', 'blocking', true, 'fields', v_text_hits,
      'message', 'Some text mentions a supplier or factory name, a model number or the word Octopus. Remove it before pushing.'));
  end if;
  if v_below > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('code', 'BELOW_MIN', 'blocking', false,
      'message', format('%s of %s variants are below your %s%% minimum profit.', v_below, v_included, round(v_min / 100.0, 1))));
  end if;

  return jsonb_build_object(
    'product_id', v_prod.id, 'model_no', v_prod.model_no, 'octopus_title', v_prod.title,
    'octopus_description', coalesce(v_prod.description, ''), 'category', v_prod.category,
    'octopus_images', to_jsonb(array(select u from unnest(v_prod.images) u where not (u = any(coalesce(v_prod.flagged_images, '{}'))))),
    'only_for_you', coalesce(v_prod.visible_to_org_id = p_org, false), 'in_import_list', v_in_list,
    'listing_saved', v_lst.id is not null, 'listing_id', v_lst.id, 'saved_at', v_lst.saved_at,
    'title', coalesce(v_lst.title, v_prod.title), 'description', coalesce(v_lst.description, v_prod.description, ''),
    'image_urls', to_jsonb(v_images), 'vendor', coalesce(v_lst.vendor, v_brand), 'product_type', coalesce(v_lst.product_type, v_prod.category),
    'collection', v_lst.collection, 'tags', to_jsonb(coalesce(v_lst.tags, '{}')), 'handle', v_lst.handle,
    'seo_title', v_lst.seo_title, 'seo_description', v_lst.seo_description,
    'publish_as', coalesce(v_lst.publish_as, 'draft'), 'sync_stock', coalesce(v_lst.sync_stock, true),
    'sync_price', coalesce(v_lst.sync_price, true), 'price_mode', coalesce(v_lst.price_mode, 'rule'),
    'variants', v_vars, 'variants_total', jsonb_array_length(v_vars), 'variants_included', v_included,
    'currency', v_cur, 'currency_exponent', ds_currency_exponent(v_cur), 'fx', v_fx,
    'market', v_country, 'method', v_method, 'duty_mode', v_mode, 'packaging_extra_cents', v_extra,
    'rules', v_rules, 'min_profit_bp', v_min, 'lowest_profit_bp', v_min_profit,
    'store', case when v_conn.id is null then null else jsonb_build_object('id', v_conn.id, 'shop_domain', v_conn.shop_domain, 'currency', v_conn.shop_currency) end,
    'link', case when v_link.id is null then null else jsonb_build_object('id', v_link.id, 'store_status', v_link.store_status, 'sync_state', v_link.sync_state, 'last_pushed_at', v_link.last_pushed_at) end,
    'problems', v_problems,
    'ready', not exists (select 1 from jsonb_array_elements(v_problems) p where (p ->> 'blocking')::boolean));
end $$;

-- ───────────────────────── 9c. Import list RPCs ─────────────────────────
create or replace function public.ds_import_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  v_rows jsonb := '[]'::jsonb;
  r record;
  st jsonb;
  v_pushed integer;
  v_failed integer;
begin
  perform ds_feature_guard('import_list');
  for r in
    select il.product_id, max(il.created_at) added_at from public.dropship_import_list il
     where il.org_id = v_org group by il.product_id order by max(il.created_at) desc limit 200
  loop
    st := ds_listing_state(v_org, r.product_id, true);
    if st is null then continue; end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'product_id', st -> 'product_id', 'model_no', st -> 'model_no', 'title', st -> 'title', 'image', st -> 'image_urls' -> 0,
      'only_for_you', st -> 'only_for_you', 'variants_total', st -> 'variants_total', 'variants_included', st -> 'variants_included',
      'landed_min', (select min((x ->> 'landed_usd_cents')::bigint) from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean),
      'price_min', (select min((x ->> 'price_minor')::bigint) from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean),
      'price_max', (select max((x ->> 'price_minor')::bigint) from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean),
      'lowest_profit_bp', st -> 'lowest_profit_bp', 'problems', st -> 'problems', 'ready', st -> 'ready',
      'listing_saved', st -> 'listing_saved', 'price_mode', st -> 'price_mode', 'linked', st -> 'link' is not null and jsonb_typeof(st -> 'link') <> 'null',
      'example', (select x from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean and x -> 'price_minor' is not null and jsonb_typeof(x -> 'price_minor') <> 'null' limit 1),
      'added_at', r.added_at));
  end loop;
  select count(*) filter (where status = 'linked') into v_pushed from public.dropship_product_links where org_id = v_org;
  select count(distinct product_id) into v_failed from public.dropship_push_jobs j where j.org_id = v_org and j.status = 'failed'
     and not exists (select 1 from public.dropship_push_jobs k where k.org_id = j.org_id and k.product_id = j.product_id and k.created_at > j.created_at and k.status in ('queued', 'running', 'retry_wait', 'done'));
  return jsonb_build_object('rows', v_rows, 'counts', jsonb_build_object('import', jsonb_array_length(v_rows), 'pushed', v_pushed, 'failed', v_failed),
    'rules', ds_rules_for(v_org), 'market', ds_main_market(v_org), 'store', (select to_jsonb(x) from (select c.id, c.shop_domain, c.shop_currency from public.store_connections c where c.id = (ds_active_connection(v_org)).id) x));
end $$;

create or replace function public.ds_import_add(p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_pid uuid;
  v_prod public.dropship_products;
  v_added integer := 0;
  v_skipped integer := 0;
begin
  perform ds_feature_guard('import_list');
  if coalesce(array_length(p_product_ids, 1), 0) = 0 or array_length(p_product_ids, 1) > 200 then
    raise exception 'INVALID_INPUT: Choose between 1 and 200 products.';
  end if;
  foreach v_pid in array (select array_agg(distinct x) from unnest(p_product_ids) x) loop
    select * into v_prod from public.dropship_products where id = v_pid;
    if not coalesce(ds_product_visible(v_prod, v_org), false) then v_skipped := v_skipped + 1; continue; end if;
    if exists (select 1 from public.dropship_import_list where org_id = v_org and product_id = v_pid) then v_skipped := v_skipped + 1; continue; end if;
    insert into public.dropship_import_list (org_id, product_id, added_by) values (v_org, v_pid, auth.uid());
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then
    perform write_audit('ds_import.added', 'organizations', v_org::text, jsonb_build_object('added', v_added, 'skipped', v_skipped));
  end if;
  return jsonb_build_object('ok', true, 'added', v_added, 'skipped', v_skipped);
end $$;

-- removing is not new activity: a paused merchant may still tidy the list
create or replace function public.ds_import_remove(p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  v_n integer;
begin
  if coalesce(array_length(p_product_ids, 1), 0) = 0 or array_length(p_product_ids, 1) > 200 then
    raise exception 'INVALID_INPUT: Choose between 1 and 200 products.';
  end if;
  delete from public.dropship_import_list where org_id = v_org and product_id = any(p_product_ids);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform write_audit('ds_import.removed', 'organizations', v_org::text, jsonb_build_object('removed', v_n));
  end if;
  return jsonb_build_object('ok', true, 'removed', v_n);
end $$;

-- CSV bulk add: [{line, model_no, variant?}]; only DS model numbers this merchant may see. A product private to another
-- merchant answers exactly like one that does not exist (no existence leak).
create or replace function public.ds_import_bulk_add(p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  l jsonb;
  v_model text;
  v_var text;
  v_prod public.dropship_products;
  v_added integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  v_line integer;
begin
  perform ds_feature_guard('import_list');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INPUT: The file has no lines.';
  end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'INVALID_INPUT: Use 500 lines or fewer per file.'; end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    v_line := coalesce((l ->> 'line')::integer, 0);
    v_model := upper(btrim(coalesce(l ->> 'model_no', '')));
    v_var := upper(btrim(coalesce(l ->> 'variant', '')));
    if v_model !~ '^DS-\d{6}$' then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('line', v_line, 'model_no', left(v_model, 40), 'reason', 'Not a DS model number (DS-000000).'));
      continue;
    end if;
    select * into v_prod from public.dropship_products where model_no = v_model;
    if not coalesce(ds_product_visible(v_prod, v_org), false) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('line', v_line, 'model_no', v_model, 'reason', format('%s doesn''t exist or isn''t available to you.', v_model)));
      continue;
    end if;
    if v_var <> '' and not exists (select 1 from public.dropship_variants where product_id = v_prod.id and model_no = v_var) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('line', v_line, 'model_no', v_model, 'reason', format('Variant %s is not part of %s.', left(v_var, 40), v_model)));
      continue;
    end if;
    if v_prod.id = any(v_seen) or exists (select 1 from public.dropship_import_list where org_id = v_org and product_id = v_prod.id) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('line', v_line, 'model_no', v_model, 'reason', 'Already in your import list.'));
      continue;
    end if;
    insert into public.dropship_import_list (org_id, product_id, added_by) values (v_org, v_prod.id, auth.uid());
    v_seen := v_seen || v_prod.id;
    v_added := v_added + 1;
  end loop;
  perform write_audit('ds_import.bulk_added', 'organizations', v_org::text,
    jsonb_build_object('lines', jsonb_array_length(p_lines), 'added', v_added, 'skipped', jsonb_array_length(v_skipped)));
  return jsonb_build_object('ok', true, 'added', v_added, 'skipped', v_skipped, 'lines', jsonb_array_length(p_lines));
end $$;

-- "Apply rule to selected": drop manual prices so the pricing rule prices these products again
create or replace function public.ds_import_apply_rule(p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_n integer;
begin
  perform ds_feature_guard('import_list');
  update public.dropship_listings set price_mode = 'rule', saved_by = auth.uid(), saved_at = now()
   where org_id = v_org and product_id = any(coalesce(p_product_ids, '{}')) and price_mode = 'manual';
  get diagnostics v_n = row_count;
  update public.dropship_listing_variants lv set price_minor = null, compare_at_minor = null, saved_at = now()
    from public.dropship_listings l where l.id = lv.listing_id and l.org_id = v_org and l.product_id = any(coalesce(p_product_ids, '{}'));
  perform write_audit('ds_import.rule_applied', 'organizations', v_org::text, jsonb_build_object('products', coalesce(array_length(p_product_ids, 1), 0), 'had_manual', v_n));
  return jsonb_build_object('ok', true, 'updated', v_n);
end $$;

-- ───────────────────────── 9d. Product editor RPCs ─────────────────────────
create or replace function public.ds_listing_get(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := ds_org_read();
begin
  perform ds_feature_guard('import_list');
  return ds_listing_state(v_org, p_product_id, true);
end $$;

-- live "Checked" badge: field names only
create or replace function public.ds_text_check(p_product_id uuid, p_fields jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  v_prod public.dropship_products;
  v_hits jsonb;
begin
  perform ds_feature_guard('import_list');
  select * into v_prod from public.dropship_products where id = p_product_id;
  if not coalesce(ds_product_visible(v_prod, v_org), false) then raise exception 'NOT_FOUND: This product is not available.'; end if;
  if jsonb_typeof(coalesce(p_fields, 'null'::jsonb)) <> 'object' or (select count(*) from jsonb_object_keys(p_fields)) > 80 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hits := ds_text_problems(p_product_id, p_fields);
  return jsonb_build_object('ok', jsonb_array_length(v_hits) = 0, 'fields', v_hits);
end $$;

create or replace function public.ds_listing_save(p_product_id uuid, p_listing jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_prod public.dropship_products;
  v_lst public.dropship_listings;
  v_title text := btrim(coalesce(p_listing ->> 'title', ''));
  v_desc text := coalesce(p_listing ->> 'description', '');
  v_images text[];
  v_tags text[];
  v_vendor text := nullif(btrim(coalesce(p_listing ->> 'vendor', '')), '');
  v_type text := nullif(btrim(coalesce(p_listing ->> 'product_type', '')), '');
  v_coll text := nullif(btrim(coalesce(p_listing ->> 'collection', '')), '');
  v_handle text := nullif(lower(btrim(coalesce(p_listing ->> 'handle', ''))), '');
  v_seo_t text := nullif(btrim(coalesce(p_listing ->> 'seo_title', '')), '');
  v_seo_d text := nullif(btrim(coalesce(p_listing ->> 'seo_description', '')), '');
  v_pub text := coalesce(p_listing ->> 'publish_as', 'draft');
  v_mode text := coalesce(p_listing ->> 'price_mode', 'rule');
  v jsonb;
  v_fields jsonb;
  v_hits jsonb;
  v_sku text;
  v_price bigint;
  v_cmp bigint;
  v_cur text;
begin
  perform ds_feature_guard('import_list');
  select * into v_prod from public.dropship_products where id = p_product_id;
  if not coalesce(ds_product_visible(v_prod, v_org), false)
     or not (exists (select 1 from public.dropship_import_list where org_id = v_org and product_id = p_product_id)
             or exists (select 1 from public.dropship_product_links where org_id = v_org and product_id = p_product_id and status = 'linked')) then
    raise exception 'NOT_FOUND: Add this product to your import list first.';
  end if;
  if jsonb_typeof(coalesce(p_listing, 'null'::jsonb)) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  if length(v_title) < 1 or length(v_title) > 255 then raise exception 'INVALID_TITLE: Enter a title of 1 to 255 characters.'; end if;
  if length(v_desc) > 20000 then raise exception 'INVALID_DESCRIPTION: Keep the description under 20,000 characters.'; end if;
  if v_pub not in ('draft', 'active') or v_mode not in ('rule', 'manual') then raise exception 'INVALID_INPUT'; end if;
  if v_handle is not null and v_handle !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'INVALID_HANDLE: Use lowercase letters, numbers and single dashes in the URL handle.';
  end if;
  if length(coalesce(v_seo_t, '')) > 70 then raise exception 'INVALID_SEO_TITLE: Keep the meta title to 70 characters.'; end if;
  if length(coalesce(v_seo_d, '')) > 160 then raise exception 'INVALID_SEO_DESCRIPTION: Keep the meta description to 160 characters.'; end if;
  if length(coalesce(v_vendor, '')) > 120 or length(coalesce(v_type, '')) > 120 or length(coalesce(v_coll, '')) > 120 then
    raise exception 'INVALID_INPUT: Vendor, product type and collection are limited to 120 characters.';
  end if;
  -- images: only the Octopus product's own (unflagged) images, in the merchant's order, no repeats
  select coalesce(array_agg(u order by n), '{}') into v_images
    from (select distinct on (u) u, n from jsonb_array_elements_text(coalesce(p_listing -> 'image_urls', '[]'::jsonb)) with ordinality x(u, n) order by u, n) d;
  if exists (select 1 from unnest(v_images) u where not (u = any(v_prod.images)) or u = any(coalesce(v_prod.flagged_images, '{}'))) then
    raise exception 'INVALID_IMAGES: Choose images from this product only.';
  end if;
  if coalesce(array_length(v_images, 1), 0) = 0 and coalesce(array_length(v_prod.images, 1), 0) > 0 then
    raise exception 'INVALID_IMAGES: Choose at least one image.';
  end if;
  if array_length(v_images, 1) > 50 then raise exception 'INVALID_IMAGES: Choose 50 images or fewer.'; end if;
  select coalesce(array_agg(distinct t), '{}') into v_tags
    from (select left(btrim(t), 255) t from jsonb_array_elements_text(coalesce(p_listing -> 'tags', '[]'::jsonb)) t) x where t <> '';
  if array_length(v_tags, 1) > 100 then raise exception 'INVALID_TAGS: Use 100 tags or fewer.'; end if;

  -- variants: every variant must belong to this product
  if jsonb_typeof(coalesce(p_listing -> 'variants', '[]'::jsonb)) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_listing -> 'variants', '[]'::jsonb)) x
              where not exists (select 1 from public.dropship_variants dv where dv.product_id = p_product_id and dv.id::text = x ->> 'variant_id')) then
    raise exception 'INVALID_VARIANTS: A variant does not belong to this product.';
  end if;

  -- white-label check of everything that goes to the store (field names only in the error)
  v_fields := jsonb_build_object('title', v_title, 'description', v_desc, 'vendor', coalesce(v_vendor, ''), 'product_type', coalesce(v_type, ''),
    'collection', coalesce(v_coll, ''), 'tags', array_to_string(v_tags, ', '), 'handle', coalesce(v_handle, ''),
    'seo_title', coalesce(v_seo_t, ''), 'seo_description', coalesce(v_seo_d, ''));
  for v in select value from jsonb_array_elements(coalesce(p_listing -> 'variants', '[]'::jsonb)) loop
    v_sku := nullif(btrim(coalesce(v ->> 'store_sku', '')), '');
    if v_sku is not null then
      if v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' then
        raise exception 'INVALID_SKU: Store SKUs use letters, numbers, dots, dashes, slashes and underscores (up to 64).';
      end if;
      v_fields := v_fields || jsonb_build_object('sku:' || (v ->> 'variant_id'), v_sku);
    end if;
  end loop;
  v_hits := ds_text_problems(p_product_id, v_fields);
  if jsonb_array_length(v_hits) > 0 then
    -- answered (not raised) so the refusal stays in the audit log; nothing is saved
    perform write_audit('ds_listing.text_refused', 'dropship_products', p_product_id::text,
      jsonb_build_object('org_id', v_org, 'fields', (select jsonb_agg(h ->> 'field') from jsonb_array_elements(v_hits) h)));
    return jsonb_build_object('ok', false, 'code', 'TEXT_CHECK', 'fields', v_hits,
      'message', 'TEXT_CHECK: ' || (select string_agg(distinct case when h ->> 'field' like 'sku:%' then 'store SKU' else replace(h ->> 'field', '_', ' ') end, ', ')
                                     from jsonb_array_elements(v_hits) h));
  end if;

  insert into public.dropship_listings as l (org_id, product_id, title, description, image_urls, vendor, product_type, collection, tags, handle,
      seo_title, seo_description, publish_as, sync_stock, sync_price, price_mode, text_checked_at, saved_by, saved_at)
  values (v_org, p_product_id, v_title, v_desc, v_images, v_vendor, v_type, v_coll, v_tags, v_handle, v_seo_t, v_seo_d, v_pub,
      coalesce((p_listing ->> 'sync_stock')::boolean, true), coalesce((p_listing ->> 'sync_price')::boolean, true), v_mode, now(), auth.uid(), now())
  on conflict (org_id, product_id) do update set title = excluded.title, description = excluded.description, image_urls = excluded.image_urls,
      vendor = excluded.vendor, product_type = excluded.product_type, collection = excluded.collection, tags = excluded.tags,
      handle = excluded.handle, seo_title = excluded.seo_title, seo_description = excluded.seo_description, publish_as = excluded.publish_as,
      sync_stock = excluded.sync_stock, sync_price = excluded.sync_price, price_mode = excluded.price_mode,
      text_checked_at = now(), saved_by = auth.uid(), saved_at = now()
  returning * into v_lst;

  for v in select value from jsonb_array_elements(coalesce(p_listing -> 'variants', '[]'::jsonb)) loop
    v_price := case when jsonb_typeof(v -> 'price_minor') = 'number' then (v ->> 'price_minor')::numeric::bigint end;
    v_cmp := case when jsonb_typeof(v -> 'compare_at_minor') = 'number' then (v ->> 'compare_at_minor')::numeric::bigint end;
    if v_mode = 'manual' and coalesce((v ->> 'include')::boolean, true) and (v_price is null or v_price <= 0) then
      raise exception 'INVALID_PRICE: Enter a price for every variant you push, or use your pricing rule.';
    end if;
    if v_price is not null and (v_price <= 0 or v_price > 100000000) then raise exception 'INVALID_PRICE: Enter a price above zero.'; end if;
    if v_cmp is not null and (v_price is null or v_cmp <= v_price) then
      raise exception 'INVALID_COMPARE_AT: The compare-at price must be higher than the price.';
    end if;
    insert into public.dropship_listing_variants (listing_id, org_id, variant_id, include, store_sku, price_minor, compare_at_minor, saved_at)
    values (v_lst.id, v_org, (v ->> 'variant_id')::uuid, coalesce((v ->> 'include')::boolean, true),
            nullif(btrim(coalesce(v ->> 'store_sku', '')), ''), case when v_mode = 'manual' then v_price end,
            case when v_mode = 'manual' then v_cmp end, now())
    on conflict (listing_id, variant_id) do update set include = excluded.include, store_sku = excluded.store_sku,
        price_minor = excluded.price_minor, compare_at_minor = excluded.compare_at_minor, saved_at = now();
  end loop;

  perform write_audit('ds_listing.saved', 'dropship_listings', v_lst.id::text,
    jsonb_build_object('org_id', v_org, 'product_id', p_product_id, 'price_mode', v_mode, 'images', array_length(v_images, 1)));
  return jsonb_build_object('ok', true, 'listing_id', v_lst.id, 'state', ds_listing_state(v_org, p_product_id, true));
end $$;

-- ───────────────────────── 9e. Pricing and sync RPCs ─────────────────────────
create or replace function public.ds_pricing_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  v_rules jsonb;
  v_conn public.store_connections;
  v_cur text;
  v_market text := ds_main_market(v_org);
  v_sample record;
  v_landed jsonb;
begin
  perform ds_feature_guard('pricing');
  v_rules := ds_rules_for(v_org);
  v_conn := ds_active_connection(v_org);
  v_cur := upper(coalesce(v_conn.shop_currency, v_rules ->> 'store_currency', 'USD'));
  -- preview: the first variant on the import list (else any visible catalogue product with a route to the main market)
  select dv.id variant_id, p.title, dv.options into v_sample
    from public.dropship_import_list il join public.dropship_products p on p.id = il.product_id
    join public.dropship_variants dv on dv.product_id = p.id
   where il.org_id = v_org and ds_product_visible(p, v_org) and ds_variant_stock_label(dv.id) <> 'out'
   order by il.created_at desc, dv.sort, dv.model_no limit 1;
  if v_sample.variant_id is null and v_market is not null then
    select dv.id variant_id, p.title, dv.options into v_sample
      from public.dropship_products p join public.dropship_variants dv on dv.product_id = p.id
     where ds_product_visible(p, v_org)
       and exists (select 1 from public.dropship_routes r where r.product_id = p.id and r.destination_country = v_market and r.is_active)
     order by p.published_at desc nulls last, dv.sort limit 1;
  end if;
  if v_sample.variant_id is not null then
    v_landed := ds_variant_landed(v_sample.variant_id, v_market, ds_default_method(v_org), ds_duty_mode(v_org, coalesce(v_market, 'US')), ds_packaging_extra_cents(v_org));
  end if;
  return jsonb_build_object(
    'rules', v_rules, 'currency', v_cur, 'currency_exponent', ds_currency_exponent(v_cur),
    'currency_from_store', v_conn.shop_currency is not null, 'supported_currencies', to_jsonb(ds_supported_currencies()),
    'fx', ds_fx_for(v_cur),
    'fx_rates', (select coalesce(jsonb_object_agg(c, ds_fx_for(c)), '{}'::jsonb) from unnest(ds_supported_currencies()) c),
    'market', v_market, 'markets', (select coalesce(jsonb_agg(country order by country), '[]'::jsonb) from public.dropship_markets where org_id = v_org),
    'duty_mode', ds_duty_mode(v_org, coalesce(v_market, 'US')), 'method', ds_default_method(v_org),
    'sample', case when v_sample.variant_id is null then null
                   else jsonb_build_object('title', v_sample.title, 'options', v_sample.options, 'landed', v_landed) end,
    'store', case when v_conn.id is null then null else jsonb_build_object('shop_domain', v_conn.shop_domain, 'currency', v_conn.shop_currency) end,
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'product_id', a.product_id, 'title', coalesce(l.title, p.title),
                     'model_no', p.model_no, 'reason_code', a.reason_code, 'old_landed_usd_cents', a.old_landed_usd_cents,
                     'new_landed_usd_cents', a.new_landed_usd_cents, 'old_price_minor', a.old_price_minor, 'new_price_minor', a.new_price_minor,
                     'currency', a.currency, 'old_profit_bp', a.old_profit_bp, 'new_profit_bp', a.new_profit_bp, 'created_at', a.created_at)
                     order by a.created_at), '[]'::jsonb)
                    from public.dropship_price_approvals a join public.dropship_products p on p.id = a.product_id
                    left join public.dropship_listings l on l.org_id = a.org_id and l.product_id = a.product_id
                   where a.org_id = v_org and a.status = 'waiting'),
    'sync_log', (select coalesce(jsonb_agg(jsonb_build_object('created_at', s.created_at, 'product', coalesce(l.title, p.title, 'All products'),
                     'kind', s.kind, 'change', s.change_text, 'result', s.result_text) order by s.created_at desc), '[]'::jsonb)
                   from (select * from public.dropship_sync_log where org_id = v_org order by created_at desc limit 50) s
                   left join public.dropship_products p on p.id = s.product_id
                   left join public.dropship_listings l on l.org_id = s.org_id and l.product_id = s.product_id));
end $$;

create or replace function public.ds_pricing_save(p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_problem text;
  v_cur text := upper(btrim(coalesce(p_rules ->> 'store_currency', 'USD')));
  v_market text := nullif(upper(btrim(coalesce(p_rules ->> 'main_market', ''))), '');
  v_min integer;
  v_thr integer;
  v_cmp integer;
  v_bands jsonb;
begin
  perform ds_feature_guard('pricing');
  if jsonb_typeof(coalesce(p_rules, 'null'::jsonb)) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  v_problem := ds_bands_problem(p_rules -> 'bands');
  if v_problem is not null then raise exception 'INVALID_BANDS: %', v_problem; end if;
  -- keep only the known keys of each band, as integers
  select jsonb_agg(jsonb_build_object('from_cents', (b ->> 'from_cents')::numeric::bigint,
           'to_cents', case when jsonb_typeof(b -> 'to_cents') = 'number' then (b ->> 'to_cents')::numeric::bigint end,
           'multiplier_milli', (b ->> 'multiplier_milli')::numeric::integer, 'fixed_cents', coalesce((b ->> 'fixed_cents')::numeric::bigint, 0)) order by n)
    into v_bands from jsonb_array_elements(p_rules -> 'bands') with ordinality x(b, n);
  if coalesce(p_rules ->> 'rounding', '') not in ('end_99', 'end_95', 'whole', 'none') then raise exception 'INVALID_INPUT: Choose how to round prices.'; end if;
  v_cmp := case when jsonb_typeof(p_rules -> 'compare_at_bp') = 'number' then (p_rules ->> 'compare_at_bp')::numeric::integer end;
  if v_cmp is not null and v_cmp not in (2500, 5000) then raise exception 'INVALID_INPUT: Compare-at is price + 25%%, price + 50%% or not set.'; end if;
  if jsonb_typeof(p_rules -> 'min_profit_bp') <> 'number' then raise exception 'INVALID_MIN: Enter your minimum margin.'; end if;
  v_min := (p_rules ->> 'min_profit_bp')::numeric::integer;
  if v_min < 0 or v_min > 9000 then raise exception 'INVALID_MIN: The minimum margin must be between 0%% and 90%%.'; end if;
  if not (v_cur = any(ds_supported_currencies())) then raise exception 'INVALID_CURRENCY: Choose one of the listed store currencies.'; end if;
  v_thr := case when jsonb_typeof(p_rules -> 'fx_threshold_bp') = 'number' then (p_rules ->> 'fx_threshold_bp')::numeric::integer end;
  if v_thr is not null and (v_thr < 0 or v_thr > 5000) then raise exception 'INVALID_THRESHOLD: The repricing threshold must be between 0%% and 50%%.'; end if;
  if v_cur <> 'USD' and v_thr is null then raise exception 'INVALID_THRESHOLD: Enter when to reprice after the exchange rate moves.'; end if;
  if v_market is not null and not exists (select 1 from public.dropship_markets where org_id = v_org and country = v_market) then
    raise exception 'INVALID_MARKET: Your main market must be one of your selling countries.';
  end if;
  if coalesce(p_rules ->> 'when_landed_up', '') not in ('reprice', 'ask', 'alert')
     or coalesce(p_rules ->> 'when_landed_down', '') not in ('keep', 'reprice')
     or coalesce(p_rules ->> 'when_out_of_stock', '') not in ('draft', 'sold_out', 'nothing')
     or coalesce(p_rules ->> 'check_every_hours', '') not in ('1', '3', '6', '24') then
    raise exception 'INVALID_INPUT: Choose an option for every "When things change" setting.';
  end if;
  insert into public.dropship_pricing_rules as r (org_id, bands, rounding, compare_at_bp, min_profit_bp, store_currency, fx_threshold_bp, main_market,
      when_landed_up, when_landed_down, when_out_of_stock, check_every_hours, alert_low_stock, email_alerts, saved_by, saved_at)
  values (v_org, v_bands, p_rules ->> 'rounding', v_cmp, v_min, v_cur, v_thr, v_market, p_rules ->> 'when_landed_up', p_rules ->> 'when_landed_down',
      p_rules ->> 'when_out_of_stock', (p_rules ->> 'check_every_hours')::integer, coalesce((p_rules ->> 'alert_low_stock')::boolean, true),
      coalesce((p_rules ->> 'email_alerts')::boolean, true), auth.uid(), now())
  on conflict (org_id) do update set bands = excluded.bands, rounding = excluded.rounding, compare_at_bp = excluded.compare_at_bp,
      min_profit_bp = excluded.min_profit_bp, store_currency = excluded.store_currency, fx_threshold_bp = excluded.fx_threshold_bp,
      main_market = excluded.main_market, when_landed_up = excluded.when_landed_up, when_landed_down = excluded.when_landed_down,
      when_out_of_stock = excluded.when_out_of_stock, check_every_hours = excluded.check_every_hours, alert_low_stock = excluded.alert_low_stock,
      email_alerts = excluded.email_alerts, saved_by = auth.uid(), saved_at = now();
  perform write_audit('ds_pricing.saved', 'dropship_pricing_rules', v_org::text,
    jsonb_build_object('bands', jsonb_array_length(v_bands), 'rounding', p_rules ->> 'rounding', 'min_profit_bp', v_min, 'currency', v_cur));
  return jsonb_build_object('ok', true, 'rules', ds_rules_for(v_org));
end $$;

create or replace function public.ds_price_approval_decide(p_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_a public.dropship_price_approvals;
begin
  perform ds_feature_guard('pricing');
  if p_decision not in ('approve', 'keep_old') then raise exception 'INVALID_INPUT'; end if;
  select * into v_a from public.dropship_price_approvals where id = p_id and org_id = v_org for update;
  if v_a.id is null then raise exception 'NOT_FOUND'; end if;
  if v_a.status <> 'waiting' then raise exception 'ALREADY_DECIDED: This change was already decided.'; end if;
  update public.dropship_price_approvals set status = case when p_decision = 'approve' then 'approved' else 'kept_old' end,
         decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform write_audit('ds_price_approval.decided', 'dropship_price_approvals', p_id::text, jsonb_build_object('decision', p_decision));
  return jsonb_build_object('ok', true);
end $$;

-- staff: record a store-currency rate with its named source (Finance or admin). The daily feed is Step 11.
create or replace function public.ds_record_fx_rate(p_currency text, p_rate numeric, p_source_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not (is_admin() or has_role('finance')) then raise exception 'FORBIDDEN'; end if;
  if upper(coalesce(p_currency, '')) = 'USD' or not (upper(coalesce(p_currency, '')) = any(ds_supported_currencies())) then raise exception 'INVALID_CURRENCY'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 100000 then raise exception 'INVALID_RATE'; end if;
  if length(btrim(coalesce(p_source_name, ''))) < 2 then raise exception 'SOURCE_REQUIRED: Name the source of the rate.'; end if;
  insert into public.dropship_fx_rates (currency, rate_per_usd, source_name, recorded_by) values (upper(p_currency), p_rate, btrim(p_source_name), auth.uid())
  returning id into v_id;
  perform write_audit('ds_fx.recorded', 'dropship_fx_rates', v_id::text, jsonb_build_object('currency', upper(p_currency), 'rate', p_rate, 'source', btrim(p_source_name)));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ───────────────────────── 9f. Push queue RPCs ─────────────────────────
create or replace function public.ds_job_json(p_job public.dropship_push_jobs)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p_job.id, 'batch_id', p_job.batch_id, 'product_id', p_job.product_id, 'kind', p_job.kind,
    'status', p_job.status, 'attempts', p_job.attempts, 'next_attempt_at', p_job.next_attempt_at, 'error_code', p_job.error_code,
    'error_message', p_job.error_message, 'created_at', p_job.created_at, 'finished_at', p_job.finished_at,
    'title', coalesce(p_job.payload ->> 'title', (select coalesce(l.title, p.title) from public.dropship_products p
                 left join public.dropship_listings l on l.org_id = p_job.org_id and l.product_id = p.id where p.id = p_job.product_id)),
    'model_no', (select model_no from public.dropship_products where id = p_job.product_id),
    'publish_as', p_job.payload ->> 'status', 'below_min_confirmed', coalesce((p_job.pricing ->> 'confirmed_below_min')::boolean, false))
$$;

-- Push page data: store, the selected products' readiness, the latest batches with per-product status.
create or replace function public.ds_push_page(p_product_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  v_conn public.store_connections;
  v_items jsonb := '[]'::jsonb;
  v_pid uuid;
  st jsonb;
  v_status text;
begin
  perform ds_feature_guard('import_list');
  v_conn := ds_active_connection(v_org);
  select status into v_status from public.company_services where org_id = v_org and service = 'dropship';
  foreach v_pid in array coalesce(p_product_ids, '{}') loop
    st := ds_listing_state(v_org, v_pid, true);
    if st is null then continue; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', st -> 'product_id', 'model_no', st -> 'model_no',
      'title', st -> 'title', 'variants_included', st -> 'variants_included', 'ready', st -> 'ready', 'problems', st -> 'problems',
      'collection', st -> 'collection', 'publish_as', st -> 'publish_as', 'currency', st -> 'currency',
      'below', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', x -> 'variant_id', 'options', x -> 'options', 'price_minor', x -> 'price_minor', 'profit_bp', x -> 'profit_bp')), '[]'::jsonb)
                  from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean and (x ->> 'below_min')::boolean),
      'min_profit_bp', st -> 'min_profit_bp'));
  end loop;
  return jsonb_build_object(
    'dropship_status', coalesce(v_status, 'off'),
    'store', case when v_conn.id is null then null else jsonb_build_object('id', v_conn.id, 'shop_domain', v_conn.shop_domain, 'currency', v_conn.shop_currency) end,
    'store_needs_reconnect', exists (select 1 from public.store_connections where org_id = v_org and status = 'needs_reconnect'),
    'items', v_items,
    'batches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'created_at', b.created_at, 'options', b.options,
                   'jobs', (select coalesce(jsonb_agg(ds_job_json(j) order by j.created_at), '[]'::jsonb) from public.dropship_push_jobs j where j.batch_id = b.id))
                   order by b.created_at desc), '[]'::jsonb)
                  from (select * from public.dropship_push_batches where org_id = v_org order by created_at desc limit 5) b));
end $$;

-- Enqueue a push. Refused: feature off, paused / closed merchant, no active store ("Connect a store first"). Idempotent:
-- the same request_key returns the same batch; a product that already has an open job for this store is not queued twice.
-- Products that can't go are recorded as 'blocked' jobs with a plain reason (below minimum needs p_confirm_below_min).
create or replace function public.ds_push_enqueue(p_product_ids uuid[], p_options jsonb, p_confirm_below_min uuid[], p_request_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_conn public.store_connections;
  v_batch public.dropship_push_batches;
  v_opts jsonb;
  v_pub text := coalesce(nullif(p_options ->> 'publish_as', ''), 'draft');
  v_coll text := nullif(btrim(coalesce(p_options ->> 'collection', '')), '');
  v_pid uuid;
  st jsonb;
  v_prob jsonb;
  v_link public.dropship_product_links;
  v_lst public.dropship_listings;
  v_payload jsonb;
  v_pricing jsonb;
  v_queued integer := 0;
  v_already integer := 0;
  v_blocked jsonb := '[]'::jsonb;
  v_confirmed boolean;
  v_code text;
  v_msg text;
  v_job_id uuid;
begin
  perform ds_feature_guard('import_list');
  if p_request_key is null then raise exception 'INVALID_INPUT: request key missing.'; end if;
  if coalesce(array_length(p_product_ids, 1), 0) = 0 or array_length(p_product_ids, 1) > 100 then
    raise exception 'INVALID_INPUT: Choose between 1 and 100 products.';
  end if;
  v_conn := ds_active_connection(v_org);
  if v_conn.id is null then
    raise exception 'STORE_NOT_CONNECTED: Connect a store first. Nothing was pushed.';
  end if;
  select * into v_batch from public.dropship_push_batches where org_id = v_org and request_key = p_request_key;
  if v_batch.id is not null then
    return jsonb_build_object('ok', true, 'replayed', true, 'batch_id', v_batch.id,
      'queued', (select count(*) from public.dropship_push_jobs where batch_id = v_batch.id and status <> 'blocked'),
      'blocked', (select coalesce(jsonb_agg(ds_job_json(j)), '[]'::jsonb) from public.dropship_push_jobs j where j.batch_id = v_batch.id and j.status = 'blocked'));
  end if;
  if v_pub not in ('draft', 'active') then raise exception 'INVALID_INPUT'; end if;
  if v_coll is not null and (length(v_coll) > 120 or jsonb_array_length(ds_text_problems(p_product_ids[1], jsonb_build_object('collection', v_coll))) > 0) then
    raise exception 'TEXT_CHECK: collection';
  end if;
  v_opts := jsonb_build_object('publish_as', v_pub, 'collection', v_coll,
    'push_images', coalesce((p_options ->> 'push_images')::boolean, true), 'push_seo', coalesce((p_options ->> 'push_seo')::boolean, true),
    'keep_synced', coalesce((p_options ->> 'keep_synced')::boolean, true));
  insert into public.dropship_push_batches (org_id, store_connection_id, kind, request_key, options, requested_by)
  values (v_org, v_conn.id, 'push', p_request_key, v_opts, auth.uid()) returning * into v_batch;

  foreach v_pid in array (select array_agg(distinct x) from unnest(p_product_ids) x) loop
    st := ds_listing_state(v_org, v_pid, true);
    v_code := null; v_msg := null;
    if st is null then
      v_code := 'NOT_AVAILABLE'; v_msg := 'This product is not available to push.';
    elsif exists (select 1 from public.dropship_push_jobs where store_connection_id = v_conn.id and product_id = v_pid and status in ('queued', 'running', 'retry_wait')) then
      v_already := v_already + 1;
      continue;
    else
      select p into v_prob from jsonb_array_elements(st -> 'problems') p where (p ->> 'blocking')::boolean limit 1;
      if v_prob is not null then
        v_code := v_prob ->> 'code'; v_msg := v_prob ->> 'message';
      end if;
      v_prob := null;
      v_confirmed := v_pid = any(coalesce(p_confirm_below_min, '{}'));
      if v_code is null and exists (select 1 from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean and (x ->> 'below_min')::boolean) and not v_confirmed then
        v_code := 'BELOW_MIN';
        v_msg := (select format('Price %s gives %s%%, below your %s%% minimum.', ds_fmt_money((x ->> 'price_minor')::bigint, st ->> 'currency'), round((x ->> 'profit_bp')::numeric / 100, 1), round((st ->> 'min_profit_bp')::numeric / 100, 1))
                    from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean and (x ->> 'below_min')::boolean
                   order by (x ->> 'profit_bp')::integer limit 1);
      end if;
    end if;
    if v_code is not null then
      insert into public.dropship_push_jobs (batch_id, org_id, store_connection_id, product_id, kind, status, error_code, error_message, finished_at)
      values (v_batch.id, v_org, v_conn.id, v_pid, 'push', 'blocked', v_code, v_msg, now()) returning id into v_job_id;
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('job_id', v_job_id, 'product_id', v_pid, 'code', v_code, 'message', v_msg));
      continue;
    end if;

    select * into v_link from public.dropship_product_links where store_connection_id = v_conn.id and product_id = v_pid and status = 'linked';
    select * into v_lst from public.dropship_listings where org_id = v_org and product_id = v_pid;
    -- merchant-safe payload: listing copy + DS model numbers + prices; never supplier, cost or Sourcing fields
    v_payload := jsonb_build_object(
      'listing_ref', coalesce(v_lst.id::text, md5(v_org::text || v_pid::text)),
      'product_gid', v_link.product_gid,
      'title', st ->> 'title',
      'description_html', ds_text_to_html(st ->> 'description'),
      'vendor', st ->> 'vendor', 'product_type', st ->> 'product_type',
      'tags', st -> 'tags', 'collection', coalesce(v_coll, st ->> 'collection'),
      'handle', st ->> 'handle',
      'seo', case when (v_opts ->> 'push_seo')::boolean then jsonb_build_object('title', st ->> 'seo_title', 'description', st ->> 'seo_description') else null end,
      'status', upper(v_pub),
      'images', case when (v_opts ->> 'push_images')::boolean then st -> 'image_urls' else (st -> 'image_urls') -> 0 end,
      'currency', st ->> 'currency', 'currency_exponent', (st ->> 'currency_exponent')::integer,
      'location_gid', v_conn.octopus_location_id,
      'sync', jsonb_build_object('stock', (st ->> 'sync_stock')::boolean and (v_opts ->> 'keep_synced')::boolean,
                                 'price', (st ->> 'sync_price')::boolean and (v_opts ->> 'keep_synced')::boolean),
      'variants', (select jsonb_agg(jsonb_build_object('variant_id', x -> 'variant_id', 'model_no', x -> 'model_no', 'sku', x -> 'store_sku',
                     'options', x -> 'options', 'price_minor', x -> 'price_minor', 'compare_at_minor', x -> 'compare_at_minor',
                     'stock_status', x -> 'stock_status',
                     'variant_gid', (select vl.variant_gid from public.dropship_variant_links vl where vl.product_link_id = v_link.id and vl.variant_id = (x ->> 'variant_id')::uuid),
                     'inventory_item_gid', (select vl.inventory_item_gid from public.dropship_variant_links vl where vl.product_link_id = v_link.id and vl.variant_id = (x ->> 'variant_id')::uuid)))
                   from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean));
    v_pricing := jsonb_build_object('currency', st ->> 'currency', 'fx', st -> 'fx', 'market', st ->> 'market', 'method', st ->> 'method',
      'duty_mode', st ->> 'duty_mode', 'min_profit_bp', st -> 'min_profit_bp', 'price_mode', st ->> 'price_mode', 'rules', st -> 'rules',
      'confirmed_below_min', v_confirmed and exists (select 1 from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean and (x ->> 'below_min')::boolean),
      'variants', (select jsonb_agg(jsonb_build_object('variant_id', x -> 'variant_id', 'landed_usd_cents', x -> 'landed_usd_cents', 'landed', x -> 'landed',
                     'rule_band', x -> 'rule_band', 'price_minor', x -> 'price_minor', 'compare_at_minor', x -> 'compare_at_minor',
                     'profit_bp', x -> 'profit_bp', 'below_min', x -> 'below_min', 'manual', x -> 'manual'))
                   from jsonb_array_elements(st -> 'variants') x where (x ->> 'include')::boolean),
      'calculated_at', now());
    insert into public.dropship_push_jobs (batch_id, org_id, store_connection_id, product_id, listing_id, kind, status, payload, pricing)
    values (v_batch.id, v_org, v_conn.id, v_pid, v_lst.id, 'push', 'queued', v_payload, v_pricing);
    v_queued := v_queued + 1;
    if (v_pricing ->> 'confirmed_below_min')::boolean then
      perform write_audit('ds_push.below_min_confirmed', 'dropship_products', v_pid::text, jsonb_build_object('org_id', v_org, 'batch_id', v_batch.id));
    end if;
  end loop;
  perform write_audit('ds_push.enqueued', 'dropship_push_batches', v_batch.id::text,
    jsonb_build_object('org_id', v_org, 'queued', v_queued, 'already_queued', v_already, 'blocked', jsonb_array_length(v_blocked)));
  return jsonb_build_object('ok', true, 'replayed', false, 'batch_id', v_batch.id, 'queued', v_queued, 'already_queued', v_already, 'blocked', v_blocked);
end $$;

create or replace function public.ds_push_cancel(p_job_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  v_n integer;
begin
  update public.dropship_push_jobs set status = 'cancelled', finished_at = now(), updated_at = now()
   where org_id = v_org and id = any(coalesce(p_job_ids, '{}')) and status in ('queued', 'retry_wait', 'blocked');
  get diagnostics v_n = row_count;
  if v_n > 0 then perform write_audit('ds_push.cancelled', 'organizations', v_org::text, jsonb_build_object('jobs', v_n)); end if;
  return jsonb_build_object('ok', true, 'cancelled', v_n);
end $$;

-- Retry failed / blocked jobs: a new batch rebuilt from today's listing and prices (same options as the first push)
create or replace function public.ds_push_retry(p_job_ids uuid[], p_request_key uuid, p_confirm_below_min uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_pids uuid[];
  v_opts jsonb;
begin
  select array_agg(distinct j.product_id), (array_agg(b.options order by j.created_at desc))[1] into v_pids, v_opts
    from public.dropship_push_jobs j join public.dropship_push_batches b on b.id = j.batch_id
   where j.org_id = v_org and j.id = any(coalesce(p_job_ids, '{}')) and j.status in ('failed', 'blocked') and j.kind = 'push';
  if v_pids is null then raise exception 'NOTHING_TO_RETRY: Only failed or not-pushed products can be retried.'; end if;
  return ds_push_enqueue(v_pids, coalesce(v_opts, '{}'::jsonb), p_confirm_below_min, p_request_key);
end $$;

-- Unlink: the product stays in the store but stops syncing and leaves the Octopus location (stock set to 0 there FIRST,
-- by the executor). Not new activity, so paused merchants may unlink. Without an active store the link just ends here.
create or replace function public.ds_unlink(p_product_ids uuid[], p_request_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  v_batch public.dropship_push_batches;
  l public.dropship_product_links;
  v_conn public.store_connections;
  v_jobs integer := 0;
  v_local integer := 0;
begin
  perform ds_feature_guard('pushed');
  if p_request_key is null or coalesce(array_length(p_product_ids, 1), 0) = 0 or array_length(p_product_ids, 1) > 100 then
    raise exception 'INVALID_INPUT: Choose between 1 and 100 products.';
  end if;
  select * into v_batch from public.dropship_push_batches where org_id = v_org and request_key = p_request_key;
  if v_batch.id is not null then return jsonb_build_object('ok', true, 'replayed', true, 'batch_id', v_batch.id); end if;
  v_conn := ds_active_connection(v_org);
  insert into public.dropship_push_batches (org_id, store_connection_id, kind, request_key, requested_by)
  values (v_org, v_conn.id, 'unlink', p_request_key, auth.uid()) returning * into v_batch;
  for l in select * from public.dropship_product_links where org_id = v_org and product_id = any(p_product_ids) and status = 'linked' loop
    if v_conn.id is not null and l.store_connection_id = v_conn.id then
      if not exists (select 1 from public.dropship_push_jobs where store_connection_id = l.store_connection_id and product_id = l.product_id and status in ('queued', 'running', 'retry_wait')) then
        insert into public.dropship_push_jobs (batch_id, org_id, store_connection_id, product_id, listing_id, kind, status, payload)
        values (v_batch.id, v_org, l.store_connection_id, l.product_id, l.listing_id, 'unlink', 'queued',
          jsonb_build_object('product_gid', l.product_gid, 'location_gid', v_conn.octopus_location_id, 'stock_to_zero_first', true,
            'inventory_item_gids', (select coalesce(jsonb_agg(vl.inventory_item_gid), '[]'::jsonb) from public.dropship_variant_links vl where vl.product_link_id = l.id and vl.inventory_item_gid is not null)));
        v_jobs := v_jobs + 1;
      end if;
    else
      update public.dropship_product_links set status = 'unlinked', unlinked_at = now(), updated_at = now() where id = l.id;
      insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
      values (v_org, l.store_connection_id, l.product_id, 'unlink', 'Unlinked', 'Sync stopped (the store is not connected)');
      v_local := v_local + 1;
    end if;
  end loop;
  perform write_audit('ds_unlink.requested', 'dropship_push_batches', v_batch.id::text, jsonb_build_object('org_id', v_org, 'jobs', v_jobs, 'unlinked_here', v_local));
  return jsonb_build_object('ok', true, 'replayed', false, 'batch_id', v_batch.id, 'queued', v_jobs, 'unlinked', v_local);
end $$;

create or replace function public.ds_pushed_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := ds_org_read();
begin
  perform ds_feature_guard('pushed');
  return jsonb_build_object(
    'store', (select jsonb_build_object('shop_domain', c.shop_domain, 'currency', c.shop_currency) from public.store_connections c where c.id = (ds_active_connection(v_org)).id),
    'store_needs_reconnect', exists (select 1 from public.store_connections where org_id = v_org and status = 'needs_reconnect'),
    'import_count', (select count(distinct product_id) from public.dropship_import_list where org_id = v_org),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'model_no', p.model_no, 'title', coalesce(li.title, p.title),
               'store_status', l.store_status, 'sync_state', l.sync_state, 'sync_message', l.sync_message, 'last_synced_at', coalesce(l.last_synced_at, l.last_pushed_at),
               'stock_status', (select case when bool_or(ds_variant_stock_label(vl.variant_id) in ('in_stock', 'extended')) then 'in_stock'
                                             when bool_or(ds_variant_stock_label(vl.variant_id) = 'low') then 'low' else 'out' end
                                  from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'price_min', (select min(vl.price_minor) from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'price_max', (select max(vl.price_minor) from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'currency', (select max(vl.currency) from public.dropship_variant_links vl where vl.product_link_id = l.id),
               'open_job', (select ds_job_json(j) from public.dropship_push_jobs j where j.org_id = v_org and j.product_id = l.product_id and j.status in ('queued', 'running', 'retry_wait') limit 1))
               order by l.updated_at desc), '[]'::jsonb)
             from public.dropship_product_links l join public.dropship_products p on p.id = l.product_id
             left join public.dropship_listings li on li.org_id = l.org_id and li.product_id = l.product_id
            where l.org_id = v_org and l.status = 'linked'),
    'failed', (select coalesce(jsonb_agg(ds_job_json(j) order by j.created_at desc), '[]'::jsonb)
                 from public.dropship_push_jobs j where j.org_id = v_org and j.status = 'failed'
                  and not exists (select 1 from public.dropship_push_jobs k where k.org_id = j.org_id and k.product_id = j.product_id and k.created_at > j.created_at
                                    and k.status in ('queued', 'running', 'retry_wait', 'done'))));
end $$;

-- ───────────────────────── 9g. Executor (service role only; runs only for active connections) ─────────────────────────
create or replace function public.ds_push_claim(p_worker text, p_limit integer default 5)
returns setof jsonb language plpgsql security definer set search_path = public as $$
declare j public.dropship_push_jobs;
begin
  for j in
    select q.* from public.dropship_push_jobs q join public.store_connections c on c.id = q.store_connection_id and c.status = 'active'
     where (q.status in ('queued', 'retry_wait') and q.next_attempt_at <= now())
        or (q.status = 'running' and q.locked_at < now() - interval '10 minutes')   -- resume after a crashed worker
     order by q.next_attempt_at, q.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 50))
     for update of q skip locked
  loop
    update public.dropship_push_jobs set status = 'running', locked_at = now(), locked_by = left(coalesce(p_worker, 'worker'), 80),
           attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
     where id = j.id returning * into j;
    return next jsonb_build_object('id', j.id, 'kind', j.kind, 'org_id', j.org_id, 'store_connection_id', j.store_connection_id,
      'product_id', j.product_id, 'attempts', j.attempts, 'max_attempts', j.max_attempts, 'payload', j.payload);
  end loop;
end $$;

-- p_result (push): {product_gid, store_status, variants: [{variant_id, variant_gid, inventory_item_gid, sku, price_minor, compare_at_minor}]}
create or replace function public.ds_push_complete(p_job_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.dropship_push_jobs;
  v_link_id uuid;
  v jsonb;
begin
  select * into j from public.dropship_push_jobs where id = p_job_id for update;
  if j.id is null or j.status <> 'running' then raise exception 'JOB_NOT_RUNNING'; end if;
  if j.kind = 'push' then
    if coalesce(p_result ->> 'product_gid', '') !~ '^gid://shopify/Product/\d+$' then raise exception 'INVALID_RESULT'; end if;
    insert into public.dropship_product_links as l (org_id, store_connection_id, product_id, listing_id, product_gid, status, store_status, sync_state, last_pushed_at, last_synced_at)
    values (j.org_id, j.store_connection_id, j.product_id, j.listing_id, p_result ->> 'product_gid', 'linked',
            coalesce(lower(p_result ->> 'store_status'), lower(j.payload ->> 'status'), 'draft'), 'in_sync', now(), now())
    on conflict (store_connection_id, product_id) do update set product_gid = excluded.product_gid, listing_id = excluded.listing_id, status = 'linked',
        store_status = excluded.store_status, sync_state = 'in_sync', sync_message = null, last_pushed_at = now(), last_synced_at = now(),
        unlinked_at = null, updated_at = now()
    returning id into v_link_id;
    for v in select value from jsonb_array_elements(coalesce(p_result -> 'variants', '[]'::jsonb)) loop
      insert into public.dropship_variant_links (product_link_id, org_id, variant_id, variant_gid, inventory_item_gid, store_sku, price_minor, compare_at_minor, currency, updated_at)
      values (v_link_id, j.org_id, (v ->> 'variant_id')::uuid, v ->> 'variant_gid', v ->> 'inventory_item_gid', v ->> 'sku',
              (v ->> 'price_minor')::bigint, (v ->> 'compare_at_minor')::bigint, j.payload ->> 'currency', now())
      on conflict (product_link_id, variant_id) do update set variant_gid = excluded.variant_gid, inventory_item_gid = excluded.inventory_item_gid,
          store_sku = excluded.store_sku, price_minor = excluded.price_minor, compare_at_minor = excluded.compare_at_minor, currency = excluded.currency, updated_at = now();
    end loop;
    insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
    values (j.org_id, j.store_connection_id, j.product_id, 'push', 'Pushed', 'Created or updated in Shopify as ' || coalesce(lower(j.payload ->> 'status'), 'draft'));
  else
    update public.dropship_product_links set status = 'unlinked', unlinked_at = now(), updated_at = now()
     where store_connection_id = j.store_connection_id and product_id = j.product_id;
    insert into public.dropship_sync_log (org_id, store_connection_id, product_id, kind, change_text, result_text)
    values (j.org_id, j.store_connection_id, j.product_id, 'unlink', 'Unlinked', 'Stock set to 0 at the Octopus location; sync stopped');
  end if;
  update public.dropship_push_jobs set status = 'done', finished_at = now(), locked_at = null, locked_by = null, error_code = null, error_message = null, updated_at = now()
   where id = j.id;
  perform write_audit('ds_push.completed', 'dropship_push_jobs', j.id::text, jsonb_build_object('org_id', j.org_id, 'kind', j.kind));
  return jsonb_build_object('ok', true);
end $$;

-- a failure: retry later (rate limit → Retry-After / cost-based wait; others exponential 15 s · 2^n, max 10 min) or fail
-- for good with a plain-words message for the merchant
create or replace function public.ds_push_fail(p_job_id uuid, p_code text, p_message text, p_retry_after_s integer default null, p_permanent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.dropship_push_jobs;
  v_final boolean;
begin
  select * into j from public.dropship_push_jobs where id = p_job_id for update;
  if j.id is null or j.status <> 'running' then raise exception 'JOB_NOT_RUNNING'; end if;
  v_final := coalesce(p_permanent, false) or j.attempts >= j.max_attempts;
  update public.dropship_push_jobs set
      status = case when v_final then 'failed' else 'retry_wait' end,
      next_attempt_at = case when v_final then next_attempt_at
                             else now() + make_interval(secs => coalesce(p_retry_after_s, least(600, 15 * power(2, greatest(0, j.attempts - 1)))::integer)) end,
      error_code = left(coalesce(p_code, 'ERROR'), 60), error_message = left(coalesce(p_message, 'Something went wrong.'), 500),
      finished_at = case when v_final then now() end, locked_at = null, locked_by = null, updated_at = now()
   where id = j.id;
  if v_final then
    update public.dropship_product_links set sync_state = 'failed', sync_message = left(coalesce(p_message, ''), 500), updated_at = now()
     where store_connection_id = j.store_connection_id and product_id = j.product_id;
    perform write_audit('ds_push.failed', 'dropship_push_jobs', j.id::text, jsonb_build_object('org_id', j.org_id, 'code', p_code));
  end if;
  return jsonb_build_object('ok', true, 'final', v_final);
end $$;

-- ───────────────────────── 9h. Packing and shipping RPCs ─────────────────────────
create or replace function public.ds_packing_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := ds_org_read();
  s public.dropship_packing_settings;
  fv public.fee_versions;
  v_conn public.store_connections;
  v_market text := ds_main_market(v_org);
  v_example jsonb;
  v_var uuid;
begin
  perform ds_feature_guard('packing');
  select * into s from public.dropship_packing_settings where org_id = v_org;
  select * into fv from public.fee_versions where status = 'active' limit 1;
  v_conn := ds_active_connection(v_org);
  select dv.id into v_var from public.dropship_import_list il join public.dropship_products p on p.id = il.product_id
    join public.dropship_variants dv on dv.product_id = p.id
   where il.org_id = v_org and ds_product_visible(p, v_org) order by il.created_at desc, dv.sort limit 1;
  if v_var is not null and v_market is not null then
    begin
      v_example := public.get_dropship_order_quote(jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 2)), v_market,
                     coalesce(s.default_method, 'standard'), ds_duty_mode(v_org, v_market), 'USD', null, 'catalogue');
      v_example := v_example || jsonb_build_object('title', (select coalesce(l.title, p.title) from public.dropship_variants dv join public.dropship_products p on p.id = dv.product_id
                                    left join public.dropship_listings l on l.org_id = v_org and l.product_id = p.id where dv.id = v_var));
    exception when others then v_example := null;
    end;
  end if;
  return jsonb_build_object(
    'saved', s.org_id is not null,
    'settings', jsonb_build_object('default_packaging', coalesce(s.default_packaging, 'standard'), 'branded_sku_id', s.branded_sku_id,
       'insert_card', coalesce(s.insert_card, false), 'insert_card_sku_id', s.insert_card_sku_id, 'sticker', coalesce(s.sticker, false),
       'sticker_sku_id', s.sticker_sku_id, 'gift_message', coalesce(s.gift_message, true), 'packing_slip', coalesce(s.packing_slip, 'brand_no_prices'),
       'insurance', coalesce(s.insurance, false), 'signature', coalesce(s.signature, false),
       'default_method', coalesce(s.default_method, 'standard'), 'fallback_method', coalesce(s.fallback_method, 'cheapest_on_time')),
    -- fees from the active fee version; a fee that has no field or no value is "not set" (null), never 0
    'fees', case when fv.id is null then null else jsonb_build_object('version', fv.version,
       'processing_first_cents', fv.pick_pack_first_cents, 'processing_extra_cents', fv.pick_pack_extra_cents,
       'standard_packaging_included', true, 'branded_cents', fv.branded_packaging_cents, 'protective_cents', null,
       'insert_cents', null, 'sticker_cents', null, 'signature_cents', null,
       'insurance_bp', nullif(fv.insurance_bp, 0), 'weigh_tolerance_g', fv.weigh_tolerance_g, 'weigh_tolerance_pct', fv.weigh_tolerance_pct,
       'dispute_window_days', fv.dispute_window_days) end,
    -- the merchant's own stock at the warehouse (their 3PL client SKUs with something available)
    'own_stock', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'sku', k.sku, 'name', k.name, 'available', a.qty) order by k.name), '[]'::jsonb)
                    from public.wh_client_skus k
                    cross join lateral (select coalesce(sum(greatest(0, ws.on_hand_qty - ws.reserved_qty)), 0)::integer qty from public.warehouse_stock ws where ws.item_id = k.item_id) a
                   where k.org_id = v_org and k.status = 'active' and a.qty > 0),
    'markets', (select coalesce(jsonb_agg(jsonb_build_object('country', m.country, 'mode', ds_duty_mode(v_org, m.country),
                   'saved', exists (select 1 from public.dropship_duty_modes d where d.org_id = v_org and d.country = m.country)) order by m.country), '[]'::jsonb)
                  from public.dropship_markets m where m.org_id = v_org),
    'methods', (select coalesce(jsonb_agg(jsonb_build_object('method', x.method, 'days_min', x.dmin, 'days_max', x.dmax) order by x.method), '[]'::jsonb)
                  from (select rc.method, min(rc.days_min) dmin, max(rc.days_max) dmax from public.shipping_rate_cards rc
                         where rc.active and rc.country in (select country from public.dropship_markets where org_id = v_org) group by rc.method) x),
    'store', case when v_conn.id is null then null else jsonb_build_object('shop_domain', v_conn.shop_domain) end,
    'rate_mappings', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'rate_name', r.rate_name, 'countries', r.countries, 'method', r.method) order by r.rate_name), '[]'::jsonb)
                        from public.dropship_rate_mappings r where r.org_id = v_org and r.store_connection_id = v_conn.id),
    'market', v_market, 'example', v_example);
end $$;

create or replace function public.ds_packing_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  fv public.fee_versions;
  v_pack text := coalesce(p ->> 'default_packaging', 'standard');
  v_branded uuid := nullif(p ->> 'branded_sku_id', '')::uuid;
  v_card uuid := nullif(p ->> 'insert_card_sku_id', '')::uuid;
  v_sticker uuid := nullif(p ->> 'sticker_sku_id', '')::uuid;
  v_insert boolean := coalesce((p ->> 'insert_card')::boolean, false);
  v_stk boolean := coalesce((p ->> 'sticker')::boolean, false);
  v_ins boolean := coalesce((p ->> 'insurance')::boolean, false);
  v_sig boolean := coalesce((p ->> 'signature')::boolean, false);
  d jsonb;
  v_country text;
  v_modes integer := 0;
begin
  perform ds_feature_guard('packing');
  if jsonb_typeof(coalesce(p, 'null'::jsonb)) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  select * into fv from public.fee_versions where status = 'active' limit 1;
  if v_pack not in ('standard', 'protective', 'branded') then raise exception 'INVALID_INPUT'; end if;
  -- unknown fees can't be chosen (never charged as 0)
  if v_pack = 'protective' then raise exception 'FEE_NOT_SET: The protective packaging fee is not set yet.'; end if;
  if v_pack = 'branded' then
    if fv.branded_packaging_cents is null then raise exception 'FEE_NOT_SET: The branded packaging handling fee is not set yet.'; end if;
    if v_branded is null then raise exception 'BRANDED_STOCK_REQUIRED: Choose which of your stored items is your branded packaging.'; end if;
  end if;
  if v_insert or v_stk then raise exception 'FEE_NOT_SET: The handling fee for inserts and stickers is not set yet.'; end if;
  if v_ins and coalesce(fv.insurance_bp, 0) = 0 then raise exception 'NOT_OFFERED: Shipping insurance is not offered yet.'; end if;
  if v_sig then raise exception 'FEE_NOT_SET: The signature-on-delivery fee is not set yet.'; end if;
  -- any stock item chosen must be the merchant's own, active and in stock
  if exists (select 1 from unnest(array[v_branded, v_card, v_sticker]) x(id) where x.id is not null
              and not exists (select 1 from public.wh_client_skus k where k.id = x.id and k.org_id = v_org and k.status = 'active'
                                and (select coalesce(sum(greatest(0, ws.on_hand_qty - ws.reserved_qty)), 0) from public.warehouse_stock ws where ws.item_id = k.item_id) > 0)) then
    raise exception 'INVALID_STOCK: Choose one of your own items that is in stock at the warehouse.';
  end if;
  if coalesce(p ->> 'packing_slip', 'brand_no_prices') not in ('brand_no_prices', 'none')
     or coalesce(p ->> 'default_method', 'standard') not in ('economy', 'standard', 'express')
     or coalesce(p ->> 'fallback_method', 'cheapest_on_time') not in ('cheapest_on_time', 'economy', 'standard', 'express') then
    raise exception 'INVALID_INPUT';
  end if;
  insert into public.dropship_packing_settings as s (org_id, default_packaging, branded_sku_id, insert_card, insert_card_sku_id, sticker, sticker_sku_id,
      gift_message, packing_slip, insurance, signature, default_method, fallback_method, saved_by, saved_at)
  values (v_org, v_pack, case when v_pack = 'branded' then v_branded end, v_insert, v_card, v_stk, v_sticker,
      coalesce((p ->> 'gift_message')::boolean, true), coalesce(p ->> 'packing_slip', 'brand_no_prices'), v_ins, v_sig,
      coalesce(p ->> 'default_method', 'standard'), coalesce(p ->> 'fallback_method', 'cheapest_on_time'), auth.uid(), now())
  on conflict (org_id) do update set default_packaging = excluded.default_packaging, branded_sku_id = excluded.branded_sku_id,
      insert_card = excluded.insert_card, insert_card_sku_id = excluded.insert_card_sku_id, sticker = excluded.sticker,
      sticker_sku_id = excluded.sticker_sku_id, gift_message = excluded.gift_message, packing_slip = excluded.packing_slip,
      insurance = excluded.insurance, signature = excluded.signature, default_method = excluded.default_method,
      fallback_method = excluded.fallback_method, saved_by = auth.uid(), saved_at = now();
  -- duty mode per selling country (ONLY set here)
  if jsonb_typeof(coalesce(p -> 'duty_modes', '{}'::jsonb)) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  for d in select jsonb_build_object('country', key, 'mode', value) from jsonb_each_text(coalesce(p -> 'duty_modes', '{}'::jsonb)) loop
    v_country := upper(d ->> 'country');
    if (d ->> 'mode') not in ('DDP', 'DAP') then raise exception 'INVALID_INPUT: Duties are DDP or DAP.'; end if;
    if not exists (select 1 from public.dropship_markets where org_id = v_org and country = v_country) then
      raise exception 'INVALID_MARKET: % is not one of your selling countries.', v_country;
    end if;
    insert into public.dropship_duty_modes (org_id, country, mode, saved_by, saved_at) values (v_org, v_country, d ->> 'mode', auth.uid(), now())
    on conflict (org_id, country) do update set mode = excluded.mode, saved_by = auth.uid(), saved_at = now();
    v_modes := v_modes + 1;
  end loop;
  perform write_audit('ds_packing.saved', 'dropship_packing_settings', v_org::text,
    jsonb_build_object('default_packaging', v_pack, 'default_method', coalesce(p ->> 'default_method', 'standard'),
      'duty_modes', coalesce(p -> 'duty_modes', '{}'::jsonb)));
  return jsonb_build_object('ok', true, 'duty_modes_saved', v_modes);
end $$;

-- map one store rate (rows come from Step 5's read_shipping reader) to a method; needs an active store
create or replace function public.ds_rate_mapping_save(p_mapping_id uuid, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := assert_dropship_new_activity();
  v_n integer;
begin
  perform ds_feature_guard('packing');
  if p_method is not null and p_method not in ('economy', 'standard', 'express') then raise exception 'INVALID_INPUT'; end if;
  if (ds_active_connection(v_org)).id is null then raise exception 'STORE_NOT_CONNECTED: Connect a store to map rates.'; end if;
  update public.dropship_rate_mappings set method = p_method, updated_at = now()
   where id = p_mapping_id and org_id = v_org and store_connection_id = (ds_active_connection(v_org)).id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NOT_FOUND'; end if;
  perform write_audit('ds_rate_mapping.saved', 'dropship_rate_mappings', p_mapping_id::text, jsonb_build_object('method', p_method));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── 10. Function grants ─────────────────────────
do $$
declare f text;
begin
  -- everything this migration creates: nobody by default
  foreach f in array array[
    'ds_supported_currencies()', 'ds_currency_exponent(text)', 'ds_round_price(numeric, text, integer)', 'ds_bands_problem(jsonb)',
    'ds_price_compute(bigint, jsonb, text, integer, integer, numeric, text)', 'ds_profit_bp(bigint, bigint, numeric, text)', 'ds_fmt_money(bigint, text)', 'ds_text_to_html(text)',
    'ds_org_read()', 'ds_feature_guard(text)', 'ds_product_visible(public.dropship_products, uuid)', 'ds_variant_stock_label(uuid)',
    'ds_rules_for(uuid)', 'ds_main_market(uuid)', 'ds_default_method(uuid)', 'ds_duty_mode(uuid, text)', 'ds_active_connection(uuid)',
    'ds_fx_for(text)', 'ds_packaging_extra_cents(uuid)', 'ds_text_problems(uuid, jsonb)', 'ds_variant_landed(uuid, text, text, text, bigint)',
    'ds_listing_state(uuid, uuid, boolean)', 'ds_job_json(public.dropship_push_jobs)',
    'ds_import_list()', 'ds_import_add(uuid[])', 'ds_import_remove(uuid[])', 'ds_import_bulk_add(jsonb)', 'ds_import_apply_rule(uuid[])',
    'ds_listing_get(uuid)', 'ds_text_check(uuid, jsonb)', 'ds_listing_save(uuid, jsonb)', 'ds_pricing_get()', 'ds_pricing_save(jsonb)',
    'ds_price_approval_decide(uuid, text)', 'ds_record_fx_rate(text, numeric, text)', 'ds_push_page(uuid[])',
    'ds_push_enqueue(uuid[], jsonb, uuid[], uuid)', 'ds_push_cancel(uuid[])', 'ds_push_retry(uuid[], uuid, uuid[])', 'ds_unlink(uuid[], uuid)',
    'ds_pushed_list()', 'ds_push_claim(text, integer)', 'ds_push_complete(uuid, jsonb)', 'ds_push_fail(uuid, text, text, integer, boolean)',
    'ds_packing_get()', 'ds_packing_save(jsonb)', 'ds_rate_mapping_save(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- signed-in merchants (each checks the merchant itself) + the pure price helpers the pages mirror
  foreach f in array array[
    'ds_supported_currencies()', 'ds_currency_exponent(text)', 'ds_round_price(numeric, text, integer)', 'ds_bands_problem(jsonb)',
    'ds_price_compute(bigint, jsonb, text, integer, integer, numeric, text)', 'ds_profit_bp(bigint, bigint, numeric, text)', 'ds_fmt_money(bigint, text)',
    'ds_import_list()', 'ds_import_add(uuid[])', 'ds_import_remove(uuid[])', 'ds_import_bulk_add(jsonb)', 'ds_import_apply_rule(uuid[])',
    'ds_listing_get(uuid)', 'ds_text_check(uuid, jsonb)', 'ds_listing_save(uuid, jsonb)', 'ds_pricing_get()', 'ds_pricing_save(jsonb)',
    'ds_price_approval_decide(uuid, text)', 'ds_record_fx_rate(text, numeric, text)', 'ds_push_page(uuid[])',
    'ds_push_enqueue(uuid[], jsonb, uuid[], uuid)', 'ds_push_cancel(uuid[])', 'ds_push_retry(uuid[], uuid, uuid[])', 'ds_unlink(uuid[], uuid)',
    'ds_pushed_list()', 'ds_packing_get()', 'ds_packing_save(jsonb)', 'ds_rate_mapping_save(uuid, text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
