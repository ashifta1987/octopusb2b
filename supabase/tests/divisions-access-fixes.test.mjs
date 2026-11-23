// Divisions step 3 follow-up (migration 194). STAGING ONLY, one rolled-back transaction, acting as each user through
// JWT claims (what the REST API does with the public key or a signed-in session).
//  · logged-out visitors can read the public pools / turnkey pages again (192 regression)
//  · signed-in customers can read their tracking events again; the carrier stays hidden (190/192 regression)
//  · dropship catalogue tables: Dropshipping staff read + edit, company-wide admins full, finance/support read,
//    other divisions nothing, customers and the public key nothing (customers use the customer-safe functions)
//  · 194 down → up gives identical policies and grants
// Run: node supabase/tests/divisions-access-fixes.test.mjs
import { config } from 'dotenv'; import pg from 'pg'; import fs from 'node:fs';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid, aal = 'aal2') => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]); await db.query('set local role authenticated'); };
const asAnon = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]); await db.query('set local role anon'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows, n: r.rowCount }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [], n: 0 }; } };
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
  const shp = (await one(`select id, org_id from shipments where code = 'TEST-SHP-1'`));
  await db.query(`insert into tracking_events(shipment_id, org_id, status, description) values ($1, $2, 'in_transit', 'TEST tracking event')`, [shp.id, shp.org_id]);
  const hasV2 = !!(await one(`select 1 x from information_schema.columns where table_schema='public' and table_name='dropship_products' and column_name='id'`));
  const pkCol = hasV2 ? 'id' : 'product_id';
  const totals = await one(`select (select count(*) from dropship_products)::int p, (select count(*) from dropship_variants)::int v, (select count(*) from dropship_rates)::int r,
                                   (select count(*) from turnkey_projects where status <> 'archived')::int tk, (select ${pkCol} from dropship_products limit 1) pid`);

  const ds = await user('fix-ds@example.com', 'operations', [['DS', 'staff']]);
  const mmb = await user('fix-mmb@example.com', 'operations', [['MMB', 'staff']]);
  const adm = await user('fix-admin@example.com', 'admin');
  const fin = await user('fix-finance@example.com', 'finance');
  const cust = await user('fix-cust@example.com');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on') on conflict (org_id, service) do update set status = 'on'`, [org]);
  if (hasV2) await db.query(`insert into dropship_markets(org_id, country) values ($1, 'AE') on conflict do nothing`, [org]);

  // ── logged-out visitor (public key) ──
  await asAnon();
  for (const t of ['pools', 'pool_events', 'turnkey_projects', 'turnkey_packages', 'turnkey_equipment', 'turnkey_atlas_signals']) {
    const r = await tryq(`select count(*)::int n from ${t}`);
    ok(!r.err, `public key: ${t} readable (${r.err ? r.err.slice(0, 60) : r.rows[0].n + ' rows'})`);
  }
  ok((await tryq(`select count(*)::int n from turnkey_projects`)).rows[0]?.n === totals.tk, `public key: all ${totals.tk} published turnkey projects`);
  const leads = await tryq(`select count(*)::int n from turnkey_leads`);
  ok(!leads.err && leads.rows[0].n === 0, 'public key: turnkey leads — no rows (contact data stays private)');
  for (const t of ['dropship_products', 'dropship_variants', 'dropship_rates']) {
    const r = await tryq(`select 1 from ${t} limit 1`);
    ok(/permission denied/.test(r.err ?? ''), `public key: ${t} refused (${(r.err ?? 'READABLE').slice(0, 50)})`);
  }

  // ── signed-in customer ──
  await as(cust, 'aal1');
  const te = await tryq(`select status from tracking_events where shipment_id = $1`, [shp.id]);
  ok(!te.err && te.rows.length === 1, `customer: own tracking events readable (${te.err ? te.err.slice(0, 60) : te.rows.length + ' row'})`);
  ok(!(await tryq(`select division_id from shipments where id = $1`, [shp.id])).err, 'customer: own shipment incl. division readable');
  ok(/permission denied/.test((await tryq(`select carrier_code from shipments where id = $1`, [shp.id])).err ?? ''), 'customer: carrier stays hidden (white-label)');
  for (const t of ['dropship_products', 'dropship_variants', 'dropship_rates']) {
    const r = await tryq(`select count(*)::int n from ${t}`);
    ok(!r.err && r.rows[0].n === 0, `customer: ${t} — no direct rows (${r.err ? r.err.slice(0, 50) : r.rows[0].n})`);
  }
  const cat = await tryq(hasV2 ? `select * from get_dropship_catalogue('AE')` : `select * from dropship_catalogue('AE')`);
  const keys = Object.keys(cat.rows[0] ?? {});
  ok(!cat.err && cat.rows.length > 0, `customer: dropship catalogue function still works (${cat.err ? cat.err.slice(0, 60) : cat.rows.length + ' products'})`);
  ok(!keys.some((k) => /supplier|cost|margin|markup|contact|note/.test(k)), `customer: catalogue has no supplier/cost/margin/contact fields (${keys.join(',')})`);

  // ── Dropshipping staff: read + edit ──
  await as(ds);
  ok((await all(`select 1 from dropship_products`)).length === totals.p, `DS staff: all ${totals.p} dropship products`);
  ok((await all(`select 1 from dropship_variants`)).length === totals.v, `DS staff: all ${totals.v} variants`);
  ok((await all(`select 1 from dropship_rates`)).length === totals.r, `DS staff: all ${totals.r} rates`);
  ok((await tryq(`update dropship_products set weight_g = weight_g where ${pkCol} = $1`, [totals.pid])).n === 1, 'DS staff: can edit a dropship product');
  ok((await tryq(`update dropship_variants set sort = sort where product_id = $1`, [totals.pid])).n >= 0 && !(await tryq(`update dropship_variants set sort = sort where product_id = $1`, [totals.pid])).err, 'DS staff: can edit its variants');

  // ── another division: nothing ──
  await as(mmb);
  ok((await all(`select 1 from dropship_products`)).length === 0 && (await all(`select 1 from dropship_variants`)).length === 0 && (await all(`select 1 from dropship_rates`)).length === 0, 'MMB staff: no dropship products / variants / rates');
  ok((await tryq(`update dropship_products set weight_g = weight_g where ${pkCol} = $1`, [totals.pid])).n === 0, 'MMB staff: cannot edit a dropship product (0 rows)');

  // ── company-wide ──
  await as(fin);
  ok((await all(`select 1 from dropship_products`)).length === totals.p, 'finance (company-wide): reads all dropship products');
  ok((await tryq(`update dropship_rates set fee_cents = fee_cents`)).n === 0, 'finance: cannot edit rates (read only)');
  await as(adm);
  ok((await tryq(`update dropship_rates set fee_cents = fee_cents`)).n === totals.r, `admin: full access (edits all ${totals.r} rates)`);
  await as(adm, 'aal1');
  ok((await all(`select 1 from dropship_products`)).length === 0, 'admin without 2FA (aal1): nothing');
  await db.query('reset role');
  await db.query('rollback');

  // ── down → up gives identical policies and grants ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    pol: await all(`select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`),
    tg: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  });
  const after = await snap();
  // migrations applied after 194 are unwound first and re-applied after (they may build on 194's objects)
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000194_division_access_fixes.sql');
  await unwind(db, later);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000194_division_access_fixes.down.sql', 'utf8'));
  const down = await snap();
  ok(!down.includes('dropship_products_read') && !down.includes('dropship_can_edit'), 'down: dropship policies and helper removed');
  await db.query(fs.readFileSync('supabase/migrations/20261101000194_division_access_fixes.sql', 'utf8'));
  await reapply(db, later);
  ok((await snap()) === after, 'up again: identical policies, grants and function permissions');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'fix-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\ndivisions access fixes: ${failed} check(s) failed` : '\ndivisions access fixes: all passed');
process.exitCode = failed ? 1 : 0;
