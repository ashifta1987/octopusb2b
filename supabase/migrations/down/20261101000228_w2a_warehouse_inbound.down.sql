-- DOWN for 20261101000228_w2a_warehouse_inbound.sql
-- Then: delete from _migrations where name = '20261101000228_w2a_warehouse_inbound.sql';
-- Restores record_warehouse_stock_movement() to its exact previous definition (pg_get_functiondef from staging) and the
-- 'SZ-01' handoff default. Client SKU item_master rows and stock movements already posted are data and stay.
-- tables first (their policies use wh_sees()), then sequences, then functions
drop table if exists public.wh_serials;
drop table if exists public.wh_lots;
drop table if exists public.wh_counts;
drop table if exists public.wh_dock_slots;
drop table if exists public.wh_asn_lines;
drop table if exists public.wh_asns;
drop table if exists public.wh_client_skus;
drop sequence if exists public.seq_wh_lot;
drop sequence if exists public.seq_wh_asn;
drop function if exists public.wh_counts_board(text);
drop function if exists public.wh_dock_board(text, date);
drop function if exists public.wh_asn_detail(text);
drop function if exists public.wh_list_asns(text);
drop function if exists public.wh_item_label(uuid);
drop function if exists public.wh_add_serials(uuid, text[]);
drop function if exists public.wh_approve_lot(uuid, integer, text);
drop function if exists public.wh_count_line(uuid, integer, integer, text, text[]);
drop function if exists public.wh_asn_check_received(uuid);
drop function if exists public.wh_cancel_slot(uuid, text);
drop function if exists public.wh_slot_advance(uuid, text);
drop function if exists public.wh_check_in(uuid);
drop function if exists public.wh_slot_set_asn(uuid, uuid);
drop function if exists public.wh_book_slot(text, text, date, time, time, uuid, text);
drop function if exists public.wh_cancel_asn(uuid, text);
drop function if exists public.wh_create_asn(uuid, text, date, integer, integer, jsonb, text, text);
drop function if exists public.wh_set_client_sku_status(uuid, text);
drop function if exists public.wh_save_client_sku(uuid, uuid, text, text, text, integer, boolean, boolean);
drop function if exists public.wh_can_any(text);
drop function if exists public.wh_is_client_member(uuid);
drop function if exists public.wh_sees(text);
drop function if exists public.wh_post_inbound(uuid, integer, text, text);
alter table public.dropship_handoffs alter column warehouse_id set default 'SZ-01'::text;
CREATE OR REPLACE FUNCTION public.record_warehouse_stock_movement(p_item_id uuid, p_kind text, p_qty integer, p_reason text, p_warehouse_id text DEFAULT 'SZ-01'::text, p_store_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh text := coalesce(nullif(btrim(p_warehouse_id), ''), 'SZ-01');
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
  elsif not public.warehouse_can_edit() then
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
