-- Octopus Dropship · Release 6 · Step 14 (v3-only screens): supplier portal for the partner-fulfilment path, staff supplier
-- approvals + partner-supplier overview, sales partners, merchant Integrations / Connect a channel (settings only), staff
-- Invoicing view and product Docs. DRAFT — installs as the next free number (248 when written). Renumber at install.
--
-- Owner decisions applied: Shopify and every other store-channel connection (WooCommerce, TikTok Shop, Wix, eBay) and YunExpress
-- live keys come LAST. Nothing here connects to anything: connect / test / reconnect / disconnect are refused with a reason
-- (ds_channel_action), settings are only saved. Supplier payouts and partner login / payouts are not designed: nothing is built.
--
-- NOTE (found by running the DB test): dropship_products.supplier_id / supplier_sku / unit_cost_cents are frozen, so a product's supplier is its
-- variants' supplier_product_id (Sourcing). Orders find their supplier that way; approved supplier products become supplier-less drafts that staff link.
--
-- Nothing installed is replaced EXCEPT one CHECK constraint: dropship_order_events_kind_check gets the extra kind 'shipped'
-- (the down restores the installed list exactly). Everything else is new and the down drops it.
--
--  1. Tables (RLS on everywhere; anon has nothing; staff / supplier tables have NO grant for signed-in users (read and written only
--     through the definer RPCs below); the two merchant tables are SELECT-only for the owner organisation):
--       dropship_supplier_submissions  supplier submissions (new product, price change, stock update, bulk upload) + staff decision
--       dropship_partner_orders        one row per (store order, supplier) on the partner path: to ship / shipped / problem / cancelled
--       dropship_partners / _merchants / _rules / _commissions   sales partners, merchants they brought, commission rules, accruals
--       dropship_channel_settings, dropship_channel_waitlist     merchant channel settings and the Amazon waiting list (merchant)
--       dropship_product_documents     certificates / test reports / HS documents (private bucket dropship-documents)
--  2. Supplier RPCs (ds_sup_*): own supplier only (suppliers.user_id = caller, verified, portal switch on). Distributors assigned to a
--     supplier (is_my_supplier) are NOT suppliers here: they never see buyer addresses.
--  3. Staff RPCs (ds_staff_*, ds_partner_*, ds_doc_*, ds_supplier_*): Dropship division edit / view, Finance, suppliers permission.
--  4. Merchant RPCs (ds_channels_page, ds_channel_settings_save, ds_channel_action, ds_channel_waitlist): own organisation, feature 'stores'.
--  5. Commission: percent of the plan fee actually charged (dropship_plan_charges.amount_cents) or a fixed amount per merchant, for N months.
--     Plan fees are OFF today, so nothing accrues and the screens say "not applicable" — never a made-up number.

-- ───────────────────────── 1. Tables ─────────────────────────
create sequence if not exists public.dropship_partner_seq;

create table if not exists public.dropship_supplier_submissions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  kind text not null check (kind in ('new_product', 'price_change', 'stock_update', 'bulk_upload')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'auto_approved', 'approved', 'changes_asked', 'rejected')),
  summary text not null check (length(btrim(summary)) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  row_count integer check (row_count is null or row_count between 1 and 5000),
  supplier_product_id uuid references public.supplier_products(id) on delete cascade,
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  review_note text check (review_note is null or length(review_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  product_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dropship_supplier_submissions_supplier_idx on public.dropship_supplier_submissions (supplier_id, status);
create index if not exists dropship_supplier_submissions_status_idx on public.dropship_supplier_submissions (status, created_at);
comment on table public.dropship_supplier_submissions is 'Supplier portal submissions (Step 14). Staff review in Approvals; approving a product makes a DRAFT dropship product (the existing publish checklist still gates publishing).';

create table if not exists public.dropship_partner_orders (
  id uuid primary key default gen_random_uuid(),
  store_order_id uuid not null references public.store_orders(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'to_ship' check (status in ('to_ship', 'shipped', 'problem', 'cancelled')),
  ship_by date,
  carrier text check (carrier is null or carrier in ('yunexpress', '4px', 'other')),
  tracking_no text check (tracking_no is null or tracking_no ~ '^[A-Za-z0-9-]{6,40}$'),
  shipment_id uuid references public.shipments(id) on delete set null,
  shipped_at timestamptz,
  slip_at timestamptz,
  problem_note text check (problem_note is null or length(problem_note) <= 500),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_order_id, supplier_id),
  constraint dropship_partner_orders_shipped_has_tracking check (status <> 'shipped' or (carrier is not null and tracking_no is not null and shipped_at is not null))
);
create index if not exists dropship_partner_orders_supplier_idx on public.dropship_partner_orders (supplier_id, status);

create table if not exists public.dropship_partners (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('PTR-' || lpad(nextval('public.dropship_partner_seq')::text, 4, '0')),
  name text not null check (length(btrim(name)) between 2 and 120),
  kind text not null default 'agency' check (kind in ('agency', 'influencer', 'other')),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 200),
  status text not null default 'invited' check (status in ('invited', 'active', 'paused', 'ended')),
  note text check (note is null or length(note) <= 500),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists dropship_partners_email_key on public.dropship_partners (lower(contact_email)) where status <> 'ended';

create table if not exists public.dropship_partner_merchants (
  partner_id uuid not null references public.dropship_partners(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade unique,
  attached_at timestamptz not null default now(),
  attached_by uuid references auth.users(id) on delete set null default auth.uid(),
  primary key (partner_id, org_id)
);

create table if not exists public.dropship_partner_rules (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.dropship_partners(id) on delete cascade,
  kind text not null check (kind in ('percent_of_plan_fee', 'fixed_per_merchant')),
  rate_bps integer check (rate_bps is null or rate_bps between 0 and 10000),
  fixed_cents bigint check (fixed_cents is null or fixed_cents between 0 and 10000000),
  months integer not null check (months between 1 and 60),
  payout text not null default 'monthly' check (payout = 'monthly'),
  set_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint dropship_partner_rules_shape check (
    (kind = 'percent_of_plan_fee' and rate_bps is not null and fixed_cents is null)
    or (kind = 'fixed_per_merchant' and fixed_cents is not null and rate_bps is null))
);
create unique index if not exists dropship_partner_rules_partner_key on public.dropship_partner_rules (partner_id) where partner_id is not null;
create unique index if not exists dropship_partner_rules_default_key on public.dropship_partner_rules ((true)) where partner_id is null;

create table if not exists public.dropship_partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.dropship_partners(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  charge_id uuid unique references public.dropship_plan_charges(id) on delete set null,
  kind text not null check (kind in ('percent_of_plan_fee', 'fixed_per_merchant')),
  base_cents bigint not null check (base_cents >= 0),
  rate_bps integer,
  fixed_cents bigint,
  amount_cents bigint not null check (amount_cents >= 0),
  period_start timestamptz not null,
  status text not null default 'accrued' check (status in ('accrued', 'void')),
  created_at timestamptz not null default now()
);
create index if not exists dropship_partner_commissions_partner_idx on public.dropship_partner_commissions (partner_id, org_id);

create table if not exists public.dropship_channel_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('shopify', 'woocommerce', 'tiktok_shop', 'wix', 'ebay')),
  sync_stock boolean not null default true,
  sync_prices boolean not null default true,
  send_tracking boolean not null default true,
  cancel_on_store_cancel boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (org_id, channel)
);

create table if not exists public.dropship_channel_waitlist (
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('amazon', 'woocommerce', 'tiktok_shop', 'wix', 'ebay')),
  created_at timestamptz not null default now(),
  primary key (org_id, channel)
);

create table if not exists public.dropship_product_documents (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.dropship_products(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  kind text not null check (kind in ('certificate', 'test_report', 'hs_document', 'msds', 'other')),
  title text not null check (length(btrim(title)) between 2 and 160),
  doc_number text check (doc_number is null or length(doc_number) <= 80),
  issuer text check (issuer is null or length(issuer) <= 120),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  expires_on date,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f]{32}\.(pdf|png|jpg)$'),
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  review_note text check (review_note is null or length(review_note) <= 500),
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dropship_product_documents_product_idx on public.dropship_product_documents (product_id);

do $$
declare t text;
begin
  foreach t in array array['dropship_supplier_submissions', 'dropship_partner_orders', 'dropship_partners', 'dropship_partner_merchants', 'dropship_partner_rules',
    'dropship_partner_commissions', 'dropship_channel_settings', 'dropship_channel_waitlist', 'dropship_product_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
  -- merchant tables: the owner organisation reads its own rows; every write goes through ds_channel_* RPCs
  foreach t in array array['dropship_channel_settings', 'dropship_channel_waitlist'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select public.my_org_ids()))', t || '_own_read', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- the order timeline gets one extra kind: the merchant sees "Shipped" with the tracking number (never the supplier)
alter table public.dropship_order_events drop constraint if exists dropship_order_events_kind_check;
alter table public.dropship_order_events add constraint dropship_order_events_kind_check
  check (kind = any (array['received', 'held', 'hold_cleared', 'charged', 'awaiting_funds', 'charge_failed', 'expired', 'cancel_accepted', 'cancel_rejected',
    'address_updated', 'address_problem', 'refunded', 'handed_to_warehouse', 'protection_released', 'shipped']::text[]));

-- partner-shipped parcels whose carrier is not YunExpress / 4PX use this (inactive) carrier row, like 4PX today
insert into public.carriers (code, name, active) values ('other', 'Other carrier', false) on conflict (code) do nothing;

-- private bucket for certificates and test reports (uploaded and read by the server with the service role only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dropship-documents', 'dropship-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- ───────────────────────── 2. Internal helpers (not callable by signed-in users) ─────────────────────────
create or replace function public.ds14_staff_can(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when p_kind = 'edit' then coalesce(dropship_can_edit(division_id_of('DS')), false) and coalesce(staff_aal_ok(), false)
    when p_kind = 'view' then coalesce(is_staff(), false) and coalesce(staff_aal_ok(), false)
                              and (coalesce(in_division(division_id_of('DS')), false) or coalesce(is_admin(), false) or can('finance', 'view') or can('suppliers', 'view'))
    when p_kind = 'suppliers_edit' then can('suppliers', 'edit') and coalesce(staff_aal_ok(), false)
    when p_kind = 'suppliers_view' then can('suppliers', 'view') and coalesce(staff_aal_ok(), false)
    when p_kind = 'finance' then (can('finance', 'view') or coalesce(is_admin(), false)) and coalesce(staff_aal_ok(), false)
    when p_kind = 'commission' then coalesce(saas_finance_can(), false)
    else false end
$$;

create or replace function public.ds14_assert(p_kind text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.ds14_staff_can(p_kind) then raise exception 'FORBIDDEN: Octopus Dropship staff only.'; end if;
end $$;

-- the signed-in supplier user's supplier (verified, not archived, portal switch on). Distributors are NOT suppliers here.
create or replace function public.ds14_supplier()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'SUPPLIER_ONLY: Sign in with your supplier account.'; end if;
  select s.id into v
    from public.suppliers s join public.supplier_switches w on w.supplier_id = s.id
   where s.user_id = auth.uid() and s.archived_at is null and s.verified and w.portal_login
   limit 1;
  if v is null then raise exception 'SUPPLIER_ONLY: This account has no active supplier portal. Ask your Octopus contact.'; end if;
  return v;
end $$;

create or replace function public.ds14_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.site_settings where key = 'dropship_supplier_rules'), '{}'::jsonb)
$$;

-- "12.50" → 1250 ; anything else → null
create or replace function public.ds14_cents(p text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case when btrim(coalesce(p, '')) ~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then round(btrim(p)::numeric * 100)::bigint end
$$;

create or replace function public.ds14_int(p text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case when btrim(coalesce(p, '')) ~ '^[0-9]{1,7}$' then btrim(p)::integer end
$$;

create or replace function public.ds14_num(p text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when btrim(coalesce(p, '')) ~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then btrim(p)::numeric end
$$;

create or replace function public.ds14_bool(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p, ''))) when 'yes' then true when 'y' then true when 'true' then true when '1' then true
                                            when 'no' then false when 'n' then false when 'false' then false when '0' then false when '' then false else null end
$$;

-- plain-language problems of one normalised product; strict = needed to submit, not strict = enough to save a draft
create or replace function public.ds14_validate_product(p jsonb, p_strict boolean)
returns text[]
language plpgsql
stable
set search_path = public
as $$
declare
  v text[] := '{}';
  vr jsonb;
  skus text[] := '{}';
  s text;
  hs text;
begin
  if length(btrim(coalesce(p ->> 'name', ''))) not between 2 and 200 then v := v || ('Product name: enter 2 to 200 characters.')::text; end if;
  if coalesce(p ->> 'supplier_sku', '') !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,59}$' then v := v || ('Model number: 2 to 60 letters, digits, dot, dash or slash.')::text; end if;
  if not p_strict then return v; end if;
  if length(btrim(coalesce(p ->> 'category', ''))) not between 2 and 60 then v := v || ('Category: choose one.')::text; end if;
  if length(btrim(coalesce(p ->> 'description', ''))) < 10 then v := v || ('Description: write at least 10 characters.')::text; end if;
  if coalesce(jsonb_typeof(p -> 'variants'), '') <> 'array' or jsonb_array_length(p -> 'variants') = 0 then
    v := v || ('Variants: add at least one variant.')::text;
  else
    for vr in select * from jsonb_array_elements(p -> 'variants') loop
      s := lower(coalesce(vr ->> 'sku', ''));
      if length(btrim(coalesce(vr ->> 'option', ''))) not between 1 and 60 then v := v || ('Variant option: enter 1 to 60 characters (use Default for a single variant).')::text; end if;
      if s !~ '^[a-z0-9][a-z0-9._/-]{1,59}$' then v := v || (('Variant SKU "' || left(coalesce(vr ->> 'sku', ''), 30) || '": 2 to 60 letters, digits, dot, dash or slash.'))::text;
      elsif s = any (skus) then v := v || (('Variant SKU "' || left(vr ->> 'sku', 30) || '" is used twice.'))::text;
      end if;
      skus := skus || s;
      if coalesce((vr ->> 'cost_cents')::bigint, 0) <= 0 then v := v || ('Variant cost: enter an amount above 0, like 6.90.')::text; end if;
      if coalesce((vr ->> 'stock')::integer, -1) < 0 then v := v || ('Variant stock: enter 0 or more.')::text; end if;
      if coalesce((vr ->> 'weight_g')::integer, 0) <= 0 then v := v || ('Variant weight: enter grams above 0.')::text; end if;
    end loop;
  end if;
  if (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'images') = 'array' then p -> 'images' else '[]'::jsonb end) i where i ~ '^https://[^\s]{4,255}$') < 3 then
    v := v || ('Images: add at least 3 image links that start with https://.')::text;
  end if;
  if coalesce((p #>> '{package,weight_g}')::integer, 0) <= 0 then v := v || ('Package weight: enter grams above 0.')::text; end if;
  if coalesce((p #>> '{package,length_cm}')::numeric, 0) <= 0 or coalesce((p #>> '{package,width_cm}')::numeric, 0) <= 0 or coalesce((p #>> '{package,height_cm}')::numeric, 0) <= 0 then
    v := v || ('Package size: enter length, width and height in cm above 0.')::text;
  end if;
  hs := regexp_replace(coalesce(p #>> '{customs,hs_code}', ''), '[ .]', '', 'g');
  if hs !~ '^[0-9]{6,10}$' then v := v || ('HS code: enter 6 to 10 digits.')::text; end if;
  if coalesce(p #>> '{customs,origin}', '') !~ '^[A-Z]{2}$' then v := v || ('Country of origin: use a 2-letter code, like CN.')::text; end if;
  if length(btrim(coalesce(p #>> '{customs,description_en}', ''))) not between 3 and 300 then v := v || ('Customs description: write 3 to 300 characters in English.')::text; end if;
  if coalesce((p #>> '{terms,moq}')::integer, 0) < 1 then v := v || ('Minimum order quantity: enter 1 or more.')::text; end if;
  if coalesce((p #>> '{terms,lead_days}')::integer, 0) not between 1 and 180 then v := v || ('Lead time: enter 1 to 180 days.')::text; end if;
  return v;
exception when invalid_text_representation or numeric_value_out_of_range then
  return array_append(v, 'A number field has letters or is too large. Check cost, stock, weight and size.'::text);
end $$;

-- the product a supplier typed or uploaded: the model number must not belong to another product or open submission
create or replace function public.ds14_sku_clash(p_sku text, p_exclude uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.dropship_products d where lower(d.supplier_sku) = lower(p_sku))
      or exists (select 1 from public.supplier_products sp where lower(sp.supplier_model) = lower(p_sku))
      or exists (select 1 from public.dropship_supplier_submissions s
                  where s.kind = 'new_product' and s.status not in ('rejected') and lower(s.payload ->> 'supplier_sku') = lower(p_sku)
                    and s.id is distinct from p_exclude)
      or exists (select 1 from public.dropship_supplier_submissions s, jsonb_array_elements(s.payload -> 'products') pr
                  where s.kind = 'bulk_upload' and s.status not in ('rejected') and lower(pr ->> 'supplier_sku') = lower(p_sku)
                    and s.id is distinct from p_exclude)
$$;

-- bulk rows (template columns, all text) → { products: [normalised…], problems: [{row, problem}] }; row 1 is the header row
create or replace function public.ds14_bulk_group(p_rows jsonb, p_exclude uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
  prob text[];
  pr jsonb;
  prods jsonb := '[]'::jsonb;
  problems jsonb := '[]'::jsonb;
  seen_var text[] := '{}';
  vsku text;
  idx integer;
  p text;
  imgs jsonb;
  good_rows integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'EMPTY_FILE: The spreadsheet has no rows.'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'TOO_MANY_ROWS: Upload up to 500 rows at a time.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    imgs := coalesce((select jsonb_agg(btrim(i)) from unnest(string_to_array(coalesce(r ->> 'image_links', ''), '|')) i where btrim(i) <> ''), '[]'::jsonb);
    pr := jsonb_build_object(
      'name', btrim(coalesce(r ->> 'product_name', '')), 'category', btrim(coalesce(r ->> 'category', '')), 'brand', nullif(btrim(coalesce(r ->> 'brand', '')), ''),
      'description', btrim(coalesce(r ->> 'description', '')), 'supplier_sku', btrim(coalesce(r ->> 'model_number', '')), 'images', imgs,
      'variants', jsonb_build_array(jsonb_build_object('option', coalesce(nullif(btrim(coalesce(r ->> 'variant_option', '')), ''), 'Default'),
        'sku', btrim(coalesce(r ->> 'variant_sku', r ->> 'sku', '')), 'cost_cents', ds14_cents(r ->> 'cost'), 'stock', ds14_int(r ->> 'stock'), 'weight_g', ds14_int(r ->> 'weight_g'))),
      'package', jsonb_build_object('weight_g', ds14_int(r ->> 'weight_g'), 'length_cm', ds14_num(r ->> 'length_cm'),
        'width_cm', ds14_num(r ->> 'width_cm'), 'height_cm', ds14_num(r ->> 'height_cm')),
      'handling_days', ds14_int(r ->> 'handling_days'),
      'customs', jsonb_build_object('hs_code', btrim(coalesce(r ->> 'hs_code', '')), 'origin', upper(btrim(coalesce(r ->> 'country_of_origin', ''))),
        'description_en', btrim(coalesce(r ->> 'product_name', '')), 'battery', ds14_bool(r ->> 'battery'), 'liquid', ds14_bool(r ->> 'liquid')),
      'terms', jsonb_build_object('moq', 1, 'lead_days', coalesce(ds14_int(r ->> 'handling_days'), 7)));
    prob := ds14_validate_product(pr, true);
    if (pr #>> '{customs,battery}') is null then prob := prob || ('Battery: write yes or no.')::text; end if;
    if (pr #>> '{customs,liquid}') is null then prob := prob || ('Liquid: write yes or no.')::text; end if;
    vsku := lower(pr #>> '{variants,0,sku}');
    if vsku <> '' and vsku = any (seen_var) then prob := prob || ('Variant SKU is already used in an earlier row.')::text; end if;
    seen_var := seen_var || vsku;
    if (pr ->> 'supplier_sku') ~ '^[A-Za-z0-9]' and ds14_sku_clash(pr ->> 'supplier_sku', p_exclude)
       and not exists (select 1 from jsonb_array_elements(prods) q where lower(q ->> 'supplier_sku') = lower(pr ->> 'supplier_sku')) then
      prob := prob || ('Model number is already used by another product.')::text;
    end if;
    if cardinality(prob) > 0 then
      foreach p in array prob loop problems := problems || jsonb_build_object('row', n + 1, 'problem', p); end loop;
    else
      good_rows := good_rows + 1;
      idx := (select i - 1 from jsonb_array_elements(prods) with ordinality t(q, i) where lower(q ->> 'supplier_sku') = lower(pr ->> 'supplier_sku') limit 1);
      if idx is null then
        prods := prods || jsonb_build_array(pr);
      else
        prods := jsonb_set(prods, array[idx::text, 'variants'], (prods -> idx -> 'variants') || (pr -> 'variants'));
      end if;
    end if;
  end loop;
  return jsonb_build_object('products', prods, 'problems', problems, 'good_rows', good_rows, 'total_rows', n);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'BAD_NUMBER: A length, width or height is not a number. Use digits and a dot, like 12.5.';
end $$;

-- ───────────────────────── 3. Supplier RPCs ─────────────────────────
create or replace function public.ds_sup_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  s public.suppliers;
begin
  select * into s from public.suppliers where id = v_sup;
  return jsonb_build_object(
    'supplier_name', s.legal_name,
    'supplier_code', s.code,
    'to_ship', (select count(*) from public.dropship_partner_orders po join public.store_orders so on so.id = po.store_order_id
                 where po.supplier_id = v_sup and po.status = 'to_ship' and so.cancelled_at is null and so.merchant_status not in ('cancelled', 'refunded')),
    'out_of_stock', (select count(*) from public.supplier_products sp where sp.supplier_id = v_sup and sp.stock_qty = 0),
    'in_review', (select count(*) from public.dropship_supplier_submissions x where x.supplier_id = v_sup and x.status = 'submitted'),
    'attention', coalesce((
      select jsonb_agg(a.t order by a.o) from (
        select 1 o, (p.title || ' is out of stock. Merchants cannot sell it until you update stock.') t
          from public.supplier_products sp join public.products p on p.id = sp.product_id where sp.supplier_id = v_sup and sp.stock_qty = 0 and p.status::text <> 'archived'
        union all
        select 2, x.summary || ': staff asked for changes' || coalesce(' (' || nullif(x.review_note, '') || ')', '') || '.'
          from public.dropship_supplier_submissions x where x.supplier_id = v_sup and x.status = 'changes_asked'
      ) a), '[]'::jsonb));
end $$;

create or replace function public.ds_sup_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_sup uuid := ds14_supplier();
begin
  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sp.id, 'title', p.title, 'model', coalesce(sp.supplier_model, p.external_id), 'status', p.status::text, 'stock_qty', sp.stock_qty,
        'rejection_reason', p.rejection_reason,
        'variants', greatest(1, (select count(*) from public.dropship_variants dv where dv.supplier_product_id = sp.id)),
        'in_dropship', exists (select 1 from public.dropship_variants dv join public.dropship_products dp on dp.id = dv.product_id where dv.supplier_product_id = sp.id and dp.status = 'active'),
        'prices', coalesce((select jsonb_agg(jsonb_build_object('id', pp.id, 'incoterm', pp.incoterm, 'moq', pp.moq_tier_min, 'variant', pp.variant_label,
                                                               'price_minor', pp.price_minor, 'currency', pp.currency) order by pp.moq_tier_min, pp.variant_label)
                              from public.supplier_product_prices pp
                             where pp.supplier_id = sp.supplier_id and pp.product_id = sp.product_id and not pp.is_superseded and (pp.valid_to is null or pp.valid_to >= current_date)), '[]'::jsonb),
        'updated_at', sp.updated_at) order by p.title)
      from public.supplier_products sp join public.products p on p.id = sp.product_id
     where sp.supplier_id = v_sup and p.status::text <> 'archived'), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'summary', x.summary, 'review_note', x.review_note,
                                          'row_count', x.row_count, 'updated_at', x.updated_at, 'editable', x.status in ('draft', 'changes_asked')) order by x.updated_at desc)
        from public.dropship_supplier_submissions x where x.supplier_id = v_sup and x.kind in ('new_product', 'bulk_upload', 'price_change')), '[]'::jsonb),
    'auto_price_pct', (ds14_rules() ->> 'price_auto_pct')::integer);
end $$;

create or replace function public.ds_sup_stock_update(p_supplier_product_id uuid, p_qty integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  sp public.supplier_products;
  p public.products;
begin
  if not exists (select 1 from public.supplier_switches w where w.supplier_id = v_sup and w.product_upload) then
    raise exception 'UPLOAD_OFF: Product changes are switched off for your account. Ask your Octopus contact.';
  end if;
  if p_qty is null or p_qty < 0 or p_qty > 10000000 then raise exception 'BAD_STOCK: Enter a stock number from 0 to 10,000,000.'; end if;
  select * into sp from public.supplier_products where id = p_supplier_product_id and supplier_id = v_sup for update;
  if sp.id is null then raise exception 'NOT_FOUND: This product is not yours.'; end if;
  select * into p from public.products where id = sp.product_id;
  perform public.set_supplier_product_stock(sp.id, p_qty);
  insert into public.dropship_supplier_submissions (supplier_id, kind, status, summary, payload, supplier_product_id, reviewed_at)
  values (v_sup, 'stock_update', 'auto_approved', left('Stock · ' || p.title, 200), jsonb_build_object('from_qty', sp.stock_qty, 'to_qty', p_qty), sp.id, now());
  return jsonb_build_object('stock_qty', p_qty, 'status', 'auto_approved');
end $$;

create or replace function public.ds_sup_price_change(p_price_id uuid, p_new_minor bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  pp public.supplier_product_prices;
  sp public.supplier_products;
  p public.products;
  v_pct numeric;
  v_auto integer := (ds14_rules() ->> 'price_auto_pct')::integer;
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
  v_status := case when v_auto is not null and v_pct <= v_auto then 'auto_approved' else 'submitted' end;
  insert into public.dropship_supplier_submissions (supplier_id, kind, status, summary, payload, supplier_product_id, reviewed_at)
  values (v_sup, 'price_change', v_status, left('Price · ' || p.title, 200),
          jsonb_build_object('price_id', pp.id, 'old_minor', pp.price_minor, 'new_minor', p_new_minor, 'currency', pp.currency, 'pct', v_pct), sp.id,
          case when v_status = 'auto_approved' then now() end)
  returning id into v_sub;
  if v_status = 'auto_approved' then perform public.ds14_apply_price(v_sub); end if;
  return jsonb_build_object('id', v_sub, 'status', v_status, 'pct', v_pct);
end $$;

-- applies an approved (or auto-approved) price change: the old tier row is superseded, a new row starts today
create or replace function public.ds14_apply_price(p_sub uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.dropship_supplier_submissions;
  old public.supplier_product_prices;
  v_new bigint;
begin
  select * into s from public.dropship_supplier_submissions where id = p_sub;
  select * into old from public.supplier_product_prices where id = (s.payload ->> 'price_id')::uuid for update;
  if old.id is null or old.is_superseded then raise exception 'PRICE_GONE: This price row changed since the supplier sent it. Ask them to send it again.'; end if;
  v_new := (s.payload ->> 'new_minor')::bigint;
  if old.valid_from >= current_date then
    update public.supplier_product_prices set price_minor = v_new where id = old.id;
  else
    update public.supplier_product_prices set is_superseded = true, valid_to = current_date where id = old.id;
    insert into public.supplier_product_prices (supplier_id, product_id, incoterm, moq_tier_min, variant_label, price_minor, currency, valid_from)
    values (old.supplier_id, old.product_id, old.incoterm, old.moq_tier_min, old.variant_label, v_new, old.currency, current_date);
  end if;
  perform write_audit('ds_supplier_price.applied', 'dropship_supplier_submissions', p_sub::text,
                      jsonb_build_object('from', old.price_minor, 'to', v_new, 'auto', s.status = 'auto_approved'));
end $$;

-- save a new product (draft) or send it for review; p_id = an existing draft / "changes asked" submission of this supplier
create or replace function public.ds_sup_save_product(p_id uuid, p jsonb, p_submit boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  s public.dropship_supplier_submissions;
  v_prob text[];
  v_id uuid;
  v_sku text;
begin
  if not exists (select 1 from public.supplier_switches w where w.supplier_id = v_sup and w.product_upload) then
    raise exception 'UPLOAD_OFF: Product upload is switched off for your account. Ask your Octopus contact.';
  end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'BAD_INPUT: The product form is empty.'; end if;
  if pg_column_size(p) > 60000 then raise exception 'TOO_BIG: The product form is too large.'; end if;
  -- never trust keys the form does not own (no supplier id, status or review fields in the payload)
  p := jsonb_strip_nulls(p) - 'supplier_id' - 'status' - 'review_note';
  if p_id is not null then
    select * into s from public.dropship_supplier_submissions where id = p_id and supplier_id = v_sup and kind = 'new_product' for update;
    if s.id is null then raise exception 'NOT_FOUND: This product is not yours.'; end if;
    if s.status not in ('draft', 'changes_asked') then raise exception 'LOCKED: This product is already %. You can edit it when staff ask for changes.', replace(s.status, '_', ' '); end if;
  end if;
  v_prob := ds14_validate_product(p, p_submit);
  v_sku := p ->> 'supplier_sku';
  if cardinality(v_prob) = 0 and v_sku is not null and ds14_sku_clash(v_sku, p_id) then v_prob := v_prob || ('Model number is already used by another product.')::text; end if;
  if cardinality(v_prob) > 0 then raise exception 'INVALID: %', array_to_string(v_prob, ' '); end if;
  if p_id is null then
    insert into public.dropship_supplier_submissions (supplier_id, kind, status, summary, payload)
    values (v_sup, 'new_product', case when p_submit then 'submitted' else 'draft' end, left((p ->> 'name') || ' · ' || (p ->> 'supplier_sku'), 200), p)
    returning id into v_id;
  else
    update public.dropship_supplier_submissions
       set payload = p, summary = left((p ->> 'name') || ' · ' || (p ->> 'supplier_sku'), 200), status = case when p_submit then 'submitted' else 'draft' end,
           review_note = case when p_submit then null else review_note end, updated_at = now()
     where id = p_id returning id into v_id;
  end if;
  perform write_audit(case when p_submit then 'ds_supplier_product.submitted' else 'ds_supplier_product.draft_saved' end, 'dropship_supplier_submissions', v_id::text, jsonb_build_object('supplier_id', v_sup));
  return jsonb_build_object('id', v_id, 'status', case when p_submit then 'submitted' else 'draft' end);
end $$;

-- bulk upload: p_check = true only validates (preview); false saves the good rows as ONE submission
create or replace function public.ds_sup_bulk(p_rows jsonb, p_file_name text, p_submit boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  g jsonb;
  v_id uuid;
  v_n integer;
begin
  if not exists (select 1 from public.supplier_switches w where w.supplier_id = v_sup and w.product_upload) then
    raise exception 'UPLOAD_OFF: Bulk upload is switched off for your account. Ask your Octopus contact.';
  end if;
  g := ds14_bulk_group(p_rows, null);
  if not coalesce(p_submit, false) then return g; end if;
  if (g ->> 'good_rows')::int = 0 then raise exception 'NO_GOOD_ROWS: No row can be submitted yet. Fix the problems and upload again.'; end if;
  v_n := (g ->> 'good_rows')::int;
  insert into public.dropship_supplier_submissions (supplier_id, kind, status, summary, payload, row_count)
  values (v_sup, 'bulk_upload', 'submitted', left('Bulk upload (' || v_n || ')' || coalesce(' · ' || nullif(btrim(left(p_file_name, 80)), ''), ''), 200),
          jsonb_build_object('products', g -> 'products', 'file_name', left(coalesce(p_file_name, ''), 120), 'skipped', jsonb_array_length(g -> 'problems')), v_n)
  returning id into v_id;
  perform write_audit('ds_supplier_bulk.submitted', 'dropship_supplier_submissions', v_id::text, jsonb_build_object('rows', v_n, 'problems', jsonb_array_length(g -> 'problems')));
  return g || jsonb_build_object('id', v_id);
end $$;

create or replace function public.ds_sup_submission_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  s public.dropship_supplier_submissions;
begin
  select * into s from public.dropship_supplier_submissions where id = p_id and supplier_id = v_sup;
  if s.id is null then raise exception 'NOT_FOUND: This product is not yours.'; end if;
  return jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'payload', s.payload, 'review_note', s.review_note, 'editable', s.status in ('draft', 'changes_asked'));
end $$;

-- orders to ship. Buyer name and address are for shipping only; the merchant (organisation, store, order name) is never selected.
create or replace function public.ds14_sup_order_row(p_po public.dropship_partner_orders, p_detail boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  so public.store_orders;
  v_cancelled boolean;
  v_addr jsonb;
begin
  select * into so from public.store_orders where id = p_po.store_order_id;
  v_cancelled := so.cancelled_at is not null or so.merchant_status in ('cancelled', 'refunded');
  if p_detail then
    v_addr := jsonb_build_object(
      'name', so.buyer_name, 'line1', so.shipping_address ->> 'line1', 'line2', so.shipping_address ->> 'line2', 'city', so.shipping_address ->> 'city',
      'region', coalesce(so.shipping_address ->> 'region', so.shipping_address ->> 'province', so.shipping_address ->> 'state'),
      'postcode', coalesce(so.shipping_address ->> 'postcode', so.shipping_address ->> 'zip'), 'country', so.destination_country, 'phone', so.buyer_phone);
  end if;
  return jsonb_build_object(
    'id', p_po.id, 'order', so.order_number, 'country', so.destination_country,
    'status', case when v_cancelled and p_po.status <> 'shipped' then 'cancelled' else p_po.status end,
    'ship_by', p_po.ship_by, 'carrier', p_po.carrier, 'tracking_no', p_po.tracking_no, 'shipped_at', p_po.shipped_at, 'problem_note', p_po.problem_note,
    'items', coalesce((select jsonb_agg(jsonb_build_object('title', dp.title, 'sku', coalesce(nullif(btrim(sp.supplier_model), ''), i.model_no), 'variant', i.variant_label, 'qty', i.qty) order by i.created_at)
                         from public.store_order_items i
                         join public.dropship_products dp on dp.id = i.product_id
                         join public.dropship_variants dv on dv.id = i.variant_id
                         join public.supplier_products sp on sp.id = dv.supplier_product_id
                        where i.store_order_id = so.id and sp.supplier_id = p_po.supplier_id), '[]'::jsonb),
    'ship_to', v_addr);
end $$;

create or replace function public.ds_sup_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_sup uuid := ds14_supplier();
begin
  return jsonb_build_object('orders', coalesce((
    select jsonb_agg(public.ds14_sup_order_row(po, false) order by po.created_at desc)
      from (select * from public.dropship_partner_orders where supplier_id = v_sup order by created_at desc limit 300) po), '[]'::jsonb),
    'ship_within_days', (ds14_rules() ->> 'ship_within_days')::integer);
end $$;

create or replace function public.ds_sup_order(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  po public.dropship_partner_orders;
begin
  select * into po from public.dropship_partner_orders where id = p_id and supplier_id = v_sup;
  if po.id is null then raise exception 'NOT_FOUND: This order is not yours.'; end if;
  return public.ds14_sup_order_row(po, true);
end $$;

-- the Octopus packing slip: order reference, buyer address, items and quantities. No prices, no merchant, no supplier details.
create or replace function public.ds_sup_slip(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  po public.dropship_partner_orders;
  r jsonb;
begin
  select * into po from public.dropship_partner_orders where id = p_id and supplier_id = v_sup for update;
  if po.id is null then raise exception 'NOT_FOUND: This order is not yours.'; end if;
  r := public.ds14_sup_order_row(po, true);
  if r ->> 'status' = 'cancelled' then raise exception 'ORDER_CANCELLED: This order was cancelled. Do not ship it.'; end if;
  update public.dropship_partner_orders set slip_at = coalesce(slip_at, now()), updated_at = now() where id = po.id;
  return jsonb_build_object('order', r -> 'order', 'date', current_date, 'ship_to', r -> 'ship_to', 'items', r -> 'items');
end $$;

create or replace function public.ds_sup_order_ship(p_id uuid, p_carrier text, p_carrier_name text, p_tracking text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  po public.dropship_partner_orders;
  so public.store_orders;
  v_ship uuid;
  v_open integer;
  r public.dropship_partner_orders;
  v_trk text := btrim(coalesce(p_tracking, ''));
begin
  select * into po from public.dropship_partner_orders where id = p_id and supplier_id = v_sup for update;
  if po.id is null then raise exception 'NOT_FOUND: This order is not yours.'; end if;
  if po.status not in ('to_ship', 'problem') then raise exception 'NOT_OPEN: This order is already %.', po.status; end if;
  if p_carrier is null or p_carrier not in ('yunexpress', '4px', 'other') then raise exception 'BAD_CARRIER: Choose YunExpress, 4PX or Other.'; end if;
  if p_carrier = 'other' and length(btrim(coalesce(p_carrier_name, ''))) not between 2 and 40 then raise exception 'BAD_CARRIER: Write the carrier name (2 to 40 characters).'; end if;
  if v_trk !~ '^[A-Za-z0-9-]{6,40}$' then raise exception 'BAD_TRACKING: Tracking number: 6 to 40 letters, digits or dashes, no spaces.'; end if;
  select * into so from public.store_orders where id = po.store_order_id for update;
  if so.cancelled_at is not null or so.merchant_status in ('cancelled', 'refunded') then raise exception 'ORDER_CANCELLED: This order was cancelled. Do not ship it.'; end if;
  if po.slip_at is null then raise exception 'SLIP_FIRST: Download the Octopus packing slip and put it in the parcel before you mark it shipped.'; end if;
  update public.dropship_partner_orders
     set status = 'shipped', carrier = p_carrier, tracking_no = v_trk, shipped_at = now(), problem_note = null, updated_at = now()
   where id = po.id;
  select count(*) into v_open from public.dropship_partner_orders where store_order_id = so.id and status in ('to_ship', 'problem');
  if v_open = 0 then
    -- every supplier of the order has shipped. Only now are the shipments created: the existing shipment event moves the staff stage to
    -- "handed over" (merchant label Shipped) at once, so a first parcel alone must not do it.
    for r in select * from public.dropship_partner_orders where store_order_id = so.id and status = 'shipped' and shipment_id is null order by shipped_at loop
      insert into public.shipments (org_id, carrier_code, tracking_no, status, store_order_id, division_id, last_event_at)
      values (so.org_id, r.carrier, r.tracking_no, 'picked_up', so.id, division_id_of('DS'), now())
      returning id into v_ship;
      update public.dropship_partner_orders set shipment_id = v_ship where id = r.id;
    end loop;
    update public.store_orders set staff_stage = 'handed_over', updated_at = now() where id = so.id and staff_stage in ('sourcing', 'paid_to_assign', 'packing');
    perform public.ds_order_event(so.id, so.org_id, 'shipped', 'Shipped', 'Tracking number: ' || (select string_agg(x.tracking_no, ', ' order by x.shipped_at) from public.dropship_partner_orders x where x.store_order_id = so.id and x.status = 'shipped'), null);
    perform public.ds_order_channel_task(so.id, so.org_id, so.channel, 'update_tracking',
      jsonb_build_object('tracking', (select jsonb_agg(jsonb_build_object('carrier', x.carrier, 'tracking_no', x.tracking_no) order by x.shipped_at)
                                        from public.dropship_partner_orders x where x.store_order_id = so.id and x.status = 'shipped')));
  end if;
  perform write_audit('ds_partner_order.shipped', 'dropship_partner_orders', po.id::text, jsonb_build_object('carrier', p_carrier, 'tracking_no', v_trk, 'order', so.order_number));
  return jsonb_build_object('status', 'shipped', 'tracking_no', v_trk, 'all_shipped', v_open = 0);
end $$;

create or replace function public.ds_sup_order_problem(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup uuid := ds14_supplier();
  po public.dropship_partner_orders;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if length(v_note) not between 3 and 500 then raise exception 'NOTE_REQUIRED: Tell staff what is wrong (3 to 500 characters).'; end if;
  select * into po from public.dropship_partner_orders where id = p_id and supplier_id = v_sup for update;
  if po.id is null then raise exception 'NOT_FOUND: This order is not yours.'; end if;
  if po.status not in ('to_ship', 'problem') then raise exception 'NOT_OPEN: This order is already %.', po.status; end if;
  update public.dropship_partner_orders set status = 'problem', problem_note = v_note, updated_at = now() where id = po.id;
  perform write_audit('ds_partner_order.problem', 'dropship_partner_orders', po.id::text, jsonb_build_object('note', v_note));
  return jsonb_build_object('status', 'problem');
end $$;

-- ───────────────────────── 4. Staff: approvals, suppliers, partner orders ─────────────────────────
create or replace function public.ds_staff_approvals_page(p_tab text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_tab text := coalesce(p_tab, 'review');
begin
  perform ds14_assert('view');
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'review', (select count(*) from public.dropship_supplier_submissions where status = 'submitted'),
      'changes', (select count(*) from public.dropship_supplier_submissions where status = 'changes_asked'),
      'approved', (select count(*) from public.dropship_supplier_submissions where status in ('approved', 'auto_approved')),
      'rejected', (select count(*) from public.dropship_supplier_submissions where status = 'rejected')),
    'rules', ds14_rules(),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'summary', x.summary, 'row_count', x.row_count,
                                          'supplier_code', s.code, 'supplier_name', s.legal_name, 'created_at', x.created_at, 'updated_at', x.updated_at) order by x.updated_at desc)
        from (select * from public.dropship_supplier_submissions
               where case v_tab when 'review' then status = 'submitted' when 'changes' then status = 'changes_asked'
                                when 'approved' then status in ('approved', 'auto_approved') when 'rejected' then status = 'rejected' else false end
               order by updated_at desc limit 200) x
        join public.suppliers s on s.id = x.supplier_id), '[]'::jsonb));
end $$;

create or replace function public.ds_staff_approval_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  x public.dropship_supplier_submissions;
  s public.suppliers;
  prods jsonb;
begin
  perform ds14_assert('view');
  select * into x from public.dropship_supplier_submissions where id = p_id;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  select * into s from public.suppliers where id = x.supplier_id;
  prods := case x.kind when 'bulk_upload' then x.payload -> 'products' when 'new_product' then jsonb_build_array(x.payload) else '[]'::jsonb end;
  return jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'summary', x.summary, 'payload', x.payload, 'checks', x.checks, 'review_note', x.review_note,
    'supplier_code', s.code, 'supplier_name', s.legal_name, 'created_at', x.created_at, 'product_ids', x.product_ids,
    'auto', jsonb_build_object(
      'ids_unique', not exists (select 1 from jsonb_array_elements(prods) q where public.ds14_sku_clash_other(q ->> 'supplier_sku', x.id)),
      'hs_present', not exists (select 1 from jsonb_array_elements(prods) q where regexp_replace(coalesce(q #>> '{customs,hs_code}', ''), '[ .]', '', 'g') !~ '^[0-9]{6,10}$'),
      'size_present', not exists (select 1 from jsonb_array_elements(prods) q where coalesce((q #>> '{package,weight_g}')::integer, 0) <= 0 or coalesce((q #>> '{package,length_cm}')::numeric, 0) <= 0),
      'images_present', not exists (select 1 from jsonb_array_elements(prods) q where jsonb_array_length(coalesce(q -> 'images', '[]'::jsonb)) < 3)));
end $$;

-- same as ds14_sku_clash, but "another" = anything except this submission AND an existing product that this submission created
create or replace function public.ds14_sku_clash_other(p_sku text, p_sub uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.dropship_products d where lower(d.supplier_sku) = lower(p_sku)
                  and not (d.id = any (coalesce((select product_ids from public.dropship_supplier_submissions where id = p_sub), '{}'::uuid[]))))
      or exists (select 1 from public.supplier_products sp where lower(sp.supplier_model) = lower(p_sku))
      or exists (select 1 from public.dropship_supplier_submissions s where s.id <> p_sub and s.status <> 'rejected'
                  and (lower(s.payload ->> 'supplier_sku') = lower(p_sku)
                       or exists (select 1 from jsonb_array_elements(coalesce(s.payload -> 'products', '[]'::jsonb)) pr where lower(pr ->> 'supplier_sku') = lower(p_sku))))
$$;

create or replace function public.ds14_create_draft(p_sup uuid, pr jsonb, p_sub uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod uuid;
  vr jsonb;
  v_hs text := regexp_replace(coalesce(pr #>> '{customs,hs_code}', ''), '[ .]', '', 'g');
  v_item uuid;
  v_desc text;
begin
  v_desc := btrim(coalesce(pr ->> 'description', ''));
  -- dropship_products.supplier_id / supplier_sku / unit_cost_cents are FROZEN (migration LEGACY_COST_FROZEN): the supplier link of a
  -- product is its variants' supplier_product_id (Sourcing). The draft therefore carries no supplier; the submission keeps product_ids.
  insert into public.dropship_products (title, description, category, weight_g, dimensions_cm, min_order_qty, source_type,
                                        origin_country, has_battery, has_liquid, status, created_by, fulfilment_type)
  values (left(pr ->> 'name', 200), v_desc, left(pr ->> 'category', 60), (pr #>> '{package,weight_g}')::integer,
          jsonb_build_object('l', (pr #>> '{package,length_cm}')::numeric, 'w', (pr #>> '{package,width_cm}')::numeric, 'h', (pr #>> '{package,height_cm}')::numeric),
          greatest(1, coalesce((pr #>> '{terms,moq}')::integer, 1)), 'partner_supplier',
          pr #>> '{customs,origin}', coalesce((pr #>> '{customs,battery}')::boolean, false), coalesce((pr #>> '{customs,liquid}')::boolean, false),
          'draft', auth.uid(), 'extended_catalog')
  returning id into v_prod;
  -- variants: the cost and stock the supplier sent stay in the submission (the product's cost and stock live in Sourcing:
  -- staff link each variant to a Sourcing supplier product in the product form, then the publish checklist applies)
  for vr in select * from jsonb_array_elements(pr -> 'variants') loop
    insert into public.dropship_variants (product_id, options, cost_cents, stock_status)
    values (v_prod, jsonb_build_object('Option', left(vr ->> 'option', 60)), 0, 'in_stock')
    returning item_id into v_item;
    begin
      -- the supplier's HS code is only a suggestion until staff confirm it in the Duty, tax and customs review queue
      update public.item_master set hs_code = v_hs, hs_code_source = 'sheet', hs_code_status = 'suggested', hs_verified = false where id = v_item;
    exception when others then
      null;
    end;
  end loop;
  perform write_audit('ds_supplier_product.draft_created', 'dropship_products', v_prod::text, jsonb_build_object('submission', p_sub, 'supplier_id', p_sup));
  return v_prod;
end $$;

create or replace function public.ds_staff_approval_decide(p_id uuid, p_action text, p_note text, p_checks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.dropship_supplier_submissions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ids uuid[] := '{}';
  pr jsonb;
  k text;
begin
  perform ds14_assert('edit');
  if p_action not in ('approve', 'changes', 'reject') then raise exception 'BAD_ACTION'; end if;
  select * into x from public.dropship_supplier_submissions where id = p_id for update;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  if x.status <> 'submitted' then raise exception 'NOT_OPEN: This item is already %.', replace(x.status, '_', ' '); end if;
  if p_action <> 'approve' and (v_note is null or length(v_note) < 3) then raise exception 'NOTE_REQUIRED: Write a note to the supplier (what to change, or why it is rejected).'; end if;
  if p_action = 'approve' and x.kind in ('new_product', 'bulk_upload') then
    foreach k in array array['images_clean', 'ids_unique', 'hs_ok', 'size_ok', 'flags_ok', 'cost_ok'] loop
      if coalesce((p_checks ->> k)::boolean, false) is not true then raise exception 'CHECKLIST_OPEN: Tick every check before you approve (%).', replace(k, '_', ' '); end if;
    end loop;
    for pr in select * from jsonb_array_elements(case x.kind when 'bulk_upload' then x.payload -> 'products' else jsonb_build_array(x.payload) end) loop
      if ds14_sku_clash_other(pr ->> 'supplier_sku', x.id) then raise exception 'SKU_CLASH: Model number % is already used by another product.', pr ->> 'supplier_sku'; end if;
      v_ids := v_ids || ds14_create_draft(x.supplier_id, pr, x.id);
    end loop;
  elsif p_action = 'approve' and x.kind = 'price_change' then
    perform ds14_apply_price(x.id);
  end if;
  update public.dropship_supplier_submissions
     set status = case p_action when 'approve' then 'approved' when 'changes' then 'changes_asked' else 'rejected' end,
         review_note = v_note, checks = coalesce(p_checks, '{}'::jsonb), reviewed_by = auth.uid(), reviewed_at = now(), product_ids = v_ids, updated_at = now()
   where id = x.id;
  perform write_audit('ds_supplier_submission.' || p_action, 'dropship_supplier_submissions', x.id::text,
                      jsonb_build_object('kind', x.kind, 'supplier_id', x.supplier_id, 'note', v_note, 'products', v_ids));
  return jsonb_build_object('status', case p_action when 'approve' then 'approved' when 'changes' then 'changes_asked' else 'rejected' end, 'product_ids', v_ids);
end $$;

create or replace function public.ds_staff_rules_save(p_price_auto_pct integer, p_ship_within_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform ds14_assert('edit');
  if p_price_auto_pct is not null and p_price_auto_pct not between 0 and 50 then raise exception 'BAD_RULE: Auto-approve price changes up to 0 to 50 percent, or leave it empty to review every price change.'; end if;
  if p_ship_within_days is not null and p_ship_within_days not between 1 and 60 then raise exception 'BAD_RULE: Ship within 1 to 60 days, or leave it empty.'; end if;
  v := jsonb_strip_nulls(jsonb_build_object('price_auto_pct', p_price_auto_pct, 'ship_within_days', p_ship_within_days));
  insert into public.site_settings (key, value, description, is_public, updated_by)
  values ('dropship_supplier_rules', v, 'Octopus Dropship supplier portal rules (auto-approve price changes up to N percent; ship within N days)', false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid(), is_public = false;
  perform write_audit('ds_supplier_rules.saved', 'site_settings', 'dropship_supplier_rules', v);
  return v;
end $$;

create or replace function public.ds_staff_suppliers_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform ds14_assert('view');
  return jsonb_build_object(
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.code, 'name', s.legal_name, 'verified', s.verified, 'portal_on', coalesce(w.portal_login, false),
        'portal_user', (select pf.email from public.profiles pf where pf.id = s.user_id),
        'products', (select count(distinct dv.product_id) from public.dropship_variants dv join public.supplier_products sp on sp.id = dv.supplier_product_id where sp.supplier_id = s.id),
        'open_orders', (select count(*) from public.dropship_partner_orders po where po.supplier_id = s.id and po.status in ('to_ship', 'problem')),
        'in_review', (select count(*) from public.dropship_supplier_submissions x where x.supplier_id = s.id and x.status = 'submitted')) order by s.code)
      from public.suppliers s left join public.supplier_switches w on w.supplier_id = s.id
     where s.archived_at is null and (s.user_id is not null or coalesce(w.portal_login, false)
           or exists (select 1 from public.dropship_variants dv join public.supplier_products sp on sp.id = dv.supplier_product_id where sp.supplier_id = s.id)
           or exists (select 1 from public.dropship_supplier_submissions x where x.supplier_id = s.id))), '[]'::jsonb),
    'link_candidates', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.legal_name, 'email', s.contact_email) order by s.code)
                                   from public.suppliers s where s.archived_at is null and s.verified and s.user_id is null), '[]'::jsonb),
    'unassigned', coalesce((
      select jsonb_agg(jsonb_build_object('id', so.id, 'order', so.order_number, 'country', so.destination_country, 'created_at', so.created_at,
        'suppliers', (select string_agg(distinct s.code, ', ') from public.store_order_items i join public.dropship_variants dv on dv.id = i.variant_id
                        join public.supplier_products sp on sp.id = dv.supplier_product_id join public.suppliers s on s.id = sp.supplier_id where i.store_order_id = so.id),
        'mixed', exists (select 1 from public.store_order_items i join public.dropship_products dp on dp.id = i.product_id join public.dropship_variants dv on dv.id = i.variant_id
                          where i.store_order_id = so.id and (dp.source_type <> 'partner_supplier' or dv.supplier_product_id is null))) order by so.created_at)
        from public.store_orders so
       where so.payment_state = 'paid' and so.staff_stage in ('paid_to_assign', 'sourcing') and so.cancelled_at is null and so.kind = 'store'
         and exists (select 1 from public.store_order_items i join public.dropship_products dp on dp.id = i.product_id join public.dropship_variants dv on dv.id = i.variant_id
                      where i.store_order_id = so.id and dp.source_type = 'partner_supplier' and dv.supplier_product_id is not null)
         and not exists (select 1 from public.dropship_partner_orders po where po.store_order_id = so.id and po.status <> 'cancelled')
         and not exists (select 1 from public.dropship_handoffs h where h.store_order_id = so.id and h.status <> 'cancelled'
                          and (h.handoff_type = 'warehouse_pick_pack' or h.status not in ('pending', 'ordered_from_supplier')))), '[]'::jsonb),
    'partner_orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id, 'order', so.order_number, 'supplier_code', s.code, 'status', po.status, 'ship_by', po.ship_by, 'carrier', po.carrier,
                                          'tracking_no', po.tracking_no, 'problem_note', po.problem_note, 'created_at', po.created_at) order by po.created_at desc)
        from (select * from public.dropship_partner_orders order by created_at desc limit 100) po
        join public.store_orders so on so.id = po.store_order_id join public.suppliers s on s.id = po.supplier_id), '[]'::jsonb));
end $$;

-- staff send an order to its partner supplier(s): one row per supplier, never mixed with warehouse items, never without a live portal
create or replace function public.ds_partner_assign(p_so uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders;
  v_days integer := (ds14_rules() ->> 'ship_within_days')::integer;
  v_n integer := 0;
  v_sup uuid;
begin
  perform ds14_assert('edit');
  select * into so from public.store_orders where id = p_so for update;
  if so.id is null then raise exception 'NOT_FOUND: Order not found.'; end if;
  if so.payment_state <> 'paid' or so.cancelled_at is not null or so.staff_stage not in ('paid_to_assign', 'sourcing') then
    raise exception 'NOT_READY: Only paid, open orders that are not packed yet can go to a partner supplier.';
  end if;
  -- paying an order already made a Sourcing hand-over (supplier → Octopus warehouse). Routing it to the partner path cancels that
  -- hand-over, but only while the goods are not on their way to the warehouse; warehouse pick/pack hand-overs are never touched.
  if exists (select 1 from public.dropship_handoffs h where h.store_order_id = so.id and h.status <> 'cancelled'
              and (h.handoff_type = 'warehouse_pick_pack' or h.status not in ('pending', 'ordered_from_supplier'))) then
    raise exception 'ALREADY_ROUTED: This order is already with the warehouse or on its way there.';
  end if;
  if exists (select 1 from public.store_order_items i join public.dropship_products dp on dp.id = i.product_id join public.dropship_variants dv on dv.id = i.variant_id
              where i.store_order_id = so.id and (dp.source_type <> 'partner_supplier' or dv.supplier_product_id is null)) then
    raise exception 'MIXED_ORDER: This order has items that are not from a partner supplier. Use the warehouse path.';
  end if;
  for v_sup in select distinct sp.supplier_id from public.store_order_items i join public.dropship_variants dv on dv.id = i.variant_id
                 join public.supplier_products sp on sp.id = dv.supplier_product_id where i.store_order_id = so.id loop
    if not exists (select 1 from public.suppliers s join public.supplier_switches w on w.supplier_id = s.id
                    where s.id = v_sup and s.user_id is not null and s.verified and s.archived_at is null and w.portal_login) then
      raise exception 'SUPPLIER_PORTAL_OFF: A supplier of this order has no active portal account yet. Create it in Suppliers first.';
    end if;
    insert into public.dropship_partner_orders (store_order_id, supplier_id, ship_by)
    values (so.id, v_sup, case when v_days is not null then current_date + v_days end)
    on conflict (store_order_id, supplier_id) do update
      set status = 'to_ship', cancel_reason = null, problem_note = null, ship_by = excluded.ship_by, updated_at = now()
      where public.dropship_partner_orders.status = 'cancelled';
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'NOT_READY: This order has no partner items.'; end if;
  update public.dropship_handoffs set status = 'cancelled', updated_at = now() where store_order_id = so.id and handoff_type = 'sourcing_procurement' and status <> 'cancelled';
  update public.store_orders set staff_stage = 'sourcing', updated_at = now() where id = so.id and staff_stage = 'paid_to_assign';
  perform write_audit('ds_partner_order.assigned', 'store_orders', so.id::text, jsonb_build_object('order', so.order_number, 'suppliers', v_n));
  return jsonb_build_object('suppliers', v_n);
end $$;

create or replace function public.ds_partner_order_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  po public.dropship_partner_orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform ds14_assert('edit');
  if length(v_reason) not between 3 and 500 then raise exception 'REASON_REQUIRED: Write why you take this order back (3 to 500 characters).'; end if;
  select * into po from public.dropship_partner_orders where id = p_id for update;
  if po.id is null then raise exception 'NOT_FOUND'; end if;
  if po.status not in ('to_ship', 'problem') then raise exception 'NOT_OPEN: A shipped order cannot be taken back here.'; end if;
  update public.dropship_partner_orders set status = 'cancelled', cancel_reason = v_reason, updated_at = now() where id = po.id;
  if not exists (select 1 from public.dropship_partner_orders where store_order_id = po.store_order_id and status in ('to_ship', 'problem', 'shipped')) then
    update public.store_orders set staff_stage = 'paid_to_assign', updated_at = now() where id = po.store_order_id and staff_stage = 'sourcing';
  end if;
  perform write_audit('ds_partner_order.cancelled', 'dropship_partner_orders', po.id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('status', 'cancelled');
end $$;

-- the portal account of a supplier (the auth user is created / invited by the server with the service role first)
create or replace function public.ds_supplier_link_user(p_supplier uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public.suppliers;
begin
  perform ds14_assert('suppliers_edit');
  select * into s from public.suppliers where id = p_supplier for update;
  if s.id is null or s.archived_at is not null then raise exception 'NOT_FOUND: Supplier not found.'; end if;
  if not s.verified then raise exception 'NOT_VERIFIED: Verify the supplier before it gets a portal account.'; end if;
  if s.user_id is not null then raise exception 'ALREADY_LINKED: This supplier already has a portal account.'; end if;
  if exists (select 1 from public.suppliers o where o.user_id = p_user) then raise exception 'USER_TAKEN: This login already belongs to another supplier.'; end if;
  if public.user_is_staff(p_user) or exists (select 1 from public.org_members m where m.user_id = p_user) then
    raise exception 'USER_TAKEN: A staff or merchant login cannot be a supplier login. Use a separate email address.';
  end if;
  update public.suppliers set user_id = p_user where id = s.id;
  insert into public.user_roles (user_id, role_code) values (p_user, 'supplier') on conflict do nothing;
  update public.supplier_switches set portal_login = true, updated_at = now() where supplier_id = s.id;
  perform write_audit('ds_supplier.portal_account_linked', 'suppliers', s.id::text, jsonb_build_object('code', s.code, 'user_id', p_user));
  return jsonb_build_object('code', s.code);
end $$;

-- checks shown beside a supplier application (they never decide: staff do, with review_supplier_application)
create or replace function public.ds_supplier_application_checks(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.supplier_applications;
begin
  perform ds14_assert('suppliers_view');
  select * into a from public.supplier_applications where id = p_id;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_array(
    jsonb_build_object('key', 'uscc', 'ok', coalesce(upper(btrim(a.uscc)), '') ~ '^[0-9A-Z]{18}$', 'label', 'Business licence number (USCC) has 18 characters'),
    jsonb_build_object('key', 'online', 'ok', coalesce(btrim(a.website), '') <> '' or coalesce(btrim(a.store_url), '') <> '', 'label', 'Website or 1688 / Alibaba store given'),
    jsonb_build_object('key', 'sheet', 'ok', a.product_sheet_path is not null, 'label', 'Product sheet uploaded'),
    jsonb_build_object('key', 'no_duplicate', 'ok', not exists (select 1 from public.suppliers s where lower(btrim(s.legal_name)) = lower(btrim(a.company_name)))
                          and not exists (select 1 from public.supplier_applications o where o.id <> a.id and o.status in ('submitted', 'in_review', 'approved')
                                                 and a.uscc is not null and upper(btrim(o.uscc)) = upper(btrim(a.uscc))), 'label', 'No supplier or open application with the same name or USCC'),
    jsonb_build_object('key', 'email_free', 'ok', not exists (select 1 from public.profiles pf where lower(pf.email) = lower(a.contact_email)), 'label', 'Contact email has no Octopus login yet'),
    jsonb_build_object('key', 'country', 'ok', coalesce(a.ip_country, 'CN') = 'CN', 'label', 'Applied from China (' || coalesce(a.ip_country, 'unknown') || ')'));
end $$;

-- ───────────────────────── 5. Sales partners ─────────────────────────
create or replace function public.ds14_partner_accrue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  rl public.dropship_partner_rules;
  v_amount bigint;
  v_n integer := 0;
begin
  for c in
    select ch.id charge_id, ch.org_id, ch.amount_cents, ch.period_start, pm.partner_id
      from public.dropship_plan_charges ch
      join public.dropship_partner_merchants pm on pm.org_id = ch.org_id
      join public.dropship_partners p on p.id = pm.partner_id and p.status = 'active'
     where ch.created_at >= pm.attached_at
       and not exists (select 1 from public.dropship_partner_commissions k where k.charge_id = ch.id)
     order by ch.period_start, ch.id
  loop
    select * into rl from public.dropship_partner_rules where partner_id = c.partner_id;
    if rl.id is null then select * into rl from public.dropship_partner_rules where partner_id is null; end if;
    continue when rl.id is null;
    continue when (select count(*) from public.dropship_partner_commissions k where k.partner_id = c.partner_id and k.org_id = c.org_id and k.status = 'accrued') >= rl.months;
    v_amount := case rl.kind when 'percent_of_plan_fee' then (c.amount_cents * rl.rate_bps + 5000) / 10000 else rl.fixed_cents end;
    insert into public.dropship_partner_commissions (partner_id, org_id, charge_id, kind, base_cents, rate_bps, fixed_cents, amount_cents, period_start)
    values (c.partner_id, c.org_id, c.charge_id, rl.kind, c.amount_cents, rl.rate_bps, rl.fixed_cents, v_amount, c.period_start)
    on conflict (charge_id) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.ds_partners_page()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce((select enabled from public.saas_billing_settings where id = 1), false);
begin
  perform ds14_assert('view');
  if ds14_staff_can('edit') then perform ds14_partner_accrue(); end if;
  return jsonb_build_object(
    'plan_fees_on', v_enabled,
    'can_edit', ds14_staff_can('edit'),
    'can_rules', ds14_staff_can('commission'),
    'default_rule', (select to_jsonb(r) - 'set_by' - 'id' - 'partner_id' from public.dropship_partner_rules r where r.partner_id is null),
    'partners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.code, 'name', p.name, 'kind', p.kind, 'status', p.status, 'contact_email', p.contact_email, 'contact_name', p.contact_name, 'invited_at', p.invited_at,
        'merchants', (select count(*) from public.dropship_partner_merchants m where m.partner_id = p.id),
        'earned_cents', coalesce((select sum(k.amount_cents) from public.dropship_partner_commissions k where k.partner_id = p.id and k.status = 'accrued'), 0),
        'rule', (select to_jsonb(r) - 'set_by' - 'id' - 'partner_id' from public.dropship_partner_rules r where r.partner_id = p.id)) order by p.created_at desc)
        from public.dropship_partners p), '[]'::jsonb),
    'merchants', coalesce((
      select jsonb_agg(jsonb_build_object('partner_id', m.partner_id, 'org_id', m.org_id, 'name', o.name, 'attached_at', m.attached_at,
        'earned_cents', coalesce((select sum(k.amount_cents) from public.dropship_partner_commissions k where k.partner_id = m.partner_id and k.org_id = m.org_id and k.status = 'accrued'), 0)) order by m.attached_at desc)
        from public.dropship_partner_merchants m join public.organizations o on o.id = m.org_id), '[]'::jsonb),
    'available_merchants', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
        from public.organizations o join public.company_services cs on cs.org_id = o.id and cs.service = 'dropship' and cs.status in ('on', 'paused')
       where o.archived_at is null and not exists (select 1 from public.dropship_partner_merchants m where m.org_id = o.id)), '[]'::jsonb));
end $$;

create or replace function public.ds_partner_invite(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.dropship_partners;
begin
  perform ds14_assert('edit');
  if jsonb_typeof(p) <> 'object' then raise exception 'BAD_INPUT'; end if;
  if exists (select 1 from public.dropship_partners x where lower(x.contact_email) = lower(btrim(coalesce(p ->> 'contact_email', ''))) and x.status <> 'ended') then
    raise exception 'DUPLICATE: A partner with this email already exists.';
  end if;
  insert into public.dropship_partners (name, kind, contact_name, contact_email, note)
  values (btrim(coalesce(p ->> 'name', '')), coalesce(nullif(p ->> 'kind', ''), 'agency'), nullif(btrim(coalesce(p ->> 'contact_name', '')), ''),
          btrim(coalesce(p ->> 'contact_email', '')), nullif(btrim(coalesce(p ->> 'note', '')), ''))
  returning * into v;
  perform write_audit('ds_partner.invited', 'dropship_partners', v.id::text, jsonb_build_object('code', v.code, 'kind', v.kind));
  return jsonb_build_object('id', v.id, 'code', v.code);
exception when check_violation then
  raise exception 'INVALID: Check the name (2 to 120 characters), the type and the email address.';
end $$;

create or replace function public.ds_partner_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.dropship_partners;
begin
  perform ds14_assert('edit');
  if p_status not in ('active', 'paused', 'ended') then raise exception 'BAD_STATUS'; end if;
  select * into v from public.dropship_partners where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if v.status = 'ended' then raise exception 'ENDED: An ended partner cannot be changed.'; end if;
  update public.dropship_partners set status = p_status, activated_at = case when p_status = 'active' then coalesce(activated_at, now()) else activated_at end where id = p_id;
  perform write_audit('ds_partner.' || p_status, 'dropship_partners', p_id::text, jsonb_build_object('from', v.status));
  return jsonb_build_object('status', p_status);
end $$;

create or replace function public.ds_partner_attach(p_partner uuid, p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.dropship_partners;
begin
  perform ds14_assert('edit');
  select * into v from public.dropship_partners where id = p_partner;
  if v.id is null or v.status in ('ended') then raise exception 'NOT_FOUND: Partner not found or ended.'; end if;
  if not exists (select 1 from public.organizations o where o.id = p_org and o.archived_at is null) then raise exception 'NOT_FOUND: Merchant not found.'; end if;
  if exists (select 1 from public.dropship_partner_merchants m where m.org_id = p_org) then raise exception 'ALREADY_ATTACHED: This merchant already belongs to a partner.'; end if;
  insert into public.dropship_partner_merchants (partner_id, org_id) values (p_partner, p_org);
  perform write_audit('ds_partner.merchant_attached', 'dropship_partners', p_partner::text, jsonb_build_object('org_id', p_org));
  return jsonb_build_object('ok', true);
end $$;

-- commission rules: Finance approvers and admins only (money): partner NULL = the default rule
create or replace function public.ds_partner_rule_save(p_partner uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := p ->> 'kind';
  v_rate integer := nullif(p ->> 'rate_bps', '')::integer;
  v_fixed bigint := nullif(p ->> 'fixed_cents', '')::bigint;
  v_months integer := nullif(p ->> 'months', '')::integer;
begin
  perform ds14_assert('commission');
  if p_partner is not null and not exists (select 1 from public.dropship_partners where id = p_partner) then raise exception 'NOT_FOUND: Partner not found.'; end if;
  if v_kind not in ('percent_of_plan_fee', 'fixed_per_merchant') then raise exception 'BAD_RULE: Choose percent of the plan fee or a fixed amount per merchant.'; end if;
  if v_months is null or v_months not between 1 and 60 then raise exception 'BAD_RULE: Paid for how many months: 1 to 60.'; end if;
  if v_kind = 'percent_of_plan_fee' and (v_rate is null or v_rate not between 0 and 10000) then raise exception 'BAD_RULE: Rate: 0 to 100 percent.'; end if;
  if v_kind = 'fixed_per_merchant' and (v_fixed is null or v_fixed not between 0 and 10000000) then raise exception 'BAD_RULE: Fixed amount: 0 to 100,000 dollars.'; end if;
  if p_partner is null then
    delete from public.dropship_partner_rules where partner_id is null;
  else
    delete from public.dropship_partner_rules where partner_id = p_partner;
  end if;
  insert into public.dropship_partner_rules (partner_id, kind, rate_bps, fixed_cents, months)
  values (p_partner, v_kind, case when v_kind = 'percent_of_plan_fee' then v_rate end, case when v_kind = 'fixed_per_merchant' then v_fixed end, v_months);
  perform write_audit('ds_partner.rule_saved', 'dropship_partners', coalesce(p_partner::text, 'default'),
                      jsonb_build_object('kind', v_kind, 'rate_bps', v_rate, 'fixed_cents', v_fixed, 'months', v_months));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── 6. Merchant: Integrations and Connect a channel ─────────────────────────
create or replace function public.ds_channels_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_plan jsonb;
  v_conn public.store_connections;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  v_plan := ds_plan_state(v_org);
  select * into v_conn from public.store_connections where org_id = v_org and status <> 'disconnected' order by created_at desc limit 1;
  return jsonb_build_object(
    'shopify', case when v_conn.id is null then jsonb_build_object('status', 'not_connected')
                    else jsonb_build_object('status', v_conn.status, 'shop', v_conn.shop_domain, 'connected_at', v_conn.connected_at) end,
    'settings', coalesce((select jsonb_object_agg(s.channel, jsonb_build_object('sync_stock', s.sync_stock, 'sync_prices', s.sync_prices,
                                                                                'send_tracking', s.send_tracking, 'cancel_on_store_cancel', s.cancel_on_store_cancel))
                            from public.dropship_channel_settings s where s.org_id = v_org), '{}'::jsonb),
    'waitlist', coalesce((select jsonb_agg(w.channel order by w.channel) from public.dropship_channel_waitlist w where w.org_id = v_org), '[]'::jsonb),
    'plan_name', v_plan ->> 'plan_name', 'stores_limit', nullif(v_plan ->> 'stores_limit', '')::integer, 'stores_used', coalesce((v_plan #>> '{usage,stores}')::integer, 0),
    'billing_enabled', (v_plan ->> 'billing_enabled')::boolean);
end $$;

create or replace function public.ds_channel_settings_save(p_channel text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_b jsonb;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  perform ds_assert_role(v_org, 'setup');
  if p_channel is null or p_channel not in ('shopify', 'woocommerce', 'tiktok_shop', 'wix', 'ebay') then raise exception 'BAD_CHANNEL: This channel is not available.'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'BAD_INPUT: Settings are missing.'; end if;
  foreach v_b in array array[p -> 'sync_stock', p -> 'sync_prices', p -> 'send_tracking', p -> 'cancel_on_store_cancel'] loop
    if v_b is null or jsonb_typeof(v_b) <> 'boolean' then raise exception 'BAD_INPUT: Each setting is on or off.'; end if;
  end loop;
  insert into public.dropship_channel_settings (org_id, channel, sync_stock, sync_prices, send_tracking, cancel_on_store_cancel)
  values (v_org, p_channel, (p ->> 'sync_stock')::boolean, (p ->> 'sync_prices')::boolean, (p ->> 'send_tracking')::boolean, (p ->> 'cancel_on_store_cancel')::boolean)
  on conflict (org_id, channel) do update
    set sync_stock = excluded.sync_stock, sync_prices = excluded.sync_prices, send_tracking = excluded.send_tracking,
        cancel_on_store_cancel = excluded.cancel_on_store_cancel, updated_at = now();
  perform write_audit('ds_channel.settings_saved', 'dropship_channel_settings', v_org::text || ':' || p_channel, p);
  return jsonb_build_object('ok', true);
end $$;

-- connect / test / reconnect / disconnect: honest refusal. Real connections open in the store-connection release (owner decision).
create or replace function public.ds_channel_action(p_channel text, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  perform ds_assert_role(v_org, 'setup');
  if p_channel not in ('shopify', 'woocommerce', 'tiktok_shop', 'wix', 'ebay', 'amazon') then raise exception 'BAD_CHANNEL: This channel is not available.'; end if;
  if p_action not in ('connect', 'test', 'reconnect', 'disconnect') then raise exception 'BAD_ACTION'; end if;
  raise exception 'CHANNEL_NOT_OPEN: Connections open in the store-connection release. Nothing was connected and nothing changed.';
end $$;

create or replace function public.ds_channel_waitlist(p_channel text, p_join boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  perform ds_assert_role(v_org, 'setup');
  if p_channel is null or p_channel not in ('amazon', 'woocommerce', 'tiktok_shop', 'wix', 'ebay') then raise exception 'BAD_CHANNEL: This channel is not available.'; end if;
  if p_join then
    insert into public.dropship_channel_waitlist (org_id, channel) values (v_org, p_channel) on conflict do nothing;
  else
    delete from public.dropship_channel_waitlist where org_id = v_org and channel = p_channel;
  end if;
  perform write_audit('ds_channel.waitlist_' || case when p_join then 'joined' else 'left' end, 'dropship_channel_waitlist', v_org::text || ':' || p_channel, null);
  return jsonb_build_object('joined', p_join);
end $$;

-- ───────────────────────── 7. Staff: Invoicing (view) and Docs ─────────────────────────
create or replace function public.ds_staff_invoices(p_type text, p_q text, p_from date, p_to date, p_status text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 2000);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform ds14_assert('finance');
  return jsonb_build_object(
    'entity', (select jsonb_build_object('code', e.code, 'legal_name', e.legal_name, 'tax_id', e.tax_id, 'registered_in', e.registered_in, 'currency', e.default_currency)
                 from public.legal_entities e where e.is_default and e.status = 'active' limit 1),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'number', z.number, 'type', z.doc_type, 'created_at', z.created_at, 'amount_cents', z.amount_cents, 'currency', z.currency,
                                          'status', z.status, 'kind', z.data ->> 'kind', 'merchant', z.merchant) order by z.created_at desc)
        from (select x.id, x.number, x.doc_type, x.created_at, x.amount_cents, x.currency, x.status, x.data, o.name merchant
                from public.documents x left join public.organizations o on o.id = x.org_id
               where x.doc_type in ('commercial_invoice', 'credit_note', 'statement')
                 and (x.division_id = division_id_of('DS') or x.number ~ '^(OCT|STMT|CN)-DS-')
                 and (p_type is null or p_type = '' or (p_type = 'invoice' and x.doc_type = 'commercial_invoice') or (p_type = 'credit_note' and x.doc_type = 'credit_note') or (p_type = 'statement' and x.doc_type = 'statement'))
                 and (p_status is null or p_status = '' or x.status = p_status)
                 and (p_from is null or x.created_at >= p_from) and (p_to is null or x.created_at < p_to + 1)
                 and (v_q is null or x.number ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or o.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
               order by x.created_at desc limit v_limit) z), '[]'::jsonb),
    'limit', v_limit);
end $$;

create or replace function public.ds_docs_page(p_q text, p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform ds14_assert('view');
  return jsonb_build_object(
    'can_edit', ds14_staff_can('edit'),
    'docs', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'doc_number', x.doc_number, 'issuer', x.issuer, 'status', x.status,
        'effective_status', case when x.status = 'verified' and x.expires_on is not null and x.expires_on < current_date then 'expired' else x.status end,
        'expires_on', x.expires_on, 'mime', x.mime, 'size_bytes', x.size_bytes, 'review_note', x.review_note, 'created_at', x.created_at,
        'product_id', x.product_id, 'product', x.ptitle, 'model_no', x.pmodel, 'supplier_code', x.scode) order by x.created_at desc)
        from (select d.*, dp.title ptitle, dp.model_no pmodel, s.code scode
                from public.dropship_product_documents d
                left join public.dropship_products dp on dp.id = d.product_id left join public.suppliers s on s.id = d.supplier_id
               where (p_status is null or p_status = '' or d.status = p_status or (p_status = 'expired' and d.status = 'verified' and d.expires_on < current_date))
                 and (v_q is null or d.title ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or dp.title ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
                      or dp.model_no ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
               order by d.created_at desc limit 500) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', dp.id, 'model_no', dp.model_no, 'title', dp.title) order by dp.model_no)
                            from (select id, model_no, title from public.dropship_products where status <> 'archived' order by created_at desc limit 500) dp), '[]'::jsonb));
end $$;

create or replace function public.ds_doc_register(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.dropship_product_documents;
begin
  perform ds14_assert('edit');
  insert into public.dropship_product_documents (product_id, supplier_id, kind, title, doc_number, issuer, expires_on, storage_path, mime, size_bytes)
  values (nullif(p ->> 'product_id', '')::uuid, null, p ->> 'kind', btrim(coalesce(p ->> 'title', '')), nullif(btrim(coalesce(p ->> 'doc_number', '')), ''),
          nullif(btrim(coalesce(p ->> 'issuer', '')), ''), nullif(p ->> 'expires_on', '')::date, p ->> 'storage_path', p ->> 'mime', (p ->> 'size_bytes')::integer)
  returning * into v;
  perform write_audit('ds_doc.registered', 'dropship_product_documents', v.id::text, jsonb_build_object('kind', v.kind, 'product_id', v.product_id));
  return jsonb_build_object('id', v.id);
exception when check_violation or invalid_text_representation or foreign_key_violation then
  raise exception 'INVALID: Check the title, type, file (PDF, PNG or JPG up to 10 MB) and expiry date.';
end $$;

create or replace function public.ds_doc_link(p_doc uuid, p_product uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform ds14_assert('edit');
  if p_product is not null and not exists (select 1 from public.dropship_products where id = p_product) then raise exception 'NOT_FOUND: Product not found.'; end if;
  update public.dropship_product_documents set product_id = p_product where id = p_doc;
  if not found then raise exception 'NOT_FOUND: Document not found.'; end if;
  perform write_audit(case when p_product is null then 'ds_doc.unlinked' else 'ds_doc.linked' end, 'dropship_product_documents', p_doc::text, jsonb_build_object('product_id', p_product));
  return jsonb_build_object('product_id', p_product);
end $$;

create or replace function public.ds_doc_set_status(p_doc uuid, p_status text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform ds14_assert('edit');
  if p_status not in ('pending', 'verified', 'rejected') then raise exception 'BAD_STATUS'; end if;
  if p_status = 'rejected' and (v_note is null or length(v_note) < 3) then raise exception 'NOTE_REQUIRED: Say why the document is rejected.'; end if;
  update public.dropship_product_documents
     set status = p_status, review_note = v_note, verified_by = case when p_status = 'verified' then auth.uid() end, verified_at = case when p_status = 'verified' then now() end
   where id = p_doc;
  if not found then raise exception 'NOT_FOUND: Document not found.'; end if;
  perform write_audit('ds_doc.' || p_status, 'dropship_product_documents', p_doc::text, jsonb_build_object('note', v_note));
  return jsonb_build_object('status', p_status);
end $$;

-- the file path for a signed link (the server signs it with the service role after this staff check; the view is audited)
create or replace function public.ds_doc_path(p_doc uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v text;
begin
  perform ds14_assert('view');
  select storage_path into v from public.dropship_product_documents where id = p_doc;
  if v is null then raise exception 'NOT_FOUND: Document not found.'; end if;
  perform write_audit('ds_doc.viewed', 'dropship_product_documents', p_doc::text, null);
  return v;
end $$;

-- ───────────────────────── 8. Grants ─────────────────────────
do $$
declare
  f text;
  r record;
  rpc text[] := array['ds_sup_home', 'ds_sup_products', 'ds_sup_stock_update', 'ds_sup_price_change', 'ds_sup_save_product', 'ds_sup_bulk', 'ds_sup_submission_get',
    'ds_sup_orders', 'ds_sup_order', 'ds_sup_slip', 'ds_sup_order_ship', 'ds_sup_order_problem', 'ds_staff_approvals_page', 'ds_staff_approval_get',
    'ds_staff_approval_decide', 'ds_staff_rules_save', 'ds_staff_suppliers_page', 'ds_partner_assign', 'ds_partner_order_cancel', 'ds_supplier_link_user',
    'ds_supplier_application_checks', 'ds_partners_page', 'ds_partner_invite', 'ds_partner_set_status', 'ds_partner_attach', 'ds_partner_rule_save',
    'ds_channels_page', 'ds_channel_settings_save', 'ds_channel_action', 'ds_channel_waitlist', 'ds_staff_invoices', 'ds_docs_page', 'ds_doc_register',
    'ds_doc_link', 'ds_doc_set_status', 'ds_doc_path'];
  internals text[] := array['ds14_staff_can', 'ds14_assert', 'ds14_supplier', 'ds14_rules', 'ds14_cents', 'ds14_int', 'ds14_num', 'ds14_bool', 'ds14_validate_product', 'ds14_sku_clash',
    'ds14_sku_clash_other', 'ds14_bulk_group', 'ds14_apply_price', 'ds14_create_draft', 'ds14_sup_order_row', 'ds14_partner_accrue'];
begin
  for r in select p.oid::regprocedure::text sig, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (rpc || internals) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = any (rpc) then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;

-- ───────────────────────── 9. Schedule (pg_cron, where installed): partner commissions follow the plan charges ─────────────────────────
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-partner-commission') then
      perform cron.unschedule('octopus-dropship-partner-commission');
    end if;
    perform cron.schedule('octopus-dropship-partner-commission', '40 * * * *', 'select public.ds14_partner_accrue()');
  end if;
end $$;
