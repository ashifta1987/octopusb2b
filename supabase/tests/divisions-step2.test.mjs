// Divisions step 2 (19 Nov 2026): divisions, division_members, division_id columns + backfill + "new rows keep a
// division" + ledger/document rules + down migrations. STAGING ONLY; everything runs in transactions that are rolled back.
// Run: node supabase/tests/divisions-step2.test.mjs
import { config } from 'dotenv'; import pg from 'pg'; import fs from 'node:fs';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message }; } };
const TABLES = ['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments', 'documents', 'brand_projects',
  'pools', 'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products', 'dropship_rates', 'dropship_import_list',
  'company_services', 'wallet_holds', 'journals', 'ledger_entries', 'notifications', 'audit_log'];
const REQUIRED = ['service_requests', 'rfqs', 'quotes', 'orders', 'proforma_invoices', 'payments', 'shipments', 'brand_projects', 'pools',
  'pool_pledges', 'turnkey_projects', 'turnkey_leads', 'dropship_products', 'dropship_rates', 'dropship_import_list', 'company_services', 'wallet_holds'];
try {
  await db.query('begin');
  // ── divisions + members ──
  const divs = (await db.query(`select code, name, sort_order, logo_key, status from divisions order by sort_order`).catch(() => ({ rows: [] }))).rows;
  ok(divs.map((d) => d.code).join(',') === 'DS,MMB,SRC,POOL,TK,3PL', `six divisions in the owner's order (${divs.map((d) => d.code).join(',') || 'none'})`);
  if (!divs.length) throw new Error('divisions table missing (migration 189 not applied)');
  ok(divs.find((d) => d.code === 'DS').logo_key === 'octopus-dropship' && divs.filter((d) => d.logo_key === 'octopus-b2b').length === 5, 'Dropshipping uses the Octopus Dropship logo, the others Octopus B2B');
  ok(divs.every((d) => d.status === 'active'), 'all active');
  ok(!!(await one(`select to_regclass('division_members') t`)).t, 'division_members exists');
  const cp = await one(`select legal_name, registration_no, tax_id from company_profile where id = 1`);
  ok(cp.legal_name === 'Shenzhen Octopus Trading Co., Ltd.' && cp.registration_no === null && cp.tax_id === null, 'legal company: name set, registration no. + tax ID empty (not invented)');
  // ── columns, FKs, indexes, NOT NULL ──
  for (const t of TABLES) {
    const c = await one(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'division_id'`, [t]);
    const fk = await one(`select 1 x from pg_constraint where conrelid = $1::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%REFERENCES divisions(id)%'`, [t]);
    const ix = await one(`select 1 x from pg_indexes where tablename = $1 and indexdef like '%(division_id)%'`, [t]);
    const nulls = Number((await one(`select count(*) n from ${t} where division_id is null`)).n);
    const required = REQUIRED.includes(t);
    const notValid = await one(`select 1 x from pg_constraint where conrelid = $1::regclass and conname = $1 || '_division_required'`, [t]);
    ok(c && fk && ix && (!required || c.is_nullable === 'NO' || notValid), `${t}: division_id + FK + index${required ? (c?.is_nullable === 'NO' ? ' + NOT NULL' : ' + NOT VALID check (unplaced rows listed)') : ' (company-wide allowed)'} · empty: ${nulls}`);
  }
  // ── no child table got its own column ──
  const kids = (await db.query(`select table_name from information_schema.columns where column_name = 'division_id' and table_schema = 'public'
    and table_name in ('price_tiers','product_media','product_specs','order_events','pool_events','tracking_events','invoice_lines','request_messages','request_files','turnkey_packages','turnkey_project_sources','dropship_variants','products')`)).rows;
  ok(!kids.length, `child tables and the product catalogue have no own column (${kids.map((k) => k.table_name).join(',') || 'none'})`);

  // ── new rows keep a division (BEFORE INSERT), through the existing paths ──
  const org = (await one(`insert into organizations(name, country) values ('Div test', 'AE') returning id`)).id;
  const sr = await one(`insert into service_requests(org_id, service_code, details, fee_minor, currency, status) values ($1, '3pl', '{}', 0, 'USD', 'requested') returning division_id, (select code from divisions where id = division_id) code`, [org]);
  ok(sr.code === '3PL', 'new 3PL service request → 3PL');
  const rfq = await one(`insert into rfqs(org_id, title, quantity, unit, status) values ($1, 'div test', 10, 'pcs', 'submitted') returning id, (select code from divisions where id = division_id) code`, [org]);
  ok(rfq.code === 'SRC', 'new RFQ → SRC');
  const ord = await one(`insert into orders(org_id, rfq_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency) values ($1, $2, 'div test', 10, 100, 1000, 300, 'pi_issued', 'USD') returning id, (select code from divisions where id = division_id) code`, [org, rfq.id]);
  ok(ord?.code === 'SRC', 'new order from an RFQ → the RFQ\'s division (SRC)');
  const n1 = await one(`insert into notifications(org_id, title, link) values ($1, 'x', '/account/brand?project=MB-1') returning (select code from divisions where id = division_id) code`, [org]);
  ok(n1.code === 'MMB', 'new customer notification placed by its link (/account/brand → MMB)');
  const n2 = await one(`insert into notifications(org_id, title, link) values ($1, 'x', '/account/kyc') returning division_id`, [org]);
  ok(n2.division_id === null, 'KYC notification stays company-wide');
  const a1 = await one(`insert into audit_log(action, entity, entity_id) values ('pool.created', 'pool', 'x') returning (select code from divisions where id = division_id) code`);
  ok(a1.code === 'POOL', 'new audit row pool.* → POOL');
  const a2 = await one(`insert into audit_log(action, entity, entity_id) values ('auth.sign_in', 'auth', 'x') returning division_id`);
  ok(a2.division_id === null, 'sign-in audit row stays company-wide');

  // ── ledger rules: hold/payment lines must have a division; top-ups may be empty; lines copy the journal ──
  const topup = await tryq(`insert into journals(memo, stream, ref_type, ref_id) values ('t', 'topup', 'wallet_topup', gen_random_uuid()) returning id`);
  ok(!topup.err, 'top-up journal without a division: allowed');
  const acct = (await one(`select id from ledger_accounts limit 1`)).id;
  const holdJ = await tryq(`insert into journals(memo, stream, ref_type, ref_id) values ('h', 'hold', 'wallet_hold', gen_random_uuid()) returning id`);
  // the rule is checked at commit (deferred): force it now
  const holdCheck = await tryq(`set constraints all immediate`);
  ok(/DIVISION_REQUIRED/.test(holdCheck.err ?? ''), `hold journal that cannot be placed is refused (${(holdCheck.err ?? 'ALLOWED').slice(0, 60)})`);
  await db.query('set constraints all deferred');
  const h = await one(`insert into wallet_holds(org_id, amount_cents, currency, service, ref_type, ref_id) values ($1, 100, 'USD', 'dropship', 'test', gen_random_uuid()::text) returning id, (select code from divisions where id = division_id) code`, [org]);
  ok(h.code === 'DS', 'new dropship hold → DS');
  const hj = await one(`insert into journals(memo, stream, ref_type, ref_id) values ('h2', 'hold', 'wallet_hold', $1) returning id, (select code from divisions where id = division_id) code`, [h.id]);
  ok(hj.code === 'DS', 'hold journal → the hold\'s division');
  const le = await one(`insert into ledger_entries(journal_id, account_id, debit_cents, credit_cents, currency) values ($1, $2, 100, 0, (select currency from ledger_accounts where id = $2)) returning (select code from divisions where id = division_id) code`, [hj.id, acct]).catch((e) => ({ err: e.message }));
  ok(le.code === 'DS', `ledger line copies its journal's division (${le.code ?? le.err})`);
  const docBad = await tryq(`insert into documents(org_id, doc_type, number, amount_cents, currency, status, data) values ($1, 'commercial_invoice', 'TEST-DIV-1', 100, 'USD', 'issued', '{}') returning id`, [org]);
  const docCheck = await tryq(`set constraints all immediate`);
  ok(!docBad.err && /DIVISION_REQUIRED/.test(docCheck.err ?? ''), 'an invoice that cannot be placed is refused at commit');
  await db.query('set constraints all deferred');
  // ── audit log is still append-only (content), only an empty division may be filled ──
  const aid = (await one(`insert into audit_log(action, entity, entity_id) values ('auth.sign_in', 'auth', 'y') returning id`)).id;
  ok(/AUDIT_APPEND_ONLY/.test((await tryq(`update audit_log set action = 'x' where id = $1`, [aid])).err ?? ''), 'audit content still cannot be changed');
  ok(!(await tryq(`update audit_log set division_id = division_id_of('SRC') where id = $1`, [aid])).err, 'an empty division may be filled once');
  ok(/AUDIT_APPEND_ONLY/.test((await tryq(`update audit_log set division_id = division_id_of('TK') where id = $1`, [aid])).err ?? ''), 'a filled division cannot be changed');
  await db.query('rollback');

  // ── down migrations reverse it, and up again gives the same placement ──
  await db.query('begin');
  const counts = async () => { const o = {}; for (const t of TABLES) o[t] = Number((await one(`select count(*) n from ${t} where division_id is not null`)).n); return o; };
  const before = await counts();
  // rows given a division explicitly (test orders of divisions the order model has no link for yet: DS / MMB / TK)
  // cannot be re-derived from their own columns after a down + up — they are expected to come back empty
  const explicitOrders = Number((await one(`select count(*) n from orders o where division_of_order(o) is null`)).n);
  const explicitJournals = Number((await one(`select count(*) n from journals j where ref_type = 'order' and ref_id in (select id from orders o where division_of_order(o) is null)`)).n);
  // …and their shipments, which take the order's division (TEST-SHP-DS for the dropship label, 196)
  const explicitShipments = Number((await one(`select count(*) n from shipments where order_id in (select id from orders o where division_of_order(o) is null)`)).n);
  // …and the documents issued for those orders (step 5 test invoices: OCT-DS / OCT-MMB), which take the order's division
  const explicitDocs = Number((await one(`select count(*) n from documents where order_id in (select id from orders o where division_of_order(o) is null)`)).n);
  // audit rows whose division cannot be re-derived now: the explicitly placed test orders above, and rows about records
  // that were deleted later (e2e clean-up removes its orders/quotes/RFQs/invoices; the audit log is append-only, so their
  // rows stay). After down + up these come back empty, every other row gets the same division again.
  const explicitAudit = Number((await one(`select count(*) n from audit_log a where division_id is not null and (division_of_audit(a) is null
    or (entity = 'order' and entity_id in (select id::text from orders o where division_of_order(o) is null)))`)).n);
  const explicitLines = Number((await one(`select count(*) n from ledger_entries where journal_id in (select id from journals j where ref_type = 'order' and ref_id in (select id from orders o where division_of_order(o) is null))`)).n);
  // …and any notifications linking to those explicitly placed test orders
  const explicitNotifs = Number((await one(`select count(*) n from notifications n where division_id is not null and (division_of_notification(n) is null or exists (select 1 from orders o where division_of_order(o) is null and n.link like '%' || o.id::text || '%'))`)).n);
  // later migrations that build on the columns are taken down first (194 access fixes, 192 access rules, 191 advertising line)
  const has192 = !!(await one(`select to_regprocedure('in_division(uuid,text[])') f`)).f;
  const has191 = !!(await one(`select 1 x from information_schema.columns where table_name = 'journals' and column_name = 'report_line'`));
  const has194 = !!(await one(`select to_regprocedure('dropship_can_edit(uuid)') f`)).f;
  // …and migrations applied after 194 before those (195 views call in_division; 196 dropship seller profiles use division_id_of + the write guard)
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000194_division_access_fixes.sql');
  await unwind(db, later);
  if (has194) await db.query(fs.readFileSync('supabase/migrations/down/20261101000194_division_access_fixes.down.sql', 'utf8'));
  if (has192) await db.query(fs.readFileSync('supabase/migrations/down/20261101000192_division_access.down.sql', 'utf8'));
  if (has191) await db.query(fs.readFileSync('supabase/migrations/down/20261101000191_advertising_line.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000190_division_columns.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000189_divisions.down.sql', 'utf8'));
  const gone = await one(`select to_regclass('divisions') d, (select count(*) from information_schema.columns where column_name = 'division_id' and table_schema = 'public') c`);
  ok(!gone.d && Number(gone.c) === 0, 'down migrations remove divisions, members and every division_id column');
  await db.query(fs.readFileSync('supabase/migrations/20261101000189_divisions.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261101000190_division_columns.sql', 'utf8'));
  if (has191) await db.query(fs.readFileSync('supabase/migrations/20261101000191_advertising_line.sql', 'utf8'));
  if (has192) await db.query(fs.readFileSync('supabase/migrations/20261101000192_division_access.sql', 'utf8'));
  if (has194) await db.query(fs.readFileSync('supabase/migrations/20261101000194_division_access_fixes.sql', 'utf8'));
  await reapply(db, later);
  const after = await counts();
  // audit rows whose division only a LATER division_of_audit() can derive (e.g. 204's dropship entities): 190's backfill
  // runs with 190's function, and later migrations only redefine the function for new rows — so after down → up those
  // rows come back empty too (rolled-back test; nothing is ever really taken down)
  const laterOnlyAudit = Number((await one(`select count(*) n from audit_log a where division_id is null and division_of_audit(a) is not null`)).n);
  // Migration 204 drops and recreates dropship_products / dropship_import_list empty; if 204 was unwound and re-applied,
  // those test rows are empty after down → up until re-seeded
  const dropshipRebuilt = later.includes('20261101000204_dropship_catalogue_v2.sql');
  const expected = {
    ...before,
    orders: before.orders - explicitOrders,
    journals: before.journals - explicitJournals,
    ledger_entries: before.ledger_entries - explicitLines,
    shipments: before.shipments - explicitShipments,
    notifications: before.notifications - explicitNotifs,
    ...(before.documents != null ? { documents: before.documents - explicitDocs } : {}),
    ...(before.audit_log != null ? { audit_log: before.audit_log - explicitAudit - laterOnlyAudit } : {}),
    ...(dropshipRebuilt ? { dropship_products: 0, dropship_import_list: 0 } : {}),
  };
  if (JSON.stringify(expected) !== JSON.stringify(after)) console.log('  before', JSON.stringify(before), '\n  expected', JSON.stringify(expected), '\n  after ', JSON.stringify(after));
  ok(JSON.stringify(expected) === JSON.stringify(after), `up again: identical placement (${explicitOrders} explicitly placed test order(s) + their journals come back empty, as expected)`);
  await db.query('rollback');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
  await db.query('rollback').catch(() => {});
} finally {
  await db.end();
}
console.log(failed ? `\ndivisions step 2: ${failed} check(s) failed` : '\ndivisions step 2: all passed');
process.exitCode = failed ? 1 : 0;
