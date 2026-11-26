-- 20261101000229_w2b_putaway_labels_transfers.sql
-- Warehouse OS · W2b (putaway, pallets, bins, inter-warehouse transfers, labels). Design: docs/design/warehouse-os §3 step 6;
-- boards 10 (Putaway and pallets) and 11 (Label centre); approved amendment: several China warehouses → transfers.
--  1. wh_bins: rack-row-bin locations per warehouse (A-01-03); active / blocked (reason) / archived (only when empty).
--  2. wh_pallets (PAL-#####): handling units by source ASN and owner; open → stored (in a bin) → broken (emptied) / shipped (W3+).
--  3. wh_bin_stock: the location sub-ledger (which lot sits in which bin, loose or on a pallet). Putaway and moves change
--     placement only — warehouse_stock.on_hand never changes. A deferred constraint trigger guarantees that the units in bins
--     per warehouse + item never exceed warehouse_stock.on_hand at commit. wh_location_moves keeps the placement history.
--  4. wh_transfers (TRF-####) / lines / picks: Draft → In transit → Received (Cancelled only while Draft). Dispatch posts
--     adjust_out at the origin ('transfer TRF-0001 out') and removes the picked units from bins (FIFO by lot); receive posts
--     adjust_in at the destination ('transfer TRF-0001 in') and creates released, unplaced lots there.
--  5. wh_label_prints: every print and reprint of carton, pallet, bin (and later parcel) labels.
-- record_warehouse_stock_movement() is NOT replaced: the transfer functions post through the internal wh_post_movement(), using the
-- transaction-local octopus.wh_internal flag that W2a added (set only after their own wh_can() check; actor stays auth.uid()).
-- Writes only through wh_* security-definer functions; every change audit-logged. Unknown stays empty, never 0.
-- Down: supabase/migrations/down/20261101000229_w2b_putaway_labels_transfers.down.sql

create sequence if not exists public.seq_wh_pallet;
create sequence if not exists public.seq_wh_transfer;
revoke all on sequence public.seq_wh_pallet from public, anon, authenticated;
revoke all on sequence public.seq_wh_transfer from public, anon, authenticated;
grant all on sequence public.seq_wh_pallet to service_role;
grant all on sequence public.seq_wh_transfer to service_role;

-- ───────── 1. Bins ─────────
create table if not exists public.wh_bins (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  code text not null check (code ~ '^[A-Z]{1,3}[0-9]{0,2}-[0-9]{2}-[0-9]{2}$'),
  zone text check (zone is null or zone ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,29}$'),
  status text not null default 'active' check (status in ('active', 'blocked', 'archived')),
  block_reason text check (block_reason is null or length(block_reason) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_bins_code_per_wh unique (warehouse_code, code),
  constraint wh_bins_block_reason check (status <> 'blocked' or nullif(btrim(coalesce(block_reason, '')), '') is not null)
);
comment on table public.wh_bins is 'Warehouse OS: bin locations (rack-row-bin, e.g. A-01-03) per warehouse. Blocked bins refuse putaway. Staff only; written through wh_* functions.';
alter table public.wh_bins enable row level security;
revoke all on public.wh_bins from public, anon, authenticated;
grant select on public.wh_bins to authenticated;
grant all on public.wh_bins to service_role;
drop policy if exists wh_bins_read on public.wh_bins;
create policy wh_bins_read on public.wh_bins for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 2. Pallets ─────────
create table if not exists public.wh_pallets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('PAL-' || lpad(nextval('public.seq_wh_pallet')::text, 5, '0')),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  asn_id uuid references public.wh_asns(id) on delete set null,
  org_id uuid references public.organizations(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'stored', 'shipped', 'broken')),
  bin_id uuid references public.wh_bins(id) on delete restrict,
  note text check (note is null or length(note) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_pallets_stored_in_bin check ((status = 'stored') = (bin_id is not null))
);
create index if not exists wh_pallets_wh_status_idx on public.wh_pallets (warehouse_code, status);
comment on table public.wh_pallets is 'Warehouse OS: pallets (PAL-#####) by source ASN and owner (org_id NULL = Octopus stock). open → stored (bin) → broken (emptied). Staff only.';
alter table public.wh_pallets enable row level security;
revoke all on public.wh_pallets from public, anon, authenticated;
grant select on public.wh_pallets to authenticated;
grant all on public.wh_pallets to service_role;
drop policy if exists wh_pallets_read on public.wh_pallets;
create policy wh_pallets_read on public.wh_pallets for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 3. Location sub-ledger ─────────
create table if not exists public.wh_bin_stock (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  bin_id uuid not null references public.wh_bins(id) on delete restrict,
  item_id uuid not null references public.item_master(id) on delete restrict,
  lot_id uuid not null references public.wh_lots(id) on delete restrict,
  pallet_id uuid references public.wh_pallets(id) on delete restrict,
  qty integer not null check (qty > 0 and qty <= 10000000),
  updated_at timestamptz not null default now(),
  constraint wh_bin_stock_one unique nulls not distinct (bin_id, lot_id, pallet_id)
);
create index if not exists wh_bin_stock_wh_item_idx on public.wh_bin_stock (warehouse_code, item_id);
create index if not exists wh_bin_stock_lot_idx on public.wh_bin_stock (lot_id);
create index if not exists wh_bin_stock_pallet_idx on public.wh_bin_stock (pallet_id) where pallet_id is not null;
comment on table public.wh_bin_stock is 'Warehouse OS: where units sit (bin, lot, pallet). Placement only — on hand stays in warehouse_stock; the units here never exceed on hand (deferred check). Staff only.';
alter table public.wh_bin_stock enable row level security;
revoke all on public.wh_bin_stock from public, anon, authenticated;
grant select on public.wh_bin_stock to authenticated;
grant all on public.wh_bin_stock to service_role;
drop policy if exists wh_bin_stock_read on public.wh_bin_stock;
create policy wh_bin_stock_read on public.wh_bin_stock for select to authenticated using (public.wh_sees(warehouse_code));

create table if not exists public.wh_location_moves (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  kind text not null check (kind in ('putaway', 'move', 'pallet_move', 'transfer_out')),
  item_id uuid not null references public.item_master(id) on delete restrict,
  lot_id uuid not null references public.wh_lots(id) on delete restrict,
  pallet_id uuid references public.wh_pallets(id) on delete restrict,
  from_bin uuid references public.wh_bins(id) on delete restrict,
  to_bin uuid references public.wh_bins(id) on delete restrict,
  qty integer not null check (qty > 0),
  reason text check (reason is null or length(reason) <= 300),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wh_location_moves_wh_idx on public.wh_location_moves (warehouse_code, created_at desc);
comment on table public.wh_location_moves is 'Warehouse OS: placement history (putaway, bin moves, pallet moves, picks for transfers). Append-only; staff only.';
alter table public.wh_location_moves enable row level security;
revoke all on public.wh_location_moves from public, anon, authenticated;
grant select on public.wh_location_moves to authenticated;
grant all on public.wh_location_moves to service_role;
drop policy if exists wh_location_moves_read on public.wh_location_moves;
create policy wh_location_moves_read on public.wh_location_moves for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 4. Transfers ─────────
create table if not exists public.wh_transfers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('TRF-' || lpad(nextval('public.seq_wh_transfer')::text, 4, '0')),
  from_wh text not null references public.warehouses(code) on update cascade on delete restrict,
  to_wh text not null references public.warehouses(code) on update cascade on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  note text check (note is null or length(note) <= 500),
  cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  dispatched_by uuid references auth.users(id) on delete set null,
  dispatched_at timestamptz,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wh_transfers_two_places check (from_wh <> to_wh)
);
create index if not exists wh_transfers_from_idx on public.wh_transfers (from_wh, status);
create index if not exists wh_transfers_to_idx on public.wh_transfers (to_wh, status);
comment on table public.wh_transfers is 'Warehouse OS: stock moved between warehouses (TRF-####). Draft → In transit → Received; Cancelled only while Draft. Staff only.';
alter table public.wh_transfers enable row level security;
revoke all on public.wh_transfers from public, anon, authenticated;
grant select on public.wh_transfers to authenticated;
grant all on public.wh_transfers to service_role;
drop policy if exists wh_transfers_read on public.wh_transfers;
create policy wh_transfers_read on public.wh_transfers for select to authenticated
  using (public.wh_sees(from_wh) or public.wh_sees(to_wh));

create table if not exists public.wh_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.wh_transfers(id) on delete cascade,
  item_id uuid not null references public.item_master(id) on delete restrict,
  qty integer not null check (qty > 0 and qty <= 1000000),
  dest_lot_id uuid references public.wh_lots(id) on delete restrict,
  constraint wh_transfer_lines_one_item unique (transfer_id, item_id)
);
comment on table public.wh_transfer_lines is 'Warehouse OS: transfer lines; dest_lot_id is the released lot created at the destination on receipt.';
alter table public.wh_transfer_lines enable row level security;
revoke all on public.wh_transfer_lines from public, anon, authenticated;
grant select on public.wh_transfer_lines to authenticated;
grant all on public.wh_transfer_lines to service_role;
drop policy if exists wh_transfer_lines_read on public.wh_transfer_lines;
create policy wh_transfer_lines_read on public.wh_transfer_lines for select to authenticated
  using (exists (select 1 from public.wh_transfers t where t.id = transfer_id));

create table if not exists public.wh_transfer_picks (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.wh_transfer_lines(id) on delete cascade,
  lot_id uuid not null references public.wh_lots(id) on delete restrict,
  bin_id uuid not null references public.wh_bins(id) on delete restrict,
  pallet_id uuid references public.wh_pallets(id) on delete restrict,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now()
);
create index if not exists wh_transfer_picks_line_idx on public.wh_transfer_picks (line_id);
create index if not exists wh_transfer_picks_lot_idx on public.wh_transfer_picks (lot_id);
comment on table public.wh_transfer_picks is 'Warehouse OS: which lot, bin and pallet each dispatched transfer unit came from (FIFO pick at dispatch).';
alter table public.wh_transfer_picks enable row level security;
revoke all on public.wh_transfer_picks from public, anon, authenticated;
grant select on public.wh_transfer_picks to authenticated;
grant all on public.wh_transfer_picks to service_role;
drop policy if exists wh_transfer_picks_read on public.wh_transfer_picks;
create policy wh_transfer_picks_read on public.wh_transfer_picks for select to authenticated
  using (exists (select 1 from public.wh_transfer_lines l where l.id = line_id));

-- ───────── 5. Label prints ─────────
create table if not exists public.wh_label_prints (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references public.warehouses(code) on update cascade on delete restrict,
  kind text not null check (kind in ('carton', 'pallet', 'bin', 'parcel')),
  ref text not null check (ref ~ '^[A-Z0-9][A-Z0-9-]{1,63}$'),
  copies integer not null check (copies between 1 and 100),
  printed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wh_label_prints_ref_idx on public.wh_label_prints (warehouse_code, kind, ref);
comment on table public.wh_label_prints is 'Warehouse OS: every label print and reprint (who, what, how many). Append-only; staff only.';
alter table public.wh_label_prints enable row level security;
revoke all on public.wh_label_prints from public, anon, authenticated;
grant select on public.wh_label_prints to authenticated;
grant all on public.wh_label_prints to service_role;
drop policy if exists wh_label_prints_read on public.wh_label_prints;
create policy wh_label_prints_read on public.wh_label_prints for select to authenticated using (public.wh_sees(warehouse_code));

-- ───────── 6. Placement never exceeds on hand (checked at commit) ─────────
create or replace function public.wh_check_placement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh text;
  v_item uuid;
  v_placed bigint;
  v_on_hand integer;
begin
  if tg_table_name = 'warehouse_stock' then
    v_wh := new.warehouse_id; v_item := new.item_id;
  else
    v_wh := new.warehouse_code; v_item := new.item_id;
  end if;
  select coalesce(sum(qty), 0) into v_placed from public.wh_bin_stock where warehouse_code = v_wh and item_id = v_item;
  if v_placed = 0 then return null; end if;
  select on_hand_qty into v_on_hand from public.warehouse_stock where warehouse_id = v_wh and item_id = v_item;
  if v_placed > coalesce(v_on_hand, 0) then
    raise exception 'PLACEMENT_EXCEEDS_ON_HAND: % unit(s) are in bins at % but only % are on hand; take the difference out of the bins first',
      v_placed, v_wh, coalesce(v_on_hand, 0);
  end if;
  return null;
end $$;
revoke all on function public.wh_check_placement() from public, anon, authenticated;
grant execute on function public.wh_check_placement() to service_role;

drop trigger if exists wh_bin_stock_within_on_hand on public.wh_bin_stock;
create constraint trigger wh_bin_stock_within_on_hand after insert or update on public.wh_bin_stock
  deferrable initially deferred for each row execute function public.wh_check_placement();
drop trigger if exists wh_stock_covers_placement on public.warehouse_stock;
create constraint trigger wh_stock_covers_placement after update on public.warehouse_stock
  deferrable initially deferred for each row execute function public.wh_check_placement();

-- ───────── 7. Internal helpers ─────────
-- posts an adjust_in / adjust_out through the only stock write path (W2a's internal flag); actor stays auth.uid()
create or replace function public.wh_post_movement(p_item uuid, p_kind text, p_qty integer, p_reason text, p_warehouse text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_kind not in ('adjust_in', 'adjust_out') then raise exception 'INVALID_MOVEMENT_KIND: %', p_kind; end if;
  perform set_config('octopus.wh_internal', 'true', true);
  begin
    v := public.record_warehouse_stock_movement(p_item, p_kind, p_qty, p_reason, p_warehouse, null);
  exception when others then
    perform set_config('octopus.wh_internal', '', true);
    raise;
  end;
  perform set_config('octopus.wh_internal', '', true);
  return (v ->> 'movement_id')::uuid;
end $$;
revoke all on function public.wh_post_movement(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.wh_post_movement(uuid, text, integer, text, text) to service_role;

-- units of a released lot not yet in a bin and not sent away on a transfer
create or replace function public.wh_lot_free(p_lot uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select t.qty
         - coalesce((select sum(b.qty) from public.wh_bin_stock b where b.lot_id = t.id), 0)::integer
         - coalesce((select sum(p.qty) from public.wh_transfer_picks p where p.lot_id = t.id), 0)::integer
    from public.wh_lots t where t.id = p_lot
$$;
revoke all on function public.wh_lot_free(uuid) from public, anon, authenticated;
grant execute on function public.wh_lot_free(uuid) to service_role;

-- takes p_qty of one lot (or FIFO over lots when p_lot is NULL) out of a bin: loose units first, then pallets.
-- A pallet left with nothing on it is broken down. Returns [{lot_id, pallet_id, qty}] of what was taken.
create or replace function public.wh_take_from_bin(p_bin uuid, p_item uuid, p_lot uuid, p_qty integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_left integer := p_qty;
  v_take integer;
  v_out jsonb := '[]'::jsonb;
begin
  for r in
    select b.id, b.lot_id, b.pallet_id, b.qty
      from public.wh_bin_stock b join public.wh_lots t on t.id = b.lot_id
     where b.bin_id = p_bin and b.item_id = p_item and (p_lot is null or b.lot_id = p_lot)
     order by (b.pallet_id is not null), t.created_at, t.lot_code, b.id
     for update of b
  loop
    exit when v_left = 0;
    v_take := least(v_left, r.qty);
    if v_take = r.qty then
      delete from public.wh_bin_stock where id = r.id;
    else
      update public.wh_bin_stock set qty = qty - v_take, updated_at = now() where id = r.id;
    end if;
    if r.pallet_id is not null and not exists (select 1 from public.wh_bin_stock where pallet_id = r.pallet_id) then
      update public.wh_pallets set status = 'broken', bin_id = null, updated_at = now() where id = r.pallet_id;
    end if;
    v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'pallet_id', r.pallet_id, 'qty', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'NOT_ENOUGH_IN_BIN: only % unit(s) there', p_qty - v_left; end if;
  return v_out;
end $$;
revoke all on function public.wh_take_from_bin(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.wh_take_from_bin(uuid, uuid, uuid, integer) to service_role;

-- adds units to a bin row (bin, lot, pallet)
create or replace function public.wh_add_to_bin(p_wh text, p_bin uuid, p_item uuid, p_lot uuid, p_pallet uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.wh_bin_stock
   where bin_id = p_bin and lot_id = p_lot and pallet_id is not distinct from p_pallet for update;
  if v_id is null then
    insert into public.wh_bin_stock (warehouse_code, bin_id, item_id, lot_id, pallet_id, qty) values (p_wh, p_bin, p_item, p_lot, p_pallet, p_qty);
  else
    update public.wh_bin_stock set qty = qty + p_qty, updated_at = now() where id = v_id;
  end if;
end $$;
revoke all on function public.wh_add_to_bin(text, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.wh_add_to_bin(text, uuid, uuid, uuid, uuid, integer) to service_role;

-- ───────── 8. Bins ─────────
create or replace function public.wh_create_bin(p_warehouse text, p_code text, p_zone text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_zone text := nullif(btrim(coalesce(p_zone, '')), '');
  v_id uuid;
begin
  if not public.wh_can('putaway', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then
    raise exception 'WAREHOUSE_NOT_OPEN: bins are added only at active or paused warehouses';
  end if;
  if v_code !~ '^[A-Z]{1,3}[0-9]{0,2}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_BIN: use rack-row-bin, e.g. A-01-03'; end if;
  if v_zone is not null and v_zone !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,29}$' then raise exception 'INVALID_ZONE: up to 30 letters, digits, spaces or dashes'; end if;
  if exists (select 1 from public.wh_bins where warehouse_code = p_warehouse and code = v_code) then
    raise exception 'DUPLICATE_BIN: % already exists at %', v_code, p_warehouse;
  end if;
  insert into public.wh_bins (warehouse_code, code, zone, created_by) values (p_warehouse, v_code, v_zone, auth.uid()) returning id into v_id;
  perform write_audit('wh_bin.created', 'wh_bins', v_id::text, jsonb_build_object('warehouse', p_warehouse, 'code', v_code, 'zone', v_zone));
  return v_id;
end $$;
revoke all on function public.wh_create_bin(text, text, text) from public, anon;
grant execute on function public.wh_create_bin(text, text, text) to authenticated, service_role;

-- rack A, rows 1–5, bins 1–10 → A-01-01 … A-05-10 (up to 500 per run; existing bins are skipped)
create or replace function public.wh_create_bin_range(
  p_warehouse text, p_rack text, p_row_from integer, p_row_to integer, p_bin_from integer, p_bin_to integer, p_zone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rack text := upper(btrim(coalesce(p_rack, '')));
  v_zone text := nullif(btrim(coalesce(p_zone, '')), '');
  v_total integer;
  v_created integer;
begin
  if not public.wh_can('putaway', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then
    raise exception 'WAREHOUSE_NOT_OPEN: bins are added only at active or paused warehouses';
  end if;
  if v_rack !~ '^[A-Z]{1,3}[0-9]{0,2}$' then raise exception 'INVALID_RACK: a rack is 1 to 3 letters, optionally with digits, e.g. A or AB2'; end if;
  if p_row_from is null or p_row_to is null or p_bin_from is null or p_bin_to is null
     or p_row_from < 1 or p_row_to > 99 or p_bin_from < 1 or p_bin_to > 99 or p_row_from > p_row_to or p_bin_from > p_bin_to then
    raise exception 'INVALID_RANGE: rows and bins run from 1 to 99, first to last';
  end if;
  if v_zone is not null and v_zone !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,29}$' then raise exception 'INVALID_ZONE: up to 30 letters, digits, spaces or dashes'; end if;
  v_total := (p_row_to - p_row_from + 1) * (p_bin_to - p_bin_from + 1);
  if v_total > 500 then raise exception 'TOO_MANY_BINS: up to 500 bins at a time (this range has %)', v_total; end if;
  with ins as (
    insert into public.wh_bins (warehouse_code, code, zone, created_by)
    select p_warehouse, v_rack || '-' || lpad(r::text, 2, '0') || '-' || lpad(b::text, 2, '0'), v_zone, auth.uid()
      from generate_series(p_row_from, p_row_to) r cross join generate_series(p_bin_from, p_bin_to) b
    on conflict (warehouse_code, code) do nothing
    returning 1)
  select count(*) into v_created from ins;
  perform write_audit('wh_bin.range_created', 'wh_bins', p_warehouse || ':' || v_rack,
    jsonb_build_object('warehouse', p_warehouse, 'rack', v_rack, 'rows', array[p_row_from, p_row_to], 'bins', array[p_bin_from, p_bin_to],
                       'zone', v_zone, 'created', v_created, 'skipped', v_total - v_created));
  return jsonb_build_object('created', v_created, 'skipped', v_total - v_created,
    'first', v_rack || '-' || lpad(p_row_from::text, 2, '0') || '-' || lpad(p_bin_from::text, 2, '0'),
    'last', v_rack || '-' || lpad(p_row_to::text, 2, '0') || '-' || lpad(p_bin_to::text, 2, '0'));
end $$;
revoke all on function public.wh_create_bin_range(text, text, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.wh_create_bin_range(text, text, integer, integer, integer, integer, text) to authenticated, service_role;

create or replace function public.wh_set_bin_status(p_bin uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_bins;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('active', 'blocked', 'archived') then raise exception 'INVALID_STATUS'; end if;
  select * into v from public.wh_bins where id = p_bin for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('putaway', v.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v.status = p_status then return; end if;
  if p_status = 'blocked' and v_reason is null then raise exception 'REASON_REQUIRED: enter why the bin is blocked'; end if;
  if p_status = 'archived' and (exists (select 1 from public.wh_bin_stock where bin_id = p_bin)
                                or exists (select 1 from public.wh_pallets where bin_id = p_bin)) then
    raise exception 'BIN_NOT_EMPTY: move the stock out of % before archiving it', v.code;
  end if;
  update public.wh_bins set status = p_status, block_reason = case when p_status = 'blocked' then v_reason end, updated_at = now()
   where id = p_bin;
  perform write_audit('wh_bin.' || p_status, 'wh_bins', p_bin::text, jsonb_build_object('code', v.code, 'from', v.status, 'reason', v_reason));
end $$;
revoke all on function public.wh_set_bin_status(uuid, text, text) from public, anon;
grant execute on function public.wh_set_bin_status(uuid, text, text) to authenticated, service_role;

-- ───────── 9. Pallets, putaway, moves ─────────
-- a pallet for an ASN (owner = the notice's owner) or without one (p_org = a client company or NULL for Octopus stock)
create or replace function public.wh_create_pallet(p_warehouse text, p_asn uuid default null, p_org uuid default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asn public.wh_asns;
  v_org uuid := p_org;
  v_row public.wh_pallets;
begin
  if not public.wh_can('putaway', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.warehouses where code = p_warehouse and status in ('active', 'paused')) then
    raise exception 'WAREHOUSE_NOT_OPEN: pallets are built only at active or paused warehouses';
  end if;
  if p_asn is not null then
    select * into v_asn from public.wh_asns where id = p_asn;
    if v_asn.id is null then raise exception 'NOT_FOUND: stock notice not found'; end if;
    if v_asn.warehouse_code <> p_warehouse then raise exception 'WRONG_WAREHOUSE: % is for %', v_asn.code, v_asn.warehouse_code; end if;
    if v_asn.status not in ('arrived', 'receiving', 'received') then raise exception 'ASN_NOT_ARRIVED: % has not arrived yet', v_asn.code; end if;
    v_org := v_asn.org_id;
  elsif v_org is not null and not exists (select 1 from public.wh_clients c where c.org_id = v_org) then
    raise exception 'INVALID_CLIENT: choose a 3PL client company or Octopus stock';
  end if;
  if p_note is not null and length(p_note) > 300 then raise exception 'INVALID_NOTE: up to 300 characters'; end if;
  insert into public.wh_pallets (warehouse_code, asn_id, org_id, note, created_by)
  values (p_warehouse, p_asn, v_org, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;
  perform write_audit('wh_pallet.created', 'wh_pallets', v_row.id::text,
    jsonb_build_object('code', v_row.code, 'warehouse', p_warehouse, 'asn', v_asn.code, 'org_id', v_org));
  return jsonb_build_object('id', v_row.id, 'code', v_row.code);
end $$;
revoke all on function public.wh_create_pallet(text, uuid, uuid, text) from public, anon;
grant execute on function public.wh_create_pallet(text, uuid, uuid, text) to authenticated, service_role;

create or replace function public.wh_putaway(p_lot uuid, p_bin uuid, p_qty integer, p_pallet uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.wh_lots;
  v_bin public.wh_bins;
  v_pal public.wh_pallets;
  v_cur text;
  v_free integer;
  v_on_hand integer;
  v_placed bigint;
begin
  select * into v_lot from public.wh_lots where id = p_lot for update;
  if v_lot.id is null then raise exception 'NOT_FOUND: lot not found'; end if;
  if not public.wh_can('putaway', v_lot.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v_lot.status <> 'released' then raise exception 'LOT_BLOCKED: % is blocked until a supervisor approves it', v_lot.lot_code; end if;
  select * into v_bin from public.wh_bins where id = p_bin for update;
  if v_bin.id is null then raise exception 'NOT_FOUND: bin not found'; end if;
  if v_bin.warehouse_code <> v_lot.warehouse_code then raise exception 'WRONG_WAREHOUSE: bin % is at %, lot % is at %', v_bin.code, v_bin.warehouse_code, v_lot.lot_code, v_lot.warehouse_code; end if;
  if v_bin.status = 'blocked' then raise exception 'BIN_BLOCKED: % is blocked (%); choose another bin', v_bin.code, v_bin.block_reason; end if;
  if v_bin.status <> 'active' then raise exception 'BIN_ARCHIVED: % is archived; choose another bin', v_bin.code; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_QTY: enter how many units go into the bin'; end if;
  v_free := public.wh_lot_free(p_lot);
  if p_qty > v_free then raise exception 'NOT_ENOUGH_UNPLACED: % has % unit(s) left to put away', v_lot.lot_code, v_free; end if;
  -- lock the on-hand row so placement and stock changes are serialised
  select on_hand_qty into v_on_hand from public.warehouse_stock where warehouse_id = v_lot.warehouse_code and item_id = v_lot.item_id for update;
  select coalesce(sum(qty), 0) into v_placed from public.wh_bin_stock where warehouse_code = v_lot.warehouse_code and item_id = v_lot.item_id;
  if v_placed + p_qty > coalesce(v_on_hand, 0) then
    raise exception 'PLACEMENT_EXCEEDS_ON_HAND: only % unit(s) are on hand and % already in bins', coalesce(v_on_hand, 0), v_placed;
  end if;
  if p_pallet is not null then
    select * into v_pal from public.wh_pallets where id = p_pallet for update;
    if v_pal.id is null then raise exception 'NOT_FOUND: pallet not found'; end if;
    if v_pal.warehouse_code <> v_lot.warehouse_code then raise exception 'WRONG_WAREHOUSE: % is at %', v_pal.code, v_pal.warehouse_code; end if;
    if v_pal.status not in ('open', 'stored') then raise exception 'PALLET_CLOSED: % is %', v_pal.code, v_pal.status; end if;
    if v_pal.org_id is distinct from v_lot.org_id then raise exception 'PALLET_OWNER_MISMATCH: % holds another owner''s stock', v_pal.code; end if;
    if v_pal.status = 'stored' and v_pal.bin_id <> p_bin then
      select code into v_cur from public.wh_bins where id = v_pal.bin_id;
      raise exception 'PALLET_IN_OTHER_BIN: % is in %; put away to that bin or move the pallet first', v_pal.code, v_cur;
    end if;
    update public.wh_pallets set status = 'stored', bin_id = p_bin, updated_at = now() where id = p_pallet;
  end if;
  perform public.wh_add_to_bin(v_lot.warehouse_code, p_bin, v_lot.item_id, p_lot, p_pallet, p_qty);
  insert into public.wh_location_moves (warehouse_code, kind, item_id, lot_id, pallet_id, to_bin, qty, actor_id)
  values (v_lot.warehouse_code, 'putaway', v_lot.item_id, p_lot, p_pallet, p_bin, p_qty, auth.uid());
  perform write_audit('wh_putaway.recorded', 'wh_lots', p_lot::text,
    jsonb_build_object('lot', v_lot.lot_code, 'bin', v_bin.code, 'pallet', v_pal.code, 'qty', p_qty, 'left', v_free - p_qty));
  return jsonb_build_object('lot', v_lot.lot_code, 'bin', v_bin.code, 'pallet', v_pal.code, 'qty', p_qty, 'left', v_free - p_qty);
end $$;
revoke all on function public.wh_putaway(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.wh_putaway(uuid, uuid, integer, uuid) to authenticated, service_role;

-- move loose units between bins (FIFO over lots when p_lot is NULL; units taken off a pallet arrive loose)
create or replace function public.wh_move_bin_stock(p_from_bin uuid, p_to_bin uuid, p_item uuid, p_lot uuid, p_qty integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.wh_bins;
  v_to public.wh_bins;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_taken jsonb;
  t jsonb;
begin
  if p_from_bin = p_to_bin then raise exception 'SAME_BIN: choose a different bin to move to'; end if;
  -- lock both bins in a fixed order (no deadlock between opposite moves)
  perform 1 from public.wh_bins where id in (p_from_bin, p_to_bin) order by id for update;
  select * into v_from from public.wh_bins where id = p_from_bin;
  select * into v_to from public.wh_bins where id = p_to_bin;
  if v_from.id is null or v_to.id is null then raise exception 'NOT_FOUND: bin not found'; end if;
  if not public.wh_can('putaway', v_from.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v_from.warehouse_code <> v_to.warehouse_code then raise exception 'WRONG_WAREHOUSE: use a transfer to move stock between warehouses'; end if;
  if v_to.status = 'blocked' then raise exception 'BIN_BLOCKED: % is blocked (%); choose another bin', v_to.code, v_to.block_reason; end if;
  if v_to.status <> 'active' then raise exception 'BIN_ARCHIVED: % is archived; choose another bin', v_to.code; end if;
  if p_item is null or p_qty is null or p_qty <= 0 then raise exception 'INVALID_QTY: enter how many units to move'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the stock moves'; end if;
  begin
    v_taken := public.wh_take_from_bin(p_from_bin, p_item, p_lot, p_qty);
  exception when others then
    if sqlerrm like 'NOT_ENOUGH_IN_BIN%' then raise exception 'NOT_ENOUGH_IN_BIN: % holds fewer than % unit(s) of this product%', v_from.code, p_qty,
      case when p_lot is null then '' else ' from this lot' end; end if;
    raise;
  end;
  for t in select * from jsonb_array_elements(v_taken) loop
    perform public.wh_add_to_bin(v_to.warehouse_code, p_to_bin, p_item, (t ->> 'lot_id')::uuid, null, (t ->> 'qty')::integer);
    insert into public.wh_location_moves (warehouse_code, kind, item_id, lot_id, pallet_id, from_bin, to_bin, qty, reason, actor_id)
    values (v_from.warehouse_code, 'move', p_item, (t ->> 'lot_id')::uuid, (t ->> 'pallet_id')::uuid, p_from_bin, p_to_bin, (t ->> 'qty')::integer, v_reason, auth.uid());
  end loop;
  perform write_audit('wh_bin_stock.moved', 'wh_bins', p_from_bin::text,
    jsonb_build_object('from', v_from.code, 'to', v_to.code, 'item_id', p_item, 'lot_id', p_lot, 'qty', p_qty, 'reason', v_reason, 'taken', v_taken));
  return jsonb_build_object('from', v_from.code, 'to', v_to.code, 'qty', p_qty);
end $$;
revoke all on function public.wh_move_bin_stock(uuid, uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.wh_move_bin_stock(uuid, uuid, uuid, uuid, integer, text) to authenticated, service_role;

-- move a whole pallet (everything on it) to another bin
create or replace function public.wh_move_pallet(p_pallet uuid, p_to_bin uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pal public.wh_pallets;
  v_to public.wh_bins;
  v_from_code text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_pal from public.wh_pallets where id = p_pallet for update;
  if v_pal.id is null then raise exception 'NOT_FOUND: pallet not found'; end if;
  if not public.wh_can('putaway', v_pal.warehouse_code) then raise exception 'FORBIDDEN'; end if;
  if v_pal.status <> 'stored' then raise exception 'PALLET_NOT_STORED: % is not in a bin', v_pal.code; end if;
  select * into v_to from public.wh_bins where id = p_to_bin for update;
  if v_to.id is null then raise exception 'NOT_FOUND: bin not found'; end if;
  if v_to.warehouse_code <> v_pal.warehouse_code then raise exception 'WRONG_WAREHOUSE: use a transfer to move stock between warehouses'; end if;
  if v_to.id = v_pal.bin_id then raise exception 'SAME_BIN: the pallet is already there'; end if;
  if v_to.status = 'blocked' then raise exception 'BIN_BLOCKED: % is blocked (%); choose another bin', v_to.code, v_to.block_reason; end if;
  if v_to.status <> 'active' then raise exception 'BIN_ARCHIVED: % is archived; choose another bin', v_to.code; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the pallet moves'; end if;
  select code into v_from_code from public.wh_bins where id = v_pal.bin_id;
  insert into public.wh_location_moves (warehouse_code, kind, item_id, lot_id, pallet_id, from_bin, to_bin, qty, reason, actor_id)
  select v_pal.warehouse_code, 'pallet_move', b.item_id, b.lot_id, p_pallet, v_pal.bin_id, p_to_bin, b.qty, v_reason, auth.uid()
    from public.wh_bin_stock b where b.pallet_id = p_pallet;
  update public.wh_bin_stock set bin_id = p_to_bin, updated_at = now() where pallet_id = p_pallet;
  update public.wh_pallets set bin_id = p_to_bin, updated_at = now() where id = p_pallet;
  perform write_audit('wh_pallet.moved', 'wh_pallets', p_pallet::text, jsonb_build_object('code', v_pal.code, 'from', v_from_code, 'to', v_to.code, 'reason', v_reason));
  return jsonb_build_object('pallet', v_pal.code, 'from', v_from_code, 'to', v_to.code);
end $$;
revoke all on function public.wh_move_pallet(uuid, uuid, text) from public, anon;
grant execute on function public.wh_move_pallet(uuid, uuid, text) to authenticated, service_role;

-- ───────── 10. Transfers ─────────
-- staff who can put away at the origin create a draft: lines [{item_id, qty}], each within what is available there now
create or replace function public.wh_create_transfer(p_from text, p_to text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_items uuid[] := '{}';
  v_qtys integer[] := '{}';
  v_item uuid;
  v_qty text;
  v_avail integer;
  v_row public.wh_transfers;
begin
  if p_from is null or p_to is null or p_from = p_to then raise exception 'SAME_WAREHOUSE: choose two different warehouses'; end if;
  if not public.wh_can('putaway', p_from) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.warehouses where code = p_from and status = 'active') then raise exception 'WAREHOUSE_NOT_ACTIVE: % is not an active warehouse', p_from; end if;
  if not exists (select 1 from public.warehouses where code = p_to and status = 'active') then raise exception 'WAREHOUSE_NOT_ACTIVE: % is not an active warehouse', p_to; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'INVALID_NOTE: up to 500 characters'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'NO_LINES: add at least one product'; end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'TOO_MANY_LINES: up to 200 products per transfer'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := v_line ->> 'qty';
    if v_qty is null or v_qty !~ '^[0-9]{1,7}$' or v_qty::integer <= 0 then raise exception 'INVALID_QTY: every line needs a quantity above 0'; end if;
    select i.id into v_item from public.item_master i where i.id::text = (v_line ->> 'item_id');
    if v_item is null then raise exception 'UNKNOWN_ITEM: a line uses an unknown product'; end if;
    if v_item = any(v_items) then raise exception 'DUPLICATE_LINE: each product goes on one line'; end if;
    select on_hand_qty - reserved_qty into v_avail from public.warehouse_stock where warehouse_id = p_from and item_id = v_item;
    if coalesce(v_avail, 0) < v_qty::integer then
      raise exception 'INSUFFICIENT_AVAILABLE_STOCK: % has % unit(s) of % available', p_from, coalesce(v_avail, 0),
        coalesce(public.wh_item_label(v_item) ->> 'sku', public.wh_item_label(v_item) ->> 'name', 'this product');
    end if;
    v_items := v_items || v_item;
    v_qtys := v_qtys || v_qty::integer;
    v_item := null;
  end loop;
  insert into public.wh_transfers (from_wh, to_wh, note, created_by) values (p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;
  insert into public.wh_transfer_lines (transfer_id, item_id, qty) select v_row.id, u.item, u.qty from unnest(v_items, v_qtys) as u(item, qty);
  perform write_audit('wh_transfer.created', 'wh_transfers', v_row.id::text,
    jsonb_build_object('code', v_row.code, 'from', p_from, 'to', p_to, 'lines', cardinality(v_items), 'units', (select sum(q) from unnest(v_qtys) q)));
  return jsonb_build_object('id', v_row.id, 'code', v_row.code);
end $$;
revoke all on function public.wh_create_transfer(text, text, jsonb, text) from public, anon;
grant execute on function public.wh_create_transfer(text, text, jsonb, text) to authenticated, service_role;

create or replace function public.wh_cancel_transfer(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_transfers;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from public.wh_transfers where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('putaway', v.from_wh) then raise exception 'FORBIDDEN'; end if;
  if v.status <> 'draft' then raise exception 'TRANSFER_LOCKED: a transfer can be cancelled only while it is a draft'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: enter why the transfer is cancelled'; end if;
  update public.wh_transfers set status = 'cancelled', cancel_reason = v_reason, cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now()
   where id = p_id;
  perform write_audit('wh_transfer.cancelled', 'wh_transfers', p_id::text, jsonb_build_object('code', v.code, 'reason', v_reason));
end $$;
revoke all on function public.wh_cancel_transfer(uuid, text) from public, anon;
grant execute on function public.wh_cancel_transfer(uuid, text) to authenticated, service_role;

-- dispatch: adjust_out at the origin (never below available) and FIFO pick of the units out of the origin's bins
create or replace function public.wh_dispatch_transfer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_transfers;
  l public.wh_transfer_lines;
  r record;
  v_left integer;
  v_take integer;
  v_placed bigint;
  v_label text;
  v_picks jsonb := '[]'::jsonb;
begin
  select * into v from public.wh_transfers where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('putaway', v.from_wh) then raise exception 'FORBIDDEN'; end if;
  if v.status <> 'draft' then raise exception 'INVALID_STEP: only a draft transfer can be dispatched'; end if;
  if not exists (select 1 from public.warehouses where code = v.from_wh and status = 'active') then raise exception 'WAREHOUSE_NOT_ACTIVE: % is not an active warehouse', v.from_wh; end if;
  if not exists (select 1 from public.warehouses where code = v.to_wh and status = 'active') then raise exception 'WAREHOUSE_NOT_ACTIVE: % is not an active warehouse', v.to_wh; end if;
  for l in select * from public.wh_transfer_lines where transfer_id = p_id order by item_id loop
    v_label := coalesce(public.wh_item_label(l.item_id) ->> 'sku', public.wh_item_label(l.item_id) ->> 'name', 'this product');
    -- the stock function locks the on-hand row and refuses more than available (on hand − reserved)
    perform public.wh_post_movement(l.item_id, 'adjust_out', l.qty, 'transfer ' || v.code || ' out', v.from_wh);
    select coalesce(sum(qty), 0) into v_placed from public.wh_bin_stock where warehouse_code = v.from_wh and item_id = l.item_id;
    if v_placed < l.qty then
      raise exception 'NOT_PLACED: only % unit(s) of % are in bins at %; put the rest away first', v_placed, v_label, v.from_wh;
    end if;
    v_left := l.qty;
    for r in
      select b.id, b.bin_id, b.lot_id, b.pallet_id, b.qty
        from public.wh_bin_stock b join public.wh_lots t on t.id = b.lot_id join public.wh_bins n on n.id = b.bin_id
       where b.warehouse_code = v.from_wh and b.item_id = l.item_id
       order by t.created_at, t.lot_code, (b.pallet_id is not null), n.code, b.id
       for update of b
    loop
      exit when v_left = 0;
      v_take := least(v_left, r.qty);
      if v_take = r.qty then delete from public.wh_bin_stock where id = r.id;
      else update public.wh_bin_stock set qty = qty - v_take, updated_at = now() where id = r.id; end if;
      if r.pallet_id is not null and not exists (select 1 from public.wh_bin_stock where pallet_id = r.pallet_id) then
        update public.wh_pallets set status = 'broken', bin_id = null, updated_at = now() where id = r.pallet_id;
      end if;
      insert into public.wh_transfer_picks (line_id, lot_id, bin_id, pallet_id, qty) values (l.id, r.lot_id, r.bin_id, r.pallet_id, v_take);
      insert into public.wh_location_moves (warehouse_code, kind, item_id, lot_id, pallet_id, from_bin, qty, reason, actor_id)
      values (v.from_wh, 'transfer_out', l.item_id, r.lot_id, r.pallet_id, r.bin_id, v_take, 'transfer ' || v.code, auth.uid());
      v_picks := v_picks || jsonb_build_object('item_id', l.item_id, 'lot_id', r.lot_id, 'bin_id', r.bin_id, 'pallet_id', r.pallet_id, 'qty', v_take);
      v_left := v_left - v_take;
    end loop;
  end loop;
  update public.wh_transfers set status = 'in_transit', dispatched_by = auth.uid(), dispatched_at = now(), updated_at = now() where id = p_id;
  perform write_audit('wh_transfer.dispatched', 'wh_transfers', p_id::text,
    jsonb_build_object('code', v.code, 'from', v.from_wh, 'to', v.to_wh, 'picks', v_picks));
  return jsonb_build_object('code', v.code, 'picks', jsonb_array_length(v_picks));
end $$;
revoke all on function public.wh_dispatch_transfer(uuid) from public, anon;
grant execute on function public.wh_dispatch_transfer(uuid) to authenticated, service_role;

-- receive: adjust_in at the destination; one released, unplaced lot per line (owner = the picked lots' owner)
create or replace function public.wh_receive_transfer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.wh_transfers;
  l public.wh_transfer_lines;
  v_org uuid;
  v_lot public.wh_lots;
  v_lots text[] := '{}';
begin
  select * into v from public.wh_transfers where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.wh_can('receive', v.to_wh) then raise exception 'FORBIDDEN: only receiving staff at % receive this transfer', v.to_wh; end if;
  if v.status <> 'in_transit' then raise exception 'INVALID_STEP: only a transfer in transit can be received'; end if;
  if not exists (select 1 from public.warehouses where code = v.to_wh and status in ('active', 'paused')) then raise exception 'WAREHOUSE_NOT_OPEN: % is not open', v.to_wh; end if;
  for l in select * from public.wh_transfer_lines where transfer_id = p_id order by item_id for update loop
    select t.org_id into v_org from public.wh_transfer_picks p join public.wh_lots t on t.id = p.lot_id where p.line_id = l.id limit 1;
    insert into public.wh_lots (warehouse_code, item_id, org_id, qty, status, created_by)
    values (v.to_wh, l.item_id, v_org, l.qty, 'released', auth.uid())
    returning * into v_lot;
    update public.wh_transfer_lines set dest_lot_id = v_lot.id where id = l.id;
    perform public.wh_post_movement(l.item_id, 'adjust_in', l.qty, 'transfer ' || v.code || ' in · ' || v_lot.lot_code, v.to_wh);
    v_lots := v_lots || v_lot.lot_code;
    v_org := null;
  end loop;
  update public.wh_transfers set status = 'received', received_by = auth.uid(), received_at = now(), updated_at = now() where id = p_id;
  perform write_audit('wh_transfer.received', 'wh_transfers', p_id::text, jsonb_build_object('code', v.code, 'to', v.to_wh, 'lots', v_lots));
  return jsonb_build_object('code', v.code, 'lots', to_jsonb(v_lots));
end $$;
revoke all on function public.wh_receive_transfer(uuid) from public, anon;
grant execute on function public.wh_receive_transfer(uuid) to authenticated, service_role;

-- ───────── 11. Label prints ─────────
create or replace function public.wh_log_label_print(p_warehouse text, p_kind text, p_refs text[], p_copies integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refs text[];
  v_bad text;
  v_reprint boolean;
begin
  if not public.wh_can('view', p_warehouse) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('carton', 'pallet', 'bin', 'parcel') then raise exception 'INVALID_KIND'; end if;
  if p_copies is null or p_copies < 1 or p_copies > 100 then raise exception 'INVALID_COPIES: 1 to 100 copies'; end if;
  select array_agg(distinct upper(btrim(x))) into v_refs from unnest(coalesce(p_refs, '{}')) x where nullif(btrim(x), '') is not null;
  if v_refs is null then raise exception 'NO_LABELS: choose at least one label'; end if;
  if cardinality(v_refs) > 500 then raise exception 'TOO_MANY_LABELS: up to 500 labels at a time'; end if;
  select x into v_bad from unnest(v_refs) x where x !~ '^[A-Z0-9][A-Z0-9-]{1,63}$' limit 1;
  if v_bad is not null then raise exception 'INVALID_LABEL: % is not a label reference', v_bad; end if;
  v_reprint := exists (select 1 from public.wh_label_prints where warehouse_code = p_warehouse and kind = p_kind and ref = any(v_refs));
  insert into public.wh_label_prints (warehouse_code, kind, ref, copies, printed_by)
  select p_warehouse, p_kind, x, p_copies, auth.uid() from unnest(v_refs) x;
  perform write_audit(case when v_reprint then 'wh_label.reprinted' else 'wh_label.printed' end, 'wh_label_prints', p_warehouse || ':' || p_kind,
    jsonb_build_object('warehouse', p_warehouse, 'kind', p_kind, 'refs', to_jsonb(v_refs), 'copies', p_copies));
  return cardinality(v_refs);
end $$;
revoke all on function public.wh_log_label_print(text, text, text[], integer) from public, anon;
grant execute on function public.wh_log_label_print(text, text, text[], integer) to authenticated, service_role;

-- ───────── 12. Staff reads (only warehouses the caller sees) ─────────
-- board 10: unplaced released lots (by source and owner), pallets, bin occupancy and contents, recent moves
create or replace function public.wh_putaway_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'can_putaway', coalesce((select jsonb_agg(w.code order by w.code) from public.warehouses w
                              where (p_warehouse is null or w.code = p_warehouse) and public.wh_can('putaway', w.code)), '[]'::jsonb),
    'unplaced', coalesce((
      select jsonb_agg(x order by x ->> 'created_at') from (
        select jsonb_build_object(
                 'lot_id', t.id, 'lot_code', t.lot_code, 'warehouse_code', t.warehouse_code, 'item_id', t.item_id, 'item', public.wh_item_label(t.item_id),
                 'qty', t.qty, 'free', public.wh_lot_free(t.id), 'org_id', t.org_id,
                 'owner', case when t.org_id is null then 'Octopus stock' else o.name end,
                 'source', case when a.id is not null then a.source when tl.id is not null then 'transfer' end,
                 'source_ref', coalesce(a.code, tr.code), 'asn_id', a.id, 'created_at', t.created_at) x
          from public.wh_lots t
          left join public.organizations o on o.id = t.org_id
          left join public.wh_asn_lines al on al.id = t.asn_line_id
          left join public.wh_asns a on a.id = al.asn_id
          left join public.wh_transfer_lines tl on tl.dest_lot_id = t.id
          left join public.wh_transfers tr on tr.id = tl.transfer_id
         where t.status = 'released' and (p_warehouse is null or t.warehouse_code = p_warehouse) and public.wh_sees(t.warehouse_code)
           and public.wh_lot_free(t.id) > 0
         order by t.created_at limit 300) q), '[]'::jsonb),
    'pallets', coalesce((
      select jsonb_agg(x order by x ->> 'code' desc) from (
        select jsonb_build_object(
                 'id', p.id, 'code', p.code, 'warehouse_code', p.warehouse_code, 'status', p.status, 'org_id', p.org_id,
                 'owner', case when p.org_id is null then 'Octopus stock' else o.name end,
                 'asn_code', a.code, 'asn_source', a.source, 'bin_id', p.bin_id, 'bin_code', n.code, 'note', p.note,
                 'units', (select sum(b.qty) from public.wh_bin_stock b where b.pallet_id = p.id),
                 'lots', (select count(distinct b.lot_id) from public.wh_bin_stock b where b.pallet_id = p.id), 'created_at', p.created_at) x
          from public.wh_pallets p
          left join public.organizations o on o.id = p.org_id
          left join public.wh_asns a on a.id = p.asn_id
          left join public.wh_bins n on n.id = p.bin_id
         where p.status in ('open', 'stored') and (p_warehouse is null or p.warehouse_code = p_warehouse) and public.wh_sees(p.warehouse_code)
         order by p.code desc limit 300) q), '[]'::jsonb),
    'bins', coalesce((
      select jsonb_agg(x order by x ->> 'warehouse_code', x ->> 'code') from (
        select jsonb_build_object(
                 'id', n.id, 'code', n.code, 'warehouse_code', n.warehouse_code, 'zone', n.zone, 'status', n.status, 'block_reason', n.block_reason,
                 'units', (select sum(b.qty) from public.wh_bin_stock b where b.bin_id = n.id),
                 'items', (select count(distinct b.item_id) from public.wh_bin_stock b where b.bin_id = n.id),
                 'pallets', (select count(*) from public.wh_pallets p where p.bin_id = n.id)) x
          from public.wh_bins n
         where n.status <> 'archived' and (p_warehouse is null or n.warehouse_code = p_warehouse) and public.wh_sees(n.warehouse_code)
         order by n.warehouse_code, n.code limit 2000) q), '[]'::jsonb),
    'contents', coalesce((
      select jsonb_agg(x order by x ->> 'bin_code', x ->> 'lot_code') from (
        select jsonb_build_object(
                 'bin_id', b.bin_id, 'bin_code', n.code, 'warehouse_code', b.warehouse_code, 'item_id', b.item_id, 'item', public.wh_item_label(b.item_id),
                 'lot_id', b.lot_id, 'lot_code', t.lot_code, 'pallet_code', p.code, 'qty', b.qty) x
          from public.wh_bin_stock b
          join public.wh_bins n on n.id = b.bin_id
          join public.wh_lots t on t.id = b.lot_id
          left join public.wh_pallets p on p.id = b.pallet_id
         where (p_warehouse is null or b.warehouse_code = p_warehouse) and public.wh_sees(b.warehouse_code)
         order by n.code, t.lot_code limit 2000) q), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x order by x ->> 'created_at' desc) from (
        select jsonb_build_object(
                 'id', m.id, 'kind', m.kind, 'warehouse_code', m.warehouse_code, 'qty', m.qty, 'reason', m.reason, 'created_at', m.created_at,
                 'lot_code', t.lot_code, 'pallet_code', p.code, 'from_bin', f.code, 'to_bin', tb.code, 'item', public.wh_item_label(m.item_id),
                 'by_name', pr.full_name) x
          from public.wh_location_moves m
          join public.wh_lots t on t.id = m.lot_id
          left join public.wh_pallets p on p.id = m.pallet_id
          left join public.wh_bins f on f.id = m.from_bin
          left join public.wh_bins tb on tb.id = m.to_bin
          left join public.profiles pr on pr.id = m.actor_id
         where (p_warehouse is null or m.warehouse_code = p_warehouse) and public.wh_sees(m.warehouse_code)
         order by m.created_at desc limit 30) q), '[]'::jsonb),
    'asns', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'warehouse_code', a.warehouse_code,
               'owner', case when a.org_id is null then 'Octopus stock' else o.name end) order by a.code desc)
        from public.wh_asns a left join public.organizations o on o.id = a.org_id
       where a.status in ('arrived', 'receiving', 'received') and a.created_at > now() - interval '120 days'
         and (p_warehouse is null or a.warehouse_code = p_warehouse) and public.wh_sees(a.warehouse_code)), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', c.org_id, 'name', o.name) order by o.name)
        from public.wh_clients c join public.organizations o on o.id = c.org_id where c.status = 'active'), '[]'::jsonb));
end $$;
revoke all on function public.wh_putaway_board(text) from public, anon;
grant execute on function public.wh_putaway_board(text) to authenticated, service_role;

-- transfers in or out of the chosen warehouse (or all the caller sees), with lines, picks and lots; stock available to send
create or replace function public.wh_transfers_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'transfers', coalesce((
      select jsonb_agg(x order by x ->> 'created_at' desc) from (
        select jsonb_build_object(
                 'id', t.id, 'code', t.code, 'from_wh', t.from_wh, 'to_wh', t.to_wh, 'status', t.status, 'note', t.note, 'cancel_reason', t.cancel_reason,
                 'created_at', t.created_at, 'dispatched_at', t.dispatched_at, 'received_at', t.received_at, 'cancelled_at', t.cancelled_at,
                 'created_by_name', (select full_name from public.profiles where id = t.created_by),
                 'dispatched_by_name', (select full_name from public.profiles where id = t.dispatched_by),
                 'received_by_name', (select full_name from public.profiles where id = t.received_by),
                 'can_dispatch', public.wh_can('putaway', t.from_wh), 'can_receive', public.wh_can('receive', t.to_wh),
                 'lines', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', l.id, 'item_id', l.item_id, 'item', public.wh_item_label(l.item_id), 'qty', l.qty,
                            'dest_lot', (select lot_code from public.wh_lots where id = l.dest_lot_id),
                            'picks', coalesce((select jsonb_agg(jsonb_build_object('lot_code', z.lot_code, 'bin_code', n.code, 'pallet_code', p.code, 'qty', k.qty)
                                                                order by z.lot_code, n.code)
                                                 from public.wh_transfer_picks k join public.wh_lots z on z.id = k.lot_id join public.wh_bins n on n.id = k.bin_id
                                                 left join public.wh_pallets p on p.id = k.pallet_id where k.line_id = l.id), '[]'::jsonb))
                          order by l.id)
                     from public.wh_transfer_lines l where l.transfer_id = t.id), '[]'::jsonb)) x
          from public.wh_transfers t
         where (p_warehouse is null or t.from_wh = p_warehouse or t.to_wh = p_warehouse)
           and (public.wh_sees(t.from_wh) or public.wh_sees(t.to_wh))
         order by t.created_at desc limit 200) q), '[]'::jsonb),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object('warehouse_code', s.warehouse_id, 'item_id', s.item_id, 'item', public.wh_item_label(s.item_id),
               'available', s.on_hand_qty - s.reserved_qty,
               'placed', (select coalesce(sum(b.qty), 0) from public.wh_bin_stock b where b.warehouse_code = s.warehouse_id and b.item_id = s.item_id))
             order by s.warehouse_id, s.item_id)
        from public.warehouse_stock s join public.warehouses w on w.code = s.warehouse_id
       where w.status = 'active' and s.on_hand_qty - s.reserved_qty > 0
         and (p_warehouse is null or s.warehouse_id = p_warehouse) and public.wh_can('putaway', s.warehouse_id)), '[]'::jsonb),
    'warehouses', coalesce((
      select jsonb_agg(jsonb_build_object('code', w.code, 'name', w.name, 'can_send', public.wh_can('putaway', w.code)) order by w.is_default desc, w.name)
        from public.warehouses w where w.status = 'active'), '[]'::jsonb));
end $$;
revoke all on function public.wh_transfers_board(text) from public, anon;
grant execute on function public.wh_transfers_board(text) to authenticated, service_role;

-- board 11: what can be labelled (bins, pallets, recent stock notices with their lines) and the print log
create or replace function public.wh_label_board(p_warehouse text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.uid() is not null and is_staff() and not distributor_restricted()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'can_print', coalesce((select jsonb_agg(w.code order by w.code) from public.warehouses w
                            where (p_warehouse is null or w.code = p_warehouse) and public.wh_can('view', w.code)), '[]'::jsonb),
    'bins', coalesce((
      select jsonb_agg(jsonb_build_object('code', n.code, 'warehouse_code', n.warehouse_code, 'zone', n.zone, 'status', n.status,
               'printed', (select count(*) from public.wh_label_prints l where l.warehouse_code = n.warehouse_code and l.kind = 'bin' and l.ref = n.code))
             order by n.warehouse_code, n.code)
        from public.wh_bins n
       where n.status <> 'archived' and (p_warehouse is null or n.warehouse_code = p_warehouse) and public.wh_sees(n.warehouse_code)), '[]'::jsonb),
    'pallets', coalesce((
      select jsonb_agg(x order by x ->> 'code' desc) from (
        select jsonb_build_object('code', p.code, 'warehouse_code', p.warehouse_code, 'status', p.status,
                 'owner', case when p.org_id is null then 'Octopus stock' else o.name end, 'asn_code', a.code, 'bin_code', n.code,
                 'units', (select sum(b.qty) from public.wh_bin_stock b where b.pallet_id = p.id), 'created_at', p.created_at,
                 'printed', (select count(*) from public.wh_label_prints l where l.warehouse_code = p.warehouse_code and l.kind = 'pallet' and l.ref = p.code)) x
          from public.wh_pallets p
          left join public.organizations o on o.id = p.org_id
          left join public.wh_asns a on a.id = p.asn_id
          left join public.wh_bins n on n.id = p.bin_id
         where p.status in ('open', 'stored') and (p_warehouse is null or p.warehouse_code = p_warehouse) and public.wh_sees(p.warehouse_code)
         order by p.code desc limit 300) q), '[]'::jsonb),
    'asns', coalesce((
      select jsonb_agg(x order by x ->> 'code' desc) from (
        select jsonb_build_object('code', a.code, 'warehouse_code', a.warehouse_code, 'status', a.status, 'cartons', a.cartons,
                 'owner', case when a.org_id is null then 'Octopus stock' else o.name end,
                 'lines', coalesce((select jsonb_agg(jsonb_build_object('n', s.n, 'item', public.wh_item_label(s.item_id), 'qty', s.expected_qty,
                                       'lot_code', (select lot_code from public.wh_lots z where z.asn_line_id = s.id),
                                       'printed', (select count(*) from public.wh_label_prints l where l.warehouse_code = a.warehouse_code and l.kind = 'carton'
                                                     and l.ref = a.code || '-' || lpad(s.n::text, 2, '0'))) order by s.n)
                                      from (select l.*, row_number() over (order by l.id) n from public.wh_asn_lines l where l.asn_id = a.id) s), '[]'::jsonb)) x
          from public.wh_asns a left join public.organizations o on o.id = a.org_id
         where a.status <> 'cancelled' and (p_warehouse is null or a.warehouse_code = p_warehouse) and public.wh_sees(a.warehouse_code)
         order by a.created_at desc limit 50) q), '[]'::jsonb),
    'prints', coalesce((
      select jsonb_agg(x order by x ->> 'created_at' desc) from (
        select jsonb_build_object('id', l.id, 'warehouse_code', l.warehouse_code, 'kind', l.kind, 'ref', l.ref, 'copies', l.copies,
                 'created_at', l.created_at, 'by_name', pr.full_name) x
          from public.wh_label_prints l left join public.profiles pr on pr.id = l.printed_by
         where (p_warehouse is null or l.warehouse_code = p_warehouse) and public.wh_sees(l.warehouse_code)
         order by l.created_at desc limit 50) q), '[]'::jsonb));
end $$;
revoke all on function public.wh_label_board(text) from public, anon;
grant execute on function public.wh_label_board(text) to authenticated, service_role;
