-- DRAFT — NOT APPLIED. ODS T3 · company interests ("What would you like to do?" on /welcome/setup, Part 4.5).
-- Status: drafted by the T3 AUTH builder on 27 Nov 2026 for the owner's review. It is NOT in the approved migration plan:
-- do not run db-migrate with it until the owner says "go" (PART 1 rule 3). The app already works without it:
-- app/ods/(auth)/welcome/setup/actions.ts calls save_company_interests() only if it exists and skips the interests when
-- the function is missing (PGRST202 / 42883).
--  1. company_interests: which of the six services a company wants (org_id, service, created_at). Read by the company's
--     members and by staff with customers:view; written ONLY by the RPC below (no insert/update/delete policies).
--  2. save_company_interests(p_services text[]): replaces the caller's OWN company's interests (owner or buyer of that
--     company, found via org_members; staff are refused). Unknown service keys are ignored. Returns the saved list.
-- No money, no white-label data. Down: down/20261101000252_company_interests.down.sql.

create table if not exists public.company_interests (
  org_id uuid not null references public.organizations(id) on delete cascade,
  service text not null check (service in ('sourcing', 'pools', 'dropship', '3pl', 'turnkey', 'brand')),
  created_at timestamptz not null default now(),
  primary key (org_id, service)
);
comment on table public.company_interests is 'ODS T3: services a company chose at first-time setup (decides which shop section shows first; account manager follow-up). Written only by save_company_interests().';

alter table public.company_interests enable row level security;
drop policy if exists company_interests_read on public.company_interests;
create policy company_interests_read on public.company_interests for select to authenticated
  using (org_id in (select my_org_ids()) or can('customers', 'view'));

create or replace function public.save_company_interests(p_services text[])
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_out text[];
begin
  if v_uid is null or user_is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  select org_id into v_org from public.org_members where user_id = v_uid and member_role in ('owner', 'buyer') order by (member_role = 'owner') desc limit 1;
  if v_org is null then raise exception 'NO_COMPANY: Set up your company first.'; end if;
  delete from public.company_interests where org_id = v_org;
  insert into public.company_interests (org_id, service)
    select distinct v_org, s from unnest(coalesce(p_services, '{}')) s
     where s in ('sourcing', 'pools', 'dropship', '3pl', 'turnkey', 'brand');
  select coalesce(array_agg(service order by service), '{}') into v_out from public.company_interests where org_id = v_org;
  perform write_audit('company.interests_saved', 'organizations', v_org::text, jsonb_build_object('services', v_out));
  return v_out;
end $$;

revoke all on function public.save_company_interests(text[]) from public, anon;
grant execute on function public.save_company_interests(text[]) to authenticated, service_role;
