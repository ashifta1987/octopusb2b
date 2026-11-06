-- Delete a supplier for good (owner, 7 Nov 2026). Decisions confirmed by the owner:
--  · Admin only; the admin types the supplier code to confirm; a preview shows everything that will be erased.
--  · Blocked when the supplier has business history (orders, quotes / RFQ replies, payouts, documents, finance approvals,
--    group buys, ad campaigns, RFQs or service requests on its products) — archive it instead.
--  · Erases: the supplier, its contacts / name variants / certificates / verifications / switches / distributor assignments,
--    every product it owns (any status, incl. moderation) with specs, prices, tiers, media rows, review items, import rows,
--    import jobs and import runs; product SKUs are released (sku_reservations) so they can be used again.
--  · Audit: one "supplier.deleted" record (code, who, when, counts) is kept; older log rows about the supplier and its products
--    are scrubbed (details replaced by {"erased": true}); status history and outbox events of its products are removed.
--  · The code is freed and given to the next new supplier (lowest freed code first, then the sequence).
-- Storage files (product photos not used by any other product, import zips) are returned for the app to delete.

create table if not exists freed_supplier_codes (
  code text primary key,
  freed_at timestamptz not null default now()
);
alter table freed_supplier_codes enable row level security;   -- definer functions only

-- new suppliers: reuse the lowest freed code, else the sequence (replaces the column default)
alter table suppliers alter column code drop default;
create or replace function assign_supplier_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.code is not null and btrim(new.code) <> '' then return new; end if;
  select code into v_code from freed_supplier_codes
   order by coalesce(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint, 0), code limit 1 for update skip locked;
  if v_code is not null then
    delete from freed_supplier_codes where code = v_code;
    new.code := v_code;
  else
    new.code := 'OCT-' || nextval('seq_supplier_code');
  end if;
  return new;
end $$;
drop trigger if exists trg_assign_supplier_code on suppliers;
create trigger trg_assign_supplier_code before insert on suppliers for each row execute function assign_supplier_code();

-- what deleting would erase, and what blocks it
create or replace function supplier_delete_preview(p_supplier uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; v_ids uuid[]; v_block jsonb := '[]'::jsonb; v_n bigint; v_by jsonb;
begin
  if not is_admin() then raise exception 'FORBIDDEN: only an Admin can delete a supplier'; end if;
  select id, code, legal_name, archived_at into s from suppliers where id = p_supplier;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(id), '{}') into v_ids from products where supplier_id = p_supplier;
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_by from (select status::text, count(*) n from products where supplier_id = p_supplier group by 1) x;

  select count(*) into v_n from orders where supplier_id = p_supplier;            if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s order(s)', v_n)); end if;
  select count(*) into v_n from quotes where supplier_id = p_supplier;            if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s quote(s) / RFQ replies', v_n)); end if;
  select count(*) into v_n from payouts where supplier_id = p_supplier;           if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s payout(s)', v_n)); end if;
  select count(*) into v_n from documents where supplier_id = p_supplier;         if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s document(s)', v_n)); end if;
  select count(*) into v_n from finance_approvals where supplier_id = p_supplier; if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s finance approval(s)', v_n)); end if;
  select count(*) into v_n from ad_campaigns where supplier_id = p_supplier;      if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s ad campaign(s)', v_n)); end if;
  select count(*) into v_n from pools where supplier_id = p_supplier or product_id = any(v_ids); if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s group buy(s)', v_n)); end if;
  select count(*) into v_n from rfqs where product_id = any(v_ids);               if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s RFQ(s) from buyers on its products', v_n)); end if;
  select count(*) into v_n from service_requests where product_id = any(v_ids);   if v_n > 0 then v_block := v_block || jsonb_build_array(format('%s service request(s) on its products', v_n)); end if;

  return jsonb_build_object(
    'code', s.code, 'legal_name', s.legal_name, 'archived', s.archived_at is not null,
    'products', coalesce(array_length(v_ids, 1), 0), 'products_by_status', v_by,
    'in_moderation', (select count(*) from products where supplier_id = p_supplier and status in ('submitted', 'in_review')),
    'photos', (select count(*) from product_media where product_id = any(v_ids)),
    'skus_released', (select count(*) from sku_reservations where supplier_id = p_supplier or product_id = any(v_ids)),
    'contacts', (select count(*) from supplier_contacts where supplier_id = p_supplier),
    'name_variants', (select count(*) from supplier_name_variants where supplier_id = p_supplier),
    'certificates', (select count(*) from certificates where supplier_id = p_supplier),
    'import_jobs', (select count(*) from import_jobs where supplier_id = p_supplier),
    'import_runs', (select count(*) from import_runs ru where staging->'supplier'->>'legal_name' = s.legal_name
                      or exists (select 1 from jsonb_array_elements(coalesce(ru.staging->'products', '[]'::jsonb)) x
                                 join products p on p.external_id = x->>'external_id' where p.supplier_id = p_supplier)),
    'distributors', (select count(*) from distributor_suppliers where supplier_id = p_supplier),
    'blockers', v_block, 'can_delete', jsonb_array_length(v_block) = 0,
    'code_reused_by_next_supplier', jsonb_array_length(v_block) = 0);
end $$;
grant execute on function supplier_delete_preview(uuid) to authenticated;

create or replace function delete_supplier(p_supplier uuid, p_confirm_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s record; v_prev jsonb; v_ids uuid[]; v_skus text[]; v_names text[]; v_run_ids uuid[];
  v_media text[]; v_zips text[]; n_audit int; n_hist int;
begin
  if not is_admin() then raise exception 'FORBIDDEN: only an Admin can delete a supplier'; end if;
  select * into s from suppliers where id = p_supplier for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if p_confirm_code is distinct from s.code then
    raise exception 'CONFIRM_MISMATCH: type the supplier code % exactly to delete it', s.code using errcode = 'P0001';
  end if;
  v_prev := supplier_delete_preview(p_supplier);
  if not (v_prev->>'can_delete')::boolean then
    raise exception 'SUPPLIER_DELETE_BLOCKED: % has business history (%) — archive it instead', s.code,
      (select string_agg(x, ', ') from jsonb_array_elements_text(v_prev->'blockers') x) using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}'), coalesce(array_agg(external_id) filter (where external_id is not null), '{}')
    into v_ids, v_skus from products where supplier_id = p_supplier;
  select array_remove(array[s.legal_name, s.contact_email, s.contact_phone, s.contact_name]
           || coalesce((select array_agg(variant_name) from supplier_name_variants where supplier_id = p_supplier), '{}')
           || coalesce((select array_agg(email) from supplier_contacts where supplier_id = p_supplier), '{}'), null)
    into v_names;
  v_names := array(select x from unnest(v_names) x where length(btrim(x)) >= 6);

  -- storage files to remove afterwards: photos not used by any other product, and import zips
  select coalesce(array_agg(distinct storage_path), '{}') into v_media from product_media m
   where m.product_id = any(v_ids) and m.storage_path is not null
     and not exists (select 1 from product_media o where o.storage_path = m.storage_path and not (o.product_id = any(v_ids)));
  select coalesce(array_agg(zip_path) filter (where zip_path is not null), '{}') into v_zips from import_jobs where supplier_id = p_supplier;

  -- imports: runs of this supplier, its jobs, and any import row about its products / code
  select coalesce(array_agg(ru.id), '{}') into v_run_ids from import_runs ru
   where staging->'supplier'->>'legal_name' = s.legal_name
      or exists (select 1 from jsonb_array_elements(coalesce(ru.staging->'products', '[]'::jsonb)) x where x->>'external_id' = any(v_skus));
  delete from import_review_items where product_id = any(v_ids) or run_id = any(v_run_ids);
  delete from import_runs where id = any(v_run_ids);
  delete from import_rows where product_id = any(v_ids) or data->>'supplier_code' = s.code;
  delete from import_jobs where supplier_id = p_supplier;
  delete from hs_backfill_proposals where product_id = any(v_ids);
  delete from ai_jobs where product_id = any(v_ids);
  delete from supplier_product_prices where supplier_id = p_supplier or product_id = any(v_ids);
  delete from sku_reservations where supplier_id = p_supplier or product_id = any(v_ids);
  delete from outbox_events where aggregate_id = any(v_ids) or aggregate_id = p_supplier;

  -- products (children cascade: specs, tiers, media rows, tags, costs, certificates links, recommendations, supplier links)
  delete from products where id = any(v_ids);
  -- the supplier (cascades: switches, distributor assignments, verifications, certificates, name variants, contacts, sources)
  delete from suppliers where id = p_supplier;

  -- history: status changes of its products go; older audit rows about it are scrubbed (no names, contacts or product data)
  delete from status_history where entity = 'product' and entity_id = any(v_ids);
  get diagnostics n_hist = row_count;
  update audit_log set details = jsonb_build_object('erased', true, 'supplier_code', s.code)
   where (entity = 'suppliers' and entity_id = p_supplier::text)
      or (entity = 'products' and entity_id = any(select x::text from unnest(v_ids) x))
      or exists (select 1 from unnest(v_names) nm where audit_log.details::text ilike '%' || nm || '%');
  get diagnostics n_audit = row_count;

  insert into freed_supplier_codes(code) values (s.code) on conflict (code) do nothing;
  perform write_audit('supplier.deleted', 'suppliers', s.code, jsonb_build_object(
    'code', s.code, 'products', coalesce(array_length(v_ids, 1), 0), 'products_by_status', v_prev->'products_by_status',
    'skus_released', coalesce(array_length(v_skus, 1), 0), 'photos_removed', coalesce(array_length(v_media, 1), 0),
    'import_runs', coalesce(array_length(v_run_ids, 1), 0), 'audit_rows_scrubbed', n_audit, 'status_rows_removed', n_hist,
    'code_freed', true));
  return jsonb_build_object('code', s.code, 'products', coalesce(array_length(v_ids, 1), 0), 'products_by_status', v_prev->'products_by_status',
    'skus_released', coalesce(array_length(v_skus, 1), 0), 'audit_rows_scrubbed', n_audit,
    'storage', jsonb_build_object('product-media', to_jsonb(v_media), 'imports', to_jsonb(v_zips)));
end $$;
grant execute on function delete_supplier(uuid, text) to authenticated;
