// CH-1 · Shop — DB checks for migration *_ch1_shop_quote_list (251).
// STAGING ONLY, one rolled-back transaction, acting as customers / staff through JWT claims (what PostgREST does).
//  0. Structure: 3 new tables with RLS; column read grants only (no direct writes); RPC grants; helpers not callable; search_path=public.
//  1. shop_submit_rfq: role (viewer refused), staff refused, MOQ check names the minimum, ship-to required, RFQ-<n> + line 1,
//     sourcing fee from settings (rfqs.fee_minor = current_service_price('rfq')), idempotent, other companies can't read the lines.
//  2. Quote list: add / update / remove (company only), MOQ checked on send, ONE RFQ with N lines, fee once, list emptied,
//     idempotent, empty list refused, list limit 50 (when there are enough live products).
//  3. Wallet on + no money: nothing is created (the request and its lines roll back together).
//  4. Recently viewed: own rows only, counts, non-live ignored, newest 50 kept.
//  5. Personal picks: live ids only, the company's request category first, limit respected.
//  6. 3PL application linked to the signed-in company (single sign-in gap G1).
//  7. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/ch1-shop.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runCh1Checks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const skip = (m) => console.log(`- skipped: ${m}`);
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
    await db.query('savepoint ch1');
    try { await db.query(q, p); await db.query('release savepoint ch1'); return ''; }
    catch (e) { await db.query('rollback to savepoint ch1'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint ch1r');
    try { const r = (await db.query(q, p)).rows[0]; await db.query('release savepoint ch1r'); return r; }
    catch (e) { await db.query('rollback to savepoint ch1r'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const TABLES = ['rfq_lines', 'quote_list_items', 'product_views'];
  const RPC_FNS = ['shop_submit_rfq', 'quote_list_add', 'quote_list_update', 'quote_list_remove', 'quote_list_submit', 'shop_record_view', 'shop_personal_picks', 'wh_link_my_application'];
  const INTERNAL_FNS = ['shop_member_can', 'shop_guard', 'shop_clean'];

  // ── 0. structure ──
  await owner();
  const rls = await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === 3 && rls.every((r) => r.relrowsecurity), '3 new tables, RLS on every one');
  const grants = await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [TABLES]);
  ok(grants.length === 0, 'no table-wide grant to anon or signed-in users (no direct insert / update / delete)');
  const colGrants = await all(`select table_name, column_name from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated' and privilege_type = 'SELECT'`, [TABLES]);
  const cols = (t) => colGrants.filter((c) => c.table_name === t).map((c) => c.column_name);
  ok(cols('rfq_lines').includes('quantity') && !cols('rfq_lines').includes('idem_key') && cols('quote_list_items').includes('notes') && !cols('quote_list_items').includes('added_by')
     && cols('product_views').length === 3 && !cols('product_views').includes('user_id'), 'column read grants: no idempotency key, no "added by", views without user id');
  const pols = await all(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(pols.length === 3 && pols.every((p) => p.cmd === 'SELECT'), 'one read policy per table, no write policy');
  const fns = await all(`select p.proname, p.proconfig::text cfg, p.prosecdef def, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  ok(fns.length === RPC_FNS.length + INTERNAL_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), 'every new function exists with search_path=public');
  ok(fns.every((f) => !f.anon_x), 'anon executes none of them');
  ok(fns.filter((f) => RPC_FNS.includes(f.proname)).every((f) => f.auth_x) && fns.filter((f) => INTERNAL_FNS.includes(f.proname)).every((f) => !f.auth_x),
    'signed-in users execute the shop RPCs only, never the guard / role / text helpers');
  const tagRows = await all(`select slug from tags where slug in ('customisable', 'samples') and kind = 'service'`);
  ok(tagRows.length === 2, 'filter tags "customisable" and "samples" exist (kind service)');

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `ch1-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles (id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `CH1 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles (user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkOrg = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country) values ($1, 'AE') returning id`, [`CH1 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    return { org, uid };
  };
  const A = await mkOrg('a');
  const B = await mkOrg('b');
  const buyer = await mkUser('a-buyer');
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'buyer')`, [A.org, buyer]);
  const viewer = await mkUser('a-viewer');
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'viewer')`, [A.org, viewer]);
  const admin = await mkUser('admin', 'admin');
  // the sourcing fee goes through the wallet only when wallet_enabled: test the request logic with it off, the wallet path in §3
  const walletWas = (await one(`select value from site_settings where key = 'wallet_enabled'`))?.value ?? null;
  await db.query(`insert into site_settings (key, value) values ('wallet_enabled', 'false'::jsonb) on conflict (key) do update set value = 'false'::jsonb`);
  const prods = await all(`select id, title, coalesce(moq, 1) moq, category_id from products where status = 'live' and archived_at is null order by (moq > 1) desc, created_at limit 60`);
  if (prods.length < 3) { ok(false, `needs at least 3 live products (found ${prods.length})`); return failed; }
  const [P1, P2, P3] = prods;
  const fee = Number((await one(`select coalesce(current_service_price('rfq', current_platform_currency()), 0) f`)).f);

  // ── 1. single request ──
  await as(viewer);
  let r = await rpc(`select shop_submit_rfq($1, $2, 'AE') x`, [P1.id, P1.moq]);
  ok(/ROLE_NOT_ALLOWED/.test(r.__error ?? ''), 'viewer: a request is refused (ROLE_NOT_ALLOWED)');
  await as(admin, 'aal2');
  r = await rpc(`select shop_submit_rfq($1, $2, 'AE') x`, [P1.id, P1.moq]);
  ok(/STAFF_CANNOT_BE_CUSTOMER/.test(r.__error ?? ''), 'staff: refused (staff never act as customers)');
  await as(A.uid);
  if (P1.moq > 1) {
    r = await rpc(`select shop_submit_rfq($1, $2, 'AE') x`, [P1.id, P1.moq - 1]);
    ok((r.__error ?? '').startsWith(`BELOW_MOQ: ${P1.moq} |`), `below MOQ → BELOW_MOQ with the minimum (${P1.moq}) and the product`);
  } else skip('no live product with MOQ > 1');
  r = await rpc(`select shop_submit_rfq($1, $2, null) x`, [P1.id, P1.moq]);
  ok(/SHIP_TO_REQUIRED/.test(r.__error ?? ''), 'no ship-to country → SHIP_TO_REQUIRED');
  r = await rpc(`select shop_submit_rfq($1, $2, 'AE', 'Dubai', 185, array['Logo print', 'Logo print', ' Custom colour '], 'Need it by March', $3) x`, [P1.id, P1.moq, `idem-${stamp}-1`]);
  const s1 = r.x;
  ok(s1 && /^RFQ-\d+$/.test(s1.code) && s1.lines === 1 && s1.duplicate === false, `request created with code ${s1?.code}`);
  await owner();
  const rfq1 = await one(`select org_id, product_id, quantity, destination_country, destination_city, target_price_cents, fee_minor, details from rfqs where id = $1`, [s1?.id]);
  const line1 = await one(`select line_no, product_id, quantity, customisation, notes, idem_key from rfq_lines where rfq_id = $1`, [s1?.id]);
  ok(rfq1?.org_id === A.org && rfq1.product_id === P1.id && rfq1.quantity === P1.moq && rfq1.destination_country === 'AE' && Number(rfq1.target_price_cents) === 185,
    'rfqs row: company, product, quantity, ship-to, target price');
  ok(Number(rfq1?.fee_minor) === fee, `sourcing fee from settings (${fee} minor units) on the request`);
  ok(line1?.line_no === 1 && line1.product_id === P1.id && line1.customisation.length === 2 && line1.notes === 'Need it by March' && /Customisation: /.test(rfq1.details),
    'line 1 mirrors the request; customisation cleaned + de-duplicated; notes kept');
  await as(A.uid);
  r = await rpc(`select shop_submit_rfq($1, $2, 'AE', null, null, '{}', null, $3) x`, [P1.id, P1.moq, `idem-${stamp}-1`]);
  ok(r.x?.id === s1?.id && r.x.duplicate === true, 'same request key again → the same request (no second RFQ, no second fee)');
  await as(buyer);
  ok(Number((await one(`select count(*) n from rfq_lines where rfq_id = $1`, [s1?.id])).n) === 1, 'buyer of the same company reads the lines');
  await as(B.uid);
  ok(Number((await one(`select count(*) n from rfq_lines where rfq_id = $1`, [s1?.id])).n) === 0, 'another company reads nothing');
  ok(/permission denied/.test(await err(`insert into rfq_lines (rfq_id, line_no, title, quantity) values ($1, 2, 'x', 1)`, [s1?.id])), 'signed-in users cannot insert lines directly');
  await as(admin, 'aal2');
  ok(Number((await one(`select count(*) n from rfq_lines where rfq_id = $1`, [s1?.id])).n) === 1, 'request staff read the lines (same visibility as the RFQ)');

  // ── 2. quote list ──
  await as(viewer);
  r = await rpc(`select quote_list_add($1) x`, [P1.id]);
  ok(/ROLE_NOT_ALLOWED/.test(r.__error ?? ''), 'viewer: cannot add to the quote list');
  await as(buyer);
  r = await rpc(`select quote_list_add($1) x`, [P1.id]);
  ok(r.x?.count === 1, 'buyer adds product 1 (quantity defaults to its MOQ)');
  await as(A.uid);
  await rpc(`select quote_list_add($1, $2, 'blue') x`, [P2.id, P2.moq + 10]);
  r = await rpc(`select quote_list_add($1) x`, [P3.id]);
  ok(r.x?.count === 3, 'owner adds products 2 and 3 → 3 items for the company');
  r = await rpc(`select quote_list_add($1, $2) x`, [P1.id, P1.moq + 5]);
  ok(r.x?.count === 3, 'adding the same product again updates it (no duplicate)');
  const items = await all(`select id, product_id, quantity, notes from quote_list_items where org_id = $1 order by seq`, [A.org]);
  ok(items.length === 3 && items[0].quantity === P1.moq + 5 && items[1].notes === 'blue', 'the company reads its list (quantities + notes)');
  await as(B.uid);
  ok(Number((await one(`select count(*) n from quote_list_items where org_id = $1`, [A.org])).n) === 0, 'another company cannot see the list');
  r = await rpc(`select quote_list_remove($1) x`, [items[2].id]);
  ok(r.x?.count === 0, 'another company cannot remove an item (its own list stays empty)');
  ok(/permission denied/.test(await err(`insert into quote_list_items (org_id, product_id, quantity) values ($1, $2, 1)`, [A.org, P1.id])), 'no direct insert into the quote list');
  await as(A.uid);
  if (P1.moq > 1) {
    await rpc(`select quote_list_update($1, $2) x`, [items[0].id, P1.moq - 1]);
    r = await rpc(`select quote_list_submit('AE') x`);
    ok((r.__error ?? '').startsWith(`BELOW_MOQ: ${P1.moq} | ${P1.title}`), 'send with one item below MOQ → refused, naming the product');
    await rpc(`select quote_list_update($1, $2) x`, [items[0].id, P1.moq + 5]);
  } else skip('MOQ check on send (no product with MOQ > 1)');
  r = await rpc(`select quote_list_submit('') x`);
  ok(/SHIP_TO_REQUIRED/.test(r.__error ?? ''), 'send without ship-to → SHIP_TO_REQUIRED');
  await owner();
  const auditBefore = Number((await one(`select count(*) n from audit_log where action = 'shop.quote_list_submitted'`)).n);
  await as(A.uid);
  r = await rpc(`select quote_list_submit('SA', 'Riyadh', 'One shipment please', $1) x`, [`idem-${stamp}-ql`]);
  const ql = r.x;
  ok(ql && /^RFQ-\d+$/.test(ql.code) && ql.lines === 3 && ql.duplicate === false, `three products → ONE request ${ql?.code} with 3 lines`);
  await owner();
  const qlRfq = await one(`select product_id, quantity, title, fee_minor, destination_country from rfqs where id = $1`, [ql?.id]);
  const qlLines = await all(`select line_no, product_id, quantity, notes from rfq_lines where rfq_id = $1 order by line_no`, [ql?.id]);
  ok(qlLines.length === 3 && qlLines.map((l) => l.product_id).join() === [P1.id, P2.id, P3.id].join() && qlLines[1].notes === 'blue' && qlLines[0].quantity === P1.moq + 5,
    'lines in the order added, with quantities and notes');
  ok(qlRfq?.product_id === P1.id && qlRfq.quantity === P1.moq + 5 && /^3 products: /.test(qlRfq.title) && qlRfq.destination_country === 'SA', 'the request row = line 1, title "3 products: …", ship-to');
  ok(Number(qlRfq?.fee_minor) === fee && Number((await one(`select count(*) n from rfqs where org_id = $1`, [A.org])).n) === 2, 'one sourcing fee for the whole list (one RFQ, not three)');
  ok(Number((await one(`select count(*) n from quote_list_items where org_id = $1`, [A.org])).n) === 0, 'the quote list is empty after sending');
  ok(Number((await one(`select count(*) n from audit_log where action = 'shop.quote_list_submitted'`)).n) === auditBefore + 1, 'audited');
  await as(A.uid);
  r = await rpc(`select quote_list_submit('SA', null, null, $1) x`, [`idem-${stamp}-ql`]);
  ok(r.x?.id === ql?.id && r.x.duplicate === true, 'same request key again → the same request');
  r = await rpc(`select quote_list_submit('SA') x`);
  ok(/QUOTE_LIST_EMPTY/.test(r.__error ?? ''), 'sending an empty list → QUOTE_LIST_EMPTY');
  if (prods.length >= 51) {
    await owner();
    await db.query(`insert into quote_list_items (org_id, product_id, quantity) select $1, id, 1 from unnest($2::uuid[]) id`, [B.org, prods.slice(0, 50).map((p) => p.id)]);
    await as(B.uid);
    r = await rpc(`select quote_list_add($1) x`, [prods[50].id]);
    ok(/QUOTE_LIST_FULL/.test(r.__error ?? ''), 'a 51st product → QUOTE_LIST_FULL');
    await owner();
    await db.query(`delete from quote_list_items where org_id = $1`, [B.org]);
  } else skip(`quote list limit (needs 51 live products, found ${prods.length})`);

  // ── 3. wallet on, no money → nothing is created ──
  if (fee > 0) {
    await owner();
    await db.query(`update site_settings set value = 'true'::jsonb where key = 'wallet_enabled'`);
    const before = Number((await one(`select count(*) n from rfqs where org_id = $1`, [A.org])).n);
    await as(A.uid);
    r = await rpc(`select shop_submit_rfq($1, $2, 'AE') x`, [P2.id, P2.moq]);
    await owner();
    ok(!!r.__error && Number((await one(`select count(*) n from rfqs where org_id = $1`, [A.org])).n) === before
       && Number((await one(`select count(*) n from rfq_lines l join rfqs q on q.id = l.rfq_id where q.org_id = $1`, [A.org])).n) === 4,
      `wallet on with no money → refused (${(r.__error ?? '').split(':')[0]}); no request and no line created`);
    await db.query(`update site_settings set value = 'false'::jsonb where key = 'wallet_enabled'`);
  } else skip('wallet path (sourcing fee is 0)');

  // ── 4. recently viewed ──
  await as(A.uid);
  await rpc(`select shop_record_view($1) x`, [P1.id]);
  await rpc(`select shop_record_view($1) x`, [P1.id]);
  await rpc(`select shop_record_view($1) x`, [P2.id]);
  const views = await all(`select product_id, views from product_views order by viewed_at desc`);
  ok(views.length === 2 && views.find((v) => v.product_id === P1.id)?.views === 2, 'views recorded per product with a count');
  await as(buyer);
  ok(Number((await one(`select count(*) n from product_views`)).n) === 0, 'another member of the same company does not see them (own rows only)');
  await owner();
  const draft = await one(`select id from products where status <> 'live' limit 1`);
  if (draft) {
    await as(A.uid);
    await rpc(`select shop_record_view($1) x`, [draft.id]);
    ok(Number((await one(`select count(*) n from product_views`)).n) === 2, 'a product that is not live is ignored');
  } else skip('non-live product view (no such product)');
  if (prods.length >= 52) {
    await as(A.uid);
    for (const p of prods.slice(0, 52)) await rpc(`select shop_record_view($1) x`, [p.id]);
    ok(Number((await one(`select count(*) n from product_views`)).n) === 50, 'only the newest 50 views are kept');
  } else skip(`view trim (needs 52 live products, found ${prods.length})`);
  await as(admin, 'aal2');
  await rpc(`select shop_record_view($1) x`, [P1.id]);
  await owner();
  ok(Number((await one(`select count(*) n from product_views where user_id = $1`, [admin])).n) === 0, 'staff views are not recorded');

  // ── 5. personal picks ──
  await as(A.uid);
  const picks = await all(`select product_id, reason from shop_personal_picks(5)`);
  await owner();
  const liveIds = new Set((await all(`select id from products where status = 'live' and archived_at is null and id = any($1)`, [picks.map((p) => p.product_id)])).map((x) => x.id));
  ok(picks.length > 0 && picks.length <= 5 && picks.every((p) => liveIds.has(p.product_id)), `picks: ${picks.length} live products (limit 5)`);
  const topCat = (await one(`select category_id from products where id = $1`, [picks[0]?.product_id]))?.category_id;
  ok(picks[0]?.reason === 'history' && [P1.category_id, P2.category_id, P3.category_id].includes(topCat), 'the company\'s own request categories come first (reason "history")');
  const cols2 = await all(`select a.attname from pg_attribute a where a.attrelid = 'public.products'::regclass and a.attnum > 0`);
  ok(cols2.length > 0 && Object.keys(picks[0] ?? {}).sort().join() === 'product_id,reason', 'picks return a product id + reason only (no supplier, cost or counts)');
  await as(B.uid);
  const picksB = await all(`select reason from shop_personal_picks(3)`);
  ok(picksB.length > 0 && picksB.every((p) => p.reason !== 'history'), 'a company with no history gets popular / featured / newest');

  // ── 6. 3PL application → the signed-in company ──
  // the application row as wh_submit_application writes it for a signed-in visitor (submitted_by = them, no company yet)
  await owner();
  const app = await one(`insert into wh_applications (company, contact_name, email, sells, orders_band, stock_route, submitted_by)
    values ('CH1 B', 'B Owner', $1, 'Home goods', 'under_100', 'octopus_b2b', $2) returning code`, [`ch1-b-${stamp}@example-company.com`, B.uid]);
  await as(A.uid);
  r = await rpc(`select wh_link_my_application($1) x`, [app.code]);
  ok(r.x === false, 'someone else cannot link the application');
  await as(B.uid);
  r = await rpc(`select wh_link_my_application($1) x`, [app.code]);
  await owner();
  const linked = await one(`select org_id from wh_applications where code = $1`, [app.code]);
  ok(r.x === true && linked?.org_id === B.org, `3PL application ${app.code} linked to the signed-in company (no second account)`);
  await as(B.uid);
  r = await rpc(`select wh_link_my_application($1) x`, [app.code]);
  ok(r.x === false, 'linking twice does nothing');

  await owner();
  if (walletWas !== null) await db.query(`update site_settings set value = $1::jsonb where key = 'wallet_enabled'`, [JSON.stringify(walletWas)]);

  // ── 7. round trip (staging) ──
  if (ctx.staging) {
    await db.query('savepoint ch1rt');
    try {
      await ctx.unwindLater(db);
      // The down drops tables with foreign keys to products / rfqs, which takes an ACCESS EXCLUSIVE lock on products until this
      // transaction ends: every public product read waits meanwhile (anon statement_timeout 3 s). So the schema snapshot is a single
      // server-side md5 (no rows shipped to the client) and the locked window stays around a second instead of ~25 s.
      const SNAP = `select md5(string_agg(k || '|' || x, E'\\n' order by k, x)) h from (
        select 'rel' k, c.relname || ':' || c.relkind::text || ':' || coalesce(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity x from pg_class c where c.relnamespace = 'public'::regnamespace
        union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
        union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
        union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
        union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
        union all select 'fn', p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      ) s`;
      const snapSchema = async () => (await one(SNAP)).h;
      await db.query(`set local lock_timeout = '5s'`);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const gone = Number((await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES])).n);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n);
      ok(gone === 0 && fnLeft === 0, 'down: every CH-1 table and function is gone');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint ch1rt');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ch1_shop_quote_list.sql'));
  if (!MIG) { console.error('✘ CH-1 migration file not found'); process.exit(1); }
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
    failed = await runCh1Checks(db, {
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
  console.log(failed ? `\nch1-shop: ${failed} check(s) failed` : '\nch1-shop: all passed');
  process.exitCode = failed ? 1 : 0;
}
