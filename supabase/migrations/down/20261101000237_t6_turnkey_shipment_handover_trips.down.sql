-- 20261101000237_t6_turnkey_shipment_handover_trips.down.sql   (renumber at install)
-- Reverses the T6 migration (balance, shipments, tracking, documents, trips, passport copies, handover):
--  · wipe_demo_data, tk_set_project_status and tk_move_project_stage go back to the definitions installed on staging before
--    T6 (pg_get_functiondef, read-only: W3a's wipe, T2's status rules, T5's phase gate). CREATE OR REPLACE keeps their grants.
--  · the storage policies, the T6 functions and tables go (their rows go with them); the client history entries of the T6
--    kinds are deleted and the T5 kind check comes back; tk_services loses the two trip-price columns.
--  · Issued balance and trip proformas and their journals are KEPT (the ledger stays balanced). The buckets
--    turnkey-documents and turnkey-passports and their files stay (Supabase refuses SQL deletes on storage); remove passport
--    files with the Storage API (service role) when rolling back for good.

-- ───────── replaced functions: back to the staging definitions ─────────
CREATE OR REPLACE FUNCTION public.wipe_demo_data(p_confirm text, p_operator uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_ref text := 'ydbxqrizjxpduqbgnwxg';                     -- the STAGING project (19 Nov 2026: staging only)
  v_counts jsonb := '{}';
  v_users uuid[];
  n bigint;
  fk record;
  s record;
  v_bad text := '';
  v_real_wallets jsonb;
  v_kept uuid[];
begin
  if p_confirm is distinct from 'DELETE DEMO DATA FOR ' || v_ref then
    raise exception 'WIPE_REFUSED: type exactly "DELETE DEMO DATA FOR %"', v_ref using errcode = 'P0001';
  end if;
  -- staging only (19 Nov 2026): refuse on any database not marked staging (live is 'production')
  if coalesce((select value #>> '{}' from site_settings where key = 'app_environment'), '') <> 'staging' then
    raise exception 'WIPE_REFUSED: demo data can only be wiped on the staging project' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('wipe_demo_data'));
  perform tag_seed_rows();   -- pick up anything created on demo rows since the migration
  -- real (not demo/test) customers' wallet balances, to prove the wipe did not change them
  select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') into v_real_wallets
    from wallets w join organizations o on o.id = w.org_id where not o.is_seed;

  -- demo staff + demo buyer (admin@demo.octopusb2b.com is KEPT until the owner creates a real admin — owner decision)
  select coalesce(array_agg(id), '{}') into v_users from auth.users
   where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com';
  -- (Batch 3) demo users who proposed or approved a fee schedule stay: fee_versions is an append-only, two-person
  -- approval history (migration 211) — nulling approved_by or deleting the row is refused by guard_fee_versions().
  select coalesce(array_agg(u), '{}') into v_kept from unnest(v_users) u
   where exists (select 1 from fee_versions f where f.proposed_by = u or f.approved_by = u)
      -- (migration 236) the stock ledger is append-only too: people who reserved, picked or moved stock stay (actor_id)
      or exists (select 1 from warehouse_stock_movements m where m.actor_id = u);
  v_users := array(select u from unnest(v_users) u where u <> all (v_kept));

  -- references to those users that don't cascade: null them (or drop the row when the column is NOT NULL)
  for fk in
    select conrelid::regclass::text tbl, a.attname col, a.attnotnull nn
      from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.confdeltype in ('a', 'r')
       and k.connamespace = 'public'::regnamespace
       and k.conrelid <> 'public.fee_versions'::regclass
  loop
    if fk.nn then execute format('delete from %s where %I = any($1)', fk.tbl, fk.col) using v_users;
    else execute format('update %s set %I = null where %I = any($1)', fk.tbl, fk.col, fk.col) using v_users; end if;
  end loop;

  -- seed rows, children before parents. Every FK into these tables is NO ACTION, so links from rows that stay
  -- (or that are deleted later in this list) are cleared first.
  update finance_approvals set executed_journal_id = null where executed_journal_id in (select id from journals where is_seed);
  delete from finance_approvals where order_id in (select id from orders where is_seed)
     or org_id in (select id from organizations where is_seed) or supplier_id in (select id from suppliers where is_seed);
  delete from ledger_entries where is_seed;                   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_entries', n);
  delete from journals where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journals', n);
  delete from assistant_messages where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_messages', n);
  delete from assistant_sessions where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_sessions', n);
  delete from ad_campaigns where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ad_campaigns', n);
  update escalations set ticket_id = null where ticket_id in (select id from tickets where is_seed);
  delete from tickets where is_seed;                          get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tickets', n);
  delete from shipments where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('shipments', n);
  delete from wallet_topups where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_topups', n);
  update wallet_topups set payment_id = null where payment_id in (select id from payments where is_seed);
  delete from payments where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('payments', n);
  delete from documents where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('documents', n);
  delete from proforma_invoices where is_seed;                get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('proforma_invoices', n);
  update orders set pool_pledge_id = null where pool_pledge_id in (select id from pool_pledges where is_seed);
  update pool_pledges set order_id = null where order_id in (select id from orders where is_seed);
  delete from pool_pledges where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pool_pledges', n);
  delete from orders where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders', n);
  delete from quotes where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('quotes', n);
  delete from rfqs where is_seed;                             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('rfqs', n);
  delete from service_requests where is_seed;                 get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('service_requests', n);
  delete from pools where is_seed;                            get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pools', n);
  update import_rows set product_id = null where product_id in (select id from products where is_seed);
  delete from products where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('products', n);
  update import_jobs set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  update payouts set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  delete from suppliers where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', n);
  -- Turnkey T2 + Warehouse OS W1–W2b rows of demo / test companies (migration 230); stock movements are never deleted
  delete from tk_client_projects p where p.org_id in (select id from organizations where is_seed)
     or exists (select 1 from tk_client_project_staff tps where tps.project_id = p.id and tps.is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tk_client_projects', n);
  delete from wh_clients where org_id in (select id from organizations where is_seed);
  -- Warehouse OS W3a (migration W3a): warehouse orders of demo / test companies (and Dropship orders of their store orders) —
  -- lines, picks, scans, photo records and override attempts go with them — before their lots (pick records point at lots).
  -- Stock movements are never deleted (their wh_order_id has no foreign key); packing photos stay in storage until the
  -- retention job (W6) removes them.
  delete from wh_orders where org_id in (select id from organizations where is_seed)
     or store_order_id in (select so.id from store_orders so where so.org_id in (select id from organizations where is_seed));
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_orders', n);
  delete from wh_location_moves where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_transfer_picks where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_bin_stock where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  update wh_transfer_lines set dest_lot_id = null where dest_lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed));
  delete from wh_pallets where org_id in (select id from organizations where is_seed);
  delete from wh_lots where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_lots', n);
  delete from wh_asns where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_asns', n);
  delete from wh_client_skus where org_id in (select id from organizations where is_seed);
  delete from wallet_withdrawals where org_id in (select id from organizations where is_seed);
  -- wallet holds of demo / test companies (added by migration 177 after this function was written)
  delete from wallet_holds where org_id in (select id from organizations where is_seed);   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_holds', n);
  delete from ledger_accounts where org_id in (select id from organizations where is_seed);
  delete from organizations where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('organizations', n);
  delete from auth.users where id = any(v_users);             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('demo_users', n);
  v_counts := v_counts || jsonb_build_object('demo_users_kept_fee_history', coalesce(array_length(v_kept, 1), 0));

  -- (19 Nov 2026) real customers' notifications are no longer touched: the wipe deletes only rows marked as demo/test

  -- human codes restart at 1001 (or after the highest code that still exists)
  for s in select * from (values
      ('seq_supplier_code', 'suppliers', 'code', '^OCT-(\d+)$'),
      ('seq_rfq', 'rfqs', 'code', '^RFQ-(\d+)$'),
      ('seq_order', 'orders', 'code', '^ORD-(\d+)$'),
      ('seq_shipment', 'shipments', 'code', '^SHP-(\d+)$'),
      ('seq_ticket', 'tickets', 'code', '^TKT-(\d+)$'),
      ('seq_pool', 'pools', 'code', '^POOL-(\d+)$'),
      ('seq_service_request', 'service_requests', 'code', '^SRV-(\d+)$'),
      ('seq_export', 'data_exports', 'code', '^EX-(\d+)$'),
      ('seq_restore', 'restore_requests', 'code', '^RS-(\d+)$'),
      ('seq_journal', 'journals', 'number', '^JRN-(\d+)$'),
      ('seq_pi', 'proforma_invoices', 'number', '^PI-\d{4}-(\d+)$'),
      ('seq_invoice', 'documents', 'number', '^INV-\d{4}-(\d+)$'),
      ('seq_quote', 'quotes', 'code', '^QT-(\d+)$'),
      ('seq_buyer_code', 'organizations', 'buyer_code', '^BUYER-(\d+)$')
    ) v(seq, tbl, col, rx)
  loop
    if to_regclass('public.' || s.seq) is null then continue; end if;
    execute format('select coalesce(max((substring(%I from %L))::bigint), 0) from %I', s.col, s.rx, s.tbl) into n;
    perform setval(s.seq, greatest(1000, n), true);
  end loop;

  -- launch defaults (audit C3 / K7)
  update site_settings set value = jsonb_set(coalesce(value, '{}'), '{amount_minor}', '0') || '{"verified_only": true}'::jsonb, updated_at = now()
   where key = 'wallet_credit_default';
  update site_settings set value = 'false'::jsonb, updated_at = now() where key = 'supplier_portal_enabled';
  update site_settings set value = 'true'::jsonb, updated_at = now() where key = 'pool_enabled';
  -- category names: capitalise the first letter of hand-typed lowercase names ("kitchen utensils" → "Kitchen utensils")
  update categories set name = upper(left(name, 1)) || substr(name, 2) where name ~ '^[a-z]';

  -- verify
  select string_agg(t, ', ') into v_bad from (
    select 'organizations' t where exists (select 1 from organizations where is_seed) union all
    select 'suppliers' where exists (select 1 from suppliers where is_seed) union all
    select 'products' where exists (select 1 from products where is_seed) union all
    select 'orders' where exists (select 1 from orders where is_seed) union all
    select 'journals' where exists (select 1 from journals where is_seed) union all
    select 'ledger_entries' where exists (select 1 from ledger_entries where is_seed) union all
    select 'pools' where exists (select 1 from pools where is_seed) union all
    select 'demo users' where exists (select 1 from auth.users where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com' and id <> all (v_kept)) union all
    select 'ledger not balanced' where coalesce((select sum(debit_cents - credit_cents) from ledger_entries), 0) <> 0 union all
    -- 19 Nov 2026: real customers may hold money (e.g. on staging); the check is that their balances did not change
    select 'real wallet balance changed' where v_real_wallets is distinct from
      (select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') from wallets w join organizations o on o.id = w.org_id where not o.is_seed) union all
    select 'open pools' where exists (select 1 from pools where status in ('open', 'locked'))) x;
  if v_bad is not null then raise exception 'WIPE_VERIFY_FAILED: %', v_bad; end if;

  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (p_operator, 'demo_data_wiped', 'database', v_ref, jsonb_build_object('counts', v_counts, 'at', now()));
  insert into site_settings(key, value, description) values ('demo_wipe',
      jsonb_build_object('at', now(), 'by', p_operator, 'by_name', (select full_name from profiles where id = p_operator), 'counts', v_counts),
      'When the demo dataset was removed (ADDON-24). Drives the one-time "Add your first supplier" banner on /admin.')
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_counts;
end $function$;;

CREATE OR REPLACE FUNCTION public.tk_set_project_status(p_project uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors change projects'; end if;
  if p_status not in ('open', 'on_hold', 'completed', 'cancelled') then raise exception 'INVALID_STATUS'; end if;
  if p_status = v.status then raise exception 'SAME_STATUS: the project already has this status'; end if;
  if p_status in ('on_hold', 'cancelled') and v_reason is null then raise exception 'REASON_REQUIRED: tell the client why'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  if p_status = 'completed' and v.stage <> 'handover' then raise exception 'NOT_AT_HANDOVER: a project is completed at Handover'; end if;
  update public.tk_client_projects
     set status = p_status, status_reason = case when p_status in ('on_hold', 'cancelled') then v_reason end, updated_at = now()
   where id = v.id;
  if p_status = 'completed' then
    update public.tk_client_project_stages set completed_at = now() where project_id = v.id and stage = 'handover';
  elsif v.status = 'completed' then
    update public.tk_client_project_stages set completed_at = null where project_id = v.id and stage = 'handover';
  end if;
  insert into public.tk_client_project_events (project_id, kind, status, message) values (v.id, 'status', p_status, v_reason);
  perform write_audit('turnkey.project_status', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.status, 'to', p_status, 'reason', v_reason));
end $function$;

CREATE OR REPLACE FUNCTION public.tk_move_project_stage(p_project uuid, p_to_stage text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.tk_client_projects;
  v_from smallint;
  v_to smallint;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_name text;
  v_psi public.tk_inspections;
  v_psi_result text;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors move projects'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this old enquiry is not linked to a client company yet'; end if;
  if v_msg is not null and length(v_msg) > 1000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 1,000 characters'; end if;
  select seq into v_from from public.tk_stages where code = v.stage;
  select seq, name into v_to, v_name from public.tk_stages where code = p_to_stage;
  if v_to is null then raise exception 'INVALID_STAGE'; end if;
  if v_to = v_from then raise exception 'SAME_STAGE: the project is already in this phase'; end if;
  if v_to > v_from + 1 then raise exception 'STAGE_SKIP: move one phase at a time'; end if;
  if v_to < v_from and v_msg is null then raise exception 'REASON_REQUIRED: tell the client why the project moves back'; end if;
  -- T4: Design is complete when the client has approved a layout drawing version; Quote and deposit is complete when the
  -- client has accepted a quote and its deposit is fully paid
  if v_to > v_from and v.stage = 'design'
     and not exists (select 1 from public.tk_drawing_versions d where d.project_id = v.id and d.status = 'approved') then
    raise exception 'DRAWING_NOT_APPROVED: Design is complete when the client approves a layout drawing version';
  end if;
  if v_to > v_from and v.stage = 'quote_deposit' then
    if not exists (select 1 from public.tk_client_quotes q where q.project_id = v.id and q.status = 'accepted') then
      raise exception 'QUOTE_NOT_ACCEPTED: Quote and deposit is complete when the client accepts a quote';
    end if;
    if not exists (select 1 from public.tk_client_quotes q where q.project_id = v.id and q.status = 'accepted' and public.tk_fee_is_paid(q.document_id)) then
      raise exception 'DEPOSIT_NOT_PAID: Quote and deposit is complete when the client has paid the deposit in full';
    end if;
  end if;
  -- T5: Production and QC is complete when the latest pre-shipment inspection is published with a pass (or pass with
  -- remarks); a failed one blocks Shipment until a re-inspection passes or an admin who was not its inspector overrides it
  if v_to > v_from and v.stage = 'production_qc' then
    select * into v_psi from public.tk_inspections i
     where i.project_id = v.id and i.kind = 'pre_shipment' and i.status <> 'cancelled' order by i.round desc limit 1;
    if v_psi.id is null then
      raise exception 'PSI_REQUIRED: Production and QC is complete when a pre-shipment inspection has passed and its report is published';
    end if;
    if v_psi.status <> 'published' then
      raise exception 'PSI_NOT_PUBLISHED: Production and QC is complete when the pre-shipment inspection report is published';
    end if;
    select r.result into v_psi_result from public.tk_inspection_reports r where r.inspection_id = v_psi.id;
    if v_psi_result = 'fail' and v_psi.override_by is null then
      raise exception 'PSI_FAILED: the pre-shipment inspection failed; shipment waits for a passed re-inspection (or an admin override with a reason)';
    end if;
  end if;
  -- T3 payment gate: a gated paid phase starts only when its fee is active (approved when above 2x) and the client has paid it
  if v_to > v_from and exists (select 1 from public.tk_stage_fee_rules r where r.stage = p_to_stage and r.gated) then
    if not exists (select 1 from public.tk_project_fees f where f.project_id = v.id and f.stage = p_to_stage and f.status = 'active') then
      raise exception 'FEE_NOT_APPROVED: % starts after its fee is set and active (an admin approves fees above 2x the starting fee)', v_name;
    end if;
    if exists (select 1 from public.tk_project_fees f where f.project_id = v.id and f.stage = p_to_stage and f.status = 'active'
                 and not public.tk_fee_is_paid(f.document_id)) then
      raise exception 'FEE_NOT_PAID: % starts after the client has paid its fee', v_name;
    end if;
  end if;
  if v_to > v_from then
    update public.tk_client_project_stages set completed_at = now() where project_id = v.id and stage = v.stage;
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  else
    update public.tk_client_project_stages set started_at = null, completed_at = null
     where project_id = v.id and stage in (select code from public.tk_stages where seq > v_to);
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  end if;
  update public.tk_client_projects set stage = p_to_stage, stage_changed_at = now(), updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, from_stage, to_stage, message)
  values (v.id, case when v_to > v_from then 'stage_forward' else 'stage_back' end, v.stage, p_to_stage, v_msg);
  perform write_audit('turnkey.project_stage', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.stage, 'to', p_to_stage, 'message', v_msg));
end $function$;

-- ───────── storage policies ─────────
drop policy if exists "turnkey documents staff upload" on storage.objects;
drop policy if exists "turnkey documents read" on storage.objects;
drop policy if exists "turnkey documents remove unregistered" on storage.objects;
drop policy if exists "turnkey passports client upload" on storage.objects;
drop policy if exists "turnkey passports read" on storage.objects;
drop policy if exists "turnkey passports remove unregistered" on storage.objects;

-- ───────── tables (policies, triggers and indexes go with them) ─────────
drop table if exists public.tk_handover_signoffs;
drop table if exists public.tk_handover_items;
drop table if exists public.tk_trip_travellers;
drop table if exists public.tk_trip_fees;
drop table if exists public.tk_trips;
drop table if exists public.tk_project_documents;
drop table if exists public.tk_shipment_events;
drop table if exists public.tk_shipments;
drop table if exists public.tk_quote_balances;

-- ───────── functions ─────────
drop function if exists public.tk_t6_history_guard();
drop function if exists public.tk_balance_state(uuid);
drop function if exists public.tk_usd(bigint);
drop function if exists public.tk_shipment_status_label(text);
drop function if exists public.tk_document_kind_label(text);
drop function if exists public.tk_passport_staff_ok(uuid);
drop function if exists public.tk_trip_estimate(date, date, integer, integer, integer, integer, boolean);
drop function if exists public.tk_trip_label(uuid);
drop function if exists public.tk_doc_can_upload(text);
drop function if exists public.tk_doc_file_visible(text);
drop function if exists public.tk_doc_orphan_removable(text);
drop function if exists public.tk_passport_can_upload(text, text);
drop function if exists public.tk_passport_file_visible(text);
drop function if exists public.tk_passport_orphan_removable(text);
drop function if exists public.tk_issue_balance_invoice(uuid);
drop function if exists public.tk_create_shipment(uuid, text, text, text, text, text, text, text, date, date, text);
drop function if exists public.tk_update_shipment(uuid, text, text, text, text, text, text, date, date, text);
drop function if exists public.tk_add_shipment_event(uuid, timestamptz, text, text, text);
drop function if exists public.tk_cancel_shipment(uuid, text);
drop function if exists public.tk_doc_editor_check(uuid, text, uuid);
drop function if exists public.tk_add_project_document(uuid, text, text, text, text, text, uuid);
drop function if exists public.tk_release_project_document(uuid);
drop function if exists public.tk_withdraw_project_document(uuid, text);
drop function if exists public.tk_remove_project_document(uuid);
drop function if exists public.tk_add_handover_item(uuid, text);
drop function if exists public.tk_set_handover_item_done(uuid, boolean, uuid);
drop function if exists public.tk_remove_handover_item(uuid);
drop function if exists public.tk_sign_handover(uuid, text, text);
drop function if exists public.tk_request_trip(uuid, date, date, integer, integer, integer, integer, boolean, text);
drop function if exists public.tk_supersede_trip_fee(uuid);
drop function if exists public.tk_trip_fee_activated(uuid, uuid);
drop function if exists public.tk_propose_trip_fee(uuid, bigint, text);
drop function if exists public.tk_decide_trip_fee(uuid, text, text);
drop function if exists public.tk_withdraw_trip_fee(uuid);
drop function if exists public.tk_confirm_trip(uuid, text, text, text);
drop function if exists public.tk_complete_trip(uuid, text);
drop function if exists public.tk_cancel_trip(uuid, text);
drop function if exists public.tk_add_trip_passport(uuid, uuid, integer, text, text);
drop function if exists public.tk_delete_trip_passport(uuid);
drop function if exists public.tk_purge_trip_passports(integer);
drop function if exists public.tk_staff_shipping(uuid);
drop function if exists public.tk_staff_trips(uuid);
drop function if exists public.tk_list_trip_fee_approvals();

-- ───────── client history kinds (T5 list) ─────────
delete from public.tk_client_project_events where kind in ('balance', 'shipment', 'trip', 'handover');
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date', 'fee', 'manager', 'drawing', 'quote', 'inspection'));

-- ───────── tk_services trip prices ─────────
alter table public.tk_services drop constraint if exists tk_services_travellers_check;
alter table public.tk_services drop column if exists extra_traveller_day_cents;
alter table public.tk_services drop column if exists included_travellers;
