-- 20261101000225_t1_turnkey_catalogue_services.sql
-- Turnkey T1 (docs/design/turnkey-v2): the public catalogue (300 photo cards, search, category chips, detail pop-up)
-- and the services price list ("From $X", paid before work starts).
--  1. turnkey_projects: category becomes the catalogue chip (any label, not only the 6 ADDON-31 codes); optional floor
--     area (the space-size filter shows only when projects have it). Existing 25 projects stay.
--  2. tk_import_catalogue(): admin CSV import of the owner's project sheet. Preview first; invalid rows refused; an
--     existing project changes only when its id is ticked (no silent overwrite). Audit-logged.
--  3. tk_services: the starting fee of every service (integer cents, USD), from the owner's design document.
-- Down: supabase/migrations/down/20261101000225_t1_turnkey_catalogue_services.down.sql

alter table public.turnkey_projects drop constraint if exists turnkey_projects_category_check;
alter table public.turnkey_projects add constraint turnkey_projects_category_label check (btrim(category) <> '' and length(category) <= 60);
alter table public.turnkey_projects add column if not exists floor_area_m2 numeric(10,1) check (floor_area_m2 is null or floor_area_m2 > 0);
grant select (floor_area_m2) on public.turnkey_projects to anon, authenticated;

create or replace function public.tk_import_catalogue(p_rows jsonb, p_apply boolean default false, p_replace_ids text[] default '{}')
returns table (row_no integer, project_id text, action text, reason text, changes jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  i integer := 0;
  v_id text; v_title text; v_cat text; v_summary text; v_img text; v_alt text; v_area numeric; v_budget integer; v_rank integer;
  v_old public.turnkey_projects;
  v_reason text;
  v_seen text[] := '{}';
  v_invalid integer := 0;
  v_unticked text[] := '{}';
  v_changes jsonb;
  r record;
  v_new integer := 0; v_upd integer := 0;
begin
  if not (is_staff() and staff_aal_ok() and can('turnkey', 'edit')) then
    raise exception 'FORBIDDEN: only Turnkey editors can import the catalogue';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_IMPORT: rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'IMPORT_TOO_LARGE: at most 1,000 projects per import'; end if;

  create temp table if not exists _tk_preview (row_no integer, project_id text, action text, reason text, changes jsonb, norm jsonb) on commit drop;
  truncate _tk_preview;

  for e in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_reason := null; v_changes := '{}'::jsonb;
    v_title := nullif(btrim(coalesce(e ->> 'title', '')), '');
    v_id := lower(regexp_replace(btrim(coalesce(nullif(e ->> 'project_id', ''), coalesce(v_title, ''))), '[^A-Za-z0-9]+', '-', 'g'));
    v_id := btrim(v_id, '-');
    v_cat := nullif(btrim(coalesce(e ->> 'category', '')), '');
    v_summary := nullif(btrim(coalesce(e ->> 'summary', '')), '');
    v_img := nullif(btrim(coalesce(e ->> 'image', '')), '');
    v_alt := nullif(btrim(coalesce(e ->> 'image_alt', '')), '');
    begin
      v_area := nullif(btrim(coalesce(e ->> 'floor_area_m2', '')), '')::numeric;
      v_budget := nullif(btrim(coalesce(e ->> 'from_usd', '')), '')::integer;
      v_rank := coalesce(nullif(btrim(coalesce(e ->> 'sort', '')), '')::integer, i);
    exception when others then
      v_reason := 'Floor area, From (US$) and Sort must be numbers';
    end;
    if v_reason is null then
      if v_title is null then v_reason := 'Title is required';
      elsif v_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_id) > 60 then v_reason := 'Project id must be letters, numbers and dashes (max 60)';
      elsif v_cat is null or length(v_cat) > 60 then v_reason := 'Category is required (max 60 characters)';
      elsif v_area is not null and v_area <= 0 then v_reason := 'Floor area must be above 0';
      elsif v_budget is not null and v_budget < 0 then v_reason := 'From (US$) cannot be negative';
      elsif v_img is not null and v_img !~* '^(https://|/|banners/|turnkey/)' then v_reason := 'Image must be an https link or a storage path';
      elsif v_id = any (v_seen) then v_reason := 'The same project appears twice in this file';
      end if;
    end if;
    if v_reason is not null then
      v_invalid := v_invalid + 1;
      insert into _tk_preview values (i, v_id, 'invalid', v_reason, '{}'::jsonb, null);
      continue;
    end if;
    v_seen := v_seen || v_id;
    select * into v_old from public.turnkey_projects tp where tp.project_id = v_id;
    if v_old.project_id is null then
      insert into _tk_preview values (i, v_id, 'new', null, '{}'::jsonb,
        jsonb_build_object('title', v_title, 'category', v_cat, 'summary', v_summary, 'image', v_img, 'image_alt', v_alt, 'floor_area_m2', v_area, 'from_usd', v_budget, 'sort', v_rank));
    else
      select coalesce(jsonb_object_agg(k, jsonb_build_object('from', o, 'to', n)), '{}'::jsonb) into v_changes
        from (values
          ('title', to_jsonb(v_old.title), to_jsonb(v_title)),
          ('category', to_jsonb(v_old.category), to_jsonb(v_cat)),
          ('summary', to_jsonb(v_old.short_reason), to_jsonb(v_summary)),
          ('image', to_jsonb(v_old.hero_image_path), to_jsonb(v_img)),
          ('floor_area_m2', to_jsonb(v_old.floor_area_m2), to_jsonb(v_area)),
          ('from_usd', to_jsonb(v_old.starting_budget_usd), to_jsonb(v_budget))
        ) d(k, o, n)
       where o is distinct from n;
      insert into _tk_preview values (i, v_id, case when v_changes = '{}'::jsonb then 'unchanged' else 'update' end, null, v_changes,
        jsonb_build_object('title', v_title, 'category', v_cat, 'summary', v_summary, 'image', v_img, 'image_alt', v_alt, 'floor_area_m2', v_area, 'from_usd', v_budget, 'sort', v_rank));
    end if;
  end loop;

  if coalesce(p_apply, false) then
    if v_invalid > 0 then raise exception 'IMPORT_INVALID: % row(s) have errors; fix them first (nothing was imported)', v_invalid; end if;
    select coalesce(array_agg(t.project_id), '{}') into v_unticked from _tk_preview t
     where t.action = 'update' and not (t.project_id = any (coalesce(p_replace_ids, '{}')));
    if array_length(v_unticked, 1) > 0 then
      raise exception 'IMPORT_UNCONFIRMED_CHANGES: tick these projects to update them (nothing was imported): %', array_to_string(v_unticked, ', ');
    end if;
    for r in select * from _tk_preview t where t.action in ('new', 'update') loop
      if r.action = 'new' then
        insert into public.turnkey_projects (project_id, title, category, short_reason, hero_image_path, hero_image_alt, floor_area_m2,
          starting_budget_usd, sort_rank, status, is_seed)
        values (r.project_id, r.norm ->> 'title', r.norm ->> 'category', r.norm ->> 'summary', r.norm ->> 'image', r.norm ->> 'image_alt',
          (r.norm ->> 'floor_area_m2')::numeric, (r.norm ->> 'from_usd')::integer, (r.norm ->> 'sort')::integer, 'live', false);
        v_new := v_new + 1;
      else
        update public.turnkey_projects tp
           set title = r.norm ->> 'title', category = r.norm ->> 'category', short_reason = r.norm ->> 'summary',
               hero_image_path = coalesce(r.norm ->> 'image', tp.hero_image_path), hero_image_alt = coalesce(r.norm ->> 'image_alt', tp.hero_image_alt),
               floor_area_m2 = (r.norm ->> 'floor_area_m2')::numeric, starting_budget_usd = (r.norm ->> 'from_usd')::integer,
               updated_at = now()
         where tp.project_id = r.project_id;
        v_upd := v_upd + 1;
      end if;
    end loop;
    perform write_audit('turnkey.catalogue_imported', 'turnkey_projects', 'import', jsonb_build_object('new', v_new, 'updated', v_upd));
  end if;

  return query select t.row_no, t.project_id, t.action, t.reason, t.changes from _tk_preview t order by t.row_no;
end $$;
revoke all on function public.tk_import_catalogue(jsonb, boolean, text[]) from public, anon;
grant execute on function public.tk_import_catalogue(jsonb, boolean, text[]) to authenticated, service_role;

create table if not exists public.tk_services (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null check (btrim(name) <> ''),
  from_cents bigint not null check (from_cents >= 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  unit text not null check (unit in ('project', 'day', 'version', 'item', 'trip', 'free')),
  approx boolean not null default false,
  rule_text text,
  group_code text not null check (group_code in ('core', 'qc', 'visit', 'trip_extra', 'manager')),
  photo_path text,
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table public.tk_services is 'Turnkey services and starting fees (shown as "From $X"; staff set the exact fee per client; above 2x needs admin approval, T3).';
insert into public.tk_services (code, name, from_cents, unit, approx, rule_text, group_code, sort) values
  ('consultation', 'Consultation', 9900, 'project', false, 'Some consultations cost more.', 'core', 10),
  ('layout_drawing', 'Layout drawing', 29900, 'project', false, '3 versions free; each extra version costs 50% of the drawing fee (from $150).', 'core', 20),
  ('sourcing_quotes', 'Sourcing and quotes', 19900, 'project', false, null, 'core', 30),
  ('factory_audit', 'Factory audit', 25000, 'item', true, null, 'qc', 40),
  ('pre_shipment_inspection', 'Pre-shipment inspection', 24900, 'item', false, null, 'qc', 50),
  ('visit_china', 'Visit China with us', 39900, 'day', false, 'Up to 2 people; each extra traveller $99 per day.', 'visit', 60),
  ('account_manager', 'Dedicated account manager', 29900, 'project', false, 'Waived above a project value we confirm with you.', 'manager', 70),
  ('visa_letter', 'Visa invitation letter', 4900, 'item', false, null, 'trip_extra', 80),
  ('car_driver', 'Car and driver', 10000, 'day', false, null, 'trip_extra', 90),
  ('airport_pickup', 'Airport pick-up', 3900, 'item', false, null, 'trip_extra', 100),
  ('hotel_help', 'Hotel help', 0, 'free', false, null, 'trip_extra', 110)
on conflict (code) do nothing;
alter table public.tk_services enable row level security;
revoke all on public.tk_services from public, anon, authenticated;
grant select (code, name, from_cents, currency, unit, approx, rule_text, group_code, photo_path, sort, active, updated_at) on public.tk_services to anon, authenticated;
grant all on public.tk_services to service_role;
drop policy if exists tk_services_read on public.tk_services;
create policy tk_services_read on public.tk_services for select to anon, authenticated using (active or (is_staff() and can('turnkey', 'view')));
