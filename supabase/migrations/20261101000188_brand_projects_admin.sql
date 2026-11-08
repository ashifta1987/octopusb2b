-- Bug 2 (8 Nov 2026): Make My Brand requests reach Admin.
-- Root cause: brand_projects was saved correctly, but no Admin screen read it, the Admin alert went into a notification
-- inbox that Admin never showed (and also carried the customer's org_id, so it leaked into the customer's own list),
-- and the customer got no "received" notification. Staff could not change a project's status.
--  · create_brand_project(): staff-only alert (user_id, no org_id) "New brand project MB-… [— needs an account manager]"
--    linking to /admin/brand-projects/<id>; customer notification "Brand project received · MB-…"; both idempotent
--    (dedupe_key from migration 187). Validation, numbering and audit unchanged.
--  · Account manager stays PER CUSTOMER (account_managers.is_primary) — shown on the project, never stored on it.
--  · set_brand_project_status(): staff move a project through the existing statuses; "closed" from any step needs an
--    internal reason; if anything was paid on the project only the admin role may close (warning returned, no refund);
--    reopen = admin only, back to the step it was closed from. Every change → audit_log (who, when, from → to, reason).
--    The customer is told "Brand project MB-… closed"; the internal reason is never stored where customers can read it.
--  · admin_brand_projects(): staff list/detail (company, product, account manager or Unassigned), RLS-equivalent scope.
-- Existing projects (MB-0001, MB-0002, …) are not changed; they appear in Admin because Admin now reads the table.
-- Down: supabase/migrations/down/20261101000188_brand_projects_admin.down.sql

alter table brand_projects add column if not exists closed_from text
  check (closed_from is null or closed_from in ('submitted', 'proof', 'sample', 'quoted', 'production', 'stocked'));
alter table brand_projects add column if not exists status_changed_at timestamptz;
alter table brand_projects add column if not exists admin_emailed_at timestamptz;

-- ── submit: same checks and numbering as migration 184; new: notifications ──
create or replace function create_brand_project(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := my_org_id();
  v_product uuid := nullif(p->>'product_id', '')::uuid;
  v_ref text; v_id uuid; v_logos text[]; v_title text; v_notified int := 0; v_has_mgr boolean;
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
  insert into brand_projects(ref, org_id, created_by, product_id, product_link, quantity, markets, method, packaging, colours, logo_paths, stock_destination, bulk_country, stores, note, status_changed_at)
  values (v_ref, v_org, auth.uid(), v_product, nullif(left(btrim(p->>'product_link'), 500), ''), nullif(p->>'quantity', '')::int,
          coalesce((select array_agg(left(x, 2)) from jsonb_array_elements_text(coalesce(p->'markets', '[]')) x), '{}'),
          nullif(p->>'method', ''), nullif(p->>'packaging', ''), nullif(left(btrim(p->>'colours'), 300), ''), v_logos,
          nullif(p->>'stock_destination', ''), nullif(p->>'bulk_country', ''),
          coalesce((select array_agg(left(x, 30)) from jsonb_array_elements_text(coalesce(p->'stores', '[]')) x), '{}'),
          nullif(left(btrim(p->>'note'), 2000), ''), now())
  returning id into v_id;

  perform audit('brand_project.created', v_org, 'brand', 'brand_project', v_ref, null,
                jsonb_build_object('product_id', v_product, 'method', p->>'method', 'quantity', p->>'quantity', 'logos', coalesce(array_length(v_logos, 1), 0)));

  -- staff alert (staff only: no org_id, so it never shows in the customer's list): primary account manager, else every admin
  v_has_mgr := exists (select 1 from account_managers am where am.org_id = v_org and am.is_primary);
  insert into notifications(user_id, org_id, title, body, link, service, dedupe_key)
  select u, null, 'New brand project ' || v_ref || case when v_has_mgr then '' else ' — needs an account manager' end,
         coalesce(v_title, 'Product link') || coalesce(' · ' || (p->>'quantity') || ' units', ''),
         '/admin/brand-projects/' || v_id, 'brand', 'brand_project:' || v_id || ':submitted:' || u
  from (select am.staff_user_id u from account_managers am where am.org_id = v_org and am.is_primary
        union select ur.user_id from user_roles ur where ur.role_code = 'admin' and not v_has_mgr) t
  on conflict (dedupe_key) do nothing;
  get diagnostics v_notified = row_count;

  -- the customer's confirmation (like "Sourcing request received")
  insert into notifications(org_id, title, body, link, service, dedupe_key)
  values (v_org, 'Brand project received · ' || v_ref, 'Your account manager sends a proof and a quote before you pay.',
          '/account/brand?project=' || v_ref, 'brand', 'brand_project:' || v_id || ':received')
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('id', v_id, 'ref', v_ref, 'notified', v_notified, 'needs_manager', not v_has_mgr);
end $$;
revoke all on function create_brand_project(jsonb) from public, anon;
grant execute on function create_brand_project(jsonb) to authenticated;

-- ── has the customer paid anything on this project? (journals referencing it; none exist yet) ──
create or replace function brand_project_paid(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from journals j join brand_projects b on b.id = p_id
                 where j.ref_type = 'brand_project' and j.ref_id::text in (b.id::text, b.ref));
$$;
revoke all on function brand_project_paid(uuid) from public, anon;
grant execute on function brand_project_paid(uuid) to authenticated;

-- ── staff status moves (one atomic, conditional update + audit row) ──
create or replace function set_brand_project_status(p_id uuid, p_to text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_paid boolean; v_closes int;
begin
  if not is_staff() then raise exception 'FORBIDDEN: staff only'; end if;
  select * into b from brand_projects where id = p_id for update;
  if b.id is null or not staff_sees_org(b.org_id) then raise exception 'NOT_FOUND: brand project not found'; end if;
  if p_to not in ('submitted', 'proof', 'sample', 'quoted', 'production', 'stocked', 'closed') then raise exception 'INVALID_STATUS: %', p_to; end if;
  if p_to = b.status then raise exception 'NO_CHANGE: % is already %', b.ref, b.status; end if;
  v_paid := brand_project_paid(p_id);

  if b.status = 'closed' then
    -- reopen: admin only, back to the step it was closed from
    if not is_admin() then raise exception 'ADMIN_ONLY: only an admin can reopen a closed project'; end if;
    if p_to <> coalesce(b.closed_from, 'submitted') then raise exception 'REOPEN_TO_PREVIOUS: reopen goes back to %', coalesce(b.closed_from, 'submitted'); end if;
    update brand_projects set status = p_to, closed_from = null, status_changed_at = now() where id = p_id and status = 'closed';
  elsif p_to = 'closed' then
    if v_reason is null or length(v_reason) < 3 then raise exception 'REASON_REQUIRED: give an internal reason for closing'; end if;
    if v_paid and not is_admin() then raise exception 'ADMIN_ONLY_PAID: payment received on this project — only an admin can close it'; end if;
    update brand_projects set status = 'closed', closed_from = b.status, status_changed_at = now() where id = p_id and status = b.status;
    select count(*) into v_closes from audit_log where action = 'brand_project.status_changed' and entity = 'brand_project' and entity_id = b.ref and after->>'status' = 'closed';
    insert into notifications(org_id, title, body, link, service, dedupe_key)
    values (b.org_id, 'Brand project ' || b.ref || ' closed', 'Your account manager closed this brand project. Contact them if you have questions.',
            '/account/brand?project=' || b.ref, 'brand', 'brand_project:' || b.id || ':closed:' || (v_closes + 1))
    on conflict (dedupe_key) do nothing;
  else
    update brand_projects set status = p_to, status_changed_at = now() where id = p_id and status = b.status;
  end if;

  -- who (actor_id = auth.uid()), when (created_at), from → to, reason (internal: audit_log is staff-only)
  perform audit('brand_project.status_changed', b.org_id, 'brand', 'brand_project', b.ref,
                jsonb_build_object('status', b.status),
                jsonb_build_object('status', p_to, 'reason', v_reason, 'paid', v_paid));
  return jsonb_build_object('ref', b.ref, 'from', b.status, 'to', p_to,
    'warning', case when p_to = 'closed' and v_paid then 'Payment received; handle the refund separately.' end);
end $$;
revoke all on function set_brand_project_status(uuid, text, text) from public, anon;
grant execute on function set_brand_project_status(uuid, text, text) to authenticated;

-- ── staff list / detail: company, product, account manager (or none) — same scope as brand_projects_read for staff ──
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
   where is_staff() and staff_sees_org(b.org_id)
     and (p_id is null or b.id = p_id)
     and (p_status is null or b.status = p_status)
   order by b.created_at desc;
$$;
revoke all on function admin_brand_projects(uuid, text) from public, anon;
grant execute on function admin_brand_projects(uuid, text) to authenticated;

-- ── status history for the detail page (audit_log itself is readable only with audit:view) ──
create or replace function brand_project_history(p_id uuid)
returns table (at timestamptz, actor text, from_status text, to_status text, reason text)
language sql stable security definer set search_path = public as $$
  select a.created_at, coalesce(nullif(p.full_name, ''), p.email, 'System'), a.before->>'status', a.after->>'status', a.after->>'reason'
    from brand_projects b
    join audit_log a on a.entity = 'brand_project' and a.entity_id = b.ref and a.action in ('brand_project.created', 'brand_project.status_changed')
    left join profiles p on p.id = a.actor_id
   where b.id = p_id and is_staff() and staff_sees_org(b.org_id)
   order by a.created_at desc;
$$;
revoke all on function brand_project_history(uuid) from public, anon;
grant execute on function brand_project_history(uuid) to authenticated;
