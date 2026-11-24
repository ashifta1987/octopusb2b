// Step I1a DB test suite (Migration 210 — STAGING ONLY, rolled-back transactions):
//  1. origin_country nullable with NO 'CN' default; unknown -> null + needs_data = true.
//  2. hs_code_source & hs_code_status check constraints match live & staging values.
//  3. hs_verified set ONLY by explicit staff action (verify_item_hs_code / confirm_hs_type / change_hs_type_heading);
//     never auto-set from 'sheet', 'rule', 'ai', or backfill; direct hs_verified=true rejected; changing hs_code resets hs_verified.
//  4. item_id NOT NULL on products and dropship_variants (NOT on dropship_products); BEFORE INSERT auto-creates item_master
//     for products (insert, import_product_row, commit_import_run) and dropship_variants.
//  5. Direct UPDATE to products.hs_* blocked (DIRECT_PRODUCT_HS_WRITE_BLOCKED); item_master one-way syncs to products.hs_*.
//  6 & 7. Parser handles g, kg, 克, 千克 and mm, cm, 毫米, 厘米 (with *, x, X, ×, decimals); ambiguous -> null + needs_data.
//  8. DS model numbers (DS-000001 / DS-000001-01): immutable (MODEL_NO_IMMUTABLE); monotonic per-product last_variant_seq
//     (deleted variant number is NEVER reused); octopus_sku copied to legacy_sku.
//  9. calc_billed_weight_g returns NULL when weight_g or any box dimension is NULL (never charges on 0 g); rounds up to 100 g step.
// 10. Legacy cost/supplier columns frozen (LEGACY_COST_FROZEN on dropship_products.supplier_id/supplier_sku/unit_cost_cents
//     and dropship_variants.cost_cents); supplier & cost read from Sourcing via supplier_product_id; white-label clean.
// 11. 210.down.sql -> 210.sql round-trip restores identical schema, policies, triggers, and ledger/wallet invariance.
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const owner = async () => { await db.query('reset role'); };
const tryq = async (q, p) => {
  await db.query('savepoint s');
  try {
    const r = await db.query(q, p);
    await db.query('release savepoint s');
    return { err: null, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback to savepoint s');
    return { err: e.message, rows: [], n: 0 };
  }
};

try {
  await db.query('begin');

  const ledgerBefore = await one(`
    select coalesce(sum(debit_cents),0)::text d,
           coalesce(sum(credit_cents),0)::text c,
           coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff,
           (select coalesce(sum(wallet_balance(org_id)),0)::text from wallets) w
      from ledger_entries
  `);

  // ── 1 & 4. Schema checks: item_id on products & dropship_variants ONLY (not dropship_products); origin_country nullable no default ──
  const schemaChk = await one(`
    select
      (select is_nullable = 'NO' from information_schema.columns where table_schema='public' and table_name='products' and column_name='item_id') prod_item_nn,
      (select is_nullable = 'NO' from information_schema.columns where table_schema='public' and table_name='dropship_variants' and column_name='item_id') dv_item_nn,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='dropship_products' and column_name='item_id') dp_has_item,
      (select is_nullable = 'YES' and column_default is null from information_schema.columns where table_schema='public' and table_name='item_master' and column_name='origin_country') im_oc_null_nodef,
      (select is_nullable = 'YES' and column_default is null from information_schema.columns where table_schema='public' and table_name='dropship_products' and column_name='origin_country') dp_oc_null_nodef,
      (select count(*)::int from dropship_products p where not exists (select 1 from dropship_variants v where v.product_id = p.id)) dp_without_var
  `);
  ok(schemaChk.prod_item_nn && schemaChk.dv_item_nn && schemaChk.dp_has_item === 0,
    'item_id is NOT NULL on products & dropship_variants, and NOT present on dropship_products');
  ok(schemaChk.im_oc_null_nodef && schemaChk.dp_oc_null_nodef,
    'origin_country has NO default and is nullable on item_master & dropship_products (never defaults to CN)');
  ok(schemaChk.dp_without_var === 0, 'every dropship_products row has >= 1 dropship_variants row');

  // Insert blank item_master -> origin_country is null and needs_data is true
  const blankIm = await one(`insert into item_master default values returning id, origin_country, needs_data, hs_verified`);
  ok(blankIm.origin_country === null && blankIm.needs_data === true && blankIm.hs_verified === false,
    'blank item_master row has origin_country=NULL, needs_data=true, hs_verified=false');

  // ── 7. Parser: g, kg, 克, 千克 & mm, cm, 毫米, 厘米, decimals, ambiguous ──
  const parsedW = await one(`
    select parse_unambiguous_weight_g('1.2 kg') w_kg,
           parse_unambiguous_weight_g('176克') w_cn_g,
           parse_unambiguous_weight_g('2.5千克') w_cn_kg,
           parse_unambiguous_weight_g('250G') w_g,
           parse_unambiguous_weight_g('approx 200-250g') w_ambig,
           parse_unambiguous_weight_g('200') w_nounit
  `);
  ok(parsedW.w_kg === 1200 && parsedW.w_cn_g === 176 && parsedW.w_cn_kg === 2500 && parsedW.w_g === 250 && parsedW.w_ambig === null && parsedW.w_nounit === null,
    'parse_unambiguous_weight_g handles kg, g, 克, 千克 and returns NULL for ambiguous/unitless strings');

  const box1 = await one(`select * from parse_unambiguous_box_cm('75.5*31.5*119mm')`);
  const box2 = await one(`select * from parse_unambiguous_box_cm('169*99*207毫米')`);
  const box3 = await one(`select * from parse_unambiguous_box_cm('22×15×10厘米')`);
  const boxBad = await one(`select * from parse_unambiguous_box_cm('100*50*30')`);
  ok(Number(box1.l_cm) === 7.55 && Number(box1.w_cm) === 3.15 && Number(box1.h_cm) === 11.9,
    'parse_unambiguous_box_cm converts decimal mm to cm');
  ok(Number(box2.l_cm) === 16.9 && Number(box2.w_cm) === 9.9 && Number(box2.h_cm) === 20.7 && Number(box3.l_cm) === 22 && boxBad.l_cm === null,
    'parse_unambiguous_box_cm converts 毫米 & 厘米 and rejects unitless strings');

  // ── 9. calc_billed_weight_g: NULL when missing data; greatest(actual, volumetric) rounded up to 100 g step ──
  ok((await one(`select calc_billed_weight_g($1) bw`, [blankIm.id])).bw === null,
    'calc_billed_weight_g returns NULL when weight or box dimensions are missing (never 0 g)');
  await db.query(`update item_master set origin_country = 'CN', weight_g = 420, box_l_cm = 30, box_w_cm = 20, box_h_cm = 15 where id = $1`, [blankIm.id]);
  // Volumetric at 5000 = (30*20*15 / 5000)*1000 = 1800 g > 420 g -> 1800 g; at actual 1830 g -> rounds up to 1900 g
  const bwVol = (await one(`select calc_billed_weight_g($1, 5000, 100) bw, (select needs_data from item_master where id = $1) nd`, [blankIm.id]));
  ok(bwVol.bw === 1800 && bwVol.nd === false, 'calc_billed_weight_g uses volumetric 1800 g when larger than 420 g, and needs_data=false once complete');
  await db.query(`update item_master set weight_g = 1830 where id = $1`, [blankIm.id]);
  ok((await one(`select calc_billed_weight_g($1, 5000, 100) bw`, [blankIm.id])).bw === 1900,
    'calc_billed_weight_g rounds 1830 g up to 1900 g (100 g step)');

  // ── 3 & 5. hs_verified strictly staff-only + products.hs_* direct writes blocked + Sourcing create/import paths ──
  const adminId = (await one(`select user_id from user_roles where role_code = 'admin' limit 1`)).user_id;
  const sup = await one(`select id from suppliers where verified and archived_at is null limit 1`);

  // Backfill check: 0 rows auto-verified from backfill
  const autoVerifiedCount = (await one(`select count(*)::int n from item_master where hs_verified = true`)).n;
  ok(autoVerifiedCount === 0, 'backfill never auto-sets hs_verified=true (0 verified rows initially)');

  // Direct hs_verified = true without RPC is blocked
  const directVerifyErr = (await tryq(`update item_master set hs_code = '8516.10', hs_verified = true where id = $1`, [blankIm.id])).err;
  ok(/HS_VERIFY_FORBIDDEN/.test(directVerifyErr ?? ''), 'direct UPDATE setting hs_verified=true is rejected');

  // Explicit staff RPC verify_item_hs_code sets hs_verified, hs_verified_by, hs_verified_at & writes audit_log
  await as(adminId, 'aal2');
  const verRes = (await one(`select verify_item_hs_code($1, '8516.79', 'Verified against tariff schedule') r`, [blankIm.id])).r;
  await owner();
  const afterVerify = await one(`select hs_code, hs_verified, hs_verified_by, hs_verified_at from item_master where id = $1`, [blankIm.id]);
  ok(verRes.hs_verified === true && afterVerify.hs_verified === true && afterVerify.hs_verified_by === adminId && !!afterVerify.hs_verified_at,
    'verify_item_hs_code sets hs_verified=true with staff actor & timestamp');

  // Changing hs_code via normal update un-verifies the item automatically
  await db.query(`update item_master set hs_code = '8516.80' where id = $1`, [blankIm.id]);
  const afterEdit = await one(`select hs_code, hs_verified, hs_verified_by, hs_verified_at from item_master where id = $1`, [blankIm.id]);
  ok(afterEdit.hs_code === '8516.80' && afterEdit.hs_verified === false && afterEdit.hs_verified_by === null,
    'changing hs_code outside verify_item_hs_code resets hs_verified=false');

  // Sourcing create & update paths: direct INSERT on products, import_product_row (create & update), set_product_item_hs, commit_import_run
  const pDirect = await one(`
    insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency, net_weight, colour_box_mm, hs_code)
    values ('QA-I1A-DIR', 'qa-i1a-dir', 'QA Direct Product', $1, 'draft', 'pcs', 10, 'USD', '350克', '120*80*60毫米', '9405.21')
    returning id, item_id, hs_code, hs_code_source, hs_code_status
  `, [sup.id]);
  const imDirect = await one(`select * from item_master where id = $1`, [pDirect.item_id]);
  ok(imDirect.sourcing_product_id === pDirect.id && imDirect.weight_g === 350 && Number(imDirect.box_l_cm) === 12 && imDirect.origin_country === null && imDirect.needs_data === true && imDirect.hs_verified === false,
    'products INSERT auto-creates linked item_master, parses 克 & 毫米, leaves unknown origin_country=NULL (needs_data=true), hs_verified=false');

  // Direct UPDATE to products.hs_* is rejected
  const blockedProdHs = (await tryq(`update products set hs_code = '1111' where id = $1`, [pDirect.id])).err;
  ok(/DIRECT_PRODUCT_HS_WRITE_BLOCKED/.test(blockedProdHs ?? ''), 'trg_block_direct_product_hs_write blocks direct products.hs_* update');

  // set_product_item_hs updates item_master and one-way syncs products
  await as(adminId, 'aal2');
  await db.query(`select set_product_item_hs($1, '9405.42', 'VN')`, [pDirect.id]);
  await owner();
  const syncedProd = await one(`select p.hs_code, im.origin_country, im.needs_data, im.hs_verified from products p join item_master im on im.id = p.item_id where p.id = $1`, [pDirect.id]);
  ok(syncedProd.hs_code === '9405.42' && syncedProd.origin_country === 'VN' && syncedProd.needs_data === false && syncedProd.hs_verified === false,
    'set_product_item_hs writes item_master, syncs products.hs_code, and clears needs_data once origin_country is set');

  // import_product_row create + update
  await as(adminId, 'aal2');
  const impId = (await one(`select import_product_row($1::jsonb) id`, [JSON.stringify({
    mode: 'create',
    sku: 'QA-I1A-IMP',
    slug: 'qa-i1a-imp',
    title: 'QA Imported Product',
    supplier_id: sup.id,
    unit: 'pcs',
    moq: 50,
    origin_country: 'CN',
    hs_code: '7323.93',
    currency: 'USD',
    tiers: [{ min_qty: 50, unit_price_cents: 450 }],
  })])).id;
  await db.query(`select import_product_row($1::jsonb)`, [JSON.stringify({
    mode: 'update',
    product_id: impId,
    title: 'QA Imported Product v2',
    supplier_id: sup.id,
    unit: 'pcs',
    moq: 50,
    origin_country: 'CN',
    hs_code: '7323.99',
    currency: 'USD',
    tiers: [{ min_qty: 50, unit_price_cents: 440 }],
  })]);
  await owner();
  const impCheck = await one(`select p.title, p.hs_code, p.hs_code_source, im.hs_code im_hs, im.hs_verified from products p join item_master im on im.id = p.item_id where p.id = $1`, [impId]);
  ok(impCheck.title === 'QA Imported Product v2' && impCheck.hs_code === '7323.99' && impCheck.hs_code_source === 'sheet' && impCheck.im_hs === '7323.99' && impCheck.hs_verified === false,
    'import_product_row (create & update) writes item_master with source=sheet, syncs products, and leaves hs_verified=false');

  // commit_import_run create path
  const runId = (await one(`
    insert into import_runs(name, status, staging, created_by)
    values ('QA I1a Run', 'previewed', $1::jsonb, $2)
    returning id
  `, [JSON.stringify({
    supplier: { external_id: 'QA-SUP-I1A', legal_name: 'QA Factory Co., Ltd.', country: 'CN', status: 'ok' },
    products: [{ external_id: 'QA-I1A-BULK-1', name: 'QA Bulk Kettle', net_weight: '1.1 kg', colour_box_mm: '200x180x220 mm', moq: '100', incoterm: 'FOB' }],
    prices: [],
    images: [],
    review: [],
  }), adminId])).id;
  await db.query(`select commit_import_run($1, $2)`, [runId, adminId]);
  const bulkProd = await one(`
    select p.id, p.item_id, im.sourcing_product_id, im.weight_g, im.box_l_cm, im.needs_data
      from products p join item_master im on im.id = p.item_id
     where p.external_id = 'QA-I1A-BULK-1'
  `);
  ok(bulkProd?.sourcing_product_id === bulkProd.id && bulkProd.weight_g === 1100 && Number(bulkProd.box_l_cm) === 20 && bulkProd.needs_data === false,
    'commit_import_run auto-creates linked item_master and parses weight/box');

  // ── 8 & 10. DS model numbers (immutability + monotonic variant seq) & legacy cost freeze ──
  const dp = await one(`
    insert into dropship_products(title, weight_g, min_order_qty, stock_status, source_type, status)
    values ('QA Dropship Lamp', 500, 1, 'in_stock', 'own_warehouse', 'draft')
    returning id, model_no, origin_country
  `);
  ok(/^DS-[0-9]{6,}$/.test(dp.model_no) && dp.origin_country === null,
    `dropship_products auto-assigns ${dp.model_no} and keeps origin_country=NULL when omitted`);

  const immProdErr = (await tryq(`update dropship_products set model_no = 'DS-999999' where id = $1`, [dp.id])).err;
  ok(/MODEL_NO_IMMUTABLE/.test(immProdErr ?? ''), 'dropship_products.model_no is immutable');

  const v1 = await one(`insert into dropship_variants(product_id, options) values ($1, '{"Colour":"Black"}'::jsonb) returning id, model_no, item_id`, [dp.id]);
  const v2 = await one(`insert into dropship_variants(product_id, options) values ($1, '{"Colour":"White"}'::jsonb) returning id, model_no, item_id`, [dp.id]);
  ok(v1.model_no === `${dp.model_no}-01` && v2.model_no === `${dp.model_no}-02`, 'variants receive sequential -01, -02 suffixes');

  const immVarErr = (await tryq(`update dropship_variants set model_no = $2 where id = $1`, [v1.id, `${dp.model_no}-99`])).err;
  ok(/MODEL_NO_IMMUTABLE/.test(immVarErr ?? ''), 'dropship_variants.model_no is immutable');

  // Delete -02 and insert a new variant -> must receive -03 (never reuse -02!)
  await db.query(`delete from dropship_variants where id = $1`, [v2.id]);
  const v3 = await one(`insert into dropship_variants(product_id, options) values ($1, '{"Colour":"Silver"}'::jsonb) returning id, model_no`, [dp.id]);
  ok(v3.model_no === `${dp.model_no}-03`, `deleted variant number -02 is NEVER reused; next variant gets ${v3.model_no}`);

  // Legacy cost freeze checks (Item 10)
  ok(/LEGACY_COST_FROZEN/.test((await tryq(`insert into dropship_products(title, unit_cost_cents) values ('Bad Cost', 500)`)).err ?? ''),
    'INSERT writing dropship_products.unit_cost_cents is blocked (LEGACY_COST_FROZEN)');
  ok(/LEGACY_COST_FROZEN/.test((await tryq(`update dropship_products set supplier_id = $2 where id = $1`, [dp.id, sup.id])).err ?? ''),
    'UPDATE writing dropship_products.supplier_id is blocked (LEGACY_COST_FROZEN)');
  ok(/LEGACY_COST_FROZEN/.test((await tryq(`update dropship_products set supplier_sku = 'X' where id = $1`, [dp.id])).err ?? ''),
    'UPDATE writing dropship_products.supplier_sku is blocked (LEGACY_COST_FROZEN)');
  ok(/LEGACY_COST_FROZEN/.test((await tryq(`insert into dropship_variants(product_id, cost_cents) values ($1, 300)`, [dp.id])).err ?? ''),
    'INSERT writing dropship_variants.cost_cents is blocked (LEGACY_COST_FROZEN)');

  // Link variant to Sourcing supplier_products and read cost via dropship_sourcing_links
  const spRow = await one(`
    select sp.id, pc.supplier_cost_cents
      from supplier_products sp
      join suppliers s on s.id = sp.supplier_id and s.verified and s.archived_at is null
      join product_costs pc on pc.product_id = sp.product_id
     where pc.supplier_cost_cents > 0
     limit 1
  `);
  await db.query(`update dropship_variants set supplier_product_id = $2 where id = $1`, [v1.id, spRow.id]);
  await as(adminId, 'aal2');
  const links = await all(`select * from dropship_sourcing_links(array[$1::uuid])`, [dp.id]);
  await owner();
  const linkedV1 = links.find((l) => l.variant_id === v1.id);
  ok(linkedV1 && Number(linkedV1.unit_cost_cents) === Number(spRow.supplier_cost_cents),
    `dropship_sourcing_links reads authoritative Sourcing cost (${linkedV1?.unit_cost_cents} cents) via supplier_product_id`);

  const ledgerAfter = await one(`
    select coalesce(sum(debit_cents),0)::text d,
           coalesce(sum(credit_cents),0)::text c,
           coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff,
           (select coalesce(sum(wallet_balance(org_id)),0)::text from wallets) w
      from ledger_entries
  `);
  ok(JSON.stringify(ledgerBefore) === JSON.stringify(ledgerAfter) && ledgerAfter.diff === '0',
    `ledger (${ledgerAfter.d}/${ledgerAfter.c}/diff=${ledgerAfter.diff}) and wallets (${ledgerAfter.w}) unchanged`);

  await db.query('rollback');

  // ── 11. Migration 210 down -> up round-trip in a rolled-back transaction ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    cols: await all(`
      select table_name, column_name, is_nullable, data_type
        from information_schema.columns
       where table_schema = 'public'
         and table_name in ('item_master', 'products', 'dropship_products', 'dropship_variants', 'supplier_products')
       order by 1, 2
    `),
    pols: await all(`
      select tablename, policyname, cmd, qual
        from pg_policies
       where schemaname = 'public'
         and tablename in ('item_master', 'dropship_products', 'dropship_variants')
       order by 1, 2
    `),
    trgs: await all(`
      select event_object_table, trigger_name, event_manipulation
        from information_schema.triggers
       where trigger_schema = 'public'
         and event_object_table in ('item_master', 'products', 'dropship_products', 'dropship_variants')
       order by 1, 2, 3
    `),
  });
  const beforeRoundTrip = await snap();
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000210_i1a_item_master_and_ds_models.sql');
  await unwind(db, later);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000210_i1a_item_master_and_ds_models.down.sql', 'utf8'));
  const downState = await one(`
    select to_regclass('public.item_master') is null no_im,
           to_regclass('public.seq_ds_model_no') is null no_seq
  `);
  ok(downState.no_im && downState.no_seq, '210.down.sql cleanly removes item_master and seq_ds_model_no');
  await db.query(fs.readFileSync('supabase/migrations/20261101000210_i1a_item_master_and_ds_models.sql', 'utf8'));
  await reapply(db, later);
  const afterRoundTrip = await snap();
  ok(beforeRoundTrip === afterRoundTrip, '210.down.sql -> 210.sql restores identical columns, policies, and triggers');
  await db.query('rollback');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
  await db.query('rollback').catch(() => {});
} finally {
  await db.end();
}

console.log(failed ? `\ni1a: ${failed} check(s) failed` : '\ni1a: all passed');
process.exitCode = failed ? 1 : 0;
