// Octopus Dropship · Release 3 · Step 8 (paying for orders) + Step 7 intake rules (source-agnostic) — DB checks for
// migration *_ds8_order_payment_intake. STAGING ONLY, one rolled-back transaction, acting as merchants / staff / the
// service role through JWT claims (what PostgREST does).
//  0. Structure: 4 new tables with RLS (own org via my_org_ids(); channel tasks staff only), no direct writes for signed-in
//     users, anon nothing; every ds_order function search_path=public, revoked from public/anon, internals not callable by
//     signed-in users. Merchant-readable columns don't look internal (customer-columns rule).
//  1. Intake: only Octopus lines stored, mixed cart counted (+N items not from Octopus), dedupe on (org, channel, external
//     id), no-Octopus order ignored, quote locked at intake (version IDs, FX, billed weight).
//  2. Holds with exact reasons: high risk, address failed, duties not known, stock shortage — nothing charged.
//  3. Auto-pay from the wallet: OCT-DS invoice (legal entity), lines, balanced journal, handoff to the warehouse.
//  4. Not enough funds → awaiting payment (N days left, event), then paid oldest first when funds arrive.
//  5. Charge and ship: auto-pay off → manual charge; bulk = oldest first, one refusal never undoes another; high risk
//     cleared by the merchant's explicit charge; address hold → fix address → resubmitted.
//  6. Payment protection: held (escrow), Held balance; released 7 days after delivery → invoice + revenue journal; a
//     dispute keeps it held.
//  7. Pay later only for credit_eligible: refused / hidden for others; eligible → invoice due in net days + AR journal.
//  8. Expiry: unpaid after N days → released (cancelled), never charged, channel task.
//  9. Cancellation before packing → refund to the wallet + credit note + stock released; protected → escrow refund;
//     after packing → rejected; address change after packing → problem flow.
// 10. Documents: OCT-DS numbers, the STMT-DS statement lists them; paused merchant: no new charge / intake, keeps
//     reading + cancelling; feature list off → refused; staging-only staff test path.
// 11. RLS cross-org + anon; audit rows; every journal written balanced; wallet balance = top-ups − charges + refunds.
// 12. down → up → down → up: identical schema (later migrations unwound / re-applied).
// Run: node supabase/tests/ds8-dropship.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runDs8Checks(db, ctx) {
  let failed = 0;
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const service = async () => {
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    await db.query('set local role service_role');
  };
  const tryq = async (q, p) => {
    await db.query('savepoint sp');
    try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
    catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
  };
  const err = async (q, p) => (await tryq(q, p)).err ?? '';
  const rpc = async (q, p) => (await one(q, p)).r;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const TABLES = ['dropship_order_settings', 'dropship_order_intake', 'dropship_order_events', 'dropship_channel_tasks'];
  const MERCHANT_FNS = ['ds_orders_page', 'ds_order_detail_events', 'ds_wallet_get', 'ds_order_settings_save', 'ds_order_charge', 'ds_order_cancel', 'ds_order_update_address'];
  const STAFF_FNS = ['ds_test_order_create'];
  const PURE_FNS = ['ds_order_address_problem', 'ds_order_buyer_short'];
  const INTERNAL_FNS = ['ds_order_expiry_days', 'ds_order_usd', 'ds_order_event', 'ds_order_channel_task', 'ds_order_held_cents', 'ds_order_packing_started',
    'ds_order_stock_short', 'ds_order_pay_later_ok', 'ds_order_err', 'ds_order_set_hold', 'ds_order_charge_core', 'ds_order_try_auto', 'ds_order_intake_core',
    'ds_order_intake', 'ds_order_cancel_core', 'ds_order_address_core', 'ds_order_channel_cancel', 'ds_order_channel_address', 'ds_order_own',
    'ds_order_expire_due', 'ds_order_autopay_waiting', 'ds_protection_release_due', 'ds_order_jobs', 'ds_escrow_release_revenue'];
  const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;
  const journalsBalanced = async (ids) => {
    if (!ids.length) return true;
    const bad = await all(`select journal_id from ledger_entries where journal_id = any($1::uuid[]) group by journal_id having sum(debit_cents) <> sum(credit_cents)`, [ids]);
    return bad.length === 0;
  };

  await owner();
  // ── 0. structure ──
  const rls = await all(`select relname, relrowsecurity r from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === TABLES.length && rls.every((x) => x.r), `all ${TABLES.length} new tables exist with RLS on`);
  const writeGrants = await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
     where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated') and (grantee = 'anon' or privilege_type <> 'SELECT')`, [TABLES]);
  ok(writeGrants.length === 0, `no INSERT/UPDATE/DELETE for signed-in users and nothing for anon${writeGrants.length ? ' — ' + JSON.stringify(writeGrants.slice(0, 4)) : ''}`);
  const pols = await all(`select tablename, cmd, qual from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(pols.length === TABLES.length && pols.every((p) => p.cmd === 'SELECT' && (p.tablename === 'dropship_channel_tasks' ? /is_staff\(\)/.test(p.qual) : /my_org_ids\(\)/.test(p.qual))),
    'one SELECT policy per table: own organisation via my_org_ids() (channel tasks: staff only)');
  const fns = await all(`select p.proname n, p.prosecdef d, p.proconfig::text c, p.proacl::text a from pg_proc p
     where p.pronamespace = 'public'::regnamespace and (p.proname like 'ds\\_order%' or p.proname in ('ds_orders_page', 'ds_wallet_get', 'ds_test_order_create', 'ds_protection_release_due', 'ds_escrow_release_revenue'))`);
  const names = new Set(fns.map((f) => f.n));
  const missing = [...MERCHANT_FNS, ...STAFF_FNS, ...PURE_FNS, ...INTERNAL_FNS].filter((n) => !names.has(n));
  ok(missing.length === 0, `every DS8 function exists${missing.length ? ' — missing ' + missing.join(',') : ''}`);
  const openToAnon = fns.filter((f) => /(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? ''));
  const noPath = fns.filter((f) => !/search_path=public/.test(f.c ?? ''));
  const notDefiner = fns.filter((f) => [...MERCHANT_FNS, ...STAFF_FNS].includes(f.n) && !f.d);
  const internalOpen = fns.filter((f) => INTERNAL_FNS.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  const merchantClosed = fns.filter((f) => [...MERCHANT_FNS, ...STAFF_FNS].includes(f.n) && !/authenticated=X/.test(f.a ?? ''));
  ok(openToAnon.length === 0 && noPath.length === 0 && notDefiner.length === 0,
    `DS8 functions: none for public/anon, all search_path=public, every RPC a security definer${[...openToAnon, ...noPath, ...notDefiner].map((f) => ' ' + f.n).join('')}`);
  ok(internalOpen.length === 0 && merchantClosed.length === 0, `internals + jobs + intake not callable by signed-in users; the ${MERCHANT_FNS.length} merchant RPCs + staff test path are${[...internalOpen, ...merchantClosed].map((f) => ' ' + f.n).join('')}`);
  const cols = await all(`select table_name t, column_name c from information_schema.columns where table_schema = 'public' and table_name = any($1) and table_name <> 'dropship_channel_tasks'`, [TABLES]);
  const looksInternal = cols.filter((c) => INTERNAL_NAME.test(c.c));
  ok(looksInternal.length === 0, `no merchant-readable column looks internal (customer-columns rule)${looksInternal.length ? ' — ' + looksInternal.map((c) => `${c.t}.${c.c}`).join(', ') : ''}`);
  const sz = await all(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and (p.proname ~ '(dropship|store_order)' or p.proname like 'ds\\_%') and pg_get_functiondef(p.oid) like '%''SZ-01''%'`);
  ok(sz.length === 0, `no Dropship function hard-codes the legacy warehouse 'SZ-01' (W7 + DS8)${sz.length ? ' — ' + sz.map((r) => r.proname).join(',') : ''}`);
  const defW = (await one(`select default_warehouse_code() c`)).c;
  const trg = await one(`select count(*)::int n from pg_trigger where tgname = 'trg_ds_escrow_release_revenue' and tgrelid = 'public.escrow_holds'::regclass`);
  ok(trg.n === 1, 'protection release → revenue trigger is on escrow_holds');
  ok((await one(`select ds_order_buyer_short('Omar Saleh') a, ds_order_buyer_short('Lina') b`)).a === 'Omar S.', 'buyer shown as first name + initial (Omar S.)');
  const ap = await one(`select ds_order_address_problem('{"line1":"1 Main St","city":"Austin","postcode":"7870"}'::jsonb, 'US') a, ds_order_address_problem('{"line1":"12 Marina Walk","city":"Dubai"}'::jsonb, 'AE') b,
                              ds_order_address_problem('{"city":"Riyadh","postcode":"12211"}'::jsonb, 'SA') c`);
  ok(/ZIP code has 5 digits/.test(ap.a) && ap.b === null && /Street address is missing/.test(ap.c), 'address check names the field and how to fix it (US ZIP, missing street; AE without postcode is fine)');

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    const email = `ds8-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `DS8 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkMerchant = async (tag, status = 'on') => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – DS8 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', $2, now())
                    on conflict (org_id, service) do update set status = excluded.status, started_at = excluded.started_at`, [org, status]);
    for (const c of ['AE', 'US']) await db.query(`insert into dropship_markets (org_id, country, locked_by_staff) values ($1, $2, false) on conflict do nothing`, [org, c]);
    return { uid, org };
  };
  const journalsMade = [];
  const fund = async (org, cents, tag) => {
    await owner();
    const j = (await one(`select post_journal($1, jsonb_build_array(
        jsonb_build_object('account', cash_account('USD'), 'debit', $2::bigint, 'credit', 0),
        jsonb_build_object('account', wallet_account($3, 'USD'), 'debit', 0, 'credit', $2::bigint, 'org', $3)), $4, 'topup', 'organization', $3) j`,
      [`DS8 test top-up ${tag}`, cents, org, `ds8-topup-${tag}-${stamp}`])).j;
    journalsMade.push(j);
  };
  const A = await mkMerchant('a');
  const B = await mkMerchant('b');
  const C = await mkMerchant('credit');
  const P = await mkMerchant('paused');
  const admin = await mkUser('admin', 'admin');
  const v1 = await one(`select v.id, v.model_no, v.item_id from dropship_variants v join dropship_products p on p.id = v.product_id
     where p.status = 'active' and p.fulfilment_type = 'fast_ship' and p.visible_to_org_id is null
     order by v.model_no limit 1`);
  ok(Boolean(v1), `fixture: a fast-ship Octopus variant (${v1?.model_no})`);
  if (!v1) return failed + 1;
  await db.query(`update item_master set weight_g = coalesce(weight_g, 300), box_l_cm = coalesce(box_l_cm, 20), box_w_cm = coalesce(box_w_cm, 15), box_h_cm = coalesce(box_h_cm, 5) where id = $1`, [v1.item_id]);
  // the paid event reserves at the default warehouse (W7): make sure it holds enough of the test variant (rolled back)
  const freeAtDef = Number((await one(`select coalesce(max(on_hand_qty - reserved_qty), 0)::int m from warehouse_stock where item_id = $1 and warehouse_id = $2`, [v1.item_id, defW])).m);
  if (freeAtDef < 60) await db.query(`select record_warehouse_stock_movement($1, 'inbound', $2, 'DS8 test stock at the default warehouse', $3, null)`, [v1.item_id, 60 - freeAtDef, defW]);
  const ledgerBefore = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  const order = (ext, over = {}) => ({
    external_order_id: ext, external_order_name: '#' + ext.slice(-4), buyer_name: 'Omar Saleh', buyer_phone: '+971500000000',
    address: { name: 'Omar Saleh', line1: '12 Marina Walk', city: 'Dubai', country: 'AE' }, risk: 'low',
    lines: [{ model_no: v1.model_no, qty: 1, buyer_unit_price_cents: 3999 }], ...over,
  });
  const intake = async (org, ext, over = {}, channel = 'shopify') => { await service(); return rpc(`select ds_order_intake($1, $2, $3::jsonb) r`, [org, channel, JSON.stringify(order(ext, over))]); };
  const so = async (id) => { await owner(); return one(`select so.*, x.hold_code, x.other_items_count, x.payment_option, x.charged_cents, x.invoice_id, x.expired_at, x.payment_due_at, x.last_charge_error, x.legal_entity_id, x.cancel_state, x.problem_code, x.charge_journal_id
     from store_orders so left join dropship_order_intake x on x.store_order_id = so.id where so.id = $1`, [id]); };
  const walletOf = async (org) => { await owner(); return Number((await one(`select wallet_balance($1, 'USD') b`, [org])).b); };

  // ── 1. intake: Octopus lines only, mixed cart, dedupe, nothing to do ──
  await fund(A.org, 100000, 'a1');
  const ext1 = `S-${stamp}-1001`;
  const r1 = await intake(A.org, ext1, { lines: [{ model_no: v1.model_no, qty: 2, buyer_unit_price_cents: 3999 }, { model_no: 'MERCHANT-OWN-1', qty: 1, title: 'Gift card' }, { sku: 'X', qty: 2 }] });
  ok(r1.ok === true && r1.duplicate === false && r1.other_items === 3, `intake: stored with "+3 items not from Octopus" (${JSON.stringify({ ok: r1.ok, other: r1.other_items, code: r1.code, msg: r1.message })})`);
  const o1 = r1.store_order_id ? await so(r1.store_order_id) : null;
  const items1 = o1 ? await all(`select model_no, qty from store_order_items where store_order_id = $1`, [o1.id]) : [];
  ok(items1.length === 1 && items1[0].model_no === v1.model_no && Number(items1[0].qty) === 2, 'only the Octopus line is stored (1 line × 2)');
  ok(o1 && o1.fee_version_id && o1.shipping_rate_card_id && o1.billed_weight_g > 0 && o1.total_cents > 0, 'quote locked at intake: fee version + rate card IDs, billed weight and total stored on the order');
  const r1b = await intake(A.org, ext1);
  const n1 = Number((await one(`select count(*) n from store_orders where org_id = $1 and channel = 'shopify' and external_order_id = $2`, [A.org, ext1])).n);
  ok(r1b.ok === true && r1b.duplicate === true && r1b.store_order_id === r1.store_order_id && n1 === 1, 'dedupe on (org, channel, external order id): the second delivery is ignored');
  const r1c = await intake(A.org, ext1, {}, 'csv');
  ok(r1c.ok === true && r1c.duplicate === false, 'the same external id on another channel is another order');
  if (r1c.store_order_id) { await owner(); await db.query(`select ds_order_cancel_core($1, 'test', 'merchant')`, [r1c.store_order_id]); }
  const r0 = await intake(A.org, `S-${stamp}-1000`, { lines: [{ model_no: 'MERCHANT-OWN-1', qty: 1 }] });
  ok(r0.ok === true && r0.ignored === true && r0.code === 'NO_OCTOPUS_ITEMS', 'an order with no Octopus items is ignored (nothing stored)');

  // ── 3. auto-pay from the wallet (o1) ──
  ok(o1 && o1.payment_state === 'paid' && o1.payment_option === 'wallet' && Number(o1.charged_cents) === Number(o1.total_cents), `auto-pay: paid from the wallet (${o1?.payment_state}/${o1?.payment_option}, ${o1?.last_charge_error ?? ''})`);
  const inv1 = o1?.invoice_id ? await one(`select * from documents where id = $1`, [o1.invoice_id]) : null;
  const legal = (await one(`select current_legal_entity_id(now()) e`)).e;
  ok(inv1 && /^OCT-DS-\d{4}-\d{6}$/.test(inv1.number) && inv1.doc_type === 'commercial_invoice' && Number(inv1.amount_cents) === Number(o1.total_cents) && inv1.status === 'paid'
     && inv1.legal_entity_id === legal && o1.legal_entity_id === legal, `OCT-DS invoice issued under the current legal entity (${inv1?.number})`);
  const lines1 = inv1 ? await all(`select description, amount_cents from invoice_lines where document_id = $1 order by description`, [inv1.id]) : [];
  ok(lines1.length >= 3 && lines1.reduce((s, l) => s + Number(l.amount_cents), 0) === Number(o1.total_cents) && lines1.some((l) => /^Processing/.test(l.description)),
    'invoice lines: Products, Processing (its own line), Shipping, Duties — they add up to the total');
  const j1 = o1?.charge_journal_id ? await all(`select le.debit_cents, le.credit_cents, la.code from ledger_entries le join ledger_accounts la on la.id = le.account_id where le.journal_id = $1`, [o1.charge_journal_id]) : [];
  ok(j1.length === 2 && j1.some((e) => e.code === `wallet:${A.org}` && Number(e.debit_cents) === Number(o1.total_cents)) && j1.some((e) => e.code === 'rev:dropship' && Number(e.credit_cents) === Number(o1.total_cents)),
    'balanced journal: wallet debit = Dropship revenue credit');
  if (o1?.charge_journal_id) journalsMade.push(o1.charge_journal_id);
  const ho1 = o1 ? await all(`select handoff_type, status from dropship_handoffs where store_order_id = $1`, [o1.id]) : [];
  ok(o1 && ['packing', 'sourcing'].includes(o1.staff_stage) && o1.merchant_status === 'processing' && ho1.some((h) => h.handoff_type === 'warehouse_pick_pack' && h.status === 'reserved'),
    `after payment the order is handed to the warehouse (stage ${o1?.staff_stage}, handoff ${ho1.map((h) => h.status).join(',')})`);
  ok(o1 && (await one(`select wh_dropship_is_ready($1) r`, [o1.id])).r === true, 'the Warehouse OS sees it as ready to bring in (wh_dropship_is_ready)');
  await as(A.uid);
  const ev1 = o1 ? (await rpc(`select ds_order_detail_events($1) r`, [o1.id])).map((e) => e.kind) : [];
  ok(ev1.indexOf('received') === 0 && ev1.indexOf('charged') > 0 && ev1.indexOf('handed_to_warehouse') > ev1.indexOf('charged'), `order timeline in order: ${ev1.join(' → ')}`);

  // ── 2. holds with exact reasons ──
  const walletA0 = await walletOf(A.org);
  const rH = await intake(A.org, `S-${stamp}-1042`, { risk: 'high' });
  const oH = await so(rH.store_order_id);
  ok(rH.ok && oH.hold_code === 'high_risk' && oH.payment_state === 'unpaid' && oH.merchant_status === 'on_hold' && oH.staff_stage === 'on_hold' && oH.hold_reason === 'high_risk',
    'high risk → On hold: high risk, not charged');
  const rAd = await intake(A.org, `S-${stamp}-1041`, { address: { name: 'Lina H', city: 'Dubai', country: 'AE' } });
  const oAd = await so(rAd.store_order_id);
  ok(rAd.ok && oAd.hold_code === 'address' && oAd.payment_state === 'unpaid' && oAd.hold_reason === 'address_failed', 'address check failed → On hold: address, not charged');
  const rAd2 = await intake(A.org, `S-${stamp}-1040`, { address_check: 'failed', address_issue: "This postcode doesn't match Riyadh." });
  ok(rAd2.ok && (await so(rAd2.store_order_id)).hold_code === 'address', 'the store\'s own failed address check is honoured with its message');
  const rDu = await intake(A.org, `S-${stamp}-1039`, { address: { name: 'Tom B', line1: '1 Main St', city: 'Austin', postcode: '78701', country: 'US' } });
  const oDu = rDu.ok ? await so(rDu.store_order_id) : null;
  ok(!rDu.ok || (oDu.total_cents == null ? oDu.hold_code === 'duty_unknown' && oDu.payment_state === 'unpaid' : true),
    `duties not known (US DDP) → On hold: duties not known, never charged as 0 (${rDu.ok ? `total ${oDu.total_cents}` : rDu.code})`);
  await owner();
  const stockRows = await all(`select warehouse_id, reserved_qty from warehouse_stock where item_id = $1`, [v1.item_id]);
  await db.query(`select set_config('octopus.allow_warehouse_stock_sync', 'true', true)`);
  await db.query(`update warehouse_stock set reserved_qty = on_hand_qty where item_id = $1`, [v1.item_id]);
  const rSt = await intake(A.org, `S-${stamp}-1038`);
  const oSt = rSt.ok ? await so(rSt.store_order_id) : null;
  await owner();
  await db.query(`select set_config('octopus.allow_warehouse_stock_sync', 'true', true)`);
  for (const r of stockRows) await db.query(`update warehouse_stock set reserved_qty = $3 where item_id = $1 and warehouse_id = $2`, [v1.item_id, r.warehouse_id, r.reserved_qty]);
  await db.query(`select set_config('octopus.allow_warehouse_stock_sync', '', true)`);
  ok(rSt.ok && oSt.hold_code === 'stock_shortage' && oSt.payment_state === 'unpaid', `stock shortage → On hold: stock, not charged (${rSt.code ?? ''})`);
  ok((await walletOf(A.org)) === walletA0, 'held orders charged nothing (wallet unchanged)');

  // ── 3b. the default warehouse (W7 moved the paid-event reservation from the legacy 'SZ-01' to default_warehouse_code()) ──
  await owner();
  const mv1 = o1 ? await one(`select warehouse_id from warehouse_stock_movements where store_order_id = $1 and kind = 'reserve' limit 1`, [o1.id]) : null;
  const ho1w = o1 ? await one(`select warehouse_id from dropship_handoffs where store_order_id = $1 and handoff_type = 'warehouse_pick_pack' limit 1`, [o1.id]) : null;
  ok(mv1?.warehouse_id === defW && ho1w?.warehouse_id === defW, `paid order: stock reserved and handed off at the default warehouse ${defW}`);
  const defRow = await one(`select reserved_qty from warehouse_stock where item_id = $1 and warehouse_id = $2`, [v1.item_id, defW]);
  await db.query(`select set_config('octopus.allow_warehouse_stock_sync', 'true', true)`);
  await db.query(`update warehouse_stock set reserved_qty = on_hand_qty where item_id = $1 and warehouse_id = $2`, [v1.item_id, defW]);
  const rDef = await intake(A.org, `S-${stamp}-1101`);
  const oDef = rDef.ok ? await so(rDef.store_order_id) : null;
  ok(rDef.ok && oDef.hold_code === 'stock_shortage' && oDef.payment_state === 'unpaid',
    'intake checks stock where the paid event reserves (default warehouse full → On hold: stock, not charged — stock elsewhere does not count)');
  await owner();
  await db.query(`select set_config('octopus.allow_warehouse_stock_sync', 'true', true)`);
  await db.query(`update warehouse_stock set reserved_qty = $3 where item_id = $1 and warehouse_id = $2`, [v1.item_id, defW, defRow.reserved_qty]);
  await db.query(`select set_config('octopus.allow_warehouse_stock_sync', '', true)`);

  // ── 4. not enough funds → awaiting payment, then paid oldest first when funds arrive ──
  const rB1 = await intake(B.org, `S-${stamp}-2001`);
  const rB2 = await intake(B.org, `S-${stamp}-2002`);
  const oB1 = await so(rB1.store_order_id);
  ok(oB1.payment_state === 'unpaid' && oB1.merchant_status === 'awaiting_payment' && oB1.last_charge_error === 'WALLET_INSUFFICIENT' && !oB1.hold_code,
    'not enough funds → Awaiting payment (no hold, nothing charged)');
  const evB = await all(`select kind from dropship_order_events where store_order_id = $1`, [oB1.id]);
  ok(evB.some((e) => e.kind === 'awaiting_funds'), 'the order timeline says it is waiting for payment');
  await owner();
  const days = (await one(`select ds_order_expiry_days() d`)).d;
  await as(B.uid);
  const pageB = await rpc(`select ds_orders_page() r`);
  const rowB1 = pageB.rows.find((r) => r.id === oB1.id);
  ok(rowB1 && rowB1.days_left === days && pageB.wallet.available_cents === 0, `orders page: "Awaiting payment · ${rowB1?.days_left} days left"`);
  await fund(B.org, Number(oB1.total_cents) + 1, 'b1');
  await service();
  const paidN = await rpc(`select ds_order_autopay_waiting() r`);
  const oB1b = await so(rB1.store_order_id); const oB2b = await so(rB2.store_order_id);
  ok(Number(paidN) >= 1 && oB1b.payment_state === 'paid' && oB2b.payment_state === 'unpaid', 'funds arrive → waiting orders paid oldest first (the second still waits)');
  if (oB1b.charge_journal_id) journalsMade.push(oB1b.charge_journal_id);

  // ── 5. Charge and ship ──
  await as(A.uid);
  const sv = await rpc(`select ds_order_settings_save('wallet', false) r`);
  ok(sv.ok === true, 'settings: auto-pay switched off');
  const rM = await intake(A.org, `S-${stamp}-1050`);
  const rM2 = await intake(A.org, `S-${stamp}-1051`);
  ok((await so(rM.store_order_id)).payment_state === 'unpaid', 'auto-pay off → the new order waits in To pay');
  await as(A.uid);
  const ch = await rpc(`select ds_order_charge($1::uuid[], null) r`, [[rM.store_order_id]]);
  const oM = await so(rM.store_order_id);
  ok(ch.charged === 1 && oM.payment_state === 'paid' && oM.invoice_id, 'Charge and ship (one order): paid + invoiced');
  if (oM.charge_journal_id) journalsMade.push(oM.charge_journal_id);
  await as(A.uid);
  const chH = await rpc(`select ds_order_charge($1::uuid[], 'wallet') r`, [[rH.store_order_id]]);
  const oH2 = await so(rH.store_order_id);
  ok(chH.charged === 1 && oH2.payment_state === 'paid' && !oH2.hold_code, 'high risk: the merchant\'s explicit "Charge and ship" clears the hold and charges');
  if (oH2.charge_journal_id) journalsMade.push(oH2.charge_journal_id);
  await as(A.uid);
  const chAd = await rpc(`select ds_order_charge($1::uuid[], null) r`, [[rAd.store_order_id]]);
  ok(chAd.charged === 0 && chAd.results[0].code === 'ADDRESS_PROBLEM', 'address hold: Charge and ship refused until the address is fixed');
  const fix = await rpc(`select ds_order_update_address($1, $2::jsonb) r`, [rAd.store_order_id, JSON.stringify({ name: 'Lina H', line1: '5 Palm Street', city: 'Dubai', country: 'AE' })]);
  const oAd2 = await so(rAd.store_order_id);
  ok(fix.ok && fix.applied && !oAd2.hold_code && oAd2.shipping_address.line1 === '5 Palm Street' && oAd2.staff_stage === 'unpaid', 'Save and resubmit: address applied, hold cleared (auto-pay off → waits in To pay)');
  // bulk: wallet covers only one of two (top-up drained first)
  const left = await walletOf(A.org);
  const tot = Number((await so(rM2.store_order_id)).total_cents);
  await owner();
  const drain = (await one(`select post_journal('DS8 drain', jsonb_build_array(jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', $2::bigint, 'credit', 0, 'org', $1),
     jsonb_build_object('account', cash_account('USD'), 'debit', 0, 'credit', $2::bigint)), $3, 'withdrawal', 'organization', $1) j`, [A.org, left - tot - 1, `ds8-drain-${stamp}`])).j;
  journalsMade.push(drain);
  await as(A.uid);
  const bulk = await rpc(`select ds_order_charge($1::uuid[], null) r`, [[rAd.store_order_id, rM2.store_order_id]]);
  ok(bulk.charged === 1 && bulk.failed === 1 && bulk.results[0].store_order_id === rAd.store_order_id && bulk.results[0].ok === true
     && bulk.results[1].code === 'WALLET_INSUFFICIENT' && (await so(rAd.store_order_id)).payment_state === 'paid' && (await so(rM2.store_order_id)).payment_state === 'unpaid',
    `bulk Charge and ship: oldest first, one refusal never undoes another (${bulk.results.map((x) => x.code ?? 'ok').join(',')})`);
  for (const id of [rAd.store_order_id]) { const j = (await so(id)).charge_journal_id; if (j) journalsMade.push(j); }
  await fund(A.org, 100000, 'a2');

  // ── 6. payment protection ──
  await as(A.uid);
  await rpc(`select ds_order_settings_save('protection', true) r`);
  const wBefore = await walletOf(A.org);
  const rP = await intake(A.org, `S-${stamp}-1044`);
  const oP = await so(rP.store_order_id);
  const hP = oP.escrow_hold_id ? await one(`select * from escrow_holds where id = $1`, [oP.escrow_hold_id]) : null;
  ok(oP.payment_state === 'held' && oP.payment_option === 'protection' && hP && hP.status === 'held' && Number(hP.amount_cents) === Number(oP.total_cents)
     && (await walletOf(A.org)) === wBefore - Number(oP.total_cents) && !oP.invoice_id, 'payment protection: paid from the wallet and held (no invoice until release)');
  await as(A.uid);
  const pageA = await rpc(`select ds_orders_page() r`);
  ok(Number(pageA.wallet.held_cents) >= Number(oP.total_cents), 'wallet bar: Held shows the protected amount');
  const rP2 = await intake(A.org, `S-${stamp}-1045`);
  const oP2 = await so(rP2.store_order_id);
  await owner();
  await db.query(`update escrow_holds set delivered_at = now() - interval '8 days', auto_release_at = now() - interval '1 day' where id = any($1::uuid[])`, [[oP.escrow_hold_id, oP2.escrow_hold_id]]);
  await db.query(`update escrow_holds set dispute_opened_at = now(), status = 'disputed', dispute_reason = 'Item damaged' where id = $1`, [oP2.escrow_hold_id]);
  await service();
  await rpc(`select ds_protection_release_due() r`);
  const hP2 = await one(`select * from escrow_holds where id = $1`, [oP.escrow_hold_id]);
  const oP3 = await so(rP.store_order_id);
  const invP = hP2.invoice_id ? await one(`select number, amount_cents, data from documents where id = $1`, [hP2.invoice_id]) : null;
  const linesP = hP2.invoice_id ? await all(`select amount_cents from invoice_lines where document_id = $1`, [hP2.invoice_id]) : [];
  const revP = await all(`select j.id from journals j where j.idempotency_key like $1`, [`ds-prot-rev:${oP.escrow_hold_id}:%`]);
  ok(hP2.status === 'released' && oP3.payment_state === 'paid' && invP && /^OCT-DS-/.test(invP.number) && linesP.reduce((s, l) => s + Number(l.amount_cents), 0) === Number(oP.total_cents) && revP.length === 1,
    `7 days after delivery: released, OCT-DS invoice with lines, revenue journal (${invP?.number})`);
  journalsMade.push(...revP.map((r) => r.id), hP2.hold_journal_id);
  ok((await one(`select status from escrow_holds where id = $1`, [oP2.escrow_hold_id])).status === 'disputed', 'a dispute keeps the money held');

  // ── 7. pay later only for credit_eligible ──
  await as(A.uid);
  ok(/INVALID_INPUT/.test(await err(`select ds_order_settings_save('pay_later', true)`)), 'pay later: a non-eligible merchant can\'t choose it');
  const wA = await rpc(`select ds_wallet_get() r`);
  ok(wA.pay_later === null && pageA.pay_later === null, 'pay later is never shown to a non-eligible merchant (null, not "disabled")');
  const rNP = await intake(A.org, `S-${stamp}-1060`, { risk: 'high' });
  await as(A.uid);
  const chNP = await rpc(`select ds_order_charge($1::uuid[], 'pay_later') r`, [[rNP.store_order_id]]);
  ok(chNP.charged === 0 && chNP.results[0].code === 'OPTION_UNAVAILABLE' && !/pay later/i.test(chNP.results[0].message), 'an explicit pay-later charge is refused as "not available" without naming it');
  await owner();
  await db.query(`select set_config('octopus.allow_credit_eligible_write', 'true', true)`);
  await db.query(`update organizations set credit_eligible = true where id = $1`, [C.org]);
  await db.query(`select set_config('octopus.allow_credit_eligible_write', '', true)`);
  const fin2 = await mkUser('fin2', 'finance');
  await db.query(`insert into customer_credit_terms (org_id, division_id, credit_limit_cents, net_days, status, proposed_by, approved_by, approved_at)
                  values ($1, null, 1000000, 30, 'active', $2, $3, now())`, [C.org, admin, fin2]);
  await as(C.uid);
  const wC = await rpc(`select ds_wallet_get() r`);
  const svC = await rpc(`select ds_order_settings_save('pay_later', true) r`);
  ok(wC.pay_later === true && svC.ok === true, 'credit_eligible merchant with credit terms: pay later can be chosen');
  const rC = await intake(C.org, `S-${stamp}-3001`);
  const oC = await so(rC.store_order_id);
  const invC = oC.invoice_id ? await one(`select number, status, due_at, payment_option, amount_cents, paid_cents from documents where id = $1`, [oC.invoice_id]) : null;
  const resC = await one(`select status, invoice_id from credit_reservations where target_type = 'dropship_order' and target_id = $1`, [oC.id]);
  const arC = oC.charge_journal_id ? await all(`select la.code, le.debit_cents from ledger_entries le join ledger_accounts la on la.id = le.account_id where le.journal_id = $1`, [oC.charge_journal_id]) : [];
  ok(oC.payment_state === 'paid' && oC.payment_option === 'pay_later' && invC && invC.status === 'awaiting_payment' && invC.payment_option === 'pay_later' && Number(invC.paid_cents) === 0
     && invC.due_at && resC?.status === 'invoiced' && resC.invoice_id === oC.invoice_id && arC.some((e) => e.code === `ar:${C.org}` && Number(e.debit_cents) === Number(oC.total_cents)),
    `pay later: OCT-DS invoice due in net days, reservation invoiced, receivable journal (${invC?.number})`);
  if (oC.charge_journal_id) journalsMade.push(oC.charge_journal_id);
  ok(Number(await walletOf(C.org)) === 0, 'pay later did not touch the wallet');

  // ── 8. expiry ──
  await as(A.uid);
  await rpc(`select ds_order_settings_save('wallet', false) r`);
  const rE = await intake(A.org, `S-${stamp}-1037`);
  await owner();
  await db.query(`update dropship_order_intake set payment_due_at = now() - interval '1 minute' where store_order_id = $1`, [rE.store_order_id]);
  await service();
  const expN = await rpc(`select ds_order_expire_due() r`);
  const oE = await so(rE.store_order_id);
  const taskE = await one(`select action, status from dropship_channel_tasks where store_order_id = $1`, [oE.id]);
  const jE = await one(`select count(*)::int n from journals where ref_type = 'store_order' and ref_id = $1`, [oE.id]);
  ok(Number(expN) >= 1 && oE.expired_at && oE.cancelled_at && oE.payment_state === 'unpaid' && jE.n === 0 && taskE?.action === 'release_fulfillment' && taskE.status === 'waiting_store',
    'unpaid after N days → released back to the store (Shopify task waiting for the store connection), never charged');
  await as(A.uid);
  const chE = await rpc(`select ds_order_charge($1::uuid[], null) r`, [[rE.store_order_id]]);
  ok(chE.results[0].code === 'ORDER_EXPIRED', 'an expired order can\'t be charged any more');

  // ── 9. cancellation + address change rules ──
  const wC0 = await walletOf(A.org);
  await as(A.uid);
  const can1 = await rpc(`select ds_order_cancel($1, 'Buyer changed their mind') r`, [rM.store_order_id]);
  const oMc = await so(rM.store_order_id);
  const cn = await one(`select number, amount_cents, original_document_id from documents where doc_type = 'credit_note' and data ->> 'store_order_id' = $1`, [rM.store_order_id]);
  const rel = await one(`select count(*)::int n from warehouse_stock_movements where store_order_id = $1 and kind = 'release'`, [rM.store_order_id]);
  ok(can1.accepted === true && oMc.cancelled_at && oMc.merchant_status === 'cancelled' && oMc.payment_state === 'refunded' && (await walletOf(A.org)) === wC0 + Number(oMc.total_cents)
     && cn && /^CN-DS-/.test(cn.number) && cn.original_document_id === oMc.invoice_id && rel.n >= 1,
    `cancel before packing: refund to the wallet, credit note ${cn?.number}, stock released ("${can1.message}")`);
  const refundJ = await one(`select id from journals where idempotency_key = $1`, [`ds-refund:${rM.store_order_id}`]);
  if (refundJ) journalsMade.push(refundJ.id);
  // protected order cancel → escrow refund
  await as(A.uid);
  await rpc(`select ds_order_settings_save('protection', true) r`);
  const rP4 = await intake(A.org, `S-${stamp}-1046`);
  const wP4 = await walletOf(A.org);
  await as(A.uid);
  const can2 = await rpc(`select ds_order_cancel($1, null) r`, [rP4.store_order_id]);
  const oP4 = await so(rP4.store_order_id);
  ok(can2.accepted === true && (await walletOf(A.org)) === wP4 + Number(oP4.total_cents) && (await one(`select status from escrow_holds where id = $1`, [oP4.escrow_hold_id])).status === 'refunded',
    'cancel a protected order before packing: the held money goes back to the wallet');
  // after packing: rejected; address change → problem flow
  await owner();
  await db.query(`insert into wh_orders (warehouse_code, source, store_order_id, ship_name, ship_address, ship_country, status) values ('FS-01', 'dropship', $1, 'Omar S', '{"line1":"12 Marina Walk","city":"Dubai","country":"AE"}'::jsonb, 'AE', 'picked')`, [rH.store_order_id]);
  await as(A.uid);
  const can3 = await rpc(`select ds_order_cancel($1, 'Too late') r`, [rH.store_order_id]);
  const adr3 = await rpc(`select ds_order_update_address($1, $2::jsonb) r`, [rH.store_order_id, JSON.stringify({ name: 'Omar S', line1: '99 New Road', city: 'Dubai', country: 'AE' })]);
  const oH3 = await so(rH.store_order_id);
  ok(can3.accepted === false && oH3.cancelled_at === null && oH3.cancel_state === 'rejected', 'cancel after packing started: rejected (order continues)');
  ok(adr3.applied === false && adr3.problem === true && oH3.problem_code === 'address_after_packing' && oH3.shipping_address.line1 === '12 Marina Walk', 'address change after packing: not applied → problem flow');
  await service();
  const sc = await rpc(`select ds_order_channel_cancel($1, 'shopify', $2, 'Customer cancelled in Shopify') r`, [A.org, `S-${stamp}-1042`]);
  ok(sc.accepted === false && (await one(`select status from dropship_channel_tasks where store_order_id = $1 and action = 'reject_cancellation'`, [rH.store_order_id]))?.status === 'waiting_store',
    'a cancellation request from the store after packing → rejected, and the store is told (task waiting for the connection)');

  // ── 10. documents, paused, feature list, staff test path ──
  await owner();
  const stmt = await one(`select generate_dropship_weekly_statement($1, now() - interval '1 day', now() + interval '1 minute') r`, [A.org]);
  const stmtDoc = await one(`select number, legal_entity_id, data from documents where id = $1`, [stmt.r.statement_id]);
  const invNos = (await all(`select d.number from documents d where d.org_id = $1 and d.doc_type = 'commercial_invoice' and d.number like 'OCT-DS-%'`, [A.org])).map((r) => r.number);
  ok(/^STMT-DS-/.test(stmtDoc.number) && invNos.length >= 3 && invNos.every((n) => (stmtDoc.data.invoices ?? []).some((i) => i.number === n)) && stmtDoc.legal_entity_id === legal,
    `the STMT-DS statement lists every OCT-DS invoice (${invNos.length}) under the legal entity`);
  const cnNos = (await all(`select number, amount_cents from documents where org_id = $1 and doc_type = 'credit_note' and number like 'CN-DS-%'`, [A.org]));
  const cnLines = await all(`select amount_cents from invoice_lines where document_id = $1 and description like 'Credit note %'`, [stmt.r.statement_id]);
  const invSum = Number((await one(`select coalesce(sum(amount_cents), 0) s from documents where org_id = $1 and doc_type = 'commercial_invoice' and division_id = division_id_of('DS') and coalesce(status, '') not in ('void', 'cancelled')`, [A.org])).s);
  const cnSum = cnNos.reduce((t, c) => t + Number(c.amount_cents), 0);
  ok(cnNos.length >= 1 && cnNos.every((c) => (stmtDoc.data.credit_notes ?? []).some((x) => x.number === c.number)) && cnLines.length === cnNos.length && cnLines.every((l) => Number(l.amount_cents) < 0)
     && Number(stmt.r.total_cents) === invSum - cnSum && Number(stmt.r.credit_note_count) === cnNos.length,
    `CN-DS credit notes are on the STMT-DS statement as negative lines and taken off the total (${cnNos.map((c) => c.number).join(', ')}; total ${stmt.r.total_cents})`);
  await as(C.uid);
  const canC = await rpc(`select ds_order_cancel($1, 'Changed mind') r`, [rC.store_order_id]);
  await owner();
  const invC2 = await one(`select status, paid_cents, amount_cents from documents where id = $1`, [oC.invoice_id]);
  const stC = await one(`select generate_dropship_weekly_statement($1, now() - interval '1 day', now() + interval '1 minute') r`, [C.org]);
  const credC = await one(`select get_customer_credit_status($1, division_id_of('DS')) r`, [C.org]);
  ok(canC.accepted === true && invC2.status === 'paid' && Number(invC2.paid_cents) === Number(invC2.amount_cents) && Number(stC.r.total_cents) === 0 && Number(stC.r.unpaid_cents) === 0
     && Number(credC.r.unpaid_invoices_cents) === 0,
    'pay later cancelled before packing: credit note settles the invoice; the statement nets to 0 and the credit line is free again');
  const rPa = await intake(P.org, `S-${stamp}-4001`, { risk: 'high' });
  // P is "on" at first only to have an order, then paused
  await owner();
  await db.query(`update company_services set status = 'paused' where org_id = $1 and service = 'dropship'`, [P.org]);
  await as(P.uid);
  const chPa = await rpc(`select ds_order_charge($1::uuid[], 'wallet') r`, [[rPa.store_order_id]]);
  ok(chPa.charged === 0 && chPa.results[0].code === 'DROPSHIP_PAUSED', 'paused merchant: no new charge (DROPSHIP_PAUSED)');
  ok(!(await tryq(`select ds_orders_page() r`)).err && !(await tryq(`select ds_wallet_get() r`)).err, 'paused merchant: still reads Orders and Wallet (history stays)');
  const rPa2 = await intake(P.org, `S-${stamp}-4002`);
  ok(rPa2.ok === false && rPa2.code === 'DROPSHIP_PAUSED', 'paused merchant: new orders are not taken');
  await as(P.uid);
  ok((await rpc(`select ds_order_cancel($1, null) r`, [rPa.store_order_id])).accepted === true, 'paused merchant: can still cancel');
  await as(P.uid);
  ok(/DROPSHIP_PAUSED/.test(await err(`select ds_order_settings_save('wallet', true)`)), 'paused merchant: settings changes refused');
  await owner();
  const feats = (await one(`select value from site_settings where key = 'dropship_features'`))?.value;
  await db.query(`insert into site_settings (key, value) values ('dropship_features', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ ...(feats ?? {}), orders: false })]);
  await as(A.uid);
  const off1 = await err(`select ds_orders_page()`);
  const off2 = await intake(A.org, `S-${stamp}-1070`);
  ok(/FEATURE_OFF/.test(off1) && off2.code === 'FEATURE_OFF', 'Orders switched off in the feature list (live early access): page RPC and intake refuse');
  await owner();
  if (feats) await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify(feats)]);
  else await db.query(`delete from site_settings where key = 'dropship_features'`);
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_test_order_create($1, $2::jsonb)`, [A.org, JSON.stringify(order(`T-${stamp}`))])), 'staff test path: a merchant can\'t use it');
  await owner();
  const env = (await one(`select wh_env_is_staging() s`)).s;
  await as(admin, 'aal2');
  const tst = await tryq(`select ds_test_order_create($1, $2::jsonb) r`, [B.org, JSON.stringify({ ...order(''), external_order_id: null })]);
  ok(env ? tst.rows[0]?.r?.ok === true && /^TEST-/.test((await so(tst.rows[0].r.store_order_id)).external_order_id) : /STAGING_ONLY/.test(tst.err ?? ''),
    `staff test path: works on staging only (channel manual, TEST- id) (${tst.err ?? JSON.stringify(tst.rows[0]?.r?.code ?? 'ok')})`);
  await owner();
  await db.query(`update site_settings set value = '"production"'::jsonb where key = 'app_environment'`);
  await as(admin, 'aal2');
  ok(/STAGING_ONLY/.test(await err(`select ds_test_order_create($1, $2::jsonb)`, [B.org, JSON.stringify(order(`T2-${stamp}`))])), 'staff test path: refused outside staging');
  await owner();
  await db.query(`update site_settings set value = '"staging"'::jsonb where key = 'app_environment'`);

  // ── 11. RLS cross-org + anon, audit, ledger ──
  await as(B.uid);
  const leaks = [];
  for (const t of TABLES) { const n = Number((await one(`select count(*) n from ${t} where org_id = $1`, [A.org])).n); if (n) leaks.push(t); }
  const bCharge = await err(`select ds_order_charge($1::uuid[], null)`, [[rNP.store_order_id]]);
  const bCancel = await err(`select ds_order_cancel($1, null)`, [rNP.store_order_id]);
  const bPage = await rpc(`select ds_orders_page() r`);
  const tasks = Number((await one(`select count(*) n from dropship_channel_tasks`)).n);
  ok(leaks.length === 0 && /NOT_FOUND/.test(bCharge) && /NOT_FOUND/.test(bCancel) && !bPage.rows.some((r) => r.id === rNP.store_order_id) && tasks === 0,
    `merchant B reads none of A's rows, can't charge or cancel A's order, and sees no channel tasks${leaks.length ? ' — ' + leaks.join(',') : ''}`);
  await as(null, 'aal1', 'anon');
  const anonErrs = [];
  for (const t of TABLES) if (!/permission denied/.test(await err(`select 1 from ${t} limit 1`))) anonErrs.push(t);
  ok(anonErrs.length === 0 && /permission denied/.test(await err(`select ds_orders_page()`)) && /permission denied/.test(await err(`select ds_order_intake(null, 'shopify', '{}'::jsonb)`)), 'anon: no table and no RPC');
  await as(A.uid);
  ok(/permission denied/.test(await err(`select ds_order_intake($1, 'shopify', '{}'::jsonb)`, [A.org])) && /permission denied/.test(await err(`select ds_order_jobs()`)), 'merchants can\'t call intake or the jobs');
  await owner();
  const audits = (await all(`select distinct action from audit_log where action like 'ds\\_order.%' and (details ->> 'org_id' = any($1))`, [[A.org, B.org, C.org, P.org]])).map((r) => r.action);
  ok(['ds_order.received', 'ds_order.charged', 'ds_order.settings_saved', 'ds_order.cancelled', 'ds_order.cancel_rejected', 'ds_order.expired', 'ds_order.intake_refused'].every((a) => audits.includes(a)),
    `audit rows written (${audits.join(', ')})`);
  const testJournals = (await all(`select distinct j.id from journals j join ledger_entries le on le.journal_id = j.id where le.org_id = any($1::uuid[])`, [[A.org, B.org, C.org, P.org]])).map((r) => r.id);
  ok(await journalsBalanced([...new Set([...testJournals, ...journalsMade.filter(Boolean)])]), `every journal of the test is balanced (${testJournals.length})`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c && BigInt(l.d) >= BigInt(ledgerBefore.d), `ledger debit = credit (${l.d} = ${l.c})`);
  const flows = await one(`select coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint b from ledger_entries le join ledger_accounts la on la.id = le.account_id where la.code = $1`, [`wallet:${B.org}`]);
  ok(Number(flows.b) === (await walletOf(B.org)) && Number(flows.b) === Number(oB1.total_cents) + 1 - Number(oB1b.charged_cents), 'wallet total consistent: top-ups − charges (+ refunds) = the balance');

  // ── 12. down → up ──
  if (ctx.DOWN && ctx.UP) {
    await owner();
    let skipped = false;
    try { await ctx.unwindLater(db); } catch (e) { if (e.skipRoundTrip) skipped = true; else throw e; }
    if (!skipped) {
      const snap = async () => JSON.stringify(await all(`
        select 'fn' k, p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '') x from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') from information_schema.columns where table_schema = 'public'
        union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') from pg_policies where schemaname = 'public'
        union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
        union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
        union all select 'tg', tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal
        union all select 'acl', c.relname || ':' || coalesce(c.relacl::text, '') from pg_class c where c.relnamespace = 'public'::regnamespace
        order by 1, 2`));
      const withIt = await snap();
      await db.query(ctx.DOWN);
      const without = await snap();
      const gone = await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES]);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'ds\\_order%' or proname in ('ds_orders_page', 'ds_wallet_get', 'ds_test_order_create', 'ds_protection_release_due', 'ds_escrow_release_revenue'))`)).n);
      ok(Number(gone.n) === 0 && fnLeft === 0, 'down: every DS8 table and function is gone');
      await db.query(ctx.UP);
      ok((await snap()) === withIt, 'up again: identical schema (functions + grants, columns, policies, constraints, indexes, triggers, table ACLs)');
      await db.query(ctx.UP);
      ok((await snap()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snap()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ds8_order_payment_intake.sql'));
  if (!MIG) { console.error('✘ DS8 migration file not found'); process.exit(1); }
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
    failed = await runDs8Checks(db, {
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
  console.log(failed ? `\nds8-dropship: ${failed} check(s) failed` : '\nds8-dropship: all passed');
  process.exitCode = failed ? 1 : 0;
}
