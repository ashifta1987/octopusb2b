// Wallet credit facility (migration 143) — inside one rolled-back transaction; nothing persists.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const id = async (e) => (await db.query('select id from profiles where email=$1', [e])).rows[0].id;
const [admin, fin, buyer] = await Promise.all(['admin', 'finance', 'buyer'].map((u) => id(`${u}@demo.octopusb2b.com`)));
const as = async (uid) => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]); await db.query('set local role authenticated'); };
const one = async (s, p) => (await db.query(s, p)).rows[0];
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const expectErr = async (fn, code, m) => { await db.query('savepoint s'); try { await fn(); ok(false, m + ' (no error)'); } catch (e) { ok(e.message.includes(code), `${m} → ${e.message.slice(0, 90)}`); } await db.query('rollback to savepoint s'); };
const idem = () => 'credit-test-' + Math.random().toString(36).slice(2);

await db.query('begin');
try {
  await db.query('reset role');
  const cur = (await one('select current_platform_currency() v')).v;
  // known default for the test: US$ 1,000 for verified customers
  await db.query(`update site_settings set value = '{"amount_minor":100000,"currency":"${cur}","verified_only":true}'::jsonb where key = 'wallet_credit_default'`);
  const org = (await one('select org_id from org_members where user_id=$1', [buyer])).org_id;
  await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [org]);
  await db.query('delete from wallet_credit_limits where org_id = $1', [org]);

  await as(buyer);
  const w = await one('select * from my_wallet_credit()');
  const bal = Number(w.balance_minor);
  ok(Number(w.credit_limit_minor) === 100000 && Number(w.available_minor) === bal + 100000, `buyer sees balance ${bal}, credit 100000, available ${w.available_minor}`);
  await expectErr(() => db.query('select wallet_credit_limit($1)', [org]), 'permission denied', 'customer cannot call wallet_credit_limit directly');
  await expectErr(() => db.query(`insert into wallet_credit_limits(org_id, limit_minor, currency) values ($1, 999999, 'USD')`, [org]), 'permission denied', 'customer cannot write their own limit (no table privilege)');
  await expectErr(() => db.query('select admin_set_wallet_credit($1, 999999)', [org]), 'FORBIDDEN', 'customer cannot raise their own limit via RPC');

  // spend into credit: balance + 900.00 → balance −900.00 (within the 1,000 limit)
  await db.query('reset role');
  await db.query(`select wallet_charge($1, $2, 'credit test', 'service_fees', $3)`, [org, bal + 90000, idem()]);
  ok(Number((await one('select wallet_balance($1) v', [org])).v) === -90000, 'wallet can go negative within the credit limit (−900.00)');
  await expectErr(() => db.query(`select wallet_charge($1, 10001, 'credit test', 'service_fees', $2)`, [org, idem()]), 'WALLET_INSUFFICIENT', 'charge beyond the limit is refused (−1,000.01)');
  await db.query(`select wallet_charge($1, 10000, 'credit test', 'service_fees', $2)`, [org, idem()]);
  ok(Number((await one('select wallet_balance($1) v', [org])).v) === -100000, 'exactly at the limit (−1,000.00) is allowed');
  await expectErr(() => db.query(`select wallet_charge($1, 1, 'credit test', 'service_fees', $2)`, [org, idem()]), 'WALLET_INSUFFICIENT', 'one cent more is refused');

  // per-customer override by Admin; finance cannot
  await as(fin);
  await expectErr(() => db.query('select admin_set_wallet_credit($1, 500000)', [org]), 'FORBIDDEN', 'finance cannot change credit limits');
  await as(admin);
  await db.query(`select admin_set_wallet_credit($1, 500000, $2, 'test raise')`, [org, cur]);
  ok(Number((await one('select credit_limit_minor v from admin_wallet_credit_overview() where org_id=$1', [org])).v) === 500000, 'admin override → limit 5,000.00');
  await db.query('reset role');
  await db.query(`select wallet_charge($1, 300000, 'credit test', 'service_fees', $2)`, [org, idem()]);
  ok(Number((await one('select wallet_balance($1) v', [org])).v) === -400000, 'override allows −4,000.00');
  await as(admin);
  await db.query('select admin_set_wallet_credit($1, 0)', [org]);
  await db.query('reset role');
  await expectErr(() => db.query(`select wallet_charge($1, 1, 'credit test', 'service_fees', $2)`, [org, idem()]), 'WALLET_INSUFFICIENT', 'override 0 → no further spending while negative');
  await as(admin);
  await db.query('select admin_set_wallet_credit($1, null)', [org]);
  ok(Number((await one('select credit_limit_minor v from admin_wallet_credit_overview() where org_id=$1', [org])).v) === 100000, 'removing the override falls back to the default');
  ok((await one(`select count(*) n from audit_log where action = 'wallet.credit_limit_set' and entity_id = $1`, [org])).n >= 3, 'every limit change is audited');

  // verified_only: an unverified customer gets no default credit
  await db.query('reset role');
  await db.query(`update organizations set kyc_status = 'submitted' where id = $1`, [org]);
  ok(Number((await one('select wallet_credit_limit($1) v', [org])).v) === 0, 'unverified customer → no default credit');
  await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [org]);

  // default change by Admin only
  await as(fin);
  await expectErr(() => db.query(`select admin_set_wallet_credit_default(200000, $1, true)`, [cur]), 'FORBIDDEN', 'finance cannot change the default');
  await as(admin);
  await db.query(`select admin_set_wallet_credit_default(200000, $1, true)`, [cur]);
  await db.query('reset role');
  ok(Number((await one('select wallet_credit_limit($1) v', [org])).v) === 200000, 'admin changes the default → 2,000.00 applies');

  // ledger still balances
  const unbalanced = (await one(`select count(*) n from (select le.journal_id, la.currency from ledger_entries le join ledger_accounts la on la.id = le.account_id group by 1,2 having sum(debit_cents)<>sum(credit_cents)) x`)).n;
  ok(Number(unbalanced) === 0, 'every journal balances per currency');
  const fns = await one(`select bool_and(pg_get_functiondef(p.oid) like '%wallet_available%') v from pg_proc p where p.proname in ('wallet_charge','record_payment','record_ad_click','join_pool')`);
  ok(fns.v === true, 'all wallet spending paths check wallet_available()');
  ok((await one(`select pg_get_functiondef('apply_currency_switch(uuid)'::regprocedure) like '%balance_minor <> 0 loop%' v`)).v, 'currency switch converts negative wallets too');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  await db.end();
}
