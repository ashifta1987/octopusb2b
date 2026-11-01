-- Storefront home redesign (Main.png, Nov 2026): NEW CMS copy + marketing settings only.
-- Insert-only (ON CONFLICT DO NOTHING) so nothing the content team has already edited is overwritten.
-- Placeholders: {currency} = platform currency (withCurrency), {products}/{suppliers}/{countries}/{bulk_saving} = site_settings.stats,
-- {countries} inside home.logistics.* = site_settings.logistics_stats.countries, {deposit_pct} = site_settings.pool_deposit_pct.
-- Text between *asterisks* in home.logistics.title is rendered highlighted. Lists are pipe-separated.

insert into content_blocks(key, value, status) values
  -- Hero
  ('home.hero.title', 'Industrial supplies, sourced and shipped — in one place.', 'published'),
  ('home.hero.subtitle', 'One RFQ to many verified factories. {currency} tier prices, Incoterms and lead times side by side. Pay from your wallet, inspect before shipping, and track every order to your door.', 'published'),
  ('home.hero.buttons', 'Browse products|Send an RFQ|Join a group buy', 'published'),
  ('home.hero.trust', '{products} products|{suppliers} verified suppliers|{countries} markets|Up to {bulk_saving} saved with bulk tiers', 'published'),
  ('home.hero.pool_label', 'Open group buy', 'published'),
  ('home.hero.pool_cta', 'Join this pool', 'published'),
  ('home.hero.featured_label', 'Featured', 'published'),
  -- Logistics band
  ('home.logistics.pill', 'Powered by YunExpress · official logistics partner', 'published'),
  ('home.logistics.title', 'Delivered to *{countries} countries*. Fulfilled under your brand.', 'published'),
  ('home.logistics.body', 'Octopus plugs into YunExpress for door-to-door tracked delivery, plus warehousing and dropshipping run by vetted 3PL partners. One commercial invoice, one timeline, one place to settle claims.', 'published'),
  ('home.logistics.buttons', 'Request a shipping quote|See service lines', 'published'),
  ('home.logistics.stat_labels', 'Countries & regions served|Transit hubs globally|Parcels shipped daily|Service lines (express, economy, DDP)', 'published'),
  ('home.logistics.yun', 'YunExpress integration|Global shipping to {countries} countries|Door-to-door tracked delivery with YunExpress. DDP available in top markets. Live tracking in your customer portal, with carrier updates pushed to your buyer''s email.|See shipping options', 'published'),
  ('home.logistics.yun.points', 'Express and economy service lines|Pickup from supplier or Octopus warehouse|End-to-end tracking in the order timeline', 'published'),
  ('home.logistics.3pl', '3PL fulfilment|Warehouses near your buyers|Store stock in vetted warehouses in the US, EU, UK, GCC and South-East Asia. We pick, pack and ship each order; returns and customs handled under one commercial invoice.|Request a 3PL quote', 'published'),
  ('home.logistics.3pl.points', 'Quotes per order, per pallet and setup fee in {currency}|Connects to Shopify, Amazon, WooCommerce|Hazardous and temperature-controlled options', 'published'),
  ('home.logistics.dropship', 'Dropshipping|Ship under your brand, zero stock|Suppliers ship each order straight to your customer with white-label packaging and inserts you specify. Orders and tracking sync into your store.|Start a dropship request', 'published'),
  ('home.logistics.dropship.points', 'No MOQ, no stock, no customs on your side|Delivery commitments per market|Returns handled under your brand', 'published'),
  ('home.logistics.destinations_label', 'Key destinations', 'published'),
  -- Everything you need, in one platform
  ('home.platform.title', 'Everything you need, in one platform', 'published'),
  ('home.platform.link', 'Open the Request Center', 'published'),
  ('home.platform.rfq', 'RFQ to many suppliers|One request, many quotes side by side with {currency} tier prices, Incoterms and lead time.|Send an RFQ', 'published'),
  ('home.platform.pool', 'Group buy (MOQ pools)|Share the factory minimum with other buyers. Pay {deposit_pct}% now, the rest only if the pool fills.|Browse pools', 'published'),
  ('home.platform.qc', 'QC inspection|Independent pre-shipment inspection with a PDF report, before you pay the balance.|Book a QC check', 'published'),
  ('home.platform.certification', 'Certification|CE, RoHS, FCC, FDA — we arrange the lab testing and the paperwork for your target market.|Request certification', 'published'),
  -- Section links
  ('home.suppliers.link', 'Become a supplier', 'published'),
  ('home.featured.link', 'View all products', 'published')
on conflict (key) do nothing;

insert into site_settings(key, value, description, is_public) values
  ('logistics_stats',
   '{"countries":"220+","hubs":"30+","parcels_daily":"1M+","service_lines":"100+"}',
   'Editable marketing copy — logistics partner numbers shown on the home page (countries, transit hubs, parcels per day, service lines)', true),
  ('logistics_destinations',
   '{"items":[{"flag":"🇺🇸","name":"United States"},{"flag":"🇬🇧","name":"United Kingdom"},{"flag":"🇩🇪","name":"Germany"},{"flag":"🇫🇷","name":"France"},{"flag":"🇮🇹","name":"Italy"},{"flag":"🇨🇦","name":"Canada"},{"flag":"🇦🇪","name":"UAE"},{"flag":"🇸🇦","name":"Saudi Arabia"},{"flag":"🇦🇺","name":"Australia"},{"flag":"🇧🇷","name":"Brazil"},{"flag":"🇮🇳","name":"India"}],"more":209}',
   'Editable marketing copy — "Key destinations" chips on the home page (flag emoji + name) and the "+ N more" count', true)
on conflict (key) do nothing;
