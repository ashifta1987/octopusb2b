// CONN S3 · Key-paste connectors (Magento 2 & PrestaShop) — DB checks for migration *_conn_s3_keypaste.
// STAGING ONLY, one rolled-back transaction, acting as merchants / staff / service role through JWT claims.
//  0. Structure: c2_connect_start search_path=public, anon none, authenticated + service_role execute.
//  1. Start: c2_connect_start accepts magento, prestashop and woocommerce; refuses shopify / opencart / wix; enforces
//     setup role, domain/https check, ALREADY_LINKED across accounts, PLAN_LIMIT and 20/hr rate limit; SHA-256 only; audited.
//  2. Key-paste commit flow (after server testKey): c2_connect_claim (service role, once, platform-bound) →
//     c1_connection_upsert → store_credentials sealed (access_token / api_key) → active → c1_pull_targets returns both.
//  3. Orders & tracking tasks: ds_order_intake (magento & prestashop) → wh_orders shipped → c1_wh_order_shipped queues
//     send_tracking (waiting_store) → c1_task_claim → c1_task_done.
//  4. Multi-tenant RLS + disconnect: merchant B cannot see A's connections or read store_credentials; disconnect wipes keys.
//  5. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/conn-s3-keypaste.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runS3Checks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    const now = Math.floor(Date.now() / 1000);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }] } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const service = () => as(null, 'aal1', 'service_role');
  const err = async (q, p) => {
    await db.query('savepoint s3');
    try { await db.query(q, p); await db.query('release savepoint s3'); return ''; }
    catch (e) { await db.query('rollback to savepoint s3'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint s3r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint s3r'); return r; }
    catch (e) { await db.query('rollback to savepoint s3r'); lastErr = e.message; return { __error: e.message }; }
  };
  const rows = async (q, p) => {
    await db.query('savepoint s3q');
    try { const r = (await db.query(q, p)).rows; await db.query('release savepoint s3q'); return r; }
    catch (e) { await db.query('rollback to savepoint s3q'); lastErr = e.message; return []; }
  };
  const stamp = Date.now().toString(36);
  const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
  const fakeSealed = (v = 1) => `v${v}.${crypto.randomBytes(12).toString('base64url')}.${crypto.randomBytes(16).toString('base64url')}.${crypto.randomBytes(24).toString('base64url')}`;

  // ── 0. structure ──
  await owner();
  const fn = await one(`select p.proname, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x,
      has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'c2_connect_start'`);
  ok(Boolean(fn) && /search_path=public/.test(fn?.cfg ?? '') && !fn.anon_x && fn.auth_x && fn.svc_x, 'c2_connect_start: search_path=public, anon none, authenticated + service_role');

  // ── fixtures ──
  const mkUser = async (tag) => {
    await owner();
    const mail = `s3-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `S3 ${tag}`, mail]);
    return id;
  };
  const mkMerchant = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S3 ${tag} ${stamp}`])).id;
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

  const mgShop = `mg-${stamp}.example.com`;
  const mgUrl = `https://${mgShop}`;
  const psShop = `ps-${stamp}.example.com`;
  const psUrl = `https://${psShop}/shop`;

  // ── 1. c2_connect_start ──
  await as(viewer);
  ok(/ROLE_FORBIDDEN|role/i.test(await err(`select c2_connect_start('magento', $1, $2)`, [mgShop, mgUrl])), 'viewer cannot start Magento connection');
  await as(A.uid);
  for (const bad of ['shopify', 'opencart', 'wix']) {
    ok(/NOT_SUPPORTED/.test(await err(`select c2_connect_start($1, $2, $3)`, [bad, mgShop, mgUrl])), `${bad} is refused by c2_connect_start`);
  }
  const stMg = await rpc(`select c2_connect_start('magento', $1, $2) r`, [mgShop.toUpperCase(), mgUrl]);
  const stPs = await rpc(`select c2_connect_start('prestashop', $1, $2) r`, [psShop, psUrl]);
  const stWc = await rpc(`select c2_connect_start('woocommerce', $1, $2) r`, [`wc-${stamp}.example.com`, `https://wc-${stamp}.example.com`]);
  ok(/^[0-9a-f]{64}$/.test(stMg?.state ?? '') && /^[0-9a-f]{64}$/.test(stPs?.state ?? '') && /^[0-9a-f]{64}$/.test(stWc?.state ?? ''),
    'c2_connect_start accepts magento, prestashop and woocommerce (64-hex state)');
  await owner();
  const stRow = await one(`select platform, shop_domain, store_url, state_hash from store_oauth_states where state_hash = $1`, [sha(stMg.state)]);
  ok(stRow?.platform === 'magento' && stRow.shop_domain === mgShop && stRow.store_url === mgUrl, 'state stored hashed with lower-cased shop_domain and url');
  ok(Number((await one(`select count(*) n from audit_log where action = 'store_connection.connect_started' and entity_id = $1`, [A.org])).n) >= 3, 'connect_started audited');

  // ── 2. claim → upsert → seal → active → pull targets ──
  await service();
  ok(/INVALID_STATE/.test(await err(`select c2_connect_claim('prestashop', $1)`, [stMg.state])), 'Magento state cannot be claimed as PrestaShop');
  const clMg = await rpc(`select c2_connect_claim('magento', $1) r`, [stMg.state]);
  const clPs = await rpc(`select c2_connect_claim('prestashop', $1) r`, [stPs.state]);
  ok(clMg?.org_id === A.org && clMg.shop_domain === mgShop && clPs?.org_id === A.org && clPs.store_url === psUrl, 'claim returns org + store for both platforms');
  ok(/INVALID_STATE/.test(await err(`select c2_connect_claim('magento', $1)`, [stMg.state])), 'state works once');

  const connMg = await rpc(`select c1_connection_upsert($1, 'magento', $2, $3, null, 'eur', null, array['Magento_Sales::sales']) r`, [A.org, mgShop, mgUrl]);
  const connPs = await rpc(`select c1_connection_upsert($1, 'prestashop', $2, $3, null, 'gbp', null, array['orders:read']) r`, [A.org, psShop, psUrl]);
  ok(typeof connMg === 'string' && typeof connPs === 'string', 'connections created for Magento and PrestaShop');
  await owner();
  await db.query(`insert into store_credentials (connection_id, kind, ciphertext, key_version) values ($1, 'access_token', $2, 1)`, [connMg, fakeSealed(1)]);
  await db.query(`insert into store_credentials (connection_id, kind, ciphertext, key_version) values ($1, 'api_key', $2, 1)`, [connPs, fakeSealed(1)]);
  await service();
  await rpc(`select c1_connection_set_status($1, 'active', null) r`, [connMg]);
  await rpc(`select c1_connection_set_status($1, 'active', null) r`, [connPs]);
  await rpc(`select c1_connection_record_sync($1, 'test', true, 'Connected. Store currency EUR.') r`, [connMg]);
  await rpc(`select c1_connection_record_sync($1, 'test', true, 'Connected. Shop currency GBP.') r`, [connPs]);
  await owner();
  await db.query(`update store_connections set last_sync_at = now() - interval '55 minutes' where id in ($1, $2)`, [connMg, connPs]);
  await service();

  const targets = await rows(`select * from c1_pull_targets(array['magento', 'prestashop'], 50)`);
  ok(targets.some((t) => t.id === connMg && t.platform === 'magento') && targets.some((t) => t.id === connPs && t.platform === 'prestashop'),
    'c1_pull_targets picks up active Magento and PrestaShop connections');

  // another account cannot start or upsert the same store
  await as(B.uid);
  ok(/ALREADY_LINKED/.test(await err(`select c2_connect_start('magento', $1, $2)`, [mgShop, mgUrl])), 'another account cannot connect an already-linked Magento store');
  ok(/ALREADY_LINKED/.test(await err(`select c2_connect_start('prestashop', $1, $2)`, [psShop, psUrl])), 'another account cannot connect an already-linked PrestaShop store');

  // ── 3. orders & tracking task ──
  await owner();
  const soMg = (await one(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency, fx_rate_to_usd, shipping_method)
    values ($1, 'magento', $2, '#100001', 'Ann Buyer', '{"line1":"1 Way","city":"Dubai"}'::jsonb, 'AE', 'EUR', 1.08, 'standard') returning id, order_number`, [A.org, `MG-${stamp}`]));
  const soPs = (await one(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency, fx_rate_to_usd, shipping_method)
    values ($1, 'prestashop', $2, 'XKBFR', 'Bob Buyer', '{"line1":"2 Way","city":"London"}'::jsonb, 'GB', 'GBP', 1.27, 'standard') returning id, order_number`, [A.org, `PS-${stamp}`]));
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'S3 carton', 100) returning id`, [`S3B${stamp}`.toUpperCase().slice(0, 20)])).id;
  for (const [so, tok] of [[soMg, 'm'], [soPs, 'p']]) {
    const wh = await one(`insert into wh_orders (warehouse_code, source, org_id, store_order_id, ship_name, ship_address, ship_country, status, picked_at, packed_at, box_id, expected_weight_g, tolerance_g, measured_weight_g)
      values ('FS-01', 'dropship', null, $1, 'Buyer', '{"line1":"1 Way","city":"Dubai"}'::jsonb, 'AE', 'packed', now(), now(), $2, 500, 50, 500) returning id`, [so.id, box]);
    await db.query(`update wh_orders set status = 'shipped', shipped_at = now(), tracking_token = $2 where id = $1`, [wh.id, sha(`${tok}${stamp}`).slice(0, 32)]);
  }
  await service();
  const claimed = await rows(`select * from c1_task_claim(200)`);
  const mgTask = claimed.find((t) => t.store_order_id === soMg.id && t.action === 'send_tracking');
  const psTask = claimed.find((t) => t.store_order_id === soPs.id && t.action === 'send_tracking');
  ok(mgTask?.store_connection_id === connMg && psTask?.store_connection_id === connPs,
    'shipping orders from Magento and PrestaShop queues send_tracking tasks for their connections');
  await rpc(`select c1_task_done($1, true, null) r`, [mgTask.id]);
  await rpc(`select c1_task_done($1, true, null) r`, [psTask.id]);

  // ── 4. RLS isolation & disconnect wipe ──
  await as(B.uid);
  const bConns = await rows(`select id from store_connections where id in ($1, $2)`, [connMg, connPs]);
  ok(bConns.length === 0, 'RLS: merchant B cannot read merchant A store_connections');
  ok(/permission denied/.test(await err(`select id from store_credentials`)), 'RLS: merchants cannot read store_credentials');
  ok(/NOT_FOUND/.test(await err(`select c1_connection_disconnect($1, 'steal')`, [connMg])), 'merchant B cannot disconnect merchant A store');
  await as(A.uid);
  ok(/permission denied/.test(await err(`select id from store_credentials`)), 'RLS: even the owning merchant cannot read store_credentials');
  await rpc(`select c1_connection_disconnect($1, 'Done') r`, [connMg]);
  await rpc(`select c1_connection_disconnect($1, 'Done') r`, [connPs]);
  await owner();
  const credsLeft = Number((await one(`select count(*) n from store_credentials where connection_id in ($1, $2)`, [connMg, connPs])).n);
  ok(credsLeft === 0, 'disconnecting Magento and PrestaShop wipes their sealed credentials');

  // ── 5. round trip (staging; PGlite harness does its own) ──
  if (ctx.staging) {
    await owner();
    const snapSchema = async () => JSON.stringify((await db.query(`
      select 'fn' k, p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') x from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
      union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
      order by 1, 2`)).rows);
    await db.query('savepoint s3rt');
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
      ok((await snapSchema()) === without, 'down again: identical schema (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint s3rt');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_conn_s3_keypaste.sql'));
  if (!MIG) { console.error('✘ S3 migration file not found'); process.exit(1); }
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
    failed = await runS3Checks(db, {
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
  console.log(failed ? `\nconn-s3-keypaste: ${failed} check(s) failed` : '\nconn-s3-keypaste: all passed');
  process.exitCode = failed ? 1 : 0;
}
