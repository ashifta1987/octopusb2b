-- Brand kit step 4 — media store for site pictures.
-- One row per picture slot (Site content key). `path` = file in the public `site-media` bucket once uploaded;
-- until then the site uses `default_src` (the file shipped in /public/images). Alt text is required.
-- Content editors (content:edit) change the file or alt text in Site content › Media; every change is audit-logged.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 5242880, array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
on conflict (id) do nothing;

drop policy if exists "site media public read" on storage.objects;
create policy "site media public read" on storage.objects for select to anon, authenticated using (bucket_id = 'site-media');
drop policy if exists "site media editors write" on storage.objects;
create policy "site media editors write" on storage.objects for insert to authenticated with check (bucket_id = 'site-media' and can('content', 'edit'));
drop policy if exists "site media editors update" on storage.objects;
create policy "site media editors update" on storage.objects for update to authenticated using (bucket_id = 'site-media' and can('content', 'edit'));
drop policy if exists "site media editors delete" on storage.objects;
create policy "site media editors delete" on storage.objects for delete to authenticated using (bucket_id = 'site-media' and can('content', 'edit'));

create table if not exists site_media (
  key text primary key check (key ~ '^[a-z0-9]+(\.[a-z0-9-]+)+$'),
  label text not null,                       -- where it appears, for the editor
  default_src text not null,                 -- /images/... shipped with the site
  path text,                                 -- site-media bucket path when replaced
  alt text not null default '',              -- '' only for decorative images
  width integer not null default 1200 check (width > 0),
  height integer not null default 800 check (height > 0),
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table site_media enable row level security;
grant select on site_media to anon, authenticated;
drop policy if exists site_media_read on site_media;
create policy site_media_read on site_media for select to anon, authenticated using (true);
revoke insert, update, delete on site_media from anon, authenticated;

-- editors change a slot through this function (permission check + audit)
create or replace function set_site_media(p_key text, p_path text, p_alt text) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not can('content', 'edit') then raise exception 'FORBIDDEN'; end if;
  select to_jsonb(m) into v_before from site_media m where key = p_key;
  if v_before is null then raise exception 'UNKNOWN_SLOT'; end if;
  if p_path is not null and p_path !~ '^site/[a-z0-9/_.-]+$' then raise exception 'BAD_PATH'; end if;
  update site_media set path = p_path, alt = left(btrim(coalesce(p_alt, alt)), 300), updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform audit('site_media.updated', null, 'content', 'site_media', p_key,
                jsonb_build_object('path', v_before->>'path', 'alt', v_before->>'alt'), jsonb_build_object('path', p_path, 'alt', p_alt));
end $$;
revoke all on function set_site_media(text, text, text) from public, anon;
grant execute on function set_site_media(text, text, text) to authenticated;

-- the slots (ADDON-48 Part 2 + compact kit); alt text describes what the picture shows, no staff names
insert into site_media(key, label, default_src, alt, sort) values
  ('home.hero.image', 'Home · hero (3D warehouse octopus)', '/images/services/3d-3pl-logistics.webp', 'The Octopus mascot storing, packing and loading parcels onto a delivery truck', 10),
  ('home.dropship.image', 'Home · Dropshipping (3D)', '/images/services/3d-dropshipping.webp', 'The Octopus mascot taking an order from a phone and delivering the parcel to a customer''s door', 20),
  ('home.dropship.photo', 'Home · Dropshipping packing photo', '/images/services/dropshipping.webp', 'An Octopus packer placing a product in a box at the Shenzhen warehouse', 21),
  ('home.brand.image', 'Home · Make My Brand (3D)', '/images/services/make-my-brand-3d.webp', 'The Octopus mascot stamping a logo onto a product box, with colour swatches and packaging', 30),
  ('home.sourcing.image', 'Home · Product sourcing (3D)', '/images/services/product-sourcing-3d.webp', 'The Octopus mascot comparing three factory quotes with a magnifying glass', 40),
  ('home.sourcing.inset', 'Home · Product sourcing QC inset', '/images/services/factory-quality-control.webp', 'Quality inspection of products at the factory', 41),
  ('home.pools.image', 'Home · MOQ pools (3D)', '/images/services/3d-moq-pooling.webp', 'The Octopus mascot gathering boxes from several buyers onto one shared pallet', 50),
  ('home.turnkey.image', 'Home · Turnkey Projects (3D)', '/images/services/turnkey-projects-3d.webp', 'The Octopus mascot loading a gym machine, a vending machine and a coffee kiosk into a shipping container', 60),
  ('home.3pl.strip.1', 'Home · 3PL strip 1 (received and stored)', '/images/services/logistics.webp', 'Stock arriving and being stored on warehouse shelves', 70),
  ('home.3pl.strip.2', 'Home · 3PL strip 2 (picked, scanned, packed)', '/images/services/3pl-service.webp', 'A warehouse team member scanning a parcel before packing', 71),
  ('home.3pl.strip.3', 'Home · 3PL strip 3 (dispatched)', '/images/services/logistics-vehicle.webp', 'Parcels being loaded into a van for dispatch', 72),
  ('home.3pl.strip.4', 'Home · 3PL strip 4 (returns checked)', '/images/services/returns-dropship-shirt.webp', 'A warehouse team member checking a returned product and noting its condition', 73),
  ('home.pay.image', 'Home · How you pay (3D)', '/images/services/wallet-escrow-3d.webp', 'The Octopus mascot guarding a safe with a wallet, coins and a shield', 80),
  ('home.manager.photo', 'Home · Account manager photo', '/images/services/customer-care-phone.webp', 'An Octopus account manager on a call with a customer', 90),
  ('home.faq.photo', 'Home · FAQ card photo', '/images/services/back-office.webp', 'An Octopus support team member answering a customer call', 100),
  ('home.cta.image', 'Home · Final call to action (3D van)', '/images/services/3d-transportation.webp', 'The Octopus mascot loading parcels into a van with a route to the customer', 110),
  ('mmb.manager.photo', 'Make My Brand · account manager photo', '/images/services/brand-consulting.webp', 'An Octopus brand consultant going through colour swatches and packaging samples with a customer', 120),
  ('octo.face', 'Octo assistant face (decorative)', '/images/octo/octo-face.webp', '', 130),
  ('reserve.sourcing.photo', 'Reserved · sourcing page photo', '/images/services/product-sourcing.webp', 'An Octopus sourcing agent checking products with a factory', 900),
  ('reserve.returns.photo', 'Reserved · after-sales page photo', '/images/services/after-sales.webp', 'An Octopus team member handling an after-sales return', 901)
on conflict (key) do nothing;
update site_media set width = 256, height = 256 where key = 'octo.face';
