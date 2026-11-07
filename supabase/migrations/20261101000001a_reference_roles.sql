-- Replay fix (7 Nov 2026): later migrations grant permissions to these roles, which were only created by seed.sql.
-- Runs ONLY on an empty database (a new staging/local project). On a database that already has roles
-- (production) this is a no-op, so it never re-adds permissions an admin removed in Staff & roles.
do $replay$
begin
  if exists (select 1 from roles) then return; end if;
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
end $replay$;
