-- Distributors see only their assigned suppliers' products and quotes (SPEC §3), but may see open RFQs
-- (city/country only — organizations stay hidden) to quote on behalf of their suppliers.
delete from role_permissions where role_code = 'distributor' and area in ('products','requests') and action = 'view';

-- Replay fix (7 Nov 2026): this helper was first created in migration 020, but the policy below already uses it.
-- Same definition as 020 (which replaces it again), so a fresh database (staging) can be built from the migrations.
create or replace function rfq_has_my_supplier_quote(p_rfq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from quotes q where q.rfq_id = p_rfq and is_my_supplier(q.supplier_id));
$$;

drop policy if exists rfq_read on rfqs;
create policy rfq_read on rfqs for select to authenticated using (
  org_id in (select my_org_ids()) or can('requests','view')
  or (has_role('distributor') and (status in ('submitted','assigned','quoting','quoted') or rfq_has_my_supplier_quote(id))));
