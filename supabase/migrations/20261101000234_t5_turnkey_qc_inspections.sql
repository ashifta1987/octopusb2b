-- 20261101000234_t5_turnkey_qc_inspections.sql   (renumber at install)
-- Turnkey T5 (docs/design/turnkey-v2: "6. Production and QC: factory audit and inspections, each paid before it starts";
-- services "Factory audit — about $250" and "Pre-shipment inspection — from $249"; QC "covers factory audit and
-- pre-shipment inspection"; Inspector "uses the phone checklist (Pass, Fail, N/A, photos, offline)"; Client "downloads
-- invoices and reports"; supplier details hidden from clients. Programme D6: the inspector works ONLINE first — offline
-- comes later, so the data is made for it: client-generated photo ids, one idempotent submit with a client submission id).
--  1. Inspections per client project: kind factory_audit or pre_shipment (the two the design names), numbered in rounds
--     (a re-inspection is the next round). Staff (Turnkey editors, TK division, 2FA) create them in Production and QC with
--     the factory (name / address: staff and the inspector only) and the checklist lines.
--  2. Each inspection is paid before it starts: its own fee (tk_inspection_fees) under the design's SetFee rule (D5: up to
--     2x the service's starting fee it is active at once; above 2x one admin who is not the proposer approves it),
--     proforma through T4's tk_issue_project_proforma (service 'turnkey' → TK division), paid with pay_service_proforma.
--     A factory audit may instead be covered by the project's paid Production and QC phase fee (T3 gate fee, service
--     factory_audit) — once, so the client never pays the audit twice. Scheduling (and so starting, photos, submitting)
--     is refused until the fee is fully paid.
--  3. Inspectors: staff with the new permission turnkey_qc:edit (given to the existing role qc_coordinator, "Samples, QC
--     inspections, certifications"; admins have every permission). An inspector sees only the inspections assigned to them
--     (definer reads), uploads photos to the PRIVATE bucket turnkey-inspections (<project>/<inspection>/<photo id>.<ext>),
--     answers every checklist line Pass / Fail / N/A, enters the AQL numbers (lot size, sample size, critical / major /
--     minor defects; whole numbers), the result (pass / pass with remarks / fail) and signs with their name.
--  4. Report: another Turnkey editor (never the inspector) reviews it, may hide photos, writes the client summary and
--     publishes it. Clients read published reports only: result, summary, AQL numbers, checklist answers and the visible
--     photos (signed URLs) — never the factory, the inspector's remarks, costs or names. Text the client would see that
--     names a factory of the project is refused (tk_names_supplier now also knows the inspection factories).
--  5. Production and QC is complete when the latest pre-shipment inspection is published with a pass (or pass with
--     remarks). A failed one blocks Shipment until a re-inspection passes, or an ADMIN who is not that inspection's
--     inspector overrides it with a reason (two-person).
-- Every write goes through a security definer function (search_path = public; not for anon); every change is audited.
-- Down: supabase/migrations/down/20261101000234_t5_turnkey_qc_inspections.down.sql

-- ───────── 0. client history kind, inspector permission ─────────
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date', 'fee', 'manager', 'drawing', 'quote', 'inspection'));

insert into public.permission_areas (code, name, sort) values ('turnkey_qc', 'Turnkey QC inspections', 21) on conflict (code) do nothing;
insert into public.role_permissions (role_code, area, action) values ('qc_coordinator', 'turnkey_qc', 'view'), ('qc_coordinator', 'turnkey_qc', 'edit')
on conflict do nothing;

-- ───────── 1. inspections ─────────
create table if not exists public.tk_inspections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  kind text not null check (kind in ('factory_audit', 'pre_shipment')),
  round smallint not null check (round between 1 and 99),
  status text not null default 'planned' check (status in ('planned', 'scheduled', 'in_progress', 'submitted', 'published', 'cancelled')),
  scheduled_on date,
  inspector_id uuid references auth.users(id) on delete restrict,
  factory_name text not null check (btrim(factory_name) <> '' and length(factory_name) <= 200),
  factory_address text check (factory_address is null or length(factory_address) <= 500),
  brief text check (brief is null or length(brief) <= 2000),
  phase_fee_id uuid references public.tk_project_fees(id),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  scheduled_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  returned_reason text check (returned_reason is null or length(returned_reason) <= 1000),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  override_by uuid references auth.users(id) on delete restrict,
  override_at timestamptz,
  override_reason text check (override_reason is null or length(override_reason) <= 500),
  constraint tk_inspections_scheduled check (status in ('planned', 'cancelled') or (inspector_id is not null and scheduled_on is not null and scheduled_at is not null)),
  constraint tk_inspections_published check ((status = 'published') = (published_at is not null and published_by is not null)),
  constraint tk_inspections_cancelled check ((status = 'cancelled') = (cancelled_at is not null and nullif(btrim(coalesce(cancel_reason, '')), '') is not null)),
  constraint tk_inspections_review_by_another check (published_by is null or published_by is distinct from inspector_id),
  constraint tk_inspections_override check (
    (override_by is null and override_at is null and override_reason is null)
    or (override_by is not null and override_at is not null and nullif(btrim(coalesce(override_reason, '')), '') is not null
        and kind = 'pre_shipment' and status = 'published' and override_by is distinct from inspector_id)),
  constraint tk_inspections_phase_fee_audit check (phase_fee_id is null or kind = 'factory_audit')
);
create unique index if not exists tk_inspections_round_idx on public.tk_inspections (project_id, kind, round);
create unique index if not exists tk_inspections_one_open_idx on public.tk_inspections (project_id, kind) where status in ('planned', 'scheduled', 'in_progress', 'submitted');
create unique index if not exists tk_inspections_phase_fee_idx on public.tk_inspections (phase_fee_id) where phase_fee_id is not null and status <> 'cancelled';
create index if not exists tk_inspections_inspector_idx on public.tk_inspections (inspector_id, status);
create index if not exists tk_inspections_created_by_idx on public.tk_inspections (created_by);
create index if not exists tk_inspections_published_by_idx on public.tk_inspections (published_by);
create index if not exists tk_inspections_override_by_idx on public.tk_inspections (override_by);
create index if not exists tk_inspections_phase_fee_fk_idx on public.tk_inspections (phase_fee_id);
comment on table public.tk_inspections is 'Turnkey T5: factory audits and pre-shipment inspections per client project (rounds). Customers read kind, round, status, date and publication only; the factory, inspector, brief, reasons and override are staff-only (tk_staff_inspections / tk_inspector_job).';
alter table public.tk_inspections enable row level security;
revoke all on public.tk_inspections from public, anon, authenticated;
grant select (id, project_id, kind, round, status, scheduled_on, phase_fee_id, published_at, created_at) on public.tk_inspections to authenticated;
grant all on public.tk_inspections to service_role;
drop policy if exists tk_inspections_read on public.tk_inspections;
create policy tk_inspections_read on public.tk_inspections for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id) and (status <> 'cancelled' or public.tk_staff_can_view(project_id)));

-- the fee of one inspection (versions; the design's 2x rule; one admin, not the proposer, above 2x)
create table if not exists public.tk_inspection_fees (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.tk_inspections(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  service_code text not null references public.tk_services(code) on update cascade on delete restrict,
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
  constraint tk_inspection_fees_rule check (needs_approval = (starting_cents is null or amount_cents > 2 * starting_cents)),
  constraint tk_inspection_fees_two_person check (approved_by is null or approved_by <> proposed_by),
  constraint tk_inspection_fees_approval_time check ((approved_by is null) = (approved_at is null)),
  constraint tk_inspection_fees_auto_no_approver check (needs_approval or (approved_by is null and rejected_by is null and status not in ('pending_approval', 'rejected'))),
  constraint tk_inspection_fees_active_ok check (status not in ('active', 'superseded') or (effective_from is not null and document_id is not null and (not needs_approval or approved_by is not null))),
  constraint tk_inspection_fees_pending_not_final check (status <> 'pending_approval' or (approved_by is null and rejected_by is null and document_id is null)),
  constraint tk_inspection_fees_rejected_reason check (status <> 'rejected' or (rejected_by is not null and rejected_at is not null and approved_by is null and nullif(btrim(coalesce(reject_reason, '')), '') is not null))
);
create unique index if not exists tk_inspection_fees_version_idx on public.tk_inspection_fees (inspection_id, version);
create unique index if not exists tk_inspection_fees_one_active_idx on public.tk_inspection_fees (inspection_id) where status = 'active';
create unique index if not exists tk_inspection_fees_one_pending_idx on public.tk_inspection_fees (inspection_id) where status = 'pending_approval';
create index if not exists tk_inspection_fees_pending_idx on public.tk_inspection_fees (proposed_at) where status = 'pending_approval';
create index if not exists tk_inspection_fees_project_idx on public.tk_inspection_fees (project_id);
create index if not exists tk_inspection_fees_document_idx on public.tk_inspection_fees (document_id);
create index if not exists tk_inspection_fees_proposed_by_idx on public.tk_inspection_fees (proposed_by);
create index if not exists tk_inspection_fees_approved_by_idx on public.tk_inspection_fees (approved_by);
create index if not exists tk_inspection_fees_rejected_by_idx on public.tk_inspection_fees (rejected_by);
create index if not exists tk_inspection_fees_service_idx on public.tk_inspection_fees (service_code);
comment on table public.tk_inspection_fees is 'Turnkey T5: the fee of one inspection (versions). Up to 2x the starting fee it is active at once; above 2x one admin who is not the proposer approves it. Customers read active fees (public columns only); proposer, approver, notes and reasons are staff-only (tk_staff_inspections).';
alter table public.tk_inspection_fees enable row level security;
revoke all on public.tk_inspection_fees from public, anon, authenticated;
grant select (id, inspection_id, project_id, service_code, version, amount_cents, currency, status, document_id, effective_from, created_at)
  on public.tk_inspection_fees to authenticated;
grant all on public.tk_inspection_fees to service_role;
drop policy if exists tk_inspection_fees_read on public.tk_inspection_fees;
create policy tk_inspection_fees_read on public.tk_inspection_fees for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id) and (status = 'active' or public.tk_staff_can_view(project_id)));

-- checklist lines (Pass / Fail / N/A); the inspector's remark per line is staff-only
create table if not exists public.tk_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.tk_inspections(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  position smallint not null check (position between 1 and 100),
  label text not null check (btrim(label) <> '' and length(label) <= 300),
  answer text check (answer is null or answer in ('pass', 'fail', 'na')),
  remark text check (remark is null or length(remark) <= 1000),
  answered_at timestamptz,
  constraint tk_inspection_items_answered check ((answer is null) = (answered_at is null))
);
create unique index if not exists tk_inspection_items_position_idx on public.tk_inspection_items (inspection_id, position);
create index if not exists tk_inspection_items_project_idx on public.tk_inspection_items (project_id);
comment on table public.tk_inspection_items is 'Turnkey T5: checklist lines of an inspection with the Pass / Fail / N/A answer. Customers read label and answer of published inspections; remarks are staff-only.';
alter table public.tk_inspection_items enable row level security;
revoke all on public.tk_inspection_items from public, anon, authenticated;
grant select (id, inspection_id, position, label, answer) on public.tk_inspection_items to authenticated;
grant all on public.tk_inspection_items to service_role;
drop policy if exists tk_inspection_items_read on public.tk_inspection_items;
create policy tk_inspection_items_read on public.tk_inspection_items for select to authenticated
  using (public.tk_staff_can_view(project_id)
         or exists (select 1 from public.tk_inspections i where i.id = inspection_id and i.status = 'published'));

-- the inspector's submission and the published report (one per inspection; a returned report is submitted again)
create table if not exists public.tk_inspection_reports (
  inspection_id uuid primary key references public.tk_inspections(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  submission_id uuid not null unique,
  lot_size integer not null check (lot_size between 1 and 10000000),
  sample_size integer not null check (sample_size >= 1),
  critical_defects integer not null check (critical_defects between 0 and 1000000),
  major_defects integer not null check (major_defects between 0 and 1000000),
  minor_defects integer not null check (minor_defects between 0 and 1000000),
  result text not null check (result in ('pass', 'pass_with_remarks', 'fail')),
  remarks text check (remarks is null or length(remarks) <= 4000),
  signed_name text not null check (btrim(signed_name) <> '' and length(signed_name) <= 120),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  client_summary text check (client_summary is null or length(client_summary) <= 4000),
  published_at timestamptz,
  constraint tk_inspection_reports_sample check (sample_size <= lot_size),
  constraint tk_inspection_reports_remarks check (result = 'pass' or nullif(btrim(coalesce(remarks, '')), '') is not null),
  constraint tk_inspection_reports_published check (published_at is null or nullif(btrim(coalesce(client_summary, '')), '') is not null)
);
create index if not exists tk_inspection_reports_project_idx on public.tk_inspection_reports (project_id);
create index if not exists tk_inspection_reports_submitted_by_idx on public.tk_inspection_reports (submitted_by);
comment on table public.tk_inspection_reports is 'Turnkey T5: inspection result (AQL numbers, result, signature) and the client summary. Customers read published reports only, without the inspector''s remarks, name or signature.';
alter table public.tk_inspection_reports enable row level security;
revoke all on public.tk_inspection_reports from public, anon, authenticated;
grant select (inspection_id, project_id, lot_size, sample_size, critical_defects, major_defects, minor_defects, result, client_summary, published_at)
  on public.tk_inspection_reports to authenticated;
grant all on public.tk_inspection_reports to service_role;
drop policy if exists tk_inspection_reports_read on public.tk_inspection_reports;
create policy tk_inspection_reports_read on public.tk_inspection_reports for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id) and (published_at is not null or public.tk_staff_can_view(project_id)));

-- photos (id generated by the phone, so a retried or later offline upload registers once)
create table if not exists public.tk_inspection_photos (
  id uuid primary key,
  inspection_id uuid not null references public.tk_inspections(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  item_id uuid references public.tk_inspection_items(id) on delete set null,
  file_path text not null unique check (length(file_path) between 3 and 400),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tk_inspection_photos_path check (split_part(file_path, '/', 1) = project_id::text and split_part(file_path, '/', 2) = inspection_id::text
                                              and split_part(file_path, '/', 3) like id::text || '.%')
);
create index if not exists tk_inspection_photos_inspection_idx on public.tk_inspection_photos (inspection_id, created_at);
create index if not exists tk_inspection_photos_project_idx on public.tk_inspection_photos (project_id);
create index if not exists tk_inspection_photos_item_idx on public.tk_inspection_photos (item_id);
create index if not exists tk_inspection_photos_uploaded_by_idx on public.tk_inspection_photos (uploaded_by);
comment on table public.tk_inspection_photos is 'Turnkey T5: inspection photos in the private turnkey-inspections bucket. Customers read the photos staff left visible, of published inspections only, through short signed URLs.';
alter table public.tk_inspection_photos enable row level security;
revoke all on public.tk_inspection_photos from public, anon, authenticated;
grant select (id, inspection_id, item_id, file_path, mime_type, created_at) on public.tk_inspection_photos to authenticated;
grant all on public.tk_inspection_photos to service_role;
drop policy if exists tk_inspection_photos_read on public.tk_inspection_photos;
create policy tk_inspection_photos_read on public.tk_inspection_photos for select to authenticated
  using (public.tk_staff_can_view(project_id)
         or (client_visible and exists (select 1 from public.tk_inspections i where i.id = inspection_id and i.status = 'published')));

-- ───────── 2. history is never rewritten (guard) ─────────
create or replace function public.tk_t5_history_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;   -- cascade from a deleted project / inspection (owner-only clean-up)
    if tg_table_name = 'tk_inspection_photos' then
      select i.status into v_status from public.tk_inspections i where i.id = old.inspection_id;
      if v_status in ('scheduled', 'in_progress') then return old; end if;   -- the inspector removes a photo before submitting
    end if;
    raise exception 'TK_HISTORY_KEPT: % rows are never deleted', tg_table_name;
  end if;
  if tg_table_name = 'tk_inspection_fees' then
    if new.inspection_id is distinct from old.inspection_id or new.project_id is distinct from old.project_id or new.service_code is distinct from old.service_code
       or new.version is distinct from old.version or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
       or new.starting_cents is distinct from old.starting_cents or new.needs_approval is distinct from old.needs_approval
       or new.proposed_by is distinct from old.proposed_by or new.proposed_at is distinct from old.proposed_at or new.note is distinct from old.note
       or (old.approved_by is not null and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at))
       or (old.document_id is not null and new.document_id is distinct from old.document_id)
       or (old.status in ('rejected', 'withdrawn', 'superseded') and to_jsonb(new) is distinct from to_jsonb(old)) then
      raise exception 'FEE_HISTORY_KEPT: a proposed fee cannot be rewritten; propose a new version';
    end if;
    if old.status = 'active' and new.status not in ('active', 'superseded') then raise exception 'FEE_HISTORY_KEPT: an active fee can only be superseded'; end if;
  elsif tg_table_name = 'tk_inspections' then
    if new.project_id is distinct from old.project_id or new.kind is distinct from old.kind or new.round is distinct from old.round
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
       or old.status = 'cancelled'
       or (old.status = 'published' and (to_jsonb(new) - 'override_by' - 'override_at' - 'override_reason' - 'updated_at')
                                         is distinct from (to_jsonb(old) - 'override_by' - 'override_at' - 'override_reason' - 'updated_at'))
       or (old.override_by is not null and to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at') then
      raise exception 'TK_HISTORY_KEPT: a published or cancelled inspection cannot be rewritten';
    end if;
  elsif tg_table_name = 'tk_inspection_reports' then
    if old.published_at is not null or new.inspection_id is distinct from old.inspection_id or new.project_id is distinct from old.project_id then
      raise exception 'TK_HISTORY_KEPT: a published report cannot be rewritten';
    end if;
  elsif tg_table_name in ('tk_inspection_items', 'tk_inspection_photos') then
    select i.status into v_status from public.tk_inspections i where i.id = old.inspection_id;
    if v_status in ('published', 'cancelled') or new.inspection_id is distinct from old.inspection_id or new.project_id is distinct from old.project_id then
      raise exception 'TK_HISTORY_KEPT: % rows of a published inspection cannot be rewritten', tg_table_name;
    end if;
    -- labels / files never change (fields read per table: PL/pgSQL resolves every field of an expression)
    if tg_table_name = 'tk_inspection_items' then
      if new.label is distinct from old.label or new.position is distinct from old.position then
        raise exception 'TK_HISTORY_KEPT: checklist lines cannot be rewritten';
      end if;
    elsif (to_jsonb(new) - 'client_visible' - 'item_id') is distinct from (to_jsonb(old) - 'client_visible' - 'item_id') then
      raise exception 'TK_HISTORY_KEPT: a photo cannot be rewritten';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tk_t5_history_guard() from public, anon, authenticated;
drop trigger if exists trg_tk_inspections_guard on public.tk_inspections;
create trigger trg_tk_inspections_guard before update or delete on public.tk_inspections for each row execute function public.tk_t5_history_guard();
drop trigger if exists trg_tk_inspection_fees_guard on public.tk_inspection_fees;
create trigger trg_tk_inspection_fees_guard before update or delete on public.tk_inspection_fees for each row execute function public.tk_t5_history_guard();
drop trigger if exists trg_tk_inspection_items_guard on public.tk_inspection_items;
create trigger trg_tk_inspection_items_guard before update or delete on public.tk_inspection_items for each row execute function public.tk_t5_history_guard();
drop trigger if exists trg_tk_inspection_reports_guard on public.tk_inspection_reports;
create trigger trg_tk_inspection_reports_guard before update or delete on public.tk_inspection_reports for each row execute function public.tk_t5_history_guard();
drop trigger if exists trg_tk_inspection_photos_guard on public.tk_inspection_photos;
create trigger trg_tk_inspection_photos_guard before update or delete on public.tk_inspection_photos for each row execute function public.tk_t5_history_guard();

-- ───────── 3. helpers ─────────
-- the user may be assigned inspections: a staff role with turnkey_qc:edit (qc_coordinator), or an admin. Internal.
create or replace function public.tk_is_inspector(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1 from public.user_roles ur join public.roles r on r.code = ur.role_code
     where ur.user_id = p_user and r.is_staff
       and (ur.role_code = 'admin' or exists (select 1 from public.role_permissions rp where rp.role_code = ur.role_code and rp.area = 'turnkey_qc' and rp.action = 'edit')));
$$;
revoke all on function public.tk_is_inspector(uuid) from public, anon, authenticated;
grant execute on function public.tk_is_inspector(uuid) to service_role;

-- the inspection is paid: its active fee's proforma is fully paid, or (factory audit) the linked phase fee is. Internal.
create or replace function public.tk_inspection_paid(p_inspection uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when i.phase_fee_id is not null
                then exists (select 1 from public.tk_project_fees f where f.id = i.phase_fee_id and f.status = 'active' and public.tk_fee_is_paid(f.document_id))
                else exists (select 1 from public.tk_inspection_fees f where f.inspection_id = i.id and f.status = 'active' and public.tk_fee_is_paid(f.document_id)) end
      from public.tk_inspections i where i.id = p_inspection), false);
$$;
revoke all on function public.tk_inspection_paid(uuid) from public, anon, authenticated;
grant execute on function public.tk_inspection_paid(uuid) to service_role;

-- a whole number from a JSON field (refuses 2.5, "3", true, …). Internal.
create or replace function public.tk_json_int(p jsonb, p_key text)
returns integer
language sql
immutable
security definer
set search_path = public
as $$
  select case when jsonb_typeof(p -> p_key) = 'number'
               and (p ->> p_key)::numeric = trunc((p ->> p_key)::numeric)
               and abs((p ->> p_key)::numeric) <= 2147483647
              then (p ->> p_key)::integer end;
$$;
revoke all on function public.tk_json_int(jsonb, text) from public, anon, authenticated;
grant execute on function public.tk_json_int(jsonb, text) to service_role;

create or replace function public.tk_inspection_label(p_kind text, p_round integer)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_kind when 'factory_audit' then 'Factory audit' else 'Pre-shipment inspection' end
         || case when p_round > 1 then ' (round ' || p_round || ')' else '' end;
$$;
revoke all on function public.tk_inspection_label(text, integer) from public, anon, authenticated;
grant execute on function public.tk_inspection_label(text, integer) to service_role;

-- white-label guard (T4 function, now also covering the factories named on the project's inspections). Internal.
create or replace function public.tk_names_supplier(p_project uuid, p_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_text is not null and (
    exists (select 1 from public.tk_factory_quotes q
             where q.project_id = p_project and length(btrim(q.supplier_name)) >= 3
               and position(lower(btrim(q.supplier_name)) in lower(p_text)) > 0)
    or exists (select 1 from public.tk_inspections i
                where i.project_id = p_project and length(btrim(i.factory_name)) >= 3
                  and position(lower(btrim(i.factory_name)) in lower(p_text)) > 0));
$$;
revoke all on function public.tk_names_supplier(uuid, text) from public, anon, authenticated;
grant execute on function public.tk_names_supplier(uuid, text) to service_role;

-- ───────── 4. private bucket for inspection photos ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('turnkey-inspections', 'turnkey-inspections', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- the assigned inspector may upload into <project id>/<inspection id>/ while the inspection is scheduled or in progress,
-- paid, and the project open
create or replace function public.tk_inspection_can_upload(p_project text, p_inspection text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and exists (
    select 1 from public.tk_inspections i join public.tk_client_projects p on p.id = i.project_id
     where i.id::text = p_inspection and i.project_id::text = p_project and i.status in ('scheduled', 'in_progress')
       and i.inspector_id = auth.uid() and p.status = 'open' and public.tk_inspection_paid(i.id));
$$;
revoke all on function public.tk_inspection_can_upload(text, text) from public, anon;
grant execute on function public.tk_inspection_can_upload(text, text) to authenticated, service_role;

-- a registered photo: staff who can view the project, the assigned inspector, or (visible photos of a published
-- inspection) the project's customers; an unregistered file only for the inspector who may upload it
create or replace function public.tk_inspection_file_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_inspection_photos ph join public.tk_inspections i on i.id = ph.inspection_id
                  where ph.file_path = p_name
                    and (public.tk_staff_can_view(ph.project_id)
                         or (i.inspector_id = auth.uid() and is_staff())
                         or (ph.client_visible and i.status = 'published' and public.tk_is_project_customer(ph.project_id))))
      or (not exists (select 1 from public.tk_inspection_photos ph where ph.file_path = p_name)
          and public.tk_inspection_can_upload(split_part(p_name, '/', 1), split_part(p_name, '/', 2)));
$$;
revoke all on function public.tk_inspection_file_visible(text) from public, anon;
grant execute on function public.tk_inspection_file_visible(text) to authenticated, service_role;

-- a file that is not registered (refused, or its photo removed before submitting) may be removed by the inspector
create or replace function public.tk_inspection_orphan_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.tk_inspection_photos ph where ph.file_path = p_name)
     and public.tk_inspection_can_upload(split_part(p_name, '/', 1), split_part(p_name, '/', 2));
$$;
revoke all on function public.tk_inspection_orphan_removable(text) from public, anon;
grant execute on function public.tk_inspection_orphan_removable(text) to authenticated, service_role;

drop policy if exists "turnkey inspections inspector upload" on storage.objects;
create policy "turnkey inspections inspector upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'turnkey-inspections' and public.tk_inspection_can_upload((storage.foldername(name))[1], (storage.foldername(name))[2]));
drop policy if exists "turnkey inspections read" on storage.objects;
create policy "turnkey inspections read" on storage.objects for select to authenticated
  using (bucket_id = 'turnkey-inspections' and public.tk_inspection_file_visible(name));
drop policy if exists "turnkey inspections remove unregistered" on storage.objects;
create policy "turnkey inspections remove unregistered" on storage.objects for delete to authenticated
  using (bucket_id = 'turnkey-inspections' and public.tk_inspection_orphan_removable(name));

-- ───────── 5. staff: create, fee, schedule, cancel ─────────
-- a Turnkey editor plans an inspection in Production and QC: kind, factory (staff / inspector only), brief, checklist
-- lines (JSON array of texts). A factory audit may be covered by the project's paid Production and QC phase fee.
create or replace function public.tk_create_inspection(p_project uuid, p_kind text, p_factory_name text, p_factory_address text, p_brief text,
                                                       p_items jsonb, p_use_phase_fee boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_factory text := nullif(btrim(coalesce(p_factory_name, '')), '');
  v_address text := nullif(btrim(coalesce(p_factory_address, '')), '');
  v_brief text := nullif(btrim(coalesce(p_brief, '')), '');
  v_fee uuid;
  v_round smallint;
  v_id uuid;
  v_label text;
  v_n integer := 0;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors plan inspections'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  if v.stage <> 'production_qc' then raise exception 'NOT_IN_PRODUCTION_QC: inspections are planned in the Production and QC phase'; end if;
  if p_kind is null or p_kind not in ('factory_audit', 'pre_shipment') then raise exception 'INVALID_KIND: choose factory audit or pre-shipment inspection'; end if;
  if v_factory is null then raise exception 'FACTORY_REQUIRED: enter the factory (staff and the inspector only)'; end if;
  if length(v_factory) > 200 then raise exception 'FACTORY_TOO_LONG: keep the factory name under 200 characters'; end if;
  if v_address is not null and length(v_address) > 500 then raise exception 'ADDRESS_TOO_LONG: keep the address under 500 characters'; end if;
  if v_brief is not null and length(v_brief) > 2000 then raise exception 'BRIEF_TOO_LONG: keep the brief under 2,000 characters'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'CHECKLIST_REQUIRED: add at least one checklist line'; end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'CHECKLIST_TOO_LONG: up to 100 checklist lines'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}') = '' or length(btrim(e #>> '{}')) > 300) then
    raise exception 'INVALID_CHECKLIST: each checklist line is a text of 1 to 300 characters';
  end if;
  if exists (select 1 from public.tk_inspections i where i.project_id = v.id and i.kind = p_kind and i.status in ('planned', 'scheduled', 'in_progress', 'submitted')) then
    raise exception 'INSPECTION_OPEN: finish or cancel the open % first', lower(public.tk_inspection_label(p_kind, 1));
  end if;
  if coalesce(p_use_phase_fee, false) then
    if p_kind <> 'factory_audit' then raise exception 'PHASE_FEE_NOT_AVAILABLE: only a factory audit can use the Production and QC fee'; end if;
    select f.id into v_fee from public.tk_project_fees f
     where f.project_id = v.id and f.stage = 'production_qc' and f.service_code = 'factory_audit' and f.status = 'active' and public.tk_fee_is_paid(f.document_id)
       and not exists (select 1 from public.tk_inspections i where i.phase_fee_id = f.id and i.status <> 'cancelled');
    if v_fee is null then raise exception 'PHASE_FEE_NOT_AVAILABLE: there is no paid factory audit fee for Production and QC that is not used yet'; end if;
  end if;
  select coalesce(max(i.round), 0) + 1 into v_round from public.tk_inspections i where i.project_id = v.id and i.kind = p_kind;
  insert into public.tk_inspections (project_id, kind, round, factory_name, factory_address, brief, phase_fee_id, created_by)
  values (v.id, p_kind, v_round, v_factory, v_address, v_brief, v_fee, auth.uid())
  returning id into v_id;
  for v_label in select btrim(e #>> '{}') from jsonb_array_elements(p_items) with ordinality as t(e, n) order by n loop
    v_n := v_n + 1;
    insert into public.tk_inspection_items (inspection_id, project_id, position, label) values (v_id, v.id, v_n, v_label);
  end loop;
  -- checklist lines are shown to the client in the published report: they must not name a factory of the project
  if exists (select 1 from public.tk_inspection_items it where it.inspection_id = v_id and public.tk_names_supplier(v.id, it.label)) then
    raise exception 'SUPPLIER_NAME_SHOWN: a checklist line names the factory; the client sees these lines';
  end if;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  perform write_audit('turnkey.inspection_created', 'tk_inspections', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'kind', p_kind, 'round', v_round, 'items', v_n, 'phase_fee_id', v_fee));
  return jsonb_build_object('id', v_id, 'round', v_round, 'covered_by_phase_fee', v_fee is not null);
end $$;
revoke all on function public.tk_create_inspection(uuid, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.tk_create_inspection(uuid, text, text, text, text, jsonb, boolean) to authenticated, service_role;

-- supersedes the active fee of an inspection (if any): voids its unpaid proforma. Internal.
create or replace function public.tk_supersede_inspection_fee(p_inspection uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.tk_inspection_fees;
begin
  select * into o from public.tk_inspection_fees f where f.inspection_id = p_inspection and f.status = 'active' for update;
  if o.id is null then return null; end if;
  perform public.tk_void_fee_document(o.document_id);   -- refuses when the client has paid anything towards it
  update public.tk_inspection_fees set status = 'superseded', superseded_at = now() where id = o.id;
  return o.id;
end $$;
revoke all on function public.tk_supersede_inspection_fee(uuid) from public, anon, authenticated;
grant execute on function public.tk_supersede_inspection_fee(uuid) to service_role;

-- after an inspection fee became active: tells the client in the project history and audits. Internal.
create or replace function public.tk_inspection_fee_activated(p_fee uuid, p_replaced uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_inspection_fees;
  i public.tk_inspections;
begin
  select * into f from public.tk_inspection_fees where id = p_fee;
  select * into i from public.tk_inspections where id = f.inspection_id;
  update public.tk_client_projects set updated_at = now() where id = f.project_id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (f.project_id, 'inspection', 'production_qc', public.tk_inspection_label(i.kind, i.round) || ': US$ ' || to_char(f.amount_cents / 100.0, 'FM999,999,990.00') ||
          '. Pay it before the inspection starts.' || case when p_replaced is not null then ' This replaces the earlier fee.' else '' end);
  perform write_audit('turnkey.inspection_fee_activated', 'tk_inspection_fees', f.id::text,
    jsonb_build_object('project_id', f.project_id, 'inspection_id', i.id, 'kind', i.kind, 'round', i.round, 'version', f.version, 'amount_cents', f.amount_cents,
                       'starting_cents', f.starting_cents, 'needs_approval', f.needs_approval, 'approved_by', f.approved_by, 'document_id', f.document_id, 'superseded', p_replaced));
end $$;
revoke all on function public.tk_inspection_fee_activated(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tk_inspection_fee_activated(uuid, uuid) to service_role;

-- staff set the exact fee of an inspection (2x rule as tk_propose_fee: the starting fee is the service's "From" price)
create or replace function public.tk_propose_inspection_fee(p_inspection uuid, p_amount_cents bigint, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  v public.tk_client_projects;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_service text;
  v_start bigint;
  v_needs boolean;
  v_active public.tk_inspection_fees;
  v_pending public.tk_inspection_fees;
  v_ver integer;
  v_id uuid;
  v_doc uuid;
  v_old uuid;
begin
  select * into i from public.tk_inspections where id = p_inspection;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors set fees'; end if;
  if v.status in ('cancelled', 'completed') then raise exception 'PROJECT_CLOSED: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.status <> 'planned' then raise exception 'INSPECTION_NOT_PLANNED: the fee is set before the inspection is scheduled'; end if;
  if i.phase_fee_id is not null then raise exception 'COVERED_BY_PHASE_FEE: this factory audit is paid with the Production and QC fee'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT: enter the fee (above 0)'; end if;
  if p_amount_cents > 100000000 then raise exception 'INVALID_AMOUNT: a fee above US$ 1,000,000.00 is not accepted here'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'NOTE_TOO_LONG: keep the note under 1,000 characters'; end if;
  v_service := case i.kind when 'factory_audit' then 'factory_audit' else 'pre_shipment_inspection' end;
  select * into v_active from public.tk_inspection_fees f where f.inspection_id = i.id and f.status = 'active' for update;
  if v_active.id is not null and exists (select 1 from public.documents d where d.id = v_active.document_id and d.paid_cents > 0) then
    raise exception 'FEE_PAID_LOCKED: the client has paid towards this fee; it cannot be changed';
  end if;
  select nullif(s.from_cents, 0) into v_start from public.tk_services s where s.code = v_service;
  v_needs := v_start is null or p_amount_cents > 2 * v_start;
  select * into v_pending from public.tk_inspection_fees f where f.inspection_id = i.id and f.status = 'pending_approval' for update;
  if v_pending.id is not null then
    update public.tk_inspection_fees set status = 'withdrawn', withdrawn_at = now() where id = v_pending.id;
    perform write_audit('turnkey.inspection_fee_withdrawn', 'tk_inspection_fees', v_pending.id::text,
      jsonb_build_object('code', v.code, 'inspection_id', i.id, 'version', v_pending.version, 'replaced_by_new_proposal', true));
  end if;
  if not v_needs then
    v_old := public.tk_supersede_inspection_fee(i.id);
    v_doc := public.tk_issue_project_proforma(v.id, 'production_qc', public.tk_inspection_label(i.kind, i.round), 'tk_inspection', p_amount_cents);
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.tk_inspection_fees f where f.inspection_id = i.id;
  insert into public.tk_inspection_fees (inspection_id, project_id, service_code, version, amount_cents, starting_cents, needs_approval, status, note, proposed_by,
    document_id, effective_from)
  values (i.id, v.id, v_service, v_ver, p_amount_cents, v_start, v_needs, case when v_needs then 'pending_approval' else 'active' end, v_note, auth.uid(),
    v_doc, case when not v_needs then now() end)
  returning id into v_id;
  perform write_audit('turnkey.inspection_fee_proposed', 'tk_inspection_fees', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'inspection_id', i.id, 'kind', i.kind, 'round', i.round, 'version', v_ver, 'amount_cents', p_amount_cents,
                       'starting_cents', v_start, 'needs_approval', v_needs, 'replaces_active', v_active.id));
  if not v_needs then
    perform public.tk_inspection_fee_activated(v_id, v_old);
    return jsonb_build_object('id', v_id, 'status', 'active', 'needs_approval', false, 'document_id', v_doc);
  end if;
  return jsonb_build_object('id', v_id, 'status', 'pending_approval', 'needs_approval', true);
end $$;
revoke all on function public.tk_propose_inspection_fee(uuid, bigint, text) from public, anon;
grant execute on function public.tk_propose_inspection_fee(uuid, bigint, text) to authenticated, service_role;

-- an admin (2FA) who did not propose it approves or rejects an inspection fee above 2x the starting fee
create or replace function public.tk_decide_inspection_fee(p_fee uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_inspection_fees;
  i public.tk_inspections;
  v public.tk_client_projects;
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_doc uuid;
  v_old uuid;
begin
  if v_uid is null or not is_admin() then raise exception 'FORBIDDEN: only admins approve or reject fees'; end if;
  select * into f from public.tk_inspection_fees where id = p_fee;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = f.project_id for update;
  select * into f from public.tk_inspection_fees where id = p_fee for update;
  select * into i from public.tk_inspections where id = f.inspection_id for update;
  if f.status <> 'pending_approval' then raise exception 'FEE_NOT_PENDING: this fee was already decided'; end if;
  if not f.needs_approval then raise exception 'NO_APPROVAL_NEEDED: this fee is within 2x the starting fee'; end if;
  if p_decision = 'reject' then
    if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why the fee is rejected'; end if;
    if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
    update public.tk_inspection_fees set status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = v_reason where id = f.id;
    perform write_audit('turnkey.inspection_fee_rejected', 'tk_inspection_fees', f.id::text,
      jsonb_build_object('code', v.code, 'inspection_id', i.id, 'version', f.version, 'amount_cents', f.amount_cents, 'reason', v_reason));
    return jsonb_build_object('status', 'rejected');
  elsif p_decision is distinct from 'approve' then
    raise exception 'INVALID_DECISION';
  end if;
  if f.proposed_by = v_uid then raise exception 'TWO_PERSON_REQUIRED: you can''t approve a fee you proposed'; end if;
  if v.status in ('cancelled', 'completed') then raise exception 'PROJECT_CLOSED: the project is closed'; end if;
  if i.status <> 'planned' then raise exception 'INSPECTION_NOT_PLANNED: this inspection is no longer waiting for its fee'; end if;
  v_old := public.tk_supersede_inspection_fee(i.id);
  v_doc := public.tk_issue_project_proforma(v.id, 'production_qc', public.tk_inspection_label(i.kind, i.round), 'tk_inspection', f.amount_cents);
  update public.tk_inspection_fees set approved_by = v_uid, approved_at = now(), status = 'active', effective_from = now(), document_id = v_doc where id = f.id;
  perform write_audit('turnkey.inspection_fee_approved', 'tk_inspection_fees', f.id::text,
    jsonb_build_object('code', v.code, 'inspection_id', i.id, 'version', f.version, 'amount_cents', f.amount_cents, 'starting_cents', f.starting_cents));
  perform public.tk_inspection_fee_activated(f.id, v_old);
  return jsonb_build_object('status', 'active', 'document_id', v_doc);
end $$;
revoke all on function public.tk_decide_inspection_fee(uuid, text, text) from public, anon;
grant execute on function public.tk_decide_inspection_fee(uuid, text, text) to authenticated, service_role;

create or replace function public.tk_withdraw_inspection_fee(p_fee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_inspection_fees;
  v public.tk_client_projects;
begin
  select * into f from public.tk_inspection_fees where id = p_fee;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = f.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors withdraw fees'; end if;
  select * into f from public.tk_inspection_fees where id = p_fee for update;
  if f.status <> 'pending_approval' then raise exception 'FEE_NOT_PENDING: this fee was already decided'; end if;
  update public.tk_inspection_fees set status = 'withdrawn', withdrawn_at = now() where id = f.id;
  perform write_audit('turnkey.inspection_fee_withdrawn', 'tk_inspection_fees', f.id::text, jsonb_build_object('code', v.code, 'inspection_id', f.inspection_id, 'version', f.version));
end $$;
revoke all on function public.tk_withdraw_inspection_fee(uuid) from public, anon;
grant execute on function public.tk_withdraw_inspection_fee(uuid) to authenticated, service_role;

-- staff schedule a PAID inspection: the inspector (turnkey_qc:edit) and the date. Rescheduling is allowed until it starts.
create or replace function public.tk_schedule_inspection(p_inspection uuid, p_inspector uuid, p_on date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  v public.tk_client_projects;
  v_was text;
begin
  select * into i from public.tk_inspections where id = p_inspection;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors schedule inspections'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.status not in ('planned', 'scheduled') then raise exception 'INSPECTION_STARTED: this inspection can no longer be rescheduled'; end if;
  if not public.tk_inspection_paid(i.id) then
    if i.phase_fee_id is null and not exists (select 1 from public.tk_inspection_fees f where f.inspection_id = i.id and f.status = 'active') then
      raise exception 'FEE_NOT_SET: set the inspection fee first (an admin approves fees above 2x the starting fee)';
    end if;
    raise exception 'FEE_NOT_PAID: the inspection is scheduled after the client has paid its fee in full';
  end if;
  if p_inspector is null or not public.tk_is_inspector(p_inspector) then raise exception 'NOT_AN_INSPECTOR: choose a QC inspector'; end if;
  if p_on is null or p_on < current_date then raise exception 'INVALID_DATE: choose today or a later date'; end if;
  if p_on > current_date + 366 then raise exception 'INVALID_DATE: choose a date within a year'; end if;
  v_was := i.status;
  update public.tk_inspections set status = 'scheduled', inspector_id = p_inspector, scheduled_on = p_on, scheduled_at = now(), updated_at = now() where id = i.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'inspection', 'production_qc', public.tk_inspection_label(i.kind, i.round) ||
          case when v_was = 'scheduled' then ' moved to ' else ' scheduled for ' end || to_char(p_on, 'FMDD Mon YYYY') || '.');
  perform write_audit('turnkey.inspection_scheduled', 'tk_inspections', i.id::text,
    jsonb_build_object('code', v.code, 'kind', i.kind, 'round', i.round, 'inspector', p_inspector, 'on', p_on, 'rescheduled', v_was = 'scheduled'));
end $$;
revoke all on function public.tk_schedule_inspection(uuid, uuid, date) from public, anon;
grant execute on function public.tk_schedule_inspection(uuid, uuid, date) to authenticated, service_role;

-- staff cancel an inspection that has not started; an unpaid fee proforma is voided (balanced), a paid one is refused
create or replace function public.tk_cancel_inspection(p_inspection uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old uuid;
begin
  select * into i from public.tk_inspections where id = p_inspection;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors cancel inspections'; end if;
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.status not in ('planned', 'scheduled') then raise exception 'INSPECTION_STARTED: an inspection that has started cannot be cancelled'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  v_old := public.tk_supersede_inspection_fee(i.id);   -- FEE_PAID_LOCKED when the client has paid towards it
  update public.tk_inspection_fees set status = 'withdrawn', withdrawn_at = now() where inspection_id = i.id and status = 'pending_approval';
  update public.tk_inspections set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason, updated_at = now() where id = i.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'inspection', 'production_qc', public.tk_inspection_label(i.kind, i.round) || ' was cancelled.' ||
          case when v_old is not null then ' Its proforma was cancelled too.' else '' end);
  perform write_audit('turnkey.inspection_cancelled', 'tk_inspections', i.id::text,
    jsonb_build_object('code', v.code, 'kind', i.kind, 'round', i.round, 'reason', v_reason, 'fee_voided', v_old));
end $$;
revoke all on function public.tk_cancel_inspection(uuid, text) from public, anon;
grant execute on function public.tk_cancel_inspection(uuid, text) to authenticated, service_role;

-- ───────── 6. inspector (assigned staff only; online now, offline-ready: client ids, idempotent submit) ─────────
create or replace function public.tk_start_inspection(p_inspection uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
begin
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.id is null or auth.uid() is null or not is_staff() or i.inspector_id is distinct from auth.uid() then raise exception 'NOT_FOUND'; end if;
  if i.status = 'in_progress' then return jsonb_build_object('status', 'in_progress', 'duplicate', true); end if;
  if i.status <> 'scheduled' then raise exception 'INSPECTION_NOT_OPEN: this inspection is not waiting to start'; end if;
  if (select p.status from public.tk_client_projects p where p.id = i.project_id) <> 'open' then raise exception 'PROJECT_NOT_OPEN: the project is not open'; end if;
  if not public.tk_inspection_paid(i.id) then raise exception 'FEE_NOT_PAID: the inspection fee is not paid'; end if;
  update public.tk_inspections set status = 'in_progress', started_at = now(), updated_at = now() where id = i.id;
  perform write_audit('turnkey.inspection_started', 'tk_inspections', i.id::text, jsonb_build_object('project_id', i.project_id, 'kind', i.kind, 'round', i.round));
  return jsonb_build_object('status', 'in_progress', 'duplicate', false);
end $$;
revoke all on function public.tk_start_inspection(uuid) from public, anon;
grant execute on function public.tk_start_inspection(uuid) to authenticated, service_role;

-- registers a photo the phone has uploaded (path <project>/<inspection>/<photo id>.<ext>); the same photo id twice is
-- accepted once (a retried upload). Type and size come from storage, not from the phone.
create or replace function public.tk_add_inspection_photo(p_photo uuid, p_inspection uuid, p_path text, p_item uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  x public.tk_inspection_photos;
  v_meta jsonb;
  v_mime text;
  v_size bigint;
begin
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.id is null or auth.uid() is null or not is_staff() or i.inspector_id is distinct from auth.uid() then raise exception 'NOT_FOUND'; end if;
  if p_photo is null then raise exception 'INVALID_FILE: upload the photo again'; end if;
  select * into x from public.tk_inspection_photos where id = p_photo;
  if x.id is not null then
    if x.inspection_id = i.id and x.file_path = p_path then return jsonb_build_object('id', x.id, 'duplicate', true); end if;
    raise exception 'PHOTO_ID_USED: upload the photo again';
  end if;
  if i.status not in ('scheduled', 'in_progress') then raise exception 'INSPECTION_NOT_OPEN: photos are added before the report is submitted'; end if;
  if (select p.status from public.tk_client_projects p where p.id = i.project_id) <> 'open' then raise exception 'PROJECT_NOT_OPEN: the project is not open'; end if;
  if not public.tk_inspection_paid(i.id) then raise exception 'FEE_NOT_PAID: the inspection fee is not paid'; end if;
  if p_path is null or p_path !~ ('^' || i.project_id::text || '/' || i.id::text || '/' || p_photo::text || '\.(jpg|jpeg|png|webp)$') then
    raise exception 'INVALID_FILE: upload the photo again';
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'turnkey-inspections' and o.name = p_path;
  if not found then raise exception 'FILE_NOT_UPLOADED: upload the photo first'; end if;
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'INVALID_FILE_TYPE: take a JPG, PNG or WEBP photo'; end if;
  if v_size is null or v_size <= 0 or v_size > 10485760 then raise exception 'INVALID_FILE_SIZE: photos can be up to 10 MB'; end if;
  if p_item is not null and not exists (select 1 from public.tk_inspection_items it where it.id = p_item and it.inspection_id = i.id) then
    raise exception 'INVALID_ITEM: this checklist line is not part of the inspection';
  end if;
  if (select count(*) from public.tk_inspection_photos ph where ph.inspection_id = i.id) >= 200 then raise exception 'TOO_MANY_PHOTOS: up to 200 photos per inspection'; end if;
  insert into public.tk_inspection_photos (id, inspection_id, project_id, item_id, file_path, mime_type, size_bytes, uploaded_by)
  values (p_photo, i.id, i.project_id, p_item, p_path, v_mime, v_size, auth.uid());
  if i.status = 'scheduled' then
    update public.tk_inspections set status = 'in_progress', started_at = now(), updated_at = now() where id = i.id;
  end if;
  perform write_audit('turnkey.inspection_photo_added', 'tk_inspection_photos', p_photo::text,
    jsonb_build_object('inspection_id', i.id, 'item_id', p_item, 'mime_type', v_mime, 'size_bytes', v_size));
  return jsonb_build_object('id', p_photo, 'duplicate', false);
end $$;
revoke all on function public.tk_add_inspection_photo(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.tk_add_inspection_photo(uuid, uuid, text, uuid) to authenticated, service_role;

-- the inspector removes a photo before submitting; returns its path (the phone then removes the file: orphan policy)
create or replace function public.tk_remove_inspection_photo(p_photo uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.tk_inspection_photos;
  i public.tk_inspections;
begin
  select * into x from public.tk_inspection_photos where id = p_photo;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  select * into i from public.tk_inspections where id = x.inspection_id for update;
  if auth.uid() is null or not is_staff() or i.inspector_id is distinct from auth.uid() then raise exception 'NOT_FOUND'; end if;
  if i.status not in ('scheduled', 'in_progress') then raise exception 'INSPECTION_NOT_OPEN: photos of a submitted report cannot be removed'; end if;
  delete from public.tk_inspection_photos where id = x.id;
  perform write_audit('turnkey.inspection_photo_removed', 'tk_inspection_photos', x.id::text, jsonb_build_object('inspection_id', i.id, 'file_path', x.file_path));
  return x.file_path;
end $$;
revoke all on function public.tk_remove_inspection_photo(uuid) from public, anon;
grant execute on function public.tk_remove_inspection_photo(uuid) to authenticated, service_role;

-- the assigned inspector submits the whole report at once (idempotent by p_submission, generated on the phone):
-- {lot_size, sample_size, critical_defects, major_defects, minor_defects, result, remarks, signed_name,
--  answers: [{item_id, answer: pass|fail|na, remark}]}. Every checklist line needs an answer.
create or replace function public.tk_submit_inspection(p_inspection uuid, p_submission uuid, p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  r public.tk_inspection_reports;
  it public.tk_inspection_items;
  a jsonb;
  v_lot integer := public.tk_json_int(p_report, 'lot_size');
  v_sample integer := public.tk_json_int(p_report, 'sample_size');
  v_crit integer := public.tk_json_int(p_report, 'critical_defects');
  v_major integer := public.tk_json_int(p_report, 'major_defects');
  v_minor integer := public.tk_json_int(p_report, 'minor_defects');
  v_result text := p_report ->> 'result';
  v_remarks text := nullif(btrim(coalesce(p_report ->> 'remarks', '')), '');
  v_signed text := nullif(btrim(coalesce(p_report ->> 'signed_name', '')), '');
  v_answers jsonb := coalesce(p_report -> 'answers', '[]'::jsonb);
  v_remark text;
begin
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.id is null or auth.uid() is null or not is_staff() or i.inspector_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: only the assigned inspector submits this report';
  end if;
  if p_submission is null then raise exception 'INVALID_SUBMISSION: reload the page and submit again'; end if;
  select * into r from public.tk_inspection_reports where inspection_id = i.id;
  if i.status in ('submitted', 'published') then
    if r.submission_id = p_submission then return jsonb_build_object('status', i.status, 'duplicate', true); end if;
    raise exception 'ALREADY_SUBMITTED: this report was already submitted';
  end if;
  if r.submission_id = p_submission then raise exception 'STALE_SUBMISSION: the team returned this report; check it and submit it again'; end if;
  if exists (select 1 from public.tk_inspection_reports x where x.submission_id = p_submission) then raise exception 'INVALID_SUBMISSION: reload the page and submit again'; end if;
  if i.status not in ('scheduled', 'in_progress') then raise exception 'INSPECTION_NOT_OPEN: this inspection is not open'; end if;
  if (select p.status from public.tk_client_projects p where p.id = i.project_id) <> 'open' then raise exception 'PROJECT_NOT_OPEN: the project is not open'; end if;
  if not public.tk_inspection_paid(i.id) then raise exception 'FEE_NOT_PAID: the inspection fee is not paid'; end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' then raise exception 'INVALID_REPORT: fill in the report'; end if;
  if v_lot is null or v_lot < 1 or v_lot > 10000000 then raise exception 'INVALID_LOT_SIZE: enter the lot size (a whole number from 1)'; end if;
  if v_sample is null or v_sample < 1 then raise exception 'INVALID_SAMPLE_SIZE: enter the sample size (a whole number from 1)'; end if;
  if v_sample > v_lot then raise exception 'INVALID_SAMPLE_SIZE: the sample cannot be larger than the lot'; end if;
  if v_crit is null or v_major is null or v_minor is null or least(v_crit, v_major, v_minor) < 0 or greatest(v_crit, v_major, v_minor) > 1000000 then
    raise exception 'INVALID_DEFECTS: enter the critical, major and minor defects found (whole numbers, 0 or more)';
  end if;
  if v_result is null or v_result not in ('pass', 'pass_with_remarks', 'fail') then raise exception 'INVALID_RESULT: choose Pass, Pass with remarks or Fail'; end if;
  if v_result <> 'pass' and v_remarks is null then raise exception 'REMARKS_REQUIRED: explain the remarks or the failure'; end if;
  if v_remarks is not null and length(v_remarks) > 4000 then raise exception 'REMARKS_TOO_LONG: keep the remarks under 4,000 characters'; end if;
  if v_signed is null then raise exception 'SIGNATURE_REQUIRED: sign with your full name'; end if;
  if length(v_signed) > 120 then raise exception 'SIGNATURE_TOO_LONG: keep the name under 120 characters'; end if;
  if jsonb_typeof(v_answers) <> 'array' then raise exception 'CHECKLIST_INCOMPLETE: answer every checklist line (Pass, Fail or N/A)'; end if;
  if exists (select 1 from jsonb_array_elements(v_answers) e
              where jsonb_typeof(e) <> 'object'
                 or not exists (select 1 from public.tk_inspection_items x where x.inspection_id = i.id and x.id::text = e ->> 'item_id')) then
    raise exception 'INVALID_ITEM: a checklist answer is not part of this inspection';
  end if;
  for it in select * from public.tk_inspection_items x where x.inspection_id = i.id order by x.position loop
    select e into a from jsonb_array_elements(v_answers) e where e ->> 'item_id' = it.id::text limit 1;
    if a is null or coalesce(a ->> 'answer', '') not in ('pass', 'fail', 'na') then
      raise exception 'CHECKLIST_INCOMPLETE: answer every checklist line (Pass, Fail or N/A) — line %', it.position;
    end if;
    v_remark := nullif(btrim(coalesce(a ->> 'remark', '')), '');
    if v_remark is not null and length(v_remark) > 1000 then raise exception 'REMARK_TOO_LONG: keep each line''s remark under 1,000 characters (line %)', it.position; end if;
    update public.tk_inspection_items set answer = a ->> 'answer', remark = v_remark, answered_at = now() where id = it.id;
  end loop;
  insert into public.tk_inspection_reports (inspection_id, project_id, submission_id, lot_size, sample_size, critical_defects, major_defects, minor_defects,
    result, remarks, signed_name, submitted_by, submitted_at)
  values (i.id, i.project_id, p_submission, v_lot, v_sample, v_crit, v_major, v_minor, v_result, v_remarks, v_signed, auth.uid(), now())
  on conflict (inspection_id) do update set submission_id = excluded.submission_id, lot_size = excluded.lot_size, sample_size = excluded.sample_size,
    critical_defects = excluded.critical_defects, major_defects = excluded.major_defects, minor_defects = excluded.minor_defects, result = excluded.result,
    remarks = excluded.remarks, signed_name = excluded.signed_name, submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at, client_summary = null;
  update public.tk_inspections set status = 'submitted', submitted_at = now(), started_at = coalesce(started_at, now()), updated_at = now() where id = i.id;
  perform write_audit('turnkey.inspection_submitted', 'tk_inspections', i.id::text,
    jsonb_build_object('project_id', i.project_id, 'kind', i.kind, 'round', i.round, 'submission_id', p_submission, 'result', v_result,
                       'lot_size', v_lot, 'sample_size', v_sample, 'critical', v_crit, 'major', v_major, 'minor', v_minor));
  return jsonb_build_object('status', 'submitted', 'duplicate', false);
end $$;
revoke all on function public.tk_submit_inspection(uuid, uuid, jsonb) from public, anon;
grant execute on function public.tk_submit_inspection(uuid, uuid, jsonb) to authenticated, service_role;

-- ───────── 7. staff review: return, publish, PSI override ─────────
create or replace function public.tk_return_inspection(p_inspection uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into i from public.tk_inspections where id = p_inspection;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors review reports'; end if;
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.status <> 'submitted' then raise exception 'NOT_SUBMITTED: there is no submitted report to return'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell the inspector what to check'; end if;
  if length(v_reason) > 1000 then raise exception 'REASON_TOO_LONG: keep the reason under 1,000 characters'; end if;
  update public.tk_inspections set status = 'in_progress', returned_reason = v_reason, updated_at = now() where id = i.id;
  perform write_audit('turnkey.inspection_returned', 'tk_inspections', i.id::text, jsonb_build_object('code', v.code, 'kind', i.kind, 'round', i.round, 'reason', v_reason));
end $$;
revoke all on function public.tk_return_inspection(uuid, text) from public, anon;
grant execute on function public.tk_return_inspection(uuid, text) to authenticated, service_role;

-- another Turnkey editor (never the inspector) publishes the report with the client summary; photos in p_hide_photos are
-- not shown to the client. Client-visible text that names a factory of the project is refused.
create or replace function public.tk_publish_inspection(p_inspection uuid, p_summary text, p_hide_photos uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  v public.tk_client_projects;
  r public.tk_inspection_reports;
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
begin
  select * into i from public.tk_inspections where id = p_inspection;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors publish reports'; end if;
  select * into i from public.tk_inspections where id = p_inspection for update;
  if i.status <> 'submitted' then raise exception 'NOT_SUBMITTED: the inspector has not submitted this report'; end if;
  if i.inspector_id = auth.uid() then raise exception 'REVIEW_BY_ANOTHER: another team member reviews and publishes your report'; end if;
  if v_summary is null then raise exception 'SUMMARY_REQUIRED: write the summary the client reads'; end if;
  if length(v_summary) > 4000 then raise exception 'SUMMARY_TOO_LONG: keep the summary under 4,000 characters'; end if;
  if public.tk_names_supplier(v.id, v_summary) then raise exception 'SUPPLIER_NAME_SHOWN: the summary names the factory; the client never sees factory names'; end if;
  if exists (select 1 from public.tk_inspection_items it where it.inspection_id = i.id and public.tk_names_supplier(v.id, it.label)) then
    raise exception 'SUPPLIER_NAME_SHOWN: a checklist line names the factory; the client sees these lines';
  end if;
  select * into r from public.tk_inspection_reports where inspection_id = i.id for update;
  if r.inspection_id is null then raise exception 'NOT_SUBMITTED: the inspector has not submitted this report'; end if;
  update public.tk_inspection_photos set client_visible = not (id = any(coalesce(p_hide_photos, '{}'::uuid[]))) where inspection_id = i.id;
  update public.tk_inspection_reports set client_summary = v_summary, published_at = now() where inspection_id = i.id;
  update public.tk_inspections set status = 'published', published_at = now(), published_by = auth.uid(), updated_at = now() where id = i.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'inspection', 'production_qc', public.tk_inspection_label(i.kind, i.round) || ' report: ' ||
          case r.result when 'pass' then 'Passed.' when 'pass_with_remarks' then 'Passed with remarks.' else 'Failed.' end ||
          case when r.result = 'fail' and i.kind = 'pre_shipment' then ' Shipment waits until a re-inspection passes; your account manager will contact you.' else '' end);
  perform write_audit('turnkey.inspection_published', 'tk_inspections', i.id::text,
    jsonb_build_object('code', v.code, 'kind', i.kind, 'round', i.round, 'result', r.result, 'hidden_photos', coalesce(array_length(p_hide_photos, 1), 0)));
end $$;
revoke all on function public.tk_publish_inspection(uuid, text, uuid[]) from public, anon;
grant execute on function public.tk_publish_inspection(uuid, text, uuid[]) to authenticated, service_role;

-- an admin (2FA) who was not the inspector lets the project go to Shipment despite the latest failed pre-shipment
-- inspection, with a reason (staff-only)
create or replace function public.tk_override_psi(p_inspection uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
  v public.tk_client_projects;
  v_result text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not is_admin() then raise exception 'FORBIDDEN: only admins override a failed inspection'; end if;
  select * into i from public.tk_inspections where id = p_inspection;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_view(v.id) then raise exception 'NOT_FOUND'; end if;
  select * into i from public.tk_inspections where id = p_inspection for update;
  select r.result into v_result from public.tk_inspection_reports r where r.inspection_id = i.id;
  if i.kind <> 'pre_shipment' or i.status <> 'published' or v_result is distinct from 'fail' then
    raise exception 'NOT_A_FAILED_PSI: only a published failed pre-shipment inspection can be overridden';
  end if;
  if exists (select 1 from public.tk_inspections x where x.project_id = i.project_id and x.kind = 'pre_shipment' and x.status <> 'cancelled' and x.round > i.round) then
    raise exception 'NOT_LATEST: a newer pre-shipment inspection exists';
  end if;
  if i.override_by is not null then raise exception 'ALREADY_OVERRIDDEN'; end if;
  if i.inspector_id = auth.uid() then raise exception 'TWO_PERSON_REQUIRED: the inspector cannot override their own inspection'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why shipment may go ahead'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  update public.tk_inspections set override_by = auth.uid(), override_at = now(), override_reason = v_reason, updated_at = now() where id = i.id;
  perform write_audit('turnkey.psi_override', 'tk_inspections', i.id::text, jsonb_build_object('code', v.code, 'round', i.round, 'reason', v_reason, 'inspector', i.inspector_id));
end $$;
revoke all on function public.tk_override_psi(uuid, text) from public, anon;
grant execute on function public.tk_override_psi(uuid, text) to authenticated, service_role;

-- ───────── 8. reads ─────────
-- staff view of a project's inspections (factory, inspector, fees with who / when, report, photos) + inspector choices
create or replace function public.tk_staff_inspections(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'inspections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'round', i.round, 'status', i.status, 'scheduled_on', i.scheduled_on, 'factory_name', i.factory_name,
        'factory_address', i.factory_address, 'brief', i.brief, 'created_at', i.created_at, 'created_by_name', coalesce(nullif(btrim(pc.full_name), ''), pc.email),
        'inspector_id', i.inspector_id, 'inspector_name', coalesce(nullif(btrim(pn.full_name), ''), pn.email), 'scheduled_at', i.scheduled_at,
        'started_at', i.started_at, 'submitted_at', i.submitted_at, 'returned_reason', i.returned_reason, 'published_at', i.published_at,
        'published_by_name', coalesce(nullif(btrim(pp.full_name), ''), pp.email), 'cancelled_at', i.cancelled_at, 'cancel_reason', i.cancel_reason,
        'override_at', i.override_at, 'override_reason', i.override_reason, 'override_by_name', coalesce(nullif(btrim(po.full_name), ''), po.email),
        'paid', public.tk_inspection_paid(i.id),
        'phase_fee', (select jsonb_build_object('id', f.id, 'amount_cents', f.amount_cents, 'status', f.status, 'document_number', d.number, 'paid', public.tk_fee_is_paid(f.document_id))
                        from public.tk_project_fees f left join public.documents d on d.id = f.document_id where f.id = i.phase_fee_id),
        'fees', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'version', f.version, 'service_code', f.service_code, 'amount_cents', f.amount_cents,
            'starting_cents', f.starting_cents, 'needs_approval', f.needs_approval, 'status', f.status, 'note', f.note, 'proposed_by', f.proposed_by,
            'proposed_by_name', coalesce(nullif(btrim(fp.full_name), ''), fp.email), 'proposed_at', f.proposed_at,
            'approved_by_name', coalesce(nullif(btrim(fa.full_name), ''), fa.email), 'approved_at', f.approved_at,
            'rejected_by_name', coalesce(nullif(btrim(fr.full_name), ''), fr.email), 'rejected_at', f.rejected_at, 'reject_reason', f.reject_reason,
            'withdrawn_at', f.withdrawn_at, 'document_id', f.document_id, 'document_number', d.number, 'document_status', d.status, 'paid_cents', d.paid_cents,
            'paid', public.tk_fee_is_paid(f.document_id)) order by f.version desc)
          from public.tk_inspection_fees f left join public.documents d on d.id = f.document_id
          left join public.profiles fp on fp.id = f.proposed_by left join public.profiles fa on fa.id = f.approved_by left join public.profiles fr on fr.id = f.rejected_by
          where f.inspection_id = i.id), '[]'::jsonb),
        'items', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'position', it.position, 'label', it.label, 'answer', it.answer, 'remark', it.remark) order by it.position)
          from public.tk_inspection_items it where it.inspection_id = i.id), '[]'::jsonb),
        'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'item_id', ph.item_id, 'file_path', ph.file_path, 'mime_type', ph.mime_type,
            'size_bytes', ph.size_bytes, 'client_visible', ph.client_visible, 'created_at', ph.created_at) order by ph.created_at, ph.id)
          from public.tk_inspection_photos ph where ph.inspection_id = i.id), '[]'::jsonb),
        'report', (select jsonb_build_object('lot_size', r.lot_size, 'sample_size', r.sample_size, 'critical_defects', r.critical_defects, 'major_defects', r.major_defects,
            'minor_defects', r.minor_defects, 'result', r.result, 'remarks', r.remarks, 'signed_name', r.signed_name, 'submitted_at', r.submitted_at,
            'client_summary', r.client_summary, 'published_at', r.published_at) from public.tk_inspection_reports r where r.inspection_id = i.id)
      ) order by case i.kind when 'factory_audit' then 1 else 2 end, i.round)
      from public.tk_inspections i
      left join public.profiles pc on pc.id = i.created_by left join public.profiles pn on pn.id = i.inspector_id
      left join public.profiles pp on pp.id = i.published_by left join public.profiles po on po.id = i.override_by
     where i.project_id = p_project), '[]'::jsonb),
    'inspectors', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.id, 'full_name', coalesce(nullif(btrim(x.full_name), ''), x.email)) order by coalesce(nullif(btrim(x.full_name), ''), x.email))
      from public.profiles x where exists (select 1 from public.user_roles ur where ur.user_id = x.id) and public.tk_is_inspector(x.id)), '[]'::jsonb),
    'phase_fee_available', (select f.id from public.tk_project_fees f
      where f.project_id = p_project and f.stage = 'production_qc' and f.service_code = 'factory_audit' and f.status = 'active' and public.tk_fee_is_paid(f.document_id)
        and not exists (select 1 from public.tk_inspections i where i.phase_fee_id = f.id and i.status <> 'cancelled') limit 1));
end $$;
revoke all on function public.tk_staff_inspections(uuid) from public, anon;
grant execute on function public.tk_staff_inspections(uuid) to authenticated, service_role;

-- the signed-in inspector's inspections (assigned to them; the last 30 days of published ones)
create or replace function public.tk_my_inspections()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not is_staff() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'round', i.round, 'status', i.status, 'scheduled_on', i.scheduled_on,
             'project_code', p.code, 'project_title', p.title, 'factory_name', i.factory_name, 'factory_address', i.factory_address)
           order by (i.status in ('scheduled', 'in_progress')) desc, i.scheduled_on, i.round)
      from public.tk_inspections i join public.tk_client_projects p on p.id = i.project_id
     where i.inspector_id = auth.uid()
       and (i.status in ('scheduled', 'in_progress', 'submitted') or (i.status = 'published' and i.published_at > now() - interval '30 days'))), '[]'::jsonb) end;
$$;
revoke all on function public.tk_my_inspections() from public, anon;
grant execute on function public.tk_my_inspections() to authenticated, service_role;

-- one inspection for its assigned inspector (the phone screen)
create or replace function public.tk_inspector_job(p_inspection uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  i public.tk_inspections;
begin
  select * into i from public.tk_inspections where id = p_inspection;
  if i.id is null or auth.uid() is null or not is_staff() or i.inspector_id is distinct from auth.uid() then raise exception 'NOT_FOUND'; end if;
  return (select jsonb_build_object(
    'id', i.id, 'project_id', i.project_id, 'project_code', p.code, 'project_title', p.title, 'project_open', p.status = 'open',
    'kind', i.kind, 'round', i.round, 'status', i.status, 'scheduled_on', i.scheduled_on, 'factory_name', i.factory_name,
    'factory_address', i.factory_address, 'brief', i.brief, 'returned_reason', i.returned_reason, 'paid', public.tk_inspection_paid(i.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'position', it.position, 'label', it.label, 'answer', it.answer, 'remark', it.remark) order by it.position)
      from public.tk_inspection_items it where it.inspection_id = i.id), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'item_id', ph.item_id, 'file_path', ph.file_path, 'created_at', ph.created_at) order by ph.created_at, ph.id)
      from public.tk_inspection_photos ph where ph.inspection_id = i.id), '[]'::jsonb),
    'report', (select jsonb_build_object('submission_id', r.submission_id, 'lot_size', r.lot_size, 'sample_size', r.sample_size, 'critical_defects', r.critical_defects,
        'major_defects', r.major_defects, 'minor_defects', r.minor_defects, 'result', r.result, 'remarks', r.remarks, 'signed_name', r.signed_name,
        'submitted_at', r.submitted_at) from public.tk_inspection_reports r where r.inspection_id = i.id))
    from public.tk_client_projects p where p.id = i.project_id);
end $$;
revoke all on function public.tk_inspector_job(uuid) from public, anon;
grant execute on function public.tk_inspector_job(uuid) to authenticated, service_role;

-- admin queue: inspection fees above 2x the starting fee waiting for approval
create or replace function public.tk_list_inspection_fee_approvals()
returns table (
  id uuid, project_code text, project_title text, client_name text, kind text, round smallint, service_name text, version integer,
  amount_cents bigint, starting_cents bigint, note text, proposed_by uuid, proposed_by_name text, proposed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN: admins only'; end if;
  return query
    select f.id, p.code, p.title, o.name, i.kind, i.round, s.name, f.version, f.amount_cents, f.starting_cents, f.note, f.proposed_by,
           coalesce(nullif(btrim(pp.full_name), ''), pp.email), f.proposed_at
      from public.tk_inspection_fees f
      join public.tk_inspections i on i.id = f.inspection_id
      join public.tk_client_projects p on p.id = f.project_id
      left join public.organizations o on o.id = p.org_id
      left join public.tk_services s on s.code = f.service_code
      left join public.profiles pp on pp.id = f.proposed_by
     where f.status = 'pending_approval' and f.needs_approval
     order by f.proposed_at;
end $$;
revoke all on function public.tk_list_inspection_fee_approvals() from public, anon;
grant execute on function public.tk_list_inspection_fee_approvals() to authenticated, service_role;

-- ───────── 9. phase gate (T4 function; Production and QC completes with a passed, published pre-shipment inspection) ─────────
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
  v_psi public.tk_inspections;
  v_psi_result text;
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
  -- T4: Design is complete when the client has approved a layout drawing version; Quote and deposit is complete when the
  -- client has accepted a quote and its deposit is fully paid
  if v_to > v_from and v.stage = 'design'
     and not exists (select 1 from public.tk_drawing_versions d where d.project_id = v.id and d.status = 'approved') then
    raise exception 'DRAWING_NOT_APPROVED: Design is complete when the client approves a layout drawing version';
  end if;
  if v_to > v_from and v.stage = 'quote_deposit' then
    if not exists (select 1 from public.tk_client_quotes q where q.project_id = v.id and q.status = 'accepted') then
      raise exception 'QUOTE_NOT_ACCEPTED: Quote and deposit is complete when the client accepts a quote';
    end if;
    if not exists (select 1 from public.tk_client_quotes q where q.project_id = v.id and q.status = 'accepted' and public.tk_fee_is_paid(q.document_id)) then
      raise exception 'DEPOSIT_NOT_PAID: Quote and deposit is complete when the client has paid the deposit in full';
    end if;
  end if;
  -- T5: Production and QC is complete when the latest pre-shipment inspection is published with a pass (or pass with
  -- remarks); a failed one blocks Shipment until a re-inspection passes or an admin who was not its inspector overrides it
  if v_to > v_from and v.stage = 'production_qc' then
    select * into v_psi from public.tk_inspections i
     where i.project_id = v.id and i.kind = 'pre_shipment' and i.status <> 'cancelled' order by i.round desc limit 1;
    if v_psi.id is null then
      raise exception 'PSI_REQUIRED: Production and QC is complete when a pre-shipment inspection has passed and its report is published';
    end if;
    if v_psi.status <> 'published' then
      raise exception 'PSI_NOT_PUBLISHED: Production and QC is complete when the pre-shipment inspection report is published';
    end if;
    select r.result into v_psi_result from public.tk_inspection_reports r where r.inspection_id = v_psi.id;
    if v_psi_result = 'fail' and v_psi.override_by is null then
      raise exception 'PSI_FAILED: the pre-shipment inspection failed; shipment waits for a passed re-inspection (or an admin override with a reason)';
    end if;
  end if;
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
