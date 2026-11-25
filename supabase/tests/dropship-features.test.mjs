// Release 1 · EA-2 DB checks — migration 222. STAGING ONLY, one rolled-back transaction.
//  · dropship_features row exists (staging: every feature ON); dropship_feature_on() reads it; a missing row falls back
//    to the early-access set (live-safe).
//  · set_dropship_features(): admin only; all 17 keys must be true/false; Dashboard, Wallet and Support stay on;
//    audit-logged. Customers can read the public setting but cannot change it.
//  · public_dropship_processing_fee(): anon can call it; it returns only the two processing amounts.
// Run: node --env-file=.env.staging supabase/tests/dropship-features.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
const as = async (uid, aal = 'aal2', role = 'authenticated') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal } : { role })]);
  await db.query(`set local role ${role}`);
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};
const KEYS = ['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support',
  'stores', 'import_list', 'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'];
const EA = Object.fromEntries(KEYS.map((k, i) => [k, i < 8]));

try {
  await db.query('begin');
  const mkUser = async (tag, role = null) => {
    const email = `ea2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `EA2 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const admin = await mkUser('admin', 'admin');
  const fin = await mkUser('fin', 'finance');
  const cust = await mkUser('cust');

  const row = await one(`select value, is_public from site_settings where key = 'dropship_features'`);
  const env = (await one(`select value #>> '{}' v from site_settings where key = 'app_environment'`))?.v;
  ok(row && row.is_public === true && KEYS.every((k) => typeof row.value[k] === 'boolean') && (env !== 'staging' || KEYS.every((k) => row.value[k] === true)),
    `dropship_features exists, is public, has all 17 keys${env === 'staging' ? ' and is all ON on staging' : ''}`);

  await as(cust, 'aal1');
  const custRead = await tryq(`select value from site_settings where key = 'dropship_features'`);
  const custSet = await tryq(`select set_dropship_features($1::jsonb)`, [JSON.stringify(EA)]);
  const custWrite = await tryq(`update site_settings set value = '{}'::jsonb where key = 'dropship_features'`);
  await as(fin);
  const finSet = await tryq(`select set_dropship_features($1::jsonb)`, [JSON.stringify(EA)]);
  await owner();
  const stillAllOn = (await one(`select value from site_settings where key = 'dropship_features'`)).value;
  ok(!custRead.err && custRead.rows.length === 1 && /FORBIDDEN/.test(custSet.err ?? '') && /FORBIDDEN/.test(finSet.err ?? '') &&
    (custWrite.err || custWrite.rows.length === 0) && JSON.stringify(stillAllOn) === JSON.stringify(row.value),
    'customers read the public list but cannot change it; Finance (not admin) is refused');

  await as(admin);
  const missingKey = await tryq(`select set_dropship_features($1::jsonb)`, [JSON.stringify({ ...EA, samples: undefined })]);
  const badType = await tryq(`select set_dropship_features($1::jsonb)`, [JSON.stringify({ ...EA, orders: 'no' })]);
  const lockedOff = await tryq(`select set_dropship_features($1::jsonb)`, [JSON.stringify({ ...EA, wallet: false })]);
  const auditBefore = Number((await one(`select count(*) n from audit_log where action = 'dropship_features.updated'`)).n);
  const saved = (await one(`select set_dropship_features($1::jsonb) r`, [JSON.stringify({ ...EA, extra_key: true })])).r;
  const onOrders = (await one(`select dropship_feature_on('orders') v`)).v;
  const onFind = (await one(`select dropship_feature_on('find') v`)).v;
  const auditAfter = Number((await one(`select count(*) n from audit_log where action = 'dropship_features.updated'`)).n);
  await owner();
  ok(/INVALID_FEATURES/.test(missingKey.err ?? '') && /INVALID_FEATURES/.test(badType.err ?? '') && /always stay on/.test(lockedOff.err ?? ''),
    'invalid lists are refused: every key true/false; Dashboard, Wallet and Support always stay on');
  ok(saved.orders === false && saved.find === true && !('extra_key' in saved) && onOrders === false && onFind === true && auditAfter === auditBefore + 1,
    'an admin saves the early-access set (unknown keys dropped); dropship_feature_on() follows it; one audit row');

  await db.query(`delete from site_settings where key = 'dropship_features'`);
  const fbOrders = (await one(`select dropship_feature_on('orders') v`)).v;
  const fbReq = (await one(`select dropship_feature_on('requests') v`)).v;
  const fbUnknown = (await one(`select dropship_feature_on('nonsense') v`)).v;
  ok(fbOrders === false && fbReq === true && fbUnknown === false, 'with no row the early-access set applies (live-safe); unknown keys are off');

  await as(null, 'aal1', 'anon');
  const anonFee = await tryq(`select public_dropship_processing_fee() f`);
  await owner();
  const f = anonFee.rows[0]?.f;
  ok(!anonFee.err && (f === null || (Object.keys(f).sort().join(',') === 'extra_item_cents,first_item_cents')),
    `public_dropship_processing_fee() works for signed-out visitors and returns only the processing amounts (${JSON.stringify(f)})`);

  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\ndropship-features: ${failed} check(s) failed` : '\ndropship-features: all passed');
process.exitCode = failed ? 1 : 0;
