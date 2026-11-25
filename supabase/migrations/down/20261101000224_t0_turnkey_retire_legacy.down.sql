-- DOWN for 20261101000224_t0_turnkey_retire_legacy.sql
-- Then: delete from _migrations where name = '20261101000224_t0_turnkey_retire_legacy.sql';
drop trigger if exists trg_turnkey_leads_frozen on public.turnkey_leads;
drop function if exists public.turnkey_leads_frozen();
drop policy if exists turnkey_hubs_legacy_staff_read on public.turnkey_hubs;
drop policy if exists turnkey_packages_legacy_staff_read on public.turnkey_packages;
drop policy if exists turnkey_equipment_legacy_staff_read on public.turnkey_equipment;
drop policy if exists turnkey_sources_legacy_staff_read on public.turnkey_project_sources;
drop policy if exists turnkey_signals_legacy_staff_read on public.turnkey_atlas_signals;
create policy turnkey_signals_staff on public.turnkey_atlas_signals as PERMISSIVE for SELECT to public using ((can('turnkey'::text, 'view'::text) AND in_division(( SELECT tp.division_id
   FROM turnkey_projects tp
  WHERE (tp.project_id = turnkey_atlas_signals.project_id)))));
create policy turnkey_equipment_read on public.turnkey_equipment as PERMISSIVE for SELECT to public using (((EXISTS ( SELECT 1
   FROM (turnkey_packages k
     JOIN turnkey_projects p ON ((p.project_id = k.project_id)))
  WHERE ((k.package_id = turnkey_equipment.package_id) AND k.is_active AND (p.status <> 'archived'::text)))) OR can('turnkey'::text, 'view'::text)));
create policy turnkey_equipment_write on public.turnkey_equipment as PERMISSIVE for ALL to public using (can('turnkey'::text, 'edit'::text)) with check (can('turnkey'::text, 'edit'::text));
create policy turnkey_hubs_read on public.turnkey_hubs as PERMISSIVE for SELECT to public using (true);
create policy turnkey_hubs_write on public.turnkey_hubs as PERMISSIVE for ALL to public using (can('turnkey'::text, 'edit'::text)) with check (can('turnkey'::text, 'edit'::text));
create policy turnkey_packages_read on public.turnkey_packages as PERMISSIVE for SELECT to public using (((is_active AND (EXISTS ( SELECT 1
   FROM turnkey_projects p
  WHERE ((p.project_id = turnkey_packages.project_id) AND (p.status <> 'archived'::text))))) OR (can('turnkey'::text, 'view'::text) AND in_division(( SELECT tp.division_id
   FROM turnkey_projects tp
  WHERE (tp.project_id = turnkey_packages.project_id))))));
create policy turnkey_packages_write on public.turnkey_packages as PERMISSIVE for ALL to public using ((can('turnkey'::text, 'edit'::text) AND in_division(( SELECT tp.division_id
   FROM turnkey_projects tp
  WHERE (tp.project_id = turnkey_packages.project_id))))) with check ((can('turnkey'::text, 'edit'::text) AND in_division(( SELECT tp.division_id
   FROM turnkey_projects tp
  WHERE (tp.project_id = turnkey_packages.project_id)))));
create policy turnkey_sources_read on public.turnkey_project_sources as PERMISSIVE for SELECT to public using (true);
create policy turnkey_sources_write on public.turnkey_project_sources as PERMISSIVE for ALL to public using ((can('turnkey'::text, 'edit'::text) AND in_division(( SELECT tp.division_id
   FROM turnkey_projects tp
  WHERE (tp.project_id = turnkey_project_sources.project_id))))) with check ((can('turnkey'::text, 'edit'::text) AND in_division(( SELECT tp.division_id
   FROM turnkey_projects tp
  WHERE (tp.project_id = turnkey_project_sources.project_id)))));

-- functions back to 157 (dependency order: region and assignee first)
CREATE OR REPLACE FUNCTION public.submit_turnkey_lead(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proj turnkey_projects; v_pkg turnkey_packages; v_lead turnkey_leads; v_kind text := p->>'kind';
  v_region text; v_assignee uuid; v_title text;
begin
  select * into v_proj from turnkey_projects where project_id = p->>'project_id' and status <> 'archived';
  if not found then raise exception 'TURNKEY_PROJECT_NOT_FOUND'; end if;
  if v_kind = 'quote' and v_proj.status <> 'live' then raise exception 'TURNKEY_NOT_LIVE: % is open for register-interest only', v_proj.title; end if;
  if v_kind not in ('quote','interest') then raise exception 'TURNKEY_BAD_KIND'; end if;
  if nullif(p->>'package_id','') is not null then
    select * into v_pkg from turnkey_packages where package_id = (p->>'package_id')::uuid and project_id = v_proj.project_id;
    if not found then raise exception 'TURNKEY_PACKAGE_NOT_FOUND'; end if;
  end if;
  v_region := turnkey_region_for(p->>'country');
  v_assignee := turnkey_pick_assignee(v_region);
  insert into turnkey_leads(kind, project_id, package_id, buyer_user_id, org_id, company_name, contact_name, email, phone, country, region,
    preferred_delivery_term, delivery_place, target_open_date, floor_plan_storage_path, message, assigned_to, assigned_at, source)
  values (v_kind, v_proj.project_id, v_pkg.package_id, nullif(p->>'buyer_user_id','')::uuid, nullif(p->>'org_id','')::uuid,
    trim(p->>'company_name'), trim(p->>'contact_name'), lower(trim(p->>'email')), nullif(trim(p->>'phone'),''), upper(p->>'country'), v_region,
    nullif(p->>'delivery_term',''), nullif(trim(p->>'delivery_place'),''), nullif(p->>'target_open_date','')::date,
    nullif(p->>'floor_plan_path',''), nullif(trim(p->>'message'),''), v_assignee, case when v_assignee is not null then now() end, coalesce(p->>'source','web'))
  returning * into v_lead;
  if v_kind = 'interest' then
    insert into turnkey_atlas_signals(project_id, event, country_from) values (v_proj.project_id, 'interest', upper(p->>'country'));
  end if;
  v_title := case v_kind when 'quote' then 'New turnkey quote request' else 'New turnkey interest' end;
  if v_assignee is not null then
    insert into notifications(user_id, title, body, link)
    values (v_assignee, v_title, v_lead.reference || ' · ' || v_proj.title || coalesce(' · ' || v_pkg.tier_name, '') || ' · ' || v_lead.company_name || ' (' || v_lead.country || ')', '/admin/turnkey?lead=' || v_lead.lead_id);
  else -- triage pool: every admin + turnkey editor is told
    insert into notifications(user_id, title, body, link)
    select distinct ur.user_id, v_title || ' — unassigned', v_lead.reference || ' · ' || v_proj.title || ' · ' || v_lead.company_name || ' (' || v_lead.country || '). No sourcing agent for ' || coalesce(v_region, 'this region') || ' — please assign.', '/admin/turnkey?lead=' || v_lead.lead_id
    from user_roles ur where ur.role_code = 'admin';
  end if;
  insert into audit_log(actor_id, action, entity, entity_id, details)
  values (nullif(p->>'buyer_user_id','')::uuid, 'turnkey.lead_created', 'turnkey_leads', v_lead.lead_id::text,
          jsonb_build_object('reference', v_lead.reference, 'kind', v_kind, 'project', v_proj.project_id, 'assigned_to', v_assignee, 'region', v_region));
  return jsonb_build_object('lead_id', v_lead.lead_id, 'reference', v_lead.reference, 'assigned_to', v_assignee, 'region', v_region);
end $function$;
CREATE OR REPLACE FUNCTION public.log_turnkey_signal(p_event text, p_project text, p_hub text, p_country text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into turnkey_atlas_signals(project_id, hub_id, event, country_from)
  select nullif(p_project,''), nullif(p_hub,''), p_event, nullif(upper(p_country),'')
  where p_event in ('view','filter','tap_hub') and (nullif(p_project,'') is not null or nullif(p_hub,'') is not null)
$function$;
CREATE OR REPLACE FUNCTION public.turnkey_pick_assignee(p_region text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ur.user_id
  from user_roles ur join profiles pr on pr.id = ur.user_id
  where ur.role_code = 'sourcing_agent' and p_region is not null and pr.region = p_region and not coalesce(pr.out_of_office, false)
  order by (select max(l.assigned_at) from turnkey_leads l where l.assigned_to = ur.user_id) asc nulls first, ur.user_id
  limit 1
$function$;
CREATE OR REPLACE FUNCTION public.turnkey_region_for(p_country text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select case
    when upper(p_country) = any (array['AE','SA','QA','KW','BH','OM','YE','IQ','IR','JO','LB','SY','PS','IL','TR','EG','LY','TN','DZ','MA']) then 'MENA'
    when upper(p_country) = any (array['NG','GH','KE','TZ','UG','ET','RW','ZA','ZM','ZW','MZ','AO','CM','CI','SN','ML','BF','NE','TD','SD','SS','SO','DJ','ER','MW','BW','NA','LS','SZ','MG','MU','SC','CD','CG','GA','GQ','BJ','TG','LR','SL','GN','GW','GM','CV','MR','BI','CF','ST','KM']) then 'Africa'
    when upper(p_country) = any (array['IN','PK','BD','LK','NP','BT','MV','AF']) then 'Indian subcontinent'
    when upper(p_country) = any (array['TH','VN','MY','SG','ID','PH','KH','LA','MM','BN','TL']) then 'SEA'
    when upper(p_country) = any (array['US','CA','MX','BR','AR','CL','CO','PE','EC','VE','UY','PY','BO','CR','PA','GT','HN','SV','NI','DO','CU','JM','TT','BS','BB','HT','PR']) then 'Americas'
    when upper(p_country) = any (array['GB','IE','FR','DE','NL','BE','LU','ES','PT','IT','CH','AT','DK','SE','NO','FI','IS','PL','CZ','SK','HU','RO','BG','GR','HR','SI','RS','BA','ME','MK','AL','EE','LV','LT','UA','MD','BY','CY','MT','RU']) then 'Europe'
    else null end
$function$;

revoke all on function public.submit_turnkey_lead(jsonb) from public, anon, authenticated;
grant execute on function public.submit_turnkey_lead(jsonb) to service_role;
revoke all on function public.log_turnkey_signal(text, text, text, text) from public, anon, authenticated;
grant execute on function public.log_turnkey_signal(text, text, text, text) to service_role;
revoke all on function public.turnkey_pick_assignee(text) from public, anon, authenticated;
grant execute on function public.turnkey_pick_assignee(text) to service_role;
grant execute on function public.turnkey_region_for(text) to public, anon, authenticated, service_role;
comment on table public.turnkey_hubs is null;
comment on table public.turnkey_packages is null;
comment on table public.turnkey_equipment is null;
comment on table public.turnkey_project_sources is null;
comment on table public.turnkey_atlas_signals is null;
comment on table public.turnkey_leads is null;
