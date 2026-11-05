-- Octopus B2B — seed data (SPEC §11.4). Idempotent where practical.

-- ── ADDON-24 guard: never seed a production database ──
do $$
begin
  if current_setting('app.environment', true) = 'production'
     or (to_regclass('public.site_settings') is not null
         and exists (select 1 from public.site_settings where key = 'app_environment' and value = '"production"'::jsonb)) then
    raise exception 'SEED_BLOCKED: this is the production database (site_settings.app_environment = production). Seed only staging / local projects.';
  end if;
end $$;

-- ── Roles & permission matrix (§3) ──
insert into roles(code, name, description, is_staff, sort) values
 ('admin','Admin','Owner: everything incl. master switches, approvals over limits, staff', true, 1),
 ('operations','Operations','KYC review, product moderation, request matching, orders and logistics', true, 2),
 ('finance','Finance','Payments, matching, refunds ≤ limit, payouts, statements', true, 3),
 ('support','Support','Support desk, replies, resolutions up to credit-note request', true, 4),
 ('sourcing_agent','Sourcing agent','RFQs, sourcing requests, AI tools', true, 5),
 ('qc_coordinator','QC coordinator','Samples, QC inspections, certifications', true, 6),
 ('content_editor','Content editor','Pages, templates, Terms drafts, branches (cannot publish legal)', true, 7),
 ('distributor','Distributor','Manage assigned suppliers, products, catalog, RFQs on behalf', true, 8),
 ('supplier','Supplier','Own products, RFQ replies, POs, payouts (portal off at launch)', false, 9),
 ('advertiser','Advertiser','Campaigns, budgets, ad stats', false, 10),
 ('customer','Customer','Buyer company user', false, 11)
on conflict (code) do nothing;

insert into permission_areas(code, name, sort) values
 ('dashboard','Dashboard & reports',1),('customers','Customers & KYC',2),('suppliers','Suppliers & verification',3),
 ('products','Products & moderation',4),('catalog','Categories & tags',5),('requests','RFQs & service requests',6),
 ('orders','Orders & logistics',7),('services_ops','Samples/QC/certification',8),('wallet','Wallet & payments',9),
 ('finance','Finance & approvals',10),('services','Services & charges',11),('ads','Advertising',12),
 ('integrations','Integrations & API',13),('content','Site content',14),('support','Support desk',15),
 ('staff','Staff & roles',16),('ai','AI product tools',17),('audit','Audit log',18)
on conflict (code) do nothing;

with m(role_code, area, actions) as (values
  ('operations','dashboard','{view}'),('operations','customers','{view,edit,approve}'),('operations','suppliers','{view,create,edit,approve}'),
  ('operations','products','{view,create,edit,approve}'),('operations','catalog','{view,create,edit}'),('operations','requests','{view,create,edit}'),
  ('operations','orders','{view,create,edit}'),('operations','services_ops','{view,edit}'),('operations','support','{view}'),('operations','ai','{view,create}'),
  ('finance','dashboard','{view,export}'),('finance','customers','{view}'),('finance','orders','{view}'),('finance','wallet','{view,create,edit,approve}'),
  ('finance','finance','{view,create,edit,approve,export}'),('finance','services','{view}'),('finance','ads','{view}'),
  ('support','dashboard','{view}'),('support','customers','{view}'),('support','orders','{view}'),('support','support','{view,create,edit}'),('support','requests','{view}'),
  ('sourcing_agent','requests','{view,create,edit}'),('sourcing_agent','products','{view}'),('sourcing_agent','suppliers','{view}'),('sourcing_agent','ai','{view,create}'),
  ('qc_coordinator','services_ops','{view,create,edit,approve}'),('qc_coordinator','requests','{view,edit}'),('qc_coordinator','orders','{view}'),
  ('content_editor','content','{view,create,edit}'),
  ('distributor','products','{view,create,edit}'),('distributor','catalog','{view,create,edit}'),('distributor','requests','{view,create}'),('distributor','ai','{view,create}')
)
insert into role_permissions(role_code, area, action)
select role_code, area, unnest(actions::text[]) from m
on conflict do nothing;

-- ── Site settings & feature flags (§9) ──
insert into site_settings(key, value, description, is_public) values
 ('wallet_enabled','true','Wallet on/off (WalletAdmin)', true),
 ('supplier_portal_enabled','false','Supplier self-service portal', true),
 ('supplier_sees_contacts_after_paid','true','Supplier sees buyer contacts after payment', false),
 ('ads_enabled','true','Advertising on/off', true),
 ('deposit_pct','30','Deposit % on proforma invoices', true),
 ('quote_validity_days','30','Quote validity (days)', true),
 ('claim_visible_days','7','Claim window for visible defects (days)', true),
 ('claim_hidden_days','30','Claim window for hidden defects (days)', true),
 ('finance_approval_limit_cents','100000','Approvals above this need Admin', false),
 ('currency','"USD"','Billing currency', true),
 ('stats','{"products":"2,400+","suppliers":"180","countries":"40+","bulk_saving":"25%"}','Homepage stats (replace with real figures)', true),
 ('ai_monthly_limit','200','AI tool calls per org per month', false)
on conflict (key) do nothing;

insert into company_profile(id, legal_name, brand, tagline, address, address_cn, contact_person, phone, whatsapp, email, website) values
 (1, 'Shenzhen Octopus Trading Co. Ltd.', 'Octopus B2B', 'Global Sourcing, Simplified',
  'Building 4, West 10th Floor, C103, SEG Science Park, 3012 Huaqiang North Road, Li Village Community, Huaqiang North Street, Futian District, Shenzhen, Guangdong, China',
  '广东省深圳市福田区华强北街道荔村社区华强北路3012号赛格科技园4栋西10层C座C103',
  'Shameer Abdul Vahab', '+86 188 2652 7644', '+8618826527644', 'support@octopusb2b.com', 'octopusb2b.com')
on conflict (id) do nothing;

insert into branches(name, city, country, address, phone, email, sort)
select 'Shenzhen head office', 'Shenzhen', 'China', 'Building 4, West 10th Floor, C103, SEG Science Park, 3012 Huaqiang North Road, Futian District, Shenzhen, Guangdong', '+86 188 2652 7644', 'support@octopusb2b.com', 1
where not exists (select 1 from branches);

insert into content_blocks(key, value) values
 ('topbar.left','Global B2B sourcing · All prices in USD'),
 ('home.eyebrow','Global sourcing, simplified'),
 ('home.title','Source industrial supplies from verified suppliers worldwide.'),
 ('home.subtitle','Compare tiered USD pricing, send one RFQ to several suppliers, and track every order from quote to delivery. Need warehousing or dropshipping too? Request it in the same place.'),
 ('home.trust','KYC-verified suppliers|Incoterms on every quote|Live order tracking'),
 ('home.how.1','Search or request|Find a listed product, or describe what you need and we source it for you.'),
 ('home.how.2','Compare quotes|Suppliers reply with USD tier prices, Incoterm and lead time, side by side.'),
 ('home.how.3','Order and track|Accept a quote, pay, and follow it to delivery with a commercial invoice ready.'),
 ('home.3pl.title','3PL fulfillment'),
 ('home.3pl.body','Warehousing, pick and pack, kitting, returns and customs clearance from vetted logistics partners in your target markets.'),
 ('home.3pl.points','Quotes per order, per pallet and setup fee in USD|Connects to Shopify, Amazon and WooCommerce|Standard, fragile, hazardous or temperature-controlled'),
 ('home.dropship.title','Dropshipping'),
 ('home.dropship.body','Sell without holding stock. Suppliers ship straight to your customers under your brand.'),
 ('home.dropship.points','White label, custom packaging and inserts|Delivery-time commitments per market|Works with your existing store platform'),
 ('home.cta.title','Can''t find what you need?'),
 ('home.cta.body','Tell us the product, quantity and destination. We''ll match you with suppliers who can quote.'),
 ('footer.about','Global B2B marketplace for industrial supplies, 3PL and dropshipping services.'),
 ('testimonials','[Customer testimonial: add real quotes after launch]|[Name], [Role], [Company, Country]')
on conflict (key) do nothing;

insert into pages(slug, title, body, status, is_legal, published_at) values
 ('about','About Octopus B2B','Octopus B2B is a global wholesale marketplace for industrial supplies operated by Shenzhen Octopus Trading Co. Ltd. Octopus is the seller on every order: invoices, payments and claims all run through Octopus.','published', false, now()),
 ('privacy','Privacy policy','[Draft privacy policy — replace with reviewed legal text in Admin › Site content.]','published', true, now()),
 ('contact','Contact us','Reach our sourcing team by email or WhatsApp. Details below come from Company & branches.','published', false, now())
on conflict (slug) do nothing;

insert into terms_versions(version, status, published_at, sections)
select 'v1.0', 'published', now(), jsonb_agg(jsonb_build_object('no', n, 'title', t, 'body', '[Draft — paste the reviewed clause text for "' || t || '" here in Admin › Site content › Terms.]') order by n)
from (values (1,'Definitions'),(2,'Parties and role of Octopus'),(3,'Accounts and KYC'),(4,'Quotations and orders'),(5,'Prices and payment'),
             (6,'Deposit and balance'),(7,'Production and quality control'),(8,'Shipping, Incoterms and risk'),(9,'Inspection and claims'),
             (10,'Returns, refunds and credit notes'),(11,'Wallet and services'),(12,'Liability'),(13,'Intellectual property and conduct'),
             (14,'Privacy and data'),(15,'Governing law and disputes')) s(n,t)
where not exists (select 1 from terms_versions);

-- ── Services & charges (prices are seed values; edit in Admin › Services) ──
insert into services(code, name, description, unit, sort) values
 ('rfq','RFQ / sourcing request','Send one request to several suppliers', 'per RFQ', 1),
 ('sample','Sample handling','Consolidate and forward product samples', 'per sample', 2),
 ('qc','QC inspection','Pre-shipment inspection with photo report', 'per inspection', 3),
 ('certification','Certification check','Verify certificates (CE, ISO, etc.)', 'per certificate', 4),
 ('3pl','3PL request','Warehousing and fulfilment quotation', 'per request', 5),
 ('dropship','Dropship request','Octopus Dropship onboarding', 'per request', 6)
on conflict (code) do nothing;
insert into service_prices(service_code, amount_usd_cents, effective_from)
select code, amt, now() - interval '1 day' from (values ('rfq',500),('sample',2500),('qc',19900),('certification',4900),('3pl',0),('dropship',0)) v(code, amt)
where not exists (select 1 from service_prices);

insert into carriers(code, name) values ('yunexpress','YunExpress') on conflict do nothing;
insert into sla_policies(priority, first_response_hours, resolve_hours) values ('low',48,120),('normal',24,72),('high',8,24),('urgent',2,8) on conflict do nothing;
insert into ad_placements(code, name, min_cpc_cents) values ('home_banner','Home banner',25),('category_banner','Category banner',20),('product_side','Product page side',15),('search_top','Search top',30) on conflict do nothing;
insert into support_macros(title, body) select * from (values
 ('Request photos','Thanks for reaching out. Could you share clear photos of the issue and the carton label so we can raise it with the supplier?'),
 ('Refund in progress','We have approved your claim. The refund has been sent to finance for approval and will appear in your wallet ledger.')) v
where not exists (select 1 from support_macros);
insert into integrations(code, name, kind, mode, status) values
 ('yunexpress','YunExpress','carrier','sandbox','not_configured'),
 ('payment','Payment partner (Stripe / Airwallex)','payment','sandbox','not_configured'),
 ('email','Transactional email','email','sandbox','not_configured'),
 ('ai','AI text & image (OpenAI)','ai','live','not_configured'),
 ('dropship','Octopus Dropship','dropship','off','not_configured'),
 ('source_1688','1688 Open Platform','source','off','not_configured'),
 ('source_alibaba','Alibaba.com','source','off','not_configured')
on conflict (code) do nothing;

-- ── Categories (4 levels) ──
do $$
declare l1 uuid; l2 uuid; l3 uuid;
  tree jsonb := '[
   {"n":"Fasteners","hs":"73","c":[{"n":"Bolts","c":[{"n":"Hex bolts","c":["Stainless hex bolts","Carbon steel hex bolts"]},{"n":"Carriage bolts","c":[]}]},{"n":"Nuts & washers","c":[{"n":"Hex nuts","c":[]}]},{"n":"Anchors & rivets","c":[]}]},
   {"n":"Power tools","hs":"84","c":[{"n":"Drills & drivers","c":[{"n":"Impact drivers","c":["Cordless impact drivers"]}]},{"n":"Grinders","c":[]},{"n":"Saws","c":[]}]},
   {"n":"Safety & PPE","hs":"40","c":[{"n":"Gloves","c":[{"n":"Coated gloves","c":["Nitrile-coated gloves"]},{"n":"Disposable gloves","c":[]}]},{"n":"Eye & face","c":[]},{"n":"Workwear","c":[]}]},
   {"n":"Electrical","hs":"85","c":[{"n":"Cables & wires","c":[]},{"n":"Cable ties","c":[]},{"n":"Lighting","c":[]}]},
   {"n":"Packaging","hs":"48","c":[{"n":"Corrugated boxes","c":[]},{"n":"Stretch film & tape","c":[]}]},
   {"n":"Hydraulics & pneumatics","hs":"84","c":[{"n":"Fittings","c":[]},{"n":"Hoses","c":[]}]},
   {"n":"Material handling","hs":"84","c":[{"n":"Pallet trucks","c":[]},{"n":"Storage bins","c":[]}]},
   {"n":"Industrial chemicals","hs":"38","c":[{"n":"Lubricants","c":[]},{"n":"Adhesives & sealants","c":[]}]}
  ]';
  a jsonb; b jsonb; c jsonb; d jsonb; i int := 0; j int; k int; m int;
begin
  if exists (select 1 from categories) then return; end if;
  for a in select * from jsonb_array_elements(tree) loop
    i := i + 1;
    insert into categories(name, slug, level, hs_code, sort) values (a->>'n', lower(regexp_replace(a->>'n','[^a-zA-Z0-9]+','-','g')), 1, a->>'hs', i) returning id into l1;
    j := 0;
    for b in select * from jsonb_array_elements(a->'c') loop
      j := j + 1;
      insert into categories(parent_id, name, slug, level, sort) values (l1, b->>'n', lower(regexp_replace(b->>'n','[^a-zA-Z0-9]+','-','g')), 2, j) returning id into l2;
      k := 0;
      for c in select * from jsonb_array_elements(b->'c') loop
        k := k + 1;
        insert into categories(parent_id, name, slug, level, sort) values (l2, c->>'n', lower(regexp_replace(c->>'n','[^a-zA-Z0-9]+','-','g')), 3, k) returning id into l3;
        m := 0;
        for d in select * from jsonb_array_elements(c->'c') loop
          m := m + 1;
          insert into categories(parent_id, name, slug, level, sort) values (l3, d#>>'{}', lower(regexp_replace(d#>>'{}','[^a-zA-Z0-9]+','-','g')), 4, m);
        end loop;
      end loop;
    end loop;
  end loop;
end $$;

insert into tags(name, slug, kind) values
 ('CE','ce','certification'),('ISO 9001','iso-9001','certification'),('RoHS','rohs','certification'),('EN 388','en-388','certification'),
 ('Octopus Dropship','octopus-dropship','service'),('Ready to ship','ready-to-ship','service'),('Best seller','best-seller','general'),('Eco','eco','general')
on conflict do nothing;

-- ── Suppliers (codes match the design) ──
insert into suppliers(code, legal_name, country, city, supplier_type, contact_name, contact_email, contact_phone, verified, main_categories) values
 ('OCT-1101','Ningbo Hengda Fastener Co. (demo)','CN','Ningbo','Manufacturer','[Contact]','sales@demo-1101.example','+86 000 0000 1101', true,'Fasteners · Anchors · Rivets'),
 ('OCT-1108','Rhein Werkzeug GmbH (demo)','DE','Cologne','Wholesaler','[Contact]','sales@demo-1108.example','+49 000 0001108', true,'Power tools · Hand tools'),
 ('OCT-1115','Saigon Glove Industries (demo)','VN','Ho Chi Minh City','Manufacturer','[Contact]','sales@demo-1115.example','+84 000 001115', true,'Gloves · Workwear · PPE'),
 ('OCT-1118','Lanka Safety Products (demo)','LK','Colombo','Manufacturer','[Contact]','sales@demo-1118.example','+94 000 001118', true,'Gloves · Safety'),
 ('OCT-1121','Penang Electric Components (demo)','MY','Penang','Manufacturer','[Contact]','sales@demo-1121.example','+60 000 001121', true,'Electrical · Cable ties'),
 ('OCT-1129','Anatolia Pack Ambalaj (demo)','TR','Istanbul','Manufacturer','[Contact]','sales@demo-1129.example','+90 000 001129', true,'Packaging · Industrial chemicals')
on conflict (code) do nothing;
insert into supplier_switches(supplier_id) select id from suppliers on conflict do nothing;

-- ── 60 products across 6 suppliers ──
do $$
declare r record; v_id uuid; v_cat uuid; v_sup uuid; n int := 0; v_slug text;
begin
  if exists (select 1 from products) then return; end if;
  for r in select * from (values
   -- title, category, supplier, unit, moq, base cents, lead, incoterm, origin, hs, dropship, rts
   ('Stainless steel hex bolts, M10 × 40 mm, A2-70','Stainless hex bolts','OCT-1101','pcs',1000,19,15,'FOB','CN','7318.15',false,true),
   ('Stainless steel hex bolts, M8 × 30 mm, A2-70','Stainless hex bolts','OCT-1101','pcs',1000,14,15,'FOB','CN','7318.15',false,true),
   ('Stainless steel hex bolts, M12 × 50 mm, A4-80','Stainless hex bolts','OCT-1101','pcs',500,38,18,'FOB','CN','7318.15',false,false),
   ('Zinc-plated carbon steel hex bolts, M10 × 60, grade 8.8','Carbon steel hex bolts','OCT-1101','pcs',2000,11,12,'FOB','CN','7318.15',false,true),
   ('Galvanised carriage bolts, M8 × 80','Carriage bolts','OCT-1101','pcs',2000,9,14,'FOB','CN','7318.15',false,false),
   ('Stainless hex nuts M10, A2, DIN 934','Hex nuts','OCT-1101','pcs',5000,3,10,'FOB','CN','7318.16',true,true),
   ('Flat washers M10, stainless A2, DIN 125','Nuts & washers','OCT-1101','pcs',10000,2,10,'FOB','CN','7318.22',true,true),
   ('Wedge anchors M12 × 100, zinc plated','Anchors & rivets','OCT-1101','pcs',1000,22,16,'FOB','CN','7318.19',false,false),
   ('Blind rivets 4.8 × 12 mm, aluminium/steel','Anchors & rivets','OCT-1101','pcs',10000,1,10,'FOB','CN','7318.23',true,true),
   ('Self-drilling screws 4.8 × 25, hex washer head','Fasteners','OCT-1101','pcs',5000,3,12,'FOB','CN','7318.14',false,true),
   ('Cordless impact driver, 18 V brushless','Cordless impact drivers','OCT-1108','units',20,6400,9,'DDP','DE','8467.29',false,true),
   ('Cordless drill driver, 18 V, 2 × 4 Ah kit','Drills & drivers','OCT-1108','units',20,8900,9,'DDP','DE','8467.21',false,true),
   ('Angle grinder 125 mm, 1100 W','Grinders','OCT-1108','units',30,4200,10,'EXW','DE','8467.29',false,false),
   ('Circular saw 190 mm, 1400 W','Saws','OCT-1108','units',20,7600,12,'EXW','DE','8467.22',false,false),
   ('Rotary hammer SDS-plus, 800 W','Drills & drivers','OCT-1108','units',20,9800,12,'EXW','DE','8467.21',false,false),
   ('Jigsaw 650 W, pendulum action','Saws','OCT-1108','units',30,5400,10,'EXW','DE','8467.29',false,false),
   ('Bench grinder 200 mm, 370 W','Grinders','OCT-1108','units',10,8200,14,'EXW','DE','8460.29',false,false),
   ('Cordless impact wrench, 18 V, ½" drive','Impact drivers','OCT-1108','units',20,11200,10,'DDP','DE','8467.29',false,true),
   ('Drill bit set HSS, 19 pcs, metal case','Drills & drivers','OCT-1108','sets',50,1250,8,'EXW','DE','8207.50',true,true),
   ('Oscillating multi-tool, 300 W','Power tools','OCT-1108','units',30,4800,10,'EXW','DE','8467.29',false,false),
   ('Nitrile-coated work gloves, size L','Nitrile-coated gloves','OCT-1115','pairs',500,82,18,'FOB','VN','6116.10',true,true),
   ('Nitrile-coated work gloves, size M','Nitrile-coated gloves','OCT-1115','pairs',500,80,18,'FOB','VN','6116.10',true,true),
   ('Cut-resistant gloves, level C, PU palm','Coated gloves','OCT-1115','pairs',300,195,20,'FOB','VN','6116.10',false,false),
   ('Disposable nitrile gloves, 100/box, powder-free','Disposable gloves','OCT-1115','boxes',200,420,14,'FOB','VN','4015.19',true,true),
   ('Hi-vis safety vest, EN ISO 20471 class 2','Workwear','OCT-1115','pcs',500,140,15,'FOB','VN','6211.43',false,true),
   ('Polycotton work trousers, knee-pad pockets','Workwear','OCT-1115','pcs',200,780,25,'FOB','VN','6203.42',false,false),
   ('Safety glasses, anti-fog, clear lens','Eye & face','OCT-1115','pcs',500,95,12,'FOB','VN','9004.90',true,true),
   ('Face shield with brow guard','Eye & face','OCT-1115','pcs',200,230,14,'FOB','VN','3926.20',false,false),
   ('Latex-coated grip gloves, crinkle finish','Coated gloves','OCT-1118','pairs',1000,66,24,'CIF','LK','4015.19',false,false),
   ('Nitrile-coated work gloves, size L (sandy finish)','Nitrile-coated gloves','OCT-1118','pairs',1000,66,24,'CIF','LK','6116.10',false,false),
   ('Heavy-duty rubber gloves, 38 cm','Gloves','OCT-1118','pairs',500,120,21,'CIF','LK','4015.19',false,false),
   ('Leather welding gloves, 35 cm','Gloves','OCT-1118','pairs',300,360,25,'CIF','LK','4203.29',false,false),
   ('Cotton knitted gloves, PVC dots','Gloves','OCT-1118','pairs',2000,28,20,'CIF','LK','6116.10',true,true),
   ('Chemical-resistant nitrile gauntlets','Gloves','OCT-1118','pairs',300,240,24,'CIF','LK','4015.19',false,false),
   ('Anti-vibration gloves, gel padded','Gloves','OCT-1118','pairs',200,520,28,'CIF','LK','6116.10',false,false),
   ('Cryogenic gloves, mid-arm','Gloves','OCT-1118','pairs',50,2100,30,'CIF','LK','6116.99',false,false),
   ('Nylon cable ties 300 × 4.8 mm, black, UV','Cable ties','OCT-1121','packs',500,190,12,'FOB','MY','3926.90',true,true),
   ('Nylon cable ties 200 × 3.6 mm, natural','Cable ties','OCT-1121','packs',500,110,12,'FOB','MY','3926.90',true,true),
   ('Stainless steel cable ties 360 mm','Cable ties','OCT-1121','packs',200,640,15,'FOB','MY','7326.20',false,false),
   ('PVC insulated copper wire 2.5 mm², 100 m','Cables & wires','OCT-1121','rolls',50,3800,18,'FOB','MY','8544.49',false,false),
   ('Flexible cable H05VV-F 3G1.5, 100 m','Cables & wires','OCT-1121','rolls',30,5600,18,'FOB','MY','8544.49',false,false),
   ('LED high bay light 150 W, IP65','Lighting','OCT-1121','units',20,3900,20,'FOB','MY','9405.11',false,false),
   ('LED tube T8 1200 mm, 18 W','Lighting','OCT-1121','units',200,210,15,'FOB','MY','8539.52',true,true),
   ('Heat shrink tubing kit, 560 pcs','Electrical','OCT-1121','kits',100,480,10,'FOB','MY','3917.32',true,true),
   ('Industrial plug 32 A 5-pin, IP67','Electrical','OCT-1121','pcs',100,520,14,'FOB','MY','8536.69',false,false),
   ('Junction box IP66, 150 × 110 × 70','Electrical','OCT-1121','pcs',200,260,14,'FOB','MY','8538.10',false,true),
   ('Double-wall corrugated boxes, 40 × 30 × 30 cm','Corrugated boxes','OCT-1129','pcs',2000,47,12,'EXW','TR','4819.10',false,true),
   ('Single-wall shipping boxes, 30 × 20 × 15 cm','Corrugated boxes','OCT-1129','pcs',5000,22,10,'EXW','TR','4819.10',true,true),
   ('Die-cut mailer boxes, kraft, A4','Corrugated boxes','OCT-1129','pcs',3000,35,12,'EXW','TR','4819.10',true,true),
   ('Stretch film 500 mm × 23 µ, 300 m','Stretch film & tape','OCT-1129','rolls',200,540,10,'EXW','TR','3920.10',false,true),
   ('BOPP packing tape 48 mm × 66 m, clear','Stretch film & tape','OCT-1129','rolls',1000,62,8,'EXW','TR','3919.10',true,true),
   ('Hydraulic hose 1/2" 2SN, per metre','Hoses','OCT-1129','m',200,410,18,'EXW','TR','4009.42',false,false),
   ('Brass push-in fittings 8 mm, pack of 10','Fittings','OCT-1129','packs',100,690,14,'EXW','TR','7412.20',false,false),
   ('Hydraulic quick couplings 1/2" ISO A','Fittings','OCT-1129','pcs',100,880,16,'EXW','TR','8481.80',false,false),
   ('Hand pallet truck 2500 kg','Pallet trucks','OCT-1129','units',5,21500,25,'EXW','TR','8427.90',false,false),
   ('Stackable storage bins, 15 L, blue','Storage bins','OCT-1129','pcs',200,390,14,'EXW','TR','3923.10',true,true),
   ('Multipurpose lithium grease, 400 g','Lubricants','OCT-1129','pcs',500,210,12,'EXW','TR','3403.99',true,true),
   ('Penetrating oil spray, 400 ml','Lubricants','OCT-1129','pcs',500,180,12,'EXW','TR','3403.19',true,true),
   ('Polyurethane sealant 600 ml, grey','Adhesives & sealants','OCT-1129','pcs',300,420,14,'EXW','TR','3214.10',false,false),
   ('Cyanoacrylate adhesive 20 g, industrial','Adhesives & sealants','OCT-1129','pcs',1000,95,10,'EXW','TR','3506.10',true,true)
  ) t(title, cat, sup, unit, moq, cents, lead, inc, origin, hs, ds, rts) loop
    n := n + 1;
    select id into v_cat from categories where name = r.cat order by level desc limit 1;
    select id into v_sup from suppliers where code = r.sup;
    v_slug := lower(regexp_replace(regexp_replace(r.title, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'));
    insert into products(slug, title, description, supplier_id, category_id, status, unit, moq, lead_time_days, incoterm, origin_country, hs_code,
                         octopus_dropship, ready_to_ship, featured, seo_title, seo_description, min_price_cents)
    values (v_slug, r.title,
            r.title || '. Wholesale supply with tiered USD pricing, ' || r.inc || ' terms and an average lead time of ' || r.lead || ' days. Quality checked and shipped through Octopus B2B.',
            v_sup, v_cat, 'live', r.unit, r.moq, r.lead, r.inc, r.origin, r.hs, r.ds, r.rts, n in (1,11,21,47,37,52),
            r.title || ' | Wholesale | Octopus B2B', 'Buy ' || r.title || ' wholesale from verified suppliers. MOQ ' || r.moq || ' ' || r.unit || '.',
            round(r.cents * 0.74))
    returning id into v_id;
    insert into price_tiers(product_id, min_qty, unit_price_cents) values
      (v_id, r.moq, r.cents), (v_id, r.moq * 5, round(r.cents * 0.88)), (v_id, r.moq * 10, round(r.cents * 0.74));
    insert into product_costs(product_id, supplier_cost_cents) values (v_id, round(r.cents * 0.62));
    insert into product_specs(product_id, name, value, sort) values
      (v_id, 'Origin', r.origin, 1), (v_id, 'HS code', r.hs, 2), (v_id, 'Incoterm', r.inc, 3), (v_id, 'MOQ', r.moq || ' ' || r.unit, 4), (v_id, 'Lead time', r.lead || ' days', 5);
    if r.ds then insert into product_tags(product_id, tag_id) select v_id, id from tags where slug = 'octopus-dropship'; end if;
    if r.rts then insert into product_tags(product_id, tag_id) select v_id, id from tags where slug = 'ready-to-ship'; end if;
    insert into product_tags(product_id, tag_id) select v_id, id from tags where slug = (array['ce','iso-9001','rohs','en-388'])[1 + (n % 4)];
  end loop;
  -- recommendations: same top-level category first, then anything
  insert into recommendations(product_id, recommended_id, score)
  select p.id, q.id, case when p.category_id = q.category_id then 2 else 1 end
  from products p join products q on q.id <> p.id and q.supplier_id = p.supplier_id;
end $$;

-- certificates per supplier
insert into certificates(supplier_id, name, issuer, number, status, expires_at)
select s.id, c.name, c.issuer, 'CERT-' || s.code || '-' || c.n, 'verified', current_date + 365
from suppliers s cross join (values ('ISO 9001:2015','TÜV',1),('CE Declaration','SGS',2)) c(name, issuer, n)
where not exists (select 1 from certificates);

