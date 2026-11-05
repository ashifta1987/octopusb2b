-- ADDON-24 (6 Nov 2026): prepare the database for real data.
--   1. is_seed columns on every business table + deterministic back-fill (never guessed — rules below)
--   2. wipe_demo_data(confirm, operator): one transaction, dependency order, sequence reset, verification, audit
--   3. merge_duplicate_org(keep, drop): owner decision — the two "SOUTHFIELD BIOCHEM" companies become one
--   4. seed guard: site_settings app_environment = 'production' (seed.sql / seed scripts refuse to run)
--   5. dashboards: revenue / geography / wallet RPCs ignore is_seed rows
-- Nothing is deleted by this migration; the wipe runs only via `pnpm db:wipe-demo` with typed confirmation.

-- ───────── 1. is_seed columns ─────────
do $$
declare t text;
begin
  foreach t in array array['organizations','suppliers','products','categories','tags','rfqs','quotes','orders','proforma_invoices',
    'documents','payments','shipments','service_requests','wallet_topups','journals','ledger_entries','tickets','pools','pool_pledges',
    'ad_campaigns','assistant_sessions','assistant_messages','backups'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists is_seed boolean not null default false', t);
      execute format('create index if not exists %I on public.%I (is_seed) where is_seed', t || '_is_seed_idx', t);
    end if;
  end loop;
end $$;

-- ───────── back-fill: rows inserted by supabase/seed.sql + scripts/seed-users.mjs, and everything built on them ─────────
-- Rules (deterministic):
--   demo suppliers  = legal_name ends with "(demo)"  (seed.sql)            + OCT-1131 "aviora" (owner decision 6 Nov 2026)
--   demo products   = products of demo suppliers
--   demo buyer org  = organizations.name ends with "(demo)" (seed-users.mjs)
--   dependent rows  = RFQs / quotes / orders / pools / payments / documents / journals … that reference the above
--   categories & tags are KEPT (owner decision) → stay is_seed = false
create or replace function tag_seed_rows() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := '{}';
begin
  update suppliers set is_seed = true where legal_name like '%(demo)' or code = 'OCT-1131';
  update products set is_seed = true where supplier_id in (select id from suppliers where is_seed);
  update organizations set is_seed = true where name like '%(demo)';

  update rfqs set is_seed = true
   where org_id in (select id from organizations where is_seed)
      or product_id in (select id from products where is_seed)
      or id in (select rfq_id from quotes where supplier_id in (select id from suppliers where is_seed));
  update quotes set is_seed = true
   where rfq_id in (select id from rfqs where is_seed) or supplier_id in (select id from suppliers where is_seed);
  update pools set is_seed = true
   where product_id in (select id from products where is_seed) or supplier_id in (select id from suppliers where is_seed)
      or starter_org_id in (select id from organizations where is_seed);
  update pool_pledges set is_seed = true
   where pool_id in (select id from pools where is_seed) or org_id in (select id from organizations where is_seed);
  update orders set is_seed = true
   where org_id in (select id from organizations where is_seed) or supplier_id in (select id from suppliers where is_seed)
      or rfq_id in (select id from rfqs where is_seed) or quote_id in (select id from quotes where is_seed)
      or pool_id in (select id from pools where is_seed);
  update pool_pledges set is_seed = true where order_id in (select id from orders where is_seed);
  update proforma_invoices set is_seed = true
   where order_id in (select id from orders where is_seed) or pool_id in (select id from pools where is_seed);
  update payments set is_seed = true
   where order_id in (select id from orders where is_seed) or org_id in (select id from organizations where is_seed);
  update documents set is_seed = true
   where order_id in (select id from orders where is_seed) or org_id in (select id from organizations where is_seed)
      or supplier_id in (select id from suppliers where is_seed);
  update shipments set is_seed = true where order_id in (select id from orders where is_seed);
  update service_requests set is_seed = true
   where org_id in (select id from organizations where is_seed) or product_id in (select id from products where is_seed);
  update tickets set is_seed = true
   where org_id in (select id from organizations where is_seed) or order_id in (select id from orders where is_seed);
  update ad_campaigns set is_seed = true
   where org_id in (select id from organizations where is_seed) or supplier_id in (select id from suppliers where is_seed);
  update wallet_topups set is_seed = true
   where org_id in (select id from organizations where is_seed) or reference like 'DEMO-%';
  update assistant_sessions set is_seed = true where org_id in (select id from organizations where is_seed);
  update assistant_messages set is_seed = true where session_id in (select id from assistant_sessions where is_seed);

  -- journals: by their reference, or by touching a demo org's account
  update journals j set is_seed = true
   where (j.ref_type = 'order' and j.ref_id in (select id from orders where is_seed))
      or (j.ref_type = 'payment' and j.ref_id in (select id from payments where is_seed))
      or (j.ref_type = 'ad_campaign' and j.ref_id in (select id from ad_campaigns where is_seed))
      or (j.ref_type = 'pool_pledge' and j.ref_id in (select id from pool_pledges where is_seed))
      or (j.ref_type = 'service_request' and j.ref_id in (select id from service_requests where is_seed))
      or (j.ref_type = 'rfq' and j.ref_id in (select id from rfqs where is_seed))
      or (j.ref_type = 'wallet_topup' and j.ref_id in (select id from wallet_topups where is_seed))
      or exists (select 1 from ledger_entries le where le.journal_id = j.id and le.org_id in (select id from organizations where is_seed));
  update ledger_entries set is_seed = true where journal_id in (select id from journals where is_seed);

  select jsonb_object_agg(t, n) into r from (
    select 'organizations' t, count(*) filter (where is_seed) n from organizations union all
    select 'suppliers', count(*) filter (where is_seed) from suppliers union all
    select 'products', count(*) filter (where is_seed) from products union all
    select 'rfqs', count(*) filter (where is_seed) from rfqs union all
    select 'quotes', count(*) filter (where is_seed) from quotes union all
    select 'orders', count(*) filter (where is_seed) from orders union all
    select 'pools', count(*) filter (where is_seed) from pools union all
    select 'pool_pledges', count(*) filter (where is_seed) from pool_pledges union all
    select 'proforma_invoices', count(*) filter (where is_seed) from proforma_invoices union all
    select 'payments', count(*) filter (where is_seed) from payments union all
    select 'documents', count(*) filter (where is_seed) from documents union all
    select 'shipments', count(*) filter (where is_seed) from shipments union all
    select 'service_requests', count(*) filter (where is_seed) from service_requests union all
    select 'tickets', count(*) filter (where is_seed) from tickets union all
    select 'ad_campaigns', count(*) filter (where is_seed) from ad_campaigns union all
    select 'wallet_topups', count(*) filter (where is_seed) from wallet_topups union all
    select 'assistant_sessions', count(*) filter (where is_seed) from assistant_sessions union all
    select 'journals', count(*) filter (where is_seed) from journals union all
    select 'ledger_entries', count(*) filter (where is_seed) from ledger_entries) x;
  return r;
end $$;
revoke execute on function tag_seed_rows() from public, anon, authenticated;

select tag_seed_rows();

-- ───────── 2. the wipe ─────────
create or replace function wipe_demo_data(p_confirm text, p_operator uuid default null) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_ref text := 'qrawnqpxvtjmgncxmffu';
  v_counts jsonb := '{}';
  v_users uuid[];
  n bigint;
  fk record;
  s record;
  v_bad text := '';
begin
  if p_confirm is distinct from 'DELETE DEMO DATA FOR ' || v_ref then
    raise exception 'WIPE_REFUSED: type exactly "DELETE DEMO DATA FOR %"', v_ref using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('wipe_demo_data'));
  perform tag_seed_rows();   -- pick up anything created on demo rows since the migration

  -- demo staff + demo buyer (admin@demo.octopusb2b.com is KEPT until the owner creates a real admin — owner decision)
  select coalesce(array_agg(id), '{}') into v_users from auth.users
   where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com';

  -- references to those users that don't cascade: null them (or drop the row when the column is NOT NULL)
  for fk in
    select conrelid::regclass::text tbl, a.attname col, a.attnotnull nn
      from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.confdeltype in ('a', 'r')
       and k.connamespace = 'public'::regnamespace
  loop
    if fk.nn then execute format('delete from %s where %I = any($1)', fk.tbl, fk.col) using v_users;
    else execute format('update %s set %I = null where %I = any($1)', fk.tbl, fk.col, fk.col) using v_users; end if;
  end loop;

  -- seed rows, children before parents
  delete from ledger_entries where is_seed;                   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_entries', n);
  update finance_approvals set executed_journal_id = null where executed_journal_id in (select id from journals where is_seed);
  delete from journals where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journals', n);
  delete from assistant_messages where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_messages', n);
  delete from assistant_sessions where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_sessions', n);
  delete from ad_campaigns where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ad_campaigns', n);
  delete from tickets where is_seed;                          get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tickets', n);
  delete from shipments where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('shipments', n);
  delete from payments where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('payments', n);
  delete from documents where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('documents', n);
  delete from proforma_invoices where is_seed;                get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('proforma_invoices', n);
  delete from pool_pledges where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pool_pledges', n);
  delete from orders where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders', n);
  delete from quotes where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('quotes', n);
  delete from rfqs where is_seed;                             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('rfqs', n);
  delete from service_requests where is_seed;                 get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('service_requests', n);
  delete from pools where is_seed;                            get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pools', n);
  delete from wallet_topups where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_topups', n);
  delete from products where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('products', n);
  delete from suppliers where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', n);
  delete from ledger_accounts where org_id in (select id from organizations where is_seed)
     and not exists (select 1 from ledger_entries le where le.account_id = ledger_accounts.id);
  delete from organizations where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('organizations', n);
  delete from auth.users where id = any(v_users);             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('demo_users', n);

  -- real customers' notifications that pointed at deleted demo orders / pools
  delete from notifications n2 where n2.link like '/account/orders/%'
     and not exists (select 1 from orders o where '/account/orders/' || o.id = n2.link);
  delete from notifications where link = '/account/pools' and org_id is not null
     and not exists (select 1 from pool_pledges p where p.org_id = notifications.org_id);

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
    select 'demo users' where exists (select 1 from auth.users where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com') union all
    select 'ledger not balanced' where coalesce((select sum(debit_cents - credit_cents) from ledger_entries), 0) <> 0 union all
    select 'wallet balance not zero' where exists (select 1 from wallets where balance_minor <> 0) union all
    select 'open pools' where exists (select 1 from pools where status in ('open', 'locked'))) x;
  if v_bad is not null then raise exception 'WIPE_VERIFY_FAILED: %', v_bad; end if;

  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (p_operator, 'demo_data_wiped', 'database', v_ref, jsonb_build_object('counts', v_counts, 'at', now()));
  insert into site_settings(key, value, description) values ('demo_wipe',
      jsonb_build_object('at', now(), 'by', p_operator, 'by_name', (select full_name from profiles where id = p_operator), 'counts', v_counts),
      'When the demo dataset was removed (ADDON-24). Drives the one-time "Add your first supplier" banner on /admin.')
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_counts;
end $$;
revoke execute on function wipe_demo_data(text, uuid) from public, anon, authenticated;

-- ───────── 3. merge two organizations (owner decision: duplicate "SOUTHFIELD BIOCHEM PVT LTD") ─────────
create or replace function merge_duplicate_org(p_keep uuid, p_drop uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; moved jsonb := '{}'; n bigint;
begin
  if p_keep = p_drop then raise exception 'MERGE_SAME_ORG'; end if;
  if not exists (select 1 from organizations where id = p_keep) then raise exception 'MERGE_KEEP_MISSING'; end if;
  if not exists (select 1 from organizations where id = p_drop) then return '{"already_merged": true}'; end if;
  if exists (select 1 from ledger_entries le join ledger_accounts la on la.id = le.account_id where la.org_id = p_drop) then
    raise exception 'MERGE_DROP_HAS_LEDGER: the duplicate company has money movements — merge by hand';
  end if;
  insert into org_members(org_id, user_id, member_role)
    select p_keep, user_id, member_role from org_members where org_id = p_drop
    on conflict do nothing;
  for t in select c.table_name from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
            where c.table_schema = 'public' and c.column_name = 'org_id' and x.table_type = 'BASE TABLE'
              and c.table_name not in ('org_members', 'ledger_accounts', 'ledger_entries', 'audit_log') loop
    execute format('update %I set org_id = $1 where org_id = $2', t.table_name) using p_keep, p_drop;
    get diagnostics n = row_count;
    if n > 0 then moved := moved || jsonb_build_object(t.table_name, n); end if;
  end loop;
  delete from org_members where org_id = p_drop;
  delete from ledger_accounts where org_id = p_drop;
  delete from organizations where id = p_drop;
  insert into audit_log(action, entity, entity_id, details)
    values ('organization.merged', 'organizations', p_keep::text, jsonb_build_object('dropped', p_drop, 'moved', moved));
  return moved;
end $$;
revoke execute on function merge_duplicate_org(uuid, uuid) from public, anon, authenticated;

-- ───────── 4. seed guard ─────────
insert into site_settings(key, value, description, is_public) values
  ('app_environment', '"production"'::jsonb, 'Environment of this database. "production" blocks supabase/seed.sql and the seed scripts (ADDON-24).', false)
on conflict (key) do update set value = excluded.value;

-- ───────── 5. dashboards ignore seed rows ─────────
do $$
declare def text; p text;
begin
  def := pg_get_functiondef('admin_revenue_by_stream(timestamptz,timestamptz)'::regprocedure);
  if position('not j.is_seed' in def) = 0 then
    p := replace(def, 'where (p_from is null or j.created_at >= p_from)', 'where not j.is_seed and (p_from is null or j.created_at >= p_from)');
    if p = def then raise exception 'ADDON-24 patch: admin_revenue_by_stream'; end if; execute p;
  end if;
  def := pg_get_functiondef('admin_geography()'::regprocedure);
  if position('not o.is_seed' in def) = 0 then
    p := replace(replace(def, 'from orders o where o.status <> ''cancelled''', 'from orders o where o.status <> ''cancelled'' and not o.is_seed'),
                 'where g.archived_at is null group by', 'where g.archived_at is null and not g.is_seed group by');
    if p = def then raise exception 'ADDON-24 patch: admin_geography'; end if; execute p;
  end if;
  def := pg_get_functiondef('admin_wallet_balances()'::regprocedure);
  if position('not o.is_seed' in def) = 0 then
    p := replace(def, 'where la.code like ''wallet:%''', 'where la.code like ''wallet:%'' and not o.is_seed');
    if p = def then raise exception 'ADDON-24 patch: admin_wallet_balances'; end if; execute p;
  end if;
end $$;
