-- CONN S4 · Carrier layer completion (migration 263; after 262). No carrier keys needed.
--   1. Magnetic goods: carrier services say whether they take magnets (wh_carrier_services.accepts_magnet; existing services keep
--      today's behaviour = yes, a warehouse admin switches it off where the carrier refuses magnets); the service check refuses a
--      parcel with magnets on a service that does not take them (like batteries and liquids).
--   2. "Test connection" for carrier accounts: the result of the adapter's credential check is kept on the account (last check,
--      ok / problem) and logged in integration_logs (System health counts carrier failures from there). Never a key.
--   3. Commercial invoice: c4_commercial_invoice(shipment) gives the data for the customs invoice PDF of a cross-border label, from
--      the customs snapshot saved with the label (declared value = what the buyer paid, never the cost; English description, HS
--      code, origin, quantity, unit value, weight per item). Domestic parcels need none. Printing is audited. White-label: a Dropship
--      parcel's shipper is the seller's APPROVED brand and return address (as on its label, owner's decision 19 Nov 2026), never
--      Octopus, a supplier or a factory; without an approved profile the invoice is refused like the label.
-- Money: integer US cents (from the locked snapshot). RLS unchanged.

alter table public.wh_carrier_services add column if not exists accepts_magnet boolean not null default true;
alter table public.wh_carrier_accounts add column if not exists last_check_at timestamptz;
alter table public.wh_carrier_accounts add column if not exists last_check_ok boolean;
alter table public.wh_carrier_accounts add column if not exists last_check_message text check (last_check_message is null or length(last_check_message) <= 300);

create or replace function public.c4_carrier_check_record(p_account uuid, p_ok boolean, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.wh_carrier_accounts;
  v_msg text := left(regexp_replace(coalesce(nullif(btrim(p_message), ''), case when p_ok then 'Connected.' else 'The check failed.' end), '[\r\n]+', ' ', 'g'), 300);
begin
  select * into a from public.wh_carrier_accounts where id = p_account for update;
  if a.id is null or not public.wh_sees(a.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('manage_carrier_rules', a.warehouse_code) then raise exception 'FORBIDDEN: only a warehouse admin tests carrier accounts'; end if;
  update public.wh_carrier_accounts set last_check_at = now(), last_check_ok = coalesce(p_ok, false), last_check_message = v_msg where id = a.id;
  insert into public.integration_logs (integration_code, direction, status, summary, endpoint)
  values (a.carrier, 'out', case when coalesce(p_ok, false) then 200 else 502 end, left(format('%s account %s (%s): %s', a.carrier, a.name, a.mode, v_msg), 300), 'carrier_account:' || a.id::text);
  perform write_audit('wh_carrier.account_checked', 'wh_carrier_accounts', a.id::text, jsonb_build_object('ok', coalesce(p_ok, false), 'mode', a.mode, 'message', v_msg));
  return jsonb_build_object('ok', coalesce(p_ok, false), 'message', v_msg, 'checked_at', now());
end $$;

create or replace function public.c4_commercial_invoice(p_shipment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wh_shipments;
  c public.wh_shipment_customs;
  o public.wh_orders;
  w public.warehouses;
  so public.store_orders;
  b public.dropship_seller_profiles;
  v_exporter jsonb;
begin
  select * into s from public.wh_shipments where id = p_shipment;
  if s.id is null or not public.wh_sees(s.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('dispatch', s.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if s.status = 'voided' then raise exception 'VOIDED: this label was voided; make a new label first.'; end if;
  select * into c from public.wh_shipment_customs where shipment_id = s.id;
  if c.shipment_id is null then raise exception 'NO_CUSTOMS: this label has no customs record.'; end if;
  if c.scope = 'domestic' then raise exception 'NOT_NEEDED: a domestic parcel needs no commercial invoice.'; end if;
  select * into o from public.wh_orders where id = s.order_id;
  select * into w from public.warehouses where code = s.warehouse_code;
  if o.store_order_id is not null then select * into so from public.store_orders where id = o.store_order_id; end if;
  if c.scope = 'dropship' then
    select * into b from public.dropship_seller_profiles where org_id = so.org_id and status = 'approved';
    if b.org_id is null then raise exception 'BRAND_NOT_APPROVED: Dropshipping staff must approve the seller''s brand and return address first.'; end if;
    v_exporter := jsonb_build_object('name', b.brand_name, 'address', concat_ws(', ', nullif(b.return_name, ''), nullif(b.return_line1, ''), nullif(b.return_line2, '')),
      'city', b.return_city, 'province', b.return_region, 'postcode', b.return_postal_code, 'country', b.return_country, 'phone', null, 'email', null);
  else
    v_exporter := jsonb_build_object('name', w.name, 'address', w.address, 'city', w.city, 'province', w.province, 'postcode', null, 'country', w.country, 'phone', w.phone, 'email', w.email);
  end if;
  perform write_audit('wh_label.commercial_invoice', 'wh_shipments', s.id::text, jsonb_build_object('code', s.code, 'tracking_no', s.tracking_no, 'scope', c.scope));
  return jsonb_build_object(
    'number', 'CI-' || s.code,
    'date', to_char(s.created_at at time zone coalesce(w.timezone, 'UTC'), 'YYYY-MM-DD'),
    'sandbox', s.sandbox,
    'tracking_no', s.tracking_no,
    'service_name', s.service_name,
    'order_code', o.code,
    'reference', coalesce(so.external_order_name, so.order_number, o.external_ref, o.code),
    'exporter', v_exporter,
    'consignee', jsonb_build_object('name', o.ship_name, 'phone', o.ship_phone, 'address', o.ship_address, 'country', o.ship_country),
    'scope', c.scope,
    'duty_type', c.duty_type,
    'incoterm', c.snapshot ->> 'incoterm',
    'currency', 'USD',
    'declared_usd_cents', c.declared_usd_cents,
    'weight_g', s.weight_g,
    'items', coalesce(c.snapshot -> 'items', '[]'::jsonb),
    'policy_shipping_included', c.snapshot #> '{policy,shipping_in_declared_value}');
end $$;

-- ───────────────────────── replaced functions (installed text + CONN S4 patches) ─────────────────────────
-- wh_service_problem(uuid,text[],integer)
CREATE OR REPLACE FUNCTION public.wh_service_problem(p_service uuid, p_dg text[], p_weight_g integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- CONN S4: magnetic goods
  if 'magnet' = any(coalesce(p_dg, '{}')) and not s.accepts_magnet then return format('%s does not take magnets', s.name); end if;
  if s.max_weight_g is not null and p_weight_g is not null and p_weight_g > s.max_weight_g then
    return format('%s takes up to %s g', s.name, to_char(s.max_weight_g, 'FM999G999G990'));
  end if;
  return null;
end $function$;

-- wh_carriers_board(text)
CREATE OR REPLACE FUNCTION public.wh_carriers_board(p_warehouse text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                          'last_check_at', a.last_check_at, 'last_check_ok', a.last_check_ok, 'last_check_message', a.last_check_message,
                          'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', s.level,
                                                    'max_weight_g', s.max_weight_g, 'accepts_battery', s.accepts_battery, 'accepts_liquid', s.accepts_liquid, 'accepts_magnet', s.accepts_magnet,
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
end $function$;

-- wh_save_carrier_service: new signature with p_accepts_magnet
drop function if exists public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION public.wh_save_carrier_service(p_account uuid, p_id uuid, p_code text, p_name text, p_level text, p_max_weight_g integer, p_accepts_battery boolean, p_accepts_liquid boolean, p_active boolean DEFAULT true, p_accepts_magnet boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    insert into public.wh_carrier_services (account_id, warehouse_code, code, name, level, max_weight_g, accepts_battery, accepts_liquid, accepts_magnet, active, updated_by)
    values (a.id, a.warehouse_code, v_code, v_name, p_level, p_max_weight_g, coalesce(p_accepts_battery, false), coalesce(p_accepts_liquid, false), coalesce(p_accepts_magnet, true), coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform write_audit('wh_carrier.service_created', 'wh_carrier_accounts', a.id::text,
      jsonb_build_object('service_id', v_id, 'code', v_code, 'name', v_name, 'level', p_level, 'max_weight_g', p_max_weight_g,
                         'battery', coalesce(p_accepts_battery, false), 'liquid', coalesce(p_accepts_liquid, false), 'magnet', coalesce(p_accepts_magnet, true)));
  else
    select * into v_old from public.wh_carrier_services where id = p_id for update;
    if v_old.id is null or v_old.account_id <> a.id then raise exception 'NOT_FOUND'; end if;
    if exists (select 1 from public.wh_carrier_services where account_id = a.id and code = v_code and id <> p_id) then raise exception 'DUPLICATE_SERVICE: % already exists on %', v_code, a.name; end if;
    update public.wh_carrier_services
       set code = v_code, name = v_name, level = p_level, max_weight_g = p_max_weight_g, accepts_battery = coalesce(p_accepts_battery, false),
           accepts_liquid = coalesce(p_accepts_liquid, false), accepts_magnet = coalesce(p_accepts_magnet, v_old.accepts_magnet), active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    v_id := p_id;
    perform write_audit('wh_carrier.service_updated', 'wh_carrier_accounts', a.id::text,
      jsonb_build_object('service_id', v_id, 'from', to_jsonb(v_old) - 'updated_by' - 'updated_at' - 'created_at', 'code', v_code, 'name', v_name, 'level', p_level,
                         'max_weight_g', p_max_weight_g, 'battery', coalesce(p_accepts_battery, false), 'liquid', coalesce(p_accepts_liquid, false), 'magnet', coalesce(p_accepts_magnet, v_old.accepts_magnet), 'active', coalesce(p_active, true)));
  end if;
  return v_id;
end $function$;
revoke all on function public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean, boolean) to authenticated, service_role;

revoke all on function public.c4_carrier_check_record(uuid, boolean, text) from public, anon;
grant execute on function public.c4_carrier_check_record(uuid, boolean, text) to authenticated, service_role;
revoke all on function public.c4_commercial_invoice(uuid) from public, anon;
grant execute on function public.c4_commercial_invoice(uuid) to authenticated, service_role;
