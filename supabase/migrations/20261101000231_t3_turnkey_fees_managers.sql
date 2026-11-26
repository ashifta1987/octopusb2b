-- 20261101000231_t3_turnkey_fees_managers.sql
-- Turnkey T3 (docs/design/turnkey-v2: SetFee "staff set the exact fee per client; a fee above 2x the starting fee needs
-- admin approval", "each paid phase stays locked until the client pays", Account manager "one named contact per project,
-- with cover when away", AccountManagers; programme decision D5: the 2x admin-approval rule applies to SERVICE FEES only).
--  1. tk_project_fees: the exact fee per client project, phase and service (integer cents, USD), in versions. Staff
--     (Turnkey editors, TK division, 2FA) set it. A fee up to 2x the service's starting fee (tk_services.from_cents) is
--     active at once; above 2x — or when the service has no starting fee — it waits for ONE admin who is not the proposer
--     (two-person rule: DB constraints + function checks). Rejection needs a reason. A change is a new version under the
--     same rule. Nothing is deleted (a trigger refuses deletes and rewrites of decided facts).
--  2. Payment: when a fee becomes active a service proforma is issued to the client company (same steps and numbering as
--     issue_service_proforma: documents + invoice_lines + post_document_receivable + audit, service 'turnkey' → TK
--     division, revenue stream 'turnkey'; done by the internal tk_issue_fee_proforma because issue_service_proforma
--     only lets Finance / account managers issue). The client pays it like every other service proforma
--     (pay_service_proforma: wallet by the client, bank transfer recorded by Finance). Paid = fully paid. A superseded
--     unpaid proforma is voided with a balanced reversal journal.
--  3. Gate: tk_move_project_stage refuses to move forward into a gated phase (tk_stage_fee_rules: Consultation, Design,
--     Sourcing, Production and QC) until that phase has an active fee and every active fee of the phase is paid.
--     Quote and deposit / Shipment / Handover are not gated here (deposit = T4 quotes, D5; shipping later).
--  4. Account managers: optional cover manager with a cover period (from/to, inclusive, UTC dates) on
--     tk_client_project_staff. The client sees the active one (cover during the period). Managers (primary, or cover
--     during the period) can view the projects they manage; role account_manager gets turnkey:view (role_permissions).
-- Every write goes through a security definer function (search_path = public; not for anon); every change is audited.
-- Down: supabase/migrations/down/20261101000231_t3_turnkey_fees_managers.down.sql

-- ───────── 0. existing objects extended ─────────
-- turnkey service proformas: invoice lines with service 'turnkey' (division TK through division_code_for_service('turnkey'))
alter table public.invoice_lines drop constraint if exists invoice_lines_service_check;
alter table public.invoice_lines add constraint invoice_lines_service_check
  check (service = any (array['sourcing'::text, 'dropship'::text, 'warehouse'::text, 'brand'::text, 'wallet'::text, 'turnkey'::text]));

-- client history: fee set / account manager cover
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date', 'fee', 'manager'));

-- cover manager (staff-only table)
alter table public.tk_client_project_staff add column if not exists cover_id uuid references auth.users(id) on delete set null;
alter table public.tk_client_project_staff add column if not exists cover_from date;
alter table public.tk_client_project_staff add column if not exists cover_to date;
alter table public.tk_client_project_staff add column if not exists cover_set_at timestamptz;
alter table public.tk_client_project_staff drop constraint if exists tk_client_project_staff_cover_dates;
alter table public.tk_client_project_staff add constraint tk_client_project_staff_cover_dates
  check (cover_id is null or (cover_from is not null and cover_to is not null and cover_to >= cover_from));
alter table public.tk_client_project_staff drop constraint if exists tk_client_project_staff_cover_not_owner;
alter table public.tk_client_project_staff add constraint tk_client_project_staff_cover_not_owner
  check (cover_id is null or cover_id is distinct from owner_id);
create index if not exists tk_client_project_staff_cover_idx on public.tk_client_project_staff (cover_id);

-- account managers may open Turnkey (RLS limits them to the projects they manage unless they are TK division members)
insert into public.role_permissions (role_code, area, action) values ('account_manager', 'turnkey', 'view') on conflict do nothing;

-- ───────── 1. which phases are gated, and the default service per phase ─────────
create table if not exists public.tk_stage_fee_rules (
  stage text primary key references public.tk_stages(code),
  default_service_code text references public.tk_services(code) on update cascade on delete set null,
  gated boolean not null
);
comment on table public.tk_stage_fee_rules is 'Turnkey T3: per paid phase, the default service for the fee and whether entering the phase needs an approved and paid fee.';
insert into public.tk_stage_fee_rules (stage, default_service_code, gated) values
  ('consultation', 'consultation', true),
  ('design', 'layout_drawing', true),
  ('sourcing', 'sourcing_quotes', true),
  ('production_qc', 'factory_audit', true),
  ('quote_deposit', null, false),
  ('shipment', null, false),
  ('handover', null, false)
on conflict (stage) do nothing;
alter table public.tk_stage_fee_rules enable row level security;
revoke all on public.tk_stage_fee_rules from public, anon, authenticated;
grant select on public.tk_stage_fee_rules to authenticated;
grant all on public.tk_stage_fee_rules to service_role;
drop policy if exists tk_stage_fee_rules_read on public.tk_stage_fee_rules;
create policy tk_stage_fee_rules_read on public.tk_stage_fee_rules for select to authenticated using (true);

-- ───────── 2. fees (versions; 2x rule; one admin, not the proposer, above 2x) ─────────
create table if not exists public.tk_project_fees (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  stage text not null references public.tk_stages(code),
  service_code text references public.tk_services(code) on update cascade on delete restrict,
  version integer not null check (version >= 1),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  starting_cents bigint check (starting_cents is null or starting_cents > 0),
  needs_approval boolean not null,
  status text not null check (status in ('pending_approval', 'active', 'superseded', 'rejected', 'withdrawn')),
  note text check (note is null or length(note) <= 1000),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete restrict,
  rejected_at timestamptz,
  reject_reason text check (reject_reason is null or length(reject_reason) <= 500),
  withdrawn_at timestamptz,
  document_id uuid references public.documents(id) on delete restrict,
  effective_from timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  -- the design rule, frozen at proposal: approval when above 2x the starting fee, or when there is no starting fee
  constraint tk_project_fees_rule check (needs_approval = (starting_cents is null or amount_cents > 2 * starting_cents)),
  constraint tk_project_fees_two_person check (approved_by is null or approved_by <> proposed_by),
  constraint tk_project_fees_approval_time check ((approved_by is null) = (approved_at is null)),
  constraint tk_project_fees_auto_no_approver check (needs_approval or (approved_by is null and rejected_by is null and status not in ('pending_approval', 'rejected'))),
  constraint tk_project_fees_active_ok check (status not in ('active', 'superseded') or (effective_from is not null and document_id is not null and (not needs_approval or approved_by is not null))),
  constraint tk_project_fees_pending_not_final check (status <> 'pending_approval' or (approved_by is null and rejected_by is null and document_id is null)),
  constraint tk_project_fees_rejected_reason check (status <> 'rejected' or (rejected_by is not null and rejected_at is not null and approved_by is null and nullif(btrim(coalesce(reject_reason, '')), '') is not null)),
  constraint tk_project_fees_paid_stage check (stage <> 'enquiry')
);
create unique index if not exists tk_project_fees_version_idx on public.tk_project_fees (project_id, stage, coalesce(service_code, '*'), version);
create unique index if not exists tk_project_fees_one_active_idx on public.tk_project_fees (project_id, stage, coalesce(service_code, '*')) where status = 'active';
create unique index if not exists tk_project_fees_one_pending_idx on public.tk_project_fees (project_id, stage, coalesce(service_code, '*')) where status = 'pending_approval';
create index if not exists tk_project_fees_pending_idx on public.tk_project_fees (proposed_at) where status = 'pending_approval';
create index if not exists tk_project_fees_document_idx on public.tk_project_fees (document_id);
create index if not exists tk_project_fees_proposed_by_idx on public.tk_project_fees (proposed_by);
create index if not exists tk_project_fees_approved_by_idx on public.tk_project_fees (approved_by);
create index if not exists tk_project_fees_rejected_by_idx on public.tk_project_fees (rejected_by);
comment on table public.tk_project_fees is 'Turnkey T3: exact fee per client project, phase and service (versions). Up to 2x the starting fee it is active at once; above 2x (or with no starting fee) one admin who is not the proposer approves it. Customers read active fees (public columns only); proposer, approver, notes and reasons are read by staff through tk_list_project_fees().';
alter table public.tk_project_fees enable row level security;
revoke all on public.tk_project_fees from public, anon, authenticated;
-- customer-safe columns only; proposer / approver / note / reason / starting fee stay staff-only (definer reads)
grant select (id, project_id, stage, service_code, version, amount_cents, currency, status, document_id, effective_from, created_at)
  on public.tk_project_fees to authenticated;
grant all on public.tk_project_fees to service_role;
drop policy if exists tk_project_fees_read on public.tk_project_fees;
-- the project's own policy decides who sees the project; customers see active fees only
create policy tk_project_fees_read on public.tk_project_fees for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id) and (status = 'active' or is_staff()));

-- history is never rewritten: decided facts are frozen and rows are never deleted (except with their project, by the owner)
create or replace function public.tk_project_fees_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;   -- cascade from a deleted project (owner-only clean-up)
    raise exception 'FEE_HISTORY_KEPT: fees are never deleted';
  end if;
  if new.project_id is distinct from old.project_id or new.stage is distinct from old.stage or new.service_code is distinct from old.service_code
     or new.version is distinct from old.version or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
     or new.starting_cents is distinct from old.starting_cents or new.needs_approval is distinct from old.needs_approval
     or new.proposed_by is distinct from old.proposed_by or new.proposed_at is distinct from old.proposed_at or new.note is distinct from old.note
     or (old.approved_by is not null and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at))
     or (old.document_id is not null and new.document_id is distinct from old.document_id)
     or (old.status in ('rejected', 'withdrawn', 'superseded') and to_jsonb(new) is distinct from to_jsonb(old)) then
    raise exception 'FEE_HISTORY_KEPT: a proposed fee cannot be rewritten; propose a new version';
  end if;
  if old.status = 'active' and new.status not in ('active', 'superseded') then raise exception 'FEE_HISTORY_KEPT: an active fee can only be superseded'; end if;
  return new;
end $$;
revoke all on function public.tk_project_fees_guard() from public, anon, authenticated;
drop trigger if exists trg_tk_project_fees_guard on public.tk_project_fees;
create trigger trg_tk_project_fees_guard before update or delete on public.tk_project_fees for each row execute function public.tk_project_fees_guard();

-- ───────── 3. helpers ─────────
-- the manager the client deals with today: the cover during the cover period, else the primary account manager
create or replace function public.tk_active_manager(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when s.cover_id is not null and current_date between s.cover_from and s.cover_to then s.cover_id else s.owner_id end
    from public.tk_client_project_staff s where s.project_id = p_project;
$$;
revoke all on function public.tk_active_manager(uuid) from public, anon, authenticated;
grant execute on function public.tk_active_manager(uuid) to service_role;

-- the signed-in staff member manages this project (primary manager, or cover during the cover period), on 2FA
create or replace function public.tk_is_project_manager(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and exists (
    select 1 from public.tk_client_project_staff s
     where s.project_id = p_project
       and (s.owner_id = auth.uid() or (s.cover_id = auth.uid() and current_date between s.cover_from and s.cover_to)));
$$;
revoke all on function public.tk_is_project_manager(uuid) from public, anon;
grant execute on function public.tk_is_project_manager(uuid) to authenticated, service_role;

-- staff who may read a project (same rule as the RLS policy below)
create or replace function public.tk_staff_can_view(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_client_projects p where p.id = p_project
                   and is_staff() and ((can('turnkey', 'view') and in_division(p.division_id)) or public.tk_is_project_manager(p.id)));
$$;
revoke all on function public.tk_staff_can_view(uuid) from public, anon;
grant execute on function public.tk_staff_can_view(uuid) to authenticated, service_role;

-- a fee is paid when its proforma is fully paid (pay_service_proforma: wallet, or bank transfer recorded by Finance)
create or replace function public.tk_fee_is_paid(p_document uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select d.paid_cents >= d.amount_cents and d.amount_cents > 0 and coalesce(d.status, '') not in ('void', 'cancelled')
                     from public.documents d where d.id = p_document), false);
$$;
revoke all on function public.tk_fee_is_paid(uuid) from public, anon;
grant execute on function public.tk_fee_is_paid(uuid) to authenticated, service_role;

-- voids an unpaid turnkey fee proforma (superseded fee): balanced reversal of the receivable, status 'void'
create or replace function public.tk_void_fee_document(p_document uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.documents;
  v_stream text;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null then return; end if;
  if d.doc_type <> 'proforma_invoice' or coalesce(d.data ->> 'service', '') <> 'turnkey' then raise exception 'NOT_A_TURNKEY_PROFORMA'; end if;
  if coalesce(d.status, '') in ('void', 'cancelled') then return; end if;
  if d.paid_cents > 0 or coalesce(d.status, '') <> 'awaiting_payment' then raise exception 'FEE_PAID_LOCKED: the client has already paid towards %', d.number; end if;
  v_stream := coalesce(nullif(d.data ->> 'service', ''), 'service_fees');
  perform post_journal('Void proforma ' || d.number || ' · fee changed',
    jsonb_build_array(
      jsonb_build_object('account', revenue_account(v_stream, coalesce(d.currency, 'USD')), 'debit', d.amount_cents, 'credit', 0),
      jsonb_build_object('account', receivable_account(d.org_id, coalesce(d.currency, 'USD')), 'debit', 0, 'credit', d.amount_cents, 'org', d.org_id)
    ), 'doc-void:' || d.id, v_stream, 'document', d.id);
  update public.documents set status = 'void' where id = d.id;
  perform write_audit('turnkey.fee_proforma_void', 'documents', d.id::text, jsonb_build_object('number', d.number, 'amount_cents', d.amount_cents));
end $$;
revoke all on function public.tk_void_fee_document(uuid) from public, anon, authenticated;
grant execute on function public.tk_void_fee_document(uuid) to service_role;

-- issues the client's proforma for a fee: the same steps, numbering and journal as issue_service_proforma
-- (documents + invoice_lines + post_document_receivable + audit 'invoice.issue'), service 'turnkey' (TK division).
-- Internal (issue_service_proforma itself lets only Finance / account managers issue; Turnkey editors set fees).
create or replace function public.tk_issue_fee_proforma(p_project uuid, p_stage text, p_service text, p_amount_cents bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_stage_name text;
  v_label text;
  v_no text;
  v_doc uuid;
begin
  select * into v from public.tk_client_projects where id = p_project;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  select name into v_stage_name from public.tk_stages where code = p_stage;
  v_label := coalesce((select s.name from public.tk_services s where s.code = p_service), v_stage_name || ' fee');
  v_no := next_document_number('proforma');
  insert into public.documents (org_id, doc_type, number, amount_cents, currency, status, data)
  values (v.org_id, 'proforma_invoice', v_no, p_amount_cents, 'USD', 'awaiting_payment',
          jsonb_build_object('service', 'turnkey', 'ref_type', 'tk_project_fee', 'ref', v.code, 'title', 'Turnkey ' || v.code || ' · ' || v_label,
                             'issuer', (select legal_name from public.company_profile where id = 1)))
  returning id into v_doc;
  insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
  values (v_doc, 'turnkey', v_label || ' · ' || v.title || ' (' || v.code || ', phase: ' || v_stage_name || ')', 1, p_amount_cents, p_amount_cents,
          'tk_project_fee', v.code);
  perform post_document_receivable(v_doc);
  perform audit('invoice.issue', v.org_id, 'turnkey', 'document', v_doc::text, null, jsonb_build_object('number', v_no, 'amount_cents', p_amount_cents, 'ref', v.code));
  return v_doc;
end $$;
revoke all on function public.tk_issue_fee_proforma(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.tk_issue_fee_proforma(uuid, text, text, bigint) to service_role;

-- supersedes the active fee of a project / phase / service (if any): voids its unpaid proforma. Returns its id. Internal.
create or replace function public.tk_supersede_fee(p_project uuid, p_stage text, p_service text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.tk_project_fees;
begin
  select * into o from public.tk_project_fees f
   where f.project_id = p_project and f.stage = p_stage and coalesce(f.service_code, '*') = coalesce(p_service, '*') and f.status = 'active' for update;
  if o.id is null then return null; end if;
  perform public.tk_void_fee_document(o.document_id);   -- refuses when the client has paid anything towards it
  update public.tk_project_fees set status = 'superseded', superseded_at = now() where id = o.id;
  return o.id;
end $$;
revoke all on function public.tk_supersede_fee(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tk_supersede_fee(uuid, text, text) to service_role;

-- after a fee became active: tells the client in the project history and audits. Internal.
create or replace function public.tk_fee_activated(p_fee uuid, p_replaced uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_project_fees;
  v public.tk_client_projects;
  v_stage_name text;
  v_label text;
  v_gated boolean;
begin
  select * into f from public.tk_project_fees where id = p_fee;
  select * into v from public.tk_client_projects where id = f.project_id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  select name into v_stage_name from public.tk_stages where code = f.stage;
  select gated into v_gated from public.tk_stage_fee_rules where stage = f.stage;
  v_label := coalesce((select s.name from public.tk_services s where s.code = f.service_code), v_stage_name || ' fee');
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'fee', f.stage, v_label || ': US$ ' || to_char(f.amount_cents / 100.0, 'FM999,999,990.00') ||
          case when coalesce(v_gated, false) then '. Pay it to start this phase.' else '. Pay it before this work starts.' end ||
          case when p_replaced is not null then ' This replaces the earlier fee.' else '' end);
  perform write_audit('turnkey.fee_activated', 'tk_project_fees', f.id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'stage', f.stage, 'version', f.version, 'amount_cents', f.amount_cents,
                       'starting_cents', f.starting_cents, 'needs_approval', f.needs_approval, 'approved_by', f.approved_by,
                       'document_id', f.document_id, 'superseded', p_replaced));
end $$;
revoke all on function public.tk_fee_activated(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tk_fee_activated(uuid, uuid) to service_role;

-- ───────── 4. RLS: managers see the projects they manage ─────────
drop policy if exists tk_client_projects_read on public.tk_client_projects;
create policy tk_client_projects_read on public.tk_client_projects for select to authenticated
  using (org_id in (select my_org_ids()) or (is_staff() and can('turnkey', 'view') and in_division(division_id)) or public.tk_is_project_manager(id));
drop policy if exists tk_client_project_staff_read on public.tk_client_project_staff;
create policy tk_client_project_staff_read on public.tk_client_project_staff for select to authenticated
  using ((is_staff() and can('turnkey', 'view') and exists (select 1 from public.tk_client_projects p where p.id = project_id and in_division(p.division_id)))
         or public.tk_is_project_manager(project_id));

-- ───────── 5. fees: set / decide / withdraw ─────────
-- Staff set the exact fee. Up to 2x the service's starting fee it is active at once (proforma issued); above 2x, or when
-- the service has no starting fee, it waits for one admin who is not the proposer.
create or replace function public.tk_propose_fee(p_project uuid, p_stage text, p_service text, p_amount_cents bigint, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_stage public.tk_stages;
  v_service text := nullif(btrim(coalesce(p_service, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_start bigint;
  v_needs boolean;
  v_active public.tk_project_fees;
  v_pending public.tk_project_fees;
  v_ver integer;
  v_id uuid;
  v_doc uuid;
  v_old uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors set fees'; end if;
  if v.status in ('cancelled', 'completed') then raise exception 'PROJECT_CLOSED: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this old enquiry is not linked to a client company yet'; end if;
  select * into v_stage from public.tk_stages where code = p_stage;
  if v_stage.code is null then raise exception 'INVALID_STAGE'; end if;
  if not v_stage.paid then raise exception 'FREE_PHASE: the enquiry is free'; end if;
  if v_service is not null and not exists (select 1 from public.tk_services s where s.code = v_service and s.active) then raise exception 'INVALID_SERVICE'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT: enter the fee (above 0)'; end if;
  if p_amount_cents > 100000000 then raise exception 'INVALID_AMOUNT: a fee above US$ 1,000,000.00 is not accepted here'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'NOTE_TOO_LONG: keep the note under 1,000 characters'; end if;
  select * into v_active from public.tk_project_fees f
   where f.project_id = v.id and f.stage = p_stage and coalesce(f.service_code, '*') = coalesce(v_service, '*') and f.status = 'active' for update;
  if v_active.id is not null and exists (select 1 from public.documents d where d.id = v_active.document_id and d.paid_cents > 0) then
    raise exception 'FEE_PAID_LOCKED: the client has paid towards this fee; it cannot be changed';
  end if;
  -- the 2x rule (D5: service fees): the starting fee is the service's "From" price; no starting fee → an admin approves
  select nullif(s.from_cents, 0) into v_start from public.tk_services s where s.code = v_service;
  v_needs := v_start is null or p_amount_cents > 2 * v_start;
  -- a newer proposal replaces a waiting one (kept as withdrawn)
  select * into v_pending from public.tk_project_fees f
   where f.project_id = v.id and f.stage = p_stage and coalesce(f.service_code, '*') = coalesce(v_service, '*') and f.status = 'pending_approval' for update;
  if v_pending.id is not null then
    update public.tk_project_fees set status = 'withdrawn', withdrawn_at = now() where id = v_pending.id;
    perform write_audit('turnkey.fee_withdrawn', 'tk_project_fees', v_pending.id::text,
      jsonb_build_object('code', v.code, 'stage', p_stage, 'version', v_pending.version, 'replaced_by_new_proposal', true));
  end if;
  -- up to 2x: active at once — the previous unpaid version is superseded (its proforma voided) and the proforma issued
  if not v_needs then
    v_old := public.tk_supersede_fee(v.id, p_stage, v_service);
    v_doc := public.tk_issue_fee_proforma(v.id, p_stage, v_service, p_amount_cents);
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.tk_project_fees f
   where f.project_id = v.id and f.stage = p_stage and coalesce(f.service_code, '*') = coalesce(v_service, '*');
  insert into public.tk_project_fees (project_id, stage, service_code, version, amount_cents, starting_cents, needs_approval, status, note, proposed_by,
    document_id, effective_from)
  values (v.id, p_stage, v_service, v_ver, p_amount_cents, v_start, v_needs, case when v_needs then 'pending_approval' else 'active' end, v_note, auth.uid(),
    v_doc, case when not v_needs then now() end)
  returning id into v_id;
  perform write_audit('turnkey.fee_proposed', 'tk_project_fees', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'stage', p_stage, 'service', v_service, 'version', v_ver, 'amount_cents', p_amount_cents,
                       'starting_cents', v_start, 'needs_approval', v_needs, 'replaces_active', v_active.id));
  if not v_needs then
    perform public.tk_fee_activated(v_id, v_old);
    return jsonb_build_object('id', v_id, 'status', 'active', 'needs_approval', false, 'document_id', v_doc);
  end if;
  return jsonb_build_object('id', v_id, 'status', 'pending_approval', 'needs_approval', true);
end $$;
revoke all on function public.tk_propose_fee(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.tk_propose_fee(uuid, text, text, bigint, text) to authenticated, service_role;

-- an admin (2FA) who did not propose the fee approves or rejects a fee above 2x the starting fee
create or replace function public.tk_decide_fee(p_fee uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_project_fees;
  v public.tk_client_projects;
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_doc uuid;
  v_old uuid;
begin
  if v_uid is null or not is_admin() then raise exception 'FORBIDDEN: only admins approve or reject fees'; end if;
  select * into f from public.tk_project_fees where id = p_fee;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = f.project_id for update;   -- one decision per project at a time
  select * into f from public.tk_project_fees where id = p_fee for update;
  if f.status <> 'pending_approval' then raise exception 'FEE_NOT_PENDING: this fee was already decided'; end if;
  if not f.needs_approval then raise exception 'NO_APPROVAL_NEEDED: this fee is within 2x the starting fee'; end if;

  if p_decision = 'reject' then
    if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why the fee is rejected'; end if;
    if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
    update public.tk_project_fees set status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = v_reason where id = f.id;
    perform write_audit('turnkey.fee_rejected', 'tk_project_fees', f.id::text,
      jsonb_build_object('code', v.code, 'project_id', v.id, 'stage', f.stage, 'version', f.version, 'amount_cents', f.amount_cents, 'reason', v_reason));
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'approve' then
    raise exception 'INVALID_DECISION';
  end if;

  if f.proposed_by = v_uid then raise exception 'TWO_PERSON_REQUIRED: you can''t approve a fee you proposed'; end if;
  if v.status in ('cancelled', 'completed') then raise exception 'PROJECT_CLOSED: the project is closed'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  v_old := public.tk_supersede_fee(f.project_id, f.stage, f.service_code);
  v_doc := public.tk_issue_fee_proforma(f.project_id, f.stage, f.service_code, f.amount_cents);
  update public.tk_project_fees
     set approved_by = v_uid, approved_at = now(), status = 'active', effective_from = now(), document_id = v_doc
   where id = f.id;
  perform write_audit('turnkey.fee_approved', 'tk_project_fees', f.id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'stage', f.stage, 'version', f.version, 'amount_cents', f.amount_cents, 'starting_cents', f.starting_cents));
  perform public.tk_fee_activated(f.id, v_old);
  return jsonb_build_object('status', 'active', 'document_id', v_doc);
end $$;
revoke all on function public.tk_decide_fee(uuid, text, text) from public, anon;
grant execute on function public.tk_decide_fee(uuid, text, text) to authenticated, service_role;

-- the proposer or a Turnkey editor withdraws a waiting proposal (kept in the history)
create or replace function public.tk_withdraw_fee(p_fee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_project_fees;
  v public.tk_client_projects;
begin
  select * into f from public.tk_project_fees where id = p_fee;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = f.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors withdraw fees'; end if;
  select * into f from public.tk_project_fees where id = p_fee for update;
  if f.status <> 'pending_approval' then raise exception 'FEE_NOT_PENDING: this fee was already decided'; end if;
  update public.tk_project_fees set status = 'withdrawn', withdrawn_at = now() where id = f.id;
  perform write_audit('turnkey.fee_withdrawn', 'tk_project_fees', f.id::text, jsonb_build_object('code', v.code, 'project_id', v.id, 'stage', f.stage, 'version', f.version));
end $$;
revoke all on function public.tk_withdraw_fee(uuid) from public, anon;
grant execute on function public.tk_withdraw_fee(uuid) to authenticated, service_role;

-- staff list of a project's fees with who proposed / approved / rejected, the internal note and the proforma's state
create or replace function public.tk_list_project_fees(p_project uuid)
returns table (
  id uuid, stage text, service_code text, service_name text, version integer, amount_cents bigint, currency text, starting_cents bigint,
  needs_approval boolean, status text, note text, proposed_by uuid, proposed_by_name text, proposed_at timestamptz,
  approved_by uuid, approved_by_name text, approved_at timestamptz, rejected_by_name text, rejected_at timestamptz, reject_reason text,
  withdrawn_at timestamptz, effective_from timestamptz, superseded_at timestamptz, document_id uuid, document_number text, document_status text,
  paid_cents bigint, paid boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  return query
    select f.id, f.stage, f.service_code, s.name, f.version, f.amount_cents, f.currency::text, f.starting_cents, f.needs_approval, f.status, f.note,
           f.proposed_by, coalesce(nullif(btrim(pp.full_name), ''), pp.email), f.proposed_at,
           f.approved_by, coalesce(nullif(btrim(pa.full_name), ''), pa.email), f.approved_at,
           coalesce(nullif(btrim(pr.full_name), ''), pr.email), f.rejected_at, f.reject_reason,
           f.withdrawn_at, f.effective_from, f.superseded_at, f.document_id, d.number, d.status, d.paid_cents, public.tk_fee_is_paid(f.document_id)
      from public.tk_project_fees f
      join public.tk_stages st on st.code = f.stage
      left join public.tk_services s on s.code = f.service_code
      left join public.profiles pp on pp.id = f.proposed_by
      left join public.profiles pa on pa.id = f.approved_by
      left join public.profiles pr on pr.id = f.rejected_by
      left join public.documents d on d.id = f.document_id
     where f.project_id = p_project
     order by st.seq, coalesce(f.service_code, ''), f.version desc;
end $$;
revoke all on function public.tk_list_project_fees(uuid) from public, anon;
grant execute on function public.tk_list_project_fees(uuid) to authenticated, service_role;

-- admin queue: fees above 2x the starting fee (or without one) waiting for approval, and the latest such decisions
create or replace function public.tk_list_fee_approvals(p_decided_limit integer default 30)
returns table (
  id uuid, project_id uuid, project_code text, project_title text, client_name text, stage text, service_name text, version integer,
  amount_cents bigint, currency text, status text, note text, starting_cents bigint, active_cents bigint,
  proposed_by uuid, proposed_by_name text, proposed_at timestamptz, approved_by_name text, approved_at timestamptz,
  rejected_by_name text, rejected_at timestamptz, reject_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN: admins only'; end if;
  return query
    with q as (
      (select f.* from public.tk_project_fees f where f.status = 'pending_approval' and f.needs_approval)
      union all
      (select f.* from public.tk_project_fees f where f.needs_approval and f.status in ('active', 'rejected', 'superseded') and coalesce(f.rejected_at, f.approved_at) is not null
        order by coalesce(f.rejected_at, f.approved_at) desc limit greatest(0, least(coalesce(p_decided_limit, 30), 200)))
    )
    select f.id, p.id, p.code, p.title, o.name, f.stage, coalesce(s.name, st.name || ' fee'), f.version, f.amount_cents, f.currency::text, f.status, f.note,
           f.starting_cents,
           (select a.amount_cents from public.tk_project_fees a where a.project_id = f.project_id and a.stage = f.stage
               and coalesce(a.service_code, '*') = coalesce(f.service_code, '*') and a.status = 'active' and a.id <> f.id),
           f.proposed_by, coalesce(nullif(btrim(pp.full_name), ''), pp.email), f.proposed_at,
           coalesce(nullif(btrim(pa.full_name), ''), pa.email), f.approved_at,
           coalesce(nullif(btrim(pr.full_name), ''), pr.email), f.rejected_at, f.reject_reason
      from q f
      join public.tk_client_projects p on p.id = f.project_id
      join public.tk_stages st on st.code = f.stage
      left join public.organizations o on o.id = p.org_id
      left join public.tk_services s on s.code = f.service_code
      left join public.profiles pp on pp.id = f.proposed_by
      left join public.profiles pa on pa.id = f.approved_by
      left join public.profiles pr on pr.id = f.rejected_by
     order by (f.status = 'pending_approval') desc, case when f.status = 'pending_approval' then f.proposed_at end asc,
              coalesce(f.rejected_at, f.approved_at) desc;
end $$;
revoke all on function public.tk_list_fee_approvals(integer) from public, anon;
grant execute on function public.tk_list_fee_approvals(integer) to authenticated, service_role;

-- ───────── 6. payment gate on phase moves (T2 function; the gate replaces the T2 comment) ─────────
create or replace function public.tk_move_project_stage(p_project uuid, p_to_stage text, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_from smallint;
  v_to smallint;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_name text;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors move projects'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this old enquiry is not linked to a client company yet'; end if;
  if v_msg is not null and length(v_msg) > 1000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 1,000 characters'; end if;
  select seq into v_from from public.tk_stages where code = v.stage;
  select seq, name into v_to, v_name from public.tk_stages where code = p_to_stage;
  if v_to is null then raise exception 'INVALID_STAGE'; end if;
  if v_to = v_from then raise exception 'SAME_STAGE: the project is already in this phase'; end if;
  if v_to > v_from + 1 then raise exception 'STAGE_SKIP: move one phase at a time'; end if;
  if v_to < v_from and v_msg is null then raise exception 'REASON_REQUIRED: tell the client why the project moves back'; end if;
  -- T3 payment gate: a gated paid phase starts only when its fee is active (approved when above 2x) and the client has paid it
  if v_to > v_from and exists (select 1 from public.tk_stage_fee_rules r where r.stage = p_to_stage and r.gated) then
    if not exists (select 1 from public.tk_project_fees f where f.project_id = v.id and f.stage = p_to_stage and f.status = 'active') then
      raise exception 'FEE_NOT_APPROVED: % starts after its fee is set and active (an admin approves fees above 2x the starting fee)', v_name;
    end if;
    if exists (select 1 from public.tk_project_fees f where f.project_id = v.id and f.stage = p_to_stage and f.status = 'active'
                 and not public.tk_fee_is_paid(f.document_id)) then
      raise exception 'FEE_NOT_PAID: % starts after the client has paid its fee', v_name;
    end if;
  end if;
  if v_to > v_from then
    update public.tk_client_project_stages set completed_at = now() where project_id = v.id and stage = v.stage;
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  else
    update public.tk_client_project_stages set started_at = null, completed_at = null
     where project_id = v.id and stage in (select code from public.tk_stages where seq > v_to);
    update public.tk_client_project_stages set started_at = now(), completed_at = null where project_id = v.id and stage = p_to_stage;
  end if;
  update public.tk_client_projects set stage = p_to_stage, stage_changed_at = now(), updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, from_stage, to_stage, message)
  values (v.id, case when v_to > v_from then 'stage_forward' else 'stage_back' end, v.stage, p_to_stage, v_msg);
  perform write_audit('turnkey.project_stage', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.stage, 'to', p_to_stage, 'message', v_msg));
end $$;

-- ───────── 7. account manager + cover ─────────
-- the name the client sees: the cover during the cover period, else the primary account manager (T2 function)
create or replace function public.tk_project_manager_name(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(pr.full_name), '')
    from public.tk_client_projects p
    join public.profiles pr on pr.id = public.tk_active_manager(p.id)
   where p.id = p_project
     and (p.org_id in (select my_org_ids()) or public.tk_staff_can_view(p.id));
$$;

-- names only (client of the project's company, or staff who can view it)
create or replace function public.tk_project_contact(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'name', nullif(btrim(pa.full_name), ''),
           'on_cover', s.cover_id is not null and current_date between s.cover_from and s.cover_to,
           'usual_name', nullif(btrim(po.full_name), ''),
           'cover_name', nullif(btrim(pc.full_name), ''),
           'cover_from', s.cover_from,
           'cover_to', s.cover_to)
    from public.tk_client_projects p
    join public.tk_client_project_staff s on s.project_id = p.id
    left join public.profiles pa on pa.id = public.tk_active_manager(p.id)
    left join public.profiles po on po.id = s.owner_id
    left join public.profiles pc on pc.id = s.cover_id
   where p.id = p_project
     and (p.org_id in (select my_org_ids()) or public.tk_staff_can_view(p.id));
$$;
revoke all on function public.tk_project_contact(uuid) from public, anon;
grant execute on function public.tk_project_contact(uuid) to authenticated, service_role;

create or replace function public.tk_set_project_cover(p_project uuid, p_user uuid, p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  s public.tk_client_project_staff;
  v_name text;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors choose the cover'; end if;
  select * into s from public.tk_client_project_staff where project_id = v.id for update;
  if p_user is null then
    if s.cover_id is null then raise exception 'NO_COVER: there is no cover to remove'; end if;
    update public.tk_client_project_staff set cover_id = null, cover_from = null, cover_to = null, cover_set_at = now() where project_id = v.id;
    insert into public.tk_client_project_events (project_id, kind, message) values (v.id, 'manager', 'Your account manager is back; the cover has ended.');
    perform write_audit('turnkey.project_cover', 'tk_client_projects', v.id::text, jsonb_build_object('code', v.code, 'from', s.cover_id, 'to', null));
    return;
  end if;
  if s.owner_id is null then raise exception 'NO_MANAGER: choose the account manager first'; end if;
  if p_user = s.owner_id then raise exception 'COVER_IS_MANAGER: the cover must be someone else'; end if;
  if not exists (
    select 1 from public.user_roles ur where ur.user_id = p_user
       and (ur.role_code in ('admin', 'account_manager')
            or exists (select 1 from public.role_permissions rp where rp.role_code = ur.role_code and rp.area = 'turnkey' and rp.action = 'edit'))) then
    raise exception 'INVALID_MANAGER: choose an account manager or a Turnkey editor';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_DATES: choose a start and an end date (end on or after the start)'; end if;
  if p_to < current_date then raise exception 'COVER_IN_PAST: the cover period has already ended'; end if;
  if p_to > p_from + 366 then raise exception 'COVER_TOO_LONG: a cover lasts at most a year; change the account manager instead'; end if;
  update public.tk_client_project_staff set cover_id = p_user, cover_from = p_from, cover_to = p_to, cover_set_at = now() where project_id = v.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  select nullif(btrim(full_name), '') into v_name from public.profiles where id = p_user;
  insert into public.tk_client_project_events (project_id, kind, message)
  values (v.id, 'manager', coalesce(v_name, 'A colleague') || ' looks after your project from ' || to_char(p_from, 'FMDD Mon YYYY') || ' to ' || to_char(p_to, 'FMDD Mon YYYY') || ' while your account manager is away.');
  perform write_audit('turnkey.project_cover', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', s.cover_id, 'to', p_user, 'cover_from', p_from, 'cover_to', p_to));
end $$;
revoke all on function public.tk_set_project_cover(uuid, uuid, date, date) from public, anon;
grant execute on function public.tk_set_project_cover(uuid, uuid, date, date) to authenticated, service_role;

-- the signed-in staff member's projects (primary manager, or cover during the period) for the "My projects" filter
create or replace function public.tk_my_managed_projects()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.project_id from public.tk_client_project_staff s
   where auth.uid() is not null and is_staff()
     and (s.owner_id = auth.uid() or (s.cover_id = auth.uid() and current_date between s.cover_from and s.cover_to));
$$;
revoke all on function public.tk_my_managed_projects() from public, anon;
grant execute on function public.tk_my_managed_projects() to authenticated, service_role;
