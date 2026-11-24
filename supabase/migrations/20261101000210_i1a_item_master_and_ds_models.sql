-- 20261101000210_i1a_item_master_and_ds_models.sql
-- Phase 1 · Step I1a: Shared item_master, one-writer HS sync, billed-weight helper, DS model numbers, and legacy cost freeze.
--
-- Rules implemented (items 1–10 + B4–B10):
--  1. item_master.origin_country is nullable with NO default (never defaults to 'CN'). Unknown -> NULL + needs_data = true.
--     dropship_products.origin_country default 'CN' and NOT NULL are also dropped so nothing defaults to 'CN'.
--  2. hs_code_source ('sheet','rule','ai','manual' or NULL) and hs_code_status ('confirmed','suggested','missing') match
--     SELECT DISTINCT on live and staging products.
--  3. hs_verified is set ONLY by an explicit staff action (verify_item_hs_code, confirm_hs_type, change_hs_type_heading),
--     guarded by local session config octopus.allow_hs_verify = 'true', recording hs_verified_by and hs_verified_at.
--     Never auto-set from 'sheet', 'rule', 'ai', or backfill. Changing hs_code without explicit verification resets hs_verified.
--  4. One item_master row = one physical sellable unit (variant level). item_id NOT NULL on products and dropship_variants
--     (NOT on dropship_products). Every dropship_products row has >= 1 variant. BEFORE INSERT triggers auto-create item_master
--     rows when item_id is NULL. products.item_id is hidden from anon/authenticated (customer-safe reads).
--  5. item_master is the sole HS writer: trg_block_direct_product_hs_write rejects direct changes to products.hs_* unless
--     current_setting('octopus.item_master_hs_sync', true) = 'true'. sync_item_master_hs_to_products copies item_master -> products.hs_*
--     one-way for existing readers. All SQL HS writers (import_product_row, confirm_hs_type, change_hs_type_heading,
--     set_product_item_hs) write item_master.
--  6 & 7. Unambiguous parser for weights (g, kg, 克, 千克) and box sizes (mm, cm, 毫米, 厘米); ambiguous/missing -> NULL + needs_data = true.
--     products.net_weight and colour_box_mm remain legacy read-only display.
--  8. DS model numbers: seq_ds_model_no -> DS-000001 on dropship_products, DS-000001-01 on dropship_variants via per-product
--     monotonic last_variant_seq (never reused). Existing octopus_sku copied to legacy_sku; model_no immutable via trigger;
--     octopus_sku no longer read or written.
--  9. calc_billed_weight_g(p_item_id, p_divisor default 5000, p_step_g default 100): returns NULL if weight_g or any box dimension
--     is NULL (never charges on 0 g), otherwise greatest(weight_g, volumetric_g) rounded up to p_step_g (100 g).
-- 10. Cost duplication freeze: supplier_products.id uuid unique + dropship_variants.supplier_product_id FK. Triggers freeze
--     dropship_products(supplier_id, supplier_sku, unit_cost_cents) and dropship_variants(cost_cents) against new writes.
--     get_dropship_catalogue / get_dropship_product / get_dropship_countries return model_no (never octopus_sku, legacy_sku,
--     sourcing_product_id, supplier_product_id, item_id, or cost).
--
-- Down: supabase/migrations/down/20261101000210_i1a_item_master_and_ds_models.down.sql

-- ───────── 1. Unambiguous physical parsers (g/kg/克/千克 and mm/cm/毫米/厘米) ─────────
create or replace function public.parse_unambiguous_weight_g(p_raw text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_clean text := btrim(coalesce(p_raw, ''));
  v_m text[];
  v_num numeric;
  v_unit text;
  v_grams integer;
begin
  if v_clean = '' then
    return null;
  end if;
  v_m := regexp_match(v_clean, '^([0-9]+(?:\.[0-9]+)?)\s*(kg|g|千克|克)$', 'i');
  if v_m is null then
    return null;
  end if;
  v_num := v_m[1]::numeric;
  v_unit := lower(v_m[2]);
  if v_num <= 0 then
    return null;
  end if;
  if v_unit in ('kg', '千克') then
    v_grams := round(v_num * 1000.0)::integer;
  else
    v_grams := round(v_num)::integer;
  end if;
  if v_grams <= 0 or v_grams > 500000 then
    return null;
  end if;
  return v_grams;
end $$;

revoke all on function public.parse_unambiguous_weight_g(text) from public, anon;
grant execute on function public.parse_unambiguous_weight_g(text) to authenticated, service_role;

create or replace function public.parse_unambiguous_box_cm(p_raw text)
returns table (
  l_cm numeric(8,2),
  w_cm numeric(8,2),
  h_cm numeric(8,2)
)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_clean text := btrim(coalesce(p_raw, ''));
  v_m text[];
  v_d1 numeric;
  v_d2 numeric;
  v_d3 numeric;
  v_unit text;
  v_div numeric;
begin
  if v_clean = '' then
    return query select null::numeric(8,2), null::numeric(8,2), null::numeric(8,2);
    return;
  end if;
  v_m := regexp_match(
    v_clean,
    '^([0-9]+(?:\.[0-9]+)?)\s*[*xX×]\s*([0-9]+(?:\.[0-9]+)?)\s*[*xX×]\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|cm|毫米|厘米)$',
    'i'
  );
  if v_m is null then
    return query select null::numeric(8,2), null::numeric(8,2), null::numeric(8,2);
    return;
  end if;
  v_d1 := v_m[1]::numeric;
  v_d2 := v_m[2]::numeric;
  v_d3 := v_m[3]::numeric;
  v_unit := lower(v_m[4]);
  v_div := case when v_unit in ('mm', '毫米') then 10.0 else 1.0 end;
  l_cm := round(v_d1 / v_div, 2);
  w_cm := round(v_d2 / v_div, 2);
  h_cm := round(v_d3 / v_div, 2);
  if l_cm <= 0 or w_cm <= 0 or h_cm <= 0 or l_cm > 1000 or w_cm > 1000 or h_cm > 1000 then
    return query select null::numeric(8,2), null::numeric(8,2), null::numeric(8,2);
    return;
  end if;
  return next;
end $$;

revoke all on function public.parse_unambiguous_box_cm(text) from public, anon;
grant execute on function public.parse_unambiguous_box_cm(text) to authenticated, service_role;

-- ───────── 2. Shared item_master table (one row per physical sellable unit / variant) ─────────
create table if not exists public.item_master (
  id uuid primary key default gen_random_uuid(),
  sourcing_product_id uuid unique references public.products(id) on delete set null,
  hs_code text,
  hs_code_source text check (hs_code_source is null or hs_code_source in ('sheet', 'rule', 'ai', 'manual')),
  hs_code_status text not null default 'missing' check (hs_code_status in ('confirmed', 'suggested', 'missing')),
  hs_code_confidence numeric(4,3) check (hs_code_confidence is null or (hs_code_confidence >= 0 and hs_code_confidence <= 1)),
  hs_product_type_id uuid references public.hs_product_types(id) on delete set null,
  hs_classify_pending boolean not null default false,
  hs_code_note text,
  hs_verified boolean not null default false,
  hs_verified_by uuid references auth.users(id) on delete set null,
  hs_verified_at timestamptz,
  origin_country char(2) check (origin_country is null or origin_country ~ '^[A-Z]{2}$'),
  weight_g integer check (weight_g is null or weight_g > 0),
  box_l_cm numeric(8,2) check (box_l_cm is null or box_l_cm > 0),
  box_w_cm numeric(8,2) check (box_w_cm is null or box_w_cm > 0),
  box_h_cm numeric(8,2) check (box_h_cm is null or box_h_cm > 0),
  has_battery boolean not null default false,
  has_liquid boolean not null default false,
  has_magnet boolean not null default false,
  has_powder boolean not null default false,
  needs_data boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists item_master_hs_pending_idx on public.item_master (hs_classify_pending) where hs_classify_pending;
create index if not exists item_master_hs_type_idx on public.item_master (hs_product_type_id);
create index if not exists item_master_needs_data_idx on public.item_master (needs_data) where needs_data;

comment on table public.item_master is 'Shared physical unit master (one row per physical sellable unit: Sourcing product or Dropship variant). Staff/supplier only; never directly readable by customers.';
comment on column public.item_master.origin_country is 'Nullable ISO-2 country of origin; NO default (never defaults to CN). Unknown -> NULL + needs_data = true.';
comment on column public.item_master.hs_verified is 'Set ONLY by explicit staff verification action (verify_item_hs_code / confirm_hs_type / change_hs_type_heading). Never auto-set from sheet, rule, AI, or backfill.';

alter table public.item_master enable row level security;
revoke all on public.item_master from public, anon, authenticated;
grant select, insert, update on public.item_master to authenticated;
grant all on public.item_master to service_role;

drop policy if exists item_master_read on public.item_master;
create policy item_master_read on public.item_master
  for select to authenticated
  using (
    is_staff()
    or (sourcing_product_id is not null and product_is_my_supplier(sourcing_product_id))
  );

drop policy if exists item_master_write on public.item_master;
create policy item_master_write on public.item_master
  for all to authenticated
  using (
    can('products', 'edit')
    or dropship_can_edit(division_id_of('DS'))
    or (sourcing_product_id is not null and product_editable(sourcing_product_id))
  )
  with check (
    can('products', 'edit')
    or dropship_can_edit(division_id_of('DS'))
    or (sourcing_product_id is not null and product_editable(sourcing_product_id))
  );

-- Guard on item_master: normalises HS source/status, protects sheet/manual codes from rule/AI overwrites,
-- strictly guards hs_verified (octopus.allow_hs_verify = 'true' only), and maintains needs_data.
create or replace function public.guard_item_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow_verify boolean := coalesce(current_setting('octopus.allow_hs_verify', true), '') = 'true';
  v_oc text := upper(btrim(coalesce(new.origin_country::text, '')));
begin
  -- Normalise origin_country: nullable, never defaults to 'CN'
  if v_oc ~ '^[A-Z]{2}$' then
    new.origin_country := v_oc::char(2);
  else
    new.origin_country := null;
  end if;

  new.hs_code := nullif(btrim(coalesce(new.hs_code, '')), '');

  -- Never overwrite a sheet-supplied or manually entered code with a rule / AI value
  if tg_op = 'UPDATE'
     and old.hs_code_source in ('sheet', 'manual')
     and coalesce(btrim(old.hs_code), '') <> ''
     and new.hs_code_source in ('rule', 'ai') then
    new.hs_code := old.hs_code;
    new.hs_code_source := old.hs_code_source;
    new.hs_code_status := old.hs_code_status;
    new.hs_code_confidence := old.hs_code_confidence;
    new.hs_product_type_id := old.hs_product_type_id;
    new.hs_classify_pending := false;
    new.hs_verified := old.hs_verified;
    new.hs_verified_by := old.hs_verified_by;
    new.hs_verified_at := old.hs_verified_at;
  else
    if new.hs_code is null then
      if new.hs_code_source in ('sheet', 'manual')
         or (tg_op = 'UPDATE' and old.hs_code is not null and new.hs_code_source is not distinct from old.hs_code_source) then
        new.hs_code_source := null;
      end if;
      if new.hs_code_source is null then
        new.hs_code_status := 'missing';
        new.hs_code_confidence := null;
      end if;
    elsif new.hs_code_source is null
          or (tg_op = 'UPDATE' and new.hs_code is distinct from old.hs_code and new.hs_code_source is not distinct from old.hs_code_source and old.hs_code_source in ('rule', 'ai')) then
      new.hs_code_source := 'manual';
      new.hs_code_status := 'confirmed';
      new.hs_code_confidence := null;
      new.hs_classify_pending := false;
    end if;

    if new.hs_code_source in ('sheet', 'manual') and new.hs_code is not null then
      new.hs_code_status := 'confirmed';
      new.hs_classify_pending := false;
      new.hs_code_note := null;
    end if;
  end if;

  -- Enforce Item 3: hs_verified can ONLY be set via explicit staff verification RPC
  if tg_op = 'INSERT' then
    if coalesce(new.hs_verified, false) and not v_allow_verify then
      raise exception 'HS_VERIFY_FORBIDDEN: hs_verified can only be set by an explicit staff verification action';
    end if;
    if new.hs_code is null then
      new.hs_verified := false;
      new.hs_verified_by := null;
      new.hs_verified_at := null;
    end if;
  else
    if coalesce(new.hs_verified, false) and not coalesce(old.hs_verified, false) and not v_allow_verify then
      raise exception 'HS_VERIFY_FORBIDDEN: hs_verified can only be set by an explicit staff verification action';
    end if;
    if new.hs_code is null then
      new.hs_verified := false;
      new.hs_verified_by := null;
      new.hs_verified_at := null;
    elsif new.hs_code is distinct from old.hs_code and not v_allow_verify then
      -- Changing hs_code outside explicit verification un-verifies the item until staff verifies the new code
      new.hs_verified := false;
      new.hs_verified_by := null;
      new.hs_verified_at := null;
    end if;
    new.updated_at := now();
  end if;

  -- Recompute needs_data whenever physical / origin fields are missing
  new.needs_data := (
    new.origin_country is null
    or new.weight_g is null
    or new.box_l_cm is null
    or new.box_w_cm is null
    or new.box_h_cm is null
  );

  return new;
end $$;

drop trigger if exists trg_guard_item_master on public.item_master;
create trigger trg_guard_item_master
  before insert or update on public.item_master
  for each row execute function public.guard_item_master();

-- ───────── 3. Billed weight function (Item 9 — no generated column; NULL when data missing; step 100 g) ─────────
create or replace function public.calc_billed_weight_g(
  p_item_id uuid,
  p_divisor numeric default 5000,
  p_step_g integer default 100
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_im public.item_master;
  v_div numeric := coalesce(nullif(p_divisor, 0), 5000);
  v_step integer := greatest(1, coalesce(p_step_g, 100));
  v_vol_g integer;
  v_raw_g integer;
begin
  if p_item_id is null or v_div <= 0 then
    return null;
  end if;
  select * into v_im from public.item_master where id = p_item_id;
  if v_im.id is null then
    return null;
  end if;
  -- Never charge on 0 g: if weight or any box dimension is missing, return NULL ("Weight/size missing")
  if v_im.weight_g is null
     or v_im.box_l_cm is null
     or v_im.box_w_cm is null
     or v_im.box_h_cm is null then
    return null;
  end if;

  v_vol_g := ceil(((v_im.box_l_cm * v_im.box_w_cm * v_im.box_h_cm) / v_div) * 1000.0)::integer;
  v_raw_g := greatest(v_im.weight_g, v_vol_g);
  return (ceil(v_raw_g::numeric / v_step::numeric)::integer * v_step);
end $$;

revoke all on function public.calc_billed_weight_g(uuid, numeric, integer) from public, anon;
grant execute on function public.calc_billed_weight_g(uuid, numeric, integer) to authenticated, service_role;

-- ───────── 4. Backfill item_master from Sourcing products + wire NOT NULL products.item_id & one-way HS sync ─────────
alter table public.products add column if not exists item_id uuid references public.item_master(id) on delete restrict;
-- Customer-safe reads (migration 195): hide products.item_id from anon and authenticated
revoke select (item_id) on public.products from anon, authenticated;

-- Backfill one item_master per existing products row (no matching by name/SKU with dropship; hs_verified stays false)
do $$
declare
  r record;
  v_w integer;
  v_b record;
  v_oc char(2);
  v_item uuid;
begin
  for r in
    select id, hs_code, hs_code_source, hs_code_status, hs_code_confidence, hs_product_type_id,
           hs_classify_pending, hs_code_note, origin_country, net_weight, colour_box_mm
      from public.products
     where item_id is null
     order by created_at asc, id asc
  loop
    v_w := public.parse_unambiguous_weight_g(r.net_weight);
    select * into v_b from public.parse_unambiguous_box_cm(r.colour_box_mm);
    v_oc := case
      when upper(btrim(coalesce(r.origin_country, ''))) ~ '^[A-Z]{2}$'
      then upper(btrim(r.origin_country))::char(2)
      else null
    end;

    insert into public.item_master (
      sourcing_product_id,
      hs_code,
      hs_code_source,
      hs_code_status,
      hs_code_confidence,
      hs_product_type_id,
      hs_classify_pending,
      hs_code_note,
      hs_verified,
      origin_country,
      weight_g,
      box_l_cm,
      box_w_cm,
      box_h_cm
    ) values (
      r.id,
      nullif(btrim(coalesce(r.hs_code, '')), ''),
      r.hs_code_source,
      coalesce(r.hs_code_status, 'missing'),
      r.hs_code_confidence,
      r.hs_product_type_id,
      coalesce(r.hs_classify_pending, false),
      r.hs_code_note,
      false,
      v_oc,
      v_w,
      v_b.l_cm,
      v_b.w_cm,
      v_b.h_cm
    )
    returning id into v_item;

    update public.products set item_id = v_item where id = r.id;
  end loop;
end $$;

alter table public.products alter column item_id set not null;
create unique index if not exists products_item_id_key on public.products (item_id);

-- Refresh portal_products() so its composite return type includes the new products column cleanly
create or replace function public.portal_products() returns setof public.products
language sql stable security definer set search_path = public as $$
  select p.* from public.products p where can('products', 'view') or is_my_supplier(p.supplier_id)
$$;
revoke all on function public.portal_products() from public, anon;
grant execute on function public.portal_products() to authenticated, service_role;

-- Drop old direct guard_hs_code trigger on products; item_master is now the sole HS writer
drop trigger if exists trg_guard_hs_code on public.products;

-- BEFORE INSERT on products: auto-create item_master when item_id is null, and mirror normalised HS fields onto NEW
create or replace function public.products_ensure_item_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_im public.item_master;
  v_w integer;
  v_b record;
  v_oc char(2);
begin
  if new.item_id is null then
    v_w := public.parse_unambiguous_weight_g(new.net_weight);
    select * into v_b from public.parse_unambiguous_box_cm(new.colour_box_mm);
    v_oc := case
      when upper(btrim(coalesce(new.origin_country, ''))) ~ '^[A-Z]{2}$'
      then upper(btrim(new.origin_country))::char(2)
      else null
    end;

    insert into public.item_master (
      hs_code,
      hs_code_source,
      hs_code_status,
      hs_code_confidence,
      hs_product_type_id,
      hs_classify_pending,
      hs_code_note,
      hs_verified,
      origin_country,
      weight_g,
      box_l_cm,
      box_w_cm,
      box_h_cm
    ) values (
      new.hs_code,
      new.hs_code_source,
      coalesce(new.hs_code_status, 'missing'),
      new.hs_code_confidence,
      new.hs_product_type_id,
      coalesce(new.hs_classify_pending, false),
      new.hs_code_note,
      false,
      v_oc,
      v_w,
      v_b.l_cm,
      v_b.w_cm,
      v_b.h_cm
    )
    returning * into v_im;

    new.item_id := v_im.id;
  else
    select * into v_im from public.item_master where id = new.item_id;
  end if;

  if v_im.id is not null then
    new.hs_code := v_im.hs_code;
    new.hs_code_source := v_im.hs_code_source;
    new.hs_code_status := v_im.hs_code_status;
    new.hs_code_confidence := v_im.hs_code_confidence;
    new.hs_product_type_id := v_im.hs_product_type_id;
    new.hs_classify_pending := v_im.hs_classify_pending;
    new.hs_code_note := v_im.hs_code_note;
  end if;

  return new;
end $$;

drop trigger if exists trg_products_ensure_item_master on public.products;
create trigger trg_products_ensure_item_master
  before insert on public.products
  for each row execute function public.products_ensure_item_master();

-- AFTER INSERT on products: set item_master.sourcing_product_id = new.id now that the products PK exists
create or replace function public.products_link_item_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.item_master
     set sourcing_product_id = new.id
   where id = new.item_id
     and sourcing_product_id is null;
  return new;
end $$;

drop trigger if exists trg_products_link_item_master on public.products;
create trigger trg_products_link_item_master
  after insert on public.products
  for each row execute function public.products_link_item_master();

-- Item 5: Reject any direct UPDATE to products.hs_* unless it comes from sync_item_master_hs_to_products
create or replace function public.block_direct_product_hs_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('octopus.item_master_hs_sync', true), '') <> 'true' then
    if new.hs_code is distinct from old.hs_code
       or new.hs_code_source is distinct from old.hs_code_source
       or new.hs_code_status is distinct from old.hs_code_status
       or new.hs_code_confidence is distinct from old.hs_code_confidence
       or new.hs_product_type_id is distinct from old.hs_product_type_id
       or new.hs_classify_pending is distinct from old.hs_classify_pending
       or new.hs_code_note is distinct from old.hs_code_note then
      raise exception 'DIRECT_PRODUCT_HS_WRITE_BLOCKED: write HS fields on item_master instead of products';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_block_direct_product_hs_write on public.products;
create trigger trg_block_direct_product_hs_write
  before update on public.products
  for each row execute function public.block_direct_product_hs_write();

-- One-way sync: item_master -> products.hs_* for legacy readers
create or replace function public.sync_item_master_hs_to_products()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('octopus.item_master_hs_sync', 'true', true);
  begin
    update public.products p
       set hs_code = new.hs_code,
           hs_code_source = new.hs_code_source,
           hs_code_status = new.hs_code_status,
           hs_code_confidence = new.hs_code_confidence,
           hs_product_type_id = new.hs_product_type_id,
           hs_classify_pending = new.hs_classify_pending,
           hs_code_note = new.hs_code_note
     where p.item_id = new.id
       and (
         p.hs_code is distinct from new.hs_code
         or p.hs_code_source is distinct from new.hs_code_source
         or p.hs_code_status is distinct from new.hs_code_status
         or p.hs_code_confidence is distinct from new.hs_code_confidence
         or p.hs_product_type_id is distinct from new.hs_product_type_id
         or p.hs_classify_pending is distinct from new.hs_classify_pending
         or p.hs_code_note is distinct from new.hs_code_note
       );
  exception when others then
    perform set_config('octopus.item_master_hs_sync', '', true);
    raise;
  end;
  perform set_config('octopus.item_master_hs_sync', '', true);
  return new;
end $$;

drop trigger if exists trg_sync_item_master_hs_to_products on public.item_master;
create trigger trg_sync_item_master_hs_to_products
  after insert or update of hs_code, hs_code_source, hs_code_status, hs_code_confidence, hs_product_type_id, hs_classify_pending, hs_code_note
  on public.item_master
  for each row execute function public.sync_item_master_hs_to_products();

-- ───────── 5. Explicit HS verification RPC & Sourcing HS writer RPCs (Items 3 & 5) ─────────
create or replace function public.verify_item_hs_code(
  p_item_id uuid,
  p_hs_code text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cur public.item_master;
  v_code text;
begin
  if v_uid is null or not (can('products', 'approve') or dropship_can_edit(division_id_of('DS')) or is_admin()) then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_cur from public.item_master where id = p_item_id for update;
  if v_cur.id is null then
    raise exception 'NOT_FOUND';
  end if;
  v_code := coalesce(nullif(btrim(coalesce(p_hs_code, '')), ''), v_cur.hs_code);
  if v_code is null or v_code !~ '^[0-9]{4}([0-9.\- ]{0,12})?$' then
    raise exception 'HS_BAD_CODE: provide a valid customs HS code (at least 4 digits) before verifying';
  end if;

  perform set_config('octopus.allow_hs_verify', 'true', true);
  begin
    update public.item_master
       set hs_code = v_code,
           hs_code_source = case
             when nullif(btrim(coalesce(p_hs_code, '')), '') is not null then 'manual'
             else coalesce(hs_code_source, 'manual')
           end,
           hs_code_status = 'confirmed',
           hs_code_confidence = null,
           hs_classify_pending = false,
           hs_code_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), hs_code_note),
           hs_verified = true,
           hs_verified_by = v_uid,
           hs_verified_at = now()
     where id = p_item_id;
  exception when others then
    perform set_config('octopus.allow_hs_verify', '', true);
    raise;
  end;
  perform set_config('octopus.allow_hs_verify', '', true);

  perform write_audit(
    'item_master.hs_verified',
    'item_master',
    p_item_id::text,
    jsonb_build_object('from_hs_code', v_cur.hs_code, 'hs_code', v_code, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );

  return jsonb_build_object(
    'item_id', p_item_id,
    'hs_code', v_code,
    'hs_verified', true,
    'hs_verified_by', v_uid
  );
end $$;

revoke all on function public.verify_item_hs_code(uuid, text, text) from public, anon;
grant execute on function public.verify_item_hs_code(uuid, text, text) to authenticated, service_role;

-- Sourcing product editor helper: writes HS code & origin_country on item_master for an editable product
create or replace function public.set_product_item_hs(
  p_product_id uuid,
  p_hs_code text default null,
  p_origin_country text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_cur public.item_master;
  v_next_hs text := nullif(btrim(coalesce(p_hs_code, '')), '');
  v_next_oc char(2) := case
    when upper(btrim(coalesce(p_origin_country, ''))) ~ '^[A-Z]{2}$'
    then upper(btrim(p_origin_country))::char(2)
    else null
  end;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif auth.uid() is null or not product_editable(p_product_id) then
    raise exception 'FORBIDDEN';
  end if;

  select item_id into v_item_id from public.products where id = p_product_id;
  if v_item_id is null then
    raise exception 'NOT_FOUND';
  end if;
  select * into v_cur from public.item_master where id = v_item_id for update;

  if v_next_hs is distinct from v_cur.hs_code or v_next_oc is distinct from v_cur.origin_country then
    update public.item_master
       set hs_code = v_next_hs,
           hs_code_source = case
             when v_next_hs is null then null
             when v_next_hs is distinct from v_cur.hs_code then 'manual'
             else v_cur.hs_code_source
           end,
           origin_country = v_next_oc
     where id = v_item_id;
  end if;
end $$;

revoke all on function public.set_product_item_hs(uuid, text, text) from public, anon;
grant execute on function public.set_product_item_hs(uuid, text, text) to authenticated, service_role;

-- Update confirm_hs_type, hs_type_change_preview, and change_hs_type_heading to operate on item_master
create or replace function public.confirm_hs_type(p_type uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.hs_product_types;
  r record;
  n int := 0;
begin
  if not (can('products', 'approve') or is_admin()) then
    raise exception 'FORBIDDEN';
  end if;
  select * into t from public.hs_product_types where id = p_type for update;
  if t.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if t.heading is null then
    raise exception 'HS_NO_HEADING: set a 4-digit heading before confirming';
  end if;

  update public.hs_product_types
     set confirmed = true,
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         updated_at = now()
   where id = p_type;

  perform set_config('octopus.allow_hs_verify', 'true', true);
  begin
    for r in
      select im.id as item_id, im.hs_code, im.hs_code_status, p.id as product_id
        from public.item_master im
        left join public.products p on p.item_id = im.id
       where im.hs_product_type_id = p_type
         and im.hs_code_source in ('rule', 'ai')
         and (im.hs_code_status <> 'confirmed' or not im.hs_verified)
    loop
      update public.item_master
         set hs_code = t.heading,
             hs_code_status = 'confirmed',
             hs_code_note = null,
             hs_verified = true,
             hs_verified_by = auth.uid(),
             hs_verified_at = now()
       where id = r.item_id;

      if r.product_id is not null then
        perform write_audit(
          'product.hs_code_confirmed',
          'products',
          r.product_id::text,
          jsonb_build_object('type', t.name, 'heading', t.heading, 'from_status', r.hs_code_status)
        );
      end if;
      perform write_audit(
        'item_master.hs_verified',
        'item_master',
        r.item_id::text,
        jsonb_build_object('type', t.name, 'heading', t.heading)
      );
      n := n + 1;
    end loop;
  exception when others then
    perform set_config('octopus.allow_hs_verify', '', true);
    raise;
  end;
  perform set_config('octopus.allow_hs_verify', '', true);

  perform write_audit(
    'hs_type.confirmed',
    'hs_product_types',
    p_type::text,
    jsonb_build_object('type', t.name, 'heading', t.heading, 'products', n)
  );
  return jsonb_build_object('type', t.name, 'heading', t.heading, 'products_confirmed', n);
end $$;

grant execute on function public.confirm_hs_type(uuid) to authenticated;

create or replace function public.hs_type_change_preview(p_type uuid, p_heading text)
returns table (
  product_id uuid,
  sku text,
  title text,
  current_code text,
  new_code text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.sku, p.title, im.hs_code, p_heading, im.hs_code_status
    from public.item_master im
    join public.products p on p.item_id = im.id
   where im.hs_product_type_id = p_type
     and coalesce(im.hs_code_source, 'rule') in ('rule', 'ai')
     and (can('products', 'approve') or is_admin())
   order by p.sku
$$;

grant execute on function public.hs_type_change_preview(uuid, text) to authenticated;

create or replace function public.change_hs_type_heading(p_type uuid, p_heading text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.hs_product_types;
  r record;
  n int := 0;
begin
  if not (can('products', 'approve') or is_admin()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_heading !~ '^[0-9]{4}$' then
    raise exception 'HS_BAD_HEADING: the heading must be exactly 4 digits';
  end if;
  select * into t from public.hs_product_types where id = p_type for update;
  if t.id is null then
    raise exception 'NOT_FOUND';
  end if;

  update public.hs_product_types
     set heading = p_heading,
         confirmed = true,
         source = 'manual',
         confidence = null,
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         updated_at = now()
   where id = p_type;

  perform set_config('octopus.allow_hs_verify', 'true', true);
  begin
    for r in
      select im.id as item_id, im.hs_code, p.id as product_id
        from public.item_master im
        left join public.products p on p.item_id = im.id
       where im.hs_product_type_id = p_type
         and coalesce(im.hs_code_source, 'rule') in ('rule', 'ai')
    loop
      update public.item_master
         set hs_code = p_heading,
             hs_code_source = 'rule',
             hs_code_status = 'confirmed',
             hs_code_confidence = null,
             hs_code_note = null,
             hs_classify_pending = false,
             hs_verified = true,
             hs_verified_by = auth.uid(),
             hs_verified_at = now()
       where id = r.item_id;

      if r.product_id is not null then
        perform write_audit(
          'product.hs_code_changed',
          'products',
          r.product_id::text,
          jsonb_build_object('type', t.name, 'from', r.hs_code, 'to', p_heading)
        );
      end if;
      n := n + 1;
    end loop;
  exception when others then
    perform set_config('octopus.allow_hs_verify', '', true);
    raise;
  end;
  perform set_config('octopus.allow_hs_verify', '', true);

  perform write_audit(
    'hs_type.heading_changed',
    'hs_product_types',
    p_type::text,
    jsonb_build_object('type', t.name, 'from', t.heading, 'to', p_heading, 'products', n)
  );
  return jsonb_build_object('type', t.name, 'heading', p_heading, 'products_updated', n);
end $$;

grant execute on function public.change_hs_type_heading(uuid, text) to authenticated;

-- Update import_product_row so mode='update' writes HS code & origin_country on item_master instead of products.hs_*
create or replace function public.import_product_row(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
  v_item_id uuid;
  v_img jsonb;
  v_cur text := coalesce(p->>'currency', 'USD');
  v_min bigint;
  v_sup uuid := (p->>'supplier_id')::uuid;
  v_hs text := nullif(btrim(coalesce(p->>'hs_code', '')), '');
  v_oc text := nullif(upper(btrim(coalesce(p->>'origin_country', ''))), '');
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'FORBIDDEN';
  elsif (p->>'mode') = 'update' then
    if not product_editable((p->>'product_id')::uuid) then
      raise exception 'NOT_EDITABLE: You cannot edit this product.';
    end if;
  elsif not (
    can('products', 'create')
    and (is_admin() or not has_role('distributor') or is_my_supplier(v_sup))
    and coalesce((select product_upload from supplier_switches where supplier_id = v_sup), true)
  ) then
    raise exception 'new row violates row-level security policy for table "products"' using errcode = '42501';
  end if;

  select min((t->>'unit_price_cents')::bigint) into v_min
    from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;

  if (p->>'mode') = 'update' then
    update public.products
       set title = p->>'title',
           category_id = nullif(p->>'category_id', '')::uuid,
           unit = coalesce(p->>'unit', 'pcs'),
           moq = coalesce((p->>'moq')::int, 1),
           lead_time_days = (p->>'lead_time_days')::int,
           incoterm = p->>'incoterm',
           origin_country = v_oc,
           currency = v_cur,
           octopus_dropship = coalesce((p->>'octopus_dropship')::boolean, false),
           ready_to_ship = coalesce((p->>'ready_to_ship')::boolean, false),
           description = p->>'description',
           min_price_cents = v_min
     where id = (p->>'product_id')::uuid
       and supplier_id = v_sup
     returning id, item_id into v_id, v_item_id;

    if v_id is null then
      raise exception 'NOT_EDITABLE: You cannot edit this product.';
    end if;

    -- Write HS code (sheet source, hs_verified NOT auto-set) and origin_country to item_master
    if v_hs is not null or v_oc is not null then
      update public.item_master
         set hs_code = coalesce(v_hs, hs_code),
             hs_code_source = case
               when v_hs is not null and v_hs is distinct from hs_code then 'sheet'
               else hs_code_source
             end,
             origin_country = case
               when v_oc ~ '^[A-Z]{2}$' then v_oc::char(2)
               else origin_country
             end
       where id = v_item_id;
    end if;
  else
    insert into public.products (
      external_id, slug, title, description, supplier_id, category_id, status, unit, moq, lead_time_days, incoterm,
      origin_country, hs_code, hs_code_source, octopus_dropship, ready_to_ship, currency, min_price_cents, created_by, seo_title
    ) values (
      p->>'sku',
      p->>'slug',
      p->>'title',
      p->>'description',
      v_sup,
      nullif(p->>'category_id', '')::uuid,
      'draft',
      coalesce(p->>'unit', 'pcs'),
      coalesce((p->>'moq')::int, 1),
      (p->>'lead_time_days')::int,
      p->>'incoterm',
      v_oc,
      v_hs,
      case when v_hs is not null then 'sheet' end,
      coalesce((p->>'octopus_dropship')::boolean, false),
      coalesce((p->>'ready_to_ship')::boolean, false),
      v_cur,
      v_min,
      auth.uid(),
      left((p->>'title') || ' | Wholesale', 60)
    )
    returning id into v_id;
  end if;

  delete from public.price_tiers where product_id = v_id;
  insert into public.price_tiers (product_id, min_qty, unit_price_cents, currency)
  select v_id, (t->>'min_qty')::int, (t->>'unit_price_cents')::bigint, v_cur
    from jsonb_array_elements(coalesce(p->'tiers', '[]')) t;

  for v_img in select * from jsonb_array_elements(coalesce(p->'images', '[]')) loop
    delete from public.product_media
     where product_id = v_id
       and (sort = (v_img->>'position')::int or sha256 = v_img->>'sha256');
    insert into public.product_media (product_id, url, kind, sort, storage_path, source_file_name, sha256)
    values (
      v_id,
      v_img->>'url',
      'image',
      (v_img->>'position')::int,
      v_img->>'storage_path',
      v_img->>'source_file_name',
      v_img->>'sha256'
    );
  end loop;

  update public.products
     set image_url = (select url from public.product_media where product_id = v_id order by sort limit 1)
   where id = v_id;

  return v_id;
end $function$;

revoke all on function public.import_product_row(jsonb) from public, anon;
grant execute on function public.import_product_row(jsonb) to authenticated, service_role;

-- ───────── 6. DS model numbers (DS-000001 / DS-000001-01), dropship_variants.item_id, and Sourcing cost link ─────────
create sequence if not exists public.seq_ds_model_no start with 1 increment by 1 no cycle;
revoke all on sequence public.seq_ds_model_no from public, anon;
grant usage, select on sequence public.seq_ds_model_no to authenticated, service_role;

create or replace function public.next_ds_product_model_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint := nextval('public.seq_ds_model_no');
begin
  if v_n < 1000000 then
    return 'DS-' || lpad(v_n::text, 6, '0');
  end if;
  return 'DS-' || v_n::text;
end $$;

revoke all on function public.next_ds_product_model_no() from public, anon;
grant execute on function public.next_ds_product_model_no() to authenticated, service_role;

-- Ensure supplier_products has a surrogate uuid id for dropship_variants.supplier_product_id FK
alter table public.supplier_products add column if not exists id uuid not null default gen_random_uuid();
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.supplier_products'::regclass
       and conname = 'supplier_products_id_key'
  ) then
    alter table public.supplier_products add constraint supplier_products_id_key unique (id);
  end if;
end $$;

-- Ensure every existing dropship_products row has at least 1 dropship_variants row BEFORE adding NOT NULL columns
insert into public.dropship_variants (product_id, options, octopus_sku, cost_cents, price_adjust_cents, stock_status, stock_qty, sort)
select p.id,
       '{}'::jsonb,
       coalesce(nullif(btrim(p.octopus_sku), ''), p.id::text) || '-01',
       p.unit_cost_cents,
       0,
       p.stock_status,
       p.stock_qty,
       0
  from public.dropship_products p
 where not exists (select 1 from public.dropship_variants v where v.product_id = p.id);

-- Relax octopus_sku & origin_country on dropship_products (stop writing octopus_sku; origin_country never defaults to 'CN')
alter table public.dropship_products drop constraint if exists dropship_products_sku_check;
drop index if exists public.dropship_products_octopus_sku_key;
alter table public.dropship_products alter column octopus_sku drop not null;
alter table public.dropship_products alter column origin_country drop default;
alter table public.dropship_products alter column origin_country drop not null;

alter table public.dropship_products
  add column if not exists model_no text,
  add column if not exists legacy_sku text,
  add column if not exists last_variant_seq integer not null default 0 check (last_variant_seq >= 0);

-- Relax octopus_sku on dropship_variants and add model_no, legacy_sku, item_id, supplier_product_id
alter table public.dropship_variants drop constraint if exists dropship_variants_octopus_sku_check;
drop index if exists public.dropship_variants_octopus_sku_key;
alter table public.dropship_variants alter column octopus_sku drop not null;

alter table public.dropship_variants
  add column if not exists model_no text,
  add column if not exists legacy_sku text,
  add column if not exists item_id uuid references public.item_master(id) on delete restrict,
  add column if not exists supplier_product_id uuid references public.supplier_products(id) on delete set null;

create index if not exists dropship_variants_supplier_product_idx on public.dropship_variants (supplier_product_id);

-- Backfill model_no, legacy_sku, last_variant_seq, and item_master rows for existing dropship_products / dropship_variants
do $$
declare
  p record;
  v record;
  v_model text;
  v_seq integer;
  v_item uuid;
  v_l numeric(8,2);
  v_w numeric(8,2);
  v_h numeric(8,2);
  v_oc char(2);
begin
  for p in
    select id, octopus_sku, model_no, legacy_sku, weight_g, dimensions_cm, origin_country, has_battery, has_liquid
      from public.dropship_products
     order by created_at asc, id asc
  loop
    v_model := coalesce(p.model_no, public.next_ds_product_model_no());
    update public.dropship_products
       set model_no = v_model,
           legacy_sku = coalesce(legacy_sku, nullif(btrim(coalesce(p.octopus_sku, '')), ''))
     where id = p.id;

    v_oc := case
      when upper(btrim(coalesce(p.origin_country::text, ''))) ~ '^[A-Z]{2}$'
      then upper(btrim(p.origin_country::text))::char(2)
      else null
    end;
    v_l := case when p.dimensions_cm ? 'l' and (p.dimensions_cm->>'l') ~ '^[0-9]+(\.[0-9]+)?$' and (p.dimensions_cm->>'l')::numeric > 0 then round((p.dimensions_cm->>'l')::numeric, 2) else null end;
    v_w := case when p.dimensions_cm ? 'w' and (p.dimensions_cm->>'w') ~ '^[0-9]+(\.[0-9]+)?$' and (p.dimensions_cm->>'w')::numeric > 0 then round((p.dimensions_cm->>'w')::numeric, 2) else null end;
    v_h := case when p.dimensions_cm ? 'h' and (p.dimensions_cm->>'h') ~ '^[0-9]+(\.[0-9]+)?$' and (p.dimensions_cm->>'h')::numeric > 0 then round((p.dimensions_cm->>'h')::numeric, 2) else null end;

    v_seq := 0;
    for v in
      select id, octopus_sku, model_no, legacy_sku, item_id
        from public.dropship_variants
       where product_id = p.id
       order by sort asc, created_at asc, id asc
    loop
      v_seq := v_seq + 1;
      v_item := v.item_id;
      if v_item is null then
        insert into public.item_master (
          sourcing_product_id,
          origin_country,
          weight_g,
          box_l_cm,
          box_w_cm,
          box_h_cm,
          has_battery,
          has_liquid,
          hs_verified
        ) values (
          null,
          v_oc,
          p.weight_g,
          v_l,
          v_w,
          v_h,
          coalesce(p.has_battery, false),
          coalesce(p.has_liquid, false),
          false
        )
        returning id into v_item;
      end if;

      update public.dropship_variants
         set model_no = coalesce(v.model_no, v_model || '-' || lpad(v_seq::text, 2, '0')),
             legacy_sku = coalesce(v.legacy_sku, nullif(btrim(coalesce(v.octopus_sku, '')), '')),
             item_id = v_item
       where id = v.id;
    end loop;

    update public.dropship_products
       set last_variant_seq = greatest(last_variant_seq, v_seq)
     where id = p.id;
  end loop;
end $$;

alter table public.dropship_products alter column model_no set not null;
alter table public.dropship_products drop constraint if exists dropship_products_model_no_check;
alter table public.dropship_products add constraint dropship_products_model_no_check check (model_no ~ '^DS-[0-9]{6,}$');
create unique index if not exists dropship_products_model_no_key on public.dropship_products (model_no);
create unique index if not exists dropship_products_legacy_sku_key
  on public.dropship_products (upper(btrim(legacy_sku)))
  where legacy_sku is not null and btrim(legacy_sku) <> '';

alter table public.dropship_variants alter column model_no set not null;
alter table public.dropship_variants alter column item_id set not null;
alter table public.dropship_variants drop constraint if exists dropship_variants_model_no_check;
alter table public.dropship_variants add constraint dropship_variants_model_no_check check (model_no ~ '^DS-[0-9]{6,}-[0-9]{2,}$');
create unique index if not exists dropship_variants_model_no_key on public.dropship_variants (model_no);
create unique index if not exists dropship_variants_item_id_key on public.dropship_variants (item_id);
create unique index if not exists dropship_variants_legacy_sku_key
  on public.dropship_variants (upper(btrim(legacy_sku)))
  where legacy_sku is not null and btrim(legacy_sku) <> '';

comment on column public.dropship_products.legacy_sku is 'Staff only (former octopus_sku / CSV idempotency ref). Never returned to merchants.';
comment on column public.dropship_variants.legacy_sku is 'Staff only (former octopus_sku). Never returned to merchants.';
comment on column public.dropship_variants.supplier_product_id is 'Staff only (links variant to Sourcing supplier_products for verified supplier & cost). Never returned to merchants.';

-- Triggers on dropship_products & dropship_variants:
--  · model_no auto-generation & immutability
--  · monotonic per-product variant sequence (last_variant_seq never reused on delete)
--  · auto-creation of item_master when dropship_variants.item_id is null
--  · freeze of legacy cost/supplier columns (Item 10)
create or replace function public.dropship_product_model_no_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc text := upper(btrim(coalesce(new.origin_country::text, '')));
begin
  if v_oc ~ '^[A-Z]{2}$' then
    new.origin_country := v_oc::char(2);
  else
    new.origin_country := null;
  end if;

  if tg_op = 'INSERT' then
    if new.model_no is null or btrim(new.model_no) = '' then
      new.model_no := public.next_ds_product_model_no();
    end if;
    new.last_variant_seq := coalesce(new.last_variant_seq, 0);
  else
    if new.model_no is distinct from old.model_no then
      raise exception 'MODEL_NO_IMMUTABLE: dropship_products.model_no cannot be changed';
    end if;
    if new.last_variant_seq < old.last_variant_seq then
      raise exception 'VARIANT_SEQ_MONOTONIC: last_variant_seq cannot decrease';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_dropship_product_model_no on public.dropship_products;
create trigger trg_dropship_product_model_no
  before insert or update on public.dropship_products
  for each row execute function public.dropship_product_model_no_guard();

create or replace function public.dropship_variant_model_no_and_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.dropship_products;
  v_seq integer;
  v_l numeric(8,2);
  v_w numeric(8,2);
  v_h numeric(8,2);
begin
  if tg_op = 'INSERT' then
    update public.dropship_products
       set last_variant_seq = last_variant_seq + 1
     where id = new.product_id
     returning * into v_prod;

    if v_prod.id is null then
      raise exception 'NOT_FOUND: parent dropship_products row % not found', new.product_id;
    end if;

    v_seq := v_prod.last_variant_seq;
    new.model_no := v_prod.model_no || '-' || lpad(v_seq::text, 2, '0');

    if new.item_id is null then
      v_l := case when v_prod.dimensions_cm ? 'l' and (v_prod.dimensions_cm->>'l') ~ '^[0-9]+(\.[0-9]+)?$' and (v_prod.dimensions_cm->>'l')::numeric > 0 then round((v_prod.dimensions_cm->>'l')::numeric, 2) else null end;
      v_w := case when v_prod.dimensions_cm ? 'w' and (v_prod.dimensions_cm->>'w') ~ '^[0-9]+(\.[0-9]+)?$' and (v_prod.dimensions_cm->>'w')::numeric > 0 then round((v_prod.dimensions_cm->>'w')::numeric, 2) else null end;
      v_h := case when v_prod.dimensions_cm ? 'h' and (v_prod.dimensions_cm->>'h') ~ '^[0-9]+(\.[0-9]+)?$' and (v_prod.dimensions_cm->>'h')::numeric > 0 then round((v_prod.dimensions_cm->>'h')::numeric, 2) else null end;

      insert into public.item_master (
        sourcing_product_id,
        origin_country,
        weight_g,
        box_l_cm,
        box_w_cm,
        box_h_cm,
        has_battery,
        has_liquid,
        hs_verified
      ) values (
        null,
        v_prod.origin_country,
        v_prod.weight_g,
        v_l,
        v_w,
        v_h,
        coalesce(v_prod.has_battery, false),
        coalesce(v_prod.has_liquid, false),
        false
      )
      returning id into new.item_id;
    end if;
  else
    if new.model_no is distinct from old.model_no then
      raise exception 'MODEL_NO_IMMUTABLE: dropship_variants.model_no cannot be changed';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_dropship_variant_model_no_and_item on public.dropship_variants;
create trigger trg_dropship_variant_model_no_and_item
  before insert or update on public.dropship_variants
  for each row execute function public.dropship_variant_model_no_and_item_guard();

-- Item 10: Freeze legacy duplicated cost & supplier columns on dropship_products and dropship_variants
create or replace function public.freeze_dropship_product_legacy_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.supplier_id is not null
       or new.supplier_sku is not null
       or coalesce(new.unit_cost_cents, 0) <> 0 then
      raise exception 'LEGACY_COST_FROZEN: dropship_products supplier_id, supplier_sku, and unit_cost_cents are frozen; link dropship_variants.supplier_product_id instead';
    end if;
  else
    if new.supplier_id is distinct from old.supplier_id
       or new.supplier_sku is distinct from old.supplier_sku
       or new.unit_cost_cents is distinct from old.unit_cost_cents then
      raise exception 'LEGACY_COST_FROZEN: dropship_products supplier_id, supplier_sku, and unit_cost_cents are frozen; link dropship_variants.supplier_product_id instead';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_freeze_dropship_product_legacy_cost on public.dropship_products;
create trigger trg_freeze_dropship_product_legacy_cost
  before insert or update on public.dropship_products
  for each row execute function public.freeze_dropship_product_legacy_cost();

create or replace function public.freeze_dropship_variant_legacy_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.cost_cents, 0) <> 0 then
      raise exception 'LEGACY_COST_FROZEN: dropship_variants.cost_cents is frozen; cost is read from Sourcing via supplier_product_id';
    end if;
  else
    if new.cost_cents is distinct from old.cost_cents then
      raise exception 'LEGACY_COST_FROZEN: dropship_variants.cost_cents is frozen; cost is read from Sourcing via supplier_product_id';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_freeze_dropship_variant_legacy_cost on public.dropship_variants;
create trigger trg_freeze_dropship_variant_legacy_cost
  before insert or update on public.dropship_variants
  for each row execute function public.freeze_dropship_variant_legacy_cost();

-- ───────── 7. Staff-only Sourcing link helpers & Merchant white-label catalogue RPCs ─────────
create or replace function public.dropship_sourcing_links(p_product_ids uuid[] default null)
returns table (
  variant_id uuid,
  product_id uuid,
  supplier_product_id uuid,
  sourcing_product_id uuid,
  sourcing_sku text,
  sourcing_title text,
  supplier_id uuid,
  supplier_code text,
  supplier_name text,
  supplier_verified boolean,
  supplier_model text,
  unit_cost_cents bigint
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
    select v.id as variant_id,
           v.product_id,
           v.supplier_product_id,
           sp.product_id as sourcing_product_id,
           coalesce(pr.sku, pr.external_id) as sourcing_sku,
           pr.title as sourcing_title,
           s.id as supplier_id,
           s.code as supplier_code,
           s.legal_name as supplier_name,
           (s.id is not null and s.verified and s.archived_at is null) as supplier_verified,
           sp.supplier_model,
           coalesce(
             pc.supplier_cost_cents,
             (
               select ceil(min(spp.price_minor) / 100.0)::bigint
                 from public.supplier_product_prices spp
                where spp.product_id = sp.product_id
                  and spp.supplier_id = sp.supplier_id
                  and not spp.is_superseded
             )
           ) as unit_cost_cents
      from public.dropship_variants v
      left join public.supplier_products sp on sp.id = v.supplier_product_id
      left join public.products pr on pr.id = sp.product_id
      left join public.suppliers s on s.id = sp.supplier_id
      left join public.product_costs pc on pc.product_id = sp.product_id
     where p_product_ids is null or v.product_id = any(p_product_ids)
     order by v.product_id, v.sort, v.model_no;
end $$;

revoke all on function public.dropship_sourcing_links(uuid[]) from public, anon;
grant execute on function public.dropship_sourcing_links(uuid[]) to authenticated, service_role;

create or replace function public.list_sourcing_supplier_products(p_limit integer default 300)
returns table (
  supplier_product_id uuid,
  sourcing_product_id uuid,
  sourcing_sku text,
  sourcing_title text,
  supplier_id uuid,
  supplier_code text,
  supplier_name text,
  supplier_model text,
  unit_cost_cents bigint
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
           coalesce(pr.sku, pr.external_id) as sourcing_sku,
           pr.title as sourcing_title,
           s.id as supplier_id,
           s.code as supplier_code,
           s.legal_name as supplier_name,
           sp.supplier_model,
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
           ) as unit_cost_cents
      from public.supplier_products sp
      join public.products pr on pr.id = sp.product_id and pr.archived_at is null
      join public.suppliers s on s.id = sp.supplier_id and s.verified and s.archived_at is null
      left join public.product_costs pc on pc.product_id = sp.product_id
     order by s.code, pr.sku nulls last, pr.title
     limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

revoke all on function public.list_sourcing_supplier_products(integer) from public, anon;
grant execute on function public.list_sourcing_supplier_products(integer) to authenticated, service_role;

-- Helper: true when a dropship product is eligible to show to merchants without reading frozen p.supplier_id
create or replace function public.dropship_product_supplier_eligible(p_product public.dropship_products)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
        from public.dropship_variants dv
       where dv.product_id = p_product.id
         and dv.supplier_product_id is not null
    ) then
      not exists (
        select 1
          from public.dropship_variants dv
          join public.supplier_products sp on sp.id = dv.supplier_product_id
          join public.suppliers s on s.id = sp.supplier_id
         where dv.product_id = p_product.id
           and (not s.verified or s.archived_at is not null)
      )
    when p_product.source_type = 'own_warehouse' then true
    when p_product.is_test
         and coalesce((select value #>> '{}' from public.site_settings where key = 'app_environment'), '') = 'staging' then true
    else false
  end
$$;

revoke all on function public.dropship_product_supplier_eligible(public.dropship_products) from public, anon;
grant execute on function public.dropship_product_supplier_eligible(public.dropship_products) to authenticated, service_role;

-- Update get_dropship_countries, get_dropship_catalogue, and get_dropship_product to return model_no (never octopus_sku,
-- legacy_sku, sourcing_product_id, supplier_product_id, item_id, or cost) and never read frozen p.supplier_id.
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
                and public.dropship_product_supplier_eligible(p)
           ) as has_active_routes
      from public.dropship_markets m
     where m.org_id = v_org
     order by m.country;
end $$;

revoke all on function public.get_dropship_countries() from public, anon;
grant execute on function public.get_dropship_countries() to authenticated, service_role;

drop function if exists public.get_dropship_catalogue(text, text, text, integer);

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
             p.stock_status,
             p.created_at,
             (
               select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', v.id,
                     'model_no', v.model_no,
                     'options', v.options,
                     'price_adjust_cents', v.price_adjust_cents,
                     'stock_status', v.stock_status
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
           e.stock_status,
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
           'stock_status', p.stock_status,
           'variants', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'id', v.id,
                 'model_no', v.model_no,
                 'options', v.options,
                 'price_adjust_cents', v.price_adjust_cents,
                 'stock_status', v.stock_status
               ) order by v.sort, v.model_no
             )
             from public.dropship_variants v where v.product_id = p.id
           ), '[]'::jsonb),
           'routes', coalesce((
             select jsonb_agg(
               jsonb_build_object(
                 'destination_country', r.destination_country,
                 'shipping_method', r.shipping_method,
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
     and public.dropship_product_supplier_eligible(p)
     and exists (
       select 1 from public.dropship_routes r
        where r.product_id = p.id and r.destination_country = v_country and r.is_active
     );

  return v_res;
end $$;

revoke all on function public.get_dropship_product(uuid, text) from public, anon;
grant execute on function public.get_dropship_product(uuid, text) to authenticated, service_role;
