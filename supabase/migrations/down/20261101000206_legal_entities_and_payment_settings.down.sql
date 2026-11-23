-- Down for 20261101000206_legal_entities_and_payment_settings.sql
drop table if exists payment_reconciliation_alerts;
drop table if exists payment_settlements;
drop table if exists payment_webhook_events;
drop table if exists payment_checkouts;
drop table if exists customer_payment_methods;
drop table if exists payment_provider_settings;

drop trigger if exists trg_payment_option_settings_audit on payment_option_settings;
drop function if exists trg_audit_payment_option_settings();
drop table if exists payment_option_settings;
drop function if exists is_company_wide_finance_or_admin();

delete from site_settings where key in (
  'payments.approval_threshold_cents',
  'payments.pay_later_grace_days',
  'payments.saas_suspend_notice_days',
  'payments.late_fee_enabled',
  'payments.late_fee_bp',
  'payments.pool_pledge_expiry_minutes',
  'legal_entity.switch_schedule'
);

drop trigger if exists trg_aa_document_entity on documents;
drop function if exists trg_stamp_document_entity();

-- Restore 198 next_document_number(text, uuid, timestamptz) and document_counters primary key (series, year)
drop function if exists next_document_number(text, uuid, timestamptz, uuid);
create or replace function next_document_number(p_kind text, p_division uuid default null, p_at timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare v_series text; v_year int := extract(year from (p_at at time zone 'Asia/Shanghai'))::int; v_code text; v_n bigint;
begin
  v_series := case p_kind when 'invoice' then 'OCT' when 'credit_note' then 'CN' when 'proforma' then 'PF' end;
  if v_series is null then raise exception 'DOCUMENT_KIND_UNKNOWN: %', p_kind; end if;
  if v_series in ('OCT', 'CN') then
    select code into v_code from divisions where id = p_division;
    if v_code is null then raise exception 'DOCUMENT_NEEDS_DIVISION: an invoice or credit note must belong to a division'; end if;
  end if;
  insert into document_counters as c (series, year, last_value) values (v_series, v_year, 1)
  on conflict (series, year) do update set last_value = c.last_value + 1, updated_at = now()
  returning c.last_value into v_n;
  return case v_series when 'PF' then format('PF-%s-%s', v_year, lpad(v_n::text, 6, '0'))
                       else format('%s-%s-%s-%s', v_series, v_code, v_year, lpad(v_n::text, 6, '0')) end;
end $$;
revoke all on function next_document_number(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function next_document_number(text, uuid, timestamptz) to service_role;

drop index if exists documents_series_number_key;
create unique index if not exists documents_series_number_key on documents (number) where number ~ '^(OCT|CN|PF)-';

delete from document_counters where entity_id <> '00000000-0000-0000-0000-000000000001'::uuid;
alter table document_counters drop constraint if exists document_counters_pkey;
alter table document_counters drop column if exists entity_id;
alter table document_counters add constraint document_counters_pkey primary key (series, year);

drop index if exists document_payments_legal_entity_idx;
alter table document_payments drop column if exists legal_entity_id;

drop index if exists payments_legal_entity_idx;
alter table payments drop column if exists legal_entity_id;

drop index if exists proforma_invoices_legal_entity_idx;
alter table proforma_invoices drop column if exists legal_entity_id;

drop index if exists documents_legal_entity_idx;
alter table documents drop column if exists legal_entity_id;

drop index if exists company_bank_accounts_entity_idx;
alter table company_bank_accounts drop column if exists legal_entity_id;

drop function if exists current_legal_entity_id(timestamptz);
drop table if exists legal_entities;
