-- Down for 20261101000194_division_access_fixes.sql: back to the state after 193.
drop policy if exists dropship_variants_write on dropship_variants;
drop policy if exists dropship_variants_read on dropship_variants;
drop policy if exists dropship_rates_write on dropship_rates;
drop policy if exists dropship_rates_read on dropship_rates;
drop policy if exists dropship_products_write on dropship_products;
drop policy if exists dropship_products_read on dropship_products;
revoke all on dropship_products, dropship_variants, dropship_rates from authenticated;
drop function if exists dropship_can_edit(uuid);
revoke select (division_id) on shipments from authenticated;
revoke execute on function in_division(uuid, text[]) from anon;
