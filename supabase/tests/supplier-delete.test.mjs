// Delete supplier for good + code reuse (7 Nov 2026). Everything runs in one transaction and is rolled back.
// Target: OCT-1134 (archived, 37 products that had been in moderation). Checks: admin only, typed code must match,
// blockers stop it, everything erased, SKUs released, audit scrubbed with one "supplier.deleted" record, code reused.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (sub) => { await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2' })]); await db.query('set local role authenticated'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { const r = await db.query(sql, p); await db.query('release savepoint t'); return r.rows[0]; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
const seqBefore = Number((await one(`select last_value from seq_supplier_code`)).last_value);
try {
  await db.query('begin');
  const adminId = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;
  const s = await one(`select id, code, legal_name from suppliers where code = 'OCT-1134'`);
  if (!s) throw new Error('OCT-1134 not found (already deleted?)');
  const skus = (await db.query(`select external_id from products where supplier_id = $1`, [s.id])).rows.map((r) => r.external_id);
  const pids = (await db.query(`select id from products where supplier_id = $1`, [s.id])).rows.map((r) => r.id);

  // non-admin refused
  const dist = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), 'del-dist@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`)).id;
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'distributor')`, [dist]);
  await as(dist);
  ok(/FORBIDDEN/.test(await tryQ(`select delete_supplier($1, $2)`, [s.id, s.code])), 'a non-admin cannot delete a supplier');
  await owner();

  await as(adminId);
  const pv = (await one(`select supplier_delete_preview($1) p`, [s.id])).p;
  ok(pv.products === skus.length && pv.can_delete === true, `preview: ${pv.products} products (${JSON.stringify(pv.products_by_status)}), ${pv.photos} photos, ${pv.skus_released} SKUs, ${pv.import_jobs} import job(s), can delete`);
  ok(/CONFIRM_MISMATCH/.test(await tryQ(`select delete_supplier($1, 'OCT-9999')`, [s.id])), 'wrong confirmation code is refused');
  // a blocker (a document for this supplier) stops it
  await owner();
  await db.query('savepoint b');
  await db.query(`insert into documents(supplier_id, doc_type, number) values ($1, 'purchase_order', 'QA-DEL-1')`, [s.id]);
  await as(adminId);
  const blocked = await tryQ(`select delete_supplier($1, $2)`, [s.id, s.code]);
  ok(typeof blocked === 'string' && /SUPPLIER_DELETE_BLOCKED.*document/.test(blocked), `business history blocks deletion ("${String(blocked).slice(0, 90)}…")`);
  await owner();
  await db.query('rollback to savepoint b');

  await as(adminId);
  const res = (await one(`select delete_supplier($1, $2) r`, [s.id, s.code])).r;
  await owner();
  ok(res.products === skus.length, `deleted: ${res.products} products, ${res.skus_released} SKUs released, ${res.audit_rows_scrubbed} audit rows scrubbed`);
  ok(!(await db.query(`select 1 from suppliers where id = $1`, [s.id])).rowCount, 'supplier row gone');
  ok(!(await db.query(`select 1 from products where id = any($1)`, [pids])).rowCount, 'all its products gone (incl. the ones that were in moderation)');
  for (const t of ['supplier_switches', 'supplier_contacts', 'supplier_name_variants', 'distributor_suppliers', 'certificates', 'import_jobs', 'supplier_product_prices', 'sku_reservations'])
    ok(!(await db.query(`select 1 from ${t} where supplier_id = $1`, [s.id])).rowCount, `${t}: nothing left`);
  for (const t of ['product_media', 'price_tiers', 'product_specs', 'import_review_items', 'import_rows'])
    ok(!(await db.query(`select 1 from ${t} where product_id = any($1)`, [pids])).rowCount, `${t}: nothing left`);
  ok(!(await db.query(`select 1 from audit_log where details::text ilike '%' || $1 || '%'`, [s.legal_name])).rowCount, 'no audit row still contains the legal name');
  ok(!(await db.query(`select 1 from status_history where entity = 'product' and entity_id = any($1)`, [pids])).rowCount, 'status history of its products removed');
  const rec = await one(`select details from audit_log where action = 'supplier.deleted' and entity_id = $1 order by id desc limit 1`, [s.code]);
  ok(rec && rec.details.code === s.code && rec.details.products === skus.length && !JSON.stringify(rec.details).includes(s.legal_name), 'one "supplier.deleted" record kept (code, counts, no name)');
  ok(Array.isArray(res.storage['product-media']) && Array.isArray(res.storage.imports), `storage to clean: ${res.storage['product-media'].length} photo(s), ${res.storage.imports.length} zip(s)`);
  ok(!(await db.query(`select 1 from sku_reservations where sku_norm = any($1)`, [skus])).rowCount, 'SKUs released (can be used again)');

  // the freed code goes to the next new supplier (sequence untouched)
  const n1 = await one(`insert into suppliers(legal_name, country) values ('QA New Supplier', 'CN') returning code`);
  ok(n1.code === s.code, `next new supplier gets the freed code ${s.code} (got ${n1.code})`);
  ok(!(await db.query(`select 1 from freed_supplier_codes where code = $1`, [s.code])).rowCount, 'freed code consumed');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!!(await db.query(`select 1 from suppliers where code = 'OCT-1134'`)).rowCount, 'rolled back — OCT-1134 still there');
  ok(Number((await one(`select last_value from seq_supplier_code`)).last_value) === seqBefore, 'supplier code sequence not consumed');
  await db.end();
}
console.log(failed ? `\nsupplier delete: ${failed} check(s) failed` : '\nsupplier delete: all passed');
process.exitCode = failed ? 1 : 0;
