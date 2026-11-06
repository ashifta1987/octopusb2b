-- HS code detection (6 Nov 2026): product types with a 4-digit heading (rules + AI cache), HS fields on products,
-- protection of sheet / manual codes, confirm / change-heading RPCs, backfill proposals.

create table if not exists hs_product_types (
  id uuid primary key default gen_random_uuid(),
  type_key text not null unique check (type_key ~ '^[a-z0-9]+( [a-z0-9]+)*$'),   -- normalised product type ("handheld fan")
  name text not null,
  keywords text[] not null default '{}',          -- each keyword matches when ALL its words appear in title / category / specs
  heading text check (heading is null or heading ~ '^[0-9]{4}$'),   -- null = AI was not confident enough (manual entry needed)
  confirmed boolean not null default false,
  source text not null default 'manual' check (source in ('seed', 'ai', 'manual')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reason text,
  confirmed_by uuid references auth.users(id), confirmed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table hs_product_types enable row level security;
drop policy if exists hs_types_read on hs_product_types;
create policy hs_types_read on hs_product_types for select using (can('products', 'view'));
drop policy if exists hs_types_write on hs_product_types;
create policy hs_types_write on hs_product_types for all using (can('products', 'approve') or is_admin()) with check (can('products', 'approve') or is_admin());

alter table products add column if not exists hs_code_source text check (hs_code_source is null or hs_code_source in ('sheet', 'rule', 'ai', 'manual'));
alter table products add column if not exists hs_code_confidence numeric(4,3) check (hs_code_confidence is null or (hs_code_confidence >= 0 and hs_code_confidence <= 1));
alter table products add column if not exists hs_code_status text not null default 'missing' check (hs_code_status in ('confirmed', 'suggested', 'missing'));
alter table products add column if not exists hs_product_type_id uuid references hs_product_types(id) on delete set null;
alter table products add column if not exists hs_classify_pending boolean not null default false;   -- queued for the background classifier
alter table products add column if not exists hs_code_note text;                                       -- e.g. "HS code needs manual entry"
create index if not exists products_hs_pending_idx on products(hs_classify_pending) where hs_classify_pending;
create index if not exists products_hs_type_idx on products(hs_product_type_id);

-- existing codes: entered by people → manual / confirmed
update products set hs_code_source = 'manual', hs_code_status = 'confirmed' where hs_code is not null and btrim(hs_code) <> '' and hs_code_source is null;

-- never overwrite a sheet-supplied or manually entered code with a rule / AI value; a code without a source is manual
create or replace function guard_hs_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.hs_code_source in ('sheet', 'manual') and coalesce(btrim(old.hs_code), '') <> ''
     and new.hs_code_source in ('rule', 'ai') then
    new.hs_code := old.hs_code; new.hs_code_source := old.hs_code_source; new.hs_code_status := old.hs_code_status;
    new.hs_code_confidence := old.hs_code_confidence; new.hs_product_type_id := old.hs_product_type_id;
    new.hs_classify_pending := false;
    return new;
  end if;
  if coalesce(btrim(new.hs_code), '') = '' then
    new.hs_code := null;
    if new.hs_code_source in ('sheet', 'manual') or (tg_op = 'UPDATE' and old.hs_code is not null and new.hs_code_source is not distinct from old.hs_code_source) then
      new.hs_code_source := null;
    end if;
    if new.hs_code_source is null then new.hs_code_status := 'missing'; new.hs_code_confidence := null; end if;
  elsif new.hs_code_source is null or (tg_op = 'UPDATE' and new.hs_code is distinct from old.hs_code and new.hs_code_source is not distinct from old.hs_code_source and old.hs_code_source in ('rule', 'ai')) then
    -- typed by a person (single form) without saying where it came from
    new.hs_code_source := 'manual'; new.hs_code_status := 'confirmed'; new.hs_code_confidence := null; new.hs_classify_pending := false;
  end if;
  if new.hs_code_source in ('sheet', 'manual') then new.hs_code_status := 'confirmed'; new.hs_classify_pending := false; new.hs_code_note := null; end if;
  return new;
end $$;
drop trigger if exists trg_guard_hs_code on products;
create trigger trg_guard_hs_code before insert or update of hs_code, hs_code_source, hs_code_status on products for each row execute function guard_hs_code();

-- confirm a type: heading becomes confirmed; every suggested product of that type → confirmed (audited per product)
create or replace function confirm_hs_type(p_type uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t hs_product_types; r record; n int := 0;
begin
  if not (can('products', 'approve') or is_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into t from hs_product_types where id = p_type for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.heading is null then raise exception 'HS_NO_HEADING: set a 4-digit heading before confirming'; end if;
  update hs_product_types set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now() where id = p_type;
  for r in select id, hs_code, hs_code_status from products where hs_product_type_id = p_type and hs_code_source in ('rule', 'ai') and hs_code_status <> 'confirmed' loop
    update products set hs_code = t.heading, hs_code_status = 'confirmed', hs_code_note = null where id = r.id;
    perform write_audit('product.hs_code_confirmed', 'products', r.id::text, jsonb_build_object('type', t.name, 'heading', t.heading, 'from_status', r.hs_code_status));
    n := n + 1;
  end loop;
  perform write_audit('hs_type.confirmed', 'hs_product_types', p_type::text, jsonb_build_object('type', t.name, 'heading', t.heading, 'products', n));
  return jsonb_build_object('type', t.name, 'heading', t.heading, 'products_confirmed', n);
end $$;
grant execute on function confirm_hs_type(uuid) to authenticated;

-- products a heading change would touch (preview) — sheet / manual codes are never touched
create or replace function hs_type_change_preview(p_type uuid, p_heading text) returns table(product_id uuid, sku text, title text, current_code text, new_code text, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku, p.title, p.hs_code, p_heading, p.hs_code_status from products p
  where p.hs_product_type_id = p_type and coalesce(p.hs_code_source, 'rule') in ('rule', 'ai') and (can('products', 'approve') or is_admin())
  order by p.sku
$$;
grant execute on function hs_type_change_preview(uuid, text) to authenticated;

-- change a type's heading (confirmed by the person changing it) and apply to all its rule / AI products
create or replace function change_hs_type_heading(p_type uuid, p_heading text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t hs_product_types; r record; n int := 0;
begin
  if not (can('products', 'approve') or is_admin()) then raise exception 'FORBIDDEN'; end if;
  if p_heading !~ '^[0-9]{4}$' then raise exception 'HS_BAD_HEADING: the heading must be exactly 4 digits'; end if;
  select * into t from hs_product_types where id = p_type for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  update hs_product_types set heading = p_heading, confirmed = true, source = 'manual', confidence = null, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now() where id = p_type;
  for r in select id, hs_code from products where hs_product_type_id = p_type and coalesce(hs_code_source, 'rule') in ('rule', 'ai') loop
    update products set hs_code = p_heading, hs_code_source = 'rule', hs_code_status = 'confirmed', hs_code_confidence = null, hs_code_note = null, hs_classify_pending = false where id = r.id;
    perform write_audit('product.hs_code_changed', 'products', r.id::text, jsonb_build_object('type', t.name, 'from', r.hs_code, 'to', p_heading));
    n := n + 1;
  end loop;
  perform write_audit('hs_type.heading_changed', 'hs_product_types', p_type::text, jsonb_build_object('type', t.name, 'from', t.heading, 'to', p_heading, 'products', n));
  return jsonb_build_object('type', t.name, 'heading', p_heading, 'products_updated', n);
end $$;
grant execute on function change_hs_type_heading(uuid, text) to authenticated;

-- backfill proposals (preview only; applied after the owner approves)
create table if not exists hs_backfill_proposals (
  product_id uuid primary key references products(id) on delete cascade,
  hs_product_type_id uuid references hs_product_types(id) on delete set null,
  heading text check (heading is null or heading ~ '^[0-9]{4}$'),
  source text check (source in ('rule', 'ai')), status text not null check (status in ('confirmed', 'suggested', 'missing')),
  confidence numeric(4,3), note text, created_at timestamptz not null default now()
);
alter table hs_backfill_proposals enable row level security;
drop policy if exists hs_proposals_read on hs_backfill_proposals;
create policy hs_proposals_read on hs_backfill_proposals for select using (can('products', 'view'));

insert into site_settings(key, value, description) values
  ('hs.ai_enabled', 'true'::jsonb, 'Use the AI classifier for HS headings when no rule matches.'),
  ('hs.ai_min_confidence', '0.8'::jsonb, 'Minimum AI confidence to fill a heading as suggested; below it the code stays blank and is flagged.'),
  ('hs.ai_max_calls_per_run', '10'::jsonb, 'Cost cap: AI calls (max 20 products each) per import / background run.')
on conflict (key) do nothing;

-- one unconfirmed example rule (owner confirms or changes it in Admin → HS codes)
insert into hs_product_types(type_key, name, keywords, heading, confirmed, source, reason) values
  ('electric fan', 'Electric fan (handheld, neck, desk)', array['fan'], '8414', false, 'seed', 'Heading 8414 covers fans; confirm for your products.')
on conflict (type_key) do nothing;

