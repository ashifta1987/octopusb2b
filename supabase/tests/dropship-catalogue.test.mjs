// Migrations 204, 205 & 210 — Dropshipping catalogue v2 + DS model numbers + Sourcing supplier_product_id link.
// STAGING ONLY, one rolled-back transaction, acting as each user through JWT claims.
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
const as = async (uid, aal = 'aal1') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const asAnon = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
  await db.query('set local role anon');
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

  // ── 1. Schema & old functions ──
  const hasNewCols = await one(`
    select (select count(*) from information_schema.columns where table_schema='public' and table_name='dropship_products' and column_name in ('id','model_no','legacy_sku','last_variant_seq','source_type','status','is_test'))::int p,
           (select count(*) from information_schema.columns where table_schema='public' and table_name='dropship_variants' and column_name in ('id','model_no','legacy_sku','item_id','supplier_product_id'))::int v,
           (select to_regclass('public.dropship_routes') is not null) routes,
           (select to_regclass('public.dropship_markets') is not null) markets,
           (select to_regprocedure('public.get_dropship_catalogue(text,text,text,integer)') is not null) fn_cat,
           (select to_regprocedure('public.get_dropship_product(uuid,text)') is not null) fn_det,
           (select to_regprocedure('public.dropship_catalogue(text)') is null) old_gone
  `);
  ok(hasNewCols?.p === 7 && hasNewCols?.v === 5 && hasNewCols?.routes && hasNewCols?.markets && hasNewCols?.fn_cat && hasNewCols?.fn_det && hasNewCols?.old_gone,
    'v2 + I1a columns (model_no, item_id, supplier_product_id) and get_dropship_* functions exist; old dropship_catalogue() is dropped');
  if (!hasNewCols?.fn_cat) throw new Error('migrations 204/205/210 not applied yet');

  const bucket = await one(`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'dropship-media'`);
  ok(bucket && bucket.public === true && Number(bucket.file_size_limit) === 5242880, 'storage bucket dropship-media: public read, 5 MB limit');

  // ── Fixtures ──
  const mkUser = async (tag, role = null, divs = []) => {
    const email = `ds204-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `T ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    for (const [code, r] of divs) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
    return id;
  };
  const merchantA = await mkUser('merA');
  const merchantB = await mkUser('merB');
  const noDsBuyer = await mkUser('noDs');
  const supplierUser = await mkUser('sup', 'supplier');
  const dsStaff = await mkUser('dsStaff', 'operations', [['DS', 'staff']]);
  const finStaff = await mkUser('fin', 'finance');
  const supStaff = await mkUser('support', 'support');

  const orgA = (await one(`insert into organizations(name, country) values ('TEST DS Org A', 'AE') returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country) values ('TEST DS Org B', 'GB') returning id`)).id;
  const orgNoDs = (await one(`insert into organizations(name, country) values ('TEST No DS Org', 'AE') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1,$2,'owner'), ($3,$4,'owner'), ($5,$6,'owner'), ($1,$7,'buyer')`,
    [orgA, merchantA, orgB, merchantB, orgNoDs, noDsBuyer, supplierUser]);
  await db.query(`insert into company_services(org_id, service, status) values ($1,'dropship','on'), ($2,'dropship','on'), ($3,'sourcing','on') on conflict (org_id, service) do update set status = excluded.status`,
    [orgA, orgB, orgNoDs]);
  await db.query(`insert into dropship_markets(org_id, country) values ($1,'AE'), ($1,'SA'), ($2,'GB')`, [orgA, orgB]);

  const verSp = await one(`
    select sp.id as sp_id, s.id as sup_id, s.code, s.legal_name, coalesce(sp.supplier_model, 'FACTORY-SECRET-991') as sup_model
      from supplier_products sp
      join suppliers s on s.id = sp.supplier_id
     where s.verified and s.archived_at is null
     limit 1
  `);
  const prodRow = await one(`
    insert into dropship_products(legacy_sku, title, description, category, images, specs, weight_g, dimensions_cm,
      min_order_qty, source_type, origin_country, status, is_test)
    values ('LEGACY-SECRET-204-A', 'TEST – Precision Desk Lamp', 'Aluminium desk lamp with USB-C input', 'Lighting',
      array['https://example.com/dropship-media/00000000-0000-0000-0000-000000000001.webp'],
      '{"Wattage":"12W","Material":"Aluminium"}'::jsonb, 620, '{"l":32,"w":14,"h":8}'::jsonb,
      1, 'partner_supplier', 'CN', 'active', false)
    returning id, model_no
  `);
  const prod = prodRow.id;
  const prodModelNo = prodRow.model_no;
  ok(/^DS-[0-9]{6,}$/.test(prodModelNo), `product auto-assigned DS model_no (${prodModelNo})`);

  const varRow = await one(`
    insert into dropship_variants(product_id, options, legacy_sku, supplier_product_id, price_adjust_cents, sort)
    values ($1, '{"Colour":"Matte Black"}'::jsonb, 'LEGACY-VAR-204-BLK', $2, 0, 0)
    returning id, model_no, item_id
  `, [prod, verSp.sp_id]);
  const var1 = varRow.id;
  ok(varRow.model_no === `${prodModelNo}-01` && !!varRow.item_id, `variant auto-assigned ${varRow.model_no} and item_id`);

  await db.query(`
    insert into dropship_routes(product_id, destination_country, shipping_method, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, carrier, is_active)
    values ($1, 'AE', 'express', 1950, 520, 95, 3, 5, 'SECRET-CARRIER-YUN', true),
           ($1, 'GB', 'standard', 2150, 610, 140, 6, 9, 'SECRET-CARRIER-DHL', false)
  `, [prod]);

  // ── 2. Eligibility gate: zero rows for non-DS org, supplier account, staff account, anon ──
  await asAnon();
  ok(/permission denied/.test((await tryq(`select * from get_dropship_catalogue('AE')`)).err ?? ''), 'anon: cannot call get_dropship_catalogue');

  await as(noDsBuyer);
  ok((await all(`select * from get_dropship_catalogue('AE')`)).length === 0, 'customer without dropshipping switched on: 0 rows');

  await as(supplierUser);
  ok((await all(`select * from get_dropship_catalogue('AE')`)).length === 0, 'supplier account (even in a DS-enabled org): 0 rows');

  await as(dsStaff, 'aal2');
  ok((await all(`select * from get_dropship_catalogue('AE')`)).length === 0, 'staff account in a customer session: 0 rows from merchant RPC');

  // ── 3. Route & market filtering ──
  await as(merchantA);
  const rowsAE = (await all(`select * from get_dropship_catalogue('AE')`)).filter((r) => r.model_no === prodModelNo);
  ok(rowsAE.length === 1, 'eligible merchant with AE market and active AE route sees the product by model_no');
  const rowsSA = (await all(`select * from get_dropship_catalogue('SA')`)).filter((r) => r.model_no === prodModelNo);
  ok(rowsSA.length === 0, 'route filtering: product with no route to SA does not appear for SA');
  const rowsGB_A = (await all(`select * from get_dropship_catalogue('GB')`)).filter((r) => r.model_no === prodModelNo);
  ok(rowsGB_A.length === 0, 'market filtering: country not in merchant A selling countries returns 0 rows');

  await as(merchantB);
  const rowsGB_B = (await all(`select * from get_dropship_catalogue('GB')`)).filter((r) => r.model_no === prodModelNo);
  ok(rowsGB_B.length === 0, 'inactive route: GB route with is_active=false does not appear');

  // ── 4. White-label check on catalogue and product detail output (B10: no legacy_sku, sourcing_product_id, item_id, cost, supplier) ──
  await as(merchantA);
  const det = (await one(`select get_dropship_product($1, 'AE') d`, [prod])).d;
  const blob = JSON.stringify(rowsAE[0]) + JSON.stringify(det);
  const badKeys = /supplier|unit_cost|cost_cents|source_type|carrier|margin|est_shipping|est_duties|stock_qty|octopus_sku|legacy_sku|sourcing_product_id|supplier_product_id|item_id/i;
  ok(!badKeys.test(blob), 'no supplier, carrier, cost, margin, source_type, stock_qty, octopus_sku, legacy_sku, sourcing_product_id, supplier_product_id or item_id key in catalogue/detail');
  ok(!blob.includes('LEGACY-SECRET-204-A') && !blob.includes('LEGACY-VAR-204-BLK') && !blob.includes('SECRET-CARRIER-YUN') && !blob.includes(verSp.code) && !blob.toLowerCase().includes(verSp.legal_name.toLowerCase()),
    'no legacy_sku, supplier code/name/SKU or carrier name value in response');

  // ── 5. Import list & markets RLS ──
  const insA = await tryq(`insert into dropship_import_list(org_id, product_id, variant_id, service, price_cents) values ($1, $2, $3, 'express', 2999)`, [orgA, prod, var1]);
  ok(!insA.err, 'merchant A can save to own import list (integer cents)');
  const crossIns = await tryq(`insert into dropship_import_list(org_id, product_id, variant_id) values ($1, $2, $3)`, [orgB, prod, var1]);
  ok(!!crossIns.err, 'merchant A cannot insert into merchant B import list');

  await as(merchantB);
  ok((await all(`select * from dropship_import_list where org_id = $1`, [orgA])).length === 0, 'merchant B cannot read merchant A import list');
  ok((await tryq(`delete from dropship_import_list where org_id = $1`, [orgA])).n === 0, 'merchant B cannot delete merchant A import list');

  for (const t of ['dropship_products', 'dropship_variants', 'dropship_routes', 'dropship_rates', 'item_master']) {
    const r = await tryq(`select count(*)::int n from ${t}`);
    ok(r.err || r.rows[0].n === 0, `merchant: 0 direct rows on ${t}`);
  }

  // Markets update + staff lock
  await as(merchantA);
  const setM = await tryq(`select set_dropship_markets(array['AE','GB'])`);
  ok(!setM.err, 'merchant A can update own selling countries when unlocked');

  await as(dsStaff, 'aal2');
  const lockM = await tryq(`select set_dropship_markets(array['AE'], $1, true)`, [orgA]);
  ok(!lockM.err, 'DS staff can update and lock merchant A selling countries');

  await as(merchantA);
  const blockedM = await tryq(`select set_dropship_markets(array['AE','SA'])`);
  ok(/MARKETS_LOCKED/.test(blockedM.err ?? ''), 'merchant A cannot change selling countries once locked by staff');

  // ── 6. Staff roles & white-label helper ──
  await as(dsStaff, 'aal2');
  const hits = await all(`select * from dropship_whitelabel_hits(array[$1, 'Clean text'])`, [`Made by ${verSp.legal_name} (${verSp.code})`]);
  ok(hits.length >= 2, `dropship_whitelabel_hits detects supplier name and code (${hits.length} hits)`);

  await as(finStaff, 'aal2');
  ok((await one(`select dropship_can_see_costs() ok`)).ok === true, 'Finance can see costs and margins');
  ok((await tryq(`update dropship_products set title = 'x' where id = $1`, [prod])).n === 0, 'Finance cannot edit dropship products (read-only)');

  await as(supStaff, 'aal2');
  ok((await one(`select dropship_can_see_costs() ok`)).ok === false, 'Support has dropship_can_see_costs() = false');
  ok(/FORBIDDEN/.test((await tryq(`select * from dropship_sourcing_links()`)).err ?? ''), 'Support cannot call dropship_sourcing_links()');
  ok((await tryq(`update dropship_products set title = 'x' where id = $1`, [prod])).n === 0, 'Support cannot edit dropship products (read-only)');

  await owner();
  await db.query('rollback');

  // ── 7. Down → up identical check (unwinding later applied migrations around 205/204, then re-applying) ──
  await db.query('begin');
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000205_dropship_catalogue_functions.sql');
  const snap = async () => JSON.stringify({
    pol: await all(`select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename like 'dropship%' order by 1, 2`),
    cols: await all(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name like 'dropship%' order by 1, 2`),
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like '%dropship%') order by 1`),
  });
  const after = await snap();
  await unwind(db, later);
  await db.query(`
    delete from dropship_import_list;
    delete from dropship_routes;
    delete from dropship_variants;
    delete from dropship_products;
    delete from dropship_markets;
  `);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000205_dropship_catalogue_functions.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000204_dropship_catalogue_v2.down.sql', 'utf8'));
  const downHasOld = await one(`select to_regprocedure('public.dropship_catalogue(text)') is not null ok, to_regclass('public.dropship_routes') is null no_routes`);
  ok(downHasOld.ok && downHasOld.no_routes, 'down: restores 183 schema and dropship_catalogue(text)');
  await db.query(fs.readFileSync('supabase/migrations/20261101000204_dropship_catalogue_v2.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261101000205_dropship_catalogue_functions.sql', 'utf8'));
  await reapply(db, later);
  ok((await snap()) === after, 'up again (204 + 205 + later): identical policies, columns and function permissions');

  // Verify the 204 guard refuses when a row exists in dropship_products on a non-staging environment
  await unwind(db, later);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000205_dropship_catalogue_functions.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000204_dropship_catalogue_v2.down.sql', 'utf8'));
  const anyProd = (await one(`select id from products limit 1`)).id;
  await db.query(`insert into dropship_products(product_id, enabled, unit_cents, weight_g) values ($1, true, 500, 200)`, [anyProd]);
  await db.query(`update site_settings set value = '"production"'::jsonb where key = 'app_environment'`);
  const refused = await tryq(fs.readFileSync('supabase/migrations/20261101000204_dropship_catalogue_v2.sql', 'utf8'));
  ok(/DROPSHIP_REBUILD_REFUSED/.test(refused.err ?? ''), '204 guard refuses to drop when a row exists in dropship_products on a non-staging DB');
  await db.query('rollback');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
  await db.query('rollback').catch(() => { });
} finally {
  await db.end();
}
console.log(failed ? `\ndropship catalogue v2: ${failed} check(s) failed` : '\ndropship catalogue v2: all passed');
process.exitCode = failed ? 1 : 0;
