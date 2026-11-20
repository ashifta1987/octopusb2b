-- DOWN for 20261101000190_division_columns.sql — removes the division columns, their triggers and functions, and
-- restores the original audit_log append-only guard. Then:
--   delete from _migrations where name = '20261101000190_division_columns.sql';
drop function if exists division_unplaced();
drop trigger if exists trg_journal_division_rule on journals;
drop trigger if exists trg_document_division_rule on documents;
drop function if exists check_division_rules();
drop trigger if exists trg_invoice_line_division on invoice_lines;
drop function if exists invoice_line_division();
drop trigger if exists trg_ledger_entry_division on ledger_entries;
drop function if exists ledger_entry_division();
do $$ declare t text;
begin
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'documents', 'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds', 'journals', 'notifications', 'audit_log'] loop
    execute format('drop trigger if exists trg_set_division on %I', t);
  end loop;
end $$;
drop function if exists set_division_id();

create or replace function audit_log_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('app.audit_erasure', true), '') = 'on' then return new; end if;
  raise exception 'AUDIT_APPEND_ONLY: audit_log rows cannot be changed or deleted';
end $$;

drop function if exists division_of_audit(audit_log);
drop function if exists division_of_notification(notifications);
drop function if exists journal_may_be_company_wide(journals);
drop function if exists division_of_journal(journals);
drop function if exists division_of_wallet_hold(wallet_holds);
drop function if exists division_of_document(documents);
drop function if exists division_of_shipment(shipments);
drop function if exists division_of_payment(payments);
drop function if exists division_of_proforma(proforma_invoices);
drop function if exists division_of_order(orders);
drop function if exists division_of_quote(quotes);
drop function if exists division_of_rfq(rfqs);
drop function if exists division_of_service_request(service_requests);

-- audit_log columns cannot be dropped while the append-only guard blocks nothing here (DDL, not row updates) — fine
do $$ declare t text;
begin
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'documents', 'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds', 'journals', 'ledger_entries',
    'notifications', 'audit_log'] loop
    execute format('alter table %I drop column if exists division_id', t);   -- drops its FK, index and checks too
  end loop;
end $$;
