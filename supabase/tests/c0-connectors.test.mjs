// C0 · Connector foundation + customs safety — DB checks for migration *_c0_connector_foundation.
// STAGING ONLY, one rolled-back transaction, acting as staff / merchants / the service role through JWT claims (what PostgREST does).
//  0. Structure: new tables with RLS; secrets tables service-role only; RPC grants; internals not callable; search_path=public.
//  1. store_connections widened (platforms, per-platform store identifier, new columns); merchants read only their own.
//  2. store_credentials: no access for signed-in users; only sealed text accepted (format + key version); audit without the value;
//     wiped when the connection is disconnected.
//  3. "Request this platform" (waiting list widened; "Other" needs a name; team role); store-link result (connection / linked elsewhere).
//  4. Customs value: never the cost — quote has no declared value without the buyer's price; store order refused (BUYER_PRICE_MISSING);
//     intake refuses + audits; buyer_paid_cents passes through; the declared value is locked.
//  5. CSV file connector: import through ds_order_intake channel 'csv' with row numbers, duplicates, history, role, limits.
//  6. Customs check before every label: blocked without verified data; snapshot saved with the label and locked; policy minimum when
//     set ("not set" today); client orders = warnings; domestic = not needed; US / DDP duty type.
//  7. Tracking company names (seeds, staff-only edit, validation); staff connector health; product feed / tracking export scope.
//  8. Scheduled poll job is a safe no-op without a live label; audit rows.
//  9. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/c0-connectors.test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runC0Checks(db, ctx) {
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
  const err = async (q, p) => {
    await db.query('savepoint c0');
    try { await db.query(q, p); await db.query('release savepoint c0'); return ''; }
    catch (e) { await db.query('rollback to savepoint c0'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint c0r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint c0r'); return r; }
    catch (e) { await db.query('rollback to savepoint c0r'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const TABLES = ['store_credentials', 'store_oauth_states', 'dropship_csv_imports', 'carrier_tracking_names', 'wh_shipment_customs'];
  const RPC_FNS = ['c0_store_link_result', 'c0_request_platform', 'c0_file_page', 'c0_csv_orders_import', 'c0_product_feed', 'c0_tracking_export', 'c0_connector_health', 'c0_tracking_name_save'];
  const INTERNAL_FNS = ['c0_platforms', 'c0_credential_audit', 'c0_connection_wipe', 'c0_declared_locked', 'c0_customs_snapshot_locked', 'c0_customs_problem', 'wh_customs_check', 'job_carrier_tracking_poll'];
  const fakeSealed = (v = 1) => `v${v}.${crypto.randomBytes(12).toString('base64url')}.${crypto.randomBytes(16).toString('base64url')}.${crypto.randomBytes(24).toString('base64url')}`;

  // ── 0. structure ──
  await owner();
  const rls = await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === TABLES.length && rls.every((r) => r.relrowsecurity), `${TABLES.length} new tables, RLS on every one`);
  const grants = await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated', 'service_role')`, [TABLES]);
  const g = (t, who) => grants.filter((x) => x.table_name === t && x.grantee === who).map((x) => x.privilege_type).sort().join(',');
  ok(g('store_credentials', 'anon') === '' && g('store_credentials', 'authenticated') === '' && g('store_oauth_states', 'authenticated') === ''
     && g('store_credentials', 'service_role') === 'DELETE,INSERT,SELECT,UPDATE', 'secrets tables: service role only (no grant to anon / signed-in users)');
  const csvCols = (await all(`select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'dropship_csv_imports' and grantee = 'authenticated' and privilege_type = 'SELECT'`)).map((r) => r.column_name);
  ok(g('dropship_csv_imports', 'authenticated') === '' && csvCols.includes('errors') && csvCols.includes('org_id') && !csvCols.includes('created_by')
     && g('carrier_tracking_names', 'authenticated') === '' && g('wh_shipment_customs', 'authenticated') === 'SELECT' && grants.every((x) => x.grantee !== 'anon'),
    'merchant import history: column grant without created_by; staff customs snapshot: read only; tracking names: RPC only; anon: nothing');
  const pols = await all(`select tablename from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(!pols.some((p) => ['store_credentials', 'store_oauth_states'].includes(p.tablename)), 'no policy at all on the secrets tables');
  const fns = await all(`select p.proname, p.proconfig::text cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  ok(fns.length === RPC_FNS.length + INTERNAL_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), 'every new function exists with search_path=public');
  ok(fns.every((f) => !f.anon_x), 'anon executes none of them');
  ok(fns.filter((f) => RPC_FNS.includes(f.proname)).every((f) => f.auth_x) && fns.filter((f) => INTERNAL_FNS.includes(f.proname)).every((f) => !f.auth_x),
    'signed-in users execute the RPCs only, never wh_customs_check / helpers / trigger functions / the cron job');
  const cols = await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'store_connections'
    and column_name in ('store_url', 'detected_platform', 'scopes', 'external_store_id', 'last_sync_at', 'last_error', 'last_error_at')`);
  ok(cols.length === 7, 'store_connections: store_url, detected_platform, scopes, external_store_id, last_sync_at, last_error, last_error_at');
  const trg = await all(`select tgname from pg_trigger where not tgisinternal and tgname in ('trg_c0_credential_audit', 'trg_c0_connection_wipe', 'trg_c0_declared_locked', 'trg_c0_customs_snapshot_locked')`);
  ok(trg.length === 4, 'four C0 triggers installed (credential audit, wipe on disconnect, declared value lock, snapshot lock)');

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `c0-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `C0 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkMerchant = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – C0 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = excluded.started_at`, [org]);
    return { uid, org };
  };
  await owner();
  const featBefore = (await one(`select value from site_settings where key = 'dropship_features'`))?.value ?? {};
  await db.query(`insert into site_settings (key, value, is_public) values ('dropship_features', $1::jsonb, false) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ ...(typeof featBefore === 'object' && featBefore ? featBefore : {}), stores: true, orders: true, import_list: true })]);
  const admin = await mkUser('admin', 'admin');
  const packer = await mkUser('packer', 'warehouse');
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, 'FS-01', 'packer')`, [packer]);
  const A = await mkMerchant('a');
  const B = await mkMerchant('b');
  const viewer = await mkUser('a-viewer');
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'viewer')`, [A.org, viewer]);

  // a variant + country that quotes (service role), visible to merchants
  const cands = await all(`select v.id, v.model_no, v.item_id, p.id product_id, p.title from dropship_variants v join dropship_products p on p.id = v.product_id
     where p.status = 'active' and public.ds_product_visible(p, $1) order by v.model_no limit 20`, [A.org]);
  let V = null; let COUNTRY = null; let METHOD = 'standard';
  for (const c of cands) {
    for (const ctry of ['AE', 'SA', 'GB', 'US']) {
      for (const m of ['standard', 'economy', 'express']) {
        const q = (await one(`select get_dropship_order_quote($1::jsonb, $2, $3, 'DDP', 'USD', null, 'order') q`, [JSON.stringify([{ variant_id: c.id, qty: 1, buyer_unit_price_cents: 2500 }]), ctry, m])).q;
        if (q?.ok) { V = c; COUNTRY = ctry; METHOD = m; break; }
      }
      if (V) break;
    }
    if (V) break;
  }
  ok(Boolean(V), `fixture: a published variant quotes (${V?.model_no ?? 'none'} → ${COUNTRY} ${METHOD})`);
  if (!V) return failed;
  for (const o of [A.org, B.org]) await db.query(`insert into dropship_markets (org_id, country) values ($1, $2) on conflict do nothing`, [o, COUNTRY]);
  await db.query(`insert into dropship_import_list (org_id, product_id, variant_id) values ($1, $2, $3)`, [A.org, V.product_id, V.id]);

  // ── 1. store_connections widened ──
  const HOST_A = `shop-${stamp}.example-store.com`;
  const connA = (await one(`insert into store_connections (org_id, platform, shop_domain, store_url, detected_platform, status) values ($1, 'woocommerce', $2, $3, 'woocommerce', 'connecting') returning id`,
    [A.org, HOST_A, `https://${HOST_A}/`])).id;
  ok(Boolean(connA), 'a WooCommerce store row with a plain host name is accepted (platform widened)');
  ok(/store_connections_shop_domain_check/.test(await err(`insert into store_connections (org_id, platform, shop_domain) values ($1, 'shopify', 'mystore.com')`, [A.org])),
    'Shopify still needs a *.myshopify.com domain');
  ok(/store_connections_shop_domain_check/.test(await err(`insert into store_connections (org_id, platform, shop_domain) values ($1, 'magento', 'Bad Host!')`, [A.org])),
    'web platforms need a lower-case host name');
  ok(!(await err(`insert into store_connections (org_id, platform, shop_domain, status) values ($1, 'ebay', $2, 'connecting')`, [B.org, `seller_${stamp}`])), 'a marketplace connection keeps a seller identifier');
  ok(/store_connections_platform_check/.test(await err(`insert into store_connections (org_id, platform, shop_domain) values ($1, 'myspace', 'x.example.com')`, [A.org])), 'unknown platforms are refused');
  ok(/store_url_check|store_connections_store_url_check/.test(await err(`update store_connections set store_url = 'http://insecure.example.com' where id = $1`, [connA])), 'store_url must be https');
  await as(B.uid);
  const bSees = Number((await one(`select count(*) n from store_connections where id = $1`, [connA])).n);
  await as(A.uid);
  const aSees = Number((await one(`select count(*) n from store_connections where id = $1`, [connA])).n);
  const page = await rpc(`select ds_channels_page() r`);
  ok(aSees === 1 && bSees === 0, 'merchants read only their own store connections');
  ok(Array.isArray(page?.connections) && page.connections.some((c) => c.id === connA && c.platform === 'woocommerce' && c.status === 'connecting') && page.shopify?.status === 'not_connected',
    'Integrations page data lists every platform\'s connection; the Shopify slot stays Shopify-only');

  // ── 2. store_credentials ──
  await as(A.uid);
  ok(/permission denied/.test(await err(`select * from store_credentials`)), 'a merchant cannot read store_credentials');
  ok(/permission denied/.test(await err(`insert into store_credentials (connection_id, kind, ciphertext, key_version) values ($1, 'access_token', $2, 1)`, [connA, fakeSealed()])), 'a merchant cannot write store_credentials');
  await as(admin, 'aal2');
  ok(/permission denied/.test(await err(`select * from store_credentials`)), 'staff (even admins) cannot read store_credentials through the API');
  await as(null, 'aal1', 'service_role');
  ok(/store_credentials_ciphertext_check/.test(await err(`insert into store_credentials (connection_id, kind, ciphertext, key_version) values ($1, 'access_token', 'shpat_0123456789abcdef', 1)`, [connA])),
    'a plain token is refused by the database (sealed format only)');
  ok(/store_credentials_version_matches/.test(await err(`insert into store_credentials (connection_id, kind, ciphertext, key_version) values ($1, 'access_token', $2, 2)`, [connA, fakeSealed(1)])),
    'the key version must match the sealed text');
  const sealedTok = fakeSealed(1);
  ok(!(await err(`insert into store_credentials (connection_id, kind, ciphertext, key_version, expires_at) values ($1, 'access_token', $2, 1, now() + interval '1 hour')`, [connA, sealedTok])),
    'the service role stores a sealed token');
  await owner();
  const credAudit = await all(`select action, details::text d from audit_log where entity = 'store_connections' and entity_id = $1 and action like 'store_credential.%'`, [connA]);
  ok(credAudit.some((r) => r.action === 'store_credential.saved') && credAudit.every((r) => !r.d.includes(sealedTok.split('.')[3]) && !/ciphertext/.test(r.d)),
    'audit row for the saved credential keeps kind + key version, never the sealed value');
  await db.query(`update store_connections set status = 'disconnected', disconnected_at = now() where id = $1`, [connA]);
  const left = Number((await one(`select count(*) n from store_credentials where connection_id = $1`, [connA])).n);
  const delAudit = Number((await one(`select count(*) n from audit_log where entity_id = $1 and action = 'store_credential.deleted'`, [connA])).n);
  ok(left === 0 && delAudit === 1, 'disconnecting a store deletes its credentials (audited)');
  await db.query(`update store_connections set status = 'connecting', disconnected_at = null where id = $1`, [connA]);

  // ── 3. request a platform + store-link result ──
  await as(A.uid);
  const rqM = await rpc(`select c0_request_platform('magento', null) r`);
  const rqO = await rpc(`select c0_request_platform('other', 'Salla Pro') r`);
  const rqOempty = await rpc(`select c0_request_platform('other', '') r`);
  const rqBad = await rpc(`select c0_request_platform('myspace', null) r`);
  const wlBig = await rpc(`select ds_channel_waitlist('bigcommerce', true) r`);
  const wlOther = await rpc(`select ds_channel_waitlist('other', true) r`);
  ok(rqM?.requested === true && rqO?.requested === true && /INVALID_INPUT/.test(rqOempty?.__error ?? '') && /BAD_CHANNEL/.test(rqBad?.__error ?? ''),
    '"Request this platform": listed platforms and "Other" with a name are counted; empty name / unknown platform refused');
  ok(wlBig?.joined === true && /BAD_CHANNEL/.test(wlOther?.__error ?? ''), 'the DS14 waiting list takes the new platforms; "Other" only through the request (needs a name)');
  await as(viewer);
  ok(/ROLE_FORBIDDEN/.test((await rpc(`select c0_request_platform('etsy', null) r`))?.__error ?? ''), 'a support-role team member cannot request platforms (setup role)');
  await owner();
  const wl = await all(`select channel, requested_name from dropship_channel_waitlist where org_id = $1 order by channel`, [A.org]);
  ok(wl.some((w) => w.channel === 'other' && w.requested_name === 'Salla Pro') && wl.some((w) => w.channel === 'magento'), 'requests stored on the waiting list (with the typed name for Other)');
  await as(A.uid);
  const linkA = await rpc(`select c0_store_link_result($1, 'woocommerce', 'found') r`, [HOST_A]);
  const linkBad = await rpc(`select c0_store_link_result('not a host', 'unknown', 'unknown') r`);
  await as(B.uid);
  const linkB = await rpc(`select c0_store_link_result($1, 'woocommerce', 'found') r`, [HOST_A]);
  ok(linkA?.connection?.id === connA && linkA.connection.status === 'connecting' && linkA.linked_elsewhere === false && /INVALID_INPUT/.test(linkBad?.__error ?? ''),
    'store-link result: the merchant\'s own connection for that host is returned; a bad host is refused');
  ok(linkB?.connection === null && linkB.linked_elsewhere === true, 'another merchant sees only "already linked elsewhere" (no details)');

  // ── 4. customs value: never the cost ──
  await owner();
  const prodPrice = Number((await one(`select get_dropship_order_quote($1::jsonb, $2, $3, 'DDP', 'USD', null, 'catalogue') q`, [JSON.stringify([{ variant_id: V.id, qty: 1 }]), COUNTRY, METHOD])).q.product_cents);
  const qCat = (await one(`select get_dropship_order_quote($1::jsonb, $2, $3, 'DDP', 'USD', null, 'catalogue') q`, [JSON.stringify([{ variant_id: V.id, qty: 2 }]), COUNTRY, METHOD])).q;
  const qMissing = (await one(`select get_dropship_order_quote($1::jsonb, $2, $3, 'DDP', 'USD', null, 'order') q`, [JSON.stringify([{ variant_id: V.id, qty: 2 }]), COUNTRY, METHOD])).q;
  const qPaid = (await one(`select get_dropship_order_quote($1::jsonb, $2, $3, 'DDP', 'AED', 0.2723, 'order') q`, [JSON.stringify([{ variant_id: V.id, qty: 2, buyer_unit_price_cents: 10000, buyer_paid_cents: 18000 }]), COUNTRY, METHOD])).q;
  ok(qCat.ok && qCat.declared_value_usd_cents === null && Number(qCat.duty_estimate_basis_usd_cents) === prodPrice * 2, 'catalogue quote: no declared value (the product price is only a duty estimate basis)');
  ok(qMissing.ok && qMissing.declared_value_usd_cents === null && qMissing.buyer_price_missing === true && qMissing.duty_basis === 'product_price',
    'order quote without the buyer\'s price: no declared value, flagged buyer_price_missing (never the cost)');
  ok(qPaid.ok && Number(qPaid.declared_value_usd_cents) === Math.round(18000 * 0.2723) && qPaid.buyer_price_missing === false,
    `order quote: declared = the line total the buyer paid × locked FX (AED 180.00 × 0.2723 = ${Math.round(18000 * 0.2723)}¢)`);
  const before = Number((await one(`select count(*) n from store_orders where org_id = $1`, [A.org])).n);
  const noPrice = (await one(`select create_dropship_store_order($1, 'manual', $2, null, 'Buyer One', null, '{"line1":"1 Way","city":"Dubai"}'::jsonb, $3, 'USD', null, $4, 'DDP', $5::jsonb, false) r`,
    [A.org, `C0-NP-${stamp}`, COUNTRY, METHOD, JSON.stringify([{ variant_id: V.id, qty: 1 }])])).r;
  const after = Number((await one(`select count(*) n from store_orders where org_id = $1`, [A.org])).n);
  ok(noPrice.ok === false && noPrice.code === 'BUYER_PRICE_MISSING' && /buyer paid/.test(noPrice.message) && after === before,
    'a store order line without the buyer\'s price is refused with a clear reason (BUYER_PRICE_MISSING); nothing is created');
  const intakeNoPrice = (await one(`select ds_order_intake($1, 'csv', $2::jsonb) r`, [A.org, JSON.stringify({ external_order_id: `C0-INP-${stamp}`, currency: 'USD', address: { name: 'Buyer', line1: '1 Way', city: 'Dubai', country: COUNTRY }, lines: [{ model_no: V.model_no, qty: 1 }] })])).r;
  const refusedAudit = await one(`select details from audit_log where action = 'ds_order.intake_refused' and details ->> 'external_order_id' = $1`, [`C0-INP-${stamp}`]);
  ok(intakeNoPrice.ok === false && intakeNoPrice.code === 'BUYER_PRICE_MISSING' && refusedAudit?.details?.code === 'BUYER_PRICE_MISSING',
    'intake refuses an order without the buyer\'s price and audits the refusal');
  const intakePaid = (await one(`select ds_order_intake($1, 'csv', $2::jsonb) r`, [A.org, JSON.stringify({ external_order_id: `C0-IP-${stamp}`, currency: 'AED', fx_rate_to_usd: 0.2723,
    address: { name: 'Buyer', line1: '1 Way', city: 'Dubai', country: COUNTRY }, lines: [{ model_no: V.model_no, qty: 2, buyer_unit_price_cents: 10000, buyer_paid_cents: 18000 }] })])).r;
  const soiPaid = intakePaid.ok ? await one(`select i.declared_usd_cents, i.buyer_unit_price_cents, i.unit_product_cents, o.channel from store_order_items i join store_orders o on o.id = i.store_order_id where o.id = $1`, [intakePaid.store_order_id]) : null;
  ok(intakePaid.ok === true && Number(soiPaid?.declared_usd_cents) === Math.round(18000 * 0.2723) && soiPaid?.channel === 'csv',
    `intake passes buyer_paid_cents through: declared ${soiPaid?.declared_usd_cents}¢ = what the buyer paid (product cost ${soiPaid?.unit_product_cents}¢ is never used)`);
  ok(/INVALID_INPUT/.test(await err(`select ds_order_intake($1, 'bogus', '{"external_order_id":"x","lines":[]}'::jsonb)`, [A.org])) && !/Unknown sales channel/.test(await err(`select ds_order_intake($1, 'wix', $2::jsonb)`, [A.org, JSON.stringify({ external_order_id: `C0-W-${stamp}`, lines: [{ sku: 'X', qty: 1 }] })])),
    'intake accepts the planned platform channels (wix) and still refuses unknown ones');
  ok(intakePaid.ok && /DECLARED_VALUE_LOCKED/.test(await err(`update store_order_items set declared_usd_cents = 1 where store_order_id = $1`, [intakePaid.store_order_id])),
    'the declared value is locked once the order is in (DECLARED_VALUE_LOCKED)');

  // ── 5. CSV file connector ──
  const sha = crypto.createHash('sha256').update(`c0-${stamp}`).digest('hex');
  const csvOrders = [
    { rows: [2, 3], order: { external_order_id: `C0-CSV1-${stamp}`, currency: 'USD', address: { name: 'Sara', line1: '1 Way', city: 'Dubai', country: COUNTRY }, lines: [{ model_no: V.model_no, qty: 1, buyer_unit_price_cents: 3999 }] } },
    { rows: [4], order: { external_order_id: `C0-CSV2-${stamp}`, currency: 'USD', address: { name: 'Omar', line1: '2 Way', city: 'Dubai', country: COUNTRY }, lines: [{ model_no: V.model_no, qty: 1 }] } },
    { rows: [5], order: { external_order_id: `C0-CSV3-${stamp}`, currency: 'USD', address: { name: 'Lina', line1: '3 Way', city: 'Dubai', country: COUNTRY }, lines: [{ model_no: 'MY-OWN-SKU', qty: 1, buyer_unit_price_cents: 1000 }] } },
  ];
  await as(viewer);
  ok(/ROLE_FORBIDDEN/.test((await rpc(`select c0_csv_orders_import('orders.csv', $1, 6, $2::jsonb, '[]'::jsonb) r`, [sha, JSON.stringify(csvOrders)]))?.__error ?? ''), 'a support-role member cannot import orders (pay_orders role)');
  await as(A.uid);
  const imp = await rpc(`select c0_csv_orders_import('orders <x>.csv', $1, 6, $2::jsonb, $3::jsonb) r`, [sha, JSON.stringify(csvOrders), JSON.stringify([{ row: 6, message: 'The quantity must be a whole number.' }])]);
  ok(imp?.created === 1 && imp.failed === 2 && imp.duplicates === 0 && imp.orders === 3, `CSV import: 1 created, 2 not imported (${JSON.stringify(imp?.results?.map((r) => r.code ?? 'ok'))})`);
  const r2 = imp?.results?.find((r) => r.external_order_id === `C0-CSV2-${stamp}`);
  const r3 = imp?.results?.find((r) => r.external_order_id === `C0-CSV3-${stamp}`);
  ok(r2?.code === 'BUYER_PRICE_MISSING' && JSON.stringify(r2.rows) === '[4]' && r3?.code === 'NO_OCTOPUS_ITEMS' && JSON.stringify(r3.rows) === '[5]',
    'row errors keep their CSV row numbers (row 4: no buyer price; row 5: not an Octopus SKU)');
  ok(Array.isArray(imp?.errors) && imp.errors.some((e) => JSON.stringify(e.rows) === '[6]') && imp.errors.length === 3, 'file-reading problems (row 6) are kept in the import result too');
  const csvSo = await one(`select channel, external_order_id from store_orders where org_id = $1 and external_order_id = $2`, [A.org, `C0-CSV1-${stamp}`]);
  ok(csvSo?.channel === 'csv', 'the imported order is a normal store order with channel csv (through ds_order_intake)');
  const imp2 = await rpc(`select c0_csv_orders_import('orders.csv', $1, 6, $2::jsonb, '[]'::jsonb) r`, [sha, JSON.stringify([csvOrders[0]])]);
  ok(imp2?.duplicates === 1 && imp2.created === 0, 'importing the same order again is a duplicate (skipped)');
  const hist = await rpc(`select c0_file_page() r`);
  ok(hist?.imports?.length === 2 && hist.imports.some((i) => i.file_name === 'orders x.csv' && i.failed === 2 && i.errors.length === 3) && hist.can_import === true,
    'import history: both files with counts and row errors; the file name is cleaned');
  const many = Array.from({ length: 201 }, (_, i) => ({ rows: [i + 2], order: { external_order_id: `M${i}` } }));
  ok(/TOO_MANY/.test((await rpc(`select c0_csv_orders_import('big.csv', $1, 201, $2::jsonb, '[]'::jsonb) r`, [sha, JSON.stringify(many)]))?.__error ?? ''), 'more than 200 orders in one file are refused');
  ok(/INVALID_INPUT/.test((await rpc(`select c0_csv_orders_import('x.csv', 'nothex', 1, $1::jsonb, '[]'::jsonb) r`, [JSON.stringify([csvOrders[0]])]))?.__error ?? ''), 'a missing file fingerprint is refused');
  await as(B.uid);
  const bHist = Number((await one(`select count(*) n from dropship_csv_imports where org_id = $1`, [A.org])).n);
  await as(A.uid);
  const aHist = Number((await one(`select count(*) n from dropship_csv_imports where org_id = $1`, [A.org])).n);
  const aWho = await err(`select created_by from dropship_csv_imports`);
  await as(B.uid);
  const bPage = await rpc(`select c0_file_page() r`);
  ok(bHist === 0 && bPage?.imports?.length === 0, 'another merchant sees none of these imports');
  ok(aHist === 2 && /permission denied/.test(aWho), 'the merchant reads its own import rows, but not who imported them (created_by)');

  // ── 6. customs check before every label ──
  await owner();
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, tare_g) values ('FS-01', $1, 'C0 carton', 100) returning id`, [`C0B${stamp}`.toUpperCase().slice(0, 20)])).id;
  const unitW = Number((await one(`select coalesce(weight_g, 300) w from item_master where id = $1`, [V.item_id])).w);
  const mkPacked = async ({ store = null, org = null, country, qty = 1, item = V.item_id, sku = V.model_no, name = V.title }) => {
    const exp = qty * unitW + 100;
    const o = await one(`insert into wh_orders (warehouse_code, source, org_id, store_order_id, external_ref, ship_name, ship_address, ship_country, status, picked_at, box_id, expected_weight_g, tolerance_g, measured_weight_g)
      values ('FS-01', $1, $2, $3, $4, 'Test Buyer', '{"line1":"1 Way","city":"Dubai"}'::jsonb, $5, 'packing', now(), $6, $7, 50, $7) returning id, code`,
      [store ? 'dropship' : 'client_portal', store ? null : org, store, store ? null : `C0-${crypto.randomUUID().slice(0, 8)}`, country, box, exp]);
    const line = (await one(`insert into wh_order_lines (order_id, item_id, sku, name, qty, picked_qty, packed_qty, unit_weight_g) values ($1, $2, $3, $4, $5, $5, $5, $6) returning id`, [o.id, item, sku, name, qty, unitW])).id;
    const p = (await one(`insert into wh_parcels (order_id, warehouse_code, seq, status, source, box_id, expected_weight_g, tolerance_g, measured_weight_g, battery_mark, closed_at)
      values ($1, 'FS-01', 1, 'closed', 'multi', $2, $3, 50, $3, false, now()) returning id`, [o.id, box, exp])).id;
    await db.query(`insert into wh_parcel_items (parcel_id, order_id, line_id, qty) values ($1, $2, $3, $4)`, [p, o.id, line, qty]);
    await db.query(`select set_config('octopus.wh_parcel_op', 'true', true)`);
    await db.query(`update wh_orders set status = 'packed', packed_at = now(), packed_by = $2 where id = $1`, [o.id, packer]);
    await db.query(`select set_config('octopus.wh_parcel_op', '', true)`);
    return { ...o, parcel: p };
  };
  const setItem = async (verified, origin = 'CN', hs = '9405110000') => {
    await owner();
    await db.query(`select set_config('octopus.allow_hs_verify', 'true', true)`);
    await db.query(`update item_master set hs_code = $2, origin_country = $3, hs_verified = $4, hs_verified_at = case when $4 then now() end, weight_g = coalesce(weight_g, $5) where id = $1`, [V.item_id, hs, origin, verified, unitW]);
    await db.query(`select set_config('octopus.allow_hs_verify', '', true)`);
  };
  const soDs = (await one(`select create_dropship_store_order($1, 'manual', $2, null, 'Buyer Two', null, '{"line1":"1 Way","city":"Dubai"}'::jsonb, $3, 'AED', 0.2723, $4, 'DAP', $5::jsonb, false) r`,
    [A.org, `C0-L-${stamp}`, COUNTRY, METHOD, JSON.stringify([{ variant_id: V.id, qty: 2, buyer_unit_price_cents: 10000, buyer_paid_cents: 18000 }])])).r;
  ok(soDs?.ok === true, 'fixture: a Dropship store order with the buyer\'s price (AED 180.00 for 2)');
  const oDs = await mkPacked({ store: soDs.store_order_id, country: COUNTRY, qty: 2 });
  await setItem(false);
  await as(packer, 'aal2');
  const planBlocked = await rpc(`select wh_label_plan($1) r`, [oDs.parcel]);
  ok(planBlocked?.ok === false && planBlocked.code === 'CUSTOMS_BLOCKED' && planBlocked.customs?.problems?.some((p) => p.code === 'HS_NOT_VERIFIED') && /HS code is not verified/.test(planBlocked.message),
    'label plan: an unverified HS code blocks the label before any carrier is asked (CUSTOMS_BLOCKED with the reason)');
  await owner();
  const blockedAudit = Number((await one(`select count(*) n from audit_log where action = 'wh_label.customs_blocked' and entity_id = $1`, [oDs.id])).n);
  ok(blockedAudit === 1, 'the customs block is audited');
  await setItem(true, null);
  const noOrigin = (await one(`select wh_customs_check($1) r`, [oDs.parcel])).r;
  ok(noOrigin.ok === false && noOrigin.problems.some((p) => p.code === 'ORIGIN_MISSING'), 'missing origin blocks too');
  await setItem(true);
  const chk = (await one(`select wh_customs_check($1) r`, [oDs.parcel])).r;
  const rule = (await one(`select ds16_country_rule($1) r`, [COUNTRY])).r;
  const expDuty = rule?.incoterm === 'DDP' ? 'DDP' : 'DAP';
  ok(chk.ok === true && chk.scope === 'dropship' && Number(chk.declared_usd_cents) === Math.round(18000 * 0.2723) && chk.items[0].hs_code === '9405110000' && chk.items[0].qty === 2
     && chk.items[0].origin_country === 'CN' && chk.items[0].unit_weight_g > 0 && typeof chk.items[0].battery === 'boolean' && typeof chk.items[0].magnet === 'boolean',
    `customs check: declared = what the buyer paid (${chk.declared_usd_cents}¢), HS, qty, unit value, origin, weight and battery / liquid / magnet flags`);
  ok(chk.duty_type === expDuty && (chk.policy.block_below_pct == null ? chk.policy.block_below_label === 'not set' : /^\d+(\.\d+)? %$/.test(chk.policy.block_below_label)),
    `duty type from the order (${expDuty}; countries with a DDP-only rule are always DDP); policy minimum shown as "${chk.policy.block_below_label}"`);
  ok(chk.store_order?.order_number === soDs.order_number && !JSON.stringify(chk).includes('Buyer Two') && !JSON.stringify(chk).includes('1 Way'),
    'the snapshot holds the store order (number, lines, prices) but no buyer name or address');
  // US / DDP-only countries
  const usCheck = (await one(`select case when ds16_country_rule('US') ->> 'incoterm' = 'DDP' then 'DDP' end r`)).r;
  ok(usCheck === 'DDP', 'the US is a DDP-only country (DS16 rule the customs duty type follows)');
  // record the label (sandbox account + service of FS-01, made here; rule versions are not needed to record)
  await owner();
  await db.query(`update wh_carrier_accounts set active = false where warehouse_code = 'FS-01'`);
  const acc = (await one(`insert into wh_carrier_accounts (warehouse_code, carrier, name, mode, credential_env, active) values ('FS-01', '4px', $1, 'sandbox', null, true) returning id`, [`C0 4PX sandbox ${stamp}`])).id;
  const svc = (await one(`insert into wh_carrier_services (account_id, warehouse_code, code, name, level, max_weight_g, accepts_battery, accepts_liquid, active) values ($1, 'FS-01', 'C0-STD', 'C0 standard', 'standard', 30000, true, true, true) returning id`, [acc])).id;
  const sbx = `SBXPX${crypto.randomInt(100000, 999999)}${crypto.randomInt(100000, 999999)}`;
  const path = `FS-01/${oDs.code}/P1-${sbx}.pdf`;
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-labels', $1, $2)`, [path, packer]);
  await as(packer, 'aal2');
  const rec = await rpc(`select wh_label_record($1, $2, null, $3, $4, 'C0 test') r`, [oDs.parcel, svc, sbx, path]);
  ok(rec && !rec.__error && Number(rec.declared_usd_cents) === Math.round(18000 * 0.2723) && rec.duty_type === expDuty, `the label is recorded with the customs value (${rec?.__error ?? `${rec?.declared_usd_cents}¢ ${rec?.duty_type}`})`);
  await owner();
  const snap = await one(`select c.* from wh_shipment_customs c where c.shipment_id = $1`, [rec?.id ?? '00000000-0000-0000-0000-000000000000']);
  ok(snap?.scope === 'dropship' && Number(snap.declared_usd_cents) === Math.round(18000 * 0.2723) && snap.store_order_id === soDs.store_order_id && snap.snapshot?.store_order?.order_number === soDs.order_number,
    'the customs snapshot (with the store order) is saved with the shipment');
  ok(/CUSTOMS_SNAPSHOT_LOCKED/.test(await err(`update wh_shipment_customs set declared_usd_cents = 1 where shipment_id = $1`, [rec?.id])), 'the snapshot never changes');
  await as(packer, 'aal2');
  const packerSees = Number((await one(`select count(*) n from wh_shipment_customs where shipment_id = $1`, [rec?.id])).n);
  await as(A.uid);
  const merchantSees = Number((await one(`select count(*) n from wh_shipment_customs`)).n);
  ok(packerSees === 1 && merchantSees === 0, 'warehouse staff of FS-01 read the snapshot; merchants never');
  // the label is refused at record time too (the plan is not trusted)
  await owner();
  const soDs2 = (await one(`select create_dropship_store_order($1, 'manual', $2, null, 'Buyer Four', null, '{"line1":"1 Way","city":"Dubai"}'::jsonb, $3, 'USD', null, $4, 'DDP', $5::jsonb, false) r`,
    [A.org, `C0-L2-${stamp}`, COUNTRY, METHOD, JSON.stringify([{ variant_id: V.id, qty: 1, buyer_unit_price_cents: 4999 }])])).r;
  const oDs2 = await mkPacked({ store: soDs2.store_order_id, country: COUNTRY });
  await setItem(false);
  const sbx2 = `SBXPX${crypto.randomInt(100000, 999999)}${crypto.randomInt(100000, 999999)}`;
  const path2 = `FS-01/${oDs2.code}/P1-${sbx2}.pdf`;
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-labels', $1, $2)`, [path2, packer]);
  await as(packer, 'aal2');
  ok(/CUSTOMS_BLOCKED/.test(await err(`select wh_label_record($1, $2, null, $3, $4, null)`, [oDs2.parcel, svc, sbx2, path2])), 'recording a label refuses a parcel that fails the customs check (CUSTOMS_BLOCKED)');
  // policy minimum when it is set: AED 50 paid for a store price of AED 100 (50 %) is below a 90 % minimum
  await setItem(true);
  await owner();
  const soLow = (await one(`select create_dropship_store_order($1, 'manual', $2, null, 'Buyer Three', null, '{"line1":"1 Way","city":"Dubai"}'::jsonb, $3, 'AED', 0.2723, $4, 'DDP', $5::jsonb, false) r`,
    [A.org, `C0-LOW-${stamp}`, COUNTRY, METHOD, JSON.stringify([{ variant_id: V.id, qty: 1, buyer_unit_price_cents: 10000, buyer_paid_cents: 5000 }])])).r;
  const oLow = await mkPacked({ store: soLow.store_order_id, country: COUNTRY });
  const lowNotSet = (await one(`select wh_customs_check($1) r`, [oLow.parcel])).r;
  const pol = await one(`select id, version from customs_policy where status = 'active' order by version desc limit 1`);
  await db.query(`update customs_policy set status = 'superseded', superseded_at = now() where status = 'active'`);
  await db.query(`insert into customs_policy (version, block_below_pct, status, proposed_by, approved_by, effective_from) values ((select coalesce(max(version), 0) + 1 from customs_policy), 90, 'active', $1, $2, now())`, [admin, packer]);
  const lowSet = (await one(`select wh_customs_check($1) r`, [oLow.parcel])).r;
  ok((pol == null || lowNotSet.policy.block_below_pct == null ? lowNotSet.ok === true && lowNotSet.policy.block_below_label === 'not set' : true)
     && lowSet.ok === false && lowSet.problems.some((p) => p.code === 'BELOW_POLICY') && lowSet.policy.block_below_label === '90 %',
    'customs policy minimum: skipped and shown "not set" while unset; once set (90 %), a declared value below 90 % of the store price is blocked');
  // client orders (3PL): warnings only; domestic: no customs data needed
  const oClient = await mkPacked({ org: B.org, country: 'DE', item: V.item_id, sku: 'CLIENT-1', name: '台灯 desk lamp' });
  await setItem(false);
  const cClient = (await one(`select wh_customs_check($1) r`, [oClient.parcel])).r;
  const oDom = await mkPacked({ org: B.org, country: 'CN', item: V.item_id, sku: 'CLIENT-2', name: '台灯' });
  const cDom = (await one(`select wh_customs_check($1) r`, [oDom.parcel])).r;
  ok(cClient.ok === true && cClient.scope === 'client_order' && cClient.warnings.some((w) => w.code === 'HS_NOT_VERIFIED') && cClient.warnings.some((w) => w.code === 'DESCRIPTION_NOT_ENGLISH') && cClient.declared_usd_cents === null,
    'client (3PL) orders: the same checks as warnings (unverified HS, a Chinese description); their customer price is not in Warehouse OS');
  ok(cDom.ok === true && cDom.scope === 'domestic' && cDom.warnings.length === 0, 'domestic parcels need no customs data');

  // ── 7. tracking names, health, files ──
  await owner();
  const seeds = await all(`select carrier, platform, company_name, use_branded_link from carrier_tracking_names order by carrier, platform`);
  ok(seeds.some((s) => s.carrier === 'yunexpress' && s.platform === 'shopify' && s.company_name === 'Other' && s.use_branded_link)
     && seeds.some((s) => s.carrier === '4px' && s.platform === 'shopify' && s.company_name === null), 'seeds: YunExpress → "Other" + our /t/ link; 4PX\'s Shopify name left for staff (not set)');
  await as(A.uid);
  ok(/permission denied/.test(await err(`select * from carrier_tracking_names`)) && /FORBIDDEN/.test((await rpc(`select c0_tracking_name_save('4px', 'shopify', '4PX', null, true, null) r`))?.__error ?? ''),
    'merchants can neither read nor change tracking company names');
  await as(admin, 'aal2');
  const saved = await rpc(`select c0_tracking_name_save('4px', 'shopify', '4PX', null, true, 'checked in a test store') r`);
  const badUrl = await rpc(`select c0_tracking_name_save('4px', 'shopify', '4PX', 'http://x.example/{tracking}', false, null) r`);
  const noToken = await rpc(`select c0_tracking_name_save('4px', 'shopify', '4PX', 'https://x.example/track', false, null) r`);
  ok(saved?.company_name === '4PX' && /INVALID_INPUT/.test(badUrl?.__error ?? '') && /INVALID_INPUT/.test(noToken?.__error ?? ''),
    'staff set 4PX\'s Shopify name; tracking links must be https and contain {tracking}');
  const health = await rpc(`select c0_connector_health() r`);
  const woo = health?.platforms?.find((p) => p.platform === 'woocommerce');
  ok(health?.platforms?.length === 12 && woo?.connecting >= 1 && woo.requested >= 0 && health.can_edit === true,
    'staff connector health: one row per planned platform (connected / connecting / needs reconnect / failures / last error / requested)');
  ok(health?.requested?.some((r) => r.platform === 'magento' && r.merchants >= 1) && health.requested.some((r) => r.platform === 'other' && (r.names ?? []).includes('Salla Pro'))
     && health.csv?.imports_24h >= 2 && health.csv.failed_rows_24h >= 2 && health.tracking_names?.length >= 2 && typeof health.poll?.targets === 'number',
    'requested-platforms list (with typed names), CSV connector numbers, tracking names and the carrier poll are on the card');
  await as(A.uid);
  ok(/FORBIDDEN/.test((await rpc(`select c0_connector_health() r`))?.__error ?? ''), 'merchants cannot open the connector health');
  const feed = await rpc(`select c0_product_feed() r`);
  ok(Array.isArray(feed) && feed.some((f) => f.variant_model_no === V.model_no) && !/cost|supplier/i.test(Object.keys(feed[0] ?? {}).join(',')),
    'product feed: the merchant\'s imported variants (DS model numbers), no cost or supplier fields');
  const trk = await rpc(`select c0_tracking_export((current_date - 5)::date, current_date) r`);
  const trkBad = await rpc(`select c0_tracking_export(current_date, (current_date - 5)::date) r`);
  ok(Array.isArray(trk) && /INVALID_INPUT/.test(trkBad?.__error ?? ''), 'tracking export: returns the merchant\'s shipped orders; a backwards range is refused');
  await as(B.uid);
  const feedB = await rpc(`select c0_product_feed() r`);
  ok(Array.isArray(feedB) && feedB.length === 0, 'another merchant\'s feed is empty (their own import list only)');

  // ── 8. cron job + audit ──
  await owner();
  const job = (await one(`select job_carrier_tracking_poll() r`)).r;
  ok(job === null || Number(job) === 0, 'the scheduled carrier poll does nothing while no live label is on the way (no HTTP call)');
  const acts = await all(`select action, count(*)::int n from audit_log where action in ('ds_channel.platform_requested', 'ds_channel.store_link_checked', 'ds_csv.orders_imported', 'c0.tracking_name_saved', 'wh_label.customs_blocked', 'store_credential.saved', 'store_credential.deleted', 'ds_channel.waitlist_joined') and created_at > now() - interval '1 hour' group by 1`);
  const has = (a) => acts.some((x) => x.action === a && x.n > 0);
  ok(['ds_channel.platform_requested', 'ds_channel.store_link_checked', 'ds_csv.orders_imported', 'c0.tracking_name_saved', 'wh_label.customs_blocked', 'store_credential.saved', 'store_credential.deleted', 'ds_channel.waitlist_joined'].every(has),
    'every C0 write is audited (requests, link checks, CSV imports, tracking names, customs blocks, credentials)');

  // ── 9. round trip (staging; the PGlite harness does its own) ──
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
    await db.query('savepoint c0rt');
    try {
      // the tests above created rows the old CHECKs refuse; remove them inside this savepoint only
      await db.query(`delete from store_connections where platform <> 'shopify' and org_id in ($1, $2)`, [A.org, B.org]);
      await db.query(`delete from store_orders where channel not in ('shopify', 'woocommerce', 'csv', 'manual', 'api') and org_id in ($1, $2)`, [A.org, B.org]);
      await ctx.unwindLater(db);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const gone = Number((await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES])).n);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n);
      const qdef = (await one(`select pg_get_functiondef('public.get_dropship_order_quote(jsonb,text,text,text,text,numeric,text)'::regprocedure) d`)).d;
      const pdef = (await one(`select pg_get_functiondef('public.wh_label_plan(uuid)'::regprocedure) d`)).d;
      ok(gone === 0 && fnLeft === 0 && !/C0/.test(qdef) && !/wh_customs_check/.test(pdef), 'down: every C0 table and function is gone; the replaced functions are the installed ones again');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint c0rt');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_c0_connector_foundation.sql'));
  if (!MIG) { console.error('✘ C0 migration file not found'); process.exit(1); }
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
    failed = await runC0Checks(db, {
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
  console.log(failed ? `\nc0-connectors: ${failed} check(s) failed` : '\nc0-connectors: all passed');
  process.exitCode = failed ? 1 : 0;
}
