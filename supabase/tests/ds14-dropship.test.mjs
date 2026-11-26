// Octopus Dropship · Release 6 · Step 14 (v3-only screens) — DB checks for migration *_ds14_supplier_partners_channels.
// STAGING ONLY, one rolled-back transaction, acting as suppliers / merchants / staff / the service role through JWT claims (what PostgREST does).
//  0. Structure: 9 new tables with RLS; staff + supplier tables have NO grant for signed-in users, merchant tables SELECT only, anon nothing; every function
//     search_path=public, revoked from public/anon, internals not callable; merchant-readable columns don't look internal (customer-columns rule).
//  1. Supplier isolation: a supplier sees only its own products / submissions / orders; merchants, staff, distributors, anon and a supplier whose portal is off are refused.
//  2. Stock update (auto approved), price change (review, auto rule, already pending), add product (draft → submit → review → draft dropship product),
//     bulk upload (row problems with row numbers, good rows only, 500 rows max, grouped by model number).
//  3. Orders to ship: assign refusals, address-only visibility (never merchant / prices), white-label slip, mark shipped → shipment + stage + merchant label +
//     event + store task (waiting_store), two suppliers on one order, cancelled orders, problems, staff take-back.
//  4. Approvals rules (checklist, notes), supplier application checks, portal account link.
//  5. Sales partners: invite, attach, rules (Finance / admin only), commission math in cents, months limit, idempotent, nothing faked while fees are off.
//  6. Channels: page, settings saved, connect / test / reconnect / disconnect refused with the reason, waiting list, RLS cross-tenant.
//  7. Invoicing view (filters) and Docs (register, link, status, signed path, audit).
//  8. Audit rows; every refusal for anon.
//  9. down → up → down → up: identical schema (later migrations unwound / re-applied).
// Run: node supabase/tests/ds14-dropship.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runDs14Checks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const tryq = async (q, p) => {
    await db.query('savepoint sp');
    try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
    catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
  };
  const err = async (q, p) => { lastErr = (await tryq(q, p)).err ?? ''; return lastErr; };
  const rpc = async (q, p) => (await one(q, p)).r;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const TABLES = ['dropship_supplier_submissions', 'dropship_partner_orders', 'dropship_partners', 'dropship_partner_merchants', 'dropship_partner_rules',
    'dropship_partner_commissions', 'dropship_channel_settings', 'dropship_channel_waitlist', 'dropship_product_documents'];
  const MERCHANT_TABLES = ['dropship_channel_settings', 'dropship_channel_waitlist'];
  const RPC_FNS = ['ds_sup_home', 'ds_sup_products', 'ds_sup_stock_update', 'ds_sup_price_change', 'ds_sup_save_product', 'ds_sup_bulk', 'ds_sup_submission_get',
    'ds_sup_orders', 'ds_sup_order', 'ds_sup_slip', 'ds_sup_order_ship', 'ds_sup_order_problem', 'ds_staff_approvals_page', 'ds_staff_approval_get',
    'ds_staff_approval_decide', 'ds_staff_rules_save', 'ds_staff_suppliers_page', 'ds_partner_assign', 'ds_partner_order_cancel', 'ds_supplier_link_user',
    'ds_supplier_application_checks', 'ds_partners_page', 'ds_partner_invite', 'ds_partner_set_status', 'ds_partner_attach', 'ds_partner_rule_save',
    'ds_channels_page', 'ds_channel_settings_save', 'ds_channel_action', 'ds_channel_waitlist', 'ds_staff_invoices', 'ds_docs_page', 'ds_doc_register',
    'ds_doc_link', 'ds_doc_set_status', 'ds_doc_path'];
  const INTERNAL_FNS = ['ds14_staff_can', 'ds14_assert', 'ds14_supplier', 'ds14_rules', 'ds14_cents', 'ds14_int', 'ds14_num', 'ds14_bool', 'ds14_validate_product',
    'ds14_sku_clash', 'ds14_sku_clash_other', 'ds14_bulk_group', 'ds14_apply_price', 'ds14_create_draft', 'ds14_sup_order_row', 'ds14_partner_accrue'];
  const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;

  await owner();
  // ── 0. structure ──
  const rls = await all(`select relname, relrowsecurity r from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === TABLES.length && rls.every((x) => x.r), `all ${TABLES.length} new tables exist with RLS on`);
  const grants = await all(`select table_name t, grantee g, privilege_type p from information_schema.table_privileges
     where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [TABLES]);
  ok(grants.every((g) => g.g === 'authenticated' && g.p === 'SELECT' && MERCHANT_TABLES.includes(g.t)) && MERCHANT_TABLES.every((t) => grants.some((g) => g.t === t)),
    `signed-in users: SELECT only on the ${MERCHANT_TABLES.length} merchant tables; supplier, partner and staff tables have no grant; anon nothing`);
  const pols = await all(`select tablename, cmd, qual from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(MERCHANT_TABLES.every((t) => pols.some((p) => p.tablename === t && p.cmd === 'SELECT' && /my_org_ids\(\)/.test(p.qual))) && pols.length === MERCHANT_TABLES.length,
    'merchant tables: own-organisation SELECT policy (my_org_ids()) and no other policy anywhere');
  const fns = await all(`select p.proname n, p.prosecdef d, p.proconfig::text c, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  const names = new Set(fns.map((f) => f.n));
  const missing = [...RPC_FNS, ...INTERNAL_FNS].filter((n) => !names.has(n));
  ok(missing.length === 0, `every DS14 function exists${missing.length ? ' — missing ' + missing.join(',') : ''}`);
  const noPath = fns.filter((f) => !/search_path=public/.test(f.c ?? ''));
  const notDefiner = fns.filter((f) => RPC_FNS.includes(f.n) && !f.d);
  const anonOpen = fns.filter((f) => /(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? ''));
  const internalOpen = fns.filter((f) => INTERNAL_FNS.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  const rpcClosed = fns.filter((f) => RPC_FNS.includes(f.n) && !/authenticated=X/.test(f.a ?? ''));
  ok(noPath.length === 0 && notDefiner.length === 0 && anonOpen.length === 0, `functions: search_path=public, RPCs are definers, none for public/anon${[...noPath, ...notDefiner, ...anonOpen].map((f) => ' ' + f.n).join('')}`);
  ok(internalOpen.length === 0 && rpcClosed.length === 0, `internals not callable by signed-in users; the ${RPC_FNS.length} RPCs are${[...internalOpen, ...rpcClosed].map((f) => ' ' + f.n).join('')}`);
  const cols = await all(`select table_name t, column_name c from information_schema.columns where table_schema = 'public' and table_name = any($1)`, [MERCHANT_TABLES]);
  const looksInternal = cols.filter((c) => INTERNAL_NAME.test(c.c));
  ok(looksInternal.length === 0, `no merchant-readable column looks internal (customer-columns rule)${looksInternal.length ? ' — ' + looksInternal.map((c) => `${c.t}.${c.c}`).join(', ') : ''}`);
  ok((await one(`select count(*)::int n from pg_constraint where conname = 'dropship_order_events_kind_check' and pg_get_constraintdef(oid) like '%shipped%'`)).n === 1, `order events accept the kind 'shipped'`);

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `ds14-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `DS14 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const ORG_NAME = `TEST – DS14 merchant A ${stamp}`;
  const mkMerchant = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [tag === 'ma' ? ORG_NAME : `TEST – DS14 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = excluded.started_at`, [org]);
    return { uid, org };
  };
  const mkSupplier = async (tag, portal = true) => {
    await owner();
    const uid = await mkUser(`sup-${tag}`, 'supplier');
    const s = await one(`insert into suppliers (legal_name, country, verified, user_id) values ($1, 'CN', true, $2) returning id, code`, [`TEST DS14 supplier ${tag} ${stamp}`, uid]);
    await db.query(`insert into supplier_switches (supplier_id, portal_login) values ($1, $2) on conflict (supplier_id) do update set portal_login = excluded.portal_login`, [s.id, portal]);
    return { uid, id: s.id, code: s.code, name: `TEST DS14 supplier ${tag} ${stamp}` };
  };
  const admin = await mkUser('admin', 'admin');
  const A = await mkMerchant('ma');
  const B = await mkMerchant('mb');
  const S1 = await mkSupplier('one');
  const S2 = await mkSupplier('two');
  const S3 = await mkSupplier('off', false);
  const dist = await mkUser('dist', 'distributor');
  await db.query(`insert into distributor_suppliers (distributor_id, supplier_id) values ($1, $2)`, [dist, S1.id]);
  const feats = (await one(`select value from site_settings where key = 'dropship_features'`))?.value ?? null;
  const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
    'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
  await db.query(`insert into site_settings (key, value, is_public) values ('dropship_features', $1::jsonb, false) on conflict (key) do update set value = excluded.value`, [JSON.stringify(ALL_ON)]);
  const rulesBefore = (await one(`select value from site_settings where key = 'dropship_supplier_rules'`))?.value ?? null;
  await db.query(`delete from site_settings where key = 'dropship_supplier_rules'`);

  const prodId = (await one(`select id from products order by created_at limit 1`)).id;
  const mkSp = async (S, stock) => (await one(`insert into supplier_products (supplier_id, product_id, supplier_model, stock_qty) values ($1, $2, $3, $4) returning id`, [S.id, prodId, `M-${S.code}`, stock])).id;
  const sp1 = await mkSp(S1, 5);
  const sp2 = await mkSp(S2, 7);
  const mkPrice = async (S, minor) => (await one(`insert into supplier_product_prices (supplier_id, product_id, incoterm, moq_tier_min, variant_label, price_minor, currency, valid_from)
     values ($1, $2, 'EXW', 1, '', $3, 'USD', current_date - 30) returning id`, [S.id, prodId, minor])).id;
  const price1 = await mkPrice(S1, 1000);
  await mkPrice(S2, 2000);

  // partner products + orders
  // a product's supplier is its variants' supplier_product_id (dropship_products.supplier_id / supplier_sku are frozen)
  const mkDsProduct = async (S, spId) => {
    const p = await one(`insert into dropship_products (title, description, category, weight_g, dimensions_cm, source_type, origin_country, status, is_test)
      values ($1, 'Test partner product', 'Pets', 400, '{"l":20,"w":10,"h":8}'::jsonb, 'partner_supplier', 'CN', 'draft', true) returning id, model_no`, [`DS14 test product ${S.code} ${stamp}`]);
    const v = await one(`insert into dropship_variants (product_id, options, cost_cents, supplier_product_id) values ($1, '{"Colour":"Black"}'::jsonb, 0, $2) returning id, item_id, model_no`, [p.id, spId]);
    return { product_id: p.id, pmodel: p.model_no, variant_id: v.id, item_id: v.item_id, model_no: v.model_no, sku: `M-${S.code}` };
  };
  const dp1 = await mkDsProduct(S1, sp1);
  const dp2 = await mkDsProduct(S2, sp2);
  const own = await one(`insert into dropship_products (title, description, category, weight_g, source_type, status, is_test) values ($1, 'own', 'Pets', 300, 'own_warehouse', 'draft', true) returning id`, [`DS14 own ${stamp}`]);
  const ownV = await one(`insert into dropship_variants (product_id, options, cost_cents) values ($1, '{}'::jsonb, 0) returning id, item_id, model_no`, [own.id]);
  const EXT = `#EXT-${stamp}`;
  const mkOrder = async (items, o = {}) => {
    const so = (await one(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, buyer_phone, shipping_address, destination_country, buyer_currency,
        shipping_method, incoterm, product_cents, processing_cents, shipping_cents, total_cents, payment_state, staff_stage, merchant_status)
      values ($1, 'shopify', $2, $3, 'Ben Meyer', '+33123456789', $4::jsonb, 'FR', 'USD', 'standard', 'DDP', 4321, 100, 200, 4621, $5, $6, $7) returning id, order_number`,
      [A.org, `X-${stamp}-${Math.random().toString(36).slice(2, 6)}`, EXT,
       JSON.stringify({ line1: '5 Rue Test', line2: 'Apt 2', city: 'Paris', postcode: '75001', country: 'FR', company: `${ORG_NAME} warehouse`, note: 'merchant-secret-note' }),
       o.paid === false ? 'unpaid' : 'paid', o.stage ?? 'paid_to_assign', o.paid === false ? 'awaiting_payment' : 'processing'])).id;
    for (const it of items) {
      await db.query(`insert into store_order_items (store_order_id, product_id, variant_id, item_id, model_no, title_snapshot, variant_label, fulfilment_type, qty, unit_product_cents, line_product_cents, buyer_unit_price_cents, declared_usd_cents)
        values ($1, $2, $3, $4, $5, 'Test product', 'Black', 'extended_catalog', $6, 1000, $6 * 1000, 2000, 2000)`, [so, it.product_id, it.variant_id, it.item_id, it.model_no, it.qty ?? 1]);
    }
    return so;
  };

  // ── 1. supplier isolation ──
  await as(S1.uid);
  const home = await rpc(`select ds_sup_home() r`);
  ok(home.supplier_code === S1.code && Number(home.to_ship) === 0, 'supplier home: own supplier, nothing to ship yet');
  const prods1 = await rpc(`select ds_sup_products() r`);
  ok(prods1.products.length === 1 && prods1.products[0].id === sp1 && prods1.products[0].prices.length === 1 && Number(prods1.products[0].prices[0].price_minor) === 1000, 'supplier 1 sees only its own product with its own price');
  await as(S2.uid);
  const prods2 = await rpc(`select ds_sup_products() r`);
  ok(prods2.products.length === 1 && prods2.products[0].id === sp2, 'supplier 2 sees only its own product');
  ok(/NOT_FOUND/.test(await err(`select ds_sup_stock_update($1, 3)`, [sp1])), 'supplier 2 cannot change supplier 1 stock');
  ok(/NOT_FOUND/.test(await err(`select ds_sup_price_change($1, 1500)`, [price1])), 'supplier 2 cannot change supplier 1 price');
  for (const [who, uid, aal] of [['merchant', A.uid, 'aal1'], ['staff admin', admin, 'aal2'], ['distributor assigned to supplier 1', dist, 'aal2'], ['supplier with the portal off', S3.uid, 'aal1']]) {
    await as(uid, aal);
    ok(/SUPPLIER_ONLY/.test(await err(`select ds_sup_products()`)) && /SUPPLIER_ONLY/.test(await err(`select ds_sup_orders()`)), `${who}: refused by the supplier RPCs`);
  }
  await as(S1.uid);
  ok(/permission denied/.test(await err(`select count(*) from dropship_supplier_submissions`)) && /permission denied/.test(await err(`select * from dropship_partner_orders`))
    && /permission denied/.test(await err(`select * from dropship_partners`)), 'supplier: no direct table reads (RPC only)');
  ok(/permission denied|FORBIDDEN/.test(await err(`insert into dropship_supplier_submissions (supplier_id, kind, summary) values ($1, 'new_product', 'x')`, [S1.id])), 'supplier: no direct table writes');
  await as(null, 'aal1', 'anon');
  ok(/permission denied/.test(await err(`select ds_sup_home()`)) && /permission denied/.test(await err(`select ds_partners_page()`)) && /permission denied/.test(await err(`select ds_channels_page()`)), 'anon: no supplier, staff or merchant RPC');

  // ── 2a. stock update ──
  await as(S1.uid);
  const st = await rpc(`select ds_sup_stock_update($1, 0) r`, [sp1]);
  ok(st.status === 'auto_approved' && st.stock_qty === 0, 'stock update is auto approved');
  const home0 = await rpc(`select ds_sup_home() r`);
  ok(Number(home0.out_of_stock) === 1 && home0.attention.some((t) => /out of stock/.test(t)), 'out of stock shows in "needs your attention"');
  ok(/BAD_STOCK/.test(await err(`select ds_sup_stock_update($1, -1)`, [sp1])), 'negative stock refused');
  await owner();
  ok(Number((await one(`select stock_qty from supplier_products where id = $1`, [sp1])).stock_qty) === 0 && (await one(`select count(*)::int n from audit_log where action = 'supplier_product.stock_updated' and entity_id = $1`, [sp1])).n >= 1, 'sourcing stock changed and audited');

  // ── 2b. price change ──
  await as(S1.uid);
  const pc1 = await rpc(`select ds_sup_price_change($1, 1100) r`, [price1]);
  ok(pc1.status === 'submitted' && Number(pc1.pct) === 10, 'no auto rule set: every price change goes to review (10%)');
  ok(/ALREADY_PENDING/.test(await err(`select ds_sup_price_change($1, 1200)`, [price1])), 'a second change while one is pending is refused');
  ok(/NO_CHANGE/.test(await err(`select ds_sup_price_change($1, 1000)`, [price1])) && /BAD_PRICE/.test(await err(`select ds_sup_price_change($1, 0)`, [price1])), 'same / zero price refused');
  await as(admin, 'aal2');
  const queue = await rpc(`select ds_staff_approvals_page('review') r`);
  const pcRow = queue.rows.find((r) => r.id === pc1.id);
  ok(pcRow && pcRow.supplier_code === S1.code && pcRow.kind === 'price_change', 'staff Approvals lists it with the supplier (staff may see names)');
  await rpc(`select ds_staff_approval_decide($1, 'approve', null, '{}'::jsonb) r`, [pc1.id]);
  await owner();
  const prices = await all(`select price_minor, is_superseded, valid_from from supplier_product_prices where supplier_id = $1 order by is_superseded desc, created_at`, [S1.id]);
  ok(prices.length === 2 && prices[0].is_superseded && Number(prices[0].price_minor) === 1000 && Number(prices[1].price_minor) === 1100, 'approved: the old tier is superseded and a new price starts');
  await as(admin, 'aal2');
  ok(/BAD_RULE/.test(await err(`select ds_staff_rules_save(75, 3)`)), 'auto rule above 50% refused');
  await rpc(`select ds_staff_rules_save(10, 3) r`);
  await as(S1.uid);
  const price1b = (await rpc(`select ds_sup_products() r`)).products[0].prices[0].id;
  const small = await rpc(`select ds_sup_price_change($1, 1155) r`, [price1b]);
  ok(small.status === 'auto_approved', 'rule 10%: a 5% change is applied at once');
  const big = await rpc(`select ds_sup_price_change($1, 1500) r`, [price1b]);
  ok(big.status === 'submitted', 'rule 10%: a 36% change goes to review');
  await as(admin, 'aal2');
  await rpc(`select ds_staff_approval_decide($1, 'reject', 'Too big a jump, send a quote first', '{}'::jsonb) r`, [big.id]);
  await owner();
  ok(Number((await one(`select price_minor from supplier_product_prices where supplier_id = $1 and not is_superseded`, [S1.id])).price_minor) === 1155, 'rejected change leaves the price alone');

  // ── 2c. add product ──
  const good = (sku, over = {}) => ({
    name: `Pet water fountain ${stamp}`, category: 'Pets', brand: 'Acme', description: 'Quiet fountain for cats and small dogs.', supplier_sku: sku,
    variants: [{ option: 'Black', sku: `${sku}-BLK`, cost_cents: 690, stock: 40, weight_g: 420 }, { option: 'White', sku: `${sku}-WHT`, cost_cents: 690, stock: 25, weight_g: 420 }],
    images: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg', 'https://img.example.com/3.jpg'],
    package: { weight_g: 520, length_cm: 22, width_cm: 15, height_cm: 14 }, handling_days: 3,
    customs: { hs_code: '8413.81', origin: 'CN', description_en: 'Electric pet water fountain', battery: false, liquid: false }, terms: { moq: 10, lead_days: 5 }, ...over });
  await as(S1.uid);
  const SKU_A = `FNT-${stamp}`;
  const d0 = await rpc(`select ds_sup_save_product(null, $1::jsonb, false) r`, [JSON.stringify({ name: 'Draft only', supplier_sku: `DR-${stamp}` })]);
  ok(d0.status === 'draft', 'a draft needs only a name and a model number');
  ok(/INVALID.*Variants/.test(await err(`select ds_sup_save_product(null, $1::jsonb, true)`, [JSON.stringify({ name: 'Draft only', supplier_sku: `DR2-${stamp}` })])), 'submitting an incomplete product names the problems');
  ok(/INVALID.*HS code/.test(await err(`select ds_sup_save_product(null, $1::jsonb, true)`, [JSON.stringify(good(`HS-${stamp}`, { customs: { hs_code: '12', origin: 'CN', description_en: 'Pet fountain' } }))])), 'HS code is checked');
  ok(/INVALID.*3 image/.test(await err(`select ds_sup_save_product(null, $1::jsonb, true)`, [JSON.stringify(good(`IM-${stamp}`, { images: ['https://x.example.com/1.jpg'] }))])), 'three images are needed');
  const sub = await rpc(`select ds_sup_save_product(null, $1::jsonb, true) r`, [JSON.stringify({ ...good(SKU_A), status: 'approved', supplier_id: S2.id })]);
  ok(sub.status === 'submitted', 'a complete product is submitted for review (status / supplier keys in the form are ignored)');
  await owner();
  const subRow = await one(`select status, supplier_id, payload from dropship_supplier_submissions where id = $1`, [sub.id]);
  ok(subRow.status === 'submitted' && subRow.supplier_id === S1.id && !('status' in subRow.payload) && !('supplier_id' in subRow.payload), 'the stored submission is the caller\'s own, not what the form claimed');
  await as(S2.uid);
  ok(/INVALID.*already used/.test(await err(`select ds_sup_save_product(null, $1::jsonb, true)`, [JSON.stringify(good(SKU_A))])), 'a model number used by another supplier\'s open submission is refused');
  ok(/NOT_FOUND/.test(await err(`select ds_sup_submission_get($1)`, [sub.id])), 'supplier 2 cannot open supplier 1\'s submission');
  await as(S1.uid);
  ok(/LOCKED/.test(await err(`select ds_sup_save_product($1, $2::jsonb, true)`, [sub.id, JSON.stringify(good(SKU_A))])), 'a submitted product is locked while it is in review');
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_staff_approvals_page('review')`)), 'merchant: refused by Approvals');
  await as(S1.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_staff_approvals_page('review')`)), 'supplier: refused by Approvals');
  await as(admin, 'aal2');
  const det = await rpc(`select ds_staff_approval_get($1) r`, [sub.id]);
  ok(det.auto.ids_unique && det.auto.hs_present && det.auto.size_present && det.auto.images_present && det.supplier_code === S1.code, 'review: automatic checks pass for a complete product');
  ok(/CHECKLIST_OPEN/.test(await err(`select ds_staff_approval_decide($1, 'approve', null, '{"images_clean":true}'::jsonb)`, [sub.id])), 'approve needs the whole checklist');
  ok(/NOTE_REQUIRED/.test(await err(`select ds_staff_approval_decide($1, 'changes', '', '{}'::jsonb)`, [sub.id])) && /NOTE_REQUIRED/.test(await err(`select ds_staff_approval_decide($1, 'reject', ' ', '{}'::jsonb)`, [sub.id])), 'ask for changes / reject need a note to the supplier');
  await rpc(`select ds_staff_approval_decide($1, 'changes', 'Add a clearer main image', '{}'::jsonb) r`, [sub.id]);
  await as(S1.uid);
  const home1 = await rpc(`select ds_sup_home() r`);
  ok(home1.attention.some((t) => /clearer main image/.test(t)), 'the supplier sees the note under "needs your attention"');
  const re = await rpc(`select ds_sup_save_product($1, $2::jsonb, true) r`, [sub.id, JSON.stringify(good(SKU_A))]);
  ok(re.status === 'submitted', 'after "changes asked" the supplier edits and sends again');
  await as(admin, 'aal2');
  const CHK = JSON.stringify({ images_clean: true, ids_unique: true, hs_ok: true, size_ok: true, flags_ok: true, cost_ok: true });
  const appr = await rpc(`select ds_staff_approval_decide($1, 'approve', 'Welcome', $2::jsonb) r`, [sub.id, CHK]);
  ok(appr.status === 'approved' && appr.product_ids.length === 1, 'approved: one draft product made');
  await owner();
  const made = await one(`select p.status, p.source_type, p.supplier_id, p.supplier_sku, p.origin_country, p.min_order_qty, (select count(*) from dropship_variants v where v.product_id = p.id)::int vars,
      (select min(i.hs_code) from dropship_variants v join item_master i on i.id = v.item_id where v.product_id = p.id) hs,
      (select bool_or(i.hs_verified) from dropship_variants v join item_master i on i.id = v.item_id where v.product_id = p.id) hs_verified
    from dropship_products p where p.id = $1`, [appr.product_ids[0]]);
  ok(made.status === 'draft' && made.source_type === 'partner_supplier' && made.supplier_id === null && made.supplier_sku === null && made.vars === 2 && made.min_order_qty === 10, 'the draft is a partner-supplier product with its variants and no supplier yet: staff link each variant to Sourcing, then the publish checklist applies');
  ok((await one(`select product_ids from dropship_supplier_submissions where id = $1`, [sub.id])).product_ids.includes(appr.product_ids[0]), 'the submission keeps which draft it made (the supplier trail)');
  ok(made.hs === '841381' && made.hs_verified === false, 'the supplier HS code is only a suggestion: not verified');
  await as(admin, 'aal2');
  ok(/NOT_OPEN/.test(await err(`select ds_staff_approval_decide($1, 'reject', 'again', '{}'::jsonb)`, [sub.id])), 'a decided item cannot be decided again');

  // ── 2d. bulk upload ──
  const row = (n, over = {}) => ({ model_number: `BLK-${n}-${stamp}`, product_name: `Bulk product ${n}`, category: 'Pets', brand: 'Acme', description: 'A good bulk product description.', variant_option: 'Default',
    variant_sku: `BLK-${n}-V1-${stamp}`, cost: '6.90', stock: '10', weight_g: '300', length_cm: '10', width_cm: '8', height_cm: '6', hs_code: '392690', country_of_origin: 'CN',
    battery: 'no', liquid: 'no', image_links: 'https://i.example.com/a.jpg|https://i.example.com/b.jpg|https://i.example.com/c.jpg', handling_days: '3', ...over });
  const rows = [row(1), row(2, { hs_code: '' }), row(3, { cost: 'abc' }), row(1, { variant_option: 'Blue', variant_sku: `BLK-1-V2-${stamp}` }), row(5, { model_number: SKU_A }), row(6, { variant_sku: `BLK-1-V1-${stamp}` }), row(7, { length_cm: 'ten' })];
  await as(S1.uid);
  const pre = await rpc(`select ds_sup_bulk($1::jsonb, 'x.csv', false) r`, [JSON.stringify(rows)]);
  const probRows = new Set(pre.problems.map((p) => p.row));
  ok(pre.total_rows === 7 && pre.good_rows === 2 && [3, 4, 6, 7, 8].every((n) => probRows.has(n)) && !probRows.has(2) && !probRows.has(5), 'preview: row numbers (header is row 1) with a plain problem each; 2 good rows');
  ok(pre.problems.some((p) => p.row === 3 && /HS code/.test(p.problem)) && pre.problems.some((p) => p.row === 4 && /Variant cost/.test(p.problem)) && pre.problems.some((p) => p.row === 6 && /already used/.test(p.problem)) && pre.problems.some((p) => p.row === 7 && /twice|earlier row/.test(p.problem)), 'problems: missing HS code, bad cost, model number used, repeated variant SKU');
  ok(pre.products.length === 1 && pre.products[0].variants.length === 2, 'good rows with the same model number become one product with two variants');
  ok(/EMPTY_FILE/.test(await err(`select ds_sup_bulk('[]'::jsonb, 'x', false)`)) && /TOO_MANY_ROWS/.test(await err(`select ds_sup_bulk($1::jsonb, 'x', false)`, [JSON.stringify(Array.from({ length: 501 }, (_, i) => row(i + 100)))])), 'empty file and more than 500 rows refused');
  ok(/NO_GOOD_ROWS/.test(await err(`select ds_sup_bulk($1::jsonb, 'x', true)`, [JSON.stringify([row(9, { hs_code: '' })])])), 'nothing to submit when no row is good');
  const bulk = await rpc(`select ds_sup_bulk($1::jsonb, 'x.csv', true) r`, [JSON.stringify(rows)]);
  ok(bulk.id && bulk.good_rows === 2, 'submit saves the good rows as one submission');
  await as(admin, 'aal2');
  const bAppr = await rpc(`select ds_staff_approval_decide($1, 'approve', null, $2::jsonb) r`, [bulk.id, CHK]);
  ok(bAppr.product_ids.length === 1, 'approving the bulk upload makes one draft per model number');

  // ── 3. orders to ship ──
  await owner();
  const oUnpaid = await mkOrder([dp1], { paid: false, stage: 'unpaid' });
  const oMixed = await mkOrder([dp1, { product_id: own.id, variant_id: ownV.id, item_id: ownV.item_id, model_no: ownV.model_no }]);
  const oMain = await mkOrder([{ ...dp1, qty: 2 }]);
  const oTwo = await mkOrder([dp1, dp2]);
  const oOff = await (async () => { const sp3 = await mkSp(S3, 1); const d = await mkDsProduct(S3, sp3); return mkOrder([d]); })();
  await as(admin, 'aal2');
  ok(/NOT_READY/.test(await err(`select ds_partner_assign($1)`, [oUnpaid])), 'assign: an unpaid order is refused');
  ok(/MIXED_ORDER/.test(await err(`select ds_partner_assign($1)`, [oMixed])), 'assign: an order with warehouse items is refused (warehouse path)');
  ok(/SUPPLIER_PORTAL_OFF/.test(await err(`select ds_partner_assign($1)`, [oOff])), 'assign: a supplier without an active portal is refused');
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_partner_assign($1)`, [oMain])), 'merchant cannot assign');
  await as(admin, 'aal2');
  const sug = await rpc(`select ds_staff_suppliers_page() r`);
  ok(sug.unassigned.some((u) => u.id === oMain) && !sug.unassigned.some((u) => u.id === oUnpaid), 'staff Suppliers lists paid partner orders waiting for assignment');
  ok(Number((await rpc(`select ds_partner_assign($1) r`, [oMain])).suppliers) === 1, 'assign: one supplier row');
  await owner();
  ok((await one(`select staff_stage from store_orders where id = $1`, [oMain])).staff_stage === 'sourcing', 'staff stage → sourcing (merchant still sees Processing)');
  await as(admin, 'aal2');
  ok(Number((await rpc(`select ds_partner_assign($1) r`, [oTwo])).suppliers) === 2, 'assign: an order with two suppliers makes two rows');
  await as(S1.uid);
  const ol = await rpc(`select ds_sup_orders() r`);
  const mine = ol.orders.find((o) => o.country === 'FR' && o.items.some((i) => i.qty === 2));
  ok(ol.orders.length === 2 && mine && mine.status === 'to_ship', 'supplier 1 sees its two orders to ship');
  const detail = await rpc(`select ds_sup_order($1) r`, [mine.id]);
  ok(detail.ship_to.name === 'Ben Meyer' && detail.ship_to.line1 === '5 Rue Test' && detail.ship_to.city === 'Paris' && detail.ship_to.postcode === '75001' && detail.ship_to.country === 'FR' && detail.ship_to.phone === '+33123456789', 'order detail: the buyer address for shipping');
  ok(JSON.stringify(Object.keys(detail.ship_to).sort()) === JSON.stringify(['city', 'country', 'line1', 'line2', 'name', 'phone', 'postcode', 'region']), 'the address is a fixed list of fields (nothing else from the order leaks)');
  const blob = JSON.stringify([ol, detail]);
  ok(!(blob.includes(ORG_NAME) || blob.includes(EXT) || blob.includes('merchant-secret-note') || blob.includes('warehouse')), 'supplier output has no merchant name, store order name or merchant note');
  ok(!/"(org_id|org|external|price|cents|total|merchant|buyer_unit|store)[a-z_]*"/i.test(blob), 'supplier output has no organisation, store order, price or total fields');
  ok(detail.items.length === 1 && detail.items[0].qty === 2 && detail.items[0].sku === dp1.sku, 'only the supplier\'s own items, with its own SKU');
  await as(S2.uid);
  ok(/NOT_FOUND/.test(await err(`select ds_sup_order($1)`, [mine.id])) && /NOT_FOUND/.test(await err(`select ds_sup_slip($1)`, [mine.id])) && /NOT_FOUND/.test(await err(`select ds_sup_order_ship($1, 'yunexpress', null, 'YT1234567890')`, [mine.id])), 'supplier 2 cannot open, print or ship supplier 1\'s order');
  await as(S1.uid);
  ok(/SLIP_FIRST/.test(await err(`select ds_sup_order_ship($1, 'yunexpress', null, 'YT1234567890')`, [mine.id])), 'mark shipped needs the Octopus packing slip first');
  const slip = await rpc(`select ds_sup_slip($1) r`, [mine.id]);
  ok(slip.order && slip.items.length === 1 && slip.ship_to.city === 'Paris' && !/price|cents|total|supplier|org/i.test(JSON.stringify(Object.keys(slip))) && !JSON.stringify(slip).includes(ORG_NAME), 'slip data: order reference, ship to, items and quantities only');
  ok(/BAD_TRACKING/.test(await err(`select ds_sup_order_ship($1, 'yunexpress', null, 'ab c')`, [mine.id])) && /BAD_CARRIER/.test(await err(`select ds_sup_order_ship($1, 'dhl', null, 'YT1234567890')`, [mine.id]))
    && /BAD_CARRIER/.test(await err(`select ds_sup_order_ship($1, 'other', '', 'YT1234567890')`, [mine.id])), 'tracking number and carrier are checked');
  const shipped = await rpc(`select ds_sup_order_ship($1, 'yunexpress', null, 'YT1234567890') r`, [mine.id]);
  ok(shipped.status === 'shipped' && shipped.all_shipped === true, 'mark shipped');
  await owner();
  const sh = await one(`select s.carrier_code, s.tracking_no, s.store_order_id, s.tracking_token from shipments s where s.store_order_id = $1`, [oMain]);
  const so = await one(`select staff_stage, merchant_status from store_orders where id = $1`, [oMain]);
  ok(sh && sh.carrier_code === 'yunexpress' && sh.tracking_no === 'YT1234567890' && /^[0-9a-f]{32,64}$/.test(sh.tracking_token), 'a shipment with the tracking number and a public tracking token exists');
  ok(so.staff_stage === 'handed_over' && so.merchant_status === 'shipped', 'order status feeds through: staff handed over, merchant label Shipped');
  const ev = await one(`select kind, title, body from dropship_order_events where store_order_id = $1 and kind = 'shipped'`, [oMain]);
  ok(ev && /YT1234567890/.test(ev.body) && !new RegExp(`${S1.code}|TEST DS14 supplier`).test(JSON.stringify(ev)), 'merchant timeline: Shipped with the tracking number, never the supplier');
  const task = await one(`select status, detail from dropship_channel_tasks where store_order_id = $1 and action = 'update_tracking'`, [oMain]);
  ok(task && task.status === 'waiting_store' && task.detail.tracking[0].tracking_no === 'YT1234567890', 'store sync task: update_tracking waiting_store (honest: nothing is sent until the store connection exists)');
  await as(S1.uid);
  ok(/NOT_OPEN/.test(await err(`select ds_sup_order_ship($1, 'yunexpress', null, 'YT1234567891')`, [mine.id])), 'a shipped order cannot be shipped again');
  ok((await rpc(`select ds_sup_orders() r`)).orders.find((o) => o.id === mine.id).tracking_no === 'YT1234567890', 'the Shipped tab shows the tracking number');
  // two suppliers on one order
  const two1 = (await rpc(`select ds_sup_orders() r`)).orders.find((o) => o.id !== mine.id);
  await rpc(`select ds_sup_slip($1) r`, [two1.id]);
  const s1ship = await rpc(`select ds_sup_order_ship($1, 'other', 'Local Express', 'LE-998877') r`, [two1.id]);
  ok(s1ship.all_shipped === false, 'two suppliers: the order is not shipped until both have shipped');
  await owner();
  const t1 = await one(`select staff_stage, (select count(*)::int from dropship_order_events where store_order_id = $1 and kind = 'shipped') n from store_orders where id = $1`, [oTwo]);
  ok(t1.staff_stage === 'sourcing' && t1.n === 0, `two suppliers: no Shipped label after the first (stage ${t1.staff_stage}, events ${t1.n})`);
  await as(S2.uid);
  const two2 = (await rpc(`select ds_sup_orders() r`)).orders[0];
  await rpc(`select ds_sup_slip($1) r`, [two2.id]);
  ok((await rpc(`select ds_sup_order_ship($1, '4px', null, 'FPX-445566') r`, [two2.id])).all_shipped === true, 'two suppliers: the second shipment completes the order');
  await owner();
  ok((await one(`select merchant_status from store_orders where id = $1`, [oTwo])).merchant_status === 'shipped' && (await one(`select count(*)::int n from dropship_channel_tasks where store_order_id = $1 and action = 'update_tracking'`, [oTwo])).n === 1
    && (await one(`select jsonb_array_length(detail -> 'tracking')::int n from dropship_channel_tasks where store_order_id = $1 and action = 'update_tracking'`, [oTwo])).n === 2, 'two suppliers: Shipped once, one store task with both tracking numbers');
  // cancelled order + problem + take back
  await owner();
  const oCancel = await mkOrder([dp1]);
  const oProb = await mkOrder([dp1]);
  const oBack = await mkOrder([dp1]);
  await as(admin, 'aal2');
  for (const o of [oCancel, oProb, oBack]) await rpc(`select ds_partner_assign($1) r`, [o]);
  await owner();
  await db.query(`update store_orders set cancelled_at = now(), merchant_status = 'cancelled', staff_stage = 'cancelled' where id = $1`, [oCancel]);
  await as(S1.uid);
  const ol2 = (await rpc(`select ds_sup_orders() r`)).orders;
  const canc = ol2.find((o) => o.status === 'cancelled');
  ok(canc && !ol2.some((o) => o.status === 'to_ship' && o.id === canc.id), 'a store order cancelled after assignment shows as Cancelled, never "to ship"');
  ok(/ORDER_CANCELLED/.test(await err(`select ds_sup_slip($1)`, [canc.id])) && /ORDER_CANCELLED/.test(await err(`select ds_sup_order_ship($1, 'yunexpress', null, 'YT7777777777')`, [canc.id])), 'a cancelled order cannot be printed or shipped');
  const probOrder = ol2.find((o) => o.status === 'to_ship');
  ok(/NOTE_REQUIRED/.test(await err(`select ds_sup_order_problem($1, 'x')`, [probOrder.id])), 'a problem needs a note');
  await rpc(`select ds_sup_order_problem($1, 'Out of stock until next week') r`, [probOrder.id]);
  await as(admin, 'aal2');
  const sg = await rpc(`select ds_staff_suppliers_page() r`);
  ok(sg.partner_orders.some((p) => p.status === 'problem' && /Out of stock/.test(p.problem_note)), 'staff see the problem and the note');
  ok(/REASON_REQUIRED/.test(await err(`select ds_partner_order_cancel($1, '')`, [probOrder.id])), 'take back needs a reason');
  const backId = sg.partner_orders.find((p) => p.order && p.status === 'problem').id;
  await rpc(`select ds_partner_order_cancel($1, 'Supplier is out of stock') r`, [backId]);
  await owner();
  ok((await one(`select staff_stage from store_orders where id = (select store_order_id from dropship_partner_orders where id = $1)`, [backId])).staff_stage === 'paid_to_assign', 'taken back: the order returns to "paid, to assign"');

  // ── 4. supplier applications and portal accounts ──
  await owner();
  const app = await one(`insert into supplier_applications (company_name, uscc, city, categories, contact_name, contact_email, website, status, ip_country)
    values ($1, '91440300MA5ABCDE12', 'Shenzhen', '{pets}', 'Li Wei', $2, 'https://acme.example.com', 'submitted', 'CN') returning id`, [`DS14 Applicant ${stamp}`, `applicant-${stamp}@test.local`]);
  await as(admin, 'aal2');
  const chk = await rpc(`select ds_supplier_application_checks($1) r`, [app.id]);
  ok(chk.length === 6 && chk.find((c) => c.key === 'uscc').ok && !chk.find((c) => c.key === 'sheet').ok && chk.find((c) => c.key === 'no_duplicate').ok && chk.find((c) => c.key === 'country').ok, 'application checks: USCC, online presence, sheet, duplicates, email, country');
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_supplier_application_checks($1)`, [app.id])), 'merchant: refused by application checks');
  await owner();
  const newSup = (await one(`insert into suppliers (legal_name, country, verified) values ($1, 'CN', true) returning id`, [`DS14 Linked ${stamp}`])).id;
  const unver = (await one(`insert into suppliers (legal_name, country, verified) values ($1, 'CN', false) returning id`, [`DS14 Unverified ${stamp}`])).id;
  const newUser = await mkUser('newsup');
  const merchantUser = A.uid;
  await as(admin, 'aal2');
  ok(/NOT_VERIFIED/.test(await err(`select ds_supplier_link_user($1, $2)`, [unver, newUser])), 'link: an unverified supplier gets no portal account');
  ok(/USER_TAKEN/.test(await err(`select ds_supplier_link_user($1, $2)`, [newSup, merchantUser])) && /USER_TAKEN/.test(await err(`select ds_supplier_link_user($1, $2)`, [newSup, admin])), 'link: a merchant or staff login cannot be a supplier login');
  await rpc(`select ds_supplier_link_user($1, $2) r`, [newSup, newUser]);
  await owner();
  const lk = await one(`select (select user_id from suppliers where id = $1) u, (select portal_login from supplier_switches where supplier_id = $1) p, exists (select 1 from user_roles where user_id = $2 and role_code = 'supplier') r`, [newSup, newUser]);
  ok(lk.u === newUser && lk.p === true && lk.r === true, 'link: user, supplier role and portal switch set');
  await as(admin, 'aal2');
  ok(/ALREADY_LINKED/.test(await err(`select ds_supplier_link_user($1, $2)`, [newSup, newUser])), 'link: only once');
  await as(newUser);
  ok((await rpc(`select ds_sup_home() r`)).supplier_code, 'the new supplier account opens the portal');

  // ── 5. sales partners ──
  await owner();
  const PLAN = `ds14${Date.now().toString(36)}`;
  await db.query(`insert into dropship_plans (code, name, price_cents, active) values ($1, 'DS14 test plan', 4900, false)`, [PLAN]);
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_partners_page()`)) && /FORBIDDEN/.test(await err(`select ds_partner_invite('{"name":"X Agency","contact_email":"x@y.com"}'::jsonb)`)), 'merchant: refused by Sales partners');
  await as(S1.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_partners_page()`)), 'supplier: refused by Sales partners');
  await as(admin, 'aal2');
  const p0 = await rpc(`select ds_partners_page() r`);
  ok(p0.plan_fees_on === false && p0.default_rule === null, 'fees off and no rule: the page says so (nothing faked)');
  const inv = await rpc(`select ds_partner_invite($1::jsonb) r`, [JSON.stringify({ name: `DS14 Agency ${stamp}`, kind: 'agency', contact_name: 'Dana', contact_email: `agency-${stamp}@test.local` })]);
  ok(/^PTR-\d{4,}$/.test(inv.code), 'invite: a partner code is issued');
  ok(/DUPLICATE/.test(await err(`select ds_partner_invite($1::jsonb)`, [JSON.stringify({ name: 'Dup', contact_email: `AGENCY-${stamp}@test.local` })])) && /INVALID/.test(await err(`select ds_partner_invite('{"name":"X","contact_email":"nope"}'::jsonb)`)), 'invite: duplicate email and bad input refused');
  const ps = await rpc(`select ds_partners_page() r`);
  const pr = ps.partners.find((x) => x.id === inv.id);
  ok(pr && pr.status === 'invited' && Number(pr.merchants) === 0 && Number(pr.earned_cents) === 0, 'a new partner is Invited with 0 merchants and 0 earned');
  ok(ps.available_merchants.some((m) => m.id === A.org), 'merchants with Dropship on can be attached');
  await rpc(`select ds_partner_attach($1, $2) r`, [inv.id, A.org]);
  ok(/ALREADY_ATTACHED/.test(await err(`select ds_partner_attach($1, $2)`, [inv.id, A.org])), 'a merchant belongs to one partner');
  await owner();
  await db.query(`insert into dropship_plan_charges (org_id, plan_code, period_start, period_end, amount_cents, created_at) values ($1, $2, now() - interval '40 days', now() - interval '10 days', 4900, now() - interval '1 day')`, [A.org, PLAN]);
  await as(admin, 'aal2');
  ok(Number((await rpc(`select ds_partners_page() r`)).partners.find((x) => x.id === inv.id).earned_cents) === 0, 'no rule yet: no commission accrues');
  ok(/BAD_RULE/.test(await err(`select ds_partner_rule_save(null, '{"kind":"percent_of_plan_fee","rate_bps":20000,"months":12}'::jsonb)`)) && /BAD_RULE/.test(await err(`select ds_partner_rule_save(null, '{"kind":"fixed_per_merchant","months":12}'::jsonb)`)) && /BAD_RULE/.test(await err(`select ds_partner_rule_save(null, '{"kind":"percent_of_plan_fee","rate_bps":1000,"months":0}'::jsonb)`)), 'rule: rate, amount and months are checked');
  await rpc(`select ds_partner_rule_save(null, '{"kind":"percent_of_plan_fee","rate_bps":1250,"months":3}'::jsonb) r`);
  ok(Number((await rpc(`select ds_partners_page() r`)).partners.find((x) => x.id === inv.id).earned_cents) === 0, 'an Invited partner earns nothing, even with a rule');
  await rpc(`select ds_partner_set_status($1, 'active') r`, [inv.id]);
  let pg = await rpc(`select ds_partners_page() r`);
  ok(Number(pg.partners.find((x) => x.id === inv.id).earned_cents) === 0, 'a charge made before the merchant was attached earns nothing');
  await owner();
  await db.query(`insert into dropship_plan_charges (org_id, plan_code, period_start, period_end, amount_cents) values ($1, $2, now() - interval '9 days', now() + interval '21 days', 4900)`, [A.org, PLAN]);
  await as(admin, 'aal2');
  pg = await rpc(`select ds_partners_page() r`);
  ok(Number(pg.partners.find((x) => x.id === inv.id).earned_cents) === 613, '12.5% of $49.00 = 613 cents (half up)');
  pg = await rpc(`select ds_partners_page() r`);
  ok(Number(pg.partners.find((x) => x.id === inv.id).earned_cents) === 613 && Number(pg.merchants.find((m) => m.org_id === A.org).earned_cents) === 613, 'running again adds nothing (one commission per charge); the merchant row shows it too');
  await owner();
  await db.query(`insert into dropship_plan_charges (org_id, plan_code, period_start, period_end, amount_cents) values ($1, $2, now() + interval '21 days', now() + interval '51 days', 1999)`, [A.org, PLAN]);
  await as(admin, 'aal2');
  await rpc(`select ds_partner_rule_save($1, '{"kind":"percent_of_plan_fee","rate_bps":3333,"months":3}'::jsonb) r`, [inv.id]);
  pg = await rpc(`select ds_partners_page() r`);
  ok(Number(pg.partners.find((x) => x.id === inv.id).earned_cents) === 613 + 666, 'partner rule overrides the default: 33.33% of $19.99 = 666 cents');
  await owner();
  const comm = await all(`select kind, base_cents, rate_bps, amount_cents from dropship_partner_commissions where partner_id = $1 order by period_start`, [inv.id]);
  ok(comm.length === 2 && comm[0].kind === 'percent_of_plan_fee' && Number(comm[0].base_cents) === 4900 && comm[0].rate_bps === 1250 && Number(comm[1].amount_cents) === 666, 'each commission keeps the rate and base it was made with (cents)');
  await db.query(`insert into dropship_plan_charges (org_id, plan_code, period_start, period_end, amount_cents) values ($1, $2, now() + interval '51 days', now() + interval '81 days', 4900), ($1, $2, now() + interval '81 days', now() + interval '111 days', 4900)`, [A.org, PLAN]);
  await as(admin, 'aal2');
  pg = await rpc(`select ds_partners_page() r`);
  ok(Number(pg.partners.find((x) => x.id === inv.id).earned_cents) === 613 + 666 + 1633, 'months limit: the rule pays 3 months, so the 4th charge earns nothing (33.33% of $49.00 = 1633 cents)');
  // a fixed rule on a second partner
  const inv2 = await rpc(`select ds_partner_invite($1::jsonb) r`, [JSON.stringify({ name: `DS14 Influencer ${stamp}`, kind: 'influencer', contact_email: `influencer-${stamp}@test.local` })]);
  await rpc(`select ds_partner_attach($1, $2) r`, [inv2.id, B.org]);
  await rpc(`select ds_partner_rule_save($1, '{"kind":"fixed_per_merchant","fixed_cents":2500,"months":2}'::jsonb) r`, [inv2.id]);
  await rpc(`select ds_partner_set_status($1, 'active') r`, [inv2.id]);
  await owner();
  await db.query(`insert into dropship_plan_charges (org_id, plan_code, period_start, period_end, amount_cents) values ($1, $2, now() + interval '1 day', now() + interval '31 days', 4900), ($1, $2, now() + interval '31 days', now() + interval '61 days', 4900), ($1, $2, now() + interval '61 days', now() + interval '91 days', 4900)`, [B.org, PLAN]);
  await as(admin, 'aal2');
  pg = await rpc(`select ds_partners_page() r`);
  ok(Number(pg.partners.find((x) => x.id === inv2.id).earned_cents) === 5000, 'fixed rule: 2500 cents for each of 2 months, nothing for the 3rd');
  await as(admin, 'aal2');
  await rpc(`select ds_partner_set_status($1, 'paused') r`, [inv.id]);
  await rpc(`select ds_partner_set_status($1, 'ended') r`, [inv.id]);
  ok(/ENDED/.test(await err(`select ds_partner_set_status($1, 'active')`, [inv.id])), 'an ended partner cannot be changed');

  // ── 6. channels ──
  await owner();
  await db.query(`insert into store_connections (org_id, platform, shop_domain, status, connected_at) values ($1, 'shopify', $2, 'active', now())`, [A.org, `ds14-${stamp.replace(/[^a-z0-9]/g, '')}.myshopify.com`]);
  await as(A.uid);
  const ch = await rpc(`select ds_channels_page() r`);
  ok(ch.shopify.status === 'active' && /myshopify/.test(ch.shopify.shop) && ch.waitlist.length === 0 && typeof ch.billing_enabled === 'boolean', 'integrations page: Shopify shows its real connection state; others are not connected');
  ok((await rpc(`select ds_channel_settings_save('woocommerce', '{"sync_stock":false,"sync_prices":true,"send_tracking":true,"cancel_on_store_cancel":false}'::jsonb) r`)).ok === true, 'channel settings saved');
  const ch2 = await rpc(`select ds_channels_page() r`);
  ok(ch2.settings.woocommerce.sync_stock === false && ch2.settings.woocommerce.cancel_on_store_cancel === false && ch2.settings.woocommerce.send_tracking === true, 'saved settings come back');
  ok(/BAD_CHANNEL/.test(await err(`select ds_channel_settings_save('amazon', '{"sync_stock":true,"sync_prices":true,"send_tracking":true,"cancel_on_store_cancel":true}'::jsonb)`)) && /BAD_INPUT/.test(await err(`select ds_channel_settings_save('wix', '{"sync_stock":"yes","sync_prices":true,"send_tracking":true,"cancel_on_store_cancel":true}'::jsonb)`)), 'settings: unknown channel and non-boolean refused');
  for (const [c, a] of [['woocommerce', 'connect'], ['tiktok_shop', 'connect'], ['wix', 'test'], ['ebay', 'reconnect'], ['shopify', 'disconnect'], ['amazon', 'connect']]) {
    ok(/CHANNEL_NOT_OPEN: Connections open in the store-connection release/.test(await err(`select ds_channel_action($1, $2)`, [c, a])), `${c} ${a}: refused with the reason, nothing connected`);
  }
  await owner();
  ok((await one(`select count(*)::int n from store_connections where org_id = $1`, [A.org])).n === 1, 'no store connection was created or changed by a refused action');
  await as(A.uid);
  await rpc(`select ds_channel_waitlist('amazon', true) r`);
  await rpc(`select ds_channel_waitlist('amazon', true) r`);
  ok((await rpc(`select ds_channels_page() r`)).waitlist.join() === 'amazon', 'waiting list: joined once');
  await as(B.uid);
  ok((await all(`select * from dropship_channel_settings`)).length === 0 && (await all(`select * from dropship_channel_waitlist`)).length === 0 && (await rpc(`select ds_channels_page() r`)).shopify.status === 'not_connected', 'another merchant sees none of these rows');
  ok(/permission denied/.test(await err(`insert into dropship_channel_settings (org_id, channel) values ($1, 'ebay')`, [B.org])) && /permission denied/.test(await err(`update dropship_channel_settings set sync_stock = true`)), 'merchants cannot write the tables directly');
  await owner();
  ok((await one(`select count(*)::int n from dropship_channel_settings where org_id = $1`, [A.org])).n === 1 && (await one(`select count(*)::int n from dropship_channel_waitlist where org_id = $1`, [A.org])).n === 1, 'the rows exist (counted as the owner)');
  await as(A.uid);
  await rpc(`select ds_channel_waitlist('amazon', false) r`);
  ok((await rpc(`select ds_channels_page() r`)).waitlist.length === 0, 'waiting list: left');
  await as(S1.uid);
  ok(/DROPSHIP_NOT_ENABLED|FEATURE_OFF|SUPPLIER|permission/.test(await err(`select ds_channels_page()`)), 'a supplier cannot use the merchant Integrations RPC');
  await owner();
  await db.query(`update site_settings set value = value || '{"stores": false}'::jsonb where key = 'dropship_features'`);
  await as(A.uid);
  ok(/FEATURE_OFF/.test(await err(`select ds_channels_page()`)), 'feature "stores" off: Integrations refused');
  await owner();
  await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify(ALL_ON)]);

  // ── 7. invoicing + docs ──
  await owner();
  const mkDoc = async (type, num, cents, status = 'paid') => (await one(`insert into documents (org_id, doc_type, number, amount_cents, status, division_id, currency, data${type === 'credit_note' ? ', original_document_id' : ''})
    values ($1, $2, $3, $4, $5, division_id_of('DS'), 'USD', '{"kind":"plan_fee"}'::jsonb${type === 'credit_note' ? ', (select id from documents where number = $6)' : ''}) returning id`,
    type === 'credit_note' ? [B.org, type, num, cents, status, `OCT-DS-T${stamp}`] : [B.org, type, num, cents, status])).id;
  await mkDoc('commercial_invoice', `OCT-DS-T${stamp}`, 4900);
  await mkDoc('credit_note', `CN-DS-T${stamp}`, 1000);
  await mkDoc('statement', `STMT-DS-T${stamp}`, 8000, 'issued');
  await as(B.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_staff_invoices(null, null, null, null, null, 10)`)) && /FORBIDDEN/.test(await err(`select ds_docs_page(null, null)`)), 'merchant: refused by Invoicing and Docs');
  await as(S1.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_staff_invoices(null, null, null, null, null, 10)`)), 'supplier: refused by Invoicing');
  await as(admin, 'aal2');
  const all3 = await rpc(`select ds_staff_invoices(null, $1, null, null, null, 50) r`, [`T${stamp}`]);
  ok(all3.rows.length === 3 && all3.rows.every((r) => r.merchant), 'invoicing: invoices, credit notes and statements, with the merchant');
  ok((await rpc(`select ds_staff_invoices('credit_note', $1, null, null, null, 50) r`, [`T${stamp}`])).rows.length === 1 && (await rpc(`select ds_staff_invoices('statement', $1, null, null, 'issued', 50) r`, [`T${stamp}`])).rows.length === 1
    && (await rpc(`select ds_staff_invoices('invoice', $1, current_date + 2, null, null, 50) r`, [`T${stamp}`])).rows.length === 0 && (await rpc(`select ds_staff_invoices(null, $1, null, null, null, 1) r`, [`T${stamp}`])).rows.length === 1, 'invoicing filters: type, status, date, text, limit');
  ok(all3.entity === null || typeof all3.entity.legal_name === 'string', 'invoicing: the invoicing entity (read only)');
  const PATH = `${'ab'.repeat(16)}.pdf`;
  const reg = await rpc(`select ds_doc_register($1::jsonb) r`, [JSON.stringify({ product_id: dp1.product_id, kind: 'certificate', title: `CE certificate ${stamp}`, doc_number: 'CE-1', issuer: 'TUV', expires_on: '2030-01-01', storage_path: PATH, mime: 'application/pdf', size_bytes: 12345 })]);
  ok(reg.id, 'docs: a certificate is registered and linked to a product');
  ok(/INVALID/.test(await err(`select ds_doc_register($1::jsonb)`, [JSON.stringify({ kind: 'certificate', title: 'Bad path', storage_path: '../etc/passwd', mime: 'application/pdf', size_bytes: 1 })])) && /INVALID/.test(await err(`select ds_doc_register($1::jsonb)`, [JSON.stringify({ kind: 'certificate', title: 'Too big', storage_path: `${'cd'.repeat(16)}.pdf`, mime: 'application/pdf', size_bytes: 99999999 })])) && /INVALID/.test(await err(`select ds_doc_register($1::jsonb)`, [JSON.stringify({ kind: 'certificate', title: 'Exe', storage_path: `${'ef'.repeat(16)}.pdf`, mime: 'application/x-msdownload', size_bytes: 10 })])), 'docs: bad path, size and file type refused');
  let docs = await rpc(`select ds_docs_page(null, null) r`);
  ok(docs.docs.find((d) => d.id === reg.id).model_no === dp1.pmodel && docs.docs.find((d) => d.id === reg.id).status === 'pending', 'docs: listed with its product, pending');
  ok(/NOTE_REQUIRED/.test(await err(`select ds_doc_set_status($1, 'rejected', '')`, [reg.id])), 'docs: rejecting needs a note');
  await rpc(`select ds_doc_set_status($1, 'verified', null) r`, [reg.id]);
  docs = await rpc(`select ds_docs_page(null, 'verified') r`);
  ok(docs.docs.some((d) => d.id === reg.id && d.effective_status === 'verified'), 'docs: verified');
  await owner();
  await db.query(`update dropship_product_documents set expires_on = current_date - 1 where id = $1`, [reg.id]);
  await as(admin, 'aal2');
  ok((await rpc(`select ds_docs_page(null, 'expired') r`)).docs.some((d) => d.id === reg.id && d.effective_status === 'expired'), 'docs: a verified document past its expiry date shows as expired');
  await rpc(`select ds_doc_link($1, null) r`, [reg.id]);
  ok((await rpc(`select ds_docs_page(null, null) r`)).docs.find((d) => d.id === reg.id).product_id === null, 'docs: unlinked');
  await rpc(`select ds_doc_link($1, $2) r`, [reg.id, dp2.product_id]);
  ok((await rpc(`select ds_doc_path($1) r`, [reg.id])) === PATH, 'docs: the staff check returns the file path for a signed link');
  ok(/NOT_FOUND/.test(await err(`select ds_doc_link($1, gen_random_uuid())`, [reg.id])), 'docs: linking to an unknown product refused');
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_doc_path($1)`, [reg.id])) && /permission denied/.test(await err(`select * from dropship_product_documents`)), 'merchant: no document path and no table read');

  // ── 8. audit ──
  await owner();
  const audits = await all(`select distinct action from audit_log where action like 'ds\\_%' and created_at > now() - interval '1 hour'`);
  const have = new Set(audits.map((a) => a.action));
  const wantAudit = ['ds_supplier_product.submitted', 'ds_supplier_submission.approve', 'ds_supplier_submission.changes', 'ds_supplier_submission.reject', 'ds_supplier_price.applied', 'ds_partner_order.assigned',
    'ds_partner_order.shipped', 'ds_partner_order.problem', 'ds_partner_order.cancelled', 'ds_supplier.portal_account_linked', 'ds_partner.invited', 'ds_partner.merchant_attached', 'ds_partner.rule_saved',
    'ds_channel.settings_saved', 'ds_channel.waitlist_joined', 'ds_doc.registered', 'ds_doc.linked', 'ds_doc.verified', 'ds_doc.viewed', 'ds_supplier_rules.saved'];
  ok(wantAudit.every((a) => have.has(a)), `audit rows written for every change${wantAudit.filter((a) => !have.has(a)).length ? ' — missing ' + wantAudit.filter((a) => !have.has(a)).join(',') : ''}`);
  // scoped to this release's actions: other suites' auth.sign_in rows name the method ("password"), which is not a secret
  ok(!(await one(`select exists (select 1 from audit_log where created_at > now() - interval '1 hour' and action = any(array[${wantAudit.map((a) => `'${a}'`).join(',')}]::text[]) and details::text ~ '(password|secret|token)') x`)).x, 'audit rows hold no secrets');

  // restore what the test changed outside rolled-back data
  if (feats) await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify(feats)]);
  if (rulesBefore) await db.query(`insert into site_settings (key, value, is_public) values ('dropship_supplier_rules', $1::jsonb, false) on conflict (key) do update set value = excluded.value`, [JSON.stringify(rulesBefore)]);

  // ── 9. down → up ──
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
        union all select 'seq', sequencename from pg_sequences where schemaname = 'public'
        union all select 'acl', c.relname || ':' || coalesce(c.relacl::text, '') from pg_class c where c.relnamespace = 'public'::regnamespace
        order by 1, 2`));
      const withIt = await snap();
      await db.query(ctx.DOWN);
      const without = await snap();
      const gone = await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES]);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n);
      const kind = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'dropship_order_events_kind_check'`)).d;
      ok(Number(gone.n) === 0 && fnLeft === 0 && !/shipped/.test(kind), 'down: every DS14 table and function is gone; the original order event kinds are back');
      await db.query(ctx.UP);
      ok((await snap()) === withIt, 'up again: identical schema (functions + grants, columns, policies, constraints, indexes, triggers, sequences, table ACLs)');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ds14_supplier_partners_channels.sql'));
  if (!MIG) { console.error('✘ DS14 migration file not found'); process.exit(1); }
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
    failed = await runDs14Checks(db, {
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
  console.log(failed ? `\nds14-dropship: ${failed} check(s) failed` : '\nds14-dropship: all passed');
  process.exitCode = failed ? 1 : 0;
}
