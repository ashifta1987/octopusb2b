// Item 3 (change request v2): distributors read and change ONLY their assigned suppliers' products — in the database.
// STAGING ONLY: refuses to run unless .env.staging says APP_ENVIRONMENT=staging. Everything runs inside one transaction
// that is rolled back — no user, product or file row persists.
// Run: node supabase/tests/distributor-product-scope.test.mjs
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const n = async (q, p) => Number((await one(q, p))?.n ?? 0);
const as = async (claims, role = 'authenticated') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await db.query(`set local role ${role}`);
};
const denied = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { denied: false, rows: r.rowCount }; } catch (e) { await db.query('rollback to savepoint s'); return { denied: true, msg: e.message }; } };
const newUser = async (email, role) => {
  const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `scope test ${role}`, email]);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  return id;
};
try {
  await db.query('begin');
  // A and B: two suppliers; B needs a live, publicly listed product with a price tier and a picture, plus a non-live one
  const b = await one(`select p.supplier_id id, p.id live_id from products p
    where p.status = 'live' and p.archived_at is null and supplier_listings_live(p.supplier_id)
      and exists(select 1 from price_tiers t where t.product_id = p.id) and exists(select 1 from product_media m where m.product_id = p.id)
      and exists(select 1 from products q where q.supplier_id = p.supplier_id and q.status in ('draft','submitted','rejected'))
    order by p.supplier_id limit 1`);
  const bDraft = (await one(`select id from products where supplier_id = $1 and status in ('draft','rejected') order by id limit 1`, [b.id]))?.id
    ?? (await one(`select id from products where supplier_id = $1 and status = 'submitted' order by id limit 1`, [b.id])).id;
  const bSubmitted = (await one(`select id from products where supplier_id = $1 and status in ('submitted','in_review') limit 1`, [b.id]))?.id
    ?? (await one(`insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency) values ('QA-SCOPE-' || floor(random()*1e6), 'qa-scope-' || gen_random_uuid(), 'Scope test submitted', $1, 'submitted', 'pcs', 10, 'USD') returning id`, [b.id])).id;
  const a = (await one(`select supplier_id id from products where supplier_id <> $1 group by supplier_id order by count(*) desc limit 1`, [b.id])).id;
  const codes = await db.query(`select id, code from suppliers where id in ($1, $2)`, [a, b.id]);
  const code = (id) => codes.rows.find((r) => r.id === id)?.code;
  const allA = await n(`select count(*) n from products where supplier_id = $1`, [a]);
  console.log(`fixture: distributor assigned to ${code(a)} (A, ${allA} products); other supplier ${code(b.id)} (B)`);

  const dist = await newUser('scope-dist@example.com', 'distributor');
  await db.query(`insert into distributor_suppliers(distributor_id, supplier_id) values ($1, $2)`, [dist, a]);
  const adm = await newUser('scope-admin@example.com', 'admin');
  // storage fixtures: one object in B's product-media folder and one B certificate file (rolled back)
  await db.query(`insert into storage.objects(bucket_id, name, owner) values ('product-media', $1, null), ('certificates', $2, null)`, [`${b.id}/scope-test.jpg`, `${b.id}/scope-test.pdf`]);

  const D = { sub: dist, role: 'authenticated', aal: 'aal2' };
  await as(D);
  // ── reads ──
  // since 195 products.supplier_id is hidden from signed-in roles: whole rows (incl. supplier) come from portal_products()
  const seen = await db.query(`select supplier_id, count(*)::int n from portal_products() group by supplier_id`);
  ok(await n(`select count(*) n from products`) === allA, `base table (RLS): exactly the ${allA} ${code(a)} rows`);
  ok(seen.rows.every((r) => r.supplier_id === a), `list without filter: only ${code(a)} (${seen.rows.map((r) => r.n).join('+') || 0} rows; suppliers: ${seen.rows.length})`);
  ok((seen.rows.find((r) => r.supplier_id === a)?.n ?? 0) === allA, `all ${allA} ${code(a)} products still visible (any status)`);
  ok(await n(`select count(*) n from portal_products() where supplier_id = $1`, [b.id]) === 0, `list ?supplier_id=${code(b.id)}: 0 rows`);
  ok(await n(`select count(*) n from products where id = $1`, [b.live_id]) === 0, 'single LIVE product of B: no row');
  ok(await n(`select count(*) n from products where id = $1`, [bDraft]) === 0, 'single non-live product of B: no row');
  ok(await n(`select count(*) n from price_tiers where product_id = $1`, [b.live_id]) === 0, 'price tiers of B: none');
  ok(await n(`select count(*) n from product_media where product_id = $1`, [b.live_id]) === 0, 'product images (product_media) of B: none');
  ok(await n(`select count(*) n from product_specs where product_id = $1`, [b.live_id]) === 0, 'specs of B: none');
  ok(await n(`select count(*) n from storage.objects where bucket_id = 'product-media' and name like $1`, [`${b.id}/%`]) === 0, 'storage: B product-media files not listable');
  ok(await n(`select count(*) n from storage.objects where bucket_id = 'certificates' and name like $1`, [`${b.id}/%`]) === 0, 'storage: B certificate files not readable');
  ok(await n(`select count(*) n from import_runs`) === 0, 'admin bulk-import runs (whole workbooks) not readable');
  // ── writes (undone afterwards, so the controls below see the original rows) ──
  await db.query('savepoint writes');
  ok((await denied(`update products set updated_at = now() where id = $1`, [b.live_id])).rows === 0, 'update B product: 0 rows');
  ok((await denied(`insert into price_tiers(product_id, min_qty, unit_price_cents, currency) values ($1, 999999, 1, 'USD')`, [b.live_id])).denied, 'insert price tier on B product: denied');
  const del = await denied(`delete from product_media where product_id = $1`, [b.live_id]);
  ok(del.denied || del.rows === 0, `delete B product images: ${del.denied ? 'denied' : `${del.rows} deleted`}`);
  const tr = await denied(`select transition_product($1, 'archived', 'scope test')`, [b.live_id]);
  ok(tr.denied && /FORBIDDEN/.test(tr.msg), `transition_product on B (archive): ${tr.denied ? tr.msg : 'ALLOWED'}`);
  const tr2 = await denied(`select transition_product($1, 'submitted', 'scope test')`, [bDraft]);
  ok(tr2.denied && /FORBIDDEN/.test(tr2.msg), `transition_product on B (submit): ${tr2.denied ? tr2.msg.slice(0, 60) : 'ALLOWED'}`);
  const w = await denied(`select withdraw_from_moderation($1, 'scope test')`, [bSubmitted]);
  ok(w.denied && /FORBIDDEN/.test(w.msg), `withdraw_from_moderation on B: ${w.denied ? w.msg : 'ALLOWED'}`);
  const ci = await denied(`select commit_import_run(gen_random_uuid(), null, null)`);
  ok(ci.denied && /permission denied/i.test(ci.msg), `commit_import_run (admin import): ${ci.denied ? ci.msg.slice(0, 70) : 'ALLOWED'}`);
  ok((await denied(`insert into storage.objects(bucket_id, name) values ('product-media', $1)`, [`${b.id}/x-${Date.now()}.jpg`])).denied, 'upload into B product-media folder: denied');
  ok(!(await denied(`insert into storage.objects(bucket_id, name) values ('product-media', $1)`, [`${a}/x-${Date.now()}.jpg`])).denied, 'upload into own (A) product-media folder: allowed');
  await db.query('rollback to savepoint writes');
  // ── an aal1 distributor session does not fall back to the public policy ──
  await as({ ...D, aal: 'aal1' });
  ok(await n(`select count(*) n from products where id = $1`, [b.live_id]) === 0 && await n(`select count(*) n from portal_products() where supplier_id = $1`, [b.id]) === 0, 'aal1 distributor: B live products hidden too');
  // ── controls: admin, anonymous storefront ──
  await as({ sub: adm, role: 'authenticated', aal: 'aal2' });
  ok(await n(`select count(*) n from portal_products() where supplier_id = $1`, [b.id]) > 0, 'admin: B products visible');
  ok(await n(`select count(*) n from storage.objects where bucket_id = 'certificates' and name like $1`, [`${b.id}/%`]) === 1, 'admin: B certificate file visible');
  await as({ role: 'anon' }, 'anon');
  ok(await n(`select count(*) n from products where id = $1`, [b.live_id]) === 1, 'anonymous storefront: B live product visible');
  ok(await n(`select count(*) n from price_tiers where product_id = $1`, [b.live_id]) > 0, 'anonymous storefront: B price tiers visible');
  ok(await n(`select count(*) n from products where id = $1`, [bDraft]) === 0, 'anonymous: B draft hidden');
  await db.query('reset role');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email in ('scope-dist@example.com','scope-admin@example.com')`)).rowCount, 'rolled back — no test user left');
  await db.end();
}
console.log(failed ? `\ndistributor product scope: ${failed} check(s) failed` : '\ndistributor product scope: all passed');
process.exitCode = failed ? 1 : 0;
