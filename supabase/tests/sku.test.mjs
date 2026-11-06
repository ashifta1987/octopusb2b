// ADDON-33 DB tests — platform-wide unique SKUs (runs in one transaction, always rolled back).
// duplicate insert fails · same SKU different case fails · SKU with a space fails · delete then re-insert fails ·
// two suppliers cannot share a SKU · non-admin cannot change a SKU · admin change is audited · import_product_row works.
// Usage: node supabase/tests/sku.test.mjs   (optional: MIGRATION=path.sql to test before applying)
import { config } from 'dotenv'; import pg from 'pg'; import fs from 'node:fs';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const one = async (s, p) => (await db.query(s, p)).rows[0];
const before = Number((await one(`select count(*) n from products`)).n);
const err = async (sql, params) => { await db.query('savepoint t'); try { await db.query(sql, params); await db.query('release savepoint t'); return null; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
try {
  await db.query('begin');
  if (process.env.MIGRATION) await db.query(fs.readFileSync(process.env.MIGRATION, 'utf8'));
  const [s1, s2] = (await db.query(`select id from suppliers order by code limit 2`)).rows.map((r) => r.id);
  const ins = (sku, sup) => `insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency) values ('${sku}', 'qa-sku-' || gen_random_uuid(), 'QA sku test', '${sup}', 'draft', 'pcs', 1, 'USD') returning id`;
  const a = await one(ins('QA-SKU-0001', s1));
  ok(!!a.id, 'insert with a new SKU works');
  ok(/SKU_TAKEN|sku_norm_key/.test(await err(ins('QA-SKU-0001', s1)) ?? ''), 'duplicate SKU insert fails');
  ok(/SKU_TAKEN|sku_norm_key/.test(await err(ins('qa-sku-0001', s1)) ?? ''), 'same SKU in different case fails');
  ok(/SKU_TAKEN|sku_norm_key/.test(await err(ins(' QA-SKU-0001 ', s2)) ?? ''), 'two suppliers cannot share a SKU (padded with spaces too)');
  ok(/SKU_FORMAT|sku_format/.test(await err(ins('QA SKU 2', s1)) ?? ''), 'SKU with a space fails');
  ok(/SKU_FORMAT|sku_format/.test(await err(ins('QA', s1)) ?? ''), 'SKU shorter than 3 characters fails');
  const stored = await one(`select sku, sku_norm from products where id = $1`, [a.id]);
  ok(stored.sku === 'QA-SKU-0001' && stored.sku_norm === 'QA-SKU-0001', 'sku and sku_norm are generated, uppercase');
  await db.query(`delete from products where id = $1`, [a.id]);
  ok(/SKU_RETIRED/.test(await err(ins('QA-SKU-0001', s1)) ?? ''), 'delete then re-insert the same SKU fails (reserved forever)');
  // non-admin update
  const b = await one(ins('QA-SKU-0002', s1));
  const u = await one(`select ur.user_id from user_roles ur where ur.role_code = 'distributor' limit 1`);
  if (u) {
    await db.query('savepoint d');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.user_id, role: 'authenticated' })]);
    const e = await err(`update products set external_id = 'QA-SKU-9999' where id = $1`, [b.id]);
    await db.query('rollback to savepoint d');
    ok(/SKU_IMMUTABLE/.test(e ?? ''), 'a non-admin cannot change a SKU');
  } else ok(true, 'no distributor user to test immutability (skipped)');
  await db.query(`update products set external_id = 'QA-SKU-0003' where id = $1`, [b.id]); // service context = admin path
  const aud = await one(`select details from audit_log where action = 'product.sku_changed' and entity_id = $1 order by id desc limit 1`, [b.id]);
  ok(aud?.details?.from === 'QA-SKU-0002' && aud?.details?.to === 'QA-SKU-0003', 'SKU change written to audit_log');
  ok(/SKU_RETIRED|SKU_TAKEN/.test(await err(ins('QA-SKU-0002', s2)) ?? ''), 'the old SKU stays reserved after an admin change');
  // automatic id never lands on a reserved SKU
  const auto = await one(`insert into products(slug, title, supplier_id, status, unit, moq, currency) values ('qa-auto-' || gen_random_uuid(), 'QA auto', $1, 'draft', 'pcs', 1, 'USD') returning external_id`, [s1]);
  ok(/^[A-Z0-9][A-Z0-9._-]{2,39}$/.test(auto.external_id), `blank SKU gets an automatic valid one (${auto.external_id})`);
  // import_product_row: create then update, images de-duplicated by sha256
  const sha = 'a'.repeat(64);
  const id = (await one(`select import_product_row($1::jsonb) id`, [JSON.stringify({ mode: 'create', sku: 'QA-SKU-IMP1', slug: 'qa-imp-' + Date.now(), title: 'QA import row', supplier_id: s1, unit: 'pcs', moq: 10, currency: 'USD',
    tiers: [{ min_qty: 10, unit_price_cents: 500 }, { min_qty: 100, unit_price_cents: 400 }], images: [{ position: 1, url: 'https://example.com/a.jpg', storage_path: 'products/sha/a.jpg', source_file_name: 'A.jpg', sha256: sha }] })])).id;
  const r1 = await one(`select min_price_cents, image_url, (select count(*) from price_tiers where product_id = $1) tiers, (select count(*) from product_media where product_id = $1) media from products where id = $1`, [id]);
  ok(Number(r1.tiers) === 2 && Number(r1.media) === 1 && Number(r1.min_price_cents) === 400 && r1.image_url === 'https://example.com/a.jpg', 'import_product_row creates product + tiers + image');
  await one(`select import_product_row($1::jsonb) id`, [JSON.stringify({ mode: 'update', product_id: id, supplier_id: s1, title: 'QA import row v2', unit: 'pcs', moq: 10, currency: 'USD', tiers: [{ min_qty: 10, unit_price_cents: 450 }],
    images: [{ position: 2, url: 'https://example.com/a.jpg', storage_path: 'products/sha/a.jpg', source_file_name: 'A.jpg', sha256: sha }] })]);
  const r2 = await one(`select title, (select count(*) from price_tiers where product_id = $1) tiers, (select count(*) from product_media where product_id = $1) media from products where id = $1`, [id]);
  ok(r2.title === 'QA import row v2' && Number(r2.tiers) === 1 && Number(r2.media) === 1, 'update replaces tiers; the same photo is never stored twice for a product');
  const wrong = await err(`select import_product_row($1::jsonb)`, [JSON.stringify({ mode: 'update', product_id: id, supplier_id: s2, title: 'x', tiers: [] })]);
  ok(/NOT_EDITABLE/.test(wrong ?? ''), 'update through another supplier is refused');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  // sequences are NOT rewound: gaps are harmless, rewinding can collide with real rows written meanwhile
  const after = Number((await one(`select count(*) n from products`)).n);
  ok(after === before, `rolled back — nothing persisted (${before} products)`);
  await db.end();
  console.log(failed ? `\nsku: ${failed} check(s) failed` : '\nsku: all passed');
  process.exitCode = failed ? 1 : 0;
}
