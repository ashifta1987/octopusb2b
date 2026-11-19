// Divisions step 5b (migration 199): division_report(). STAGING ONLY, rolled back, acting as each user via JWT claims.
//  · a company-wide Admin gets six division rows + "Advertising" + "Company-wide (other)"; revenue per division equals
//    the ledger (revenue accounts, by the journal's division); advertising is its own line; company total = sum of rows
//  · orders and open work per division match direct counts
//  · Dropshipping staff see only the Dropshipping row (no company-wide lines); a customer is refused
//  · 199 down → up identical
// Run: node supabase/tests/division-report.test.mjs
import pg from 'pg'; import fs from 'node:fs';
import { loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
loadStagingEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid) => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2' })]); await db.query('set local role authenticated'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [] }; } };
const user = async (email, role, div) => {
  const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, email, email]);
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  if (div) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), 'staff')`, [id, div]);
  return id;
};
try {
  await db.query('begin');
  const adm = await user('rep-admin@example.com', 'admin');
  const ds = await user('rep-ds@example.com', 'operations', 'DS');
  const cust = await user('rep-cust@example.com');

  // expected values straight from the tables (as the database owner)
  const exp = {};
  for (const r of await all(`select d.code, coalesce((select sum(le.credit_cents - le.debit_cents) from journals j join ledger_entries le on le.journal_id = j.id
      join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' where j.division_id = d.id), 0)::bigint net from divisions d`)) exp[r.code] = { rev: Number(r.net) };
  const adv = Number((await one(`select coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint n from ledger_entries le join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' join journals j on j.id = le.journal_id where j.division_id is null and j.report_line = 'advertising'`)).n);
  for (const r of await all(`select d.code, count(o.id)::int n from divisions d left join orders o on o.division_id = d.id and o.status <> 'cancelled' group by 1`)) exp[r.code].orders = r.n;
  for (const r of await all(`select d.code, (select count(*) from rfqs where division_id = d.id and status in ('submitted','assigned','quoting'))
      + (select count(*) from service_requests where division_id = d.id and status in ('requested','paid','accepted','in_progress','report_ready'))
      + (select count(*) from orders where division_id = d.id and status not in ('delivered','closed','cancelled'))
      + (select count(*) from brand_projects where division_id = d.id and status <> 'closed')
      + (select count(*) from pools where division_id = d.id and status in ('open','locked','confirmed','shipped'))
      + (select count(*) from turnkey_leads where division_id = d.id and status in ('new','contacted','quoted'))
      + (select count(*) from shipments where division_id = d.id and status not in ('delivered','returned')) n from divisions d`)) exp[r.code].work = Number(r.n);

  await as(adm);
  const rows = await all(`select * from division_report(null, null, true)`);
  const divRows = rows.filter((r) => r.line === 'division');
  ok(divRows.map((r) => r.division_code).join(',') === 'DS,MMB,SRC,POOL,TK,3PL' && rows.some((r) => r.line === 'advertising') && rows.some((r) => r.line === 'company'), `admin: six divisions + Advertising + Company-wide (${rows.map((r) => r.division_code ?? r.line).join(', ')})`);
  const bad = divRows.filter((r) => Number(Object.values(r.revenue_by_currency).reduce((a, b) => a + Number(b), 0)) !== exp[r.division_code].rev || r.orders_count !== exp[r.division_code].orders || r.open_work !== exp[r.division_code].work);
  ok(bad.length === 0, `revenue, orders and open work per division match the ledger and the queues${bad.length ? ' — differ: ' + bad.map((r) => r.division_code).join(',') : ''} (${divRows.map((r) => `${r.division_code} rev ${Object.values(r.revenue_by_currency).join('+') || 0} · ${r.orders_count} orders · ${r.open_work} open`).join(' | ')})`);
  const advRow = rows.find((r) => r.line === 'advertising');
  ok(Number(advRow.revenue_by_currency.USD ?? 0) === adv && adv > 0, `advertising is its own line (${adv} cents, test ad click)`);
  const total = rows.reduce((a, r) => a + Number(r.revenue_converted_minor), 0);
  const ledgerTotal = Number((await one(`select coalesce(sum(convert_amount((le.credit_cents - le.debit_cents)::bigint, la.currency, current_platform_currency())), 0)::bigint n from ledger_entries le join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue'`)).n);
  ok(total === ledgerTotal, `company total = sum of the lines = all revenue in the ledger (${total})`);
  const noTest = await all(`select * from division_report(null, null, false)`);
  ok(noTest.every((r) => Number(r.revenue_converted_minor) <= Number(rows.find((x) => x.line === r.line && x.division_code === r.division_code).revenue_converted_minor)), 'without test data: never more than with test data');

  await as(ds);
  const dsRows = await all(`select line, division_code from division_report(null, null, true)`);
  ok(dsRows.length === 1 && dsRows[0].division_code === 'DS', `Dropshipping staff (dashboard permission): only the Dropshipping row (${dsRows.map((r) => r.division_code ?? r.line).join(',')})`);
  await as(cust);
  ok(/FORBIDDEN/.test((await tryq(`select * from division_report()`)).err ?? ''), 'customer: refused');
  await db.query('reset role');
  await db.query('rollback');

  await db.query('begin');
  const snap = async () => JSON.stringify((await db.query(`select p.oid::regprocedure::text f, md5(p.prosrc) s, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)).rows);
  const up = await snap();
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000199_division_report.down.sql', 'utf8'));
  ok(!(await snap()).includes('division_report'), 'down: removed');
  await db.query(fs.readFileSync('supabase/migrations/20261101000199_division_report.sql', 'utf8'));
  ok((await snap()) === up, 'up again: identical');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'rep-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\ndivision report: ${failed} check(s) failed` : '\ndivision report: all passed');
process.exitCode = failed ? 1 : 0;
