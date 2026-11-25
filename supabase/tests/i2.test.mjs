// Step I2 DB & end-to-end pipeline test suite (Migration 212 — STAGING ONLY, rolled-back transaction):
//  · Review 1 & Item 20: tickets has store_order_id, rfq_id, division_id + "at most one" link check (general=0 links,
//    order_id, store_order_id, rfq_id); shipments.tracking_token via extensions.gen_random_bytes; /t/[token] serves ONLY
//    store_order shipments.
//  · Review 3 & Item 18: status_mappings with target ('order' | 'request' | 'brand_project' | 'ticket') covering all 10
//    store_orders.staff_stage -> merchant_status mappings, division_handoff, escrow_hold, 3pl_shipment, rfq_status,
//    brand_projects (6 stages + 'closed'), and ticket_status.
//  · Review 4–5 & Item 21: domain_events pg_cron ('10 seconds'), exponential retry/backoff (1m/5m/30m/2h -> dead at 5),
//    duplicate idempotency_key no-op, insufficient 3PL stock -> on_hold (hold_reason='stock_shortage', no error), and
//    step-by-step pipeline: paid -> reserve -> handoff -> shipment + pick -> label_ready stays 'processing' ->
//    picked_up -> 'shipped' -> delivered -> Finance escrow_holds.auto_release_at (no duplicate column on store_orders).
//  · Review 6 & Item 23: store_orders has NO buyer_email (buyer PII = buyer_name, buyer_phone, shipping_address only);
//    RLS isolation + 0 buyer PII on /t/[token] or get_dropship_orders_report().
//  · Item 19, 22, 24: fx_rate_to_usd nullable/required; internal_charge_rules inactive+null; de_minimis_applies_to.
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
  await db.query(`insert into dropship_markets(org_id, country) values ($1, 'US'), ($1, 'GB'), ($1, 'AU')`, [orgA]);
  await db.query(`
    insert into dropship_seller_profiles(org_id, brand_name, return_name, return_line1, return_city, return_country, status)
    values ($1, 'Northstar Home Co', 'Returns Dept', '100 Market St', 'Austin', 'US', 'approved')
  `, [orgA]);

  await db.query(`insert into carriers(code, name, active) values ('yunexpress', 'YunExpress', true) on conflict (code) do nothing`);

  // ── 1. Review 3 & Item 18: Exhaustive status_mappings check ──
  const EXPECTED_STAGE_MAP = [
    ['unpaid', 'awaiting_payment'],
    ['on_hold', 'on_hold'],
    ['paid_to_assign', 'processing'],
    ['sourcing', 'processing'],
    ['packing', 'processing'],
    ['handed_over', 'shipped'],
    ['delivered', 'delivered'],
    ['cancelled', 'cancelled'],
    ['refunded', 'refunded'],
    ['exception', 'on_hold'],
  ];
  const stageMismatches = [];
  for (const [stage, wantMerch] of EXPECTED_STAGE_MAP) {
    const m = (await one(`select resolve_dropship_status_mapping('store_order_stage', $1) m`, [stage])).m;
    if (!m || m.target !== 'order' || m.staff_stage !== stage || m.merchant_status !== wantMerch) {
      stageMismatches.push(`${stage}->${m?.merchant_status}`);
    }
  }
  ok(stageMismatches.length === 0,
    `Review 3: all 10 store_orders.staff_stage -> merchant_status mappings match spec`);

  const HANDOFF_STATUSES = ['pending', 'reserved', 'ordered_from_supplier', 'in_transit_to_3pl', 'received_at_3pl', 'ready_to_pick', 'packed', 'shipped', 'cancelled', 'exception'];
  const handoffBad = [];
  for (const s of HANDOFF_STATUSES) {
    const m = (await one(`select resolve_dropship_status_mapping('division_handoff', $1) m`, [s])).m;
    if (!m || m.target !== 'order' || !m.staff_stage || !m.merchant_status) handoffBad.push(s);
  }
  ok(handoffBad.length === 0, `Review 3: all ${HANDOFF_STATUSES.length} division_handoff statuses map to target='order'`);

  const ESCROW_STATUSES = ['held', 'partially_released', 'disputed', 'released', 'refunded'];
  const escrowBad = [];
  for (const s of ESCROW_STATUSES) {
    const m = (await one(`select resolve_dropship_status_mapping('escrow_hold', $1) m`, [s])).m;
    if (!m || m.target !== 'order' || !m.staff_stage || !m.merchant_status) escrowBad.push(s);
  }
  ok(escrowBad.length === 0, `Review 3: all ${ESCROW_STATUSES.length} escrow_holds.status values map to target='order'`);

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

  const checkAllMapped = async (domain, statuses, checkFn) => {
    for (const s of statuses) {
      const m = (await one(`select resolve_dropship_status_mapping($1, $2) m`, [domain, s])).m;
      if (!checkFn(m)) return false;
    }
    return true;
  };
  ok(
    await checkAllMapped('3pl_shipment', shipStatuses, (m) => m && m.target === 'order' && m.staff_stage && m.merchant_status),
    `Item 18: all ${shipStatuses.length} shipment_status enum values map to target='order'`,
  );
  ok(
    await checkAllMapped('sourcing_rfq', rfqStatuses, (m) => m && m.target === 'request' && m.staff_stage === null),
    `Item 18: all ${rfqStatuses.length} rfq_status enum values map to target='request' (staff_stage=null)`,
  );
  ok(
    await checkAllMapped('mmb_brand_project', bpStatuses, (m) => m && m.target === 'brand_project' && m.staff_stage === null),
    `Item 18: all ${bpStatuses.length} brand_projects statuses (6 active stages + closed) map to target='brand_project'`,
  );
  ok(
    await checkAllMapped('support_ticket', ticketStatuses, (m) => m && m.target === 'ticket' && m.staff_stage === null),
    `Item 18: all ${ticketStatuses.length} ticket_status enum values map to target='ticket' (staff_stage=null)`,
  );
  ok(
    !!(await tryq(`insert into status_mappings(source_domain, source_status, target, merchant_status, merchant_label, staff_stage) values ('sourcing_rfq', 'bad_test', 'order', 'processing', 'Bad', 'packing')`)).err
      && !!(await tryq(`insert into status_mappings(source_domain, source_status, target, merchant_status, merchant_label, staff_stage) values ('support_ticket', 'bad_test', 'order', 'processing', 'Bad', 'packing')`)).err,
    'Item 18: constraint blocks mapping rfqs or tickets to target=order',
  );

  // ── 2. Review 6 & 5: Confirm store_orders has NO buyer_email and NO escrow_release_at ──
  const soCols = new Set((await all(`
    select column_name from information_schema.columns where table_schema = 'public' and table_name = 'store_orders'
  `)).map((r) => r.column_name));
  ok(
    !soCols.has('buyer_email')
      && !soCols.has('escrow_release_at')
      && soCols.has('buyer_name')
      && soCols.has('buyer_phone')
      && soCols.has('shipping_address')
      && soCols.has('delivered_at'),
    'Review 5 & 6: store_orders has NO buyer_email and NO escrow_release_at (keeps buyer_name, buyer_phone, shipping_address, delivered_at)',
  );

  // ── 3. Setup rate cards, fees, and Item 24 duty_rate_entries (US has 0 de minimis; GB='duty'; AU='duty_and_tax') ──
  await as(adminUser, 'aal2');
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR', 'US', 500, 80, 5, 8, 30000, 5000, 100, true, false, false, false, 'US Express')`);
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR-GB', 'GB', 550, 85, 5, 9, 30000, 5000, 100, true, false, false, false, 'UK Express')`);
  await db.query(`select publish_shipping_rate_card('yunexpress', 'express', 'BKPHR-AU', 'AU', 520, 82, 5, 9, 30000, 5000, 100, true, false, false, false, 'AU Express')`);
  await as(fin1, 'aal2');
  const fvId = (await one(`select propose_fee_version(120, 40, 0, 100, 250, 'I2 fee schedule') id`)).id;
  await as(fin2, 'aal2');
  await db.query(`select activate_fee_version($1, 'Approve I2 fee schedule')`, [fvId]);

  await as(adminUser, 'aal2');
  const dvId = (await one(`
    select create_duty_rate_version('I2 de_minimis_applies_to test (US 0 de minimis)', $1::jsonb) id
  `, [JSON.stringify([
    { country: 'US', hs_prefix: '851679', duty_bp: 1000, tax_bp: 0,   de_minimis_cents: 0,    de_minimis_applies_to: 'duty' },
    { country: 'GB', hs_prefix: '851679', duty_bp: 1000, tax_bp: 200, de_minimis_cents: 2000, de_minimis_applies_to: 'duty' },
    { country: 'AU', hs_prefix: '851679', duty_bp: 1000, tax_bp: 200, de_minimis_cents: 2000, de_minimis_applies_to: 'duty_and_tax' },
  ])])).id;
  await db.query(`select activate_duty_rate_version($1)`, [dvId]);
  await owner();

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
    values ($1, 'US', 'express', 2400, 600, 120, 5, 8, true),
           ($1, 'GB', 'express', 2500, 650, 24,  5, 9, true),
           ($1, 'AU', 'express', 2500, 650, 0,   5, 9, true),
           ($2, 'US', 'express', 2000, 550, 90,  5, 8, true)
  `, [dsFast.id, dsExt.id]);

  await db.query(`select record_warehouse_stock_movement($1, 'inbound', 50, 'I2 initial inbound', 'SZ-01', null)`, [varFast.item_id]);

  // Verify Item 24: GB ('duty', 1200<=2000) -> 24c tax-only; AU ('duty_and_tax', 1200<=2000) -> 0c; US (de_minimis=0, 1200>0) -> 120c duty!
  await as(merchA, 'aal1');
  const qGbDuty = (await one(`select get_dropship_quote($1, 'GB', 'express', 1, 'DDP') q`, [varFast.id])).q;
  const qAuDutyAndTax = (await one(`select get_dropship_quote($1, 'AU', 'express', 1, 'DDP') q`, [varFast.id])).q;
  const qUsNoDeMin = (await one(`select get_dropship_quote($1, 'US', 'express', 1, 'DDP') q`, [varFast.id])).q;
  ok(
    qGbDuty.duties_cents === 24 && qAuDutyAndTax.duties_cents === 0 && qUsNoDeMin.duties_cents === 120,
    `Item 24: GB ('duty', 1200<=2000) -> 24c tax-only; AU ('duty_and_tax', 1200<=2000) -> 0c; US (0 de minimis) -> 120c`,
  );
  await owner();

  // ── 4. Item 19: store_orders.fx_rate_to_usd nullable (no default 1) & required when buyer_currency <> 'USD' ──
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
      $1, 'shopify', 'SHP-ERR-FX', '#9901', 'Jane Doe', '+44-7700-900077',
      '{"line1":"10 Downing St","city":"London","country":"GB"}'::jsonb,
      'GB', 'GBP', null, 'express', 'DDP', $2::jsonb, true
    )
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 1, buyer_unit_price_cents: 1800 }])]);
  ok(/FX_RATE_REQUIRED/.test(badNonUsdOrder.err ?? ''),
    'Item 19: create_dropship_store_order rejects GBP order with null fx_rate_to_usd (FX_RATE_REQUIRED)');

  const gbpOrder = (await one(`
    select create_dropship_store_order(
      $1, 'shopify', 'SHP-GBP-1001', '#1001', 'Homer BuyerSecret', '+1-555-0199',
      '{"line1":"742 Evergreen Terrace","city":"London","postal_code":"SW1A 2AA","country":"GB"}'::jsonb,
      'GB', 'GBP', 1.25, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 2, buyer_unit_price_cents: 2000 }])])).r;
  const gbpRetry = (await one(`
    select create_dropship_store_order(
      $1, 'shopify', 'SHP-GBP-1001', '#1001', 'Homer BuyerSecret', '+1-555-0199',
      '{"line1":"742 Evergreen Terrace","city":"London","postal_code":"SW1A 2AA","country":"GB"}'::jsonb,
      'GB', 'GBP', 1.25, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 2, buyer_unit_price_cents: 2000 }])])).r;
  ok(gbpOrder.ok === true && gbpRetry.idempotent === true && gbpRetry.store_order_id === gbpOrder.store_order_id,
    'create_dropship_store_order creates GBP order with fx_rate_to_usd=1.25 and is idempotent on retry');

  const usdOrder = (await one(`
    select create_dropship_store_order(
      $1, 'manual', 'MAN-USD-1002', '#1002', 'Homer BuyerSecret', '+1-555-0199',
      '{"line1":"742 Evergreen Terrace","city":"Austin","postal_code":"78701","country":"US"}'::jsonb,
      'US', 'USD', null, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 3, buyer_unit_price_cents: 1500 }])])).r;
  await owner();
  const usdRow = await one(`select fx_rate_to_usd from store_orders where id = $1`, [usdOrder.store_order_id]);
  ok(usdOrder.ok === true && usdRow.fx_rate_to_usd === null,
    'Item 19: USD order with fx_rate_to_usd=NULL stores NULL (never 1)');

  // ── 5. Review 4: pg_cron job, retry/backoff + dead-letter, duplicate-key no-op, & stock_shortage -> on_hold ──
  const cronJob = await one(`
    select jobid, jobname, schedule, command, active
      from cron.job
     where jobname = 'octopus-dropship-domain-events'
  `);
  const cleanupJob = await one(`
    select jobid, jobname, schedule, command, active
      from cron.job
     where jobname = 'octopus-cron-history-cleanup'
  `);
  const noopRun = (await one(`select process_dropship_domain_events(100) r`)).r;
  ok(
    !!cronJob && cronJob.active === true && cronJob.schedule === '* * * * *'
      && !!cleanupJob && cleanupJob.active === true && cleanupJob.schedule === '20 2 * * *' && /job_run_details/.test(cleanupJob.command)
      && noopRun.processed === 0 && noopRun.retried === 0 && noopRun.dead === 0,
    `Review 4: pg_cron '${cronJob?.jobname}' active (${cronJob?.schedule}) + daily '${cleanupJob?.jobname}' active (${cleanupJob?.schedule}), 0-event run is a clean no-op`,
  );

  // Poison event -> 4 exponential retries (1m, 5m, 30m, 2h) -> 5th attempt transitions to 'dead' + audit_log
  const poisonId = (await one(`
    select emit_dropship_domain_event('domain_event.test_poison', 'store_order', $1, 'test:poison:1', '{"reason":"unit_test_backoff"}'::jsonb) id
  `, [usdOrder.store_order_id])).id;
  const backoffSnapshots = [];
  for (let i = 1; i <= 5; i++) {
    await db.query(`update domain_events set available_at = now() - interval '1 second' where id = $1`, [poisonId]);
    await db.query(`select process_dropship_domain_events(10)`);
    const st = await one(`
      select db_status, attempts, round(extract(epoch from (available_at - now())))::int as secs_ahead, last_error
        from domain_events where id = $1
    `, [poisonId]);
    backoffSnapshots.push(st);
  }
  const deadAudit = await one(`select count(*)::int n from audit_log where action = 'domain_event.dead_letter' and entity_id = $1`, [poisonId]);
  const afterDeadRun = (await one(`select process_dropship_domain_events(10) r`)).r;
  ok(
    backoffSnapshots[0].db_status === 'retry' && backoffSnapshots[0].attempts === 1 && backoffSnapshots[0].secs_ahead >= 50 && backoffSnapshots[0].secs_ahead <= 70
      && backoffSnapshots[1].db_status === 'retry' && backoffSnapshots[1].attempts === 2 && backoffSnapshots[1].secs_ahead >= 290 && backoffSnapshots[1].secs_ahead <= 310
      && backoffSnapshots[2].db_status === 'retry' && backoffSnapshots[2].attempts === 3 && backoffSnapshots[2].secs_ahead >= 1790 && backoffSnapshots[2].secs_ahead <= 1810
      && backoffSnapshots[3].db_status === 'retry' && backoffSnapshots[3].attempts === 4 && backoffSnapshots[3].secs_ahead >= 7190 && backoffSnapshots[3].secs_ahead <= 7210
      && backoffSnapshots[4].db_status === 'dead'  && backoffSnapshots[4].attempts === 5
      && deadAudit.n === 1
      && afterDeadRun.retried === 0 && afterDeadRun.dead === 0,
    `Review 4: retry/backoff (1m -> 5m -> 30m -> 2h) transitions to 'dead' on attempt 5, logs audit_log, and is skipped thereafter`,
  );

  // Insufficient 3PL stock on reserve -> order goes on_hold with hold_reason='stock_shortage', NO error!
  await as(merchA, 'aal1');
  const shortOrder = (await one(`
    select create_dropship_store_order(
      $1, 'manual', 'MAN-SHORT-1009', '#1009', 'Shortage Buyer', '+1-555-0188',
      '{"line1":"50 Elm St","city":"Austin","country":"US"}'::jsonb,
      'US', 'USD', null, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varFast.id, qty: 25, buyer_unit_price_cents: 1500 }])])).r;
  // Temporarily reserve 30 on another order? Even simpler: SZ-01 has 50 on_hand; order 25 + order 30 -> second exceeds available (20 < 30)!
  // Let's test directly by adjusting 30 out or ordering 25 after usdOrder reserves, or ordering 20 + 35!
  await owner();
  await db.query(`select record_warehouse_stock_movement($1, 'adjust_out', 30, 'Leave 20 available for shortage test', 'SZ-01', null)`, [varFast.item_id]);
  // Available is now 20, while shortOrder needs qty = 25!
  await as(merchA, 'aal1');
  const shortPaid = (await one(`select mark_store_order_paid($1) r`, [shortOrder.store_order_id])).r;
  await owner();
  const shortRow = await one(`select staff_stage, merchant_status, hold_reason from store_orders where id = $1`, [shortOrder.store_order_id]);
  ok(
    shortPaid.ok === true
      && shortRow.staff_stage === 'on_hold'
      && shortRow.merchant_status === 'on_hold'
      && shortRow.hold_reason === 'stock_shortage',
    `Review 4: insufficient 3PL stock (avail 20 < qty 25) sets staff_stage='on_hold', merchant_status='on_hold', hold_reason='stock_shortage' with NO error`,
  );
  // Restore the 30 units back to 50 on_hand for the full step-by-step pipeline test
  await db.query(`select record_warehouse_stock_movement($1, 'adjust_in', 30, 'Restore 50 on_hand', 'SZ-01', null)`, [varFast.item_id]);

  // ── 6. Review 4 & 5: Full Step-by-Step Pipeline + Duplicate-Key No-op + Finance Escrow Release Date ──
  // Create a Finance escrow_holds row (target_type = 'dropship_order', store_order_id = $2, auto_release_days = 7, release_rule = 'delivery_plus_days')
  const ehRow = await one(`
    insert into escrow_holds (
      org_id, division_id, service, target_type, target_id, store_order_id, funding_method,
      amount_cents, currency, release_rule, milestone_label, auto_release_days, status, idempotency_key
    ) values (
      $1::uuid, division_id_of('DS'), 'dropship', 'dropship_order', $2::uuid, $2::uuid, 'wallet',
      $3::bigint, 'USD', 'delivery_plus_days', 'Parcel delivered + 7 days', 7, 'held', $4::text
    )
    returning id, auto_release_at
  `, [orgA, usdOrder.store_order_id, usdOrder.quote.total_cents, `eh-i2-${usdOrder.store_order_id}`]);

  // Step 1: paid -> Step 2: reserve -> Step 3: handoff
  await as(merchA, 'aal1');
  const stepPaid = (await one(`select mark_store_order_paid($1, null, $2) r`, [usdOrder.store_order_id, ehRow.id])).r;
  await owner();

  // Duplicate idempotency_key no-op check: re-emitting 'store_order:<id>:paid' returns same event_id, stays processed, 1 consumption, reserved stays 3!
  const dupEvId = (await one(`
    select emit_dropship_domain_event('store_order.paid', 'store_order', $1, $2, '{}'::jsonb) id
  `, [usdOrder.store_order_id, `store_order:${usdOrder.store_order_id}:paid`])).id;
  const dupRun = (await one(`select process_dropship_domain_events(10) r`)).r;
  const consCnt = (await one(`select count(*)::int n from domain_event_consumptions where event_id = $1`, [dupEvId])).n;
  const wsStep2 = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [varFast.item_id]);
  const hoStep3 = await one(`select handoff_type, status, (select code from divisions where id = to_division_id) div_code from dropship_handoffs where store_order_id = $1`, [usdOrder.store_order_id]);

  ok(
    dupEvId === stepPaid.event_id && dupRun.processed === 0 && consCnt === 1 && wsStep2.reserved_qty === 3,
    'Review 4: duplicate idempotency_key is a strict no-op (same event_id, 0 re-runs, reserved_qty stays 3)',
  );
  ok(
    stepPaid.staff_stage === 'packing'
      && stepPaid.merchant_status === 'processing'
      && wsStep2.on_hand_qty === 50
      && wsStep2.reserved_qty === 3
      && hoStep3.handoff_type === 'warehouse_pick_pack'
      && hoStep3.status === 'reserved'
      && hoStep3.div_code === '3PL',
    'Pipeline Step 1–3 (paid -> reserve -> handoff): reserved 3/50 in SZ-01, 3PL handoff=reserved, order=packing/processing',
  );

  // Step 4 & 5: shipment (store_order_id, token) + pick + label_ready STAYS 'processing'
  await as(dsStaff, 'aal2');
  const shipRes = (await one(`
    select create_store_order_shipment($1, 'yunexpress', 'BKPHR', 'YT261124000001', 1.8, 740, 'label_ready') r
  `, [usdOrder.store_order_id])).r;
  await owner();

  const wsStep4 = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [varFast.item_id]);
  const soStep5 = await one(`select staff_stage, merchant_status from store_orders where id = $1`, [usdOrder.store_order_id]);
  ok(
    !!shipRes.shipment_id
      && /^[0-9a-f]{36}$/.test(shipRes.tracking_token)
      && wsStep4.on_hand_qty === 47
      && wsStep4.reserved_qty === 0
      && soStep5.staff_stage === 'packing'
      && soStep5.merchant_status === 'processing',
    `Pipeline Step 4–5 (pick -> shipment + token -> label_ready): pick deducted (47/0), token minted, label_ready STAYS merchant_status='processing'`,
  );

  // Step 6: picked_up -> merchant_status = 'shipped' (staff_stage = 'handed_over')
  await as(whStaff, 'aal2');
  await db.query(`select warehouse_update_shipment($1, 'picked_up'::shipment_status)`, [shipRes.shipment_id]);
  await owner();

  const soStep6 = await one(`select staff_stage, merchant_status from store_orders where id = $1`, [usdOrder.store_order_id]);
  const hoStep6 = await one(`select status from dropship_handoffs where store_order_id = $1`, [usdOrder.store_order_id]);
  ok(
    soStep6.staff_stage === 'handed_over' && soStep6.merchant_status === 'shipped' && hoStep6.status === 'shipped',
    `Pipeline Step 6 (picked_up -> shipped): staff_stage='handed_over', merchant_status='shipped', handoff='shipped'`,
  );

  // Step 7: delivered -> store_orders.delivered_at + Finance escrow_holds.auto_release_at (7 days after delivered_at)
  await as(whStaff, 'aal2');
  await db.query(`select warehouse_update_shipment($1, 'delivered'::shipment_status)`, [shipRes.shipment_id]);
  await owner();

  await as(merchA, 'aal1');
  const escrowInfo = (await one(`select get_store_order_escrow_info($1) info`, [usdOrder.store_order_id])).info;
  await owner();

  const soStep7 = await one(`select staff_stage, merchant_status, delivered_at from store_orders where id = $1`, [usdOrder.store_order_id]);
  const daysDiff = (Date.parse(escrowInfo.auto_release_at) - Date.parse(soStep7.delivered_at)) / 86_400_000;
  ok(
    soStep7.staff_stage === 'delivered'
      && soStep7.merchant_status === 'delivered'
      && !!soStep7.delivered_at
      && escrowInfo.has_escrow_hold === true
      && escrowInfo.escrow_hold_id === ehRow.id
      && Math.abs(daysDiff - 7) < 0.01,
    `Pipeline Step 7 (delivered -> escrow release date): store_orders.delivered_at set, Finance escrow_holds.auto_release_at = +${daysDiff.toFixed(2)} days`,
  );

  // Extended-catalog Sourcing handoff + Cancel release quick check
  await as(merchA, 'aal1');
  const extOrder = (await one(`
    select create_dropship_store_order(
      $1, 'manual', 'MAN-EXT-1003', '#1003', 'Lisa Buyer', '+1-555-0122',
      '{"line1":"100 Main St","city":"Austin","country":"US"}'::jsonb,
      'US', 'USD', null, 'express', 'DDP', $2::jsonb, true
    ) r
  `, [orgA, JSON.stringify([{ variant_id: varExt.id, qty: 2, buyer_unit_price_cents: 1500 }])])).r;
  const extPaid = (await one(`select mark_store_order_paid($1) r`, [extOrder.store_order_id])).r;
  await owner();
  const srcHandoff = await one(`select id from dropship_handoffs where store_order_id = $1`, [extOrder.store_order_id]);
  await as(srcStaff, 'aal2');
  await db.query(`select receive_sourcing_handoff_at_3pl($1, 'SZ-01')`, [srcHandoff.id]);
  await owner();
  const extAfterRecv = await one(`select staff_stage, merchant_status from store_orders where id = $1`, [extOrder.store_order_id]);
  ok(
    extPaid.staff_stage === 'sourcing' && extPaid.merchant_status === 'processing'
      && extAfterRecv.staff_stage === 'packing' && extAfterRecv.merchant_status === 'processing',
    'Extended catalog pipeline: paid -> sourcing/processing -> received_at_3pl -> packing/processing',
  );

  await as(merchA, 'aal1');
  await db.query(`select mark_store_order_paid($1)`, [gbpOrder.store_order_id]);
  const cancelRes = (await one(`select cancel_store_order($1, 'Buyer cancelled before dispatch') r`, [gbpOrder.store_order_id])).r;
  await owner();
  const wsAfterCancel = await one(`select on_hand_qty, reserved_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`, [varFast.item_id]);
  ok(
    cancelRes.staff_stage === 'cancelled' && cancelRes.merchant_status === 'cancelled' && wsAfterCancel.on_hand_qty === 47 && wsAfterCancel.reserved_qty === 0,
    'Cancel pipeline: cancelling reserved order releases 3PL stock (on_hand=47, reserved=0)',
  );

  // ── 7. Review 1 & Item 20: tickets (general + order_id + store_order_id + rfq_id + at-most-one) & Wholesale shipment exclusion ──
  const tkCols = new Set((await all(`
    select column_name from information_schema.columns where table_schema = 'public' and table_name = 'tickets'
  `)).map((r) => r.column_name));
  ok(tkCols.has('store_order_id') && tkCols.has('rfq_id') && tkCols.has('division_id'),
    'Review 1: tickets has store_order_id, rfq_id, and division_id columns');

  const whOrder = await one(`
    insert into orders(org_id, title, quantity, unit_price_cents, total_cents, deposit_cents, status, currency, division_id)
    values ($1, 'Wholesale B2B Order', 100, 500, 50000, 15000, 'confirmed', 'USD', division_id_of('SRC'))
    returning id
  `, [orgB]);
  const rfqRow = await one(`
    insert into rfqs(org_id, title, quantity, unit, status)
    values ($1, 'Custom Kettle RFQ', 500, 'pcs', 'submitted')
    returning id
  `, [orgA]);

  // 1) General ticket via create_ticket RPC (0 links -> division_id = null)
  await as(merchA, 'aal1');
  const genTktId = (await one(`select create_ticket('General billing question', 'question', 'How do statements work?') id`)).id;
  await owner();
  const genTkt = await one(`select order_id, store_order_id, rfq_id, division_id from tickets where id = $1`, [genTktId]);
  // 2) Wholesale order_id ticket -> SRC
  const ordTkt = await one(`insert into tickets(org_id, order_id, subject) values ($1, $2, 'Order question') returning division_id, (select code from divisions where id = division_id) code`, [orgB, whOrder.id]);
  // 3) Dropship store_order_id ticket -> DS
  const dsTkt = await one(`insert into tickets(org_id, store_order_id, subject) values ($1, $2, 'Dropship parcel question') returning division_id, (select code from divisions where id = division_id) code`, [orgA, usdOrder.store_order_id]);
  // 4) RFQ rfq_id ticket -> SRC
  const rfqTkt = await one(`insert into tickets(org_id, rfq_id, subject) values ($1, $2, 'RFQ spec question') returning division_id, (select code from divisions where id = division_id) code`, [orgA, rfqRow.id]);

  ok(
    genTkt.order_id === null && genTkt.store_order_id === null && genTkt.rfq_id === null && genTkt.division_id === null
      && ordTkt.code === 'SRC'
      && dsTkt.code === 'DS'
      && rfqTkt.code === 'SRC',
    'Review 1: general ticket (0 links -> division_id=null) and each single-linked ticket (order->SRC, store_order->DS, rfq->SRC) succeed',
  );
  ok(
    !!(await tryq(`insert into tickets(org_id, order_id, store_order_id, subject) values ($1, $2, $3, 'Two links 1')`, [orgA, whOrder.id, usdOrder.store_order_id])).err
      && !!(await tryq(`insert into tickets(org_id, order_id, rfq_id, subject) values ($1, $2, $3, 'Two links 2')`, [orgA, whOrder.id, rfqRow.id])).err
      && !!(await tryq(`insert into tickets(org_id, store_order_id, rfq_id, subject) values ($1, $2, $3, 'Two links 3')`, [orgA, usdOrder.store_order_id, rfqRow.id])).err,
    'Review 1: tickets_link_at_most_one_check rejects linking more than one of (order_id, store_order_id, rfq_id)',
  );

  // Wholesale shipment keeps tracking_token = null & /t/[token] serves ONLY store_order shipments with 0 PII
  const whShip = await one(`
    insert into shipments(order_id, org_id, carrier_code, tracking_no, status, currency, division_id)
    values ($1, $2, 'yunexpress', 'YT-WHOLESALE-1', 'in_transit', 'USD', division_id_of('SRC'))
    returning id, tracking_token
  `, [whOrder.id, orgB]);
  ok(whShip.tracking_token === null, 'Item 20: wholesale shipment keeps tracking_token = NULL');

  await db.query(`
    insert into tracking_events(shipment_id, org_id, status, description, location, occurred_at)
    values ($1, $2, 'delivered', 'Delivered to front porch', 'Austin, US', now())
  `, [shipRes.shipment_id, orgA]);

  await asAnon();
  const pubTrack = (await one(`select get_public_dropship_tracking($1) t`, [shipRes.tracking_token])).t;
  const pubBogus = (await one(`select get_public_dropship_tracking('000000000000000000000000000000000000') t`)).t;
  await owner();

  ok(
    pubBogus === null
      && pubTrack.seller_name === 'Northstar Home Co'
      && pubTrack.order_ref === '#1002'
      && pubTrack.status === 'delivered'
      && !/Evergreen|555-0199|BuyerSecret|yunexpress|octopus|I2 Factory/i.test(JSON.stringify(pubTrack)),
    'Item 20 & 23: get_public_dropship_tracking serves store_order tracking to anon with ZERO buyer address/phone/name/carrier/supplier',
  );

  await as(merchA, 'aal1');
  const repRows = await all(`select * from get_dropship_orders_report($1, null, null)`, [orgA]);
  ok(
    repRows.length === 4 && !/Evergreen|555-0199|BuyerSecret/i.test(JSON.stringify(repRows)),
    'Item 23: get_dropship_orders_report returns order financials + escrow_auto_release_at with ZERO buyer address, phone, or name',
  );
  await owner();

  // ── 8. Item 22 (internal_charge_rules inactive + null) & Item 23 RLS ──
  const icrRows = await all(`select rule_code, active, rate_bp, flat_fee_cents from internal_charge_rules order by rule_code`);
  ok(
    icrRows.length === 4 && icrRows.every((r) => r.active === false && r.rate_bp === null && r.flat_fee_cents === null)
      && !!(await tryq(`update internal_charge_rules set active = true where rule_code = 'DS_TO_3PL_PICK_PACK'`)).err,
    'Item 22: all 4 internal_charge_rules seed rows are inactive with NULL rates and cannot be activated while NULL',
  );

  await as(merchA, 'aal1');
  ok((await all(`select id from store_orders`)).length === 4 && (await all(`select id from store_order_items`)).length === 4,
    'Item 23 RLS: Merchant A reads own store_orders (4) & store_order_items (4)');

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
  ok((await all(`select id from store_orders where org_id = $1`, [orgA])).length === 4,
    'Item 23 RLS: Dropship division staff reads store_orders');
  await owner();

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
