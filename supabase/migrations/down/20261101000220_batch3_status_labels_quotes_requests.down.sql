-- DOWN for 20261101000220_batch3_status_labels_quotes_requests.sql
-- Restores set_dropship_request_landed_quote (214), division_of_notification (190), division_code_for_service (189),
-- drops the Batch 3 functions and removes the factory_audit service + price rows (fails if factory_audit requests exist).
-- Then: delete from _migrations where name = '20261101000220_batch3_status_labels_quotes_requests.sql';

drop function if exists public.get_status_labels(text);
drop function if exists public.reject_quote(uuid, text);
drop function if exists public.list_dropship_product_requests(text);

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
  v_country char(2) := upper(btrim(coalesce(p_country, 'AE')))::char(2);
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' then
    null;
  elsif not (is_staff() and not distributor_restricted() and (dropship_can_edit(division_id_of('DS')) or in_division(division_id_of('SRC')))) then
    raise exception 'FORBIDDEN';
  end if;

  if p_landed_cents is null or p_landed_cents < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if v_rfq.id is null then
    raise exception 'NOT_FOUND';
  end if;

  update public.dropship_product_requests
     set quoted_landed_cents = p_landed_cents,
         quoted_country = v_country,
         updated_at = now()
   where rfq_id = p_rfq_id;

  update public.rfqs
     set status = 'quoted',
         updated_at = now()
   where id = p_rfq_id;

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
    if v_ref like 'SR-%' then return (select division_id from service_requests where code = v_ref); end if;
    if v_ref like 'RFQ-%' then return (select division_id from rfqs where code = v_ref); end if;
    if v_ref ~* '^[0-9a-f-]{36}$' then
      return coalesce((select division_id from rfqs where id = v_ref::uuid), (select division_id from service_requests where id = v_ref::uuid));
    end if;
  end if;
  if r.link like '/account/orders/%' and v_ref ~* '^[0-9a-f-]{36}$' then return (select division_id from orders where id = v_ref::uuid); end if;
  return null;
end $$;

create or replace function division_code_for_service(p text) returns text
language sql immutable set search_path = public as $$
  select case lower(coalesce(p, ''))
    when 'rfq' then 'SRC' when 'sample' then 'SRC' when 'qc' then 'SRC' when 'certification' then 'SRC'
    when 'sourcing' then 'SRC' when 'rfq_fees' then 'SRC'
    when '3pl' then '3PL' when 'warehouse' then '3PL'
    when 'dropship' then 'DS'
    when 'brand' then 'MMB'
    when 'pool' then 'POOL' when 'pools' then 'POOL'
    when 'turnkey' then 'TK'
    else null end
$$;

delete from public.service_prices where service_code = 'factory_audit';
delete from public.services where code = 'factory_audit';
