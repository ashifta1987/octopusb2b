// Chain 11 — Currency switch USD → CNY (SPEC §21.1 #11) inside ONE rolled-back transaction (switching the live
// platform currency would reprice production). Trace id via app.trace_id; staff via JWT claims (aal2) like the DB suites.
// Proves: maker–checker, quotes/PIs before the switch keep USD + FX rate, new PIs in CNY, pgTAP: every journal balances
// per currency. Out of reach in a rolled-back transaction: the outbox worker/webhook for settings.currency_changed and
// the storefront ISR re-render (covered by the worker unit + currency suite).
import { config } from 'dotenv';
import pg from 'pg';
import { hops, newTrace, remember, reporter } from './lib.mjs';
config({ path: '.env.local', quiet: true });

const { r, check, note, save } = reporter(11, 'Currency switch USD → CNY');
const trace = newTrace(11);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const one = async (s, p) => (await db.query(s, p)).rows[0];
const id = async (e) => (await one('select id from profiles where email=$1', [e])).id;
const as = async (uid) => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]); await db.query('set local role authenticated'); };
const timed = async (label, fn) => { const t = performance.now(); const v = await fn(); r.latency[label] = Math.round(performance.now() - t); return v; };
await db.query('begin');
try {
  await db.query(`select set_config('app.trace_id', $1, true)`, [trace]);
  const [admin, fin, ops, buyer] = [await id('admin@demo.octopusb2b.com'), await id('finance@demo.octopusb2b.com'), await id('ops@demo.octopusb2b.com'), await id('buyer@demo.octopusb2b.com')];
  const t0 = Date.now();
  // a USD quote/PI before the switch
  await as(buyer);
  const r0 = (await one(`select submit_rfq('QA-TRACE before switch',10,'e2e') v`)).v;
  await as(ops);
  const s0 = (await one(`select id from suppliers order by code limit 1`)).id;
  const q0 = (await one(`select send_quote($1,$2,5000,10,'FOB',10,0,null) v`, [r0, s0])).v;
  await as(buyer);
  const o0 = (await one(`select approve_quote($1) v`, [q0])).v;
  const before = await one(`select o.currency, o.fx_rate_id, pi.currency pi_currency from orders o join proforma_invoices pi on pi.order_id=o.id where o.id=$1`, [o0.order_id]);
  // request (admin) → approve (finance, checker) → applied
  await as(admin);
  const req = await timed('RPC request_currency_switch', async () => (await one(`select request_currency_switch('CNY', 7.20, 'convert', null, 'E2E trace') v`)).v);
  await db.query('savepoint s');
  let makerBlocked = false;
  try { await db.query('select approve_currency_switch($1)', [req]); } catch (e) { makerBlocked = /MAKER_CANNOT_APPROVE/.test(e.message); }
  await db.query('rollback to savepoint s');
  check(makerBlocked, 'maker (admin) cannot approve own switch');
  await as(fin);
  await timed('RPC approve_currency_switch (apply)', () => db.query('select approve_currency_switch($1)', [req]));
  check((await one(`select current_platform_currency() v`)).v === 'CNY', 'approved → applied: platform currency CNY');
  const st = await one(`select status from currency_switch_requests where id=$1`, [req]);
  check(st.status === 'applied', 'switch request applied', st.status);
  // storefront prices in CNY (catalogue tiers are converted for display at the approved rate)
  const tier = await one(`select pt.unit_price_cents, pt.currency, convert_amount(pt.unit_price_cents, pt.currency, current_platform_currency()) cny from price_tiers pt join products p on p.id=pt.product_id where p.status='live' order by pt.min_qty limit 1`);
  check(tier && Number(tier.cny) > Number(tier.unit_price_cents), 'storefront price converts to CNY at the approved rate', JSON.stringify(tier));
  // old PI unchanged, new PI in CNY
  const after = await one(`select o.currency, o.fx_rate_id, pi.currency pi_currency from orders o join proforma_invoices pi on pi.order_id=o.id where o.id=$1`, [o0.order_id]);
  check(before.currency === 'USD' && JSON.stringify(before) === JSON.stringify(after), 'USD PI from before the switch keeps currency + FX rate', JSON.stringify(after));
  await as(buyer);
  const r1 = (await one(`select submit_rfq('QA-TRACE after switch',10,'e2e') v`)).v;
  await as(ops);
  const q1 = (await one(`select send_quote($1,$2,99,10,'FOB',10,0,null) v`, [r1, s0])).v;
  await as(buyer);
  const o1 = (await one(`select approve_quote($1) v`, [q1])).v;
  const n1 = await one(`select o.currency, o.fx_rate_id, pi.currency pi_currency from orders o join proforma_invoices pi on pi.order_id=o.id where o.id=$1`, [o1.order_id]);
  check(n1.currency === 'CNY' && n1.pi_currency === 'CNY' && n1.fx_rate_id, 'new PI after the switch carries CNY + rate', JSON.stringify(n1));
  // pgTAP: every journal balances per currency
  await db.query('reset role');
  await db.query('create extension if not exists pgtap');
  await db.query('select plan(1)');
  const tap = await one(`select is((select count(*) from (select journal_id, currency from ledger_entries group by 1,2 having sum(debit_cents) <> sum(credit_cents)) x), 0::bigint, 'every journal balances per currency') v`);
  check(/^ok/.test(tap.v), `pgTAP: ${tap.v}`);
  const ev = await one(`select count(*)::int n from outbox_events where trace_id=$1 and event_type='settings.currency_changed'`, [trace]);
  check(ev.n === 1, 'outbox settings.currency_changed written once (broadcast webhook consumer)', ev.n);
  const rows = (await one(`select trace_rows($1) v`, [trace])).v ?? {};
  r.hops = hops(rows);
  r.tables = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  check((rows.audit_log ?? []).some((a) => /currency/.test(a.action)), 'currency switch audited', (rows.audit_log ?? []).map((a) => a.action).join(', '));
  r.e2e_ms = Date.now() - t0;
  // negative: approving an applied switch again
  await as(fin);
  await db.query('savepoint s2');
  let replay = null;
  try { await db.query('select approve_currency_switch($1)', [req]); } catch (e) { replay = e.message; }
  await db.query('rollback to savepoint s2');
  check(!!replay, 'replay: approving an applied switch is refused', replay);
  note('Ran inside one transaction that was rolled back — nothing persisted (incl. the temporary pgtap extension).');
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await db.query('rollback');
  await db.end();
  save();
  process.exit(0);
}
