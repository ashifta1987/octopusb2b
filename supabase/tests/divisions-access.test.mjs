// Divisions step 3 (19 Nov 2026): access by division. STAGING ONLY, one rolled-back transaction, acting as each user
// through JWT claims (what the REST API does). Uses the staging test data (scripts/seed-division-test-data.mjs).
// Run: node supabase/tests/divisions-access.test.mjs
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid, aal = 'aal2') => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]); await db.query('set local role authenticated'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows, n: r.rowCount }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message }; } };
const user = async (email, role, divisions = []) => {
  const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `T ${email}`, email]);
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  for (const [code, r] of divisions) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
  return id;
};
try {
  await db.query('begin');
  const org = (await one(`select id from organizations where name = 'TEST DATA · Divisions'`))?.id;
  if (!org) throw new Error('staging test data missing — run scripts/seed-division-test-data.mjs');
  const id = async (q) => (await one(q)).id;
  const sr3pl = await id(`select id from service_requests where org_id = '${org}' and service_code = '3pl'`);
  const srDs = await id(`select id from service_requests where org_id = '${org}' and service_code = 'dropship'`);
  const mb = await id(`select id from brand_projects where ref = 'MB-TEST-01'`);
  const shp = await id(`select id from shipments where code = 'TEST-SHP-1'`);
  const ordCodes = (await all(`select code from orders where org_id = $1 order by code`, [org])).map((r) => r.code);

  const ds = await user('div-ds@example.com', 'operations', [['DS', 'staff']]);
  const mmb = await user('div-mmb@example.com', 'operations', [['MMB', 'staff']]);
  const wh = await user('div-wh@example.com', 'warehouse', [['3PL', 'warehouse']]);
  const adm = await user('div-admin@example.com', 'admin');
  const sup = await user('div-support@example.com', 'support');
  const am = await user('div-am@example.com', 'account_manager');
  await db.query(`insert into account_managers(org_id, staff_user_id, is_primary) values ($1, $2, true) on conflict do nothing`, [org, am]);
  const custA = await user('div-cust@example.com');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, custA]);
  const otherOrg = (await one(`insert into organizations(name, country) values ('Div access other', 'AE') returning id`)).id;
  const custB = await user('div-cust-b@example.com');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [otherOrg, custB]);

  // ── Dropshipping staff ──
  await as(ds);
  ok((await all(`select 1 from service_requests where id = $1`, [sr3pl])).length === 0, 'DS staff: 3PL service request (inbound) — no row');
  ok((await all(`select 1 from service_requests where id = $1`, [srDs])).length === 1, 'DS staff: own dropship service request — visible');
  ok((await all(`select 1 from brand_projects where id = $1`, [mb])).length === 0, 'DS staff: Make My Brand project — no row');
  ok((await all(`select 1 from admin_brand_projects($1, null)`, [mb])).length === 0, 'DS staff: Admin brand-projects function — no row');
  ok((await all(`select 1 from brand_project_history($1)`, [mb])).length === 0, 'DS staff: brand project history — no rows');
  const dsOrders = (await all(`select code from orders where org_id = $1 order by code`, [org])).map((r) => r.code);
  ok(dsOrders.join(',') === 'TEST-ORD-DS', `DS staff: only the dropship order (${dsOrders.join(',') || 'none'})`);
  ok((await tryq(`update service_requests set status = 'accepted' where id = $1`, [sr3pl])).n === 0, 'DS staff: direct update of the 3PL request — 0 rows');
  const tr = await tryq(`select transition_service_request($1, 'accepted', null)`, [sr3pl]);
  ok(/FORBIDDEN|NOT_FOUND/.test(tr.err ?? ''), `DS staff: RPC transition of the 3PL request refused (${(tr.err ?? 'ALLOWED').slice(0, 60)})`);
  const bs = await tryq(`select set_brand_project_status($1, 'proof', null)`, [mb]);
  ok(/FORBIDDEN|NOT_FOUND/.test(bs.err ?? ''), `DS staff: RPC brand status change refused (${(bs.err ?? 'ALLOWED').slice(0, 60)})`);
  // the staging test data has one dropship shipment (TEST-SHP-DS, for the dropship label — 196): DS staff see only that
  const dsShips = await all(`select code, division from warehouse_shipments`);
  ok(dsShips.every((r) => r.division === 'DS'), `DS staff: warehouse shipment list — Dropshipping shipments only (${dsShips.map((r) => r.code).join(',') || 'none'})`);
  ok((await all(`select 1 from journals where division_id is null`)).length === 0, 'DS staff: company-wide journals — none');

  // ── Make My Brand staff ──
  await as(mmb);
  ok((await all(`select 1 from brand_projects where id = $1`, [mb])).length === 1, 'MMB staff: the brand project — visible');
  ok((await all(`select code from orders where org_id = $1`, [org])).map((r) => r.code).join(',') === 'TEST-ORD-MMB', 'MMB staff: only the brand order');
  ok((await all(`select 1 from service_requests where id in ($1, $2)`, [sr3pl, srDs])).length === 0, 'MMB staff: no 3PL / dropship requests');
  ok(!(await tryq(`select set_brand_project_status($1, 'proof', null)`, [mb])).err, 'MMB staff: can move its own brand project');

  // ── 3PL warehouse: every division's shipments, pick/pack fields only ──
  await as(wh);
  ok((await all(`select 1 from shipments where id = $1`, [shp])).length === 0, 'warehouse: the base shipments table does not show another division\'s shipment');
  const wrow = await one(`select * from warehouse_shipments where id = $1`, [shp]);
  ok(!!wrow && wrow.division === 'SRC' && wrow.order_code === 'TEST-ORD-SRC' && wrow.quantity === 1000, 'warehouse: the SRC shipment is in the warehouse list (items, quantity, address, carrier, tracking, status)');
  const cols = Object.keys(wrow ?? {});
  ok(!cols.some((c) => /price|rate|cents|total|payment|margin|cost|deposit/.test(c)), `warehouse: no price / payment / margin columns (${cols.length} columns)`);
  ok(!(await tryq(`select warehouse_update_shipment($1, 'picked_up', 'TEST-TRK-1')`, [shp])).err, 'warehouse: updates status + tracking through warehouse_update_shipment');
  ok((await tryq(`update shipments set rate_cents = 1 where id = $1`, [shp])).n === 0, 'warehouse: cannot change the shipping rate directly');
  ok((await all(`select 1 from orders where org_id = $1`, [org])).length === 0, 'warehouse: cannot read the orders (prices)');
  ok((await all(`select 1 from payments where org_id = $1`, [org])).length === 0, 'warehouse: cannot read payments');
  await db.query('reset role');
  ok(Number((await one(`select status, tracking_no, rate_cents from shipments where id = $1`, [shp])).rate_cents) === 4800, 'the rate is unchanged (4800)');

  // ── company-wide roles ──
  await as(adm);
  ok((await all(`select code from orders where org_id = $1`, [org])).length === 5, 'admin: all 5 orders (every division)');
  ok((await all(`select 1 from audit_log where division_id is null limit 1`)).length === 1, 'admin: company-wide audit rows visible');
  await as(sup);
  ok((await all(`select 1 from service_requests where id in ($1, $2)`, [sr3pl, srDs])).length === 2, 'support (company-wide): both requests');

  // ── account manager: their customer, every division ──
  await as(am);
  ok((await all(`select code from orders where org_id = $1`, [org])).length === 5, 'account manager: all 5 orders of their customer');
  ok((await all(`select 1 from orders where org_id = $1`, [otherOrg])).length === 0, 'account manager: nothing of another customer');

  // ── customers: own rows across all divisions; never another customer's ──
  await as(custA, 'aal1');
  ok((await all(`select code from orders order by code`)).map((r) => r.code).join(',') === ordCodes.join(','), `customer: own orders in every division (${ordCodes.length})`);
  ok((await all(`select 1 from brand_projects where id = $1`, [mb])).length === 1, 'customer: own brand project');
  await as(custB, 'aal1');
  ok((await all(`select 1 from orders where org_id = $1`, [org])).length === 0 && (await all(`select 1 from brand_projects where id = $1`, [mb])).length === 0, 'another customer: nothing of the test company');

  // ── 2FA still required for staff ──
  await as(mmb, 'aal1');
  ok((await all(`select 1 from brand_projects where id = $1`, [mb])).length === 0, 'MMB staff without 2FA (aal1): nothing');
  await db.query('reset role');
  await db.query('rollback');

  // ── the down migration restores every policy exactly; up again gives the same policies ──
  await db.query('begin');
  const snap = async () => JSON.stringify((await all(`select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`)));
  const after = await snap();
  const fs = await import('node:fs');
  // 194 builds on 192 (its policies call in_division), so it comes down first and goes up again after; migrations
  // applied after 194 (195 views call in_division, 196 uses the division write guard) are unwound before that
  const { appliedAfter, unwind, reapply, MAX_UNWIND } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000194_division_access_fixes.sql');
  await unwind(db, later, MAX_UNWIND);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000194_division_access_fixes.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000192_division_access.down.sql', 'utf8'));
  const down = await snap();
  ok(!down.includes('in_division') && !(await one(`select to_regprocedure('in_division(uuid,text[])') f`)).f, 'down: no policy mentions in_division, helper removed');
  await db.query(fs.readFileSync('supabase/migrations/20261101000192_division_access.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261101000194_division_access_fixes.sql', 'utf8'));
  await reapply(db, later);
  ok((await snap()) === after, 'up again: identical policies');
} catch (e) {
  if (!e.skipRoundTrip) ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'div-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\ndivisions access: ${failed} check(s) failed` : '\ndivisions access: all passed');
process.exitCode = failed ? 1 : 0;
