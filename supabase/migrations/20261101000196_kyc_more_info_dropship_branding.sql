-- KYC "more information" message + dropship seller branding (19 Nov 2026).
--  1. KYC: review_kyc() now also requires a message to the customer when asking for more information ('more_info'),
--     not only when rejecting — the customer must know what to provide. Same error code KYC_MESSAGE_REQUIRED.
--  2. Dropship seller profiles (owner's decision: "For dropship parcels, the label and packing slip show only the
--     seller's brand and the approved return address (no supplier address, no supplier code, no Octopus cost)"):
--     one row per dropship seller company with its brand name and return address, approved by Dropshipping staff.
--      · division: always Dropshipping (DS) — column default, the division write guard from 192 covers staff writes
--      · customers read their own row and insert / update ONLY the brand + return-address fields (column grants);
--        any change to those fields puts the profile back to 'pending' (trigger), so a label never prints an
--        address nobody approved
--      · Dropshipping staff and company-wide roles read every row (in_division, as the dropship catalogue in 194)
--      · approval only through review_dropship_profile() — Dropshipping managers/staff or an admin; audit-logged
--      · review_note / reviewed_by are staff only (scripts/hidden-columns.mjs, column grants as in 195)
-- Down: supabase/migrations/down/20261101000196_kyc_more_info_dropship_branding.down.sql

-- ───────── 1. KYC: a message to the customer for 'rejected' AND 'more_info' ─────────
create or replace function review_kyc(p_submission uuid, p_to kyc_status, p_note text default null, p_customer_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_msg text := nullif(btrim(coalesce(p_customer_message, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not can('customers','approve') then raise exception 'FORBIDDEN'; end if;
  select * into s from kyc_submissions where id = p_submission for update;
  if s is null then raise exception 'NOT_FOUND'; end if;
  if p_to not in ('in_review','verified','rejected','more_info') then raise exception 'KYC_INVALID_TRANSITION'; end if;
  if s.status in ('verified','rejected') then raise exception 'KYC_INVALID_TRANSITION: already %', s.status; end if;
  if p_to in ('rejected','more_info') and v_msg is null then
    raise exception 'KYC_MESSAGE_REQUIRED: write a message to the customer saying why, and what they need to do next';
  end if;
  update kyc_submissions set status = p_to, reviewer_id = auth.uid(), internal_note = v_note, customer_message = v_msg, reviewed_at = now()
   where id = p_submission;
  update organizations set kyc_status = p_to where id = s.org_id;
  perform log_status('kyc', p_submission, s.status::text, p_to::text, v_note);
  perform write_audit('kyc.review', 'kyc_submissions', p_submission::text, jsonb_build_object('to', p_to));
  perform emit_event('kyc.' || p_to, 'kyc', p_submission, jsonb_build_object('org_id', s.org_id));
end $$;
revoke all on function review_kyc(uuid, kyc_status, text, text) from public, anon;
grant execute on function review_kyc(uuid, kyc_status, text, text) to authenticated;
comment on column kyc_submissions.customer_message is 'Shown to the customer. Required when rejecting or asking for more information.';

-- ───────── 2. dropship seller profiles ─────────
create table if not exists dropship_seller_profiles (
  org_id uuid primary key references organizations(id) on delete cascade,
  division_id uuid not null default division_id_of('DS') references divisions(id) on delete restrict,
  brand_name text not null check (btrim(brand_name) <> '' and length(brand_name) <= 80),
  return_name text not null check (btrim(return_name) <> '' and length(return_name) <= 120),
  return_line1 text not null check (btrim(return_line1) <> '' and length(return_line1) <= 200),
  return_line2 text check (length(return_line2) <= 200),
  return_city text not null check (btrim(return_city) <> '' and length(return_city) <= 120),
  return_region text check (length(return_region) <= 120),
  return_postal_code text check (length(return_postal_code) <= 20),
  return_country text not null check (btrim(return_country) <> '' and length(return_country) <= 60),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dropship_seller_profiles_ds check (division_id = division_id_of('DS'))
);
comment on table dropship_seller_profiles is 'Brand + return address printed on dropship labels and packing slips (only once approved).';
comment on column dropship_seller_profiles.review_note is 'Staff only. Never shown to the customer.';
comment on column dropship_seller_profiles.reviewed_by is 'Staff only.';
create index if not exists dropship_seller_profiles_status_idx on dropship_seller_profiles (status);
create index if not exists dropship_seller_profiles_reviewed_by_idx on dropship_seller_profiles (reviewed_by);

-- any change to the brand or the return address needs a new approval
create or replace function dropship_profile_reset_on_change() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.brand_name, new.return_name, new.return_line1, new.return_line2, new.return_city, new.return_region, new.return_postal_code, new.return_country)
     is distinct from
     (old.brand_name, old.return_name, old.return_line1, old.return_line2, old.return_city, old.return_region, old.return_postal_code, old.return_country) then
    new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_dropship_profile_reset on dropship_seller_profiles;
create trigger trg_dropship_profile_reset before update on dropship_seller_profiles
  for each row execute function dropship_profile_reset_on_change();
-- staff writes must be in the row's division (Dropshipping), as on every other division table (192)
drop trigger if exists trg_zz_division_guard on dropship_seller_profiles;
create trigger trg_zz_division_guard before insert or update or delete on dropship_seller_profiles
  for each row execute function division_write_guard();

alter table dropship_seller_profiles enable row level security;
drop policy if exists dsp_read on dropship_seller_profiles;
create policy dsp_read on dropship_seller_profiles for select to authenticated
  using (org_id in (select my_org_ids()) or (is_staff() and in_division(division_id)));
drop policy if exists dsp_insert_own on dropship_seller_profiles;
create policy dsp_insert_own on dropship_seller_profiles for insert to authenticated
  with check (org_id in (select my_org_ids()));
drop policy if exists dsp_update_own on dropship_seller_profiles;
create policy dsp_update_own on dropship_seller_profiles for update to authenticated
  using (org_id in (select my_org_ids())) with check (org_id in (select my_org_ids()));

-- column grants: review_note / reviewed_by never readable with a session (scripts/hidden-columns.mjs); customers write
-- the brand + return-address fields only (status, division and review columns are set by defaults / the RPC)
revoke all on dropship_seller_profiles from public, anon, authenticated;
grant select (org_id, division_id, brand_name, return_name, return_line1, return_line2, return_city, return_region, return_postal_code,
              return_country, status, reviewed_at, created_at, updated_at) on dropship_seller_profiles to authenticated;
grant insert (org_id, brand_name, return_name, return_line1, return_line2, return_city, return_region, return_postal_code, return_country)
  on dropship_seller_profiles to authenticated;
grant update (brand_name, return_name, return_line1, return_line2, return_city, return_region, return_postal_code, return_country)
  on dropship_seller_profiles to authenticated;
grant all on dropship_seller_profiles to service_role;

-- approval: Dropshipping managers/staff of the row's division, or an admin (dropship_can_edit from 194)
create or replace function review_dropship_profile(p_org uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r dropship_seller_profiles; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from dropship_seller_profiles where org_id = p_org for update;
  if r.org_id is null then raise exception 'NOT_FOUND'; end if;
  if not dropship_can_edit(r.division_id) then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'INVALID_STATUS: approved or rejected'; end if;
  update dropship_seller_profiles set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
   where org_id = p_org;
  insert into audit_log(actor_id, action, entity, entity_id, details, division_id)
  values (auth.uid(), 'dropship_profile.review', 'dropship_seller_profiles', p_org::text,
          jsonb_build_object('from', r.status, 'to', p_status, 'brand_name', r.brand_name), r.division_id);
end $$;
revoke all on function review_dropship_profile(uuid, text, text) from public, anon;
grant execute on function review_dropship_profile(uuid, text, text) to authenticated;
revoke all on function dropship_profile_reset_on_change() from public, anon, authenticated;
