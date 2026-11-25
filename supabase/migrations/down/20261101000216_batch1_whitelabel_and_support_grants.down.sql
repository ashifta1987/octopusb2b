-- Down migration for 20261101000216_batch1_whitelabel_and_support_grants.sql

-- 1. Restore quote_carrier_rates (from 211)
create or replace function public.quote_carrier_rates(
  p_carrier_code text,
  p_country text,
  p_weight_g integer,
  p_parcels integer default 1
)
returns table (
  rate_card_id uuid,
  carrier_code text,
  method text,
  carrier_service_code text,
  service_label text,
  price_cents bigint,
  days_min integer,
  days_max integer,
  version integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_carrier text := lower(btrim(coalesce(p_carrier_code, '')));
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_weight integer := coalesce(p_weight_g, 0);
  v_parcels integer := greatest(1, coalesce(p_parcels, 1));
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (is_staff() and not distributor_restricted()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_weight <= 0 or v_country !~ '^[A-Z]{2}$' then
    return;
  end if;

  return query
    select rc.id as rate_card_id,
           rc.carrier_code,
           rc.method,
           rc.carrier_service_code,
           coalesce(rc.service_label, initcap(rc.method) || ' (' || rc.carrier_service_code || ')') as service_label,
           (
             (
               rc.base_cents
               + (ceil(v_weight::numeric / rc.step_g::numeric)::bigint * rc.per_100g_cents)
             ) * v_parcels::bigint
           ) as price_cents,
           rc.days_min,
           rc.days_max,
           rc.version
      from public.shipping_rate_cards rc
     where rc.active
       and lower(btrim(rc.carrier_code)) = v_carrier
       and rc.country = v_country
       and v_weight <= rc.max_weight_g
     order by rc.days_min asc, price_cents asc;
end $$;

revoke all on function public.quote_carrier_rates(text, text, integer, integer) from public, anon;
grant execute on function public.quote_carrier_rates(text, text, integer, integer) to authenticated, service_role;

-- 2. Restore warehouse_shipments view (from 195)
create or replace view public.warehouse_shipments with (security_barrier = true) as
  select s.id,
         s.code,
         d.code as division,
         o.code as order_code,
         o.title as items,
         o.quantity,
         a.line1 as address_line1,
         a.line2 as address_line2,
         a.city,
         a.region,
         a.postal_code,
         a.country,
         s.carrier_code,
         s.tracking_no,
         s.label_url,
         s.status,
         s.weight_kg,
         s.parcels,
         s.eta,
         s.last_event_at,
         s.created_at
    from shipments s
    join divisions d on d.id = s.division_id
    join orders o on o.id = s.order_id
    left join lateral (
      select ad.line1,
             ad.line2,
             ad.city,
             ad.region,
             ad.postal_code,
             ad.country
        from addresses ad
       where ad.org_id = s.org_id
       order by ad.is_default desc, ad.created_at
       limit 1
    ) a on true
   where in_division(division_id_of('3PL'::text), array['warehouse'::text, 'manager'::text]) or in_division(s.division_id);

-- 3. Restore RLS policies on carriers, shipping_rate_cards, supplier_product_prices, supplier_products
drop policy if exists carriers_read on public.carriers;
create policy carriers_read on public.carriers for select to authenticated using (is_staff());

drop policy if exists shipping_rate_cards_staff_read on public.shipping_rate_cards;
create policy shipping_rate_cards_staff_read on public.shipping_rate_cards
  for select to authenticated
  using (
    is_staff()
    and (not distributor_restricted())
    and (
      in_division(division_id_of('3PL'::text))
      or in_division(division_id_of('DS'::text))
      or can('orders'::text, 'view'::text)
      or can('finance'::text, 'view'::text)
    )
  );

drop policy if exists spp_staff on public.supplier_product_prices;
create policy spp_staff on public.supplier_product_prices
  for select to authenticated
  using (can('finance'::text, 'view'::text) or can('requests'::text, 'view'::text) or can('products'::text, 'approve'::text) or is_my_supplier(supplier_id));

drop policy if exists sp_staff on public.supplier_products;
create policy sp_staff on public.supplier_products
  for select to authenticated
  using (can('products'::text, 'view'::text) or can('finance'::text, 'view'::text) or can('requests'::text, 'view'::text) or is_my_supplier(supplier_id));

-- 4. Restore column & table grants
grant select (sku) on public.products to anon, authenticated;
grant select (rate_cents) on public.shipments to anon, authenticated;

do $$ declare t text; cols text;
begin
  foreach t in array array['dropship_products', 'dropship_variants', 'dropship_routes', 'dropship_handoffs', 'dropship_rates', 'shipping_rate_cards'] loop
    select string_agg(quote_ident(column_name), ', ') into cols
      from information_schema.columns where table_schema = 'public' and table_name = t;
    execute format('revoke select (%s) on public.%I from authenticated', cols, t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 5. Restore original commit_import_run()
create or replace function public.commit_import_run(p_run uuid, p_actor uuid default null, p_canonical text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r import_runs; s jsonb; v_sup uuid; v_sup_ext text; v jsonb; v_pid uuid; v_cat uuid; v_slug text; v_old products;
  c jsonb := jsonb_build_object('suppliers', jsonb_build_object('create',0,'update',0,'skip',0),
    'products', jsonb_build_object('create',0,'update',0,'skip',0), 'supplier_products', jsonb_build_object('create',0,'update',0,'skip',0),
    'prices', jsonb_build_object('create',0,'update',0,'skip',0,'superseded',0), 'images', jsonb_build_object('create',0,'skip',0),
    'specs', jsonb_build_object('create',0), 'review', jsonb_build_object('create',0,'skip',0));
  n int; v_price record; v_existing supplier_product_prices; v_touched uuid[] := '{}';
begin
  if p_actor is not null and not exists (select 1 from user_roles where user_id = p_actor) then raise exception 'FORBIDDEN'; end if;
  if auth.uid() is not null and not can('products', 'edit') then raise exception 'FORBIDDEN'; end if;
  select * into r from import_runs where id = p_run for update;
  if r.id is null then raise exception 'IMPORT_NOT_FOUND'; end if;
  if r.status = 'committed' then return r.report; end if;
  s := r.staging;
  if jsonb_array_length(coalesce(s->'errors', '[]')) > 0 then
    raise exception 'IMPORT_HAS_ERRORS: fix the % error(s) in the workbook and upload it again', jsonb_array_length(s->'errors');
  end if;

  -- supplier
  v_sup_ext := s #>> '{supplier,external_id}';
  select id into v_sup from suppliers where external_id = v_sup_ext;
  if v_sup is null then
    insert into suppliers(legal_name, country, city, contact_name, contact_email, contact_phone, verified, external_id, manufacturer_code,
                          province, handle, identity_status, notes, supplier_type)
    values (coalesce(nullif(p_canonical, ''), s #>> '{supplier,legal_name}'), s #>> '{supplier,country}', s #>> '{supplier,city}',
            s #>> '{supplier,contact_name}', s #>> '{supplier,contact_email}', s #>> '{supplier,contact_phone}', false, v_sup_ext,
            s #>> '{supplier,manufacturer_code}', s #>> '{supplier,province}', s #>> '{supplier,handle}',
            coalesce(s #>> '{supplier,status}', 'ok'), s #>> '{supplier,notes}', 'manufacturer')
    returning id into v_sup;
    c := jsonb_set(c, '{suppliers,create}', to_jsonb(1));
  else
    -- legal_name never changes from an import unless the admin picked a canonical name
    update suppliers set manufacturer_code = coalesce(s #>> '{supplier,manufacturer_code}', manufacturer_code),
           province = coalesce(s #>> '{supplier,province}', province), handle = coalesce(s #>> '{supplier,handle}', handle),
           contact_name = coalesce(s #>> '{supplier,contact_name}', contact_name), contact_email = coalesce(s #>> '{supplier,contact_email}', contact_email),
           contact_phone = coalesce(s #>> '{supplier,contact_phone}', contact_phone)
     where id = v_sup and (manufacturer_code, province, handle, contact_name, contact_email, contact_phone) is distinct from
       (coalesce(s #>> '{supplier,manufacturer_code}', manufacturer_code), coalesce(s #>> '{supplier,province}', province), coalesce(s #>> '{supplier,handle}', handle),
        coalesce(s #>> '{supplier,contact_name}', contact_name), coalesce(s #>> '{supplier,contact_email}', contact_email), coalesce(s #>> '{supplier,contact_phone}', contact_phone));
    get diagnostics n = row_count;
    c := jsonb_set(c, case when n > 0 then '{suppliers,update}' else '{suppliers,skip}' end::text[], to_jsonb(1));
  end if;
  insert into supplier_switches(supplier_id) values (v_sup) on conflict do nothing;
  for v in select * from jsonb_array_elements(coalesce(s #> '{supplier,name_variants}', '[]')) loop
    insert into supplier_name_variants(supplier_id, variant_name, variant_address, seen_in, is_canonical)
    values (v_sup, v->>'variant_name', v->>'variant_address', v->>'seen_in', false)
    on conflict (supplier_id, variant_name) do update set variant_address = excluded.variant_address, seen_in = excluded.seen_in;
  end loop;
  for v in select * from jsonb_array_elements(coalesce(s #> '{supplier,contacts}', '[]')) loop
    insert into supplier_contacts(supplier_id, name, role, phone, wechat, email, is_primary)
    values (v_sup, v->>'name', v->>'role', v->>'phone', v->>'wechat', v->>'email', coalesce((v->>'is_primary')::boolean, false))
    on conflict (supplier_id, name) do update set role = excluded.role, phone = excluded.phone, wechat = excluded.wechat,
      email = excluded.email, is_primary = excluded.is_primary;
  end loop;

  -- products (always drafts; an existing live product keeps its status)
  for v in select * from jsonb_array_elements(coalesce(s->'products', '[]')) loop
    v_cat := null;
    if coalesce(v->>'category', '') <> '' then
      select id into v_cat from categories where lower(name) = lower(v->>'category') order by level limit 1;
      if v_cat is null then
        select id into v_cat from categories where parent_id is null and slug = trim(both '-' from regexp_replace(lower(v->>'category'), '[^a-z0-9]+', '-', 'g'));
        if v_cat is null then
          insert into categories(name, slug, level, sort, active)
          values (v->>'category', trim(both '-' from regexp_replace(lower(v->>'category'), '[^a-z0-9]+', '-', 'g')), 1, 100, false)
          returning id into v_cat;
        end if;
      end if;
    end if;
    select * into v_old from products where external_id = v->>'external_id';
    if v_old.id is null then
      v_slug := left(regexp_replace(lower(coalesce(nullif(v->>'name', ''), v->>'factory_model', v->>'external_id') || ' ' || (v->>'external_id')), '[^a-z0-9]+', '-', 'g'), 90);
      v_slug := trim(both '-' from v_slug);
      insert into products(slug, title, supplier_id, category_id, status, unit, moq, incoterm, origin_country, currency, external_id,
             factory_model, specification_raw, selling_points_raw, net_weight, product_size_mm, size_notes, colour_box_mm, carton_size_mm,
             qty_per_carton, gross_weight, listing_status, import_notes, created_by)
      values (v_slug, coalesce(nullif(v->>'name', ''), v->>'factory_model', v->>'external_id'), v_sup, v_cat, 'draft', 'pcs',
             coalesce(nullif(v->>'moq', '')::int, 1), v->>'incoterm', 'CN', 'USD', v->>'external_id', v->>'factory_model', v->>'specification_raw',
             v->>'selling_points_raw', v->>'net_weight', v->>'product_size_mm', v->>'size_notes', v->>'colour_box_mm', v->>'carton_size_mm',
             v->>'qty_per_carton', v->>'gross_weight', coalesce(v->>'listing_status', 'draft'), v->>'notes', p_actor)
      returning id into v_pid;
      c := jsonb_set(c, '{products,create}', to_jsonb((c #>> '{products,create}')::int + 1));
    else
      v_pid := v_old.id;
      update products set factory_model = v->>'factory_model', specification_raw = v->>'specification_raw',
             selling_points_raw = v->>'selling_points_raw', net_weight = v->>'net_weight', product_size_mm = v->>'product_size_mm',
             size_notes = v->>'size_notes', colour_box_mm = v->>'colour_box_mm', carton_size_mm = v->>'carton_size_mm',
             qty_per_carton = v->>'qty_per_carton', gross_weight = v->>'gross_weight', incoterm = coalesce(v->>'incoterm', incoterm),
             category_id = coalesce(v_cat, category_id), listing_status = listing_status,
             import_notes = v->>'notes',
             -- a verified name in the file replaces the title; a blank name never overwrites good copy (README rule)
             title = coalesce(nullif(v->>'name', ''), title), updated_at = now()
       where id = v_pid and (factory_model, specification_raw, selling_points_raw, net_weight, product_size_mm, size_notes, colour_box_mm,
             carton_size_mm, qty_per_carton, gross_weight, incoterm, category_id, listing_status, import_notes, title)
             is distinct from (v->>'factory_model', v->>'specification_raw', v->>'selling_points_raw', v->>'net_weight', v->>'product_size_mm',
             v->>'size_notes', v->>'colour_box_mm', v->>'carton_size_mm', v->>'qty_per_carton', v->>'gross_weight', coalesce(v->>'incoterm', incoterm),
             coalesce(v_cat, category_id), coalesce(v->>'listing_status', listing_status), v->>'notes', coalesce(nullif(v->>'name', ''), title));
      get diagnostics n = row_count;
      c := jsonb_set(c, case when n > 0 then '{products,update}' else '{products,skip}' end::text[],
             to_jsonb((c #>> (case when n > 0 then '{products,update}' else '{products,skip}' end)::text[])::int + 1));
    end if;
    -- parsed specs (raw text stays authoritative on the product)
    delete from product_specs where product_id = v_pid;
    insert into product_specs(product_id, name, value, sort)
      select v_pid, x->>'key', x->>'value', (x->>'sort')::int from jsonb_array_elements(coalesce(v->'specs', '[]')) x;
    get diagnostics n = row_count;
    c := jsonb_set(c, '{specs,create}', to_jsonb((c #>> '{specs,create}')::int + n));

    -- supplier ↔ product (a second supplier adds a row; never overwrites another supplier's row)
    insert into supplier_products(supplier_id, product_id, supplier_model, moq, exclusive_channels, exclusivity_flag, status, is_preferred)
    values (v_sup, v_pid, v->>'supplier_model', nullif(v->>'moq', '')::int, nullif(v->>'exclusive_channels', ''), nullif(v->>'exclusivity_flag', ''),
            coalesce(v->>'supplier_status', 'quoted'), not exists (select 1 from supplier_products where product_id = v_pid))
    on conflict (supplier_id, product_id) do nothing;
    get diagnostics n = row_count;
    if n > 0 then c := jsonb_set(c, '{supplier_products,create}', to_jsonb((c #>> '{supplier_products,create}')::int + 1));
    else
      update supplier_products set supplier_model = v->>'supplier_model', moq = nullif(v->>'moq', '')::int,
             exclusive_channels = nullif(v->>'exclusive_channels', ''), exclusivity_flag = nullif(v->>'exclusivity_flag', ''),
             status = coalesce(v->>'supplier_status', 'quoted'), updated_at = now()
       where supplier_id = v_sup and product_id = v_pid
         and (supplier_model, moq, exclusive_channels, exclusivity_flag, status) is distinct from
             (v->>'supplier_model', nullif(v->>'moq', '')::int, nullif(v->>'exclusive_channels', ''), nullif(v->>'exclusivity_flag', ''), coalesce(v->>'supplier_status', 'quoted'));
      get diagnostics n = row_count;
      c := jsonb_set(c, case when n > 0 then '{supplier_products,update}' else '{supplier_products,skip}' end::text[],
             to_jsonb((c #>> (case when n > 0 then '{supplier_products,update}' else '{supplier_products,skip}' end)::text[])::int + 1));
    end if;
    v_touched := v_touched || v_pid;
  end loop;

  -- prices: same key + same price → skip; same key, different price → update; new valid_from → insert and supersede older rows
  for v_price in
    select p.id pid, x->>'incoterm' incoterm, (x->>'moq_tier_min')::int moq, coalesce(x->>'variant_label', '') variant,
           (x->>'price_minor')::bigint price, coalesce(x->>'currency', 'USD') cur, (x->>'valid_from')::date vf, nullif(x->>'valid_to', '')::date vt
      from jsonb_array_elements(coalesce(s->'prices', '[]')) x join products p on p.external_id = x->>'external_id'
  loop
    select * into v_existing from supplier_product_prices
     where supplier_id = v_sup and product_id = v_price.pid and incoterm = v_price.incoterm and moq_tier_min = v_price.moq
       and variant_label = v_price.variant and valid_from = v_price.vf;
    if v_existing.id is null then
      update supplier_product_prices set is_superseded = true
       where supplier_id = v_sup and product_id = v_price.pid and incoterm = v_price.incoterm and moq_tier_min = v_price.moq
         and variant_label = v_price.variant and valid_from < v_price.vf and not is_superseded;
      get diagnostics n = row_count;
      c := jsonb_set(c, '{prices,superseded}', to_jsonb((c #>> '{prices,superseded}')::int + n));
      insert into supplier_product_prices(supplier_id, product_id, incoterm, moq_tier_min, variant_label, price_minor, currency, valid_from, valid_to)
      values (v_sup, v_price.pid, v_price.incoterm, v_price.moq, v_price.variant, v_price.price, v_price.cur, v_price.vf, v_price.vt);
      c := jsonb_set(c, '{prices,create}', to_jsonb((c #>> '{prices,create}')::int + 1));
    elsif v_existing.price_minor <> v_price.price or v_existing.currency <> v_price.cur or v_existing.valid_to is distinct from v_price.vt then
      update supplier_product_prices set price_minor = v_price.price, currency = v_price.cur, valid_to = v_price.vt where id = v_existing.id;
      c := jsonb_set(c, '{prices,update}', to_jsonb((c #>> '{prices,update}')::int + 1));
    else
      c := jsonb_set(c, '{prices,skip}', to_jsonb((c #>> '{prices,skip}')::int + 1));
    end if;
  end loop;

  -- images (already uploaded to product-media by the caller; here only the rows)
  for v in select * from jsonb_array_elements(coalesce(s->'images', '[]')) loop
    select id into v_pid from products where external_id = v->>'external_id';
    if v_pid is null or coalesce(v->>'url', '') = '' then continue; end if;
    if exists (select 1 from product_media where product_id = v_pid and (url = v->>'url' or (string_to_array(url, '/'))[array_length(string_to_array(url, '/'), 1)] = v->>'file')) then
      c := jsonb_set(c, '{images,skip}', to_jsonb((c #>> '{images,skip}')::int + 1));
    else
      insert into product_media(product_id, url, kind, sort, alt) values (v_pid, v->>'url', 'image', coalesce((v->>'sort')::int, 1), v->>'alt');
      update products set image_url = coalesce(image_url, v->>'url') where id = v_pid;
      c := jsonb_set(c, '{images,create}', to_jsonb((c #>> '{images,create}')::int + 1));
    end if;
  end loop;

  -- review queue
  for v in select * from jsonb_array_elements(coalesce(s->'review', '[]')) loop
    insert into import_review_items(run_id, product_id, external_id, kind, issue, evidence)
    values (p_run, (select id from products where external_id = v->>'external_id'), v->>'external_id', coalesce(v->>'kind', 'note'), v->>'issue', v->>'evidence')
    on conflict (external_id, issue) do nothing;
    get diagnostics n = row_count;
    c := jsonb_set(c, case when n > 0 then '{review,create}' else '{review,skip}' end::text[],
           to_jsonb((c #>> (case when n > 0 then '{review,create}' else '{review,skip}' end)::text[])::int + 1));
  end loop;

  -- buyer prices for every product touched
  perform recompute_sell_prices(x) from unnest(v_touched) x;

  update import_runs set status = 'committed', committed_at = now(), report = c where id = p_run;
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (coalesce(auth.uid(), p_actor), 'bulk_import_committed', 'import_runs', p_run::text, jsonb_build_object('name', r.name, 'counts', c, 'supplier', v_sup_ext));
  return c;
end $function$;

revoke all on function public.commit_import_run(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.commit_import_run(uuid, uuid, text) to service_role;

-- 6. Drop redirect helper and table
drop function if exists public.resolve_product_slug_redirect(text);
drop table if exists public.product_slug_redirects;
