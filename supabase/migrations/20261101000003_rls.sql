-- Octopus B2B — Row Level Security (SPEC §6 key RLS policies, §12)
do $$ declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- public_suppliers view runs with owner rights but only exposes code/country/badge
grant select on public_suppliers to anon, authenticated;

-- ── Reference / public data ──
create policy roles_read on roles for select using (true);
create policy areas_read on permission_areas for select using (true);
create policy rp_read on role_permissions for select to authenticated using (true);
create policy rp_admin on role_permissions for all to authenticated using (can('staff','edit')) with check (can('staff','edit'));

create policy settings_public_read on site_settings for select using (is_public or is_staff());
create policy settings_admin_write on site_settings for all to authenticated using (is_admin()) with check (is_admin());

create policy company_read on company_profile for select using (true);
create policy company_write on company_profile for update to authenticated using (can('content','edit'));
create policy branches_read on branches for select using (active or is_staff());
create policy branches_write on branches for all to authenticated using (can('content','edit')) with check (can('content','edit'));
create policy blocks_read on content_blocks for select using (status = 'published' or is_staff());
create policy blocks_write on content_blocks for all to authenticated using (can('content','edit')) with check (can('content','edit'));
create policy pages_read on pages for select using (status = 'published' or can('content','view'));
create policy pages_write on pages for all to authenticated using (can('content','edit')) with check (can('content','edit'));
create policy cv_staff on content_versions for all to authenticated using (can('content','view')) with check (can('content','edit'));
create policy terms_read on terms_versions for select using (status in ('published','superseded') or can('content','view'));
create policy terms_write on terms_versions for all to authenticated using (can('content','edit')) with check (can('content','edit'));
create policy banners_read on banners for select using (active or is_staff());
create policy banners_write on banners for all to authenticated using (can('content','edit')) with check (can('content','edit'));
create policy email_tpl on email_templates for all to authenticated using (can('content','edit')) with check (can('content','edit'));

create policy services_read on services for select using (true);
create policy services_write on services for all to authenticated using (can('services','edit')) with check (can('services','edit'));
create policy sp_read on service_prices for select using (true);
create policy sp_write on service_prices for insert to authenticated with check (can('services','edit'));

create policy carriers_read on carriers for select using (true);
create policy placements_read on ad_placements for select using (true);
create policy placements_write on ad_placements for all to authenticated using (can('ads','edit')) with check (can('ads','edit'));
create policy sla_read on sla_policies for select using (true);
create policy macros_staff on support_macros for all to authenticated using (can('support','view')) with check (can('support','edit'));

-- ── Identity ──
create policy profiles_self on profiles for select to authenticated using (id = auth.uid() or can('customers','view') or can('staff','view'));
create policy profiles_self_upd on profiles for update to authenticated using (id = auth.uid() or can('staff','edit'));
create policy user_roles_read on user_roles for select to authenticated using (user_id = auth.uid() or can('staff','view'));
create policy user_roles_write on user_roles for all to authenticated using (can('staff','edit')) with check (can('staff','edit'));
create policy orgs_member on organizations for select to authenticated using (id in (select my_org_ids()) or can('customers','view'));
create policy orgs_member_upd on organizations for update to authenticated using (id in (select my_org_ids()) or can('customers','edit'));
create policy om_read on org_members for select to authenticated using (user_id = auth.uid() or org_id in (select my_org_ids()) or can('customers','view'));
create policy addr_org on addresses for all to authenticated using (org_id in (select my_org_ids()) or can('customers','view')) with check (org_id in (select my_org_ids()));
create policy kyc_org on kyc_submissions for select to authenticated using (org_id in (select my_org_ids()) or can('customers','view'));
create policy kycdoc_org on kyc_documents for select to authenticated using (org_id in (select my_org_ids()) or can('customers','view'));
create policy kycdoc_ins on kyc_documents for insert to authenticated with check (org_id in (select my_org_ids()));
create policy audit_read on audit_log for select to authenticated using (can('audit','view'));
create policy sh_read on status_history for select to authenticated using (is_staff());
create policy outbox_read on outbox_events for select to authenticated using (can('integrations','view'));
create policy jobs_read on job_runs for select to authenticated using (can('integrations','view'));
create policy notif_own on notifications for select to authenticated using (user_id = auth.uid() or org_id in (select my_org_ids()));
create policy notif_upd on notifications for update to authenticated using (user_id = auth.uid() or org_id in (select my_org_ids()));

-- ── Suppliers (never exposed to buyers/anon directly) ──
create policy suppliers_staff on suppliers for select to authenticated using (can('suppliers','view') or is_my_supplier(id));
create policy suppliers_write on suppliers for all to authenticated using (can('suppliers','edit')) with check (can('suppliers','edit'));
create policy switches_read on supplier_switches for select to authenticated using (can('suppliers','view') or is_my_supplier(supplier_id));
create policy switches_write on supplier_switches for update to authenticated using (can('suppliers','edit') or (has_role('distributor') and is_my_supplier(supplier_id)));
create policy ds_read on distributor_suppliers for select to authenticated using (distributor_id = auth.uid() or can('suppliers','view'));
create policy ds_write on distributor_suppliers for all to authenticated using (can('suppliers','edit')) with check (can('suppliers','edit'));
create policy sv_staff on supplier_verifications for all to authenticated using (can('suppliers','view') or is_my_supplier(supplier_id)) with check (can('suppliers','edit') or is_my_supplier(supplier_id));

-- ── Catalog ──
create policy cat_read on categories for select using (active or is_staff());
create policy cat_write on categories for all to authenticated using (can('catalog','edit')) with check (can('catalog','edit'));
create policy tags_read on tags for select using (true);
create policy tags_write on tags for all to authenticated using (can('catalog','edit')) with check (can('catalog','edit'));

create policy products_public on products for select using (status = 'live' and archived_at is null);
create policy products_staff on products for select to authenticated using (can('products','view') or is_my_supplier(supplier_id));
create policy products_ins on products for insert to authenticated with check (
  can('products','create') and (is_admin() or not has_role('distributor') or is_my_supplier(supplier_id))
  and coalesce((select product_upload from supplier_switches where supplier_id = products.supplier_id), true)
  and status in ('draft','submitted'));
create policy products_upd on products for update to authenticated using (
  (can('products','edit') and (is_admin() or can('products','approve') or is_my_supplier(supplier_id))) or is_my_supplier(supplier_id));

create or replace function product_visible(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from products where id = p and ((status = 'live' and archived_at is null) or can('products','view') or is_my_supplier(supplier_id)));
$$;
create or replace function product_editable(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from products where id = p and (can('products','edit') or is_my_supplier(supplier_id)));
$$;
create policy pt_read on product_tags for select using (product_visible(product_id));
create policy pt_write on product_tags for all to authenticated using (product_editable(product_id)) with check (product_editable(product_id));
create policy tiers_read on price_tiers for select using (product_visible(product_id));
create policy tiers_write on price_tiers for all to authenticated using (product_editable(product_id)) with check (product_editable(product_id));
create policy media_read on product_media for select using (product_visible(product_id));
create policy media_write on product_media for all to authenticated using (product_editable(product_id)) with check (product_editable(product_id));
create policy specs_read on product_specs for select using (product_visible(product_id));
create policy specs_write on product_specs for all to authenticated using (product_editable(product_id)) with check (product_editable(product_id));
create policy pc_read on product_certificates for select using (product_visible(product_id));
create policy pc_write on product_certificates for all to authenticated using (product_editable(product_id)) with check (product_editable(product_id));
create policy rec_read on recommendations for select using (true);
create policy costs_staff on product_costs for all to authenticated using (can('finance','view') or is_my_supplier((select supplier_id from products where id = product_id))) with check (product_editable(product_id));
create policy certs_read on certificates for select using (status in ('verified','expiring') or can('services_ops','view') or is_my_supplier(supplier_id));
create policy certs_write on certificates for all to authenticated using (can('services_ops','edit') or is_my_supplier(supplier_id)) with check (can('services_ops','edit') or is_my_supplier(supplier_id));
create policy ij_own on import_jobs for all to authenticated using (created_by = auth.uid() or can('products','view')) with check (created_by = auth.uid());
create policy ir_own on import_rows for all to authenticated using (exists(select 1 from import_jobs j where j.id = job_id and (j.created_by = auth.uid() or can('products','view'))))
  with check (exists(select 1 from import_jobs j where j.id = job_id and j.created_by = auth.uid()));
create policy ai_own on ai_jobs for all to authenticated using (created_by = auth.uid() or can('ai','view')) with check (created_by = auth.uid());
create policy src_conn on source_connections for all to authenticated using (can('integrations','view') or is_my_supplier(supplier_id)) with check (can('integrations','edit') or is_my_supplier(supplier_id));

-- ── Trade (customers: own org only; staff by permission) ──
create policy rfq_read on rfqs for select to authenticated using (org_id in (select my_org_ids()) or can('requests','view')
  or (has_role('distributor') and exists(select 1 from quotes q where q.rfq_id = rfqs.id and is_my_supplier(q.supplier_id))));
create policy rfq_staff_upd on rfqs for update to authenticated using (can('requests','edit'));
create policy quotes_read on quotes for select to authenticated using (
  exists(select 1 from rfqs r where r.id = rfq_id and r.org_id in (select my_org_ids())) or can('requests','view') or is_my_supplier(supplier_id));
create policy orders_read on orders for select to authenticated using (org_id in (select my_org_ids()) or can('orders','view') or is_my_supplier(supplier_id));
create policy oe_read on order_events for select to authenticated using (org_id in (select my_org_ids()) or can('orders','view'));
create policy pi_read on proforma_invoices for select to authenticated using (org_id in (select my_org_ids()) or can('orders','view'));
create policy docs_read on documents for select to authenticated using (org_id in (select my_org_ids()) or can('orders','view') or can('finance','view'));
create policy docs_upd on documents for update to authenticated using (org_id in (select my_org_ids()) or can('finance','edit'));
create policy sr_read on service_requests for select to authenticated using (org_id in (select my_org_ids()) or can('requests','view') or can('services_ops','view'));
create policy sr_staff on service_requests for update to authenticated using (can('requests','edit') or can('services_ops','edit'));

-- ── Money: read-only to clients, all writes via RPC ──
create policy la_read on ledger_accounts for select to authenticated using (org_id in (select my_org_ids()) or can('finance','view'));
create policy j_read on journals for select to authenticated using (can('finance','view') or exists(select 1 from ledger_entries e where e.journal_id = journals.id and e.org_id in (select my_org_ids())));
create policy le_read on ledger_entries for select to authenticated using (org_id in (select my_org_ids()) or can('finance','view'));
create policy pay_read on payments for select to authenticated using (org_id in (select my_org_ids()) or can('finance','view'));
create policy topup_read on wallet_topups for select to authenticated using (org_id in (select my_org_ids()) or can('wallet','view'));
create policy wd_read on wallet_withdrawals for select to authenticated using (org_id in (select my_org_ids()) or can('wallet','view'));
create policy fa_read on finance_approvals for select to authenticated using (can('finance','view') or requested_by = auth.uid());
create policy payouts_read on payouts for select to authenticated using (can('finance','view') or is_my_supplier(supplier_id));
create policy fx_read on fx_rates for select using (true);

-- ── Logistics ──
create policy ship_read on shipments for select to authenticated using (org_id in (select my_org_ids()) or can('orders','view'));
create policy ship_write on shipments for all to authenticated using (can('orders','edit')) with check (can('orders','edit'));
create policy te_read on tracking_events for select to authenticated using (org_id in (select my_org_ids()) or can('orders','view'));
create policy te_write on tracking_events for insert to authenticated with check (can('orders','edit'));

-- ── Integrations & API ──
create policy integ_read on integrations for select to authenticated using (can('integrations','view'));
create policy integ_write on integrations for update to authenticated using (can('integrations','edit'));
create policy ilog_read on integration_logs for select to authenticated using (can('integrations','view'));
create policy apic_org on api_clients for all to authenticated using (org_id in (select my_org_ids()) or can('integrations','view')) with check (org_id in (select my_org_ids()));
create policy apik_org on api_keys for select to authenticated using (org_id in (select my_org_ids()) or can('integrations','view'));
create policy apik_upd on api_keys for update to authenticated using (org_id in (select my_org_ids()));
create policy whe_org on webhook_endpoints for all to authenticated using (org_id in (select my_org_ids())) with check (org_id in (select my_org_ids()));
create policy whd_org on webhook_deliveries for select to authenticated using (org_id in (select my_org_ids()) or can('integrations','view'));

-- ── Support ──
create policy tk_read on tickets for select to authenticated using (org_id in (select my_org_ids()) or can('support','view'));
create policy tk_staff on tickets for update to authenticated using (can('support','edit') or (org_id in (select my_org_ids())));
create policy tm_read on ticket_messages for select to authenticated using ((org_id in (select my_org_ids()) and not internal) or can('support','view'));

-- ── Advertising ──
create policy ads_public on ad_campaigns for select using (status = 'active');
create policy ads_own on ad_campaigns for select to authenticated using (org_id in (select my_org_ids()) or can('ads','view'));
create policy ads_ins on ad_campaigns for insert to authenticated with check (org_id in (select my_org_ids()) and status in ('draft','in_review'));
create policy ads_upd on ad_campaigns for update to authenticated using (can('ads','edit') or (org_id in (select my_org_ids()) and status in ('draft','in_review','active','paused')));
create policy clicks_read on ad_clicks for select to authenticated using (can('ads','view') or exists(select 1 from ad_campaigns c where c.id = campaign_id and c.org_id in (select my_org_ids())));
create policy impr_read on ad_impressions for select to authenticated using (true);

-- Prevent customers from editing protected columns of their org (kyc_status)
create or replace function guard_org_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- kyc_status may change only via submit_kyc / review_kyc (security definer → current_user is the owner)
  if new.kyc_status is distinct from old.kyc_status and current_user not in ('postgres','supabase_admin','service_role') then
    raise exception 'FORBIDDEN_KYC_FIELD';
  end if;
  return new;
end $$;
create trigger trg_guard_org before update on organizations for each row execute function guard_org_update();

-- Realtime publications
do $$ begin
  begin
    alter publication supabase_realtime add table order_events, tracking_events, ticket_messages, notifications, quotes;
  exception when others then null;
  end;
end $$;

-- ── Storage buckets ──
insert into storage.buckets (id, name, public) values
  ('product-media','product-media', true),
  ('banners','banners', true),
  ('kyc','kyc', false),
  ('documents','documents', false),
  ('tickets','tickets', false),
  ('certificates','certificates', false)
on conflict (id) do nothing;

create policy "public media read" on storage.objects for select using (bucket_id in ('product-media','banners'));
create policy "staff media write" on storage.objects for insert to authenticated with check (bucket_id in ('product-media','banners') and (can('products','create') or can('content','edit')));
create policy "kyc upload own org" on storage.objects for insert to authenticated with check (bucket_id = 'kyc' and (storage.foldername(name))[1] = my_org_id()::text);
create policy "kyc read own org or staff" on storage.objects for select to authenticated using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = my_org_id()::text or can('customers','view')));
create policy "tickets upload own org" on storage.objects for insert to authenticated with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = my_org_id()::text);
create policy "tickets read" on storage.objects for select to authenticated using (bucket_id = 'tickets' and ((storage.foldername(name))[1] = my_org_id()::text or can('support','view')));
create policy "certs staff" on storage.objects for all to authenticated using (bucket_id = 'certificates' and (can('services_ops','view') or can('products','create'))) with check (bucket_id = 'certificates' and (can('services_ops','edit') or can('products','create')));
