-- Divisions step 2b (19 Nov 2026): division_id on the business tables, backfilled from each row's own source, and kept
-- filled for new rows by BEFORE INSERT triggers, so the existing RPCs and screens keep working unchanged. Access rules
-- are NOT changed here (step 3).
--
-- Rules agreed with the owner (19 Nov):
--  · catalogue (products) stays company-wide; divisions own listings (dropship products, pools, brand projects, quotes,
--    orders, …). Child rows (price tiers, media, order/pool/tracking events, invoice lines, request messages/files,
--    turnkey packages/sources/signals, dropship variants) have NO column: they take the parent's division (step 3).
--  · empty division_id (= company-wide) only on audit_log, notifications and the wallet/ledger tables. Ledger lines of
--    an order payment, hold, capture, release or refund MUST have a division; only top-ups, withdrawals and adjustments
--    may be empty (enforced on journals; ledger lines copy their journal's division).
--  · shipments follow their order's division (3PL service shipments without an order → 3PL).
--  · pool and RFQ journals are placed only if the referenced pledge / RFQ exists; nothing is guessed.
-- Tables with rows that cannot be placed get a NOT VALID check (new rows must have a division, old ones are listed by
-- division_unplaced()) instead of NOT NULL; NOT NULL is set wherever every row was placed.
-- Down: supabase/migrations/down/20261101000190_division_columns.down.sql

-- ───────── 1. columns (nullable for now) ─────────
do $$ declare t text;
begin
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'documents', 'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds', 'journals', 'ledger_entries',
    'notifications', 'audit_log'] loop
    execute format('alter table %I add column if not exists division_id uuid', t);
  end loop;
end $$;

-- ───────── 2. how each row finds its division (one function per table; used by the backfill AND the triggers) ─────────
create or replace function division_of_service_request(r service_requests) returns uuid
language sql stable security definer set search_path = public as $$ select division_id_of(division_code_for_service(r.service_code)) $$;

create or replace function division_of_rfq(r rfqs) returns uuid
language sql stable security definer set search_path = public as $$ select division_id_of('SRC') $$;

create or replace function division_of_quote(r quotes) returns uuid
language sql stable security definer set search_path = public as $$ select division_id from rfqs where id = r.rfq_id $$;

create or replace function division_of_order(r orders) returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when r.pool_id is not null then division_id_of('POOL')
    when r.rfq_id is not null then (select division_id from rfqs where id = r.rfq_id)
    when r.quote_id is not null then (select division_id from quotes where id = r.quote_id)
  end $$;

create or replace function division_of_proforma(r proforma_invoices) returns uuid
language sql stable security definer set search_path = public as $$
  select case when r.pool_id is not null then division_id_of('POOL') else (select division_id from orders where id = r.order_id) end $$;

create or replace function division_of_payment(r payments) returns uuid
language sql stable security definer set search_path = public as $$ select division_id from orders where id = r.order_id $$;

create or replace function division_of_shipment(r shipments) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select division_id from orders where id = r.order_id),
                  case when r.order_id is null then division_id_of(division_code_for_service(r.service_code)) end) $$;

create or replace function division_of_document(r documents) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select division_id from orders where id = r.order_id),
    (select division_id_of(division_code_for_service(min(il.service))) from invoice_lines il where il.document_id = r.id and il.service is not null),
    division_id_of(division_code_for_service(r.data ->> 'service')),
    case when r.data ? 'pool' then division_id_of('POOL') end) $$;            -- pool purchase orders (PO-…)

create or replace function division_of_wallet_hold(r wallet_holds) returns uuid
language sql stable security definer set search_path = public as $$ select division_id_of(division_code_for_service(r.service)) $$;

-- journals: by what they reference; the referenced pledge / RFQ / request must exist, otherwise no division (listed)
create or replace function division_of_journal(r journals) returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when r.ref_type = 'wallet_hold' then (select division_id from wallet_holds where id = r.ref_id)
    when r.ref_type = 'order' then (select division_id from orders where id = r.ref_id)
    when r.ref_type = 'payment' then (select o.division_id from payments p join orders o on o.id = p.order_id where p.id = r.ref_id)
    when r.ref_type = 'pool_pledge' then (select division_id from pool_pledges where id = r.ref_id)
    when r.ref_type = 'rfq' then (select division_id from rfqs where id = r.ref_id)
    when r.ref_type = 'service_request' then (select division_id from service_requests where id = r.ref_id)
    when r.ref_type = 'document' then coalesce((select division_id from documents where id = r.ref_id), division_id_of(division_code_for_service(r.stream)))
    when r.ref_type in ('wallet_topup', 'wallet_withdrawal', 'adjustment') then null
    else division_id_of(division_code_for_service(r.stream))
  end $$;
-- journals that may stay company-wide (top-ups, withdrawals, adjustments). 'ads' (ad-click charges) is listed here
-- pending the owner's decision — advertising is not one of the six divisions.
create or replace function journal_may_be_company_wide(r journals) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(r.stream, '') in ('topup', 'withdrawal', 'adjustment', 'ads')
      or coalesce(r.ref_type, '') in ('wallet_topup', 'wallet_withdrawal', 'adjustment', 'ad_campaign') $$;

-- notifications: their service, else what their link points at (customer links); otherwise company-wide
create or replace function division_of_notification(r notifications) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_ref text; v uuid;
begin
  v := division_id_of(division_code_for_service(r.service));
  if v is not null then return v; end if;
  if r.link is null then return null; end if;
  if r.link like '/admin/brand-projects/%' or r.link like '/account/brand%' then return division_id_of('MMB'); end if;
  if r.link like '/account/pools%' or r.link like '/pool/%' then return division_id_of('POOL'); end if;
  if r.link like '/account/turnkey%' then return division_id_of('TK'); end if;
  if r.link like '/account/warehouse%' then return division_id_of('3PL'); end if;
  if r.link like '/account/dropship%' then return division_id_of('DS'); end if;
  v_ref := split_part(split_part(r.link, '?', 1), '/', 4);
  if r.link like '/account/sourcing/%' and v_ref <> '' then
    if v_ref like 'SR-%' then return (select division_id from service_requests where code = v_ref); end if;
    if v_ref like 'RFQ-%' then return (select division_id from rfqs where code = v_ref); end if;
    if v_ref ~* '^[0-9a-f-]{36}$' then
      return coalesce((select division_id from rfqs where id = v_ref::uuid), (select division_id from service_requests where id = v_ref::uuid));
    end if;
  end if;
  if r.link like '/account/orders/%' and v_ref ~* '^[0-9a-f-]{36}$' then return (select division_id from orders where id = v_ref::uuid); end if;
  return null;
end $$;

-- audit_log: its service, the obvious action families (pool → POOL, turnkey → TK, brand_project → MMB), and status
-- rows by the entity they record; everything else stays company-wide
create or replace function division_of_audit(r audit_log) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid; v_id uuid := case when r.entity_id ~* '^[0-9a-f-]{36}$' then r.entity_id::uuid end;
begin
  v := division_id_of(division_code_for_service(r.service));
  if v is not null then return v; end if;
  if r.action ~ '^pool[._]' then return division_id_of('POOL'); end if;
  if r.action ~ '^turnkey[._]' then return division_id_of('TK'); end if;
  if r.action like 'brand_project.%' then return division_id_of('MMB'); end if;
  if r.action like 'status.%' then
    return case r.entity
      when 'rfq' then coalesce((select division_id from rfqs where id = v_id), division_id_of('SRC'))
      when 'quote' then (select division_id from quotes where id = v_id)
      when 'order' then (select division_id from orders where id = v_id)
      when 'service_request' then (select division_id from service_requests where id = v_id)
      when 'pool' then division_id_of('POOL')
      when 'pool_pledge' then division_id_of('POOL')
      when 'brand_project' then division_id_of('MMB')
      else null end;
  end if;
  return null;
end $$;

-- ───────── 3. backfill (parents first; side-effect triggers paused so timestamps, status history and audit stay as they are) ─────────
alter table service_requests disable trigger trg_sr_updated;
alter table orders disable trigger trg_orders_updated;
alter table documents disable trigger trg_guard_document;

update service_requests r set division_id = division_of_service_request(r) where division_id is null;
update rfqs r set division_id = division_of_rfq(r) where division_id is null;
update quotes r set division_id = division_of_quote(r) where division_id is null;
update orders r set division_id = division_of_order(r) where division_id is null;
update proforma_invoices r set division_id = division_of_proforma(r) where division_id is null;
update payments r set division_id = division_of_payment(r) where division_id is null;
update shipments r set division_id = division_of_shipment(r) where division_id is null;
update documents r set division_id = division_of_document(r) where division_id is null;
update brand_projects set division_id = division_id_of('MMB') where division_id is null;
update pools set division_id = division_id_of('POOL') where division_id is null;
update pool_pledges set division_id = division_id_of('POOL') where division_id is null;
update turnkey_projects set division_id = division_id_of('TK') where division_id is null;
update turnkey_leads set division_id = division_id_of('TK') where division_id is null;
update dropship_products set division_id = division_id_of('DS') where division_id is null;
update dropship_rates set division_id = division_id_of('DS') where division_id is null;
update dropship_import_list set division_id = division_id_of('DS') where division_id is null;
update company_services set division_id = division_id_of(division_code_for_service(service)) where division_id is null;
update wallet_holds r set division_id = division_of_wallet_hold(r) where division_id is null;
update journals r set division_id = division_of_journal(r) where division_id is null;
update ledger_entries le set division_id = j.division_id from journals j where j.id = le.journal_id and le.division_id is distinct from j.division_id;
update notifications r set division_id = division_of_notification(r) where division_id is null;

alter table service_requests enable trigger trg_sr_updated;
alter table orders enable trigger trg_orders_updated;
alter table documents enable trigger trg_guard_document;

-- audit_log stays append-only: the guard now also allows exactly one kind of update — filling an empty division_id
-- while every other column stays identical (classification only, never content)
create or replace function audit_log_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('app.audit_erasure', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and old.division_id is null and new.division_id is not null
     and (to_jsonb(new) - 'division_id') = (to_jsonb(old) - 'division_id') then return new; end if;
  raise exception 'AUDIT_APPEND_ONLY: audit_log rows cannot be changed or deleted';
end $$;
update audit_log r set division_id = division_of_audit(r) where division_id is null and division_of_audit(r) is not null;

-- ───────── 4. keep new rows filled (BEFORE INSERT; existing RPCs need no change) ─────────
create or replace function set_division_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.division_id is not null then return new; end if;
  -- one branch per table (each statement is planned only when reached)
  if tg_table_name = 'service_requests' then new.division_id := division_of_service_request(new);
  elsif tg_table_name = 'rfqs' then new.division_id := division_of_rfq(new);
  elsif tg_table_name = 'quotes' then new.division_id := division_of_quote(new);
  elsif tg_table_name = 'orders' then new.division_id := division_of_order(new);
  elsif tg_table_name = 'proforma_invoices' then new.division_id := division_of_proforma(new);
  elsif tg_table_name = 'payments' then new.division_id := division_of_payment(new);
  elsif tg_table_name = 'shipments' then new.division_id := division_of_shipment(new);
  elsif tg_table_name = 'documents' then new.division_id := division_of_document(new);
  elsif tg_table_name = 'brand_projects' then new.division_id := division_id_of('MMB');
  elsif tg_table_name in ('pools', 'pool_pledges') then new.division_id := division_id_of('POOL');
  elsif tg_table_name in ('turnkey_projects', 'turnkey_leads') then new.division_id := division_id_of('TK');
  elsif tg_table_name in ('dropship_products', 'dropship_rates', 'dropship_import_list') then new.division_id := division_id_of('DS');
  elsif tg_table_name = 'company_services' then new.division_id := division_id_of(division_code_for_service(to_jsonb(new) ->> 'service'));
  elsif tg_table_name = 'wallet_holds' then new.division_id := division_of_wallet_hold(new);
  elsif tg_table_name = 'journals' then new.division_id := division_of_journal(new);
  elsif tg_table_name = 'notifications' then new.division_id := division_of_notification(new);
  elsif tg_table_name = 'audit_log' then new.division_id := division_of_audit(new);
  end if;
  return new;
end $$;
do $$ declare t text;
begin
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'documents', 'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds', 'journals', 'notifications', 'audit_log'] loop
    execute format('drop trigger if exists trg_set_division on %I', t);
    execute format('create trigger trg_set_division before insert on %I for each row execute function set_division_id()', t);
  end loop;
end $$;

-- ledger lines always carry their journal's division (set on insert, never different)
create or replace function ledger_entry_division() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.division_id := (select division_id from journals where id = new.journal_id);
  return new;
end $$;
drop trigger if exists trg_ledger_entry_division on ledger_entries;
create trigger trg_ledger_entry_division before insert or update of journal_id, division_id on ledger_entries for each row execute function ledger_entry_division();

-- a document's division can also come from its first invoice line (lines are written after the document)
create or replace function invoice_line_division() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update documents set division_id = division_id_of(division_code_for_service(new.service))
   where id = new.document_id and division_id is null and division_code_for_service(new.service) is not null;
  return new;
end $$;
drop trigger if exists trg_invoice_line_division on invoice_lines;
create trigger trg_invoice_line_division after insert on invoice_lines for each row execute function invoice_line_division();

-- ───────── 5. rules for rows that may stay empty (checked at commit, so lines written later in the transaction count) ─────────
create or replace function check_division_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare j journals; d documents;
begin
  if tg_table_name = 'journals' then
    select * into j from journals where id = new.id;            -- the row as it is at commit
    if j.id is not null and j.division_id is null and not journal_may_be_company_wide(j) then
      raise exception 'DIVISION_REQUIRED: journal % (stream %, ref %) must belong to a division', j.number, j.stream, j.ref_type;
    end if;
  elsif tg_table_name = 'documents' then
    select * into d from documents where id = new.id;
    if d.id is not null and d.division_id is null and d.doc_type not in ('receipt', 'statement') then
      raise exception 'DIVISION_REQUIRED: document % (%) must belong to a division', d.number, d.doc_type;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_journal_division_rule on journals;
create constraint trigger trg_journal_division_rule after insert or update of division_id, stream, ref_type on journals
  deferrable initially deferred for each row execute function check_division_rules();
drop trigger if exists trg_document_division_rule on documents;
create constraint trigger trg_document_division_rule after insert or update of division_id, doc_type on documents
  deferrable initially deferred for each row execute function check_division_rules();

-- ───────── 6. foreign keys, indexes, NOT NULL where every row is placed ─────────
do $$ declare t text; n bigint;
begin
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'documents', 'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds', 'journals', 'ledger_entries',
    'notifications', 'audit_log'] loop
    execute format('alter table %1$I drop constraint if exists %1$s_division_fk', t);
    execute format('alter table %1$I add constraint %1$s_division_fk foreign key (division_id) references divisions(id) on delete restrict', t);
    execute format('create index if not exists %1$s_division_idx on %1$I (division_id)', t);
  end loop;
  -- tables where every row must have a division
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds'] loop
    execute format('select count(*) from %I where division_id is null', t) into n;
    execute format('alter table %1$I drop constraint if exists %1$s_division_required', t);
    if n = 0 then
      execute format('alter table %I alter column division_id set not null', t);
    else
      -- some old rows could not be placed: new rows are still forced to have a division; the old ones are listed
      execute format('alter table %1$I add constraint %1$s_division_required check (division_id is not null) not valid', t);
      raise notice 'division: % rows of % could not be placed (listed by division_unplaced())', n, t;
    end if;
  end loop;
end $$;

-- ───────── 7. what could not be placed (and why) — staff report, no customer data ─────────
create or replace function division_unplaced()
returns table (table_name text, reason text, rows bigint)
language sql stable security definer set search_path = public as $$
  select 'service_requests', 'service code ' || coalesce(service_code, 'empty'), count(*) from service_requests where division_id is null group by 2
  union all select 'orders', 'no pool, RFQ or quote', count(*) from orders where division_id is null
  union all select 'quotes', case when rfq_id is null then 'no RFQ' else 'RFQ not placed' end, count(*) from quotes where division_id is null group by 2
  union all select 'proforma_invoices', 'no pool / order not placed', count(*) from proforma_invoices where division_id is null
  union all select 'payments', case when order_id is null then 'no order' else 'order not placed' end, count(*) from payments where division_id is null group by 2
  union all select 'shipments', case when order_id is null then 'no order, service ' || coalesce(service_code, 'empty') else 'order not placed' end, count(*) from shipments where division_id is null group by 2
  union all select 'documents', doc_type || case when doc_type in ('receipt', 'statement') then ' (company-wide allowed)' else ' — needs a division' end, count(*) from documents where division_id is null group by 2
  union all select 'journals', coalesce(stream, '—') || ' / ' || coalesce(ref_type, '—') ||
      case when ref_type = 'pool_pledge' then ' — referenced pledge not found'
           when ref_type = 'rfq' then ' — referenced RFQ not found'
           when ref_type = 'service_request' then ' — referenced request not found'
           when journal_may_be_company_wide(j) then ' (company-wide allowed)' else ' — needs a division' end, count(*) from journals j where division_id is null group by 2
  union all select 'wallet_holds', 'service ' || service, count(*) from wallet_holds where division_id is null group by 2
  union all select 'notifications', case when user_id is not null then 'staff alert' else 'customer notification' end || ' (company-wide allowed)', count(*) from notifications where division_id is null group by 2
  union all select 'audit_log', split_part(action, '.', 1) || ' (company-wide allowed)', count(*) from audit_log where division_id is null group by 2
  order by 1, 2;
$$;
revoke all on function division_unplaced() from public, anon, authenticated;
grant execute on function division_unplaced() to service_role;
