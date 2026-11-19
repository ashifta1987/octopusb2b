-- Customer-safe reads (19 Nov 2026). Customers and the public key (anon) must not be able to read internal columns,
-- not even by calling the API directly. Rule: internal by default — if unsure, hide it from customers.
--  1. Column grants: the internal columns listed in scripts/hidden-columns.mjs lose SELECT for anon and authenticated
--     (rows stay governed by RLS as before). Staff screens read them with the server admin client after their own
--     permission check (same pattern as the hidden carrier in 177).
--  2. Supplier identity: buyers never see the supplier id or code. public_suppliers is no longer readable by anon /
--     signed-in users; buyers get only "Verified factory · China (province)" through product_factory / quote_factory /
--     order_factory (no supplier id, no code).
--  3. Pools: other buyers' Customer IDs are hidden — pool_public_view shows country + quantity; a buyer's own Customer
--     ID only on their own pledge (is_mine).
--  4. Carriers, roles, permission areas, role permissions and SLA policies: staff only. Ad impressions: the
--     advertiser's own campaigns (or ads staff). Active ads for the public come from public_ads (no budgets/bids).
--  5. KYC: review_note → internal_note (staff only; existing notes move there and are not shown to customers) +
--     customer_message (shown to the customer, required when rejecting).
--  6. Functions that read hidden columns as the caller are rewritten (product_costs policy, import_product_row);
--     the staff assistant queue view runs as its owner with an explicit staff filter.
--  7. Defence in depth: anon may not execute admin RPCs.
-- Down: supabase/migrations/down/20261101000195_customer_safe_reads.down.sql

-- ───────── 5. KYC note split (before the column grants, so the new columns are covered) ─────────
alter table kyc_submissions rename column review_note to internal_note;
alter table kyc_submissions add column if not exists customer_message text;
comment on column kyc_submissions.internal_note is 'Staff only. Never shown to the customer.';
comment on column kyc_submissions.customer_message is 'Shown to the customer. Required when rejecting.';

drop function if exists review_kyc(uuid, kyc_status, text);
create or replace function review_kyc(p_submission uuid, p_to kyc_status, p_note text default null, p_customer_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_msg text := nullif(btrim(coalesce(p_customer_message, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not can('customers','approve') then raise exception 'FORBIDDEN'; end if;
  select * into s from kyc_submissions where id = p_submission for update;
  if s is null then raise exception 'NOT_FOUND'; end if;
  if p_to not in ('in_review','verified','rejected','more_info') then raise exception 'KYC_INVALID_TRANSITION'; end if;
  if s.status in ('verified','rejected') then raise exception 'KYC_INVALID_TRANSITION: already %', s.status; end if;
  if p_to = 'rejected' and v_msg is null then raise exception 'KYC_MESSAGE_REQUIRED: write a message to the customer when rejecting'; end if;
  update kyc_submissions set status = p_to, reviewer_id = auth.uid(), internal_note = v_note, customer_message = v_msg, reviewed_at = now()
   where id = p_submission;
  update organizations set kyc_status = p_to where id = s.org_id;
  perform log_status('kyc', p_submission, s.status::text, p_to::text, v_note);
  perform write_audit('kyc.review', 'kyc_submissions', p_submission::text, jsonb_build_object('to', p_to));
  perform emit_event('kyc.' || p_to, 'kyc', p_submission, jsonb_build_object('org_id', s.org_id));
end $$;
revoke all on function review_kyc(uuid, kyc_status, text, text) from public, anon;
grant execute on function review_kyc(uuid, kyc_status, text, text) to authenticated;

-- ───────── 1. column grants ─────────
create or replace function _apply_hidden_columns(p_map jsonb) returns void language plpgsql as $$
declare t text; r text; cols text; hidden text[];
begin
  for t in select jsonb_object_keys(p_map) loop
    hidden := array(select jsonb_array_elements_text(p_map -> t));
    foreach r in array array['anon', 'authenticated'] loop
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
        from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name <> all (hidden)
         and (has_table_privilege(r, format('public.%I', t), 'SELECT') or has_column_privilege(r, format('public.%I', t), c.column_name, 'SELECT'));
      if has_table_privilege(r, format('public.%I', t), 'SELECT') or cols is not null then
        execute format('revoke select on public.%I from %I', t, r);
        execute format('revoke select (%s) on public.%I from %I',
          (select string_agg(quote_ident(column_name), ', ') from information_schema.columns where table_schema = 'public' and table_name = t), t, r);
        if cols is not null then execute format('grant select (%s) on public.%I to %I', cols, t, r); end if;
      end if;
    end loop;
  end loop;
end $$;
select _apply_hidden_columns('{
    "products": ["supplier_id","rejection_reason","created_by","is_seed","external_id","factory_model","specification_raw","selling_points_raw","size_notes","import_notes","markup_pct","sell_price_mode","sku_norm","listing_status","moderation_hold","moderation_hold_reason","hs_code_source","hs_code_confidence","hs_code_status","hs_product_type_id","hs_classify_pending","hs_code_note","archived_by_supplier_from"],
    "product_media": ["storage_path","source_file_name","sha256"],
    "certificates": ["supplier_id","number","storage_path"],
    "pools": ["supplier_id","starter_user_id","starter_org_id","po_document_id","trace_id","is_seed"],
    "pool_events": ["title","body","trace_id"],
    "turnkey_equipment": ["supplier_id","supplier_hint","notes"],
    "turnkey_projects": ["is_seed"],
    "turnkey_leads": ["assigned_to","assigned_at","floor_plan_storage_path","is_seed"],
    "turnkey_packages": ["starting_budget_notes"],
    "ad_campaigns": ["is_seed"],
    "ad_clicks": ["trace_id"],
    "home_banners": ["updated_by"],
    "site_media": ["updated_by"],
    "pages": ["updated_by"],
    "content_blocks": ["updated_by"],
    "company_bank_accounts": ["updated_by"],
    "company_services": ["updated_by"],
    "categories": ["is_seed"],
    "tags": ["is_seed"],
    "fx_rates": ["set_by","note","source"],
    "service_prices": ["created_by"],
    "terms_versions": ["created_by","reviewed_by"],
    "site_settings": ["updated_by"],
    "orders": ["supplier_id","trace_id","is_seed"],
    "quotes": ["supplier_id","created_by","trace_id","is_seed"],
    "documents": ["supplier_id","emailed_at","trace_id","is_seed"],
    "rfqs": ["assigned_to","trace_id","is_seed"],
    "service_requests": ["assigned_to","trace_id","is_seed","idempotency_key"],
    "tickets": ["assigned_to","trace_id","is_seed"],
    "ticket_messages": ["trace_id"],
    "escalations": ["reason","confidence","excerpt","assigned_to","taken_by_staff_id","outcome","trace_id"],
    "assistant_messages": ["confidence","tools_called","tokens","latency_ms","trace_id","is_seed"],
    "assistant_sessions": ["is_seed"],
    "account_managers": ["reason","assigned_by","trace_id"],
    "kyc_submissions": ["reviewer_id","internal_note","trace_id"],
    "wallet_topups": ["confirmed_by","received_note","trace_id","is_seed"],
    "wallet_credit_limits": ["note","set_by"],
    "shipments": ["carrier_code","trace_id","is_seed"],
    "tracking_events": ["provider_event_id","trace_id"],
    "order_events": ["created_by","trace_id"],
    "payments": ["matched_by","provider_event_id","trace_id","is_seed"],
    "proforma_invoices": ["trace_id","is_seed"],
    "pool_pledges": ["trace_id","is_seed"],
    "brand_projects": ["admin_emailed_at"],
    "notifications": ["trace_id","dedupe_key"],
    "ledger_entries": ["trace_id","is_seed"],
    "journals": ["created_by","trace_id","is_seed"],
    "webhook_deliveries": ["trace_id"],
    "wallet_holds": ["created_by"],
    "organizations": ["is_seed"],
    "profiles": ["invited_by"]
}'::jsonb);
drop function _apply_hidden_columns(jsonb);

-- ───────── 2. supplier identity: buyers see only "Verified factory · China (province)" ─────────
revoke all on public_suppliers from anon, authenticated;
revoke all on product_images from anon, authenticated;   -- exposes storage paths / original file names; unused by the app

create or replace view product_factory with (security_barrier = true) as
  select p.id as product_id,
         (s.verified and coalesce(s.identity_status, 'ok') = 'ok' and s.archived_at is null) as verified,
         s.country, s.province
    from products p join suppliers s on s.id = p.supplier_id
   where product_visible(p.id);
create or replace view quote_factory with (security_barrier = true) as
  select q.id as quote_id,
         (s.verified and coalesce(s.identity_status, 'ok') = 'ok' and s.archived_at is null) as verified,
         s.country, s.province
    from quotes q join suppliers s on s.id = q.supplier_id
   where rfq_in_my_org(q.rfq_id) or can('requests', 'view');
create or replace view order_factory with (security_barrier = true) as
  select o.id as order_id,
         (s.verified and coalesce(s.identity_status, 'ok') = 'ok' and s.archived_at is null) as verified,
         s.country, s.province
    from orders o join suppliers s on s.id = o.supplier_id
   where o.org_id in (select my_org_ids()) or can('orders', 'view');
revoke all on product_factory, quote_factory, order_factory from public, anon, authenticated;
grant select on product_factory to anon, authenticated;
grant select on quote_factory, order_factory to authenticated;

-- ───────── 3. pools: no other buyer's Customer ID ─────────
drop view if exists pool_public_view;
create view pool_public_view with (security_barrier = true) as
  select pl.pool_id, o.country, pl.qty, pl.status, pl.joined_at,
         (pl.org_id in (select my_org_ids())) as is_mine,
         case when pl.org_id in (select my_org_ids()) then o.buyer_code end as buyer_code
    from pool_pledges pl join organizations o on o.id = pl.org_id
   where pl.status = any (array['pending', 'paid', 'confirmed', 'shipped', 'delivered']::pledge_status[]);
revoke all on pool_public_view from public, anon, authenticated;
grant select on pool_public_view to anon, authenticated;

-- pool timeline: the raw event texts contain buyer Customer IDs (BUYER-####), so title/body are hidden and the public
-- reads this view instead (same visibility as the pool_events policy; buyer codes replaced by "A buyer")
create or replace view pool_public_events with (security_barrier = true) as
  select e.id, e.pool_id, e.kind,
         regexp_replace(e.title, 'BUYER-[0-9]+', 'A buyer', 'gi') as title,
         case e.kind when 'joined' then case when e.qty is null then 'A buyer joined' else 'A buyer pledged ' || abs(e.qty) end
                     when 'withdrawn' then case when e.qty is null then 'A buyer withdrew' else 'A buyer withdrew ' || abs(e.qty) end
                     when 'defaulted' then 'Deposit applied to shortfall'
                     else regexp_replace(e.body, 'BUYER-[0-9]+', 'A buyer', 'gi') end as body,
         e.qty, e.created_at
    from pool_events e
   where exists (select 1 from pools p where p.id = e.pool_id
                   and (p.status = any (array['open', 'locked', 'confirmed', 'shipped', 'completed']::pool_status[])
                        or (can('orders', 'view') and in_division(p.division_id)) or p.starter_org_id in (select my_org_ids())));
revoke all on pool_public_events from public, anon, authenticated;
grant select on pool_public_events to anon, authenticated;

-- ───────── 4. staff-only set-up tables; advertiser-only impressions; public ads without budgets ─────────
drop policy if exists carriers_read on carriers;
create policy carriers_read on carriers for select to authenticated using (is_staff());
drop policy if exists roles_read on roles;
create policy roles_read on roles for select to authenticated using (is_staff());
drop policy if exists areas_read on permission_areas;
create policy areas_read on permission_areas for select to authenticated using (is_staff());
drop policy if exists sla_read on sla_policies;
create policy sla_read on sla_policies for select to authenticated using (is_staff());
drop policy if exists rp_read on role_permissions;
create policy rp_read on role_permissions for select to authenticated using (is_staff());
drop policy if exists impr_read on ad_impressions;
create policy impr_read on ad_impressions for select to authenticated
  using (can('ads', 'view') or exists (select 1 from ad_campaigns c where c.id = ad_impressions.campaign_id and c.org_id in (select my_org_ids())));
drop policy if exists ads_public on ad_campaigns;
create or replace view public_ads with (security_barrier = true) as
  select id, placement, headline, body, link, image_url, target_categories, target_countries
    from ad_campaigns where status = 'active';
-- read only: a simple view is auto-updatable, so every other privilege is revoked (new views get them by default)
revoke all on public_ads from public, anon, authenticated;
grant select on public_ads to anon, authenticated;
drop policy if exists request_files_read on request_files;
create policy request_files_read on request_files for select to authenticated
  using ((rfq_id is not null and request_visible('rfq', rfq_id)) or (service_request_id is not null and request_visible('service', service_request_id)));
drop policy if exists request_messages_read on request_messages;
create policy request_messages_read on request_messages for select to authenticated
  using ((rfq_id is not null and request_visible('rfq', rfq_id)) or (service_request_id is not null and request_visible('service', service_request_id)));

-- ───────── 6. code that read hidden columns as the caller ─────────
create or replace function product_is_my_supplier(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from products p where p.id = p_product and is_my_supplier(p.supplier_id))
$$;
revoke all on function product_is_my_supplier(uuid) from public, anon;
grant execute on function product_is_my_supplier(uuid) to authenticated, service_role;
drop policy if exists costs_staff on product_costs;
create policy costs_staff on product_costs for all to authenticated
  using (can('finance', 'view') or product_is_my_supplier(product_id)) with check (product_editable(product_id));

-- import_product_row reads hidden columns (supplier_id, hs_code_source, sha256) while it writes, which the caller's
-- role may no longer do. It now runs as its owner and checks exactly what the RLS policies checked before:
--  · update: the caller may edit the product (product_editable) and it belongs to the given supplier
--  · insert: products_ins (can create; a distributor only for its own suppliers; the supplier's upload switch is on)
create or replace function import_product_row(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $function$
declare v_id uuid; v_img jsonb; v_cur text := coalesce(p->>'currency', 'USD'); v_min bigint; v_sup uuid := (p->>'supplier_id')::uuid;
begin
  -- trusted callers (service role, or a direct database session without API claims) skip the checks, as RLS did
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif auth.uid() is null then raise exception 'FORBIDDEN';
  elsif (p->>'mode') = 'update' then
    if not product_editable((p->>'product_id')::uuid) then raise exception 'NOT_EDITABLE: You cannot edit this product.'; end if;
  elsif not (can('products', 'create') and (is_admin() or not has_role('distributor') or is_my_supplier(v_sup))
             and coalesce((select product_upload from supplier_switches where supplier_id = v_sup), true)) then
    raise exception 'new row violates row-level security policy for table "products"' using errcode = '42501';
  end if;
  select min((t->>'unit_price_cents')::bigint) into v_min from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;
  if (p->>'mode') = 'update' then
    update products set title = p->>'title', category_id = nullif(p->>'category_id','')::uuid, unit = coalesce(p->>'unit','pcs'),
      moq = coalesce((p->>'moq')::int, 1), lead_time_days = (p->>'lead_time_days')::int, incoterm = p->>'incoterm', origin_country = p->>'origin_country',
      hs_code = coalesce(nullif(btrim(p->>'hs_code'), ''), hs_code), hs_code_source = case when nullif(btrim(p->>'hs_code'), '') is not null and nullif(btrim(p->>'hs_code'), '') is distinct from hs_code then 'sheet' else hs_code_source end, currency = v_cur, octopus_dropship = coalesce((p->>'octopus_dropship')::boolean, false),
      ready_to_ship = coalesce((p->>'ready_to_ship')::boolean, false), description = p->>'description', min_price_cents = v_min
    where id = (p->>'product_id')::uuid and supplier_id = v_sup
    returning id into v_id;
    if v_id is null then raise exception 'NOT_EDITABLE: You cannot edit this product.'; end if;
  else
    insert into products(external_id, slug, title, description, supplier_id, category_id, status, unit, moq, lead_time_days, incoterm,
      origin_country, hs_code, hs_code_source, octopus_dropship, ready_to_ship, currency, min_price_cents, created_by, seo_title)
    values (p->>'sku', p->>'slug', p->>'title', p->>'description', (p->>'supplier_id')::uuid, nullif(p->>'category_id','')::uuid, 'draft',
      coalesce(p->>'unit','pcs'), coalesce((p->>'moq')::int, 1), (p->>'lead_time_days')::int, p->>'incoterm', p->>'origin_country', nullif(btrim(p->>'hs_code'), ''), case when nullif(btrim(p->>'hs_code'), '') is not null then 'sheet' end,
      coalesce((p->>'octopus_dropship')::boolean, false), coalesce((p->>'ready_to_ship')::boolean, false), v_cur, v_min, auth.uid(),
      left(p->>'title' || ' | Wholesale', 60))
    returning id into v_id;
  end if;
  delete from price_tiers where product_id = v_id;
  insert into price_tiers(product_id, min_qty, unit_price_cents, currency)
  select v_id, (t->>'min_qty')::int, (t->>'unit_price_cents')::bigint, v_cur from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;
  for v_img in select * from jsonb_array_elements(coalesce(p->'images', '[]')) loop
    delete from product_media where product_id = v_id
      and (sort = (v_img->>'position')::int or sha256 = v_img->>'sha256');
    insert into product_media(product_id, url, kind, sort, storage_path, source_file_name, sha256)
    values (v_id, v_img->>'url', 'image', (v_img->>'position')::int, v_img->>'storage_path', v_img->>'source_file_name', v_img->>'sha256');
  end loop;
  update products set image_url = (select url from product_media where product_id = v_id order by sort limit 1) where id = v_id;
  return v_id;
end $function$;
revoke all on function import_product_row(jsonb) from public, anon;
grant execute on function import_product_row(jsonb) to authenticated, service_role;

-- Staff, suppliers and distributors still need the internal product columns. portal_products() returns whole product
-- rows, but ONLY the rows the products_staff policy gives the caller (staff with products:view, or the caller's own /
-- assigned suppliers) — customers and the public key get no rows. Use like a table: rpc('portal_products').select(…).eq(…)
create or replace function portal_products() returns setof products
language sql stable security definer set search_path = public as $$
  select p.* from products p where can('products', 'view') or is_my_supplier(p.supplier_id)
$$;
revoke all on function portal_products() from public, anon;
grant execute on function portal_products() to authenticated, service_role;

-- my_notifications() returned whole notification rows (incl. trace_id / dedupe_key): now the customer-safe columns only
drop function if exists my_notifications();
create function my_notifications()
returns table(id uuid, user_id uuid, org_id uuid, title text, body text, link text, read_at timestamptz, created_at timestamptz, service text, division_id uuid)
language sql stable security invoker set search_path = public as $$
  select n.id, n.user_id, n.org_id, n.title, n.body, n.link, n.read_at, n.created_at, n.service, n.division_id
    from notifications n where n.user_id = auth.uid() or (n.user_id is null and n.org_id in (select my_org_ids()));
$$;
revoke execute on function my_notifications() from public, anon;
grant execute on function my_notifications() to authenticated;

-- the staff assistant queue reads internal escalation / account-manager columns: run as owner, staff filter explicit
alter view assistant_queue_view set (security_invoker = false);
create or replace view assistant_queue_view with (security_barrier = true) as
  select s.id as session_id, s.org_id, o.name as org_name, o.buyer_code, o.country, s.status, s.title, s.low_confidence_turns, s.last_message_at,
         am.staff_user_id as account_manager_id, e.id as escalation_id, e.reason, e.assigned_to, e.taken_by_staff_id, e.sla_due_at,
         e.requested_at, e.resolved_at, e.ticket_id, (am.staff_user_id = auth.uid()) as mine
    from assistant_sessions s
    join organizations o on o.id = s.org_id
    left join account_managers am on am.org_id = s.org_id
    left join escalations e on e.id = s.escalation_id
   where assistant_staff_can(s.org_id);
revoke all on assistant_queue_view from public, anon, authenticated;
grant select on assistant_queue_view to authenticated;

-- every other view: read only, and nothing for the public key (they all serve signed-in users)
revoke all on wallets, pool_pledge_mine_view, assistant_session_mine_view, warehouse_shipments from public, anon, authenticated;
grant select on wallets, pool_pledge_mine_view, assistant_session_mine_view, warehouse_shipments to authenticated;

-- ───────── 7. anon may not execute admin RPCs (they already refuse; defence in depth) ─────────
revoke execute on function archive_supplier(uuid, text), delete_supplier(uuid, text), restore_supplier(uuid), supplier_delete_preview(uuid),
  confirm_hs_type(uuid), change_hs_type_heading(uuid, text), hs_type_change_preview(uuid, text) from public, anon;
grant execute on function archive_supplier(uuid, text), delete_supplier(uuid, text), restore_supplier(uuid), supplier_delete_preview(uuid),
  confirm_hs_type(uuid), change_hs_type_heading(uuid, text), hs_type_change_preview(uuid, text) to authenticated;

-- ───────── carrier shown to customers ─────────
-- Customers never see the carrier list. A shipment shows "YunExpress network" only once an admin has recorded that
-- a test shipment passed (shipping.carrier_test_passed = true); until then it shows "Octopus B2B shipping".
insert into site_settings(key, value, description, is_public) values
  ('shipping.carrier_public_label', '"YunExpress network"', 'Carrier name customers see on their shipments (only once the test shipment has passed).', true),
  ('shipping.carrier_test_passed', 'false', 'Set to true by an admin once a test shipment with the carrier has passed.', true)
on conflict (key) do nothing;
