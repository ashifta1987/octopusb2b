// Step 3 DB test suite (Migration 214 — STAGING ONLY, rolled-back transaction):
//  · Correction 1: Real RFQ codes only (RFQ-...), zero "SR-" anywhere in requests or sourced_rfq_code.
//  · Correction 2: store_orders.kind ('store' | 'sample', rejects 'customer'), channel = 'manual', child table store_order_items.
//  · Correction 3: service_prices 'dropship_request' = 0 USD; Finance can edit 'dropship_request' (not 'rfq'); requests charge 0 by default;
//    status comes from status_mappings (source_domain = 'sourcing_rfq', target = 'request').
//  · Correction 4: Sample orders (1–3 qty max; refuses DDP with missing duty with exact message; pure wallet cash debit ONLY — ignores credit limit,
//    no escrow hold; processing fee included; declared_usd_cents = sample product price paid; idempotent; reserves 3PL stock; ledger diff = 0).
//  · Correction 5: Catalogue & product detail return stock labels ONLY ('in_stock'|'low'|'out'|'extended'), never stock numbers, supplier, or cost;
//    0 rows for non-enabled customer, supplier, and staff.
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
           coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff
      from ledger_entries
  `);
  ok(ledgerBefore.diff === '0', `staging ledger balanced before Step 3 tests (diff=${ledgerBefore.diff})`);

  // ── 1. Correction 2: store_orders.kind + store_order_items schema checks ──
  const schemaChk = await one(`
    select
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='store_orders') so_cols,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='store_order_items') soi_cols,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='store_orders' and column_name='kind') has_kind,
      (select count(*)::int from information_schema.tables where table_schema='public' and table_name='store_order_lines') has_dup_lines
  `);
  ok(
    schemaChk.has_kind === 1 && schemaChk.has_dup_lines === 0 && schemaChk.so_cols === 40 && schemaChk.soi_cols === 15,
    `store_orders has kind column (40 cols total) + store_order_items (15 cols), 0 duplicate store_order_lines`,
  );

  const anyOrg = await one(`select id from organizations where wallet_reference = 'W-10015'`);
  const badKind = await tryq(
    `insert into store_orders (org_id, kind, channel, buyer_name, shipping_address, destination_country, buyer_currency, shipping_method, incoterm, billed_weight_g)
     values ($1, 'customer', 'manual', 'Test', '{"line1":"1 St"}'::jsonb, 'AE', 'USD', 'express', 'DDP', 500)`,
    [anyOrg.id],
  );
  ok(Boolean(badKind.err && /store_orders_kind_check/i.test(badKind.err)), `store_orders.kind check rejects 'customer' (${badKind.err})`);

  // ── 2. Correction 3: 'dropship_request' = 0 USD & Finance editability ──
  const reqPrice = await one(`select public.current_service_price('dropship_request', 'USD')::bigint as amt`);
  const rfqPrice = await one(`select public.current_service_price('rfq', 'USD')::bigint as amt`);
  ok(Number(reqPrice.amt) === 0 && Number(rfqPrice.amt) > 0, `dropship_request default price is 0¢ USD while Sourcing rfq remains ${rfqPrice.amt}¢`);

  const finUser = await one(`
    select ur.user_id
      from user_roles ur
     where ur.role_code = 'finance'
       and not exists (select 1 from user_roles ur2 where ur2.user_id = ur.user_id and ur2.role_code = 'admin')
     limit 1
  `);
  await as(finUser.user_id);
  const finEditDsReq = await tryq(
    `insert into service_prices (service_code, amount_minor, currency, effective_from, created_by)
     values ('dropship_request', 0, 'USD', now() - interval '1 second', $1) returning id`,
    [finUser.user_id],
  );
  ok(!finEditDsReq.err && finEditDsReq.n === 1, `Finance staff CAN update 'dropship_request' in service_prices`);

  const finEditRfq = await tryq(
    `insert into service_prices (service_code, amount_minor, currency, effective_from, created_by)
     values ('rfq', 600, 'USD', now(), $1)`,
    [finUser.user_id],
  );
  ok(Boolean(finEditRfq.err), `Finance staff CANNOT update non-dropship 'rfq' service price (${finEditRfq.err})`);
  await owner();

  // ── 3. Fixtures: Merchant A (W-10015, dropship 'on'), Merchant B (second dropship org), Non-DS buyer, Supplier, DS Staff ──
  const merchA = await one(`
    select om.user_id, o.id as org_id
      from organizations o
      join org_members om on om.org_id = o.id
     where o.wallet_reference = 'W-10015'
     limit 1
  `);
  await db.query(
    `insert into dropship_markets (org_id, country, locked_by_staff) values ($1, 'AE', false), ($1, 'DE', false) on conflict do nothing`,
    [merchA.org_id],
  );

  const nonDsCustomer = await one(`
    select om.user_id, o.id as org_id
      from organizations o
      join org_members om on om.org_id = o.id
     where o.id <> $1
       and not exists (select 1 from company_services cs where cs.org_id = o.id and cs.service = 'dropship' and cs.status in ('on','trial'))
     limit 1
  `, [merchA.org_id]);

  // Create isolated Merchant B with dropship 'on' to test visible_to_org_id privacy
  const merchBUser = await one(`select id from auth.users where id not in ($1, $2) limit 1`, [merchA.user_id, nonDsCustomer.user_id]);
  const merchBOrg = await one(`
    insert into organizations (name, country, city, kyc_status, is_seed)
    values ('TEST – Step3 Merchant B', 'AE', 'Dubai', 'verified', true)
    returning id
  `);
  // Use a user without staff roles for Merchant B
  const cleanCustomer = await one(`
    select u.id
      from auth.users u
     where u.id not in ($1, $2)
       and not exists (select 1 from user_roles ur where ur.user_id = u.id)
       and not exists (select 1 from org_members om where om.user_id = u.id)
       and not exists (select 1 from suppliers s where s.user_id = u.id)
     limit 1
  `, [merchA.user_id, nonDsCustomer.user_id]);

  let merchBUid = cleanCustomer?.id;
  if (!merchBUid) {
    const insU = await one(`
      insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
      values (gen_random_uuid(), 'step3.merchb@demo.octopusb2b.com', '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now())
      returning id
    `);
    merchBUid = insU.id;
  }
  await db.query(`insert into profiles (id, full_name, email) values ($1, 'Step3 Merch B', 'step3.merchb@demo.octopusb2b.com') on conflict (id) do nothing`, [merchBUid]);
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [merchBOrg.id, merchBUid]);
  await db.query(`insert into company_services (org_id, service, status) values ($1, 'dropship', 'on')`, [merchBOrg.id]);
  await db.query(`insert into dropship_markets (org_id, country, locked_by_staff) values ($1, 'AE', false)`, [merchBOrg.id]);

  const supIns = await one(`
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
    values (gen_random_uuid(), 'step3.sup@demo.octopusb2b.com', '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now())
    returning id as user_id
  `);
  const anySup = await one(`select id from suppliers where verified and archived_at is null limit 1`);
  await db.query(`update suppliers set user_id = $2 where id = $1`, [anySup.id, supIns.user_id]);
  const supplierUser = supIns;
  const dsStaff = await one(`select user_id from user_roles where role_code = 'operations' limit 1`);
  await db.query(
    `insert into division_members (user_id, division_id, role) values ($1, division_id_of('DS'), 'staff') on conflict (user_id, division_id) do update set role = 'staff'`,
    [dsStaff.user_id],
  );

  // ── 4. Correction 1 & 3: Free Product Request → Real RFQ Code → Quote → Accept → Private 'only_for_you' Product ──
  const walletABeforeReq = await one(`select wallet_balance($1, 'USD')::bigint as bal`, [merchA.org_id]);
  await as(merchA.user_id);
  const createdReq = (await one(
    `select public.create_dropship_product_request(
       'TEST – Silicone Baking Mat Set',
       'https://example.com/baking-mat',
       'Home and kitchen',
       600,
       '50 to 200',
       array['AE','SA'],
       true,
       'Set of 2 food-grade mats',
       array[]::text[],
       'step3_req_idem_1'
     ) as r`,
  )).r;
  await owner();
  const walletAAfterReq = await one(`select wallet_balance($1, 'USD')::bigint as bal`, [merchA.org_id]);

  ok(
    createdReq.ok === true &&
      /^RFQ-/.test(createdReq.rfq_code) &&
      !/SR-/i.test(createdReq.rfq_code) &&
      Number(createdReq.fee_cents) === 0 &&
      walletAAfterReq.bal === walletABeforeReq.bal,
    `create_dropship_product_request is FREE (0¢ charged, wallet unchanged) and returns real RFQ code (${createdReq.rfq_code}, zero SR-)`,
  );

  await as(merchA.user_id);
  const myReqsInitial = await all(`select * from public.list_my_dropship_requests() where rfq_id = $1`, [createdReq.rfq_id]);
  ok(
    myReqsInitial.length === 1 &&
      myReqsInitial[0].rfq_code === createdReq.rfq_code &&
      myReqsInitial[0].merchant_status === 'submitted',
    `list_my_dropship_requests maps submitted status via status_mappings (${myReqsInitial[0]?.merchant_status} / ${myReqsInitial[0]?.merchant_label})`,
  );

  // Staff quotes landed cost (1850¢ to AE)
  await as(dsStaff.user_id);
  const quotedRes = (await one(`select public.set_dropship_request_landed_quote($1, 1850, 'AE') as r`, [createdReq.rfq_id])).r;
  ok(quotedRes.ok === true && quotedRes.status === 'quoted', `DS staff sets landed quote on ${createdReq.rfq_code}`);

  // Merchant A sees 'quoted' + landed cost, then accepts → creates private visible_to_org_id draft with DS-XXXXXX
  await as(merchA.user_id);
  const myReqsQuoted = await one(`select * from public.list_my_dropship_requests() where rfq_id = $1`, [createdReq.rfq_id]);
  ok(
    myReqsQuoted.merchant_status === 'quoted' && Number(myReqsQuoted.quoted_landed_cents) === 1850,
    `Merchant A sees quoted landed cost ($18.50 to AE)`,
  );

  const acceptRes = (await one(`select public.respond_dropship_request_quote($1, 'accept') as r`, [createdReq.rfq_id])).r;
  ok(
    acceptRes.ok === true &&
      acceptRes.action === 'accepted' &&
      /^DS-\d{6}$/.test(acceptRes.dropship_model_no),
    `Accepting quote creates private draft ${acceptRes.dropship_model_no} for Merchant A`,
  );

  // Complete & publish the private product so we can verify 'only_for_you' + 'sourced_rfq_code' + Merchant B isolation
  await owner();
  const privVar = await one(`select id, item_id from dropship_variants where product_id = $1 limit 1`, [acceptRes.dropship_product_id]);
  const validSp = await one(`
    select sp.id
      from supplier_products sp
      join suppliers s on s.id = sp.supplier_id
     where s.verified and s.archived_at is null
     limit 1
  `);
  await db.query(`update dropship_variants set supplier_product_id = $2 where id = $1`, [privVar.id, validSp.id]);
  await db.query(
    `update dropship_products
        set description = 'Private sourced baking mat',
            images = array['https://example.com/mat.jpg'],
            product_price_cents = 950
      where id = $1`,
    [acceptRes.dropship_product_id],
  );
  await db.query(
    `insert into dropship_routes (product_id, destination_country, shipping_method, incoterm, landed_price_cents, est_days_min, est_days_max, is_active)
     values ($1, 'AE', 'standard', 'DDP', 1850, 5, 9, true)`,
    [acceptRes.dropship_product_id],
  );
  await as(dsStaff.user_id);
  await db.query(
    `select update_dropship_item_master($1, '6912.00', 'CN', 400, 20, 15, 5, false, false, false, false, false)`,
    [privVar.item_id],
  );
  await db.query(`select verify_item_hs_code($1, '6912.00', 'Step 3 verified')`, [privVar.item_id]);
  const pubPriv = (await one(`select public.publish_dropship_product($1) as r`, [acceptRes.dropship_product_id])).r;
  ok(pubPriv.ok === true, `Published private request product ${acceptRes.dropship_model_no}`);

  await as(merchA.user_id);
  const catA = await all(`select * from public.get_dropship_catalogue('AE', $1, null, 1)`, [acceptRes.dropship_model_no]);
  ok(
    catA.length === 1 &&
      catA[0].only_for_you === true &&
      catA[0].sourced_rfq_code === createdReq.rfq_code &&
      !/SR-/i.test(JSON.stringify(catA[0])),
    `Merchant A sees private product with only_for_you=true and real sourced_rfq_code=${catA[0]?.sourced_rfq_code} (zero SR-)`,
  );

  await as(merchBUid);
  const catB = await all(`select * from public.get_dropship_catalogue('AE', $1, null, 1)`, [acceptRes.dropship_model_no]);
  const detB = await one(`select public.get_dropship_product($1, 'AE') as d`, [acceptRes.dropship_product_id]);
  ok(catB.length === 0 && detB.d === null, `Merchant B sees 0 rows and null detail for Merchant A's private product`);

  // ── 5. Correction 5 & Isolation: Stock labels ONLY (no numbers), zero supplier/cost keys, 0 rows for non-DS/supplier/staff ──
  await as(merchA.user_id);
  const fullCatA = await all(`select * from public.get_dropship_catalogue('AE', null, null, 1)`);
  const fullDetA = (await one(`select public.get_dropship_product($1, 'AE') as d`, [fullCatA[0].product_id])).d;
  const serializedMerchantPayload = JSON.stringify({ fullCatA, fullDetA });
  ok(
    !/unit_cost|supplier_id|supplier_name|sourcing_product_id|legacy_sku|octopus_sku|"on_hand"|"reserved"|"available_qty"/i.test(
      serializedMerchantPayload,
    ),
    `Catalogue & product detail JSON contain zero supplier/cost/Sourcing-SKU/stock-number keys`,
  );
  ok(
    fullCatA.every((r) => ['in_stock', 'low', 'out', 'extended'].includes(r.stock_status)) &&
      ['in_stock', 'low', 'out', 'extended'].includes(fullDetA.stock_status),
    `Stock is exposed strictly as label enums ('in_stock'|'low'|'out'|'extended')`,
  );

  // ── 5b. Follow-up 1: DB-level DROPSHIP_NOT_ENABLED gate on EVERY Step 3 merchant RPC when called directly ──
  await owner();
  const gateProd = await one(`select id from dropship_products where model_no = 'DS-000001'`);
  const gateVar = await one(`select id from dropship_variants where product_id = $1 order by sort limit 1`, [gateProd.id]);

  const gateCalls = [
    ['get_dropship_countries', `select * from public.get_dropship_countries()`, []],
    ['get_dropship_catalogue', `select * from public.get_dropship_catalogue('AE', null, null, 1)`, []],
    ['get_dropship_product', `select public.get_dropship_product($1, 'AE')`, [gateProd.id]],
    ['get_dropship_quote', `select public.get_dropship_quote($1, 'AE', 'express', 1, 'DDP')`, [gateVar.id]],
    [
      'get_dropship_order_quote',
      `select public.get_dropship_order_quote($1::jsonb, 'AE', 'express', 'DDP')`,
      [JSON.stringify([{ variant_id: gateVar.id, qty: 1 }])],
    ],
    [
      'create_dropship_product_request',
      `select public.create_dropship_product_request('Blocked request', null, null, null, null, array['AE'], false, null, '{}'::text[], 'blocked_req')`,
      [],
    ],
    ['list_my_dropship_requests', `select * from public.list_my_dropship_requests()`, []],
    ['respond_dropship_request_quote', `select public.respond_dropship_request_quote($1, 'accept')`, [createdReq.rfq_id]],
    [
      'create_dropship_sample_order',
      `select public.create_dropship_sample_order($1, 1, 'AE', 'express', 'No DS', '+971500000099', '{"line1":"1 St"}'::jsonb, 'blocked_smp')`,
      [gateVar.id],
    ],
    ['list_my_dropship_sample_orders', `select * from public.list_my_dropship_sample_orders(null)`, []],
  ];

  await as(nonDsCustomer.user_id);
  const nonDsResults = [];
  for (const [fnName, sql, params] of gateCalls) {
    const r = await tryq(sql, params);
    nonDsResults.push([fnName, r.err ?? 'NO_ERROR']);
  }
  ok(
    nonDsResults.every(([, err]) => /DROPSHIP_NOT_ENABLED/.test(err)),
    `Follow-up 1: all ${gateCalls.length} Step 3 merchant RPCs refuse non-enabled customer org directly with DROPSHIP_NOT_ENABLED (${nonDsResults.map(([n]) => n).join(', ')})`,
  );

  await as(supplierUser.user_id);
  const supResults = [];
  for (const [fnName, sql, params] of gateCalls) {
    const r = await tryq(sql, params);
    supResults.push([fnName, r.err ?? 'NO_ERROR']);
  }
  ok(
    supResults.every(([, err]) => /DROPSHIP_NOT_ENABLED/.test(err)),
    `Follow-up 1: all ${gateCalls.length} Step 3 merchant RPCs refuse supplier user directly with DROPSHIP_NOT_ENABLED`,
  );

  // ── 6. Correction 4: Sample Order Rules (1–3 qty, DDP missing duty refused, credit limit ignored, wallet cash debit + 3PL stock reserve) ──
  await owner();
  const prod1 = await one(`select id, model_no from dropship_products where model_no = 'DS-000001'`);
  const var1 = await one(`select id, item_id from dropship_variants where product_id = $1 order by sort limit 1`, [prod1.id]);

  // Add a DE DDP route on DS-000001 where DE has a shipping rate card (or create one in tx) but NO duty_rate_entries for DE!
  await db.query(`
    insert into shipping_rate_cards (
      carrier_code, method, carrier_service_code, service_label, country,
      base_cents, per_100g_cents, step_g, max_weight_g, volumetric_divisor,
      days_min, days_max, allows_battery, active, division_id
    )
    select 'yunexpress', 'standard', 'DE-STD-S3', 'DE Standard', 'DE',
           420, 80, 100, 30000, 5000, 6, 10, true, true, division_id_of('DS')
    where not exists (
      select 1 from shipping_rate_cards where country = 'DE' and method = 'standard' and active
    )
  `);
  await db.query(`
    insert into dropship_routes (product_id, destination_country, shipping_method, incoterm, landed_price_cents, est_days_min, est_days_max, is_active)
    values ($1, 'DE', 'standard', 'DDP', 2200, 6, 10, true)
    on conflict (product_id, destination_country, shipping_method) do update set incoterm = 'DDP', is_active = true
  `, [prod1.id]);

  // 6a. Reject qty = 4
  await as(merchA.user_id);
  const badQtyRes = (await one(
    `select public.create_dropship_sample_order($1, 4, 'AE', 'express', 'Anna K.', '+971500000000', '{"line1":"1 Marina","city":"Dubai"}'::jsonb, 's3_qty4') as r`,
    [var1.id],
  )).r;
  ok(badQtyRes.ok === false && badQtyRes.code === 'INVALID_SAMPLE_QTY', `Sample order rejects qty=4 (${badQtyRes.code})`);

  // 6b. Refuse DDP when duty is unknown (DE has no duty_rate_entries)
  const ddpMissingRes = (await one(
    `select public.create_dropship_sample_order($1, 1, 'DE', 'standard', 'Anna K.', '+971500000000', '{"line1":"Hauptstr 1","city":"Berlin"}'::jsonb, 's3_de_ddp') as r`,
    [var1.id],
  )).r;
  ok(
    ddpMissingRes.ok === false &&
      ddpMissingRes.code === 'DUTIES_NOT_SET' &&
      ddpMissingRes.message === "Duties for this country aren't set yet, choose another country or method",
    `Sample order refuses DDP with unknown duty with exact message: "${ddpMissingRes.message}"`,
  );

  // 6c. Wallet cash check ignores credit limit (Merchant B has $0 cash + $500 wallet_credit_limits + $500 active customer_credit_terms → MUST still be refused!)
  await owner();
  const adminU = await one(`select user_id from user_roles where role_code = 'admin' limit 1`);
  await as(adminU.user_id);
  await db.query(`select public.set_org_credit_eligible($1, true, 'Step 3 sample cash-only test')`, [merchBOrg.id]);
  await owner();
  await db.query(
    `insert into wallet_credit_limits (org_id, limit_minor, currency, note)
     values ($1, 50000, 'USD', 'Step 3 test')
     on conflict (org_id) do update set limit_minor = 50000`,
    [merchBOrg.id],
  );
  await db.query(
    `insert into customer_credit_terms (org_id, division_id, credit_limit_cents, currency, net_days, status, proposed_by, approved_by, approved_at)
     values ($1, null, 50000, 'USD', 30, 'active', $2, $3, now())`,
    [merchBOrg.id, finUser.user_id, adminU.user_id],
  );
  await as(merchBUid);
  const creditRefusedRes = (await one(
    `select public.create_dropship_sample_order($1, 1, 'AE', 'express', 'Merch B', '+971500000001', '{"line1":"2 Creek","city":"Dubai"}'::jsonb, 's3_credit_ignore') as r`,
    [var1.id],
  )).r;
  ok(
    creditRefusedRes.ok === false &&
      creditRefusedRes.code === 'WALLET_INSUFFICIENT' &&
      Number(creditRefusedRes.wallet_balance_cents) === 0,
    `Sample order ignores $500 credit limit when wallet cash is $0 (${creditRefusedRes.code})`,
  );

  // 6d. Top up Merchant B wallet with $50.00 (5000¢) real cash, ensure 3PL stock exists, place 2-unit sample order!
  await owner();
  await db.query(
    `select post_journal('Test topup Merch B', jsonb_build_array(
       jsonb_build_object('account', ledger_account(acct_code('bank:clearing', 'USD'), 'Clearing', 'asset', null, 'USD'), 'debit', 5000, 'credit', 0),
       jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 5000, 'org', $1)
     ), 's3_topup_merchb', 'topup', 'organization', $1)`,
    [merchBOrg.id],
  );
  // Ensure warehouse_stock has enough on_hand_qty for var1.item_id
  await db.query(
    `select record_warehouse_stock_movement($1, 'inbound', 20, 'Step 3 sample inbound', 'SZ-01', null)`,
    [var1.item_id],
  );
  const stockBefore = await one(
    `select coalesce(sum(reserved_qty), 0)::int as res from warehouse_stock where item_id = $1`,
    [var1.item_id],
  );

  await as(merchBUid);
  const paidSample = (await one(
    `select public.create_dropship_sample_order($1, 2, 'AE', 'standard', 'Merch B', '+971500000001', '{"line1":"2 Creek","city":"Dubai"}'::jsonb, 's3_paid_sample_1') as r`,
    [var1.id],
  )).r;
  const paidSampleRetry = (await one(
    `select public.create_dropship_sample_order($1, 2, 'AE', 'standard', 'Merch B', '+971500000001', '{"line1":"2 Creek","city":"Dubai"}'::jsonb, 's3_paid_sample_1') as r`,
    [var1.id],
  )).r;

  await owner();
  const soRow = await one(`select * from store_orders where id = $1`, [paidSample.store_order_id]);
  const soiRow = await one(`select * from store_order_items where store_order_id = $1`, [paidSample.store_order_id]);
  const stockAfter = await one(
    `select coalesce(sum(reserved_qty), 0)::int as res from warehouse_stock where item_id = $1`,
    [var1.item_id],
  );
  const merchBCashAfter = await one(`select wallet_balance($1, 'USD')::bigint as bal`, [merchBOrg.id]);

  ok(
    paidSample.ok === true &&
      soRow.kind === 'sample' &&
      soRow.channel === 'manual' &&
      soRow.payment_state === 'paid' &&
      soRow.wallet_hold_id === null &&
      soRow.escrow_hold_id === null &&
      Number(soRow.processing_cents) === 160 && // 90 first + 40 extra + 30 packaging = 160¢
      Number(soiRow.qty) === 2 &&
      Number(soiRow.declared_usd_cents) === Number(soRow.product_cents) &&
      Number(merchBCashAfter.bal) === 5000 - Number(soRow.total_cents) &&
      stockAfter.res === stockBefore.res + 2 &&
      paidSampleRetry.idempotent === true &&
      paidSampleRetry.store_order_id === paidSample.store_order_id,
    `Paid sample order (${soRow.order_number}): kind='sample', processing=160¢, declared_usd_cents=product_cents (${soiRow.declared_usd_cents}¢), no escrow/hold, wallet cash debited (${soRow.total_cents}¢), 3PL reserved +2, idempotent on retry`,
  );

  // ── 7. Follow-up 2: Sample charge appears on weekly STMT-DS statement under SZ-OCTOPUS for merchant & accountant ──
  await as(finUser.user_id);
  const stmtRes = (
    await one(
      `select public.generate_dropship_weekly_statement($1, now() - interval '1 hour', now() + interval '1 minute') as r`,
      [merchBOrg.id],
    )
  ).r;
  await owner();
  const stmtDoc = await one(
    `select d.id, d.number, d.division_id, d.legal_entity_id, d.amount_cents, d.paid_cents, d.status, d.data,
            le.code as entity_code, le.legal_name as entity_name
       from public.documents d
       join public.legal_entities le on le.id = d.legal_entity_id
      where d.id = $1`,
    [stmtRes.statement_id],
  );
  const stmtLines = await all(
    `select service, description, qty::int as qty, unit_cents::bigint as unit_cents, amount_cents::bigint as amount_cents, ref_type, ref_id
       from public.invoice_lines
      where document_id = $1`,
    [stmtRes.statement_id],
  );
  ok(
    /^STMT-DS-/.test(stmtDoc.number) &&
      stmtDoc.legal_entity_id === '00000000-0000-0000-0000-000000000001' &&
      stmtDoc.entity_code === 'SZ-OCTOPUS' &&
      stmtDoc.data?.legal_entity_code === 'SZ-OCTOPUS' &&
      stmtDoc.data?.service === 'dropship' &&
      Number(stmtDoc.data?.sample_count) === 1 &&
      Number(stmtDoc.amount_cents) === Number(soRow.total_cents) &&
      Number(stmtDoc.paid_cents) === Number(soRow.total_cents) &&
      stmtDoc.status === 'paid' &&
      stmtLines.length === 1 &&
      stmtLines[0].service === 'dropship' &&
      stmtLines[0].ref_type === 'store_order' &&
      stmtLines[0].ref_id === soRow.id &&
      stmtLines[0].description.includes(soRow.order_number) &&
      Number(stmtLines[0].amount_cents) === Number(soRow.total_cents),
    `Follow-up 2: weekly statement ${stmtDoc.number} issued under ${stmtDoc.entity_code} (${stmtDoc.entity_name}) includes paid sample order ${soRow.order_number} (${soRow.total_cents}¢) in documents.data and invoice_lines`,
  );

  // Verify RLS: Merchant B & Finance staff both read STMT-DS + invoice_lines; unrelated customer reads 0 rows
  await as(merchBUid);
  const merchBStmt = await all(`select id, number, legal_entity_id from documents where id = $1`, [stmtDoc.id]);
  const merchBStmtLines = await all(`select id, description from invoice_lines where document_id = $1`, [stmtDoc.id]);
  await as(finUser.user_id);
  const finStmt = await all(`select id, number, legal_entity_id from documents where id = $1`, [stmtDoc.id]);
  const finStmtLines = await all(`select id, description from invoice_lines where document_id = $1`, [stmtDoc.id]);
  await as(nonDsCustomer.user_id);
  const otherStmt = await all(`select id from documents where id = $1`, [stmtDoc.id]);
  const otherStmtLines = await all(`select id from invoice_lines where document_id = $1`, [stmtDoc.id]);
  await owner();
  ok(
    merchBStmt.length === 1 &&
      merchBStmtLines.length === 1 &&
      finStmt.length === 1 &&
      finStmtLines.length === 1 &&
      otherStmt.length === 0 &&
      otherStmtLines.length === 0,
    `Follow-up 2: Merchant B and Finance accountant both read ${stmtDoc.number} + sample invoice_line via RLS; unrelated customer reads 0 rows`,
  );

  // Verify run_weekly_dropship_statements() picks up an org with ONLY a paid sample order in the prior week window!
  await db.query(
    `update store_orders
        set created_at = date_trunc('week', now() at time zone 'UTC') - interval '2 days'
      where id = $1`,
    [soRow.id],
  );
  const batchRes = (await one(`select public.run_weekly_dropship_statements() as r`)).r;
  const prevWeekStmt = await all(
    `select id, number, legal_entity_id, amount_cents, data
       from documents
      where org_id = $1 and doc_type = 'statement' and id <> $2`,
    [merchBOrg.id, stmtDoc.id],
  );
  ok(
    Number(batchRes.statements_generated) >= 1 &&
      prevWeekStmt.length === 1 &&
      prevWeekStmt[0].legal_entity_id === '00000000-0000-0000-0000-000000000001' &&
      Number(prevWeekStmt[0].data?.sample_count) === 1,
    `Follow-up 2: run_weekly_dropship_statements() cron batch generates ${prevWeekStmt[0]?.number} for orgs with paid sample orders`,
  );

  await db.query('set constraints all immediate');
  const ledgerAfter = await one(`
    select coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff
      from ledger_entries
  `);
  ok(ledgerAfter.diff === '0', `double-entry ledger remains strictly balanced & deferred division constraints pass (diff=${ledgerAfter.diff})`);

  await db.query('rollback');
} finally {
  await db.end();
}

if (failed > 0) {
  console.error(`\n✘ ${failed} Step 3 test(s) failed`);
  process.exit(1);
}
console.log('\nstep3 db tests: all passed');
