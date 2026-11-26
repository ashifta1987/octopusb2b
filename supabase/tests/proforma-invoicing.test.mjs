// Divisions step 5d (migration 201): a FULLY paid service proforma gets its OCT- tax invoice automatically. STAGING ONLY.
//  · part payment → no tax invoice, shown as Customer deposits; full payment → one tax invoice with the same lines,
//    amounts and currency, linked to the proforma, proforma "invoiced", revenue counts, the proforma leaves Pipeline
//  · wallet payments (customer) and confirmed bank transfers (finance, fresh 2FA)
//  · idempotent: double click / repeated request / repeated webhook (same key) → the first result, never a second
//    payment or invoice; paying an already paid proforma again is refused; two SIMULTANEOUS identical requests → one
//  · the rule is one setting: "per_payment" issues a tax invoice for every payment
//  · 201 down → up identical
// Everything runs in rolled-back transactions, except the simultaneous-requests check, which needs committed data
// and removes its rows afterwards (and gives the invoice number back to the counter so the sequence stays gap-free).
// Run: node supabase/tests/proforma-invoicing.test.mjs
import pg from 'pg'; import fs from 'node:fs';
import { loadStagingEnvOrExit, assertStagingDatabase, assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';
loadStagingEnvOrExit();
const connect = async () => { const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); return c; };
const db = await connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p, c = db) => (await c.query(q, p)).rows[0];
const all = async (q, p, c = db) => (await c.query(q, p)).rows;
const claims = (c, o) => c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(o)]);
const as = async (uid, extra = {}, c = db) => { await c.query('reset role'); await claims(c, { sub: uid, role: 'authenticated', aal: 'aal1', ...extra }); await c.query('set local role authenticated'); };
const sys = async (c = db) => { await c.query('reset role'); await claims(c, { role: 'service_role' }); };
const tryq = async (q, p, c = db) => { await c.query('savepoint s'); try { const r = await c.query(q, p); await c.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await c.query('rollback to savepoint s'); return { err: e.message, rows: [] }; } };

// a test company with a funded wallet, a customer and a Make My Brand service proforma (2 lines, 250.00 USD)
async function fixture(c, tag) {
  await sys(c);
  const user = async (email, role) => {
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email], c)).id;
    await c.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, email, email]);
    if (role) await c.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const org = (await one(`insert into organizations(name, country, is_seed) values ($1, 'AE', true) returning id`, [`TEST · proforma invoicing ${tag}`], c)).id;
  const cust = await user(`pfi-${tag}-cust@example.com`);
  await c.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  await c.query(`select post_journal('TEST wallet funding', jsonb_build_array(
      jsonb_build_object('account', cash_account('USD'), 'debit', 100000, 'credit', 0),
      jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 100000, 'org', $1::text)), 'test-pfi-fund-' || $1::text, 'topup', 'adjustment', null)`, [org]);
  const pf = (await one(`select issue_service_proforma($1, 'brand', 'brand_project', 'MB-TEST-PFI', 'TEST · logo run', $2::jsonb, 'USD') id`,
    [org, JSON.stringify([{ description: 'TEST sample run', qty: 50, unit_cents: 300, amount_cents: 15000 }, { description: 'TEST artwork', qty: 1, unit_cents: 10000, amount_cents: 10000 }])], c)).id;
  return { org, cust, pf, user };
}
const report = async (admin, c = db) => {
  await as(admin, { aal: 'aal2' }, c);
  const r = (await all(`select * from division_report(null, null, true) where division_code = 'MMB'`, [], c))[0];
  await sys(c);
  const sum = (m) => Object.values(m ?? {}).reduce((a, b) => a + Number(b), 0);
  return { rev: sum(r.revenue_by_currency), pipe: sum(r.pipeline_by_currency), dep: sum(r.deposits_by_currency) };
};

try {
  // ───────── on_full_payment (default) ─────────
  await db.query('begin');
  const f = await fixture(db, 'a');
  const admin = await f.user('pfi-admin@example.com', 'admin');
  const r0 = await report(admin);
  await as(f.cust);
  const p1 = (await one(`select pay_service_proforma($1, 10000, 'wallet', null, 'click-1') r`, [f.pf])).r;
  await sys();
  let doc = await one(`select status, paid_cents from documents where id = $1`, [f.pf]);
  ok(doc.status === 'part_paid' && Number(doc.paid_cents) === 10000 && !p1.invoice_id && !p1.fully_paid, 'part payment (100.00 of 250.00): no tax invoice yet, proforma "part paid"');
  const r1 = await report(admin);
  ok(r1.dep - r0.dep === 10000 && r0.pipe - r1.pipe === 10000 && r1.rev === r0.rev, `report: 100.00 moved from Pipeline to Customer deposits (150.00 still in Pipeline), revenue unchanged (deposits +${r1.dep - r0.dep}, pipeline ${r1.pipe - r0.pipe})`);
  await as(f.cust);
  const again = (await one(`select pay_service_proforma($1, 10000, 'wallet', null, 'click-1') r`, [f.pf])).r;
  await sys();
  ok(again.repeated === true && again.payment_id === p1.payment_id && Number((await one(`select paid_cents from documents where id = $1`, [f.pf])).paid_cents) === 10000, 'double click (same key): the first payment is returned, nothing charged twice');
  ok(/INVALID_AMOUNT/.test((await (async () => { await as(f.cust); const x = await tryq(`select pay_service_proforma($1, 20000, 'wallet', null, 'too-much')`, [f.pf]); await sys(); return x; })()).err ?? ''), 'paying more than what is left is refused');
  const other = await f.user('pfi-other@example.com');
  const org2 = (await one(`insert into organizations(name, country, is_seed) values ('TEST · other buyer', 'DE', true) returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org2, other]);
  await as(other);
  ok(/FORBIDDEN/.test((await tryq(`select pay_service_proforma($1, 100, 'wallet', null, 'x')`, [f.pf])).err ?? ''), 'another customer cannot pay it');
  ok(/FORBIDDEN/.test((await tryq(`select pay_service_proforma($1, 100, 'bank_transfer', 'BANK-X')`, [f.pf])).err ?? ''), 'a customer cannot record a bank transfer');
  // the rest by confirmed bank transfer (finance, fresh 2FA)
  await sys();
  const fin = await f.user('pfi-finance@example.com', 'finance');
  await as(fin, { aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] });
  const p2 = (await one(`select pay_service_proforma($1, 15000, 'bank_transfer', 'BANK-REF-77') r`, [f.pf])).r;
  const webhook = (await one(`select pay_service_proforma($1, 15000, 'bank_transfer', 'bank-ref-77') r`, [f.pf])).r;
  await sys();
  ok(p2.fully_paid && !!p2.invoice_id, 'bank transfer completes the payment → tax invoice issued');
  ok(webhook.repeated === true && webhook.invoice_id === p2.invoice_id, 'the same bank transfer again (repeated webhook / reference) → the first result, no second invoice');
  const inv = await one(`select number, amount_cents, currency, status, from_proforma_id, division_id = (select division_id from documents where id = $1) same_div from documents where id = $2`, [f.pf, p2.invoice_id]);
  const year = (await one(`select extract(year from now() at time zone 'Asia/Shanghai')::int y`)).y;
  ok(new RegExp(`^OCT-MMB-${year}-\\d{6}$`).test(inv.number) && Number(inv.amount_cents) === 25000 && inv.currency.trim() === 'USD' && inv.from_proforma_id === f.pf && inv.same_div && inv.status === 'paid', `tax invoice ${inv.number}: 250.00 USD, same division, linked to the proforma`);
  const linesPf = await all(`select description, qty::text, unit_cents, amount_cents from invoice_lines where document_id = $1 order by created_at, description`, [f.pf]);
  const linesInv = await all(`select description, qty::text, unit_cents, amount_cents from invoice_lines where document_id = $1 order by created_at, description`, [p2.invoice_id]);
  ok(JSON.stringify(linesPf) === JSON.stringify(linesInv) && linesInv.length === 2, `same lines and amounts as the proforma (${linesInv.length} lines)`);
  doc = await one(`select status, paid_cents from documents where id = $1`, [f.pf]);
  ok(doc.status === 'invoiced' && Number(doc.paid_cents) === 25000, 'proforma marked "invoiced"');
  ok(Number((await one(`select count(*) n from document_payments where document_id = $1 and invoice_id = $2`, [f.pf, p2.invoice_id])).n) === 2, 'both payments are covered by the tax invoice (no deposits left)');
  const r2 = await report(admin);
  ok(r2.rev - r0.rev === 25000 && r0.pipe - r2.pipe === 25000 && r2.dep === r0.dep, `report: revenue +250.00 from the tax invoice, the proforma left Pipeline, no deposits (revenue +${r2.rev - r0.rev})`);
  await as(f.cust);
  const twice = await tryq(`select pay_service_proforma($1, 100, 'wallet', null, 'click-2')`, [f.pf]);
  await sys();
  ok(/PROFORMA_ALREADY_PAID/.test(twice.err ?? ''), 'paying an already paid proforma again is refused');
  ok(Number((await one(`select count(*) n from documents where from_proforma_id = $1`, [f.pf])).n) === 1, 'exactly one tax invoice for the proforma');
  const led = await one(`select coalesce(sum(le.debit_cents - le.credit_cents), 0)::bigint ar from ledger_entries le where le.account_id = receivable_account($1, 'USD')`, [f.org]);
  ok(Number(led.ar) === 0, 'ledger: the customer receivable is settled (proforma 250.00 − payments 250.00 = 0)');
  await db.query('rollback');

  // ───────── per_payment rule (one setting) ─────────
  await db.query('begin');
  const g = await fixture(db, 'b');
  await db.query(`update site_settings set value = '"per_payment"' where key = 'invoicing.service_proforma_rule'`);
  await as(g.cust);
  const q1 = (await one(`select pay_service_proforma($1, 5000, 'wallet', null, 'pp-1') r`, [g.pf])).r;
  const q2 = (await one(`select pay_service_proforma($1, 20000, 'wallet', null, 'pp-2') r`, [g.pf])).r;
  await sys();
  // both payments are in one transaction (same created_at): compare the amounts regardless of row order
  const invs = await all(`select amount_cents, data->>'invoice_kind' k from documents where from_proforma_id = $1`, [g.pf]);
  ok(q1.invoice_id && q2.invoice_id && invs.length === 2 && invs.every((i) => i.k === 'payment') && invs.map((i) => Number(i.amount_cents)).sort((x, y) => x - y).join('+') === '5000+20000', 'rule "per_payment": a tax invoice for every payment (50.00 + 200.00)');
  ok(Number((await one(`select count(*) n from document_payments where document_id = $1 and invoice_id is null`, [g.pf])).n) === 0 && (await one(`select status from documents where id = $1`, [g.pf])).status === 'invoiced', 'no deposits left; proforma "invoiced" when fully paid');
  await db.query('rollback');

  // ───────── two simultaneous identical requests (committed data, cleaned up afterwards) ─────────
  // This block COMMITS rows, deletes them and gives an invoice number back: check again, right here, that both the
  // environment and the connected database are staging (lib-staging-guard), on a fresh connection.
  const yearPf = (await one(`select extract(year from now() at time zone 'Asia/Shanghai')::int y`)).y;
  const pfBefore = Number((await one(`select coalesce((select last_value from document_counters where series = 'PF' and year = $1), 0) v`, [yearPf])).v);
  const setup = await connect();
  await assertStagingOrThrow(setup);
  await setup.query('begin');
  const h = await fixture(setup, 'c');
  await setup.query('commit');
  await setup.end();
  const year2 = (await one(`select extract(year from now() at time zone 'Asia/Shanghai')::int y`)).y;
  const counterBefore = Number((await one(`select coalesce((select last_value from document_counters where series = 'OCT' and year = $1), 0) v`, [year2])).v);
  const [a, b] = [await connect(), await connect()];
  for (const c of [a, b]) { await c.query('begin'); await as(h.cust, {}, c); }
  const pa = a.query(`select pay_service_proforma($1, 25000, 'wallet', null, 'same-click') r`, [h.pf]);
  await new Promise((res) => setTimeout(res, 150));
  const pb = b.query(`select pay_service_proforma($1, 25000, 'wallet', null, 'same-click') r`, [h.pf]);   // waits for A's lock
  const ra = (await pa).rows[0].r;
  await a.query('commit');
  const rb = (await pb).rows[0].r;
  await b.query('commit');
  await a.end(); await b.end();
  ok(ra.repeated === false && rb.repeated === true && ra.invoice_id === rb.invoice_id, 'two simultaneous identical requests: one payment, one tax invoice (the second gets the first result)');
  ok(Number((await one(`select count(*) n from document_payments where document_id = $1`, [h.pf])).n) === 1 && Number((await one(`select count(*) n from documents where from_proforma_id = $1`, [h.pf])).n) === 1, '…exactly one payment row and one invoice in the database');
  // clean up the committed test rows; give the invoice number back (it is the last one issued) so staging stays gap-free
  await db.query('begin');
  await sys();
  const invNum = (await one(`select number from documents where from_proforma_id = $1`, [h.pf])).number;
  const pfNum = (await one(`select number from documents where id = $1`, [h.pf])).number;
  const js = (await all(`select id from journals where (ref_type = 'document' and ref_id in (select id from documents where org_id = $1)) or idempotency_key = 'test-pfi-fund-' || $1::text`, [h.org])).map((r) => r.id);
  await db.query(`update document_payments set invoice_id = null, journal_id = null where org_id = $1`, [h.org]);
  await db.query(`delete from document_payments where org_id = $1`, [h.org]);
  await db.query(`delete from ledger_entries where journal_id = any($1)`, [js]);
  await db.query(`delete from journals where id = any($1)`, [js]);
  await db.query(`delete from invoice_lines where document_id in (select id from documents where org_id = $1)`, [h.org]);
  await db.query(`update documents set from_proforma_id = null where org_id = $1`, [h.org]);
  await db.query(`delete from documents where org_id = $1`, [h.org]);
  await db.query(`delete from ledger_accounts where org_id = $1`, [h.org]);
  await db.query(`delete from org_members where org_id = $1`, [h.org]);
  await db.query(`delete from organizations where id = $1`, [h.org]);
  await db.query(`delete from auth.users where email like 'pfi-c-%@example.com'`);
  const counterNow = Number((await one(`select last_value from document_counters where series = 'OCT' and year = $1`, [year2])).last_value);
  if (counterNow === counterBefore + 1 && invNum.endsWith(String(counterNow).padStart(6, '0'))) await db.query(`update document_counters set last_value = $2 where series = 'OCT' and year = $1`, [year2, counterBefore]);
  // …and the test proforma's PF- number (it was issued in the committed setup)
  const pfNow = Number((await one(`select last_value from document_counters where series = 'PF' and year = $1`, [yearPf])).last_value);
  if (pfNow === pfBefore + 1 && pfNum?.endsWith(String(pfNow).padStart(6, '0'))) await db.query(`update document_counters set last_value = $2 where series = 'PF' and year = $1`, [yearPf, pfBefore]);
  await db.query('commit');
  ok(Number((await one(`select last_value from document_counters where series = 'PF' and year = $1`, [yearPf])).last_value) === pfBefore, `test proforma number ${pfNum} given back (PF counter ${pfBefore})`);
  ok(Number((await one(`select last_value from document_counters where series = 'OCT' and year = $1`, [year2])).last_value) === counterBefore, `committed test rows removed; invoice number ${invNum} given back (counter ${counterBefore})`);

  // ───────── 201 down → up identical ─────────
  await db.query('begin');
  const snap = async () => JSON.stringify({
    fn: (await all(`select p.oid::regprocedure::text f, md5(p.prosrc) s, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)),
    cols: (await all(`select table_name, column_name from information_schema.columns where table_name in ('documents', 'document_payments') order by 1, 2`)),
  });
  const up = await snap();
  const { appliedAfter, unwind, reapply, MAX_UNWIND } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000201_proforma_payments_invoicing.sql');
  await unwind(db, later, MAX_UNWIND);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000201_proforma_payments_invoicing.down.sql', 'utf8'));
  ok(!(await snap()).includes('pay_service_proforma'), 'down: payments and automatic invoices removed, report as in 200');
  await db.query(fs.readFileSync('supabase/migrations/20261101000201_proforma_payments_invoicing.sql', 'utf8'));
  await reapply(db, later);
  ok((await snap()) === up, 'up again: identical');
  await db.query('rollback');
} catch (e) {
  if (!e.skipRoundTrip) ok(false, 'unexpected: ' + e.message);
  await db.query('rollback').catch(() => {});
} finally {
  ok(!(await db.query(`select 1 from auth.users where email like 'pfi-%@example.com'`)).rowCount && !(await db.query(`select 1 from organizations where name like 'TEST · proforma invoicing %'`)).rowCount, 'nothing left behind');
  await db.end();
}
console.log(failed ? `\nproforma invoicing: ${failed} check(s) failed` : '\nproforma invoicing: all passed');
process.exitCode = failed ? 1 : 0;
