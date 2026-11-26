// Divisions step 5b/5c (migrations 199 + 200): division_report().
// Revenue counts from the TAX INVOICE (invoices − credit notes + non-proforma ledger revenue); proformas are "Pipeline". STAGING ONLY, rolled back, acting as each user via JWT claims.
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
  const NOT_PF = `coalesce(j.idempotency_key, '') !~ '^(pi|poolpi|doc-ar):' and not (j.ref_type = 'document' and exists (select 1 from documents x where x.id = j.ref_id and x.doc_type = 'proforma_invoice'))`;
  for (const r of await all(`select d.code,
      coalesce((select sum(le.credit_cents - le.debit_cents) from journals j join ledger_entries le on le.journal_id = j.id
        join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' where j.division_id = d.id and ${NOT_PF}), 0)
      + coalesce((select sum(case doc_type when 'credit_note' then -amount_cents else amount_cents end) from documents
        where division_id = d.id and doc_type in ('commercial_invoice', 'credit_note') and coalesce(status, '') not in ('void', 'cancelled')), 0) net,
      coalesce((select sum(amount_cents - coalesce(paid_cents, 0)) from documents p where p.division_id = d.id and p.doc_type = 'proforma_invoice' and coalesce(p.status, '') not in ('void', 'cancelled', 'invoiced')
        and not (p.order_id is not null and exists (select 1 from documents i where i.order_id = p.order_id and i.doc_type = 'commercial_invoice'))), 0) pipe,
      coalesce((select sum(le.credit_cents - le.debit_cents) from journals j join ledger_entries le on le.journal_id = j.id
        join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' where j.division_id = d.id and not (${NOT_PF})), 0) pf_ledger
      from divisions d`)) exp[r.code] = { rev: Number(r.net), pipe: Number(r.pipe), pfLedger: Number(r.pf_ledger) };
  const adv = Number((await one(`select coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint n from ledger_entries le join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' join journals j on j.id = le.journal_id where j.division_id is null and j.report_line = 'advertising'`)).n);
  for (const r of await all(`select d.code, count(o.id)::int n from divisions d left join orders o on o.division_id = d.id and o.status <> 'cancelled' group by 1`)) exp[r.code].orders = r.n;
  for (const r of await all(`select d.code, (select count(*) from rfqs where division_id = d.id and status in ('submitted','assigned','quoting'))
      + (select count(*) from service_requests where division_id = d.id and status in ('requested','paid','accepted','in_progress','report_ready'))
      + (select count(*) from orders where division_id = d.id and status not in ('delivered','closed','cancelled'))
      + (select count(*) from brand_projects where division_id = d.id and status <> 'closed')
      + (select count(*) from pools where division_id = d.id and status in ('open','locked','confirmed','shipped'))
      + (select count(*) from tk_client_projects where division_id = d.id and status in ('open','on_hold'))   -- Turnkey T7: client projects, not the frozen leads
      + (select count(*) from shipments where division_id = d.id and status not in ('delivered','returned')) n from divisions d`)) exp[r.code].work = Number(r.n);

  await as(adm);
  const rows = await all(`select * from division_report(null, null, true)`);
  const divRows = rows.filter((r) => r.line === 'division');
  ok(divRows.map((r) => r.division_code).join(',') === 'DS,MMB,SRC,POOL,TK,3PL' && rows.some((r) => r.line === 'advertising') && rows.some((r) => r.line === 'company'), `admin: six divisions + Advertising + Company-wide (${rows.map((r) => r.division_code ?? r.line).join(', ')})`);
  const sumMap = (m) => Object.values(m ?? {}).reduce((a, b) => a + Number(b), 0);
  const bad = divRows.filter((r) => sumMap(r.revenue_by_currency) !== exp[r.division_code].rev || sumMap(r.pipeline_by_currency) !== exp[r.division_code].pipe || r.orders_count !== exp[r.division_code].orders || r.open_work !== exp[r.division_code].work);
  ok(bad.length === 0, `revenue (tax invoices − credit notes + other ledger revenue), pipeline, orders and open work per division match${bad.length ? ' — differ: ' + bad.map((r) => r.division_code).join(',') : ''} (${divRows.map((r) => `${r.division_code} rev ${sumMap(r.revenue_by_currency)} · pipeline ${sumMap(r.pipeline_by_currency)} · ${r.orders_count} orders · ${r.open_work} open`).join(' | ')})`);
  const mmb = divRows.find((r) => r.division_code === 'MMB');
  ok(exp.MMB.pfLedger > 0 && sumMap(mmb.pipeline_by_currency) > 0 && mmb.pipeline_count > 0, `proformas are pipeline, not revenue (Make My Brand: ${exp.MMB.pfLedger} cents of proforma postings left out of revenue; pipeline ${sumMap(mmb.pipeline_by_currency)} in ${mmb.pipeline_count} proforma(s))`);
  const advRow = rows.find((r) => r.line === 'advertising');
  ok(Number(advRow.revenue_by_currency.USD ?? 0) === adv && adv > 0, `advertising is its own line (${adv} cents, test ad click)`);
  const total = rows.reduce((a, r) => a + Number(r.revenue_converted_minor), 0);
  const expTotal = Number((await one(`select coalesce((select sum(convert_amount((le.credit_cents - le.debit_cents)::bigint, la.currency, current_platform_currency())) from ledger_entries le
      join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue' join journals j on j.id = le.journal_id where ${NOT_PF}), 0)
    + coalesce((select sum(convert_amount(case doc_type when 'credit_note' then -amount_cents else amount_cents end, coalesce(currency, 'USD'), current_platform_currency()))
      from documents where doc_type in ('commercial_invoice', 'credit_note') and coalesce(status, '') not in ('void', 'cancelled')), 0) n`)).n);
  ok(total === expTotal, `company total = sum of the lines = tax invoices − credit notes + other ledger revenue (${total}); pipeline not included`);
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
  const { appliedAfter, unwind, reapply, MAX_UNWIND } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000200_report_revenue_from_invoices.sql');
  await unwind(db, later, MAX_UNWIND);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000200_report_revenue_from_invoices.down.sql', 'utf8'));
  const has199 = (await snap()).includes('division_report');
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000199_division_report.down.sql', 'utf8'));
  ok(has199 && !(await snap()).includes('division_report'), 'down 200 → the 199 report is back; down 199 → removed');
  await db.query(fs.readFileSync('supabase/migrations/20261101000199_division_report.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261101000200_report_revenue_from_invoices.sql', 'utf8'));
  await reapply(db, later);
  ok((await snap()) === up, 'up again: identical');
} catch (e) {
  if (!e.skipRoundTrip) ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'rep-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\ndivision report: ${failed} check(s) failed` : '\ndivision report: all passed');
process.exitCode = failed ? 1 : 0;
