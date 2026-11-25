// Phase 2 Batch 1 verification (STAGING ONLY, rolled-back transaction + read-only URL assertions):
//  1. Zero public URLs / slugs contain a Sourcing SKU, supplier code, factory model token, or /import/.
//  2. product_slug_redirects + resolve_product_slug_redirect work for anon on live products (null for drafts).
//  3. Simulated support (aal2) & non-cost staff JWTs cannot read ANY cost, supplier, SKU, or carrier rate column
//     across ALL public tables/views/RPCs, while authorized staff roles keep working.
//  4. Migration 216 up -> down -> up round-trip produces an empty schema diff.
// Run: node supabase/tests/batch1-whitelabel-support.test.mjs

import fs from 'node:fs';
import pg from 'pg';
import { config } from 'dotenv';
import { extractForbiddenSlugTokens } from '../../lib/slug.ts';
import { loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: '.env.staging', quiet: true, override: true });
loadStagingEnvOrExit();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failed++;
};
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const tryq = async (q, p) => {
  await db.query('savepoint sp_try');
  try {
    const r = await db.query(q, p);
    await db.query('release savepoint sp_try');
    return { err: null, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback to savepoint sp_try');
    return { err: e.message, rows: [], n: 0 };
  }
};
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', aal }),
  ]);
  await db.query('set local role authenticated');
};
const asAnon = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
  await db.query('set local role anon');
};

const toSlugPart = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkImageUrl(url, extraTokens = []) {
  if (!url) return null;
  let relPath = url;
  try {
    const u = new URL(url);
    const m = /^\/storage\/v1\/object\/public\/[^/]+\/(.+)$/.exec(u.pathname);
    relPath = m ? decodeURIComponent(m[1]) : decodeURIComponent(u.pathname);
  } catch {
    relPath = url;
  }
  if (/^import\//i.test(relPath) || /\/import\//i.test(relPath)) return 'contains /import/';
  if (/\bcn-[a-z]{2}-[a-z0-9-]+/i.test(relPath)) return 'contains CN-XX SKU pattern';
  if (/\boct-[a-z0-9-]+/i.test(relPath)) return 'contains OCT- supplier code';
  const low = relPath.toLowerCase();
  const base = (relPath.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase();
  for (const raw of extraTokens) {
    if (!raw) continue;
    const rawStr = String(raw).trim().toLowerCase();
    if (rawStr.length >= 8 && low.includes(rawStr)) return `contains identifier "${rawStr}"`;
    const norm = toSlugPart(rawStr);
    if (norm.length >= 3 && (low.includes(norm) || base === norm || base.startsWith(`${norm}-`) || base.startsWith(`${norm}_`))) {
      return `contains token "${norm}"`;
    }
  }
  return null;
}

function checkSlug(slug, p) {
  const sl = String(slug || '').toLowerCase();
  if (!sl) return 'empty slug';
  if (/(^|-)cn-[a-z]{2}-/i.test(sl)) return 'contains cn-xx- SKU prefix';
  if (/(^|-)oct-[a-z0-9-]+/i.test(sl)) return 'contains oct- supplier prefix';
  const toks = extractForbiddenSlugTokens([
    p.sku,
    p.external_id,
    p.factory_model,
    p.sup_code,
    p.sup_ext,
    p.manufacturer_code,
  ]);
  for (const t of toks) {
    if (new RegExp(`(^|-)${escapeRegex(t)}(?=-|$)`).test(sl)) return `contains forbidden token "${t}"`;
  }
  const extNorm = toSlugPart(p.external_id || '');
  const titleNorm = toSlugPart(p.title || '');
  if (extNorm && titleNorm && sl.startsWith(titleNorm) && sl.length > titleNorm.length + 1) {
    const tail = sl.slice(titleNorm.length + 1);
    if (tail && extNorm.startsWith(tail)) return `contains truncated SKU tail "${tail}"`;
  }
  return null;
}

try {
  // ── 1. Public URL & Slug White-Label Guard (actual persisted staging rows) ──
  const products = await all(`
    select p.id, p.slug, p.title, p.status, p.image_url, p.sku, p.external_id, p.factory_model, p.supplier_id,
           s.code as sup_code, s.external_id as sup_ext, s.manufacturer_code
      from public.products p
      left join public.suppliers s on s.id = p.supplier_id
  `);
  const byProdId = new Map(products.map((p) => [p.id, p]));
  const media = await all(`select id, product_id, url from public.product_media`);
  const dsProds = await all(`select id, model_no, images, supplier_id, supplier_sku, octopus_sku, legacy_sku from public.dropship_products`);

  const badImg = [];
  for (const p of products) {
    const issue = checkImageUrl(p.image_url, [p.supplier_id, p.sku, p.external_id, p.sup_code, p.sup_ext, p.manufacturer_code]);
    if (issue) badImg.push(`products(${p.id}).image_url: ${issue} (${p.image_url})`);
  }
  for (const m of media) {
    const p = byProdId.get(m.product_id);
    const toks = p ? [p.supplier_id, p.sku, p.external_id, p.sup_code, p.sup_ext, p.manufacturer_code] : [];
    const issue = checkImageUrl(m.url, toks);
    if (issue) badImg.push(`product_media(${m.id}).url: ${issue} (${m.url})`);
  }
  for (const d of dsProds) {
    for (const img of Array.isArray(d.images) ? d.images : []) {
      const issue = checkImageUrl(img, [d.supplier_id, d.supplier_sku, d.octopus_sku, d.legacy_sku]);
      if (issue) badImg.push(`dropship_products(${d.model_no}).images: ${issue} (${img})`);
    }
  }
  ok(
    badImg.length === 0,
    `public image URLs: 0/${products.length} products, 0/${media.length} media, 0/${dsProds.length} dropship contain SKU/supplier/factory tokens${badImg.length ? ' — ' + badImg.slice(0, 5).join('; ') : ''}`,
  );

  const badSlugs = [];
  for (const p of products) {
    const issue = checkSlug(p.slug, p);
    if (issue) badSlugs.push(`${p.slug}: ${issue}`);
  }
  ok(
    badSlugs.length === 0,
    `public product slugs: 0/${products.length} contain SKUs/supplier codes/factory tokens${badSlugs.length ? ' — ' + badSlugs.slice(0, 5).join('; ') : ''}`,
  );

  const redirects = await all(`
    select r.old_slug, p.slug as new_slug, p.status
      from public.product_slug_redirects r
      join public.products p on p.id = r.product_id
  `);
  const liveRedir = redirects.find((r) => r.status === 'live');
  const draftRedir = redirects.find((r) => r.status === 'draft');
  await db.query('begin');
  await asAnon();
  const rLive = liveRedir
    ? (await one(`select public.resolve_product_slug_redirect($1) s`, [liveRedir.old_slug]))?.s
    : null;
  const rDraft = draftRedir
    ? (await one(`select public.resolve_product_slug_redirect($1) s`, [draftRedir.old_slug]))?.s
    : null;
  await db.query('reset role');
  ok(
    !!liveRedir && rLive === liveRedir.new_slug && (!draftRedir || rDraft === null),
    `anon resolve_product_slug_redirect(): live "${liveRedir?.old_slug}" → "${rLive}", draft stays null (${redirects.length} redirects total)`,
  );

  // ── 2. Simulated support (aal2) & non-cost roles audit across ALL tables/views/RPCs ──
  const mkUser = async (email, role, divCode = null, divRole = null) => {
    const uid = (
      await one(
        `insert into auth.users(id, email, aud, role, instance_id)
         values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')
         returning id`,
        [email],
      )
    ).id;
    await db.query(`insert into public.profiles(id, full_name, email) values ($1, $2, $3) on conflict do nothing`, [
      uid,
      `T ${email}`,
      email,
    ]);
    if (role) await db.query(`insert into public.user_roles(user_id, role_code) values ($1, $2)`, [uid, role]);
    if (divCode && divRole) {
      await db.query(
        `insert into public.division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`,
        [uid, divCode, divRole],
      );
    }
    return uid;
  };

  // Seed a dropship_handoffs row inside this rolled-back tx if a store_order exists so non-empty RLS is verified
  const anySo = await one(`select id from public.store_orders limit 1`);
  const anySp = await one(`select id from public.supplier_products limit 1`);
  if ((await one(`select count(*)::int n from public.dropship_handoffs`)).n === 0 && anySo && anySp) {
    await db.query(
      `insert into public.dropship_handoffs(store_order_id, handoff_type, from_division_id, to_division_id, supplier_product_id, status)
       values ($1, 'sourcing_restock', division_id_of('DS'), division_id_of('SRC'), $2, 'pending')`,
      [anySo.id, anySp.id],
    );
  }

  const supportUid = await mkUser('b1-support@example.com', 'support');
  const qcUid = await mkUser('b1-qc@example.com', 'qc_coordinator');
  const editorUid = await mkUser('b1-editor@example.com', 'content_editor');
  const sourcingUid = await mkUser('b1-sourcing@example.com', 'sourcing_agent');
  const financeUid = await mkUser('b1-finance@example.com', 'finance');
  const opsUid = await mkUser('b1-ops@example.com', 'operations', 'DS', 'staff');

  const DIRECT_HIDDEN_COLS = [
    ['dropship_products', 'unit_cost_cents'],
    ['dropship_products', 'supplier_id'],
    ['dropship_products', 'supplier_sku'],
    ['dropship_products', 'octopus_sku'],
    ['dropship_products', 'legacy_sku'],
    ['dropship_variants', 'cost_cents'],
    ['dropship_variants', 'supplier_product_id'],
    ['dropship_variants', 'octopus_sku'],
    ['dropship_variants', 'legacy_sku'],
    ['dropship_routes', 'carrier'],
    ['dropship_handoffs', 'supplier_product_id'],
    ['dropship_rates', 'ship_base_cents'],
    ['dropship_rates', 'ship_per_100g_cents'],
    ['shipping_rate_cards', 'carrier_code'],
    ['shipping_rate_cards', 'carrier_service_code'],
    ['products', 'sku'],
    ['products', 'supplier_id'],
    ['products', 'external_id'],
    ['products', 'factory_model'],
    ['shipments', 'rate_cents'],
    ['shipments', 'carrier_code'],
  ];

  const BLOCKED_TABLES_SUPPORT = [
    'supplier_products',
    'supplier_product_prices',
    'product_costs',
    'suppliers',
    'supplier_contacts',
    'supplier_name_variants',
    'supplier_switches',
    'supplier_verifications',
    'shipping_rate_cards',
    'warehouse_shipments',
    'payouts',
    'finance_approvals',
    'import_jobs',
    'distributor_suppliers',
    'source_connections',
    'customer_limits',
    'manager_limits',
    'approvals',
  ];

  for (const [label, uid] of [
    ['support (aal2)', supportUid],
    ['qc_coordinator (aal2)', qcUid],
    ['content_editor (aal2)', editorUid],
  ]) {
    await as(uid, 'aal2');
    const colLeaks = [];
    for (const [t, c] of DIRECT_HIDDEN_COLS) {
      const r = await tryq(`select ${c} from public.${t} limit 1`);
      if (!/permission denied/.test(r.err ?? '')) colLeaks.push(`${t}.${c}`);
    }
    ok(
      colLeaks.length === 0,
      `${label}: direct read refused on all ${DIRECT_HIDDEN_COLS.length} sensitive columns${colLeaks.length ? ' — LEAK: ' + colLeaks.join(', ') : ''}`,
    );

    const rowLeaks = [];
    for (const t of BLOCKED_TABLES_SUPPORT) {
      const r = await tryq(`select 1 from public.${t} limit 1`);
      if (!r.err && r.rows.length > 0) rowLeaks.push(t);
    }
    ok(
      rowLeaks.length === 0,
      `${label}: 0 rows readable in ${BLOCKED_TABLES_SUPPORT.length} supplier/cost/rate tables${rowLeaks.length ? ' — ROWS IN: ' + rowLeaks.join(', ') : ''}`,
    );
  }

  await as(editorUid, 'aal2');
  const editorCarriers = await tryq(`select 1 from public.carriers limit 1`);
  ok(!editorCarriers.err && editorCarriers.rows.length === 0, 'content_editor (aal2): 0 rows readable in carriers');

  for (const [label, uid] of [
    ['support (aal2)', supportUid],
    ['qc_coordinator (aal2)', qcUid],
  ]) {
    await as(uid, 'aal2');
    const cr = await tryq(`select code, name from public.carriers limit 1`);
    ok(!cr.err && cr.rows.length > 0, `${label}: can read non-sensitive carrier metadata (name)`);
  }

  await as(supportUid, 'aal2');
  const rpcLeaks = [];
  for (const [name, sql] of [
    ['dropship_sourcing_links()', `select 1 from public.dropship_sourcing_links() limit 1`],
    ['list_sourcing_supplier_products()', `select 1 from public.list_sourcing_supplier_products(5) limit 1`],
    ['list_sourcing_candidates_for_dropship()', `select 1 from public.list_sourcing_candidates_for_dropship(5) limit 1`],
    ['quote_carrier_rates()', `select 1 from public.quote_carrier_rates('yunexpress', 'US', 500, 1) limit 1`],
    [
      'get_shipment_rates()',
      `select 1 from public.get_shipment_rates(array['00000000-0000-0000-0000-000000000000'::uuid]) limit 1`,
    ],
  ]) {
    const r = await tryq(sql);
    if (!/FORBIDDEN|permission denied/i.test(r.err ?? '')) rpcLeaks.push(`${name} -> ${r.err || `${r.rows.length} rows`}`);
  }
  ok(
    rpcLeaks.length === 0,
    `support (aal2): blocked from cost/supplier/carrier RPCs${rpcLeaks.length ? ' — LEAK: ' + rpcLeaks.join(', ') : ''}`,
  );

  // Full ALL-table/view sweep as support (aal2) for ANY readable column looking like cost/supplier/margin/carrier/sku/rate
  await db.query('reset role');
  const sensitiveCols = await all(`
    select c.table_name, c.column_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name ~* '(cost|supplier|margin|carrier|sku|factory|markup|price_minor|rate_cents|base_cents|per_100g)'
     order by c.table_name, c.column_name
  `);
  // Explicit allowlist of non-sensitive / public / view-safe columns on tables that DO NOT expose internal cost/supplier/carrier
  const SUPPORT_ALLOW = new Set([
    'product_factory.product_id',
    'quote_factory.quote_id',
    'order_factory.order_id',
    'store_orders.carrier_code', // stores buyer-facing carrier status on dropship store orders if any
    'turnkey_projects.factory_hub_ids', // public showcase hubs (verified cities/regions)
    'pools.pool_price_minor', // customer group-buy tier sell price
    'pools.final_price_minor', // customer group-buy tier final price
    'pool_pledge_mine_view.pool_price_minor',
    'pool_pledge_mine_view.final_price_minor',
  ]);
  await as(supportUid, 'aal2');
  const sweepLeaks = [];
  for (const { table_name, column_name } of sensitiveCols) {
    if (SUPPORT_ALLOW.has(`${table_name}.${column_name}`)) continue;
    const r = await tryq(`select ${column_name} from public.${table_name} where ${column_name} is not null limit 1`);
    if (!r.err && r.rows.length > 0) sweepLeaks.push(`${table_name}.${column_name}`);
  }
  ok(
    sweepLeaks.length === 0,
    `support (aal2) ALL-tables sweep (${sensitiveCols.length} sensitive columns scanned): 0 unexpected readable values${sweepLeaks.length ? ' — LEAKED: ' + sweepLeaks.join(', ') : ''}`,
  );

  // Authorized roles & division/permission boundaries on supplier tables and shipment RPCs
  await db.query('reset role');
  const anyOrd = await one(`select id, org_id from public.orders limit 1`);
  let testOrgId = anyOrd?.org_id;
  let testOrdId = anyOrd?.id;
  if (!testOrdId) {
    const o = await one(`select id from public.organizations limit 1`);
    testOrgId = o.id;
    testOrdId = (
      await one(
        `insert into public.orders (org_id, division_id, code, title, quantity, unit_price_cents, total_cents, deposit_cents, currency)
         values ($1, division_id_of('SRC'), 'B1-TEST-ORD', 'B1 Test Order', 1, 1000, 1000, 300, 'USD')
         returning id`,
        [testOrgId],
      )
    ).id;
  }
  const srcShp = (
    await one(
      `insert into public.shipments (code, order_id, org_id, carrier_code, tracking_no, rate_cents, currency, status, division_id)
       values ('B1-TEST-SHP-SRC', $1, $2, 'yunexpress', 'YT-B1-SRC', 4100, 'USD', 'in_transit', division_id_of('SRC'))
       returning id`,
      [testOrdId, testOrgId],
    )
  ).id;
  const dsShp = (
    await one(
      `insert into public.shipments (code, order_id, org_id, carrier_code, tracking_no, rate_cents, currency, status, division_id)
       values ('B1-TEST-SHP-DS', $1, $2, 'yunexpress', 'YT-B1-DS', 5200, 'USD', 'in_transit', division_id_of('DS'))
       returning id`,
      [testOrdId, testOrgId],
    )
  ).id;
  const shpArr = `array['${srcShp}'::uuid, '${dsShp}'::uuid]`;

  const qcSrcUid = await mkUser('b1-qc-src@example.com', 'qc_coordinator', 'SRC', 'staff');
  const opsSrcUid = await mkUser('b1-ops-src@example.com', 'operations', 'SRC', 'staff');
  const warehouseUid = await mkUser('b1-warehouse@example.com', 'warehouse', '3PL', 'warehouse');
  const adminUid = await mkUser('b1-admin@example.com', 'admin');
  const custUid = await mkUser('b1-cust@example.com', 'customer');

  await as(sourcingUid, 'aal2');
  ok(
    (await all(`select id from public.suppliers limit 1`)).length > 0,
    'sourcing_agent (aal2): can read suppliers (allowed)',
  );

  await as(supportUid, 'aal2');
  const supCarriers = await tryq(`select shipment_id, carrier_name from public.get_shipment_carriers(${shpArr})`);
  const supRates = await tryq(`select 1 from public.get_shipment_rates(${shpArr})`);
  ok(
    !supCarriers.err && supCarriers.rows.length === 2 && supCarriers.rows.every((r) => !!r.carrier_name),
    'support (aal2): get_shipment_carriers() returns carrier_name across divisions',
  );
  ok(/FORBIDDEN/i.test(supRates.err ?? ''), 'support (aal2): get_shipment_rates() raises FORBIDDEN');

  await as(qcSrcUid, 'aal2');
  const qcCarriers = await tryq(`select shipment_id, carrier_name from public.get_shipment_carriers(${shpArr})`);
  const qcRates = await tryq(`select 1 from public.get_shipment_rates(${shpArr})`);
  const qcWhView = await tryq(`select 1 from public.warehouse_shipments limit 1`);
  ok(
    !qcCarriers.err && qcCarriers.rows.length === 1 && qcCarriers.rows[0].shipment_id === srcShp,
    'qc_coordinator (aal2, SRC): get_shipment_carriers() is division-scoped to SRC only',
  );
  ok(/FORBIDDEN/i.test(qcRates.err ?? ''), 'qc_coordinator (aal2, SRC): get_shipment_rates() raises FORBIDDEN');
  ok(!qcWhView.err && qcWhView.rows.length === 0, 'qc_coordinator (aal2, SRC): 0 rows readable in warehouse_shipments');

  await as(warehouseUid, 'aal2');
  const whCarriers = await tryq(`select shipment_id, carrier_name from public.get_shipment_carriers(${shpArr})`);
  const whRates = await tryq(`select 1 from public.get_shipment_rates(${shpArr})`);
  ok(
    !whCarriers.err && whCarriers.rows.length === 2,
    'warehouse (aal2, 3PL): get_shipment_carriers() succeeds across all divisions',
  );
  ok(/FORBIDDEN/i.test(whRates.err ?? ''), 'warehouse (aal2, 3PL): get_shipment_rates() raises FORBIDDEN');

  await as(opsSrcUid, 'aal2');
  const opsSrcRates = await tryq(`select shipment_id, rate_cents from public.get_shipment_rates(${shpArr})`);
  ok(
    !opsSrcRates.err && opsSrcRates.rows.length === 1 && opsSrcRates.rows[0].shipment_id === srcShp && Number(opsSrcRates.rows[0].rate_cents) === 4100,
    'operations (aal2, SRC): get_shipment_rates() returns SRC rate only',
  );

  await as(opsUid, 'aal2');
  const opsDsRates = await tryq(`select shipment_id, rate_cents from public.get_shipment_rates(${shpArr})`);
  ok(
    !(await tryq(`select 1 from public.dropship_sourcing_links() limit 1`)).err &&
      !(await tryq(`select 1 from public.quote_carrier_rates('yunexpress', 'US', 500, 1) limit 1`)).err &&
      !opsDsRates.err &&
      opsDsRates.rows.length === 1 &&
      opsDsRates.rows[0].shipment_id === dsShp &&
      Number(opsDsRates.rows[0].rate_cents) === 5200,
    'DS operations (aal2): dropship_sourcing_links(), quote_carrier_rates(), and get_shipment_rates() (DS only) work',
  );

  await as(financeUid, 'aal2');
  const finRates = await tryq(`select shipment_id, rate_cents from public.get_shipment_rates(${shpArr}) order by rate_cents`);
  ok(
    !(await tryq(`select count(*) from public.shipping_rate_cards`)).err &&
      !(await tryq(`select count(*) from public.supplier_products`)).err &&
      !finRates.err &&
      finRates.rows.length === 2,
    'finance (aal2): can read shipping_rate_cards, supplier_products, and company-wide get_shipment_rates()',
  );

  await as(adminUid, 'aal2');
  const admRates = await tryq(`select shipment_id from public.get_shipment_rates(${shpArr})`);
  ok(!admRates.err && admRates.rows.length === 2, 'admin (aal2): get_shipment_rates() succeeds across all divisions');

  for (const [label, fn] of [
    ['content_editor (aal2)', () => as(editorUid, 'aal2')],
    ['customer', () => as(custUid, 'aal1')],
    ['anon', () => asAnon()],
  ]) {
    await fn();
    const rc = await tryq(`select 1 from public.get_shipment_carriers(${shpArr})`);
    const rr = await tryq(`select 1 from public.get_shipment_rates(${shpArr})`);
    ok(
      /FORBIDDEN|permission denied/i.test(rc.err ?? '') && /FORBIDDEN|permission denied/i.test(rr.err ?? ''),
      `${label}: both get_shipment_carriers() and get_shipment_rates() fail with FORBIDDEN`,
    );
  }

  await db.query('reset role');
  await db.query('rollback');

  // ── 3. Migrations 216+217 down -> up empty diff ──
  await db.query('begin');
  const snap = async () =>
    JSON.stringify({
      pol: await all(
        `select tablename, policyname, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'') from pg_policies where schemaname = 'public' order by 1, 2`,
      ),
      tg: await all(
        `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') order by 1, 2, 3`,
      ),
      cg: await all(
        `select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon','authenticated') order by 1, 2, 3, 4`,
      ),
      fn: await all(
        `select p.oid::regprocedure::text f, p.proacl::text a, md5(p.prosrc) s from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`,
      ),
      vw: await all(
        `select c.relname, c.reloptions::text, md5(pg_get_viewdef(c.oid)), c.relacl::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' order by 1`,
      ),
    });
  const afterBatch1 = await snap();
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000217_warehouse_shipments_permission_gate.down.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000216_batch1_whitelabel_and_support_grants.down.sql', 'utf8'));
  const downBatch1 = await snap();
  ok(
    !(await one(`select to_regclass('public.product_slug_redirects') r`)).r && downBatch1 !== afterBatch1,
    '217+216 down removes product_slug_redirects & restores prior privileges',
  );
  await db.query(fs.readFileSync('supabase/migrations/20261101000216_batch1_whitelabel_and_support_grants.sql', 'utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261101000217_warehouse_shipments_permission_gate.sql', 'utf8'));
  const upAgainBatch1 = await snap();
  ok(upAgainBatch1 === afterBatch1, '217+216 down → up produces identical schema, policies, grants, functions and views');
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}

console.log(failed ? `\nbatch1 whitelabel & support test: ${failed} failed` : '\nbatch1 whitelabel & support test: all passed');
process.exitCode = failed ? 1 : 0;
