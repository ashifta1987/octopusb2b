// CONN S5 · Connector + carrier health — DB checks for migration *_conn_s5_health.
// STAGING ONLY, one rolled-back transaction, acting as staff / merchants through JWT claims (what PostgREST does).
// Run: node supabase/tests/conn-s5-health.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runS5Checks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal2', role = 'authenticated') => {
    await db.query('reset role');
    const now = Math.floor(Date.now() / 1000);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }] } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const err = async (q, p) => {
    await db.query('savepoint s5');
    try { await db.query(q, p); await db.query('release savepoint s5'); return ''; }
    catch (e) { await db.query('rollback to savepoint s5'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint s5r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint s5r'); return r; }
    catch (e) { await db.query('rollback to savepoint s5r'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const FNS = ['c5_health_connectors', 'c5_connection_retry_check', 'c5_notify_merchant', 'c5_carrier_error_record'];

  await owner();
  const fns = await all(`select p.proname, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [FNS]);
  ok(fns.length === 4 && fns.every((f) => /search_path=public/.test(f.cfg ?? '') && !f.anon_x && f.auth_x), '4 functions, search_path=public, staff call them (checked inside), anon none');

  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `s5-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `S5 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const admin = await mkUser('admin', 'admin');
  const merchant = await mkUser('merchant');
  const packer = await mkUser('packer', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'packer')`, [packer]);
  await owner();
  const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S5 ${stamp}`])).id;
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, merchant]);
  const conn = async (shop, status, extra = '') => (await one(`insert into store_connections (org_id, platform, shop_domain, status${extra ? ', last_error, last_error_at' : ''}, created_at)
    values ($1, 'woocommerce', $2, $3${extra ? ", $4, now()" : ''}, now() - interval '2 hours') returning id`, extra ? [org, shop, status, extra] : [org, shop, status])).id;
  const cBad = await conn(`a-${stamp}.example.com`, 'needs_reconnect', 'The store refused our keys.');
  const cStuck = await conn(`b-${stamp}.example.com`, 'connecting');
  const cErr = await conn(`c-${stamp}.example.com`, 'active', 'The store did not answer.');
  const cOk = await conn(`d-${stamp}.example.com`, 'active');
  await db.query(`update store_connections set last_sync_at = now() where id = $1`, [cOk]);
  const so = (await one(`insert into store_orders (org_id, channel, external_order_id, buyer_name, shipping_address, destination_country, buyer_currency, shipping_method)
    values ($1, 'woocommerce', $2, 'B', '{}'::jsonb, 'AE', 'USD', 'standard') returning id, order_number`, [org, `S5-${stamp}`]));
  const task = (await one(`insert into dropship_channel_tasks (store_order_id, org_id, channel, action, status, detail, store_connection_id, attempts, last_error) values ($1, $2, 'woocommerce', 'send_tracking', 'failed', '{}'::jsonb, $3, 8, 'HTTP 500') returning id`, [so.id, org, cErr])).id;
  const acc = (await one(`insert into wh_carrier_accounts (warehouse_code, carrier, name, mode) values ('FS-01', '4px', $1, 'sandbox') returning id`, [`S5 acc ${stamp}`])).id;

  // carrier error record
  await as(packer);
  await rpc(`select c5_carrier_error_record($1, $2) r`, [acc, '4PX refused: weight too high\nfor service']);
  const outsider = await mkUser('outsider');
  await as(outsider);
  ok(/NOT_FOUND/.test(await err(`select c5_carrier_error_record($1, 'x')`, [acc])), 'someone who does not work at the warehouse cannot log carrier errors');
  await owner();
  const lg = await one(`select status, summary from integration_logs where endpoint = $1 order by created_at desc limit 1`, [`carrier_account:${acc}`]);
  ok(lg?.status === 502 && lg.summary === `4px label refused (S5 acc ${stamp}): 4PX refused: weight too high for service`, 'a refused label is logged for System health (one line, no key)');

  // health page
  await as(merchant);
  ok(/FORBIDDEN/.test(await err(`select c5_health_connectors()`)), 'merchants cannot read System health');
  await as(admin);
  const h = await rpc(`select c5_health_connectors() r`);
  const ids = (h?.connections ?? []).map((c) => c.id);
  ok(h?.can_edit === true && ids.includes(cBad) && ids.includes(cStuck) && ids.includes(cErr) && !ids.includes(cOk), 'connections in error: needs reconnect, stuck connecting > 1 h, active with a newer error — not healthy ones');
  ok(h.connections.find((c) => c.id === cBad)?.merchant === `TEST – S5 ${stamp}` && h.connections.find((c) => c.id === cStuck)?.last_error === null, 'with the merchant name and the problem');
  const t = (h.failed_tasks ?? []).find((x) => x.id === task);
  ok(t?.order_number === so.order_number && t.attempts === 8 && t.last_error === 'HTTP 500' && t.action === 'send_tracking', 'failed store updates are listed with tries and the last error');
  const ca = (h.carriers ?? []).find((x) => x.id === acc);
  ok(Number(ca?.failures_24h) === 1 && /weight too high/.test(ca.last_error ?? ''), 'carrier accounts with failures in 24 h and the last carrier error');

  // retry check + notify
  await as(merchant);
  ok(/FORBIDDEN/.test(await err(`select c5_connection_retry_check($1)`, [cBad])), 'merchants cannot use staff Retry');
  ok(/FORBIDDEN/.test(await err(`select c5_notify_merchant($1)`, [cBad])), 'merchants cannot use Contact merchant');
  await as(admin);
  const rc = await rpc(`select c5_connection_retry_check($1) r`, [cBad]);
  ok(rc?.platform === 'woocommerce' && rc.status === 'needs_reconnect', 'staff Retry is allowed for an editor / admin (the server re-tests with the sealed keys)');
  await owner();
  ok(Boolean(await one(`select 1 x from audit_log where action = 'store_connection.retry_requested' and entity_id = $1`, [cBad])), 'Retry is audited');
  await db.query(`update store_connections set status = 'disconnected', disconnected_at = now() where id = $1`, [cStuck]);
  await as(admin);
  ok(/DISCONNECTED/.test(await err(`select c5_connection_retry_check($1)`, [cStuck])), 'a store the merchant disconnected is not retried');
  ok(/NOT_FOUND/.test(await err(`select c5_notify_merchant($1)`, [cStuck])), 'and its merchant is not contacted about it');
  const n = await rpc(`select c5_notify_merchant($1) r`, [cErr]);
  await owner();
  ok(n?.ok === true && Boolean(await one(`select 1 x from audit_log where action = 'ds_health.notify_merchant' and entity_id = $1`, [cErr])), 'Contact merchant works for any connection with a problem (audited)');

  if (ctx.staging) {
    await owner();
    const snapSchema = async () => JSON.stringify((await db.query(`
      select 'fn' k, p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') x from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
      union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
      order by 1, 2`)).rows);
    await db.query('savepoint s5rt');
    try {
      await ctx.unwindLater(db);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint s5rt');
    }
  }
  return failed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { config } = await import('dotenv');
  const pg = (await import('pg')).default;
  config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
  if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
    console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
    process.exit(1);
  }
  const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_conn_s5_health.sql'));
  if (!MIG) { console.error('✘ S5 migration file not found'); process.exit(1); }
  const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
  const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await assertStagingDatabase(db);
  const { appliedAfter, unwind, reapply, MAX_UNWIND } = await import('./lib-later-migrations.mjs');
  let later = [];
  let failed = 0;
  try {
    await db.query('begin');
    failed = await runS5Checks(db, {
      UP, DOWN, MIG, staging: true,
      unwindLater: async (c) => { later = await appliedAfter(c, MIG); await unwind(c, later, MAX_UNWIND); },
      reapplyLater: async (c) => { await reapply(c, later); },
    });
  } catch (e) {
    console.log('✘ unexpected error: ' + e.message);
    failed++;
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
  console.log(failed ? `\nconn-s5-health: ${failed} check(s) failed` : '\nconn-s5-health: all passed');
  process.exitCode = failed ? 1 : 0;
}
