// Step I1b DB test suite (Migration 211 — STAGING ONLY, rolled-back transaction):
//  · I1a follow-up 1: Supplier A reads/updates ONLY Supplier A's item_master; 0 access to Supplier B's item or any dropship item;
//    restricted distributor isolated to assigned supplier only.
//  · Item 11: shipping_rate_cards (method split from carrier_service_code, max_weight_g, 1 active per carrier+service+country &
//    carrier+method+country, immutable after creation/use, empty/unmatched -> "No rate set", dropship_rates frozen).
//  · Item 12: fee_versions (two-person approval, 1 active row, activate_fee_version() supersedes old active row in same tx,
//    only active -> superseded allowed, insurance_bp = 0).
//  · Item 13: get_dropship_order_quote charges pick_pack_first_cents (+ packaging_cents) ONCE per order across multi-line items;
//    get_dropship_quote single-order preview; returns version_ids; WEIGHT_SIZE_MISSING when item dimensions missing.
//  · Item 14: duty_rate_versions & duty_rate_entries (longest hs_prefix wins, null = country default, de_minimis_cents, unknown = null "not known yet").
//  · Item 15: supplier_products.stock_qty nullable (null = not tracked, NOT 0) + stock_updated_at.
//  · Item 16: warehouse_stock & append-only warehouse_stock_movements (inbound, adjust_in, adjust_out, idempotent reserve,
//    release, pick); sum of movements === on_hand_qty & reserved_qty for every item; legacy dropship stock columns frozen.
//  · Item 17: RLS on all 6 new tables — 0 rows for merchants, anon, suppliers, and restricted distributors.
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
    const email = `i1b-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `T ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    for (const [code, r] of divs) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
    return id;
  };

  const supUserA = await mkUser('supA', 'supplier');
  const supUserB = await mkUser('supB', 'supplier');
  const distUserA = await mkUser('distA', 'distributor');
  const merchantUser = await mkUser('merch');
  const whStaff = await mkUser('wh3pl', 'warehouse', [['3PL', 'staff']]);
  const finUser1 = await mkUser('fin1', 'finance');
  const finUser2 = await mkUser('fin2', 'finance');
  const adminUser = await mkUser('adm', 'admin');

  const orgM = (await one(`insert into organizations(name, country) values ('TEST I1b Merchant', 'US') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [orgM, merchantUser]);
  await db.query(`insert into company_services(org_id, service, status) values ($1, 'dropship', 'on')`, [orgM]);
  await db.query(`insert into dropship_markets(org_id, country) values ($1, 'US'), ($1, 'AE'), ($1, 'JP')`, [orgM]);

  // Create Supplier A & Supplier B + one Sourcing product each + one Dropship product/variant
  const supA = (await one(`insert into suppliers(legal_name, country, verified, user_id) values ('Test Supplier A Ltd', 'CN', true, $1) returning id`, [supUserA])).id;
  const supB = (await one(`insert into suppliers(legal_name, country, verified, user_id) values ('Test Supplier B Ltd', 'CN', true, $1) returning id`, [supUserB])).id;
  await db.query(`insert into supplier_switches(supplier_id) values ($1), ($2) on conflict do nothing`, [supA, supB]);
  await db.query(`insert into distributor_suppliers(distributor_id, supplier_id) values ($1, $2)`, [distUserA, supA]);

  const prodA = await one(`
    insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency, origin_country, net_weight, colour_box_mm)
    values ('QA-I1B-SUPA', 'qa-i1b-supa', 'Supplier A Kettle', $1, 'draft', 'pcs', 10, 'USD', 'CN', '400g', '200*150*100mm')
    returning id, item_id
  `, [supA]);
  const prodB = await one(`
    insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency, origin_country, net_weight, colour_box_mm)
    values ('QA-I1B-SUPB', 'qa-i1b-supb', 'Supplier B Blender', $1, 'draft', 'pcs', 10, 'USD', 'CN', '800g', '250*200*180mm')
    returning id, item_id
  `, [supB]);
  const spA = (await one(`insert into supplier_products(supplier_id, product_id, status, is_preferred) values ($1, $2, 'quoted', true) returning id, stock_qty`, [supA, prodA.id]));
  await db.query(`insert into product_costs(product_id, supplier_cost_cents) values ($1, 600)`, [prodA.id]);

  const dsProd1 = await one(`
    insert into dropship_products(title, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, product_price_cents, origin_country, status)
    values ('TEST I1b Lamp', 400, '{"l":20,"w":15,"h":10}'::jsonb, 1, 'own_warehouse', 'fast_ship', 1200, 'CN', 'active')
    returning id, model_no
  `);
  const dsVar1 = await one(`
    insert into dropship_variants(product_id, options, price_adjust_cents, sort)
    values ($1, '{"Colour":"Black"}'::jsonb, 0, 0)
    returning id, item_id, model_no
  `, [dsProd1.id]);

  const dsProd2 = await one(`
    insert into dropship_products(title, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, product_price_cents, origin_country, status)
    values ('TEST I1b Mug', 300, '{"l":12,"w":10,"h":10}'::jsonb, 1, 'partner_supplier', 'extended_catalog', 800, 'CN', 'active')
    returning id, model_no
  `);
  const dsVar2 = await one(`
    insert into dropship_variants(product_id, options, supplier_product_id, price_adjust_cents, sort)
    values ($1, '{"Size":"350ml"}'::jsonb, $2, 0, 0)
    returning id, item_id, model_no
  `, [dsProd2.id, spA.id]);
  await db.query(`update item_master set hs_code = '851679', hs_code_source = 'manual' where id = $1`, [dsVar1.item_id]);
  await db.query(`update item_master set hs_code = '691200', hs_code_source = 'manual' where id = $1`, [dsVar2.item_id]);
  await db.query(`
    insert into dropship_routes(product_id, destination_country, shipping_method, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, is_active)
    values ($1, 'US', 'express', 2400, 600, 100, 5, 8, true),
           ($2, 'US', 'express', 1900, 500, 80, 5, 8, true)
  `, [dsProd1.id, dsProd2.id]);

  // ── 1. I1a Follow-up 1: Supplier A vs Supplier B vs Dropship item_master isolation ──
  await as(supUserA, 'aal1');
  const supAReads = await all(`select id from item_master`);
  ok(supAReads.length === 1 && supAReads[0].id === prodA.item_id,
    `Supplier A sees ONLY own product item_master (1 row; 0 of Supplier B, 0 dropship items)`);
  ok((await all(`select id from item_master where id = $1`, [prodB.item_id])).length === 0,
    'Supplier A cannot read Supplier B item_master');
  ok((await all(`select id from item_master where id = any($1::uuid[])`, [[dsVar1.item_id, dsVar2.item_id]])).length === 0,
    'Supplier A cannot read any dropship_variants item_master (even when variant links spA)');
  const supAUpdOwn = await tryq(`update item_master set weight_g = 410 where id = $1`, [prodA.item_id]);
  ok(!supAUpdOwn.err && supAUpdOwn.n === 1, 'Supplier A can update own product item_master');
  const supAUpdB = await tryq(`update item_master set weight_g = 999 where id = $1`, [prodB.item_id]);
  ok(supAUpdB.n === 0, 'Supplier A cannot update Supplier B item_master');
  const supAUpdDs = await tryq(`update item_master set weight_g = 999 where id = $1`, [dsVar1.item_id]);
  ok(supAUpdDs.n === 0, 'Supplier A cannot update dropship_variants item_master');
  const supAIns = await tryq(`insert into item_master default values`);
  ok(!!supAIns.err, 'Supplier A cannot insert standalone item_master rows');

  await as(distUserA, 'aal2');
  const distReads = await all(`select id from item_master`);
  ok(distReads.length === 1 && distReads[0].id === prodA.item_id,
    'Restricted distributor assigned only to Supplier A sees ONLY Supplier A item_master (0 of Supplier B, 0 dropship)');
  await owner();

  // ── 2. Item 11: shipping_rate_cards (method vs carrier_service_code, max_weight_g, 1 active, immutable, "No rate set", dropship_rates frozen) ──
  ok(/DROPSHIP_RATES_FROZEN/.test((await tryq(`insert into dropship_rates(country, service, ship_base_cents, ship_per_100g_cents, fee_cents, days_min, days_max, division_id) values ('JP','express',500,80,100,4,7,division_id_of('DS'))`)).err ?? ''),
    'dropship_rates is frozen against new writes (DROPSHIP_RATES_FROZEN)');

  await as(whStaff, 'aal2');
  // Unconfigured country JP -> quote_carrier_rates returns 0 rows ("No rate set")
  ok((await all(`select * from quote_carrier_rates('yunexpress', 'JP', 500, 1)`)).length === 0,
    'quote_carrier_rates returns 0 rows when no rate card exists for country');

  // Publish v1 & v2 on US express ('BKPHR') -> v1 deactivated, v2 active (only 1 active row)
  const rcV1 = (await one(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR', 'US', 500, 80, 5, 8, 2000, 5000, 100, true, false, false, false, 'US Direct Express') id`)).id;
  const rcV2 = (await one(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR', 'US', 550, 90, 5, 8, 2000, 5000, 100, true, false, false, false, 'US Direct Express v2') id`)).id;
  await owner();

  const activeUsExp = await all(`select id, version, active from shipping_rate_cards where carrier_code = 'yunexpress' and country = 'US' and method = 'express' order by version desc`);
  ok(activeUsExp.filter((r) => r.active).length === 1 && activeUsExp[0].id === rcV2 && activeUsExp[0].version >= 2,
    'publish_shipping_rate_card supersedes previous active card and maintains exactly 1 active row per (carrier, method/service, country)');

  ok(/RATE_CARD_IMMUTABLE/.test((await tryq(`update shipping_rate_cards set base_cents = 100 where id = $1`, [rcV2])).err ?? ''),
    'shipping_rate_cards rows cannot be edited in place (RATE_CARD_IMMUTABLE)');
  await db.query(`update shipping_rate_cards set used_count = 1 where id = $1`, [rcV1]);
  ok(/RATE_CARD_IN_USE/.test((await tryq(`delete from shipping_rate_cards where id = $1`, [rcV1])).err ?? ''),
    'used shipping_rate_cards row cannot be deleted (RATE_CARD_IN_USE)');

  // Weight > express max_weight_g (2000 g) excludes express; weight > all max_weight_g (35000 g) returns 0 rows
  const ratesAt2500 = await all(`select * from quote_carrier_rates('yunexpress', 'US', 2500, 1)`);
  const ratesAt35000 = await all(`select * from quote_carrier_rates('yunexpress', 'US', 35000, 1)`);
  ok(!ratesAt2500.some((r) => r.method === 'express') && ratesAt35000.length === 0,
    'quote_carrier_rates excludes rate cards when parcel exceeds max_weight_g (and returns 0 rows above all limits)');

  // ── 3. Item 12: fee_versions (two-person approval, 1 active row, active -> superseded only, insurance_bp = 0) ──
  await as(whStaff, 'aal2');
  const fv1 = (await one(`select propose_fee_version(200, 50, 30, 120, 300, 'Standard 3PL schedule v1') id`)).id;
  await as(finUser1, 'aal2');
  const fvSelf = (await one(`select propose_fee_version(210, 55, 30, 120, 300, 'Self-approve attempt') id`)).id;
  ok(/TWO_PERSON_REQUIRED/.test((await tryq(`select activate_fee_version($1)`, [fvSelf])).err ?? ''),
    'proposer cannot activate their own fee_version (TWO_PERSON_REQUIRED)');

  const act1 = (await one(`select activate_fee_version($1, 'Approved v1') r`, [fv1])).r;
  await as(finUser2, 'aal2');
  const act2 = (await one(`select activate_fee_version($1, 'Approved v2 superseding v1') r`, [fvSelf])).r;
  await owner();

  const fvStates = await one(`
    select (select status from fee_versions where id = $1) s1,
           (select status from fee_versions where id = $2) s2,
           (select insurance_bp from fee_versions where id = $2) ins_bp,
           (select count(*)::int from fee_versions where status = 'active') active_cnt
  `, [fv1, fvSelf]);
  ok(act1.activated_id === fv1 && act2.superseded_id === fv1 && fvStates.s1 === 'superseded' && fvStates.s2 === 'active' && fvStates.ins_bp === 0 && fvStates.active_cnt === 1,
    'activate_fee_version() supersedes old active row in same tx; exactly 1 active row; insurance_bp = 0');

  ok(/FEE_VERSION_IMMUTABLE/.test((await tryq(`update fee_versions set pick_pack_first_cents = 999 where id = $1`, [fvSelf])).err ?? ''),
    'active fee_version amounts cannot be edited');
  await db.query(`select set_config('octopus.allow_fee_version_transition', 'true', true)`);
  ok(/FEE_VERSION_ACTIVE_LOCKED/.test((await tryq(`update fee_versions set status = 'rejected' where id = $1`, [fvSelf])).err ?? ''),
    'block-trigger allows ONLY active -> superseded transition on active fee_versions');
  await db.query(`select set_config('octopus.allow_fee_version_transition', '', true)`);

  // ── 4. Item 13 & 14: Order-level quote (processing ONCE per order) & Duty hs_prefix + de_minimis + unknown=null ──
  await as(merchantUser, 'aal1');
  // Before any duty_rate_version is active: duties_cents MUST be NULL ("not known yet"), NEVER 0!
  const qUnknownDuty = (await one(`select get_dropship_quote($1, 'US', 'express', 1, 'DDP') q`, [dsVar1.id])).q;
  ok(qUnknownDuty.ok === true && qUnknownDuty.duties_cents === null && qUnknownDuty.duties_status === 'not_known_yet' && qUnknownDuty.duties_label === 'not known yet' && qUnknownDuty.total_cents === null,
    'when no duty entry exists, DDP quote returns duties_cents=null ("not known yet"), never 0');

  // Missing rate country (JP) -> NO_RATE_SET ("No rate set")
  const qNoRate = (await one(`select get_dropship_quote($1, 'JP', 'express', 1, 'DDP') q`, [dsVar1.id])).q;
  ok(qNoRate.ok === false && qNoRate.code === 'NO_RATE_SET' && qNoRate.message === 'No rate set',
    'missing shipping rate card returns code=NO_RATE_SET ("No rate set"), never 0');
  await owner();

  // Create & activate a duty_rate_version with US country default (3%), 4-digit prefix '8516' (5%), 6-digit prefix '851679' (10%, de_minimis 2000 cents, tax 2%)
  await as(adminUser, 'aal2');
  const dvId = (await one(`
    select create_duty_rate_version('US tariff test', $1::jsonb) id
  `, [JSON.stringify([
    { country: 'US', hs_prefix: null, duty_bp: 300, tax_bp: 200, de_minimis_cents: 2000 },
    { country: 'US', hs_prefix: '8516', duty_bp: 500, tax_bp: 200, de_minimis_cents: 2000 },
    { country: 'US', hs_prefix: '8516.79', duty_bp: 1000, tax_bp: 200, de_minimis_cents: 2000 },
  ])])).id;
  await db.query(`select activate_duty_rate_version($1)`, [dvId]);
  await owner();

  // Verify longest prefix match ('851679' -> 1000 bp) vs country default ('691200' -> 300 bp)
  const dlSpecific = (await one(`select lookup_duty_rate('US', '8516.79.00') d`)).d;
  const dlDefault = (await one(`select lookup_duty_rate('US', '6912.00') d`)).d;
  ok(dlSpecific.duty_bp === 1000 && dlDefault.duty_bp === 300,
    'lookup_duty_rate picks most specific hs_prefix (851679 -> 1000 bp) and falls back to country default (null -> 300 bp)');

  // Single unit of dsVar1 (product_price_cents = 1200 <= de_minimis 2000): duty = 0, tax = 2% of 1200 = 24 cents
  await as(merchantUser, 'aal1');
  const qBelowDeMin = (await one(`select get_dropship_quote($1, 'US', 'express', 1, 'DDP') q`, [dsVar1.id])).q;
  ok(qBelowDeMin.ok === true && qBelowDeMin.duties_cents === 24 && qBelowDeMin.version_ids.shipping_rate_card_id === rcV2 && qBelowDeMin.version_ids.fee_version_id === fvSelf && qBelowDeMin.version_ids.duty_rate_version_id === dvId,
    'below de_minimis_cents (1200 <= 2000) charges 0 customs duty (tax only = 24c) and returns all 3 version_ids');

  // Multi-line order quote (Item 13):
  //   Line 1: dsVar1 qty = 2 -> product = 2 * 1200 = 2400 (> de_minimis 2000 -> 12% duty+tax = 288c); unit weight max(400, 600)=600g -> 1200g
  //   Line 2: dsVar2 qty = 3 -> product = 3 * 800 = 2400 (> de_minimis 2000 -> 5% default duty+tax = 120c); unit weight max(300, 240)=300g -> 900g
  //   Total qty = 5; active fee_version (fvSelf): first=210, extra=55, packaging=30
  //   Processing MUST charge first (210) + packaging (30) ONCE: 210 + (5 - 1)*55 + 30 = 460 cents!
  //    Wait: max_weight_g on rcV2 was 2000g, and 1200+900 = 2100g! Let's check qty=2 + qty=2 = 1800g <= 2000g!
  const orderQuote = (await one(`
    select get_dropship_order_quote($1::jsonb, 'US', 'express', 'DDP') q
  `, [JSON.stringify([
    { variant_id: dsVar1.id, qty: 2 },
    { variant_id: dsVar2.id, qty: 2 },
  ])])).q;
  // Total qty = 4 -> processing = 210 + (4 - 1)*55 + 30 = 405 cents (if charged twice per line it would have been (210+55+30)*2 = 590!)
  ok(orderQuote.ok === true && orderQuote.total_qty === 4 && orderQuote.processing_cents === 405,
    `get_dropship_order_quote charges first-item + packaging fee ONCE per order across 2 lines (got ${orderQuote.processing_cents}c, not 590c)`);
  await owner();

  // Missing box size on item_master -> WEIGHT_SIZE_MISSING (never charges on 0 g)
  await db.query(`update item_master set box_h_cm = null where id = $1`, [dsVar1.item_id]);
  const qMissingBox = (await one(`select get_dropship_quote($1, 'US', 'express', 1, 'DDP') q`, [dsVar1.id])).q;
  ok(qMissingBox.ok === false && qMissingBox.code === 'WEIGHT_SIZE_MISSING' && qMissingBox.needs_data === true,
    'quote refuses with WEIGHT_SIZE_MISSING (needs_data=true) when box size or weight is missing');
  await db.query(`update item_master set box_h_cm = 10 where id = $1`, [dsVar1.item_id]);

  // ── 5. Item 15: supplier_products.stock_qty nullable (null = not tracked, NOT 0) + stock_updated_at ──
  ok(spA.stock_qty === null, 'new supplier_products.stock_qty defaults to NULL (not tracked, NOT 0)');
  const untrackedStock = (await one(`select get_dropship_variant_stock($1) s`, [dsVar2.id])).s;
  ok(untrackedStock.stock_tracked === false && untrackedStock.stock_qty === null && untrackedStock.stock_status === 'in_stock',
    'extended_catalog variant with NULL supplier stock reports stock_tracked=false, stock_qty=null');

  await as(supUserA, 'aal1');
  await db.query(`select set_supplier_product_stock($1, 6)`, [spA.id]);
  await owner();
  const trackedLowStock = (await one(`select get_dropship_variant_stock($1) s`, [dsVar2.id])).s;
  ok(trackedLowStock.stock_tracked === true && trackedLowStock.stock_qty === 6 && trackedLowStock.stock_status === 'low' && !!trackedLowStock.stock_updated_at,
    'set_supplier_product_stock updates stock_qty=6, stock_updated_at, and reports low stock');

  // ── 6. Item 16: warehouse_stock & append-only movements + sum(movements) === on_hand_qty invariant + legacy freeze ──
  ok(/DIRECT_STOCK_WRITE_BLOCKED/.test((await tryq(`insert into warehouse_stock(warehouse_id, item_id, on_hand_qty) values ('SZ-01', $1, 50)`, [dsVar1.item_id])).err ?? ''),
    'direct INSERT/UPDATE on warehouse_stock is blocked (DIRECT_STOCK_WRITE_BLOCKED)');
  ok(/LEGACY_STOCK_FROZEN/.test((await tryq(`update dropship_products set stock_qty = 99 where id = $1`, [dsProd1.id])).err ?? ''),
    'legacy dropship_products.stock_qty is frozen (LEGACY_STOCK_FROZEN)');
  ok(/LEGACY_STOCK_FROZEN/.test((await tryq(`update dropship_variants set stock_status = 'out' where id = $1`, [dsVar1.id])).err ?? ''),
    'legacy dropship_variants.stock_status is frozen (LEGACY_STOCK_FROZEN)');

  const ord1 = '00000000-0000-0000-0000-000000000101';
  const ord2 = '00000000-0000-0000-0000-000000000102';
  await as(whStaff, 'aal2');
  await db.query(`select record_warehouse_stock_movement($1, 'inbound', 100, 'PO-001 inbound', 'SZ-01', null)`, [dsVar1.item_id]);
  await db.query(`select record_warehouse_stock_movement($1, 'adjust_in', 15, 'Cycle count gain', 'SZ-01', null)`, [dsVar1.item_id]);
  await db.query(`select record_warehouse_stock_movement($1, 'adjust_out', 5, 'Damaged sample', 'SZ-01', null)`, [dsVar1.item_id]);
  // Available is now 110. Reserve 20 for ord1 TWICE (idempotent!) and 10 for ord2
  const r1a = (await one(`select record_warehouse_stock_movement($1, 'reserve', 20, 'Order 1 paid', 'SZ-01', $2) r`, [dsVar1.item_id, ord1])).r;
  const r1b = (await one(`select record_warehouse_stock_movement($1, 'reserve', 20, 'Order 1 webhook retry', 'SZ-01', $2) r`, [dsVar1.item_id, ord1])).r;
  ok(r1a.idempotent === false && r1b.idempotent === true && r1b.reserved_qty === 20 && r1b.available_qty === 90,
    'reserve is idempotent per (warehouse_id, item_id, store_order_id) — retry does not double-reserve');

  await db.query(`select record_warehouse_stock_movement($1, 'reserve', 10, 'Order 2 paid', 'SZ-01', $2)`, [dsVar1.item_id, ord2]);
  // Over-reserve beyond available (80) -> INSUFFICIENT_AVAILABLE_STOCK
  ok(/INSUFFICIENT_AVAILABLE_STOCK/.test((await tryq(`select record_warehouse_stock_movement($1, 'reserve', 85, 'Too big', 'SZ-01', '00000000-0000-0000-0000-000000000103')`, [dsVar1.item_id])).err ?? ''),
    'reserve exceeding available stock is rejected (INSUFFICIENT_AVAILABLE_STOCK)');

  // Pick ord1 (20): on_hand 110 -> 90, reserved 30 -> 10 in one transaction; Cancel/release ord2 (10): on_hand 90, reserved 0
  const pickRes = (await one(`select record_warehouse_stock_movement($1, 'pick', 20, 'Order 1 shipped', 'SZ-01', $2) r`, [dsVar1.item_id, ord1])).r;
  const relRes = (await one(`select record_warehouse_stock_movement($1, 'release', 10, 'Order 2 cancelled', 'SZ-01', $2) r`, [dsVar1.item_id, ord2])).r;
  await owner();

  ok(pickRes.on_hand_qty === 90 && pickRes.reserved_qty === 10 && relRes.on_hand_qty === 90 && relRes.reserved_qty === 0,
    'pick decrements on_hand & reserved atomically (90/10), and cancel/release frees reserved stock (90/0)');

  ok(/STOCK_MOVEMENT_APPEND_ONLY/.test((await tryq(`delete from warehouse_stock_movements where item_id = $1`, [dsVar1.item_id])).err ?? ''),
    'warehouse_stock_movements is strictly append-only (DELETE/UPDATE blocked)');

  // Check invariant across EVERY row in warehouse_stock: sum(movements) === on_hand_qty & reserved_qty
  const mismatches = await all(`
    select ws.warehouse_id, ws.item_id, ws.on_hand_qty, ws.reserved_qty,
           coalesce(sum(m.on_hand_delta), 0)::int as sum_oh,
           coalesce(sum(m.reserved_delta), 0)::int as sum_res
      from warehouse_stock ws
      left join warehouse_stock_movements m on m.warehouse_id = ws.warehouse_id and m.item_id = ws.item_id
     group by ws.warehouse_id, ws.item_id, ws.on_hand_qty, ws.reserved_qty
    having ws.on_hand_qty <> coalesce(sum(m.on_hand_delta), 0)
        or ws.reserved_qty <> coalesce(sum(m.reserved_delta), 0)
  `);
  ok(mismatches.length === 0, 'sum of warehouse_stock_movements equals on_hand_qty and reserved_qty for EVERY item');

  // ── 7. Item 17: RLS check across all 6 new tables (0 rows for anon, merchant, supplier, restricted distributor) ──
  const NEW_TABLES = [
    'shipping_rate_cards',
    'fee_versions',
    'duty_rate_versions',
    'duty_rate_entries',
    'warehouse_stock',
    'warehouse_stock_movements',
  ];
  for (const [label, switchRole] of [
    ['anon', asAnon],
    ['merchant', () => as(merchantUser, 'aal1')],
    ['supplier', () => as(supUserA, 'aal1')],
    ['restricted distributor', () => as(distUserA, 'aal2')],
  ]) {
    await switchRole();
    const leaked = [];
    for (const t of NEW_TABLES) {
      const r = await tryq(`select count(*)::int n from ${t}`);
      if (!r.err && r.rows[0].n > 0) leaked.push(`${t}(${r.rows[0].n})`);
    }
    ok(leaked.length === 0, `RLS (${label}): 0 rows readable across all 6 I1b tables`);
  }
  await owner();

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

console.log(failed ? `\ni1b: ${failed} check(s) failed` : '\ni1b: all passed');
process.exitCode = failed ? 1 : 0;
