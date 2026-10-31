-- SPEC §18 — Group buying (MOQ pools). Octopus stays merchant of record.
-- Ledger: deposits sit in a liability account `escrow:pools[:CUR]` until the pool fills (applied to each buyer's PI) or
-- they are refunded to the buyer's wallet (expiry / withdrawal / cancel). Defaulted deposits are forfeited to revenue
-- stream `pool_forfeit`, which covers the shortfall.

-- ───────────────────────── Settings, columns, terms ─────────────────────────
insert into site_settings(key, value, description, is_public) values
  ('pool_enabled', 'true', 'Group buying (MOQ pools) on/off', true),
  ('pool_deposit_pct', '10', 'Pool deposit % of pledge value (held in escrow)', true),
  ('pool_min_pledge_default', '100', 'Default minimum pledge (units)', true),
  ('pool_max_buyers', '25', 'Maximum buyers per pool', true),
  ('pool_min_days', '3', 'Shortest pool deadline (days)', true),
  ('pool_max_days', '30', 'Longest pool deadline (days)', true),
  ('pool_default_days', '7', 'Default pool deadline (days)', true),
  ('pool_balance_hours', '48', 'Hours to pay the balance after a pool fills', true)
on conflict (key) do nothing;

alter table products add column if not exists pool_minimum_pledge int check (pool_minimum_pledge is null or pool_minimum_pledge > 0);
create sequence if not exists seq_buyer_code start 1001;
alter table organizations add column if not exists buyer_code text unique default ('BUYER-' || lpad(nextval('seq_buyer_code')::text, 4, '0'));
update organizations set buyer_code = 'BUYER-' || lpad(nextval('seq_buyer_code')::text, 4, '0') where buyer_code is null;

alter table terms_versions add column if not exists kind text not null default 'general' check (kind in ('general','group_buy'));
insert into terms_versions(version, status, published_at, kind, sections)
select 'GB-1.0', 'published', now(), 'group_buy', jsonb_agg(jsonb_build_object('no', n, 'title', t,
         'body', '[Draft — paste the reviewed Group Buy clause for "' || t || '" in Admin › Site content › Terms.]') order by n)
from (values (1,'Pools and pledges'),(2,'Deposit and escrow'),(3,'Pool price and tiers'),(4,'Filling, deadline and expiry'),
             (5,'Withdrawal before fill'),(6,'Balance payment and default'),(7,'Shipping, QC and claims per buyer'),(8,'Anonymity')) s(n,t)
where not exists (select 1 from terms_versions where kind = 'group_buy');

-- ───────────────────────── Tables ─────────────────────────
create type pool_status as enum ('open','locked','confirmed','shipped','completed','expired','cancelled');
create type pledge_status as enum ('pending','paid','confirmed','shipped','delivered','withdrawn','defaulted');
create sequence if not exists seq_pool start 1;

create table pools (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('POOL-' || lpad(nextval('seq_pool')::text, 4, '0')),
  product_id uuid not null references products(id),
  supplier_id uuid not null references suppliers(id),
  starter_user_id uuid references auth.users(id),
  starter_org_id uuid references organizations(id),
  target_qty int not null check (target_qty > 0),
  filled_qty int not null default 0,
  min_pledge int not null check (min_pledge > 0),
  max_buyers int not null default 25,
  deadline_at timestamptz not null,
  status pool_status not null default 'open',
  pool_price_minor bigint,                 -- unit price at current filled qty (pool currency)
  final_price_minor bigint,                -- unit price locked at fill
  currency char(3) not null check (currency in ('USD','CNY')),
  fx_rate_id uuid references fx_rates(id),
  deposit_pct int not null default 10,
  qc_included boolean not null default true,
  terms_version_id uuid references terms_versions(id),
  po_document_id uuid,
  filled_at timestamptz,
  balance_due_at timestamptz,
  settled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_pools_updated before update on pools for each row execute function set_updated_at();
create index on pools(status, deadline_at);
create index on pools(product_id);

create table pool_pledges (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools(id) on delete cascade,
  org_id uuid not null references organizations(id),
  buyer_user_id uuid references auth.users(id),
  qty int not null check (qty > 0),
  deposit_minor bigint not null default 0,
  balance_minor bigint,
  currency char(3) not null,
  address_id uuid references addresses(id),
  pay_source text not null default 'wallet' check (pay_source in ('wallet','card')),
  status pledge_status not null default 'pending',
  terms_version_id uuid references terms_versions(id),
  order_id uuid references orders(id),
  reminders_sent int not null default 0,
  joined_at timestamptz not null default now(),
  paid_at timestamptz,
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  defaulted_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger trg_pledges_updated before update on pool_pledges for each row execute function set_updated_at();
create index on pool_pledges(pool_id);
create index on pool_pledges(org_id);
create unique index pool_one_active_pledge_per_org on pool_pledges(pool_id, org_id) where status in ('pending','paid','confirmed','shipped','delivered');

create table pool_events (
  id bigserial primary key,
  pool_id uuid not null references pools(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  qty int,
  created_at timestamptz not null default now()
);
create index on pool_events(pool_id, created_at desc);

alter table proforma_invoices add column if not exists pool_id uuid references pools(id);
alter table orders add column if not exists pool_id uuid references pools(id);
alter table orders add column if not exists pool_pledge_id uuid references pool_pledges(id);

alter table pools enable row level security;
alter table pool_pledges enable row level security;
alter table pool_events enable row level security;
-- pools are public listings (supplier shown only as code via public_suppliers in the UI)
create policy pools_public on pools for select using (status in ('open','locked','confirmed','shipped','completed') or can('orders','view') or starter_org_id in (select my_org_ids()));
create policy pledges_own on pool_pledges for select to authenticated using (org_id in (select my_org_ids()) or can('orders','view'));
create policy pool_events_public on pool_events for select using (exists(select 1 from pools p where p.id = pool_id));
-- supplier sees purchase orders addressed to them (aggregate only, no customer identities)
drop policy if exists docs_supplier on documents;
create policy docs_supplier on documents for select to authenticated using (supplier_id is not null and org_id is null and is_my_supplier(supplier_id));

-- Participants: buyer code + country only (no names, no org ids) — safe for anon
create or replace view pool_public_view as
  select pl.pool_id, o.buyer_code, o.country, pl.qty, pl.status, pl.joined_at, pl.deposit_minor, pl.currency,
         (p.starter_org_id = pl.org_id) as is_starter
  from pool_pledges pl join organizations o on o.id = pl.org_id join pools p on p.id = pl.pool_id
  where pl.status in ('pending','paid','confirmed','shipped','delivered');
grant select on pool_public_view to anon, authenticated;

create or replace view pool_pledge_mine_view with (security_invoker = true) as
  select pl.*, p.code as pool_code, p.status as pool_status, p.deadline_at, p.target_qty, p.filled_qty, p.pool_price_minor, p.final_price_minor,
         p.balance_due_at, p.product_id, pr.title as product_title, pr.slug as product_slug,
         o.code as order_code, o.total_cents as order_total_minor, o.paid_cents as order_paid_minor, o.status as order_status
  from pool_pledges pl join pools p on p.id = pl.pool_id join products pr on pr.id = p.product_id left join orders o on o.id = pl.order_id;
grant select on pool_pledge_mine_view to authenticated;

-- ───────────────────────── Helpers ─────────────────────────
create or replace function escrow_account(p_currency text) returns uuid
language sql security definer set search_path = public as $$
  select ledger_account(acct_code('escrow:pools', p_currency), 'Group-buy deposits held in escrow · ' || p_currency, 'liability', null, p_currency);
$$;

-- unit price at a quantity, converted into the pool currency at the pool's locked rate
create or replace function pool_unit_price(p_product uuid, p_qty int, p_currency text, p_fx uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select convert_amount(t.unit_price_cents, t.currency, p_currency, p_fx)
  from (
    select unit_price_cents, currency from price_tiers where product_id = p_product and min_qty <= greatest(p_qty, 0) order by min_qty desc limit 1
  ) t
  union all
  select convert_amount(t2.unit_price_cents, t2.currency, p_currency, p_fx)
  from (select unit_price_cents, currency from price_tiers where product_id = p_product order by min_qty asc limit 1) t2
  limit 1;
$$;

create or replace function pool_setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((setting(p_key))::text::int, p_default);
$$;

create or replace function pool_log(p_pool uuid, p_kind text, p_title text, p_body text default null, p_qty int default null) returns void
language sql security definer set search_path = public as $$
  insert into pool_events(pool_id, kind, title, body, qty) values (p_pool, p_kind, p_title, p_body, p_qty);
$$;

create or replace function pool_refund_deposit(pl pool_pledges, p_memo text, p_idem text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if pl.deposit_minor > 0 and pl.paid_at is not null then
    perform post_journal(p_memo, jsonb_build_array(
      jsonb_build_object('account', escrow_account(pl.currency), 'debit', pl.deposit_minor, 'credit', 0),
      jsonb_build_object('account', wallet_account(pl.org_id, pl.currency), 'debit', 0, 'credit', pl.deposit_minor, 'org', pl.org_id)
    ), p_idem, 'pools', 'pool_pledge', pl.id);
  end if;
end $$;

-- ───────────────────────── Join / open / withdraw ─────────────────────────
create or replace function join_pool(p_pool uuid, p_qty int, p_address uuid default null, p_pay_source text default 'wallet', p_terms uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare p pools; v_org uuid := my_org_id(); v_id uuid; v_price bigint; v_dep bigint; v_buyers int; v_terms uuid; v_status pledge_status;
begin
  if not setting_bool('pool_enabled') then raise exception 'POOLS_DISABLED'; end if;
  if v_org is null then raise exception 'NO_ORG'; end if;
  select * into p from pools where id = p_pool for update;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  if p.status <> 'open' then raise exception 'POOL_NOT_OPEN: %', p.status; end if;
  if p.deadline_at <= now() then raise exception 'POOL_DEADLINE_PASSED'; end if;
  if p.currency <> current_platform_currency() then raise exception 'POOL_CURRENCY_MISMATCH: pool % vs platform %', p.currency, current_platform_currency(); end if;
  if p_qty is null or p_qty < p.min_pledge then raise exception 'PLEDGE_BELOW_MINIMUM: %', p.min_pledge; end if;
  if p_address is not null and not exists(select 1 from addresses where id = p_address and org_id = v_org) then raise exception 'INVALID_ADDRESS'; end if;
  if exists(select 1 from pool_pledges where pool_id = p_pool and org_id = v_org and status in ('pending','paid')) then raise exception 'ALREADY_PLEDGED'; end if;
  select count(*) into v_buyers from pool_pledges where pool_id = p_pool and status in ('pending','paid');
  if v_buyers >= p.max_buyers then raise exception 'POOL_FULL_BUYERS: %', p.max_buyers; end if;
  if p_pay_source = 'wallet' and not setting_bool('wallet_enabled') then raise exception 'WALLET_DISABLED'; end if;
  v_terms := coalesce(p_terms, p.terms_version_id, (select id from terms_versions where kind = 'group_buy' and status = 'published' order by published_at desc limit 1));
  -- deposit on the pool price at the quantity AFTER this pledge
  v_price := pool_unit_price(p.product_id, p.filled_qty + p_qty, p.currency, p.fx_rate_id);
  v_dep := round_minor(v_price::numeric * p_qty * p.deposit_pct / 100.0, p.currency);
  v_status := case when p_pay_source = 'wallet' then 'paid' else 'pending' end;
  insert into pool_pledges(pool_id, org_id, buyer_user_id, qty, deposit_minor, currency, address_id, pay_source, status, terms_version_id, paid_at)
    values (p_pool, v_org, auth.uid(), p_qty, v_dep, p.currency, p_address, p_pay_source, v_status, v_terms, case when v_status = 'paid' then now() end)
    returning id into v_id;
  if p_pay_source = 'wallet' and v_dep > 0 then
    perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || v_org, p.currency)));
    if wallet_balance(v_org, p.currency) < v_dep then raise exception 'WALLET_INSUFFICIENT'; end if;
    perform post_journal('Group-buy deposit · ' || p.code, jsonb_build_array(
      jsonb_build_object('account', wallet_account(v_org, p.currency), 'debit', v_dep, 'credit', 0, 'org', v_org),
      jsonb_build_object('account', escrow_account(p.currency), 'debit', 0, 'credit', v_dep)
    ), 'pooldep:' || v_id, 'pools', 'pool_pledge', v_id);
  end if;
  -- pending (card) pledges reserve quantity too; they lapse if unpaid at fill time
  update pools set filled_qty = filled_qty + p_qty,
                   pool_price_minor = pool_unit_price(product_id, filled_qty + p_qty, currency, fx_rate_id)
    where id = p_pool returning * into p;
  perform pool_log(p_pool, 'joined', 'A buyer joined', (select buyer_code from organizations where id = v_org) || ' pledged ' || p_qty, p_qty);
  perform log_status('pool_pledge', v_id, null, v_status::text);
  perform emit_event('pool.joined', 'pool', p_pool, jsonb_build_object('org_id', v_org, 'pledge_id', v_id, 'qty', p_qty));
  return v_id;
end $$;

create or replace function open_pool(p_product uuid, p_target_qty int default null, p_deadline timestamptz default null,
  p_min_pledge int default null, p_address uuid default null, p_qty int default null, p_pay_source text default 'wallet')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org_id(); pr products; v_moq int; v_days_min int := pool_setting_int('pool_min_days',3); v_days_max int := pool_setting_int('pool_max_days',30);
        v_deadline timestamptz; v_id uuid; v_cur text := current_platform_currency(); v_fx uuid := current_fx_rate_id(); v_min int;
begin
  if not setting_bool('pool_enabled') then raise exception 'POOLS_DISABLED'; end if;
  if v_org is null then raise exception 'NO_ORG'; end if;   -- verified profile = onboarding done; KYC not required
  select * into pr from products where id = p_product and status = 'live' and archived_at is null;
  if pr.id is null then raise exception 'NOT_FOUND: product'; end if;
  v_moq := greatest(pr.moq, 1);
  if p_target_qty is not null and p_target_qty < v_moq then raise exception 'TARGET_BELOW_MOQ: %', v_moq; end if;
  v_deadline := coalesce(p_deadline, now() + make_interval(days => pool_setting_int('pool_default_days', 7)));
  if v_deadline < now() + make_interval(days => v_days_min) - interval '1 hour' or v_deadline > now() + make_interval(days => v_days_max) + interval '1 hour' then
    raise exception 'DEADLINE_OUT_OF_RANGE: % to % days', v_days_min, v_days_max;
  end if;
  v_min := coalesce(p_min_pledge, pr.pool_minimum_pledge, pool_setting_int('pool_min_pledge_default', 100));
  insert into pools(product_id, supplier_id, starter_user_id, starter_org_id, target_qty, min_pledge, max_buyers, deadline_at, currency, fx_rate_id,
                    deposit_pct, terms_version_id, pool_price_minor)
    values (p_product, pr.supplier_id, auth.uid(), v_org, coalesce(p_target_qty, v_moq), v_min, pool_setting_int('pool_max_buyers', 25), v_deadline,
            v_cur, v_fx, pool_setting_int('pool_deposit_pct', 10),
            (select id from terms_versions where kind = 'group_buy' and status = 'published' order by published_at desc limit 1),
            pool_unit_price(p_product, 0, v_cur, v_fx))
    returning id into v_id;
  perform pool_log(v_id, 'opened', 'Pool opened', 'Target ' || coalesce(p_target_qty, v_moq) || ' ' || pr.unit);
  perform log_status('pool', v_id, null, 'open');
  perform emit_event('pool.opened', 'pool', v_id, jsonb_build_object('org_id', v_org, 'product_id', p_product));
  if p_qty is not null then perform join_pool(v_id, p_qty, p_address, p_pay_source); end if;
  return v_id;
end $$;

create or replace function withdraw_pledge(p_pledge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl pool_pledges; p pools;
begin
  select * into pl from pool_pledges where id = p_pledge for update;
  if pl.id is null then raise exception 'NOT_FOUND'; end if;
  if pl.org_id not in (select my_org_ids()) and not can('orders','edit') then raise exception 'FORBIDDEN'; end if;
  select * into p from pools where id = pl.pool_id for update;
  if p.status <> 'open' then raise exception 'POOL_ALREADY_FILLED'; end if;    -- after fill: no backing out
  if pl.status not in ('pending','paid') then raise exception 'INVALID_TRANSITION: %', pl.status; end if;
  perform pool_refund_deposit(pl, 'Group-buy pledge withdrawn · ' || p.code, 'poolwd:' || pl.id);
  update pool_pledges set status = 'withdrawn', withdrawn_at = now() where id = p_pledge;
  update pools set filled_qty = greatest(filled_qty - pl.qty, 0),
                   pool_price_minor = pool_unit_price(product_id, greatest(filled_qty - pl.qty, 0), currency, fx_rate_id)
    where id = p.id;
  perform pool_log(p.id, 'withdrawn', 'A buyer withdrew', (select buyer_code from organizations where id = pl.org_id) || ' withdrew ' || pl.qty, -pl.qty);
  perform log_status('pool_pledge', p_pledge, pl.status::text, 'withdrawn');
  perform write_audit('pool.pledge_withdrawn', 'pool_pledges', p_pledge::text, jsonb_build_object('pool', p.code, 'qty', pl.qty));
  perform emit_event('pool.withdrawn', 'pool', p.id, jsonb_build_object('org_id', pl.org_id, 'pledge_id', pl.id));
end $$;

-- card / bank transfer deposits confirmed by finance or the payment webhook
create or replace function confirm_pool_deposit(p_pledge uuid, p_provider_event text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pl pool_pledges;
begin
  if not can('wallet','approve') and auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into pl from pool_pledges where id = p_pledge for update;
  if pl.status = 'paid' then return; end if;
  if pl.status <> 'pending' then raise exception 'INVALID_TRANSITION: %', pl.status; end if;
  perform post_journal('Group-buy deposit (card/bank) · pledge ' || p_pledge, jsonb_build_array(
    jsonb_build_object('account', cash_account(pl.currency), 'debit', pl.deposit_minor, 'credit', 0),
    jsonb_build_object('account', escrow_account(pl.currency), 'debit', 0, 'credit', pl.deposit_minor)
  ), coalesce('pooldep-evt:' || p_provider_event, 'pooldep:' || p_pledge), 'pools', 'pool_pledge', p_pledge);
  update pool_pledges set status = 'paid', paid_at = now() where id = p_pledge;
  perform log_status('pool_pledge', p_pledge, 'pending', 'paid');
end $$;

-- ───────────────────────── Settle / expire / default / cancel ─────────────────────────
create or replace function settle_pool(p_pool uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p pools; pr products; pl pool_pledges; v_price bigint; v_total bigint; v_order uuid; v_code text; v_pi text; v_qty int; v_n int := 0;
        v_po uuid; v_cost bigint; v_due timestamptz;
begin
  if not (can('orders','edit') or auth.role() = 'service_role' or auth.uid() is null) then raise exception 'FORBIDDEN'; end if;
  select * into p from pools where id = p_pool for update;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  if p.status <> 'open' then return jsonb_build_object('ok', true, 'idempotent', true, 'status', p.status); end if;   -- idempotent
  -- unpaid (card) pledges lapse at fill time
  for pl in select * from pool_pledges where pool_id = p_pool and status = 'pending' for update loop
    update pool_pledges set status = 'withdrawn', withdrawn_at = now() where id = pl.id;
    perform pool_log(p_pool, 'lapsed', 'Unpaid pledge lapsed', null, -pl.qty);
  end loop;
  select coalesce(sum(qty),0) into v_qty from pool_pledges where pool_id = p_pool and status = 'paid';
  if v_qty < p.target_qty then
    update pools set filled_qty = v_qty where id = p_pool;
    raise exception 'POOL_NOT_FILLED: % of %', v_qty, p.target_qty;
  end if;
  select * into pr from products where id = p.product_id;
  v_price := pool_unit_price(p.product_id, v_qty, p.currency, p.fx_rate_id);       -- everyone pays the final tier price
  v_due := now() + make_interval(hours => pool_setting_int('pool_balance_hours', 48));
  for pl in select * from pool_pledges where pool_id = p_pool and status = 'paid' order by joined_at for update loop
    v_total := v_price * pl.qty;
    insert into orders(org_id, supplier_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents,
                       paid_cents, incoterm, terms_version_id, currency, fx_rate_id, pool_id, pool_pledge_id)
      values (pl.org_id, p.supplier_id, 'balance_pending', 'Group buy ' || p.code || ' · ' || pr.title, pl.qty, v_price, 0, v_total, p.deposit_pct,
              least(pl.deposit_minor, v_total), least(pl.deposit_minor, v_total), pr.incoterm, pl.terms_version_id, p.currency, p.fx_rate_id, p_pool, pl.id)
      returning id, code into v_order, v_code;
    v_pi := 'PI-' || to_char(now(),'YYYY') || '-' || lpad(nextval('seq_pi')::text, 4, '0');
    insert into proforma_invoices(number, order_id, org_id, total_cents, deposit_cents, currency, fx_rate_id, pool_id)
      values (v_pi, v_order, pl.org_id, v_total, least(pl.deposit_minor, v_total), p.currency, p.fx_rate_id, p_pool);
    insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status, data)
      values (pl.org_id, 'proforma_invoice', v_pi, v_order, v_total, p.currency, 'awaiting_payment',
              jsonb_build_object('pool', p.code, 'title', pr.title, 'qty', pl.qty, 'unit_price_cents', v_price, 'unit', pr.unit,
                                 'deposit_cents', least(pl.deposit_minor, v_total), 'balance_cents', v_total - least(pl.deposit_minor, v_total),
                                 'balance_due_at', v_due, 'currency', p.currency, 'shipping', 'Freight charged per buyer at balance time'));
    -- PI: receivable for the full value; then the escrowed deposit is applied to it
    perform post_journal('PI ' || v_pi || ' issued · ' || p.code, jsonb_build_array(
      jsonb_build_object('account', receivable_account(pl.org_id, p.currency), 'debit', v_total, 'credit', 0, 'org', pl.org_id),
      jsonb_build_object('account', revenue_account('orders', p.currency), 'debit', 0, 'credit', v_total)
    ), 'poolpi:' || pl.id, 'orders', 'order', v_order);
    if least(pl.deposit_minor, v_total) > 0 then
      perform post_journal('Group-buy deposit applied · ' || v_pi, jsonb_build_array(
        jsonb_build_object('account', escrow_account(p.currency), 'debit', least(pl.deposit_minor, v_total), 'credit', 0),
        jsonb_build_object('account', receivable_account(pl.org_id, p.currency), 'debit', 0, 'credit', least(pl.deposit_minor, v_total), 'org', pl.org_id)
      ), 'pooldepapply:' || pl.id, 'pools', 'order', v_order);
      -- deposit larger than the final value (price dropped a lot): refund the excess
      if pl.deposit_minor > v_total then
        perform post_journal('Group-buy deposit excess refunded · ' || v_pi, jsonb_build_array(
          jsonb_build_object('account', escrow_account(p.currency), 'debit', pl.deposit_minor - v_total, 'credit', 0),
          jsonb_build_object('account', wallet_account(pl.org_id, p.currency), 'debit', 0, 'credit', pl.deposit_minor - v_total, 'org', pl.org_id)
        ), 'pooldepexcess:' || pl.id, 'pools', 'order', v_order);
      end if;
    end if;
    update pool_pledges set balance_minor = v_total - least(pl.deposit_minor, v_total), order_id = v_order where id = pl.id;
    insert into order_events(order_id, org_id, kind, title, body) values (v_order, pl.org_id, 'status', 'Group buy filled',
      p.code || ' · PI ' || v_pi || ' · balance due by ' || to_char(v_due at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
    perform log_status('order', v_order, null, 'balance_pending', 'pool ' || p.code);
    perform emit_event('pi.created', 'order', v_order, jsonb_build_object('org_id', pl.org_id, 'pi', v_pi, 'pool', p.code));
    v_n := v_n + 1;
  end loop;
  -- one aggregate purchase order to the supplier — no customer identities
  select supplier_cost_cents into v_cost from product_costs where product_id = p.product_id;
  insert into documents(org_id, supplier_id, doc_type, number, amount_cents, currency, status, data)
    values (null, p.supplier_id, 'purchase_order', 'PO-' || p.code, case when v_cost is not null then v_cost * v_qty end, 'USD', 'awaiting_balance',
            jsonb_build_object('pool', p.code, 'product', pr.title, 'aggregate_qty', v_qty, 'unit', pr.unit, 'buyers', v_n,
                               'note', 'Confirmed after balance payments; ship to Octopus consolidation for split shipments'))
    returning id into v_po;
  update pools set status = 'locked', filled_qty = v_qty, final_price_minor = v_price, pool_price_minor = v_price, filled_at = now(),
                   balance_due_at = v_due, settled_at = now(), po_document_id = v_po where id = p_pool;
  perform pool_log(p_pool, 'filled', 'Pool filled', v_n || ' buyers · ' || v_qty || ' ' || pr.unit || ' · balance due in ' || pool_setting_int('pool_balance_hours', 48) || ' h', v_qty);
  perform log_status('pool', p_pool, 'open', 'locked', 'filled');
  perform emit_event('pool.filled', 'pool', p_pool, jsonb_build_object('qty', v_qty, 'buyers', v_n, 'price_minor', v_price, 'currency', p.currency));
  perform emit_event('po.created', 'pool', p_pool, jsonb_build_object('document_id', v_po, 'qty', v_qty));
  return jsonb_build_object('ok', true, 'orders', v_n, 'qty', v_qty, 'unit_price_minor', v_price, 'po_document_id', v_po);
end $$;

create or replace function expire_pool(p_pool uuid) returns int
language plpgsql security definer set search_path = public as $$
declare p pools; pl pool_pledges; n int := 0;
begin
  if not (can('orders','edit') or auth.role() = 'service_role' or auth.uid() is null) then raise exception 'FORBIDDEN'; end if;
  select * into p from pools where id = p_pool for update;
  if p.status <> 'open' then return 0; end if;
  for pl in select * from pool_pledges where pool_id = p_pool and status in ('pending','paid') for update loop
    perform pool_refund_deposit(pl, 'Group-buy pool expired · refund · ' || p.code, 'poolexp:' || pl.id);
    update pool_pledges set status = 'withdrawn', withdrawn_at = now() where id = pl.id;
    n := n + 1;
  end loop;
  update pools set status = 'expired', closed_at = now() where id = p_pool;
  perform pool_log(p_pool, 'expired', 'Pool did not fill', n || ' deposits refunded to wallets');
  perform log_status('pool', p_pool, 'open', 'expired');
  perform emit_event('pool.expired', 'pool', p_pool, jsonb_build_object('refunds', n));
  return n;
end $$;

-- balance unpaid 48 h after fill: pledge defaulted, deposit forfeited to cover the shortfall
create or replace function default_pledge(p_pledge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl pool_pledges; o orders; p pools; v_unpaid bigint;
begin
  if not (can('orders','edit') or auth.role() = 'service_role' or auth.uid() is null) then raise exception 'FORBIDDEN'; end if;
  select * into pl from pool_pledges where id = p_pledge for update;
  if pl.status <> 'paid' or pl.order_id is null then raise exception 'INVALID_TRANSITION: %', pl.status; end if;
  select * into o from orders where id = pl.order_id for update;
  select * into p from pools where id = pl.pool_id;
  if o.paid_cents >= o.total_cents then raise exception 'BALANCE_ALREADY_PAID'; end if;
  v_unpaid := o.total_cents - o.paid_cents;
  -- reverse the unpaid part of the receivable; reclassify what was paid (the deposit) as forfeit revenue
  perform post_journal('Group-buy default · balance reversed · ' || o.code, jsonb_build_array(
    jsonb_build_object('account', revenue_account('orders', o.currency), 'debit', v_unpaid, 'credit', 0),
    jsonb_build_object('account', receivable_account(o.org_id, o.currency), 'debit', 0, 'credit', v_unpaid, 'org', o.org_id)
  ), 'pooldefault:' || pl.id, 'orders', 'order', o.id);
  if o.paid_cents > 0 then
    perform post_journal('Group-buy default · deposit forfeited to shortfall · ' || p.code, jsonb_build_array(
      jsonb_build_object('account', revenue_account('orders', o.currency), 'debit', o.paid_cents, 'credit', 0),
      jsonb_build_object('account', revenue_account('pool_forfeit', o.currency), 'debit', 0, 'credit', o.paid_cents)
    ), 'poolforfeit:' || pl.id, 'pool_forfeit', 'pool_pledge', pl.id);
  end if;
  update orders set status = 'cancelled' where id = o.id;
  insert into order_events(order_id, org_id, kind, title, body) values (o.id, o.org_id, 'status', 'Cancelled', 'Group-buy balance not paid in time; deposit forfeited');
  perform log_status('order', o.id, o.status::text, 'cancelled', 'pool default');
  update pool_pledges set status = 'defaulted', defaulted_at = now() where id = p_pledge;
  perform pool_log(p.id, 'defaulted', 'A buyer defaulted', (select buyer_code from organizations where id = pl.org_id) || ' · deposit applied to shortfall', -pl.qty);
  perform log_status('pool_pledge', p_pledge, 'paid', 'defaulted');
  perform emit_event('pool.defaulted', 'pool', p.id, jsonb_build_object('org_id', pl.org_id, 'pledge_id', pl.id));
  perform pool_check_confirmed(p.id);
end $$;

-- when every remaining pledge has paid its balance, the pool is confirmed and the supplier PO goes out
create or replace function pool_check_confirmed(p_pool uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  select * into p from pools where id = p_pool for update;
  if p.status <> 'locked' then return; end if;
  if exists(select 1 from pool_pledges where pool_id = p_pool and status = 'paid') then return; end if;
  if not exists(select 1 from pool_pledges where pool_id = p_pool and status = 'confirmed') then return; end if;
  update documents set status = 'issued', data = data || jsonb_build_object('aggregate_qty', (select sum(qty) from pool_pledges where pool_id = p_pool and status = 'confirmed'))
    where id = p.po_document_id;
  update pools set status = 'confirmed' where id = p_pool;
  perform pool_log(p_pool, 'confirmed', 'All balances paid', 'One purchase order placed with the supplier');
  perform log_status('pool', p_pool, 'locked', 'confirmed');
  perform emit_event('pool.confirmed', 'pool', p_pool, jsonb_build_object('po_document_id', p.po_document_id));
end $$;

-- order fully paid → pledge confirmed (balance paid)
create or replace function trg_pool_order_paid() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pool_pledge_id is not null and new.paid_cents >= new.total_cents and old.paid_cents < old.total_cents then
    update pool_pledges set status = 'confirmed', confirmed_at = now() where id = new.pool_pledge_id and status = 'paid';
    perform log_status('pool_pledge', new.pool_pledge_id, 'paid', 'confirmed');
    perform pool_check_confirmed(new.pool_id);
  end if;
  if new.pool_pledge_id is not null and new.status in ('shipped','delivered') and old.status is distinct from new.status then
    update pool_pledges set status = new.status::text::pledge_status where id = new.pool_pledge_id and status in ('confirmed','shipped');
  end if;
  return new;
end $$;
create trigger trg_orders_pool_paid after update on orders for each row execute function trg_pool_order_paid();

create or replace function cancel_pool(p_pool uuid, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare p pools; pl pool_pledges; o orders; n int := 0;
begin
  if not (is_admin() or can('orders','approve')) then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into p from pools where id = p_pool for update;
  if p.status in ('cancelled','expired','completed','shipped') then raise exception 'INVALID_TRANSITION: %', p.status; end if;
  for pl in select * from pool_pledges where pool_id = p_pool and status in ('pending','paid','confirmed') for update loop
    if pl.order_id is null then
      perform pool_refund_deposit(pl, 'Group-buy pool cancelled · refund · ' || p.code, 'poolcancel:' || pl.id);
    else
      select * into o from orders where id = pl.order_id for update;
      if o.total_cents - o.paid_cents > 0 then
        perform post_journal('Group-buy cancelled · balance reversed · ' || o.code, jsonb_build_array(
          jsonb_build_object('account', revenue_account('orders', o.currency), 'debit', o.total_cents - o.paid_cents, 'credit', 0),
          jsonb_build_object('account', receivable_account(o.org_id, o.currency), 'debit', 0, 'credit', o.total_cents - o.paid_cents, 'org', o.org_id)
        ), 'poolcancel-ar:' || pl.id, 'orders', 'order', o.id);
      end if;
      if o.paid_cents > 0 then     -- everything the buyer paid (deposit + balance) goes back to their wallet
        perform post_journal('Group-buy cancelled · refund · ' || o.code, jsonb_build_array(
          jsonb_build_object('account', revenue_account('orders', o.currency), 'debit', o.paid_cents, 'credit', 0),
          jsonb_build_object('account', wallet_account(o.org_id, o.currency), 'debit', 0, 'credit', o.paid_cents, 'org', o.org_id)
        ), 'poolcancel-refund:' || pl.id, 'orders', 'order', o.id);
      end if;
      update orders set status = 'cancelled' where id = o.id;
      perform log_status('order', o.id, o.status::text, 'cancelled', 'pool cancelled: ' || p_reason);
    end if;
    update pool_pledges set status = 'withdrawn', withdrawn_at = now() where id = pl.id;
    n := n + 1;
  end loop;
  update documents set status = 'cancelled' where id = p.po_document_id;
  update pools set status = 'cancelled', closed_at = now() where id = p_pool;
  perform pool_log(p_pool, 'cancelled', 'Pool cancelled by Octopus', p_reason);
  perform log_status('pool', p_pool, p.status::text, 'cancelled', p_reason);
  perform write_audit('pool.cancelled', 'pools', p_pool::text, jsonb_build_object('reason', p_reason, 'refunds', n));
  perform emit_event('pool.cancelled', 'pool', p_pool, jsonb_build_object('reason', p_reason));
  return n;
end $$;

create or replace function extend_pool_deadline(p_pool uuid, p_deadline timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  if not (is_admin() or can('orders','approve')) then raise exception 'FORBIDDEN'; end if;
  select * into p from pools where id = p_pool for update;
  if p.status <> 'open' then raise exception 'INVALID_TRANSITION: %', p.status; end if;
  if p_deadline <= p.deadline_at then raise exception 'DEADLINE_MUST_BE_LATER'; end if;
  update pools set deadline_at = p_deadline where id = p_pool;
  perform pool_log(p_pool, 'extended', 'Deadline extended', to_char(p_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
  perform write_audit('pool.extended', 'pools', p_pool::text, jsonb_build_object('deadline', p_deadline));
end $$;

create or replace function force_settle_pool(p_pool uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into p from pools where id = p_pool for update;
  -- admin may settle below target (Octopus covers the shortfall): lower the target to what is paid, then settle
  update pools set target_qty = least(target_qty, (select coalesce(sum(qty),0) from pool_pledges where pool_id = p_pool and status = 'paid'))
    where id = p_pool and status = 'open';
  perform write_audit('pool.force_settled', 'pools', p_pool::text, jsonb_build_object('original_target', p.target_qty));
  return settle_pool(p_pool);
end $$;

-- ───────────────────────── Cron ─────────────────────────
create or replace function job_pools() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; s int := 0; e int := 0; d int := 0; r int := 0; pl record;
begin
  for v in select id from pools where status = 'open' and filled_qty >= target_qty loop
    begin perform settle_pool(v); s := s + 1; exception when others then null; end;   -- unpaid card pledges may drop it below target
  end loop;
  for v in select id from pools where status = 'open' and deadline_at <= now() loop
    perform expire_pool(v); e := e + 1;
  end loop;
  for pl in select pp.id from pool_pledges pp join pools p on p.id = pp.pool_id
            where pp.status = 'paid' and p.status = 'locked' and p.balance_due_at <= now() loop
    perform default_pledge(pl.id); d := d + 1;
  end loop;
  -- balance reminders at T+24h and T+36h after fill
  for pl in select pp.id, pp.org_id, pp.reminders_sent, p.id pool_id, p.code, p.filled_at from pool_pledges pp join pools p on p.id = pp.pool_id
            where pp.status = 'paid' and p.status = 'locked'
              and ((pp.reminders_sent = 0 and p.filled_at <= now() - interval '24 hours') or (pp.reminders_sent = 1 and p.filled_at <= now() - interval '36 hours')) loop
    update pool_pledges set reminders_sent = reminders_sent + 1 where id = pl.id;
    perform emit_event('pool.balance_reminder', 'pool', pl.pool_id, jsonb_build_object('org_id', pl.org_id, 'pledge_id', pl.id, 'reminder', pl.reminders_sent + 1));
    r := r + 1;
  end loop;
  return jsonb_build_object('settled', s, 'expired', e, 'defaulted', d, 'reminders', r);
end $$;

do $$ begin
  perform cron.schedule('octopus-pools', '*/5 * * * *', 'select public.job_pools()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ───────────────────────── Grants ─────────────────────────
do $$ declare f text;
begin
  foreach f in array array['join_pool(uuid,integer,uuid,text,uuid)','open_pool(uuid,integer,timestamptz,integer,uuid,integer,text)',
                           'withdraw_pledge(uuid)','confirm_pool_deposit(uuid,text)','settle_pool(uuid)','expire_pool(uuid)','default_pledge(uuid)',
                           'cancel_pool(uuid,text)','extend_pool_deadline(uuid,timestamptz)','force_settle_pool(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['escrow_account(text)','pool_refund_deposit(pool_pledges,text,text)','pool_log(uuid,text,text,text,integer)',
                           'pool_check_confirmed(uuid)','job_pools()','trg_pool_order_paid()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['pool_unit_price(uuid,integer,text,uuid)','pool_setting_int(text,integer)'] loop
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end $$;

