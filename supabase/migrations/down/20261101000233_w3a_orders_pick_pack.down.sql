-- DOWN for 20261101000233_w3a_orders_pick_pack.sql
-- Then: delete from _migrations where name = '20261101000233_w3a_orders_pick_pack.sql';
-- Restores record_warehouse_stock_movement() (W2a text) and wh_lot_free() (W2b text) exactly, removes the storage policies,
-- every W3a function, table and sequence, and warehouse_stock_movements.wh_order_id.
-- Kept on purpose: stock movements already posted for warehouse orders (append-only ledger rows; their wh_order_id column
-- goes with this down) and the private 'wh-evidence' bucket with any photos in it (storage data, not schema; remove it with
-- the Storage API if W3a is abandoned — up uses "on conflict do nothing", so down → up works either way).
-- the exact wipe_demo_data() of 20261101000230_demo_wipe_turnkey_warehouse.sql
CREATE OR REPLACE FUNCTION public.wipe_demo_data(p_confirm text, p_operator uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_ref text := 'ydbxqrizjxpduqbgnwxg';                     -- the STAGING project (19 Nov 2026: staging only)
  v_counts jsonb := '{}';
  v_users uuid[];
  n bigint;
  fk record;
  s record;
  v_bad text := '';
  v_real_wallets jsonb;
  v_kept uuid[];
begin
  if p_confirm is distinct from 'DELETE DEMO DATA FOR ' || v_ref then
    raise exception 'WIPE_REFUSED: type exactly "DELETE DEMO DATA FOR %"', v_ref using errcode = 'P0001';
  end if;
  -- staging only (19 Nov 2026): refuse on any database not marked staging (live is 'production')
  if coalesce((select value #>> '{}' from site_settings where key = 'app_environment'), '') <> 'staging' then
    raise exception 'WIPE_REFUSED: demo data can only be wiped on the staging project' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('wipe_demo_data'));
  perform tag_seed_rows();   -- pick up anything created on demo rows since the migration
  -- real (not demo/test) customers' wallet balances, to prove the wipe did not change them
  select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') into v_real_wallets
    from wallets w join organizations o on o.id = w.org_id where not o.is_seed;

  -- demo staff + demo buyer (admin@demo.octopusb2b.com is KEPT until the owner creates a real admin — owner decision)
  select coalesce(array_agg(id), '{}') into v_users from auth.users
   where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com';
  -- (Batch 3) demo users who proposed or approved a fee schedule stay: fee_versions is an append-only, two-person
  -- approval history (migration 211) — nulling approved_by or deleting the row is refused by guard_fee_versions().
  select coalesce(array_agg(u), '{}') into v_kept from unnest(v_users) u
   where exists (select 1 from fee_versions f where f.proposed_by = u or f.approved_by = u);
  v_users := array(select u from unnest(v_users) u where u <> all (v_kept));

  -- references to those users that don't cascade: null them (or drop the row when the column is NOT NULL)
  for fk in
    select conrelid::regclass::text tbl, a.attname col, a.attnotnull nn
      from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.confdeltype in ('a', 'r')
       and k.connamespace = 'public'::regnamespace
       and k.conrelid <> 'public.fee_versions'::regclass
  loop
    if fk.nn then execute format('delete from %s where %I = any($1)', fk.tbl, fk.col) using v_users;
    else execute format('update %s set %I = null where %I = any($1)', fk.tbl, fk.col, fk.col) using v_users; end if;
  end loop;

  -- seed rows, children before parents. Every FK into these tables is NO ACTION, so links from rows that stay
  -- (or that are deleted later in this list) are cleared first.
  update finance_approvals set executed_journal_id = null where executed_journal_id in (select id from journals where is_seed);
  delete from finance_approvals where order_id in (select id from orders where is_seed)
     or org_id in (select id from organizations where is_seed) or supplier_id in (select id from suppliers where is_seed);
  delete from ledger_entries where is_seed;                   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_entries', n);
  delete from journals where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journals', n);
  delete from assistant_messages where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_messages', n);
  delete from assistant_sessions where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_sessions', n);
  delete from ad_campaigns where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ad_campaigns', n);
  update escalations set ticket_id = null where ticket_id in (select id from tickets where is_seed);
  delete from tickets where is_seed;                          get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tickets', n);
  delete from shipments where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('shipments', n);
  delete from wallet_topups where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_topups', n);
  update wallet_topups set payment_id = null where payment_id in (select id from payments where is_seed);
  delete from payments where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('payments', n);
  delete from documents where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('documents', n);
  delete from proforma_invoices where is_seed;                get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('proforma_invoices', n);
  update orders set pool_pledge_id = null where pool_pledge_id in (select id from pool_pledges where is_seed);
  update pool_pledges set order_id = null where order_id in (select id from orders where is_seed);
  delete from pool_pledges where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pool_pledges', n);
  delete from orders where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders', n);
  delete from quotes where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('quotes', n);
  delete from rfqs where is_seed;                             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('rfqs', n);
  delete from service_requests where is_seed;                 get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('service_requests', n);
  delete from pools where is_seed;                            get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pools', n);
  update import_rows set product_id = null where product_id in (select id from products where is_seed);
  delete from products where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('products', n);
  update import_jobs set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  update payouts set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  delete from suppliers where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', n);
  -- Turnkey T2 + Warehouse OS W1–W2b rows of demo / test companies (migration 230); stock movements are never deleted
  delete from tk_client_projects p where p.org_id in (select id from organizations where is_seed)
     or exists (select 1 from tk_client_project_staff tps where tps.project_id = p.id and tps.is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tk_client_projects', n);
  delete from wh_clients where org_id in (select id from organizations where is_seed);
  delete from wh_location_moves where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_transfer_picks where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_bin_stock where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  update wh_transfer_lines set dest_lot_id = null where dest_lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed));
  delete from wh_pallets where org_id in (select id from organizations where is_seed);
  delete from wh_lots where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_lots', n);
  delete from wh_asns where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_asns', n);
  delete from wh_client_skus where org_id in (select id from organizations where is_seed);
  delete from wallet_withdrawals where org_id in (select id from organizations where is_seed);
  -- wallet holds of demo / test companies (added by migration 177 after this function was written)
  delete from wallet_holds where org_id in (select id from organizations where is_seed);   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_holds', n);
  delete from ledger_accounts where org_id in (select id from organizations where is_seed);
  delete from organizations where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('organizations', n);
  delete from auth.users where id = any(v_users);             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('demo_users', n);
  v_counts := v_counts || jsonb_build_object('demo_users_kept_fee_history', coalesce(array_length(v_kept, 1), 0));

  -- (19 Nov 2026) real customers' notifications are no longer touched: the wipe deletes only rows marked as demo/test

  -- human codes restart at 1001 (or after the highest code that still exists)
  for s in select * from (values
      ('seq_supplier_code', 'suppliers', 'code', '^OCT-(\d+)$'),
      ('seq_rfq', 'rfqs', 'code', '^RFQ-(\d+)$'),
      ('seq_order', 'orders', 'code', '^ORD-(\d+)$'),
      ('seq_shipment', 'shipments', 'code', '^SHP-(\d+)$'),
      ('seq_ticket', 'tickets', 'code', '^TKT-(\d+)$'),
      ('seq_pool', 'pools', 'code', '^POOL-(\d+)$'),
      ('seq_service_request', 'service_requests', 'code', '^SRV-(\d+)$'),
      ('seq_export', 'data_exports', 'code', '^EX-(\d+)$'),
      ('seq_restore', 'restore_requests', 'code', '^RS-(\d+)$'),
      ('seq_journal', 'journals', 'number', '^JRN-(\d+)$'),
      ('seq_pi', 'proforma_invoices', 'number', '^PI-\d{4}-(\d+)$'),
      ('seq_invoice', 'documents', 'number', '^INV-\d{4}-(\d+)$'),
      ('seq_quote', 'quotes', 'code', '^QT-(\d+)$'),
      ('seq_buyer_code', 'organizations', 'buyer_code', '^BUYER-(\d+)$')
    ) v(seq, tbl, col, rx)
  loop
    if to_regclass('public.' || s.seq) is null then continue; end if;
    execute format('select coalesce(max((substring(%I from %L))::bigint), 0) from %I', s.col, s.rx, s.tbl) into n;
    perform setval(s.seq, greatest(1000, n), true);
  end loop;

  -- launch defaults (audit C3 / K7)
  update site_settings set value = jsonb_set(coalesce(value, '{}'), '{amount_minor}', '0') || '{"verified_only": true}'::jsonb, updated_at = now()
   where key = 'wallet_credit_default';
  update site_settings set value = 'false'::jsonb, updated_at = now() where key = 'supplier_portal_enabled';
  update site_settings set value = 'true'::jsonb, updated_at = now() where key = 'pool_enabled';
  -- category names: capitalise the first letter of hand-typed lowercase names ("kitchen utensils" → "Kitchen utensils")
  update categories set name = upper(left(name, 1)) || substr(name, 2) where name ~ '^[a-z]';

  -- verify
  select string_agg(t, ', ') into v_bad from (
    select 'organizations' t where exists (select 1 from organizations where is_seed) union all
    select 'suppliers' where exists (select 1 from suppliers where is_seed) union all
    select 'products' where exists (select 1 from products where is_seed) union all
    select 'orders' where exists (select 1 from orders where is_seed) union all
    select 'journals' where exists (select 1 from journals where is_seed) union all
    select 'ledger_entries' where exists (select 1 from ledger_entries where is_seed) union all
    select 'pools' where exists (select 1 from pools where is_seed) union all
    select 'demo users' where exists (select 1 from auth.users where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com' and id <> all (v_kept)) union all
    select 'ledger not balanced' where coalesce((select sum(debit_cents - credit_cents) from ledger_entries), 0) <> 0 union all
    -- 19 Nov 2026: real customers may hold money (e.g. on staging); the check is that their balances did not change
    select 'real wallet balance changed' where v_real_wallets is distinct from
      (select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') from wallets w join organizations o on o.id = w.org_id where not o.is_seed) union all
    select 'open pools' where exists (select 1 from pools where status in ('open', 'locked'))) x;
  if v_bad is not null then raise exception 'WIPE_VERIFY_FAILED: %', v_bad; end if;

  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (p_operator, 'demo_data_wiped', 'database', v_ref, jsonb_build_object('counts', v_counts, 'at', now()));
  insert into site_settings(key, value, description) values ('demo_wipe',
      jsonb_build_object('at', now(), 'by', p_operator, 'by_name', (select full_name from profiles where id = p_operator), 'counts', v_counts),
      'When the demo dataset was removed (ADDON-24). Drives the one-time "Add your first supplier" banner on /admin.')
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_counts;
end $function$;

drop policy if exists "wh evidence upload" on storage.objects;
drop policy if exists "wh evidence read" on storage.objects;

-- restore the previous functions first (the W3a text of record_warehouse_stock_movement reads wh_orders)
-- same signature and grants; only the default warehouse and the internal-caller branch change
CREATE OR REPLACE FUNCTION public.record_warehouse_stock_movement(p_item_id uuid, p_kind text, p_qty integer, p_reason text, p_warehouse_id text DEFAULT public.default_warehouse_code(), p_store_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh text := coalesce(nullif(btrim(p_warehouse_id), ''), public.default_warehouse_code());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_cur public.warehouse_stock;
  v_existing public.warehouse_stock_movements;
  v_res_mov public.warehouse_stock_movements;
  v_oh_delta integer;
  v_res_delta integer;
  v_mov_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit()
             or (coalesce(current_setting('octopus.wh_internal', true), '') = 'true' and is_staff())) then
    raise exception 'FORBIDDEN: only 3PL staff or an admin may record warehouse stock movements';
  end if;

  if p_item_id is null or p_qty is null or p_qty <= 0 or v_reason is null then
    raise exception 'INVALID_MOVEMENT: item_id, positive qty, and non-empty reason are required';
  end if;

  if v_kind not in ('inbound', 'adjust_in', 'adjust_out', 'reserve', 'release', 'pick') then
    raise exception 'INVALID_MOVEMENT_KIND: %', v_kind;
  end if;

  if v_kind in ('reserve', 'release', 'pick') and p_store_order_id is null then
    raise exception 'STORE_ORDER_REQUIRED: % movement requires store_order_id', v_kind;
  end if;

  -- Ensure warehouse_stock row exists, then lock it FOR UPDATE
  perform set_config('octopus.allow_warehouse_stock_sync', 'true', true);
  begin
    insert into public.warehouse_stock (warehouse_id, item_id, on_hand_qty, reserved_qty)
    values (v_wh, p_item_id, 0, 0)
    on conflict (warehouse_id, item_id) do nothing;
  exception when others then
    perform set_config('octopus.allow_warehouse_stock_sync', '', true);
    raise;
  end;
  perform set_config('octopus.allow_warehouse_stock_sync', '', true);

  select * into v_cur
    from public.warehouse_stock
   where warehouse_id = v_wh and item_id = p_item_id
   for update;

  -- Idempotency check for order-scoped movements (reserve / release / pick)
  if p_store_order_id is not null then
    select * into v_existing
      from public.warehouse_stock_movements
     where warehouse_id = v_wh
       and item_id = p_item_id
       and store_order_id = p_store_order_id
       and kind = v_kind
     limit 1;

    if v_existing.id is not null then
      return jsonb_build_object(
        'idempotent', true,
        'movement_id', v_existing.id,
        'warehouse_id', v_wh,
        'item_id', p_item_id,
        'on_hand_qty', v_cur.on_hand_qty,
        'reserved_qty', v_cur.reserved_qty,
        'available_qty', v_cur.on_hand_qty - v_cur.reserved_qty
      );
    end if;
  end if;

  if v_kind in ('release', 'pick') then
    select * into v_res_mov
      from public.warehouse_stock_movements
     where warehouse_id = v_wh
       and item_id = p_item_id
       and store_order_id = p_store_order_id
       and kind = 'reserve'
     limit 1;

    if v_res_mov.id is null then
      raise exception 'NO_ACTIVE_RESERVATION: no reserve movement found for order %', p_store_order_id;
    end if;

    if exists (
      select 1
        from public.warehouse_stock_movements
       where warehouse_id = v_wh
         and item_id = p_item_id
         and store_order_id = p_store_order_id
         and kind in ('release', 'pick')
    ) then
      raise exception 'RESERVATION_ALREADY_CONSUMED: reservation for order % was already released or picked', p_store_order_id;
    end if;

    if p_qty <> v_res_mov.qty then
      raise exception 'RESERVATION_QTY_MISMATCH: expected reserved qty %, got %', v_res_mov.qty, p_qty;
    end if;
  end if;

  case v_kind
    when 'inbound' then v_oh_delta := p_qty; v_res_delta := 0;
    when 'adjust_in' then v_oh_delta := p_qty; v_res_delta := 0;
    when 'adjust_out' then
      if (v_cur.on_hand_qty - v_cur.reserved_qty) < p_qty then
        raise exception 'INSUFFICIENT_AVAILABLE_STOCK: available %, requested adjust_out %', (v_cur.on_hand_qty - v_cur.reserved_qty), p_qty;
      end if;
      v_oh_delta := -p_qty; v_res_delta := 0;
    when 'reserve' then
      if (v_cur.on_hand_qty - v_cur.reserved_qty) < p_qty then
        raise exception 'INSUFFICIENT_AVAILABLE_STOCK: available %, requested reserve %', (v_cur.on_hand_qty - v_cur.reserved_qty), p_qty;
      end if;
      v_oh_delta := 0; v_res_delta := p_qty;
    when 'release' then
      v_oh_delta := 0; v_res_delta := -p_qty;
    when 'pick' then
      v_oh_delta := -p_qty; v_res_delta := -p_qty;
  end case;

  perform set_config('octopus.allow_warehouse_stock_sync', 'true', true);
  begin
    update public.warehouse_stock
       set on_hand_qty = on_hand_qty + v_oh_delta,
           reserved_qty = reserved_qty + v_res_delta,
           updated_at = now()
     where warehouse_id = v_wh and item_id = p_item_id
     returning * into v_cur;
  exception when others then
    perform set_config('octopus.allow_warehouse_stock_sync', '', true);
    raise;
  end;
  perform set_config('octopus.allow_warehouse_stock_sync', '', true);

  insert into public.warehouse_stock_movements (
    warehouse_id,
    item_id,
    kind,
    qty,
    on_hand_delta,
    reserved_delta,
    store_order_id,
    reason,
    actor_id
  ) values (
    v_wh,
    p_item_id,
    v_kind,
    p_qty,
    v_oh_delta,
    v_res_delta,
    p_store_order_id,
    v_reason,
    auth.uid()
  )
  returning id into v_mov_id;

  perform write_audit(
    'warehouse_stock.' || v_kind,
    'warehouse_stock',
    v_wh || ':' || p_item_id::text,
    jsonb_build_object(
      'movement_id', v_mov_id,
      'qty', p_qty,
      'on_hand_qty', v_cur.on_hand_qty,
      'reserved_qty', v_cur.reserved_qty,
      'store_order_id', p_store_order_id,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'idempotent', false,
    'movement_id', v_mov_id,
    'warehouse_id', v_wh,
    'item_id', p_item_id,
    'on_hand_qty', v_cur.on_hand_qty,
    'reserved_qty', v_cur.reserved_qty,
    'available_qty', v_cur.on_hand_qty - v_cur.reserved_qty
  );
end $function$;


-- units of a released lot not yet in a bin and not sent away on a transfer
create or replace function public.wh_lot_free(p_lot uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select t.qty
         - coalesce((select sum(b.qty) from public.wh_bin_stock b where b.lot_id = t.id), 0)::integer
         - coalesce((select sum(p.qty) from public.wh_transfer_picks p where p.lot_id = t.id), 0)::integer
    from public.wh_lots t where t.id = p_lot
$$;

drop function if exists public.wh_portal_proof(text);
drop function if exists public.wh_evidence_board(text, text);
drop function if exists public.wh_pack_board(text);
drop function if exists public.wh_pick_board(text);
drop function if exists public.wh_order_detail(text);
drop function if exists public.wh_orders_board(text, text, text, text);
drop function if exists public.wh_order_row(public.wh_orders);
drop function if exists public.wh_evidence_can_read(text);
drop function if exists public.wh_evidence_can_upload(text);
drop function if exists public.wh_save_box(text, uuid, text, text, integer, integer, integer, integer, boolean);
drop function if exists public.wh_save_settings(text, integer, numeric, integer);
drop function if exists public.wh_pack_close(uuid, boolean);
drop function if exists public.wh_add_evidence(uuid, text, text);
drop function if exists public.wh_unlock_override(uuid, text);
drop function if exists public.wh_weight_override(uuid, uuid, text, text);
drop function if exists public.wh_set_my_pin(text);
drop function if exists public.wh_pack_weigh(uuid, integer);
drop function if exists public.wh_pack_set_box(uuid, uuid);
drop function if exists public.wh_pack_scan(uuid, text);
drop function if exists public.wh_cancel_order(uuid, text);
drop function if exists public.wh_resolve_exception(uuid, text, text);
drop function if exists public.wh_report_short(uuid, uuid, text);
drop function if exists public.wh_pick_scan(uuid, text, text, integer);
drop function if exists public.wh_start_pick(uuid);
drop function if exists public.wh_import_dropship_order(uuid);
drop function if exists public.wh_dropship_is_ready(uuid);
drop function if exists public.wh_retry_allocation(uuid);
drop function if exists public.wh_create_client_orders(uuid, jsonb, text);
drop function if exists public.wh_validate_client_orders(uuid, jsonb);
drop function if exists public.wh_create_client_order(uuid, jsonb, text);
drop function if exists public.wh_insert_client_order(uuid, jsonb, text);
drop function if exists public.wh_check_client_order(uuid, jsonb);
drop function if exists public.wh_allocate(uuid);
drop function if exists public.wh_scan_reject(uuid, text, text, text, text, uuid, integer, text);
drop function if exists public.wh_assert_store_order_open(uuid);
drop function if exists public.wh_refresh_dg(uuid);
drop function if exists public.wh_dg_kinds(uuid);
drop function if exists public.wh_user_can(uuid, text, text);
drop function if exists public.wh_weight_tolerance(integer, integer, numeric);
drop function if exists public.wh_settings_for(text);
drop function if exists public.wh_release_store_order_reserve(uuid, uuid, integer, text, text);
drop function if exists public.wh_post_order_movement(uuid, uuid, text, integer, text, text);

drop table if exists public.wh_override_attempts;
drop table if exists public.wh_supervisor_pins;
drop table if exists public.wh_pack_evidence;
drop table if exists public.wh_scan_log;
drop table if exists public.wh_pick_records;
drop table if exists public.wh_order_lines;
drop table if exists public.wh_orders;
drop table if exists public.wh_boxes;
drop table if exists public.wh_settings;
drop sequence if exists public.seq_wh_order;

-- the i1b order rule comes back; movements already posted for warehouse orders (no store order) are kept, so the rule is
-- restored NOT VALID only when such rows exist (append-only ledger)
alter table public.warehouse_stock_movements drop constraint if exists warehouse_stock_movements_order_req;
do $$
begin
  if exists (select 1 from public.warehouse_stock_movements where kind in ('reserve', 'release', 'pick') and store_order_id is null) then
    alter table public.warehouse_stock_movements add constraint warehouse_stock_movements_order_req check ((((kind = ANY (ARRAY['reserve'::text, 'release'::text, 'pick'::text])) AND (store_order_id IS NOT NULL)) OR (kind = ANY (ARRAY['inbound'::text, 'adjust_in'::text, 'adjust_out'::text])))) not valid;
  else
    alter table public.warehouse_stock_movements add constraint warehouse_stock_movements_order_req check ((((kind = ANY (ARRAY['reserve'::text, 'release'::text, 'pick'::text])) AND (store_order_id IS NOT NULL)) OR (kind = ANY (ARRAY['inbound'::text, 'adjust_in'::text, 'adjust_out'::text]))));
  end if;
end $$;
drop index if exists public.warehouse_stock_movements_wh_order_idx;
alter table public.warehouse_stock_movements drop column if exists wh_order_id;
