// Divisions step 5a (migration 198): invoice / credit-note / proforma numbering. STAGING ONLY.
//  · formats: OCT-[div]-[year]-[000001] (one sequence shared by all divisions), CN-[div]-[year]-[000001], PF-[year]-[000001]
//  · the year restarts on 1 January Asia/Shanghai (16:00 UTC on 31 December)
//  · gap-free: a rolled-back transaction gives its number back; 12 concurrent issuers (every third rolls back) end with
//    1..N committed, no gap, no duplicate
//  · the real issuing paths: an order invoice (system_transition_order) and a credit note (decide_finance_approval),
//    linked to its invoice; a credit note without an invoice is refused
//  · documents already issued keep their numbers; 198 down → up identical
// Uses test years 2097–2099 for the counter tests and removes those counter rows afterwards.
// Run: node supabase/tests/document-numbering.test.mjs
import pg from 'pg'; import fs from 'node:fs';
import { loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
loadStagingEnvOrExit();
const connect = async () => { const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); return c; };
const db = await connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p, c = db) => (await c.query(q, p)).rows[0];
let inTx = false;
const tryq = async (q, p) => {
  if (!inTx) { try { return { err: null, rows: (await db.query(q, p)).rows }; } catch (e) { return { err: e.message, rows: [] }; } }
  await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [] }; }
};
const cleanup = () => db.query(`delete from document_counters where year between 2097 and 2100`);
const div = async (code) => (await one(`select id from divisions where code = $1`, [code])).id;

try {
  await cleanup();
  const existingBefore = (await db.query(`select id, number from documents order by id`)).rows;
  const DS = await div('DS'), MMB = await div('MMB');

  // ── formats + one shared invoice sequence ──
  const n1 = (await one(`select next_document_number('invoice', $1, '2098-03-01') n`, [DS])).n;
  const n2 = (await one(`select next_document_number('invoice', $1, '2098-03-01') n`, [MMB])).n;
  const c1 = (await one(`select next_document_number('credit_note', $1, '2098-03-01') n`, [MMB])).n;
  const p1 = (await one(`select next_document_number('proforma', null, '2098-03-01') n`)).n;
  ok(n1 === 'OCT-DS-2098-000001' && n2 === 'OCT-MMB-2098-000002', `invoices share one sequence across divisions (${n1}, ${n2})`);
  ok(c1 === 'CN-MMB-2098-000001', `credit notes have their own sequence (${c1})`);
  ok(p1 === 'PF-2098-000001', `proforma: PF-[year]-[seq] (${p1})`);
  ok(/DOCUMENT_NEEDS_DIVISION/.test((await tryq(`select next_document_number('invoice', null, '2098-03-01')`)).err ?? ''), 'an invoice without a division is refused');

  // ── 1 January, Asia/Shanghai ──
  const late = (await one(`select next_document_number('invoice', $1, '2098-12-31 15:59:59+00') n`, [DS])).n;
  const newYear = (await one(`select next_document_number('invoice', $1, '2098-12-31 16:00:00+00') n`, [DS])).n;
  ok(late === 'OCT-DS-2098-000003', `31 Dec 23:59:59 Shanghai is still 2098 (${late})`);
  ok(newYear === 'OCT-DS-2099-000001', `1 Jan 00:00 Shanghai starts 2099 at 000001 (${newYear})`);

  // ── a rolled-back transaction gives its number back ──
  const t = await connect();
  await t.query('begin');
  const lost = (await one(`select next_document_number('invoice', $1, '2097-06-01') n`, [DS], t)).n;
  await t.query('rollback'); await t.end();
  const again = (await one(`select next_document_number('invoice', $1, '2097-06-01') n`, [DS])).n;
  ok(lost === 'OCT-DS-2097-000001' && again === 'OCT-DS-2097-000001', `rollback: the number is reused, no gap (${lost} → rolled back → ${again})`);

  // ── concurrent issuers, some roll back ──
  const N = 12;
  const clients = await Promise.all(Array.from({ length: N }, connect));
  const results = await Promise.all(clients.map(async (c, i) => {
    await c.query('begin');
    const n = (await one(`select next_document_number('invoice', $1, '2097-06-01') n`, [i % 2 ? MMB : DS], c)).n;
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 120)));
    const commit = i % 3 !== 2;
    await c.query(commit ? 'commit' : 'rollback');
    await c.end();
    return { n, commit };
  }));
  const committed = results.filter((r) => r.commit).map((r) => Number(r.n.slice(-6))).sort((a, b) => a - b);
  // 000001 was committed above ("again"), so the concurrent ones must be exactly 2..(1 + committed)
  const expected = Array.from({ length: committed.length }, (_, k) => k + 2);
  ok(JSON.stringify(committed) === JSON.stringify(expected), `${N} concurrent issuers, ${N - committed.length} rolled back: committed numbers ${committed.join(',')} — no gap, no duplicate`);
  const last = await one(`select last_value from document_counters where series = 'OCT' and year = 2097`);
  ok(Number(last.last_value) === 1 + committed.length, `counter = last committed number (${last.last_value})`);
  await cleanup();

  // ── the real issuing paths (one rolled-back transaction) ──
  await db.query('begin'); inTx = true;
  const year = (await one(`select extract(year from now() at time zone 'Asia/Shanghai')::int y`)).y;
  const before = await one(`select coalesce((select last_value from document_counters where series = 'OCT' and year = $1), 0) oct, coalesce((select last_value from document_counters where series = 'CN' and year = $1), 0) cn`, [year]);
  const ord = await one(`select o.id, d.code from orders o join divisions d on d.id = o.division_id where o.code = 'TEST-ORD-MMB'`);
  await db.query(`update orders set status = 'qc', paid_cents = 0 where id = $1`, [ord.id]);
  const tr = await tryq(`select system_transition_order($1, 'balance_pending', 'numbering test')`, [ord.id]);
  ok(!tr.err, `order invoice issued through system_transition_order${tr.err ? ' — ' + tr.err : ''}`);
  const inv = await one(`select id, number, division_id from documents where order_id = $1 and doc_type = 'commercial_invoice' order by created_at desc limit 1`, [ord.id]);
  ok(inv?.number === `OCT-${ord.code}-${year}-${String(Number(before.oct) + 1).padStart(6, '0')}`, `invoice number ${inv?.number} (division ${ord.code}, ${year}, next in the shared sequence)`);
  ok(/CREDIT_NOTE|check constraint/.test((await tryq(`insert into documents(org_id, doc_type, number, order_id, amount_cents, currency, status) select org_id, 'credit_note', 'CN-X', id, 1, 'USD', 'issued' from orders where id = $1`, [ord.id])).err ?? ''), 'a credit note without its invoice is refused');
  // credit note through the finance approval (maker ≠ checker, fresh 2FA)
  const mk = async (email, role) => {
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, email, email]);
    await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const maker = await mk('num-maker@example.com', 'finance'), checker = await mk('num-checker@example.com', 'admin');
  const fa = (await one(`insert into finance_approvals(kind, org_id, order_id, amount_cents, currency, reason, status, requested_by) select 'credit_note', org_id, id, 500, currency, 'Numbering test', 'requested', $2 from orders where id = $1 returning id`, [ord.id, maker])).id;
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: checker, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]);
  await db.query('set local role authenticated');
  const dec = await tryq(`select decide_finance_approval($1, true, 'ok')`, [fa]);
  await db.query('reset role');
  ok(!dec.err, `credit note approved through decide_finance_approval${dec.err ? ' — ' + dec.err : ''}`);
  const cn = await one(`select number, original_document_id, data->>'original_invoice' oi from documents where order_id = $1 and doc_type = 'credit_note' order by created_at desc limit 1`, [ord.id]);
  ok(cn?.number === `CN-${ord.code}-${year}-${String(Number(before.cn) + 1).padStart(6, '0')}` && cn.original_document_id === inv.id && cn.oi === inv.number, `credit note ${cn?.number} linked to ${cn?.oi}`);
  await db.query('rollback'); inTx = false;
  const after = await one(`select coalesce((select last_value from document_counters where series = 'OCT' and year = $1), 0) oct`, [year]);
  ok(Number(after.oct) === Number(before.oct), `the rolled-back invoice left the ${year} counter where it was (${after.oct})`);

  // ── documents already issued keep their numbers ──
  const existingAfter = (await db.query(`select id, number from documents order by id`)).rows;
  ok(JSON.stringify(existingAfter) === JSON.stringify(existingBefore), `existing documents unchanged (${existingBefore.length}, e.g. ${existingBefore.map((d) => d.number).slice(0, 3).join(', ')})`);

  // ── down → up identical ──
  await db.query('begin');
  const snap = async () => JSON.stringify((await db.query(`select p.oid::regprocedure::text f, md5(p.prosrc) s, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)).rows);
  const up = await snap();
  // migrations applied after 198 that re-create its functions (202 confirm_bank_transfer, …) are taken down first
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000198_document_numbering.sql');
  await unwind(db, later);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000198_document_numbering.down.sql', 'utf8'));
  const down = await snap();
  ok(!down.includes('next_document_number'), 'down: numbering removed, old functions back');
  await db.query(fs.readFileSync('supabase/migrations/20261101000198_document_numbering.sql', 'utf8'));
  await reapply(db, later);
  ok((await snap()) === up, 'up again: identical functions');
  await db.query('rollback');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
  await db.query('rollback').catch(() => {});
} finally {
  await cleanup();
  ok(!(await db.query(`select 1 from document_counters where year between 2097 and 2100`)).rowCount && !(await db.query(`select 1 from auth.users where email like 'num-%@example.com'`)).rowCount, 'test counters and users removed');
  await db.end();
}
console.log(failed ? `\ndocument numbering: ${failed} check(s) failed` : '\ndocument numbering: all passed');
process.exitCode = failed ? 1 : 0;
