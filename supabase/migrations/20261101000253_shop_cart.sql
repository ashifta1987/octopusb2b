-- DRAFT — NOT APPLIED. ODS T5a · Shop cart without money (Part 5.8). Installs as 253 on top of 252 (company_interests, draft).
-- Status: drafted by the T5a CART-DATA builder on 27 Nov 2026 for the owner's review. It is NOT in the approved migration plan:
-- do not run db-migrate with it until the owner says "go" (PART 1 rule 3). The app works without it: app/ods/shop/_lib/cart.ts
-- and app/ods/shop/cart/actions.ts detect the missing functions (PGRST202 / 42883) and show the quote list only.
--  1. shop_carts: ONE cart per company (ship-to country + city). shop_cart_items: the "Buy now" lines — sample · stock · pool ·
--     brand · service — with a unit price SNAPSHOT read from the source at add time (re-checked by shop_cart_recheck()).
--     One line per (company, kind, item): adding the same item again raises the quantity.
--  2. quote_list_items (251) gains target_price_minor, customisation (one of none / logo / packaging / colour) and saved_for_later.
--  3. RLS like 251: the company's members read (viewers too); NO direct writes — every write goes through the RPCs below
--     (security definer, shop_guard(): signed-in customer of a live company, owner or buyer; staff never act as customers).
--  4. RPCs: shop_cart_add / _update / _remove / _save_for_later / _set_ship_to / _recheck, quote_list_update_details,
--     shop_cart_lines (read, customer-safe), and a create-or-replace of quote_list_submit that sends only the lines NOT saved for
--     later and carries target price + customisation into rfq_lines (everything else identical to 251: fee once via
--     core_submit_rfq, idempotency, MOQ / live checks, the sent lines leave the list).
-- No money moves here: no ledger, wallet, payment, order or checkout writes. Prices are snapshots for display only; the
-- checkout (T5b) recalculates everything at "Place order".
-- White-label: every RPC returns ids, titles, codes, quantities and customer prices only — never supplier, cost or margin
-- (supplier_products is read inside shop_cart_stock() for a stock QUANTITY only).
-- Down: down/20261101000253_shop_cart.down.sql (drops 253's objects and restores the 251 quote_list_submit body exactly).

-- ───────────────────────── 1. types + tables ─────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'shop_cart_kind' and typnamespace = 'public'::regnamespace) then
    create type public.shop_cart_kind as enum ('sample', 'stock', 'pool', 'brand', 'service');
  end if;
end $$;

create table if not exists public.shop_carts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  ship_to_country char(2) check (ship_to_country is null or ship_to_country ~ '^[A-Z]{2}$'),
  ship_to_city text check (ship_to_city is null or length(ship_to_city) between 1 and 80),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_carts_org_key unique (org_id)
);
comment on table public.shop_carts is 'ODS T5a: one cart per company (ship-to). Lines: shop_cart_items (Buy now) + quote_list_items (Get a quote). Written only by the shop_cart_* RPCs.';

create table if not exists public.shop_cart_items (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind public.shop_cart_kind not null,
  ref_id text not null check (length(ref_id) between 1 and 80),
  product_id uuid references public.products(id) on delete cascade,
  pool_id uuid references public.pools(id) on delete cascade,
  qty integer not null check (qty > 0 and qty <= 10000000),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  currency char(3) not null default 'USD' check (currency in ('USD', 'CNY')),
  saved_for_later boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint shop_cart_items_org_kind_ref_key unique (org_id, kind, ref_id),
  constraint shop_cart_items_ref_check check (
    (kind in ('sample', 'stock') and product_id is not null and pool_id is null and ref_id = product_id::text)
    or (kind = 'pool' and pool_id is not null and product_id is not null and ref_id = pool_id::text)
    or (kind in ('brand', 'service') and product_id is null and pool_id is null and ref_id ~ '^[a-z0-9_]{1,40}$'))
);
create index if not exists shop_cart_items_org_idx on public.shop_cart_items (org_id, seq);
create index if not exists shop_cart_items_product_idx on public.shop_cart_items (product_id);
create index if not exists shop_cart_items_pool_idx on public.shop_cart_items (pool_id);
comment on table public.shop_cart_items is 'ODS T5a: "Buy now" cart lines (fixed price). unit_price_minor = snapshot from the source at add / re-check time, display only; checkout recalculates. Written only by the shop_cart_* RPCs.';

alter table public.quote_list_items
  add column if not exists target_price_minor bigint check (target_price_minor is null or target_price_minor >= 0),
  add column if not exists customisation text check (customisation is null or customisation in ('none', 'logo', 'packaging', 'colour')),
  add column if not exists saved_for_later boolean not null default false;

-- ───────────────────────── 2. RLS + grants ─────────────────────────
alter table public.shop_carts enable row level security;
alter table public.shop_cart_items enable row level security;
revoke all on table public.shop_carts from public, anon, authenticated;
revoke all on table public.shop_cart_items from public, anon, authenticated;

drop policy if exists shop_carts_read on public.shop_carts;
create policy shop_carts_read on public.shop_carts for select to authenticated
  using (org_id in (select public.my_org_ids()));
grant select (id, org_id, ship_to_country, ship_to_city, created_at, updated_at) on table public.shop_carts to authenticated;

drop policy if exists shop_cart_items_read on public.shop_cart_items;
create policy shop_cart_items_read on public.shop_cart_items for select to authenticated
  using (org_id in (select public.my_org_ids()));
grant select (id, seq, org_id, kind, ref_id, product_id, pool_id, qty, unit_price_minor, currency, saved_for_later, created_at, updated_at)
  on table public.shop_cart_items to authenticated;

grant select (target_price_minor, customisation, saved_for_later) on table public.quote_list_items to authenticated;

-- ───────────────────────── 3. helpers (internal: not executable by signed-in users) ─────────────────────────
-- Ready-stock quantity of a product: the sum of the tracked supplier stock (supplier_products.stock_qty, 211).
-- NULL = stock is not tracked (no limit), never 0. Returns a number only — no supplier data leaves this function.
create or replace function public.shop_cart_stock(p_product uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when count(sp.stock_qty) = 0 then null else least(sum(sp.stock_qty), 10000000)::integer end
    from public.supplier_products sp
   where sp.product_id = p_product and sp.status <> 'withdrawn';
$$;

-- Unit price of a product at a quantity from its price tiers, in p_currency: the highest tier whose minimum is at or below
-- the quantity; quantities under the first tier use the first tier (the same rule as the product page calculator).
-- NULL = no listed price (price on request).
create or replace function public.shop_cart_tier_price(p_product uuid, p_qty integer, p_currency text)
returns bigint language sql stable security definer set search_path = public as $$
  select public.convert_amount(t.unit_price_cents, t.currency::text, p_currency)
    from public.price_tiers t
   where t.product_id = p_product and t.unit_price_cents > 0
   order by (t.min_qty <= greatest(coalesce(p_qty, 0), 0)) desc,
            case when t.min_qty <= greatest(coalesce(p_qty, 0), 0) then -t.min_qty else t.min_qty end
   limit 1;
$$;

-- What a Buy-now line may be right now, read from its SOURCE (the only place prices and limits come from):
--   sample  ref = product id   live product; sample service active; price = the sample fee (settings › services), charged
--                              ONCE per request like today's request_service; 1–5 pieces.
--   stock   ref = product id   live + ready_to_ship; price = the product's tier for the quantity; min = MOQ, step 1,
--                              max = tracked stock (NULL = not tracked).
--   pool    ref = pool id      open pool (status open, before the deadline, pools on, platform currency, buyer cap not
--                              reached, the company hasn't joined yet); price = pool_unit_price at filled + qty; min = the
--                              pool's minimum pledge; deposit % from the pool.
--   brand   ref = service code (brand…)          active service with a fixed price > 0, else NO_FIXED_PRICE (→ Get a quote)
--   service ref = service code (not rfq/sample/  same; 1–10.
--                 dropship*/brand…)
-- s_available = false → s_reason is one of: INVALID_INPUT, NOT_FOUND, PRODUCT_UNAVAILABLE, NO_FIXED_PRICE, SERVICE_INACTIVE,
-- OUT_OF_STOCK, POOLS_DISABLED, POOL_NOT_OPEN, POOL_CURRENCY_MISMATCH, POOL_FULL, ALREADY_PLEDGED.
create or replace function public.shop_cart_source(
  p_kind public.shop_cart_kind, p_ref text, p_qty integer default null,
  out s_available boolean, out s_reason text, out s_title text, out s_product_id uuid, out s_pool_id uuid,
  out s_min_qty integer, out s_step_qty integer, out s_max_qty integer, out s_unit_price_minor bigint, out s_currency text,
  out s_deposit_pct integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur text := public.current_platform_currency();
  v_ref text := lower(btrim(coalesce(p_ref, '')));
  v_p record; v_pool record; v_svc record; v_buyers integer;
begin
  s_available := false; s_step_qty := 1; s_currency := v_cur;
  if p_kind in ('sample', 'stock', 'pool') and v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    s_reason := 'INVALID_INPUT'; return;
  end if;
  if p_kind in ('brand', 'service') and v_ref !~ '^[a-z0-9_]{1,40}$' then s_reason := 'INVALID_INPUT'; return; end if;

  if p_kind in ('sample', 'stock') then
    select p.id, p.title, p.status::text st, p.archived_at, greatest(coalesce(p.moq, 1), 1) moq, p.ready_to_ship
      into v_p from public.products p where p.id = v_ref::uuid;
    if v_p.id is null then s_reason := 'NOT_FOUND'; return; end if;
    s_title := v_p.title; s_product_id := v_p.id;
    if v_p.st <> 'live' or v_p.archived_at is not null then s_reason := 'PRODUCT_UNAVAILABLE'; return; end if;
    if p_kind = 'sample' then
      s_min_qty := 1; s_max_qty := 5;
      if not exists (select 1 from public.services where code = 'sample' and active) then s_reason := 'SERVICE_INACTIVE'; return; end if;
      s_unit_price_minor := public.current_service_price('sample', v_cur);
      if s_unit_price_minor is null then s_reason := 'NO_FIXED_PRICE'; return; end if;
    else
      s_min_qty := v_p.moq;
      if not v_p.ready_to_ship then s_reason := 'NO_FIXED_PRICE'; return; end if;
      s_max_qty := public.shop_cart_stock(v_p.id);
      s_unit_price_minor := public.shop_cart_tier_price(v_p.id, greatest(coalesce(p_qty, 0), s_min_qty), v_cur);
      if s_unit_price_minor is null then s_reason := 'NO_FIXED_PRICE'; return; end if;
      if s_max_qty is not null and s_max_qty < s_min_qty then s_reason := 'OUT_OF_STOCK'; return; end if;
    end if;
    s_available := true; return;
  end if;

  if p_kind = 'pool' then
    select pl.id, pl.product_id, pl.status::text st, pl.deadline_at, pl.currency::text cur, pl.fx_rate_id, pl.min_pledge, pl.max_buyers,
           pl.filled_qty, pl.deposit_pct, pr.title
      into v_pool from public.pools pl join public.products pr on pr.id = pl.product_id where pl.id = v_ref::uuid;
    if v_pool.id is null then s_reason := 'NOT_FOUND'; return; end if;
    s_title := v_pool.title; s_product_id := v_pool.product_id; s_pool_id := v_pool.id;
    s_min_qty := greatest(v_pool.min_pledge, 1); s_deposit_pct := v_pool.deposit_pct; s_currency := v_pool.cur;
    if not public.setting_bool('pool_enabled') then s_reason := 'POOLS_DISABLED'; return; end if;
    if v_pool.st <> 'open' or v_pool.deadline_at <= now() then s_reason := 'POOL_NOT_OPEN'; return; end if;
    if v_pool.cur <> v_cur then s_reason := 'POOL_CURRENCY_MISMATCH'; return; end if;
    select count(*) into v_buyers from public.pool_pledges where pool_id = v_pool.id and status in ('pending', 'paid');
    if v_buyers >= v_pool.max_buyers then s_reason := 'POOL_FULL'; return; end if;
    if exists (select 1 from public.pool_pledges where pool_id = v_pool.id and org_id = public.my_org_id() and status in ('pending', 'paid')) then
      s_reason := 'ALREADY_PLEDGED'; return;
    end if;
    s_unit_price_minor := public.pool_unit_price(v_pool.product_id, v_pool.filled_qty + greatest(coalesce(p_qty, 0), s_min_qty), v_pool.cur, v_pool.fx_rate_id);
    if s_unit_price_minor is null then s_reason := 'NO_FIXED_PRICE'; return; end if;
    s_available := true; return;
  end if;

  -- brand / service: a services row with a fixed price
  s_min_qty := 1; s_max_qty := 10;
  if (p_kind = 'brand' and v_ref not like 'brand%')
     or (p_kind = 'service' and (v_ref in ('rfq', 'sample', 'dropship', 'dropship_request') or v_ref like 'brand%')) then
    s_reason := 'NO_FIXED_PRICE'; return;
  end if;
  select code, name, active into v_svc from public.services where code = v_ref;
  if v_svc.code is null or not v_svc.active then s_reason := 'NO_FIXED_PRICE'; return; end if;
  s_title := v_svc.name;
  s_unit_price_minor := public.current_service_price(v_ref, v_cur);
  if coalesce(s_unit_price_minor, 0) <= 0 then s_reason := 'NO_FIXED_PRICE'; s_unit_price_minor := null; return; end if;
  s_available := true;
end $$;

-- Quantity rules (min / step / max) for a line; raises with the code the UI maps to a sentence.
create or replace function public.shop_cart_assert_qty(p_kind public.shop_cart_kind, p_qty integer, p_min integer, p_step integer, p_max integer, p_title text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_qty is null or p_qty <= 0 or p_qty > 10000000 then raise exception 'INVALID_QUANTITY'; end if;
  if p_qty < coalesce(p_min, 1) then raise exception 'BELOW_MOQ: % | %', coalesce(p_min, 1), coalesce(p_title, ''); end if;
  if coalesce(p_step, 1) > 1 and (p_qty - coalesce(p_min, 1)) % p_step <> 0 then raise exception 'QTY_STEP: % | %', p_step, coalesce(p_title, ''); end if;
  if p_max is not null and p_qty > p_max then
    if p_kind = 'stock' then raise exception 'ABOVE_STOCK: % | %', p_max, coalesce(p_title, ''); end if;
    raise exception 'ABOVE_MAX: % | %', p_max, coalesce(p_title, '');
  end if;
end $$;

-- Raise the source's reason as an error (add / update)
create or replace function public.shop_cart_raise(p_reason text, p_title text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_reason in ('NOT_FOUND', 'INVALID_INPUT') then raise exception '%: item', p_reason; end if;
  raise exception '%: %', p_reason, coalesce(p_title, '');
end $$;

-- Put a product on the company's quote list (re-check: pool closed / stock gone). Keeps the larger quantity; brings a
-- saved-for-later line back. NULL = not possible (product no longer live, or the list already holds 50 products).
create or replace function public.shop_cart_to_quote(p_org uuid, p_product uuid, p_qty integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.products where id = p_product and status = 'live' and archived_at is null) then return null; end if;
  if not exists (select 1 from public.quote_list_items where org_id = p_org and product_id = p_product)
     and (select count(*) from public.quote_list_items where org_id = p_org) >= 50 then
    return null;
  end if;
  insert into public.quote_list_items (org_id, product_id, quantity, added_by)
    values (p_org, p_product, least(greatest(coalesce(p_qty, 1), 1), 10000000), auth.uid())
  on conflict (org_id, product_id) do update
    set quantity = greatest(public.quote_list_items.quantity, excluded.quantity), saved_for_later = false, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- header count = every line of the company's cart (Buy now + Get a quote, saved for later included)
create or replace function public.shop_cart_count(p_org uuid)
returns integer language sql stable security definer set search_path = public as $$
  select ((select count(*) from public.shop_cart_items where org_id = p_org) + (select count(*) from public.quote_list_items where org_id = p_org))::integer;
$$;

-- ───────────────────────── 4. read (members, viewers included) ─────────────────────────
-- The company's Buy-now lines with what the cart page needs: customer-safe titles, the product slug / image, the pool code,
-- the CURRENT min / step / max and availability from the source, and the held deposit (pools). No supplier, cost or margin.
create or replace function public.shop_cart_lines()
returns table (
  id uuid, kind text, ref_id text, product_id uuid, pool_id uuid, qty integer, unit_price_minor bigint, currency text,
  saved_for_later boolean, title text, slug text, image_url text, unit text, pool_code text, deposit_pct integer, deposit_minor bigint,
  min_qty integer, step_qty integer, max_qty integer, available boolean, reason text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.kind::text, i.ref_id, i.product_id, i.pool_id, i.qty, i.unit_price_minor, i.currency::text, i.saved_for_later,
         coalesce(s.s_title, p.title, sv.name, i.ref_id), p.slug, p.image_url, p.unit, pl.code, pl.deposit_pct,
         case when i.kind = 'pool' then public.round_minor(i.unit_price_minor::numeric * i.qty * pl.deposit_pct / 100.0, i.currency::text) end,
         s.s_min_qty, s.s_step_qty, s.s_max_qty, s.s_available, s.s_reason, i.created_at
    from public.shop_cart_items i
    left join public.products p on p.id = i.product_id
    left join public.pools pl on pl.id = i.pool_id
    left join public.services sv on sv.code = i.ref_id and i.kind in ('brand', 'service')
    cross join lateral public.shop_cart_source(i.kind, i.ref_id, i.qty) s
   where auth.uid() is not null and not public.user_is_staff(auth.uid()) and i.org_id = public.my_org_id()
   order by i.seq;
$$;

-- ───────────────────────── 5. Buy-now lines ─────────────────────────
create or replace function public.shop_cart_add(p_kind text, p_ref text, p_qty integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.shop_guard();
  v_kind public.shop_cart_kind; v_ref text := lower(btrim(coalesce(p_ref, '')));
  v_old record; v_s record; v_qty integer; v_id uuid;
begin
  if p_kind is null or p_kind not in ('sample', 'stock', 'pool', 'brand', 'service') then raise exception 'INVALID_INPUT: line type'; end if;
  v_kind := p_kind::public.shop_cart_kind;
  if length(v_ref) not between 1 and 80 then raise exception 'INVALID_INPUT: item'; end if;
  if p_qty is not null and (p_qty <= 0 or p_qty > 10000000) then raise exception 'INVALID_QUANTITY'; end if;
  perform pg_advisory_xact_lock(hashtext('shop_cart:' || v_org::text));
  select id, qty into v_old from public.shop_cart_items where org_id = v_org and kind = v_kind and ref_id = v_ref;
  select * into v_s from public.shop_cart_source(v_kind, v_ref, null);
  if not v_s.s_available then perform public.shop_cart_raise(v_s.s_reason, v_s.s_title); end if;
  -- adding the same item again raises the quantity (no second line)
  v_qty := coalesce(v_old.qty, 0) + coalesce(p_qty, v_s.s_min_qty, 1);
  select * into v_s from public.shop_cart_source(v_kind, v_ref, v_qty);
  if not v_s.s_available then perform public.shop_cart_raise(v_s.s_reason, v_s.s_title); end if;
  perform public.shop_cart_assert_qty(v_kind, v_qty, v_s.s_min_qty, v_s.s_step_qty, v_s.s_max_qty, v_s.s_title);
  if v_old.id is null and (select count(*) from public.shop_cart_items where org_id = v_org) >= 50 then raise exception 'CART_FULL'; end if;
  insert into public.shop_cart_items (org_id, kind, ref_id, product_id, pool_id, qty, unit_price_minor, currency, added_by)
    values (v_org, v_kind, v_ref, v_s.s_product_id, v_s.s_pool_id, v_qty, v_s.s_unit_price_minor, v_s.s_currency, auth.uid())
  on conflict (org_id, kind, ref_id) do update
    set qty = excluded.qty, unit_price_minor = excluded.unit_price_minor, currency = excluded.currency,
        saved_for_later = false, updated_at = now()
  returning id into v_id;
  insert into public.shop_carts (org_id, updated_by) values (v_org, auth.uid())
  on conflict (org_id) do update set updated_at = now(), updated_by = excluded.updated_by;
  perform public.write_audit('shop.cart_line_added', 'shop_cart_items', v_id::text, jsonb_build_object('kind', v_kind, 'ref', v_ref, 'qty', v_qty));
  return jsonb_build_object('id', v_id, 'qty', v_qty, 'title', v_s.s_title, 'count', public.shop_cart_count(v_org));
end $$;

create or replace function public.shop_cart_update(p_item uuid, p_qty integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard(); v_old record; v_s record;
begin
  if p_qty is null or p_qty <= 0 or p_qty > 10000000 then raise exception 'INVALID_QUANTITY'; end if;
  select id, kind, ref_id into v_old from public.shop_cart_items where id = p_item and org_id = v_org for update;
  if v_old.id is null then raise exception 'NOT_FOUND: cart line'; end if;
  select * into v_s from public.shop_cart_source(v_old.kind, v_old.ref_id, p_qty);
  if not v_s.s_available then perform public.shop_cart_raise(v_s.s_reason, v_s.s_title); end if;
  perform public.shop_cart_assert_qty(v_old.kind, p_qty, v_s.s_min_qty, v_s.s_step_qty, v_s.s_max_qty, v_s.s_title);
  update public.shop_cart_items
     set qty = p_qty, unit_price_minor = v_s.s_unit_price_minor, currency = v_s.s_currency, updated_at = now()
   where id = v_old.id;
  return jsonb_build_object('id', v_old.id, 'qty', p_qty, 'count', public.shop_cart_count(v_org));
end $$;

create or replace function public.shop_cart_remove(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard();
begin
  delete from public.shop_cart_items where id = p_item and org_id = v_org;
  return jsonb_build_object('count', public.shop_cart_count(v_org));
end $$;

-- Save for later / move back, for either kind of line ('buy' = shop_cart_items, 'quote' = quote_list_items)
create or replace function public.shop_cart_save_for_later(p_line text, p_item uuid, p_saved boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard();
begin
  if p_saved is null then raise exception 'INVALID_INPUT: saved'; end if;
  if p_line = 'buy' then
    update public.shop_cart_items set saved_for_later = p_saved, updated_at = now() where id = p_item and org_id = v_org;
  elsif p_line = 'quote' then
    update public.quote_list_items set saved_for_later = p_saved, updated_at = now() where id = p_item and org_id = v_org;
  else
    raise exception 'INVALID_INPUT: line';
  end if;
  if not found then raise exception 'NOT_FOUND: cart line'; end if;
  return jsonb_build_object('count', public.shop_cart_count(v_org));
end $$;

-- ───────────────────────── 6. Get a quote details + ship-to ─────────────────────────
-- Quantity, optional target price (minor units) and customisation of a quote-list line. The MOQ is checked when the list is
-- sent (quote_list_submit), so a line below MOQ can be saved and shown with "Raise it or join a pool". Notes are kept.
create or replace function public.quote_list_update_details(p_item uuid, p_quantity integer, p_target_price_minor bigint default null, p_customisation text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard(); v_custom text := nullif(btrim(coalesce(p_customisation, '')), '');
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 10000000 then raise exception 'INVALID_QUANTITY'; end if;
  if p_target_price_minor is not null and (p_target_price_minor < 0 or p_target_price_minor > 100000000000) then raise exception 'INVALID_AMOUNT'; end if;
  if v_custom is not null and v_custom not in ('none', 'logo', 'packaging', 'colour') then raise exception 'INVALID_INPUT: customisation'; end if;
  update public.quote_list_items
     set quantity = p_quantity, target_price_minor = p_target_price_minor, customisation = v_custom, updated_at = now()
   where id = p_item and org_id = v_org;
  if not found then raise exception 'NOT_FOUND: quote list item'; end if;
  return jsonb_build_object('count', public.shop_cart_count(v_org));
end $$;

create or replace function public.shop_cart_set_ship_to(p_country text, p_city text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard(); v_country text := upper(btrim(coalesce(p_country, ''))); v_city text := public.shop_clean(p_city, 80);
begin
  if v_country !~ '^[A-Z]{2}$' then raise exception 'SHIP_TO_REQUIRED'; end if;
  insert into public.shop_carts (org_id, ship_to_country, ship_to_city, updated_by) values (v_org, v_country, v_city, auth.uid())
  on conflict (org_id) do update
    set ship_to_country = excluded.ship_to_country, ship_to_city = excluded.ship_to_city, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('country', v_country, 'city', v_city);
end $$;

-- ───────────────────────── 7. re-check (cart opens / checkout) ─────────────────────────
-- Re-reads every line from its source and APPLIES Part 5.8:
--   price changed  → the snapshot is updated                                  notice price-changed {fromMinor, toMinor}
--   stock reduced  → the quantity is lowered to the stock                     notice stock-reduced {fromQty, toQty}
--   pool closed / full / paused / other currency → the pool line is deleted and the product goes to the quote list with
--                    the same quantity                                         notice pool-closed (on the quote line)
--   ready stock gone (out of stock, no longer ready to ship, no price) → moved to the quote list the same way
--                                                                             notice unavailable {reason 'moved-to-quote'}
--   anything else unavailable → the line stays                                notice unavailable {reason <code>}
--   a quote-list product no longer live                                      notice unavailable {reason 'PRODUCT_UNAVAILABLE'}
-- Returns { notices: [{ line, id, title, kind, … }], changed: n }. Saved-for-later lines are re-checked too.
create or replace function public.shop_cart_recheck()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.shop_guard();
  r record; v_s record; v_qty integer; v_qid uuid; v_changed integer := 0; v_notices jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('shop_cart:' || v_org::text));
  for r in select i.id, i.kind, i.ref_id, i.product_id, i.qty, i.unit_price_minor, i.currency::text cur
             from public.shop_cart_items i where i.org_id = v_org order by i.seq for update loop
    select * into v_s from public.shop_cart_source(r.kind, r.ref_id, r.qty);
    if not v_s.s_available and (
         (r.kind = 'pool' and v_s.s_reason in ('POOL_NOT_OPEN', 'POOL_FULL', 'POOLS_DISABLED', 'POOL_CURRENCY_MISMATCH', 'NOT_FOUND'))
      or (r.kind = 'stock' and v_s.s_reason in ('OUT_OF_STOCK', 'NO_FIXED_PRICE'))) then
      v_qid := case when r.product_id is null then null else public.shop_cart_to_quote(v_org, r.product_id, r.qty) end;
      if v_qid is not null then
        delete from public.shop_cart_items where id = r.id;
        v_changed := v_changed + 1;
        v_notices := v_notices || jsonb_build_array(jsonb_build_object('line', 'quote', 'id', v_qid, 'title', v_s.s_title, 'kind',
                       case when r.kind = 'pool' then 'pool-closed' else 'unavailable' end, 'reason', 'moved-to-quote', 'fromLine', r.id));
      else
        v_notices := v_notices || jsonb_build_array(jsonb_build_object('line', 'buy', 'id', r.id, 'title', v_s.s_title, 'kind', 'unavailable', 'reason', v_s.s_reason));
      end if;
      continue;
    end if;
    if not v_s.s_available then
      v_notices := v_notices || jsonb_build_array(jsonb_build_object('line', 'buy', 'id', r.id, 'title', v_s.s_title, 'kind', 'unavailable', 'reason', v_s.s_reason));
      continue;
    end if;
    v_qty := r.qty;
    if r.kind = 'stock' and v_s.s_max_qty is not null and r.qty > v_s.s_max_qty then
      v_qty := v_s.s_max_qty;
      select * into v_s from public.shop_cart_source(r.kind, r.ref_id, v_qty);
      update public.shop_cart_items set qty = v_qty, updated_at = now() where id = r.id;
      v_changed := v_changed + 1;
      v_notices := v_notices || jsonb_build_array(jsonb_build_object('line', 'buy', 'id', r.id, 'title', v_s.s_title, 'kind', 'stock-reduced', 'fromQty', r.qty, 'toQty', v_qty));
    end if;
    if v_s.s_unit_price_minor is distinct from r.unit_price_minor or v_s.s_currency is distinct from r.cur then
      update public.shop_cart_items set unit_price_minor = v_s.s_unit_price_minor, currency = v_s.s_currency, updated_at = now() where id = r.id;
      v_changed := v_changed + 1;
      v_notices := v_notices || jsonb_build_array(jsonb_build_object('line', 'buy', 'id', r.id, 'title', v_s.s_title, 'kind', 'price-changed',
                     'fromMinor', r.unit_price_minor, 'toMinor', v_s.s_unit_price_minor));
    end if;
  end loop;
  for r in select q.id, p.title from public.quote_list_items q join public.products p on p.id = q.product_id
            where q.org_id = v_org and (p.status <> 'live' or p.archived_at is not null) order by q.seq loop
    v_notices := v_notices || jsonb_build_array(jsonb_build_object('line', 'quote', 'id', r.id, 'title', r.title, 'kind', 'unavailable', 'reason', 'PRODUCT_UNAVAILABLE'));
  end loop;
  if v_changed > 0 then
    update public.shop_carts set updated_at = now() where org_id = v_org;
    perform public.write_audit('shop.cart_rechecked', 'shop_carts', v_org::text, jsonb_build_object('changed', v_changed));
  end if;
  return jsonb_build_object('notices', v_notices, 'changed', v_changed);
end $$;

-- ───────────────────────── 8. quote_list_submit: skip saved-for-later, carry target price + customisation ─────────────────────────
-- Same as 251 except: only lines with saved_for_later = false are sent (and leave the list); each rfq_line gets the line's
-- target_price_minor and customisation (as the customer-facing label; 'none' → no customisation).
create or replace function public.quote_list_submit(
  p_destination_country text, p_destination_city text default null, p_notes text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.shop_guard();
  v_key text; v_rfq uuid; v_country text := upper(btrim(coalesce(p_destination_country, '')));
  v_city text := public.shop_clean(p_destination_city, 80); v_notes text := public.shop_clean(p_notes, 2000);
  v_n integer; v_bad record; v_first record; v_title text; v_list text;
begin
  if p_idem is not null and p_idem !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'INVALID_INPUT: request key'; end if;
  v_key := case when p_idem is null then null else v_org::text || ':' || p_idem end;
  if v_key is not null then
    select l.rfq_id into v_rfq from public.rfq_lines l where l.idem_key = v_key;
    if v_rfq is not null then
      return jsonb_build_object('id', v_rfq, 'code', (select code from public.rfqs where id = v_rfq),
                                'lines', (select count(*) from public.rfq_lines where rfq_id = v_rfq), 'duplicate', true);
    end if;
  end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'SHIP_TO_REQUIRED'; end if;
  perform 1 from public.quote_list_items where org_id = v_org for update;
  select count(*) into v_n from public.quote_list_items where org_id = v_org and not saved_for_later;
  if v_n = 0 then raise exception 'QUOTE_LIST_EMPTY'; end if;
  -- every product must still be live and at or above its MOQ (the message names the product)
  select p.title, p.status::text st, p.archived_at, coalesce(p.moq, 1) moq, q.quantity into v_bad
    from public.quote_list_items q join public.products p on p.id = q.product_id
   where q.org_id = v_org and not q.saved_for_later and (p.status <> 'live' or p.archived_at is not null or q.quantity < coalesce(p.moq, 1))
   order by q.seq limit 1;
  if v_bad.title is not null then
    if v_bad.st <> 'live' or v_bad.archived_at is not null then raise exception 'PRODUCT_UNAVAILABLE: %', v_bad.title; end if;
    raise exception 'BELOW_MOQ: % | %', v_bad.moq, v_bad.title;
  end if;
  select q.product_id, q.quantity, p.title into v_first
    from public.quote_list_items q join public.products p on p.id = q.product_id
   where q.org_id = v_org and not q.saved_for_later order by q.seq limit 1;
  select string_agg(t, ', ') into v_list from (
    select p.title t from public.quote_list_items q join public.products p on p.id = q.product_id
     where q.org_id = v_org and not q.saved_for_later order by q.seq limit 3) s;
  v_title := left(case when v_n = 1 then v_first.title else v_n || ' products: ' || v_list || case when v_n > 3 then ', …' else '' end end, 300);
  v_rfq := public.core_submit_rfq(v_org, auth.uid(), v_title, v_first.quantity,
             concat_ws(E'\n\n', v_notes, (select string_agg(rn || '. ' || t || ' — ' || qty || ' ' || u || coalesce(' (' || n || ')', ''), E'\n' order by rn)
               from (select row_number() over (order by q.seq) rn, p.title t, q.quantity qty, coalesce(p.unit, 'pcs') u, q.notes n
                       from public.quote_list_items q join public.products p on p.id = q.product_id where q.org_id = v_org and not q.saved_for_later) s)),
             v_first.product_id, v_country, v_city, null, null, case when v_key is null then null else 'rfq:' || v_key end, 'shop_quote_list');
  insert into public.rfq_lines (rfq_id, line_no, product_id, title, quantity, unit, target_price_minor, customisation, notes, idem_key)
    select v_rfq, s.rn, s.product_id, s.title, s.quantity, s.unit, s.target_price_minor, s.customisation, s.notes, case when s.rn = 1 then v_key end
      from (select row_number() over (order by q.seq)::integer rn, q.product_id, p.title, q.quantity, coalesce(p.unit, 'pcs') unit, q.notes,
                   q.target_price_minor,
                   case q.customisation when 'logo' then array['Your logo on the product'] when 'packaging' then array['Your packaging']
                                        when 'colour' then array['Your colour or material'] else '{}'::text[] end customisation
              from public.quote_list_items q join public.products p on p.id = q.product_id where q.org_id = v_org and not q.saved_for_later) s;
  delete from public.quote_list_items where org_id = v_org and not saved_for_later;
  perform public.write_audit('shop.quote_list_submitted', 'rfq', v_rfq::text, jsonb_build_object('lines', v_n, 'source', 'shop_quote_list'));
  return jsonb_build_object('id', v_rfq, 'code', (select code from public.rfqs where id = v_rfq), 'lines', v_n, 'duplicate', false);
end $$;

-- ───────────────────────── 9. function grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'shop_cart_stock(uuid)', 'shop_cart_tier_price(uuid,integer,text)', 'shop_cart_source(public.shop_cart_kind,text,integer)',
    'shop_cart_assert_qty(public.shop_cart_kind,integer,integer,integer,integer,text)', 'shop_cart_raise(text,text)',
    'shop_cart_to_quote(uuid,uuid,integer)', 'shop_cart_count(uuid)',
    'shop_cart_lines()', 'shop_cart_add(text,text,integer)', 'shop_cart_update(uuid,integer)', 'shop_cart_remove(uuid)',
    'shop_cart_save_for_later(text,uuid,boolean)', 'quote_list_update_details(uuid,integer,bigint,text)',
    'shop_cart_set_ship_to(text,text)', 'shop_cart_recheck()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'shop_cart_lines()', 'shop_cart_add(text,text,integer)', 'shop_cart_update(uuid,integer)', 'shop_cart_remove(uuid)',
    'shop_cart_save_for_later(text,uuid,boolean)', 'quote_list_update_details(uuid,integer,bigint,text)',
    'shop_cart_set_ship_to(text,text)', 'shop_cart_recheck()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
