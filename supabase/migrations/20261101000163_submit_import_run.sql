-- Submit for moderation from an ADDON-27 import run (the Bowijie workbook), same rules as submit_import_job.
-- One per-product core (submit_one_for_moderation) now serves both: distributor jobs and admin import runs.

create or replace function submit_one_for_moderation(p_product uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
-- returns 'submitted' | 'already' | a plain reason why it could not be submitted (never raises)
declare v_status text;
begin
  select status::text into v_status from products where id = p_product;
  if v_status is null then return 'the product no longer exists'; end if;
  if v_status in ('submitted', 'in_review', 'live', 'paused') then return 'already'; end if;
  begin
    perform transition_product(p_product, 'submitted', p_reason);
    return 'submitted';
  exception when others then
    return case
      when sqlerrm like 'INVALID_TRANSITION%' then 'the product is ' || v_status || ' — only draft or rejected products can be submitted'
      when sqlerrm like 'FORBIDDEN%' then 'you do not have permission to submit this product'
      else regexp_replace(sqlerrm, '^[A-Z_]+:\s*', '') end;
  end;
end $$;
revoke execute on function submit_one_for_moderation(uuid, text) from public, anon, authenticated;

create or replace function submit_import_job(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_out text; v_changed int := 0; v_already int := 0; v_failed int := 0; v_total int := 0; v_status text; v_report jsonb;
begin
  if not exists (select 1 from import_jobs where id = p_job) then raise exception 'NOT_FOUND: import job not found'; end if;
  if not (exists (select 1 from import_jobs where id = p_job and created_by = auth.uid()) or can('products', 'edit')) then
    raise exception 'FORBIDDEN: you cannot submit this import job';
  end if;
  for r in select ir.id row_id, ir.product_id from import_rows ir where ir.job_id = p_job and ir.errors is null and ir.product_id is not null order by ir.row_no loop
    v_total := v_total + 1;
    v_out := submit_one_for_moderation(r.product_id, 'bulk import ' || p_job);
    if v_out = 'submitted' then v_changed := v_changed + 1; elsif v_out = 'already' then v_already := v_already + 1; else v_failed := v_failed + 1; end if;
    update import_rows set submit_error = case when v_out in ('submitted', 'already') then null else v_out end where id = r.row_id;
  end loop;
  v_status := case when v_total = 0 then 'imported' when v_failed = 0 then 'submitted' when v_changed + v_already = 0 then 'submit_failed' else 'partially_submitted' end;
  v_report := jsonb_build_object('total', v_total, 'submitted', v_changed, 'already_in_moderation', v_already, 'failed', v_failed);
  update import_jobs set status = v_status, submitted_at = case when v_changed > 0 then now() else submitted_at end, submit_report = v_report where id = p_job;
  perform write_audit('import_job.submitted', 'import_jobs', p_job::text, v_report || jsonb_build_object('job_status', v_status));
  return v_report || jsonb_build_object('job_status', v_status);
end $$;

alter table import_runs add column if not exists submit_report jsonb;
alter table import_runs add column if not exists submitted_at timestamptz;

-- every product of a committed run (by its Product Id in the staged batch) → moderation; reasons per Product Id
create or replace function submit_import_run(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_out text; v_changed int := 0; v_already int := 0; v_failed int := 0; v_total int := 0; v_results jsonb := '{}'; v_report jsonb;
begin
  if not can('products', 'edit') then raise exception 'FORBIDDEN: you cannot submit this import'; end if;
  if not exists (select 1 from import_runs where id = p_run and status = 'committed') then raise exception 'NOT_FOUND: committed import run not found'; end if;
  for r in select distinct s->>'external_id' sku, p.id product_id
           from import_runs ru cross join jsonb_array_elements(ru.staging->'products') s
           left join products p on p.sku_norm = upper(btrim(s->>'external_id'))
           where ru.id = p_run order by 1 loop
    v_total := v_total + 1;
    v_out := case when r.product_id is null then 'the product no longer exists' else submit_one_for_moderation(r.product_id, 'bulk import ' || p_run) end;
    if v_out = 'submitted' then v_changed := v_changed + 1; elsif v_out = 'already' then v_already := v_already + 1; else v_failed := v_failed + 1; end if;
    v_results := v_results || jsonb_build_object(r.sku, v_out);
  end loop;
  v_report := jsonb_build_object('total', v_total, 'submitted', v_changed, 'already_in_moderation', v_already, 'failed', v_failed,
    'status', case when v_failed = 0 then 'submitted' when v_changed + v_already = 0 then 'submit_failed' else 'partially_submitted' end, 'results', v_results);
  update import_runs set submit_report = v_report, submitted_at = case when v_changed > 0 then now() else submitted_at end where id = p_run;
  perform write_audit('import_run.submitted', 'import_runs', p_run::text, v_report - 'results');
  return v_report;
end $$;
revoke execute on function submit_import_run(uuid) from public, anon;
grant execute on function submit_import_run(uuid) to authenticated;
