// CONN S4 · Carrier layer completion — DB checks for migration *_conn_s4_carriers.
// STAGING ONLY, one rolled-back transaction, acting as staff through JWT claims (what PostgREST does).
//  0. Structure: new columns; new functions (signed-in staff only, checked inside); the old 9-argument service save is replaced.
//  1. Magnets: services take magnets unless switched off; the service check refuses magnets on a service that does not take them;
//     the service save keeps / sets the flag; the board shows it.
//  2. Test connection: only a warehouse admin records it; account shows the result; integration_logs + audit, never a key.
//  3. Commercial invoice: dispatch roles only; white-label shipper = the seller's approved brand for Dropship (refused without);
//     declared value / items from the locked snapshot; domestic and voided labels refused; audited.
//  4. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/conn-s4-carriers.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runS4Checks(db, ctx) {
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
    await db.query('savepoint s4');
    try { await db.query(q, p); await db.query('release savepoint s4'); return ''; }
    catch (e) { await db.query('rollback to savepoint s4'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint s4r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint s4r'); return r; }
    catch (e) { await db.query('rollback to savepoint s4r'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);

  // ── 0. structure ──
  await owner();
  const cols = await all(`select table_name || '.' || column_name c from information_schema.columns where table_schema = 'public'
    and ((table_name = 'wh_carrier_services' and column_name = 'accepts_magnet') or (table_name = 'wh_carrier_accounts' and column_name in ('last_check_at', 'last_check_ok', 'last_check_message')))`);
  ok(cols.length === 4, 'wh_carrier_services.accepts_magnet; wh_carrier_accounts.last_check_at / _ok / _message');
  const fns = await all(`select p.oid::regprocedure::text sig, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('c4_carrier_check_record', 'c4_commercial_invoice', 'wh_save_carrier_service')`);
  ok(fns.length === 3 && fns.every((f) => /search_path=public/.test(f.cfg ?? '') && !f.anon_x && f.auth_x), 'check / invoice / service save: search_path=public, staff call them (checked inside), anon none');
  const saves = fns.filter((f) => f.sig.startsWith('wh_save_carrier_service(')).map((f) => f.sig.replace(/ /g, ''));
  ok(saves.length === 1 && saves[0] === 'wh_save_carrier_service(uuid,uuid,text,text,text,integer,boolean,boolean,boolean,boolean)',
    'the service save takes the magnet flag (old signature replaced, not overloaded)');

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `s4-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `S4 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const admin = await mkUser('admin', 'admin');
  const packer = await mkUser('packer', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'packer')`, [packer]);
  await owner();
  const acc = (await one(`insert into wh_carrier_accounts (warehouse_code, carrier, name, mode) values ('FS-01', '4px', $1, 'sandbox') returning id`, [`S4 acc ${stamp}`])).id;
  const svc = (await one(`insert into wh_carrier_services (account_id, warehouse_code, code, name, level) values ($1, 'FS-01', $2, 'S4 standard', 'standard') returning id, accepts_magnet`, [acc, `S4${stamp}`.toUpperCase().slice(0, 20)]));

  // ── 1. magnets ──
  ok(svc.accepts_magnet === true, 'a service takes magnets unless switched off (keeps today\'s behaviour)');
  const sp = async () => (await one(`select wh_service_problem($1, array['magnet'], 100) r`, [svc.id])).r;
  ok(!(await sp()) || !/magnet/.test(await sp()), 'magnets pass on a service that takes them');
  await as(admin);
  const saved = await rpc(`select wh_save_carrier_service($1, $2, $3, 'S4 standard', 'standard', null, false, false, true, false) r`, [acc, svc.id, `S4${stamp}`.toUpperCase().slice(0, 20)]);
  await owner();
  ok(saved === svc.id && (await one(`select accepts_magnet from wh_carrier_services where id = $1`, [svc.id])).accepts_magnet === false, 'a warehouse admin switches magnets off on the service');
  ok(/does not take magnets/.test((await sp()) ?? ''), 'the service check refuses magnets on that service');
  await as(admin);
  await rpc(`select wh_save_carrier_service($1, $2, $3, 'S4 standard', 'standard', null, false, false, true) r`, [acc, svc.id, `S4${stamp}`.toUpperCase().slice(0, 20)]);
  await owner();
  ok((await one(`select accepts_magnet from wh_carrier_services where id = $1`, [svc.id])).accepts_magnet === false, 'saving without the flag keeps it');
  const aud = await one(`select details from audit_log where action = 'wh_carrier.service_updated' and entity_id = $1 order by created_at desc limit 1`, [acc]);
  ok(aud?.details?.magnet === false, 'the change is audited with the magnet flag');
  await as(packer);
  ok(/FORBIDDEN/.test(await err(`select wh_save_carrier_service($1, $2, $3, 'x', 'standard', null, false, false, true, true)`, [acc, svc.id, 'X1'])), 'a packer cannot change services');

  // ── 2. test connection ──
  await as(packer);
  ok(/FORBIDDEN/.test(await err(`select c4_carrier_check_record($1, true, 'ok')`, [acc])), 'only a warehouse admin records a connection test');
  await as(admin);
  const chk = await rpc(`select c4_carrier_check_record($1, false, $2) r`, [acc, '4PX refused: invalid sign\nline 2']);
  await owner();
  const a1 = await one(`select last_check_at, last_check_ok, last_check_message from wh_carrier_accounts where id = $1`, [acc]);
  const lg = await one(`select integration_code, status, summary from integration_logs where endpoint = $1 order by created_at desc limit 1`, [`carrier_account:${acc}`]);
  ok(chk?.ok === false && a1.last_check_ok === false && a1.last_check_at && a1.last_check_message === '4PX refused: invalid sign line 2', 'the result is kept on the account (one line)');
  ok(lg?.integration_code === '4px' && lg.status === 502 && /invalid sign/.test(lg.summary), 'and logged for System health (carrier failures)');
  ok(Boolean(await one(`select 1 x from audit_log where action = 'wh_carrier.account_checked' and entity_id = $1`, [acc])), 'and audited');
  await as(admin);
  const board = await rpc(`select wh_carriers_board('FS-01') r`);
  const ba = board?.stations?.[0]?.accounts?.find((x) => x.id === acc);
  ok(ba?.last_check_ok === false && ba.services?.[0]?.accepts_magnet === false, 'the carriers board shows the last test and the magnet flag');

  // ── 3. commercial invoice ──
  await owner();
  const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S4 ${stamp}`])).id;
  const so = (await one(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency, shipping_method)
      values ($1, 'csv', $2, '#S4-1', 'Test Buyer', '{"line1":"1 Way","city":"Berlin"}'::jsonb, 'DE', 'USD', 'standard') returning id`, [org, `S4-${stamp}`])).id;
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'S4 carton', 100) returning id`, [`S4B${stamp}`.toUpperCase().slice(0, 20)])).id;
  const o = await one(`insert into wh_orders (warehouse_code, source, store_order_id, ship_name, ship_phone, ship_address, ship_country, status, picked_at, packed_at, box_id, expected_weight_g, tolerance_g, measured_weight_g)
    values ('FS-01', 'dropship', $1, 'Test Buyer', '+4930000000', '{"line1":"1 Way","city":"Berlin","postcode":"10115"}'::jsonb, 'DE', 'packed', now(), now(), $2, 500, 50, 500) returning id, code`, [so, box]);
  // one label per parcel: each test label gets its own parcel
  const mkShip = async (tag, status = 'labelled') => {
    const parcel = (await one(`insert into wh_parcels (order_id, warehouse_code, seq, status, source, box_id, expected_weight_g, tolerance_g, measured_weight_g, battery_mark, closed_at)
      values ($1, 'FS-01', $3, 'closed', 'multi', $2, 500, 50, 500, false, now()) returning id`, [o.id, box, Number(tag)])).id;
    return (await one(`insert into wh_shipments (order_id, parcel_id, warehouse_code, account_id, service_id, carrier, service_code, service_name, tracking_no, label_path, sandbox, status, weight_g, voided_at, void_reason)
    values ($1, $2, 'FS-01', $3, $4, '4px', 'S4', 'S4 standard', $5, 'x.pdf', true, $6, 500, case when $6 = 'voided' then now() end, case when $6 = 'voided' then 'test' end) returning id, code`,
    [o.id, parcel, acc, svc.id, `SBXPX${String(Date.now()).slice(-8)}${tag}`, status]));
  };
  const sh = await mkShip('1');
  const snap = { incoterm: 'DAP', items: [{ sku: 'DS-000001-01', description_en: 'Desk lamp', hs_code: '9405110000', qty: 2, unit_value_cents: 2500, value_cents: 5000, origin_country: 'CN', unit_weight_g: 200, battery: false, liquid: false, magnet: false }], policy: { shipping_in_declared_value: false } };
  await db.query(`insert into wh_shipment_customs (shipment_id, scope, store_order_id, declared_usd_cents, duty_type, snapshot) values ($1, 'dropship', $2, 5000, 'DAP', $3::jsonb)`, [sh.id, so, JSON.stringify(snap)]);
  await as(null, 'aal1', 'anon');
  ok(/permission denied/.test(await err(`select c4_commercial_invoice($1)`, [sh.id])), 'anon cannot read a commercial invoice');
  await as(packer);
  ok(/BRAND_NOT_APPROVED/.test(await err(`select c4_commercial_invoice($1)`, [sh.id])), 'Dropship parcel without an approved seller brand → refused (white-label, like the label)');
  await owner();
  await db.query(`insert into dropship_seller_profiles (org_id, brand_name, return_name, return_line1, return_city, return_country, status) values ($1, 'Lumen & Co', 'Returns', '5 Brand St', 'Dubai', 'AE', 'approved')
    on conflict (org_id) do update set brand_name = excluded.brand_name, status = 'approved'`, [org]);
  await as(packer);
  const ci = await rpc(`select c4_commercial_invoice($1) r`, [sh.id]);
  ok(ci?.number === `CI-${sh.code}` && ci.exporter?.name === 'Lumen & Co' && ci.exporter.country === 'AE' && !/octopus/i.test(JSON.stringify(ci.exporter)), 'the shipper is the seller\'s approved brand and return address (never Octopus / a supplier)');
  ok(ci.declared_usd_cents === 5000 && ci.duty_type === 'DAP' && ci.items?.[0]?.hs_code === '9405110000' && ci.consignee?.name === 'Test Buyer' && ci.reference === '#S4-1',
    'declared value, duty terms, items and consignee come from the locked customs snapshot and the order');
  await owner();
  ok(Boolean(await one(`select 1 x from audit_log where action = 'wh_label.commercial_invoice' and entity_id = $1`, [sh.id])), 'printing is audited');
  const sh2 = await mkShip('2');
  await db.query(`insert into wh_shipment_customs (shipment_id, scope, snapshot) values ($1, 'domestic', '{}'::jsonb)`, [sh2.id]);
  const sh3 = await mkShip('3', 'voided');
  await as(packer);
  ok(/NOT_NEEDED/.test(await err(`select c4_commercial_invoice($1)`, [sh2.id])), 'a domestic parcel needs no commercial invoice');
  ok(/VOIDED/.test(await err(`select c4_commercial_invoice($1)`, [sh3.id])), 'a voided label has none');
  const outsider = await mkUser('outsider');
  await as(outsider);
  ok(/NOT_FOUND/.test(await err(`select c4_commercial_invoice($1)`, [sh.id])), 'someone who does not work at the warehouse gets NOT_FOUND');

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
    await db.query('savepoint s4rt');
    try {
      await ctx.unwindLater(db);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      ok(Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'c4\\_%'`)).n) === 0, 'down: S4 functions gone, the old service save is back');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint s4rt');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_conn_s4_carriers.sql'));
  if (!MIG) { console.error('✘ S4 migration file not found'); process.exit(1); }
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
    failed = await runS4Checks(db, {
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
  console.log(failed ? `\nconn-s4-carriers: ${failed} check(s) failed` : '\nconn-s4-carriers: all passed');
  process.exitCode = failed ? 1 : 0;
}
