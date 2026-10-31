-- Distributors see only their assigned suppliers' products and quotes (SPEC §3), but may see open RFQs
-- (city/country only — organizations stay hidden) to quote on behalf of their suppliers.
delete from role_permissions where role_code = 'distributor' and area in ('products','requests') and action = 'view';

drop policy if exists rfq_read on rfqs;
create policy rfq_read on rfqs for select to authenticated using (
  org_id in (select my_org_ids()) or can('requests','view')
  or (has_role('distributor') and (status in ('submitted','assigned','quoting','quoted') or rfq_has_my_supplier_quote(id))));
