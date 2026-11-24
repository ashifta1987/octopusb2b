// Step I2 DB & end-to-end pipeline test suite (Migration 212 — STAGING ONLY, rolled-back transaction):
//  · Item 18: status_mappings with target ('order' | 'request' | 'brand_project' | 'ticket') — exhaustive check
//    against pg_enum (shipment_status, rfq_status, ticket_status) & brand_projects statuses + constraint enforcement.
//  · Item 19: store_orders.fx_rate_to_usd nullable (no default 1); required (> 0) when buyer_currency <> 'USD'.
//  · Item 20: shipments.tracking_token via extensions.gen_random_bytes; /t/[token] RPC serves store_order shipments ONLY
//    (null for wholesale shipments); shipments XOR check; warehouse_stock_movements FK; tickets store_order_id + XOR check.
//  · Item 21: domain_events DB-only SQL consumer (fast_ship reserve -> pick -> delivered + escrow clock; extended_catalog
//    Sourcing handoff -> received_at_3pl -> ready_to_pick; cancel -> release stock; external_status queued for Step 5/7).
//  · Item 22: internal_charge_rules seeded inactive (active = false) with NULL rates.
//  · Item 23: RLS on store_orders & store_order_items (merchant org + DS/Finance staff only; 0 for other orgs, suppliers,
//    warehouse-only staff, anon); buyer address/phone/email/name NEVER returned on tracking or get_dropship_orders_report().
//  · Item 24: duty_rate_entries.de_minimis_applies_to ('duty' -> 1200c gives 24c tax-only; 'duty_and_tax' -> 1200c gives 0c).
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
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const asAnon = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
  await db.query('set local role anon');
};
const owner = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '', true)`);
};
const tryq = async (q, p) => {
  await db.query('savepoint s');
  try {
    const r = await db.query(q, p);
    await db.query('release savepoint s');
    return { err: null, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback to savepoint s');
    return { err: e.message, rows: [], n: 0 };
  }
};

try {
  await db.query('begin');

  const ledgerBefore = await one(`
    select coalesce(sum(debit_cents),0)::text d,
           coalesce(sum(credit_cents),0)::text c,
           coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff,
           (select coalesce(sum(wallet_balance(org_id)),0)::text from wallets) w
      from ledger_entries
  `);

  const mkUser = async (tag, role = null, divs = []) => {
    const email = `i2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `T ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    for (const [code, r] of divs) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
    return id;
  };

  const merchA = await mkUser('merchA', 'customer');
  const merchB = await mkUser('merchB', 'customer');
  const supUser = await mkUser('sup', 'supplier');
  const distUser = await mkUser('dist', 'distributor');
  const whStaff = await mkUser('wh3pl', 'warehouse', [['3PL', 'warehouse']]);
  const dsStaff = await mkUser('ds', 'operations', [['DS', 'staff']]);
  const srcStaff = await mkUser('src', 'sourcing_agent', [['SRC', 'staff']]);
  const fin1 = await mkUser('fin1', 'finance');
  const fin2 = await mkUser('fin2', 'finance');
  const adminUser = await mkUser('adm', 'admin');

  const orgA = (await one(`insert into organizations(name, country) values ('TEST I2 Merchant A', 'US') returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country) values ('TEST I2 Buyer B', 'DE') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, merchA, orgB, merchB]);
  await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on')`, [orgA]);
  await db.query(`insert into dropship_markets(org_id, country) values ($1, 'US'), ($1, 'GB')`, [orgA]);
  await db.query(`
    insert into dropship_seller_profiles(org_id, brand_name, return_name, return_line1, return_city, return_country, status)
    values ($1, 'Northstar Home Co', 'Returns Dept', '100 Market St', 'Austin', 'US', 'approved')
  `, [orgA]);

  // Ensure carrier 'yunexpress' exists for shipments FK
  await db.query(`insert into carriers(code, name, active) values ('yunexpress', 'YunExpress', true) on conflict (code) do nothing`);

  // ── 1. Item 18: Exhaustive status_mappings check against pg_enum & brand_projects ──
  const enumVals = async (typ) => (await all(`
    select e.enumlabel as v
      from pg_type t join pg_enum e on e.enumtypid = t.oid
     where t.typname = $1
     order by e.enumsortorder
  `, [typ])).map((r) => r.v);

  const shipStatuses = await enumVals('shipment_status');
  const rfqStatuses = await enumVals('rfq_status');
  const ticketStatuses = await enumVals('ticket_status');
  const bpStatuses = ['submitted', 'proof', 'sample', 'quoted', 'production', 'stocked', 'closed'];

  const shipUnmapped = [];
  for (const s of shipStatuses) {
    const m = (await one(`select resolve_dropship_status_mapping('3pl_shipment', $1) m`, [s])).m;
    if (!m || m.target !== 'order' || !m.staff_stage || !m.merchant_status) shipUnmapped.push(s);
  }
  ok(shipUnmapped.length === 0 && shipStatuses.length === 10,
    `Item 18: all ${shipStatuses.length} shipment_status enum values map to target='order' + staff_stage`);

  const rfqBad = [];
  for (const s of rfqStatuses) {
    const m = (await one(`select resolve_dropship_status_mapping('sourcing_rfq', $1) m`, [s])).m;
    if (!m || m.target !== 'request' || m.staff_stage !== null) rfqBad.push(s);
  }
  ok(rfqBad.length === 0 && rfqStatuses.length === 8,
    `Item 18: all ${rfqStatuses.length} rfq_status enum values map to target='request' (never order, staff_stage=null)`);

  const bpBad = [];
  for (const s of bpStatuses) {
    const m = (await one(`select resolve_dropship_status_mapping('mmb_brand_project', $1) m`, [s])).m;
    if (!m || m.target !== 'brand_project' || m.staff_stage !== null) bpBad.push(s);
  }
  ok(bpBad.length === 0 && bpStatuses.length === 7,
    `Item 18: all ${bpStatuses.length} brand_projects statuses map to target='brand_project' (never order, staff_stage=null)`);

  const tkBad = [];
  for (const s of ticketStatuses) {
    const m = (await one(`select resolve_dropship_status_mapping('support_ticket', $1) m`, [s])).m;
    if (!m || m.target !== 'ticket' || m.staff_stage !== null) tkBad.push(s);
  }
  ok(tkBad.length === 0 && ticketStatuses.length === 7,
    `Item 18: all ${ticketStatuses.length} ticket_status enum values map to target='ticket' (never order, staff_stage=null)`);

  ok(
    !!(await tryq(`insert into status_mappings(source_domain, source_status, target, merchant_status, merchant_label, staff_stage) values ('sourcing_rfq', 'bad_test', 'order', 'processing', 'Bad', 'packed')`)).err
      && !!(await tryq(`insert into status_mappings(source_domain, source_status, target, merchant_status, merchant_label, staff_stage) values ('support_ticket', 'bad_test', 'order', 'processing', 'Bad', 'packed')`)).err,
    'Item 18: constraint blocks mapping rfqs or tickets to target=order',
  );

  // ── 2. Setup rate cards, 3PL fees, and Item 24 duty_rate_entries (de_minimis_applies_to: 'duty' vs 'duty_and_tax') ──
  await as(adminUser, 'aal2');
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR', 'US', 500, 80, 5, 8, 30000, 5000, 100, true, false, false, false, 'US Express')`);
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR-GB', 'GB', 550, 85, 5, 9, 30000, 5000, 100, true, false, false, false, 'UK Express')`);
  await as(fin1, 'aal2');
  const fvId = (await one(`select propose_fee_version(120, 40, 0, 100, 250, 'I2 fee schedule') id`)).id;
  await as(fin2, 'aal2');
  await db.query(`select activate_fee_version($1, 'Approve I2 fee schedule')`, [fvId]);

  await as(adminUser, 'aal2');
  // US: de_minimis_applies_to = 'duty_and_tax' (<= 2000c -> 0 duty AND 0 tax); GB: de_minimis_applies_to = 'duty' (<= 2000c -> 0 duty, 2% tax = 24c on 1200c!)
  const dvId = (await one(`
    select create_duty_rate_version('I2 de_minimis_applies_to test', $1::jsonb) id
  `, [JSON.stringify([
    { country: 'GB', hs_prefix: '851679', duty_bp: 1000, tax_bp: 200, de_minimis_cents: 2000, de_minimis_applies_to: 'duty' },
    { country: 'US', hs_prefix: '851679', duty_bp: 1000, tax_bp: 200, de_minimis_cents: 2000, de_minimis_applies_to: 'duty_and_tax' },
    { country: 'US', hs_prefix: null,     duty_bp: 500,  tax_bp: 0,   de_minimis_cents: 2000, de_minimis_applies_to: 'duty_and_tax' },
  ])])).id;
  await db.query(`select activate_duty_rate_version($1)`, [dvId]);
  await owner();

  // Create fast_ship & extended_catalog dropship products
  const sup = (await one(`insert into suppliers(legal_name, country, verified, user_id) values ('I2 Factory Co', 'CN', true, $1) returning id`, [supUser])).id;
  await db.query(`insert into supplier_switches(supplier_id) values ($1) on conflict do nothing`, [sup]);
  const srcProd = await one(`
    insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency, origin_country, net_weight, colour_box_mm)
    values ('QA-I2-SRC1', 'qa-i2-src1', 'I2 Sourcing Lamp', $1, 'draft', 'pcs', 10, 'USD', 'CN', '400g', '200*150*100mm')
    returning id
  `, [sup]);
  const sp = (await one(`insert into supplier_products(supplier_id, product_id, status, is_preferred, stock_qty) values ($1, $2, 'quoted', true, 50) returning id`, [sup, srcProd.id]));
  await db.query(`insert into product_costs(product_id, supplier_cost_cents) values ($1, 500)`, [srcProd.id]);

  const dsFast = await one(`
    insert into dropship_products(title, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, product_price_cents, origin_country, status)
    values ('TEST I2 Fast Kettle', 500, '{"l":20,"w":15,"h":10}'::jsonb, 1, 'own_warehouse', 'fast_ship', 1200, 'CN', 'active')
    returning id
  `);
  const varFast = await one(`insert into dropship_variants(product_id, options, price_adjust_cents, sort) values ($1, '{"Colour":"Matte Black"}'::jsonb, 0, 0) returning id, item_id`, [dsFast.id]);
  await db.query(`update item_master set hs_code = '851679', hs_code_source = 'manual' where id = $1`, [varFast.item_id]);

  const dsExt = await one(`
    insert into dropship_products(title, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, product_price_cents, origin_country, status)
    values ('TEST I2 Extended Mug', 300, '{"l":12,"w":10,"h":10}'::jsonb, 1, 'partner_supplier', 'extended_catalog', 900, 'CN', 'active')
    returning id
  `);
  const varExt = await one(`insert into dropship_variants(product_id, options, supplier_product_id, price_adjust_cents, sort) values ($1, '{"Size":"Large"}'::jsonb, $2, 0, 0) returning id, item_id`, [dsExt.id, sp.id]);
  await db.query(`update item_master set hs_code = '851679', hs_code_source = 'manual' where id = $1`, [varExt.item_id]);

  await db.query(`
    insert into dropship_routes(product_id, destination_country, shipping_method, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, is_active)
    values ($1, 'US', 'express', 2400, 600, 0, 5, 8, true),
           ($1, 'GB', 'express', 2500, 650, 24, 5, 9, true),
           ($2, 'US', 'express', 2000, 550, 0, 5, 8, true)
  `, [dsFast.id, dsExt.id]);

  // Seed 50 units of varFast in 3PL SZ-01
  await db.query(`select record_warehouse_stock_movement($1, 'inbound', 50, 'I2 initial inbound', 'SZ-01', null)`, [varFast.item_id]);

  // Verify Item 24: GB ('duty') charges 24c on 1200c <= 2000c, whereas US ('duty_and_tax') charges 0c on 1200c <= 2000c and 300c on 2500c > 2000c!
  await as(merchA, 'aal1');
  const qGbDutyOnly = (await one(`select get_dropship_quote($1, 'GB', 'express', 1, 'DDP') q`, [varFast.id])).q;
  const qUsDutyAndTax = (await one(`select get_dropship_quote($1, 'US', 'express', 1, 'DDP') q`, [varFast.id])).q;
  const qUsAbove = (await one(`
    select get_dropship_order_quote($1::jsonb, 'US', 'express', 'DDP', 'USD', null) q
  `, [JSON.stringify([{ variant_id: varFast.id, qty: 1, buyer_unit_price_cents: 2500 }])])).q;
  ok(
    qGbDutyOnly.duties_cents === 24 && qUsDutyAndTax.duties_cents === 0 && qUsAbove.duties_cents === 300,
    `Item 24: below de_minimis (1200c<=2000c), de_minimis_applies_to='duty' -> 24c tax-only while 'duty_and_tax' -> 0c; above threshold (2500c) -> 300c`,
  );
  await owner();

  // ── 3. Item 19: store_orders.fx_rate_to_usd nullable (no default 1) & required when buyer_currency <> 'USD' ──
  const fxCol = await one(`
    select is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public' and table_name = 'store_orders' and column_name = 'fx_rate_to_usd'
  `);
  ok(fxCol.is_nullable === 'YES' && fxCol.column_default === null,
    'Item 19: store_orders.fx_rate_to_usd is nullable and has NO default 1');

  await as(merchA, 'aal1');
  const badNonUsdOrder = await tryq(`
    select create_dropship_store_order(
      $1, 'shopify', 'SHP-ERR-FX', '#9901', 'Jane Doe', 'jane@example.com', '+44-7700-900077',
      '{"line1":"10 Downing St","city":"London","country":"GB"}'::jsonb,
      'GB', 'GBP', null, 'express', 'DDP', $2::jsonb, true
    )
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 1, buyer_unit_price_cents: 1800 }])]);
  ok(/FX_RATE_REQUIRED/.test(badNonUsdOrder.err ?? ''),
    'Item 19: create_dropship_store_order rejects GBP order with null fx_rate_to_usd (FX_RATE_REQUIRED)');

  const gbpOrder = (await one(`
    select create_dropship_store_order(
      $1, 'shopify', 'SHP-GBP-1001', '#1001', 'Homer BuyerSecret', 'secretbuyer@example.com', '+1-555-0199',
      '{"line1":"742 Evergreen Terrace","city":"London","postal_code":"SW1A 2AA","country":"GB"}'::jsonb,
      'GB', 'GBP', 1.25, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 2, buyer_unit_price_cents: 2000 }])])).r;
  ok(gbpOrder.ok === true && gbpOrder.idempotent === false && /^DSO-\d{6,}$/.test(gbpOrder.order_number),
    `Item 19: GBP order with fx_rate_to_usd=1.25 created (${gbpOrder.order_number})`);

  // Idempotent retry on same (org_id, channel, external_order_id)
  const gbpRetry = (await one(`
    select create_dropship_store_order(
      $1, 'shopify', 'SHP-GBP-1001', '#1001', 'Homer BuyerSecret', 'secretbuyer@example.com', '+1-555-0199',
      '{"line1":"742 Evergreen Terrace","city":"London","postal_code":"SW1A 2AA","country":"GB"}'::jsonb,
      'GB', 'GBP', 1.25, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 2, buyer_unit_price_cents: 2000 }])])).r;
  ok(gbpRetry.idempotent === true && gbpRetry.store_order_id === gbpOrder.store_order_id,
    'create_dropship_store_order is idempotent on (org_id, channel, external_order_id)');

  // USD order with fx_rate_to_usd = NULL succeeds and stores NULL
  const usdOrder = (await one(`
    select create_dropship_store_order(
      $1, 'manual', 'MAN-USD-1002', '#1002', 'Homer BuyerSecret', 'secretbuyer@example.com', '+1-555-0199',
      '{"line1":"742 Evergreen Terrace","city":"Austin","postal_code":"78701","country":"US"}'::jsonb,
      'US', 'USD', null, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 3, buyer_unit_price_cents: 1500 }])])).r;
  await owner();
  const usdRow = await one(`select fx_rate_to_usd from store_orders where id = $1`, [usdOrder.store_order_id]);
  ok(usdOrder.ok === true && usdRow.fx_rate_to_usd === null,
    'Item 19: USD order with fx_rate_to_usd=NULL stores NULL (never 1)');

  // ── 4. Item 20 & 21: End-to-End Pipeline (Fast-Ship Order -> Paid -> Reserve -> Shipment + Token -> Picked Up -> Delivered + Escrow Clock) ──
  await as(merchA, 'aal1');
  const paidRes = (await one(`select mark_store_order_paid($1) r`, [usdOrder.store_order_id])).r;
  await owner();

  const wsAfterReserve = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [varFast.item_id]);
  const handoffFast = await one(`select handoff_type, status, (select code from divisions where id = to_division_id) div_code from dropship_handoffs where store_order_id = $1`, [usdOrder.store_order_id]);
  ok(
    paidRes.merchant_status === 'processing'
      && paidRes.staff_stage === 'stock_reserved'
      && wsAfterReserve.on_hand_qty === 50
      && wsAfterReserve.reserved_qty === 3
      && handoffFast.handoff_type === 'warehouse_pick_pack'
      && handoffFast.div_code === '3PL',
    'Item 21 (Pipeline A - Paid): DB-only consumer reserves 3 units in SZ-01, creates 3PL handoff, and advances status to processing/stock_reserved',
  );

  // Create shipment for usdOrder -> mints cryptographic tracking_token via extensions.gen_random_bytes
  await as(dsStaff, 'aal2');
  const shipRes = (await one(`
    select create_store_order_shipment($1, 'yunexpress', 'BKPHR', 'YT261124000001', 1.8, 740, 'label_ready') r
  `, [usdOrder.store_order_id])).r;
  await owner();

  ok(
    !!shipRes.shipment_id && /^[0-9a-f]{36}$/.test(shipRes.tracking_token),
    `Item 20: create_store_order_shipment mints 36-hex tracking_token via extensions.gen_random_bytes (${shipRes.tracking_token})`,
  );

  await db.query(`
    insert into tracking_events(shipment_id, org_id, status, description, location, occurred_at)
    values ($1, $2, 'in_transit', 'Departed origin facility', 'Shenzhen', now())
  `, [shipRes.shipment_id, orgA]);

  // 3PL warehouse updates shipment: picked_up -> delivered
  await as(whStaff, 'aal2');
  await db.query(`select warehouse_update_shipment($1, 'picked_up'::shipment_status)`, [shipRes.shipment_id]);
  await owner();

  const wsAfterPick = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [varFast.item_id]);
  const soAfterPick = await one(`select merchant_status, staff_stage from store_orders where id = $1`, [usdOrder.store_order_id]);
  ok(
    wsAfterPick.on_hand_qty === 47 && wsAfterPick.reserved_qty === 0 && soAfterPick.merchant_status === 'in_transit' && soAfterPick.staff_stage === 'shipped',
    'Item 21 (Pipeline A - Shipped): 3PL picked_up triggers DB-only pick movement (on_hand 50->47, reserved 3->0) and in_transit/shipped status',
  );

  await as(whStaff, 'aal2');
  await db.query(`select warehouse_update_shipment($1, 'delivered'::shipment_status)`, [shipRes.shipment_id]);
  await owner();

  const soDelivered = await one(`select merchant_status, staff_stage, delivered_at, escrow_release_at from store_orders where id = $1`, [usdOrder.store_order_id]);
  const extPendingCnt = (await one(`select count(*)::int n from domain_events where aggregate_id = $1 and external_status = 'pending'`, [shipRes.shipment_id])).n;
  ok(
    soDelivered.merchant_status === 'delivered'
      && soDelivered.staff_stage === 'delivered'
      && !!soDelivered.delivered_at
      && !!soDelivered.escrow_release_at
      && extPendingCnt >= 1,
    'Item 21 (Pipeline A - Delivered): delivered starts escrow clock (delivered_at + escrow_release_at) and queues external_status=pending for Step 5/7 worker',
  );

  // ── 5. Pipeline B (Extended-Catalog -> Sourcing Handoff -> Received at 3PL -> Ready to Pick) & Pipeline C (Cancel -> Release Stock) ──
  await as(merchA, 'aal1');
  const extOrder = (await one(`
    select create_dropship_store_order(
      $1, 'manual', 'MAN-EXT-1003', '#1003', 'Lisa Buyer', 'lisa@example.com', '+1-555-0122',
      '{"line1":"100 Main St","city":"Austin","country":"US"}'::jsonb,
      'US', 'USD', null, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varExt.id, qty: 2, buyer_unit_price_cents: 1500 }])])).r;
  const extPaid = (await one(`select mark_store_order_paid($1) r`, [extOrder.store_order_id])).r;
  await owner();

  const srcHandoff = await one(`select id, handoff_type, status, (select code from divisions where id = to_division_id) div_code from dropship_handoffs where store_order_id = $1`, [extOrder.store_order_id]);
  ok(
    extPaid.merchant_status === 'awaiting_stock'
      && extPaid.staff_stage === 'awaiting_procurement'
      && srcHandoff.handoff_type === 'sourcing_procurement'
      && srcHandoff.div_code === 'SRC',
    'Item 21 (Pipeline B - Extended Catalog): paid creates Sourcing procurement handoff (awaiting_stock / awaiting_procurement)',
  );

  await as(srcStaff, 'aal2');
  await db.query(`select receive_sourcing_handoff_at_3pl($1, 'SZ-01')`, [srcHandoff.id]);
  await owner();

  const soReady = await one(`select merchant_status, staff_stage from store_orders where id = $1`, [extOrder.store_order_id]);
  const wsExt = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [varExt.item_id]);
  ok(
    soReady.merchant_status === 'processing' && soReady.staff_stage === 'ready_to_pick' && wsExt.on_hand_qty === 2 && wsExt.reserved_qty === 2,
    'Item 21 (Pipeline B - Received at 3PL): Sourcing handoff receipt records inbound+reserve (2/2) and advances to processing/ready_to_pick',
  );

  // Pipeline C: Paid gbpOrder (qty 2 of varFast) -> cancel -> releases reserved stock
  await as(merchA, 'aal1');
  await db.query(`select mark_store_order_paid($1)`, [gbpOrder.store_order_id]);
  const cancelRes = (await one(`select cancel_store_order($1, 'Buyer requested cancellation before dispatch') r`, [gbpOrder.store_order_id])).r;
  await owner();
  const wsAfterCancel = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [varFast.item_id]);
  ok(
    cancelRes.merchant_status === 'cancelled' && cancelRes.staff_stage === 'cancelled' && wsAfterCancel.on_hand_qty === 47 && wsAfterCancel.reserved_qty === 0,
    'Item 21 (Pipeline C - Cancel): cancelling reserved order releases 3PL reservation (on_hand=47, reserved=0)',
  );

  // ── 6. Item 20 & 23: Wholesale shipment exclusion on /t/[token], FK checks, Tickets link, & Zero Buyer PII on Tracking + Reports ──
  const whOrder = await one(`
    insert into orders(org_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, division_id)
    values ($1, 'Wholesale B2B Order', 100, 500, 50000, 15000, 'confirmed', 'USD', division_id_of('SRC'))
    returning id
  `, [orgB]);
  const whShip = await one(`
    insert into shipments(order_id, org_id, carrier_code, tracking_no, status, currency, division_id)
    values ($1, $2, 'yunexpress', 'YT-WHOLESALE-1', 'in_transit', 'USD', division_id_of('SRC'))
    returning id, tracking_token
  `, [whOrder.id, orgB]);

  ok(whShip.tracking_token === null, 'Item 20: wholesale shipment (store_order_id IS NULL) keeps tracking_token = NULL');
  ok(
    !!(await tryq(`insert into shipments(order_id, store_order_id, org_id, carrier_code, currency, division_id) values ($1, $2, $3, 'yunexpress', 'USD', division_id_of('DS'))`, [whOrder.id, usdOrder.store_order_id, orgA])).err
      && !!(await tryq(`insert into shipments(order_id, store_order_id, org_id, carrier_code, currency, division_id) values (null, null, $1, 'yunexpress', 'USD', division_id_of('DS'))`, [orgA])).err,
    'Item 20: shipments_parent_xor_check rejects shipments with both or neither of (order_id, store_order_id)',
  );
  ok(
    !!(await tryq(`select record_warehouse_stock_movement($1, 'reserve', 1, 'FK check', 'SZ-01', '00000000-0000-0000-0000-000000000999')`, [varFast.item_id])).err,
    'Item 20: warehouse_stock_movements.store_order_id enforces FK to store_orders(id)',
  );

  // Tickets link + XOR check
  const tkt = await one(`
    insert into tickets(org_id, store_order_id, subject, category, priority)
    values ($1, $2, 'Where is order #1002?', 'shipping', 'normal')
    returning id, store_order_id
  `, [orgA, usdOrder.store_order_id]);
  ok(
    tkt.store_order_id === usdOrder.store_order_id
      && !!(await tryq(`insert into tickets(org_id, order_id, store_order_id, subject) values ($1, $2, $3, 'Both orders')`, [orgA, whOrder.id, usdOrder.store_order_id])).err,
    'Item 20: tickets links to store_order_id and rejects linking both order_id and store_order_id',
  );

  // Public tracking as anon: serves store_order shipment, returns null for bogus/wholesale, ZERO buyer PII or Octopus/carrier leak
  await asAnon();
  const pubTrack = (await one(`select get_public_dropship_tracking($1) t`, [shipRes.tracking_token])).t;
  const pubBogus = (await one(`select get_public_dropship_tracking('000000000000000000000000000000000000') t`)).t;
  await owner();

  const pubJson = JSON.stringify(pubTrack);
  ok(
    pubBogus === null
      && pubTrack.seller_name === 'Northstar Home Co'
      && pubTrack.order_ref === '#1002'
      && pubTrack.status === 'delivered'
      && !/Evergreen|555-0199|secretbuyer|BuyerSecret|yunexpress|octopus|I2 Factory/i.test(pubJson),
    'Item 20 & 23: get_public_dropship_tracking serves white-label store_order tracking to anon with ZERO buyer address/phone/email/name/carrier/supplier',
  );

  // Sanitized report check: ZERO buyer PII
  await as(merchA, 'aal1');
  const repRows = await all(`select * from get_dropship_orders_report($1, null, null)`, [orgA]);
  const repJson = JSON.stringify(repRows);
  ok(
    repRows.length >= 3 && !/Evergreen|555-0199|secretbuyer|BuyerSecret/i.test(repJson),
    'Item 23: get_dropship_orders_report returns order financials with ZERO buyer address, phone, email, or name',
  );
  await owner();

  // ── 7. Item 22: internal_charge_rules seeded INACTIVE (active = false) with NULL rates ──
  const icrRows = await all(`select rule_code, active, rate_bp, flat_fee_cents from internal_charge_rules order by rule_code`);
  ok(
    icrRows.length >= 4 && icrRows.every((r) => r.active === false && r.rate_bp === null && r.flat_fee_cents === null),
    `Item 22: all ${icrRows.length} internal_charge_rules seed rows are inactive (active=false) with NULL rate_bp & flat_fee_cents`,
  );
  ok(
    !!(await tryq(`update internal_charge_rules set active = true where rule_code = 'DS_TO_3PL_PICK_PACK'`)).err,
    'Item 22: internal_charge_rules cannot be activated while rates are still NULL',
  );

  // ── 8. Item 23: RLS on store_orders & store_order_items ──
  await as(merchA, 'aal1');
  const mAOrders = await all(`select id, order_number from store_orders`);
  const mAItems = await all(`select id, model_no from store_order_items`);
  ok(mAOrders.length === 3 && mAItems.length === 3, 'Item 23 RLS: Merchant A reads own store_orders (3) & store_order_items (3)');

  for (const [label, switchFn] of [
    ['anon', asAnon],
    ['Buyer B (other org)', () => as(merchB, 'aal1')],
    ['Supplier', () => as(supUser, 'aal1')],
    ['Restricted distributor', () => as(distUser, 'aal2')],
    ['3PL warehouse-only staff (not DS)', () => as(whStaff, 'aal2')],
  ]) {
    await switchFn();
    const oRes = await tryq(`select id from store_orders`);
    const iRes = await tryq(`select id from store_order_items`);
    ok(
      (oRes.err || oRes.rows.length === 0) && (iRes.err || iRes.rows.length === 0),
      `Item 23 RLS (${label}): 0 rows readable on store_orders and store_order_items`,
    );
  }

  await as(dsStaff, 'aal2');
  ok((await all(`select id from store_orders where org_id = $1`, [orgA])).length === 3,
    'Item 23 RLS: Dropship division staff reads store_orders');
  await owner();

  // Check warehouse_stock movement sum invariant & ledger invariant
  const mismatches = await all(`
    select ws.warehouse_id, ws.item_id
      from warehouse_stock ws
      left join warehouse_stock_movements m on m.warehouse_id = ws.warehouse_id and m.item_id = ws.item_id
     group by ws.warehouse_id, ws.item_id, ws.on_hand_qty, ws.reserved_qty
    having ws.on_hand_qty <> coalesce(sum(m.on_hand_delta), 0)
        or ws.reserved_qty <> coalesce(sum(m.reserved_delta), 0)
  `);
  ok(mismatches.length === 0, 'warehouse_stock movement sum invariant holds across all items');

  const ledgerAfter = await one(`
    select coalesce(sum(debit_cents),0)::text d,
           coalesce(sum(credit_cents),0)::text c,
           coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff,
           (select coalesce(sum(wallet_balance(org_id)),0)::text from wallets) w
      from ledger_entries
  `);
  ok(JSON.stringify(ledgerBefore) === JSON.stringify(ledgerAfter) && ledgerAfter.diff === '0',
    `ledger (${ledgerAfter.d}/${ledgerAfter.c}/diff=${ledgerAfter.diff}) and wallets (${ledgerAfter.w}) unchanged`);

  await db.query('rollback');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
  await db.query('rollback').catch(() => {});
} finally {
  await db.end();
}

console.log(failed ? `\ni2: ${failed} check(s) failed` : '\ni2: all passed');
process.exitCode = failed ? 1 : 0;
