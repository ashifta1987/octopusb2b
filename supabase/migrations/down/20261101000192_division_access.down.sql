-- DOWN for 20261101000192_division_access.sql — restores every policy exactly as it was before (captured from staging
-- on 19 Nov 2026), the original request_visible / admin_brand_projects / brand_project_history, and removes the helper,
-- the write guard and the warehouse view. Then: delete from _migrations where name = '20261101000192_division_access.sql';
drop function if exists warehouse_update_shipment(uuid, shipment_status, text, text, numeric, int);
drop view if exists warehouse_shipments;
do $$ declare t text;
begin
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'documents', 'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds'] loop
    execute format('drop trigger if exists trg_zz_division_guard on %I', t);
  end loop;
end $$;
drop function if exists division_write_guard();

alter policy "audit_read" on audit_log using (can('audit'::text, 'view'::text));
alter policy "brand_projects_read" on brand_projects using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR staff_sees_org(org_id)));
alter policy "cs_read" on company_services using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR staff_sees_org(org_id)));
alter policy "am_read" on documents using (is_my_customer(org_id));
alter policy "docs_read" on documents using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('orders'::text, 'view'::text) OR can('finance'::text, 'view'::text)));
alter policy "docs_supplier" on documents using (((supplier_id IS NOT NULL) AND (org_id IS NULL) AND is_my_supplier(supplier_id)));
alter policy "docs_upd" on documents using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('finance'::text, 'edit'::text)));
alter policy "il_read" on invoice_lines using ((EXISTS ( SELECT 1
   FROM documents d
  WHERE ((d.id = invoice_lines.document_id) AND ((d.org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('finance'::text, 'view'::text) OR is_my_customer(d.org_id))))));
alter policy "j_read" on journals using ((can('finance'::text, 'view'::text) OR (EXISTS ( SELECT 1
   FROM ledger_entries e
  WHERE ((e.journal_id = journals.id) AND (e.org_id IN ( SELECT my_org_ids() AS my_org_ids)))))));
alter policy "le_read" on ledger_entries using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('finance'::text, 'view'::text)));
alter policy "oe_read" on order_events using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('orders'::text, 'view'::text)));
alter policy "am_read" on orders using (is_my_customer(org_id));
alter policy "orders_assistant_read" on orders using (assistant_staff_can(org_id));
alter policy "orders_read" on orders using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('orders'::text, 'view'::text) OR is_my_supplier(supplier_id)));
alter policy "pay_read" on payments using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('finance'::text, 'view'::text)));
alter policy "pledges_own" on pool_pledges using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('orders'::text, 'view'::text)));
alter policy "pools_public" on pools using (((status = ANY (ARRAY['open'::pool_status, 'locked'::pool_status, 'confirmed'::pool_status, 'shipped'::pool_status, 'completed'::pool_status])) OR can('orders'::text, 'view'::text) OR (starter_org_id IN ( SELECT my_org_ids() AS my_org_ids))));
alter policy "pi_read" on proforma_invoices using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('orders'::text, 'view'::text)));
alter policy "quotes_assistant_read" on quotes using ((EXISTS ( SELECT 1
   FROM rfqs r
  WHERE ((r.id = quotes.rfq_id) AND assistant_staff_can(r.org_id)))));
alter policy "quotes_read" on quotes using ((rfq_in_my_org(rfq_id) OR can('requests'::text, 'view'::text) OR is_my_supplier(supplier_id)));
alter policy "am_read" on rfqs using (is_my_customer(org_id));
alter policy "rfq_assistant_read" on rfqs using (assistant_staff_can(org_id));
alter policy "rfq_read" on rfqs using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('requests'::text, 'view'::text) OR (has_role('distributor'::text) AND rfq_has_my_supplier_quote(id))));
alter policy "rfq_staff_upd" on rfqs using (can('requests'::text, 'edit'::text));
alter policy "am_read" on service_requests using (is_my_customer(org_id));
alter policy "sr_read" on service_requests using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('requests'::text, 'view'::text) OR can('services_ops'::text, 'view'::text)));
alter policy "sr_staff" on service_requests using ((can('requests'::text, 'edit'::text) OR can('services_ops'::text, 'edit'::text)));
alter policy "am_read" on shipments using (is_my_customer(org_id));
alter policy "ship_assistant_read" on shipments using (assistant_staff_can(org_id));
alter policy "ship_read" on shipments using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('orders'::text, 'view'::text)));
alter policy "ship_write" on shipments using (can('orders'::text, 'edit'::text));
alter policy "ship_write" on shipments with check (can('orders'::text, 'edit'::text));
alter policy "te_assistant_read" on tracking_events using (assistant_staff_can(org_id));
alter policy "te_read" on tracking_events using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('orders'::text, 'view'::text)));
alter policy "te_write" on tracking_events with check (can('orders'::text, 'edit'::text));
alter policy "turnkey_signals_staff" on turnkey_atlas_signals using (can('turnkey'::text, 'view'::text));
alter policy "turnkey_leads_edit" on turnkey_leads using (can('turnkey'::text, 'edit'::text));
alter policy "turnkey_leads_edit" on turnkey_leads with check (can('turnkey'::text, 'edit'::text));
alter policy "turnkey_leads_own" on turnkey_leads using ((buyer_user_id = ( SELECT auth.uid() AS uid)));
alter policy "turnkey_leads_staff" on turnkey_leads using ((can('turnkey'::text, 'view'::text) OR can('requests'::text, 'view'::text)));
alter policy "turnkey_packages_read" on turnkey_packages using (((is_active AND (EXISTS ( SELECT 1
   FROM turnkey_projects p
  WHERE ((p.project_id = turnkey_packages.project_id) AND (p.status <> 'archived'::text))))) OR can('turnkey'::text, 'view'::text)));
alter policy "turnkey_packages_write" on turnkey_packages using (can('turnkey'::text, 'edit'::text));
alter policy "turnkey_packages_write" on turnkey_packages with check (can('turnkey'::text, 'edit'::text));
alter policy "turnkey_sources_read" on turnkey_project_sources using (true);
alter policy "turnkey_sources_write" on turnkey_project_sources using (can('turnkey'::text, 'edit'::text));
alter policy "turnkey_sources_write" on turnkey_project_sources with check (can('turnkey'::text, 'edit'::text));
alter policy "turnkey_projects_read" on turnkey_projects using (((status <> 'archived'::text) OR can('turnkey'::text, 'view'::text)));
alter policy "turnkey_projects_write" on turnkey_projects using (can('turnkey'::text, 'edit'::text));
alter policy "turnkey_projects_write" on turnkey_projects with check (can('turnkey'::text, 'edit'::text));
alter policy "wh_read" on wallet_holds using (((org_id IN ( SELECT my_org_ids() AS my_org_ids)) OR can('wallet'::text, 'view'::text) OR is_my_customer(org_id)));

create or replace function request_visible(p_kind text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'rfq' then exists (select 1 from rfqs where id = p_id and (org_id in (select my_org_ids()) or can('requests', 'view')))
    when 'service' then exists (select 1 from service_requests where id = p_id and (org_id in (select my_org_ids()) or can('requests', 'view') or can('services_ops', 'view')))
    else false end;
$$;

create or replace function admin_brand_projects(p_id uuid default null, p_status text default null)
returns table (id uuid, ref text, status text, closed_from text, created_at timestamptz, status_changed_at timestamptz,
               org_id uuid, company text, product_id uuid, product_title text, product_slug text, product_link text,
               quantity int, markets text[], method text, packaging text, colours text, logo_paths text[],
               stock_destination text, bulk_country text, stores text[], note text,
               manager_id uuid, manager_name text, paid boolean)
language sql stable security definer set search_path = public as $$
  select b.id, b.ref, b.status, b.closed_from, b.created_at, b.status_changed_at,
         b.org_id, o.name, b.product_id, pr.title, pr.slug, b.product_link,
         b.quantity, b.markets, b.method, b.packaging, b.colours, b.logo_paths,
         b.stock_destination, b.bulk_country, b.stores, b.note,
         am.staff_user_id, coalesce(nullif(mp.full_name, ''), mp.email), brand_project_paid(b.id)
    from brand_projects b
    join organizations o on o.id = b.org_id
    left join products pr on pr.id = b.product_id
    left join account_managers am on am.org_id = b.org_id and am.is_primary
    left join profiles mp on mp.id = am.staff_user_id
   where is_staff() and staff_sees_org(b.org_id)
     and (p_id is null or b.id = p_id)
     and (p_status is null or b.status = p_status)
   order by b.created_at desc;
$$;

create or replace function brand_project_history(p_id uuid)
returns table (at timestamptz, actor text, from_status text, to_status text, reason text)
language sql stable security definer set search_path = public as $$
  select a.created_at, coalesce(nullif(p.full_name, ''), p.email, 'System'), a.before->>'status', a.after->>'status', a.after->>'reason'
    from brand_projects b
    join audit_log a on a.entity = 'brand_project' and a.entity_id = b.ref and a.action in ('brand_project.created', 'brand_project.status_changed')
    left join profiles p on p.id = a.actor_id
   where b.id = p_id and is_staff() and staff_sees_org(b.org_id)
   order by a.created_at desc;
$$;

drop function if exists in_division(uuid, text[]);
drop index if exists order_events_order_idx, tracking_events_shipment_idx, invoice_lines_document_idx, request_messages_rfq_idx, request_messages_sr_idx,
  request_files_rfq_idx, request_files_sr_idx, pool_events_pool_idx, turnkey_packages_project_idx, turnkey_project_sources_project_idx,
  turnkey_atlas_signals_project_idx, division_members_user_idx;
