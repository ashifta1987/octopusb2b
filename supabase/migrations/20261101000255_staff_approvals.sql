-- ODS T8 · Two-person approvals for staff money actions (master prompt Part 7.7, Part 8 "approvals" row). DRAFT on top of 254.
--
-- WHAT EXISTS TODAY (unchanged by this migration — no existing function, trigger or table is altered):
--  · finance_approvals (core) — refunds, credit notes, supplier payouts, adjustments, withdrawals. request_finance_approval
--    (finance:create or support:create) records it; decide_finance_approval (finance:approve, step-up 2FA, never the requester:
--    MAKER_CANNOT_APPROVE; above setting finance_approval_limit_cents (USD) only an admin: OVER_LIMIT_NEEDS_ADMIN) decides AND
--    posts the money (journal / credit note / payout). Table CHECK finance_approvals_two_person (DS10, 246).
--    DS10/DS16 dropship refunds above dropship.claim_second_approver_over_cents raise a finance_approvals row too
--    (ds10_refund_approve or decide_finance_approval; trigger trg_ds10_finance_approval_sync runs the refund).
--  · escrow_hold_approvals (207/208) — payment-protection releases / refunds above payments.approval_threshold_cents;
--    decide_escrow_hold_approval (finance:approve, not the proposer) decides and runs the escrow action.
--  · customer_credit_terms (207/209) — Pay-later limits, ALWAYS two-person; decide_customer_credit_terms.
--  · Other domain two-person rules (fee_versions, wh_rate_versions, tk_*_fees, rate_card_imports, dropship_plan_changes,
--    dropship_setting_changes, supplier_bank_detail_changes, backups restore …) stay where they are.
--
-- WHAT THIS ADDS:
--  1. staff_approvals — the approval record for staff money actions that have NO approval step yet (Part 7.7 list: payments
--     recorded by staff, refunds, credit notes, supplier payments, wallet adjustments, Pay-later switches) above the limit in
--     settings ('office.second_approver_over_cents', USD cents, seeded 250000 = US$ 2,500 as in the designs; a missing or
--     unreadable setting means EVERY amount needs a second person — fail safe). It ONLY records requests and decisions:
--     no journal, ledger, wallet, payment or order row is written by anything here. A T9 screen asks for an approval first
--     (staff_approval_request), a different Finance approver decides (staff_approval_decide), the screen checks
--     staff_approval_ready() before it calls TODAY's money function unchanged, then marks the approval used
--     (staff_approval_mark_executed).
--  2. Two people enforced by the DATABASE: CHECK staff_approvals_two_person (approved_by <> requested_by) + the RPC guard
--     (MAKER_CANNOT_APPROVE) + a trigger that refuses deletes and any rewrite of a decided row.
--  3. Who: request = staff with finance:create, wallet:create, support:create or finance:approve; decide = finance:approve
--     (admins have every permission) on a fresh 2FA (require_step_up). Rejecting needs a reason.
--  4. Audit: every request / decision / execution → audit_log (actor, time, before, after, org, service 'finance', IP when the
--     server passes it). IPs are not readable through the table grants.
--  5. office_approval_queue(): ONE read model for the T9 Approvals screen over staff_approvals + finance_approvals +
--     escrow_hold_approvals + customer_credit_terms, with can_decide and decide_rpc (the existing decide function for the
--     three existing tables — T9 calls those unchanged). staff_approvals_readiness(): how many Finance approvers exist
--     ("The owner must add a second Finance user before go-live").
-- Error codes: NOT_SIGNED_IN, FORBIDDEN, STEP_UP_REQUIRED, INVALID_INPUT: <what>, INVALID_AMOUNT, REASON_REQUIRED, APPROVAL_PENDING: <code>,
--   NOT_FOUND, INVALID_TRANSITION, MAKER_CANNOT_APPROVE, APPROVALS_APPEND_ONLY, APPROVAL_DECIDED.
-- Down: supabase/migrations/down/20261101000255_staff_approvals.down.sql

-- ───────────────────────── 1. table ─────────────────────────
do $$ begin
  create type public.staff_approval_status as enum ('waiting', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create sequence if not exists public.seq_staff_approval;

create table if not exists public.staff_approvals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('APR-' || lpad(nextval('public.seq_staff_approval')::text, 5, '0')),
  kind text not null check (kind in ('payment', 'refund', 'credit_note', 'supplier_payment', 'wallet_adjustment', 'pay_later')),
  status public.staff_approval_status not null default 'waiting',
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_usd_minor bigint not null check (amount_usd_minor >= 0),
  limit_usd_minor bigint not null check (limit_usd_minor >= 0),
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  org_id uuid references public.organizations(id) on delete set null,
  ref_type text not null check (ref_type ~ '^[a-z][a-z_]{1,39}$'),
  ref_id text not null check (length(ref_id) between 1 and 120),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8192),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  requested_ip inet,
  approved_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  decided_ip inet,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  executed_at timestamptz,
  executed_by uuid references auth.users(id) on delete restrict,
  -- the person who recorded the action can never be the one who decides it
  constraint staff_approvals_two_person check (approved_by is null or approved_by <> requested_by),
  constraint staff_approvals_decision check ((status = 'waiting') = (approved_by is null and decided_at is null)),
  constraint staff_approvals_reject_reason check (status <> 'rejected' or length(btrim(coalesce(decision_note, ''))) >= 3),
  constraint staff_approvals_executed check ((executed_at is null) = (executed_by is null) and (executed_at is null or status = 'approved'))
);
create unique index if not exists staff_approvals_one_waiting on public.staff_approvals (kind, ref_type, ref_id) where status = 'waiting';
create index if not exists staff_approvals_status_idx on public.staff_approvals (status, requested_at desc);
create index if not exists staff_approvals_requested_by_idx on public.staff_approvals (requested_by);
create index if not exists staff_approvals_org_idx on public.staff_approvals (org_id);
comment on table public.staff_approvals is 'ODS T8: two-person approvals for staff money actions above office.second_approver_over_cents (Part 7.7). Records only — moves no money. Written by staff_approval_* functions.';

-- append-only facts: no delete; a decided row only gets its "executed" stamp once; amounts / requester never change
create or replace function public.staff_approvals_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'APPROVALS_APPEND_ONLY: approvals are never deleted'; end if;
  if (new.code, new.kind, new.amount_minor, new.currency, new.amount_usd_minor, new.limit_usd_minor, new.reason, new.org_id, new.ref_type,
      new.ref_id, new.details, new.requested_by, new.requested_at, new.requested_ip)
     is distinct from
     (old.code, old.kind, old.amount_minor, old.currency, old.amount_usd_minor, old.limit_usd_minor, old.reason, old.org_id, old.ref_type,
      old.ref_id, old.details, old.requested_by, old.requested_at, old.requested_ip) then
    raise exception 'APPROVAL_DECIDED: the request itself cannot be changed';
  end if;
  if old.status <> 'waiting' and (new.status, new.approved_by, new.decided_at, new.decided_ip, new.decision_note)
       is distinct from (old.status, old.approved_by, old.decided_at, old.decided_ip, old.decision_note) then
    raise exception 'APPROVAL_DECIDED: a decision cannot be changed';
  end if;
  if old.executed_at is not null and (new.executed_at, new.executed_by) is distinct from (old.executed_at, old.executed_by) then
    raise exception 'APPROVAL_DECIDED: already used';
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_approvals_guard on public.staff_approvals;
create trigger trg_staff_approvals_guard before update or delete on public.staff_approvals for each row execute function public.staff_approvals_guard();

-- ───────────────────────── 2. RLS + grants ─────────────────────────
alter table public.staff_approvals enable row level security;
revoke all on table public.staff_approvals from public, anon, authenticated;
grant all on table public.staff_approvals to service_role;
grant usage on sequence public.seq_staff_approval to service_role;
drop policy if exists staff_approvals_read on public.staff_approvals;
-- Finance (view / approve) reads all; any other staff member reads the requests they made
create policy staff_approvals_read on public.staff_approvals for select to authenticated
  using ((select public.is_staff()) and (requested_by = (select auth.uid()) or public.can('finance', 'view') or public.can('finance', 'approve')));
grant select (id, code, kind, status, amount_minor, currency, amount_usd_minor, limit_usd_minor, reason, org_id, ref_type, ref_id, details,
              requested_by, requested_at, approved_by, decided_at, decision_note, executed_at, executed_by)
  on table public.staff_approvals to authenticated;

-- ───────────────────────── 3. setting ─────────────────────────
insert into public.site_settings (key, value, description, is_public)
values ('office.second_approver_over_cents', '250000'::jsonb,
        'Back Office: staff money actions above this amount (USD cents) need a second, different Finance approver (Part 7.7).', false)
on conflict (key) do nothing;

-- ───────────────────────── 4. helpers ─────────────────────────
-- the limit in USD cents; missing / unreadable → 0 (every amount needs a second person)
create or replace function public.staff_approval_limit_minor()
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(v) in ('number', 'string') and (v #>> '{}') ~ '^\d{1,15}$' then (v #>> '{}')::bigint end
                     from (select public.setting('office.second_approver_over_cents') v) s), 0);
$$;

-- an amount in USD cents (the limit is set in USD), with today's converter
create or replace function public.staff_approval_usd(p_amount bigint, p_currency text)
returns bigint language sql stable security definer set search_path = public as $$
  select case when upper(p_currency) = 'USD' then p_amount else public.convert_amount(p_amount, upper(p_currency), 'USD') end;
$$;

-- the client IP the server passes ("IP when available"); anything that is not an address → null
create or replace function public.staff_approval_ip(p_ip text)
returns inet language plpgsql immutable set search_path = public as $$
begin
  if p_ip is null or btrim(p_ip) = '' or length(p_ip) > 64 then return null; end if;
  return btrim(split_part(p_ip, ',', 1))::inet;
exception when others then
  return null;
end $$;

-- one audit row per step: who (actor), when, before / after, org, service, IP
create or replace function public.staff_approval_audit(p_action text, p_before public.staff_approvals, p_after public.staff_approvals, p_ip inet)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, org_id, service, before, after, details)
  values (auth.uid(), p_action, 'staff_approvals', p_after.id::text, p_after.org_id, 'finance',
          case when p_before.id is null then null
               else jsonb_build_object('status', p_before.status, 'approved_by', p_before.approved_by, 'decided_at', p_before.decided_at,
                                       'executed_at', p_before.executed_at) end,
          jsonb_build_object('status', p_after.status, 'approved_by', p_after.approved_by, 'decided_at', p_after.decided_at,
                             'executed_at', p_after.executed_at, 'decision_note', p_after.decision_note),
          jsonb_build_object('code', p_after.code, 'kind', p_after.kind, 'amount_minor', p_after.amount_minor, 'currency', p_after.currency,
                             'amount_usd_minor', p_after.amount_usd_minor, 'limit_usd_minor', p_after.limit_usd_minor,
                             'ref_type', p_after.ref_type, 'ref_id', p_after.ref_id, 'ip', host(p_ip)));
$$;

-- ───────────────────────── 5. request ─────────────────────────
-- Below or at the limit: nothing is recorded ({required:false}) and the caller goes on with today's flow.
-- Above: one waiting approval per (kind, ref); asking again with the same amount returns it (duplicate:true).
create or replace function public.staff_approval_request(
  p_kind text, p_amount_minor bigint, p_currency text, p_reason text, p_ref_type text, p_ref_id text,
  p_org uuid default null, p_details jsonb default '{}'::jsonb, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_cur text := upper(btrim(coalesce(p_currency, ''))); v_reason text := btrim(coalesce(p_reason, ''));
  v_ref_type text := btrim(coalesce(p_ref_type, '')); v_ref_id text := btrim(coalesce(p_ref_id, ''));
  v_usd bigint; v_limit bigint := public.staff_approval_limit_minor(); a public.staff_approvals; e public.staff_approvals;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not public.is_staff() or not (public.can('finance', 'create') or public.can('wallet', 'create') or public.can('support', 'create')
                                   or public.can('finance', 'approve')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind is null or p_kind not in ('payment', 'refund', 'credit_note', 'supplier_payment', 'wallet_adjustment', 'pay_later') then
    raise exception 'INVALID_INPUT: kind';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT: currency'; end if;
  if length(v_reason) < 5 then raise exception 'REASON_REQUIRED: say why (5 characters or more)'; end if;
  if length(v_reason) > 1000 then raise exception 'INVALID_INPUT: reason longer than 1000 characters'; end if;
  if v_ref_type !~ '^[a-z][a-z_]{1,39}$' or length(v_ref_id) not between 1 and 120 then raise exception 'INVALID_INPUT: reference'; end if;
  if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' or octet_length(coalesce(p_details, '{}'::jsonb)::text) > 8192 then
    raise exception 'INVALID_INPUT: details';
  end if;
  if p_org is not null and not exists (select 1 from public.organizations where id = p_org) then raise exception 'NOT_FOUND: company'; end if;
  v_usd := public.staff_approval_usd(p_amount_minor, v_cur);
  if v_usd <= v_limit then
    return jsonb_build_object('required', false, 'limit_minor', v_limit, 'amount_usd_minor', v_usd);
  end if;
  select * into e from public.staff_approvals where kind = p_kind and ref_type = v_ref_type and ref_id = v_ref_id and status = 'waiting' for update;
  if e.id is not null then
    if e.amount_minor = p_amount_minor and e.currency = v_cur then
      return jsonb_build_object('required', true, 'id', e.id, 'code', e.code, 'status', e.status, 'limit_minor', e.limit_usd_minor,
                                'amount_usd_minor', e.amount_usd_minor, 'duplicate', true);
    end if;
    raise exception 'APPROVAL_PENDING: % is already waiting for a decision', e.code;
  end if;
  insert into public.staff_approvals (kind, amount_minor, currency, amount_usd_minor, limit_usd_minor, reason, org_id, ref_type, ref_id, details,
                                      requested_by, requested_ip)
  values (p_kind, p_amount_minor, v_cur, v_usd, v_limit, v_reason, p_org, v_ref_type, v_ref_id, coalesce(p_details, '{}'::jsonb),
          v_uid, public.staff_approval_ip(p_ip))
  returning * into a;
  perform public.staff_approval_audit('approval.requested', null, a, a.requested_ip);
  return jsonb_build_object('required', true, 'id', a.id, 'code', a.code, 'status', a.status, 'limit_minor', v_limit, 'amount_usd_minor', v_usd,
                            'duplicate', false);
end $$;

-- ───────────────────────── 6. decide ─────────────────────────
create or replace function public.staff_approval_decide(p_id uuid, p_approve boolean, p_note text default null, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.staff_approvals; b public.staff_approvals; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  perform public.require_step_up();
  if not (public.is_staff() and public.can('finance', 'approve')) then raise exception 'FORBIDDEN'; end if;
  if p_approve is null then raise exception 'INVALID_INPUT: approve or reject'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'INVALID_INPUT: note longer than 1000 characters'; end if;
  select * into b from public.staff_approvals where id = p_id for update;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if b.status <> 'waiting' then raise exception 'INVALID_TRANSITION'; end if;
  if b.requested_by = v_uid then raise exception 'MAKER_CANNOT_APPROVE: a different person must decide what you recorded'; end if;
  if not p_approve and length(coalesce(v_note, '')) < 3 then raise exception 'REASON_REQUIRED: say why it is rejected'; end if;
  update public.staff_approvals
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.staff_approval_status,
         approved_by = v_uid, decided_at = now(), decided_ip = public.staff_approval_ip(p_ip), decision_note = v_note
   where id = p_id returning * into a;
  perform public.staff_approval_audit(case when p_approve then 'approval.approved' else 'approval.rejected' end, b, a, a.decided_ip);
  return jsonb_build_object('id', a.id, 'code', a.code, 'status', a.status, 'decided_at', a.decided_at);
end $$;

-- ───────────────────────── 7. use (T9 money screens) ─────────────────────────
-- the approved, not-yet-used approval that covers this action (amount at least p_amount_minor), else null
create or replace function public.staff_approval_ready(p_kind text, p_ref_type text, p_ref_id text, p_amount_minor bigint)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.staff_approvals a
   where public.is_staff() and a.kind = p_kind and a.ref_type = p_ref_type and a.ref_id = p_ref_id and a.status = 'approved'
     and a.executed_at is null and a.amount_minor >= coalesce(p_amount_minor, 0)
   order by a.decided_at desc limit 1;
$$;

-- after today's money function has run: the approval is used (once). The requester or a Finance approver stamps it.
create or replace function public.staff_approval_mark_executed(p_id uuid, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.staff_approvals; b public.staff_approvals;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  select * into b from public.staff_approvals where id = p_id for update;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if not (b.requested_by = v_uid or public.can('finance', 'approve')) then raise exception 'FORBIDDEN'; end if;
  if b.status <> 'approved' or b.executed_at is not null then raise exception 'INVALID_TRANSITION'; end if;
  update public.staff_approvals set executed_at = now(), executed_by = v_uid where id = p_id returning * into a;
  perform public.staff_approval_audit('approval.executed', b, a, public.staff_approval_ip(p_ip));
  return jsonb_build_object('id', a.id, 'code', a.code, 'executed_at', a.executed_at);
end $$;

-- ───────────────────────── 8. one queue for the Approvals screen ─────────────────────────
-- p_status: waiting | decided | all. Reads the existing approval tables as they are; decide_rpc names the function that decides
-- each row (the existing ones are called unchanged by the server code). Finance viewers / approvers only.
create or replace function public.office_approval_queue(p_status text default 'waiting', p_limit integer default 100)
returns table (
  source text, id uuid, code text, kind text, status text, amount_minor bigint, currency text, reason text, org_id uuid, org_name text,
  ref_type text, ref_id text, requested_by uuid, requested_by_name text, requested_at timestamptz, decided_by uuid, decided_by_name text,
  decided_at timestamptz, can_decide boolean, decide_rpc text)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_can boolean;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not (public.is_staff() and (public.can('finance', 'view') or public.can('finance', 'approve'))) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_status, '') not in ('waiting', 'decided', 'all') then raise exception 'INVALID_INPUT: status'; end if;
  v_can := public.can('finance', 'approve');
  return query
  with q as (
    select 'staff_approvals'::text src, a.id, a.code, a.kind, a.status::text st, a.amount_minor amt, a.currency::text cur, a.reason rsn,
           a.org_id org, a.ref_type rt, a.ref_id ri, a.requested_by rb, a.requested_at ra, a.approved_by db, a.decided_at da,
           'staff_approval_decide'::text rpc
      from public.staff_approvals a
    union all
    select 'finance_approvals', f.id, null, f.kind,
           case f.status::text when 'requested' then 'waiting' when 'rejected' then 'rejected' else 'approved' end,
           f.amount_cents, f.currency::text, f.reason, f.org_id,
           case when f.order_id is not null then 'order' when f.supplier_id is not null then 'supplier' end,
           coalesce(f.order_id, f.supplier_id)::text, f.requested_by, f.created_at, f.approved_by, f.decided_at, 'decide_finance_approval'
      from public.finance_approvals f
    union all
    select 'escrow_hold_approvals', e.id, null, 'escrow_' || e.action,
           case e.status when 'pending' then 'waiting' else e.status end,
           e.amount_cents, h.currency::text, e.reason, h.org_id, 'escrow_hold', e.hold_id::text, e.proposed_by, e.created_at,
           e.approved_by, e.decided_at, 'decide_escrow_hold_approval'
      from public.escrow_hold_approvals e join public.escrow_holds h on h.id = e.hold_id
    union all
    select 'customer_credit_terms', c.id, null, 'pay_later',
           case c.status when 'pending_approval' then 'waiting' when 'rejected' then 'rejected' else 'approved' end,
           c.credit_limit_cents, c.currency::text, coalesce(nullif(btrim(c.note), ''), 'Pay-later credit limit · ' || c.net_days || ' days'),
           c.org_id, 'organization', c.org_id::text, c.proposed_by, c.proposed_at, c.approved_by, c.approved_at, 'decide_customer_credit_terms'
      from public.customer_credit_terms c
  )
  select q.src, q.id, q.code, q.kind, q.st, q.amt, q.cur, q.rsn, q.org, o.name::text, q.rt, q.ri, q.rb, pr.full_name::text, q.ra,
         q.db, pd.full_name::text, q.da, (q.st = 'waiting' and v_can and q.rb is distinct from v_uid), q.rpc
    from q
    left join public.organizations o on o.id = q.org
    left join public.profiles pr on pr.id = q.rb
    left join public.profiles pd on pd.id = q.db
   where p_status = 'all' or (p_status = 'waiting' and q.st = 'waiting') or (p_status = 'decided' and q.st <> 'waiting')
   order by (q.st = 'waiting') desc, coalesce(q.da, q.ra) desc, q.id
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

-- "Second approver needed": how many different people can approve money (finance:approve or admin, active profiles)
create or replace function public.staff_approvals_readiness()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  select count(distinct ur.user_id) into v_n
    from public.user_roles ur join public.profiles p on p.id = ur.user_id and p.active
   where ur.role_code = 'admin'
      or exists (select 1 from public.role_permissions rp where rp.role_code = ur.role_code and rp.area = 'finance' and rp.action = 'approve');
  return jsonb_build_object('approvers', v_n, 'second_approver_needed', v_n < 2, 'limit_minor', public.staff_approval_limit_minor(), 'currency', 'USD');
end $$;

-- ───────────────────────── 9. function grants ─────────────────────────
revoke all on function public.staff_approvals_guard() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['staff_approval_limit_minor()', 'staff_approval_usd(bigint,text)', 'staff_approval_ip(text)',
    'staff_approval_audit(text,staff_approvals,staff_approvals,inet)',
    'staff_approval_request(text,bigint,text,text,text,text,uuid,jsonb,text)', 'staff_approval_decide(uuid,boolean,text,text)',
    'staff_approval_ready(text,text,text,bigint)', 'staff_approval_mark_executed(uuid,text)',
    'office_approval_queue(text,integer)', 'staff_approvals_readiness()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['staff_approval_request(text,bigint,text,text,text,text,uuid,jsonb,text)', 'staff_approval_decide(uuid,boolean,text,text)',
    'staff_approval_ready(text,text,text,bigint)', 'staff_approval_mark_executed(uuid,text)',
    'office_approval_queue(text,integer)', 'staff_approvals_readiness()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
