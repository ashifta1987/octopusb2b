// Step 2 DB test suite (Migration 213 — STAGING ONLY, rolled-back transaction):
//  · Correction 1 & 7: visible_to_org_id (no exclusive_org_id) + sourced_from_rfq_id; merchant-scoped catalogue/product/quote isolation.
//  · Correction 2: dropship_price_tiers (no dropship_volume_tiers); quantity tier pricing in get_dropship_product & get_dropship_order_quote.
//  · Correction 4: import_dropship_from_sourcing reuses Sourcing products.item_id when same physical unit (0 extra item_master rows);
//    adding a distinct second variant creates a new item_master row; changing shared item_master weight/box/origin/HS on an active
//    dropship product marks dropship_products.needs_review = true (and HS change resets hs_verified = false).
//  · Correction 5: Support (canSeeCosts = false) gets FORBIDDEN on cost/supplier/Sourcing-model RPCs and 0 rows on dropship_import_jobs,
//    suppliers, product_costs, and products.
//  · Correction 7: Publish gate (get_dropship_publish_checklist, publish_dropship_product, trg_guard_dropship_publish_gate) blocks
//    missing title/description/image, unverified supplier, needs_data, unverified HS, missing shipping rate card, restricted flags,
//    and missing DDP duty entry — while DAP routes pass without a duty entry and return "Duties paid by buyer".
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
           coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff,
           (select coalesce(sum(wallet_balance(org_id)),0)::text from wallets) w
      from ledger_entries
  `);

  // ── 1. Schema naming checks (Corrections 1 & 2) ──
  const schemaChk = await one(`
    select
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='dropship_products' and column_name='exclusive_org_id') has_excl,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='dropship_products' and column_name='visible_to_org_id') has_vis,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='dropship_products' and column_name='sourced_from_rfq_id') has_rfq,
      (select to_regclass('public.dropship_volume_tiers') is not null) has_vol_tiers,
      (select to_regclass('public.dropship_price_tiers') is not null) has_price_tiers,
      (select to_regclass('public.dropship_import_jobs') is not null) has_imp_jobs,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='dropship_routes' and column_name='incoterm') has_incoterm
  `);
  ok(
    schemaChk.has_excl === 0 && schemaChk.has_vis === 1 && schemaChk.has_rfq === 1,
    'Correction 1: visible_to_org_id & sourced_from_rfq_id exist on dropship_products; exclusive_org_id does NOT exist',
  );
  ok(
    schemaChk.has_vol_tiers === false && schemaChk.has_price_tiers === true && schemaChk.has_imp_jobs === true && schemaChk.has_incoterm === 1,
    'Correction 2 & 7: dropship_price_tiers, dropship_import_jobs, and dropship_routes.incoterm exist; dropship_volume_tiers does NOT exist',
  );

  // ── Fixtures ──
  const mkUser = async (tag, role = null, divs = []) => {
    const email = `step2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `T ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    for (const [code, r] of divs) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
    return id;
  };

  const merchA = await mkUser('merchA', 'customer');
  const merchB = await mkUser('merchB', 'customer');
  const supUserVer = await mkUser('supVer', 'supplier');
  const supUserUnver = await mkUser('supUnver', 'supplier');
  const dsStaff = await mkUser('ds', 'operations', [['DS', 'staff']]);
  const whStaff = await mkUser('wh3pl', 'warehouse', [['3PL', 'staff']]);
  const supportStaff = await mkUser('support', 'support');
  const fin1 = await mkUser('fin1', 'finance');
  const fin2 = await mkUser('fin2', 'finance');
  const adminUser = await mkUser('adm', 'admin');

  const orgA = (await one(`insert into organizations(name, country) values ('TEST Step2 Anna Home', 'CA') returning id`)).id;
  const orgB = (await one(`insert into organizations(name, country) values ('TEST Step2 Beta Retail', 'CA') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [orgA, merchA, orgB, merchB]);
  await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on'), ($2, 'dropship', 'on')`, [orgA, orgB]);
  await db.query(`insert into dropship_markets(org_id, country) values ($1, 'AE'), ($1, 'CA'), ($2, 'AE'), ($2, 'CA')`, [orgA, orgB]);

  const supVer = (await one(`insert into suppliers(legal_name, code, country, verified, user_id) values ('Shenzhen Horizon Ceramics Co., Ltd.', 'SUP-STEP2-V', 'CN', true, $1) returning id`, [supUserVer])).id;
  const supUnver = (await one(`insert into suppliers(legal_name, code, country, verified, user_id) values ('Ningbo Unverified Glassware Ltd', 'SUP-STEP2-U', 'CN', false, $1) returning id`, [supUserUnver])).id;
  await db.query(`insert into supplier_switches(supplier_id) values ($1), ($2) on conflict do nothing`, [supVer, supUnver]);

  const srcProdVer = await one(`
    insert into products(external_id, slug, title, description, supplier_id, status, unit, moq, currency, origin_country, net_weight, colour_box_mm)
    values ('SRC-STEP2-001', 'src-step2-001', 'Shenzhen Horizon Ceramics Co., Ltd. Stoneware Desk Organiser', 'Made by SUP-STEP2-V with matte glaze.', $1, 'draft', 'pcs', 10, 'USD', 'CN', '650g', '220*140*110mm')
    returning id, item_id
  `, [supVer]);
  const srcProdUnver = await one(`
    insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency)
    values ('SRC-STEP2-UNVER', 'src-step2-unver', 'Unverified Glass Mug', $1, 'draft', 'pcs', 10, 'USD')
    returning id, item_id
  `, [supUnver]);

  const spVer = (await one(`insert into supplier_products(supplier_id, product_id, status, is_preferred) values ($1, $2, 'quoted', true) returning id`, [supVer, srcProdVer.id])).id;
  const spUnver = (await one(`insert into supplier_products(supplier_id, product_id, status, is_preferred) values ($1, $2, 'quoted', true) returning id`, [supUnver, srcProdUnver.id])).id;
  await db.query(`insert into product_costs(product_id, supplier_cost_cents) values ($1, 720), ($2, 410)`, [srcProdVer.id, srcProdUnver.id]);

  // Accepted merchant Sourcing request for orgA
  const rfqAccepted = await one(`
    insert into rfqs(org_id, product_id, title, quantity, unit, status, created_by)
    values ($1, $2, 'Custom desk organiser for Anna Home', 50, 'pcs', 'accepted', $3)
    returning id, code
  `, [orgA, srcProdVer.id, merchA]);

  // Ensure active fee_versions + AE & CA shipping_rate_cards (AE has duty entry; CA intentionally has NO duty entry!)
  await as(whStaff, 'aal2');
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR', 'CA', 590, 95, 4, 7, 30000, 5000, 100, false, false, false, false, 'YunExpress Canada Direct')`);
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR', 'AE', 480, 95, 3, 5, 30000, 5000, 100, true, false, false, false, 'YunExpress UAE Direct')`);
  const fvProp = (await one(`select propose_fee_version(100, 40, 20, 120, 300, 'Step 2 test schedule') id`)).id;
  await as(fin1, 'aal2');
  await db.query(`select activate_fee_version($1, 'Step 2 approve')`, [fvProp]);
  await as(adminUser, 'aal2');
  const dvId = (await one(`
    select create_duty_rate_version('Step 2 AE only tariff (CA missing)', $1::jsonb) id
  `, [JSON.stringify([{ country: 'AE', hs_prefix: null, duty_bp: 500, tax_bp: 500, de_minimis_cents: 27000, de_minimis_applies_to: 'duty' }])])).id;
  await db.query(`select activate_duty_rate_version($1)`, [dvId]);
  await owner();

  // ── 2. Correction 4, 1, 7: Import from Sourcing reuses item_id, scrubs supplier name, blocks unverified supplier, sets visible_to_org_id & sourced_from_rfq_id ──
  const itemCountBefore = (await one(`select count(*)::int n from item_master`)).n;

  await as(dsStaff, 'aal2');
  const unverErr = (await tryq(`select import_dropship_from_sourcing($1, null)`, [spUnver])).err;
  ok(/SUPPLIER_NOT_VERIFIED/.test(unverErr ?? ''), 'Correction 7: import_dropship_from_sourcing rejects unverified supplier (SUPPLIER_NOT_VERIFIED)');

  const impRes = (await one(`select import_dropship_from_sourcing($1, $2) r`, [spVer, rfqAccepted.id])).r;
  const impDup = (await one(`select import_dropship_from_sourcing($1, $2) r`, [spVer, rfqAccepted.id])).r;
  await owner();

  const itemCountAfterReuse = (await one(`select count(*)::int n from item_master`)).n;
  const importedProd = await one(`select id, model_no, title, description, status, visible_to_org_id, sourced_from_rfq_id from dropship_products where id = $1`, [impRes.product_id]);
  ok(
    impRes.reused_sourcing_item === true
      && impRes.item_id === srcProdVer.item_id
      && itemCountAfterReuse === itemCountBefore
      && impDup.already_existed === true
      && impDup.product_id === impRes.product_id,
    `Correction 4: import_dropship_from_sourcing reused Sourcing item_id (${impRes.item_id}) with 0 extra item_master rows and idempotent retry`,
  );
  ok(
    importedProd.status === 'draft'
      && importedProd.visible_to_org_id === orgA
      && importedProd.sourced_from_rfq_id === rfqAccepted.id
      && !/Horizon|SUP-STEP2-V/i.test(importedProd.title)
      && !/Horizon|SUP-STEP2-V/i.test(importedProd.description ?? ''),
    'Correction 1 & 7: Sourcing RFQ import lands as draft, sets visible_to_org_id & sourced_from_rfq_id, and scrubs supplier name/code',
  );

  // Adding a genuinely different second variant creates a distinct new item_master row (+1)
  await as(dsStaff, 'aal2');
  const var2 = await one(`
    insert into dropship_variants(product_id, options, supplier_product_id, price_adjust_cents, sort)
    values ($1, '{"Colour":"Sage"}'::jsonb, $2, 50, 1)
    returning id, item_id, model_no
  `, [importedProd.id, spVer]);
  await owner();
  const itemCountAfterVar2 = (await one(`select count(*)::int n from item_master`)).n;
  ok(
    var2.item_id !== srcProdVer.item_id && itemCountAfterVar2 === itemCountBefore + 1,
    'Correction 4: genuinely different second variant creates a new item_master row (+1)',
  );
  // Remove var2 for clean single-unit publish gate testing below
  await db.query(`delete from dropship_variants where id = $1`, [var2.id]);

  // ── 3. Correction 7: Exhaustive Publish Gate + DDP vs DAP Duty Rule ──
  await as(dsStaff, 'aal2');
  // Direct UPDATE to status='active' blocked while missing image, HS check, and routes
  const directPubErr = (await tryq(`update dropship_products set status = 'active' where id = $1`, [importedProd.id])).err;
  ok(/PUBLISH_BLOCKED/.test(directPubErr ?? ''), 'Correction 7: direct staff UPDATE status=active is blocked by trg_guard_dropship_publish_gate');

  // Add 1 image + product_price_cents, still missing HS verification & routes -> blocked
  await db.query(`
    update dropship_products
       set images = array['https://example.com/dropship-media/11111111-2222-3333-4444-555555555555.jpg'],
           product_price_cents = 1200
     where id = $1
  `, [importedProd.id]);
  await db.query(`select update_dropship_item_master($1, '6912.00', 'CN', 650, 22, 14, 11, false, false, false, false, true)`, [srcProdVer.item_id]);

  const chkBeforeHs = (await one(`select get_dropship_publish_checklist($1) c`, [importedProd.id])).c;
  ok(
    chkBeforeHs.ready === false
      && chkBeforeHs.blockers.some((b) => /HS code not checked/i.test(b))
      && chkBeforeHs.blockers.some((b) => /active shipping route/i.test(b)),
    'Correction 7: checklist blocks when HS code is unverified and active routes = 0',
  );

  // Verify HS code, add AE DDP route + CA DDP route (CA has NO duty_rate_entries!) -> blocked ONLY by CA DDP duty!
  await db.query(`select verify_item_hs_code($1, '6912.00', 'Checked tariff')`, [srcProdVer.item_id]);
  await db.query(`
    insert into dropship_routes(product_id, destination_country, shipping_method, incoterm, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, is_active)
    values ($1, 'AE', 'express', 'DDP', 2400, 600, 120, 3, 5, true),
           ($1, 'CA', 'express', 'DDP', 2500, 700, 0, 4, 7, true)
  `, [importedProd.id]);

  const ddpBlockErr = (await tryq(`select publish_dropship_product($1)`, [importedProd.id])).err;
  ok(
    /PUBLISH_BLOCKED.*CA route \(express\): duty not set/i.test(ddpBlockErr ?? ''),
    'Correction 7: missing duty_rate_entries row blocks publish for DDP route (CA)',
  );

  // Switch CA route from DDP -> DAP: missing duty entry does NOT block DAP!
  await db.query(`update dropship_routes set incoterm = 'DAP' where product_id = $1 and destination_country = 'CA'`, [importedProd.id]);
  const pubOk = (await one(`select publish_dropship_product($1) r`, [importedProd.id])).r;
  ok(pubOk.ok === true && pubOk.status === 'active', 'Correction 7: DAP route without duty_rate_entries passes publish_dropship_product');
  await owner();

  // ── 4. Correction 1 & 2: visible_to_org_id Isolation + dropship_price_tiers (USD only) + DAP "Duties paid by buyer" ──
  const nonUsdTierErr = (await tryq(`
    insert into dropship_price_tiers(product_id, min_qty, unit_price_cents, currency)
    values ($1, 100, 800, 'CNY')
  `, [importedProd.id])).err;
  ok(
    /dropship_price_tiers_currency_check/.test(nonUsdTierErr ?? ''),
    'Follow-up 2: dropship_price_tiers enforces currency = USD check constraint (rejects CNY)',
  );

  await db.query(`
    insert into dropship_price_tiers(product_id, min_qty, unit_price_cents)
    values ($1, 1, 1200), ($1, 5, 1050), ($1, 20, 900)
  `, [importedProd.id]);

  await as(merchA, 'aal1');
  const catA = await all(`select product_id, model_no from get_dropship_catalogue('CA', null, null, 1) where product_id = $1`, [importedProd.id]);
  const detA = (await one(`select get_dropship_product($1, 'CA') d`, [importedProd.id])).d;
  const qDapQty1 = (await one(`select get_dropship_quote($1, 'CA', 'express', 1, 'DAP') q`, [impRes.variant_id])).q;
  const qDapQty6 = (await one(`select get_dropship_quote($1, 'CA', 'express', 6, 'DAP') q`, [impRes.variant_id])).q;
  const qDapQty20 = (await one(`select get_dropship_quote($1, 'CA', 'express', 20, 'DAP') q`, [impRes.variant_id])).q;

  await as(merchB, 'aal1');
  const catB = await all(`select product_id from get_dropship_catalogue('CA', null, null, 1) where product_id = $1`, [importedProd.id]);
  const detB = (await one(`select get_dropship_product($1, 'CA') d`, [importedProd.id])).d;
  const qMerchB = (await one(`select get_dropship_quote($1, 'CA', 'express', 1, 'DAP') q`, [impRes.variant_id])).q;
  await owner();

  ok(
    catA.length === 1 && detA?.product_id === importedProd.id
      && catB.length === 0 && detB === null && qMerchB.ok === false && qMerchB.code === 'PRODUCT_NOT_AVAILABLE',
    'Correction 1: visible_to_org_id isolates product to Anna Home (orgA); orgB sees 0 rows in catalogue, detail, and quote',
  );
  ok(
    qDapQty1.ok === true
      && qDapQty1.duties_cents === 0
      && qDapQty1.duties_label === 'Duties paid by buyer'
      && detA.price_tiers.length === 3
      && qDapQty1.product_cents === 1200
      && qDapQty6.product_cents === 6300
      && qDapQty20.product_cents === 18000,
    'Correction 2 & 7: DAP quote shows "Duties paid by buyer" (0c) and dropship_price_tiers apply (1->1200c, 6->6300c, 20->18000c)',
  );

  // ── 5. Correction 4: Supplier / Staff changing shared item_master marks published dropship product "Needs review" ──
  await as(supUserVer, 'aal1');
  await db.query(`update item_master set weight_g = 720 where id = $1`, [srcProdVer.item_id]);
  await owner();

  const afterWeightChange = await one(`select status, needs_review, needs_review_reason from dropship_products where id = $1`, [importedProd.id]);
  ok(
    afterWeightChange.status === 'active'
      && afterWeightChange.needs_review === true
      && /weight changed/i.test(afterWeightChange.needs_review_reason ?? ''),
    'Correction 4: updating shared item_master weight_g marks published dropship product needs_review=true',
  );

  await as(supUserVer, 'aal1');
  await db.query(`update item_master set hs_code = '6912.00.90' where id = $1`, [srcProdVer.item_id]);
  await owner();

  const afterHsChange = await one(`
    select p.needs_review, p.needs_review_reason, im.hs_verified
      from dropship_products p
      join item_master im on im.id = $2
     where p.id = $1
  `, [importedProd.id, srcProdVer.item_id]);
  ok(
    afterHsChange.needs_review === true
      && afterHsChange.hs_verified === false
      && /HS code changed/i.test(afterHsChange.needs_review_reason ?? ''),
    'Correction 4: updating shared item_master hs_code marks needs_review=true AND resets hs_verified=false',
  );

  // ── 6. Correction 5: Support (canSeeCosts = false) DB redaction ──
  await as(supportStaff, 'aal2');
  const supLinksErr = (await tryq(`select * from dropship_sourcing_links()`)).err;
  const supListErr = (await tryq(`select * from list_sourcing_supplier_products(10)`)).err;
  const supCandErr = (await tryq(`select * from list_sourcing_candidates_for_dropship(10)`)).err;
  const supRateEstErr = (await tryq(`select dropship_rate_estimate(500, 600, 'AE', 'express')`)).err;
  const supImpJobs = await all(`select id from dropship_import_jobs`);
  const supSuppliers = await all(`select id from suppliers`);
  const supCosts = await all(`select product_id from product_costs`);
  const supChk = (await one(`select get_dropship_publish_checklist($1) c`, [importedProd.id])).c;
  await owner();

  ok(
    /FORBIDDEN/.test(supLinksErr ?? '')
      && /FORBIDDEN/.test(supListErr ?? '')
      && /FORBIDDEN/.test(supCandErr ?? '')
      && /FORBIDDEN/.test(supRateEstErr ?? '')
      && supImpJobs.length === 0
      && supSuppliers.length === 0
      && supCosts.length === 0
      && supChk.ok === true,
    'Correction 5: Support gets FORBIDDEN on all cost/supplier/Sourcing-model RPCs and 0 rows on dropship_import_jobs, suppliers, and product_costs',
  );

  // ── 6b. Step 2a: Sourcing product item_master RPC for Staff, Assigned Distributor & Own Supplier (isolation enforced) ──
  const distUserA = await mkUser('distA', 'distributor');
  await db.query(`insert into distributor_suppliers(distributor_id, supplier_id) values ($1, $2)`, [distUserA, supVer]);

  // Supplier A updates own Sourcing product's item_master via update_dropship_item_master
  await as(supUserVer, 'aal1');
  const supRpcOk = (await one(`
    select update_dropship_item_master($1, '6912.00.90', 'CN', 780, 24, 16, 12, true, false, false, false, true) r
  `, [srcProdVer.item_id])).r;
  const supOtherErr = (await tryq(`
    select update_dropship_item_master($1, '7013.49', 'CN', 400, 10, 10, 10, false, false, false, false, false)
  `, [srcProdUnver.item_id])).err;
  const supDropshipOnlyErr = (await tryq(`
    select update_dropship_item_master($1, '6912.00', 'CN', 500, 10, 10, 10, false, false, false, false, false)
  `, [var2.item_id])).err;

  // Assigned Distributor A updates assigned supplier's item_master, blocked on unassigned supplier & standalone dropship item
  await as(distUserA, 'aal2');
  const distRpcOk = (await one(`
    select update_dropship_item_master($1, '6912.00.90', 'CN', 810, 25, 16, 12, true, false, true, false, true) r
  `, [srcProdVer.item_id])).r;
  const distOtherErr = (await tryq(`
    select update_dropship_item_master($1, '7013.49', 'CN', 400, 10, 10, 10, false, false, false, false, false)
  `, [srcProdUnver.item_id])).err;
  const distDropshipOnlyErr = (await tryq(`
    select update_dropship_item_master($1, '6912.00', 'CN', 500, 10, 10, 10, false, false, false, false, false)
  `, [var2.item_id])).err;

  // Merchant gets FORBIDDEN
  await as(merchA, 'aal1');
  const merchImErr = (await tryq(`
    select update_dropship_item_master($1, '6912.00', 'CN', 500, 10, 10, 10, false, false, false, false, false)
  `, [srcProdVer.item_id])).err;
  await owner();

  const legacyUnchanged = await one(`select net_weight, colour_box_mm from products where id = $1`, [srcProdVer.id]);
  const imAfter2a = await one(`select weight_g, box_l_cm, box_w_cm, box_h_cm, has_battery, has_magnet, is_fragile, needs_data from item_master where id = $1`, [srcProdVer.item_id]);

  ok(
    supRpcOk.weight_g === 780 && supRpcOk.needs_data === false && supRpcOk.billed_weight_g === 1000
      && distRpcOk.weight_g === 810 && imAfter2a.weight_g === 810
      && imAfter2a.has_battery === true && imAfter2a.has_magnet === true && imAfter2a.is_fragile === true
      && legacyUnchanged.net_weight === '650g' && legacyUnchanged.colour_box_mm === '220*140*110mm',
    'Step 2a: own supplier and assigned distributor update Sourcing item_master via update_dropship_item_master while legacy net_weight/colour_box_mm remain untouched',
  );
  ok(
    /FORBIDDEN/.test(supOtherErr ?? '')
      && /FORBIDDEN/.test(supDropshipOnlyErr ?? '')
      && /FORBIDDEN/.test(distOtherErr ?? '')
      && /FORBIDDEN/.test(distDropshipOnlyErr ?? '')
      && /FORBIDDEN/.test(merchImErr ?? ''),
    'Step 2a: supplier and restricted distributor get FORBIDDEN on other suppliers items and standalone dropship items; merchants get FORBIDDEN',
  );

  // ── 7. Ledger & wallet invariant ──
  const ledgerAfter = await one(`
    select coalesce(sum(debit_cents),0)::text d,
           coalesce(sum(credit_cents),0)::text c,
           coalesce(sum(debit_cents)-sum(credit_cents),0)::text diff,
           (select coalesce(sum(wallet_balance(org_id)),0)::text from wallets) w
      from ledger_entries
  `);
  ok(
    JSON.stringify(ledgerBefore) === JSON.stringify(ledgerAfter) && ledgerAfter.diff === '0',
    `ledger (${ledgerAfter.d}/${ledgerAfter.c}/diff=${ledgerAfter.diff}) and wallets (${ledgerAfter.w}) unchanged`,
  );

  await db.query('rollback');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
  await db.query('rollback').catch(() => {});
} finally {
  await db.end();
}

console.log(failed ? `\nstep2: ${failed} check(s) failed` : '\nstep2: all passed');
process.exitCode = failed ? 1 : 0;
