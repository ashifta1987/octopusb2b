-- 20261101000205_dropship_catalogue_functions.sql
-- Dropshipping catalogue v2 functions (23 Nov 2026):
--  1. dropship_merchant_org(): verifies auth.uid() is NOT staff, NOT a supplier, and belongs to a company with
--     company_services(service='dropship', status in ('on','trial')). Otherwise returns NULL.
--  2. get_dropship_countries(): returns the merchant's selling countries (and whether locked_by_staff).
--  3. set_dropship_markets(p_countries, p_org_id, p_lock): merchant sets own selling countries from the supported list
--     (refused when locked_by_staff); account manager / DS staff / admin can set and lock/unlock. Audited in audit_log.
--  4. get_dropship_catalogue(p_country, p_search, p_category, p_page): SECURITY DEFINER with fixed search_path,
--     rate-limited (120 calls / min per user via auth_rate_hit), returns ONLY allowlisted columns for active products
--     from verified non-archived suppliers that have at least one active route to p_country (which must be in the
--     merchant's selling countries). Max 48 per page.
--  5. get_dropship_product(p_product_id, p_country): single product detail with allowlisted columns only.
--  6. dropship_whitelabel_hits(p_texts): staff-only check returning any supplier name, variant name, code,
--     manufacturer_code or handle found in the candidate strings.
--  7. dropship_rate_estimate(p_weight_g, p_unit_cost_cents, p_country, p_method): staff-only rate-card helper returning
--     estimated shipping, estimated duties, fee and suggested landed price (never auto-publishes).
-- Down: supabase/migrations/down/20261101000205_dropship_catalogue_functions.down.sql

-- ───────── 1. Merchant eligibility gate ─────────
create or replace function dropship_merchant_org() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then return null; end if;
  -- Staff accounts (even if using a customer session) never receive merchant catalogue rows
  if user_is_staff(v_uid) then return null; end if;
  -- Supplier accounts (user_roles 'supplier' or linked to a suppliers row) never receive merchant catalogue rows
  if exists (select 1 from user_roles where user_id = v_uid and role_code = 'supplier')
     or exists (select 1 from suppliers where user_id = v_uid) then
    return null;
  end if;
  -- Must be a member of an active (non-archived) customer organisation with Dropshipping switched on ('on' or 'trial')
  select m.org_id into v_org
    from org_members m
    join organizations o on o.id = m.org_id and o.archived_at is null
    join company_services cs on cs.org_id = m.org_id and cs.service = 'dropship' and cs.status in ('on', 'trial')
   where m.user_id = v_uid
   order by m.created_at asc
   limit 1;
  return v_org;
end $$;
revoke all on function dropship_merchant_org() from public, anon;
grant execute on function dropship_merchant_org() to authenticated, service_role;

-- ───────── 2. Merchant selling countries ─────────
create or replace function get_dropship_countries()
returns table (
  country text,
  locked_by_staff boolean,
  has_active_routes boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := dropship_merchant_org();
begin
  if v_org is null then return; end if;
  return query
    select m.country::text,
           m.locked_by_staff,
           exists (
             select 1
               from dropship_routes r
               join dropship_products p on p.id = r.product_id and p.status = 'active'
               left join suppliers s on s.id = p.supplier_id
              where r.destination_country = m.country
                and r.is_active
                and (p.source_type = 'own_warehouse' or (s.id is not null and s.verified and s.archived_at is null))
           ) as has_active_routes
      from dropship_markets m
     where m.org_id = v_org
     order by m.country;
end $$;
revoke all on function get_dropship_countries() from public, anon;
grant execute on function get_dropship_countries() to authenticated, service_role;

-- ───────── 3. Save selling countries (merchant or account manager / DS staff / admin) ─────────
create or replace function set_dropship_markets(
  p_countries text[],
  p_org_id uuid default null,
  p_lock boolean default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := v_uid is not null and is_staff();
  v_org uuid;
  v_locked boolean;
  v_supported text[];
  v_clean text[];
  v_before jsonb;
  v_after jsonb;
  v_new_lock boolean;
  c text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;

  if v_is_staff then
    v_org := p_org_id;
    if v_org is null then raise exception 'ORG_REQUIRED'; end if;
    if not (dropship_can_edit(division_id_of('DS')) or is_my_customer(v_org)) then
      raise exception 'FORBIDDEN: only Dropshipping staff, an admin, or the company''s account manager can edit selling countries';
    end if;
  else
    v_org := dropship_merchant_org();
    if v_org is null or (p_org_id is not null and p_org_id <> v_org) then
      raise exception 'FORBIDDEN: Dropshipping is not switched on for your account';
    end if;
  end if;

  select coalesce(bool_or(locked_by_staff), false),
         coalesce(jsonb_agg(country order by country), '[]'::jsonb)
    into v_locked, v_before
    from dropship_markets where org_id = v_org;

  if not v_is_staff and v_locked then
    raise exception 'MARKETS_LOCKED: Your account manager has locked your selling countries. Contact your account manager to change them.';
  end if;

  select coalesce(array_agg(upper(x)), array['AE','SA','GB','US','DE','FR','NL','AU','CA','SG','KW','QA','BH','OM'])
    into v_supported
    from jsonb_array_elements_text(
      coalesce((select value from site_settings where key = 'dropship.supported_countries'), '["AE","SA","GB","US","DE","FR","NL","AU","CA","SG","KW","QA","BH","OM"]'::jsonb)
    ) x;

  select coalesce(array_agg(distinct upper(btrim(x)) order by upper(btrim(x))), '{}')
    into v_clean
    from unnest(coalesce(p_countries, '{}')) x
   where btrim(x) <> '';

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    raise exception 'MARKETS_EMPTY: Choose at least one selling country';
  end if;

  foreach c in array v_clean loop
    if c !~ '^[A-Z]{2}$' or not (c = any(v_supported)) then
      raise exception 'MARKET_UNSUPPORTED: % is not in the supported Dropshipping countries list', c;
    end if;
  end loop;

  v_new_lock := case
    when v_is_staff and p_lock is not null then p_lock
    when v_is_staff then v_locked
    else false
  end;

  delete from dropship_markets where org_id = v_org;
  foreach c in array v_clean loop
    insert into dropship_markets (org_id, country, locked_by_staff, updated_by)
    values (v_org, c::char(2), v_new_lock, v_uid);
  end loop;

  v_after := to_jsonb(v_clean);
  insert into audit_log (actor_id, actor_kind, action, entity, entity_id, org_id, service, before, after, details, division_id)
  values (
    v_uid,
    case when v_is_staff then 'staff' else 'customer' end,
    'dropship.markets_updated',
    'dropship_markets',
    v_org::text,
    v_org,
    'dropship',
    jsonb_build_object('countries', v_before, 'locked_by_staff', v_locked),
    jsonb_build_object('countries', v_after, 'locked_by_staff', v_new_lock),
    jsonb_build_object('countries', v_after, 'locked_by_staff', v_new_lock),
    division_id_of('DS')
  );

  return jsonb_build_object('org_id', v_org, 'countries', v_after, 'locked_by_staff', v_new_lock);
end $$;
revoke all on function set_dropship_markets(text[], uuid, boolean) from public, anon;
grant execute on function set_dropship_markets(text[], uuid, boolean) to authenticated, service_role;

-- ───────── 4. Merchant catalogue query (SECURITY DEFINER, allowlisted columns only, rate-limited, max 48 per page) ─────────
create or replace function get_dropship_catalogue(
  p_country text,
  p_search text default null,
  p_category text default null,
  p_page integer default 1
)
returns table (
  product_id uuid,
  octopus_sku text,
  title text,
  description text,
  category text,
  images text[],
  specs jsonb,
  weight_g integer,
  dimensions_cm jsonb,
  min_order_qty integer,
  stock_status text,
  variants jsonb,
  routes jsonb,
  total_count bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_q text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_limit integer := 48;
  v_offset integer := (v_page - 1) * 48;
  v_rate jsonb;
begin
  -- Zero rows when not an eligible merchant with dropshipping switched on
  if v_org is null or v_uid is null then return; end if;

  -- Rate limit per user: 120 catalogue queries per 60 seconds
  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;

  -- Country must be one of the merchant's configured selling countries
  if v_country is null or v_country !~ '^[A-Z]{2}$' then return; end if;
  if not exists (select 1 from dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return;
  end if;

  return query
    with eligible as (
      select p.id,
             p.octopus_sku,
             p.title,
             p.description,
             p.category,
             p.images,
             p.specs,
             p.weight_g,
             p.dimensions_cm,
             p.min_order_qty,
             p.stock_status,
             p.created_at,
             (
               select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', v.id,
                     'octopus_sku', v.octopus_sku,
                     'options', v.options,
                     'price_adjust_cents', v.price_adjust_cents,
                     'stock_status', v.stock_status
                   ) order by v.sort, v.octopus_sku
                 ),
                 '[]'::jsonb
               )
               from dropship_variants v
              where v.product_id = p.id
             ) as variants_json,
             (
               select jsonb_agg(
                 jsonb_build_object(
                   'destination_country', r.destination_country,
                   'shipping_method', r.shipping_method,
                   'landed_price_cents', r.landed_price_cents,
                   'est_days_min', r.est_days_min,
                   'est_days_max', r.est_days_max
                 ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
               )
               from dropship_routes r
              where r.product_id = p.id
                and r.destination_country = v_country
                and r.is_active
             ) as routes_json
        from dropship_products p
        left join suppliers s on s.id = p.supplier_id
       where p.status = 'active'
         -- Only verified non-archived suppliers (or Octopus own warehouse with a verified supplier or internal stock)
         and (
           (p.supplier_id is not null and s.verified and s.archived_at is null)
           or (p.source_type = 'own_warehouse' and (p.supplier_id is null or (s.verified and s.archived_at is null)))
         )
         and exists (
           select 1 from dropship_routes r
            where r.product_id = p.id
              and r.destination_country = v_country
              and r.is_active
         )
         and (
           v_q is null
           or lower(p.title) like '%' || v_q || '%'
           or lower(coalesce(p.description, '')) like '%' || v_q || '%'
           or lower(coalesce(p.category, '')) like '%' || v_q || '%'
           or lower(p.octopus_sku) like '%' || v_q || '%'
         )
         and (v_cat is null or lower(coalesce(p.category, '')) = lower(v_cat))
    )
    select e.id as product_id,
           e.octopus_sku,
           e.title,
           e.description,
           e.category,
           e.images,
           e.specs,
           e.weight_g,
           e.dimensions_cm,
           e.min_order_qty,
           e.stock_status,
           e.variants_json as variants,
           e.routes_json as routes,
           count(*) over() as total_count
      from eligible e
     order by e.created_at desc, e.id
     limit v_limit offset v_offset;
end $$;
revoke all on function get_dropship_catalogue(text, text, text, integer) from public, anon;
grant execute on function get_dropship_catalogue(text, text, text, integer) to authenticated, service_role;

-- ───────── 5. Merchant single-product detail (allowlisted columns only) ─────────
create or replace function get_dropship_product(
  p_product_id uuid,
  p_country text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_rate jsonb;
  v_res jsonb;
begin
  if v_org is null or v_uid is null or p_product_id is null then return null; end if;

  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' then return null; end if;
  if not exists (select 1 from dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return null;
  end if;

  select jsonb_build_object(
           'product_id', p.id,
           'octopus_sku', p.octopus_sku,
           'title', p.title,
           'description', p.description,
           'category', p.category,
           'images', to_jsonb(p.images),
           'specs', p.specs,
           'weight_g', p.weight_g,
           'dimensions_cm', p.dimensions_cm,
           'min_order_qty', p.min_order_qty,
           'stock_status', p.stock_status,
           'variants', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'id', v.id,
                 'octopus_sku', v.octopus_sku,
                 'options', v.options,
                 'price_adjust_cents', v.price_adjust_cents,
                 'stock_status', v.stock_status
               ) order by v.sort, v.octopus_sku
             )
             from dropship_variants v where v.product_id = p.id
           ), '[]'::jsonb),
           'routes', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'destination_country', r.destination_country,
                 'shipping_method', r.shipping_method,
                 'landed_price_cents', r.landed_price_cents,
                 'est_days_min', r.est_days_min,
                 'est_days_max', r.est_days_max
               ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
             )
             from dropship_routes r
            where r.product_id = p.id and r.destination_country = v_country and r.is_active
           ), '[]'::jsonb)
         )
    into v_res
    from dropship_products p
    left join suppliers s on s.id = p.supplier_id
   where p.id = p_product_id
     and p.status = 'active'
     and (
       (p.supplier_id is not null and s.verified and s.archived_at is null)
       or (p.source_type = 'own_warehouse' and (p.supplier_id is null or (s.verified and s.archived_at is null)))
     )
     and exists (
       select 1 from dropship_routes r
        where r.product_id = p.id and r.destination_country = v_country and r.is_active
     );

  return v_res;
end $$;
revoke all on function get_dropship_product(uuid, text) from public, anon;
grant execute on function get_dropship_product(uuid, text) to authenticated, service_role;

-- ───────── 6. White-label guard helper (staff-only) ─────────
create or replace function dropship_whitelabel_hits(p_texts text[])
returns table (
  matched_term text,
  source_kind text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_blob text := lower(coalesce(array_to_string(p_texts, ' || '), ''));
begin
  if auth.uid() is not null and not (is_staff() and in_division(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;
  if btrim(v_blob) = '' then return; end if;

  return query
    with terms as (
      select btrim(s.code) as term, 'supplier_code'::text as kind from suppliers s where length(btrim(coalesce(s.code, ''))) >= 3
      union
      select btrim(s.legal_name), 'supplier_name' from suppliers s where length(btrim(coalesce(s.legal_name, ''))) >= 3
      union
      select btrim(s.manufacturer_code), 'manufacturer_code' from suppliers s where length(btrim(coalesce(s.manufacturer_code, ''))) >= 3
      union
      select btrim(regexp_replace(s.handle, '^@+', '')), 'supplier_handle' from suppliers s where length(btrim(regexp_replace(coalesce(s.handle, ''), '^@+', ''))) >= 3
      union
      select btrim(s.external_id), 'supplier_external_id' from suppliers s where length(btrim(coalesce(s.external_id, ''))) >= 3
      union
      select btrim(v.variant_name), 'supplier_name_variant' from supplier_name_variants v where length(btrim(coalesce(v.variant_name, ''))) >= 3
      union
      -- Distinct brand stem of legal_name (after stripping city prefix and Co., Ltd. suffix) when >= 4 chars
      select btrim(regexp_replace(
               regexp_replace(s.legal_name, '^(Shenzhen|Shenzeh|Xiamen|Guangzhou|Yiwu|Ningbo|Foshan|Dongguan|Huizhou)\s+', '', 'i'),
               '\s+(Technology|Techonolgy|Electronics|Lighting|Industrial|Trading|Manufacturing|Industry|Co\.?,?\s*Ltd\.?|Limited|Inc\.?|Corp\.?)(\s+|$).*$',
               '',
               'i'
             )) as term,
             'supplier_brand_stem'::text as kind
        from suppliers s
    )
    select distinct t.term as matched_term, t.kind as source_kind
      from terms t
     where length(t.term) >= 3
       and position(lower(t.term) in v_blob) > 0
     order by 2, 1;
end $$;
revoke all on function dropship_whitelabel_hits(text[]) from public, anon;
grant execute on function dropship_whitelabel_hits(text[]) to authenticated, service_role;

-- ───────── 7. Staff rate-card estimate helper (STAFF ONLY — never callable by customers) ─────────
create or replace function dropship_rate_estimate(
  p_weight_g integer,
  p_unit_cost_cents bigint,
  p_country text,
  p_method text
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r dropship_rates;
  v_ship bigint;
  v_duty bigint;
  v_fee bigint;
begin
  if auth.uid() is not null and not (is_staff() and dropship_can_see_costs(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;
  select * into r
    from dropship_rates
   where active
     and country = upper(btrim(coalesce(p_country, '')))::char(2)
     and service = lower(btrim(coalesce(p_method, '')))
   limit 1;
  if r.id is null then return null; end if;

  v_ship := r.ship_base_cents + ceil(greatest(1, coalesce(p_weight_g, 250)) / 100.0)::bigint * r.ship_per_100g_cents + r.fee_cents;
  v_duty := round(greatest(0, coalesce(p_unit_cost_cents, 0)) * r.duty_pct / 100.0)::bigint;
  v_fee := r.fee_cents;
  return jsonb_build_object(
    'country', r.country,
    'shipping_method', r.service,
    'est_shipping_cents', v_ship,
    'est_duties_cents', v_duty,
    'fee_cents', v_fee,
    'est_days_min', r.days_min,
    'est_days_max', r.days_max,
    'allows_battery', r.allows_battery,
    'allows_liquid', r.allows_liquid
  );
end $$;
revoke all on function dropship_rate_estimate(integer, bigint, text, text) from public, anon;
grant execute on function dropship_rate_estimate(integer, bigint, text, text) to authenticated, service_role;
