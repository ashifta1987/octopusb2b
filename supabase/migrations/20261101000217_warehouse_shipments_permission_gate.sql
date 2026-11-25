-- Tighten warehouse_shipments so division membership without orders:edit or warehouse:view
-- (e.g. qc_coordinator / sourcing_agent assigned to SRC) cannot read label_url or carrier_code.
create or replace view public.warehouse_shipments with (security_barrier = true) as
  select s.id, s.code, d.code as division, o.code as order_code, o.title as items, o.quantity,
         a.line1 as address_line1, a.line2 as address_line2, a.city, a.region, a.postal_code, a.country,
         s.carrier_code, s.tracking_no, s.label_url, s.status, s.weight_kg, s.parcels, s.eta, s.last_event_at, s.created_at
    from public.shipments s
    join public.divisions d on d.id = s.division_id
    join public.orders o on o.id = s.order_id
    left join lateral (
      select ad.line1, ad.line2, ad.city, ad.region, ad.postal_code, ad.country
        from public.addresses ad
       where ad.org_id = s.org_id
       order by ad.is_default desc, ad.created_at
       limit 1
    ) a on true
   where staff_aal_ok() and (
     is_admin()
     or can('warehouse', 'view')
     or (can('orders', 'edit') and in_division(s.division_id))
     or exists (
       select 1 from public.division_members m
        where m.user_id = auth.uid()
          and m.division_id = division_id_of('3PL')
          and m.role in ('warehouse', 'manager')
     )
   );
