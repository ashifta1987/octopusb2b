// Phase 2 · Batch 3 DB checks (migration 220). STAGING ONLY — one rolled-back transaction.
//  B3-2 get_status_labels(): customer-safe labels only (no staff stages), only the two customer domains.
//  B3-3 reject_quote(): customer declines own sent quote; idempotent; other org FORBIDDEN; closed quote QUOTE_NOT_OPEN.
//  B3-5 set_dropship_request_landed_quote(): Dropship-only staff can quote (no FORBIDDEN_DIVISION); plain RFQ refused;
//       closed request refused; support FORBIDDEN. list_dropship_product_requests(): DS staff yes, customer no.
//  B3-6 division_of_notification(): /account/sourcing/SRV-… links get the service request's division.
//  B3-7 factory_audit: service + price exist; request_service('factory_audit') creates an SRV- request in SRC.
// Run: node --env-file=.env.staging supabase/tests/batch3.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
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
const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const asAnon = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
  await db.query('set local role anon');
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};

try {
  await db.query('begin');
  const ledgerBefore = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);

  const mkUser = async (tag, role = null, divs = []) => {
    const email = `b3-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `B3 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    for (const [code, r] of divs) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
    return id;
  };
  const merch = await mkUser('merch');
  const custB = await mkUser('custb');
  const dsStaff = await mkUser('ds', 'operations', [['DS', 'staff']]);
  const support = await mkUser('support', 'support');
  const orgA = (await one(`insert into organizations(name, country, kyc_status, is_seed) values ('TEST B3 Merchant', 'AE', 'verified', true) returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country, kyc_status, is_seed) values ('TEST B3 Other', 'AE', 'verified', true) returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, merch, orgB, custB]);
  await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on') on conflict (org_id, service) do update set status = 'on'`, [orgA]);
  await db.query(`insert into dropship_markets(org_id, country) values ($1, 'AE') on conflict do nothing`, [orgA]);

  // ── B3-2 status labels ──
  await as(merch, 'aal1');
  const soLabels = await all(`select * from get_status_labels('store_order_stage')`);
  const rfqLabels = await all(`select * from get_status_labels('sourcing_rfq')`);
  const otherLabels = await all(`select * from get_status_labels('division_handoff')`);
  const direct = await tryq(`select count(*)::int n from status_mappings`);
  await owner();
  ok(
    soLabels.length >= 10 && rfqLabels.length >= 8 && otherLabels.length === 0 &&
      Object.keys(soLabels[0]).sort().join(',') === 'merchant_label,merchant_status,source_status' &&
      soLabels.find((r) => r.source_status === 'on_hold')?.merchant_label === 'On hold' &&
      rfqLabels.find((r) => r.source_status === 'quoted')?.merchant_label === 'Quote ready' &&
      (direct.err !== null || direct.rows[0].n === 0),
    `B3-2 get_status_labels: ${soLabels.length} store-order + ${rfqLabels.length} sourcing labels, no staff_stage column, other domains empty, direct table read still staff-only`,
  );
  await asAnon();
  const anonLabels = await tryq(`select * from get_status_labels('sourcing_rfq')`);
  await owner();
  ok(/permission denied/i.test(anonLabels.err ?? ''), 'B3-2 anon cannot call get_status_labels');

  // ── B3-3 reject_quote ──
  const supId = (await one(`select id from suppliers where archived_at is null limit 1`)).id;
  const rfq = (await one(`insert into rfqs(org_id, title, quantity, unit, status, is_seed, created_by, division_id) values ($1, 'B3 quote test', 100, 'pcs', 'quoted', true, $2, division_id_of('SRC')) returning id, code`, [orgA, merch]));
  const mkQuote = async (n, status) => (await one(
    `insert into quotes(code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, status, valid_until, currency)
     values ($1, $2, $3, 500, 100, 'FOB', 20, 0, $4, now() + interval '10 days', 'USD') returning id`,
    [`QT-B3-${Date.now()}-${n}`, rfq.id, supId, status])).id;
  const q1 = await mkQuote(1, 'sent');
  const q2 = await mkQuote(2, 'approved');
  await as(merch, 'aal1');
  const rej = (await one(`select reject_quote($1, 'Price too high') r`, [q1])).r;
  const rejAgain = (await one(`select reject_quote($1, null) r`, [q1])).r;
  const rejClosed = await tryq(`select reject_quote($1, null)`, [q2]);
  await as(custB, 'aal1');
  const rejOther = await tryq(`select reject_quote($1, null)`, [q1]);
  await owner();
  const q1Row = await one(`select status from quotes where id = $1`, [q1]);
  const hist = await one(`select count(*)::int n from audit_log where action = 'quote.rejected' and entity_id = $1`, [q1]);
  ok(
    rej.ok === true && rej.repeated === false && rejAgain.repeated === true && q1Row.status === 'rejected' && hist.n === 1 &&
      /QUOTE_NOT_OPEN/.test(rejClosed.err ?? '') && /FORBIDDEN/.test(rejOther.err ?? ''),
    'B3-3 reject_quote: own sent quote → rejected (audit logged once), repeat is idempotent, approved quote refused (QUOTE_NOT_OPEN), other company FORBIDDEN',
  );

  // ── B3-5 Dropship request quoting ──
  await as(merch, 'aal1');
  const req = (await one(`select public.create_dropship_product_request('TEST B3 Bamboo board', 'https://example.com/board', 'Kitchen', null, '50 to 200', array['AE'], false, null, '{}'::text[], $1) r`, [`b3_req_${Date.now()}`])).r;
  await as(dsStaff);
  const quoteRes = await tryq(`select set_dropship_request_landed_quote($1, 1850, 'AE') r`, [req.rfq_id]);
  const plain = await tryq(`select set_dropship_request_landed_quote($1, 1850, 'AE')`, [rfq.id]);
  const listDs = await tryq(`select * from list_dropship_product_requests(null)`);
  await as(support);
  const supQuote = await tryq(`select set_dropship_request_landed_quote($1, 1900, 'AE')`, [req.rfq_id]);
  await as(merch, 'aal1');
  const listCust = await tryq(`select * from list_dropship_product_requests(null)`);
  await owner();
  const rfqAfter = await one(`select status::text s from rfqs where id = $1`, [req.rfq_id]);
  const dpr = await one(`select quoted_landed_cents, quoted_country from dropship_product_requests where rfq_id = $1`, [req.rfq_id]);
  ok(
    !quoteRes.err && quoteRes.rows[0].r.status === 'quoted' && rfqAfter.s === 'quoted' && Number(dpr.quoted_landed_cents) === 1850 && dpr.quoted_country.trim() === 'AE',
    `B3-5 Dropship-only staff quote a merchant request (${req.rfq_code} → quoted, US$ 18.50 to AE) without FORBIDDEN_DIVISION${quoteRes.err ? ` — got ${quoteRes.err}` : ''}`,
  );
  if (process.env.B3_DEBUG) console.log({ quoteRes, plain: plain.err, sup: supQuote.err, dpr, rfqAfter });
  ok(/NOT_A_DROPSHIP_REQUEST/.test(plain.err ?? '') && /FORBIDDEN/.test(supQuote.err ?? ''),
    'B3-5 a plain Sourcing RFQ is refused (NOT_A_DROPSHIP_REQUEST) and support cannot quote (FORBIDDEN)');
  ok(!listDs.err && listDs.rows.some((r) => r.rfq_id === req.rfq_id && r.merchant_label === 'Quote ready') && /FORBIDDEN/.test(listCust.err ?? ''),
    'B3-5 list_dropship_product_requests: DS staff see the request with its status_mappings label; customers FORBIDDEN');
  await db.query(`update rfqs set status = 'accepted' where id = $1`, [req.rfq_id]);
  await as(dsStaff);
  const closedQuote = await tryq(`select set_dropship_request_landed_quote($1, 1850, 'AE')`, [req.rfq_id]);
  await owner();
  ok(/REQUEST_NOT_OPEN/.test(closedQuote.err ?? ''), 'B3-5 an accepted request can no longer be re-quoted (REQUEST_NOT_OPEN)');

  // ── B3-7 factory audit request type ──
  const svc = await one(`select s.code, s.active, (select amount_minor from service_prices p where p.service_code = s.code order by effective_from desc limit 1) price from services s where code = 'factory_audit'`);
  ok(svc?.active === true && Number(svc.price) > 0 && (await one(`select division_code_for_service('factory_audit') c`)).c === 'SRC',
    `B3-7 factory_audit service is active with a price (${svc?.price}c) and maps to the Sourcing division`);
  await db.query(
    `select post_journal('B3 wallet funding', jsonb_build_array(
       jsonb_build_object('account', cash_account('USD'), 'debit', 100000, 'credit', 0),
       jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 100000, 'org', $1::text)
     ), 'b3-fund-' || $1::text, 'topup', 'wallet_topup', $1)`, [orgA]);
  await as(merch, 'aal1');
  const fa = await tryq(`select request_service('factory_audit', '{"product":"Silicone tools","audit_type":"Factory capability audit","factory_location":"Dongguan, CN"}'::jsonb) v`);
  await owner();
  const faRow = fa.err ? null : await one(`select code, service_code, division_id = division_id_of('SRC') src, status::text s from service_requests where id = $1`, [fa.rows[0].v]);
  ok(!fa.err && faRow?.service_code === 'factory_audit' && /^SRV-\d+$/.test(faRow.code) && faRow.src === true,
    `B3-7 request_service('factory_audit') creates ${faRow?.code ?? fa.err} in the Sourcing division (status ${faRow?.s})`);

  // ── B3-6 notification division from SRV- link ──
  const notif = faRow ? await one(`insert into notifications(org_id, title, link) values ($1, 'Factory audit paid', '/account/sourcing/' || $2) returning division_id = division_id_of('SRC') src`, [orgA, faRow.code]) : null;
  ok(notif?.src === true, `B3-6 a notification linking to /account/sourcing/${faRow?.code} gets the Sourcing division`);

  await owner();
  const ledgerAfter = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(ledgerAfter.d === ledgerAfter.c && ledgerBefore.d === ledgerBefore.c, `ledger balanced (${ledgerAfter.d} = ${ledgerAfter.c}, diff=0)`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nbatch3: ${failed} check(s) failed` : '\nbatch3: all passed');
process.exitCode = failed ? 1 : 0;
