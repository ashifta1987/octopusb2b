// CONN S1 · Connector runtime — DB checks for migration *_conn_s1_runtime.
// STAGING ONLY, one rolled-back transaction, acting as staff / merchants / the service role through JWT claims (what PostgREST does).
//  0. Structure: functions with search_path=public; anon executes none; signed-in users only disconnect + task retry; task columns,
//     widened CHECKs, the ship trigger, the inbox link.
//  1. Connection lifecycle: upsert (verified connect only; another account's store → ALREADY_LINKED; Shopify refused), status, sync log.
//  2. Store tasks follow the connection: waiting_store with an ACTIVE connection, not_needed without (Shopify unchanged).
//  3. Warehouse OS ships a Dropship order → send_tracking task (tracking token, wh order code); the merchant's "send tracking" off → none.
//  4. Task executor: claim (locks for 10 min), done ok / back-off, failed after 8 tries + audit, staff retry (merchants refused).
//  5. Webhook inbox: dedupe on platform + event id, bad signature kept without payload, claim / done, attempts cap.
//  6. Disconnect: merchant setup role on its own store only; keys wiped; open tasks closed; Shopify only from its app; audit.
//  7. Order catch-up targets; the scheduled job makes no call without work; audits.
//  8. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/conn-s1-runtime.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runS1Checks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    const now = Math.floor(Date.now() / 1000);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }] } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const service = () => as(null, 'aal1', 'service_role');
  const err = async (q, p) => {
    await db.query('savepoint s1');
    try { await db.query(q, p); await db.query('release savepoint s1'); return ''; }
    catch (e) { await db.query('rollback to savepoint s1'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint s1r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint s1r'); return r; }
    catch (e) { await db.query('rollback to savepoint s1r'); lastErr = e.message; return { __error: e.message }; }
  };
  const rows = async (q, p) => {
    await db.query('savepoint s1q');
    try { const r = (await db.query(q, p)).rows; await db.query('release savepoint s1q'); return r; }
    catch (e) { await db.query('rollback to savepoint s1q'); lastErr = e.message; return []; }
  };
  const stamp = Date.now().toString(36);
  const SERVICE_FNS = ['c1_active_connection', 'c1_wh_order_shipped', 'c1_connection_upsert', 'c1_connection_set_status', 'c1_connection_record_sync',
    'c1_webhook_receive', 'c1_webhook_claim', 'c1_webhook_done', 'c1_task_claim', 'c1_task_done', 'c1_pull_targets', 'job_connector_sync'];
  const USER_FNS = ['c1_connection_disconnect', 'c1_task_retry'];
  const fakeSealed = (v = 1) => `v${v}.${crypto.randomBytes(12).toString('base64url')}.${crypto.randomBytes(16).toString('base64url')}.${crypto.randomBytes(24).toString('base64url')}`;

  // ── 0. structure ──
  await owner();
  const fns = await all(`select p.proname, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x,
      has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...SERVICE_FNS, ...USER_FNS]]);
  ok(fns.length === SERVICE_FNS.length + USER_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), `${SERVICE_FNS.length + USER_FNS.length} new functions, search_path=public on every one`);
  ok(fns.every((f) => !f.anon_x) && fns.every((f) => f.svc_x), 'anon executes none of them; the service role executes all');
  ok(fns.filter((f) => USER_FNS.includes(f.proname)).every((f) => f.auth_x) && fns.filter((f) => SERVICE_FNS.includes(f.proname)).every((f) => !f.auth_x),
    'signed-in users execute only disconnect and task retry (never upsert, inbox, task claim, the trigger function or the job)');
  const tcols = await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dropship_channel_tasks' and column_name in ('store_connection_id', 'attempts', 'next_attempt_at', 'last_error')`);
  const icol = await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'webhook_inbox' and column_name = 'store_connection_id'`);
  ok(tcols.length === 4 && icol.length === 1, 'store tasks: store_connection_id, attempts, next_attempt_at, last_error; webhook_inbox.store_connection_id');
  const chk = await all(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.dropship_channel_tasks'::regclass and conname in ('dropship_channel_tasks_action_check', 'dropship_channel_tasks_status_check')`);
  ok(chk.some((c) => /send_tracking/.test(c.d)) && chk.some((c) => /'failed'/.test(c.d)), 'task CHECKs widened: action send_tracking, status failed');
  ok(Boolean(await one(`select 1 x from pg_trigger where tgname = 'trg_c1_wh_order_shipped' and tgrelid = 'public.wh_orders'::regclass`)), 'ship trigger installed on wh_orders');
  if (ctx.staging) {
    const job = await one(`select schedule, command from cron.job where jobname = 'octopus-connector-sync'`);
    ok(job?.schedule === '*/5 * * * *' && /job_connector_sync/.test(job.command), 'pg_cron: octopus-connector-sync every 5 minutes');
  }

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `s1-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `S1 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkMerchant = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – S1 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = excluded.started_at`, [org]);
    return { uid, org };
  };
  await owner();
  const featBefore = (await one(`select value from site_settings where key = 'dropship_features'`))?.value ?? {};
  await db.query(`insert into site_settings (key, value, is_public) values ('dropship_features', $1::jsonb, false) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ ...(typeof featBefore === 'object' && featBefore ? featBefore : {}), stores: true, orders: true })]);
  const admin = await mkUser('admin', 'admin');
  const A = await mkMerchant('a');
  const B = await mkMerchant('b');
  const viewer = await mkUser('a-viewer');
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'viewer')`, [A.org, viewer]);
  const mkSo = async (org, channel, tag) => (await one(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency, shipping_method)
      values ($1, $2, $3, $4, 'Test Buyer', '{"line1":"1 Way","city":"Dubai"}'::jsonb, 'AE', 'USD', 'standard') returning id, order_number`, [org, channel, `S1-${tag}-${stamp}`, `#${tag}`]));
  const shopA = `a-${stamp}.example.com`;

  // ── 1. connection lifecycle ──
  await as(A.uid);
  ok(/permission denied/.test(await err(`select c1_connection_upsert($1, 'woocommerce', $2, null, null, null, null, null)`, [A.org, shopA])), 'a signed-in user cannot create a connection (only the server after a verified connect)');
  await service();
  const connA = await rpc(`select c1_connection_upsert($1, 'woocommerce', $2, $3, 'Shop A', 'aed', '42', array['read_write']) r`, [A.org, ` ${shopA.toUpperCase()} `, `https://${shopA}`]);
  ok(typeof connA === 'string', 'service role: verified connect creates the connection');
  await owner();
  const c1 = await one(`select status, shop_domain, shop_currency, detected_platform, external_store_id from store_connections where id = $1`, [connA]);
  ok(c1?.status === 'connecting' && c1.shop_domain === shopA && c1.shop_currency === 'AED' && c1.detected_platform === 'woocommerce' && c1.external_store_id === '42',
    'it starts "connecting", domain lower-cased, currency upper-cased');
  await service();
  const again = await rpc(`select c1_connection_upsert($1, 'woocommerce', $2, null, null, null, null, null) r`, [A.org, shopA]);
  ok(again === connA, 'connecting the same store again re-authorises the same row (no duplicate)');
  ok(/ALREADY_LINKED/.test(await err(`select c1_connection_upsert($1, 'woocommerce', $2, null, null, null, null, null)`, [B.org, shopA])), 'another account linking the same store → ALREADY_LINKED');
  ok(/NOT_SUPPORTED/.test(await err(`select c1_connection_upsert($1, 'shopify', 'x.myshopify.com', null, null, null, null, null)`, [A.org])), 'Shopify is refused here (its own app, Step 5)');
  ok(/INVALID_INPUT/.test(await err(`select c1_connection_upsert($1, 'myspace', 'x.example.com', null, null, null, null, null)`, [A.org])), 'unknown platforms are refused');
  ok(/INVALID_INPUT/.test(await err(`select c1_connection_set_status($1, 'disconnected', null)`, [connA])), 'set_status only knows active / needs_reconnect');
  await rpc(`select c1_connection_set_status($1, 'needs_reconnect', 'HTTP 401 from the store') r`, [connA]);
  await owner();
  const c2 = await one(`select status, last_error, last_error_at from store_connections where id = $1`, [connA]);
  ok(c2.status === 'needs_reconnect' && c2.last_error === 'HTTP 401 from the store' && c2.last_error_at, 'needs_reconnect keeps the reason as the last error');
  await service();
  await rpc(`select c1_connection_set_status($1, 'active', null) r`, [connA]);
  await owner();
  const c3 = await one(`select status, last_error, connected_at from store_connections where id = $1`, [connA]);
  ok(c3.status === 'active' && c3.last_error === null && c3.connected_at, 'active clears the error and stamps connected_at');
  await service();
  ok(/INVALID_INPUT/.test(await err(`select c1_connection_record_sync($1, 'bogus', true, null)`, [connA])), 'record_sync refuses unknown kinds');
  await rpc(`select c1_connection_record_sync($1, 'tasks', false, $2) r`, [connA, 'line one\nline two']);
  await owner();
  const log = await one(`select status, summary from integration_logs where endpoint = $1 order by created_at desc limit 1`, ['connection:' + connA]);
  const c4 = await one(`select last_error, last_sync_at from store_connections where id = $1`, [connA]);
  ok(log?.status === 502 && /woocommerce tasks: line one line two/.test(log.summary) && c4.last_error === 'line one line two' && c4.last_sync_at === null,
    'a failed sync is logged (one line) and shown as the last error; last_sync_at only moves on success');

  // ── 2. store tasks follow the connection ──
  const soA1 = await mkSo(A.org, 'woocommerce', 'A1');
  const soB1 = await mkSo(B.org, 'woocommerce', 'B1');
  const soS = await mkSo(B.org, 'shopify', 'S1');
  await db.query(`select ds_order_channel_task($1, $2, 'woocommerce', 'accept_cancellation', '{}'::jsonb)`, [soA1.id, A.org]);
  await db.query(`select ds_order_channel_task($1, $2, 'woocommerce', 'accept_cancellation', '{}'::jsonb)`, [soB1.id, B.org]);
  await db.query(`select ds_order_channel_task($1, $2, 'shopify', 'accept_cancellation', '{}'::jsonb)`, [soS.id, B.org]);
  const tk = async (so, action) => one(`select * from dropship_channel_tasks where store_order_id = $1 and action = $2`, [so, action]);
  const tA = await tk(soA1.id, 'accept_cancellation');
  const tB = await tk(soB1.id, 'accept_cancellation');
  const tS = await tk(soS.id, 'accept_cancellation');
  ok(tA?.status === 'waiting_store' && tA.store_connection_id === connA, 'with an active WooCommerce connection the task waits for the store (linked to it)');
  ok(tB?.status === 'not_needed' && tB.store_connection_id === null, 'without a connection it is not needed (as before)');
  ok(tS?.status === 'waiting_store', 'Shopify keeps waiting for its app (unchanged)');

  // ── 3. ship → send_tracking ──
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'S1 carton', 100) returning id`, [`S1B${stamp}`.toUpperCase().slice(0, 20)])).id;
  const token = (tag) => crypto.createHash('md5').update(`${tag}${stamp}`).digest('hex');
  const mkShipped = async (so, org, tag) => {
    const o = await one(`insert into wh_orders (warehouse_code, source, org_id, store_order_id, ship_name, ship_address, ship_country, status, picked_at, packed_at, box_id, expected_weight_g, tolerance_g, measured_weight_g)
      values ('FS-01', 'dropship', null, $1, 'Test Buyer', '{"line1":"1 Way","city":"Dubai"}'::jsonb, 'AE', 'packed', now(), now(), $2, 500, 50, 500) returning id, code`, [so, box]);
    await db.query(`update wh_orders set status = 'shipped', shipped_at = now(), tracking_token = $2 where id = $1`, [o.id, token(tag)]);
    return o;
  };
  const wA = await mkShipped(soA1.id, A.org, 'a');
  const st = await tk(soA1.id, 'send_tracking');
  ok(st?.status === 'waiting_store' && st.store_connection_id === connA && st.detail?.wh_order_code === wA.code && st.detail?.tracking_token === token('a') && Array.isArray(st.detail?.tracking_numbers),
    'Warehouse OS ships the order → a send_tracking task with the wh order code, the /t/ token and the tracking numbers');
  await db.query(`update wh_orders set status = 'shipped' where id = $1`, [wA.id]);
  ok(Number((await one(`select count(*) n from dropship_channel_tasks where store_order_id = $1 and action = 'send_tracking'`, [soA1.id])).n) === 1, 'shipping again does not queue a second task');
  await db.query(`insert into dropship_channel_settings (org_id, channel, send_tracking) values ($1, 'woocommerce', false) on conflict (org_id, channel) do update set send_tracking = false`, [A.org]);
  const soA2 = await mkSo(A.org, 'woocommerce', 'A2');
  await mkShipped(soA2.id, A.org, 'b');
  ok(!(await tk(soA2.id, 'send_tracking')), 'the merchant switched "send tracking" off for WooCommerce → no task');
  await db.query(`update dropship_channel_settings set send_tracking = true where org_id = $1 and channel = 'woocommerce'`, [A.org]);

  // ── 4. task executor ──
  await as(A.uid);
  ok(/permission denied/.test(await err(`select * from c1_task_claim(10)`)), 'a signed-in user cannot claim store tasks');
  await service();
  const claimed = await rows(`select * from c1_task_claim(200)`);
  const mine = claimed.filter((r) => [tA.id, st.id].includes(r.id));
  const cst = mine.find((r) => r.id === st.id);
  ok(mine.length === 2 && !claimed.some((r) => r.id === tB.id || r.id === tS.id) && cst?.external_order_id === `S1-A1-${stamp}` && cst.order_number === soA1.order_number && cst.store_connection_id === connA && cst.attempts === 1,
    'claim returns the waiting tasks of active connections with the store order ids (never not_needed or Shopify tasks)');
  ok(!(await rows(`select * from c1_task_claim(200)`)).some((r) => r.id === st.id), 'a claimed task is locked for 10 minutes (not claimed twice)');
  const d1 = await rpc(`select c1_task_done($1, false, 'HTTP 500') r`, [st.id]);
  await owner();
  const s1 = await one(`select status, attempts, last_error, extract(epoch from next_attempt_at - now()) secs from dropship_channel_tasks where id = $1`, [st.id]);
  ok(d1?.status === 'waiting_store' && s1.status === 'waiting_store' && s1.last_error === 'HTTP 500' && Number(s1.secs) > 60 && Number(s1.secs) <= 125, 'a failed try waits (back-off 2 min after the first) with the error kept');
  await db.query(`update dropship_channel_tasks set attempts = 7, next_attempt_at = null where id = $1`, [st.id]);
  await service();
  await rows(`select * from c1_task_claim(200)`);
  const d2 = await rpc(`select c1_task_done($1, false, 'HTTP 500 again') r`, [st.id]);
  await owner();
  const fa = Number((await one(`select count(*) n from audit_log where action = 'channel_task.failed' and entity_id = $1`, [st.id])).n);
  ok(d2?.status === 'failed' && fa === 1, 'after 8 tries the task fails (staff decide) and it is audited');
  await as(A.uid);
  ok(/FORBIDDEN|permission denied/.test(await err(`select c1_task_retry($1)`, [st.id])), 'merchants cannot retry store tasks');
  await as(admin, 'aal2');
  const rt = await rpc(`select c1_task_retry($1) r`, [st.id]);
  await owner();
  const s2 = await one(`select status, attempts, next_attempt_at from dropship_channel_tasks where id = $1`, [st.id]);
  ok(rt?.status === 'waiting_store' && s2.status === 'waiting_store' && s2.attempts === 0 && s2.next_attempt_at === null, 'staff retry puts it back in the queue from zero (audited)');
  await as(admin, 'aal2');
  ok(/INVALID_STATE/.test(await err(`select c1_task_retry($1)`, [st.id])), 'only failed tasks are retried');
  await service();
  await rows(`select * from c1_task_claim(200)`);
  const d3 = await rpc(`select c1_task_done($1, true, null) r`, [st.id]);
  await owner();
  const s3 = await one(`select status, done_at, last_error from dropship_channel_tasks where id = $1`, [st.id]);
  ok(d3?.status === 'done' && s3.status === 'done' && s3.done_at && s3.last_error === null, 'a sent update is done');

  // ── 5. webhook inbox ──
  await as(A.uid);
  ok(/permission denied/.test(await err(`select c1_webhook_receive('woocommerce', $1, 'e1', 'order.created', true, '{}'::jsonb)`, [connA])), 'signed-in users cannot write the inbox');
  await service();
  const ev = `ev-${stamp}`;
  const w1 = await rpc(`select c1_webhook_receive('woocommerce', $1, $2, 'order.created', true, '{"id": 7}'::jsonb) r`, [connA, ev]);
  const w2 = await rpc(`select c1_webhook_receive('woocommerce', $1, $2, 'order.created', true, '{"id": 7}'::jsonb) r`, [connA, ev]);
  ok(w1?.duplicate === false && w1.id && w2?.duplicate === true, 'one row per platform + event id (a replay is a duplicate)');
  const wb = await rpc(`select c1_webhook_receive('woocommerce', $1, $2, 'order.created', false, '{"secret": "x"}'::jsonb) r`, [connA, ev]);
  await owner();
  const bad = await one(`select external_event_id, signature_ok, payload, error from webhook_inbox where id = $1`, [wb.id]);
  ok(/^badsig-/.test(bad?.external_event_id ?? '') && bad.signature_ok === false && bad.payload === null && bad.error === 'Signature did not match', 'a bad signature is kept without its payload (health card only)');
  await service();
  ok(/INVALID_INPUT/.test(await err(`select c1_webhook_receive('myspace', null, 'x', null, true, null)`)), 'unknown platforms are refused');
  const wc = await rows(`select * from c1_webhook_claim(200)`);
  const wmine = wc.find((r) => r.id === w1.id);
  ok(wmine?.org_id === A.org && wmine.payload?.id === 7 && wmine.attempts === 1 && !wc.some((r) => r.id === wb.id), 'claim returns verified events with the organisation (never bad signatures)');
  await rpc(`select c1_webhook_done($1, 'BUYER_PRICE_MISSING: no price') r`, [w1.id]);
  await owner();
  const we = await one(`select processed_at, error from webhook_inbox where id = $1`, [w1.id]);
  ok(we.processed_at === null && /BUYER_PRICE_MISSING/.test(we.error), 'an event that failed stays open with its error (tried again)');
  await db.query(`update webhook_inbox set attempts = 5 where id = $1`, [w1.id]);
  await service();
  ok(!(await rows(`select * from c1_webhook_claim(200)`)).some((r) => r.id === w1.id), 'after 5 tries an event is not claimed again');
  await owner();
  await db.query(`update webhook_inbox set attempts = 1 where id = $1`, [w1.id]);
  await service();
  await rpc(`select c1_webhook_done($1, null) r`, [w1.id]);
  await owner();
  ok(Boolean((await one(`select processed_at from webhook_inbox where id = $1`, [w1.id])).processed_at), 'a handled event is closed');

  // ── 7a. catch-up targets (before disconnect) ──
  await service();
  const pt1 = await rows(`select * from c1_pull_targets(array['woocommerce'], 200)`);
  const pt2 = await rows(`select * from c1_pull_targets(array['magento'], 200)`);
  ok(pt1.some((r) => r.id === connA && r.org_id === A.org) && !pt2.some((r) => r.id === connA), 'catch-up targets: active connections of the asked platforms that were not read for 50 min');
  await rpc(`select c1_connection_record_sync($1, 'orders', true, '3 order(s) read') r`, [connA]);
  ok(!(await rows(`select * from c1_pull_targets(array['woocommerce'], 200)`)).some((r) => r.id === connA), 'a store read just now is not a target');
  await owner();
  ok(Boolean((await one(`select last_sync_at from store_connections where id = $1`, [connA])).last_sync_at), 'a successful order read stamps last_sync_at');

  // ── 6. disconnect ──
  await service();
  await db.query(`insert into store_credentials (connection_id, kind, ciphertext, key_version) values ($1, 'consumer_secret', $2, 1)`, [connA, fakeSealed()]);
  await owner();
  const soA3 = await mkSo(A.org, 'woocommerce', 'A3');
  await db.query(`select ds_order_channel_task($1, $2, 'woocommerce', 'reject_cancellation', '{}'::jsonb)`, [soA3.id, A.org]);
  await as(viewer);
  ok(/FORBIDDEN|role|permission/i.test(await err(`select c1_connection_disconnect($1, null)`, [connA])), 'a viewer cannot disconnect a store');
  await as(B.uid);
  ok(/NOT_FOUND/.test(await err(`select c1_connection_disconnect($1, null)`, [connA])), 'another merchant cannot see or disconnect it');
  await as(A.uid);
  const dc = await rpc(`select c1_connection_disconnect($1, 'Moving store') r`, [connA]);
  await owner();
  const c5 = await one(`select status, disconnected_at, status_reason from store_connections where id = $1`, [connA]);
  const creds = Number((await one(`select count(*) n from store_credentials where connection_id = $1`, [connA])).n);
  const t3 = await tk(soA3.id, 'reject_cancellation');
  const da = await one(`select details from audit_log where action = 'store_connection.disconnected' and entity_id = $1`, [connA]);
  ok(dc?.status === 'disconnected' && c5.status === 'disconnected' && c5.disconnected_at && creds === 0, 'the owner disconnects: status disconnected, sealed keys wiped');
  ok(t3?.status === 'not_needed' && t3.last_error === 'Store disconnected', 'open store tasks for that store are closed');
  ok(da?.details?.by === 'merchant', 'disconnect is audited (by the merchant)');
  await as(A.uid);
  ok((await rpc(`select c1_connection_disconnect($1, null) r`, [connA]))?.already === true, 'disconnecting twice is harmless');
  await service();
  ok(/DISCONNECTED/.test(await err(`select c1_connection_set_status($1, 'active', null)`, [connA])), 'a disconnected store cannot be re-activated without a new connect');
  ok((await rows(`select * from c1_pull_targets(array['woocommerce'], 200)`)).every((r) => r.id !== connA), 'a disconnected store is never read');
  await owner();
  const shop = (await one(`insert into store_connections (org_id, platform, shop_domain, status) values ($1, 'shopify', $2, 'active') returning id`, [A.org, `s1-${stamp}.myshopify.com`])).id;
  await as(A.uid);
  ok(/NOT_SUPPORTED/.test(await err(`select c1_connection_disconnect($1, null)`, [shop])), 'Shopify is disconnected from the app in Shopify admin, not here');
  await owner();
  await db.query(`update store_connections set status = 'disconnected', disconnected_at = now() where id = $1`, [shop]);
  // after A disconnects, a fresh connect of the same store by B is allowed
  await service();
  ok(typeof (await rpc(`select c1_connection_upsert($1, 'woocommerce', $2, null, null, null, null, null) r`, [B.org, shopA])) === 'string', 'once disconnected, the store can be linked by another account');

  // ── 7b. job + audits ──
  await owner();
  await db.query(`update store_connections set status = 'disconnected', disconnected_at = now() where org_id = $1 and status <> 'disconnected'`, [B.org]);
  if (!ctx.staging) {
    const job = (await one(`select job_connector_sync() r`)).r;
    ok(job === null || Number(job) === 0, 'the scheduled job makes no HTTP call without pg_net / without work');
  }
  const acts = await all(`select action, count(*)::int n from audit_log where action in ('store_connection.created', 'store_connection.reauthorised', 'store_connection.active', 'store_connection.needs_reconnect', 'store_connection.disconnected', 'channel_task.failed', 'channel_task.retried') and created_at > now() - interval '1 hour' group by 1`);
  const want = ['store_connection.created', 'store_connection.reauthorised', 'store_connection.active', 'store_connection.needs_reconnect', 'store_connection.disconnected', 'channel_task.failed', 'channel_task.retried'];
  ok(want.every((a) => acts.some((x) => x.action === a && x.n > 0)), 'every lifecycle change is audited (created, re-authorised, active, needs reconnect, disconnected, task failed, task retried)');

  // ── 8. round trip (staging; the PGlite harness does its own) ──
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
    await db.query('savepoint s1rt');
    try {
      await ctx.unwindLater(db);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...SERVICE_FNS, ...USER_FNS]])).n);
      const tdef = (await one(`select pg_get_functiondef('public.ds_order_channel_task(uuid,uuid,text,text,jsonb)'::regprocedure) d`)).d;
      ok(fnLeft === 0 && !/c1_active_connection/.test(tdef), 'down: every S1 function is gone; ds_order_channel_task is the installed one again');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint s1rt');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_conn_s1_runtime.sql'));
  if (!MIG) { console.error('✘ S1 migration file not found'); process.exit(1); }
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
    failed = await runS1Checks(db, {
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
  console.log(failed ? `\nconn-s1-runtime: ${failed} check(s) failed` : '\nconn-s1-runtime: all passed');
  process.exitCode = failed ? 1 : 0;
}
