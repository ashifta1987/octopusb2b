-- SPEC §20 — staff/admin side of the assistant (back-office queue, side-rail facts, admin reports).
-- Forward-only. Lets the ASSIGNED account manager (assistant_staff_can) read the identity and the customer-visible
-- business rows of their customers even when their role has no customers/orders/requests permission
-- (e.g. a pure sourcing_agent). Everything stays read-only; writes still go through the existing RPCs.

-- identity panel: organisation row (name, buyer code, country, KYC)
drop policy if exists orgs_assistant_read on organizations;
create policy orgs_assistant_read on organizations for select to authenticated using (assistant_staff_can(id));

-- Octo side-rail facts: the same rows the customer can see in their portal
drop policy if exists orders_assistant_read on orders;
create policy orders_assistant_read on orders for select to authenticated using (assistant_staff_can(org_id));
drop policy if exists ship_assistant_read on shipments;
create policy ship_assistant_read on shipments for select to authenticated using (assistant_staff_can(org_id));
drop policy if exists rfq_assistant_read on rfqs;
create policy rfq_assistant_read on rfqs for select to authenticated using (assistant_staff_can(org_id));
drop policy if exists quotes_assistant_read on quotes;
create policy quotes_assistant_read on quotes for select to authenticated
  using (exists(select 1 from rfqs r where r.id = quotes.rfq_id and assistant_staff_can(r.org_id)));

-- wallet balances of one customer for the side rail (no ledger detail)
create or replace function assistant_org_wallets(p_org uuid) returns table(currency text, balance_minor bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not assistant_staff_can(p_org) then raise exception 'FORBIDDEN'; end if;
  return query
    select la.currency::text, coalesce((select sum(le.credit_cents - le.debit_cents) from ledger_entries le where le.account_id = la.id), 0)::bigint
    from ledger_accounts la where la.org_id = p_org and la.code like 'wallet:%' order by 1;
end $$;

-- display names of staff (message authors, account managers) for staff with assistant:view — staff users only
create or replace function assistant_people(p_ids uuid[]) returns table(id uuid, full_name text, title text, team text, out_of_office boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or can('assistant','view')) then raise exception 'FORBIDDEN'; end if;
  return query select p.id, p.full_name, p.title, p.team, p.out_of_office from profiles p
    where p.id = any(p_ids) and user_is_staff(p.id);
end $$;

-- account-manager candidates + workload (admin / assistant:reassign): users with assistant:view or the sourcing_agent role
create or replace function assistant_staff_workload() returns table(id uuid, full_name text, email text, team text, title text,
  out_of_office boolean, roles text[], customers bigint, open_escalations bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or can('assistant','reassign') or can('assistant','configure')) then raise exception 'FORBIDDEN'; end if;
  return query
    select p.id, p.full_name, p.email, p.team, p.title, p.out_of_office,
           array_agg(distinct ur.role_code)::text[],
           (select count(*) from account_managers a where a.staff_user_id = p.id),
           (select count(*) from escalations e where e.assigned_to = p.id and e.resolved_at is null)
    from profiles p join user_roles ur on ur.user_id = p.id
    where p.active and (ur.role_code = 'sourcing_agent' or exists(select 1 from user_roles u2 join role_permissions rp on rp.role_code = u2.role_code
                                                   where u2.user_id = p.id and rp.area = 'assistant' and rp.action = 'view'))
      and ur.role_code not in ('customer')
    group by p.id order by p.full_name;
end $$;

do $$ declare f text;
begin
  foreach f in array array['assistant_org_wallets(uuid)','assistant_people(uuid[])','assistant_staff_workload()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

insert into site_settings(key, value, description, is_public) values
  ('assistant_cost_per_1k_tokens_usd', '0.0006', 'Estimated model cost per 1,000 tokens (USD) for assistant reports', false),
  ('assistant_alert_thresholds', '{"min_bot_resolution_rate":70,"max_sla_breach_rate":5}', 'Daily assistant metrics alert thresholds (%)', false)
on conflict (key) do nothing;
