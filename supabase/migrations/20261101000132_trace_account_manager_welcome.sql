-- SPEC §21 chain 1 gap: "account manager assigned" ended at the account_managers row + audit entry; the customer got no
-- welcome e-mail and nothing told the dashboard. assign_account_manager() now also writes outbox event
-- `account_manager.assigned` (consumers: notify + email, lib/api/outbox-rules.ts) in the same transaction.
-- Also stamps trace ids on order_events (the Realtime table the order timeline listens to).

create or replace function assign_account_manager(p_org uuid, p_reason text default 'auto') returns uuid
language plpgsql security definer set search_path = public as $$
declare o organizations; v_team text; v_cap int := coalesce((setting('assistant_max_customers_per_manager'))::text::int, 50); v_staff uuid; v_existing uuid;
begin
  select staff_user_id into v_existing from account_managers where org_id = p_org;
  if v_existing is not null then return v_existing; end if;
  select * into o from organizations where id = p_org;
  v_team := coalesce(setting('assistant_team_country_map') ->> o.country, setting('assistant_team_country_map') ->> 'default', 'Sourcing');
  -- sourcing agents in the mapped team, not out of office, under the cap, least loaded first, then least recently assigned
  select ur.user_id into v_staff
  from user_roles ur join profiles p on p.id = ur.user_id
  where ur.role_code = 'sourcing_agent' and p.active and not p.out_of_office and (coalesce(p.team, 'Sourcing') = v_team)
    and (select count(*) from account_managers a where a.staff_user_id = ur.user_id) < v_cap
  order by (select count(*) from account_managers a where a.staff_user_id = ur.user_id) asc,
           (select max(assigned_at) from account_managers a where a.staff_user_id = ur.user_id) asc nulls first
  limit 1;
  if v_staff is null then
    -- fall back to any sourcing agent under the cap
    select ur.user_id into v_staff from user_roles ur join profiles p on p.id = ur.user_id
    where ur.role_code = 'sourcing_agent' and p.active and not p.out_of_office and (select count(*) from account_managers a where a.staff_user_id = ur.user_id) < v_cap
    order by (select count(*) from account_managers a where a.staff_user_id = ur.user_id) asc limit 1;
  end if;
  if v_staff is null then return null; end if;
  insert into account_managers(org_id, customer_user_id, staff_user_id, team, assigned_by, reason)
    values (p_org, (select user_id from org_members where org_id = p_org order by created_at limit 1), v_staff, v_team, auth.uid(), p_reason);
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), 'assistant.assigned', 'organizations', p_org::text, jsonb_build_object('staff', v_staff, 'team', v_team, 'reason', p_reason));
  -- welcome e-mail + dashboard notification (SPEC §20.3, §21.1 #1); backfills stay silent
  if p_reason is distinct from 'backfill' then
    perform emit_event('account_manager.assigned', 'organization', p_org, jsonb_build_object(
      'org_id', p_org, 'staff_user_id', v_staff, 'team', v_team,
      'manager_name', (select full_name from profiles where id = v_staff)));
  end if;
  return v_staff;
end $$;
revoke all on function assign_account_manager(uuid, text) from public, anon, authenticated;

do $$
begin
  if to_regclass('public.order_events') is not null then
    alter table public.order_events add column if not exists trace_id text;
    create index if not exists order_events_trace_idx on public.order_events (trace_id) where trace_id is not null;
    drop trigger if exists trg_stamp_trace on public.order_events;
    create trigger trg_stamp_trace before insert on public.order_events for each row execute function public.stamp_trace('');
  end if;
end $$;
