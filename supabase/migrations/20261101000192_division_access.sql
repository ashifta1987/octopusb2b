-- Divisions step 3 (19 Nov 2026): access by division. Staff read and write only rows of their own divisions;
-- company-wide roles (admin, finance, support) see everything; customers keep seeing only their own rows across all
-- divisions; account managers keep their customers (all divisions); suppliers/distributors keep their supplier scope.
--  · ONE helper: in_division(division, roles) — security definer, fixed search_path.
--  · Policies: every staff permission check on a division table becomes "permission AND in_division(row division)";
--    child rows use their parent's division. Customer / account-manager / supplier branches are unchanged.
--  · Writes: one guard trigger on every division table, so security-definer RPCs (which bypass RLS) are covered too:
--    a staff caller must be in the row's division (or company-wide, the customer's account manager, or the supplier).
--  · 3PL warehouse: sees and updates the shipments of EVERY division through warehouse_shipments /
--    warehouse_update_shipment — pick/pack/ship fields only, never prices, payments or margins.
-- Down: supabase/migrations/down/20261101000192_division_access.down.sql

-- ───────── the one helper ─────────
create or replace function in_division(p_division uuid, p_roles text[] default null) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    -- company-wide roles: every division and the company-wide (empty-division) rows
    when exists (select 1 from user_roles where user_id = auth.uid() and role_code in ('admin', 'finance', 'support')) then staff_aal_ok()
    when p_division is null then false
    else staff_aal_ok() and exists (select 1 from division_members m where m.user_id = auth.uid() and m.division_id = p_division
                                    and (p_roles is null or m.role = any (p_roles)))
  end
$$;
revoke all on function in_division(uuid, text[]) from public, anon;
grant execute on function in_division(uuid, text[]) to authenticated, service_role;

-- indexes for the parent lookups used by the child-row checks
create index if not exists order_events_order_idx on order_events (order_id);
create index if not exists tracking_events_shipment_idx on tracking_events (shipment_id);
create index if not exists invoice_lines_document_idx on invoice_lines (document_id);
create index if not exists request_messages_rfq_idx on request_messages (rfq_id);
create index if not exists request_messages_sr_idx on request_messages (service_request_id);
create index if not exists request_files_rfq_idx on request_files (rfq_id);
create index if not exists request_files_sr_idx on request_files (service_request_id);
create index if not exists pool_events_pool_idx on pool_events (pool_id);
create index if not exists turnkey_packages_project_idx on turnkey_packages (project_id);
create index if not exists turnkey_project_sources_project_idx on turnkey_project_sources (project_id);
create index if not exists turnkey_atlas_signals_project_idx on turnkey_atlas_signals (project_id);
create index if not exists division_members_user_idx on division_members (user_id);

-- ───────── policies: permission → permission AND in_division(row's division) ─────────
do $$
declare
  t record; p record; q text; w text; expr text;
  rewrite text := $r$(\& AND in_division(%s))$r$;
begin
  for t in select * from (values
      ('service_requests', 'division_id'), ('rfqs', 'division_id'), ('quotes', 'division_id'), ('orders', 'division_id'),
      ('proforma_invoices', 'division_id'), ('payments', 'division_id'), ('shipments', 'division_id'), ('documents', 'division_id'),
      ('brand_projects', 'division_id'), ('pools', 'division_id'), ('pool_pledges', 'division_id'), ('turnkey_projects', 'division_id'),
      ('turnkey_leads', 'division_id'), ('company_services', 'division_id'), ('wallet_holds', 'division_id'), ('journals', 'division_id'),
      ('ledger_entries', 'division_id'), ('audit_log', 'division_id'),
      -- child rows: the parent's division
      ('order_events', '(select o.division_id from orders o where o.id = order_events.order_id)'),
      ('tracking_events', '(select s.division_id from shipments s where s.id = tracking_events.shipment_id)'),
      ('invoice_lines', 'd.division_id'),            -- its policy already looks the document up as "d"
      ('turnkey_packages', '(select tp.division_id from turnkey_projects tp where tp.project_id = turnkey_packages.project_id)'),
      ('turnkey_project_sources', '(select tp.division_id from turnkey_projects tp where tp.project_id = turnkey_project_sources.project_id)'),
      ('turnkey_atlas_signals', '(select tp.division_id from turnkey_projects tp where tp.project_id = turnkey_atlas_signals.project_id)')
    ) v(tbl, div) loop
    for p in select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = t.tbl loop
      q := p.qual; w := p.with_check;
      expr := t.div;
      q := regexp_replace(q, $x$can\('[a-z_]+'::text, '[a-z_]+'::text\)$x$, format(rewrite, expr), 'g');
      w := regexp_replace(w, $x$can\('[a-z_]+'::text, '[a-z_]+'::text\)$x$, format(rewrite, expr), 'g');
      -- staff with customer access: only their divisions; account managers keep their own customers (all divisions)
      q := regexp_replace(q, $x$staff_sees_org\(org_id\)$x$, format('(staff_sees_org(org_id) AND (is_my_customer(org_id) OR in_division(%s)))', expr), 'g');
      -- assistant staff (support = company-wide; others only their divisions)
      if t.tbl <> 'quotes' then
        q := regexp_replace(q, $x$assistant_staff_can\(org_id\)$x$, format('(assistant_staff_can(org_id) AND in_division(%s))', expr), 'g');
      else
        q := regexp_replace(q, $x$assistant_staff_can\(r\.org_id\)$x$, 'assistant_staff_can(r.org_id) AND in_division(quotes.division_id)', 'g');
      end if;
      if q is distinct from p.qual and q is not null then execute format('alter policy %I on %I using (%s)', p.policyname, t.tbl, q); end if;
      if w is distinct from p.with_check and w is not null then execute format('alter policy %I on %I with check (%s)', p.policyname, t.tbl, w); end if;
    end loop;
  end loop;
end $$;

-- request files / messages (children of RFQs and service requests) read through request_visible()
create or replace function request_visible(p_kind text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'rfq' then exists (select 1 from rfqs where id = p_id and (org_id in (select my_org_ids()) or (can('requests', 'view') and in_division(division_id))))
    when 'service' then exists (select 1 from service_requests where id = p_id and (org_id in (select my_org_ids())
                                or ((can('requests', 'view') or can('services_ops', 'view')) and in_division(division_id))))
    else false end;
$$;

-- Admin › Brand projects (security definer): only projects the caller may see by division (account managers: their customers)
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
   where is_staff() and staff_sees_org(b.org_id) and (is_my_customer(b.org_id) or in_division(b.division_id))
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
   where b.id = p_id and is_staff() and staff_sees_org(b.org_id) and (is_my_customer(b.org_id) or in_division(b.division_id))
   order by a.created_at desc;
$$;

-- ───────── writes: one guard on every division table (covers RLS and security-definer RPCs) ─────────
create or replace function division_write_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old)); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
        v_div uuid := nullif(r ->> 'division_id', '')::uuid; v_org uuid := nullif(r ->> 'org_id', '')::uuid;
        v_sup uuid := nullif(r ->> 'supplier_id', '')::uuid;
        pick_pack text[] := array['status', 'tracking_no', 'carrier_code', 'label_url', 'weight_kg', 'parcels', 'eta', 'last_event_at'];
begin
  -- system / service-role work, and customers acting on their own rows through the business RPCs, are not staff
  if auth.uid() is null or not user_is_staff(auth.uid()) then return coalesce(new, old); end if;
  if in_division(v_div) then return coalesce(new, old); end if;
  if v_org is not null and is_my_customer(v_org) then return coalesce(new, old); end if;          -- account manager
  if v_sup is not null and is_my_supplier(v_sup) then return coalesce(new, old); end if;          -- supplier / distributor
  -- the 3PL warehouse packs every division's shipments: pick/pack/ship fields only
  if tg_table_name = 'shipments' and tg_op = 'UPDATE' and in_division(division_id_of('3PL'), array['warehouse', 'manager'])
     and (to_jsonb(new) - pick_pack) = (o - pick_pack) then return new; end if;
  raise exception 'FORBIDDEN_DIVISION: this % belongs to another division', regexp_replace(replace(tg_table_name, '_', ' '), 's$', '');
end $$;
do $$ declare t text;
begin
  foreach t in array array['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments',
    'documents', 'brand_projects', 'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products',
    'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds'] loop
    execute format('drop trigger if exists trg_zz_division_guard on %I', t);
    -- named to run after trg_set_division (BEFORE triggers fire in name order), so new rows already carry their division
    execute format('create trigger trg_zz_division_guard before insert or update or delete on %I for each row execute function division_write_guard()', t);
  end loop;
end $$;

-- ───────── 3PL warehouse: every division's shipments, pick/pack/ship fields only ─────────
create or replace view warehouse_shipments with (security_barrier = true) as
  select s.id, s.code, d.code as division, o.code as order_code, o.title as items, o.quantity,
         a.line1 as address_line1, a.line2 as address_line2, a.city, a.region, a.postal_code, a.country,
         s.carrier_code, s.tracking_no, s.label_url, s.status, s.weight_kg, s.parcels, s.eta, s.last_event_at, s.created_at
    from shipments s
    join divisions d on d.id = s.division_id
    join orders o on o.id = s.order_id
    left join lateral (select line1, line2, city, region, postal_code, country from addresses ad
                        where ad.org_id = s.org_id order by ad.is_default desc, ad.created_at limit 1) a on true
   where in_division(division_id_of('3PL'), array['warehouse', 'manager']) or in_division(s.division_id);
revoke all on warehouse_shipments from anon;
grant select on warehouse_shipments to authenticated;

create or replace function warehouse_update_shipment(p_id uuid, p_status shipment_status default null, p_tracking_no text default null,
                                                     p_carrier_code text default null, p_weight_kg numeric default null, p_parcels int default null)
returns void language plpgsql security definer set search_path = public as $$
declare s shipments;
begin
  if not in_division(division_id_of('3PL'), array['warehouse', 'manager']) then raise exception 'FORBIDDEN: 3PL warehouse only'; end if;
  select * into s from shipments where id = p_id for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  update shipments set status = coalesce(p_status, status), tracking_no = coalesce(nullif(btrim(p_tracking_no), ''), tracking_no),
         carrier_code = coalesce(nullif(btrim(p_carrier_code), ''), carrier_code), weight_kg = coalesce(p_weight_kg, weight_kg),
         parcels = coalesce(p_parcels, parcels), last_event_at = now()
   where id = p_id;
  perform audit('shipment.warehouse_update', s.org_id, 'warehouse', 'shipment', s.code,
                jsonb_build_object('status', s.status, 'tracking_no', s.tracking_no),
                jsonb_build_object('status', coalesce(p_status, s.status), 'tracking_no', coalesce(p_tracking_no, s.tracking_no)));
end $$;
revoke all on function warehouse_update_shipment(uuid, shipment_status, text, text, numeric, int) from public, anon;
grant execute on function warehouse_update_shipment(uuid, shipment_status, text, text, numeric, int) to authenticated;
