// Account › Product sourcing — database rules (7 Nov 2026). One transaction, rolled back.
// Two throwaway customers (A owns the RFQ, B is another company) + the admin as staff:
//  · A sees the RFQ, its quote (MOQ + sample price), messages and files; B sees none of them
//  · B cannot post on A's request; staff can, and the message is flagged from_staff + emits request.message
//  · a new quote counts as new until A opens it (mark_quotes_viewed); B's call changes nothing
//  · staff picking up the RFQ emits rfq.reviewed
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (sub) => { await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2' })]); await db.query('set local role authenticated'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { const r = await db.query(sql, p); await db.query('release savepoint t'); return r; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
try {
  await db.query('begin');
  const admin = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;
  const mkUser = async (email) => (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  const a = await mkUser('src-a@example.com'); const b = await mkUser('src-b@example.com');
  const mkOrg = async (u, name) => { const o = (await one(`insert into organizations(name, country) values ($1, 'AE') returning id`, [name])).id; await db.query(`insert into org_members(org_id, user_id) values ($1, $2)`, [o, u]); return o; };
  const oa = await mkOrg(a, 'QA Sourcing A'); await mkOrg(b, 'QA Sourcing B');
  const rfq = (await one(`insert into rfqs(code, org_id, title, quantity, unit, destination_country, status, currency, created_by) values ('RFQ-QA-SRC', $1, 'QA handheld fan', 3000, 'pcs', 'AE', 'submitted', 'USD', $2) returning id`, [oa, a])).id;
  const sup = (await one(`select id from suppliers where archived_at is null order by code limit 1`)).id;

  // staff picks it up → rfq.reviewed
  await as(admin);
  await db.query(`update rfqs set status = 'assigned' where id = $1`, [rfq]);
  await owner();
  ok(!!(await one(`select 1 x from outbox_events where event_type = 'rfq.reviewed' and aggregate_id = $1`, [rfq])), 'staff picking up the request emits rfq.reviewed');

  await as(admin);
  const q = (await one(`select send_quote($1, $2, 577, 3000, 'FOB', 25, 0, 'qa', 3000, 2500) v`, [rfq, sup])).v;
  await owner();
  const qr = await one(`select moq, sample_price_cents, status from quotes where id = $1`, [q]);
  ok(qr.moq === 3000 && Number(qr.sample_price_cents) === 2500 && qr.status === 'sent', 'send_quote stores MOQ and sample price');

  // customer A
  await as(a);
  ok((await db.query(`select 1 from rfqs where id = $1`, [rfq])).rowCount === 1 && (await db.query(`select 1 from quotes where id = $1`, [q])).rowCount === 1, 'A sees the request and the quote');
  const m1 = await tryQ(`select post_request_message('rfq', $1, 'Can you do a custom logo?') v`, [rfq]);
  ok(typeof m1 !== 'string', 'A can ask a question on the request');
  const f1 = await tryQ(`select add_request_file('rfq', $1, $2, 'spec.pdf', 'spec', 1000) v`, [rfq, `rfq/${rfq}/qa-spec.pdf`]);
  ok(typeof f1 !== 'string', 'A can attach a file');
  ok(/BAD_PATH/.test(await tryQ(`select add_request_file('rfq', $1, 'rfq/other/x.pdf', 'x.pdf', 'spec', 1) v`, [rfq])), 'a file path outside the request folder is refused');
  await owner();

  // customer B
  await as(b);
  ok((await db.query(`select 1 from rfqs where id = $1`, [rfq])).rowCount === 0, 'B cannot see A’s request');
  ok((await db.query(`select 1 from quotes where rfq_id = $1`, [rfq])).rowCount === 0, 'B cannot see A’s quotes');
  ok((await db.query(`select 1 from request_messages where rfq_id = $1`, [rfq])).rowCount === 0 && (await db.query(`select 1 from request_files where rfq_id = $1`, [rfq])).rowCount === 0, 'B cannot see A’s messages or files');
  ok(/NOT_FOUND/.test(await tryQ(`select post_request_message('rfq', $1, 'hi') v`, [rfq])), 'B cannot post on A’s request');
  ok(/NOT_FOUND/.test(await tryQ(`select add_request_file('rfq', $1, $2, 'x.pdf', 'spec', 1) v`, [rfq, `rfq/${rfq}/b.pdf`])), 'B cannot attach a file to A’s request');
  ok(Number((await one(`select mark_quotes_viewed($1) v`, [rfq])).v) === 0, 'B opening the URL marks nothing');
  ok((await db.query(`select 1 from public_suppliers limit 1`)).rowCount >= 0 && (await tryQ(`select legal_name from suppliers where id = $1`, [sup])).rowCount === 0, 'customers cannot read supplier legal names (code only via public_suppliers)');
  await owner();

  // staff reply → from_staff + event for the customer
  await as(admin);
  await db.query(`select post_request_message('rfq', $1, 'Yes, logo printing adds 0.05 per piece.')`, [rfq]);
  await owner();
  const last = await one(`select from_staff from request_messages where rfq_id = $1 and body like 'Yes, logo%'`, [rfq]);
  const ev = await one(`select payload from outbox_events where event_type = 'request.message' and aggregate_id = $1 and payload->>'from_staff' = 'true'`, [rfq]);
  ok(last.from_staff === true && ev?.payload?.from_staff === true && ev.payload.org_id === oa, 'staff reply is flagged from_staff and emits request.message for the customer');

  await as(a);
  ok(Number((await one(`select mark_quotes_viewed($1) v`, [rfq])).v) === 1, 'A opening the request marks the new quote as viewed');
  await owner();
  ok((await one(`select status from quotes where id = $1`, [q])).status === 'viewed', 'quote is now viewed (badge cleared)');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from rfqs where code = 'RFQ-QA-SRC'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\naccount sourcing: ${failed} check(s) failed` : '\naccount sourcing: all passed');
process.exitCode = failed ? 1 : 0;
