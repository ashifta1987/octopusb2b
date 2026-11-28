// ODS T5a · Cart (no money) — DB checks for migration *_shop_cart (253, DRAFT).
// STAGING ONLY, one rolled-back transaction, acting as customers / staff through JWT claims (what PostgREST does).
// Self-contained: if 253 is not applied yet it is applied INSIDE the transaction (and rolled back with everything else);
// fixtures (a ready-stock product with tiers + tracked stock, a sample fee, an open pool) are set up on existing live
// products inside the same transaction. Nothing survives the run.
//  0. Structure: 2 new tables with RLS; column read grants only (no direct writes); 3 new quote_list_items columns;
//     RPC grants; internal helpers not callable; search_path=public; no supplier / cost / margin in shop_cart_lines().
//  1. Roles: viewer reads but can't act (ROLE_NOT_ALLOWED), staff refused, other companies see / change nothing,
//     no direct insert / update / delete.
//  2. Buy now: stock MOQ / stock limit / tier price, adding twice merges the quantity (one line), sample fee + 1–5 limit,
//     NO_FIXED_PRICE for brand / service / made-to-order, pool minimum + price + held deposit, save for later.
//  3. Re-check: price changed → snapshot updated + notice; stock reduced → quantity lowered + notice;
//     pool closed → line removed and the product moved to the quote list + notice.
//  4. Get a quote: target price + customisation (validated); quote_list_submit sends only lines NOT saved for later,
//     copies target price + customisation into rfq_lines, keeps saved lines, one RFQ, idempotent, empty → QUOTE_LIST_EMPTY.
//  5. Ship-to: set / validated / company only.
//  6. No money: no ledger entry, wallet move, payment, order, pool pledge or service request is created by any cart RPC.
//  7. (staging) down → up → up → down: identical schema; the down restores the 251 quote_list_submit exactly.
// Run (after `node scripts/db-migrate.mjs` on staging, or before it — see above): node supabase/tests/shop-cart.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runShopCartChecks(db, ctx) {
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
    await db.query('savepoint sc');
    try { await db.query(q, p); await db.query('release savepoint sc'); return ''; }
    catch (e) { await db.query('rollback to savepoint sc'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint scr');
    try { const r = (await db.query(q, p)).rows[0]; await db.query('release savepoint scr'); return r; }
    catch (e) { await db.query('rollback to savepoint scr'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const TABLES = ['shop_carts', 'shop_cart_items'];
  const RPC_FNS = ['shop_cart_lines', 'shop_cart_add', 'shop_cart_update', 'shop_cart_remove', 'shop_cart_save_for_later',
    'quote_list_update_details', 'shop_cart_set_ship_to', 'shop_cart_recheck'];
  const INTERNAL_FNS = ['shop_cart_stock', 'shop_cart_tier_price', 'shop_cart_source', 'shop_cart_assert_qty', 'shop_cart_raise',
    'shop_cart_to_quote', 'shop_cart_count'];
  const MONEY_TABLES = ['ledger_entries', 'orders', 'payments', 'pool_pledges', 'service_requests'];

  // ── apply 253 inside the transaction when it isn't there yet (rolled back at the end) ──
  await owner();
  if (!(await one(`select to_regclass('public.shop_cart_items') t`)).t) {
    await db.query(ctx.UP);
    console.log('- 253 not applied on this database: applied inside the test transaction (rolled back at the end)');
  }

  // ── 0. structure ──
  const rls = await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === 2 && rls.every((r) => r.relrowsecurity), '2 new tables, RLS on both');
  const grants = await all(`select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [[...TABLES, 'quote_list_items']]);
  ok(grants.length === 0, 'no table-wide grant to anon or signed-in users (no direct insert / update / delete)');
  const colGrants = await all(`select table_name, column_name from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated' and privilege_type = 'SELECT'`, [[...TABLES, 'quote_list_items']]);
  const cols = (t) => colGrants.filter((c) => c.table_name === t).map((c) => c.column_name);
  ok(cols('shop_cart_items').includes('unit_price_minor') && !cols('shop_cart_items').includes('added_by') && cols('shop_carts').includes('ship_to_country') && !cols('shop_carts').includes('updated_by'),
    'column read grants: prices and ship-to readable, "added by" / "updated by" not');
  ok(['target_price_minor', 'customisation', 'saved_for_later'].every((c) => cols('quote_list_items').includes(c)), 'quote_list_items: target price, customisation, saved for later added and readable');
  const pols = await all(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(pols.length === 2 && pols.every((p) => p.cmd === 'SELECT'), 'one read policy per table, no write policy');
  const fns = await all(`select p.proname, p.proconfig::text cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  ok(fns.length === RPC_FNS.length + INTERNAL_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), 'every new function exists once with search_path=public');
  ok(fns.every((f) => !f.anon_x), 'anon executes none of them');
  ok(fns.filter((f) => RPC_FNS.includes(f.proname)).every((f) => f.auth_x) && fns.filter((f) => INTERNAL_FNS.includes(f.proname)).every((f) => !f.auth_x),
    'signed-in users execute the cart RPCs only, never the source / stock / price helpers');
  const outCols = (await all(`select unnest(proargnames) n from pg_proc where proname = 'shop_cart_lines' and pronamespace = 'public'::regnamespace`)).map((r) => r.n);
  ok(outCols.length > 0 && !outCols.some((n) => /supplier|cost|margin|factory|model/i.test(n)), 'shop_cart_lines() returns no supplier / factory / cost / margin column');

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `cart-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles (id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `Cart ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles (user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkOrg = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country) values ($1, 'AE') returning id`, [`Cart ${tag} ${stamp}`])).id;
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
  await owner();
  const setSetting = (k, v) => db.query(`insert into site_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [k, v]);
  await setSetting('wallet_enabled', 'false');
  await setSetting('pool_enabled', 'true');
  const cur = (await one(`select current_platform_currency() c`)).c;
  const prods = await all(`select id, title, supplier_id from products where status = 'live' and archived_at is null order by created_at limit 4`);
  if (prods.length < 4) { ok(false, `needs at least 4 live products (found ${prods.length})`); return failed; }
  const [P1, P2, P3, P4] = prods; // P1 ready stock · P2 sample · P3 pool · P4 made to order
  const tiers = async (p, rows) => {
    await db.query(`delete from price_tiers where product_id = $1`, [p.id]);
    for (const [min, cents] of rows) await db.query(`insert into price_tiers (product_id, min_qty, unit_price_cents, currency) values ($1, $2, $3, $4)`, [p.id, min, cents, cur]);
  };
  const setStock = async (p, qty) => {
    await db.query(`update supplier_products set stock_qty = null where product_id = $1`, [p.id]);
    await db.query(`insert into supplier_products (supplier_id, product_id, status, stock_qty) values ($1, $2, 'quoted', $3)
      on conflict (supplier_id, product_id) do update set stock_qty = excluded.stock_qty, status = 'quoted'`, [p.supplier_id, p.id, qty]);
  };
  await db.query(`update products set ready_to_ship = true, moq = 10 where id = $1`, [P1.id]);
  await tiers(P1, [[10, 500], [100, 400]]);
  await setStock(P1, 60);
  await db.query(`update products set moq = 1 where id = any($1)`, [[P2.id, P3.id]]);
  await db.query(`update products set ready_to_ship = false, moq = 50 where id = $1`, [P4.id]);
  await tiers(P4, [[50, 900]]);
  await db.query(`update services set active = true where code = 'sample'`);
  await db.query(`insert into service_prices (service_code, amount_minor, currency, effective_from) values ('sample', 2500, $1, now() - interval '1 second')`, [cur]);
  const fee = Number((await one(`select current_service_price('sample', $1) f`, [cur])).f);
  await tiers(P3, [[1, 300], [50, 250]]);
  const pool = await one(`insert into pools (product_id, supplier_id, target_qty, min_pledge, max_buyers, deadline_at, currency, fx_rate_id, deposit_pct)
    values ($1, $2, 100, 5, 25, now() + interval '5 days', $3, current_fx_rate_id(), 10) returning id, code`, [P3.id, P3.supplier_id, cur]);
  const moneyCount = async () => {
    const out = {};
    for (const t of MONEY_TABLES) out[t] = (await one(`select to_regclass('public.' || $1) r`, [t])).r ? Number((await one(`select count(*) n from ${t}`)).n) : -1;
    return out;
  };
  const moneyBefore = await moneyCount();
  const lines = async () => all(`select * from shop_cart_lines()`);
  const header = async () => Number((await one(`select (select count(*) from shop_cart_items where org_id = $1) + (select count(*) from quote_list_items where org_id = $1) n`, [A.org])).n);

  // ── 1. roles ──
  await as(viewer);
  let r = await rpc(`select shop_cart_add('stock', $1, 20) x`, [P1.id]);
  ok(/ROLE_NOT_ALLOWED/.test(r.__error ?? ''), 'viewer: cannot add to the cart (ROLE_NOT_ALLOWED)');
  r = await rpc(`select shop_cart_set_ship_to('AE') x`);
  ok(/ROLE_NOT_ALLOWED/.test(r.__error ?? ''), 'viewer: cannot change the ship-to');
  await as(admin, 'aal2');
  r = await rpc(`select shop_cart_add('stock', $1, 20) x`, [P1.id]);
  ok(/STAFF_CANNOT_BE_CUSTOMER/.test(r.__error ?? ''), 'staff: refused (staff never act as customers)');

  // ── 2. Buy now ──
  await as(A.uid);
  r = await rpc(`select shop_cart_add('stock', $1, 5) x`, [P1.id]);
  ok((r.__error ?? '').startsWith(`BELOW_MOQ: 10 | ${P1.title}`), 'ready stock below MOQ → BELOW_MOQ with the minimum and the product');
  r = await rpc(`select shop_cart_add('stock', $1, 20) x`, [P1.id]);
  const stockId = r.x?.id;
  ok(!!stockId && r.x.qty === 20 && r.x.count === 1, 'owner adds 20 of the ready-stock product');
  await as(buyer);
  r = await rpc(`select shop_cart_add('stock', $1, 20) x`, [P1.id]);
  ok(r.x?.id === stockId && r.x.qty === 40, 'buyer adds the same product again → the SAME line, quantity 40 (one cart per company)');
  await as(A.uid);
  let ls = await lines();
  const stockLine = ls.find((l) => l.id === stockId);
  ok(ls.length === 1 && Number(stockLine?.unit_price_minor) === 500 && stockLine.min_qty === 10 && stockLine.max_qty === 60 && stockLine.slug,
    'line reads the tier price (500), MOQ 10, stock 60 and the product slug');
  r = await rpc(`select shop_cart_add('stock', $1, 30) x`, [P1.id]);
  ok((r.__error ?? '').startsWith(`ABOVE_STOCK: 60 | ${P1.title}`), 'adding past the stock (40 + 30 > 60) → ABOVE_STOCK with the stock');
  r = await rpc(`select shop_cart_update($1, 0) x`, [stockId]);
  ok(/INVALID_QUANTITY/.test(r.__error ?? ''), 'quantity 0 → INVALID_QUANTITY');
  r = await rpc(`select shop_cart_update($1, 9) x`, [stockId]);
  ok((r.__error ?? '').startsWith('BELOW_MOQ: 10'), 'update below MOQ → BELOW_MOQ');
  await owner();
  await setStock(P1, 200);
  await as(A.uid);
  r = await rpc(`select shop_cart_update($1, 150) x`, [stockId]);
  ok(r.x?.qty === 150 && Number((await one(`select unit_price_minor u from shop_cart_items where id = $1`, [stockId])).u) === 400, 'update to 150 → the 100+ tier price (400) is the new snapshot');
  r = await rpc(`select shop_cart_update($1, 60) x`, [stockId]);
  ok(r.x?.qty === 60 && Number((await one(`select unit_price_minor u from shop_cart_items where id = $1`, [stockId])).u) === 500, 'back to 60 → 500 again');
  await owner();
  await setStock(P1, 60);

  await as(A.uid);
  r = await rpc(`select shop_cart_add('sample', $1, 2) x`, [P2.id]);
  const sampleId = r.x?.id;
  ok(!!sampleId && Number((await one(`select unit_price_minor u from shop_cart_items where id = $1`, [sampleId])).u) === fee, `sample: price = the sample fee from settings (${fee})`);
  r = await rpc(`select shop_cart_update($1, 6) x`, [sampleId]);
  ok((r.__error ?? '').startsWith('ABOVE_MAX: 5'), 'sample: at most 5 pieces (ABOVE_MAX)');
  r = await rpc(`select shop_cart_add('stock', $1, 50) x`, [P4.id]);
  ok((r.__error ?? '').startsWith('NO_FIXED_PRICE'), 'made-to-order product as ready stock → NO_FIXED_PRICE (the UI offers Get a quote)');
  r = await rpc(`select shop_cart_add('service', 'rfq', 1) x`);
  ok((r.__error ?? '').startsWith('NO_FIXED_PRICE'), 'service without a fixed price (the sourcing fee) → NO_FIXED_PRICE');
  r = await rpc(`select shop_cart_add('brand', $1, 1) x`, [`brand_none_${stamp}`]);
  ok((r.__error ?? '').startsWith('NO_FIXED_PRICE'), 'Make My Brand without a fixed price → NO_FIXED_PRICE');
  r = await rpc(`select shop_cart_add('wallet', 'x', 1) x`);
  ok((r.__error ?? '').startsWith('INVALID_INPUT'), 'unknown line type → INVALID_INPUT');
  await owner();
  const fixedSvc = await one(`select s.code, current_service_price(s.code, $1) p from services s
    where s.active and s.code not in ('rfq', 'sample', 'dropship', 'dropship_request') and s.code not like 'brand%' and coalesce(current_service_price(s.code, $1), 0) > 0 order by s.code limit 1`, [cur]);
  await as(A.uid);
  if (fixedSvc) {
    r = await rpc(`select shop_cart_add('service', $1, 2) x`, [fixedSvc.code]);
    const svcLine = r.x?.id ? await one(`select unit_price_minor u, qty from shop_cart_items where id = $1`, [r.x.id]) : null;
    ok(Number(svcLine?.u) === Number(fixedSvc.p) && svcLine.qty === 2, `service with a fixed price (${fixedSvc.code}): price from settings › services`);
    r = await rpc(`select shop_cart_update($1, 11) x`, [r.x?.id]);
    ok((r.__error ?? '').startsWith('ABOVE_MAX: 10'), 'service: at most 10 (ABOVE_MAX)');
    r = await rpc(`select shop_cart_remove(id) x from shop_cart_items where org_id = $1 and kind = 'service'`, [A.org]);
    ok(r.x?.count === 2, 'remove → the line is gone (count back to 2)');
  } else skip('fixed-price service (no active service with a price)');

  r = await rpc(`select shop_cart_add('pool', $1, 2) x`, [pool.id]);
  ok((r.__error ?? '').startsWith('BELOW_MOQ: 5'), 'pool below its minimum pledge → BELOW_MOQ with the minimum');
  r = await rpc(`select shop_cart_add('pool', $1, 5) x`, [pool.id]);
  const poolId = r.x?.id;
  await owner();
  const poolPrice = Number((await one(`select pool_unit_price($1, 5, $2, (select fx_rate_id from pools where id = $3)) p`, [P3.id, cur, pool.id])).p);
  await as(A.uid);
  ls = await lines();
  const poolLine = ls.find((l) => l.id === poolId);
  ok(!!poolLine && Number(poolLine.unit_price_minor) === poolPrice && poolLine.pool_code === pool.code && Number(poolLine.deposit_minor) === Math.round(poolPrice * 5 * 0.1),
    `pool line: pool price ${poolPrice}, code ${pool.code}, held deposit 10 %`);
  r = await rpc(`select shop_cart_save_for_later('buy', $1, true) x`, [sampleId]);
  ok(r.x?.count === 3 && (await one(`select saved_for_later s from shop_cart_items where id = $1`, [sampleId])).s === true, 'save for later keeps the line (header count still 3)');
  r = await rpc(`select shop_cart_save_for_later('order', $1, true) x`, [sampleId]);
  ok((r.__error ?? '').startsWith('INVALID_INPUT'), 'save for later with an unknown line kind → INVALID_INPUT');
  r = await rpc(`select shop_cart_add('sample', $1, 1) x`, [P2.id]);
  ok(r.x?.qty === 3 && (await one(`select saved_for_later s from shop_cart_items where id = $1`, [sampleId])).s === false, 'adding a saved item again brings it back to Buy now with the quantity raised');

  // RLS + no direct writes
  await as(viewer);
  ok((await lines()).length === 3 && Number((await one(`select count(*) n from shop_cart_items`)).n) === 3, 'viewer reads the company cart (browse)');
  await as(B.uid);
  ok((await lines()).length === 0 && Number((await one(`select count(*) n from shop_cart_items where org_id = $1`, [A.org])).n) === 0, 'another company reads nothing');
  r = await rpc(`select shop_cart_remove($1) x`, [stockId]);
  r = await rpc(`select shop_cart_update($1, 20) x`, [stockId]);
  ok(/NOT_FOUND/.test(r.__error ?? ''), 'another company cannot change a line (NOT_FOUND)');
  ok(/permission denied/.test(await err(`insert into shop_cart_items (org_id, kind, ref_id, product_id, qty, unit_price_minor) values ($1, 'stock', $2, $3, 1, 1)`, [B.org, P1.id, P1.id])), 'no direct insert into cart lines');
  ok(/permission denied/.test(await err(`update shop_cart_items set unit_price_minor = 1 where org_id = $1`, [B.org])), 'no direct update of a price snapshot');
  ok(/permission denied/.test(await err(`insert into shop_carts (org_id) values ($1)`, [B.org])), 'no direct insert into carts');
  await as(A.uid);
  ok(Number((await one(`select count(*) n from shop_cart_items where id = $1`, [stockId])).n) === 1, '…and the line is still there for its company');

  // ── 3. re-check ──
  await owner();
  await tiers(P1, [[10, 450], [100, 400]]);
  await setStock(P1, 30);
  await db.query(`update pools set status = 'expired' where id = $1`, [pool.id]);
  await as(viewer);
  r = await rpc(`select shop_cart_recheck() x`);
  ok(/ROLE_NOT_ALLOWED/.test(r.__error ?? ''), 'viewer: the re-check (which changes lines) is refused');
  await as(A.uid);
  r = await rpc(`select shop_cart_recheck() x`);
  const notices = r.x?.notices ?? [];
  const nStock = notices.find((n) => n.kind === 'stock-reduced');
  const nPrice = notices.find((n) => n.kind === 'price-changed' && n.id === stockId);
  const nPool = notices.find((n) => n.kind === 'pool-closed');
  ok(nStock?.id === stockId && nStock.fromQty === 60 && nStock.toQty === 30, 'stock reduced 60 → 30: quantity lowered + notice');
  ok(nPrice?.fromMinor === 500 && nPrice.toMinor === 450 && Number((await one(`select unit_price_minor u from shop_cart_items where id = $1`, [stockId])).u) === 450, 'price changed 500 → 450: snapshot updated + notice');
  const movedQ = await one(`select id, quantity, saved_for_later from quote_list_items where org_id = $1 and product_id = $2`, [A.org, P3.id]);
  ok(Number((await one(`select count(*) n from shop_cart_items where id = $1`, [poolId])).n) === 0 && movedQ?.quantity === 5 && nPool?.id === movedQ.id && nPool.line === 'quote',
    'pool closed: the pool line is gone and the product is on the quote list (5) + notice on the quote line');
  r = await rpc(`select shop_cart_recheck() x`);
  ok((r.x?.notices ?? []).length === 0 && r.x.changed === 0, 'a second re-check finds nothing to change');

  // ── 4. Get a quote ──
  r = await rpc(`select quote_list_add($1) x`, [P4.id]);
  r = await rpc(`select quote_list_add($1) x`, [P2.id]);
  const q4 = (await one(`select id from quote_list_items where org_id = $1 and product_id = $2`, [A.org, P4.id])).id;
  const q2 = (await one(`select id from quote_list_items where org_id = $1 and product_id = $2`, [A.org, P2.id])).id;
  r = await rpc(`select quote_list_update_details($1, 60, 185, 'logo') x`, [q4]);
  ok(!r.__error, 'quantity 60, target price 1.85, customisation "logo" saved on a quote line');
  r = await rpc(`select quote_list_update_details($1, 60, 185, 'engraving') x`, [q4]);
  ok((r.__error ?? '').startsWith('INVALID_INPUT'), 'customisation outside the four options → INVALID_INPUT');
  r = await rpc(`select quote_list_update_details($1, 60, -1, null) x`, [q4]);
  ok(/INVALID_AMOUNT/.test(r.__error ?? ''), 'negative target price → INVALID_AMOUNT');
  await as(B.uid);
  r = await rpc(`select quote_list_update_details($1, 60, 185, 'logo') x`, [q4]);
  ok(/NOT_FOUND/.test(r.__error ?? ''), 'another company cannot change the quote line');
  await as(A.uid);
  r = await rpc(`select shop_cart_save_for_later('quote', $1, true) x`, [q2]);
  ok(!r.__error, 'a quote line saved for later');
  const headerBefore = await header();
  r = await rpc(`select quote_list_submit('AE', 'Dubai', 'Cart test', $1) x`, [`cart-${stamp}-1`]);
  const sent = r.x;
  ok(sent && /^RFQ-\d+$/.test(sent.code) && sent.lines === 2 && sent.duplicate === false, `send → ONE request ${sent?.code} with the 2 lines not saved for later`);
  await owner();
  const rl = await all(`select product_id, quantity, target_price_minor, customisation from rfq_lines where rfq_id = $1 order by line_no`, [sent?.id]);
  const l4 = rl.find((x) => x.product_id === P4.id);
  ok(rl.length === 2 && !rl.some((x) => x.product_id === P2.id), 'the saved-for-later product is not in the request');
  ok(l4?.quantity === 60 && Number(l4.target_price_minor) === 185 && l4.customisation.length === 1 && /logo/i.test(l4.customisation[0]), 'target price and customisation copied into the request line');
  ok(rl.find((x) => x.product_id === P3.id)?.target_price_minor == null, 'a line without a target price sends none');
  const left = await all(`select product_id, saved_for_later from quote_list_items where org_id = $1`, [A.org]);
  ok(left.length === 1 && left[0].product_id === P2.id && left[0].saved_for_later === true, 'the sent lines left the list; the saved line stayed');
  ok((await header()) === headerBefore - 2, 'header count = all lines (dropped by the 2 sent)');
  await as(A.uid);
  r = await rpc(`select quote_list_submit('AE', null, null, $1) x`, [`cart-${stamp}-1`]);
  ok(r.x?.id === sent?.id && r.x.duplicate === true, 'same request key again → the same request');
  r = await rpc(`select quote_list_submit('AE') x`);
  ok(/QUOTE_LIST_EMPTY/.test(r.__error ?? ''), 'only saved-for-later lines left → QUOTE_LIST_EMPTY (nothing sent)');

  // ── 5. ship-to ──
  r = await rpc(`select shop_cart_set_ship_to(' ae ', 'Dubai') x`);
  ok(r.x?.country === 'AE' && r.x.city === 'Dubai', 'ship-to saved (AE, Dubai)');
  r = await rpc(`select shop_cart_set_ship_to('United Arab Emirates') x`);
  ok(/SHIP_TO_REQUIRED/.test(r.__error ?? ''), 'not a 2-letter country → SHIP_TO_REQUIRED');
  await as(viewer);
  ok((await one(`select ship_to_country c from shop_carts where org_id = $1`, [A.org]))?.c === 'AE', 'members read the ship-to');
  await as(B.uid);
  ok(!(await one(`select ship_to_country c from shop_carts where org_id = $1`, [A.org])), 'another company does not');

  // ── 6. no money ──
  await owner();
  const moneyAfter = await moneyCount();
  // (quote_list_submit's sourcing fee goes through core_submit_rfq exactly as in 251; wallet_enabled is off here, so no ledger row)
  ok(MONEY_TABLES.every((t) => moneyAfter[t] === moneyBefore[t]),
    `no ledger entry, order, payment, pool pledge or service request created by the cart (${JSON.stringify(moneyAfter)})`);

  // ── 7. round trip (staging) ──
  if (ctx.staging || ctx.local) {
    await db.query('savepoint scrt');
    try {
      if (ctx.unwindLater) await ctx.unwindLater(db);
      const SNAP = `select md5(string_agg(k || '|' || x, E'\\n' order by k, x)) h from (
        select 'rel' k, c.relname || ':' || c.relkind::text || ':' || coalesce(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity x from pg_class c where c.relnamespace = 'public'::regnamespace
        union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
        union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
        union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
        union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
        union all select 'typ', t.typname from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'
        union all select 'fn', p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      ) s`;
      const snapSchema = async () => (await one(SNAP)).h;
      const submitDef = async () => (await one(`select md5(pg_get_functiondef('public.quote_list_submit(text,text,text,text)'::regprocedure)) h`)).h;
      if (ctx.staging) await db.query(`set local lock_timeout = '5s'`);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const gone = Number((await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES])).n);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n);
      const colLeft = Number((await one(`select count(*) n from information_schema.columns where table_schema = 'public' and table_name = 'quote_list_items' and column_name in ('target_price_minor', 'customisation', 'saved_for_later')`)).n);
      ok(gone === 0 && fnLeft === 0 && colLeft === 0 && !(await one(`select to_regtype('public.shop_cart_kind') t`)).t, 'down: every 253 table, function, column and the enum are gone');
      if (ctx.SUBMIT_251) {
        await db.query('savepoint scrt251');
        await db.query(ctx.SUBMIT_251);
        const def251 = await submitDef();
        await db.query('rollback to savepoint scrt251');
        ok((await submitDef()) === def251, 'down: quote_list_submit is the 251 body exactly');
      }
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      if (ctx.reapplyLater) await ctx.reapplyLater(db);
    } finally {
      await db.query('rollback to savepoint scrt');
    }
  } else skip('round trip (staging only)');
  return failed;
}

/** The 251 quote_list_submit statement, cut from the 251 file (to compare with what the 253 down restores). */
export function submit251(sql251) {
  const start = sql251.indexOf('create or replace function public.quote_list_submit(');
  const end = sql251.indexOf('end $$;', start);
  return start < 0 || end < 0 ? null : sql251.slice(start, end + 'end $$;'.length);
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_shop_cart.sql'));
  const MIG251 = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ch1_shop_quote_list.sql'));
  if (!MIG || !MIG251) { console.error('✘ cart (253) or CH-1 (251) migration file not found'); process.exit(1); }
  const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
  const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');
  const SUBMIT_251 = submit251(fs.readFileSync(`supabase/migrations/${MIG251}`, 'utf8'));
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await assertStagingDatabase(db);
  const { appliedAfter, unwind, reapply, MAX_UNWIND } = await import('./lib-later-migrations.mjs');
  let later = [];
  let failed = 0;
  try {
    await db.query('begin');
    const applied = (await db.query(`select to_regclass('public.shop_cart_items') t`)).rows[0].t;
    failed = await runShopCartChecks(db, {
      UP, DOWN, MIG, SUBMIT_251, staging: true,
      // later migrations exist only when 253 is really applied; otherwise there's nothing to unwind
      unwindLater: applied ? async (c) => { later = await appliedAfter(c, MIG); await unwind(c, later, MAX_UNWIND); } : null,
      reapplyLater: applied ? async (c) => { await reapply(c, later); } : null,
    });
  } catch (e) {
    console.log('✘ unexpected error: ' + e.message);
    failed++;
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
  console.log(failed ? `\nshop-cart: ${failed} check(s) failed` : '\nshop-cart: all passed');
  process.exitCode = failed ? 1 : 0;
}
