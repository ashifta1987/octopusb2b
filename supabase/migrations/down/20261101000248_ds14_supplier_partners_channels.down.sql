-- Down for Dropship Release 6 · Step 14. Nothing installed was replaced except the CHECK constraint on dropship_order_events.kind,
-- which goes back to its installed list. Everything else here is new and is dropped (data in the new tables goes with them).
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-partner-commission') then
      perform cron.unschedule('octopus-dropship-partner-commission');
    end if;
  end if;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
    'ds_sup_home', 'ds_sup_products', 'ds_sup_stock_update', 'ds_sup_price_change', 'ds_sup_save_product', 'ds_sup_bulk', 'ds_sup_submission_get',
    'ds_sup_orders', 'ds_sup_order', 'ds_sup_slip', 'ds_sup_order_ship', 'ds_sup_order_problem', 'ds_staff_approvals_page', 'ds_staff_approval_get',
    'ds_staff_approval_decide', 'ds_staff_rules_save', 'ds_staff_suppliers_page', 'ds_partner_assign', 'ds_partner_order_cancel', 'ds_supplier_link_user',
    'ds_supplier_application_checks', 'ds_partners_page', 'ds_partner_invite', 'ds_partner_set_status', 'ds_partner_attach', 'ds_partner_rule_save',
    'ds_channels_page', 'ds_channel_settings_save', 'ds_channel_action', 'ds_channel_waitlist', 'ds_staff_invoices', 'ds_docs_page', 'ds_doc_register',
    'ds_doc_link', 'ds_doc_set_status', 'ds_doc_path',
    'ds14_staff_can', 'ds14_assert', 'ds14_supplier', 'ds14_rules', 'ds14_cents', 'ds14_int', 'ds14_num', 'ds14_bool', 'ds14_validate_product', 'ds14_sku_clash',
    'ds14_sku_clash_other', 'ds14_bulk_group', 'ds14_apply_price', 'ds14_create_draft', 'ds14_sup_order_row', 'ds14_partner_accrue']) loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

drop table if exists public.dropship_product_documents;
drop table if exists public.dropship_channel_waitlist;
drop table if exists public.dropship_channel_settings;
drop table if exists public.dropship_partner_commissions;
drop table if exists public.dropship_partner_rules;
drop table if exists public.dropship_partner_merchants;
drop table if exists public.dropship_partners;
drop table if exists public.dropship_partner_orders;
drop table if exists public.dropship_supplier_submissions;
drop sequence if exists public.dropship_partner_seq;

-- the 'shipped' timeline events were made by this release only (partner shipments); the installed list has no such kind
delete from public.dropship_order_events where kind = 'shipped';
alter table public.dropship_order_events drop constraint if exists dropship_order_events_kind_check;
alter table public.dropship_order_events add constraint dropship_order_events_kind_check
  check (kind = any (array['received', 'held', 'hold_cleared', 'charged', 'awaiting_funds', 'charge_failed', 'expired', 'cancel_accepted', 'cancel_rejected',
    'address_updated', 'address_problem', 'refunded', 'handed_to_warehouse', 'protection_released']::text[]));

delete from public.site_settings where key = 'dropship_supplier_rules';
delete from public.carriers c where c.code = 'other' and not exists (select 1 from public.shipments s where s.carrier_code = 'other');
-- the dropship-documents bucket is kept (Supabase refuses SQL deletes of storage rows; the up re-inserts it with on conflict). Remove it with the Storage API if needed.
