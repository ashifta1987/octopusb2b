-- DOWN for 20261101000244_w7_retire_legacy_3pl.sql — reverses every data change and restores both functions exactly.
-- Then: delete from _migrations where name = '20261101000244_w7_retire_legacy_3pl.sql';
-- The ledger is append-only: the move is undone by the opposite paired movements (never by deleting rows). The FS-01 lots
-- created by the up are removed only while untouched (still the original quantity, released, never placed, picked,
-- transferred, counted or used); otherwise the down stops with a clear error and nothing is changed.

-- ───────── 3. Functions back to the exact previous definitions ─────────
CREATE OR REPLACE FUNCTION public.process_dropship_domain_events(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ev public.domain_events;
  v_processed integer := 0;
  v_retried integer := 0;
  v_dead integer := 0;
  v_so public.store_orders;
  v_it record;
  v_ws public.warehouse_stock;
  v_avail integer;
  v_shortage boolean;
  v_has_sourcing boolean;
  v_map jsonb;
  v_ship public.shipments;
  v_ho public.dropship_handoffs;
  v_deliv_at timestamptz;
  v_next_attempt integer;
  v_backoff interval;
  v_prev_role text;
begin
  v_prev_role := coalesce(current_setting('request.jwt.claims', true), '');

  for ev in
    select *
      from public.domain_events
     where db_status in ('pending', 'retry')
       and available_at <= now()
     order by created_at asc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked
  loop
    begin
      if exists (
        select 1 from public.domain_event_consumptions c where c.event_id = ev.id and c.consumer = 'db_core'
      ) then
        update public.domain_events
           set db_status = 'processed',
               processed_at = coalesce(processed_at, now())
         where id = ev.id;
        v_processed := v_processed + 1;
        continue;
      end if;

      perform set_config('request.jwt.claims', '', true);

      if ev.event_type = 'domain_event.test_poison' then
        raise exception 'SIMULATED_OUTBOX_FAILURE: %', coalesce(ev.payload ->> 'reason', 'poison event');

      elsif ev.event_type = 'store_order.paid' then
        select * into v_so from public.store_orders where id = ev.aggregate_id for update;
        if v_so.id is not null and v_so.cancelled_at is null then
          -- First check if any fast_ship line has insufficient 3PL stock (Review 4: on_hold + hold_reason='stock_shortage', no error)
          v_shortage := false;
          for v_it in
            select soi.*
              from public.store_order_items soi
             where soi.store_order_id = v_so.id
               and soi.fulfilment_type = 'fast_ship'
          loop
            select * into v_ws
              from public.warehouse_stock
             where warehouse_id = 'SZ-01' and item_id = v_it.item_id;
            v_avail := greatest(0, coalesce(v_ws.on_hand_qty, 0) - coalesce(v_ws.reserved_qty, 0));
            if v_avail < v_it.qty and not exists (
              select 1 from public.warehouse_stock_movements m
               where m.warehouse_id = 'SZ-01' and m.item_id = v_it.item_id and m.store_order_id = v_so.id and m.kind = 'reserve'
            ) then
              v_shortage := true;
              exit;
            end if;
          end loop;

          if v_shortage then
            v_map := public.resolve_dropship_status_mapping('3pl_stock', 'shortage');
            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   hold_reason = 'stock_shortage',
                   updated_at = now()
             where id = v_so.id;
          else
            v_has_sourcing := false;
            for v_it in
              select soi.*, dv.supplier_product_id
                from public.store_order_items soi
                join public.dropship_variants dv on dv.id = soi.variant_id
               where soi.store_order_id = v_so.id
               order by soi.created_at asc, soi.id asc
            loop
              if v_it.fulfilment_type = 'fast_ship' then
                perform public.record_warehouse_stock_movement(
                  v_it.item_id, 'reserve', v_it.qty, 'Store order ' || v_so.order_number || ' paid', 'SZ-01', v_so.id
                );
                insert into public.dropship_handoffs (
                  store_order_id, store_order_item_id, handoff_type, from_division_id, to_division_id, warehouse_id, status
                ) values (
                  v_so.id, v_it.id, 'warehouse_pick_pack', division_id_of('DS'), division_id_of('3PL'), 'SZ-01', 'reserved'
                )
                on conflict do nothing;
              else
                v_has_sourcing := true;
                insert into public.dropship_handoffs (
                  store_order_id, store_order_item_id, handoff_type, from_division_id, to_division_id, supplier_product_id, status
                ) values (
                  v_so.id, v_it.id, 'sourcing_procurement', division_id_of('DS'), division_id_of('SRC'), v_it.supplier_product_id, 'ordered_from_supplier'
                )
                on conflict do nothing;
              end if;
            end loop;

            if v_has_sourcing then
              v_map := public.resolve_dropship_status_mapping('division_handoff', 'ordered_from_supplier');
            else
              v_map := public.resolve_dropship_status_mapping('division_handoff', 'reserved');
            end if;

            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   hold_reason = null,
                   updated_at = now()
             where id = v_so.id;
          end if;
        end if;

      elsif ev.event_type = 'store_order.cancelled' then
        select * into v_so from public.store_orders where id = ev.aggregate_id for update;
        if v_so.id is not null then
          for v_it in
            select m.warehouse_id, m.item_id, m.qty
              from public.warehouse_stock_movements m
             where m.store_order_id = v_so.id
               and m.kind = 'reserve'
               and not exists (
                 select 1 from public.warehouse_stock_movements m2
                  where m2.warehouse_id = m.warehouse_id
                    and m2.item_id = m.item_id
                    and m2.store_order_id = v_so.id
                    and m2.kind in ('release', 'pick')
               )
          loop
            perform public.record_warehouse_stock_movement(
              v_it.item_id, 'release', v_it.qty, 'Store order ' || v_so.order_number || ' cancelled', v_it.warehouse_id, v_so.id
            );
          end loop;

          update public.dropship_handoffs
             set status = 'cancelled',
                 updated_at = now()
           where store_order_id = v_so.id
             and status not in ('shipped', 'cancelled');

          v_map := public.resolve_dropship_status_mapping('3pl_stock', 'released');
          update public.store_orders
             set staff_stage = v_map ->> 'staff_stage',
                 merchant_status = v_map ->> 'merchant_status',
                 cancelled_at = coalesce(cancelled_at, now()),
                 updated_at = now()
           where id = v_so.id;
        end if;

      elsif ev.event_type = 'shipment.status_changed' then
        select * into v_ship from public.shipments where id = ev.aggregate_id;
        if v_ship.id is not null and v_ship.store_order_id is not null then
          select * into v_so from public.store_orders where id = v_ship.store_order_id for update;
          v_map := public.resolve_dropship_status_mapping('3pl_shipment', coalesce(ev.payload ->> 'status', v_ship.status::text));

          -- Physical pick stock movement runs when parcel is packed/label_ready or handed over (idempotent per order+item)
          if coalesce(ev.payload ->> 'status', v_ship.status::text) in ('label_ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered') then
            for v_it in
              select m.warehouse_id, m.item_id, m.qty
                from public.warehouse_stock_movements m
               where m.store_order_id = v_so.id
                 and m.kind = 'reserve'
                 and not exists (
                   select 1 from public.warehouse_stock_movements m2
                    where m2.warehouse_id = m.warehouse_id
                      and m2.item_id = m.item_id
                      and m2.store_order_id = v_so.id
                      and m2.kind in ('release', 'pick')
                 )
            loop
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'pick', v_it.qty, 'Shipment ' || v_ship.code || ' packed', v_it.warehouse_id, v_so.id
              );
            end loop;

            update public.dropship_handoffs
               set status = case
                     when coalesce(ev.payload ->> 'status', v_ship.status::text) in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') then 'shipped'
                     else 'packed'
                   end,
                   updated_at = now()
             where store_order_id = v_so.id
               and handoff_type = 'warehouse_pick_pack';
          end if;

          if v_map is not null then
            v_deliv_at := case
              when (v_map ->> 'triggers_escrow_clock')::boolean then coalesce(v_so.delivered_at, now())
              else v_so.delivered_at
            end;

            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   delivered_at = v_deliv_at,
                   updated_at = now()
             where id = v_so.id;

            -- Review 5: Finance owns the escrow release date on escrow_holds.auto_release_at (no second copy on store_orders)
            if (v_map ->> 'triggers_escrow_clock')::boolean then
              update public.escrow_holds
                 set delivered_at = coalesce(delivered_at, v_deliv_at),
                     auto_release_at = coalesce(auto_release_at, v_deliv_at + make_interval(days => auto_release_days))
               where (id = v_so.escrow_hold_id or (target_type = 'dropship_order' and target_id = v_so.id))
                 and status = 'held';
            end if;
          end if;
        end if;

      elsif ev.event_type = 'sourcing_handoff.received_at_3pl' then
        select * into v_ho from public.dropship_handoffs where id = ev.aggregate_id for update;
        if v_ho.id is not null then
          select * into v_so from public.store_orders where id = v_ho.store_order_id for update;
          if v_ho.store_order_item_id is not null then
            select item_id, qty into v_it from public.store_order_items where id = v_ho.store_order_item_id;
            if v_it.item_id is not null and not exists (
              select 1 from public.warehouse_stock_movements m
               where m.warehouse_id = coalesce(v_ho.warehouse_id, 'SZ-01')
                 and m.item_id = v_it.item_id
                 and m.store_order_id = v_so.id
                 and m.kind = 'reserve'
            ) then
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'inbound', v_it.qty, 'Sourcing inbound for ' || v_so.order_number, coalesce(v_ho.warehouse_id, 'SZ-01'), null
              );
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'reserve', v_it.qty, 'Reserve inbound stock for ' || v_so.order_number, coalesce(v_ho.warehouse_id, 'SZ-01'), v_so.id
              );
            end if;
          end if;

          update public.dropship_handoffs
             set status = 'received_at_3pl',
                 updated_at = now()
           where id = v_ho.id;

          insert into public.dropship_handoffs (
            store_order_id, store_order_item_id, handoff_type, from_division_id, to_division_id, warehouse_id, status
          ) values (
            v_so.id, v_ho.store_order_item_id, 'warehouse_pick_pack', division_id_of('DS'), division_id_of('3PL'), coalesce(v_ho.warehouse_id, 'SZ-01'), 'ready_to_pick'
          )
          on conflict do nothing;

          if not exists (
            select 1 from public.dropship_handoffs h2
             where h2.store_order_id = v_so.id
               and h2.handoff_type = 'sourcing_procurement'
               and h2.status <> 'received_at_3pl'
          ) then
            v_map := public.resolve_dropship_status_mapping('sourcing_po', 'received_at_3pl');
            update public.store_orders
               set staff_stage = v_map ->> 'staff_stage',
                   merchant_status = v_map ->> 'merchant_status',
                   updated_at = now()
             where id = v_so.id;
          end if;
        end if;
      end if;

      insert into public.domain_event_consumptions (event_id, consumer, outcome)
      values (ev.id, 'db_core', 'ok')
      on conflict (event_id, consumer) do nothing;

      update public.domain_events
         set db_status = 'processed',
             processed_at = now(),
             last_error = null
       where id = ev.id;

      v_processed := v_processed + 1;
      perform set_config('request.jwt.claims', v_prev_role, true);
    exception when others then
      perform set_config('request.jwt.claims', v_prev_role, true);
      v_next_attempt := ev.attempts + 1;
      if v_next_attempt >= 5 then
        update public.domain_events
           set db_status = 'dead',
               attempts = v_next_attempt,
               last_error = left(sqlerrm, 1000)
         where id = ev.id;
        perform write_audit(
          'domain_event.dead_letter',
          'domain_events',
          ev.id::text,
          jsonb_build_object('event_type', ev.event_type, 'attempts', v_next_attempt, 'error', left(sqlerrm, 300))
        );
        v_dead := v_dead + 1;
      else
        v_backoff := case v_next_attempt
          when 1 then interval '1 minute'
          when 2 then interval '5 minutes'
          when 3 then interval '30 minutes'
          else interval '2 hours'
        end;
        update public.domain_events
           set db_status = 'retry',
               attempts = v_next_attempt,
               available_at = now() + v_backoff,
               last_error = left(sqlerrm, 1000)
         where id = ev.id;
        v_retried := v_retried + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('processed', v_processed, 'retried', v_retried, 'dead', v_dead);
end $function$;

CREATE OR REPLACE FUNCTION public.get_dropship_variant_stock(p_variant_id uuid, p_warehouse_id text DEFAULT 'SZ-01'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_ws public.warehouse_stock;
  v_sp public.supplier_products;
  v_avail integer;
  v_status text;
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (auth.uid() is not null and is_staff() and not distributor_restricted());
begin
  select * into v_var from public.dropship_variants where id = p_variant_id;
  if v_var.id is null then
    return null;
  end if;
  select * into v_prod from public.dropship_products where id = v_var.product_id;

  if v_prod.fulfilment_type = 'fast_ship' then
    select * into v_ws
      from public.warehouse_stock
     where warehouse_id = coalesce(nullif(btrim(p_warehouse_id), ''), 'SZ-01')
       and item_id = v_var.item_id;
    v_avail := greatest(0, coalesce(v_ws.on_hand_qty, 0) - coalesce(v_ws.reserved_qty, 0));
    v_status := case
      when v_avail <= 0 then 'out'
      when v_avail <= 10 then 'low'
      else 'in_stock'
    end;
    if v_is_staff then
      return jsonb_build_object(
        'fulfilment_type', 'fast_ship',
        'stock_tracked', true,
        'stock_status', v_status,
        'available_qty', v_avail,
        'on_hand_qty', coalesce(v_ws.on_hand_qty, 0),
        'reserved_qty', coalesce(v_ws.reserved_qty, 0)
      );
    end if;
    return jsonb_build_object(
      'fulfilment_type', 'fast_ship',
      'stock_tracked', true,
      'stock_status', v_status
    );
  else
    if v_var.supplier_product_id is not null then
      select * into v_sp from public.supplier_products where id = v_var.supplier_product_id;
    end if;
    if v_sp.id is null or v_sp.stock_qty is null then
      -- Item 15: NULL = supplier stock not tracked (NOT 0!)
      v_status := 'in_stock';
      if v_is_staff then
        return jsonb_build_object(
          'fulfilment_type', 'extended_catalog',
          'stock_tracked', false,
          'stock_status', v_status,
          'stock_qty', null,
          'stock_updated_at', v_sp.stock_updated_at
        );
      end if;
      return jsonb_build_object(
        'fulfilment_type', 'extended_catalog',
        'stock_tracked', false,
        'stock_status', v_status
      );
    else
      v_status := case
        when v_sp.stock_qty <= 0 then 'out'
        when v_sp.stock_qty <= 10 then 'low'
        else 'in_stock'
      end;
      if v_is_staff then
        return jsonb_build_object(
          'fulfilment_type', 'extended_catalog',
          'stock_tracked', true,
          'stock_status', v_status,
          'stock_qty', v_sp.stock_qty,
          'stock_updated_at', v_sp.stock_updated_at
        );
      end if;
      return jsonb_build_object(
        'fulfilment_type', 'extended_catalog',
        'stock_tracked', true,
        'stock_status', v_status
      );
    end if;
  end if;
end $function$;

do $$
declare
  r record;
  v_reason constant text := 'W7 down: back to legacy SZ-01';
  v_avail integer;
begin
  if to_regclass('public.w7_legacy_stock_moves') is null then return; end if;
  -- refuse if any lot was touched
  for r in select m.*, l.qty lot_qty, l.status lot_status, l.warehouse_code lot_wh, l.lot_code
             from public.w7_legacy_stock_moves m join public.wh_lots l on l.id = m.lot_id order by m.item_id loop
    if r.lot_qty <> r.qty or r.lot_status <> 'released' or r.lot_wh <> 'FS-01'
       or exists (select 1 from public.wh_bin_stock b where b.lot_id = r.lot_id)
       or exists (select 1 from public.wh_location_moves x where x.lot_id = r.lot_id)
       or exists (select 1 from public.wh_pick_records x where x.lot_id = r.lot_id)
       or exists (select 1 from public.wh_transfer_picks x where x.lot_id = r.lot_id)
       or exists (select 1 from public.wh_transfer_lines x where x.dest_lot_id = r.lot_id)
       or exists (select 1 from public.wh_serials x where x.lot_id = r.lot_id)
       or exists (select 1 from public.wh_exceptions x where x.lot_id = r.lot_id)
       or exists (select 1 from public.wh_return_lines x where x.lot_id = r.lot_id) then
      raise exception 'W7_DOWN_LOT_IN_USE: lot % (moved from SZ-01) has been placed, picked, moved or changed in Warehouse OS; the W7 down cannot put the stock back', r.lot_code;
    end if;
    v_avail := null;
    select coalesce(on_hand_qty - reserved_qty, 0) into v_avail from public.warehouse_stock where warehouse_id = 'FS-01' and item_id = r.item_id;
    if coalesce(v_avail, 0) < r.qty then
      raise exception 'W7_DOWN_STOCK_USED: only % of % unit(s) of item % are still available at FS-01', coalesce(v_avail, 0), r.qty, r.item_id;
    end if;
  end loop;
  -- paired opposite movements (FS-01 out, SZ-01 in), then the untouched lots go
  for r in select * from public.w7_legacy_stock_moves order by item_id loop
    perform public.wh_post_movement(r.item_id, 'adjust_out', r.qty, v_reason, 'FS-01');
    perform public.wh_post_movement(r.item_id, 'adjust_in', r.qty, v_reason, 'SZ-01');
    delete from public.wh_lots where id = r.lot_id;
  end loop;
end $$;

-- ───────── 2. Settings rows back exactly ─────────
do $$
begin
  if to_regclass('public.w7_retire_backup') is null then return; end if;
  insert into public.site_settings (key, value, description, is_public, updated_at, updated_by)
  select (b.data ->> 'key'), (b.data -> 'value'), (b.data ->> 'description'), (b.data ->> 'is_public')::boolean,
         (b.data ->> 'updated_at')::timestamptz, nullif(b.data ->> 'updated_by', '')::uuid
    from public.w7_retire_backup b where b.kind = 'site_setting'
  on conflict (key) do update set value = excluded.value, description = excluded.description, is_public = excluded.is_public,
                                  updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  -- ───────── 1b. SZ-01 status back ─────────
  update public.warehouses w set status = (b.data ->> 'status'), updated_at = (b.data ->> 'updated_at')::timestamptz
    from public.w7_retire_backup b where b.kind = 'warehouse_status' and b.ref = w.code;
end $$;

insert into public.audit_log (actor_id, action, entity, entity_id, details)
select null, 'warehouse.legacy_retire_reverted', 'warehouses', 'SZ-01', jsonb_build_object('migration', 'w7_retire_legacy_3pl')
 where to_regclass('public.w7_legacy_stock_moves') is not null;

drop table if exists public.w7_legacy_stock_moves;
drop table if exists public.w7_retire_backup;
