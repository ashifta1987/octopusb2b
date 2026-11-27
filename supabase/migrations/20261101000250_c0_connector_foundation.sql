-- C0 · Connector foundation + customs safety (installs as migration 250, on top of 249 DS16). Built from STEP0 (connectors gap report).
-- Only the parts that need NO owner keys. Builds on the existing tables; nothing is duplicated:
--   store_connections (DS6)        widened to the planned platforms + store_url, detected platform, scopes, last sync, last error
--   store_credentials (NEW)        service-role-only, AES-256-GCM ciphertext from lib/crypto/token-box.ts (key CONNECTOR_TOKEN_KEY, key_version)
--   store_oauth_states (NEW)       service-role-only OAuth state nonces (hash only), for the platform connections later
--   dropship_channel_waitlist      widened = the "Request this platform" counter (+ requested_name for "Other")
--   store_orders.channel           widened so every planned connector maps onto the same store_orders / ds_order_intake
--   dropship_csv_imports (NEW)     CSV file connector import history (orders go through ds_order_intake with channel 'csv')
--   carrier_tracking_names (NEW)   carrier → store tracking company name + URL template (staff-editable; seeded only where certain)
--   wh_shipment_customs (NEW)      the customs snapshot saved with every Warehouse OS label (locked)
-- Customs safety (real bugs found in STEP0):
--   * the declared value NEVER falls back to the product (cost) price: get_dropship_order_quote returns no declared value without
--     the buyer's price, create_dropship_store_order refuses such a line (BUYER_PRICE_MISSING), intake passes buyer_paid_cents through;
--   * wh_customs_check() runs before every label (wh_label_plan) and again when the label is recorded (wh_label_record): declared value
--     = what the buyer paid (locked), English description, verified HS, qty, unit value, origin, weight per item, battery / liquid /
--     magnet flags, and the customs_policy.block_below_pct when it is set (unset today → "not set", skipped);
--   * the snapshot of the store order is saved with the shipment.
-- pollCarrierTracking is scheduled through /api/cron/carrier-tracking-poll (pg_cron → pg_net, same pattern as the outbox dispatcher).
-- Money: integer cents. Every write is audited with write_audit(). RLS on every new table. search_path = public on every function.

-- ───────────────────────── 1. store_connections: planned platforms ─────────────────────────
alter table public.store_connections drop constraint if exists store_connections_platform_check;
alter table public.store_connections add constraint store_connections_platform_check check (platform = any (array[
  'shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy']));
-- the store identifier depends on the platform: Shopify keeps the myshopify domain; web stores a lower-case host name;
-- marketplaces a seller / shop identifier (they have no store address)
alter table public.store_connections drop constraint if exists store_connections_shop_domain_check;
alter table public.store_connections add constraint store_connections_shop_domain_check check (case
  when platform = 'shopify' then shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
  when platform in ('woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart')
    then length(shop_domain) between 4 and 253 and shop_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  else shop_domain ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' end);
alter table public.store_connections add column if not exists store_url text check (store_url is null or (store_url ~ '^https://[a-z0-9.-]+(:[0-9]{2,5})?(/[^\s]*)?$' and length(store_url) <= 300));
alter table public.store_connections add column if not exists detected_platform text check (detected_platform is null or detected_platform = any (array[
  'shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy', 'unknown']));
alter table public.store_connections add column if not exists scopes text[];
alter table public.store_connections add column if not exists external_store_id text check (external_store_id is null or length(external_store_id) between 1 and 120);
alter table public.store_connections add column if not exists last_sync_at timestamptz;
alter table public.store_connections add column if not exists last_error text check (last_error is null or length(last_error) <= 300);
alter table public.store_connections add column if not exists last_error_at timestamptz;
comment on table public.store_connections is 'Dropship stores (DS6 contract, widened by C0 to the planned platforms). Merchant-readable, no secrets (tokens live in store_credentials, service role only); written by the service role only. Push jobs run only while status = active. Status words: connecting (= pending), active (= connected), needs_reconnect (= error), disconnected.';

-- ───────────────────────── 2. store_credentials (service role only) ─────────────────────────
create table if not exists public.store_credentials (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.store_connections(id) on delete cascade,
  kind text not null check (kind in ('access_token', 'refresh_token', 'api_key', 'api_secret', 'consumer_key', 'consumer_secret', 'webhook_secret')),
  -- "v<key_version>.<iv>.<tag>.<ciphertext>" (base64url, AES-256-GCM): a plain token can never be stored by mistake
  ciphertext text not null check (length(ciphertext) <= 8192 and ciphertext ~ '^v[0-9]{1,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  key_version smallint not null check (key_version between 1 and 99),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_credentials_version_matches check (split_part(ciphertext, '.', 1) = 'v' || key_version::text),
  unique (connection_id, kind)
);
comment on table public.store_credentials is 'C0: encrypted store tokens / keys (AES-256-GCM, lib/crypto/token-box.ts, env CONNECTOR_TOKEN_KEY, key_version for rotation). SERVICE ROLE ONLY: no policy, no grant to anon / signed-in users; never sent to the browser, never logged. Deleted when the connection is disconnected.';

-- ───────────────────────── 3. store_oauth_states (service role only) ─────────────────────────
create table if not exists public.store_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform = any (array['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy'])),
  shop_domain text check (shop_domain is null or length(shop_domain) between 3 and 253),
  -- PKCE verifier (Etsy) sealed with the same token box, never plain
  verifier_ciphertext text check (verifier_ciphertext is null or verifier_ciphertext ~ '^v[0-9]{1,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  redirect_path text check (redirect_path is null or redirect_path ~ '^/account/dropship/[a-z0-9/_-]{0,120}$'),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.store_oauth_states is 'C0: one-time OAuth state for a store connection (only the SHA-256 of the nonce is kept; 10 minutes; used once). Service role only.';
create index if not exists store_oauth_states_expiry_idx on public.store_oauth_states (expires_at);

-- ───────────────────────── 4. "Request this platform" = the DS14 waiting list, widened ─────────────────────────
alter table public.dropship_channel_waitlist drop constraint if exists dropship_channel_waitlist_channel_check;
alter table public.dropship_channel_waitlist add constraint dropship_channel_waitlist_channel_check check (channel = any (array[
  'shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy',
  'salla', 'zid', 'shopee', 'lazada', 'other']));
alter table public.dropship_channel_waitlist add column if not exists requested_name text check (requested_name is null or (length(btrim(requested_name)) between 2 and 60 and requested_name !~ '[<>{}]'));
alter table public.dropship_channel_waitlist drop constraint if exists dropship_channel_waitlist_other_named;
alter table public.dropship_channel_waitlist add constraint dropship_channel_waitlist_other_named check (channel <> 'other' or requested_name is not null);

-- ───────────────────────── 5. store_orders.channel: every planned connector maps onto store_orders ─────────────────────────
alter table public.store_orders drop constraint if exists store_orders_channel_check;
alter table public.store_orders add constraint store_orders_channel_check check (channel = any (array[
  'shopify', 'woocommerce', 'csv', 'manual', 'api', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy']));

-- ───────────────────────── 6. CSV file connector: import history ─────────────────────────
create table if not exists public.dropship_csv_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'orders' check (kind in ('orders')),
  file_name text not null check (length(btrim(file_name)) between 1 and 120),
  file_sha text not null check (file_sha ~ '^[0-9a-f]{64}$'),
  total_rows integer not null check (total_rows between 0 and 100000),
  orders_count integer not null check (orders_count between 0 and 200),
  created_count integer not null default 0 check (created_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  created_at timestamptz not null default now()
);
comment on table public.dropship_csv_imports is 'C0: one row per merchant orders CSV import (file connector). The orders themselves go through ds_order_intake with channel csv; errors keep the CSV row numbers. Merchant reads its own rows; written only by c0_csv_orders_import().';
create index if not exists dropship_csv_imports_org_idx on public.dropship_csv_imports (org_id, created_at desc);

-- ───────────────────────── 7. carrier → store tracking company name ─────────────────────────
create table if not exists public.carrier_tracking_names (
  carrier text not null check (carrier in ('yunexpress', '4px')),
  platform text not null check (platform = any (array['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy', 'csv'])),
  -- NULL = not set yet (staff fill it in after checking the platform's list in a test store); the store then gets "Other" + our link
  company_name text check (company_name is null or (length(btrim(company_name)) between 1 and 80 and company_name !~ '[<>{}]')),
  -- our branded /t/<token> link (merchant brand only) is sent when true or when no carrier URL template is set
  use_branded_link boolean not null default true,
  url_template text check (url_template is null or (length(url_template) <= 300 and url_template ~ '^https://[^\s<>"]+$' and position('{tracking}' in url_template) > 0)),
  note text check (note is null or length(note) <= 300),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (carrier, platform)
);
comment on table public.carrier_tracking_names is 'C0: the tracking company name (and optional tracking URL template) sent to each store platform for a carrier. Seeded only where certain (YunExpress → "Other" + our branded /t/ link, per the plan); 4PX''s Shopify name is left for staff. Staff-only (RPC); buyers never see carrier names.';

-- ───────────────────────── 8. customs snapshot with every label ─────────────────────────
create table if not exists public.wh_shipment_customs (
  shipment_id uuid primary key references public.wh_shipments(id) on delete cascade,
  scope text not null check (scope in ('dropship', 'client_order', 'domestic')),
  store_order_id uuid references public.store_orders(id) on delete set null,
  declared_usd_cents bigint check (declared_usd_cents is null or declared_usd_cents > 0),
  duty_type text check (duty_type is null or duty_type in ('DDP', 'DAP')),
  policy_id uuid references public.customs_policy(id) on delete set null,
  block_below_pct numeric,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint wh_shipment_customs_dropship_value check (scope <> 'dropship' or (declared_usd_cents is not null and duty_type is not null and store_order_id is not null))
);
comment on table public.wh_shipment_customs is 'C0: the customs check result saved with the label (declared value = what the buyer paid, locked; item lines with English description, HS, qty, unit value, origin, weight, battery / liquid / magnet; the policy in force; a snapshot of the store order without buyer name or address). Never changed after the label.';
create index if not exists wh_shipment_customs_order_idx on public.wh_shipment_customs (store_order_id);

-- ───────────────────────── 9. RLS + grants for the new tables ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['store_credentials', 'store_oauth_states', 'dropship_csv_imports', 'carrier_tracking_names', 'wh_shipment_customs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
  -- secrets: service role only (no policy at all → signed-in users see nothing even with a grant). Supabase's default privileges
  -- give new tables ALL to service_role (incl. TRUNCATE / REFERENCES / TRIGGER): reset to exactly what the connectors need
  foreach t in array array['store_credentials', 'store_oauth_states'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists dropship_csv_imports_own_read on public.dropship_csv_imports;
create policy dropship_csv_imports_own_read on public.dropship_csv_imports for select to authenticated using (org_id in (select public.my_org_ids()));
-- column grant: merchants read their own history but not created_by (who imported is not exposed; c0_file_page never returns it)
revoke select on table public.dropship_csv_imports from authenticated;
grant select (id, org_id, kind, file_name, file_sha, total_rows, orders_count, created_count, duplicate_count, failed_count, errors, division_id, created_at)
  on table public.dropship_csv_imports to authenticated;
drop policy if exists wh_shipment_customs_staff_read on public.wh_shipment_customs;
create policy wh_shipment_customs_staff_read on public.wh_shipment_customs for select to authenticated
  using (exists (select 1 from public.wh_shipments s where s.id = shipment_id and public.wh_can('dispatch', s.warehouse_code)));
grant select on table public.wh_shipment_customs to authenticated;

-- ───────────────────────── 10. platform lists ─────────────────────────
create or replace function public.c0_platforms(p_kind text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'store' then array['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy']
    when 'web' then array['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart']
    when 'request' then array['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy',
                              'salla', 'zid', 'shopee', 'lazada', 'other']
    when 'channel' then array['shopify', 'woocommerce', 'csv', 'manual', 'api', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy']
    else array[]::text[] end
$$;

-- ───────────────────────── 11. credential triggers: audit without the value; wipe on disconnect ─────────────────────────
create or replace function public.c0_credential_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform write_audit('store_credential.deleted', 'store_connections', old.connection_id::text, jsonb_build_object('kind', old.kind, 'key_version', old.key_version));
    return old;
  end if;
  -- the ciphertext is never written to the audit log
  perform write_audit('store_credential.saved', 'store_connections', new.connection_id::text,
    jsonb_build_object('kind', new.kind, 'key_version', new.key_version, 'expires_at', new.expires_at, 'rotated', tg_op = 'UPDATE'));
  return new;
end $$;
drop trigger if exists trg_c0_credential_audit on public.store_credentials;
create trigger trg_c0_credential_audit after insert or update or delete on public.store_credentials
  for each row execute function public.c0_credential_audit();

create or replace function public.c0_connection_wipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'disconnected' and old.status is distinct from 'disconnected' then
    delete from public.store_credentials where connection_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_c0_connection_wipe on public.store_connections;
create trigger trg_c0_connection_wipe after update of status on public.store_connections
  for each row execute function public.c0_connection_wipe();

-- ───────────────────────── 12. the customs value is locked ─────────────────────────
create or replace function public.c0_declared_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.declared_usd_cents is distinct from old.declared_usd_cents or new.buyer_unit_price_cents is distinct from old.buyer_unit_price_cents then
    raise exception 'DECLARED_VALUE_LOCKED: the customs value is what the buyer paid and is locked when the order comes in.';
  end if;
  return new;
end $$;
drop trigger if exists trg_c0_declared_locked on public.store_order_items;
create trigger trg_c0_declared_locked before update of declared_usd_cents, buyer_unit_price_cents on public.store_order_items
  for each row execute function public.c0_declared_locked();

create or replace function public.c0_customs_snapshot_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'CUSTOMS_SNAPSHOT_LOCKED: the customs snapshot of a label never changes; void the label and make a new one.';
end $$;
drop trigger if exists trg_c0_customs_snapshot_locked on public.wh_shipment_customs;
create trigger trg_c0_customs_snapshot_locked before update on public.wh_shipment_customs
  for each row execute function public.c0_customs_snapshot_locked();

-- ───────────────────────── 13. customs check (before every label) ─────────────────────────
create or replace function public.c0_customs_problem(p_code text, p_sku text, p_message text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('code', p_code, 'sku', p_sku, 'message', case when p_sku is null then p_message else p_sku || ': ' || p_message end)
$$;

create or replace function public.wh_customs_check(p_parcel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  w public.warehouses;
  so public.store_orders;
  pol public.customs_policy;
  r record;
  v_scope text;
  v_fx numeric;
  v_duty text;
  v_problems jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_checks jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_desc text;
  v_hs text;
  v_wt integer;
  v_val bigint;
  v_unit bigint;
  v_store bigint;
begin
  select * into p from public.wh_parcels where id = p_parcel;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  select * into o from public.wh_orders where id = p.order_id;
  select * into w from public.warehouses where code = o.warehouse_code;
  select * into pol from public.customs_policy where status = 'active' order by version desc limit 1;
  v_scope := case when o.source = 'dropship' then 'dropship' when o.ship_country = w.country then 'domestic' else 'client_order' end;
  if v_scope = 'dropship' then
    select * into so from public.store_orders where id = o.store_order_id;
    v_fx := case when so.buyer_currency = 'USD' then coalesce(so.fx_rate_to_usd, 1.0) else so.fx_rate_to_usd end;
    -- DS16: countries sold duties-paid only (US) always ship DDP, whatever the order says
    v_duty := case when public.ds16_country_rule(so.destination_country) ->> 'incoterm' = 'DDP' then 'DDP' else coalesce(so.incoterm, 'DDP') end;
  end if;

  for r in
    select l.sku, l.name, l.unit_weight_g, i.qty::bigint as pqty, im.id as im_id, im.hs_code, im.hs_verified, im.origin_country, im.weight_g as im_weight,
           im.has_battery, im.has_liquid, im.has_magnet, im.has_powder, s.soi_qty, s.decl, s.store_minor, s.priced_qty, s.title
      from public.wh_parcel_items i
      join public.wh_order_lines l on l.id = i.line_id
      left join public.item_master im on im.id = l.item_id
      left join lateral (select sum(x.qty)::bigint as soi_qty, sum(x.declared_usd_cents)::bigint as decl,
                                sum(x.buyer_unit_price_cents * x.qty)::bigint as store_minor,
                                sum(case when x.buyer_unit_price_cents is not null then x.qty end)::bigint as priced_qty,
                                min(x.title_snapshot) as title
                           from public.store_order_items x
                          where o.store_order_id is not null and x.store_order_id = o.store_order_id and x.item_id = l.item_id) s on true
     where i.parcel_id = p.id
     order by l.sku
  loop
    v_checks := '[]'::jsonb;
    v_desc := btrim(coalesce(case when v_scope = 'dropship' then r.title end, r.name, ''));
    v_hs := regexp_replace(coalesce(r.hs_code, ''), '[^0-9]', '', 'g');
    v_wt := coalesce(nullif(r.unit_weight_g, 0), nullif(r.im_weight, 0));
    v_val := null;
    v_unit := null;
    if v_scope = 'dropship' then
      if coalesce(r.soi_qty, 0) = 0 then
        v_problems := v_problems || public.c0_customs_problem('NOT_ON_STORE_ORDER', r.sku, 'this item is not on the store order, so there is no price the buyer paid to declare.');
      else
        -- the declared value is what the buyer paid (store_order_items.declared_usd_cents, locked at intake), split by the parcel's quantity
        v_val := round(r.decl::numeric * r.pqty / r.soi_qty)::bigint;
        v_unit := round(r.decl::numeric / r.soi_qty)::bigint;
        if v_val <= 0 then
          v_problems := v_problems || public.c0_customs_problem('ZERO_VALUE', r.sku, 'the price the buyer paid is 0, so there is no customs value. Check the order with the merchant.');
        end if;
        if pol.block_below_pct is not null then
          if r.store_minor is null or coalesce(r.priced_qty, 0) <> r.soi_qty then
            v_problems := v_problems || public.c0_customs_problem('STORE_PRICE_UNKNOWN', r.sku, 'the store price is not known, so the customs policy minimum can''t be checked.');
          else
            v_store := round(r.store_minor::numeric * v_fx)::bigint;
            if r.decl::numeric < v_store::numeric * pol.block_below_pct / 100.0 then
              v_problems := v_problems || public.c0_customs_problem('BELOW_POLICY', r.sku,
                format('the declared value (US$%s) is below %s %% of the store price (US$%s).', to_char(r.decl / 100.0, 'FM999999990.00'), trim_scale(pol.block_below_pct), to_char(v_store / 100.0, 'FM999999990.00')));
            end if;
          end if;
        end if;
      end if;
    end if;
    -- English: Latin letters, no Chinese / Japanese / Korean / Arabic / Hebrew / Cyrillic / Indic / Thai text, no control characters
    if length(v_desc) not between 3 and 200 or v_desc !~ '[A-Za-z]{2}' or v_desc ~ '[[:cntrl:]]'
       or v_desc ~ '[\u0400-\u04FF\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0FFF\u1100-\u11FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]' then
      v_checks := v_checks || public.c0_customs_problem('DESCRIPTION_NOT_ENGLISH', r.sku, 'the customs description must be in English (Latin letters, 3 to 200 characters, no Chinese, Arabic or other non-Latin text).');
    end if;
    if r.im_id is null then
      v_checks := v_checks || public.c0_customs_problem('ITEM_DATA_MISSING', r.sku, 'the item data (HS code, origin, weight, battery / liquid / magnet) is missing.');
    else
      if v_hs !~ '^[0-9]{6,10}$' then
        v_checks := v_checks || public.c0_customs_problem('HS_MISSING', r.sku, 'the HS code is missing.');
      elsif not coalesce(r.hs_verified, false) then
        v_checks := v_checks || public.c0_customs_problem('HS_NOT_VERIFIED', r.sku, 'the HS code is not verified by staff yet.');
      end if;
      if coalesce(r.origin_country::text, '') !~ '^[A-Z]{2}$' then
        v_checks := v_checks || public.c0_customs_problem('ORIGIN_MISSING', r.sku, 'the country of origin is missing.');
      end if;
    end if;
    if v_wt is null then
      v_checks := v_checks || public.c0_customs_problem('WEIGHT_MISSING', r.sku, 'the weight per item is missing.');
    end if;
    if coalesce(r.pqty, 0) <= 0 then
      v_checks := v_checks || public.c0_customs_problem('QTY_MISSING', r.sku, 'the quantity is missing.');
    end if;
    -- Dropship parcels are blocked; client orders (3PL) get the same checks as warnings (their customer price is not in Warehouse OS);
    -- domestic parcels need no customs data
    if v_scope = 'dropship' then v_problems := v_problems || v_checks;
    elsif v_scope = 'client_order' then v_warnings := v_warnings || v_checks; end if;
    v_total := v_total + coalesce(v_val, 0);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'sku', r.sku, 'description_en', v_desc, 'hs_code', nullif(v_hs, ''), 'hs_verified', coalesce(r.hs_verified, false), 'qty', r.pqty,
      'unit_value_cents', v_unit, 'value_cents', v_val, 'origin_country', r.origin_country, 'unit_weight_g', v_wt,
      'battery', coalesce(r.has_battery, false), 'liquid', coalesce(r.has_liquid, false), 'magnet', coalesce(r.has_magnet, false), 'powder', coalesce(r.has_powder, false)));
  end loop;
  if jsonb_array_length(v_items) = 0 and v_scope = 'dropship' then
    v_problems := v_problems || public.c0_customs_problem('NO_ITEMS', null, 'the parcel has no items.');
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_problems) = 0,
    'scope', v_scope,
    'currency', 'USD',
    'declared_usd_cents', case when v_scope = 'dropship' then v_total end,
    'duty_type', v_duty,
    'incoterm', so.incoterm,
    'destination_country', coalesce(so.destination_country::text, o.ship_country::text),
    'policy', jsonb_build_object('id', pol.id, 'version', pol.version, 'block_below_pct', pol.block_below_pct,
                                 'block_below_label', case when pol.block_below_pct is null then 'not set' else trim_scale(pol.block_below_pct)::text || ' %' end,
                                 'shipping_in_declared_value', pol.shipping_in_declared_value),
    'problems', v_problems,
    'warnings', v_warnings,
    'items', v_items,
    -- the store order as it was when the label was made (no buyer name, phone or address: those are deleted 60 days after delivery)
    'store_order', case when so.id is not null then jsonb_build_object(
      'id', so.id, 'order_number', so.order_number, 'channel', so.channel, 'external_order_name', so.external_order_name,
      'buyer_currency', so.buyer_currency, 'fx_rate_to_usd', so.fx_rate_to_usd, 'destination_country', so.destination_country, 'incoterm', so.incoterm,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('model_no', x.model_no, 'title', x.title_snapshot, 'variant', x.variant_label, 'qty', x.qty,
                                                            'buyer_unit_price_cents', x.buyer_unit_price_cents, 'declared_usd_cents', x.declared_usd_cents) order by x.model_no, x.id)
                           from public.store_order_items x where x.store_order_id = so.id), '[]'::jsonb)) end,
    'checked_at', now());
end $$;
comment on function public.wh_customs_check(uuid) is 'C0: customs check of one parcel (called by wh_label_plan before the carrier is asked and again by wh_label_record). Dropship: declared value = what the buyer paid (locked), never the cost; blocks on any missing item data and below customs_policy.block_below_pct when set.';

-- ───────────────────────── 14. merchant: store link result + "Request this platform" ─────────────────────────
-- The link check itself runs on the server (lib/connectors/detect.ts: DNS-resolved SSRF guard, timeout, redirects re-checked).
-- This records the outcome (audit) and answers what the merchant already has for that host. A link alone gives no access and
-- creates no connection row (a row would let anyone claim someone else's store address).
create or replace function public.c0_store_link_result(p_host text, p_platform text, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_host text := lower(btrim(coalesce(p_host, '')));
  v_platform text := lower(btrim(coalesce(p_platform, 'unknown')));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  c public.store_connections;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  if length(v_host) not between 3 and 253 or v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'INVALID_INPUT: Enter your store address, like mystore.com.';
  end if;
  if not (v_platform = any (public.c0_platforms('store')) or v_platform = 'unknown') then v_platform := 'unknown'; end if;
  if v_outcome not in ('found', 'unknown', 'unreachable', 'blocked', 'marketplace') then raise exception 'INVALID_INPUT: Unknown result.'; end if;
  select * into c from public.store_connections x
   where x.org_id = v_org and x.status <> 'disconnected'
     and (x.shop_domain = v_host or lower(split_part(regexp_replace(coalesce(x.store_url, ''), '^https://', ''), '/', 1)) = v_host)
   order by x.created_at desc limit 1;
  perform write_audit('ds_channel.store_link_checked', 'organizations', v_org::text,
    jsonb_build_object('org_id', v_org, 'host', v_host, 'platform', v_platform, 'outcome', v_outcome, 'connection_id', c.id));
  return jsonb_build_object(
    'host', v_host, 'platform', v_platform, 'outcome', v_outcome,
    'connection', case when c.id is null then null else jsonb_build_object('id', c.id, 'platform', c.platform, 'status', c.status,
                       'last_error', coalesce(c.last_error, c.status_reason), 'last_sync_at', c.last_sync_at, 'connected_at', c.connected_at) end,
    -- "already linked" state (States-Stores): another account has this store; no detail about who
    'linked_elsewhere', c.id is null and exists (select 1 from public.store_connections x where x.org_id <> v_org and x.status <> 'disconnected'
                                                  and (x.shop_domain = v_host or lower(split_part(regexp_replace(coalesce(x.store_url, ''), '^https://', ''), '/', 1)) = v_host)),
    'requested', exists (select 1 from public.dropship_channel_waitlist w where w.org_id = v_org and w.channel = v_platform));
end $$;

create or replace function public.c0_request_platform(p_platform text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  perform ds_assert_role(v_org, 'setup');
  if not (v_platform = any (public.c0_platforms('request'))) then raise exception 'BAD_CHANNEL: Choose a platform from the list.'; end if;
  if v_platform = 'other' and (v_name is null or length(v_name) not between 2 and 60 or v_name ~ '[<>{}]') then
    raise exception 'INVALID_INPUT: Type the platform name (2 to 60 characters).';
  end if;
  if v_platform <> 'other' then v_name := null; end if;
  insert into public.dropship_channel_waitlist (org_id, channel, requested_name) values (v_org, v_platform, v_name)
  on conflict (org_id, channel) do update set requested_name = coalesce(excluded.requested_name, public.dropship_channel_waitlist.requested_name);
  perform write_audit('ds_channel.platform_requested', 'dropship_channel_waitlist', v_org::text || ':' || v_platform,
    jsonb_build_object('org_id', v_org, 'platform', v_platform, 'name', v_name));
  return jsonb_build_object('requested', true, 'platform', v_platform);
end $$;

-- ───────────────────────── 15. merchant: CSV file connector ─────────────────────────
create or replace function public.c0_file_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  v_role := ds_team_role(v_org, auth.uid());
  return jsonb_build_object(
    'orders_on', dropship_feature_on('orders'),
    'can_import', dropship_feature_on('orders') and (v_role is null or ds_role_allows(v_role, 'pay_orders')),
    'imports', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'file_name', i.file_name, 'created_at', i.created_at, 'total_rows', i.total_rows,
                                  'orders', i.orders_count, 'created', i.created_count, 'duplicates', i.duplicate_count, 'failed', i.failed_count,
                                  'errors', i.errors) order by i.created_at desc)
                          from (select * from public.dropship_csv_imports x where x.org_id = v_org order by x.created_at desc limit 20) i), '[]'::jsonb));
end $$;

-- p_orders: [{ "rows": [csv row numbers], "order": <the ds_order_intake JSON> }] (built by lib/connectors/csv.ts);
-- p_parse_errors: [{ "row": n, "message": "..." }] found while reading the file (kept in the history with the row numbers)
create or replace function public.c0_csv_orders_import(p_file_name text, p_file_sha text, p_total_rows integer, p_orders jsonb, p_parse_errors jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
  v_name text := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[^A-Za-z0-9 ._()-]', '', 'g')), 120);
  v_o jsonb;
  v_res jsonb;
  v_rows jsonb;
  v_results jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_n integer;
  v_ok integer := 0;
  v_dup integer := 0;
  v_failed integer := 0;
  v_msg text;
begin
  perform ds_feature_guard('stores');
  perform ds_feature_guard('orders');
  v_org := ds_org_read();
  perform ds_assert_role(v_org, 'pay_orders');
  perform assert_dropship_new_activity(v_org);
  if v_name = '' then v_name := 'orders.csv'; end if;
  if coalesce(p_file_sha, '') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT: The file could not be read. Choose it again.'; end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then raise exception 'INVALID_INPUT: No orders in the file.'; end if;
  v_n := jsonb_array_length(p_orders);
  if v_n = 0 then raise exception 'INVALID_INPUT: No orders in the file.'; end if;
  if v_n > 200 then raise exception 'TOO_MANY: Up to 200 orders per file. Split the file and import each part.'; end if;
  if p_parse_errors is not null and jsonb_typeof(p_parse_errors) = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('rows', jsonb_build_array(greatest(0, least(100000, coalesce((e ->> 'row')::int, 0)))),
                                                 'message', left(coalesce(e ->> 'message', 'Row not read.'), 300))), '[]'::jsonb)
      into v_errors from (select e from jsonb_array_elements(p_parse_errors) e limit 200) x;
  end if;
  for v_o in select * from jsonb_array_elements(p_orders) loop
    v_rows := case when jsonb_typeof(v_o -> 'rows') = 'array' then v_o -> 'rows' else '[]'::jsonb end;
    begin
      if jsonb_typeof(v_o -> 'order') <> 'object' then raise exception 'INVALID_INPUT: This order could not be read.'; end if;
      v_res := public.ds_order_intake_core(v_org, 'csv', v_o -> 'order', false);
    exception when others then
      v_res := jsonb_build_object('ok', false, 'code', coalesce(substring(sqlerrm from '^([A-Z_]+):'), 'INVALID_INPUT'),
                                  'message', regexp_replace(sqlerrm, '^[A-Z_]+:\s*', ''));
    end;
    if coalesce((v_res ->> 'ok')::boolean, false) and coalesce((v_res ->> 'ignored')::boolean, false) then
      v_res := jsonb_build_object('ok', false, 'code', 'NO_OCTOPUS_ITEMS', 'message', 'None of these SKUs is an Octopus product (use the DS variant model no., like DS-000001-01).');
    end if;
    if coalesce((v_res ->> 'ok')::boolean, false) then
      if coalesce((v_res ->> 'duplicate')::boolean, false) then v_dup := v_dup + 1; else v_ok := v_ok + 1; end if;
    else
      v_failed := v_failed + 1;
      v_msg := left(coalesce(v_res ->> 'message', v_res ->> 'code', 'Not imported.'), 300);
      if jsonb_array_length(v_errors) < 200 then v_errors := v_errors || jsonb_build_array(jsonb_build_object('rows', v_rows, 'message', v_msg)); end if;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'rows', v_rows, 'external_order_id', left(v_o #>> '{order,external_order_id}', 64), 'ok', coalesce((v_res ->> 'ok')::boolean, false),
      'duplicate', coalesce((v_res ->> 'duplicate')::boolean, false), 'code', v_res ->> 'code', 'message', left(v_res ->> 'message', 300),
      'order_number', v_res ->> 'order_number', 'hold_code', v_res ->> 'hold_code')));
  end loop;
  insert into public.dropship_csv_imports (org_id, kind, file_name, file_sha, total_rows, orders_count, created_count, duplicate_count, failed_count, errors)
  values (v_org, 'orders', v_name, p_file_sha, greatest(0, least(100000, coalesce(p_total_rows, 0))), v_n, v_ok, v_dup, v_failed, v_errors)
  returning id into v_id;
  perform write_audit('ds_csv.orders_imported', 'dropship_csv_imports', v_id::text,
    jsonb_build_object('org_id', v_org, 'file', v_name, 'orders', v_n, 'created', v_ok, 'duplicates', v_dup, 'failed', v_failed));
  return jsonb_build_object('id', v_id, 'orders', v_n, 'created', v_ok, 'duplicates', v_dup, 'failed', v_failed, 'results', v_results, 'errors', v_errors);
end $$;

-- product feed CSV (the merchant's own copy: DS model numbers, the merchant's titles / prices; never supplier or Octopus cost)
create or replace function public.c0_product_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  return coalesce((select jsonb_agg(f order by f.model_no, f.variant_model_no) from (
    select p.model_no, v.model_no as variant_model_no, coalesce(nullif(lv.store_sku, ''), v.model_no) as sku,
           coalesce(nullif(l.title, ''), p.title) as title, coalesce(l.description, '') as description,
           (select string_agg(e.key || ': ' || e.value, ' / ' order by e.key) from jsonb_each_text(coalesce(v.options, '{}'::jsonb)) e) as option_text,
           lv.price_minor, lv.compare_at_minor, (select r.store_currency from public.dropship_pricing_rules r where r.org_id = v_org) as currency,
           im.weight_g, l.product_type, l.vendor, array_to_string(l.tags, ', ') as tags
      from public.dropship_import_list il
      join public.dropship_products p on p.id = il.product_id
      join public.dropship_variants v on v.product_id = p.id and (il.variant_id is null or il.variant_id = v.id)
      left join public.item_master im on im.id = v.item_id
      left join public.dropship_listings l on l.org_id = v_org and l.product_id = p.id
      left join public.dropship_listing_variants lv on lv.listing_id = l.id and lv.variant_id = v.id
     where il.org_id = v_org and public.ds_product_visible(p, v_org) and coalesce(lv.include, true)
     group by p.model_no, v.model_no, lv.store_sku, l.title, p.title, l.description, v.options, lv.price_minor, lv.compare_at_minor, im.weight_g, l.product_type, l.vendor, l.tags
  ) f), '[]'::jsonb);
end $$;

-- tracking CSV export: one row per shipped store order; the company name comes from carrier_tracking_names ("Other" when unset)
-- and the link is the merchant-branded /t/<token> page (never a carrier page, never a carrier name on its own)
create or replace function public.c0_tracking_export(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  if v_to < v_from or v_to - v_from > 366 then raise exception 'INVALID_INPUT: Choose up to one year.'; end if;
  return coalesce((select jsonb_agg(t order by t.shipped_at desc, t.order_number) from (
    select so.order_number, so.external_order_id, so.external_order_name, so.channel, wo.shipped_at, wo.tracking_token,
           (select string_agg(s.tracking_no, ' ' order by s.created_at) from public.wh_shipments s where s.order_id = wo.id and s.status <> 'voided') as tracking_numbers,
           coalesce((select n.company_name from public.wh_shipments s
                       join public.carrier_tracking_names n on n.carrier = s.carrier
                                                          and n.platform = case when so.channel = any (public.c0_platforms('store')) then so.channel else 'csv' end
                      where s.order_id = wo.id and s.status <> 'voided' order by s.created_at limit 1), 'Other') as tracking_company
      from public.store_orders so
      join public.wh_orders wo on wo.store_order_id = so.id
     where so.org_id = v_org and wo.shipped_at is not null and wo.shipped_at >= v_from and wo.shipped_at < v_to + 1
  ) t), '[]'::jsonb);
end $$;

-- ───────────────────────── 16. staff: connector health, requested platforms, tracking names ─────────────────────────
create or replace function public.c0_connector_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ds12_health_can_view() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'can_edit', is_admin() or dropship_can_edit(division_id_of('DS')),
    'checked_at', now(),
    'platforms', (select jsonb_agg(jsonb_build_object(
        'platform', pl,
        'connected', (select count(*) from public.store_connections c where c.platform = pl and c.status = 'active'),
        'connecting', (select count(*) from public.store_connections c where c.platform = pl and c.status = 'connecting'),
        'needs_reconnect', (select count(*) from public.store_connections c where c.platform = pl and c.status = 'needs_reconnect'),
        'failures_24h', (select count(*) from public.integration_logs g where g.integration_code = pl and g.status >= 400 and g.created_at > now() - interval '24 hours')
                      + (select count(*) from public.webhook_inbox w where w.source = pl and w.received_at > now() - interval '24 hours' and (w.error is not null or not w.signature_ok)),
        'last_error', (select e.msg from (
            select c.last_error_at as at, left(coalesce(c.last_error, c.status_reason), 200) as msg from public.store_connections c
             where c.platform = pl and coalesce(c.last_error, c.status_reason) is not null and c.status <> 'active'
            union all
            select g.created_at, left(g.summary, 200) from public.integration_logs g where g.integration_code = pl and g.status >= 400
          ) e order by e.at desc nulls last limit 1),
        'last_error_at', (select max(x.at) from (
            select c.last_error_at as at from public.store_connections c where c.platform = pl and c.last_error is not null
            union all select g.created_at from public.integration_logs g where g.integration_code = pl and g.status >= 400) x),
        'requested', (select count(*) from public.dropship_channel_waitlist w where w.channel = pl)) order by ord)
      from unnest(public.c0_platforms('store')) with ordinality as u(pl, ord)),
    'csv', (select jsonb_build_object('imports_24h', count(*), 'failed_rows_24h', coalesce(sum(i.failed_count), 0), 'orders_24h', coalesce(sum(i.created_count), 0),
                                      'merchants_30d', (select count(distinct x.org_id) from public.dropship_csv_imports x where x.created_at > now() - interval '30 days'),
                                      'last_error', (select left(x.errors -> -1 ->> 'message', 200) from public.dropship_csv_imports x where x.failed_count > 0 order by x.created_at desc limit 1))
              from public.dropship_csv_imports i where i.created_at > now() - interval '24 hours'),
    'requested', coalesce((select jsonb_agg(r order by r.merchants desc, r.platform) from (
        select w.channel as platform, count(*) as merchants, max(w.created_at) as last_at,
               (select jsonb_agg(distinct x.requested_name) from public.dropship_channel_waitlist x where x.channel = 'other' and w.channel = 'other') as names
          from public.dropship_channel_waitlist w group by w.channel) r), '[]'::jsonb),
    'tracking_names', coalesce((select jsonb_agg(jsonb_build_object('carrier', n.carrier, 'platform', n.platform, 'company_name', n.company_name,
                                  'use_branded_link', n.use_branded_link, 'url_template', n.url_template, 'note', n.note, 'updated_at', n.updated_at) order by n.carrier, n.platform)
                                from public.carrier_tracking_names n), '[]'::jsonb),
    'poll', jsonb_build_object(
      'targets', (select count(*) from public.wh_tracking_poll_targets(500)),
      'last_run', (select jsonb_build_object('at', g.created_at, 'status', g.status, 'summary', left(g.summary, 200))
                     from public.integration_logs g where g.integration_code = 'carrier-tracking-poll' order by g.created_at desc limit 1)));
end $$;

create or replace function public.c0_tracking_name_save(p_carrier text, p_platform text, p_company text, p_url_template text, p_use_branded_link boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.carrier_tracking_names;
  v_after public.carrier_tracking_names;
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_url text := nullif(btrim(coalesce(p_url_template, '')), '');
begin
  if auth.uid() is null or not is_staff() or distributor_restricted() or not (is_admin() or dropship_can_edit(division_id_of('DS'))) then
    raise exception 'FORBIDDEN: Dropship editors and admins change tracking company names.';
  end if;
  if p_carrier is null or p_carrier not in ('yunexpress', '4px') then raise exception 'INVALID_INPUT: Unknown carrier.'; end if;
  if p_platform is null or not (p_platform = any (public.c0_platforms('store')) or p_platform = 'csv') then raise exception 'INVALID_INPUT: Unknown store platform.'; end if;
  if v_company is not null and (length(v_company) > 80 or v_company ~ '[<>{}]') then raise exception 'INVALID_INPUT: The company name must be 1 to 80 characters.'; end if;
  if v_url is not null and (length(v_url) > 300 or v_url !~ '^https://[^\s<>"]+$' or position('{tracking}' in v_url) = 0) then
    raise exception 'INVALID_INPUT: The tracking link must start with https:// and contain {tracking}.';
  end if;
  select * into v_before from public.carrier_tracking_names where carrier = p_carrier and platform = p_platform;
  insert into public.carrier_tracking_names (carrier, platform, company_name, use_branded_link, url_template, note, updated_by, updated_at)
  values (p_carrier, p_platform, v_company, coalesce(p_use_branded_link, true), v_url, left(nullif(btrim(coalesce(p_note, '')), ''), 300), auth.uid(), now())
  on conflict (carrier, platform) do update set company_name = excluded.company_name, use_branded_link = excluded.use_branded_link,
    url_template = excluded.url_template, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_after;
  perform write_audit('c0.tracking_name_saved', 'carrier_tracking_names', p_carrier || ':' || p_platform,
    jsonb_build_object('before', case when v_before.carrier is null then null else jsonb_build_object('company_name', v_before.company_name, 'url_template', v_before.url_template, 'use_branded_link', v_before.use_branded_link) end,
                       'after', jsonb_build_object('company_name', v_after.company_name, 'url_template', v_after.url_template, 'use_branded_link', v_after.use_branded_link)));
  return jsonb_build_object('carrier', v_after.carrier, 'platform', v_after.platform, 'company_name', v_after.company_name,
                            'use_branded_link', v_after.use_branded_link, 'url_template', v_after.url_template);
end $$;

-- ───────────────────────── 17. scheduled carrier tracking poll (pg_cron → pg_net → /api/cron/carrier-tracking-poll) ─────────────────────────
-- Same pattern as job_dispatch_outbox: URL + CRON_SECRET from Vault (octopus_app_url / octopus_cron_secret). No live label on the way
-- (no live carrier account yet) → no HTTP call at all.
create or replace function public.job_carrier_tracking_poll()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_id bigint;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then return null; end if;
  if not exists (select 1 from public.wh_tracking_poll_targets(1)) then return 0; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'octopus_app_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'octopus_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return null; end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := $3)'
    into v_id
    using rtrim(v_url, '/') || '/api/cron/carrier-tracking-poll',
          jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'x-trace-id', 'cron-carrier-poll-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
          55000;
  return v_id;
end $$;
comment on function public.job_carrier_tracking_poll() is 'C0: pg_cron → pg_net GET /api/cron/carrier-tracking-poll (lib/carriers/poll.ts pollCarrierTracking) when a live label is on the way. URL + CRON_SECRET from Vault.';

-- ───────────────────────── 18. replaced functions (installed text + C0 patches marked "C0") ─────────────────────────
-- get_dropship_order_quote(jsonb,text,text,text,text,numeric,text)
CREATE OR REPLACE FUNCTION public.get_dropship_order_quote(p_lines jsonb, p_country text, p_method text, p_incoterm text DEFAULT 'DDP'::text, p_buyer_currency text DEFAULT 'USD'::text, p_fx_rate_to_usd numeric DEFAULT NULL::numeric, p_quote_mode text DEFAULT 'order'::text)
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
  -- C0: the declared value is only ever what the buyer paid; estimates use a separate duty basis
  v_basis_cents bigint;
  v_basis_total bigint := 0;
  v_buyer_price_missing boolean := false;
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
      -- C0: a catalogue quote is an ESTIMATE with no declared value (the product price is the merchant's cost, never a customs value)
      v_all_buyer_prices_supplied := false;
      v_line_declared_usd_cents := null;
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
      -- C0: no buyer price → no declared value (never the cost price); create_dropship_store_order refuses such a line
      v_all_buyer_prices_supplied := false;
      v_buyer_price_missing := true;
      v_line_declared_usd_cents := null;
    end if;

    -- the duty ESTIMATE basis: what the buyer paid when known, otherwise the product price (estimate only, never declared)
    v_basis_cents := coalesce(v_line_declared_usd_cents, v_line_prod_cents);
    v_basis_total := v_basis_total + v_basis_cents;
    v_declared_value_usd_cents := v_declared_value_usd_cents + coalesce(v_line_declared_usd_cents, 0);
    v_duty_lines := v_duty_lines || jsonb_build_array(
      jsonb_build_object('hs_code', v_im.hs_code, 'declared_usd_cents', v_basis_cents)
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
      if v_basis_total <= v_de_min then
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
    'declared_value_usd_cents', case when v_quote_mode = 'catalogue' or v_buyer_price_missing then null else v_declared_value_usd_cents end,
    'duty_estimate_basis_usd_cents', v_basis_total,
    'buyer_price_missing', v_quote_mode = 'order' and v_buyer_price_missing,
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

-- create_dropship_store_order(uuid,text,text,text,text,text,jsonb,text,text,numeric,text,text,jsonb,boolean)
CREATE OR REPLACE FUNCTION public.create_dropship_store_order(p_org_id uuid, p_channel text, p_external_order_id text, p_external_order_name text, p_buyer_name text, p_buyer_phone text, p_shipping_address jsonb, p_destination_country text, p_buyer_currency text, p_fx_rate_to_usd numeric, p_shipping_method text, p_incoterm text, p_lines jsonb, p_is_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- C0 (customs): the declared value is ALWAYS what the buyer paid. A line without the buyer's price is refused with a clear
  -- reason; it never falls back to the product (cost) price.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if not ((v_line ? 'buyer_paid_cents' and v_line -> 'buyer_paid_cents' <> 'null'::jsonb)
            or (v_line ? 'buyer_unit_price_cents' and v_line -> 'buyer_unit_price_cents' <> 'null'::jsonb)) then
      return jsonb_build_object('ok', false, 'code', 'BUYER_PRICE_MISSING',
        'message', format('The price the buyer paid is missing for %s. The customs value must be what the buyer paid, so this order was not taken. Send it again with the buyer''s price.',
                          coalesce((select dv.model_no from public.dropship_variants dv where dv.id = (v_line ->> 'variant_id')::uuid), 'a line')));
    end if;
  end loop;

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
      -- C0: unreachable (refused above); never the cost price
      raise exception 'BUYER_PRICE_MISSING: no buyer price for %', v_var.model_no;
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
end $function$;

-- ds_order_intake_core(uuid,text,jsonb,boolean)
CREATE OR REPLACE FUNCTION public.ds_order_intake_core(p_org uuid, p_channel text, p_order jsonb, p_test boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_channel not in ('shopify', 'woocommerce', 'csv', 'manual', 'api', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart', 'ebay', 'tiktok_shop', 'amazon', 'walmart', 'etsy') then raise exception 'INVALID_INPUT: Unknown sales channel.'; end if;
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
      -- C0: the line total the buyer paid (after discounts) is the customs value when the store sends it
      'buyer_paid_cents', nullif(v_line ->> 'buyer_paid_cents', '')::bigint,
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
end $function$;

-- ds_channel_waitlist(text,boolean)
CREATE OR REPLACE FUNCTION public.ds_channel_waitlist(p_channel text, p_join boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  perform ds_assert_role(v_org, 'setup');
  if p_channel is null or not (p_channel = any (public.c0_platforms('request'))) or p_channel = 'other' then raise exception 'BAD_CHANNEL: This channel is not available.'; end if;
  if p_join then
    insert into public.dropship_channel_waitlist (org_id, channel) values (v_org, p_channel) on conflict do nothing;
  else
    delete from public.dropship_channel_waitlist where org_id = v_org and channel = p_channel;
  end if;
  perform write_audit('ds_channel.waitlist_' || case when p_join then 'joined' else 'left' end, 'dropship_channel_waitlist', v_org::text || ':' || p_channel, null);
  return jsonb_build_object('joined', p_join);
end $function$;

-- ds_channels_page()
CREATE OR REPLACE FUNCTION public.ds_channels_page()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_plan jsonb;
  v_conn public.store_connections;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  v_plan := ds_plan_state(v_org);
  select * into v_conn from public.store_connections where org_id = v_org and platform = 'shopify' and status <> 'disconnected' order by created_at desc limit 1;
  return jsonb_build_object(
    'shopify', case when v_conn.id is null then jsonb_build_object('status', 'not_connected')
                    else jsonb_build_object('status', v_conn.status, 'shop', v_conn.shop_domain, 'connected_at', v_conn.connected_at) end,
    -- C0: every connected / connecting store of any platform (no secrets: tokens live in store_credentials)
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'platform', c.platform, 'shop', c.shop_domain, 'store_url', c.store_url, 'status', c.status,
                                'last_error', coalesce(c.last_error, c.status_reason), 'last_sync_at', c.last_sync_at, 'connected_at', c.connected_at) order by c.created_at desc)
                              from public.store_connections c where c.org_id = v_org and c.status <> 'disconnected'), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(s.channel, jsonb_build_object('sync_stock', s.sync_stock, 'sync_prices', s.sync_prices,
                                                                                'send_tracking', s.send_tracking, 'cancel_on_store_cancel', s.cancel_on_store_cancel))
                            from public.dropship_channel_settings s where s.org_id = v_org), '{}'::jsonb),
    'waitlist', coalesce((select jsonb_agg(w.channel order by w.channel) from public.dropship_channel_waitlist w where w.org_id = v_org), '[]'::jsonb),
    'plan_name', v_plan ->> 'plan_name', 'stores_limit', nullif(v_plan ->> 'stores_limit', '')::integer, 'stores_used', coalesce((v_plan #>> '{usage,stores}')::integer, 0),
    'billing_enabled', (v_plan ->> 'billing_enabled')::boolean);
end $function$;

-- wh_label_plan(uuid)
CREATE OR REPLACE FUNCTION public.wh_label_plan(p_parcel uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.wh_parcels;
  o public.wh_orders;
  w public.warehouses;
  v_dg text[];
  v_pick jsonb;
  v_exc uuid;
  a public.wh_carrier_accounts;
  v_ref text;
  v_customs jsonb;
begin
  p := public.wh_label_parcel_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  -- C0: customs check BEFORE the carrier is asked (declared value = what the buyer paid, locked; English description, verified HS,
  -- qty, unit value, origin, weight per item, battery / liquid / magnet; customs policy minimum when set)
  v_customs := public.wh_customs_check(p.id);
  if not coalesce((v_customs ->> 'ok')::boolean, false) then
    perform write_audit('wh_label.customs_blocked', 'wh_orders', o.id::text,
      jsonb_build_object('code', o.code, 'parcel', p.seq, 'problems', v_customs -> 'problems'));
    return jsonb_build_object('ok', false, 'code', 'CUSTOMS_BLOCKED', 'customs', v_customs,
      'message', 'Customs check: ' || (select string_agg(x ->> 'message', ' ') from jsonb_array_elements(v_customs -> 'problems') x));
  end if;
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
    'customs', v_customs,
    'items', coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.name, 'qty', i.qty, 'unit_weight_g', l.unit_weight_g) order by l.sku)
                         from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id where i.parcel_id = p.id), '[]'::jsonb));
end $function$;

-- wh_label_record(uuid,uuid,uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.wh_label_record(p_parcel uuid, p_service uuid, p_rule_version uuid, p_tracking_no text, p_label_path text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_customs jsonb;
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
  -- C0: the customs check again at the moment the label is recorded (the plan is not trusted)
  v_customs := public.wh_customs_check(p.id);
  if not coalesce((v_customs ->> 'ok')::boolean, false) then
    raise exception 'CUSTOMS_BLOCKED: %', (select string_agg(x ->> 'message', ' ') from jsonb_array_elements(v_customs -> 'problems') x);
  end if;
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
  -- C0: the customs snapshot (incl. the store order as it is now) is saved with the label and never changes
  insert into public.wh_shipment_customs (shipment_id, scope, store_order_id, declared_usd_cents, duty_type, policy_id, block_below_pct, snapshot)
  values (v_id, v_customs ->> 'scope', o.store_order_id, (v_customs ->> 'declared_usd_cents')::bigint, v_customs ->> 'duty_type',
          (v_customs #>> '{policy,id}')::uuid, (v_customs #>> '{policy,block_below_pct}')::numeric, v_customs);
  perform write_audit('wh_label.created', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'parcel', p.seq, 'label', v_code, 'carrier', a.carrier, 'service', s.code, 'tracking_no', v_no,
                       'sandbox', a.mode = 'sandbox', 'reason', p_reason,
                       'customs_scope', v_customs ->> 'scope', 'declared_usd_cents', (v_customs ->> 'declared_usd_cents')::bigint, 'duty_type', v_customs ->> 'duty_type'));
  -- a "no carrier" exception of this parcel is answered by the label
  perform public.wh_exceptions_resolve_where('parcel_id', p.id, array['carrier'], format('Label %s made with %s', v_no, s.name), 'label_made');
  v_state := public.wh_order_label_state(o.id);
  return jsonb_build_object('id', v_id, 'code', v_code, 'tracking_no', v_no, 'sandbox', a.mode = 'sandbox', 'order_status', v_state,
                            'service_name', s.name, 'carrier', a.carrier, 'parcel', p.seq,
                            'declared_usd_cents', (v_customs ->> 'declared_usd_cents')::bigint, 'duty_type', v_customs ->> 'duty_type');
end $function$;


-- ───────────────────────── 19. grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array['c0_platforms(text)', 'c0_credential_audit()', 'c0_connection_wipe()', 'c0_declared_locked()', 'c0_customs_snapshot_locked()',
    'c0_customs_problem(text, text, text)', 'wh_customs_check(uuid)', 'c0_store_link_result(text, text, text)', 'c0_request_platform(text, text)', 'c0_file_page()',
    'c0_csv_orders_import(text, text, integer, jsonb, jsonb)', 'c0_product_feed()', 'c0_tracking_export(date, date)', 'c0_connector_health()',
    'c0_tracking_name_save(text, text, text, text, boolean, text)', 'job_carrier_tracking_poll()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- RPCs for signed-in users (each checks its own permission: merchant organisation + feature + team role, or staff permission)
  foreach f in array array['c0_store_link_result(text, text, text)', 'c0_request_platform(text, text)', 'c0_file_page()',
    'c0_csv_orders_import(text, text, integer, jsonb, jsonb)', 'c0_product_feed()', 'c0_tracking_export(date, date)', 'c0_connector_health()',
    'c0_tracking_name_save(text, text, text, text, boolean, text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────────────────── 20. seeds (only where certain) ─────────────────────────
insert into public.carrier_tracking_names (carrier, platform, company_name, use_branded_link, url_template, note) values
  ('yunexpress', 'shopify', 'Other', true, null, 'Plan: send "Other" with our branded /t/ tracking link until the YunExpress entry is verified in a test store.'),
  ('4px', 'shopify', null, true, null, 'Not set: staff enter the exact 4PX name from Shopify''s tracking company list after checking it in a test store. Until then "Other" + our /t/ link.')
on conflict (carrier, platform) do nothing;

-- ───────────────────────── 21. schedule (pg_cron, where installed) ─────────────────────────
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-carrier-tracking-poll') then
      perform cron.unschedule('octopus-carrier-tracking-poll');
    end if;
    perform cron.schedule('octopus-carrier-tracking-poll', '*/30 * * * *', 'select public.job_carrier_tracking_poll()');
  end if;
end $$;
