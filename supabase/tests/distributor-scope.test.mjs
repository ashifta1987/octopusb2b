// RLS: a distributor sees only the suppliers assigned to them (6 Nov 2026). Rolled back — nothing persists.
// Fixture: a throwaway distributor assigned to OCT-1132 only. As that user (JWT aal2):
//  · suppliers: OCT-1132 visible, OCT-1133 not (so ?supplier=OCT-1133 resolves to nothing → 404 in the app)
//  · products: every OCT-1132 product (any status); of OCT-1133 nothing — not even its live products (8 Nov 2026,
//    migration 186: the public storefront policy no longer applies to distributors)
//  · supplier_switches / distributor_suppliers: nothing of OCT-1133
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
try {
  await db.query('begin');
  const a = (await one(`select id from suppliers where code = 'OCT-1132'`)).id;
  const b = (await one(`select id from suppliers where code = 'OCT-1133'`)).id;
  const u = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), 'rls-dist@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`)).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, 'RLS distributor', 'rls-dist@example.com') on conflict (id) do nothing`, [u]);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'distributor')`, [u]);
  await db.query(`insert into distributor_suppliers(distributor_id, supplier_id) values ($1, $2)`, [u, a]);
  const expectA = Number((await one(`select count(*) n from products where supplier_id = $1`, [a])).n);
  const liveB = Number((await one(`select count(*) n from products where supplier_id = $1 and status = 'live' and archived_at is null and supplier_listings_live(supplier_id)`, [b])).n);
  const allB = Number((await one(`select count(*) n from products where supplier_id = $1`, [b])).n);
  // since 195 products.supplier_id is hidden from signed-in roles: visibility is checked by product ids (base table, RLS)
  // and through portal_products() (the whole rows the caller may see)
  const idsA = (await db.query(`select id from products where supplier_id = $1`, [a])).rows.map((r) => r.id);
  const idsB = (await db.query(`select id from products where supplier_id = $1`, [b])).rows.map((r) => r.id);
  const idsBnotLive = (await db.query(`select id from products where supplier_id = $1 and status <> 'live'`, [b])).rows.map((r) => r.id);

  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u, role: 'authenticated', aal: 'aal2' })]);
  await db.query('set local role authenticated');
  const sups = (await db.query(`select code from suppliers order by code`)).rows.map((r) => r.code);
  ok(sups.includes('OCT-1132') && !sups.includes('OCT-1133'), `suppliers visible: ${sups.join(', ') || 'none'} (OCT-1133 hidden)`);
  ok(!(await db.query(`select 1 from suppliers where code = 'OCT-1133'`)).rowCount, 'looking up OCT-1133 by code returns nothing');
  ok(Number((await one(`select count(*) n from products where id = any($1)`, [idsA])).n) === expectA, `all ${expectA} OCT-1132 products visible (any status)`);
  ok(Number((await one(`select count(*) n from portal_products() where supplier_id = $1`, [a])).n) === expectA, `portal_products(): all ${expectA} OCT-1132 products incl. internal columns`);
  ok(!(await db.query(`select 1 from portal_products() where supplier_id <> $1`, [a])).rowCount, 'portal_products(): no other supplier');
  const seenB = Number((await one(`select count(*) n from products where id = any($1)`, [idsB])).n);
  ok(seenB === 0, `OCT-1133: none of its ${allB} product(s) visible, not even the ${liveB} live one(s) (${seenB})`);
  ok(!(await db.query(`select 1 from products where id = any($1)`, [idsBnotLive])).rowCount, 'no OCT-1133 drafts / submitted / archived rows');
  ok(!(await db.query(`select 1 from supplier_switches where supplier_id = $1`, [b])).rowCount, 'OCT-1133 switches hidden');
  ok((await db.query(`select supplier_id from distributor_suppliers`)).rows.every((r) => r.supplier_id === a), 'own assignments only');
  const upd = await db.query(`update products set title = title where id = any($1)`, [idsB]);
  ok(upd.rowCount === 0, 'cannot update OCT-1133 products');
  await db.query('reset role');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email = 'rls-dist@example.com'`)).rowCount, 'rolled back — no test user left');
  await db.end();
}
console.log(failed ? `\ndistributor scope: ${failed} check(s) failed` : '\ndistributor scope: all passed');
process.exitCode = failed ? 1 : 0;

