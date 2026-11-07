-- ADDON-36 · 36-A
--   C5: public "Sell on Octopus B2B" applications (/suppliers) → back-office KYC queue
--   H3: "Get notified when a pool opens" email capture

-- ───────── supplier applications ─────────
create sequence if not exists supplier_application_seq start 1001;

create table if not exists supplier_applications (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null default ('SA-' || to_char(now(), 'YYYY') || '-' || nextval('supplier_application_seq')),
  company_name text not null check (length(company_name) between 2 and 200),
  uscc text check (uscc is null or uscc ~ '^[0-9A-Z]{18}$'),
  city text not null check (length(city) between 2 and 120),
  province text,
  categories text[] not null default '{}',
  contact_name text not null check (length(contact_name) between 2 and 120),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text,
  wechat text,
  website text,
  store_url text,
  product_sheet_path text,
  notes text check (notes is null or length(notes) <= 4000),
  status text not null default 'submitted' check (status in ('submitted','in_review','approved','rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  ip_country text,
  created_at timestamptz not null default now()
);
create index if not exists supplier_applications_status_idx on supplier_applications(status, created_at);

alter table supplier_applications enable row level security;
drop policy if exists supplier_applications_staff on supplier_applications;
create policy supplier_applications_staff on supplier_applications for select to authenticated using (can('suppliers','view'));
revoke all on supplier_applications from anon;
grant select on supplier_applications to authenticated;

-- public submit goes through the server (rate-limited) with the service role only
create or replace function submit_supplier_application(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r supplier_applications;
begin
  insert into supplier_applications(company_name, uscc, city, province, categories, contact_name, contact_email,
                                    contact_phone, wechat, website, store_url, product_sheet_path, notes, ip_country)
  values (trim(p->>'company_name'), nullif(upper(trim(coalesce(p->>'uscc',''))),''), trim(p->>'city'), nullif(trim(coalesce(p->>'province','')),''),
          coalesce(array(select jsonb_array_elements_text(coalesce(p->'categories','[]'::jsonb))), '{}'),
          trim(p->>'contact_name'), lower(trim(p->>'contact_email')), nullif(trim(coalesce(p->>'contact_phone','')),''),
          nullif(trim(coalesce(p->>'wechat','')),''), nullif(trim(coalesce(p->>'website','')),''), nullif(trim(coalesce(p->>'store_url','')),''),
          nullif(p->>'product_sheet_path',''), nullif(trim(coalesce(p->>'notes','')),''), nullif(upper(coalesce(p->>'ip_country','')),''))
  returning * into r;
  insert into audit_log(action, entity, entity_id, details)
  values ('supplier_application.submit', 'supplier_application', r.id::text,
          jsonb_build_object('reference', r.reference, 'company', r.company_name, 'city', r.city));
  return jsonb_build_object('id', r.id, 'reference', r.reference);
end $$;
revoke execute on function submit_supplier_application(jsonb) from public, anon, authenticated;
grant execute on function submit_supplier_application(jsonb) to service_role;

-- staff review (permission + step-up like other approvals); every change audited
create or replace function review_supplier_application(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare old_status text;
begin
  if not has_permission(auth.uid(), 'suppliers', 'approve') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('in_review','approved','rejected') then raise exception 'BAD_STATUS'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note),'') = '' then raise exception 'NOTE_REQUIRED'; end if;
  select status into old_status from supplier_applications where id = p_id for update;
  if old_status is null then raise exception 'NOT_FOUND'; end if;
  update supplier_applications
     set status = p_status, review_note = nullif(trim(coalesce(p_note,'')),''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  insert into audit_log(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'supplier_application.review', 'supplier_application', p_id::text,
          jsonb_build_object('from', old_status, 'to', p_status, 'note', p_note));
end $$;
revoke execute on function review_supplier_application(uuid, text, text) from public, anon;
grant execute on function review_supplier_application(uuid, text, text) to authenticated;

-- product sheets: private bucket, written through signed upload URLs only
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-applications', 'supplier-applications', false, 20971520,
        array['application/pdf','image/jpeg','image/png','text/csv',
              'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'])
on conflict (id) do nothing;

-- ───────── pool alerts ─────────
create table if not exists pool_alert_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  product_id uuid references products(id) on delete set null,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists pool_alert_signups_email_open on pool_alert_signups(lower(email)) where notified_at is null and product_id is null;
alter table pool_alert_signups enable row level security;
drop policy if exists pool_alert_signups_staff on pool_alert_signups;
create policy pool_alert_signups_staff on pool_alert_signups for select to authenticated using (can('products','view'));
revoke all on pool_alert_signups from anon;
grant select on pool_alert_signups to authenticated;
