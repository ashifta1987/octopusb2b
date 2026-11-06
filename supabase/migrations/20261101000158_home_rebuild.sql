-- ADDON-32: storefront home rebuild — CMS home banners (rotating lead banner), banner analytics, announcement bar,
-- feature-card order / visibility, placeholder switch. Figures stay REAL (owner decision 1 Nov 2026): carrier figures
-- (220+ countries …) appear only once entered in site_settings.logistics_stats.

create table if not exists home_banners (
  id uuid primary key default gen_random_uuid(),
  position text not null default 'lead' check (position in ('lead')),
  eyebrow text,
  title text not null,
  body text,
  cta_label text, cta_href text,
  cta2_label text, cta2_href text,
  ticks text[] not null default '{}',
  theme text not null default 'navy' check (theme in ('navy','blue','light')),
  image_url text check (image_url is null or image_url ~ '^https://'),
  show_open_project boolean not null default false,    -- Turnkey banner: live "open project" card (hidden when there is none)
  starts_at timestamptz, ends_at timestamptz,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint home_banner_cta_pair check ((cta_label is null) = (cta_href is null)),
  constraint home_banner_href_safe check ((cta_href is null or cta_href ~ '^(/|https://|#)') and (cta2_href is null or cta2_href ~ '^(/|https://|#)'))
);

create table if not exists banner_events (
  id bigserial primary key,
  banner_id uuid references home_banners(id) on delete cascade,
  slot text not null,                     -- 'lead' | 'side-pools' | 'side-shipping' | 'announcement'
  event text not null check (event in ('impression','click')),
  region text,
  ts timestamptz not null default now()
);
create index if not exists banner_events_idx on banner_events(slot, event, ts desc);

alter table home_banners enable row level security;
alter table banner_events enable row level security;
drop policy if exists home_banners_read on home_banners;
create policy home_banners_read on home_banners for select using (active or can('content','view'));
drop policy if exists home_banners_write on home_banners;
create policy home_banners_write on home_banners for all using (can('content','edit')) with check (can('content','edit'));
drop policy if exists banner_events_staff on banner_events;
create policy banner_events_staff on banner_events for select using (can('content','view'));
revoke insert, update, delete on banner_events from anon, authenticated;

create or replace function log_banner_event(p_banner uuid, p_slot text, p_event text, p_region text) returns void
language sql security definer set search_path = public as $$
  insert into banner_events(banner_id, slot, event, region)
  select p_banner, p_slot, p_event, nullif(upper(p_region), '')
  where p_event in ('impression','click') and p_slot in ('lead','side-pools','side-shipping','announcement')
$$;
revoke execute on function log_banner_event(uuid, text, text, text) from public, anon, authenticated;
grant execute on function log_banner_event(uuid, text, text, text) to service_role;

insert into home_banners(eyebrow, title, body, cta_label, cta_href, cta2_label, cta2_href, ticks, theme, show_open_project, sort)
select 'New · Turnkey Projects', 'Open a business, one container.',
  'Gym, laundry, vending, robotic café, water bottling, padel courts and 19 more. We specify it, source it from the right Chinese hub, inspect it and ship it — one quote in 24 hours.',
  'Explore Turnkey Projects →', '/turnkey', 'Project Atlas', '/turnkey/atlas',
  array['From $8k', 'QC before shipping', 'Door-to-door'], 'navy', true, 1
where not exists (select 1 from home_banners);

insert into site_settings(key, value, description) values
  ('home.announcement_enabled', 'true'::jsonb, 'Dark announcement bar at the top of the home page (text: content block home.announcement).'),
  ('home.show_placeholders', 'false'::jsonb, 'Show bracketed placeholder cards in Verified suppliers / What buyers say when there is no real data. Keep false in production.'),
  ('home.feature_cards', '["rfq","pool","turnkey","dropship","3pl","qc","certification","wallet","assistant","api"]'::jsonb, 'Order and visibility of the 10 "Everything you need" cards on the home page (remove a key to hide it).'),
  ('home.china_offices', 'null'::jsonb, 'Override for the "China offices" stats tile; null = number of active branches.')
on conflict (key) do nothing;

insert into content_blocks(key, value) values
  ('home.announcement', 'New · Turnkey Projects — open a gym, laundry, water-bottling plant or café with one container from China.|See all {turnkey} businesses →|/turnkey/atlas'),
  ('home.live.title', 'Live on the platform'),
  ('home.turnkey.title', 'Start a business, not a shopping list'),
  ('home.turnkey.body', '{turnkey} complete businesses, each specified with equipment, budget and payback — sourced from the right Chinese hub, inspected and shipped in one go.'),
  ('home.side.pools', 'Group buy|MOQ too big? Pool with other buyers.|Pay {deposit_pct} % now, the rest only if the pool fills. Deposits held in escrow.|See open pools →'),
  ('home.side.shipping', 'Dropship · 3PL|Ship worldwide. Your brand on the box.|Zero-stock dropshipping and 3PL fulfilment with YunExpress.|How shipping works →'),
  ('home.platform.subtitle', 'From a single carton to a complete business — sourcing, payment, inspection, certification and delivery under one roof.'),
  ('home.platform.turnkey', 'Turnkey Projects|{turnkey} complete businesses with equipment, budget and payback, shipped in one container.|Explore projects'),
  ('home.platform.dropship', 'Dropshipping|Sell without stock. We pick, pack and ship direct to your customer under your brand.|How it works'),
  ('home.platform.3pl', '3PL & global shipping|Warehousing and delivery worldwide with YunExpress, one tracking page.|See coverage'),
  ('home.platform.wallet', 'Wallet & escrow|Top up, pay from your wallet, and see every transaction in your ledger.|Open wallet'),
  ('home.platform.assistant', 'AI account manager|Octo answers instantly and hands off to your dedicated human manager when it matters.|Meet Octo'),
  ('home.platform.api', 'API & integrations|Sync catalogues and orders with your store or ERP. Postman collection included.|View API'),
  ('home.octo', 'Your account team|Chat with Octo, 24 / 7.|Instant answers on orders, wallet and shipping — a human account manager steps in the moment it matters.|Open the assistant →')
on conflict (key) do nothing;

