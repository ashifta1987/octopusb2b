// Migration 202 (20 Nov 2026): short bank transfers — a customer reason from a list + a staff-only internal note.
//  · amount differs → a customer reason is required (Bank charges / Exchange rate difference / Partial payment / Other +
//    short text, max 80); "Other" needs its text; an unknown reason is refused
//  · the customer can read the reason (received_reason, received_reason_text) but never the internal note
//  · the receipt carries the customer label ("Bank charges"), never the internal note
//  · same amount → no reason is kept
//  · existing transfers: their note stays internal, no customer reason
//  · 202 down → up gives identical results
// One transaction, rolled back. STAGING ONLY. Run: node supabase/tests/transfer-reason.test.mjs
import pg from 'pg'; import fs from 'node:fs';
import { loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
loadStagingEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const now = Math.floor(Date.now() / 1000);
const as = async (sub) => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] })]);
  await db.query('set local role authenticated');
};
const owner = () => db.query('reset role');
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [] }; } };
const user = async (email) => (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
const has202 = !!(await one(`select 1 x from information_schema.columns where table_name = 'wallet_topups' and column_name = 'received_reason'`));
console.log(has202 ? '(migration 202 applied)' : '(migration 202 NOT applied: the new checks are expected to fail)');

async function scenario(label) {
  const fin = await user(`t202-fin-${label}@example.com`), cust = await user(`t202-c-${label}@example.com`);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'finance')`, [fin]);
  const org = (await one(`insert into organizations(name, country) values ('T202 ' || $1, 'AE') returning id`, [label])).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  await as(cust);
  const submit = async (cents, slip) => (await one(`select submit_bank_transfer($1, $2) v`, [cents, `${org}/${slip}`])).v;
  const t1 = await submit(100000, 's1.pdf'), t2 = await submit(50000, 's2.pdf'), t3 = await submit(20000, 's3.pdf'), t4 = await submit(30000, 's4.pdf');
  await as(fin);
  const r = {};
  r.noReason = (await tryq(`select confirm_bank_transfer($1, 99500, 'SCB-1', 'fee deducted by SCB')`, [t1])).err ?? '';
  r.badReason = (await tryq(`select confirm_bank_transfer($1, 99500, 'SCB-1', null, 'typo')`, [t1])).err ?? '';
  r.otherNoText = (await tryq(`select confirm_bank_transfer($1, 99500, 'SCB-1', null, 'other')`, [t1])).err ?? '';
  r.otherLong = (await tryq(`select confirm_bank_transfer($1, 99500, 'SCB-1', null, 'other', repeat('x', 81))`, [t1])).err ?? '';
  r.ok1 = (await tryq(`select confirm_bank_transfer($1, 99500, 'SCB-1', 'fee deducted by SCB, ticket 4411', 'bank_charges')`, [t1])).err;
  r.ok2 = (await tryq(`select confirm_bank_transfer($1, 49000, 'SCB-2', null, 'other', 'Sender paid in two parts')`, [t2])).err;
  r.ok3 = (await tryq(`select confirm_bank_transfer($1, 20000, 'SCB-3', 'checked twice', 'bank_charges')`, [t3])).err;
  await owner();
  const row = async (id) => one(`select to_jsonb(t) j from wallet_topups t where id = $1`, [id]);
  r.row1 = (await row(t1)).j; r.row2 = (await row(t2)).j; r.row3 = (await row(t3)).j;
  r.receipt1 = (await one(`select data from documents where id = ($1::jsonb ->> 'receipt_id')::uuid`, [JSON.stringify(r.row1)]))?.data ?? null;
  await as(cust);
  r.custReason = await tryq(`select amount_cents, amount_received_cents, received_reason, received_reason_text from wallet_topups where id = $1`, [t1]);
  r.custNote = await tryq(`select received_note from wallet_topups where id = $1`, [t1]);
  r.custReceipt = await tryq(`select data from documents where id = ($1::jsonb ->> 'receipt_id')::uuid`, [JSON.stringify(r.row1)]);
  await owner();
  // a transfer confirmed the old way (before 202): its note stays internal, no customer reason
  await db.query(`update wallet_topups set status = 'credited', amount_received_cents = 29000, received_note = 'legacy note: bank charges' where id = $1`, [t4]);
  r.legacy = (await row(t4)).j;
  return r;
}

try {
  await db.query('begin');
  const a = await scenario('a');
  ok(/DIFFERENCE_REASON_REQUIRED/.test(a.noReason), 'amount differs + only an internal note → refused (a customer reason is required)');
  ok(/INVALID_REASON/.test(a.badReason), 'an unknown reason is refused');
  ok(/REASON_TEXT_REQUIRED/.test(a.otherNoText), '"Other" needs its short text');
  ok(/REASON_TEXT_TOO_LONG/.test(a.otherLong), '"Other" text longer than 80 characters is refused');
  ok(a.ok1 === null && a.row1.received_reason === 'bank_charges' && a.row1.received_note === 'fee deducted by SCB, ticket 4411', 'Bank charges + internal note are saved separately');
  ok(a.ok2 === null && a.row2.received_reason === 'other' && a.row2.received_reason_text === 'Sender paid in two parts', '"Other" keeps its short text');
  ok(a.ok3 === null && a.row3.received_reason == null && a.row3.received_note === 'checked twice', 'same amount → no customer reason kept (internal note still saved)');
  ok(a.receipt1?.difference_reason === 'Bank charges' && !JSON.stringify(a.receipt1).includes('ticket 4411'), 'the receipt shows "Bank charges", never the internal note');
  const legal = (await one(`select legal_name from company_profile where id = 1`))?.legal_name;
  ok(!!legal && a.receipt1?.issuer === legal, `the receipt issuer is the legal company (${a.receipt1?.issuer})`);
  ok(!a.custReason.err && a.custReason.rows[0]?.received_reason === 'bank_charges', 'the customer can read the reason of their own transfer');
  ok(/permission denied/.test(a.custNote.err ?? ''), 'the customer cannot read the internal note (direct API: permission denied)');
  ok(!a.custReceipt.err && !JSON.stringify(a.custReceipt.rows).includes('ticket 4411'), 'the customer receipt data has no internal note');
  ok(a.legacy.received_reason == null && a.legacy.received_note === 'legacy note: bank charges', 'an older transfer keeps its note as internal, with no customer reason');
  ok((await one(`select transfer_reason_label('exchange_rate', null) a, transfer_reason_label('partial_payment', null) b, transfer_reason_label('other', '  Two parts ') c`).catch(() => ({})))?.c === 'Two parts',
    'labels: Exchange rate difference / Partial payment / Other → its text');
  await db.query('rollback');

  // ── 202 down → up: identical results ──
  if (has202) {
    await db.query('begin');
    await db.query(fs.readFileSync('supabase/migrations/down/20261101000202_transfer_difference_reason.down.sql', 'utf8'));
    const gone = await one(`select (select count(*) from information_schema.columns where table_name = 'wallet_topups' and column_name in ('received_reason', 'received_reason_text')) c,
      to_regprocedure('confirm_bank_transfer(uuid,bigint,text,text)') old4, to_regprocedure('confirm_bank_transfer(uuid,bigint,text,text,text,text)') new6`);
    ok(Number(gone.c) === 0 && gone.old4 && !gone.new6, 'down: reason columns removed, the 198 version is back');
    await db.query(fs.readFileSync('supabase/migrations/20261101000202_transfer_difference_reason.sql', 'utf8'));
    const b = await scenario('b');
    const strip = (r) => JSON.stringify({ ...r, row1: pick(r.row1), row2: pick(r.row2), row3: pick(r.row3), legacy: pick(r.legacy), receipt1: r.receipt1?.difference_reason, custReason: r.custReason.rows.map((x) => x.received_reason), custNote: !!r.custNote.err, custReceipt: r.custReceipt.rows.length });
    const pick = (j) => j && ({ status: j.status, received: j.amount_received_cents, reason: j.received_reason, text: j.received_reason_text, note: j.received_note });
    ok(strip(a) === strip(b), 'up again: identical results');
    await db.query('rollback');
  } else ok(false, 'down → up (needs migration 202)');
} catch (e) {
  console.error(e); failed++;
  await db.query('rollback').catch(() => {});
} finally {
  await db.end();
}
console.log(failed ? `\ntransfer reason: ${failed} check(s) failed` : '\ntransfer reason: all passed');
process.exit(failed ? 1 : 0);
