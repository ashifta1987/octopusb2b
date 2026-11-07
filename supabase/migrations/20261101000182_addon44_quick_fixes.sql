-- ADDON-44-C — quick fixes (copy and data), audit findings 03, 05, 06, 09, 11, 13, 16.
-- 1. Every supplier Octopus lists directly (no supplier login, not archived) is verified. Audit-logged per supplier.
-- 2. Province filled from the city for those suppliers (board 24 shows "Octopus verified factory · province").
-- 3. Site content: no carrier name, "Dropshipping" not "Octopus Dropship app", wallet-only payment wording,
--    one store-platform list, 3PL steps of its own, no warehouse locations that are not confirmed.
-- Re-runnable: every statement only changes rows that still hold the old value.

-- 1 · verified
do $$
declare r record;
begin
  for r in select id, code from suppliers where user_id is null and archived_at is null and verified is not true loop
    update suppliers set verified = true where id = r.id;
    perform audit('supplier.verified_octopus_listed', null, 'catalogue', 'supplier', r.code,
                  jsonb_build_object('verified', false), jsonb_build_object('verified', true, 'reason', 'Listed by Octopus directly (ADDON-44-C)'));
  end loop;
end $$;

-- 2 · province from city (only where empty)
update suppliers set province = case
    when lower(city) in ('shenzhen', 'shenzen', 'zhongshan', 'guangzhou', 'foshan', 'dongguan', 'huizhou', 'zhuhai', 'shantou', 'jiangmen') then 'Guangdong'
    when lower(city) in ('xiamen', 'fuzhou', 'quanzhou', 'putian') then 'Fujian'
    when lower(city) in ('yiwu', 'ningbo', 'hangzhou', 'wenzhou', 'taizhou', 'jinhua') then 'Zhejiang'
    when lower(city) in ('suzhou', 'nanjing', 'wuxi', 'changzhou') then 'Jiangsu'
  end
where coalesce(province, '') = '' and user_id is null
  and lower(city) in ('shenzhen', 'shenzen', 'zhongshan', 'guangzhou', 'foshan', 'dongguan', 'huizhou', 'zhuhai', 'shantou', 'jiangmen',
                      'xiamen', 'fuzhou', 'quanzhou', 'putian', 'yiwu', 'ningbo', 'hangzhou', 'wenzhou', 'taizhou', 'jinhua',
                      'suzhou', 'nanjing', 'wuxi', 'changzhou');

-- 3 · site content (exact keys; only rows still containing the old wording)
create temporary table _c44(key text primary key, value text) on commit drop;
insert into _c44 values
  ('product.services.subtitle', 'Add any service to your RFQ. Prices in US dollars, paid from your Octopus wallet. Top up by bank transfer — no card payments.'),
  ('product.service.dropship', 'Fulfillment|Dropshipping|Sell this product in your online store. We ship each order to your customer under your brand.|pay per order'),
  ('product.service.sample', 'Quality|Order a sample|Get 1–5 units by Express shipping to check finish and fit before buying in bulk.|per sample + shipping'),
  ('home.logistics.body', 'Octopus ships door to door with tracking, plus warehousing and dropshipping run by vetted 3PL partners. One commercial invoice, one timeline, one place to settle claims.'),
  ('home.logistics.pill', 'Global shipping · Express, Standard and Economy'),
  ('home.logistics.yun', 'Global shipping|Global shipping to {countries} countries|Door-to-door tracked delivery by Express, Standard or Economy. Live tracking in your account, with updates sent to your buyer''s email.|See shipping options'),
  ('home.logistics.3pl', '3PL fulfilment|Warehouses near your buyers|Store stock with Octopus and partner warehouses. We pick, pack and ship each order; returns and customs handled under one commercial invoice.|Request a 3PL quote'),
  ('home.logistics.3pl.points', 'Quotes per order, per pallet and setup fee in {currency}|Shopify and WooCommerce, or upload a sheet|Hazardous and temperature-controlled options'),
  ('home.3pl.points', 'Quotes per order, per pallet and setup fee in {currency}|Shopify and WooCommerce, or upload a sheet|Standard, fragile, hazardous or temperature-controlled'),
  ('home.platform.3pl', '3PL & global shipping|Warehousing and delivery worldwide, one tracking page.|See coverage'),
  ('home.side.shipping', 'Dropship · 3PL|Ship worldwide. Your brand on the box.|Zero-stock dropshipping and 3PL fulfilment.|How shipping works →'),
  ('about.pillars.reach_plain', 'Worldwide shipping by Express, Standard and Economy, plus 3PL partners.'),
  ('about.stats.labels', 'Sourcing offices in China|Verified suppliers|Products listed|Markets we ship to|Markets with orders'),
  ('about.partners', 'Global shipping network|1688 Open Platform|Alibaba.com|SGS · TÜV · Intertek|Shopify · WooCommerce|Dropshipping');

update content_blocks cb set value = c.value, updated_at = now()
from _c44 c
where cb.key = c.key and cb.value is distinct from c.value
  and cb.value ~* '(yunexpress|dropship app|by card|wix|amazon|US, EU, UK, GCC|Octopus Dropship\|)';

-- 3PL "What happens next" (own steps; the other request types keep request.next.*)
insert into content_blocks(key, value, status) values
  ('request.next.3pl.1', 'Submitted|You get a reference number right away.', 'published'),
  ('request.next.3pl.2', 'Rates sent|Octopus sends storage, pick-and-pack and shipping rates for your goods.', 'published'),
  ('request.next.3pl.3', 'Accepted|You accept the rates in My account › 3PL warehouse.', 'published'),
  ('request.next.3pl.4', 'Send your first inbound notice|Tell us what is coming: cartons, SKUs and arrival date.', 'published'),
  ('request.next.3pl.5', 'Goods received and counted|We check and count every carton and put it on your stock list.', 'published'),
  ('request.next.3pl.6', 'Live|Orders ship from your stock and you follow everything in your account.', 'published')
on conflict (key) do nothing;

-- carrier name inside longer About blocks (replace only the phrase)
update content_blocks set value = replace(value, 'via YunExpress and 3PL partners', 'by Express, Standard and Economy, plus 3PL partners'), updated_at = now()
where key = 'about.pillars' and value like '%via YunExpress and 3PL partners%';
update content_blocks set value = replace(value, 'YunExpress tracking in your portal', 'Tracking in your portal'), updated_at = now()
where key = 'about.promises' and value like '%YunExpress tracking in your portal%';
update branches set description = replace(description, 'YunExpress''s main sorting hub for cross-border e-commerce is a 40-minute drive from the office.', 'The main cross-border e-commerce sorting hubs are a short drive from the office.')
where description like '%YunExpress''s main sorting hub%';
