-- 20261101000213_step2_staff_catalogue_import_and_publish_gate.sql
-- Phase 2 · Step 2: Staff catalogue, HS & item_master review, Sourcing & CSV import jobs, volume price tiers,
-- merchant visibility (visible_to_org_id), and strict publish gate (DDP vs DAP duty check).
--
-- Rules implemented (Step 2 + Corrections 1–7):
--  1. Merchant visibility uses dropship_products.visible_to_org_id (NULL = all Dropship-enabled merchants; UUID = only
--     that merchant org, e.g. sourced on request via sourced_from_rfq_id). Enforced across get_dropship_countries,
--     get_dropship_catalogue, get_dropship_product, and get_dropship_order_quote. (No exclusive_org_id column.)
--  2. Volume pricing uses public.dropship_price_tiers (mirroring public.price_tiers: product_id, min_qty, unit_price_cents,
--     currency). Wired into get_dropship_product and get_dropship_order_quote. (No dropship_volume_tiers table.)
--  3. Single product editor (/office/dropship/[id], with /office/dropship/products/[id] redirecting).
--  4. Import from Sourcing (import_dropship_from_sourcing) reuses Sourcing products.item_id when creating the dropship
--     variant for the same physical unit (zero duplicate item_master row). A new item_master row is created only for a
--     genuinely different variant. Trigger trg_item_master_flag_dropship_review marks any published (status = 'active')
--     dropship_products row needs_review = true whenever its shared item_master weight_g, box_*_cm, origin_country, or
--     hs_code changes later (and guard_item_master resets hs_verified = false on HS code change).
--  5. Cost/supplier/Sourcing-model redaction: dropship_import_jobs and list_sourcing_candidates_for_dropship require
--     dropship_can_see_costs(division_id_of('DS')); Support (canSeeCosts = false) reads 0 rows and never sees cost,
--     margin, Sourcing cost, Sourcing model no., or supplier.
--  6. Random UUID image keys, EXIF stripped & re-encoded via sharp, optional flagged_images review array.
--  7. Publish gate (get_dropship_publish_checklist, publish_dropship_product, trg_guard_dropship_publish_gate):
--     blocks publish when title/description empty, < 1 image, supplier missing or not verified in Sourcing, any variant
--     item_master.needs_data = true or hs_verified = false, no active fee_versions, < 1 active route, or any active route
--     has no active shipping_rate_cards row / exceeds weight / violates restricted-goods flags. Missing duty_rate_entries
--     blocks publish ONLY for DDP routes (dropship_routes.incoterm = 'DDP'); DAP routes show "Duties paid by buyer" and
--     do NOT block on missing duty entry.
--
-- Down: supabase/migrations/down/20261101000213_step2_staff_catalogue_import_and_publish_gate.down.sql

-- ───────── 1. item_master fragile packaging flag ─────────
alter table public.item_master
  add column if not exists is_fragile boolean not null default false;

comment on column public.item_master.is_fragile is 'Requires protective packaging at 3PL pack station.';

-- ───────── 2. dropship_import_jobs (IMP-XXXX history & progress) ─────────
create sequence if not exists public.seq_dropship_import_job
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

revoke all on sequence public.seq_dropship_import_job from public, anon, authenticated;
grant usage, select on sequence public.seq_dropship_import_job to service_role;

create or replace function public.next_dropship_import_job_code()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'IMP-' || lpad(nextval('public.seq_dropship_import_job')::text, 4, '0')
$$;

revoke all on function public.next_dropship_import_job_code() from public, anon;
grant execute on function public.next_dropship_import_job_code() to authenticated, service_role;

create table if not exists public.dropship_import_jobs (
  id uuid primary key default gen_random_uuid(),
  job_code text not null default public.next_dropship_import_job_code() check (job_code ~ '^IMP-[0-9]{4,}$'),
  source_type text not null check (source_type in ('csv', 'sourcing', 'manual')),
  file_name text,
  status text not null default 'completed' check (status in ('running', 'completed', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0),
  saved_rows integer not null default 0 check (saved_rows >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  created_product_ids uuid[] not null default '{}'::uuid[],
  report jsonb not null default '{}'::jsonb,
  division_id uuid not null default division_id_of('DS') references public.divisions(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint dropship_import_jobs_code_key unique (job_code),
  constraint dropship_import_jobs_ds_div check (division_id = division_id_of('DS'))
);

create index if not exists dropship_import_jobs_division_idx on public.dropship_import_jobs (division_id);
create index if not exists dropship_import_jobs_created_idx on public.dropship_import_jobs (created_at desc);

comment on table public.dropship_import_jobs is 'Dropship catalogue import job log & progress (CSV and Sourcing imports). Restricted to staff with cost/supplier visibility.';

alter table public.dropship_import_jobs enable row level security;
revoke all on public.dropship_import_jobs from public, anon, authenticated;
grant select, insert, update on public.dropship_import_jobs to authenticated;
grant all on public.dropship_import_jobs to service_role;

drop policy if exists dropship_import_jobs_read on public.dropship_import_jobs;
create policy dropship_import_jobs_read on public.dropship_import_jobs
  for select to authenticated
  using (is_staff() and dropship_can_see_costs(division_id));

drop policy if exists dropship_import_jobs_write on public.dropship_import_jobs;
create policy dropship_import_jobs_write on public.dropship_import_jobs
  for all to authenticated
  using (dropship_can_edit(division_id))
  with check (dropship_can_edit(division_id));

-- ───────── 3. dropship_products & dropship_routes Step 2 columns ─────────
alter table public.dropship_products
  add column if not exists visible_to_org_id uuid references public.organizations(id) on delete set null,
  add column if not exists sourced_from_rfq_id uuid references public.rfqs(id) on delete set null,
  add column if not exists needs_review boolean not null default false,
  add column if not exists needs_review_reason text,
  add column if not exists flagged_images text[] not null default '{}'::text[],
  add column if not exists import_job_id uuid references public.dropship_import_jobs(id) on delete set null,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users(id) on delete set null;

create index if not exists dropship_products_visible_org_idx
  on public.dropship_products (visible_to_org_id)
  where visible_to_org_id is not null;

create index if not exists dropship_products_needs_review_idx
  on public.dropship_products (needs_review)
  where needs_review;

comment on column public.dropship_products.visible_to_org_id is 'NULL = visible to all Dropship-enabled merchants; UUID = visible only to that merchant org (e.g. sourced on request).';
comment on column public.dropship_products.sourced_from_rfq_id is 'Optional Sourcing RFQ that originated this merchant-specific dropship product.';
comment on column public.dropship_products.needs_review is 'Set true automatically when a published dropship product''s shared item_master weight, box size, origin, or HS code changes.';

alter table public.dropship_routes
  add column if not exists incoterm text not null default 'DDP';

alter table public.dropship_routes
  drop constraint if exists dropship_routes_incoterm_check;

alter table public.dropship_routes
  add constraint dropship_routes_incoterm_check check (incoterm in ('DDP', 'DAP'));

comment on column public.dropship_routes.incoterm is 'DDP = duties & tax calculated from duty_rate_entries (missing entry blocks publish); DAP = Duties paid by buyer (does not block publish).';

-- ───────── 4. dropship_price_tiers (Correction 2: mirrors public.price_tiers) ─────────
create table if not exists public.dropship_price_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.dropship_products(id) on delete cascade,
  min_qty integer not null check (min_qty >= 1),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dropship_price_tiers_product_min_qty_key unique (product_id, min_qty)
);

create index if not exists dropship_price_tiers_product_idx on public.dropship_price_tiers (product_id, min_qty);

comment on table public.dropship_price_tiers is 'Per-order quantity volume tiers for Dropship product prices (integer USD cents). Merchants read via get_dropship_product / get_dropship_order_quote.';

alter table public.dropship_price_tiers enable row level security;
revoke all on public.dropship_price_tiers from public, anon, authenticated;
grant select, insert, update, delete on public.dropship_price_tiers to authenticated;
grant all on public.dropship_price_tiers to service_role;

drop policy if exists dropship_price_tiers_read on public.dropship_price_tiers;
create policy dropship_price_tiers_read on public.dropship_price_tiers
  for select to authenticated
  using (
    is_staff()
    and in_division((select d.division_id from public.dropship_products d where d.id = dropship_price_tiers.product_id))
  );

drop policy if exists dropship_price_tiers_write on public.dropship_price_tiers;
create policy dropship_price_tiers_write on public.dropship_price_tiers
  for all to authenticated
  using (
    dropship_can_edit((select d.division_id from public.dropship_products d where d.id = dropship_price_tiers.product_id))
  )
  with check (
    dropship_can_edit((select d.division_id from public.dropship_products d where d.id = dropship_price_tiers.product_id))
  );

-- ───────── 5. Correction 4: Flag published dropship_products "Needs review" when shared item_master changes ─────────
create or replace function public.flag_dropship_review_on_item_master_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reasons text[] := '{}'::text[];
  v_saved_claims text;
begin
  if new.hs_code is distinct from old.hs_code then
    v_reasons := array_append(v_reasons, 'HS code changed');
  end if;
  if new.origin_country is distinct from old.origin_country then
    v_reasons := array_append(v_reasons, 'country of origin changed');
  end if;
  if new.weight_g is distinct from old.weight_g then
    v_reasons := array_append(v_reasons, 'weight changed');
  end if;
  if new.box_l_cm is distinct from old.box_l_cm
     or new.box_w_cm is distinct from old.box_w_cm
     or new.box_h_cm is distinct from old.box_h_cm then
    v_reasons := array_append(v_reasons, 'box size changed');
  end if;

  if coalesce(array_length(v_reasons, 1), 0) > 0 then
    -- Cross-division system side-effect: Sourcing staff or assigned distributors updating a shared Sourcing item_master row
    -- are not members of DS, so clear request.jwt.claims strictly around this internal needs_review flag update and restore it.
    v_saved_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims', '', true);
    begin
      update public.dropship_products p
         set needs_review = true,
             needs_review_reason = 'Item master updated: ' || array_to_string(v_reasons, ', '),
             updated_at = now()
       where p.status = 'active'
         and exists (
           select 1
             from public.dropship_variants dv
            where dv.product_id = p.id
              and dv.item_id = new.id
         );
    exception when others then
      perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
      raise;
    end;
    perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
  end if;

  return new;
end $$;

drop trigger if exists trg_item_master_flag_dropship_review on public.item_master;
create trigger trg_item_master_flag_dropship_review
  after update of hs_code, origin_country, weight_g, box_l_cm, box_w_cm, box_h_cm
  on public.item_master
  for each row execute function public.flag_dropship_review_on_item_master_change();

-- ───────── 6. White-label scrubber, item_master editor & HS unverify RPCs ─────────
create or replace function public.scrub_dropship_whitelabel_text(p_text text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out text := coalesce(p_text, '');
  v_removed boolean := false;
  r record;
begin
  if auth.uid() is not null and not dropship_can_edit(division_id_of('DS')) then
    raise exception 'FORBIDDEN';
  end if;

  if btrim(v_out) = '' then
    return jsonb_build_object('clean_text', '', 'scrubbed', false);
  end if;

  for r in
    select matched_term
      from public.dropship_whitelabel_hits(array[v_out])
     order by length(matched_term) desc
  loop
    v_out := regexp_replace(
      v_out,
      regexp_replace(r.matched_term, '([.\\+*?\\[^\\]$(){}=!<>|:\\-])', '\\\\\\1', 'g'),
      '',
      'gi'
    );
    v_removed := true;
  end loop;

  v_out := btrim(regexp_replace(v_out, '\s{2,}', ' ', 'g'));
  return jsonb_build_object('clean_text', v_out, 'scrubbed', v_removed);
end $$;

revoke all on function public.scrub_dropship_whitelabel_text(text) from public, anon;
grant execute on function public.scrub_dropship_whitelabel_text(text) to authenticated, service_role;

create or replace function public.update_dropship_item_master(
  p_item_id uuid,
  p_hs_code text default null,
  p_origin_country text default null,
  p_weight_g integer default null,
  p_box_l_cm numeric default null,
  p_box_w_cm numeric default null,
  p_box_h_cm numeric default null,
  p_has_battery boolean default false,
  p_has_liquid boolean default false,
  p_has_magnet boolean default false,
  p_has_powder boolean default false,
  p_is_fragile boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur public.item_master;
  v_after public.item_master;
  v_oc char(2);
begin
  select * into v_cur from public.item_master where id = p_item_id for update;

  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    if v_cur.id is null then
      raise exception 'NOT_FOUND: item_master row % not found', p_item_id;
    end if;
  elsif is_staff() and not distributor_restricted() and (dropship_can_edit(division_id_of('DS')) or can('products', 'edit')) then
    if v_cur.id is null then
      raise exception 'NOT_FOUND: item_master row % not found', p_item_id;
    end if;
  elsif v_cur.id is not null and v_cur.sourcing_product_id is not null and product_is_my_supplier(v_cur.sourcing_product_id) then
    null;
  else
    raise exception 'FORBIDDEN';
  end if;

  v_oc := case
    when upper(btrim(coalesce(p_origin_country, ''))) ~ '^[A-Z]{2}$'
    then upper(btrim(p_origin_country))::char(2)
    else null
  end;

  update public.item_master
     set hs_code = nullif(btrim(coalesce(p_hs_code, '')), ''),
         hs_code_source = case
           when nullif(btrim(coalesce(p_hs_code, '')), '') is null then null
           when nullif(btrim(coalesce(p_hs_code, '')), '') is distinct from v_cur.hs_code
           then 'manual'
           else hs_code_source
         end,
         origin_country = v_oc,
         weight_g = case when p_weight_g is not null and p_weight_g > 0 then p_weight_g else null end,
         box_l_cm = case when p_box_l_cm is not null and p_box_l_cm > 0 then round(p_box_l_cm, 2) else null end,
         box_w_cm = case when p_box_w_cm is not null and p_box_w_cm > 0 then round(p_box_w_cm, 2) else null end,
         box_h_cm = case when p_box_h_cm is not null and p_box_h_cm > 0 then round(p_box_h_cm, 2) else null end,
         has_battery = coalesce(p_has_battery, false),
         has_liquid = coalesce(p_has_liquid, false),
         has_magnet = coalesce(p_has_magnet, false),
         has_powder = coalesce(p_has_powder, false),
         is_fragile = coalesce(p_is_fragile, false)
   where id = p_item_id
   returning * into v_after;

  perform write_audit(
    'dropship.item_master_updated',
    'item_master',
    p_item_id::text,
    jsonb_build_object(
      'hs_code', v_after.hs_code,
      'hs_verified', v_after.hs_verified,
      'origin_country', v_after.origin_country,
      'weight_g', v_after.weight_g,
      'box_l_cm', v_after.box_l_cm,
      'box_w_cm', v_after.box_w_cm,
      'box_h_cm', v_after.box_h_cm,
      'needs_data', v_after.needs_data
    )
  );

  return jsonb_build_object(
    'item_id', v_after.id,
    'hs_code', v_after.hs_code,
    'hs_verified', v_after.hs_verified,
    'origin_country', v_after.origin_country,
    'weight_g', v_after.weight_g,
    'box_l_cm', v_after.box_l_cm,
    'box_w_cm', v_after.box_w_cm,
    'box_h_cm', v_after.box_h_cm,
    'needs_data', v_after.needs_data,
    'billed_weight_g', public.calc_billed_weight_g(v_after.id)
  );
end $$;

revoke all on function public.update_dropship_item_master(uuid, text, text, integer, numeric, numeric, numeric, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.update_dropship_item_master(uuid, text, text, integer, numeric, numeric, numeric, boolean, boolean, boolean, boolean, boolean) to authenticated, service_role;

create or replace function public.unverify_item_hs_code(
  p_item_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur public.item_master;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (can('products', 'approve') or dropship_can_edit(division_id_of('DS')) or is_admin()) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_cur from public.item_master where id = p_item_id for update;
  if v_cur.id is null then
    raise exception 'NOT_FOUND';
  end if;

  update public.item_master
     set hs_verified = false,
         hs_verified_by = null,
         hs_verified_at = null
   where id = p_item_id;

  perform write_audit(
    'item_master.hs_unverified',
    'item_master',
    p_item_id::text,
    jsonb_build_object('hs_code', v_cur.hs_code, 'reason', p_reason)
  );

  return jsonb_build_object('item_id', p_item_id, 'hs_verified', false);
end $$;

revoke all on function public.unverify_item_hs_code(uuid, text) from public, anon;
grant execute on function public.unverify_item_hs_code(uuid, text) to authenticated, service_role;

-- ───────── 7. Correction 7: Publish checklist & strict DB publish gate (DDP vs DAP) ─────────
create or replace function public.get_dropship_publish_checklist(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prod public.dropship_products;
  v_img_count integer;
  v_var_count integer := 0;
  v_missing_data_count integer := 0;
  v_unverified_hs_count integer := 0;
  v_missing_supplier_count integer := 0;
  v_unverified_supplier_count integer := 0;
  v_has_fee_version boolean := false;
  v_active_route_count integer := 0;
  v_route_issues text[] := '{}'::text[];
  v_duty_issues text[] := '{}'::text[];
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_checks jsonb := '[]'::jsonb;
  v_rec record;
  v_rt record;
  v_rc public.shipping_rate_cards;
  v_billed integer;
begin
  if auth.uid() is not null and not (is_staff() and in_division(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_prod from public.dropship_products where id = p_product_id;
  if v_prod.id is null then
    return jsonb_build_object('ok', false, 'ready', false, 'blockers', jsonb_build_array('Product not found'));
  end if;

  -- 1. Content & images
  v_img_count := coalesce(array_length(v_prod.images, 1), 0);
  if btrim(coalesce(v_prod.title, '')) = '' then
    v_blockers := v_blockers || jsonb_build_array('Title is empty');
  end if;
  if btrim(coalesce(v_prod.description, '')) = '' then
    v_blockers := v_blockers || jsonb_build_array('Description is empty');
  end if;
  if v_img_count < 1 then
    v_blockers := v_blockers || jsonb_build_array('Add at least 1 product image');
  end if;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'key', 'content_images',
      'ok', (btrim(coalesce(v_prod.title, '')) <> '' and btrim(coalesce(v_prod.description, '')) <> '' and v_img_count >= 1),
      'label', case
        when btrim(coalesce(v_prod.title, '')) <> '' and btrim(coalesce(v_prod.description, '')) <> '' and v_img_count >= 1
          then format('Title, description, %s %s', v_img_count, case when v_img_count = 1 then 'image' else 'images' end)
        when v_img_count < 1 then 'Title, description, at least 1 image required'
        else 'Title and description required'
      end
    )
  );

  -- 2. Variants, supplier verification, item_master physical data, and HS verification
  for v_rec in
    select dv.id as variant_id,
           dv.supplier_product_id,
           sp.id as sp_exists,
           s.id as sup_id,
           coalesce(s.verified and s.archived_at is null, false) as sup_verified,
           im.id as item_id,
           im.needs_data,
           im.hs_code,
           im.hs_verified,
           im.has_battery,
           im.has_liquid,
           im.has_magnet,
           im.has_powder
      from public.dropship_variants dv
      join public.item_master im on im.id = dv.item_id
      left join public.supplier_products sp on sp.id = dv.supplier_product_id
      left join public.suppliers s on s.id = sp.supplier_id
     where dv.product_id = p_product_id
  loop
    v_var_count := v_var_count + 1;
    if v_rec.needs_data then
      v_missing_data_count := v_missing_data_count + 1;
    end if;
    if v_rec.hs_code is null or not v_rec.hs_verified then
      v_unverified_hs_count := v_unverified_hs_count + 1;
    end if;

    if v_prod.source_type = 'partner_supplier' and v_rec.supplier_product_id is null then
      v_missing_supplier_count := v_missing_supplier_count + 1;
    elsif v_rec.supplier_product_id is not null and (v_rec.sp_exists is null or not v_rec.sup_verified) then
      v_unverified_supplier_count := v_unverified_supplier_count + 1;
    end if;
  end loop;

  if v_var_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('Add at least 1 product variant');
  end if;

  if v_missing_supplier_count > 0 then
    v_blockers := v_blockers || jsonb_build_array('Supplier missing in Sourcing');
  elsif v_unverified_supplier_count > 0 then
    v_blockers := v_blockers || jsonb_build_array('Supplier is not verified in Sourcing');
  end if;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'key', 'supplier_verified',
      'ok', (v_var_count > 0 and v_missing_supplier_count = 0 and v_unverified_supplier_count = 0),
      'label', case
        when v_missing_supplier_count > 0 then 'Supplier not linked in Sourcing'
        when v_unverified_supplier_count > 0 then 'Supplier not verified in Sourcing'
        else 'Supplier verified in Sourcing'
      end
    )
  );

  if v_missing_data_count > 0 then
    v_blockers := v_blockers || jsonb_build_array('Weight, box size, or country of origin missing');
  end if;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'key', 'physical_data',
      'ok', (v_var_count > 0 and v_missing_data_count = 0),
      'label', case
        when v_var_count > 0 and v_missing_data_count = 0 then 'Weight, box size, origin'
        else 'Weight, box size, or origin missing'
      end
    )
  );

  if v_unverified_hs_count > 0 then
    v_blockers := v_blockers || jsonb_build_array('HS code not checked');
  end if;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'key', 'hs_verified',
      'ok', (v_var_count > 0 and v_unverified_hs_count = 0),
      'label', case
        when v_var_count > 0 and v_unverified_hs_count = 0 then 'HS code checked'
        else 'HS code not checked'
      end
    )
  );

  -- 3. Active processing fee schedule
  select exists(select 1 from public.fee_versions where status = 'active') into v_has_fee_version;
  if not v_has_fee_version then
    v_blockers := v_blockers || jsonb_build_array('No active processing fee schedule');
  end if;

  -- 4. Active routes: shipping_rate_cards + DDP vs DAP duty check (Correction 7)
  for v_rt in
    select id, destination_country, shipping_method, incoterm
      from public.dropship_routes
     where product_id = p_product_id
       and is_active
     order by destination_country, shipping_method
  loop
    v_active_route_count := v_active_route_count + 1;

    select * into v_rc
      from public.shipping_rate_cards rc
     where rc.active
       and rc.country = v_rt.destination_country
       and rc.method = v_rt.shipping_method
     order by rc.base_cents asc, rc.created_at desc
     limit 1;

    if v_rc.id is null then
      v_route_issues := array_append(
        v_route_issues,
        format('%s (%s): no shipping rate set', v_rt.destination_country, v_rt.shipping_method)
      );
    else
      for v_rec in
        select im.id as item_id,
               im.hs_code,
               im.has_battery,
               im.has_liquid,
               im.has_magnet,
               im.has_powder
          from public.dropship_variants dv
          join public.item_master im on im.id = dv.item_id
         where dv.product_id = p_product_id
      loop
        v_billed := public.calc_billed_weight_g(v_rec.item_id, v_rc.volumetric_divisor, v_rc.step_g);
        if v_billed is not null and v_billed > v_rc.max_weight_g then
          v_route_issues := array_append(
            v_route_issues,
            format('%s (%s): exceeds carrier max weight', v_rt.destination_country, v_rt.shipping_method)
          );
          exit;
        end if;
        if (v_rec.has_battery and not v_rc.allows_battery)
           or (v_rec.has_liquid and not v_rc.allows_liquid)
           or (v_rec.has_magnet and not v_rc.allows_magnet)
           or (v_rec.has_powder and not v_rc.allows_powder) then
          v_route_issues := array_append(
            v_route_issues,
            format('%s (%s): shipping lane does not allow restricted goods', v_rt.destination_country, v_rt.shipping_method)
          );
          exit;
        end if;
      end loop;
    end if;

    -- Duty check: ONLY DDP routes require duty_rate_entries; DAP routes show "Duties paid by buyer" and do NOT block!
    if v_rt.incoterm = 'DDP' then
      if exists (
        select 1
          from public.dropship_variants dv
          join public.item_master im on im.id = dv.item_id
         where dv.product_id = p_product_id
           and public.lookup_duty_rate(v_rt.destination_country, im.hs_code) is null
      ) then
        v_duty_issues := array_append(
          v_duty_issues,
          format('%s route (%s): duty not set', v_rt.destination_country, v_rt.shipping_method)
        );
      end if;
    end if;
  end loop;

  if v_active_route_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('Add at least 1 active shipping route');
  end if;

  if coalesce(array_length(v_route_issues, 1), 0) > 0 then
    select v_blockers || coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      into v_blockers
      from unnest(v_route_issues) as x;
  end if;

  if coalesce(array_length(v_duty_issues, 1), 0) > 0 then
    select v_blockers || coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      into v_blockers
      from unnest(v_duty_issues) as x;
  end if;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'key', 'routes_ready',
      'ok', (
        v_active_route_count >= 1
        and v_has_fee_version
        and coalesce(array_length(v_route_issues, 1), 0) = 0
        and coalesce(array_length(v_duty_issues, 1), 0) = 0
      ),
      'label', case
        when v_active_route_count = 0 then '0 active routes'
        when not v_has_fee_version then 'No active processing fee schedule'
        when coalesce(array_length(v_route_issues, 1), 0) > 0 then v_route_issues[1]
        when coalesce(array_length(v_duty_issues, 1), 0) > 0 then v_duty_issues[1]
        else format('%s active %s', v_active_route_count, case when v_active_route_count = 1 then 'route' else 'routes' end)
      end
    )
  );

  -- 5. Non-blocking image review flag warning
  if coalesce(array_length(v_prod.flagged_images, 1), 0) > 0 then
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s %s flagged',
        array_length(v_prod.flagged_images, 1),
        case when array_length(v_prod.flagged_images, 1) = 1 then 'image' else 'images' end
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'ready', (jsonb_array_length(v_blockers) = 0),
    'blockers', v_blockers,
    'warnings', v_warnings,
    'checks', v_checks
  );
end $$;

revoke all on function public.get_dropship_publish_checklist(uuid) from public, anon;
grant execute on function public.get_dropship_publish_checklist(uuid) to authenticated, service_role;

create or replace function public.guard_dropship_publish_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chk jsonb;
  v_msg text;
begin
  -- Enforce publish gate on all authenticated sessions transitioning to 'active'
  if auth.uid() is not null and new.status = 'active' and (tg_op = 'INSERT' or coalesce(old.status, '') <> 'active') then
    if tg_op = 'INSERT' then
      raise exception 'PUBLISH_BLOCKED: save product as draft, attach variants and routes, and pass the publish checklist before publishing';
    end if;
    if coalesce(current_setting('octopus.publishing_dropship_product', true), '') <> 'true' then
      v_chk := public.get_dropship_publish_checklist(new.id);
      if not coalesce((v_chk ->> 'ready')::boolean, false) then
        select string_agg(value, ' · ')
          into v_msg
          from jsonb_array_elements_text(coalesce(v_chk -> 'blockers', '[]'::jsonb));
        raise exception 'PUBLISH_BLOCKED: %', coalesce(v_msg, 'Publish checklist is incomplete');
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_dropship_publish_gate on public.dropship_products;
create trigger trg_guard_dropship_publish_gate
  before insert or update on public.dropship_products
  for each row execute function public.guard_dropship_publish_gate();

create or replace function public.publish_dropship_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.dropship_products;
  v_chk jsonb;
  v_msg text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not dropship_can_edit(division_id_of('DS')) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_prod from public.dropship_products where id = p_product_id for update;
  if v_prod.id is null then
    raise exception 'NOT_FOUND';
  end if;

  v_chk := public.get_dropship_publish_checklist(p_product_id);
  if not coalesce((v_chk ->> 'ready')::boolean, false) then
    select string_agg(value, ' · ')
      into v_msg
      from jsonb_array_elements_text(coalesce(v_chk -> 'blockers', '[]'::jsonb));
    raise exception 'PUBLISH_BLOCKED: %', coalesce(v_msg, 'Publish checklist is incomplete');
  end if;

  perform set_config('octopus.publishing_dropship_product', 'true', true);
  begin
    update public.dropship_products
       set status = 'active',
           needs_review = false,
           needs_review_reason = null,
           published_at = coalesce(published_at, now()),
           published_by = coalesce(auth.uid(), published_by),
           updated_at = now()
     where id = p_product_id;
  exception when others then
    perform set_config('octopus.publishing_dropship_product', '', true);
    raise;
  end;
  perform set_config('octopus.publishing_dropship_product', '', true);

  perform write_audit(
    'dropship.product_published',
    'dropship_product',
    p_product_id::text,
    jsonb_build_object(
      'model_no', v_prod.model_no,
      'visible_to_org_id', v_prod.visible_to_org_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'model_no', v_prod.model_no,
    'status', 'active'
  );
end $$;

revoke all on function public.publish_dropship_product(uuid) from public, anon;
grant execute on function public.publish_dropship_product(uuid) to authenticated, service_role;

-- ───────── 8. Sourcing -> Dropship candidates & import_dropship_from_sourcing (Corrections 1, 4, 5, 7) ─────────
create or replace function public.list_sourcing_candidates_for_dropship(p_limit integer default 200)
returns table (
  supplier_product_id uuid,
  sourcing_product_id uuid,
  sourcing_item_id uuid,
  sourcing_sku text,
  sourcing_title text,
  supplier_id uuid,
  supplier_code text,
  supplier_name text,
  supplier_verified boolean,
  unit_cost_cents bigint,
  rfq_id uuid,
  rfq_code text,
  for_org_id uuid,
  for_org_name text,
  existing_dropship_product_id uuid,
  existing_dropship_model_no text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not (is_staff() and dropship_can_see_costs(division_id_of('DS'))) then
    raise exception 'FORBIDDEN';
  end if;

  return query
    select sp.id as supplier_product_id,
           pr.id as sourcing_product_id,
           pr.item_id as sourcing_item_id,
           coalesce(pr.sku, pr.external_id) as sourcing_sku,
           pr.title as sourcing_title,
           s.id as supplier_id,
           s.code as supplier_code,
           s.legal_name as supplier_name,
           (s.verified and s.archived_at is null) as supplier_verified,
           coalesce(
             pc.supplier_cost_cents,
             (
               select ceil(min(spp.price_minor) / 100.0)::bigint
                 from public.supplier_product_prices spp
                where spp.product_id = sp.product_id
                  and spp.supplier_id = sp.supplier_id
                  and not spp.is_superseded
             ),
             0
           ) as unit_cost_cents,
           rq.id as rfq_id,
           rq.code as rfq_code,
           rq.org_id as for_org_id,
           o.name as for_org_name,
           dp.id as existing_dropship_product_id,
           dp.model_no as existing_dropship_model_no
      from public.supplier_products sp
      join public.products pr on pr.id = sp.product_id and pr.archived_at is null
      join public.suppliers s on s.id = sp.supplier_id and s.archived_at is null
      left join public.product_costs pc on pc.product_id = sp.product_id
      left join lateral (
        select r.id, r.code, r.org_id
          from public.rfqs r
         where r.product_id = pr.id
           and r.status = 'accepted'::rfq_status
         order by r.updated_at desc
         limit 1
      ) rq on true
      left join public.organizations o on o.id = rq.org_id
      left join lateral (
        select p.id, p.model_no
          from public.dropship_variants dv
          join public.dropship_products p on p.id = dv.product_id
         where dv.supplier_product_id = sp.id
         order by p.created_at asc
         limit 1
      ) dp on true
     order by
       (rq.id is not null) desc,
       (s.verified and s.archived_at is null) desc,
       s.code nulls last,
       pr.title
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

revoke all on function public.list_sourcing_candidates_for_dropship(integer) from public, anon;
grant execute on function public.list_sourcing_candidates_for_dropship(integer) to authenticated, service_role;

create or replace function public.import_dropship_from_sourcing(
  p_supplier_product_id uuid,
  p_rfq_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp public.supplier_products;
  v_pr public.products;
  v_sup public.suppliers;
  v_im public.item_master;
  v_rfq public.rfqs;
  v_vis_org uuid := null;
  v_src_rfq uuid := null;
  v_existing record;
  v_clean_title text;
  v_clean_desc text;
  v_cat_name text;
  v_dims jsonb := null;
  v_job public.dropship_import_jobs;
  v_prod public.dropship_products;
  v_var public.dropship_variants;
  v_item_in_use boolean := false;
  v_reuse_item uuid := null;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not dropship_can_edit(division_id_of('DS')) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_sp from public.supplier_products where id = p_supplier_product_id;
  if v_sp.id is null then
    raise exception 'NOT_FOUND: supplier_products row not found';
  end if;

  select * into v_pr from public.products where id = v_sp.product_id and archived_at is null;
  if v_pr.id is null then
    raise exception 'NOT_FOUND: Sourcing product not found or archived';
  end if;

  select * into v_sup from public.suppliers where id = v_sp.supplier_id;
  if v_sup.id is null or not v_sup.verified or v_sup.archived_at is not null then
    raise exception 'SUPPLIER_NOT_VERIFIED: Supplier is not verified in Sourcing';
  end if;

  if p_rfq_id is not null then
    select * into v_rfq from public.rfqs where id = p_rfq_id;
    if v_rfq.id is null then
      raise exception 'NOT_FOUND: Sourcing request not found';
    end if;
    if v_rfq.status <> 'accepted'::rfq_status
       and not exists (select 1 from public.quotes q where q.rfq_id = v_rfq.id and q.status = 'approved'::quote_status) then
      raise exception 'RFQ_NOT_ACCEPTED: Sourcing request does not have an accepted quote yet';
    end if;
    v_vis_org := v_rfq.org_id;
    v_src_rfq := v_rfq.id;
  end if;

  -- Idempotency: if already imported for the same supplier_product_id & visibility scope, return existing product
  select p.id as product_id,
         p.model_no,
         dv.id as variant_id,
         dv.item_id
    into v_existing
    from public.dropship_variants dv
    join public.dropship_products p on p.id = dv.product_id
   where dv.supplier_product_id = p_supplier_product_id
     and p.visible_to_org_id is not distinct from v_vis_org
   order by p.created_at asc
   limit 1;

  if v_existing.product_id is not null then
    return jsonb_build_object(
      'ok', true,
      'already_existed', true,
      'product_id', v_existing.product_id,
      'variant_id', v_existing.variant_id,
      'item_id', v_existing.item_id,
      'reused_sourcing_item', (v_existing.item_id = v_pr.item_id),
      'model_no', v_existing.model_no,
      'visible_to_org_id', v_vis_org,
      'sourced_from_rfq_id', v_src_rfq
    );
  end if;

  select * into v_im from public.item_master where id = v_pr.item_id;
  if v_pr.category_id is not null then
    select c.name into v_cat_name from public.categories c where c.id = v_pr.category_id;
  end if;

  v_clean_title := coalesce(
    nullif((public.scrub_dropship_whitelabel_text(v_pr.title) ->> 'clean_text'), ''),
    'Sourced product'
  );
  v_clean_desc := nullif(
    (public.scrub_dropship_whitelabel_text(coalesce(v_pr.description, '')) ->> 'clean_text'),
    ''
  );

  if v_im.box_l_cm is not null and v_im.box_w_cm is not null and v_im.box_h_cm is not null then
    v_dims := jsonb_build_object('l', v_im.box_l_cm, 'w', v_im.box_w_cm, 'h', v_im.box_h_cm);
  end if;

  -- Correction 4: Reuse Sourcing product's item_id when it is the same physical unit (not yet claimed by another dropship_variants row)
  select exists(select 1 from public.dropship_variants where item_id = v_pr.item_id) into v_item_in_use;
  if not v_item_in_use then
    v_reuse_item := v_pr.item_id;
  end if;

  insert into public.dropship_import_jobs (
    source_type,
    file_name,
    status,
    total_rows,
    saved_rows,
    created_count,
    created_by,
    completed_at,
    report
  ) values (
    'sourcing',
    coalesce(v_pr.sku, v_pr.external_id, v_pr.id::text),
    'completed',
    1,
    1,
    1,
    auth.uid(),
    now(),
    jsonb_build_object('supplier_product_id', p_supplier_product_id, 'rfq_id', v_src_rfq)
  )
  returning * into v_job;

  insert into public.dropship_products (
    legacy_sku,
    title,
    description,
    category,
    images,
    specs,
    weight_g,
    dimensions_cm,
    min_order_qty,
    source_type,
    fulfilment_type,
    origin_country,
    status,
    visible_to_org_id,
    sourced_from_rfq_id,
    import_job_id,
    created_by
  ) values (
    case when v_vis_org is null then coalesce(v_pr.sku, v_pr.external_id) else null end,
    v_clean_title,
    v_clean_desc,
    v_cat_name,
    '{}'::text[],
    '{}'::jsonb,
    greatest(1, coalesce(v_im.weight_g, 250)),
    v_dims,
    1,
    'partner_supplier',
    'extended_catalog',
    v_im.origin_country,
    'draft',
    v_vis_org,
    v_src_rfq,
    v_job.id,
    auth.uid()
  )
  returning * into v_prod;

  insert into public.dropship_variants (
    product_id,
    options,
    supplier_product_id,
    item_id,
    price_adjust_cents,
    sort
  ) values (
    v_prod.id,
    '{}'::jsonb,
    p_supplier_product_id,
    v_reuse_item,
    0,
    0
  )
  returning * into v_var;

  update public.dropship_import_jobs
     set created_product_ids = array[v_prod.id]
   where id = v_job.id;

  perform write_audit(
    'dropship.imported_from_sourcing',
    'dropship_product',
    v_prod.id::text,
    jsonb_build_object(
      'model_no', v_prod.model_no,
      'job_code', v_job.job_code,
      'reused_sourcing_item', (v_var.item_id = v_pr.item_id),
      'visible_to_org_id', v_vis_org,
      'sourced_from_rfq_id', v_src_rfq
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_existed', false,
    'product_id', v_prod.id,
    'variant_id', v_var.id,
    'item_id', v_var.item_id,
    'reused_sourcing_item', (v_var.item_id = v_pr.item_id),
    'model_no', v_prod.model_no,
    'job_code', v_job.job_code,
    'visible_to_org_id', v_vis_org,
    'sourced_from_rfq_id', v_src_rfq
  );
end $$;

revoke all on function public.import_dropship_from_sourcing(uuid, uuid) from public, anon;
grant execute on function public.import_dropship_from_sourcing(uuid, uuid) to authenticated, service_role;

-- ───────── 9. Update merchant RPCs for visible_to_org_id, incoterm, and dropship_price_tiers ─────────
create or replace function public.get_dropship_countries()
returns table (
  country text,
  locked_by_staff boolean,
  has_active_routes boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := dropship_merchant_org();
begin
  if v_org is null then
    return;
  end if;
  return query
    select m.country::text,
           m.locked_by_staff,
           exists (
             select 1
               from public.dropship_routes r
               join public.dropship_products p on p.id = r.product_id and p.status = 'active'
              where r.destination_country = m.country
                and r.is_active
                and (p.visible_to_org_id is null or p.visible_to_org_id = v_org)
                and public.dropship_product_supplier_eligible(p)
           ) as has_active_routes
      from public.dropship_markets m
     where m.org_id = v_org
     order by m.country;
end $$;

revoke all on function public.get_dropship_countries() from public, anon;
grant execute on function public.get_dropship_countries() to authenticated, service_role;

create or replace function public.get_dropship_catalogue(
  p_country text,
  p_search text default null,
  p_category text default null,
  p_page integer default 1
)
returns table (
  product_id uuid,
  model_no text,
  title text,
  description text,
  category text,
  images text[],
  specs jsonb,
  weight_g integer,
  dimensions_cm jsonb,
  min_order_qty integer,
  stock_status text,
  variants jsonb,
  routes jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_q text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_limit integer := 48;
  v_offset integer := (v_page - 1) * 48;
  v_rate jsonb;
begin
  if v_org is null or v_uid is null then
    return;
  end if;

  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' then
    return;
  end if;
  if not exists (select 1 from public.dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return;
  end if;

  return query
    with eligible as (
      select p.id,
             p.model_no,
             p.title,
             p.description,
             p.category,
             p.images,
             p.specs,
             p.weight_g,
             p.dimensions_cm,
             p.min_order_qty,
             p.created_at,
             (
               select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', v.id,
                     'model_no', v.model_no,
                     'options', v.options,
                     'price_adjust_cents', v.price_adjust_cents,
                     'stock_status', coalesce(public.get_dropship_variant_stock(v.id) ->> 'stock_status', 'in_stock')
                   ) order by v.sort, v.model_no
                 ),
                 '[]'::jsonb
               )
               from public.dropship_variants v
              where v.product_id = p.id
             ) as variants_json,
             (
               select jsonb_agg(
                 jsonb_build_object(
                   'destination_country', r.destination_country,
                   'shipping_method', r.shipping_method,
                   'incoterm', r.incoterm,
                   'landed_price_cents', r.landed_price_cents,
                   'est_days_min', r.est_days_min,
                   'est_days_max', r.est_days_max
                 ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
               )
               from public.dropship_routes r
              where r.product_id = p.id
                and r.destination_country = v_country
                and r.is_active
             ) as routes_json
        from public.dropship_products p
       where p.status = 'active'
         and (p.visible_to_org_id is null or p.visible_to_org_id = v_org)
         and public.dropship_product_supplier_eligible(p)
         and exists (
           select 1 from public.dropship_routes r
            where r.product_id = p.id
              and r.destination_country = v_country
              and r.is_active
         )
         and (
           v_q is null
           or lower(p.title) like '%' || v_q || '%'
           or lower(coalesce(p.description, '')) like '%' || v_q || '%'
           or lower(coalesce(p.category, '')) like '%' || v_q || '%'
           or lower(p.model_no) like '%' || v_q || '%'
         )
         and (v_cat is null or lower(coalesce(p.category, '')) = lower(v_cat))
    )
    select e.id as product_id,
           e.model_no,
           e.title,
           e.description,
           e.category,
           e.images,
           e.specs,
           e.weight_g,
           e.dimensions_cm,
           e.min_order_qty,
           case
             when exists (select 1 from jsonb_array_elements(e.variants_json) x where x ->> 'stock_status' = 'in_stock') then 'in_stock'
             when exists (select 1 from jsonb_array_elements(e.variants_json) x where x ->> 'stock_status' = 'low') then 'low'
             else 'out'
           end as stock_status,
           e.variants_json as variants,
           e.routes_json as routes,
           count(*) over() as total_count
      from eligible e
     order by e.created_at desc, e.id
     limit v_limit offset v_offset;
end $$;

revoke all on function public.get_dropship_catalogue(text, text, text, integer) from public, anon;
grant execute on function public.get_dropship_catalogue(text, text, text, integer) to authenticated, service_role;

create or replace function public.get_dropship_product(
  p_product_id uuid,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := dropship_merchant_org();
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_rate jsonb;
  v_vars jsonb;
  v_prod_stock text;
  v_res jsonb;
begin
  if v_org is null or v_uid is null or p_product_id is null then
    return null;
  end if;

  v_rate := auth_rate_hit('dropship-cat:' || v_uid::text, 120, 60);
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'RATE_LIMITED: Too many catalogue requests. Please wait a moment and try again.';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' then
    return null;
  end if;
  if not exists (select 1 from public.dropship_markets m where m.org_id = v_org and m.country = v_country) then
    return null;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', v.id,
               'model_no', v.model_no,
               'options', v.options,
               'price_adjust_cents', v.price_adjust_cents,
               'stock_status', coalesce(public.get_dropship_variant_stock(v.id) ->> 'stock_status', 'in_stock')
             ) order by v.sort, v.model_no
           ),
           '[]'::jsonb
         )
    into v_vars
    from public.dropship_variants v
   where v.product_id = p_product_id;

  v_prod_stock := case
    when exists (select 1 from jsonb_array_elements(v_vars) x where x ->> 'stock_status' = 'in_stock') then 'in_stock'
    when exists (select 1 from jsonb_array_elements(v_vars) x where x ->> 'stock_status' = 'low') then 'low'
    else 'out'
  end;

  select jsonb_build_object(
           'product_id', p.id,
           'model_no', p.model_no,
           'title', p.title,
           'description', p.description,
           'category', p.category,
           'images', to_jsonb(p.images),
           'specs', p.specs,
           'weight_g', p.weight_g,
           'dimensions_cm', p.dimensions_cm,
           'min_order_qty', p.min_order_qty,
           'stock_status', v_prod_stock,
           'variants', v_vars,
           'price_tiers', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'min_qty', t.min_qty,
                 'unit_price_cents', t.unit_price_cents
               ) order by t.min_qty asc
             )
             from public.dropship_price_tiers t
            where t.product_id = p.id
           ), '[]'::jsonb),
           'routes', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'destination_country', r.destination_country,
                 'shipping_method', r.shipping_method,
                 'incoterm', r.incoterm,
                 'landed_price_cents', r.landed_price_cents,
                 'est_days_min', r.est_days_min,
                 'est_days_max', r.est_days_max
               ) order by r.est_days_min, r.landed_price_cents, r.shipping_method
             )
             from public.dropship_routes r
            where r.product_id = p.id and r.destination_country = v_country and r.is_active
           ), '[]'::jsonb)
         )
    into v_res
    from public.dropship_products p
   where p.id = p_product_id
     and p.status = 'active'
     and (p.visible_to_org_id is null or p.visible_to_org_id = v_org)
     and public.dropship_product_supplier_eligible(p)
     and exists (
       select 1 from public.dropship_routes r
        where r.product_id = p.id and r.destination_country = v_country and r.is_active
     );

  return v_res;
end $$;

revoke all on function public.get_dropship_product(uuid, text) from public, anon;
grant execute on function public.get_dropship_product(uuid, text) to authenticated, service_role;

create or replace function public.get_dropship_order_quote(
  p_lines jsonb,
  p_country text,
  p_method text,
  p_incoterm text default 'DDP',
  p_buyer_currency text default 'USD',
  p_fx_rate_to_usd numeric default null,
  p_quote_mode text default 'order'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (v_uid is not null and is_staff() and not distributor_restricted());
  v_org uuid;
  v_country char(2) := upper(btrim(coalesce(p_country, '')))::char(2);
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_incoterm text := upper(btrim(coalesce(p_incoterm, 'DDP')));
  v_buyer_currency text := upper(btrim(coalesce(p_buyer_currency, 'USD')));
  v_quote_mode text := lower(btrim(coalesce(p_quote_mode, 'order')));
  v_fx numeric;
  v_rc public.shipping_rate_cards;
  v_fv public.fee_versions;
  v_line jsonb;
  v_var public.dropship_variants;
  v_prod public.dropship_products;
  v_im public.item_master;
  v_route public.dropship_routes;
  v_qty integer;
  v_total_qty integer := 0;
  v_sum_actual_weight_g bigint := 0;
  v_sum_box_volume_cm3 numeric := 0;
  v_combined_vol_g bigint := 0;
  v_raw_parcel_weight_g bigint := 0;
  v_billed_weight_g integer;
  v_tier_cents bigint;
  v_unit_prod_cents bigint;
  v_line_prod_cents bigint;
  v_product_cents bigint := 0;
  v_line_buyer_minor bigint;
  v_line_declared_usd_cents bigint;
  v_declared_value_usd_cents bigint := 0;
  v_all_buyer_prices_supplied boolean := true;
  v_duty_lines jsonb := '[]'::jsonb;
  v_dl_elem jsonb;
  v_elem_decl bigint;
  v_processing_cents bigint;
  v_shipping_cents bigint;
  v_duty_lookup jsonb;
  v_duty_ver_id uuid := null;
  v_duties_known boolean := true;
  v_duties_cents bigint := 0;
  v_duties_status text;
  v_duty_bp integer;
  v_tax_bp integer;
  v_de_min integer;
  v_de_min_applies text;
begin
  if not v_is_staff then
    v_org := dropship_merchant_org();
    if v_org is null then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Dropshipping is not switched on for your account');
    end if;
    if not exists (select 1 from public.dropship_markets m where m.org_id = v_org and m.country = v_country) then
      return jsonb_build_object('ok', false, 'code', 'MARKET_NOT_ENABLED', 'message', 'Destination country is not in your selling countries');
    end if;
  end if;

  if v_country !~ '^[A-Z]{2}$'
     or v_method not in ('economy', 'standard', 'express')
     or v_incoterm not in ('DDP', 'DAP')
     or v_quote_mode not in ('catalogue', 'order')
     or v_buyer_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'Invalid country, shipping method, incoterm, currency, or quote mode');
  end if;

  if v_buyer_currency <> 'USD' and (p_fx_rate_to_usd is null or p_fx_rate_to_usd <= 0) then
    return jsonb_build_object('ok', false, 'code', 'FX_RATE_REQUIRED', 'message', 'Locked FX rate to USD is required when buyer currency is not USD');
  end if;
  if p_fx_rate_to_usd is not null and p_fx_rate_to_usd <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FX_RATE', 'message', 'FX rate to USD must be > 0');
  end if;
  v_fx := case
    when v_buyer_currency = 'USD' then coalesce(p_fx_rate_to_usd, 1.0)
    else p_fx_rate_to_usd
  end;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_LINES', 'message', 'At least one order line is required');
  end if;

  select *
    into v_rc
    from public.shipping_rate_cards rc
   where rc.active
     and rc.country = v_country
     and rc.method = v_method
   order by rc.base_cents asc, rc.created_at desc
   limit 1;

  if v_rc.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_RATE_SET', 'message', 'No rate set');
  end if;

  select *
    into v_fv
    from public.fee_versions
   where status = 'active'
   limit 1;

  if v_fv.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_FEE_VERSION', 'message', 'No active processing fee schedule');
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line ->> 'qty')::int, 0);
    if v_qty <= 0 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_QTY', 'message', 'Line quantity must be >= 1');
    end if;

    select * into v_var from public.dropship_variants where id = (v_line ->> 'variant_id')::uuid;
    if v_var.id is null then
      return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'Variant not found');
    end if;

    select * into v_prod from public.dropship_products where id = v_var.product_id;
    if v_prod.id is null
       or (
         not v_is_staff
         and (
           v_prod.status <> 'active'
           or (v_prod.visible_to_org_id is not null and v_prod.visible_to_org_id <> v_org)
           or not public.dropship_product_supplier_eligible(v_prod)
         )
       ) then
      return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_AVAILABLE', 'message', 'Product is not available');
    end if;

    select * into v_im from public.item_master where id = v_var.item_id;
    if public.calc_billed_weight_g(v_im.id, v_rc.volumetric_divisor, v_rc.step_g) is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'WEIGHT_SIZE_MISSING',
        'needs_data', true,
        'message', 'Weight/size missing'
      );
    end if;

    if (v_im.has_battery and not v_rc.allows_battery)
       or (v_im.has_liquid and not v_rc.allows_liquid)
       or (v_im.has_magnet and not v_rc.allows_magnet)
       or (v_im.has_powder and not v_rc.allows_powder) then
      return jsonb_build_object('ok', false, 'code', 'RESTRICTED_ITEM', 'message', 'Selected shipping method does not support this item');
    end if;

    v_sum_actual_weight_g := v_sum_actual_weight_g + (v_im.weight_g::bigint * v_qty::bigint);
    v_sum_box_volume_cm3 := v_sum_box_volume_cm3 + ((v_im.box_l_cm * v_im.box_w_cm * v_im.box_h_cm) * v_qty::numeric);
    v_total_qty := v_total_qty + v_qty;

    -- Correction 2: Check dropship_price_tiers first (highest matching min_qty <= v_qty)
    v_tier_cents := null;
    select t.unit_price_cents
      into v_tier_cents
      from public.dropship_price_tiers t
     where t.product_id = v_prod.id
       and t.min_qty <= v_qty
     order by t.min_qty desc
     limit 1;

    if v_tier_cents is not null then
      v_unit_prod_cents := greatest(0, v_tier_cents + v_var.price_adjust_cents);
    elsif v_prod.product_price_cents is not null then
      v_unit_prod_cents := greatest(0, v_prod.product_price_cents + v_var.price_adjust_cents);
    else
      select * into v_route
        from public.dropship_routes r
       where r.product_id = v_prod.id
         and r.destination_country = v_country
         and r.shipping_method = v_method
         and r.is_active
       limit 1;
      if v_route.id is null then
        return jsonb_build_object('ok', false, 'code', 'NO_PRODUCT_PRICE', 'message', 'No product price set for this destination');
      end if;
      v_unit_prod_cents := greatest(0, (v_route.landed_price_cents - v_route.est_shipping_cents - v_route.est_duties_cents) + v_var.price_adjust_cents);
    end if;

    v_line_prod_cents := v_unit_prod_cents * v_qty::bigint;
    v_product_cents := v_product_cents + v_line_prod_cents;

    if v_quote_mode = 'catalogue' then
      v_all_buyer_prices_supplied := false;
      v_line_declared_usd_cents := v_line_prod_cents;
    elsif (v_line ? 'buyer_paid_cents') and v_line -> 'buyer_paid_cents' <> 'null'::jsonb then
      v_line_buyer_minor := (v_line ->> 'buyer_paid_cents')::bigint;
      if v_line_buyer_minor < 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'buyer_paid_cents must be >= 0');
      end if;
      v_line_declared_usd_cents := round(v_line_buyer_minor::numeric * v_fx)::bigint;
    elsif (v_line ? 'buyer_unit_price_cents') and v_line -> 'buyer_unit_price_cents' <> 'null'::jsonb then
      v_line_buyer_minor := (v_line ->> 'buyer_unit_price_cents')::bigint * v_qty::bigint;
      if v_line_buyer_minor < 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'buyer_unit_price_cents must be >= 0');
      end if;
      v_line_declared_usd_cents := round(v_line_buyer_minor::numeric * v_fx)::bigint;
    else
      v_all_buyer_prices_supplied := false;
      v_line_declared_usd_cents := v_line_prod_cents;
    end if;

    v_declared_value_usd_cents := v_declared_value_usd_cents + v_line_declared_usd_cents;
    v_duty_lines := v_duty_lines || jsonb_build_array(
      jsonb_build_object('hs_code', v_im.hs_code, 'declared_usd_cents', v_line_declared_usd_cents)
    );
  end loop;

  v_combined_vol_g := ceil((v_sum_box_volume_cm3 / v_rc.volumetric_divisor) * 1000.0)::bigint;
  v_raw_parcel_weight_g := greatest(v_sum_actual_weight_g, v_combined_vol_g);
  v_billed_weight_g := (ceil(v_raw_parcel_weight_g::numeric / v_rc.step_g::numeric)::integer * v_rc.step_g);
  if v_billed_weight_g > v_rc.max_weight_g then
    return jsonb_build_object('ok', false, 'code', 'MAX_WEIGHT_EXCEEDED', 'message', 'Order exceeds maximum weight for this shipping method');
  end if;

  v_processing_cents := v_fv.pick_pack_first_cents
    + (greatest(0, v_total_qty - 1)::bigint * v_fv.pick_pack_extra_cents)
    + v_fv.packaging_cents;

  v_shipping_cents := v_rc.base_cents
    + ((v_billed_weight_g / v_rc.step_g)::bigint * v_rc.per_100g_cents);

  if v_incoterm = 'DAP' then
    v_duties_known := true;
    v_duties_cents := 0;
    v_duties_status := 'known';
  else
    for v_dl_elem in select * from jsonb_array_elements(v_duty_lines) loop
      v_duty_lookup := public.lookup_duty_rate(v_country, v_dl_elem ->> 'hs_code');
      if v_duty_lookup is null then
        v_duties_known := false;
        v_duties_cents := null;
        exit;
      end if;
      v_duty_ver_id := (v_duty_lookup ->> 'duty_rate_version_id')::uuid;
      v_duty_bp := (v_duty_lookup ->> 'duty_bp')::int;
      v_tax_bp := (v_duty_lookup ->> 'tax_bp')::int;
      v_de_min := (v_duty_lookup ->> 'de_minimis_cents')::int;
      v_de_min_applies := coalesce(v_duty_lookup ->> 'de_minimis_applies_to', 'duty');
      v_elem_decl := (v_dl_elem ->> 'declared_usd_cents')::bigint;
      if v_declared_value_usd_cents <= v_de_min then
        if v_de_min_applies = 'duty_and_tax' then
          v_duties_cents := v_duties_cents + 0;
        else
          v_duties_cents := v_duties_cents + round(v_elem_decl::numeric * v_tax_bp::numeric / 10000.0)::bigint;
        end if;
      else
        v_duties_cents := v_duties_cents + round(v_elem_decl::numeric * (v_duty_bp + v_tax_bp)::numeric / 10000.0)::bigint;
      end if;
    end loop;

    if not v_duties_known then
      v_duties_status := 'not_known_yet';
    elsif v_quote_mode = 'catalogue' or not v_all_buyer_prices_supplied then
      v_duties_status := 'estimate';
    else
      v_duties_status := 'known';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'country', v_country,
    'shipping_method', v_method,
    'incoterm', v_incoterm,
    'total_qty', v_total_qty,
    'actual_weight_g', v_sum_actual_weight_g,
    'volumetric_weight_g', v_combined_vol_g,
    'billed_weight_g', v_billed_weight_g,
    'days_min', v_rc.days_min,
    'days_max', v_rc.days_max,
    'product_cents', v_product_cents,
    'processing_cents', v_processing_cents,
    'shipping_cents', v_shipping_cents,
    'declared_value_usd_cents', v_declared_value_usd_cents,
    'duty_basis', case
      when v_quote_mode = 'catalogue' or not v_all_buyer_prices_supplied then 'product_price'
      else 'buyer_paid_price_usd'
    end,
    'duties_cents', v_duties_cents,
    'duties_status', v_duties_status,
    'duties_label', case
      when v_incoterm = 'DAP' then 'Duties paid by buyer'
      when v_duties_known then null
      else 'not known yet'
    end,
    'total_known_cents', v_product_cents + v_processing_cents + v_shipping_cents + coalesce(v_duties_cents, 0),
    'total_cents', case
      when v_duties_known then v_product_cents + v_processing_cents + v_shipping_cents + v_duties_cents
      else null
    end,
    'version_ids', jsonb_build_object(
      'shipping_rate_card_id', v_rc.id,
      'fee_version_id', v_fv.id,
      'duty_rate_version_id', v_duty_ver_id
    )
  );
end $$;

comment on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) is
  'Order-level 4-part quote engine. Enforces visible_to_org_id and dropship_price_tiers volume tiers. Processing fee is charged ONCE per order (first + extra*(total_qty-1) + packaging). Combined parcel billed weight = max(sum(actual weight_g), ceil((sum(box_volume_cm3)/divisor)*1000)) rounded up to 100 g step. DAP returns duties_cents = 0 and duties_label = ''Duties paid by buyer''. Final customs valuation rule is set in Step 6b.';

revoke all on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.get_dropship_order_quote(jsonb, text, text, text, text, numeric, text) to authenticated, service_role;
