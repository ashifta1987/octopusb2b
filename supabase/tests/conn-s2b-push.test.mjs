// CONN S2b · Product push, stock and price for non-Shopify stores — DB checks for migration *_conn_s2b_push.
// STAGING ONLY, one rolled-back transaction, acting as signed-in users / the service role through JWT claims (what PostgREST does).
//  0. Structure: new functions service-role only; new columns; replaced functions carry their patches.
//  1. Two queues: c2b_push_claim takes WooCommerce jobs only (with the platform); ds_push_claim takes Shopify jobs only.
//  2. ds_push_complete records a WooCommerce product (link, variant links with the stock label sent, log in WooCommerce words);
//     a malformed product id is refused; unlink is logged as "out of stock in your store".
//  3. Stock targets: linked variants whose Octopus label changed, keep-in-sync on, active store only; stock_done records ok /
//     failed (label, sync log, out of stock / failed state).
//  4. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/conn-s2b-push.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runS2bChecks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, role = 'authenticated') => {
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal: 'aal1' } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const service = () => as(null, 'service_role');
  const err = async (q, p) => {
    await db.query('savepoint s2b');
    try { await db.query(q, p); await db.query('release savepoint s2b'); return ''; }
    catch (e) { await db.query('rollback to savepoint s2b'); lastErr = e.message; return e.message; }
  };
  const rows = async (q, p) => {
    await db.query('savepoint s2bq');
    try { const r = (await db.query(q, p)).rows; await db.query('release savepoint s2bq'); return r; }
    catch (e) { await db.query('rollback to savepoint s2bq'); lastErr = e.message; return []; }
  };
  const stamp = Date.now().toString(36);
  const FNS = ['c2b_push_claim', 'c2b_stock_targets', 'c2b_stock_done'];

  // ── 0. structure ──
  await owner();
  const fns = await all(`select p.proname, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x,
      has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [FNS]);
  ok(fns.length === 3 && fns.every((f) => /search_path=public/.test(f.cfg ?? '') && !f.anon_x && !f.auth_x && f.svc_x), '3 new functions, search_path=public, service role only');
  const cols = await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dropship_variant_links' and column_name in ('stock_label', 'stock_synced_at')`);
  ok(cols.length === 2, 'dropship_variant_links: stock_label, stock_synced_at');
  const d = async (sig) => (await one(`select pg_get_functiondef($1::regprocedure) d`, [sig])).d;
  ok(/c\.platform = 'shopify'/.test(await d('public.ds_push_claim(text,integer)')), 'ds_push_claim takes Shopify jobs only');
  ok(/woocommerce:product/.test(await d('public.ds_push_complete(uuid,jsonb)')), 'ds_push_complete accepts WooCommerce product ids');
  ok(/'platform', v_conn\.platform/.test(await d('public.ds_push_page(uuid[])')) && /'platform', c\.platform/.test(await d('public.ds_pushed_list()')), 'push screens are told the platform');
  ok(/c2b_stock_targets/.test(await d('public.job_connector_sync()')), 'the scheduled job also wakes for push jobs and stock changes');

  // ── fixtures ──
  const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S2b ${stamp}`])).id;
  const woo = (await one(`insert into store_connections (org_id, platform, shop_domain, store_url, status, connected_at) values ($1, 'woocommerce', $2, $3, 'active', now()) returning id`, [org, `s2b-${stamp}.example.com`, `https://s2b-${stamp}.example.com`])).id;
  const org2 = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S2b shop ${stamp}`])).id;
  const shop = (await one(`insert into store_connections (org_id, platform, shop_domain, status, connected_at) values ($1, 'shopify', $2, 'active', now()) returning id`, [org2, `s2b-${stamp}.myshopify.com`])).id;
  const pv = await one(`select v.id variant_id, v.product_id from dropship_variants v join dropship_products p on p.id = v.product_id order by v.model_no limit 1`);
  ok(Boolean(pv), 'fixture: a Dropship variant');
  if (!pv) return failed;
  const label = (await one(`select ds_variant_stock_label($1) l`, [pv.variant_id])).l;
  const mkJob = async (o, conn, payload, kind = 'push') => {
    const b = (await one(`insert into dropship_push_batches (org_id, store_connection_id, kind, request_key) values ($1, $2, $3, $4) returning id`, [o, conn, kind, crypto.randomUUID()])).id;
    return (await one(`insert into dropship_push_jobs (batch_id, org_id, store_connection_id, product_id, kind, status, payload, next_attempt_at) values ($1, $2, $3, $4, $5, 'queued', $6::jsonb, now() - interval '1 second') returning id`,
      [b, o, conn, pv.product_id, kind, JSON.stringify(payload)])).id;
  };
  const jw = await mkJob(org, woo, { status: 'DRAFT', currency: 'AED', sync: { stock: true, price: true } });
  const js = await mkJob(org2, shop, { status: 'DRAFT', currency: 'USD', sync: { stock: true, price: true } });

  // ── 1. two queues ──
  await as(crypto.randomUUID());
  ok(/permission denied/.test(await err(`select * from c2b_push_claim(array['woocommerce'], 'w', 50)`)), 'signed-in users cannot claim push jobs');
  await service();
  const cw = (await rows(`select r from c2b_push_claim(array['woocommerce'], 'test', 50) r`)).map((x) => x.r);
  const mine = cw.find((x) => x.id === jw);
  ok(mine?.platform === 'woocommerce' && mine.attempts === 1 && !cw.some((x) => x.id === js), 'c2b_push_claim takes the WooCommerce job (with its platform), never the Shopify one');
  const cs = (await rows(`select r from ds_push_claim('test', 50) r`)).map((x) => x.r);
  ok(cs.some((x) => x.id === js) && !cs.some((x) => x.id === jw), 'ds_push_claim takes the Shopify job only');
  ok((await rows(`select r from c2b_push_claim(array['shopify'], 'test', 50) r`)).length === 0, 'c2b_push_claim never takes Shopify jobs, even when asked');

  // ── 2. complete ──
  ok(/INVALID_RESULT/.test(await err(`select ds_push_complete($1, '{"product_gid": "woocommerce:product:abc"}'::jsonb)`, [jw])), 'a malformed WooCommerce product id is refused');
  const res = { product_gid: 'woocommerce:product:501', store_status: 'draft', variants: [{ variant_id: pv.variant_id, variant_gid: 'woocommerce:variation:31', inventory_item_gid: null, sku: 'MY-SKU', price_minor: 15999, compare_at_minor: null, stock_status: label }] };
  await db.query(`select ds_push_complete($1, $2::jsonb)`, [jw, JSON.stringify(res)]);
  await owner();
  const link = await one(`select id, product_gid, status, sync_state from dropship_product_links where store_connection_id = $1 and product_id = $2`, [woo, pv.product_id]);
  const vl = await one(`select variant_gid, store_sku, price_minor, stock_label, stock_synced_at from dropship_variant_links where product_link_id = $1`, [link?.id]);
  const log = await one(`select result_text from dropship_sync_log where store_connection_id = $1 and kind = 'push' order by created_at desc limit 1`, [woo]);
  ok(link?.product_gid === 'woocommerce:product:501' && link.status === 'linked' && vl?.variant_gid === 'woocommerce:variation:31' && Number(vl.price_minor) === 15999 && vl.stock_label === label && vl.stock_synced_at,
    'the WooCommerce product is linked, with its variation id, price and the stock label sent');
  ok(log?.result_text === 'Created or updated in WooCommerce as draft', 'the log names WooCommerce');

  // ── 3. stock ──
  await service();
  ok(!(await rows(`select * from c2b_stock_targets(array['woocommerce'], 500)`)).some((r) => r.product_link_id === link.id), 'no target while the store has the current label');
  await owner();
  const other = label === 'out' ? 'in_stock' : 'out';
  await db.query(`update dropship_variant_links set stock_label = $2 where product_link_id = $1`, [link.id, other]);
  await service();
  const t1 = (await rows(`select * from c2b_stock_targets(array['woocommerce'], 500)`)).find((r) => r.product_link_id === link.id);
  ok(t1?.label === label && t1.variant_gid === 'woocommerce:variation:31' && t1.product_gid === 'woocommerce:product:501' && t1.platform === 'woocommerce', 'a changed Octopus label is a target (with the store ids)');
  ok(!(await rows(`select * from c2b_stock_targets(array['magento'], 500)`)).some((r) => r.product_link_id === link.id), 'only the asked platforms');
  await owner();
  await db.query(`update dropship_push_jobs set payload = jsonb_set(payload, '{sync,stock}', 'false') where id = $1`, [jw]);
  await service();
  ok(!(await rows(`select * from c2b_stock_targets(array['woocommerce'], 500)`)).some((r) => r.product_link_id === link.id), 'keep-in-sync off for the last push → no stock updates');
  await owner();
  await db.query(`update dropship_push_jobs set payload = jsonb_set(payload, '{sync,stock}', 'true') where id = $1`, [jw]);
  await service();
  ok(/INVALID_INPUT/.test(await err(`select c2b_stock_done('{}'::jsonb)`)), 'stock_done needs a list');
  await db.query(`select c2b_stock_done($1::jsonb)`, [JSON.stringify([{ product_link_id: link.id, variant_id: pv.variant_id, label: 'in_stock', ok: false, error: 'Invalid ID.' }])]);
  await owner();
  const f1 = await one(`select sync_state, sync_message from dropship_product_links where id = $1`, [link.id]);
  ok(f1.sync_state === 'failed' && f1.sync_message === 'Invalid ID.', 'a refused stock update shows as failed with the store\'s reason');
  await service();
  const done = (await one(`select c2b_stock_done($1::jsonb) r`, [JSON.stringify([{ product_link_id: link.id, variant_id: pv.variant_id, label: 'out', ok: true }])])).r;
  await owner();
  const l2 = await one(`select l.sync_state, l.sync_message, v.stock_label from dropship_product_links l join dropship_variant_links v on v.product_link_id = l.id where l.id = $1`, [link.id]);
  const slog = await one(`select change_text, result_text from dropship_sync_log where store_connection_id = $1 and kind = 'stock' order by created_at desc limit 1`, [woo]);
  ok(done?.ok === 1 && l2.stock_label === 'out' && l2.sync_state === 'out_of_stock' && l2.sync_message === null, 'a sent label is remembered; all variants out → "out of stock"');
  ok(slog?.change_text === 'Stock updated' && /MY-SKU: out/.test(slog.result_text), 'the stock change is in the sync log');
  await owner();
  await db.query(`update store_connections set status = 'disconnected', disconnected_at = now() where id = $1`, [woo]);
  await db.query(`update dropship_variant_links set stock_label = $2 where product_link_id = $1`, [link.id, other]);
  await service();
  ok(!(await rows(`select * from c2b_stock_targets(array['woocommerce'], 500)`)).some((r) => r.product_link_id === link.id), 'a disconnected store gets no stock updates');
  await owner();
  await db.query(`update store_connections set status = 'active', disconnected_at = null where id = $1`, [woo]);

  // ── unlink wording ──
  const ju = await mkJob(org, woo, { product_gid: 'woocommerce:product:501' }, 'unlink');
  await service();
  await rows(`select r from c2b_push_claim(array['woocommerce'], 'test', 50) r`);
  await db.query(`select ds_push_complete($1, '{}'::jsonb)`, [ju]);
  await owner();
  const ulog = await one(`select result_text from dropship_sync_log where store_connection_id = $1 and kind = 'unlink' order by created_at desc limit 1`, [woo]);
  ok(ulog?.result_text === 'Set to out of stock in your store; sync stopped' && (await one(`select status from dropship_product_links where id = $1`, [link.id])).status === 'unlinked', 'unlink: logged in store words, link closed');

  // ── 4. round trip (staging; the PGlite harness does its own) ──
  if (ctx.staging) {
    const snapSchema = async () => JSON.stringify((await db.query(`
      select 'fn' k, p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') x from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
      union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
      union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
      union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
      union all select 'trg', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'cron.%'
      union all select 'rel', c.relname || ':' || coalesce(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')
      order by 1, 2`)).rows);
    await db.query('savepoint s2brt');
    try {
      await ctx.unwindLater(db);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      ok(Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [FNS])).n) === 0
        && !/woocommerce/.test(await d('public.ds_push_complete(uuid,jsonb)')), 'down: S2b functions gone; replaced functions are the previous ones again');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint s2brt');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_conn_s2b_push.sql'));
  if (!MIG) { console.error('✘ S2b migration file not found'); process.exit(1); }
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
    failed = await runS2bChecks(db, {
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
  console.log(failed ? `\nconn-s2b-push: ${failed} check(s) failed` : '\nconn-s2b-push: all passed');
  process.exitCode = failed ? 1 : 0;
}
