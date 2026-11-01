// SPEC §18 group buying — "Done when" scenario + rules, all in one rolled-back transaction.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const now = () => Math.floor(Date.now() / 1000);
const as = async (uid, staff = false) => {
  await db.query('reset role');
  const claims = { sub: uid, role: 'authenticated', aal: staff ? 'aal2' : 'aal1', amr: staff ? [{ method: 'totp', timestamp: now() }] : [{ method: 'password', timestamp: now() }] };
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)]);
  await db.query('set local role authenticated');
};
const sys = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','',true)`); };
const one = async (s, p) => (await db.query(s, p)).rows[0];
let failed = 0;
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const expectErr = async (fn, code, m) => { await db.query('savepoint s'); try { await fn(); ok(false, m + ' (no error)'); } catch (e) { ok(e.message.includes(code), `${m} → ${e.message}`); } await db.query('rollback to savepoint s'); };

await db.query('begin');
try {
  const ops = (await one(`select id from profiles where email='ops@demo.octopusb2b.com'`)).id;
  const admin = (await one(`select id from profiles where email='admin@demo.octopusb2b.com'`)).id;
  // three buyers in different countries, each with a funded wallet
  const buyers = [];
  for (const [i, c] of [['a', 'NL'], ['b', 'DE'], ['c', 'US']].entries()) {
    const u = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated','authenticated','00000000-0000-0000-0000-000000000000') returning id`, [`pooltest-${c}@example.com`])).id;
    await as(u);
    const org = (await one(`select complete_onboarding($1,$2,$3,'+1 000','Importer / wholesaler') v`, [`Buyer ${c}`, `Pool Test ${c}`, c])).v;
    await sys();
    await db.query(`select post_journal('test funding', jsonb_build_array(
        jsonb_build_object('account', cash_account('USD'), 'debit', 100000, 'credit', 0),
        jsonb_build_object('account', wallet_account($1,'USD'), 'debit', 0, 'credit', 100000, 'org', $1)), 'test-fund-' || $1::text)`, [org]);
    buyers.push({ u, org, c });
  }
  const prod = await one(`select id, moq from products where slug='stainless-steel-hex-bolts-m10-40-mm-a2-70'`);
  const tiers = (await db.query(`select min_qty, unit_price_cents from price_tiers where product_id=$1 order by min_qty`, [prod.id])).rows;
  const [A, B, C] = buyers;

  // A opens a pool targeting tier 2 (5 × MOQ) and pledges
  await as(A.u);
  const pool = (await one(`select open_pool($1, $2, now() + interval '7 days', 500, null, 2000) v`, [prod.id, tiers[1].min_qty])).v;
  let p = await one(`select * from pools where id=$1`, [pool]);
  ok(p.status === 'open' && p.filled_qty === 2000 && p.currency === 'USD', `pool ${p.code} opened from the product, A pledged 2000`);
  await expectErr(() => db.query(`select join_pool($1, 100)`, [pool]), 'PLEDGE_BELOW_MINIMUM', 'pledge below the minimum is refused');

  await as(B.u); await db.query(`select join_pool($1, 2000)`, [pool]);
  // withdraw + rejoin before fill works and refunds the deposit
  await as(C.u);
  const w = (await one(`select join_pool($1, 500) v`, [pool])).v;
  const balBefore = Number((await one(`select my_wallet_balance('USD') v`)).v);
  await db.query(`select withdraw_pledge($1)`, [w]);
  ok(Number((await one(`select my_wallet_balance('USD') v`)).v) > balBefore, 'withdrawing before fill refunds the deposit to the wallet');

  // currency-mismatched pledges are rejected
  await sys(); await db.query(`update site_settings set value='"CNY"' where key='platform_currency'`);
  await as(C.u);
  await expectErr(() => db.query(`select join_pool($1, 1000)`, [pool]), 'POOL_CURRENCY_MISMATCH', 'pledge in a currency-mismatched pool is rejected');
  await sys(); await db.query(`update site_settings set value='"USD"' where key='platform_currency'`);

  // C fills the pool
  await as(C.u); await db.query(`select join_pool($1, 1000)`, [pool]);
  ok(Number((await one(`select filled_qty from pools where id=$1`, [pool])).filled_qty) === 5000, 'pool reaches its 5,000 target');

  // anonymity: public participants show buyer code + country only
  await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','{"role":"anon"}',true)`); await db.query('set local role anon');
  const pub = (await db.query(`select * from pool_public_view where pool_id=$1`, [pool])).rows;
  ok(pub.length === 3 && pub.every((r) => /^BUYER-\d+$/.test(r.buyer_code) && r.country && !('org_id' in r) && !('name' in r)), 'participants are visible by buyer code + country only');

  // settle (cron) — idempotent
  await sys();
  const s1 = (await one(`select settle_pool($1) v`, [pool])).v;
  const s2 = (await one(`select settle_pool($1) v`, [pool])).v;
  ok(s1.orders === 3 && s2.idempotent === true, 'settle_pool creates 3 PIs once and is idempotent');
  const aud = await one(`select count(*)::int n from audit_log where entity='pools' and entity_id=$1 and action='pool.locked'`, [String(pool)]);
  ok(aud.n === 1, `pool settle is in the audit log exactly once (${aud.n})`);
  const orders = (await db.query(`select o.*, pl.org_id pl_org from orders o join pool_pledges pl on pl.id=o.pool_pledge_id where o.pool_id=$1 order by o.created_at`, [pool])).rows;
  ok(orders.every((o) => Number(o.unit_price_cents) === Number(tiers[1].unit_price_cents) && Number(tiers[1].unit_price_cents) < Number(tiers[0].unit_price_cents)),
     `each buyer's PI is at the lower tier price (${tiers[1].unit_price_cents}¢ vs ${tiers[0].unit_price_cents}¢)`);
  ok(Number((await one(`select count(*) n from proforma_invoices where pool_id=$1`, [pool])).n) === 3, '3 proforma invoices issued');
  const po = await one(`select d.* from documents d join pools p on p.po_document_id=d.id where p.id=$1`, [pool]);
  ok(po && po.org_id === null && po.data.aggregate_qty === 5000 && !JSON.stringify(po.data).match(/Pool Test|BUYER-|@/), 'one supplier PO with the aggregate quantity and no customer identities');

  // A and B pay their balances from wallet; C defaults after the 48h window
  for (const b of [A, B]) {
    await as(b.u);
    const o = orders.find((x) => x.org_id === b.org);
    await db.query(`select record_payment($1, $2, 'wallet', 'balance')`, [o.id, Number(o.total_cents) - Number(o.paid_cents)]);
  }
  await sys();
  ok((await db.query(`select status from pool_pledges where pool_id=$1 and status='confirmed'`, [pool])).rows.length === 2, 'two buyers paid their balance (pledges confirmed)');
  await sys();
  await db.query(`update pools set balance_due_at = now() - interval '1 minute' where id=$1`, [pool]);
  const job = (await one(`select job_pools() v`)).v;
  const cPledge = await one(`select status from pool_pledges where pool_id=$1 and org_id=$2 and status not in ('withdrawn')`, [pool, C.org]);
  ok(job.defaulted === 1 && cPledge.status === 'defaulted', 'unpaid balance after 48 h → pledge defaulted');
  const forfeit = await one(`select coalesce(sum(le.credit_cents - le.debit_cents),0) v from ledger_entries le join ledger_accounts la on la.id=le.account_id where la.code='rev:pool_forfeit'`);
  ok(Number(forfeit.v) > 0, `defaulted deposit applied to the shortfall (forfeit ${forfeit.v}¢)`);
  ok((await one(`select status from pools where id=$1`, [pool])).status === 'confirmed', 'remaining balances paid → pool confirmed, supplier PO issued');
  ok((await one(`select status from documents where id=$1`, [po.id])).status === 'issued', 'PO status issued after balances');

  // expiry refunds everyone; cancel after lock refunds what was paid
  await as(A.u);
  const pool2 = (await one(`select open_pool($1, $2, now() + interval '4 days', null, null, 1000) v`, [prod.id, tiers[2].min_qty])).v;
  await as(B.u); await db.query(`select join_pool($1, 400)`, [pool2]);
  await sys(); await db.query(`update pools set deadline_at = now() - interval '1 minute' where id=$1`, [pool2]);
  const before = Number((await one(`select wallet_balance($1,'USD') v`, [B.org])).v);
  await db.query(`select job_pools()`);
  ok((await one(`select status from pools where id=$1`, [pool2])).status === 'expired' && Number((await one(`select wallet_balance($1,'USD') v`, [B.org])).v) > before,
     'pool under target at the deadline expires and deposits are refunded');
  ok(Number((await one(`select count(*) n from (select journal_id, currency from ledger_entries group by 1,2 having sum(debit_cents)<>sum(credit_cents)) x`)).n) === 0, 'every journal balances per currency');
  const escrow = await one(`select coalesce(sum(le.credit_cents - le.debit_cents),0) v from ledger_entries le join ledger_accounts la on la.id=le.account_id where la.code='escrow:pools'`);
  ok(Number(escrow.v) === 0, 'escrow is empty once pools are settled or expired');

  // admin controls
  await as(A.u);
  const pool3 = (await one(`select open_pool($1, null, null, null, null, 1500) v`, [prod.id])).v;
  await expectErr(() => db.query(`select cancel_pool($1,'x')`, [pool3]), 'FORBIDDEN', 'customers cannot cancel pools');
  await as(admin, true);
  await db.query(`select extend_pool_deadline($1, now() + interval '20 days')`, [pool3]);
  const refunds = (await one(`select cancel_pool($1, 'Supplier discontinued') v`, [pool3])).v;
  ok(refunds === 1 && (await one(`select status from pools where id=$1`, [pool3])).status === 'cancelled', 'admin can extend and cancel (with refund)');
  await sys(); await db.query(`update site_settings set value='false' where key='pool_enabled'`);
  await as(B.u);
  await expectErr(() => db.query(`select open_pool($1)`, [prod.id]), 'POOLS_DISABLED', 'global Group buy switch OFF blocks new pools');
} finally {
  await db.query('rollback');
  await db.end();
}
console.log(failed ? `\n${failed} failed` : '\nall group-buy checks passed');
process.exitCode = failed ? 1 : 0;
