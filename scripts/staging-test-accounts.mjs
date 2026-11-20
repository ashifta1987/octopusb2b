// STAGING ONLY — fixture accounts the database tests act as (admin@, ops@, finance@, buyer@demo.octopusb2b.com).
// They exist only so the whole DB test suite runs on staging; normal sign-in is BLOCKED (banned) — the tests never sign
// in, they act through JWT claims inside rolled-back transactions. Idempotent: safe to run again.
// Run: node scripts/staging-test-accounts.mjs
import pg from 'pg'; import { createClient } from '@supabase/supabase-js'; import crypto from 'node:crypto';
import { loadStagingEnvOrExit, assertStagingDatabase } from './lib-staging-guard.mjs';
loadStagingEnvOrExit();                                   // stops unless the Supabase URL + database are the staging project
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);

const ACCOUNTS = [
  { email: 'admin@demo.octopusb2b.com', name: 'TEST FIXTURE · Admin', role: 'admin' },
  { email: 'ops@demo.octopusb2b.com', name: 'TEST FIXTURE · Operations', role: 'operations', divisions: [['SRC', 'staff']] },   // approved mapping
  { email: 'finance@demo.octopusb2b.com', name: 'TEST FIXTURE · Finance', role: 'finance' },
  { email: 'finance2@demo.octopusb2b.com', name: 'TEST FIXTURE · Finance 2', role: 'finance' },
  { email: 'support@demo.octopusb2b.com', name: 'TEST FIXTURE · Support', role: 'support', extraRoles: ['sourcing_agent'], team: 'Sourcing', divisions: [['SRC', 'staff']] },
  { email: 'buyer@demo.octopusb2b.com', name: 'TEST FIXTURE · Buyer', customer: true },
];
const ORG = 'TEST DATA · Staging buyer (fixtures)';
for (const a of ACCOUNTS) {
  let id = (await db.query(`select id from auth.users where email = $1`, [a.email])).rows[0]?.id;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({ email: a.email, password: crypto.randomBytes(24).toString('base64url'), email_confirm: true });
    if (error) throw error;
    id = data.user.id;
  }
  await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });       // sign-in blocked
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name, email = excluded.email`, [id, a.name, a.email]);
  if (a.role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2) on conflict do nothing`, [id, a.role]);
  for (const r of a.extraRoles ?? []) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2) on conflict do nothing`, [id, r]);
  if (a.team) await db.query(`update profiles set team = $2, active = true, out_of_office = false where id = $1`, [id, a.team]);
  for (const [code, role] of a.divisions ?? []) await db.query(`insert into division_members(user_id, division_id, role) select $1, id, $3 from divisions where code = $2 on conflict (user_id, division_id) do update set role = excluded.role`, [id, code, role]);
  if (a.customer) {
    let org = (await db.query(`select id from organizations where name = $1`, [ORG])).rows[0]?.id;
    if (!org) org = (await db.query(`insert into organizations(name, country, city) values ($1, 'AE', 'Dubai') returning id`, [ORG])).rows[0].id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner') on conflict do nothing`, [org, id]);
    await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [org]);
  }
  console.log(`✔ ${a.email} (${a.role ?? 'customer'}) — sign-in blocked`);
}
// the support fixture is the buyer company's dedicated account manager (the assistant tests expect it)
const org = (await db.query(`select id from organizations where name = $1`, [ORG])).rows[0]?.id;
const sup = (await db.query(`select id from auth.users where email = 'support@demo.octopusb2b.com'`)).rows[0]?.id;
// the buyer company has one test RFQ + order of its own (the RLS tests check a customer sees its own orders)
if (org && !(await db.query(`select 1 from orders where org_id = $1`, [org])).rowCount) {
  const rfq = (await db.query(`insert into rfqs(org_id, title, quantity, unit, status, is_seed) values ($1, 'TEST FIXTURE RFQ', 100, 'pcs', 'quoted', true) returning id`, [org])).rows[0].id;
  await db.query(`insert into orders(org_id, rfq_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, is_seed) values ($1, $2, 'TEST FIXTURE order', 100, 100, 10000, 3000, 'deposit_pending', 'USD', true)`, [org, rfq]);
}
if (org && sup) await db.query(`insert into account_managers(org_id, staff_user_id, is_primary, team) values ($1, $2, true, 'Sourcing') on conflict (org_id) where is_primary do update set staff_user_id = excluded.staff_user_id, team = excluded.team`, [org, sup]);
await db.end();
