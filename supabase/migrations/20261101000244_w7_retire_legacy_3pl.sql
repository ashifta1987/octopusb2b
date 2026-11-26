-- 20261101000244_w7_retire_legacy_3pl.sql
-- Warehouse OS W7 (owner, 26 Nov 2026: "for 3PL and logistics, remove the old data, follow the new").
--   1. Legacy location SZ-01 (status 'legacy', no bins, no staff) is retired: every unit on hand there (Octopus-owned, nothing
--      reserved) moves to the Foshan warehouse FS-01 through the stock ledger — one adjust_out at SZ-01 and one adjust_in at
--      FS-01 per item (wh_post_movement → record_warehouse_stock_movement, internal flag, reason 'legacy SZ-01 retired → FS-01')
--      — and one released, unplaced lot per item at FS-01 (owner NULL = Octopus stock) so Putaway can place it. SZ-01 → 'closed'.
--   2. The old 3PL request-form settings are deleted: '3pl.cutoff', '3pl.rates_text', 'warehouses' (+ the retired
--      'warehouse_os_ui' switch if a row exists). shipping.carrier_* stay (B2B shipments use them).
--   3. The two Dropship functions that still named 'SZ-01' use the default warehouse instead (FS-01):
--      process_dropship_domain_events (fast-ship stock check, reservation and pick/pack handoff on payment; sourcing-inbound
--      fallback) and get_dropship_variant_stock (default warehouse argument). Nothing else references SZ-01 (column
--      defaults already use default_warehouse_code()).
--   Not touched: paid 3PL service requests (SRV-1007, SRV-1015), B2B shipments, the movements ledger (append-only).
--   Everything changed is recorded in w7_legacy_stock_moves / w7_retire_backup for the down, which reverses it exactly
--   (opposite paired movements, lots removed only while untouched, settings rows and SZ-01 status restored, functions
--   restored byte-for-byte) and drops both tables → empty schema diff.
-- Down: supabase/migrations/down/20261101000244_w7_retire_legacy_3pl.down.sql

create table if not exists public.w7_legacy_stock_moves (
  item_id uuid primary key references public.item_master(id) on delete restrict,
  qty integer not null check (qty > 0),
  out_movement_id uuid not null,
  in_movement_id uuid not null,
  lot_id uuid references public.wh_lots(id) on delete set null, -- set null: the down removes the untouched lots it created
  moved_at timestamptz not null default now()
);
comment on table public.w7_legacy_stock_moves is 'Warehouse OS W7: stock moved from the retired legacy location SZ-01 to FS-01 (movements + lot per item), for the down.';
alter table public.w7_legacy_stock_moves enable row level security;
revoke all on public.w7_legacy_stock_moves from public, anon, authenticated;
grant all on public.w7_legacy_stock_moves to service_role;

create table if not exists public.w7_retire_backup (
  kind text not null check (kind in ('site_setting', 'warehouse_status')),
  ref text not null,
  data jsonb not null,
  removed_at timestamptz not null default now(),
  primary key (kind, ref)
);
comment on table public.w7_retire_backup is 'Warehouse OS W7: exact rows of the deleted 3PL settings and the previous SZ-01 status, for the down.';
alter table public.w7_retire_backup enable row level security;
revoke all on public.w7_retire_backup from public, anon, authenticated;
grant all on public.w7_retire_backup to service_role;

-- ───────── 1. SZ-01 stock → FS-01 (ledger-balanced: per item -q at SZ-01, +q at FS-01) ─────────
do $$
declare
  r record;
  v_out uuid;
  v_in uuid;
  v_lot public.wh_lots;
  v_reason constant text := 'legacy SZ-01 retired → FS-01';
begin
  if not exists (select 1 from public.warehouses where code = 'SZ-01') then
    return;  -- a database without the legacy location: nothing to retire
  end if;
  if not exists (select 1 from public.warehouses where code = 'FS-01' and status = 'active') then
    raise exception 'W7_TARGET_NOT_ACTIVE: FS-01 must be an active warehouse before SZ-01 is retired';
  end if;
  if exists (select 1 from public.warehouse_stock where warehouse_id = 'SZ-01' and reserved_qty <> 0) then
    raise exception 'W7_SZ01_RESERVED: SZ-01 still has reserved stock (open Dropship reservations); bring those orders into Warehouse OS first';
  end if;
  if exists (select 1 from public.wh_lots where warehouse_code = 'SZ-01') then
    raise exception 'W7_SZ01_HAS_LOTS: SZ-01 has Warehouse OS lots; move them with a transfer first';
  end if;
  for r in
    select s.item_id, s.on_hand_qty from public.warehouse_stock s
     where s.warehouse_id = 'SZ-01' and s.on_hand_qty > 0
       and not exists (select 1 from public.w7_legacy_stock_moves m where m.item_id = s.item_id)
     order by s.item_id
  loop
    v_out := public.wh_post_movement(r.item_id, 'adjust_out', r.on_hand_qty, v_reason, 'SZ-01');
    insert into public.wh_lots (warehouse_code, item_id, org_id, qty, status, created_by)
    values ('FS-01', r.item_id, null, r.on_hand_qty, 'released', null)
    returning * into v_lot;
    v_in := public.wh_post_movement(r.item_id, 'adjust_in', r.on_hand_qty, v_reason || ' · ' || v_lot.lot_code, 'FS-01');
    insert into public.w7_legacy_stock_moves (item_id, qty, out_movement_id, in_movement_id, lot_id)
    values (r.item_id, r.on_hand_qty, v_out, v_in, v_lot.id);
  end loop;

  insert into public.w7_retire_backup (kind, ref, data)
  select 'warehouse_status', w.code, jsonb_build_object('status', w.status, 'updated_at', w.updated_at)
    from public.warehouses w where w.code = 'SZ-01' and w.status <> 'closed'
  on conflict (kind, ref) do nothing;
  update public.warehouses set status = 'closed', updated_at = now() where code = 'SZ-01' and status <> 'closed';
end $$;

-- ───────── 2. Old 3PL request-form settings (exact rows kept for the down) ─────────
insert into public.w7_retire_backup (kind, ref, data)
select 'site_setting', s.key, to_jsonb(s) from public.site_settings s
 where s.key in ('3pl.cutoff', '3pl.rates_text', 'warehouses', 'warehouse_os_ui')
on conflict (kind, ref) do nothing;
delete from public.site_settings where key in ('3pl.cutoff', '3pl.rates_text', 'warehouses', 'warehouse_os_ui');

insert into public.audit_log (actor_id, action, entity, entity_id, details)
select null, 'warehouse.legacy_retired', 'warehouses', 'SZ-01',
       jsonb_build_object('items', (select count(*) from public.w7_legacy_stock_moves),
                          'units', (select coalesce(sum(qty), 0) from public.w7_legacy_stock_moves),
                          'to', 'FS-01',
                          'settings_removed', (select coalesce(jsonb_agg(ref order by ref), '[]'::jsonb) from public.w7_retire_backup where kind = 'site_setting'),
                          'reason', 'owner: remove the old 3PL data, follow Warehouse OS');

-- ───────── 3. Dropship functions: default warehouse instead of the hard-coded legacy SZ-01 ─────────
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
             where warehouse_id = public.default_warehouse_code() and item_id = v_it.item_id;
            v_avail := greatest(0, coalesce(v_ws.on_hand_qty, 0) - coalesce(v_ws.reserved_qty, 0));
            if v_avail < v_it.qty and not exists (
              select 1 from public.warehouse_stock_movements m
               where m.warehouse_id = public.default_warehouse_code() and m.item_id = v_it.item_id and m.store_order_id = v_so.id and m.kind = 'reserve'
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
                  v_it.item_id, 'reserve', v_it.qty, 'Store order ' || v_so.order_number || ' paid', public.default_warehouse_code(), v_so.id
                );
                insert into public.dropship_handoffs (
                  store_order_id, store_order_item_id, handoff_type, from_division_id, to_division_id, warehouse_id, status
                ) values (
                  v_so.id, v_it.id, 'warehouse_pick_pack', division_id_of('DS'), division_id_of('3PL'), public.default_warehouse_code(), 'reserved'
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
               where m.warehouse_id = coalesce(v_ho.warehouse_id, public.default_warehouse_code())
                 and m.item_id = v_it.item_id
                 and m.store_order_id = v_so.id
                 and m.kind = 'reserve'
            ) then
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'inbound', v_it.qty, 'Sourcing inbound for ' || v_so.order_number, coalesce(v_ho.warehouse_id, public.default_warehouse_code()), null
              );
              perform public.record_warehouse_stock_movement(
                v_it.item_id, 'reserve', v_it.qty, 'Reserve inbound stock for ' || v_so.order_number, coalesce(v_ho.warehouse_id, public.default_warehouse_code()), v_so.id
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
            v_so.id, v_ho.store_order_item_id, 'warehouse_pick_pack', division_id_of('DS'), division_id_of('3PL'), coalesce(v_ho.warehouse_id, public.default_warehouse_code()), 'ready_to_pick'
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

CREATE OR REPLACE FUNCTION public.get_dropship_variant_stock(p_variant_id uuid, p_warehouse_id text DEFAULT public.default_warehouse_code())
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
     where warehouse_id = coalesce(nullif(btrim(p_warehouse_id), ''), public.default_warehouse_code())
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
