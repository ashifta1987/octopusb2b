-- CONN S4 · DOWN (schema back exactly as after 262).
drop function if exists public.c4_commercial_invoice(uuid);
drop function if exists public.c4_carrier_check_record(uuid, boolean, text);
drop function if exists public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean, boolean);
-- restore wh_save_carrier_service(uuid,uuid,text,text,text,integer,boolean,boolean,boolean) (exact installed text)
CREATE OR REPLACE FUNCTION public.wh_save_carrier_service(p_account uuid, p_id uuid, p_code text, p_name text, p_level text, p_max_weight_g integer, p_accepts_battery boolean, p_accepts_liquid boolean, p_active boolean DEFAULT true)
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
    insert into public.wh_carrier_services (account_id, warehouse_code, code, name, level, max_weight_g, accepts_battery, accepts_liquid, active, updated_by)
    values (a.id, a.warehouse_code, v_code, v_name, p_level, p_max_weight_g, coalesce(p_accepts_battery, false), coalesce(p_accepts_liquid, false), coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform write_audit('wh_carrier.service_created', 'wh_carrier_accounts', a.id::text,
      jsonb_build_object('service_id', v_id, 'code', v_code, 'name', v_name, 'level', p_level, 'max_weight_g', p_max_weight_g,
                         'battery', coalesce(p_accepts_battery, false), 'liquid', coalesce(p_accepts_liquid, false)));
  else
    select * into v_old from public.wh_carrier_services where id = p_id for update;
    if v_old.id is null or v_old.account_id <> a.id then raise exception 'NOT_FOUND'; end if;
    if exists (select 1 from public.wh_carrier_services where account_id = a.id and code = v_code and id <> p_id) then raise exception 'DUPLICATE_SERVICE: % already exists on %', v_code, a.name; end if;
    update public.wh_carrier_services
       set code = v_code, name = v_name, level = p_level, max_weight_g = p_max_weight_g, accepts_battery = coalesce(p_accepts_battery, false),
           accepts_liquid = coalesce(p_accepts_liquid, false), active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    v_id := p_id;
    perform write_audit('wh_carrier.service_updated', 'wh_carrier_accounts', a.id::text,
      jsonb_build_object('service_id', v_id, 'from', to_jsonb(v_old) - 'updated_by' - 'updated_at' - 'created_at', 'code', v_code, 'name', v_name, 'level', p_level,
                         'max_weight_g', p_max_weight_g, 'battery', coalesce(p_accepts_battery, false), 'liquid', coalesce(p_accepts_liquid, false), 'active', coalesce(p_active, true)));
  end if;
  return v_id;
end $function$;
revoke all on function public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.wh_save_carrier_service(uuid, uuid, text, text, text, integer, boolean, boolean, boolean) to authenticated, service_role;

-- restore wh_service_problem(uuid,text[],integer) (exact installed text)
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
  if s.max_weight_g is not null and p_weight_g is not null and p_weight_g > s.max_weight_g then
    return format('%s takes up to %s g', s.name, to_char(s.max_weight_g, 'FM999G999G990'));
  end if;
  return null;
end $function$;

-- restore wh_carriers_board(text) (exact installed text)
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
                          'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', s.level,
                                                    'max_weight_g', s.max_weight_g, 'accepts_battery', s.accepts_battery, 'accepts_liquid', s.accepts_liquid,
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

alter table public.wh_carrier_accounts drop column if exists last_check_message;
alter table public.wh_carrier_accounts drop column if exists last_check_ok;
alter table public.wh_carrier_accounts drop column if exists last_check_at;
alter table public.wh_carrier_services drop column if exists accepts_magnet;
