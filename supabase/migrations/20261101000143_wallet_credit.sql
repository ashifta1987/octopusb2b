-- Wallet credit facility (owner request, 1 Nov 2026; SPEC §5 Wallet / §12 Money amended):
-- a customer wallet may go below zero down to its credit limit. Default limit US$ 1,000 (site setting, Admin-editable),
-- optional per-customer override (Admin only). Every spending check now uses wallet_available() = balance + credit limit.
-- The ledger is unchanged: a negative wallet balance is simply money the customer owes Octopus.

-- ───────── Settings ─────────
insert into site_settings(key, value, description) values
  ('wallet_credit_default', '{"amount_minor": 100000, "currency": "USD", "verified_only": true}'::jsonb,
   'Wallet credit facility: default limit (minor units, e.g. 100000 = 1,000.00) in the given currency; verified_only = only KYC-verified customers get the default. 0 = no credit by default. Per-customer overrides in wallet_credit_limits.')
on conflict (key) do nothing;

-- ───────── Per-customer overrides ─────────
create table if not exists wallet_credit_limits (
  org_id uuid primary key references organizations(id) on delete cascade,
  limit_minor bigint not null check (limit_minor >= 0 and limit_minor <= 100000000000),
  currency text not null check (currency in ('USD', 'CNY')),
  note text,
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now()
);
alter table wallet_credit_limits enable row level security;
-- read: the customer's own org, or staff who can view wallets. No write policies: changes go through admin_set_wallet_credit().
drop policy if exists wcl_read on wallet_credit_limits;
create policy wcl_read on wallet_credit_limits for select to authenticated
  using (org_id in (select my_org_ids()) or can('wallet', 'view'));
grant select on wallet_credit_limits to authenticated;

-- ───────── Limit / available ─────────
create or replace function wallet_credit_limit(p_org uuid, p_currency text default null) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := coalesce(p_currency, current_platform_currency()); o record; d jsonb;
begin
  if p_org is null then return 0; end if;
  select limit_minor, currency into o from wallet_credit_limits where org_id = p_org;
  if found then
    return case when o.currency = v_cur then o.limit_minor else 0 end;
  end if;
  select value into d from site_settings where key = 'wallet_credit_default';
  if d is null or coalesce((d->>'amount_minor')::bigint, 0) <= 0 or coalesce(d->>'currency', 'USD') <> v_cur then return 0; end if;
  if coalesce((d->>'verified_only')::boolean, true)
     and not exists (select 1 from organizations where id = p_org and kyc_status = 'verified') then
    return 0;
  end if;
  return (d->>'amount_minor')::bigint;
end $$;

create or replace function wallet_available(p_org uuid, p_currency text default null) returns bigint
language sql stable security definer set search_path = public as $$
  select wallet_balance(p_org, p_currency) + wallet_credit_limit(p_org, p_currency);
$$;

-- customer view: balance, credit limit and spendable amount of MY wallet
create or replace function my_wallet_credit(p_currency text default null)
returns table(currency text, balance_minor bigint, credit_limit_minor bigint, available_minor bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(p_currency, current_platform_currency()),
         wallet_balance(my_org_id(), p_currency),
         wallet_credit_limit(my_org_id(), p_currency),
         wallet_available(my_org_id(), p_currency)
  where my_org_id() is not null;
$$;

-- ───────── Admin RPCs (Admin only, audited) ─────────
create or replace function admin_set_wallet_credit_default(p_amount_minor bigint, p_currency text, p_verified_only boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount_minor is null or p_amount_minor < 0 or p_amount_minor > 100000000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_currency not in ('USD', 'CNY') then raise exception 'INVALID_CURRENCY'; end if;
  select value into v_old from site_settings where key = 'wallet_credit_default';
  insert into site_settings(key, value, updated_at) values ('wallet_credit_default',
    jsonb_build_object('amount_minor', p_amount_minor, 'currency', p_currency, 'verified_only', coalesce(p_verified_only, true)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform write_audit('wallet.credit_default_set', 'site_settings', 'wallet_credit_default',
    jsonb_build_object('old', v_old, 'amount_minor', p_amount_minor, 'currency', p_currency, 'verified_only', p_verified_only));
end $$;

-- p_limit_minor null → remove the override (customer falls back to the default)
create or replace function admin_set_wallet_credit(p_org uuid, p_limit_minor bigint, p_currency text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old record; v_cur text := coalesce(p_currency, current_platform_currency());
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from organizations where id = p_org) then raise exception 'NOT_FOUND'; end if;
  if v_cur not in ('USD', 'CNY') then raise exception 'INVALID_CURRENCY'; end if;
  select * into v_old from wallet_credit_limits where org_id = p_org;
  if p_limit_minor is null then
    delete from wallet_credit_limits where org_id = p_org;
  else
    if p_limit_minor < 0 or p_limit_minor > 100000000000 then raise exception 'INVALID_AMOUNT'; end if;
    insert into wallet_credit_limits(org_id, limit_minor, currency, note, set_by, set_at)
      values (p_org, p_limit_minor, v_cur, nullif(trim(p_note), ''), auth.uid(), now())
    on conflict (org_id) do update set limit_minor = excluded.limit_minor, currency = excluded.currency,
      note = excluded.note, set_by = excluded.set_by, set_at = now();
  end if;
  perform write_audit('wallet.credit_limit_set', 'organizations', p_org::text,
    jsonb_build_object('old_limit', v_old.limit_minor, 'old_currency', v_old.currency, 'limit_minor', p_limit_minor, 'currency', v_cur, 'note', p_note));
end $$;

-- staff overview: every customer org with balance, limit and available in the platform currency
create or replace function admin_wallet_credit_overview()
returns table(org_id uuid, org_name text, country text, kyc_status kyc_status, currency text,
              balance_minor bigint, credit_limit_minor bigint, available_minor bigint, override_minor bigint, override_currency text, note text)
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := current_platform_currency();
begin
  if not can('wallet', 'view') then raise exception 'FORBIDDEN'; end if;
  return query
    select o.id, o.name, o.country, o.kyc_status, v_cur,
           wallet_balance(o.id, v_cur), wallet_credit_limit(o.id, v_cur), wallet_available(o.id, v_cur),
           l.limit_minor, l.currency, l.note
    from organizations o left join wallet_credit_limits l on l.org_id = o.id
    order by o.name;
end $$;

-- ───────── Spending checks: balance → available (bodies patched in place, nothing else changes) ─────────
do $$
declare
  fixes text[][] := array[
    array['wallet_charge(uuid,bigint,text,text,text,text,uuid,text)', 'v_bal := wallet_balance(p_org, v_cur);', 'v_bal := wallet_available(p_org, v_cur);'],
    array['wallet_charge(uuid,bigint,text,text,text,text,uuid,text)', '''WALLET_INSUFFICIENT: balance % needed % %''', '''WALLET_INSUFFICIENT: available % needed % %'''],
    array['record_payment(uuid,bigint,text,text,text)', 'if wallet_balance(o.org_id, o.currency) < p_amount', 'if wallet_available(o.org_id, o.currency) < p_amount'],
    array['record_ad_click(uuid,text)', 'wallet_balance(c.org_id, c.currency) < v_charge', 'wallet_available(c.org_id, c.currency) < v_charge'],
    array['join_pool(uuid,integer,uuid,text,uuid)', 'if wallet_balance(v_org, p.currency) < v_dep', 'if wallet_available(v_org, p.currency) < v_dep']
  ];
  i int; def text; patched text;
begin
  for i in 1 .. array_length(fixes, 1) loop
    def := pg_get_functiondef(fixes[i][1]::regprocedure);
    if position(fixes[i][3] in def) > 0 then continue; end if;           -- already patched (re-run)
    patched := replace(def, fixes[i][2], fixes[i][3]);
    if patched = def then raise exception 'wallet credit patch: target not found in %: %', fixes[i][1], fixes[i][2]; end if;
    execute patched;
  end loop;
end $$;

-- Currency switch with "convert": negative (credit-used) wallets are converted too, so debts move with the wallet.
do $$
declare def text; patched text;
  old_loop text := 'for w in select org_id, balance_minor from wallets where currency = r.from_currency and balance_minor > 0 loop
      v_conv := convert_amount(w.balance_minor, r.from_currency, r.to_currency, v_fx);
      perform post_journal(''Currency switch: wallet converted '' || r.from_currency || '' → '' || r.to_currency || '' @ '' || r.rate, jsonb_build_array(
        jsonb_build_object(''account'', wallet_account(w.org_id, r.from_currency), ''debit'', w.balance_minor, ''credit'', 0, ''org'', w.org_id),
        jsonb_build_object(''account'', fx_conversion_account(r.from_currency), ''debit'', 0, ''credit'', w.balance_minor),
        jsonb_build_object(''account'', fx_conversion_account(r.to_currency), ''debit'', v_conv, ''credit'', 0),
        jsonb_build_object(''account'', wallet_account(w.org_id, r.to_currency), ''debit'', 0, ''credit'', v_conv, ''org'', w.org_id)';
  new_loop text := 'for w in select org_id, balance_minor from wallets where currency = r.from_currency and balance_minor <> 0 loop
      -- positive balances move as credit, negative (credit facility used) as debt
      v_conv := sign(w.balance_minor) * convert_amount(abs(w.balance_minor), r.from_currency, r.to_currency, v_fx);
      perform post_journal(''Currency switch: wallet converted '' || r.from_currency || '' → '' || r.to_currency || '' @ '' || r.rate, jsonb_build_array(
        jsonb_build_object(''account'', wallet_account(w.org_id, r.from_currency), ''debit'', greatest(w.balance_minor, 0), ''credit'', greatest(-w.balance_minor, 0), ''org'', w.org_id),
        jsonb_build_object(''account'', fx_conversion_account(r.from_currency), ''debit'', greatest(-w.balance_minor, 0), ''credit'', greatest(w.balance_minor, 0)),
        jsonb_build_object(''account'', fx_conversion_account(r.to_currency), ''debit'', greatest(v_conv, 0), ''credit'', greatest(-v_conv, 0)),
        jsonb_build_object(''account'', wallet_account(w.org_id, r.to_currency), ''debit'', greatest(-v_conv, 0), ''credit'', greatest(v_conv, 0), ''org'', w.org_id)';
begin
  def := pg_get_functiondef('apply_currency_switch(uuid)'::regprocedure);
  if position('balance_minor <> 0 loop' in def) > 0 then return; end if;
  patched := replace(def, old_loop, new_loop);
  if patched = def then raise exception 'wallet credit patch: currency switch loop not found'; end if;
  execute patched;
end $$;

-- ───────── Privileges ─────────
revoke execute on function wallet_credit_limit(uuid, text) from public, anon, authenticated;
revoke execute on function wallet_available(uuid, text) from public, anon, authenticated;
grant execute on function wallet_credit_limit(uuid, text) to service_role;
grant execute on function wallet_available(uuid, text) to service_role;
revoke execute on function my_wallet_credit(text) from public, anon;
grant execute on function my_wallet_credit(text) to authenticated;
revoke execute on function admin_set_wallet_credit_default(bigint, text, boolean) from public, anon;
revoke execute on function admin_set_wallet_credit(uuid, bigint, text, text) from public, anon;
revoke execute on function admin_wallet_credit_overview() from public, anon;
grant execute on function admin_set_wallet_credit_default(bigint, text, boolean) to authenticated;
grant execute on function admin_set_wallet_credit(uuid, bigint, text, text) to authenticated;
grant execute on function admin_wallet_credit_overview() to authenticated;

