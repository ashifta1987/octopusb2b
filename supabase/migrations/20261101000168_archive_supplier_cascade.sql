-- Archiving a supplier removes its products everywhere (owner, 7 Nov 2026):
-- "if we remove a supplier from the admin panel, that supplier's products — including the ones in moderation — must be removed too".
-- · archive_supplier(): supplier archived + every product it owns (draft, submitted, in review, live, paused, rejected) archived in the
--   same transaction; each product keeps the status it had (archived_by_supplier_from) so a restore can bring it back. Audited per product.
-- · restore_supplier(): supplier back; its products return conservatively — live/paused → paused (an admin resumes them),
--   submitted/in review → submitted (or draft if it no longer meets the submit rules), draft/rejected → unchanged. Audited.
-- · Safety nets: supplier_listings_live() is false for an archived supplier (storefront), and products of an archived supplier
--   cannot be created, submitted or published (trigger).
-- · Backfill: suppliers that are already archived get the same treatment now (OCT-1134 had 37 products still in moderation).
-- Archive, not delete: SKUs stay reserved, history and audit stay intact.

alter table products add column if not exists archived_by_supplier_from product_status;

create or replace function supplier_listings_live(p_supplier uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select listings_live from supplier_switches where supplier_id = p_supplier), true)
     and not exists (select 1 from suppliers where id = p_supplier and archived_at is not null);
$$;

-- internal: archive every non-archived product of the supplier (no permission check — callers check)
create or replace function _archive_supplier_products(p_supplier uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_by jsonb := '{}'::jsonb; v_n int := 0;
begin
  for r in select id, status, external_id, title from products where supplier_id = p_supplier and status <> 'archived' for update loop
    update products set status = 'archived', archived_at = coalesce(archived_at, now()), archived_by_supplier_from = r.status,
      moderation_hold = false where id = r.id;
    perform log_status('product', r.id, r.status::text, 'archived', coalesce(p_reason, 'supplier archived'));
    perform write_audit('product.archived_with_supplier', 'products', r.id::text,
      jsonb_build_object('sku', r.external_id, 'from_status', r.status, 'reason', coalesce(p_reason, 'supplier archived')));
    v_by := jsonb_set(v_by, array[r.status::text], to_jsonb(coalesce((v_by ->> r.status::text)::int, 0) + 1));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('products', v_n, 'by_status', v_by);
end $$;
revoke all on function _archive_supplier_products(uuid, text) from public, anon, authenticated;

create or replace function archive_supplier(p_supplier uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text; v_res jsonb;
begin
  if not can('suppliers', 'edit') then raise exception 'FORBIDDEN'; end if;
  select code into v_code from suppliers where id = p_supplier for update;
  if v_code is null then raise exception 'NOT_FOUND'; end if;
  update suppliers set archived_at = coalesce(archived_at, now()) where id = p_supplier;
  v_res := _archive_supplier_products(p_supplier, coalesce(nullif(trim(p_reason), ''), 'supplier ' || v_code || ' archived'));
  perform write_audit('supplier.archived', 'suppliers', p_supplier::text, v_res || jsonb_build_object('code', v_code));
  return v_res || jsonb_build_object('code', v_code);
end $$;
grant execute on function archive_supplier(uuid, text) to authenticated;

create or replace function restore_supplier(p_supplier uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text; r record; v_to product_status; v_by jsonb := '{}'::jsonb; v_n int := 0;
begin
  if not can('suppliers', 'edit') then raise exception 'FORBIDDEN'; end if;
  select code into v_code from suppliers where id = p_supplier for update;
  if v_code is null then raise exception 'NOT_FOUND'; end if;
  update suppliers set archived_at = null where id = p_supplier;
  for r in select id, archived_by_supplier_from f from products where supplier_id = p_supplier and status = 'archived' and archived_by_supplier_from is not null for update loop
    v_to := case when r.f in ('live', 'paused') then 'paused'
                 when r.f in ('submitted', 'in_review') then (case when product_submit_blocker(r.id) is null then 'submitted' else 'draft' end)::product_status
                 else r.f end;
    update products set status = v_to, archived_at = null, archived_by_supplier_from = null where id = r.id;
    perform log_status('product', r.id, 'archived', v_to::text, 'supplier ' || v_code || ' restored');
    perform write_audit('product.restored_with_supplier', 'products', r.id::text, jsonb_build_object('was', r.f, 'now', v_to));
    v_by := jsonb_set(v_by, array[v_to::text], to_jsonb(coalesce((v_by ->> v_to::text)::int, 0) + 1));
    v_n := v_n + 1;
  end loop;
  perform write_audit('supplier.restored', 'suppliers', p_supplier::text, jsonb_build_object('code', v_code, 'products', v_n, 'by_status', v_by));
  return jsonb_build_object('code', v_code, 'products', v_n, 'by_status', v_by);
end $$;
grant execute on function restore_supplier(uuid) to authenticated;

-- no new / submitted / live products for an archived supplier, by any route (imports, forms, moderation)
create or replace function guard_archived_supplier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'archived' then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.supplier_id is not distinct from old.supplier_id then return new; end if;
  if exists (select 1 from suppliers where id = new.supplier_id and archived_at is not null) then
    raise exception 'SUPPLIER_ARCHIVED: % — the supplier is archived; restore the supplier first', coalesce(new.external_id, new.title) using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_archived_supplier on products;
create trigger trg_guard_archived_supplier before insert or update of status, supplier_id on products
  for each row execute function guard_archived_supplier();

-- backfill: suppliers archived before this change
do $$
declare s record; v jsonb;
begin
  for s in select id, code from suppliers where archived_at is not null loop
    v := _archive_supplier_products(s.id, 'supplier ' || s.code || ' archived (backfill 7 Nov 2026)');
    if (v ->> 'products')::int > 0 then
      perform write_audit('supplier.archived_products_backfill', 'suppliers', s.id::text, v || jsonb_build_object('code', s.code));
    end if;
  end loop;
end $$;
