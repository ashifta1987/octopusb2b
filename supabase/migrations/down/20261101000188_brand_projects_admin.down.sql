-- DOWN for 20261101000188_brand_projects_admin.sql — restores create_brand_project() from migration 184 and removes the
-- staff functions and the three added columns. Then: delete from _migrations where name = '20261101000188_brand_projects_admin.sql';
drop function if exists brand_project_history(uuid);
drop function if exists admin_brand_projects(uuid, text);
drop function if exists set_brand_project_status(uuid, text, text);
drop function if exists brand_project_paid(uuid);

create or replace function create_brand_project(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := my_org_id();
  v_product uuid := nullif(p->>'product_id', '')::uuid;
  v_ref text; v_id uuid; v_logos text[]; v_title text; v_notified int := 0;
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_A_CUSTOMER'; end if;
  if v_product is not null then
    select p2.title into v_title from products p2 join suppliers s on s.id = p2.supplier_id
     where p2.id = v_product and p2.status = 'live' and s.verified and s.archived_at is null;
    if v_title is null then raise exception 'PRODUCT_NOT_VERIFIED'; end if;
  elsif coalesce(btrim(p->>'product_link'), '') = '' then
    raise exception 'PRODUCT_REQUIRED';
  end if;
  select coalesce(array_agg(x), '{}') into v_logos from jsonb_array_elements_text(coalesce(p->'logo_paths', '[]')) x;
  if exists (select 1 from unnest(v_logos) l where split_part(l, '/', 1) <> v_org::text) then raise exception 'BAD_LOGO_PATH'; end if;
  if (p->>'stock_destination') = 'bulk' and coalesce(p->>'bulk_country', '') !~ '^[A-Z]{2}$' then raise exception 'BULK_COUNTRY_REQUIRED'; end if;

  v_ref := 'MB-' || lpad(nextval('brand_project_seq')::text, 4, '0');
  insert into brand_projects(ref, org_id, created_by, product_id, product_link, quantity, markets, method, packaging, colours, logo_paths, stock_destination, bulk_country, stores, note)
  values (v_ref, v_org, auth.uid(), v_product, nullif(left(btrim(p->>'product_link'), 500), ''), nullif(p->>'quantity', '')::int,
          coalesce((select array_agg(left(x, 2)) from jsonb_array_elements_text(coalesce(p->'markets', '[]')) x), '{}'),
          nullif(p->>'method', ''), nullif(p->>'packaging', ''), nullif(left(btrim(p->>'colours'), 300), ''), v_logos,
          nullif(p->>'stock_destination', ''), nullif(p->>'bulk_country', ''),
          coalesce((select array_agg(left(x, 30)) from jsonb_array_elements_text(coalesce(p->'stores', '[]')) x), '{}'),
          nullif(left(btrim(p->>'note'), 2000), ''))
  returning id into v_id;

  perform audit('brand_project.created', v_org, 'brand', 'brand_project', v_ref, null,
                jsonb_build_object('product_id', v_product, 'method', p->>'method', 'quantity', p->>'quantity', 'logos', coalesce(array_length(v_logos, 1), 0)));

  -- tell the customer's primary account manager; no manager yet → every admin
  insert into notifications(user_id, org_id, title, body, link, service)
  select u, v_org, 'New Make My Brand request ' || v_ref,
         coalesce(v_title, 'Product link') || coalesce(' · ' || (p->>'quantity') || ' units', ''), '/admin/customers/' || v_org, 'brand'
  from (select am.staff_user_id u from account_managers am where am.org_id = v_org and am.is_primary
        union select ur.user_id from user_roles ur where ur.role_code = 'admin'
              and not exists (select 1 from account_managers am2 where am2.org_id = v_org and am2.is_primary)) t;
  get diagnostics v_notified = row_count;

  return jsonb_build_object('id', v_id, 'ref', v_ref, 'notified', v_notified);
end $$;
revoke all on function create_brand_project(jsonb) from public, anon;
grant execute on function create_brand_project(jsonb) to authenticated;

alter table brand_projects drop column if exists admin_emailed_at;
alter table brand_projects drop column if exists status_changed_at;
alter table brand_projects drop column if exists closed_from;
