-- Octopus Dropship · Release 4 · Step 10 — order problems and support.
-- Down: supabase/migrations/down/20261101000246_ds10_order_problems_support.down.sql
--
-- Source-agnostic (owner decision 26 Nov 2026: Shopify + YunExpress live come last). Anything the store must be told is a
-- dropship_channel_tasks row ('waiting_store' for Shopify orders, 'not_needed' otherwise) — never faked.
--
--  1. dropship_cases — one row per lost / damaged claim or buyer return of a store order (DSC-00001): the merchant's choice
--     (reship / refund), evidence photos (private bucket 'ds-claims'), carrier claim reference, outcome, refund, the reship
--     order, the Warehouse OS return (wh_returns) for returns to the 3PL, the Finance approval for refunds over US$1,000,
--     the CN-DS credit note, and the support ticket (tickets.store_order_id — one shared support desk).
--  2. dropship_case_photos — merchant evidence photos (path in 'ds-claims': <org>/<store order>/<uuid>.<ext>).
--  3. dropship_reweighs — re-weigh adjustments: Warehouse OS measured weight (W3a / W3b parcels + boxes) against the
--     billed weight locked at intake, the tolerance and dispute window of the fee version locked at intake, the charge
--     (OCT-DS invoice + balanced journal), the scale photo, and the 7-day dispute with its outcome (CN-DS refund or rejected).
--  4. Merchant RPCs: ds10_order_detail, ds10_claim_open, ds10_return_open, ds10_reweigh_dispute, ds10_order_address,
--     ds10_support_page, ds10_ticket_create. Staff RPCs: ds10_staff_board, ds10_case_carrier, ds10_case_reship,
--     ds10_case_refund, ds10_case_reject, ds10_refund_approve, ds10_return_receive, ds10_return_settle,
--     ds10_reweigh_decide, ds10_reweigh_dispute_decide, ds10_ticket_context.
--  5. Refunds: every refund is one balanced journal (Refunds & credits → wallet, or → receivable for an unpaid pay-later
--     invoice) plus a CN-DS credit note against the order's OCT-DS invoice (on the STMT-DS statement), or — while payment
--     protection still holds the money in full — the existing escrow refund. Over US$1,000 a finance_approvals row is
--     raised and only a SECOND person with finance:approve (or an admin in Admin › Finance) can approve it; the table gets
--     a CHECK (approved_by <> requested_by, NOT VALID for history) so two different people are enforced by the database.
--  6. Reship: a new store order (no charge, reship of …) with its warehouse order at the default warehouse, allocated by
--     the Warehouse OS (wh_allocate); the original order gets an 'update_tracking' channel task for the store.
--  7. Returns to the 3PL: a wh_returns row (Warehouse OS W5 photos / inspection / completion work unchanged). A trigger
--     keeps dropship returns Octopus-owned: no 3PL client charge, no client decision / send back, restocked lots owned by
--     Octopus (org NULL).
--  8. REPLACES ds_order_address_core (DS8): the delivery address can change until the shipping label exists (it was:
--     until packing); after the label → problem flow. The down restores the exact installed definition.
--  9. dropship_channel_tasks.action += 'update_tracking'; finance_approvals += CHECK two people.
--
-- Money: integer US cents; journals via post_journal (refuses unbalanced). Merchants read their own org only; writes only
-- through SECURITY DEFINER functions (search_path = public, revoked from public / anon). Re-runnable in one transaction.

-- ───────────────────────── 1. Tables ─────────────────────────
create sequence if not exists public.seq_dropship_case;

create table if not exists public.dropship_cases (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('DSC-' || lpad(nextval('public.seq_dropship_case')::text, 5, '0')),
  store_order_id uuid not null references public.store_orders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('lost', 'damaged', 'return')),
  status text not null default 'reported' check (status in ('reported', 'carrier_claim', 'awaiting_return', 'received',
    'awaiting_approval', 'reshipped', 'refunded', 'rejected', 'closed')),
  merchant_choice text check (merchant_choice is null or merchant_choice in ('reship', 'refund')),
  description text not null check (length(btrim(description)) between 3 and 2000),
  return_to text check (return_to is null or return_to in ('merchant', 'warehouse')),
  return_reason text check (return_reason is null or return_reason in ('changed_mind', 'faulty', 'wrong_item', 'other')),
  return_units jsonb check (return_units is null or jsonb_typeof(return_units) = 'array'),
  return_tracking text check (return_tracking is null or (btrim(return_tracking) <> '' and length(return_tracking) <= 64)),
  carrier_claim_ref text check (carrier_claim_ref is null or (btrim(carrier_claim_ref) <> '' and length(carrier_claim_ref) <= 64)),
  outcome text check (outcome is null or outcome in ('reship', 'refund', 'reject', 'none')),
  outcome_message text check (outcome_message is null or length(outcome_message) <= 600),
  suggested_refund_cents bigint check (suggested_refund_cents is null or suggested_refund_cents >= 0),
  refund_cents bigint check (refund_cents is null or refund_cents > 0),
  refund_destination text check (refund_destination is null or refund_destination in ('wallet', 'invoice', 'protection')),
  decided_at timestamptz,
  reship_store_order_id uuid references public.store_orders(id) on delete set null,
  wh_return_id uuid references public.wh_returns(id) on delete set null,
  finance_approval_id uuid references public.finance_approvals(id) on delete set null,
  credit_document_id uuid references public.documents(id) on delete set null,
  refund_journal_id uuid,
  ticket_id uuid references public.tickets(id) on delete set null,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dropship_cases_return_fields check ((kind = 'return') = (return_to is not null) and (kind <> 'return' or return_reason is not null)),
  constraint dropship_cases_claim_choice check (kind = 'return' or merchant_choice is not null),
  constraint dropship_cases_decided check (status not in ('reshipped', 'refunded', 'rejected', 'closed') or decided_at is not null),
  constraint dropship_cases_refunded check (status <> 'refunded' or (refund_cents is not null and refund_destination is not null)),
  constraint dropship_cases_approval check (status <> 'awaiting_approval' or (refund_cents is not null and finance_approval_id is not null))
);
create index if not exists dropship_cases_org_idx on public.dropship_cases (org_id, created_at desc);
create index if not exists dropship_cases_order_idx on public.dropship_cases (store_order_id);
create index if not exists dropship_cases_open_idx on public.dropship_cases (status, created_at) where status in ('reported', 'carrier_claim', 'awaiting_return', 'received', 'awaiting_approval');
create unique index if not exists dropship_cases_one_open_claim on public.dropship_cases (store_order_id)
  where kind in ('lost', 'damaged') and status in ('reported', 'carrier_claim', 'awaiting_approval');
create unique index if not exists dropship_cases_one_open_return on public.dropship_cases (store_order_id)
  where kind = 'return' and status in ('awaiting_return', 'received', 'awaiting_approval');
create index if not exists dropship_cases_reship_idx on public.dropship_cases (reship_store_order_id);
create index if not exists dropship_cases_whr_idx on public.dropship_cases (wh_return_id);
create index if not exists dropship_cases_fa_idx on public.dropship_cases (finance_approval_id);
create index if not exists dropship_cases_cdoc_idx on public.dropship_cases (credit_document_id);
create index if not exists dropship_cases_ticket_idx on public.dropship_cases (ticket_id);

create table if not exists public.dropship_case_photos (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dropship_cases(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  created_at timestamptz not null default now()
);
create index if not exists dropship_case_photos_case_idx on public.dropship_case_photos (case_id);
create index if not exists dropship_case_photos_org_idx on public.dropship_case_photos (org_id);

create table if not exists public.dropship_reweighs (
  id uuid primary key default gen_random_uuid(),
  store_order_id uuid not null unique references public.store_orders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  wh_order_id uuid references public.wh_orders(id) on delete set null,
  quoted_weight_g integer not null check (quoted_weight_g > 0),
  measured_weight_g integer not null check (measured_weight_g > 0),
  billed_weight_g integer not null check (billed_weight_g > 0),
  tolerance_g integer check (tolerance_g is null or tolerance_g >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  decision text not null check (decision in ('charged', 'absorbed')),
  invoice_id uuid references public.documents(id) on delete set null,
  charge_journal_id uuid,
  photo_path text check (photo_path is null or length(photo_path) <= 300),
  dispute_until timestamptz,
  dispute_state text check (dispute_state is null or dispute_state in ('open', 'refunded', 'rejected')),
  dispute_reason text check (dispute_reason is null or length(dispute_reason) between 5 and 600),
  disputed_at timestamptz,
  dispute_answer text check (dispute_answer is null or length(dispute_answer) <= 600),
  dispute_decided_at timestamptz,
  refund_cents bigint check (refund_cents is null or refund_cents > 0),
  credit_document_id uuid references public.documents(id) on delete set null,
  refund_journal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dropship_reweighs_charged check (decision <> 'charged' or (amount_cents > 0 and dispute_until is not null)),
  constraint dropship_reweighs_dispute check (dispute_state is null or (decision = 'charged' and dispute_reason is not null and disputed_at is not null)),
  constraint dropship_reweighs_decided check (dispute_state is null or dispute_state = 'open' or (dispute_decided_at is not null and dispute_answer is not null)),
  constraint dropship_reweighs_refund check (dispute_state is distinct from 'refunded' or refund_cents is not null)
);
create index if not exists dropship_reweighs_org_idx on public.dropship_reweighs (org_id, created_at desc);
create index if not exists dropship_reweighs_wo_idx on public.dropship_reweighs (wh_order_id);
create index if not exists dropship_reweighs_inv_idx on public.dropship_reweighs (invoice_id);
create index if not exists dropship_reweighs_cdoc_idx on public.dropship_reweighs (credit_document_id);
create index if not exists dropship_reweighs_open_idx on public.dropship_reweighs (dispute_state) where dispute_state = 'open';

-- ───────────────────────── 2. RLS + grants (merchants read their own org; writes only through definer functions) ─────────────────────────
alter table public.dropship_cases enable row level security;
alter table public.dropship_case_photos enable row level security;
alter table public.dropship_reweighs enable row level security;
drop policy if exists ds10_own_read on public.dropship_cases;
create policy ds10_own_read on public.dropship_cases for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds10_own_read on public.dropship_case_photos;
create policy ds10_own_read on public.dropship_case_photos for select to authenticated using (org_id in (select my_org_ids()));
drop policy if exists ds10_own_read on public.dropship_reweighs;
create policy ds10_own_read on public.dropship_reweighs for select to authenticated using (org_id in (select my_org_ids()));
revoke all on public.dropship_cases, public.dropship_case_photos, public.dropship_reweighs from public, anon, authenticated, service_role;
grant select on public.dropship_cases, public.dropship_case_photos, public.dropship_reweighs to authenticated;
grant all on public.dropship_cases, public.dropship_case_photos, public.dropship_reweighs to service_role;
revoke all on sequence public.seq_dropship_case from public, anon, authenticated;
grant usage, select on sequence public.seq_dropship_case to service_role;

-- ───────────────────────── 3. Existing tables: channel task 'update_tracking', two people on Finance approvals ─────────────────────────
alter table public.dropship_channel_tasks drop constraint if exists dropship_channel_tasks_action_check;
alter table public.dropship_channel_tasks add constraint dropship_channel_tasks_action_check
  check (action in ('release_fulfillment', 'accept_cancellation', 'reject_cancellation', 'update_tracking'));
-- the maker can never be the checker (decide_finance_approval already refuses it; now the table refuses it too).
-- NOT VALID: history is not re-checked (staging has none that breaks it); every new or changed row is.
alter table public.finance_approvals drop constraint if exists finance_approvals_two_person;
alter table public.finance_approvals add constraint finance_approvals_two_person
  check (approved_by is null or approved_by <> requested_by) not valid;

-- ───────────────────────── 4. Private bucket for claim photos + storage policies ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ds-claims', 'ds-claims', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ───────────────────────── 5. Helpers (internal) ─────────────────────────
-- staff who may see / act on Dropship order problems
create or replace function public.ds10_staff_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (can('support', 'view') or can('finance', 'approve') or dropship_can_edit(division_id_of('DS')))
$$;

create or replace function public.ds10_staff_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (can('support', 'edit') or dropship_can_edit(division_id_of('DS')))
$$;

-- a whole-number site setting kept within bounds (missing / bad value → default)
create or replace function public.ds10_setting_int(p_key text, p_default integer, p_min integer, p_max integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(p_min, least(p_max, coalesce((select case when (value #>> '{}') ~ '^[0-9]{1,6}$' then (value #>> '{}')::int end
                                                  from public.site_settings where key = p_key), p_default)))
$$;

-- refunds above this need a second Finance approver (US$1,000.00)
create or replace function public.ds10_approval_limit_cents()
returns bigint
language sql
immutable
set search_path = public
as $$ select 100000::bigint $$;

-- the parcel has left: the order was handed over (store order stage, Dropship shipment row, or a shipped warehouse order)
create or replace function public.ds10_handed_over(p_so uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.store_orders so where so.id = p_so and so.staff_stage in ('handed_over', 'delivered'))
      or exists (select 1 from public.shipments s where s.store_order_id = p_so
                  and s.status::text in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'))
      or exists (select 1 from public.wh_orders w where w.store_order_id = p_so and w.status = 'shipped')
$$;

-- the shipping label exists (an active Warehouse OS label, a labelled / shipped warehouse order, or the parcel left)
create or replace function public.ds10_label_created(p_so uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wh_orders w
                  where w.store_order_id = p_so and w.status <> 'cancelled'
                    and (w.status in ('labelled', 'shipped')
                         or exists (select 1 from public.wh_shipments s where s.order_id = w.id and s.status <> 'voided')))
      or public.ds10_handed_over(p_so)
$$;

create or replace function public.ds10_delivered_at(p_so uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select so.delivered_at from public.store_orders so where so.id = p_so),
                  (select max(s.delivered_at) from public.wh_shipments s join public.wh_orders w on w.id = s.order_id
                    where w.store_order_id = p_so and s.status = 'delivered'))
$$;

-- one step on a case's history (shown on the merchant's timeline and the staff stepper)
create or replace function public.ds10_case_step(p_case uuid, p_step text, p_text text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.dropship_cases
     set history = history || jsonb_build_array(jsonb_build_object('step', p_step, 'text', left(p_text, 600), 'at', clock_timestamp())),
         updated_at = now()
   where id = p_case
$$;

-- a notification for the merchant company (Dropship)
create or replace function public.ds10_notify(p_org uuid, p_title text, p_body text, p_link text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (org_id, division_id, service, title, body, link)
  values (p_org, division_id_of('DS'), 'dropship', left(p_title, 200), left(p_body, 600), p_link)
$$;

-- opens a ticket on the shared support desk, linked to the store order (division DS by the tickets trigger)
create or replace function public.ds10_ticket_open(p_org uuid, p_so uuid, p_subject text, p_category text, p_body text, p_attachments jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_hours int;
begin
  select first_response_hours into v_hours from public.sla_policies where priority = 'normal';
  insert into public.tickets (org_id, store_order_id, division_id, subject, category, priority, status, sla_due_at, created_by)
  values (p_org, p_so, division_id_of('DS'), left(p_subject, 200), p_category, 'normal', 'new', now() + make_interval(hours => coalesce(v_hours, 24)), auth.uid())
  returning id into v_id;
  insert into public.ticket_messages (ticket_id, org_id, author_id, body, attachments)
  values (v_id, p_org, auth.uid(), left(p_body, 10000), coalesce(p_attachments, '[]'::jsonb));
  perform emit_event('ticket.created', 'ticket', v_id, jsonb_build_object('org_id', p_org, 'store_order_id', p_so));
  return v_id;
end $$;

-- a staff reply on the case's ticket (what was decided), optionally resolving it
create or replace function public.ds10_ticket_reply(p_ticket uuid, p_body text, p_resolve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if p_ticket is null then return; end if;
  select org_id into v_org from public.tickets where id = p_ticket;
  if v_org is null then return; end if;
  insert into public.ticket_messages (ticket_id, org_id, author_id, is_staff, internal, body)
  values (p_ticket, v_org, auth.uid(), true, false, left(p_body, 10000));
  update public.tickets
     set status = (case when p_resolve then 'resolved' else 'waiting_customer' end)::ticket_status,
         assigned_to = coalesce(assigned_to, auth.uid())
   where id = p_ticket;
  perform emit_event('ticket.replied', 'ticket', p_ticket, jsonb_build_object('org_id', v_org, 'staff', true));
end $$;

-- the open payment-protection hold of an order (money still held), if any
create or replace function public.ds10_open_hold(p_so uuid)
returns public.escrow_holds
language sql
stable
security definer
set search_path = public
as $$
  select e.* from public.escrow_holds e join public.store_orders so on so.escrow_hold_id = e.id
   where so.id = p_so and e.status in ('held', 'disputed', 'partially_released') and e.amount_cents - e.released_cents - e.refunded_cents > 0
$$;

-- what was paid for the order and can still be refunded (charged − already refunded)
create or replace function public.ds10_refund_cap(p_so uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, coalesce(x.charged_cents, (select e.amount_cents from public.escrow_holds e where e.id = so.escrow_hold_id), 0) - coalesce(x.refunded_cents, 0))::bigint
    from public.store_orders so left join public.dropship_order_intake x on x.store_order_id = so.id
   where so.id = p_so
$$;

-- one case as JSON (p_staff adds the internal parts: merchant name, ticket SLA / owner, Finance approval)
create or replace function public.ds10_case_json(c public.dropship_cases, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'code', c.code, 'store_order_id', c.store_order_id, 'kind', c.kind, 'status', c.status,
    'merchant_choice', c.merchant_choice, 'description', c.description, 'return_to', c.return_to, 'return_reason', c.return_reason,
    'return_units', coalesce(c.return_units, '[]'::jsonb), 'return_tracking', c.return_tracking, 'carrier_claim_ref', c.carrier_claim_ref,
    'outcome', c.outcome, 'outcome_message', c.outcome_message, 'refund_cents', c.refund_cents, 'refund_destination', c.refund_destination,
    'decided_at', c.decided_at, 'created_at', c.created_at, 'history', c.history,
    'order_number', so.order_number, 'external_order_name', so.external_order_name,
    'reship', (select jsonb_build_object('id', r.id, 'order_number', r.order_number, 'merchant_status', r.merchant_status) from public.store_orders r where r.id = c.reship_store_order_id),
    'credit_note', (select d.number from public.documents d where d.id = c.credit_document_id),
    'ticket', (select jsonb_build_object('id', t.id, 'code', t.code, 'status', t.status) from public.tickets t where t.id = c.ticket_id),
    'photos', coalesce((select jsonb_agg(p.path order by p.created_at) from public.dropship_case_photos p where p.case_id = c.id), '[]'::jsonb),
    'warehouse_return', (select jsonb_build_object('code', w.code, 'status', w.status, 'decision', w.decision,
                                                   'units', (select coalesce(sum(l.qty), 0) from public.wh_return_lines l where l.return_id = w.id),
                                                   'good_units', (select coalesce(sum(l.qty), 0) from public.wh_return_lines l where l.return_id = w.id and l.condition = 'good'))
                           from public.wh_returns w where w.id = c.wh_return_id))
  || case when p_staff then jsonb_build_object(
       'merchant', (select o.name from public.organizations o where o.id = c.org_id),
       'org_id', c.org_id,
       'suggested_refund_cents', c.suggested_refund_cents,
       'refund_cap_cents', public.ds10_refund_cap(c.store_order_id),
       'order_total_cents', so.total_cents,
       'payment_option', (select x.payment_option from public.dropship_order_intake x where x.store_order_id = c.store_order_id),
       'protected_open', (public.ds10_open_hold(c.store_order_id)).id is not null,
       'ticket_sla_due_at', (select t.sla_due_at from public.tickets t where t.id = c.ticket_id),
       'ticket_owner', (select p.full_name from public.tickets t join public.profiles p on p.id = t.assigned_to where t.id = c.ticket_id),
       'wh_return_id', c.wh_return_id,
       'approval', (select jsonb_build_object('id', a.id, 'status', a.status, 'amount_cents', a.amount_cents, 'requested_by', a.requested_by,
                                              'requested_by_name', (select p.full_name from public.profiles p where p.id = a.requested_by),
                                              'can_approve', a.status = 'requested' and a.requested_by <> auth.uid() and (can('finance', 'approve') or is_admin()))
                      from public.finance_approvals a where a.id = c.finance_approval_id))
     else '{}'::jsonb end
  from public.store_orders so where so.id = c.store_order_id
$$;

-- CN-DS credit note against the order's OCT-DS invoice (on the STMT-DS statement)
create or replace function public.ds10_credit_note(p_so uuid, p_invoice uuid, p_amount bigint, p_reason text, p_destination text, p_ref text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.documents;
  so public.store_orders;
  v_id uuid;
  v_no text;
begin
  select * into inv from public.documents where id = p_invoice;
  if inv.id is null then raise exception 'NO_INVOICE: This order has no invoice to credit yet.'; end if;
  select * into so from public.store_orders where id = p_so;
  v_no := next_document_number('credit_note', division_id_of('DS'), now(), inv.legal_entity_id);
  insert into public.documents (org_id, division_id, legal_entity_id, doc_type, number, amount_cents, currency, status, original_document_id, data)
  values (so.org_id, division_id_of('DS'), inv.legal_entity_id, 'credit_note', v_no, p_amount, 'USD', 'issued', inv.id,
          jsonb_build_object('service', 'dropship', 'store_order_id', so.id, 'order_number', so.order_number, 'reason', left(p_reason, 300),
                             'refund_destination', p_destination, 'ref', p_ref))
  returning id into v_id;
  return v_id;
end $$;

-- storage: the merchant uploads evidence under <org>/<store order>/<uuid>.<ext> for an order of their own company
create or replace function public.ds10_claim_photo_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(p_name, '') ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then
    split_part(p_name, '/', 1) in (select o::text from public.my_org_ids() o)
    and exists (select 1 from public.store_orders so where so.id::text = split_part(p_name, '/', 2) and so.org_id::text = split_part(p_name, '/', 1))
  else false end
$$;

-- storage: the company's members, or Octopus staff who handle order problems
create or replace function public.ds10_claim_photo_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(p_name, '') ~ '^[0-9a-f-]{36}/' then
    split_part(p_name, '/', 1) in (select o::text from public.my_org_ids() o) or public.ds10_staff_view()
  else false end
$$;

-- storage: the merchant may open the scale photo of a re-weigh charged to their company (Warehouse OS evidence bucket)
create or replace function public.ds10_reweigh_photo_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.dropship_reweighs r
                  where r.photo_path = p_name and r.decision = 'charged' and r.org_id in (select public.my_org_ids()))
$$;

drop policy if exists "ds claims upload" on storage.objects;
create policy "ds claims upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ds-claims' and public.ds10_claim_photo_can_upload(name));
drop policy if exists "ds claims read" on storage.objects;
create policy "ds claims read" on storage.objects for select to authenticated
  using (bucket_id = 'ds-claims' and public.ds10_claim_photo_can_read(name));
drop policy if exists "ds reweigh photo read" on storage.objects;
create policy "ds reweigh photo read" on storage.objects for select to authenticated
  using (bucket_id = 'wh-evidence' and public.ds10_reweigh_photo_can_read(name));

-- ───────────────────────── 6. Money: refund execution (one path for every refund) ─────────────────────────
-- Runs the refund of a case (c.refund_cents):
--  · payment protection still holding the money and the refund = everything held → the existing escrow refund (Held → wallet);
--  · payment protection holding the money, partial refund → the hold is released first (OCT-DS invoice + revenue, existing
--    release + DS8 trigger), then the wallet route;
--  · wallet route: Refunds & credits (expense) → wallet, or → receivable when a pay-later invoice is still unpaid (the
--    invoice is settled by the credit note); CN-DS credit note against the OCT-DS invoice.
create or replace function public.ds10_refund_execute(p_case uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases;
  so public.store_orders;
  x public.dropship_order_intake;
  h public.escrow_holds;
  inv public.documents;
  v_amt bigint;
  v_rem bigint;
  v_dest text;
  v_j uuid;
  v_cn uuid;
  v_div uuid := division_id_of('DS');
  v_label text;
  v_msg text;
  v_res jsonb;
begin
  select * into c from public.dropship_cases where id = p_case for update;
  if c.id is null then raise exception 'NOT_FOUND: This case was not found.'; end if;
  if c.status in ('refunded', 'reshipped', 'rejected', 'closed') then raise exception 'CASE_CLOSED: This case is already decided.'; end if;
  v_amt := c.refund_cents;
  if v_amt is null or v_amt <= 0 then raise exception 'INVALID_AMOUNT: Enter the refund amount.'; end if;
  select * into so from public.store_orders where id = c.store_order_id for update;
  select * into x from public.dropship_order_intake where store_order_id = so.id for update;
  if v_amt > public.ds10_refund_cap(so.id) then
    raise exception 'REFUND_TOO_HIGH: The refund can be at most %, what was paid for this order and not refunded yet.', ds_order_usd(public.ds10_refund_cap(so.id));
  end if;
  v_label := case c.kind when 'lost' then 'lost parcel claim' when 'damaged' then 'damaged parcel claim' else 'return' end;

  h := public.ds10_open_hold(so.id);
  if h.id is not null then
    v_rem := h.amount_cents - h.released_cents - h.refunded_cents;
    if v_amt >= v_rem then
      v_amt := v_rem;
      v_res := public.execute_escrow_action_internal(h.id, 'refund', v_amt, 'Dropship ' || v_label || ' ' || c.code, auth.uid(), 'wallet');
      select id into v_j from public.journals where idempotency_key = 'escrow-ref:' || h.id::text || ':' || (v_res ->> 'refunded_cents');
      v_dest := 'protection';
      v_cn := nullif(v_res ->> 'credit_note_id', '')::uuid;
    else
      perform public.execute_escrow_action_internal(h.id, 'release', v_rem, 'Released to settle ' || v_label || ' ' || c.code || ' (part refund follows)', auth.uid(), 'wallet');
      select * into x from public.dropship_order_intake where store_order_id = so.id;
    end if;
  end if;

  if v_dest is null then
    select * into inv from public.documents
     where id = coalesce(x.invoice_id, (select e.invoice_id from public.escrow_holds e where e.id = so.escrow_hold_id));
    if inv.id is null then raise exception 'NO_INVOICE: This order has no invoice to credit yet.'; end if;
    v_dest := case when x.payment_option = 'pay_later' and coalesce(inv.paid_cents, 0) < inv.amount_cents then 'invoice' else 'wallet' end;
    v_j := post_journal('Dropship ' || v_label || ' ' || c.code || ' · order ' || so.order_number || ' · ' || case when v_dest = 'wallet' then 'refund to wallet' else 'invoice credited' end,
      jsonb_build_array(
        jsonb_build_object('account', refunds_account('USD'), 'debit', v_amt, 'credit', 0),
        case when v_dest = 'wallet'
          then jsonb_build_object('account', wallet_account(so.org_id, 'USD'), 'debit', 0, 'credit', v_amt, 'org', so.org_id)
          else jsonb_build_object('account', receivable_account(so.org_id, 'USD'), 'debit', 0, 'credit', v_amt, 'org', so.org_id) end),
      'ds10-refund:' || c.id::text, 'refunds', 'store_order', so.id);
    update public.journals set division_id = v_div where id = v_j;
    update public.ledger_entries set division_id = v_div where journal_id = v_j;
    v_cn := public.ds10_credit_note(so.id, inv.id, v_amt, initcap(v_label) || ' ' || c.code, v_dest, c.code);
    if v_dest = 'invoice' then
      update public.documents set paid_cents = least(amount_cents, coalesce(paid_cents, 0) + v_amt),
             status = case when coalesce(paid_cents, 0) + v_amt >= amount_cents then 'paid' else status end,
             data = coalesce(data, '{}'::jsonb) || jsonb_build_object('credited_by', (select number from public.documents where id = v_cn))
       where id = inv.id;
    end if;
  end if;

  update public.dropship_order_intake set refunded_cents = refunded_cents + v_amt, updated_at = now() where store_order_id = so.id;
  update public.dropship_cases
     set status = 'refunded', outcome = 'refund', refund_cents = v_amt, refund_destination = v_dest, refund_journal_id = v_j,
         credit_document_id = coalesce(v_cn, credit_document_id), decided_at = coalesce(decided_at, now()), updated_at = now()
   where id = c.id;
  v_msg := format('%s refunded %s for order %s (%s %s).', ds_order_usd(v_amt),
                  case v_dest when 'invoice' then 'against your invoice' else 'to your wallet' end,
                  coalesce(so.external_order_name, so.order_number), v_label, c.code);
  perform public.ds10_case_step(c.id, 'refunded', v_msg);
  perform public.ds_order_event(so.id, so.org_id, 'refunded', case when v_dest = 'invoice' then 'Invoice credited' else 'Refunded to your wallet' end, v_msg, v_amt);
  perform public.ds10_ticket_reply(c.ticket_id, v_msg || coalesce(' ' || c.outcome_message, ''), true);
  perform public.ds10_notify(so.org_id, 'Refund for order ' || coalesce(so.external_order_name, so.order_number), v_msg, '/account/dropship/orders/' || so.id::text);
  perform write_audit('ds_case.refunded', 'dropship_cases', c.id::text,
    jsonb_build_object('org_id', so.org_id, 'code', c.code, 'amount_cents', v_amt, 'destination', v_dest, 'journal_id', v_j,
                       'credit_note_id', v_cn, 'finance_approval_id', c.finance_approval_id));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'refunded', 'refund_cents', v_amt, 'destination', v_dest,
    'credit_note', (select number from public.documents where id = v_cn), 'message', v_msg);
end $$;

-- a claim / return is decided without a refund while payment protection still holds the money → release it (dispute over)
create or replace function public.ds10_release_hold(p_so uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h public.escrow_holds := public.ds10_open_hold(p_so);
begin
  if h.id is not null and h.status = 'disputed' then
    perform public.execute_escrow_action_internal(h.id, 'release', h.amount_cents - h.released_cents - h.refunded_cents, p_reason, auth.uid(), 'wallet');
  end if;
end $$;

-- ───────────────────────── 7. Reship: a new store order (no charge) + its warehouse order at the default warehouse ─────────────────────────
-- p_lines: optional [{item_id, qty}] (≤ what the original order had); empty = every Octopus line of the original order
create or replace function public.ds10_reship_create(p_case uuid, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases;
  so public.store_orders;
  v_new uuid;
  v_wo public.wh_orders;
  v_alloc text;
  v_l jsonb;
  v_n int := 0;
begin
  select * into c from public.dropship_cases where id = p_case for update;
  select * into so from public.store_orders where id = c.store_order_id for update;
  insert into public.store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, buyer_phone, shipping_address, destination_country,
                                   buyer_currency, fx_rate_to_usd, shipping_method, incoterm, billed_weight_g, product_cents, processing_cents, shipping_cents,
                                   duties_cents, total_cents, shipping_rate_card_id, fee_version_id, duty_rate_version_id, payment_state, staff_stage,
                                   is_test, created_by, kind)
  values (so.org_id, 'manual', null, left(coalesce(so.external_order_name, so.order_number) || ' · reship ' || c.code, 200), so.buyer_name, so.buyer_phone,
          so.shipping_address, so.destination_country, so.buyer_currency, so.fx_rate_to_usd, so.shipping_method, so.incoterm, so.billed_weight_g,
          0, 0, 0, case when so.incoterm = 'DDP' then 0 end, 0, so.shipping_rate_card_id, so.fee_version_id, so.duty_rate_version_id, 'paid', 'packing',
          so.is_test, auth.uid(), 'store')
  returning id into v_new;
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
    for v_l in select * from jsonb_array_elements(p_lines) loop
      if coalesce(v_l ->> 'qty', '') !~ '^[0-9]{1,4}$' or (v_l ->> 'qty')::int <= 0 then raise exception 'INVALID_QTY: Every reship line needs a quantity.'; end if;
      if (v_l ->> 'qty')::int > coalesce((select sum(i.qty) from public.store_order_items i where i.store_order_id = so.id and i.item_id::text = v_l ->> 'item_id'), 0) then
        raise exception 'INVALID_QTY: A reship line asks for more units than the order had.';
      end if;
      insert into public.store_order_items (store_order_id, product_id, variant_id, item_id, model_no, title_snapshot, variant_label, fulfilment_type, qty,
                                            unit_product_cents, line_product_cents, buyer_unit_price_cents, declared_usd_cents)
      select v_new, i.product_id, i.variant_id, i.item_id, i.model_no, i.title_snapshot, i.variant_label, i.fulfilment_type, (v_l ->> 'qty')::int, 0, 0, null,
             round(i.declared_usd_cents::numeric * (v_l ->> 'qty')::int / i.qty)::bigint
        from public.store_order_items i where i.store_order_id = so.id and i.item_id::text = v_l ->> 'item_id'
       order by i.created_at limit 1;
      v_n := v_n + 1;
    end loop;
  else
    insert into public.store_order_items (store_order_id, product_id, variant_id, item_id, model_no, title_snapshot, variant_label, fulfilment_type, qty,
                                          unit_product_cents, line_product_cents, buyer_unit_price_cents, declared_usd_cents)
    select v_new, i.product_id, i.variant_id, i.item_id, i.model_no, i.title_snapshot, i.variant_label, i.fulfilment_type, i.qty, 0, 0, null, i.declared_usd_cents
      from public.store_order_items i where i.store_order_id = so.id;
    get diagnostics v_n = row_count;
  end if;
  if v_n = 0 then raise exception 'NO_LINES: This order has no Octopus items to reship.'; end if;
  insert into public.dropship_order_intake (store_order_id, org_id, channel, charged_cents, charged_at, test_order, problem_detail)
  values (v_new, so.org_id, 'manual', 0, now(), coalesce(so.is_test, false), jsonb_build_object('reship_of', so.id, 'case', c.code));
  perform public.ds_order_event(v_new, so.org_id, 'received', 'Reship created by Octopus',
    format('Free reship of order %s (%s). Nothing is charged.', coalesce(so.external_order_name, so.order_number), c.code));
  -- the warehouse order: default warehouse, allocated by the Warehouse OS (waits as "new" when stock is short)
  insert into public.wh_orders (warehouse_code, source, store_order_id, ship_name, ship_phone, ship_address, ship_country, created_by)
  values (public.default_warehouse_code(), 'dropship', v_new, left(btrim(so.buyer_name), 120), left(nullif(btrim(coalesce(so.buyer_phone, '')), ''), 40),
          so.shipping_address, so.destination_country, auth.uid())
  returning * into v_wo;
  insert into public.wh_order_lines (order_id, item_id, sku, name, qty, unit_weight_g)
  select v_wo.id, i.item_id, left(min(i.model_no), 64), left(min(i.title_snapshot || coalesce(' · ' || nullif(btrim(i.variant_label), ''), '')), 300),
         sum(i.qty)::integer, (select m.weight_g from public.item_master m where m.id = i.item_id)
    from public.store_order_items i where i.store_order_id = v_new group by i.item_id;
  perform public.wh_refresh_dg(v_wo.id);
  perform write_audit('wh_order.created', 'wh_orders', v_wo.id::text,
    jsonb_build_object('code', v_wo.code, 'source', 'dropship', 'store_order_id', v_new, 'reship_of', so.id, 'case', c.code));
  v_alloc := public.wh_allocate(v_wo.id);
  perform public.ds_order_event(v_new, so.org_id, 'handed_to_warehouse', 'Sent to the warehouse',
    case when v_alloc is null then 'Waiting for stock; packing starts when it arrives.' else 'Stock is reserved; the warehouse picks and packs it.' end);
  -- the store must learn the new tracking number once the reship ships (Step 7 executor; nothing is sent today)
  perform public.ds_order_channel_task(so.id, so.org_id, so.channel, 'update_tracking', jsonb_build_object('reship_store_order_id', v_new, 'case', c.code));
  return v_new;
end $$;

-- ───────────────────────── 8. Re-weigh: Warehouse OS measured weight vs the billed weight locked at intake ─────────────────────────
create or replace function public.ds10_reweigh_calc(p_so uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  so public.store_orders;
  w public.wh_orders;
  rc public.shipping_rate_cards;
  fv public.fee_versions;
  v_actual int;
  v_vol_cm3 numeric;
  v_vol_g int;
  v_billed int;
  v_tol int;
  v_ship bigint;
  v_amt bigint;
  v_photo text;
begin
  select * into so from public.store_orders where id = p_so;
  if so.id is null then return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); end if;
  select * into w from public.wh_orders where store_order_id = so.id and status in ('packed', 'labelled', 'shipped');
  if w.id is null then return jsonb_build_object('ok', false, 'reason', 'NOT_PACKED'); end if;
  select * into rc from public.shipping_rate_cards where id = so.shipping_rate_card_id;
  select * into fv from public.fee_versions where id = so.fee_version_id;
  if rc.id is null or so.billed_weight_g is null then return jsonb_build_object('ok', false, 'reason', 'NO_QUOTE', 'wh_order_id', w.id); end if;
  v_actual := coalesce((select sum(p.measured_weight_g) from public.wh_parcels p where p.order_id = w.id and p.measured_weight_g is not null), w.measured_weight_g);
  if v_actual is null then return jsonb_build_object('ok', false, 'reason', 'NOT_WEIGHED', 'wh_order_id', w.id); end if;
  v_vol_cm3 := coalesce((select sum(b.length_mm::numeric * b.width_mm * b.height_mm) / 1000.0 from public.wh_parcels p join public.wh_boxes b on b.id = p.box_id where p.order_id = w.id),
                        (select b.length_mm::numeric * b.width_mm * b.height_mm / 1000.0 from public.wh_boxes b where b.id = w.box_id), 0);
  v_vol_g := ceil(v_vol_cm3 / coalesce(nullif(rc.volumetric_divisor, 0), 5000) * 1000.0)::int;
  v_billed := (ceil(greatest(v_actual, v_vol_g)::numeric / rc.step_g::numeric)::int * rc.step_g);
  v_tol := case when fv.weigh_tolerance_g is null and fv.weigh_tolerance_pct is null then null
                else greatest(coalesce(fv.weigh_tolerance_g, 0), ceil(so.billed_weight_g * coalesce(fv.weigh_tolerance_pct, 0) / 100.0)::int) end;
  v_ship := rc.base_cents + ((v_billed / rc.step_g)::bigint * rc.per_100g_cents);
  v_ship := v_ship + round(v_ship::numeric * coalesce(rc.fuel_surcharge_bp, 0) / 10000.0)::bigint;
  v_amt := greatest(0, v_ship - so.shipping_cents);
  select e.storage_path into v_photo from public.wh_pack_evidence e
   where e.order_id = w.id and e.kind = 'scale' and e.purged_at is null order by e.created_at desc limit 1;
  return jsonb_build_object('ok', true, 'wh_order_id', w.id, 'wh_order_code', w.code, 'quoted_g', so.billed_weight_g, 'actual_g', v_actual,
    'volumetric_g', v_vol_g, 'billed_g', v_billed, 'diff_g', v_billed - so.billed_weight_g, 'tolerance_g', v_tol, 'amount_cents', v_amt,
    'new_shipping_cents', v_ship, 'photo_path', v_photo,
    'dispute_days', coalesce(fv.dispute_window_days, 7),
    'over', v_tol is not null and v_billed - so.billed_weight_g > v_tol and v_amt > 0,
    'tolerance_unknown', v_tol is null);
end $$;

-- ───────────────────────── 9. Merchant RPCs ─────────────────────────
-- Order detail (screens/OrderDetail.html): items, cost lines (Processing its own line), payment, ship-to, timeline
-- (Dropship events + warehouse milestones + carrier tracking + cases + re-weigh), what can be done now and why not,
-- cases with their steps, the re-weigh adjustment, linked tickets. Own organisation only; white-label safe.
create or replace function public.ds10_order_detail(p_so uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  so public.store_orders := public.ds_order_own(p_so);
  x public.dropship_order_intake;
  w public.wh_orders;
  inv public.documents;
  eh public.escrow_holds;
  v_delivered timestamptz;
  v_packing boolean;
  v_label boolean;
  v_handed boolean;
  v_claim_days int := public.ds10_setting_int('dropship.claim_window_days', 14, 1, 90);
  v_return_days int := public.ds10_setting_int('dropship.return_window_days', 30, 1, 120);
  v_open_claim boolean;
  v_open_return boolean;
  v_timeline jsonb;
  v_units int;
begin
  perform ds_feature_guard('orders');
  select * into x from public.dropship_order_intake where store_order_id = so.id;
  select * into w from public.wh_orders where store_order_id = so.id and status <> 'cancelled' order by created_at desc limit 1;
  select * into inv from public.documents where id = coalesce(x.invoice_id, (select e.invoice_id from public.escrow_holds e where e.id = so.escrow_hold_id));
  select * into eh from public.escrow_holds where id = so.escrow_hold_id;
  v_delivered := public.ds10_delivered_at(so.id);
  v_packing := public.ds_order_packing_started(so.id);
  v_label := public.ds10_label_created(so.id);
  v_handed := public.ds10_handed_over(so.id);
  v_open_claim := exists (select 1 from public.dropship_cases c where c.store_order_id = so.id and c.kind in ('lost', 'damaged') and c.status in ('reported', 'carrier_claim', 'awaiting_approval'));
  v_open_return := exists (select 1 from public.dropship_cases c where c.store_order_id = so.id and c.kind = 'return' and c.status in ('awaiting_return', 'received', 'awaiting_approval'));
  select coalesce(sum(i.qty), 0)::int into v_units from public.store_order_items i where i.store_order_id = so.id;

  select coalesce(jsonb_agg(t.e order by t.at, t.n), '[]'::jsonb) into v_timeline from (
    select e.created_at at, e.seq n, jsonb_build_object('source', 'order', 'kind', e.kind, 'title', e.title, 'body', e.body, 'amount_cents', e.amount_cents, 'at', e.created_at) e
      from public.dropship_order_events e where e.store_order_id = so.id
    union all
    select w.packed_at, 0, jsonb_build_object('source', 'warehouse', 'kind', 'packed', 'title', 'Packed', 'body', null, 'at', w.packed_at) where w.packed_at is not null
    union all
    select w.shipped_at, 0, jsonb_build_object('source', 'warehouse', 'kind', 'shipped', 'title', 'Shipped', 'body', 'The parcel left the warehouse.', 'at', w.shipped_at) where w.shipped_at is not null
    union all
    select te.occurred_at, 0, jsonb_build_object('source', 'tracking', 'kind', te.status, 'title', initcap(replace(te.status, '_', ' ')),
                                                 'body', concat_ws(' · ', nullif(te.description, ''), nullif(te.location, '')), 'at', te.occurred_at)
      from public.tracking_events te join public.shipments s on s.id = te.shipment_id where s.store_order_id = so.id
    union all
    select (h ->> 'at')::timestamptz, 0, jsonb_build_object('source', 'case', 'kind', h ->> 'step', 'title', c.code || ' · ' || case c.kind when 'lost' then 'Lost parcel' when 'damaged' then 'Damaged parcel' else 'Return' end,
                                                             'body', h ->> 'text', 'at', h ->> 'at')
      from public.dropship_cases c cross join lateral jsonb_array_elements(c.history) h where c.store_order_id = so.id
    union all
    select r.created_at, 0, jsonb_build_object('source', 'reweigh', 'kind', 'reweigh', 'title', 'Re-weigh: ' || ds_order_usd(r.amount_cents),
                                               'body', format('The parcel weighed %s g; %s g was billed at payment.', r.billed_weight_g, r.quoted_weight_g), 'at', r.created_at)
      from public.dropship_reweighs r where r.store_order_id = so.id and r.decision = 'charged'
  ) t;

  return jsonb_build_object(
    'order', jsonb_build_object('id', so.id, 'order_number', so.order_number, 'external_order_name', so.external_order_name, 'channel', so.channel,
      'kind', so.kind, 'created_at', so.created_at, 'merchant_status', so.merchant_status, 'payment_state', so.payment_state,
      'destination_country', so.destination_country, 'incoterm', so.incoterm, 'shipping_method', so.shipping_method, 'cancelled_at', so.cancelled_at,
      'delivered_at', v_delivered, 'units', v_units, 'test_order', coalesce(x.test_order, false),
      'reship_of', (select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'external_order_name', o.external_order_name)
                      from public.store_orders o where o.id::text = x.problem_detail ->> 'reship_of')),
    'items', coalesce((select jsonb_agg(jsonb_build_object('title', i.title_snapshot, 'variant', i.variant_label, 'qty', i.qty, 'model_no', i.model_no,
                                                           'item_id', i.item_id) order by i.created_at, i.id)
                         from public.store_order_items i where i.store_order_id = so.id), '[]'::jsonb),
    'other_items', coalesce(x.other_items_count, 0),
    'cost', jsonb_build_object('product_cents', so.product_cents, 'processing_cents', so.processing_cents, 'shipping_cents', so.shipping_cents,
      'duties_cents', case when so.incoterm = 'DDP' then so.duties_cents end, 'total_cents', so.total_cents, 'refunded_cents', coalesce(x.refunded_cents, 0)),
    'payment', jsonb_build_object('option', x.payment_option, 'charged_cents', x.charged_cents, 'charged_at', x.charged_at,
      'invoice_number', inv.number, 'invoice_status', inv.status, 'protection_status', eh.status, 'protection_release_at', eh.auto_release_at,
      'hold_code', x.hold_code, 'hold_message', x.hold_message, 'expired_at', x.expired_at, 'payment_due_at', x.payment_due_at),
    'ship_to', jsonb_build_object('name', ds_order_buyer_short(so.buyer_name), 'address', so.shipping_address),
    'tracking_token', coalesce(w.tracking_token, (select sh.tracking_token from public.shipments sh where sh.store_order_id = so.id and sh.tracking_token is not null order by sh.created_at desc limit 1)),
    'stage', jsonb_build_object('packing_started', v_packing, 'label_created', v_label, 'handed_over', v_handed, 'delivered', v_delivered is not null,
      'packed', w.packed_at is not null or v_handed, 'address_ok', coalesce(x.address_ok, true)),
    'actions', jsonb_build_object(
      'cancel', so.cancelled_at is null and not v_packing and x.expired_at is null,
      'cancel_reason', case when so.cancelled_at is not null then 'This order is cancelled.' when x.expired_at is not null then 'The payment window ended; the order went back to your store.'
                            when v_packing then 'Packing has started, so this order can''t be cancelled. After delivery you can ask for a return.' end,
      'address', so.cancelled_at is null and so.kind = 'store',
      'address_after_label', v_label,
      'claim', so.cancelled_at is null and v_handed and not v_open_claim and (v_delivered is null or v_delivered > now() - make_interval(days => v_claim_days)),
      'claim_reason', case when so.cancelled_at is not null then 'This order is cancelled.' when not v_handed then 'Lost and damaged parcel claims open once the parcel has shipped.'
                           when v_open_claim then 'A claim for this order is already open.'
                           when v_delivered <= now() - make_interval(days => v_claim_days) then format('Claims are possible up to %s days after delivery.', v_claim_days) end,
      'return', so.cancelled_at is null and v_delivered is not null and not v_open_return and v_delivered > now() - make_interval(days => v_return_days),
      'return_reason', case when so.cancelled_at is not null then 'This order is cancelled.' when v_delivered is null then 'Returns open once the parcel is delivered.'
                            when v_open_return then 'A return for this order is already open.'
                            when v_delivered <= now() - make_interval(days => v_return_days) then format('Returns are possible up to %s days after delivery.', v_return_days) end,
      'claim_window_days', v_claim_days, 'return_window_days', v_return_days),
    'cases', coalesce((select jsonb_agg(public.ds10_case_json(c, false) order by c.created_at desc) from public.dropship_cases c where c.store_order_id = so.id), '[]'::jsonb),
    'reweigh', (select jsonb_build_object('id', r.id, 'amount_cents', r.amount_cents, 'quoted_weight_g', r.quoted_weight_g, 'billed_weight_g', r.billed_weight_g,
                                          'measured_weight_g', r.measured_weight_g, 'tolerance_g', r.tolerance_g, 'dispute_until', r.dispute_until,
                                          'can_dispute', r.dispute_state is null and r.dispute_until > now(), 'dispute_state', r.dispute_state,
                                          'dispute_reason', r.dispute_reason, 'dispute_answer', r.dispute_answer, 'refund_cents', r.refund_cents,
                                          'invoice_number', (select d.number from public.documents d where d.id = r.invoice_id),
                                          'credit_note', (select d.number from public.documents d where d.id = r.credit_document_id),
                                          'photo_path', r.photo_path, 'created_at', r.created_at)
                  from public.dropship_reweighs r where r.store_order_id = so.id and r.decision = 'charged'),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'subject', t.subject, 'status', t.status, 'updated_at', t.updated_at) order by t.updated_at desc)
                           from public.tickets t where t.store_order_id = so.id), '[]'::jsonb),
    'return_address', jsonb_build_object(
      'merchant', (select jsonb_build_object('name', p.return_name, 'line1', p.return_line1, 'line2', p.return_line2, 'city', p.return_city,
                                             'region', p.return_region, 'postcode', p.return_postal_code, 'country', p.return_country)
                     from public.dropship_seller_profiles p where p.org_id = so.org_id and p.status = 'approved' limit 1),
      'warehouse', (select case when nullif(btrim(coalesce(wh.address, '')), '') is null then null
                                else jsonb_build_object('line1', wh.address, 'city', wh.city, 'country', wh.country) end
                      from public.warehouses wh where wh.code = coalesce(w.warehouse_code, public.default_warehouse_code()))),
    'timeline', v_timeline);
end $$;

-- Lost or damaged parcel (after handover): the merchant's choice (reship / refund), what happened, photos (damaged: ≥ 1).
-- p_photos: paths already uploaded to 'ds-claims' under <org>/<store order>/. Opens a ticket linked to the order.
create or replace function public.ds10_claim_open(p_so uuid, p_kind text, p_choice text, p_message text, p_photos text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders := public.ds_order_own(p_so);
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_msg text := btrim(coalesce(p_message, ''));
  v_days int := public.ds10_setting_int('dropship.claim_window_days', 14, 1, 90);
  v_deliv timestamptz;
  v_case public.dropship_cases;
  v_p text;
  v_ticket uuid;
  h public.escrow_holds;
begin
  perform ds_feature_guard('orders');
  -- paused / closed merchants keep support for orders in progress: a claim is allowed
  if v_kind not in ('lost', 'damaged') then raise exception 'INVALID_INPUT: Choose lost or damaged.'; end if;
  if v_choice not in ('reship', 'refund') then raise exception 'INVALID_INPUT: Choose reship or refund to your wallet.'; end if;
  if length(v_msg) < 10 or length(v_msg) > 2000 then raise exception 'INVALID_INPUT: Describe what happened (10 to 2,000 characters).'; end if;
  if so.cancelled_at is not null then raise exception 'ORDER_CANCELLED: This order is cancelled.'; end if;
  if not public.ds10_handed_over(so.id) then raise exception 'NOT_SHIPPED: Lost and damaged parcel claims open once the parcel has shipped.'; end if;
  v_deliv := public.ds10_delivered_at(so.id);
  if v_kind = 'lost' and v_deliv is not null then raise exception 'DELIVERED: The carrier shows this parcel as delivered. If it arrived damaged, choose damaged.'; end if;
  if v_deliv is not null and v_deliv <= now() - make_interval(days => v_days) then
    raise exception 'TOO_LATE: Claims are possible up to % days after delivery.', v_days;
  end if;
  if exists (select 1 from public.dropship_cases c where c.store_order_id = so.id and c.kind in ('lost', 'damaged') and c.status in ('reported', 'carrier_claim', 'awaiting_approval')) then
    raise exception 'ALREADY_OPEN: A claim for this order is already open.';
  end if;
  if v_kind = 'damaged' and coalesce(cardinality(p_photos), 0) = 0 then raise exception 'PHOTO_REQUIRED: Add at least one photo of the damage.'; end if;
  if coalesce(cardinality(p_photos), 0) > 6 then raise exception 'TOO_MANY_PHOTOS: Up to 6 photos.'; end if;
  insert into public.dropship_cases (store_order_id, org_id, kind, merchant_choice, description)
  values (so.id, so.org_id, v_kind, v_choice, v_msg) returning * into v_case;
  foreach v_p in array coalesce(p_photos, '{}') loop
    if v_p !~ ('^' || so.org_id::text || '/' || so.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then raise exception 'INVALID_PHOTO: A photo is not filed under this order.'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ds-claims' and o.name = v_p) then raise exception 'PHOTO_MISSING: Upload the photo first.'; end if;
    insert into public.dropship_case_photos (case_id, org_id, path) values (v_case.id, so.org_id, v_p);
  end loop;
  v_ticket := public.ds10_ticket_open(so.org_id, so.id,
    format('%s claim %s · order %s', case v_kind when 'lost' then 'Lost parcel' else 'Damaged parcel' end, v_case.code, coalesce(so.external_order_name, so.order_number)),
    'order_problem', format('%s%sThe merchant asks for: %s.', v_msg, E'\n\n', case v_choice when 'reship' then 'a reship' else 'a refund to the wallet' end),
    coalesce((select jsonb_agg(jsonb_build_object('path', p.path, 'name', 'Photo', 'bucket', 'ds-claims')) from public.dropship_case_photos p where p.case_id = v_case.id), '[]'::jsonb));
  update public.dropship_cases set ticket_id = v_ticket where id = v_case.id;
  perform public.ds10_case_step(v_case.id, 'reported', format('You reported the parcel as %s and asked for %s.', v_kind, case v_choice when 'reship' then 'a reship' else 'a refund' end));
  -- payment protection still holding the money: the dispute keeps it held until Octopus decides
  h := public.ds10_open_hold(so.id);
  if h.id is not null and h.status = 'held' then
    perform public.open_escrow_dispute(h.id, format('Dropship %s claim %s', v_kind, v_case.code));
  end if;
  perform write_audit('ds_case.opened', 'dropship_cases', v_case.id::text,
    jsonb_build_object('org_id', so.org_id, 'code', v_case.code, 'kind', v_kind, 'choice', v_choice, 'photos', coalesce(cardinality(p_photos), 0), 'ticket_id', v_ticket));
  return jsonb_build_object('ok', true, 'id', v_case.id, 'code', v_case.code, 'ticket_id', v_ticket,
    'message', format('Claim %s sent. Octopus support replies in Support; the money stays with Octopus until it is decided.', v_case.code));
end $$;

-- Buyer return (after delivery): to the merchant's own return address (nothing for Octopus to refund) or to the 3PL
-- (the warehouse registers it on arrival; the refund follows the return rules after inspection).
-- p_lines: [{item_id, qty}] (≤ ordered), empty = everything.
create or replace function public.ds10_return_open(p_so uuid, p_to text, p_reason text, p_message text, p_lines jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders := public.ds_order_own(p_so);
  v_to text := lower(btrim(coalesce(p_to, '')));
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_msg text := btrim(coalesce(p_message, ''));
  v_days int := public.ds10_setting_int('dropship.return_window_days', 30, 1, 120);
  v_deliv timestamptz := public.ds10_delivered_at(p_so);
  v_units jsonb;
  v_l jsonb;
  v_case public.dropship_cases;
  v_ticket uuid;
  v_text text;
begin
  perform ds_feature_guard('orders');
  if v_to not in ('merchant', 'warehouse') then raise exception 'INVALID_INPUT: Choose where the buyer sends it back.'; end if;
  if v_reason not in ('changed_mind', 'faulty', 'wrong_item', 'other') then raise exception 'INVALID_INPUT: Choose why the buyer returns it.'; end if;
  if length(v_msg) < 5 or length(v_msg) > 2000 then raise exception 'INVALID_INPUT: Tell us about the return (5 to 2,000 characters).'; end if;
  if so.cancelled_at is not null then raise exception 'ORDER_CANCELLED: This order is cancelled.'; end if;
  if v_deliv is null then raise exception 'NOT_DELIVERED: Returns open once the parcel is delivered.'; end if;
  if v_deliv <= now() - make_interval(days => v_days) then raise exception 'TOO_LATE: Returns are possible up to % days after delivery.', v_days; end if;
  if exists (select 1 from public.dropship_cases c where c.store_order_id = so.id and c.kind = 'return' and c.status in ('awaiting_return', 'received', 'awaiting_approval')) then
    raise exception 'ALREADY_OPEN: A return for this order is already open.';
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
    v_units := '[]'::jsonb;
    for v_l in select * from jsonb_array_elements(p_lines) loop
      if coalesce(v_l ->> 'qty', '') !~ '^[0-9]{1,4}$' or (v_l ->> 'qty')::int <= 0 then raise exception 'INVALID_QTY: Enter how many units come back.'; end if;
      if (v_l ->> 'qty')::int > coalesce((select sum(i.qty) from public.store_order_items i where i.store_order_id = so.id and i.item_id::text = v_l ->> 'item_id'), 0) then
        raise exception 'INVALID_QTY: More units than the order had.';
      end if;
      v_units := v_units || jsonb_build_array((select jsonb_build_object('item_id', i.item_id, 'model_no', i.model_no, 'title', i.title_snapshot, 'qty', (v_l ->> 'qty')::int)
                                                 from public.store_order_items i where i.store_order_id = so.id and i.item_id::text = v_l ->> 'item_id' order by i.created_at limit 1));
    end loop;
  else
    select jsonb_agg(u) into v_units from (select jsonb_build_object('item_id', i.item_id, 'model_no', min(i.model_no), 'title', min(i.title_snapshot), 'qty', sum(i.qty)::int) u
                                             from public.store_order_items i where i.store_order_id = so.id group by i.item_id) z;
  end if;
  insert into public.dropship_cases (store_order_id, org_id, kind, status, description, return_to, return_reason, return_units, decided_at, outcome, outcome_message)
  values (so.id, so.org_id, 'return', case when v_to = 'merchant' then 'closed' else 'awaiting_return' end, v_msg, v_to, v_reason, v_units,
          case when v_to = 'merchant' then now() end, case when v_to = 'merchant' then 'none' end,
          case when v_to = 'merchant' then 'The buyer sends it to your own return address. You handle it with the buyer; Octopus refunds nothing for returns you receive yourself.' end)
  returning * into v_case;
  v_text := case when v_to = 'merchant' then 'Return to your own return address recorded. Octopus refunds nothing for returns you receive yourself.'
                 else 'Return to the Octopus warehouse opened. Octopus support replies in Support with the return address; the warehouse checks the parcel when it arrives.' end;
  if v_to = 'warehouse' then
    v_ticket := public.ds10_ticket_open(so.org_id, so.id, format('Return %s · order %s', v_case.code, coalesce(so.external_order_name, so.order_number)), 'order_problem',
      format('%s%sReturn to the warehouse · reason: %s.', v_msg, E'\n\n', replace(v_reason, '_', ' ')));
    update public.dropship_cases set ticket_id = v_ticket where id = v_case.id;
  end if;
  perform public.ds10_case_step(v_case.id, 'reported', v_text);
  perform write_audit('ds_case.opened', 'dropship_cases', v_case.id::text,
    jsonb_build_object('org_id', so.org_id, 'code', v_case.code, 'kind', 'return', 'to', v_to, 'reason', v_reason, 'ticket_id', v_ticket));
  return jsonb_build_object('ok', true, 'id', v_case.id, 'code', v_case.code, 'ticket_id', v_ticket, 'status', v_case.status, 'message', v_text);
end $$;

-- Re-weigh dispute (within the window shown on the charge)
create or replace function public.ds10_reweigh_dispute(p_reweigh uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
  r public.dropship_reweighs;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform ds_feature_guard('orders');
  select * into r from public.dropship_reweighs where id = p_reweigh for update;
  if r.id is null or r.org_id <> v_org or r.decision <> 'charged' then raise exception 'NOT_FOUND: This charge was not found.'; end if;
  if r.dispute_state is not null then raise exception 'ALREADY_DISPUTED: This charge is already disputed.'; end if;
  if r.dispute_until <= now() then raise exception 'TOO_LATE: The dispute window for this charge ended on %.', to_char(r.dispute_until at time zone 'UTC', 'DD Mon YYYY'); end if;
  if length(v_reason) < 5 or length(v_reason) > 600 then raise exception 'INVALID_INPUT: Tell us why the charge is wrong (5 to 600 characters).'; end if;
  update public.dropship_reweighs set dispute_state = 'open', dispute_reason = v_reason, disputed_at = now(), updated_at = now() where id = r.id;
  perform write_audit('ds_reweigh.disputed', 'dropship_reweighs', r.id::text, jsonb_build_object('org_id', r.org_id, 'store_order_id', r.store_order_id));
  return jsonb_build_object('ok', true, 'message', 'Dispute sent. Octopus checks the weight and photo and replies on this order.');
end $$;

-- Address change from the order page: DS8's rule now says "until the label exists"; after the label the change becomes a
-- problem and a ticket linked to the order is opened (one per order while it is open).
create or replace function public.ds10_order_address(p_so uuid, p_address jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders := public.ds_order_own(p_so);
  v jsonb;
  v_ticket uuid;
begin
  perform ds_feature_guard('orders');
  v := public.ds_order_address_core(so.id, p_address, 'merchant');
  if coalesce((v ->> 'problem')::boolean, false) then
    select t.id into v_ticket from public.tickets t
     where t.store_order_id = so.id and t.category = 'order_problem' and t.subject like 'Address change%' and t.status not in ('resolved', 'closed') limit 1;
    if v_ticket is null then
      v_ticket := public.ds10_ticket_open(so.org_id, so.id, format('Address change after the label · order %s', coalesce(so.external_order_name, so.order_number)), 'order_problem',
        format('Please redirect the parcel if you can. New address: %s', concat_ws(', ', p_address ->> 'name', p_address ->> 'line1', p_address ->> 'line2',
               p_address ->> 'city', p_address ->> 'region', p_address ->> 'postcode', so.destination_country)));
    end if;
    v := v || jsonb_build_object('ticket_id', v_ticket);
  end if;
  return v;
end $$;

-- Support page (screens/Support.html): the company's tickets on the shared desk (any division) with what each is linked to,
-- recent store orders for the "Order number" field, and whether Orders is switched on.
create or replace function public.ds10_support_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
begin
  perform ds_feature_guard('support');
  return jsonb_build_object(
    'orders_on', dropship_feature_on('orders'),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'code', t.code, 'subject', t.subject, 'category', t.category, 'status', t.status, 'updated_at', t.updated_at, 'created_at', t.created_at,
        'store_order', (select jsonb_build_object('id', so.id, 'order_number', so.order_number, 'external_order_name', so.external_order_name) from public.store_orders so where so.id = t.store_order_id),
        'rfq', (select r.code from public.rfqs r where r.id = t.rfq_id),
        'b2b_order', (select o.code from public.orders o where o.id = t.order_id),
        'case', (select jsonb_build_object('code', c.code, 'kind', c.kind, 'status', c.status) from public.dropship_cases c where c.ticket_id = t.id limit 1))
        order by t.updated_at desc)
      from (select * from public.tickets where org_id = v_org order by updated_at desc limit 100) t), '[]'::jsonb),
    'orders', case when dropship_feature_on('orders') then coalesce((select jsonb_agg(jsonb_build_object('id', so.id, 'order_number', so.order_number, 'external_order_name', so.external_order_name) order by so.created_at desc)
                                                                     from (select * from public.store_orders where org_id = v_org order by created_at desc limit 50) so), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- New ticket from the Support page: subject, category, optional order (own store order number), message, attachments in the
-- company's folder of the existing 'tickets' bucket. Allowed for paused / closed merchants (support keeps working).
create or replace function public.ds10_ticket_create(p_subject text, p_category text, p_order_ref text, p_body text, p_attachments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := ds_org_read();
  v_sub text := btrim(coalesce(p_subject, ''));
  v_cat text := lower(btrim(coalesce(p_category, '')));
  v_body text := btrim(coalesce(p_body, ''));
  v_ref text := nullif(btrim(coalesce(p_order_ref, '')), '');
  v_so uuid;
  v_id uuid;
  v_a jsonb;
begin
  perform ds_feature_guard('support');
  if length(v_sub) < 3 or length(v_sub) > 200 then raise exception 'INVALID_INPUT: Subject: write 3 to 200 characters.'; end if;
  if v_cat not in ('order_problem', 'product_request', 'billing', 'store_connection', 'other') then raise exception 'INVALID_INPUT: Choose a category.'; end if;
  if length(v_body) < 5 or length(v_body) > 10000 then raise exception 'INVALID_INPUT: Message: describe the problem or question (at least 5 characters).'; end if;
  if v_ref is not null then
    select so.id into v_so from public.store_orders so
     where so.org_id = v_org and (so.order_number = v_ref or so.external_order_name = v_ref or so.external_order_name = '#' || ltrim(v_ref, '#') or so.id::text = v_ref)
     order by so.created_at desc limit 1;
    if v_so is null then raise exception 'ORDER_NOT_FOUND: Order number: no order of yours has the number %. Check it on the Orders page or leave it empty.', v_ref; end if;
  end if;
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' or jsonb_array_length(p_attachments) > 10 then raise exception 'INVALID_INPUT: Up to 10 files.'; end if;
  for v_a in select * from jsonb_array_elements(p_attachments) loop
    if coalesce(v_a ->> 'path', '') not like v_org::text || '/%' or (v_a ->> 'path') like '%..%' then raise exception 'INVALID_INPUT: A file is not in your company folder.'; end if;
  end loop;
  v_id := public.ds10_ticket_open(v_org, v_so, v_sub, v_cat, v_body, p_attachments);
  perform write_audit('ds_ticket.created', 'tickets', v_id::text, jsonb_build_object('org_id', v_org, 'category', v_cat, 'store_order_id', v_so));
  return jsonb_build_object('ok', true, 'id', v_id, 'code', (select code from public.tickets where id = v_id));
end $$;

-- ───────────────────────── 10. Staff RPCs (Dropship staff › Order problems; Support / Dropship editors; Finance approves) ─────────────────────────
create or replace function public.ds10_staff_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v jsonb;
  v_cand jsonb := '[]'::jsonb;
begin
  if not public.ds10_staff_view() then raise exception 'FORBIDDEN'; end if;
  -- re-weigh to decide: packed Dropship warehouse orders of the last 60 days without a decision, over tolerance or tolerance not set
  for r in
    select so.id, so.order_number, so.external_order_name, so.org_id, o.name merchant
      from public.wh_orders w join public.store_orders so on so.id = w.store_order_id join public.organizations o on o.id = so.org_id
     where w.source = 'dropship' and w.status in ('packed', 'labelled', 'shipped') and coalesce(w.packed_at, w.updated_at) > now() - interval '60 days'
       and so.cancelled_at is null and coalesce(so.total_cents, 0) > 0
       and not exists (select 1 from public.dropship_reweighs x where x.store_order_id = so.id)
     order by w.packed_at desc nulls last limit 100
  loop
    v := public.ds10_reweigh_calc(r.id);
    if coalesce((v ->> 'ok')::boolean, false) and ((v ->> 'over')::boolean or ((v ->> 'tolerance_unknown')::boolean and (v ->> 'diff_g')::int > 0 and (v ->> 'amount_cents')::bigint > 0)) then
      v_cand := v_cand || jsonb_build_array(v || jsonb_build_object('store_order_id', r.id, 'order_number', r.order_number, 'external_order_name', r.external_order_name, 'merchant', r.merchant));
    end if;
  end loop;
  return jsonb_build_object(
    'can_edit', public.ds10_staff_edit(),
    'can_approve', can('finance', 'approve') or is_admin(),
    'approval_limit_cents', public.ds10_approval_limit_cents(),
    'open', coalesce((select jsonb_agg(public.ds10_case_json(c, true) order by c.created_at) from public.dropship_cases c
                        where c.status in ('reported', 'carrier_claim', 'awaiting_return', 'received', 'awaiting_approval')), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(public.ds10_case_json(c, true) order by c.decided_at desc) from
                        (select * from public.dropship_cases where status in ('reshipped', 'refunded', 'rejected', 'closed') order by decided_at desc limit 50) c), '[]'::jsonb),
    'reweigh_candidates', v_cand,
    'reweigh_disputes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'store_order_id', x.store_order_id, 'order_number', so.order_number,
                                    'external_order_name', so.external_order_name, 'merchant', o.name, 'amount_cents', x.amount_cents,
                                    'quoted_weight_g', x.quoted_weight_g, 'billed_weight_g', x.billed_weight_g, 'tolerance_g', x.tolerance_g,
                                    'dispute_reason', x.dispute_reason, 'disputed_at', x.disputed_at, 'photo_path', x.photo_path) order by x.disputed_at)
                                  from public.dropship_reweighs x join public.store_orders so on so.id = x.store_order_id join public.organizations o on o.id = x.org_id
                                 where x.dispute_state = 'open'), '[]'::jsonb));
end $$;

create or replace function public.ds10_case_for_staff(p_case uuid)
returns public.dropship_cases
language plpgsql
security definer
set search_path = public
as $$
declare c public.dropship_cases;
begin
  if not public.ds10_staff_edit() then raise exception 'FORBIDDEN: Support or Dropship editors decide order problems.'; end if;
  select * into c from public.dropship_cases where id = p_case for update;
  if c.id is null then raise exception 'NOT_FOUND: This case was not found.'; end if;
  if c.status in ('reshipped', 'refunded', 'rejected', 'closed') then raise exception 'CASE_CLOSED: This case is already decided.'; end if;
  if c.status = 'awaiting_approval' then raise exception 'WAITING_FOR_APPROVAL: A refund is waiting for a second Finance approver.'; end if;
  return c;
end $$;

-- claim opened with the carrier (reference shown to the merchant)
create or replace function public.ds10_case_carrier(p_case uuid, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases := public.ds10_case_for_staff(p_case);
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
begin
  if c.kind = 'return' then raise exception 'INVALID_STEP: Returns have no carrier claim.'; end if;
  if v_ref is null or length(v_ref) > 64 then raise exception 'INVALID_INPUT: Enter the carrier''s claim number (up to 64 characters).'; end if;
  update public.dropship_cases set status = 'carrier_claim', carrier_claim_ref = v_ref, updated_at = now() where id = c.id;
  perform public.ds10_case_step(c.id, 'carrier_claim', format('Claim opened with the carrier, claim no. %s. The carrier usually decides within a few days.', v_ref));
  perform public.ds10_ticket_reply(c.ticket_id, format('We opened a claim with the carrier (claim no. %s). We will let you know the outcome here.', v_ref), false);
  perform write_audit('ds_case.carrier_claim', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'ref', v_ref));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'carrier_claim');
end $$;

-- reship now at Octopus cost (no new charge): new store order + warehouse order at the default warehouse
create or replace function public.ds10_case_reship(p_case uuid, p_message text default null, p_lines jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases := public.ds10_case_for_staff(p_case);
  v_new uuid;
  v_no text;
  v_msg text;
begin
  if c.kind = 'return' then raise exception 'INVALID_STEP: Returns are refunded or closed, not reshipped.'; end if;
  v_new := public.ds10_reship_create(c.id, p_lines);
  select order_number into v_no from public.store_orders where id = v_new;
  v_msg := format('Octopus reships it at no cost to you: new order %s.', v_no) || coalesce(' ' || nullif(btrim(p_message), ''), '');
  update public.dropship_cases set status = 'reshipped', outcome = 'reship', reship_store_order_id = v_new, outcome_message = left(v_msg, 600),
         decided_at = now(), updated_at = now() where id = c.id;
  perform public.ds10_release_hold(c.store_order_id, 'Claim ' || c.code || ' decided: reshipped');
  perform public.ds10_case_step(c.id, 'reshipped', v_msg);
  perform public.ds10_ticket_reply(c.ticket_id, v_msg, true);
  perform public.ds10_notify(c.org_id, 'Reship for claim ' || c.code, v_msg, '/account/dropship/orders/' || v_new::text);
  perform write_audit('ds_case.reshipped', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'reship_store_order_id', v_new));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'reshipped', 'reship_store_order_id', v_new, 'order_number', v_no);
end $$;

-- refund to the wallet: up to US$1,000 at once; above that a Finance approval by a second person first
create or replace function public.ds10_case_refund(p_case uuid, p_amount_cents bigint, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases := public.ds10_case_for_staff(p_case);
  so public.store_orders;
  v_fa uuid;
  v_cap bigint;
begin
  if c.kind = 'return' and c.status <> 'received' then raise exception 'INVALID_STEP: Returns are refunded after the warehouse has checked them (Settle return).'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT: Enter the refund amount.'; end if;
  v_cap := public.ds10_refund_cap(c.store_order_id);
  if p_amount_cents > v_cap then raise exception 'REFUND_TOO_HIGH: The refund can be at most %.', ds_order_usd(v_cap); end if;
  select * into so from public.store_orders where id = c.store_order_id;
  update public.dropship_cases set refund_cents = p_amount_cents, outcome_message = left(nullif(btrim(coalesce(p_message, '')), ''), 600), updated_at = now() where id = c.id;
  if p_amount_cents <= public.ds10_approval_limit_cents() then
    return public.ds10_refund_execute(c.id);
  end if;
  -- over the limit: Finance approval (org_id stays empty: DS10 runs the refund itself once a different person approves)
  insert into public.finance_approvals (kind, org_id, amount_cents, currency, reason, requested_by)
  values ('refund', null, p_amount_cents, 'USD',
          left(format('Dropship %s %s · order %s · %s · refund %s to the merchant wallet', case c.kind when 'return' then 'return' else c.kind || ' parcel claim' end,
                      c.code, so.order_number, (select name from public.organizations where id = c.org_id), ds_order_usd(p_amount_cents)), 500),
          auth.uid())
  returning id into v_fa;
  perform write_audit('finance.request', 'finance_approvals', v_fa::text, jsonb_build_object('kind', 'refund', 'amount', p_amount_cents, 'currency', 'USD', 'case', c.code));
  update public.dropship_cases set status = 'awaiting_approval', finance_approval_id = v_fa, updated_at = now() where id = c.id;
  perform public.ds10_case_step(c.id, 'awaiting_approval', format('Refund of %s proposed; refunds above US$1,000 need a second Finance approver.', ds_order_usd(p_amount_cents)));
  perform write_audit('ds_case.refund_proposed', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'amount_cents', p_amount_cents, 'finance_approval_id', v_fa));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'awaiting_approval', 'finance_approval_id', v_fa,
    'message', 'Waiting for approval. Another Finance user or an admin must approve this refund.');
end $$;

-- Finance (a different person) approves or rejects a proposed refund; same effect as approving it in Admin › Finance
create or replace function public.ds10_refund_approve(p_case uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases;
  a public.finance_approvals;
begin
  perform require_step_up();
  if not (can('finance', 'approve') or is_admin()) then raise exception 'FORBIDDEN: Finance approvers decide refunds above US$1,000.'; end if;
  select * into c from public.dropship_cases where id = p_case for update;
  if c.id is null or c.status <> 'awaiting_approval' then raise exception 'NOT_WAITING: This case has no refund waiting for approval.'; end if;
  select * into a from public.finance_approvals where id = c.finance_approval_id for update;
  if a.status <> 'requested' then raise exception 'INVALID_TRANSITION'; end if;
  if a.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE: A different person must approve the refund you proposed.'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'INVALID_INPUT: Say why the refund is rejected.'; end if;
  update public.finance_approvals set status = (case when p_approve then 'approved' else 'rejected' end)::approval_status,
         approved_by = auth.uid(), decided_at = now() where id = a.id;
  perform write_audit('finance.decide', 'finance_approvals', a.id::text, jsonb_build_object('approve', p_approve, 'note', p_note, 'case', c.code));
  -- the trigger on finance_approvals runs the refund / puts the case back (one path for both screens)
  select * into c from public.dropship_cases where id = p_case;
  return jsonb_build_object('ok', true, 'code', c.code, 'status', c.status);
end $$;

-- reject (claim not covered / return not accepted) with the reason shown to the merchant
create or replace function public.ds10_case_reject(p_case uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases := public.ds10_case_for_staff(p_case);
  v_msg text := btrim(coalesce(p_message, ''));
begin
  if length(v_msg) < 5 or length(v_msg) > 600 then raise exception 'INVALID_INPUT: Tell the merchant why (5 to 600 characters).'; end if;
  update public.dropship_cases set status = 'rejected', outcome = 'reject', outcome_message = v_msg, decided_at = now(), updated_at = now() where id = c.id;
  perform public.ds10_release_hold(c.store_order_id, 'Claim ' || c.code || ' decided: not refunded');
  perform public.ds10_case_step(c.id, 'rejected', v_msg);
  perform public.ds10_ticket_reply(c.ticket_id, v_msg, true);
  perform public.ds10_notify(c.org_id, 'Decision on ' || c.code, v_msg, '/account/dropship/orders/' || c.store_order_id::text);
  perform write_audit('ds_case.rejected', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'message', v_msg));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'rejected');
end $$;

-- the warehouse registers the returned parcel (Warehouse OS W5 return; staff with the 'returns' role at that warehouse)
create or replace function public.ds10_return_receive(p_case uuid, p_carrier_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases;
  so public.store_orders;
  w public.wh_orders;
  v_wh text;
  v_ret public.wh_returns;
  v_u jsonb;
  v_ref text := nullif(btrim(coalesce(p_carrier_ref, '')), '');
begin
  select * into c from public.dropship_cases where id = p_case for update;
  if c.id is null or c.kind <> 'return' then raise exception 'NOT_FOUND: This return was not found.'; end if;
  if c.status <> 'awaiting_return' then raise exception 'INVALID_STEP: This return is not waiting for the parcel.'; end if;
  select * into so from public.store_orders where id = c.store_order_id;
  select * into w from public.wh_orders where store_order_id = so.id and status <> 'cancelled' order by created_at desc limit 1;
  v_wh := coalesce(w.warehouse_code, public.default_warehouse_code());
  if not exists (select 1 from public.warehouses where code = v_wh and status = 'active') then v_wh := public.default_warehouse_code(); end if;
  if not public.wh_can('returns', v_wh) then raise exception 'FORBIDDEN: Warehouse staff with the returns role register returns.'; end if;
  if v_ref is not null and length(v_ref) > 64 then raise exception 'INVALID_REFERENCE: The carrier reference has up to 64 characters.'; end if;
  insert into public.wh_returns (org_id, warehouse_code, order_id, carrier_ref, reason, received_by)
  values (c.org_id, v_wh, w.id, coalesce(v_ref, c.return_tracking), left(format('Dropship return %s · order %s · %s', c.code, so.order_number, replace(c.return_reason, '_', ' ')), 500), auth.uid())
  returning * into v_ret;
  for v_u in select * from jsonb_array_elements(coalesce(c.return_units, '[]'::jsonb)) loop
    insert into public.wh_return_lines (return_id, item_id, sku, name, qty)
    values (v_ret.id, (v_u ->> 'item_id')::uuid, left(coalesce(v_u ->> 'model_no', 'DS'), 64), left(coalesce(v_u ->> 'title', 'Dropship item'), 300), (v_u ->> 'qty')::int)
    on conflict (return_id, item_id) do update set qty = public.wh_return_lines.qty + excluded.qty;
  end loop;
  perform write_audit('wh_return.registered', 'wh_returns', v_ret.id::text,
    jsonb_build_object('code', v_ret.code, 'org_id', c.org_id, 'warehouse', v_wh, 'order_id', w.id, 'carrier_ref', v_ret.carrier_ref, 'source', 'dropship', 'case', c.code));
  update public.dropship_cases set status = 'received', wh_return_id = v_ret.id, updated_at = now() where id = c.id;
  perform public.ds10_case_step(c.id, 'received', 'The returned parcel arrived at the warehouse and is being checked.');
  perform write_audit('ds_case.return_received', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'wh_return', v_ret.code));
  return jsonb_build_object('ok', true, 'code', c.code, 'wh_return_id', v_ret.id, 'wh_return_code', v_ret.code, 'warehouse', v_wh);
end $$;

-- suggested refund of a checked return (rules: see NOTES — conservative):
--  · changed mind / other: product price of the units graded good (resaleable), minus the return handling fee of the fee
--    version locked at intake (when set); processing, shipping and duties are never refunded;
--  · faulty / wrong item (Octopus's fault): product price of every returned unit, no handling fee.
create or replace function public.ds10_return_suggest(p_case uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0,
           coalesce(sum(l.qty * coalesce((select max(i.unit_product_cents) from public.store_order_items i where i.store_order_id = c.store_order_id and i.item_id = l.item_id), 0))
                      filter (where c.return_reason in ('faulty', 'wrong_item') or l.condition = 'good'), 0)
           - case when c.return_reason in ('faulty', 'wrong_item') then 0
                  else coalesce((select fv.return_handling_cents from public.store_orders so join public.fee_versions fv on fv.id = so.fee_version_id where so.id = c.store_order_id), 0) end)::bigint
    from public.dropship_cases c left join public.wh_return_lines l on l.return_id = c.wh_return_id
   where c.id = p_case
   group by c.id, c.store_order_id, c.return_reason
$$;

-- settle a checked return: the warehouse return gets the default decision (restock the good units, the rest disposed of —
-- Octopus stock, no client choice) and the refund follows (0 = closed without refund)
create or replace function public.ds10_return_settle(p_case uuid, p_refund_cents bigint, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases := public.ds10_case_for_staff(p_case);
  r public.wh_returns;
  v_dec text;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if c.kind <> 'return' or c.status <> 'received' then raise exception 'INVALID_STEP: Only a received return can be settled.'; end if;
  select * into r from public.wh_returns where id = c.wh_return_id for update;
  if r.id is null or r.status not in ('inspected', 'decided', 'done') then raise exception 'NOT_INSPECTED: The warehouse has not checked this return yet.'; end if;
  if r.status = 'inspected' then
    v_dec := case when exists (select 1 from public.wh_return_lines where return_id = r.id and condition = 'good') then 'restock' else 'discard' end;
    update public.wh_returns set status = 'decided', decision = v_dec, decision_source = 'default', decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = r.id;
    perform write_audit('wh_return.default_applied', 'wh_returns', r.id::text, jsonb_build_object('code', r.code, 'decision', v_dec, 'source', 'dropship', 'case', c.code));
  end if;
  update public.dropship_cases set suggested_refund_cents = public.ds10_return_suggest(c.id), updated_at = now() where id = c.id;
  if coalesce(p_refund_cents, 0) > 0 then
    return public.ds10_case_refund(c.id, p_refund_cents, v_msg);
  end if;
  v_msg := coalesce(v_msg, 'The return was checked; nothing is refunded under the return rules.');
  update public.dropship_cases set status = 'closed', outcome = 'none', outcome_message = left(v_msg, 600), decided_at = now(), updated_at = now() where id = c.id;
  perform public.ds10_case_step(c.id, 'closed', v_msg);
  perform public.ds10_ticket_reply(c.ticket_id, v_msg, true);
  perform write_audit('ds_case.closed', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code));
  return jsonb_build_object('ok', true, 'code', c.code, 'status', 'closed');
end $$;

-- re-weigh decision: charge (over tolerance; wallet must cover it) or absorb
create or replace function public.ds10_reweigh_decide(p_so uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  so public.store_orders;
  v jsonb;
  v_dec text := lower(btrim(coalesce(p_decision, '')));
  v_amt bigint;
  v_div uuid := division_id_of('DS');
  v_entity uuid := current_legal_entity_id(now());
  v_inv uuid;
  v_no text;
  v_j uuid;
  v_until timestamptz;
  v_id uuid;
begin
  if not public.ds10_staff_edit() then raise exception 'FORBIDDEN: Support or Dropship editors decide re-weigh charges.'; end if;
  if v_dec not in ('charge', 'absorb') then raise exception 'INVALID_INPUT: Choose charge or absorb.'; end if;
  select * into so from public.store_orders where id = p_so for update;
  if so.id is null then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.dropship_reweighs where store_order_id = so.id) then raise exception 'ALREADY_DECIDED: This parcel''s weight was already decided.'; end if;
  v := public.ds10_reweigh_calc(so.id);
  if not coalesce((v ->> 'ok')::boolean, false) then raise exception 'NOT_READY: %', v ->> 'reason'; end if;
  v_amt := (v ->> 'amount_cents')::bigint;
  if v_dec = 'charge' then
    if (v ->> 'tolerance_unknown')::boolean then raise exception 'TOLERANCE_NOT_SET: The weighing tolerance of this order''s fee version is not set, so nothing can be charged. Absorb it.'; end if;
    if not (v ->> 'over')::boolean then raise exception 'WITHIN_TOLERANCE: The parcel is within the tolerance; Octopus absorbs it.'; end if;
    perform pg_advisory_xact_lock(hashtext(acct_code('wallet:' || so.org_id, 'USD')));
    if wallet_balance(so.org_id, 'USD') < v_amt then
      raise exception 'WALLET_INSUFFICIENT: The merchant''s wallet has % and the re-weigh charge is %. Try again after a top-up.', ds_order_usd(wallet_balance(so.org_id, 'USD')), ds_order_usd(v_amt);
    end if;
    v_until := now() + make_interval(days => (v ->> 'dispute_days')::int);
    v_no := next_document_number('invoice', v_div, now(), v_entity);
    insert into public.documents (org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents, currency, status, payment_option, data)
    values (so.org_id, v_div, v_entity, 'commercial_invoice', v_no, v_amt, v_amt, 'USD', 'paid', 'pay_now',
            jsonb_build_object('service', 'dropship', 'kind', 'reweigh', 'store_order_id', so.id, 'order_number', so.order_number, 'external_order_name', so.external_order_name,
                               'title', 'Re-weigh adjustment · order ' || so.order_number, 'quoted_weight_g', v ->> 'quoted_g', 'billed_weight_g', v ->> 'billed_g',
                               'payment_option', 'wallet', 'dispute_until', v_until))
    returning id into v_inv;
    insert into public.invoice_lines (document_id, service, description, qty, unit_cents, amount_cents, ref_type, ref_id)
    values (v_inv, 'dropship', format('Shipping re-weigh · order %s · billed %s g vs %s g at payment (+%s g)', so.order_number, v ->> 'billed_g', v ->> 'quoted_g', v ->> 'diff_g'),
            1, v_amt, v_amt, 'store_order', so.id::text);
    v_j := post_journal('Dropship re-weigh · order ' || so.order_number || ' · ' || v_no || ' · paid from wallet',
      jsonb_build_array(
        jsonb_build_object('account', wallet_account(so.org_id, 'USD'), 'debit', v_amt, 'credit', 0, 'org', so.org_id),
        jsonb_build_object('account', revenue_account('dropship', 'USD'), 'debit', 0, 'credit', v_amt)),
      'ds10-reweigh:' || so.id::text, 'dropship', 'store_order', so.id);
    update public.journals set division_id = v_div where id = v_j;
    update public.ledger_entries set division_id = v_div where journal_id = v_j;
  end if;
  insert into public.dropship_reweighs (store_order_id, org_id, wh_order_id, quoted_weight_g, measured_weight_g, billed_weight_g, tolerance_g, amount_cents,
                                        decision, invoice_id, charge_journal_id, photo_path, dispute_until)
  values (so.id, so.org_id, (v ->> 'wh_order_id')::uuid, (v ->> 'quoted_g')::int, (v ->> 'actual_g')::int, (v ->> 'billed_g')::int, (v ->> 'tolerance_g')::int,
          case when v_dec = 'charge' then v_amt else greatest(v_amt, 0) end, case when v_dec = 'charge' then 'charged' else 'absorbed' end, v_inv, v_j, v ->> 'photo_path', v_until)
  returning id into v_id;
  update public.store_orders set actual_pack_weight_g = (v ->> 'actual_g')::int, updated_at = now() where id = so.id;
  if v_dec = 'charge' then
    perform public.ds10_notify(so.org_id, 'Re-weigh on order ' || coalesce(so.external_order_name, so.order_number) || ': +' || ds_order_usd(v_amt),
      format('The parcel weighed more than the product data (%s g billed vs %s g). You can dispute this until %s.', v ->> 'billed_g', v ->> 'quoted_g', to_char(v_until at time zone 'UTC', 'DD Mon YYYY')),
      '/account/dropship/orders/' || so.id::text);
  end if;
  perform write_audit('ds_reweigh.' || case when v_dec = 'charge' then 'charged' else 'absorbed' end, 'dropship_reweighs', v_id::text,
    jsonb_build_object('org_id', so.org_id, 'store_order_id', so.id, 'amount_cents', v_amt, 'invoice', v_no, 'journal_id', v_j));
  return jsonb_build_object('ok', true, 'id', v_id, 'decision', v_dec, 'amount_cents', v_amt, 'invoice_number', v_no);
end $$;

-- re-weigh dispute outcome: refund the difference (CN-DS + revenue → wallet) or reject with the reason
create or replace function public.ds10_reweigh_dispute_decide(p_reweigh uuid, p_refund boolean, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.dropship_reweighs;
  so public.store_orders;
  v_ans text := btrim(coalesce(p_answer, ''));
  v_j uuid;
  v_cn uuid;
  v_div uuid := division_id_of('DS');
begin
  if not public.ds10_staff_edit() then raise exception 'FORBIDDEN: Support or Dropship editors decide re-weigh disputes.'; end if;
  if length(v_ans) < 5 or length(v_ans) > 600 then raise exception 'INVALID_INPUT: Write the answer for the merchant (5 to 600 characters).'; end if;
  select * into r from public.dropship_reweighs where id = p_reweigh for update;
  if r.id is null or r.dispute_state is distinct from 'open' then raise exception 'NOT_OPEN: This dispute is not open.'; end if;
  select * into so from public.store_orders where id = r.store_order_id;
  if p_refund then
    if r.amount_cents > public.ds10_approval_limit_cents() then raise exception 'NEEDS_FINANCE: Refunds above US$1,000 go through Finance.'; end if;
    v_j := post_journal('Dropship re-weigh refund · order ' || so.order_number,
      jsonb_build_array(
        jsonb_build_object('account', revenue_account('dropship', 'USD'), 'debit', r.amount_cents, 'credit', 0),
        jsonb_build_object('account', wallet_account(r.org_id, 'USD'), 'debit', 0, 'credit', r.amount_cents, 'org', r.org_id)),
      'ds10-reweigh-refund:' || r.id::text, 'refunds', 'store_order', so.id);
    update public.journals set division_id = v_div where id = v_j;
    update public.ledger_entries set division_id = v_div where journal_id = v_j;
    v_cn := public.ds10_credit_note(so.id, r.invoice_id, r.amount_cents, 'Re-weigh dispute accepted', 'wallet', 'reweigh');
    update public.dropship_reweighs set dispute_state = 'refunded', refund_cents = amount_cents, credit_document_id = v_cn, refund_journal_id = v_j,
           dispute_answer = v_ans, dispute_decided_at = now(), updated_at = now() where id = r.id;
    perform public.ds_order_event(so.id, so.org_id, 'refunded', 'Re-weigh refunded to your wallet', v_ans, r.amount_cents);
  else
    update public.dropship_reweighs set dispute_state = 'rejected', dispute_answer = v_ans, dispute_decided_at = now(), updated_at = now() where id = r.id;
  end if;
  perform public.ds10_notify(r.org_id, 'Re-weigh dispute on order ' || coalesce(so.external_order_name, so.order_number) || ': ' || case when p_refund then 'refunded' else 'not accepted' end,
    v_ans, '/account/dropship/orders/' || so.id::text);
  perform write_audit('ds_reweigh.dispute_' || case when p_refund then 'refunded' else 'rejected' end, 'dropship_reweighs', r.id::text,
    jsonb_build_object('org_id', r.org_id, 'store_order_id', so.id, 'journal_id', v_j, 'credit_note_id', v_cn));
  return jsonb_build_object('ok', true, 'state', case when p_refund then 'refunded' else 'rejected' end,
    'credit_note', (select number from public.documents where id = v_cn));
end $$;

-- support desk panel: the Dropship order and cases behind a ticket
create or replace function public.ds10_ticket_context(p_ticket uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare t public.tickets;
begin
  if not (can('support', 'view') or public.ds10_staff_view()) then raise exception 'FORBIDDEN'; end if;
  select * into t from public.tickets where id = p_ticket;
  if t.id is null or t.store_order_id is null then return null; end if;
  return (select jsonb_build_object('store_order_id', so.id, 'order_number', so.order_number, 'external_order_name', so.external_order_name,
            'merchant_status', so.merchant_status, 'payment_state', so.payment_state, 'total_cents', so.total_cents,
            'cases', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'kind', c.kind, 'status', c.status) order by c.created_at)
                                 from public.dropship_cases c where c.store_order_id = so.id), '[]'::jsonb))
            from public.store_orders so where so.id = t.store_order_id);
end $$;

-- ───────────────────────── 11. Triggers ─────────────────────────
-- Finance approval of a DS10 refund decided (in Order problems or in Admin › Finance): run it, or put the case back
create or replace function public.ds10_finance_approval_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.dropship_cases;
  v jsonb;
  v_prev text;
begin
  select * into c from public.dropship_cases where finance_approval_id = new.id for update;
  if c.id is null or c.status <> 'awaiting_approval' then return new; end if;
  if new.approved_by is null or new.approved_by = new.requested_by then raise exception 'MAKER_CANNOT_APPROVE'; end if;
  if new.status = 'approved' then
    v := public.ds10_refund_execute(c.id);
    update public.finance_approvals set status = 'executed', executed_journal_id = (select refund_journal_id from public.dropship_cases where id = c.id) where id = new.id;
  else
    v_prev := case when c.kind = 'return' then 'received' when c.carrier_claim_ref is not null then 'carrier_claim' else 'reported' end;
    update public.dropship_cases set status = v_prev, refund_cents = null, finance_approval_id = null, updated_at = now() where id = c.id;
    perform public.ds10_case_step(c.id, 'approval_rejected', 'The proposed refund was not approved by Finance; Octopus support decides again.');
    perform write_audit('ds_case.refund_rejected', 'dropship_cases', c.id::text, jsonb_build_object('org_id', c.org_id, 'code', c.code, 'finance_approval_id', new.id));
  end if;
  return new;
end $$;

drop trigger if exists trg_ds10_finance_approval_sync on public.finance_approvals;
create trigger trg_ds10_finance_approval_sync
  after update of status on public.finance_approvals
  for each row when (old.status = 'requested' and new.status in ('approved', 'rejected'))
  execute function public.ds10_finance_approval_sync();

-- a Warehouse OS return of a Dropship order: Octopus stock — no 3PL client charge, no client decision, no send back
create or replace function public.ds10_is_dropship_return(p_return uuid, p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wh_orders w where w.id = p_order and w.source = 'dropship')
      or exists (select 1 from public.dropship_cases c where c.wh_return_id = p_return)
$$;

create or replace function public.ds10_wh_return_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ds10_is_dropship_return(new.id, new.order_id) then return new; end if;
  new.charge_units := null;
  new.charge_per_item_cents := null;
  new.charge_cents := null;
  if new.decision_source = 'client' then raise exception 'DROPSHIP_RETURN: Octopus decides returns of Dropship orders.'; end if;
  if new.decision = 'send_back' then raise exception 'DROPSHIP_RETURN: Dropship returns are restocked or disposed of, not sent back.'; end if;
  return new;
end $$;

drop trigger if exists trg_ds10_wh_return_guard on public.wh_returns;
create trigger trg_ds10_wh_return_guard
  before insert or update on public.wh_returns
  for each row execute function public.ds10_wh_return_guard();

-- restocked units of a Dropship return are Octopus stock (lot owner NULL, like every Dropship lot)
create or replace function public.ds10_wh_return_lot_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.wh_returns r where r.id = new.return_id and public.ds10_is_dropship_return(r.id, r.order_id)) then
    update public.wh_lots set org_id = null, updated_at = now() where id = new.lot_id and org_id is not null;
  end if;
  return new;
end $$;

drop trigger if exists trg_ds10_wh_return_lot_owner on public.wh_return_lines;
create trigger trg_ds10_wh_return_lot_owner
  after update of lot_id on public.wh_return_lines
  for each row when (new.lot_id is not null and new.lot_id is distinct from old.lot_id)
  execute function public.ds10_wh_return_lot_owner();

-- ───────────────────────── 12. Function grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'ds10_staff_view()', 'ds10_staff_edit()', 'ds10_setting_int(text, integer, integer, integer)', 'ds10_approval_limit_cents()',
    'ds10_handed_over(uuid)', 'ds10_label_created(uuid)', 'ds10_delivered_at(uuid)', 'ds10_case_step(uuid, text, text)',
    'ds10_notify(uuid, text, text, text)', 'ds10_ticket_open(uuid, uuid, text, text, text, jsonb)', 'ds10_ticket_reply(uuid, text, boolean)',
    'ds10_open_hold(uuid)', 'ds10_refund_cap(uuid)', 'ds10_case_json(public.dropship_cases, boolean)',
    'ds10_credit_note(uuid, uuid, bigint, text, text, text)', 'ds10_claim_photo_can_upload(text)', 'ds10_claim_photo_can_read(text)',
    'ds10_reweigh_photo_can_read(text)', 'ds10_refund_execute(uuid)', 'ds10_release_hold(uuid, text)', 'ds10_reship_create(uuid, jsonb)',
    'ds10_reweigh_calc(uuid)', 'ds10_order_detail(uuid)', 'ds10_claim_open(uuid, text, text, text, text[])',
    'ds10_return_open(uuid, text, text, text, jsonb)', 'ds10_reweigh_dispute(uuid, text)', 'ds10_order_address(uuid, jsonb)',
    'ds10_support_page()', 'ds10_ticket_create(text, text, text, text, jsonb)', 'ds10_staff_board()', 'ds10_case_for_staff(uuid)',
    'ds10_case_carrier(uuid, text)', 'ds10_case_reship(uuid, text, jsonb)', 'ds10_case_refund(uuid, bigint, text)',
    'ds10_refund_approve(uuid, boolean, text)', 'ds10_case_reject(uuid, text)', 'ds10_return_receive(uuid, text)', 'ds10_return_suggest(uuid)',
    'ds10_return_settle(uuid, bigint, text)', 'ds10_reweigh_decide(uuid, text)', 'ds10_reweigh_dispute_decide(uuid, boolean, text)',
    'ds10_ticket_context(uuid)', 'ds10_finance_approval_sync()', 'ds10_is_dropship_return(uuid, uuid)', 'ds10_wh_return_guard()',
    'ds10_wh_return_lot_owner()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- signed-in users: merchant RPCs (own org found by the RPC), staff RPCs (each checks the person), storage policy helpers
  foreach f in array array[
    'ds10_order_detail(uuid)', 'ds10_claim_open(uuid, text, text, text, text[])', 'ds10_return_open(uuid, text, text, text, jsonb)',
    'ds10_reweigh_dispute(uuid, text)', 'ds10_order_address(uuid, jsonb)', 'ds10_support_page()', 'ds10_ticket_create(text, text, text, text, jsonb)',
    'ds10_staff_board()', 'ds10_case_carrier(uuid, text)', 'ds10_case_reship(uuid, text, jsonb)', 'ds10_case_refund(uuid, bigint, text)',
    'ds10_refund_approve(uuid, boolean, text)', 'ds10_case_reject(uuid, text)', 'ds10_return_receive(uuid, text)',
    'ds10_return_settle(uuid, bigint, text)', 'ds10_reweigh_decide(uuid, text)', 'ds10_reweigh_dispute_decide(uuid, boolean, text)',
    'ds10_ticket_context(uuid)', 'ds10_claim_photo_can_upload(text)', 'ds10_claim_photo_can_read(text)', 'ds10_reweigh_photo_can_read(text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────────────────── 13. REPLACED: ds_order_address_core (DS8) — address can change until the label exists ─────────────────────────
-- Installed text (pg_get_functiondef) with three edits: the stage check is ds10_label_created() instead of
-- ds_order_packing_started(), the problem texts say "label", and a picked / packing / packed warehouse order without a label
-- gets the new address too. Grants are kept by CREATE OR REPLACE. The down restores the installed text exactly.
CREATE OR REPLACE FUNCTION public.ds_order_address_core(p_so uuid, p_address jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  so public.store_orders;
  x public.dropship_order_intake;
  v_problem text;
  v_addr jsonb;
  v_pay jsonb;
begin
  select * into so from public.store_orders where id = p_so for update;
  if so.id is null then raise exception 'NOT_FOUND: This order was not found.'; end if;
  if so.cancelled_at is not null then raise exception 'ORDER_CANCELLED: This order is cancelled.'; end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then raise exception 'INVALID_INPUT: Enter the delivery address.'; end if;
  v_addr := jsonb_strip_nulls(jsonb_build_object(
    'name', nullif(btrim(coalesce(p_address ->> 'name', '')), ''), 'phone', nullif(btrim(coalesce(p_address ->> 'phone', '')), ''),
    'line1', nullif(btrim(coalesce(p_address ->> 'line1', '')), ''), 'line2', nullif(btrim(coalesce(p_address ->> 'line2', '')), ''),
    'city', nullif(btrim(coalesce(p_address ->> 'city', '')), ''), 'region', nullif(btrim(coalesce(p_address ->> 'region', '')), ''),
    'postcode', nullif(upper(btrim(coalesce(p_address ->> 'postcode', ''))), ''),
    'country', upper(coalesce(nullif(btrim(p_address ->> 'country'), ''), so.destination_country))));
  if v_addr ->> 'country' <> so.destination_country then
    raise exception 'COUNTRY_CHANGE: A different country changes the shipping price. Cancel this order and send it again instead.';
  end if;
  select * into x from public.dropship_order_intake where store_order_id = so.id for update;
  if x.store_order_id is null then
    insert into public.dropship_order_intake (store_order_id, org_id, channel) values (so.id, so.org_id, so.channel) returning * into x;
  end if;

  -- DS10 (Step 10): the address can change until the shipping label exists (it is printed on the label); after that → problem flow
  if public.ds10_label_created(so.id) then
    update public.dropship_order_intake
       set problem_code = 'address_after_packing', problem_detail = jsonb_build_object('address', v_addr, 'requested_at', now(), 'source', p_source), updated_at = now()
     where store_order_id = so.id;
    perform public.ds_order_event(so.id, so.org_id, 'address_problem', 'Address change after the label was printed',
      'The shipping label is already printed, so the address was not changed. Octopus support checks whether the parcel can still be redirected and replies in Support.');
    perform write_audit('ds_order.address_problem', 'store_orders', so.id::text, jsonb_build_object('org_id', so.org_id, 'source', p_source));
    return jsonb_build_object('ok', true, 'applied', false, 'problem', true, 'store_order_id', so.id,
      'message', 'The shipping label is already printed, so the address was not changed. Octopus support will reply in Support.');
  end if;

  v_problem := public.ds_order_address_problem(v_addr, so.destination_country);
  if v_problem is not null then
    raise exception 'ADDRESS_INVALID: %', v_problem;
  end if;
  update public.store_orders
     set shipping_address = v_addr, buyer_name = coalesce(v_addr ->> 'name', buyer_name), buyer_phone = coalesce(v_addr ->> 'phone', buyer_phone), updated_at = now()
   where id = so.id;
  update public.wh_orders
     set ship_address = v_addr, ship_name = left(coalesce(v_addr ->> 'name', ship_name), 120), ship_phone = left(coalesce(v_addr ->> 'phone', ship_phone), 40), updated_at = now()
   where store_order_id = so.id and status in ('new', 'allocated', 'picking', 'picked', 'packing', 'packed');
  update public.dropship_order_intake set address_ok = true, address_issue = null, updated_at = now() where store_order_id = so.id;
  perform public.ds_order_event(so.id, so.org_id, 'address_updated', 'Delivery address updated', null);
  if x.hold_code = 'address' then
    perform public.ds_order_set_hold(so.id, null, 'Address fixed and resubmitted.');
    if so.payment_state = 'unpaid' then v_pay := public.ds_order_try_auto(so.id); end if;
  end if;
  perform write_audit('ds_order.address_updated', 'store_orders', so.id::text, jsonb_build_object('org_id', so.org_id, 'source', p_source));
  return jsonb_build_object('ok', true, 'applied', true, 'store_order_id', so.id, 'payment', v_pay);
end $function$;
