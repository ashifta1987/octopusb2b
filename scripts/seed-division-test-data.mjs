// STAGING ONLY — test data for every division (19 Nov 2026, owner's answer 3), so placement and access rules are
// checked on real rows: an RFQ + quote, orders of each kind (dropship, pool, RFQ, brand, turnkey), a payment, a
// shipment, a pool with pledges, a brand project, a turnkey lead, 3PL and dropship service requests + a 3PL hold, an
// ad-click charge, and ledger lines for each. Everything is clearly test data: one organisation named
// "TEST DATA · Divisions", titles/references starting with "TEST", is_seed = true where the table has it.
// Idempotent: does nothing if the test organisation already exists (use --reset to remove and recreate it).
// Prints the expected vs actual division of every row it created.
// Also (migration 196, every run): an approved dropship seller profile "TEST · Lumen Home" + a DS shipment for
// TEST-ORD-DS (tracking TESTDS0000000001) for the dropship label / packing slip.
// Run: node scripts/seed-division-test-data.mjs [--reset]
import pg from 'pg';
import { loadStagingEnvOrExit, assertStagingDatabase } from './lib-staging-guard.mjs';
loadStagingEnvOrExit();                                   // stops unless the Supabase URL + database are the staging project
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
const ORG = 'TEST DATA · Divisions';
const one = async (q, p) => (await db.query(q, p)).rows[0];

const existing = await one(`select id from organizations where name = $1`, [ORG]);
if (existing && !process.argv.includes('--reset')) { console.log('test data already present (run with --reset to recreate)'); }
else {
  await db.query('begin');
  try {
    if (existing) { await reset(existing.id); const o2 = await one(`select id from organizations where name = $1`, [ORG + ' (second buyer)']); if (o2) await reset(o2.id); }
    const org = (await one(`insert into organizations(name, country, city, is_seed) values ($1, 'AE', 'Dubai', true) returning id`, [ORG])).id;
    const sup = await one(`select id from suppliers where code = 'OCT-1132'`);
    // a LIVE product, so the test pool also opens on the storefront (/pool/POOL-9900001)
    const prod = await one(`select id, title from products where supplier_id = $1 and status = 'live' and archived_at is null order by created_at limit 1`, [sup.id]);
    const dsProd = await one(`select product_id id from dropship_products limit 1`);
    const tkProject = await one(`select project_id id from turnkey_projects order by sort_rank limit 1`);
    const W = `wallet_account('${org}', 'USD')`;
    const J = (memo, idem, stream, refType, refId, amount, revenueStream) => db.query(
      `select post_journal($1, jsonb_build_array(
         jsonb_build_object('account', ${W}, 'debit', $2::bigint, 'credit', 0, 'org', '${org}'::uuid),
         jsonb_build_object('account', revenue_account($3, 'USD'), 'debit', 0, 'credit', $2::bigint)), $4, $5, $6, $7::uuid) id`,
      [memo, amount, revenueStream ?? stream, idem, stream, refType, refId]).then((r) => r.rows[0].id);
    const T = {};
    // funding (company-wide top-up) so the wallet balances
    T.topup_journal = await db.query(`select post_journal('TEST top-up', jsonb_build_array(
        jsonb_build_object('account', cash_account('USD'), 'debit', 1000000, 'credit', 0),
        jsonb_build_object('account', ${W}, 'debit', 0, 'credit', 1000000, 'org', '${org}'::uuid)), 'test-div-topup', 'topup', 'wallet_topup', gen_random_uuid()) id`).then((r) => r.rows[0].id);
    // SRC: RFQ + quote + order + payment + shipment + RFQ fee
    T.rfq = (await one(`insert into rfqs(org_id, title, quantity, unit, status, is_seed) values ($1, 'TEST RFQ · divisions', 1000, 'pcs', 'quoted', true) returning id`, [org])).id;
    T.quote = (await one(`insert into quotes(code, rfq_id, supplier_id, unit_price_cents, quantity, status, is_seed) values ('TEST-Q-DIV-1', $1, $2, 120, 1000, 'approved', true) returning id`, [T.rfq, sup.id])).id;
    T.order_rfq = (await one(`insert into orders(code, org_id, rfq_id, quote_id, supplier_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, is_seed) values ('TEST-ORD-SRC', $1, $2, $3, $4, 'TEST order · from RFQ', 1000, 120, 120000, 36000, 'deposit_paid', 'USD', true) returning id`, [org, T.rfq, T.quote, sup.id])).id;
    T.payment = (await one(`insert into payments(org_id, order_id, purpose, method, amount_cents, currency, reference, status, is_seed) values ($1, $2, 'deposit', 'wallet', 36000, 'USD', 'TEST-PAY-1', 'confirmed', true) returning id`, [org, T.order_rfq])).id;
    T.shipment = (await one(`insert into shipments(code, order_id, org_id, carrier_code, service_code, status, weight_kg, parcels, rate_cents, currency, is_seed) values ('TEST-SHP-1', $1, $2, 'yunexpress', 'standard', 'created', 12.5, 2, 4800, 'USD', true) returning id`, [T.order_rfq, org])).id;
    T.j_rfq_fee = await J('TEST RFQ fee', 'test-div-rfqfee', 'rfq_fees', 'rfq', T.rfq, 500);
    T.j_order_payment = await J('TEST order deposit', 'test-div-orderpay', 'orders', 'payment', T.payment, 36000);
    // POOL: pool + 2 pledges + pool order + pledge journal
    T.pool = (await one(`insert into pools(code, product_id, supplier_id, starter_org_id, target_qty, min_pledge, deadline_at, status, pool_price_minor, currency, is_seed) values ('POOL-9900001', $1, $2, $3, 5000, 500, now() + interval '7 days', 'open', 150, 'USD', true) returning id`, [prod.id, sup.id, org])).id;
    T.pledge_a = (await one(`insert into pool_pledges(pool_id, org_id, qty, currency, status, deposit_minor, is_seed) values ($1, $2, 2000, 'USD', 'paid', 60000, true) returning id`, [T.pool, org])).id;
    const org2 = (await one(`insert into organizations(name, country, city, is_seed) values ($1, 'DE', 'Berlin', true) returning id`, [ORG + ' (second buyer)'])).id;   // one active pledge per company
    T.pledge_b = (await one(`insert into pool_pledges(pool_id, org_id, qty, currency, status, deposit_minor, is_seed) values ($1, $2, 1000, 'USD', 'pending', 30000, true) returning id`, [T.pool, org2])).id;
    T.order_pool = (await one(`insert into orders(code, org_id, pool_id, pool_pledge_id, supplier_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, is_seed) values ('TEST-ORD-POOL', $1, $2, $3, $4, 'TEST order · from pool', 2000, 150, 300000, 60000, 'pi_issued', 'USD', true) returning id`, [org, T.pool, T.pledge_a, sup.id])).id;
    T.j_pledge = await J('TEST pool deposit', 'test-div-pledge', 'pools', 'pool_pledge', T.pledge_a, 60000);
    // MMB: brand project + brand order + brand document journal
    T.brand_project = (await one(`insert into brand_projects(ref, org_id, product_id, quantity, method, packaging, stock_destination, status) values ('MB-TEST-01', $1, $2, 500, 'box', 'gift_box', 'warehouse', 'submitted') returning id`, [org, prod.id])).id;
    T.order_brand = (await one(`insert into orders(code, org_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, is_seed, division_id) values ('TEST-ORD-MMB', $1, 'TEST order · brand project MB-TEST-01', 500, 400, 200000, 60000, 'pi_issued', 'USD', true, division_id_of('MMB')) returning id`, [org])).id;
    T.brand_doc = (await one(`insert into documents(org_id, doc_type, number, amount_cents, currency, status, data, is_seed) values ($1, 'proforma_invoice', 'TEST-PI-MMB-1', 200000, 'USD', 'awaiting_payment', '{"service":"brand","ref":"MB-TEST-01"}', true) returning id`, [org])).id;
    T.j_brand = await J('TEST brand proforma', 'test-div-brand', 'brand', 'document', T.brand_doc, 200000);
    // DS: dropship service request + import list + dropship order + order journal
    T.sr_dropship = (await one(`insert into service_requests(org_id, service_code, details, fee_minor, currency, status, is_seed) values ($1, 'dropship', '{"test":true}', 0, 'USD', 'paid', true) returning id`, [org])).id;
    if (dsProd) await db.query(`insert into dropship_import_list(org_id, product_id) values ($1, $2) on conflict do nothing`, [org, dsProd.id]);
    T.order_dropship = (await one(`insert into orders(code, org_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, is_seed, division_id) values ('TEST-ORD-DS', $1, 'TEST order · dropship', 20, 900, 18000, 18000, 'confirmed', 'USD', true, division_id_of('DS')) returning id`, [org])).id;
    T.j_dropship_order = await J('TEST dropship order', 'test-div-dsorder', 'orders', 'order', T.order_dropship, 18000, 'dropship');
    // TK: turnkey lead + turnkey order + order journal
    T.tk_lead = (await one(`insert into turnkey_leads(reference, kind, project_id, org_id, company_name, contact_name, email, country, status, is_seed) values ('TEST-TK-1', 'quote', $1, $2, 'TEST DATA · Divisions', 'Test Contact', 'tk-test@example.invalid', 'AE', 'new', true) returning lead_id`, [tkProject.id, org])).lead_id;
    T.order_turnkey = (await one(`insert into orders(code, org_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, is_seed, division_id) values ('TEST-ORD-TK', $1, 'TEST order · turnkey project', 1, 2500000, 2500000, 750000, 'pi_issued', 'USD', true, division_id_of('TK')) returning id`, [org])).id;
    T.j_turnkey_order = await J('TEST turnkey deposit', 'test-div-tkorder', 'orders', 'order', T.order_turnkey, 750000, 'turnkey');
    // 3PL: 3PL service request + warehouse hold + hold journal + service fee
    T.sr_3pl = (await one(`insert into service_requests(org_id, service_code, details, fee_minor, currency, status, is_seed) values ($1, '3pl', '{"test":true,"asn":"TEST-ASN-1"}', 2500, 'USD', 'paid', true) returning id`, [org])).id;
    T.hold_3pl = (await one(`insert into wallet_holds(org_id, amount_cents, currency, service, ref_type, ref_id, status) values ($1, 12000, 'USD', 'warehouse', 'test_asn', 'TEST-ASN-1', 'open') returning id`, [org])).id;
    T.j_hold = await J('TEST 3PL hold capture', 'test-div-hold', 'hold', 'wallet_hold', T.hold_3pl, 12000, 'warehouse');
    T.j_service_fee = await J('TEST 3PL service fee', 'test-div-svcfee', 'service_fees', 'service_request', T.sr_3pl, 2500);
    // advertising (company-wide, report line "advertising")
    T.j_ads = await J('TEST ad click', 'test-div-ads', 'ads', 'ad_campaign', null, 50);
    // journals and ledger lines are test data too (a demo-data wipe removes them with the organisation)
    await db.query(`update journals set is_seed = true where idempotency_key like 'test-div-%'`);
    await db.query(`update ledger_entries set is_seed = true where journal_id in (select id from journals where idempotency_key like 'test-div-%')`);
    await db.query('commit');
    console.log('✔ test data created for organisation', ORG);
  } catch (e) { await db.query('rollback'); console.error('✘', e.message); process.exit(1); }
}
await ensureDropshipPrintData();
await ensureInvoiceSamples();
await report();
await db.end();

// Dropship label + packing slip test data (migration 196). Idempotent, runs every time (also when the organisation
// already exists): an APPROVED seller profile with an obviously fake brand + return address, and one DS shipment with a
// tracking number for TEST-ORD-DS. Print: /api/labels/TESTDS0000000001 and /api/packing-slips/TESTDS0000000001.
async function ensureDropshipPrintData() {
  const org = (await one(`select id from organizations where name = $1`, [ORG]))?.id;
  if (!org) return;
  if (!(await one(`select to_regclass('public.dropship_seller_profiles') t`)).t) { console.log('dropship_seller_profiles missing — apply migration 196 first'); return; }
  await db.query('begin');
  try {
    await db.query(`insert into dropship_seller_profiles(org_id, brand_name, return_name, return_line1, return_line2, return_city, return_region, return_postal_code, return_country)
      values ($1, 'TEST · Lumen Home', 'TEST DATA · Lumen Home Returns', 'TEST Unit 0, Example Returns Street', 'TEST DATA — not a real address', 'Dubai', 'Dubai', '00000', 'AE')
      on conflict (org_id) do update set brand_name = excluded.brand_name, return_name = excluded.return_name, return_line1 = excluded.return_line1,
        return_line2 = excluded.return_line2, return_city = excluded.return_city, return_region = excluded.return_region,
        return_postal_code = excluded.return_postal_code, return_country = excluded.return_country`, [org]);
    // approved separately (a change to the brand / address above puts it back to pending)
    await db.query(`update dropship_seller_profiles set status = 'approved', reviewed_at = coalesce(reviewed_at, now()), review_note = 'TEST DATA — approved by scripts/seed-division-test-data.mjs' where org_id = $1`, [org]);
    const order = await one(`select id from orders where code = 'TEST-ORD-DS' and org_id = $1`, [org]);
    if (order && !(await one(`select 1 x from shipments where order_id = $1`, [order.id])))
      await db.query(`insert into shipments(code, order_id, org_id, carrier_code, service_code, tracking_no, status, weight_kg, parcels, currency, is_seed)
        values ('TEST-SHP-DS', $1, $2, 'yunexpress', 'standard', 'TESTDS0000000001', 'created', 1.2, 1, 'USD', true)`, [order.id, org]);
    await db.query('commit');
    const p = await one(`select brand_name, status from dropship_seller_profiles where org_id = $1`, [org]);
    const sh = await one(`select s.tracking_no, d.code from shipments s join divisions d on d.id = s.division_id where s.code = 'TEST-SHP-DS'`);
    console.log(`✔ dropship print data: profile "${p.brand_name}" (${p.status}), shipment ${sh?.tracking_no} (${sh?.code})`);
  } catch (e) { await db.query('rollback'); console.error('✘ dropship print data:', e.message); process.exitCode = 1; }
}

// Invoice samples for step 5 (migration 198), idempotent: a tax invoice for the Dropshipping order (Dropship logo),
// one for the Make My Brand order (Octopus B2B logo) and a proforma — issued through the real functions, so they get
// real OCT- / PF- numbers from the staging counters. Test data (the test organisation, titles starting with TEST).
async function ensureInvoiceSamples() {
  const org = (await one(`select id from organizations where name = $1`, [ORG]))?.id;
  if (!org) return;
  if (!(await one(`select to_regprocedure('next_document_number(text,uuid,timestamptz)') f`)).f) { console.log('next_document_number missing — apply migration 198 first'); return; }
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    for (const code of ['TEST-ORD-DS', 'TEST-ORD-MMB']) {
      const o = await one(`select id from orders where code = $1 and org_id = $2`, [code, org]);
      if (!o || (await one(`select 1 x from documents where order_id = $1 and doc_type = 'commercial_invoice'`, [o.id]))) continue;
      await db.query(`update orders set status = 'qc' where id = $1`, [o.id]);
      await db.query(`select system_transition_order($1, 'balance_pending', 'TEST invoice sample (step 5)')`, [o.id]);
    }
    if (!(await one(`select 1 x from documents where org_id = $1 and doc_type = 'proforma_invoice' and number like 'PF-%'`, [org])))
      await db.query(`select issue_service_proforma($1, 'brand', 'brand_project', 'MB-TEST-01', 'TEST · Make My Brand sample run', $2::jsonb, 'USD')`,
        [org, JSON.stringify([{ description: 'TEST sample run · 50 units with logo', qty: 50, unit_cents: 500, amount_cents: 25000 }])]);
    // mark them (and the receivable journal of the proforma) as test data, so dashboards and the demo wipe treat them as such
    await db.query(`update documents set is_seed = true where org_id = $1 and number ~ '^(OCT|CN|PF)-' and not is_seed`, [org]);
    await db.query(`update journals set is_seed = true where ref_type = 'document' and ref_id in (select id from documents where org_id = $1) and not is_seed`, [org]);
    await db.query('commit');
    const docs = (await db.query(`select d.number, d.doc_type, v.code from documents d left join divisions v on v.id = d.division_id where d.org_id = $1 and d.number ~ '^(OCT|CN|PF)-' order by d.number`, [org])).rows;
    console.log(`✔ invoice samples: ${docs.map((d) => `${d.number} (${d.doc_type}, ${d.code ?? '—'})`).join(', ')}`);
  } catch (e) { await db.query('rollback'); console.error('✘ invoice samples:', e.message); process.exitCode = 1; }
}

async function reset(orgId) {
  // only the test organisation's rows (children first); journals/ledger lines found by their test idempotency keys
  const js = (await db.query(`select id from journals where idempotency_key like 'test-div-%'`)).rows.map((r) => r.id);
  await db.query(`delete from ledger_entries where journal_id = any($1)`, [js]);
  await db.query(`delete from journals where id = any($1)`, [js]);
  for (const [t, c] of [['wallet_holds', 'org_id'], ['dropship_import_list', 'org_id'], ['documents', 'org_id'], ['shipments', 'org_id'], ['payments', 'org_id'], ['orders', 'org_id'], ['pool_pledges', 'org_id'], ['brand_projects', 'org_id'], ['service_requests', 'org_id'], ['turnkey_leads', 'org_id']])
    await db.query(`delete from ${t} where ${c} = $1`, [orgId]);
  await db.query(`delete from pools where code in ('POOL-9900001', 'TEST-POOL-1')`);
  await db.query(`delete from quotes where code = 'TEST-Q-DIV-1'`);
  await db.query(`delete from rfqs where org_id = $1`, [orgId]);
  await db.query(`delete from ledger_accounts where org_id = $1`, [orgId]);
  await db.query(`delete from organizations where id = $1`, [orgId]);
}

async function report() {
  const org = (await one(`select id from organizations where name = $1`, [ORG])).id;
  const code = `(select code from divisions d where d.id = x.division_id)`;
  const rows = (await db.query(`
    select 'rfqs' t, title what, 'SRC' expected, ${code} actual from rfqs x where org_id = $1
    union all select 'quotes', code, 'SRC', ${code} from quotes x where code = 'TEST-Q-DIV-1'
    union all select 'orders', code, case code when 'TEST-ORD-SRC' then 'SRC' when 'TEST-ORD-POOL' then 'POOL' when 'TEST-ORD-MMB' then 'MMB' when 'TEST-ORD-DS' then 'DS' when 'TEST-ORD-TK' then 'TK' end, ${code} from orders x where org_id = $1
    union all select 'payments', reference, 'SRC', ${code} from payments x where org_id = $1
    union all select 'shipments', code, case code when 'TEST-SHP-DS' then 'DS' else 'SRC (its order)' end, ${code} from shipments x where org_id = $1
    union all select 'dropship_seller_profiles', brand_name || ' (' || status || ')', 'DS', ${code} from dropship_seller_profiles x where org_id = $1
    union all select 'pools', code, 'POOL', ${code} from pools x where code in ('POOL-9900001', 'TEST-POOL-1')
    union all select 'pool_pledges', qty || ' units', 'POOL', ${code} from pool_pledges x where pool_id = (select id from pools where code in ('POOL-9900001', 'TEST-POOL-1'))
    union all select 'brand_projects', ref, 'MMB', ${code} from brand_projects x where org_id = $1
    union all select 'documents', number, coalesce((select v.code from orders o join divisions v on v.id = o.division_id where o.id = x.order_id), 'MMB'), ${code} from documents x where org_id = $1
    union all select 'service_requests', service_code, case service_code when '3pl' then '3PL' else 'DS' end, ${code} from service_requests x where org_id = $1
    union all select 'dropship_import_list', 'import list row', 'DS', ${code} from dropship_import_list x where org_id = $1
    union all select 'turnkey_leads', reference, 'TK', ${code} from turnkey_leads x where org_id = $1
    union all select 'wallet_holds', ref_id, '3PL', ${code} from wallet_holds x where org_id = $1
    union all select 'journals', memo || ' [' || coalesce(stream, '') || ']', case idempotency_key
        when 'test-div-topup' then 'company-wide' when 'test-div-rfqfee' then 'SRC' when 'test-div-orderpay' then 'SRC' when 'test-div-pledge' then 'POOL'
        when 'test-div-brand' then 'MMB' when 'test-div-dsorder' then 'DS' when 'test-div-tkorder' then 'TK' when 'test-div-hold' then '3PL'
        when 'test-div-svcfee' then '3PL' when 'test-div-ads' then 'company-wide · advertising' end,
        coalesce(${code}, 'company-wide') || coalesce(' · ' || report_line, '') from journals x where idempotency_key like 'test-div-%'
    union all select 'ledger_entries', j.memo || ' (' || count(*) || ' lines)', coalesce((select code from divisions where id = j.division_id), 'company-wide'),
        coalesce(string_agg(distinct (select code from divisions where id = le.division_id), ','), 'company-wide')
      from ledger_entries le join journals j on j.id = le.journal_id where j.idempotency_key like 'test-div-%' group by j.memo, j.division_id
    order by 1, 2`, [org])).rows;
  let bad = 0;
  for (const r of rows) { const okRow = r.actual === r.expected || (r.expected === 'SRC (its order)' && r.actual === 'SRC'); if (!okRow) bad++; r.ok = okRow ? '✔' : '✘'; }
  console.table(rows);
  console.log(bad ? `✘ ${bad} row(s) in the wrong division` : `✔ all ${rows.length} test rows are in the right division`);
}
