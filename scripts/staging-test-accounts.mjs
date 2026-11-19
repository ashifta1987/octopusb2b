// STAGING ONLY — fixture accounts the database tests act as (admin@, ops@, finance@, buyer@demo.octopusb2b.com).
// They exist only so the whole DB test suite runs on staging; normal sign-in is BLOCKED (banned) — the tests never sign
// in, they act through JWT claims inside rolled-back transactions. Idempotent: safe to run again.
// Run: node scripts/staging-test-accounts.mjs
import { config } from 'dotenv'; import pg from 'pg'; import { createClient } from '@supabase/supabase-js'; import crypto from 'node:crypto';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging') { console.error('✘ refused: staging only'); process.exit(1); }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
const env = (await db.query(`select value #>> '{}' v from site_settings where key = 'app_environment'`)).rows[0]?.v;
if (env !== 'staging') { console.error('✘ refused: database is not marked staging'); process.exit(1); }

const ACCOUNTS = [
  { email: 'admin@demo.octopusb2b.com', name: 'TEST FIXTURE · Admin', role: 'admin' },
  { email: 'ops@demo.octopusb2b.com', name: 'TEST FIXTURE · Operations', role: 'operations', divisions: [['SRC', 'staff']] },   // approved mapping
  { email: 'finance@demo.octopusb2b.com', name: 'TEST FIXTURE · Finance', role: 'finance' },
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
  for (const [code, role] of a.divisions ?? []) await db.query(`insert into division_members(user_id, division_id, role) select $1, id, $3 from divisions where code = $2 on conflict (user_id, division_id) do update set role = excluded.role`, [id, code, role]);
  if (a.customer) {
    let org = (await db.query(`select id from organizations where name = $1`, [ORG])).rows[0]?.id;
    if (!org) org = (await db.query(`insert into organizations(name, country, city) values ($1, 'AE', 'Dubai') returning id`, [ORG])).rows[0].id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner') on conflict do nothing`, [org, id]);
  }
  console.log(`✔ ${a.email} (${a.role ?? 'customer'}) — sign-in blocked`);
}
await db.end();
