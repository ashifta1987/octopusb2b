// CONN S2 · WooCommerce connection — DB checks for migration *_conn_s2_woocommerce.
// STAGING ONLY, one rolled-back transaction, acting as merchants / the service role through JWT claims (what PostgREST does).
//  0. Structure: functions with search_path=public; anon none; signed-in users only c2_connect_start; new columns.
//  1. Start: setup role only; a single-use state (only its SHA-256 stored, 30 min); store address must be https + the domain;
//     another account's store refused; Shopify refused; 20 requests per hour; audited.
//  2. Claim (service role): once; expired / used / wrong platform / malformed refused; signed-in users can't call it.
//  3. Remote webhook ids: numbers only, at most 10, cleared with an empty list.
//  4. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/conn-s2-woocommerce.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runS2Checks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    const now = Math.floor(Date.now() / 1000);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: 'password', timestamp: now }] } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const service = () => as(null, 'aal1', 'service_role');
  const err = async (q, p) => {
    await db.query('savepoint s2');
    try { await db.query(q, p); await db.query('release savepoint s2'); return ''; }
    catch (e) { await db.query('rollback to savepoint s2'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint s2r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint s2r'); return r; }
    catch (e) { await db.query('rollback to savepoint s2r'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const FNS = ['c2_connect_start', 'c2_connect_claim', 'c2_connection_set_webhooks'];

  // ── 0. structure ──
  await owner();
  const fns = await all(`select p.proname, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x,
      has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [FNS]);
  ok(fns.length === 3 && fns.every((f) => /search_path=public/.test(f.cfg ?? '') && !f.anon_x && f.svc_x), '3 new functions, search_path=public, anon none, service role all');
  ok(fns.find((f) => f.proname === 'c2_connect_start')?.auth_x === true && fns.filter((f) => f.proname !== 'c2_connect_start').every((f) => !f.auth_x),
    'signed-in users only start a connection (never claim a state or write webhook ids)');
  const cols = await all(`select table_name || '.' || column_name c from information_schema.columns where table_schema = 'public'
    and ((table_name = 'store_oauth_states' and column_name = 'store_url') or (table_name = 'store_connections' and column_name = 'remote_webhook_ids'))`);
  ok(cols.length === 2, 'store_oauth_states.store_url and store_connections.remote_webhook_ids');

  // ── fixtures ──
  const mkUser = async (tag) => {
    await owner();
    const mail = `s2-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `S2 ${tag}`, mail]);
    return id;
  };
  const mkMerchant = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S2 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = excluded.started_at`, [org]);
    return { uid, org };
  };
  await owner();
  const featBefore = (await one(`select value from site_settings where key = 'dropship_features'`))?.value ?? {};
  await db.query(`insert into site_settings (key, value, is_public) values ('dropship_features', $1::jsonb, false) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ ...(typeof featBefore === 'object' && featBefore ? featBefore : {}), stores: true, orders: true })]);
  const A = await mkMerchant('a');
  const B = await mkMerchant('b');
  const viewer = await mkUser('a-viewer');
  await owner();
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'viewer')`, [A.org, viewer]);
  const shop = `s2-${stamp}.example.com`;
  const url = `https://${shop}/store`;
  const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

  // ── 1. start ──
  await as(viewer);
  ok(/ROLE_FORBIDDEN|role/i.test(await err(`select c2_connect_start('woocommerce', $1, $2)`, [shop, url])), 'a viewer cannot start a store connection');
  await as(A.uid);
  const st = await rpc(`select c2_connect_start('woocommerce', $1, $2) r`, [shop.toUpperCase(), url]);
  ok(/^[0-9a-f]{64}$/.test(st?.state ?? '') && st.expires_in_s === 1800, 'the owner gets a single-use 64-hex state (30 minutes)');
  await owner();
  const row = await one(`select state_hash, org_id, platform, shop_domain, store_url, created_by, extract(epoch from expires_at - now()) secs, used_at from store_oauth_states where state_hash = $1`, [sha(st.state)]);
  ok(row?.org_id === A.org && row.platform === 'woocommerce' && row.shop_domain === shop && row.store_url === url && row.created_by === A.uid && Number(row.secs) > 1700 && row.used_at === null,
    'only the SHA-256 of the state is stored, with the organisation, store and expiry');
  ok(!(await one(`select 1 x from store_oauth_states where state_hash = $1`, [st.state])), 'the state itself is not stored');
  ok(Number((await one(`select count(*) n from audit_log where action = 'store_connection.connect_started' and entity_id = $1`, [A.org])).n) >= 1, 'start is audited');
  await as(A.uid);
  ok(/INVALID_INPUT/.test(await err(`select c2_connect_start('woocommerce', 'not a domain', 'https://x.com')`)), 'a bad domain is refused');
  ok(/INVALID_INPUT/.test(await err(`select c2_connect_start('woocommerce', $1, $2)`, [shop, `http://${shop}`])), 'the store address must be https');
  ok(/INVALID_INPUT/.test(await err(`select c2_connect_start('woocommerce', $1, 'https://evil.example.com')`, [shop])), 'the store address must be on the same domain');
  ok(/NOT_SUPPORTED/.test(await err(`select c2_connect_start('shopify', 'x.myshopify.com', 'https://x.myshopify.com')`)), 'Shopify does not connect this way');
  await owner();
  await db.query(`insert into store_connections (org_id, platform, shop_domain, store_url, status, connected_at) values ($1, 'woocommerce', $2, $3, 'active', now())`, [B.org, `b-${shop}`, `https://b-${shop}`]);
  await as(A.uid);
  ok(/ALREADY_LINKED/.test(await err(`select c2_connect_start('woocommerce', $1, $2)`, [`b-${shop}`, `https://b-${shop}`])), 'another account\'s store → ALREADY_LINKED');
  await owner();
  await db.query(`insert into store_oauth_states (state_hash, org_id, platform, shop_domain, created_at) select md5(g::text || $2) || md5($2 || g::text), $1, 'woocommerce', 'x.com', now() from generate_series(1, 20) g`, [A.org, stamp]);
  await as(A.uid);
  ok(/RATE_LIMITED/.test(await err(`select c2_connect_start('woocommerce', $1, $2)`, [shop, url])), 'more than 20 requests in an hour → RATE_LIMITED');

  // ── 2. claim ──
  await as(A.uid);
  ok(/permission denied/.test(await err(`select c2_connect_claim('woocommerce', $1)`, [st.state])), 'a signed-in user cannot claim a state');
  await service();
  ok(/INVALID_STATE/.test(await err(`select c2_connect_claim('magento', $1)`, [st.state])), 'a state of another platform is refused');
  const cl = await rpc(`select c2_connect_claim('woocommerce', $1) r`, [st.state]);
  ok(cl?.org_id === A.org && cl.shop_domain === shop && cl.store_url === url && cl.created_by === A.uid, 'the key callback trades the state for the organisation and store');
  ok(/INVALID_STATE/.test(await err(`select c2_connect_claim('woocommerce', $1)`, [st.state])), 'a state works once');
  ok(/INVALID_STATE/.test(await err(`select c2_connect_claim('woocommerce', 'nope')`)), 'a malformed state is refused');
  await owner();
  await db.query(`delete from store_oauth_states where org_id = $1 and shop_domain = 'x.com'`, [A.org]);
  await as(A.uid);
  const st2 = await rpc(`select c2_connect_start('woocommerce', $1, $2) r`, [shop, url]);
  await owner();
  await db.query(`update store_oauth_states set expires_at = now() - interval '1 minute' where state_hash = $1`, [sha(st2.state)]);
  await service();
  ok(/INVALID_STATE/.test(await err(`select c2_connect_claim('woocommerce', $1)`, [st2.state])), 'an expired state is refused');

  // ── 3. webhook ids ──
  await owner();
  const conn = (await one(`insert into store_connections (org_id, platform, shop_domain, store_url, status) values ($1, 'woocommerce', $2, $3, 'connecting') returning id`, [A.org, shop, url])).id;
  await service();
  await rpc(`select c2_connection_set_webhooks($1, array['11','12','13']) r`, [conn]);
  await owner();
  ok(JSON.stringify((await one(`select remote_webhook_ids from store_connections where id = $1`, [conn])).remote_webhook_ids) === '["11","12","13"]', 'webhook ids stored');
  await service();
  ok(/check constraint/.test(await err(`select c2_connection_set_webhooks($1, array['1; drop'])`, [conn])), 'webhook ids are numbers only');
  await rpc(`select c2_connection_set_webhooks($1, array[]::text[]) r`, [conn]);
  await owner();
  ok((await one(`select remote_webhook_ids from store_connections where id = $1`, [conn])).remote_webhook_ids === null, 'an empty list clears them');
  await service();
  ok(/NOT_FOUND/.test(await err(`select c2_connection_set_webhooks(gen_random_uuid(), array['1'])`)), 'unknown connection → NOT_FOUND');
  await as(A.uid);
  ok(/permission denied/.test(await err(`select c2_connection_set_webhooks($1, array['1'])`, [conn])), 'merchants cannot write webhook ids');

  // ── 4. round trip (staging; the PGlite harness does its own) ──
  if (ctx.staging) {
    await owner();
    const snapSchema = async () => JSON.stringify((await db.query(`
      select 'fn' k, p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') x from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
      union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
      union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
      union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
      union all select 'trg', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'cron.%'
      union all select 'rel', c.relname || ':' || coalesce(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')
      order by 1, 2`)).rows);
    await db.query('savepoint s2rt');
    try {
      await ctx.unwindLater(db);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      ok(Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [FNS])).n) === 0, 'down: every S2 function is gone');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint s2rt');
    }
  }
  return failed;
}

// ───────── staging runner ─────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { config } = await import('dotenv');
  const pg = (await import('pg')).default;
  config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
  if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
    console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
    process.exit(1);
  }
  const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_conn_s2_woocommerce.sql'));
  if (!MIG) { console.error('✘ S2 migration file not found'); process.exit(1); }
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
    failed = await runS2Checks(db, {
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
  console.log(failed ? `\nconn-s2-woocommerce: ${failed} check(s) failed` : '\nconn-s2-woocommerce: all passed');
  process.exitCode = failed ? 1 : 0;
}
