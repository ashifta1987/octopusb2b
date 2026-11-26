-- 20261101000230_demo_wipe_turnkey_warehouse.sql
-- Staging demo wipe (wipe_demo_data, staging only since migration 193) also removes the Turnkey T2 client projects and the
-- Warehouse OS W1–W2b rows of demo / test companies, which otherwise block deleting those companies (FK restrict).
-- Stock movements (warehouse_stock_movements) are never deleted. Down restores the exact previous function.
-- Down: supabase/migrations/down/20261101000230_demo_wipe_turnkey_warehouse.down.sql
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
   where exists (select 1 from fee_versions f where f.proposed_by = u or f.approved_by = u);
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
end $function$;
