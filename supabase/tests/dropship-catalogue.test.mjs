// ADDON-44-E · dropship catalogue — runs on the STAGING database (needs `pnpm demo:seed`), one transaction, rolled back.
//  · only verified, live, dropship-enabled products appear; switching a supplier to unverified removes its products
//  · blocked products come back with a reason and no prices
//  · responses carry service names only: no supplier name/code, no carrier name, no Octopus cost, no internal keys
//  · anonymous visitors cannot call the functions or read the tables; customers cannot read rates/products directly
//  · a customer sees only their own company's import list
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
const envName = (await one(`select value #>> '{}' v from site_settings where key = 'app_environment'`))?.v;
if (envName !== 'staging') { console.error('Refusing: not the staging database'); process.exit(1); }

try {
  await db.query('begin');
  const countries = (await db.query(`select distinct country from dropship_rates where active`)).rows.map((r) => r.country);
  ok(countries.length > 0, `demo routes present (${countries.join(', ')})`);
  const mkUser = async (email) => (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  const u1 = await mkUser(`ds-a-${Date.now()}@test.local`); const u2 = await mkUser(`ds-b-${Date.now()}@test.local`);
  const o1 = (await one(`insert into organizations(name, country) values ('DS test A', 'AE') returning id`)).id;
  const o2 = (await one(`insert into organizations(name, country) values ('DS test B', 'AE') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [o1, u1, o2, u2]);

  // forbidden strings: every supplier code / legal name / contact, every carrier name, Octopus cost values
  const sup = (await db.query(`select code, legal_name, contact_name, contact_email from suppliers`)).rows.flatMap((r) => [r.code, r.legal_name, r.contact_name, r.contact_email]).filter((x) => x && x.length > 3);
  const carriers = (await db.query(`select code, name from carriers`)).rows.flatMap((r) => [r.code, r.name]).filter((x) => x && x.length > 2);
  const costKeys = (await db.query(`select column_name from information_schema.columns where table_name = 'product_costs'`)).rows.map((r) => r.column_name).filter((c) => /cost|margin/.test(c));

  await as(u1);
  let all = [];
  for (const c of countries) all = all.concat((await db.query(`select * from dropship_catalogue($1)`, [c])).rows);
  const ids = [...new Set(all.map((r) => r.product_id))];
  const detail = [];
  for (const id of ids.slice(0, 6)) detail.push((await one(`select dropship_product_detail($1, $2) d`, [id, countries[0]])).d);
  await owner();
  const blob = JSON.stringify(all) + JSON.stringify(detail);
  ok(all.length > 0, `catalogue returns rows (${ids.length} products over ${countries.length} countries)`);
  ok(!sup.some((x) => blob.toLowerCase().includes(String(x).toLowerCase())), 'no supplier code, name or contact in any response');
  ok(!carriers.some((x) => blob.toLowerCase().includes(String(x).toLowerCase())) && !/yunexpress/i.test(blob), 'no carrier name in any response');
  ok(!costKeys.some((k) => blob.includes(`"${k}"`)) && !/supplier|margin|octopus_cost|unit_cost/i.test(Object.keys(all[0] ?? {}).join(',') + JSON.stringify(Object.keys(detail[0] ?? {}))), 'no Octopus cost / margin / supplier keys');

  const unverifiedLeak = await one(`select count(*)::int n from dropship_products d join products p on p.id = d.product_id join suppliers s on s.id = p.supplier_id where not s.verified and d.product_id = any($1::uuid[])`, [ids]);
  ok(unverifiedLeak.n === 0, 'every returned product has a verified supplier');
  const blocked = all.filter((r) => r.blocked_reason);
  ok(blocked.length > 0 && blocked.every((r) => r.services.length === 0), `blocked products carry a reason and no prices (${blocked.length})`);
  ok(all.filter((r) => !r.blocked_reason).every((r) => r.services.every((q) => q.total_cents === q.product_cents + q.ship_duty_cents + q.fee_cents)), 'total = product + shipping and duties + fulfilment fee');

  // switching a supplier to unverified removes its products (enforced in the database)
  const victim = await one(`select p.supplier_id, d.product_id from dropship_products d join products p on p.id = d.product_id where d.enabled limit 1`);
  await db.query(`update suppliers set verified = false where id = $1`, [victim.supplier_id]);
  await as(u1);
  const after = (await db.query(`select product_id from dropship_catalogue($1)`, [countries[0]])).rows.map((r) => r.product_id);
  const det = (await one(`select dropship_product_detail($1, $2) d`, [victim.product_id, countries[0]])).d;
  await owner();
  ok(!after.includes(victim.product_id) && det === null, 'unverified supplier → product gone from catalogue and detail');
  await db.query(`update suppliers set verified = true where id = $1`, [victim.supplier_id]);

  // anonymous and direct access
  await anon();
  const a1 = await tryQ(`select * from dropship_catalogue('AE')`);
  const a2 = await tryQ(`select * from dropship_rates`);
  await owner();
  ok(typeof a1 === 'string' && typeof a2 === 'string', 'anonymous: cannot call the catalogue or read rates');
  await as(u1);
  const d1 = await tryQ(`select * from dropship_rates`);
  const d2 = await tryQ(`select * from dropship_products`);
  await owner();
  ok(typeof d1 === 'string' && typeof d2 === 'string', 'customer: cannot read rates or dropship products directly');

  // import list isolation
  const pid = ids[0];
  await as(u1);
  await db.query(`insert into dropship_import_list(org_id, product_id) values ($1, $2)`, [o1, pid]);
  const cross = await tryQ(`insert into dropship_import_list(org_id, product_id) values ($1, $2)`, [o2, pid]);
  await owner();
  await as(u2);
  const seen = (await db.query(`select * from dropship_import_list`)).rows.length;
  await owner();
  ok(typeof cross === 'string' && seen === 0, 'import list: own company only (cannot write or read another company)');
} catch (e) {
  console.error(e); failed++;
} finally {
  await db.query('rollback'); await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall dropship catalogue checks passed');
process.exit(failed ? 1 : 0);
