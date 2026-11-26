-- 20261101000232_t4_turnkey_drawings_quotes.sql   (renumber at install)
-- Turnkey T4 (docs/design/turnkey-v2: Design "layout drawing, 3 free versions, then 50% of the drawing fee per extra
-- version"; Drawing / ChangeRequest screens; Sourcing "quotes from suppliers, hidden from the client"; Quote and deposit
-- "the client approves the quote and pays the deposit"; programme D5: the 2x approval rule is for service fees only,
-- the deposit % comes from settings).
--  1. Layout drawing versions: staff (Turnkey editors, TK division, 2FA) upload a PDF / image to the PRIVATE bucket
--     turnkey-drawings (path <project id>/<file>) and register it as the next numbered version (tk_drawing_versions).
--     The client opens it through a short signed URL, comments, approves it or asks for changes. Versions 1-3 are free.
--     When the client asks for changes on version 3 or later, the next version is an extra version: a charge of 50% of
--     the project's active layout drawing fee (rounded half up to the cent) is created at once (derived from an approved
--     fee, so no admin approval: D5) and its proforma issued through the same proforma path as T3 fees
--     (tk_issue_project_proforma = tk_issue_fee_proforma's steps with its own label / reference). The extra version can
--     be uploaded only after that proforma is fully paid, or after an ADMIN waives it with a reason (proforma voided with
--     a balanced reversal through T3's tk_void_fee_document).
--     The approved version completes Design: tk_move_project_stage refuses to leave Design until one is approved.
--  2. Quotes (white-label): factory quotes (supplier name, reference, cost lines) live in staff-only tables
--     (tk_factory_quotes, tk_factory_quote_lines). Staff build the client quote (tk_client_quotes + tk_client_quote_lines:
--     description, qty, unit price, total) in versions; each client line may record its cost / source factory line in the
--     staff-only tk_client_quote_line_costs, so the margin is visible to staff only. A client line or message that names
--     a supplier of the project is refused (SUPPLIER_NAME_SHOWN). Sending a quote freezes the deposit % from the setting
--     turnkey.deposit_pct (site_settings; the design gives no value, so it is NOT set here: sending is refused with
--     DEPOSIT_NOT_SET until an admin sets it). The client accepts a sent version (or asks for changes); acceptance issues
--     the deposit proforma (same proforma path; paid by wallet with pay_service_proforma or by bank transfer recorded by
--     Finance). tk_move_project_stage refuses to leave Quote and deposit until a quote is accepted and its deposit fully
--     paid. The balance invoice is a later step.
-- Every write goes through a security definer function (search_path = public; not for anon); every change is audited.
-- Down: supabase/migrations/down/20261101000232_t4_turnkey_drawings_quotes.down.sql

-- ───────── 0. client history kinds ─────────
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date', 'fee', 'manager', 'drawing', 'quote'));

-- ───────── 1. drawing versions ─────────
create table if not exists public.tk_drawing_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  version smallint not null check (version between 1 and 99),
  file_path text not null unique check (length(file_path) between 3 and 400),
  file_name text not null check (btrim(file_name) <> '' and length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  message text check (message is null or length(message) <= 1000),
  status text not null default 'shared' check (status in ('shared', 'approved', 'changes_requested')),
  shared_at timestamptz not null default now(),
  decided_at timestamptz,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tk_drawing_versions_decided check ((status = 'shared') = (decided_at is null)),
  constraint tk_drawing_versions_path_in_project check (split_part(file_path, '/', 1) = project_id::text)
);
create unique index if not exists tk_drawing_versions_version_idx on public.tk_drawing_versions (project_id, version);
create unique index if not exists tk_drawing_versions_one_open_idx on public.tk_drawing_versions (project_id) where status = 'shared';
create unique index if not exists tk_drawing_versions_one_approved_idx on public.tk_drawing_versions (project_id) where status = 'approved';
create index if not exists tk_drawing_versions_uploaded_by_idx on public.tk_drawing_versions (uploaded_by);
comment on table public.tk_drawing_versions is 'Turnkey T4: layout drawing versions per client project (file in the private turnkey-drawings bucket). Customers read the client columns; the uploader is read by staff through tk_staff_drawings().';
alter table public.tk_drawing_versions enable row level security;
revoke all on public.tk_drawing_versions from public, anon, authenticated;
grant select (id, project_id, version, file_path, file_name, mime_type, size_bytes, message, status, shared_at, decided_at, created_at)
  on public.tk_drawing_versions to authenticated;
grant all on public.tk_drawing_versions to service_role;
drop policy if exists tk_drawing_versions_read on public.tk_drawing_versions;
create policy tk_drawing_versions_read on public.tk_drawing_versions for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

create table if not exists public.tk_drawing_comments (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  version_id uuid not null references public.tk_drawing_versions(id) on delete cascade,
  from_staff boolean not null,
  kind text not null default 'comment' check (kind in ('comment', 'changes', 'approval')),
  body text not null check (btrim(body) <> '' and length(body) <= 2000),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tk_drawing_comments_version_idx on public.tk_drawing_comments (version_id, created_at);
create index if not exists tk_drawing_comments_project_idx on public.tk_drawing_comments (project_id);
create index if not exists tk_drawing_comments_author_idx on public.tk_drawing_comments (author_id);
comment on table public.tk_drawing_comments is 'Turnkey T4: comments on a drawing version (client and staff). The author id is staff-only (tk_staff_drawings()).';
alter table public.tk_drawing_comments enable row level security;
revoke all on public.tk_drawing_comments from public, anon, authenticated;
grant select (id, project_id, version_id, from_staff, kind, body, created_at) on public.tk_drawing_comments to authenticated;
grant all on public.tk_drawing_comments to service_role;
drop policy if exists tk_drawing_comments_read on public.tk_drawing_comments;
create policy tk_drawing_comments_read on public.tk_drawing_comments for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

create table if not exists public.tk_drawing_extra_fees (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  for_version smallint not null check (for_version between 4 and 99),
  requested_on uuid not null references public.tk_drawing_versions(id) on delete cascade,
  base_fee_id uuid not null references public.tk_project_fees(id),
  base_cents bigint not null check (base_cents > 0),
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  status text not null default 'open' check (status in ('open', 'waived')),
  document_id uuid not null references public.documents(id) on delete restrict,
  waived_by uuid references auth.users(id) on delete restrict,
  waived_at timestamptz,
  waive_reason text check (waive_reason is null or length(waive_reason) <= 500),
  created_at timestamptz not null default now(),
  constraint tk_drawing_extra_fees_half check (amount_cents = (base_cents + 1) / 2),
  constraint tk_drawing_extra_fees_waived check (
    (status = 'open' and waived_by is null and waived_at is null and waive_reason is null)
    or (status = 'waived' and waived_by is not null and waived_at is not null and nullif(btrim(coalesce(waive_reason, '')), '') is not null))
);
create unique index if not exists tk_drawing_extra_fees_version_idx on public.tk_drawing_extra_fees (project_id, for_version);
create index if not exists tk_drawing_extra_fees_document_idx on public.tk_drawing_extra_fees (document_id);
create index if not exists tk_drawing_extra_fees_base_idx on public.tk_drawing_extra_fees (base_fee_id);
create index if not exists tk_drawing_extra_fees_requested_idx on public.tk_drawing_extra_fees (requested_on);
create index if not exists tk_drawing_extra_fees_waived_by_idx on public.tk_drawing_extra_fees (waived_by);
comment on table public.tk_drawing_extra_fees is 'Turnkey T4: extra drawing version charge (version 4 on): 50% of the active layout drawing fee, proforma issued at once; paid via pay_service_proforma or waived by an admin with a reason (staff-only columns).';
alter table public.tk_drawing_extra_fees enable row level security;
revoke all on public.tk_drawing_extra_fees from public, anon, authenticated;
grant select (id, project_id, for_version, base_cents, amount_cents, currency, status, document_id, created_at) on public.tk_drawing_extra_fees to authenticated;
grant all on public.tk_drawing_extra_fees to service_role;
drop policy if exists tk_drawing_extra_fees_read on public.tk_drawing_extra_fees;
create policy tk_drawing_extra_fees_read on public.tk_drawing_extra_fees for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

-- ───────── 2. quotes ─────────
-- staff only: factory quotes (supplier, costs)
create table if not exists public.tk_factory_quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  supplier_name text not null check (btrim(supplier_name) <> '' and length(supplier_name) <= 200),
  supplier_ref text check (supplier_ref is null or length(supplier_ref) <= 120),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  valid_until date,
  notes text check (notes is null or length(notes) <= 2000),
  total_cost_cents bigint not null check (total_cost_cents >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists tk_factory_quotes_project_idx on public.tk_factory_quotes (project_id, created_at);
create index if not exists tk_factory_quotes_created_by_idx on public.tk_factory_quotes (created_by);
comment on table public.tk_factory_quotes is 'Turnkey T4: quotes received from factories (supplier and costs). Staff only — never shown to clients (white-label).';
alter table public.tk_factory_quotes enable row level security;
revoke all on public.tk_factory_quotes from public, anon, authenticated;
grant select on public.tk_factory_quotes to authenticated;
grant all on public.tk_factory_quotes to service_role;
drop policy if exists tk_factory_quotes_read on public.tk_factory_quotes;
create policy tk_factory_quotes_read on public.tk_factory_quotes for select to authenticated
  using (is_staff() and public.tk_staff_can_view(project_id));

create table if not exists public.tk_factory_quote_lines (
  id uuid primary key default gen_random_uuid(),
  factory_quote_id uuid not null references public.tk_factory_quotes(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  line_no smallint not null check (line_no between 1 and 200),
  description text not null check (btrim(description) <> '' and length(description) <= 500),
  qty integer not null check (qty between 1 and 1000000),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0 and unit_cost_cents <= 10000000000),
  total_cost_cents bigint not null,
  constraint tk_factory_quote_lines_total check (total_cost_cents = qty * unit_cost_cents)
);
create unique index if not exists tk_factory_quote_lines_no_idx on public.tk_factory_quote_lines (factory_quote_id, line_no);
create index if not exists tk_factory_quote_lines_project_idx on public.tk_factory_quote_lines (project_id);
comment on table public.tk_factory_quote_lines is 'Turnkey T4: factory quote lines with costs. Staff only.';
alter table public.tk_factory_quote_lines enable row level security;
revoke all on public.tk_factory_quote_lines from public, anon, authenticated;
grant select on public.tk_factory_quote_lines to authenticated;
grant all on public.tk_factory_quote_lines to service_role;
drop policy if exists tk_factory_quote_lines_read on public.tk_factory_quote_lines;
create policy tk_factory_quote_lines_read on public.tk_factory_quote_lines for select to authenticated
  using (is_staff() and public.tk_staff_can_view(project_id));

-- client quote (versions): only what the client may see
create table if not exists public.tk_client_quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  version smallint not null check (version between 1 and 99),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'changes_requested', 'superseded', 'withdrawn')),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  total_cents bigint not null default 0 check (total_cents >= 0 and total_cents <= 100000000000),
  deposit_pct smallint check (deposit_pct is null or deposit_pct between 1 and 100),
  deposit_cents bigint check (deposit_cents is null or deposit_cents > 0),
  message text check (message is null or length(message) <= 2000),
  client_comment text check (client_comment is null or length(client_comment) <= 2000),
  valid_until date,
  document_id uuid references public.documents(id) on delete restrict,
  sent_at timestamptz,
  decided_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  sent_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tk_client_quotes_sent_terms check (status = 'draft' or (sent_at is not null and sent_by is not null and deposit_pct is not null and deposit_cents is not null and total_cents > 0)),
  constraint tk_client_quotes_deposit check (deposit_pct is null or deposit_cents = (total_cents * deposit_pct + 50) / 100),
  constraint tk_client_quotes_draft_clean check (status <> 'draft' or (sent_at is null and sent_by is null and document_id is null and decided_at is null and deposit_pct is null)),
  constraint tk_client_quotes_accepted check (status <> 'accepted' or (document_id is not null and decided_at is not null)),
  constraint tk_client_quotes_doc_only_accepted check (document_id is null or status = 'accepted')
);
create unique index if not exists tk_client_quotes_version_idx on public.tk_client_quotes (project_id, version);
create unique index if not exists tk_client_quotes_one_draft_idx on public.tk_client_quotes (project_id) where status = 'draft';
create unique index if not exists tk_client_quotes_one_sent_idx on public.tk_client_quotes (project_id) where status = 'sent';
create unique index if not exists tk_client_quotes_one_accepted_idx on public.tk_client_quotes (project_id) where status = 'accepted';
create index if not exists tk_client_quotes_document_idx on public.tk_client_quotes (document_id);
create index if not exists tk_client_quotes_created_by_idx on public.tk_client_quotes (created_by);
create index if not exists tk_client_quotes_sent_by_idx on public.tk_client_quotes (sent_by);
comment on table public.tk_client_quotes is 'Turnkey T4: the client quote in versions (white-label: no supplier, no cost, no margin). Drafts are staff-only; the creator / sender are read by staff through tk_staff_quotes().';
alter table public.tk_client_quotes enable row level security;
revoke all on public.tk_client_quotes from public, anon, authenticated;
grant select (id, project_id, version, status, currency, total_cents, deposit_pct, deposit_cents, message, client_comment, valid_until, document_id, sent_at, decided_at, created_at)
  on public.tk_client_quotes to authenticated;
grant all on public.tk_client_quotes to service_role;
drop policy if exists tk_client_quotes_read on public.tk_client_quotes;
create policy tk_client_quotes_read on public.tk_client_quotes for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id) and (status <> 'draft' or public.tk_staff_can_view(project_id)));

create table if not exists public.tk_client_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.tk_client_quotes(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  line_no smallint not null check (line_no between 1 and 200),
  description text not null check (btrim(description) <> '' and length(description) <= 500),
  qty integer not null check (qty between 1 and 1000000),
  unit_price_cents bigint not null check (unit_price_cents > 0 and unit_price_cents <= 10000000000),
  total_cents bigint not null,
  constraint tk_client_quote_lines_total check (total_cents = qty * unit_price_cents)
);
create unique index if not exists tk_client_quote_lines_no_idx on public.tk_client_quote_lines (quote_id, line_no);
create index if not exists tk_client_quote_lines_project_idx on public.tk_client_quote_lines (project_id);
comment on table public.tk_client_quote_lines is 'Turnkey T4: client quote lines (description, qty, unit price, total). No supplier or cost.';
alter table public.tk_client_quote_lines enable row level security;
revoke all on public.tk_client_quote_lines from public, anon, authenticated;
grant select (id, quote_id, project_id, line_no, description, qty, unit_price_cents, total_cents) on public.tk_client_quote_lines to authenticated;
grant all on public.tk_client_quote_lines to service_role;
drop policy if exists tk_client_quote_lines_read on public.tk_client_quote_lines;
create policy tk_client_quote_lines_read on public.tk_client_quote_lines for select to authenticated
  using (exists (select 1 from public.tk_client_quotes q where q.id = quote_id));

-- staff only: cost behind each client line (margin = line total - cost)
create table if not exists public.tk_client_quote_line_costs (
  line_id uuid primary key references public.tk_client_quote_lines(id) on delete cascade,
  quote_id uuid not null references public.tk_client_quotes(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  factory_line_id uuid references public.tk_factory_quote_lines(id),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0 and unit_cost_cents <= 10000000000),
  cost_cents bigint not null check (cost_cents >= 0)
);
create index if not exists tk_client_quote_line_costs_quote_idx on public.tk_client_quote_line_costs (quote_id);
create index if not exists tk_client_quote_line_costs_project_idx on public.tk_client_quote_line_costs (project_id);
create index if not exists tk_client_quote_line_costs_factory_idx on public.tk_client_quote_line_costs (factory_line_id);
comment on table public.tk_client_quote_line_costs is 'Turnkey T4: the cost (and source factory line) behind a client quote line. Staff only (margin).';
alter table public.tk_client_quote_line_costs enable row level security;
revoke all on public.tk_client_quote_line_costs from public, anon, authenticated;
grant select on public.tk_client_quote_line_costs to authenticated;
grant all on public.tk_client_quote_line_costs to service_role;
drop policy if exists tk_client_quote_line_costs_read on public.tk_client_quote_line_costs;
create policy tk_client_quote_line_costs_read on public.tk_client_quote_line_costs for select to authenticated
  using (is_staff() and public.tk_staff_can_view(project_id));

-- ───────── 3. history is never rewritten (guards) ─────────
create or replace function public.tk_t4_history_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;   -- cascade from a deleted project / quote (owner-only clean-up)
    if tg_table_name = 'tk_client_quotes' then
      if old.status = 'draft' then return old; end if;
    elsif tg_table_name in ('tk_client_quote_lines', 'tk_client_quote_line_costs') then
      if (select q.status from public.tk_client_quotes q where q.id = old.quote_id) = 'draft' then return old; end if;
    end if;
    raise exception 'TK_HISTORY_KEPT: % rows are never deleted', tg_table_name;
  end if;
  if tg_table_name in ('tk_client_quote_lines', 'tk_client_quote_line_costs') then
    select q.status into v_parent from public.tk_client_quotes q where q.id = new.quote_id;
    if v_parent is distinct from 'draft' then raise exception 'QUOTE_SENT: a sent quote cannot be changed; make a new version'; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then return new; end if;
  if tg_table_name in ('tk_drawing_comments', 'tk_factory_quotes', 'tk_factory_quote_lines') then
    raise exception 'TK_HISTORY_KEPT: % rows cannot be rewritten', tg_table_name;
  elsif tg_table_name = 'tk_drawing_versions' then
    if (to_jsonb(new) - 'status' - 'decided_at') is distinct from (to_jsonb(old) - 'status' - 'decided_at')
       or (old.status <> 'shared' and to_jsonb(new) is distinct from to_jsonb(old)) then
      raise exception 'TK_HISTORY_KEPT: a shared drawing version cannot be rewritten; upload a new version';
    end if;
  elsif tg_table_name = 'tk_drawing_extra_fees' then
    if (to_jsonb(new) - 'status' - 'waived_by' - 'waived_at' - 'waive_reason') is distinct from (to_jsonb(old) - 'status' - 'waived_by' - 'waived_at' - 'waive_reason')
       or (old.status <> 'open' and to_jsonb(new) is distinct from to_jsonb(old)) then
      raise exception 'TK_HISTORY_KEPT: an extra version charge cannot be rewritten';
    end if;
  elsif tg_table_name = 'tk_client_quotes' then
    if old.status <> 'draft' then
      if (to_jsonb(new) - 'status' - 'client_comment' - 'document_id' - 'decided_at' - 'updated_at')
           is distinct from (to_jsonb(old) - 'status' - 'client_comment' - 'document_id' - 'decided_at' - 'updated_at')
         or old.status <> 'sent' and to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
        raise exception 'TK_HISTORY_KEPT: a sent quote cannot be rewritten; make a new version';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tk_t4_history_guard() from public, anon, authenticated;
drop trigger if exists trg_tk_drawing_versions_guard on public.tk_drawing_versions;
create trigger trg_tk_drawing_versions_guard before update or delete on public.tk_drawing_versions for each row execute function public.tk_t4_history_guard();
drop trigger if exists trg_tk_drawing_comments_guard on public.tk_drawing_comments;
create trigger trg_tk_drawing_comments_guard before update or delete on public.tk_drawing_comments for each row execute function public.tk_t4_history_guard();
drop trigger if exists trg_tk_drawing_extra_fees_guard on public.tk_drawing_extra_fees;
create trigger trg_tk_drawing_extra_fees_guard before update or delete on public.tk_drawing_extra_fees for each row execute function public.tk_t4_history_guard();
drop trigger if exists trg_tk_factory_quotes_guard on public.tk_factory_quotes;
create trigger trg_tk_factory_quotes_guard before update or delete on public.tk_factory_quotes for each row execute function public.tk_t4_history_guard();
drop trigger if exists trg_tk_factory_quote_lines_guard on public.tk_factory_quote_lines;
create trigger trg_tk_factory_quote_lines_guard before update or delete on public.tk_factory_quote_lines for each row execute function public.tk_t4_history_guard();
drop trigger if exists trg_tk_client_quotes_guard on public.tk_client_quotes;
create trigger trg_tk_client_quotes_guard before update or delete on public.tk_client_quotes for each row execute function public.tk_t4_history_guard();
drop trigger if exists trg_tk_client_quote_lines_guard on public.tk_client_quote_lines;
create trigger trg_tk_client_quote_lines_guard before insert or update or delete on public.tk_client_quote_lines for each row execute function public.tk_t4_history_guard();
drop trigger if exists trg_tk_client_quote_line_costs_guard on public.tk_client_quote_line_costs;
create trigger trg_tk_client_quote_line_costs_guard before insert or update or delete on public.tk_client_quote_line_costs for each row execute function public.tk_t4_history_guard();

-- ───────── 4. helpers ─────────
-- the signed-in person is a customer (not staff) of the project's company
create or replace function public.tk_is_project_customer(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from public.user_roles ur join public.roles r on r.code = ur.role_code where ur.user_id = auth.uid() and r.is_staff)
     and exists (select 1 from public.tk_client_projects p where p.id = p_project and p.org_id is not null and p.org_id in (select my_org_ids()));
$$;
revoke all on function public.tk_is_project_customer(uuid) from public, anon;
grant execute on function public.tk_is_project_customer(uuid) to authenticated, service_role;

-- issues a turnkey proforma for the project's company: the same steps, numbering and journal as tk_issue_fee_proforma
-- (T3) / issue_service_proforma, with its own label and reference type. Internal.
create or replace function public.tk_issue_project_proforma(p_project uuid, p_stage text, p_label text, p_ref_type text, p_amount_cents bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_stage_name text;
  v_no text;
  v_doc uuid;
begin
  select * into v from public.tk_client_projects where id = p_project;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  select name into v_stage_name from public.tk_stages where code = p_stage;
  v_no := next_document_number('proforma');
  insert into public.documents (org_id, doc_type, number, amount_cents, currency, status, data)
  values (v.org_id, 'proforma_invoice', v_no, p_amount_cents, 'USD', 'awaiting_payment',
          jsonb_build_object('service', 'turnkey', 'ref_type', p_ref_type, 'ref', v.code, 'title', 'Turnkey ' || v.code || ' · ' || p_label,
                             'issuer', (select legal_name from public.company_profile where id = 1)))
  returning id into v_doc;
  insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
  values (v_doc, 'turnkey', p_label || ' · ' || v.title || ' (' || v.code || ', phase: ' || coalesce(v_stage_name, p_stage) || ')', 1, p_amount_cents, p_amount_cents,
          p_ref_type, v.code);
  perform post_document_receivable(v_doc);
  perform audit('invoice.issue', v.org_id, 'turnkey', 'document', v_doc::text, null, jsonb_build_object('number', v_no, 'amount_cents', p_amount_cents, 'ref', v.code, 'ref_type', p_ref_type));
  return v_doc;
end $$;
revoke all on function public.tk_issue_project_proforma(uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.tk_issue_project_proforma(uuid, text, text, text, bigint) to service_role;

-- ───────── 5. private bucket for drawings (storage policies through the helpers below) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('turnkey-drawings', 'turnkey-drawings', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- a Turnkey editor may upload into <project id>/ while the project is open and in Design
create or replace function public.tk_drawing_can_upload(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_client_projects p
                  where p.id::text = p_folder and p.status = 'open' and p.stage = 'design' and p.org_id is not null
                    and public.tk_staff_can_edit(p.division_id));
$$;
revoke all on function public.tk_drawing_can_upload(text) from public, anon;
grant execute on function public.tk_drawing_can_upload(text) to authenticated, service_role;

-- a registered drawing is readable by the project's company and the staff who can view the project; a file that is not
-- registered yet only by the editor who may upload it
create or replace function public.tk_drawing_file_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_drawing_versions d join public.tk_client_projects p on p.id = d.project_id
                  where d.file_path = p_name and ((p.org_id is not null and p.org_id in (select my_org_ids())) or public.tk_staff_can_view(p.id)))
      or (not exists (select 1 from public.tk_drawing_versions d where d.file_path = p_name)
          and public.tk_drawing_can_upload(split_part(p_name, '/', 1)));
$$;
revoke all on function public.tk_drawing_file_visible(text) from public, anon;
grant execute on function public.tk_drawing_file_visible(text) to authenticated, service_role;

-- an upload that was never registered (registration refused) may be removed by the editor
create or replace function public.tk_drawing_orphan_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.tk_drawing_versions d where d.file_path = p_name)
     and public.tk_drawing_can_upload(split_part(p_name, '/', 1));
$$;
revoke all on function public.tk_drawing_orphan_removable(text) from public, anon;
grant execute on function public.tk_drawing_orphan_removable(text) to authenticated, service_role;

drop policy if exists "turnkey drawings staff upload" on storage.objects;
create policy "turnkey drawings staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'turnkey-drawings' and public.tk_drawing_can_upload((storage.foldername(name))[1]));
drop policy if exists "turnkey drawings read" on storage.objects;
create policy "turnkey drawings read" on storage.objects for select to authenticated
  using (bucket_id = 'turnkey-drawings' and public.tk_drawing_file_visible(name));
drop policy if exists "turnkey drawings remove unregistered" on storage.objects;
create policy "turnkey drawings remove unregistered" on storage.objects for delete to authenticated
  using (bucket_id = 'turnkey-drawings' and public.tk_drawing_orphan_removable(name));

-- ───────── 6. drawings: upload / comment / decide / waive ─────────
-- Design rule: 3 versions free, then 50% of the drawing fee per extra version (constants mirrored in lib/turnkey/format.ts)
create or replace function public.tk_add_drawing_version(p_project uuid, p_path text, p_file_name text, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  l public.tk_drawing_versions;
  x public.tk_drawing_extra_fees;
  v_meta jsonb;
  v_mime text;
  v_size bigint;
  v_name text := nullif(btrim(coalesce(p_file_name, '')), '');
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_n smallint;
  v_id uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors share drawings'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  if v.stage <> 'design' then raise exception 'NOT_IN_DESIGN: layout drawings are shared in the Design phase'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v.id::text or position('..' in p_path) > 0 or length(p_path) > 400 then
    raise exception 'INVALID_FILE: upload the file again';
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'turnkey-drawings' and o.name = p_path;
  if not found then raise exception 'FILE_NOT_UPLOADED: upload the file first'; end if;
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'INVALID_FILE_TYPE: upload a PDF, JPG, PNG or WEBP file'; end if;
  if v_size is null or v_size <= 0 or v_size > 20971520 then raise exception 'INVALID_FILE_SIZE: files can be up to 20 MB'; end if;
  if exists (select 1 from public.tk_drawing_versions d where d.file_path = p_path) then raise exception 'FILE_ALREADY_USED: this file is already a version'; end if;
  if v_msg is not null and length(v_msg) > 1000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 1,000 characters'; end if;
  v_name := left(coalesce(v_name, regexp_replace(p_path, '^.*/', '')), 200);
  select * into l from public.tk_drawing_versions d where d.project_id = v.id order by d.version desc limit 1;
  if l.status = 'shared' then raise exception 'VERSION_WAITING: the client has not reviewed version % yet', l.version; end if;
  if l.status = 'approved' then raise exception 'DRAWING_APPROVED: the client approved version %; no new version is needed', l.version; end if;
  v_n := coalesce(l.version, 0) + 1;
  if v_n > 3 then
    select * into x from public.tk_drawing_extra_fees e where e.project_id = v.id and e.for_version = v_n;
    if x.id is null then raise exception 'EXTRA_VERSION_NOT_REQUESTED: version % is an extra version; it starts when the client asks for changes', v_n; end if;
    if x.status <> 'waived' and not public.tk_fee_is_paid(x.document_id) then
      raise exception 'EXTRA_VERSION_NOT_PAID: version % is an extra version; upload it after the client pays US$ % (or an admin waives it)', v_n, to_char(x.amount_cents / 100.0, 'FM999,999,990.00');
    end if;
  end if;
  insert into public.tk_drawing_versions (project_id, version, file_path, file_name, mime_type, size_bytes, message, uploaded_by)
  values (v.id, v_n, p_path, v_name, v_mime, v_size, v_msg, auth.uid())
  returning id into v_id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'drawing', 'design', 'Layout drawing version ' || v_n || ' is ready for your review.' ||
          case when v_n <= 3 then ' Free versions used: ' || v_n || ' of 3.' else ' This is an extra version.' end);
  perform write_audit('turnkey.drawing_uploaded', 'tk_drawing_versions', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'version', v_n, 'file_name', v_name, 'mime_type', v_mime, 'size_bytes', v_size, 'extra_fee_id', x.id));
  return jsonb_build_object('id', v_id, 'version', v_n);
end $$;
revoke all on function public.tk_add_drawing_version(uuid, text, text, text) from public, anon;
grant execute on function public.tk_add_drawing_version(uuid, text, text, text) to authenticated, service_role;

-- a comment on a version: the client (own company) or a Turnkey editor
create or replace function public.tk_comment_drawing(p_version uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.tk_drawing_versions;
  v public.tk_client_projects;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_staff boolean;
  v_id bigint;
begin
  select * into d from public.tk_drawing_versions where id = p_version;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = d.project_id;
  v_staff := public.tk_staff_can_edit(v.division_id);
  if not (v_staff or public.tk_is_project_customer(v.id)) then raise exception 'NOT_FOUND'; end if;
  if v_body is null then raise exception 'EMPTY_COMMENT: write a comment first'; end if;
  if length(v_body) > 2000 then raise exception 'COMMENT_TOO_LONG: keep the comment under 2,000 characters'; end if;
  if (select count(*) from public.tk_drawing_comments c where c.project_id = v.id and c.created_at > now() - interval '1 day') >= 200 then
    raise exception 'TOO_MANY_COMMENTS: please try again tomorrow';
  end if;
  insert into public.tk_drawing_comments (project_id, version_id, from_staff, kind, body, author_id)
  values (v.id, d.id, v_staff, 'comment', v_body, auth.uid()) returning id into v_id;
  perform write_audit('turnkey.drawing_comment', 'tk_drawing_versions', d.id::text,
    jsonb_build_object('code', v.code, 'version', d.version, 'from_staff', v_staff, 'comment_id', v_id));
  return v_id;
end $$;
revoke all on function public.tk_comment_drawing(uuid, text) from public, anon;
grant execute on function public.tk_comment_drawing(uuid, text) to authenticated, service_role;

-- the client approves the version under review, or asks for changes (a reason is required). Asking for changes on
-- version 3 or later makes the next version an extra version: 50% of the active layout drawing fee, proforma issued now.
create or replace function public.tk_decide_drawing(p_version uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.tk_drawing_versions;
  v public.tk_client_projects;
  f public.tk_project_fees;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_amount bigint;
  v_doc uuid;
  v_extra uuid;
begin
  select * into d from public.tk_drawing_versions where id = p_version;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = d.project_id for update;
  if not public.tk_is_project_customer(v.id) then raise exception 'FORBIDDEN: only the client approves drawings'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: this project is not open'; end if;
  select * into d from public.tk_drawing_versions where id = p_version for update;
  if d.status <> 'shared' then raise exception 'VERSION_DECIDED: this version was already reviewed'; end if;
  if v_comment is not null and length(v_comment) > 2000 then raise exception 'COMMENT_TOO_LONG: keep the comment under 2,000 characters'; end if;

  if p_decision = 'approve' then
    update public.tk_drawing_versions set status = 'approved', decided_at = now() where id = d.id;
    if v_comment is not null then
      insert into public.tk_drawing_comments (project_id, version_id, from_staff, kind, body, author_id) values (v.id, d.id, false, 'approval', v_comment, auth.uid());
    end if;
    insert into public.tk_client_project_events (project_id, kind, to_stage, message)
    values (v.id, 'drawing', 'design', 'You approved layout drawing version ' || d.version || '. Design is complete; sourcing comes next.');
    perform write_audit('turnkey.drawing_approved', 'tk_drawing_versions', d.id::text, jsonb_build_object('code', v.code, 'project_id', v.id, 'version', d.version));
    update public.tk_client_projects set updated_at = now() where id = v.id;
    return jsonb_build_object('status', 'approved');
  elsif p_decision <> 'changes' then
    raise exception 'INVALID_DECISION';
  end if;

  if v_comment is null then raise exception 'REASON_REQUIRED: tell us what to change'; end if;
  if d.version >= 99 then raise exception 'TOO_MANY_VERSIONS: please contact your account manager'; end if;
  if d.version >= 3 then
    -- the drawing fee the extra version is based on: the active Layout drawing fee of the Design phase
    select * into f from public.tk_project_fees pf
     where pf.project_id = v.id and pf.stage = 'design' and pf.service_code = 'layout_drawing' and pf.status = 'active';
    if f.id is null then raise exception 'NO_DRAWING_FEE: the drawing fee is not set; please contact your account manager'; end if;
    v_amount := (f.amount_cents + 1) / 2;   -- 50%, rounded half up to the cent
  end if;
  update public.tk_drawing_versions set status = 'changes_requested', decided_at = now() where id = d.id;
  insert into public.tk_drawing_comments (project_id, version_id, from_staff, kind, body, author_id) values (v.id, d.id, false, 'changes', v_comment, auth.uid());
  if v_amount is not null then
    v_doc := public.tk_issue_project_proforma(v.id, 'design', 'Extra drawing version ' || (d.version + 1), 'tk_drawing_version', v_amount);
    insert into public.tk_drawing_extra_fees (project_id, for_version, requested_on, base_fee_id, base_cents, amount_cents, document_id)
    values (v.id, d.version + 1, d.id, f.id, f.amount_cents, v_amount, v_doc)
    returning id into v_extra;
    insert into public.tk_client_project_events (project_id, kind, to_stage, message)
    values (v.id, 'drawing', 'design', 'You asked for changes to version ' || d.version || '. Version ' || (d.version + 1) ||
            ' is an extra version: US$ ' || to_char(v_amount / 100.0, 'FM999,999,990.00') || ' (50% of the drawing fee). We start it after you pay.');
    perform write_audit('turnkey.drawing_extra_fee', 'tk_drawing_extra_fees', v_extra::text,
      jsonb_build_object('code', v.code, 'project_id', v.id, 'for_version', d.version + 1, 'base_fee_id', f.id, 'base_cents', f.amount_cents, 'amount_cents', v_amount, 'document_id', v_doc));
  else
    insert into public.tk_client_project_events (project_id, kind, to_stage, message)
    values (v.id, 'drawing', 'design', 'You asked for changes to version ' || d.version || '. Version ' || (d.version + 1) || ' is free (' || (d.version + 1) || ' of 3).');
  end if;
  perform write_audit('turnkey.drawing_changes', 'tk_drawing_versions', d.id::text, jsonb_build_object('code', v.code, 'project_id', v.id, 'version', d.version, 'extra_fee_id', v_extra));
  update public.tk_client_projects set updated_at = now() where id = v.id;
  return jsonb_build_object('status', 'changes_requested', 'extra_fee_id', v_extra, 'document_id', v_doc, 'amount_cents', v_amount);
end $$;
revoke all on function public.tk_decide_drawing(uuid, text, text) from public, anon;
grant execute on function public.tk_decide_drawing(uuid, text, text) to authenticated, service_role;

-- an admin (2FA) waives an unpaid extra version charge with a reason; the proforma is voided (balanced reversal)
create or replace function public.tk_waive_drawing_fee(p_extra uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.tk_drawing_extra_fees;
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not is_admin() then raise exception 'FORBIDDEN: only admins waive an extra version charge'; end if;
  select * into x from public.tk_drawing_extra_fees where id = p_extra;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = x.project_id for update;
  if not public.tk_staff_can_view(v.id) then raise exception 'NOT_FOUND'; end if;
  select * into x from public.tk_drawing_extra_fees where id = p_extra for update;
  if x.status <> 'open' then raise exception 'ALREADY_WAIVED'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why there is no charge'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  perform public.tk_void_fee_document(x.document_id);   -- refuses when the client has paid anything towards it
  update public.tk_drawing_extra_fees set status = 'waived', waived_by = auth.uid(), waived_at = now(), waive_reason = v_reason where id = x.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'drawing', 'design', 'No charge for extra drawing version ' || x.for_version || '. The proforma was cancelled.');
  perform write_audit('turnkey.drawing_fee_waived', 'tk_drawing_extra_fees', x.id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'for_version', x.for_version, 'amount_cents', x.amount_cents, 'reason', v_reason));
end $$;
revoke all on function public.tk_waive_drawing_fee(uuid, text) from public, anon;
grant execute on function public.tk_waive_drawing_fee(uuid, text) to authenticated, service_role;

-- staff view of the drawings: versions with uploader, comments with authors, extra charges with waiver facts
create or replace function public.tk_staff_drawings(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'version', d.version, 'file_path', d.file_path, 'file_name', d.file_name,
        'mime_type', d.mime_type, 'size_bytes', d.size_bytes, 'message', d.message, 'status', d.status, 'shared_at', d.shared_at, 'decided_at', d.decided_at,
        'uploaded_by_name', coalesce(nullif(btrim(pu.full_name), ''), pu.email)) order by d.version desc)
      from public.tk_drawing_versions d left join public.profiles pu on pu.id = d.uploaded_by where d.project_id = p_project), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'version_id', c.version_id, 'from_staff', c.from_staff, 'kind', c.kind, 'body', c.body,
        'created_at', c.created_at, 'author_name', coalesce(nullif(btrim(pa.full_name), ''), pa.email)) order by c.created_at, c.id)
      from public.tk_drawing_comments c left join public.profiles pa on pa.id = c.author_id where c.project_id = p_project), '[]'::jsonb),
    'extras', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'for_version', e.for_version, 'base_cents', e.base_cents, 'amount_cents', e.amount_cents,
        'status', e.status, 'document_id', e.document_id, 'document_number', doc.number, 'document_status', doc.status, 'paid_cents', doc.paid_cents,
        'paid', public.tk_fee_is_paid(e.document_id), 'waived_by_name', coalesce(nullif(btrim(pw.full_name), ''), pw.email), 'waived_at', e.waived_at,
        'waive_reason', e.waive_reason, 'created_at', e.created_at) order by e.for_version)
      from public.tk_drawing_extra_fees e left join public.documents doc on doc.id = e.document_id left join public.profiles pw on pw.id = e.waived_by
     where e.project_id = p_project), '[]'::jsonb));
end $$;
revoke all on function public.tk_staff_drawings(uuid) from public, anon;
grant execute on function public.tk_staff_drawings(uuid) to authenticated, service_role;

-- ───────── 7. deposit setting (D5: from settings; not set by this migration — the design gives no value) ─────────
create or replace function public.tk_deposit_pct()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when jsonb_typeof(setting('turnkey.deposit_pct')) = 'number'
               and (setting('turnkey.deposit_pct') #>> '{}')::numeric between 1 and 100
               and (setting('turnkey.deposit_pct') #>> '{}')::numeric = trunc((setting('turnkey.deposit_pct') #>> '{}')::numeric)
              then (setting('turnkey.deposit_pct') #>> '{}')::integer end;
$$;
revoke all on function public.tk_deposit_pct() from public, anon;
grant execute on function public.tk_deposit_pct() to authenticated, service_role;

-- admins (2FA) set the deposit %: a whole number from 1 to 100. Applies to quotes sent afterwards (a sent quote keeps its %).
create or replace function public.tk_set_deposit_pct(p_pct integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer := public.tk_deposit_pct();
begin
  if auth.uid() is null or not is_admin() then raise exception 'FORBIDDEN: only admins set the deposit'; end if;
  if p_pct is null or p_pct < 1 or p_pct > 100 then raise exception 'INVALID_DEPOSIT: enter a whole percentage from 1 to 100'; end if;
  perform set_setting('turnkey.deposit_pct', to_jsonb(p_pct));
  update public.site_settings set description = 'Turnkey T4: deposit % of the accepted client quote, invoiced on acceptance (D5). Frozen on each quote when it is sent.', is_public = false
   where key = 'turnkey.deposit_pct';
  perform write_audit('turnkey.deposit_pct', 'site_settings', 'turnkey.deposit_pct', jsonb_build_object('old', v_old, 'new', p_pct));
end $$;
revoke all on function public.tk_set_deposit_pct(integer) from public, anon;
grant execute on function public.tk_set_deposit_pct(integer) to authenticated, service_role;

-- ───────── 8. quotes: factory quotes, client quote drafts, send, withdraw, client decision ─────────
-- white-label guard: true when the text names a supplier of one of the project's factory quotes. Internal.
create or replace function public.tk_names_supplier(p_project uuid, p_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_text is not null and exists (
    select 1 from public.tk_factory_quotes q
     where q.project_id = p_project and length(btrim(q.supplier_name)) >= 3
       and position(lower(btrim(q.supplier_name)) in lower(p_text)) > 0);
$$;
revoke all on function public.tk_names_supplier(uuid, text) from public, anon, authenticated;
grant execute on function public.tk_names_supplier(uuid, text) to service_role;

-- a quote received from a factory (staff only): supplier, reference and cost lines [{description, qty, unit_cost_cents}]
create or replace function public.tk_add_factory_quote(p_project uuid, p_supplier_name text, p_supplier_ref text, p_valid_until date, p_notes text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_name text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  v_ref text := nullif(btrim(coalesce(p_supplier_ref, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  l jsonb;
  i integer := 0;
  v_total bigint := 0;
  v_id uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors add factory quotes'; end if;
  if v.status in ('cancelled', 'completed') then raise exception 'PROJECT_CLOSED: reopen the project first'; end if;
  if v_name is null then raise exception 'SUPPLIER_REQUIRED: enter the factory name'; end if;
  if length(v_name) > 200 or (v_ref is not null and length(v_ref) > 120) or (v_notes is not null and length(v_notes) > 2000) then raise exception 'TOO_LONG: shorten the text'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'LINES_REQUIRED: add at least one line'; end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'TOO_MANY_LINES: at most 200 lines'; end if;
  -- check every line first (integer cents, whole quantities), then write header and lines
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if nullif(btrim(coalesce(l ->> 'description', '')), '') is null or length(btrim(l ->> 'description')) > 500 then
      raise exception 'INVALID_LINE: line % needs a description (up to 500 characters)', i;
    end if;
    if coalesce(l ->> 'qty', '') !~ '^[0-9]{1,7}$' or coalesce(l ->> 'unit_cost_cents', '') !~ '^[0-9]{1,11}$' then
      raise exception 'INVALID_LINE: line % needs a whole quantity and a cost in cents', i;
    end if;
    if (l ->> 'qty')::bigint not between 1 and 1000000 or (l ->> 'unit_cost_cents')::bigint > 10000000000 then
      raise exception 'INVALID_LINE: line % quantity or cost out of range', i;
    end if;
    v_total := v_total + (l ->> 'qty')::bigint * (l ->> 'unit_cost_cents')::bigint;
  end loop;
  insert into public.tk_factory_quotes (project_id, supplier_name, supplier_ref, valid_until, notes, total_cost_cents, created_by)
  values (v.id, v_name, v_ref, p_valid_until, v_notes, v_total, auth.uid()) returning id into v_id;
  insert into public.tk_factory_quote_lines (factory_quote_id, project_id, line_no, description, qty, unit_cost_cents, total_cost_cents)
  select v_id, v.id, x.n, btrim(x.e ->> 'description'), (x.e ->> 'qty')::integer, (x.e ->> 'unit_cost_cents')::bigint,
         (x.e ->> 'qty')::bigint * (x.e ->> 'unit_cost_cents')::bigint
    from jsonb_array_elements(p_lines) with ordinality as x(e, n);
  perform write_audit('turnkey.factory_quote_added', 'tk_factory_quotes', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'lines', i, 'total_cost_cents', v_total));
  return v_id;
end $$;
revoke all on function public.tk_add_factory_quote(uuid, text, text, date, text, jsonb) from public, anon;
grant execute on function public.tk_add_factory_quote(uuid, text, text, date, text, jsonb) to authenticated, service_role;

-- staff build (or rebuild) the draft of the next client quote version. Lines:
-- [{description, qty, unit_price_cents, factory_line_id?, unit_cost_cents?}]; the cost comes from the factory line when
-- one is chosen; a line without a known cost stays without cost (margin "unknown", never 0).
create or replace function public.tk_save_client_quote(p_project uuid, p_message text, p_valid_until date, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  q public.tk_client_quotes;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  l jsonb;
  i integer := 0;
  v_total bigint := 0;
  v_fl public.tk_factory_quote_lines;
  v_line uuid;
  v_cost bigint;
  v_ver smallint;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors build quotes'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  if v.stage not in ('sourcing', 'quote_deposit') then raise exception 'NOT_IN_SOURCING: client quotes are built in Sourcing or Quote and deposit'; end if;
  if exists (select 1 from public.tk_client_quotes x where x.project_id = v.id and x.status = 'accepted') then
    raise exception 'QUOTE_ACCEPTED: the client has accepted a quote; the balance comes in a later step';
  end if;
  if v_msg is not null and length(v_msg) > 2000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 2,000 characters'; end if;
  if public.tk_names_supplier(v.id, v_msg) then raise exception 'SUPPLIER_NAME_SHOWN: the message names a factory; clients deal only with Octopus'; end if;
  if p_valid_until is not null and p_valid_until < current_date then raise exception 'INVALID_DATE: the quote must be valid until today or later'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'LINES_REQUIRED: add at least one line'; end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'TOO_MANY_LINES: at most 200 lines'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if nullif(btrim(coalesce(l ->> 'description', '')), '') is null or length(btrim(l ->> 'description')) > 500 then
      raise exception 'INVALID_LINE: line % needs a description (up to 500 characters)', i;
    end if;
    if public.tk_names_supplier(v.id, l ->> 'description') then
      raise exception 'SUPPLIER_NAME_SHOWN: line % names a factory; clients deal only with Octopus', i;
    end if;
    if coalesce(l ->> 'qty', '') !~ '^[0-9]{1,7}$' or coalesce(l ->> 'unit_price_cents', '') !~ '^[0-9]{1,11}$'
       or (nullif(l ->> 'unit_cost_cents', '') is not null and (l ->> 'unit_cost_cents') !~ '^[0-9]{1,11}$') then
      raise exception 'INVALID_LINE: line % needs a whole quantity and prices in cents', i;
    end if;
    if (l ->> 'qty')::bigint not between 1 and 1000000 or (l ->> 'unit_price_cents')::bigint not between 1 and 10000000000 then
      raise exception 'INVALID_LINE: line % quantity or price out of range (the price must be above 0)', i;
    end if;
    if nullif(l ->> 'factory_line_id', '') is not null and not exists (
         select 1 from public.tk_factory_quote_lines fl where fl.id::text = l ->> 'factory_line_id' and fl.project_id = v.id) then
      raise exception 'INVALID_LINE: line % refers to a factory line of another project', i;
    end if;
    v_total := v_total + (l ->> 'qty')::bigint * (l ->> 'unit_price_cents')::bigint;
  end loop;
  if v_total > 100000000000 then raise exception 'INVALID_AMOUNT: the quote total is too large'; end if;

  select * into q from public.tk_client_quotes x where x.project_id = v.id and x.status = 'draft' for update;
  if q.id is null then
    select coalesce(max(x.version), 0) + 1 into v_ver from public.tk_client_quotes x where x.project_id = v.id;
    insert into public.tk_client_quotes (project_id, version, message, valid_until, total_cents, created_by)
    values (v.id, v_ver, v_msg, p_valid_until, v_total, auth.uid()) returning * into q;
  else
    delete from public.tk_client_quote_lines where quote_id = q.id;   -- costs cascade; allowed for drafts only
    update public.tk_client_quotes set message = v_msg, valid_until = p_valid_until, total_cents = v_total, updated_at = now() where id = q.id;
  end if;
  i := 0;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.tk_client_quote_lines (quote_id, project_id, line_no, description, qty, unit_price_cents, total_cents)
    values (q.id, v.id, i, btrim(l ->> 'description'), (l ->> 'qty')::integer, (l ->> 'unit_price_cents')::bigint,
            (l ->> 'qty')::bigint * (l ->> 'unit_price_cents')::bigint)
    returning id into v_line;
    v_fl := null;
    if nullif(l ->> 'factory_line_id', '') is not null then
      select * into v_fl from public.tk_factory_quote_lines fl where fl.id::text = l ->> 'factory_line_id';
    end if;
    v_cost := coalesce(nullif(l ->> 'unit_cost_cents', '')::bigint, v_fl.unit_cost_cents);
    if v_cost is not null then
      insert into public.tk_client_quote_line_costs (line_id, quote_id, project_id, factory_line_id, unit_cost_cents, cost_cents)
      values (v_line, q.id, v.id, v_fl.id, v_cost, v_cost * (l ->> 'qty')::bigint);
    end if;
  end loop;
  perform write_audit('turnkey.quote_draft_saved', 'tk_client_quotes', q.id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version, 'lines', i, 'total_cents', v_total));
  return jsonb_build_object('id', q.id, 'version', q.version, 'total_cents', v_total);
end $$;
revoke all on function public.tk_save_client_quote(uuid, text, date, jsonb) from public, anon;
grant execute on function public.tk_save_client_quote(uuid, text, date, jsonb) to authenticated, service_role;

-- staff discard a draft (never seen by the client)
create or replace function public.tk_discard_quote_draft(p_quote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.tk_client_quotes;
  v public.tk_client_projects;
begin
  select * into q from public.tk_client_quotes where id = p_quote;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = q.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors change quotes'; end if;
  select * into q from public.tk_client_quotes where id = p_quote for update;
  if q.status <> 'draft' then raise exception 'QUOTE_SENT: only a draft can be discarded'; end if;
  delete from public.tk_client_quotes where id = q.id;
  perform write_audit('turnkey.quote_draft_discarded', 'tk_client_quotes', q.id::text, jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version));
end $$;
revoke all on function public.tk_discard_quote_draft(uuid) from public, anon;
grant execute on function public.tk_discard_quote_draft(uuid) to authenticated, service_role;

-- staff send the draft: the deposit % (setting turnkey.deposit_pct) is frozen on the quote; an earlier unanswered
-- version is superseded
create or replace function public.tk_send_client_quote(p_quote uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.tk_client_quotes;
  v public.tk_client_projects;
  v_pct integer;
  v_dep bigint;
begin
  select * into q from public.tk_client_quotes where id = p_quote;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = q.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors send quotes'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.stage not in ('sourcing', 'quote_deposit') then raise exception 'NOT_IN_SOURCING: client quotes are sent in Sourcing or Quote and deposit'; end if;
  select * into q from public.tk_client_quotes where id = p_quote for update;
  if q.status <> 'draft' then raise exception 'QUOTE_SENT: this version was already sent'; end if;
  if not exists (select 1 from public.tk_client_quote_lines l where l.quote_id = q.id) or q.total_cents <= 0 then raise exception 'LINES_REQUIRED: add at least one line'; end if;
  if q.valid_until is not null and q.valid_until < current_date then raise exception 'QUOTE_EXPIRED: change the valid-until date first'; end if;
  if exists (select 1 from public.tk_client_quotes x where x.project_id = v.id and x.status = 'accepted') then raise exception 'QUOTE_ACCEPTED: the client has accepted a quote'; end if;
  v_pct := public.tk_deposit_pct();
  if v_pct is null then raise exception 'DEPOSIT_NOT_SET: an admin sets the deposit percentage (Admin › Turnkey › Services and fees) before quotes are sent'; end if;
  v_dep := (q.total_cents * v_pct + 50) / 100;
  if v_dep <= 0 then raise exception 'DEPOSIT_TOO_SMALL: the quote total is too small for a deposit'; end if;
  update public.tk_client_quotes set status = 'superseded', updated_at = now() where project_id = v.id and status = 'sent';
  update public.tk_client_quotes set status = 'sent', deposit_pct = v_pct, deposit_cents = v_dep, sent_at = now(), sent_by = auth.uid(), updated_at = now() where id = q.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'quote', 'quote_deposit', 'Quote version ' || q.version || ' is ready: US$ ' || to_char(q.total_cents / 100.0, 'FM999,999,999,990.00') ||
          '. Deposit when you accept: ' || v_pct || '% (US$ ' || to_char(v_dep / 100.0, 'FM999,999,999,990.00') || ').');
  perform write_audit('turnkey.quote_sent', 'tk_client_quotes', q.id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version, 'total_cents', q.total_cents, 'deposit_pct', v_pct, 'deposit_cents', v_dep));
  return jsonb_build_object('id', q.id, 'deposit_pct', v_pct, 'deposit_cents', v_dep);
end $$;
revoke all on function public.tk_send_client_quote(uuid) from public, anon;
grant execute on function public.tk_send_client_quote(uuid) to authenticated, service_role;

-- staff withdraw a sent, unanswered version (reason shown to the client)
create or replace function public.tk_withdraw_client_quote(p_quote uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.tk_client_quotes;
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into q from public.tk_client_quotes where id = p_quote;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = q.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors withdraw quotes'; end if;
  select * into q from public.tk_client_quotes where id = p_quote for update;
  if q.status <> 'sent' then raise exception 'QUOTE_NOT_OPEN: only a sent, unanswered quote can be withdrawn'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell the client why'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  if public.tk_names_supplier(v.id, v_reason) then raise exception 'SUPPLIER_NAME_SHOWN: the reason names a factory; clients deal only with Octopus'; end if;
  update public.tk_client_quotes set status = 'withdrawn', updated_at = now() where id = q.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'quote', 'quote_deposit', 'Quote version ' || q.version || ' was withdrawn: ' || v_reason);
  perform write_audit('turnkey.quote_withdrawn', 'tk_client_quotes', q.id::text, jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version, 'reason', v_reason));
end $$;
revoke all on function public.tk_withdraw_client_quote(uuid, text) from public, anon;
grant execute on function public.tk_withdraw_client_quote(uuid, text) to authenticated, service_role;

-- the client accepts the sent version (the deposit proforma is issued: frozen % of the total) or asks for changes
create or replace function public.tk_decide_client_quote(p_quote uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.tk_client_quotes;
  v public.tk_client_projects;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_doc uuid;
begin
  select * into q from public.tk_client_quotes where id = p_quote;
  if q.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = q.project_id for update;
  if not public.tk_is_project_customer(v.id) then raise exception 'FORBIDDEN: only the client accepts quotes'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: this project is not open'; end if;
  select * into q from public.tk_client_quotes where id = p_quote for update;
  if q.status <> 'sent' then raise exception 'QUOTE_NOT_OPEN: this quote version is no longer open'; end if;
  if q.valid_until is not null and q.valid_until < current_date then raise exception 'QUOTE_EXPIRED: this quote has expired; ask us for a new version'; end if;
  if v_comment is not null and length(v_comment) > 2000 then raise exception 'COMMENT_TOO_LONG: keep the comment under 2,000 characters'; end if;
  if p_decision = 'accept' then
    v_doc := public.tk_issue_project_proforma(v.id, 'quote_deposit', 'Deposit ' || q.deposit_pct || '% · quote version ' || q.version, 'tk_client_quote', q.deposit_cents);
    update public.tk_client_quotes set status = 'accepted', document_id = v_doc, decided_at = now(), client_comment = v_comment, updated_at = now() where id = q.id;
    insert into public.tk_client_project_events (project_id, kind, to_stage, message)
    values (v.id, 'quote', 'quote_deposit', 'You accepted quote version ' || q.version || '. Deposit to pay: US$ ' || to_char(q.deposit_cents / 100.0, 'FM999,999,999,990.00') ||
            ' (' || q.deposit_pct || '%). Production starts after the deposit is paid.');
    perform write_audit('turnkey.quote_accepted', 'tk_client_quotes', q.id::text,
      jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version, 'total_cents', q.total_cents, 'deposit_pct', q.deposit_pct, 'deposit_cents', q.deposit_cents, 'document_id', v_doc));
    update public.tk_client_projects set updated_at = now() where id = v.id;
    return jsonb_build_object('status', 'accepted', 'document_id', v_doc, 'deposit_cents', q.deposit_cents);
  elsif p_decision <> 'changes' then
    raise exception 'INVALID_DECISION';
  end if;
  if v_comment is null then raise exception 'REASON_REQUIRED: tell us what to change'; end if;
  update public.tk_client_quotes set status = 'changes_requested', client_comment = v_comment, decided_at = now(), updated_at = now() where id = q.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'quote', 'quote_deposit', 'You asked for changes to quote version ' || q.version || '. We will send a new version.');
  perform write_audit('turnkey.quote_changes', 'tk_client_quotes', q.id::text, jsonb_build_object('code', v.code, 'project_id', v.id, 'version', q.version));
  update public.tk_client_projects set updated_at = now() where id = v.id;
  return jsonb_build_object('status', 'changes_requested');
end $$;
revoke all on function public.tk_decide_client_quote(uuid, text, text) from public, anon;
grant execute on function public.tk_decide_client_quote(uuid, text, text) to authenticated, service_role;

-- staff view: every client quote version (drafts too) with lines, cost and margin; factory quotes with lines
create or replace function public.tk_staff_quotes(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'deposit_pct', public.tk_deposit_pct(),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'version', q.version, 'status', q.status, 'total_cents', q.total_cents,
        'deposit_pct', q.deposit_pct, 'deposit_cents', q.deposit_cents, 'message', q.message, 'client_comment', q.client_comment, 'valid_until', q.valid_until,
        'sent_at', q.sent_at, 'decided_at', q.decided_at, 'created_at', q.created_at, 'updated_at', q.updated_at,
        'created_by_name', coalesce(nullif(btrim(pc.full_name), ''), pc.email), 'sent_by_name', coalesce(nullif(btrim(ps.full_name), ''), ps.email),
        'document_id', q.document_id, 'document_number', doc.number, 'document_status', doc.status, 'paid_cents', doc.paid_cents,
        'deposit_paid', q.document_id is not null and public.tk_fee_is_paid(q.document_id),
        'cost_cents', (select sum(c.cost_cents) from public.tk_client_quote_line_costs c where c.quote_id = q.id),
        'cost_complete', not exists (select 1 from public.tk_client_quote_lines l where l.quote_id = q.id
                                       and not exists (select 1 from public.tk_client_quote_line_costs c where c.line_id = l.id)),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'description', l.description, 'qty', l.qty,
             'unit_price_cents', l.unit_price_cents, 'total_cents', l.total_cents, 'unit_cost_cents', c.unit_cost_cents, 'cost_cents', c.cost_cents,
             'factory_line_id', c.factory_line_id, 'supplier_name', fq.supplier_name) order by l.line_no)
           from public.tk_client_quote_lines l
           left join public.tk_client_quote_line_costs c on c.line_id = l.id
           left join public.tk_factory_quote_lines fl on fl.id = c.factory_line_id
           left join public.tk_factory_quotes fq on fq.id = fl.factory_quote_id
          where l.quote_id = q.id), '[]'::jsonb)) order by q.version desc)
      from public.tk_client_quotes q
      left join public.profiles pc on pc.id = q.created_by
      left join public.profiles ps on ps.id = q.sent_by
      left join public.documents doc on doc.id = q.document_id
     where q.project_id = p_project), '[]'::jsonb),
    'factory_quotes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'supplier_name', f.supplier_name, 'supplier_ref', f.supplier_ref,
        'valid_until', f.valid_until, 'notes', f.notes, 'total_cost_cents', f.total_cost_cents, 'created_at', f.created_at,
        'created_by_name', coalesce(nullif(btrim(pf.full_name), ''), pf.email),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', fl.id, 'line_no', fl.line_no, 'description', fl.description, 'qty', fl.qty,
             'unit_cost_cents', fl.unit_cost_cents, 'total_cost_cents', fl.total_cost_cents) order by fl.line_no)
           from public.tk_factory_quote_lines fl where fl.factory_quote_id = f.id), '[]'::jsonb)) order by f.created_at desc)
      from public.tk_factory_quotes f left join public.profiles pf on pf.id = f.created_by where f.project_id = p_project), '[]'::jsonb));
end $$;
revoke all on function public.tk_staff_quotes(uuid) from public, anon;
grant execute on function public.tk_staff_quotes(uuid) to authenticated, service_role;

-- ───────── 9. phase gate (T3 function extended; the T3 fee gate is unchanged) ─────────
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
