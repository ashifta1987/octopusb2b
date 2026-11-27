-- CH-1 · Shop (main page after a customer logs in): quote list, request lines, recently viewed, personal picks.
-- Installs as 251 on top of 250 (C0). Owner "go" 27 Nov 2026. Plan: ch1_step0_plan.md.
--  1. rfq_lines: one RFQ can carry several products. rfqs.product_id / quantity stay = line 1, so every existing screen keeps working.
--     Read = exactly the RFQ's own visibility (policy reads rfqs under RLS). Written only by the RPCs below.
--  2. quote_list_items: a company's quote list (company, product, qty, notes). Read by the company; written by RPC only.
--  3. product_views: "Recently viewed" + personalisation. Each user reads only their own rows; newest 50 kept.
--  4. RPCs: shop_submit_rfq (MOQ check → core_submit_rfq: sourcing fee from settings, wallet charge, events → line 1),
--     quote_list_add / _update / _remove / _submit (ONE RFQ with N lines, fee once, list emptied), shop_record_view,
--     shop_personal_picks (product ids only), wh_link_my_application (3PL application → the signed-in company, single sign-in gap G1).
--  5. Tags "customisable" and "samples" (kind service) for the shop filters; staff tag products.
-- White-label: every RPC returns ids / RFQ codes only — never supplier, cost or margin. Roles: owner + buyer act; viewer browses.

-- ───────────────────────── 1. tables ─────────────────────────
create table if not exists public.rfq_lines (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  line_no integer not null check (line_no between 1 and 50),
  product_id uuid references public.products(id),
  title text not null check (length(title) between 1 and 300),
  quantity integer not null check (quantity > 0),
  unit text not null default 'pcs',
  target_price_minor bigint check (target_price_minor is null or target_price_minor >= 0),
  customisation text[] not null default '{}',
  notes text check (notes is null or length(notes) <= 2000),
  idem_key text,
  created_at timestamptz not null default now(),
  constraint rfq_lines_rfq_line_key unique (rfq_id, line_no)
);
create unique index if not exists rfq_lines_idem_key on public.rfq_lines (idem_key) where idem_key is not null;
create index if not exists rfq_lines_product_idx on public.rfq_lines (product_id);
comment on table public.rfq_lines is 'CH-1: products of a sourcing request (RFQ). Line 1 = rfqs.product_id/quantity. Written only by shop_submit_rfq / quote_list_submit.';

create table if not exists public.quote_list_items (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0 and quantity <= 10000000),
  notes text check (notes is null or length(notes) <= 1000),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint quote_list_items_org_product_key unique (org_id, product_id)
);
create index if not exists quote_list_items_org_idx on public.quote_list_items (org_id, seq);
comment on table public.quote_list_items is 'CH-1: a company''s quote list. "Send all as one request" turns it into one RFQ with lines (quote_list_submit).';

create table if not exists public.product_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  views integer not null default 1 check (views > 0),
  viewed_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists product_views_user_idx on public.product_views (user_id, viewed_at desc);
comment on table public.product_views is 'CH-1: products a signed-in customer opened in the shop (newest 50 per user). Recently viewed + personal picks.';

-- ───────────────────────── 2. RLS + grants ─────────────────────────
alter table public.rfq_lines enable row level security;
alter table public.quote_list_items enable row level security;
alter table public.product_views enable row level security;
revoke all on table public.rfq_lines from public, anon, authenticated;
revoke all on table public.quote_list_items from public, anon, authenticated;
revoke all on table public.product_views from public, anon, authenticated;

-- the RFQ's own read policies decide (customer company, request staff in their division, account manager, assistant, distributor)
drop policy if exists rfq_lines_read on public.rfq_lines;
create policy rfq_lines_read on public.rfq_lines for select to authenticated
  using (exists (select 1 from public.rfqs r where r.id = rfq_lines.rfq_id));
grant select (id, rfq_id, line_no, product_id, title, quantity, unit, target_price_minor, customisation, notes, created_at)
  on table public.rfq_lines to authenticated;

drop policy if exists quote_list_items_read on public.quote_list_items;
create policy quote_list_items_read on public.quote_list_items for select to authenticated
  using (org_id in (select public.my_org_ids()));
grant select (id, seq, org_id, product_id, quantity, notes, created_at, updated_at) on table public.quote_list_items to authenticated;

drop policy if exists product_views_own_read on public.product_views;
create policy product_views_own_read on public.product_views for select to authenticated
  using (user_id = (select auth.uid()));
grant select (product_id, views, viewed_at) on table public.product_views to authenticated;

-- ───────────────────────── 3. helpers ─────────────────────────
-- Shop roles (CH-1): owner + buyer may request / sample / use the quote list; viewer browses. CH-2 adds the per-service roles here.
create or replace function public.shop_member_can()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select m.member_role in ('owner', 'buyer') from public.org_members m
                    where m.user_id = auth.uid() and m.org_id = public.my_org_id()), false);
$$;

-- signed-in customer of a live company with a role that may act → the company id
create or replace function public.shop_guard()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.my_org_id();
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if public.user_is_staff(auth.uid()) then raise exception 'STAFF_CANNOT_BE_CUSTOMER'; end if;
  if v_org is null or not exists (select 1 from public.organizations o where o.id = v_org and o.archived_at is null) then raise exception 'NO_ORG'; end if;
  if not public.shop_member_can() then raise exception 'ROLE_NOT_ALLOWED'; end if;
  return v_org;
end $$;

-- clean text input (trim, empty → null, length cap)
create or replace function public.shop_clean(p text, p_max integer)
returns text language plpgsql immutable set search_path = public as $$
declare v text := nullif(btrim(coalesce(p, '')), '');
begin
  if v is not null and length(v) > p_max then raise exception 'INVALID_INPUT: text longer than % characters', p_max; end if;
  return v;
end $$;

-- ───────────────────────── 4. single request from the product page ─────────────────────────
create or replace function public.shop_submit_rfq(
  p_product uuid, p_quantity integer, p_destination_country text, p_destination_city text default null,
  p_target_price_cents bigint default null, p_customisation text[] default '{}', p_notes text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.shop_guard();
  v_key text; v_rfq uuid; v_p record; v_country text := upper(btrim(coalesce(p_destination_country, '')));
  v_city text := public.shop_clean(p_destination_city, 80); v_notes text := public.shop_clean(p_notes, 2000);
  v_custom text[]; v_details text;
begin
  if p_idem is not null and p_idem !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'INVALID_INPUT: request key'; end if;
  v_key := case when p_idem is null then null else v_org::text || ':' || p_idem end;
  if v_key is not null then
    select l.rfq_id into v_rfq from public.rfq_lines l where l.idem_key = v_key;
    if v_rfq is not null then return jsonb_build_object('id', v_rfq, 'code', (select code from public.rfqs where id = v_rfq), 'lines', 1, 'duplicate', true); end if;
  end if;
  select id, title, unit, moq into v_p from public.products where id = p_product and status = 'live' and archived_at is null;
  if v_p.id is null then raise exception 'NOT_FOUND: product'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_quantity < coalesce(v_p.moq, 1) then raise exception 'BELOW_MOQ: % | %', coalesce(v_p.moq, 1), v_p.title; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'SHIP_TO_REQUIRED'; end if;
  if p_target_price_cents is not null and p_target_price_cents < 0 then raise exception 'INVALID_AMOUNT'; end if;
  select coalesce(array_agg(x), '{}') into v_custom
    from (select distinct public.shop_clean(c, 60) x from unnest(coalesce(p_customisation, '{}')) c) s where x is not null;
  if cardinality(v_custom) > 8 then raise exception 'INVALID_INPUT: at most 8 customisation options'; end if;
  v_details := concat_ws(E'\n\n', v_notes, case when cardinality(v_custom) > 0 then 'Customisation: ' || array_to_string(v_custom, ', ') end);
  v_rfq := public.core_submit_rfq(v_org, auth.uid(), v_p.title, p_quantity, v_details, v_p.id, v_country, v_city,
                                  p_target_price_cents, null, case when v_key is null then null else 'rfq:' || v_key end, 'shop');
  insert into public.rfq_lines (rfq_id, line_no, product_id, title, quantity, unit, target_price_minor, customisation, notes, idem_key)
    values (v_rfq, 1, v_p.id, v_p.title, p_quantity, coalesce(v_p.unit, 'pcs'), p_target_price_cents, v_custom, v_notes, v_key);
  perform public.write_audit('shop.rfq_submitted', 'rfq', v_rfq::text, jsonb_build_object('lines', 1, 'source', 'shop'));
  return jsonb_build_object('id', v_rfq, 'code', (select code from public.rfqs where id = v_rfq), 'lines', 1, 'duplicate', false);
end $$;

-- ───────────────────────── 5. quote list ─────────────────────────
create or replace function public.quote_list_add(p_product uuid, p_quantity integer default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard(); v_p record; v_n integer;
begin
  select id, moq into v_p from public.products where id = p_product and status = 'live' and archived_at is null;
  if v_p.id is null then raise exception 'NOT_FOUND: product'; end if;
  if p_quantity is not null and (p_quantity <= 0 or p_quantity > 10000000) then raise exception 'INVALID_QUANTITY'; end if;
  if not exists (select 1 from public.quote_list_items where org_id = v_org and product_id = v_p.id)
     and (select count(*) from public.quote_list_items where org_id = v_org) >= 50 then
    raise exception 'QUOTE_LIST_FULL';
  end if;
  insert into public.quote_list_items (org_id, product_id, quantity, notes, added_by)
    values (v_org, v_p.id, coalesce(p_quantity, greatest(coalesce(v_p.moq, 1), 1)), public.shop_clean(p_notes, 1000), auth.uid())
  on conflict (org_id, product_id) do update
    set quantity = coalesce(p_quantity, public.quote_list_items.quantity),
        notes = coalesce(excluded.notes, public.quote_list_items.notes), updated_at = now();
  select count(*) into v_n from public.quote_list_items where org_id = v_org;
  return jsonb_build_object('count', v_n);
end $$;

create or replace function public.quote_list_update(p_item uuid, p_quantity integer, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard();
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 10000000 then raise exception 'INVALID_QUANTITY'; end if;
  update public.quote_list_items set quantity = p_quantity, notes = public.shop_clean(p_notes, 1000), updated_at = now()
   where id = p_item and org_id = v_org;
  if not found then raise exception 'NOT_FOUND: quote list item'; end if;
  return jsonb_build_object('count', (select count(*) from public.quote_list_items where org_id = v_org));
end $$;

create or replace function public.quote_list_remove(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.shop_guard();
begin
  delete from public.quote_list_items where id = p_item and org_id = v_org;
  return jsonb_build_object('count', (select count(*) from public.quote_list_items where org_id = v_org));
end $$;

-- "Send all as one request": ONE RFQ (code RFQ-<n>) with one line per product; the sourcing fee is charged once (settings).
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
  select count(*) into v_n from public.quote_list_items where org_id = v_org;
  if v_n = 0 then raise exception 'QUOTE_LIST_EMPTY'; end if;
  -- every product must still be live and at or above its MOQ (the message names the product)
  select p.title, p.status::text st, p.archived_at, coalesce(p.moq, 1) moq, q.quantity into v_bad
    from public.quote_list_items q join public.products p on p.id = q.product_id
   where q.org_id = v_org and (p.status <> 'live' or p.archived_at is not null or q.quantity < coalesce(p.moq, 1))
   order by q.seq limit 1;
  if v_bad.title is not null then
    if v_bad.st <> 'live' or v_bad.archived_at is not null then raise exception 'PRODUCT_UNAVAILABLE: %', v_bad.title; end if;
    raise exception 'BELOW_MOQ: % | %', v_bad.moq, v_bad.title;
  end if;
  select q.product_id, q.quantity, p.title into v_first
    from public.quote_list_items q join public.products p on p.id = q.product_id
   where q.org_id = v_org order by q.seq limit 1;
  select string_agg(t, ', ') into v_list from (
    select p.title t from public.quote_list_items q join public.products p on p.id = q.product_id
     where q.org_id = v_org order by q.seq limit 3) s;
  v_title := left(case when v_n = 1 then v_first.title else v_n || ' products: ' || v_list || case when v_n > 3 then ', …' else '' end end, 300);
  v_rfq := public.core_submit_rfq(v_org, auth.uid(), v_title, v_first.quantity,
             concat_ws(E'\n\n', v_notes, (select string_agg(rn || '. ' || t || ' — ' || qty || ' ' || u || coalesce(' (' || n || ')', ''), E'\n' order by rn)
               from (select row_number() over (order by q.seq) rn, p.title t, q.quantity qty, coalesce(p.unit, 'pcs') u, q.notes n
                       from public.quote_list_items q join public.products p on p.id = q.product_id where q.org_id = v_org) s)),
             v_first.product_id, v_country, v_city, null, null, case when v_key is null then null else 'rfq:' || v_key end, 'shop_quote_list');
  insert into public.rfq_lines (rfq_id, line_no, product_id, title, quantity, unit, notes, idem_key)
    select v_rfq, s.rn, s.product_id, s.title, s.quantity, s.unit, s.notes, case when s.rn = 1 then v_key end
      from (select row_number() over (order by q.seq)::integer rn, q.product_id, p.title, q.quantity, coalesce(p.unit, 'pcs') unit, q.notes
              from public.quote_list_items q join public.products p on p.id = q.product_id where q.org_id = v_org) s;
  delete from public.quote_list_items where org_id = v_org;
  perform public.write_audit('shop.quote_list_submitted', 'rfq', v_rfq::text, jsonb_build_object('lines', v_n, 'source', 'shop_quote_list'));
  return jsonb_build_object('id', v_rfq, 'code', (select code from public.rfqs where id = v_rfq), 'lines', v_n, 'duplicate', false);
end $$;

-- ───────────────────────── 6. recently viewed + personal picks ─────────────────────────
create or replace function public.shop_record_view(p_product uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.user_is_staff(auth.uid()) then return; end if;
  if not exists (select 1 from public.products where id = p_product and status = 'live' and archived_at is null) then return; end if;
  insert into public.product_views (user_id, org_id, product_id) values (auth.uid(), public.my_org_id(), p_product)
  on conflict (user_id, product_id) do update set views = public.product_views.views + 1, viewed_at = now(), org_id = excluded.org_id;
  delete from public.product_views v where v.user_id = auth.uid() and v.product_id in (
    select x.product_id from public.product_views x where x.user_id = auth.uid() order by x.viewed_at desc, x.product_id offset 50);
end $$;

-- Ranked live product ids for "Recommended for you": the company's request / quote-list categories and the member's viewed categories
-- first, then popular (most requested in 90 days, all companies — ids only, no counts), then featured, then newest. Photos first.
create or replace function public.shop_personal_picks(p_limit integer default 8)
returns table (product_id uuid, reason text) language sql stable security definer set search_path = public as $$
  with me as (select public.my_org_id() org, auth.uid() uid),
  cats as (
    select p.category_id c, 3 w from public.rfqs r join public.products p on p.id = r.product_id, me
     where r.org_id = me.org and r.created_at > now() - interval '365 days'
    union all
    select p.category_id, 3 from public.rfq_lines l join public.rfqs r on r.id = l.rfq_id join public.products p on p.id = l.product_id, me
     where r.org_id = me.org and l.line_no > 1
    union all
    select p.category_id, 2 from public.quote_list_items q join public.products p on p.id = q.product_id, me where q.org_id = me.org
    union all
    select p.category_id, least(v.views, 5) from public.product_views v join public.products p on p.id = v.product_id, me where v.user_id = me.uid
  ),
  cw as (select c, sum(w) w from cats where c is not null group by c),
  pop as (
    select pid, count(*) n from (
      select r.product_id pid from public.rfqs r where r.created_at > now() - interval '90 days' and r.product_id is not null
      union all
      select l.product_id from public.rfq_lines l join public.rfqs r on r.id = l.rfq_id
       where r.created_at > now() - interval '90 days' and l.line_no > 1 and l.product_id is not null) s
    group by pid
  )
  select p.id,
         case when coalesce(cw.w, 0) > 0 then 'history' when coalesce(pop.n, 0) > 0 then 'popular' when p.featured then 'featured' else 'newest' end
    from public.products p left join cw on cw.c = p.category_id left join pop on pop.pid = p.id
   where p.status = 'live' and p.archived_at is null
   order by coalesce(cw.w, 0) desc, (p.image_url is not null) desc, coalesce(pop.n, 0) desc, p.featured desc, p.created_at desc, p.id
   limit greatest(1, least(coalesce(p_limit, 8), 24));
$$;

-- ───────────────────────── 7. single sign-in gap G1: 3PL application → the signed-in company ─────────────────────────
create or replace function public.wh_link_my_application(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_id uuid;
begin
  if auth.uid() is null or v_org is null then return false; end if;
  update public.wh_applications set org_id = v_org
   where code = p_code and submitted_by = auth.uid() and org_id is null and created_at > now() - interval '1 hour'
  returning id into v_id;
  if v_id is null then return false; end if;
  perform public.write_audit('wh_application.linked_to_company', 'wh_applications', v_id::text, jsonb_build_object('code', p_code, 'org_id', v_org));
  return true;
end $$;

-- ───────────────────────── 8. filter tags ─────────────────────────
insert into public.tags (name, slug, kind) values ('Customisable', 'customisable', 'service'), ('Samples available', 'samples', 'service')
on conflict (slug) do nothing;

-- ───────────────────────── 9. function grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'shop_member_can()', 'shop_guard()', 'shop_clean(text,integer)',
    'shop_submit_rfq(uuid,integer,text,text,bigint,text[],text,text)',
    'quote_list_add(uuid,integer,text)', 'quote_list_update(uuid,integer,text)', 'quote_list_remove(uuid)',
    'quote_list_submit(text,text,text,text)', 'shop_record_view(uuid)', 'shop_personal_picks(integer)', 'wh_link_my_application(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'shop_submit_rfq(uuid,integer,text,text,bigint,text[],text,text)',
    'quote_list_add(uuid,integer,text)', 'quote_list_update(uuid,integer,text)', 'quote_list_remove(uuid)',
    'quote_list_submit(text,text,text,text)', 'shop_record_view(uuid)', 'shop_personal_picks(integer)', 'wh_link_my_application(text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
