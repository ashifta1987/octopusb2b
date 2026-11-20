-- Divisions step 3 follow-up (19 Nov 2026).
--  1. Fix (regression from 192): logged-out visitors could not read the public pools / turnkey pages, because the
--     public read policies call in_division() and anon could not execute it ("permission denied for function
--     in_division"). in_division() returns false when nobody is signed in, so anon may evaluate it.
--  2. Fix (regression from 190/192): tracking events failed for every signed-in user ("permission denied for table
--     shipments"): the policy reads shipments.division_id, but the column grants from 177 (white-label: customers never
--     see the carrier) predate that column. division_id is granted; carrier_code stays hidden.
--  3. Dropship catalogue tables (approved 19 Nov): Dropshipping staff read and edit, company-wide admins full access.
--     Customers have no direct access to these tables (no supplier cost / supplier / margin / contact columns reach
--     them); they keep reading the customer-safe fields through dropship_catalogue() / dropship_product_detail().
--     The public key (anon) gets nothing.
-- Down: supabase/migrations/down/20261101000194_division_access_fixes.down.sql

grant execute on function in_division(uuid, text[]) to anon;

grant select (division_id) on shipments to authenticated;

-- ───────── dropship catalogue ─────────
-- "edit" = Dropshipping managers/staff of the row's division, or a company-wide admin (finance/support read only)
create or replace function dropship_can_edit(p_division uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and staff_aal_ok() and (
    exists (select 1 from user_roles where user_id = auth.uid() and role_code = 'admin')
    or exists (select 1 from division_members m where m.user_id = auth.uid() and m.division_id = p_division and m.role in ('manager', 'staff')))
$$;
revoke all on function dropship_can_edit(uuid) from public, anon;
grant execute on function dropship_can_edit(uuid) to authenticated, service_role;

revoke all on dropship_products, dropship_variants, dropship_rates from anon;
grant select, insert, update, delete on dropship_products, dropship_variants, dropship_rates to authenticated;

drop policy if exists dropship_products_read on dropship_products;
create policy dropship_products_read on dropship_products for select to authenticated
  using (is_staff() and in_division(division_id));
drop policy if exists dropship_products_write on dropship_products;
create policy dropship_products_write on dropship_products for all to authenticated
  using (dropship_can_edit(division_id)) with check (dropship_can_edit(division_id));

drop policy if exists dropship_rates_read on dropship_rates;
create policy dropship_rates_read on dropship_rates for select to authenticated
  using (is_staff() and in_division(division_id));
drop policy if exists dropship_rates_write on dropship_rates;
create policy dropship_rates_write on dropship_rates for all to authenticated
  using (dropship_can_edit(division_id)) with check (dropship_can_edit(division_id));

-- variants take their division from the parent dropship product
drop policy if exists dropship_variants_read on dropship_variants;
create policy dropship_variants_read on dropship_variants for select to authenticated
  using (is_staff() and in_division((select d.division_id from dropship_products d where d.product_id = dropship_variants.product_id)));
drop policy if exists dropship_variants_write on dropship_variants;
create policy dropship_variants_write on dropship_variants for all to authenticated
  using (dropship_can_edit((select d.division_id from dropship_products d where d.product_id = dropship_variants.product_id)))
  with check (dropship_can_edit((select d.division_id from dropship_products d where d.product_id = dropship_variants.product_id)));
-- (parent lookup uses the existing index dropship_variants_product (product_id, sort) from 183)
