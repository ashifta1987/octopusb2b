-- Storefront shows a product only if its supplier's "listings live" switch is on (SPEC §5 Product listing).
create or replace function supplier_listings_live(p_supplier uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select listings_live from supplier_switches where supplier_id = p_supplier), true);
$$;
grant execute on function supplier_listings_live(uuid) to anon, authenticated;
drop policy if exists products_public on products;
create policy products_public on products for select using (status = 'live' and archived_at is null and supplier_listings_live(supplier_id));
