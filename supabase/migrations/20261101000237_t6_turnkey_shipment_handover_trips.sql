-- 20261101000237_t6_turnkey_shipment_handover_trips.sql   (renumber at install)
-- Turnkey T6 (docs/design/turnkey-v2: "7. Shipment: booking, tracking and shipping documents"; "8. Handover: final
-- documents, sign-off and optional China visit"; services "Visit China with us — from $399 per day, up to 2 people;
-- extra traveller $99 per day" and the trip extras "Visa invitation letter $49, Car and driver $100 per day, Airport
-- pick-up $39, Hotel help free"; ChinaVisit (client trip request) and TripManager (staff itinerary, costs, guide, trip
-- report); Legal "secure passport upload"; Documents "drawings, reports and shipping papers"; supplier details hidden).
--  1. Balance: after the accepted quote's deposit is paid, Turnkey editors issue the balance (quote total − deposit) as a
--     proforma through T4's tk_issue_project_proforma (service 'turnkey' → TK division; paid with pay_service_proforma:
--     wallet or a bank transfer recorded by Finance). tk_move_project_stage refuses to start Shipment until the balance is
--     fully paid (T3–T5 gates unchanged), and refuses to leave Shipment until every shipment (at least one) is delivered.
--  2. Shipment: shipments per project (sea / air / express, carrier, booking reference, container, tracking number,
--     origin / destination, ETD / ETA), tracking events added by staff (status moves forward only), and shipping documents
--     (bill of lading, packing list, commercial invoice, certificate of origin, insurance, customs) in the PRIVATE bucket
--     turnkey-documents. Documents start as drafts; the client sees released ones only (short signed URLs). Carrier names
--     are shown to the client (B2B tracking); text the client sees that names a factory of the project is refused.
--  3. Trips (Visit China): the client requests a trip (dates, travellers, visa letters, car-and-driver days, airport
--     pick-ups, hotel help); the list price is computed from tk_services and frozen on the trip (per day for up to 2
--     people, each extra traveller per day, the extras). Staff set the exact fee under the SetFee rule (D5: up to 2x the
--     trip's list price it is active at once; above 2x one admin who is not the proposer approves it) in tk_trip_fees;
--     the client pays its proforma; then staff confirm the itinerary. Passport copies go to the PRIVATE bucket
--     turnkey-passports, uploaded by the client; only the client company's (non-staff) members and Turnkey staff with a
--     need (Turnkey editors of the TK division on 2FA, or the project's account manager on 2FA) can read them; they can be
--     deleted on request (tk_delete_trip_passport) and are purged after the trip (tk_purge_trip_passports, service role).
--  4. Handover: a final-documents checklist (staff), final documents (same private bucket, released to the client), and
--     the client's sign-off (typed name + time). Signing completes the project (T2 rule: completed only at Handover);
--     tk_set_project_status no longer completes a project by itself and a completed project cannot be reopened. After
--     sign-off only admins may still add, release or withdraw documents.
--  5. Demo wipe (staging only): demo / test companies' Turnkey projects are deleted BEFORE their documents (proformas),
--     so the T3–T6 rows that point at documents never block the wipe.
-- Every write goes through a security definer function (search_path = public; not for anon); every change is audited.
-- Down: supabase/migrations/down/20261101000237_t6_turnkey_shipment_handover_trips.down.sql

-- ───────── 0. history kinds; trip prices on tk_services ─────────
alter table public.tk_client_project_events drop constraint if exists tk_client_project_events_kind_check;
alter table public.tk_client_project_events add constraint tk_client_project_events_kind_check
  check (kind in ('created', 'migrated', 'stage_forward', 'stage_back', 'status', 'due_date', 'fee', 'manager', 'drawing', 'quote', 'inspection',
                  'balance', 'shipment', 'trip', 'handover'));

-- Visit China: "Up to 2 people; extra traveller $99 per day" as data (the trip price is computed from tk_services)
alter table public.tk_services add column if not exists included_travellers smallint;
alter table public.tk_services add column if not exists extra_traveller_day_cents bigint;
alter table public.tk_services drop constraint if exists tk_services_travellers_check;
alter table public.tk_services add constraint tk_services_travellers_check
  check ((included_travellers is null or included_travellers between 1 and 20) and (extra_traveller_day_cents is null or extra_traveller_day_cents >= 0));
update public.tk_services set included_travellers = 2, extra_traveller_day_cents = 9900
 where code = 'visit_china' and included_travellers is null and extra_traveller_day_cents is null;
grant select (included_travellers, extra_traveller_day_cents) on public.tk_services to anon, authenticated;

-- ───────── 1. balance of the accepted quote ─────────
create table if not exists public.tk_quote_balances (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  quote_id uuid not null unique references public.tk_client_quotes(id) on delete cascade,
  total_cents bigint not null check (total_cents > 0),
  deposit_cents bigint not null check (deposit_cents > 0),
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  document_id uuid not null references public.documents(id) on delete restrict,
  issued_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tk_quote_balances_amount check (amount_cents = total_cents - deposit_cents)
);
create unique index if not exists tk_quote_balances_project_idx on public.tk_quote_balances (project_id);
create index if not exists tk_quote_balances_document_idx on public.tk_quote_balances (document_id);
create index if not exists tk_quote_balances_issued_by_idx on public.tk_quote_balances (issued_by);
comment on table public.tk_quote_balances is 'Turnkey T6: the balance invoice of the accepted client quote (total − deposit), one per project. Shipment starts after it is fully paid. Who issued it is staff-only (tk_staff_shipping).';
alter table public.tk_quote_balances enable row level security;
revoke all on public.tk_quote_balances from public, anon, authenticated;
grant select (id, project_id, quote_id, total_cents, deposit_cents, amount_cents, currency, document_id, created_at) on public.tk_quote_balances to authenticated;
grant all on public.tk_quote_balances to service_role;
drop policy if exists tk_quote_balances_read on public.tk_quote_balances;
create policy tk_quote_balances_read on public.tk_quote_balances for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

-- ───────── 2. shipments, tracking events, documents ─────────
create table if not exists public.tk_shipments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  seq smallint not null check (seq between 1 and 50),
  mode text not null check (mode in ('sea', 'air', 'express')),
  carrier text not null check (btrim(carrier) <> '' and length(carrier) <= 120),
  booking_ref text check (booking_ref is null or (btrim(booking_ref) <> '' and length(booking_ref) <= 80)),
  container_no text check (container_no is null or container_no ~ '^[A-Z0-9][A-Z0-9 -]{2,23}$'),
  tracking_no text check (tracking_no is null or (btrim(tracking_no) <> '' and length(tracking_no) <= 80)),
  origin text check (origin is null or (btrim(origin) <> '' and length(origin) <= 120)),
  destination text check (destination is null or (btrim(destination) <> '' and length(destination) <= 120)),
  etd date,
  eta date,
  status text not null default 'booked' check (status in ('booked', 'in_transit', 'arrived', 'delivered', 'cancelled')),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  staff_note text check (staff_note is null or length(staff_note) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tk_shipments_dates check (etd is null or eta is null or eta >= etd),
  constraint tk_shipments_delivered check ((status = 'delivered') = (delivered_at is not null)),
  constraint tk_shipments_cancelled check ((status = 'cancelled') = (cancelled_at is not null and nullif(btrim(coalesce(cancel_reason, '')), '') is not null))
);
create unique index if not exists tk_shipments_seq_idx on public.tk_shipments (project_id, seq);
create index if not exists tk_shipments_created_by_idx on public.tk_shipments (created_by);
comment on table public.tk_shipments is 'Turnkey T6: shipments of a client project (mode, carrier, booking, container, tracking, ETD / ETA, status). Customers read the tracking columns of shipments that are not cancelled; the staff note, cancel reason and creator are staff-only (tk_staff_shipping).';
alter table public.tk_shipments enable row level security;
revoke all on public.tk_shipments from public, anon, authenticated;
grant select (id, project_id, seq, mode, carrier, booking_ref, container_no, tracking_no, origin, destination, etd, eta, status, delivered_at, created_at, updated_at)
  on public.tk_shipments to authenticated;
grant all on public.tk_shipments to service_role;
drop policy if exists tk_shipments_read on public.tk_shipments;
create policy tk_shipments_read on public.tk_shipments for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id) and (status <> 'cancelled' or public.tk_staff_can_view(project_id)));

create table if not exists public.tk_shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.tk_shipments(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  happened_at timestamptz not null,
  status_to text check (status_to is null or status_to in ('booked', 'in_transit', 'arrived', 'delivered')),
  location text check (location is null or (btrim(location) <> '' and length(location) <= 120)),
  description text not null check (btrim(description) <> '' and length(description) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists tk_shipment_events_shipment_idx on public.tk_shipment_events (shipment_id, happened_at);
create index if not exists tk_shipment_events_project_idx on public.tk_shipment_events (project_id);
create index if not exists tk_shipment_events_created_by_idx on public.tk_shipment_events (created_by);
comment on table public.tk_shipment_events is 'Turnkey T6: tracking events of a shipment, added by staff (never rewritten). Customers read them for shipments they can see; the author is staff-only.';
alter table public.tk_shipment_events enable row level security;
revoke all on public.tk_shipment_events from public, anon, authenticated;
grant select (id, shipment_id, project_id, happened_at, status_to, location, description, created_at) on public.tk_shipment_events to authenticated;
grant all on public.tk_shipment_events to service_role;
drop policy if exists tk_shipment_events_read on public.tk_shipment_events;
create policy tk_shipment_events_read on public.tk_shipment_events for select to authenticated
  using (exists (select 1 from public.tk_shipments s where s.id = shipment_id));

create table if not exists public.tk_project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  section text not null check (section in ('shipment', 'handover')),
  shipment_id uuid references public.tk_shipments(id) on delete cascade,
  kind text not null check (kind in ('bill_of_lading', 'packing_list', 'commercial_invoice', 'certificate_of_origin', 'insurance', 'customs',
                                     'warranty', 'manual', 'as_built_drawing', 'certificate', 'final_invoice', 'training', 'other')),
  title text not null check (btrim(title) <> '' and length(title) <= 160),
  file_path text not null unique check (length(file_path) between 3 and 400),
  file_name text not null check (btrim(file_name) <> '' and length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  status text not null default 'draft' check (status in ('draft', 'released', 'withdrawn')),
  released_at timestamptz,
  withdrawn_at timestamptz,
  withdraw_reason text check (withdraw_reason is null or length(withdraw_reason) <= 500),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tk_project_documents_path check (split_part(file_path, '/', 1) = project_id::text),
  constraint tk_project_documents_section_kind check (kind = 'other'
    or (section = 'shipment' and kind in ('bill_of_lading', 'packing_list', 'commercial_invoice', 'certificate_of_origin', 'insurance', 'customs'))
    or (section = 'handover' and kind in ('warranty', 'manual', 'as_built_drawing', 'certificate', 'final_invoice', 'training'))),
  constraint tk_project_documents_shipment check ((section = 'shipment') = (shipment_id is not null)),
  constraint tk_project_documents_released check ((status = 'draft') = (released_at is null)),
  constraint tk_project_documents_withdrawn check ((status = 'withdrawn') = (withdrawn_at is not null and nullif(btrim(coalesce(withdraw_reason, '')), '') is not null))
);
create index if not exists tk_project_documents_project_idx on public.tk_project_documents (project_id, section, created_at);
create index if not exists tk_project_documents_shipment_idx on public.tk_project_documents (shipment_id);
create index if not exists tk_project_documents_uploaded_by_idx on public.tk_project_documents (uploaded_by);
comment on table public.tk_project_documents is 'Turnkey T6: shipping documents (per shipment) and final handover documents, files in the private turnkey-documents bucket. Drafts and withdrawn documents are staff-only; customers read released ones (short signed URLs). The uploader and the withdraw reason are staff-only.';
alter table public.tk_project_documents enable row level security;
revoke all on public.tk_project_documents from public, anon, authenticated;
grant select (id, project_id, section, shipment_id, kind, title, file_path, file_name, mime_type, size_bytes, status, released_at, created_at)
  on public.tk_project_documents to authenticated;
grant all on public.tk_project_documents to service_role;
drop policy if exists tk_project_documents_read on public.tk_project_documents;
create policy tk_project_documents_read on public.tk_project_documents for select to authenticated
  using (public.tk_staff_can_view(project_id)
         or (status = 'released' and exists (select 1 from public.tk_client_projects p where p.id = project_id)
             and (shipment_id is null or exists (select 1 from public.tk_shipments s where s.id = shipment_id))));

-- ───────── 3. handover: checklist and sign-off ─────────
create table if not exists public.tk_handover_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  position smallint not null check (position between 1 and 50),
  label text not null check (btrim(label) <> '' and length(label) <= 200),
  document_id uuid references public.tk_project_documents(id),
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tk_handover_items_done check ((done_at is null) = (done_by is null)),
  constraint tk_handover_items_document_done check (document_id is null or done_at is not null)
);
create unique index if not exists tk_handover_items_position_idx on public.tk_handover_items (project_id, position);
create index if not exists tk_handover_items_document_idx on public.tk_handover_items (document_id);
create index if not exists tk_handover_items_done_by_idx on public.tk_handover_items (done_by);
create index if not exists tk_handover_items_created_by_idx on public.tk_handover_items (created_by);
comment on table public.tk_handover_items is 'Turnkey T6: the final-documents checklist of a project (staff tick each line, optionally with a released final document). The client signs the handover when every line is done. Who ticked it is staff-only.';
alter table public.tk_handover_items enable row level security;
revoke all on public.tk_handover_items from public, anon, authenticated;
grant select (id, project_id, position, label, document_id, done_at, created_at) on public.tk_handover_items to authenticated;
grant all on public.tk_handover_items to service_role;
drop policy if exists tk_handover_items_read on public.tk_handover_items;
create policy tk_handover_items_read on public.tk_handover_items for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

create table if not exists public.tk_handover_signoffs (
  project_id uuid primary key references public.tk_client_projects(id) on delete cascade,
  signed_name text not null check (length(btrim(signed_name)) between 2 and 120),
  client_comment text check (client_comment is null or length(client_comment) <= 1000),
  items_count smallint not null check (items_count >= 1),
  signed_by uuid references auth.users(id) on delete set null,
  signed_at timestamptz not null default now()
);
create index if not exists tk_handover_signoffs_signed_by_idx on public.tk_handover_signoffs (signed_by);
comment on table public.tk_handover_signoffs is 'Turnkey T6: the client''s handover sign-off (typed full name and time). Signing completes the project. The signing account is staff-only (audit_log has it too).';
alter table public.tk_handover_signoffs enable row level security;
revoke all on public.tk_handover_signoffs from public, anon, authenticated;
grant select (project_id, signed_name, client_comment, items_count, signed_at) on public.tk_handover_signoffs to authenticated;
grant all on public.tk_handover_signoffs to service_role;
drop policy if exists tk_handover_signoffs_read on public.tk_handover_signoffs;
create policy tk_handover_signoffs_read on public.tk_handover_signoffs for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

-- ───────── 4. trips (Visit China), their fees and passport copies ─────────
create table if not exists public.tk_trips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  seq smallint not null check (seq between 1 and 20),
  start_on date not null,
  end_on date not null,
  days smallint not null check (days between 1 and 30),
  travellers smallint not null check (travellers between 1 and 20),
  visa_letters smallint not null default 0 check (visa_letters >= 0),
  car_days smallint not null default 0 check (car_days >= 0),
  airport_pickups smallint not null default 0 check (airport_pickups between 0 and 10),
  hotel_help boolean not null default false,
  client_message text check (client_message is null or length(client_message) <= 2000),
  -- prices frozen from tk_services when the client asked (integer cents)
  day_cents bigint not null check (day_cents > 0),
  included_travellers smallint not null check (included_travellers between 1 and 20),
  extra_traveller_day_cents bigint not null check (extra_traveller_day_cents >= 0),
  visa_letter_cents bigint not null check (visa_letter_cents >= 0),
  car_day_cents bigint not null check (car_day_cents >= 0),
  airport_pickup_cents bigint not null check (airport_pickup_cents >= 0),
  hotel_help_cents bigint not null check (hotel_help_cents >= 0),
  list_cents bigint not null check (list_cents > 0 and list_cents <= 100000000),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'completed', 'cancelled')),
  itinerary text check (itinerary is null or length(itinerary) <= 4000),
  trip_report text check (trip_report is null or length(trip_report) <= 4000),
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  guide_name text check (guide_name is null or length(guide_name) <= 120),
  staff_notes text check (staff_notes is null or length(staff_notes) <= 4000),
  requested_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tk_trips_days_match check (days = end_on - start_on + 1),
  constraint tk_trips_extras check (visa_letters <= travellers and car_days <= days),
  constraint tk_trips_price check (list_cents = days * day_cents + days * greatest(travellers - included_travellers, 0) * extra_traveller_day_cents
                                               + visa_letters * visa_letter_cents + car_days * car_day_cents + airport_pickups * airport_pickup_cents
                                               + case when hotel_help then hotel_help_cents else 0 end),
  constraint tk_trips_confirmed check (status not in ('confirmed', 'completed') or (confirmed_at is not null and confirmed_by is not null and nullif(btrim(coalesce(itinerary, '')), '') is not null)),
  constraint tk_trips_completed check ((status = 'completed') = (completed_at is not null)),
  constraint tk_trips_cancelled check ((status = 'cancelled') = (cancelled_at is not null and nullif(btrim(coalesce(cancel_reason, '')), '') is not null))
);
create unique index if not exists tk_trips_seq_idx on public.tk_trips (project_id, seq);
create unique index if not exists tk_trips_one_open_idx on public.tk_trips (project_id) where status in ('requested', 'confirmed');
create index if not exists tk_trips_requested_by_idx on public.tk_trips (requested_by);
create index if not exists tk_trips_confirmed_by_idx on public.tk_trips (confirmed_by);
comment on table public.tk_trips is 'Turnkey T6: Visit China trips of a client project (dates, travellers, extras, the list price frozen from tk_services, itinerary, trip report). The guide, staff notes and who confirmed are staff-only (tk_staff_trips).';
alter table public.tk_trips enable row level security;
revoke all on public.tk_trips from public, anon, authenticated;
grant select (id, project_id, seq, start_on, end_on, days, travellers, visa_letters, car_days, airport_pickups, hotel_help, client_message, day_cents,
              included_travellers, extra_traveller_day_cents, visa_letter_cents, car_day_cents, airport_pickup_cents, hotel_help_cents, list_cents, status,
              itinerary, trip_report, confirmed_at, completed_at, cancelled_at, cancel_reason, created_at, updated_at)
  on public.tk_trips to authenticated;
grant all on public.tk_trips to service_role;
drop policy if exists tk_trips_read on public.tk_trips;
create policy tk_trips_read on public.tk_trips for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id));

-- the fee of one trip (versions; the design's 2x rule against the trip's list price; one admin, not the proposer, above 2x)
create table if not exists public.tk_trip_fees (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.tk_trips(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  version integer not null check (version >= 1),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  starting_cents bigint not null check (starting_cents > 0),
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
  constraint tk_trip_fees_rule check (needs_approval = (amount_cents > 2 * starting_cents)),
  constraint tk_trip_fees_two_person check (approved_by is null or approved_by <> proposed_by),
  constraint tk_trip_fees_approval_time check ((approved_by is null) = (approved_at is null)),
  constraint tk_trip_fees_auto_no_approver check (needs_approval or (approved_by is null and rejected_by is null and status not in ('pending_approval', 'rejected'))),
  constraint tk_trip_fees_active_ok check (status not in ('active', 'superseded') or (effective_from is not null and document_id is not null and (not needs_approval or approved_by is not null))),
  constraint tk_trip_fees_pending_not_final check (status <> 'pending_approval' or (approved_by is null and rejected_by is null and document_id is null)),
  constraint tk_trip_fees_rejected_reason check (status <> 'rejected' or (rejected_by is not null and rejected_at is not null and approved_by is null and nullif(btrim(coalesce(reject_reason, '')), '') is not null))
);
create unique index if not exists tk_trip_fees_version_idx on public.tk_trip_fees (trip_id, version);
create unique index if not exists tk_trip_fees_one_active_idx on public.tk_trip_fees (trip_id) where status = 'active';
create unique index if not exists tk_trip_fees_one_pending_idx on public.tk_trip_fees (trip_id) where status = 'pending_approval';
create index if not exists tk_trip_fees_pending_idx on public.tk_trip_fees (proposed_at) where status = 'pending_approval';
create index if not exists tk_trip_fees_project_idx on public.tk_trip_fees (project_id);
create index if not exists tk_trip_fees_document_idx on public.tk_trip_fees (document_id);
create index if not exists tk_trip_fees_proposed_by_idx on public.tk_trip_fees (proposed_by);
create index if not exists tk_trip_fees_approved_by_idx on public.tk_trip_fees (approved_by);
create index if not exists tk_trip_fees_rejected_by_idx on public.tk_trip_fees (rejected_by);
comment on table public.tk_trip_fees is 'Turnkey T6: the fee of one trip (versions). Up to 2x the trip''s list price (from tk_services) it is active at once; above 2x one admin who is not the proposer approves it. Customers read active fees (public columns only); proposer, approver, notes and reasons are staff-only (tk_staff_trips).';
alter table public.tk_trip_fees enable row level security;
revoke all on public.tk_trip_fees from public, anon, authenticated;
grant select (id, trip_id, project_id, version, amount_cents, currency, status, document_id, effective_from, created_at) on public.tk_trip_fees to authenticated;
grant all on public.tk_trip_fees to service_role;
drop policy if exists tk_trip_fees_read on public.tk_trip_fees;
create policy tk_trip_fees_read on public.tk_trip_fees for select to authenticated
  using (exists (select 1 from public.tk_client_projects p where p.id = project_id) and (status = 'active' or public.tk_staff_can_view(project_id)));

-- passport copies (id generated by the browser = file name). Readable by the client company's members and Turnkey staff
-- with a need only (tk_passport_staff_ok); deleted on request; purged after the trip (tk_purge_trip_passports)
create table if not exists public.tk_trip_travellers (
  id uuid primary key,
  trip_id uuid not null references public.tk_trips(id) on delete cascade,
  project_id uuid not null references public.tk_client_projects(id) on delete cascade,
  position smallint not null check (position between 1 and 20),
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  file_path text not null unique check (length(file_path) between 3 and 400),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tk_trip_travellers_path check (split_part(file_path, '/', 1) = project_id::text and split_part(file_path, '/', 2) = trip_id::text
                                            and split_part(file_path, '/', 3) like id::text || '.%')
);
create unique index if not exists tk_trip_travellers_position_idx on public.tk_trip_travellers (trip_id, position);
create index if not exists tk_trip_travellers_project_idx on public.tk_trip_travellers (project_id);
create index if not exists tk_trip_travellers_uploaded_by_idx on public.tk_trip_travellers (uploaded_by);
comment on table public.tk_trip_travellers is 'Turnkey T6: passport copies for a trip (private turnkey-passports bucket, 60-second signed URLs). Only the client company''s members and Turnkey staff with a need (editors on 2FA or the project''s account manager) read them. Deleted on request (tk_delete_trip_passport); purged 30 days after the trip (tk_purge_trip_passports).';
alter table public.tk_trip_travellers enable row level security;
revoke all on public.tk_trip_travellers from public, anon, authenticated;
grant select (id, trip_id, project_id, position, full_name, file_path, mime_type, size_bytes, created_at) on public.tk_trip_travellers to authenticated;
grant all on public.tk_trip_travellers to service_role;

-- ───────── 5. history is never rewritten (guard) ─────────
create or replace function public.tk_t6_history_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_signed boolean;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;   -- cascade from a deleted project / shipment / trip (owner-only clean-up)
    if tg_table_name = 'tk_trip_travellers' then return old; end if;   -- passport copies are deleted on request (definer functions only)
    if tg_table_name = 'tk_project_documents' then
      if old.status = 'draft' then return old; end if;
    elsif tg_table_name = 'tk_handover_items' then
      if old.done_at is null and not exists (select 1 from public.tk_handover_signoffs s where s.project_id = old.project_id) then return old; end if;
    end if;
    raise exception 'TK_HISTORY_KEPT: % rows are never deleted', tg_table_name;
  end if;
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if tg_table_name in ('tk_quote_balances', 'tk_shipment_events') then
    raise exception 'TK_HISTORY_KEPT: % rows cannot be rewritten', tg_table_name;
  elsif tg_table_name = 'tk_handover_signoffs' then
    -- only the signing account may go (a deleted user); the signature itself never changes
    if (v_new - 'signed_by') is distinct from (v_old - 'signed_by') or new.signed_by is not null then
      raise exception 'TK_HISTORY_KEPT: a handover sign-off cannot be rewritten';
    end if;
  elsif tg_table_name = 'tk_trip_travellers' then
    if (v_new - 'uploaded_by') is distinct from (v_old - 'uploaded_by') or new.uploaded_by is not null then
      raise exception 'TK_HISTORY_KEPT: a passport copy cannot be changed; delete it and upload it again';
    end if;
  elsif tg_table_name = 'tk_trip_fees' then
    if (v_new - 'status' - 'approved_by' - 'approved_at' - 'rejected_by' - 'rejected_at' - 'reject_reason' - 'withdrawn_at' - 'document_id' - 'effective_from' - 'superseded_at')
         is distinct from (v_old - 'status' - 'approved_by' - 'approved_at' - 'rejected_by' - 'rejected_at' - 'reject_reason' - 'withdrawn_at' - 'document_id' - 'effective_from' - 'superseded_at')
       or (old.approved_by is not null and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at))
       or (old.document_id is not null and new.document_id is distinct from old.document_id)
       or (old.status in ('rejected', 'withdrawn', 'superseded') and v_new is distinct from v_old) then
      raise exception 'FEE_HISTORY_KEPT: a proposed fee cannot be rewritten; propose a new version';
    end if;
    if old.status = 'active' and new.status not in ('active', 'superseded') then raise exception 'FEE_HISTORY_KEPT: an active fee can only be superseded'; end if;
  elsif tg_table_name = 'tk_shipments' then
    if old.status in ('delivered', 'cancelled') or new.project_id is distinct from old.project_id or new.seq is distinct from old.seq
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'TK_HISTORY_KEPT: a delivered or cancelled shipment cannot be rewritten';
    end if;
  elsif tg_table_name = 'tk_project_documents' then
    if (v_new - 'status' - 'released_at' - 'withdrawn_at' - 'withdraw_reason') is distinct from (v_old - 'status' - 'released_at' - 'withdrawn_at' - 'withdraw_reason')
       or old.status = 'withdrawn' or (old.status = 'released' and new.status not in ('released', 'withdrawn'))
       or (old.released_at is not null and new.released_at is distinct from old.released_at) then
      raise exception 'TK_HISTORY_KEPT: a shared document cannot be rewritten; upload a new one';
    end if;
  elsif tg_table_name = 'tk_trips' then
    if old.status in ('completed', 'cancelled') and (v_new - 'requested_by') is distinct from (v_old - 'requested_by') then
      raise exception 'TK_HISTORY_KEPT: a completed or cancelled trip cannot be rewritten';
    end if;
    if (v_new - 'status' - 'itinerary' - 'trip_report' - 'confirmed_at' - 'completed_at' - 'cancelled_at' - 'cancel_reason' - 'guide_name' - 'staff_notes'
              - 'confirmed_by' - 'updated_at' - 'requested_by')
         is distinct from (v_old - 'status' - 'itinerary' - 'trip_report' - 'confirmed_at' - 'completed_at' - 'cancelled_at' - 'cancel_reason' - 'guide_name'
              - 'staff_notes' - 'confirmed_by' - 'updated_at' - 'requested_by')
       or (new.requested_by is distinct from old.requested_by and new.requested_by is not null) then
      raise exception 'TK_HISTORY_KEPT: the trip request (dates, travellers, extras, prices) cannot be changed; cancel it and ask again';
    end if;
  elsif tg_table_name = 'tk_handover_items' then
    v_signed := exists (select 1 from public.tk_handover_signoffs s where s.project_id = old.project_id);
    if v_signed or (v_new - 'document_id' - 'done_at' - 'done_by') is distinct from (v_old - 'document_id' - 'done_at' - 'done_by') then
      raise exception 'TK_HISTORY_KEPT: the handover checklist cannot be changed after sign-off, and its lines are never rewritten';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tk_t6_history_guard() from public, anon, authenticated;
drop trigger if exists trg_tk_quote_balances_guard on public.tk_quote_balances;
create trigger trg_tk_quote_balances_guard before update or delete on public.tk_quote_balances for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_shipments_guard on public.tk_shipments;
create trigger trg_tk_shipments_guard before update or delete on public.tk_shipments for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_shipment_events_guard on public.tk_shipment_events;
create trigger trg_tk_shipment_events_guard before update or delete on public.tk_shipment_events for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_project_documents_guard on public.tk_project_documents;
create trigger trg_tk_project_documents_guard before update or delete on public.tk_project_documents for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_handover_items_guard on public.tk_handover_items;
create trigger trg_tk_handover_items_guard before update or delete on public.tk_handover_items for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_handover_signoffs_guard on public.tk_handover_signoffs;
create trigger trg_tk_handover_signoffs_guard before update or delete on public.tk_handover_signoffs for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_trips_guard on public.tk_trips;
create trigger trg_tk_trips_guard before update or delete on public.tk_trips for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_trip_fees_guard on public.tk_trip_fees;
create trigger trg_tk_trip_fees_guard before update or delete on public.tk_trip_fees for each row execute function public.tk_t6_history_guard();
drop trigger if exists trg_tk_trip_travellers_guard on public.tk_trip_travellers;
create trigger trg_tk_trip_travellers_guard before update or delete on public.tk_trip_travellers for each row execute function public.tk_t6_history_guard();

-- ───────── 6. helpers ─────────
-- state of the accepted quote's balance: no_quote | none (deposit = total) | not_invoiced | unpaid | paid. Internal.
create or replace function public.tk_balance_state(p_project uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q public.tk_client_quotes;
  b public.tk_quote_balances;
begin
  select * into q from public.tk_client_quotes where project_id = p_project and status = 'accepted';
  if q.id is null then return 'no_quote'; end if;
  if q.total_cents - coalesce(q.deposit_cents, 0) <= 0 then return 'none'; end if;
  select * into b from public.tk_quote_balances where project_id = p_project;
  if b.id is null then return 'not_invoiced'; end if;
  return case when public.tk_fee_is_paid(b.document_id) then 'paid' else 'unpaid' end;
end $$;
revoke all on function public.tk_balance_state(uuid) from public, anon, authenticated;
grant execute on function public.tk_balance_state(uuid) to service_role;

-- "US$ 1,234.00". Internal.
create or replace function public.tk_usd(p_cents bigint)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select 'US$ ' || to_char(p_cents / 100.0, 'FM999,999,999,990.00');
$$;
revoke all on function public.tk_usd(bigint) from public, anon, authenticated;
grant execute on function public.tk_usd(bigint) to service_role;

create or replace function public.tk_shipment_status_label(p_status text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_status when 'booked' then 'Booked' when 'in_transit' then 'In transit' when 'arrived' then 'Arrived'
                       when 'delivered' then 'Delivered' when 'cancelled' then 'Cancelled' else p_status end;
$$;
revoke all on function public.tk_shipment_status_label(text) from public, anon, authenticated;
grant execute on function public.tk_shipment_status_label(text) to service_role;

create or replace function public.tk_document_kind_label(p_kind text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_kind when 'bill_of_lading' then 'Bill of lading' when 'packing_list' then 'Packing list' when 'commercial_invoice' then 'Commercial invoice'
                     when 'certificate_of_origin' then 'Certificate of origin' when 'insurance' then 'Insurance certificate' when 'customs' then 'Customs document'
                     when 'warranty' then 'Warranty' when 'manual' then 'Manual' when 'as_built_drawing' then 'As-built drawing' when 'certificate' then 'Certificate'
                     when 'final_invoice' then 'Final invoice' when 'training' then 'Training record' else 'Document' end;
$$;
revoke all on function public.tk_document_kind_label(text) from public, anon, authenticated;
grant execute on function public.tk_document_kind_label(text) to service_role;

-- Turnkey staff with a need for passport copies: a Turnkey editor of the project's division, or the project's account
-- manager (primary or cover), on a 2FA staff session. Used by RLS and storage policies.
create or replace function public.tk_passport_staff_ok(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and is_staff() and staff_aal_ok() and exists (
    select 1 from public.tk_client_projects p
     where p.id = p_project and (public.tk_staff_can_edit(p.division_id) or public.tk_is_project_manager(p.id)));
$$;
revoke all on function public.tk_passport_staff_ok(uuid) from public, anon;
grant execute on function public.tk_passport_staff_ok(uuid) to authenticated, service_role;

drop policy if exists tk_trip_travellers_read on public.tk_trip_travellers;
create policy tk_trip_travellers_read on public.tk_trip_travellers for select to authenticated
  using (public.tk_is_project_customer(project_id) or public.tk_passport_staff_ok(project_id));

-- the trip's list price from tk_services ("From" prices): per day for up to the included travellers, each extra traveller
-- per day, visa letters, car-and-driver days, airport pick-ups and hotel help (free). Refuses impossible requests.
create or replace function public.tk_trip_estimate(p_start date, p_end date, p_travellers integer, p_visa_letters integer, p_car_days integer,
                                                   p_airport_pickups integer, p_hotel_help boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
  s_visit public.tk_services;
  s_visa public.tk_services;
  s_car public.tk_services;
  s_pick public.tk_services;
  s_hotel public.tk_services;
  v_extra integer;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_hotel bigint := 0;
begin
  if p_start is null or p_end is null or p_end < p_start then raise exception 'INVALID_DATES: choose the first and the last day of the visit'; end if;
  v_days := p_end - p_start + 1;
  if v_days > 30 then raise exception 'TRIP_TOO_LONG: a visit lasts at most 30 days'; end if;
  if p_travellers is null or p_travellers < 1 or p_travellers > 20 then raise exception 'INVALID_TRAVELLERS: from 1 to 20 travellers'; end if;
  if coalesce(p_visa_letters, 0) < 0 or coalesce(p_visa_letters, 0) > p_travellers then raise exception 'INVALID_EXTRAS: at most one visa letter per traveller'; end if;
  if coalesce(p_car_days, 0) < 0 or coalesce(p_car_days, 0) > v_days then raise exception 'INVALID_EXTRAS: car and driver for at most every day of the visit'; end if;
  if coalesce(p_airport_pickups, 0) < 0 or coalesce(p_airport_pickups, 0) > 10 then raise exception 'INVALID_EXTRAS: up to 10 airport pick-ups'; end if;
  select * into s_visit from public.tk_services where code = 'visit_china' and active;
  if s_visit.code is null or s_visit.from_cents <= 0 then raise exception 'SERVICE_UNAVAILABLE: China visits are not offered at the moment'; end if;
  select * into s_visa from public.tk_services where code = 'visa_letter' and active;
  select * into s_car from public.tk_services where code = 'car_driver' and active;
  select * into s_pick from public.tk_services where code = 'airport_pickup' and active;
  select * into s_hotel from public.tk_services where code = 'hotel_help' and active;
  if (coalesce(p_visa_letters, 0) > 0 and s_visa.code is null) or (coalesce(p_car_days, 0) > 0 and s_car.code is null)
     or (coalesce(p_airport_pickups, 0) > 0 and s_pick.code is null) or (coalesce(p_hotel_help, false) and s_hotel.code is null) then
    raise exception 'EXTRA_UNAVAILABLE: one of the trip extras is not offered at the moment';
  end if;
  v_extra := greatest(p_travellers - coalesce(s_visit.included_travellers, 2), 0);
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', 'visit_china', 'label', s_visit.name || ' (up to ' || coalesce(s_visit.included_travellers, 2) || ' people)',
    'qty', v_days, 'unit_cents', s_visit.from_cents, 'total_cents', v_days * s_visit.from_cents));
  v_total := v_days * s_visit.from_cents;
  if v_extra > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', 'extra_traveller', 'label', 'Extra traveller per day',
      'qty', v_days * v_extra, 'unit_cents', coalesce(s_visit.extra_traveller_day_cents, 0), 'total_cents', v_days * v_extra * coalesce(s_visit.extra_traveller_day_cents, 0)));
    v_total := v_total + v_days * v_extra * coalesce(s_visit.extra_traveller_day_cents, 0);
  end if;
  if coalesce(p_visa_letters, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', 'visa_letter', 'label', s_visa.name, 'qty', p_visa_letters, 'unit_cents', s_visa.from_cents, 'total_cents', p_visa_letters * s_visa.from_cents));
    v_total := v_total + p_visa_letters * s_visa.from_cents;
  end if;
  if coalesce(p_car_days, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', 'car_driver', 'label', s_car.name || ' (days)', 'qty', p_car_days, 'unit_cents', s_car.from_cents, 'total_cents', p_car_days * s_car.from_cents));
    v_total := v_total + p_car_days * s_car.from_cents;
  end if;
  if coalesce(p_airport_pickups, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', 'airport_pickup', 'label', s_pick.name, 'qty', p_airport_pickups, 'unit_cents', s_pick.from_cents, 'total_cents', p_airport_pickups * s_pick.from_cents));
    v_total := v_total + p_airport_pickups * s_pick.from_cents;
  end if;
  if coalesce(p_hotel_help, false) then
    v_hotel := s_hotel.from_cents;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', 'hotel_help', 'label', s_hotel.name, 'qty', 1, 'unit_cents', v_hotel, 'total_cents', v_hotel));
    v_total := v_total + v_hotel;
  end if;
  return jsonb_build_object('days', v_days, 'travellers', p_travellers, 'lines', v_lines, 'list_cents', v_total,
    'day_cents', s_visit.from_cents, 'included_travellers', coalesce(s_visit.included_travellers, 2), 'extra_traveller_day_cents', coalesce(s_visit.extra_traveller_day_cents, 0),
    'visa_letter_cents', coalesce(s_visa.from_cents, 0), 'car_day_cents', coalesce(s_car.from_cents, 0), 'airport_pickup_cents', coalesce(s_pick.from_cents, 0),
    'hotel_help_cents', coalesce(s_hotel.from_cents, 0));
end $$;
revoke all on function public.tk_trip_estimate(date, date, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function public.tk_trip_estimate(date, date, integer, integer, integer, integer, boolean) to authenticated, service_role;

create or replace function public.tk_trip_label(p_trip uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'China visit ' || to_char(t.start_on, 'FMDD Mon YYYY') || case when t.days > 1 then ' to ' || to_char(t.end_on, 'FMDD Mon YYYY') else '' end
         || ' (' || t.days || case when t.days = 1 then ' day, ' else ' days, ' end || t.travellers || case when t.travellers = 1 then ' traveller)' else ' travellers)' end
    from public.tk_trips t where t.id = p_trip;
$$;
revoke all on function public.tk_trip_label(uuid) from public, anon, authenticated;
grant execute on function public.tk_trip_label(uuid) to service_role;

-- ───────── 7. private buckets: documents (staff upload, clients read released) and passports (client upload) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('turnkey-documents', 'turnkey-documents', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('turnkey-passports', 'turnkey-passports', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- a Turnkey editor may upload into <project id>/ while the project is in Shipment or Handover (not cancelled); after the
-- client signed the handover (completed) only an admin may
create or replace function public.tk_doc_can_upload(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_client_projects p
                  where p.id::text = p_folder and p.org_id is not null and p.status <> 'cancelled' and public.tk_staff_can_edit(p.division_id)
                    and ((p.status <> 'completed' and p.stage in ('shipment', 'handover')) or (p.status = 'completed' and is_admin())));
$$;
revoke all on function public.tk_doc_can_upload(text) from public, anon;
grant execute on function public.tk_doc_can_upload(text) to authenticated, service_role;

-- a registered document: staff who can view the project, or (released, shipment not cancelled) the project's company;
-- a file that is not registered yet only for the editor who may upload it
create or replace function public.tk_doc_file_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_project_documents d join public.tk_client_projects p on p.id = d.project_id
                  where d.file_path = p_name
                    and (public.tk_staff_can_view(p.id)
                         or (d.status = 'released' and p.org_id is not null and p.org_id in (select my_org_ids())
                             and (d.shipment_id is null or exists (select 1 from public.tk_shipments s where s.id = d.shipment_id and s.status <> 'cancelled')))))
      or (not exists (select 1 from public.tk_project_documents d where d.file_path = p_name)
          and public.tk_doc_can_upload(split_part(p_name, '/', 1)));
$$;
revoke all on function public.tk_doc_file_visible(text) from public, anon;
grant execute on function public.tk_doc_file_visible(text) to authenticated, service_role;

create or replace function public.tk_doc_orphan_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.tk_project_documents d where d.file_path = p_name)
     and public.tk_doc_can_upload(split_part(p_name, '/', 1));
$$;
revoke all on function public.tk_doc_orphan_removable(text) from public, anon;
grant execute on function public.tk_doc_orphan_removable(text) to authenticated, service_role;

-- the client (a non-staff member of the project's company) may upload into <project id>/<trip id>/ while the trip is
-- requested or confirmed and the project open
create or replace function public.tk_passport_can_upload(p_project text, p_trip text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_trips t join public.tk_client_projects p on p.id = t.project_id
                  where t.id::text = p_trip and t.project_id::text = p_project and t.status in ('requested', 'confirmed') and p.status = 'open'
                    and public.tk_is_project_customer(p.id));
$$;
revoke all on function public.tk_passport_can_upload(text, text) from public, anon;
grant execute on function public.tk_passport_can_upload(text, text) to authenticated, service_role;

-- a registered passport copy: the project's company (non-staff members) or Turnkey staff with a need; an unregistered file
-- only for the client who may upload it
create or replace function public.tk_passport_file_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tk_trip_travellers x
                  where x.file_path = p_name and (public.tk_is_project_customer(x.project_id) or public.tk_passport_staff_ok(x.project_id)))
      or (not exists (select 1 from public.tk_trip_travellers x where x.file_path = p_name)
          and public.tk_passport_can_upload(split_part(p_name, '/', 1), split_part(p_name, '/', 2)));
$$;
revoke all on function public.tk_passport_file_visible(text) from public, anon;
grant execute on function public.tk_passport_file_visible(text) to authenticated, service_role;

-- a file that is no longer (or never was) registered — after tk_delete_trip_passport, or a refused registration — may be
-- removed by the project's client or Turnkey staff with a need
create or replace function public.tk_passport_orphan_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.tk_trip_travellers x where x.file_path = p_name)
     and exists (select 1 from public.tk_client_projects p where p.id::text = split_part(p_name, '/', 1)
                    and (public.tk_is_project_customer(p.id) or public.tk_passport_staff_ok(p.id)));
$$;
revoke all on function public.tk_passport_orphan_removable(text) from public, anon;
grant execute on function public.tk_passport_orphan_removable(text) to authenticated, service_role;

drop policy if exists "turnkey documents staff upload" on storage.objects;
create policy "turnkey documents staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'turnkey-documents' and public.tk_doc_can_upload((storage.foldername(name))[1]));
drop policy if exists "turnkey documents read" on storage.objects;
create policy "turnkey documents read" on storage.objects for select to authenticated
  using (bucket_id = 'turnkey-documents' and public.tk_doc_file_visible(name));
drop policy if exists "turnkey documents remove unregistered" on storage.objects;
create policy "turnkey documents remove unregistered" on storage.objects for delete to authenticated
  using (bucket_id = 'turnkey-documents' and public.tk_doc_orphan_removable(name));
drop policy if exists "turnkey passports client upload" on storage.objects;
create policy "turnkey passports client upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'turnkey-passports' and public.tk_passport_can_upload((storage.foldername(name))[1], (storage.foldername(name))[2]));
drop policy if exists "turnkey passports read" on storage.objects;
create policy "turnkey passports read" on storage.objects for select to authenticated
  using (bucket_id = 'turnkey-passports' and public.tk_passport_file_visible(name));
drop policy if exists "turnkey passports remove unregistered" on storage.objects;
create policy "turnkey passports remove unregistered" on storage.objects for delete to authenticated
  using (bucket_id = 'turnkey-passports' and public.tk_passport_orphan_removable(name));

-- ───────── 8. balance invoice ─────────
-- a Turnkey editor issues the balance of the accepted quote (total − deposit) once its deposit is paid, before Shipment
create or replace function public.tk_issue_balance_invoice(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  q public.tk_client_quotes;
  v_amount bigint;
  v_doc uuid;
  v_id uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors issue the balance'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  if v.stage not in ('quote_deposit', 'production_qc') then raise exception 'NOT_BEFORE_SHIPMENT: the balance is invoiced after the deposit and before Shipment'; end if;
  select * into q from public.tk_client_quotes where project_id = v.id and status = 'accepted';
  if q.id is null then raise exception 'QUOTE_NOT_ACCEPTED: the client has not accepted a quote'; end if;
  if not public.tk_fee_is_paid(q.document_id) then raise exception 'DEPOSIT_NOT_PAID: the balance is invoiced after the deposit is paid in full'; end if;
  if exists (select 1 from public.tk_quote_balances b where b.project_id = v.id) then raise exception 'BALANCE_ALREADY_ISSUED: the balance invoice was already issued'; end if;
  v_amount := q.total_cents - q.deposit_cents;
  if v_amount <= 0 then raise exception 'NO_BALANCE: the deposit covers the whole quote'; end if;
  v_doc := public.tk_issue_project_proforma(v.id, 'shipment', 'Balance · quote version ' || q.version, 'tk_quote_balance', v_amount);
  insert into public.tk_quote_balances (project_id, quote_id, total_cents, deposit_cents, amount_cents, document_id, issued_by)
  values (v.id, q.id, q.total_cents, q.deposit_cents, v_amount, v_doc, auth.uid())
  returning id into v_id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'balance', 'shipment', 'Balance for quote version ' || q.version || ': ' || public.tk_usd(v_amount) || ' (total ' || public.tk_usd(q.total_cents) ||
          ' less the deposit ' || public.tk_usd(q.deposit_cents) || '). Shipment starts after it is paid.');
  perform write_audit('turnkey.balance_issued', 'tk_quote_balances', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'quote_id', q.id, 'version', q.version, 'total_cents', q.total_cents, 'deposit_cents', q.deposit_cents,
                       'amount_cents', v_amount, 'document_id', v_doc));
  return jsonb_build_object('id', v_id, 'document_id', v_doc, 'amount_cents', v_amount);
end $$;
revoke all on function public.tk_issue_balance_invoice(uuid) from public, anon;
grant execute on function public.tk_issue_balance_invoice(uuid) to authenticated, service_role;

-- ───────── 9. shipments and tracking ─────────
create or replace function public.tk_create_shipment(p_project uuid, p_mode text, p_carrier text, p_booking_ref text, p_container_no text, p_tracking_no text,
                                                     p_origin text, p_destination text, p_etd date, p_eta date, p_staff_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_booking text := nullif(btrim(coalesce(p_booking_ref, '')), '');
  v_cont text := nullif(upper(btrim(coalesce(p_container_no, ''))), '');
  v_track text := nullif(btrim(coalesce(p_tracking_no, '')), '');
  v_origin text := nullif(btrim(coalesce(p_origin, '')), '');
  v_dest text := nullif(btrim(coalesce(p_destination, '')), '');
  v_note text := nullif(btrim(coalesce(p_staff_note, '')), '');
  v_seq smallint;
  v_id uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors book shipments'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  if v.stage <> 'shipment' then raise exception 'NOT_IN_SHIPMENT: shipments are booked in the Shipment phase'; end if;
  if p_mode is null or p_mode not in ('sea', 'air', 'express') then raise exception 'INVALID_MODE: choose sea, air or express'; end if;
  if v_carrier is null then raise exception 'CARRIER_REQUIRED: enter the carrier or forwarder'; end if;
  if length(v_carrier) > 120 or length(coalesce(v_booking, '')) > 80 or length(coalesce(v_track, '')) > 80 or length(coalesce(v_origin, '')) > 120
     or length(coalesce(v_dest, '')) > 120 or length(coalesce(v_note, '')) > 2000 then
    raise exception 'TOO_LONG: shorten the text';
  end if;
  if v_cont is not null and v_cont !~ '^[A-Z0-9][A-Z0-9 -]{2,23}$' then raise exception 'INVALID_CONTAINER: use letters and digits, for example MSCU1234567'; end if;
  if p_etd is not null and p_eta is not null and p_eta < p_etd then raise exception 'INVALID_DATES: the arrival is before the departure'; end if;
  if (p_etd is not null and (p_etd < current_date - 365 or p_etd > current_date + 730)) or (p_eta is not null and (p_eta < current_date - 365 or p_eta > current_date + 730)) then
    raise exception 'INVALID_DATES: choose dates within two years';
  end if;
  if public.tk_names_supplier(v.id, concat_ws(' ', v_carrier, v_booking, v_track, v_origin, v_dest)) then
    raise exception 'SUPPLIER_NAME_SHOWN: the shipment details name a factory; clients deal only with Octopus';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from public.tk_shipments where project_id = v.id;
  if v_seq > 50 then raise exception 'TOO_MANY_SHIPMENTS: at most 50 shipments per project'; end if;
  insert into public.tk_shipments (project_id, seq, mode, carrier, booking_ref, container_no, tracking_no, origin, destination, etd, eta, staff_note, created_by)
  values (v.id, v_seq, p_mode, v_carrier, v_booking, v_cont, v_track, v_origin, v_dest, p_etd, p_eta, v_note, auth.uid())
  returning id into v_id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'shipment', 'shipment', 'Shipment ' || v_seq || ' booked: ' || case p_mode when 'sea' then 'sea freight' when 'air' then 'air freight' else 'express' end ||
          ' with ' || v_carrier || coalesce(', departure ' || to_char(p_etd, 'FMDD Mon YYYY'), '') || coalesce(', arrival ' || to_char(p_eta, 'FMDD Mon YYYY'), '') || '.');
  perform write_audit('turnkey.shipment_created', 'tk_shipments', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'seq', v_seq, 'mode', p_mode, 'carrier', v_carrier, 'booking_ref', v_booking, 'container_no', v_cont, 'etd', p_etd, 'eta', p_eta));
  return jsonb_build_object('id', v_id, 'seq', v_seq);
end $$;
revoke all on function public.tk_create_shipment(uuid, text, text, text, text, text, text, text, date, date, text) from public, anon;
grant execute on function public.tk_create_shipment(uuid, text, text, text, text, text, text, text, date, date, text) to authenticated, service_role;

create or replace function public.tk_update_shipment(p_shipment uuid, p_carrier text, p_booking_ref text, p_container_no text, p_tracking_no text,
                                                     p_origin text, p_destination text, p_etd date, p_eta date, p_staff_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.tk_shipments;
  v public.tk_client_projects;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_booking text := nullif(btrim(coalesce(p_booking_ref, '')), '');
  v_cont text := nullif(upper(btrim(coalesce(p_container_no, ''))), '');
  v_track text := nullif(btrim(coalesce(p_tracking_no, '')), '');
  v_origin text := nullif(btrim(coalesce(p_origin, '')), '');
  v_dest text := nullif(btrim(coalesce(p_destination, '')), '');
  v_note text := nullif(btrim(coalesce(p_staff_note, '')), '');
begin
  select * into s from public.tk_shipments where id = p_shipment;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = s.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors change shipments'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  select * into s from public.tk_shipments where id = p_shipment for update;
  if s.status in ('delivered', 'cancelled') then raise exception 'SHIPMENT_CLOSED: a delivered or cancelled shipment cannot be changed'; end if;
  if v_carrier is null then raise exception 'CARRIER_REQUIRED: enter the carrier or forwarder'; end if;
  if length(v_carrier) > 120 or length(coalesce(v_booking, '')) > 80 or length(coalesce(v_track, '')) > 80 or length(coalesce(v_origin, '')) > 120
     or length(coalesce(v_dest, '')) > 120 or length(coalesce(v_note, '')) > 2000 then
    raise exception 'TOO_LONG: shorten the text';
  end if;
  if v_cont is not null and v_cont !~ '^[A-Z0-9][A-Z0-9 -]{2,23}$' then raise exception 'INVALID_CONTAINER: use letters and digits, for example MSCU1234567'; end if;
  if p_etd is not null and p_eta is not null and p_eta < p_etd then raise exception 'INVALID_DATES: the arrival is before the departure'; end if;
  if (p_etd is not null and (p_etd < current_date - 365 or p_etd > current_date + 730)) or (p_eta is not null and (p_eta < current_date - 365 or p_eta > current_date + 730)) then
    raise exception 'INVALID_DATES: choose dates within two years';
  end if;
  if public.tk_names_supplier(v.id, concat_ws(' ', v_carrier, v_booking, v_track, v_origin, v_dest)) then
    raise exception 'SUPPLIER_NAME_SHOWN: the shipment details name a factory; clients deal only with Octopus';
  end if;
  update public.tk_shipments set carrier = v_carrier, booking_ref = v_booking, container_no = v_cont, tracking_no = v_track, origin = v_origin,
         destination = v_dest, etd = p_etd, eta = p_eta, staff_note = v_note, updated_at = now()
   where id = s.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  if p_eta is distinct from s.eta or p_etd is distinct from s.etd or v_carrier is distinct from s.carrier or v_cont is distinct from s.container_no
     or v_booking is distinct from s.booking_ref or v_track is distinct from s.tracking_no then
    insert into public.tk_client_project_events (project_id, kind, to_stage, message)
    values (v.id, 'shipment', 'shipment', 'Shipment ' || s.seq || ' details updated' || coalesce(': arrival ' || to_char(p_eta, 'FMDD Mon YYYY'), '') || '.');
  end if;
  perform write_audit('turnkey.shipment_updated', 'tk_shipments', s.id::text,
    jsonb_build_object('code', v.code, 'seq', s.seq,
      'old', jsonb_build_object('carrier', s.carrier, 'booking_ref', s.booking_ref, 'container_no', s.container_no, 'tracking_no', s.tracking_no, 'origin', s.origin, 'destination', s.destination, 'etd', s.etd, 'eta', s.eta),
      'new', jsonb_build_object('carrier', v_carrier, 'booking_ref', v_booking, 'container_no', v_cont, 'tracking_no', v_track, 'origin', v_origin, 'destination', v_dest, 'etd', p_etd, 'eta', p_eta)));
end $$;
revoke all on function public.tk_update_shipment(uuid, text, text, text, text, text, text, date, date, text) from public, anon;
grant execute on function public.tk_update_shipment(uuid, text, text, text, text, text, text, date, date, text) to authenticated, service_role;

-- staff add a tracking event; a status moves forward only (booked → in transit → arrived → delivered)
create or replace function public.tk_add_shipment_event(p_shipment uuid, p_happened_at timestamptz, p_status text, p_location text, p_description text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.tk_shipments;
  v public.tk_client_projects;
  v_loc text := nullif(btrim(coalesce(p_location, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_rank_old integer;
  v_rank_new integer;
  v_id bigint;
begin
  select * into s from public.tk_shipments where id = p_shipment;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = s.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors add tracking events'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.stage <> 'shipment' then raise exception 'NOT_IN_SHIPMENT: tracking events are added in the Shipment phase'; end if;
  select * into s from public.tk_shipments where id = p_shipment for update;
  if s.status in ('delivered', 'cancelled') then raise exception 'SHIPMENT_CLOSED: this shipment is delivered or cancelled'; end if;
  if v_desc is null then raise exception 'DESCRIPTION_REQUIRED: say what happened'; end if;
  if length(v_desc) > 500 or length(coalesce(v_loc, '')) > 120 then raise exception 'TOO_LONG: shorten the text'; end if;
  if p_happened_at is null or p_happened_at > now() + interval '1 day' or p_happened_at < now() - interval '365 days' then
    raise exception 'INVALID_DATE: the event happened within the last year (not in the future)';
  end if;
  if v_status is not null then
    if v_status not in ('in_transit', 'arrived', 'delivered') then raise exception 'INVALID_STATUS'; end if;
    v_rank_old := array_position(array['booked', 'in_transit', 'arrived', 'delivered'], s.status);
    v_rank_new := array_position(array['booked', 'in_transit', 'arrived', 'delivered'], v_status);
    if v_rank_new <= v_rank_old then raise exception 'STATUS_BACKWARDS: the shipment is already %', lower(public.tk_shipment_status_label(s.status)); end if;
  end if;
  if public.tk_names_supplier(v.id, concat_ws(' ', v_desc, v_loc)) then
    raise exception 'SUPPLIER_NAME_SHOWN: the event names a factory; clients deal only with Octopus';
  end if;
  insert into public.tk_shipment_events (shipment_id, project_id, happened_at, status_to, location, description, created_by)
  values (s.id, v.id, p_happened_at, v_status, v_loc, v_desc, auth.uid())
  returning id into v_id;
  update public.tk_shipments set status = coalesce(v_status, status), delivered_at = case when v_status = 'delivered' then now() else delivered_at end, updated_at = now()
   where id = s.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'shipment', 'shipment', 'Shipment ' || s.seq || coalesce(' — ' || public.tk_shipment_status_label(v_status), '') || ': ' || v_desc || coalesce(' (' || v_loc || ')', '') || '.');
  perform write_audit('turnkey.shipment_event', 'tk_shipments', s.id::text,
    jsonb_build_object('code', v.code, 'seq', s.seq, 'event_id', v_id, 'status', v_status, 'happened_at', p_happened_at));
  return v_id;
end $$;
revoke all on function public.tk_add_shipment_event(uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.tk_add_shipment_event(uuid, timestamptz, text, text, text) to authenticated, service_role;

-- staff cancel a shipment that has not left yet (booked); the reason is staff-only
create or replace function public.tk_cancel_shipment(p_shipment uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.tk_shipments;
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into s from public.tk_shipments where id = p_shipment;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = s.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors cancel shipments'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  select * into s from public.tk_shipments where id = p_shipment for update;
  if s.status <> 'booked' then raise exception 'SHIPMENT_MOVING: only a booked shipment that has not left can be cancelled'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  update public.tk_shipments set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason, updated_at = now() where id = s.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, 'shipment', 'shipment', 'Shipment ' || s.seq || ' was cancelled.');
  perform write_audit('turnkey.shipment_cancelled', 'tk_shipments', s.id::text, jsonb_build_object('code', v.code, 'seq', s.seq, 'reason', v_reason));
end $$;
revoke all on function public.tk_cancel_shipment(uuid, text) from public, anon;
grant execute on function public.tk_cancel_shipment(uuid, text) to authenticated, service_role;

-- ───────── 10. shipping and final documents (draft → released → withdrawn) ─────────
-- who may change documents of a project: Turnkey editors while it is not cancelled; after sign-off admins only. Internal.
create or replace function public.tk_doc_editor_check(p_division uuid, p_status text, p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_staff_can_edit(p_division) then raise exception 'FORBIDDEN: only Turnkey editors manage documents'; end if;
  if p_status = 'cancelled' then raise exception 'PROJECT_CLOSED: the project is cancelled'; end if;
  if p_status = 'completed' and not is_admin() then raise exception 'PROJECT_COMPLETED: after the client signed the handover only admins change documents'; end if;
  if p_org is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
end $$;
revoke all on function public.tk_doc_editor_check(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tk_doc_editor_check(uuid, text, uuid) to service_role;

-- registers a file the browser has just uploaded to turnkey-documents/<project id>/… as a DRAFT document (staff only)
create or replace function public.tk_add_project_document(p_project uuid, p_section text, p_kind text, p_title text, p_path text, p_file_name text,
                                                          p_shipment uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  s public.tk_shipments;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_name text := nullif(btrim(coalesce(p_file_name, '')), '');
  v_meta jsonb;
  v_mime text;
  v_size bigint;
  v_id uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  perform public.tk_doc_editor_check(v.division_id, v.status, v.org_id);
  if p_section is null or p_section not in ('shipment', 'handover') then raise exception 'INVALID_SECTION'; end if;
  if p_section = 'shipment' then
    if v.status <> 'completed' and v.stage not in ('shipment', 'handover') then raise exception 'NOT_IN_SHIPMENT: shipping documents are added from the Shipment phase'; end if;
    select * into s from public.tk_shipments where id = p_shipment and project_id = v.id;
    if s.id is null then raise exception 'SHIPMENT_REQUIRED: choose the shipment the document belongs to'; end if;
    if s.status = 'cancelled' then raise exception 'SHIPMENT_CLOSED: the shipment was cancelled'; end if;
    if p_kind is null or p_kind not in ('bill_of_lading', 'packing_list', 'commercial_invoice', 'certificate_of_origin', 'insurance', 'customs', 'other') then raise exception 'INVALID_KIND'; end if;
  else
    if v.status <> 'completed' and v.stage <> 'handover' then raise exception 'NOT_AT_HANDOVER: final documents are added in the Handover phase'; end if;
    if p_shipment is not null then raise exception 'INVALID_SECTION: a final document does not belong to a shipment'; end if;
    if p_kind is null or p_kind not in ('warranty', 'manual', 'as_built_drawing', 'certificate', 'final_invoice', 'training', 'other') then raise exception 'INVALID_KIND'; end if;
  end if;
  if v_title is null then v_title := public.tk_document_kind_label(p_kind); end if;
  if length(v_title) > 160 then raise exception 'TITLE_TOO_LONG: keep the title under 160 characters'; end if;
  if public.tk_names_supplier(v.id, v_title) then raise exception 'SUPPLIER_NAME_SHOWN: the title names a factory; clients deal only with Octopus'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v.id::text or position('..' in p_path) > 0 or length(p_path) > 400 then raise exception 'INVALID_FILE: upload the file again'; end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'turnkey-documents' and o.name = p_path;
  if not found then raise exception 'FILE_NOT_UPLOADED: upload the file first'; end if;
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'INVALID_FILE_TYPE: upload a PDF, JPG, PNG or WEBP file'; end if;
  if v_size is null or v_size <= 0 or v_size > 20971520 then raise exception 'INVALID_FILE_SIZE: files can be up to 20 MB'; end if;
  if exists (select 1 from public.tk_project_documents d where d.file_path = p_path) then raise exception 'FILE_ALREADY_USED: this file is already registered'; end if;
  v_name := left(coalesce(v_name, regexp_replace(p_path, '^.*/', '')), 200);
  insert into public.tk_project_documents (project_id, section, shipment_id, kind, title, file_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v.id, p_section, s.id, p_kind, v_title, p_path, v_name, v_mime, v_size, auth.uid())
  returning id into v_id;
  perform write_audit('turnkey.document_added', 'tk_project_documents', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'section', p_section, 'kind', p_kind, 'shipment_id', s.id, 'file_name', v_name, 'mime_type', v_mime, 'size_bytes', v_size));
  return jsonb_build_object('id', v_id, 'status', 'draft');
end $$;
revoke all on function public.tk_add_project_document(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.tk_add_project_document(uuid, text, text, text, text, text, uuid) to authenticated, service_role;

-- release a draft to the client
create or replace function public.tk_release_project_document(p_document uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.tk_project_documents;
  v public.tk_client_projects;
begin
  select * into d from public.tk_project_documents where id = p_document;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = d.project_id for update;
  perform public.tk_doc_editor_check(v.division_id, v.status, v.org_id);
  select * into d from public.tk_project_documents where id = p_document for update;
  if d.status <> 'draft' then raise exception 'DOCUMENT_SHARED: this document was already shared'; end if;
  if d.shipment_id is not null and exists (select 1 from public.tk_shipments s where s.id = d.shipment_id and s.status = 'cancelled') then
    raise exception 'SHIPMENT_CLOSED: the shipment was cancelled';
  end if;
  update public.tk_project_documents set status = 'released', released_at = now() where id = d.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, d.section, d.section,
          case when d.section = 'shipment' then 'Shipping document ready: ' else 'Final document ready: ' end || public.tk_document_kind_label(d.kind) ||
          case when d.title <> public.tk_document_kind_label(d.kind) then ' — ' || d.title else '' end || '.');
  perform write_audit('turnkey.document_released', 'tk_project_documents', d.id::text, jsonb_build_object('code', v.code, 'section', d.section, 'kind', d.kind, 'title', d.title));
end $$;
revoke all on function public.tk_release_project_document(uuid) from public, anon;
grant execute on function public.tk_release_project_document(uuid) to authenticated, service_role;

-- withdraw a released document (the client no longer sees it; the reason is staff-only)
create or replace function public.tk_withdraw_project_document(p_document uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.tk_project_documents;
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into d from public.tk_project_documents where id = p_document;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = d.project_id for update;
  perform public.tk_doc_editor_check(v.division_id, v.status, v.org_id);
  select * into d from public.tk_project_documents where id = p_document for update;
  if d.status <> 'released' then raise exception 'DOCUMENT_NOT_SHARED: only a shared document can be withdrawn'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  update public.tk_project_documents set status = 'withdrawn', withdrawn_at = now(), withdraw_reason = v_reason where id = d.id;
  -- an open checklist line loses a withdrawn document (it must be ticked again); after sign-off the checklist stays as signed
  if not exists (select 1 from public.tk_handover_signoffs so where so.project_id = v.id) then
    update public.tk_handover_items set document_id = null, done_at = null, done_by = null where document_id = d.id;
  end if;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, to_stage, message)
  values (v.id, d.section, d.section, 'Document withdrawn: ' || d.title || '. We will share a corrected one.');
  perform write_audit('turnkey.document_withdrawn', 'tk_project_documents', d.id::text, jsonb_build_object('code', v.code, 'section', d.section, 'kind', d.kind, 'reason', v_reason));
end $$;
revoke all on function public.tk_withdraw_project_document(uuid, text) from public, anon;
grant execute on function public.tk_withdraw_project_document(uuid, text) to authenticated, service_role;

-- remove a draft (never seen by the client); returns the file path so the app removes the file (storage policy: unregistered)
create or replace function public.tk_remove_project_document(p_document uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.tk_project_documents;
  v public.tk_client_projects;
begin
  select * into d from public.tk_project_documents where id = p_document;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = d.project_id for update;
  perform public.tk_doc_editor_check(v.division_id, v.status, v.org_id);
  select * into d from public.tk_project_documents where id = p_document for update;
  if d.status <> 'draft' then raise exception 'DOCUMENT_SHARED: a shared document is withdrawn, not removed'; end if;
  delete from public.tk_project_documents where id = d.id;
  perform write_audit('turnkey.document_removed', 'tk_project_documents', d.id::text, jsonb_build_object('code', v.code, 'section', d.section, 'kind', d.kind, 'file_name', d.file_name));
  return d.file_path;
end $$;
revoke all on function public.tk_remove_project_document(uuid) from public, anon;
grant execute on function public.tk_remove_project_document(uuid) to authenticated, service_role;

-- ───────── 11. handover checklist and the client's sign-off ─────────
create or replace function public.tk_add_handover_item(p_project uuid, p_label text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_pos smallint;
  v_id uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors prepare the handover'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.stage <> 'handover' then raise exception 'NOT_AT_HANDOVER: the final-documents checklist is prepared in the Handover phase'; end if;
  if exists (select 1 from public.tk_handover_signoffs s where s.project_id = v.id) then raise exception 'ALREADY_SIGNED: the client signed the handover'; end if;
  if v_label is null then raise exception 'LABEL_REQUIRED: name the document or step'; end if;
  if length(v_label) > 200 then raise exception 'LABEL_TOO_LONG: keep it under 200 characters'; end if;
  if public.tk_names_supplier(v.id, v_label) then raise exception 'SUPPLIER_NAME_SHOWN: the line names a factory; clients deal only with Octopus'; end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.tk_handover_items where project_id = v.id;
  if v_pos > 50 then raise exception 'TOO_MANY_ITEMS: at most 50 lines'; end if;
  insert into public.tk_handover_items (project_id, position, label, created_by) values (v.id, v_pos, v_label, auth.uid()) returning id into v_id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  perform write_audit('turnkey.handover_item_added', 'tk_handover_items', v_id::text, jsonb_build_object('code', v.code, 'position', v_pos, 'label', v_label));
  return v_id;
end $$;
revoke all on function public.tk_add_handover_item(uuid, text) from public, anon;
grant execute on function public.tk_add_handover_item(uuid, text) to authenticated, service_role;

-- tick (optionally with a released final document) or untick a checklist line, before the client signs
create or replace function public.tk_set_handover_item_done(p_item uuid, p_done boolean, p_document uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_handover_items;
  v public.tk_client_projects;
begin
  select * into i from public.tk_handover_items where id = p_item;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors prepare the handover'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.stage <> 'handover' then raise exception 'NOT_AT_HANDOVER: the checklist is used in the Handover phase'; end if;
  if exists (select 1 from public.tk_handover_signoffs s where s.project_id = v.id) then raise exception 'ALREADY_SIGNED: the client signed the handover'; end if;
  select * into i from public.tk_handover_items where id = p_item for update;
  if coalesce(p_done, false) then
    if p_document is not null and not exists (select 1 from public.tk_project_documents d where d.id = p_document and d.project_id = v.id
                                                and d.section = 'handover' and d.status = 'released') then
      raise exception 'INVALID_DOCUMENT: choose a final document the client can see (shared)';
    end if;
    update public.tk_handover_items set done_at = now(), done_by = auth.uid(), document_id = p_document where id = i.id;
  else
    if p_document is not null then raise exception 'INVALID_DOCUMENT'; end if;
    update public.tk_handover_items set done_at = null, done_by = null, document_id = null where id = i.id;
  end if;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  perform write_audit(case when coalesce(p_done, false) then 'turnkey.handover_item_done' else 'turnkey.handover_item_reopened' end, 'tk_handover_items', i.id::text,
    jsonb_build_object('code', v.code, 'position', i.position, 'document_id', p_document));
end $$;
revoke all on function public.tk_set_handover_item_done(uuid, boolean, uuid) from public, anon;
grant execute on function public.tk_set_handover_item_done(uuid, boolean, uuid) to authenticated, service_role;

create or replace function public.tk_remove_handover_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.tk_handover_items;
  v public.tk_client_projects;
begin
  select * into i from public.tk_handover_items where id = p_item;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = i.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors prepare the handover'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if exists (select 1 from public.tk_handover_signoffs s where s.project_id = v.id) then raise exception 'ALREADY_SIGNED: the client signed the handover'; end if;
  select * into i from public.tk_handover_items where id = p_item for update;
  if i.done_at is not null then raise exception 'ITEM_DONE: untick the line first'; end if;
  delete from public.tk_handover_items where id = i.id;
  perform write_audit('turnkey.handover_item_removed', 'tk_handover_items', i.id::text, jsonb_build_object('code', v.code, 'position', i.position, 'label', i.label));
end $$;
revoke all on function public.tk_remove_handover_item(uuid) from public, anon;
grant execute on function public.tk_remove_handover_item(uuid) to authenticated, service_role;

-- the client signs the handover with their typed full name: every checklist line done, every shipment delivered, no open
-- China visit. Signing completes the project (T2: completed only at Handover). Nothing but documents (admins) changes after.
create or replace function public.tk_sign_handover(p_project uuid, p_signed_name text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_signed_name, '')), '\s+', ' ', 'g'), '');
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_items integer;
  v_open integer;
  v_at timestamptz := now();
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_is_project_customer(v.id) then raise exception 'FORBIDDEN: only the client signs the handover'; end if;
  if exists (select 1 from public.tk_handover_signoffs s where s.project_id = v.id) then raise exception 'ALREADY_SIGNED: the handover is already signed'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: this project is not open'; end if;
  if v.stage <> 'handover' then raise exception 'NOT_AT_HANDOVER: you sign when the project reaches Handover'; end if;
  select count(*), count(*) filter (where done_at is null) into v_items, v_open from public.tk_handover_items where project_id = v.id;
  if v_items = 0 then raise exception 'CHECKLIST_EMPTY: we are still preparing your final documents'; end if;
  if v_open > 0 then raise exception 'CHECKLIST_OPEN: % checklist line(s) are not ready yet', v_open; end if;
  if exists (select 1 from public.tk_shipments s where s.project_id = v.id and s.status not in ('delivered', 'cancelled')) then
    raise exception 'SHIPMENT_NOT_DELIVERED: a shipment is not delivered yet';
  end if;
  if exists (select 1 from public.tk_trips t where t.project_id = v.id and t.status in ('requested', 'confirmed')) then
    raise exception 'TRIP_OPEN: your China visit is still open; we close it before you sign';
  end if;
  if v_name is null or length(v_name) < 2 then raise exception 'NAME_REQUIRED: type your full name'; end if;
  if length(v_name) > 120 then raise exception 'NAME_TOO_LONG: keep your name under 120 characters'; end if;
  if v_comment is not null and length(v_comment) > 1000 then raise exception 'COMMENT_TOO_LONG: keep the comment under 1,000 characters'; end if;
  insert into public.tk_handover_signoffs (project_id, signed_name, client_comment, items_count, signed_by, signed_at)
  values (v.id, v_name, v_comment, v_items, auth.uid(), v_at);
  update public.tk_client_projects set status = 'completed', status_reason = null, updated_at = v_at where id = v.id;
  update public.tk_client_project_stages set completed_at = v_at where project_id = v.id and stage = 'handover';
  insert into public.tk_client_project_events (project_id, kind, to_stage, message, created_at)
  values (v.id, 'handover', 'handover', 'Handover signed by ' || v_name || ' on ' || to_char(v_at, 'FMDD Mon YYYY') || '.', v_at);
  insert into public.tk_client_project_events (project_id, kind, status, message, created_at)
  values (v.id, 'status', 'completed', 'Completed with your handover sign-off.', v_at);
  perform write_audit('turnkey.handover_signed', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'signed_name', v_name, 'items', v_items, 'comment', v_comment));
  perform write_audit('turnkey.project_status', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.status, 'to', 'completed', 'reason', 'client handover sign-off'));
  return jsonb_build_object('status', 'completed', 'signed_at', v_at);
end $$;
revoke all on function public.tk_sign_handover(uuid, text, text) from public, anon;
grant execute on function public.tk_sign_handover(uuid, text, text) to authenticated, service_role;

-- ───────── 12. trips (Visit China) ─────────
-- the client asks for a China visit; the list price from tk_services is frozen on the trip (staff set the exact fee next)
create or replace function public.tk_request_trip(p_project uuid, p_start date, p_end date, p_travellers integer, p_visa_letters integer, p_car_days integer,
                                                  p_airport_pickups integer, p_hotel_help boolean, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  e jsonb;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_seq smallint;
  v_id uuid;
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_is_project_customer(v.id) then raise exception 'FORBIDDEN: only the client asks for a China visit'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: this project is not open'; end if;
  if exists (select 1 from public.tk_trips t where t.project_id = v.id and t.status in ('requested', 'confirmed')) then
    raise exception 'TRIP_OPEN: you already have an open China visit for this project';
  end if;
  if p_start is null or p_start <= current_date then raise exception 'INVALID_DATES: the visit starts tomorrow or later'; end if;
  if p_start > current_date + 730 then raise exception 'INVALID_DATES: choose a start within two years'; end if;
  if v_msg is not null and length(v_msg) > 2000 then raise exception 'MESSAGE_TOO_LONG: keep the message under 2,000 characters'; end if;
  e := public.tk_trip_estimate(p_start, p_end, p_travellers, coalesce(p_visa_letters, 0), coalesce(p_car_days, 0), coalesce(p_airport_pickups, 0), coalesce(p_hotel_help, false));
  select coalesce(max(seq), 0) + 1 into v_seq from public.tk_trips where project_id = v.id;
  if v_seq > 20 then raise exception 'TOO_MANY_TRIPS: please contact your account manager'; end if;
  insert into public.tk_trips (project_id, seq, start_on, end_on, days, travellers, visa_letters, car_days, airport_pickups, hotel_help, client_message,
                               day_cents, included_travellers, extra_traveller_day_cents, visa_letter_cents, car_day_cents, airport_pickup_cents, hotel_help_cents,
                               list_cents, requested_by)
  values (v.id, v_seq, p_start, p_end, (e ->> 'days')::smallint, p_travellers, coalesce(p_visa_letters, 0), coalesce(p_car_days, 0), coalesce(p_airport_pickups, 0),
          coalesce(p_hotel_help, false), v_msg, (e ->> 'day_cents')::bigint, (e ->> 'included_travellers')::smallint, (e ->> 'extra_traveller_day_cents')::bigint,
          (e ->> 'visa_letter_cents')::bigint, (e ->> 'car_day_cents')::bigint, (e ->> 'airport_pickup_cents')::bigint, (e ->> 'hotel_help_cents')::bigint,
          (e ->> 'list_cents')::bigint, auth.uid())
  returning id into v_id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, message)
  values (v.id, 'trip', 'You asked for a ' || public.tk_trip_label(v_id) || '. Estimate from ' || public.tk_usd((e ->> 'list_cents')::bigint) ||
          '; we confirm the exact fee before you pay.');
  perform write_audit('turnkey.trip_requested', 'tk_trips', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'seq', v_seq, 'start_on', p_start, 'end_on', p_end, 'travellers', p_travellers,
                       'visa_letters', coalesce(p_visa_letters, 0), 'car_days', coalesce(p_car_days, 0), 'airport_pickups', coalesce(p_airport_pickups, 0),
                       'hotel_help', coalesce(p_hotel_help, false), 'list_cents', (e ->> 'list_cents')::bigint));
  return jsonb_build_object('id', v_id, 'seq', v_seq, 'list_cents', (e ->> 'list_cents')::bigint, 'days', (e ->> 'days')::int);
end $$;
revoke all on function public.tk_request_trip(uuid, date, date, integer, integer, integer, integer, boolean, text) from public, anon;
grant execute on function public.tk_request_trip(uuid, date, date, integer, integer, integer, integer, boolean, text) to authenticated, service_role;

create or replace function public.tk_supersede_trip_fee(p_trip uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.tk_trip_fees;
begin
  select * into o from public.tk_trip_fees f where f.trip_id = p_trip and f.status = 'active' for update;
  if o.id is null then return null; end if;
  perform public.tk_void_fee_document(o.document_id);   -- refuses when the client has paid anything towards it
  update public.tk_trip_fees set status = 'superseded', superseded_at = now() where id = o.id;
  return o.id;
end $$;
revoke all on function public.tk_supersede_trip_fee(uuid) from public, anon, authenticated;
grant execute on function public.tk_supersede_trip_fee(uuid) to service_role;

create or replace function public.tk_trip_fee_activated(p_fee uuid, p_replaced uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_trip_fees;
begin
  select * into f from public.tk_trip_fees where id = p_fee;
  update public.tk_client_projects set updated_at = now() where id = f.project_id;
  insert into public.tk_client_project_events (project_id, kind, message)
  values (f.project_id, 'trip', public.tk_trip_label(f.trip_id) || ': fee ' || public.tk_usd(f.amount_cents) || '. Pay it and we confirm your itinerary.' ||
          case when p_replaced is not null then ' This replaces the earlier fee.' else '' end);
  perform write_audit('turnkey.trip_fee_activated', 'tk_trip_fees', f.id::text,
    jsonb_build_object('project_id', f.project_id, 'trip_id', f.trip_id, 'version', f.version, 'amount_cents', f.amount_cents, 'starting_cents', f.starting_cents,
                       'needs_approval', f.needs_approval, 'approved_by', f.approved_by, 'document_id', f.document_id, 'superseded', p_replaced));
end $$;
revoke all on function public.tk_trip_fee_activated(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tk_trip_fee_activated(uuid, uuid) to service_role;

-- staff set the exact trip fee (D5: service fees; the starting fee is the trip's list price from tk_services)
create or replace function public.tk_propose_trip_fee(p_trip uuid, p_amount_cents bigint, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tk_trips;
  v public.tk_client_projects;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_needs boolean;
  v_active public.tk_trip_fees;
  v_pending public.tk_trip_fees;
  v_ver integer;
  v_id uuid;
  v_doc uuid;
  v_old uuid;
begin
  select * into t from public.tk_trips where id = p_trip;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = t.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors set fees'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  if v.org_id is null then raise exception 'NO_CLIENT: this project is not linked to a client company'; end if;
  select * into t from public.tk_trips where id = p_trip for update;
  if t.status <> 'requested' then raise exception 'TRIP_NOT_REQUESTED: the fee is set before the trip is confirmed'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT: enter the fee (above 0)'; end if;
  if p_amount_cents > 100000000 then raise exception 'INVALID_AMOUNT: a fee above US$ 1,000,000.00 is not accepted here'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'NOTE_TOO_LONG: keep the note under 1,000 characters'; end if;
  select * into v_active from public.tk_trip_fees f where f.trip_id = t.id and f.status = 'active' for update;
  if v_active.id is not null and exists (select 1 from public.documents d where d.id = v_active.document_id and d.paid_cents > 0) then
    raise exception 'FEE_PAID_LOCKED: the client has paid towards this fee; it cannot be changed';
  end if;
  v_needs := p_amount_cents > 2 * t.list_cents;
  select * into v_pending from public.tk_trip_fees f where f.trip_id = t.id and f.status = 'pending_approval' for update;
  if v_pending.id is not null then
    update public.tk_trip_fees set status = 'withdrawn', withdrawn_at = now() where id = v_pending.id;
    perform write_audit('turnkey.trip_fee_withdrawn', 'tk_trip_fees', v_pending.id::text,
      jsonb_build_object('code', v.code, 'trip_id', t.id, 'version', v_pending.version, 'replaced_by_new_proposal', true));
  end if;
  if not v_needs then
    v_old := public.tk_supersede_trip_fee(t.id);
    v_doc := public.tk_issue_project_proforma(v.id, v.stage, public.tk_trip_label(t.id), 'tk_trip', p_amount_cents);
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.tk_trip_fees f where f.trip_id = t.id;
  insert into public.tk_trip_fees (trip_id, project_id, version, amount_cents, starting_cents, needs_approval, status, note, proposed_by, document_id, effective_from)
  values (t.id, v.id, v_ver, p_amount_cents, t.list_cents, v_needs, case when v_needs then 'pending_approval' else 'active' end, v_note, auth.uid(),
          v_doc, case when not v_needs then now() end)
  returning id into v_id;
  perform write_audit('turnkey.trip_fee_proposed', 'tk_trip_fees', v_id::text,
    jsonb_build_object('code', v.code, 'project_id', v.id, 'trip_id', t.id, 'version', v_ver, 'amount_cents', p_amount_cents, 'starting_cents', t.list_cents,
                       'needs_approval', v_needs, 'replaces_active', v_active.id));
  if not v_needs then
    perform public.tk_trip_fee_activated(v_id, v_old);
    return jsonb_build_object('id', v_id, 'status', 'active', 'needs_approval', false, 'document_id', v_doc);
  end if;
  return jsonb_build_object('id', v_id, 'status', 'pending_approval', 'needs_approval', true);
end $$;
revoke all on function public.tk_propose_trip_fee(uuid, bigint, text) from public, anon;
grant execute on function public.tk_propose_trip_fee(uuid, bigint, text) to authenticated, service_role;

-- an admin (2FA) who did not propose it approves or rejects a trip fee above 2x the list price
create or replace function public.tk_decide_trip_fee(p_fee uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_trip_fees;
  t public.tk_trips;
  v public.tk_client_projects;
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_doc uuid;
  v_old uuid;
begin
  if v_uid is null or not is_admin() then raise exception 'FORBIDDEN: only admins approve or reject fees'; end if;
  select * into f from public.tk_trip_fees where id = p_fee;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = f.project_id for update;
  select * into f from public.tk_trip_fees where id = p_fee for update;
  select * into t from public.tk_trips where id = f.trip_id for update;
  if f.status <> 'pending_approval' then raise exception 'FEE_NOT_PENDING: this fee was already decided'; end if;
  if not f.needs_approval then raise exception 'NO_APPROVAL_NEEDED: this fee is within 2x the list price'; end if;
  if p_decision = 'reject' then
    if v_reason is null then raise exception 'REASON_REQUIRED: tell the team why the fee is rejected'; end if;
    if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
    update public.tk_trip_fees set status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = v_reason where id = f.id;
    perform write_audit('turnkey.trip_fee_rejected', 'tk_trip_fees', f.id::text,
      jsonb_build_object('code', v.code, 'trip_id', t.id, 'version', f.version, 'amount_cents', f.amount_cents, 'reason', v_reason));
    return jsonb_build_object('status', 'rejected');
  elsif p_decision is distinct from 'approve' then
    raise exception 'INVALID_DECISION';
  end if;
  if f.proposed_by = v_uid then raise exception 'TWO_PERSON_REQUIRED: you can''t approve a fee you proposed'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: the project is not open'; end if;
  if t.status <> 'requested' then raise exception 'TRIP_NOT_REQUESTED: this trip is no longer waiting for its fee'; end if;
  v_old := public.tk_supersede_trip_fee(t.id);
  v_doc := public.tk_issue_project_proforma(v.id, v.stage, public.tk_trip_label(t.id), 'tk_trip', f.amount_cents);
  update public.tk_trip_fees set approved_by = v_uid, approved_at = now(), status = 'active', effective_from = now(), document_id = v_doc where id = f.id;
  perform write_audit('turnkey.trip_fee_approved', 'tk_trip_fees', f.id::text,
    jsonb_build_object('code', v.code, 'trip_id', t.id, 'version', f.version, 'amount_cents', f.amount_cents, 'starting_cents', f.starting_cents));
  perform public.tk_trip_fee_activated(f.id, v_old);
  return jsonb_build_object('status', 'active', 'document_id', v_doc);
end $$;
revoke all on function public.tk_decide_trip_fee(uuid, text, text) from public, anon;
grant execute on function public.tk_decide_trip_fee(uuid, text, text) to authenticated, service_role;

create or replace function public.tk_withdraw_trip_fee(p_fee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.tk_trip_fees;
  v public.tk_client_projects;
begin
  select * into f from public.tk_trip_fees where id = p_fee;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = f.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors withdraw fees'; end if;
  select * into f from public.tk_trip_fees where id = p_fee for update;
  if f.status <> 'pending_approval' then raise exception 'FEE_NOT_PENDING: this fee was already decided'; end if;
  update public.tk_trip_fees set status = 'withdrawn', withdrawn_at = now() where id = f.id;
  perform write_audit('turnkey.trip_fee_withdrawn', 'tk_trip_fees', f.id::text, jsonb_build_object('code', v.code, 'trip_id', f.trip_id, 'version', f.version));
end $$;
revoke all on function public.tk_withdraw_trip_fee(uuid) from public, anon;
grant execute on function public.tk_withdraw_trip_fee(uuid) to authenticated, service_role;

-- staff confirm (or update) the itinerary of a PAID trip; the guide and staff notes are staff-only
create or replace function public.tk_confirm_trip(p_trip uuid, p_itinerary text, p_guide_name text default null, p_staff_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tk_trips;
  v public.tk_client_projects;
  v_it text := nullif(btrim(coalesce(p_itinerary, '')), '');
  v_guide text := nullif(btrim(coalesce(p_guide_name, '')), '');
  v_notes text := nullif(btrim(coalesce(p_staff_notes, '')), '');
begin
  select * into t from public.tk_trips where id = p_trip;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = t.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors confirm trips'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  select * into t from public.tk_trips where id = p_trip for update;
  if t.status not in ('requested', 'confirmed') then raise exception 'TRIP_CLOSED: this trip is completed or cancelled'; end if;
  if not exists (select 1 from public.tk_trip_fees f where f.trip_id = t.id and f.status = 'active') then
    raise exception 'TRIP_FEE_NOT_SET: set the trip fee first (an admin approves fees above 2x the list price)';
  end if;
  if not exists (select 1 from public.tk_trip_fees f where f.trip_id = t.id and f.status = 'active' and public.tk_fee_is_paid(f.document_id)) then
    raise exception 'TRIP_NOT_PAID: the itinerary is confirmed after the client has paid the trip fee in full';
  end if;
  if v_it is null then raise exception 'ITINERARY_REQUIRED: write the itinerary the client sees'; end if;
  if length(v_it) > 4000 or length(coalesce(v_guide, '')) > 120 or length(coalesce(v_notes, '')) > 4000 then raise exception 'TOO_LONG: shorten the text'; end if;
  if public.tk_names_supplier(v.id, v_it) then raise exception 'SUPPLIER_NAME_SHOWN: the itinerary names a factory; describe visits without supplier names'; end if;
  update public.tk_trips set status = 'confirmed', itinerary = v_it, guide_name = v_guide, staff_notes = v_notes,
         confirmed_at = coalesce(confirmed_at, now()), confirmed_by = coalesce(confirmed_by, auth.uid()), updated_at = now()
   where id = t.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, message)
  values (v.id, 'trip', case when t.status = 'confirmed' then 'Your ' || public.tk_trip_label(t.id) || ': itinerary updated.'
                             else 'Your ' || public.tk_trip_label(t.id) || ' is confirmed. The itinerary is on your project page.' end);
  perform write_audit(case when t.status = 'confirmed' then 'turnkey.trip_itinerary_updated' else 'turnkey.trip_confirmed' end, 'tk_trips', t.id::text,
    jsonb_build_object('code', v.code, 'seq', t.seq, 'guide_name', v_guide));
end $$;
revoke all on function public.tk_confirm_trip(uuid, text, text, text) from public, anon;
grant execute on function public.tk_confirm_trip(uuid, text, text, text) to authenticated, service_role;

-- staff close a confirmed trip once it has started, with the trip report the client reads
create or replace function public.tk_complete_trip(p_trip uuid, p_report text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tk_trips;
  v public.tk_client_projects;
  v_rep text := nullif(btrim(coalesce(p_report, '')), '');
begin
  select * into t from public.tk_trips where id = p_trip;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = t.project_id for update;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors close trips'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: reopen the project first'; end if;
  select * into t from public.tk_trips where id = p_trip for update;
  if t.status <> 'confirmed' then raise exception 'TRIP_NOT_CONFIRMED: only a confirmed trip is closed'; end if;
  if current_date < t.start_on then raise exception 'TRIP_NOT_STARTED: the visit starts on %', to_char(t.start_on, 'FMDD Mon YYYY'); end if;
  if v_rep is not null and length(v_rep) > 4000 then raise exception 'TOO_LONG: shorten the report'; end if;
  if public.tk_names_supplier(v.id, v_rep) then raise exception 'SUPPLIER_NAME_SHOWN: the report names a factory; describe visits without supplier names'; end if;
  update public.tk_trips set status = 'completed', completed_at = now(), trip_report = v_rep, updated_at = now() where id = t.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, message)
  values (v.id, 'trip', 'Your ' || public.tk_trip_label(t.id) || ' is completed.' || case when v_rep is not null then ' The trip report is on your project page.' else '' end);
  perform write_audit('turnkey.trip_completed', 'tk_trips', t.id::text, jsonb_build_object('code', v.code, 'seq', t.seq));
end $$;
revoke all on function public.tk_complete_trip(uuid, text) from public, anon;
grant execute on function public.tk_complete_trip(uuid, text) to authenticated, service_role;

-- the client (before anything is paid) or a Turnkey editor cancels a trip; an unpaid fee proforma is voided (balanced)
create or replace function public.tk_cancel_trip(p_trip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tk_trips;
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_staff boolean;
  v_old uuid;
begin
  select * into t from public.tk_trips where id = p_trip;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = t.project_id for update;
  v_staff := public.tk_staff_can_edit(v.division_id);
  if not (v_staff or public.tk_is_project_customer(v.id)) then raise exception 'FORBIDDEN: only the client or Turnkey editors cancel a trip'; end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: this project is not open'; end if;
  select * into t from public.tk_trips where id = p_trip for update;
  if t.status not in ('requested', 'confirmed') then raise exception 'TRIP_CLOSED: this trip is completed or cancelled'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED: tell us why'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  if public.tk_names_supplier(v.id, v_reason) then raise exception 'SUPPLIER_NAME_SHOWN: the reason names a factory; clients deal only with Octopus'; end if;
  v_old := public.tk_supersede_trip_fee(t.id);   -- FEE_PAID_LOCKED when the client has paid towards it (refunds are not handled here)
  update public.tk_trip_fees set status = 'withdrawn', withdrawn_at = now() where trip_id = t.id and status = 'pending_approval';
  update public.tk_trips set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason, updated_at = now() where id = t.id;
  update public.tk_client_projects set updated_at = now() where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, message)
  values (v.id, 'trip', public.tk_trip_label(t.id) || ' was cancelled: ' || v_reason || case when v_old is not null then ' Its proforma was cancelled too.' else '' end);
  perform write_audit('turnkey.trip_cancelled', 'tk_trips', t.id::text, jsonb_build_object('code', v.code, 'seq', t.seq, 'by_staff', v_staff, 'reason', v_reason, 'fee_voided', v_old));
end $$;
revoke all on function public.tk_cancel_trip(uuid, text) from public, anon;
grant execute on function public.tk_cancel_trip(uuid, text) to authenticated, service_role;

-- the client registers a passport copy they have just uploaded to turnkey-passports/<project>/<trip>/<id>.<ext>
-- (id made in the browser, so a retried request registers once). The name is not written to the audit log.
create or replace function public.tk_add_trip_passport(p_id uuid, p_trip uuid, p_position integer, p_full_name text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tk_trips;
  v public.tk_client_projects;
  x public.tk_trip_travellers;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
  v_meta jsonb;
  v_mime text;
  v_size bigint;
begin
  select * into t from public.tk_trips where id = p_trip;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v from public.tk_client_projects where id = t.project_id for update;
  if not public.tk_is_project_customer(v.id) then raise exception 'FORBIDDEN: passport copies are uploaded by the client'; end if;
  select * into x from public.tk_trip_travellers where id = p_id;
  if x.id is not null then
    if x.trip_id = t.id and x.file_path = p_path then return jsonb_build_object('id', x.id, 'duplicate', true); end if;
    raise exception 'INVALID_FILE: upload the file again';
  end if;
  if v.status <> 'open' then raise exception 'PROJECT_NOT_OPEN: this project is not open'; end if;
  select * into t from public.tk_trips where id = p_trip for update;
  if t.status not in ('requested', 'confirmed') then raise exception 'TRIP_CLOSED: this trip is completed or cancelled'; end if;
  if p_position is null or p_position < 1 or p_position > t.travellers then raise exception 'INVALID_TRAVELLER: choose traveller 1 to %', t.travellers; end if;
  if exists (select 1 from public.tk_trip_travellers y where y.trip_id = t.id and y.position = p_position) then
    raise exception 'TRAVELLER_DONE: delete the earlier copy for traveller % first', p_position;
  end if;
  if v_name is null or length(v_name) < 2 or length(v_name) > 120 then raise exception 'NAME_REQUIRED: type the name as in the passport'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v.id::text or split_part(p_path, '/', 2) <> t.id::text
     or split_part(p_path, '/', 3) !~ ('^' || p_id::text || '\.(pdf|jpg|jpeg|png|webp)$') or split_part(p_path, '/', 4) <> '' then
    raise exception 'INVALID_FILE: upload the file again';
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'turnkey-passports' and o.name = p_path;
  if not found then raise exception 'FILE_NOT_UPLOADED: upload the file first'; end if;
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'INVALID_FILE_TYPE: upload a PDF, JPG, PNG or WEBP file'; end if;
  if v_size is null or v_size <= 0 or v_size > 10485760 then raise exception 'INVALID_FILE_SIZE: files can be up to 10 MB'; end if;
  insert into public.tk_trip_travellers (id, trip_id, project_id, position, full_name, file_path, mime_type, size_bytes, uploaded_by)
  values (p_id, t.id, v.id, p_position, v_name, p_path, v_mime, v_size, auth.uid());
  perform write_audit('turnkey.passport_added', 'tk_trips', t.id::text, jsonb_build_object('code', v.code, 'traveller_id', p_id, 'position', p_position, 'mime_type', v_mime));
  return jsonb_build_object('id', p_id, 'duplicate', false);
end $$;
revoke all on function public.tk_add_trip_passport(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.tk_add_trip_passport(uuid, uuid, integer, text, text) to authenticated, service_role;

-- delete on request: the client or Turnkey staff with a need. Returns the file path; the app removes the file right away
-- (storage policy: an unregistered file of the project, by the client or staff with a need)
create or replace function public.tk_delete_trip_passport(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.tk_trip_travellers;
  v_staff boolean;
begin
  select * into x from public.tk_trip_travellers where id = p_id;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  v_staff := public.tk_passport_staff_ok(x.project_id);
  if not (v_staff or public.tk_is_project_customer(x.project_id)) then raise exception 'NOT_FOUND'; end if;
  delete from public.tk_trip_travellers where id = x.id;
  perform write_audit('turnkey.passport_deleted', 'tk_trips', x.trip_id::text, jsonb_build_object('project_id', x.project_id, 'traveller_id', x.id, 'position', x.position, 'by_staff', v_staff));
  return x.file_path;
end $$;
revoke all on function public.tk_delete_trip_passport(uuid) from public, anon;
grant execute on function public.tk_delete_trip_passport(uuid) to authenticated, service_role;

-- retention: passport copies of trips that ended (completed / cancelled, or past their last day) more than p_days ago are
-- deleted; returns their file paths for the scheduled job (service role) that removes the files. Not for users.
create or replace function public.tk_purge_trip_passports(p_days integer default 30)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_days is null or p_days < 0 then raise exception 'INVALID_DAYS'; end if;
  return query
    with gone as (
      delete from public.tk_trip_travellers x
       using public.tk_trips t
       where t.id = x.trip_id
         and (coalesce(t.completed_at, t.cancelled_at) < now() - make_interval(days => p_days) or t.end_on < current_date - p_days)
       returning x.file_path)
    select file_path from gone;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform write_audit('turnkey.passports_purged', 'tk_trip_travellers', null, jsonb_build_object('count', v_n, 'days', p_days)); end if;
end $$;
revoke all on function public.tk_purge_trip_passports(integer) from public, anon, authenticated;
grant execute on function public.tk_purge_trip_passports(integer) to service_role;

-- ───────── 13. staff reads ─────────
create or replace function public.tk_staff_shipping(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'balance_state', public.tk_balance_state(p_project),
    'balance', (select jsonb_build_object('id', b.id, 'quote_id', b.quote_id, 'quote_version', q.version, 'total_cents', b.total_cents, 'deposit_cents', b.deposit_cents,
        'amount_cents', b.amount_cents, 'document_id', b.document_id, 'document_number', d.number, 'document_status', d.status, 'paid_cents', d.paid_cents,
        'paid', public.tk_fee_is_paid(b.document_id), 'issued_by_name', coalesce(nullif(btrim(pi.full_name), ''), pi.email), 'created_at', b.created_at)
      from public.tk_quote_balances b join public.tk_client_quotes q on q.id = b.quote_id left join public.documents d on d.id = b.document_id
      left join public.profiles pi on pi.id = b.issued_by where b.project_id = p_project),
    'shipments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'mode', s.mode, 'carrier', s.carrier, 'booking_ref', s.booking_ref,
        'container_no', s.container_no, 'tracking_no', s.tracking_no, 'origin', s.origin, 'destination', s.destination, 'etd', s.etd, 'eta', s.eta, 'status', s.status,
        'delivered_at', s.delivered_at, 'cancelled_at', s.cancelled_at, 'cancel_reason', s.cancel_reason, 'staff_note', s.staff_note, 'created_at', s.created_at,
        'created_by_name', coalesce(nullif(btrim(pc.full_name), ''), pc.email),
        'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'happened_at', e.happened_at, 'status_to', e.status_to, 'location', e.location,
            'description', e.description, 'created_at', e.created_at, 'created_by_name', coalesce(nullif(btrim(pe.full_name), ''), pe.email)) order by e.happened_at desc, e.id desc)
          from public.tk_shipment_events e left join public.profiles pe on pe.id = e.created_by where e.shipment_id = s.id), '[]'::jsonb)) order by s.seq)
      from public.tk_shipments s left join public.profiles pc on pc.id = s.created_by where s.project_id = p_project), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'section', d.section, 'shipment_id', d.shipment_id, 'kind', d.kind, 'title', d.title,
        'file_path', d.file_path, 'file_name', d.file_name, 'mime_type', d.mime_type, 'size_bytes', d.size_bytes, 'status', d.status, 'released_at', d.released_at,
        'withdrawn_at', d.withdrawn_at, 'withdraw_reason', d.withdraw_reason, 'created_at', d.created_at,
        'uploaded_by_name', coalesce(nullif(btrim(pu.full_name), ''), pu.email)) order by d.section, d.created_at)
      from public.tk_project_documents d left join public.profiles pu on pu.id = d.uploaded_by where d.project_id = p_project), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'position', i.position, 'label', i.label, 'document_id', i.document_id, 'done_at', i.done_at,
        'done_by_name', coalesce(nullif(btrim(pd.full_name), ''), pd.email), 'created_at', i.created_at) order by i.position)
      from public.tk_handover_items i left join public.profiles pd on pd.id = i.done_by where i.project_id = p_project), '[]'::jsonb),
    'signoff', (select jsonb_build_object('signed_name', so.signed_name, 'client_comment', so.client_comment, 'items_count', so.items_count, 'signed_at', so.signed_at,
        'signed_by_email', ps.email)
      from public.tk_handover_signoffs so left join public.profiles ps on ps.id = so.signed_by where so.project_id = p_project));
end $$;
revoke all on function public.tk_staff_shipping(uuid) from public, anon;
grant execute on function public.tk_staff_shipping(uuid) to authenticated, service_role;

-- staff view of the trips: fees with who / when, guide and notes; passport copies only for staff with a need
create or replace function public.tk_staff_trips(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pass boolean;
begin
  if not public.tk_staff_can_view(p_project) then raise exception 'FORBIDDEN'; end if;
  v_pass := public.tk_passport_staff_ok(p_project);
  return jsonb_build_object(
    'passport_access', v_pass,
    'trips', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'seq', t.seq, 'start_on', t.start_on, 'end_on', t.end_on, 'days', t.days, 'travellers', t.travellers,
        'visa_letters', t.visa_letters, 'car_days', t.car_days, 'airport_pickups', t.airport_pickups, 'hotel_help', t.hotel_help, 'client_message', t.client_message,
        'day_cents', t.day_cents, 'included_travellers', t.included_travellers, 'extra_traveller_day_cents', t.extra_traveller_day_cents, 'visa_letter_cents', t.visa_letter_cents,
        'car_day_cents', t.car_day_cents, 'airport_pickup_cents', t.airport_pickup_cents, 'hotel_help_cents', t.hotel_help_cents, 'list_cents', t.list_cents,
        'status', t.status, 'itinerary', t.itinerary, 'trip_report', t.trip_report, 'confirmed_at', t.confirmed_at, 'completed_at', t.completed_at,
        'cancelled_at', t.cancelled_at, 'cancel_reason', t.cancel_reason, 'guide_name', t.guide_name, 'staff_notes', t.staff_notes, 'created_at', t.created_at,
        'requested_by_name', coalesce(nullif(btrim(pr.full_name), ''), pr.email), 'confirmed_by_name', coalesce(nullif(btrim(pk.full_name), ''), pk.email),
        'paid', exists (select 1 from public.tk_trip_fees f where f.trip_id = t.id and f.status = 'active' and public.tk_fee_is_paid(f.document_id)),
        'fees', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'version', f.version, 'amount_cents', f.amount_cents, 'starting_cents', f.starting_cents,
            'needs_approval', f.needs_approval, 'status', f.status, 'note', f.note, 'proposed_by', f.proposed_by, 'proposed_by_name', coalesce(nullif(btrim(fp.full_name), ''), fp.email),
            'proposed_at', f.proposed_at, 'approved_by_name', coalesce(nullif(btrim(fa.full_name), ''), fa.email), 'approved_at', f.approved_at,
            'rejected_by_name', coalesce(nullif(btrim(fr.full_name), ''), fr.email), 'rejected_at', f.rejected_at, 'reject_reason', f.reject_reason,
            'withdrawn_at', f.withdrawn_at, 'document_id', f.document_id, 'document_number', d.number, 'document_status', d.status, 'paid_cents', d.paid_cents,
            'paid', public.tk_fee_is_paid(f.document_id)) order by f.version desc)
          from public.tk_trip_fees f left join public.documents d on d.id = f.document_id
          left join public.profiles fp on fp.id = f.proposed_by left join public.profiles fa on fa.id = f.approved_by left join public.profiles fr on fr.id = f.rejected_by
          where f.trip_id = t.id), '[]'::jsonb),
        'passports_count', (select count(*) from public.tk_trip_travellers x where x.trip_id = t.id),
        'passports', case when v_pass then coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'position', x.position, 'full_name', x.full_name, 'file_path', x.file_path,
            'mime_type', x.mime_type, 'size_bytes', x.size_bytes, 'created_at', x.created_at) order by x.position)
          from public.tk_trip_travellers x where x.trip_id = t.id), '[]'::jsonb) end) order by t.seq desc)
      from public.tk_trips t left join public.profiles pr on pr.id = t.requested_by left join public.profiles pk on pk.id = t.confirmed_by
     where t.project_id = p_project), '[]'::jsonb));
end $$;
revoke all on function public.tk_staff_trips(uuid) from public, anon;
grant execute on function public.tk_staff_trips(uuid) to authenticated, service_role;

-- admin queue: trip fees above 2x the list price waiting for approval
create or replace function public.tk_list_trip_fee_approvals()
returns table (
  id uuid, project_code text, project_title text, client_name text, trip_label text, version integer, amount_cents bigint, starting_cents bigint,
  note text, proposed_by uuid, proposed_by_name text, proposed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN: admins only'; end if;
  return query
    select f.id, p.code, p.title, o.name, public.tk_trip_label(f.trip_id), f.version, f.amount_cents, f.starting_cents, f.note, f.proposed_by,
           coalesce(nullif(btrim(pp.full_name), ''), pp.email), f.proposed_at
      from public.tk_trip_fees f
      join public.tk_client_projects p on p.id = f.project_id
      left join public.organizations o on o.id = p.org_id
      left join public.profiles pp on pp.id = f.proposed_by
     where f.status = 'pending_approval' and f.needs_approval
     order by f.proposed_at;
end $$;
revoke all on function public.tk_list_trip_fee_approvals() from public, anon;
grant execute on function public.tk_list_trip_fee_approvals() to authenticated, service_role;

-- ───────── 14. phase gate (T5 function; Shipment starts after the balance is paid; Handover after every shipment is delivered) ─────────
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
  v_bal text;
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
    -- T6: Shipment starts after the balance of the accepted quote (total − deposit) is invoiced and fully paid
    v_bal := public.tk_balance_state(v.id);
    if v_bal = 'no_quote' then
      raise exception 'QUOTE_NOT_ACCEPTED: Shipment starts after the client has accepted a quote and paid its balance';
    end if;
    if v_bal = 'not_invoiced' then
      raise exception 'BALANCE_NOT_INVOICED: Shipment starts after the balance invoice is issued and paid';
    end if;
    if v_bal = 'unpaid' then
      raise exception 'BALANCE_NOT_PAID: Shipment starts after the client has paid the balance in full';
    end if;
  end if;
  -- T6: Shipment is complete when every shipment (at least one) is delivered
  if v_to > v_from and v.stage = 'shipment' then
    if not exists (select 1 from public.tk_shipments s where s.project_id = v.id and s.status <> 'cancelled') then
      raise exception 'SHIPMENT_REQUIRED: Shipment is complete when the goods are booked, shipped and delivered';
    end if;
    if exists (select 1 from public.tk_shipments s where s.project_id = v.id and s.status not in ('delivered', 'cancelled')) then
      raise exception 'SHIPMENT_NOT_DELIVERED: Shipment is complete when every shipment is delivered';
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
revoke all on function public.tk_move_project_stage(uuid, text, text) from public, anon;
grant execute on function public.tk_move_project_stage(uuid, text, text) to authenticated, service_role;

-- ───────── 15. status (T2 function): completed only through the client's handover sign-off; a completed project stays closed ─────────
create or replace function public.tk_set_project_status(p_project uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.tk_client_projects;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from public.tk_client_projects where id = p_project for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.tk_staff_can_edit(v.division_id) then raise exception 'FORBIDDEN: only Turnkey editors change projects'; end if;
  if p_status not in ('open', 'on_hold', 'completed', 'cancelled') then raise exception 'INVALID_STATUS'; end if;
  if p_status = v.status then raise exception 'SAME_STATUS: the project already has this status'; end if;
  -- T6: the client's handover sign-off completes a project; after that nothing changes (documents: admins only)
  if v.status = 'completed' then raise exception 'PROJECT_COMPLETED: the client signed off this project; it stays completed'; end if;
  if p_status = 'completed' then
    if v.stage <> 'handover' then raise exception 'NOT_AT_HANDOVER: a project is completed at Handover'; end if;
    raise exception 'SIGN_OFF_REQUIRED: a project is completed when the client signs the handover on their project page';
  end if;
  if p_status in ('on_hold', 'cancelled') and v_reason is null then raise exception 'REASON_REQUIRED: tell the client why'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'REASON_TOO_LONG: keep the reason under 500 characters'; end if;
  update public.tk_client_projects
     set status = p_status, status_reason = case when p_status in ('on_hold', 'cancelled') then v_reason end, updated_at = now()
   where id = v.id;
  insert into public.tk_client_project_events (project_id, kind, status, message) values (v.id, 'status', p_status, v_reason);
  perform write_audit('turnkey.project_status', 'tk_client_projects', v.id::text,
    jsonb_build_object('code', v.code, 'from', v.status, 'to', p_status, 'reason', v_reason));
end $$;
revoke all on function public.tk_set_project_status(uuid, text, text) from public, anon;
grant execute on function public.tk_set_project_status(uuid, text, text) to authenticated, service_role;

-- ───────── 16. demo wipe (staging only): demo / test companies' Turnkey projects before their documents ─────────
CREATE OR REPLACE FUNCTION public.wipe_demo_data(p_confirm text, p_operator uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_ref text := 'ydbxqrizjxpduqbgnwxg';                     -- the STAGING project (19 Nov 2026: staging only)
  v_counts jsonb := '{}';
  v_users uuid[];
  n bigint;
  fk record;
  s record;
  v_bad text := '';
  v_real_wallets jsonb;
  v_kept uuid[];
begin
  if p_confirm is distinct from 'DELETE DEMO DATA FOR ' || v_ref then
    raise exception 'WIPE_REFUSED: type exactly "DELETE DEMO DATA FOR %"', v_ref using errcode = 'P0001';
  end if;
  -- staging only (19 Nov 2026): refuse on any database not marked staging (live is 'production')
  if coalesce((select value #>> '{}' from site_settings where key = 'app_environment'), '') <> 'staging' then
    raise exception 'WIPE_REFUSED: demo data can only be wiped on the staging project' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('wipe_demo_data'));
  perform tag_seed_rows();   -- pick up anything created on demo rows since the migration
  -- real (not demo/test) customers' wallet balances, to prove the wipe did not change them
  select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') into v_real_wallets
    from wallets w join organizations o on o.id = w.org_id where not o.is_seed;

  -- demo staff + demo buyer (admin@demo.octopusb2b.com is KEPT until the owner creates a real admin — owner decision)
  select coalesce(array_agg(id), '{}') into v_users from auth.users
   where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com';
  -- (Batch 3) demo users who proposed or approved a fee schedule stay: fee_versions is an append-only, two-person
  -- approval history (migration 211) — nulling approved_by or deleting the row is refused by guard_fee_versions().
  select coalesce(array_agg(u), '{}') into v_kept from unnest(v_users) u
   where exists (select 1 from fee_versions f where f.proposed_by = u or f.approved_by = u)
      -- (migration 236) the stock ledger is append-only too: people who reserved, picked or moved stock stay (actor_id)
      or exists (select 1 from warehouse_stock_movements m where m.actor_id = u);
  v_users := array(select u from unnest(v_users) u where u <> all (v_kept));

  -- references to those users that don't cascade: null them (or drop the row when the column is NOT NULL)
  for fk in
    select conrelid::regclass::text tbl, a.attname col, a.attnotnull nn
      from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.confdeltype in ('a', 'r')
       and k.connamespace = 'public'::regnamespace
       and k.conrelid <> 'public.fee_versions'::regclass
  loop
    if fk.nn then execute format('delete from %s where %I = any($1)', fk.tbl, fk.col) using v_users;
    else execute format('update %s set %I = null where %I = any($1)', fk.tbl, fk.col, fk.col) using v_users; end if;
  end loop;

  -- seed rows, children before parents. Every FK into these tables is NO ACTION, so links from rows that stay
  -- (or that are deleted later in this list) are cleared first.
  update finance_approvals set executed_journal_id = null where executed_journal_id in (select id from journals where is_seed);
  delete from finance_approvals where order_id in (select id from orders where is_seed)
     or org_id in (select id from organizations where is_seed) or supplier_id in (select id from suppliers where is_seed);
  delete from ledger_entries where is_seed;                   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_entries', n);
  delete from journals where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journals', n);
  delete from assistant_messages where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_messages', n);
  delete from assistant_sessions where is_seed;               get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('assistant_sessions', n);
  delete from ad_campaigns where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ad_campaigns', n);
  update escalations set ticket_id = null where ticket_id in (select id from tickets where is_seed);
  delete from tickets where is_seed;                          get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tickets', n);
  delete from shipments where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('shipments', n);
  delete from wallet_topups where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_topups', n);
  update wallet_topups set payment_id = null where payment_id in (select id from payments where is_seed);
  delete from payments where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('payments', n);
  -- Turnkey T2–T6 client projects of demo / test companies (migration T6: moved before documents — their fee, deposit,
  -- balance, inspection and trip proformas point at documents with FK restrict; those rows go with the project)
  delete from tk_client_projects p where p.org_id in (select id from organizations where is_seed)
     or exists (select 1 from tk_client_project_staff tps where tps.project_id = p.id and tps.is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tk_client_projects', n);
  delete from documents where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('documents', n);
  delete from proforma_invoices where is_seed;                get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('proforma_invoices', n);
  update orders set pool_pledge_id = null where pool_pledge_id in (select id from pool_pledges where is_seed);
  update pool_pledges set order_id = null where order_id in (select id from orders where is_seed);
  delete from pool_pledges where is_seed;                     get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pool_pledges', n);
  delete from orders where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders', n);
  delete from quotes where is_seed;                           get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('quotes', n);
  delete from rfqs where is_seed;                             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('rfqs', n);
  delete from service_requests where is_seed;                 get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('service_requests', n);
  delete from pools where is_seed;                            get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pools', n);
  update import_rows set product_id = null where product_id in (select id from products where is_seed);
  delete from products where is_seed;                         get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('products', n);
  update import_jobs set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  update payouts set supplier_id = null where supplier_id in (select id from suppliers where is_seed);
  delete from suppliers where is_seed;                        get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', n);
  -- Warehouse OS W1–W2b rows of demo / test companies (migration 230; Turnkey projects go before documents since T6); stock movements are never deleted
  delete from wh_clients where org_id in (select id from organizations where is_seed);
  -- Warehouse OS W3a (migration W3a): warehouse orders of demo / test companies (and Dropship orders of their store orders) —
  -- lines, picks, scans, photo records and override attempts go with them — before their lots (pick records point at lots).
  -- Stock movements are never deleted (their wh_order_id has no foreign key); packing photos stay in storage until the
  -- retention job (W6) removes them.
  delete from wh_orders where org_id in (select id from organizations where is_seed)
     or store_order_id in (select so.id from store_orders so where so.org_id in (select id from organizations where is_seed));
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_orders', n);
  delete from wh_location_moves where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_transfer_picks where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  delete from wh_bin_stock where lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed))
     or pallet_id in (select id from wh_pallets where org_id in (select id from organizations where is_seed));
  update wh_transfer_lines set dest_lot_id = null where dest_lot_id in (select id from wh_lots where org_id in (select id from organizations where is_seed));
  delete from wh_pallets where org_id in (select id from organizations where is_seed);
  delete from wh_lots where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_lots', n);
  delete from wh_asns where org_id in (select id from organizations where is_seed);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wh_asns', n);
  delete from wh_client_skus where org_id in (select id from organizations where is_seed);
  delete from wallet_withdrawals where org_id in (select id from organizations where is_seed);
  -- wallet holds of demo / test companies (added by migration 177 after this function was written)
  delete from wallet_holds where org_id in (select id from organizations where is_seed);   get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('wallet_holds', n);
  delete from ledger_accounts where org_id in (select id from organizations where is_seed);
  delete from organizations where is_seed;                    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('organizations', n);
  delete from auth.users where id = any(v_users);             get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('demo_users', n);
  v_counts := v_counts || jsonb_build_object('demo_users_kept_fee_history', coalesce(array_length(v_kept, 1), 0));

  -- (19 Nov 2026) real customers' notifications are no longer touched: the wipe deletes only rows marked as demo/test

  -- human codes restart at 1001 (or after the highest code that still exists)
  for s in select * from (values
      ('seq_supplier_code', 'suppliers', 'code', '^OCT-(\d+)$'),
      ('seq_rfq', 'rfqs', 'code', '^RFQ-(\d+)$'),
      ('seq_order', 'orders', 'code', '^ORD-(\d+)$'),
      ('seq_shipment', 'shipments', 'code', '^SHP-(\d+)$'),
      ('seq_ticket', 'tickets', 'code', '^TKT-(\d+)$'),
      ('seq_pool', 'pools', 'code', '^POOL-(\d+)$'),
      ('seq_service_request', 'service_requests', 'code', '^SRV-(\d+)$'),
      ('seq_export', 'data_exports', 'code', '^EX-(\d+)$'),
      ('seq_restore', 'restore_requests', 'code', '^RS-(\d+)$'),
      ('seq_journal', 'journals', 'number', '^JRN-(\d+)$'),
      ('seq_pi', 'proforma_invoices', 'number', '^PI-\d{4}-(\d+)$'),
      ('seq_invoice', 'documents', 'number', '^INV-\d{4}-(\d+)$'),
      ('seq_quote', 'quotes', 'code', '^QT-(\d+)$'),
      ('seq_buyer_code', 'organizations', 'buyer_code', '^BUYER-(\d+)$')
    ) v(seq, tbl, col, rx)
  loop
    if to_regclass('public.' || s.seq) is null then continue; end if;
    execute format('select coalesce(max((substring(%I from %L))::bigint), 0) from %I', s.col, s.rx, s.tbl) into n;
    perform setval(s.seq, greatest(1000, n), true);
  end loop;

  -- launch defaults (audit C3 / K7)
  update site_settings set value = jsonb_set(coalesce(value, '{}'), '{amount_minor}', '0') || '{"verified_only": true}'::jsonb, updated_at = now()
   where key = 'wallet_credit_default';
  update site_settings set value = 'false'::jsonb, updated_at = now() where key = 'supplier_portal_enabled';
  update site_settings set value = 'true'::jsonb, updated_at = now() where key = 'pool_enabled';
  -- category names: capitalise the first letter of hand-typed lowercase names ("kitchen utensils" → "Kitchen utensils")
  update categories set name = upper(left(name, 1)) || substr(name, 2) where name ~ '^[a-z]';

  -- verify
  select string_agg(t, ', ') into v_bad from (
    select 'organizations' t where exists (select 1 from organizations where is_seed) union all
    select 'suppliers' where exists (select 1 from suppliers where is_seed) union all
    select 'products' where exists (select 1 from products where is_seed) union all
    select 'orders' where exists (select 1 from orders where is_seed) union all
    select 'journals' where exists (select 1 from journals where is_seed) union all
    select 'ledger_entries' where exists (select 1 from ledger_entries where is_seed) union all
    select 'pools' where exists (select 1 from pools where is_seed) union all
    select 'demo users' where exists (select 1 from auth.users where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com' and id <> all (v_kept)) union all
    select 'ledger not balanced' where coalesce((select sum(debit_cents - credit_cents) from ledger_entries), 0) <> 0 union all
    -- 19 Nov 2026: real customers may hold money (e.g. on staging); the check is that their balances did not change
    select 'real wallet balance changed' where v_real_wallets is distinct from
      (select coalesce(jsonb_object_agg(w.account_id, w.balance_minor), '{}') from wallets w join organizations o on o.id = w.org_id where not o.is_seed) union all
    select 'open pools' where exists (select 1 from pools where status in ('open', 'locked'))) x;
  if v_bad is not null then raise exception 'WIPE_VERIFY_FAILED: %', v_bad; end if;

  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (p_operator, 'demo_data_wiped', 'database', v_ref, jsonb_build_object('counts', v_counts, 'at', now()));
  insert into site_settings(key, value, description) values ('demo_wipe',
      jsonb_build_object('at', now(), 'by', p_operator, 'by_name', (select full_name from profiles where id = p_operator), 'counts', v_counts),
      'When the demo dataset was removed (ADDON-24). Drives the one-time "Add your first supplier" banner on /admin.')
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_counts;
end $function$;
