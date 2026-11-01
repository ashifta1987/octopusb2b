// SPEC §20 checks (rolled back): customer sees only own assistant data; staff only assigned customers;
// escalation opens a ticket with the transcript, routes to the account manager (or team queue when out of office).
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const now = () => Math.floor(Date.now() / 1000);
const as = async (uid, staff = false) => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: staff ? 'aal2' : 'aal1', amr: [{ method: staff ? 'totp' : 'password', timestamp: now() }] })]);
  await db.query('set local role authenticated');
};
const sys = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','',true)`); };
const one = async (s, p) => (await db.query(s, p)).rows[0];
let failed = 0;
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const expectErr = async (fn, code, m) => { await db.query('savepoint s'); try { await fn(); ok(false, m + ' (no error)'); } catch (e) { ok(e.message.includes(code), `${m} → ${e.message}`); } await db.query('rollback to savepoint s'); };
const id = async (e) => (await one('select id from profiles where email=$1', [e])).id;

await db.query('begin');
try {
  const [buyer, support, ops, admin] = await Promise.all(['buyer', 'support', 'ops', 'admin'].map((u) => id(`${u}@demo.octopusb2b.com`)));
  const buyerOrg = (await one('select org_id from org_members where user_id=$1', [buyer])).org_id;
  ok((await one('select staff_user_id from account_managers where org_id=$1', [buyerOrg]))?.staff_user_id === support, 'verified demo customer has support@ as dedicated account manager');

  // a second customer org (not assigned to support)
  await sys();
  const u2 = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(),'assist-other@example.com','authenticated','authenticated','00000000-0000-0000-0000-000000000000') returning id`)).id;
  await as(u2);
  const org2 = (await one(`select complete_onboarding('Other Buyer','Other Co','DE','+49','Retailer / e-commerce') v`)).v;
  const s2 = (await one(`select start_assistant_session('page','/account') v`)).v;
  await db.query(`select post_customer_message($1,'Where is my order?')`, [s2]);

  // buyer session + bot reply + customer messages
  await as(buyer);
  const card = (await one('select my_account_team() v')).v;
  ok(card?.name && card?.team === 'Sourcing', `customer sees their account team card (${card?.name}, ${card?.team})`);
  const s = (await one(`select start_assistant_session('drawer','/account/orders') v`)).v;
  await db.query(`select post_customer_message($1,'Where is my hex-bolt order?')`, [s]);
  await sys();
  const r = (await one(`select record_bot_reply($1, 'Order ORD-2202 shipped with YunExpress YT2530412345678.', 0.92, '[{"tool":"get_shipment","latency_ms":120}]'::jsonb, 850, 410) v`, [s])).v;
  ok(r.low_confidence_turns === 0, 'bot reply recorded with tools_called, latency and tokens');

  // customers only read their own assistant data
  await as(buyer);
  ok(Number((await one('select count(*) n from assistant_messages where session_id=$1', [s2])).n) === 0, "customer cannot read another customer's assistant messages");
  ok(Number((await one('select count(*) n from assistant_messages where session_id=$1', [s])).n) === 2, 'customer reads their own conversation');
  await expectErr(() => db.query(`select post_customer_message($1,'hi')`, [s2]), 'NOT_FOUND', "customer cannot post into another customer's session");

  // staff: only assigned customers
  await as(support, true);
  ok(Number((await one('select count(*) n from assistant_sessions where id=$1', [s])).n) === 1, 'account manager reads their customer’s session');
  ok(Number((await one('select count(*) n from assistant_sessions where id=$1', [s2])).n) === 0, 'account manager cannot read an unassigned customer’s session');
  await as(ops, true);
  ok(Number((await one('select count(*) n from assistant_sessions where id=$1', [s])).n) === 0, 'other staff (ops) cannot read sessions of customers not assigned to them');

  // escalation: sensitive topic → ticket with transcript, system message, notification to account manager
  await as(buyer);
  await db.query(`select post_customer_message($1,'The batch failed RoHS. I want a refund on shipping.')`, [s]);
  await sys();
  const esc = (await one(`select escalate_session($1,'sensitive_topic','I want a refund on shipping.',0.35) v`, [s])).v;
  const e = await one('select * from escalations where id=$1', [esc]);
  ok(e.assigned_to === support && e.ticket_id, 'escalation assigned to the account manager with a Support ticket');
  const tm = await one('select body from ticket_messages where ticket_id=$1', [e.ticket_id]);
  ok(/Transcript/.test(tm.body) && /hex-bolt/.test(tm.body), 'ticket has the full transcript attached');
  ok((await one(`select content from assistant_messages where session_id=$1 and author='system' order by created_at desc limit 1`, [s])).content.startsWith('Octo handed this to'), 'customer sees the amber "Octo handed this to …" system message');
  ok(Number((await one(`select count(*) n from notifications where user_id=$1 and title like 'Customer handed to you%'`, [support])).n) >= 1, 'account manager notified');
  ok(Number((await one(`select count(*) n from outbox_events where event_type='assistant.escalated' and aggregate_id=$1`, [s])).n) === 1, 'email/WhatsApp notice queued (outbox assistant.escalated)');
  ok((await one(`select escalate_session($1,'customer_request') v`, [s])).v === esc, 'escalating again while open is idempotent');

  // account manager replies inline; customer sees it
  await as(support, true);
  await db.query(`select log_assistant_open($1)`, [s]);
  await db.query(`select staff_assistant_reply($1,'Hi, I am looking into the RoHS failure and the refund now.')`, [s]);
  await db.query(`select staff_assistant_reply($1,'internal: check QC report first', true)`, [s]);
  await as(buyer);
  const msgs = (await db.query(`select author, content from assistant_messages where session_id=$1 order by created_at`, [s])).rows;
  ok(msgs.some((m) => m.author === 'staff' && /RoHS/.test(m.content)) && !msgs.some((m) => /internal:/.test(m.content)), 'customer sees the staff reply in the same thread, not internal notes');
  await as(ops, true);
  await expectErr(() => db.query(`select staff_assistant_reply($1,'x')`, [s]), 'FORBIDDEN', 'unassigned staff cannot reply');

  // out of office → team queue
  await sys();
  await db.query(`update profiles set out_of_office=true where id=$1`, [support]);
  await db.query(`update escalations set resolved_at=now() where id=$1`, [esc]);
  const esc2 = (await one(`select escalate_session($1,'customer_request','talk to someone') v`, [s])).v;
  ok((await one('select assigned_to, team from escalations where id=$1', [esc2])).assigned_to === null, 'primary out of office → escalation goes to the team queue');
  await db.query(`update profiles set out_of_office=false where id=$1`, [support]);

  // assignment on KYC verification
  await sys();
  await db.query(`update organizations set kyc_status='verified' where id=$1`, [org2]);
  ok((await one('select staff_user_id from account_managers where org_id=$1', [org2]))?.staff_user_id === support, 'KYC verification auto-assigns an account manager (sourcing team, least loaded)');
  await as(admin, true);
  await db.query(`select reassign_account_manager($1,$2,'Customer speaks German')`, [org2, ops]);
  ok((await one('select staff_user_id from account_managers where org_id=$1', [org2])).staff_user_id === ops, 'admin can reassign with a reason');
  const m = (await one(`select assistant_metrics() v`)).v;
  ok(m.sessions >= 2 && 'bot_resolution_rate' in m, `metrics available (sessions ${m.sessions}, escalation rate ${m.escalation_rate}%)`);
  await as(buyer);
  await expectErr(() => db.query(`select assistant_metrics()`), 'FORBIDDEN', 'customers cannot read assistant metrics');
} finally {
  await db.query('rollback');
  await db.end();
}
console.log(failed ? `\n${failed} failed` : '\nall assistant checks passed');
process.exitCode = failed ? 1 : 0;

