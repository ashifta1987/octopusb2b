-- Fix for 170 (7 Nov 2026): the same company can exist under two codes (OCT-1134 archived, OCT-1135 re-added with the same
-- legal name). Deleting one must not scrub the other's audit rows or import runs, so names / contacts that another supplier
-- still uses are never used for text matching; rows are then matched by the deleted supplier's id, product ids and SKUs only.

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
    'import_runs', (select count(*) from import_runs ru where (staging->'supplier'->>'legal_name' = s.legal_name and not exists (select 1 from suppliers o where o.id <> p_supplier and lower(o.legal_name) = lower(s.legal_name)))
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
  v_names := array(select x from unnest(v_names) x where length(btrim(x)) >= 6
    -- never match on a name / contact another supplier still uses (e.g. the same company re-added under a new code)
    and not exists (select 1 from suppliers o where o.id <> p_supplier and (lower(o.legal_name) = lower(x) or lower(coalesce(o.contact_email, '')) = lower(x) or lower(coalesce(o.contact_phone, '')) = lower(x) or lower(coalesce(o.contact_name, '')) = lower(x)))
    and not exists (select 1 from supplier_name_variants v where v.supplier_id <> p_supplier and lower(v.variant_name) = lower(x))
    and not exists (select 1 from supplier_contacts c where c.supplier_id <> p_supplier and lower(coalesce(c.email, '')) = lower(x)));

  -- storage files to remove afterwards: photos not used by any other product, and import zips
  select coalesce(array_agg(distinct storage_path), '{}') into v_media from product_media m
   where m.product_id = any(v_ids) and m.storage_path is not null
     and not exists (select 1 from product_media o where o.storage_path = m.storage_path and not (o.product_id = any(v_ids)));
  select coalesce(array_agg(zip_path) filter (where zip_path is not null), '{}') into v_zips from import_jobs where supplier_id = p_supplier;

  -- imports: runs of this supplier, its jobs, and any import row about its products / code
  select coalesce(array_agg(ru.id), '{}') into v_run_ids from import_runs ru
   where (staging->'supplier'->>'legal_name' = s.legal_name and not exists (select 1 from suppliers o where o.id <> p_supplier and lower(o.legal_name) = lower(s.legal_name)))
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
