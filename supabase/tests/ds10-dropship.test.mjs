// Octopus Dropship · Release 4 · Step 10 (order problems and support) — DB checks for migration *_ds10_order_problems_support.
// STAGING ONLY, one rolled-back transaction, acting as merchants / staff / Finance / warehouse staff / the service role
// through JWT claims (what PostgREST does).
//  0. Structure: 3 new tables with RLS (own org via my_org_ids()), no direct writes for signed-in users, anon nothing; every
//     ds10 function search_path=public, revoked from public/anon, internals not callable by signed-in users; merchant-readable
//     columns don't look internal (customer-columns rule); DS8 address core replaced ("until the label"); two-person CHECK on
//     finance_approvals; channel task action 'update_tracking'; storage policies for the private 'ds-claims' bucket.
//  1. Cancel / address by stage: cancel until packing (DS8 rule, refund + CN-DS); address applied while picked without a label
//     (warehouse order too); after the label → not applied, problem + ticket linked to the store order.
//  2. Lost claim → carrier claim → reship: new store order (no charge) + warehouse order at the default warehouse, store task
//     'update_tracking'; one open claim per order; damaged needs a photo; not before handover; another merchant: not found.
//  3. Damaged claim → refund ≤ US$1,000: Refunds & credits → wallet (balanced), CN-DS against the OCT-DS invoice, ticket
//     resolved with the decision, cap = what was paid.
//  4. Refund > US$1,000: Finance approval; the proposer can't approve (function and table CHECK); a second Finance person
//     approves → refund + CN-DS, approval executed; a rejection (Admin › Finance path) puts the case back.
//  5. Returns: before delivery refused; to the merchant's address → closed, nothing refunded; to the 3PL → ticket, warehouse
//     registers a wh_returns record, W5 photo + inspection, no 3PL charge, no client decision / send back, settle → default
//     decision + refund by the rules (good units × price − return handling fee); restocked lot owned by Octopus.
//  6. Re-weigh: tolerance not set → absorb only; over tolerance → charge (OCT-DS invoice + journal); dispute within the
//     window → refund (CN-DS + journal) / reject; after the window refused; merchant can read the scale photo path.
//  7. Support: ticket by type + order number (own orders only), support page lists tickets with links; feature list Support
//     off → refused; paused merchant can still open tickets and claims.
//  8. RLS cross-org + anon; audit rows; every journal balanced; ledger debit = credit; wallet = flows.
//  9. down → up → down → up: identical schema.
// Run: node supabase/tests/ds10-dropship.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runDs10Checks(db, ctx) {
  let failed = 0;
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    const now = Math.floor(Date.now() / 1000);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }] } : { role })]);
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
  const TABLES = ['dropship_cases', 'dropship_case_photos', 'dropship_reweighs'];
  const MERCHANT_FNS = ['ds10_order_detail', 'ds10_claim_open', 'ds10_return_open', 'ds10_reweigh_dispute', 'ds10_order_address', 'ds10_support_page', 'ds10_ticket_create'];
  const STAFF_FNS = ['ds10_staff_board', 'ds10_case_carrier', 'ds10_case_reship', 'ds10_case_refund', 'ds10_refund_approve', 'ds10_case_reject', 'ds10_return_receive',
    'ds10_return_settle', 'ds10_reweigh_decide', 'ds10_reweigh_dispute_decide', 'ds10_ticket_context'];
  const POLICY_FNS = ['ds10_claim_photo_can_upload', 'ds10_claim_photo_can_read', 'ds10_reweigh_photo_can_read'];
  const INTERNAL_FNS = ['ds10_staff_view', 'ds10_staff_edit', 'ds10_setting_int', 'ds10_approval_limit_cents', 'ds10_handed_over', 'ds10_label_created', 'ds10_delivered_at',
    'ds10_case_step', 'ds10_notify', 'ds10_ticket_open', 'ds10_ticket_reply', 'ds10_open_hold', 'ds10_refund_cap', 'ds10_case_json', 'ds10_credit_note', 'ds10_refund_execute',
    'ds10_release_hold', 'ds10_reship_create', 'ds10_reweigh_calc', 'ds10_case_for_staff', 'ds10_return_suggest', 'ds10_finance_approval_sync', 'ds10_is_dropship_return',
    'ds10_wh_return_guard', 'ds10_wh_return_lot_owner'];
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
  ok(pols.length === TABLES.length && pols.every((p) => p.cmd === 'SELECT' && /my_org_ids\(\)/.test(p.qual)), 'one SELECT policy per table: own organisation via my_org_ids()');
  const fns = await all(`select p.proname n, p.prosecdef d, p.proconfig::text c, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'ds10\\_%'`);
  const names = new Set(fns.map((f) => f.n));
  const missing = [...MERCHANT_FNS, ...STAFF_FNS, ...POLICY_FNS, ...INTERNAL_FNS].filter((n) => !names.has(n));
  ok(missing.length === 0, `every DS10 function exists${missing.length ? ' — missing ' + missing.join(',') : ''}`);
  const openToAnon = fns.filter((f) => /(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? ''));
  const noPath = fns.filter((f) => !/search_path=public/.test(f.c ?? ''));
  const notDefiner = fns.filter((f) => [...MERCHANT_FNS, ...STAFF_FNS].includes(f.n) && !f.d);
  const internalOpen = fns.filter((f) => INTERNAL_FNS.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  const rpcClosed = fns.filter((f) => [...MERCHANT_FNS, ...STAFF_FNS, ...POLICY_FNS].includes(f.n) && !/authenticated=X/.test(f.a ?? ''));
  ok(openToAnon.length === 0 && noPath.length === 0 && notDefiner.length === 0,
    `DS10 functions: none for public/anon, all search_path=public, every RPC a security definer${[...openToAnon, ...noPath, ...notDefiner].map((f) => ' ' + f.n).join('')}`);
  ok(internalOpen.length === 0 && rpcClosed.length === 0, `internals not callable by signed-in users; RPCs + storage policy helpers are${[...internalOpen, ...rpcClosed].map((f) => ' ' + f.n).join('')}`);
  const cols = await all(`select table_name t, column_name c from information_schema.columns where table_schema = 'public' and table_name = any($1)`, [TABLES]);
  const looksInternal = cols.filter((c) => INTERNAL_NAME.test(c.c));
  ok(looksInternal.length === 0, `no merchant-readable column looks internal (customer-columns rule)${looksInternal.length ? ' — ' + looksInternal.map((c) => `${c.t}.${c.c}`).join(', ') : ''}`);
  const core = (await one(`select pg_get_functiondef('public.ds_order_address_core(uuid,jsonb,text)'::regprocedure) d`)).d;
  ok(/ds10_label_created\(so\.id\)/.test(core) && !/ds_order_packing_started/.test(core), 'DS8 address core replaced: the address can change until the label exists');
  const cons = await all(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conname in ('finance_approvals_two_person', 'dropship_channel_tasks_action_check')`);
  ok(cons.length === 2 && cons.some((c) => /update_tracking/.test(c.d)) && cons.some((c) => /approved_by <> requested_by/.test(c.d)), 'finance_approvals two-person CHECK + channel task "update_tracking"');
  if (ctx.staging) {
    const sp = await all(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('ds claims upload', 'ds claims read', 'ds reweigh photo read')`);
    const bk = await one(`select public from storage.buckets where id = 'ds-claims'`);
    ok(sp.length === 3 && bk && bk.public === false, 'private bucket ds-claims + 3 storage policies');
  }

  // ── fixtures ──
  const mkUser = async (tag, roles = []) => {
    const email = `ds10-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `DS10 ${tag}`, email]);
    for (const r of roles) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, r]);
    return id;
  };
  const mkMerchant = async (tag, status = 'on') => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – DS10 ${tag} ${stamp}`])).id;
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
      [`DS10 test top-up ${tag}`, cents, org, `ds10-topup-${tag}-${stamp}`])).j;
    journalsMade.push(j);
  };
  const A = await mkMerchant('a');
  const B = await mkMerchant('b');
  const support = await mkUser('support', ['support']);
  const finMaker = await mkUser('finmaker', ['finance', 'support']);
  const finChecker = await mkUser('fincheck', ['finance']);
  const recv = await mkUser('recv', ['warehouse']);
  const defW = (await one(`select default_warehouse_code() c`)).c;
  await db.query(`insert into warehouse_staff(user_id, warehouse_code, role) values ($1, $2, 'receiver')`, [recv, defW]);
  const v1 = await one(`select v.id, v.model_no, v.item_id from dropship_variants v join dropship_products p on p.id = v.product_id
     where p.status = 'active' and p.fulfilment_type = 'fast_ship' and p.visible_to_org_id is null order by v.model_no limit 1`);
  ok(Boolean(v1), `fixture: a fast-ship Octopus variant (${v1?.model_no})`);
  if (!v1) return failed + 1;
  await db.query(`update item_master set weight_g = coalesce(weight_g, 300), box_l_cm = coalesce(box_l_cm, 20), box_w_cm = coalesce(box_w_cm, 15), box_h_cm = coalesce(box_h_cm, 5) where id = $1`, [v1.item_id]);
  const freeAtDef = Number((await one(`select coalesce(max(on_hand_qty - reserved_qty), 0)::int m from warehouse_stock where item_id = $1 and warehouse_id = $2`, [v1.item_id, defW])).m);
  if (freeAtDef < 80) await db.query(`select record_warehouse_stock_movement($1, 'inbound', $2, 'DS10 test stock at the default warehouse', $3, null)`, [v1.item_id, 80 - freeAtDef, defW]);
  const ledgerBefore = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  const order = (ext, over = {}) => ({
    external_order_id: ext, external_order_name: '#' + ext.slice(-4), buyer_name: 'Huda Ahmed', buyer_phone: '+971500000000',
    address: { name: 'Huda Ahmed', line1: '12 Marina Walk', city: 'Dubai', country: 'AE' }, risk: 'low',
    lines: [{ model_no: v1.model_no, qty: 2, buyer_unit_price_cents: 3999 }], ...over,
  });
  const intake = async (org, ext, over = {}) => { await service(); return rpc(`select ds_order_intake($1, 'shopify', $2::jsonb) r`, [org, JSON.stringify(order(ext, over))]); };
  const so = async (id) => { await owner(); return one(`select so.*, x.payment_option, x.charged_cents, x.invoice_id, x.refunded_cents, x.problem_code from store_orders so left join dropship_order_intake x on x.store_order_id = so.id where so.id = $1`, [id]); };
  const caseOf = async (id) => { await owner(); return one(`select * from dropship_cases where id = $1`, [id]); };
  const walletOf = async (org) => { await owner(); return Number((await one(`select wallet_balance($1, 'USD') b`, [org])).b); };
  const handOver = async (id) => { await owner(); await db.query(`update store_orders set staff_stage = 'handed_over', updated_at = now() where id = $1`, [id]); };
  const deliver = async (id, ago = '1 day') => { await owner(); await db.query(`update store_orders set staff_stage = 'delivered', delivered_at = now() - $2::interval where id = $1`, [id, ago]); };
  const photo = async (org, soId) => { await owner(); const p = `${org}/${soId}/${(await one('select gen_random_uuid() u')).u}.jpg`; await db.query(`insert into storage.objects (bucket_id, name, owner) values ('ds-claims', $1, $2)`, [p, A.uid]); return p; };

  await fund(A.org, 500000, 'a1');
  const r1 = await intake(A.org, `S-${stamp}-1001`);
  const r2 = await intake(A.org, `S-${stamp}-1002`);
  const r3 = await intake(A.org, `S-${stamp}-1003`);
  const r4 = await intake(A.org, `S-${stamp}-1004`);
  const r5 = await intake(A.org, `S-${stamp}-1005`);
  const o1 = await so(r1.store_order_id);
  ok(o1 && o1.payment_state === 'paid' && o1.payment_option === 'wallet' && o1.invoice_id, `fixture: orders paid from the wallet (${o1?.payment_state}/${r1.code ?? 'ok'})`);
  for (const o of [o1, await so(r2.store_order_id), await so(r3.store_order_id), await so(r4.store_order_id), await so(r5.store_order_id)]) {
    const j = (await one(`select charge_journal_id j from dropship_order_intake where store_order_id = $1`, [o.id])).j; if (j) journalsMade.push(j);
  }

  // ── 1. cancel / address by stage ──
  await as(A.uid);
  const d0 = await rpc(`select ds10_order_detail($1) r`, [o1.id]);
  ok(d0.actions.cancel === true && d0.actions.claim === false && d0.actions.return === false && d0.cost.processing_cents === Number(o1.processing_cents)
     && d0.items.length === 1 && d0.timeline.some((e) => e.kind === 'charged'), 'order detail: before packing → cancel possible; claims / returns not yet; cost lines + timeline');
  const can5 = await rpc(`select ds_order_cancel($1, 'Buyer cancelled') r`, [r5.store_order_id]);
  const cn5 = await one(`select number from documents where doc_type = 'credit_note' and data ->> 'store_order_id' = $1`, [r5.store_order_id]);
  ok(can5.accepted === true && cn5 && /^CN-DS-/.test(cn5.number), `cancel before packing (DS8 rule reused): accepted, refund + ${cn5?.number}`);
  { const j = await one(`select id from journals where idempotency_key = $1`, [`ds-refund:${r5.store_order_id}`]); if (j) journalsMade.push(j.id); }
  await owner();
  const wo1 = (await one(`insert into wh_orders (warehouse_code, source, store_order_id, ship_name, ship_address, ship_country, status) values ($1, 'dropship', $2, 'Huda A', '{"line1":"12 Marina Walk","city":"Dubai","country":"AE"}'::jsonb, 'AE', 'picked') returning id`, [defW, o1.id])).id;
  await as(A.uid);
  const d1 = await rpc(`select ds10_order_detail($1) r`, [o1.id]);
  ok(d1.actions.cancel === false && /Packing has started/.test(d1.actions.cancel_reason) && d1.actions.address_after_label === false, 'picked: cancel refused with the reason; address still changeable (no label)');
  const ad1 = await rpc(`select ds10_order_address($1, $2::jsonb) r`, [o1.id, JSON.stringify({ name: 'Huda Ahmed', line1: '7 Palm Road', city: 'Dubai', country: 'AE' })]);
  await owner();
  const w1 = await one(`select ship_address from wh_orders where id = $1`, [wo1]);
  ok(ad1.applied === true && (await so(o1.id)).shipping_address.line1 === '7 Palm Road' && w1.ship_address.line1 === '7 Palm Road', 'address before the label: applied to the store order and the picked warehouse order');
  await handOver(o1.id);
  await as(A.uid);
  const ad2 = await rpc(`select ds10_order_address($1, $2::jsonb) r`, [o1.id, JSON.stringify({ name: 'Huda Ahmed', line1: '99 New Street', city: 'Dubai', country: 'AE' })]);
  const tk1 = await one(`select category, store_order_id, division_id = division_id_of('DS') ds from tickets where id = $1`, [ad2.ticket_id]);
  ok(ad2.applied === false && ad2.problem === true && tk1 && tk1.store_order_id === o1.id && tk1.category === 'order_problem' && tk1.ds && (await so(o1.id)).shipping_address.line1 === '7 Palm Road',
    'after the label: not applied → problem flow with a ticket linked to the store order (division DS)');

  // ── 2. lost claim → carrier claim → reship ──
  await as(A.uid);
  ok(/NOT_SHIPPED/.test(await err(`select ds10_claim_open($1, 'lost', 'reship', 'Buyer says nothing arrived after 3 weeks', '{}')`, [r2.store_order_id])), 'claim before handover refused');
  const c1 = await rpc(`select ds10_claim_open($1, 'lost', 'reship', 'No tracking scan for 10 days, buyer has nothing.', '{}') r`, [o1.id]);
  const case1 = await caseOf(c1.id);
  const tc1 = await one(`select store_order_id, category from tickets where id = $1`, [case1.ticket_id]);
  ok(c1.ok && /^DSC-\d{5}$/.test(c1.code) && case1.status === 'reported' && case1.merchant_choice === 'reship' && tc1?.store_order_id === o1.id, `lost claim ${c1.code} opened with a ticket linked to the order`);
  await as(A.uid);
  ok(/ALREADY_OPEN/.test(await err(`select ds10_claim_open($1, 'damaged', 'refund', 'Second claim on the same order', '{}')`, [o1.id])), 'one open claim per order');
  await as(B.uid);
  ok(/NOT_FOUND|DROPSHIP_NOT_ENABLED/.test(await err(`select ds10_claim_open($1, 'lost', 'refund', 'Not my order at all, testing', '{}')`, [o1.id])), 'another merchant can\'t open a claim on it');
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds10_case_reship($1, null, null)`, [c1.id])), 'a merchant can\'t decide claims');
  await as(support, 'aal2');
  const cc = await rpc(`select ds10_case_carrier($1, 'YT-CLAIM-778') r`, [c1.id]);
  ok(cc.status === 'carrier_claim' && (await caseOf(c1.id)).carrier_claim_ref === 'YT-CLAIM-778', 'staff: claim opened with the carrier (reference kept)');
  const wBeforeReship = await walletOf(A.org);
  await as(support, 'aal2');
  const rs = await rpc(`select ds10_case_reship($1, 'Sorry for the trouble.', null) r`, [c1.id]);
  const reship = rs?.reship_store_order_id ? await so(rs.reship_store_order_id) : null;
  const rwo = reship ? await one(`select warehouse_code, status, source from wh_orders where store_order_id = $1`, [reship.id]) : null;
  const task = await one(`select status, detail from dropship_channel_tasks where store_order_id = $1 and action = 'update_tracking'`, [o1.id]);
  ok(rs.status === 'reshipped' && reship && Number(reship.total_cents) === 0 && reship.payment_state === 'paid' && rwo?.source === 'dropship' && rwo.warehouse_code === defW
     && ['allocated', 'new'].includes(rwo.status) && (await walletOf(A.org)) === wBeforeReship,
    `reship: new order ${reship?.order_number} (US$0.00, no charge) + warehouse order at ${defW} (${rwo?.status})`);
  ok(task?.status === 'waiting_store' && task.detail.reship_store_order_id === reship?.id, 'the store is told the new tracking later (channel task waiting for the store connection)');
  const tr1 = await one(`select status from tickets where id = $1`, [case1.ticket_id]);
  ok(tr1.status === 'resolved', 'the claim ticket is resolved with the decision');

  // ── 3. damaged claim → refund ≤ US$1,000 ──
  const o2 = await so(r2.store_order_id);
  await handOver(o2.id);
  await as(A.uid);
  ok(/PHOTO_REQUIRED/.test(await err(`select ds10_claim_open($1, 'damaged', 'refund', 'Box crushed, item broken.', '{}')`, [o2.id])), 'damaged claim needs a photo');
  const ph = await photo(A.org, o2.id);
  await as(A.uid);
  const c2 = await rpc(`select ds10_claim_open($1, 'damaged', 'refund', 'Box crushed, item broken.', $2::text[]) r`, [o2.id, [ph]]);
  ok(c2.ok && Number((await one(`select count(*) n from dropship_case_photos where case_id = $1`, [c2.id])).n) === 1, 'damaged claim with a photo (private bucket path recorded)');
  await as(A.uid);
  ok((await one(`select ds10_claim_photo_can_read($1) r`, [ph])).r === true, 'the merchant can read their own claim photo');
  await as(B.uid);
  ok((await one(`select ds10_claim_photo_can_read($1) r`, [ph])).r === false, 'another merchant can\'t read it');
  await as(support, 'aal2');
  ok(/REFUND_TOO_HIGH/.test(await err(`select ds10_case_refund($1, $2, null)`, [c2.id, Number(o2.charged_cents) + 1])), 'refund above what was paid refused');
  const wB2 = await walletOf(A.org);
  await as(support, 'aal2');
  const rf2 = await rpc(`select ds10_case_refund($1, $2, 'Refunded in full.') r`, [c2.id, Number(o2.charged_cents)]);
  const case2 = await caseOf(c2.id);
  const cn2 = case2.credit_document_id ? await one(`select number, amount_cents, original_document_id from documents where id = $1`, [case2.credit_document_id]) : null;
  const j2 = case2.refund_journal_id ? await all(`select la.code, le.debit_cents, le.credit_cents from ledger_entries le join ledger_accounts la on la.id = le.account_id where le.journal_id = $1`, [case2.refund_journal_id]) : [];
  ok(rf2.status === 'refunded' && (await walletOf(A.org)) === wB2 + Number(o2.charged_cents) && cn2 && /^CN-DS-/.test(cn2.number) && cn2.original_document_id === o2.invoice_id
     && j2.some((e) => e.code === `wallet:${A.org}` && Number(e.credit_cents) === Number(o2.charged_cents)) && j2.some((e) => /^exp:refunds/.test(e.code)),
    `refund ≤ US$1,000: wallet credited, Refunds & credits debited, ${cn2?.number} against the OCT-DS invoice`);
  if (case2.refund_journal_id) journalsMade.push(case2.refund_journal_id);
  ok(Number((await so(o2.id)).refunded_cents) === Number(o2.charged_cents) && !case2.finance_approval_id, 'refunded amount recorded on the order; no Finance approval needed');

  // ── 4. refund > US$1,000: second Finance approver ──
  await owner();
  const legal = (await one(`select current_legal_entity_id(now()) e`)).e;
  const mkBig = async (n) => {
    const inv = (await one(`insert into documents (org_id, division_id, legal_entity_id, doc_type, number, amount_cents, paid_cents, currency, status, payment_option, data)
       values ($1, division_id_of('DS'), $2, 'commercial_invoice', next_document_number('invoice', division_id_of('DS'), now(), $2), 150000, 150000, 'USD', 'paid', 'pay_now', '{"service":"dropship"}'::jsonb) returning id`, [A.org, legal])).id;
    const id = (await one(`insert into store_orders (org_id, channel, external_order_id, buyer_name, shipping_address, destination_country, buyer_currency, shipping_method,
        product_cents, processing_cents, shipping_cents, duties_cents, total_cents, payment_state, staff_stage)
       values ($1, 'manual', $2, 'Big Buyer', '{"line1":"1 Big St","city":"Dubai","country":"AE"}'::jsonb, 'AE', 'USD', 'standard', 140000, 4000, 6000, 0, 150000, 'paid', 'handed_over') returning id`, [A.org, `BIG-${stamp}-${n}`])).id;
    await db.query(`insert into dropship_order_intake (store_order_id, org_id, channel, payment_option, charged_cents, charged_at, invoice_id) values ($1, $2, 'manual', 'wallet', 150000, now(), $3)`, [id, A.org, inv]);
    await db.query(`update documents set data = data || jsonb_build_object('store_order_id', $1::text) where id = $2`, [id, inv]);
    return { id, inv };
  };
  const big1 = await mkBig(1);
  const big2 = await mkBig(2);
  await as(A.uid);
  const cb1 = await rpc(`select ds10_claim_open($1, 'lost', 'refund', 'Pallet of goods never arrived.', '{}') r`, [big1.id]);
  await as(finMaker, 'aal2');
  const pr = await rpc(`select ds10_case_refund($1, 120000, 'Carrier confirmed the loss.') r`, [cb1.id]);
  const fa = pr.finance_approval_id ? await one(`select * from finance_approvals where id = $1`, [pr.finance_approval_id]) : null;
  ok(pr.status === 'awaiting_approval' && fa && fa.status === 'requested' && Number(fa.amount_cents) === 120000 && fa.requested_by === finMaker && fa.org_id === null,
    'refund over US$1,000 → Finance approval requested (nothing paid yet)');
  const wBig = await walletOf(A.org);
  await as(finMaker, 'aal2');
  ok(/MAKER_CANNOT_APPROVE/.test(await err(`select ds10_refund_approve($1, true, null)`, [cb1.id])), 'the person who proposed it can\'t approve it');
  await as(support, 'aal2');
  ok(/FORBIDDEN/.test(await err(`select ds10_refund_approve($1, true, null)`, [cb1.id])), 'Support without finance:approve can\'t approve');
  await owner();
  ok(/finance_approvals_two_person|check constraint/.test(await err(`update finance_approvals set approved_by = requested_by where id = $1`, [fa.id])), 'the table itself refuses approver = proposer (two different people, DB-enforced)');
  ok((await walletOf(A.org)) === wBig, 'still nothing paid while waiting');
  await as(finChecker, 'aal2');
  const ap = await rpc(`select ds10_refund_approve($1, true, 'OK') r`, [cb1.id]);
  const caseB1 = await caseOf(cb1.id);
  const faB = await one(`select status, approved_by, executed_journal_id from finance_approvals where id = $1`, [fa.id]);
  const cnB = caseB1.credit_document_id ? await one(`select number, original_document_id from documents where id = $1`, [caseB1.credit_document_id]) : null;
  ok(ap.status === 'refunded' && (await walletOf(A.org)) === wBig + 120000 && faB.status === 'executed' && faB.approved_by === finChecker && faB.executed_journal_id === caseB1.refund_journal_id
     && cnB?.original_document_id === big1.inv, `a second Finance person approves → refunded, approval executed, ${cnB?.number}`);
  if (caseB1.refund_journal_id) journalsMade.push(caseB1.refund_journal_id);
  // rejection through Admin › Finance (decide_finance_approval) puts the case back
  await as(A.uid);
  const cb2 = await rpc(`select ds10_claim_open($1, 'lost', 'refund', 'Second big parcel never arrived.', '{}') r`, [big2.id]);
  await as(finMaker, 'aal2');
  const pr2 = await rpc(`select ds10_case_refund($1, 150000, null) r`, [cb2.id]);
  await as(finChecker, 'aal2');
  const dec = await tryq(`select decide_finance_approval($1, false, 'Wait for the carrier')`, [pr2.finance_approval_id]);
  const caseB2 = await caseOf(cb2.id);
  ok(!dec.err && caseB2.status === 'reported' && caseB2.finance_approval_id === null && caseB2.refund_cents === null,
    `rejected in Admin › Finance → the case goes back to Octopus support (${dec.err ?? caseB2.status})`);

  // ── 5. returns ──
  const o3 = await so(r3.store_order_id);
  await as(A.uid);
  ok(/NOT_DELIVERED/.test(await err(`select ds10_return_open($1, 'warehouse', 'changed_mind', 'Buyer wants to return', null)`, [o3.id])), 'return before delivery refused');
  await deliver(o3.id);
  await as(A.uid);
  const rm = await rpc(`select ds10_return_open($1, 'merchant', 'changed_mind', 'Buyer sends it to us', null) r`, [o3.id]);
  const caseRm = await caseOf(rm.id);
  ok(rm.status === 'closed' && caseRm.outcome === 'none' && !caseRm.ticket_id, 'return to the merchant\'s own address: recorded and closed, nothing refunded');
  await as(A.uid);
  const rw = await rpc(`select ds10_return_open($1, 'warehouse', 'changed_mind', 'Buyer changed their mind, sending to the warehouse', $2::jsonb) r`, [o3.id, JSON.stringify([{ item_id: v1.item_id, qty: 2 }])]);
  ok(rw.status === 'awaiting_return' && rw.ticket_id, 'return to the 3PL: waiting for the parcel, ticket opened');
  await as(support, 'aal2');
  ok(/FORBIDDEN/.test(await err(`select ds10_return_receive($1, null)`, [rw.id])), 'only warehouse staff with the returns role register the parcel');
  await as(recv, 'aal2');
  const rcv = await rpc(`select ds10_return_receive($1, 'RET-TRACK-1') r`, [rw.id]);
  const whr = await one(`select * from wh_returns where id = $1`, [rcv.wh_return_id]);
  ok(rcv.ok && whr && whr.org_id === A.org && whr.status === 'received' && whr.warehouse_code === defW && /DSC-/.test(whr.reason), `warehouse registers ${rcv.wh_return_code} (Warehouse OS return)`);
  await owner();
  const lineId = (await one(`select id from wh_return_lines where return_id = $1`, [whr.id])).id;
  const rp = `${defW}/${whr.code}/${(await one('select gen_random_uuid() u')).u}.jpg`;
  if (ctx.staging) await db.query(`insert into storage.objects (bucket_id, name, owner) values ('wh-returns', $1, $2)`, [rp, recv]);
  else await db.query(`insert into storage.objects (bucket_id, name) values ('wh-returns', $1)`, [rp]);
  await as(recv, 'aal2');
  const ph1 = await tryq(`select wh_return_add_photo($1, $2)`, [whr.id, rp]);
  await as(recv, 'aal2');
  const insp = await tryq(`select wh_return_inspect($1, $2::jsonb, 'Unopened, as new') r`, [whr.id, JSON.stringify([{ line_id: lineId, condition: 'good' }])]);
  if (ph1.err || insp.err) console.log(`  (inspection: ${ph1.err ?? ''} ${insp.err ?? ''})`);
  const whr2 = await one(`select status, charge_cents, charge_per_item_cents from wh_returns where id = $1`, [whr.id]);
  ok(whr2.status === 'inspected' && whr2.charge_cents === null && whr2.charge_per_item_cents === null, 'W5 photo + inspection work unchanged; no 3PL client charge on a Dropship return');
  await owner();
  ok(/DROPSHIP_RETURN/.test(await err(`update wh_returns set status = 'decided', decision = 'restock', decision_source = 'client', decided_at = now() where id = $1`, [whr.id])), 'a client decision on a Dropship return is refused');
  ok(/DROPSHIP_RETURN/.test(await err(`update wh_returns set status = 'decided', decision = 'send_back', decision_source = 'default', decided_at = now(), send_back_to = '{}'::jsonb where id = $1`, [whr.id])), 'send back refused for a Dropship return');
  await owner();
  const unit = Number((await one(`select max(unit_product_cents) u from store_order_items where store_order_id = $1`, [o3.id])).u);
  const fee = Number((await one(`select coalesce(fv.return_handling_cents, 0) f from store_orders so join fee_versions fv on fv.id = so.fee_version_id where so.id = $1`, [o3.id]))?.f ?? 0);
  const expect = Math.max(0, unit * 2 - fee);
  const wR = await walletOf(A.org);
  await as(support, 'aal2');
  const st = await rpc(`select ds10_return_settle($1, $2, 'Refund for the units back in stock.') r`, [rw.id, expect]);
  const caseRw = await caseOf(rw.id);
  const whr3 = await one(`select status, decision, decision_source from wh_returns where id = $1`, [whr.id]);
  ok(Number(caseRw.suggested_refund_cents) === expect && (expect === 0 ? st.status === 'closed' : st.status === 'refunded' && (await walletOf(A.org)) === wR + expect)
     && whr3.status === 'decided' && whr3.decision === 'restock' && whr3.decision_source === 'default',
    `settle: suggested refund = good units × price − return handling fee (${expect}), warehouse return gets the default decision (restock)`);
  if (caseRw.refund_journal_id) journalsMade.push(caseRw.refund_journal_id);
  await as(recv, 'aal2');
  const done = await tryq(`select wh_return_complete($1, 'Back on the shelf') r`, [whr.id]);
  const lot = done.err ? null : await one(`select l.org_id, l.qty from wh_return_lines rl join wh_lots l on l.id = rl.lot_id where rl.return_id = $1`, [whr.id]);
  ok(!done.err && lot && lot.org_id === null && Number(lot.qty) === 2, `warehouse completes the return: restocked lot owned by Octopus (org empty) ${done.err ?? ''}`);

  // ── 6. re-weigh ──
  const o4 = await so(r4.store_order_id);
  await owner();
  const box = (await one(`insert into wh_boxes (warehouse_code, code, name, length_mm, width_mm, height_mm, tare_g) values ($1, $2, 'DS10 box', 100, 100, 100, 50) returning id`, [defW, `DS10B${stamp.slice(-5).toUpperCase()}`])).id;
  const measured = Number(o4.billed_weight_g) + 600;
  await one(`insert into wh_orders (warehouse_code, source, store_order_id, ship_name, ship_address, ship_country, status, box_id, expected_weight_g, tolerance_g, measured_weight_g, packed_at)
     values ($1, 'dropship', $2, 'Huda A', '{"line1":"12 Marina Walk","city":"Dubai","country":"AE"}'::jsonb, 'AE', 'packed', $3, $4, 10, $4, now()) returning id`, [defW, o4.id, box, measured]);
  const fvRow = await one(`select tol.weigh_tolerance_g g from fee_versions tol where tol.id = $1`, [o4.fee_version_id]);
  if (fvRow?.g == null) {
    await as(support, 'aal2');
    ok(/TOLERANCE_NOT_SET/.test(await err(`select ds10_reweigh_decide($1, 'charge')`, [o4.id])), 'tolerance not set in the fee version → nothing can be charged (absorb only)');
    await owner();
    const p1 = await mkUser('fvp'); const p2 = await mkUser('fva');
    const fv2 = (await one(`insert into fee_versions (version, pick_pack_first_cents, pick_pack_extra_cents, packaging_cents, storage_per_cbm_day_cents, return_handling_cents, insurance_bp,
        status, effective_from, proposed_by, approved_by, division_id, weigh_tolerance_g, weigh_tolerance_pct, dispute_window_days)
       select coalesce(max(version), 0) + 900, 120, 40, 0, 0, 300, 0, 'superseded', now(), $1, $2, division_id_of('3PL'), 50, 10, 7 from fee_versions returning id`, [p1, p2])).id;
    await db.query(`update store_orders set fee_version_id = $1 where id = $2`, [fv2, o4.id]);
  }
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds10_reweigh_decide($1, 'charge')`, [o4.id])), 'a merchant can\'t create a re-weigh charge');
  await as(support, 'aal2');
  const board = await rpc(`select ds10_staff_board() r`);
  const cand = board.reweigh_candidates.find((c) => c.store_order_id === o4.id);
  ok(cand && cand.over === true && cand.amount_cents > 0 && cand.billed_g > cand.quoted_g, `staff board lists the parcel over tolerance (+${cand?.diff_g} g → ${cand?.amount_cents} cents)`);
  const wRw = await walletOf(A.org);
  await as(support, 'aal2');
  const ch = await rpc(`select ds10_reweigh_decide($1, 'charge') r`, [o4.id]);
  await owner();
  const rwRow = await one(`select * from dropship_reweighs where store_order_id = $1`, [o4.id]);
  const invRw = await one(`select number, status, amount_cents from documents where id = $1`, [rwRow.invoice_id]);
  ok(ch.decision === 'charge' && rwRow.decision === 'charged' && (await walletOf(A.org)) === wRw - Number(rwRow.amount_cents) && /^OCT-DS-/.test(invRw.number) && invRw.status === 'paid'
     && new Date(rwRow.dispute_until) > new Date(Date.now() + 6 * 864e5), `re-weigh charge: wallet debited, ${invRw.number}, dispute window 7 days`);
  journalsMade.push(rwRow.charge_journal_id);
  await as(A.uid);
  const d4 = await rpc(`select ds10_order_detail($1) r`, [o4.id]);
  ok(d4.reweigh && d4.reweigh.can_dispute === true && d4.reweigh.amount_cents === Number(rwRow.amount_cents), 'order detail shows the extra charge with Dispute');
  await as(A.uid);
  await rpc(`select ds10_reweigh_dispute($1, 'Our product data says 300 g per unit; please check the photo.') r`, [rwRow.id]);
  await as(A.uid);
  ok(/ALREADY_DISPUTED/.test(await err(`select ds10_reweigh_dispute($1, 'Again please check')`, [rwRow.id])), 'one dispute per charge');
  const wD = await walletOf(A.org);
  await as(support, 'aal2');
  const dd = await rpc(`select ds10_reweigh_dispute_decide($1, true, 'Scale photo shows the extra carton; refunded as goodwill.') r`, [rwRow.id]);
  await owner();
  const rwRow2 = await one(`select * from dropship_reweighs where id = $1`, [rwRow.id]);
  ok(dd.state === 'refunded' && (await walletOf(A.org)) === wD + Number(rwRow.amount_cents) && /^CN-DS-/.test(dd.credit_note ?? ''), `dispute accepted: difference refunded with ${dd.credit_note}`);
  journalsMade.push(rwRow2.refund_journal_id);
  // window ended → refused (another order, charge back-dated)
  await owner();
  await db.query(`insert into dropship_reweighs (store_order_id, org_id, quoted_weight_g, measured_weight_g, billed_weight_g, tolerance_g, amount_cents, decision, dispute_until, created_at)
                  values ($1, $2, 500, 900, 900, 50, 60, 'charged', now() - interval '1 hour', now() - interval '8 days')`, [o1.id, A.org]);
  const late = (await one(`select id from dropship_reweighs where store_order_id = $1`, [o1.id])).id;
  await as(A.uid);
  ok(/TOO_LATE/.test(await err(`select ds10_reweigh_dispute($1, 'Too late but trying')`, [late])), 'dispute after 7 days refused');

  // ── 7. support ──
  await as(A.uid);
  const t1 = await rpc(`select ds10_ticket_create('Where is my parcel?', 'order_problem', $1, 'Tracking has not moved for a week.', '[]'::jsonb) r`, [o1.order_number]);
  const tRow = await one(`select store_order_id, category from tickets where id = $1`, [t1.id]);
  ok(t1.ok && tRow.store_order_id === o1.id && tRow.category === 'order_problem', 'new ticket by type + order number → linked to the store order');
  await as(A.uid);
  ok(/ORDER_NOT_FOUND/.test(await err(`select ds10_ticket_create('Other', 'billing', 'DSO-NOPE-1', 'Question about an order.', '[]'::jsonb)`)), 'an order number that isn\'t yours is refused with the field named');
  await as(B.uid);
  ok(/ORDER_NOT_FOUND/.test(await err(`select ds10_ticket_create('Steal', 'order_problem', $1, 'Trying to link another company order.', '[]'::jsonb)`, [o1.order_number])), 'another merchant can\'t link A\'s order');
  await as(A.uid);
  ok(/INVALID_INPUT/.test(await err(`select ds10_ticket_create('Files', 'other', null, 'Attachment outside my folder.', $1::jsonb)`, [JSON.stringify([{ path: `${B.org}/x.pdf`, name: 'x.pdf' }])])), 'attachments must be in the company\'s own folder');
  await as(A.uid);
  const sp = await rpc(`select ds10_support_page() r`);
  ok(sp.tickets.length >= 4 && sp.tickets.some((t) => t.store_order?.id === o1.id && t.case?.code === c1.code) && sp.orders.length >= 4, `support page: the company's tickets with what each is linked to (${sp.tickets.length})`);
  await owner();
  await db.query(`update company_services set status = 'paused' where org_id = $1 and service = 'dropship'`, [A.org]);
  await as(A.uid);
  ok(!(await tryq(`select ds10_ticket_create('Paused question', 'billing', null, 'We are paused, can we still ask?', '[]'::jsonb)`)).err && !(await tryq(`select ds10_order_detail($1)`, [o1.id])).err,
    'paused merchant: support and order history keep working');
  await owner();
  await db.query(`update company_services set status = 'on' where org_id = $1 and service = 'dropship'`, [A.org]);
  const feats = (await one(`select value from site_settings where key = 'dropship_features'`))?.value;
  await db.query(`insert into site_settings (key, value) values ('dropship_features', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ ...(feats ?? {}), orders: false })]);
  await as(A.uid);
  ok(/FEATURE_OFF/.test(await err(`select ds10_order_detail($1)`, [o1.id])) && !(await tryq(`select ds10_support_page()`)).err, 'Orders off (early access): order problems refused, Support still works');
  await owner();
  if (feats) await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify(feats)]);
  else await db.query(`delete from site_settings where key = 'dropship_features'`);
  await as(support, 'aal2');
  const ctxT = await rpc(`select ds10_ticket_context($1) r`, [case1.ticket_id]);
  ok(ctxT && ctxT.store_order_id === o1.id && ctxT.cases.some((c) => c.code === c1.code), 'support desk panel: the Dropship order and cases behind a ticket');

  // ── 8. RLS, anon, audit, ledger ──
  await as(B.uid);
  const leaks = [];
  for (const t of TABLES) { const n = Number((await one(`select count(*) n from ${t} where org_id = $1`, [A.org])).n); if (n) leaks.push(t); }
  ok(leaks.length === 0 && /NOT_FOUND|DROPSHIP/.test(await err(`select ds10_order_detail($1)`, [o1.id])), `merchant B reads none of A's cases / photos / re-weighs${leaks.length ? ' — ' + leaks.join(',') : ''}`);
  await as(A.uid);
  const own = Number((await one(`select count(*) n from dropship_cases`)).n);
  ok(own >= 6, `merchant A reads its own cases (${own})`);
  await as(null, 'aal1', 'anon');
  const anonErrs = [];
  for (const t of TABLES) if (!/permission denied/.test(await err(`select 1 from ${t} limit 1`))) anonErrs.push(t);
  ok(anonErrs.length === 0 && /permission denied/.test(await err(`select ds10_support_page()`)), 'anon: no table and no RPC');
  await as(A.uid);
  ok(/permission denied/.test(await err(`select ds10_refund_execute($1)`, [c2.id])) && /permission denied/.test(await err(`insert into dropship_cases (store_order_id, org_id, kind, description, merchant_choice) values ($1, $2, 'lost', 'x x x', 'refund')`, [o1.id, A.org])),
    'merchants can\'t call internals or write the tables');
  await owner();
  const audits = (await all(`select distinct action from audit_log where action like 'ds\\_case.%' or action like 'ds\\_reweigh.%' or action like 'ds\\_ticket.%'`)).map((r) => r.action);
  ok(['ds_case.opened', 'ds_case.carrier_claim', 'ds_case.reshipped', 'ds_case.refunded', 'ds_case.refund_proposed', 'ds_case.refund_rejected', 'ds_case.return_received', 'ds_reweigh.charged', 'ds_reweigh.disputed', 'ds_reweigh.dispute_refunded', 'ds_ticket.created'].every((a) => audits.includes(a)),
    `audit rows written (${audits.join(', ')})`);
  const testJournals = (await all(`select distinct j.id from journals j join ledger_entries le on le.journal_id = j.id where le.org_id = any($1::uuid[])`, [[A.org, B.org]])).map((r) => r.id);
  ok(await journalsBalanced([...new Set([...testJournals, ...journalsMade.filter(Boolean)])]), `every journal of the test is balanced (${testJournals.length})`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c && BigInt(l.d) >= BigInt(ledgerBefore.d), `ledger debit = credit (${l.d} = ${l.c})`);
  const flows = await one(`select coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint b from ledger_entries le join ledger_accounts la on la.id = le.account_id where la.code = $1`, [`wallet:${A.org}`]);
  ok(Number(flows.b) === (await walletOf(A.org)), 'wallet total consistent: top-ups − charges + refunds = the balance');

  // ── 9. down → up ──
  if (ctx.DOWN && ctx.UP) {
    await owner();
    let skipped = false;
    try { await ctx.unwindLater(db); } catch (e) { if (e.skipRoundTrip) skipped = true; else throw e; }
    if (!skipped) {
      const snap = async () => JSON.stringify(await all(`
        select 'fn' k, p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '') x from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') from information_schema.columns where table_schema = 'public'
        union all select 'pol', schemaname || '.' || tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname in ('public', 'storage')
        union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
        union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
        union all select 'tg', tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal
        union all select 'acl', c.relname || ':' || coalesce(c.relacl::text, '') from pg_class c where c.relnamespace = 'public'::regnamespace
        order by 1, 2`));
      const withIt = await snap();
      await db.query(ctx.DOWN);
      const without = await snap();
      const gone = await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES]);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ds10\\_%'`)).n);
      const coreBack = (await one(`select pg_get_functiondef('public.ds_order_address_core(uuid,jsonb,text)'::regprocedure) d`)).d;
      ok(Number(gone.n) === 0 && fnLeft === 0 && /ds_order_packing_started\(so\.id\)/.test(coreBack), 'down: every DS10 table and function is gone; DS8 address core restored');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ds10_order_problems_support.sql'));
  if (!MIG) { console.error('✘ DS10 migration file not found'); process.exit(1); }
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
    failed = await runDs10Checks(db, {
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
  console.log(failed ? `\nds10-dropship: ${failed} check(s) failed` : '\nds10-dropship: all passed');
  process.exitCode = failed ? 1 : 0;
}
