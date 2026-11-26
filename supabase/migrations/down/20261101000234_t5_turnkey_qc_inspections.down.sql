-- 20261101000234_t5_turnkey_qc_inspections.down.sql   (renumber at install)
-- Reverses 20261101000234_t5_turnkey_qc_inspections.sql (empty up → down schema diff of the public schema):
--  · tk_move_project_stage and tk_names_supplier come back exactly as staging has them after T4 (pg_get_functiondef,
--    26 Nov 2026; saved in scratch/t5/defs_staging.sql);
--  · the T5 tables, functions, guard trigger function and storage policies are removed; the event kinds go back to T4's;
--  · the permission area turnkey_qc (and every role permission on it) is removed.
-- Data: like the T2-T4 downs, inspections, their fees, checklists, reports and photo rows are removed, with the client
-- history rows of kind 'inspection'. Proformas already issued for inspection fees stay: they are invoices with ledger
-- journals, so the ledger stays balanced. Files in the turnkey-inspections bucket and the bucket itself stay (Supabase
-- refuses SQL deletes of storage rows; remove files with the Storage API if needed). Neither is in the public schema.

-- replaced functions, restored exactly (T4). tk_names_supplier first: the T5 version reads tk_inspections.
CREATE OR REPLACE FUNCTION public.tk_names_supplier(p_project uuid, p_text text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_text is not null and exists (
    select 1 from public.tk_factory_quotes q
     where q.project_id = p_project and length(btrim(q.supplier_name)) >= 3
       and position(lower(btrim(q.supplier_name)) in lower(p_text)) > 0);
$function$;

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
  v_name text;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors move projects'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this old enquiry is not linked to a client company yet'; end if;
  if v_msg is not null and length(v_msg) > 1000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 1,000 characters'; end if;
  select seq into v_from from public.tk_stages where code = v.stage;
  select seq, name into v_to, v_name from public.tk_stages where code = p_to_stage;
  if v_to is null then raise exception 'INVALID_STAGE'; end if;
  if v_to = v_from then raise exception 'SAME_STAGE: the project is already in this phase'; end if;
  if v_to > v_from + 1 then raise exception 'STAGE_SKIP: move one phase at a time'; end if;
  if v_to < v_from and v_msg is null then raise exception 'REASON_REQUIRED: tell the client why the project moves back'; end if;
  -- T4: Design is complete when the client has approved a layout drawing version; Quote and deposit is complete when the
  -- client has accepted a quote and its deposit is fully paid
  if v_to > v_from and v.stage = 'design'
     and not exists (select 1 from public.tk_drawing_versions d where d.project_id = v.id and d.status = 'approved') then
    raise exception 'DRAWING_NOT_APPROVED: Design is complete when the client approves a layout drawing version';
  end if;
  if v_to > v_from and v.stage = 'quote_deposit' then
    if not exists (select 1 from public.tk_client_quotes q where q.project_id = v.id and q.status = 'accepted') then
      raise exception 'QUOTE_NOT_ACCEPTED: Quote and deposit is complete when the client accepts a quote';
    end if;
    if not exists (select 1 from public.tk_client_quotes q where q.project_id = v.id and q.status = 'accepted' and public.tk_fee_is_paid(q.document_id)) then
      raise exception 'DEPOSIT_NOT_PAID: Quote and deposit is complete when the client has paid the deposit in full';
    end if;
  end if;
  -- T3 payment gate: a gated paid phase starts only when its fee is active (approved when above 2x) and the client has paid it
  if v_to > v_from and exists (select 1 from public.tk_stage_fee_rules r where r.stage = p_to_stage and r.gated) then
    if not exists (select 1 from public.tk_project_fees f where f.project_id = v.id and f.stage = p_to_stage and f.status = 'active') then
      raise exception 'FEE_NOT_APPROVED: % starts after its fee is set and active (an admin approves fees above 2x the starting fee)', v_name;
    end if;
    if exists (select 1 from public.tk_project_fees f where f.project_id = v.id and f.stage = p_to_stage and f.status = 'active'
                 and not public.tk_fee_is_paid(f.document_id)) then
      raise exception 'FEE_NOT_PAID: % starts after the client has paid its fee', v_name;
    end if;
  end if;
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

drop policy if exists "turnkey inspections inspector upload" on storage.objects;
drop policy if exists "turnkey inspections read" on storage.objects;
drop policy if exists "turnkey inspections remove unregistered" on storage.objects;

drop function if exists public.tk_list_inspection_fee_approvals();
drop function if exists public.tk_inspector_job(uuid);
drop function if exists public.tk_my_inspections();
drop function if exists public.tk_staff_inspections(uuid);
drop function if exists public.tk_override_psi(uuid, text);
drop function if exists public.tk_publish_inspection(uuid, text, uuid[]);
drop function if exists public.tk_return_inspection(uuid, text);
drop function if exists public.tk_submit_inspection(uuid, uuid, jsonb);
drop function if exists public.tk_remove_inspection_photo(uuid);
drop function if exists public.tk_add_inspection_photo(uuid, uuid, text, uuid);
drop function if exists public.tk_start_inspection(uuid);
drop function if exists public.tk_cancel_inspection(uuid, text);
drop function if exists public.tk_schedule_inspection(uuid, uuid, date);
drop function if exists public.tk_withdraw_inspection_fee(uuid);
drop function if exists public.tk_decide_inspection_fee(uuid, text, text);
drop function if exists public.tk_propose_inspection_fee(uuid, bigint, text);
drop function if exists public.tk_inspection_fee_activated(uuid, uuid);
drop function if exists public.tk_supersede_inspection_fee(uuid);
drop function if exists public.tk_create_inspection(uuid, text, text, text, text, jsonb, boolean);
drop function if exists public.tk_inspection_orphan_removable(text);
drop function if exists public.tk_inspection_file_visible(text);
drop function if exists public.tk_inspection_can_upload(text, text);
drop function if exists public.tk_inspection_label(text, integer);
drop function if exists public.tk_json_int(jsonb, text);
drop function if exists public.tk_inspection_paid(uuid);
drop function if exists public.tk_is_inspector(uuid);

drop table if exists public.tk_inspection_photos;
drop table if exists public.tk_inspection_reports;
drop table if exists public.tk_inspection_items;
drop table if exists public.tk_inspection_fees;
drop table if exists public.tk_inspections;
drop function if exists public.tk_t5_history_guard();

delete from public.tk_client_project_events where kind = 'inspection';
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date', 'fee', 'manager', 'drawing', 'quote'));

delete from public.role_permissions where area = 'turnkey_qc';
delete from public.permission_areas where code = 'turnkey_qc';
