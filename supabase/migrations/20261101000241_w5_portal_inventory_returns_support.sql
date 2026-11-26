-- 20261101000241_w5_portal_inventory_returns_support.sql
-- Warehouse OS · W5 (client portal: Inventory, Returns, Integrations, Support; staff Returns screen). Design:
-- docs/design/warehouse-os §3 step 11 ("returns are inspected and photographed, and the client chooses restock, discard or send
-- back"); §5 boards 18 (Inventory), 19 (Orders and proof — polish is UI only), 21 (Returns), 23 (Integrations — UI only),
-- 24 (Support).
--  1. Inventory (board 18): wh_portal_inventory(org) — per client SKU: on hand / reserved / available per warehouse (the stock
--     ledger's warehouse_stock), incoming (open stock notices, lines not counted into stock yet), being checked (blocked lots),
--     units shipped in the last 30 days and days of cover = available ÷ (shipped in 30 days ÷ 30), rounded down. No shipments
--     in 30 days → days of cover is EMPTY (unknown), never 0. Product photos: private bucket 'wh-products'
--     (<org>/<sku id>/<uuid>.jpg|png|webp), uploaded by the client company's members, read by them and warehouse staff;
--     wh_set_sku_image() records the path on wh_client_skus.image_path (column from W2a).
--  2. Returns (board 21): wh_returns RT-#### (client company, warehouse, original order optional, carrier reference, reason)
--     + wh_return_lines (client SKU, units, condition) + wh_return_photos (private bucket 'wh-returns',
--     <WH>/<RT-code>/<uuid>.jpg|png|webp). received → inspected (every line graded good / damaged / unsellable, at least one
--     photo; returns_per_item charge copied from the client's active rate plan, EMPTY when not set; decide-by date = inspection
--     + 14 days) → decided (the CLIENT chooses restock / discard / send back; can change it until the warehouse completes) →
--     done (warehouse staff carry it out):
--       restock   = good units go back into stock: ledger 'adjust_in' through record_warehouse_stock_movement() (W2b's
--                   wh_post_movement, internal flag) + one RELEASED lot per line, not in a bin (W2b putaway places it);
--                   damaged / unsellable units are disposed of. Refused when no unit is good.
--       discard   = nothing is posted; every unit is disposed of.
--       send back = the returned units themselves go back to the client: a warehouse order to the address the client gave
--                   (WO-######, external_ref = RT code) — the units are booked in ('adjust_in'), reserved and picked for that
--                   order in the same transaction (net 0 on hand, no bin involved: the units are at the returns desk) so the
--                   order goes straight to the packing station ('picked') and gets the usual packing proof, label and tracking.
--     No decision by the decide-by date → a supervisor may apply the default: restock when a unit is good, else discard.
--  3. Support (board 24): warehouse requests are ordinary tickets (category 'warehouse', 3PL division) created by
--     wh_create_support_request() with a type (order problem, inbound, return, billing, other) and an optional reference to the
--     company's own order / stock notice / return (wh_support_links). Thread, replies, attachments and the staff inbox are the
--     existing support system; wh_ticket_context() gives both sides the linked warehouse record (packing proof link).
--  Writes only through wh_* security-definer functions (set search_path = public; not executable by public / anon). New tables
--  are staff-only (RLS wh_sees / support viewers); clients read their own data through the wh_portal_* functions. Integer
--  units and cents. Every step audit-logged. No existing function is replaced (wipe_demo_data included): new rows hang off
--  organizations / tickets with ON DELETE CASCADE and off orders / lots / notices with ON DELETE SET NULL.
-- Down: supabase/migrations/down/20261101000241_w5_portal_inventory_returns_support.down.sql

create sequence if not exists public.seq_wh_return;
revoke all on sequence public.seq_wh_return from public, anon, authenticated;
grant all on sequence public.seq_wh_return to service_role;

-- board 31: returns are their own line in the roles table (receivers, supervisors, admins)
insert into public.wh_role_capabilities (role, action, label, sort)
select r, 'returns', 'Register, inspect and complete returns', 13
  from unnest(array['receiver', 'supervisor', 'admin']) r
on conflict do nothing;

-- ───────── 1. Returns ─────────
create table if not exists public.wh_returns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RT-' || lpad(nextval('public.seq_wh_return')::text, 4, '0')),
  org_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  order_id uuid references public.wh_orders(id) on delete set null,
  carrier_ref text check (carrier_ref is null or (btrim(carrier_ref) <> '' and length(carrier_ref) <= 64)),
  reason text check (reason is null or length(reason) <= 500),
  status text not null default 'received' check (status in ('received', 'inspected', 'decided', 'done')),
  condition_note text check (condition_note is null or length(condition_note) <= 1000),
  decide_by timestamptz,
  decision text check (decision is null or decision in ('restock', 'discard', 'send_back')),
  decision_source text check (decision_source is null or decision_source in ('client', 'default')),
  send_back_to jsonb check (send_back_to is null or jsonb_typeof(send_back_to) = 'object'),
  outbound_order_id uuid references public.wh_orders(id) on delete set null,
  charge_units integer check (charge_units is null or charge_units >= 0),
  charge_per_item_cents bigint check (charge_per_item_cents is null or charge_per_item_cents >= 0),
  charge_cents bigint check (charge_cents is null or charge_cents >= 0),
  invoiced_at timestamptz,
  received_by uuid references auth.users(id) on delete set null,
  inspected_by uuid references auth.users(id) on delete set null,
  inspected_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz,
  done_note text check (done_note is null or length(done_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_returns_inspected check (status = 'received' or (inspected_at is not null and decide_by is not null)),
  constraint wh_returns_decided check (status not in ('decided', 'done') or (decision is not null and decision_source is not null and decided_at is not null)),
  constraint wh_returns_send_back check (decision is distinct from 'send_back' or send_back_to is not null),
  constraint wh_returns_done check (status <> 'done' or done_at is not null),
  constraint wh_returns_charge check (charge_cents is null or (charge_per_item_cents is not null and charge_units is not null and charge_cents = charge_per_item_cents * charge_units))
);
create index if not exists wh_returns_org_idx on public.wh_returns (org_id, created_at desc);
create index if not exists wh_returns_wh_status_idx on public.wh_returns (warehouse_code, status, created_at desc);
create index if not exists wh_returns_order_idx on public.wh_returns (order_id) where order_id is not null;
create index if not exists wh_returns_outbound_idx on public.wh_returns (outbound_order_id) where outbound_order_id is not null;
comment on table public.wh_returns is 'Warehouse OS: returns (RT-####). received → inspected → decided (client: restock / discard / send back) → done. Staff only; clients read their own through wh_portal_returns(). Written through wh_* functions only.';
alter table public.wh_returns enable row level security;
revoke all on public.wh_returns from public, anon, authenticated;
grant select on public.wh_returns to authenticated;
grant all on public.wh_returns to service_role;
drop policy if exists wh_returns_read on public.wh_returns;
create policy wh_returns_read on public.wh_returns for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.wh_returns(id) on delete cascade,
  item_id uuid not null references public.item_master(id) on delete restrict,
  sku text not null check (btrim(sku) <> '' and length(sku) <= 64),
  name text not null check (btrim(name) <> '' and length(name) <= 300),
  qty integer not null check (qty between 1 and 10000),
  condition text not null default 'unchecked' check (condition in ('unchecked', 'good', 'damaged', 'unsellable')),
  lot_id uuid references public.wh_lots(id) on delete set null,
  movement_id uuid,
  created_at timestamptz not null default now(),
  constraint wh_return_lines_one_item unique (return_id, item_id)
);
create index if not exists wh_return_lines_lot_idx on public.wh_return_lines (lot_id) where lot_id is not null;
comment on table public.wh_return_lines is 'Warehouse OS: return lines (client SKU snapshot, units, condition graded at inspection, restock lot + ledger movement). Staff only.';
alter table public.wh_return_lines enable row level security;
revoke all on public.wh_return_lines from public, anon, authenticated;
grant select on public.wh_return_lines to authenticated;
grant all on public.wh_return_lines to service_role;
drop policy if exists wh_return_lines_read on public.wh_return_lines;
create policy wh_return_lines_read on public.wh_return_lines for select to authenticated
  using (exists (select 1 from public.wh_returns r where r.id = return_id));

create table if not exists public.wh_return_photos (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.wh_returns(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  storage_path text not null unique check (storage_path ~ '^[A-Z]{2,4}-[0-9]{2}/RT-[0-9]{4,}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wh_return_photos_return_idx on public.wh_return_photos (return_id);
comment on table public.wh_return_photos is 'Warehouse OS: inspection photos of a return (private bucket wh-returns). Staff only; clients read their own through wh_portal_returns() + signed URLs.';
alter table public.wh_return_photos enable row level security;
revoke all on public.wh_return_photos from public, anon, authenticated;
grant select on public.wh_return_photos to authenticated;
grant all on public.wh_return_photos to service_role;
drop policy if exists wh_return_photos_read on public.wh_return_photos;
create policy wh_return_photos_read on public.wh_return_photos for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 2. Support links (warehouse requests on the existing tickets) ─────────
create table if not exists public.wh_support_links (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('order_problem', 'inbound', 'return', 'billing', 'other')),
  order_id uuid references public.wh_orders(id) on delete set null,
  asn_id uuid references public.wh_asns(id) on delete set null,
  return_id uuid references public.wh_returns(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wh_support_links_one_ref check (num_nonnulls(order_id, asn_id, return_id) <= 1)
);
create index if not exists wh_support_links_org_idx on public.wh_support_links (org_id, created_at desc);
create index if not exists wh_support_links_order_idx on public.wh_support_links (order_id) where order_id is not null;
comment on table public.wh_support_links is 'Warehouse OS: the type and the warehouse record (order / stock notice / return) of a warehouse support request. Support staff only; clients read through wh_portal_support() / wh_ticket_context().';
alter table public.wh_support_links enable row level security;
revoke all on public.wh_support_links from public, anon, authenticated;
grant select on public.wh_support_links to authenticated;
grant all on public.wh_support_links to service_role;
drop policy if exists wh_support_links_read on public.wh_support_links;
create policy wh_support_links_read on public.wh_support_links for select to authenticated using (can('support', 'view'));

-- ───────── 3. Private buckets ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wh-returns', 'wh-returns', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wh-products', 'wh-products', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- staff who handle returns at the warehouse upload photos while the return is received / being inspected
create or replace function public.wh_return_photo_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(p_name, '') ~ '^[A-Z]{2,4}-[0-9]{2}/RT-[0-9]{4,}/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    exists (select 1 from public.wh_returns r
             where r.warehouse_code = split_part(p_name, '/', 1) and r.code = split_part(p_name, '/', 2) and r.status in ('received', 'inspected'))
    and public.wh_can('returns', split_part(p_name, '/', 1))
  else false end
$$;
revoke all on function public.wh_return_photo_can_upload(text) from public, anon;
grant execute on function public.wh_return_photo_can_upload(text) to authenticated, service_role;

-- staff who see the warehouse, or members of the company that owns the return (recorded photos only)
create or replace function public.wh_return_photo_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.wh_sees(split_part(coalesce(p_name, ''), '/', 1))
      or exists (select 1 from public.wh_return_photos p join public.wh_returns r on r.id = p.return_id
                  where p.storage_path = p_name and r.org_id in (select public.my_org_ids()))
$$;
revoke all on function public.wh_return_photo_can_read(text) from public, anon;
grant execute on function public.wh_return_photo_can_read(text) to authenticated, service_role;

-- members of an approved, active client company upload a photo of their own product: <org>/<sku id>/<uuid>.<ext>
create or replace function public.wh_product_photo_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(p_name, '') ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    exists (select 1 from public.wh_client_skus k
             where k.org_id::text = split_part(p_name, '/', 1) and k.id::text = split_part(p_name, '/', 2)
               and public.wh_is_client_member(k.org_id))
  else false end
$$;
revoke all on function public.wh_product_photo_can_upload(text) from public, anon;
grant execute on function public.wh_product_photo_can_upload(text) to authenticated, service_role;

-- the owning company's members, or warehouse staff (same staff rule as wh_client_skus)
create or replace function public.wh_product_photo_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wh_client_skus k
                  where k.org_id::text = split_part(coalesce(p_name, ''), '/', 1) and k.id::text = split_part(coalesce(p_name, ''), '/', 2)
                    and (k.org_id in (select public.my_org_ids())
                         or (is_staff() and not distributor_restricted()
                             and (is_admin() or can('warehouse', 'view')
                                  or exists (select 1 from public.warehouse_staff s where s.user_id = auth.uid() and s.suspended_at is null)))))
$$;
revoke all on function public.wh_product_photo_can_read(text) from public, anon;
grant execute on function public.wh_product_photo_can_read(text) to authenticated, service_role;

drop policy if exists "wh returns upload" on storage.objects;
create policy "wh returns upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'wh-returns' and public.wh_return_photo_can_upload(name));
drop policy if exists "wh returns read" on storage.objects;
create policy "wh returns read" on storage.objects for select to authenticated
  using (bucket_id = 'wh-returns' and public.wh_return_photo_can_read(name));
drop policy if exists "wh products upload" on storage.objects;
create policy "wh products upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'wh-products' and public.wh_product_photo_can_upload(name));
drop policy if exists "wh products read" on storage.objects;
create policy "wh products read" on storage.objects for select to authenticated
  using (bucket_id = 'wh-products' and public.wh_product_photo_can_read(name));

-- ───────── 4. Internal helpers ─────────
-- returns_per_item of the client's active rate version (warehouse-specific first, then all warehouses); NULL = not set
create or replace function public.wh_return_rate(p_org uuid, p_warehouse text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select v.returns_per_item_cents
    from public.wh_rate_versions v join public.wh_clients c on c.plan_code = v.plan_code
   where c.org_id = p_org and v.status = 'active' and (v.warehouse_code = p_warehouse or v.warehouse_code is null)
   order by (v.warehouse_code is null), v.version desc
   limit 1
$$;
revoke all on function public.wh_return_rate(uuid, text) from public, anon, authenticated;
grant execute on function public.wh_return_rate(uuid, text) to service_role;

-- one return as JSON; p_staff adds the company, people and lot codes (clients never see staff names)
create or replace function public.wh_return_json(r public.wh_returns, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id, 'code', r.code, 'org_id', r.org_id, 'warehouse_code', r.warehouse_code,
    'warehouse', (select w.name from public.warehouses w where w.code = r.warehouse_code),
    'order_code', (select o.code from public.wh_orders o where o.id = r.order_id),
    'order_ref', (select o.external_ref from public.wh_orders o where o.id = r.order_id),
    'carrier_ref', r.carrier_ref, 'reason', r.reason, 'status', r.status, 'condition_note', r.condition_note,
    'decide_by', r.decide_by, 'overdue', r.status = 'inspected' and r.decide_by < now(),
    'decision', r.decision, 'decision_source', r.decision_source, 'decided_at', r.decided_at,
    'send_back_to', r.send_back_to,
    'outbound_order', (select jsonb_build_object('code', o.code, 'status', o.status, 'tracking_token', o.tracking_token)
                         from public.wh_orders o where o.id = r.outbound_order_id),
    'charge_units', r.charge_units, 'charge_per_item_cents', r.charge_per_item_cents, 'charge_cents', r.charge_cents,
    'created_at', r.created_at, 'inspected_at', r.inspected_at, 'done_at', r.done_at,
    'units', (select coalesce(sum(l.qty), 0) from public.wh_return_lines l where l.return_id = r.id),
    'good_units', (select coalesce(sum(l.qty), 0) from public.wh_return_lines l where l.return_id = r.id and l.condition = 'good'),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'sku', l.sku, 'name', l.name, 'qty', l.qty, 'condition', l.condition,
                                                           'lot_code', case when p_staff then (select t.lot_code from public.wh_lots t where t.id = l.lot_id) end)
                                        order by l.sku)
                         from public.wh_return_lines l where l.return_id = r.id), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', p.storage_path, 'at', p.created_at) order by p.created_at)
                          from public.wh_return_photos p where p.return_id = r.id), '[]'::jsonb))
  || case when p_staff then jsonb_build_object(
       'owner', (select o.name from public.organizations o where o.id = r.org_id),
       'done_note', r.done_note,
       'received_by_name', (select p.full_name from public.profiles p where p.id = r.received_by),
       'inspected_by_name', (select p.full_name from public.profiles p where p.id = r.inspected_by),
       'done_by_name', (select p.full_name from public.profiles p where p.id = r.done_by))
     else '{}'::jsonb end
$$;
revoke all on function public.wh_return_json(public.wh_returns, boolean) from public, anon, authenticated;
grant execute on function public.wh_return_json(public.wh_returns, boolean) to service_role;

-- ───────── 5. Returns: staff steps ─────────
-- registers an incoming return of a client company. p_lines: [{sku_id | sku, qty}] — the company's own products.
create or replace function public.wh_return_register(
  p_org uuid, p_warehouse text, p_order_code text, p_carrier_ref text, p_reason text, p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh text := upper(btrim(coalesce(p_warehouse, '')));
  v_order uuid;
  v_ref text := nullif(btrim(coalesce(p_carrier_ref, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_code text := nullif(upper(btrim(coalesce(p_order_code, ''))), '');
  v_line jsonb;
  v_qty text;
  v_sku public.wh_client_skus;
  v_seen uuid[] := '{}';
  v_row public.wh_returns;
begin
  if not public.wh_can('returns', v_wh) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.warehouses where code = v_wh and status = 'active') then
    raise exception 'INVALID_WAREHOUSE: % is not an active warehouse', v_wh;
  end if;
  if p_org is null or not exists (select 1 from public.wh_clients c where c.org_id = p_org) then
    raise exception 'INVALID_CLIENT: choose a 3PL client';
  end if;
  if v_ref is not null and length(v_ref) > 64 then raise exception 'INVALID_REFERENCE: the carrier reference has up to 64 characters'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'INVALID_REASON: up to 500 characters'; end if;
  if v_code is not null then
    select id into v_order from public.wh_orders where code = v_code and org_id = p_org;
    if v_order is null then raise exception 'ORDER_NOT_FOUND: % is not an order of this client', v_code; end if;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'NO_LINES: add at least one product';
  end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'TOO_MANY_LINES: up to 100 products per return'; end if;
  insert into public.wh_returns (org_id, warehouse_code, order_id, carrier_ref, reason, received_by)
  values (p_org, v_wh, v_order, v_ref, v_reason, auth.uid())
  returning * into v_row;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := btrim(coalesce(v_line ->> 'qty', ''));
    if v_qty !~ '^[0-9]{1,5}$' or v_qty::integer <= 0 or v_qty::integer > 10000 then
      raise exception 'INVALID_QTY: every line needs a quantity from 1 to 10,000';
    end if;
    select * into v_sku from public.wh_client_skus k
     where k.org_id = p_org
       and (k.id::text = coalesce(v_line ->> 'sku_id', '') or k.sku = upper(btrim(coalesce(v_line ->> 'sku', ''))))
     limit 1;
    if v_sku.id is null then raise exception 'UNKNOWN_SKU: a line is not one of this client''s products'; end if;
    if v_sku.item_id = any(v_seen) then raise exception 'DUPLICATE_LINE: % is on more than one line', v_sku.sku; end if;
    v_seen := v_seen || v_sku.item_id;
    insert into public.wh_return_lines (return_id, item_id, sku, name, qty)
    values (v_row.id, v_sku.item_id, v_sku.sku, v_sku.name, v_qty::integer);
  end loop;
  perform write_audit('wh_return.registered', 'wh_returns', v_row.id::text,
    jsonb_build_object('code', v_row.code, 'org_id', p_org, 'warehouse', v_wh, 'order_id', v_order, 'carrier_ref', v_ref,
                       'lines', jsonb_array_length(p_lines),
                       'units', (select sum(qty) from public.wh_return_lines where return_id = v_row.id)));
  return jsonb_build_object('id', v_row.id, 'code', v_row.code);
end $$;
revoke all on function public.wh_return_register(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.wh_return_register(uuid, text, text, text, text, jsonb) to authenticated, service_role;

-- records an uploaded inspection photo (the file must be in the private bucket under <WH>/<RT-code>/)
create or replace function public.wh_return_add_photo(p_return uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.wh_returns;
  v_path text := btrim(coalesce(p_path, ''));
begin
  select * into r from public.wh_returns where id = p_return for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('returns', r.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('received', 'inspected') then raise exception 'INVALID_STEP: % is already %', r.code, r.status; end if;
  if v_path !~ '^[A-Z]{2,4}-[0-9]{2}/RT-[0-9]{4,}/[0-9a-f-]{36}\.(jpg|png|webp)$'
     or split_part(v_path, '/', 1) <> r.warehouse_code or split_part(v_path, '/', 2) <> r.code then
    raise exception 'INVALID_PATH: the photo is not filed under %/%', r.warehouse_code, r.code;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'wh-returns' and o.name = v_path) then
    raise exception 'PHOTO_MISSING: upload the photo first';
  end if;
  if (select count(*) from public.wh_return_photos where return_id = r.id) >= 20 then
    raise exception 'TOO_MANY_PHOTOS: up to 20 photos per return';
  end if;
  insert into public.wh_return_photos (return_id, warehouse_code, storage_path, uploaded_by)
  values (r.id, r.warehouse_code, v_path, auth.uid());
  update public.wh_returns set updated_at = now() where id = r.id;
  perform write_audit('wh_return.photo_added', 'wh_returns', r.id::text, jsonb_build_object('code', r.code, 'path', v_path));
end $$;
revoke all on function public.wh_return_add_photo(uuid, text) from public, anon;
grant execute on function public.wh_return_add_photo(uuid, text) to authenticated, service_role;

-- inspection: every line graded, at least one photo; the charge is copied from the client's rate plan (empty = not set).
-- p_lines: [{line_id, condition}] with condition good | damaged | unsellable. Can be corrected until the client decides.
create or replace function public.wh_return_inspect(p_return uuid, p_lines jsonb, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.wh_returns;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_line jsonb;
  v_cond text;
  v_n integer;
  v_units integer;
  v_rate bigint;
begin
  select * into r from public.wh_returns where id = p_return for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('returns', r.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('received', 'inspected') then raise exception 'INVALID_STEP: % is already %', r.code, r.status; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'INVALID_NOTE: up to 1,000 characters'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_LINES'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_cond := lower(btrim(coalesce(v_line ->> 'condition', '')));
    if v_cond not in ('good', 'damaged', 'unsellable') then raise exception 'INVALID_CONDITION: choose good, damaged or unsellable for every product'; end if;
    update public.wh_return_lines set condition = v_cond where id::text = coalesce(v_line ->> 'line_id', '') and return_id = r.id;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'INVALID_LINES: a line is not on %', r.code; end if;
  end loop;
  if exists (select 1 from public.wh_return_lines where return_id = r.id and condition = 'unchecked') then
    raise exception 'NOT_GRADED: grade every product (good, damaged or unsellable)';
  end if;
  if not exists (select 1 from public.wh_return_photos where return_id = r.id) then
    raise exception 'PHOTO_REQUIRED: add at least one photo of the return';
  end if;
  select coalesce(sum(qty), 0)::integer into v_units from public.wh_return_lines where return_id = r.id;
  v_rate := public.wh_return_rate(r.org_id, r.warehouse_code);
  update public.wh_returns
     set status = 'inspected', condition_note = v_note, inspected_by = auth.uid(), inspected_at = now(),
         decide_by = coalesce(decide_by, now() + interval '14 days'),
         charge_units = v_units, charge_per_item_cents = v_rate, charge_cents = case when v_rate is null then null else v_rate * v_units end,
         updated_at = now()
   where id = r.id
   returning * into r;
  perform write_audit('wh_return.inspected', 'wh_returns', r.id::text,
    jsonb_build_object('code', r.code, 'units', v_units, 'good', (select coalesce(sum(qty), 0) from public.wh_return_lines where return_id = r.id and condition = 'good'),
                       'charge_cents', r.charge_cents, 'decide_by', r.decide_by));
  return jsonb_build_object('code', r.code, 'decide_by', r.decide_by, 'charge_cents', r.charge_cents);
end $$;
revoke all on function public.wh_return_inspect(uuid, jsonb, text) from public, anon;
grant execute on function public.wh_return_inspect(uuid, jsonb, text) to authenticated, service_role;

-- the client decides: restock | discard | send_back (send back: p_ship {name, phone?, line1, line2?, city, region?, postcode?, country})
create or replace function public.wh_return_decide(p_return uuid, p_decision text, p_ship jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.wh_returns;
  v_dec text := lower(btrim(coalesce(p_decision, '')));
  v_checked jsonb;
  v_to jsonb;
begin
  select * into r from public.wh_returns where id = p_return for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_is_client_member(r.org_id) then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('inspected', 'decided') then
    raise exception 'INVALID_STEP: %', case r.status when 'received' then 'we have not inspected this return yet' else 'the warehouse has already completed this return' end;
  end if;
  if v_dec not in ('restock', 'discard', 'send_back') then raise exception 'INVALID_DECISION: choose restock, discard or send back'; end if;
  if v_dec = 'restock' and not exists (select 1 from public.wh_return_lines where return_id = r.id and condition = 'good') then
    raise exception 'NOTHING_TO_RESTOCK: no unit passed inspection; choose discard or send back';
  end if;
  if v_dec = 'send_back' then
    v_checked := public.wh_check_client_order(r.org_id, jsonb_build_object(
      'external_ref', r.code, 'ship', coalesce(p_ship, '{}'::jsonb),
      'lines', (select jsonb_agg(jsonb_build_object('sku_id', k.id, 'qty', l.qty) order by l.sku)
                  from public.wh_return_lines l join public.wh_client_skus k on k.item_id = l.item_id and k.org_id = r.org_id
                 where l.return_id = r.id)));
    v_to := jsonb_build_object('ship_name', v_checked ->> 'ship_name', 'ship_phone', v_checked ->> 'ship_phone',
                               'ship_country', v_checked ->> 'ship_country', 'ship_address', v_checked -> 'ship_address');
  end if;
  update public.wh_returns
     set status = 'decided', decision = v_dec, decision_source = 'client', decided_by = auth.uid(), decided_at = now(),
         send_back_to = v_to, updated_at = now()
   where id = r.id;
  perform write_audit('wh_return.decided', 'wh_returns', r.id::text,
    jsonb_build_object('code', r.code, 'decision', v_dec, 'previous', r.decision, 'source', 'client'));
  return jsonb_build_object('code', r.code, 'decision', v_dec);
end $$;
revoke all on function public.wh_return_decide(uuid, text, jsonb) from public, anon;
grant execute on function public.wh_return_decide(uuid, text, jsonb) to authenticated, service_role;

-- no decision by the decide-by date: a supervisor applies the default (restock when a unit is good, else discard)
create or replace function public.wh_return_apply_default(p_return uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.wh_returns;
  v_dec text;
begin
  select * into r from public.wh_returns where id = p_return for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('resolve_exception', r.warehouse_code) then raise exception 'FORBIDDEN: a supervisor applies the default decision'; end if;
  if r.status <> 'inspected' then raise exception 'INVALID_STEP: % is %, not waiting for a decision', r.code, r.status; end if;
  if r.decide_by >= now() then raise exception 'NOT_DUE: the client can decide until %', to_char(r.decide_by at time zone 'Asia/Shanghai', 'DD Mon YYYY HH24:MI'); end if;
  v_dec := case when exists (select 1 from public.wh_return_lines where return_id = r.id and condition = 'good') then 'restock' else 'discard' end;
  update public.wh_returns
     set status = 'decided', decision = v_dec, decision_source = 'default', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = r.id;
  perform write_audit('wh_return.default_applied', 'wh_returns', r.id::text, jsonb_build_object('code', r.code, 'decision', v_dec, 'decide_by', r.decide_by));
  return jsonb_build_object('code', r.code, 'decision', v_dec);
end $$;
revoke all on function public.wh_return_apply_default(uuid) from public, anon;
grant execute on function public.wh_return_apply_default(uuid) to authenticated, service_role;

-- the warehouse carries out the decision (see the header). Ledger postings only through record_warehouse_stock_movement()
-- (W2b wh_post_movement / W3a wh_post_order_movement, internal flag); actor stays the signed-in person.
create or replace function public.wh_return_complete(p_return uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.wh_returns;
  l public.wh_return_lines;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_mov uuid;
  v_lot uuid;
  v_units integer := 0;
  v_order public.wh_orders;
  v_lots text[] := '{}';
begin
  select * into r from public.wh_returns where id = p_return for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('returns', r.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if r.status <> 'decided' then raise exception 'INVALID_STEP: % is %, not decided', r.code, r.status; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'INVALID_NOTE: up to 500 characters'; end if;

  if r.decision = 'restock' then
    for l in select * from public.wh_return_lines where return_id = r.id and condition = 'good' order by sku loop
      v_mov := public.wh_post_movement(l.item_id, 'adjust_in', l.qty, format('Return %s restocked', r.code), r.warehouse_code);
      insert into public.wh_lots (warehouse_code, item_id, org_id, qty, status, created_by)
      values (r.warehouse_code, l.item_id, r.org_id, l.qty, 'released', auth.uid())
      returning id into v_lot;
      update public.wh_return_lines set lot_id = v_lot, movement_id = v_mov where id = l.id;
      v_lots := v_lots || (select lot_code from public.wh_lots where id = v_lot);
      v_units := v_units + l.qty;
    end loop;
    if v_units = 0 then raise exception 'NOTHING_TO_RESTOCK: no unit passed inspection'; end if;
  elsif r.decision = 'send_back' then
    insert into public.wh_orders (warehouse_code, source, org_id, external_ref, ship_name, ship_phone, ship_address, ship_country, created_by)
    values (r.warehouse_code, 'client_portal', r.org_id, r.code, r.send_back_to ->> 'ship_name', r.send_back_to ->> 'ship_phone',
            r.send_back_to -> 'ship_address', r.send_back_to ->> 'ship_country', auth.uid())
    returning * into v_order;
    insert into public.wh_order_lines (order_id, item_id, sku, barcode, name, qty, picked_qty, unit_weight_g)
    select v_order.id, rl.item_id, rl.sku, (select k.barcode from public.wh_client_skus k where k.item_id = rl.item_id), rl.name, rl.qty, rl.qty,
           (select i.weight_g from public.item_master i where i.id = rl.item_id)
      from public.wh_return_lines rl where rl.return_id = r.id;
    perform public.wh_refresh_dg(v_order.id);
    perform write_audit('wh_order.created', 'wh_orders', v_order.id::text,
      jsonb_build_object('code', v_order.code, 'source', 'return', 'return', r.code, 'org_id', r.org_id, 'external_ref', r.code,
                         'lines', (select count(*) from public.wh_return_lines where return_id = r.id),
                         'units', (select sum(qty) from public.wh_return_lines where return_id = r.id)));
    -- the returned units are at the returns desk: booked in, reserved and picked for this order (net 0 on hand, no bin)
    for l in select * from public.wh_return_lines where return_id = r.id order by item_id loop
      v_mov := public.wh_post_movement(l.item_id, 'adjust_in', l.qty, format('Return %s received for sending back (%s)', r.code, v_order.code), r.warehouse_code);
      perform public.wh_post_order_movement(v_order.id, l.item_id, 'reserve', l.qty, format('Warehouse order %s (return %s) allocated', v_order.code, r.code), r.warehouse_code);
      perform public.wh_post_order_movement(v_order.id, l.item_id, 'pick', l.qty, format('Order %s picked at the returns desk (return %s)', v_order.code, r.code), r.warehouse_code);
      update public.wh_return_lines set movement_id = v_mov where id = l.id;
      v_units := v_units + l.qty;
    end loop;
    update public.wh_orders set status = 'picked', allocated_at = now(), picked_at = now(), updated_at = now() where id = v_order.id;
    perform write_audit('wh_order.allocated', 'wh_orders', v_order.id::text, jsonb_build_object('code', v_order.code, 'warehouse', r.warehouse_code, 'return', r.code));
    perform write_audit('wh_order.picked', 'wh_orders', v_order.id::text, jsonb_build_object('code', v_order.code, 'return', r.code));
  end if;

  update public.wh_returns
     set status = 'done', done_by = auth.uid(), done_at = now(), done_note = v_note, outbound_order_id = v_order.id, updated_at = now()
   where id = r.id;
  perform write_audit('wh_return.done', 'wh_returns', r.id::text,
    jsonb_build_object('code', r.code, 'decision', r.decision, 'units', v_units, 'lots', to_jsonb(v_lots), 'order', v_order.code));
  return jsonb_build_object('code', r.code, 'decision', r.decision, 'units', v_units, 'lots', to_jsonb(v_lots), 'order_code', v_order.code);
end $$;
revoke all on function public.wh_return_complete(uuid, text) from public, anon;
grant execute on function public.wh_return_complete(uuid, text) to authenticated, service_role;

-- ───────── 6. Returns: reads ─────────
-- staff board: returns of the warehouses the caller sees (p_status open | done | all), the clients and their products for
-- the register form, and where the caller may register (returns) or apply defaults (resolve_exception)
create or replace function public.wh_returns_board(p_warehouse text default null, p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_whs text[];
begin
  if auth.uid() is null or not is_staff() then raise exception 'FORBIDDEN'; end if;
  select coalesce(array_agg(w.code order by w.code), '{}') into v_whs
    from public.warehouses w where public.wh_sees(w.code) and (p_warehouse is null or w.code = p_warehouse);
  if cardinality(v_whs) = 0 then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'returns', coalesce((select jsonb_agg(public.wh_return_json(r, true) order by (r.status = 'done'), r.created_at desc)
                           from public.wh_returns r
                          where r.id in (select x.id from public.wh_returns x
                                          where x.warehouse_code = any(v_whs)
                                            and (coalesce(p_status, 'open') = 'all' or (p_status = 'done' and x.status = 'done')
                                                 or (coalesce(p_status, 'open') = 'open' and x.status <> 'done'))
                                          order by x.created_at desc limit 300)), '[]'::jsonb),
    'counts', (select jsonb_build_object(
                 'received', count(*) filter (where status = 'received'), 'inspected', count(*) filter (where status = 'inspected'),
                 'decided', count(*) filter (where status = 'decided'), 'overdue', count(*) filter (where status = 'inspected' and decide_by < now()))
                 from public.wh_returns where warehouse_code = any(v_whs)),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('org_id', c.org_id, 'name', o.name) order by o.name)
                           from public.wh_clients c join public.organizations o on o.id = c.org_id where c.status <> 'closed'), '[]'::jsonb),
    'skus', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'org_id', k.org_id, 'sku', k.sku, 'name', k.name, 'status', k.status) order by k.sku)
                        from (select k2.* from public.wh_client_skus k2 join public.wh_clients c on c.org_id = k2.org_id and c.status <> 'closed'
                               order by k2.sku limit 5000) k), '[]'::jsonb),
    'can_returns', to_jsonb(array(select c from unnest(v_whs) c where public.wh_can('returns', c))),
    'can_default', to_jsonb(array(select c from unnest(v_whs) c where public.wh_can('resolve_exception', c))),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('code', w.code, 'name', w.name) order by w.code)
                              from public.warehouses w where w.code = any(v_whs) and w.status = 'active'), '[]'::jsonb));
end $$;
revoke all on function public.wh_returns_board(text, text) from public, anon;
grant execute on function public.wh_returns_board(text, text) to authenticated, service_role;

-- portal: the company's own returns (newest first)
create or replace function public.wh_portal_returns(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_org is null or p_org not in (select public.my_org_ids()) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(public.wh_return_json(r, false) order by r.created_at desc)
                     from public.wh_returns r
                    where r.id in (select x.id from public.wh_returns x where x.org_id = p_org order by x.created_at desc limit 200)), '[]'::jsonb);
end $$;
revoke all on function public.wh_portal_returns(uuid) from public, anon;
grant execute on function public.wh_portal_returns(uuid) to authenticated, service_role;

-- ───────── 7. Inventory (board 18) ─────────
-- per client SKU: stock per warehouse, incoming, being checked, shipped in 30 days, days of cover (EMPTY without shipments)
create or replace function public.wh_portal_inventory(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or p_org is null or not (p_org in (select public.my_org_ids()) or public.wh_can_any('view')) then
    raise exception 'FORBIDDEN';
  end if;
  with k as (
    select * from public.wh_client_skus where org_id = p_org
  ), st as (
    select s.item_id, s.warehouse_id, s.on_hand_qty, s.reserved_qty
      from public.warehouse_stock s where s.item_id in (select item_id from k)
  ), inc as (
    select l.item_id, sum(l.expected_qty)::integer q
      from public.wh_asn_lines l join public.wh_asns a on a.id = l.asn_id
     where a.org_id = p_org and a.status in ('submitted', 'booked', 'arrived', 'receiving') and l.status in ('pending', 'counted')
     group by l.item_id
  ), chk as (
    select t.item_id, sum(t.qty)::integer q from public.wh_lots t where t.org_id = p_org and t.status = 'blocked' group by t.item_id
  ), shp as (
    select l.item_id, sum(l.qty)::integer q
      from public.wh_order_lines l join public.wh_orders o on o.id = l.order_id
     where o.org_id = p_org and o.status = 'shipped' and o.shipped_at >= now() - interval '30 days'
     group by l.item_id
  ), agg as (
    select k.id, k.sku, k.name, k.barcode, k.image_path, k.status, k.weight_g, k.has_battery, k.has_liquid,
           coalesce((select sum(on_hand_qty) from st where st.item_id = k.item_id), 0)::integer on_hand,
           coalesce((select sum(reserved_qty) from st where st.item_id = k.item_id), 0)::integer reserved,
           coalesce((select q from inc where inc.item_id = k.item_id), 0) incoming,
           coalesce((select q from chk where chk.item_id = k.item_id), 0) checking,
           coalesce((select q from shp where shp.item_id = k.item_id), 0) shipped_30d,
           coalesce((select jsonb_agg(jsonb_build_object('warehouse_code', st.warehouse_id, 'warehouse', w.name, 'on_hand', st.on_hand_qty,
                                                         'reserved', st.reserved_qty, 'available', st.on_hand_qty - st.reserved_qty) order by w.is_default desc, w.code)
                       from st join public.warehouses w on w.code = st.warehouse_id
                      where st.item_id = k.item_id and (st.on_hand_qty <> 0 or st.reserved_qty <> 0)), '[]'::jsonb) by_warehouse
      from k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'sku', a.sku, 'name', a.name, 'barcode', a.barcode, 'image_path', a.image_path, 'status', a.status,
           'weight_g', a.weight_g, 'has_battery', a.has_battery, 'has_liquid', a.has_liquid,
           'on_hand', a.on_hand, 'reserved', a.reserved, 'available', a.on_hand - a.reserved, 'incoming', a.incoming, 'checking', a.checking,
           'shipped_30d', a.shipped_30d,
           'days_cover', case when a.shipped_30d > 0 then floor(greatest(a.on_hand - a.reserved, 0) * 30.0 / a.shipped_30d)::integer end,
           'by_warehouse', a.by_warehouse) order by a.sku), '[]'::jsonb)
    into v_rows
    from agg a
   where a.status = 'active' or a.on_hand <> 0 or a.reserved <> 0 or a.incoming <> 0 or a.checking <> 0;
  return jsonb_build_object(
    'skus', v_rows,
    'totals', jsonb_build_object(
      'on_hand', coalesce((select sum((x ->> 'on_hand')::integer) from jsonb_array_elements(v_rows) x), 0),
      'reserved', coalesce((select sum((x ->> 'reserved')::integer) from jsonb_array_elements(v_rows) x), 0),
      'available', coalesce((select sum((x ->> 'available')::integer) from jsonb_array_elements(v_rows) x), 0),
      'incoming', coalesce((select sum((x ->> 'incoming')::integer) from jsonb_array_elements(v_rows) x), 0),
      'checking', coalesce((select sum((x ->> 'checking')::integer) from jsonb_array_elements(v_rows) x), 0)));
end $$;
revoke all on function public.wh_portal_inventory(uuid) from public, anon;
grant execute on function public.wh_portal_inventory(uuid) to authenticated, service_role;

-- records an uploaded product photo (<org>/<sku id>/<uuid>.<ext> in the private wh-products bucket) on the client SKU
create or replace function public.wh_set_sku_image(p_sku uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.wh_client_skus;
  v_path text := btrim(coalesce(p_path, ''));
begin
  select * into k from public.wh_client_skus where id = p_sku for update;
  if k.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_is_client_member(k.org_id) then raise exception 'FORBIDDEN'; end if;
  if v_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
     or split_part(v_path, '/', 1) <> k.org_id::text or split_part(v_path, '/', 2) <> k.id::text then
    raise exception 'INVALID_PATH: the photo is not filed under this product';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'wh-products' and o.name = v_path) then
    raise exception 'PHOTO_MISSING: upload the photo first';
  end if;
  update public.wh_client_skus set image_path = v_path, updated_at = now() where id = k.id;
  perform write_audit('wh_client_sku.photo_set', 'wh_client_skus', k.id::text, jsonb_build_object('sku', k.sku, 'path', v_path, 'previous', k.image_path));
end $$;
revoke all on function public.wh_set_sku_image(uuid, text) from public, anon;
grant execute on function public.wh_set_sku_image(uuid, text) to authenticated, service_role;

-- ───────── 8. Support (board 24) ─────────
-- a warehouse request as an ordinary ticket (category 'warehouse', 3PL division) + its type and optional reference
-- (WO-… order, ASN-… stock notice or RT-… return of the same company). Attachments are files the member uploaded to the
-- existing 'tickets' bucket under the company's folder (<org>/…), as the existing ticket form does.
create or replace function public.wh_create_support_request(
  p_org uuid, p_kind text, p_subject text, p_body text, p_ref text default null, p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_ref text := nullif(upper(btrim(coalesce(p_ref, ''))), '');
  v_att jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_order uuid;
  v_asn uuid;
  v_return uuid;
  v_hours integer;
  v_id uuid;
  v_code text;
  a jsonb;
begin
  if auth.uid() is null or p_org is null or p_org not in (select public.my_org_ids())
     or not exists (select 1 from public.wh_clients c where c.org_id = p_org) then
    raise exception 'FORBIDDEN: only members of a 3PL client company send warehouse requests';
  end if;
  if v_kind not in ('order_problem', 'inbound', 'return', 'billing', 'other') then raise exception 'INVALID_TYPE: choose the type of request'; end if;
  if length(v_subject) < 3 or length(v_subject) > 200 then raise exception 'INVALID_SUBJECT: enter a short subject (3 to 200 characters)'; end if;
  if length(v_body) < 5 or length(v_body) > 10000 then raise exception 'INVALID_MESSAGE: describe the problem or question (5 to 10,000 characters)'; end if;
  if v_ref ~ '^WO-[0-9]{6,}$' then
    select id into v_order from public.wh_orders where code = v_ref and org_id = p_org;
    if v_order is null then raise exception 'INVALID_REFERENCE: % is not one of your orders', v_ref; end if;
  elsif v_ref ~ '^ASN-[0-9]{4,}$' then
    select id into v_asn from public.wh_asns where code = v_ref and org_id = p_org;
    if v_asn is null then raise exception 'INVALID_REFERENCE: % is not one of your stock notices', v_ref; end if;
  elsif v_ref ~ '^RT-[0-9]{4,}$' then
    select id into v_return from public.wh_returns where code = v_ref and org_id = p_org;
    if v_return is null then raise exception 'INVALID_REFERENCE: % is not one of your returns', v_ref; end if;
  elsif v_ref is not null then
    raise exception 'INVALID_REFERENCE: use an order (WO-…), stock notice (ASN-…) or return (RT-…) number';
  end if;
  if jsonb_typeof(v_att) <> 'array' or jsonb_array_length(v_att) > 10 then raise exception 'INVALID_ATTACHMENTS: up to 10 files'; end if;
  for a in select * from jsonb_array_elements(v_att) loop
    if jsonb_typeof(a) <> 'object' or coalesce(a ->> 'path', '') = '' or length(a ->> 'path') > 500 or (a ->> 'path') like '%..%'
       or left(a ->> 'path', 37) <> (p_org::text || '/') or coalesce(a ->> 'name', '') = '' or length(a ->> 'name') > 300 then
      raise exception 'INVALID_ATTACHMENTS: a file is not in your company''s folder';
    end if;
  end loop;
  select first_response_hours into v_hours from public.sla_policies where priority = 'normal';
  insert into public.tickets (org_id, subject, category, priority, status, sla_due_at, created_by, division_id)
  values (p_org, v_subject, 'warehouse', 'normal', 'new', now() + make_interval(hours => coalesce(v_hours, 24)), auth.uid(), division_id_of('3PL'))
  returning id, code into v_id, v_code;
  insert into public.ticket_messages (ticket_id, org_id, author_id, body, attachments)
  values (v_id, p_org, auth.uid(), v_body, v_att);
  insert into public.wh_support_links (ticket_id, org_id, kind, order_id, asn_id, return_id)
  values (v_id, p_org, v_kind, v_order, v_asn, v_return);
  perform emit_event('ticket.created', 'ticket', v_id, jsonb_build_object('org_id', p_org));
  perform write_audit('wh_support.created', 'tickets', v_id::text,
    jsonb_build_object('code', v_code, 'org_id', p_org, 'kind', v_kind, 'ref', v_ref, 'attachments', jsonb_array_length(v_att)));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;
revoke all on function public.wh_create_support_request(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.wh_create_support_request(uuid, text, text, text, text, jsonb) to authenticated, service_role;

-- portal: the company's warehouse requests with their type, reference and status
create or replace function public.wh_portal_support(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_org is null or p_org not in (select public.my_org_ids()) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
             'id', t.id, 'code', t.code, 'subject', t.subject, 'status', t.status, 'kind', s.kind,
             'ref', coalesce((select o.code from public.wh_orders o where o.id = s.order_id), (select a.code from public.wh_asns a where a.id = s.asn_id),
                             (select r.code from public.wh_returns r where r.id = s.return_id)),
             'created_at', t.created_at, 'updated_at', t.updated_at,
             'messages', (select count(*) from public.ticket_messages m where m.ticket_id = t.id and not m.internal)) order by t.updated_at desc)
             from public.wh_support_links s join public.tickets t on t.id = s.ticket_id
            where s.org_id = p_org and t.org_id = p_org), '[]'::jsonb);
end $$;
revoke all on function public.wh_portal_support(uuid) from public, anon;
grant execute on function public.wh_portal_support(uuid) to authenticated, service_role;

-- both sides of a ticket: its warehouse type and record (NULL when the ticket is not a warehouse request). The order part
-- says whether a packing record exists (clients open it in the portal, staff on the Evidence screen).
create or replace function public.wh_ticket_context(p_ticket uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.tickets;
  s public.wh_support_links;
  v_staff boolean;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  v_staff := can('support', 'view');
  if not (v_staff or t.org_id in (select public.my_org_ids())) then raise exception 'NOT_FOUND'; end if;
  select * into s from public.wh_support_links where ticket_id = t.id;
  if s.ticket_id is null then return null; end if;
  return jsonb_build_object(
    'kind', s.kind,
    'owner', case when v_staff then (select o.name from public.organizations o where o.id = s.org_id) end,
    'order', (select jsonb_build_object('code', o.code, 'status', o.status, 'external_ref', o.external_ref, 'warehouse_code', o.warehouse_code,
                                        'packed', o.status in ('packed', 'labelled', 'shipped'),
                                        'photos', (select count(*) from public.wh_pack_evidence e where e.order_id = o.id and e.retention_until > now()),
                                        'tracking_token', o.tracking_token)
                from public.wh_orders o where o.id = s.order_id),
    'asn', (select jsonb_build_object('code', a.code, 'status', a.status, 'warehouse_code', a.warehouse_code) from public.wh_asns a where a.id = s.asn_id),
    'return', (select jsonb_build_object('code', r.code, 'status', r.status, 'decision', r.decision, 'warehouse_code', r.warehouse_code)
                 from public.wh_returns r where r.id = s.return_id));
end $$;
revoke all on function public.wh_ticket_context(uuid) from public, anon;
grant execute on function public.wh_ticket_context(uuid) to authenticated, service_role;
