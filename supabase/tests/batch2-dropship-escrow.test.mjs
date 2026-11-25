// Phase 2 · Batch 2 (F-03): Polymorphic targets (order_id XOR store_order_id) on escrow_holds & payment_checkouts,
// plus end-to-end dropship store_order checkout via Pay now (aggregator) and Payment protection (wallet & aggregator).
// STAGING ONLY — runs inside one rolled-back transaction.
import { config } from 'dotenv';
import pg from 'pg';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const owner = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '', true)`);
};
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const asService = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try {
    const r = await db.query(q, p);
    await db.query('release savepoint sp');
    return { err: null, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback to savepoint sp');
    return { err: e.message, rows: [], n: 0 };
  }
};

try {
  await db.query('begin');

  const mkUser = async (tag, role = 'customer', divs = []) => {
    const email = `b2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (
      await one(
        `insert into auth.users(id, email, aud, role, instance_id)
         values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')
         returning id`,
        [email],
      )
    ).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [
      id,
      `B2 ${tag}`,
      email,
    ]);
    await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    for (const [code, r] of divs) {
      await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [
        id,
        code,
        r,
      ]);
    }
    return id;
  };

  const merchA = await mkUser('merchA', 'customer');
  const merchB = await mkUser('merchB', 'customer');
  const adminUid = await mkUser('adm', 'admin');
  const fin1 = await mkUser('fin1', 'finance');
  const fin2 = await mkUser('fin2', 'finance');
  const dsStaff = await mkUser('ds', 'operations', [['DS', 'staff']]);
  const whStaff = await mkUser('wh', 'warehouse', [['3PL', 'warehouse']]);

  const orgA = (await one(`insert into organizations(name, country, kyc_status, is_seed) values ('TEST B2 Merchant A', 'US', 'verified', true) returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country, kyc_status, is_seed) values ('TEST B2 Other B', 'US', 'verified', true) returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [
    orgA,
    merchA,
    orgB,
    merchB,
  ]);
  await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on'), ($2, 'dropship', 'on')`, [
    orgA,
    orgB,
  ]);
  await db.query(`insert into dropship_markets(org_id, country) values ($1, 'US')`, [orgA]);
  await db.query(
    `insert into dropship_seller_profiles(org_id, brand_name, return_name, return_line1, return_city, return_country, status)
     values ($1, 'Northstar Home Co', 'Returns Dept', '100 Market St', 'Austin', 'US', 'approved')`,
    [orgA],
  );
  await db.query(`insert into carriers(code, name, active) values ('yunexpress', 'YunExpress', true) on conflict (code) do nothing`);

  // Ensure rate card, fee version, duty version, mock payment provider, and dropship options
  // EA-1 (221): staff can no longer publish rate cards directly (two-person import flow); fixtures publish as the service owner
  await owner();
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR', 'US', 500, 80, 5, 8, 30000, 5000, 100, true, false, false, false, 'B2 US Express')`);
  await as(fin1, 'aal2');
  const fvId = (await one(`select propose_fee_version(120, 40, 0, 100, 250, 'B2 fee schedule') id`)).id;
  await as(fin2, 'aal2');
  await db.query(`select activate_fee_version($1, 'Activate B2 fee schedule')`, [fvId]);
  await as(adminUid, 'aal2');
  const dvId = (
    await one(
      `select create_duty_rate_version('B2 duty test', $1::jsonb) id`,
      [JSON.stringify([{ country: 'US', hs_prefix: '851679', duty_bp: 1000, tax_bp: 0, de_minimis_cents: 0, de_minimis_applies_to: 'duty' }])],
    )
  ).id;
  // Step 6b (222): duty versions publish only with every entry confirmed (rates + source) and a second person;
  // fixtures confirm their entries and publish as the database owner (scripts are exempt from the two-person rule only)
  await owner();
  await db.query(`update duty_rate_entries set status = 'confirmed', source = coalesce(source, 'Test fixture'), verified_at = now() where version_id = $1`, [dvId]);
  await db.query(`select activate_duty_rate_version($1)`, [dvId]);
  await owner();

  await db.query(
    `insert into payment_option_settings(service, option, enabled, min_amount_cents, release_rule, auto_release_days)
     values
       ('dropship', 'pay_now', true, 0, null, null),
       ('dropship', 'payment_protection', true, 0, 'delivery_plus_days', 7),
       ('sourcing', 'pay_now', true, 0, null, null),
       ('sourcing', 'payment_protection', true, 0, 'milestones', 7)
     on conflict (service, option) do update set enabled = excluded.enabled`,
  );
  await db.query(
    `update payment_provider_settings
        set enabled = (provider = 'mock'), fee_mode = 'absorb', fee_bp = 0, fee_fixed_cents = 0, priority = case when provider = 'mock' then 1 else 10 end`,
  );

  // Fast-ship product + 100 units of 3PL stock
  const dsProd = await one(
    `insert into dropship_products(title, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, product_price_cents, origin_country, status)
     values ('TEST B2 Kettle', 500, '{"l":20,"w":15,"h":10}'::jsonb, 1, 'own_warehouse', 'fast_ship', 1200, 'CN', 'active')
     returning id`,
  );
  const dsVar = await one(
    `insert into dropship_variants(product_id, options, price_adjust_cents, sort)
     values ($1, '{"Colour":"Matte Black"}'::jsonb, 0, 0)
     returning id, item_id`,
    [dsProd.id],
  );
  await db.query(`update item_master set hs_code = '851679', hs_code_source = 'manual' where id = $1`, [dsVar.item_id]);
  await db.query(
    `insert into dropship_routes(product_id, destination_country, shipping_method, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, is_active)
     values ($1, 'US', 'express', 2400, 600, 120, 5, 8, true)`,
    [dsProd.id],
  );
  await db.query(`select record_warehouse_stock_movement($1, 'inbound', 100, 'B2 initial inbound', 'SZ-01', null)`, [dsVar.item_id]);

  // Fund orgA wallet with US$ 2,000 (200,000c)
  await db.query(
    `select post_journal('B2 wallet funding', jsonb_build_array(
       jsonb_build_object('account', cash_account('USD'), 'debit', 200000, 'credit', 0),
       jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 200000, 'org', $1::text)
     ), 'b2-fund-' || $1::text, 'topup', 'wallet_topup', $1)`,
    [orgA],
  );

  const srcOrd = (
    await one(
      `insert into orders(org_id, division_id, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, deposit_pct, currency, is_seed)
       values ($1, division_id_of('SRC'), 'TEST B2 Sourcing Order', 'pi_issued', 10, 1000, 0, 10000, 10000, 0, 100, 'USD', true)
       returning id`,
      [orgA],
    )
  ).id;

  const mkStoreOrder = async (extId) => {
    await as(merchA, 'aal1');
    const r = (
      await one(
        `select create_dropship_store_order(
           $1, 'shopify', $2, '#' || $2, 'Alice Buyer', '+1-555-0100',
           '{"line1":"100 Main St","city":"Austin","postal_code":"78701","country":"US"}'::jsonb,
           'US', 'USD', null, 'express', 'DDP', $3::jsonb, true
         ) r`,
        [orgA, extId, JSON.stringify([{ variant_id: dsVar.id, qty: 2, buyer_unit_price_cents: 1500 }])],
      )
    ).r;
    await owner();
    return r;
  };

  const so1 = await mkStoreOrder('B2-SO-WAL-PROT');
  const so2 = await mkStoreOrder('B2-SO-AGG-PROT');
  const so3 = await mkStoreOrder('B2-SO-AGG-PAYNOW');
  const so4 = await mkStoreOrder('B2-SO-SURCHARGE');
  const soRef = await mkStoreOrder('B2-SO-REFUND');
  const soGuard = await mkStoreOrder('B2-SO-GUARD');

  // ── 1. Polymorphic XOR DB constraint checks ──
  const badEhBoth = await tryq(
    `insert into escrow_holds(org_id, division_id, service, target_type, target_id, order_id, store_order_id, funding_method, amount_cents, idempotency_key)
     values ($1, division_id_of('DS'), 'dropship', 'dropship_order', $3, $2, $3, 'wallet', 1000, 'bad-eh-both')`,
    [orgA, srcOrd, so1.store_order_id],
  );
  const badEhWrongCol = await tryq(
    `insert into escrow_holds(org_id, division_id, service, target_type, target_id, order_id, funding_method, amount_cents, idempotency_key)
     values ($1, division_id_of('DS'), 'dropship', 'dropship_order', $2, $2, 'wallet', 1000, 'bad-eh-wrong')`,
    [orgA, so1.store_order_id],
  );
  const badEhNullSo = await tryq(
    `insert into escrow_holds(org_id, division_id, service, target_type, target_id, funding_method, amount_cents, idempotency_key)
     values ($1, division_id_of('DS'), 'dropship', 'dropship_order', $2, 'wallet', 1000, 'bad-eh-null')`,
    [orgA, so1.store_order_id],
  );
  const badChkBoth = await tryq(
    `insert into payment_checkouts(org_id, division_id, service, payment_option, target_type, target_id, order_id, store_order_id, base_amount_cents, total_amount_cents, provider, idempotency_key)
     values ($1, division_id_of('DS'), 'dropship', 'pay_now', 'dropship_order', $3, $2, $3, 1000, 1000, 'mock', 'bad-chk-both')`,
    [orgA, srcOrd, so1.store_order_id],
  );
  const badChkWrongCol = await tryq(
    `insert into payment_checkouts(org_id, division_id, service, payment_option, target_type, target_id, store_order_id, base_amount_cents, total_amount_cents, provider, idempotency_key)
     values ($1, division_id_of('SRC'), 'sourcing', 'pay_now', 'order', $2, $2, 1000, 1000, 'mock', 'bad-chk-wrong')`,
    [orgA, srcOrd],
  );
  ok(
    /escrow_holds_order_target_xor_check/.test(badEhBoth.err ?? '') &&
      /escrow_holds_order_target_xor_check|escrow_holds_order_id_fkey/.test(badEhWrongCol.err ?? '') &&
      /escrow_holds_order_target_xor_check/.test(badEhNullSo.err ?? '') &&
      /payment_checkouts_order_target_xor_check/.test(badChkBoth.err ?? '') &&
      /payment_checkouts_order_target_xor_check|payment_checkouts_store_order_id_fkey/.test(badChkWrongCol.err ?? ''),
    '1. Polymorphic XOR constraints reject dual/wrong/missing order_id vs store_order_id on escrow_holds & payment_checkouts',
  );

  // ── 2. Store order + Payment protection via Wallet -> Delivery + 7d -> Finance Release (OCT-DS-) ──
  await as(merchA, 'aal1');
  const directInternalCall = await tryq(
    `select create_escrow_hold_internal($1, null, 'dropship', 'dropship_order', $2, 'wallet', $3, 'USD', 'hack-internal', null)`,
    [orgA, so1.store_order_id, so1.quote.total_cents],
  );
  ok(/permission denied/i.test(directInternalCall.err ?? ''), '2.1 Authenticated customer cannot execute create_escrow_hold_internal directly');

  await owner();
  const walBefore = Number((await one(`select wallet_balance($1, 'USD') b`, [orgA])).b);
  await as(merchA, 'aal1');
  const resWalProt = (
    await one(
      `select pay_with_protection_wallet('dropship', 'dropship_order', $1, $2, 'USD', 'b2-wal-prot-1') r`,
      [so1.store_order_id, so1.quote.total_cents],
    )
  ).r;
  const resWalProtRetry = (
    await one(
      `select pay_with_protection_wallet('dropship', 'dropship_order', $1, $2, 'USD', 'b2-wal-prot-1') r`,
      [so1.store_order_id, so1.quote.total_cents],
    )
  ).r;
  const resWalProtDupNewKey = await tryq(
    `select pay_with_protection_wallet('dropship', 'dropship_order', $1, $2, 'USD', 'b2-wal-prot-newkey')`,
    [so1.store_order_id, so1.quote.total_cents],
  );
  await owner();

  const eh1 = await one(`select * from escrow_holds where id = $1`, [resWalProt.hold_id]);
  const so1AfterPay = await one(`select * from store_orders where id = $1`, [so1.store_order_id]);
  const ho1 = await one(`select handoff_type, status from dropship_handoffs where store_order_id = $1`, [so1.store_order_id]);
  const wsAfterSo1 = await one(`select reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [dsVar.item_id]);
  const walAfter1 = Number((await one(`select wallet_balance($1, 'USD') b`, [orgA])).b);

  ok(
    eh1.store_order_id === so1.store_order_id &&
      eh1.order_id === null &&
      eh1.release_rule === 'delivery_plus_days' &&
      eh1.auto_release_days === 7 &&
      eh1.status === 'held' &&
      resWalProtRetry.hold_id === eh1.id &&
      /ORDER_ALREADY_PAID/.test(resWalProtDupNewKey.err ?? '') &&
      so1AfterPay.payment_state === 'held' &&
      so1AfterPay.escrow_hold_id === eh1.id &&
      so1AfterPay.staff_stage === 'packing' &&
      so1AfterPay.merchant_status === 'processing' &&
      ho1?.handoff_type === 'warehouse_pick_pack' &&
      ho1?.status === 'reserved' &&
      Number(wsAfterSo1.reserved_qty) === 2 &&
      walBefore - walAfter1 === Number(so1.quote.total_cents),
    `2.2 Wallet Payment protection on store_order: escrow_holds(store_order_id set, order_id null), payment_state=held, 3PL reserved (+2), wallet debited (${so1.quote.total_cents}c), retry idempotent`,
  );

  // Ship -> delivered -> escrow auto_release_at -> Finance release -> OCT-DS- invoice
  await as(dsStaff, 'aal2');
  const ship1 = (await one(`select create_store_order_shipment($1, 'yunexpress', 'BKPHR', 'YT-B2-1', 1.0, 500, 'label_ready') r`, [so1.store_order_id])).r;
  await as(whStaff, 'aal2');
  await db.query(`select warehouse_update_shipment($1, 'picked_up'::shipment_status)`, [ship1.shipment_id]);
  await db.query(`select warehouse_update_shipment($1, 'delivered'::shipment_status)`, [ship1.shipment_id]);
  await as(merchA, 'aal1');
  const escInfo1 = (await one(`select get_store_order_escrow_info($1) info`, [so1.store_order_id])).info;
  const daysDiff = (Date.parse(escInfo1.auto_release_at) - Date.parse(escInfo1.delivered_at)) / 86_400_000;
  ok(
    escInfo1.has_escrow_hold === true && escInfo1.escrow_hold_id === eh1.id && Math.abs(daysDiff - 7) < 0.01,
    `2.3 Delivery sets auto_release_at = delivered_at + ${daysDiff.toFixed(2)} days via get_store_order_escrow_info()`,
  );

  await as(fin1, 'aal2');
  const rel1 = (await one(`select finance_act_on_escrow_hold($1, 'release', $2, 'Delivered and verified', 'wallet') r`, [eh1.id, eh1.amount_cents])).r;
  await owner();
  const inv1 = await one(`select number, order_id, data from documents where id = $1`, [rel1.invoice_id]);
  const so1AfterRel = await one(`select payment_state from store_orders where id = $1`, [so1.store_order_id]);
  ok(
    rel1.status === 'released' &&
      /^OCT-DS-/.test(inv1?.number ?? '') &&
      inv1?.order_id === null &&
      inv1?.data?.store_order_id === so1.store_order_id &&
      so1AfterRel.payment_state === 'paid',
    `2.4 Finance release issues OCT-DS- invoice (${inv1?.number}) linked via data.store_order_id and transitions store_orders.payment_state='paid'`,
  );

  // Separate refund flow on Payment protection hold
  await as(merchA, 'aal1');
  const resRefHold = (
    await one(
      `select pay_with_protection_wallet('dropship', 'dropship_order', $1, $2, 'USD', 'b2-wal-ref-1') r`,
      [soRef.store_order_id, soRef.quote.total_cents],
    )
  ).r;
  await owner();
  const walBeforeRef = Number((await one(`select wallet_balance($1, 'USD') b`, [orgA])).b);
  await as(fin1, 'aal2');
  const refOut = (await one(`select finance_act_on_escrow_hold($1, 'refund', $2, 'Out of stock refund', 'wallet') r`, [resRefHold.hold_id, soRef.quote.total_cents])).r;
  await owner();
  const walAfterRef = Number((await one(`select wallet_balance($1, 'USD') b`, [orgA])).b);
  const soRefRow = await one(`select payment_state, staff_stage, merchant_status from store_orders where id = $1`, [soRef.store_order_id]);
  ok(
    refOut.status === 'refunded' &&
      walAfterRef - walBeforeRef === Number(soRef.quote.total_cents) &&
      soRefRow.payment_state === 'refunded' &&
      soRefRow.staff_stage === 'refunded' &&
      soRefRow.merchant_status === 'refunded',
    '2.5 Finance refund on store_order hold credits wallet back and sets payment_state/staff_stage/merchant_status = refunded',
  );

  // ── 3. Store order + Payment protection via Aggregator (create_payment_checkout + confirm_aggregator_webhook) ──
  await as(merchA, 'aal1');
  const chkProt = (
    await one(
      `select create_payment_checkout($1, 'dropship', 'payment_protection', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, 'b2-chk-prot') r`,
      [orgA, so2.store_order_id, so2.quote.total_cents],
    )
  ).r;
  await owner();
  const chkProtRow = await one(`select order_id, store_order_id, division_id from payment_checkouts where id = $1`, [chkProt.checkout_id]);
  ok(
    chkProtRow.store_order_id === so2.store_order_id && chkProtRow.order_id === null,
    '3.1 create_payment_checkout(payment_protection, dropship_order) sets store_order_id and leaves order_id null',
  );

  await asService();
  const whProt1 = (
    await one(
      `select confirm_aggregator_webhook('mock', 'evt_b2_prot_1', 'payment.succeeded', $1, $2, 'USD', 'pay_b2_prot_1') r`,
      [chkProt.checkout_id, so2.quote.total_cents],
    )
  ).r;
  const whProt2 = (
    await one(
      `select confirm_aggregator_webhook('mock', 'evt_b2_prot_1', 'payment.succeeded', $1, $2, 'USD', 'pay_b2_prot_1') r`,
      [chkProt.checkout_id, so2.quote.total_cents],
    )
  ).r;
  await owner();

  const eh2 = await one(`select * from escrow_holds where id = $1`, [whProt1.hold_id]);
  const so2Row = await one(`select payment_state, escrow_hold_id, staff_stage, merchant_status from store_orders where id = $1`, [so2.store_order_id]);
  const ho2 = await one(`select status from dropship_handoffs where store_order_id = $1`, [so2.store_order_id]);
  ok(
    eh2.store_order_id === so2.store_order_id &&
      eh2.order_id === null &&
      eh2.funding_method === 'aggregator' &&
      eh2.checkout_id === chkProt.checkout_id &&
      so2Row.payment_state === 'held' &&
      so2Row.escrow_hold_id === eh2.id &&
      so2Row.staff_stage === 'packing' &&
      ho2?.status === 'reserved' &&
      whProt2.repeated === true,
    '3.2 Aggregator Payment protection webhook creates escrow_hold (store_order_id set, order_id null), marks store_order held, reserves 3PL, and replays idempotently',
  );

  // ── 4. Store order + Pay now via Aggregator (with & without surcharge) ──
  await as(merchA, 'aal1');
  const chkPayNow = (
    await one(
      `select create_payment_checkout($1, 'dropship', 'pay_now', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, 'b2-chk-paynow') r`,
      [orgA, so3.store_order_id, so3.quote.total_cents],
    )
  ).r;
  await owner();
  const chkPnRow = await one(`select order_id, store_order_id from payment_checkouts where id = $1`, [chkPayNow.checkout_id]);

  await asService();
  const whPn1 = (
    await one(
      `select confirm_aggregator_webhook('mock', 'evt_b2_pn_1', 'payment.succeeded', $1, $2, 'USD', 'pay_b2_pn_1') r`,
      [chkPayNow.checkout_id, so3.quote.total_cents],
    )
  ).r;
  const whPn2 = (
    await one(
      `select confirm_aggregator_webhook('mock', 'evt_b2_pn_2', 'payment.succeeded', $1, $2, 'USD', 'pay_b2_pn_1') r`,
      [chkPayNow.checkout_id, so3.quote.total_cents],
    )
  ).r;
  await owner();

  const so3Row = await one(`select payment_state, escrow_hold_id, staff_stage, merchant_status from store_orders where id = $1`, [so3.store_order_id]);
  const ho3 = await one(`select status from dropship_handoffs where store_order_id = $1`, [so3.store_order_id]);
  const dsJournalsSo3 = await all(`select id, stream from journals where ref_type = 'store_order' and ref_id = $1`, [so3.store_order_id]);
  ok(
    chkPnRow.store_order_id === so3.store_order_id &&
      chkPnRow.order_id === null &&
      so3Row.payment_state === 'paid' &&
      so3Row.escrow_hold_id === null &&
      so3Row.staff_stage === 'packing' &&
      ho3?.status === 'reserved' &&
      dsJournalsSo3.length === 1 &&
      dsJournalsSo3[0].stream === 'dropship' &&
      whPn1.repeated === false &&
      whPn2.repeated === true,
    '4.1 Aggregator Pay now webhook on store_order posts 1 balanced dropship revenue journal, sets payment_state=paid, reserves 3PL, and replays idempotently',
  );

  // Also test Pay now with fee_mode = 'surcharge' (3% fee -> 162c surcharge on 5390c = 5552c)
  await db.query(`update payment_provider_settings set fee_mode = 'surcharge', fee_bp = 300, fee_fixed_cents = 0 where provider = 'mock'`);
  await as(merchA, 'aal1');
  const chkSur = (
    await one(
      `select create_payment_checkout($1, 'dropship', 'pay_now', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, 'b2-chk-sur') r`,
      [orgA, so4.store_order_id, so4.quote.total_cents],
    )
  ).r;
  await owner();
  await asService();
  await one(
    `select confirm_aggregator_webhook('mock', 'evt_b2_sur_1', 'payment.succeeded', $1, $2, 'USD', 'pay_b2_sur_1') r`,
    [chkSur.checkout_id, chkSur.total_amount_cents],
  );
  await owner();
  const surJournal = await one(`select id from journals where idempotency_key = $1`, [`chk-surcharge:${chkSur.checkout_id}`]);
  const so4Row = await one(`select payment_state from store_orders where id = $1`, [so4.store_order_id]);
  ok(
    Number(chkSur.surcharge_cents) > 0 &&
      Number(chkSur.total_amount_cents) === Number(chkSur.base_amount_cents) + Number(chkSur.surcharge_cents) &&
      !!surJournal &&
      so4Row.payment_state === 'paid',
    `4.2 Aggregator Pay now with surcharge posts separate service_fees journal (+${chkSur.surcharge_cents}c) and marks store_order paid`,
  );

  // ── 5. Guardrails & Regression on Sourcing order ──
  await as(merchB, 'aal1');
  const crossOrgChk = await tryq(
    `select create_payment_checkout($1, 'dropship', 'pay_now', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, 'b2-cross-1')`,
    [orgB, soGuard.store_order_id, soGuard.quote.total_cents],
  );
  await owner();
  ok(/STORE_ORDER_NOT_FOUND/.test(crossOrgChk.err ?? ''), '5.1 Cross-org store_order payment refused (STORE_ORDER_NOT_FOUND)');

  await as(merchA, 'aal1');
  const badAmtChk = await tryq(
    `select create_payment_checkout($1, 'dropship', 'pay_now', 'dropship_order', $2, 100, 'USD', 'card', 'mock', false, 'b2-badamt-1')`,
    [orgA, soGuard.store_order_id],
  );
  const badAmtWal = await tryq(
    `select pay_with_protection_wallet('dropship', 'dropship_order', $1, 100, 'USD', 'b2-badamt-wal')`,
    [soGuard.store_order_id],
  );
  ok(
    /AMOUNT_MISMATCH/.test(badAmtChk.err ?? '') && /AMOUNT_MISMATCH/.test(badAmtWal.err ?? ''),
    '5.2 Mismatched amount on store_order checkout or wallet protection refused (AMOUNT_MISMATCH)',
  );

  // Sample order refused on escrow / aggregator checkout
  const smpOrder = (
    await one(
      `select create_dropship_sample_order(
         $1, 1, 'US', 'express', 'Sample Buyer', '+1-555-0199',
         '{"line1":"100 Sample St","city":"Austin","country":"US"}'::jsonb,
         'b2-sample-guard', 'DDP', true
       ) r`,
      [dsVar.id],
    )
  ).r;
  const smpChk = await tryq(
    `select create_payment_checkout($1, 'dropship', 'pay_now', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, 'b2-smp-chk')`,
    [orgA, smpOrder.store_order_id, smpOrder.total_cents],
  );
  const smpWalProt = await tryq(
    `select pay_with_protection_wallet('dropship', 'dropship_order', $1, $2, 'USD', 'b2-smp-wal')`,
    [smpOrder.store_order_id, smpOrder.total_cents],
  );
  ok(
    /SAMPLE_ORDER_WALLET_ONLY/.test(smpChk.err ?? '') && /SAMPLE_ORDER_NO_ESCROW/.test(smpWalProt.err ?? ''),
    '5.3 Sample order refused from aggregator checkout (SAMPLE_ORDER_WALLET_ONLY) and escrow protection (SAMPLE_ORDER_NO_ESCROW)',
  );

  // Paused merchant refused on both paths
  await owner();
  await db.query(`select set_dropship_merchant_status($1, 'paused', 'Compliance check')`, [orgA]);
  await as(merchA, 'aal1');
  const pausedChk = await tryq(
    `select create_payment_checkout($1, 'dropship', 'pay_now', 'dropship_order', $2, $3, 'USD', 'card', 'mock', false, 'b2-paused-chk')`,
    [orgA, soGuard.store_order_id, soGuard.quote.total_cents],
  );
  const pausedWal = await tryq(
    `select pay_with_protection_wallet('dropship', 'dropship_order', $1, $2, 'USD', 'b2-paused-wal')`,
    [soGuard.store_order_id, soGuard.quote.total_cents],
  );
  ok(
    /DROPSHIP_PAUSED/.test(pausedChk.err ?? '') && /DROPSHIP_PAUSED/.test(pausedWal.err ?? ''),
    '5.4 Paused dropship merchant refused on both create_payment_checkout & pay_with_protection_wallet (DROPSHIP_PAUSED)',
  );

  // Sourcing order regression: order_id set, store_order_id NULL
  const chkSrc = (
    await one(
      `select create_payment_checkout($1, 'sourcing', 'payment_protection', 'order', $2, 10000, 'USD', 'card', 'mock', false, 'b2-src-chk') r`,
      [orgA, srcOrd],
    )
  ).r;
  await asService();
  const whSrc = (
    await one(
      `select confirm_aggregator_webhook('mock', 'evt_b2_src_1', 'payment.succeeded', $1, $2, 'USD', 'pay_b2_src_1') r`,
      [chkSrc.checkout_id, chkSrc.total_amount_cents],
    )
  ).r;
  await owner();
  const chkSrcRow = await one(`select order_id, store_order_id from payment_checkouts where id = $1`, [chkSrc.checkout_id]);
  const ehSrcRow = await one(`select order_id, store_order_id from escrow_holds where id = $1`, [whSrc.hold_id]);
  ok(
    chkSrcRow.order_id === srcOrd &&
      chkSrcRow.store_order_id === null &&
      ehSrcRow.order_id === srcOrd &&
      ehSrcRow.store_order_id === null,
    '5.5 Sourcing order regression: checkout & escrow_hold still populate order_id and leave store_order_id null',
  );

  const ledger = await one(
    `select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`,
  );
  ok(ledger.d === ledger.c, `5.6 Double-entry ledger strictly balanced (${ledger.d} === ${ledger.c}, diff=0)`);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}

console.log(failed ? `\nbatch2 dropship escrow tests: ${failed} failed` : '\nbatch2 dropship escrow tests: all passed');
process.exitCode = failed ? 1 : 0;
