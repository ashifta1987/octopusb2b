// ADDON-44-F · Make My Brand request — runs on the STAGING database, one transaction, rolled back.
//  · create_brand_project: MB-xxxx reference, verified products only, logo paths must be in the company's own folder,
//    bulk needs a country, audit-logged, the primary account manager is notified
//  · another company cannot read the project; anonymous cannot call the function
//  · brand-logos bucket: a customer can only write into their own company folder and cannot read another company's files
//  · public_suppliers exposes province (for "Octopus verified factory · province")
import { config } from 'dotenv'; import pg from 'pg';
const env = config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, processEnv: {} }).parsed;
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (sub) => { await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]); await db.query('set local role authenticated'); };
const anon = async () => { await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`); await db.query('set local role anon'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { const r = await db.query(sql, p); await db.query('release savepoint t'); return r; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
if ((await one(`select value #>> '{}' v from site_settings where key = 'app_environment'`))?.v !== 'staging') { console.error('Refusing: not staging'); process.exit(1); }

try {
  await db.query('begin');
  const mkUser = async (e) => (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [e])).id;
  const t = Date.now();
  const u1 = await mkUser(`mb-a-${t}@test.local`), u2 = await mkUser(`mb-b-${t}@test.local`), mgr = await mkUser(`mb-mgr-${t}@octopus.test`);
  const o1 = (await one(`insert into organizations(name, country) values ('MB test A', 'AE') returning id`)).id;
  const o2 = (await one(`insert into organizations(name, country) values ('MB test B', 'AE') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1,$2,'owner'), ($3,$4,'owner')`, [o1, u1, o2, u2]);
  await db.query(`insert into account_managers(org_id, staff_user_id, is_primary) values ($1, $2, true)`, [o1, mgr]);
  const verifiedP = (await one(`select p.id from products p join suppliers s on s.id = p.supplier_id where s.verified and s.archived_at is null and p.status = 'live' limit 1`)).id;
  // an unverified supplier's product (temporarily, inside the rolled-back transaction)
  const victim = await one(`select p.id, p.supplier_id from products p join suppliers s on s.id = p.supplier_id where p.status = 'live' and p.id <> $1 limit 1`, [verifiedP]);
  await db.query(`update suppliers set verified = false where id = $1`, [victim.supplier_id]);
  const unverifiedP = (await one(`select id from products where supplier_id = $1 and status = 'live' limit 1`, [victim.supplier_id])).id;

  await as(u1);
  const good = (await one(`select create_brand_project($1::jsonb) r`, [JSON.stringify({ product_id: verifiedP, quantity: '500', markets: ['AE'], method: 'pad', packaging: 'colour_box', logo_paths: [`${o1}/x-logo.svg`], stock_destination: 'warehouse', stores: ['Shopify'] })])).r;
  const unver = await tryQ(`select create_brand_project($1::jsonb)`, [JSON.stringify({ product_id: unverifiedP, markets: ['AE'], method: 'pad', packaging: 'standard', logo_paths: [], stock_destination: 'warehouse', stores: [] })]);
  const badPath = await tryQ(`select create_brand_project($1::jsonb)`, [JSON.stringify({ product_id: verifiedP, markets: [], method: 'pad', packaging: 'standard', logo_paths: [`${o2}/stolen.svg`], stock_destination: 'warehouse', stores: [] })]);
  const noCountry = await tryQ(`select create_brand_project($1::jsonb)`, [JSON.stringify({ product_id: verifiedP, markets: [], method: 'pad', packaging: 'standard', logo_paths: [], stock_destination: 'bulk', stores: [] })]);
  const noProduct = await tryQ(`select create_brand_project($1::jsonb)`, [JSON.stringify({ markets: [], method: 'pad', packaging: 'standard', logo_paths: [], stock_destination: 'warehouse', stores: [] })]);
  const linkOnly = (await one(`select create_brand_project($1::jsonb) r`, [JSON.stringify({ product_link: 'https://example.com/item', markets: ['SA'], method: 'unsure', packaging: 'unsure', logo_paths: [], stock_destination: 'bulk', bulk_country: 'SA', stores: ['Not yet'] })])).r;
  const mine = (await db.query(`select ref from brand_projects`)).rows.map((r) => r.ref);
  await owner();
  ok(/^MB-\d{4,}$/.test(good.ref) && good.notified === 1, `brand project created (${good.ref}) and the account manager notified`);
  ok(/PRODUCT_NOT_VERIFIED/.test(String(unver)), 'unverified supplier product → PRODUCT_NOT_VERIFIED');
  ok(/BAD_LOGO_PATH/.test(String(badPath)), "logo outside the company's folder → BAD_LOGO_PATH");
  ok(/BULK_COUNTRY_REQUIRED/.test(String(noCountry)), 'bulk without a country → BULK_COUNTRY_REQUIRED');
  ok(/PRODUCT_REQUIRED/.test(String(noProduct)), 'no product and no link → PRODUCT_REQUIRED');
  ok(/^MB-/.test(linkOnly.ref), 'a product link is accepted (checked by the account manager)');
  ok(mine.includes(good.ref) && mine.includes(linkOnly.ref), 'the company sees its own projects');
  const n = await one(`select count(*)::int n from notifications where user_id = $1 and title like 'New brand project%'`, [mgr]); // 8 Nov 2026: alert renamed (bug 2)
  ok(n.n === 2, 'the primary account manager gets one notification per project');
  const audit = await one(`select count(*)::int n from audit_log where action = 'brand_project.created' and org_id = $1`, [o1]);
  ok(audit.n === 2, 'every project is audit-logged');

  await as(u2);
  const other = (await db.query(`select ref from brand_projects where org_id = $1`, [o1])).rows.length;
  const wrongFolder = await tryQ(`insert into storage.objects(bucket_id, name, owner) values ('brand-logos', $1, $2)`, [`${o1}/sneaky.svg`, u2]);
  const ownFolder = await tryQ(`insert into storage.objects(bucket_id, name, owner) values ('brand-logos', $1, $2) returning id`, [`${o2}/ok.svg`, u2]);
  await owner();
  await db.query(`insert into storage.objects(bucket_id, name, owner) values ('brand-logos', $1, $2)`, [`${o1}/secret.svg`, u1]);
  await as(u2);
  const peek = (await db.query(`select name from storage.objects where bucket_id = 'brand-logos' and name like $1`, [`${o1}/%`])).rows.length;
  await owner();
  ok(other === 0, "another company cannot read the project");
  ok(typeof wrongFolder === 'string' && typeof ownFolder !== 'string', "logo upload only into the company's own folder");
  ok(peek === 0, "another company cannot list or read the logo files");

  await anon();
  const a = await tryQ(`select create_brand_project('{}'::jsonb)`);
  await owner();
  ok(typeof a === 'string', 'anonymous cannot call create_brand_project');

  const prov = await one(`select count(*)::int n from information_schema.columns where table_name = 'public_suppliers' and column_name = 'province'`);
  ok(prov.n === 1, 'public_suppliers exposes province');
} catch (e) {
  console.error(e); failed++;
} finally {
  await db.query('rollback'); await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall Make My Brand request checks passed');
process.exit(failed ? 1 : 0);
