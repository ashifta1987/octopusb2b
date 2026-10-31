// SPEC §15.1 "Done when" checks, inside one rolled-back transaction.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const id = async (e) => (await db.query('select id from profiles where email=$1', [e])).rows[0].id;
const [admin, fin, fin2, ops, buyer] = await Promise.all(['admin', 'finance', 'finance2', 'ops', 'buyer'].map((u) => id(`${u}@demo.octopusb2b.com`)));
const as = async (uid) => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]); await db.query('set local role authenticated'); };
const one = async (s, p) => (await db.query(s, p)).rows[0];
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const expectErr = async (fn, code, m) => { await db.query('savepoint s'); try { await fn(); ok(false, m + ' (no error)'); } catch (e) { ok(e.message.includes(code), `${m} → ${e.message}`); } await db.query('rollback to savepoint s'); };

await db.query('begin');
try {
  await as(buyer);
  const org = (await one('select my_org_id() v')).v;
  // an open USD proforma invoice created BEFORE the switch
  const r0 = (await one(`select submit_rfq('USD before switch',10,'x') v`)).v;
  await as(ops);
  const s0 = (await one(`select id from suppliers where code='OCT-1108'`)).id;
  const q0 = (await one(`select send_quote($1,$2,5000,10,'FOB',10,0,null) v`, [r0, s0])).v;
  await as(buyer);
  const o0 = (await one(`select approve_quote($1) v`, [q0])).v;
  const oldOrder = await one(`select id, currency, total_cents, paid_cents from orders where id=$1`, [o0.order_id]);
  const usdBal = Number((await one('select my_wallet_balance() v')).v);
  console.log('buyer USD wallet', usdBal, 'old order', oldOrder);

  await as(admin);
  console.log('impact', JSON.stringify((await one(`select currency_switch_impact('CNY') v`)).v));
  const req = (await one(`select request_currency_switch('CNY', 7.25, 'convert', null, 'test') v`)).v;
  await expectErr(() => db.query('select approve_currency_switch($1)', [req]), 'MAKER_CANNOT_APPROVE', 'admin (maker) cannot approve own switch');
  await as(fin);
  await db.query('select approve_currency_switch($1)', [req]);
  ok((await one(`select current_platform_currency() v`)).v === 'CNY', 'platform currency is CNY after approval');
  ok((await one(`select status from currency_switch_requests where id=$1`, [req])).status === 'applied', 'switch applied immediately (effective now)');

  await as(buyer);
  const cnyBal = Number((await one(`select my_wallet_balance() v`)).v);
  ok(Math.abs(cnyBal - Math.round(usdBal * 7.25)) <= 1 && Number((await one(`select my_wallet_balance('USD') v`)).v) === 0, `wallet converted: USD ${usdBal} → CNY ${cnyBal}`);
  const unbalanced = (await db.query(`reset role`), await one(`select count(*) n from (select journal_id, currency from ledger_entries group by 1,2 having sum(debit_cents)<>sum(credit_cents)) x`)).n;
  ok(Number(unbalanced) === 0, 'every journal balances per currency');

  await as(buyer);
  const svc = await one(`select * from service_price_info('qc')`);
  ok(svc.currency === 'CNY' && svc.converted === true, `QC price converted to CNY: ${svc.amount_minor} (converted=${svc.converted})`);
  const sr = (await one(`select request_service('qc','{}'::jsonb) v`)).v;
  ok((await one(`select currency, fee_minor from service_requests where id=$1`, [sr])).currency === 'CNY', 'new service request charged in CNY');
  const rfq = (await one(`select submit_rfq('CNY test',100,'x') v`)).v;
  await as(ops);
  const sup = (await one(`select id from suppliers where code='OCT-1101'`)).id;
  const q = (await one(`select send_quote($1,$2,99,100,'FOB',10,0,null) v`, [rfq, sup])).v;
  ok((await one(`select currency from quotes where id=$1`, [q])).currency === 'CNY', 'new quote is in CNY');
  await as(buyer);
  const ord = (await one(`select approve_quote($1) v`, [q])).v;
  const o2 = await one(`select currency, fx_rate_id from orders where id=$1`, [ord.order_id]);
  const pi = await one(`select currency from proforma_invoices where order_id=$1`, [ord.order_id]);
  ok(o2.currency === 'CNY' && pi.currency === 'CNY' && o2.fx_rate_id, 'new order + PI locked to CNY with rate');

  if (oldOrder) {
    ok((await one(`select currency from orders where id=$1`, [oldOrder.id])).currency === 'USD', 'old order keeps USD');
    await as(fin2);
    await db.query(`select record_payment($1, $2, 'bank_transfer', 'USD-after-switch')`, [oldOrder.id, Number(oldOrder.total_cents) - Number(oldOrder.paid_cents) > 100 ? 100 : 1]);
    ok((await one(`select currency from payments where reference='USD-after-switch'`)).currency === 'USD', 'old USD PI can still be paid in USD');
  }

  await as(admin);
  const back = (await one(`select request_currency_switch('USD', 7.25, 'keep') v`)).v;
  await as(fin2);
  await db.query('select approve_currency_switch($1)', [back]);
  ok((await one(`select current_platform_currency() v`)).v === 'USD', 'switch back to USD works');
  await as(buyer);
  ok(Number((await one(`select my_wallet_balance('CNY') v`)).v) > 0, 'kept CNY balance stays spendable/visible after switching back (keep option)');
  await db.query('reset role');
  ok(Number((await one(`select count(*) n from (select journal_id, currency from ledger_entries group by 1,2 having sum(debit_cents)<>sum(credit_cents)) x`)).n) === 0, 'journals still balance per currency');
} finally {
  await db.query('rollback');
  await db.end();
}
