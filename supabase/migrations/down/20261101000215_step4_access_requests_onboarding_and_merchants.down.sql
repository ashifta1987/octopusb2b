-- Down migration for 20261101000215_step4_access_requests_onboarding_and_merchants.sql

-- 1. Drop Step 4 RPCs
drop function if exists public.export_my_dropship_data();
drop function if exists public.list_dropship_merchants_staff();
drop function if exists public.review_dropship_merchant_profile(uuid, text, text, text);
drop function if exists public.set_dropship_merchant_status(uuid, text, text);
drop function if exists public.decide_dropship_access_request(uuid, text, text);
drop function if exists public.save_my_dropship_seller_profile(text, text, text, text, text, text, text, text);
drop function if exists public.get_my_dropship_onboarding_state();
drop function if exists public.request_dropship_access(text, text, text, text[]);
drop function if exists public.get_my_dropship_access_state();

-- 2. Restore 214 Step 3 request & sample RPCs verbatim
create or replace function public.create_dropship_product_request(
  p_title text,
  p_product_link text default null,
  p_category text default null,
  p_target_landed_cents bigint default null,
  p_monthly_volume_band text default null,
  p_ship_to_countries text[] default '{}'::text[],
  p_wants_brand boolean default false,
  p_notes text default null,
  p_images text[] default '{}'::text[],
  p_idem text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_title text := btrim(coalesce(p_title, ''));
  v_link text := nullif(btrim(coalesce(p_product_link, '')), '');
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_band text := nullif(btrim(coalesce(p_monthly_volume_band, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_countries text[];
  v_main_country text;
  v_qty integer;
  v_fee bigint;
  v_details text;
  v_rfq public.rfqs;
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  if length(v_title) < 2 or length(v_title) > 160 then
    raise exception 'INVALID_TITLE: Enter a product name between 2 and 160 characters.';
  end if;

  if v_link is not null and v_link !~* '^https?://' then
    raise exception 'INVALID_LINK: Product link must start with https:// or http://';
  end if;

  select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}'::text[])
    into v_countries
    from unnest(coalesce(p_ship_to_countries, '{}'::text[])) c
   where upper(btrim(c)) ~ '^[A-Z]{2}$';

  if coalesce(array_length(v_countries, 1), 0) = 0 then
    raise exception 'COUNTRY_REQUIRED: Choose at least one destination country.';
  end if;
  v_main_country := v_countries[1];

  v_qty := case v_band
    when 'Under 50' then 25
    when '50 to 200' then 100
    when '200 to 1,000' then 500
    when 'More than 1,000' then 1000
    else 50
  end;

  -- Correction 3: Use service_prices code 'dropship_request' (defaults to 0 USD), NEVER Sourcing 'rfq' fee!
  v_fee := greatest(0, coalesce(public.current_service_price('dropship_request', 'USD'), 0));

  v_details := array_to_string(
    array_remove(array[
      '[Dropship product request]',
      case when v_cat is not null then 'Category: ' || v_cat end,
      case when v_link is not null then 'Reference link: ' || v_link end,
      case when v_band is not null then 'Expected orders/month: ' || v_band end,
      'Ship to: ' || array_to_string(v_countries, ', '),
      case when coalesce(p_wants_brand, false) then 'Branding requested: Make My Brand (logo & packaging)' end,
      v_notes
    ], null),
    E'\n'
  );

  insert into public.rfqs (
    org_id,
    title,
    details,
    quantity,
    unit,
    destination_country,
    target_price_cents,
    incoterm,
    status,
    fee_minor,
    currency,
    expires_at,
    created_by,
    division_id
  ) values (
    v_org,
    v_title,
    v_details,
    v_qty,
    'pcs',
    v_main_country,
    case when p_target_landed_cents is not null and p_target_landed_cents >= 0 then p_target_landed_cents else null end,
    'DDP',
    'submitted',
    v_fee,
    'USD',
    now() + interval '14 days',
    v_uid,
    division_id_of('SRC')
  )
  returning * into v_rfq;

  insert into public.dropship_product_requests (
    rfq_id,
    org_id,
    product_link,
    category_label,
    monthly_volume_band,
    ship_to_countries,
    wants_brand,
    images
  ) values (
    v_rfq.id,
    v_org,
    v_link,
    v_cat,
    v_band,
    v_countries,
    coalesce(p_wants_brand, false),
    coalesce(p_images, '{}'::text[])
  );

  if v_fee > 0 and setting_bool('wallet_enabled') then
    perform public.wallet_charge(
      v_org,
      v_fee,
      'Dropship product request fee',
      'dropship_request_fees',
      coalesce(nullif(btrim(coalesce(p_idem, '')), ''), 'ds_req:' || v_rfq.id::text),
      'rfq',
      v_rfq.id,
      'USD'
    );
  end if;

  perform public.log_status('rfq', v_rfq.id, null, 'submitted', 'dropship');
  perform public.emit_event('rfq.submitted', 'rfq', v_rfq.id, jsonb_build_object('org_id', v_org, 'source', 'dropship', 'code', v_rfq.code));

  return jsonb_build_object(
    'ok', true,
    'rfq_id', v_rfq.id,
    'rfq_code', v_rfq.code,
    'fee_cents', v_fee
  );
end $$;

revoke all on function public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text) from public, anon;
grant execute on function public.create_dropship_product_request(text, text, text, bigint, text, text[], boolean, text, text[], text) to authenticated, service_role;

create or replace function public.list_my_dropship_requests()
returns table (
  rfq_id uuid,
  rfq_code text,
  title text,
  category_label text,
  monthly_volume_band text,
  ship_to_countries text[],
  target_landed_cents bigint,
  wants_brand boolean,
  fee_cents bigint,
  merchant_status text,
  merchant_label text,
  quoted_landed_cents bigint,
  quoted_country text,
  dropship_product_id uuid,
  dropship_model_no text,
  dropship_product_status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  return query
    select r.id as rfq_id,
           r.code as rfq_code,
           r.title,
           dpr.category_label,
           dpr.monthly_volume_band,
           dpr.ship_to_countries,
           r.target_price_cents as target_landed_cents,
           dpr.wants_brand,
           r.fee_minor as fee_cents,
           coalesce(sm.merchant_status, r.status::text) as merchant_status,
           coalesce(sm.merchant_label, initcap(r.status::text)) as merchant_label,
           dpr.quoted_landed_cents,
           dpr.quoted_country::text,
           dp.id as dropship_product_id,
           dp.model_no as dropship_model_no,
           dp.status as dropship_product_status,
           r.created_at
      from public.dropship_product_requests dpr
      join public.rfqs r on r.id = dpr.rfq_id
      left join public.status_mappings sm
        on sm.source_domain = 'sourcing_rfq'
       and sm.source_status = r.status::text
       and sm.target = 'request'
      left join lateral (
        select p.id, p.model_no, p.status
          from public.dropship_products p
         where (p.id = dpr.created_dropship_product_id or p.sourced_from_rfq_id = r.id)
           and p.visible_to_org_id = v_org
         order by (p.status = 'active') desc, p.created_at desc
         limit 1
      ) dp on true
     where dpr.org_id = v_org
     order by r.created_at desc, r.id desc;
end $$;

revoke all on function public.list_my_dropship_requests() from public, anon;
grant execute on function public.list_my_dropship_requests() to authenticated, service_role;

create or replace function public.respond_dropship_request_quote(
  p_rfq_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_act text := lower(btrim(coalesce(p_action, '')));
  v_rfq public.rfqs;
  v_dpr public.dropship_product_requests;
  v_dp public.dropship_products;
  v_saved_claims text;
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;
  if v_act not in ('accept', 'decline') then
    raise exception 'INVALID_ACTION';
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id and org_id = v_org for update;
  if v_rfq.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_dpr from public.dropship_product_requests where rfq_id = p_rfq_id and org_id = v_org for update;
  if v_dpr.rfq_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_rfq.status <> 'quoted'::rfq_status then
    raise exception 'INVALID_STATE: Only quoted requests can be accepted or declined.';
  end if;

  if v_act = 'decline' then
    update public.rfqs set status = 'cancelled'::rfq_status, updated_at = now() where id = p_rfq_id;
    perform public.log_status('rfq', p_rfq_id, 'quoted', 'cancelled', 'dropship_merchant');
    return jsonb_build_object('ok', true, 'rfq_id', p_rfq_id, 'rfq_code', v_rfq.code, 'action', 'declined');
  end if;

  update public.rfqs set status = 'accepted'::rfq_status, updated_at = now() where id = p_rfq_id;
  perform public.log_status('rfq', p_rfq_id, 'quoted', 'accepted', 'dropship_merchant');

  -- Create private dropship draft (visible_to_org_id = v_org, sourced_from_rfq_id = v_rfq.id) for DS staff to complete
  select *
    into v_dp
    from public.dropship_products p
   where (p.id = v_dpr.created_dropship_product_id or p.sourced_from_rfq_id = v_rfq.id)
     and p.visible_to_org_id = v_org
   limit 1;

  if v_dp.id is null then
    v_saved_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims', '', true);
    begin
      insert into public.dropship_products (
        octopus_sku,
        title,
        description,
        category,
        images,
        source_type,
        fulfilment_type,
        visible_to_org_id,
        sourced_from_rfq_id,
        status,
        created_by
      ) values (
        'DS-REQ-' || replace(gen_random_uuid()::text, '-', ''),
        v_rfq.title,
        null,
        v_dpr.category_label,
        coalesce(v_dpr.images, '{}'::text[]),
        'partner_supplier',
        'extended_catalog',
        v_org,
        v_rfq.id,
        'draft',
        v_uid
      )
      returning * into v_dp;

      insert into public.dropship_variants (product_id, options, sort)
      values (v_dp.id, '{}'::jsonb, 0);
    exception when others then
      perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
      raise;
    end;
    perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);

    update public.dropship_product_requests
       set created_dropship_product_id = v_dp.id,
           updated_at = now()
     where rfq_id = p_rfq_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rfq_id', p_rfq_id,
    'rfq_code', v_rfq.code,
    'action', 'accepted',
    'dropship_product_id', v_dp.id,
    'dropship_model_no', v_dp.model_no
  );
end $$;

revoke all on function public.respond_dropship_request_quote(uuid, text) from public, anon;
grant execute on function public.respond_dropship_request_quote(uuid, text) to authenticated, service_role;

create or replace function public.create_dropship_sample_order(
  p_variant_id uuid,
  p_qty integer,
  p_destination_country text,
  p_shipping_method text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address jsonb,
  p_idempotency_key text,
  p_incoterm text default null,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_destination_country, '')))::char(2);
  v_method text := lower(btrim(coalesce(p_shipping_method, '')));
  v_idem text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_route public.dropship_routes;
  v_incoterm text;
  v_existing public.store_orders;
  v_lines jsonb;
  v_quote jsonb;
  v_total_cents bigint;
  v_cash_balance bigint;
  v_held_cents bigint;
  v_spendable_cash bigint;
  v_unit_prod bigint;
  v_var_label text;
  v_order_id uuid;
  v_order_no text;
  v_journal_id uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  if p_qty is null or p_qty < 1 or p_qty > 3 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_SAMPLE_QTY',
      'message', 'Sample quantity must be between 1 and 3 per product.'
    );
  end if;

  if btrim(coalesce(p_buyer_name, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'BUYER_NAME_REQUIRED', 'message', 'Enter the recipient full name.');
  end if;

  if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'ADDRESS_REQUIRED', 'message', 'Enter a shipping address.');
  end if;

  if v_idem is null then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'Missing idempotency key.');
  end if;

  -- Lock wallet advisory lock first to prevent concurrent double-spend
  perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || v_org::text, 'USD')));

  select *
    into v_existing
    from public.store_orders
   where org_id = v_org
     and kind = 'sample'
     and channel = 'manual'
     and external_order_id = v_idem
   limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'store_order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'kind', v_existing.kind,
      'merchant_status', v_existing.merchant_status,
      'payment_state', v_existing.payment_state,
      'total_cents', v_existing.total_cents
    );
  end if;

  select * into v_var from public.dropship_variants where id = p_variant_id;
  if v_var.id is null then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'Selected variant not found.');
  end if;

  select * into v_prod from public.dropship_products where id = v_var.product_id;
  if v_prod.id is null
     or v_prod.status <> 'active'
     or (v_prod.visible_to_org_id is not null and v_prod.visible_to_org_id <> v_org)
     or not public.dropship_product_supplier_eligible(v_prod) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_AVAILABLE', 'message', 'This product is not available.');
  end if;

  select *
    into v_route
    from public.dropship_routes r
   where r.product_id = v_prod.id
     and r.destination_country = v_country
     and r.shipping_method = v_method
     and r.is_active
   limit 1;

  if v_route.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_ROUTE', 'message', 'No active shipping route for this country and method.');
  end if;

  v_incoterm := upper(btrim(coalesce(nullif(btrim(coalesce(p_incoterm, '')), ''), v_route.incoterm, 'DDP')));

  -- Declared value = sample product price paid (no buyer_unit_price_cents override)
  v_lines := jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'qty', p_qty));
  v_quote := public.get_dropship_order_quote(
    v_lines,
    v_country,
    v_method,
    v_incoterm,
    'USD',
    null,
    'order'
  );

  if not coalesce((v_quote ->> 'ok')::boolean, false) then
    return v_quote;
  end if;

  -- Correction 4: Refuse DDP when duty is unknown; NEVER charge with duty missing!
  if v_incoterm = 'DDP' and (
    coalesce(v_quote ->> 'duties_status', '') = 'not_known_yet'
    or v_quote -> 'duties_cents' is null
    or v_quote -> 'duties_cents' = 'null'::jsonb
    or v_quote -> 'total_cents' is null
    or v_quote -> 'total_cents' = 'null'::jsonb
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'DUTIES_NOT_SET',
      'message', 'Duties for this country aren''t set yet, choose another country or method'
    );
  end if;

  v_total_cents := (v_quote ->> 'total_cents')::bigint;

  -- Correction 4: Pure wallet cash balance ONLY (wallet_balance excludes credit_limit and already reflects open holds; NO Pay later, NO escrow)
  v_cash_balance := public.wallet_balance(v_org, 'USD');
  v_held_cents := 0;
  v_spendable_cash := v_cash_balance;

  if v_spendable_cash < v_total_cents then
    return jsonb_build_object(
      'ok', false,
      'code', 'WALLET_INSUFFICIENT',
      'wallet_balance_cents', greatest(0, v_spendable_cash),
      'required_cents', v_total_cents,
      'shortfall_cents', v_total_cents - greatest(0, v_spendable_cash),
      'message', 'Not enough in your wallet'
    );
  end if;

  insert into public.store_orders (
    org_id,
    kind,
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
    v_org,
    'sample',
    'manual',
    v_idem,
    'SAMPLE · ' || v_prod.model_no,
    btrim(p_buyer_name),
    nullif(btrim(coalesce(p_buyer_phone, '')), ''),
    p_shipping_address,
    v_country,
    'USD',
    null,
    v_method,
    v_incoterm,
    (v_quote ->> 'billed_weight_g')::int,
    (v_quote ->> 'product_cents')::bigint,
    (v_quote ->> 'processing_cents')::bigint,
    (v_quote ->> 'shipping_cents')::bigint,
    (v_quote ->> 'duties_cents')::bigint,
    v_total_cents,
    (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid,
    (v_quote -> 'version_ids' ->> 'fee_version_id')::uuid,
    (v_quote -> 'version_ids' ->> 'duty_rate_version_id')::uuid,
    'paid',
    'processing',
    'paid_to_assign',
    coalesce(p_is_test, false),
    v_uid
  )
  returning id, order_number into v_order_id, v_order_no;

  if (v_quote -> 'version_ids' ->> 'shipping_rate_card_id') is not null then
    update public.shipping_rate_cards
       set used_count = used_count + 1
     where id = (v_quote -> 'version_ids' ->> 'shipping_rate_card_id')::uuid;
  end if;

  v_unit_prod := ((v_quote ->> 'product_cents')::bigint / p_qty::bigint);
  select string_agg(value, ' / ')
    into v_var_label
    from jsonb_each_text(coalesce(v_var.options, '{}'::jsonb));

  -- Declared value = sample product price paid (line_product_cents)
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
    v_var_label,
    v_prod.fulfilment_type,
    p_qty,
    v_unit_prod,
    (v_quote ->> 'product_cents')::bigint,
    v_unit_prod,
    (v_quote ->> 'product_cents')::bigint
  );

  -- Direct wallet debit (double-entry balanced journal under division DS; zero escrow hold, zero credit)
  if v_total_cents > 0 then
    v_journal_id := public.post_journal(
      'Dropship sample order ' || v_order_no,
      jsonb_build_array(
        jsonb_build_object('account', public.wallet_account(v_org, 'USD'), 'debit', v_total_cents, 'credit', 0, 'org', v_org),
        jsonb_build_object('account', public.revenue_account('dropship_samples', 'USD'), 'debit', 0, 'credit', v_total_cents)
      ),
      'dropship_sample:' || v_order_id::text,
      'dropship',
      'store_order',
      v_order_id
    );
  end if;

  -- Enqueue & process paid order outbox (reserves 3PL stock / creates Sourcing handoff)
  perform public.emit_dropship_domain_event(
    'store_order.paid',
    'store_order',
    v_order_id,
    'store_order:' || v_order_id::text || ':paid',
    jsonb_build_object('store_order_id', v_order_id, 'order_number', v_order_no, 'kind', 'sample'),
    division_id_of('DS'),
    false
  );
  perform public.process_dropship_domain_events(25);

  select * into v_existing from public.store_orders where id = v_order_id;

  perform write_audit(
    'dropship.sample_order_paid',
    'store_orders',
    v_order_id::text,
    jsonb_build_object(
      'order_number', v_order_no,
      'kind', 'sample',
      'total_cents', v_total_cents,
      'journal_id', v_journal_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'store_order_id', v_order_id,
    'order_number', v_order_no,
    'kind', 'sample',
    'payment_state', v_existing.payment_state,
    'merchant_status', v_existing.merchant_status,
    'total_cents', v_total_cents,
    'quote', v_quote
  );
end $$;

revoke all on function public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean) from public, anon;
grant execute on function public.create_dropship_sample_order(uuid, integer, text, text, text, text, jsonb, text, text, boolean) to authenticated, service_role;

create or replace function public.list_my_dropship_sample_orders(
  p_product_id uuid default null
)
returns table (
  store_order_id uuid,
  order_number text,
  product_id uuid,
  variant_id uuid,
  model_no text,
  title_snapshot text,
  variant_label text,
  qty integer,
  destination_country text,
  shipping_method text,
  incoterm text,
  product_cents bigint,
  processing_cents bigint,
  shipping_cents bigint,
  duties_cents bigint,
  total_cents bigint,
  merchant_status text,
  tracking_no text,
  created_at timestamptz,
  delivered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
begin
  if v_uid is null or v_org is null then
    raise exception 'DROPSHIP_NOT_ENABLED';
  end if;

  return query
    select so.id as store_order_id,
           so.order_number,
           soi.product_id,
           soi.variant_id,
           soi.model_no,
           soi.title_snapshot,
           soi.variant_label,
           soi.qty,
           so.destination_country::text,
           so.shipping_method,
           so.incoterm,
           so.product_cents,
           so.processing_cents,
           so.shipping_cents,
           so.duties_cents,
           so.total_cents,
           so.merchant_status,
           sh.tracking_no,
           so.created_at,
           so.delivered_at
      from public.store_orders so
      join public.store_order_items soi on soi.store_order_id = so.id
      left join lateral (
        select s.tracking_no
          from public.shipments s
         where s.store_order_id = so.id
         order by s.created_at desc
         limit 1
      ) sh on true
     where so.org_id = v_org
       and so.kind = 'sample'
       and (p_product_id is null or soi.product_id = p_product_id)
     order by so.created_at desc, so.id desc
     limit 25;
end $$;

revoke all on function public.list_my_dropship_sample_orders(uuid) from public, anon;
grant execute on function public.list_my_dropship_sample_orders(uuid) to authenticated, service_role;

-- 3. Restore 212 create_dropship_store_order, mark_store_order_paid, and store_orders policies verbatim
create or replace function public.create_dropship_store_order(
  p_org_id uuid,
  p_channel text,
  p_external_order_id text,
  p_external_order_name text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address jsonb,
  p_destination_country text,
  p_buyer_currency text,
  p_fx_rate_to_usd numeric,
  p_shipping_method text,
  p_incoterm text,
  p_lines jsonb,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    if not exists (
      select 1 from public.company_services cs
       where cs.org_id = p_org_id and cs.service = 'dropship' and cs.status = 'on'
    ) then
      raise exception 'DROPSHIP_NOT_ENABLED';
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
      v_decl_usd := v_unit_prod * v_qty::bigint;
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
end $$;

revoke all on function public.create_dropship_store_order(uuid, text, text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, boolean) from public, anon;
grant execute on function public.create_dropship_store_order(uuid, text, text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, boolean) to authenticated, service_role;

create or replace function public.mark_store_order_paid(
  p_store_order_id uuid,
  p_wallet_hold_id uuid default null,
  p_escrow_hold_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted() and (dropship_can_edit(division_id_of('DS')) or can('finance', 'edit')));
  v_so public.store_orders;
  v_ev_id uuid;
begin
  select * into v_so from public.store_orders where id = p_store_order_id for update;
  if v_so.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if not v_is_staff and v_so.org_id not in (select my_org_ids()) then
    raise exception 'FORBIDDEN';
  end if;
  if v_so.cancelled_at is not null then
    raise exception 'ORDER_CANCELLED';
  end if;

  update public.store_orders
     set payment_state = case when p_escrow_hold_id is not null or p_wallet_hold_id is not null then 'held' else 'paid' end,
         wallet_hold_id = coalesce(p_wallet_hold_id, wallet_hold_id),
         escrow_hold_id = coalesce(p_escrow_hold_id, escrow_hold_id),
         staff_stage = case when staff_stage = 'unpaid' then 'paid_to_assign' else staff_stage end,
         updated_at = now()
   where id = p_store_order_id;

  v_ev_id := public.emit_dropship_domain_event(
    'store_order.paid',
    'store_order',
    v_so.id,
    'store_order:' || v_so.id::text || ':paid',
    jsonb_build_object('store_order_id', v_so.id, 'order_number', v_so.order_number),
    division_id_of('DS'),
    false
  );

  perform public.process_dropship_domain_events(25);
  select * into v_so from public.store_orders where id = p_store_order_id;

  perform write_audit(
    'dropship.store_order_paid',
    'store_orders',
    v_so.id::text,
    jsonb_build_object(
      'order_number', v_so.order_number,
      'merchant_status', v_so.merchant_status,
      'staff_stage', v_so.staff_stage,
      'hold_reason', v_so.hold_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'store_order_id', v_so.id,
    'event_id', v_ev_id,
    'payment_state', v_so.payment_state,
    'merchant_status', v_so.merchant_status,
    'staff_stage', v_so.staff_stage,
    'hold_reason', v_so.hold_reason
  );
end $$;

revoke all on function public.mark_store_order_paid(uuid, uuid, uuid) from public, anon;
grant execute on function public.mark_store_order_paid(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.create_store_order_shipment(
  p_store_order_id uuid,
  p_carrier_code text,
  p_service_code text default null,
  p_tracking_no text default null,
  p_weight_kg numeric default null,
  p_rate_cents bigint default null,
  p_status shipment_status default 'label_ready'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.store_orders;
  v_ship public.shipments;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit() or dropship_can_edit(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_so from public.store_orders where id = p_store_order_id for update;
  if v_so.id is null then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.shipments (
    order_id,
    store_order_id,
    org_id,
    carrier_code,
    service_code,
    tracking_no,
    status,
    weight_kg,
    parcels,
    rate_cents,
    currency,
    division_id,
    is_seed
  ) values (
    null,
    v_so.id,
    v_so.org_id,
    btrim(p_carrier_code),
    nullif(btrim(coalesce(p_service_code, '')), ''),
    nullif(btrim(coalesce(p_tracking_no, '')), ''),
    coalesce(p_status, 'label_ready'::shipment_status),
    coalesce(p_weight_kg, round(coalesce(v_so.billed_weight_g, 500)::numeric / 1000.0, 3)),
    1,
    coalesce(p_rate_cents, v_so.shipping_cents),
    'USD',
    division_id_of('DS'),
    v_so.is_test
  )
  returning * into v_ship;

  perform write_audit(
    'dropship.shipment_created',
    'shipments',
    v_ship.id::text,
    jsonb_build_object('store_order_id', v_so.id, 'shipment_code', v_ship.code, 'status', v_ship.status::text)
  );

  return jsonb_build_object(
    'shipment_id', v_ship.id,
    'code', v_ship.code,
    'tracking_token', v_ship.tracking_token,
    'tracking_no', v_ship.tracking_no,
    'status', v_ship.status::text
  );
end $$;

revoke all on function public.create_store_order_shipment(uuid, text, text, text, numeric, bigint, shipment_status) from public, anon;
grant execute on function public.create_store_order_shipment(uuid, text, text, text, numeric, bigint, shipment_status) to authenticated, service_role;

drop policy if exists store_orders_read on public.store_orders;
create policy store_orders_read on public.store_orders
  for select to authenticated
  using (
    (
      org_id in (select my_org_ids())
      and exists (
        select 1
          from public.company_services cs
         where cs.org_id = store_orders.org_id
           and cs.service = 'dropship'
           and cs.status = 'on'
      )
    )
    or (
      is_staff()
      and not distributor_restricted()
      and (
        in_division(division_id_of('DS'))
        or can('finance', 'view')
      )
    )
  );

drop policy if exists store_order_items_read on public.store_order_items;
create policy store_order_items_read on public.store_order_items
  for select to authenticated
  using (
    exists (
      select 1
        from public.store_orders so
       where so.id = store_order_items.store_order_id
         and (
           (
             so.org_id in (select my_org_ids())
             and exists (
               select 1
                 from public.company_services cs
                where cs.org_id = so.org_id
                  and cs.service = 'dropship'
                  and cs.status = 'on'
             )
           )
           or (
             is_staff()
             and not distributor_restricted()
             and (
               in_division(division_id_of('DS'))
               or can('finance', 'view')
             )
           )
         )
    )
  );

-- 4. Drop import_list guard, access gate helpers, and Restore 205 dropship_merchant_org
drop trigger if exists trg_guard_dropship_import_list_active on public.dropship_import_list;
drop function if exists public.guard_dropship_import_list_active();
drop function if exists public.assert_dropship_new_activity(uuid);
drop function if exists public.dropship_merchant_any_org();

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

-- 5. Drop KYC auto-pause trigger & function
drop trigger if exists trg_dropship_kyc_autopause on public.organizations;
drop function if exists public.dropship_kyc_autopause();

-- 6. Drop dropship_access_requests & saas_billing_settings
drop policy if exists dropship_access_requests_staff_write on public.dropship_access_requests;
drop policy if exists dropship_access_requests_staff_read on public.dropship_access_requests;
drop table if exists public.dropship_access_requests;

drop trigger if exists trg_guard_saas_billing_settings_locked on public.saas_billing_settings;
drop function if exists public.guard_saas_billing_settings_locked();
drop policy if exists saas_billing_settings_read on public.saas_billing_settings;
drop table if exists public.saas_billing_settings;

-- 7. Remove customer_message on dropship_seller_profiles & restore company_services + set_company_service
alter table public.dropship_seller_profiles
  drop column if exists customer_message;

create or replace function set_company_service(p_org uuid, p_service text, p_status text, p_plan text default null) returns void
language plpgsql security definer set search_path = public as $$
declare old company_services;
begin
  if not (can('customers', 'edit') or is_my_customer(p_org)) then raise exception 'FORBIDDEN'; end if;
  select * into old from company_services where org_id = p_org and service = p_service;
  insert into company_services(org_id, service, status, plan, started_at, ended_at, updated_by, updated_at)
  values (p_org, p_service, p_status, p_plan, case when p_status in ('on', 'trial') then now() end, case when p_status = 'off' then now() end, auth.uid(), now())
  on conflict (org_id, service) do update set status = excluded.status, plan = coalesce(excluded.plan, company_services.plan),
    started_at = case when excluded.status in ('on', 'trial') and company_services.status not in ('on', 'trial') then now() else company_services.started_at end,
    ended_at = case when excluded.status = 'off' then now() else null end, updated_by = auth.uid(), updated_at = now();
  perform audit('company_service.set', p_org, p_service, 'company_service', p_org::text || ':' || p_service,
                case when old.org_id is null then null else jsonb_build_object('status', old.status, 'plan', old.plan) end,
                jsonb_build_object('status', p_status, 'plan', p_plan));
end $$;
revoke execute on function set_company_service(uuid, text, text, text) from public, anon;
grant execute on function set_company_service(uuid, text, text, text) to authenticated, service_role;

alter table public.company_services
  drop constraint if exists company_services_dropship_no_trial_check;

alter table public.company_services
  drop column if exists status_reason;
