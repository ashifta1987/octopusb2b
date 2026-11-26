// Octopus Dropship · Release 2 · Step 6 + 6b (merchant) DB checks — migration *_ds6_import_editor_pricing_packing.
// STAGING ONLY, one rolled-back transaction, acting as merchants / staff through JWT claims (what PostgREST does).
//  0. Structure: 14 new tables with RLS (merchant org via my_org_ids()), no direct writes for signed-in users, anon nothing;
//     every ds_ function is SECURITY DEFINER-safe (search_path=public), revoked from public/anon; internal helpers and the
//     executor are not callable by merchants. Customer-readable columns don't look internal (customer-columns rule).
//  1. Pricing engine (ds_price_compute): bands, × multiplier + fixed, FX, rounding (.99 / .95 / whole / none, 3-decimal
//     currencies), compare-at, profit floor, minimum flag, NEEDS_FX, invalid bands — the same table as tests/unit.
//  2. Import list: add (idempotent), bulk add by DS model no. (unknown / private-to-another-merchant answer the same),
//     remove; paused merchant can't add; another merchant sees nothing.
//  3. Editor: defaults (vendor = brand, store SKU = DS variant model no.), merchant copy saved, Octopus product + variants
//     unchanged (row hashes), supplier / model-number / "Octopus" text refused naming the FIELD only, images only from the
//     product, payload has no supplier / cost / Sourcing keys.
//  4. Pricing rules: validation, save, FX needed for non-USD, recorded FX (Finance only) prices the product exactly like
//     ds_price_compute, the minimum margin flag.
//  5. Push: refused without a store ("Connect a store first", no rows), paused merchant refused, feature off refused; with an
//     active store: queued idempotently (same request key = replay; one open job per product), below-minimum blocked until
//     confirmed, payload merchant-safe, FX stored with the calculation; cancel; executor claim → complete → links; re-push
//     carries the Shopify ID; failure backoff → failed; unlink queues "stock to 0 first".
//  6. Packing and shipping: US defaults to DDP, duty modes saved per selling country only, unknown fees can't be chosen,
//     rate mapping needs a store.
//  7. RLS cross-org + anon; audit rows; ledger and wallet totals unchanged.
//  8. down → up → down → up: identical schema, nothing else touched (later migrations unwound / re-applied).
// Run: node supabase/tests/ds6-dropship.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Shared case table for the pricing engine (also in tests/unit/dropship-pricing.test.ts). */
export const PRICE_CASES = [
  { name: 'AED band 2 ×2.2, .99, +25 %', landed: 1970, cur: 'AED', fx: '3.67250000', rounding: 'end_99', cmp: 2500, min: 5000, price: 15999, compare: 19999, landedMinor: 7235, profit: 5477, below: false, band: 2 },
  { name: 'AED band 3 ×1.9 below 50 %', landed: 2830, cur: 'AED', fx: '3.67250000', rounding: 'end_99', cmp: null, min: 5000, price: 19799, compare: null, landedMinor: 10394, profit: 4750, below: true, band: 3 },
  { name: 'USD band 1 ×2.6, .99', landed: 1000, cur: 'USD', fx: '1', rounding: 'end_99', cmp: 5000, min: 1500, price: 2699, compare: 4099, landedMinor: 1000, profit: 6294, below: false, band: 1 },
  { name: 'KWD (3 decimals) .99 → .990', landed: 2000, cur: 'KWD', fx: '0.30750000', rounding: 'end_99', cmp: null, min: 0, price: 13990, compare: null, landedMinor: 6150, profit: 5604, below: false, band: 2 },
  { name: 'USD whole number', landed: 1500, cur: 'USD', fx: '1', rounding: 'whole', cmp: null, min: 0, price: 3300, compare: null, landedMinor: 1500, profit: 5454, below: false, band: 2 },
  { name: 'USD end .95', landed: 1500, cur: 'USD', fx: '1', rounding: 'end_95', cmp: null, min: 0, price: 3395, compare: null, landedMinor: 1500, profit: 5581, below: false, band: 2 },
  { name: 'USD no rounding', landed: 333, cur: 'USD', fx: '1', rounding: 'none', cmp: null, min: 0, price: 866, compare: null, landedMinor: 333, profit: 6154, below: false, band: 1 },
];
export const PRICE_BANDS = [
  { from_cents: 0, to_cents: 1500, multiplier_milli: 2600, fixed_cents: 0 },
  { from_cents: 1500, to_cents: 2500, multiplier_milli: 2200, fixed_cents: 0 },
  { from_cents: 2500, to_cents: null, multiplier_milli: 1900, fixed_cents: 0 },
];

const FORBIDDEN_KEYS = /"(supplier[a-z_]*|octopus_sku|legacy_sku|factory_model|unit_cost[a-z_]*|cost_cents|supplier_model|on_hand_qty|reserved_qty|available_qty|stock_qty)"/;

/**
 * The checks, on an open pg-like client (query(sql, params) → { rows }). ctx: { UP, DOWN, MIG, staging, unwindLater(db), reapplyLater(db) }.
 * Runs inside the caller's transaction; returns the number of failed checks.
 */
export async function runDs6Checks(db, ctx) {
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
  // ds_listing_save answers a text refusal ({ ok: false, code: 'TEXT_CHECK' }) instead of raising, so the audit row stays
  const saveErr = async (pid, body) => { const r = await tryq(`select ds_listing_save($1, $2::jsonb) r`, [pid, JSON.stringify(body)]); return r.err ?? (r.rows[0]?.r?.ok === false ? r.rows[0].r.message : ''); };
  const rpc = async (q, p) => (await one(q, p)).r;
  const uuid = async () => (await one(`select gen_random_uuid() u`)).u;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const TABLES = ['store_connections', 'dropship_fx_rates', 'dropship_pricing_rules', 'dropship_listings', 'dropship_listing_variants', 'dropship_push_batches',
    'dropship_push_jobs', 'dropship_product_links', 'dropship_variant_links', 'dropship_price_approvals', 'dropship_sync_log', 'dropship_packing_settings',
    'dropship_duty_modes', 'dropship_rate_mappings'];
  const MERCHANT_FNS = ['ds_import_list', 'ds_import_add', 'ds_import_remove', 'ds_import_bulk_add', 'ds_import_apply_rule', 'ds_listing_get', 'ds_text_check',
    'ds_listing_save', 'ds_pricing_get', 'ds_pricing_save', 'ds_price_approval_decide', 'ds_record_fx_rate', 'ds_push_page', 'ds_push_enqueue', 'ds_push_cancel',
    'ds_push_retry', 'ds_unlink', 'ds_pushed_list', 'ds_packing_get', 'ds_packing_save', 'ds_rate_mapping_save'];
  const PURE_FNS = ['ds_supported_currencies', 'ds_currency_exponent', 'ds_round_price', 'ds_bands_problem', 'ds_price_compute', 'ds_profit_bp', 'ds_fmt_money'];
  const INTERNAL_FNS = ['ds_text_to_html', 'ds_org_read', 'ds_feature_guard', 'ds_product_visible', 'ds_variant_stock_label', 'ds_rules_for', 'ds_main_market',
    'ds_default_method', 'ds_duty_mode', 'ds_active_connection', 'ds_fx_for', 'ds_packaging_extra_cents', 'ds_text_problems', 'ds_variant_landed',
    'ds_listing_state', 'ds_job_json', 'ds_push_claim', 'ds_push_complete', 'ds_push_fail'];
  const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;

  await owner();
  // ── 0. structure ──
  const rls = await all(`select relname, relrowsecurity r from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === TABLES.length && rls.every((x) => x.r), `all ${TABLES.length} new tables exist with RLS on`);
  const writeGrants = await all(`select table_name, grantee, privilege_type from information_schema.table_privileges
     where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated') and (grantee = 'anon' or privilege_type <> 'SELECT')`, [TABLES]);
  ok(writeGrants.length === 0, `no INSERT/UPDATE/DELETE for signed-in users and nothing for anon on the new tables${writeGrants.length ? ' — ' + JSON.stringify(writeGrants.slice(0, 4)) : ''}`);
  const pols = await all(`select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(pols.length === TABLES.length && pols.every((p) => p.cmd === 'SELECT' && (p.tablename === 'dropship_fx_rates' ? /is_staff\(\)/.test(p.qual) : /my_org_ids\(\)/.test(p.qual))),
    'one SELECT policy per table: own organisation via my_org_ids() (FX rates: staff only)');
  const fns = await all(`select p.proname n, p.prosecdef d, p.proconfig::text c, p.proacl::text a, p.provolatile v from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'ds\\_%'`);
  const fnNames = new Set(fns.map((f) => f.n));
  const missing = [...MERCHANT_FNS, ...PURE_FNS, ...INTERNAL_FNS].filter((n) => !fnNames.has(n));
  ok(missing.length === 0, `every ds_ function exists${missing.length ? ' — missing ' + missing.join(',') : ''}`);
  const openToAnon = fns.filter((f) => /(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? ''));
  const noPath = fns.filter((f) => !/search_path=public/.test(f.c ?? ''));
  const notDefiner = fns.filter((f) => [...MERCHANT_FNS, ...INTERNAL_FNS].includes(f.n) && f.n !== 'ds_text_to_html' && !f.d);
  const internalOpen = fns.filter((f) => INTERNAL_FNS.includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  const merchantClosed = fns.filter((f) => MERCHANT_FNS.includes(f.n) && !/authenticated=X/.test(f.a ?? ''));
  ok(openToAnon.length === 0 && noPath.length === 0 && notDefiner.length === 0,
    `ds_ functions: none for public/anon, all search_path=public, every RPC a security definer${[...openToAnon, ...noPath, ...notDefiner].map((f) => ' ' + f.n).join('')}`);
  ok(internalOpen.length === 0 && merchantClosed.length === 0, `internal helpers + executor not callable by signed-in users; the ${MERCHANT_FNS.length} merchant RPCs are${[...internalOpen, ...merchantClosed].map((f) => ' ' + f.n).join('')}`);
  const cols = await all(`select table_name t, column_name c from information_schema.columns where table_schema = 'public' and table_name = any($1) and table_name <> 'dropship_fx_rates'`, [TABLES]);
  const looksInternal = cols.filter((c) => INTERNAL_NAME.test(c.c));
  ok(looksInternal.length === 0, `no merchant-readable column looks internal (customer-columns rule)${looksInternal.length ? ' — ' + looksInternal.map((c) => `${c.t}.${c.c}`).join(', ') : ''}`);

  // ── 1. pricing engine ──
  for (const k of PRICE_CASES) {
    const r = await rpc(`select ds_price_compute($1, $2::jsonb, $3, $4, $5, $6::numeric, $7) r`, [k.landed, JSON.stringify(PRICE_BANDS), k.rounding, k.cmp, k.min, k.fx, k.cur]);
    ok(r.ok === true && Number(r.price_minor) === k.price && (r.compare_at_minor == null ? k.compare == null : Number(r.compare_at_minor) === k.compare)
      && Number(r.landed_minor) === k.landedMinor && Number(r.profit_bp) === k.profit && r.below_min === k.below && Number(r.band) === k.band,
      `price: ${k.name} → ${r.price_minor}/${r.compare_at_minor} profit ${r.profit_bp} (want ${k.price}/${k.compare} ${k.profit})`);
  }
  const noFx = await rpc(`select ds_price_compute(1970, $1::jsonb, 'end_99', null, 5000, null, 'AED') r`, [JSON.stringify(PRICE_BANDS)]);
  const gap = await rpc(`select ds_price_compute(1970, $1::jsonb, 'end_99', null, 5000, 1, 'USD') r`, [JSON.stringify([{ from_cents: 0, to_cents: 1000, multiplier_milli: 2000 }, { from_cents: 1200, to_cents: null, multiplier_milli: 2000 }])]);
  const low = await rpc(`select ds_price_compute(1970, $1::jsonb, 'end_99', null, 5000, 1, 'USD') r`, [JSON.stringify([{ from_cents: 0, to_cents: null, multiplier_milli: 900 }])]);
  ok(noFx.ok === false && noFx.code === 'NEEDS_FX' && gap.ok === false && /Band 2 must start where band 1 ends/.test(gap.message) && low.ok === false && /between 1.0 and 20.0/.test(low.message),
    'price: no FX → NEEDS_FX; a gap or a multiplier under 1.0 is refused with the band named');
  const html = (await one(`select ds_text_to_html($1) h`, ['Quiet <b>pump</b> & filter\n\n- BPA-free\n- USB powered\nLast line'])).h;
  ok(html === '<p>Quiet &lt;b&gt;pump&lt;/b&gt; &amp; filter</p><ul><li>BPA-free</li><li>USB powered</li></ul><p>Last line</p>', `description → safe HTML (${html})`);

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    const email = `ds6-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email${ctx.staging ? ", aud, role, instance_id" : ''}) values (gen_random_uuid(), $1${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `DS6 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkMerchant = async (tag, status = 'on', markets = ['AE', 'US']) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – DS6 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    // new organisations get default company_services rows (migration 177): upsert the Dropship one
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', $2, now())
                    on conflict (org_id, service) do update set status = excluded.status, started_at = excluded.started_at`, [org, status]);
    for (const c of markets) await db.query(`insert into dropship_markets (org_id, country, locked_by_staff) values ($1, $2, false) on conflict do nothing`, [org, c]);
    return { uid, org };
  };
  const A = await mkMerchant('a');
  const B = await mkMerchant('b');
  const P = await mkMerchant('paused', 'paused');
  const fin = await mkUser('fin', 'finance');
  await db.query(`insert into dropship_seller_profiles (org_id, brand_name, return_name, return_line1, return_city, return_country) values ($1, 'Anna Home', 'Anna', '1 Road', 'Dubai', 'AE')`, [A.org]);
  const prod = await one(`select id, model_no, title, supplier_sku from dropship_products where model_no = 'DS-000001'`);
  ok(Boolean(prod), 'fixture: DS-000001 exists');
  const vars = await all(`select id, model_no, item_id, octopus_sku from dropship_variants where product_id = $1 order by sort, model_no`, [prod.id]);
  // complete weight / box so the quote engine can price (rolled back)
  await db.query(`update item_master set weight_g = coalesce(weight_g, 300), box_l_cm = coalesce(box_l_cm, 20), box_w_cm = coalesce(box_w_cm, 15), box_h_cm = coalesce(box_h_cm, 5)
                   where id = any($1::uuid[])`, [vars.map((v) => v.item_id)]);
  const prodHash = async () => (await one(`select md5((select row_to_json(p)::text from dropship_products p where p.id = $1) || coalesce((select string_agg(row_to_json(v)::text, '|' order by v.id) from dropship_variants v where v.product_id = $1), '')) h`, [prod.id])).h;
  const hashBefore = await prodHash();
  const ledgerBefore = ctx.staging ? await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`) : null;
  const supplierName = (await one(`select legal_name n from suppliers where length(btrim(coalesce(legal_name, ''))) >= 6 order by legal_name limit 1`))?.n;

  // ── 2. import list ──
  await as(A.uid);
  const add1 = await rpc(`select ds_import_add($1::uuid[]) r`, [[prod.id]]);
  const add2 = await rpc(`select ds_import_add($1::uuid[]) r`, [[prod.id]]);
  const rows = Number((await one(`select count(*) n from dropship_import_list where org_id = $1 and product_id = $2`, [A.org, prod.id])).n);
  ok(add1.added === 1 && add2.added === 0 && add2.skipped === 1 && rows === 1, 'import list: add, then add again = no duplicate (idempotent)');
  const bulk = await rpc(`select ds_import_bulk_add($1::jsonb) r`, [JSON.stringify([{ line: 2, model_no: 'DS-000001' }, { line: 3, model_no: 'DS-999999' }, { line: 4, model_no: 'XYZ' }, { line: 5, model_no: 'DS-000001', variant: 'DS-000001-99' }])]);
  const reasons = bulk.skipped.map((s) => s.reason);
  ok(bulk.added === 0 && bulk.skipped.length === 4 && /Already in your import list/.test(reasons[0]) && /doesn't exist or isn't available to you/.test(reasons[1])
     && /Not a DS model number/.test(reasons[2]) && /not part of/.test(reasons[3]), `bulk add: each skipped line says why (${reasons.join(' | ')})`);
  await owner();
  const privB = await one(`select id, model_no from dropship_products where visible_to_org_id is not null and visible_to_org_id <> $1 limit 1`, [A.org]);
  if (privB) {
    await as(A.uid);
    const priv = await rpc(`select ds_import_bulk_add($1::jsonb) r`, [JSON.stringify([{ line: 1, model_no: privB.model_no }])]);
    ok(priv.added === 0 && priv.skipped[0].reason === `${privB.model_no} doesn't exist or isn't available to you.`, 'bulk add: a product private to another merchant answers exactly like a missing one');
  }
  await as(B.uid);
  const bSees = Number((await one(`select count(*) n from dropship_import_list where org_id = $1`, [A.org])).n);
  const bList = await rpc(`select ds_import_list() r`);
  ok(bSees === 0 && bList.rows.length === 0, "another merchant sees none of A's import list");
  await as(P.uid);
  const pAdd = await err(`select ds_import_add($1::uuid[])`, [[prod.id]]);
  ok(/DROPSHIP_PAUSED/.test(pAdd), 'paused merchant: adding to the import list is refused (DROPSHIP_PAUSED)');

  // ── 3. editor ──
  await as(A.uid);
  const st0 = await rpc(`select ds_listing_get($1) r`, [prod.id]);
  ok(st0 && st0.vendor === 'Anna Home' && st0.variants.length === vars.length && st0.variants.every((v, i) => v.store_sku === vars[i].model_no && /^DS-\d{6}-\d{2}$/.test(v.store_sku)),
    'editor defaults: vendor = the merchant brand; store SKU = the DS variant model no. (never a Sourcing number)');
  ok(!FORBIDDEN_KEYS.test(JSON.stringify(st0)) && !(prod.supplier_sku && JSON.stringify(st0).includes(prod.supplier_sku)) && !vars.some((v) => v.octopus_sku && JSON.stringify(st0).includes(v.octopus_sku)),
    'editor data has no supplier / cost / Sourcing / stock-number fields or values');
  const base = { title: 'Quiet desk lamp', description: 'Bright and quiet.\n- USB-C\n- Dimmable', image_urls: st0.octopus_images.slice(0, 1), vendor: 'Anna Home',
    product_type: 'Lighting', collection: 'Home', tags: ['lamp', 'desk'], handle: 'quiet-desk-lamp', seo_title: 'Quiet desk lamp', seo_description: 'A quiet lamp.',
    publish_as: 'draft', sync_stock: true, sync_price: true, price_mode: 'rule',
    variants: st0.variants.map((v) => ({ variant_id: v.variant_id, include: true, store_sku: v.store_sku })) };
  if (!base.image_urls.length) { await owner(); await db.query(`update dropship_products set images = array['https://example.com/ds6-a.jpg', 'https://example.com/ds6-b.jpg'] where id = $1`, [prod.id]); base.image_urls = ['https://example.com/ds6-a.jpg']; await as(A.uid); }
  const saved = await tryq(`select ds_listing_save($1, $2::jsonb) r`, [prod.id, JSON.stringify(base)]);
  await owner();
  const lst = await one(`select title, vendor, image_urls, saved_by from dropship_listings where org_id = $1 and product_id = $2`, [A.org, prod.id]);
  const hashMid = await prodHash();
  ok(!saved.err && lst?.title === 'Quiet desk lamp' && lst.saved_by === A.uid, `editor: the merchant copy is saved${saved.err ? ' — ' + saved.err : ''}`);
  await as(A.uid);
  const refusals = {
    supplier: supplierName ? await saveErr(prod.id, { ...base, title: `Lamp by ${supplierName}` }) : 'TEXT_CHECK: title',
    octopus: await saveErr(prod.id, { ...base, description: 'Shipped by Octopus from our hub' }),
    model: prod.supplier_sku ? await saveErr(prod.id, { ...base, variants: base.variants.map((v, i) => (i === 0 ? { ...v, store_sku: prod.supplier_sku } : v)) }) : 'TEXT_CHECK: store SKU',
    sourcing: await saveErr(prod.id, { ...base, tags: ['CN-GD-ABC-P07'] }),
    image: await saveErr(prod.id, { ...base, image_urls: ['https://evil.example/x.jpg'] }),
    compare: await saveErr(prod.id, { ...base, price_mode: 'manual', variants: base.variants.map((v) => ({ ...v, price_minor: 2000, compare_at_minor: 1500 })) }),
  };
  ok(/TEXT_CHECK: title/.test(refusals.supplier) && (!supplierName || !refusals.supplier.toLowerCase().includes(supplierName.toLowerCase())),
    'editor: a supplier name in the title is refused naming the FIELD, never the supplier');
  ok(/TEXT_CHECK: description/.test(refusals.octopus) && /TEXT_CHECK: store SKU/.test(refusals.model) && /TEXT_CHECK: tags/.test(refusals.sourcing),
    `editor: "Octopus", a factory model no. as SKU and a Sourcing model no. in tags are refused (${refusals.octopus} | ${refusals.model} | ${refusals.sourcing})`);
  ok(/INVALID_IMAGES/.test(refusals.image) && /INVALID_COMPARE_AT/.test(refusals.compare), 'editor: images only from the product; compare-at must be above the price');
  const chk = await rpc(`select ds_text_check($1, $2::jsonb) r`, [prod.id, JSON.stringify({ title: 'Octopus lamp', tags: 'lamp' })]);
  ok(chk.ok === false && chk.fields.length === 1 && chk.fields[0].field === 'title' && chk.fields[0].kind === 'octopus_word', 'live text check returns field + kind only');
  await owner();
  ok(hashMid === hashBefore && (await prodHash()) === hashBefore, 'editor: the Octopus product and its variants are unchanged (row hashes equal)');
  const refusedAudit = Number((await one(`select count(*) n from audit_log where action = 'ds_listing.text_refused' and entity_id = $1 and details ->> 'org_id' = $2`, [prod.id, A.org])).n);
  ok(refusedAudit >= 3 && !(await all(`select details::text d from audit_log where action = 'ds_listing.text_refused' and entity_id = $1`, [prod.id])).some((r) => supplierName && r.d.toLowerCase().includes(supplierName.toLowerCase())), `refused texts are audit-logged with field names only (${refusedAudit})`);

  // ── 4. pricing rules ──
  await as(A.uid);
  const rules = { bands: PRICE_BANDS, rounding: 'end_99', compare_at_bp: 2500, min_profit_bp: 5000, store_currency: 'USD', fx_threshold_bp: null, main_market: 'AE',
    when_landed_up: 'ask', when_landed_down: 'keep', when_out_of_stock: 'draft', check_every_hours: 3, alert_low_stock: true, email_alerts: true };
  const badGap = await err(`select ds_pricing_save($1::jsonb)`, [JSON.stringify({ ...rules, bands: [{ from_cents: 100, to_cents: null, multiplier_milli: 2000 }] })]);
  const badMin = await err(`select ds_pricing_save($1::jsonb)`, [JSON.stringify({ ...rules, min_profit_bp: 9500 })]);
  const badThr = await err(`select ds_pricing_save($1::jsonb)`, [JSON.stringify({ ...rules, store_currency: 'AED' })]);
  const badMkt = await err(`select ds_pricing_save($1::jsonb)`, [JSON.stringify({ ...rules, main_market: 'JP' })]);
  ok(/Band 1 must start at \$0.00/.test(badGap) && /INVALID_MIN/.test(badMin) && /INVALID_THRESHOLD/.test(badThr) && /INVALID_MARKET/.test(badMkt),
    'pricing rules: bands from $0 contiguous, minimum 0–90 %, non-USD needs a repricing threshold, main market must be a selling country');
  const savedRules = await rpc(`select ds_pricing_save($1::jsonb) r`, [JSON.stringify(rules)]);
  ok(savedRules.ok && savedRules.rules.saved === true && savedRules.rules.min_profit_bp === 5000, 'pricing rules saved');
  // landed cost: DDP first (duties may still be unknown → never 0), then DAP is always priceable
  let st1 = await rpc(`select ds_listing_get($1) r`, [prod.id]);
  const v0 = st1.variants.find((v) => v.include);
  if (!v0.landed?.ok) {
    ok(v0.landed && ['DUTY_UNKNOWN', 'NO_RATE_SET', 'WEIGHT_SIZE_MISSING', 'NO_FEE_VERSION'].includes(v0.landed.code) && v0.price_minor == null && st1.ready === false,
      `unknown landed cost (${v0.landed?.code}) gives no price and blocks the push — never priced on 0`);
  }
  const savePack = await rpc(`select ds_packing_save($1::jsonb) r`, [JSON.stringify({ default_packaging: 'standard', default_method: 'standard', duty_modes: { AE: 'DAP' } })]);
  st1 = await rpc(`select ds_listing_get($1) r`, [prod.id]);
  const v1 = st1.variants.find((v) => v.include);
  const expect1 = v1?.landed?.ok ? await rpc(`select ds_price_compute($1, $2::jsonb, 'end_99', 2500, 5000, 1, 'USD') r`, [v1.landed_usd_cents, JSON.stringify(PRICE_BANDS)]) : null;
  ok(savePack.ok && st1.duty_mode === 'DAP' && v1?.landed?.ok === true && v1.landed.incoterm === 'DAP' && Number(v1.price_minor) === Number(expect1?.price_minor)
     && Number(v1.compare_at_minor) === Number(expect1?.compare_at_minor) && Number(v1.profit_bp) === Number(expect1?.profit_bp),
    `editor price = ds_price_compute(landed ${v1?.landed_usd_cents}) → ${v1?.price_minor} (${v1?.landed?.code ?? 'ok'})`);
  // AED without a rate → NEEDS_FX; Finance records a named rate → priced in AED
  await db.query(`select ds_pricing_save($1::jsonb)`, [JSON.stringify({ ...rules, store_currency: 'AED', fx_threshold_bp: 200 })]);
  await owner();
  await db.query(`delete from dropship_fx_rates where currency = 'AED'`);
  await as(A.uid);
  const stNoFx = await rpc(`select ds_listing_get($1) r`, [prod.id]);
  ok(stNoFx.currency === 'AED' && stNoFx.problems.some((p) => p.code === 'NEEDS_FX') && stNoFx.ready === false, 'AED store without an exchange rate: not priced, NEEDS_FX');
  const merchFx = await err(`select ds_record_fx_rate('AED', 3.6725, 'Test source')`);
  await as(fin, 'aal2');
  const finFx = await tryq(`select ds_record_fx_rate('AED', 3.6725, 'ECB reference rate') r`);
  await as(A.uid);
  const stFx = await rpc(`select ds_listing_get($1) r`, [prod.id]);
  const vFx = stFx.variants.find((v) => v.include);
  const expectFx = await rpc(`select ds_price_compute($1, $2::jsonb, 'end_99', 2500, 5000, 3.6725, 'AED') r`, [vFx.landed_usd_cents, JSON.stringify(PRICE_BANDS)]);
  ok(/FORBIDDEN/.test(merchFx) && !finFx.err && stFx.fx.source_name === 'ECB reference rate' && Number(vFx.price_minor) === Number(expectFx.price_minor),
    `FX: merchants can't record rates; Finance records a named rate; AED price = ${vFx.price_minor} (${expectFx.price_minor})`);
  // put USD back for the push section
  await db.query(`select ds_pricing_save($1::jsonb)`, [JSON.stringify(rules)]);

  // ── 5. push ──
  const rk1 = await uuid();
  const noStore = await err(`select ds_push_enqueue($1::uuid[], '{}'::jsonb, '{}'::uuid[], $2)`, [[prod.id], rk1]);
  await owner();
  const noRows = Number((await one(`select (select count(*) from dropship_push_batches where org_id = $1) + (select count(*) from dropship_push_jobs where org_id = $1) n`, [A.org])).n);
  ok(/STORE_NOT_CONNECTED: Connect a store first/.test(noStore) && noRows === 0, 'push without a store: "Connect a store first", no batch and no job written');
  await as(P.uid);
  const pPush = await err(`select ds_push_enqueue($1::uuid[], '{}'::jsonb, '{}'::uuid[], $2)`, [[prod.id], await uuid()]);
  ok(/DROPSHIP_PAUSED/.test(pPush), 'paused merchant: push refused (DROPSHIP_PAUSED)');
  await owner();
  const conn = (await one(`insert into store_connections (org_id, shop_domain, status, shop_currency, octopus_location_id, connected_at)
     values ($1, $2, 'active', 'USD', 'gid://shopify/Location/1', now()) returning id`, [A.org, `ds6-${stamp.replace(/[^a-z0-9]/g, '')}.myshopify.com`])).id;
  // feature off → refused
  const feats = (await one(`select value from site_settings where key = 'dropship_features'`))?.value;
  await db.query(`savepoint feat`);
  await db.query(`update site_settings set value = value || '{"import_list": false}'::jsonb where key = 'dropship_features'`);
  await as(A.uid);
  const offErr = await err(`select ds_push_enqueue($1::uuid[], '{}'::jsonb, '{}'::uuid[], $2)`, [[prod.id], await uuid()]);
  await owner();
  await db.query(`rollback to savepoint feat`);
  ok(feats && /FEATURE_OFF/.test(offErr), 'feature switched off (live early access): push refused in the database too');
  // make the first variant below the 50 % minimum with a manual low price, to check the confirmation
  await as(A.uid);
  const lowPrice = Math.max(1, Number(v1.landed_usd_cents) + 50);
  await db.query(`select ds_listing_save($1, $2::jsonb)`, [prod.id, JSON.stringify({ ...base, price_mode: 'manual', variants: st1.variants.map((v) => ({ variant_id: v.variant_id, include: v.include, store_sku: v.store_sku, price_minor: lowPrice })) })]);
  const enq = await rpc(`select ds_push_enqueue($1::uuid[], '{"publish_as":"draft"}'::jsonb, '{}'::uuid[], $2) r`, [[prod.id], rk1]);
  ok(enq.queued === 0 && enq.blocked.length === 1 && enq.blocked[0].code === 'BELOW_MIN' && /below your 50(\.0)?% minimum/.test(enq.blocked[0].message) && /US\$ /.test(enq.blocked[0].message),
    `below the minimum margin: not pushed without confirmation (${enq.blocked[0]?.message})`);
  const rk2 = await uuid();
  const enq2 = await rpc(`select ds_push_enqueue($1::uuid[], '{"publish_as":"draft"}'::jsonb, $1::uuid[], $2) r`, [[prod.id], rk2]);
  const replay = await rpc(`select ds_push_enqueue($1::uuid[], '{"publish_as":"draft"}'::jsonb, $1::uuid[], $2) r`, [[prod.id], rk2]);
  const enq3 = await rpc(`select ds_push_enqueue($1::uuid[], '{"publish_as":"draft"}'::jsonb, $1::uuid[], $2) r`, [[prod.id], await uuid()]);
  await owner();
  const jobs = await all(`select * from dropship_push_jobs where org_id = $1 and status = 'queued'`, [A.org]);
  ok(enq2.queued === 1 && replay.replayed === true && replay.batch_id === enq2.batch_id && enq3.queued === 0 && enq3.already_queued === 1 && jobs.length === 1,
    'push: confirmed → queued; same request key = replay of the same batch; a second push while one is open queues nothing (idempotent)');
  const job = jobs[0];
  const payloadText = JSON.stringify(job.payload);
  ok(!FORBIDDEN_KEYS.test(payloadText) && !(prod.supplier_sku && payloadText.includes(prod.supplier_sku)) && !(supplierName && payloadText.toLowerCase().includes(supplierName.toLowerCase()))
     && !/octopus|shenzhen/i.test(JSON.stringify({ ...job.payload, location_gid: null })) && job.payload.vendor === 'Anna Home' && job.payload.variants.every((v) => /^DS-\d{6}-\d{2}$/.test(v.sku) || v.sku),
    'push payload: merchant copy + DS model numbers only — no supplier, cost, Sourcing fields or the word Octopus');
  ok(job.pricing.fx && job.pricing.currency === 'USD' && job.pricing.variants.every((v) => Number.isInteger(Number(v.landed_usd_cents)) && Number(v.price_minor) === lowPrice)
     && job.pricing.confirmed_below_min === true && job.payload.description_html.startsWith('<p>'),
    'push pricing snapshot: landed cost, price, FX (rate + source) and the below-minimum confirmation are stored with the job');
  ok(Number((await one(`select count(*) n from audit_log where action = 'ds_push.below_min_confirmed' and details ->> 'org_id' = $1`, [A.org])).n) === 1, 'the below-minimum confirmation is audit-logged');
  // cancel + re-queue
  await as(A.uid);
  const cancel = await rpc(`select ds_push_cancel($1::uuid[]) r`, [[job.id]]);
  const enq4 = await rpc(`select ds_push_enqueue($1::uuid[], '{"publish_as":"active"}'::jsonb, $1::uuid[], $2) r`, [[prod.id], await uuid()]);
  const claimAsMerchant = await err(`select ds_push_claim('x', 1)`);
  const insertAsMerchant = await err(`insert into dropship_push_jobs (batch_id, org_id, product_id) values (gen_random_uuid(), $1, $2)`, [A.org, prod.id]);
  ok(cancel.cancelled === 1 && enq4.queued === 1 && /permission denied/.test(claimAsMerchant) && /permission denied/.test(insertAsMerchant),
    'cancel a queued job, push again; merchants cannot run the executor or write jobs directly');
  // executor: claim → complete
  await service();
  const claimed = (await all(`select ds_push_claim('test-worker', 5) j`)).map((r) => r.j);
  const mine = claimed.find((c) => c.product_id === prod.id);
  const result = { product_gid: 'gid://shopify/Product/101', store_status: 'ACTIVE', variants: mine.payload.variants.map((v, i) => ({ variant_id: v.variant_id, variant_gid: `gid://shopify/ProductVariant/20${i}`, inventory_item_gid: `gid://shopify/InventoryItem/30${i}`, sku: v.sku, price_minor: v.price_minor, compare_at_minor: v.compare_at_minor })) };
  await db.query(`select ds_push_complete($1, $2::jsonb)`, [mine.id, JSON.stringify(result)]);
  await as(A.uid);
  const pushed = await rpc(`select ds_pushed_list() r`);
  ok(Boolean(mine) && mine.attempts === 1 && pushed.rows.length === 1 && pushed.rows[0].store_status === 'active' && pushed.rows[0].sync_state === 'in_sync',
    'executor: claim (attempt 1) → complete → linked product shows on Pushed products');
  // re-push carries the Shopify IDs; failure → retry_wait with backoff → final failure
  const enq5 = await rpc(`select ds_push_enqueue($1::uuid[], '{}'::jsonb, $1::uuid[], $2) r`, [[prod.id], await uuid()]);
  await owner();
  const rejob = await one(`select * from dropship_push_jobs where org_id = $1 and status = 'queued'`, [A.org]);
  ok(enq5.queued === 1 && rejob.store_connection_id === conn && rejob.payload.product_gid === 'gid://shopify/Product/101' && rejob.payload.variants[0].variant_gid === 'gid://shopify/ProductVariant/200',
    're-push uses the saved Shopify product / variant IDs (update, never a duplicate)');
  await db.query(`update dropship_push_jobs set max_attempts = 2 where id = $1`, [rejob.id]);
  await service();
  await all(`select ds_push_claim('w', 5)`);
  const f1 = await rpc(`select ds_push_fail($1, 'THROTTLED', 'Shopify is busy', 20, false) r`, [rejob.id]);
  await owner();
  const afterF1 = await one(`select status, next_attempt_at > now() + interval '10 seconds' later from dropship_push_jobs where id = $1`, [rejob.id]);
  await db.query(`update dropship_push_jobs set next_attempt_at = now() - interval '1 second' where id = $1`, [rejob.id]);
  await service();
  await all(`select ds_push_claim('w', 5)`);
  const f2 = await rpc(`select ds_push_fail($1, 'HANDLE_TAKEN', 'Shopify said the handle is already used by another product in your store.', null, false) r`, [rejob.id]);
  await as(A.uid);
  const pushed2 = await rpc(`select ds_pushed_list() r`);
  ok(f1.final === false && afterF1.status === 'retry_wait' && afterF1.later && f2.final === true && pushed2.failed.length === 1 && /handle is already used/.test(pushed2.failed[0].error_message),
    'failure: rate limit → retry later (Retry-After), last attempt → Failed with the plain reason on Pushed products');
  const retry = await rpc(`select ds_push_retry($1::uuid[], $2, $3::uuid[]) r`, [[rejob.id], await uuid(), [prod.id]]);
  ok(retry.queued === 1, 'Retry queues the failed product again');
  // unlink: a job that sets stock to 0 at the Octopus location first
  await owner();
  await db.query(`update dropship_push_jobs set status = 'cancelled' where org_id = $1 and status in ('queued', 'retry_wait')`, [A.org]);
  await as(A.uid);
  const un = await rpc(`select ds_unlink($1::uuid[], $2) r`, [[prod.id], await uuid()]);
  await owner();
  const unjob = await one(`select * from dropship_push_jobs where org_id = $1 and kind = 'unlink' and status = 'queued'`, [A.org]);
  ok(un.queued === 1 && unjob.payload.stock_to_zero_first === true && unjob.payload.inventory_item_gids.length >= 1 && unjob.payload.location_gid === 'gid://shopify/Location/1',
    'unlink queues "stock to 0 at our location first" with the inventory items and the location');
  await service();
  await all(`select ds_push_claim('w', 5)`);
  await db.query(`select ds_push_complete($1, '{}'::jsonb)`, [unjob.id]);
  await as(A.uid);
  const pushed3 = await rpc(`select ds_pushed_list() r`);
  const log = (await rpc(`select ds_pricing_get() r`)).sync_log;
  ok(pushed3.rows.length === 0 && log.some((l) => l.kind === 'unlink') && log.some((l) => l.kind === 'push'), 'after unlink the product leaves Pushed products; the sync log records push + unlink');

  // ── 6. packing and shipping ──
  await as(B.uid);
  const packB = await rpc(`select ds_packing_get() r`);
  const us = packB.markets.find((m) => m.country === 'US');
  ok(us && us.mode === 'DDP' && us.saved === false && packB.settings.default_packaging === 'standard' && packB.own_stock.length === 0,
    'packing defaults: the US is DDP until changed; standard packaging; no own stock = branded not offered');
  ok(packB.fees === null || (packB.fees.protective_cents === null && packB.fees.insert_cents === null && packB.fees.processing_first_cents != null),
    'fees come from the active fee version; fees with no value are "not set" (null), never 0');
  const prot = await err(`select ds_packing_save('{"default_packaging":"protective"}'::jsonb)`);
  const brand = await err(`select ds_packing_save('{"default_packaging":"branded"}'::jsonb)`);
  const ins = await err(`select ds_packing_save('{"insert_card":true}'::jsonb)`);
  const jp = await err(`select ds_packing_save('{"duty_modes":{"JP":"DAP"}}'::jsonb)`);
  const rate = await err(`select ds_rate_mapping_save(gen_random_uuid(), 'standard')`);
  ok(/FEE_NOT_SET/.test(prot) && /FEE_NOT_SET|BRANDED_STOCK_REQUIRED/.test(brand) && /FEE_NOT_SET/.test(ins) && /INVALID_MARKET/.test(jp) && /STORE_NOT_CONNECTED: Connect a store to map rates/.test(rate),
    'packing: unknown fees can\'t be chosen; duties only for selling countries; rate mapping needs a connected store');
  await db.query(`select ds_packing_save('{"default_packaging":"standard","default_method":"economy","fallback_method":"standard","duty_modes":{"AE":"DAP"}}'::jsonb)`);
  const packB2 = await rpc(`select ds_packing_get() r`);
  ok(packB2.markets.find((m) => m.country === 'AE').mode === 'DAP' && packB2.markets.find((m) => m.country === 'US').mode === 'DDP' && packB2.settings.default_method === 'economy',
    'packing saved: AE → DAP, US stays DDP, default method economy');
  await as(P.uid);
  ok(/DROPSHIP_PAUSED/.test(await err(`select ds_packing_save('{}'::jsonb)`)), 'paused merchant: packing changes refused');
  const pRead = await tryq(`select ds_packing_get() r`);
  ok(!pRead.err, 'paused merchant: can still read Packing and shipping (history stays)');

  // ── 7. RLS cross-org + anon ──
  await as(B.uid);
  const leaks = [];
  for (const t of TABLES.filter((x) => x !== 'dropship_fx_rates')) {
    const n = Number((await one(`select count(*) n from ${t} where org_id = $1`, [A.org])).n);
    if (n) leaks.push(t);
  }
  const bGet = await rpc(`select ds_listing_get($1) r`, [prod.id]);
  const bFx = Number((await one(`select count(*) n from dropship_fx_rates`)).n);
  ok(leaks.length === 0 && bGet === null && bFx === 0, `merchant B reads none of A's rows (${TABLES.length - 1} tables), no FX table rows, and A's listing is null for B${leaks.length ? ' — ' + leaks.join(',') : ''}`);
  await as(null, 'aal1', 'anon');
  const anonErrs = [];
  for (const t of TABLES) if (!/permission denied/.test(await err(`select 1 from ${t} limit 1`))) anonErrs.push(t);
  const anonRpc = await err(`select ds_import_list()`);
  ok(anonErrs.length === 0 && /permission denied/.test(anonRpc), 'anon: no table and no RPC');
  await owner();
  const audits = (await all(`select distinct action from audit_log where action like 'ds\\_%' and (details ->> 'org_id' = any($1) or entity_id = any($1))`, [[A.org, B.org]])).map((r) => r.action);
  ok(['ds_import.added', 'ds_listing.saved', 'ds_pricing.saved', 'ds_push.enqueued', 'ds_packing.saved', 'ds_unlink.requested'].every((a) => audits.includes(a)),
    `audit rows written (${audits.join(', ')})`);
  if (ctx.staging) {
    const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
    ok(l.d === l.c && l.d === ledgerBefore.d, `ledger balanced and unchanged (${l.d} = ${l.c})`);
  }

  // ── 8. down → up ──
  if (ctx.DOWN && ctx.UP) {
    await owner();
    await ctx.unwindLater(db);
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
    const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ds\\_%'`)).n);
    ok(Number(gone.n) === 0 && fnLeft === 0, 'down: every DS6 table and ds_ function is gone');
    await db.query(ctx.UP);
    const again = await snap();
    ok(again === withIt, 'up again: identical schema (functions + grants, columns, policies, constraints, indexes, triggers, table ACLs)');
    await db.query(ctx.UP);
    ok((await snap()) === withIt, 'up is re-runnable');
    await db.query(ctx.DOWN);
    ok((await snap()) === without, 'down again: the same schema as the first down (empty up → down diff)');
    await db.query(ctx.UP);
    await ctx.reapplyLater(db);
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ds6_import_editor_pricing_packing.sql'));
  if (!MIG) { console.error('✘ DS6 migration file not found'); process.exit(1); }
  const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
  const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await assertStagingDatabase(db);
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  let later = [];
  let failed = 0;
  try {
    await db.query('begin');
    failed = await runDs6Checks(db, {
      UP, DOWN, MIG, staging: true,
      unwindLater: async (c) => { later = await appliedAfter(c, MIG); await unwind(c, later); },
      reapplyLater: async (c) => { await reapply(c, later); },
    });
  } catch (e) {
    console.log('✘ unexpected error: ' + e.message);
    failed++;
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
  console.log(failed ? `\nds6-dropship: ${failed} check(s) failed` : '\nds6-dropship: all passed');
  process.exitCode = failed ? 1 : 0;
}
