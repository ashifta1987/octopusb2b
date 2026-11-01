-- Home page shows only REAL figures (owner request, 1 Nov 2026): trust row, search placeholder, logistics tiles, destinations
-- and the live RFQ card are computed from the database. Seeded marketing numbers are cleared; carrier figures may be entered
-- in site_settings.logistics_stats ONLY once verified with the carrier.
update site_settings set value = '{}'::jsonb,
  description = 'Verified carrier figures only (keys: countries, hubs, parcels_daily, service_lines). Leave empty until confirmed by the carrier.'
where key = 'logistics_stats' and value = '{"hubs":"30+","countries":"220+","parcels_daily":"1M+","service_lines":"100+"}'::jsonb;
update site_settings set description = 'Not used on the storefront any more — destinations are computed from real orders and shipments.' where key = 'logistics_destinations';
update site_settings set description = 'Not used on the storefront any more — product, supplier, market and saving figures are computed from live data.' where key = 'stats';

insert into content_blocks(key, value) values
  ('home.hero.rfq_label', 'Live RFQ'),
  ('home.hero.rfq_empty', 'No open RFQs right now — be the first to request quotes.'),
  ('home.hero.pool_empty', 'No open pools right now. Start one and share the MOQ with other buyers.'),
  ('home.logistics.title_plain', 'Delivered worldwide. *Fulfilled under your brand.*'),
  ('home.logistics.yun.title_plain', 'Global tracked shipping'),
  ('home.logistics.live_stat_labels', 'Countries we ship to|Shipments sent|Carrier integrations'),
  ('home.logistics.stats_empty', 'Live shipping figures appear here as soon as the first orders ship.'),
  ('home.logistics.destinations_empty', 'Destinations are listed here once orders ship.'),
  ('home.testimonials.empty', 'Reviews from verified buyers will be published here.')
on conflict (key) do nothing;
