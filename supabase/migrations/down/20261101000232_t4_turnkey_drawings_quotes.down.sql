-- 20261101000232_t4_turnkey_drawings_quotes.down.sql   (renumber at install)
-- Reverses 20261101000232_t4_turnkey_drawings_quotes.sql (empty up → down schema diff of the public schema):
--  · tk_move_project_stage comes back exactly as staging has it after T3 (pg_get_functiondef, 26 Nov 2026);
--  · the T4 tables, functions, guard trigger function and storage policies are removed; the event kinds go back to T3's.
-- Data: like the T2 / T3 downs, the drawing versions, comments, extra version charges, factory quotes and client quotes
-- are removed, with the client history rows of the T4 kinds (drawing / quote) and the turnkey.deposit_pct setting.
-- Proformas already issued (extra versions, deposits) stay: they are invoices with ledger journals, so the ledger stays
-- balanced. Files in the turnkey-drawings bucket and the bucket itself stay (Supabase refuses SQL deletes of storage
-- rows; remove files with the Storage API if needed). Neither is in the public schema.

-- replaced function, restored exactly (T3)
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

-- storage policies (bucket and files are kept, see the header)
drop policy if exists "turnkey drawings remove unregistered" on storage.objects;
drop policy if exists "turnkey drawings read" on storage.objects;
drop policy if exists "turnkey drawings staff upload" on storage.objects;

-- T4 functions
drop function if exists public.tk_staff_quotes(uuid);
drop function if exists public.tk_decide_client_quote(uuid, text, text);
drop function if exists public.tk_withdraw_client_quote(uuid, text);
drop function if exists public.tk_send_client_quote(uuid);
drop function if exists public.tk_discard_quote_draft(uuid);
drop function if exists public.tk_save_client_quote(uuid, text, date, jsonb);
drop function if exists public.tk_add_factory_quote(uuid, text, text, date, text, jsonb);
drop function if exists public.tk_names_supplier(uuid, text);
drop function if exists public.tk_set_deposit_pct(integer);
drop function if exists public.tk_deposit_pct();
drop function if exists public.tk_staff_drawings(uuid);
drop function if exists public.tk_waive_drawing_fee(uuid, text);
drop function if exists public.tk_decide_drawing(uuid, text, text);
drop function if exists public.tk_comment_drawing(uuid, text);
drop function if exists public.tk_add_drawing_version(uuid, text, text, text);
drop function if exists public.tk_drawing_orphan_removable(text);
drop function if exists public.tk_drawing_file_visible(text);
drop function if exists public.tk_drawing_can_upload(text);
drop function if exists public.tk_issue_project_proforma(uuid, text, text, text, bigint);
drop function if exists public.tk_is_project_customer(uuid);

-- T4 tables (children first; the guard allows cascades only, so the triggers go with their tables)
drop table if exists public.tk_client_quote_line_costs;
drop table if exists public.tk_client_quote_lines;
drop table if exists public.tk_client_quotes;
drop table if exists public.tk_factory_quote_lines;
drop table if exists public.tk_factory_quotes;
drop table if exists public.tk_drawing_extra_fees;
drop table if exists public.tk_drawing_comments;
drop table if exists public.tk_drawing_versions;
drop function if exists public.tk_t4_history_guard();

-- setting (data; never set by the up)
delete from public.site_settings where key = 'turnkey.deposit_pct';

-- client history kinds (T3)
delete from public.tk_client_project_events where kind in ('drawing', 'quote');
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date', 'fee', 'manager'));
