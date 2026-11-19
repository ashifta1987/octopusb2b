-- Down for 20261101000195_customer_safe_reads.sql: back to the state after 194.

-- carrier settings
delete from site_settings where key in ('shipping.carrier_public_label', 'shipping.carrier_test_passed');

-- anon RPC execute (as before: PUBLIC + anon)
grant execute on function archive_supplier(uuid, text), delete_supplier(uuid, text), restore_supplier(uuid), supplier_delete_preview(uuid),
  confirm_hs_type(uuid), change_hs_type_heading(uuid, text), hs_type_change_preview(uuid, text) to public, anon;

-- view privileges as before
grant all on wallets, pool_pledge_mine_view, assistant_session_mine_view to anon, authenticated;
grant all on warehouse_shipments to authenticated;
revoke all on warehouse_shipments from anon;

drop function if exists portal_products();

-- my_notifications() returning whole rows again
drop function if exists my_notifications();
create function my_notifications() returns setof notifications
language sql stable security invoker set search_path = public as $$
  select * from notifications where user_id = auth.uid() or (user_id is null and org_id in (select my_org_ids()));
$$;
revoke execute on function my_notifications() from public, anon;
grant execute on function my_notifications() to authenticated;

-- assistant queue view: security invoker again
drop view if exists assistant_queue_view;
create view assistant_queue_view with (security_invoker = true) as
  select s.id as session_id, s.org_id, o.name as org_name, o.buyer_code, o.country, s.status, s.title, s.low_confidence_turns, s.last_message_at,
         am.staff_user_id as account_manager_id, e.id as escalation_id, e.reason, e.assigned_to, e.taken_by_staff_id, e.sla_due_at,
         e.requested_at, e.resolved_at, e.ticket_id, (am.staff_user_id = auth.uid()) as mine
    from assistant_sessions s
    join organizations o on o.id = s.org_id
    left join account_managers am on am.org_id = s.org_id
    left join escalations e on e.id = s.escalation_id;
grant all on assistant_queue_view to anon, authenticated;

-- import_product_row as in 159/181 (reads the hidden columns directly)
create or replace function import_product_row(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $function$
declare v_id uuid; v_img jsonb; v_cur text := coalesce(p->>'currency', 'USD'); v_min bigint;
begin
  select min((t->>'unit_price_cents')::bigint) into v_min from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;
  if (p->>'mode') = 'update' then
    update products set title = p->>'title', category_id = nullif(p->>'category_id','')::uuid, unit = coalesce(p->>'unit','pcs'),
      moq = coalesce((p->>'moq')::int, 1), lead_time_days = (p->>'lead_time_days')::int, incoterm = p->>'incoterm', origin_country = p->>'origin_country',
      hs_code = coalesce(nullif(btrim(p->>'hs_code'), ''), hs_code), hs_code_source = case when nullif(btrim(p->>'hs_code'), '') is not null and nullif(btrim(p->>'hs_code'), '') is distinct from hs_code then 'sheet' else hs_code_source end, currency = v_cur, octopus_dropship = coalesce((p->>'octopus_dropship')::boolean, false),
      ready_to_ship = coalesce((p->>'ready_to_ship')::boolean, false), description = p->>'description', min_price_cents = v_min
    where id = (p->>'product_id')::uuid and supplier_id = (p->>'supplier_id')::uuid
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
    delete from product_media where product_id = v_id and (sort = (v_img->>'position')::int or sha256 = v_img->>'sha256');
    insert into product_media(product_id, url, kind, sort, storage_path, source_file_name, sha256)
    values (v_id, v_img->>'url', 'image', (v_img->>'position')::int, v_img->>'storage_path', v_img->>'source_file_name', v_img->>'sha256');
  end loop;
  update products set image_url = (select url from product_media where product_id = v_id order by sort limit 1) where id = v_id;
  return v_id;
end $function$;
grant execute on function import_product_row(jsonb) to public, anon;

drop policy if exists costs_staff on product_costs;
create policy costs_staff on product_costs for all to authenticated
  using (can('finance', 'view') or is_my_supplier((select products.supplier_id from products where products.id = product_costs.product_id)))
  with check (product_editable(product_id));
drop function if exists product_is_my_supplier(uuid);

-- policies as before
drop policy if exists request_messages_read on request_messages;
create policy request_messages_read on request_messages for select
  using ((rfq_id is not null and request_visible('rfq', rfq_id)) or (service_request_id is not null and request_visible('service', service_request_id)));
drop policy if exists request_files_read on request_files;
create policy request_files_read on request_files for select
  using ((rfq_id is not null and request_visible('rfq', rfq_id)) or (service_request_id is not null and request_visible('service', service_request_id)));
drop view if exists public_ads;
create policy ads_public on ad_campaigns for select using (status = 'active');
drop policy if exists impr_read on ad_impressions;
create policy impr_read on ad_impressions for select to authenticated using (true);
drop policy if exists rp_read on role_permissions;
create policy rp_read on role_permissions for select to authenticated using (true);
drop policy if exists sla_read on sla_policies;
create policy sla_read on sla_policies for select using (true);
drop policy if exists areas_read on permission_areas;
create policy areas_read on permission_areas for select using (true);
drop policy if exists roles_read on roles;
create policy roles_read on roles for select using (true);
drop policy if exists carriers_read on carriers;
create policy carriers_read on carriers for select using (true);

-- pool participants as before (Customer ID, deposit, starter flag)
drop view if exists pool_public_view;
create view pool_public_view as
  select pl.pool_id, o.buyer_code, o.country, pl.qty, pl.status, pl.joined_at, pl.deposit_minor, pl.currency, (p.starter_org_id = pl.org_id) as is_starter
    from pool_pledges pl join organizations o on o.id = pl.org_id join pools p on p.id = pl.pool_id
   where pl.status = any (array['pending', 'paid', 'confirmed', 'shipped', 'delivered']::pledge_status[]);
revoke all on pool_public_view from public, anon, authenticated;
grant select, maintain on pool_public_view to anon, authenticated;

drop view if exists product_factory;
drop view if exists quote_factory;
drop view if exists order_factory;
grant all on product_images to anon, authenticated;
grant select, maintain on public_suppliers to anon, authenticated;

-- column grants back to table-level SELECT (shipments: the 177 column grants + division_id from 194)
do $$ declare t text; r text;
begin
  foreach t in array array['products','product_media','certificates','pools','pool_events','turnkey_equipment','turnkey_projects','turnkey_leads',
    'categories','tags','fx_rates','service_prices','terms_versions','site_settings','orders','quotes','documents','rfqs','service_requests','tickets',
    'ticket_messages','escalations','assistant_messages','assistant_sessions','account_managers','kyc_submissions','wallet_topups','wallet_credit_limits',
    'shipments','tracking_events','order_events','payments','proforma_invoices','pool_pledges','brand_projects','notifications','ledger_entries',
    'wallet_holds','organizations','profiles','turnkey_packages','ad_campaigns','ad_clicks','home_banners','site_media','pages',
    'content_blocks','company_bank_accounts','company_services','journals','webhook_deliveries'] loop
    foreach r in array array['anon', 'authenticated'] loop
      execute format('revoke select (%s) on public.%I from %I',
        (select string_agg(quote_ident(column_name), ', ') from information_schema.columns where table_schema = 'public' and table_name = t), t, r);
      execute format('grant select on public.%I to %I', t, r);
    end loop;
  end loop;
end $$;
revoke select on wallet_credit_limits, brand_projects from anon;
revoke select on shipments from authenticated;
grant select (id, code, order_id, org_id, service_code, tracking_no, label_url, status, weight_kg, parcels, rate_cents, eta, last_event_at,
  created_at, currency, trace_id, is_seed, division_id) on shipments to authenticated;

-- KYC: one review note again (customer messages are dropped; internal notes become the review note)
drop function if exists review_kyc(uuid, kyc_status, text, text);
alter table kyc_submissions drop column if exists customer_message;
alter table kyc_submissions rename column internal_note to review_note;
comment on column kyc_submissions.review_note is null;
create or replace function review_kyc(p_submission uuid, p_to kyc_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not can('customers','approve') then raise exception 'FORBIDDEN'; end if;
  select * into s from kyc_submissions where id = p_submission for update;
  if s is null then raise exception 'NOT_FOUND'; end if;
  if p_to not in ('in_review','verified','rejected','more_info') then raise exception 'KYC_INVALID_TRANSITION'; end if;
  if s.status in ('verified','rejected') then raise exception 'KYC_INVALID_TRANSITION: already %', s.status; end if;
  update kyc_submissions set status = p_to, reviewer_id = auth.uid(), review_note = p_note, reviewed_at = now() where id = p_submission;
  update organizations set kyc_status = p_to where id = s.org_id;
  perform log_status('kyc', p_submission, s.status::text, p_to::text, p_note);
  perform write_audit('kyc.review', 'kyc_submissions', p_submission::text, jsonb_build_object('to', p_to));
  perform emit_event('kyc.' || p_to, 'kyc', p_submission, jsonb_build_object('org_id', s.org_id));
end $$;
revoke all on function review_kyc(uuid, kyc_status, text) from public, anon;
grant execute on function review_kyc(uuid, kyc_status, text) to authenticated;
