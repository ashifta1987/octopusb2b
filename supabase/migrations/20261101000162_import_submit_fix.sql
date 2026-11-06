-- Fix: bulk-import "Submit for moderation" (job b1e4cb86…) marked the job submitted while every product stayed draft.
-- Causes: (d) trg_guard_import_publish refused draft→submitted for all 50 Bowijie rows (supplier OCT-1132 identity
-- unresolved) and (e) the server action ignored the per-product errors and set the job to 'submitted' anyway.
--
-- 1. The import gate now guards PUBLISHING (→ live) only. Products may enter the moderation queue; the moderator sees
--    the blocker and cannot approve until it is resolved. Nothing unresolved can go live.
-- 2. submit_import_job(): one transaction, every valid product of the job (creates AND updates) → 'submitted' (the status
--    the /office/products queue reads), per-product failure reasons stored on the row, job status reflects reality,
--    audit_log row for the job.
-- 3. Imports never lower a product: the ADDON-27 workbook's Platform status (listing_status) applies to NEW products only.

create or replace function product_publish_blocker(p_product uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from suppliers s join supplier_products sp on sp.supplier_id = s.id where sp.product_id = p.id and s.identity_status <> 'ok')
      then 'the supplier has unresolved legal-name variants — pick the canonical name in Admin → Suppliers'
    when exists (select 1 from import_review_items where product_id = p.id and status in ('open', 'held'))
      then 'it has open import review items — resolve them in Admin → Bulk import → Review'
    when p.listing_status in ('needs_quote', 'in_development') then 'the supplier has not quoted a price yet'
    when not exists (select 1 from price_tiers where product_id = p.id) then 'it has no buyer price'
  end
  from products p where p.id = p_product and p.external_id is not null
$$;
grant execute on function product_publish_blocker(uuid) to authenticated;

create or replace function guard_import_publish() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if new.status <> 'live' or new.status is not distinct from old.status then return new; end if;
  v_reason := product_publish_blocker(new.id);
  if v_reason is not null then
    raise exception 'IMPORT_PUBLISH_BLOCKED: % cannot be published: %', coalesce(new.external_id, new.title), v_reason using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table import_rows add column if not exists submit_error text;
alter table import_jobs add column if not exists submitted_at timestamptz;
alter table import_jobs add column if not exists submit_report jsonb;

-- definer (writes import rows + audit); access: the job's uploader or products.edit. transition_product re-checks
-- products.edit / is_my_supplier for every product with the caller's auth.uid().
create or replace function submit_import_job(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_changed int := 0; v_already int := 0; v_failed int := 0; v_total int := 0; v_status text; v_report jsonb;
begin
  if not exists (select 1 from import_jobs where id = p_job) then raise exception 'NOT_FOUND: import job not found'; end if;
  if not (exists (select 1 from import_jobs where id = p_job and created_by = auth.uid()) or can('products', 'edit')) then
    raise exception 'FORBIDDEN: you cannot submit this import job';
  end if;
  for r in select ir.id row_id, ir.row_no, p.id product_id, p.status::text status
           from import_rows ir join products p on p.id = ir.product_id
           where ir.job_id = p_job and ir.errors is null order by ir.row_no
  loop
    v_total := v_total + 1;
    if r.status in ('submitted', 'in_review', 'live', 'paused') then
      v_already := v_already + 1;
      update import_rows set submit_error = null where id = r.row_id;
      continue;
    end if;
    begin
      perform transition_product(r.product_id, 'submitted', 'bulk import ' || p_job);
      v_changed := v_changed + 1;
      update import_rows set submit_error = null where id = r.row_id;
    exception when others then
      v_failed := v_failed + 1;
      update import_rows set submit_error = case
        when sqlerrm like 'INVALID_TRANSITION%' then 'the product is ' || r.status || ' — only draft or rejected products can be submitted'
        when sqlerrm like 'FORBIDDEN%' then 'you do not have permission to submit this product'
        else regexp_replace(sqlerrm, '^[A-Z_]+:\s*', '') end where id = r.row_id;
    end;
  end loop;
  v_status := case when v_total = 0 then 'imported'
                   when v_failed = 0 then 'submitted'
                   when v_changed + v_already = 0 then 'submit_failed'
                   else 'partially_submitted' end;
  v_report := jsonb_build_object('total', v_total, 'submitted', v_changed, 'already_in_moderation', v_already, 'failed', v_failed);
  update import_jobs set status = v_status, submitted_at = case when v_changed > 0 then now() else submitted_at end, submit_report = v_report where id = p_job;
  perform write_audit('import_job.submitted', 'import_jobs', p_job::text, v_report || jsonb_build_object('job_status', v_status));
  return v_report || jsonb_build_object('job_status', v_status);
end $$;
revoke execute on function submit_import_job(uuid) from public, anon;
grant execute on function submit_import_job(uuid) to authenticated;

-- 3 · ADDON-27 workbook: on UPDATE keep listing_status (Platform status only applies to new products)
do $$
declare def text; patched text;
begin
  def := pg_get_functiondef('commit_import_run(uuid,uuid,text)'::regprocedure);
  if position('listing_status = coalesce(v->>''listing_status'', listing_status)' in def) = 0 then return; end if;
  patched := replace(def, 'listing_status = coalesce(v->>''listing_status'', listing_status)', 'listing_status = listing_status');
  execute patched;
end $$;
