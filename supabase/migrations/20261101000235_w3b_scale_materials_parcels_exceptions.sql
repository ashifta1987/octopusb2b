-- 20261101000235_w3b_scale_materials_parcels_exceptions.sql
-- Warehouse OS · W3b (scale benches, packaging materials, multi-parcel packing, exceptions queue). Design: docs/design/warehouse-os
-- boards 12 (Packaging materials), 14 (Multi-parcel packing), 17 (Scale check), 29 (Exceptions); §7 controls.
--  1. Scale benches per warehouse with calibration checks (reference weight vs reading, tolerance). A new bench, a bench whose
--     check settings change and a bench that FAILS a check are locked; only a passing check unlocks (CHECK constraint: 'ok' only
--     right after a passing check). After a failed check the unlocking check is run by a supervisor / admin. Once a warehouse
--     has an active bench, every scale reading names a usable bench (W3a station: wh_pack_weigh_on(); parcels: wh_parcel_weigh()).
--     The W3a wh_pack_weigh() is NOT replaced: a BEFORE UPDATE trigger on wh_orders refuses a new reading without a bench.
--  2. Packaging materials as stock per warehouse (box / mailer / tape / mark / filler / other). A material may stand for a W3a
--     box (wh_boxes) — that box is then taken from stock whenever a parcel closes in it; one battery-mark material per warehouse
--     can be used automatically for every parcel that carries the dangerous-goods mark. Receive / count / use / void post to
--     wh_material_moves (on_hand = sum of moves; never below 0). Every use is a row in wh_material_usage with the client company
--     and the unit charge at that time (NULL = not set; only a warehouse admin sets prices) — W6 invoices from it.
--  3. Multi-parcel packing: wh_parcels (+ wh_parcel_items, evidence / scan log / PIN attempts per parcel). Each parcel has its own
--     box, expected weight + tolerance, bench reading, supervisor override (two people, 3 wrong PINs lock), battery mark and
--     contents / sealed / scale photos. The order closes when every picked unit is in a closed parcel; the order row then holds
--     the totals so the W3a packed-proof constraint still holds. A W3a single-parcel close is recorded as parcel 1 by trigger.
--     W3a functions are not replaced: guard triggers refuse order-level packing changes on an order that is packed in parcels.
--  4. Exceptions queue (EX-######): weight, receiving, label, stock, carrier, short_pick, other. Raised automatically by triggers
--     when W3a stops an order (short pick → status exception), when a weight override locks (order or parcel) and when W2a
--     receiving blocks a lot. Owner (assign), resolution (required) and release: pick again / ship short / cancel (W3a
--     wh_resolve_exception), unlock override (warehouse admin), approve lot (W2a wh_approve_lot) — or close when nothing is held.
--     Releases done on the order page resolve the matching exception too.
--  Writes only through wh_* security-definer functions (set search_path = public; revoked from public/anon); every change is
--  audit-logged. Integer grams and cents. No seeded benches, materials or prices. Staff-only tables (wh_sees()).
--  Demo wipe: new org-linked rows hang off wh_orders / wh_lots / wh_asns / organizations with ON DELETE CASCADE, so the installed
--  wipe_demo_data() (migration 233) removes them unchanged; material moves (no FK to orders) stay, like stock movements.
-- Down: supabase/migrations/down/20261101000235_w3b_scale_materials_parcels_exceptions.down.sql

create sequence if not exists public.seq_wh_exception;
revoke all on sequence public.seq_wh_exception from public, anon, authenticated;
grant all on sequence public.seq_wh_exception to service_role;

-- ───────── 1. Scale benches and calibration checks ─────────
create table if not exists public.wh_scale_benches (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  max_g integer check (max_g is null or max_g between 100 and 1000000),
  check_tolerance_g integer not null check (check_tolerance_g between 0 and 1000),
  check_every_hours integer check (check_every_hours is null or check_every_hours between 1 and 720),
  status text not null default 'locked' check (status in ('ok', 'locked')),
  locked_reason text check (locked_reason is null or length(locked_reason) <= 300),
  locked_at timestamptz,
  last_check_at timestamptz,
  last_check_ok boolean,
  last_pass_at timestamptz,
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_scale_benches_code_per_wh unique (warehouse_code, code),
  constraint wh_scale_benches_locked_reason check (status = 'ok' or nullif(btrim(coalesce(locked_reason, '')), '') is not null),
  -- a bench is usable only right after a passing check: no other way to unlock it
  constraint wh_scale_benches_ok_after_pass check (status = 'locked' or (last_check_ok is true and last_pass_at is not null and last_pass_at = last_check_at))
);
comment on table public.wh_scale_benches is 'Warehouse OS: scale benches per warehouse. Locked until a calibration check passes (new, settings changed, failed check). Staff only.';
alter table public.wh_scale_benches enable row level security;
revoke all on public.wh_scale_benches from public, anon, authenticated;
grant select on public.wh_scale_benches to authenticated;
grant all on public.wh_scale_benches to service_role;
drop policy if exists wh_scale_benches_read on public.wh_scale_benches;
create policy wh_scale_benches_read on public.wh_scale_benches for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_scale_checks (
  id uuid primary key default gen_random_uuid(),
  bench_id uuid not null references public.wh_scale_benches(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  reference_g integer not null check (reference_g between 1 and 1000000),
  reading_g integer not null check (reading_g between 0 and 1000000),
  tolerance_g integer not null check (tolerance_g between 0 and 1000),
  passed boolean not null,
  note text check (note is null or length(note) <= 300),
  checked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wh_scale_checks_result check (passed = (abs(reading_g - reference_g) <= tolerance_g))
);
create index if not exists wh_scale_checks_bench_idx on public.wh_scale_checks (bench_id, created_at desc);
comment on table public.wh_scale_checks is 'Warehouse OS: calibration reads per bench (reference weight, reading, tolerance, pass/fail). Append-only; staff only.';
alter table public.wh_scale_checks enable row level security;
revoke all on public.wh_scale_checks from public, anon, authenticated;
grant select on public.wh_scale_checks to authenticated;
grant all on public.wh_scale_checks to service_role;
drop policy if exists wh_scale_checks_read on public.wh_scale_checks;
create policy wh_scale_checks_read on public.wh_scale_checks for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 2. Packaging materials (stock per warehouse), moves ledger ─────────
create table if not exists public.wh_materials (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  kind text not null check (kind in ('box', 'mailer', 'tape', 'mark', 'filler', 'other')),
  unit text not null default 'each' check (unit in ('each', 'roll', 'm', 'kg')),
  box_id uuid unique references public.wh_boxes(id) on delete restrict,
  on_hand integer not null default 0 check (on_hand between 0 and 100000000),
  low_stock_at integer check (low_stock_at is null or low_stock_at between 0 and 1000000),
  charge_per_unit_cents bigint check (charge_per_unit_cents is null or charge_per_unit_cents between 0 and 10000000),
  charge_set_by uuid references auth.users(id) on delete set null,
  charge_set_at timestamptz,
  auto_dg_mark boolean not null default false,
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_materials_code_per_wh unique (warehouse_code, code),
  constraint wh_materials_box_kind check (box_id is null or kind in ('box', 'mailer')),
  constraint wh_materials_dg_kind check (not auto_dg_mark or kind = 'mark')
);
create unique index if not exists wh_materials_one_auto_dg_uidx on public.wh_materials (warehouse_code) where auto_dg_mark and active;
comment on table public.wh_materials is 'Warehouse OS: packaging materials as stock per warehouse (boxes, mailers, tape, marks). on_hand = sum of wh_material_moves. Charge per unit NULL = not set (warehouse admin sets it). Staff only.';
alter table public.wh_materials enable row level security;
revoke all on public.wh_materials from public, anon, authenticated;
grant select on public.wh_materials to authenticated;
grant all on public.wh_materials to service_role;
drop policy if exists wh_materials_read on public.wh_materials;
create policy wh_materials_read on public.wh_materials for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_material_moves (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.wh_materials(id) on delete restrict,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  kind text not null check (kind in ('receive', 'adjust_in', 'adjust_out', 'consume', 'return')),
  qty integer not null check (qty between 1 and 1000000),
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  reason text check (reason is null or length(reason) <= 500),
  -- no foreign keys on purpose: the ledger outlives purged test orders (like warehouse_stock_movements.wh_order_id)
  order_id uuid,
  parcel_id uuid,
  usage_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wh_material_moves_sign check ((kind in ('receive', 'adjust_in', 'return') and delta = qty) or (kind in ('adjust_out', 'consume') and delta = -qty)),
  constraint wh_material_moves_reason check (kind not in ('adjust_in', 'adjust_out') or nullif(btrim(coalesce(reason, '')), '') is not null)
);
create index if not exists wh_material_moves_material_idx on public.wh_material_moves (material_id, created_at desc);
create index if not exists wh_material_moves_order_idx on public.wh_material_moves (order_id) where order_id is not null;
comment on table public.wh_material_moves is 'Warehouse OS: packaging material ledger (receive, count adjustments, used at packing, returned when a use is voided). Append-only; staff only.';
alter table public.wh_material_moves enable row level security;
revoke all on public.wh_material_moves from public, anon, authenticated;
grant select on public.wh_material_moves to authenticated;
grant all on public.wh_material_moves to service_role;
drop policy if exists wh_material_moves_read on public.wh_material_moves;
create policy wh_material_moves_read on public.wh_material_moves for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 3. Parcels ─────────
create table if not exists public.wh_parcels (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  seq smallint not null check (seq between 1 and 50),
  status text not null default 'open' check (status in ('open', 'closed')),
  source text not null default 'multi' check (source in ('multi', 'single')),
  box_id uuid references public.wh_boxes(id) on delete restrict,
  expected_weight_g integer check (expected_weight_g is null or expected_weight_g > 0),
  tolerance_g integer check (tolerance_g is null or tolerance_g >= 0),
  measured_weight_g integer check (measured_weight_g is null or measured_weight_g between 1 and 1000000),
  weighed_by uuid references auth.users(id) on delete set null,
  bench_id uuid references public.wh_scale_benches(id) on delete set null,
  battery_mark boolean not null default false,
  override_attempts smallint not null default 0 check (override_attempts between 0 and 3),
  override_locked_at timestamptz,
  override_by uuid references auth.users(id) on delete set null,
  override_reason text check (override_reason is null or length(override_reason) <= 500),
  override_weight_g integer,
  override_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_parcels_seq_per_order unique (order_id, seq),
  -- a parcel closes only with a box and a weight inside tolerance (or a supervisor override for exactly that weight, with a reason)
  constraint wh_parcels_closed_proof check (status <> 'closed' or (
    box_id is not null and measured_weight_g is not null and closed_at is not null
    and ((expected_weight_g is not null and tolerance_g is not null and abs(measured_weight_g - expected_weight_g) <= tolerance_g)
         or (override_at is not null and override_weight_g = measured_weight_g and nullif(btrim(coalesce(override_reason, '')), '') is not null)))),
  -- two people: the supervisor who approves a parcel's weight never weighed or closed it
  constraint wh_parcels_override_two_person check (override_by is null or (override_by is distinct from weighed_by and override_by is distinct from closed_by))
);
create index if not exists wh_parcels_order_idx on public.wh_parcels (order_id, seq);
comment on table public.wh_parcels is 'Warehouse OS: parcels of an order (box, weight check, override, battery mark, photos per parcel). source single = the W3a one-parcel close. Staff only.';
alter table public.wh_parcels enable row level security;
revoke all on public.wh_parcels from public, anon, authenticated;
grant select on public.wh_parcels to authenticated;
grant all on public.wh_parcels to service_role;
drop policy if exists wh_parcels_read on public.wh_parcels;
create policy wh_parcels_read on public.wh_parcels for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_parcel_items (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.wh_parcels(id) on delete cascade,
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  line_id uuid not null references public.wh_order_lines(id) on delete cascade,
  qty integer not null check (qty between 1 and 100000),
  constraint wh_parcel_items_one_line unique (parcel_id, line_id)
);
create index if not exists wh_parcel_items_order_idx on public.wh_parcel_items (order_id);
comment on table public.wh_parcel_items is 'Warehouse OS: units of each order line in each parcel (sum per line = wh_order_lines.packed_qty). Staff only.';
alter table public.wh_parcel_items enable row level security;
revoke all on public.wh_parcel_items from public, anon, authenticated;
grant select on public.wh_parcel_items to authenticated;
grant all on public.wh_parcel_items to service_role;
drop policy if exists wh_parcel_items_read on public.wh_parcel_items;
create policy wh_parcel_items_read on public.wh_parcel_items for select to authenticated
  using (exists (select 1 from public.wh_parcels p where p.id = parcel_id));

-- per-parcel links on the W3a tables (nullable; W3a rows keep NULL until a parcel exists)
alter table public.wh_orders add column if not exists weighed_bench_id uuid references public.wh_scale_benches(id) on delete set null;
alter table public.wh_pack_evidence add column if not exists parcel_id uuid references public.wh_parcels(id) on delete set null;
alter table public.wh_scan_log add column if not exists parcel_id uuid references public.wh_parcels(id) on delete set null;
alter table public.wh_override_attempts add column if not exists parcel_id uuid references public.wh_parcels(id) on delete set null;
create index if not exists wh_pack_evidence_parcel_idx on public.wh_pack_evidence (parcel_id) where parcel_id is not null;
create index if not exists wh_scan_log_parcel_idx on public.wh_scan_log (parcel_id) where parcel_id is not null;

-- usage = what is charged by use (W6 invoices); the unit charge is copied when used (NULL = no price set)
create table if not exists public.wh_material_usage (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.wh_materials(id) on delete restrict,
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  order_id uuid not null references public.wh_orders(id) on delete cascade,
  parcel_id uuid references public.wh_parcels(id) on delete set null,
  org_id uuid references public.organizations(id) on delete restrict,
  qty integer not null check (qty between 1 and 100000),
  unit_charge_cents bigint check (unit_charge_cents is null or unit_charge_cents >= 0),
  charge_cents bigint,
  source text not null check (source in ('box', 'dg_mark', 'manual')),
  move_id uuid not null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text check (void_reason is null or length(void_reason) <= 300),
  void_move_id uuid,
  invoiced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wh_material_usage_charge check ((unit_charge_cents is null and charge_cents is null) or charge_cents = unit_charge_cents * qty),
  constraint wh_material_usage_void check (voided_at is null or (nullif(btrim(coalesce(void_reason, '')), '') is not null and void_move_id is not null))
);
create index if not exists wh_material_usage_order_idx on public.wh_material_usage (order_id);
create index if not exists wh_material_usage_org_idx on public.wh_material_usage (org_id, created_at) where org_id is not null;
comment on table public.wh_material_usage is 'Warehouse OS: packaging used per order / parcel with the client company and the unit charge at that time (NULL = not set). W6 invoices from it. Staff only.';
alter table public.wh_material_usage enable row level security;
revoke all on public.wh_material_usage from public, anon, authenticated;
grant select on public.wh_material_usage to authenticated;
grant all on public.wh_material_usage to service_role;
drop policy if exists wh_material_usage_read on public.wh_material_usage;
create policy wh_material_usage_read on public.wh_material_usage for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 4. Exceptions ─────────
create table if not exists public.wh_exceptions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('EX-' || lpad(nextval('public.seq_wh_exception')::text, 6, '0')),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  kind text not null check (kind in ('weight', 'receiving', 'label', 'stock', 'carrier', 'short_pick', 'other')),
  status text not null default 'open' check (status in ('open', 'assigned', 'resolved')),
  source text not null default 'auto' check (source in ('auto', 'manual')),
  title text not null check (btrim(title) <> '' and length(title) <= 600),
  order_id uuid references public.wh_orders(id) on delete cascade,
  parcel_id uuid references public.wh_parcels(id) on delete cascade,
  asn_id uuid references public.wh_asns(id) on delete cascade,
  lot_id uuid references public.wh_lots(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  raised_by uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  resolution text check (resolution is null or length(resolution) <= 1000),
  resolution_action text check (resolution_action is null or length(resolution_action) <= 40),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_exceptions_resolved check (status <> 'resolved' or (nullif(btrim(coalesce(resolution, '')), '') is not null and resolved_at is not null)),
  constraint wh_exceptions_assigned check (status <> 'assigned' or assigned_at is not null)
);
create unique index if not exists wh_exceptions_open_order_uidx on public.wh_exceptions (order_id, kind) where order_id is not null and parcel_id is null and status <> 'resolved';
create unique index if not exists wh_exceptions_open_parcel_uidx on public.wh_exceptions (parcel_id, kind) where parcel_id is not null and status <> 'resolved';
create unique index if not exists wh_exceptions_open_lot_uidx on public.wh_exceptions (lot_id, kind) where lot_id is not null and status <> 'resolved';
create index if not exists wh_exceptions_wh_status_idx on public.wh_exceptions (warehouse_code, status, created_at desc);
comment on table public.wh_exceptions is 'Warehouse OS: exceptions queue (EX-######) — weight, receiving, label, stock, carrier, short pick, other. Owner, resolution (required) and release. Staff only.';
alter table public.wh_exceptions enable row level security;
revoke all on public.wh_exceptions from public, anon, authenticated;
grant select on public.wh_exceptions to authenticated;
grant all on public.wh_exceptions to service_role;
drop policy if exists wh_exceptions_read on public.wh_exceptions;
create policy wh_exceptions_read on public.wh_exceptions for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 5. Internal helpers ─────────
-- a bench the reading may be taken on: same warehouse, in use, passed its check (and not due), within its capacity
create or replace function public.wh_bench_assert(p_bench uuid, p_warehouse text, p_grams integer default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.wh_scale_benches;
begin
  select * into b from public.wh_scale_benches where id = p_bench;
  if b.id is null or b.warehouse_code is distinct from p_warehouse or not b.active then
    raise exception 'INVALID_BENCH: choose a scale bench in use at %', p_warehouse;
  end if;
  if b.status <> 'ok' then
    raise exception 'BENCH_LOCKED: bench % is locked (%); it must pass a calibration check before anything is weighed on it', b.code, b.locked_reason;
  end if;
  if b.check_every_hours is not null and b.last_pass_at < now() - make_interval(hours => b.check_every_hours) then
    raise exception 'BENCH_CHECK_DUE: bench % needs its calibration check (every % h) before weighing', b.code, b.check_every_hours;
  end if;
  if p_grams is not null and b.max_g is not null and p_grams > b.max_g then
    raise exception 'OVER_CAPACITY: % g is more than bench % weighs (up to % g); use a bigger scale', p_grams, b.code, b.max_g;
  end if;
  return b.id;
end $$;
revoke all on function public.wh_bench_assert(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.wh_bench_assert(uuid, text, integer) to service_role;

-- one ledger line for a material; on_hand follows it and never goes below 0
create or replace function public.wh_material_post(p_material uuid, p_kind text, p_qty integer, p_reason text, p_order uuid, p_parcel uuid, p_usage uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.wh_materials;
  v_delta integer;
  v_after integer;
  v_id uuid;
begin
  if p_kind not in ('receive', 'adjust_in', 'adjust_out', 'consume', 'return') then raise exception 'INVALID_KIND'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 1000000 then raise exception 'INVALID_QTY: 1 to 1,000,000'; end if;
  select * into m from public.wh_materials where id = p_material for update;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  v_delta := case when p_kind in ('receive', 'adjust_in', 'return') then p_qty else -p_qty end;
  v_after := m.on_hand + v_delta;
  if v_after < 0 then
    raise exception 'MATERIAL_SHORT: only % % of % (%) left at %; receive or count materials first', m.on_hand, m.unit, m.name, m.code, m.warehouse_code;
  end if;
  update public.wh_materials set on_hand = v_after, updated_at = now() where id = m.id;
  insert into public.wh_material_moves (material_id, warehouse_code, kind, qty, delta, balance_after, reason, order_id, parcel_id, usage_id, actor_id)
  values (m.id, m.warehouse_code, p_kind, p_qty, v_delta, v_after, left(nullif(btrim(coalesce(p_reason, '')), ''), 500), p_order, p_parcel, p_usage, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.wh_material_post(uuid, text, integer, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.wh_material_post(uuid, text, integer, text, uuid, uuid, uuid) to service_role;

-- material used for an order (and parcel): consume + usage row with the client and the unit charge at that time
create or replace function public.wh_material_use(p_order uuid, p_parcel uuid, p_material uuid, p_qty integer, p_source text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  m public.wh_materials;
  v_usage uuid := gen_random_uuid();
  v_move uuid;
  v_unit bigint;
begin
  select * into o from public.wh_orders where id = p_order;
  select * into m from public.wh_materials where id = p_material;
  if o.id is null or m.id is null then raise exception 'NOT_FOUND'; end if;
  if m.warehouse_code <> o.warehouse_code then raise exception 'INVALID_MATERIAL: % is not stocked at %', m.code, o.warehouse_code; end if;
  if not m.active then raise exception 'INVALID_MATERIAL: % is not in use', m.code; end if;
  v_move := public.wh_material_post(m.id, 'consume', p_qty, p_reason, o.id, p_parcel, v_usage);
  -- charged by use to the client company that owns the order; Octopus Dropship orders (no client) carry no charge
  v_unit := case when o.org_id is null then null else m.charge_per_unit_cents end;
  insert into public.wh_material_usage (id, material_id, warehouse_code, order_id, parcel_id, org_id, qty, unit_charge_cents, charge_cents, source, move_id, created_by)
  values (v_usage, m.id, o.warehouse_code, o.id, p_parcel, o.org_id, p_qty, v_unit, v_unit * p_qty, p_source, v_move, auth.uid());
  perform write_audit('wh_material.used', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'material', m.code, 'qty', p_qty, 'source', p_source, 'parcel_id', p_parcel, 'unit_charge_cents', v_unit));
  return v_usage;
end $$;
revoke all on function public.wh_material_use(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.wh_material_use(uuid, uuid, uuid, integer, text, text) to service_role;

-- a use is voided: the units go back to stock ('return') and the usage row is marked (never deleted)
create or replace function public.wh_material_void_internal(p_usage uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.wh_material_usage;
  v_move uuid;
begin
  select * into u from public.wh_material_usage where id = p_usage for update;
  if u.id is null then raise exception 'NOT_FOUND'; end if;
  if u.voided_at is not null then raise exception 'ALREADY_VOIDED: this use was already taken back'; end if;
  v_move := public.wh_material_post(u.material_id, 'return', u.qty, left('Use taken back: ' || p_reason, 500), u.order_id, u.parcel_id, u.id);
  update public.wh_material_usage set voided_at = now(), voided_by = auth.uid(), void_reason = left(p_reason, 300), void_move_id = v_move where id = u.id;
  perform write_audit('wh_material.voided', 'wh_orders', u.order_id::text,
    jsonb_build_object('usage_id', u.id, 'material', (select code from public.wh_materials where id = u.material_id), 'qty', u.qty, 'reason', p_reason));
end $$;
revoke all on function public.wh_material_void_internal(uuid, text) from public, anon, authenticated;
grant execute on function public.wh_material_void_internal(uuid, text) to service_role;

-- packaging used automatically when a parcel closes: its box (when the box is stocked as a material) and the battery mark
create or replace function public.wh_use_pack_materials(p_order uuid, p_parcel uuid, p_box uuid, p_mark boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_mat uuid;
  v_seq smallint;
begin
  select * into o from public.wh_orders where id = p_order;
  select seq into v_seq from public.wh_parcels where id = p_parcel;
  if p_box is not null then
    select id into v_mat from public.wh_materials where box_id = p_box and active;
    if v_mat is not null then
      perform public.wh_material_use(o.id, p_parcel, v_mat, 1, 'box', format('%s parcel %s', o.code, coalesce(v_seq, 1)));
    end if;
  end if;
  if coalesce(p_mark, false) then
    v_mat := null;
    select id into v_mat from public.wh_materials where warehouse_code = o.warehouse_code and auto_dg_mark and active;
    if v_mat is not null then
      perform public.wh_material_use(o.id, p_parcel, v_mat, 1, 'dg_mark', format('%s parcel %s battery mark', o.code, coalesce(v_seq, 1)));
    end if;
  end if;
end $$;
revoke all on function public.wh_use_pack_materials(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.wh_use_pack_materials(uuid, uuid, uuid, boolean) to service_role;

-- expected weight (items + box tare) and tolerance of a parcel; any change to contents or box voids its reading and approval
create or replace function public.wh_parcel_recalc(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  b public.wh_boxes;
  v_unknown boolean;
  v_items integer;
  v_expected integer;
  st record;
begin
  select * into p from public.wh_parcels where id = p_parcel;
  select * into b from public.wh_boxes where id = p.box_id;
  select bool_or(l.unit_weight_g is null), coalesce(sum(i.qty * l.unit_weight_g), 0)::integer
    into v_unknown, v_items
    from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id where i.parcel_id = p.id;
  v_expected := case when b.id is null or coalesce(v_unknown, false) then null else nullif(v_items + b.tare_g, 0) end;
  select * into st from public.wh_settings_for(p.warehouse_code);
  update public.wh_parcels
     set expected_weight_g = v_expected, tolerance_g = public.wh_weight_tolerance(v_expected, st.tolerance_g, st.tolerance_pct),
         measured_weight_g = null, weighed_by = null, bench_id = null,
         override_by = null, override_reason = null, override_weight_g = null, override_at = null, updated_at = now()
   where id = p.id;
end $$;
revoke all on function public.wh_parcel_recalc(uuid) from public, anon, authenticated;
grant execute on function public.wh_parcel_recalc(uuid) to service_role;

-- ───────── 6. Guard triggers on the W3a tables (W3a functions are not replaced) ─────────
-- (a) an order packed in parcels: its order-level box / weight / approval / close change only through the parcel functions;
-- (b) once the warehouse has an active scale bench, a new reading names a usable bench (set by wh_pack_weigh_on()).
create or replace function public.wh_orders_w3b_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op boolean := coalesce(current_setting('octopus.wh_parcel_op', true), '') = 'true';
  v_bench uuid := nullif(current_setting('octopus.wh_bench', true), '')::uuid;
begin
  if not v_op
     and (new.box_id is distinct from old.box_id or new.measured_weight_g is distinct from old.measured_weight_g
          or new.override_at is distinct from old.override_at or (new.status = 'packed' and old.status is distinct from 'packed'))
     and exists (select 1 from public.wh_parcels p where p.order_id = new.id) then
    raise exception 'MULTI_PARCEL: % is packed in several parcels; use Multi-parcel packing', new.code;
  end if;
  if new.measured_weight_g is null then
    new.weighed_bench_id := null;
  elsif not v_op and new.weighed_by is not null
        and (new.measured_weight_g is distinct from old.measured_weight_g or new.weighed_by is distinct from old.weighed_by or v_bench is not null) then
    if v_bench is null then
      if exists (select 1 from public.wh_scale_benches b where b.warehouse_code = new.warehouse_code and b.active) then
        raise exception 'BENCH_REQUIRED: choose the scale bench you weighed on';
      end if;
    else
      perform public.wh_bench_assert(v_bench, new.warehouse_code, new.measured_weight_g);
    end if;
    new.weighed_bench_id := v_bench;
  end if;
  return new;
end $$;
revoke all on function public.wh_orders_w3b_guard() from public, anon, authenticated;
drop trigger if exists wh_orders_w3b_guard on public.wh_orders;
create trigger wh_orders_w3b_guard before update on public.wh_orders for each row execute function public.wh_orders_w3b_guard();

create or replace function public.wh_order_lines_w3b_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.packed_qty is distinct from old.packed_qty
     and coalesce(current_setting('octopus.wh_parcel_op', true), '') <> 'true'
     and exists (select 1 from public.wh_parcels p where p.order_id = new.order_id) then
    raise exception 'MULTI_PARCEL: this order is packed in several parcels; scan items into a parcel';
  end if;
  return new;
end $$;
revoke all on function public.wh_order_lines_w3b_guard() from public, anon, authenticated;
drop trigger if exists wh_order_lines_w3b_guard on public.wh_order_lines;
create trigger wh_order_lines_w3b_guard before update on public.wh_order_lines for each row execute function public.wh_order_lines_w3b_guard();

create or replace function public.wh_pack_evidence_w3b_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parcel_id is null
     and coalesce(current_setting('octopus.wh_parcel_op', true), '') <> 'true'
     and exists (select 1 from public.wh_parcels p where p.order_id = new.order_id) then
    raise exception 'MULTI_PARCEL: this order is packed in several parcels; add the photo to a parcel';
  end if;
  return new;
end $$;
revoke all on function public.wh_pack_evidence_w3b_guard() from public, anon, authenticated;
drop trigger if exists wh_pack_evidence_w3b_guard on public.wh_pack_evidence;
create trigger wh_pack_evidence_w3b_guard before insert on public.wh_pack_evidence for each row execute function public.wh_pack_evidence_w3b_guard();

-- a W3a single-parcel close becomes parcel 1 (items, photos, bench) and takes its box / battery mark from materials stock
create or replace function public.wh_orders_w3b_single_parcel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcel uuid;
begin
  if new.status = 'packed' and old.status is distinct from 'packed'
     and not exists (select 1 from public.wh_parcels p where p.order_id = new.id) then
    insert into public.wh_parcels (order_id, warehouse_code, seq, status, source, box_id, expected_weight_g, tolerance_g, measured_weight_g,
                                   weighed_by, bench_id, battery_mark, override_attempts, override_by, override_reason, override_weight_g, override_at,
                                   closed_by, closed_at, created_by)
    values (new.id, new.warehouse_code, 1, 'closed', 'single', new.box_id, new.expected_weight_g, new.tolerance_g, new.measured_weight_g,
            new.weighed_by, new.weighed_bench_id, new.battery_mark, new.override_attempts, new.override_by, new.override_reason, new.override_weight_g, new.override_at,
            new.packed_by, new.packed_at, new.packed_by)
    returning id into v_parcel;
    insert into public.wh_parcel_items (parcel_id, order_id, line_id, qty)
    select v_parcel, new.id, l.id, l.packed_qty from public.wh_order_lines l where l.order_id = new.id and l.packed_qty > 0;
    update public.wh_pack_evidence set parcel_id = v_parcel where order_id = new.id and parcel_id is null;
    perform public.wh_use_pack_materials(new.id, v_parcel, new.box_id, new.battery_mark and new.has_dangerous_goods);
  end if;
  return null;
end $$;
revoke all on function public.wh_orders_w3b_single_parcel() from public, anon, authenticated;
drop trigger if exists wh_orders_w3b_single_parcel on public.wh_orders;
create trigger wh_orders_w3b_single_parcel after update on public.wh_orders for each row execute function public.wh_orders_w3b_single_parcel();

-- ───────── 7. Exceptions raised and resolved by the existing flows (triggers) ─────────
-- octopus.wh_exc_resolution / octopus.wh_exc_action are set by wh_exception_resolve() so the resolution typed in the queue is kept
create or replace function public.wh_exceptions_resolve_where(p_where text, p_id uuid, p_kind text[], p_default text, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res text := nullif(current_setting('octopus.wh_exc_resolution', true), '');
  v_act text := nullif(current_setting('octopus.wh_exc_action', true), '');
  r record;
begin
  for r in execute format(
    'update public.wh_exceptions e set status = ''resolved'', resolution = left($1, 1000), resolution_action = left($2, 40), resolved_by = auth.uid(),
            resolved_at = now(), updated_at = now()
      where e.%I = $3 and e.status <> ''resolved'' and (e.kind = any($4)) %s
      returning e.id, e.code, e.kind',
    p_where, case when p_where = 'order_id' then 'and e.parcel_id is null' else '' end)
    using coalesce(v_res, p_default), coalesce(v_act, p_action), p_id, p_kind
  loop
    perform write_audit('wh_exception.resolved', 'wh_exceptions', r.id::text,
      jsonb_build_object('code', r.code, 'kind', r.kind, 'action', coalesce(v_act, p_action), 'resolution', coalesce(v_res, p_default)));
  end loop;
end $$;
revoke all on function public.wh_exceptions_resolve_where(text, uuid, text[], text, text) from public, anon, authenticated;
grant execute on function public.wh_exceptions_resolve_where(text, uuid, text[], text, text) to service_role;

create or replace function public.wh_exception_open(p_wh text, p_kind text, p_title text, p_order uuid, p_parcel uuid, p_asn uuid, p_lot uuid, p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.wh_exceptions e where e.kind = p_kind and e.status <> 'resolved'
              and ((p_parcel is not null and e.parcel_id = p_parcel)
                   or (p_parcel is null and p_order is not null and e.order_id = p_order and e.parcel_id is null)
                   or (p_lot is not null and e.lot_id = p_lot))) then
    return null;
  end if;
  insert into public.wh_exceptions (warehouse_code, kind, source, title, order_id, parcel_id, asn_id, lot_id, org_id, raised_by)
  values (p_wh, p_kind, 'auto', left(p_title, 600), p_order, p_parcel, p_asn, p_lot, p_org, auth.uid())
  returning id into v_id;
  perform write_audit('wh_exception.raised', 'wh_exceptions', v_id::text,
    jsonb_build_object('code', (select code from public.wh_exceptions where id = v_id), 'kind', p_kind, 'auto', true, 'order_id', p_order, 'lot_id', p_lot));
  return v_id;
end $$;
revoke all on function public.wh_exception_open(text, text, text, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.wh_exception_open(text, text, text, uuid, uuid, uuid, uuid, uuid) to service_role;

create or replace function public.wh_orders_w3b_exceptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- W3a stopped the order (short pick) → exception; released (pick again / ship short / cancel) → resolved
  if new.status = 'exception' and old.status is distinct from 'exception' then
    perform public.wh_exception_open(new.warehouse_code, case when new.exception_reason like 'Short pick%' then 'short_pick' else 'other' end,
      coalesce(new.exception_reason, format('%s stopped', new.code)), new.id, null, null, null, new.org_id);
  elsif old.status = 'exception' and new.status is distinct from 'exception' then
    perform public.wh_exceptions_resolve_where('order_id', new.id, array['short_pick', 'other'],
      format('Released on the order page: %s is now %s', new.code, new.status), new.status);
  end if;
  -- three wrong supervisor PINs → weight exception; a warehouse admin unlocks → resolved
  if new.override_locked_at is not null and old.override_locked_at is null then
    perform public.wh_exception_open(new.warehouse_code, 'weight',
      format('Weight override locked on %s after three wrong supervisor PINs (%s g measured, %s expected)', new.code,
             coalesce(new.measured_weight_g::text, '?'), coalesce(new.expected_weight_g::text || ' g', 'unknown')),
      new.id, null, null, null, new.org_id);
  elsif new.override_locked_at is null and old.override_locked_at is not null then
    perform public.wh_exceptions_resolve_where('order_id', new.id, array['weight'], 'Override unlocked by a warehouse admin on the order page', 'unlock_override');
  end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform public.wh_exceptions_resolve_where('order_id', new.id, array['weight', 'receiving', 'label', 'stock', 'carrier', 'short_pick', 'other'],
      format('Order cancelled: %s', coalesce(new.cancel_reason, '')), 'cancel');
  end if;
  return null;
end $$;
revoke all on function public.wh_orders_w3b_exceptions() from public, anon, authenticated;
drop trigger if exists wh_orders_w3b_exceptions on public.wh_orders;
create trigger wh_orders_w3b_exceptions after update on public.wh_orders for each row execute function public.wh_orders_w3b_exceptions();

create or replace function public.wh_parcels_w3b_exceptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
begin
  if new.override_locked_at is not null and old.override_locked_at is null then
    select * into o from public.wh_orders where id = new.order_id;
    perform public.wh_exception_open(new.warehouse_code, 'weight',
      format('Weight override locked on %s parcel %s after three wrong supervisor PINs (%s g measured, %s expected)', o.code, new.seq,
             coalesce(new.measured_weight_g::text, '?'), coalesce(new.expected_weight_g::text || ' g', 'unknown')),
      new.order_id, new.id, null, null, o.org_id);
  elsif new.override_locked_at is null and old.override_locked_at is not null then
    perform public.wh_exceptions_resolve_where('parcel_id', new.id, array['weight'], 'Parcel override unlocked by a warehouse admin', 'unlock_override');
  end if;
  return null;
end $$;
revoke all on function public.wh_parcels_w3b_exceptions() from public, anon, authenticated;
drop trigger if exists wh_parcels_w3b_exceptions on public.wh_parcels;
create trigger wh_parcels_w3b_exceptions after update on public.wh_parcels for each row execute function public.wh_parcels_w3b_exceptions();

-- W2a receiving blocks a lot (count differs twice) → receiving exception; a supervisor approves the lot → resolved
create or replace function public.wh_lots_w3b_exceptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asn uuid;
  v_asn_code text;
  v_expected integer;
  v_blocked boolean;
  v_released boolean := false;
begin
  if tg_op = 'INSERT' then
    v_blocked := new.status = 'blocked';
  else
    v_blocked := new.status = 'blocked' and old.status is distinct from 'blocked';
    v_released := old.status = 'blocked' and new.status = 'released';
  end if;
  if v_blocked then
    select a.id, a.code, l.expected_qty into v_asn, v_asn_code, v_expected
      from public.wh_asn_lines l join public.wh_asns a on a.id = l.asn_id where l.id = new.asn_line_id;
    perform public.wh_exception_open(new.warehouse_code, 'receiving',
      format('Lot %s blocked: the counts on %s differ (%s good counted, %s expected); a supervisor approves the quantity',
             new.lot_code, coalesce(v_asn_code, 'the notice'), new.qty, coalesce(v_expected::text, '?')),
      null, null, v_asn, new.id, new.org_id);
  elsif v_released then
    perform public.wh_exceptions_resolve_where('lot_id', new.id, array['receiving'],
      format('Lot released for %s unit(s): %s', new.qty, coalesce(new.approve_reason, 'approved by a supervisor')), 'approve_lot');
  end if;
  return null;
end $$;
revoke all on function public.wh_lots_w3b_exceptions() from public, anon, authenticated;
drop trigger if exists wh_lots_w3b_exceptions on public.wh_lots;
create trigger wh_lots_w3b_exceptions after insert or update on public.wh_lots for each row execute function public.wh_lots_w3b_exceptions();

-- ───────── 8. Scale benches (board 17) ─────────
create or replace function public.wh_save_bench(
  p_warehouse text, p_id uuid, p_code text, p_name text, p_max_g integer, p_check_tolerance_g integer, p_check_every_hours integer, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_old public.wh_scale_benches;
  v_id uuid;
  v_relock text;
begin
  if not (public.wh_role(p_warehouse) in ('supervisor', 'admin') and staff_aal_ok()) then raise exception 'FORBIDDEN: supervisors and admins manage scale benches'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then raise exception 'WAREHOUSE_NOT_OPEN'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{0,19}$' then raise exception 'INVALID_CODE: up to 20 letters, digits or dashes, e.g. BENCH-1'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'INVALID_NAME: up to 80 characters'; end if;
  if p_check_tolerance_g is null or p_check_tolerance_g < 0 or p_check_tolerance_g > 1000 then raise exception 'INVALID_TOLERANCE: the check tolerance is 0 to 1,000 g'; end if;
  if p_max_g is not null and (p_max_g < 100 or p_max_g > 1000000) then raise exception 'INVALID_CAPACITY: 100 g to 1,000,000 g, or leave it empty'; end if;
  if p_check_every_hours is not null and (p_check_every_hours < 1 or p_check_every_hours > 720) then raise exception 'INVALID_INTERVAL: 1 to 720 hours, or leave it empty'; end if;
  if exists (select 1 from public.wh_scale_benches where warehouse_code = p_warehouse and code = v_code and id is distinct from p_id) then
    raise exception 'DUPLICATE_BENCH: % already exists here', v_code;
  end if;
  if p_id is null then
    insert into public.wh_scale_benches (warehouse_code, code, name, max_g, check_tolerance_g, check_every_hours, status, locked_reason, locked_at, active, updated_by)
    values (p_warehouse, v_code, v_name, p_max_g, p_check_tolerance_g, p_check_every_hours, 'locked', 'Not checked yet: run a calibration check', now(),
            coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform write_audit('wh_scale.bench_created', 'wh_scale_benches', v_id::text,
      jsonb_build_object('warehouse', p_warehouse, 'code', v_code, 'check_tolerance_g', p_check_tolerance_g, 'max_g', p_max_g, 'check_every_hours', p_check_every_hours));
  else
    select * into v_old from public.wh_scale_benches where id = p_id and warehouse_code = p_warehouse for update;
    if v_old.id is null then raise exception 'NOT_FOUND'; end if;
    v_relock := case
      when coalesce(p_active, true) and not v_old.active then 'Back in use: run a calibration check'
      when p_check_tolerance_g is distinct from v_old.check_tolerance_g or p_max_g is distinct from v_old.max_g
           or p_check_every_hours is distinct from v_old.check_every_hours then 'Check settings changed: run a calibration check' end;
    update public.wh_scale_benches
       set code = v_code, name = v_name, max_g = p_max_g, check_tolerance_g = p_check_tolerance_g, check_every_hours = p_check_every_hours,
           active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now(),
           status = case when v_relock is not null then 'locked' else status end,
           locked_reason = case when v_relock is not null then v_relock else locked_reason end,
           locked_at = case when v_relock is not null then now() else locked_at end
     where id = p_id;
    v_id := p_id;
    perform write_audit('wh_scale.bench_updated', 'wh_scale_benches', v_id::text,
      jsonb_build_object('from', to_jsonb(v_old) - 'updated_by' - 'updated_at', 'code', v_code, 'check_tolerance_g', p_check_tolerance_g, 'max_g', p_max_g,
                         'check_every_hours', p_check_every_hours, 'active', coalesce(p_active, true), 'relocked', v_relock));
  end if;
  return v_id;
end $$;
revoke all on function public.wh_save_bench(text, uuid, text, text, integer, integer, integer, boolean) from public, anon;
grant execute on function public.wh_save_bench(text, uuid, text, text, integer, integer, integer, boolean) to authenticated, service_role;

-- calibration read: reference weight on the bench vs what it shows. Fail → locked; only a passing check unlocks, and after a
-- failed check that passing check is run by a supervisor or admin
create or replace function public.wh_scale_check(p_bench uuid, p_reference_g integer, p_reading_g integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wh_scale_benches;
  v_pass boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text;
begin
  select * into b from public.wh_scale_benches where id = p_bench for update;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.wh_can('pack', b.warehouse_code) or public.wh_can('approve_override', b.warehouse_code)) then
    raise exception 'FORBIDDEN: packers, supervisors and admins of this warehouse check scales';
  end if;
  if not b.active then raise exception 'BENCH_NOT_IN_USE: % is not in use', b.code; end if;
  if p_reference_g is null or p_reference_g < 1 or p_reference_g > 1000000 then raise exception 'INVALID_REFERENCE: enter the reference weight in grams'; end if;
  if p_reading_g is null or p_reading_g < 0 or p_reading_g > 1000000 then raise exception 'INVALID_READING: enter what the scale shows in grams'; end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'NOTE_TOO_LONG: up to 300 characters'; end if;
  v_pass := abs(p_reading_g - p_reference_g) <= b.check_tolerance_g;
  if v_pass and b.status = 'locked' and b.last_check_ok is false and not public.wh_can('approve_override', b.warehouse_code) then
    raise exception 'SUPERVISOR_CHECK_REQUIRED: bench % failed its last check; a supervisor runs the check that unlocks it', b.code;
  end if;
  insert into public.wh_scale_checks (bench_id, warehouse_code, reference_g, reading_g, tolerance_g, passed, note, checked_by)
  values (b.id, b.warehouse_code, p_reference_g, p_reading_g, b.check_tolerance_g, v_pass, v_note, auth.uid());
  if v_pass then
    update public.wh_scale_benches
       set status = 'ok', locked_reason = null, locked_at = null, last_check_at = now(), last_check_ok = true, last_pass_at = now(), updated_at = now()
     where id = b.id;
  else
    v_reason := left(format('Failed check: read %s g on a %s g reference (± %s g allowed)', p_reading_g, p_reference_g, b.check_tolerance_g), 300);
    update public.wh_scale_benches
       set status = 'locked', locked_reason = v_reason, locked_at = now(), last_check_at = now(), last_check_ok = false, updated_at = now()
     where id = b.id;
  end if;
  perform write_audit(case when v_pass then 'wh_scale.check_passed' else 'wh_scale.check_failed' end, 'wh_scale_benches', b.id::text,
    jsonb_build_object('code', b.code, 'warehouse', b.warehouse_code, 'reference_g', p_reference_g, 'reading_g', p_reading_g, 'tolerance_g', b.check_tolerance_g,
                       'was', b.status));
  return jsonb_build_object('bench', b.code, 'passed', v_pass, 'status', case when v_pass then 'ok' else 'locked' end,
                            'difference_g', p_reading_g - p_reference_g, 'tolerance_g', b.check_tolerance_g);
end $$;
revoke all on function public.wh_scale_check(uuid, integer, integer, text) from public, anon;
grant execute on function public.wh_scale_check(uuid, integer, integer, text) to authenticated, service_role;

-- W3a packing station reading on a chosen bench (wh_pack_weigh() does the rest; the guard trigger checks the bench again)
create or replace function public.wh_pack_weigh_on(p_order uuid, p_bench uuid, p_grams integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh text;
  v_code text;
  v jsonb;
begin
  select warehouse_code into v_wh from public.wh_orders where id = p_order;
  if v_wh is null then raise exception 'NOT_FOUND'; end if;
  if p_bench is not null then
    perform public.wh_bench_assert(p_bench, v_wh, p_grams);
    select code into v_code from public.wh_scale_benches where id = p_bench;
    perform set_config('octopus.wh_bench', p_bench::text, true);
  end if;
  v := public.wh_pack_weigh(p_order, p_grams);
  perform set_config('octopus.wh_bench', '', true);
  return v || jsonb_build_object('bench', v_code);
end $$;
revoke all on function public.wh_pack_weigh_on(uuid, uuid, integer) from public, anon;
grant execute on function public.wh_pack_weigh_on(uuid, uuid, integer) to authenticated, service_role;

create or replace function public.wh_scale_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('stations', coalesce((
    select jsonb_agg(jsonb_build_object(
             'warehouse_code', w.code, 'name', w.name,
             'can_manage', public.wh_role(w.code) in ('supervisor', 'admin'),
             'can_check', public.wh_can('pack', w.code) or public.wh_can('approve_override', w.code),
             'can_unlock_failed', public.wh_can('approve_override', w.code),
             'benches', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', b.id, 'code', b.code, 'name', b.name, 'max_g', b.max_g, 'check_tolerance_g', b.check_tolerance_g,
                        'check_every_hours', b.check_every_hours, 'status', b.status, 'locked_reason', b.locked_reason, 'locked_at', b.locked_at,
                        'last_check_at', b.last_check_at, 'last_check_ok', b.last_check_ok, 'last_pass_at', b.last_pass_at, 'active', b.active,
                        'due', b.status = 'ok' and b.check_every_hours is not null and b.last_pass_at < now() - make_interval(hours => b.check_every_hours),
                        'checks', coalesce((
                          select jsonb_agg(jsonb_build_object('reference_g', c.reference_g, 'reading_g', c.reading_g, 'tolerance_g', c.tolerance_g,
                                   'passed', c.passed, 'note', c.note, 'by_name', pr.full_name, 'at', c.created_at) order by c.created_at desc)
                            from (select * from public.wh_scale_checks x where x.bench_id = b.id order by x.created_at desc limit 5) c
                            left join public.profiles pr on pr.id = c.checked_by), '[]'::jsonb))
                      order by b.active desc, b.code)
                 from public.wh_scale_benches b where b.warehouse_code = w.code), '[]'::jsonb))
           order by w.is_default desc, w.name)
      from public.warehouses w
     where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_sees(w.code)), '[]'::jsonb));
end $$;
revoke all on function public.wh_scale_board(text) from public, anon;
grant execute on function public.wh_scale_board(text) to authenticated, service_role;

-- ───────── 9. Packaging materials (board 12) ─────────
create or replace function public.wh_save_material(
  p_warehouse text, p_id uuid, p_code text, p_name text, p_kind text, p_unit text, p_box uuid, p_low_stock_at integer,
  p_auto_dg_mark boolean default false, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_old public.wh_materials;
  v_box public.wh_boxes;
  v_id uuid;
begin
  if not (public.wh_role(p_warehouse) in ('supervisor', 'admin') and staff_aal_ok()) then raise exception 'FORBIDDEN: supervisors and admins manage materials'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then raise exception 'WAREHOUSE_NOT_OPEN'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{0,19}$' then raise exception 'INVALID_CODE: up to 20 letters, digits or dashes, e.g. TAPE-48'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'INVALID_NAME: up to 80 characters'; end if;
  if p_kind is null or p_kind not in ('box', 'mailer', 'tape', 'mark', 'filler', 'other') then raise exception 'INVALID_KIND: box, mailer, tape, mark, filler or other'; end if;
  if coalesce(p_unit, 'each') not in ('each', 'roll', 'm', 'kg') then raise exception 'INVALID_UNIT: each, roll, m or kg'; end if;
  if p_low_stock_at is not null and (p_low_stock_at < 0 or p_low_stock_at > 1000000) then raise exception 'INVALID_LOW_STOCK: 0 to 1,000,000, or leave it empty'; end if;
  if p_box is not null then
    if p_kind not in ('box', 'mailer') then raise exception 'INVALID_BOX: only a box or mailer material stands for a packing box'; end if;
    select * into v_box from public.wh_boxes where id = p_box;
    if v_box.id is null or v_box.warehouse_code <> p_warehouse then raise exception 'INVALID_BOX: choose a box used at %', p_warehouse; end if;
    if exists (select 1 from public.wh_materials where box_id = p_box and id is distinct from p_id) then
      raise exception 'BOX_ALREADY_STOCKED: % is already tracked as a material', v_box.code;
    end if;
  end if;
  if coalesce(p_auto_dg_mark, false) and p_kind <> 'mark' then raise exception 'INVALID_KIND: only a mark is used automatically for the battery mark'; end if;
  if coalesce(p_auto_dg_mark, false) and coalesce(p_active, true)
     and exists (select 1 from public.wh_materials where warehouse_code = p_warehouse and auto_dg_mark and active and id is distinct from p_id) then
    raise exception 'DG_MARK_EXISTS: another mark is already used automatically for battery parcels here';
  end if;
  if exists (select 1 from public.wh_materials where warehouse_code = p_warehouse and code = v_code and id is distinct from p_id) then
    raise exception 'DUPLICATE_MATERIAL: % already exists here', v_code;
  end if;
  if p_id is null then
    insert into public.wh_materials (warehouse_code, code, name, kind, unit, box_id, low_stock_at, auto_dg_mark, active, updated_by)
    values (p_warehouse, v_code, v_name, p_kind, coalesce(p_unit, 'each'), p_box, p_low_stock_at, coalesce(p_auto_dg_mark, false), coalesce(p_active, true), auth.uid())
    returning id into v_id;
    perform write_audit('wh_material.created', 'wh_materials', v_id::text,
      jsonb_build_object('warehouse', p_warehouse, 'code', v_code, 'kind', p_kind, 'box_id', p_box, 'low_stock_at', p_low_stock_at, 'auto_dg_mark', coalesce(p_auto_dg_mark, false)));
  else
    select * into v_old from public.wh_materials where id = p_id and warehouse_code = p_warehouse for update;
    if v_old.id is null then raise exception 'NOT_FOUND'; end if;
    update public.wh_materials
       set code = v_code, name = v_name, kind = p_kind, unit = coalesce(p_unit, 'each'), box_id = p_box, low_stock_at = p_low_stock_at,
           auto_dg_mark = coalesce(p_auto_dg_mark, false), active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    v_id := p_id;
    perform write_audit('wh_material.updated', 'wh_materials', v_id::text,
      jsonb_build_object('from', to_jsonb(v_old) - 'updated_by' - 'updated_at' - 'on_hand', 'code', v_code, 'kind', p_kind, 'box_id', p_box,
                         'low_stock_at', p_low_stock_at, 'auto_dg_mark', coalesce(p_auto_dg_mark, false), 'active', coalesce(p_active, true)));
  end if;
  return v_id;
end $$;
revoke all on function public.wh_save_material(text, uuid, text, text, text, text, uuid, integer, boolean, boolean) from public, anon;
grant execute on function public.wh_save_material(text, uuid, text, text, text, text, uuid, integer, boolean, boolean) to authenticated, service_role;

-- price charged to the client per unit used (NULL = not set). Only a warehouse admin (or company admin)
create or replace function public.wh_set_material_charge(p_material uuid, p_cents bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.wh_materials;
begin
  select * into m from public.wh_materials where id = p_material for update;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.wh_role(m.warehouse_code) = 'admin' and staff_aal_ok()) then raise exception 'FORBIDDEN: a warehouse admin sets material prices'; end if;
  if p_cents is not null and (p_cents < 0 or p_cents > 10000000) then raise exception 'INVALID_PRICE: 0 to 100,000.00 per unit, or leave it empty (not set)'; end if;
  update public.wh_materials set charge_per_unit_cents = p_cents, charge_set_by = auth.uid(), charge_set_at = now(), updated_at = now() where id = m.id;
  perform write_audit('wh_material.charge_set', 'wh_materials', m.id::text,
    jsonb_build_object('code', m.code, 'from_cents', m.charge_per_unit_cents, 'to_cents', p_cents));
end $$;
revoke all on function public.wh_set_material_charge(uuid, bigint) from public, anon;
grant execute on function public.wh_set_material_charge(uuid, bigint) to authenticated, service_role;

create or replace function public.wh_material_receive(p_material uuid, p_qty integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.wh_materials;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into m from public.wh_materials where id = p_material;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('receive', m.warehouse_code) then raise exception 'FORBIDDEN: receivers, supervisors and admins receive materials'; end if;
  if not m.active then raise exception 'MATERIAL_NOT_IN_USE: % is not in use', m.code; end if;
  if p_qty is null or p_qty < 1 or p_qty > 1000000 then raise exception 'INVALID_QTY: receive 1 to 1,000,000'; end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'NOTE_TOO_LONG: up to 300 characters'; end if;
  perform public.wh_material_post(m.id, 'receive', p_qty, coalesce(v_note, 'Received'), null, null, null);
  perform write_audit('wh_material.received', 'wh_materials', m.id::text, jsonb_build_object('code', m.code, 'qty', p_qty, 'note', v_note));
  return jsonb_build_object('code', m.code, 'on_hand', (select on_hand from public.wh_materials where id = m.id));
end $$;
revoke all on function public.wh_material_receive(uuid, integer, text) from public, anon;
grant execute on function public.wh_material_receive(uuid, integer, text) to authenticated, service_role;

-- a counted quantity replaces on hand through an adjustment (supervisor / admin; reason required)
create or replace function public.wh_material_count(p_material uuid, p_counted integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.wh_materials;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_delta integer;
begin
  select * into m from public.wh_materials where id = p_material for update;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('approve_count', m.warehouse_code) then raise exception 'FORBIDDEN: supervisors and admins count materials'; end if;
  if p_counted is null or p_counted < 0 or p_counted > 1000000 then raise exception 'INVALID_COUNT: 0 to 1,000,000'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: say why the count changes (stock take, damaged …)'; end if;
  if length(v_reason) > 300 then raise exception 'REASON_TOO_LONG: up to 300 characters'; end if;
  v_delta := p_counted - m.on_hand;
  if v_delta > 0 then
    perform public.wh_material_post(m.id, 'adjust_in', v_delta, v_reason, null, null, null);
  elsif v_delta < 0 then
    perform public.wh_material_post(m.id, 'adjust_out', -v_delta, v_reason, null, null, null);
  end if;
  perform write_audit(case when v_delta = 0 then 'wh_material.count_confirmed' else 'wh_material.counted' end, 'wh_materials', m.id::text,
    jsonb_build_object('code', m.code, 'was', m.on_hand, 'counted', p_counted, 'reason', v_reason));
  return jsonb_build_object('code', m.code, 'on_hand', p_counted, 'difference', v_delta);
end $$;
revoke all on function public.wh_material_count(uuid, integer, text) from public, anon;
grant execute on function public.wh_material_count(uuid, integer, text) to authenticated, service_role;

-- extra packaging used at the station (tape, filler …), for the order or one of its open parcels
create or replace function public.wh_pack_use_material(p_order uuid, p_parcel uuid, p_material uuid, p_qty integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  p public.wh_parcels;
  v_usage uuid;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not being packed', o.code, o.status; end if;
  if p_qty is null or p_qty < 1 or p_qty > 1000 then raise exception 'INVALID_QTY: 1 to 1,000 at a time'; end if;
  if p_parcel is not null then
    select * into p from public.wh_parcels where id = p_parcel and order_id = o.id;
    if p.id is null then raise exception 'NOT_FOUND'; end if;
    if p.status <> 'open' then raise exception 'PARCEL_CLOSED: parcel % is closed', p.seq; end if;
  end if;
  v_usage := public.wh_material_use(o.id, p_parcel, p_material, p_qty, 'manual', format('%s packing', o.code));
  return jsonb_build_object('usage_id', v_usage, 'material', (select code from public.wh_materials where id = p_material),
                            'on_hand', (select on_hand from public.wh_materials where id = p_material));
end $$;
revoke all on function public.wh_pack_use_material(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.wh_pack_use_material(uuid, uuid, uuid, integer) to authenticated, service_role;

create or replace function public.wh_pack_void_material(p_usage uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.wh_material_usage;
  o public.wh_orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into u from public.wh_material_usage where id = p_usage;
  if u.id is null then raise exception 'NOT_FOUND'; end if;
  select * into o from public.wh_orders where id = u.order_id for update;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'ORDER_PACKED: % is %; uses of a closed order stay on record', o.code, o.status; end if;
  if u.source <> 'manual' then raise exception 'AUTOMATIC_USE: the box and battery mark go back to stock when a supervisor reopens the parcel'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: say why it was not used'; end if;
  perform public.wh_material_void_internal(u.id, v_reason);
end $$;
revoke all on function public.wh_pack_void_material(uuid, text) from public, anon;
grant execute on function public.wh_pack_void_material(uuid, text) to authenticated, service_role;

create or replace function public.wh_materials_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('stations', coalesce((
    select jsonb_agg(jsonb_build_object(
             'warehouse_code', w.code, 'name', w.name,
             'can_manage', public.wh_role(w.code) in ('supervisor', 'admin'),
             'can_receive', public.wh_can('receive', w.code),
             'can_count', public.wh_can('approve_count', w.code),
             'can_price', public.wh_role(w.code) = 'admin',
             'materials', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', m.id, 'code', m.code, 'name', m.name, 'kind', m.kind, 'unit', m.unit, 'box_id', m.box_id,
                        'box_code', (select x.code from public.wh_boxes x where x.id = m.box_id),
                        'on_hand', m.on_hand, 'low_stock_at', m.low_stock_at, 'low', m.low_stock_at is not null and m.on_hand <= m.low_stock_at,
                        'charge_per_unit_cents', m.charge_per_unit_cents, 'charge_set_at', m.charge_set_at, 'auto_dg_mark', m.auto_dg_mark, 'active', m.active,
                        'used_30d', (select coalesce(sum(u.qty), 0) from public.wh_material_usage u where u.material_id = m.id and u.voided_at is null and u.created_at > now() - interval '30 days'))
                      order by m.active desc, (m.low_stock_at is not null and m.on_hand <= m.low_stock_at) desc, m.code)
                 from public.wh_materials m where m.warehouse_code = w.code), '[]'::jsonb),
             'boxes_without_material', coalesce((
               select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name) order by x.code)
                 from public.wh_boxes x where x.warehouse_code = w.code and x.active and not exists (select 1 from public.wh_materials m where m.box_id = x.id)), '[]'::jsonb),
             'moves', coalesce((
               select jsonb_agg(jsonb_build_object('at', v.created_at, 'material', m.code, 'unit', m.unit, 'kind', v.kind, 'qty', v.qty, 'delta', v.delta,
                        'balance_after', v.balance_after, 'reason', v.reason, 'order_code', (select o.code from public.wh_orders o where o.id = v.order_id),
                        'by_name', pr.full_name) order by v.created_at desc)
                 from (select * from public.wh_material_moves y where y.warehouse_code = w.code order by y.created_at desc limit 40) v
                 join public.wh_materials m on m.id = v.material_id left join public.profiles pr on pr.id = v.actor_id), '[]'::jsonb))
           order by w.is_default desc, w.name)
      from public.warehouses w
     where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_sees(w.code)), '[]'::jsonb));
end $$;
revoke all on function public.wh_materials_board(text) from public, anon;
grant execute on function public.wh_materials_board(text) to authenticated, service_role;

-- benches, materials and uses for one order at the W3a station (and whether it is packed in parcels)
create or replace function public.wh_pack_extras(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  select * into o from public.wh_orders where id = p_order;
  if o.id is null or not public.wh_sees(o.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'parcels', (select count(*) from public.wh_parcels p where p.order_id = o.id),
    'bench_required', exists (select 1 from public.wh_scale_benches b where b.warehouse_code = o.warehouse_code and b.active),
    'weighed_bench', (select code from public.wh_scale_benches where id = o.weighed_bench_id),
    'benches', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name, 'status', b.status, 'locked_reason', b.locked_reason, 'max_g', b.max_g,
               'due', b.status = 'ok' and b.check_every_hours is not null and b.last_pass_at < now() - make_interval(hours => b.check_every_hours)) order by b.code)
        from public.wh_scale_benches b where b.warehouse_code = o.warehouse_code and b.active), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name, 'kind', m.kind, 'unit', m.unit, 'on_hand', m.on_hand, 'box_id', m.box_id) order by m.kind, m.code)
        from public.wh_materials m where m.warehouse_code = o.warehouse_code and m.active), '[]'::jsonb),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'material', m.code, 'name', m.name, 'unit', m.unit, 'qty', u.qty, 'source', u.source,
               'parcel_seq', (select p.seq from public.wh_parcels p where p.id = u.parcel_id), 'voided', u.voided_at is not null,
               'at', u.created_at, 'by_name', pr.full_name) order by u.created_at)
        from public.wh_material_usage u join public.wh_materials m on m.id = u.material_id left join public.profiles pr on pr.id = u.created_by
       where u.order_id = o.id), '[]'::jsonb));
end $$;
revoke all on function public.wh_pack_extras(uuid) from public, anon;
grant execute on function public.wh_pack_extras(uuid) to authenticated, service_role;

-- ───────── 10. Multi-parcel packing (board 14) ─────────
-- shared checks: the order is being packed by someone who packs at its warehouse
create or replace function public.wh_parcel_order_check(p_order uuid)
returns public.wh_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
begin
  select * into o from public.wh_orders where id = p_order for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('pack', o.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not being packed', o.code, o.status; end if;
  perform public.wh_assert_store_order_open(o.store_order_id);
  return o;
end $$;
revoke all on function public.wh_parcel_order_check(uuid) from public, anon, authenticated;
grant execute on function public.wh_parcel_order_check(uuid) to service_role;

-- adds a parcel. The first call turns the order into a multi-parcel order: whatever was already scanned (and its photos and
-- box) becomes parcel 1 and the new, empty parcel is parcel 2; an order-level reading or approval is dropped (weigh per parcel)
create or replace function public.wh_parcel_add(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  v_first boolean;
  v_p1 uuid;
  v_new uuid;
  v_seq integer;
  v_has boolean := false;
begin
  o := public.wh_parcel_order_check(p_order);
  if o.override_locked_at is not null then raise exception 'OVERRIDE_LOCKED: three wrong PINs on this order; a warehouse admin unlocks it first'; end if;
  v_first := not exists (select 1 from public.wh_parcels where order_id = o.id);
  perform set_config('octopus.wh_parcel_op', 'true', true);
  if v_first then
    insert into public.wh_parcels (order_id, warehouse_code, seq, box_id, created_by) values (o.id, o.warehouse_code, 1, o.box_id, auth.uid()) returning id into v_p1;
    insert into public.wh_parcel_items (parcel_id, order_id, line_id, qty)
    select v_p1, o.id, l.id, l.packed_qty from public.wh_order_lines l where l.order_id = o.id and l.packed_qty > 0;
    v_has := found;
    update public.wh_pack_evidence set parcel_id = v_p1 where order_id = o.id and parcel_id is null;
    update public.wh_scan_log set parcel_id = v_p1 where order_id = o.id and station = 'pack' and parcel_id is null;
    perform public.wh_parcel_recalc(v_p1);
    update public.wh_orders
       set box_id = null, expected_weight_g = null, tolerance_g = null, measured_weight_g = null, weighed_by = null, weighed_bench_id = null,
           override_by = null, override_reason = null, override_weight_g = null, override_at = null,
           status = case when status = 'picked' then 'packing' else status end, updated_at = now()
     where id = o.id;
    v_new := v_p1;
    if v_has then
      insert into public.wh_parcels (order_id, warehouse_code, seq, created_by) values (o.id, o.warehouse_code, 2, auth.uid()) returning id into v_new;
    end if;
  else
    select coalesce(max(seq), 0) + 1 into v_seq from public.wh_parcels where order_id = o.id;
    if v_seq > 50 then raise exception 'TOO_MANY_PARCELS: up to 50 parcels per order'; end if;
    insert into public.wh_parcels (order_id, warehouse_code, seq, created_by) values (o.id, o.warehouse_code, v_seq, auth.uid()) returning id into v_new;
    if o.status = 'picked' then update public.wh_orders set status = 'packing', updated_at = now() where id = o.id; end if;
  end if;
  perform set_config('octopus.wh_parcel_op', '', true);
  select seq into v_seq from public.wh_parcels where id = v_new;
  perform write_audit('wh_parcel.added', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'parcel', v_seq, 'converted', v_first and v_has));
  return jsonb_build_object('parcel_id', v_new, 'seq', v_seq, 'converted', v_first and v_has);
end $$;
revoke all on function public.wh_parcel_add(uuid) from public, anon;
grant execute on function public.wh_parcel_add(uuid) to authenticated, service_role;

-- locks the order then the parcel; the parcel must be open
create or replace function public.wh_parcel_open_check(p_parcel uuid)
returns public.wh_parcels
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
begin
  select * into p from public.wh_parcels where id = p_parcel;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  perform public.wh_parcel_order_check(p.order_id);
  select * into p from public.wh_parcels where id = p_parcel for update;
  if p.status <> 'open' then raise exception 'PARCEL_CLOSED: parcel % is closed; a supervisor reopens it', p.seq; end if;
  return p;
end $$;
revoke all on function public.wh_parcel_open_check(uuid) from public, anon, authenticated;
grant execute on function public.wh_parcel_open_check(uuid) to service_role;

create or replace function public.wh_parcel_scan(p_parcel uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  l public.wh_order_lines;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_in integer;
  v_all boolean;
begin
  p := public.wh_parcel_open_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  if v_code = '' then raise exception 'SCAN_ITEM: scan or type the product'; end if;
  select * into l from public.wh_order_lines
   where order_id = o.id and (upper(sku) = v_code or upper(coalesce(barcode, '')) = v_code)
   order by (packed_qty < picked_qty) desc, id limit 1;
  if l.id is null then
    insert into public.wh_scan_log (order_id, warehouse_code, station, code, result, line_id, qty, actor_id, parcel_id)
    values (o.id, o.warehouse_code, 'pack', left(v_code, 128), 'wrong_item', null, 1, auth.uid(), p.id);
    return jsonb_build_object('ok', false, 'result', 'wrong_item', 'message', format('%s is not in order %s — keep it out of the box', v_code, o.code));
  end if;
  if l.packed_qty >= l.picked_qty then
    insert into public.wh_scan_log (order_id, warehouse_code, station, code, result, line_id, qty, actor_id, parcel_id)
    values (o.id, o.warehouse_code, 'pack', left(v_code, 128), 'too_many', l.id, 1, auth.uid(), p.id);
    return jsonb_build_object('ok', false, 'result', 'too_many', 'message', format('All %s of %s are already in parcels', l.picked_qty, l.sku));
  end if;
  perform set_config('octopus.wh_parcel_op', 'true', true);
  update public.wh_order_lines set packed_qty = packed_qty + 1 where id = l.id;
  insert into public.wh_parcel_items (parcel_id, order_id, line_id, qty) values (p.id, o.id, l.id, 1)
  on conflict (parcel_id, line_id) do update set qty = public.wh_parcel_items.qty + 1;
  if o.status = 'picked' then update public.wh_orders set status = 'packing', updated_at = now() where id = o.id; end if;
  perform set_config('octopus.wh_parcel_op', '', true);
  insert into public.wh_scan_log (order_id, warehouse_code, station, code, result, line_id, qty, actor_id, parcel_id)
  values (o.id, o.warehouse_code, 'pack', left(v_code, 128), 'ok', l.id, 1, auth.uid(), p.id);
  perform public.wh_parcel_recalc(p.id);
  select qty into v_in from public.wh_parcel_items where parcel_id = p.id and line_id = l.id;
  v_all := not exists (select 1 from public.wh_order_lines where order_id = o.id and packed_qty < picked_qty);
  return jsonb_build_object('ok', true, 'result', 'ok', 'sku', l.sku, 'seq', p.seq, 'in_parcel', v_in, 'all_in_parcels', v_all,
                            'message', format('%s into parcel %s (%s of %s in parcels)', l.sku, p.seq, l.packed_qty + 1, l.picked_qty));
end $$;
revoke all on function public.wh_parcel_scan(uuid, text) from public, anon;
grant execute on function public.wh_parcel_scan(uuid, text) to authenticated, service_role;

-- takes one unit of a line back out of an open parcel
create or replace function public.wh_parcel_unscan(p_parcel uuid, p_line uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  i public.wh_parcel_items;
  v_sku text;
begin
  p := public.wh_parcel_open_check(p_parcel);
  select * into i from public.wh_parcel_items where parcel_id = p.id and line_id = p_line for update;
  if i.id is null then raise exception 'NOT_IN_PARCEL: that product is not in parcel %', p.seq; end if;
  perform set_config('octopus.wh_parcel_op', 'true', true);
  update public.wh_order_lines set packed_qty = packed_qty - 1 where id = p_line returning sku into v_sku;
  if i.qty = 1 then delete from public.wh_parcel_items where id = i.id; else update public.wh_parcel_items set qty = qty - 1 where id = i.id; end if;
  perform set_config('octopus.wh_parcel_op', '', true);
  perform public.wh_parcel_recalc(p.id);
  perform write_audit('wh_parcel.item_removed', 'wh_orders', p.order_id::text, jsonb_build_object('parcel', p.seq, 'sku', v_sku));
  return jsonb_build_object('ok', true, 'message', format('One %s taken out of parcel %s', v_sku, p.seq));
end $$;
revoke all on function public.wh_parcel_unscan(uuid, uuid) from public, anon;
grant execute on function public.wh_parcel_unscan(uuid, uuid) to authenticated, service_role;

create or replace function public.wh_parcel_set_box(p_parcel uuid, p_box uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  b public.wh_boxes;
begin
  p := public.wh_parcel_open_check(p_parcel);
  select * into b from public.wh_boxes where id = p_box;
  if b.id is null or b.warehouse_code <> p.warehouse_code then raise exception 'INVALID_BOX: choose a box used at %', p.warehouse_code; end if;
  if not b.active then raise exception 'INVALID_BOX: % is not in use', b.name; end if;
  update public.wh_parcels set box_id = b.id, updated_at = now() where id = p.id;
  perform public.wh_parcel_recalc(p.id);
  select * into p from public.wh_parcels where id = p.id;
  perform write_audit('wh_parcel.box_chosen', 'wh_orders', p.order_id::text,
    jsonb_build_object('parcel', p.seq, 'box', b.code, 'tare_g', b.tare_g, 'expected_g', p.expected_weight_g, 'tolerance_g', p.tolerance_g));
  return jsonb_build_object('seq', p.seq, 'box', b.code, 'expected_g', p.expected_weight_g, 'tolerance_g', p.tolerance_g, 'unknown_weight', p.expected_weight_g is null);
end $$;
revoke all on function public.wh_parcel_set_box(uuid, uuid) from public, anon;
grant execute on function public.wh_parcel_set_box(uuid, uuid) to authenticated, service_role;

-- the parcel's reading on a bench (required once the warehouse has benches). A new reading voids an earlier approval unless
-- it is the same grams and the approver is not the new weigher (same rule as W3a)
create or replace function public.wh_parcel_weigh(p_parcel uuid, p_bench uuid, p_grams integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  v_within boolean;
  v_bench text;
begin
  p := public.wh_parcel_open_check(p_parcel);
  if p.box_id is null then raise exception 'BOX_REQUIRED: choose the box of parcel % first', p.seq; end if;
  if not exists (select 1 from public.wh_parcel_items where parcel_id = p.id) then raise exception 'EMPTY_PARCEL: scan items into parcel % first', p.seq; end if;
  if p_grams is null or p_grams < 1 or p_grams > 1000000 then raise exception 'INVALID_WEIGHT: enter the scale reading in grams'; end if;
  if p_bench is null then
    if exists (select 1 from public.wh_scale_benches b where b.warehouse_code = p.warehouse_code and b.active) then
      raise exception 'BENCH_REQUIRED: choose the scale bench you weighed on';
    end if;
  else
    perform public.wh_bench_assert(p_bench, p.warehouse_code, p_grams);
    select code into v_bench from public.wh_scale_benches where id = p_bench;
  end if;
  v_within := case when p.expected_weight_g is null then null else abs(p_grams - p.expected_weight_g) <= p.tolerance_g end;
  update public.wh_parcels
     set measured_weight_g = p_grams, weighed_by = auth.uid(), bench_id = p_bench, updated_at = now(),
         override_by = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_by end,
         override_reason = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_reason end,
         override_at = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_at end,
         override_weight_g = case when override_weight_g = p_grams and override_by is distinct from auth.uid() then override_weight_g end
   where id = p.id;
  perform write_audit('wh_parcel.weighed', 'wh_orders', p.order_id::text,
    jsonb_build_object('parcel', p.seq, 'measured_g', p_grams, 'expected_g', p.expected_weight_g, 'tolerance_g', p.tolerance_g, 'within', v_within, 'bench', v_bench));
  return jsonb_build_object('seq', p.seq, 'measured_g', p_grams, 'expected_g', p.expected_weight_g, 'tolerance_g', p.tolerance_g, 'within', v_within, 'bench', v_bench,
                            'difference_g', case when p.expected_weight_g is null then null else p_grams - p.expected_weight_g end);
end $$;
revoke all on function public.wh_parcel_weigh(uuid, uuid, integer) from public, anon;
grant execute on function public.wh_parcel_weigh(uuid, uuid, integer) to authenticated, service_role;

-- supervisor PIN approval of one parcel's weight (W3a rules: two people, 3 wrong PINs lock the parcel, 10 lock the PIN)
create or replace function public.wh_parcel_override(p_parcel uuid, p_supervisor uuid, p_pin text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  s public.wh_supervisor_pins;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ok boolean;
  v_attempts integer;
begin
  select * into p from public.wh_parcels where id = p_parcel;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  select * into o from public.wh_orders where id = p.order_id for update;
  if not (public.wh_can('pack', o.warehouse_code) or public.wh_can('approve_override', o.warehouse_code)) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'INVALID_STEP: % is %, not being packed', o.code, o.status; end if;
  select * into p from public.wh_parcels where id = p_parcel for update;
  if p.status <> 'open' then raise exception 'PARCEL_CLOSED: parcel % is closed', p.seq; end if;
  if p.measured_weight_g is null then raise exception 'WEIGH_FIRST: weigh parcel % first', p.seq; end if;
  if p.expected_weight_g is not null and abs(p.measured_weight_g - p.expected_weight_g) <= p.tolerance_g then
    raise exception 'NO_OVERRIDE_NEEDED: the weight is inside tolerance';
  end if;
  if p.override_locked_at is not null then raise exception 'OVERRIDE_LOCKED: three wrong PINs; a warehouse admin must unlock this parcel'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'REASON_REQUIRED: enter why this weight is accepted'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: up to 500 characters'; end if;
  if not public.wh_user_can(p_supervisor, 'approve_override', o.warehouse_code) then
    raise exception 'SUPERVISOR_REQUIRED: choose a supervisor or admin of %; packers cannot approve overrides', o.warehouse_code;
  end if;
  if p_supervisor = p.weighed_by or exists (select 1 from public.wh_scan_log x
                                             where x.parcel_id = p.id and x.station = 'pack' and x.result = 'ok' and x.actor_id = p_supervisor) then
    raise exception 'TWO_PERSON_REQUIRED: the supervisor who approves must not be the person who packed or weighed this parcel';
  end if;
  select * into s from public.wh_supervisor_pins where user_id = p_supervisor for update;
  if s.user_id is null then raise exception 'NO_PIN: this supervisor has not set an override PIN yet'; end if;
  if s.locked_at is not null then raise exception 'PIN_LOCKED: this PIN is locked after too many wrong tries; its owner sets a new one'; end if;
  v_ok := s.pin_hash = extensions.crypt(btrim(coalesce(p_pin, '')), s.pin_hash);
  insert into public.wh_override_attempts (order_id, warehouse_code, supervisor_id, ok, reason, expected_weight_g, measured_weight_g, actor_id, parcel_id)
  values (o.id, o.warehouse_code, p_supervisor, v_ok, v_reason, p.expected_weight_g, p.measured_weight_g, auth.uid(), p.id);
  if not v_ok then
    v_attempts := p.override_attempts + 1;
    update public.wh_parcels set override_attempts = v_attempts, override_locked_at = case when v_attempts >= 3 then now() end, updated_at = now() where id = p.id;
    update public.wh_supervisor_pins set failed_count = failed_count + 1, locked_at = case when failed_count + 1 >= 10 then now() end where user_id = p_supervisor;
    perform write_audit('wh_parcel.pin_wrong', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'parcel', p.seq, 'supervisor', p_supervisor, 'attempt', v_attempts));
    if v_attempts >= 3 then
      perform write_audit('wh_parcel.override_locked', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'parcel', p.seq, 'supervisor', p_supervisor));
    end if;
    return jsonb_build_object('ok', false, 'attempts_left', greatest(3 - v_attempts, 0), 'locked', v_attempts >= 3,
      'message', case when v_attempts >= 3 then 'Wrong PIN. This parcel''s override is locked; a warehouse admin must unlock it.'
                      else format('Wrong PIN. %s attempt(s) left.', 3 - v_attempts) end);
  end if;
  update public.wh_supervisor_pins set failed_count = 0 where user_id = p_supervisor;
  update public.wh_parcels set override_by = p_supervisor, override_reason = v_reason, override_weight_g = p.measured_weight_g, override_at = now(), updated_at = now() where id = p.id;
  perform write_audit('wh_parcel.override_approved', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'parcel', p.seq, 'supervisor', p_supervisor, 'reason', v_reason, 'expected_g', p.expected_weight_g, 'measured_g', p.measured_weight_g));
  return jsonb_build_object('ok', true, 'message', format('Override approved for parcel %s. Another person can close it.', p.seq));
end $$;
revoke all on function public.wh_parcel_override(uuid, uuid, text, text) from public, anon;
grant execute on function public.wh_parcel_override(uuid, uuid, text, text) to authenticated, service_role;

create or replace function public.wh_parcel_unlock_override(p_parcel uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into p from public.wh_parcels where id = p_parcel for update;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.wh_role(p.warehouse_code) = 'admin' and staff_aal_ok()) then raise exception 'FORBIDDEN: a warehouse admin unlocks overrides'; end if;
  if p.override_locked_at is null then raise exception 'NOT_LOCKED: the override is not locked'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the override is unlocked'; end if;
  update public.wh_parcels set override_attempts = 0, override_locked_at = null, updated_at = now() where id = p.id;
  perform write_audit('wh_parcel.override_unlocked', 'wh_orders', p.order_id::text, jsonb_build_object('parcel', p.seq, 'reason', v_reason));
end $$;
revoke all on function public.wh_parcel_unlock_override(uuid, text) from public, anon;
grant execute on function public.wh_parcel_unlock_override(uuid, text) to authenticated, service_role;

-- a photo of one parcel already uploaded to the private bucket (same path rule as W3a: <WH>/<WO-code>/<kind>-<uuid>.<ext>)
create or replace function public.wh_parcel_add_evidence(p_parcel uuid, p_kind text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  st record;
  v_row public.wh_pack_evidence;
begin
  p := public.wh_parcel_open_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  if p_kind not in ('contents', 'sealed', 'scale') then raise exception 'INVALID_KIND'; end if;
  if p_path is null or p_path !~ ('^' || o.warehouse_code || '/' || o.code || '/' || p_kind || '-[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'INVALID_PATH: upload the photo for this order first';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'wh-evidence' and name = p_path) then
    raise exception 'NOT_UPLOADED: the photo did not arrive; take it again';
  end if;
  if (select count(*) from public.wh_pack_evidence where parcel_id = p.id) >= 12 then raise exception 'TOO_MANY_PHOTOS: up to 12 photos per parcel'; end if;
  select * into st from public.wh_settings_for(o.warehouse_code);
  perform set_config('octopus.wh_parcel_op', 'true', true);
  insert into public.wh_pack_evidence (order_id, warehouse_code, kind, storage_path, uploaded_by, retention_until, parcel_id)
  values (o.id, o.warehouse_code, p_kind, p_path, auth.uid(), now() + make_interval(days => st.retention_days), p.id)
  on conflict (storage_path) do nothing
  returning * into v_row;
  perform set_config('octopus.wh_parcel_op', '', true);
  if v_row.id is null then select * into v_row from public.wh_pack_evidence where storage_path = p_path; end if;
  if v_row.parcel_id is distinct from p.id then raise exception 'INVALID_PATH: that photo belongs to another parcel'; end if;
  perform write_audit('wh_parcel.evidence_added', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'parcel', p.seq, 'kind', p_kind, 'path', p_path, 'retention_until', v_row.retention_until));
  return jsonb_build_object('id', v_row.id, 'kind', v_row.kind, 'retention_until', v_row.retention_until);
end $$;
revoke all on function public.wh_parcel_add_evidence(uuid, text, text) from public, anon;
grant execute on function public.wh_parcel_add_evidence(uuid, text, text) to authenticated, service_role;

-- close one parcel: items, box, weight inside tolerance or approved, battery mark when it carries dangerous goods, three photos.
-- Its box (and the battery mark) are taken from materials stock when they are stocked.
create or replace function public.wh_parcel_close(p_parcel uuid, p_battery_mark boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  v_dg text[];
  v_missing text[];
  v_mark boolean;
  v_open integer;
begin
  p := public.wh_parcel_open_check(p_parcel);
  select * into o from public.wh_orders where id = p.order_id;
  if not exists (select 1 from public.wh_parcel_items where parcel_id = p.id) then raise exception 'EMPTY_PARCEL: scan items into parcel % first', p.seq; end if;
  if p.box_id is null then raise exception 'BOX_REQUIRED: choose the box of parcel % first', p.seq; end if;
  if p.measured_weight_g is null then raise exception 'WEIGH_FIRST: weigh parcel % first', p.seq; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_dg
    from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id cross join lateral unnest(public.wh_dg_kinds(l.item_id)) x
   where i.parcel_id = p.id;
  v_mark := cardinality(v_dg) > 0 and coalesce(p_battery_mark, false);
  if cardinality(v_dg) > 0 and not v_mark then
    raise exception 'BATTERY_MARK_REQUIRED: parcel % has dangerous goods (%); apply the battery mark and tick it', p.seq, array_to_string(v_dg, ', ');
  end if;
  select array_agg(k) into v_missing from unnest(array['contents', 'sealed', 'scale']) k
   where not exists (select 1 from public.wh_pack_evidence e where e.parcel_id = p.id and e.kind = k);
  if v_missing is not null then raise exception 'EVIDENCE_REQUIRED: add the % photo(s) of parcel %', array_to_string(v_missing, ', '), p.seq; end if;
  if not ((p.expected_weight_g is not null and abs(p.measured_weight_g - p.expected_weight_g) <= p.tolerance_g)
          or (p.override_at is not null and p.override_weight_g = p.measured_weight_g)) then
    if p.expected_weight_g is null then
      raise exception 'WEIGHT_UNKNOWN: the expected weight of parcel % is unknown (a product has no weight); a supervisor approves with a PIN', p.seq;
    end if;
    raise exception 'WEIGHT_OUT_OF_TOLERANCE: parcel %: % g measured, % g expected (± % g); a supervisor approves with a PIN',
      p.seq, p.measured_weight_g, p.expected_weight_g, p.tolerance_g;
  end if;
  if p.override_by = auth.uid() then raise exception 'TWO_PERSON_REQUIRED: you approved this weight; another person closes the parcel'; end if;
  update public.wh_parcels set status = 'closed', closed_by = auth.uid(), closed_at = now(), battery_mark = v_mark, updated_at = now() where id = p.id;
  perform public.wh_use_pack_materials(o.id, p.id, p.box_id, v_mark);
  select count(*) into v_open from public.wh_parcels where order_id = o.id and status = 'open';
  perform write_audit('wh_parcel.closed', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'parcel', p.seq, 'measured_g', p.measured_weight_g, 'expected_g', p.expected_weight_g, 'tolerance_g', p.tolerance_g,
                       'override', p.override_at is not null, 'battery_mark', v_mark));
  return jsonb_build_object('seq', p.seq, 'status', 'closed', 'open_parcels', v_open,
                            'all_in_parcels', not exists (select 1 from public.wh_order_lines where order_id = o.id and packed_qty < picked_qty));
end $$;
revoke all on function public.wh_parcel_close(uuid, boolean) from public, anon;
grant execute on function public.wh_parcel_close(uuid, boolean) to authenticated, service_role;

-- a supervisor reopens a closed parcel before the order is closed; its box / battery mark go back to stock
create or replace function public.wh_parcel_reopen(p_parcel uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
  o public.wh_orders;
  u record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into p from public.wh_parcels where id = p_parcel;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  select * into o from public.wh_orders where id = p.order_id for update;
  if not public.wh_can('resolve_exception', o.warehouse_code) then raise exception 'FORBIDDEN: a supervisor reopens a parcel'; end if;
  if o.status not in ('picked', 'packing') then raise exception 'ORDER_PACKED: % is %; its parcels stay closed', o.code, o.status; end if;
  select * into p from public.wh_parcels where id = p_parcel for update;
  if p.status <> 'closed' then raise exception 'NOT_CLOSED: parcel % is open', p.seq; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: say why the parcel is reopened'; end if;
  for u in select id from public.wh_material_usage where parcel_id = p.id and source in ('box', 'dg_mark') and voided_at is null loop
    perform public.wh_material_void_internal(u.id, format('parcel %s reopened: %s', p.seq, v_reason));
  end loop;
  update public.wh_parcels set status = 'open', closed_by = null, closed_at = null, battery_mark = false, updated_at = now() where id = p.id;
  perform write_audit('wh_parcel.reopened', 'wh_orders', o.id::text, jsonb_build_object('code', o.code, 'parcel', p.seq, 'reason', v_reason));
end $$;
revoke all on function public.wh_parcel_reopen(uuid, text) from public, anon;
grant execute on function public.wh_parcel_reopen(uuid, text) to authenticated, service_role;

-- removes the last parcel while it is still empty (no items, no photos)
create or replace function public.wh_parcel_remove(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.wh_parcels;
begin
  p := public.wh_parcel_open_check(p_parcel);
  if exists (select 1 from public.wh_parcel_items where parcel_id = p.id) then raise exception 'PARCEL_NOT_EMPTY: take the items out of parcel % first', p.seq; end if;
  if exists (select 1 from public.wh_pack_evidence where parcel_id = p.id) then raise exception 'PARCEL_HAS_PHOTOS: parcel % already has photos', p.seq; end if;
  if exists (select 1 from public.wh_material_usage where parcel_id = p.id and voided_at is null) then raise exception 'PARCEL_HAS_MATERIALS: take back the materials of parcel % first', p.seq; end if;
  if p.seq <> (select max(seq) from public.wh_parcels where order_id = p.order_id) then raise exception 'NOT_LAST: only the last parcel can be removed'; end if;
  delete from public.wh_parcels where id = p.id;
  perform write_audit('wh_parcel.removed', 'wh_orders', p.order_id::text, jsonb_build_object('parcel', p.seq));
end $$;
revoke all on function public.wh_parcel_remove(uuid) from public, anon;
grant execute on function public.wh_parcel_remove(uuid) to authenticated, service_role;

-- close the order: every picked unit is in a closed parcel. The order row gets the totals (box of parcel 1, summed weights;
-- an approval on any parcel shows as a supervisor approval on the order) so the W3a packed-proof constraint holds.
create or replace function public.wh_parcels_close_order(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
  a record;
  v_open text;
  v_need boolean;
begin
  o := public.wh_parcel_order_check(p_order);
  if not exists (select 1 from public.wh_parcels where order_id = o.id) then raise exception 'NO_PARCELS: add parcels first, or close it at the packing station'; end if;
  select string_agg(seq::text, ', ' order by seq) into v_open from public.wh_parcels where order_id = o.id and status = 'open';
  if v_open is not null then raise exception 'PARCEL_OPEN: close parcel(s) % first', v_open; end if;
  if not exists (select 1 from public.wh_order_lines where order_id = o.id and picked_qty > 0) then raise exception 'NOTHING_PICKED'; end if;
  if exists (select 1 from public.wh_order_lines where order_id = o.id and packed_qty < picked_qty) then
    raise exception 'NOT_ALL_PACKED: put every picked item into a parcel (% unit(s) left)',
      (select sum(picked_qty - packed_qty) from public.wh_order_lines where order_id = o.id);
  end if;
  if exists (select 1 from public.wh_order_lines l
              where l.order_id = o.id and l.packed_qty <> coalesce((select sum(i.qty) from public.wh_parcel_items i where i.line_id = l.id), 0)) then
    raise exception 'PARCEL_MISMATCH: the parcel contents do not match the packed units; reopen and scan again';
  end if;
  if exists (select 1 from public.wh_parcels p where p.order_id = o.id and not exists (select 1 from public.wh_parcel_items i where i.parcel_id = p.id)) then
    raise exception 'EMPTY_PARCEL: remove the empty parcel first';
  end if;
  select count(*) n, sum(p.measured_weight_g)::integer m, bool_and(p.expected_weight_g is not null and p.tolerance_g is not null) known,
         sum(p.expected_weight_g)::integer e, sum(p.tolerance_g)::integer t, bool_or(p.override_at is not null) any_override, bool_or(p.battery_mark) any_mark,
         string_agg(case when p.override_at is not null then format('P%s: %s', p.seq, p.override_reason) end, '; ' order by p.seq) reasons,
         (select p1.box_id from public.wh_parcels p1 where p1.order_id = o.id order by p1.seq limit 1) box
    into a from public.wh_parcels p where p.order_id = o.id;
  if o.has_dangerous_goods and not coalesce(a.any_mark, false) then raise exception 'BATTERY_MARK_REQUIRED: the dangerous goods parcel needs the battery mark'; end if;
  if a.m > 1000000 then raise exception 'TOO_HEAVY: % g in total; ship it as freight (W4)', a.m; end if;
  v_need := a.any_override or not (a.known and abs(a.m - a.e) <= a.t);
  perform set_config('octopus.wh_parcel_op', 'true', true);
  update public.wh_orders
     set box_id = a.box, expected_weight_g = case when a.known then a.e end, tolerance_g = case when a.known then a.t end, measured_weight_g = a.m,
         weighed_by = null, weighed_bench_id = null, override_by = null,
         override_reason = case when v_need then left(coalesce(a.reasons, 'Weights approved parcel by parcel'), 500) end,
         override_weight_g = case when v_need then a.m end, override_at = case when v_need then now() end,
         battery_mark = coalesce(a.any_mark, false), status = 'packed', packed_at = now(), packed_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform set_config('octopus.wh_parcel_op', '', true);
  perform write_audit('wh_order.packed', 'wh_orders', o.id::text,
    jsonb_build_object('code', o.code, 'parcels', a.n, 'measured_g', a.m, 'expected_g', case when a.known then a.e end, 'tolerance_g', case when a.known then a.t end,
                       'override', v_need, 'battery_mark', coalesce(a.any_mark, false)));
  return jsonb_build_object('code', o.code, 'status', 'packed', 'parcels', a.n, 'measured_g', a.m);
end $$;
revoke all on function public.wh_parcels_close_order(uuid) from public, anon;
grant execute on function public.wh_parcels_close_order(uuid) to authenticated, service_role;

-- board 14 for one order: lines, parcels (items, box, weights, override, photos, materials), boxes, benches, materials
create or replace function public.wh_multi_parcel(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.wh_orders;
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  select * into o from public.wh_orders where code = upper(btrim(coalesce(p_ref, ''))) or id::text = btrim(coalesce(p_ref, ''));
  if o.id is null or not public.wh_sees(o.warehouse_code) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'order', public.wh_order_row(o) || jsonb_build_object('measured_weight_g', o.measured_weight_g, 'expected_weight_g', o.expected_weight_g,
                                                          'override_locked_at', o.override_locked_at, 'packed_by_name', (select full_name from public.profiles where id = o.packed_by)),
    'me', auth.uid(),
    'can_pack', public.wh_can('pack', o.warehouse_code),
    'can_reopen', public.wh_can('resolve_exception', o.warehouse_code),
    'can_unlock', public.wh_role(o.warehouse_code) = 'admin',
    'bench_required', exists (select 1 from public.wh_scale_benches b where b.warehouse_code = o.warehouse_code and b.active),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'sku', l.sku, 'barcode', l.barcode, 'name', l.name, 'picked', l.picked_qty, 'packed', l.packed_qty,
               'unit_weight_g', l.unit_weight_g, 'dg', to_jsonb(public.wh_dg_kinds(l.item_id))) order by l.sku)
        from public.wh_order_lines l where l.order_id = o.id and l.picked_qty > 0), '[]'::jsonb),
    'parcels', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'seq', p.seq, 'status', p.status, 'source', p.source,
               'box', (select jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'tare_g', x.tare_g) from public.wh_boxes x where x.id = p.box_id),
               'expected_weight_g', p.expected_weight_g, 'tolerance_g', p.tolerance_g, 'measured_weight_g', p.measured_weight_g,
               'weighed_by_name', (select full_name from public.profiles where id = p.weighed_by),
               'bench', (select code from public.wh_scale_benches where id = p.bench_id),
               'battery_mark', p.battery_mark, 'override_attempts', p.override_attempts, 'override_locked_at', p.override_locked_at,
               'override_by_id', p.override_by, 'override_by_name', (select full_name from public.profiles where id = p.override_by),
               'override_reason', p.override_reason, 'override_weight_g', p.override_weight_g, 'override_at', p.override_at,
               'closed_at', p.closed_at, 'closed_by_name', (select full_name from public.profiles where id = p.closed_by),
               'items', coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id, 'sku', l.sku, 'name', l.name, 'qty', i.qty) order by l.sku)
                                    from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id where i.parcel_id = p.id), '[]'::jsonb),
               'dg', coalesce((select jsonb_agg(distinct x) from public.wh_parcel_items i join public.wh_order_lines l on l.id = i.line_id
                                 cross join lateral unnest(public.wh_dg_kinds(l.item_id)) x where i.parcel_id = p.id), '[]'::jsonb),
               'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'path', e.storage_path, 'at', e.created_at,
                                       'retention_until', e.retention_until, 'by_name', pr.full_name) order by e.created_at)
                                       from public.wh_pack_evidence e left join public.profiles pr on pr.id = e.uploaded_by where e.parcel_id = p.id), '[]'::jsonb),
               'materials', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'material', m.code, 'name', m.name, 'unit', m.unit, 'qty', u.qty,
                                        'source', u.source, 'voided', u.voided_at is not null) order by u.created_at)
                                        from public.wh_material_usage u join public.wh_materials m on m.id = u.material_id where u.parcel_id = p.id), '[]'::jsonb),
               'supervisors', coalesce((
                 select jsonb_agg(jsonb_build_object('id', sp.user_id, 'name', coalesce(pr.full_name, pr.email)) order by pr.full_name)
                   from public.wh_supervisor_pins sp join public.profiles pr on pr.id = sp.user_id
                  where sp.locked_at is null and public.wh_user_can(sp.user_id, 'approve_override', o.warehouse_code)
                    and sp.user_id is distinct from p.weighed_by
                    and not exists (select 1 from public.wh_scan_log s where s.parcel_id = p.id and s.station = 'pack' and s.result = 'ok' and s.actor_id = sp.user_id)), '[]'::jsonb))
             order by p.seq)
        from public.wh_parcels p where p.order_id = o.id), '[]'::jsonb),
    'boxes', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'tare_g', x.tare_g, 'length_mm', x.length_mm, 'width_mm', x.width_mm,
               'height_mm', x.height_mm, 'stock', (select m.on_hand from public.wh_materials m where m.box_id = x.id and m.active)) order by x.code)
        from public.wh_boxes x where x.warehouse_code = o.warehouse_code and x.active), '[]'::jsonb),
    'benches', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name, 'status', b.status, 'locked_reason', b.locked_reason, 'max_g', b.max_g,
               'due', b.status = 'ok' and b.check_every_hours is not null and b.last_pass_at < now() - make_interval(hours => b.check_every_hours)) order by b.code)
        from public.wh_scale_benches b where b.warehouse_code = o.warehouse_code and b.active), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name, 'kind', m.kind, 'unit', m.unit, 'on_hand', m.on_hand) order by m.kind, m.code)
        from public.wh_materials m where m.warehouse_code = o.warehouse_code and m.active and m.box_id is null and not m.auto_dg_mark), '[]'::jsonb));
end $$;
revoke all on function public.wh_multi_parcel(text) from public, anon;
grant execute on function public.wh_multi_parcel(text) to authenticated, service_role;

-- orders that can be packed in parcels at the caller's warehouse(s)
create or replace function public.wh_multi_parcel_queue(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(public.wh_order_row(o) || jsonb_build_object('parcels', (select count(*) from public.wh_parcels p where p.order_id = o.id))
                     order by o.picked_at nulls last, o.created_at)
      from (select x.id from public.wh_orders x
             where x.status in ('picked', 'packing') and (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
             order by x.picked_at nulls last, x.created_at limit 200) q
      join public.wh_orders o on o.id = q.id), '[]'::jsonb);
end $$;
revoke all on function public.wh_multi_parcel_queue(text) from public, anon;
grant execute on function public.wh_multi_parcel_queue(text) to authenticated, service_role;

-- ───────── 11. Exceptions queue (board 29) ─────────
create or replace function public.wh_exception_held(e public.wh_exceptions)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select e.status <> 'resolved' and (
    (e.kind in ('short_pick', 'other') and e.source = 'auto' and e.parcel_id is null
       and exists (select 1 from public.wh_orders o where o.id = e.order_id and o.status = 'exception'))
    or (e.kind = 'weight' and e.parcel_id is not null and exists (select 1 from public.wh_parcels p where p.id = e.parcel_id and p.override_locked_at is not null))
    or (e.kind = 'weight' and e.parcel_id is null and exists (select 1 from public.wh_orders o where o.id = e.order_id and o.override_locked_at is not null))
    or (e.kind = 'receiving' and exists (select 1 from public.wh_lots t where t.id = e.lot_id and t.status = 'blocked')))
$$;
revoke all on function public.wh_exception_held(public.wh_exceptions) from public, anon, authenticated;
grant execute on function public.wh_exception_held(public.wh_exceptions) to service_role;

-- what releases this exception: W3a / W2a functions do the release (and resolve it through the triggers)
create or replace function public.wh_exception_actions(e public.wh_exceptions)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.status = 'resolved' then '{}'::text[]
    when not public.wh_exception_held(e) then array['close']
    when e.kind in ('short_pick', 'other') then
      array['retry'] || case when (select coalesce(sum(picked_qty), 0) from public.wh_order_lines where order_id = e.order_id) > 0 then array['ship_short'] else array['cancel'] end
    when e.kind = 'weight' then array['unlock_override']
    when e.kind = 'receiving' then array['approve_lot']
    else array['close'] end
$$;
revoke all on function public.wh_exception_actions(public.wh_exceptions) from public, anon, authenticated;
grant execute on function public.wh_exception_actions(public.wh_exceptions) to service_role;

create or replace function public.wh_exception_raise(p_warehouse text, p_kind text, p_title text, p_order_code text default null, p_asn_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  o public.wh_orders;
  a public.wh_asns;
  v_id uuid;
  v_code text;
begin
  if not public.wh_can('view', p_warehouse) then raise exception 'FORBIDDEN: staff of this warehouse report exceptions'; end if;
  if p_kind is null or p_kind not in ('weight', 'receiving', 'label', 'stock', 'carrier', 'other') then
    raise exception 'INVALID_KIND: weight, receiving, label, stock, carrier or other (short picks are reported while picking)';
  end if;
  if length(v_title) < 3 or length(v_title) > 600 then raise exception 'INVALID_TITLE: describe the problem (3 to 600 characters)'; end if;
  if nullif(btrim(coalesce(p_order_code, '')), '') is not null then
    select * into o from public.wh_orders where code = upper(btrim(p_order_code)) and warehouse_code = p_warehouse;
    if o.id is null then raise exception 'ORDER_NOT_FOUND: no order % at %', upper(btrim(p_order_code)), p_warehouse; end if;
    if exists (select 1 from public.wh_exceptions where order_id = o.id and kind = p_kind and parcel_id is null and status <> 'resolved') then
      raise exception 'ALREADY_OPEN: % already has an open % exception', o.code, p_kind;
    end if;
  end if;
  if nullif(btrim(coalesce(p_asn_code, '')), '') is not null then
    select * into a from public.wh_asns where code = upper(btrim(p_asn_code)) and warehouse_code = p_warehouse;
    if a.id is null then raise exception 'ASN_NOT_FOUND: no notice % at %', upper(btrim(p_asn_code)), p_warehouse; end if;
  end if;
  insert into public.wh_exceptions (warehouse_code, kind, source, title, order_id, asn_id, org_id, raised_by)
  values (p_warehouse, p_kind, 'manual', v_title, o.id, a.id, coalesce(o.org_id, a.org_id), auth.uid())
  returning id, code into v_id, v_code;
  perform write_audit('wh_exception.raised', 'wh_exceptions', v_id::text,
    jsonb_build_object('code', v_code, 'kind', p_kind, 'auto', false, 'order', o.code, 'asn', a.code, 'title', v_title));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;
revoke all on function public.wh_exception_raise(text, text, text, text, text) from public, anon;
grant execute on function public.wh_exception_raise(text, text, text, text, text) to authenticated, service_role;

create or replace function public.wh_exception_assign(p_exception uuid, p_owner uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.wh_exceptions;
  v_owner uuid := coalesce(p_owner, auth.uid());
begin
  select * into e from public.wh_exceptions where id = p_exception for update;
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('resolve_exception', e.warehouse_code) then raise exception 'FORBIDDEN: a supervisor or admin assigns exceptions'; end if;
  if e.status = 'resolved' then raise exception 'ALREADY_RESOLVED: % is resolved', e.code; end if;
  if not public.wh_user_can(v_owner, 'view', e.warehouse_code) then raise exception 'INVALID_OWNER: choose someone who works at %', e.warehouse_code; end if;
  update public.wh_exceptions set status = 'assigned', owner_id = v_owner, assigned_at = now(), updated_at = now() where id = e.id;
  perform write_audit('wh_exception.assigned', 'wh_exceptions', e.id::text, jsonb_build_object('code', e.code, 'owner', v_owner, 'was', e.owner_id));
  return jsonb_build_object('code', e.code, 'owner_name', (select full_name from public.profiles where id = v_owner));
end $$;
revoke all on function public.wh_exception_assign(uuid, uuid) from public, anon;
grant execute on function public.wh_exception_assign(uuid, uuid) to authenticated, service_role;

-- resolution is required; the release goes through the owning flow (and its own permission and two-person rules):
-- retry / ship_short / cancel → wh_resolve_exception (W3a); unlock_override → wh_unlock_override / wh_parcel_unlock_override
-- (warehouse admin); approve_lot → wh_approve_lot (W2a; supervisor who did not count); close → only when nothing is held
create or replace function public.wh_exception_resolve(p_exception uuid, p_action text, p_resolution text, p_qty integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.wh_exceptions;
  v_res text := nullif(btrim(coalesce(p_resolution, '')), '');
  v_actions text[];
  v_status text;
begin
  select * into e from public.wh_exceptions where id = p_exception for update;
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('resolve_exception', e.warehouse_code) then raise exception 'FORBIDDEN: a supervisor or admin resolves exceptions'; end if;
  if e.status = 'resolved' then raise exception 'ALREADY_RESOLVED: % is resolved', e.code; end if;
  if v_res is null or length(v_res) < 3 then raise exception 'RESOLUTION_REQUIRED: write what was found and done'; end if;
  if length(v_res) > 1000 then raise exception 'RESOLUTION_TOO_LONG: up to 1,000 characters'; end if;
  v_actions := public.wh_exception_actions(e);
  if p_action is null or not (p_action = any(v_actions)) then
    raise exception 'INVALID_ACTION: for % choose %', e.code, array_to_string(v_actions, ', ');
  end if;
  perform set_config('octopus.wh_exc_resolution', v_res, true);
  perform set_config('octopus.wh_exc_action', p_action, true);
  if p_action in ('retry', 'ship_short', 'cancel') then
    perform public.wh_resolve_exception(e.order_id, p_action, v_res);
  elsif p_action = 'unlock_override' then
    if e.parcel_id is not null then perform public.wh_parcel_unlock_override(e.parcel_id, v_res);
    else perform public.wh_unlock_override(e.order_id, v_res); end if;
  elsif p_action = 'approve_lot' then
    perform public.wh_approve_lot(e.lot_id, p_qty, v_res);
  end if;
  perform set_config('octopus.wh_exc_resolution', '', true);
  perform set_config('octopus.wh_exc_action', '', true);
  -- 'close' (or a release whose trigger did not cover this row): resolve it here
  update public.wh_exceptions
     set status = 'resolved', resolution = v_res, resolution_action = p_action, resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
   where id = e.id and status <> 'resolved';
  if found then
    perform write_audit('wh_exception.resolved', 'wh_exceptions', e.id::text, jsonb_build_object('code', e.code, 'kind', e.kind, 'action', p_action, 'resolution', v_res));
  end if;
  select status into v_status from public.wh_orders where id = e.order_id;
  return jsonb_build_object('code', e.code, 'status', 'resolved', 'action', p_action, 'order_status', v_status);
end $$;
revoke all on function public.wh_exception_resolve(uuid, text, text, integer) from public, anon;
grant execute on function public.wh_exception_resolve(uuid, text, text, integer) to authenticated, service_role;

create or replace function public.wh_exceptions_board(p_warehouse text default null, p_status text default 'open', p_kind text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'code', e.code, 'warehouse_code', e.warehouse_code, 'kind', e.kind, 'status', e.status, 'source', e.source, 'title', e.title,
               'order', (select jsonb_build_object('id', o.id, 'code', o.code, 'status', o.status, 'owner',
                                  case when o.org_id is null then 'Octopus Dropship' else (select name from public.organizations where id = o.org_id) end)
                           from public.wh_orders o where o.id = e.order_id),
               'parcel_seq', (select seq from public.wh_parcels where id = e.parcel_id),
               'asn', (select code from public.wh_asns where id = e.asn_id),
               'lot', (select jsonb_build_object('code', t.lot_code, 'qty', t.qty, 'status', t.status,
                                'max', (select greatest(l.expected_qty, coalesce(max(c.qty_good), 0)) from public.wh_asn_lines l
                                          left join public.wh_counts c on c.line_id = l.id where l.id = t.asn_line_id group by l.expected_qty))
                         from public.wh_lots t where t.id = e.lot_id),
               'client', (select name from public.organizations where id = e.org_id),
               'owner_id', e.owner_id, 'owner_name', (select full_name from public.profiles where id = e.owner_id),
               'raised_by_name', (select full_name from public.profiles where id = e.raised_by),
               'resolution', e.resolution, 'resolution_action', e.resolution_action,
               'resolved_by_name', (select full_name from public.profiles where id = e.resolved_by), 'resolved_at', e.resolved_at,
               'assigned_at', e.assigned_at, 'created_at', e.created_at,
               'held', public.wh_exception_held(e), 'actions', to_jsonb(public.wh_exception_actions(e)),
               'can_resolve', public.wh_can('resolve_exception', e.warehouse_code),
               'can_unlock', public.wh_role(e.warehouse_code) = 'admin')
             order by (e.status = 'resolved'), e.created_at desc)
        from (select x.id from public.wh_exceptions x
               where (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
                 and (coalesce(p_status, 'open') = 'all' or (coalesce(p_status, 'open') = 'open' and x.status <> 'resolved') or x.status = p_status)
                 and (p_kind is null or x.kind = p_kind)
               order by (x.status = 'resolved'), x.created_at desc limit 300) q
        join public.wh_exceptions e on e.id = q.id), '[]'::jsonb),
    'counts', coalesce((
      select jsonb_object_agg(kind, n) from (
        select x.kind, count(*) n from public.wh_exceptions x
         where x.status <> 'resolved' and (p_warehouse is null or x.warehouse_code = p_warehouse) and public.wh_sees(x.warehouse_code)
         group by x.kind) c), '{}'::jsonb),
    'can_raise', coalesce((select jsonb_agg(w.code order by w.code) from public.warehouses w
                            where w.status in ('active', 'paused') and (p_warehouse is null or w.code = p_warehouse) and public.wh_can('view', w.code)), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.user_id, 'name', coalesce(pr.full_name, pr.email), 'warehouse_code', s.warehouse_code) order by pr.full_name)
        from public.warehouse_staff s join public.profiles pr on pr.id = s.user_id
       where s.suspended_at is null and (p_warehouse is null or s.warehouse_code = p_warehouse) and public.wh_can('resolve_exception', s.warehouse_code)), '[]'::jsonb));
end $$;
revoke all on function public.wh_exceptions_board(text, text, text) from public, anon;
grant execute on function public.wh_exceptions_board(text, text, text) to authenticated, service_role;
