// Creates one demo user per role (SPEC §11.4) and runs a demo trade flow through the real RPCs.
// Usage: DEMO_PASSWORD=... node scripts/seed-users.mjs
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { assertNotProduction } from './lib-env-guard.mjs';
config({ path: '.env.local' });

const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('Set DEMO_PASSWORD');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertNotProduction(db, 'seed-users');

const users = [
  { email: 'admin@demo.octopusb2b.com', name: 'Demo Admin', roles: ['admin'] },
  { email: 'finance@demo.octopusb2b.com', name: 'Demo Finance', roles: ['finance'] },
  { email: 'finance2@demo.octopusb2b.com', name: 'Demo Finance Checker', roles: ['finance'] },
  { email: 'ops@demo.octopusb2b.com', name: 'Demo Operations', roles: ['operations'] },
  { email: 'support@demo.octopusb2b.com', name: 'Demo Support', roles: ['support'] },
  { email: 'distributor@demo.octopusb2b.com', name: 'Demo Distributor', roles: ['distributor'] },
  { email: 'content@demo.octopusb2b.com', name: 'Demo Content Editor', roles: ['content_editor'] },
  { email: 'qc@demo.octopusb2b.com', name: 'Demo QC', roles: ['qc_coordinator'] },
  { email: 'buyer@demo.octopusb2b.com', name: 'Alex Buyer', roles: ['customer'], org: { company: 'Rotterdam Industrial BV (demo)', country: 'NL', city: 'Rotterdam' } },
];

const ids = {};
for (const u of users) {
  let id;
  const { data, error } = await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.name } });
  if (error) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    id = list.users.find((x) => x.email === u.email)?.id;
    if (!id) throw error;
    await admin.auth.admin.updateUserById(id, { password });
  } else id = data.user.id;
  ids[u.email.split('@')[0]] = id;
  await db.query(`insert into profiles(id, full_name, email, totp_required) values ($1,$2,$3,$4)
                  on conflict (id) do update set full_name = excluded.full_name`, [id, u.name, u.email, !u.org]);
  for (const r of u.roles) await db.query('insert into user_roles(user_id, role_code) values ($1,$2) on conflict do nothing', [id, r]);
  console.log('user', u.email, id);
}

// helper: run SQL as a given user (auth.uid() + role) inside one transaction
async function as(userId, fn) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' }), userId]);
    const r = await fn();
    await db.query('commit');
    return r;
  } catch (e) { await db.query('rollback'); throw e; }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// distributor manages 4 of the 6 suppliers
await db.query(`insert into distributor_suppliers(distributor_id, supplier_id)
  select $1, id from suppliers where code in ('OCT-1101','OCT-1108','OCT-1115','OCT-1129') on conflict do nothing`, [ids.distributor]);

const existing = await one('select org_id from org_members where user_id = $1', [ids.buyer]);
if (existing) { console.log('demo flow already seeded'); await db.end(); process.exit(0); }

const buyer = ids.buyer, fin = ids.finance, ops = ids.ops;
const org = (await as(buyer, () => one(`select complete_onboarding('Alex Buyer','Rotterdam Industrial BV (demo)','NL','+31 10 000 0000','Importer / wholesaler','Rotterdam') v`))).v;
console.log('org', org);
await as(buyer, () => one(`select submit_kyc('Rotterdam Industrial BV (demo)','NL-KVK-00000000','Waalhaven 1, Rotterdam, NL','Alex Buyer','+31 10 000 0000','buyer@demo.octopusb2b.com')`));
const kyc = await one('select id from kyc_submissions where org_id = $1', [org]);
await as(ops, () => one(`select review_kyc($1,'verified','Demo verification')`, [kyc.id]));

// wallet top-up $500 confirmed by finance
const t = (await as(buyer, () => one(`select request_topup(50000,'bank_transfer','DEMO-TOPUP-1') v`))).v;
await as(fin, () => one('select confirm_topup($1)', [t]));

// RFQ → 3 quotes
const gloves = await one(`select id, title from products where slug like 'nitrile-coated-work-gloves-size-l' limit 1`);
const rfq = (await as(buyer, () => one(`select submit_rfq('5,000 pairs · Nitrile-coated work gloves',5000,'Size L, EN 388, ship to Rotterdam',$1,'NL','Rotterdam',60,'FOB') v`, [gloves.id]))).v;
const sup = async (code) => (await one('select id from suppliers where code = $1', [code])).id;
const q1 = (await as(ops, async () => one(`select send_quote($1,$2,61,5000,'FOB',18,0,'EN 388 certified') v`, [rfq, await sup('OCT-1115')]))).v;
await as(ops, async () => one(`select send_quote($1,$2,66,5000,'CIF',24,0,null)`, [rfq, await sup('OCT-1118')]));
await as(ops, async () => one(`select send_quote($1,$2,69,5000,'FOB',21,0,null)`, [rfq, await sup('OCT-1121')]));

// Second RFQ fully through to shipped
const bolts = await one(`select id from products where slug = 'stainless-steel-hex-bolts-m10-40-mm-a2-70'`);
const rfq2 = (await as(buyer, () => one(`select submit_rfq('10,000 hex bolts M10',10000,'A2-70, DIN 933',$1,'NL','Rotterdam',null,'FOB') v`, [bolts.id]))).v;
const q2 = (await as(ops, async () => one(`select send_quote($1,$2,14,10000,'FOB',15,0,null) v`, [rfq2, await sup('OCT-1101')]))).v;
const ord = (await as(buyer, () => one('select approve_quote($1) v', [q2]))).v;
console.log('order', ord);
await as(fin, () => one(`select record_payment($1, 42000, 'bank_transfer', 'DEMO-DEP-1')`, [ord.order_id]));
for (const s of ['confirmed', 'in_production', 'balance_pending'])
  await as(ops, () => one(`select transition_order($1, $2::order_status)`, [ord.order_id, s]));
await as(fin, () => one(`select record_payment($1, 98000, 'bank_transfer', 'DEMO-BAL-1')`, [ord.order_id]));
await as(ops, () => one(`select transition_order($1, 'ready_to_ship')`, [ord.order_id]));
const shp = await one(`insert into shipments(order_id, org_id, carrier_code, service_code, tracking_no, status, weight_kg, rate_cents, eta, last_event_at)
  values ($1,$2,'yunexpress','YunExpress Global Standard','YT2530412345678','in_transit',120,38000,current_date + 12, now()) returning id`, [ord.order_id, org]);
await db.query(`insert into tracking_events(shipment_id, org_id, status, description, location, occurred_at) values
  ($1,$2,'created','Shipment created, label printed','Shenzhen, CN', now() - interval '3 days'),
  ($1,$2,'picked_up','Picked up by YunExpress','Shenzhen, CN', now() - interval '2 days'),
  ($1,$2,'in_transit','Departed origin facility','Shenzhen, CN', now() - interval '1 day')`, [shp.id, org]);
await as(ops, () => one(`select transition_order($1, 'shipped')`, [ord.order_id]));

// service request paid from wallet + a support ticket
await as(buyer, () => one(`select request_service('qc', '{"notes":"Pre-shipment inspection for ORD gloves"}'::jsonb, $1)`, [gloves.id]));
await as(buyer, () => one(`select create_ticket('Carton damaged on arrival','complaint','Two cartons arrived crushed; photos attached.', $1, 'high')`, [ord.order_id]));

// an ad campaign for the buyer org (advertiser)
await db.query(`insert into ad_campaigns(org_id, name, placement, headline, body, link, daily_budget_cents, max_cpc_cents, status)
  values ($1,'House ad · M10 bolts','home_banner','M10 stainless bolts from $0.14','A2-70, DIN 933 · ships in 15 days · Supplier OCT-1101','/p/stainless-steel-hex-bolts-m10-40-mm-a2-70',2000,30,'active')`, [org]);
console.log('demo flow seeded; quote waiting:', q1);
await db.end();
