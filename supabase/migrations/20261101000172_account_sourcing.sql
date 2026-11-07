-- Account › Product sourcing (owner, 7 Nov 2026).
-- · quotes get MOQ and sample price (send_quote takes them; older quotes stay null → shown as "—")
-- · request_messages: one thread per sourcing / service request between the customer and the sourcing team (post via RPC)
-- · request_files: photos, specs, invoices attached to a request (private bucket "request-files"; rows via RPC)
-- · mark_quotes_viewed(): opening a request marks its new quotes as viewed (drives the "new quotes" badge)
-- · events for notifications: rfq.reviewed (submitted → assigned / quoting) and request.message (in-app + email via outbox)
-- RLS: a customer only sees their own organisation's requests, quotes, messages and files; staff with requests.view see all.

alter table quotes add column if not exists moq integer check (moq is null or moq > 0);
alter table quotes add column if not exists sample_price_cents bigint check (sample_price_cents is null or sample_price_cents >= 0);

drop function if exists send_quote(uuid, uuid, bigint, integer, text, integer, bigint, text);
create or replace function send_quote(p_rfq uuid, p_supplier uuid, p_unit_price_cents bigint, p_quantity integer, p_incoterm text, p_lead_days integer,
  p_shipping_cents bigint default 0, p_notes text default null, p_moq integer default null, p_sample_price_cents bigint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; v_id uuid; v_n int; v_validity int := coalesce((setting('quote_validity_days'))::text::int, 30);
begin
  if not (can('requests','create') or is_my_supplier(p_supplier)) then raise exception 'FORBIDDEN'; end if;
  if has_role('distributor') and not is_admin() and not is_my_supplier(p_supplier) then raise exception 'FORBIDDEN_SUPPLIER'; end if;
  if not coalesce((select rfq_replies from supplier_switches where supplier_id = p_supplier), true) then raise exception 'SUPPLIER_RFQ_REPLIES_OFF'; end if;
  select * into r from rfqs where id = p_rfq for update;
  if r.status not in ('submitted','assigned','quoting','quoted') then raise exception 'RFQ_NOT_OPEN: %', r.status; end if;
  select count(*) + 1 into v_n from quotes where rfq_id = p_rfq;
  insert into quotes(code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until,
                     created_by, currency, fx_rate_id, moq, sample_price_cents)
    values ('QT-' || replace(r.code,'RFQ-','') || '-' || v_n, p_rfq, p_supplier, p_unit_price_cents, p_quantity, p_incoterm, p_lead_days,
            coalesce(p_shipping_cents,0), p_notes, 'sent', now() + make_interval(days => v_validity), auth.uid(),
            current_platform_currency(), current_fx_rate_id(), p_moq, p_sample_price_cents)
    returning id into v_id;
  update rfqs set status = 'quoted' where id = p_rfq;
  perform log_status('rfq', p_rfq, r.status::text, 'quoted');
  perform emit_event('quote.sent', 'quote', v_id, jsonb_build_object('org_id', r.org_id, 'rfq_id', p_rfq, 'rfq_code', r.code));
  return v_id;
end $$;
grant execute on function send_quote(uuid, uuid, bigint, integer, text, integer, bigint, text, integer, bigint) to authenticated;

-- access helper: can the caller see this request? (customer of the org, or staff)
create or replace function request_visible(p_kind text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'rfq' then exists (select 1 from rfqs where id = p_id and (org_id in (select my_org_ids()) or can('requests', 'view')))
    when 'service' then exists (select 1 from service_requests where id = p_id and (org_id in (select my_org_ids()) or can('requests', 'view') or can('services_ops', 'view')))
    else false end;
$$;
grant execute on function request_visible(text, uuid) to authenticated;

create table if not exists request_messages (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid references rfqs(id) on delete cascade,
  service_request_id uuid references service_requests(id) on delete cascade,
  author_id uuid,
  from_staff boolean not null default false,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  check (num_nonnulls(rfq_id, service_request_id) = 1)
);
create index if not exists request_messages_rfq on request_messages(rfq_id, created_at);
create index if not exists request_messages_sr on request_messages(service_request_id, created_at);
alter table request_messages enable row level security;
drop policy if exists request_messages_read on request_messages;
create policy request_messages_read on request_messages for select using (
  (rfq_id is not null and request_visible('rfq', rfq_id)) or (service_request_id is not null and request_visible('service', service_request_id)));

create table if not exists request_files (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid references rfqs(id) on delete cascade,
  service_request_id uuid references service_requests(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  file_kind text not null default 'other' check (file_kind in ('photo', 'spec', 'invoice', 'other')),
  size_bytes bigint,
  uploaded_by uuid,
  from_staff boolean not null default false,
  created_at timestamptz not null default now(),
  check (num_nonnulls(rfq_id, service_request_id) = 1)
);
alter table request_files enable row level security;
drop policy if exists request_files_read on request_files;
create policy request_files_read on request_files for select using (
  (rfq_id is not null and request_visible('rfq', rfq_id)) or (service_request_id is not null and request_visible('service', service_request_id)));

insert into storage.buckets(id, name, public, file_size_limit) values ('request-files', 'request-files', false, 20971520)
  on conflict (id) do nothing;

-- post a message (customer or staff); notifies the other side
create or replace function post_request_message(p_kind text, p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text; v_staff boolean; v_member boolean; v_id uuid; v_assigned uuid;
begin
  if p_kind = 'rfq' then select org_id, code, assigned_to into v_org, v_code, v_assigned from rfqs where id = p_id;
  elsif p_kind = 'service' then select org_id, code, assigned_to into v_org, v_code, v_assigned from service_requests where id = p_id;
  else raise exception 'BAD_KIND'; end if;
  if v_org is null then raise exception 'NOT_FOUND'; end if;
  v_member := v_org in (select my_org_ids());
  v_staff := can('requests', 'edit') or (p_kind = 'service' and can('services_ops', 'edit'));
  if not (v_member or v_staff) then raise exception 'NOT_FOUND'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'EMPTY_MESSAGE'; end if;
  insert into request_messages(rfq_id, service_request_id, author_id, from_staff, body)
    values (case when p_kind = 'rfq' then p_id end, case when p_kind = 'service' then p_id end, auth.uid(), v_staff and not v_member, left(btrim(p_body), 4000))
    returning id into v_id;
  perform emit_event('request.message', p_kind, p_id, jsonb_build_object('org_id', v_org, 'code', v_code, 'kind', p_kind, 'from_staff', v_staff and not v_member));
  -- the customer asked: tell the assigned sourcing lead in-app
  if v_member and not v_staff and v_assigned is not null then
    insert into notifications(user_id, title, body, link)
      values (v_assigned, 'Customer question on ' || v_code, left(btrim(p_body), 140), case when p_kind = 'rfq' then '/office/rfqs/' || p_id else '/office/services/' || p_id end);
  end if;
  return v_id;
end $$;
grant execute on function post_request_message(text, uuid, text) to authenticated;

-- register an uploaded file (the app uploads to storage after this check passes)
create or replace function add_request_file(p_kind text, p_id uuid, p_path text, p_name text, p_file_kind text, p_size bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_member boolean;
begin
  if p_kind = 'rfq' then select org_id into v_org from rfqs where id = p_id;
  elsif p_kind = 'service' then select org_id into v_org from service_requests where id = p_id; end if;
  if v_org is null or not request_visible(p_kind, p_id) then raise exception 'NOT_FOUND'; end if;
  v_member := v_org in (select my_org_ids());
  if p_path !~ ('^' || p_kind || '/' || p_id::text || '/') then raise exception 'BAD_PATH'; end if;
  insert into request_files(rfq_id, service_request_id, storage_path, file_name, file_kind, size_bytes, uploaded_by, from_staff)
    values (case when p_kind = 'rfq' then p_id end, case when p_kind = 'service' then p_id end, p_path, left(p_name, 200),
            coalesce(nullif(p_file_kind, ''), 'other'), p_size, auth.uid(), not v_member)
    returning id into v_id;
  return v_id;
end $$;
grant execute on function add_request_file(text, uuid, text, text, text, bigint) to authenticated;

-- opening a request marks its new quotes as viewed (customer only)
create or replace function mark_quotes_viewed(p_rfq uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from rfqs where id = p_rfq and org_id in (select my_org_ids())) then return 0; end if;
  update quotes set status = 'viewed' where rfq_id = p_rfq and status = 'sent';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function mark_quotes_viewed(uuid) to authenticated;

-- "your request is being reviewed" when staff pick it up
create or replace function rfq_reviewed_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'submitted' and new.status in ('assigned', 'quoting') then
    perform emit_event('rfq.reviewed', 'rfq', new.id, jsonb_build_object('org_id', new.org_id, 'code', new.code, 'to', new.status));
  end if;
  return new;
end $$;
drop trigger if exists trg_rfq_reviewed on rfqs;
create trigger trg_rfq_reviewed after update of status on rfqs for each row execute function rfq_reviewed_event();

