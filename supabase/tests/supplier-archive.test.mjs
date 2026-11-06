// Archiving a supplier archives all its products (incl. moderation) and restore brings them back (7 Nov 2026). Rolled back.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (sub) => { await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2' })]); await db.query('set local role authenticated'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { await db.query(sql, p); await db.query('release savepoint t'); return 'ok'; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
try {
  await db.query('begin');
  const adminId = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;
  // fixture: OCT-1133 (a real supplier — no new supplier, so no supplier code is used up) + one extra product in every status
  const sup = await one(`select id, code from suppliers where code = 'OCT-1133'`);
  const before = Number((await one(`select count(*) n from products where supplier_id = $1 and status <> 'archived'`, [sup.id])).n);
  const prevArchived = (await db.query(`select id from products where supplier_id = $1 and status = 'archived'`, [sup.id])).rows.map((r) => r.id);
  const mk = async (status, extra = '') => (await one(`insert into products(supplier_id, title, slug, unit, moq, currency, status, external_id) values ($1, $2, $3, 'pcs', 10, 'USD', 'draft', $4) returning id`,
    [sup.id, `QA ${status}${extra}`, `qa-arch-${status}${extra}-${Date.now()}`, `QA-ARCH-${status.toUpperCase()}${extra}`])).id;
  const ids = {};
  for (const st of ['draft', 'submitted', 'in_review', 'live', 'paused', 'rejected']) {
    ids[st] = await mk(st);
    await db.query(`insert into price_tiers(product_id, min_qty, unit_price_cents, currency) values ($1, 10, 100, 'USD')`, [ids[st]]);
    if (st !== 'draft') await db.query(`update products set status = $2 where id = $1`, [ids[st], st]);
  }
  const already = await mk('archived', '-old'); await db.query(`update products set status = 'archived', archived_at = now() where id = $1`, [already]);

  // a distributor cannot archive
  const dist = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), 'arch-dist@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`)).id;
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'distributor')`, [dist]);
  await as(dist);
  ok(/FORBIDDEN/.test(await tryQ(`select archive_supplier($1)`, [sup.id])), 'a distributor cannot archive a supplier');
  await owner();

  await as(adminId);
  const res = (await one(`select archive_supplier($1, 'qa') r`, [sup.id])).r;
  await owner();
  ok(res.products === before + 6, `archive: ${before + 6} products archived (${JSON.stringify(res.by_status)}), the already-archived one untouched`);
  const st = (await db.query(`select id, status, archived_by_supplier_from f from products where supplier_id = $1`, [sup.id])).rows;
  ok(st.every((r) => r.status === 'archived'), 'every product of the supplier is archived');
  ok([already, ...prevArchived].every((id) => st.find((r) => r.id === id).f === null), 'products archived earlier are not marked as archived-with-supplier');
  ok(Number((await one(`select count(*) n from products where supplier_id = $1 and status in ('submitted', 'in_review')`, [sup.id])).n) === 0, 'nothing of it left in the moderation queue');
  ok((await one(`select supplier_listings_live($1) v`, [sup.id])).v === false, 'storefront: listings of an archived supplier are off');
  ok(Number((await one(`select count(*) n from audit_log where action = 'product.archived_with_supplier' and details->>'reason' = 'qa'`)).n) === before + 6, 'one audit row per archived product');
  ok(/SUPPLIER_ARCHIVED/.test(await tryQ(`update products set status = 'draft' where id = $1`, [ids.draft])), 'a product of an archived supplier cannot be revived');
  ok(/SUPPLIER_ARCHIVED/.test(await tryQ(`insert into products(supplier_id, title, slug, unit, moq, currency, status) values ($1, 'QA new', 'qa-arch-new', 'pcs', 1, 'USD', 'draft')`, [sup.id])), 'no new products for an archived supplier');

  await as(adminId);
  const back = (await one(`select restore_supplier($1) r`, [sup.id])).r;
  await owner();
  const after = Object.fromEntries((await db.query(`select id, status from products where supplier_id = $1`, [sup.id])).rows.map((r) => [r.id, r.status]));
  ok(back.products === before + 6, `restore: ${before + 6} products back (${JSON.stringify(back.by_status)})`);
  ok(after[ids.live] === 'paused' && after[ids.paused] === 'paused', 'live / paused → paused (an admin resumes them)');
  ok(after[ids.submitted] === 'submitted' && after[ids.in_review] === 'submitted', 'submitted / in review → submitted (back in moderation)');
  ok(after[ids.draft] === 'draft' && after[ids.rejected] === 'rejected', 'draft / rejected unchanged');
  ok([already, ...prevArchived].every((id) => after[id] === 'archived'), 'products archived before stay archived');
  ok((await one(`select supplier_listings_live($1) v`, [sup.id])).v === true, 'storefront switch back on');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from products where external_id like 'QA-ARCH-%'`)).rowCount && !(await db.query(`select 1 from suppliers where code = 'OCT-1133' and archived_at is not null`)).rowCount, 'rolled back — OCT-1133 untouched, no QA products left');
  await db.end();
}
console.log(failed ? `\nsupplier archive: ${failed} check(s) failed` : '\nsupplier archive: all passed');
process.exitCode = failed ? 1 : 0;
