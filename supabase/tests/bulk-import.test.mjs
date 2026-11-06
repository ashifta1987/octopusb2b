// ADDON-27: commit_import_run() + publish gate + idempotency + supersede + second supplier — ONE ROLLED-BACK
// transaction against the real schema (nothing persists). Images use placeholder URLs (no Storage upload here).
import fs from 'node:fs';
import { config } from 'dotenv'; import pg from 'pg';
import { unzipSync } from 'fflate';
import { parseWorkbook } from '../../lib/import/parse-workbook.ts';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const one = async (s, p) => (await db.query(s, p)).rows[0];
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const expectErr = async (fn, re, m) => { await db.query('savepoint e'); try { await fn(); ok(false, m + ' (no error)'); } catch (e) { ok(re.test(e.message), `${m} → ${e.message.slice(0, 110)}`); } await db.query('rollback to savepoint e'); };

const zip = unzipSync(new Uint8Array(fs.readFileSync('data/bulk/bowijie/images.zip')));
const batch = await parseWorkbook(fs.readFileSync('data/bulk/bowijie/source.xlsx'), { validFrom: '2026-11-01', validDays: 30, outlierX: 3, imageFiles: Object.keys(zip) });
batch.images.forEach((i) => (i.url = `https://example.invalid/import/${i.external_id}/${i.file}`));
const stage = async (b, name) => (await one(`insert into import_runs(name, staging) values ($1, $2) returning id`, [name, JSON.stringify(b)])).id;

// sequences are NOT transactional (setval/nextval survive a rollback) — snapshot them and put them back afterwards
const before = Number((await one(`select count(*) n from products`)).n);
const seqSnapshot = (await db.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)).rows;
await db.query('begin');
try {
  const admin = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;

  // 1 · first import
  const r1 = (await one(`select commit_import_run($1, $2) c`, [await stage(batch, 'Bowijie test'), admin])).c;
  console.log('  first commit:', JSON.stringify(r1));
  // the live catalogue may already hold Bowijie (loaded 6 Nov 2026) → count create + skip
  const n = (t) => (t.create ?? 0) + (t.skip ?? 0) + (t.update ?? 0);
  ok(n(r1.suppliers) === 1 && n(r1.products) === 69 && n(r1.supplier_products) === 69 && n(r1.prices) === 77 && n(r1.images) === 53,
    `69 draft products, 1 supplier, 69 supplier links, 77 tiered prices, 53 images (${r1.products.create ? 'created' : 'already loaded'})`);
  const sup = await one(`select id, code, legal_name, identity_status, (select count(*) from supplier_name_variants v where v.supplier_id = s.id) variants,
    (select count(*) from supplier_contacts c where c.supplier_id = s.id) contacts from suppliers s where external_id = 'CN-GD-BWJ-0010'`);
  ok(sup.identity_status === 'needs_identity_review' && Number(sup.variants) === 3 && Number(sup.contacts) === 1, `supplier ${sup.code} "${sup.legal_name}" — 3 name variants, identity review pending, 1 contact`);
  const st = await one(`select count(*) filter (where status in ('draft', 'submitted', 'in_review')) drafts, count(*) filter (where listing_status = 'needs_quote') nq,
    count(*) filter (where listing_status = 'in_development') dev, count(*) n from products where external_id like 'CN-GD-BWJ-%'`);
  ok(Number(st.drafts) === 69 && Number(st.nq) === 18 && Number(st.dev) === 1, `none of the 69 is live (draft or in moderation; 18 need a quote, 1 in development)`);
  const rv = await one(`select count(*) n from import_review_items where external_id like 'CN-GD-BWJ-%' and status = 'open'`);
  ok(Number(rv.n) === batch.review.length, `${rv.n} review items waiting for a decision`);

  // buyer prices = cost × (1 + 25 %) rounded up to the cent; supplier cost kept separately
  const f8 = await one(`select p.id, p.min_price_cents, p.moq, (select json_agg(json_build_object('q', min_qty, 'c', unit_price_cents) order by min_qty) from price_tiers t where t.product_id = p.id) tiers,
    (select supplier_cost_cents from product_costs c where c.product_id = p.id) cost from products p where external_id = 'CN-GD-BWJ-F8'`);
  ok(Number(f8.min_price_cents) === 577 && Number(f8.cost) === 461 && f8.moq === 3000, `F8: cost US$ 4.61 → buyer price US$ 5.77 at MOQ 3000`);
  const p05 = await one(`select (select json_agg(json_build_object('q', min_qty, 'c', unit_price_cents) order by min_qty) from price_tiers t where t.product_id = p.id) tiers from products p where external_id = 'CN-GD-BWJ-P05'`);
  ok(JSON.stringify(p05.tiers) === JSON.stringify([{ q: 1000, c: 168 }, { q: 3000, c: 140 }]), `P05 tiers: 1000+ US$ 1.68, 3000+ US$ 1.40 (cheapest variant + 25 %) → ${JSON.stringify(p05.tiers)}`);
  const s13 = await one(`select (select count(*) from supplier_product_prices x where x.product_id = p.id and price_minor = 122080) n from products p where external_id = 'CN-GD-BWJ-S13'`);
  ok(Number(s13.n) === 1, 'S13 price 12.208 stored with 4-dp precision (122080)');

  // 2 · publish gate (since 6 Nov 2026 it guards → live; products may wait in the moderation queue)
  await expectErr(() => db.query(`update products set status = 'live' where external_id = 'CN-GD-BWJ-F9'`), /IMPORT_PUBLISH_BLOCKED.*legal-name/, 'cannot publish while the supplier identity is unresolved');
  await db.query(`update supplier_name_variants set is_canonical = true where supplier_id = $1 and seen_in = 'fan_quotation_2026_11'`, [sup.id]);
  await db.query(`update suppliers set identity_status = 'ok' where id = $1`, [sup.id]);
  await expectErr(() => db.query(`update products set status = 'live' where external_id = 'CN-GD-BWJ-F8'`), /IMPORT_PUBLISH_BLOCKED.*review/, 'F8 still blocked by its open review item');
  await expectErr(() => db.query(`update products set status = 'live' where external_id = 'CN-GD-BWJ-MQ01'`), /IMPORT_PUBLISH_BLOCKED.*not quoted/, 'a needs-quote product cannot be published');
  await db.query(`update import_review_items set status = 'resolved' where external_id = 'CN-GD-BWJ-F8'`);
  await db.query(`update products set status = 'live' where external_id = 'CN-GD-BWJ-F8'`);
  ok((await one(`select status from products where external_id = 'CN-GD-BWJ-F8'`)).status === 'live', 'F8 can be published once identity + review are resolved');
  await db.query(`update products set status = 'live' where external_id = 'CN-GD-BWJ-F15'`).then(() => ok(true, 'a product without review items (F15) can be published'), (e) => ok(false, 'F15: ' + e.message));

  // 3 · idempotent re-import
  const r2 = (await one(`select commit_import_run($1, $2) c`, [await stage(batch, 'Bowijie again'), admin])).c;
  ok(r2.products.create === 0 && r2.products.update === 0 && r2.products.skip === 69 && r2.prices.create === 0 && r2.prices.update === 0 && r2.prices.skip === 77
     && r2.images.create === 0 && r2.supplier_products.create === 0 && r2.review.create === 0, `importing the same workbook again changes nothing → ${JSON.stringify({ p: r2.products, pr: r2.prices, i: r2.images })}`);
  ok((await one(`select status from products where external_id = 'CN-GD-BWJ-F8'`)).status === 'live', 're-import keeps a product\'s status (live stays live, no reset to draft)');

  // 4 · modified workbook: 1 new product + 1 changed price
  const mod = structuredClone(batch);
  const np = { ...structuredClone(mod.products[0]), external_id: 'CN-GD-BWJ-F8X', factory_model: 'F8X', name: 'Handheld fan F8X (test)' };
  mod.products.push(np);
  mod.prices.push({ ...mod.prices[0], external_id: 'CN-GD-BWJ-F8X' });
  const target = mod.prices.find((p) => p.external_id === 'CN-GD-BWJ-F9');
  target.price_minor = 47000;
  const r3 = (await one(`select commit_import_run($1, $2) c`, [await stage(mod, 'Bowijie modified'), admin])).c;
  ok(r3.products.create === 1 && r3.products.update === 0 && r3.prices.update === 1 && r3.prices.create === 1, `modified workbook → products +1 create, prices 1 update (+1 for the new product) → ${JSON.stringify({ p: r3.products, pr: r3.prices })}`);
  ok(Number((await one(`select min_price_cents from products where external_id = 'CN-GD-BWJ-F9'`)).min_price_cents) === 588, 'buyer price follows the updated cost (4.70 → 5.88)');

  // 5 · a newer quote supersedes the older row
  const nov = structuredClone(batch); nov.prices = nov.prices.filter((p) => p.external_id === 'CN-GD-BWJ-F11').map((p) => ({ ...p, valid_from: '2026-12-01', valid_to: '2026-12-31', price_minor: 50000 }));
  nov.products = nov.products.filter((p) => p.external_id === 'CN-GD-BWJ-F11'); nov.images = []; nov.review = [];
  const r4 = (await one(`select commit_import_run($1, $2) c`, [await stage(nov, 'Bowijie December'), admin])).c;
  const sup1 = await one(`select count(*) filter (where is_superseded) old, count(*) filter (where not is_superseded) cur from supplier_product_prices x join products p on p.id = x.product_id where p.external_id = 'CN-GD-BWJ-F11'`);
  ok(r4.prices.create === 1 && r4.prices.superseded === 1 && Number(sup1.old) === 1 && Number(sup1.cur) === 1, 'a December quote supersedes the November row (is_superseded = true)');

  // 6 · a second supplier for the same product adds a row, never overwrites the first
  const two = structuredClone(batch);
  two.supplier = { ...two.supplier, external_id: 'CN-ZJ-TST-0001', legal_name: 'Test Second Supplier Co.', name_variants: [], contacts: [], status: 'ok' };
  two.products = two.products.filter((p) => p.external_id === 'CN-GD-BWJ-F12'); two.prices = two.prices.filter((p) => p.external_id === 'CN-GD-BWJ-F12').map((p) => ({ ...p, price_minor: 40000 }));
  two.images = []; two.review = [];
  await one(`select commit_import_run($1, $2) c`, [await stage(two, 'Second supplier'), admin]);
  const links = await one(`select count(*) n, count(*) filter (where is_preferred) pref, (select count(*) from supplier_product_prices x where x.product_id = p.id) prices
    from supplier_products sp join products p on p.id = sp.product_id where p.external_id = 'CN-GD-BWJ-F12' group by p.id`);
  ok(Number(links.n) === 2 && Number(links.pref) === 1 && Number(links.prices) === 2, 'F12 now has 2 suppliers with their own prices; the first stays preferred');

  // 7 · audit + RLS
  ok(Number((await one(`select count(*) n from audit_log where action = 'bulk_import_committed' and actor_id = $1 and created_at > now() - interval '5 minutes'`, [admin])).n) >= 5, 'every commit is in the audit log');
  const buyer = (await one(`select id from auth.users where email = 'buyer@demo.octopusb2b.com'`))?.id;
  if (buyer) {
    await db.query('savepoint b');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: buyer, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    const seen = await one(`select (select count(*) from supplier_product_prices) prices, (select count(*) from supplier_products) links, (select count(*) from import_review_items) review`);
    await db.query('rollback to savepoint b');
    ok(Number(seen.prices) === 0 && Number(seen.links) === 0 && Number(seen.review) === 0, 'a customer cannot read supplier costs, supplier links or review items');
  }
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  for (const r of seqSnapshot) {
    if (r.last_value == null) await db.query(`select setval($1, 1, false)`, [r.sequencename]);
    else await db.query(`select setval($1, $2, true)`, [r.sequencename, r.last_value]);
  }
  const left = await one(`select count(*) n from products`);
  ok(Number(left.n) === before, `rolled back — nothing persisted (${before} products before and after)`);
  await db.end();
}
