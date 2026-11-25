-- 20261101000220_batch3_status_labels_quotes_requests.sql
-- Phase 2 · Batch 3 database changes (Sourcing & Dropshipping only):
--  B3-2 (F-09) get_status_labels(domain): customer/merchant-safe labels from status_mappings (no staff stages).
--  B3-3 (F-11) reject_quote(quote, reason): a customer declines a Sourcing quote (quote status only — no money moves).
--  B3-5 (F-07) set_dropship_request_landed_quote(): Dropship-only staff no longer hit FORBIDDEN_DIVISION (the request's
--              rfq lives in SRC); only real Dropship product requests in an open status can be quoted; read-only
--              company-wide roles (support) can no longer quote (needs DS edit or SRC requests:edit).
--              list_dropship_product_requests(): staff list for the new "Product requests" panel in /office/dropship.
--  B3-6 (F-10) division_of_notification(): service-request links use SRV- codes (kept 'SR-' for old links).
--  B3-7 (F-16) Factory audit as its own request type: services row 'factory_audit' (SRC division) + a price row.
-- Down: supabase/migrations/down/20261101000220_batch3_status_labels_quotes_requests.down.sql

-- ───────── B3-2: customer/merchant-safe status labels ─────────
create or replace function public.get_status_labels(p_domain text)
returns table (source_status text, merchant_status text, merchant_label text)
language sql
stable
security definer
set search_path = public
as $$
  select m.source_status, m.merchant_status, m.merchant_label
    from public.status_mappings m
   where m.source_domain = lower(btrim(coalesce(p_domain, '')))
     and m.source_domain in ('store_order_stage', 'sourcing_rfq')
   order by m.sort, m.source_status
$$;
revoke all on function public.get_status_labels(text) from public, anon;
grant execute on function public.get_status_labels(text) to authenticated, service_role;

-- ───────── B3-3: customer declines a Sourcing quote ─────────
create or replace function public.reject_quote(p_quote uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotes;
  v_org uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_q from public.quotes where id = p_quote for update;
  if v_q.id is null then raise exception 'NOT_FOUND'; end if;
  select r.org_id into v_org from public.rfqs r where r.id = v_q.rfq_id;
  if v_org is null or v_org not in (select my_org_ids()) then raise exception 'FORBIDDEN'; end if;
  if v_q.status = 'rejected' then
    return jsonb_build_object('ok', true, 'quote_id', v_q.id, 'status', 'rejected', 'repeated', true);
  end if;
  if v_q.status not in ('sent', 'viewed') then
    raise exception 'QUOTE_NOT_OPEN: this quote is %', v_q.status;
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'REASON_TOO_LONG: keep the reason under 500 characters';
  end if;

  update public.quotes set status = 'rejected' where id = v_q.id;
  perform log_status('quote', v_q.id, v_q.status::text, 'rejected', v_reason);
  perform write_audit('quote.rejected', 'quote', v_q.id::text,
    jsonb_build_object('rfq_id', v_q.rfq_id, 'code', v_q.code, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'quote_id', v_q.id, 'status', 'rejected', 'repeated', false);
end $$;
revoke all on function public.reject_quote(uuid, text) from public, anon;
grant execute on function public.reject_quote(uuid, text) to authenticated, service_role;

-- ───────── B3-5: Dropship request quoting by Dropship staff ─────────
create or replace function public.set_dropship_request_landed_quote(
  p_rfq_id uuid,
  p_landed_cents bigint,
  p_country text default 'AE'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rfq public.rfqs;
  v_dpr public.dropship_product_requests;
  v_country char(2) := upper(btrim(coalesce(p_country, 'AE')))::char(2);
  v_saved_claims text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  -- Batch 3: quoting needs edit rights — Dropship editors, or Sourcing staff with requests:edit. A company-wide
  -- read-only role (support: in_division() is true everywhere, requests:view only) may no longer quote.
  elsif not (is_staff() and not distributor_restricted()
             and (dropship_can_edit(division_id_of('DS')) or (can('requests', 'edit') and in_division(division_id_of('SRC'))))) then
    raise exception 'FORBIDDEN';
  end if;

  if p_landed_cents is null or p_landed_cents < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_COUNTRY';
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if v_rfq.id is null then
    raise exception 'NOT_FOUND';
  end if;
  select * into v_dpr from public.dropship_product_requests where rfq_id = p_rfq_id;
  if v_dpr.rfq_id is null then
    raise exception 'NOT_A_DROPSHIP_REQUEST';
  end if;
  if v_rfq.status::text not in ('submitted', 'assigned', 'quoting', 'quoted') then
    raise exception 'REQUEST_NOT_OPEN: request % is %', v_rfq.code, v_rfq.status;
  end if;

  update public.dropship_product_requests
     set quoted_landed_cents = p_landed_cents,
         quoted_country = v_country,
         updated_at = now()
   where rfq_id = p_rfq_id;

  -- The request's rfq row belongs to the Sourcing division; the caller was authorised above (DS edit or SRC member),
  -- so clear request.jwt.claims strictly around this status update (same pattern as respond_dropship_request_quote).
  v_saved_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    update public.rfqs
       set status = 'quoted',
           updated_at = now()
     where id = p_rfq_id;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);

  perform write_audit(
    'dropship.request_quoted',
    'rfq',
    p_rfq_id::text,
    jsonb_build_object('rfq_code', v_rfq.code, 'quoted_landed_cents', p_landed_cents, 'country', v_country)
  );

  return jsonb_build_object('ok', true, 'rfq_id', p_rfq_id, 'rfq_code', v_rfq.code, 'status', 'quoted');
end $$;

revoke all on function public.set_dropship_request_landed_quote(uuid, bigint, text) from public, anon;
grant execute on function public.set_dropship_request_landed_quote(uuid, bigint, text) to authenticated, service_role;

create or replace function public.list_dropship_product_requests(p_status text default null)
returns table (
  rfq_id uuid,
  rfq_code text,
  title text,
  rfq_status text,
  merchant_label text,
  org_name text,
  product_link text,
  category_label text,
  monthly_volume_band text,
  ship_to_countries text[],
  wants_brand boolean,
  quoted_landed_cents bigint,
  quoted_country text,
  created_dropship_product_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or (is_staff() and not distributor_restricted() and (in_division(division_id_of('DS')) or in_division(division_id_of('SRC'))))
  ) then
    raise exception 'FORBIDDEN';
  end if;

  return query
    select r.id, r.code, r.title, r.status::text, m.merchant_label, o.name,
           d.product_link, d.category_label, d.monthly_volume_band, d.ship_to_countries, d.wants_brand,
           d.quoted_landed_cents, d.quoted_country::text, d.created_dropship_product_id, d.created_at
      from public.dropship_product_requests d
      join public.rfqs r on r.id = d.rfq_id
      join public.organizations o on o.id = d.org_id
      left join public.status_mappings m on m.source_domain = 'sourcing_rfq' and m.source_status = r.status::text
     where p_status is null or r.status::text = p_status
     order by d.created_at desc
     limit 500;
end $$;
revoke all on function public.list_dropship_product_requests(text) from public, anon;
grant execute on function public.list_dropship_product_requests(text) to authenticated, service_role;

-- ───────── B3-6: notifications linking to SRV- service requests get their division ─────────
create or replace function division_of_notification(r notifications) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_ref text; v uuid;
begin
  v := division_id_of(division_code_for_service(r.service));
  if v is not null then return v; end if;
  if r.link is null then return null; end if;
  if r.link like '/admin/brand-projects/%' or r.link like '/account/brand%' then return division_id_of('MMB'); end if;
  if r.link like '/account/pools%' or r.link like '/pool/%' then return division_id_of('POOL'); end if;
  if r.link like '/account/turnkey%' then return division_id_of('TK'); end if;
  if r.link like '/account/warehouse%' then return division_id_of('3PL'); end if;
  if r.link like '/account/dropship%' then return division_id_of('DS'); end if;
  v_ref := split_part(split_part(r.link, '?', 1), '/', 4);
  if r.link like '/account/sourcing/%' and v_ref <> '' then
    -- service requests are numbered SRV-<seq> (Batch 3 decision: no renumbering); 'SR-' kept for any older links
    if v_ref like 'SRV-%' or v_ref like 'SR-%' then return (select division_id from service_requests where code = v_ref); end if;
    if v_ref like 'RFQ-%' then return (select division_id from rfqs where code = v_ref); end if;
    if v_ref ~* '^[0-9a-f-]{36}$' then
      return coalesce((select division_id from rfqs where id = v_ref::uuid), (select division_id from service_requests where id = v_ref::uuid));
    end if;
  end if;
  if r.link like '/account/orders/%' and v_ref ~* '^[0-9a-f-]{36}$' then return (select division_id from orders where id = v_ref::uuid); end if;
  return null;
end $$;

-- ───────── B3-7: Factory audit request type (Sourcing division) ─────────
create or replace function division_code_for_service(p text) returns text
language sql immutable set search_path = public as $$
  select case lower(coalesce(p, ''))
    when 'rfq' then 'SRC' when 'sample' then 'SRC' when 'qc' then 'SRC' when 'certification' then 'SRC'
    when 'factory_audit' then 'SRC'
    when 'sourcing' then 'SRC' when 'rfq_fees' then 'SRC'
    when '3pl' then '3PL' when 'warehouse' then '3PL'
    when 'dropship' then 'DS'
    when 'brand' then 'MMB'
    when 'pool' then 'POOL' when 'pools' then 'POOL'
    when 'turnkey' then 'TK'
    else null end
$$;

insert into public.services (code, name, description, unit, active, sort)
values ('factory_audit', 'Factory audit', 'On-site audit of a factory: licences, capacity, quality system and social compliance, with a photo report', 'per audit', true, 4)
on conflict (code) do nothing;

-- Placeholder price (same as QC inspection) so the type works end to end on staging; set the real price in
-- /admin/services before release (a new price row with its own effective date).
insert into public.service_prices (service_code, amount_minor, currency, effective_from)
select 'factory_audit', 19900, 'USD', now()
 where not exists (select 1 from public.service_prices where service_code = 'factory_audit');
