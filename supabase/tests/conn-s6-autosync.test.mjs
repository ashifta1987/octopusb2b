// CONN S6 · Step 11 auto-sync engine — DB checks for migration *_conn_s6_autosync.
// STAGING ONLY, one rolled-back transaction, acting as staff / merchants / the service role through JWT claims.
//  0. Structure; schedule. 1. FX feed. 2. Reprice by rules (exchange rate / landed up: ask, alert / below minimum → approval);
//  approval → re-push with the approved price. 3. Supplier loses verification → paused → out of stock for stores; back.
//  4. The hourly run (throttled per merchant) and the staff status. 5. (staging) round trip.
// Run: node supabase/tests/conn-s6-autosync.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runS6Checks(db, ctx) {
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
  const service = () => as(null, 'aal1', 'service_role');
  const err = async (q, p) => {
    await db.query('savepoint s6');
    try { await db.query(q, p); await db.query('release savepoint s6'); return ''; }
    catch (e) { await db.query('rollback to savepoint s6'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint s6r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint s6r'); return r; }
    catch (e) { await db.query('rollback to savepoint s6r'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const FNS = ['c6_fx_record', 'c6_repush', 'c6_reprice_org', 'c6_engine_run', 'c6_engine_status', 'c6_supplier_verification', 'job_fx_ecb'];

  // ── 0. structure ──
  await owner();
  const fns = await all(`select p.proname, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [FNS]);
  ok(fns.length === FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '') && !f.anon_x), `${FNS.length} functions, search_path=public, anon none`);
  ok(fns.filter((f) => f.auth_x).map((f) => f.proname).join() === 'c6_engine_status', 'signed-in users only read the engine status (checked inside); the engine runs as the service role');
  ok(Boolean(await one(`select 1 x from information_schema.columns where table_name = 'dropship_pricing_rules' and column_name = 'engine_checked_at'`)), 'dropship_pricing_rules.engine_checked_at');
  ok(Boolean(await one(`select 1 x from pg_trigger where tgname = 'trg_c6_supplier_verification'`)), 'supplier verification trigger installed');
  if (ctx.staging) {
    const jobs = await all(`select jobname, schedule from cron.job where jobname in ('octopus-dropship-sync', 'octopus-fx-ecb') order by 1`);
    ok(jobs.length === 2, 'pg_cron: hourly engine and weekday FX feed');
  }

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `s6-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `S6 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const admin = await mkUser('admin', 'admin');
  const muid = await mkUser('merchant');
  await owner();
  const featBefore = (await one(`select value from site_settings where key = 'dropship_features'`))?.value ?? {};
  await db.query(`insert into site_settings (key, value, is_public) values ('dropship_features', $1::jsonb, false) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ ...(typeof featBefore === 'object' && featBefore ? featBefore : {}), stores: true, orders: true, pricing: true, pushed: true, import_list: true })]);
  const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S6 ${stamp}`])).id;
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, muid]);
  await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = excluded.started_at`, [org]);
  const conn = (await one(`insert into store_connections (org_id, platform, shop_domain, store_url, status, connected_at, shop_currency) values ($1, 'woocommerce', $2, $3, 'active', now(), 'USD') returning id`, [org, `s6-${stamp}.example.com`, `https://s6-${stamp}.example.com`])).id;
  const bands = JSON.stringify([{ from_cents: 0, to_cents: null, multiplier_milli: 2000, fixed_cents: 0 }]);
  const cands = await all(`select v.id, v.product_id, v.model_no from dropship_variants v join dropship_products p on p.id = v.product_id where p.status = 'active' and public.ds_product_visible(p, $1) order by v.model_no limit 15`, [org]);
  let V = null; let st = null; let link = null;
  for (const c of cands) {
    for (const ctry of ['AE', 'SA', 'GB', 'US']) {
      await db.query(`insert into dropship_markets (org_id, country) values ($1, $2) on conflict do nothing`, [org, ctry]);
      await db.query(`insert into dropship_pricing_rules (org_id, bands, rounding, min_profit_bp, store_currency, fx_threshold_bp, main_market, when_landed_up, when_landed_down, when_out_of_stock, check_every_hours)
        values ($1, $2::jsonb, 'none', 0, 'USD', 0, $3, 'reprice', 'keep', 'draft', 1) on conflict (org_id) do update set main_market = excluded.main_market, bands = excluded.bands`, [org, bands, ctry]);
      if (!link) link = (await one(`insert into dropship_product_links (org_id, store_connection_id, product_id, product_gid, status, store_status) values ($1, $2, $3, 'woocommerce:product:501', 'linked', 'active') returning id`, [org, conn, c.product_id])).id;
      else await db.query(`update dropship_product_links set product_id = $2 where id = $1`, [link, c.product_id]);
      st = (await one(`select ds_listing_state($1, $2, true) s`, [org, c.product_id])).s;
      const sv = st?.variants?.find((x) => x.variant_id === c.id);
      if (sv?.price_minor && sv.landed_usd_cents && sv.include) { V = { ...c, sv }; break; }
    }
    if (V) break;
  }
  ok(Boolean(V), `fixture: a linked variant the rules price (${V?.model_no ?? 'none'} → ${V?.sv?.price_minor ?? '-'} US cents)`);
  if (!V) return failed;
  await db.query(`insert into dropship_variant_links (product_link_id, org_id, variant_id, variant_gid, store_sku, price_minor, currency, stock_label) values ($1, $2, $3, 'woocommerce:variation:31', 'MY-SKU', $4, 'USD', 'in_stock')`,
    [link, org, V.id, V.sv.price_minor - 100]);
  const mkDoneJob = async (landed, syncPrice = true) => {
    const b = (await one(`insert into dropship_push_batches (org_id, store_connection_id, kind, request_key) values ($1, $2, 'push', $3) returning id`, [org, conn, crypto.randomUUID()])).id;
    return (await one(`insert into dropship_push_jobs (batch_id, org_id, store_connection_id, product_id, kind, status, payload, pricing, finished_at)
      values ($1, $2, $3, $4, 'push', 'done', $5::jsonb, $6::jsonb, clock_timestamp()) returning id`, [b, org, conn, V.product_id,
      JSON.stringify({ status: 'ACTIVE', currency: 'USD', product_gid: 'woocommerce:product:501', sync: { stock: true, price: syncPrice }, variants: st.variants.filter((x) => x.include).map((x) => ({ variant_id: x.variant_id, model_no: x.model_no, sku: 'MY-SKU', options: x.options ?? {}, price_minor: V.sv.price_minor - 100, compare_at_minor: null, stock_status: x.stock_status })) }),
      JSON.stringify({ variants: st.variants.filter((x) => x.include).map((x) => ({ variant_id: x.variant_id, landed_usd_cents: landed, profit_bp: 1000 })) })])).id;
  };
  const openJob = async () => one(`select id, payload from dropship_push_jobs where store_connection_id = $1 and product_id = $2 and status = 'queued' order by created_at desc limit 1`, [conn, V.product_id]);
  const cancelOpen = () => db.query(`update dropship_push_jobs set status = 'cancelled' where store_connection_id = $1 and product_id = $2 and status in ('queued', 'running', 'retry_wait')`, [conn, V.product_id]);

  // ── 2a. exchange rate / price drift → reprice (threshold 0) ──
  await mkDoneJob(V.sv.landed_usd_cents);
  await as(muid);
  ok(/permission denied/.test(await err(`select c6_reprice_org($1)`, [org])), 'merchants cannot run the engine');
  await service();
  const r1 = await rpc(`select c6_reprice_org($1) r`, [org]);
  await owner();
  const j1 = await openJob();
  const jv = j1?.payload?.variants?.find((x) => x.variant_id === V.id);
  const l1 = await one(`select sync_state from dropship_product_links where id = $1`, [link]);
  const log1 = await one(`select change_text, result_text from dropship_sync_log where store_connection_id = $1 and kind = 'price' order by created_at desc limit 1`, [conn]);
  ok(r1?.repriced === 1 && Number(jv?.price_minor) === V.sv.price_minor && jv.variant_gid === 'woocommerce:variation:31' && j1.payload.product_gid === 'woocommerce:product:501',
    'a price the rules now give differently is re-pushed (a queued job with the new price and the store ids)');
  ok(l1.sync_state === 'price_updated' && log1?.change_text === 'Price updated by your rules' && /MY-SKU/.test(log1.result_text), 'the change is in the sync log and the product shows "price updated"');
  await service();
  const r1b = await rpc(`select c6_reprice_org($1) r`, [org]);
  await owner();
  ok(r1b?.repriced === 0 && Number((await one(`select count(*) n from dropship_push_jobs where store_connection_id = $1 and product_id = $2 and status = 'queued'`, [conn, V.product_id])).n) === 1,
    'never a second open job for the same product');
  await cancelOpen();
  await db.query(`update dropship_pricing_rules set fx_threshold_bp = 5000 where org_id = $1`, [org]);
  await service();
  ok((await rpc(`select c6_reprice_org($1) r`, [org]))?.repriced === 0, 'an exchange-rate change under the merchant\'s threshold is left alone');

  // ── 2b. landed up: ask → approval; approve → re-push with the approved price ──
  await owner();
  await mkDoneJob(V.sv.landed_usd_cents - 50);
  await db.query(`update dropship_pricing_rules set when_landed_up = 'ask' where org_id = $1`, [org]);
  await service();
  const r2 = await rpc(`select c6_reprice_org($1) r`, [org]);
  await owner();
  const ap = await one(`select id, reason_code, old_price_minor, new_price_minor, status from dropship_price_approvals where product_link_id = $1 and status = 'waiting'`, [link]);
  ok(r2?.asked === 1 && ap?.reason_code === 'landed_up' && Number(ap.new_price_minor) === V.sv.price_minor && (await one(`select sync_state from dropship_product_links where id = $1`, [link])).sync_state === 'needs_you',
    'landed cost up with "ask" → an approval for the merchant (product shows "needs you")');
  await service();
  ok((await rpc(`select c6_reprice_org($1) r`, [org]))?.asked === 0, 'one waiting approval per variant (no duplicates)');
  await as(muid);
  const dec = await rpc(`select ds_price_approval_decide($1, 'approve') r`, [ap.id]);
  await owner();
  const j2 = await openJob();
  ok(dec?.ok === true && Number(j2?.payload?.variants?.find((x) => x.variant_id === V.id)?.price_minor) === Number(ap.new_price_minor), 'approving re-pushes the approved price');
  ok(Boolean(await one(`select 1 x from dropship_sync_log where store_connection_id = $1 and change_text = 'Approved price change'`, [conn])), 'the approved change is in the sync log');
  await cancelOpen();

  // ── 2c. alert only; 2d. below the minimum → approval ──
  await db.query(`update dropship_price_approvals set status = 'kept_old' where product_link_id = $1`, [link]);
  await db.query(`update dropship_pricing_rules set when_landed_up = 'alert' where org_id = $1`, [org]);
  await service();
  const r3 = await rpc(`select c6_reprice_org($1) r`, [org]);
  await owner();
  ok(r3?.alerts === 1 && !(await openJob()) && Boolean(await one(`select 1 x from dropship_sync_log where store_connection_id = $1 and change_text = 'Landed cost went up'`, [conn])),
    '"alert only": a sync-log alert, the price is not changed');
  await db.query(`update dropship_pricing_rules set when_landed_up = 'reprice', min_profit_bp = 9000 where org_id = $1`, [org]);
  await service();
  const r4 = await rpc(`select c6_reprice_org($1) r`, [org]);
  await owner();
  const ap2 = await one(`select reason_code from dropship_price_approvals where product_link_id = $1 and status = 'waiting'`, [link]);
  ok(r4?.asked === 1 && ap2?.reason_code === 'below_min' && !(await openJob()), 'never below the minimum profit without approval (reason below_min)');
  await db.query(`update dropship_pricing_rules set min_profit_bp = 0 where org_id = $1`, [org]);
  await db.query(`update dropship_price_approvals set status = 'kept_old' where product_link_id = $1`, [link]);

  // a last push without "keep price in sync" → no price change
  await mkDoneJob(V.sv.landed_usd_cents - 50, false);
  await service();
  ok((await rpc(`select c6_reprice_org($1) r`, [org]))?.repriced === 0, 'keep-price-in-sync off on the last push → prices are not touched');

  // ── 1. FX feed ──
  await owner();
  await db.query(`update dropship_pricing_rules set store_currency = 'EUR' where org_id = $1`, [org]);
  await as(muid);
  ok(/permission denied/.test(await err(`select c6_fx_record('[]'::jsonb, 'x', current_date)`)), 'only the server records the FX feed');
  await service();
  const fx1 = await rpc(`select c6_fx_record($1::jsonb, 'European Central Bank reference rate', '2026-11-27') r`, [JSON.stringify([{ currency: 'EUR', rate_per_usd: 0.924855 }, { currency: 'XYZ', rate_per_usd: 2 }, { currency: 'USD', rate_per_usd: 1 }])]);
  const fx2 = await rpc(`select c6_fx_record($1::jsonb, 'European Central Bank reference rate', '2026-11-27') r`, [JSON.stringify([{ currency: 'EUR', rate_per_usd: 0.924855 }])]);
  await owner();
  const fxr = await one(`select rate_per_usd, source_name from dropship_fx_rates where currency = 'EUR' order by created_at desc limit 1`);
  ok(fx1?.inserted === 1 && fx1.skipped === 2 && fx2?.unchanged === 1 && Number(fxr.rate_per_usd) === 0.924855 && fxr.source_name === 'European Central Bank reference rate (2026-11-27)',
    'a store currency gets the ECB rate with the named source and date; unknown currencies and USD are skipped; an unchanged rate is not stored twice');
  ok(Boolean(await one(`select 1 x from dropship_sync_log where org_id = $1 and kind = 'fx'`, [org])), 'merchants pricing in that currency see it in their sync log');
  await db.query(`update dropship_pricing_rules set store_currency = 'USD' where org_id = $1`, [org]);

  // ── 3. supplier verification ──
  const sup = (await one(`insert into suppliers (code, legal_name, country, verified) values ($1, 'S6 Supplier', 'CN', true) returning id`, [`S6${stamp}`.toUpperCase().slice(0, 12)])).id;
  // the product's supplier comes through its variant (dropship_variants.supplier_product_id → supplier_products)
  const prodRow = await one(`select id from products order by created_at limit 1`);
  ok(Boolean(prodRow), 'fixture: a catalogue product to hang the supplier offer on');
  if (!prodRow) return failed;
  const sp = (await one(`insert into supplier_products (supplier_id, product_id) values ($1, $2) returning id`, [sup, prodRow.id])).id;
  await db.query(`update dropship_variants set supplier_product_id = $2 where id = $1`, [V.id, sp]);
  await db.query(`update dropship_variant_links set stock_label = 'in_stock' where product_link_id = $1`, [link]);
  await db.query(`update suppliers set verified = false where id = $1`, [sup]);
  const p1 = await one(`select needs_review, needs_review_reason from dropship_products where id = $1`, [V.product_id]);
  await service();
  const tgt = (await all(`select * from c2b_stock_targets(array['woocommerce'], 500)`)).find((x) => x.product_link_id === link);
  ok(p1.needs_review === true && p1.needs_review_reason === 'Supplier lost verification', 'supplier loses verification → its products are paused');
  ok(tgt?.label === 'out', 'and their linked store products go out of stock');
  await owner();
  await db.query(`update suppliers set verified = true where id = $1`, [sup]);
  const p2 = await one(`select needs_review from dropship_products where id = $1`, [V.product_id]);
  ok(p2.needs_review === false && Boolean(await one(`select 1 x from audit_log where action = 'ds_product.unpaused_supplier' and entity_id = $1`, [sup])), 'verified again → un-paused (audited)');

  // ── 4. hourly run + status ──
  await db.query(`update dropship_pricing_rules set engine_checked_at = null where org_id = $1`, [org]);
  await service();
  const run1 = await rpc(`select c6_engine_run() r`);
  const run2 = await rpc(`select c6_engine_run() r`);
  await owner();
  ok(Number(run1?.merchants) >= 1 && (await one(`select engine_checked_at from dropship_pricing_rules where org_id = $1`, [org])).engine_checked_at, 'the hourly run checks merchants that are due');
  ok(Number(run2?.merchants) === 0 || !(await all(`select 1 from dropship_pricing_rules where org_id = $1 and engine_checked_at < now() - interval '1 minute'`, [org])).length, 'a merchant just checked is not checked again before its interval');
  await as(muid);
  ok(/FORBIDDEN/.test(await err(`select c6_engine_status()`)), 'merchants cannot read the engine status');
  await as(admin);
  const es = await rpc(`select c6_engine_status() r`);
  ok(Boolean(es?.engine?.summary) && /sync engine/.test(es.engine.summary) && /fx-ecb/.test(es.fx?.summary ?? ''), 'staff see the last engine run and the last FX feed');

  if (ctx.staging) {
    await owner();
    const snapSchema = async () => JSON.stringify((await db.query(`
      select 'fn' k, p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') x from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
      union all select 'trg', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'cron.%'
      order by 1, 2`)).rows);
    await db.query('savepoint s6rt');
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
      await db.query('rollback to savepoint s6rt');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_conn_s6_autosync.sql'));
  if (!MIG) { console.error('✘ S6 migration file not found'); process.exit(1); }
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
    failed = await runS6Checks(db, {
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
  console.log(failed ? `\nconn-s6-autosync: ${failed} check(s) failed` : '\nconn-s6-autosync: all passed');
  process.exitCode = failed ? 1 : 0;
}
