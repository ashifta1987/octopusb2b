// ADDON-36 36-A (7 Nov 2026) — one transaction, rolled back.
//  · supplier applications: only the service role can submit; anon/customers cannot read or write; staff with
//    suppliers:view can read; review needs suppliers:approve, rejection needs a reason, every step is audited
//  · pool alert sign-ups: no public access; duplicates of an open sign-up are rejected by the unique index
//  · Electrical recategorisation: no live product sits directly on the Electrical parent any more
// Note: a rolled-back insert still uses one number of supplier_application_seq (references may skip a number).
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const now = Math.floor(Date.now() / 1000);
const as = async (sub) => {
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] })]);
  await db.query('set local role authenticated');
};
const anon = async () => { await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`); await db.query('set local role anon'); };
const service = async () => { await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`); await db.query('set local role service_role'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { const r = await db.query(sql, p); await db.query('release savepoint t'); return r; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
const app = JSON.stringify({ company_name: 'QA Factory Co., Ltd.', uscc: '91440300ma5xxxxx1x', city: 'Shenzhen', categories: ['Electrical', 'Other'], contact_name: 'QA Li', contact_email: 'QA@Example.com' });
try {
  await db.query('begin');
  const admin = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;
  const cust = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), 'sa-cust@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`)).id;

  await anon();
  ok(/permission denied/.test(String(await tryQ(`select submit_supplier_application($1::jsonb)`, [app]))), 'anonymous visitors cannot call the submit function directly');
  ok(/permission denied/.test(String(await tryQ(`select * from supplier_applications`))), 'anonymous visitors cannot read applications');
  ok(/permission denied/.test(String(await tryQ(`insert into pool_alert_signups(email) values ('x@example.com')`))), 'anonymous visitors cannot write pool alerts directly');
  await owner();

  await service();
  const r = (await one(`select submit_supplier_application($1::jsonb) v`, [app])).v;
  await owner();
  ok(/^SA-\d{4}-\d+$/.test(r.reference), `submit returns a reference (${r.reference})`);
  const row = await one(`select * from supplier_applications where id = $1`, [r.id]);
  ok(row.uscc === '91440300MA5XXXXX1X' && row.contact_email === 'qa@example.com' && row.categories.length === 2 && row.status === 'submitted', 'USCC upper-cased, email lower-cased, categories kept, status submitted');
  ok(!!(await one(`select 1 x from audit_log where action = 'supplier_application.submit' and entity_id = $1`, [r.id])), 'submission is audited');

  await as(cust);
  ok((await db.query(`select id from supplier_applications`)).rowCount === 0, 'a customer sees no applications');
  ok(/FORBIDDEN/.test(String(await tryQ(`select review_supplier_application($1, 'approved')`, [r.id]))), 'a customer cannot review');
  await owner();

  await as(admin);
  ok((await db.query(`select id from supplier_applications where id = $1`, [r.id])).rowCount === 1, 'staff with suppliers:view can read the application');
  ok(/NOTE_REQUIRED/.test(String(await tryQ(`select review_supplier_application($1, 'rejected', '  ')`, [r.id]))), 'rejecting needs a reason');
  await db.query(`select review_supplier_application($1, 'in_review')`, [r.id]);
  await db.query(`select review_supplier_application($1, 'approved', 'audit booked')`, [r.id]);
  await owner();
  const after = await one(`select status, reviewed_by, review_note from supplier_applications where id = $1`, [r.id]);
  ok(after.status === 'approved' && after.reviewed_by === admin && after.review_note === 'audit booked', 'review updates status, reviewer and note');
  ok(Number((await one(`select count(*) n from audit_log where action = 'supplier_application.review' and entity_id = $1`, [r.id])).n) === 2, 'each review step is audited');

  await db.query(`insert into pool_alert_signups(email) values ('qa-pool@example.com')`);
  ok(/duplicate key/.test(String(await tryQ(`insert into pool_alert_signups(email) values ('QA-POOL@example.com')`))), 'the same email cannot sign up twice for the next pool');

  const direct = Number((await one(`select count(*) n from products p join categories c on c.id = p.category_id where c.slug = 'electrical' and c.parent_id is null and p.status = 'live'`)).n);
  ok(direct === 0, `no live product sits directly on the Electrical parent (${direct})`);
} catch (e) {
  console.error(e); failed++;
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
