-- 20261101000231_t3_turnkey_fees_managers.down.sql
-- Reverses 20261101000231_t3_turnkey_fees_managers.sql exactly (empty up → down schema diff):
--  · the two replaced functions come back exactly as they were (pg_get_functiondef from staging before T3):
--    tk_move_project_stage (T2, no payment gate), tk_project_manager_name (T2, primary only);
--  · the T2 RLS policies on tk_client_projects / tk_client_project_staff come back as written in T2;
--  · fee tables, cover columns, new functions and the account_manager turnkey:view permission are removed.
-- Data: like the T2 down (which drops client projects), this down removes the fee versions and the cover settings, and
-- the client history rows of the T3 kinds (fee / manager). Turnkey proformas already issued stay (they are invoices with
-- ledger journals; their receivables / payments are untouched). If any exist, the invoice_lines service check comes back
-- NOT VALID (existing 'turnkey' lines are kept, new ones are refused) and a notice says so; on a database without
-- turnkey invoices the schema returns exactly to its pre-T3 state.

-- replaced functions, restored exactly
CREATE OR REPLACE FUNCTION public.tk_move_project_stage(p_project uuid, p_to_stage text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.tk_client_projects;
  v_from smallint;
  v_to smallint;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors move projects'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this old enquiry is not linked to a client company yet'; end if;
  if v_msg is not null and length(v_msg) > 1000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 1,000 characters'; end if;
  select seq into v_from from public.tk_stages where code = v.stage;
  select seq into v_to from public.tk_stages where code = p_to_stage;
  if v_to is null then raise exception 'INVALID_STAGE'; end if;
  if v_to = v_from then raise exception 'SAME_STAGE: the project is already in this phase'; end if;
  if v_to > v_from + 1 then raise exception 'STAGE_SKIP: move one phase at a time'; end if;
  if v_to < v_from and v_msg is null then raise exception 'REASON_REQUIRED: tell the client why the project moves back'; end if;
  -- Payment gates (each paid phase starts after the client's payment is confirmed) are added with the fees in T3.
  if v_to > v_from then
    update public.tk_client_project_stages set completed_at = now() where project_id = v.id and stage = v.stage;
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  else
    update public.tk_client_project_stages set started_at = null, completed_at = null
     where project_id = v.id and stage in (select code from public.tk_stages where seq > v_to);
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  end if;
  update public.tk_client_projects set stage = p_to_stage, stage_changed_at = now(), updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, from_stage, to_stage, message)
  values (v.id, case when v_to > v_from then 'stage_forward' else 'stage_back' end, v.stage, p_to_stage, v_msg);
  perform write_audit('turnkey.project_stage', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.stage, 'to', p_to_stage, 'message', v_msg));
end $function$;

CREATE OR REPLACE FUNCTION public.tk_project_manager_name(p_project uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select nullif(btrim(pr.full_name), '')
    from public.tk_client_projects p
    join public.tk_client_project_staff s on s.project_id = p.id
    join public.profiles pr on pr.id = s.owner_id
   where p.id = p_project
     and (p.org_id in (select my_org_ids()) or (is_staff() and can('turnkey', 'view') and in_division(p.division_id)));
$function$;

-- T2 policies
drop policy if exists tk_client_projects_read on public.tk_client_projects;
create policy tk_client_projects_read on public.tk_client_projects for select to authenticated
  using (org_id in (select my_org_ids()) or (is_staff() and can('turnkey', 'view') and in_division(division_id)));
drop policy if exists tk_client_project_staff_read on public.tk_client_project_staff;
create policy tk_client_project_staff_read on public.tk_client_project_staff for select to authenticated
  using (is_staff() and can('turnkey', 'view') and exists (select 1 from public.tk_client_projects p where p.id = project_id and in_division(p.division_id)));

-- T3 functions
drop function if exists public.tk_my_managed_projects();
drop function if exists public.tk_set_project_cover(uuid, uuid, date, date);
drop function if exists public.tk_project_contact(uuid);
drop function if exists public.tk_list_fee_approvals(integer);
drop function if exists public.tk_list_project_fees(uuid);
drop function if exists public.tk_withdraw_fee(uuid);
drop function if exists public.tk_decide_fee(uuid, text, text);
drop function if exists public.tk_propose_fee(uuid, text, text, bigint, text);
drop function if exists public.tk_fee_activated(uuid, uuid);
drop function if exists public.tk_supersede_fee(uuid, text, text);
drop function if exists public.tk_issue_fee_proforma(uuid, text, text, bigint);
drop function if exists public.tk_void_fee_document(uuid);
drop function if exists public.tk_fee_is_paid(uuid);
drop function if exists public.tk_staff_can_view(uuid);
drop function if exists public.tk_is_project_manager(uuid);
drop function if exists public.tk_active_manager(uuid);

-- T3 tables
drop table if exists public.tk_project_fees;
drop function if exists public.tk_project_fees_guard();
drop table if exists public.tk_stage_fee_rules;

-- account managers: back to no Turnkey permission
delete from public.role_permissions where role_code = 'account_manager' and area = 'turnkey' and action = 'view';

-- cover columns
drop index if exists public.tk_client_project_staff_cover_idx;
alter table public.tk_client_project_staff drop constraint if exists tk_client_project_staff_cover_not_owner;
alter table public.tk_client_project_staff drop constraint if exists tk_client_project_staff_cover_dates;
alter table public.tk_client_project_staff drop column if exists cover_set_at;
alter table public.tk_client_project_staff drop column if exists cover_to;
alter table public.tk_client_project_staff drop column if exists cover_from;
alter table public.tk_client_project_staff drop column if exists cover_id;

-- client history kinds (T2)
delete from public.tk_client_project_events where kind in ('fee', 'manager');
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date'));

-- invoice line services (before T3)
alter table public.invoice_lines drop constraint if exists invoice_lines_service_check;
do $$
begin
  if exists (select 1 from public.invoice_lines where service = 'turnkey') then
    alter table public.invoice_lines add constraint invoice_lines_service_check
      check (service = any (array['sourcing'::text, 'dropship'::text, 'warehouse'::text, 'brand'::text, 'wallet'::text])) not valid;
    raise notice 'T3 down: turnkey invoice lines exist; invoice_lines_service_check restored NOT VALID (existing lines kept)';
  else
    alter table public.invoice_lines add constraint invoice_lines_service_check
      check (service = any (array['sourcing'::text, 'dropship'::text, 'warehouse'::text, 'brand'::text, 'wallet'::text]));
  end if;
end $$;
