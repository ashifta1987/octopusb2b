-- About page (docs/design/About.png): China sourcing offices + company details, all from the CMS.
-- Branch cards get the fields the design shows; company_profile gets the Chinese legal name, registration place
-- and governing law. Office phone numbers that are not known yet (design shows "[ext]") are left NULL — the page
-- simply omits the line until an admin enters the real number in Admin → Site content → Company & branches.

alter table branches
  add column if not exists city_local text,            -- 深圳
  add column if not exists province text,               -- Guangdong province
  add column if not exists badge text,                  -- Headquarters / Sourcing office / Sourcing & shipping
  add column if not exists is_hq boolean not null default false,
  add column if not exists tagline text,
  add column if not exists specialities text[] not null default '{}',
  add column if not exists description text,
  add column if not exists hours text,
  add column if not exists tone text not null default 'blue'
    check (tone in ('blue', 'rose', 'cyan', 'pink', 'amber', 'green', 'purple'));

alter table company_profile
  add column if not exists legal_name_cn text,
  add column if not exists registered_in text,
  add column if not exists governing_law text;

update company_profile set
  legal_name_cn = coalesce(legal_name_cn, '深圳八爪鱼贸易有限公司'),
  registered_in = coalesce(registered_in, 'Shenzhen, Guangdong, People''s Republic of China'),
  governing_law = coalesce(governing_law, 'Hong Kong law · HKIAC arbitration')
where id = 1;

-- Shenzhen head office (existing row): fill the design fields, keep the existing contacts.
update branches set
  name = 'Shenzhen headquarters', city_local = '深圳', province = 'Guangdong province', badge = 'Headquarters', is_hq = true,
  tagline = 'The tech capital. HQ, finance, platform engineering.',
  specialities = array['Electronics', 'LED & lighting', 'Consumer tech', 'Smart devices', 'Cables & connectors'],
  description = 'Centred on Huaqiangbei — the world''s largest electronics market — Shenzhen is where we handle tech sourcing, platform operations and buyer support. YunExpress''s main sorting hub for cross-border e-commerce is a 40-minute drive from the office.',
  hours = 'Mon–Sat 09:00–18:30 CST', tone = 'blue'
where city = 'Shenzhen' and country = 'China';

insert into branches (name, city, country, address, phone, email, sort, active, city_local, province, badge, is_hq, tagline, specialities, description, hours, tone)
select * from (values
  ('Foshan sourcing office', 'Foshan', 'China', 'Lecong Furniture City, Lecong Town, Shunde District, Foshan', null::text, 'foshan@octopusb2b.com', 2, true,
   '佛山', 'Guangdong province', 'Sourcing office', false, 'Home & building capital of South China.',
   array['Furniture', 'Ceramics & tiles', 'Lighting', 'Kitchenware', 'Sanitary ware', 'Appliances'],
   'Foshan is the furniture, ceramics and small-appliance capital of China — Shunde alone makes most of the world''s air-con units. Our team here walks the Lecong furniture market and Nanzhuang tile district weekly and audits production for container-load orders.',
   'Mon–Sat 09:00–18:30 CST', 'rose'),
  ('Ningbo sourcing & shipping office', 'Ningbo', 'China', 'International Trade Centre, Yinzhou District, Ningbo', null, 'ningbo@octopusb2b.com', 3, true,
   '宁波', 'Zhejiang province', 'Sourcing & shipping', false, 'World''s #1 cargo port. Hardware heartland.',
   array['Fasteners & hardware', 'Hand & power tools', 'Moulds & dies', 'Auto parts', 'Textile machinery', 'Garments'],
   'Ningbo-Zhoushan is the busiest cargo port on earth. We put a team here for two reasons: half of the fastener, tool and mould factories in China are within an hour''s drive, and container pickup is next door. FOB-Ningbo orders ship the same week they''re inspected.',
   'Mon–Sat 08:30–18:00 CST', 'cyan'),
  ('Yiwu sourcing office', 'Yiwu', 'China', 'Futian International Trade Mart, Chouzhou North Road, Yiwu', null, 'yiwu@octopusb2b.com', 4, true,
   '义乌', 'Zhejiang province', 'Sourcing office', false, 'World''s largest wholesale market. Small-commodity king.',
   array['Small commodities', 'Promotional products', 'Fashion accessories', 'Stationery', 'Toys', 'Textiles & socks'],
   'Yiwu International Trade Market has 75,000 stalls across 5 districts — if a small item exists, it''s for sale here. Our Yiwu team walks the districts to find white-label winners, consolidate mixed-category containers and run OEM for private-label resellers.',
   'Mon–Sat 08:30–18:00 CST', 'pink')
) v(name, city, country, address, phone, email, sort, active, city_local, province, badge, is_hq, tagline, specialities, description, hours, tone)
where not exists (select 1 from branches b where b.city = v.city);

-- Page copy. {tokens} are filled from live data / settings; items whose token has no verified value are hidden
-- or replaced by the *_plain variant (no fabricated figures).
insert into content_blocks(key, value) values
  ('about.hero.eyebrow', 'About · {legal_name}'),
  ('about.hero.title', 'Sourcing from {offices_word} China hubs. Shipping to {countries} countries.'),
  ('about.hero.title_plain', 'Sourcing from {offices_word} China hubs. Shipping worldwide.'),
  ('about.hero.subtitle', 'We''re the merchant of record on every order. Our teams inspect factories, run RFQs, hold deposits in escrow and settle claims — so you deal with one party under Hong Kong law, not with each supplier separately.'),
  ('about.hero.buttons', 'Send us an RFQ|See our offices|WhatsApp sales'),
  ('about.stats.labels', 'Sourcing offices in China|Verified suppliers|Products listed|Markets served via YunExpress|Markets with orders'),
  ('about.who.eyebrow', 'Who we are'),
  ('about.who.title', 'A trading company first, a platform second.'),
  ('about.who.body', 'Octopus B2B is a global sourcing marketplace operated by *{legal_name}*, a Chinese trading company with offices in {offices_word} of the country''s biggest sourcing hubs. We buy from the factory, we sell to you, and we handle the shipping end to end — one invoice, one timeline, one phone number.|Buyers see a product and a price; behind the scenes our people visit the factory, inspect the batch, print the labels and settle any claim. The platform is just the fastest way to work with us.'),
  ('about.pillars', 'Merchant of record~Octopus is the seller on every order. T&Cs under Hong Kong law.|Boots on the ground~Teams in {cities} visit factories weekly.|Global reach~Shipping to {countries} countries via YunExpress and 3PL partners.|Compliance covered~CE, RoHS, FCC, FDA testing and paperwork arranged for your market.'),
  ('about.pillars.reach_plain', 'Worldwide shipping via YunExpress and 3PL partners.'),
  ('about.offices.eyebrow', 'Our offices in China'),
  ('about.offices.title', '{Offices_word} cities. {Offices_word} specialities.'),
  ('about.offices.intro', 'Every category has a home city in China. We put a sourcing team in each so an RFQ reaches a factory the same day — and so somebody we trust can walk the production line before your deposit leaves escrow.'),
  ('about.offices.empty', 'Office details are being updated. Contact us for the nearest sourcing team.'),
  ('about.promises.eyebrow', 'The way we work'),
  ('about.promises.title', 'Promises we put in writing.'),
  ('about.promises', 'USD-first pricing~All quotes in USD. CNY available platform-wide at an admin-approved FX rate.|{deposit_pct}% deposit, escrow-held~Your deposit sits with Octopus, not with the factory, until written confirmation of the batch.|Independent QC~Pre-shipment inspection with a signed PDF report, before the balance invoice.|{claim_visible_days}-day visible, {claim_hidden_days}-day hidden claims~Clear claim windows written into every order. Governed by Hong Kong law.|Live tracking~YunExpress tracking in your portal and emailed to your customers on key events.|One phone number~You deal with Octopus — never with the factory, never with the carrier. One escalation path.'),
  ('about.company.eyebrow', 'Company details'),
  ('about.partners.title', 'Partner network'),
  ('about.partners', 'YunExpress logistics|1688 Open Platform|Alibaba.com|SGS · TÜV · Intertek|Shopify · Wix · WooCommerce|Octopus Dropship app'),
  ('about.company.buttons', 'Send us an RFQ|Become a supplier')
on conflict (key) do nothing;

