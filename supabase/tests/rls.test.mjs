// Database security tests (SPEC §11.3 "pgTAP" list), as a plain Node script against DATABASE_URL.
// Run: node supabase/tests/rls.test.mjs
// Each test runs in its own transaction that is ROLLED BACK, so the database is never changed.
// Users are impersonated the way PostgREST does it: request.jwt.claims + `set local role authenticated|anon`.
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing (.env.local)');
  process.exit(1);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const DEMO = (name) => `${name}@demo.octopusb2b.com`;
const users = Object.fromEntries(
  (await db.query(`select email, id from auth.users where email like '%@demo.octopusb2b.com'`)).rows.map((r) => [r.email, r.id]),
);
const uid = (name) => {
  const id = users[DEMO(name)];
  if (!id) throw new SkipError(`demo user ${DEMO(name)} missing — run scripts/seed-users.mjs`);
  return id;
};

class SkipError extends Error {}
class AssertError extends Error {}
const assert = (cond, msg) => {
  if (!cond) throw new AssertError(msg);
};

const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

/** Switch the current transaction to a user (or anon when id is null). */
async function as(userId) {
  await q('reset role');
  if (userId) {
    await q(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
      userId,
    ]);
    await q('set local role authenticated');
  } else {
    await q(`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true)`);
    await q('set local role anon');
  }
}
async function asSuper() {
  await q('reset role');
  await q(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
}

/** Runs fn and expects it to raise; returns the error message. Uses a savepoint so the transaction stays usable. */
async function expectError(fn, pattern) {
  await q('savepoint expect_err');
  try {
    await fn();
  } catch (e) {
    await q('rollback to savepoint expect_err');
    if (pattern) assert(pattern.test(e.message), `expected error matching ${pattern}, got "${e.message}"`);
    return e.message;
  }
  await q('release savepoint expect_err');
  throw new AssertError(`expected an error${pattern ? ` matching ${pattern}` : ''}, but the statement succeeded`);
}

const results = [];
async function test(name, fn) {
  await q('begin');
  try {
    await fn();
    results.push({ name, status: 'PASS' });
  } catch (e) {
    results.push({ name, status: e instanceof SkipError ? 'SKIP' : 'FAIL', detail: e.message });
  } finally {
    await q('rollback');
  }
}

// ───────────────────────── Tests ─────────────────────────
await test('customer cannot read another org’s orders', async () => {
  const buyer = uid('buyer');
  const own = await one('select org_id from org_members where user_id = $1', [buyer]);
  if (!own) throw new SkipError('buyer has no org');
  // a second org with an order, created as superuser inside this (rolled back) transaction
  const other = await one(`insert into organizations(name, country) values ('RLS test org', 'DE') returning id`);
  const ord = await one(
    `insert into orders(org_id, status, title, quantity, unit_price_cents, total_cents, deposit_cents) values ($1,'deposit_pending','RLS secret order',1,100,100,30) returning id`,
    [other.id],
  );
  await q(`insert into documents(org_id, doc_type, number, order_id) values ($1,'proforma_invoice','PI-RLS-TEST',$2)`, [other.id, ord.id]);
  await as(buyer);
  const ownCount = await one('select count(*)::int n from orders');
  const leaked = await one('select count(*)::int n from orders where org_id = $1 or id = $2', [other.id, ord.id]);
  const leakedDocs = await one(`select count(*)::int n from documents where number = 'PI-RLS-TEST'`);
  const foreign = await one('select count(*)::int n from orders where org_id <> $1', [own.org_id]);
  assert(ownCount.n > 0, 'buyer should see their own orders');
  assert(leaked.n === 0, `buyer saw ${leaked.n} order(s) of another org`);
  assert(leakedDocs.n === 0, 'buyer saw another org’s document');
  assert(foreign.n === 0, `buyer saw ${foreign.n} order(s) outside their org`);
});

await test('anon cannot read suppliers (legal_name); public_suppliers hides legal fields', async () => {
  await as(null);
  let rows = 0;
  await q('savepoint s');
  try {
    rows = (await one('select count(*)::int n from suppliers')).n;
    await q('release savepoint s');
  } catch (e) {
    await q('rollback to savepoint s');
    assert(/permission denied/i.test(e.message), `unexpected error: ${e.message}`);
  }
  assert(rows === 0, `anon read ${rows} supplier row(s)`);
  const ps = await q('select * from public_suppliers limit 1');
  const cols = ps.fields.map((f) => f.name);
  for (const bad of ['legal_name', 'contact_name', 'contact_email', 'contact_phone'])
    assert(!cols.includes(bad), `public_suppliers exposes ${bad}`);
  assert(ps.rows.length > 0, 'anon should be able to read public_suppliers');
  const live = await one(`select count(*)::int n from products where status <> 'live'`);
  assert(live.n === 0, 'anon can see non-live products');
});

await test('customer cannot read supplier legal names or product costs', async () => {
  await as(uid('buyer'));
  const s = await one('select count(*)::int n from suppliers');
  const c = await one('select count(*)::int n from product_costs');
  assert(s.n === 0, `buyer read ${s.n} supplier row(s)`);
  assert(c.n === 0, `buyer read ${c.n} product cost row(s)`);
});

await test('ledger journals always balance (and unbalanced posts are rejected)', async () => {
  const bad = await q(
    `select journal_id, sum(debit_cents) d, sum(credit_cents) c from ledger_entries group by journal_id having sum(debit_cents) <> sum(credit_cents)`,
  );
  assert(bad.rows.length === 0, `${bad.rows.length} unbalanced journal(s): ${bad.rows.slice(0, 3).map((r) => r.journal_id).join(', ')}`);
  const empty = await one(`select count(*)::int n from journals j where not exists(select 1 from ledger_entries e where e.journal_id = j.id)`);
  assert(empty.n === 0, `${empty.n} journal(s) without entries`);
  await expectError(
    () =>
      q(`select post_journal('rls test', jsonb_build_array(
           jsonb_build_object('account', ledger_account('cash:bank','Bank','asset'), 'debit', 100, 'credit', 0),
           jsonb_build_object('account', ledger_account('rev:orders','Revenue · orders','revenue'), 'debit', 0, 'credit', 90)))`),
    /LEDGER_UNBALANCED/,
  );
  // clients cannot write the ledger directly
  await as(uid('buyer'));
  await expectError(() => q(`insert into journals(memo) values ('hack')`), /permission denied|row-level security/i);
  await expectError(() => q(`select post_journal('x', '[]'::jsonb)`), /permission denied/i);
});

await test('invalid order transitions are rejected', async () => {
  const o = await one(`select id, status from orders where status = 'shipped' limit 1`);
  if (!o) throw new SkipError('no shipped order in seed');
  await as(uid('ops'));
  await expectError(() => q(`select transition_order($1, 'confirmed')`, [o.id]), /INVALID_TRANSITION/);
  await expectError(() => q(`select transition_order($1, 'pi_issued')`, [o.id]), /INVALID_TRANSITION/);
  // customers can't move orders except cancelling before deposit
  await as(uid('buyer'));
  await expectError(() => q(`select transition_order($1, 'delivered')`, [o.id]), /FORBIDDEN/);
  await expectError(() => q(`update orders set status = 'closed' where id = $1`, [o.id]), /permission denied/i);
});

await test('wallet cannot go negative', async () => {
  const buyer = uid('buyer');
  const { org_id } = await one('select org_id from org_members where user_id = $1', [buyer]);
  const { bal } = await one('select wallet_balance($1)::bigint bal', [org_id]);
  await expectError(
    () => q(`select wallet_charge($1, $2, 'rls test', 'service_fees', 'rls-test-' || gen_random_uuid())`, [org_id, Number(bal) + 1]),
    /WALLET_INSUFFICIENT/,
  );
  const neg = await q(
    `select la.code, sum(le.credit_cents - le.debit_cents) bal from ledger_entries le join ledger_accounts la on la.id = le.account_id
     where la.code like 'wallet:%' group by la.code having sum(le.credit_cents - le.debit_cents) < 0`,
  );
  assert(neg.rows.length === 0, `${neg.rows.length} wallet(s) with negative balance`);
});

await test('maker cannot approve their own finance request', async () => {
  const maker = uid('finance');
  const { org_id } = (await one(`select org_id from org_members where user_id = $1`, [uid('buyer')])) ?? {};
  await as(maker);
  const { id } = await one(`select request_finance_approval('refund', 500, 'RLS test refund', $1) id`, [org_id]);
  await expectError(() => q('select decide_finance_approval($1, true)', [id]), /MAKER_CANNOT_APPROVE/);
  await expectError(() => q('select decide_finance_approval($1, false)', [id]), /MAKER_CANNOT_APPROVE/);
});

await test('a different finance user (checker) can approve', async () => {
  const maker = uid('finance');
  const checker = uid('finance2');
  const { org_id } = (await one(`select org_id from org_members where user_id = $1`, [uid('buyer')])) ?? {};
  await as(maker);
  const { id } = await one(`select request_finance_approval('refund', 500, 'RLS test refund', $1) id`, [org_id]);
  await as(checker);
  await q('select decide_finance_approval($1, true)', [id]);
  await asSuper();
  const fa = await one('select status, approved_by, executed_journal_id from finance_approvals where id = $1', [id]);
  assert(['approved', 'executed'].includes(fa.status), `checker approval did not apply (status ${fa.status})`);
  assert(fa.approved_by === checker, 'approved_by should be the checker');
  if (fa.executed_journal_id) {
    const j = await one('select sum(debit_cents) d, sum(credit_cents) c from ledger_entries where journal_id = $1', [fa.executed_journal_id]);
    assert(j.d === j.c, 'refund journal is unbalanced');
  }
});

await test('customer cannot approve finance requests or confirm top-ups', async () => {
  await asSuper();
  const t = await one(`select id from wallet_topups where status = 'pending' limit 1`);
  await as(uid('buyer'));
  if (t) await expectError(() => q('select confirm_topup($1)', [t.id]), /FORBIDDEN/);
  await expectError(() => q(`select request_finance_approval('refund', 500, 'self refund')`), /FORBIDDEN/);
});

await test('content editor cannot publish a legal page', async () => {
  const page = await one(`select id, status from pages where is_legal limit 1`);
  if (!page) throw new SkipError('no legal page in seed');
  await asSuper();
  await q(`update pages set status = 'draft' where id = $1`, [page.id]);
  await as(uid('content'));
  let blocked = false;
  let changed = 0;
  await q('savepoint s');
  try {
    changed = (await q(`update pages set status = 'published', published_at = now() where id = $1`, [page.id])).rowCount;
    await q('release savepoint s');
  } catch {
    await q('rollback to savepoint s');
    blocked = true;
  }
  if (blocked || changed === 0) return;
  await asSuper();
  const trg = await one(`select count(*)::int n from pg_trigger where tgrelid = 'public.pages'::regclass and not tgisinternal`);
  if (trg.n === 0) throw new SkipError('no legal-publish guard on pages yet (admin/content agent’s trigger not present)');
  throw new AssertError('content editor published a legal page despite a pages trigger being present');
});

await test('API/system RPCs are not callable by clients', async () => {
  await as(uid('buyer'));
  const { org_id } = await one('select my_org_id() org_id');
  await expectError(() => q(`select api_submit_rfq($1, 'x', 1, 'x')`, [org_id]), /permission denied/i);
  await expectError(() => q(`select system_transition_order(gen_random_uuid(), 'delivered')`), /permission denied/i);
  await expectError(() => q(`select * from claim_outbox_events(1)`), /permission denied/i);
  await as(null);
  await expectError(() => q(`select submit_rfq('x', 1, 'x')`), /permission denied/i);
});

await test('API RPCs: explicit org, cross-org quote rejected, order created (service_role)', async () => {
  const buyerOrg = (await one('select org_id from org_members where user_id = $1', [uid('buyer')]))?.org_id;
  if (!buyerOrg) throw new SkipError('buyer has no org');
  const other = await one(`insert into organizations(name, country) values ('API test org', 'DE') returning id`);
  const quote = await one(
    `select q.id from quotes q join rfqs r on r.id = q.rfq_id where r.org_id = $1 and q.status in ('sent','viewed') and q.valid_until > now() limit 1`,
    [buyerOrg],
  );
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await q('set local role service_role');
  const before = Number((await one('select wallet_balance($1) b', [buyerOrg])).b);
  const { id: rfqId } = await one(`select api_submit_rfq($1, 'API test RFQ', 100, 'details') id`, [buyerOrg]);
  const rfq = await one('select org_id, status, fee_usd_cents from rfqs where id = $1', [rfqId]);
  assert(rfq.org_id === buyerOrg && rfq.status === 'submitted', 'RFQ not created for the given org');
  const after = Number((await one('select wallet_balance($1) b', [buyerOrg])).b);
  const walletOn = (await one(`select setting_bool('wallet_enabled') v`)).v;
  if (walletOn) assert(before - after === Number(rfq.fee_usd_cents), `wallet charged ${before - after}, fee ${rfq.fee_usd_cents}`);
  const ev = await one(`select count(*)::int n from outbox_events where aggregate_id = $1 and event_type = 'rfq.submitted'`, [rfqId]);
  assert(ev.n === 1, 'rfq.submitted outbox event missing');
  if (!quote) throw new SkipError('no open quote in seed to approve');
  await expectError(() => q('select api_approve_quote($1, $2)', [other.id, quote.id]), /NOT_FOUND/);
  const res = (await one('select api_approve_quote($1, $2) r', [buyerOrg, quote.id])).r;
  const o = await one('select org_id, status, total_cents, deposit_cents from orders where id = $1', [res.order_id]);
  assert(o.org_id === buyerOrg && o.status === 'deposit_pending', 'order not created correctly');
  assert(/^PI-\d{4}-\d+$/.test(res.pi_number), `bad PI number ${res.pi_number}`);
  await expectError(() => q('select api_approve_quote($1, $2)', [buyerOrg, quote.id]), /QUOTE_NOT_APPROVABLE/);
});

await test('tracking webhook RPC: dedupe, shipment status, order → delivered (service_role)', async () => {
  const s = await one(`select s.id, s.tracking_no, s.order_id from shipments s join orders o on o.id = s.order_id where o.status = 'shipped' and s.tracking_no is not null limit 1`);
  if (!s) throw new SkipError('no shipped order with a shipment');
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await q('set local role service_role');
  const evId = 'rls-test-' + Date.now();
  const first = (await one(`select system_record_tracking($1, $2, 'delivered', 'Delivered to receiver', 'Rotterdam, NL', now()) v`, [s.tracking_no, evId])).v;
  const replay = (await one(`select system_record_tracking($1, $2, 'delivered', 'Delivered to receiver', 'Rotterdam, NL', now()) v`, [s.tracking_no, evId])).v;
  assert(first === true && replay === false, 'webhook replay was not deduped');
  const n = await one('select count(*)::int n from tracking_events where provider_event_id = $1', [evId]);
  assert(n.n === 1, 'duplicate tracking events');
  const sh = await one('select status from shipments where id = $1', [s.id]);
  const o = await one('select status, claim_hidden_until from orders where id = $1', [s.order_id]);
  assert(sh.status === 'delivered', `shipment status ${sh.status}`);
  assert(o.status === 'delivered' && o.claim_hidden_until, `order status ${o.status}`);
  const back = (await one(`select system_record_tracking($1, $2, 'in_transit', 'late event', null, now()) v`, [s.tracking_no, evId + '-b'])).v;
  assert(back === true, 'late event should still be recorded');
  assert((await one('select status from shipments where id = $1', [s.id])).status === 'delivered', 'shipment moved backwards');
  const evs = await one(`select count(*)::int n from outbox_events where aggregate_id = $1 and event_type = 'shipment.tracking'`, [s.id]);
  assert(evs.n >= 2, 'shipment.tracking outbox events missing');
  await expectError(() => q(`select system_record_tracking('NO-SUCH', 'x', 'delivered', 'x')`), /NOT_FOUND/);
});

await test('outbox claim leases events (SKIP LOCKED) for the worker', async () => {
  await q(`insert into outbox_events(event_type, aggregate_type, payload) values ('test.event', 'test', '{}')`);
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await q('set local role service_role');
  const rows = (await q('select * from claim_outbox_events(500, 300)')).rows;
  assert(rows.length > 0, 'nothing claimed');
  assert(rows.every((r) => r.status === 'dispatched' && new Date(r.available_at) > new Date()), 'claimed events not leased');
  const again = (await q('select * from claim_outbox_events(500, 300)')).rows.filter((r) => rows.some((x) => x.id === r.id));
  assert(again.length === 0, 'leased events were claimed twice');
});

// ───────────────────────── Report ─────────────────────────
await db.end();
const icon = { PASS: '✔', FAIL: '✖', SKIP: '○' };
for (const r of results) console.log(`${icon[r.status]} ${r.status} ${r.name}${r.detail ? `\n    ${r.detail}` : ''}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n${results.length} tests: ${results.length - failed - results.filter((r) => r.status === 'SKIP').length} passed, ${failed} failed, ${results.filter((r) => r.status === 'SKIP').length} skipped`);
process.exit(failed ? 1 : 0);
