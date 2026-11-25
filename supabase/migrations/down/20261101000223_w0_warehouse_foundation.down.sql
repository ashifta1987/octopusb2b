-- DOWN for 20261101000223_w0_warehouse_foundation.sql
-- Then: delete from _migrations where name = '20261101000223_w0_warehouse_foundation.sql';
drop function if exists public.wh_dashboard(text);
drop function if exists public.wh_set_default(text);
drop function if exists public.wh_set_location_status(text, text, text);
drop function if exists public.wh_save_location(text, text, text, text, text, text, text, text, text);
drop function if exists public.wh_list_staff(text);
drop function if exists public.wh_restore_staff(uuid, text);
drop function if exists public.wh_suspend_staff(uuid, text, text);
drop function if exists public.wh_set_staff_role(uuid, text, text);
drop function if exists public.wh_add_staff(text, text, text);
drop function if exists public.wh_my_warehouses();
drop function if exists public.wh_can(text, text);
drop function if exists public.wh_role(text);
drop table if exists public.warehouse_staff;
drop table if exists public.wh_role_capabilities;

-- receive_sourcing_handoff_at_3pl back to 212 (default 'SZ-01')
drop function if exists public.receive_sourcing_handoff_at_3pl(uuid, text);
create or replace function public.receive_sourcing_handoff_at_3pl(
  p_handoff_id uuid,
  p_warehouse_id text default 'SZ-01'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ho public.dropship_handoffs;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (public.warehouse_can_edit() or (is_staff() and in_division(division_id_of('SRC')))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_ho from public.dropship_handoffs where id = p_handoff_id for update;
  if v_ho.id is null or v_ho.handoff_type <> 'sourcing_procurement' then
    raise exception 'NOT_FOUND';
  end if;

  update public.dropship_handoffs
     set warehouse_id = coalesce(nullif(btrim(p_warehouse_id), ''), 'SZ-01'),
         updated_at = now()
   where id = p_handoff_id;

  perform public.emit_dropship_domain_event(
    'sourcing_handoff.received_at_3pl',
    'dropship_handoff',
    v_ho.id,
    'handoff:' || v_ho.id::text || ':received_at_3pl',
    jsonb_build_object('handoff_id', v_ho.id, 'store_order_id', v_ho.store_order_id),
    division_id_of('3PL'),
    false
  );

  perform public.process_dropship_domain_events(25);
  perform write_audit('dropship.handoff_received_at_3pl', 'dropship_handoffs', v_ho.id::text, jsonb_build_object('store_order_id', v_ho.store_order_id));

  return jsonb_build_object('ok', true, 'handoff_id', v_ho.id);
end $$;

revoke all on function public.receive_sourcing_handoff_at_3pl(uuid, text) from public, anon;
grant execute on function public.receive_sourcing_handoff_at_3pl(uuid, text) to authenticated, service_role;

alter table public.dropship_handoffs drop constraint if exists dropship_handoffs_warehouse_fk;
alter table public.warehouse_stock_movements drop constraint if exists warehouse_stock_movements_warehouse_fk;
alter table public.warehouse_stock drop constraint if exists warehouse_stock_warehouse_fk;
alter table public.warehouse_stock_movements alter column warehouse_id set default 'SZ-01';
alter table public.warehouse_stock alter column warehouse_id set default 'SZ-01';
drop function if exists public.default_warehouse_code();
drop table if exists public.warehouses;
