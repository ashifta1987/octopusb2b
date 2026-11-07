// Company bank accounts (7 Nov 2026) — one transaction, rolled back.
//  · Admin with a fresh 2FA code can add / change / delete; without a fresh code → STEP_UP_REQUIRED; non-admin → FORBIDDEN
//  · one active account per currency (a new active USD account replaces the old one)
//  · every change is audited (old + new values)
//  · customers read only active accounts; anonymous users read nothing; nobody writes the table directly
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const now = Math.floor(Date.now() / 1000);
const as = async (sub, fresh = true) => {
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2', amr: fresh ? [{ method: 'totp', timestamp: now }] : [{ method: 'password', timestamp: now - 7200 }] })]);
  await db.query('set local role authenticated');
};
const anon = async () => { await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`); await db.query('set local role anon'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { const r = await db.query(sql, p); await db.query('release savepoint t'); return r; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
const usd = (o = {}) => JSON.stringify({ currency: 'USD', bank_name: 'QA Bank (HK)', account_holder: 'Shenzhen Octopus Trading Co. Ltd.', account_number: '123 456 789', swift: 'QABKHKHH', active: true, ...o });
try {
  await db.query('begin');
  const before = Number((await one(`select count(*) n from company_bank_accounts`)).n);
  const admin = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;
  const cust = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), 'bank-cust@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`)).id;

  await as(cust);
  ok(/FORBIDDEN/.test(await tryQ(`select save_company_bank_account($1::jsonb)`, [usd()])), 'a customer cannot add a bank account');
  ok(/permission denied|row-level/.test(String(await tryQ(`insert into company_bank_accounts(currency, bank_name, account_holder, account_number) values ('USD','x','x','xxxx')`))), 'nobody writes the table directly');
  await owner();

  await as(admin, false);
  ok(/STEP_UP_REQUIRED/.test(await tryQ(`select save_company_bank_account($1::jsonb)`, [usd()])), 'admin without a fresh 2FA code → asked for the code again');
  await owner();

  await as(admin);
  const a1 = (await one(`select save_company_bank_account($1::jsonb) v`, [usd()])).v;
  const a2 = (await one(`select save_company_bank_account($1::jsonb) v`, [usd({ bank_name: 'QA Bank 2', account_number: '987654321' })])).v;
  await owner();
  const act = (await db.query(`select id from company_bank_accounts where currency = 'USD' and active`)).rows.map((r) => r.id);
  ok(act.length === 1 && act[0] === a2, 'one active USD account: the new one replaced the old one');
  ok(/SWIFT|swift_check|check constraint/.test(await tryQ(`insert into company_bank_accounts(currency, bank_name, account_holder, account_number, swift) values ('USD','x b','x y','12345','BAD')`)), 'an invalid SWIFT code is rejected');

  await as(admin);
  await db.query(`select save_company_bank_account($1::jsonb)`, [JSON.stringify({ id: a2, currency: 'USD', bank_name: 'QA Bank 2', account_holder: 'Shenzhen Octopus Trading Co. Ltd.', account_number: '555000111', active: true })]);
  await owner();
  const au = await one(`select details from audit_log where action = 'company_bank_account.updated' and entity_id = $1 order by id desc limit 1`, [a2]);
  ok(au && au.details.old.account_number === '987654321' && au.details.new.account_number === '555000111', 'changing the account number is audited with old and new values');
  ok(Number((await one(`select count(*) n from audit_log where action = 'company_bank_account.created' and entity_id = any($1)`, [[a1, a2]])).n) === 2, 'both additions audited');

  await as(cust);
  const seen = (await db.query(`select id, active from company_bank_accounts where bank_name like 'QA Bank%'`)).rows;
  ok(seen.length === 1 && seen[0].id === a2, 'a customer sees only the active account');
  await owner();
  await anon();
  ok((await tryQ(`select 1 from company_bank_accounts`)).rowCount === 0 || typeof (await tryQ(`select 1 from company_bank_accounts`)) === 'string', 'anonymous visitors see no bank accounts');
  await owner();

  await as(admin);
  await db.query(`select delete_company_bank_account($1)`, [a1]);
  await owner();
  ok(!(await db.query(`select 1 from company_bank_accounts where id = $1`, [a1])).rowCount && !!(await one(`select 1 x from audit_log where action = 'company_bank_account.deleted' and entity_id = $1`, [a1])), 'deleting is audited');
  ok(before >= 0, `(live accounts before the test: ${before})`);
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from company_bank_accounts where bank_name like 'QA Bank%'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nbank accounts: ${failed} check(s) failed` : '\nbank accounts: all passed');
process.exitCode = failed ? 1 : 0;

